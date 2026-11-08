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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">Platforms, Microservices, DevOps and APIs · Insper</div>

# Reliability

**Fail gracefully, recover quickly, limit the blast radius**

<!--
Outline: (1) overview: availability, the nines, composite availability, failure modes, cascading
failures; (2) SLI / SLO / SLA: measuring, targets, error budget, burn rate and multiwindow alerts,
contracts; (3) resilience patterns: timeout and its budget, retry, circuit breaker, fallback, bulkhead,
rate limiting, health checks, layering; (4) chaos engineering: proving that the patterns work.
Three simulators: slo-month and error-budget-burn (SLI / SLO / SLA), slow-dependency (Resilience Patterns).
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

- **In series** (every component needed): availabilities **multiply** — gateway → order → product at 99.9% each: `0.999³ ≈ 99.7%`.
- **In parallel** (any one of n replicas): `1 − (1 − a)ⁿ` — two gateways at 99%: `1 − 0.01² = 99.99%`, only if failures are **independent**.

<div class="flow" style="align-items: stretch">
<div class="box" style="display: flex; flex-direction: column; justify-content: center">Nginx<small>99.99% (assumed)</small></div>
<div class="arrow" style="align-self: center">→</div>
<div class="group">
<div class="caption">in parallel · 99.99%</div>
<div class="box green">gateway 1<small>99%</small></div>
<div class="box green">gateway 2<small>99%</small></div>
</div>
<div class="arrow" style="align-self: center">→</div>
<div class="box orange" style="display: flex; flex-direction: column; justify-content: center">order<small>99.9% · one replica</small></div>
<div class="arrow" style="align-self: center">→</div>
<div class="box orange" style="display: flex; flex-direction: column; justify-content: center">product<small>99.9% · one replica</small></div>
</div>

<div class="ok">

Whole path ≈ **99.78%** ≈ **19 h of downtime a year** — almost all from order and product. A third gateway saves under an hour; replicating the **weakest links** removes most of it.

</div>

<!--
The page's worked example: reduce the parallel part first, then multiply the series. Hands-on 7 runs
every replica on one laptop: one host, so not independent.
-->

---

<!-- _class: tight -->

## Failure modes

Two properties: **how long** (transient, intermittent, permanent) and **how it behaves** (crash, slow, Byzantine). **Partial failures** are the norm.

| Failure class | Characteristics | Handling strategy |
|---|---|---|
| **Transient** | self-resolves in seconds; safe to retry | retry with exponential backoff and jitter |
| **Intermittent** | appears and disappears, no clear trigger | 99th-percentile (P99) latency histograms; anomaly alerting |
| **Permanent (crash-stop)** | node stops, does not recover by itself | health checks + failover; circuit breaker meanwhile |
| **Slow** | answers, but late; still looks alive | timeout + circuit breaker (slow calls) + bulkhead |
| **Byzantine** | returns incorrect data without crashing | consensus; checksums; input validation |

<p class="small">The most common failure is not a crash but a <b>slow</b> response: the caller cannot tell slow from dead, so it keeps waiting — and a slow node holds the caller's resources.</p>

---

## Cascading failures

A slow dependency exhausts its caller's **threads, connections, memory** — and the exhaustion climbs upstream.

- **Little's law**: requests in flight = arrival rate × time each one takes.
- 60 orders/s × 100 ms per payment call → **6** threads waiting on payment.
- 60 orders/s × 3 s → **180** of Tomcat's **200** threads: arrivals come in bursts, the pool fills now and then, and `GET /orders/42`, which needs no payment, gets `503`.
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

<div class="flow">
<div class="box">telemetry<small>37,800 of 28 M failed</small></div><div class="arrow">→</div>
<div class="box accent">SLI<small>99.87%</small></div><div class="arrow">→</div>
<div class="box orange">SLO ≥ 99.9%<small>missed · 135% of budget</small></div><div class="arrow">→</div>
<div class="box green">SLA ≥ 99.5%<small>kept · no credits</small></div><div class="arrow">→</div>
<div class="box orange">freeze deploys</div>
</div>

<p class="small">One 28-day window of the order service: bad deploy + database failover (simulator <code>slo-month</code>). Google's site reliability engineering (SRE) practice.</p>

---

<!-- _class: tight -->

## SLI: the raw measurement

> SLI = good events / valid events × 100% — e.g. `GET /products` non-5xx in less than 300 ms.

| Category | Example measurement |
|---|---|
| **Availability** | `non-5xx responses / total HTTP requests` |
| **Latency** | `requests faster than 200 ms / total` (a 95% target = 95th percentile, P95, < 200 ms) |
| **Error rate** | `HTTP 5xx / total` (the complement of availability) |
| **Durability** · **Freshness** | successful reads / attempted · time since last refresh |

