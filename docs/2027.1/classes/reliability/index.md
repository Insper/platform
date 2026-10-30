It is 10:02, two minutes into the stadium on-sale. BoxOffice is holding up: the waiting room admits fans at a steady pace, `inventory` is at 60% of its capacity. Then the external payment provider starts answering in **4 seconds instead of 200 ms**. Within a minute, `order` has no free threads; the gateway, waiting on `order`, has none either; and fans who only wanted to *browse* the catalog get errors. Nothing in BoxOffice is broken — no bug, no crash, no full disk. The system simply had no defence against a slow dependency, and the slowness spread until it took everything down.

This class is about building those defences, and about deciding **with numbers** how much failure is acceptable. **Reliability** is the probability that a system performs its required function without failure, under stated conditions, for a stated period of time[^1]. In distributed systems that definition covers much more than hardware: software bugs, overloaded dependencies, network partitions, bad deploys, lost data centres and operator mistakes.

A reliable system is not one that never fails. It is one that **fails gracefully, recovers quickly and limits the blast radius** of any single failure — the **blast radius** being the set of users and components affected by one failure.

!!! quote "The story so far"

    Chapter 10 of the [story of the course](../../index.md#story). BoxOffice spreads the 10:00 crowd over stateless replicas ([class 4](../edge/index.md), [class 5](../compute/index.md)), sells each seat once ([class 6](../databases/index.md)), answers reads from a cache ([class 7](../caching/index.md)) and admits fans through a waiting room ([class 8](../messaging/index.md)); [class 9](../observability/index.md) made it visible, with an SLO per journey and one trace per checkout. Now the trace shows the problem: the payment provider answers in seconds instead of milliseconds, and nothing in BoxOffice is broken. **This class** answers: how do we keep one slow dependency from taking everything down, and how much redundancy does the SLO ask us to buy?

!!! abstract "Learning objectives"

    By the end of this class you should be able to:

    - **Calculate** availability from MTTF and MTTR, the downtime allowed by a number of "nines", and the end-to-end availability of components in series and in parallel.
    - **Explain** how a slow dependency causes a cascading failure, and **estimate** the resources it exhausts with Little's Law.
    - **Choose and configure** resilience patterns — timeouts, retries with backoff and jitter, circuit breakers, bulkheads, load shedding and rate limiting — for a call between two services, and **predict** what each one does under failure.
    - **Design** a disaster-recovery strategy from RPO and RTO targets, choosing between backup and restore, pilot light, warm standby and active-active.
    - **Plan** a chaos experiment and a game day with a steady-state hypothesis and a controlled blast radius.

## Roadmap

1. **This overview** — availability, MTTF/MTTR, the "nines", composite availability, redundancy and failover, failure modes and cascading failures.
2. [Resilience patterns](patterns/index.md) — timeout, retry with backoff and jitter, circuit breaker, bulkhead, load shedding, rate limiting, health checks, with Resilience4j.
3. [Disaster recovery](disaster-recovery/index.md) — RPO and RTO, backups, multi-AZ and multi-region, and the four DR strategies.
4. [Chaos engineering](chaos/index.md) — injecting failures on purpose to prove that the defences work; game days.
5. [Quiz](quiz.md) — check your understanding.

## Slides

<div class="slides-embed">
  <iframe src="slides/reliability.html" title="Slides: reliability and resilience" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/reliability.html){:target="_blank"}

---

## Availability

The most visible face of reliability is **availability**: the fraction of time (or of requests) in which the system works. Reliability and availability are related but not the same. A service that crashes for one second every minute fails *often* (poor reliability) but is still about 98% available; a service that fails once a year but takes a week to repair is very reliable and poorly available. Availability comes from two measurable quantities:

| Term | Full name | Meaning |
|---|---|---|
| **MTTF** | Mean Time To Failure | Average time the system runs before a failure |
| **MTTR** | Mean Time To Repair (or Recover) | Average time to detect, diagnose and restore service after a failure |
| **MTBF** | Mean Time Between Failures | MTTF + MTTR — the whole failure-and-recovery cycle |

$$
\text{Availability} = \frac{MTTF}{MTTF + MTTR}
$$

!!! example "BoxOffice: two ways to improve `inventory`"

    `inventory` crashes on average once every 30 days (MTTF = 720 h). Each time, it takes 2 hours for someone to be paged, find the problem and restart it (MTTR = 2 h).

    Availability = 720 / (720 + 2) ≈ **99.72%**.

    - Halve the failures (MTTF = 1440 h): 1440 / 1442 ≈ 99.86%.
    - Let Kubernetes detect the crash and restart the pod in 1 minute (MTTR ≈ 0.017 h): 720 / 720.017 ≈ **99.998%**.

    Recovering faster was the bigger win — and much cheaper than never failing.

