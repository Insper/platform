Click **"Answer"** to reveal the correct answer and explanation.

---

## Signals and instrumentation

**Q1.** Support says "checkout is slow". Which signal answers *which service and which step* made a specific slow request slow?

- A. A metric: the p99 of `http_server_request_duration_seconds`
- B. A trace: the spans of that request, with the time of each hop
- C. A log line with the word "slow"
- D. The CPU utilization of each container

??? success "Answer"
    **B — a trace.**

    Metrics aggregate: they say *that* p99 is high and for which service, but not why one request was slow. A trace records one request as a tree of spans — gateway, order, each SQL statement, the Kafka send — so the slow hop is visible. Logs give the details (*why*) once you know where to look, ideally reached from the trace through `trace_id`.

---

**Q2.** How does the OpenTelemetry Java agent instrument Spring MVC, JDBC and Kafka without code changes?

- A. It replaces the Spring Boot starters with instrumented copies at build time
- B. It is attached with `-javaagent` and rewrites the bytecode of known libraries as their classes are loaded
- C. It reads the application logs and converts them into spans
- D. It proxies all network traffic of the container

??? success "Answer"
    **B — bytecode instrumentation at class-loading time.**

    The JVM calls the agent before `main`; the agent registers transformers that add span creation, context propagation and metric recording to the methods of supported libraries. That is why `JAVA_TOOL_OPTIONS=-javaagent:...` is enough, and why startup gets slower.

---

**Q3.** The three `catalog` replicas use the same `OTEL_SERVICE_NAME: catalog`. Why not `catalog-1`, `catalog-2`, `catalog-3`?

- A. Because the agent rejects names with digits
- B. Because they are one service with three instances: dashboards and SLOs aggregate by service, and each instance still gets its own `service.instance.id`
- C. Because Prometheus can store only one series per name
- D. There is no reason; both are equivalent

??? success "Answer"
    **B — service vs instance.**

    Users experience the `catalog` service, not a replica. With one service name, `sum by (service_name)` adds the three replicas and the SLO covers the service; when you need the per-replica view, the `instance`/`service_instance_id` label is still there. Naming replicas as services would multiply dashboards and break the moment replicas scale.

---

**Q4.** Place an order and you find two unrelated traces: one for `POST /orders` and one starting in the outbox relay. Why does automatic context propagation fail here?

- A. Kafka does not support headers
- B. The relay reads a database row later, on a scheduler thread; the request's trace context was never stored in the row, so there is nothing to continue
- C. The agent does not instrument `@Scheduled` methods
- D. Sampling dropped the link

??? success "Answer"
    **B — the context did not travel with the data.**

    The agent propagates context in memory (same thread) and across HTTP and Kafka by injecting the `traceparent` header. An outbox row is a different carrier that the agent does not know. Storing the request's `traceparent` in the row and making it current before `kafka.send` reconnects the trace — the same idea W3C Trace Context uses on HTTP.

---

## Metrics and dashboards

**Q5.** Three `catalog` replicas report p95 latencies of 80 ms, 90 ms and 400 ms. What is the p95 of the service?

- A. 190 ms, the average of the three
- B. 400 ms, the maximum
- C. It cannot be computed from the three numbers; it must be computed from the sum of the replicas' histogram buckets
- D. 90 ms, the median

??? success "Answer"
    **C — percentiles do not average.**

    The p95 of the service depends on how many requests each replica served and how they are distributed. Histograms can be added bucket by bucket, so the correct query is `histogram_quantile(0.95, sum by (le) (rate(..._bucket[5m])))`. Averaging percentiles is one of the most common dashboard mistakes.

---

**Q6.** Why does the agent record `http_route="/catalog/events/{id}"` instead of the real URL `/catalog/events/1234`?

- A. To hide the event ids from attackers
- B. Because each distinct label value creates a new time series; raw URLs would create one series per event id (unbounded cardinality)
- C. Because Prometheus does not accept digits in label values
- D. To make the dashboard load faster in the browser

??? success "Answer"
    **B — cardinality.**

    Series count ≈ product of the distinct values of every label. A template has a handful of values; raw URLs have as many as there are events (and attackers can invent more). High cardinality makes Prometheus slow and expensive; identifiers such as `user_id` or `order_id` belong in traces and logs, not in metric labels.