- Collected from Actuator/Micrometer (`http_server_requests_seconds_count`), synthetic probes, access logs or the client.

<div class="warn">

CPU, heap size and garbage collection (GC) pauses are **vanity metrics**: 95% CPU can serve everyone; 10% CPU can be fully down.

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

99.9% over 28 days → **≈ 40.3 minutes**, or **28,000** failed requests out of 28 million (a bad deploy with 20,000 errors burns ~71% at once).

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

<!-- _class: tight -->

## Burn rate

`burn rate = observed error rate ÷ (1 − SLO)` — with a 99.9% SLO, 1.44% errors = 14.4×. In a period *t* it spends *b · t / window* of the budget.

| Burn rate | 28-day budget gone in | Alert when it lasts | Spent by then | Action |
|---|---|---|---|---|
| 1× | 28 days | 3 days | ~10% | 🟡 ticket |
| 6× | ~4.7 days | 6 hours | ~5% | 🔴 page |
| 14.4× | ~1.9 days (~47 h) | 1 hour | ~2% | 🔴 page immediately |
| 1000× (all fail) | ~40 minutes | — | — | 🔴 the 1 h page fires in ~1 min |

- SRE Workbook's pairs, derived for 30 days (14.4 × 1 h / 720 h = 2%); with 28 days: 2.1%, 5.4%, 10.7%.
- Alert on a **symptom users feel** (errors burning the budget), not on a cause such as CPU.

---

## Multiwindow alerts: fast to fire, fast to stop

<div class="flow">
<div class="box">error ratio<small>over several windows</small></div><div class="arrow">→</div>
<div class="box red">1 h <b>and</b> 5 min &gt; 14.4×<small>page · 2% in 1 h</small></div><div class="arrow">else →</div>
<div class="box red">6 h <b>and</b> 30 min &gt; 6×<small>page · 5% in 6 h</small></div><div class="arrow">else →</div>
<div class="box orange">3 d <b>and</b> 6 h &gt; 1×<small>ticket · 10% in 3 days</small></div><div class="arrow">else →</div>
<div class="box green">no alert<small>the budget absorbs it</small></div>
</div>

- The **long** window proves a real share of the budget was spent; the **short** one (1/12 of it) proves it is **still** burning.
- A single 1-hour window keeps paging for most of an hour after the fix.
- No `for:` durations: they do not scale with severity and reset when the ratio dips.

<p class="small">PromQL: the 1 h ratio <code>&gt; (14.4 * 0.001)</code> <b>and</b> the 5 min ratio <code>&gt; (14.4 * 0.001)</code> on <code>http_server_requests_seconds_count{job="OrderMetrics"}</code>.</p>

---

## Simulator: who gets paged, and when?

<div class="q">

The order service (1 M requests/day, SLO 99.9%, budget 28,000 errors) against four incidents and the three rules.

</div>

- **Bad deploy** (48% for 1 h): **480×**, **71%** of the budget; page after **2 min**, silent **4 min** after the rollback — a single-window rule keeps paging **58 min**.
- **Partial outage** (2% for 6 h, 20×): page after **44 min**; **18%** of the budget.
- **Slow leak** (0.3% for 3 days, 3×): never pages, spends **32%** — only the ticket, after **22.4 h**.
- **Short blip** (10% for 5 min): nothing fires, **1.2%** — that is what the budget is for.

<p class="small">SLI / SLO / SLA page → "Multiwindow alerts", simulator <code>error-budget-burn</code>.</p>

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

**Wrong thing**: an SLI from the health check says nothing about `POST /orders`. **Averages**: a mean of 80 ms can hide 5% waiting 4 s. **Mixed windows** (30 vs 28 days). **One long alert window**. **SLO without a policy**: just a number on a dashboard.

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

A deadline on every outbound call: it bounds the damage of one slow call (a gateway that gives up answers `504`).

- **Percentile-based**: near the downstream **P99.9** under normal conditions.
- **Budget-aware**: inside the caller's own deadline, retries included. **Per dependency**: one global value is almost always wrong.
- Two timeouts: **connect** (open the TCP connection) and **read** (wait for the response).

```yaml
spring.cloud.openfeign.client.config:
  product:                  # the @FeignClient name
    connect-timeout: 500    # ms
    read-timeout: 1000      # ms
```

<p class="small">A timeout alone turns a hang into a fast error: combine it with retry, circuit breaker and fallback.</p>

---

## The timeout budget across hops

