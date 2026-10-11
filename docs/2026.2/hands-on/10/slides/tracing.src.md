---
marp: true
lang: en
title: Hands-on 10 — Distributed Tracing
description: Platforms, Microservices, DevOps and APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Platforms, Microservices, DevOps and APIs · Hands-on 10</div>

# Hands-on 10 — Distributed Tracing

**One request, one trace ID, every hop measured**

<!--
Outline: (1) why metrics cannot locate a slow hop; (2) Jaeger + OpenTelemetry Java agent;
(3) traceparent propagation and sampling; (4) trace IDs in the logs; (5) reading traces in Jaeger;
(6) custom spans.
-->

---

## Where did the time go?

<div class="q">

`POST /orders` takes **2 340 ms**. Prometheus shows high `http_server_requests_seconds` on the gateway.
The gateway calls OrderService, which calls ProductService, which queries the database.
**Which hop is slow?**

</div>

* Metrics answer **how much** and **how often** — not **where** inside a multi-hop chain.
* Without tracing: read logs across four services and **guess**.
* With tracing: every hop is a **span**, all spans share one **trace ID** → the slow span is visible.

<!--
Let the class propose how they would find it today. The answer in the page: the jdbc.query span
inside ProductService took 2 180 ms of the 2 340 ms.
-->

---

## The goal

Instrument every Spring Boot service with **OpenTelemetry** so that one request through
**Gateway → OrderService → ProductService** produces **one trace** in **Jaeger**, with the trace ID in every log line.

| Component | Role |
|---|---|
| **OTel Java agent** | instruments Spring MVC, WebClient, RestTemplate, JDBC — **no code changes** |
| **Jaeger** `all-in-one` | collector + query engine + UI |
| `:4317` / `:4318` | OTLP receiver — gRPC / HTTP |
| `:16686` | Jaeger UI |
| Prometheus + Grafana | keep doing **metrics**, as before |

---

## The vocabulary

| Term | What it is |
|---|---|
| **Span** | one timed operation — an HTTP call, a query, a business step |
| **Trace** | all the spans of one request, grouped by a shared **trace ID** |
| **Parent / child** | each span points to the span that called it |
| **`traceparent`** | W3C header that carries the context to the next service |
| **OTLP** | the protocol the agent uses to export spans |
| **Flame chart** | Jaeger view: one bar per span, width = duration |

---

## Step 1 — Jaeger in `compose.yaml`

```yaml
  jaeger:
    image: jaegertracing/all-in-one:1.57
    container_name: jaeger
    environment:
      COLLECTOR_OTLP_ENABLED: "true"
    ports:
      - "16686:16686"   # Jaeger UI
      - "4317:4317"     # OTLP gRPC receiver
      - "4318:4318"     # OTLP HTTP receiver
    networks:
      - store-net
```

<p class="small">All-in-one is fine for local development; in production the collector, query and UI run separately.</p>

---

## Step 2 — Attach the agent in the Dockerfile

```dockerfile
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
ADD https://github.com/open-telemetry/opentelemetry-java-instrumentation/\
releases/download/v2.4.0/opentelemetry-javaagent.jar \
    /app/opentelemetry-javaagent.jar
COPY target/*.jar app.jar
ENTRYPOINT ["java", \
  "-javaagent:/app/opentelemetry-javaagent.jar", \
  "-jar", "/app/app.jar"]
```

<div class="warn">

**Pin the agent version**: v2.4.0 works with Spring Boot 3.x — check the compatibility matrix before upgrading either one.

</div>

---

## Step 3 — Configure with environment variables

```yaml
  order:
    build: ./order-service
    environment:
      OTEL_SERVICE_NAME: order-service
      OTEL_EXPORTER_OTLP_ENDPOINT: http://jaeger:4317
      OTEL_METRICS_EXPORTER: none
      OTEL_LOGS_EXPORTER: none
      OTEL_PROPAGATORS: tracecontext,baggage
```

- Same block for `gateway-service`, `product-service` and `account-service` — only the **name** changes.
- `OTEL_METRICS_EXPORTER: none`: Prometheus/Micrometer already collect metrics — avoid **duplicates**.

---

## How propagation works

```text
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
             │  │                                │                └ 01 = sampled
             │  │                                └ 16-char parent span ID
             │  └ 32-char trace ID — identical on every hop
             └ version (always 00)
```

1. Gateway agent starts the **root span** (`spanId=aaa1`).
2. Outgoing call carries `traceparent: 00-4bf9…-aaa1-01`.
3. Order agent reads it → **child span** `bbb2`, parent `aaa1`; and so on to Product (`ccc3`).
4. Each span **ends** and is **exported** to Jaeger, which groups them by trace ID.