Reliability work pulls one of two levers. **Raising MTTF** (fewer failures): testing, code review, redundancy, fault-tolerant design, careful deploys. **Lowering MTTR** (faster recovery): good alerts, dashboards and traces, runbooks, automatic restarts and failover, quick rollbacks. In modern systems MTTR is usually the cheaper lever, and MTTR is itself a sum — **time to detect + time to diagnose + time to fix** — each part attacked by a different practice (see [Observability](../observability/index.md)).

### The "nines"

Availability targets are quoted as a number of "nines". The table shows the downtime each target allows (year = 365.25 days, month = 1/12 of a year ≈ 30.44 days):

| Availability | Per year | Per month | Per 28 days | Per week |
|---|---|---|---|---|
| 99% ("two nines") | 3.65 days | 7.31 hours | 6.72 hours | 1.68 hours |
| 99.9% ("three nines") | 8.77 hours | 43.8 minutes | 40.3 minutes | 10.1 minutes |
| 99.95% | 4.38 hours | 21.9 minutes | 20.2 minutes | 5.04 minutes |
| 99.99% ("four nines") | 52.6 minutes | 4.38 minutes | 4.03 minutes | 1.01 minutes |
| 99.999% ("five nines") | 5.26 minutes | 26.3 seconds | 24.2 seconds | 6.05 seconds |

Each additional nine is **10× less downtime**, and it is not an incremental improvement: it changes how you operate. At three nines, a human can be paged, open a laptop and roll back. At four nines, the whole monthly budget is shorter than it takes to wake up; detection and recovery must be automatic. At five nines, even automatic failover must complete in seconds, and a single bad deploy can spend a year's budget.

!!! warning "Always state the window"
    "99.9%" alone is ambiguous: 43.8 minutes in a calendar month, 40.3 minutes in a 28-day window. Whenever you quote availability, say over which window — and whether it counts time or requests (see [SLOs](../observability/slo/index.md)).

---

## Composite availability { #composite-availability }

A request crosses many components, and the availability the user sees depends on how they are combined[^2]. Two rules cover almost every case (see also [Availability math](../estimation/availability-math/index.md)).

=== "In series (all are needed)"

    When a request needs **every** component, availabilities **multiply**:

    $$
    A_{\text{series}} = A_1 \times A_2 \times \cdots \times A_n
    $$

    Three services at 99.9% each give $0.999^3 \approx 99.7\%$. The chain is worse than its worst link, and **every synchronous dependency you add lowers the ceiling**. A service can never promise more availability than the product of the dependencies it calls synchronously.

=== "In parallel (any one is enough)"

    When **any one** of $n$ independent replicas is enough, the system fails only if all fail together:

    $$
    A_{\text{parallel}} = 1 - (1 - a)^n
    $$

    Two replicas at 99% give $1 - 0.01^2 = 99.99\%$; three give 99.9999%. Redundancy turns mediocre components into very available ones — **as long as their failures are independent**. The same bug, the same bad config, the same host or the same zone breaks that assumption.

Apply both rules to the BoxOffice purchase path. The numbers are illustrative assumptions, but the shape of the result is general:

```python exec="1" html="1"
import matplotlib.pyplot as plt
from io import StringIO

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "xtick.color": "#888",
                     "ytick.color": "#888", "axes.edgecolor": "#888", "svg.fonttype": "none"})

def parallel(a, n):                 # n independent replicas, any one is enough
    return 1 - (1 - a) ** n

MONTH_MIN = 365.25 / 12 * 24 * 60  # minutes in an average month

# Illustrative availabilities of the BoxOffice purchase path
designs = {
    "1 instance each": {
        "lb": 0.9999, "gateway": 0.995, "order": 0.995, "inventory": 0.995,
        "sql": 0.999, "payment provider": 0.999},
    "3 replicas of the\nstateless services": {
        "lb": 0.9999, "gateway": parallel(0.995, 3), "order": parallel(0.995, 3),
        "inventory": parallel(0.995, 3), "sql": 0.999, "payment provider": 0.999},
    "+ SQL with automatic\nfailover (Multi-AZ)": {
        "lb": 0.9999, "gateway": parallel(0.995, 3), "order": parallel(0.995, 3),
        "inventory": parallel(0.995, 3), "sql": 0.9995, "payment provider": 0.999},
    "+ second payment\nprovider as fallback": {
        "lb": 0.9999, "gateway": parallel(0.995, 3), "order": parallel(0.995, 3),
        "inventory": parallel(0.995, 3), "sql": 0.9995, "payment provider": parallel(0.999, 2)},
}

names, downtime = [], []
for name, parts in designs.items():
    a = 1.0
    for v in parts.values():
        a *= v                      # in series: every component is needed
    names.append(f"{name}\n{100 * a:.3f}%")
    downtime.append((1 - a) * MONTH_MIN)

fig, ax = plt.subplots(figsize=(10, 3.8))
bars = ax.barh(names[::-1], downtime[::-1], color=["#388e3c", "#7cb342", "#fb8c00", "#e53935"])
for b, d in zip(bars, downtime[::-1]):
    ax.text(b.get_width() + 3, b.get_y() + b.get_height() / 2, f"{d:.0f} min/month", va="center")
ax.set_xlabel("expected minutes per month in which a purchase cannot complete")
ax.set_xlim(0, max(downtime) * 1.25)
ax.grid(True, axis="x", alpha=0.3)
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

Reading the chart from top to bottom:

- With **one instance of everything**, the three services at 99.5% dominate: about 98.3%, over 12 hours a month without purchases.
- **Three replicas** of the stateless services make them practically perfect, and the bottleneck moves to the components that are *not* replicated: the database and the external payment provider.
- **Automatic database failover** (a standby in another zone) and a **second payment provider** attack those. Each step removes the current weakest link — and the next weakest becomes visible.

``` diagram-sim
flowchart LR
    fan(["fan"]) --> lb["load balancer<br/>99.99%"]
    lb --> g1["gateway #1"]
    lb --> g2["gateway #2"]
    lb --> g3["gateway #3"]
    g1 --> o["order × 3"]
    g2 --> o
    g3 --> o
    o --> i["inventory × 3"]
    i --> db[("SQL primary<br/>+ standby in AZ-b")]
    o --> p1["payment provider A<br/>99.9%"]
    o -.->|"fallback"| p2["payment provider B<br/>99.9%"]
```

!!! tip "Redundancy has a price tag"
    Each step in the chart costs money (three times the instances, a standby database, a second provider contract) and complexity (failover logic, testing the fallback). Reliability is bought, not free: the [error budget](../observability/slo/index.md) is how you decide how much to buy.

---

## Redundancy and failover

Redundancy only helps if traffic actually moves away from the failed component — that is **failover** — and if the redundant copy is ready to take it.

| Pattern | How it works | Failover time | Cost | BoxOffice example |
|---|---|---|---|---|
| **Active-active** | All copies serve traffic; the load balancer stops sending to a failed one | Seconds (health-check interval) | Each copy must absorb the extra load | Stateless `gateway`, `order`, `catalog` replicas |
| **Active-passive (hot standby)** | A standby receives replicated state and is promoted on failure | Seconds to a few minutes | Standby is paid for but idle | PostgreSQL primary + synchronous standby in another zone |
| **Cold standby** | Copy is started (or restored) only after a failure | Minutes to hours | Cheapest | Analytics workers, rebuilt from images |

Two rules make redundancy work:

- **N + 1 (or N + 2) capacity.** If the flash sale needs 6 `order` replicas, run 7 or 8: after losing one (or during a rolling deploy), the rest must still carry the peak. With replicas spread over **3 availability zones**, losing a whole zone removes a third of capacity — plan for it.
- **Stateless where possible.** Stateless services fail over trivially. State (databases, caches, queues) needs replication, and replication brings the hard questions: synchronous or asynchronous, how much data can be lost, and how to avoid two primaries at once (**split brain**; see [Consensus](../distributed/consensus/index.md)). The [disaster recovery](disaster-recovery/index.md) page treats failover across regions.

!!! info "Availability zones and regions"
    An **availability zone** (AZ) is one or more data centres with independent power, cooling and networking, a few kilometres from the other zones of the same **region**; latency between zones is about a millisecond. Spreading replicas across zones protects against a data-centre failure at almost no latency cost. Spreading across **regions** (hundreds or thousands of kilometres apart) protects against a regional disaster, but every synchronous call between regions costs tens of milliseconds.

---

## Failure modes

Distributed systems fail in ways a single machine does not. **Partial failures** — some components work and others do not — are far more common than total outages, and harder to handle.

| Failure class | Characteristics | Handling strategy |
|---|---|---|
| **Crash (fail-stop)** | The process dies and stays dead | Health checks, restart, failover to a replica |
| **Transient** | Self-resolves within seconds (network blip, leader election) | Retry with backoff and jitter |
| **Slow / gray failure** | Still answering, but slowly or with some errors; health checks may still pass | Timeouts, circuit breakers, outlier detection, latency SLIs |
| **Intermittent** | Appears and disappears (GC pauses, a leaking resource) | Percentile latency, anomaly detection, profiling |
| **Byzantine / incorrect** | Returns wrong data without crashing (bit flips, corrupted cache, bug) | Checksums, validation, reconciliation |
| **Correlated** | Many components fail together (bad deploy, expired certificate, zone outage) | Gradual rollouts, diversity, multi-zone, chaos tests |

The most dangerous of these is not the crash but the **slow** component. A crashed dependency answers immediately — with a connection error — and the caller moves on. A slow dependency holds the caller's resources while it thinks. The caller cannot tell slow from dead (see [Distributed systems](../distributed/index.md)), so without a deadline it waits.

### Cascading failures { #cascading-failures }

A slow dependency exhausts a resource in its caller — threads, connections, memory — and the exhausted caller becomes slow for *its* callers. The exhaustion climbs the call graph until unrelated features fail. This is the most common way microservice systems go down[^3].

``` diagram-sim
sequenceDiagram
    participant F as Fans
    participant G as gateway
    participant O as order (200 threads)
    participant P as payment provider
    F->>G: POST /orders (100 per second)
    G->>O: create order
    O->>P: charge (normally 200 ms)
    Note over P: degrades: 4 s per call
    Note over O: 100/s × 4 s = 400 calls in flight > 200 threads
    F->>G: GET /events/ev-88 (catalog)
    G->>O: (gateway threads also waiting on order)
    G-->>F: 503 — no free thread
    Note over F,G: browsing fails too, although catalog is healthy