<div class="flow">
<div class="box">gateway<small>waits 3 s</small></div><div class="arrow">→</div>
<div class="box">attempt 1<small>timeout at 1 s</small></div><div class="arrow">0.5 s →</div>
<div class="box">attempt 2<small>timeout at 2.5 s</small></div><div class="arrow">1 s →</div>
<div class="box red">gateway gives up<small>3 s · 504 to the client</small></div><div class="arrow">→</div>
<div class="box muted">attempt 3<small>fails at 4.5 s · for nobody</small></div>
</div>

- Order → product with this page's settings: 1 + 0.5 + 1 + 1 + 1 = **4.5 s** worst case, but the gateway waits **3 s**.
- The third attempt is wasted work and extra load on a struggling service.
- Fit it: **2 attempts** (2.5 s), a shorter read timeout, or a **deadline** passed along with the request (gRPC).

<div class="ok">

Rule: **attempts × timeout + waits** must fit inside the caller's deadline.

</div>

---

## Retry with exponential backoff and jitter

Retry only **transient** failures, spaced out so a restart is not hit by a *thundering herd*:

- **Exponential backoff**: `wait = min(c · 2ⁿ, max_wait)` → 1 s, 2 s, 4 s, 8 s, 16 s (cap): retries at t = 1, 3, 7, 15, 31 s.
- Clients that failed together still retry together → add **jitter**.
- **Full jitter** (Marc Brooker, AWS): `wait = random(0, min(c · 2ⁿ, max_wait))` — 1,000 clients spread uniformly instead of 1,000 requests at t = 1 s, 3 s and 7 s.

| Response | Retry? |
|---|---|
| connection refused / reset, timeout | yes |
| `503`, `429` | yes, with backoff (respect `Retry-After`) |
| `500` | maybe, once — often a bug |
| `400`, `401`, `403`, `404`, `422` | no — the request itself is wrong |

---

## Retry safely

<div class="flow">
<div class="box">1 click</div><div class="arrow">→</div>
<div class="box">gateway<small>3 attempts</small></div><div class="arrow">3 calls →</div>
<div class="box">order<small>3 attempts each</small></div><div class="arrow">9 calls →</div>
<div class="box">Feign client<small>3 attempts each</small></div><div class="arrow">27 calls →</div>
<div class="box red">product<small>already struggling</small></div>
</div>

- **Retry amplification**: retry at **one** layer, cap the attempts, stop when the breaker is open.
- Retrying `POST /orders` can create **duplicates**: retry only **idempotent** operations (`GET`, `PUT`, `DELETE`) — doing it twice has the same effect as once.
- **Idempotency key**: the client sends a UUID per logical operation (`Idempotency-Key: k-42`); the server stores processed keys and, on a repeat, returns the stored result — same order, no duplicate.

---

<!-- _class: tight -->

## Circuit breaker

<div class="flow">
<div class="box green">Closed<small>calls pass · last 10 recorded</small></div><div class="arrow">≥ 50% failed or slow →</div>
<div class="box red">Open<small>reject in &lt; 1 ms · no network call</small></div><div class="arrow">30 s, next call →</div>
<div class="box orange">Half-Open<small>3 probe calls</small></div><div class="arrow">probes OK → Closed<br>probes bad → Open</div>
</div>

| Resilience4j property | Default | Typical |
|---|---|---|
| `failure-rate-threshold` | 50% | 50% |
| `sliding-window-size` · `minimum-number-of-calls` | 100 · 100 | 10–20 |
| `slow-call-duration-threshold` · `slow-call-rate-threshold` | 60 s · 100% | **below the timeout** · 50% |
| `wait-duration-in-open-state` | 60 s | 10–60 s |
| `permitted-number-of-calls-in-half-open-state` | 10 | 3–5 |

<p class="small">Slow calls have their own rate: with the default 100% they open the breaker only when every call in the window is slow.</p>

---

<!-- _class: tight -->

## Circuit breaker + retry with Resilience4j

<div class="cols">
<div>

```java
// default order: Retry ( CircuitBreaker ( call ) )
@Retry(name = "product", fallbackMethod = "priceFallback")
@CircuitBreaker(name = "product")
public ProductOut findProduct(String id) { ... }
```

- Fallback on the **outer** `@Retry`: runs once, after the retries or at once when Open.
- Slow-call threshold **below** the 1 s timeout.
- `CallNotPermittedException` **not retried**.
- Spring Boot 4: `resilience4j-spring-boot4` + `spring-boot-starter-aspectj`.

</div>
<div>

