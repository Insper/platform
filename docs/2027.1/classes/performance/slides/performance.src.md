---
marp: true
lang: en
title: Performance engineering and load testing
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

<div class="kicker">System Architecture · Insper</div>

# Performance engineering and load testing

**Strategies to test high-performance systems — and to believe the results**

<!--
Outline: (1) vocabulary, the curve and the knee; (2) methodology: workload model, USE/RED,
environments and data; (3) load testing: six test types, open vs closed, thresholds,
coordinated omission, chaos under load; (4) bottlenecks: profiling and the database;
(5) capacity planning and performance budgets in CI.
-->

---

## The test that said "all green"

<div class="q">

200 virtual users, p95 = 180 ms on staging. On the day, the on-sale fell over at 10:02. What went wrong?

</div>

* Staging had **a tenth of the data** — every query hit a warm cache.
* The virtual users (VUs) **waited for each response**: when the system slowed, the test slowed with it.
* Ten minutes never reached the point where the **connection pool** ran out.
* Nobody had written down what **"good enough"** meant.
* The report showed **averages**.

<!--
Collect guesses first. Each item maps to a part of the class: environment and data,
open vs closed model, test types, thresholds as SLOs, percentiles.
-->

---

## The vocabulary

| Term | Meaning |
|---|---|
| **Service time** S | time a resource actually works on a request |
| **Waiting time** | time queued for a busy resource |
| **Response time** R | waiting + service (+ network) — what users feel |
| **Throughput** X | completed requests per second |
| **Concurrency** N | requests in the system at once |
| **Utilization** U / **Saturation** | busy fraction / queued work |

- **Little's Law** `N = X × R` — 1 800 holds/s × 0.12 s = **216 in flight**.
- **Utilization law** `U = X × S`. Report **percentiles from histograms**, never averages of percentiles.

---

## Every system has a knee

- **Flat region**: latency ≈ service time.
- **Knee** (~70–80 % busy): queues form, **p99 bends first**.
- **Saturation**: throughput stops growing; timeouts become errors.
- **Retrograde** (Universal Scalability Law, USL): past the peak, *more* concurrency → *less* throughput.

<div class="ok">

Plan with the **knee** — the highest rate that still meets the service level objective (SLO) — not with the maximum.

</div>

<p class="small">Lab 2, <code>catalog</code> on 1 CPU with a pool of 10: p99 38.6 ms at 300 req/s, 223.7 ms at 400, 2,056 ms at 500 — the knee is between 300 and 400, and the pool saturated, not the CPU.</p>

<!--
Show the two plots of the overview page (M/M/8 latency vs load, USL throughput vs N).
Then run the monolith scenario with the breakpoint profile in the playground.
-->

---

## The performance-engineering loop

<div class="flow">
<div class="box accent">1 · objectives<small>SLOs per endpoint at the peak</small></div><div class="arrow">→</div>
<div class="box">2 · workload model<small>mix, arrivals, data, skew</small></div><div class="arrow">→</div>
<div class="box">3 · test<small>production-like environment</small></div><div class="arrow">→</div>
<div class="box orange">4 · analyze<small>curve, RED, USE, profiles</small></div><div class="arrow">→</div>
<div class="box green">5 · change ONE thing<small>then test again</small></div>
</div>

- **6 · Ship** with a budget in continuous integration (CI); production metrics feed the next workload model.
- Change one thing at a time — otherwise you cannot attribute the improvement.

<div class="warn">

"Fast" is not a requirement. "`POST /holds` p99 < 300 ms, errors < 0.1 % at 4 500 req/s" is.

</div>

---

## Anti-methods

| Anti-method | Looks like |
|---|---|
| **Streetlight** | look where the tools are easy (`top`), not where the problem is |
| **Random change** | tweak flags until it "feels faster" |
| **Blame someone else** | "it's the database" — without evidence |
| **Ad hoc checklist** | replay the last incident's checklist |

**Scientific method**: question → hypothesis → prediction → measurement → **one** change → re-measure.

---

<!-- _class: tight -->

## Workload model of the on-sale (illustrative)

| Endpoint | Share | Peak req/s | p99 SLO |
|---|---|---|---|
| `GET /events/{id}` | 35 % | 10 500 | 200 ms |
| `GET /events/{id}/seats` | 30 % | 9 000 | 300 ms |
| `GET /search` | 10 % | 3 000 | 400 ms |
| `POST /holds` | 15 % | 4 500 | 300 ms |
| `POST /orders` | 7 % | 2 100 | 800 ms |
| `GET /orders/{id}` | 3 % | 900 | 200 ms |

- Derived from **production access logs** of the last on-sale.
- Keep what tests usually lose: **skew** (one hot event, hot sections), **think time**, **synchronized arrivals** at 10:00:00.