---

## Sampling

- The default sampler exports **100%** of traces — fine for the lab.
- In production, sample a fraction of requests:

```yaml
OTEL_TRACES_SAMPLER: parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG: "0.1"   # 10% of requests
```

<div class="ok">

**Parent-based**: the decision is taken once at the root and travels in the `01`/`00` flag — a trace is never half-sampled.

</div>

---

<!-- _class: tight -->

## Step 4 — Trace IDs in the logs

The agent writes `trace_id` and `span_id` into the SLF4J **MDC**. Add `opentelemetry-logback-appender-1.0` (`2.4.0-alpha`, `runtime`) and print them in `logback-spring.xml`:

```xml
<pattern>
    %d{HH:mm:ss.SSS} [%thread] %-5level %logger{36}
    [trace_id=%X{trace_id} span_id=%X{span_id}] - %msg%n
</pattern>
```

```text
14:23:01.442 [http-nio-8080-exec-3] INFO  c.example.order.OrderService
    [trace_id=4bf92f3577b34da6a3ce929d0e0e4736 span_id=00f067aa0ba902b7]
    - creating order for account 42
```

<p class="small">Workflow: slow trace in Jaeger → copy the <code>trace_id</code> → search it in the log aggregator → every log line of that request.</p>

---

## Step 5 — Run and find a trace

```bash
docker compose up -d --build
docker compose ps jaeger
curl -s -X POST http://localhost:8080/orders \
  -H "Content-Type: application/json" \
  -d '{"accountId": 1, "productId": 7, "quantity": 2}' | jq
```

1. Open `http://localhost:16686`, pick `gateway-service` in **Service**.
2. Leave Operation as `all` → **Find Traces**.
3. Click a trace to open the **flame chart**.

---

## Reading the flame chart

- Root span (gateway) on top, children **indented** below; bar **width = duration**.
- A span almost as wide as the root is the **main latency contributor**.
- `SELECT` / `jdbc.query` spans → slow queries; `HTTP GET` / `HTTP POST` → outbound calls.
- A red `!` marks an **exception** — the stack trace is attached as a span event.

| Tag (set by the agent) | Example |
|---|---|
| `http.method` / `http.status_code` | `POST` / `200` |
| `http.url` | `http://order:8080/orders` |
| `db.system` / `db.statement` | `postgresql` / `SELECT * FROM products WHERE id = ?` |

---

<!-- _class: tight -->

## Step 6 — Custom spans for business logic

The agent knows the framework, not your **business steps**. Add `io.opentelemetry:opentelemetry-api` (version from Spring Boot's BOM):

```java
Span span = tracer.spanBuilder("validateOrder").startSpan();
try (Scope scope = span.makeCurrent()) {
    span.setAttribute("order.account_id", orderIn.getAccountId());
    validateAccount(orderIn.getAccountId());
    checkInventory(orderIn.getProductId(), orderIn.getQuantity());
} catch (Exception e) {
    span.recordException(e);
    throw e;
} finally {
    span.end();
}
```

<p class="small">Worth it for steps over ~50 ms, business attributes (<code>order.id</code>, <code>account.tier</code>) or caught exceptions — not for trivial getters.</p>

---

## Common pitfalls

<div class="warn">

A manual span without `span.end()` in a `finally` is **never exported** to Jaeger.

</div>

- Agent and Spring Boot versions **incompatible** → missing or broken instrumentation.
- `OTEL_METRICS_EXPORTER` left at the default → metrics exported **twice**.
- Wrong `OTEL_EXPORTER_OTLP_ENDPOINT` (e.g. `localhost` inside a container) → no traces arrive; use `http://jaeger:4317`.
- Missing `OTEL_SERVICE_NAME` → services are hard to tell apart in the dropdown.
- Manual spans on everything → **noise** that hides the useful data.

<!--
The localhost-vs-service-name point is a well-known Compose mistake, not stated verbatim in the page.
-->

---

## Takeaways

1. Metrics say **how much**; a trace says **where** the time went in a multi-hop request.
2. A **trace** is the set of **spans** sharing one **trace ID**; the slow span stands out in the flame chart.
3. The **OTel Java agent** (`-javaagent`) instruments HTTP and JDBC with **no code changes**, configured by `OTEL_*` env vars.
4. Context travels in the W3C **`traceparent`** header; Jaeger groups the exported spans.
5. Put `trace_id` / `span_id` in the **logs** to jump from a trace to its log lines.
6. Add **custom spans** for business steps — and always `end()` them in `finally`.
7. Verify: ≥ 3 spans for `POST /orders` (gateway, order, product), with matching `trace_id` in the logs.
