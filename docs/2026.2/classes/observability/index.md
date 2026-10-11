
# Observability

A system you cannot observe is a system you cannot operate. Monitoring tells you that something is wrong; observability tells you *why*. The distinction matters in microservices: a request that touches eight services and three databases cannot be diagnosed from a single metric on a single dashboard. Observability is the property of a system that makes its internal state inferable from external outputs.

Picture a customer complaining that "checkout is slow" in the store. The request went through Nginx, the gateway, the auth check, the order service, the product service and Postgres, and maybe published an event to Kafka. Which one was slow? Was it slow for everyone or just for this customer? Without telemetry designed in advance — numbers, records and request paths emitted by every service — the only answer is guessing.

!!! abstract "Learning objectives"

    By the end of this class you should be able to:

    - **Explain** the difference between monitoring and observability, and which question each pillar (metrics, logs, traces) answers.
    - **Write** PromQL queries for request rate, error ratio and latency percentiles of a Spring Boot service, and **build** RED / USE dashboards.
    - **Configure** structured logs that carry the trace ID, and **correlate** a log line with its trace.
    - **Explain** how trace context crosses services with the W3C `traceparent` header, and **choose** a sampling strategy.
    - **Instrument** a Spring Boot service with OpenTelemetry (Java agent and manual spans) and **design** symptom-based alerts.

## Slides

<div class="slides-embed">
  <iframe src="slides/observability.html" title="Slides: observability" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/observability.html){:target="_blank"}

---

## The Three Pillars

Observability is built on three complementary data types. Each answers a different question about system behaviour.

| Pillar | Answers | Toolchain | Retention |
|---|---|---|---|
| **Metrics** | Is the system healthy right now? Is it trending up or down? | Prometheus → Grafana | Weeks to months (aggregated) |
| **Logs** | What exactly happened, and in what sequence? | ELK / EFK / Loki | Days to weeks |
| **Traces** | Which service in this request was slow? Where did the error originate? | Jaeger / Tempo / Zipkin | Days |

All three describe the same events from different angles. One `POST /orders` that fails produces: an increment of a counter `http_server_requests_seconds_count{status="500"}` (metric), a JSON line `{"level":"ERROR","msg":"product not found",...}` (log), and a trace with one span per hop, the last one marked `ERROR` (trace). Metrics are cheap and tell you *that* something changed; logs and traces are more expensive and tell you *what* and *where*.

!!! info "Observability ≠ Monitoring"
    Monitoring asks pre-defined questions: "Is the error rate below 1%?" Observability lets you ask questions you didn't think of at design time: "Why are exactly 7% of requests from mobile clients in São Paulo timing out on a Tuesday?" Observability requires all three pillars working together[^2].

---

## Metrics

### Prometheus Data Model

Every time series has a metric name and a set of key-value labels:

```
http_requests_total{method="GET", status="200", service="order"} 4823
```

| Type | What it measures | Example |
|---|---|---|
| **Counter** | Monotonically increasing value; never decreases | `http_requests_total`, `errors_total` |
| **Gauge** | Current value that can go up or down | `memory_bytes`, `active_connections` |
| **Histogram** | Distribution of values in configurable buckets | `http_request_duration_seconds{le="0.1"}` |
| **Summary** | Pre-calculated quantiles (less flexible than histogram) | `http_request_duration_seconds{quantile="0.99"}` |

A **label** is a dimension of the series: every distinct combination of label values is a separate time series stored by Prometheus.

### PromQL Basics

PromQL is Prometheus' query language. The queries below use the metric that Spring Boot (Micrometer) exports for every HTTP endpoint, `http_server_requests_seconds`, with the labels `application`, `uri`, `method` and `status`:

| Query | Meaning |
|---|---|
| `rate(http_server_requests_seconds_count[5m])` | Requests per second, averaged over the last 5 minutes |
| `sum by (application) (rate(http_server_requests_seconds_count{status=~"5.."}[5m]))` | 5xx errors per second, per service |
| `sum(rate(http_server_requests_seconds_count{status=~"5.."}[5m])) / sum(rate(http_server_requests_seconds_count[5m]))` | Error **ratio** (0–1) — the basis of an availability SLI |
| `histogram_quantile(0.99, sum by (le) (rate(http_server_requests_seconds_bucket[5m])))` | P99 latency across all instances |
| `increase(http_server_requests_seconds_count[1h])` | Total requests in the last hour |

