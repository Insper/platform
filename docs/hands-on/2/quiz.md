Click **"Answer"** to reveal the correct answer and explanation.

---

## API Gateway

**Q1.** Why do other microservices **not expose their ports** directly in `compose.yaml`?

- A. Docker Compose does not support multiple port mappings in a single file
- B. Exposing multiple ports would conflict with the host's firewall rules
- C. Only the gateway is internet-facing; all other services live in the internal Docker network and are only reachable through the gateway
- D. Spring Boot does not allow multiple services to run on different ports

??? success "Answer"
    **C — Only gateway is internet-facing.**

    Port isolation is a security property: no external client can reach `account-service:8080` or `auth-service:8080` directly. They can only be reached through the gateway, which enforces authentication, rate limiting, and routing rules. This "trusted layer" pattern means a compromised external request can only enter through one controlled point.

---

**Q2.** What framework does **Spring Cloud Gateway** use internally, and what advantage does this provide?

- A. Spring MVC (servlet-based) — the most stable Spring framework
- B. Spring WebFlux (reactive/non-blocking) — handles large volumes of concurrent connections with a small number of threads
- C. Spring Batch — optimised for bulk request processing
- D. Spring Integration — designed for enterprise messaging patterns

??? success "Answer"
    **B — Spring WebFlux (reactive).**

    The gateway is a high-concurrency chokepoint — all traffic passes through it. WebFlux uses an event loop model (like Node.js) rather than thread-per-request. A gateway handling 10,000 concurrent connections needs ~10 threads with WebFlux, versus ~10,000 threads with a traditional servlet container — a massive difference in memory and scheduling overhead.

---

**Q3.** What is the purpose of **CORS configuration** in the gateway?

- A. It encrypts cross-origin requests using TLS certificates
- B. It blocks all requests from outside the internal Docker network
- C. It specifies which browser origins are permitted to make cross-origin requests to the API
- D. It compresses responses sent to cross-origin clients

??? success "Answer"
    **C — Specifies which browser origins can make cross-origin requests.**

    Browsers enforce the Same-Origin Policy: a JavaScript app at `frontend.example.com` cannot call `api.example.com` unless the server explicitly allows it. The gateway's CORS configuration adds `Access-Control-Allow-Origin` (and related headers) to responses, telling the browser it is safe to allow the cross-origin request.

---

**Q4.** In `application.yaml`, the gateway routes are configured with `uri: lb://account`. What does the `lb://` prefix mean?

- A. It uses the host machine's load balancer
- B. It enables Spring Cloud LoadBalancer client-side load balancing across all registered instances of the `account` service
- C. It connects to an external Nginx load balancer
- D. It routes to the account service via the Linux loopback interface

??? success "Answer"
    **B — Client-side load balancing via Spring Cloud LoadBalancer.**

    `lb://account` tells Spring Cloud Gateway to resolve `account` through the service registry (or Docker DNS, depending on configuration) and apply client-side load balancing across all healthy instances. The `lb://` prefix is Spring's abstraction over various discovery backends (Eureka, Consul, Kubernetes DNS).

---

**Q5.** The gateway's `compose.yaml` entry has `depends_on: [account]`. When would adding `condition: service_healthy` to this dependency be important?

- A. Never — the gateway starts quickly and the account service is always ready first
- B. When the gateway's startup routine immediately makes HTTP calls to account (e.g., route validation), it needs account to be fully initialised, not just started
- C. Only in production — local development never has startup ordering issues
- D. It is required by the Docker Compose specification for all `depends_on` entries

??? success "Answer"
    **B — When the gateway makes startup-time HTTP calls to the downstream service.**

    If the gateway validates routes or prefetches configuration from account at startup, and account's process has started but the database connection isn't ready yet, the gateway will fail to start. `condition: service_healthy` waits until account's health check (e.g., `/actuator/health`) returns 200 before starting the gateway.
