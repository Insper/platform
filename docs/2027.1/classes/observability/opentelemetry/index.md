
BoxOffice is written in Java (gateway, order, inventory, payment, catalog), Python (the AI `assistant`), runs Nginx at the edge, Kafka in the middle and PostgreSQL at the bottom. Ten years ago, tracing a checkout across all of that meant a vendor agent per language, a proprietary header per vendor, and a full re-instrumentation the day the company changed vendors. Worse, a trace broke at the first component that spoke a different dialect. **OpenTelemetry** (OTel) fixed this by standardising the boring parts — the API, the wire protocol, the context header and the names of things — so that every library and every backend can speak the same language[^1]. (The ideas themselves — trace IDs, spans, parent links, sampling — come from Google's Dapper paper[^4].)

---

## What OpenTelemetry is (and is not)

OpenTelemetry is a CNCF project that defines **how telemetry is produced and transported**. It is **not** a backend: it does not store or display anything. You still choose where the data goes — Prometheus, Tempo, Jaeger, Loki, a cloud service or a vendor — and you can change that choice without touching application code.

| Piece | What it is | BoxOffice example |
|---|---|---|
| **API** | interfaces to create spans, metrics and logs; safe no-ops if no SDK is installed | `Tracer`, `Meter` used inside `payment` |
| **SDK** | the implementation: sampling, batching, resource detection, exporters | configured by the Java agent from environment variables |
| **Instrumentation libraries** | ready-made spans/metrics for frameworks: Spring MVC, JDBC, Kafka clients, FastAPI, HTTP clients | the `SELECT seat_holds` span, created without any code |
| **Semantic conventions** | standard names for attributes and metrics: `http.route`, `db.system`, `messaging.destination.name` | every service names the route the same way, so one dashboard works for all |
| **OTLP** | the OpenTelemetry Protocol, over gRPC (port **4317**) or HTTP/protobuf (port **4318**) | all services export to the Collector over OTLP |
| **Collector** | a standalone process that receives, processes and exports telemetry | redacts card numbers, applies tail sampling, fans out to backends |

The signals have matured at different speeds: **traces** and **metrics** are stable, **logs** became stable later (OTel mostly *bridges* existing logging libraries, adding the trace context), and **profiles** were added as the fourth signal and are still maturing.

``` diagram
flowchart LR
    subgraph services ["BoxOffice services"]
        J["Java services<br/>OTel Java agent"]
        PY["assistant (Python)<br/>OTel SDK"]
        NG["Nginx<br/>OTel module"]
    end
    subgraph col ["OTel Collector"]
        R["receivers<br/>otlp"] --> PR["processors<br/>memory_limiter, k8s attrs,<br/>redaction, tail sampling, batch"] --> E["exporters"]
    end
    J -- OTLP --> R
    PY -- OTLP --> R
    NG -- OTLP --> R
    E --> TEMPO[("Tempo / Jaeger<br/>traces")]
    E --> PROM[("Prometheus / Mimir<br/>metrics")]
    E --> LOKI[("Loki<br/>logs")]
```

---

## Context propagation

A trace exists only if every hop knows which trace it belongs to. **Context propagation** is the mechanism: the caller injects the current trace context into the outgoing request, and the callee extracts it and creates its own span as a child.

### The `traceparent` header

OpenTelemetry uses the W3C Trace Context standard[^2] by default. One header carries the context:

```text
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
             │  │                                │                └─ flags: 01 = sampled
             │  │                                └─ parent-id: the caller's current span (64 bits)
             │  └─ trace-id: same for the whole request (128 bits)
             └─ version
```

On every outgoing call, a service keeps the `trace-id` and the flags and **replaces the parent-id with the ID of its own current span**. No service needs to understand the whole trace; the tree is rebuilt by the backend from the parent links. A second header, `tracestate`, carries vendor-specific data, and **baggage** (`baggage: tenant=festival-x,channel=mobile`) carries business key-value pairs that every downstream service can read — useful, but every byte travels on every request, so keep it small and never put secrets in it.

### Following a checkout

Play the diagram and watch the parent-id change at each hop while the trace-id stays the same — including across Kafka, where the context travels in a **message header**:

``` diagram-sim
sequenceDiagram
    autonumber
    participant GW as gateway
    participant O as order
    participant I as inventory
    participant P as payment
    participant X as payment provider
    participant K as Kafka
    participant N as notification
    GW->>O: POST /orders<br/>traceparent: 00-4bf9…-a1a1…-01
    O->>I: PUT /holds/h7/confirm<br/>traceparent: 00-4bf9…-b2b2…-01
    I-->>O: 200 OK (90 ms)
    O->>P: POST /charges<br/>traceparent: 00-4bf9…-c3c3…-01
    P->>X: POST /v1/charges (CLIENT span recorded by payment)
    X-->>P: 200 OK (1.0 s)
    P-->>O: 201 Created
    O->>K: produce OrderConfirmed<br/>header traceparent: 00-4bf9…-d4d4…-01
    O-->>GW: 201 Created
    K->>N: consume OrderConfirmed (CONSUMER span, parent d4d4…)
    N->>N: send e-mail and push
```

Three details matter in practice:

- **The external provider is a black box.** It will not send its spans to you. The `CLIENT` span recorded by `payment` around the call is all you will ever see of it — which is why that span's duration and status are worth an alert of their own. Many teams also **strip** `traceparent` and `baggage` at egress, so internal IDs do not leak to third parties.
- **Asynchronous hops** propagate through message headers. A consumer that handles one message continues the producer's trace (parent-child). A consumer that processes a **batch** of 500 messages cannot have 500 parents; it starts its own trace and adds **span links** to each producer's span.
- **The trace ends where propagation breaks.** One component that drops the header splits every trace in two.

!!! warning "Where propagation usually breaks"

    | Place | Symptom | Fix |
    |---|---|---|
    | A proxy or gateway that rebuilds requests and drops unknown headers | traces start at the service behind it | forward `traceparent`, `tracestate`, `baggage`; instrument the proxy |
    | Work handed to another thread (`@Async`, executors, reactive code) | child spans appear as separate traces | use instrumented executors (the Java agent wraps common ones) or pass `Context` explicitly |
    | Messaging without headers (old clients, custom envelopes) | consumers start new traces | use headers; or carry the context in the message envelope |
    | A homemade HTTP client | the call has no `CLIENT` span and the callee starts a new trace | use an instrumented client or inject the context manually |

!!! example "In the BoxOffice code: the trace through the outbox (lab 8)"

    The agent propagates the context over HTTP and in Kafka headers by itself, but BoxOffice's events do not go straight to Kafka: since lab 7, `order` writes them to an **outbox** table in the same transaction as the order, and a relay publishes them later, on a scheduler thread — a hop the agent cannot see, which split every order into two unrelated traces. [Hands-on 8 — Instrument everything](../../../hands-on/8/instrument/index.md) carries the `traceparent` with the data: one new column (`V2__outbox_traceparent.sql`), `inject` when the row is written, then `extract` and `makeCurrent()` before the relay sends, so the agent's producer span becomes a child of the original request. In the lab's test run the result is **one** trace: the request took 9 ms, the relay published 22 ms after it started, and `notification` spent 67 ms.

    ``` { .java title="services/order/src/main/java/boxoffice/order/outbox/Outbox.java (write the event and its traceparent)" }
    --8<-- "docs/2027.1/hands-on/8/code/services/order/src/main/java/boxoffice/order/outbox/Outbox.java:26:39"
    ```

    ``` { .java title="services/order/src/main/java/boxoffice/order/outbox/OutboxRelay.java (publish inside the original context)" }
    --8<-- "docs/2027.1/hands-on/8/code/services/order/src/main/java/boxoffice/order/outbox/OutboxRelay.java:78:88"
    ```

---

## Instrumenting BoxOffice

### Zero-code: the Java agent

The OpenTelemetry Java agent attaches to the JVM and instruments hundreds of libraries — Spring MVC/WebFlux, JDBC, HikariCP, Kafka clients, HTTP clients, Logback — by bytecode injection, with no code changes. It also puts `trace_id` and `span_id` into the logging context (MDC), so structured logs carry them automatically.

```dockerfile
# Dockerfile (excerpt) — pin a version; check the latest release before upgrading
ADD https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v2.32.0/opentelemetry-javaagent.jar /otel/opentelemetry-javaagent.jar
ENTRYPOINT ["java", "-javaagent:/otel/opentelemetry-javaagent.jar", "-jar", "/app/app.jar"]
```

```yaml
# docker-compose.yaml (excerpt) — the order service
environment:
  OTEL_SERVICE_NAME: order
  OTEL_RESOURCE_ATTRIBUTES: service.namespace=boxoffice,service.version=1.4.2,deployment.environment.name=dev
  OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318   # agent 2.x default protocol: http/protobuf
  OTEL_TRACES_SAMPLER: parentbased_always_on                 # keep all; the Collector decides (tail sampling)
  OTEL_METRIC_EXPORT_INTERVAL: "15000"
```

`service.name` is the most important attribute in OpenTelemetry: without it, every service appears as `unknown_service:java` and no dashboard can tell them apart. `service.version` and `deployment.environment.name` let you compare a canary with the stable version, or staging with production.

!!! example "In the BoxOffice code: one agent for every Java service (lab 8)"

    [Hands-on 8 — Instrument everything](../../../hands-on/8/instrument/index.md) does not bake the agent into the images, as the Dockerfile above does: `scripts/get-otel-agent.sh` downloads a pinned version (2.32.0) once into `infra/otel/`, and every Java service mounts it read-only and loads it through `JAVA_TOOL_OPTIONS`. The settings live in one YAML anchor merged into each service, so the services cannot drift apart; only `OTEL_SERVICE_NAME` changes — three `catalog` replicas, **one** service. `OTEL_ON=false` runs the same image without the agent, which is how the lab measures what the agent costs; metrics are exported every 10 s instead of 60 s, so the dashboards react within a short experiment.

    ``` { .yaml title="docker-compose.yaml (the x-otel anchor and the catalog replicas)" }
    --8<-- "docs/2027.1/hands-on/8/code/docker-compose.yaml:3:12,15:22"
    ```

### Zero-code: the Python `assistant`

```bash
uv add opentelemetry-distro opentelemetry-exporter-otlp
uv run opentelemetry-bootstrap -a requirements > otel-instrumentations.txt   # instrumentations for the libraries found (FastAPI, httpx, psycopg…)
uv add -r otel-instrumentations.txt
OTEL_SERVICE_NAME=assistant \
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318 \
uv run opentelemetry-instrument uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Manual spans where the agent cannot see

Automatic instrumentation sees I/O. It cannot see **business steps** or **waiting inside your code** — the connection pool of the payment adapter in the [Signals](../signals/index.md#reading-a-waterfall) waterfall. A few manual spans in the right places are worth more than hundreds of automatic ones:

```java
private static final Tracer tracer = GlobalOpenTelemetry.getTracer("boxoffice.payment");

ProviderConnection acquire() throws TimeoutException {
    Span span = tracer.spanBuilder("pool.acquire").startSpan();
    try (Scope ignored = span.makeCurrent()) {
        long start = System.nanoTime();
        ProviderConnection c = pool.borrow(Duration.ofMillis(500));   // bounded wait, never forever
        span.setAttribute("pool.wait_ms", (System.nanoTime() - start) / 1_000_000);
        return c;
    } catch (TimeoutException e) {
        span.recordException(e);
        span.setStatus(StatusCode.ERROR, "pool exhausted");
        throw e;
    } finally {
        span.end();
    }
}
```

With the agent attached, the simplest alternative is an annotation on a method: `@WithSpan("seatmap.render")`, with `@SpanAttribute` on the parameters you want recorded.

!!! tip "Attributes: rich, but not dangerous"

    Span attributes can have high cardinality — `order.id`, `event.id`, `customer.tier` are what make a trace searchable. They must not contain secrets or personal data: no card numbers, tokens or full e-mails. Redact at the source and add a redaction processor in the Collector as a second barrier.

---

## The Collector

Services could export directly to each backend, but then every service must know every backend, its credentials and its retry policy. The **Collector** decouples them: services send OTLP to one place, and the Collector's **pipelines** decide what happens next. A pipeline has three stages per signal: **receivers** (how data gets in), **processors** (what is done to it, in order), **exporters** (where it goes).

```yaml
# otel-collector.yaml — gateway Collector for BoxOffice (sketch)
receivers:
  otlp:
    protocols:
      grpc: { endpoint: 0.0.0.0:4317 }
      http: { endpoint: 0.0.0.0:4318 }

processors:
  memory_limiter:                 # first: refuse data instead of being OOM-killed
    check_interval: 1s
    limit_percentage: 80
    spike_limit_percentage: 20
  k8sattributes: {}               # add k8s.pod.name, k8s.namespace.name, k8s.deployment.name
  attributes/redact:
    actions:
      - key: payment.card_number
        action: delete
      - key: enduser.email
        action: hash
  tail_sampling:
    decision_wait: 10s            # wait for the trace's spans before deciding
    policies:
      - name: keep-errors
        type: status_code
        status_code: { status_codes: [ERROR] }
      - name: keep-slow
        type: latency
        latency: { threshold_ms: 2000 }
      - name: some-of-the-rest
        type: probabilistic
        probabilistic: { sampling_percentage: 5 }
  batch: {}                       # last: send in batches

exporters:
  otlp/tempo:
    endpoint: tempo:4317
    tls: { insecure: true }
  otlphttp/prometheus:
    endpoint: http://prometheus:9090/api/v1/otlp
  otlphttp/loki:
    endpoint: http://loki:3100/otlp

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, k8sattributes, attributes/redact, tail_sampling, batch]
      exporters: [otlp/tempo]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, k8sattributes, batch]
      exporters: [otlphttp/prometheus]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, k8sattributes, attributes/redact, batch]
      exporters: [otlphttp/loki]
