
Click **"Answer"** to reveal the correct answer and explanation.

---

## SLI / SLO / SLA / Error Budget

**Q1.** Why is **CPU utilisation** a poor Service Level Indicator (SLI)?

- A. It is too difficult to measure accurately with modern tools
- B. It measures infrastructure state, not user-perceived quality — a service can have 95% CPU and serve all requests correctly, or 5% CPU and be completely down
- C. CPU metrics reset on each container restart, making trending impossible
- D. It is not supported by Prometheus or Grafana

??? success "Answer"
    **B — Measures infrastructure, not user experience.**

    A good SLI reflects whether the user is getting value from the service. CPU utilisation correlates poorly with user experience — a CPU-bound service may still respond correctly, while a service with idle CPU might be down due to a deadlock. Use request success rate, latency percentiles, or error rate instead.

---

**Q2.** For a **99.9% availability** service level objective (SLO) over 28 days, approximately how many minutes of downtime are permitted?

- A. ~4.03 minutes
- B. ~40.3 minutes
- C. ~403 minutes
- D. ~8.77 hours

??? success "Answer"
    **B — ~40.3 minutes.**

    28 days × 24 h × 60 min = 40,320 minutes, and 0.1% of that is ≈ 40.3 minutes. The figure of ~43.8 minutes that appears in many "nines" tables is for an average calendar month (365.25 / 12 ≈ 30.44 days), and 8.77 hours is the budget for a whole year. Always compute the budget for the window the SLO actually uses.

---

**Q3.** What happens to engineering work priorities when the **error budget is exhausted**?

- A. The SLO is automatically relaxed to 99.5% for the remainder of the window
- B. The operations team takes over all deployments until the next window starts
- C. Non-essential deployments are frozen and reliability work takes priority over feature work until the budget recovers
- D. The team pages the on-call engineer who must approve all subsequent commits

??? success "Answer"
    **C — Non-essential deploys frozen; reliability work prioritised.**

    The error budget is the team's licence to take risk. When it is gone, further risky deployments would push the SLO breach from "possible" to "guaranteed." The budget policy creates an objective, data-driven mechanism for the site reliability engineers (SRE) and the product manager (PM) to agree: "we're out of budget in this window, features wait."

---

**Q4.** What is the key distinction between an **SLO** and a **service level agreement (SLA)**?

- A. An SLO applies to APIs; an SLA applies to databases
- B. An SLO is an internal engineering target (stricter); an SLA is a legal contract with customers that carries financial consequences if breached (more lenient)
- C. SLOs are measured in percentages; SLAs are measured in absolute downtime minutes
- D. SLOs expire after 28 days; SLAs are permanent until renegotiated

??? success "Answer"
    **B — SLO = internal target (stricter); SLA = legal contract (more lenient).**

    The gap between SLO and SLA is intentional: if your SLO is 99.95% and your SLA is 99.9%, you can breach your internal target without triggering contractual penalties. This buffer gives the team early warning before the customer-facing commitment is at risk.

---

**Q5.** A burn rate of **14.4×** on a 28-day SLO window means what in practical terms?

- A. The service is performing 14.4× better than the SLO requires
- B. 14.4% of the error budget has been consumed in the last hour
- C. The error budget will be exhausted in exactly 14.4 days
- D. The error budget will be fully consumed in approximately 48 hours — a critical alert requiring immediate response

??? success "Answer"
    **D — Budget exhausted in ~48 hours.**

    Burn rate 1 = consuming the budget at exactly the rate the SLO allows. Burn rate 14.4 = consuming it 14.4× faster. A 28-day budget at 14.4× burn rate is exhausted in 28/14.4 ≈ 1.94 days ≈ 47 hours. This is the threshold where an immediate page is warranted — the incident is moving too fast for next-business-day resolution. (In one hour, a 14.4× burn consumes about 2% of the budget, which is how the SRE Workbook derives the number.)

---

**Q6.** What is the **difference between the mean time to failure (MTTF) and the mean time to repair (MTTR)**, and which lever is faster to improve in a production incident?

- A. MTTF is failure frequency; MTTR is repair time — MTTF is faster to improve
- B. MTTF is mean time to failure (how long before it breaks); MTTR is mean time to repair (how long to fix it) — MTTR is faster to improve during an active incident
- C. They are equivalent; improving one automatically improves the other
- D. MTTF measures software failures; MTTR measures hardware failures

??? success "Answer"
    **B — MTTF = time before failure; MTTR = time to repair; MTTR is faster to improve during an incident.**

    During an active incident, you cannot retroactively prevent the failure: it has already happened. What you control is MTTR: faster detection (alerting), faster diagnosis (runbooks, distributed tracing), and faster mitigation (feature flags, rollback procedures). Long-term, MTTF improves through better testing and fault-tolerant design.

