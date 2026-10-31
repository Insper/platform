Click **"Answer"** to reveal the correct answer and explanation.

---

## Distributed Tracing

**Q1.** A `POST /orders` request takes 2 300 ms end-to-end. Prometheus shows the gateway's `http_server_requests_seconds_max` is 2 300 ms. What does a distributed trace tell you that this metric **cannot**?

- A. The total number of requests per second flowing through the gateway
- B. The exact span of time each downstream service — OrderService, ProductService, the database — consumed within that single request, so you can pinpoint which hop caused the delay
- C. Whether the gateway has enough CPU headroom to handle more concurrent requests
- D. The 99th-percentile latency across all requests in the last five minutes

??? success "Answer"
    **B — Per-hop latency breakdown for a single request.**

    A Prometheus metric is an aggregate: it tells you the worst response time seen across all requests in a time window, but it cannot break that time down by downstream call. A distributed trace records each hop as a span with its own start time and duration. You can immediately read that the gateway itself took 45 ms, OrderService took 2 250 ms, and ProductService's JDBC query took 2 180 ms of that — the metric alone never shows you this.

---

**Q2.** After adding the OTel Java agent to the Dockerfile and setting `OTEL_EXPORTER_OTLP_ENDPOINT`, a `RestTemplate` call from OrderService to ProductService appears as a child span in Jaeger — **without any changes to the Java source code**. What mechanism makes this possible?

- A. Spring Boot Actuator exposes a `/actuator/traces` endpoint that Jaeger scrapes automatically
- B. The OTel Java agent uses JVM bytecode instrumentation to intercept `RestTemplate` at runtime, injecting the `traceparent` header into outgoing requests and creating spans transparently
- C. Spring Cloud Sleuth detects the `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable and activates auto-tracing
- D. The `traceparent` header is injected by Docker's overlay network, which all containers share

??? success "Answer"
    **B — JVM bytecode instrumentation via the `-javaagent` flag.**

    The OTel Java agent is a standard JVM instrumentation agent loaded with `-javaagent:/app/opentelemetry-javaagent.jar`. At class-load time it rewrites the bytecode of known libraries — RestTemplate, WebClient, JDBC drivers, Spring MVC, and many others — to add span creation and header injection. No source code changes, no Spring annotations. The application JAR is untouched; the agent modifies the running bytecode in memory.

---

**Q3.** Given the `traceparent` value:

```
00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

Which part identifies the **entire request journey** and is the same on every service in the chain?

- A. `00` — the version byte
- B. `4bf92f3577b34da6a3ce929d0e0e4736` — the 32-character trace ID
- C. `00f067aa0ba902b7` — the 16-character parent span ID
- D. `01` — the flags byte

??? success "Answer"
    **B — The 32-character trace ID.**

    The W3C `traceparent` header format is `{version}-{traceId}-{parentSpanId}-{flags}`. The `traceId` is generated once by the first service in the chain (the gateway) and is propagated unchanged to every downstream service. It is the common key that allows Jaeger to group all spans — from gateway, OrderService, ProductService, and the JDBC driver — into a single trace. The `parentSpanId` changes at every hop: it identifies the immediate caller, not the whole chain.

---

**Q4.** In `compose.yaml` you set `OTEL_METRICS_EXPORTER: none` for every service. What problem would occur if you **omitted** this variable and left the default exporter active?

- A. The service would fail to start because Jaeger does not support the OTLP metrics protocol
- B. The OTel agent would export metrics via OTLP to Jaeger in addition to the Micrometer/Prometheus pipeline already running, creating duplicate metric series and wasting resources
- C. Prometheus would stop scraping `/actuator/prometheus` because the OTel agent disables Micrometer
- D. Grafana dashboards would break because the metric label names differ between OTLP and Prometheus exposition format

??? success "Answer"
    **B — Duplicate metrics exported via two separate pipelines.**

    By default the OTel Java agent activates an OTLP metrics exporter alongside the trace exporter. Since you already have Spring Boot Actuator + Micrometer exporting the same metrics to Prometheus, activating the OTel metrics exporter sends a second copy of every metric to Jaeger's OTLP endpoint. This wastes network and storage, and Jaeger's metrics backend is not what you are using for dashboards. Setting `OTEL_METRICS_EXPORTER: none` disables only the metric pipeline; the trace pipeline is unaffected.

---

**Q5.** You open a trace in the Jaeger flame chart for a `POST /orders` request and see four spans:

```
gateway-service      POST /orders          2 300 ms  ████████████████████
  order-service      POST /orders          2 250 ms  ███████████████████
    product-service  GET /products/7       2 190 ms  ██████████████████
      jdbc           SELECT * FROM ...     2 180 ms  ██████████████████
```

Which service should you investigate first, and why?

- A. `gateway-service`, because its span is the widest bar and therefore the primary bottleneck
- B. `order-service`, because it is the direct child of the gateway and owns most of the total time
- C. The `jdbc` span inside `product-service`, because it accounts for 2 180 ms of the 2 300 ms total and is the deepest span with the most self-time
- D. All services equally, because span durations overlap and you cannot isolate a single cause

??? success "Answer"
    **C — The `jdbc` span inside `product-service`.**

    The flame chart shows *wall-clock time*, so parent spans always appear as wide as or wider than their children. The gateway span is wide because it is waiting for everything downstream. The actionable insight is the **deepest span with the most self-time**: `jdbc SELECT` at 2 180 ms. That span has no children — it is doing actual work, not waiting for another service. This means a slow SQL query inside ProductService is the root cause. Start there: check for missing indexes, an N+1 query, or a missing database connection pool.

---

**Q6.** What is the correct relationship between a **trace** and a **span**?

- A. A span is a collection of related traces grouped by service name
- B. A trace represents the complete end-to-end journey of a single request across all services; a span represents one unit of work within that journey (e.g., a single HTTP call, a database query, or a method execution)
- C. A trace and a span are synonyms — both refer to a timed record of a single operation
- D. A span is a sampling of multiple traces aggregated into a single time-series data point

??? success "Answer"
    **B — Trace = full journey; span = single unit of work.**

    Every request generates exactly one trace, identified by a unique `traceId`. That trace is composed of one or more spans. The root span (created by the gateway) is the first; each downstream call creates a child span parented to the calling span. All spans share the same `traceId` but each has its own `spanId`, start time, end time, and attributes. The Jaeger UI assembles all spans with the same `traceId` into the flame chart you see.

---

**Q7.** Your `OrderService.create()` method calls three private helper methods: `validateAccount()`, `checkInventory()`, and `calculatePrice()`. The OTel agent already creates a span for the incoming `POST /orders` HTTP request. Under what circumstances should you **add a manual span** for one of these helpers?

- A. Always — every method call should have its own span to ensure complete coverage
- B. Never — the Java agent instruments all Spring beans automatically, so manual spans are redundant
- C. When a helper takes a measurable amount of time (e.g., > 50 ms), calls an external system, or when you need to attach business-level attributes (such as `account.id` or `inventory.available`) that the framework instrumentation does not capture
- D. Only when the method throws a checked exception — manual spans are exclusively for error tracking

??? success "Answer"
    **C — When the helper is slow, calls external systems, or needs custom attributes.**

    The agent instruments *framework entry points* — HTTP requests, JDBC calls, cache operations. It does not know about your private business logic methods. Add a manual span when: (1) a method takes tens of milliseconds and you want to see its cost separately in the flame chart, (2) the method calls an external API that the agent cannot detect, or (3) you want to record business-level attributes like `order.account_id` or `inventory.result` that only make sense in your domain. Avoid wrapping trivial getters — too many spans obscure the signal and add overhead.

---

**Q8.** A user reports that their order was created with the wrong product price. You can reproduce it and observe `trace_id=7d3a...b2` in the Jaeger UI. Your logs are aggregated in Loki. What is the fastest way to find the exact log lines from that request?

- A. Search Loki for `level=ERROR` in the `order-service` job during the 5-minute window around the request timestamp
- B. Copy the `trace_id` value from the Jaeger span, then use it as the search filter in Loki (`{job="order-service"} |= "7d3a...b2"`) — the `trace_id` field injected by the OTel logback bridge into every MDC log line links the trace directly to its log output
- C. Download the full Jaeger trace as JSON and search for error messages embedded in span events
- D. Restart the service with `DEBUG` logging enabled and reproduce the request to generate new, more detailed logs

??? success "Answer"
    **B — Use the `trace_id` from Jaeger as the search filter in Loki.**

    This is the core value of trace-log correlation. Because `logback-spring.xml` uses `%X{trace_id}` in its pattern, every log line emitted during a traced request contains the trace ID in the MDC. All log lines from that specific request — and only that request — share the same `trace_id=7d3a...b2`, even if thousands of other requests were processed concurrently. Searching Loki for that ID returns exactly the log sequence for the broken order: the service calls made, the price computed, and the final persistence — narrowed to milliseconds of wall time, with no noise from other users' requests.
