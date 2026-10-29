It is 09:59 on the day a stadium tour goes on sale on **BoxOffice**. Two million fans are refreshing the event page; 60 thousand seats exist. In the next ten minutes the platform must render the catalog for millions of page views, hold and sell seats without double booking, charge cards through an external payment provider, generate 60 thousand tickets and e-mails, and release seats whose holds expired. At 03:00 the same platform serves a few hundred requests per second.

The edge ([class 4](../edge/index.md)) decides *where* each request goes. This class is about what happens when it arrives: **where the code runs, how it is split into services, how those services talk, what runs outside the request, how the fleet grows and shrinks on its own, and how to depend safely on systems you do not control** — the payment provider, the e-mail provider, any third-party API.

!!! quote "The story so far"

    Chapter 5 of the [story of the course](../../index.md#story). The edge of [class 4](../edge/index.md) spreads the 2 million requests of 10:00 over three `catalog` replicas, and [lab 3](../../hands-on/3/index.md) measured the gain. But a replica can be added, killed or replaced only if it keeps nothing that another replica needs: a seat hold or a login session in a replica's memory dies with it. And BoxOffice now has more services than `catalog`: someone must check the fan's token once, for all of them. **This class** answers: what must a replica be, how is the code split into services, and how do those services depend on each other and on providers we do not control?

!!! abstract "Learning objectives"

    By the end of this class you should be able to:

    - **Explain** why application servers should be stateless and **move** each kind of state (sessions, files, caches, schedules) to the right place.
    - **Estimate** how many replicas a service needs for a given peak, using per-instance capacity and a target utilization.
    - **Compare** a monolith, a modular monolith and microservices, and **justify** service boundaries with bounded contexts and Conway's law.
    - **Choose** an API style (REST, gRPC, GraphQL, asynchronous) for an interaction and **evolve** a contract without breaking its consumers.
    - **Design** background work with queues, workers and schedulers that are safe under retries and multiple replicas.
    - **Decide** between containers and serverless, and **configure** autoscaling (target tracking, HPA, queue-based, scheduled) for a spiky workload.
    - **Integrate** an external provider safely: idempotency keys, verified webhooks, retries with backoff, reconciliation and a plan for provider outages.

## Roadmap

1. **This overview** — the compute palette, stateless app servers, horizontal scaling and how many replicas you need.
2. [Services](services/index.md) — monolith, modular monolith and microservices; DDD bounded contexts; Conway's law; the architecture *inside* a service; auth, search, notifications and analytics as services.
3. [API styles](api-styles/index.md) — REST, gRPC, GraphQL and asynchronous APIs for the same BoxOffice resource; contracts, OpenAPI and versioning.
4. [Async work](async-work/index.md) — workers and background jobs, job design, schedulers, distributed locks and leader election.
5. [Serverless & autoscaling](serverless-autoscaling/index.md) — functions as a service, cold starts and concurrency; autoscaling policies, HPA and why reactive scaling lags a flash sale.
6. [External integrations](integrations/index.md) — 3rd-party APIs, payment and e-mail providers: webhooks with signatures, idempotency keys, retries, reconciliation and provider outages.
7. [Quiz](quiz.md) — check your understanding.

## Slides

<div class="slides-embed">
  <iframe src="slides/compute.html" title="Slides: compute and services" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/compute.html){:target="_blank"}

---

## The compute palette

In the [System Design Playground](../../../playground/index.md), the **COMPUTE** category groups every component that *runs your code*. Each one is a different answer to the question "where does this piece of logic execute, and how does it scale?":

