Last year BoxOffice's biggest on-sale went down at 10:02. The team *had* load-tested: 200 virtual users against staging, p95 of 180 ms, "all green". In the post-mortem they found five problems with that test. Staging had a tenth of production's data, so every query hit a warm cache. The virtual users waited for each response before sending the next request, so when the system slowed down, the test politely slowed down with it and never saw the queue that real fans built. The test lasted ten minutes and never reached the point where the database connection pool ran out. Nobody had written down what "good enough" meant before running it. And the report showed averages.

Performance engineering is the discipline that prevents that post-mortem. It is not "run a tool and look at a graph": it is a **method** — state the objective, model the workload, generate load that behaves like real users, measure what users feel, find the one resource that limits the system, fix it, and measure again. This class teaches the method and the tools, using BoxOffice's flash sale as the running test case.

!!! quote "The story so far"

    Chapter 15 of the [story of the course](../../index.md#story). Every chapter added a box to BoxOffice because a number asked for it: an edge and stateless replicas ([class 4](../edge/index.md), [class 5](../compute/index.md)), a database that sells each seat once ([class 6](../databases/index.md)), a cache ([class 7](../caching/index.md)), a waiting room ([class 8](../messaging/index.md)), SLOs and breakers ([class 9](../observability/index.md), [class 10](../reliability/index.md)), Kubernetes ([class 11](../cloud-native/index.md)) — and, since [class 14](../ai-delivery/index.md), changes arrive faster than anyone can re-check them by hand. Each box was measured alone, in its own lab. **This class** answers: does the *whole* design hold the next on-sale — 2 M fans at 10:00, p99 under 300 ms — how do we prove it, and how do we keep it proven on every change?

!!! abstract "Learning objectives"

    By the end of this class you should be able to:

    - **Define** latency, service time, throughput, concurrency, utilization and saturation, and **relate** them with Little's Law.
    - **Read** a throughput–latency curve, **locate** the knee and the saturation point, and **explain** why latency explodes as utilization approaches 100 %.
    - **Apply** a performance methodology — workload characterization, the USE method, RED metrics — to find the bottleneck of a system instead of guessing.
    - **Design and write** smoke, load, stress, spike, soak and breakpoint tests in k6, choosing between open (arrival-rate) and closed (virtual-user) workload models, with thresholds that encode the SLOs.
    - **Detect** coordinated omission and other measurement errors (unrealistic data, cold caches, a saturated load generator) that make a test lie.
    - **Diagnose** a bottleneck with profiling (flame graphs from async-profiler and py-spy), database tools (`EXPLAIN ANALYZE`, `pg_stat_statements`) and pool sizing.
    - **Plan** capacity with Little's Law and headroom, and **enforce** performance budgets in CI.

## Roadmap

1. **This overview** — the vocabulary, the throughput–latency curve and its knee, and the performance-engineering loop.
2. [Methodology](methodology/index.md) — anti-methods, workload characterization, the USE and RED methods, test environments, test data and warm-up.
3. [Load testing](load-testing/index.md) — the six test types in k6, open vs closed models, thresholds as SLOs, coordinated omission, chaos under load, and the playground profiles.
4. [Finding bottlenecks](bottlenecks/index.md) — reading results, profiling and flame graphs, database bottlenecks, pool sizing.
5. [Capacity planning](capacity-planning/index.md) — Little's Law and headroom, autoscaling lag, a capacity model for the on-sale, and performance budgets in CI.
6. [Quiz](quiz.md) — check your understanding.

## Slides

<div class="slides-embed">
  <iframe src="slides/performance.html" title="Slides: performance engineering and load testing" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/performance.html){:target="_blank"}

---

## The vocabulary of performance

Precise words prevent most performance arguments. The [Estimation class](../estimation/index.md) introduced them; here they become measurement targets.

| Term | Definition | BoxOffice example |
|---|---|---|
| **Service time** (S) | Time a resource spends actually working on one request | 4 ms of CPU and 6 ms of database time to place a seat hold |
| **Waiting (queueing) time** | Time a request spends waiting for a busy resource | Waiting for a free connection in the pool |
| **Latency / response time** (R) | What the client measures: waiting + service + network | `POST /holds` took 230 ms end to end |
| **Throughput** (X) | Completed requests per unit of time | 1 800 holds per second |
| **Concurrency** (N) | Requests in the system at the same moment (in service or waiting) | 120 holds in flight |
| **Utilization** (U) | Fraction of time a resource is busy | Database CPU busy 82 % of the time |
| **Saturation** | Work the resource cannot serve yet — the queue length | 40 requests waiting for a connection |
| **Percentile** (p50, p99, p99.9) | The value below which that fraction of observations falls | p99 = 300 ms: 1 hold in 100 is slower than 300 ms |
| **Error rate** | Fraction of failed requests — including timeouts | 0.3 % of holds returned 503 |

