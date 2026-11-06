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
Outline: (1) overview: availability, the nines, composite availability, failure modes, cascading
failures; (2) SLI / SLO / SLA: measuring, targets, error budget, burn rate, contracts; (3) resilience
patterns: timeout, retry, circuit breaker, fallback, bulkhead, rate limiting, health checks, layering;
(4) chaos engineering: proving that the patterns work.
-->

---

## Black Friday, one slow dependency

<div class="q">

Products healthy, database healthy — but the **payment provider** answers in **3 s instead of 100 ms**.
Within a minute the gateway stops answering **everything**: login, catalogue, cart. Why?

</div>

- Nobody wrote a bug: the system had **no defence against a slow dependency**.
- A reliable system is not one that never fails: it **fails gracefully, recovers quickly** and **limits the blast radius** (the users and components one failure affects).
- This class: decide **with numbers** how much failure is acceptable, and build the defences.

<!--
Reliability: the probability that a system performs its function without failure, under stated
conditions, for a period. Roadmap: overview → SLI/SLO/SLA → resilience patterns → chaos engineering.
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

<p class="small">Order service: MTTF 720 h, MTTR 2 h → 99.72%. Halve the failures → 99.86%. Auto-restart in 1 min → 99.998%: recovering faster was the bigger and cheaper win.</p>

---

## The "nines"

| Availability | Per year | Per month (30.44 d) | Per 28 days |
|---|---|---|---|
| 99% ("two nines") | 3.65 days | 7.31 hours | 6.72 hours |
| 99.9% ("three nines") | 8.77 hours | 43.8 minutes | 40.3 minutes |
| 99.95% | 4.38 hours | 21.9 minutes | 20.2 minutes |
| 99.99% ("four nines") | 52.6 minutes | 4.38 minutes | 4.03 minutes |
| 99.999% ("five nines") | 5.26 minutes | 26.3 seconds | 24.2 seconds |

- Each nine is a **10× cut** in allowed downtime; at five nines detection and recovery must be **fully automated**.

<div class="warn">

**Always state the window**: 99.9% allows 43.8 min in a calendar month but 40.3 min in 28 days.

</div>

---

## Composite availability

<div class="cols">
<div>

### In series

A request needs **every** component: availabilities **multiply**.

gateway → order → product, 99.9% each:
`0.999³ ≈ 99.7%`

Worse than any single part: every synchronous dependency **lowers the ceiling**.

</div>
<div>

### In parallel

**Any one** of n replicas is enough:
`1 − (1 − a)ⁿ`

Two gateways at 99% behind Nginx:
`1 − 0.01² = 99.99%`

Only if failures are **independent** — same bug, host or zone breaks it.

</div>
</div>

<div class="ok">

Redundancy and isolation patterns exist to **break the failure-propagation chain**.

</div>

---

## Failure modes

**Partial failures** — some components work, others do not — are the norm, and harder than total outages.

| Failure class | Characteristics | Handling strategy |
|---|---|---|
| **Transient** | self-resolves in seconds; safe to retry | retry with exponential backoff and jitter |
| **Permanent (crash-stop)** | node stops and never recovers | circuit breaker + failover to a healthy replica |
| **Intermittent** | appears and disappears, no clear trigger | P99 latency histograms; anomaly alerting |
| **Byzantine** | returns incorrect data without crashing | consensus; checksums; input validation |

<p class="small">The most common failure is not a crash but a <b>slow</b> response: the caller cannot tell slow from dead, so it keeps waiting.</p>

---

## Cascading failures

A slow dependency exhausts its caller's **threads, connections, memory** — and the exhaustion climbs upstream.

- **Little's law**: requests in flight = arrival rate × time each one takes.
- 60 orders/s × 100 ms per payment call → **6** threads waiting on payment.
- 60 orders/s × 3 s → **180** of 200 threads: `GET /orders/42`, which needs no payment, gets `503`.
- If the gateway waits on order, the exhaustion climbs one more level.

<div class="warn">

Pitfalls: **no timeout**; **retrying blindly**; **one shared pool** for every dependency; **assuming independence** (two replicas on one node fail together). The answer: **timeouts, circuit breakers, bulkheads**.