Two rules: apply `rate()` or `increase()` to a counter **before** summing (they handle counter resets when a pod restarts), and keep the `le` label when summing histogram buckets (`sum by (le)`), because `histogram_quantile` needs it. The `_bucket` series exist only if histograms are enabled: `management.metrics.distribution.percentiles-histogram.http.server.requests=true`.

!!! info "Why percentiles, not averages"
    If 99 requests take 50 ms and 1 takes 5 s, the average is ~100 ms — it looks fine, but one user in a hundred waits 5 seconds. P99 (the value below which 99% of requests fall) exposes that tail; with many calls per page, most users hit the tail somewhere.

### RED, USE and the Golden Signals

| Method | For | Metrics |
|---|---|---|
| **RED** (Tom Wilkie) | Services / APIs | **R**ate (requests/sec), **E**rrors (error rate), **D**uration (latency percentiles) |
| **USE** (Brendan Gregg) | Infrastructure / Resources | **U**tilisation (% busy), **S**aturation (queue depth), **E**rrors |
| **Four golden signals** (Google SRE[^1]) | Any user-facing system | Latency, Traffic, Errors, Saturation |

!!! tip "Which method to use?"
    Use RED for service-level dashboards (what users experience), USE for infrastructure dashboards (what resources experience). Both together give complete coverage.

### Metrics Pipeline

``` mermaid-sim
flowchart LR
    app["Spring Boot\n(Actuator + Micrometer)"]
    prom["Prometheus"]
    grafana["Grafana\n(dashboards + alerts)"]
    prom -->|"scrapes /actuator/prometheus (e.g. every 15 s)"| app
    prom -->|"PromQL queries"| grafana
```

Prometheus uses a **pull** model: the application only exposes its current values at an HTTP endpoint, and Prometheus fetches (scrapes) them on a schedule and stores them as time series. This is what [Hands-on 6](../../hands-on/6/index.md) sets up for the store.

Spring Boot Actuator configuration to expose the Prometheus endpoint (it also needs the `io.micrometer:micrometer-registry-prometheus` dependency):

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,prometheus
  metrics:
    tags:
      application: ${spring.application.name}
```

!!! warning "Label cardinality"
    Never put unbounded values — user ID, order ID, e-mail, full URL with IDs — in a metric label. Each distinct value creates a new time series; 100,000 users × 10 endpoints × 5 status codes is 5 million series, and Prometheus runs out of memory. High-cardinality details belong in **logs and traces**. (This is why Spring Boot uses the URI *template* `/orders/{id}` as the `uri` label, not `/orders/42`.)

### Alerting

Dashboards need someone looking at them; **alerts** notify a human when action is needed. Prometheus evaluates alerting rules and sends firing alerts to Alertmanager (or Grafana Alerting), which routes them to e-mail, Slack or a pager.

```yaml
groups:
  - name: order-service
    rules:
      - alert: OrderHighErrorRatio
        expr: |
          sum(rate(http_server_requests_seconds_count{application="order", status=~"5.."}[5m]))
          /
          sum(rate(http_server_requests_seconds_count{application="order"}[5m])) > 0.05
        for: 5m                     # must hold for 5 minutes, avoids flapping
        labels:
          severity: page
        annotations:
          summary: "More than 5% of order requests are failing"
