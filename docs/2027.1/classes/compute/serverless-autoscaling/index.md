Look at a day of BoxOffice traffic. From midnight to 09:45 the API serves a few hundred requests per second. At 10:00, when a stadium tour goes on sale, it jumps to tens of thousands — in seconds. By 10:30 it is back to normal. The same shape repeats a few times a week, at times announced in advance, plus surprises (an artist posts the link on social media at 23:00).

Two bad options: size the fleet for the peak and pay for idle machines 99% of the time, or size it for the average and fall over at 10:00. This page covers the two families of tools that avoid both — **serverless platforms**, which scale per request and charge per use, and **autoscaling**, which grows and shrinks a fleet of replicas based on metrics or schedules — and the uncomfortable truth they share: **scaling takes time**, and a flash sale does not wait.

---

## Serverless

**Serverless** means you deploy code and the platform provisions, scales and bills the machines underneath, including **scaling to zero** when there is no traffic. Two shapes dominate:

- **Functions as a Service (FaaS)** — AWS Lambda, Google Cloud Run functions, Azure Functions: you deploy a *function*, the platform calls it once per event (an HTTP request, a queue message, a file upload, a schedule).
- **Serverless containers** — Google Cloud Run, AWS Fargate (with ECS), Azure Container Apps: you deploy a *container image* that serves HTTP; the platform runs as many instances as the traffic needs, down to zero.

The idea has been described as "cloud programming simplified"[^1]: no servers to patch, no capacity to plan, pay only for what runs. The constraints are the price.

### How a function runs

``` diagram-sim
sequenceDiagram
    participant E as Event source
    participant P as Platform
    participant X as Execution environment
    E->>P: invoke (request 1)
    P->>X: no warm environment → create sandbox
    Note over X: INIT: download code, start runtime, run init code (cold start)
    X-->>P: ready
    P->>X: handle request 1
    X-->>E: response
    E->>P: invoke (request 2)
    P->>X: reuse the warm environment
    X-->>E: response (no cold start)
    Note over X: idle for a while → frozen, later destroyed
```

Each **execution environment** (a lightweight VM or sandbox) handles **one request at a time** in Lambda; a burst of 300 simultaneous requests needs 300 environments. Environments are reused while traffic continues and destroyed after some idle time[^2]. Everything follows from that model:

