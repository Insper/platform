
The BoxOffice inventory database is at 70% CPU during a normal on-sale and holds take about 75 ms at p99. The team decides it has "30% to spare". At the next, bigger on-sale the CPU reaches 92% — only 22 points more — and the p99 jumps to almost 300 ms, four times worse and right at the 300 ms hold target. Timeouts fire, clients retry, and the extra load pushes the database to 100%. Nothing was "broken"; the team simply did not know the shape of the curve that relates **load** to **latency**. This page derives that curve from a few simple laws, and then uses the same laws to answer the questions that every capacity decision asks: *how many requests are in flight? how big must this pool be? how full can this component run? will adding nodes help?*

---

## The vocabulary of a queue

Every component that serves requests — a CPU core, a thread pool, a database connection, a payment API — can be seen as a **queue** in front of one or more **servers** (in queueing theory, a "server" is anything that serves a request):

``` diagram-sim
flowchart LR
    arrivals(["Arrivals<br/>λ requests/s"]) --> queue["Queue<br/>(waiting: Wq)"]
    queue --> s1["Server 1<br/>(service: S)"]
    queue --> s2["Server 2"]
    queue --> s3["Server c"]
    s1 --> out(["Completions<br/>X requests/s"])
    s2 --> out
    s3 --> out
```

| Symbol | Name | Meaning | BoxOffice example |
|---|---|---|---|
| **λ** | arrival rate | requests arriving per second | 1,000 holds/s |
| **S** | service time | time a server spends on one request (no waiting) | 5 ms of database work per hold |
| **μ** | service rate | requests one server completes per second: μ = 1/S | 200 holds/s per connection |
| **c** | servers | parallel servers (cores, threads, connections) | 8 productive connections |
| **ρ** | utilization | fraction of time servers are busy: ρ = λ / (c·μ) = λ·S / c | 1,000 × 0.005 / 8 = 62.5% |
| **Wq** | waiting time | time spent in the queue before service starts | — |
| **R** (or W) | response time | waiting + service: R = Wq + S | what the client measures |
| **L** | number in system | requests waiting or in service ("in flight", concurrency) | — |
| **X** | throughput | completions per second (= λ in steady state, if nothing is dropped) | — |

---

## Little's Law

The most useful formula in capacity planning is also the simplest[^1]:

$$
L = \lambda \times W
$$

**The average number of requests in a system equals the average arrival rate times the average time each request spends in the system.** It holds for any stable system (arrivals do not exceed capacity in the long run), regardless of the distribution of arrivals or service times, the number of servers, or the scheduling order. You can apply it to a thread pool, a whole service, a queue, a database — or a coffee shop: if 2 customers arrive per minute and each stays 15 minutes, there are on average 30 customers inside.

Its three forms answer three different questions:

| Form | Question | BoxOffice example |
|---|---|---|
| L = λ × W | How many requests are in flight? How big must the pool be? | 1,000 holds/s × 20 ms inside the service = **20 holds in flight** → at least 20 worker threads |
| W = L / λ | How long does each request (or person) wait? | 2 M fans in the waiting room, admitted at 1,000/s → the last one waits 2 M / 1,000 = **2,000 s ≈ 33 min** |
| λ = L / W | What throughput can this concurrency sustain? | 8 connections, each hold occupies one for 5 ms → at most 8 / 0.005 = **1,600 holds/s** |

!!! example "BoxOffice — sizing the inventory service"

    The inventory service receives **λ = 1,000 holds/s**. Each hold spends **W = 40 ms** inside the service (validation, the database call, serializing the response), of which **10 ms** hold a database connection (the transaction plus round trips).

    - Requests in flight in the service: 1,000 × 0.040 = **40** → with one thread per request, the service needs at least 40 worker threads; with 4 replicas, ~10 each, plus headroom.
    - Connections in use: 1,000 × 0.010 = **10** → a connection pool of ~15 across all replicas suffices. A pool of 200 would not make anything faster — it would only let more transactions contend for the same rows.

    Now the payment provider slows down from 300 ms to 3 s, and the order service calls it synchronously at 100 orders/s: in-flight payment calls go from 100 × 0.3 = **30** to 100 × 3 = **300**. If the order service has 200 threads, it is exhausted — and every other route of the order service fails with it. This is the arithmetic of a **cascading failure** ([class 10](../../reliability/index.md)), and it is why timeouts and bulkheads exist.

### Little's Law as a lie detector for load tests

A load-testing tool with a fixed number of virtual users (VUs) that each send a request, wait for the response, "think" for Z seconds and repeat is a **closed system**. Little's Law applied to it says:

$$
N_{users} = X \times (R + Z)
$$

With 100 VUs, no think time (Z = 0) and R = 50 ms, the test **cannot** produce more than 100 / 0.05 = 2,000 req/s, whatever the server could take. If the server slows down to R = 500 ms, the test generates only 200 req/s — the load *drops* exactly when the system struggles, hiding the problem. Check every load-test result with this formula; lab 2 does it, and [class 15](../../performance/index.md) discusses open vs closed workload models.

---

## The utilization law

A second, equally simple law connects throughput and utilization:

$$
U = X \times S
$$

**The utilization of a resource equals its throughput times the service time per request.** A database that serves 1,000 holds/s at 5 ms of CPU each needs 5 CPU-seconds per second: **5 cores at 100%**, or 62.5% of 8 cores. Turned around, it gives the **capacity** of a resource: utilization cannot exceed 100% per server, so

$$
X_{max} = \frac{c}{S}
$$

That is the "parallel slots divided by service time" rule used in the [overview](../index.md). The resource with the highest utilization (the largest ratio of demand to capacity) is the **bottleneck**: it saturates first and caps the throughput of the whole system.

---

## Why latency explodes before 100%: the knee

If requests arrived at perfectly regular intervals and each took exactly S, a server could run at 99% utilization with no waiting at all. Real traffic is **random**: requests arrive in bursts, and some take longer than others. During a burst, requests queue; the queue drains during quiet moments. The busier the server, the fewer quiet moments it has to catch up — and the longer the queues grow.

The simplest model of this is the **M/M/1** queue: random (Poisson) arrivals, random (exponential) service times, one server. Its mean response time is[^2]:

$$
R = \frac{S}{1 - \rho}
$$

| Utilization ρ | Mean response time R | p99 response time (≈ 4.6 R) | With S = 5 ms |
|---|---|---|---|
| 10% | 1.1 S | 5 S | R ≈ 6 ms |
| 50% | 2 S | 9 S | R = 10 ms |
| 70% | 3.3 S | 15 S | R ≈ 17 ms |
| 80% | 5 S | 23 S | R = 25 ms |
| 90% | 10 S | 46 S | R = 50 ms, p99 ≈ 230 ms |
| 95% | 20 S | 92 S | R = 100 ms, p99 ≈ 460 ms |
| 99% | 100 S | 460 S | R = 500 ms, p99 ≈ 2.3 s |

(In M/M/1 the response time is exponentially distributed, so its p99 is ln(100) ≈ 4.6 times its mean.) Going from 50% to 90% utilization — less than double the load — makes the response time **5× worse**; from 90% to 99% — 10% more load — another **10× worse**. That is exactly the story of the BoxOffice inventory at the top of this page.

The plot shows R / S as a function of utilization for one server (M/M/1, mean and p99), and for 4 and 16 servers sharing **one queue** (M/M/c, computed with the Erlang C formula):

