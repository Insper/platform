Click **"Answer"** to reveal the correct answer and explanation.

---

## Numbers and estimation

**Q1.** BoxOffice has 2 M daily active fans, each viewing about 20 pages per day. What is the **average** read rate, and what should you size for?

- A. ~40 reads/s; size for the average
- B. ~400 reads/s on average; size for the peak hour, ~2–3× higher (~1,000–1,200 reads/s)
- C. ~4,000 reads/s; size for the average
- D. ~40,000 reads/s; size for 10× the average

??? success "Answer"
    **B — ~400 reads/s average, sized for the peak.**

    2 × 10⁶ × 20 = 4 × 10⁷ reads/day; one day ≈ 10⁵ s, so ≈ 400 reads/s (463 with the exact 86,400). Traffic is not flat: the busiest hour is typically 2–3× the average, and that is what capacity must handle. On-sale spikes are estimated separately.

---

**Q2.** Which ordering of latencies, from fastest to slowest, is correct?

- A. SSD random read < RAM reference < same-zone round trip < cross-continent round trip
- B. RAM reference < SSD random read < same-zone round trip < cross-continent round trip
- C. RAM reference < same-zone round trip < SSD random read < cross-continent round trip
- D. Same-zone round trip < RAM reference < SSD random read < cross-continent round trip

??? success "Answer"
    **B — ~100 ns < ~20–100 µs < ~0.1–0.5 ms < ~100+ ms.**

    Memory is about a thousand times faster than an SSD random read, which is somewhat faster than a network round trip inside a data centre; a round trip between continents is hundreds of times slower still, bounded by the speed of light in fibre (~5 µs per km).

---

**Q3.** A page handler makes 40 **sequential** calls to Redis in the same availability zone, each doing almost no work on the server. Roughly how long does the handler spend on those calls, and what is the fix?

- A. ~40 µs; nothing to fix
- B. ~4–20 ms, dominated by network round trips; batch the calls (`MGET`, pipelining) or cache in process
- C. ~4 s; replace Redis with a database
- D. ~400 ms; add Redis replicas

??? success "Answer"
    **B — Round trips dominate.**

    Each call costs a same-zone round trip of ~0.1–0.5 ms, so 40 of them cost ~4–20 ms even though Redis does microseconds of work per call. Batching turns 40 round trips into one.

---

**Q4.** BoxOffice issues 200 k ticket PDFs per day, ~100 KB each, and wants to keep them for 5 years. Approximately how much storage is that, and where should it live?

- A. ~36 GB, in the orders table
- B. ~3.6 TB, in Redis
- C. ~36 TB, in an object store (or generate the PDFs on demand instead of storing them)
- D. ~360 TB, in the data warehouse

??? success "Answer"
    **C — ~36 TB.**

    2 × 10⁵ × 10⁵ B = 2 × 10¹⁰ B = 20 GB/day; × 365 ≈ 7.3 TB/year; × 5 ≈ 36 TB. Large, immutable files belong in an object store (cheap, durable, effectively unlimited) — and since a PDF can be regenerated from the order, storing them at all is a design choice worth questioning.

---

**Q5.** Event pages load ~1 MB of images, and the peak is 1,200 page views per second. What bandwidth does the origin need without a CDN?

- A. ~1.2 Mbit/s
- B. ~120 Mbit/s
- C. ~10 Gbit/s
- D. ~1 Tbit/s

??? success "Answer"
    **C — ~10 Gbit/s.**

    1,200 × 1 MB = 1.2 GB/s; × 8 bits = 9.6 Gbit/s. That saturates a 10 Gbit/s link and is expensive in egress — a strong reason to serve images from a CDN, where a 95% edge hit ratio leaves ~0.5 Gbit/s for the origin. Remember: networks in **bits**, storage in **bytes**.

---

## Queueing and scalability

**Q6.** The inventory service receives 1,000 holds/s and each hold spends 40 ms inside the service. On average, how many holds are in flight?

- A. 25
- B. 40
- C. 400
- D. 40,000

??? success "Answer"
    **B — Little's Law: L = λ × W = 1,000 × 0.040 = 40.**

    This is the minimum concurrency the service needs (threads, or slots in an event loop) — plus headroom for bursts and for losing a replica.

---

**Q7.** Two million fans are in the BoxOffice waiting room, which admits 1,000 fans per second to the inventory. How long does the **last** fan in line wait?

- A. ~33 seconds
- B. ~3.3 minutes
- C. ~33 minutes
- D. ~5.5 hours

??? success "Answer"
    **C — W = L / λ = 2,000,000 / 1,000 = 2,000 s ≈ 33 min.**

    In practice the 60 k seats run out long before, and the waiting room should tell the rest of the line that the show is sold out instead of making them wait.

---

**Q8.** A load test runs 100 virtual users in a closed loop, with no think time. The server's response time is 50 ms. What is the **maximum** throughput this test can generate — and what happens if the server slows to 500 ms?

