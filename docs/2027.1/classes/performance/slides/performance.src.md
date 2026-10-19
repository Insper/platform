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
* VUs **waited for each response**: when the system slowed, the test slowed with it.
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
- **Retrograde** (USL): past the peak, *more* concurrency → *less* throughput (locks, retries).

<div class="ok">

Plan with the **knee** — the highest rate that still meets the SLO — not with the maximum.

</div>

<!--
Show the two plots of the overview page (M/M/8 latency vs load, USL throughput vs N).
Then run the monolith scenario with the breakpoint profile in the playground.
-->

---

## The performance-engineering loop

1. **Objectives**: SLOs per endpoint at the expected peak.
2. **Workload model**: mix, arrival pattern, data, skew.
3. **Test** in a production-like environment.
4. **Analyze**: curve, RED per service, USE per resource, profiles.
5. **Change one thing**, re-test.
6. **Ship** with a budget in CI; monitor in production.

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

## USE: utilization, saturation, errors — per resource

- **Hardware**: CPU (run queue, **throttling**), memory (GC, OOM), network, disk.
- **Software** — saturates more often: thread pool, **connection pool** (pending), **locks**, queues (consumer lag).

<div class="q">

`inventory` CPU 45 %, threads 200/200, pool 10/10 with 180 pending, PostgreSQL CPU 35 % with sessions in `Lock: tuple`. Bottleneck?

</div>

* **Row-lock contention**, made worse by long transactions. More pods = more waiters; a bigger DB has idle CPU.

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

- **Parity**: same instance types, limits, pool sizes, JVM flags, TLS, gateway — from the same IaC.
- **Data**: production-sized, **skewed**, synthetic (no personal data); restore a snapshot before each run.
- **Dependencies**: mocks with **realistic latency** (payment ≈ 300 ms), not 1 ms.
- **Warm-up**: JIT, pools, caches — separate scenario, excluded from thresholds; test **cold starts** on purpose.
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
| 0.5 s | 133 req/s | 182 — queue grows |
| 2.0 s | **67 req/s** | 182 — queue explodes |

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

<div class="q">

The server freezes 1.5 s four times a minute. A closed-loop tester reports **p99 = 1 ms**. True?

</div>

* It **stopped sending** during each freeze: one slow sample instead of ~150.
* Measured from the **intended** send time: p90 ≈ 150 ms, **p99 ≈ 1.4 s**.
* Fix: open-model generators (k6 arrival-rate, wrk2, vegeta, Gatling `injectOpen`), timeouts counted at full duration, compare client vs server percentiles.

---

## Spike, soak, breakpoint — what to read

- **Spike**: errors during the jump, minutes back to SLO; compare **with and without pre-scaling**.
- **Soak**: trends, not totals — heap after GC, connections, p99 in hour 8 vs hour 1.
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

Resilience patterns are only proven **at the peak**. Playground: `cascading-failure` with the `chaos` profile.

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

## Capacity planning

> replicas = ⌈ peak / (knee × (1 − headroom)) ⌉, then survive a zone loss

- Holds: ⌈4 500 / (275 × 0.75)⌉ = **22** pods → ⌈22 × 3/2⌉ = **33** across 3 zones.
- Waiting room at 3 000 holds/s → **24** pods, bounded DB load.
- Headroom for forecast error, sub-minute bursts, failures, deploys, **autoscaling lag**.

<div class="warn">

Autoscaling takes **1–4 min**. 4 500/s demand vs 1 100/s capacity for 120 s = **408 000** requests backlog → **pre-scale** at 09:45.

</div>

---

## Performance budgets in CI

- Short **open-model** k6 test per PR on a production-like Compose stack; warm-up first.
- **Absolute** gate: SLO-derived thresholds with margin (`p(95)<150` for holds).
- **Relative** gate: > 15 % slower than `main`'s baseline fails.
- **Deterministic** budgets: SQL statements per request (catches N+1), payload size, image size, startup time.
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
5. Beware **coordinated omission**; trust percentiles from histograms.
6. **Wall-clock** profiles and `EXPLAIN ANALYZE` find the real bottleneck; change **one** thing at a time.
7. Capacity = demand / (knee × headroom) + zone loss; **pre-scale** known peaks; **budgets in CI**.
