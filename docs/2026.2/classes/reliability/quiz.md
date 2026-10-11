
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

**Q2.** For a **99.9% availability SLO** over 28 days, approximately how many minutes of downtime are permitted?

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
- C. Non-essential deployments are frozen and reliability work takes priority over feature work until the budget resets
- D. The team pages the on-call engineer who must approve all subsequent commits

??? success "Answer"
    **C — Non-essential deploys frozen; reliability work prioritised.**

    The error budget is the team's licence to take risk. When it is gone, further risky deployments would push the SLO breach from "possible" to "guaranteed." The budget policy creates an objective, data-driven mechanism for the SRE and PM to agree: "we're out of budget this month, features wait."

---

**Q4.** What is the key distinction between an **SLO** and an **SLA**?

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

**Q6.** What is the **difference between MTTF and MTTR**, and which lever is faster to improve in a production incident?

- A. MTTF is failure frequency; MTTR is repair time — MTTF is faster to improve
- B. MTTF is mean time to failure (how long before it breaks); MTTR is mean time to repair (how long to fix it) — MTTR is faster to improve during an active incident
- C. They are equivalent; improving one automatically improves the other
- D. MTTF measures software failures; MTTR measures hardware failures

??? success "Answer"
    **B — MTTF = time before failure; MTTR = time to repair; MTTR is faster to improve during an incident.**

    During an active incident, you cannot retroactively prevent the failure (MTTF is already 0 — it happened). What you control is MTTR: faster detection (alerting), faster diagnosis (runbooks, distributed tracing), and faster mitigation (feature flags, rollback procedures). Long-term, MTTF improves through better testing and fault-tolerant design.

---

## Resilience Patterns

**Q7.** What state does a circuit breaker enter after its **wait timeout** expires while in the Open state?

- A. Closed — it automatically assumes the service has recovered
- B. Failed — it requires manual intervention to reset
- C. Half-Open — it allows a limited number of probe requests to test whether the service has recovered
- D. Degraded — it passes traffic at 50% of the normal rate

??? success "Answer"
    **C — Half-Open.**

    The Open state blocks all requests. After a configured wait timeout (e.g., 30 seconds), the breaker moves to Half-Open and allows a small number of probe requests through. If they succeed, the service has recovered and the breaker closes. If they fail, the service is still down and the breaker returns to Open.

---

**Q8.** Why should you **never retry** a non-idempotent `POST /orders` without additional safeguards?

- A. `POST` is not retryable at the HTTP protocol level
- B. The server will return 405 Method Not Allowed on the second attempt
- C. Each retry may create a duplicate order — retries are only safe for idempotent operations or operations protected by idempotency keys
- D. Circuit breakers block all retries of `POST` requests automatically

??? success "Answer"
    **C — Each retry may create a duplicate order.**

    `POST /orders` creates a new resource on each call. If the request succeeds on the server but the response is lost (network partition), a retry will create a second order. Safe retries for non-idempotent operations require an *idempotency key* — a client-generated unique ID that the server uses to detect and deduplicate replayed requests.

---

**Q9.** What problem does adding **jitter** to exponential backoff solve?

- A. It prevents the backoff delay from growing indefinitely
- B. It ensures all clients use the same retry interval for predictability
- C. It breaks the thundering herd — without jitter, all clients that failed simultaneously retry at the same moments, spiking load on the recovering service
- D. It randomises which backend server handles the retried request

??? success "Answer"
    **C — Breaks the thundering herd.**

    Imagine 1,000 clients all failing at t=0 and retrying at t=1s, t=2s, t=4s in perfect synchrony. Each retry wave hits the recovering service with a massive spike, potentially causing it to fail again. Adding random jitter spreads retries across a time window, converting a spike into a manageable steady stream.

---

**Q10.** Which patterns combine to form a **defence-in-depth** call chain? Select the most complete answer.

- A. Only circuit breaker + timeout — the others add unnecessary complexity
- B. Rate limiter → circuit breaker → bulkhead → timeout → retry with backoff
- C. Load balancer → health check → circuit breaker
- D. Retry with backoff → bulkhead → rate limiter → timeout