- A. 2,000 req/s; with 500 ms, still 2,000 req/s
- B. 2,000 req/s; with 500 ms, it drops to 200 req/s — the test reduces load exactly when the system struggles
- C. 100 req/s in both cases
- D. 20,000 req/s; unaffected by response time

??? success "Answer"
    **B — N = X × (R + Z), so X = 100 / 0.05 = 2,000 req/s, then 100 / 0.5 = 200 req/s.**

    Closed-loop tests are throttled by the system under test. To test a target arrival rate, use an open model (constant arrival rate) and check results with Little's Law.

---

**Q9.** A single database server (modelled as M/M/1) has a service time of 5 ms. What is its mean response time at 50% and at 90% utilization?

- A. 5 ms and 5 ms
- B. 7.5 ms and 9.5 ms
- C. 10 ms and 50 ms
- D. 10 ms and 500 ms

??? success "Answer"
    **C — R = S / (1 − ρ): 5 / 0.5 = 10 ms; 5 / 0.1 = 50 ms.**

    Less than double the load made the mean 5× worse; the p99 (≈ 4.6 × the mean in M/M/1) goes from ~46 ms to ~230 ms. That is the knee of the latency curve.

---

**Q10.** Why do latency-sensitive services usually target ~50–70% utilization at peak instead of ~95%?

- A. Because CPUs overheat above 70%
- B. Because cloud providers charge more above 70%
- C. Because response time grows like 1 / (1 − ρ), exploding near saturation, and the remaining replicas must absorb the load of one that fails
- D. Because utilization above 70% cannot be measured accurately

??? success "Answer"
    **C — Stay left of the knee, and keep headroom for failover.**

    With 4 replicas at 60%, losing one moves the others to 80% — still serviceable. At 80% each, losing one asks for ~107%: the survivors collapse.

---

**Q11.** Load tests of a service give relative throughput C(1) = 1, C(8) = 5.5, C(32) = 9 and C(64) = 8. Which model and cause fit best?

- A. Linear scaling; the measurements are noise
- B. Amdahl's law only; there is a serial fraction but no other cost
- C. The Universal Scalability Law: contention plus a coherency cost (nodes coordinating with each other) that makes throughput **fall** past a peak
- D. Little's Law; the test used too few virtual users

??? success "Answer"
    **C — Throughput decreasing with more nodes is the signature of the coherency term (κ).**

    Amdahl's law alone flattens at 1/σ but never decreases. A fall past N* = √((1 − σ)/κ) indicates crosstalk: distributed locks, cache-coherence traffic, all-to-all communication. The fix is to partition work so nodes share less, not to add nodes.

---

## Percentiles and availability

**Q12.** Server A reports p99 = 100 ms and server B reports p99 = 1,000 ms; they served the same number of requests. What is the p99 of the two servers combined?

- A. 550 ms, the average
- B. 1,000 ms, the maximum
- C. It cannot be computed from these two numbers; merge the latency histograms and compute the percentile from the result
- D. 100 ms, the minimum

??? success "Answer"
    **C — Percentiles cannot be averaged.**

    The combined p99 depends on the full shape of both distributions. Monitoring systems store histograms precisely so they can be merged across servers and time windows.

---

**Q13.** The search service queries 100 shards in parallel and waits for all of them. Each shard is slower than 200 ms in 1% of its calls (its p99), independently. Approximately what fraction of user searches take more than 200 ms?

- A. 1%
- B. 10%
- C. 63%
- D. 99%

??? success "Answer"
    **C — 1 − 0.99¹⁰⁰ ≈ 63%.**

    Under fan-out, the backend's tail becomes the user's typical experience. Mitigations: hedged requests after the p95, partial results after a deadline, fewer shards on the critical path.

---

**Q14.** Checkout synchronously calls five components, each 99.9% available, with independent failures. What is the best estimate of checkout availability, and the best first improvement?

- A. 99.9%; nothing to improve
- B. ~99.5%; remove from the critical path any component the user does not need to wait for (for example, send the e-mail asynchronously)
- C. ~95%; add a cache in front of each component
- D. ~99.99%; components in series improve availability

??? success "Answer"
    **B — 0.999⁵ ≈ 99.5%.**

    In series, availabilities multiply, so the chain is worse than any link. The cheapest improvement is usually to remove hard dependencies from the path (async work, fallbacks); then add redundancy to weak links, and make each remaining link about one nine better than the target.

---

**Q15.** The inventory service has three replicas, each 99.5% available. The parallel formula gives 1 − 0.005³ ≈ 99.99999%. Why might the real availability be far lower?

- A. Because the formula should use addition, not multiplication
- B. Because replicas often fail together — same release, same configuration, same zone or a shared dependency — breaking the independence assumption
- C. Because three replicas are always slower than one
- D. Because load balancers reduce availability by half

??? success "Answer"
    **B — Correlated failures.**

    A bad deploy rolled out to all replicas within minutes, a zone outage, or an expired certificate take down every replica at once. Spread replicas across zones, roll out changes gradually (canary), and reduce MTTR with fast rollback.