---

**Q7.** In the RED dashboard, the **DB connections** panel shows `used` equal to `max` and `waiting` > 0, while CPU is at 35%. What is the bottleneck?

- A. The CPU
- B. The connection pool: requests are queuing for a connection, so latency grows even though the CPU is idle
- C. The garbage collector
- D. The network between edge and gateway

??? success "Answer"
    **B — pool saturation (the S of USE).**

    When every connection is in use, new requests wait. By Little's Law, the extra concurrency turns into waiting time, so latency rises while CPU stays low. The fix may be a bigger pool, fewer/faster queries, or a pooler such as PgBouncer (lab 6) — but first the evidence: saturation > 0.

---

## SLOs and alerts

**Q8.** The `catalog` SLO is 99.5% over 28 days. The current error ratio is 1%. What is the burn rate, and how long would the whole budget last at that pace?

- A. 1; 28 days
- B. 2; 14 days
- C. 0.5; 60 days
- D. 14.4; about 2 days

??? success "Answer"
    **B — burn rate = error ratio / budget ratio = 1% / 0.5% = 2.**

    A burn rate of 1 spends the budget in exactly the SLO window (28 days); a burn rate of 2 spends it twice as fast, in 14 days. This is the number burn-rate alerts compare against thresholds such as 14.4 (about 2% of the budget in 1 hour) and 6 (about 5% in 6 hours).

---

**Q9.** Why does the fast-burn rule require the burn rate to exceed 14.4 over **both** 1 hour and 5 minutes?

- A. To double the chance of firing
- B. The long window proves the problem is significant (not a blip); the short window proves it is still happening, so the alert resolves soon after recovery
- C. Because Grafana cannot evaluate windows longer than 1 hour alone
- D. To compare the service with its own past

??? success "Answer"
    **B — significance and recency.**

    A 1-hour window alone would keep paging for up to an hour after the fix (the bad minutes are still inside the window). A 5-minute window alone would page for short blips that cost almost no budget. Requiring both gives high precision and fast reset — the core of the multiwindow, multi-burn-rate method from the Google SRE workbook.

---

**Q10.** With steady traffic and an hour of healthy history, `db` stops and every `catalog` request fails. Roughly when does the 1-hour burn rate cross 14.4 (SLO 99.5%)?

- A. After about 5 seconds
- B. After about 4.3 minutes, when the 1-hour error ratio reaches 7.2%
- C. After exactly 1 hour
- D. Never, because the short window resets it

??? success "Answer"
    **B — 14.4 × 0.5% = 7.2% of the last hour must be errors: 0.072 × 60 min ≈ 4.3 min.**

    The short window crosses the threshold within a minute; the long window is the slower condition. Add the `for: 1m` and the evaluation interval and the page arrives about 5–6 minutes into a total outage — a deliberate trade-off between detection time and false alarms.

---

**Q11.** Why is `/actuator/health` excluded from the availability SLI?

- A. Because health checks are not HTTP requests
- B. Because probes are frequent, almost never fail and are not made by users; including them inflates the success ratio and hides user-facing errors
- C. Because Prometheus cannot store actuator metrics
- D. Because the health endpoint is slower than the others

??? success "Answer"
    **B — the SLI must measure what users experience.**

    Kubernetes, Docker and the edge call health endpoints every few seconds. Those successful requests dilute real failures: with enough probes, a broken checkout could still show 99.9% "availability". Filter by route (`http_route!~"/actuator.*"`) or measure at the edge.

---

**Q12.** You set `OTEL_TRACES_SAMPLER=parentbased_traceidratio` with argument `0.1` on every service. What happens to the RED dashboard?

- A. Its rates drop to 10% of the real values
- B. Nothing: metrics are recorded for every request regardless of trace sampling; only 10% of the traces are stored
- C. It stops working, because metrics are derived from traces
- D. Its percentiles become exact

??? success "Answer"
    **B — sampling applies to traces, not to the agent's metrics.**

    The HTTP histograms are recorded for every request, so rates, errors and percentiles stay correct. Traces become examples: 10% of them, complete (the root decides and `parentbased` makes every downstream service follow), which is enough to explain a pattern at a fraction of the cost.

[Back to the lab](index.md){ .md-button }
