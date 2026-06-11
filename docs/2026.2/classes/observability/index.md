
# Observability

A system you cannot observe is a system you cannot operate. Monitoring tells you that something is wrong; observability tells you *why*. The distinction matters in microservices: a request that touches eight services and three databases cannot be diagnosed from a single metric on a single dashboard. Observability is the property of a system that makes its internal state inferable from external outputs.

---

## The Three Pillars

Observability is built on three complementary data types. Each answers a different question about system behaviour.

| Pillar | Answers | Toolchain | Retention |
|---|---|---|---|
| **Metrics** | Is the system healthy right now? Is it trending up or down? | Prometheus → Grafana | Weeks to months (aggregated) |
| **Logs** | What exactly happened, and in what sequence? | ELK / EFK / Loki | Days to weeks |
| **Traces** | Which service in this request was slow? Where did the error originate? | Jaeger / Tempo / Zipkin | Days |

!!! info "Observability ≠ Monitoring"
    Monitoring asks pre-defined questions: "Is the error rate below 1%?" Observability lets you ask questions you didn't think of at design time: "Why are exactly 7% of requests from mobile clients in São Paulo timing out on a Tuesday?" Observability requires all three pillars working together.

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

### PromQL Basics

| Query | Meaning |
|---|---|
| `rate(http_requests_total[5m])` | Requests per second over 5-minute window |
| `sum by (service) (rate(http_errors_total[5m]))` | Error rate grouped by service |
| `histogram_quantile(0.99, rate(http_duration_bucket[5m]))` | P99 latency |
| `increase(http_requests_total[1h])` | Total requests in last hour |

### RED and USE Methods

| Method | For | Metrics |
|---|---|---|
| **RED** (Brendan Gregg + Tom Wilkie) | Services / APIs | **R**ate (requests/sec), **E**rrors (error rate), **D**uration (latency percentiles) |
| **USE** (Brendan Gregg) | Infrastructure / Resources | **U**tilisation (% busy), **S**aturation (queue depth), **E**rrors |

!!! tip "Which method to use?"
    Use RED for service-level dashboards (what users experience), USE for infrastructure dashboards (what resources experience). Both together give complete coverage.

### Metrics Pipeline

``` mermaid
flowchart LR
    app["Spring Boot\n(Actuator + Micrometer)"]
    prom["Prometheus"]
    grafana["Grafana\n(dashboards + alerts)"]
    app -->|"exposes /actuator/prometheus"| prom
    prom -->|"scrape every 15 s"| prom
    prom -->|"PromQL queries"| grafana
```

Spring Boot Actuator configuration to expose the Prometheus endpoint:

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

When a request touches multiple services, a shared `traceId` in every log line allows reconstructing the full call sequence. Spring's Mapped Diagnostic Context (MDC) propagates this automatically with OpenTelemetry. Add the trace ID to every log line by placing it in MDC at the entry point and referencing it in the Logback pattern:

```java
MDC.put("traceId", traceId);
// ... process request
MDC.remove("traceId");
```

Logback pattern to include the trace ID:

```
%d{ISO8601} [%X{traceId}] %-5level %logger{36} - %msg%n
```

### Log Aggregation Pipeline

``` mermaid
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
| `traceId` | Globally unique ID for the entire request | `4bf92f3577b34da6` |
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

Every service propagates this header unchanged on downstream calls — only the `parentSpanId` changes to the current span's ID. This is how trace context crosses service boundaries without any service needing to understand the full trace.

### Request Flow with Spans

``` mermaid
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

| Strategy | How | Tradeoff |
|---|---|---|
| **Head sampling** | Decision made at the first span | Fast, low overhead, but misses rare errors |
| **Tail sampling** | Decision made after trace is complete | Can prioritise errors/slow traces, but higher overhead |
| **Rate-based** | Keep X% of all traces | Simple, predictable cost |

!!! tip "Production recommendation"
    Use head sampling at 1–10% for normal traffic, combined with a tail-sampling rule that keeps 100% of traces containing at least one ERROR span. This keeps storage costs low while ensuring every incident has full trace data.

---

## OpenTelemetry (OTel)

OpenTelemetry is the CNCF standard for generating, collecting, and exporting telemetry. It replaces vendor-specific SDKs (Zipkin client, Jaeger client, etc.) with a single neutral API, so switching backends requires only a configuration change, not a code change.

| Component | Role |
|---|---|
| **API** | Language-specific interfaces — Tracer, Meter, Logger |
| **SDK** | Implementation of the API; includes sampling, batching, exporters |
| **Collector** | Standalone process that receives, processes, and exports telemetry |
| **Exporter** | Protocol adapter (OTLP, Jaeger, Zipkin, Prometheus) |

``` mermaid
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
ADD https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar /app/opentelemetry-javaagent.jar

ENTRYPOINT ["java", \
  "-javaagent:/app/opentelemetry-javaagent.jar", \
  "-jar", "/app/app.jar"]
```

Configure the agent via environment variables in Docker Compose:

```yaml
environment:
  OTEL_SERVICE_NAME: order-service
  OTEL_EXPORTER_OTLP_ENDPOINT: http://jaeger:4317
  OTEL_METRICS_EXPORTER: none
  OTEL_LOGS_EXPORTER: none
```

!!! note "Why disable metrics/logs exporters?"
    The Java agent can export all three signals via OTLP. We disable metrics and logs here because Prometheus already scrapes metrics via Actuator and Loki (or ELK) handles logs separately. Enabling all three from the agent would duplicate data and inflate storage costs.

### Manual Spans

When automatic instrumentation is not granular enough, add custom spans programmatically. Add the OTel API dependency:

```xml
<dependency>
    <groupId>io.opentelemetry</groupId>
    <artifactId>opentelemetry-api</artifactId>
</dependency>
```

Wrap business logic in a span to capture timing, attributes, and exceptions:

```java
@Autowired
private Tracer tracer;

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

``` mermaid
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

DORA (DevOps Research and Assessment) identified four metrics that predict software delivery performance and organisational performance. Elite-performing teams score well on all four simultaneously.

| Metric | Measures | Elite benchmark |
|---|---|---|
| **Deployment Frequency** | How often code reaches production | Multiple times/day |
| **Lead Time for Changes** | Commit to production time | < 1 hour |
| **Change Failure Rate** | % of deployments causing incidents | < 5% |
| **Mean Time to Recovery (MTTR)** | How long to recover from an incident | < 1 hour |

!!! tip "DORA and observability"
    DORA metrics are themselves telemetry. Deployment frequency comes from CI/CD logs. MTTR requires precise incident start and end timestamps from your monitoring system. Change Failure Rate requires correlating deployment events with error-rate spikes. You cannot improve what you cannot measure — and you cannot measure it without observability infrastructure.

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

---

[^1]: BEYER, B. et al. *Site Reliability Engineering: How Google Runs Production Systems*. O'Reilly, 2016.
[^2]: MAJORS, C.; FONG-JONES, L.; MIRANDA, G. *Observability Engineering*. O'Reilly, 2022.
[^3]: OPENTELEMETRY. [opentelemetry.io](https://opentelemetry.io){target="_blank"} — specification, SDKs, Collector.
[^4]: FORSGREN, N.; HUMBLE, J.; KIM, G. *Accelerate: The Science of Lean Software and DevOps*. IT Revolution, 2018.