</div>

---

## SLI → SLO → SLA

"Is the store reliable enough?" — ship the new checkout or freeze deploys? Without numbers, it is opinion against opinion.

| Term | Full name | Nature |
|---|---|---|
| **SLI** | Service Level Indicator | a measurable metric |
| **SLO** | Service Level Objective | an internal target for that metric |
| **SLA** | Service Level Agreement | a contractual commitment to customers |

**telemetry** → aggregated into an **SLI** → evaluated against the **SLO** → informs the **SLA**; the remainder of the SLO becomes the **error budget**.

---

<!-- _class: tight -->

## SLI: the raw measurement

> SLI = good events / valid events × 100% — e.g. `GET /products` non-5xx in less than 300 ms.

| Category | Example measurement |
|---|---|
| **Availability** | `non-5xx responses / total HTTP requests` |
| **Latency** | `requests faster than 200 ms / total` (≈ P95 < 200 ms) |
| **Error rate** | `HTTP 5xx / total` (the complement of availability) |
| **Durability** · **Freshness** | successful reads / attempted · time since last refresh |

- Collected from Actuator/Micrometer (`http_server_requests_seconds_count`), synthetic probes, access logs or the client.

<div class="warn">

CPU, heap size and GC pauses are **vanity metrics**: 95% CPU can serve everyone; 10% CPU can be fully down.

</div>

---

## SLO: the target you commit to

`SLI ≥ threshold` over a **rolling window** (the last N days, moving every minute) — not a calendar window that resets on the 1st.

| SLO | Meaning |
|---|---|
| `Availability ≥ 99.9%` over 28 days | at most 0.1% of requests fail in any 28 days |
| `P95 latency ≤ 200 ms` over 7 days | 95% of requests within 200 ms |
| `Error rate ≤ 0.5%` over 24 hours | at most 5 in 1000 requests return 5xx |

- **Ambitious but achievable**: never breached = too loose; always breached = noise.
- Measure 30–90 days, start at the baseline minus a small buffer, tighten over time.
- A service cannot promise more than the **product** of its synchronous dependencies.

---

## Error budget

> Error budget = 1 − SLO target — the team's **licence to take risk**.

99.9% over 28 days → **≈ 40.3 minutes**, or **28,000** failed requests out of 28 million (a bad deploy with 20,000 errors burns ~70% at once).

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

<p class="small">Only with an <b>error budget policy</b> agreed in advance by product and engineering.</p>

<!--
Negotiation example from the page: "12 minutes of budget left in the window; a deploy that causes 30
minutes of degradation misses the SLO — wait."
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

- SRE Workbook: 14.4× for 1 h burns ~2% of the budget; 6× for 6 h burns ~5%.
- **High** burn rates catch fast incidents; **low** burn rates catch slow degradation.
- Alert on a **symptom users feel** (errors burning the budget), not on a cause such as CPU.

---

## SLA: the contractual commitment

A legal agreement: covered services · SLO targets · measurement · exclusions · **remedies** (service credits).

| Provider | Service | Monthly uptime |
|---|---|---|
| AWS | EC2 (region level) | 99.99% |
| AWS | S3 Standard | 99.9% |
| AWS | RDS Multi-AZ | 99.95% |
| Google Cloud / Azure | VMs across zones | 99.99% |

<div class="ok">

The higher numbers require **you** to deploy redundantly. The remedy is a credit on the bill, not your lost sales.

</div>

---

## SLA vs SLO

| | SLO | SLA |
|---|---|---|
| **Audience** | engineering team | customer / business |
| **Nature** | internal target | legal contract |
| **Strictness** | higher (stricter) | lower (more lenient) |
| **Breach** | reliability work, feature freeze | service credits, penalties |

<div class="ok">

Set the **SLO stricter than the SLA**: SLA 99.9% → SLO 99.95%. The gap is the safety margin.

</div>

---

## Best practices and pitfalls

- **Few, meaningful SLIs**: start with availability and P99 latency.
- **28-day rolling windows**: always the same number of weekdays and weekends.
- **Automated SLO dashboards** (Grafana + Prometheus); **review SLOs quarterly**.
- **Never set an SLO of 100%**: no room for maintenance or safe deploys.