??? success "Answer"
    **B — Rate limiter → circuit breaker → bulkhead → timeout → retry with backoff.**

    Each layer handles a distinct failure scenario: the rate limiter protects against traffic spikes and abuse; the circuit breaker fast-fails calls to known-failing dependencies; the bulkhead isolates thread pools so one slow dependency cannot starve others; the timeout bounds wait time; the retry handles transient failures. In the layering shown in class, rate limiting and fast-failing happen before consuming a bulkhead thread. Libraries may nest them differently — Resilience4j's default puts Retry outermost so each attempt passes through the breaker — but the set of layers is the same, and C and D each miss essential ones.

---

**Q11.** Two gateway replicas, each available 99% of the time and failing independently, sit behind Nginx. Any one replica can serve all traffic. What is the availability of the gateway layer (ignoring Nginx)?

- A. 98.01%
- B. 99%
- C. 99.5%
- D. 99.99%

??? success "Answer"
    **D — 99.99%.**

    In parallel, the layer is down only when *both* replicas are down at the same time: 0.01 × 0.01 = 0.0001, so availability = 1 − 0.0001 = 99.99%. Option A (0.99²) is the formula for components in **series**, where every one must work. The result holds only if the failures are independent — two replicas on the same node or with the same bad configuration fail together.

---

**Q12.** The order service's liveness probe calls the database and fails when it is unreachable. The database is down for 15 seconds. What happens on Kubernetes?

- A. Nothing — Kubernetes ignores liveness failures shorter than one minute
- B. The pods are removed from the Service's endpoints until the database is back, then receive traffic again
- C. Every replica fails liveness at the same time and is restarted, so a short database blip becomes a full outage while all JVMs boot again
- D. Only one replica is restarted, because Kubernetes restarts pods one at a time

??? success "Answer"
    **C — All replicas restart together.**

    Liveness answers "is this process stuck?"; a failure triggers a **restart**. Because every replica depends on the same database, they all fail liveness together and are all restarted, turning a 15-second hiccup into minutes of downtime. Option B describes what a **readiness** failure does. Keep external dependencies out of liveness.

---

**Q13.** The gateway, the order service and its Feign client for the product service each retry failed calls up to 3 times. The product service starts failing. How many calls can a single user request generate to the product service in the worst case?

- A. 3
- B. 9
- C. 27
- D. 81

??? success "Answer"
    **C — 27 (3 × 3 × 3).**

    Retries at each layer multiply: each of the gateway's 3 attempts reaches the order service, which makes 3 attempts, each of which the Feign client tries 3 times. This *retry amplification* hits the struggling service hardest exactly when it is weakest. Retry at one layer only, cap attempts, use backoff with jitter and stop retrying when the circuit breaker is open.

---

**Q14.** A client sends `POST /orders` with the header `Idempotency-Key: k-42`. The server creates the order, but the response is lost and the client retries with the same key. What should the server do?

- A. Create a second order, because every `POST` creates a new resource
- B. Return `409 Conflict` and ask the client to generate a new key
- C. Recognise the key as already processed and return the result of the first request without creating another order
- D. Delete the first order and create a new one to keep the data consistent

??? success "Answer"
    **C — Return the stored result for the same key.**

    The idempotency key identifies one *logical* operation. The server stores the keys it has processed (with their results), so a repeated key returns the original response instead of duplicating the order. This makes a non-idempotent `POST` safe to retry.

---

## Chaos Engineering

**Q15 (bonus).** The first Principle of Chaos Engineering requires establishing a **steady state** before injecting failures. What does "steady state" refer to?

- A. A deployment freeze where no code changes are made during the experiment
- B. A measurable baseline of normal system behaviour expressed as SLIs — request rate, error rate, latency — against which the experiment's impact is evaluated
- C. A state where all services are running at exactly 50% capacity
- D. The configuration of the system at the last known-good deployment

??? success "Answer"
    **B — Measurable SLI baseline.**

    You cannot determine whether injecting a failure caused degradation unless you know what "normal" looks like. The steady-state hypothesis is: *"Even with condition X injected, the system will continue to exhibit [specific SLI values]."* Falsifying the hypothesis is a finding — the system does not handle that condition as designed.
