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
| Add a component | Click **+** in the palette (or double-click the item), or drag it onto the canvas. The palette has 49 components in 10 categories: Client, Traffic & edge, Compute, Containers, Storage, Messaging, Observability, Network, AI & agents and External |
| Name it | A new component has no label: its block shows only its type. Type a label in the inspector (the type is the placeholder) and the block shows the name and, below it, the type; clearing the label, or typing the type itself, goes back to the type alone |
| Connect A → B (A calls B) | Drag from the round handle on the right edge of A and drop on B; or select A, press `C`, click B |
| Select | Click a node, an edge or a frame; click the background to see the scenario brief and goals |
| Edit | The inspector (right) shows the description, key numbers, a **Learn more** link to the component catalog, live values and the parameters (slider + number) |
| Move / pan / zoom | Drag a node; drag the background to pan; `Ctrl`/`⌘` + wheel (or pinch) and the ± buttons to zoom; `F` fits the design to the screen |
| Delete, duplicate, undo | `Del`/`⌫`, `D`, `Ctrl`/`⌘`+`Z` and `Shift`+`Ctrl`/`⌘`+`Z` (also in the toolbar) |
| Frames | Add a **VPC** (region), **Subnet** (availability zone) or **Kubernetes Cluster** frame and place nodes inside (a node belongs to a frame when its centre is inside it); drag the frame by its title bar, resize it by the corner. A Kubernetes Cluster runs the services inside it as pods ([see below](#kubernetes-clusters)) |
| Side connections | **Metrics, Logs, Tracing, Alerting, Health Check, Service Registry** and **Service Mesh** are not in the request path: connect them to the services they watch (either direction) |

Edges flow one way: a connection that would create a cycle is refused. An edge into a broker (**Message Queue, Pub/Sub, Event Stream, Kafka**) is asynchronous: the caller only waits for the broker's acknowledgement. Exports (Mermaid, report, events) name a component without a label by its type.

## How the model works { #how-the-model-works }

Time advances in **ticks of 0.1 s** of simulated time; the speed selector runs 1, 5, 20 or 100 ticks' worth per real tenth of a second. Each tick has two parts: a **fluid model** that moves *rates* (requests per second) through the graph, and a sample of **synthetic requests** (traces) that walk the graph to measure latency percentiles.

### Arrivals and requests

Each client generates arrivals from the **load profile** × random noise × traffic events. The number of arrivals in a tick is a Poisson draw with mean $\lambda \cdot \Delta t$, so even a constant target shows realistic jitter. A request is a **read** (share set by *Read %* in the toolbar, or per client) or a **write**; writes usually cost more downstream (a write on SQL uses 3 reads' worth of capacity). Bots (client parameter *bot traffic*) are extra load that a WAF or a rate limiter can stop; goals only count real users.

### How a node routes requests { #how-a-node-routes-requests }

| Role | Components | What happens to a request |
|---|---|---|
| split | DNS, Load Balancer, Ingress (API Gateway for 2+ targets of the same type, except Microservice and Container) | goes to **one** healthy target, in proportion to capacity × edge weight; DNS can be *failover* |
| call | App Server, Microservice, Container, Worker, Auth, Search, Serverless, SQL Database, DB Cluster, Orchestrator, … | calls **every** outgoing edge (subject to the edge *ratio* and *read/write filter*), one after the other (latencies add) or in parallel (the slowest wins) |
| cache | Cache, CDN | a read **hits** with the current hit ratio and returns; misses and writes go to the targets |
| broker | Message Queue (competing consumers), Pub/Sub, Event Stream, Kafka (a copy per consumer) | the producer gets an ack; messages wait in a **backlog** that consumers drain at their capacity |
| side | Metrics, Logs, Tracing, Alerting, Health Check, Service Registry, Service Mesh | not in the path; they change what you can see and how fast failures are detected and repaired |
| source | Client, Mobile, Scheduler | generate the load (the scheduler: *N* jobs every *T* seconds) |
| frame | VPC, Subnet, Kubernetes Cluster | never receives requests; places the nodes inside it in a region, a zone or a cluster |

An **API Gateway** groups its targets by type: 2+ targets of the same type (say, three App Servers) are load-balanced, as by a split node, and different types are all called (say, Auth and then the service). **Microservices and Containers are the exception**: each one is a different service, so the gateway treats each as **its own route** and does not load-balance between them. Choose which requests take which route with the edge *ratio* and *read/write filter* (reads → catalog, writes → order). To scale one service, raise its replicas; do not draw copies of it.

### Capacity, utilization and queues

For each node, per tick: the **offered rate** $\lambda$ is the sum of what its callers send (including retries). Its **capacity** is $\mu = \text{healthy replicas} \times \text{capacity per replica}$ (SQL: reads spread over the primary and its read replicas, writes only on the primary; partitioned stores: limited by the busiest partition; DB Cluster: limited by the busiest shard, [see below](#db-cluster); Container: scaled by the CPU limit, [see below](#containers)). The **utilization** is

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

### Caches, CDNs and hot keys { #caches-cdns-and-hot-keys }

A cache with hit ratio $h$ sends only the misses on: database reads $= \text{reads} \times (1-h)$. With *cache-aside* frequent writes invalidate entries and lower $h$; *write-through* keeps it but makes writes slower. After a **flush** the hit ratio starts at 0 and climbs back during the *warm-up*; meanwhile every read misses at once — a **stampede**. *Request coalescing* lets concurrent misses for the same key share one query. Key popularity follows a Zipf law: with $P$ partitions, the busiest one receives $p_1 + (1-p_1)/P$ of the load, where $p_1$ is the share of the hottest key — so a **hot key** saturates a partition no matter how many you add.

### Messaging

A broker accepts messages up to its capacity and keeps them in a backlog. Consumers pull at their own capacity; with Event Stream and Kafka at most $\min(\text{partitions}, \text{consumer replicas})$ consumers work in parallel. A message whose processing fails goes back to the backlog (at-least-once). **Consumer lag** = backlog ÷ successful drain rate. Beyond *max backlog* (retention) messages are dropped, and those publishes count as errors.

### Autoscaling and serverless

With *autoscaling* on, every 15 s a node compares its average **CPU** utilization with the target and sets $\lceil \text{replicas} \times \rho / \text{target} \rceil$ replicas (between min and max); new replicas take traffic after the *warm-up*. The first decision comes at t = 15 s, and a scale-in removes at most half of the replicas at a time. Like a Kubernetes HPA, it watches CPU — a node starved of threads does not scale. A **serverless** function runs one instance per concurrent request: instances $= \lambda \cdot W$. Requests beyond the warm instances land on new ones and pay the **cold start**; beyond the *concurrency limit* they are throttled (429). *Provisioned* instances are always warm (and always billed).

### Containers { #containers }

A **Container** is a compute node with two extra parameters. Its *CPU limit* $\ell$ is a multiple of the CPU request its capacity is quoted for: it scales the capacity and, below 1, throttles the container (CFS quota), so its own work takes longer:

$$\mu_{\text{replica}} = \text{capacity} \times \ell \qquad \text{median service time} = \frac{\text{service time p50}}{\min(1, \ell)}$$

A limit of 0.5 halves the req/s **and** doubles the service time; a limit above 1 adds req/s but does not make a request faster. Its *start-up time* (default 20 s: image pull + process start + warm-up) replaces the warm-up: it is how long a new replica takes before it gets traffic, whether the autoscaler added it or Kubernetes rescheduled it. A **Microservice** is a compute node with the defaults of a 2-vCPU pod (400 req/s per replica at 8 ms, 2 replicas, 20 s warm-up); what sets it apart is how an API Gateway routes to it ([above](#how-a-node-routes-requests)) and how a cluster schedules it (below).

### Kubernetes clusters { #kubernetes-clusters }

A **Kubernetes Cluster** frame runs, as **pods**, the services whose centre is inside it (a node belongs to the first cluster that contains it). Managed services and external providers never run as pods, even when drawn inside: DNS, CDN, Load Balancer, WAF, Serverless, Object Store, Data Warehouse, DB Cluster, Message Queue, Pub/Sub, Event Stream, NAT, VPN, LLM Gateway and the External components. Every replica of a member is a pod, and the cluster has room for

$$C = \text{ready worker nodes} \times \text{pods per node}$$

pods. A pod is *ready* (serving), *starting* or **Pending** (no room). Every tick:

- Pods beyond $C$ are **Pending**: they do not serve. The block of the service shows *N pending*, the inspector shows them next to the ready and starting replicas, and the frame's title bar shows the live nodes, pods and Pending pods. When the cluster shrinks, the newest pods (starting ones first) are evicted back to Pending.
- Pending pods take the free slots, one service at a time (round robin). A pod that gets a slot starts and takes traffic after its warm-up (the start-up time of a Container) **+ 10 s** for its endpoints to propagate — 0 s when the service is registered in a [Service Registry](#service-discovery).
- The HPA (*Autoscaling* of a member) works as described above, but counts the pods it asked for, scheduled or not, and the pods it adds first wait for a free slot. **The HPA adds pods, never nodes**: when the pods do not fit, they stay Pending and the service stays saturated. A scale-in drops Pending pods first.

With the **cluster autoscaler** on, when the Pending pods are more than the nodes already starting will hold, it starts

$$\text{new nodes} = \left\lceil \frac{\text{Pending} - \text{starting nodes} \times \text{pods per node}}{\text{pods per node}} \right\rceil$$

(up to *max nodes*), each ready after the *node start-up*. It removes one node after 120 s during which no node is starting and all the pods asked for (Pending included) fit on one node fewer — demand $\le (\text{ready} - 1) \times \text{pods per node}$ — and never goes below *Worker nodes*. The cluster costs $(\text{ready} + \text{starting nodes}) \times \text{node price}$; the pods' own price is not counted (per-request charges still are). Defaults: 3 nodes × 10 pods per node, cluster autoscaler off (max 10 nodes), node start-up 90 s, 140 USD/month per node.

A **node failure** (an [event](#randomness-seeds-chaos-and-events)) kills one ready node. It held $\min\left(\text{pods per node}, \lceil \text{pods} \div \text{nodes} \rceil\right)$ pods, spread over the services in proportion to their pods (largest remainder). They stop serving at once, but callers keep sending them requests — which hang, as on any dead replica, for 10 s or until the edge timeout — until they notice, after $\min(\text{detection}, 40\,\text{s})$: 30 s behind a load balancer, 3 s with a Health Check or a Service Registry, 40 s (the node's *NotReady* timeout) on a direct call. After 40 s Kubernetes recreates the lost pods: they become Pending and start only where there is room. The node comes back when the event ends. A service with no pod at all (and no stale endpoint) answers at once with 503 (*no endpoints*).

### Service discovery { #service-discovery }

A **Service Registry** (side node) registers the services connected to it, in either direction. For a registered service:

- **Dead replicas are dropped in 3 s by every caller** — a load balancer, an API gateway or another service calling it directly. Without a registry a direct service-to-service call has no one to detect a crash: a crashed replica keeps receiving its share of the calls (which hang) until it is repaired, and pods lost with a Kubernetes node until the 40 s *NotReady* timeout.
- New pods take traffic as soon as they are ready: no 10 s wait for the endpoints to propagate.

It costs 30 USD/month + 5 per attached service.

### Replicated databases (DB Cluster) { #db-cluster }

A **DB Cluster** has $S$ *shards*, each with a primary that takes its writes and $R$ *followers per shard* that copy them. Defaults: 1 shard, 2 followers, replication `async`, reads from `followers`, failover 30 s, replication round trip 2 ms, and per node 3 000 req/s, 4 ms, 200 connections, write cost 3 and 450 USD/month. Its capacity is

$$\mu_{\text{writes}} = \frac{S \times \text{capacity}}{\text{write cost}} \qquad \mu_{\text{reads}} = S \times (1 + R) \times \text{capacity}$$

when reads go to the followers ($S \times \text{capacity}$ when they go to the primary). Keys follow the Zipf law of the [hot key](#caches-cdns-and-hot-keys): the hottest shard receives $h_1 = p_1 + (1-p_1)/S$ of the requests and each of the others $(1-h_1)/(S-1)$. The busiest shard sets the capacity, so a hot key saturates one shard however many you add; the inspector shows the utilization of the hot shard and of the others.

A write is acknowledged after its replication:

| Replication | Extra latency of a write | Followers behind (lagging) | Lost on a failover |
|---|---|---|---|
| `async` | none | all $R$ | the writes inside the lag |
| `sync` | the round trip to the synchronous follower | $R - 1$ | none |
| `quorum` | the round trip of the $\lfloor (R+1)/2 \rfloor$-th fastest follower | $R - \lfloor (R+1)/2 \rfloor$ | none |

Each round trip is sampled from a lognormal around the *replication round trip*. A **latency degradation** on a DB Cluster slows one follower — the synchronous one: `sync` waits for it on every write, `quorum` (with $R \ge 2$) answers with the faster ones. The followers behind lag

$$\text{lag} \approx 0.02 + \frac{0.5\,\rho_w^3}{1 - \rho_w}\ \text{s}$$

where $\rho_w$ is the write utilization of the busiest primary (the lag grows without limit while $\rho_w \ge 1$). When reads go to the followers, a share of them is **stale** (reads a key written within the lag):

$$\text{stale reads} \approx \frac{\text{followers behind}}{1 + R} \times \text{write share} \times \min\left(1, \frac{\text{lag}}{1\,\text{s}}\right)$$

A **primary failure** ([event](#randomness-seeds-chaos-and-events)) hits one shard. Its writes fail for the *failover time* (the RTO) — its reads too if they go to the primary — then a follower is promoted and the shard runs with one node fewer for 120 s. With `async` replication the writes not yet replicated are lost: $\text{lost writes} \approx \text{shard write rate} \times \text{lag}$ (the RPO); `sync` and `quorum` lose nothing. With $R = 0$ there is no failover: the shard is down for 120 s. An AZ outage causes a primary failure on one shard (the cluster spans the zones). The DB Cluster costs $S \times (1 + R) \times \text{price}$; its theoretical availability is $1 - (1-a)^{1+R}$ per shard, with the shards in series:

$$A = \left[1 - (1-a)^{1+R}\right]^{S}$$

### External services and AI

External APIs (3rd Party, Payment, Email) have a **quota** enforced as a token bucket (2 s of burst): above it they answer 429; they are slower, have a long latency tail and fail more often than your own services. The **LLM Gateway** includes the model call (≈ 1.2 s), a provider quota, a *semantic cache* (similar prompts answered in ≈ 20 ms, no tokens) and an optional *fallback model*. The **Orchestrator** runs the agent loop: each request makes *steps* sequential calls to its LLM and tool edges, so latency and cost grow linearly with the steps. A request path that does not go through a **Safety Mesh** lets prompt-injection attempts (2% of the requests, illustrative) reach the model: the *unsafe answers* metric.

### Cost and availability

The cost tile is **USD per month, illustrative**, extrapolated from the current rates: replicas × price + per-request and per-GB charges (CDN egress, NAT, LLM tokens, function invocations) + observability. Inside a Kubernetes Cluster you pay for the worker nodes, not the pods; a DB Cluster bills every node of every shard; a Service Registry costs 30 + 5 per attached service. The Report also shows the **theoretical availability** of the design from per-replica availabilities, with the series/parallel rules of the course:

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

## Randomness: seeds, chaos and events { #randomness-seeds-chaos-and-events }

All randomness — arrivals, service times, cache hits, which failures happen and when — comes from one **seeded generator**, split into independent streams per purpose. **Same seed + same design + same profile ⇒ the same run**, so you can change one thing and attribute the difference to it. Changing the chaos level does not reshuffle the arrivals. 🎲 draws a new seed; a robust design passes with any seed.

**Chaos** (*off, low, medium, high* = ×0, ×1, ×3, ×8) sets the rate of random events. You can also inject any event yourself with the ⚡ button, and scenarios have **scripted events** at fixed times (e.g. *10:00 — sales open*). Events appear in the **Events** tab and as dashed markers on the charts.

| Event | Effect |
|---|---|
| Replica crash | one replica dies; callers keep sending it requests until a load balancer **detects** it (30 s, or 3 s with a Health Check or when the service is registered in a Service Registry); a direct call detects it only through a Service Registry (3 s) — without one, the dead replica keeps its share of the calls until it is repaired; it comes back after the repair time (halved with Alerting) |
| Latency degradation | a node or external dependency becomes 5–20× slower for 20–120 s (on a DB Cluster: one follower, the synchronous one, becomes slower) |
| Viral traffic spike | the traffic of the clients × 3–10 for 30–90 s |
| Hot key (celebrity) | key popularity skews: one partition / cache shard / DB Cluster shard concentrates the load |
| Cache flush | the hit ratio drops to 0 and warms up again |
| AZ outage | nodes in that availability zone go down (a node spread over 3 AZs loses a third; a database with standby fails over in ~60 s; a DB Cluster loses the primary of one shard) |
| Region outage | every node in that region goes down |
| Network partition | one call drops all traffic: callers hang until their timeout |
| 3rd-party outage / throttling | an external service fails or its quota drops to 20% |
| Bad deploy | a service returns 30% errors until rolled back |
| Noisy neighbour | a node loses 30% of its capacity |
| GC pause storm | frequent long pauses on an app server |
| Node failure | (Kubernetes Cluster) one ready worker node dies with its pods (≈ ⌈pods ÷ nodes⌉, spread over the services); callers keep sending them requests until they notice (min(detection, 40 s)); the lost pods are recreated after 40 s, Pending if there is no room; the node comes back when the event ends (2–5 min) |
| Primary failure | (DB Cluster) the primary of one shard dies: its writes fail for the failover time (its reads too if they go to the primary), then a follower is promoted and the shard has one node fewer for 120 s; with `async` replication the writes inside the lag are lost; with no followers the shard is down for 120 s |

*Node failure* and *Primary failure* only apply to a Kubernetes Cluster and a DB Cluster: designs without those components never draw them, and their sequence of random events does not change. A DB Cluster never has a *Replica crash*: its failures are primary failures.

## Goals and the test report

Each scenario has 2–4 goals, checked live in the right panel (grey = waiting for the steady window, green = passing, red = failing) and finally in the **Report**. Metrics you will meet: `p99` (ms), `error rate` (%), `availability` (%), `throughput` (req/s), `cost` (USD/month), `consumer lag` (s), `replication lag` (s), `breaking point` (req/s), `duplicate charges`, `unsafe answers` (%), `services measured` (%), `lost writes` (writes lost in failovers of a DB Cluster), `stale reads` (% of the reads of a DB Cluster), `p99 (writes)` (ms, successful writes only).

The Report lists the profile, seed and duration; p50/p95/p99/p99.9; error rate and availability; mean throughput and the **maximum throughput within the SLO**; cost; theoretical availability; for *breakpoint* runs, the breaking point and the **knee** (where p99 doubles relative to the start); the **bottleneck** — the first node to pass 85% utilization (or run out of threads, connections or quota, or wait for Pending pods) — with an explanation in the terms of the course; the events of the run; and each goal with the hints when one fails. **Copy report (Markdown)** puts it, with a Mermaid diagram of your design, in the clipboard — ready for an exercise submission.

## Observability inside the playground

The observability components change what you can see, as in real life:

- **Metrics**: a service not connected to Metrics shows its utilization as `?` — *you can't fix what you don't measure*. The eye button (*god mode*) reveals everything; it is on by default except in the `observability-stack` scenario.
- **Logs**: the Events tab shows *what* happened and *where* only when a Logs node is connected.
- **Tracing**: enables the **Trace** tab, a waterfall of the slowest sampled request (queue wait hatched).
- **Health Check**: failure detection by load balancers and DNS drops from 30 s to 3 s.
- **Alerting** (connected to Metrics): halves the time to repair a crashed replica.
- **Service Registry**: every caller of a registered service — load balancer or direct call — drops a dead replica in 3 s, and new pods take traffic without the 10 s endpoint delay.
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
- A Kubernetes cluster is a count of slots (nodes × pods per node): there is no bin packing by CPU and memory, no affinity rules and no pod disruption budgets, and the pods are spread evenly over the nodes.
- Network latency between users and the system is not added (the latency shown is server-side), except the +70 ms of calls between regions and +1 ms per hop in a service mesh.
- Capacities and prices are illustrative round numbers. When the playground and a load test disagree, trust the load test — and find out why.
