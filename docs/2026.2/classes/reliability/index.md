
Picture the store on a Black Friday evening. The product service is healthy, the database is healthy, but the payment provider starts answering in 3 seconds instead of 100 ms. Within a minute the gateway stops answering *everything* — login, catalogue, cart — even though nothing on those routes is broken. Nobody wrote a bug; the system simply had no defence against a slow dependency. This class is about building the defences, and about deciding with numbers how much failure is acceptable.

Reliability is the probability that a system performs its required function without failure, under stated conditions, for a specified period of time[^1]. In distributed systems, this definition expands beyond hardware to encompass software failures, network partitions, overloaded dependencies, and incorrect deployments.

A reliable system is not one that never fails. It is one that **fails gracefully, recovers quickly, and limits the blast radius of any single failure** on its users. (The **blast radius** is the set of users and components affected by one failure.)

!!! abstract "Learning objectives"

    By the end of this class you should be able to:

    - **Calculate** availability from MTTF and MTTR, the downtime allowed by a number of "nines", and the end-to-end availability of services in series and in parallel.
    - **Classify** a failure (transient, permanent, intermittent, Byzantine) and **explain** how a cascading failure spreads through exhausted resources.
    - **Define** SLIs and SLOs for a service of the store and **compute** its error budget and burn rate.
    - **Choose and configure** resilience patterns — timeout, retry with backoff and jitter, circuit breaker, bulkhead, rate limiting, health checks — for a call between two services.
    - **Design** a chaos experiment with a steady-state hypothesis and a controlled blast radius.

## Roadmap

1. **This overview** — availability, the "nines", composite availability, failure modes and cascading failures.
2. [SLI / SLO / SLA](sli-slo-sla/index.md) — how to measure reliability, set targets, and turn the gap into an error budget.
3. [Resilience Patterns](patterns/index.md) — timeout, retry, circuit breaker, bulkhead, rate limiting and health checks, and how to layer them.
4. [Chaos Engineering](chaos/index.md) — injecting failures on purpose to prove that the patterns work.
5. [Quiz](quiz.md) — check your understanding.

## Slides

<div class="slides-embed">
  <iframe src="slides/reliability.html" title="Slides: reliability" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/reliability.html){:target="_blank"}

---

## Availability

The most visible expression of reliability is **availability** — the fraction of time a system is in a functioning state. Reliability and availability are related but not identical: a service that crashes for one second every minute has poor reliability (it fails often) but still about 98% availability; a service that fails once a year but takes a week to repair is very reliable and poorly available. Availability is derived from two measurable quantities:

| Term | Full name | Meaning |
|---|---|---|
| **MTTF** | Mean Time To Failure | Average time the system operates before a failure occurs |
| **MTTR** | Mean Time To Repair (or Recover) | Average time to detect, diagnose, and restore service after a failure |
| **MTBF** | Mean Time Between Failures | MTTF + MTTR — the complete failure-and-recovery cycle |

$$
\text{Availability} = \frac{MTTF}{MTTF + MTTR}
$$

!!! example "Worked example — the order service"

    The order service crashes on average once every 30 days (MTTF = 720 h). Each time, it takes 2 hours for someone to notice, find the cause and restart it (MTTR = 2 h).

    Availability = 720 / (720 + 2) ≈ **99.72%**.

    Two ways to improve it:

    - Halve the failures (MTTF = 1440 h) → 1440 / 1442 ≈ 99.86%.
    - Let Kubernetes restart the pod automatically in 1 minute (MTTR ≈ 0.017 h) → 720 / 720.017 ≈ **99.998%**.

    Recovering faster was the bigger win — and much cheaper than never failing.

**Key insight**: reliability improves by either preventing failures (↑ MTTF) or recovering faster (↓ MTTR). Most engineering investments target one of these two levers. Incident response, automation, and runbooks primarily attack MTTR. Fault-tolerant design, testing, and redundancy primarily attack MTTF.

### The "nines" of availability

Availability targets are usually quoted as a number of "nines". The table below shows how much downtime each target allows, per window (year = 365.25 days, month = 1/12 of a year ≈ 30.44 days):

| Availability | Per year | Per month | Per 28 days | Per week |
|---|---|---|---|---|
| 90% ("one nine") | 36.5 days | 73.1 hours | 2.8 days | 16.8 hours |
| 99% ("two nines") | 3.65 days | 7.31 hours | 6.72 hours | 1.68 hours |
| 99.9% ("three nines") | 8.77 hours | 43.8 minutes | 40.3 minutes | 10.1 minutes |
| 99.95% | 4.38 hours | 21.9 minutes | 20.2 minutes | 5.04 minutes |
| 99.99% ("four nines") | 52.6 minutes | 4.38 minutes | 4.03 minutes | 1.01 minutes |
| 99.999% ("five nines") | 5.26 minutes | 26.3 seconds | 24.2 seconds | 6.05 seconds |
| 99.9999% ("six nines") | 31.6 seconds | 2.63 seconds | 2.42 seconds | 0.60 seconds |

Each additional "nine" is a 10× reduction in allowable downtime. Moving from three nines to four nines is not an incremental improvement — it requires a fundamentally different operational posture. At five nines, human reaction time is too slow; detection and recovery must be fully automated.

!!! warning "Always state the window"

    "99.9%" alone is ambiguous: it allows 43.8 minutes in a calendar month but 40.3 minutes in a 28-day window. Whenever you quote an availability number, quote the window it is measured over.

### Composite availability

Real requests cross several components, so the availability the user sees depends on how the components are combined[^3].

