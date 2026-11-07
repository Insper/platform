---
marp: true
lang: en
title: Observability
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

# Observability

**Ask new questions of a running system — and wake people only when users hurt**

<!--
Outline: (1) monitoring vs observability, the palette, health checks, cost; (2) signals: metrics,
logs, traces, profiles, RED/USE, cardinality; (3) OpenTelemetry: propagation, Collector, sampling;
(4) alerting on SLO burn rate; (5) incident response and postmortems.
-->

---

## 10:04, on-sale day

<div class="q">

A stadium show went on sale at 10:00. Every pod is green, CPU is at 45%, the error rate is 0.3%.
Fans wait **nine seconds** to pay. Four teams each show a dashboard proving *their* service is fine.

Where would you look first?

</div>

* The dashboards watch **causes** chosen in advance, averaged over every route.
* The problem is a **latency** symptom, on **one journey**, in the **tail** (p99), caused by an **external** dependency.
* You need per-journey service level indicators (SLIs) to see it — and **traces** to find where the time went.

<!--
Let the class answer before revealing. The point: the system is not down, it is slow in a way
nobody predicted. That is the situation observability is for.
-->

---

## Monitoring vs observability

| | Monitoring | Observability |
|---|---|---|
| Questions | known in advance ("is X > Y?") | discovered during the investigation |
| Output | dashboards, threshold alerts | ad-hoc queries, traces, breakdowns |
| Data | aggregated metrics | metrics **plus** rich events: logs, traces, profiles |
| Good for | failures seen before | **novel** failures of many services |

- Observability = inferring **internal state from external outputs** (Kalman, control theory).
- Monitoring is a **subset**: you still need dashboards and alerts on known symptoms.

---

## The observability palette

| Component | Question | Consumer |
|---|---|---|
| **Metrics** | *is* something wrong? how much, since when? | dashboards, alert rules |
| **Logs** | *what exactly* happened in this event? | humans investigating |
| **Tracing** | *where* did the time / error go? | humans investigating |
| **Alerting** | must a *human* act *now*? | on-call engineer |
| **Health check** | should this *instance* get traffic or a restart? | load balancer, Kubernetes |

<div class="ok">

The glue is **context**: the same `trace_id` in the log line, the trace and the metric's exemplar.

</div>

---

## The investigation loop

<div class="flow">
<div class="box red">Alert<small>checkout SLO burning 14×</small></div><div class="arrow">→</div>
<div class="box accent">RED dashboard<small>/checkout p99: 400 ms → 9 s</small></div><div class="arrow">→</div>
<div class="box accent">Exemplar<small>one slow sample's trace_id</small></div><div class="arrow">→</div>
<div class="box accent">Trace<small>8 of the 9 s in payment</small></div>
</div>
<div class="flow">
<div class="arrow">→</div>
<div class="box accent">Logs of that span<small>pool exhausted, waited 7.9 s</small></div><div class="arrow">→</div>
<div class="box muted">Profile<small>which code path</small></div><div class="arrow">→</div>
<div class="box green">Mitigate<small>breaker, failover</small></div><div class="arrow">→</div>
<div class="box">Postmortem<small>prevent the class of failure</small></div>
</div>

- The alert fires on a **service level objective (SLO)**: a promise about a symptom users feel.
- **RED** (rate, errors, duration) per route localizes; the **exemplar** links a slow sample to its trace.
- From cheap, aggregated signals to expensive, detailed ones — narrowing the search at each step.

---

<!-- _class: tight -->

## Health checks: three probes

| Probe | Question | On failure | Should check |
|---|---|---|---|
| **Startup** | finished starting? | wait; kill after the budget | app initialized |
| **Liveness** | stuck beyond repair? | **restart** | only the process itself |
| **Readiness** | can serve *right now*? | **remove from the load balancer** | what this instance needs locally |

- A **shallow** check asks "is my process alive?"; a **deep** one also calls PostgreSQL, Redis, the provider.
- Deep checks look more honest — and that is the trap: every instance shares the same dependencies.

---

## The deep-check cascade

<div class="flow">
<div class="box red">PostgreSQL fails over<small>for 20 s</small></div><div class="arrow">→</div>
<div class="box orange">deep readiness fails<small>on every order pod at once</small></div><div class="arrow">→</div>
<div class="box red">Service: no endpoints<small>503 on every route</small></div><div class="arrow">→</div>
<div class="box muted">GET /events fails too<small>it only reads Redis</small></div>
</div>

