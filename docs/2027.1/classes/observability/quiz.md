
Click **"Answer"** to reveal the correct answer and explanation.

---

## Observability and health checks

**Q1.** During the BoxOffice on-sale, every pod is green, CPU is at 45% and the overall error rate is 0.3%, but fans wait nine seconds to pay. Which statement best explains why the dashboards did not show the problem?

- A. The metrics backend was sampling too aggressively
- B. The dashboards watched causes averaged over all routes; the problem was tail latency on one route, caused by an external dependency
- C. Kubernetes health checks are not reliable under load
- D. Error rates below 1% cannot be measured with Prometheus

??? success "Answer"
    **B — Causes, averaged over everything, hide a tail-latency symptom on one journey.**

    CPU and pod status are causes, chosen in advance. The fans' experience was a **latency** symptom on `POST /checkout`, concentrated in the **p99**, caused by the payment provider. Averaging over all routes dilutes the checkout route, and the median hides the tail. Measure what users feel — per-journey latency percentiles and SLIs — and use traces to find where the time went.

---

**Q2.** The readiness probe of `order` checks the PostgreSQL connection. The database performs a 20-second failover. What happens?

- A. Nothing: readiness failures only affect new pods
- B. Kubernetes restarts every `order` pod, which is the desired self-healing behaviour
- C. Every `order` pod becomes unready at the same time and is removed from the Service, so even routes that do not need the database return errors
- D. The load balancer keeps sending traffic, because readiness is only checked at startup

??? success "Answer"
    **C — A correlated readiness failure removes every instance at once.**

    A dependency shared by all instances makes all of them fail the probe together: the Service has no endpoints and every route fails, including those served from Redis. (Had the *liveness* probe checked the database, Kubernetes would also restart every pod — a restart storm.) Liveness should never check dependencies; readiness should check only what a different instance would fix; dependency health belongs in metrics, alerts, timeouts and circuit breakers.

---

**Q3.** Which probe should fail if a JVM is deadlocked and will never recover by itself?

- A. Startup
- B. Liveness
- C. Readiness
- D. None — deadlocks must be handled by an alert to a human

??? success "Answer"
    **B — Liveness.**

    Liveness answers "is the process stuck beyond repair?" and its failure **restarts** the container. Readiness only removes the instance from the load balancer (useful when it is temporarily unable to serve, e.g. overloaded or draining). Startup protects slow-starting applications by pausing the other probes until initialization finishes.

---

## Signals

**Q4.** A team adds the label `customer_id` (about 1 million values) to the checkout latency histogram, which already has 204,000 series. What is the most likely consequence?

- A. Queries become slightly slower but otherwise nothing changes
- B. The number of series is multiplied by up to a million, and the metrics backend runs out of memory or the bill explodes
- C. Prometheus automatically drops the label because it is high-cardinality
- D. Nothing, because histograms store only buckets, not labels

??? success "Answer"
    **B — Cardinality multiplies.**

    Every distinct combination of label values is a separate series; adding an unbounded label multiplies the series count by its number of values. Per-customer questions belong in **traces and logs**, where `customer_id` is an attribute queried on demand, not a pre-aggregated metric dimension.

---

**Q5.** Four `order` pods report their own p99 latency: 180 ms, 180 ms, 180 ms and 1,260 ms (the slow pod handles 10% of the traffic). What is the correct way to obtain the fleet p99?

- A. Average the four values: 450 ms
- B. Take the maximum: 1,260 ms
- C. Sum the histogram buckets of all pods (`sum by (le)`) and compute the percentile from the total
- D. Take the median of the four values: 180 ms

??? success "Answer"
    **C — Aggregate buckets first, then compute the percentile.**

    Percentiles do not compose: neither the average nor the maximum of per-pod p99s is the fleet p99. Histogram buckets are counters, so they can be summed across pods; `histogram_quantile(0.99, sum by (le) (rate(..._bucket[5m])))` estimates the true percentile. In the simulation of the Signals page, the true fleet p99 is about 750 ms, while the average of the p99s is about 450 ms.

---

**Q6.** Which pairing of method and target is correct?

- A. RED for the PostgreSQL connection pool; USE for the `POST /checkout` endpoint
- B. RED for the `POST /checkout` endpoint; USE for the PostgreSQL connection pool
- C. RED and USE are synonyms of the four golden signals
- D. USE applies only to CPU and memory

??? success "Answer"
    **B — RED for request-driven services, USE for resources.**

    RED (rate, errors, duration) describes what callers of a service experience. USE (utilization, saturation, errors) describes a resource — CPU, disks, but also pools and queues. For the connection pool, **saturation** (pending acquisitions, wait time) is often the earliest warning that checkout latency is about to rise.

---

**Q7.** In a checkout trace, the `payment` span takes 8.95 s, of which a child span `pool.acquire` takes 7.9 s and the HTTP call to the provider takes 1.0 s. What is the main conclusion?

- A. The provider is responsible for the 9 seconds
- B. Most of the time is spent waiting for a connection inside BoxOffice: the pool is saturated because each slow call holds a connection longer
- C. The trace is broken, because child spans cannot be longer than the provider call
- D. The database is the bottleneck

??? success "Answer"
    **B — Queueing inside the service dominates the critical path.**

    The provider got slower (1 s), so by Little's law each call holds a connection longer, the pool of 20 saturates, and new calls wait 7.9 s in line. The fix is a bounded wait and a short timeout on the provider call (plus a bulkhead), not only a complaint to the provider. Without a span for the wait, the provider would be blamed for all nine seconds.

---

## OpenTelemetry

**Q8.** A request passes through `gateway` → `order` → `inventory`. What happens to the W3C `traceparent` header at each hop?

