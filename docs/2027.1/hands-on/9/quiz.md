Click **"Answer"** to reveal the correct answer and explanation.

---

## Cascading failures and timeouts

**Q1.** `order` has 50 threads. Payments arrive at 20 per second and `payment` suddenly takes 3 s to answer. `GET /orders/{id}` does not call `payment`. What happens to it, and why?

- A. Nothing: it does not depend on `payment`
- B. It slows down and times out too: 20/s × 3 s = 60 threads would be needed just to wait on `payment`, more than the 50 available, so every request queues
- C. It becomes faster, because payments are slow and leave the CPU idle
- D. It fails only if the database is also slow

??? success "Answer"
    **B — thread exhaustion: a cascading failure.**

    By Little's Law, concurrency = arrival rate × time in the system. Calls that wait on a slow dependency hold threads; when the pool is exhausted, requests that never touch the dependency queue behind them. The k6 `browse` scenario exists to make this collateral damage visible.

---

**Q2.** Why is a timeout the first protection to add?

- A. It makes the dependency faster
- B. It turns a slow failure into a fast failure: each call holds a thread for at most the timeout, which bounds the concurrency spent on that dependency
- C. It retries automatically
- D. It is required by HTTP/1.1

??? success "Answer"
    **B — bounded waiting.**

    With a 1 s read timeout, 20 payments/s hold at most about 20 threads, regardless of how slow `payment` gets. The price: calls that would have succeeded in 1.5 s now fail. Java HTTP clients wait forever by default, so a missing timeout is the most common root cause of cascades.

---

**Q3.** The edge times out after 5 s, the gateway after 10 s, and `order` waits for `payment` up to 3 retries × 4 s. What is wrong?

- A. Nothing; longer inner timeouts are safer
- B. Inner budgets exceed outer ones: the edge gives up while `order` and the gateway keep working on requests nobody is waiting for. Budgets must shrink at each hop
- C. The gateway timeout should be 0
- D. Retries should be infinite to guarantee success

??? success "Answer"
    **B — timeout budgets must decrease from the outside in.**

    Work done after the caller has given up is pure waste — and it holds threads and connections. A consistent budget is something like edge 10 s > gateway 5 s > order→payment (1 s × 3 attempts + backoff).

---

## Retries and idempotency

**Q4.** One attempt to call `payment` fails with probability 0.2, independently. With `max-attempts: 3`, what is the probability that a payment fails?

- A. 0.6
- B. 0.2
- C. 0.008
- D. 0.04

??? success "Answer"
    **C — 0.2³ = 0.008 (0.8%).**

    A call fails only if all three attempts fail. Retries are very effective against independent, transient errors — and useless (or harmful) against persistent ones: if `payment` is down, three attempts just triple the load and the latency.

---

**Q5.** Why does `PaymentClient` send `Idempotency-Key: order-<id>` on every attempt?

- A. To authenticate `order` against `payment`
- B. So that a retry of a call whose response was lost (but which succeeded) does not charge the fan twice: `payment` and the provider return the first result for a known key
- C. To make the circuit breaker count calls per order
- D. Because HTTP requires it for `POST`

??? success "Answer"
    **B — retries are only safe on idempotent operations.**

    A timeout does not mean the call failed — the charge may have succeeded and only the response was lost. Without an idempotency key, the retry creates a second charge. With it, the second request finds the key (`UNIQUE` in `payments`, forwarded to the provider) and gets the original result.

---

**Q6.** What problem does **jitter** (randomized wait) solve in retry backoff?

- A. It reduces the number of retries
- B. It prevents clients that failed at the same moment from retrying at the same moment, which would create synchronized waves of load on a recovering dependency
- C. It makes timeouts shorter
- D. It encrypts the retry requests

??? success "Answer"
    **B — desynchronizing retries.**

    Exponential backoff alone spreads attempts over time, but all clients follow the same schedule: an outage that hits 1 000 clients at once produces waves of 1 000 retries at +200 ms, +400 ms… Adding ±50% randomness turns the waves into a smoother stream. The `retry-storm` playground scenario shows the amplification.

---

## Circuit breaker and bulkhead

**Q7.** The circuit breaker has `minimum-number-of-calls: 10`, `failure-rate-threshold: 50` and `wait-duration-in-open-state: 10s`. `payment` goes down. What does the breaker do?

