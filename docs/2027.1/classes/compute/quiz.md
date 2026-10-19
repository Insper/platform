Click **"Answer"** to reveal the correct answer and explanation.

---

## Stateless servers and scaling

**Q1.** BoxOffice's first `inventory` version keeps seat holds in a `ConcurrentHashMap` inside each replica. Everything works on a developer laptop. What happens with three replicas behind a round-robin load balancer?

- A. A fan's next request may reach a replica that does not know the hold, a restart forgets every hold, and two replicas can hold the same seat for different fans
- B. Nothing changes: each replica has its own map, so holds are three times faster
- C. The load balancer automatically synchronizes the three maps
- D. Only performance degrades, because the maps must be copied between replicas

??? success "Answer"
    **A — The state is stuck in one process.**

    A stateless replica keeps nothing another replica would need. The hold is shared state with an invariant ("one seat, one hold"), so it must live in a store that enforces it — a PostgreSQL row with a unique constraint, or a Redis key set with `NX` and an expiry. Sticky sessions would only hide part of the problem and still lose holds on restarts.

---

**Q2.** One `catalog` replica completes at most **500 requests/s**. The peak is **6,000 requests/s** and the team targets **60% utilization**, plus one spare replica. How many replicas?

- A. 12
- B. 20
- C. 21
- D. 24

??? success "Answer"
    **C — 21 replicas.**

    At the target, each replica should serve 500 × 0.6 = 300 requests/s, so 6,000 / 300 = 20 replicas, plus one spare = **21**. Option A (12) is the count at 100% utilization (6,000 / 500), which leaves no headroom: latency explodes near saturation and losing one replica means overload. Option B forgets the spare.

---

**Q3.** Why do teams target **50–70% utilization** on app servers instead of running them close to 100%?

- A. Cloud providers charge more for CPUs above 70%
- B. Queueing delay grows sharply as utilization approaches 100%, so headroom keeps latency (especially the tail) low and absorbs bursts and replica failures
- C. The JVM garbage collector does not run above 70% CPU
- D. Load balancers stop sending traffic to replicas above 70% utilization

??? success "Answer"
    **B — Latency is not linear in load.**

    In a queue, waiting time grows like 1 / (1 − ρ): at 50% utilization a request waits about as long as its service time, at 90% about ten times as long, and the p99 degrades even earlier. The headroom also covers bursts and the loss of a replica or a zone.

---

## Services and boundaries

**Q4.** BoxOffice has three teams and one Spring Boot codebase. Which situation is the **strongest** reason to extract `inventory` into its own service?

- A. The codebase has more than 100,000 lines
- B. A new developer prefers Kotlin
- C. Microservices are the modern standard
- D. During on-sale, `inventory` is write-hot and needs strong consistency and its own scaling and tuning, while `catalog` is read-heavy and cacheable; one team owns inventory and must release independently

??? success "Answer"
    **D — A real force: different scaling/consistency profile and team autonomy.**

    Size alone (A) and fashion (C) are not reasons; a language preference (B) is weak. Splitting pays off when you can name the force — independent scaling, team autonomy, failure isolation, compliance scope, different technology — and that force tells you where to cut.

---

**Q5.** In BoxOffice, the word *Event* means "artist, date, venue, images" in the catalog and "seat map, sections, holds" in inventory. What does DDD recommend?

- A. Let each **bounded context** have its own `Event` model, exchanging ids and events between contexts
- B. Create one shared `Event` class in a common library used by all services
- C. Rename one of them so the word is unique across the company
- D. Store everything in one `events` table that both services read and write

??? success "Answer"
    **A — One model per bounded context.**

    A bounded context is the boundary inside which one model and one meaning of each word apply. A shared class (B) or a shared table (D) couples the teams and produces a bloated model — the classic path to a distributed monolith. Contexts reference each other by id and communicate through APIs and events.

---

**Q6.** The `payment` service talks to an external provider whose API uses statuses such as `requires_action` and `processing`. Where should those strings appear in BoxOffice's code?

- A. Everywhere a payment status is checked, so developers learn the provider's vocabulary
- B. In the database, as the payment status column values
- C. Only inside the provider **adapter** (anti-corruption layer), which translates them into BoxOffice's own payment states behind a port such as `PaymentGateway`
- D. In the front-end, which shows them to the fan

