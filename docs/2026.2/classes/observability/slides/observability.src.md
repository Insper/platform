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
Outline: (1) the three pillars; (2) metrics: Prometheus, PromQL, RED/USE, pipeline, cardinality,
alerting; (3) structured logs, correlation IDs and MDC; (4) traces, traceparent, sampling;
(5) OpenTelemetry: agent and manual spans; (6) LGTM; (7) DORA; (8) pitfalls.
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
The store: "checkout is slow" — Nginx, gateway, auth, order, product, Postgres, maybe Kafka. Which one?
For everyone or just this customer? Without telemetry designed in advance, the answer is guessing.
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

One failing `POST /orders` → a counter `…_count{status="500"}` **+1** · a JSON line `{"level":"ERROR",…}` · a trace whose last span is `ERROR`.

<div class="ok">

Metrics are cheap and tell you **that** something changed; logs and traces cost more and tell you **what** and **where**. Observability needs **all three**.

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
| `sum(rate(…_count{status=~"5.."}[5m])) / sum(rate(…_count[5m]))` | error **ratio** (0–1): basis of an SLI |
| `histogram_quantile(0.99, sum by (le) (rate(…_bucket[5m])))` | P99 latency across instances |

- **RED** (Tom Wilkie) — services: **R**ate, **E**rrors, **D**uration → what users experience.
- **USE** (Brendan Gregg) — resources: **U**tilisation, **S**aturation, **E**rrors.
- Google's **four golden signals**: latency, traffic, errors, saturation.

<p class="small"><code>rate()</code> before <code>sum</code> (counter resets); keep <code>le</code> for percentiles. <b>Percentiles, never averages</b>: 99 × 50 ms + 1 × 5 s averages ~100 ms, but one user in 100 waits 5 s.</p>

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

- Prometheus evaluates the rule → **Alertmanager** (or Grafana Alerting) → e-mail, Slack, pager; `for: 5m` avoids flapping.
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

<p class="small">Pipeline: JSON to <b>stdout</b> → Filebeat / Fluentd → Elasticsearch → Kibana; or <b>Loki</b> (indexes labels only, cheaper, in the same Grafana).</p>

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

<p class="small"><b>The MDC is per thread</b> (<code>ThreadLocal</code>): <code>@Async</code>, <code>CompletableFuture</code> or the WebFlux gateway do not see it unless the context is propagated.</p>

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

## One UI: the LGTM stack

**Loki + Grafana + Tempo + Mimir/Prometheus** — the three signals in a single UI.

- The key advantage is **signal correlation**.
- Drill-down: a metric alert fires → "View Traces" opens the trace in **Tempo** → click a span → its log lines in **Loki**.
- Cross-signal navigation separates an observability platform from three isolated monitoring tools.

<div class="ok">

In a traffic spike the three pillars share a timeline: the rate peak explains the error cluster, and both explain the stretched spans.

</div>

---

## DORA metrics

Two measure **throughput**, two measure **stability** — elite teams score well on all four: speed and stability are **not** a trade-off.

| DORA metric | Measures | Elite (2024) |
|---|---|---|
| Deployment Frequency | how often code reaches production | on demand |
| Change Lead Time | commit to production | < 1 day |
| Change Failure Rate | % of deploys needing a fix or rollback | ~5% |
| Failed Deployment Recovery Time | time to recover (formerly MTTR) | < 1 hour |

<p class="small">DORA metrics are telemetry too: deploys from CI/CD logs, recovery from incident timestamps, failures from deploys correlated with error spikes.</p>

---

## Common pitfalls

- **Logging everything at INFO** (or DEBUG in production): volume and cost explode, the useful lines drown.
- **Logging secrets or personal data**: passwords, JWTs, card numbers, e-mails never reach the pipeline.
- **Unbounded metric labels**: user or order IDs crash Prometheus — logs and traces instead.
- **Broken context propagation**: one uninstrumented service, or a proxy that drops `traceparent`, splits every trace in two.
- **Alerting on causes, not symptoms**: dozens of CPU alerts nobody acts on hide the one that matters.

---

## Takeaways

1. Monitoring answers known questions; **observability** investigates new ones from **metrics** (that), **logs** (what) and **traces** (where).
2. Prometheus **scrapes** `/actuator/prometheus`; `rate()` on counters, `histogram_quantile` with `sum by (le)`, low-cardinality labels.
3. Dashboards with **RED** (services) and **USE** (resources); **alert on symptoms** users feel.
4. Logs **structured**, carrying the `trace_id` — filled by the OTel agent; `MDC.put` only for business keys.
5. A trace is a tree of **spans** linked by `traceparent`; head sampling is cheap but blind, tail sampling keeps the interesting traces.
6. **OpenTelemetry** is the vendor-neutral standard; measure delivery with the four **DORA** metrics.