- A. Retries forever until `payment` returns
- B. After at least 10 recorded calls with ≥ 50% failures it opens: for 10 s calls fail immediately with `CallNotPermittedException`; then it goes half-open and lets a few trial calls through to decide whether to close
- C. Restarts `payment`
- D. Sends all calls to a backup `payment` instance

??? success "Answer"
    **B — closed → open → half-open → closed (or open again).**

    The open state saves the caller's threads and time, and gives the dependency room to recover instead of a flood of doomed calls. Half-open probing detects recovery automatically. A breaker does not repair anything — it limits the damage.

---

**Q8.** Why is `CallNotPermittedException` in the retry's `ignore-exceptions`?

- A. Because Resilience4j cannot retry it technically
- B. Because when the circuit is open, retrying immediately is pointless and only adds latency; the call should fail fast to the fallback
- C. Because it is a checked exception
- D. Because the bulkhead handles it

??? success "Answer"
    **B — an open circuit is a decision, not a transient error.**

    With the default aspect order Retry(CircuitBreaker(Bulkhead(call))), the retry sees the breaker's rejection. Retrying it would just collect three rejections and backoff delays. Ignoring it sends the request straight to the fallback — fast and honest.

---

**Q9.** Calls to `payment` succeed but take 700 ms, below both the read timeout and the slow-call threshold. At 70 payments/s, `order`'s 50 threads are nearly all busy and `GET /orders/{id}` slows down. Which pattern fixes this?

- A. A shorter timeout
- B. More retries
- C. A bulkhead: limit the concurrent calls to `payment` (e.g. 10), rejecting the excess immediately so the rest of the threads keep serving other endpoints
- D. A larger circuit breaker window

??? success "Answer"
    **C — a bulkhead caps the concurrency one dependency may use.**

    Nothing is failing, so neither timeout nor breaker reacts. 70/s × 0.7 s ≈ 49 concurrent calls fill the pool. The bulkhead reserves the remaining capacity for everything else; some payments get a fast `503`, which is better than the whole service slowing down.

---

**Q10.** In `PaymentGateway`, why is the `fallbackMethod` on `@Retry` and not on `@CircuitBreaker`?

- A. Because `@CircuitBreaker` does not support fallbacks
- B. Because Retry is the outermost aspect: a fallback on the inner circuit breaker would convert every failure into the fallback's exception before the retry could see — and retry — the original transient error
- C. Because fallbacks must be on the first annotation in the source file
- D. There is no difference

??? success "Answer"
    **B — the fallback belongs on the outermost layer.**

    Resilience4j's default order is Retry(CircuitBreaker(RateLimiter(TimeLimiter(Bulkhead(call))))). A fallback replaces the exception of the layer it decorates. On the inner breaker, a `ResourceAccessException` would become `PaymentUnavailableException`, which is not in `retry-exceptions`: the retry would silently stop working.

---

## Chaos and game days

**Q11.** Why does `OrderService.pay` call `payment` **outside** a database transaction?

- A. Because JDBC does not allow HTTP calls inside transactions
- B. Because a transaction holds a database connection: waiting 3 s on `payment` inside it would move the exhaustion from Tomcat threads to the connection pool, affecting every query of `order`
- C. To make the payment faster
- D. Because Resilience4j requires it

??? success "Answer"
    **B — never hold scarce resources while waiting on a remote call.**

    The pool has ~10 connections; a few slow payments inside transactions would starve all other queries. The remote call runs first, then a short transaction updates the status (`WHERE status = 'PENDING_PAYMENT'` keeps it idempotent) and writes the outbox event.

---

**Q12.** What is the purpose of the **steady-state hypothesis** in a game day?

- A. To prove the system never fails
- B. To state, before injecting a failure, the measurable behavior the system should keep (e.g. `browse` p95 < 200 ms while `payment` is slow), so that the result is a clear confirmation or refutation
- C. To schedule the game day when traffic is steady
- D. To decide who is to blame for failures

??? success "Answer"
    **B — no hypothesis, no experiment.**

    Chaos engineering is an experiment: baseline, hypothesis, injection, observation, conclusion. A refuted hypothesis (the system did *not* behave as designed) is the most valuable outcome — found on a Tuesday afternoon instead of during the next flash sale. The review is blameless: it fixes systems and processes, not people.

[Back to the lab](index.md){ .md-button }
