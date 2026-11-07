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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

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

## Before you measure: a hypothesis

<div class="flow">
<div class="box muted">playground <code>monolith</code><small>breakpoint profile: which box turns red first?</small></div><div class="arrow">→</div>
<div class="box accent">preset <code>boxoffice-pool</code><small>catalog + pool of 10 under a ramp</small></div><div class="arrow">→</div>
<div class="box orange">your prediction<small>"breaks at ___ req/s because ___ saturates"</small></div><div class="arrow">→</div>
<div class="box green">the lab<small>sweep, gauges, docker stats</small></div>
</div>

- The playground models the catalog's CPU (800 req/s) and the pool as the only limits: it predicts that **30 connections** move the knee past 600 req/s.
- Write it down. Step 6 tests the prediction on the real service.

<!--
A model is a hypothesis. The deliverable has a "hypothesis check" line: right or wrong, and why.
-->

---

## Closed vs open workload

| | Closed (`vus`: virtual users, VUs) | Open (`*-arrival-rate`) |
|---|---|---|
| You set | concurrent users | requests per second |
| Server slows down | k6 sends **less** | k6 keeps the rate and starts more VUs |
| Overload | ⚠️ hidden | ✅ latency + `dropped_iterations` |

<div class="warn">

**Coordinated omission**: a closed tester skips exactly the requests that would have suffered most.

</div>

---

## The test family

| Test | Question |
|---|---|
| smoke | does it work, how fast with 1 user? |
| load | at X req/s, what are the percentiles p50, p95, p99 (median, 95th, 99th)? |
| sweep | where is the knee? |
| stress | what happens past it — and does it recover? |

```bash
k6 run -e RATE=200 -e DURATION=1m load/load.js
```

---

## Gauges from the inside

<div class="flow">
<div class="box muted">k6<small>open model, RATE req/s</small></div><div class="arrow">→</div>
<div class="box accent">Tomcat threads<small><code>tomcat.threads.busy</code> · max 200</small></div><div class="arrow">wait →</div>
<div class="box orange">Hikari pool<small><code>connections.pending</code> waiting · <code>active</code> ≤ <b>10</b></small></div><div class="arrow">→</div>
<div class="box green">PostgreSQL<small>its CPU in <code>docker stats</code></small></div>
</div>

- A thread holds a connection only during its transaction: busy ≥ active + pending.
- `pending` > 0 means threads are waiting for a connection, not short of work.

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

- One minute per rate, **warm-up first** (a cold Java virtual machine, JVM, spoils the first point), 10 s of pause between steps.
- One row per rate: throughput, p50, p95, p99, errors, dropped.

---

## An example knee (1 central processing unit, CPU; pool of 10)

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

- Response ≈ `S / (1 − ρ)`, so the wait ≈ `ρ / (1 − ρ) × S`.
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

* 300 req/s × 10 ms = **3** requests inside → `tomcat.threads.busy` ≈ 3.
* The pool is a server with **10** slots: it saturates when λ × (database time per request) = 10.
* ~8 ms per request without load → 1,250 req/s. The knee is far lower: under load each query gets slower and holds its connection longer.
* At the knee: `db_active = 10`, `db_pending` grows → **the queue is at the pool**.

<div class="q">

200 busy threads, 10 active connections, 190 pending. More Tomcat threads would…?

</div>

---

## Move the bottleneck

```bash
DB_POOL_SIZE=30 docker compose up -d catalog
OUT=results/lab2-pool30 bash scripts/sweep.sh 50 100 200 300 400 500 600
```

<div class="cols">
<div class="box green">the knee moves <b>up</b><small>the pool was the narrowest pipe — until the next resource saturates: the catalog's CPU or PostgreSQL</small></div>
<div class="box red">the knee <b>barely moves</b><small><code>db</code> at its CPU limit in <code>docker stats</code>: the pool was only where the queue showed</small></div>
</div>

- Either result answers the question: the evidence is **which resource is full**. Compare with your playground prediction.
- Bigger pools cost database processes: 3 services × 3 replicas × 30 > `max_connections`.

---

## Stress: past the knee and back

```bash
K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=results/lab2-stress.html \
  k6 run -e PEAK=600 load/stress.js
```

<div class="flow">
<div class="box accent">1 · the knee<small>on the way up, p95 leaves the floor</small></div><div class="arrow">→</div>
<div class="box red">2 · the peak (600 req/s)<small>VUs climb towards <code>maxVUs</code>: Little's Law on the client</small></div><div class="arrow">→</div>
<div class="box green">3 · the recovery<small>after the drop to 25%: seconds? never?</small></div>
</div>

<p class="small">A service that recovers by itself is <b>stable</b>; one that stays slow needs load shedding (labs 3 and 9).</p>

---

## Without Docker: the twin

A model of the lab's stack (200 threads, the pool, 1 CPU, PostgreSQL with 7 cores) replays steps 1, 4, 6 and 7 with the page's k6 commands.

| Step | What the twin shows |
|---|---|
| 4 · sweep | p99 flat to 300 req/s, 159 ms at 400, a wall at 500: 463 req/s, 1,688 dropped |
| 6 · pool of 30 | the knee does not move; details faster, listings slower; `db` at 700% |
| 1 · closed vs open | 50 VUs: p99 266 ms, "all fine"; open at 500 req/s: 1,336 ms |
| 7 · stress | back under 300 ms 8 s after the drop |

<p class="small">Service times chosen to match the shape of the page's run — not measured. Your laptop decides which case of step 6 you get.</p>

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
4. The queue shows **where** requests wait (here: the pool); `docker stats` shows **which resource is full**.
5. Fixing one bottleneck **moves** it; measure again after every change.