| Component | What it runs | BoxOffice example | Scales on |
|---|---|---|---|
| [App Server](../../reference/components/compute/index.md#app) | Request/response handlers behind a load balancer | `catalog`, `inventory`, `order` | requests per second, CPU |
| [Worker](../../reference/components/compute/index.md#worker) | Jobs pulled from a queue, outside any user request | ticket PDF generation, e-mail sending | queue depth, consumer lag |
| [Serverless](../../reference/components/compute/index.md#serverless) | Short functions started per event by the platform | resize an artist image on upload; receive webhooks | concurrent invocations |
| [Auth Service](../../reference/components/compute/index.md#auth) | Login, tokens, sessions, identity | `auth` issues JWTs for fans and staff | logins per second (spikes at on-sale) |
| [Search](../../reference/components/compute/index.md#search) | Full-text and faceted queries over an index | "coldplay são paulo" → events | queries per second, index size |
| [Scheduler](../../reference/components/compute/index.md#scheduler) | Time-triggered work (cron, delayed jobs) | open the sale at 10:00; release expired holds | number of jobs, precision |
| [Notifications](../../reference/components/compute/index.md#notifications) | Fan-out to e-mail, push and SMS providers | "your tickets are here" | messages per second, provider limits |
| [Analytics](../../reference/components/compute/index.md#analytics) | Event ingestion and aggregation | sales per minute dashboard | events per second |

The rest of this page is about the most common of them — the **app server** — and the property that makes everything else possible: being **stateless**.

---

## Stateless app servers { #stateless-app-servers }

A server is **stateless** when it keeps nothing between requests that another replica would need: any replica can serve any request, because everything that must survive lives *outside* the process — in a database, a cache, an object store or the client itself. That one property is what lets a load balancer send each request anywhere, lets you add replicas in seconds, and lets you kill a replica without losing anything.

``` diagram-sim
flowchart LR
    fan([Fan]) --> lb["Load balancer"]
    lb --> a1["catalog #1"]
    lb --> a2["catalog #2"]
    lb --> a3["catalog #3"]
    a1 --> redis[("Redis<br/>sessions, cache")]
    a2 --> redis
    a3 --> redis
    a1 --> pg[("PostgreSQL")]
    a2 --> pg
    a3 --> pg
    a3 --> s3[("Object store<br/>images, PDFs")]
```

The replicas are interchangeable boxes; the state is in the shared stores on the right. Every kind of state that tends to "stick" to a server has a standard new home:

| State that sticks to a server | Why it breaks scaling | Where it should live |
|---|---|---|
| HTTP session in memory (cart, login) | The next request may hit another replica → "you were logged out" | A signed token on the client (JWT) or a session store (Redis) |
| Uploaded files on local disk | Other replicas cannot see them; lost when the pod dies | Object store (S3, GCS, MinIO) |
| In-process cache | Each replica has a different, stale copy | A distributed cache (Redis) — or accept short TTLs per replica |
| Scheduled jobs inside the app (`@Scheduled`) | With 10 replicas the job runs 10 times | A [scheduler with a lock or a leader](async-work/index.md#schedulers) |
| Counters and rate limits in memory | Each replica counts only its share | Redis (`INCR`) or the API gateway |
| WebSocket connections | A connection *is* state, pinned to one replica | Keep it, but publish messages through pub/sub so any replica can reach any user |

!!! example "BoxOffice: the seat hold"

    When a fan picks seat `C-14`, the `inventory` service creates a **hold** that expires in 10 minutes. A tempting first version keeps the hold in a `ConcurrentHashMap` inside the replica. It works on a laptop and fails in production: the next click goes to another replica, which does not know the hold; a restart forgets every hold; two replicas sell the same seat. The hold must live in the shared store that guarantees "one seat, one hold" — a row in PostgreSQL with a unique constraint (or a Redis key set with `NX` and an expiry). Class 6 ([databases](../databases/index.md)) shows the transaction that makes it safe.

This is factor VI of the *Twelve-Factor App*: "execute the app as one or more stateless processes"[^1]. It does not mean the *system* has no state — it means the state is concentrated in a few components built to hold it, which you then scale with different techniques (replicas, partitions, caches: classes 6 and 7).

!!! warning "Sticky sessions are a crutch"
    A load balancer can pin each user to one replica (*session affinity*). It hides the problem without solving it: load becomes uneven (one replica gets the heavy users), and when that replica dies or is scaled in, its users lose their state. Use affinity only for connection-oriented traffic (WebSockets) or as a temporary step while moving state out.

!!! example "In the BoxOffice code: no session in any replica (lab 4)"

    [Hands-on 4 — Gateway](../../hands-on/4/gateway/index.md) keeps no login session anywhere. The fan's JWT travels on every request, and the gateway checks its signature with the public key of `auth`, fetched once from its JWKS endpoint: no replica remembers the fan, so the gateway can send each request to any of the three `catalog` replicas (`lb://catalog`), and losing one loses nothing. The price is revocation: a token stays valid until it expires (one hour here, `jwt.ttl`), as [Identity](../edge/identity/index.md#gateway-validation) explains.

    ``` { .java title="services/gateway/src/main/java/boxoffice/gateway/SecurityConfig.java (stateless security)" }
    --8<-- "docs/2027.1/hands-on/4/code/services/gateway/src/main/java/boxoffice/gateway/SecurityConfig.java:22:40"
    ```

---

## Scaling up or out

There are two ways to give a service more capacity:

| | **Vertical scaling** (scale up) | **Horizontal scaling** (scale out) |
|---|---|---|
| How | A bigger machine: more vCPUs, more memory | More machines (replicas) behind a load balancer |
| Limit | The biggest instance type; price grows faster than size | The shared stores behind the replicas |
| Availability | One box: its failure is your outage | Replicas cover for each other |
| Downtime to change | Usually a restart | None — add and remove replicas live |
| Requires | Nothing from the code | **Stateless** app servers |
| Good for | Databases, quick fixes, small systems | App servers, workers, anything stateless |

App servers are scaled **out** almost by default, because statelessness makes it trivial. Databases are usually scaled **up** first, then with replicas and partitions — which is why the data tier, not the app tier, is where most bottlenecks end up.

### How many replicas?

The question every design has to answer with a number. Start from one replica's capacity, measured with a load test ([hands-on 2](../../hands-on/2/index.md)), and the peak load from your estimate ([class 2](../estimation/index.md)):

$$
N = \left\lceil \frac{\text{peak RPS}}{\text{RPS per replica} \times \text{target utilization}} \right\rceil + \text{spare}
$$

**Why a target utilization** (typically 50–70%)? Because latency is not linear in load. As a server approaches 100% busy, requests start to queue, and waiting time explodes — the "knee" of the curve ([queueing](../estimation/queueing/index.md)). The target leaves headroom for bursts and for losing a replica.

!!! example "Worked example — the `catalog` service at on-sale"

    Assume (illustrative numbers): one `catalog` replica has 10 vCPUs and spends 20 ms of CPU per request, so it can complete at most 10 / 0.020 = **500 requests/s**. The edge caches most of the static page, and the API receives **4,000 requests/s** at peak.

    - At 100% utilization you would need 4,000 / 500 = **8** replicas — with zero headroom, every burst queues.
    - At a 65% target: 4,000 / (500 × 0.65) ≈ 12.3 → **13** replicas.
    - Add **N + 1** spare (or one zone's worth, if you run in three zones): **14** replicas.

The chart below makes the knee visible. It models each replica as a 10-core server with 20 ms of work per request (an M/M/10 queue) and spreads 4,000 requests/s evenly over N replicas:

```python exec="1" html="1"
import math
from io import StringIO

import matplotlib.pyplot as plt

LAMBDA = 4000.0   # total requests per second
CORES = 10        # servers (cores) per replica
S = 0.020         # seconds of work per request


def mean_latency_ms(n_replicas):
    lam = LAMBDA / n_replicas          # arrival rate per replica
    a = lam * S                        # offered load in Erlangs
    rho = a / CORES
    if rho >= 1:
        return float("inf"), rho
    # Erlang C: probability that a request has to wait
    top = a**CORES / math.factorial(CORES) / (1 - rho)
    bottom = sum(a**k / math.factorial(k) for k in range(CORES)) + top
    p_wait = top / bottom
    wq = p_wait * S / (CORES * (1 - rho))
    return (wq + S) * 1000, rho


ns = list(range(9, 17))
lat, util = zip(*(mean_latency_ms(n) for n in ns))

fig, ax = plt.subplots(figsize=(8, 3.6))
colors = ["#d62728" if u > 0.8 else "#ff7f0e" if u > 0.7 else "#2ca02c" for u in util]
bars = ax.bar([str(n) for n in ns], lat, color=colors)
for b, u in zip(bars, util):
    ax.text(b.get_x() + b.get_width() / 2, b.get_height() + 0.5, f"{u:.0%}",
            ha="center", fontsize=8)
ax.axhline(S * 1000, color="gray", linestyle="--", linewidth=1)
ax.text(len(ns) - 0.6, S * 1000 + 0.8, "pure work: 20 ms", ha="right", fontsize=8, color="gray")
ax.set_xlabel("replicas (label on bar = utilization per replica)")
ax.set_ylabel("mean latency (ms)")
ax.set_title("4,000 req/s on N replicas of 10 cores, 20 ms per request")
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

With 8 replicas the queue grows without limit (100% busy). With 9 replicas (89% busy) the mean latency is about 31 ms — 60% above the 20 ms of real work; from about 12 replicas on, adding more barely changes the mean. And the **tail** (p99) degrades much earlier and much faster than the mean ([percentiles](../estimation/percentiles/index.md)) — another reason to keep utilization moderate.

??? question "Think first: why not just run 100 replicas?"

    Three reasons. **Cost**: you pay for idle capacity all day to cover ten minutes of peak — the motivation for [autoscaling](serverless-autoscaling/index.md). **Shared stores**: 100 replicas × a pool of 20 database connections = 2,000 connections, more than a PostgreSQL server should accept (each connection is a process with its own memory); the bottleneck simply moves to the database. **Diminishing returns**: once queueing is gone, extra replicas do not make a request faster — the 20 ms of work remain.

### Try it in the playground

Open the `scale-out` scenario: a load balancer in front of N app replicas.

1. Run the **load** profile with 2 replicas and note p99 and the error rate.
2. Add replicas one at a time and watch p99 fall until it flattens — the point where queueing is gone.
3. Turn chaos to **medium** to kill replicas at random: health checks remove dead replicas from the pool, and the remaining ones absorb the load only if you left headroom.

<div class="sdp" data-scenario="scale-out" data-mode="compact" data-height="520" data-profile="load"></div>

[:material-open-in-new: Open the full simulator](../../../playground/index.md)

---

## A replica's life cycle { #a-replicas-life-cycle }

Scaling out means replicas are created and destroyed all the time — by deploys, by the autoscaler, by node failures. A replica that behaves well during its life cycle is as important as a stateless one:

``` diagram-sim
stateDiagram-v2
    [*] --> Starting : scheduled on a node
    Starting --> Ready : startup + readiness probe pass
    Ready --> NotReady : readiness fails (e.g. DB unreachable)
    NotReady --> Ready : readiness passes again
    Ready --> Draining : SIGTERM (deploy, scale-in)
    Draining --> [*] : in-flight requests done
    Ready --> [*] : crash / liveness fails → restart
```

- **Start fast, warm up before taking traffic.** A JVM service may need several seconds to start; the readiness probe should pass only once connection pools are open and caches are warm. Slow starts make autoscaling slow ([serverless & autoscaling](serverless-autoscaling/index.md#autoscaling-lag)).
- **Shut down gracefully.** On `SIGTERM`, stop accepting new requests, finish the in-flight ones, then exit. In Spring Boot, `server.shutdown=graceful` with `spring.lifecycle.timeout-per-shutdown-phase=20s` does this.
- **Be disposable** (Twelve-Factor IX): nothing important should depend on a replica living long. Health checks (liveness, readiness, startup) are covered in [reliability](../reliability/index.md).

---

## Compute shapes

The same stateless service can run on very different substrates. The choice changes who manages what, how fast you scale and how you pay:

| Shape | Unit you deploy | Scaling speed | You manage | Pay for | Typical use |
|---|---|---|---|---|---|
| **Virtual machine** | VM image | minutes | OS, runtime, app | provisioned hours | legacy, special hardware, databases |
| **Containers on Kubernetes** | container image | seconds (pod) to minutes (node) | the cluster (or a managed one), the app | nodes, even when idle | the default for services |
| **Serverless containers** (Cloud Run, Fargate, Container Apps) | container image | seconds, to zero | the app | per request or per vCPU-second | APIs with idle periods |
| **Functions (FaaS)** (Lambda, Cloud Functions) | a function | sub-second to seconds, to zero | a function | per invocation and duration | event glue, webhooks, bursty work |

Class 11 ([cloud-native](../cloud-native/index.md)) covers containers and Kubernetes in depth; this class covers the decisions that depend on the *workload*: [serverless and autoscaling](serverless-autoscaling/index.md).

## The compute concept map { #concept-map }

Every compute component answers *where* a piece of logic runs and *how* it scales; the external components are the logic you call but do not run. The map links each **palette component** (green) to the **concepts** it relies on (blue):

``` diagram
flowchart LR
    app["app"]:::comp -.- c1["stateless, scale out,<br/>replica life cycle"]:::tech
    app -.- c2["REST, gRPC, GraphQL,<br/>async APIs"]:::tech
    app --> queue["queue"]:::comp
    queue --> worker["worker"]:::comp
    worker -.- c3["idempotent jobs,<br/>Little's law, DLQ"]:::tech
    scheduler["scheduler"]:::comp --> queue
    scheduler -.- c4["CronJob, locks,<br/>leader election"]:::tech
    serverless["serverless"]:::comp -.- c5["cold start, concurrency,<br/>autoscaling lag"]:::tech
    app --> shared["auth · search ·<br/>notifications · analytics"]:::comp
    shared -.- c6["bounded contexts,<br/>event-fed, own their data"]:::tech
    app --> ext["payment · email ·<br/>thirdparty"]:::comp
    ext -.- c7["idempotency keys, webhooks,<br/>reconciliation"]:::tech
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

| Palette component | Question it answers | Concepts | Taught in | Scenarios |
|---|---|---|---|---|
| [`app`](../../reference/components/compute/index.md#app) | Where does request/response logic run, and how does it scale? | stateless replicas, sizing at 50–70%, life cycle, API contracts | [this overview](#stateless-app-servers), [API Styles](api-styles/index.md) | `monolith`, `scale-out` |
| [`worker`](../../reference/components/compute/index.md#worker) | What runs outside the user's request? | jobs on a queue, workers = rate × time per job, at least once, DLQ | [Async Work](async-work/index.md) | `async-queue` |
| [`scheduler`](../../reference/components/compute/index.md#scheduler) | What runs at a given time — once, not once per replica? | CronJob, distributed lock, leader election, fencing tokens, lazy expiry | [Async Work — schedulers](async-work/index.md#schedulers) | `notification-system` |
| [`serverless`](../../reference/components/compute/index.md#serverless) | What should scale per request, and down to zero? | FaaS, cold starts, concurrency = rate × duration, cost per use | [Serverless & Autoscaling](serverless-autoscaling/index.md) | `serverless-burst` |
| [`auth`](../../reference/components/compute/index.md#auth) | Who is the caller? | identities and tokens, buy before build, validation at the gateway | [Services](services/index.md) | `flash-sale` (login bursts) |
| [`search`](../../reference/components/compute/index.md#search) · [`analytics`](../../reference/components/compute/index.md#analytics) | How do derived views stay off the request path? | derived data, fed by events, rebuildable from the source of truth | [Services](services/index.md) | `search-autocomplete`, `event-fanout` |
| [`notifications`](../../reference/components/compute/index.md#notifications) · [`email`](../../reference/components/external/index.md#email) | How do messages reach fans despite provider limits? | queue-driven workers, provider rate limits, bounces, a secondary provider | [Services](services/index.md), [Integrations — provider outages](integrations/index.md#provider-outages) | `notification-system` |
| [`payment`](../../reference/components/external/index.md#payment) · [`thirdparty`](../../reference/components/external/index.md#thirdparty) | How do we depend on systems we do not control? | adapters, idempotency keys, UNKNOWN outcomes, webhooks, reconciliation | [Integrations](integrations/index.md) | `payment-system`, `cascading-failure`, `retry-storm` |
| *(the whole tier)* | How many replicas, and when? | HPA, KEDA, queue-depth scaling, scheduled scaling, autoscaling lag | [Serverless & Autoscaling — lag](serverless-autoscaling/index.md#autoscaling-lag) | `scale-out`, `flash-sale` |

!!! tip "In the interview"

    State the compute tier in one sentence and move on to the interesting parts: *"The API tier is stateless — sessions are JWTs, files go to the object store — so it sits behind a load balancer and autoscales on CPU and requests per second; I'd size it at about 65% target utilization, which is 13–14 replicas for our 4 k RPS peak."* Interviewers want to hear that you know **where the state went**, and a number. Spend the remaining time on the stateful parts (database, cache, queue), where the real trade-offs are.

!!! success "Best practices"

    - **Make every replica identifiable** — put the instance name in a response header and in every log line, so the one bad replica out of 14 can be found and drained. In BoxOffice: the `InstanceHeaderFilter` of [lab 3](../../hands-on/3/index.md).
    - **Fix each container's CPU and memory, then measure capacity under those limits** — "RPS per replica" in the formula above is only a number when the replica's size is fixed. In BoxOffice: every service in `docker-compose.yaml` has `deploy.resources.limits` (1 CPU, 768 MB), and [lab 2](../../hands-on/2/index.md) measures under them.
    - **Keep one replica (or one zone) of spare capacity above the target utilization** — with 13 replicas at 65%, losing one puts the other 12 at about 70%, still below the knee.
    - **Expose separate liveness and readiness probes** — readiness fails when a dependency is unreachable (stop sending traffic), liveness only when the process is stuck (restart it); one probe for both restarts healthy replicas during a database blip. In BoxOffice: `management.endpoint.health.probes.enabled: true` in every service, from [lab 1](../../hands-on/1/index.md).
    - **Write the connection budget down** — replicas × pool size per service must stay below what the database accepts (the 2,000-connection example above). In BoxOffice: `DB_POOL_SIZE` per service and PgBouncer in [lab 6](../../hands-on/6/replicas/index.md).

!!! warning "Common pitfalls"

    - **Hidden state**: an in-memory map, a local file or an in-process `@Scheduled` job that silently assumes one replica.
    - **Scaling the stateless tier into a wall**: more app replicas multiply connections to the database, which is the real bottleneck.
    - **Sizing for the average**: a fleet sized for 03:00 or for the daily mean melts at 10:00 on sale day.
    - **No headroom for failures**: 100% of capacity used means losing one replica (or one zone) is an outage.
    - **Slow, heavy start-up**: a replica that needs 90 s to become ready cannot help with a spike that lasts 5 minutes.

---

## Related

- Hands-on: [hands-on 1 — first service](../../hands-on/1/index.md) (the `catalog` REST API and its OpenAPI contract), [hands-on 3 — edge](../../hands-on/3/index.md) (three replicas behind Nginx, scale-out measurement), [hands-on 4 — gateway & identity](../../hands-on/4/index.md) (one entry point for every service, the token checked once, no session in any replica), [hands-on 7 — async](../../hands-on/7/index.md) (workers, outbox, idempotent consumer), [hands-on 9 — resilience](../../hands-on/9/index.md) (`order` → `payment` with timeouts and circuit breaker), [hands-on 10 — Kubernetes](../../hands-on/10/index.md) (HPA under a k6 load).
- Exercises: [Kubernetes autoscaling](../../exercises/kubernetes-autoscaling/index.md), [event-driven](../../exercises/event-driven/index.md).
- Case studies: [ticketing (BoxOffice flash sale)](../case-studies/ticketing/index.md), [payment system](../case-studies/payment-system/index.md), [notification system](../case-studies/notification-system/index.md).
- Component catalog: [compute](../../reference/components/compute/index.md) and [external](../../reference/components/external/index.md).

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - The compute tier is easy to scale **because** it is stateless: sessions, files, caches, schedules and counters live in stores built for state.
    - App servers scale **out**; size them as `peak / (capacity per replica × target utilization)` plus spare, and keep utilization around 50–70% because latency explodes near 100%.
    - Replicas are disposable: fast start, readiness before traffic, graceful shutdown.
    - The next pages decide how to split the code into services, how they talk, what runs in the background, how the fleet scales itself, and how to depend on providers you do not control.

## What breaks next { #what-breaks-next }

Stateless replicas are cheap to add because they pushed every piece of state somewhere else, and for BoxOffice that somewhere is PostgreSQL: holds, orders and users now live in the one database that every replica shares. At 10:00 it receives about 33,000 hold attempts per second against the ~1,100 it can serve, and two fans who click seat `A-12` in the same millisecond reach two different replicas, so no lock in a replica's memory can protect the seat. Choosing, using and scaling the store that must say "one seat, one hold" is [class 6 — Databases](../databases/index.md).

---

[^1]: WIGGINS, A. [The Twelve-Factor App](https://12factor.net/){target="_blank"}, factors VI (processes) and IX (disposability). 2011.
