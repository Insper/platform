# Observability

**Observability** is the ability to understand what a system is doing — and why — from the outside, using the signals it emits. It never sits on the request path: these components are **side channels** that watch the services. But without them you are flying blind: you cannot see which box is saturated, you cannot tell a slow dependency from a slow database, and you find out about outages from angry users. The rule of the course is simple: *you can't fix what you don't measure*.

The palette has three **signals** and two **actions**. Signals: **metrics** (numbers over time — is something wrong?), **logs** (detailed events — what exactly happened?) and **traces** (one request across services — where did the time go?). Actions: **alerting** (wake a human when users are affected) and **health checks** (let load balancers and orchestrators route around broken instances automatically). In BoxOffice, a RED dashboard per service, traces from the gateway to the payment provider, and an SLO burn-rate alert on checkout are what tell the on-call engineer, at 10:01 on sale day, that the payment provider is slow — not the database.

| Component | One-liner | Playground id |
|---|---|---|
| [Metrics](#metrics) | Numeric time series (rates, errors, latency percentiles, utilization) | `metrics` |
| [Logs](#logs) | Timestamped records of discrete events, ideally structured (JSON) | `logs` |
| [Tracing](#tracing) | The path and timing of one request across services (spans) | `tracing` |
| [Alerting](#alerting) | Rules on signals that notify a human when users are affected | `alerting` |
| [Health Check](#healthcheck) | Endpoint probes that tell LBs/orchestrators if an instance can serve | `healthcheck` |

``` diagram
flowchart LR
    S1[gateway] -.->|OTLP| COL[OpenTelemetry Collector]
    S2[order] -.->|OTLP| COL
    S3[payment] -.->|OTLP| COL
    COL -.-> M[Metrics]
    COL -.-> L[Logs]
    COL -.-> T[Tracing]
    M -.->|SLO burn rate| AL[Alerting]
    AL -.->|page| ONCALL((on-call))
    LB[Load Balancer] -.->|GET /health/ready| S2
```

| Question | Signal | Example |
|---|---|---|
| Is something wrong? How much? | Metrics | Checkout error rate jumped from 0.1% to 4% |
| Where is the time going in this slow request? | Tracing | 3.8 s of 4 s inside `payment → provider` |
| What exactly happened to order 81234? | Logs | `provider timeout after 2000 ms, retry 2/3` |
| Should someone act now? | Alerting | SLO burning 14× faster than sustainable |
| Should traffic go to this instance? | Health check | `/health/ready` returns 503 during warm-up |

---

## Metrics { #metrics }

**What it is.** Metrics are **numeric measurements aggregated over time**: counters (requests served, errors), gauges (queue depth, memory in use) and histograms (latency distribution, from which you read p50/p95/p99). Each **time series** is identified by a name and a set of **labels** (`http_requests_total{service="order", route="/orders", status="500"}`). They are cheap to store and query because they are pre-aggregated, which makes them the right signal for dashboards, SLOs and alerts. The standard recipes: **RED** for services (rate, errors, duration), **USE** for resources (utilization, saturation, errors) and Google's **four golden signals** (latency, traffic, errors, saturation).

**When to use.**

- Always, for every service and resource: the RED dashboard of BoxOffice's `order`, `inventory` and `payment` services.
- SLIs and SLOs: "share of checkout requests under 500 ms" is computed from a latency histogram.
- Capacity planning and autoscaling: CPU utilization, queue depth and consumer lag drive the autoscaler.
- Business metrics alongside technical ones: tickets sold per minute, waiting-room size, conversion.

**When not to (or watch out).**

- To investigate a single request: metrics are aggregates — use traces and logs.
- **Cardinality**: every unique combination of label values is a separate series. Labels like `user_id`, `order_id` or full URLs explode the number of series and the cost → keep labels bounded (route templates, status class).
- Averages hide the tail: record **histograms** and look at percentiles; never average percentiles across instances.
- Sampling interval: a 1-minute scrape smooths a 10-second spike away.

**Key numbers.**

| Metric | Typical value | Note |
|---|---|---|
| Scrape / export interval | 15–60 s | Prometheus' global default is 1 min; 15 s is common |
| Series count | ≈ metrics × label combinations × instances | 50 metrics × 200 label combos × 20 pods = 200 k series (≈ illustrative) |
| Cost per sample | ≈ 1–2 bytes compressed in modern TSDBs | ≈ illustrative; series count matters more than sample count |
| Retention | ≈ 15 days raw locally; months to years downsampled | Long-term storage in Mimir/Thanos or a managed service |
| Percentiles to watch | p50, p95, p99 (p99.9 for high-volume paths) | From histograms, per route |

**Failure modes.**

- **Cardinality explosion** — someone adds `user_id` as a label; memory and cost blow up, the metrics backend falls over → label allow-lists, limits per tenant, review metric changes.
- **Missing metric where it mattered** — the slow dependency had no client-side latency metric → instrument outbound calls (OpenTelemetry auto-instrumentation does).
- **Misleading averages** → histograms and percentiles; per-route breakdowns.
- **Monitoring that dies with the system** — the metrics stack runs in the same cluster that is down → monitor from outside too (synthetic checks, a separate region or a managed service).
- **Dashboards nobody reads** → few dashboards built around SLOs and RED/USE, linked from alerts.

**In the playground.** `metrics` is a **side channel**, not part of the request path. Connect services to it and their utilization becomes visible on the canvas; a service with no `metrics` node connected shows its utilization as **"?"** — you can't fix what you don't measure (a "god mode" toggle reveals everything for teaching). It adds a monthly cost. Scenarios: [`observability-stack`](../../../../playground/scenarios/index.md#observability-stack), [`scale-out`](../../../../playground/scenarios/index.md#scale-out).

**Real products.**

=== "AWS"

    - **Amazon CloudWatch** (metrics, dashboards) — native metrics for AWS services and custom metrics.
    - **Amazon Managed Service for Prometheus** and **Amazon Managed Grafana**.

=== "GCP"

    - **Cloud Monitoring** — metrics, dashboards and SLO monitoring.
    - **Google Cloud Managed Service for Prometheus**.

=== "Azure"

    - **Azure Monitor** (Metrics) and **Azure Monitor managed service for Prometheus**.
    - **Azure Managed Grafana**.

=== "Open source"

    - **Prometheus** — pull-based metrics collection, PromQL, the de facto standard for Kubernetes.
    - **Grafana** — dashboards over many data sources.
    - **Grafana Mimir**, **Thanos**, **VictoriaMetrics** — scalable long-term metric storage.
    - **OpenTelemetry** (SDKs and Collector) — vendor-neutral instrumentation and export (used in Hands-on 8 with `grafana/otel-lgtm`).

!!! tip "In the interview"
    "Every service exports RED metrics — rate, errors and a latency histogram per route — and every resource USE metrics. My SLIs and alerts are computed from those histograms, I watch p99, not the average, and I keep labels bounded so cardinality doesn't explode."

**Learn more:** [Observability › Signals](../../../classes/observability/signals/index.md) · [Observability › OpenTelemetry](../../../classes/observability/opentelemetry/index.md) · [Estimation › Percentiles](../../../classes/estimation/percentiles/index.md) · [Performance › Methodology](../../../classes/performance/methodology/index.md) · [Hands-on 8](../../../hands-on/8/index.md)

---

## Logs { #logs }

**What it is.** Logs are **timestamped records of discrete events**: "order 81234 created", "payment provider timeout after 2000 ms", "user 77 failed login". Modern practice is **structured logging** — one JSON object per event with fields (`level`, `service`, `trace_id`, `order_id`, `duration_ms`) — so logs can be filtered and aggregated, not just grepped. Logs are shipped by an agent or the OpenTelemetry Collector to a central store where they are indexed and searched. Including the **trace id** in every log line links logs to traces.

**When to use.**

- Investigating a specific request or user: "what happened to order 81234?" — search by `order_id` or `trace_id`.
- Errors with context: stack traces, the input that caused them, which retry attempt failed.
- **Audit trails** for security and compliance: who refunded what, who changed permissions (kept separately, with longer retention and restricted access).
- Rare events that are not worth a metric.

**When not to (or watch out).**

- As your main way to detect problems: counting log lines to compute error rates is slow and expensive → use metrics, link to logs.
- Logging every request body at high volume: costs grow linearly with traffic → sample success logs, keep all errors.
- **Sensitive data**: passwords, tokens, card numbers and personal data must never be logged (LGPD/GDPR, PCI DSS) → redact at the source.
- Unstructured text with inconsistent formats makes search nearly impossible.

**Key numbers.**

| Metric | Typical value | Note |
|---|---|---|
| Log volume estimate | requests/s × lines per request × bytes per line | 2,000 req/s × 5 lines × 500 B = 5 MB/s ≈ 430 GB/day (≈ illustrative) |
| Typical structured log line | ≈ 200 B – 2 KB | Grows fast with stack traces and payloads |
| Ingestion-to-searchable delay | ≈ seconds | Depends on the pipeline |
| Hot retention | ≈ 7–30 days | Older logs to cheap object storage; audit logs longer |
| Cost driver | GB ingested and indexed | Index less, sample success logs |

**Failure modes.**

- **Log flood** — a failing dependency makes every request log a stack trace; the pipeline backs up and the bill explodes → rate-limit repeated logs, sample, drop debug in production.
- **Missing correlation** — logs from 6 services cannot be joined → propagate and log the `trace_id`.
- **Leaking secrets or personal data** → structured fields with redaction, reviews, scanning.
- **Logging blocking the app** — synchronous writes to a slow sink add latency → async appenders, local buffering, stdout + agent.
- **Lost logs** when a pod dies → write to stdout and let the node agent ship them; buffers with backpressure.

**In the playground.** `logs` is a **side channel**: connecting services to it enables the **event log details** (what happened to the sampled requests, which errors and retries) in the Events tab. It costs per GB, so it shows up in the cost tile. Scenarios: [`observability-stack`](../../../../playground/scenarios/index.md#observability-stack), [`cascading-failure`](../../../../playground/scenarios/index.md#cascading-failure).

**Real products.**

=== "AWS"

    - **Amazon CloudWatch Logs** — log collection, retention and Logs Insights queries.
    - **Amazon OpenSearch Service** — search and analytics over logs.

=== "GCP"

    - **Cloud Logging** — collection, Log Explorer, log-based metrics, sinks to BigQuery or Cloud Storage.

=== "Azure"

    - **Azure Monitor Logs** (Log Analytics workspaces) — log storage queried with KQL.

=== "Open source"

    - **Grafana Loki** — log aggregation indexed by labels only (cheap); queried with LogQL.
    - **OpenSearch** / **Elasticsearch** — full-text indexed log search (the "ELK" stack with Logstash and Kibana).
    - **Fluent Bit**, **Vector**, **OpenTelemetry Collector** — log shippers and processors.

!!! tip "In the interview"
    "Services write structured JSON logs to stdout with the trace id in every line; an agent ships them to a central store. I use metrics to detect, traces to locate and logs to explain. Errors are always kept, successful requests are sampled, and nothing sensitive is ever logged."

**Learn more:** [Observability › Signals](../../../classes/observability/signals/index.md) · [Observability › OpenTelemetry](../../../classes/observability/opentelemetry/index.md) · [Observability › Incident response](../../../classes/observability/incident-response/index.md) · [Network & security › Zero trust](../../../classes/network-security/zero-trust/index.md) · [Hands-on 8](../../../hands-on/8/index.md)

---

## Tracing { #tracing }

**What it is.** Distributed tracing follows **one request** across all the services it touches. Each unit of work is a **span** (name, start, duration, attributes, status) and spans form a tree under one **trace id**, which is propagated between services in request headers (the W3C `traceparent` header) and in message metadata. The result is a **waterfall**: you see that a 4 s checkout spent 3.8 s waiting for the payment provider, or that one page makes 40 sequential database calls (N+1). Because recording every request is expensive, traces are **sampled**: head sampling (decide at the start, e.g. 5%) or tail sampling (decide at the end, keeping all errors and slow requests).

**When to use.**

- Any system with more than a couple of services: finding *where* latency or errors come from.
- Diagnosing the critical path: what is sequential that could be parallel, which dependency dominates p99.
- Understanding fan-out and retries: a trace shows the three retries that tripled the load.
- LLM applications: a trace per agent run shows each model call, tool call, tokens and latency.

**When not to (or watch out).**

- Without **context propagation** through every hop (HTTP, gRPC, Kafka headers, async jobs), traces break into fragments → use OpenTelemetry instrumentation everywhere.
- 100% sampling at high volume is expensive; too little sampling misses the rare slow requests → tail-based sampling for errors and slow traces.
- Traces show one request; for trends use metrics (or metrics derived from spans).
- Sensitive data in span attributes is as dangerous as in logs.

**Key numbers.**

| Metric | Typical value | Note |
|---|---|---|
| Spans per trace | ≈ tens to hundreds | One per service call, query, cache lookup |
| Head sampling rate | ≈ 1–10% in high-volume production | ≈ illustrative; 100% in development and low-volume services |
| Instrumentation overhead | small (≈ microseconds per span) | Export is batched and asynchronous |
| Propagation header | `traceparent` (W3C Trace Context) | Carries trace id, parent span id, sampled flag |
| Retention | ≈ days to a few weeks | Traces are for recent investigations |

**Failure modes.**

- **Broken traces** — one service or the message broker drops the context → instrument every hop, propagate through Kafka headers and job payloads.
- **Sampling hides the problem** — the rare 10-second request was not sampled → tail sampling (keep errors and slow traces), exemplars linking metrics to traces.
- **Collector overload** at peak → batching, horizontal Collector scaling, sampling at the edge of the pipeline.
- **Clock skew** makes child spans look like they start before the parent → rely on durations within a host, NTP everywhere.

**In the playground.** `tracing` is a **side channel**: when present, the **Trace** tab shows the waterfall of one sampled slow request, with the time spent queueing and serving in each node — the fastest way to find a slow dependency or a retry storm. It adds cost. Scenarios: [`observability-stack`](../../../../playground/scenarios/index.md#observability-stack), [`cascading-failure`](../../../../playground/scenarios/index.md#cascading-failure), [`retry-storm`](../../../../playground/scenarios/index.md#retry-storm), [`ai-assistant`](../../../../playground/scenarios/index.md#ai-assistant).

**Real products.**

=== "AWS"

    - **AWS X-Ray** — distributed tracing for AWS workloads (accepts OpenTelemetry data).
    - **Amazon CloudWatch Application Signals** — application performance monitoring built on OpenTelemetry.

=== "GCP"

    - **Cloud Trace** — distributed tracing, OpenTelemetry-compatible.

=== "Azure"

    - **Azure Monitor Application Insights** — application performance monitoring with distributed tracing (OpenTelemetry distro).

=== "Open source"

    - **OpenTelemetry** — the standard APIs, SDKs, auto-instrumentation agents and Collector.
    - **Jaeger** — tracing back end and UI (CNCF).
    - **Grafana Tempo** — trace storage on object storage, integrated with Grafana.
    - **Zipkin** — the original open-source tracing system.

!!! tip "In the interview"
    "With OpenTelemetry the trace id flows from the gateway through every service and through Kafka headers, so one slow checkout shows up as a waterfall: 3.8 s of 4 s waiting on the payment provider. I keep all error and slow traces with tail sampling and a few percent of the rest."

**Learn more:** [Observability › OpenTelemetry](../../../classes/observability/opentelemetry/index.md) · [Observability › Signals](../../../classes/observability/signals/index.md) · [Performance › Bottlenecks](../../../classes/performance/bottlenecks/index.md) · [AI systems › Safety & evals](../../../classes/ai-systems/safety-evals/index.md) · [Hands-on 8](../../../hands-on/8/index.md)

---

## Alerting { #alerting }

**What it is.** Alerting turns signals into **notifications for humans**: rules evaluated continuously over metrics (or logs) that, when true for long enough, route a message to the right person — a **page** for urgent problems, a ticket or chat message for the rest. Good alerts are about **symptoms users feel** (errors, latency, SLO violations), are **actionable**, and come with a runbook link. The modern standard is **SLO-based alerting with burn rates**: alert when the error budget is being consumed much faster than sustainable, using two windows (e.g. 1 h and 5 min) so the alert is both fast and not noisy.

**When to use.**

- Every user-facing SLO: "checkout availability 99.9% over 28 days" with fast-burn (page) and slow-burn (ticket) alerts.
- Leading indicators of imminent outages: disk filling up within hours, certificate expiring in 7 days, consumer lag approaching retention.
- On-call rotations with escalation policies and acknowledgement.

**When not to (or watch out).**

- Alerting on causes instead of symptoms ("CPU > 80%") pages people for things that don't affect users → **alert fatigue**, and real pages get ignored.
- Alerts without an owner or a runbook.
- Static thresholds on noisy metrics flap → use windows, burn rates, hysteresis.
- Alerting depends on the monitoring stack being alive → a "dead man's switch" (an always-firing heartbeat alert that pages when it stops).

**Key numbers.**

| Metric | Typical value | Note |
|---|---|---|
| Error budget of a 99.9% SLO over a rolling 28 days | ≈ 40 minutes of full downtime | 0.1% × 28 days × 24 h × 60 min |
| Fast-burn page (SRE Workbook) | burn rate 14.4 over 1 h (with a 5-min check) | Consumes 2% of a 28-day budget in one hour |
| Slow-burn ticket | burn rate ≈ 1–6 over 6 h – 3 days | ≈ illustrative; catches gradual degradation |
| Pages per on-call shift that is sustainable | a few at most | Google's SRE book suggests ≤ 2 incidents per 12-hour shift |
| Time to acknowledge target | ≈ 5–15 min for pages | ≈ illustrative; set by the team's policy |

**Failure modes.**

- **Alert fatigue** — too many noisy alerts, the real one is missed → delete or demote non-actionable alerts, SLO-based paging only.
- **Silent failure** — the metric stopped being reported, so the threshold never fires → alert on absent data, dead man's switch.
- **Alerting stack down with the system** → monitor the monitor from outside (synthetic checks, a separate provider).
- **No runbook / wrong owner** → each alert links a runbook and routes to the owning team.
- **Flapping** → longer evaluation windows, `for` durations, hysteresis.

**In the playground.** `alerting` is a **side channel** connected to `metrics`: when present, random failures are detected and fixed faster — the model **reduces MTTR by 50%**, which shows up as higher availability in the run report. It costs money, like the other observability nodes. Scenarios: [`observability-stack`](../../../../playground/scenarios/index.md#observability-stack), [`multi-region`](../../../../playground/scenarios/index.md#multi-region).

**Real products.**

=== "AWS"

    - **Amazon CloudWatch alarms** (with composite alarms) routed through **Amazon SNS**.
    - **AWS Incident Manager** (Systems Manager) — on-call, escalation and response plans.

=== "GCP"

    - **Cloud Monitoring alerting policies** — including SLO burn-rate alerts, with notification channels.

=== "Azure"

    - **Azure Monitor alerts** with **action groups** (e-mail, SMS, webhooks, ITSM).

=== "Open source"

    - **Prometheus Alertmanager** — grouping, silencing and routing of Prometheus alerts.
    - **Grafana Alerting** — alert rules over any Grafana data source.
    - **Sloth** / **Pyrra** — generate multi-window burn-rate alerts from SLO definitions.
    - Commercial paging services such as **PagerDuty** are common for on-call schedules.

!!! tip "In the interview"
    "I page on symptoms, not causes: multi-window burn-rate alerts on the checkout SLO — 14× burn over an hour pages the on-call, slow burns open a ticket. Every alert has an owner and a runbook, and a heartbeat alert tells us if monitoring itself is down."

**Learn more:** [Observability › Alerting](../../../classes/observability/alerting/index.md) · [Observability › SLOs](../../../classes/observability/slo/index.md) · [Observability › Incident response](../../../classes/observability/incident-response/index.md) · [Estimation › Availability math](../../../classes/estimation/availability-math/index.md) · [Hands-on 8](../../../hands-on/8/index.md)

---

## Health Check { #healthcheck }

**What it is.** A health check is a **probe** that something outside the instance — a load balancer, Kubernetes, a DNS failover service — sends periodically to decide whether that instance should receive traffic or be restarted. Kubernetes distinguishes three: **liveness** ("is the process stuck? if it fails, restart it"), **readiness** ("can it serve traffic right now? if it fails, take it out of the load balancer, don't restart it") and **startup** ("is it still booting? hold the other probes until it's done"). Load balancers use similar active checks (an HTTP request to `/health` every few seconds) and sometimes **passive** checks (outlier detection on real traffic errors).

**When to use.**

- Every replica behind a load balancer or a Kubernetes Service: without it, the LB keeps sending traffic to dead or warming-up instances.
- Readiness during startup and warm-up (JIT, caches, connection pools) and during graceful shutdown (fail readiness first, then drain).
- Regional failover: DNS health checks decide when to send users to the other region.
- Load shedding: an overloaded instance can fail readiness temporarily.

**When not to (or watch out).**

- **Don't check dependencies in liveness**: if the database is slow and every pod's liveness checks it, Kubernetes restarts all pods at once — a restart storm that makes the outage worse.
- Readiness that checks a shared dependency can take **every** replica out at once → check only what the instance itself needs, and degrade gracefully.
- Health endpoints must be cheap, fast and unauthenticated-but-not-public (no sensitive details).
- Too-aggressive thresholds flap; too-lax ones leave dead instances in rotation.

**Key numbers.**

| Metric | Typical value | Note |
|---|---|---|
| Kubernetes probe defaults | `periodSeconds` 10, `timeoutSeconds` 1, `failureThreshold` 3 | Documented defaults |
| Detection time | ≈ interval × failure threshold | K8s defaults: ≈ 30 s; 2 s × 2 ≈ 4 s if tuned |
| AWS ALB target health check defaults | interval 30 s, unhealthy threshold 2, healthy threshold 5 | Documented defaults; ≈ 60 s to mark unhealthy |
| Probe endpoint latency | ≈ milliseconds | Must not do heavy work |
| Effect on availability | faster detection ⇒ fewer failed requests per incident | Failed requests ≈ traffic share × detection time |

**Failure modes.**

- **Restart storm** — liveness depends on the database; DB slows; all pods restart → liveness only checks the process itself.
- **Fleet-wide removal** — readiness fails everywhere because of a shared dependency; the LB has no healthy targets → degrade instead of failing readiness; LBs that "fail open" when all targets are unhealthy.
- **Zombie instance** — health endpoint returns 200 but real requests fail (e.g. a broken thread pool) → passive health checks / outlier detection on real traffic, deeper readiness checks.
- **Slow detection** → shorter intervals for critical paths, plus passive checks.
- **Flapping** → healthy/unhealthy thresholds with hysteresis.

**In the playground.** `healthcheck` is a **side channel**: connecting it to a service behind a load balancer reduces the LB's **failure-detection time from 30 s to 3 s**, so after a replica crash far fewer requests are sent to the dead instance. Compare the error spike after a crash with and without it. Scenarios: [`scale-out`](../../../../playground/scenarios/index.md#scale-out), [`multi-region`](../../../../playground/scenarios/index.md#multi-region), [`observability-stack`](../../../../playground/scenarios/index.md#observability-stack).

**Real products.**

=== "AWS"

    - **Elastic Load Balancing target health checks** (ALB/NLB).
    - **Amazon Route 53 health checks** — for DNS failover.

=== "GCP"

    - **Cloud Load Balancing health checks**.
    - **Cloud Monitoring uptime checks** — external synthetic probes.

=== "Azure"

    - **Azure Load Balancer health probes** and **Application Gateway health probes**.
    - **Application Insights availability tests** — external synthetic probes.

=== "Open source"

    - **Kubernetes liveness, readiness and startup probes** (used in Hands-on 10).
    - **Spring Boot Actuator** health groups (`/actuator/health/liveness`, `/actuator/health/readiness`).
    - **Prometheus Blackbox Exporter** — HTTP/TCP/ICMP probes from outside.
    - **Envoy** outlier detection — passive health checking in proxies and service meshes.

!!! tip "In the interview"
    "Each replica exposes liveness and readiness separately: liveness only says the process isn't stuck, readiness says it can serve now — it fails during warm-up and shutdown. The load balancer stops routing to a failed replica within seconds, and I never put a database check in liveness, or a slow database restarts the whole fleet."

**Learn more:** [Observability › Signals](../../../classes/observability/signals/index.md) · [Cloud-native › Kubernetes](../../../classes/cloud-native/kubernetes/index.md) · [Reliability › Patterns](../../../classes/reliability/patterns/index.md) · [Edge › Load balancing](../../../classes/edge/load-balancing/index.md) · [Load Balancer](../edge/index.md#lb) · [Hands-on 3](../../../hands-on/3/index.md) · [Hands-on 10](../../../hands-on/10/index.md)