---

## USE: follow the wait, resource by resource

<div class="flow">
<div class="box green">CPU<small>45 %, no throttling</small></div><div class="arrow">→</div>
<div class="box green">memory<small>garbage collection &lt; 2 %</small></div><div class="arrow">→</div>
<div class="box orange">Tomcat threads<small>200/200 — waiting on what?</small></div><div class="arrow">→</div>
<div class="box orange">Hikari pool<small>10/10, 180 pending</small></div><div class="arrow">→</div>
<div class="box red">PostgreSQL<small>CPU 35 % · Lock: tuple</small></div>
</div>

- **U**tilization, **S**aturation, **E**rrors for every resource — hardware *and* software (pools, locks, queues).
- Bottleneck: **row-lock contention**, made worse by long transactions.

<div class="q">

Of "add a cache, a bigger database, more pods, rewrite in Go", which one helps?

</div>

* None: a cache does not help writes, the database CPU is idle, more pods add waiters, Go waits on the same locks.

---

## RED + USE

<div class="cols">
<div>

### RED — per service

- **R**ate, **E**rrors, **D**uration
- which service is unhappy?
- becomes the **thresholds**

</div>
<div>

### USE — per resource

- **U**tilization, **S**aturation, **E**rrors
- which resource inside it is the cause?
- what you inspect when a threshold fails

</div>
</div>

---

## Make the test environment tell the truth

- **Parity**: same instance types, limits, pool sizes, Java virtual machine (JVM) flags, Transport Layer Security (TLS), gateway — from the same infrastructure as code.
- **Data**: production-sized, **skewed**, synthetic (no personal data); restore a snapshot before each run.
- **Dependencies**: mocks with **realistic latency** (payment ≈ 300 ms), not 1 ms.
- **Warm-up**: the just-in-time compiler, pools, caches — a separate scenario, excluded from thresholds; test **cold starts** on purpose.
- **Noise**: ≥ 3 runs; check the **load generator** (CPU, `dropped_iterations`).

---

<!-- _class: tight -->

## Six test types

| Type | Question | Shape |
|---|---|---|
| **Smoke** | does it work at all? | 1–2 VUs, 1 min |
| **Load** | SLOs at the expected peak? | ramp → plateau 20 min |
| **Stress** | graceful above the peak? recovers? | steps 1× → 1.5× → 2× → back |
| **Spike** | absorbs 10:00:00? autoscaling lag? | baseline → 1.5× in 30 s |
| **Soak** | leaks, slow growth? | average load, 4–24 h |
| **Breakpoint** | where is the knee? what breaks first? | ramp until thresholds abort |

<div class="ok">

Same user flows (`lib/boxoffice.js`), different **load shapes**.

</div>

---

## Open vs closed workload models

| Response time R | Closed: 200 VUs, Z = 1 s → `N/(R+Z)` | Open: 182 req/s |
|---|---|---|
| 0.1 s | 182 req/s | 182 req/s |
| 0.5 s | 133 req/s | 182 — ⚠️ queue grows |
| 2.0 s | **67 req/s** | 182 — 🔴 queue explodes |

- **Closed** (`constant-vus`, `ramping-vus`): fixed populations that wait for answers.
- **Open** (`constant-arrival-rate`, `ramping-arrival-rate`): internet users who do not.
- VUs needed ≈ **rate × iteration duration**; `dropped_iterations` must be **0**.

---

<!-- _class: tight -->

## A load test in k6

```javascript
const flow = (exec, share, iterSeconds) => ({
  executor: 'ramping-arrival-rate', exec, startRate: 0, timeUnit: '1s',
  preAllocatedVUs: Math.ceil(PEAK * share * iterSeconds),   // Little's Law
  maxVUs: Math.ceil(PEAK * share * iterSeconds * 3),
  stages: [ { target: PEAK * share, duration: '5m' },
            { target: PEAK * share, duration: '20m' },
            { target: 0, duration: '2m' } ],
});
export const options = {
  scenarios: { browse: flow('browse', 0.55, 0.2), hold: flow('hold', 0.20, 3.5) },
  thresholds: {
    'http_req_duration{name:POST /holds}': ['p(99)<300'],   // the SLO
    http_req_failed: ['rate<0.001'],
    dropped_iterations: ['count==0'],
  },
};
```

Name the URLs (`tags: { name }`), declare **409 = expected**, count **seats held**.

---

## Coordinated omission

