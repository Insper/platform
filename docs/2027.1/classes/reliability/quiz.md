Click **"Answer"** to reveal the correct answer and explanation.

---

## Availability and failure

**Q1.** The `catalog` service fails on average every **500 hours** and takes **30 minutes** to recover. What is its availability?

- A. 99%
- B. 99.5%
- C. 99.9%
- D. 99.99%

??? success "Answer"
    **C — 99.9%.**

    Availability = MTTF / (MTTF + MTTR) = 500 / 500.5 ≈ 0.999. Notice the lever: cutting MTTR to 3 minutes (automatic restart) would give 500 / 500.05 ≈ 99.99% without changing how often it fails.

---

**Q2.** The product team asks for **99.99%** monthly availability on the purchase path. What does that imply operationally?

- A. Nothing special: it is only 0.09% better than 99.9%
- B. About 4.4 minutes of downtime per month — less than it takes to page someone and roll back by hand, so detection and recovery must be automated
- C. About 43 minutes per month, enough for one manual rollback
- D. Zero downtime: deploys must be done at night

??? success "Answer"
    **B — about 4.4 minutes per month; automation is mandatory.**

    Each nine is 10× less downtime: 99.9% allows ≈ 43.8 min per month, 99.99% ≈ 4.38 min. A human response (alert, wake up, diagnose, roll back) does not fit in that budget, so failover, rollback and health-based routing must be automatic — and synchronous dependencies at 99.9% (like a payment provider) make the target impossible without redundancy.

---

**Q3.** The gateway runs **3 independent replicas at 99% each**, and every request also needs a **database at 99.95%**. What is the approximate availability of the path?

- A. 97%
- B. 99%
- C. 99.95%
- D. 99.9999%

??? success "Answer"
    **C — about 99.95%.**

    The replicas are in parallel: $1 - 0.01^3 = 99.9999\%$. The database is in series: $0.999999 \times 0.9995 \approx 99.95\%$. Once a component is replicated, the non-replicated components dominate; the next improvement must target the database (e.g. a standby with automatic failover).

---

**Q4.** `order` receives **50 requests/s** that call `payment`, and has a pool of **100 threads**. Payment latency goes from **100 ms to 5 s** and there is no timeout. What happens?

- A. Nothing: 50 requests/s is well below 100 threads
- B. About 250 calls would be in flight (50 × 5), more than the pool: `order` exhausts its threads and its other routes start failing too
- C. 25 threads are used, so 75 remain free
- D. Payment calls fail fast with an error

??? success "Answer"
    **B — thread exhaustion and a cascade.**

    Little's Law: calls in flight = arrival rate × time per call. At 100 ms, 5 threads are busy; at 5 s, 250 would be — beyond the pool of 100. Requests queue, every route of `order` slows down (including routes that do not call payment), and callers of `order` start to exhaust their own pools. A timeout, a circuit breaker and a bulkhead each break this chain.

---

## SLIs, SLOs and error budgets

**Q5.** Which of these is the best **SLI** for the seat-hold journey?

- A. Average CPU usage of the `inventory` pods
- B. Number of `inventory` pods running
- C. Proportion of `POST /holds` requests, measured at the gateway, that return non-5xx in under 500 ms
- D. Average latency of `POST /holds` over the day

??? success "Answer"
    **C — a ratio of good events to valid events, measured near the user.**

    CPU and pod count are infrastructure metrics: a service can be at low CPU and fully broken. An average hides the tail (5% of fans waiting 4 s barely moves it). A good SLI says what fraction of user requests were good — fast enough *and* successful — and can be compared with a target.

---

**Q6.** The purchase path serves **2,000,000 requests per day** with an SLO of **99.95% over 28 days**. How many failed requests does the error budget allow in the window?

- A. 1,000
- B. 28,000
- C. 56,000
- D. 2,800

??? success "Answer"
    **B — 28,000.**

    Requests in the window: $2\,000\,000 \times 28 = 56\,000\,000$. Budget: $(1 - 0.9995) \times 56\,000\,000 = 0.0005 \times 56\,000\,000 = 28\,000$ failed requests.

---

**Q7.** With an SLO of **99.9%** over 28 days, the error rate is steady at **0.6%**. What is the burn rate, and when is the budget exhausted?

- A. 0.6×; never
- B. 6×; in about 4.7 days
- C. 60×; in about 11 hours
- D. 6×; in 6 hours

??? success "Answer"
    **B — 6×, about 4.7 days.**

    Burn rate = error rate / (1 − SLO) = 0.006 / 0.001 = 6. The budget lasts the window divided by the burn rate: 28 / 6 ≈ 4.7 days. In the SRE Workbook's scheme, a 6× burn sustained over 6 hours (5% of the budget) is a paging alert.

---

## Resilience patterns

**Q8.** The gateway, `order` and the `payment` adapter **each** retry failed calls, with up to **3 attempts** per layer. The provider is down. How many calls can one fan click generate to the provider?

- A. 3
- B. 9
- C. 27
- D. 81

??? success "Answer"
    **C — 27.**

    Attempts multiply across layers: $3 \times 3 \times 3 = 27$. Retries at every layer turn an outage into a storm exactly when the dependency is weakest. Retry at one layer (close to the dependency), cap attempts, use backoff with jitter and a retry budget, and let the circuit breaker stop retries when the dependency is known to be down.

---

**Q9.** After a database failover, **1,000 clients** get a connection error at the same instant and all retry with exponential backoff (0.5 s, 1 s, 2 s…) **without jitter**. What goes wrong, and what is the fix?

