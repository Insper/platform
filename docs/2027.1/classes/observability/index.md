
Saturday, 09:59. A stadium show goes on sale at 10:00 on BoxOffice: 2 million fans for 60 thousand seats. At 10:04 the support channel fills with "checkout spins forever". The team opens the dashboards: every pod is green, CPU sits at 45%, the error rate is 0.3%, the health checks pass. And yet the median fan waits nine seconds to pay. Is it the gateway? The seat holds in `inventory`? The external payment provider? The database? Four teams join a call and each one shows a dashboard proving that *their* service is fine.

This is the moment observability exists for. The system is not *down* — it is *slow in a way nobody predicted*, and the only way out is to ask new questions of the running system and get answers in minutes, not days. This class is about designing a system so that those questions can be answered: which signals to emit, how to carry context across services, when to wake a human, and how to run the incident once someone is awake.

!!! quote "The story so far"

    Chapter 9 of the [story of the course](../../index.md#story). [Class 8](../messaging/index.md) took the slow work out of the request: the order goes to an outbox, through Kafka, to `notification`, and a waiting room lets the crowd in at the pace `inventory` can serve. Asynchrony has a price: failures stop showing up in requests. An order confirmed at 10:01 whose e-mail never arrives produced no `5xx` and no slow endpoint — it vanished somewhere between the outbox, Kafka and the consumer — and dashboards of causes (pods, CPU, averages) stay green while fans fail, as on the morning above. **This class** answers: what must BoxOffice emit to follow one order across services and Kafka, what promise do we measure it against (the [SLO](slo/index.md)), and who is woken up when the promise breaks?

!!! abstract "Learning objectives"

    By the end of this class you should be able to:

    - **Distinguish** monitoring from observability and **map** the five observability components of the palette (metrics, logs, tracing, alerting, health checks) to the questions they answer.
    - **Instrument** a service with the right signal for each question, applying **RED**, **USE** and the **golden signals**, and **estimate** the cost and cardinality of the telemetry it produces.
    - **Explain** how OpenTelemetry propagates trace context across HTTP and Kafka, and **configure** a Collector pipeline with sampling.
    - **Define** SLIs and SLOs for BoxOffice's user journeys, and **compute** error budgets and burn rates.
    - **Design** SLO-based alerts with multiwindow, multi-burn-rate rules and **route** them to the right people.
    - **Configure** liveness, readiness and startup probes without causing cascading restarts.
    - **Run** an incident with clear roles and **write** a blameless postmortem with actionable follow-ups.

## Roadmap

1. **This overview** — monitoring vs observability, the observability palette, the investigation loop, health checks, and what telemetry costs.
2. [Signals](signals/index.md) — metrics, logs, traces and profiles; RED, USE and golden signals; cardinality; dashboards.
3. [SLIs, SLOs and error budgets](slo/index.md) — reliability from the user's point of view: what to measure, which target to promise, and how to spend the budget.
4. [OpenTelemetry](opentelemetry/index.md) — the vendor-neutral standard: context propagation, instrumentation, the Collector, sampling and backends.
5. [Alerting](alerting/index.md) — symptom-based alerts, SLO burn rate, multiwindow rules, routing and runbooks.
6. [Incident Response](incident-response/index.md) — on-call, severities, incident roles, mitigation first, postmortems.
7. [Quiz](quiz.md) — check your understanding.

## Slides

<div class="slides-embed">
  <iframe src="slides/observability.html" title="Slides: observability" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/observability.html){:target="_blank"}

---

## Monitoring vs observability

The two words are often used as synonyms, but they describe different capabilities.

**Monitoring** watches a set of **pre-defined** indicators and tells you when one crosses a threshold: "error rate above 1%", "disk above 90%". It answers questions you knew to ask when you built the dashboard — the *known unknowns*.

**Observability** is a property of the system: how well you can infer its **internal state from its external outputs**[^1]. The term comes from control theory (Kalman, 1960); in software it means that, without shipping new code, you can ask a question you never thought of — "why are only checkouts with more than four tickets, paid with one card brand, slow since 10:02?" — and answer it from the telemetry the system already emits[^2]. Those are the *unknown unknowns*, and distributed systems are full of them.