<div class="flow">
<div class="box">closed loop<small>sends, waits for the answer</small></div><div class="arrow">server frozen 1.5 s →</div>
<div class="box red">1 slow sample<small>the other ~150 never sent</small></div><div class="arrow">→</div>
<div class="box green">p99 = 1 ms ✓</div>
</div>
<div class="flow">
<div class="box">open model<small>sends every 10 ms, regardless</small></div><div class="arrow">server frozen 1.5 s →</div>
<div class="box red">~150 slow samples<small>measured from the intended send</small></div><div class="arrow">→</div>
<div class="box red">p99 = 1.37 s ✗</div>
</div>

- Same server, four freezes a minute: the closed loop records **595 fewer** samples — exactly the slow ones.
- Fix: open-model generators (k6 arrival-rate, wrk2, vegeta, Gatling `injectOpen`), timeouts counted at full duration, client vs server percentiles.

---

## Simulator: two reports of the same minute

<div class="flow">
<div class="box">4 freezes of 1.5 s<small>closed p99 1.0 ms ✓ · open p99 1.37 s ✗</small></div><div class="arrow">→</div>
<div class="box orange">1 freeze of 0.5 s<small>0.8 % of the test: even the open p99 is 1.0 ms</small></div><div class="arrow">→</div>
<div class="box">8 freezes<small>closed p99.9 = 1.5 s, p99 still 1.0 ms</small></div>
</div>

- The load-testing page's **coordinated-omission** simulator: change the freezes, play the minute, compare samples and verdicts.
- A p99 sees only a tail wider than 1 % of the requests: short stalls need **p99.9 and max**.

<div class="warn">

However much the server freezes, the closed loop keeps omitting the requests that would have waited.

</div>

---

## Spike, soak, breakpoint — what to read

- **Spike**: errors during the jump, minutes back to SLO; compare **with and without pre-scaling**.
- **Soak**: trends, not totals — heap after garbage collection, connections, p99 in hour 8 vs hour 1.
- **Breakpoint**: `abortOnFail` thresholds stop it; output = **knee + first saturated resource**. Never in production.
- **Stress**: graceful = fast 429/503 + recovery; catastrophic = timeouts → retries → stays down.

---

## Load + chaos together

| Fault during the load test | Hypothesis |
|---|---|
| payment +3 s (Toxiproxy, xk6-disruptor) | breaker opens < 10 s; browsing and holds keep SLO |
| kill 1 of 3 `inventory` pods | < 1 % errors for < 30 s; self-recovers |
| Redis down 60 s | fallback to SQL; p99 < 1 s; no stampede on return |

<div class="ok">

Resilience patterns are only proven **at the peak**. Lab 9: `browse` p50 9.04 s unprotected, 6.5 ms with the patterns.

</div>

---

## Reading the curve and the symptoms

- Latency ↑ **and CPU ~100 %** → CPU-bound → CPU flame graph.
- Latency ↑ **and CPU low** → waiting: pool, lock, I/O, dependency → **wall-clock** profile, USE.
- Throughput **falls** past a point → contention, retries (retrograde).
- **Bimodal** histogram → two paths (cache hit/miss).
- Slow growth at constant load → **leak**.
- Client p99 ≫ server p99 → queueing **before** the service.

---

## Profiling: which code?

- **Flame graph**: width = share of samples; y = stack; x is **not** time.
- **async-profiler** (JVM): `asprof -d 30 -e wall -t -f wall.html 1` · `-e cpu` · `-e lock` · `-e alloc`.
- **py-spy** (Python): `py-spy record --pid 1 --idle -o wall.svg` · `top` · `dump`.
- Profile **at the plateau**; distroless → **ephemeral debug container**.

<div class="warn">

`POST /holds` wall-clock: 33 % row-lock wait, 28 % HTTP call **inside** the transaction, 24 % pool wait. A CPU profile would have blamed JSON.

</div>

---

<!-- _class: tight -->

## The database: find, explain, fix

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT ... FROM seats
WHERE event_id = 4242 AND status = 'AVAILABLE' ORDER BY section, row_label, seat_number LIMIT 8;
-- Seq Scan ... Rows Removed by Filter: 5968520   Buffers: read=59861   412 ms

CREATE INDEX CONCURRENTLY seats_available_idx
    ON seats (event_id, section, row_label, seat_number) WHERE status = 'AVAILABLE';