- A. Nothing: exponential backoff already spreads the retries
- B. All clients retry at the same instants, creating synchronized spikes above capacity; most fail again. Full jitter randomizes each wait so retries spread out
- C. The retries are too slow; retry immediately instead
- D. The database must be scaled to handle 1,000 concurrent connections

??? success "Answer"
    **B — synchronized waves; add full jitter.**

    Backoff without jitter keeps clients that failed together in lockstep: 1,000 requests at 0.5 s, the survivors at 1.5 s, and so on, each wave above capacity. Full jitter ($\text{random}(0, \text{base} \cdot 2^n)$) spreads them so most succeed in the first round.

---

**Q10.** The `payment` circuit breaker opens several times a day although the provider is healthy. Investigation shows that waves of **declined cards** (bots testing stolen cards) are counted as failures. What should be changed?

- A. Raise the failure threshold to 95%
- B. Remove the circuit breaker
- C. Configure business errors such as "card declined" as ignored exceptions, so only technical failures (errors, timeouts, slow calls) count
- D. Retry declined cards three times

??? success "Answer"
    **C — do not count correct business answers as failures.**

    A declined card is a valid response from a healthy provider. Counting it opens the breaker for every honest fan. Retrying it (D) is never right: the answer is final. Breakers should count technical failures — and slow calls, to catch gray failures.

---

**Q11.** At peak, `order` makes **100 payment calls per second** with a normal latency of **200 ms**. The team sets a payment **bulkhead of 50** concurrent calls. What does that give?

- A. Payment calls are limited to 50 per second
- B. About 20 calls are normally in flight; the bulkhead tolerates latency growing about 2.5× before rejecting, and when payment is very slow at most 50 threads wait on it, leaving the rest for other routes
- C. 50 threads are reserved and always busy
- D. Payment calls will be retried 50 times

??? success "Answer"
    **B — headroom of about 2.5× and a cap on the damage.**

    Little's Law: $100 \times 0.2 = 20$ concurrent calls normally. With 50 permits, latency can reach about 500 ms before calls are rejected. If payment goes to 4 s, at most 50 threads wait (instead of 400), and calls beyond that fail immediately into the fallback while seat holds and the catalog keep working.

---

**Q12.** A team adds a database check to the **liveness** probe of `order`. The database has a 20-second blip. What happens?

- A. Nothing: Kubernetes ignores probes shorter than a minute
- B. Every `order` replica fails liveness at the same time and is restarted; a 20-second database blip becomes a multi-minute outage while all JVMs boot
- C. Only the replica that noticed the blip is restarted
- D. The replicas are removed from the load balancer and added back when the database returns

??? success "Answer"
    **B — a fleet-wide restart.**

    Liveness failure means "restart the container". A shared dependency in liveness makes all replicas fail together. Liveness should only detect a stuck process; readiness removes an instance from the load balancer (D describes readiness) — and even readiness must be used carefully with shared dependencies.

---

## Disaster recovery and chaos

**Q13.** At 22:00 a script deletes every row of `orders` in production. The synchronous standby in another zone replicated the delete. What restores the data, and which objective does the restore time affect?

- A. Promote the standby; it affects the RPO
- B. A point-in-time restore from backups (base backup + WAL replay up to 21:59:59); the restore duration determines the RTO, the archiving delay the RPO
- C. Nothing can restore it: replication is the backup
- D. Fail over to another region; it affects the RPO

??? success "Answer"
    **B — PITR from backups.**

    Replicas (in-zone or cross-region) copy the mistake. Recovering from a logical failure needs a copy from *before* it: a base backup plus archived WAL replayed to the instant before the delete. RPO is bounded by how often WAL is archived; RTO by how long the restore takes — which must be measured (2 TB at 200 MB/s is almost 3 hours).

---

**Q14.** For the BoxOffice purchase path the business asks for **RTO ≤ 15 minutes** and **RPO of seconds** in case of a **regional** outage, at a reasonable cost. Seats must never be sold twice. Which strategy fits best?

- A. Backup and restore in another region
- B. Pilot light with services scaled to zero
- C. Warm standby: databases replicated asynchronously to a second region, a scaled-down copy of the services running there, promoted and scaled up on failover (with fencing of the old primary)
- D. Multi-site active-active with both regions accepting seat holds and replicating to each other

??? success "Answer"
    **C — warm standby.**

    Backup and restore (A) takes hours; pilot light (B) needs services started and scaled from zero, which is hard to fit in 15 minutes reliably. Active-active with writes in both regions (D) risks double-selling a seat unless a globally consistent database or a home region per event is used — at a much higher cost. A warm standby meets RPO (replication lag of seconds) and RTO (detect + decide + promote + scale + DNS TTL), provided it is rehearsed in DR drills.

---

**Q15.** The team wants to verify that the `payment` circuit breaker really protects the catalog. Which plan is a proper **chaos experiment**?

- A. Kill random production pods during the next stadium on-sale and see what happens
- B. State the steady state (catalog p99 < 300 ms, purchase success ≥ 99.9%) and the hypothesis (with 3 s of provider latency the breaker opens within 30 s and catalog latency stays flat); inject the latency with Toxiproxy under k6 load, first in staging, with an abort condition on the burn rate
- C. Write a unit test that mocks the breaker as open
- D. Wait for the next real provider incident and read the postmortem

??? success "Answer"
    **B — hypothesis, controlled injection, small blast radius, abort condition.**

    Chaos engineering is an experiment: predict the steady state, inject one realistic fault, observe the SLIs, compare. A (random failures during an on-sale, no hypothesis, no abort) is reckless; C does not exercise timeouts, pools and real traffic; D is waiting for production to run the experiment for you, at the worst moment.

