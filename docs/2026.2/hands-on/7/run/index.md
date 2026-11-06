Rebuild all images and start the full stack:

``` { .bash .copy .select }
docker compose up -d --build
```

Verify that three `gateway` replicas and one `lb` (Nginx) instance are running alongside the rest of the services:

``` { .bash .copy .select }
docker compose ps -a
```

Expected output:

```
NAME                STATUS     PORTS
store-lb-1          running    0.0.0.0:8080->80/tcp
store-gateway-1     running
store-gateway-2     running
store-gateway-3     running
store-auth-1        running
store-account-1     running
store-db-1          running
```

Note that only `lb` publishes a port: the gateway containers (and the other services) are only reachable through Nginx on the internal Docker network.

## Verify Load Distribution

Send a burst of requests through Nginx. The gateway's `/health-check` answers with the hostname of the container that served it, so the output cycles through the three replicas; the gateway logs show the same:

``` { .bash .copy .select }
for i in {1..9}; do curl -s http://localhost:8080/health-check; echo; done
```

``` { .bash .copy .select }
docker compose logs gateway --tail 30
```

Each of the three containers should show request entries. If all requests land on a single replica, Nginx may have started before the gateway replicas were fully ready. Reload Nginx to re-resolve the Domain Name System (DNS) record of `gateway`:

``` { .bash .copy .select }
docker compose restart lb
```

## Scale Up at Runtime

Add replicas without rebuilding images:

``` { .bash .copy .select }
docker compose up -d --scale gateway=5
```

After scaling, reload Nginx so it re-queries Docker DNS and picks up the new replica IPs:

``` { .bash .copy .select }
docker compose exec lb nginx -s reload
```

Confirm the new replica count:

``` { .bash .copy .select }
docker compose ps gateway
```

## Scale Down

``` { .bash .copy .select }
docker compose up -d --scale gateway=1
```

Nginx automatically stops routing to containers that are no longer running after the next reload.

## When a replica stops { #replica-stops }

The lab's `nginx.conf` sets no `max_fails` nor `fail_timeout`, so Nginx uses its defaults: **one** failed attempt (`max_fails=1`) takes a replica out of the pool for **10 s** (`fail_timeout=10s`), and the default `proxy_next_upstream error timeout` passes the failed request to the next replica. Nginx learns about the failure from real requests — a **passive** health check. Stop one replica and run the loop again:

``` { .bash .copy .select }
docker stop store-gateway-2
for i in {1..9}; do curl -s http://localhost:8080/health-check; echo; done
docker compose logs lb --tail 6
```

``` mermaid-sim
sequenceDiagram
    participant C as curl
    participant N as lb, Nginx
    participant G2 as gateway-2, stopped
    participant G3 as gateway-3
    C->>N: GET /health-check
    N-xG2: connect, 113 Host is unreachable
    Note over N,G2: 1 fail reaches max_fails=1, gateway-2 is off for fail_timeout=10s
    N->>G3: proxy_next_upstream, the same request
    G3-->>N: 200
    N-->>C: 200, hostname of gateway-3
    Note over C,G3: the next requests skip gateway-2 until the 10 s are over
```

All nine requests answer, but the one that met `gateway-2` waits until the connection fails, and the lb's log shows `connect() failed (113: Host is unreachable)` and `upstream server temporarily disabled`. After the 10 s, Nginx tries `gateway-2` again with one real request; `docker start store-gateway-2` brings it back with the same IP and it rejoins the rotation.

| Situation | What the client sees |
|---|---|
| 3 replicas, one stopped | ✅ every request answered; ⚠️ one slow request every 10 s while it is down |
| 1 replica (`replicas: 1`), stopped | ❌ `502 Bad Gateway`: no other replica to pass the request to |
| replicas added, no reload | ⚠️ the new ones get no traffic |
| replicas removed, no reload | ⚠️ answers still come, but slower, and the lb's log fills with failed attempts |

Nginx keeps the turn and the failure counts per worker process; with `worker_processes auto` there are several, so the real order of the hostnames may differ a little from a strict cycle.

<div class="csim" data-sim="nginx-upstream" data-script="failure"></div>

!!! tip "Try it"

    Before Docker, the same stack in the browser: lb (Nginx) on host port 8080, three gateway replicas and the lab's `nginx.conf`. Play or → runs the page's commands; the buttons work at any time. The loop gets 3 answers from each replica. After `--scale gateway=5` it gets still 3 hostnames until `nginx -s reload`, then 5. In **A replica stops**, `docker stop store-gateway-2`: the client still gets 9 answers, with 1 failed attempt in the lb's log and a loop of 3.4 s instead of 0.5 s; Nginx then skips that replica for 10 s. In **One replica**, the same stop gives 502 Bad Gateway: there is no other replica to pass the request to.

---

Done! Nginx now distributes all external traffic across multiple gateway replicas. If one replica stops, Nginx passes its requests to the healthy instances and skips it for a while — with more than one replica, the failure is transparent to clients.