| | Monitoring | Observability |
|---|---|---|
| Question type | known in advance ("is X above Y?") | discovered during the investigation ("what do the slow requests have in common?") |
| Typical output | dashboard, threshold alert | ad-hoc query, trace, high-dimensional breakdown |
| Data needed | aggregated metrics | metrics **plus** rich events: logs, traces, profiles with many attributes |
| Works well for | failures you have seen before | novel failures, emergent behaviour of many services |
| Failure mode | green dashboards while users suffer | high cost if every detail is kept forever |

Monitoring is not obsolete — it is a *subset*. You still need dashboards and alerts on known symptoms; observability is what lets you go from "the alert fired" to "this is the cause" when the cause is new.

??? question "Think first: why were the BoxOffice dashboards green?"

    The dashboards watched **causes** chosen in advance — CPU, memory, pod status, the error rate — averaged over every endpoint. The checkout problem was a **latency** problem on **one route**, concentrated in the **tail** (p99), caused by a dependency outside BoxOffice. An average over all routes hides it twice: other routes dilute the checkout route, and the median request hides the slow ones. The fix is not "more dashboards": it is measuring what users feel per journey (latency percentiles of `POST /checkout`) and having traces to see *where* inside the request the time went.

---

## The observability palette

In the [System Design Playground](../../../playground/index.md), the OBSERVABILITY category has five components. Each one answers a different question, and each one is consumed by someone different — a human investigating, a human being woken up, or a machine making a routing decision.