```

The order of processors matters: `memory_limiter` first, so an overloaded Collector sheds data instead of crashing; `batch` last, so it batches what survived.

### Deployment patterns

| Pattern | Where it runs | Good for | Watch out |
|---|---|---|---|
| **No Collector** (SDK → backend) | — | demos, one backend | every service holds backend config and credentials |
| **Agent** | DaemonSet (one per node) or sidecar | local batching, host metrics, adding node/pod attributes | per-node resources; cannot see whole traces |
| **Gateway** | a Deployment behind a Service, scaled horizontally | central policy: redaction, tail sampling, routing, credentials | a new critical component: size it and monitor it |
| **Agent + gateway** (two tiers) | both | large clusters | tail sampling needs **all spans of a trace on the same gateway instance** — route by trace ID (`loadbalancing` exporter) |

!!! warning "The Collector is production infrastructure"

    During the flash sale, telemetry volume rises with traffic. A Collector without `memory_limiter`, without enough replicas, or exporting synchronously to a slow backend becomes a bottleneck — and if SDKs block on export, it can even slow the services. SDKs export asynchronously and drop data when their queue is full: **losing telemetry is acceptable; slowing checkout to report on it is not.** Monitor the Collector's own metrics (accepted vs refused vs dropped spans, queue size).

---

## Sampling

Keeping every span of every request is rarely affordable (see [what telemetry costs](../index.md#what-telemetry-costs)). **Sampling** keeps a subset of traces — complete traces, not random spans, otherwise the trees break.

| Strategy | Where the decision is made | Pros | Cons |
|---|---|---|---|
| **Head sampling** (e.g. `parentbased_traceidratio` 10%) | at the first span, from the trace ID; travels in the `sampled` flag so every service agrees | cheap; no buffering; consistent across services | **blind**: it drops 90% of the rare error and slow traces too |
| **Tail sampling**[^3] | in the Collector, after the whole trace has arrived (`decision_wait`) | keeps *interesting* traces: every error, every slow request, plus a sample of the rest | every span must reach the Collector; memory to buffer; all spans of a trace on one instance |
| **Rate limiting** | SDK or Collector: at most N traces per second | predictable cost | during a spike, almost everything is dropped — exactly when you need it |

Head and tail sampling are applied in sequence: a trace dropped at the head can never be rescued by the tail. The comparison below uses illustrative numbers for a busy BoxOffice day — 2,000 requests/s, 8 spans per request of 500 bytes, 1% of requests failing and 2% slower than the 2 s threshold:

```python exec="true"
RPS, SPANS, SPAN_BYTES, DAY = 2_000, 8, 500, 86_400
ERR, SLOW = 0.01, 0.02          # fraction of requests that fail / are slow (illustrative)

