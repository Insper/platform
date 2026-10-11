---
marp: true
lang: en
title: Reliability
description: Platforms, Microservices, DevOps and APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Platforms, Microservices, DevOps and APIs · Insper</div>

# Reliability

**Fail gracefully, recover quickly, limit the blast radius**

<!--
Outline: (1) availability, MTTF/MTTR and the nines; (2) failure modes and cascading failures;
(3) SLI, SLO, SLA and the error budget; (4) resilience patterns; (5) chaos engineering.
-->

---

## Three services, three nines each

<div class="q">

The gateway calls order, which calls payment. Each one is up **99.9%** of the time.
What availability does the user see?

</div>

* In a dependency chain, availabilities **multiply**: `0.999³ ≈ 99.7%`.
* End to end is **worse than any single component**.
* In parallel it is the opposite: two replicas at 99% → `1 − 0.01² = 99.99%`.
* That is why redundancy and isolation patterns exist: to **break the failure-propagation chain**.

<!--
Let the class compute before revealing. Then stress the definition: a reliable system is not one
that never fails, it is one that fails gracefully and recovers quickly.
-->

---

## Availability: two levers

| Term | Full name | Meaning |
|---|---|---|
| **MTTF** | Mean Time To Failure | average time running before a failure |
| **MTTR** | Mean Time To Repair | time to detect, diagnose and restore service |
| **MTBF** | Mean Time Between Failures | MTTF + MTTR — the full cycle |

> Availability = MTTF / (MTTF + MTTR)

- **↑ MTTF** — prevent failures: fault-tolerant design, testing, redundancy.
- **↓ MTTR** — recover faster: incident response, automation, runbooks.

<p class="small">Order service: MTTF 720 h, MTTR 2 h → 99.72%. Auto-restart in 1 min → 99.998%. Recovering faster was the cheaper win.</p>

---

## The "nines"

| Availability | Per year | Per month (30.44 d) | Per 28 days |
|---|---|---|---|
| 99% ("two nines") | 3.65 days | 7.31 hours | 6.72 hours |
| 99.9% ("three nines") | 8.77 hours | 43.8 minutes | 40.3 minutes |
| 99.95% | 4.38 hours | 21.9 minutes | 20.2 minutes |
| 99.99% ("four nines") | 52.6 minutes | 4.38 minutes | 4.03 minutes |
| 99.999% ("five nines") | 5.26 minutes | 26.3 seconds | 24.2 seconds |

<div class="ok">

Each nine is a **10× cut** in allowed downtime. At five nines, humans are too slow: detection and recovery must be **fully automated**.

</div>

---

<!-- _class: tight -->

## How distributed systems fail

| Failure class | Characteristics | Handling strategy |
|---|---|---|
| **Transient** | self-resolves in seconds; safe to retry | retry with exponential backoff and jitter |
| **Permanent (crash-stop)** | node stops and never recovers | circuit breaker + failover to a healthy replica |
| **Intermittent** | appears and disappears, no clear trigger | P99 latency histograms; anomaly alerting |
| **Byzantine** | returns incorrect data without crashing | consensus; checksums; input validation |

<div class="warn">

**Cascading failure** — the most dangerous pattern: payment goes from **100 ms to 3 s**; at 60 req/s the caller needs 180 threads instead of 6, its pool fills and **every route starves**, even those unrelated to payments.

</div>

Answer: **timeouts, circuit breakers and bulkheads**.

---

## SLI → SLO → SLA

| Term | Full name | Nature |
|---|---|---|
| **SLI** | Service Level Indicator | a measurable metric |
| **SLO** | Service Level Objective | an internal target for that metric |
| **SLA** | Service Level Agreement | a contractual commitment to customers |

- SLI = **good events / valid events**, reflecting **what the user experiences**: availability (`non-5xx / total`), latency (`% faster than 200 ms`), durability, freshness.
- Collected from Actuator/Micrometer, synthetic probes (Blackbox Exporter), access logs or the client.

<div class="warn">

CPU, heap size and GC pauses are **vanity metrics**: 95% CPU can serve everyone; 10% CPU can be fully down.

</div>

---

## SLO and the error budget

An SLO is `SLI ≥ threshold` over a `rolling window` — e.g. `Availability ≥ 99.9%` over 28 days.

> Error budget = 1 − SLO target — the team's **licence to take risk**.

99.9% over 28 days → **≈ 40.3 minutes**, or 28,000 failed requests out of 28 million.

<div class="cols">
<div>

### Budget intact

- deploy frequently
- run experiments in production
- take on some technical debt

</div>
<div>

### Budget exhausted

- freeze non-essential deploys
- reliability work before features
- fix the root causes

</div>
</div>

<!--
Use the negotiation example from the page: "12 minutes of budget left in the window; a deploy that
causes 30 minutes of degradation misses the SLO — wait." Stress: always state the window
(43.8 min is a 30.44-day month, 40.3 min is 28 days).
-->

---

## Burn rate

`burn rate = observed error rate ÷ (1 − SLO)` — with a 99.9% SLO, 1.44% errors = 14.4×.

| Burn rate | 28-day budget exhausted in | Severity |
|---|---|---|
| 1× | end of the window (28 days) | normal |
| 2× | 14 days | warning |
| 6× | ~4.7 days | high — ticket |
| 14.4× | ~1.9 days (~47 h) | critical — page immediately |

- **High** burn-rate alerts catch fast-moving incidents early.
- **Low** burn-rate alerts catch slow degradation that would otherwise be invisible.

---

## SLA vs SLO