```

!!! tip "Alert on symptoms, not causes"
    Page people for what users feel — error ratio, latency, an SLO error budget burning fast (see [SLI / SLO / SLA](../reliability/sli-slo-sla/index.md)) — not for "CPU above 80%". High CPU with happy users is not an emergency; an alert that fires without requiring action trains people to ignore alerts.

---

## Logs

### Structured vs Unstructured

| | Unstructured | Structured (JSON) |
|---|---|---|
| Example | `2024-01-15 ERROR Order 42 failed` | `{"level":"ERROR","orderId":42,"msg":"failed","traceId":"abc123"}` |
| Searchable | grep / regex only | Full field queries |
| Aggregatable | Hard | Easy (Kibana, Loki) |
| Machine-parseable | Brittle | Reliable |

### Log Levels

| Level | Use |
|---|---|
| TRACE | Extremely detailed — every method entry/exit. Never in production. |
| DEBUG | Diagnostic — variable values, decision points. Dev/staging only. |
| INFO | Significant events — startup, config loaded, request received |
| WARN | Something unexpected but handled — retry triggered, fallback used |
| ERROR | Failure requiring attention — exception caught, downstream unreachable |

### Correlation IDs and MDC

When a request touches multiple services, a shared ID in every log line — a **correlation ID** — allows reconstructing the full call sequence by searching for that one value. With distributed tracing, the natural correlation ID is the **trace ID**.

In Java, the place to put it is the **MDC** (Mapped Diagnostic Context) of SLF4J/Logback: a per-thread map of key-value pairs that the logging framework can print in every line with `%X{key}`. Who fills the MDC depends on how the service is instrumented:

=== "OpenTelemetry Java agent (automatic)"

    With the OTel Java agent attached (see [below](#java-zero-code-instrumentation) and [Hands-on 10](../../hands-on/10/index.md)), you write **no MDC code** for the trace context. The agent's Logback/Log4j instrumentation puts the active `trace_id`, `span_id` and `trace_flags` into the MDC whenever a span is current, and removes them afterwards. You only reference the keys in the pattern:

    ```
    %d{ISO8601} [%thread] %-5level %logger{36} [trace_id=%X{trace_id} span_id=%X{span_id}] - %msg%n
    ```

    Without the agent, the same keys can be filled by the `opentelemetry-logback-mdc-1.0` library; Spring Boot's own Micrometer Tracing fills the keys `traceId` and `spanId` instead. Use the key names of the tool you actually run.

=== "Manual MDC (your own keys)"

    `MDC.put` is for **business context** that no tool can know — the customer ID, the order ID — or for a correlation ID when there is no tracing at all. Always remove what you put: threads are reused by the server's pool, and a forgotten key leaks into the next request's logs.

    ```java
    public Order create(OrderIn in) {
        try (var ignored = MDC.putCloseable("customerId", in.customerId())) {  // removed at the end
            log.info("creating order");   // ... [trace_id=4bf9...] customerId=c-42 ... creating order
            return repository.save(...);
        }
    }
    ```

    ```
    %d{ISO8601} %-5level [trace_id=%X{trace_id}] customerId=%X{customerId} %logger{36} - %msg%n
    ```

!!! warning "MDC is per thread"
    The MDC lives in a `ThreadLocal`. Work handed to another thread (`@Async`, `CompletableFuture`, reactive code such as the WebFlux gateway) does not see it unless the context is propagated; the OTel agent does this for the libraries it instruments, but your own `MDC.put` values are not copied automatically.

### Log Aggregation Pipeline

``` mermaid-sim
flowchart LR
    svc1["Service A\n(JSON logs → stdout)"]
    svc2["Service B\n(JSON logs → stdout)"]
    svc3["Service C\n(JSON logs → stdout)"]
    collector["Filebeat / Fluentd\n(collector)"]
    elastic["Elasticsearch\n(index + store)"]
    kibana["Kibana\n(search + dashboards)"]
    svc1 --> collector
    svc2 --> collector
    svc3 --> collector
    collector --> elastic
    elastic --> kibana