def gb_per_day(fraction_kept):
    return RPS * SPANS * SPAN_BYTES * DAY * fraction_kept / 1e9

strategies = [
    ("keep everything", 1.0, 1.0),
    ("head sampling 10%", 0.10, 0.10),
    ("head sampling 1%", 0.01, 0.01),
    ("tail: all errors + all slow + 5% of the rest", ERR + SLOW + 0.05 * (1 - ERR - SLOW), 1.0),
]
errors_per_day = RPS * ERR * DAY
print("| Strategy | Traces kept | Storage per day | Error traces kept per day |")
print("|---|---:|---:|---:|")
for name, kept, err_kept in strategies:
    print(f"| {name} | {kept:.1%} | {gb_per_day(kept):,.1f} GB | {errors_per_day * err_kept:,.0f} ({err_kept:.0%}) |")
```

Tail sampling stores less than 10% head sampling and still keeps **every** error trace — at the price of shipping 100% of the spans over the network to the Collector and buffering them for the decision window. A common production recipe: head sampling at 100% (or a high ratio) in the services, tail sampling in a gateway Collector, and **metrics computed from all requests before sampling**, so dashboards and SLOs are exact even though most traces are discarded.

!!! example "Exemplars: from a metric to a trace"

    An **exemplar** is a `trace_id` attached to a sample of a metric — for instance, to the latency histogram bucket where a 9 s checkout landed. In Grafana, the latency panel shows exemplars as dots; clicking one opens that exact trace in Tempo. It is the bridge between "p99 is high" and "here is one request that was slow" — make sure the exemplar's trace was *kept* by your sampler (tail sampling of slow requests guarantees it).

---

## Backends and a local stack

OpenTelemetry leaves the backend to you. The same OTLP data can go to any of them:

=== "Open source"

    **Grafana LGTM**: **L**oki (logs), **G**rafana (UI), **T**empo (traces), **M**imir or Prometheus (metrics), plus Pyroscope (profiles). Alternatives: Jaeger for traces, OpenSearch for logs, ClickHouse-based stacks (SigNoz) for everything. You operate the storage.

=== "AWS"

    CloudWatch (metrics, logs, alarms), X-Ray / CloudWatch Application Signals (traces), Amazon Managed Service for Prometheus and Managed Grafana. AWS Distro for OpenTelemetry (ADOT) packages the Collector.

=== "GCP"

    Cloud Monitoring, Cloud Logging and Cloud Trace (Google Cloud Observability); Managed Service for Prometheus. Accepts OTLP through the Collector.

=== "Azure"

    Azure Monitor: Application Insights (traces, requests), Log Analytics (logs), Managed Prometheus and Managed Grafana. The Azure Monitor OpenTelemetry distro instruments applications.

=== "SaaS"

    Datadog, Honeycomb, New Relic, Grafana Cloud, Dynatrace, Elastic Cloud and others accept OTLP. You pay per volume (spans, series, GB of logs) — the sampling and cardinality decisions of this class are also cost decisions.

For development — and in [Hands-on 8](../../../hands-on/8/index.md) — a single container bundles a Collector with the whole LGTM stack:

```yaml
# docker-compose.yaml (excerpt)
services:
  otel-lgtm:
    image: grafana/otel-lgtm
    ports:
      - "3000:3000"   # Grafana
      - "4317:4317"   # OTLP gRPC
      - "4318:4318"   # OTLP HTTP
