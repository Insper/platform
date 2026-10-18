---
hide:
  - navigation
  - toc
---

# System Design Playground

Draw a system with the components of the course, put it under load, and **watch it behave**: utilization, queues, latency percentiles, errors, cost — and what happens when things go wrong. Every number on the screen comes from the formulas of the course (utilization, Little's Law, queueing, percentiles, availability), so you can predict it before you press ▶ and explain it afterwards.

<div class="sdp" data-scenario="monolith" data-mode="full" data-height="640"></div>

Pick a scenario in the toolbar (or **Blank canvas**), press ▶ and read the panels below the canvas. The [scenario guide](scenarios/index.md) explains what each scenario teaches. Your design is saved in this browser for each scenario; **Reset scenario** brings the original back.

!!! abstract "What the playground is (and is not)"

    It is a **teaching model**: a few dozen lines of math per component, tuned so that the behaviour is realistic and explainable — the knee of the latency curve, a thread pool that runs out, a backlog that drains, a cache stampede. It is **not** a benchmark: the capacities and prices of the catalog are illustrative, chosen to make the arithmetic easy. Use it to reason about *shapes* and *orders of magnitude*, then measure the real system (hands-on labs).

## Quick start

1. Choose **Scenario → Monolith** (already loaded above) and press ▶. The *breakpoint* profile ramps the load until the system breaks.
2. When the run ends the **Report** opens: breaking point, percentiles, the **bottleneck** with an explanation, and the goals (✓/✗).
3. Add a **Load Balancer** from the palette (click **+** or drag it to the canvas), connect *fans → Load Balancer → boxoffice* (drag from the small handle on the right of a node to another node), delete the old edge, and raise the replicas of the app in the inspector.
4. Press ⟲ (restart the run) and ▶ again. Compare.
5. Stuck? Open **Hints** in the right panel, or **Show a possible solution**.

## Building a design

| Action | How |
|---|---|
| Add a component | Click **+** in the palette (or double-click the item), or drag it onto the canvas |
| Connect A → B (A calls B) | Drag from the round handle on the right edge of A and drop on B; or select A, press `C`, click B |
| Select | Click a node, an edge or a frame; click the background to see the scenario brief and goals |
| Edit | The inspector (right) shows the description, key numbers, a **Learn more** link to the component catalog, live values and the parameters (slider + number) |
| Move / pan / zoom | Drag a node; drag the background to pan; `Ctrl`/`⌘` + wheel (or pinch) and the ± buttons to zoom; `F` fits the design to the screen |
| Delete, duplicate, undo | `Del`/`⌫`, `D`, `Ctrl`/`⌘`+`Z` and `Shift`+`Ctrl`/`⌘`+`Z` (also in the toolbar) |
| Regions and zones | Add a **VPC** (region) or **Subnet** (availability zone) frame and place nodes inside; drag the frame by its title bar, resize it by the corner |
| Side connections | **Metrics, Logs, Tracing, Alerting, Health Check** and **Service Mesh** are not in the request path: connect them to the services they watch (either direction) |

Edges flow one way: a connection that would create a cycle is refused. An edge into a broker (**Message Queue, Pub/Sub, Event Stream, Kafka**) is asynchronous: the caller only waits for the broker's acknowledgement.

## How the model works { #how-the-model-works }

Time advances in **ticks of 0.1 s** of simulated time; the speed selector runs 1, 5, 20 or 100 ticks' worth per real tenth of a second. Each tick has two parts: a **fluid model** that moves *rates* (requests per second) through the graph, and a sample of **synthetic requests** (traces) that walk the graph to measure latency percentiles.

### Arrivals and requests

Each client generates arrivals from the **load profile** × random noise × traffic events. The number of arrivals in a tick is a Poisson draw with mean $\lambda \cdot \Delta t$, so even a constant target shows realistic jitter. A request is a **read** (share set by *Read %* in the toolbar, or per client) or a **write**; writes usually cost more downstream (a write on SQL uses 3 reads' worth of capacity). Bots (client parameter *bot traffic*) are extra load that a WAF or a rate limiter can stop; goals only count real users.

### How a node routes requests

| Role | Components | What happens to a request |
|---|---|---|
| split | DNS, Load Balancer, Ingress (API Gateway for 2+ targets of the same type) | goes to **one** healthy target, in proportion to capacity × edge weight; DNS can be *failover* |
| call | App Server, Worker, Auth, Search, Serverless, Orchestrator, … | calls **every** outgoing edge (subject to the edge *ratio* and *read/write filter*), one after the other (latencies add) or in parallel (the slowest wins) |
| cache | Cache, CDN | a read **hits** with the current hit ratio and returns; misses and writes go to the targets |
| broker | Message Queue (competing consumers), Pub/Sub, Event Stream, Kafka (a copy per consumer) | the producer gets an ack; messages wait in a **backlog** that consumers drain at their capacity |
| side | Metrics, Logs, Tracing, Alerting, Health Check, Service Mesh | not in the path; they change what you can see and how fast failures are detected and repaired |
| source | Client, Mobile, Scheduler | generate the load (the scheduler: *N* jobs every *T* seconds) |

### Capacity, utilization and queues

For each node, per tick: the **offered rate** $\lambda$ is the sum of what its callers send (including retries). Its **capacity** is $\mu = \text{healthy replicas} \times \text{capacity per replica}$ (SQL: reads spread over the primary and its read replicas, writes only on the primary; partitioned stores: limited by the busiest partition). The **utilization** is

$$\rho = \frac{\lambda}{\mu}$$

When $\rho < 1$ the mean waiting time in the queue follows Sakasegawa's approximation of the M/M/c queue, where $S$ is the mean service time and $c = \mu \cdot S$ the number of requests the node serves in parallel:

$$W_q \approx S \cdot \frac{\rho^{\sqrt{2(c+1)}-1}}{c\,(1-\rho)}$$

(When the thread pool is the limit, $S$ is the time a request holds a thread and $c$ the number of threads; $\rho$ is averaged over 1 s and capped at 0.98 in the formula.) It is small at $\rho = 0.5$, noticeable at $0.8$ and explodes near $1$ — the **knee** of the latency curve. When $\lambda > \mu$ the excess accumulates in a bounded queue (*queue limit* per replica); its wait is $q / \mu$ and whatever does not fit is **rejected** (503). The utilization bar of each node is green below 0.7, amber below 0.9 and red above.

### Threads and Little's Law

A synchronous service holds a thread (or a DB connection) for the whole time a request spends in it — its own work **and** the time it waits for its dependencies. By **Little's Law** the number of threads busy is

$$L = \lambda \cdot W$$

so a node can complete at most $\text{threads} \times \text{replicas} / W$ requests per second. If a dependency becomes slow, $W$ grows, the threads run out and the node fails **even with its CPU idle** — a cascading failure. The inspector shows $L$ and the Report names the cause (*threads exhausted while CPU at 20%*). A **timeout** on the edge caps how long a thread waits.

### Latency and percentiles

The own work of a node is random: **lognormal** with the median *service time* and a spread per type (a cache ≈ 0.5 ms, a database ≈ 4 ms, an app ≈ 10 ms, an LLM ≈ 1.2 s, a third-party API ≈ 150 ms with a long tail), plus rare GC pauses on app servers. Every tick about 40 synthetic requests walk the graph with the current queue waits, cache hits and misses, failures, timeouts and retries. Their latencies fill log-scale histograms: the tiles show p50/p99 over the last 5 s and the Report shows p50, p95, p99 and p99.9 over the steady window. As in k6 thresholds on `expected_response:true`, **latency percentiles count successful requests**; failures are counted in the error rate.

### Timeouts, retries, circuit breakers, fallbacks, bulkheads

Edge parameters model the resilience patterns of the course. With a probability $p$ that one attempt fails (an error or a timeout) and $r$ retries:

$$\text{load on the target} = \lambda \cdot (1 + p + p^2 + \dots + p^r) \qquad P(\text{call fails}) = p^{\,r+1}$$

When $p$ is close to 1 the target receives up to $(r+1)\times$ the load — a **retry storm**. *Backoff* waits $100\,\text{ms} \times 2^n$ between attempts (*exp+jitter* spreads them randomly), which adds latency and smooths the waves but does not reduce the total in a long outage. A **circuit breaker** opens when more than 50% of the calls fail over 5 s: calls fail at once for 10 s, then a few probe calls (half-open) decide whether to close it. A **fallback** turns a failed call into a degraded answer (counted as success). A **bulkhead** limits the share of the caller's threads one call may hold. An **idempotency key** makes retries to a payment provider safe: without it, a retry after a timeout counts as a possible **duplicate charge**.

### Caches, CDNs and hot keys

A cache with hit ratio $h$ sends only the misses on: database reads $= \text{reads} \times (1-h)$. With *cache-aside* frequent writes invalidate entries and lower $h$; *write-through* keeps it but makes writes slower. After a **flush** the hit ratio starts at 0 and climbs back during the *warm-up*; meanwhile every read misses at once — a **stampede**. *Request coalescing* lets concurrent misses for the same key share one query. Key popularity follows a Zipf law: with $P$ partitions, the busiest one receives $p_1 + (1-p_1)/P$ of the load, where $p_1$ is the share of the hottest key — so a **hot key** saturates a partition no matter how many you add.

### Messaging

A broker accepts messages up to its capacity and keeps them in a backlog. Consumers pull at their own capacity; with Event Stream and Kafka at most $\min(\text{partitions}, \text{consumer replicas})$ consumers work in parallel. A message whose processing fails goes back to the backlog (at-least-once). **Consumer lag** = backlog ÷ successful drain rate. Beyond *max backlog* (retention) messages are dropped, and those publishes count as errors.

### Autoscaling and serverless

With *autoscaling* on, every 15 s a node compares its average **CPU** utilization with the target and sets $\lceil \text{replicas} \times \rho / \text{target} \rceil$ replicas (between min and max); new replicas take traffic after the *warm-up*. The first decision comes at t = 15 s, and a scale-in removes at most half of the replicas at a time. Like a Kubernetes HPA, it watches CPU — a node starved of threads does not scale. A **serverless** function runs one instance per concurrent request: instances $= \lambda \cdot W$. Requests beyond the warm instances land on new ones and pay the **cold start**; beyond the *concurrency limit* they are throttled (429). *Provisioned* instances are always warm (and always billed).

### External services and AI

External APIs (3rd Party, Payment, Email) have a **quota** enforced as a token bucket (2 s of burst): above it they answer 429; they are slower, have a long latency tail and fail more often than your own services. The **LLM Gateway** includes the model call (≈ 1.2 s), a provider quota, a *semantic cache* (similar prompts answered in ≈ 20 ms, no tokens) and an optional *fallback model*. The **Orchestrator** runs the agent loop: each request makes *steps* sequential calls to its LLM and tool edges, so latency and cost grow linearly with the steps. A request path that does not go through a **Safety Mesh** lets prompt-injection attempts (2% of the requests, illustrative) reach the model: the *unsafe answers* metric.

### Cost and availability

The cost tile is **USD per month, illustrative**, extrapolated from the current rates: replicas × price + per-request and per-GB charges (CDN egress, NAT, LLM tokens, function invocations) + observability. The Report also shows the **theoretical availability** of the design from per-replica availabilities, with the series/parallel rules of the course:

$$A_{\text{series}} = \prod_i A_i \qquad A_{\text{parallel}} = 1 - \prod_i (1 - A_i)$$

Measured availability is the share of successful requests over the whole run.

## Load profiles

The profiles use the vocabulary of k6 and of the performance class. *Target RPS* (log slider, 1 to 2 000 000) sets the level.

| Profile | Shape | Duration | Use it to |
|---|---|---|---|
| `smoke` | a few req/s | 30 s | check that the design works at all |
| `load` | ramp 20 s, hold the target, ramp down | 180 s | check the goals at the expected load |
| `stress` | +20% of the target every 20 s, up to 3× | 300 s | see how it degrades beyond the target |
| `spike` | the target, then × N for 30 s (at t = 60 s) | 180 s | test bursts: queues, autoscaling, cold starts |
| `soak` | the target for 15 minutes | 900 s | find slow problems (try *memory leak* on an app) |
| `breakpoint` | linear ramp up to 4× the target, stops when errors > 5% or p99 > 10 × SLO | ≤ 300 s | find the breaking point and the knee |
| `chaos` | ramp 20 s, then the target, with random failures (chaos ≥ medium) | 300 s | game day |

Goals are evaluated over the **steady window** of the profile (shaded in the charts), so the ramp-up does not count; availability uses the whole run.

## Randomness: seeds, chaos and events

All randomness — arrivals, service times, cache hits, which failures happen and when — comes from one **seeded generator**, split into independent streams per purpose. **Same seed + same design + same profile ⇒ the same run**, so you can change one thing and attribute the difference to it. Changing the chaos level does not reshuffle the arrivals. 🎲 draws a new seed; a robust design passes with any seed.

**Chaos** (*off, low, medium, high* = ×0, ×1, ×3, ×8) sets the rate of random events. You can also inject any event yourself with the ⚡ button, and scenarios have **scripted events** at fixed times (e.g. *10:00 — sales open*). Events appear in the **Events** tab and as dashed markers on the charts.

| Event | Effect |
|---|---|
| Replica crash | one replica dies; callers keep sending it requests until a load balancer **detects** it (30 s, or 3 s with a Health Check); it comes back after the repair time (halved with Alerting) |
| Latency degradation | a node or external dependency becomes 5–20× slower for 20–120 s |
| Viral traffic spike | the traffic of the clients × 3–10 for 30–90 s |
| Hot key (celebrity) | key popularity skews: one partition / cache shard concentrates the load |
| Cache flush | the hit ratio drops to 0 and warms up again |
| AZ outage | nodes in that availability zone go down (a node spread over 3 AZs loses a third; a database with standby fails over in ~60 s) |
| Region outage | every node in that region goes down |
| Network partition | one call drops all traffic: callers hang until their timeout |
| 3rd-party outage / throttling | an external service fails or its quota drops to 20% |
| Bad deploy | a service returns 30% errors until rolled back |
| Noisy neighbour | a node loses 30% of its capacity |
| GC pause storm | frequent long pauses on an app server |

## Goals and the test report

Each scenario has 2–4 goals, checked live in the right panel (grey = waiting for the steady window, green = passing, red = failing) and finally in the **Report**. Metrics you will meet: `p99` (ms), `error rate` (%), `availability` (%), `throughput` (req/s), `cost` (USD/month), `consumer lag` (s), `replication lag` (s), `breaking point` (req/s), `duplicate charges`, `unsafe answers` (%), `services measured` (%).

The Report lists the profile, seed and duration; p50/p95/p99/p99.9; error rate and availability; mean throughput and the **maximum throughput within the SLO**; cost; theoretical availability; for *breakpoint* runs, the breaking point and the **knee** (where p99 doubles relative to the start); the **bottleneck** — the first node to pass 85% utilization (or run out of threads, connections or quota) — with an explanation in the terms of the course; the events of the run; and each goal with the hints when one fails. **Copy report (Markdown)** puts it, with a Mermaid diagram of your design, in the clipboard — ready for an exercise submission.

## Observability inside the playground

The observability components change what you can see, as in real life:

- **Metrics**: a service not connected to Metrics shows its utilization as `?` — *you can't fix what you don't measure*. The eye button (*god mode*) reveals everything; it is on by default except in the `observability-stack` scenario.
- **Logs**: the Events tab shows *what* happened and *where* only when a Logs node is connected.
- **Tracing**: enables the **Trace** tab, a waterfall of the slowest sampled request (queue wait hatched).
- **Health Check**: failure detection by load balancers and DNS drops from 30 s to 3 s.
- **Alerting** (connected to Metrics): halves the time to repair a crashed replica.
- **Service Mesh**: services connected to it get +1 ms per call and default timeouts, retries with backoff and circuit breakers; with Metrics connected to the mesh, every attached service is measured.

## Keyboard shortcuts

Shortcuts work when the playground has the focus (click it) and you are not typing in a field; on a focused button, `Space` and `Enter` press the button. `?` shows them. In compact mode the shortcuts that change the structure (`C`, `D`, `Del`, undo) are off.

| Key | Action |
|---|---|
| `Space` | run / pause |
| `S` | advance 1 s |
| `C` | connect the selected node to the next node you click |
| `D` | duplicate the selection |
| `Del` / `⌫` | delete the selection |
| `Ctrl`/`⌘` + `Z`, `Shift` + `Ctrl`/`⌘` + `Z` (or `Ctrl`/`⌘` + `Y`) | undo / redo |
| `F` | fit to screen |
| `+` / `-` | zoom |
| `Tab`, `Enter` | move to a component, select it |
| `Esc` | cancel / deselect |

## Export, import and share

- **Export** (download button) downloads the design and settings as JSON; **Import** (upload button) loads one back. This is the format to submit in the exercises.
- **Share link** (chain button) copies a URL with the design encoded after `#sdp=`; opening it restores the design in the playground of this page.
- **Mermaid** (branch button) copies the design as a `flowchart LR`, ready to paste in a Markdown page or a design document.
- **Full screen** gives the canvas the whole screen.

The JSON of a design is small and readable:

```json
{
  "scenario": "monolith",
  "settings": { "profile": "load", "targetRps": 1500, "readRatio": 0.9, "seed": 7, "chaos": "off" },
  "design": {
    "version": 1,
    "nodes": [
      { "id": "client", "type": "client", "x": 80, "y": 200, "label": "fans", "params": {} },
      { "id": "lb", "type": "lb", "x": 280, "y": 200, "label": "", "params": {} },
      { "id": "app", "type": "app", "x": 480, "y": 200, "label": "boxoffice", "params": { "replicas": 6 } },
      { "id": "db", "type": "sql", "x": 700, "y": 200, "label": "boxoffice-db", "params": {} }
    ],
    "edges": [
      { "id": "client-lb", "from": "client", "to": "lb", "params": {} },
      { "id": "lb-app", "from": "lb", "to": "app", "params": {} },
      { "id": "app-db", "from": "app", "to": "db", "params": { "timeoutMs": 300 } }
    ],
    "frames": []
  }
}
```

## Embedding the playground in a page

Any page of the site can embed the simulator with a scenario preloaded (this is how the classes use it):

```html
<div class="sdp" data-scenario="read-heavy-cache" data-mode="compact" data-height="480"></div>
```

- `data-scenario`: one of the ids of the [scenario guide](scenarios/index.md) (`blank` for an empty canvas).
- `data-mode`: `full` (palette, inspector and all the panels) or `compact` (canvas, run controls, metrics and one chart; nodes can be inspected and their parameters changed, the structure cannot).
- Optional: `data-height` (pixels of the canvas), `data-profile`, `data-seed`, `data-chaos`.

Write a short *Try it* instruction before each embed: what to change, what to observe.

## Limitations

- It is a **fluid model with sampled traces**, not a packet-level simulator: queues hold *rates*, and percentiles come from about 400 sampled requests per simulated second. Very rare events (p99.99) are not resolved.
- Requests are independent; there are no sessions, transactions or locks (seat holds are discussed in the classes, not simulated).
- Network latency between users and the system is not added (the latency shown is server-side), except the +70 ms of calls between regions and +1 ms per hop in a service mesh.
- Capacities and prices are illustrative round numbers. When the playground and a load test disagree, trust the load test — and find out why.