<div class="warn">

**Wrong thing**: an SLI from the health check says nothing about `POST /orders`. **Averages**: a mean of 80 ms can hide 5% waiting 4 s. **Mixed windows** (30 vs 28 days). **SLO without a policy**: just a number on a dashboard.

</div>

---

<!-- _class: tight -->

## Resilience patterns

They do not prevent failures; they **limit how far a failure travels**. Running example: **order** calls **product** (OpenFeign) to check prices.

| Pattern | Question it answers | Protects against |
|---|---|---|
| **Timeout** | how long am I willing to wait? | hanging calls |
| **Retry** | is it worth trying again? | transient failures |
| **Circuit breaker** | should I even try? | a dependency known to be down |
| **Fallback** | what do I answer instead? | total loss of a feature |
| **Bulkhead** | how much capacity can one dependency take? | resource exhaustion spreading |
| **Rate limiting** | how much traffic do I accept? | spikes, abusive clients |
| **Health checks** | should traffic reach this instance? | routing to broken instances |

---

## Timeout

A deadline on every outbound call: it bounds the damage of one slow call.

- **Percentile-based**: near the downstream **P99.9** under normal conditions.
- **Budget-aware**: inside the caller's own deadline. **Per dependency**: one global value is almost always wrong.
- Two timeouts: **connect** (open the TCP connection) and **read** (wait for the response).

```yaml
spring.cloud.openfeign.client.config:
  product:                  # the @FeignClient name
    connect-timeout: 500    # ms
    read-timeout: 1000      # ms
```

<p class="small">A timeout alone turns a hang into a fast error: combine it with retry, circuit breaker and fallback.</p>

---

## Retry with exponential backoff and jitter

Retry only **transient** failures, spaced out so a restart is not hit by a *thundering herd*:

- **Exponential backoff**: `wait = min(c · 2ⁿ, max_wait)` → 1 s, 2 s, 4 s, 8 s, 16 s (cap).
- Clients that failed together still retry together → add **jitter**.
- **Full jitter** (Marc Brooker, AWS): `wait = random(0, min(c · 2ⁿ, max_wait))` — 1,000 clients spread uniformly instead of 1,000 requests at t = 1 s, 2 s, 4 s.

| Response | Retry? |
|---|---|
| connection refused / reset, timeout | yes |
| `503`, `429` | yes, with backoff (respect `Retry-After`) |
| `500` | maybe, once — often a bug |
| `400`, `401`, `403`, `404`, `422` | no — the request itself is wrong |

---

## Retry safely

<div class="warn">

**Retry amplification**: gateway, order and the product client each retrying 3 times → one click = 3 × 3 × 3 = **27** calls to a struggling service. Retry at **one** layer, cap the attempts, stop when the breaker is open.

</div>

- Retrying `POST /orders` can create **duplicates**: retry only **idempotent** operations (`GET`, `PUT`, `DELETE`).
- **Idempotent**: doing it twice has the same effect as doing it once.
- **Idempotency key**: the client sends a UUID per logical operation (`Idempotency-Key: k-42`); the server stores processed keys and, on a repeat, returns the stored result — same order, no duplicate.

---

## Circuit breaker

**Closed** → (failure rate > threshold) → **Open** → (wait timeout) → **Half-Open** → probe succeeds → **Closed** · probe fails → **Open**

| Parameter | Typical value | Effect |
|---|---|---|
| Failure threshold | 50% of last 10–20 calls | sensitivity to failures |
| Wait timeout | 30–60 s | time the service gets to recover |
| Half-Open probe count | 3–5 requests | how cautiously to test recovery |
| Slow call threshold | 2× normal P99 | slow calls count as failures |

<p class="small">Open = reject immediately, no network call: frees the caller's threads and gives the dependency time to recover.</p>

---

<!-- _class: tight -->

## Circuit breaker + retry with Resilience4j

```java
@CircuitBreaker(name = "product", fallbackMethod = "priceFallback")
@Retry(name = "product")
public ProductOut findProduct(String id) { ... }   // Feign call
```