- Simulator on the overview page: readiness on PostgreSQL → no pod for **12 s**, `GET /events` at **92.0%**; probes on the process only → **100%**.
- Deep **liveness**: 3 failures × 10 s outlast a 20 s failover; at **60 s**, all **4** pods restart and stay down **32 s** after the database is back.

<div class="ok">

**Liveness never checks dependencies.** Dependency health → metrics, alerts, timeouts, breakers.

</div>

---

## Telemetry is a workload

<div class="q">

500 req/s · 8 spans per request · 500 bytes per span. How much trace data per day?

</div>

* `500 × 8 × 500 B = 2 MB/s ≈ 173 GB/day` — over **5 TB/month** at 100% sampling.
* Logs: 5 lines × 300 B per request ≈ **65 GB/day**.
* And the flash sale multiplies traffic by 50.
* Three levers: **sampling** (traces), **bounded cardinality** (metrics), **levels and retention tiers** (logs).

<!--
Illustrative numbers. The point is the habit: estimate telemetry like any other workload.
-->

---

## Four signals, one spectrum

| Signal | Unit | Answers | Cost grows with |
|---|---|---|---|
| **Metrics** | number per series per interval | *is* something wrong? | number of series (not traffic) |
| **Traces** | tree of spans per request | *where*? | traffic × hops (sampled) |
| **Logs** | record per event | *what* happened? | traffic |
| **Profiles** | stack samples per process | *which code*? | number of processes |

- Metric types: **counter** (only up), **gauge** (up/down), **histogram** (buckets, aggregatable), summary (avoid).
- Histogram buckets are counters → they can be **summed across pods**.

---

## RED, USE, golden signals

| Method | For | Signals |
|---|---|---|
| **RED** | services / APIs | Rate, Errors, Duration |
| **USE** | resources: CPU, pools, queues | Utilization, Saturation, Errors |
| **Golden signals** | anything user-facing | latency, traffic, errors, saturation |

- `order` checkout → RED · payment provider calls → RED (client side)
- PostgreSQL pool → USE: **pending acquisitions** · Kafka → **consumer lag**

<div class="ok">

**Saturation** (work waiting) rose two minutes before the checkout alert: it is the leading indicator.

</div>

---

<!-- _class: tight -->

## RED in PromQL

```promql
# Rate: requests/s per route
sum by (http_route) (rate(http_server_request_duration_seconds_count{job="order"}[5m]))

# Errors: fraction of 5xx
sum(rate(http_server_request_duration_seconds_count{job="order", http_response_status_code=~"5.."}[5m]))
/ sum(rate(http_server_request_duration_seconds_count{job="order"}[5m]))

# Duration: p99 per route, across all pods
histogram_quantile(0.99,
  sum by (le, http_route) (rate(http_server_request_duration_seconds_bucket{job="order"}[5m])))
```

- `rate()` on counters **before** `sum` (handles restarts); keep `le` when summing buckets.

---

## Never average percentiles

<div class="q">

Four pods report p99 = 180, 180, 180 and 1,260 ms (the slow one takes 10% of traffic). What is the fleet p99?

</div>

* Average of the p99s: **450 ms**. True fleet p99: about **750 ms**.
* Percentiles **do not compose**; neither the average nor the max is right.
* Sum the histogram buckets (`sum by (le)`), **then** compute the percentile.
* And never use the **average latency**: it hides the tail users feel.

---

## Cardinality

| Label added | × values | Series |
|---|---|---|
| one histogram (15 buckets + sum + count) | 17 | 17 |
| method · route · status | 4 · 25 · 6 | 10,200 |
| pod | 20 | 204,000 |
| `customer_id` | 1,000,000 | **204,000,000,000** |

<div class="warn">

Series = **product** of label values. Unbounded labels (`user_id`, `order_id`, raw URLs) take down the metrics backend.

</div>

High-cardinality questions ("*which* fans were slow?") belong in **traces and logs**.

---

## Logs: structured, correlated, safe

```json
{"timestamp":"2027-03-13T10:04:12.481Z","level":"WARN","service.name":"payment",
 "message":"provider call slow","trace_id":"4bf92f35...","span_id":"00f067aa...",
 "order_id":"ord_9912","duration_ms":8120,"pool_wait_ms":7900}
```

