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

`catalog` saturates at ~400 req/s and a deploy takes it down. What fixes both at once?

</div>

- **Capacity**: more identical copies share the load.
- **Availability**: one copy fails, the others keep serving.
- Precondition: the service is **stateless**.

---

## The topology

```text
k6 ──► edge :80 (Nginx) ──► catalog-1 ┐
                         ├─► catalog-2 ├──► db
                         └─► catalog-3 ┘
```

- Only the edge publishes a port; replicas are private.
- `X-Instance` header: which replica answered.

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
- `resolve`: start even if a replica is down; pick it up when it returns.

---

## Timeouts and retries

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
| `stop` | connection refused → instant retry | ~nothing |
| `pause` | no answer for 5 s → retry | p99 ≈ **5 s** |
| 3 failures | out of rotation for 10 s | normal again |

<div class="warn">

A **dead** replica is easy. A **slow** one is dangerous: the timeout decides its cost.

</div>

---

## Passive vs active health checks

- **Passive** (open-source Nginx): learn from failed real requests.
- **Active** (Envoy, HAProxy, cloud LBs, Kubernetes readiness): probe `/actuator/health/readiness`.
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

---

## Who is the client?

- A header chosen by the client can be **rotated** by an attacker.
- Real limits: verified identities (issued API keys, JWT `sub`) **plus** per-IP for anonymous traffic.
- Per-IP misfires behind NAT — and throttles our single-IP k6.

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
