!!! abstract "In this lab"

    - Run **three replicas** of `catalog` and put **Nginx** in front of them as the BoxOffice **edge**: reverse proxy, load balancer, rate limiter.
    - Watch the load spread across replicas, kill and freeze replicas, and see what **passive health checks**, **timeouts** and **retries** do.
    - Limit a greedy API client with **rate limiting** (HTTP 429).
    - **Measure** scale-out: throughput and p99 with 1 replica versus 3. Is it 3× better?

In lab 2 you found the knee of a single `catalog` instance. The simplest way to move it is **horizontal scaling**: more identical, *stateless* copies of the service behind a load balancer. The same box also solves a second problem — with one instance, a crash or a deploy takes BoxOffice down. With three, one can fail while the others keep serving. This lab builds the **edge** of the system: the single public entry point that every request crosses first.

## Before you start { #before-you-start }

| | |
|---|---|
| **Time** | 2–3 hours |
| **You need** | the tools of lab 0; Docker with at least **6 GB** (three JVMs + PostgreSQL + Nginx); **port 80 free** on your machine |
| **Directory** | every command runs from the root of your `boxoffice/` repository (Windows: inside WSL 2) |

``` { .bash .copy }
docker compose version        # Docker Compose v2.x (or newer)
java -version                 # 21 or newer
mvn -v                        # Apache Maven 3.9+
k6 version                    # k6 v1.0+
uv --version                  # uv (runs the Python helper scripts)
```

**Start state** — the end of lab 2:

``` { .tree title="boxoffice/ at the start of lab 3" }
boxoffice/
    docker-compose.yaml        # db + catalog
    load/  hello.js smoke.js load.js stress.js
    results/  lab0.md lab1.md lab2.md lab2/ ...
    scripts/  check-env.sh sweep.sh summarize.py watch-metrics.sh
    services/catalog/
```

!!! tip "Catch up"

    Skipped or broke lab 2? Download [boxoffice-after-lab-2.zip](../2/boxoffice-after-lab-2.zip), unzip it and `cd boxoffice`. This lab **adds** `InstanceHeaderFilter.java` and `infra/nginx/nginx.conf` and **replaces** `docker-compose.yaml`; all three are shown in full below and are in [`code/`](code/docker-compose.yaml).

## Slides

<div class="slides-embed">
  <iframe src="slides/edge.html" title="Slides: hands-on 3 — edge" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/edge.html){:target="_blank"}