```yaml
resilience4j:
  circuitbreaker.instances.product:
    sliding-window-size: 10                  # last 10 calls
    failure-rate-threshold: 50               # % → Open
    slow-call-duration-threshold: 2s         # slow = failure
    wait-duration-in-open-state: 30s         # Open → Half-Open
    permitted-number-of-calls-in-half-open-state: 3
  retry.instances.product:
    max-attempts: 3                          # 1 call + 2 retries
    wait-duration: 500ms
    enable-exponential-backoff: true         # 500 ms, 1 s, ...
```

<p class="small">The state is exported as <code>resilience4j_circuitbreaker_state</code> through Actuator — graph it in Grafana (Hands-on 6).</p>

---

## Fallback and graceful degradation

What the caller does **instead** when the call fails or the breaker is open: **lose a feature, not the whole page**.

| Dependency down | Possible fallback in the store |
|---|---|
| Recommendation service | "best sellers" cached in Redis |
| Product service, reads | last cached data, marked as possibly stale |
| Notification service | publish the e-mail request to Kafka, send later |
| Payment service | no safe fallback: a quick, clear `503` |

<div class="warn">

A fallback must be **safe and simple**: a remote fallback can fail too, and charging a card or reserving stock must **never be faked**.

</div>

---

## Bulkhead and rate limiting

<div class="cols">
<div>

### Bulkhead

Watertight compartments: **one pool per dependency**.

Pool A (10 threads) → payment, degraded; Pool B (10 threads) → inventory **unaffected**.

<p class="small">Resilience4j: <b>semaphore</b> (<code>max-concurrent-calls</code>, the default) or <b>thread-pool</b>. Same idea: separate DB pools, separate deployments.</p>

</div>
<div>

### Rate limiting

**Token bucket**: refill rate = steady throughput, capacity = burst; empty → `429`.

```nginx
limit_req_zone $binary_remote_addr
    zone=api:10m rate=10r/s;
limit_req zone=api burst=20 nodelay;
```

<p class="small">Nginx uses a <b>leaky bucket</b>. Per user or API key: in the gateway.</p>

</div>
</div>

---

## Health checks

| Probe | Question | When it fails |
|---|---|---|
| **Liveness** | is the process alive (not deadlocked)? | the orchestrator **restarts** the container |
| **Readiness** | can it serve traffic now? | **removed from the load balancer**, not restarted |
| **Startup** (K8s) | has it finished starting? | liveness and readiness wait — a slow JVM is not killed at boot |

<p class="small">Actuator: <code>/actuator/health/liveness</code> and <code>/readiness</code> (automatic on Kubernetes; elsewhere <code>management.endpoint.health.probes.enabled=true</code>).</p>

<div class="warn">

**Never put external dependencies in liveness**: a 10 s database blip would restart **every replica at once**. Careful even with readiness: all replicas unready = the service disappears.

</div>

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

<p class="small"><b>The order is a design decision</b>: Resilience4j's default is <code>Retry(CircuitBreaker(RateLimiter(TimeLimiter(Bulkhead(call)))))</code> — retry outermost, so the breaker counts every attempt. Check that timeouts × attempts fit the caller's deadline.</p>

---

## Chaos engineering

<div class="q">

Timeouts, a breaker and a fallback on order → product. **Do they work?** Nobody has ever seen the breaker open in production.

</div>

- **Experimenting** on a system to build confidence that it withstands turbulent conditions in production.
- Amazon, early 2000s: Jesse Robbins' **GameDays**. Netflix, moving to AWS: **Chaos Monkey** (~2010) kills random instances in production, **in business hours**.
- April 2011: a large `us-east-1` failure — Netflix kept streaming. Then the **Simian Army**: Latency Monkey, Chaos Gorilla (a whole Availability Zone)…

> "The best way to avoid failure is to fail constantly." — John Ciancutti, Netflix, 2010

---

## Principles of chaos engineering

1. **Hypothesis around steady state** — measurable outputs: request rate, error rate, latency.
2. **Vary real-world events** — crashes, partitions, disk full, clock skew, dependency timeouts, spikes.
3. **Run experiments in production** — staging does not reproduce load, data or dependencies.
4. **Automate them to run continuously** — new deploys reintroduce weaknesses.
5. **Minimise the blast radius** — the fewest users needed; widen only after small experiments pass.

