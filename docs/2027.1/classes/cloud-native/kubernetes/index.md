Docker Compose starts BoxOffice on one machine. Production needs more: forty containers spread over several machines, a replacement started within seconds when one dies, a new version rolled out without downtime, and capacity added automatically when the on-sale begins. Doing that by hand — SSH into a node, `docker run`, update the load balancer — does not survive the first night on call. An **orchestrator** does it for you, and Kubernetes is the de facto standard[^5].

Kubernetes descends from Google's internal cluster managers, Borg and Omega; its designers summarized the lesson of a decade of running containers at scale as *declarative state reconciled by independent control loops*[^1].

---

## The control loop: desired state vs actual state

You never tell Kubernetes "start a container". You tell it "there should be **five** replicas of `catalog`, version `1.4.0`, each with 1 CPU" — the **desired state** — and store it in the API server. Controllers then run forever:

```
loop:
    desired = read spec from the API server
    actual  = observe the cluster
    if actual != desired:
        act to reduce the difference (create, delete, update)
```

``` diagram-sim
sequenceDiagram
    participant U as kubectl / Argo CD
    participant API as API server (+ etcd)
    participant RS as ReplicaSet controller
    participant S as Scheduler
    participant K as kubelet (node 2)
    U->>API: apply Deployment catalog, replicas = 5
    API->>RS: watch: desired 5, actual 4 (a node died)
    RS->>API: create Pod catalog-7f9c
    API->>S: watch: unscheduled pod
    S->>API: bind catalog-7f9c to node 2 (enough free CPU)
    API->>K: watch: new pod for this node
    K->>K: pull image, start container, run probes
    K->>API: status: Running, Ready
    Note over RS,API: actual = desired → nothing to do
```

This is why Kubernetes **self-heals**: a crashed process, a deleted pod or a dead node all appear as "actual ≠ desired", and the same loop fixes them. It is also why the API is **declarative and idempotent**: applying the same manifest twice changes nothing.

### The pieces of a cluster

| Component | Where | Role |
|---|---|---|
| **API server** | Control plane | The only entry point; validates and stores objects; everything else *watches* it |
| **etcd** | Control plane | Strongly consistent key-value store (Raft consensus) holding the cluster state |
| **Scheduler** | Control plane | Chooses a node for each new pod (free resources, affinity, spread constraints) |
| **Controller manager** | Control plane | Runs the controllers (Deployment, ReplicaSet, Job, Node, HPA…) |
| **kubelet** | Every node | Starts the pod's containers through the container runtime (containerd), runs probes, reports status |
| **kube-proxy / CNI plugin** | Every node | Implements Service virtual IPs and pod networking (iptables, IPVS or eBPF, e.g. Cilium) |

With a managed service (EKS, GKE, AKS) the provider runs and upgrades the control plane; you manage the nodes — or, with GKE Autopilot or EKS on Fargate, not even those.

---

## The core objects

| Object | What it is | BoxOffice use |
|---|---|---|
| **Pod** | One or more containers that share network and volumes; the unit of scheduling. Ephemeral | One `catalog` instance (plus, sometimes, a sidecar) |
| **Deployment** | Keeps N identical pods running and rolls out new versions (through ReplicaSets) | `catalog`, `inventory`, `order`, `gateway` |
| **Service** | A stable virtual IP and DNS name in front of a changing set of pods, selected by labels | `http://inventory:8080` always works, whatever pods exist |
| **Ingress / Gateway API** | HTTP routing from outside the cluster to Services (host, path, TLS) | `api.boxoffice.example/catalog/**` → `catalog` |
| **ConfigMap / Secret** | Configuration and credentials injected as environment variables or files | Database URL; database password (from a secret manager) |
| **StatefulSet** | Pods with stable identity and their own persistent volume | Kafka or PostgreSQL *if* self-hosted |
| **Job / CronJob** | Run-to-completion work, once or on a schedule | Release expired seat holds every minute; nightly reconciliation with the payment provider |
| **HorizontalPodAutoscaler** | Adjusts a Deployment's replica count from metrics | `catalog` 4 → 40 replicas during the on-sale |
| **PodDisruptionBudget** | Limits how many pods voluntary disruptions (node drains, upgrades) may take down at once | Never fewer than 3 `inventory` pods during a node upgrade |