- A. Each service generates a new trace-id
- B. The trace-id and flags are kept; the parent-id is replaced with the ID of the caller's current span
- C. The header is forwarded unchanged so the backend can identify the root span
- D. The callee returns the header in the response, and the caller merges it

??? success "Answer"
    **B — Same trace-id, new parent-id at every hop.**

    `traceparent: 00-<trace-id>-<parent-id>-<flags>`. Keeping the trace-id groups all spans of the request; replacing the parent-id lets the backend rebuild the tree. No service needs to know the whole trace.

---

**Q9.** BoxOffice handles 2,000 requests/s and 1% of them fail. Which sampling setup keeps **every** error trace while storing fewer than 10% of all traces?

- A. Head sampling at 10% in every service
- B. Rate limiting at 100 traces per second
- C. 100% head sampling in the services and a tail-sampling policy in the Collector: all errors, all slow traces and 5% of the rest
- D. Head sampling at 1% plus tail sampling of errors in the Collector

??? success "Answer"
    **C — Tail sampling with full head sampling.**

    Head sampling decides before knowing the outcome, so it keeps errors at the same ratio as everything else (A and D lose 90% or 99% of error traces; D's tail sampler only sees the 1% that survived the head). Tail sampling decides after the trace completes; with 1% errors, 2% slow and 5% of the rest, about 7.8% of traces are stored — and 100% of the errors. Metrics should be computed from all traffic before sampling.

---

**Q10.** A team runs three replicas of a gateway Collector behind a round-robin load balancer, each with the tail-sampling processor. What goes wrong?

- A. Nothing; tail sampling is stateless
- B. Spans of the same trace land on different replicas, so each replica decides on fragments of the trace
- C. The Collectors cannot receive OTLP over gRPC behind a load balancer
- D. Tail sampling forces every replica to keep 100% of the traces

??? success "Answer"
    **B — Tail sampling needs the whole trace in one place.**

    The decision ("does this trace contain an error?") requires every span of the trace. Use a first tier that routes by trace ID (the `loadbalancing` exporter) to a second tier that samples, so all spans of a trace reach the same instance.

---

## Alerting

**Q11.** The checkout SLO is 99.9% over a rolling 28-day window. The observed error ratio over the last hour is 1.44%. What is the burn rate, and how much of the budget did that hour consume?

- A. Burn rate 1.44; 1.44% of the budget
- B. Burn rate 14.4; about 2% of the budget
- C. Burn rate 144; about 20% of the budget
- D. Burn rate 14.4; about 14.4% of the budget

??? success "Answer"
    **B — 14.4×, about 2%.**

    Burn rate = 1.44% ÷ 0.1% = 14.4. Budget consumed = burn rate × duration ÷ window = 14.4 × 1 h ÷ 672 h ≈ 2.1%, about 2%. This is the classic fast-burn paging threshold: at this pace the whole 28-day budget is gone in about 2 days (28 ÷ 14.4 ≈ 1.9).

---

**Q12.** Why does the recommended SLO alert combine a long window (1 h) with a short window (5 min) at the same burn rate?

- A. The short window catches slow burns that the long window misses
- B. The long window proves the burn is significant; the short window proves it is still happening, so the alert stops soon after the problem is fixed
- C. Prometheus cannot evaluate windows longer than one hour on its own
- D. The two windows are averaged to reduce noise

??? success "Answer"
    **B — Significance from the long window, fast reset from the short one.**

    A 1-hour average stays high for up to an hour after a short outage ends, so a long-window-only alert keeps firing (slow reset). Requiring the 5-minute window too means the alert clears as soon as the errors stop. Slow burns are caught by other rules (6× over 6 h, 1× over 3 days), not by the short window.

---

**Q13.** Which of these should page the on-call engineer at 3 a.m.?

- A. CPU of the PostgreSQL primary above 90% while all SLIs are within target
- B. One of 30 `catalog` pods restarted and is healthy again
- C. The checkout SLO burning at 20× confirmed by the 1-hour and 5-minute windows
- D. A Kafka broker disk projected to be full in 4 days

??? success "Answer"
    **C — Urgent, actionable and user-visible.**

    A and B are causes without user impact (dashboard, maybe a capacity review). D is actionable but not urgent: a ticket for working hours. A page must be urgent, actionable and about something users feel — the SLO burning fast.

---

## Incident response

**Q14.** Twelve minutes into a SEV1, the operations lead has a hypothesis but no proof; switching to the secondary payment provider is documented and tested. What should the incident commander decide?

- A. Keep investigating until the root cause is confirmed, to avoid an unnecessary change
- B. Switch to the secondary provider now to mitigate impact; investigate the root cause afterwards
- C. Ask every engineer in the channel to test their own hypothesis in production in parallel
- D. Wait for the provider's status page before acting

??? success "Answer"
    **B — Mitigate first.**

    Users feel the time to **mitigation**. A generic, rehearsed mitigation (failover, rollback, flag) that works regardless of the exact cause should be taken as soon as it is safe. Parallel uncoordinated changes (C) make the incident worse and the timeline unreadable; understanding comes later, in the postmortem.

---

**Q15.** Which statement best describes a **blameless** postmortem?

- A. It does not record who did what, so the timeline is anonymous and vague
- B. It assumes people acted reasonably with what they knew, and asks how the system made the failure possible, producing owned and dated action items
- C. It is written only when nobody made a mistake
- D. It identifies the single root cause using five whys and closes the incident

??? success "Answer"
    **B — System-focused, honest, and actionable.**

    Blameless does not mean vague: the timeline is precise, including who did what. The point is that people are not punished for honest accounts, so the organisation learns how failures really happen. Complex incidents have several **contributing factors**; a single "five whys" chain often stops at the one factor you cannot fix (here, the external provider).