| | SLO | SLA |
|---|---|---|
| **Audience** | engineering team | customer / business |
| **Nature** | internal target | legal contract |
| **Strictness** | higher (stricter) | lower (more lenient) |
| **Breach** | reliability work, feature freeze | service credits, penalties |

<div class="ok">

Set the **SLO stricter than the SLA**: SLA 99.9% → SLO 99.95%. The gap is the safety margin. And **never** set an SLO of 100%.

</div>

<p class="small">Real SLAs: AWS EC2 99.99% monthly, S3 99.9%, RDS Multi-AZ 99.95% — a breach pays service credits, not your lost sales.</p>

---

## Timeout and retry

- **Timeout** (connect + read) on every outbound call, near the downstream **P99.9**, within the caller's budget, **per dependency**.
- **Retry** only **transient** failures (timeouts, `503`, `429`) — never `4xx` — with **exponential backoff**: 1 s, 2 s, 4 s… up to a cap.
- Add **full jitter** (`random(0, backoff)`) so clients that failed together do not retry together — the *thundering herd*.
- Retry at **one layer**: 3 layers × 3 attempts = **27 calls** to a struggling service.

<div class="warn">

Retrying `POST /orders` can create duplicates. Retry idempotent calls (`GET`, `PUT`, `DELETE`) or send an **idempotency key** the server deduplicates.

</div>

---

## Circuit breaker

**Closed** → (failure rate > threshold) → **Open** → (wait timeout) → **Half-Open** → probe succeeds → **Closed** · probe fails → **Open**

| Parameter | Typical value | Effect |
|---|---|---|
| Failure threshold | 50% of last 10–20 calls | sensitivity to failures |
| Wait timeout | 30–60 s | time the service gets to recover |
| Half-Open probe count | 3–5 requests | how cautiously to test recovery |
| Slow call threshold | 2× normal P99 | slow calls count as failures |

<p class="small">Open = reject immediately, no network call → a <b>fallback</b> degrades gracefully (cached data, clear <code>503</code>; never fake a payment). Resilience4j: <code>@CircuitBreaker(name = "product", fallbackMethod = …)</code>, <code>@Retry</code>, <code>@Bulkhead</code>.</p>

<!--
Ask: why is failing fast better than waiting? It frees the caller's threads and gives the
downstream service time to recover.
-->

---

## Bulkhead, rate limiting, health checks

| Pattern | Idea | Example |
|---|---|---|
| **Bulkhead** | one resource pool **per dependency** | Pool A (10 threads) → payment; Pool B → inventory stays healthy |
| **Rate limiting** | **token bucket**: refill rate = steady throughput, capacity = burst | 100 req/s, capacity 200 → else `429 Too Many Requests` |
| **Liveness** | is the process alive? | fails → orchestrator **restarts** the container |
| **Readiness** | can it serve traffic now? | fails → **removed from the load balancer**, not restarted |

<p class="small">Actuator: <code>/actuator/health/liveness</code> and <code>/readiness</code>. Never check the database in <b>liveness</b>: a DB blip would restart every replica at once.</p>

---

## Defence in depth

client → **rate limiter** → **circuit breaker** → **bulkhead** → **timeout** → **retry + backoff** → downstream

| Layer | What it handles |
|---|---|
| Rate limiter | traffic spikes, abusive clients |
| Circuit breaker | known-failing dependencies |
| Bulkhead | slow dependencies bleeding into other calls |
| Timeout | unbounded waiting |
| Retry + backoff | transient errors |

> The patterns do not prevent failures; they **limit how far a failure travels**.

---

## Chaos engineering

Experiment on the system to build confidence that it **withstands turbulent conditions in production**.

- **Origin**: moving to AWS, Netflix built **Chaos Monkey** (2010) — it kills random instances in production, in business hours. It paid off in the April 2011 `us-east-1` outage.
- The **Simian Army** followed (2011): Latency Monkey, Chaos Gorilla (a whole Availability Zone)… Earlier, Amazon ran **GameDays** (Jesse Robbins).
- **Principles**: hypothesis on steady state · vary real-world events · run in production · automate continuously · **minimise blast radius**.

> "The best way to avoid failure is to fail constantly." — John Ciancutti, Netflix, 2010

---

## Running an experiment

**Hypothesise** the steady state → **Design** failure and blast radius → **Inject** → **Observe** SLIs → **Analyse** → **Improve**, then repeat with a wider scope.

- Store example: add **3 s latency** (Toxiproxy) between order and product → expect the breaker to open and `GET /orders` to stay fast.
- Grow the blast radius: tests → staging/canary → **1% of traffic** → full production; **automated abort** when an SLI drops.
- **GameDay**: a team exercise — brief, execute, observe, **blameless** debrief.
- Tools: Chaos Monkey, Gremlin, LitmusChaos, Chaos Mesh, Toxiproxy, AWS FIS.

<div class="ok">

**Observability first**, then resilience patterns, then chaos to prove the patterns work.

</div>

<!--
Stress that a falsified hypothesis is a finding, not a failure: the team learns it before a real
incident teaches them.
-->

---

## Takeaways

1. Availability = MTTF / (MTTF + MTTR); in a chain, availabilities **multiply**.
2. Each extra **nine** is 10× less downtime and a different operational posture.
3. **Cascading failures** spread through exhausted thread pools — the main microservice risk.
4. **SLI** measures, **SLO** targets, **SLA** contracts; keep the SLO stricter than the SLA.
5. The **error budget** (1 − SLO, ≈ 40 min per 28 days at 99.9%) and its **burn rate** decide between features and reliability.
6. Timeout, retry + jitter, circuit breaker + fallback, bulkhead, rate limit, health checks — **in layers**.
7. **Chaos engineering** proves the patterns work — with small blast radius and observability first.
