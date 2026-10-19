Click **"Answer"** to reveal the correct answer and explanation.

---

## Vocabulary and the curve

**Q1.** `inventory` completes 2 000 holds per second and each hold spends on average 150 ms in the service. How many holds are in progress at any moment, on average?

- A. 13
- B. 150
- C. 300
- D. 2 150

??? success "Answer"
    **C — 300.**

    Little's Law: N = X × R = 2 000/s × 0.15 s = 300. This is the concurrency the path must accommodate — threads, async slots or connections — and the number of VUs a load generator needs to sustain that rate when each iteration lasts 150 ms.

---

**Q2.** A breakpoint test of `POST /holds` shows: up to 1 100 req/s the p99 stays under the 300 ms SLO; at 1 200 req/s the p99 is 650 ms; the maximum achieved throughput is 1 250 req/s; beyond that throughput drops. Which number should capacity planning use per deployment?

- A. 1 250 req/s, the maximum throughput
- B. 1 100 req/s, the knee — the highest rate that still meets the SLO
- C. 1 200 req/s, the first point above the knee
- D. The average of all steps

??? success "Answer"
    **B — The knee.**

    At 1 200–1 250 req/s the system "works" but breaks its SLO; beyond 1 250 it is saturated and retrograde. Plan with the throughput at which the SLO holds, and then add headroom below it.

---

**Q3.** According to the Universal Scalability Law, why can throughput **decrease** when you add more concurrent requests past a certain point?

- A. Because the load generator becomes slower
- B. Because of coherency costs (κ): keeping shared state consistent grows with N², so past a peak each extra request costs more than it contributes — locks, cache invalidation, retries
- C. Because Little's Law stops being valid at high load
- D. It cannot: throughput always grows or stays flat

??? success "Answer"
    **B — Coherency (and contention) costs.**

    The USL adds a contention term σ(N−1) and a coherency term κN(N−1) to the denominator. The quadratic term eventually dominates, producing a peak and then retrograde scaling. This is why overload makes systems *less* productive and why admission control (a waiting room) helps.

---

## Methodology

**Q4.** During a test, `inventory` has 45 % CPU, all 200 Tomcat threads busy, its Hikari pool at 10/10 active with 180 threads pending, and PostgreSQL at 35 % CPU with most sessions in `wait_event = Lock: tuple`. What is the bottleneck?

- A. `inventory` CPU — add pods
- B. PostgreSQL CPU — use a larger instance
- C. Row-lock contention in the database, which makes transactions hold connections longer and exhausts the pool and the threads
- D. The Tomcat thread pool — raise it to 800

??? success "Answer"
    **C — Lock contention.**

    Following the USE method downstream: CPU is not saturated anywhere; the threads and the pool are saturated because they *wait*; the waits end in row locks. More pods or threads add more waiters; a bigger instance has idle CPU already. Shorten transactions, use `SKIP LOCKED`, and control admission.

---

**Q5.** What is the main difference between the USE and RED methods?

- A. USE is for Java, RED for Python
- B. USE checks each **resource** (utilization, saturation, errors) from the inside; RED checks each **service** (rate, errors, duration) as users experience it — RED tells you which service hurts, USE which resource inside it is the cause
- C. RED replaces USE in Kubernetes
- D. USE measures latency, RED measures CPU

??? success "Answer"
    **B.**

    They are complementary. In a load test the RED metrics become the thresholds (per endpoint), and when a threshold fails, USE on the resources — including software resources such as pools and locks — locates the bottleneck.

---

**Q6.** The staging database used for a load test has 1 000 seats for one event; production will have 60 000 seats for the stadium show plus all other events. Which result is most likely to be misleading?

- A. The error rate of `GET /search`
- B. The latency of seat queries and the cache hit ratio: small tables fit in memory and make missing indexes and cold-cache effects invisible
- C. The TLS handshake time
- D. The size of the container image

??? success "Answer"
    **B.**

    Data volume and distribution decide index depth, plan choices, whether the working set fits in memory and the cache hit ratio. Test with production-sized, production-shaped (skewed) synthetic data.

---

## Load testing

**Q7.** A closed-model test has 200 VUs with 1 s of think time. When the system's response time goes from 0.1 s to 2 s, what happens to the load the test generates?

- A. It stays at ~182 req/s
- B. It increases, because VUs retry
- C. It drops from ~182 req/s to ~67 req/s — the test backs off exactly when the system struggles
- D. It drops to zero

??? success "Answer"
    **C.**

    X = N / (R + Z): 200 / 1.1 ≈ 182 req/s, and 200 / 3.0 ≈ 67 req/s. Real fans arriving from the internet do not slow down because the system did; an open model (arrival rate) keeps sending ~182 req/s and reveals the queue.

---

**Q8.** Which k6 executor implements an **open** workload model?

- A. `constant-vus`
- B. `ramping-vus`
- C. `per-vu-iterations`
- D. `ramping-arrival-rate`

??? success "Answer"
    **D — `ramping-arrival-rate`** (and `constant-arrival-rate`).

    Arrival-rate executors start iterations on a schedule, independent of how long previous iterations take. VU-based executors are closed: each VU waits for its iteration to finish before starting the next.

---

