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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">System Architecture · Insper</div>

# Reliability and Resilience

**Fail gracefully, recover quickly, limit the blast radius**

<!--
Outline: (1) availability, nines, composite availability, redundancy; (2) failure modes and
cascades; (3) resilience patterns, with lab 9's values; (4) disaster recovery; (5) chaos
engineering and game days. The SLOs that judge all of it come from class 9.
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

<div class="flow">
<div class="box green">serving<small>on average for MTTF</small></div><div class="arrow">failure →</div>
<div class="box red">failed</div><div class="arrow">alert →</div>
<div class="box orange">detected</div><div class="arrow">traces →</div>
<div class="box orange">diagnosed</div><div class="arrow">restart →</div>
<div class="box green">serving</div>
</div>

- `inventory`: MTTF 720 h, MTTR 2 h → **99.72%**. Halve failures → 99.86%. Auto-restart in 1 min → **99.998%**.

<div class="ok">

Recovering faster is usually the **cheaper** lever — and each arrow of the MTTR is a separate number to cut.

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

<div class="flow">
<div class="box muted" style="flex: .5">fan</div><div class="arrow">→</div>
<div class="box">load balancer<small>99.99%</small></div><div class="arrow">→</div>
<div class="group"><div class="caption">in parallel: any one</div><div class="box green">gateway × 3<small>1 − 0.005³</small></div></div><div class="arrow">→</div>
<div class="group"><div class="caption">in parallel</div><div class="box green">order × 3</div><div class="box green">inventory × 3</div></div><div class="arrow">→</div>
<div class="box orange">SQL<small>99.9%: one copy</small></div><div class="arrow">→</div>
<div class="box orange">provider<small>99.9%: one contract</small></div>
</div>

- **In series** every component is needed: `A = A₁ × A₂ × … × Aₙ` — every synchronous dependency **lowers the ceiling**.
- **In parallel** any one is enough: `A = 1 − (1 − a)ⁿ` — two replicas at 99% → **99.99%**, *if failures are independent*.

<p class="small">Purchase path (illustrative): 1 instance each ≈ 98.3% (745 min/month) → 3 replicas ≈ 99.79% → + database failover ≈ 99.84% → + second payment provider ≈ 99.94% (26 min/month). Each step exposes the next weakest link.</p>

---

## Simulator: where do the minutes go?

<div class="flow">
<div class="box">1 instance each<small>98.30% · 745 min/month</small></div><div class="arrow">2 replicas →</div>
<div class="box">99.78%<small>95 min · weakest: SQL</small></div><div class="arrow">failover + 2nd provider →</div>
<div class="box green">99.94%<small>26 min</small></div><div class="arrow">all in one zone →</div>
<div class="box red">99.84%<small>70 min · weakest: the zone</small></div>
</div>

- The overview page's **availability-path** simulator: replicas per service, SQL failover, a second provider, one availability zone (AZ) for everything.
- A third replica adds almost nothing (99.79%): replicate **the weakest link**, not the easiest one.

<div class="warn">

Redundancy counts only if its failures are **independent** — one zone (one config, one host) fails them all.

</div>

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
- AZs are ~1 ms apart (cheap protection); regions are tens of ms apart (disaster recovery).

---

## How distributed systems fail

<div class="flow">
<div class="group"><div class="caption">how long?</div><div class="box">transient · intermittent · permanent</div></div>
<div class="arrow">×</div>
<div class="group"><div class="caption">how does it behave?</div><div class="box">crash-stop · <b>slow</b> · Byzantine</div></div>
</div>

| Class | Handling |
|---|---|
| Crash (fail-stop) | health checks, restart, failover |
| Transient | retry with backoff and jitter |
| **Slow / gray failure** | timeouts, breakers that count slow calls, latency service level indicators (SLIs) |
| Byzantine / incorrect | checksums, validation, reconciliation |

<div class="warn">

The most dangerous component is not the dead one — it is the **slow** one. The caller cannot tell slow from dead, so without a deadline it waits.

</div>

---

## Cascading failure, in numbers

<div class="flow">
<div class="box muted">fans<small>100 purchases/s</small></div><div class="arrow">→</div>
<div class="box red">gateway<small>threads waiting on order</small></div><div class="arrow">→</div>
<div class="box red">order<small>200 threads, 400 needed</small></div><div class="arrow">→</div>
<div class="box orange">payment provider<small>4 s instead of 200 ms</small></div>
</div>

