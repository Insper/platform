---
marp: true
lang: en
title: Hands-on 7 — Load Balancer
description: Platforms, Microservices, DevOps and APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Platforms, Microservices, DevOps and APIs · Hands-on 7</div>

# Hands-on 7 — Load Balancer

**Put Nginx in front of the gateway and scale it horizontally**

<!--
Outline: (1) why one gateway is a bottleneck; (2) forward × reverse proxy; (3) L4 × L7, algorithms;
(4) nginx.conf; (5) compose: nginx + gateway replicas; (6) run, verify, scale at runtime.
-->

---

## One gateway for everything

<div class="q">

All external traffic enters through a **single gateway instance**. What happens under sustained load?

</div>

* One process, one thread pool, **no redundancy** — the gateway becomes the **bottleneck**.
* If it crashes, the **whole platform** is unreachable.
* The fix: run **several identical instances** and spread the requests — **horizontal scaling**.

<!--
Ask first. The load balancer is what makes "several identical instances" look like one service.
-->

---

## Forward × reverse proxy

<div class="cols">
<div>

### Forward proxy

Sits in front of **clients**. The server sees the proxy's address, not the client's.

Corporate firewalls, content filtering, VPN, Tor.

</div>
<div>

### Reverse proxy

Sits in front of **servers**. The client sees only the proxy, never the backends.

Load balancing, SSL termination, caching, rate limiting.

</div>
</div>

<div class="ok">

Here **Nginx is a reverse proxy**: the only component exposed, spreading traffic over gateway replicas that clients never see.

</div>

---

## Layer 4 × Layer 7

| | Layer 4 — Transport | Layer 7 — Application |
|---|---|---|
| Routes by | IP address and TCP/UDP port | URL path, headers, cookies, body |
| Inspects HTTP? | no — forwards byte streams | yes — can rewrite requests and responses |
| Speed | minimal overhead, extremely fast | slight overhead, negligible in most workloads |
| Enables | any TCP/UDP protocol | sticky sessions, A/B, path-based routing |
| Examples | AWS NLB, HAProxy TCP mode | **Nginx**, Traefik, AWS ALB |

---

## Load balancing algorithms

| Algorithm | Behaviour | Best for |
|---|---|---|
| **Round Robin** | one per server, in order | uniform workloads, equal replicas |
| **Least Connections** | server with fewest active connections | long-lived or variable requests |
| **IP Hash** | client IP picks the server | session affinity (stateful apps) |
| **Weighted Round Robin** | share proportional to a weight | mixed-capacity servers |
| **Random** | server chosen at random | very large clusters |

---

## Architecture

<div class="cols">
<div>

### Before

internet → `:8080` **gateway** → `auth`, `account` → database

The gateway is exposed directly.

</div>
<div>

### After

internet → `:8080` **lb** (Nginx `:80`) → gateway ×3 → `auth`, `account` → database

Only Nginx is reachable from outside the Docker network.

</div>
</div>

Steps: **1** `nginx.conf` → **2** `compose.yaml` (`lb` + gateway replicas) → **3** run and verify.

---

## 1 · `setup/nginx.conf`

```nginx
http {
    upstream gateways {
        server gateway:8080;
    }
    server {
        listen 80;
        location / {
            proxy_pass         http://gateways;
            proxy_set_header   X-Real-IP $remote_addr;
            proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        }
    }
}
```

<p class="small">Excerpt; the file also sets <code>Host</code> and <code>X-Forwarded-Proto</code>, plus <code>events { worker_connections 1024; }</code>.</p>

---

## Key directives

| Directive | Purpose |
|---|---|
| `upstream gateways` | the pool of backends; Docker DNS expands `gateway:8080` to **all replica IPs** |
| _(no algorithm line)_ | default **Round Robin**; `least_conn;` would send the next request → fewest active connections |
| `proxy_pass` | forwards the request to the upstream pool |
| `X-Real-IP` | original client IP for the backend |
| `X-Forwarded-For` | appends the client IP to the forwarding chain (logs, audit) |
| `X-Forwarded-Proto` | whether the original request was HTTP or HTTPS |

<p class="small">Algorithm inside <code>upstream</code>: none = Round Robin · <code>least_conn;</code> · <code>ip_hash;</code> · <code>random;</code> · <code>server gateway:8080 weight=3;</code></p>

---

<!-- _class: tight -->

## 2 · Docker Compose

<div class="cols">
<div>

```yaml
  lb:
    image: nginx:latest
    ports:
      - "8080:80"
    volumes:
      - ./setup/nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - gateway
```

</div>
<div>

```yaml
  gateway:
    build:
      context: ./gateway-service
      dockerfile: Dockerfile
    # ports removed
    deploy:
      replicas: 3
```

</div>
</div>

- The gateway has **no `ports`** — only reachable through `lb`. `depends_on`: Nginx must find `gateway` when it starts.
- Remove `hostname: gateway`: one hostname cannot go to several containers. The service name `gateway` still resolves.

<p class="small">Host port 8080 → Nginx (80): clients keep calling <code>http://localhost:8080</code>. The repository keeps <code>replicas: 1</code>; use 3 to see the balancing.</p>

---

## How Nginx finds the replicas

1. Compose starts **3 replicas** of `gateway`.
2. Docker's internal DNS resolves the name `gateway` to **every replica IP**.
3. Nginx queries that record **once, at startup**, and builds the upstream pool.

<div class="warn">

Replicas added later are **invisible** to Nginx until it re-resolves the name:
`docker compose exec lb nginx -s reload`

</div>

---

## 3 · Run and verify

```bash
docker compose up -d --build
docker compose ps -a        # lb + gateway-1, -2, -3, no ports on the gateways
for i in {1..9}; do curl -s http://localhost:8080/health-check; echo; done
docker compose logs gateway --tail 30
```

- `/health-check` answers the replica's hostname: the output cycles through the three gateways.
- All requests on one replica? Nginx started **before** the replicas were ready → `docker compose restart lb`.

---

## Scale at runtime

```bash
docker compose up -d --scale gateway=5     # add replicas, no rebuild
docker compose exec lb nginx -s reload     # re-query Docker DNS
docker compose ps gateway                  # confirm the count
docker compose up -d --scale gateway=1     # scale down
```

<div class="ok">

If one replica crashes, Docker restarts it and Nginx keeps routing to the healthy ones: the failure is **transparent to clients**.

</div>

---

## Takeaways

1. A single gateway is a **bottleneck** and a single point of failure; replicas fix both.
2. Nginx works as a **reverse proxy**: the only exposed component, hiding the backends.
3. **L4** routes by IP and port; **L7** (Nginx) understands HTTP and can route by path, header or cookie.
4. The algorithm lives in the `upstream` block: Round Robin by default, or `least_conn;`, `ip_hash;`, `random;`.
5. Docker DNS turns `gateway:8080` into **all replica IPs** — but Nginx resolves it only **at startup**.
6. After scaling, **reload Nginx** (`nginx -s reload`) so it sees the new replicas.