=== "In series (dependency chain)"

    When a request needs **every** component to work, their availabilities **multiply**. The gateway calls the order service, which calls the product service, each at 99.9%:

    $$
    A_{chain} = 0.999 \times 0.999 \times 0.999 \approx 99.7\%
    $$

    The chain is worse than any individual component. Every synchronous dependency you add lowers the ceiling.

=== "In parallel (redundant replicas)"

    When **any one** of $n$ identical, independent replicas is enough, the system is down only if all of them are down at the same time:

    $$
    A_{parallel} = 1 - (1 - a)^n
    $$

    Two gateway replicas at 99% each behind Nginx ([Hands-on 7](../../hands-on/7/index.md)): $1 - 0.01^2 = 99.99\%$. Redundancy turns two mediocre components into a very available one — as long as their failures really are independent (same bug, same host or same zone break that assumption).

``` mermaid-sim
flowchart LR
    user([User]) --> lb["Nginx"]
    lb --> g1["gateway #1<br/>99%"]
    lb --> g2["gateway #2<br/>99%"]
    g1 --> order["order<br/>99.9%"]
    g2 --> order
    order --> product["product<br/>99.9%"]
```

This is why redundancy (multiple instances) and isolation patterns (circuit breakers) exist: to break the failure-propagation chain.

---

## Failure modes

Distributed systems fail in ways that single-machine systems do not. **Partial failures** — where some components work and others do not — are far more common than total outages, and substantially harder to handle correctly.

``` mermaid-sim
flowchart TD
    F[Failure] --> T["Transient<br/>Temporary, self-healing<br/>e.g. brief network blip"]
    F --> P["Permanent<br/>Requires intervention<br/>e.g. disk crash, OOM kill"]
    F --> I["Intermittent<br/>Unpredictable recurrence<br/>e.g. memory leak, GC pause"]
    P --> CS["Crash-stop<br/>Node halts and stays halted"]
    P --> BZ["Byzantine<br/>Node behaves arbitrarily or incorrectly"]
```

| Failure class | Characteristics | Handling strategy |
|---|---|---|
| **Transient** | Self-resolves within seconds; safe to retry | Retry with exponential backoff and jitter |
| **Permanent (crash-stop)** | Node stops responding and never recovers | Circuit breaker + failover to healthy replica |
| **Intermittent** | Appears and disappears without a clear trigger | P99 latency histograms; anomaly-based alerting |
| **Byzantine** | Node returns incorrect data without crashing | Consensus protocols; checksums; input validation |

The most common failure in practice is not a crash but a **slow** response: the caller cannot tell a slow node from a dead one (see [Distributed Systems](../distributed_systems/index.md)), so it keeps waiting.

### Cascading failures

A single slow dependency can exhaust resources in its caller — thread pool slots, connection pool entries, memory — and propagate that exhaustion upstream through the entire service graph. This is the most dangerous failure pattern in microservice architectures[^2].

``` mermaid-sim
sequenceDiagram
    participant U as Users
    participant O as Order service (200 threads)
    participant P as Payment service
    U->>O: POST /orders (many per second)
    O->>P: charge (normally 100 ms)
    Note over P: degrades: 3 s per call
    Note over O: threads wait 30× longer → all 200 busy
    U->>O: GET /orders/42 (no payment needed)
    O-->>U: 503 — no free thread
    Note over U,O: unrelated routes fail too
```

The arithmetic is simple (Little's law: requests in flight = arrival rate × time each one takes). At 60 orders per second and 100 ms per payment call, about 6 threads are busy waiting on payment. At 3 s per call, 180 threads are — almost the whole pool — and every other route of the order service starves. If the gateway in turn waits on the order service, the exhaustion climbs one more level. **Timeouts, circuit breakers, and bulkheads** ([Resilience Patterns](patterns/index.md)) are the engineering response to this failure mode.

!!! warning "Common pitfalls"

    - **No timeout** on an HTTP client (or a default of minutes): one slow dependency holds threads indefinitely.
    - **Retrying blindly**: retries multiply the load on a service that is already struggling, turning a slowdown into an outage.
    - **Shared pools**: one connection or thread pool for every dependency means the worst dependency decides for all.
    - **Assuming independence**: two replicas on the same node, or with the same bad config, fail together.

---

## Connections

- [Distributed Systems](../distributed_systems/index.md) — partial failure and the impossibility of telling slow from dead.
- [Observability](../observability/index.md) — SLIs are computed from metrics; you cannot run SLOs or chaos experiments without it.
- [Event-Driven Architecture](../event_driven/index.md) — asynchronous messaging removes the caller's wait from the chain; DLQs handle poison messages.
- [Hands-on 5](../../hands-on/5/index.md) (Kubernetes self-healing), [Hands-on 7](../../hands-on/7/index.md) (replicas behind a load balancer) and [Hands-on 6](../../hands-on/6/index.md) (Prometheus and Grafana for SLIs).

## Key takeaways

- Availability = MTTF / (MTTF + MTTR); faster recovery is often the cheapest improvement.
- Each extra nine is 10× less downtime — and always state the **window** a number refers to.
- In series availabilities **multiply** (worse than any part); in parallel, redundancy gives $1-(1-a)^n$.
- Partial and **slow** failures are the norm; a slow dependency exhausts its caller's resources and **cascades** upstream.
- The rest of the class measures reliability (SLOs, error budgets), contains failures (resilience patterns), and proves the containment works (chaos engineering).

---

[^1]: IEEE Standard Glossary of Software Engineering Terminology, IEEE Std 610.12-1990.
[^2]: NYGARD, M. *Release It! Design and Deploy Production-Ready Software*, 2nd ed. Pragmatic Programmers, 2018.
[^3]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/books/){target="_blank"}. Google / O'Reilly, 2016.
