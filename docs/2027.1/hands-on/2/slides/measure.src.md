---
marp: true
lang: en
title: Lab 2 — Measure first
description: System Architecture · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">System Architecture · Insper · Lab 2</div>

# Lab 2 — Measure first

**Load, stress and sweep tests with k6: find the knee, check Little's Law, name the bottleneck**

<!--
Outline: (1) why measure before optimizing; (2) closed vs open models; (3) the scripts; (4) gauges from
inside; (5) the sweep and the knee; (6) Little's Law and the pool; (7) moving the bottleneck; (8) stress.
-->

---

## Measure before you scale

<div class="q">

`catalog` gets slow under load. Cache? Replica? Ten more servers? Which one — and how do you know?

</div>

- Guessing is how teams build a cache for a service limited by a pool of 10.
- Three questions: **how much** load, **where** it breaks, **why**.
- Tools: a load generator outside (k6), gauges inside (Actuator), `docker stats`.

---

## Closed vs open workload

| | Closed (`vus`) | Open (`*-arrival-rate`) |
|---|---|---|
| You set | concurrent users | requests per second |
| Server slows down | k6 sends **less** | k6 keeps the rate |
| Overload | hidden | latency + `dropped_iterations` |

<div class="warn">

**Coordinated omission**: a closed tester skips exactly the requests that would have suffered most.

</div>

---

## The test family

| Test | Question |
|---|---|
| smoke | does it work, how fast with 1 user? |
| load | at X req/s, what are p50/p95/p99? |
| sweep | where is the knee? |
| stress | what happens past it — and does it recover? |

```bash
k6 run -e RATE=200 -e DURATION=1m load/load.js
```

---

## Gauges from the inside

| Metric | Limit |
|---|---|
| `tomcat.threads.busy` | 200 threads |
| `hikaricp.connections.active` | pool = **10** |
| `hikaricp.connections.pending` | should be 0 |

```bash
bash scripts/watch-metrics.sh http://localhost:8082
```

<p class="small">Three terminals during every test: k6, watch-metrics, docker stats.</p>

---

## The sweep

```bash
bash scripts/sweep.sh 50 100 200 300 400 500 600
uv run scripts/summarize.py results/lab2/rate-*.json
```

- One minute per rate, **warm-up first**.
- One row per rate: throughput, p50, p95, p99, errors, dropped.

---

## An example knee (1 CPU, pool of 10)

| Offered | Served | p50 | p99 |
|---|---|---|---|
| 200 | 200 | 0.5 ms | 34 ms |
| 300 | 300 | 0.6 ms | 39 ms |
| 400 | 400 | 1.5 ms | 224 ms |
| 500 | 490 | 15 ms | **2,056 ms** |

<p class="small">One laptop, one run. Yours will differ — the shape will not.</p>

---

## Why latency explodes

<div class="cols">
<div>

- Waiting ≈ `S / (1 − ρ)`.
- ρ = 50% → wait ≈ 1×S.
- ρ = 90% → ≈ 9×S.
- ρ = 99% → ≈ 99×S.

</div>
<div>

<div class="ok">

**Capacity** = highest rate with p99 inside the target — not the highest throughput ever printed.

</div>

</div>
</div>

---

## Little's Law: L = λ × W

* 300 req/s × 20 ms = **6** requests inside → `tomcat.threads.busy` ≈ 6.
* The pool is a server with **10** slots: it saturates when λ × (DB time per request) = 10.
* At the knee: `db_active = 10`, `db_pending` grows → **the pool is the bottleneck**.

<div class="q">

200 busy threads, 10 active connections, 190 pending. More Tomcat threads would…?

</div>

---

## Move the bottleneck

```bash
DB_POOL_SIZE=30 docker compose up -d catalog
OUT=results/lab2-pool30 bash scripts/sweep.sh 50 100 200 300 400 500 600
```

- Knee moves **up** — until the next resource saturates (CPU, PostgreSQL).
- Bigger pools cost database processes: 3 services × 3 replicas × 30 > `max_connections`.

---

## Stress: past the knee and back

```bash
K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=results/lab2-stress.html \
  k6 run -e PEAK=600 load/stress.js
```

- Knee on the way up; VUs climb at the peak (Little's Law on the client).
- **Recovery** after the drop: seconds? never?

---

## Deliverable

- Two sweeps (pool 10, pool 30), knee and capacity of each.
- Little's Law table vs measured gauges.
- Stress report with knee, peak and recovery.
- One paragraph: **the bottleneck of `catalog` and the evidence**.

---

## Takeaways

1. Use an **open** model for public traffic; watch `dropped_iterations`.
2. The **knee**: flat latency, then explosion — capacity lives just below it.
3. **Little's Law** links throughput, latency and concurrency — check it with real gauges.
4. The bottleneck is the resource whose **queue grows** (here: the DB pool).
5. Fixing one bottleneck **moves** it; measure again after every change.