> calls in flight = arrival rate × time per call (Little's Law)

| Payment latency | In flight at 100/s | `order` pool of 200 |
|---|---|---|
| 200 ms | 20 | 10% busy |
| 1 s | 100 | 50% busy |
| 4 s | **400** | exhausted → every route waits |

<p class="small">Timeout caps the time per call · circuit breaker stops calling · bulkhead caps the threads. Playground: <code>cascading-failure</code>.</p>

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

<div class="flow">
<div class="box">edge<small>10 s</small></div><div class="arrow">></div>
<div class="box">gateway<small>5 s</small></div><div class="arrow">></div>
<div class="box accent">order → payment<small>1 s × 3 attempts + backoff ≈ 3.6 s</small></div><div class="arrow">but</div>
<div class="box red">payment → provider<small>2 s: longer than its caller</small></div>
</div>

- Near the dependency's normal **p99.9**: lab 9 uses **500 ms** to connect and **1 s** to read (`PAYMENT_READ_TIMEOUT`).
- **Per dependency**, shrinking with depth; propagate the deadline (gRPC deadlines, a header over HTTP).
- A timeout on a charge leaves an **unknown outcome** → idempotency key `order-<id>`.

<p class="small">The lab's adapter waits 2 s for the provider: `order` gives up first and `payment` works for nobody. In production, give the adapter less than its caller.</p>

---

## Retries: amplification, jitter, budgets

- Retry **transient** failures only (connect errors, `503`, `429`); never `4xx` or "card declined".
- **One layer**: 3 layers × up to 3 attempts = **27** calls per click.
- Waits add up: 1, 2, 4 s → retries at **1, 3 and 7 s** after the first failure.
- **Full jitter**: `wait = random(0, base · 2ⁿ)` — 1,000 clients failing together recover in ~1.5 s instead of waves for 15 s.
- **Retry budget** (retries ≤ 10% of traffic): without it, retries can keep a system **metastably** down.

<p class="small">Lab 9: 3 attempts, 200 ms × 2 ± 50%, on I/O errors, 5xx and resets. Playground: <code>retry-storm</code>.</p>

---

## Circuit breaker and fallback

<div class="flow">
<div class="box green">closed<small>calls flow · last 20 counted (min 10)</small></div><div class="arrow">≥ 50% failed or > 800 ms →</div>
<div class="box red">open<small>fail in µs for 10 s</small></div><div class="arrow">10 s →</div>
<div class="box orange">half-open<small>3 probes decide</small></div>
</div>

- Opens at a rate **≥** the threshold; slow calls have **their own** rate. Half-open judges the **probes' rates**.
- Slow-call threshold **below the timeout** (800 ms < 1 s): a call past the timeout is a failure, never "slow".
- Resilience4j defaults: window 100, minimum 100, wait 60 s, 10 probes, slow calls at 60 s / 100% — far too slow to react.
- 10 s open = up to ~10 s of "payment temporarily unavailable" after the provider recovers. **Never fake success**.

---

## Bulkheads and load shedding

<div class="cols">
<div>

### Bulkhead

<div class="flow">
<div class="box">order<small>50 threads</small></div><div class="arrow">→</div>
<div class="group"><div class="box orange">payment<small>10 permits, no queue</small></div><div class="box green">everything else<small>40 threads</small></div></div>
</div>

- 20 payments/s × 0.2 s = **4** in flight → 10 = 2.5× slack.
- Provider at 3 s → **10** threads wait, not 60.
- Cost: capacity that **cannot be shared**.

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

<!-- _class: tight -->

## The stack on order → payment (lab 9)

<div class="flow">
<div class="box">charge</div><div class="arrow">→</div>
<div class="box accent">Retry<small>3 attempts</small></div><div class="arrow">→</div>
<div class="box accent">CircuitBreaker<small>open? 503</small></div><div class="arrow">→</div>
<div class="box accent">Bulkhead<small>full? 503</small></div><div class="arrow">→</div>
<div class="box">HTTP<small>500 ms / 1 s</small></div>
</div>

```yaml
resilience4j:
  retry.instances.payment:
    max-attempts: ${PAYMENT_RETRY_ATTEMPTS:3}   # 200 ms, 400 ms, ± 50%
  circuitbreaker.instances.payment:
    sliding-window-size: 20                      # min 10 calls
    failure-rate-threshold: 50
    slow-call-duration-threshold: 800ms
    wait-duration-in-open-state: 10s
  bulkhead.instances.payment:
    max-concurrent-calls: ${PAYMENT_BULKHEAD:10}
    max-wait-duration: 0
```

<p class="small">Outermost first, each for a reason: the retry outside the breaker (an open breaker stops it), the fallback on the retry (runs once), the timeout innermost (bounds each attempt). Same order in Microsoft's .NET standard resilience handler. Measured: <code>GET /orders/{id}</code> median 9.04 s unprotected, 6.5 ms protected.</p>

---

## Simulator: what stops a slow provider?

<div class="flow">
<div class="box red">nothing<small>50 threads busy · ~220 payments with no thread</small></div><div class="arrow">→</div>
<div class="box orange">timeout<small>~20 threads · 0% succeed</small></div><div class="arrow">→</div>
<div class="box orange">+ retries<small>2× load · pool full again</small></div><div class="arrow">→</div>
<div class="box green">+ breaker<small>opens at 1.6 s · ~1 thread</small></div>
</div>

- The patterns page's **resilience** simulator: provider at 4 s, lab 9's switches, one at a time.
- Drag the latency back to 200 ms: 10 s after opening, half-open, 3 probes, closed.

<div class="warn">

Timeout + retries **without** a breaker is worse than nothing: 0 payments succeed per 10 s (128 with nothing on), the pool is full again and the provider takes 2× the load.

</div>

---

## Health checks

| Probe | Question | On failure |
|---|---|---|
| **Startup** | finished booting? | keep waiting (up to a limit) |
| **Liveness** | process stuck? | **restart** the container |
| **Readiness** | can serve traffic now? | **remove from the load balancer** |

<div class="warn">

Never put dependencies in **liveness**: if `order`'s liveness checks the payment provider, one provider blip restarts **every `order` replica at once**.

</div>

<p class="small">Spring Boot 4: <code>/actuator/health/liveness</code> and <code>/readiness</code> are on by default (before, only on Kubernetes).</p>

---

## Disaster recovery (DR): how much data, how much time?

- **Recovery point objective (RPO)**: how much **data** (in time) you accept to lose.
- **Recovery time objective (RTO)**: how long until the service is **back**.
- Set **per data class**: payments ≈ 0 / 15 min · catalog 1 h / 1 h · analytics 24 h / 2 days.

<div class="warn">

**Replication is not backup**: the standby replicates `DELETE FROM orders` in milliseconds. Logical failures need **backups with point-in-time recovery (PITR)** — and a **measured** restore time (2 TB at 200 MB/s ≈ 2.8 h).

</div>

<p class="small">3-2-1 backups + one immutable copy; separate account; test restores monthly (remember GitLab, 2017).</p>

---

## The four disaster-recovery strategies

<div class="flow">
<div class="box">backup and restore<small>backups + infrastructure as code<br>RPO hours · RTO hours–day · $</small></div><div class="arrow">→</div>
<div class="box accent">pilot light<small>data replicated, services off<br>RPO minutes · RTO tens of min · $$</small></div><div class="arrow">→</div>
<div class="box orange">warm standby<small>full copy, scaled down, running<br>RPO s–min · RTO minutes · $$$</small></div><div class="arrow">→</div>
<div class="box green">active-active<small>full copies, all serving<br>RPO ≈ 0 · RTO ≈ 0 · $$$$</small></div>
</div>

- Cross-region replication is usually asynchronous: **RPO = replication lag**.
- BoxOffice tier 0 (`order`, `payment`, `inventory`): **warm standby** — restore is too slow, active-active double-sells seats.

<p class="small">Data residency (Brazil's LGPD, Europe's GDPR) constrains which regions can hold the copy.</p>

---

## Regional failover

> RTO ≈ detect (2 min) + decide (5) + promote the database (1) + scale up (5) + Domain Name System (DNS) time to live (TTL) (1) ≈ 14 min

- Detect **from outside** the region; decide with a rehearsed runbook.
- **Fence** the old primary — two primaries = double-sold seats.
- **Static stability**: images, secrets, quotas already in region B.
- Seats cannot be multi-leader: **home region per event** + warm standby, or a globally consistent database.

<p class="small">Playground: <code>multi-region</code> — fail the primary region, then change the DNS TTL.</p>

---

## Chaos engineering

<div class="flow">
<div class="box">steady state<small>SLIs</small></div><div class="arrow">→</div>
<div class="box">hypothesis</div><div class="arrow">→</div>
<div class="box orange">inject<small>one real fault</small></div><div class="arrow">→</div>
<div class="box">observe</div><div class="arrow">→</div>
<div class="box">analyse</div><div class="arrow">→</div>
<div class="box green">improve<small>then widen</small></div>
</div>

- BoxOffice: Toxiproxy adds **3 s** to the provider under lab 9's k6 load → expect the breaker open < 10 s and `browse` flat — purchases are **not** in the steady state, the hypothesis expects them to fail fast.
- Small blast radius: Compose → staging → one canary pod → wider; **abort** on burn rate > 10×.
- **Observability first**: dashboards show the drop in seconds, alerts in minutes — then break things.

<p class="small">Netflix wrote the principles down (principlesofchaos.org, IEEE Software 2016). Tools: Toxiproxy, Chaos Mesh, AWS Fault Injection Service (FIS, renamed from Fault Injection Simulator in Nov 2023).</p>

---

## Game day: the flash sale

| Time | Injection | Expected |
|---|---|---|
| 10:10 | provider latency 3 s | breaker opens < 10 s; seats held |
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
| `metrics`, `alerting` | are we reliable *enough*? | SLI, service level objective (SLO), error budget, burn rate (class 9) |
| `sql`, `objstore`, `dns` | how much data and time can we lose? | RPO/RTO, PITR, DR strategies, failover |

<p class="small">Redundancy keeps instances serving, patterns contain slow dependencies, DR covers what redundancy cannot, SLOs say how much is enough — and <b>chaos</b> proves all of it.</p>

---

## Takeaways

1. Availability = MTTF / (MTTF + MTTR); series **multiply**, parallel `1 − (1 − a)ⁿ` — only with independent failures.
2. Lowering the MTTR is usually cheaper than raising the MTTF.
3. **Slow** dependencies cascade through exhausted pools — Little's Law tells you how fast.
4. Timeout · retry with jitter · breaker counting slow calls · bulkhead · honest fallback — sized with numbers.
5. Redundancy is bought: the **error budget** decides how much; DR starts from **RPO/RTO**, and replication ≠ backup.
6. **Chaos experiments and game days** prove the defences — observability first.
