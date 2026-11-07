---
marp: true
lang: en
title: Lab 3 — Edge
description: System Architecture · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">System Architecture · Insper · Lab 3</div>

# Lab 3 — Edge

**Nginx as reverse proxy, load balancer and rate limiter over three `catalog` replicas**

<!--
Outline: (1) why scale out; (2) the topology; (3) replicas in Compose; (4) nginx.conf; (5) distribution;
(6) failures: stop vs pause; (7) rate limiting; (8) measuring scale-out efficiency.
-->

---

## One replica is two problems

<div class="q">

`catalog` leaves its latency target at a few hundred req/s (the knee of lab 2), and a deploy takes it down. What fixes both at once?

</div>

- **Capacity**: more identical copies share the load.
- **Availability**: one copy fails, the others keep serving.
- Precondition: the service is **stateless**.

---

## The topology

<div class="flow">
<div class="box muted" style="flex: .6">k6 / fans</div><div class="arrow">:80 →</div>
<div class="box accent">edge<small>Nginx 1.30 · the only published port</small></div><div class="arrow">round robin →</div>
<div class="group"><div class="caption">Compose network · no <code>ports:</code></div><div class="box">catalog-1<small>1 CPU</small></div><div class="box">catalog-2<small>1 CPU</small></div><div class="box">catalog-3<small>1 CPU</small></div></div><div class="arrow">→</div>
<div class="box green" style="flex: .7">db<small>PostgreSQL, shared</small></div>
</div>

- The replicas are private, like instances in a cloud VPC's private subnet (class 12).
- `X-Instance` header: which replica answered. Only code change of the lab.

---

## Three replicas with one anchor

```yaml
x-catalog: &catalog
  build: ./services/catalog
  image: boxoffice-catalog
  deploy: { resources: { limits: { cpus: "1.0", memory: 768M } } }

services:
  catalog-1: { <<: *catalog, hostname: catalog-1 }
  catalog-2: { <<: *catalog, hostname: catalog-2 }
  catalog-3: { <<: *catalog, hostname: catalog-3 }
```

---

## The upstream

```nginx
upstream catalog {
    zone catalog 64k;
    server catalog-1:8082 resolve max_fails=3 fail_timeout=10s;
    server catalog-2:8082 resolve max_fails=3 fail_timeout=10s;
    server catalog-3:8082 resolve max_fails=3 fail_timeout=10s;
    keepalive 64;
}
```

- Round robin by default; `least_conn` one line away.
- `resolve`: re-resolve the names through Docker's Domain Name System (DNS) every 10 s — start even if a replica is down, pick it up when it returns.

---

## Timeouts and retries

<div class="flow">
<div class="box">GET</div><div class="arrow">→</div>
<div class="box red">catalog-3 frozen<small>connect 1 s · read 5 s on a kept-alive connection</small></div><div class="arrow">timeout →</div>
<div class="box accent">next upstream<small>second and last try</small></div><div class="arrow">→</div>
<div class="box green">catalog-1: 200<small>about 1 s late, no error</small></div>
</div>

```nginx
proxy_connect_timeout  1s;
proxy_read_timeout     5s;
proxy_next_upstream    error timeout http_502 http_503 http_504;
proxy_next_upstream_tries  2;
```

- Failed GET → retried on another replica.
- POST is **not** retried by default: it may not be idempotent.

---

## Dead vs frozen

| Failure | Nginx sees | Client sees |
|---|---|---|
| `stop` | refused → instant retry; then the name stops resolving | ✅ ~nothing |
| `pause` | no answer: 1 s (new connection) or 5 s (kept-alive) → retry | ⚠️ no errors, a 99th-percentile latency (p99) of ~1–5 s |
| 3 failures in 10 s | out of rotation for 10 s, then one trial request | normal again |

<div class="warn">

A **dead** replica is easy. A **slow** one is dangerous: the timeout decides its cost.

</div>

---

## Passive vs active health checks

- **Passive** (open-source Nginx): learn from failed real requests.
- **Active** (Envoy, HAProxy, cloud load balancers, Kubernetes readiness): probe `/actuator/health/readiness`.
- Readiness ≠ liveness: *can serve* vs *is alive*.

<div class="q">

Why not `proxy_read_timeout 100ms` to catch frozen replicas instantly?

</div>

---

## Rate limiting at the edge

```nginx
limit_req_zone  $http_x_api_key  zone=per_key:10m  rate=20r/s;
limit_req  zone=per_key  burst=40  nodelay;
limit_req_status  429;
```

| Client | Sent (30 s) | 200 | 429 |
|---|---|---|---|
| greedy, 50 req/s | 1,500 | ~640 | ~860 |
| polite, 10 req/s | 300 | 300 | 0 |

<div class="flow">
<div class="box">request</div><div class="arrow">→</div>
<div class="box muted">no <code>X-Api-Key</code>?<small>empty key: not limited</small></div><div class="arrow">else →</div>
<div class="box accent">excess within burst=40?<small>drains at 20/s</small></div><div class="arrow">→</div>
<div class="box green">proxy</div><div class="box red">429</div>
</div>

---

## Who is the client?

- A header chosen by the client can be **rotated** by an attacker.
- Real limits: verified identities (issued API keys, the `sub` of a JSON Web Token, JWT — lab 4) **plus** per-IP for anonymous traffic.
- Per-IP misfires behind network address translation (NAT) — and throttles our single-IP k6.

---

## Without Docker: the twin

<div class="flow">
<div class="box accent">4 · spread<small>9 curls: 3 per replica · access log with rt and ut</small></div>
<div class="box red">5 · stop and freeze<small>stop: no slow request · pause: 58 wait 1 or 5 s · 0 errors, max 5.02 s</small></div>
<div class="box orange">6 · rate limit<small>greedy 640 × 200, 860 × 429 · polite 300 × 200</small></div>
</div>

- The lab's `nginx.conf`, request by request: round robin, `max_fails`, the two timeouts, the retry, `limit_req`.
- The twin's p99 stays at 29 ms: 58 slow requests out of 18,000 are fewer than 1%. The page's run caught more, and its p99 reached 1 s.
- After `fail_timeout`, Nginx lets **one** trial request through every 10 s.

<!--
The simulator sits in step 5 of the lab page; each script replays one step of the page.
-->

---

## Measure it: 1 vs 3 replicas, two workloads

| Workload | Bottleneck | 3 replicas give |
|---|---|---|
| details only (`LIST_SHARE=0`) | replica CPU | close to 3× |
| lab 2 mix (20% listings) | **PostgreSQL** | little — or worse |

<div class="ok">

Scaling efficiency = capacity(3) / (3 × capacity(1)). Watch `docker stats`: who is at 100%?

</div>

---

## Why not 3×?

- Mix: `db` at ~670% CPU, each replica ~20% — the shared tier is saturated.
- More replicas = more concurrent heavy queries on the **same** database.
- Cold replicas + `max_fails` can cascade into `502 no live upstreams`: **warm up** first.

---

## Takeaways

1. Stateless services scale out behind a **load balancer**; state lives elsewhere.
2. The edge is the single public door: routing, balancing, limiting, request ids.
3. **Timeouts** turn slow replicas into retries; set them from measured latency.
4. Retry only **idempotent** requests.
5. Rate limits protect everyone from one client — key them on **verified** identity.
6. Scaling the stateless tier moves pressure to the **shared** stateful one.
