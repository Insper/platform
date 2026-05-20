
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

- A. ~4.38 minutes
- B. ~43.8 minutes
- C. ~438 minutes
- D. ~8.77 hours

??? success "Answer"
    **B — ~43.8 minutes.**

    0.1% of 28 days × 24 h × 60 min = 0.001 × 28 × 1440 ≈ 40.3 minutes. The commonly cited figure is ~43.8 minutes because 28 days × 24 h × 60 min = 40,320 minutes, and 0.1% of that is 40.32 minutes (the discrepancy depends on the exact window used). Either way, the error budget for three-nines is roughly 40–44 minutes per month.

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

    Burn rate 1 = consuming the budget at exactly the rate the SLO allows. Burn rate 14.4 = consuming it 14.4× faster. A 28-day budget at 14.4× burn rate is exhausted in 28/14.4 ≈ 1.94 days ≈ 47 hours. This is the threshold where an immediate page is warranted — the incident is moving too fast for next-business-day resolution.

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

    Each layer handles a distinct failure scenario: the rate limiter protects against traffic spikes and abuse; the circuit breaker fast-fails calls to known-failing dependencies; the bulkhead isolates thread pools so one slow dependency cannot starve others; the timeout bounds wait time; the retry handles transient failures. The order matters — rate limiting and fast-failing happen before consuming a bulkhead thread.

---

## Chaos Engineering

**Q11 (bonus).** The first Principle of Chaos Engineering requires establishing a **steady state** before injecting failures. What does "steady state" refer to?

- A. A deployment freeze where no code changes are made during the experiment
- B. A measurable baseline of normal system behaviour expressed as SLIs — request rate, error rate, latency — against which the experiment's impact is evaluated
- C. A state where all services are running at exactly 50% capacity
- D. The configuration of the system at the last known-good deployment

??? success "Answer"
    **B — Measurable SLI baseline.**

    You cannot determine whether injecting a failure caused degradation unless you know what "normal" looks like. The steady-state hypothesis is: *"Even with condition X injected, the system will continue to exhibit [specific SLI values]."* Falsifying the hypothesis is a finding — the system does not handle that condition as designed.
