
Reliability is the probability that a system performs its required function without failure, under stated conditions, for a specified period of time[^1]. In distributed systems, this definition expands beyond hardware to encompass software failures, network partitions, overloaded dependencies, and incorrect deployments.

A reliable system is not one that never fails. It is one that **fails gracefully, recovers quickly, and limits the blast radius of any single failure** on its users.

---

## Availability

The most visible expression of reliability is **availability** — the fraction of time a system is in a functioning state. It is derived from two measurable rates:

| Term | Full name | Meaning |
|---|---|---|
| **MTTF** | Mean Time To Failure | Average time the system operates before a failure occurs |
| **MTTR** | Mean Time To Repair | Average time to detect, diagnose, and restore service after a failure |
| **MTBF** | Mean Time Between Failures | MTTF + MTTR — the complete failure-and-recovery cycle |

$$
\text{Availability} = \frac{MTTF}{MTTF + MTTR}
$$

**Key insight**: reliability improves by either preventing failures (↑ MTTF) or recovering faster (↓ MTTR). Most engineering investments target one of these two levers. Incident response, automation, and runbooks primarily attack MTTR. Fault-tolerant design, testing, and redundancy primarily attack MTTF.

### The "nines" of availability

| Availability | Annual downtime | Monthly downtime | Weekly downtime |
|---|---|---|---|
| 90% ("one nine") | 36.5 days | 72.0 hours | 16.8 hours |
| 99% ("two nines") | 3.65 days | 7.2 hours | 1.68 hours |
| 99.9% ("three nines") | 8.77 hours | 43.8 minutes | 10.1 minutes |
| 99.95% | 4.38 hours | 21.9 minutes | 5.0 minutes |
| 99.99% ("four nines") | 52.6 minutes | 4.38 minutes | 1.01 minutes |
| 99.999% ("five nines") | 5.26 minutes | 25.9 seconds | 6.05 seconds |
| 99.9999% ("six nines") | 31.5 seconds | 2.6 seconds | 0.6 seconds |

Each additional "nine" is a 10× reduction in allowable downtime. Moving from three nines to four nines is not an incremental improvement — it requires a fundamentally different operational posture. At five nines, human reaction time is too slow; detection and recovery must be fully automated.

!!! info "Composite availability"
    When services form a dependency chain, their availabilities multiply. Three services each at 99.9% yield `0.999³ ≈ 99.7%` end-to-end availability — worse than any individual component. This is why redundancy (multiple instances) and isolation patterns (circuit breakers) exist: to break the failure-propagation chain.

---

## Failure modes

Distributed systems fail in ways that single-machine systems do not. Partial failures — where some components work and others do not — are far more common than total outages, and substantially harder to handle correctly.

``` mermaid
flowchart TD
    F[Failure] --> T[Transient\nTemporary, self-healing\ne.g. brief network blip]
    F --> P[Permanent\nRequires intervention\ne.g. disk crash, OOM kill]
    F --> I[Intermittent\nUnpredictable recurrence\ne.g. memory leak, GC pause]
    P --> CS[Crash-stop\nNode halts and stays halted]
    P --> BZ[Byzantine\nNode behaves arbitrarily or incorrectly]
```

| Failure class | Characteristics | Handling strategy |
|---|---|---|
| **Transient** | Self-resolves within seconds; safe to retry | Retry with exponential backoff and jitter |
| **Permanent (crash-stop)** | Node stops responding and never recovers | Circuit breaker + failover to healthy replica |
| **Intermittent** | Appears and disappears without a clear trigger | P99 latency histograms; anomaly-based alerting |
| **Byzantine** | Node returns incorrect data without crashing | Consensus protocols; checksums; input validation |

### Cascading failures

A single slow dependency can exhaust resources in its caller — thread pool slots, connection pool entries, memory — and propagate that exhaustion upstream through the entire service graph. This is the most dangerous failure pattern in microservice architectures[^2].

``` mermaid
flowchart LR
    client -->|many concurrent requests| gateway:::saturated
    gateway -->|requests queue up\nwaiting for reply| payment:::slow
    client:::failed

    classDef slow fill:#f90,color:#000
    classDef saturated fill:#f66,color:#fff
    classDef failed fill:#900,color:#fff
```

A payment service degrading from 100 ms to 3 s response time causes the gateway's thread pool to fill with blocked threads, starving all other traffic — even routes unrelated to payments. **Timeouts, circuit breakers, and bulkheads** are the engineering response to this failure mode.

---

## Topics covered

<div class="grid cards" markdown>

-   :material-gauge:{ .lg .middle } **SLI / SLO / SLA**

    ---

    How to define, measure, and commit to reliability targets. Covers Service Level Indicators, Objectives, Agreements, and the error budget model that drives engineering decisions.

    [:octicons-arrow-right-24: SLI / SLO / SLA](sli-slo-sla/)

-   :material-shield-refresh:{ .lg .middle } **Resilience Patterns**

    ---

    Engineering techniques that prevent transient failures from becoming outages: Timeout, Retry with exponential backoff, Circuit Breaker, Bulkhead, and Rate Limiting.

    [:octicons-arrow-right-24: Resilience Patterns](patterns/)

-   :material-lightning-bolt:{ .lg .middle } **Chaos Engineering**

    ---

    The discipline of proactively injecting failures into production to discover weaknesses before they become incidents. Covers the principles, tools, and practices behind controlled chaos experiments.

    [:octicons-arrow-right-24: Chaos Engineering](chaos/)

</div>

---

[^1]: IEEE Standard Glossary of Software Engineering Terminology, IEEE Std 610.12-1990.
[^2]: NYGARD, M. *Release It! Design and Deploy Production-Ready Software*, 2nd ed. Pragmatic Programmers, 2018.
[^3]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/books/){target="_blank"}. Google / O'Reilly, 2016.