```

!!! note "Loki as a lighter alternative"
    Loki (Grafana Labs) indexes only labels, not full text, making it much cheaper to operate than Elasticsearch. If you already run Prometheus and Grafana, adding Loki gives you log aggregation with zero new UI to learn — all signals live in the same Grafana dashboards.

---

## Distributed Traces

### Anatomy of a Trace

A **trace** represents a single end-to-end request. It is composed of **spans** — one per operation (service call, DB query, cache lookup, etc.).

| Field | Description | Example |
|---|---|---|
| `traceId` | Globally unique ID for the entire request (128 bits) | `4bf92f3577b34da6a3ce929d0e0e4736` |
| `spanId` | Unique ID for this operation | `00f067aa0ba902b7` |
| `parentSpanId` | Span that triggered this one | `a2fb4a1d1a96d312` |
| `name` | Operation name | `GET /orders/{id}` |
| `startTime` / `duration` | When it started and how long it took | `2024-01-15T10:30:00Z, 45ms` |
| `status` | OK / ERROR | `ERROR` |
| `attributes` | Key-value tags | `http.status_code=500, db.type=postgresql` |

### W3C `traceparent` Header

The `traceparent` header propagates trace context across service boundaries using the format `version-traceId-parentSpanId-flags`:

```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

| Field | Value | Meaning |
|---|---|---|
| `version` | `00` | W3C spec version |
| `traceId` | `4bf92f3577b34da6a3ce929d0e0e4736` | 128-bit globally unique trace ID |
| `parentSpanId` | `00f067aa0ba902b7` | 64-bit ID of the span that sent this request |
| `flags` | `01` | Sampling flag (`01` = sampled) |

On every downstream call, a service keeps the `version`, the `traceId` and (normally) the `flags` exactly as received, and replaces the `parentSpanId` field with the ID of **its own** current span. This is how trace context crosses service boundaries without any service needing to understand the full trace. The header is defined by the W3C Trace Context recommendation[^5]; OpenTelemetry uses it by default.

### Request Flow with Spans

``` mermaid-sim
sequenceDiagram
    autonumber
    actor User
    participant GW as Gateway [span: root, 120ms]
    participant OS as OrderService [span: child, 95ms]
    participant DB as PostgreSQL [span: leaf, 40ms]

    User->>+GW: GET /orders/42<br/>traceparent: 00-abc...-root-01
    GW->>+OS: GET /orders/42<br/>traceparent: 00-abc...-gw_span-01
    OS->>+DB: SELECT * FROM orders WHERE id=42
    DB-->>-OS: row data
    OS-->>-GW: 200 OK (95ms)
    GW-->>-User: 200 OK (120ms)
```

### Sampling Strategies

Recording every span of every request is expensive at scale, so tracing systems keep only a **sample** of traces.

| Strategy | How | Tradeoff |
|---|---|---|
| **Head sampling** | The decision is made at the first span (e.g. keep 10% by trace ID: `parentbased_traceidratio`) and travels in the `flags` of `traceparent`, so every service agrees | Cheap and simple, but blind: it drops 90% of the rare error traces too |
| **Tail sampling** | All spans are sent to the OTel Collector, which waits until the trace is complete and then decides | Can keep every error or slow trace, but the Collector must buffer all spans in memory |
| **Rate-limiting** | Keep at most N traces per second | Predictable cost; under a spike most traces are dropped |

!!! tip "Production recommendation"
    Head and tail sampling are applied in sequence, so a trace dropped at the head can never be "rescued" by the tail. To keep every error trace, sample **100% at the head** (or a high ratio) in the services, and let a **tail-sampling** policy in the OTel Collector keep all traces with an `ERROR` span or a high latency plus a small percentage (1–10%) of the normal ones. If you cannot run tail sampling, a head ratio of 1–10% is a reasonable default — accepting that some error traces will be lost and their logs are your fallback.

---

## OpenTelemetry (OTel)

OpenTelemetry is the CNCF standard for generating, collecting, and exporting telemetry[^3]. It replaces vendor-specific SDKs (Zipkin client, Jaeger client, etc.) with a single neutral API, so switching backends requires only a configuration change, not a code change.

| Component | Role |
|---|---|
| **API** | Language-specific interfaces — Tracer, Meter, Logger |
| **SDK** | Implementation of the API; includes sampling, batching, exporters |
| **Collector** | Standalone process that receives, processes, and exports telemetry |
| **Exporter** | Protocol adapter that sends the data out: OTLP (the default), Zipkin, Prometheus, console |
| **OTLP** | The OpenTelemetry Protocol, over gRPC (port 4317) or HTTP/protobuf (port 4318); Jaeger, Tempo and most vendors accept it natively |