Three relations hold for any stable system and are worth memorizing:

- **Little's Law**: $N = X \times R$ — concurrency equals throughput times response time[^1]. At 1 800 holds/s and 0.12 s each, there are on average 216 holds in flight: that is how many threads, connections or async slots the path needs.
- **Utilization law**: $U = X \times S$ — a database spending 0.4 ms of CPU per query (per core) at 2 000 queries/s on one core is 80 % busy.
- **Response time = service time + waiting time**: tuning code shortens service time; adding capacity or reducing load shortens waiting time. Near saturation, waiting dominates.

!!! warning "Averages lie"

    A mean of 120 ms is compatible with "everyone waits 120 ms" and with "99 % wait 20 ms and 1 % wait 10 s". Users — and SLOs — live in the tail. Report percentiles from **histograms** (HDR or native histograms), never the average of percentiles from different machines or intervals: percentiles cannot be averaged. See [Percentiles and tail latency](../estimation/percentiles/index.md).

---

## The throughput–latency curve and its knee

Every system, from one thread to a data centre, shows the same shape when you increase the load. The left plot models one `inventory` pod with 8 worker threads and 20 ms of mean service time — capacity 400 requests per second — as an M/M/8 queue. The right plot uses the **Universal Scalability Law** (USL), which adds *contention* (σ, waiting for shared resources) and *coherency* (κ, the cost of keeping shared state consistent) to the ideal linear scaling[^2]:

$$
X(N) = \frac{\lambda N}{1 + \sigma (N-1) + \kappa N (N-1)}
$$

