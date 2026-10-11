---
marp: true
lang: en
title: Observability
description: Platforms, Microservices, DevOps and APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Platforms, Microservices, DevOps and APIs · Insper</div>

# Observability

**Monitoring tells you that something is wrong; observability tells you why**

<!--
Outline: (1) the three pillars; (2) metrics: Prometheus, PromQL, RED/USE; (3) structured logs and
correlation IDs; (4) alerting and cardinality; (5) traces, traceparent, sampling; (6) OpenTelemetry;
(7) LGTM and DORA.
-->

---

## A slow request

<div class="q">

A request touches **eight services and three databases**, and it is slow.
Can a single CPU graph on a single dashboard tell you why?

</div>

* No: you need to **follow that one request** across every hop.
* Monitoring answers **pre-defined** questions: "is the error rate below 1%?"
* Observability lets you ask questions **you did not think of** at design time.
* It is a property of the system: internal state **inferable from external outputs**.

<!--
Example from the page: "why are exactly 7% of requests from mobile clients in São Paulo timing out
on a Tuesday?" — no dashboard was built for that question.
-->

---

## The three pillars

| Pillar | Answers | Toolchain | Retention |
|---|---|---|---|
| **Metrics** | Is it healthy now? Trending up or down? | Prometheus → Grafana | weeks to months |
| **Logs** | What exactly happened, in what order? | ELK / EFK / Loki | days to weeks |
| **Traces** | Which service was slow? Where did the error start? | Jaeger / Tempo / Zipkin | days |

<div class="ok">

Each pillar answers a different question; observability needs **all three working together**.

</div>

---

## Metrics: the Prometheus model

A time series = metric name + key-value **labels**:

```text
http_requests_total{method="GET", status="200", service="order"} 4823
```

| Type | Measures | Example |
|---|---|---|
| **Counter** | only increases | `http_requests_total` |
| **Gauge** | goes up or down | `memory_bytes`, `active_connections` |
| **Histogram** | distribution in buckets | `http_request_duration_seconds{le="0.1"}` |
| **Summary** | pre-calculated quantiles | `…{quantile="0.99"}` |

---

## PromQL, RED and USE

<!-- _class: tight -->

| Query (Spring Boot metric `http_server_requests_seconds`) | Meaning |
|---|---|
| `rate(…_count[5m])` | requests per second over 5 minutes |
| `sum by (application) (rate(…_count{status=~"5.."}[5m]))` | 5xx errors per second, per service |
| `histogram_quantile(0.99, sum by (le) (rate(…_bucket[5m])))` | P99 latency across instances |

- **RED** (Tom Wilkie) — services: **R**ate, **E**rrors, **D**uration → what users experience.
- **USE** (Brendan Gregg) — resources: **U**tilisation, **S**aturation, **E**rrors.
- Google's **four golden signals**: latency, traffic, errors, saturation.

<p class="small"><code>rate()</code> before <code>sum</code>; keep <code>le</code> for percentiles. Percentiles, never averages: P99 shows the slow tail.</p>

---

## The metrics pipeline

Spring Boot (Actuator + Micrometer) exposes `/actuator/prometheus` → Prometheus **scrapes every 15 s** → Grafana queries with PromQL (dashboards + alerts).

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

<p class="small">Pull model: the application only exposes the endpoint; Prometheus fetches. Needs <code>micrometer-registry-prometheus</code>.</p>

---

## Alerts and cardinality

```yaml
- alert: OrderHighErrorRatio
  expr: |
    sum(rate(http_server_requests_seconds_count{application="order", status=~"5.."}[5m]))
    / sum(rate(http_server_requests_seconds_count{application="order"}[5m])) > 0.05
  for: 5m
  labels: { severity: page }
```

- **Alert on symptoms** users feel (errors, latency, SLO burn) — not on "CPU > 80%".

<div class="warn">

Never label with **user or order IDs**: each value is a new series — 100k users × 10 URIs × 5 statuses = 5 million. Put them in logs and traces.

</div>

---

## Logs: structured, with levels

| | Unstructured | Structured (JSON) |
|---|---|---|
| Example | `ERROR Order 42 failed` | `{"level":"ERROR","orderId":42,"traceId":"abc123"}` |
| Search | grep / regex | field queries |
| Aggregate | hard | easy (Kibana, Loki) |

- `TRACE` / `DEBUG` — diagnostics; **never in production** / dev and staging only.
- `INFO` — significant events · `WARN` — unexpected but handled (retry, fallback).
- `ERROR` — failure that needs attention.

---

<!-- _class: tight -->

## Correlation IDs

The **MDC** is a per-thread map printed in every log line with `%X{key}`.

- With the **OTel Java agent**, `trace_id` and `span_id` reach the MDC **automatically** — no code:

```text
%d{ISO8601} %-5level [trace_id=%X{trace_id} span_id=%X{span_id}] - %msg%n
```

- `MDC.put` only for **your own business keys** — and always remove them (threads are reused):