### BoxOffice's `catalog` on Kubernetes

The manifests below show what a production `catalog` needs. Read them top to bottom; each block answers one operational question. [Hands-on 10](../../../hands-on/10/index.md) writes a smaller version for a three-node cluster on a laptop (box after the manifests).

```yaml title="k8s/catalog/deployment.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: catalog
  labels: { app: catalog }
spec:
  replicas: 4
  selector:
    matchLabels: { app: catalog }
  strategy:
    type: RollingUpdate
    rollingUpdate: { maxSurge: 25%, maxUnavailable: 0 }   # never below 4 ready pods
  template:
    metadata:
      labels: { app: catalog }
    spec:
      terminationGracePeriodSeconds: 30
      topologySpreadConstraints:                           # spread replicas across zones
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: ScheduleAnyway
          labelSelector: { matchLabels: { app: catalog } }
      containers:
        - name: catalog
          image: ghcr.io/boxoffice/catalog@sha256:9f2c0d7e1b4a   # digest, not a tag
          ports: [ { containerPort: 8080 } ]
          envFrom:
            - configMapRef: { name: catalog-config }
            - secretRef:    { name: catalog-db }
          resources:
            requests: { cpu: "500m", memory: "768Mi" }      # what the scheduler reserves
            limits:   { memory: "768Mi" }                   # hard ceiling (OOMKilled above)
          startupProbe:                                     # JVM warm-up: up to 60 s
            httpGet: { path: /actuator/health/liveness, port: 8080 }
            periodSeconds: 5
            failureThreshold: 12
          readinessProbe:                                   # receive traffic?
            httpGet: { path: /actuator/health/readiness, port: 8080 }
            periodSeconds: 5
            failureThreshold: 3
          livenessProbe:                                    # restart me?
            httpGet: { path: /actuator/health/liveness, port: 8080 }
            periodSeconds: 10
            failureThreshold: 3
          lifecycle:
            preStop: { sleep: { seconds: 5 } }              # let endpoints update before SIGTERM
```

```yaml title="k8s/catalog/service-hpa-pdb.yaml"
apiVersion: v1
kind: Service
metadata: { name: catalog }
spec:
  selector: { app: catalog }
  ports: [ { port: 8080, targetPort: 8080 } ]
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: catalog }
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: catalog }
  minReplicas: 4
  maxReplicas: 40
  metrics:
    - type: Resource
      resource:
        name: cpu
        target: { type: Utilization, averageUtilization: 60 }   # % of the CPU request
  behavior:
    scaleUp:   { stabilizationWindowSeconds: 0,   policies: [ { type: Percent, value: 100, periodSeconds: 15 } ] }
    scaleDown: { stabilizationWindowSeconds: 300, policies: [ { type: Pods,    value: 2,   periodSeconds: 60 } ] }
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata: { name: catalog }
spec:
  minAvailable: 3
  selector: { matchLabels: { app: catalog } }
```

```yaml title="k8s/edge/httproute.yaml"
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata: { name: boxoffice-api }
spec:
  parentRefs: [ { name: public-gateway } ]
  hostnames: [ "api.boxoffice.example" ]
  rules:
    - matches: [ { path: { type: PathPrefix, value: /catalog } } ]
      backendRefs: [ { name: catalog, port: 8080 } ]
    - matches: [ { path: { type: PathPrefix, value: /inventory } } ]
      backendRefs: [ { name: inventory, port: 8080 } ]
```

