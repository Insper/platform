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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

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
| **Automation end to end** | merged pull request → pipeline → production |

<div class="warn">

The app must cooperate: **stateless** processes, config from the **environment**, fast start and **graceful shutdown**, logs to `stdout` (twelve-factor).

</div>

---

<!-- _class: tight -->

## Service models: who operates what

<p class="small">Infrastructure, containers, platform, functions, software <i>as a service</i> (IaaS, CaaS, PaaS, FaaS, SaaS); managed databases are DBaaS.</p>

<div class="matrix" style="--n: 6">
<div class="head"></div>
<div class="head">On-premises</div>
<div class="head">IaaS</div>
<div class="head">CaaS</div>
<div class="head">PaaS</div>
<div class="head">FaaS</div>
<div class="head">SaaS</div>
<div class="row">Data and access rules</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="row">Application code</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box accent">provider</div>
<div class="row">Runtime (JVM, Python)</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="row">Orchestration and scaling</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="row">Operating system</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box muted">shared</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="row">Virtualization, hardware</div>
<div class="box orange">you</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
</div>

- Your share shrinks one layer per model, except from PaaS to FaaS (same column: an app or a function).
- Whatever the model, **data, identities and access rules stay yours**: a public bucket is a customer mistake.

<!--
The page's table, as a matrix. The only shared cell is the OS on CaaS: with classic node groups the team
rolls the nodes onto the provider's patched image; with Fargate or GKE Autopilot the provider does it all.
-->

---

## Who acts when something happens?

| Event | Layer | IaaS | CaaS | PaaS / FaaS |
|---|---|---|---|---|
| JDK flaw | runtime | you | **you** (JDK in your image) | provider |
| Kernel flaw | OS | you | **shared** (nodes) | provider |
| On-sale 20× | orchestration and scaling | you add VMs | platform, **within your limits** | platform, within your limits |
| Public bucket | data and access | **you** | **you** | **you** (and on SaaS too) |

<div class="ok">

**Simulator on the page**: pick a model and an event, and see which layer it hits and who acts.

</div>

<!--
The simulator responsibility-stack sits under the stack table of the overview. The on-sale hits a real
layer of this table (orchestration and scaling): on CaaS the HPA adds pods, but maxReplicas and the
09:45 pre-scale are the team's. On-premises the capacity had to be bought months before (CapEx, FinOps).
-->

---

<!-- _class: tight -->

## Who offers each model

| Model | AWS | Google Cloud | Microsoft Azure | Other providers |
|---|---|---|---|---|
| **IaaS** | EC2 | Compute Engine | Virtual Machines | DigitalOcean, Oracle Cloud, Magalu Cloud |
| **CaaS** | EKS, ECS on Fargate | GKE, Cloud Run | AKS, Container Apps | DigitalOcean Kubernetes, OVHcloud |
| **PaaS** | Elastic Beanstalk | App Engine | App Service | Heroku, Railway, Render, Fly.io |
| **FaaS** | Lambda | Cloud Run functions | Azure Functions | Cloudflare Workers, Vercel |
| **DBaaS** | RDS, Aurora, ElastiCache, MSK | Cloud SQL, AlloyDB, Memorystore | Azure Database, Managed Redis | Neon, Supabase, Aiven |
| **SaaS** | SES (e-mail) | Workspace | Microsoft 365, Dynamics 365 | Stripe, Mercado Pago, Datadog, TOTVS, RD Station |

<div class="ok">

Read by columns: AWS is on every row — **a model describes a service, not a company**.

</div>

<!--
On AWS, BoxOffice is one column: EKS, RDS and ElastiCache, MSK, S3, Lambda. Nothing forces one company
per system: payments go to Stripe or Mercado Pago, the code and CI to GitHub.
-->

---

## BoxOffice, component by component

<div class="flow" style="align-items: stretch">
<div class="group"><div class="caption">CaaS · managed Kubernetes</div><div class="box accent">gateway · catalog · inventory · order · search</div></div>
<div class="group"><div class="caption">DBaaS · managed</div><div class="box green">PostgreSQL Multi-AZ</div><div class="box green">Redis · Kafka</div></div>
<div class="group"><div class="caption">FaaS</div><div class="box orange">thumbnails · webhooks</div></div>
<div class="group"><div class="caption">SaaS</div><div class="box muted">payments · e-mail</div></div>
</div>

<div class="q">

Why not run everything on FaaS?

</div>

* **Connection pools**: thousands of short-lived functions would exhaust PostgreSQL.
* **Cold starts and concurrency limits** hurt exactly at the 10:00 peak.
* **Steady-load cost**: a service busy 24/7 is cheaper on always-on containers (FinOps break-even).

<!--
Multi-AZ: a standby in a second availability zone. Ticket PDFs and images go to the object store
(S3), an IaaS-level storage service.
-->

---

## Platform engineering: golden paths

