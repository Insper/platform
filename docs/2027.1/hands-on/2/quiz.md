Click **"Answer"** to reveal the correct answer and explanation.

---

**Q1.** Why does lab 2 use `constant-arrival-rate` instead of `constant-vus` for the load test?

- A. Arrival-rate executors use less memory
- B. In an open model the load does not slow down when the server does, so overload shows up as growing latency and `dropped_iterations` instead of being hidden
- C. `constant-vus` cannot send GET requests
- D. Arrival-rate executors make the server faster

??? success "Answer"
    **B — Open model, no coordinated omission.**

    With a fixed number of VUs, each VU waits for its response before sending the next request; when the server slows down, the generator politely sends less, and the test underestimates the damage. Real fans arrive independently, which is what arrival-rate executors simulate.

---

**Q2.** At 300 req/s the average latency is 20 ms. By Little's Law, how many requests are inside `catalog` on average?

- A. 0.6
- B. 6
- C. 15
- D. 6,000

??? success "Answer"
    **B — 6.**

    `L = λ × W = 300 × 0.020 = 6`. That is what `tomcat.threads.busy` should show on average. When the gauge disagrees a lot with the calculation, something is queueing outside what you measured (the k6 side, the network, the edge).

---

**Q3.** `watch-metrics.sh` shows `db_active = 10` and `db_pending = 150` while p99 climbs. What is the bottleneck?

- A. Tomcat threads
- B. The network between k6 and the service
- C. The database connection pool (or the database behind it): requests are queueing to get a connection
- D. The JSON serializer

??? success "Answer"
    **C — The connection pool is full.**

    Ten connections are busy and 150 requests wait for one. Adding Tomcat threads only adds waiters. Either make each request hold a connection for less time (faster queries, caching) or allow more connections — if the database can take them.

---

**Q4.** What is the most useful definition of the **capacity** of a service?

- A. The highest throughput ever printed by k6
- B. The number of CPU cores
- C. The highest arrival rate at which the latency objective (e.g. p99 < 300 ms) and the error budget are still met
- D. The number of VUs k6 could start

??? success "Answer"
    **C — Throughput under an SLO.**

    Past the knee the service may still *process* many requests per second, but users wait seconds. Capacity is defined by the latency and error targets, and you plan with a margin below it.

---

**Q5.** Why does latency grow so sharply near the knee instead of linearly?

- A. Garbage collection only runs under high load
- B. Queueing: waiting time grows roughly like `S / (1 − ρ)`, which explodes as utilization `ρ` approaches 100%
- C. k6 adds latency on purpose
- D. PostgreSQL slows down after 300 queries

??? success "Answer"
    **B — Queueing theory.**

    At 50% utilization a request waits on average about one service time; at 90%, about nine; at 99%, about ninety-nine. Small increases in load near saturation produce huge increases in latency — the hockey-stick curve of the sweep.

---

**Q6.** In the sweep, the 500 req/s run shows `dropped_iterations: 410`. What does that mean?

- A. 410 requests returned HTTP errors
- B. k6 could not start 410 iterations on time because all its VUs were busy waiting for slow responses: the offered rate was not achieved
- C. The service dropped 410 TCP connections
- D. The thresholds dropped 410 data points

??? success "Answer"
    **B — The generator hit `maxVUs`.**

    In an arrival-rate test, each in-flight request occupies a VU. When responses get slow, k6 needs more VUs (Little's Law on the client side); once it reaches `maxVUs` it drops iterations. It is a clear signal of saturation — and a reason to raise `maxVUs` if you want to keep pushing.

---

**Q7.** You doubled `DB_POOL_SIZE` from 10 to 20 and the knee moved from ~350 to ~550 req/s. Why not set it to 500?

- A. HikariCP does not allow more than 100
- B. Each connection is a PostgreSQL process; past the database's own capacity more connections only add contention, and several replicas × large pools exceed `max_connections`
- C. Larger pools make Java slower
- D. Flyway would fail

??? success "Answer"
    **B — The bottleneck moves to the database.**

    A pool is a queue in front of a shared resource. Making it bigger helps only while the resource has spare capacity; then you get the same throughput with more contention (locks, context switches, memory). In lab 6 PgBouncer and replicas address this properly.

---

**Q8.** The first point of your sweep (50 req/s) has a worse p99 than the second (100 req/s). The most likely reason:

- A. Lower load is harder to serve
- B. The JVM, the pool and the database caches were still warming up during the first run
- C. k6 measures low rates incorrectly
- D. The database was reindexing

??? success "Answer"
    **B — Warm-up.**

    JIT compilation, class loading, pool connections and cold database pages make the first minute slower. That is why `sweep.sh` runs an unrecorded warm-up first, and why serious load tests discard the ramp-up period.

---

**Q9.** In the stress test, after the load drops back to 25% of the peak, p95 stays high for a minute. What does it indicate?

- A. Nothing: latency always stays high after a peak
- B. Work queued during the overload is still being drained (or the service is in a degraded state), so the system does not recover instantly; without load shedding a long overload can keep it unhealthy
- C. k6 is still sending the peak rate
- D. The thresholds were misconfigured

??? success "Answer"
    **B — Queues take time to drain.**

    Every request accepted during the overload must still be served. A healthy service recovers once the backlog is processed; one that never recovers (retries, timeouts piling up, memory pressure) needs mechanisms such as load shedding, rate limiting and timeouts — labs 3 and 9.

---

**Q10.** Why does k6 report p95 and p99 per endpoint (`name:detail`, `name:list`) instead of one global number?

- A. Global percentiles cannot be computed
- B. Mixing a 5 ms endpoint with a 30 ms one produces a percentile that describes neither; per-endpoint percentiles show which one degrades first
- C. Thresholds require it
- D. To reduce memory usage

??? success "Answer"
    **B — Percentiles of a mixture hide the culprit.**

    With 80% fast and 20% slow requests, the global p95 is mostly the slow endpoint's latency and the global median the fast one's. Tag requests by endpoint (the `name` tag) and set thresholds per tag: you see which path breaks and when.

---

**Q11.** Your playground hypothesis said "the app server saturates first", but the measurements show the database pool saturating first. What is the right conclusion?

- A. The playground is wrong and should be ignored
- B. The measurement wins: the model was missing a detail (the pool size, the cost of the listing query); update the model and use it for the next decision
- C. Repeat the measurement until it matches the hypothesis
- D. Add more app servers anyway

??? success "Answer"
    **B — Models are for predicting, measurements for deciding.**

    A simulation is only as good as its parameters. Comparing hypothesis and measurement is how you calibrate your mental model — exactly the skill an interviewer probes when asking "where does this design break?".