??? success "Answer"
    **C — Inside the adapter only.**

    The port (`PaymentGateway`) belongs to the core and speaks BoxOffice's language; the adapter is the only class that knows the provider's API. This keeps use-case tests independent of the provider and makes adding a second provider a new adapter instead of a rewrite.

---

## API styles

**Q7.** The internal `order` service calls `inventory` thousands of times per second during on-sale; both are owned by BoxOffice. Which style fits best, and what is its main operational catch?

- A. GraphQL; the catch is that it cannot be used between services
- B. Webhooks; the catch is that they need signatures
- C. REST with XML; the catch is payload size
- D. gRPC; the catch is that its long-lived HTTP/2 connections defeat L4 load balancing, so you need an L7 proxy, a mesh or client-side balancing

??? success "Answer"
    **D — gRPC, with L7 or client-side load balancing.**

    gRPC gives generated typed clients, compact protobuf payloads, multiplexing and deadlines — ideal for internal high-volume calls. Because all calls from one client share one HTTP/2 connection, an L4 balancer pins them to one replica; balance per request with Envoy, a service mesh, or client-side load balancing.

---

**Q8.** Which change to a public REST API is **breaking**?

- A. Adding a new optional query parameter `?city=`
- B. Adding the field `doorsOpenAt` to the event response
- C. Changing `price` from reais (`450.00`) to cents (`45000`) in the same field
- D. Adding a new endpoint `GET /v1/venues/{id}`

??? success "Answer"
    **C — Changing a field's meaning.**

    Existing clients would show prices 100 times too high without any error. Additions (A, B, D) are compatible as long as clients are tolerant readers that ignore unknown fields. A breaking change needs a new version (or a new field) and an expand-and-contract migration.

---

**Q9.** A mobile event page built on GraphQL lists 20 events, each with its `availability` resolved by the `inventory` service. Latency is poor and `inventory` receives 21 calls per page view. What is the problem and the usual fix?

- A. The N+1 problem; batch the 20 lookups into one call with a DataLoader
- B. Over-fetching; switch to REST
- C. Missing indexes in the catalog database
- D. GraphQL cannot call other services; move the data into the BFF's own database

??? success "Answer"
    **A — N+1, fixed with batching (DataLoader).**

    One query for the list plus one resolver call per item is the N+1 pattern. A DataLoader collects the ids requested during one execution step and resolves them in a single batched call (and caches them per request).

---

## Async work

**Q10.** After the on-sale opens, 100 orders/s arrive for ticket rendering; each job takes 0.8 s of one worker. There are 40 workers. After 10 minutes of peak, approximately how large is the backlog?

- A. 0 — 40 workers are enough
- B. 3,000 jobs
- C. 30,000 jobs
- D. 60,000 jobs

??? success "Answer"
    **C — about 30,000 jobs.**

    40 workers / 0.8 s = 50 jobs/s of capacity. The backlog grows at 100 − 50 = 50 jobs/s; over 600 s that is 30,000 jobs. Keeping up would need 100 × 0.8 = 80 workers (Little's law) — and only if the downstream (e.g. the e-mail provider's rate limit) allows it.

---

**Q11.** `inventory` runs 10 replicas, and a `@Scheduled(fixedRate = 30_000)` method releases expired holds. What is wrong, and what does a correct fix require?

- A. Nothing is wrong; Spring runs scheduled methods on one replica only
- B. The job runs on all 10 replicas; a distributed lock with an expiry (e.g. ShedLock) reduces duplicates, but because locks can expire during a pause, the release itself must also be idempotent (a conditional `UPDATE`) or fenced
- C. The job runs 10 times; using a bigger replica fixes it
- D. The job never runs, because `@Scheduled` is disabled in containers

??? success "Answer"
    **B — Runs N times; locks alone are not a correctness guarantee.**

    Spring schedules the method in every replica. A CronJob, a lock or leader election stops the duplication in the normal case, but a lock holder that pauses past the lock expiry can run concurrently with the next holder. Correctness comes from idempotent, conditional writes (`... WHERE status = 'ACTIVE' AND expires_at < now()`) or fencing tokens.

---