```python exec="1" html="1"
# Two views of the same truth. Left: an M/M/c model of one inventory pod
# (8 worker threads, 20 ms mean service time -> capacity 400 req/s).
# Right: the Universal Scalability Law (illustrative coefficients).
import math
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

C, S = 8, 0.020                      # servers (threads) and mean service time (s)
MU = 1 / S

def erlang_c(lam):
    a = lam / MU                     # offered load in Erlangs
    rho = a / C
    top = a ** C / math.factorial(C) / (1 - rho)
    return top / (sum(a ** k / math.factorial(k) for k in range(C)) + top)

def p_resp_gt(t, lam):               # P(response time > t) for M/M/c, FIFO
    pw, th = erlang_c(lam), C * MU - lam
    both = (th * math.exp(-MU * t) - MU * math.exp(-th * t)) / (th - MU)
    return (1 - pw) * math.exp(-MU * t) + pw * both

def quantile(q, lam):
    lo, hi = 0.0, 10.0
    for _ in range(60):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if p_resp_gt(mid, lam) > 1 - q else (lo, mid)
    return hi

lams = np.linspace(10, 396, 200)
mean = [1000 * (S + erlang_c(l) / (C * MU - l)) for l in lams]
p99 = [1000 * quantile(0.99, l) for l in lams]

# USL: X(N) = lambda*N / (1 + sigma*(N-1) + kappa*N*(N-1))
N = np.arange(1, 121)
LAM1, SIGMA, KAPPA = 40.0, 0.04, 0.0006
X = LAM1 * N / (1 + SIGMA * (N - 1) + KAPPA * N * (N - 1))
n_star = int(round(math.sqrt((1 - SIGMA) / KAPPA)))

fig, (a1, a2) = plt.subplots(1, 2, figsize=(11, 4.2))
a1.plot(lams, mean, color="#4C9BE8", linewidth=2, label="mean")
a1.plot(lams, p99, color="#F28E2B", linewidth=2, label="p99")
a1.axvspan(0.75 * C * MU, C * MU, color="gray", alpha=0.12)
a1.text(0.755 * C * MU, 330, "the knee:\n> 75 % busy", color="gray", fontsize=8)
a1.set_xlim(0, C * MU)
a1.set_ylim(0, 400)
a1.set_xlabel("offered load (req/s); capacity = 400", color="gray")
a1.set_ylabel("response time (ms)", color="gray")
a1.set_title("Latency vs load (M/M/8, 20 ms)", fontweight="bold", color="gray")
a1.legend(frameon=False, labelcolor="gray")

a2.plot(N, X, color="#59A14F", linewidth=2, label="USL throughput")
a2.plot(N, LAM1 * N, color="gray", linestyle=":", linewidth=1, label="linear (ideal)")
a2.axvline(n_star, color="gray", linestyle="--", linewidth=0.8)
a2.text(n_star + 2, X.max() * 0.25, f"peak at N ≈ {n_star}\nthen retrograde", color="gray", fontsize=8)
a2.set_ylim(0, X.max() * 1.6)
a2.set_xlabel("concurrent requests N", color="gray")
a2.set_ylabel("throughput (req/s)", color="gray")
a2.set_title("Throughput vs concurrency (USL)", fontweight="bold", color="gray")
a2.legend(frameon=False, labelcolor="gray", loc="upper left")
for ax in (a1, a2):
    ax.tick_params(colors="gray")
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

Read the two plots together:

1. **The flat region.** At low load, latency is just service time. Doubling the load barely changes it. Most systems spend most of their life here, which is why they *seem* fast.
2. **The knee.** Past roughly 70–80 % utilization, requests start finding all servers busy and queue. Latency — and the p99 first — bends upward. The knee is the **useful capacity** of the system: the highest throughput at which the latency SLO still holds.
3. **Saturation.** As offered load approaches capacity, queues grow without bound; latency goes vertical and timeouts turn into errors. Throughput stops growing.
4. **Retrograde scaling.** With contention and coherency costs, adding *more concurrency* past the peak **reduces** throughput — threads fight over locks, caches thrash, connections time out and retry. A system pushed beyond its peak can serve *fewer* tickets per second than one held just below it, which is the core argument for admission control and waiting rooms.

!!! example "BoxOffice: the knee is the number you plan with"

    If one `inventory` pod keeps p99 under 300 ms up to 275 req/s and collapses at 360, the capacity number for planning is **275**, not 360. For an on-sale expecting 4 500 hold requests per second at peak, that means ⌈4 500 / 275⌉ = 17 pods *before* headroom — 22 at 75 % of the knee, 33 to survive the loss of one of three zones — and a database that can take 33 pods' worth of connections. The [Capacity planning](capacity-planning/index.md) page builds this model end to end.

!!! example "In the BoxOffice code: the knee of `catalog`, measured (lab 2)"

    [Hands-on 2 — Measure first](../../hands-on/2/index.md) finds the knee exactly as this section describes it: `sweep.sh` runs the open-model `load.js` once per arrival rate, one minute each, after a 30 s warm-up that is not recorded, and waits 10 s between steps so that queues drain. In the lab's example run (`catalog` limited to 1 CPU, a pool of 10 database connections), p99 is 38.6 ms at 300 req/s, 223.7 ms at 400 and 2,056 ms at 500 — where k6 also dropped 410 iterations. The knee is between 300 and 400 req/s, and the resource that saturated was the connection pool, not the CPU.

    ``` { .bash title="scripts/sweep.sh (one load test per arrival rate)" }
    --8<-- "docs/2027.1/hands-on/2/code/scripts/sweep.sh"
    ```

Try it: this playground scenario is the simplest possible system — client → app server → SQL database — running the **breakpoint** profile, which increases the arrival rate step by step until something breaks. Press **Run** and watch three numbers together: throughput, p99 latency and the utilization of each component. Note the rate at which p99 starts to bend (the knee) and which component reaches 100 % first (the bottleneck). Then give that component more capacity and run again: does the knee move, and which component becomes the new bottleneck?

<div class="sdp" data-scenario="monolith" data-mode="compact" data-profile="breakpoint" data-height="520"></div>

[Open the full playground](../../../playground/index.md) to add a cache or read replicas and see how the curve changes.

---

## The performance-engineering loop

Performance work is a scientific loop, not a one-off event before launch[^3]:

``` diagram-sim
flowchart LR
    slo["1. Objectives<br/>SLOs per endpoint,<br/>expected peak"] --> model["2. Workload model<br/>mix, arrival pattern,<br/>data"]
    model --> test["3. Test<br/>k6 scenario in a<br/>production-like env"]
    test --> analyze["4. Analyze<br/>curve, USE, RED,<br/>profiles"]
    analyze --> fix["5. Change ONE thing<br/>(code, config,<br/>capacity)"]
    fix --> test
    analyze --> ship["6. Ship + budget in CI<br/>monitor in production"]
    ship --> slo