<div class="flow">
<div class="box">product team<small>order, inventory…</small></div><div class="arrow">uses →</div>
<div class="box accent">developer portal<small>e.g. Backstage</small></div><div class="arrow">→</div>
<div class="group"><div class="box">service template<small>Dockerfile · manifests · pipeline</small></div><div class="box">self-service environments</div><div class="box">built-in dashboards and alerts</div></div>
<div class="arrow">→</div>
<div class="box green">platform<small>Kubernetes · Argo CD · Terraform modules · policies</small></div>
</div>

- An **internal developer platform (IDP)**, built as a product by a platform team for the other teams.
- A golden path is **optional but attractive**: a new service gets a hardened image, probes, a pipeline, a canary and dashboards on day one.

<div class="warn">

Treat the platform as a product with users — or it becomes the ticket queue again.

</div>

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

The Java virtual machine (JVM) must size its heap from the **container** limit: `-XX:MaxRAMPercentage=75`.

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

## Graceful shutdown, step by step

<div class="flow">
<div class="box">pod Terminating<small>removed from the endpoints</small></div><div class="arrow">+</div>
<div class="box orange">preStop: sleep 5 s<small>proxies catch up</small></div><div class="arrow">→</div>
<div class="box accent">SIGTERM</div><div class="arrow">→</div>
<div class="box">stop accepting, finish in-flight<small>up to 20 s</small></div><div class="arrow">→</div>
<div class="box green">exit 0</div>
</div>
<div class="flow"><div class="box muted">still running after the 30 s grace period → SIGKILL</div></div>

- Spring Boot: `server.shutdown: graceful` and `timeout-per-shutdown-phase: 20s` — less than Kubernetes' 30 s.
- **Exec-form** `ENTRYPOINT`: Java is PID 1 and receives the `SIGTERM` (shell form: `sh` swallows it).

<!--
Endpoint removal and SIGTERM start at the same moment; without the preStop pause some proxies still send
requests to a pod that no longer accepts them. Lab 10 measures it: 0 failed requests with the pause.
-->

---

## Images and the supply chain

- An Open Container Initiative (OCI) image = **manifest** + **config** + **layers**, all addressed by SHA-256 **digest**.
- Tags move; **digests do not** — deploy by digest.
- **Scan** (Trivy) · **SBOM**, software bill of materials (Syft, CycloneDX) · **sign** (Cosign) · **provenance** (SLSA: supply-chain levels for software artifacts).
- Never bake secrets into layers: they stay in the history forever.

<div class="ok">

Small, layered images = **faster scale-out**: every new node must pull the image before the pod starts.

</div>

---

## Kubernetes: the control loop

<div class="flow">
<div class="box accent">desired state<small>API server + etcd · "4 replicas"</small></div><div class="arrow">watch →</div>
<div class="box">controller compares<small>actual: 2 (a node died)</small></div><div class="arrow">→</div>
<div class="box orange">act<small>create 2 pods</small></div><div class="arrow">→</div>
<div class="box">scheduler binds<small>a node with room</small></div><div class="arrow">→</div>
<div class="box green">kubelet starts, probes pass<small>actual = desired</small></div>
</div>
<div class="flow"><div class="arrow" style="flex: 1">↺ forever, every few seconds: nothing to do while actual = desired</div></div>

- Self-healing, rolling updates and autoscaling are all the **same loop**.
- The API is declarative and idempotent: applying the same manifest twice changes nothing.

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
| **HPA** (Horizontal Pod Autoscaler) | 4 → 40 replicas, target 60 % CPU of the request |
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

* Threads burn the 100 ms quota of the completely fair scheduler (CFS) early in each period and wait for the rest.
* Check `container_cpu_cfs_throttled_periods_total`; keep the CPU request, consider no CPU limit.

---

## Losing a node

<div class="flow">
<div class="box red">node dies<small>2 catalog pods</small></div><div class="arrow">→</div>
<div class="box red">callers still send to them<small>tens of seconds</small></div><div class="arrow">→</div>
<div class="box">NotReady, endpoints updated</div><div class="arrow">→</div>
<div class="box">pods evicted<small>tolerations: 5 min by default</small></div><div class="arrow">→</div>
<div class="group"><div class="box green">room: rescheduled</div><div class="box red">cluster full: Pending</div></div>
</div>

- Self-healing needs **room** (N + 1 nodes) and **fast endpoint updates**.
- Playground `k8s-node-failure` (3 full nodes): errors ≈ 27% → 25% with room → ≈ 4% with fast endpoint updates.

<!--
The page's diagram plays the same steps. Remaining errors come from the survivors carrying the load of 6
pods with 4; 8 replicas bring the errors to about 1.7%.
-->

---

## Autoscaling at three levels — and its lag

- **HPA** (pods): `desired = ⌈current × metric / target⌉` → 4 pods at 90 % with target 60 % → **6**.
- **Cluster Autoscaler / Karpenter** (nodes): minutes — VM boot, join, image pull.
- **KEDA**, Kubernetes Event-Driven Autoscaler (events): Kafka lag, queue length, cron; scale to zero.

