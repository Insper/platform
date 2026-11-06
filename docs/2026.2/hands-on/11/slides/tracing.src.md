---
marp: true
lang: en
title: Hands-on 11 — Distributed Tracing
description: Platforms, Microservices, DevOps and APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">Platforms, Microservices, DevOps and APIs · Hands-on 11</div>

# Hands-on 11 — Distributed Tracing

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

## Architecture

<div class="flow" style="align-items: stretch">
<div class="box green" style="flex: .8; display: flex; flex-direction: column; justify-content: center">Prometheus :9090<small>→ Grafana :3000 · metrics</small></div>
<div class="arrow" style="align-self: center">← scrape<br>/actuator/prometheus</div>
<div class="group">
<div class="caption">trusted layer · an OTel agent in each</div>
<div class="box">gateway-service</div>
<div class="box">order-service · account-service</div>
<div class="box">product-service<small>order → product, PostgreSQL as before</small></div>
</div>
<div class="arrow" style="align-self: center">OTLP traces →<br>push to :4317</div>
<div class="box accent" style="flex: .8; display: flex; flex-direction: column; justify-content: center">Jaeger<small>collector + query + UI :16686 · new</small></div>
</div>

<div class="ok">

Two pipelines side by side: metrics are **scraped** by Prometheus, traces are **pushed** by each service's agent.

</div>

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

<p class="small">All-in-one is fine for local development; in production the collector, query and UI run separately. The agent defaults to <b>gRPC on 4317</b>; 4318 is OTLP over HTTP/protobuf.</p>

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

<div class="flow">
<div class="box">gateway-service<small>root span aaa1</small></div>
<div class="arrow">00-4bf9…-aaa1-01 →</div>
<div class="box">order-service<small>span bbb2 · parent aaa1</small></div>
<div class="arrow">00-4bf9…-bbb2-01 →</div>
<div class="box">product-service<small>span ccc3 · parent bbb2</small></div>
<div class="arrow">export →</div>
<div class="box accent">Jaeger<small>groups the spans by trace ID</small></div>
</div>

- Each agent reads the incoming header, starts a **child span** and sends its own span ID onward.
- Each span **ends** and is **exported** on its own; Jaeger puts the trace together.

---

## Sampling

- The default sampler exports **100%** of traces — fine for the lab.
- In production, sample a fraction of requests:

```yaml
OTEL_TRACES_SAMPLER: parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG: "0.1"   # 10% of requests
```

<div class="flow" style="align-items: stretch">
<div class="box accent" style="flex: .8; display: flex; flex-direction: column; justify-content: center">gateway-service<small>the root span decides, once</small></div>
<div class="arrow" style="align-self: center">flags in<br>traceparent →</div>
<div class="group">
<div class="box green">01 · sampled<small>order and product export too: the whole trace in Jaeger</small></div>
<div class="box muted">00 · not sampled<small>nobody exports; the logs still carry the trace_id</small></div>
</div>
</div>

**Parent-based**: a trace is never half-sampled.

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

## The slow request, as Jaeger draws it

<div class="flow" style="margin: .12em 0"><div class="arrow" style="flex: 0 0 13em; text-align: left">gateway POST /orders</div><div style="flex: 1"><div class="box " style="margin-left: 0.0%; width: 100.0%; padding: .15em .3em; text-align: left; white-space: nowrap">2 340 ms · own 90</div></div></div>
<div class="flow" style="margin: .12em 0"><div class="arrow" style="flex: 0 0 13em; text-align: left">order POST /orders</div><div style="flex: 1"><div class="box " style="margin-left: 1.9%; width: 96.2%; padding: .15em .3em; text-align: left; white-space: nowrap">2 250 ms · own 35</div></div></div>
<div class="flow" style="margin: .12em 0"><div class="arrow" style="flex: 0 0 13em; text-align: left">product GET /products/{id}</div><div style="flex: 1"><div class="box " style="margin-left: 2.8%; width: 93.6%; padding: .15em .3em; text-align: left; white-space: nowrap">2 190 ms · own 10</div></div></div>
<div class="flow" style="margin: .12em 0"><div class="arrow" style="flex: 0 0 13em; text-align: left">product SELECT products</div><div style="flex: 1"><div class="box red" style="margin-left: 3.0%; width: 93.2%; padding: .15em .3em; text-align: left; white-space: nowrap">2 180 ms · own 2 180</div></div></div>
<div class="flow" style="margin: .12em 0"><div class="arrow" style="flex: 0 0 13em; text-align: left">order INSERT orders</div><div style="flex: 1"><div class="box " style="margin-left: 96.4%; width: 1.7%; padding: .15em .3em; text-align: left; white-space: nowrap"></div></div></div>

- Four bars are almost as wide as the root: width alone does not name the culprit.
- Look at the **own (self) time**, the part not covered by children: `SELECT products` holds 2 180 of 2 340 ms (93%).

<!--
Same numbers as the page's sequence diagram and the simulator's first step. Bar width = duration; the INSERT is the thin bar at the end.
-->

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
The localhost-vs-service-name point: see the warning "`localhost` inside a container" on the page.
-->

---

## Without Docker: the simulator

<div class="flow">
<div class="box red">slow query<small>2 340 ms · SELECT 2 180 ms, 93%</small></div>
<div class="box orange">delay in product's code<small>its span grows · SELECT stays 20 ms</small></div>
<div class="box muted">localhost:4317 in product<small>2 spans lost · order shows 2 225 ms of own time</small></div>
<div class="box green">sampler 0.1<small>Jaeger keeps 6 of 100 requests</small></div>
</div>

- The page embeds the lab's trace: same services, same request, same trace ID (`4bf92f35…4736`).
- Play replays the page step by step; the knobs work at any time.
- Under the waterfall: the `traceparent` of each hop and the log lines with `trace_id` / `span_id`.

<!--
The simulator sits after the page's second diagram. Also try validateOrder without end(): product-service shows up with a missing parent.
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
