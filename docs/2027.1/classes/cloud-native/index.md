BoxOffice runs on a laptop: nine services, PostgreSQL, Redis and Kafka, all started with one `docker compose up`. Then reality arrives. On a normal Tuesday the platform serves a few hundred requests per second; on the morning a stadium show goes on sale it must absorb **twenty times that for thirty minutes**, and shrink back afterwards so nobody pays for idle machines. The team wants to ship a fix to `inventory` at 09:55 without taking the site down at 10:00, and to know *before* the invoice arrives how much the whole thing costs.

None of these is an application problem. They are **platform** problems: where the code runs, how it gets there, how it scales, and who pays for it. This class is about the set of practices and tools — containers, Kubernetes, infrastructure as code, continuous delivery, GitOps, progressive delivery and FinOps — that the industry calls **cloud-native**.

!!! quote "The story so far"

    Chapter 11 of the [story of the course](../../index.md#story). BoxOffice has all its building blocks: an edge, stateless services, a database that sells each seat once, caches, a fair queue, telemetry and resilience patterns ([class 4](../edge/index.md) to [class 10](../reliability/index.md)). The patterns work, but all of it still runs on one laptop with `docker compose up`, and Compose does not restart a dead replica on another node, add `catalog` replicas at 09:45 or roll a bad release back. **This class** answers: where does the code run, how does it get there, how does it scale — and what does it cost?

!!! abstract "Learning objectives"

    By the end of this class you should be able to:

    - **Explain** what "cloud-native" means and which properties of an application (stateless processes, configuration in the environment, disposability) make it portable across platforms.
    - **Map** each BoxOffice component to a service model (IaaS, CaaS, PaaS, FaaS, DBaaS, SaaS) and **justify** the trade-off between control and operational effort.
    - **Build** a small, secure container image for a Java service and **describe** what an OCI image is made of.
    - **Write** the Kubernetes manifests (Deployment, Service, probes, resources, HPA, PodDisruptionBudget, Ingress) that run a BoxOffice service, and **predict** what the control plane does when a pod dies.
    - **Design** a delivery pipeline — infrastructure as code, CI, GitOps and a canary rollout gated by metrics — and **choose** a deployment strategy for a given risk.
    - **Estimate** the monthly cost of the BoxOffice architecture, **identify** its fixed and variable costs, and **propose** optimizations backed by numbers.

## Roadmap

1. **This overview** — what cloud-native means, the twelve-factor properties, service models and platform engineering.
2. [Containers](containers/index.md) — namespaces and cgroups, OCI images and layers, a production Dockerfile for a Spring Boot service, supply-chain hygiene.
3. [Kubernetes](kubernetes/index.md) — the control loop, the core objects, probes, resources, autoscaling (HPA, cluster autoscaling, KEDA) and BoxOffice's manifests.
4. [Delivery](delivery/index.md) — Terraform/OpenTofu, GitHub Actions, GitOps with Argo CD, deployment strategies and a canary with automated metrics analysis.
5. [FinOps](finops/index.md) — cloud pricing models, a cost model of BoxOffice, unit economics and how to cut the bill.
6. [Quiz](quiz.md) — check your understanding.

## Slides

<div class="slides-embed">
  <iframe src="slides/cloud-native.html" title="Slides: cloud-native platforms and delivery" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/cloud-native.html){:target="_blank"}

---

## What "cloud-native" means

The Cloud Native Computing Foundation (CNCF) defines cloud-native technologies as those that "empower organizations to build and run scalable applications in modern, dynamic environments such as public, private, and hybrid clouds", citing containers, service meshes, microservices, immutable infrastructure and declarative APIs as the typical building blocks[^1]. Stripped of the marketing, the definition rests on four ideas:

| Idea | What it means | BoxOffice example |
|---|---|---|
| **Immutable artifacts** | You never patch a running server; you build a new image and replace the old instances | `inventory:1.8.3` is built once and promoted unchanged from staging to production |
| **Declarative desired state** | You describe *what* you want (5 replicas of `catalog`), and a controller continuously makes reality match | Kubernetes restarts a crashed `order` pod without anyone being paged |
| **Elasticity** | Capacity follows demand, automatically, in minutes or seconds | `catalog` goes from 4 to 40 replicas during the flash sale and back to 4 at lunch |
| **Automation end to end** | Infrastructure, builds, tests, deploys and rollbacks are code, versioned in Git | A merged pull request reaches production through a pipeline, not a checklist |