**Q9.** An arrival-rate k6 test at 1 000 iterations/s reports `dropped_iterations` = 48 000. What does it mean?

- A. 48 000 requests failed with 5xx
- B. k6 did not have enough VUs to start iterations on schedule, so the test did not deliver the intended load — it degenerated into a closed-like test. Increase `preAllocatedVUs`/`maxVUs` (VUs ≈ rate × iteration duration) or distribute the generator
- C. The thresholds aborted the test
- D. The server dropped 48 000 TCP connections

??? success "Answer"
    **B.**

    Dropped iterations are load that was never sent. Add a threshold `dropped_iterations: ['count==0']` so such a test cannot pass, and size VUs with Little's Law.

---

**Q10.** A server freezes for 1.5 s four times in a minute. A closed-loop tester reports p99 = 1 ms; an open-model tester measuring from the intended send time reports p99 ≈ 1.4 s. Which statement is correct?

- A. The closed-loop number is right; the open model double-counts slow requests
- B. The closed-loop tester suffered coordinated omission: it stopped sending during the freezes, so it omitted the very requests that would have been slow; users experience the open-model number
- C. Both are wrong because the test was too short
- D. The difference is caused by network jitter

??? success "Answer"
    **B — Coordinated omission.**

    The tester coordinated with the server's stalls: one slow sample per freeze instead of ~150. Use open-model generators (k6 arrival-rate executors, wrk2, vegeta, Gatling `injectOpen`), measure from the intended start time, and count timeouts at their full duration.

---

**Q11.** Which test type is designed to find memory or connection leaks?

- A. Smoke
- B. Spike
- C. Soak
- D. Breakpoint

??? success "Answer"
    **C — Soak (endurance).**

    Leaks and slow growth need time. A soak test holds a realistic load for hours and is read as trends: heap after GC, open connections, latency in hour 8 vs hour 1.

---

**Q12.** A sold-out seat makes `POST /holds` return `409 Conflict`. By default k6 counts it in `http_req_failed`. What should the test do?

- A. Ignore `http_req_failed` entirely
- B. Declare 409 an expected status (`http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 409))`) so that only real failures count, and check the business outcome separately (seats held)
- C. Retry 409s until they succeed
- D. Remove the hold flow from the test

??? success "Answer"
    **B.**

    Decide explicitly which statuses are correct behaviour. Counting 409 as errors makes a correct system fail its thresholds; counting 503 as success hides an overloaded one. A business metric such as `seats_held` confirms that useful work happened.

---

## Bottlenecks and capacity

**Q13.** `inventory` has low CPU but high latency under load. Which profile is most useful?

- A. A CPU (on-CPU) flame graph
- B. A wall-clock (off-CPU) profile, e.g. `asprof -e wall`, which also samples threads that are waiting on locks, sockets and pools
- C. An allocation profile
- D. No profile: add pods

??? success "Answer"
    **B — Wall-clock.**

    On-CPU profiles only show running code; when the time is spent waiting, they point at whatever little CPU work exists (JSON, logging) — the wrong fix. A wall-clock profile shows that the time is spent in `HikariPool.getConnection`, a socket read inside a locking query, or an HTTP call inside a transaction.

---

**Q14.** In `EXPLAIN (ANALYZE, BUFFERS)` you see `Seq Scan on seats … Rows Removed by Filter: 5968520` and `Buffers: shared read=59861` for a query that returns 8 rows. What is the most likely fix?

- A. Increase `work_mem`
- B. An index matching the filter (and the sort), e.g. a partial index on `(event_id, section, row_label, seat_number) WHERE status = 'AVAILABLE'`, created `CONCURRENTLY`
- C. Add a read replica
- D. Raise the connection-pool size

??? success "Answer"
    **B.**

    The scan reads 6 million rows and ~60 000 pages to return 8. An index that matches the predicate and the order lets PostgreSQL read the first 8 matching rows directly — in the page's example, from 412 ms to under 0.1 ms.

---

**Q15.** Holds peak at 4 500/s. One `inventory` pod's knee is 275 holds/s, you plan to run at 75 % of the knee, and replicas are spread over 3 zones so that losing one zone leaves enough capacity. How many pods do you need?

- A. 17
- B. 22
- C. 33
- D. 45

??? success "Answer"
    **C — 33.**

    ⌈4 500 / (275 × 0.75)⌉ = ⌈21.8⌉ = 22 pods for the load. To survive losing one of three zones, the remaining two thirds must still hold 22: ⌈22 × 3/2⌉ = 33. Then check the shared resources: 33 pods × a pool of 10 = 330 client connections → PgBouncer.

---

**Q16.** A team adds a k6 budget test to every pull request, but it fails randomly about once a week and developers re-run it until it passes. What is the best improvement?

- A. Remove the test
- B. Reduce noise (fixed arrival rate, warm-up, same runner type, automatic single retry), compare relative to `main`'s baseline with a tolerance, and add deterministic budgets such as SQL statements per request
- C. Raise the thresholds to 10 s
- D. Run the full breakpoint test on every pull request

??? success "Answer"
    **B.**

    A gate people do not trust is worse than no gate. Keep the PR gate short and stable, catch big regressions with a relative comparison, use deterministic checks (query counts catch N+1 reliably), and run the full campaign nightly or before events in the performance environment.
