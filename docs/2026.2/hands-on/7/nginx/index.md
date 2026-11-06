Nginx is configured as an [HTTP reverse proxy](https://nginx.org/en/docs/http/ngx_http_proxy_module.html){target="_blank"} using an `upstream` block that defines the pool of backend servers. When Docker Compose starts multiple replicas of the `gateway` service, Docker's internal Domain Name System (DNS) resolves the service name `gateway` to all replica IP addresses. Nginx queries that DNS record at startup and builds its upstream pool from every returned address.

Create the file `setup/nginx.conf`:

``` { .nginx .copy .select linenums="1" title="nginx.conf" }
--8<-- "docs/2026.2/hands-on/7/nginx/nginx.conf"
```

Key directives:

| Directive | Purpose |
|---|---|
| `upstream gateways` | Names a pool of backend servers. Docker DNS expands `gateway:8080` to all replica IPs at startup. |
| _(no algorithm line)_ | Load balancing algorithm: none is declared, so Nginx uses its default, **Round Robin** — each new request goes to the next replica in turn. |
| `proxy_pass` | Forwards the matched request to the upstream pool. |
| `X-Real-IP` | Passes the original client IP address to the backend service. |
| `X-Forwarded-For` | Appends the client IP to the standard forwarding chain — used for logging and audit trails. |
| `X-Forwarded-Proto` | Tells the backend whether the original request arrived via HTTP or HTTPS. |

With three replicas and no algorithm line, each request goes to the next peer in turn:

``` mermaid-sim
sequenceDiagram
    participant C as curl
    participant N as lb, Nginx
    participant G1 as gateway-1
    participant G2 as gateway-2
    participant G3 as gateway-3
    C->>N: GET /health-check, request 1
    N->>G1: proxy_pass http://gateways
    G1-->>N: 200, hostname of gateway-1
    N-->>C: 200
    C->>N: request 2
    N->>G2: the next peer
    G2-->>N: 200, hostname of gateway-2
    N-->>C: 200
    C->>N: request 3
    N->>G3: the next peer
    G3-->>N: 200, hostname of gateway-3
    N-->>C: 200
    Note over C,G3: request 4 goes back to gateway-1
```

!!! info "Changing the algorithm"

    The algorithm is declared inside the `upstream` block; the file above declares none, so it runs Round Robin. To change it, add one of the following lines before the `server` entry:

    | Directive | Algorithm |
    |---|---|
    | _(none)_ | Round Robin (default) |
    | `least_conn;` | Least Connections |
    | `ip_hash;` | IP Hash (sticky sessions) |
    | `random;` | Random |

    Weighted Round Robin uses per-server `weight` parameters: `server gateway:8080 weight=3;`

!!! warning "DNS resolution and dynamic scaling"

    Nginx resolves the `gateway` hostname **once at startup** and caches the returned IP list. Starting the stack with a fixed replica count (defined in `compose.yaml`) ensures Nginx picks up all instances on launch. If replicas are added later, Nginx must be reloaded to discover them:

    ``` { .bash .copy .select }
    docker compose exec lb nginx -s reload
    ```

``` mermaid-sim
sequenceDiagram
    participant N as lb, Nginx
    participant D as Docker DNS
    participant Co as docker compose
    N->>D: resolve gateway, at startup
    D-->>N: 3 IPs, so 3 peers
    Co->>D: up -d --scale gateway=5
    Note over N: still 3 peers, replicas 4 and 5 get no traffic
    N->>D: nginx -s reload resolves gateway again
    D-->>N: 5 IPs, so 5 peers
```

The resulting project structure after adding the configuration file:

``` tree
api/
    setup/
        nginx.conf
    account/
    account-service/
    auth/
    auth-service/
    gateway-service/
    compose.yaml
    .env
```
