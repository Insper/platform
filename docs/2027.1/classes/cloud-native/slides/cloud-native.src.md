---
marp: true
lang: en
title: Cloud-native platforms and delivery
description: System Architecture · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">System Architecture · Insper</div>

# Cloud-native platforms and delivery

**Where the code runs, how it gets there, how it scales — and who pays**

<!--
Outline: (1) cloud-native and service models; (2) containers; (3) Kubernetes; (4) IaC, CI, GitOps,
deployment strategies and canary analysis; (5) FinOps and the BoxOffice cost model.
-->

---

## BoxOffice leaves the laptop

<div class="q">

Nine services run fine with `docker compose up`. What changes on the morning a stadium show goes on sale?

</div>

* **20× the traffic for 30 minutes**, then back to normal — and nobody wants to pay for idle machines.
* A fix to `inventory` at 09:55 must ship **without downtime** at 10:00.
* Someone must know **what it costs** before the invoice arrives.
* None of these is an application problem: they are **platform** problems.

<!--
Let the class list the problems before revealing. Every item maps to a part of the class:
elasticity (Kubernetes), safe delivery (GitOps + canary), cost (FinOps).
-->

---

## What "cloud-native" means

| Idea | BoxOffice example |
|---|---|
| **Immutable artifacts** | `inventory:1.8.3` built once, promoted unchanged |
| **Declarative desired state** | "5 replicas of `catalog`" — a controller makes it true |
| **Elasticity** | `catalog` 4 → 40 replicas during the on-sale |
| **Automation end to end** | merged PR → pipeline → production |

<div class="warn">

The app must cooperate: **stateless** processes, config from the **environment**, fast start and **graceful shutdown**, logs to `stdout` (twelve-factor).

</div>

---

## Service models: who operates what

| Layer | IaaS | CaaS | PaaS | FaaS | SaaS |
|---|---|---|---|---|---|
| Data and access rules | you | you | you | you | **you** |
| Application code | you | you | you | you | provider |
| Runtime | you | you (image) | provider | provider | provider |
| Scheduling / scaling | you | provider | provider | provider | provider |
| OS, hardware | you / provider | shared | provider | provider | provider |

- Choose **per component**: services on CaaS, PostgreSQL as DBaaS, thumbnails on FaaS, payments as SaaS.
- Why not all FaaS? **Connection pools**, **cold starts at the peak**, **steady-load cost**.

---

## Containers are processes

<div class="cols">
<div>

### Namespaces — what it sees

- own PIDs, network, mounts, hostname
- `catalog` is PID 1 in its own world

### cgroups — what it may use

- CPU, memory, I/O limits
- above the memory limit → `OOMKilled`

</div>
<div>

### vs. virtual machines

- one **shared kernel** — start in ms, high density
- weaker isolation → multi-tenant clouds add **micro-VMs** (Firecracker, gVisor)

</div>
</div>

<div class="warn">

The JVM must size its heap from the **container** limit: `-XX:MaxRAMPercentage=75`.

</div>

---

<!-- _class: tight -->

## A production image for `catalog`

```dockerfile
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
RUN mvn -q dependency:go-offline          # cached until pom.xml changes
COPY src ./src
RUN mvn -q package -DskipTests && java -Djarmode=tools -jar target/catalog.jar \
      extract --layers --launcher --destination target/extracted

FROM gcr.io/distroless/java21-debian12:nonroot
COPY --from=build /src/target/extracted/dependencies/ ./
COPY --from=build /src/target/extracted/application/ ./
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75"
USER nonroot
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

Multi-stage · dependencies before source · distroless · non-root · **exec form** so `SIGTERM` reaches Java.

---

## Images and the supply chain

- An OCI image = **manifest** + **config** + **layers**, all addressed by SHA-256 **digest**.
- Tags move; **digests do not** — deploy by digest.
- **Scan** (Trivy) · **SBOM** (Syft, CycloneDX) · **sign** (Cosign) · **provenance** (SLSA).
- Never bake secrets into layers: they stay in the history forever.

<div class="ok">

Small, layered images = **faster scale-out**: every new node must pull the image before the pod starts.

</div>

---

## Kubernetes: the control loop

```
loop:
    desired = spec in the API server   # "4 replicas of catalog"
    actual  = observe the cluster      # 2 (a node died)
    act to reduce the difference       # create 2 pods, schedule them
