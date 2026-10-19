Click **"Answer"** to reveal the correct answer and explanation.

---

## Cloud-native and service models

**Q1.** An early version of BoxOffice's `inventory` kept seat holds in a map inside the JVM. Which twelve-factor property did it violate, and what was the visible symptom with three replicas?

- A. Config — the database URL was hard-coded, so replicas used different databases
- B. Processes (stateless) — a hold made on one replica was invisible to the others and was lost when that pod was replaced
- C. Logs — holds were written to a local file that filled the disk
- D. Dev/prod parity — the map behaved differently in production

??? success "Answer"
    **B — Processes must be stateless.**

    State kept in process memory ties a user to one instance. Behind a load balancer the next request may go to another replica, and any restart, rolling update or scale-in destroys the state. Moving holds to PostgreSQL (with an expiry) or Redis (with a TTL) makes every replica equivalent and disposable.

---

**Q2.** For which BoxOffice component is **SaaS** the most defensible service model?

- A. The `inventory` service
- B. The seat-inventory database
- C. Card payment processing
- D. The Kubernetes worker nodes

??? success "Answer"
    **C — Card payments.**

    Handling card data brings heavy compliance obligations (PCI DSS), fraud detection and banking integrations that are not BoxOffice's core business. A payment provider offers all of it as a product through an API. The inventory service and its database are the core of the business and stay under the team's control (CaaS and DBaaS).

---

**Q3.** Which responsibility stays with the customer in **every** service model, including SaaS?

- A. Patching the operating system
- B. Deciding who may access the data, and the configuration of the service
- C. Replacing failed disks
- D. Scaling the runtime

??? success "Answer"
    **B — Data access and configuration.**

    The provider may operate everything from the hardware to the application, but it cannot decide who in your organization should read which data, or whether a bucket should be public. Most cloud data leaks are configuration mistakes on the customer side.

---

## Containers

**Q4.** Two containers run on the same host. What do they share that two virtual machines on the same host would **not** share?

- A. The CPU
- B. The physical memory
- C. The operating-system kernel
- D. The network card

??? success "Answer"
    **C — The kernel.**

    Containers are isolated processes (namespaces) with resource limits (cgroups) on a single shared kernel. VMs each boot their own kernel on a hypervisor. This is why containers start in milliseconds and are denser, and also why their isolation boundary is weaker — multi-tenant platforms wrap them in micro-VMs such as Firecracker or gVisor.

---

**Q5.** In the `catalog` Dockerfile, `COPY pom.xml` and `mvn dependency:go-offline` come **before** `COPY src`. Why?

- A. Maven requires the POM to be in a separate layer
- B. So that a code change invalidates only the later layers, and the dependency download is reused from the build cache
- C. To make the final image smaller
- D. Because distroless images do not support `COPY src`

??? success "Answer"
    **B — Layer caching.**

    Each instruction produces a layer, and a layer is rebuilt only if its inputs (or a previous layer) changed. Dependencies change rarely; source code changes on every commit. Ordering from least to most frequently changing keeps the expensive steps cached. (Image size is reduced by the *multi-stage* build, not by this ordering.)

---

**Q6.** A team uses `ENTRYPOINT java -jar app.jar` (shell form). During every rolling update a few requests fail. What is the most likely cause?

- A. The JVM starts too slowly
- B. `/bin/sh` is PID 1, does not forward `SIGTERM` to Java, and the container is killed with `SIGKILL` after the grace period, dropping in-flight requests
- C. The image is too large to pull in time
- D. The readiness probe is too strict

??? success "Answer"
    **B — Signals do not reach the JVM.**

    With the shell form, the shell becomes PID 1 and Java a child process that never sees `SIGTERM`, so Spring Boot's graceful shutdown never runs. The exec form (`ENTRYPOINT ["java", …]`) makes Java PID 1. Combine it with `server.shutdown: graceful` and a short `preStop` sleep so endpoints are updated before shutdown begins.

---

## Kubernetes

**Q7.** A node running two `catalog` pods loses power. Which mechanism brings the Deployment back to its 4 desired replicas?

- A. The kubelet on the failed node restarts the pods when power returns
- B. Controllers compare desired and actual state; the ReplicaSet controller creates new pods and the scheduler places them on healthy nodes
- C. The HPA detects the CPU drop and scales up
- D. Argo CD re-applies the manifests from Git

??? success "Answer"
    **B — Reconciliation by controllers.**

    Kubernetes is a set of control loops. The node controller marks the node as not ready, its pods are eventually evicted, the ReplicaSet sees 2 actual vs 4 desired, creates two pods, and the scheduler binds them to nodes with free capacity. No human and no Git sync is required.

---

**Q8.** The readiness probe of `inventory` checks that PostgreSQL is reachable. PostgreSQL fails over and is unreachable for 20 seconds. What happens?

- A. Only the pods connected to the old primary are removed from the Service
- B. Every `inventory` pod becomes unready at the same time, the Service has no endpoints, and all requests fail — including those that a cache or a graceful error could have served
- C. The pods are restarted, which speeds up recovery
- D. Nothing, because readiness probes are ignored during failovers