``` mermaid-sim
flowchart LR
    app["Application\n(OTel SDK)"]
    collector["OTel Collector"]
    prom["Prometheus\n(metrics)"]
    jaeger["Jaeger\n(traces)"]
    loki["Loki\n(logs)"]
    app -->|"OTLP (gRPC/HTTP)"| collector
    collector --> prom
    collector --> jaeger
    collector --> loki
```

### Java Zero-Code Instrumentation

The OTel Java agent instruments Spring Boot automatically via bytecode injection — no code changes required.

```dockerfile
# pin a version: "latest" makes builds unreproducible
ADD https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v2.4.0/opentelemetry-javaagent.jar /app/opentelemetry-javaagent.jar

ENTRYPOINT ["java", \
  "-javaagent:/app/opentelemetry-javaagent.jar", \
  "-jar", "/app/app.jar"]
```

Configure the agent via environment variables in Docker Compose:

```yaml
environment:
  OTEL_SERVICE_NAME: order-service
  OTEL_EXPORTER_OTLP_PROTOCOL: grpc            # agent 2.x defaults to http/protobuf (port 4318)
  OTEL_EXPORTER_OTLP_ENDPOINT: http://jaeger:4317
  OTEL_METRICS_EXPORTER: none
  OTEL_LOGS_EXPORTER: none
```

!!! warning "Match the protocol to the port"
    Since version 2.0 the Java agent sends OTLP over **HTTP/protobuf** by default, which listens on port **4318**. Either point it at `http://jaeger:4318`, or keep port 4317 and set `OTEL_EXPORTER_OTLP_PROTOCOL=grpc` as above. A mismatch produces no traces and only an export error in the service log.

!!! note "Why disable metrics/logs exporters?"
    The Java agent can export all three signals via OTLP. We disable metrics and logs here because Prometheus already scrapes metrics via Actuator and Loki (or ELK) handles logs separately. Enabling all three from the agent would duplicate data and inflate storage costs.

### Manual Spans

When automatic instrumentation is not granular enough — you want to see how long *your* price calculation took, not just the HTTP and SQL calls around it — add custom spans. Add the OTel API dependency (its version is managed by the `opentelemetry-bom`, or set it explicitly):

```xml
<dependency>
    <groupId>io.opentelemetry</groupId>
    <artifactId>opentelemetry-api</artifactId>
</dependency>
```

The simplest way, with the agent attached, is an annotation (dependency `io.opentelemetry.instrumentation:opentelemetry-instrumentation-annotations`):

```java
@WithSpan("calculateTotal")
public BigDecimal calculateTotal(@SpanAttribute("order.items") int items, ...) { ... }
```

For full control, create the span yourself. The agent registers the global `OpenTelemetry` instance, so obtain the tracer from it (it is not a Spring bean unless you declare one):

```java
private static final Tracer tracer =
    GlobalOpenTelemetry.getTracer("store.order");

public Order processOrder(OrderRequest request) {
    Span span = tracer.spanBuilder("processOrder").startSpan();
    try (Scope scope = span.makeCurrent()) {
        span.setAttribute("order.customerId", request.customerId());
        // ... business logic
        return order;
    } catch (Exception e) {
        span.recordException(e);
        span.setStatus(StatusCode.ERROR, e.getMessage());
        throw e;
    } finally {
        span.end();
    }
}
```

---

## Grafana Unified Stack (LGTM)

Loki + Grafana + Tempo + Mimir/Prometheus — the LGTM stack — puts all three observability signals into a single UI. The key advantage is **signal correlation**: you can jump from a metric spike to the traces that caused it to the log lines that explain it, all without leaving Grafana.

``` mermaid-sim
flowchart LR
    app["Application"]
    prom["Prometheus\n(metrics)"]
    loki["Loki\n(logs)"]
    tempo["Tempo\n(traces)"]
    grafana["Grafana"]
    app --> prom
    app --> loki
    app --> tempo
    prom --> grafana
    loki --> grafana
    tempo --> grafana
```