```python exec="1" html="1"
import math
from io import StringIO

import matplotlib.pyplot as plt
import numpy as np

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "axes.edgecolor": "#888",
                     "xtick.color": "#888", "ytick.color": "#888", "font.size": 10})


def erlang_c(c, rho):
    """Probability that an arrival waits in an M/M/c queue."""
    a = c * rho
    top = a**c / math.factorial(c) / (1 - rho)
    return top / (sum(a**k / math.factorial(k) for k in range(c)) + top)


rho = np.linspace(0.01, 0.97, 300)
fig, ax = plt.subplots(figsize=(8, 4.2))
ax.plot(rho, 1 / (1 - rho), color="#ef4444", lw=2.5, label="M/M/1 mean")
ax.plot(rho, np.log(100) / (1 - rho), color="#ef4444", lw=1.5, ls="--", label="M/M/1 p99")
for c, color in [(4, "#3b82f6"), (16, "#10b981")]:
    r = [1 + erlang_c(c, x) / (c * (1 - x)) for x in rho]
    ax.plot(rho, r, color=color, lw=2.5, label=f"M/M/{c} mean")
ax.axvspan(0.7, 0.85, color="#f59e0b", alpha=0.15)
ax.text(0.775, 0.4, "knee", ha="center", color="#f59e0b", fontweight="bold")
ax.set_xlim(0, 1)
ax.set_ylim(0, 20)
ax.set_xlabel("ρ = λ / (c·μ)")
ax.set_ylabel("R / S")
ax.grid(alpha=0.2)
ax.legend(frameon=False, loc="upper left")
for side in ("top", "right"):
    ax.spines[side].set_visible(False)
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

Three lessons from the curves:

1. **The knee.** Latency is almost flat at low utilization, then bends sharply. For a single server the bend is around 70–80%; past it, small increases in load cause huge increases in latency, and the **tail (p99) explodes first**.
2. **Pooling helps.** With 16 servers sharing one queue, the knee moves far to the right: a request only waits if *all* servers are busy. That is one reason why one big pool behind a load balancer behaves better than many small, separate queues (for example, sticky routing of users to specific servers).
3. **Variability is the enemy.** The M/M/1 model assumes very random arrivals and service times. More regular traffic queues less; burstier traffic (an on-sale!) queues more. Kingman's approximation for a single server makes this explicit[^3]:

$$
W_q \approx \frac{\rho}{1 - \rho} \times \frac{C_a^2 + C_s^2}{2} \times S
$$

where $C_a$ and $C_s$ are the coefficients of variation (standard deviation / mean) of the inter-arrival and service times. The first factor is the utilization effect; the second is the **variability** effect. A waiting room that admits fans at a steady rate lowers $C_a$; cutting slow outliers (a heavy query that takes 50× the normal time) lowers $C_s$. Both reduce queueing without adding a single server.

### What utilization should you run at?

| Component | Typical sustained target | Why |
|---|---|---|
| Latency-sensitive service (API, database primary) | **~50–70%** at peak | stay left of the knee; absorb bursts and the loss of one replica |
| Batch / asynchronous workers | 80–90%+ | latency of individual jobs matters little; throughput and cost do |
| Network links | < 70–80% | queues in routers add latency and drop packets near saturation |

Redundancy pushes in the same direction: with **4 replicas at 60%**, losing one moves the other three to 80% — still serviceable. With 4 replicas at 80%, losing one asks for 107%: the remaining replicas collapse. **Headroom is what makes failover work.**

!!! example "BoxOffice — reading the knee from the playground"

    In the [overview](../index.md), the `monolith` scenario with the `breakpoint` profile ramps load until it breaks. Suppose the database has 8 slots and S = 5 ms: capacity = 8 / 0.005 = 1,600 req/s. The knee (p99 rising sharply) should appear around 70–85% of that, ~1,100–1,350 req/s, and errors only near 1,600 req/s. If you see the knee much earlier, the bottleneck is somewhere else (the app server's thread pool, perhaps) — find the component with the highest utilization.

<div class="sdp" data-scenario="monolith" data-mode="compact" data-profile="breakpoint" data-seed="7" data-height="500"></div>

**Try it:** run the breakpoint profile, then double the database's capacity (or add app replicas) and run again. Does the knee move? By how much? If adding app replicas does not move it, which component is the bottleneck?

!!! example "In the BoxOffice code: the knee of `catalog`, measured (lab 2)"

    [Hands-on 2](../../../hands-on/2/index.md) draws this curve for the real service. The sweep runs the open-model load test once per arrival rate, one minute each, after a warm-up (a cold JVM would spoil the first point) and with a pause between steps so the queues drain. In the lab's example run (1 CPU, a pool of 10 connections), p99 was 39 ms at 300 req/s, 224 ms at 400 and 2,056 ms at 500 req/s, where k6 also had to drop 410 iterations: flat, then a wall. Little's Law names the queue: at 600 req/s the lab saw all 200 Tomcat threads busy, 10 database connections active and **190 requests waiting for a connection** — the pool of 10 is the *c* servers of this page, and the knee is where it saturates. Step 6 of the lab raises the pool to 30 and watches the bottleneck move.

    ``` { .bash title="scripts/sweep.sh" }
    --8<-- "docs/2027.1/hands-on/2/code/scripts/sweep.sh"
    ```

---

## When more servers stop helping

Little's Law and the utilization law suggest that capacity grows linearly with the number of servers: X_max = c / S. In practice it does not, because servers **coordinate**. Two classic models describe how scaling bends.

### Amdahl's law

If a fraction **σ** of the work is inherently **serial** (cannot be parallelized — a global lock, a single primary, a sequential step), then with N parallel workers the speedup is bounded[^4]:

$$
\text{Speedup}(N) = \frac{N}{1 + \sigma (N - 1)} \;\le\; \frac{1}{\sigma}
$$

With 5% serial work, no number of nodes gives more than 20× speedup; with 1%, 100×. For BoxOffice: if every hold must pass through the same lock on the same "section counter" row for even 5% of its time, adding inventory replicas stops paying off long before 20 replicas.

### The Universal Scalability Law

Neil Gunther's **Universal Scalability Law** (USL) adds a second term, **κ** (*coherency*), for the cost of keeping nodes consistent with each other — cache invalidation messages, distributed locks, cluster membership chatter, replication — which grows with the number of **pairs** of nodes, roughly N²[^5]:

$$
C(N) = \frac{N}{1 + \sigma (N - 1) + \kappa N (N - 1)}
$$

With κ > 0, throughput does not just flatten — it reaches a **peak** at $N^* = \sqrt{(1 - \sigma)/\kappa}$ and then **decreases**: adding nodes makes the system slower.

```python exec="1" html="1"
from io import StringIO