```

---

## Trade-offs

| Decision | Option A | Option B | Guidance |
|---|---|---|---|
| Instrumentation | zero-code agent | manual SDK calls | start with the agent; add manual spans for business steps and internal waits |
| Export path | SDK → backend | SDK → Collector → backend | a Collector as soon as there are two services or one policy (redaction, sampling) |
| Collector topology | agent per node | central gateway | agents for local enrichment; a gateway for tail sampling and credentials |
| Sampling | head | tail | head for cost simplicity; tail to keep every error and slow trace |
| Protocol | OTLP gRPC (4317) | OTLP HTTP (4318) | either; HTTP is friendlier to proxies and browsers |
| Backend | self-hosted | managed / SaaS | managed until the bill or data-residency rules say otherwise |

!!! tip "In the interview"

    "How do you trace a request across microservices?" — *"Every service is instrumented with OpenTelemetry; the W3C `traceparent` header (and Kafka message headers for async hops) propagates the trace ID; spans go over OTLP to a Collector that applies tail sampling — keep all errors and slow traces, a few percent of the rest — and exports to a tracing backend. Logs carry the trace ID, and the latency histograms carry exemplars, so I can jump from a dashboard to a trace to its logs."* Then add the cost angle: metrics are computed from 100% of the traffic; traces are sampled.

!!! success "Best practices"

    - **Pin the agent and SDK versions, and upgrade on purpose** — a new instrumentation release can rename metrics and attributes (semantic conventions evolve), silently breaking dashboards and alerts. In BoxOffice: `scripts/get-otel-agent.sh` pins 2.32.0.
    - **Configure OpenTelemetry once, through environment variables shared by every service** — exporter, sampler, resource attributes; only `OTEL_SERVICE_NAME` differs per service. In BoxOffice: the `x-otel` anchor (box above).
    - **Use a parent-based sampler at the head** — the root decides once and every hop follows it, so a trace is kept or dropped whole, never in fragments. In BoxOffice: `OTEL_TRACES_SAMPLER=parentbased_always_on`, and `parentbased_traceidratio` at 10% in experiment B of [Hands-on 8 — Measure it](../../../hands-on/8/measure/index.md).
    - **Carry `traceparent` across every asynchronous hop you own** — outbox rows, job tables, custom envelopes; each hop without it splits every trace in two. In BoxOffice: the `traceparent` column of the outbox (box above).
    - **Strip `traceparent` and `baggage` at the egress to third parties** — internal ids and business context should not leak to a payment provider that will never send you its spans.
    - **Monitor the Collector itself** — its own metrics (refused and failed exports, queue size, memory) are the only sign that telemetry is being dropped; a silent Collector looks exactly like a quiet system.

!!! warning "Common pitfalls"

    - **Protocol and port mismatch**: the Java agent 2.x defaults to OTLP over HTTP (4318); pointing it at 4317 without `OTEL_EXPORTER_OTLP_PROTOCOL=grpc` silently produces no data.
    - **Missing `service.name`**: everything shows up as `unknown_service`.
    - **Head sampling at 1% and no tail sampling**: the one trace you need during the incident was dropped.
    - **Tail sampling behind a round-robin load balancer**: spans of the same trace land on different Collectors, and every decision is made on fragments.
    - **No `memory_limiter`**: the Collector is OOM-killed exactly during the traffic peak.
    - **Secrets and personal data in attributes or baggage**: telemetry is copied to many systems and kept for weeks.

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    KH["Kafka message headers,<br/>span links → Messaging"] --> CTX["context propagation:<br/>traceparent, baggage"]
    CTX --> SVC["services: Java agent,<br/>Python SDK, Nginx"]
    SVC -->|"OTLP 4317 / 4318"| COL["Collector:<br/>receivers → processors → exporters"]
    COL --> RD["redaction:<br/>no cards, no e-mails"]
    COL --> TS["tail sampling:<br/>errors + slow + 5%"]
    TS --> TR["traces backend<br/>Tempo / Jaeger"]
    COL --> MET["metrics from all traffic<br/>→ SLOs, Alerting"]
    COL --> LG["logs backend<br/>Loki"]
    MET -->|"exemplars"| TR
    COL --> OPS["memory_limiter, gateway replicas<br/>→ Cloud-native"]
```