A typical drill-down workflow: a metric alert fires in Grafana → click "View Traces" to open the correlated trace in Tempo → click a span to see the correlated log lines from Loki. This cross-signal navigation is what separates an observability platform from three isolated monitoring tools.

---

## DORA Metrics

DORA (DevOps Research and Assessment) identified four metrics that predict software delivery performance and organisational performance[^4]. Two measure **throughput** (how fast changes flow) and two measure **stability** (how often changes break things and how fast you recover). Elite-performing teams score well on all four simultaneously — speed and stability are not a trade-off.

| Metric | Measures | Elite benchmark (State of DevOps 2024) |
|---|---|---|
| **Deployment Frequency** | How often code reaches production | On demand (multiple deploys per day) |
| **Change Lead Time** | Commit to running in production | Less than one day |
| **Change Failure Rate** | % of deployments that need a fix or rollback | ~5% |
| **Failed Deployment Recovery Time** (formerly MTTR / time to restore service) | How long to recover from a failed deployment | Less than one hour |

!!! tip "DORA and observability"
    DORA metrics are themselves telemetry. Deployment frequency comes from CI/CD logs ([Hands-on 4](../../hands-on/4/index.md)). Recovery time requires precise incident start and end timestamps from your monitoring system. Change Failure Rate requires correlating deployment events with error-rate spikes. You cannot improve what you cannot measure — and you cannot measure it without observability infrastructure.

---

## Observability Snapshot: Spike Simulation

The chart below simulates what the three observability pillars look like during a traffic spike. Panel 1 shows the request rate rising sharply at steps 10–12; Panel 2 shows error events clustering in the same window; Panel 3 shows trace span durations stretching out under load.

