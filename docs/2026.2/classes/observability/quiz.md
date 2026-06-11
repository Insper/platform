
Click **"Answer"** to reveal the correct answer and explanation.

---

## The Three Pillars

**Q1.** A user reports that request `7f3d...` returned a 500 error. Which pillar(s) would you use to diagnose the root cause?

- A. Metrics — check the error rate counter for that time window
- B. Logs — search for the specific request ID in the log stream
- C. Traces — find the specific trace and inspect which span failed
- D. Both B and C — logs for the exception detail, traces for the call path

??? success "Answer"
    **D — Both logs and traces are needed.**

    The trace shows which service in the call chain caused the error and how long each hop took, narrowing the investigation to a single span. The logs inside that service then reveal the exact exception class, message, and stack trace. Neither pillar alone gives the full picture: traces without logs tell you *where* but not *why*; logs without traces make it hard to identify *which* service among many produced the matching log line.

---

**Q2.** Why is a Histogram preferred over a Summary for latency metrics in Prometheus?

- A. Histograms use less storage than summaries at high cardinality
- B. Histograms are calculated server-side, so dashboards load faster
- C. Histograms allow quantile calculation across multiple instances and arbitrary time windows in PromQL; summaries pre-calculate quantiles in the client and cannot be aggregated
- D. Summaries are deprecated and no longer supported by Prometheus

??? success "Answer"
    **C — Histograms are aggregatable; summaries are not.**

    A Summary calculates quantiles inside the application process — once exported, the `p99` value of instance A and instance B cannot be meaningfully combined. A Histogram exports raw bucket counts, so `histogram_quantile(0.99, sum(rate(http_duration_bucket[5m])))` correctly computes the p99 across all instances and across any chosen time window. In a horizontally-scaled microservice this distinction is critical.

---

## PromQL and Metrics

**Q3.** What does `rate(http_errors_total[5m])` return?

- A. The total number of errors that occurred in the last 5 minutes
- B. The per-second average rate of increase of `http_errors_total` over the last 5-minute window
- C. The error rate as a percentage of total requests
- D. The number of errors per minute, sampled once every 5 minutes

??? success "Answer"
    **B — Per-second average rate of increase over the 5-minute window.**

    `rate()` divides the total increase in the counter over the window by the window duration in seconds. A counter that increased by 300 in 5 minutes returns `1.0` (one error per second). Because `rate()` operates on the raw counter, it handles counter resets (service restarts) correctly, which `increase()` also does but as an absolute count rather than a per-second rate.

---

## Logs

**Q4.** What is the purpose of MDC (Mapped Diagnostic Context) in logging?

- A. It sets the log level per class at runtime without restarting the service
- B. It attaches key-value pairs (such as `traceId`) to every log line produced by the current thread, enabling correlation across log entries
- C. It compresses log output to reduce storage costs
- D. It routes log lines to different files based on severity level

??? success "Answer"
    **B — Attaches key-value pairs to every log line on the current thread.**

    MDC stores a thread-local map that the logging framework (Logback, Log4j2) automatically appends to every log statement using a pattern like `%X{traceId}`. When OpenTelemetry propagates the `traceId` into MDC at the entry point of a request, every subsequent log line — across all called methods in that thread — carries the same ID, making it trivial to filter an entire request's log history with a single query.

---

## Distributed Traces

**Q5.** Why does every span in a distributed trace share the same `traceId`?

- A. Because all spans are created by the first service, which distributes them
- B. Because the `traceId` is generated once at the entry point and propagated in the `traceparent` header to every downstream service, which copies it unchanged into their own spans
- C. Because the tracing backend assigns a common ID when it assembles the trace from individual spans
- D. Because spans are stored in the same database table and inherit the row ID

??? success "Answer"
    **B — The `traceId` is generated once and propagated via `traceparent`.**

    When the first service (e.g., the API gateway) receives a request with no `traceparent` header, it generates a 128-bit `traceId` and creates the root span. Every outgoing HTTP call includes `traceparent: 00-<traceId>-<currentSpanId>-01`. Each downstream service reads this header, keeps the `traceId` unchanged, generates a new `spanId`, and sets `parentSpanId` to the received `spanId`. The result is a tree of spans that all share the same `traceId`, which the tracing backend uses to assemble the full trace view.

---

**Q6.** A service receives `traceparent: 00-abc123000000000000000000000000aa-def456000000000000-01` and creates a child span with ID `999888000000000000`. What does the `traceparent` header it sends to the next downstream service look like?