- **Structured** (JSON / OTel log model) with stable field names, not free text.
- `trace_id` + `span_id`: jump from a log line to its trace, and back.
- Log **events**, not steps; log the **decision** ("fallback because breaker open").
- **Never** secrets or personal data; redact at the source and in the Collector.

---

<!-- _class: tight -->

## Traces: find the critical path

```text
gateway    SERVER POST /checkout          |██████████████████████████████|  9.12 s
 order     SERVER POST /orders            | █████████████████████████████|  9.08 s
  inventory CLIENT PUT /holds/{id}        | ▌                            |  0.09 s
  payment  SERVER POST /charges           |  ████████████████████████████|  8.95 s
   payment INTERNAL pool.acquire          |  ██████████████████████████  |  7.90 s
   payment CLIENT POST provider/charges   |                          ███▌|  1.02 s
```

- The provider got slower (1 s) → each call holds a connection longer → the pool of 20 saturates (Little's law).
- **7.9 s of queueing inside BoxOffice**: the fix is a bounded wait + timeout + bulkhead.
- Add spans for **waiting** (pools, locks, queues): automatic instrumentation only sees I/O.

---

## SLI → SLO → error budget → SLA

<div class="flow">
<div class="box accent">SLI<small>what users feel: % of POST /holds non-5xx in &lt; 500 ms</small></div><div class="arrow">→</div>
<div class="box green">SLO<small>internal target: ≥ 99.9% over 28 days</small></div><div class="arrow">→</div>
<div class="box orange">Error budget<small>1 − SLO: 0.1% of the holds may fail or be slow</small></div><div class="arrow">→</div>
<div class="box muted">SLA<small>service level agreement: 99.5% monthly, or credits</small></div>
</div>

- SLI = **good events / valid events**, measured near the user (gateway, synthetic probes).
- CPU, heap, pod count are **not** SLIs. Keep the SLO **stricter** than the SLA.

---

## Start from user journeys

| Journey | SLO (28 days) |
|---|---|
| Hold seats | 99.9% succeed in < 500 ms |
| Browse the catalog | 99.5% in < 300 ms |
| Receive tickets by e-mail | 99% within **2 min** of confirmation (**freshness**) |
| Waiting room during an on-sale | 99.95% of position updates |

- Measure first, then set the SLO slightly below what you achieve.
- Respect dependency math: a 99.9% provider caps the purchase SLO. **Never 100%.**

<!--
The freshness SLI is the one that catches asynchronous failures: green APIs, late e-mails.
-->

---

<!-- _class: tight -->

## Error budget and burn rate

1 M requests/day × 28 days × 0.1% = **28,000** failed requests allowed.

> burn rate = error rate ÷ (1 − SLO) — 1.44% errors at 99.9% = 14.4× → budget gone in ~1.9 days

| Severity | Burn rate | Long window | Short window | Budget used |
|---|---|---|---|---|
| page | 14.4× | 1 h | 5 min | 2% |
| page | 6× | 6 h | 30 min | 5% |
| ticket | 1× | 3 days | 6 h | 10% |

<div class="warn">

A bad deploy (5% errors for 3 h) costs ~22% of the budget; a quiet 0.2% degradation (2×) **empties it by day 26**. Alert on the budget, not on CPU.

</div>

---

## The error budget policy

- **> 50% left**: deploy any working day; experiments allowed.
- **0–50%**: canary + rollback plan; a reliability item every sprint.
- **Exhausted**: freeze feature deploys on the purchase path until the SLI recovers.
- **On-sale rule**: no deploys in the 24 h before a major on-sale.
- **One incident > 20%**: blameless postmortem with owned actions.

<div class="ok">

Signed by product **and** engineering, in advance. Without a policy, an SLO is decoration.

</div>

---

## OpenTelemetry

| Piece | Role |
|---|---|
| **API / SDK** | create spans, metrics, logs; sampling, batching, export |
| **Instrumentation** | zero-code: Java agent, Python `opentelemetry-instrument` |
| **Semantic conventions** | `http.route`, `db.system`, `service.name`… same names everywhere |
| **OTLP** | the OpenTelemetry Protocol: gRPC **4317**, HTTP **4318** |
| **Collector** | receive → process → export |

<div class="ok">

OpenTelemetry (OTel) standardises **production and transport**, not the backend: change Tempo for a SaaS without re-instrumenting.

</div>

---

## Context propagation

```text
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
                version · trace-id (same for all hops) · parent-id (changes) · flags (sampled)
```

- Each hop keeps the **trace-id**, replaces the **parent-id** with its own span.
- Kafka: context in **message headers**; batch consumers use **span links**.
- The provider is a black box: only the **CLIENT span** of `payment` sees it.
- Breaks at: proxies dropping headers, thread hand-offs, homemade HTTP clients.

---

<!-- _class: tight -->

## The Collector pipeline

<div class="flow">
<div class="box" style="flex: .7">services<small>Java agent, Python SDK, Nginx</small></div>
<div class="arrow">OTLP →</div>
<div class="group">
<div class="caption">Collector pipeline</div>
<div class="box accent">receivers<small>otlp: 4317 gRPC, 4318 HTTP</small></div>
<div class="box orange">processors, in order<small>memory_limiter → redact → tail_sampling → batch</small></div>
<div class="box accent">exporters</div>
</div>
<div class="arrow">→</div>
<div class="group">
<div class="caption">backends</div>
<div class="box green">Tempo<small>traces</small></div>
<div class="box green">Prometheus<small>metrics</small></div>
<div class="box green">Loki<small>logs</small></div>
</div>
</div>

- `memory_limiter` **first** (shed, do not crash), `batch` **last**. Agent (per node) vs **gateway** (central policy).
- Tail policies: keep every `ERROR`, every trace ≥ 2 s, 5% of the rest; redaction deletes `payment.card_number`.
- Losing telemetry is acceptable; **slowing checkout to report on it is not**.

---

## Sampling

| Strategy (2,000 req/s, 1% errors) | Stored | Error traces kept |
|---|---|---|
| keep everything | 691 GB/day | 100% |
| head 10% | 69 GB/day | 10% |
| head 1% | 7 GB/day | 1% |
| **tail**: all errors + slow + 5% of the rest | 54 GB/day | **100%** |

- Head = decided at the first span, **blind** to the outcome. Tail = decided in the Collector after the trace ends.
- Tail sampling needs **all spans of a trace on one instance** (route by trace ID).
- Compute **metrics from 100% of traffic** before sampling; use **exemplars** to jump to traces.

---

## Head first, tail second

<div class="flow">
<div class="box accent">root span<small>head decision, once: the sampled flag</small></div><div class="arrow">traceparent →</div>
<div class="box">every service follows the flag</div><div class="arrow">OTLP →</div>
<div class="box orange">gateway Collector<small>waits 10 s, decides on the whole trace</small></div><div class="arrow">→</div>
<div class="box green">kept<small>errors, slow, 5% of the rest</small></div>
</div>
<div class="flow">
<div class="box red" style="flex: .45">flag 00<small>no span exported: the tail never sees it</small></div>
</div>

- Simulator on the OpenTelemetry page: tail only → **54.3 GB/day**, every error trace whole; head 10% first → **9.9%** of the error traces, with or without the tail.
- **3 Collectors behind round robin** → only **36%** of the error traces arrive whole; route **by trace id**.

---

## What deserves a page

A page must be **urgent**, **actionable** and **user-visible**.

| Situation | Destination |
|---|---|
| checkout failing for 5% of fans during an on-sale | **page** |
| budget burning slowly, gone in 10 days | ticket |
| Kafka disk full in 4 days | ticket |
| CPU at 85% with every SLI fine | nothing / capacity review |

<div class="warn">

Alert on **symptoms** (SLO burn), not **causes** (CPU, restarts): causes page for nothing and miss the failure nobody predicted.

</div>

---

## Burn rate

> burn rate = observed error ratio ÷ (1 − SLO) · budget spent = burn × time ÷ window

| Burn rate (SLO 99.9%, 28 days) | Error ratio | Budget gone in | Spent in 1 h |
|---|---|---|---|
| 1× | 0.1% | 28 days | 0.15% |
| 6× | 0.6% | ~4.7 days | 0.9% |
| 14.4× | 1.44% | ~1.9 days | **≈ 2%** |
| 1000× (total outage) | 100% | 40 min | 100% |

---

## Multiwindow, multi-burn-rate

| Severity | Long window | Short window | Burn rate | Budget spent at firing |
|---|---|---|---|---|
| **page** | 1 h | 5 min | 14.4× | 2% |
| **page** | 6 h | 30 min | 6× | 5% |
| ticket | 3 days | 6 h | 1× | 10% |

- **Long** window: the burn is significant. **Short** window: it is still happening → fast reset.
- Total outage → fires in < 1 min; 2% errors → ~43 min.

<!--
A 28-day budget cannot protect a 30-minute on-sale: give critical events their own SLO with short windows.
-->

---

## From a firing rule to a person

<div class="flow" style="align-items: stretch">
<div class="box" style="display: flex; flex-direction: column; justify-content: center">rule evaluation<small>Prometheus / Grafana</small></div><div class="arrow" style="align-self: center">→</div>
<div class="box orange" style="display: flex; flex-direction: column; justify-content: center">firing alert<small>severity=page, team=checkout</small></div><div class="arrow" style="align-self: center">→</div>
<div class="box accent" style="display: flex; flex-direction: column; justify-content: center">Alertmanager<small>group · dedupe · inhibit · silence</small></div><div class="arrow" style="align-self: center">route by labels →</div>
<div class="group">
<div class="box red">pager + runbook</div>
<div class="box">Slack #incidents</div>
<div class="box muted">ticket queue</div>
</div>
</div>

- A **dead man's switch** (`vector(1)`) and `absent()` alerts watch the watcher: silence looks like health.
- **Machines detect, people repair**: a health check takes a dead replica out in seconds and wakes nobody; the page starts the repair, in minutes.

---

## Running the incident

| Role | Does | Does not |
|---|---|---|
| **Incident commander** | owns severity, roles, decisions, timeline | debug |
| **Ops lead** | investigates and mitigates; changes production | talk to customers |
| **Comms lead** | updates every 15–30 min, status page | speculate in public |
| **Scribe** | timestamps everything seen, decided, changed | filter |

- **SEV1** (severity 1): core journey down or any on-sale affected → page, an incident commander (IC), status page.
- **Declare early, downgrade freely.** On-call must be sustainable (≈ ≤ 2 incidents per shift).

---

## Mitigate first

* 10:02 impact → 10:03 page (mean time to detect, **MTTD: 1 min**) → 10:14 secondary provider + throttled waiting room (time to mitigate, **MTTM: 12 min**) → 10:40 resolved.
* Generic, rehearsed mitigations: **rollback**, **flag off**, **failover**, **shed load**, scale out, block bad traffic.
* Cost: 200 attempts/s × 720 s × 12% ≈ **17,300 failed checkouts** vs a 28-day budget of **2,000**.
* The error budget policy kicks in: checkout features pause until the reliability actions ship.

<div class="ok">

Users feel the time to **mitigation**. The root cause can wait until Monday.

</div>

---

## Blameless postmortems

- Assume people acted reasonably with what they knew; ask **how the system made it possible**.
- Look for **contributing factors**, not one root cause:
  - provider slowed (external) · no timeout + shared pool of 20 · manual, undocumented failover
  - 28-day SLO alerts blind to a 30-minute on-sale · load test mocked the provider at 100 ms
- **Action items**: prevent / detect / mitigate, one **owner**, a **date**, tracked.
- Close the loop with a **game day** reproducing the incident (Toxiproxy).

---

## The observability concept map

| Component | Question it answers | Key concepts |
|---|---|---|
| `metrics` | *is* something wrong? how much? | RED, USE, histograms, cardinality |
| `logs` | *what* happened in this event? | structured, `trace_id`, levels, retention |
| `tracing` | *where* did the time go? | spans, `traceparent`, Collector, tail sampling |
| `alerting` | must a human act *now*? | SLO burn rate (28-day window), multiwindow, runbooks |
| `healthcheck` | traffic or restart for this instance? | startup, liveness, readiness, shallow vs deep |

<p class="small">Shared context glues them: metric → <b>exemplar</b> → trace → <b>trace_id</b> → logs. Alerts lead to incident response; the SLOs they enforce are defined earlier in this class.</p>

---

## Takeaways

1. **Observability** lets you ask new questions; the palette: metrics, logs, tracing, alerting, health checks.
2. **Liveness never checks dependencies**; deep checks cause correlated outages.
3. **RED** for services, **USE** for resources; histograms, never averaged percentiles.
4. **Cardinality** is a product: bounded labels in metrics, detail in traces and logs.
5. **OpenTelemetry**: propagate `traceparent`, Collector pipelines, **tail sampling** keeps every error.
6. Page on **SLO burn rate** with multiwindow rules; every alert has an owner and a runbook.
7. Incidents: roles, **mitigate first**, blameless postmortems with owned action items.