```

- **Objectives first.** "Fast" is not a requirement. "`POST /holds`: p99 < 300 ms and errors < 0.1 % at 4 500 req/s" is. Without it, no test can pass or fail.
- **Change one thing at a time** and re-run the same test — otherwise you cannot attribute the improvement.
- **Production closes the loop.** Real traffic is the best workload model: production metrics and traces feed the next test, and the performance budget in CI keeps regressions from coming back.

| Level | Question | Tools |
|---|---|---|
| **Micro-benchmark** | Is this function/data structure faster? | JMH (Java), `pytest-benchmark` |
| **Component test** | How many req/s does one `inventory` pod sustain within the SLO? | k6 against one pod, profiler attached |
| **System test** | Does the whole purchase path hold at the on-sale peak? | k6 scenarios against a production-like environment[^4] |
| **Production** | Is it holding right now? Where is the tail coming from? | RED dashboards, traces, continuous profiling, SLO alerts |

!!! tip "In the interview"

    When an interviewer asks "how would you know this design handles the peak?", do not say "we would load-test it". Say **what** you would test and **how you would read it**: "An open-model k6 test at the expected peak arrival rate with the realistic endpoint mix, thresholds on p99 and error rate per endpoint, run long enough to reach steady state on warm caches; then a breakpoint test to find the knee and compute the headroom; the USE method on the database and the connection pool to find what saturates first."

!!! success "Best practices"

    - **Keep the load tests in the service repository, versioned with the code** — a script that drifts from the API measures an endpoint that no longer exists. In BoxOffice: the `load/` folder of the repository, from [lab 2](../../hands-on/2/index.md) to [lab 11](../../hands-on/11/performance-gate/index.md).
    - **Record every run with its conditions** — commit, configuration (pool size, CPU limit), data snapshot and machine next to the numbers; a p99 without its conditions cannot be compared with the next one. In BoxOffice: `results/lab2.md` and the sweep folders of [lab 2](../../hands-on/2/index.md).
    - **Publish capacity as a number per replica, with its SLO** — "`catalog`: 300 req/s at p99 < 300 ms on 1 CPU" is what capacity planning, autoscaling and the waiting room's admission rate are computed from. In BoxOffice: the knee measured in [lab 2](../../hands-on/2/index.md).
    - **Read the client and the server on one time axis** — k6 says *that* the p99 broke, the services' RED and USE metrics say *where*; tag each run and put both in the same Grafana. In BoxOffice: the `otel-lgtm` stack of [lab 8](../../hands-on/8/index.md).
    - **Gate every change on a short budget; run the full campaign before each big event** — a 1-minute test on every pull request catches the missing index; only the long load, spike and breakpoint tests prove the on-sale. In BoxOffice: the `performance budget` job of [lab 11](../../hands-on/11/performance-gate/index.md).

!!! warning "Common pitfalls"

    - **No objective**: a test without pass/fail criteria produces graphs, not decisions.
    - **Testing the wrong system**: tiny data sets, warm caches, a different instance size, no TLS, no gateway.
    - **Closed-model tests for open-world traffic**: the load generator slows down with the system and hides the queue (coordinated omission).
    - **Averages and single runs**: report percentiles from histograms; repeat runs and look at the variance.
    - **Tuning without a bottleneck**: optimizing a component at 20 % utilization changes nothing.
    - **A saturated load generator**: if the k6 machine is at 100 % CPU, you measured k6.

---

## The performance concept map { #concept-map }

Performance engineering does not add new boxes to the palette: it **measures** the ones you already have. The map links each **palette component** (green) to the **concepts** used to load it, observe it and size it (blue):

``` diagram
flowchart LR
    client["client · mobile<br/>(k6 generates them)"]:::comp --> edge["apigw · lb"]:::comp
    edge --> app["app"]:::comp
    app --> sql["sql"]:::comp
    app --> cache["cache"]:::comp
    queue["queue<br/>(waiting room)"]:::comp --> app
    obs["metrics · tracing"]:::comp -.- app
    client -.- c1["open vs closed model,<br/>6 test types, thresholds"]:::tech
    app -.- c2["Little's Law, the knee,<br/>USL"]:::tech
    sql -.- c3["EXPLAIN ANALYZE, hot rows,<br/>pool sizing"]:::tech
    cache -.- c4["warm-up, cold cache,<br/>hit ratio"]:::tech
    obs -.- c5["USE, RED,<br/>flame graphs"]:::tech
    queue -.- c6["headroom, autoscaling lag,<br/>admission control"]:::tech
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