- A. `00-abc123000000000000000000000000aa-def456000000000000-01` (unchanged)
- B. `00-999888000000000000000000000000bb-abc123000000000000-01` (new traceId)
- C. `00-abc123000000000000000000000000aa-999888000000000000-01` (same traceId, new spanId)
- D. `00-abc123000000000000000000000000aa-def456000000000000-999888000000000000-01` (appended)

??? success "Answer"
    **C — Same `traceId`, new `spanId` equal to the current span's ID.**

    The `traceId` (`abc123...`) never changes across the entire request — that is the invariant that links all spans together. The `parentSpanId` field in the new header is set to the *current* span's ID (`999888...`), so the downstream service knows exactly which span triggered the call. The received `def456...` becomes the `parentSpanId` of the *current* span (stored in the span record), not forwarded further.

---

## Sampling

**Q7.** What is the key difference between head sampling and tail sampling?

- A. Head sampling is done by the application; tail sampling is done by the tracing backend
- B. Head sampling decides whether to record a trace at the very first span before any downstream calls are made; tail sampling decides after the complete trace is assembled, allowing it to favour traces with errors or high latency
- C. Head sampling keeps 100% of traces; tail sampling discards them
- D. They are synonyms for the same strategy applied at different layers of the stack

??? success "Answer"
    **B — Decision timing is the core difference.**

    Head sampling must commit to record or drop a trace at the moment the root span is created, with no knowledge of what will happen downstream. This is fast and has near-zero overhead but will randomly discard some error traces. Tail sampling buffers spans until the trace is complete, then applies rules — for example, keep all traces where any span has `status=ERROR`. The tradeoff is higher memory and latency in the collector.

---

## OpenTelemetry

**Q8.** Which OpenTelemetry component can receive telemetry from multiple services, apply filtering and batching, and fan the data out to multiple backends simultaneously?

- A. The OTel API — it abstracts over multiple backends in the application code
- B. The OTel SDK — it batches spans before exporting
- C. The OTel Collector — a standalone process that acts as a pipeline between producers and backends
- D. The OTLP exporter — it can route to multiple endpoints from within the SDK

??? success "Answer"
    **C — The OTel Collector.**

    The Collector is a vendor-agnostic proxy deployed as a sidecar or as a cluster-level gateway. Its pipeline has three stages: *receivers* (accept OTLP, Jaeger, Zipkin, etc.), *processors* (filter, sample, batch, add attributes), and *exporters* (send to Prometheus, Jaeger, Loki, Datadog, etc. simultaneously). Centralising telemetry routing in the Collector means changing backends requires only a Collector config change, not a redeployment of every application.

---

## DORA Metrics

**Q9.** Which DORA metric most directly measures how quickly a team can respond to a production incident?

- A. Deployment Frequency — more deploys means faster response
- B. Lead Time for Changes — measures the full commit-to-production pipeline
- C. Change Failure Rate — tracks how often deployments cause incidents
- D. Mean Time to Recovery (MTTR) — measures elapsed time from incident start to service restoration

??? success "Answer"
    **D — Mean Time to Recovery (MTTR).**

    MTTR is defined as the time from when an incident is detected (typically when an alert fires) to when the service is restored to normal operation. It directly captures incident response effectiveness — including detection speed, diagnosis time, fix deployment, and verification. The other three metrics measure delivery throughput and reliability, not recovery speed. Elite teams achieve MTTR under one hour.

---

## Java Agent Instrumentation

**Q10.** The OpenTelemetry Java agent instruments Spring Boot without code changes. How does it achieve this?

- A. It requires annotating all classes with `@OtelInstrumented`
- B. It uses Java bytecode instrumentation (`java.lang.instrument` API) to modify loaded classes at runtime
- C. It reads `application.properties` and generates proxy classes at startup
- D. It requires rebuilding the application with a special Maven plugin

??? success "Answer"
    **B — Java bytecode instrumentation via `java.lang.instrument`.**

    The JVM's `java.lang.instrument` API, combined with a `ClassFileTransformer`, allows a `-javaagent` JAR to intercept every class as it is loaded and rewrite its bytecode before it reaches the application. The OTel Java agent uses this mechanism to inject span creation, HTTP header propagation, and JDBC tracing into Spring MVC, RestTemplate, WebClient, Hibernate, and dozens of other libraries — all without touching the application source code.