| Component | Question it answers | Consumer | Relative cost | Details |
|---|---|---|---|---|
| [**Metrics**](../../reference/components/observability/index.md#metrics) | *Is* something wrong? How much, since when, trending where? | dashboards, alert rules | low (aggregated numbers) | [Signals](signals/index.md#metrics) |
| [**Logs**](../../reference/components/observability/index.md#logs) | *What exactly* happened in this event? | humans investigating, audits | high (one record per event) | [Signals](signals/index.md#logs) |
| [**Tracing**](../../reference/components/observability/index.md#tracing) | *Where* in the request path did the time or the error go? | humans investigating | medium–high (sampled) | [Signals](signals/index.md#traces), [OpenTelemetry](opentelemetry/index.md) |
| [**Alerting**](../../reference/components/observability/index.md#alerting) | Does a *human* need to act *now*? | on-call engineer | low | [Alerting](alerting/index.md) |
| [**Health Check**](../../reference/components/observability/index.md#healthcheck) | Should this *instance* receive traffic, or be restarted? | load balancer, Kubernetes | very low | [below](#health-checks) |

All of them describe the same events from different angles. A single slow `POST /checkout` at 10:04 produces:

- a sample in the latency **histogram** of `order` (metric) — cheap, aggregated, no idea *which* checkout;
- a structured **log** line `{"level":"WARN","msg":"payment call slow","trace_id":"4bf9…","duration_ms":8120}` — precise, expensive at volume;
- a **trace** with spans for gateway → order → inventory → payment, the payment span taking 8.1 s — shows *where*;
- possibly a **profile** sample showing threads parked in the HTTP client — shows *which code*;
- and, if enough checkouts are slow for long enough, an **alert** that pages the on-call engineer.

The glue between them is **context**: the same `trace_id` in the log line, in the trace and attached to the metric sample (an *exemplar*). Without shared context, you have three disconnected tools; with it, you have one investigation.

---

## The investigation loop

Observability pays off as a repeatable loop that moves from cheap, aggregated signals to expensive, detailed ones — narrowing the search at each step. Play the diagram:

``` diagram-sim
flowchart LR
    A["Alert<br/>checkout SLO burning 14×"] --> D["RED dashboard<br/>which service? which route?"]
    D --> E["Exemplar<br/>one slow request's trace_id"]
    E --> T["Trace<br/>which span is slow?"]
    T --> L["Logs of that span<br/>why? (error, retry, timeout)"]
    L --> P["Profile<br/>which code path?"]
    P --> M["Mitigate<br/>rollback, breaker, failover"]
    M --> PM["Postmortem<br/>prevent the class of failure"]
```

1. **Detect** with an SLO-based alert on a symptom users feel ([Alerting](alerting/index.md)).
2. **Localize** with metrics: the RED dashboard shows `POST /checkout` p99 went from 400 ms to 9 s; other routes are normal.
3. **Pick an example**: a latency panel with exemplars links a slow sample to its `trace_id`.
4. **Find the hop**: the trace waterfall shows 8 of the 9 seconds inside the `payment` span, in the call to the external provider.
5. **Explain**: the logs of that span show `connection pool exhausted, waited 7.9 s` — the provider is slow, and `payment` has a pool of 20 connections.
6. **Mitigate first**, understand later ([Incident Response](incident-response/index.md)): open the circuit breaker, put checkouts in a queue, or switch providers.
7. **Learn**: the postmortem asks why a slow provider could hold the whole checkout hostage — and adds a timeout, a bulkhead, and an alert on provider latency.

!!! example "BoxOffice — the critical path of a checkout"

    The flash-sale checkout crosses five BoxOffice services and one external dependency: `gateway` → `order` → `inventory` (confirm the seat hold, PostgreSQL) → `payment` (adapter) → **external payment provider**, and then `order` publishes `OrderConfirmed` to Kafka, consumed by `notification` (e-mail/push). Every arrow is a place where time can disappear, and the external provider is the one place where BoxOffice cannot add instrumentation — only measure the calls it makes.

### See it in the simulator

**Try it.** At t = 50 s one of the three `catalog` replicas dies. Press *Run* as it is: every service shows its utilization as "?" (nothing is measured), and for 30 s the load balancer keeps sending a third of the requests to the dead replica — about 33% errors from t = 51 s to 80 s, 93.8% availability over the run. Add **Metrics** and connect it to the load balancer, the app and the database: the numbers appear, but fans see exactly the same errors — measuring fixes nothing by itself. Then add a **Health Check** connected to the load balancer: the dead replica leaves the rotation after 3 s instead of 30 s, and availability rises to 99.4%. What the last component, **Alerting**, changes is in [Alerting](alerting/index.md#machines-detect-people-repair).

<div class="sdp" data-scenario="observability-stack" data-mode="compact" data-height="520"></div>

The full simulator is in the [System Design Playground](../../../playground/index.md).

---

## Health checks { #health-checks }

A health check is the simplest signal and the only one consumed by **machines**: a load balancer, an orchestrator or a service discovery system calls an endpoint and decides whether an instance should **receive traffic** or be **restarted**. Because machines act on it automatically and at scale, a badly designed health check is one of the classic causes of total outages.

Kubernetes distinguishes three probes[^3], and the distinction is the whole point:

| Probe | Question | On failure | Should check |
|---|---|---|---|
| **Startup** | Has the process finished starting? | keep waiting (other probes are paused); kill after the budget | the app is initialized (JVM warm-up, migrations done) |
| **Liveness** | Is the process stuck beyond repair? | **restart** the container | only the process itself: event loop / thread pool responds |
| **Readiness** | Can this instance serve requests *right now*? | **remove from the load balancer** (no restart) | can do useful work: warmed caches, required local resources |

``` diagram-sim
stateDiagram-v2
    [*] --> Starting : container created
    Starting --> Ready : startup ok, readiness ok
    Starting --> Restarting : startup budget exceeded
    Ready --> NotReady : readiness fails (overloaded, draining)
    NotReady --> Ready : readiness ok again
    Ready --> Restarting : liveness fails (deadlock)
    NotReady --> Restarting : liveness fails
    Restarting --> Starting : new container
```

With Spring Boot Actuator, the probes are separate health groups, exposed at `/actuator/health/liveness` and `/actuator/health/readiness`[^4]:

```yaml
# application.yaml (order service)
management:
  endpoint:
    health:
      probes:
        enabled: true
      group:
        readiness:
          include: readinessState
        liveness:
          include: livenessState
```

```yaml
# Deployment (excerpt) — the order container
startupProbe:
  httpGet: { path: /actuator/health/liveness, port: 8080 }
  periodSeconds: 5
  failureThreshold: 24        # up to 2 minutes to start
livenessProbe:
  httpGet: { path: /actuator/health/liveness, port: 8080 }
  periodSeconds: 10
  failureThreshold: 3         # 30 s of failures before a restart
readinessProbe:
  httpGet: { path: /actuator/health/readiness, port: 8080 }
  periodSeconds: 5
  failureThreshold: 2
```

### Shallow vs deep checks

A **shallow** check answers "is my process alive?". A **deep** check also calls the dependencies — the database, Redis, the payment provider. Deep checks look more honest, and that is exactly the trap.

!!! warning "The deep-check cascade"

    Suppose the readiness probe of `order` includes the PostgreSQL connection. The database has a 20-second failover. Every `order` pod fails readiness at the same moment, Kubernetes removes **all** of them from the Service, and the gateway now returns `503` for every route — including the ones that only read from Redis. Worse, if the *liveness* probe includes the database, Kubernetes **restarts** every pod at once; they all start cold, hammer the database together as it comes back, and the outage extends itself.

    Rules of thumb: **liveness never checks dependencies**; readiness checks only what *this* instance needs locally and what a *different* instance would not fix; dependency health belongs in **metrics and alerts**, and degraded dependencies are handled with timeouts, circuit breakers and fallbacks ([Resilience patterns](../reliability/patterns/index.md)).

| | Shallow (process only) | Deep (process + dependencies) |
|---|---|---|
| Detects | crashed or deadlocked process | broken dependency too |
| Risk | instance "healthy" but useless if a dependency is down | **correlated failure**: all instances fail together → total outage, restart storms |
| Cost | trivial | each probe calls the dependency (N pods × every 5 s) |
| Use for | liveness, load-balancer checks | readiness *only* for dependencies one instance owns; otherwise a separate status endpoint for humans |

Load balancers at the edge use the same idea (see [Load balancing](../edge/load-balancing/index.md)): they remove a backend after N failed checks and add it back after M successes — the hysteresis avoids flapping.

---

## What telemetry costs { #what-telemetry-costs }

Observability is not free, and in an interview — or in the cloud bill — you must reason about its volume like any other workload. A back-of-the-envelope estimate for BoxOffice on a normal day, with illustrative assumptions:

| Assumption | Value |
|---|---|
| Average traffic | 500 requests/s |
| Spans per request (gateway, order, inventory, DB, payment, Kafka…) | 8 |
| Average span size (with attributes) | 500 bytes |
| Log lines per request (all services) | 5, of 300 bytes each |

$$
\text{traces} = 500 \times 8 \times 500\ \text{B} = 2\ \text{MB/s} \approx 173\ \text{GB/day}
\qquad
\text{logs} = 500 \times 5 \times 300\ \text{B} = 0.75\ \text{MB/s} \approx 65\ \text{GB/day}
$$

At 100% trace sampling that is over 5 TB of traces a month — before the flash sale multiplies the traffic by 50. Hence the three cost levers you will see in this class:

- **Sampling** traces (keep the interesting ones — errors and slow requests — and a small share of the rest), see [OpenTelemetry](opentelemetry/index.md#sampling).
- **Bounded cardinality** for metrics (no user IDs in labels), see [Signals](signals/index.md#cardinality).
- **Levels, sampling and retention tiers** for logs (DEBUG off in production, 7–30 days hot, then cheap object storage).

## The observability concept map { #concept-map }

The five observability components describe the same requests from different angles, and shared context (exemplars, `trace_id`) turns them into one investigation. The map links each **palette component** (green) to the **concepts** it relies on (blue) and to the classes that continue them:

``` diagram
flowchart LR
    svc["app · worker<br/>(BoxOffice services)"]:::comp --> metrics["metrics"]:::comp
    svc --> tracing["tracing"]:::comp
    svc --> logs["logs"]:::comp
    metrics -->|"exemplar"| tracing
    tracing -->|"trace_id"| logs
    metrics --> alerting["alerting"]:::comp
    hc["healthcheck"]:::comp -->|"probes"| svc
    metrics -.- c1["RED, USE, golden signals,<br/>histograms, cardinality"]:::tech
    logs -.- c2["structured logs,<br/>levels, redaction"]:::tech
    tracing -.- c3["traceparent, Collector,<br/>tail sampling"]:::tech
    alerting -.- c4["SLO burn rate, multiwindow,<br/>routing, runbooks"]:::tech
    hc -.- c5["liveness, readiness, startup,<br/>shallow vs deep"]:::tech
    c4 --> c6["incident roles, mitigate first,<br/>postmortems"]:::tech
    c4 -.- d1["SLI, SLO, error budget<br/>(class 9)"]
    c5 -.- d2["Kubernetes probes, LB checks<br/>(classes 4 and 11)"]
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

| Palette component | Question it answers | Concepts | Taught in | Scenarios |
|---|---|---|---|---|
| [`metrics`](../../reference/components/observability/index.md#metrics) | *Is* something wrong? How much, since when? | counters, gauges, histograms, RED, USE, golden signals, cardinality, PromQL | [Signals — metrics](signals/index.md#metrics), [cardinality](signals/index.md#cardinality) | `observability-stack`, `event-fanout` (consumer lag) |
| [`logs`](../../reference/components/observability/index.md#logs) | *What exactly* happened in this event? | structured logs, levels, `trace_id` / `span_id`, Loki vs Elasticsearch, retention tiers | [Signals — logs](signals/index.md#logs) | `observability-stack` |
| [`tracing`](../../reference/components/observability/index.md#tracing) | *Where* did the time or the error go? | spans, critical path, `traceparent`, Collector, head vs tail sampling, exemplars | [Signals — traces](signals/index.md#traces), [OpenTelemetry](opentelemetry/index.md) | `observability-stack`, `cascading-failure` (the slow provider span) |
| [`alerting`](../../reference/components/observability/index.md#alerting) | Does a *human* need to act *now*? | symptoms vs causes, burn rate, multiwindow rules, routing, dead man's switch, runbooks | [Alerting](alerting/index.md), [Incident Response](incident-response/index.md) | `observability-stack`, `flash-sale` |
| [`healthcheck`](../../reference/components/observability/index.md#healthcheck) | Should this *instance* get traffic, or be restarted? | startup, liveness, readiness, shallow vs deep checks, hysteresis | [this overview](#health-checks) | `scale-out`, `observability-stack` |

!!! tip "In the interview"

    Observability is the standard answer to "how would you know it works?" and belongs in the **wrap-up** of every design. Say it concretely, in one breath: *"I'd define an SLO on checkout — 99.9% of checkouts succeed in under 2 s over 28 days — and alert on its burn rate; RED dashboards per service; OpenTelemetry traces with tail sampling that keeps every error and slow trace; structured logs with the trace ID; and readiness probes that do not depend on the database."* Then mention one thing you would watch specific to the problem: consumer lag for a queue, hit ratio for a cache, replication lag for replicas.

!!! success "Best practices"

    - **Write the SLO before the first dashboard** — the SLI and its target decide which metrics, histogram buckets and alerts you need; everything else is a diagnosis aid. In BoxOffice: [Hands-on 8 — SLO and burn-rate alert](../../hands-on/8/slo/index.md) (99.5% of `catalog` requests over 28 days).
    - **Stamp every signal with `service.name`, version and environment** — they are what lets you compare a canary with the stable version, or one service's errors with another's, across metrics, traces and logs. In BoxOffice: the `x-otel` anchor of [OpenTelemetry](opentelemetry/index.md).
    - **Keep dashboards and alert rules in the repository, provisioned at startup** — reviewed like code, identical on every environment, and rebuilt after a `down -v` without clicks. In BoxOffice: `infra/grafana/` in [Hands-on 8](../../hands-on/8/index.md).
    - **Budget telemetry like any other workload** — estimate it before turning it on (2 MB/s of spans at 500 req/s, [above](#what-telemetry-costs)) and set sampling and retention per signal.
    - **Run monitoring outside the failure domain it watches** — a monitoring stack in the same cluster or zone dies with the incident it should report; at least the alert delivery and a heartbeat must live elsewhere ([Alerting](alerting/index.md)).

!!! warning "Common pitfalls"

    - **Dashboards of causes, alerts on causes**: CPU, memory and pod counts are green while users suffer. Measure what users feel.
    - **Averages**: an average latency hides the tail; use percentiles or "fraction of requests faster than X".
    - **No shared context**: logs without `trace_id` and metrics without exemplars force you to correlate by timestamp — by hand, at 3 a.m.
    - **Deep liveness probes**: a dependency outage becomes a restart storm.
    - **Instrumenting after the incident**: telemetry must be designed in, like any other requirement; you cannot query data you did not emit.

---

## Related

- [Hands-on 8 — Observability](../../hands-on/8/index.md): OpenTelemetry auto-instrumentation and `grafana/otel-lgtm` on BoxOffice; RED dashboard, traces and a burn-rate alert.
- [Hands-on 9 — Resilience & chaos](../../hands-on/9/index.md) and [Hands-on 10 — Kubernetes](../../hands-on/10/index.md): probes, Toxiproxy faults, and watching them in the telemetry.
- [Reliability](../reliability/index.md) and [SLOs](slo/index.md): SLIs, SLOs and error budgets — what the alerts of this class enforce.
- [Performance engineering](../performance/index.md): load tests are only useful if you can see *why* the system bends.
- [Exercise: load-test report](../../exercises/load-test-report/index.md) and the project's [game day](../../exercises/project/game-day/index.md).
- Case study: [Ticketing (BoxOffice flash sale)](../case-studies/ticketing/index.md).

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - **Monitoring** answers known questions; **observability** lets you investigate new ones from the telemetry the system already emits.
    - The five palette components answer different questions: **metrics** (is something wrong?), **logs** (what happened?), **traces** (where?), **alerting** (must a human act now?), **health checks** (should this instance get traffic?).
    - The **investigation loop** goes from cheap aggregates to expensive detail: alert → dashboard → exemplar → trace → logs → profile → mitigate → postmortem. Shared **context** (`trace_id`) makes it one investigation.
    - **Liveness never checks dependencies**; deep checks turn a dependency blip into a total outage or a restart storm.
    - Telemetry is a workload: estimate its volume and control it with **sampling**, **bounded cardinality** and **retention tiers**.

## What breaks next { #what-breaks-next }

BoxOffice can now see itself: an SLO with a burn-rate alert, a RED dashboard, and one trace per order, from the edge through Kafka to the e-mail — in lab 8, stopping the database pages someone in about five minutes (288 s in a test run). Seeing is not surviving. At 10:02 the payment provider answers in 4 s instead of 200 ms: the dashboard shows the `order` p95 climbing, the trace puts the time in the payment call, the alert fires — and checkout still dies, because every `order` thread is waiting on the provider and none is left even for requests that never touch it. Observability shortens the time to *understand* a failure; keeping one slow dependency from taking everything down — timeouts, circuit breakers, bulkheads, and chaos experiments that prove them — is [class 10 — Reliability](../reliability/index.md).

---

[^1]: KALMAN, R. E. On the general theory of control systems. *Proceedings of the First IFAC Congress*, 1960. The term was brought to software operations by Twitter's and Honeycomb's engineers in the 2010s.
[^2]: MAJORS, C.; FONG-JONES, L.; MIRANDA, G. *Observability Engineering*. O'Reilly, 2022. Chapters 1–3.
[^3]: KUBERNETES. [Configure Liveness, Readiness and Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/){target="_blank"}.
[^4]: SPRING. [Spring Boot Actuator — Kubernetes Probes](https://docs.spring.io/spring-boot/reference/actuator/endpoints.html#actuator.endpoints.kubernetes-probes){target="_blank"}.