---

**Q7.** The order service's fast-burn page requires the burn rate over **1 hour and over 5 minutes** to be above 14.4 at the same time. What does the 5-minute window add?

- A. It makes the alert fire faster than a 1-hour window alone could
- B. It stops the page a few minutes after the errors stop, instead of letting the 1-hour average keep it firing for most of an hour
- C. It lowers the share of the budget that must be spent before anyone is paged
- D. It filters out errors caused by the clients (`4xx`)

??? success "Answer"
    **B — The short window lets the alert stop soon after the incident.**

    The long window proves that a meaningful share of the budget was spent (14.4× for 1 hour ≈ 2%); the short one proves that it is *still* burning now. Without it, the 1-hour average still contains the bad minutes after the fix: in the page's simulator, the bad deploy keeps a single-window rule paging 58 minutes after the rollback, against 4 minutes with both windows. The short window does not speed up detection (A) — the long window is the stricter one while the incident runs.

---

## Resilience Patterns

**Q8.** What state does a circuit breaker enter after its **wait duration** in the Open state expires?

- A. Closed — it automatically assumes the service has recovered
- B. Failed — it requires manual intervention to reset
- C. Half-Open — it allows a limited number of probe requests to test whether the service has recovered
- D. Degraded — it passes traffic at 50% of the normal rate

??? success "Answer"
    **C — Half-Open.**

    The Open state blocks all requests. After the configured wait duration (e.g., 30 seconds), the breaker moves to Half-Open and allows a small number of probe calls through (Resilience4j moves on the next call, unless the automatic transition is enabled). If their failure and slow-call rates stay below the thresholds, the service has recovered and the breaker closes; otherwise it returns to Open for another wait.

---

**Q9.** Why should you **never retry** a non-idempotent `POST /orders` without additional safeguards?

- A. `POST` is not retryable at the HTTP protocol level
- B. The server will return 405 Method Not Allowed on the second attempt
- C. Each retry may create a duplicate order — retries are only safe for idempotent operations or operations protected by idempotency keys
- D. Circuit breakers block all retries of `POST` requests automatically

??? success "Answer"
    **C — Each retry may create a duplicate order.**

    `POST /orders` creates a new resource on each call. If the request succeeds on the server but the response is lost (network partition), a retry will create a second order. Safe retries for non-idempotent operations require an *idempotency key* — a client-generated unique ID that the server uses to detect and deduplicate replayed requests.

---

**Q10.** What problem does adding **jitter** to exponential backoff solve?

- A. It prevents the backoff delay from growing indefinitely
- B. It ensures all clients use the same retry interval for predictability
- C. It breaks the thundering herd — without jitter, all clients that failed simultaneously retry at the same moments, spiking load on the recovering service
- D. It randomises which backend server handles the retried request

??? success "Answer"
    **C — Breaks the thundering herd.**

    Imagine 1,000 clients all failing at t = 0 and retrying at t = 1 s, 3 s and 7 s in perfect synchrony. Each retry wave hits the recovering service with a massive spike, potentially causing it to fail again. Adding random jitter spreads retries across a time window, converting a spike into a manageable steady stream.

---

**Q11.** Which patterns combine to form a **defence-in-depth** call chain? Select the most complete answer.

- A. Only circuit breaker + timeout — the others add unnecessary complexity
- B. Rate limiter → retry with backoff → circuit breaker → bulkhead → timeout
- C. Load balancer → health check → circuit breaker
- D. Retry with backoff → bulkhead → rate limiter → timeout

??? success "Answer"
    **B — Rate limiter → retry with backoff → circuit breaker → bulkhead → timeout.**

    Each layer handles a distinct failure scenario: the rate limiter refuses excess traffic at the edge before it costs anything; the retry handles transient failures and sits outside the breaker, so an open breaker stops the retries at once; the circuit breaker sees every attempt, timeouts included; the bulkhead caps the threads the attempts can hold; the timeout, innermost, bounds each attempt. This is Resilience4j's default order (`Retry ( CircuitBreaker ( … ( Bulkhead ( call ) ) ) )`) and the order of .NET's standard resilience handler. C and D each miss essential layers.
---

**Q12.** Two gateway replicas, each available 99% of the time and failing independently, sit behind Nginx. Any one replica can serve all traffic. What is the availability of the gateway layer (ignoring Nginx)?

- A. 98.01%
- B. 99%
- C. 99.5%
- D. 99.99%

??? success "Answer"
    **D — 99.99%.**

    In parallel, the layer is down only when *both* replicas are down at the same time: 0.01 × 0.01 = 0.0001, so availability = 1 − 0.0001 = 99.99%. Option A (0.99²) is the formula for components in **series**, where every one must work. The result holds only if the failures are independent — two replicas on the same node or with the same bad configuration fail together.

