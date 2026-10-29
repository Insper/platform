Click **"Answer"** to reveal the correct answer and explanation.

---

**Q1.** In BoxOffice, `catalog` listens on port **8082** inside its container *and* on your machine. From the `gateway` container, which URL reaches it?

- A. `http://localhost:8082`
- B. `http://catalog:8082`
- C. `http://127.0.0.1:8082`
- D. `http://host.docker.internal:80`

??? success "Answer"
    **B — `http://catalog:8082`.**

    Containers in the same Compose project share a network where each **service name is a DNS name**. Inside the `gateway` container, `localhost` is the gateway itself, so A and C point to the wrong process. `host.docker.internal` reaches your machine, not a sibling container. From your *terminal* (outside Docker), `http://localhost:8082` works because the port is published.

---

**Q2.** Why does every BoxOffice service serve its endpoints only under its own prefix (`/catalog/...`, `/auth/...`)?

- A. Spring Boot requires a prefix for every controller
- B. So that the edge and the gateway can route by path without rewriting it, and two services never claim the same path
- C. To make URLs longer and harder to guess
- D. Because Nginx cannot proxy the root path `/`

??? success "Answer"
    **B — Path-based routing without rewrites.**

    With unique prefixes, a routing rule is one line (`/catalog/** → catalog`) at every layer — Nginx, the gateway, a Kubernetes Ingress. Without them, `catalog` and `inventory` could both want `/events/...` and every proxy would need rewrite rules, a classic source of bugs.

---

**Q3.** BoxOffice uses **one** PostgreSQL instance with **one schema per service**. Which rule keeps the services independent?

- A. Every service may read every schema, but only `catalog` writes
- B. Each schema is created and changed only by the migrations of the service that owns it, and services never join across schemas
- C. All services share one Flyway history table
- D. Schemas are created by hand by the instructor before each lab

??? success "Answer"
    **B — Ownership: one service, one schema, no cross-schema joins.**

    The single instance is a laptop-friendly shortcut; the *logical* separation is what matters. If `order` joined `catalog.events`, a change in `catalog`'s table would break `order` — a hidden coupling. Keeping each schema private means you can later move a service to its own database server without touching the others.

---

**Q4.** You ran `k6 run -e VUS=10 load/hello.js` and got **20,000 req/s** with an average latency of **0.5 ms**. What does Little's Law (`L = λ × W`) predict for the concurrency?

- A. 1
- B. 10
- C. 40
- D. 20,000

??? success "Answer"
    **B — 10.**

    `L = λ × W = 20,000 req/s × 0.0005 s = 10`. In a closed model without think time, the number of requests in the system equals the number of VUs. When the computed value differs a lot from the VUs you configured, part of the time is being spent outside the measured request (for example in k6 itself).

---

**Q5.** With 1 VU, a request takes 2 ms. Ignoring any limit, what is the maximum throughput that single VU can generate?

- A. 2 req/s
- B. 50 req/s
- C. 500 req/s
- D. 2,000 req/s

??? success "Answer"
    **C — 500 req/s.**

    A closed-model VU sends the next request only after the previous answer arrives: `1 / 0.002 s = 500 req/s`. That is why "how many VUs?" and "how many requests per second?" are different questions — the same VUs produce less throughput when the server gets slower.

---

**Q6.** Between 10 and 50 VUs your throughput stays at ~20,000 req/s but p99 grows from 1 ms to 5 ms. What happened?

- A. The network card failed
- B. k6 has a bug with more than 10 VUs
- C. The CPU was already saturated at 10 VUs: extra VUs only wait in queues, so latency grows while throughput stays flat
- D. Nginx started caching responses

??? success "Answer"
    **C — Saturation: queueing replaces work.**

    Once the bottleneck resource is fully busy, throughput cannot grow; extra concurrency turns into waiting time (Little's Law again: 5× the VUs at the same λ → 5× the latency). Recognizing this "flat throughput, rising latency" signature is the core skill of lab 2.

---

**Q7.** Why is p99 more useful than the average latency to describe user experience?

- A. The average is harder to compute
- B. The average hides the slow tail: 1% of requests (and many more users, who make many requests per page) can be much slower than the mean
- C. p99 is always lower than the average
- D. k6 does not report averages

??? success "Answer"
    **B — Averages hide the tail.**

    A page that triggers 20 requests hits the p99 tail in about `1 − 0.99²⁰ ≈ 18%` of page loads. Averages mix a few very slow requests with many fast ones and look fine while users suffer. Class 2 (percentiles) explores this in depth.

---

**Q8.** Your laptop has 8 cores, but Docker Desktop is configured with 2 CPUs. What happens to your load-test results?

- A. Nothing, Docker always uses every core
- B. Every container shares those 2 CPUs: services, databases and (if containerized) k6 compete, and the measured capacity is lower than the machine could give
- C. Only Java containers are affected
- D. k6 automatically compensates for the limit

??? success "Answer"
    **B — The Docker VM is your real machine.**

    On macOS and Windows, containers run inside a VM with the resources set in Docker Desktop. Record those numbers in `results/lab0.md`: without them, nobody (including you, three weeks later) can compare measurements.

---

**Q9.** Why should the repository be tagged at the end of each lab (`git tag lab4`)?

- A. GitHub requires tags for private repositories
- B. Tags make the build faster
- C. To have a named, reproducible state: `git diff lab4 lab5` shows what changed when a later lab breaks something, and a measurement can always be tied to the code that produced it
- D. Tags are needed to run Docker Compose

??? success "Answer"
    **C — Reproducibility and diffs.**

    A measurement without the exact code and configuration that produced it is an anecdote. Tags are the cheapest way to tie results to versions — the same idea behind immutable image tags and GitOps in lab 11.

---

**Q10.** Which file should **never** be committed to your BoxOffice repository?

- A. `docker-compose.yaml`
- B. `load/hello.js`
- C. `.env` with real passwords or API keys
- D. `results/lab0.md`

??? success "Answer"
    **C — Secrets stay out of Git.**

    Anything pushed to Git should be considered public forever (history keeps it even after deletion). The lab defaults (`boxoffice`/`boxoffice`) are throwaway local values; real secrets go to a secrets manager, a topic of class 12.