```java
try (var c = MDC.putCloseable("customerId", in.customerId())) { … }
```

<p class="small">Pipeline: JSON to <b>stdout</b> → Filebeat / Fluentd → Elasticsearch → Kibana; or <b>Loki</b> (labels only, cheaper, in Grafana).</p>

---

## Traces and spans

A **trace** is one end-to-end request; it is made of **spans**, one per operation.

- Each span: `traceId`, `spanId`, `parentSpanId`, `name`, start/duration, `status`, `attributes`.
- Context crosses services in the W3C **`traceparent`** header:

```text
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

<p class="small">version · traceId (128 bits) · parentSpanId (64 bits) · flags (<code>01</code> = sampled). Each hop keeps the traceId and replaces the parentSpanId with its own span's ID.</p>

`User → Gateway (120 ms) → OrderService (95 ms) → PostgreSQL (40 ms)`

---

## Sampling

| Strategy | How | Tradeoff |
|---|---|---|
| **Head** | decided at the first span, travels in `flags` | cheap — but blind: drops rare errors too |
| **Tail** | the Collector decides after the trace completes | keeps errors / slow traces — buffers all spans |
| **Rate-limiting** | at most N traces per second | predictable cost |

<div class="warn">

A trace dropped at the **head** never reaches the Collector: a tail rule cannot rescue it.

</div>

<div class="ok">

Keep every error: **100% at the head** + a **tail policy** keeping all ERROR/slow traces and 1–10% of the rest.

</div>

---

## OpenTelemetry

The CNCF standard to generate, collect and export telemetry — one neutral API; switching backends is a **configuration** change, not a code change.

| Component | Role |
|---|---|
| **API** | interfaces: Tracer, Meter, Logger |
| **SDK** | implementation: sampling, batching, exporters |
| **Collector** | standalone process: receive, process, export |
| **Exporter** | sends data out: **OTLP** (gRPC 4317 / HTTP 4318), Zipkin, Prometheus |

`Application (OTel SDK) → OTLP → OTel Collector → Prometheus · Jaeger · Loki`

---

## Zero-code instrumentation

The OTel Java agent instruments Spring Boot by **bytecode injection**:

```dockerfile
ENTRYPOINT ["java", \
  "-javaagent:/app/opentelemetry-javaagent.jar", \
  "-jar", "/app/app.jar"]
```

```yaml
environment:
  OTEL_SERVICE_NAME: order-service
  OTEL_EXPORTER_OTLP_PROTOCOL: grpc   # agent 2.x default: http/protobuf on 4318
  OTEL_EXPORTER_OTLP_ENDPOINT: http://jaeger:4317
  OTEL_METRICS_EXPORTER: none
  OTEL_LOGS_EXPORTER: none
```

<p class="small">Metrics and logs exporters are off: Prometheus already scrapes Actuator and Loki/ELK handles logs. Protocol and port must match.</p>

---

## Manual spans

Simplest: `@WithSpan("calculateTotal")` on a method. Full control (`opentelemetry-api`):

```java
Tracer tracer = GlobalOpenTelemetry.getTracer("store.order");
Span span = tracer.spanBuilder("processOrder").startSpan();
try (Scope scope = span.makeCurrent()) {
    span.setAttribute("order.customerId", request.customerId());
    // ... business logic
} catch (Exception e) {
    span.recordException(e);
    span.setStatus(StatusCode.ERROR, e.getMessage());
    throw e;
} finally {
    span.end();
}
```

<!--
Point out finally { span.end(); }: a span that is never ended is never exported.
-->

---

## One UI: LGTM, and DORA

**Loki + Grafana + Tempo + Mimir/Prometheus** — all signals in Grafana. Drill-down: metric alert → "View Traces" in Tempo → click a span → its log lines in Loki.

| DORA metric | Measures | Elite (2024) |
|---|---|---|
| Deployment Frequency | how often code reaches production | on demand |
| Change Lead Time | commit to production | < 1 day |
| Change Failure Rate | % of deploys needing a fix or rollback | ~5% |
| Failed Deployment Recovery Time | time to recover (formerly MTTR) | < 1 hour |

<p class="small">DORA metrics are telemetry too: you cannot measure them without observability.</p>

---

## Takeaways

1. Monitoring says **that** something is wrong; observability lets you ask **why**.
2. Three pillars: **metrics** (health), **logs** (what happened), **traces** (where).
3. Prometheus scrapes `/actuator/prometheus`; **PromQL**, **RED**/**USE**, low-cardinality labels, **symptom** alerts.
4. Logs must be **structured** and carry the `trace_id` — the OTel agent fills the MDC for you.
5. A trace is a tree of **spans**; `traceparent` carries the context; head sampling is blind, tail sampling is selective.
6. **OpenTelemetry** is the vendor-neutral standard; the Java agent needs **zero code**.
7. Correlate signals in one place (**LGTM**) — and measure delivery with **DORA**.