```

The arithmetic is Little's Law (see [Queueing](../estimation/queueing/index.md)): **calls in flight = arrival rate × time each call takes.**

| Payment latency | Calls in flight at 100 purchases/s | `order` thread pool (200) |
|---|---|---|
| 200 ms (normal) | 100 × 0.2 = **20** | 10% busy |
| 1 s | 100 × 1 = **100** | 50% busy |
| 4 s | 100 × 4 = **400** | exhausted: requests queue, then time out |

Nothing about the purchase rate changed. A 20× increase in a dependency's latency became a 20× increase in occupied threads. When the pool is full, every route of `order` waits — including the ones that never call payment — and the gateway, waiting on `order`, fills its own pool.

Three things stop the cascade, each covered in [Resilience patterns](patterns/index.md):

- A **timeout** caps how long one call can hold a thread (1 s timeout → at most 100 threads, not 400).
- A **circuit breaker** stops calling a dependency that is failing, so calls fail in microseconds instead of seconds.
- A **bulkhead** gives payment calls their own limited pool, so they cannot take the threads of other routes.

!!! info "Try it in the playground"

    The `cascading-failure` scenario has an app calling a slow 3rd-party API with no timeouts. Press **Run** and watch the app's busy threads climb, then its latency and errors, then the errors of routes that do not even use the 3rd party. Now add a **timeout** to the 3rd-party call and run again; then enable the **circuit breaker** and compare the error rate and p99 of the healthy routes. Open the [full playground](../../../playground/index.md) to try a bulkhead.

<div class="sdp" data-scenario="cascading-failure" data-mode="compact" data-height="540"></div>

### Other amplifiers { #other-amplifiers }

Cascades are one example of a broader family: failures that **feed themselves**.

- **Retry storms.** Every caller retries failed calls, multiplying the load on a dependency exactly when it is weakest ([patterns](patterns/index.md#retry-with-backoff-and-jitter)).
- **Thundering herd on recovery.** A service comes back and every client, cache and queue consumer hits it at the same instant; it falls over again.
- **Death spiral of autoscaling or health checks.** Overloaded instances fail their health checks and are removed, so the remaining ones get *more* load and fail too.
- **Metastable failures.** The system stays broken *after* the trigger is gone, because the work generated by the failure (retries, timeouts, cache misses) keeps it overloaded[^4]. The fix is to drop load until it recovers — load shedding, retry budgets, circuit breakers.

---

## The reliability concept map { #concept-map }

Reliability is not one component: it is a property you buy, piece by piece, across the whole palette. The map links each **palette component** (green) to the **reliability concepts** it carries (blue); the arrows show how the class builds up — redundancy and probes keep instances serving, patterns contain slow dependencies, DR covers what redundancy cannot, SLOs say how much is enough, and chaos proves it all works:

``` diagram
flowchart LR
    lbapp["lb · app"]:::comp -.- red["MTTF/MTTR, nines, series vs parallel,<br/>redundancy, N+1, multi-AZ"]:::tech
    tp["thirdparty · payment"]:::comp -.- casc["cascading failures<br/>(Little's Law)"]:::tech
    casc --> pat["timeout, retry + jitter,<br/>circuit breaker, bulkhead, fallback"]:::tech
    apigw["apigw"]:::comp -.- shed["rate limiting,<br/>load shedding"]:::tech
    hc["healthcheck"]:::comp -.- probes["liveness, readiness,<br/>startup"]:::tech
    data["sql · objstore"]:::comp -.- dr["RPO / RTO, PITR backups,<br/>DR strategies"]:::tech
    dns["dns"]:::comp -.- dr
    obs["metrics · alerting"]:::comp -.- slo["SLI, SLO, error budget,<br/>burn rate"]:::tech
    probes --> red
    pat --> shed
    pat --> chaos["chaos experiments,<br/>game days"]:::tech
    dr --> chaos
    slo --> chaos
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

