Nginx is configured as an [HTTP reverse proxy](https://nginx.org/en/docs/http/ngx_http_proxy_module.html){target="_blank"} using an `upstream` block that defines the pool of backend servers. When Docker Compose starts multiple replicas of the `gateway` service, Docker's internal DNS resolves the service name `gateway` to all replica IP addresses. Nginx queries that DNS record at startup and builds its upstream pool from every returned address.

Create the file `setup/nginx/nginx.conf`:

``` { .nginx .copy .select linenums="1" title="nginx.conf" }
--8<-- "docs/hands-on/7/nginx/nginx.conf"
```

Key directives:

| Directive | Purpose |
|---|---|
| `upstream gateways` | Names a pool of backend servers. Docker DNS expands `gateway:8080` to all replica IPs at startup. |
| `least_conn` | Load balancing algorithm: each new request goes to the replica with the fewest active connections. |
| `proxy_pass` | Forwards the matched request to the upstream pool. |
| `X-Real-IP` | Passes the original client IP address to the backend service. |
| `X-Forwarded-For` | Appends the client IP to the standard forwarding chain — used for logging and audit trails. |
| `X-Forwarded-Proto` | Tells the backend whether the original request arrived via HTTP or HTTPS. |

!!! info "Changing the algorithm"

    The algorithm is declared inside the `upstream` block. Replace `least_conn` with any of the following:

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
    docker compose exec nginx nginx -s reload
    ```

The resulting project structure after adding the configuration file:

``` tree
api/
    setup/
        nginx/
            nginx.conf
    account-service/
    auth-service/
    gateway-service/
    compose.yaml
    .env
```