The opposite is a **pet server**: a machine with a name, configured by hand over years, that nobody dares to reboot. Cloud-native systems treat instances as **cattle** — numbered, identical and replaceable. The phrase is an old operations joke, but it captures the shift: an instance failure becomes a routine event handled by software, not an incident handled by people.

### The application has to cooperate

A platform can only restart, move and multiply a process that allows it. The **Twelve-Factor App** methodology, written by Heroku engineers in 2011, lists the properties that make an application portable across platforms[^2]. Six of the twelve matter most for this class:

| Factor | Rule | What breaks if you ignore it |
|---|---|---|
| **III. Config** | Configuration (URLs, credentials, feature switches) comes from the environment, not from the code | One image per environment; secrets end up in Git |
| **IV. Backing services** | PostgreSQL, Redis, Kafka and the payment provider are attached resources, addressed by URL | Moving from Compose to a managed database requires code changes |
| **VI. Processes** | Processes are stateless; state lives in backing services | A user loses the cart when the pod holding it in memory is replaced |
| **IX. Disposability** | Start fast, shut down gracefully on `SIGTERM` | Rolling updates drop in-flight requests; autoscaling reacts too slowly |
| **X. Dev/prod parity** | Keep development, staging and production as similar as possible | "Works on my machine"; load tests that measure the wrong system |
| **XI. Logs** | Write logs to `stdout` as an event stream; the platform collects them | Logs vanish with the container; disks fill up |

!!! example "BoxOffice: the seat hold that lived in memory"

    An early version of `inventory` kept seat holds in a `ConcurrentHashMap` inside the JVM. It worked with one instance. With three replicas behind a load balancer, a fan who held seat A-12 on replica 1 could see it as free on replica 2 — and during a rolling update every hold on the replaced pod disappeared. Moving holds to PostgreSQL (with an expiry column) or to Redis (with a TTL) made the service **stateless** (factor VI) and therefore safe to scale and to replace. See [Databases — transactions](../databases/transactions/index.md) for how the hold itself is made consistent.

---

## Service models: who operates what { #service-models }

Every component of BoxOffice has to run *somewhere*, and for each one the team chooses how much of the stack it operates itself. The NIST definition of cloud computing introduced three service models[^3]; practice has added several more. All of them can be read on the same stack of layers:

| Layer | On-premises | IaaS | CaaS | PaaS | FaaS | SaaS |
|---|---|---|---|---|---|---|
| Data and access rules | you | you | you | you | you | you |
| Application code | you | you | you | you | you | provider |
| Runtime (JVM, Python) | you | you | you (in the image) | provider | provider | provider |
| Container orchestration and scaling | you | you | provider (control plane) | provider | provider | provider |
| Operating system | you | you | shared (nodes) or provider (Fargate, Autopilot) | provider | provider | provider |
| Virtualization, hardware, data centre | you | provider | provider | provider | provider | provider |

- **IaaS — Infrastructure as a Service.** Virtual machines, disks and networks (Amazon EC2, Google Compute Engine, Azure VMs). Maximum control, maximum toil: you patch the OS, install the JDK, configure the firewall.
- **CaaS — Containers as a Service.** You hand over container images; the provider runs the scheduler (Amazon EKS/ECS, Google GKE, Azure AKS). With serverless variants (AWS Fargate, GKE Autopilot) you do not see nodes at all.
- **PaaS — Platform as a Service.** You hand over code or an image plus a little configuration; the platform builds, runs, scales and routes (Heroku, Google App Engine, Azure App Service, Railway, Fly.io).
- **FaaS — Functions as a Service.** You hand over a function; the platform runs it per event and bills per invocation and millisecond (AWS Lambda, Google Cloud Run functions, Azure Functions). Scales to zero, but has **cold starts** and **concurrency limits** (see [Compute — serverless and autoscaling](../compute/serverless-autoscaling/index.md)).
- **DBaaS — Database as a Service.** Managed databases (Amazon RDS/Aurora, Cloud SQL, Azure Database for PostgreSQL): backups, failover, patching and replicas are buttons, not projects.
- **SaaS — Software as a Service.** A finished product used through an API or a browser: the payment provider, the e-mail provider, the observability vendor.

The rule that never changes, in any column: **your data, your identities and access rules, and your configuration remain your responsibility**[^4]. A public S3 bucket is a customer mistake, not a provider failure.

### BoxOffice, component by component

There is no single "right" model for a whole system. Each component gets the model that minimizes total effort for the control it needs:

| Component | Palette | Chosen model | Why | Alternative |
|---|---|---|---|---|
| `gateway`, `catalog`, `inventory`, `order`, `search` services | [App Server](../../reference/components/compute/index.md#app) | **CaaS** (managed Kubernetes) | Many services, shared tooling, fine control of scaling and rollout | PaaS while the team is small |
| Seat inventory and orders | [SQL Database](../../reference/components/storage/index.md#sql) | **DBaaS** (managed PostgreSQL, Multi-AZ) | Backups and failover are hard to get right; the data is the business | Self-managed on Kubernetes with an operator — only with a strong DBA team |
| Holds, sessions, hot catalog pages | [Cache](../../reference/components/storage/index.md#cache) | **DBaaS** (managed Redis-compatible) | Same reasons; the cache is on the critical path | Redis in a pod (dev only) |
| Events (orders, notifications) | [Kafka](../../reference/components/messaging/index.md#kafka) | **Managed Kafka** (Amazon MSK, Confluent Cloud) | Running Kafka well is a specialty | Strimzi operator on Kubernetes |
| Ticket PDFs, event images | [Object Store](../../reference/components/storage/index.md#objstore) | **IaaS-level storage service** (S3, GCS, Blob) | Practically unlimited, cheap, durable | — |
| Image thumbnails, webhook receivers | [Serverless](../../reference/components/compute/index.md#serverless) | **FaaS** | Bursty, event-driven, idle most of the time | A worker deployment |
| Card payments | [Payment](../../reference/components/external/index.md#payment) | **SaaS** (payment provider) | Card data compliance (PCI DSS) is not BoxOffice's core business | — |
| Transactional e-mail | [Email](../../reference/components/external/index.md#email) | **SaaS** | Deliverability and reputation are a business of their own | — |

??? question "Think first: why not run *everything* on FaaS and never think about servers again?"

    Three reasons. (1) **Long-lived connections and pools**: `inventory` keeps a warm connection pool to PostgreSQL; thousands of short-lived function instances would each open their own connections and exhaust the database (a proxy such as RDS Proxy mitigates this). (2) **Cold starts and concurrency limits** hurt exactly at the flash-sale peak, when the platform must scale from almost nothing to thousands of concurrent executions in seconds. (3) **Cost at steady load**: per-request billing is cheap for spiky, mostly idle work, but a service busy 24/7 is usually cheaper on always-on containers. The [FinOps](finops/index.md) page computes the break-even point.

Try it: open the scenario below and press **Run** with the `spike` profile. Watch the number of serverless instances, the cold-start latency at the beginning of the spike, and what happens to the error rate when the **concurrency limit** is reached. Then raise the limit (or enable provisioned concurrency) and run again.

<div class="sdp" data-scenario="serverless-burst" data-mode="compact" data-profile="spike" data-height="520"></div>

[Open the full playground](../../../playground/index.md) to change the components yourself.

---

## Platform engineering { #platform-engineering }

With fifteen services, three environments and five teams, every team rediscovering how to write a Dockerfile, a Helm chart, a pipeline and an alert is wasteful. **Platform engineering** answers with an **internal developer platform (IDP)**: a product, built by a platform team for the other engineering teams, that offers **golden paths** — paved, supported ways of doing common things[^5].

``` diagram
flowchart LR
    dev["Product team<br/>(order, inventory…)"] -->|"uses"| portal["Developer portal<br/>(e.g. Backstage)"]
    portal --> tmpl["Service template<br/>Dockerfile · manifests · pipeline"]
    portal --> env["Self-service environments<br/>(namespace, database, queue)"]
    portal --> obs["Built-in observability<br/>dashboards · SLO alerts"]
    tmpl --> plat["Platform: Kubernetes · Argo CD · Terraform modules · policies"]
    env --> plat
    obs --> plat
```

A good golden path is **optional but attractive**: a new BoxOffice service created from the template gets a hardened image, Kubernetes manifests with probes and resource limits, a CI pipeline with tests and image scanning, a canary rollout, a RED dashboard and an SLO alert — on day one. The team can leave the path when it has a reason; most never need to.

| Approach | Strength | Risk |
|---|---|---|
| Every team does its own operations ("you build it, you run it") | Autonomy, ownership | Duplicated effort, uneven quality, high cognitive load |
| Central operations team receives tickets | Consistency | Becomes a bottleneck; slow lead time |
| **Platform team offers self-service golden paths** | Autonomy *and* consistency | The platform must be treated as a product with users — otherwise it becomes the ticket queue again |

## The cloud-native concept map { #concept-map }

Cloud-native is not a palette component of its own: it is *how* every component is packaged, run, delivered and paid for. The map links the **palette components** (green) to the **platform concepts** of this class (blue):

``` diagram
flowchart LR
    app["app · worker"]:::comp --> c1["OCI images, layers, digests,<br/>graceful shutdown"]:::tech
    app --> c2["Deployment, Service, probes,<br/>requests and limits, HPA, KEDA"]:::tech
    edge["ingress · healthcheck"]:::comp -.- c2
    sls["serverless"]:::comp --> c3["FaaS: cold starts,<br/>concurrency limits"]:::tech
    data["sql · cache · kafka"]:::comp --> c4["DBaaS, managed services,<br/>Terraform / OpenTofu"]:::tech
    metrics["metrics"]:::comp --> c5["GitOps, canary gated<br/>by SLO metrics"]:::tech
    c1 --> c5
    bytes["cdn · nat · logs"]:::comp --> c6["FinOps: fixed vs variable cost,<br/>unit economics"]:::tech
    data --> c6
    c3 --> c6
    c5 -.- d1["SLIs, SLOs, error budgets<br/>(classes 9 and 10)"]
    c2 -.- d2["stateless services,<br/>autoscaling (class 5)"]
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

| Palette component | Question it answers | Concepts | Taught in | Scenarios |
|---|---|---|---|---|
| [`app`](../../reference/components/compute/index.md#app) · [`worker`](../../reference/components/compute/index.md#worker) | How is a service packaged so it runs the same everywhere? | twelve-factor (stateless, disposable), OCI images and layers, digests, multi-stage builds, graceful shutdown, SBOM and signing | [Containers](containers/index.md) | `scale-out` |
| [`app`](../../reference/components/compute/index.md#app) · [`ingress`](../../reference/components/edge/index.md#ingress) · [`healthcheck`](../../reference/components/observability/index.md#healthcheck) | Who keeps N healthy replicas running and routes to them? | control loop, Deployment, Service, Gateway API, startup/readiness/liveness probes, requests and limits, PodDisruptionBudget | [Kubernetes](kubernetes/index.md), [probes](kubernetes/index.md#probes) | `scale-out` |
| [`app`](../../reference/components/compute/index.md#app) · [`worker`](../../reference/components/compute/index.md#worker) · [`scheduler`](../../reference/components/compute/index.md#scheduler) | How does capacity follow the on-sale, and back? | HPA formula, node autoscaling, KEDA on lag, pre-scaling with a cron | [Kubernetes — autoscaling](kubernetes/index.md#autoscaling) | `scale-out`, `flash-sale` |
| [`serverless`](../../reference/components/compute/index.md#serverless) | Pay per request or per hour? | FaaS, cold starts, concurrency limits, break-even point | [this overview](#service-models), [FinOps](finops/index.md) | `serverless-burst` |
| [`sql`](../../reference/components/storage/index.md#sql) · [`cache`](../../reference/components/storage/index.md#cache) · [`kafka`](../../reference/components/messaging/index.md#kafka) · [`objstore`](../../reference/components/storage/index.md#objstore) · [`payment`](../../reference/components/external/index.md#payment) · [`email`](../../reference/components/external/index.md#email) | Who operates each component? | IaaS, CaaS, PaaS, FaaS, DBaaS, SaaS, shared responsibility, platform engineering | [this overview](#service-models) | `flash-sale` |
| [`vpc`](../../reference/components/network/index.md#vpc) · [`metrics`](../../reference/components/observability/index.md#metrics) · [`ingress`](../../reference/components/edge/index.md#ingress) | How does a change reach production safely? | IaC, CI, GitOps with Argo CD, rolling / blue-green / canary, feature flags, expand/contract, DORA | [Delivery](delivery/index.md) | — (delivery happens outside the simulator) |
| [`cdn`](../../reference/components/edge/index.md#cdn) · [`nat`](../../reference/components/network/index.md#nat) · [`logs`](../../reference/components/observability/index.md#logs) | Where does the money go? | pricing models, fixed hourly items, data transfer, unit economics, rightsizing, spot | [FinOps](finops/index.md) | `serverless-burst` |

!!! tip "In the interview"

    Cloud-native details rarely drive a system-design interview, but they show maturity in the wrap-up. Spend one or two sentences on them: "Services are stateless containers on managed Kubernetes with an HPA on CPU and requests per second; the database is managed PostgreSQL Multi-AZ; we deploy through GitOps with canaries gated on the p99 and error-rate SLOs; at peak the cost is dominated by X." If asked "why not serverless?", answer with **connection pools, cold starts at the peak and steady-load cost**, not with taste.

!!! success "Best practices"

    - **Choose the service model per component and write the reason in the design document** — the data tier and the purchase path have different needs (failover vs fine scaling control), so one model for everything is wrong for some of them. In BoxOffice: [component by component](#service-models).
    - **Prove disposability before production: kill a pod under steady load and count the failed requests** — with readiness and a `preStop` pause the target is zero. In BoxOffice: [lab 10 — Measure it](../../hands-on/10/measure/index.md), rolling update and self-healing.
    - **Change production only through a reviewed commit** — images, manifests and infrastructure; then `git log` is the audit trail and `git revert` is the rollback. In BoxOffice: [lab 11 — GitOps](../../hands-on/11/gitops/index.md).
    - **Pre-scale for known peaks; leave autoscaling for the unknown ones** — in lab 10 the eighth pod was ready more than 5 minutes after the HPA asked for it, so `minReplicas` goes up at 09:45, not at 10:00. In BoxOffice: [lab 10 — Autoscaling](../../hands-on/10/autoscaling/index.md).
    - **Review a unit cost next to the SLOs every month** — cost per ticket sold turns the bill into a number the business can judge. In BoxOffice: [FinOps — a cost model](finops/index.md#cost-model).

!!! warning "Common pitfalls"

    - **Lift-and-shift and call it cloud-native**: moving a stateful VM image into a container changes nothing about disposability or elasticity.
    - **Kubernetes for a team of two**: a PaaS gives the same benefits with far less operational load until the service count and scale justify the cluster.
    - **Ignoring the fixed costs**: control planes, load balancers and NAT gateways bill by the hour with zero traffic.
    - **Snowflake environments**: staging built by hand differs from production, and every test result becomes doubtful.
    - **Forgetting that the data is yours**: managed services do not decide who may read your tables or buckets.

---

## Related

- Hands-on: [10. Kubernetes](../../hands-on/10/index.md) (BoxOffice on kind/minikube, probes, HPA under k6 load) and [11. Delivery](../../hands-on/11/index.md) (GitHub Actions, Argo CD, canary, performance budget gate).
- Exercise: [Kubernetes autoscaling](../../exercises/kubernetes-autoscaling/index.md); project milestones [K8s + CI/CD and cost report](../../exercises/project/milestones/index.md).
- Classes: [Compute — serverless and autoscaling](../compute/serverless-autoscaling/index.md), [Network & security](../network-security/index.md), [AI-Assisted Delivery](../ai-delivery/index.md) (AI in the CI/CD pipeline), [Performance engineering](../performance/index.md).
- Case study: [Ticketing (BoxOffice flash sale)](../case-studies/ticketing/index.md).

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - Cloud-native = **immutable artifacts + declarative desired state + elasticity + automation**; the application must be **stateless and disposable** for the platform to help.
    - Service models trade **control for operational effort**; choose per component, not per system.
    - Whatever the model, **data, identity and configuration stay yours**.
    - Platform engineering turns repeated operational work into **self-service golden paths**.

## What breaks next { #what-breaks-next }

The platform now restarts, scales and releases BoxOffice without anyone touching a server: in lab 10 the HPA asked for more `catalog` pods 35 s into a load ramp, and in lab 11 a canary that failed 30% of its requests was rolled back by itself in about a minute. But a shared platform is also a shared attack surface. Every pod can open a connection to every other pod and to the database; a token stolen from one service is accepted by all of them; bots buy the best seats as fast as the HPA adds capacity; and every image the pipeline ships carries hundreds of third-party libraries. Deciding who may talk to whom, checking identity on every call and trusting only what the pipeline built is [class 12 — Network & Security](../network-security/index.md).

---

[^1]: CNCF. [CNCF Cloud Native Definition v1.1](https://github.com/cncf/toc/blob/main/DEFINITION.md){target="_blank"}. Cloud Native Computing Foundation.
[^2]: WIGGINS, A. [The Twelve-Factor App](https://12factor.net/){target="_blank"}. 2011.
[^3]: MELL, P.; GRANCE, T. [The NIST Definition of Cloud Computing](https://csrc.nist.gov/pubs/sp/800/145/final){target="_blank"}. NIST SP 800-145, 2011.
[^4]: AWS. [Shared Responsibility Model](https://aws.amazon.com/compliance/shared-responsibility-model/){target="_blank"}.
[^5]: CNCF TAG App Delivery. [Platforms White Paper](https://tag-app-delivery.cncf.io/whitepapers/platforms/){target="_blank"}. 2023.