<div class="warn">

A flash sale goes 5 % → 100 % in seconds; autoscaling needs minutes. **Pre-scale** at 09:45, keep spare nodes, and let a **waiting room** control admission.

</div>

---

## The delivery pipeline

<div class="flow">
<div class="box">pull request</div><div class="arrow">→</div>
<div class="box accent">CI<small>build · test · scan · SBOM · sign · push</small></div><div class="arrow">→</div>
<div class="box">config repo<small>digest bumped</small></div><div class="arrow">→</div>
<div class="box accent">Argo CD<small>syncs the cluster to Git</small></div><div class="arrow">→</div>
<div class="box orange">canary<small>5 → 25 → 50 %</small></div><div class="arrow">→</div>
<div class="group"><div class="box green">healthy: 100 %</div><div class="box red">degraded: rollback</div></div>
</div>

- **Continuous integration (CI)** never touches production: it only writes to Git. **Build once, promote by digest.**
- **Infrastructure as code (IaC)**, Terraform / OpenTofu: virtual private cloud (VPC), cluster, PostgreSQL, buckets as reviewed code; remote, locked **state**; a scheduled `plan` detects **drift**.

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

## Expand / contract: the database does not roll back

<div class="flow">
<div class="box">v1 uses <code>email</code></div><div class="arrow">→</div>
<div class="box accent">1 expand<small>add <code>buyer_email</code>, nullable</small></div><div class="arrow">→</div>
<div class="box">2 v2 writes both<small>reads new, falls back</small></div><div class="arrow">→</div>
<div class="box accent">3 backfill</div><div class="arrow">→</div>
<div class="box green">4 contract<small>drop <code>email</code>, next release</small></div>
</div>
<div class="flow"><div class="box red">rename in one release → v1 pods still running query a column that is gone</div></div>

- Old and new pods overlap during every rolling update or canary: each step must work with both.

<!--
Same steps as the diagram on the Delivery page. Never rename or drop a column in the release that stops using it.
-->

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

<p class="small">DevOps Research and Assessment (DORA): four metrics that move together.</p>

| Metric | Measures |
|---|---|
| Deployment frequency | throughput |
| Lead time for changes | throughput |
| Change failure rate | stability |
| Time to restore service | stability |

- High performers are better on **all four**: small, frequent, automatically verified changes are faster **and** safer.
- AI in the pipeline (pull-request review, generated tests, AI canary analysis) → class **AI-Assisted Delivery**.

---

## From CapEx to OpEx

{{INCLUDE:docs/2027.1/classes/cloud-native/finops/capex-opex.svg}}

<p class="small">Capital expenditure (CapEx) buys capacity in steps months ahead: <b>idle</b> after each purchase, <b>shortage</b> before the next. Operational expenditure (OpEx) follows demand: BoxOffice runs 6 nodes all month and 24 more only for the 8 hours of on-sales.</p>

<!--
OpEx removes the up-front bet but is not automatically cheaper: a workload at full load 24/7 for years can
cost less on owned or committed capacity (the commitments of the pricing models). And a bill that follows
usage also follows every mistake, within the month: that is what FinOps is for.
-->

---

## FinOps: inform → optimize → operate

- **Inform**: tags (`service`, `team`, `env`), Kubernetes cost by requests (OpenCost), showback.
- **Optimize**: rightsizing, autoscaling, commitments for the floor, spot for interruptible work, ARM, less egress.
- **Operate**: budgets, anomaly alerts, policies, monthly review next to the service level objective (SLO) review.

<div class="warn">

Surprises come from **fixed hourly items** (control plane, load balancer, NAT gateway), **data transfer** and **observability** — not from CPUs.

</div>

---

<!-- _class: tight -->

## BoxOffice: where the money goes (model)

| Line (approx., us-east-1) | $/month |
|---|---|
| Content delivery network (CDN) egress, 20 TB | ≈ 1 700 |
| Worker nodes, 6 always on | ≈ 840 |
| Kafka, 3 brokers | ≈ 610 |
| PostgreSQL Multi-AZ + replica | ≈ 560 |
| Logs, 1 TB ingested | ≈ 500 |
| Redis, NAT, load balancer, control plane, e-mail… | ≈ 790 |
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
2. Choose the **service model per component** — a model is a service, not a company; data, identity and config are always yours.
3. Small, layered, signed images, deployed **by digest**; graceful shutdown on `SIGTERM`.
4. Kubernetes is a **control loop**; get probes, requests/limits and PodDisruptionBudgets right; keep room for a lost node.
5. Autoscaling **lags**: pre-scale for known peaks.
6. IaC + CI + **GitOps** + **canary gated by SLO metrics** + expand/contract migrations.
7. **FinOps**: OpEx follows demand but is not automatically cheaper; tag, model and optimize what dominates — usually data, egress and fixed items.