<p class="small">Formalised and named by Netflix engineers in IEEE Software (2016).</p>

---

<!-- _class: tight -->

## An experiment on the store

**Hypothesise** → **Design** → **Inject** → **Observe** → **Analyse** → **Improve**, then repeat with a wider scope.

| Step | Content |
|---|---|
| **Steady state** | `POST /orders`: availability ≥ 99.9%, P95 < 500 ms (Grafana, Hands-on 6) |
| **Hypothesis** | product at 3 s → the breaker opens within 30 s, orders fail fast with `503`, `GET /orders` keeps its latency |
| **Injection** | Toxiproxy between order and product, 3 s `latency` toxic — Compose first, later one replica |
| **Blast radius** | one environment, 10 minutes, abort if `GET /orders` < 99% |
| **Observe** | breaker state, error rate and P95 per route, busy threads, traces in Jaeger |
| **Findings?** | Feign read timeout never set (breaker counts after 60 s); retries open the breaker too late |

<p class="small">A confirmed hypothesis is evidence; a <b>falsified</b> one is a finding — a bug found on your terms.</p>

---

<!-- _class: tight -->

## Fault injection and blast radius

| Category | Examples | Tools |
|---|---|---|
| **Process / instance** | kill container, OOM-kill, terminate VM | Chaos Monkey, LitmusChaos |
| **Network** | latency, packet loss, partition | Toxiproxy, Gremlin, Chaos Mesh |
| **Resource** | saturate CPU, fill disk, exhaust memory | stress-ng, Gremlin |
| **Dependency** | HTTP 500, timeouts, malformed responses | WireMock, Toxiproxy |
| **State** | corrupt records, roll back a deploy, expire certificates | manual, Gremlin |
| **Infrastructure** | lose an Availability Zone or a region | Chaos Gorilla, AWS FIS |

**Blast radius**: tests → staging/canary → **1% of traffic** → full production. Controls: feature flags, business hours, **automated abort** on an SLI, shadow traffic.

---

## GameDay and tools

A **GameDay** is a planned, team-wide exercise — process as much as technology:

1. **Brief** the scenario (or keep it secret: a *surprise GameDay*).
2. **Execute**: inject; monitor, run the runbooks, communicate as in a real incident.
3. **Observe** time to detect and to recover, and which runbooks helped.
4. **Debrief**: a **blameless** post-mortem — a list of improvements, not of culprits.

<p class="small">Tools: Chaos Monkey (Netflix), Gremlin (SaaS), LitmusChaos and Chaos Mesh (CNCF, Kubernetes-native), Toxiproxy (Shopify, integration tests), AWS FIS (IAM, abort conditions).</p>

---

## Observability first

Before any experiment the team must **measure** steady state (SLI dashboards), **detect** deviations (alerts in seconds), **attribute** causes (tracing) and **abort** safely (kill switch).

<div class="ok">

**Observability first**, then resilience patterns, then chaos experiments to prove the patterns work.

</div>

<div class="warn">

Pitfalls: chaos **without a hypothesis** is just breaking things; **starting in production** (it is the goal, not the first step); **no abort switch**; **fixing nothing** — findings that never become tickets only consumed error budget.

</div>

---

## Takeaways

1. Availability = MTTF / (MTTF + MTTR); faster recovery is often the cheapest gain. In series availabilities **multiply**; in parallel, `1 − (1 − a)ⁿ`.
2. Each extra **nine** is 10× less downtime — always state the **window**.
3. **Slow** dependencies exhaust threads and **cascade** upstream.
4. **SLI** measures, **SLO** targets, **SLA** contracts (looser than the SLO); the **error budget** (≈ 40.3 min per 28 days at 99.9%) and its **burn rate** decide between features and reliability.
5. Timeout, retry + full jitter (idempotent only), circuit breaker + safe fallback, bulkhead, rate limit, health checks — **in designed layers**.
6. **Chaos engineering** proves the patterns work: a hypothesis, a small blast radius, observability first.
