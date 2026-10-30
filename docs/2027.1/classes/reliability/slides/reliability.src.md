---
marp: true
lang: en
title: Reliability and Resilience
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

# Reliability and Resilience

**Fail gracefully, recover quickly, limit the blast radius**

<!--
Outline: (1) availability, nines, composite availability, redundancy; (2) failure modes and
cascades; (3) SLIs, SLOs, error budgets; (4) resilience patterns; (5) disaster recovery;
(6) chaos engineering and game days.
-->

---

## 10:02 on the stadium on-sale

<div class="q">

The payment provider goes from **200 ms to 4 s**. Nothing in BoxOffice is broken.
Why do fans who only want to **browse the catalog** get errors a minute later?

</div>

* `order` waits on payment with no deadline → its threads fill up.
* The gateway waits on `order` → its threads fill up too.
* Every route shares those threads → **the slowness spreads** to healthy features.

<!--
Let the class reason. The rest of the class: measure how much failure is acceptable, build
defences, recover from disasters, and prove the defences work.
-->

---

## Availability: two levers

| Term | Meaning |
|---|---|
| **MTTF** | mean time to failure — how long it runs |
| **MTTR** | mean time to repair — detect + diagnose + fix |

> Availability = MTTF / (MTTF + MTTR)

- `inventory`: MTTF 720 h, MTTR 2 h → **99.72%**.
- Halve failures → 99.86%. Auto-restart in 1 min → **99.998%**.

<div class="ok">

Recovering faster is usually the **cheaper** lever.

</div>

---

## The nines

| Availability | Per month | Per 28 days | Operational posture |
|---|---|---|---|
| 99.9% | 43.8 min | 40.3 min | a human can roll back |
| 99.95% | 21.9 min | 20.2 min | fast alerts, rehearsed runbooks |
| 99.99% | 4.38 min | 4.03 min | **automated** detection and failover |
| 99.999% | 26.3 s | 24.2 s | automated in seconds; deploys are the risk |

<div class="warn">

Each nine is **10× less downtime** — and always state the **window** (and time vs requests).

</div>

---

## Composite availability

<div class="cols">
<div>

### In series

`A = A₁ × A₂ × … × Aₙ`

Three services at 99.9% → **99.7%**. Every synchronous dependency **lowers the ceiling**.

</div>
<div>

### In parallel

`A = 1 − (1 − a)ⁿ`

Two replicas at 99% → **99.99%** — if failures are **independent**.

</div>
</div>

<p class="small">BoxOffice purchase path (illustrative): 1 instance each ≈ 98.3% (745 min/month) → 3 replicas ≈ 99.79% → + DB failover ≈ 99.84% → + second payment provider ≈ 99.94% (26 min/month). Each step exposes the next weakest link.</p>

---

<!-- _class: tight -->

## Redundancy and failover

| Pattern | Failover time | BoxOffice example |
|---|---|---|
| **Active-active** | seconds (health checks) | stateless `gateway`, `order`, `catalog` replicas |
| **Active-passive (hot standby)** | seconds to minutes | PostgreSQL primary + standby in another AZ |
| **Cold standby** | minutes to hours | analytics workers rebuilt from images |

- **N + 1**: after losing one replica (or one AZ of three), the rest carry the peak.
- **Stateless** fails over trivially; **state** needs replication, fencing, no split brain.
- AZs are ~1 ms apart (cheap protection); regions are tens of ms apart (DR).

---

## How distributed systems fail

| Class | Handling |
|---|---|
| Crash (fail-stop) | health checks, restart, failover |
| Transient | retry with backoff and jitter |
| **Slow / gray failure** | timeouts, breakers that count slow calls, latency SLIs |
| Byzantine / incorrect | checksums, validation, reconciliation |
| Correlated | gradual rollouts, multi-zone, chaos tests |

<div class="warn">

The most dangerous component is not the dead one — it is the **slow** one. The caller cannot tell slow from dead, so without a deadline it waits.

</div>

---

## Cascading failure, in numbers

