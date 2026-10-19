# Containers

**Containers** are how independent services are packaged, deployed and scaled. A **microservice** is a design decision — one bounded context, owned by one team, with its own database, released on its own schedule. A **container** is the packaging that makes that practical: the process and all its dependencies in one immutable image that starts in seconds anywhere. An **orchestrator** (Kubernetes) decides on which machines those containers run, replaces them when they die and adds more when load grows; and a **service registry** tells every caller which replicas exist and are healthy *right now*. The design questions are: *where are the service boundaries, how fast does a new replica take traffic, what happens when a machine dies, and are we paying for nodes we do not use?*

In BoxOffice, `catalog`, `inventory` and `order` are microservices, each built into a container image by CI; they run as pods on a Kubernetes cluster (Hands-on 10), where Services and CoreDNS play the role of the service registry.

In the playground, `microservice` and `container` are **call** nodes, `k8s` is a **group frame** (a rectangle drawn behind the nodes that run as pods, like a VPC), and `registry` is a **side** node that services attach to.

| Component | One-liner | Playground id |
|---|---|---|
| [Microservice](#microservice) | One bounded context, deployed and scaled independently, with its own database | `microservice` |
| [Container](#container) | A process packaged with its dependencies in an image, limited by cgroups | `container` |
| [Kubernetes Cluster](#k8s) | Worker nodes that run services as pods; schedules, heals and autoscales them | `k8s` |
| [Service Registry](#registry) | Which healthy instances of each service exist right now (service discovery) | `registry` |

``` mermaid
flowchart LR
    CL[Client] --> GW[API Gateway]
    subgraph K8S["Kubernetes cluster (worker nodes)"]
      CAT[catalog<br/>microservice]
      INV[inventory<br/>microservice]
      ORD[order<br/>microservice]
    end
    GW -->|"GET /events"| CAT
    GW -->|"POST /holds"| INV
    GW -->|"POST /orders"| ORD
    ORD --> INV
    CAT --> DB1[(catalog DB)]
    INV --> DB2[(inventory DB)]
    ORD --> DB3[(order DB)]
    REG[Service Registry] -. healthy replicas .- CAT
    REG -. healthy replicas .- INV
    REG -. healthy replicas .- ORD
```

---

## Microservice { #microservice }

**What it is.** A small service built around **one bounded context** — `catalog`, `inventory`, `order` — that a single team can build, test, deploy and scale **independently** of the others. It owns its data (**database-per-service**: no other service reads or writes its tables; they ask through its API or react to its events) and talks to other services only over the network, synchronously (HTTP/gRPC) or asynchronously (events). Technically it is just an [app server](../compute/index.md#app); what makes it a microservice is the **boundary** and the **independence**.

**When to use.**

- When several teams must ship at their own pace without coordinating releases (Conway's law: the architecture follows the organization).
- When parts of the system have very different scaling, availability or security needs (BoxOffice: `inventory` must survive the on-sale peak; the admin back office does not).
- When the boundaries are clear and stable — usually *after* a modular monolith has shown where they are.

**When not to (or watch out).**

- **Not on day one** with one small team: a modular monolith gives the same modularity without network hops, distributed transactions or N pipelines.
- Every synchronous call is a network hop: latencies **add** and availabilities **multiply** along the chain. Prefer async events for anything the user does not wait for.
- No shared database: two services writing the same tables are a **distributed monolith** — all the costs of microservices, none of the independence.
- Splitting by technical layer (a "database service", a "validation service") instead of by business capability multiplies the calls per request.
- You need the platform first: CI/CD per service, service discovery, tracing, on-call per team.

**Key numbers.**

| Metric | Typical value | Note |
|---|---|---|
| Network hop inside a region | ≈ 0.5–2 ms per call, plus serialization | ≈ illustrative; same-AZ is faster than cross-AZ |
| Availability of a synchronous chain | 0.995ᴺ | 5 services at 99.5% ⇒ ≈ 97.5% |
| Latency of a sequential chain | sum of the hops | Parallel fan-out ⇒ the slowest call (and the tail grows with N) |
| Team size per service | a "two-pizza team" (≈ 5–10 people) | Amazon's rule of thumb |
| Throughput of one replica | ≈ hundreds to a few thousand req/s | ≈ illustrative; measure yours with k6 (Hands-on 2) |

**Failure modes.**

- **Cascading failure** — one slow service holds the threads of every caller upstream → timeouts, circuit breakers, bulkheads (scenario `cascading-failure`).
- **Distributed monolith** — services that must be deployed together or share a database → re-draw the boundaries along bounded contexts.
- **Chatty calls** — one user request fans out into dozens of synchronous calls → coarser APIs, caching, events, a BFF that aggregates.
- **Inconsistent data across services** — no transaction spans two databases → sagas, the outbox pattern, idempotent consumers.
- **Calls to a dead replica** — callers keep sending traffic to an instance that crashed → health checks and service discovery ([Service Registry](#registry)).

**In the playground.** `microservice` is a **call** node that behaves like an [App Server](../compute/index.md#app): each request calls every outgoing edge (sequentially by default, latencies add; `parallelCalls` makes them parallel, latency = max). Parameters (defaults in parentheses): `replicas` (2), `capacity` per replica (400 req/s), `latencyMs` (median service time, 8 ms, lognormal), `threads` per replica (200), `queueLimit` (200), `parallelCalls` (off), `autoscale` (off) with `minReplicas`, `maxReplicas`, `targetUtil` and `warmupS` (1, 20, 0.6, 20 s), `multiAZ` (off) and `price` (60 USD/month per replica, illustrative). An [API Gateway](../edge/index.md#apigw) treats each Microservice or Container target as its own **route**, not as a replica to balance: it does not load-balance between *different* microservices (it does between targets of the same other type, e.g. two App Servers). Set the edge `ratio` (fraction of the gateway's requests that take this route) and the read/write `filter` to model the API: e.g. 70% of requests to `catalog` (reads), 25% to `inventory`, 5% to `order` (writes). Inside a [Kubernetes Cluster](#k8s) frame its replicas are pods, and their price is replaced by the price of the nodes. Scenarios: [`microservices`](../../../../playground/scenarios/index.md#microservices), [`cascading-failure`](../../../../playground/scenarios/index.md#cascading-failure), [`k8s-node-failure`](../../../../playground/scenarios/index.md#k8s-node-failure).

**Real products.**

=== "AWS"

    - **Amazon EKS** and **Amazon ECS** (on EC2 or **AWS Fargate**) — run each service as its own deployment.
    - **AWS App Runner** — a container image becomes an autoscaled HTTPS service.
    - **AWS Cloud Map** and **Amazon VPC Lattice** — service discovery and service-to-service networking.

=== "GCP"

    - **Cloud Run** — one service per container, scales with requests (and to zero).
    - **Google Kubernetes Engine (GKE)** — managed Kubernetes.
    - **Cloud Service Mesh** — mTLS, traffic policies and telemetry between services.

=== "Azure"

    - **Azure Container Apps** — serverless microservices with built-in Dapr and KEDA.
    - **Azure Kubernetes Service (AKS)** — managed Kubernetes.
    - **Azure API Management** — the gateway that routes to each service.

=== "Open source"

    - **Spring Boot** + **Spring Cloud** (Gateway, Config, OpenFeign) and **FastAPI** — the frameworks used in the course.
    - **gRPC** / **OpenAPI** — service contracts.
    - **Resilience4j** — timeouts, retries, circuit breakers, bulkheads.
    - **Dapr** — building blocks (pub/sub, state, service invocation) as a sidecar.

!!! tip "In the interview"
    "I would start as a modular monolith and split along bounded contexts — catalog, inventory, order — only where teams or scaling needs diverge. Each service owns its database; anything the user doesn't wait for goes through events, and every synchronous call has a timeout and a circuit breaker, because in a chain latencies add and availabilities multiply."

**Learn more:** [Compute › Services](../../../classes/compute/services/index.md) · [Compute › API styles](../../../classes/compute/api-styles/index.md) · [Reliability › Patterns](../../../classes/reliability/patterns/index.md) · [Messaging › Queues & pub/sub](../../../classes/messaging/queues-pubsub/index.md) · [Hands-on 4 › Gateway](../../../hands-on/4/gateway/index.md) · [Hands-on 6](../../../hands-on/6/index.md)

---

## Container { #container }

**What it is.** A **process** started from an **image** (Docker/OCI format: a stack of read-only filesystem layers plus metadata), isolated from the other processes on the machine by Linux **namespaces** (its own PIDs, network, mounts, hostname) and limited by **cgroups** (CPU, memory). It is not a small VM: there is no guest kernel, so it starts in milliseconds once the image is on the machine, and dozens fit on one node. Its two resource knobs matter for capacity: the **CPU request** is what the scheduler reserves; the **CPU limit** is a quota enforced every 100 ms period — above it the process is **throttled** (it waits), which shows up as latency, not as errors. Above the **memory limit** it is killed (`OOMKilled`).

**When to use.**

- For every service you build and run yourself: the same image goes from the laptop (Docker Compose) to CI to production, so "works on my machine" means "works".
- When you need fast scale-out and fast replacement (seconds, not the minutes of a VM boot).
- Packed onto shared nodes to raise utilization (bin packing) compared with one VM per service.

**When not to (or watch out).**

- Containers share the host kernel: weaker isolation than VMs for untrusted code → gVisor, Kata Containers, Firecracker micro-VMs (as Fargate and Lambda do).
- **Disposable means stateless**: anything written inside the container is lost on restart → databases need volumes (and usually managed services).
- A **CPU limit lower than the real need** throttles the service: average CPU looks fine while the p99 grows. Many teams set a CPU request but no CPU limit for latency-sensitive services, and always a memory limit.
- **Start-up is not only the process**: a 1 GB image on a node that never pulled it, plus a JVM warm-up, takes tens of seconds — the time autoscaling must wait.
- Images are a supply-chain risk: pin by digest, scan, sign, run as non-root.

**Key numbers.**

| Metric | Typical value | Note |
|---|---|---|
| Start of a container whose image is cached | ≈ 0.1–1 s | ≈ illustrative; namespaces + cgroups + exec |
| Image pull | ≈ 1–10 s for 100–500 MB; tens of seconds for multi-GB images | ≈ illustrative; depends on registry, network and layer cache |
| Start-up of a Spring Boot service | ≈ 5–30 s until ready (JIT warm-up continues after) | Native images / CRaC: well under 1 s |
| CFS quota period | 100 ms | Linux default (`cpu.cfs_period_us`); limit 1 CPU = 100 ms of CPU per 100 ms |
| CPU limit 0.5 on a service that needs 1 CPU | ≈ ½ the throughput, ≈ 2× slower requests | Throttling: `container_cpu_cfs_throttled_periods_total` |
| Image size | ≈ 50–300 MB (JRE on a distroless/alpine base) | Multi-stage builds keep the JDK and Maven out |

**Failure modes.**

- **CPU throttling** — p99 latency grows while CPU usage looks below the limit → raise or remove the CPU limit, size requests from load tests.
- **OOMKilled / restart loop** — memory limit below the real need (JVM heap + metaspace + threads) → `-XX:MaxRAMPercentage`, right-size the limit; `CrashLoopBackOff` backs off up to 5 min between restarts.
- **Slow scale-out** — big images and slow start delay new replicas while the spike is already here → smaller images, pre-pulled images, startup probes, pre-scaling.
- **ImagePullBackOff** — registry down, wrong tag or credentials → mirror the registry, pin digests.
- **Lost writes** — state written to the container filesystem disappears on restart → volumes or external stores.

**In the playground.** `container` is a **call** node like `microservice`, with two container-specific parameters. Parameters (defaults in parentheses): `replicas` (1), `capacity` per replica (300 req/s, quoted for the CPU request), `cpuLimit` (1 × the CPU request; 0.1–4), `startupS` (20 s), `latencyMs` (10 ms), `threads` (100), `queueLimit` (200), `parallelCalls` (off), `autoscale` (off) with `minReplicas`, `maxReplicas`, `targetUtil` (1, 20, 0.6), `multiAZ` (off) and `price` (40 USD/month per replica, illustrative). The model: **capacity per replica = capacity × cpuLimit**, and the **median service time = latencyMs ÷ min(1, cpuLimit)** — below 1 the container is throttled (limit 0.5 ⇒ half the req/s and requests ≈ 2× slower); above 1 it gets more throughput but no faster single request. `startupS` (image pull + process start + warm-up) is the time before a **new** replica takes traffic — after an autoscaling decision or when Kubernetes reschedules it after a node failure. Like a microservice, an API Gateway treats each Container target as its own route. Scenarios: [`microservices`](../../../../playground/scenarios/index.md#microservices), [`k8s-node-failure`](../../../../playground/scenarios/index.md#k8s-node-failure), [`scale-out`](../../../../playground/scenarios/index.md#scale-out).

**Real products.**

=== "AWS"

    - **Amazon ECR** — container registry with image scanning.
    - **Amazon ECS** on **AWS Fargate** — run containers without managing servers (Firecracker micro-VM isolation).
    - **AWS App Runner** — from image to HTTPS service.

=== "GCP"

    - **Artifact Registry** — container (and package) registry.
    - **Cloud Run** — serverless containers, billed per request time or per instance.
    - **Cloud Build** — builds images in CI.

=== "Azure"

    - **Azure Container Registry (ACR)**.
    - **Azure Container Instances (ACI)** — single containers on demand.
    - **Azure Container Apps** — serverless containers with autoscaling.

=== "Open source"

    - **Docker** / **Docker Compose** and **Podman** — build and run images locally.
    - **containerd** and **CRI-O** — the runtimes Kubernetes uses; **runc** underneath.
    - **BuildKit**, **Jib** (Java without a Dockerfile), **Buildpacks** — image builds.
    - **Harbor** — self-hosted registry; **Trivy** and **cosign** — scanning and signing.

!!! tip "In the interview"
    "Each service ships as an immutable container image, pinned by digest. I size CPU and memory requests from load tests; I avoid tight CPU limits on latency-sensitive services, because throttling shows up as p99 latency, not errors. And I count start-up time — image pull plus JVM warm-up — in how fast autoscaling can react."

**Learn more:** [Cloud-native › Containers](../../../classes/cloud-native/containers/index.md) · [Cloud-native › Kubernetes](../../../classes/cloud-native/kubernetes/index.md) · [Performance › Bottlenecks](../../../classes/performance/bottlenecks/index.md) · [Compute › Serverless & autoscaling](../../../classes/compute/serverless-autoscaling/index.md) · [Hands-on 1 › Container](../../../hands-on/1/container/index.md) · [Hands-on 10](../../../hands-on/10/index.md)

---

## Kubernetes Cluster { #k8s }

**What it is.** A set of **worker nodes** (virtual machines) managed by a **control plane** (API server, etcd, scheduler, controllers) that runs your containers as **pods**. You declare the desired state — "five replicas of `catalog`, each requesting 1 CPU" — and control loops keep reality there: the **scheduler** places each pod on a node with enough free requested resources; pods that fit nowhere stay **Pending**; the **ReplicaSet** controller replaces pods that die; the node lifecycle controller marks a silent node **NotReady**; the **Horizontal Pod Autoscaler (HPA)** adds pods; and only the **Cluster Autoscaler** (or Karpenter) adds **nodes**. **Services** give a stable name and virtual IP in front of a changing set of ready pods.

**When to use.**

- Many services and teams that benefit from one shared platform: the same deploy, scaling, probes, secrets and observability for everything.
- When you need self-healing, rolling updates and autoscaling as standard, portable behaviour (same API on every cloud and on-premises).
- When the ecosystem pays off: GitOps (Argo CD), KEDA, operators, service mesh, policy engines.

**When not to (or watch out).**

- A few services and a small team: **Cloud Run, ECS/Fargate, App Runner or Container Apps** give containers with autoscaling and none of the cluster operations.
- **Autoscaling has two lags**: the HPA adds pods within seconds, but if no node has room they stay Pending until a new node boots (minutes). Pre-scale or keep spare capacity for known peaks.
- **You pay for nodes, not pods**: idle requested capacity, system pods and the control plane cost money even at zero traffic.
- Stateful systems (databases, Kafka) on Kubernetes need StatefulSets, persistent volumes and operators — often a managed service is the better choice.
- A node failure takes all its pods at once: spread replicas across nodes and zones (topology spread constraints, PodDisruptionBudgets).

**Key numbers.**

| Metric | Typical value | Note |
|---|---|---|
| Node marked NotReady after it goes silent | 40 s (`node-monitor-grace-period`; 50 s since v1.32) | Kubelet heartbeats (node leases) every 10 s; its pods leave the Service endpoints |
| Pods of a NotReady node evicted after | 300 s | Default `tolerationSeconds` for the `not-ready`/`unreachable` taints; then the ReplicaSet recreates them elsewhere |
| HPA sync period | 15 s | Scale-down stabilization window: 5 min by default |
| Cluster Autoscaler scan interval | 10 s | Scale-down after a node is unneeded for 10 min (`scale-down-unneeded-time`) |
| New node ready | ≈ 1–3 min | ≈ illustrative; VM boot + join + image pulls; Karpenter is often faster |
| New pod ready | ≈ 5–30 s | ≈ illustrative; image pull + start + readiness probe |
| Pods per node | 110 (kubelet default `max-pods`) | EKS with the VPC CNI: limited by ENIs per instance type unless prefix delegation is on |
| Large-cluster limits | 5,000 nodes, 150,000 pods | Kubernetes "considerations for large clusters" |
| Control plane fee | ≈ 0.10 USD/h per cluster (≈ 73 USD/month) on EKS and GKE | AKS Free tier: no fee; AKS Standard: ≈ 0.10 USD/h; GKE credits one cluster per billing account |

**Failure modes.**

- **Pods stuck Pending** — the HPA asks for replicas the nodes cannot hold → cluster autoscaler with a high enough `maxNodes`, right-sized requests, spare "balloon" capacity.
- **Node failure** — every pod on the node disappears at once; callers keep sending requests until the endpoints are updated (≈ 40 s) → several replicas spread across nodes and zones, readiness and health checks, client-side discovery.
- **Rescheduling with no room** — the replacement pods of a dead node stay Pending if the remaining nodes are full → headroom of at least one node (N+1), cluster autoscaler.
- **Noisy neighbour** — a pod without requests/limits starves the others on its node → requests and limits on every container, quotas per namespace.
- **Node autoscaler too slow for a spike** — new nodes arrive minutes after the peak → pre-scaling (cron), over-provisioning, a waiting room in front.
- **Control plane / etcd overload** — too many objects or watchers → managed control plane, fewer churny objects.

**In the playground.** `k8s` is a **group frame**, like [VPC](../network/index.md#vpc) and Subnet: a resizable rectangle drawn behind the nodes. Every node whose centre lies inside the frame runs **as pods** (one pod per replica) — except managed services (DNS, CDN, Load Balancer, WAF, Serverless, Object Store, Data Warehouse, Message Queue, Pub/Sub, Event Stream, NAT Gateway, VPN, LLM Gateway) and external providers, which run outside the cluster wherever you draw them. Parameters (defaults in parentheses): `nodes` (3 worker nodes), `podsPerNode` (10), `clusterAutoscaler` (off), `maxNodes` (10), `nodeStartupS` (90 s) and `nodePrice` (140 USD/month per worker node, illustrative).

- **Scheduling.** Schedulable pods = ready nodes × `podsPerNode`. Replicas beyond that — from the `replicas` parameter or added by autoscaling (the HPA) — are **Pending**: they do not serve, and the block and the inspector show them ("3 pending"). When room appears, a pending pod starts and takes traffic after its warm-up (`startupS` for a Container, `warmupS` for the others) plus ≈ 10 s of endpoint propagation, unless a [Service Registry](#registry) is connected.
- **Cluster autoscaler.** When on and pending pods do not fit even counting the nodes already starting, it adds ⌈missing pods ÷ `podsPerNode`⌉ nodes (up to `maxNodes`), ready after `nodeStartupS`. A node not needed for **2 minutes** is removed, never going below `nodes` (real default: 10 minutes; shortened to fit a run).
- **Node failure** (random event, or injected). One ready node dies and its pods (≈ pods ÷ nodes, spread evenly over the services) are lost. Callers keep sending them requests until they notice: 30 s behind a load balancer, 3 s with a [Health Check](../observability/index.md#healthcheck) or a Service Registry, at most 40 s (Kubernetes marks the node NotReady and removes its endpoints). After 40 s the lost pods are recreated and scheduled if there is room, otherwise they stay Pending; the node itself is replaced when the event ends. (Real Kubernetes waits for the 300 s eviction toleration before recreating them; the playground behaves as if it were lowered.)
- **Cost.** (ready + starting nodes) × `nodePrice`. The replicas' own `price` is **not** counted inside a cluster: you pay for nodes, not pods. The control-plane fee is not modelled — add ≈ 73 USD/month by hand on EKS or GKE.

The frame's live panel shows nodes ready / starting / failed, pods scheduled / capacity, pending pods and cost. Try 3 nodes × 10 pods with autoscaling services under the `spike` profile, with and without the cluster autoscaler. Scenarios: [`k8s-node-failure`](../../../../playground/scenarios/index.md#k8s-node-failure), [`microservices`](../../../../playground/scenarios/index.md#microservices).

**Real products.**

=== "AWS"

    - **Amazon EKS** — managed control plane; nodes as managed node groups, **Karpenter**, **EKS Auto Mode** or **Fargate**.
    - **Amazon ECS** — AWS's own, simpler orchestrator (not Kubernetes).

=== "GCP"

    - **GKE Standard** — you manage node pools; cluster autoscaler and node auto-provisioning.
    - **GKE Autopilot** — Google manages the nodes; billed per pod resource request.

=== "Azure"

    - **Azure Kubernetes Service (AKS)** — node pools on VM scale sets; cluster autoscaler, KEDA add-on, **AKS Automatic**.
    - **Azure Container Apps** — Kubernetes-based, without exposing the cluster.

=== "Open source"

    - **Kubernetes** — with **etcd**, **containerd**, **CoreDNS**, a CNI such as **Cilium** or Calico.
    - **Cluster Autoscaler**, **Karpenter**, **KEDA** — node, provisioning and event-driven autoscaling.
    - **kind**, **minikube**, **k3s** — local and lightweight clusters (Hands-on 10 uses kind).
    - **Argo CD** — GitOps deployment to the cluster.

!!! tip "In the interview"
    "The services run as Deployments on a managed Kubernetes cluster spread over three zones. The HPA scales pods on CPU or RPS within seconds, but pods only run if a node has room, so the cluster autoscaler adds nodes — that takes minutes, so for the 10:00 on-sale I pre-scale and keep one node of headroom. A node failure takes its pods with it; with replicas on several nodes and readiness checks, traffic moves in seconds."

**Learn more:** [Cloud-native › Kubernetes](../../../classes/cloud-native/kubernetes/index.md) · [Kubernetes › Autoscaling at three levels](../../../classes/cloud-native/kubernetes/index.md#autoscaling) · [Compute › Autoscaling lag](../../../classes/compute/serverless-autoscaling/index.md#autoscaling-lag) · [Cloud-native › FinOps](../../../classes/cloud-native/finops/index.md) · [Ingress](../edge/index.md#ingress) · [Hands-on 10](../../../hands-on/10/index.md) · [Hands-on 10 › A local cluster](../../../hands-on/10/cluster/index.md) · [Hands-on 10 › Autoscaling](../../../hands-on/10/autoscaling/index.md) · [Hands-on 10 › Measure it](../../../hands-on/10/measure/index.md)

---

## Service Registry { #registry }

**What it is.** The component that answers *"which instances of `inventory` exist and are healthy right now?"* — **service discovery**. Replicas come and go (autoscaling, deploys, crashes, node failures) and their addresses change every time; instances **register** when they start (or the platform registers them when their readiness probe passes), report their health by **heartbeats** or checks, and are removed when they stop answering. Callers either ask the registry and pick a replica themselves (**client-side discovery**: Eureka + a client load balancer, Consul) or call a stable name that a platform proxy resolves (**server-side discovery**: Kubernetes Services, cloud target groups). The registry itself is a small, strongly consistent store (etcd, Consul's Raft).

**When to use.**

- As soon as services call each other directly and replicas change: hard-coded IPs break at the first autoscaling event.
- For **fast failure detection** on service-to-service calls: a registry with health checks removes a dead replica in seconds, everywhere.
- Across platforms (VMs + Kubernetes + several clusters), where a single Kubernetes Service is not enough (Consul, Cloud Map).

**When not to (or watch out).**

- Inside one Kubernetes cluster you already have one: **Services + EndpointSlices + CoreDNS**. Add another only if you need what they lack (multi-cluster, VMs, richer health).
- The registry is on the critical path of every new connection: run it replicated (3 or 5 nodes) and let clients **cache** the last known list, so a registry outage does not stop traffic.
- **Stale entries**: TTLs and heartbeat intervals trade detection speed for load and flapping. DNS-based discovery is only as fresh as its TTL and the clients' DNS caching.
- Discovery tells you *where*, not *whether the call will succeed*: still use timeouts, retries and circuit breakers.

**Key numbers.**

| Metric | Typical value | Note |
|---|---|---|
| Heartbeat / TTL | ≈ 1–10 s | ≈ illustrative; Consul checks are configured per service |
| Eureka defaults | renewal every 30 s, expiry after 90 s, client cache refresh 30 s | Slow by design; usually tuned down |
| CoreDNS TTL for Kubernetes Services | 5 s | `kubernetes` plugin default |
| Endpoint propagation in Kubernetes | ≈ 1–10 s from readiness to every node | ≈ illustrative; EndpointSlice controller + kube-proxy sync |
| Registry cluster size | 3 or 5 servers | Raft quorum: tolerates 1 or 2 failures |
| AWS Cloud Map | ≈ 0.10 USD per registered instance per month + ≈ 1 USD per million discovery calls | Approximate list prices |

**Failure modes.**

- **Calls to dead replicas** — without discovery, a client keeps sending a share of its requests to a crashed instance → registry with health checks, short TTLs, outlier detection.
- **Registry outage** — no new lookups → replicated registry, client-side caches of the last known list.
- **Stale cache / DNS caching** — clients keep old addresses for minutes (e.g. a JVM DNS cache) → honour TTLs, prefer the platform's proxy or a client library that watches the registry.
- **Flapping** — aggressive health thresholds add and remove instances repeatedly → thresholds with hysteresis.
- **Split brain** — a registry that is not strongly consistent shows different instances to different callers → consensus-based stores (etcd, Consul).

**In the playground.** `registry` is a **side** node, like [Health Check](../observability/index.md#healthcheck): connect it to services in either direction (it is not in the request path). Its only parameter is `price` (30 USD/month, plus 5 USD/month per attached service). Effects on every **registered** service:

- **Faster detection of dead replicas** — callers stop sending requests to a crashed replica in **3 s instead of 30 s**. This applies behind load balancers *and* on direct service-to-service calls (client-side discovery): without a registry, a direct caller keeps sending a crashed replica its share of requests until it comes back — or for 40 s when a [Kubernetes](#k8s) node is lost.
- **No propagation delay** — inside a Kubernetes Cluster frame, new pods take traffic as soon as they are ready, without the ≈ 10 s of endpoint propagation.

Compare a node failure in the `k8s-node-failure` scenario with and without the registry. Scenarios: [`k8s-node-failure`](../../../../playground/scenarios/index.md#k8s-node-failure), [`microservices`](../../../../playground/scenarios/index.md#microservices).

**Real products.**

=== "AWS"

    - **AWS Cloud Map** — service discovery for ECS, EKS and EC2 (DNS or API), with health checks.
    - **ECS Service Connect** and **Amazon VPC Lattice** — discovery plus service-to-service networking.
    - **Elastic Load Balancing target groups** — server-side discovery.

=== "GCP"

    - **Service Directory** — managed registry for services across GKE, VMs and on-premises.
    - **GKE multi-cluster Services** and **Cloud DNS** — discovery across clusters.

=== "Azure"

    - **Azure Container Apps** built-in service discovery (DNS names per app).
    - **AKS** Kubernetes Services + CoreDNS; **Azure Private DNS** across networks.

=== "Open source"

    - **Kubernetes Services**, **EndpointSlices** and **CoreDNS** — discovery inside a cluster.
    - **HashiCorp Consul** — registry, health checks, DNS/HTTP API, service mesh.
    - **Netflix Eureka** (Spring Cloud Netflix) — client-side discovery for Spring services.
    - **etcd** and **Apache ZooKeeper** — consistent stores used as registries; **Nacos**.

!!! tip "In the interview"
    "Replicas come and go, so callers never hold IP addresses: inside Kubernetes a Service and CoreDNS give each service a stable name, and only ready pods are behind it. Across clusters or VMs I'd use a registry like Consul with health checks, replicated and cached on the clients, so a dead replica stops getting traffic within seconds and a registry outage doesn't stop calls."

**Learn more:** [Edge › Service discovery](../../../classes/edge/load-balancing/index.md#service-discovery) · [Edge › Load balancing in Kubernetes](../../../classes/edge/load-balancing/index.md#kubernetes) · [Distributed › Consensus](../../../classes/distributed/consensus/index.md) · [Cloud-native › Kubernetes › Probes](../../../classes/cloud-native/kubernetes/index.md#probes) · [Health Check](../observability/index.md#healthcheck) · [Service Mesh](../network/index.md#mesh) · [Hands-on 10 › Deploy BoxOffice](../../../hands-on/10/deploy/index.md)