```yaml
circuitbreaker.instances.product:
  sliding-window-size: 10
  minimum-number-of-calls: 10
  failure-rate-threshold: 50
  slow-call-duration-threshold: 500ms
  slow-call-rate-threshold: 50
  wait-duration-in-open-state: 30s
  permitted-number-of-calls-in-half-open-state: 3
retry.instances.product:
  max-attempts: 3            # waits 500 ms, 1 s
  enable-exponential-backoff: true
  enable-randomized-wait: true   # ± 50%
  retry-exceptions: [feign.RetryableException]
  ignore-exceptions: [...CallNotPermittedException]
```

</div>
</div>

---

## Simulator: a slow product service

<div class="q">

Order (200 threads, 60 POST /orders/s + 40 GET /orders/s) calls product, which answers in **3 s** from 10 s to 70 s.

</div>

- **No pattern**: ~**176** threads busy (60 × 3 s), pool full in **8** s → only **98.4%** of `GET /orders` OK.
- **Timeout**: ~**60** threads, `GET /orders` **100%** — every order fails after 1 s.
- **+ Retry**: pool full **51** s, `GET /orders` **71.2%**, product gets **128** calls/s instead of 60 — **worse than nothing**.
- **+ Breaker**: opens **1.1 s** after the fault, orders fail in < 1 ms, ~**2** threads busy; closes at t = **72.2 s**, 2.2 s after recovery.

<p class="small">Resilience Patterns page → "Play it", simulator <code>slow-dependency</code>. Also try "product down": timeout + retry sends 3.0 calls per order.</p>

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

<!-- _class: tight -->

## Bulkhead and rate limiting

<div class="cols">
<div>

### Bulkhead

Watertight compartments: **a cap per dependency**.

<div class="flow">
<div class="box red">payment<small>10 slots full · call 11 rejected at once</small></div>
<div class="box green">inventory<small>own 10 slots · 200 OK in 30 ms</small></div>
</div>

<p class="small">Cost: capacity that cannot be shared — a burst on one pool is refused while others sit idle. Size it with Little's law. Resilience4j: <b>semaphore</b> (<code>max-concurrent-calls</code>, default 25) or <b>thread-pool</b>.</p>

</div>
<div>

### Rate limiting

**Token bucket**: refill rate = steady throughput, capacity = burst; empty → `429`.

```nginx
limit_req_zone $binary_remote_addr
    zone=api:10m rate=10r/s;
limit_req zone=api burst=20 nodelay;
```

<p class="small">Nginx uses a <b>leaky bucket</b>; with <code>nodelay</code> 20 extra requests pass at once, then 10/s. Per user or API key: in the gateway.</p>

</div>
</div>

---

## Health checks

| Probe | Question | When it fails |
|---|---|---|
| **Liveness** | is the process alive (not stuck)? | the orchestrator **restarts** the container |
| **Readiness** | can it serve traffic now? | **removed from the load balancer**, not restarted |
| **Startup** (K8s) | has it finished starting? | liveness and readiness wait — a slow JVM is not killed at boot |

<p class="small">Actuator: <code>/actuator/health/liveness</code> and <code>/readiness</code>, enabled by default in Spring Boot 4 (in 2.3–3.x only on Kubernetes; elsewhere <code>management.endpoint.health.probes.enabled=true</code>).</p>

<div class="warn">

**Never put external dependencies in liveness**: a 10 s database blip would restart **every replica at once**. Careful even with readiness: all replicas unready = the service disappears.

</div>

---

## Defence in depth

<div class="flow">
<div class="box">rate limiter<small>edge: Nginx, gateway</small></div><div class="arrow">→</div>
<div class="box accent">retry<small>outermost</small></div><div class="arrow">→</div>
<div class="box accent">circuit breaker<small>counts every attempt</small></div><div class="arrow">→</div>
<div class="box accent">bulkhead<small>caps threads</small></div><div class="arrow">→</div>
<div class="box accent">timeout<small>bounds each attempt</small></div><div class="arrow">→</div>
<div class="box">product</div>
</div>

- **Retry outside the breaker**: an open breaker stops the retries at once.
- **Breaker outside the timeout**: timeouts count as failures. **Timeout innermost**: it bounds each attempt, not the sum.
- Resilience4j's default `Retry(CircuitBreaker(RateLimiter(TimeLimiter(Bulkhead(call)))))`; .NET's standard handler: rate limiter → total timeout → retry → breaker → attempt timeout.

<p class="small">Then check that attempts × timeout + waits fit the caller's deadline — and verify it all with chaos experiments.</p>

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