import matplotlib.pyplot as plt
import numpy as np

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "axes.edgecolor": "#888",
                     "xtick.color": "#888", "ytick.color": "#888", "font.size": 10})

n = np.arange(1, 65)
sigma, kappa = 0.05, 0.001          # contention and coherency (illustrative values)
amdahl = n / (1 + sigma * (n - 1))
usl = n / (1 + sigma * (n - 1) + kappa * n * (n - 1))
peak = int(round(np.sqrt((1 - sigma) / kappa)))

fig, ax = plt.subplots(figsize=(8, 4.2))
ax.plot(n, n, color="#888", lw=1.5, ls=":", label="linear: N")
ax.plot(n, amdahl, color="#3b82f6", lw=2.5, label="Amdahl (σ = 0.05)")
ax.plot(n, usl, color="#ef4444", lw=2.5, label="USL (σ = 0.05, κ = 0.001)")
ax.axvline(peak, color="#f59e0b", ls="--", lw=1.2)
ax.annotate(f"N* ≈ {peak}", xy=(peak, usl[peak - 1]), xytext=(peak + 4, usl[peak - 1] + 6),
            color="#f59e0b", arrowprops=dict(arrowstyle="->", color="#f59e0b"))
ax.set_xlim(1, 64)
ax.set_ylim(0, 25)
ax.set_xlabel("N (nodes, threads, replicas)")
ax.set_ylabel("C(N) = X(N) / X(1)")
ax.grid(alpha=0.2)
ax.legend(frameon=False, loc="upper left")
for side in ("top", "right"):
    ax.spines[side].set_visible(False)
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

| Model | Parameters | Shape | Real-world causes |
|---|---|---|---|
| Linear | — | doubles with N | shared-nothing, perfectly partitioned work (rare) |
| Amdahl | σ (contention) | flattens at 1/σ | a single primary, a global lock, a sequential step |
| USL | σ, κ (coherency) | peaks at N*, then falls | lock contention across nodes, cache coherence traffic, all-to-all chatter |

The practical use of the USL is to **fit** σ and κ to a few load-test measurements (throughput at N = 1, 2, 4, 8…) and predict where scaling stops *before* buying the hardware ([class 15](../../performance/index.md)). The design lesson is broader: **shared-nothing designs scale**. Partition the work so that nodes do not need to talk to each other — BoxOffice partitions inventory by event, so that holds for different events never contend — and both σ and κ shrink.

??? question "Think first: will a second inventory database help?"

    The on-sale for one stadium show is limited by row-lock contention on that event's seats in the inventory database. The team proposes adding a second database node with multi-primary replication. Use Amdahl and the USL to argue.

    **Answer**: the bottleneck is **contention on the same rows** (σ), not CPU. A second primary does not split that contention — both nodes still need to agree on the same seats, which **adds coherency cost** (κ: cross-node conflict detection or distributed locking). Throughput for that event would likely *drop*. What helps is reducing σ: shorter transactions, holding seats with one conditional `UPDATE`, admitting fans at a steady rate (waiting room), or splitting the *event* into independently allocated sections. A second node does help with **different** events (partitioning by event), where there is no shared state.

!!! tip "In the interview"

    Use Little's Law whenever you size a pool, a queue or a fleet: "1,000 req/s × 40 ms = 40 concurrent requests, so 4 instances with 16 threads each leave headroom". When proposing capacity, say the **target utilization** and why: "I'd size for 60% at peak so we stay left of the knee and survive losing one node." If asked "what if we add more servers?", mention the bottleneck and Amdahl: "app servers scale linearly until the single primary saturates; after that, we need to cache, partition or queue."

!!! success "Best practices"

    - **Size every pool with Little's Law and leave the formula as a comment** — threads = λ × W, connections = λ × time holding one; a pool sized "to be safe" only moves the queue into the database.
    - **Watch the queue in front of the bottleneck, not only its utilization** — pending connections and busy threads rise before the CPU graph looks alarming. In BoxOffice: `hikaricp.connections.pending` in lab 2's `scripts/watch-metrics.sh` ([Hands-on 2](../../../hands-on/2/index.md)).
    - **Sweep the arrival rate with an open model, a warm-up and a pause between steps** — one point is not a curve, a cold JVM is not your service, and leftover queues spoil the next step. In BoxOffice: `scripts/sweep.sh` (box above).
    - **Set autoscaling targets well left of the knee** — scaling takes minutes, and the burst arrives meanwhile. In BoxOffice: the HPA of lab 10 targets 60% CPU.
    - **Reduce variability before adding servers** — admit at a steady rate and remove slow outliers; Kingman's formula shows both shrink the queue for free. In BoxOffice: the waiting room (lab 7) and the indexes of lab 6.