```

- **API server + etcd** store state; **scheduler** places pods; **controllers** reconcile; **kubelet** runs containers.
- Self-healing, rolling updates and autoscaling are all the **same loop**.

<!--
Ask: who restarts the pods when a node loses power? Answer: nobody — the ReplicaSet controller
sees 2 instead of 4 and creates pods; the scheduler finds room.
-->

---

<!-- _class: tight -->

## The objects behind one service

| Object | Role for `catalog` |
|---|---|
| **Deployment** | 4 identical pods; rolling update with `maxUnavailable: 0` |
| **Service** | stable DNS name `catalog:8080` in front of changing pods |
| **HTTPRoute** (Gateway API) | `/catalog` from the internet → Service; weighted backends for canaries |
| **ConfigMap / Secret** | database URL / credentials as environment variables |
| **HPA** | 4 → 40 replicas, target 60 % CPU of the request |
| **PodDisruptionBudget** | never fewer than 3 pods during node upgrades |
| **topologySpreadConstraints** | replicas spread across availability zones |

---

## Probes answer three different questions

| Probe | Question | On failure |
|---|---|---|
| **Startup** | finished starting? (JVM warm-up) | others disabled; restart after the threshold |
| **Readiness** | should I get traffic **now**? | removed from endpoints — no restart |
| **Liveness** | stuck beyond repair? | container restarted |

<div class="warn">

Never put the **database** in liveness (restart storm) — and not in readiness either: one DB blip makes **every** pod unready at once.

</div>

---

## Requests, limits, throttling

- **Request** = what the scheduler reserves; the base of the HPA percentage.
- **Memory limit** exceeded → `OOMKilled` (an error).
- **CPU limit** exceeded → **throttled** (latency, not errors).

<div class="q">

Average CPU 45 %, p99 spiky. Why?

</div>

* Threads burn the 100 ms CFS quota early in each period and wait for the rest.
* Check `container_cpu_cfs_throttled_periods_total`; keep the CPU request, consider no CPU limit.

---

## Autoscaling at three levels — and its lag

- **HPA** (pods): `desired = ⌈current × metric / target⌉` → 4 pods at 90 % with target 60 % → **6**.
- **Cluster Autoscaler / Karpenter** (nodes): minutes — VM boot, join, image pull.
- **KEDA** (events): Kafka lag, queue length, cron; scale to zero.

<div class="warn">

A flash sale goes 5 % → 100 % in seconds; autoscaling needs minutes. **Pre-scale** at 09:45, keep spare nodes, and let a **waiting room** control admission.

</div>

---

## The delivery pipeline

PR → **CI** (build · test · scan · SBOM · sign · push) → **config repo** (digest bumped) → **Argo CD** syncs → **canary** 5 % → 25 % → 50 % → **analysis** → promote or roll back.

- **IaC** (Terraform / OpenTofu): VPC, cluster, PostgreSQL, buckets as reviewed code; remote, locked **state**; scheduled `plan` detects **drift**.
- **CI never touches production**: it only writes to Git.
- **Build once, promote by digest** from staging to production.

---

## GitOps: pull, don't push

| | Push (`kubectl apply` in CI) | **Pull** (Argo CD, Flux) |
|---|---|---|
| Credentials | CI is cluster-admin | only the in-cluster agent |
| Drift | unnoticed | detected, reverted (`selfHeal`) |
| Audit | CI logs | `git log` |
| Rollback | re-run a pipeline | `git revert` |

OpenGitOps: declarative · versioned and immutable · pulled automatically · continuously reconciled.

---

<!-- _class: tight -->

## Deployment strategies

| Strategy | Downtime | Extra capacity | Rollback | Initial blast radius |
|---|---|---|---|---|
| Recreate | yes | none | slow | 100 % |
| Rolling update | no | small | gradual | grows |
| Blue/green | no | 2× briefly | instant switch | 100 % |
| **Canary** | no | small | weight → 0 | 1–5 % |
| Shadow | no | up to 2× | n/a | 0 % (side effects!) |
| Feature flags | no | none | flip the flag | chosen users |

<div class="warn">

The database does not roll back: **expand / contract** so two versions can run side by side.

</div>

---

## Canary judged by metrics

- Argo Rollouts: `setWeight 5 → 25 → 50`, an **AnalysisTemplate** queries Prometheus each minute.
- Abort when canary **error rate > 0.5 %** or **p99 > 300 ms** twice — compared with the **stable baseline**, same traffic, same hour.

| Regression (baseline 0.1 %) | Requests needed | Time at 5 % of 400 req/s |
|---|---|---|
| → 1.0 % | ≈ 835 | < 1 min |
| → 0.5 % | ≈ 2 300 | ≈ 2 min |
| → 0.2 % | ≈ 18 500 | ≈ 15 min |

<div class="ok">

Canary steps are **minutes**, not seconds: rare errors need samples.

</div>

---

## DORA: speed and stability together

| Metric | Measures |
|---|---|
| Deployment frequency | throughput |
| Lead time for changes | throughput |
| Change failure rate | stability |
| Time to restore service | stability |

- High performers are better on **all four**: small, frequent, automatically verified changes are faster **and** safer.
- AI in the pipeline (PR review, generated tests, AI canary analysis) → class **AI-Assisted Delivery**.

---

## FinOps: inform → optimize → operate

- **Inform**: tags (`service`, `team`, `env`), Kubernetes cost by requests (OpenCost), showback.
- **Optimize**: rightsizing, autoscaling, commitments for the floor, spot for interruptible work, ARM, less egress.
- **Operate**: budgets, anomaly alerts, policies, monthly review next to the SLO review.

<div class="warn">

Surprises come from **fixed hourly items** (control plane, LB, NAT), **data transfer** and **observability** — not from CPUs.

</div>

---

<!-- _class: tight -->

## BoxOffice: where the money goes (model)

| Line (approx., us-east-1) | $/month |
|---|---|
| CDN egress, 20 TB | ≈ 1 700 |
| Worker nodes, 6 always on | ≈ 840 |
| Kafka, 3 brokers | ≈ 610 |
| PostgreSQL Multi-AZ + replica | ≈ 560 |
| Logs, 1 TB ingested | ≈ 500 |
| Redis, NAT, LB, control plane, e-mail… | ≈ 790 |
| **24 extra nodes for 4 on-sales × 2 h** | **≈ 37** |

<div class="ok">

The **peak is cheap** when it is elastic: the same 24 nodes always on would cost ≈ $3 400/month.

</div>

---

## Pay per request or per hour?

- FaaS: no floor, higher cost per request. Containers: fixed floor, low marginal cost.
- With the page's assumptions, break-even ≈ **10 req/s average**.
- **Average** decides FaaS cost; **peak** decides container size.
- BoxOffice: thumbnails and webhooks on **FaaS**; the purchase path on **containers**.

<div class="q">

Multi-AZ doubles the database bill. Waste?

</div>

* No — it **buys availability**. FinOps is not "spend less", it is "know what each dollar buys".

---

<!-- _class: tight -->

## The cloud-native concept map

| Component | Question it answers | Key concepts |
|---|---|---|
| `app` · `worker` | packaged to run the same everywhere? | stateless, OCI image, digest, graceful shutdown |
| `app` · `ingress` · `healthcheck` | who keeps N healthy replicas? | control loop, Service, probes, requests/limits |
| `app` · `worker` · `scheduler` | how does capacity follow the on-sale? | HPA, node autoscaler, KEDA, pre-scaling |
| `serverless` | pay per request or per hour? | cold starts, concurrency, break-even |
| `sql` · `cache` · `kafka` · `payment` | who operates each component? | IaaS … SaaS, shared responsibility |
| `metrics` · `ingress` | how does a change reach production? | IaC, GitOps, canary judged on SLOs |
| `cdn` · `nat` · `logs` | where does the money go? | fixed vs variable, egress, unit economics |

<p class="small">Cloud-native is not a box on the diagram: it is how <b>every</b> box is packaged, run, delivered and paid for.</p>

---

## Takeaways

1. Cloud-native = immutable artifacts, declarative state, elasticity, automation — on **stateless, disposable** apps.
2. Choose the **service model per component**; data, identity and config are always yours.
3. Small, layered, signed images, deployed **by digest**; graceful shutdown on `SIGTERM`.
4. Kubernetes is a **control loop**; get probes, requests/limits and PDBs right.
5. Autoscaling **lags**: pre-scale for known peaks.
6. IaC + CI + **GitOps** + **canary gated by SLO metrics** + expand/contract migrations.
7. **FinOps**: tag, model, and optimize what dominates — usually data, egress and fixed items.