-- Index Scan using seats_available_idx ...       Buffers: hit=5        0.08 ms
```

- Start from `pg_stat_statements`, sorted by **total** time.
- Hot rows: short transactions, `FOR UPDATE SKIP LOCKED`, a **waiting room**.
- Pool = **throughput × time held**: 1 500/s × 46 ms = 69 → move the HTTP call out → 9. Then PgBouncer.

---

## One change at a time: the bottleneck moves

<div class="flow">
<div class="box red">400/s<small>seat-map Seq Scan</small></div><div class="arrow">index →</div>
<div class="box red">700/s<small>pool 10/10, 150 pending</small></div><div class="arrow">pricing out →</div>
<div class="box red">1 100/s<small>row locks</small></div><div class="arrow">SKIP LOCKED →</div>
<div class="box red">1 800/s<small>inventory CPU 85 %</small></div>
</div>
<div class="flow">
<div class="arrow">10 pods + PgBouncer →</div>
<div class="box red">3 400/s<small>primary CPU 80 %</small></div><div class="arrow">waiting room →</div>
<div class="box green">3 000 admitted<small>p99 140 ms · the limit is chosen</small></div>
</div>

- Keep a log: change, new knee, what saturated next — the evidence behind every capacity number.
- Adding capacity where the bottleneck is **not** buys nothing (playground `monolith`: 12 replicas = 6 replicas, at a higher cost).

---

## Capacity planning

> replicas = ⌈ peak / (knee × (1 − headroom)) ⌉, then survive a zone loss

- Holds: ⌈4 500 / (275 × 0.75)⌉ = **22** pods → ⌈22 × 3/2⌉ = **33** across 3 zones.
- Waiting room at 3 000 holds/s → **24** pods, bounded database load.
- Headroom for forecast error, sub-minute bursts, failures, deploys, **autoscaling lag**.
- Connections: 4 500 × 6 ms ≈ 27 active — PgBouncer in front of the primary.

---

## Autoscaling arrives late

<div class="flow">
<div class="box red">10:00:00<small>500 → 4 500 holds/s</small></div><div class="arrow">→</div>
<div class="box">metrics<small>15–60 s</small></div><div class="arrow">→</div>
<div class="box">Horizontal Pod Autoscaler (HPA)<small>≤ 15 s</small></div><div class="arrow">→</div>
<div class="box">schedule / new node<small>s – 3 min</small></div><div class="arrow">→</div>
<div class="box">JVM ready<small>20–60 s</small></div>
</div>

- **1–4 minutes**: 4 500/s demand vs 1 100/s capacity for 120 s = **408 000** requests of backlog.
- Known peaks: **pre-scale** at 09:45, admission control, warm the new pods.

<p class="small">Playground: <code>boxoffice-hpa</code> (lab 10) — raise the HPA minimum to 4 pods and the drops disappear.</p>

---

## Performance budgets in CI

<div class="flow">
<div class="box">pull request</div><div class="arrow">→</div>
<div class="box">compose up<small>+ warm-up</small></div><div class="arrow">→</div>
<div class="box accent">absolute gate<small>thresholds with margin</small></div><div class="arrow">→</div>
<div class="box accent">relative gate<small>> 15 % slower than main?</small></div><div class="arrow">→</div>
<div class="box green">merge</div>
</div>

- **Deterministic** budgets never flake: SQL statements per request (catches N+1), payload size, image size, startup time.
- Lab 11: p95 < 300 ms against ~7 ms measured; the image job `needs` it — a broken budget is never built.
- Full campaign (load, spike, breakpoint, soak) nightly or before events.

---

<!-- _class: tight -->

## The concept map

| Component | Question it answers | Taught in |
|---|---|---|
| `client` · `mobile` | How does the real load arrive? | Methodology · Load testing |
| `app` | How much can one replica take within the SLO? | Overview · Bottlenecks |
| `sql` | Which query or lock limits the path? | Bottlenecks |
| `cache` | Are we measuring a warm cache? | Methodology (warm-up) |
| `metrics` · `tracing` | Which resource saturates first? | Methodology · Bottlenecks |
| `queue` · `serverless` | How many replicas, how much do we admit? | Capacity planning |
| `thirdparty` | What if a dependency slows down under load? | Load testing (+ chaos) |

<p class="small">Performance adds no boxes to the palette: it measures the ones you have. Scenarios: <code>monolith</code>, <code>flash-sale</code>, <code>serverless-burst</code>, <code>cascading-failure</code>.</p>

---

## Takeaways

1. Response time = service + **waiting**; `N = X × R`; plan with the **knee**.
2. Method before tools: **workload model**, then **RED** per service and **USE** per resource.
3. Test a **production-like** system with realistic, skewed data — warmed up, and cold on purpose.
4. **Open model** for internet traffic; **thresholds = SLOs** per endpoint; `dropped_iterations = 0`.
5. Beware **coordinated omission**; trust percentiles from histograms — and look past p99 for short stalls.
6. **Wall-clock** profiles and `EXPLAIN ANALYZE` find the real bottleneck; change **one** thing at a time.
7. Capacity = demand / (knee × headroom) + zone loss; **pre-scale** known peaks; **budgets in CI**.