| Palette component | Question it answers | Concepts | Taught in | Scenarios |
|---|---|---|---|---|
| [`client`](../../reference/components/client/index.md#client) · [`mobile`](../../reference/components/client/index.md#mobile) | How does the real load *arrive*? | workload model, open (arrival rate) vs closed (virtual users), think time, coordinated omission | [Methodology](methodology/index.md#workload-model) · [Load testing](load-testing/index.md) | `flash-sale`, `monolith` |
| [`app`](../../reference/components/compute/index.md#app) | How much can *one replica* take within the SLO? | service time, Little's Law, utilization law, the knee, USL, profiling | this overview · [Bottlenecks](bottlenecks/index.md) | `monolith` (breakpoint profile), `scale-out` |
| [`sql`](../../reference/components/storage/index.md#sql) | Which *query or lock* limits the path? | `pg_stat_statements`, `EXPLAIN ANALYZE`, hot rows, `SKIP LOCKED`, connection-pool sizing | [Bottlenecks](bottlenecks/index.md) | `flash-sale` |
| [`cache`](../../reference/components/storage/index.md#cache) | Is the test measuring a *warm cache* that production will not have? | warm-up, cold-start test, hit ratio, stampede | [Methodology](methodology/index.md#warm-up) | `read-heavy-cache` |
| [`metrics`](../../reference/components/observability/index.md#metrics) · [`tracing`](../../reference/components/observability/index.md#tracing) | Which resource *saturates first*? | USE, RED and golden signals, flame graphs, continuous profiling | [Methodology](methodology/index.md) · [Bottlenecks](bottlenecks/index.md) | `observability-stack` |
| [`queue`](../../reference/components/messaging/index.md#queue) · [`serverless`](../../reference/components/compute/index.md#serverless) | How many replicas, and *how much do we admit*? | headroom, autoscaling lag, cold starts, pre-scaling, waiting-room admission rate | [Capacity planning](capacity-planning/index.md) | `flash-sale`, `serverless-burst` |
| [`thirdparty`](../../reference/components/external/index.md#thirdparty) | What happens when a dependency *slows down under load*? | load and chaos together, Toxiproxy, timeouts, circuit breakers | [Load testing](load-testing/index.md) | `cascading-failure` |
| *(the pipeline)* | Will the *next change* regress? | performance budgets in CI, thresholds as SLOs | [Capacity planning](capacity-planning/index.md#performance-budgets) | — |

---

## Related

- Hands-on: [2. Measure first](../../hands-on/2/index.md) (k6 smoke/load/stress on `catalog`, finding the knee, Little's Law check), [6. Data at scale](../../hands-on/6/index.md) (`EXPLAIN ANALYZE`, indexes, PgBouncer), [9. Resilience & chaos](../../hands-on/9/index.md) (k6 under Toxiproxy faults) and [11. Delivery](../../hands-on/11/index.md) (k6 performance budget gate in CI).
- Exercise: [Load-test report](../../exercises/load-test-report/index.md); project: [Load-test campaign](../../exercises/project/load-test-campaign/index.md) and [Game day](../../exercises/project/game-day/index.md).
- Classes: [Estimation — queueing](../estimation/queueing/index.md) and [percentiles](../estimation/percentiles/index.md), [Observability](../observability/index.md), [Reliability — chaos engineering](../reliability/chaos/index.md).
- Case study: [Ticketing (BoxOffice flash sale)](../case-studies/ticketing/index.md); tools: [Reference — tools](../../reference/tools/index.md).

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - Response time = service time + **waiting**; near saturation, waiting dominates. $N = X \times R$ and $U = X \times S$ connect the numbers.
    - Every system has a **knee**: plan with the throughput at which the latency SLO still holds, not with the maximum.
    - Past the peak, more concurrency can mean **less** throughput (USL) — admission control beats overload.
    - Performance engineering is a **loop**: objectives → workload model → test → analyze → change one thing → re-test → budget in CI.

## What breaks next { #what-breaks-next }

Performance engineering proves *this* design for *this* workload: one ticketing system, one on-sale, a mix of about 80 % reads and 20 % holds and orders, a knee measured on BoxOffice's own pods. The method — workload model, open-model tests, the knee, headroom, a budget in CI — transfers to any system; the numbers and the boxes do not. A news feed fans each post out to millions of followers, a chat keeps millions of connections open for hours, a ride app writes every driver's location every few seconds: different numbers ask for different blocks. Recognizing which blocks of the previous fifteen chapters a new system needs, and which number asks for each, is [class 16 — Case studies](../case-studies/index.md).

---

[^1]: LITTLE, J. D. C. A Proof for the Queuing Formula: L = λW. *Operations Research*, v. 9, n. 3, p. 383–387, 1961.
[^2]: GUNTHER, N. J. *Guerrilla Capacity Planning*. Springer, 2007.
[^3]: GREGG, B. *Systems Performance: Enterprise and the Cloud*. 2nd ed. Addison-Wesley, 2020.
[^4]: Grafana Labs. [k6 documentation — Test types](https://grafana.com/docs/k6/latest/testing-guides/test-types/){target="_blank"}.