!!! info "Theory connection"

    - Class 4, [Traffic & edge](../../classes/edge/index.md): [load balancing](../../classes/edge/load-balancing/index.md) (L4 vs L7, algorithms, health checks) and [API gateway](../../classes/edge/api-gateway/index.md) (rate-limiting algorithms).
    - Class 5, [Compute](../../classes/compute/services/index.md): why only **stateless** services scale out this easily.
    - Component catalog: [Load Balancer](../../reference/components/edge/index.md#lb).

## Before you measure: the playground

**Try it:** the `scale-out` scenario has a load balancer in front of app replicas. Run it with the default replicas, then change the number of app servers (1 → 2 → 4) and compare throughput and p99. Finally, kill one replica while the load runs: how long until the balancer stops sending it traffic? Note your predictions for the real system — does 3× the replicas give 3× the throughput?

<div class="sdp" data-scenario="scale-out" data-mode="compact" data-height="500"></div>

## What you will build

``` mermaid-sim
flowchart LR
    k6([k6 / fans]) -->|":80"| edge["edge<br/>Nginx 1.30"]
    edge -->|round robin| c1["catalog-1<br/>1 CPU"]
    edge --> c2["catalog-2<br/>1 CPU"]
    edge --> c3["catalog-3<br/>1 CPU"]
    c1 --> db[("db<br/>PostgreSQL")]
    c2 --> db
    c3 --> db
```

Only the edge publishes a port (80). The replicas are reachable only inside the Compose network — the same shape as a public load balancer in front of private instances in a cloud VPC (class 11).

## 1. Make the replicas visible

When three replicas answer, you want to know **which one** answered. Add this filter to `catalog`; it stamps every response with the container's hostname:

``` { .java title="services/catalog/src/main/java/boxoffice/catalog/InstanceHeaderFilter.java" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/3/code/services/catalog/src/main/java/boxoffice/catalog/InstanceHeaderFilter.java"
```

That is the only code change in this lab. Everything else is configuration — a good sign: a stateless service scales out without touching its code.

## 2. Three replicas in Compose

Replace your `docker-compose.yaml`. The `x-catalog` block is a **YAML anchor**: one definition, reused by `catalog-1`, `catalog-2` and `catalog-3`; each only adds its own `hostname`.

``` { .yaml title="docker-compose.yaml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/3/code/docker-compose.yaml"
```

| Change | Why |
|---|---|
| `catalog` → `catalog-1..3` | explicit replicas: you can stop, pause or inspect **one** of them by name |
| no `ports:` on the replicas | they are private; the only door is the edge |
| same `image: boxoffice-catalog` | built once, started three times |
| `edge` publishes `80:80` | from now on `BASE_URL=http://localhost` |

!!! warning "Three replicas, one database"

    The three replicas share `db`, and each has its own pool of 10 connections: 30 connections in total. Scaling the stateless tier multiplies the load on the stateful one. Keep `docker stats` open: if `db` reaches 100% CPU, adding replicas will not help — that is lab 6's problem.

## 3. The edge: `nginx.conf`

Nginx[^1] reads one configuration file. Every directive below appears in it, in the same order.

``` { .nginx title="infra/nginx/nginx.conf" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/3/code/infra/nginx/nginx.conf"
```

| Directive | What it does |
|---|---|
| `upstream catalog { server ...; }` | the pool of replicas; the default algorithm is **round robin** |
| `resolve` + `resolver 127.0.0.11` + `zone` | Nginx re-resolves the names through Docker's DNS: it starts even if a replica is down and picks it up when it comes back (open-source Nginx ≥ 1.27.3) |
| `max_fails=3 fail_timeout=10s` | **passive health check**: 3 failures in 10 s take the replica out of rotation for 10 s |
| `keepalive 64` + `proxy_http_version 1.1` + `Connection ""` | reuse TCP connections to the replicas instead of opening one per request |
| `proxy_next_upstream error timeout http_502 http_503 http_504` | if a replica fails, **retry the request on another one** (only for idempotent methods such as GET) |
| `proxy_connect_timeout 1s`, `proxy_read_timeout 5s` | how long to wait before declaring a replica failed |
| `X-Request-Id $request_id` | a unique id per request, sent to the replica and back to the client: the first step towards tracing (lab 8) |
| `limit_req_zone $http_x_api_key ... rate=20r/s` | token-bucket-like **rate limiting** per API key (step 6) |
| `location / { return 404; }` | only `/catalog/` is public; `/actuator` is not reachable from outside |

## 4. Run it and watch the distribution

``` { .bash .copy }
docker compose up --build -d --remove-orphans   # removes the old single 'catalog' container of lab 1
docker compose ps                       # catalog-1..3 healthy, edge running
curl -s localhost/healthz               # the edge itself
for i in $(seq 1 9); do curl -s -o /dev/null -D - localhost/catalog/events/1 | grep -i x-instance; done | sort | uniq -c
```

<!-- termynal -->
``` shell
> for i in $(seq 1 9); do curl -s -o /dev/null -D - localhost/catalog/events/1 | grep -i x-instance; done | sort | uniq -c
   3 X-Instance: catalog-1
   3 X-Instance: catalog-2
   3 X-Instance: catalog-3
> docker compose logs edge --tail 3
edge-1  | 172.18.0.1 "GET /catalog/events/1 HTTP/1.1" 200 rt=0.004 upstream=172.18.0.4:8082 ut=0.004 id=6f1c0d8e2b...
edge-1  | 172.18.0.1 "GET /catalog/events/1 HTTP/1.1" 200 rt=0.003 upstream=172.18.0.5:8082 ut=0.003 id=0a77c4f9e1...
edge-1  | 172.18.0.1 "GET /catalog/events/1 HTTP/1.1" 200 rt=0.003 upstream=172.18.0.3:8082 ut=0.003 id=d93b5e2a7c...
```

Round robin: each replica gets one request in three. Compare `rt` (total time at the edge) with `ut` (time spent in the replica): the difference is the cost of the extra hop.

!!! tip "Round robin or least connections?"

    Round robin ignores how busy each replica is. Uncomment `least_conn;` in the upstream, run `docker compose exec edge nginx -s reload`, and repeat the measurement of step 7: with a mix of fast (detail) and slow (list) requests, `least_conn` usually trims the tail because a replica stuck with slow requests receives fewer new ones.

## 5. Failures: stop, freeze, recover

Run a steady load in one terminal and break things in another:

``` { .bash .copy }
# terminal 1: 2 minutes at 150 req/s through the edge
BASE_URL=http://localhost k6 run -e RATE=150 -e DURATION=2m load/load.js

# terminal 2, while it runs:
docker compose stop catalog-2          # a crash: connections are refused immediately
sleep 20
docker compose start catalog-2         # it comes back (startup takes ~10 s)
sleep 30
docker compose pause catalog-3         # a freeze (GC pause, stuck disk): connections hang
sleep 20
docker compose unpause catalog-3
```

What to look for in the k6 summary and in `docker compose logs edge`:

| Failure | What Nginx sees | What the client sees |
|---|---|---|
| **stop** (process dead) | `connect() failed (111: Connection refused)` → immediate retry on another replica | almost nothing: a few extra milliseconds |
| **pause** (process frozen) | the connection opens but no answer: it waits `proxy_read_timeout` (5 s), then retries | a burst of requests that take **~5 s** — p99 explodes, but no errors |
| **after 3 failures** | `max_fails` reached → replica out of rotation for `fail_timeout` (10 s) | latency back to normal |

You should see something like this at the end of the k6 run (a run for this lab: not a single error, but the pause shows up in the tail):

``` { .text }
    http_req_duration..............: avg=48.31ms med=1.33ms p(95)=25.56ms p(99)=1s       max=5.05s
    http_req_failed................: 0.00%  0 out of 14990
```

The lesson: a **dead** replica is easy; a **slow** one is dangerous. Timeouts decide how much a slow replica costs you. Nginx open source only has *passive* checks[^2] (it learns from failed real requests); active checks — probing `/actuator/health/readiness` every few seconds — exist in Nginx Plus, HAProxy, Envoy, cloud load balancers and Kubernetes readiness probes (lab 10).

??? question "Think first: why not set `proxy_read_timeout 100ms`, so frozen replicas are detected immediately?"

    Because some legitimate requests are slow: a listing under load takes hundreds of milliseconds. A timeout shorter than the real p99 turns slow responses into failures and *retries* — which add load exactly when the system is struggling (a retry storm, class 9). Timeouts must be set from **measured** latency: a bit above the p99.9 of the healthy service.

## 6. Rate limiting

A partner integration that polls `catalog` 50 times per second can starve everybody else. The edge gives each **API key** 20 req/s with a burst of 40; above that, it answers `429 Too Many Requests` without bothering the replicas.

``` { .javascript title="load/ratelimit.js" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/3/code/load/ratelimit.js"
```

``` { .bash .copy }
k6 run load/ratelimit.js
```

You should see (from a run for this lab — 30 s at 50 and 10 req/s):

``` { .text }
    http_reqs{scenario:greedy,status:200}
    ✓ 'count>=0' count=640
    http_reqs{scenario:greedy,status:429}
    ✓ 'count>=0' count=843
    http_reqs{scenario:polite,status:200}
    ✓ 'count>=0' count=299
    http_reqs{scenario:polite,status:429}
    ✓ 'count>=0' count=0
```

Expected shape (counts vary): the `polite` client (10 req/s) gets only `200`s; the `greedy` one (50 req/s) gets about 20 `200`s per second and the rest `429`. Nginx implements a **leaky bucket**: requests drain at `rate`; `burst` is the size of the bucket; `nodelay` serves the burst immediately instead of spacing it out.

!!! warning "Who is the client?"

    The key here is a header the client chooses, so a malicious client could simply rotate keys. Real systems limit by an **authenticated** identity (API key issued and verified, user id from a JWT — lab 4) and also per IP for anonymous traffic. We do not limit by IP in the lab because every k6 request comes from the same address: the load tests would throttle themselves.

## 7. Measure it: does 3× the replicas give 3× the throughput? { #measure-it }

Use the sweep of lab 2, now through the edge, with **two different workloads** — the answer depends on which resource is the bottleneck:

- **Details only** (`LIST_SHARE=0`): primary-key lookups, cheap for PostgreSQL. The limit is the **CPU of each replica** (1 core).
- **The lab 2 mix** (`LIST_SHARE=0.2`): 20% listings, each scanning and sorting thousands of rows. The limit is **PostgreSQL**, which all replicas share.

First with **one** replica (stop the other two; Nginx removes them), then with **three**:

``` { .bash .copy }
# 1 replica behind the edge
docker compose stop catalog-2 catalog-3
LIST_SHARE=0 BASE_URL=http://localhost OUT=results/lab3-1replica-detail bash scripts/sweep.sh 300 600 900 1200 1500
BASE_URL=http://localhost OUT=results/lab3-1replica-mix bash scripts/sweep.sh 100 200 300 400 500

# 3 replicas behind the edge: start them and WARM THEM UP before measuring
docker compose start catalog-2 catalog-3 && sleep 30
BASE_URL=http://localhost k6 run -e RATE=300 -e DURATION=2m load/load.js > /dev/null
LIST_SHARE=0 BASE_URL=http://localhost OUT=results/lab3-3replicas-detail bash scripts/sweep.sh 600 1200 1800 2400 3000
BASE_URL=http://localhost OUT=results/lab3-3replicas-mix bash scripts/sweep.sh 100 200 300 400 500

for d in results/lab3-*; do echo "## $d"; uv run scripts/summarize.py $d/rate-*.json; done
```

Keep `docker stats` open during each run and note **which container is at its limit**: `catalog-*` near 100% (one core each) or `db` using several cores.

!!! warning "Cold replicas and passive health checks can cascade"

    A replica that has just started runs with a cold JVM and is several times slower than a warm one. Under heavy load it times out, Nginx marks it failed (`max_fails`), its share of the traffic moves to the others, *they* time out too, and the edge ends up answering `502 no live upstreams` — while the replicas are perfectly healthy. Always warm up new replicas before measuring; in production this is what **slow start** (gradually increasing a new instance's weight) and readiness probes that wait for warm-up are for.

Record in `results/lab3.md`:

``` { .markdown title="results/lab3.md" .copy }
# Lab 3 — scale-out behind the edge

## Sweeps
<the four tables from summarize.py: 1/3 replicas × detail/mix>

## Capacity (highest rate with p99 < 300 ms and no errors)
| Workload | Replicas | Capacity (req/s) | Container at its limit (docker stats) |
|---|---:|---:|---|
| details only | 1 | | |
| details only | 3 | | |
| lab 2 mix | 1 | | |
| lab 2 mix | 3 | | |

Scaling efficiency = capacity(3) / (3 × capacity(1)):
- details only: ____ %
- lab 2 mix: ____ %
- Why are they so different? ____

## Edge overhead
- p50 direct to catalog (lab 2, same rate): ____ ms; p50 through the edge: ____ ms

## Failures (step 5)
- stop catalog-2: errors ____, p99 ____ ms
- pause catalog-3: errors ____, p99 ____ ms; how long until Nginx stopped sending it traffic? ____ s

## Rate limiting (step 6)
| Client | Sent | 200 | 429 |
|---|---:|---:|---:|
| greedy (50 req/s) | | | |
| polite (10 req/s) | | | |
```

??? question "Think first: why can the efficiency be good for details and close to zero (or worse) for the mix?"

    With details only, each request costs mostly **replica CPU**, so three replicas bring three cores of the resource that was saturated: efficiency is high (below 100% because the edge, k6 and Docker share the same laptop). With the mix, the saturated resource is **PostgreSQL**: in a test run for this lab, `db` sat at ~670% CPU while each replica used ~20%. Three replicas only send *more concurrent* heavy queries to the same database — 30 pooled connections instead of 10 — and latency can even get worse. Scaling the stateless tier helps only when the stateless tier is the bottleneck; otherwise it moves the pressure to the shared, stateful tier. The [Universal Scalability Law](../../classes/estimation/queueing/index.md) models this: contention makes throughput grow slower than the number of nodes, or even fall. Labs 5 (cache) and 6 (indexes) attack the real bottleneck.

!!! note "If your numbers differ"

    The ratio matters more than the absolute values. Expect a large gain for the details-only workload (each replica brings its own core) and little or none for the mix (PostgreSQL is shared). If even details-only does not improve, look at `docker stats`: if the replicas are far from 100% CPU, something else is the limit — Docker's total CPUs, k6 itself, or another program on your machine. A laptop is one machine pretending to be several; production numbers would differ, the reasoning would not.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Bind for 0.0.0.0:80 failed: port is already allocated` (or `permission denied`) | another web server uses port 80, or your OS restricts ports < 1024 | stop it, or publish the edge on 8000 (`"8000:80"`) and use `BASE_URL=http://localhost:8000` everywhere |
| `Found orphan containers ([boxoffice-catalog-1])` | the single `catalog` service of lab 1 still exists | `docker compose up -d --remove-orphans` |
| all requests return `502 Bad Gateway` right after `up` | the replicas are still starting (≈20–40 s) | wait until `docker compose ps` shows the three replicas `healthy` |
| `no live upstreams` in `docker compose logs edge`, 502 under load | every replica was marked failed (timeouts under overload, often cold JVMs) | lower the load, warm up, check `max_fails`/`proxy_read_timeout`; see the warning in step 7 |
| `nginx: [emerg] ... in /etc/nginx/nginx.conf:NN` | typo in the configuration | `docker compose exec edge nginx -t` shows the line; fix it and `docker compose exec edge nginx -s reload` (or `docker compose restart edge`) |
| `X-Instance` is missing | the catalog image was not rebuilt with the new filter | `docker compose up --build -d` |
| the rate-limit test shows no `429` | k6 did not send `X-Api-Key`, or the old `nginx.conf` is mounted | check the file content inside the container: `docker compose exec edge cat /etc/nginx/nginx.conf` |

## Clean up

``` { .bash .copy }
docker compose start catalog-2 catalog-3     # if you left them stopped after the sweep
docker compose unpause catalog-3 2>/dev/null || true
docker compose down                          # when you are done (the database volume is kept)
```

Keep everything: lab 4 puts the gateway behind this edge.

## Deliverable

- [ ] `InstanceHeaderFilter`, the three-replica `docker-compose.yaml` and `infra/nginx/nginx.conf` in your repository.
- [ ] The distribution check (9 requests, 3 per replica) pasted in `results/lab3.md`.
- [ ] The failure experiment (stop and pause) described with numbers.
- [ ] The rate-limit table.
- [ ] Sweeps with 1 and 3 replicas for both workloads, capacities, **scaling efficiency** of each and the container at its limit.
- [ ] Repository tagged `lab3`; [quiz](quiz.md) answered.

## End state

``` { .tree title="changed in lab 3" }
boxoffice/
    docker-compose.yaml        # replaced: db, catalog-1..3 (no host ports), edge on port 80
    infra/nginx/nginx.conf     # new: reverse proxy, load balancer, rate limiter
    load/ratelimit.js          # new
    services/catalog/src/main/java/boxoffice/catalog/InstanceHeaderFilter.java   # new
    results/lab3.md  results/lab3-*/
```

From now on clients use `http://localhost` (the edge); the replicas are not reachable from your machine.

Next: [Lab 4 — Gateway & identity](../4/index.md).

[^1]: NGINX documentation, [HTTP Load Balancing](https://nginx.org/en/docs/http/load_balancing.html){target="_blank"}, [ngx_http_upstream_module](https://nginx.org/en/docs/http/ngx_http_upstream_module.html){target="_blank"} and [ngx_http_limit_req_module](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html){target="_blank"}.
[^2]: Betsy Beyer et al., *Site Reliability Engineering*, O'Reilly, 2016 — chapter 20, "Load Balancing in the Datacenter".