> calls in flight = arrival rate × time per call (Little's Law)

| Payment latency | In flight at 100/s | `order` pool of 200 |
|---|---|---|
| 200 ms | 20 | 10% busy |
| 1 s | 100 | 50% busy |
| 4 s | **400** | exhausted → every route waits |

- **Timeout** caps the time per call · **circuit breaker** stops calling · **bulkhead** caps the threads.

<p class="small">Playground: <code>cascading-failure</code> — add a timeout, then a breaker, and watch the healthy routes.</p>

---

## Failures that feed themselves

- **Retry storms**: retries multiply load when the dependency is weakest.
- **Thundering herd** on recovery: everyone reconnects at the same instant.
- **Health-check death spiral**: overloaded instances are removed, the rest get more load.
- **Metastable failure**: the trigger is gone, but the work it created (retries, timeouts, misses) keeps the system down.

<div class="ok">

The way out is to **drop load**: load shedding, retry budgets, circuit breakers.

</div>

---

## Timeouts and deadline budgets

| Layer | Budget |
|---|---|
| Gateway | 6 s |
| `order` purchase handler | 5 s |
| `order` → `payment` | 2 s × 2 attempts + backoff ≈ 4.3 s |
| `payment` → provider | 1.8 s |

- Set near the dependency's normal **p99.9**; **connect** (300 ms) and **read** (2 s) timeouts.
- **Per dependency**, shrinking with depth; propagate the deadline (gRPC deadlines).
- A timeout on a charge leaves an **unknown outcome** → idempotency key.

---

## Retries: amplification, jitter, budgets

- Retry **transient** failures only (connect errors, `503`, `429`); never `4xx` or "card declined".
- **One layer**: 3 layers × 3 attempts = **27** calls per click.
- **Full jitter**: `wait = random(0, base · 2ⁿ)` — 1,000 clients failing together recover in ~1.5 s instead of waves for 15 s.
- **Retry budget** (retries ≤ 10% of traffic): without it, retries can keep a system **metastably** down.

<p class="small">Playground: <code>retry-storm</code> — switch to backoff + jitter and add a retry budget.</p>

---

## Circuit breaker and fallback

**Closed** → (≥ 50% failures **or slow calls** over 20) → **Open** (30 s) → **Half-open** (3 probes) → Closed / Open

- Open = fail in microseconds: threads free, dependency gets breathing room.
- **Ignore business errors**: a declined card is a correct answer.
- **Fallback** = graceful degradation: hide recommendations, stale search results…
- For payment: **never fake success** — "payment temporarily unavailable, seats held for 10 min".

---

## Bulkheads and load shedding

<div class="cols">
<div>

### Bulkhead

- One pool **per dependency**.
- 100 calls/s × 0.2 s = **20** in flight → bulkhead of **50**.
- Payment at 4 s → at most 50 threads wait, not 400.

</div>
<div>

### Load shedding

- Reject **early and cheap** (`503` + `Retry-After`).
- By **priority**: purchase > browsing > recommendations.
- Drop stale work; adaptive concurrency limits.

</div>
</div>

<p class="small">Rate limiting is per client (token bucket at the gateway); load shedding protects the whole system. The waiting room is load shedding done kindly.</p>

---

## Resilience4j on order → payment

```yaml
resilience4j:
  bulkhead.instances.payment:
    max-concurrent-calls: 50
  circuitbreaker.instances.payment:
    sliding-window-size: 20
    failure-rate-threshold: 50
    slow-call-duration-threshold: 1500ms
    wait-duration-in-open-state: 30s
  retry.instances.payment:
    max-attempts: 2
    wait-duration: 200ms
    enable-randomized-wait: true
```

<p class="small">Default order: Retry(CircuitBreaker(RateLimiter(TimeLimiter(Bulkhead(call))))) — every attempt is counted by the breaker. Plus <code>Idempotency-Key</code> on every charge.</p>

---

## Health checks

| Probe | Question | On failure |
|---|---|---|
| **Startup** | finished booting? | keep waiting (up to a limit) |
| **Liveness** | process stuck? | **restart** the container |
| **Readiness** | can serve traffic now? | **remove from the load balancer** |

<div class="warn">

Never put dependencies in **liveness**: a 20-second database blip restarts **every replica at once**.

</div>

---

## Disaster recovery: RPO and RTO

- **RPO**: how much **data** (in time) you accept to lose.
- **RTO**: how long until the service is **back**.
- Set **per data class**: payments ≈ 0 / 15 min · catalog 1 h / 1 h · analytics 24 h / 2 days.

<div class="warn">

**Replication is not backup**: the standby replicates `DELETE FROM orders` in milliseconds. Logical failures need **backups with point-in-time recovery** — and a **measured** restore time (2 TB at 200 MB/s ≈ 2.8 h).

</div>

<p class="small">3-2-1 backups + one immutable copy; separate account; test restores monthly (remember GitLab, 2017).</p>

---

## The four DR strategies

| Strategy | In the recovery region before the disaster | RPO | RTO | Cost |
|---|---|---|---|---|
| Backup and restore | backups + infrastructure as code | hours | hours–day | $ |
| Pilot light | data replicated; services off | minutes | tens of min–hours | $$ |
| Warm standby | full copy, scaled down, running | seconds–min | minutes | $$$ |
| Active-active | full copies, all serving | ≈ 0 | ≈ 0 | $$$$ |

<p class="small">Cross-region replication is usually asynchronous: RPO = replication lag. Data residency (LGPD/GDPR) constrains regions.</p>

---

## Regional failover

> RTO ≈ detect (2 min) + decide (5) + promote DB (1) + scale up (5) + DNS TTL (1) ≈ 14 min

- Detect **from outside** the region; decide with a rehearsed runbook.
- **Fence** the old primary — two primaries = double-sold seats.
- **Static stability**: images, secrets, quotas already in region B.
- Seats cannot be multi-leader: **home region per event** + warm standby, or a globally consistent DB.

<p class="small">Playground: <code>multi-region</code> — fail the primary region, then change the DNS TTL.</p>

---

## Chaos engineering

Experiments that build confidence the system **withstands turbulent conditions in production**.

1. **Steady state** as SLIs → 2. **hypothesis** → 3. **inject** one real fault → 4. **observe** → 5. **analyse** → 6. **improve**.

- BoxOffice: Toxiproxy adds **3 s** to the provider under k6 load → expect breaker open < 30 s, catalog flat.
- Small blast radius: Compose → staging → one canary pod → wider; **abort** on burn rate > 10×.
- Tools: Toxiproxy, Chaos Mesh, LitmusChaos, AWS FIS, Azure Chaos Studio, Gremlin.

---

## Game day: the flash sale

| Time | Injection | Expected |
|---|---|---|
| 10:10 | provider latency 3 s | breaker opens; seats held |
| 10:25 | one `order` pod killed per minute | N+1 absorbs it |
| 10:40 | Kafka broker stopped | outbox grows and drains; no lost e-mails |
| 10:55 | database failover | ~30 s of write errors |
| 11:10 | Redis flushed | stampede protection holds |

<div class="ok">

Roles: game master, on-call, observers, scribe. Output: a **blameless** list of improvements.

</div>

---

<!-- _class: tight -->

## The reliability concept map

| Component | Question it answers | Key concepts |
|---|---|---|
| `lb`, `app` | does losing a replica or a zone stop us? | nines, series/parallel, N+1, multi-AZ |
| `thirdparty`, `payment` | what if a dependency gets *slow*? | timeout, retry + jitter, breaker, bulkhead |
| `apigw` | what do we refuse under overload? | rate limiting, load shedding, waiting room |
| `healthcheck` | should traffic reach this instance? | liveness, readiness, startup |
| `metrics`, `alerting` | are we reliable *enough*? | SLI, SLO, error budget, burn rate |
| `sql`, `objstore`, `dns` | how much data and time can we lose? | RPO/RTO, PITR, DR strategies, failover |

<p class="small">Redundancy keeps instances serving, patterns contain slow dependencies, DR covers what redundancy cannot, SLOs say how much is enough — and <b>chaos</b> proves all of it.</p>

---

## Takeaways

1. Availability = MTTF / (MTTF + MTTR); series **multiply**, parallel `1 − (1 − a)ⁿ`.
2. **Slow** dependencies cascade through exhausted pools — Little's Law tells you how fast.
3. SLOs per user journey; the **error budget** and its **burn rate** drive deploys and alerts.
4. Timeout · one retry with jitter + budget · breaker counting slow calls · bulkhead · shedding · honest fallback.
5. DR from **RPO/RTO**: replication ≠ backup; choose the cheapest strategy that meets them.
6. **Chaos experiments and game days** prove the defences — observability first.