| Palette component | Question it answers | Concepts | Taught in | Scenarios |
|---|---|---|---|---|
| [`lb`](../../reference/components/edge/index.md#lb), [`app`](../../reference/components/compute/index.md#app) | Does losing a replica or a zone stop the purchase? | MTTF/MTTR, nines, series vs parallel, active-active, N+1, multi-AZ | [this overview](#composite-availability) | `scale-out` |
| [`thirdparty`](../../reference/components/external/index.md#thirdparty), [`payment`](../../reference/components/external/index.md#payment) | What if a dependency gets *slow*? | cascading failures, timeout, retry + backoff + jitter, circuit breaker, bulkhead, fallback | [this overview](#cascading-failures), [Resilience patterns](patterns/index.md) | `cascading-failure`, `retry-storm`, `payment-system` |
| [`apigw`](../../reference/components/edge/index.md#apigw) | Which work do we refuse under overload? | rate limiting per client, load shedding by priority, waiting room | [Resilience patterns](patterns/index.md#load-shedding) | `rate-limiter`, `flash-sale` |
| [`healthcheck`](../../reference/components/observability/index.md#healthcheck) | Should traffic reach this instance? | liveness, readiness, startup; no dependencies in liveness | [Resilience patterns](patterns/index.md#health-checks) | `scale-out` |
| [`metrics`](../../reference/components/observability/index.md#metrics), [`alerting`](../../reference/components/observability/index.md#alerting) | Are we reliable *enough*? | SLI, SLO, error budget, burn rate, error budget policy — the target every defence here is judged by | [Observability — SLIs, SLOs and error budgets](../observability/slo/index.md) (class 9) | `observability-stack` |
| [`sql`](../../reference/components/storage/index.md#sql), [`objstore`](../../reference/components/storage/index.md#objstore) | How much data and time can we lose? | RPO/RTO, PITR, 3-2-1 backups, delayed replica | [Disaster recovery](disaster-recovery/index.md#rpo-rto) | `db-failover`, `db-replicas` |
| [`dns`](../../reference/components/edge/index.md#dns) | How do fans reach the surviving region? | multi-region, the four DR strategies, fencing, DNS TTL | [Disaster recovery](disaster-recovery/index.md#dr-strategies) | `multi-region` |
| *(all of them)* | Do the defences actually work? | steady-state hypothesis, fault injection, blast radius, game days | [Chaos engineering](chaos/index.md) | `flash-sale` (chaos) |

!!! tip "In the interview"
    When you finish a design, interviewers often ask "what happens if X fails?" or "what if X becomes slow?". Answer with a chain: *who calls X*, *what resource they hold while waiting*, *what the timeout is*, *what the fallback is*, and *what the user sees*. For BoxOffice: "payment is called by `order` with a 2 s timeout, a circuit breaker and its own bulkhead of 50 concurrent calls; when it opens, the fan sees 'payment temporarily unavailable, your seats stay held for 10 minutes' — and the catalog is unaffected." Also quote availability math: "two dependencies at three nines in series cap us at 99.8%".

!!! success "Best practices"

    - **Write the availability ceiling of each user journey before choosing components** — multiply what the path calls synchronously: two dependencies at 99.9% already cap the purchase at 99.8%. In BoxOffice: the [purchase-path chart](#composite-availability).
    - **Run N+1 replicas spread over at least two zones** — after losing one replica, or a whole zone, the rest must still carry the 10:00 peak; a call between zones costs about 1 ms.
    - **Automate recovery before chasing a higher MTTF** — restarting in 1 minute instead of 2 hours took `inventory` from 99.72% to 99.998%. In BoxOffice: probes and restarts in [Hands-on 10](../../hands-on/10/index.md).
    - **Give every dependency a written failure plan: its timeout, its fallback and what the fan sees** — decided at design time, not at 10:02. In BoxOffice: `payment` fails fast with `503` and the order stays `PENDING_PAYMENT` ([Hands-on 9](../../hands-on/9/patterns/index.md)).
    - **Move off the request path everything the fan does not wait for** — each synchronous dependency lowers the ceiling of the journey. In BoxOffice: the e-mail goes through the outbox and Kafka ([Hands-on 7](../../hands-on/7/index.md)).
    - **Track MTTR as three numbers: time to detect, to diagnose and to fix** — each one is cut by a different practice (alerts, traces, rollback). In BoxOffice: the game-day timeline of [Hands-on 9](../../hands-on/9/game-day/index.md).

!!! warning "Common pitfalls"

    - **No timeout** on an HTTP client, or a default of minutes: one slow dependency holds threads indefinitely.
    - **Assuming independence**: three replicas on the same node, or with the same bad configuration, fail together.
    - **Redundancy without failover tests**: a standby nobody has ever promoted is a hope, not a plan.
    - **Shared pools**: one thread or connection pool for every dependency lets the worst one decide for all.
    - **Measuring only crashes**: a gray failure (slow, partially wrong) passes health checks and hurts users.

---

## Related

- **Hands-on** (the week after this class and class 9): [Hands-on 8 — Observability](../../hands-on/8/index.md) first — OpenTelemetry, a RED dashboard and SLO burn-rate alerts, so that the experiments have something to show; then [Hands-on 9 — Resilience & chaos](../../hands-on/9/index.md): Resilience4j between `order` and `payment`, Toxiproxy latency and faults, a game day. [Hands-on 10 — Kubernetes](../../hands-on/10/index.md): probes and self-healing.
- **Project:** [Chaos game day](../../exercises/project/game-day/index.md).
- **Case studies:** [Payment system](../case-studies/payment-system/index.md), [Ticketing (BoxOffice flash sale)](../case-studies/ticketing/index.md).
- **Classes:** [Estimation — availability math](../estimation/availability-math/index.md), [Observability](../observability/index.md) (previous class, the same week: the SLOs, dashboards and alerts these defences are judged by), [Messaging](../messaging/index.md) (asynchrony removes dependencies from the critical path), [Cloud-Native](../cloud-native/index.md) (next class: probes, self-healing, autoscaling).

## What breaks next { #what-breaks-next }

The patterns contain a slow provider, redundancy and the DR plan cover lost machines and regions, and chaos experiments prove both. But every defence on this page assumes that *something* restarts a dead replica, adds replicas before 10:00 and rolls a bad release back — and on one laptop with Compose, that something is you. The `inventory` example above improved from 99.72% to 99.998% only because the restart took 1 minute instead of 2 hours; that minute exists only if a machine does the restart. Healing, scaling at 09:45 and rolling back without a human is [class 11 — Cloud-Native](../cloud-native/index.md).

---

[^1]: IEEE. *IEEE Standard Glossary of Software Engineering Terminology*, IEEE Std 610.12-1990.
[^2]: BEYER, B. et al. [Site Reliability Engineering: How Google Runs Production Systems](https://sre.google/books/){target="_blank"}. O'Reilly, 2016. Chapter 3, "Embracing Risk"; chapter 22, "Addressing Cascading Failures".
[^3]: NYGARD, M. *Release It! Design and Deploy Production-Ready Software*, 2nd ed. Pragmatic Bookshelf, 2018. Chapter "Stability Antipatterns".
[^4]: BRONSON, N. et al. [Metastable Failures in Distributed Systems](https://sigops.org/s/conferences/hotos/2021/papers/hotos21-s11-bronson.pdf){target="_blank"}. In: *Workshop on Hot Topics in Operating Systems (HotOS)*, 2021.