The **Gateway API** (`Gateway` + `HTTPRoute`) is the successor of the older `Ingress` object: it separates the infrastructure owner (who runs the Gateway) from the application teams (who own routes), and supports weighted backends natively[^3] — which is how canaries split traffic (see [Delivery](../delivery/index.md)). The [Edge class](../../edge/load-balancing/index.md) covers the [Ingress](../../../reference/components/edge/index.md#ingress) component.

!!! example "In the BoxOffice code: `catalog` on a kind cluster (lab 10)"

    [Hands-on 10 — Deploy BoxOffice](../../../hands-on/10/deploy/index.md) runs the same pieces with laptop-sized numbers: 2 replicas (the HPA takes over), a request of 250m CPU and 512 Mi, and a Traefik `Ingress` (the Gateway API `HTTPRoute` is in `catalog-route.yaml`, as an alternative). Look at three choices. The startup probe allows up to **5 minutes**, because the first start also runs the Flyway migrations, and Kubernetes has no `depends_on`: `catalog` restarts until PostgreSQL answers. Liveness checks only the JVM, so a database blip does not restart every pod. And the lab keeps a **1-CPU limit**, the same "server" as Compose in lab 1, so the numbers stay comparable with the earlier labs — at the price of the throttling described [below](#requests-limits).

    ``` { .yaml title="k8s/base/catalog.yaml (lab 10: resources, probes, graceful shutdown)" }
    --8<-- "docs/2027.1/hands-on/10/code/k8s/base/catalog.yaml:45:70"
    ```

---

## Probes: three different questions { #probes }

| Probe | Question | On failure | Common mistake |
|---|---|---|---|
| **Startup** | Has the application finished starting? | Keeps the other probes disabled; after `failureThreshold`, restarts the container | Missing → a slow JVM is killed by liveness before it ever starts |
| **Readiness** | Should this pod receive traffic *now*? | Removed from the Service endpoints (no restart) | Checking downstream dependencies: when PostgreSQL blinks, *all* pods become unready and the whole service disappears |
| **Liveness** | Is the process stuck beyond repair? | Container restarted | Making it depend on the database: a DB outage triggers restart storms that make recovery slower |

Keep liveness **local** (is the JVM responsive?) and make readiness reflect only what this pod itself needs to serve. Spring Boot Actuator exposes `/actuator/health/liveness` and `/actuator/health/readiness` with exactly these semantics. The [Observability class](../../observability/index.md) treats health checks as a palette component ([Health Check](../../../reference/components/observability/index.md#healthcheck)).

---

## Requests, limits and quality of service { #requests-limits }

- **Request** — what the scheduler *reserves* on a node. It decides where a pod fits and is the base of the HPA's utilization percentage.
- **Limit** — the ceiling. Above the **memory** limit the container is killed (`OOMKilled`); above the **CPU** limit it is **throttled** — it simply waits, which shows up as latency, not as errors.

| QoS class | Rule | Evicted under node pressure |
|---|---|---|
| **Guaranteed** | requests = limits for CPU and memory | Last |
| **Burstable** | some requests set, lower than limits | Middle |
| **BestEffort** | nothing set | First |

!!! warning "CPU limits and latency"

    A Java service with a 1-CPU limit that keeps 4 threads (GC and requests) busy in parallel on a multi-core node can consume its 100 ms quota in the first 25 ms of each 100 ms period and then stall for 75 ms. The p99 grows while average CPU looks fine. Watch the cgroup metric `nr_throttled` (exposed by cAdvisor as `container_cpu_cfs_throttled_periods_total`). Many teams set a CPU **request** but no CPU **limit** for latency-sensitive services, and always set a **memory limit**. The [Performance class](../../performance/bottlenecks/index.md) shows how to spot throttling in a load test.

---

## Losing a node { #losing-a-node }

The control loop replaces lost pods, but self-healing needs two things the loop does not provide. The replacement pods need **room**: the scheduler places a pod only on a node whose free capacity covers its requests, so in a cluster packed to 100% the pods of a dead node stay `Pending`. And callers must **stop sending to the dead pods**: until the node is declared `NotReady` (tens of seconds by default) and the Service endpoints are updated, part of the traffic still goes to pods that no longer exist. These are the two rules of redundancy and failover from the [Reliability class](../../reliability/index.md), at the level of nodes: N + 1 capacity, and fast failure detection.

**Try it:** in `k8s-node-failure`, `catalog` and `pricing` run 6 pods each on 3 nodes × 4 pods — a full cluster — and at t = 60 s one node dies.

1. Run it as it is. For about 40 s, around 90% of the requests fail: callers still send to the dead pods. Errors then fall, and come back at 7–10% from t ≈ 150 s: the 2 lost pods of each service have nowhere to go, and 4 survivors carry the load of 6. Over the run: errors ≈ 27%, p99 ≈ 4.6 s.
2. Give the cluster room: set `podsPerNode` to 8 on the cluster frame. The late errors disappear (the lost pods are rescheduled), but the 40-s window stays: errors ≈ 25%.
3. Connect a **Service Registry** to `catalog` and `pricing` — the playground's stand-in for fast endpoint updates. Callers drop the dead pods in 3 s instead of 30–40 s: errors ≈ 4%.

<div class="sdp" data-scenario="k8s-node-failure" data-mode="compact" data-height="520"></div>

??? question "What should you have observed, and what is still missing?"

    After step 3, the remaining errors (5–9%) come from the survivors: 4 pods carry the load of 6 until the replacements are ready. Raise both services to **8 replicas**, so that losing a third still leaves enough capacity: errors ≈ 1.7%. Then add a **300 ms timeout with 2 retries** on `catalog → pricing`: errors ≈ 0.8%, p99 ≈ 43 ms, for about 1,370 USD/month instead of 1,330. The order matters: the same timeout and retries with only 6 replicas push the errors to ≈ 48% — retries against overloaded survivors are a [retry storm](../../reliability/patterns/index.md#retry-with-backoff-and-jitter).

---

## Autoscaling at three levels { #autoscaling }

``` diagram-sim
flowchart LR
    load["k6 / fans<br/>requests per second ↑"] --> hpa["HPA<br/>more pods"]
    hpa --> pend["Pods Pending<br/>(no room on nodes)"]
    pend --> ca["Cluster Autoscaler / Karpenter<br/>more nodes"]
    ca --> run["Pods scheduled<br/>image pulled, JVM warm"]
    run --> ready["Ready → receive traffic"]
```

**1. Pods — Horizontal Pod Autoscaler (HPA).** Every 15 s the HPA computes[^2]

$$
\text{desired} = \left\lceil \text{current} \times \frac{\text{current metric}}{\text{target metric}} \right\rceil
$$

With 4 `catalog` pods at 90 % CPU (of request) and a 60 % target: ⌈4 × 90/60⌉ = **6 pods**. Scaling on CPU works for CPU-bound services; for I/O-bound services scale on **requests per second per pod** or on **queue lag** through custom/external metrics.

**2. Nodes — Cluster Autoscaler or Karpenter.** When pods stay `Pending` because no node has room, a node autoscaler provisions new machines (Karpenter chooses instance types per workload and can use spot capacity). This takes **minutes**: VM boot, node join, image pull.

**3. Events — KEDA.** The Kubernetes Event-Driven Autoscaler scales on external sources (Kafka consumer lag, queue length, cron windows) and can scale to zero — natural for the `notification` workers[^4].

!!! example "In the BoxOffice code: the `catalog` HPA (lab 10)"

    [Hands-on 10 — Autoscaling](../../../hands-on/10/autoscaling/index.md) scales `catalog` from 2 to 8 pods at 60% of its 250m CPU request — the formula above, with a scale-up of "double or +2 pods every 15 s" and a slow scale-down (2-minute window, 1 pod every 30 s) so that a short dip does not remove capacity that is needed again a minute later. The lab measures the lag this section warns about: the HPA asked for more pods about two minutes into the ramp, but "the eighth pod was ready only at 7:31, when the hold was already over", with a p95 of 5–7 s for the run ([Measure it](../../../hands-on/10/measure/index.md)).

    ``` { .yaml title="k8s/base/catalog-hpa.yaml (lab 10)" }
    --8<-- "docs/2027.1/hands-on/10/code/k8s/base/catalog-hpa.yaml"
    ```

!!! example "BoxOffice: why the HPA alone does not save the on-sale"

    The HPA reacts *after* CPU rises; the node autoscaler needs minutes; each JVM needs ~20–40 s to start and warm up. A flash sale goes from 5 % to 100 % of peak in seconds. So the team **pre-scales** before 10:00 — a CronJob or KEDA's cron scaler sets `minReplicas` to the expected peak at 09:45 — keeps a buffer of spare nodes (low-priority "balloon" pods that are evicted when real pods need room), and puts a [waiting room](../../messaging/queues-pubsub/index.md) in front so that admission, not autoscaling, controls the rate. The capacity numbers come from the [Capacity planning](../../performance/capacity-planning/index.md) page.

<div class="csim" data-sim="autoscale" data-traffic="flash" data-target="60" data-min="2" data-max="8" data-startup="40" data-stabilization="120"></div>

!!! tip "Try it"
    The HPA starts with lab 10's `catalog-hpa.yaml`: target 60% CPU, 2 to 8 pods, scale up by double or +2 pods every 15 s, scale down 1 pod per 30 s after a 120 s window. Each pod requests 250m and may burst to its 1-CPU limit, so 2 pods absorb up to 400 requests/s. The start-up time (40 s) is the JVM's, from the box above; the lab measured much longer on a laptop.

    1. Play the **on-sale at 10:00**: the HPA wants 8 pods within 30 s, but they are ready only 40 s later — about **8,900 requests** (1.7%) dropped or slow in 45 s over capacity. Raise the start-up to 120 s: about 25,000 (4.9%).
    2. **Pre-scale**: set *Min pods* to 4 and nothing is lost, for 193 replica-minutes instead of 181; min 8 costs 241.
    3. Pick the **daily ramp** and watch the dip at 10:10: with the 120 s window the HPA still has 8 pods at 10:11:30 and 6 when the traffic returns at 10:13 (CPU peaks at 76%); set the window to 0 and it is down to 4, and CPU peaks at 113% — 167 replica-minutes instead of 185, paid with that spike.

Try it: in the scenario below, run the `spike` profile with 2 replicas, then with 6. Watch p99 latency and errors while the replicas are busy; then enable autoscaling (if offered) and observe the **lag** between the start of the spike and the moment new replicas are healthy.

<div class="sdp" data-scenario="scale-out" data-mode="compact" data-profile="spike" data-height="520"></div>

---

## Where to run Kubernetes

=== "AWS"

    **Amazon EKS** — managed control plane (billed per cluster-hour), nodes as EC2 managed node groups, Karpenter, or Fargate. AWS Load Balancer Controller for Ingress/Gateway; IAM Roles for Service Accounts for pod credentials.

=== "Google Cloud"

    **GKE** Standard (you manage node pools) or **Autopilot** (billed per pod resource request; Google manages nodes). Gateway API is supported natively.

=== "Azure"

    **AKS** — managed control plane, node pools on VM scale sets, KEDA available as an add-on, Azure Container Apps as a simpler serverless alternative built on Kubernetes.

=== "Local / open source"

    **kind** (Kubernetes in Docker) and **minikube** for the labs; **k3s** for small edge or single-VM clusters. Same API — the manifests above run unchanged.

---

## Trade-offs

| Question | Kubernetes | Simpler alternative (ECS, Cloud Run, PaaS) |
|---|---|---|
| Team and service count | Pays off with many services and teams sharing tooling | Better for a few services and a small team |
| Portability | Same API on every cloud and on-premises | Tied to one provider |
| Ecosystem | Huge: Argo CD, KEDA, operators, service mesh, policy engines | Smaller, but integrated |
| Operational load | Upgrades every few months, add-ons, networking, security policies | Most of it is the provider's |
| Fixed cost | Control plane + system pods + spare node capacity | Close to zero at idle (scale to zero on Cloud Run) |

!!! tip "In the interview"

    You rarely draw Kubernetes in a system-design interview — you draw *stateless service replicas behind a load balancer with autoscaling*. Kubernetes is the implementation detail you mention when asked "how do you deploy and scale this?". Good signals: distinguishing **readiness from liveness**, knowing that **autoscaling has lag** (and pre-scaling for known peaks), keeping **databases out of the cluster** or on operators with care, and spreading replicas **across availability zones**.

!!! success "Best practices"

    - **Give the startup probe the worst-case start, not the typical one** — `periodSeconds × failureThreshold` must cover a cold start with migrations. In BoxOffice: 5 s × 60 = 5 min in [lab 10](../../../hands-on/10/deploy/index.md).
    - **Roll out with `maxUnavailable: 0` and a small surge** — capacity never drops below the desired count during a deploy, at the price of one extra pod. In BoxOffice: `maxSurge: 1` in `k8s/base/catalog.yaml` ([lab 10](../../../hands-on/10/deploy/index.md)).
    - **Pause a few seconds in `preStop` before the process stops accepting** — endpoint removal reaches every node with a delay, and requests keep arriving meanwhile. In BoxOffice: a 5 s `preStop` sleep, measured in [lab 10 — Measure it](../../../hands-on/10/measure/index.md).
    - **Scale up fast and down slowly** — no stabilization window going up, minutes going down, so a short dip does not remove capacity needed again a minute later. In BoxOffice: 0 s up, 120 s down in `catalog-hpa.yaml` ([lab 10](../../../hands-on/10/autoscaling/index.md)).
    - **Keep room for the pods of one node (N + 1 nodes)** — otherwise the replacements of a dead node stay `Pending`. In BoxOffice: [Losing a node](#losing-a-node).
    - **Set a PodDisruptionBudget on every service with more than one replica** — node upgrades then drain one pod at a time. In BoxOffice: `minAvailable: 3` in the `catalog` manifests above.

!!! warning "Pitfalls"

    - **No requests/limits**: the scheduler packs pods blindly and one noisy pod starves its neighbours.
    - **Liveness depending on downstream services**: a database blip restarts the whole fleet.
    - **No PodDisruptionBudget**: a routine node upgrade drains every `inventory` pod at once.
    - **All replicas in one zone or on one node**: "redundancy" that fails together.
    - **HPA on CPU for an I/O-bound service**: CPU stays low while latency explodes; scale on RPS or lag.
    - **`kubectl apply` from laptops** in production: nobody knows what is deployed — use GitOps ([Delivery](../delivery/index.md)).

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    ETCD["etcd: Raft<br/>→ Consensus (class 3)"] --> DS["desired state<br/>in the API server"]
    DS --> CL["control loop:<br/>actual → desired"]
    CL --> DEP["Deployment → pods"]
    DEP --> SVC["Service, Ingress, Gateway API<br/>→ Load balancing"]
    DEP --> PR["startup, readiness,<br/>liveness probes"]
    PR --> HC["health endpoints<br/>→ Reliability, Observability"]
    DEP --> RL["requests and limits,<br/>QoS, CPU throttling"]
    RL --> HPA["HPA, node autoscaler,<br/>KEDA on lag"]
    HPA --> PRE["pre-scale before 10:00<br/>→ Compute autoscaling"]
    RL --> COST["requests drive the bill<br/>→ FinOps"]
    DEP --> PDB["PDB, zone spread<br/>→ redundancy"]
```

**Palette components:** [`app`](../../../reference/components/compute/index.md#app) · [`worker`](../../../reference/components/compute/index.md#worker) (KEDA scales `notification` on lag) · [`scheduler`](../../../reference/components/compute/index.md#scheduler) (CronJob releases expired holds) · [`lb`](../../../reference/components/edge/index.md#lb) (a Service is an L4 balancer) · [`ingress`](../../../reference/components/edge/index.md#ingress) · [`healthcheck`](../../../reference/components/observability/index.md#healthcheck) · [`metrics`](../../../reference/components/observability/index.md#metrics) (what the HPA reads). **Scenarios:** `scale-out`, `k8s-node-failure` (N + 1 nodes), `flash-sale` (pre-scaling). **Continues in:** [Traffic & edge — load balancing in Kubernetes](../../edge/load-balancing/index.md#kubernetes), [Distributed — consensus](../../distributed/consensus/index.md) (etcd), [Compute — autoscaling lag](../../compute/serverless-autoscaling/index.md#autoscaling-lag), [Reliability — health checks](../../reliability/patterns/index.md#health-checks), [FinOps](../finops/index.md), [Exercise — Kubernetes autoscaling](../../../exercises/kubernetes-autoscaling/index.md).

---

[^1]: BURNS, B.; GRANT, B.; OPPENHEIMER, D.; BREWER, E.; WILKES, J. [Borg, Omega, and Kubernetes](https://queue.acm.org/detail.cfm?id=2898444){target="_blank"}. *ACM Queue*, v. 14, n. 1, 2016.
[^2]: Kubernetes documentation. [Concepts](https://kubernetes.io/docs/concepts/){target="_blank"}; [Horizontal Pod Autoscaling](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/){target="_blank"}; [Configure liveness, readiness and startup probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/){target="_blank"}.
[^3]: Kubernetes SIG Network. [Gateway API](https://gateway-api.sigs.k8s.io/){target="_blank"}.
[^4]: KEDA. [Kubernetes Event-driven Autoscaling](https://keda.sh/){target="_blank"}; Karpenter. [Documentation](https://karpenter.sh/){target="_blank"}.
[^5]: BURNS, B.; BEDA, J.; HIGHTOWER, K.; EVENSON, L. *Kubernetes: Up and Running*. 3rd ed. O'Reilly, 2022.