!!! warning "Common pitfalls"

    - **Planning for 90–100% utilization** of latency-sensitive components: the p99 collapses long before the CPU graph looks alarming.
    - **Oversized pools**: a pool of 500 database connections does not add capacity; it moves the queue into the database, where contention makes everything slower.
    - **Ignoring Little's Law in load tests**: closed-loop tools with few VUs cannot generate the intended load against a slow system.
    - **Assuming linear scaling**: serial sections and coordination costs bend the curve; measure at several N.
    - **Unbounded queues**: a queue that grows without limit turns overload into ever-growing latency; bound it and shed load early ([class 10](../../reliability/index.md)).

---

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    LL["Little's Law<br/>L = λ × W"] --> POOL["thread and connection pools<br/>→ Compute, Databases"]
    LL --> WR["waiting-room wait<br/>W = L / λ → Messaging"]
    LL --> LT["load-test lie detector<br/>→ Performance"]
    UL["utilization law<br/>U = X × S"] --> CAP["capacity ≈ c / S"]
    CAP --> KNEE["the knee<br/>R = S / (1 − ρ)"]
    KNEE --> TARGET["run at 50–70%<br/>autoscaling targets → Compute"]
    KNEE --> SHED["load shedding, backpressure<br/>→ Reliability"]
    AMD["Amdahl σ<br/>hot rows, global locks"] --> PART["shared-nothing partitioning<br/>→ Databases"]
    USL["USL κ<br/>coherency cost"] --> PART
```

**Palette components:** [`app`](../../../reference/components/compute/index.md#app) (worker threads = λ × W per replica) · [`sql`](../../../reference/components/storage/index.md#sql) (the connection pool, the primary that is "only" at 70%, row-lock contention) · [`queue`](../../../reference/components/messaging/index.md#queue) (the waiting room: how long the last fan waits) · [`worker`](../../../reference/components/compute/index.md#worker) (batch workers can run at 80–90%) · [`payment`](../../../reference/components/external/index.md#payment) (a slow provider multiplies the calls in flight) · [`nosql`](../../../reference/components/storage/index.md#nosql) (shared-nothing partitions scale where the USL says a shared primary cannot). **Scenarios:** `monolith` (with the `breakpoint` profile), `flash-sale`, `async-queue`. **Continues in:** [Percentiles](../percentiles/index.md), [Compute — autoscaling lag](../../compute/serverless-autoscaling/index.md#autoscaling-lag), [Reliability — load shedding](../../reliability/patterns/index.md#load-shedding), [Databases — contention](../../databases/transactions/index.md#contention), [Performance — capacity planning](../../performance/capacity-planning/index.md), [Hands-on 2](../../../hands-on/2/index.md).

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - **Little's Law** L = λ × W gives concurrency, waiting time or throughput from the other two — for pools, services, queues and load tests.
    - **Utilization law** U = X × S; capacity ≈ c / S; the most loaded resource is the bottleneck.
    - Response time grows like **S / (1 − ρ)**: flat at low load, explosive past the **knee** (≈ 70–80% for one server); the tail explodes first.
    - Run latency-sensitive components at **~50–70%** at peak; pooling and lower variability push the knee right.
    - **Amdahl** (serial fraction σ) caps speedup at 1/σ; the **USL** (coherency κ) makes throughput *fall* past N*; shared-nothing partitioning is how you scale.

---

[^1]: LITTLE, J. D. C. A Proof for the Queuing Formula: L = λW. *Operations Research*, 9(3), 1961, pp. 383–387.
[^2]: HARCHOL-BALTER, M. *Performance Modeling and Design of Computer Systems: Queueing Theory in Action*. Cambridge University Press, 2013.
[^3]: KINGMAN, J. F. C. The single server queue in heavy traffic. *Mathematical Proceedings of the Cambridge Philosophical Society*, 57(4), 1961, pp. 902–904.
[^4]: AMDAHL, G. M. Validity of the single processor approach to achieving large scale computing capabilities. *AFIPS Spring Joint Computer Conference*, 1967.
[^5]: GUNTHER, N. J. *Guerrilla Capacity Planning*. Springer, 2007.