---

**Q13.** The order service's liveness probe calls the database and fails when it is unreachable. The database is down for 15 seconds. What happens on Kubernetes?

- A. Nothing — Kubernetes ignores liveness failures shorter than one minute
- B. The pods are removed from the Service's endpoints until the database is back, then receive traffic again
- C. Every replica fails liveness at the same time and is restarted, so a short database blip becomes a full outage while all JVMs boot again
- D. Only one replica is restarted, because Kubernetes restarts pods one at a time

??? success "Answer"
    **C — All replicas restart together.**

    Liveness answers "is this process stuck?"; a failure triggers a **restart**. Because every replica depends on the same database, they all fail liveness together and are all restarted, turning a 15-second hiccup into minutes of downtime. Option B describes what a **readiness** failure does. Keep external dependencies out of liveness.

---

**Q14.** The gateway, the order service and its Feign client for the product service each make up to 3 attempts on failed calls. The product service starts failing. How many calls can a single user request generate to the product service in the worst case?

- A. 3
- B. 9
- C. 27
- D. 81

??? success "Answer"
    **C — 27 (3 × 3 × 3).**

    Retries at each layer multiply: each of the gateway's 3 attempts reaches the order service, which makes 3 attempts, each of which the Feign client tries 3 times. This *retry amplification* hits the struggling service hardest exactly when it is weakest. Retry at one layer only, cap attempts, use backoff with jitter and stop retrying when the circuit breaker is open.

---

**Q15.** A client sends `POST /orders` with the header `Idempotency-Key: k-42`. The server creates the order, but the response is lost and the client retries with the same key. What should the server do?

- A. Create a second order, because every `POST` creates a new resource
- B. Return `409 Conflict` and ask the client to generate a new key
- C. Recognise the key as already processed and return the result of the first request without creating another order
- D. Delete the first order and create a new one to keep the data consistent

??? success "Answer"
    **C — Return the stored result for the same key.**

    The idempotency key identifies one *logical* operation. The server stores the keys it has processed (with their results), so a repeated key returns the original response instead of duplicating the order. This makes a non-idempotent `POST` safe to retry.

---

**Q16.** The gateway waits at most **3 s** for the order service. The order service calls product with a read timeout of 1 s, 3 attempts and waits of 0.5 s then 1 s. What happens when product stops answering?

- A. Nothing goes wrong: each attempt is bounded by 1 s
- B. The order service needs up to 4.5 s, so the gateway answers `504` at 3 s while the order service keeps retrying for nobody
- C. The gateway retries too, so the client waits 9 s
- D. The circuit breaker opens after the first attempt

??? success "Answer"
    **B — 1 + 0.5 + 1 + 1 + 1 = 4.5 s, longer than the 3 s anyone waits.**

    Timeouts nest: attempts × timeout + waits must fit inside the caller's deadline. Here the third attempt runs after the gateway has given up — wasted work and extra load on a struggling service. Fit the budget: 2 attempts (2.5 s), a shorter read timeout, or a deadline propagated with the request.

---

**Q17.** A breaker is configured with `slow-call-duration-threshold: 2s`, while the Feign read timeout is 1 s. Product starts answering in 3 s. What does the slow-call rule do?

- A. It opens the breaker after 2 s
- B. Nothing: no call ever completes after 2 s — each fails at 1 s as a timeout — so no call is ever counted as slow; only the failure rate can open the breaker
- C. It doubles the read timeout to 2 s
- D. It counts every call as both slow and failed, opening the breaker twice as fast

??? success "Answer"
    **B — A slow-call threshold above the timeout never sees a slow call.**

    The slow-call threshold must sit **below** the timeout (the page uses 500 ms with a 1 s timeout), so the breaker can react to calls that are slow but still complete. Remember also that slow calls have their own rate (`slow-call-rate-threshold`, default 100%): they are not added to the failure rate.

---

## Chaos Engineering

**Q18 (bonus).** The first Principle of Chaos Engineering requires establishing a **steady state** before injecting failures. What does "steady state" refer to?

- A. A deployment freeze where no code changes are made during the experiment
- B. A measurable baseline of normal system behaviour expressed as SLIs — request rate, error rate, latency — against which the experiment's impact is evaluated
- C. A state where all services are running at exactly 50% capacity
- D. The configuration of the system at the last known-good deployment

??? success "Answer"
    **B — Measurable SLI baseline.**

    You cannot determine whether injecting a failure caused degradation unless you know what "normal" looks like. The steady-state hypothesis is: *"Even with condition X injected, the system will continue to exhibit [specific SLI values]."* Falsifying the hypothesis is a finding — the system does not handle that condition as designed.