??? success "Answer"
    **B — A shared dependency makes all pods unready together.**

    Readiness should answer "can *this pod* serve traffic?". A dependency shared by all pods turns a 20-second database blip into a total outage of the service, with no chance of degraded responses. Keep readiness local (application started, warmed up, not overloaded), and handle dependency failures in the code (timeouts, circuit breakers, fallbacks). Putting the database in the **liveness** probe would be worse: it restarts every pod.

---

**Q9.** The HPA targets 60 % average CPU utilization. `catalog` has 5 pods at 96 %. How many replicas will the HPA request (ignoring min/max and stabilization)?

- A. 6
- B. 8
- C. 10
- D. 96

??? success "Answer"
    **B — 8.**

    desired = ⌈current × current metric / target⌉ = ⌈5 × 96 / 60⌉ = ⌈8.0⌉ = **8**. Note that the percentage is relative to the pods' CPU **request**: without requests, CPU utilization-based autoscaling cannot work.

---

**Q10.** A latency-sensitive Java service has a CPU **limit** of 1 core. Average CPU usage is 45 %, but p99 latency is high and spiky. What should you look at first?

- A. The memory limit, because Java uses a lot of memory
- B. CPU throttling: many threads can consume the 100 ms CFS quota early in each period and then wait, adding latency even at a low average
- C. The number of replicas in the PodDisruptionBudget
- D. The image size

??? success "Answer"
    **B — CFS throttling.**

    A CPU limit is enforced per scheduling period (100 ms by default). Bursty multi-threaded work (request handling plus GC) can exhaust the quota early and stall for the rest of the period. The average looks fine; the tail does not. Check `container_cpu_cfs_throttled_periods_total`; consider raising or removing the CPU limit while keeping the request.

---

## Delivery and FinOps

**Q11.** Which property distinguishes **pull-based GitOps** (Argo CD) from a CI job that runs `kubectl apply`?

- A. GitOps only works with Helm
- B. An agent inside the cluster continuously reconciles the cluster to the state in Git; CI never holds cluster credentials, and manual drift is detected or reverted
- C. GitOps deploys faster because it skips tests
- D. With GitOps you cannot roll back

??? success "Answer"
    **B — Continuous, pull-based reconciliation.**

    The cluster pulls its desired state from Git, so the audit trail is `git log`, rollback is `git revert`, drift is visible, and the CI system — a frequent attack target — has no permission to change production.

---

**Q12.** A canary of `order` receives 5 % of 400 req/s. The baseline error rate is 0.1 %. Why is a 30-second canary step not enough to promote safely?

- A. Because Argo Rollouts requires at least 10 minutes per step
- B. Because 30 s at 20 req/s is only ~600 requests — too few to distinguish a small error-rate regression (e.g. 0.1 % → 0.2 %) from noise
- C. Because the JVM needs 30 s to start
- D. Because canaries must always receive 50 % of the traffic

??? success "Answer"
    **B — Not enough samples.**

    At 0.1 % you expect fewer than one error in 600 requests in either version; detecting a doubling of a rare event needs many thousands of requests (≈ 18 000 for 80 % power in the page's estimate — about 15 minutes at 5 %). Large regressions show up quickly; small ones need time, more weight, or longer pauses.

---

**Q13.** A schema change renames `orders.total` to `orders.amount_cents`. Why should it **not** be shipped in the same release as the code that uses the new name?

- A. Flyway cannot rename columns
- B. During a rolling update or canary, old and new versions run side by side; the old version would break the moment the column is renamed. Use expand/contract: add the new column, write both, backfill, switch reads, drop the old column later
- C. Renaming columns locks the table for hours in PostgreSQL
- D. Because the canary analysis cannot read the database

??? success "Answer"
    **B — Two versions coexist; the database does not roll back.**

    Any progressive strategy (rolling, canary, blue/green with a shared database) requires schema changes to be compatible with both the old and the new code. Expand/contract spreads a breaking change over several backward-compatible releases.

---

**Q14.** In the BoxOffice cost model, four 2-hour on-sales need 24 extra nodes. Why do they add so little to the monthly bill, and what is the lesson?

- A. Because peak nodes are free on AWS
- B. Because 24 nodes × 8 hours is a tiny fraction of 24 nodes × 730 hours; elastic capacity costs in proportion to the time it exists, so autoscaling and pre-scaling for known peaks beat provisioning for the peak permanently
- C. Because the on-sales run on spot instances
- D. Because the database handles the peak alone

??? success "Answer"
    **B — You pay for capacity × time.**

    24 × $0.192 × 8 h ≈ $37, versus ≈ $3,364 per month to keep the same nodes always on. The economic case for elasticity is exactly this peak-to-average ratio. The same model shows that data services, CDN egress and log ingestion — not peak compute — dominate the bill.

---

**Q15.** Below which average traffic level is a pay-per-request function usually cheaper than two always-on container tasks behind a load balancer, in the page's model?

- A. About 10 requests per second on average
- B. About 1 000 requests per second
- C. Functions are always cheaper
- D. Containers are always cheaper

??? success "Answer"
    **A — Around ten requests per second on average (with the page's assumptions).**

    Containers have a fixed monthly floor (tasks + load balancer) and a low marginal cost; functions have no floor and a higher cost per request. The crossing point depends on request duration, memory and the front door's per-request price, so recompute it for your workload — but the shape of the trade-off is general: low or very spiky traffic favours per-request pricing, steady load favours always-on capacity.
