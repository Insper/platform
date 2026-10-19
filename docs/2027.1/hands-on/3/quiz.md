Click **"Answer"** to reveal the correct answer and explanation.

---

**Q1.** Why can `catalog` be scaled to three replicas without changing its code (except the `X-Instance` header)?

- A. Spring Boot replicates memory between instances
- B. It is **stateless**: every request carries all it needs, and all shared state lives in PostgreSQL, so any replica can answer any request
- C. Nginx copies the session to every replica
- D. Docker Compose synchronizes the replicas

??? success "Answer"
    **B — Stateless services scale horizontally.**

    If a replica kept user data in memory (a session, a shopping cart), requests would have to return to the same replica (sticky sessions) and a crash would lose data. Pushing state into a database or cache is the precondition for easy scale-out.

---

**Q2.** With the default Nginx upstream configuration, how are requests distributed?

- A. Randomly
- B. Round robin: each replica in turn
- C. To the replica with the lowest CPU
- D. By hashing the client IP

??? success "Answer"
    **B — Round robin.**

    That is why 9 requests give 3 per replica. `least_conn` (fewest active connections), `ip_hash`/`hash` (affinity) and `random two least_conn` (power of two choices) are alternatives, chosen with one directive.

---

**Q3.** `catalog-3` is **paused** (frozen) while k6 sends 150 req/s. What do the clients experience?

- A. Immediate `502` errors
- B. Nothing at all
- C. A burst of requests that take about `proxy_read_timeout` (5 s) before Nginx retries them on another replica, then normal latency once the replica is marked failed
- D. All requests fail until the replica is unpaused

??? success "Answer"
    **C — Slow failures cost a timeout each.**

    A frozen process accepts the TCP connection but never answers, so Nginx can only detect it by waiting. After `max_fails` it stops sending traffic for `fail_timeout`. A crashed replica, by contrast, refuses the connection and the retry is immediate.

---

**Q4.** Why is `proxy_next_upstream` safe for `GET /catalog/events/1` but not by default for a `POST`?

- A. POST bodies are too large to resend
- B. GET is idempotent: repeating it has no extra effect; a POST might already have been processed by the first replica, and resending it could, for example, create two orders
- C. Nginx cannot proxy POST requests
- D. HTTP forbids retries

??? success "Answer"
    **B — Only retry idempotent requests.**

    A timeout does not tell you whether the server did the work. Retrying non-idempotent operations needs an idempotency key (class 5, lab 9). Nginx retries non-idempotent methods only with `non_idempotent` explicitly set.

---

**Q5.** Why not set `proxy_read_timeout 100ms` to detect frozen replicas faster?

- A. Nginx does not accept values below 1 s
- B. Legitimate slow requests (a listing under load) would be treated as failures and retried, adding load exactly when the system is struggling
- C. It would disable keep-alive
- D. It only applies to POST

??? success "Answer"
    **B — Timeouts come from measured latency.**

    Set them slightly above the healthy p99.9 of the endpoint. Too long and a slow replica hurts many requests; too short and you create failures and retry storms out of normal slowness.

---

**Q6.** The `greedy` client sends 50 req/s for 30 s with a limit of 20 r/s and `burst=40 nodelay`. About how many requests succeed?

- A. 600
- B. 640
- C. 1,500
- D. 40

??? success "Answer"
    **B — ≈ 640.**

    20 req/s × 30 s = 600 allowed by the rate, plus the burst of 40 served immediately at the start. The other ≈ 860 get `429 Too Many Requests` — cheaply, at the edge, without touching the replicas.

---

**Q7.** Why does the lab key the rate limit on `X-Api-Key` and not on the client IP?

- A. Nginx cannot read IP addresses
- B. All k6 traffic comes from one IP, so an IP limit would throttle the load tests; in production you limit authenticated identities and also anonymous IPs
- C. IP limits are illegal
- D. API keys are encrypted

??? success "Answer"
    **B — A lab constraint, explained.**

    Per-IP limits also misfire behind NATs (a whole university behind one address). And a header chosen by the client can be rotated by an attacker — so real limits use verified identities (API keys you issued, user ids from JWTs).

---

**Q8.** You measure capacity 400 req/s with 1 replica and 960 req/s with 3. What is the scaling efficiency, and the most likely cause of the gap?

- A. 100%; there is no gap
- B. 80%; the three replicas share one database (and one laptop), which becomes the contended resource
- C. 33%; Nginx is single-threaded
- D. 240%; caching kicked in

??? success "Answer"
    **B — 960 / (3 × 400) = 80%.**

    Scaling the stateless tier moves the pressure to the shared stateful tier. The Universal Scalability Law captures this: contention (and coherence) costs make throughput grow sub-linearly with nodes.

---

**Q9.** What is the advantage of the `resolve` flag on the upstream servers?

- A. It encrypts the traffic to the replicas
- B. Nginx resolves the names through Docker's DNS at run time: it starts even if a replica is down and notices when a replica comes back with a new IP
- C. It enables HTTP/2
- D. It caches responses

??? success "Answer"
    **B — Dynamic name resolution.**

    Without it, Nginx resolves upstream names once at startup and refuses to start if a name does not resolve — a classic outage when a dependency is restarted or rescheduled with a new address.

---

**Q10.** Which statement about health checks is correct?

- A. Open-source Nginx actively probes `/actuator/health` every few seconds
- B. Passive checks learn from failures of real requests; active checks probe an endpoint periodically and can remove a replica before users hit it
- C. Health checks are only needed in Kubernetes
- D. A passing liveness check means the replica can serve traffic

??? success "Answer"
    **B — Passive vs active.**

    Open-source Nginx is passive (`max_fails`). Envoy, HAProxy, cloud load balancers, Spring Cloud LoadBalancer (lab 4) and Kubernetes readiness probes (lab 10) do active checks. And *readiness* (can serve) differs from *liveness* (process alive).