```python exec="1" html="1"
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np

rng = np.random.default_rng(42)
steps = list(range(20))

# Panel 1: request rate — normal ~50 req/s, spike to ~180 at steps 10-12
req_rate = [50 + rng.integers(-5, 6) for _ in steps]
for i in [10, 11, 12]:
    req_rate[i] = 170 + rng.integers(0, 20)
bar_colors = ["tomato" if 10 <= i <= 12 else "steelblue" for i in steps]

# Panel 2: error events — sparse outside spike, dense inside
error_x, error_y = [], []
for i in steps:
    n = rng.integers(4, 8) if 10 <= i <= 12 else rng.integers(0, 2)
    for _ in range(n):
        error_x.append(i + rng.uniform(-0.4, 0.4))
        error_y.append(rng.uniform(0.1, 0.9))
scatter_colors = ["tomato" if 10 <= int(round(x)) <= 12 else "steelblue" for x in error_x]

# Panel 3: horizontal bars for span durations — slow during spike
service_labels = ["gateway", "order-svc", "db-query", "inventory", "notification"]
span_starts = [0, 2, 8, 5, 14]
normal_durations = [25, 18, 12, 15, 8]
spike_durations = [110, 90, 75, 82, 50]

fig, (ax1, ax2, ax3) = plt.subplots(1, 3, figsize=(12, 4))
fig.patch.set_alpha(0)

# --- Panel 1: request rate bar chart ---
ax1.bar(steps, req_rate, color=bar_colors, edgecolor="none", width=0.7)
ax1.set_title("Request Rate (req/s)", fontsize=10, fontweight="bold")
ax1.set_xlabel("Time step")
ax1.set_ylabel("req/s")
ax1.set_facecolor("none")
ax1.grid(True, axis="y", alpha=0.25)
ax1.set_xlim(-0.5, 19.5)
normal_patch = mpatches.Patch(color="steelblue", label="Normal")
spike_patch = mpatches.Patch(color="tomato", label="Spike")
ax1.legend(handles=[normal_patch, spike_patch], fontsize=8, loc="upper left")

# --- Panel 2: error events scatter ---
ax2.scatter(error_x, error_y, c=scatter_colors, s=30, alpha=0.75, edgecolors="none")
ax2.axvspan(9.5, 12.5, color="tomato", alpha=0.08, label="Spike window")
ax2.set_title("Error Events", fontsize=10, fontweight="bold")
ax2.set_xlabel("Time step")
ax2.set_yticks([])
ax2.set_facecolor("none")
ax2.set_xlim(-0.5, 19.5)
ax2.grid(True, axis="x", alpha=0.2)
ax2.legend(fontsize=8)

# --- Panel 3: span duration horizontal bars ---
y_positions = list(range(len(service_labels)))
ax3.barh(y_positions, spike_durations, left=span_starts, color="tomato",
         alpha=0.85, height=0.4, label="During spike")
ax3.barh([y + 0.45 for y in y_positions], normal_durations, left=span_starts,
         color="steelblue", alpha=0.85, height=0.4, label="Normal")
ax3.set_yticks([y + 0.225 for y in y_positions])
ax3.set_yticklabels(service_labels, fontsize=8)
ax3.set_title("Trace Span Durations (ms)", fontsize=10, fontweight="bold")
ax3.set_xlabel("ms")
ax3.set_facecolor("none")
ax3.grid(True, axis="x", alpha=0.25)
ax3.legend(fontsize=8, loc="lower right")

plt.tight_layout()
buf = __import__('io').StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

The three panels share a timeline: the spike visible in Panel 1 directly explains the error cluster in Panel 2, and both explain the stretched span durations in Panel 3. Without all three pillars, you would see only one piece of the picture.

!!! warning "Common pitfalls"
    - **Logging everything at INFO** (or DEBUG in production): log volume and cost explode, and the useful lines drown.
    - **Logging secrets or personal data**: passwords, JWTs, card numbers and e-mails must never reach the log pipeline.
    - **Unbounded metric labels**: user or order IDs as labels crash Prometheus — put them in logs and traces.
    - **Broken context propagation**: one service without instrumentation (or a proxy that drops `traceparent`) splits every trace in two.
    - **Alerting on causes, not symptoms**: dozens of CPU and memory alerts nobody acts on hide the one that matters.

---

## Connections

- [Hands-on 6](../../hands-on/6/index.md) — Prometheus and Grafana for the store's metrics.
- [Hands-on 10](../../hands-on/10/index.md) — OpenTelemetry Java agent, Jaeger and `trace_id` in the logs.
- [Reliability](../reliability/index.md) and [SLI / SLO / SLA](../reliability/sli-slo-sla/index.md) — SLIs are PromQL queries over these metrics; burn-rate alerts use them.
- [Event-Driven Architecture](../event_driven/index.md) — tracing across Kafka topics and monitoring consumer lag.
- [Exercise: Bottlenecks](../../exercises/bottlenecks/index.md) — using observability to find where the platform is slow.

## Key takeaways

- Monitoring answers known questions; **observability** lets you investigate new ones from **metrics** (that), **logs** (what) and **traces** (where).
- Prometheus **scrapes** `/actuator/prometheus`; use `rate()` on counters, `histogram_quantile` with `sum by (le)` for percentiles, and keep labels low-cardinality.
- Build dashboards with **RED** (services) and **USE** (resources); **alert on symptoms** users feel.
- Logs must be **structured** and carry the `trace_id` — filled automatically by the OTel agent; use `MDC.put` only for your own business keys.
- A trace is a tree of **spans** linked by `traceparent`; head sampling is cheap but blind, tail sampling keeps the interesting traces.
- **OpenTelemetry** is the vendor-neutral standard; measure delivery performance with the four **DORA** metrics.

---

[^1]: BEYER, B. et al. *Site Reliability Engineering: How Google Runs Production Systems*. O'Reilly, 2016.
[^2]: MAJORS, C.; FONG-JONES, L.; MIRANDA, G. *Observability Engineering*. O'Reilly, 2022.
[^3]: OPENTELEMETRY. [opentelemetry.io](https://opentelemetry.io){target="_blank"} — specification, SDKs, Collector.
[^4]: FORSGREN, N.; HUMBLE, J.; KIM, G. *Accelerate: The Science of Lean Software and DevOps*. IT Revolution, 2018. See also the yearly [DORA State of DevOps reports](https://dora.dev/research/){target="_blank"}.
[^5]: W3C. [Trace Context](https://www.w3.org/TR/trace-context/){target="_blank"}. W3C Recommendation.