**Palette components:** [`tracing`](../../../reference/components/observability/index.md#tracing) · [`metrics`](../../../reference/components/observability/index.md#metrics) · [`logs`](../../../reference/components/observability/index.md#logs) · [`app`](../../../reference/components/compute/index.md#app) (instrumented services) · [`apigw`](../../../reference/components/edge/index.md#apigw) (must forward `traceparent`) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (context in message headers) · [`payment`](../../../reference/components/external/index.md#payment) (a black box: only the `CLIENT` span). **Scenarios:** `observability-stack`, `event-fanout` (traces that cross Kafka). **Continues in:** [Signals](../signals/index.md), [Alerting](../alerting/index.md), [Messaging — Kafka](../../messaging/kafka/index.md), [Cloud-native — Kubernetes](../../cloud-native/kubernetes/index.md) (Collector as DaemonSet or Deployment), [Hands-on 8 — instrument everything](../../../hands-on/8/instrument/index.md).

---

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - OpenTelemetry standardises the **API, SDK, semantic conventions, protocol (OTLP) and Collector** — not the backend; change backends without re-instrumenting.
    - **Context propagation** with W3C `traceparent` (and message headers for Kafka) is what makes a trace; one hop that drops it splits every trace.
    - Start with **zero-code instrumentation**, then add manual spans for business steps and for **time spent waiting** inside services.
    - The **Collector** pipelines (receivers → processors → exporters) centralise redaction, enrichment, sampling and routing; treat it as production infrastructure.
    - **Tail sampling** keeps every error and slow trace at a fraction of the storage; compute metrics from all traffic before sampling, and use **exemplars** to jump from metrics to traces.

---

[^1]: OPENTELEMETRY. [What is OpenTelemetry?](https://opentelemetry.io/docs/what-is-opentelemetry/){target="_blank"} and [Collector documentation](https://opentelemetry.io/docs/collector/){target="_blank"}.
[^2]: W3C. [Trace Context](https://www.w3.org/TR/trace-context/){target="_blank"}. W3C Recommendation. See also [W3C Baggage](https://www.w3.org/TR/baggage/){target="_blank"}.
[^3]: OPENTELEMETRY COLLECTOR CONTRIB. [Tail Sampling Processor](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/tailsamplingprocessor){target="_blank"}.
[^4]: SIGELMAN, B. H. et al. [Dapper, a Large-Scale Distributed Systems Tracing Infrastructure](https://research.google/pubs/dapper-a-large-scale-distributed-systems-tracing-infrastructure/){target="_blank"}. Google Technical Report, 2010.