## Serverless and autoscaling

**Q12.** A function handles 1,500 requests/s with an average duration of 200 ms on AWS Lambda (one request per execution environment). How many concurrent environments does it need, and what risk does that create for a PostgreSQL database behind it?

- A. 30 environments; no risk
- B. 1,500 environments; one per request per second
- C. 7,500 environments; Lambda will reject the requests
- D. 300 environments; up to 300 simultaneous database connections unless a pooler (RDS Proxy, PgBouncer) or reserved concurrency limits them

??? success "Answer"
    **D — 300 concurrent environments.**

    Concurrency = rate × duration = 1,500 × 0.2 = 300 (Little's law). Each environment typically opens its own database connection, so the function tier can exhaust the database's connections; put a pooler in between or cap the function with reserved concurrency.

---

**Q13.** A stadium on-sale opens at 10:00 and traffic jumps 20× within seconds. The Kubernetes HPA targets 60% CPU. Why do fans still see errors in the first minutes, and what is the best mitigation for this **known** event?

- A. Reactive scaling needs metrics, a decision, possibly new nodes, image pulls and JVM warm-up — minutes in total; scale on a **schedule** (e.g. at 09:45) to the forecast and pre-warm caches and pools
- B. The HPA is broken; replace it with a VPA
- C. CPU is the wrong metric for every service; scale on latency instead
- D. Set `maxReplicas` to 1,000 so the HPA can react faster

??? success "Answer"
    **A — Autoscaling lag; pre-scale on a schedule.**

    Each step of reactive scaling is small, but together they take one to a few minutes, while the spike arrives in seconds. For announced peaks, raise the minimum ahead of time; for unknown spikes, rely on headroom, a waiting room and load shedding. Raising `maxReplicas` (D) does not make scaling faster and may overload the database.

---

## External integrations

**Q14.** `payment` calls the provider to create a charge; the call **times out**. What should the service do?

- A. Mark the payment as failed and release the fan's seats
- B. Mark the payment as succeeded, since most charges succeed
- C. Mark it `UNKNOWN`, then retry with the **same idempotency key** or query the provider's status, and also accept the outcome by webhook
- D. Retry immediately with a new idempotency key so the provider does not reject it as a duplicate

??? success "Answer"
    **C — The outcome is unknown; resolve it safely.**

    A timeout after sending means the charge may or may not exist. Failing (A) releases seats of a fan who may have been charged; succeeding (B) gives tickets that may not be paid. A new key (D) is exactly how double charges happen. The same key makes the retry safe: the provider returns the original payment if it was created.

---

**Q15.** Which webhook receiver design is correct?

- A. Parse the JSON, re-serialize it, verify the HMAC on the result, process the payment inline, then answer `200`
- B. Answer `500` to duplicate events so the provider stops sending them
- C. Skip signature verification if the request comes over HTTPS
- D. Verify the HMAC over the **raw body** (with the timestamp and a constant-time comparison), store the event with a unique event id, enqueue it, answer `2xx` immediately, and apply it in a worker as a monotonic state transition

??? success "Answer"
    **D — Verify, deduplicate, acknowledge fast, process asynchronously.**

    Re-serialized JSON (A) changes bytes and breaks the signature; inline processing causes provider timeouts and retries. HTTPS (C) protects the channel, not the sender's identity. Answering `500` (B) makes the provider retry *more*. Duplicates should get a `2xx` and be ignored.

---

**Q16 (bonus).** Webhooks and idempotency keys are in place. Why does BoxOffice still run a **reconciliation** job against the provider's reports?

- A. To recalculate the exchange rate of every payment
- B. Because the provider requires it for the API key to stay valid
- C. Because webhooks can be lost after the provider's retries, refunds can be made in the provider's dashboard, bugs can skip updates, and fees and chargebacks appear only in reports — the two sides must be compared and differences resolved
- D. Reconciliation is only needed when there is no idempotency

??? success "Answer"
    **C — Per-interaction safety does not guarantee that the books agree.**

    Reconciliation compares BoxOffice's payments with the provider's records (a near-real-time sweeper for stuck payments plus a daily report check), fixes the known mismatch types automatically (e.g. confirm or refund a payment whose webhook was lost) and sends the rest to an exception queue.