- **Cold start**: the first request on a new environment pays for creating it. For a small Python or Node.js function this is typically a few hundred milliseconds; for a Spring Boot application on a plain JVM it can be several seconds (illustrative ranges — measure your own).
- **Concurrency = rate × duration** (Little's law again): 2,000 requests/s × 0.2 s = **400 concurrent environments**. Halving the duration halves the concurrency — and the bill.
- **State dies with the environment**: anything kept in memory or on the local disk may vanish between requests; it is the stateless rule from the [overview](../index.md#stateless-app-servers), enforced.

### Cold starts and how to reduce them

| Technique | What it does | Cost |
|---|---|---|
| **Keep init cheap** | fewer dependencies, lazy loading, smaller package | engineering time |
| **Initialize outside the handler** | DB clients and SDKs created once per environment, reused by every request | none — always do it |
| **Provisioned concurrency / minimum instances** | the platform keeps N environments warm | you pay for them while idle — partly undoing "pay per use" |
| **Snapshot restore** (Lambda SnapStart) | starts from a snapshot of an already-initialized runtime (Java, Python, .NET) | restrictions on unique state at init (random seeds, connections) |
| **Native compilation** (GraalVM native image, Spring AOT) | a Java service starts in tens of milliseconds | longer builds; some reflection limits |
| **Choose the runtime** | Go, Node.js and Python start faster than a full JVM | may not match the team's stack |

Cold starts matter on **latency-critical, user-facing** paths with spiky traffic. They do not matter for a queue consumer rendering ticket PDFs, where an extra second is invisible.

### Concurrency limits protect — and throttle

Serverless scales fast, but not infinitely:

- **Account and function limits**: AWS Lambda has a default quota of 1,000 concurrent executions per Region shared by all functions of the account (it can be raised), and each function scales up by at most 1,000 environments every 10 seconds[^2]. Beyond the limit, invocations are **throttled** (`429`), and asynchronous events are retried later.
- **Reserved concurrency** caps one function so it cannot starve the others — and also caps the load it can put on a downstream.
- **Instance concurrency**: serverless containers such as Cloud Run let one instance serve several requests at once (80 by default)[^3], which means far fewer instances — and fewer cold starts — for I/O-bound services.

!!! warning "Serverless scales; your database does not"
    1,000 concurrent functions, each opening a connection, means 1,000 connections to a PostgreSQL server that comfortably handles a few hundred. The function tier scaled perfectly and took the database down. Put a **connection pooler** (RDS Proxy, PgBouncer) or a **queue** between them, and set reserved concurrency to what the downstream can take.

### Cost: per use vs always on

FaaS bills per invocation plus **GB-seconds** (memory × duration). Containers bill for provisioned capacity whether used or not. Which is cheaper depends on how *busy* the service is. The chart uses illustrative list prices (AWS Lambda x86 in us-east-1 at the time of writing: US$ 0.20 per million requests and US$ 0.0000166667 per GB-second; a container replica at an assumed US$ 60/month, each handling up to 300 requests/s, minimum two for availability) — check current prices before using them in a real decision.

```python exec="1" html="1"
import math
from io import StringIO

import matplotlib.pyplot as plt

PER_REQUEST = 0.20 / 1e6            # USD per invocation
PER_GB_S = 0.0000166667             # USD per GB-second
MEMORY_GB, DURATION_S = 0.5, 0.1    # 512 MB, 100 ms average
REPLICA_MONTH, REPLICA_RPS = 60.0, 300.0
SECONDS_PER_MONTH = 30 * 24 * 3600

xs = [10 ** (6 + i / 20) for i in range(0, 81)]          # 1 M .. 10 B requests / month
faas = [r * (PER_REQUEST + MEMORY_GB * DURATION_S * PER_GB_S) for r in xs]
containers = []
for r in xs:
    peak_rps = 3 * r / SECONDS_PER_MONTH                  # assume peak = 3 x average
    containers.append(max(2, math.ceil(peak_rps / (REPLICA_RPS * 0.65))) * REPLICA_MONTH)

fig, ax = plt.subplots(figsize=(8, 3.6))
ax.plot(xs, faas, label="functions (pay per use)", color="#1f77b4")
ax.step(xs, containers, where="post", label="containers (min 2 replicas)", color="#ff7f0e")
ax.set_xscale("log")
ax.set_yscale("log")
ax.set_xlabel("requests per month")
ax.set_ylabel("USD per month (illustrative)")
ax.set_title("Monthly cost: functions vs always-on containers")
ax.legend(fontsize=8)
ax.grid(True, which="major", alpha=0.3)
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

With these assumptions each invocation costs about US$ 1 per million, so functions are far cheaper below roughly a hundred million requests per month (a few dozen requests per second on average), and containers win for steady, busy services. Spiky, mostly idle workloads favor serverless; steady high-volume ones favor provisioned capacity. FinOps ([cloud-native](../../cloud-native/index.md)) builds on this calculation.

### The landscape

=== "AWS"

    - **Lambda** (functions; triggers from API Gateway, SQS, S3, EventBridge, Kinesis/Kafka).
    - **Fargate** (serverless containers under ECS or EKS).
    - **App Runner** (container web services). Edge: **CloudFront Functions**, **Lambda@Edge**.

=== "Google Cloud"

    - **Cloud Run** (serverless containers, concurrency per instance, scale to zero) and **Cloud Run functions**.
    - Triggers via **Eventarc**, **Pub/Sub**, **Cloud Scheduler**, **Cloud Tasks**.

=== "Azure"

    - **Azure Functions** (consumption and premium plans with pre-warmed instances).
    - **Azure Container Apps** (serverless containers, KEDA-based scaling).

=== "Open source / Kubernetes"

    - **Knative** (serverless containers on Kubernetes, scale to zero).
    - **KEDA** (event-driven autoscaling of any Deployment, including to zero).
    - **OpenFaaS**. Edge runtimes: **Cloudflare Workers** (V8 isolates with very fast start).

!!! example "Where BoxOffice uses serverless"

    - **Webhook receiver** for the payment provider: bursty, tiny, must always answer — verify the signature, store the event, enqueue, return `200` ([integrations](../integrations/index.md#webhooks)).
    - **Image processing** when the marketing team uploads artist photos: triggered by the object store, minutes of idle between bursts.
    - **Not** for `inventory`: it holds hot connections to the database, needs predictable p99 during on-sale and runs all day — containers with autoscaling fit better.

### Try it in the playground

Open the `serverless-burst` scenario: a serverless function behind an API receives a burst.

1. Run the **spike** profile and look at p99 during the first seconds: the cold-start penalty.
2. Lower the function's **concurrency limit** until throttled requests (errors) appear; then raise it and watch what happens to the database behind it.
3. Compare the live **cost** with the same load on a container tier (swap the node for an App Server with autoscaling).

<div class="sdp" data-scenario="serverless-burst" data-mode="compact" data-height="520" data-profile="spike"></div>

[:material-open-in-new: Open the full simulator](../../../../playground/index.md)

---

## Autoscaling

**Autoscaling** adjusts capacity automatically. It operates at three levels, which must work together:

| Level | What changes | Kubernetes | Cloud VMs |
|---|---|---|---|
| **Horizontal** | number of replicas | HorizontalPodAutoscaler (HPA), KEDA | Auto Scaling groups, managed instance groups |
| **Vertical** | CPU/memory of each replica | VerticalPodAutoscaler (VPA) | instance type (usually with a restart) |
| **Infrastructure** | number of nodes the replicas run on | Cluster Autoscaler, Karpenter | — |

The HPA adds pods, but if no node has room, the pods stay `Pending` until the cluster autoscaler adds a node — which takes much longer. Both loops matter for the response time.

### Policies

| Policy | How it decides | Good for | Weakness |
|---|---|---|---|
| **Target tracking** | keep a metric near a target ("CPU at 60%") | most services | reacts after the load arrives |
| **Step scaling** | add k replicas when a metric crosses thresholds | coarse, explicit rules | tuning; still reactive |
| **Scheduled** | change min/max at given times | **known** events: on-sale at 10:00, business hours | only as good as the calendar |
| **Predictive** | forecast from history (e.g. daily cycles) and scale ahead | strong, regular daily or weekly patterns | useless for one-off events |
| **Queue-based** | replicas proportional to backlog or lag | workers ([async work](../async-work/index.md)) | max parallelism may be capped (Kafka partitions) |

### The Kubernetes HPA

Every 15 seconds (by default) the HPA computes[^4]:

$$
\text{desiredReplicas} = \left\lceil \text{currentReplicas} \times \frac{\text{currentMetric}}{\text{targetMetric}} \right\rceil
$$

Six `catalog` replicas at 90% CPU with a 60% target: ⌈6 × 90 / 60⌉ = **9 replicas**. It ignores changes within a 10% tolerance, and uses **stabilization windows** so that it does not oscillate (scale-down waits 5 minutes by default).

```yaml title="catalog-hpa.yaml"
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: catalog
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: catalog
  minReplicas: 4                 # never below N+1 across zones
  maxReplicas: 40                # bounded by what the database can take
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60   # % of the CPU *request* of each pod
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Percent
          value: 100               # at most double every 15 s
          periodSeconds: 15
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 20                # remove at most 20% per minute
          periodSeconds: 60
```

CPU utilization is measured relative to the pod's CPU **request**, so the HPA only works if requests are set (and realistic). [Hands-on 10](../../../hands-on/10/index.md) runs a laptop-sized version of this HPA under a k6 load (box below).

!!! example "In the BoxOffice code: the `catalog` HPA (lab 10)"

    [Hands-on 10 — Autoscaling](../../../hands-on/10/autoscaling/index.md) keeps the 60% target and the "double every 15 s" scale-up, and changes the numbers to fit a laptop: 2 to 8 pods instead of 4 to 40, a second scale-up policy of `+2 pods` (whichever adds more), and a 2-minute scale-down window instead of 5 so you can watch the pods leave within the lab. The 60% is relative to the pod's request of `250m`, so the HPA adds pods when they average more than 150 millicores. What the lab shows is the [lag](#autoscaling-lag): each new pod needs tens of seconds before it is ready, and p95 rises during the ramp before it comes back down. The upper bound is the database: 8 pods × 10 connections = 80 connections to one PostgreSQL.

    ``` { .yaml title="k8s/base/catalog-hpa.yaml (lab 10)" }
    --8<-- "docs/2027.1/hands-on/10/code/k8s/base/catalog-hpa.yaml"
    ```

### Choosing the metric

| Metric | Use when | Caveat |
|---|---|---|
| CPU utilization | CPU-bound services (rendering, JSON-heavy APIs) | I/O-bound services look idle while saturated |
| Requests per second per replica | you know a replica's capacity from load tests | needs custom metrics (Prometheus adapter) |
| In-flight requests / concurrency | I/O-bound services, long requests | needs instrumentation |
| Queue depth or consumer lag | workers | the max useful replicas may be capped (partitions) |
| Latency | almost never alone | it rises for many reasons, including a slow downstream that more replicas would make *worse* |

### Scaling workers on queue depth { #scaling-workers-on-queue-depth }

**KEDA** (Kubernetes Event-Driven Autoscaling) feeds the HPA with metrics from event sources — Kafka lag, SQS depth, RabbitMQ queue length, Prometheus queries, cron — and can scale a Deployment **to zero** when there is nothing to do[^5]:

```yaml title="ticket-worker-scaledobject.yaml"
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: ticket-worker
spec:
  scaleTargetRef:
    name: ticket-worker            # the Deployment
  minReplicaCount: 1
  maxReplicaCount: 24              # = partitions of order.confirmed.v1
  cooldownPeriod: 120
  triggers:
    - type: kafka
      metadata:
        bootstrapServers: kafka:9092
        consumerGroup: ticket-worker
        topic: order.confirmed.v1
        lagThreshold: "200"        # target lag per replica
```

With a lag of 4,800 messages and a threshold of 200, KEDA asks for 24 replicas — the cap, because a Kafka consumer group cannot use more consumers than the topic has partitions ([messaging](../../messaging/index.md)).

---

## Autoscaling lag { #autoscaling-lag }

Reactive autoscaling has a built-in delay: the load must arrive, be measured, trigger a decision, and the new capacity must start and warm up. Each step is small; together they are minutes:

| Step | Typical duration (illustrative) |
|---|---|
| Metrics collected and aggregated | 15–60 s |
| HPA evaluation loop | up to 15 s |
| Pod scheduled — if a node has room | ~1 s |
| New node provisioned — if not | 30–120 s |
| Image pulled (not cached on the node) | 5–60 s |
| JVM start, Spring context, connection pools, cache warm-up | 10–60 s |
| Readiness probe passes, load balancer adds the pod | 5–10 s |
| **Total** | **~1 to 4 minutes** |

A flash sale goes from 1× to 20× in seconds (here, 1,000 to 20,000 req/s in 20 s). The simulation below compares a reactive autoscaler (target 60%, doubling at most every 15 s, new replicas ready after 90 s) with the same autoscaler plus a **scheduled** pre-scale at 09:45 to the forecast, 20,000 / (500 × 0.6) ≈ 67 replicas:

```python exec="1" html="1"
import math
from io import StringIO

import matplotlib.pyplot as plt

REPLICA_RPS = 500.0      # capacity of one replica
TARGET = 0.6             # target utilization
WARMUP = 90              # seconds until a new replica serves traffic
T0, T1 = -900, 900       # from 09:45 to 10:15, in seconds relative to 10:00


def demand(t):
    if t < 0:
        return 1000.0
    return 1000.0 + 19000.0 * min(1.0, t / 20.0)           # 20k req/s within 20 s


def simulate(prescale_to):
    ready, pending = 3, []                                 # pending: (ready_at, count)
    xs, cap = [], []
    for t in range(T0, T1):
        if t == T0 and prescale_to:
            pending.append((t + WARMUP, prescale_to - ready))
        ready += sum(c for at, c in pending if at == t)
        pending = [(at, c) for at, c in pending if at != t]
        if t % 15 == 0:                                    # HPA loop
            total = ready + sum(c for _, c in pending)
            util = demand(t) / (ready * REPLICA_RPS)
            desired = math.ceil(ready * util / TARGET)
            desired = min(desired, 2 * total)              # at most double per period
            if desired > total:
                pending.append((t + WARMUP, desired - total))
        xs.append(t / 60)
        cap.append(ready * REPLICA_RPS / 1000)
    return xs, cap


xs, reactive = simulate(None)
_, scheduled = simulate(67)
need = [demand(t) / 1000 for t in range(T0, T1)]

fig, ax = plt.subplots(figsize=(8, 3.6))
ax.plot(xs, need, color="black", linewidth=1.5, label="demand")
ax.plot(xs, reactive, color="#d62728", label="capacity: reactive only")
ax.plot(xs, scheduled, color="#2ca02c", linestyle="--", label="capacity: pre-scaled at 09:45 to 67")
ax.fill_between(xs, reactive, need, where=[n > r for n, r in zip(need, reactive)],
                color="#d62728", alpha=0.15)
ax.set_xlabel("minutes relative to 10:00 (on-sale)")
ax.set_ylabel("thousand req/s")
ax.set_title("Reactive autoscaling lags a flash sale")
ax.legend(fontsize=8, loc="center left")
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

The red area is demand above capacity: requests that queue, time out or are rejected — in the first minutes of the sale, exactly when it matters most. Reactive scaling eventually catches up, but **after** the fans had a bad time.

### Scheduled and predictive scaling { #scheduled-and-predictive-scaling }

When you know the spike is coming, **do not wait for metrics**:

- **Scheduled scaling**: at 09:45 raise `minReplicas` (or the Auto Scaling group's minimum) to the forecast for 10:00, and bring it back down at 10:45. With KEDA, a `cron` trigger does exactly this.
- **Pre-warm everything the replicas need**: nodes (overprovisioning with low-priority "placeholder" pods that get evicted when real pods need the room), images pulled, caches filled, database connection pools opened.
- **Predictive scaling** (e.g. AWS predictive scaling) learns daily and weekly cycles from history and scales ahead of them. It helps with the regular evening peak, not with a one-off on-sale.

And when even that is not enough — two million fans for 60 thousand seats — capacity is not the answer at all: a **waiting room** admits fans at the rate the system can serve, **rate limiting** stops bots, and **load shedding** rejects excess early and cheaply ([edge](../../edge/index.md), [reliability](../../reliability/index.md)). The `flash-sale` scenario in the [playground](../../../../playground/index.md) combines all of them.

### Scaling in, safely

Scaling down causes incidents too:

- **Flapping**: scaling down as soon as load dips, then up again; stabilization windows and slow scale-down policies prevent it.
- **Killing in-flight work**: replicas must drain on `SIGTERM` (graceful shutdown, [overview](../index.md#a-replicas-life-cycle)); workers must stop taking jobs and finish or release the current one.
- **Scaling to zero** saves money but brings back the cold start for the next request; keep a minimum on user-facing paths.

!!! warning "Do not autoscale into a wall"
    Set `maxReplicas` from the **downstream budget**, not from hope. If PostgreSQL accepts 500 connections and each replica holds a pool of 20, more than 25 replicas will fail to connect — and the autoscaler, seeing high latency, will add more. Use a connection pooler (PgBouncer), smaller pools, or caches to reduce database load, and alert when the HPA sits at its maximum.

---

## Containers or serverless?

| | Containers + HPA (Kubernetes) | Serverless containers (Cloud Run, Fargate) | Functions (Lambda) |
|---|---|---|---|
| Scale-up speed | pods: seconds; nodes: minutes | seconds | sub-second to seconds per environment |
| Scale to zero | with KEDA/Knative | yes | yes |
| Cold start | per new pod (JVM: seconds) | per instance | per environment, more frequent |
| Concurrency per instance | many requests | many requests (configurable) | one request (Lambda) |
| Long-lived connections, WebSockets | yes | limited | via a managed gateway only |
| Max request duration | unlimited | minutes (platform limit) | 15 min (Lambda) |
| Cost shape | pay for provisioned nodes | pay per use (CPU-seconds), min instances optional | pay per invocation + GB-seconds |
| Operational effort | highest (cluster) | low | lowest |
| Best for | steady, busy core services | APIs with idle periods, small teams | event glue, webhooks, bursty jobs |

!!! tip "In the interview"

    When the problem has spikes, say explicitly that **autoscaling is not instantaneous**: *"Reactive scaling takes one to a few minutes — metrics, decision, node, image, JVM warm-up — so for a known on-sale I'd pre-scale on a schedule at 09:45, and for unknown spikes rely on headroom, a waiting room and load shedding while the HPA catches up."* Name the metric (*"CPU for catalog, consumer lag for the ticket workers via KEDA"*), the bounds (*"max replicas limited by the database's connections"*) and, if you propose serverless, its limits (*"cold starts, concurrency quotas, connections to the database — I'd put RDS Proxy in front"*).

!!! success "Best practices"

    - **Pre-scale for known events** — raise `minReplicas` (or schedule the change) about 15 minutes before 10:00; reactive scaling is for the load you did not expect. In BoxOffice: the conclusion of [lab 10](../../../hands-on/10/autoscaling/index.md).
    - **Set CPU requests from a load test** — the request is the CPU one pod uses at its target throughput; the HPA's 60% is a fraction of that number, so a guessed request means a guessed trigger. In BoxOffice: `250m` for `catalog` (lab 10).
    - **Scale up fast and down slowly** — double every 15 s on the way up, remove a few pods per minute after a window of minutes on the way down, so a dip between two waves of fans does not remove capacity needed a minute later. In BoxOffice: `catalog-hpa.yaml` (box above).
    - **Load-test the scaling, not only the service** — a ramp that logs desired vs ready replicas measures the lag that your headroom must cover. In BoxOffice: `load/catalog-hpa.js` and `scripts/watch-hpa.sh` (lab 10).
    - **Cap function concurrency and set a budget alarm** — reserved concurrency protects the database behind the functions, and a billing alarm catches a runaway loop in hours instead of at the end of the month.

!!! warning "Common pitfalls"

    - **Assuming instant elasticity**: the first minutes of a spike are served by whatever was already running.
    - **No CPU requests on pods**: the HPA has nothing to compute utilization against.
    - **Scaling on the wrong metric**: CPU for I/O-bound services; latency that rises because of a slow downstream.
    - **`maxReplicas` above what the database can take**: the autoscaler turns slowness into an outage.
    - **Serverless in front of a fixed-size database** without a pooler or reserved concurrency.
    - **Heavy initialization** inside the handler instead of once per environment.
    - **Runaway cost**: a function that triggers itself (writes to the bucket that triggers it) or an unbounded retry loop scales to the quota and bills accordingly — set budgets and alarms.

---

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    FAAS["functions per event"] --> COLD["cold starts,<br/>provisioned concurrency"]
    FAAS --> CONC["concurrency = rate × duration<br/>quotas, throttling"]
    CONC --> DOWN["the database does not scale with it<br/>→ Databases"]
    FAAS --> COST["per use vs always on<br/>→ FinOps"]
    AS["autoscaling"] --> HPA["HPA, KEDA, VPA, node autoscalers<br/>→ Kubernetes"]
    HPA --> MET["metric: CPU, RPS,<br/>concurrency, queue lag"]
    AS --> LAG["minutes of lag"]
    LAG --> SCHED["scheduled scaling + pre-warm<br/>for the 10:00 on-sale"]
    LAG --> PROT["waiting room, rate limiting,<br/>load shedding → Reliability"]
    HPA --> MAX["maxReplicas from<br/>the downstream budget"]
    MAX --> DOWN
```

**Palette components:** [`serverless`](../../../reference/components/compute/index.md#serverless) (webhooks, image resizing, bursty glue) · [`app`](../../../reference/components/compute/index.md#app) (the containers the HPA scales) · [`worker`](../../../reference/components/compute/index.md#worker) (KEDA on queue lag) · [`queue`](../../../reference/components/messaging/index.md#queue) (the lag signal) · [`sql`](../../../reference/components/storage/index.md#sql) (the connection budget that caps `maxReplicas`) · [`apigw`](../../../reference/components/edge/index.md#apigw) (rate limiting while capacity catches up) · [`metrics`](../../../reference/components/observability/index.md#metrics) (what the autoscaler reads). **Scenarios:** `serverless-burst`, `scale-out`, `async-queue`, `flash-sale`. **Continues in:** [Cloud-native — Kubernetes](../../cloud-native/kubernetes/index.md), [Cloud-native — FinOps](../../cloud-native/finops/index.md), [Reliability — load shedding](../../reliability/patterns/index.md#load-shedding), [Estimation — queueing](../../estimation/queueing/index.md), [Exercise: Kubernetes autoscaling](../../../exercises/kubernetes-autoscaling/index.md).

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - **Serverless** scales per request and bills per use; mind **cold starts**, **concurrency = rate × duration**, account quotas and the **downstream** that does not scale with it.
    - It is cheapest for spiky, mostly idle work; always-on containers win for steady, busy services.
    - **Autoscaling** works on replicas (HPA, KEDA), replica size (VPA) and nodes (Cluster Autoscaler, Karpenter); pick the metric that reflects saturation — CPU, RPS, concurrency or **queue lag**.
    - Reactive scaling lags by **minutes**; for known peaks, **scale on a schedule** and pre-warm; for unknown ones, keep headroom and protect the system with waiting rooms, rate limiting and load shedding.
    - Bound the autoscaler by what the shared stores can take.

---

[^1]: JONAS, E. et al. [Cloud Programming Simplified: A Berkeley View on Serverless Computing](https://arxiv.org/abs/1902.03383){target="_blank"}. UC Berkeley, 2019.
[^2]: AWS. [Understanding Lambda function scaling](https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html){target="_blank"} and [Lambda execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html){target="_blank"}. AWS Lambda Developer Guide.
[^3]: Google Cloud. [Maximum concurrent requests per instance](https://cloud.google.com/run/docs/about-concurrency){target="_blank"}. Cloud Run documentation.
[^4]: Kubernetes. [Horizontal Pod Autoscaling](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/){target="_blank"}.
[^5]: [KEDA — Kubernetes Event-driven Autoscaling](https://keda.sh/docs/){target="_blank"}.