1. **Hypothesis around steady state** — measurable outputs (SLIs): request rate, error rate, latency.
2. **Vary real-world events** — crashes, partitions, disk full, clock skew, dependency timeouts, spikes.
3. **Run experiments in production** — staging does not reproduce load, data or dependencies.
4. **Automate them to run continuously** — new deploys reintroduce weaknesses.
5. **Minimise the blast radius** — the fewest users needed; widen only after small experiments pass.

<p class="small">Written down by Netflix engineers: principlesofchaos.org and an IEEE Software article (2016).</p>

---

<!-- _class: tight -->

## An experiment on the store

**Hypothesise** → **Design** → **Inject** → **Observe** → **Analyse** → **Improve**, then repeat with a wider scope.

| Step | Content |
|---|---|
| **Steady state** | `GET /orders` ≥ 99.9%, P95 < 300 ms; `POST /orders` P95 < 500 ms (Grafana, Hands-on 6) |
| **Hypothesis** | product at 3 s → the breaker opens within 10 s, `POST /orders` fails fast with `503`, `GET /orders` keeps its steady state |
| **Injection** | Toxiproxy between order and product, 3 s `latency` toxic — Compose first, later one replica |
| **Blast radius** | one environment, 10 minutes, abort if `GET /orders` < 99% |
| **Observe** | breaker state, error rate and P95 per route, busy threads, traces in Jaeger |
| **Findings?** | no Feign read timeout (default 60 s): calls take 3 s and *succeed*, the breaker never opens without a slow-call rate; retries multiply the calls |

<p class="small">A confirmed hypothesis is evidence; a <b>falsified</b> one is a finding — a bug found on your terms.</p>

---

<!-- _class: tight -->

## Fault injection and blast radius

| Category | Examples | Tools |
|---|---|---|
| **Process / instance** | kill container, out-of-memory (OOM) kill, terminate VM | Chaos Monkey, LitmusChaos |
| **Network** | latency, packet loss, partition | Toxiproxy, Gremlin, Chaos Mesh |
| **Resource** | saturate CPU, fill disk, exhaust memory | stress-ng, Gremlin |
| **Dependency** | HTTP 500, timeouts, malformed responses | WireMock, Toxiproxy |
| **State** | corrupt records, roll back a deploy, expire certificates | manual, Gremlin |
| **Infrastructure** | lose an Availability Zone or a region | Chaos Gorilla, AWS Fault Injection Service (FIS) |

**Blast radius**: tests → staging/canary → **1% of traffic** → full production. Controls: feature flags, business hours, **automated abort** on an SLI, shadow traffic.

---

## GameDay and tools

A **GameDay** is a planned, team-wide exercise — process as much as technology:

1. **Brief** the scenario (or keep it secret: a *surprise GameDay*).
2. **Execute**: inject; monitor, run the runbooks, communicate as in a real incident.
3. **Observe** time to detect and to recover, and which runbooks helped.
4. **Debrief**: a **blameless** post-mortem — a list of improvements, not of culprits.

<p class="small">Tools: Chaos Monkey (Netflix), Gremlin (SaaS), LitmusChaos and Chaos Mesh (Cloud Native Computing Foundation, Kubernetes-native), Toxiproxy (Shopify, integration tests), AWS FIS (IAM, abort conditions).</p>

---

## Observability first

Before any experiment the team must **measure** steady state (SLI dashboards), **detect** deviations (dashboards in seconds, burn-rate alerts in minutes), **attribute** causes (tracing) and **abort** safely (kill switch).

<div class="ok">

**Observability first**, then resilience patterns, then chaos experiments to prove the patterns work.

</div>

<div class="warn">

Pitfalls: chaos **without a hypothesis** is just breaking things; **starting in production** (it is the goal, not the first step); **no abort switch**; **fixing nothing** — findings that never become tickets only consumed error budget.

</div>

---

## Takeaways

1. Availability = MTTF / (MTTF + MTTR); faster recovery is often the cheapest gain. In series availabilities **multiply**; in parallel, `1 − (1 − a)ⁿ`; the **weakest links** decide.
2. Each extra **nine** is 10× less downtime — always state the **window**.
3. **Slow** dependencies exhaust threads and **cascade** upstream.
4. **SLI** measures, **SLO** targets, **SLA** contracts (looser than the SLO); the **error budget** (≈ 40.3 min per 28 days at 99.9%) and **multiwindow burn-rate alerts** decide between features and reliability.
5. Timeout (inside the caller's budget), retry + full jitter (idempotent only), circuit breaker (slow-call threshold below the timeout) + safe fallback, bulkhead, rate limit, health checks — **in designed layers**; a retry without a breaker can be worse than nothing.
6. **Chaos engineering** proves the patterns work: a hypothesis, a small blast radius, observability first.
