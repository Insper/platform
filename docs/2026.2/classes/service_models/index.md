
Your team has built the store: a **gateway**, the **account**, **auth**, **product** and **order** services, a **Postgres** database, a **Redis** cache and **Kafka**. It runs fine on a laptop with Docker Compose. Now it has to run somewhere real. You could buy servers, rent virtual machines, push the code to a platform that runs it for you, or skip some components entirely and pay for a product that already does the job. Each option draws a different line between **what your team operates** and **what someone else operates**.

Cloud service models define **how much of the stack the cloud provider manages** versus how much the customer manages. The more the provider manages, the less control the customer has — and the faster they can move.

The three foundational models defined by NIST[^1] are **IaaS**, **PaaS**, and **SaaS**. Beyond them, several specialised models have emerged — **FaaS**, **CaaS**, **DBaaS**, and others — each carving out a narrower slice of the stack.

!!! abstract "Learning objectives"

    By the end of this class you should be able to:

    - **Explain** what makes a service "cloud" using the NIST definition (five essential characteristics) and the difference between CapEx and OpEx.
    - **Map** IaaS, PaaS, SaaS, CaaS, FaaS and DBaaS onto the shared responsibility stack, stating who installs, patches, scales and secures each layer.
    - **Compare** the models by control, time to market, scaling, cost model and portability.
    - **Choose** a service model for each component of a system (such as the store) and justify the trade-off.
    - **Identify** the responsibilities that never move to the provider: your data, your identities and access rules, and your configuration.

## Slides

<div class="slides-embed">
  <iframe src="slides/service-models.html" title="Slides: service models" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/service-models.html){:target="_blank"}

---

## What makes it "cloud"?

Renting a server in a datacentre by signing a three-year contract is not cloud computing, even if the server is far away. NIST SP 800-145[^1] defines cloud computing by **five essential characteristics**. A service must have all of them:

| Characteristic | What it means | In the store |
|---|---|---|
| **On-demand self-service** | You provision resources yourself, through a console or API, without talking to a human at the provider | `aws rds create-db-instance` creates the Postgres database in minutes |
| **Broad network access** | Resources are reachable over the network with standard protocols | The gateway is an HTTPS endpoint; `kubectl` talks to the cluster API over HTTPS |
| **Resource pooling** | The provider serves many customers (**tenants**) from shared physical hardware | Your order service may run on the same physical host as another company's workload, isolated by the hypervisor |
| **Rapid elasticity** | Capacity grows and shrinks quickly, often automatically | Black Friday: scale the order service from 2 to 20 replicas, then back |
| **Measured service** | Usage is metered and billed per unit (hour, GB, request) | The bill shows vCPU-hours, GB-months of storage, GB of data transfer |

NIST also defines **deployment models**, which say *who shares* the infrastructure — not how much of it you manage:

- **Public cloud** — shared by any paying customer (AWS, Google Cloud, Azure).
- **Private cloud** — the same self-service model run for a single organisation (e.g., OpenStack in the company's own datacentre).
- **Hybrid cloud** — a combination, e.g., customer data stays on-premises while the web tier runs in a public cloud.
- **Community cloud** — shared by organisations with common requirements (e.g., government agencies).

**CapEx vs OpEx.** Buying servers is **capital expenditure (CapEx)**: a large payment up front for an asset you own and depreciate over years, sized for the peak you *expect*. The cloud turns infrastructure into **operational expenditure (OpEx)**: you pay monthly for what you *use*. OpEx removes the up-front bet, but it is not automatically cheaper — a workload that runs at full load 24/7 for years can cost more in the cloud than on owned hardware.

---

## The shared responsibility stack

Every cloud service model can be mapped to the same six-layer stack:

| Layer | What it is |
|---|---|
| **Hardware** | Physical servers, disks, network switches, power and cooling of the datacentre |
| **Virtualisation** | The hypervisor that slices a physical host into virtual machines |
| **OS** | The guest operating system of each virtual machine (Linux, Windows) |
| **Middleware** | Runtime and supporting software: JDK, web server, application server, message broker |
| **Application** | Your code: the gateway, the account service, the order service |
| **Data** | What the application stores: users, orders, products |

The dividing line between what the provider manages (green) and what the customer manages (orange) shifts as you move up the model hierarchy:

``` mermaid-sim
graph TD
  subgraph On-Premises
    direction TB
    A1[Hardware] --> A2[Virtualisation]
    A2 --> A3[OS]
    A3 --> A4[Middleware]
    A4 --> A5[Application]
    A5 --> A6[Data]
    style A1 fill:#ff9999,stroke:#333
    style A2 fill:#ff9999,stroke:#333
    style A3 fill:#ff9999,stroke:#333
    style A4 fill:#ff9999,stroke:#333
    style A5 fill:#ff9999,stroke:#333
    style A6 fill:#ff9999,stroke:#333
  end
  subgraph IaaS
    direction TB
    B1[Hardware] --> B2[Virtualisation]
    B2 --> B3[OS]
    B3 --> B4[Middleware]
    B4 --> B5[Application]
    B5 --> B6[Data]
    style B1 fill:#a8e6cf,stroke:#333
    style B2 fill:#a8e6cf,stroke:#333
    style B3 fill:#ffd3b6,stroke:#333
    style B4 fill:#ffd3b6,stroke:#333
    style B5 fill:#ffd3b6,stroke:#333
    style B6 fill:#ffd3b6,stroke:#333
  end
  subgraph PaaS
    direction TB
    C1[Hardware] --> C2[Virtualisation]
    C2 --> C3[OS]
    C3 --> C4[Middleware]
    C4 --> C5[Application]
    C5 --> C6[Data]
    style C1 fill:#a8e6cf,stroke:#333
    style C2 fill:#a8e6cf,stroke:#333
    style C3 fill:#a8e6cf,stroke:#333
    style C4 fill:#a8e6cf,stroke:#333
    style C5 fill:#ffd3b6,stroke:#333
    style C6 fill:#ffd3b6,stroke:#333
  end
  subgraph SaaS
    direction TB
    D1[Hardware] --> D2[Virtualisation]
    D2 --> D3[OS]
    D3 --> D4[Middleware]
    D4 --> D5[Application]
    D5 --> D6[Data]
    style D1 fill:#a8e6cf,stroke:#333
    style D2 fill:#a8e6cf,stroke:#333
    style D3 fill:#a8e6cf,stroke:#333
    style D4 fill:#a8e6cf,stroke:#333
    style D5 fill:#a8e6cf,stroke:#333
    style D6 fill:#a8e6cf,stroke:#333
  end
```

:material-square:{ style="color:#a8e6cf" } Provider manages &nbsp;&nbsp; :material-square:{ style="color:#ffd3b6" } Customer manages &nbsp;&nbsp; :material-square:{ style="color:#ff9999" } Customer manages (on-premises: everything)

The same split applies to **security**. AWS summarises it as *security **of** the cloud* (the provider: physical datacentres, hypervisor, managed-service software) versus *security **in** the cloud* (the customer: data, identity and access management, network rules, encryption settings, the OS in IaaS)[^2]. Microsoft draws the same table for Azure[^3]. Note that even in SaaS the data square is about *operating* the storage: deciding **who may read the data** is always the customer's job.

!!! tip "An analogy: pizza as a service"
    - **On-premises** — make pizza at home: you buy the oven, the ingredients, and you cook.
    - **IaaS** — rent a kitchen: oven and gas are provided; you bring ingredients and cook.
    - **PaaS** — order delivery: someone cooks; you provide the table, the drinks and the guests.
    - **SaaS** — eat at a restaurant: you just choose from the menu (and still decide who sits at your table).

---

## IaaS — Infrastructure as a Service

**You rent raw infrastructure.** The provider supplies virtualised compute, storage, and networking. You install the OS, runtime, middleware, and everything above.

| Provider manages | Customer manages |
|---|---|
| Physical datacentre, power, cooling | OS: installation, patching, hardening |
| Hypervisor and host OS | Runtime and middleware |
| Physical network | Application code and data |
| — | Firewall rules, IAM, backups |

**Examples:** AWS EC2, Google Compute Engine, Azure Virtual Machines, DigitalOcean Droplets.

**When to choose IaaS:**

- You need full OS-level control (custom kernel, specific OS version)
- **Lift-and-shift** of existing on-premises workloads — moving an application to cloud VMs *as is*, without redesigning it
- High-performance computing with specialised hardware (GPU instances)
- Strict compliance that requires controlling the entire stack

!!! example "Typical IaaS workflow"
    1. Provision a VM (e.g., `t3.medium` on EC2: 2 vCPU, 4 GiB)
    2. SSH in, install JDK and your application runtime
    3. Configure nginx as reverse proxy
    4. Set up cron jobs for backups
    5. Handle OS patches manually or via automation (Ansible, SSM)

---

## PaaS — Platform as a Service

**You deploy code; the provider runs it.** The provider manages the OS, runtime, middleware, scaling, and networking. You write the application and configure it via environment variables.

| Provider manages | Customer manages |
|---|---|
| Hardware through runtime | Application code |
| OS patching and updates | Configuration (env vars, scaling rules) |
| Load balancing and auto-scaling | Application data |
| Build pipelines and deployments | — |

**Examples:** Heroku, AWS Elastic Beanstalk, Google App Engine, Azure App Service, Railway, Render.

**Architectural implication:** PaaS favours the **12-factor app**[^4] pattern — stateless processes, config via environment variables, logs to stdout. The platform may restart or move your process at any time and its local filesystem is **ephemeral** (wiped on every restart), so persistent state must live in external managed services (database, object storage).

**When to choose PaaS:**

- Building a new application without infrastructure expertise on the team
- Rapid prototyping and MVPs
- API backends and microservices that don't need OS control
- Teams that want to ship features, not manage servers

!!! example "Typical PaaS workflow"
    1. `git push heroku main` (or connect a GitHub repo)
    2. Provider detects the runtime (Java, Node, Python) via **buildpacks** — scripts that recognise the project (e.g., a `pom.xml`) and know how to build and run it
    3. Provider builds, containerises, and deploys automatically
    4. Attach a managed Postgres add-on — no database server to maintain

---

## SaaS — Software as a Service

**You use the software; the provider runs everything.** The customer manages only users, permissions, and the data they put in. There is no infrastructure or application to operate.

| Provider manages | Customer manages |
|---|---|
| Hardware through application | User accounts and permissions |
| Security, compliance, updates | Data entered into the system |
| Multi-tenancy and isolation | Integrations (via APIs/webhooks) |

**Examples:** Google Workspace, Salesforce, Slack, Notion, GitHub, Datadog, PagerDuty.

**Multi-tenancy:** A single application instance serves all customers (**tenants**), with data isolated by tenant ID. This enables economies of scale — and is why SaaS has the lowest time-to-value.

**When to choose SaaS:**

- Off-the-shelf software already meets the need (CRM, HR, email, monitoring)
- The team should not be building or operating the tool itself
- Speed of adoption matters more than customisation depth

---

## Beyond the Big Three

The foundational models have spawned specialised variants targeting a narrower part of the stack:

### FaaS — Function as a Service (Serverless)

The extreme end of PaaS. You deploy individual **functions** rather than applications. The provider manages everything — including scaling to zero when idle — billing only for the milliseconds the function runs.

| | |
|---|---|
| **Unit of deployment** | A single function |
| **Scaling** | Automatic, to zero when idle |
| **Billing** | Per invocation + duration (ms) |
| **Constraint** | Cold starts; max execution time (15 min on AWS Lambda[^5]) |
| **Examples** | AWS Lambda, Google Cloud Functions, Azure Functions, Cloudflare Workers |

A **cold start** is the delay of the first request that reaches a function with no warm instance: the platform must allocate a sandbox, load the code and initialise the runtime. For a Spring Boot application this can take seconds. Providers offer mitigations — for example, Lambda *provisioned concurrency* keeps instances warm — but you pay for them even when idle, which erodes the main FaaS advantage.

**Best for:** event-driven workloads, webhooks, scheduled jobs, sporadic or bursty tasks. Not suited for long-running or consistently low-latency applications.

### CaaS — Container as a Service

Between IaaS and PaaS. You provide **Docker images**; the provider manages the container runtime, orchestration, networking, and scaling. You retain full control of the runtime inside the container.

| | |
|---|---|
| **Unit of deployment** | Docker image |
| **What you control** | Everything inside the container |
| **What provider manages** | Scheduling, networking, scaling, node health |
| **Examples** | AWS ECS / Fargate, Google Cloud Run, Azure Container Instances, Azure Container Apps |

**Best for:** microservices teams already using Docker who want managed orchestration without operating Kubernetes themselves.

**Managed Kubernetes** (Amazon EKS, Google GKE, Azure AKS) is also usually classified as CaaS: the provider runs the Kubernetes control plane (API server, scheduler, etcd), and you deploy containers through the standard Kubernetes API maintained by the CNCF[^6]. How much of the *worker nodes* you manage depends on the mode — classic node groups leave node sizing and upgrades to you, while modes like GKE Autopilot and EKS Auto Mode hand node management to the provider as well.

!!! info "Serverless containers blur the line"
    Some CaaS offerings — Google Cloud Run, Azure Container Apps — also **scale to zero** and bill per request-time, just like FaaS, but run any container image. "Serverless" describes the *operating model* (no servers to manage, pay per use), not only functions.

### DBaaS — Database as a Service

A managed database where the provider handles provisioning, backups, replication, patching, and failover. You connect with a standard client and run queries.

| | |
|---|---|
| **You manage** | Schema design, query tuning, access control |
| **Provider manages** | Replication, backups, OS patching, failover |
| **Examples** | AWS RDS, Amazon Aurora, Google Cloud SQL, Azure Database, PlanetScale, Neon |

### Other specialised models

| Model | Abbreviation | Examples |
|---|---|---|
| Storage as a Service | STaaS | AWS S3, Google Cloud Storage, Backblaze B2 |
| AI / ML as a Service | AIaaS | AWS Bedrock, Google Vertex AI, Azure AI |
| Monitoring as a Service | — | Datadog, New Relic, Grafana Cloud |
| Security as a Service | SECaaS | Cloudflare, AWS Shield, Snyk |
| Communication as a Service | CPaaS | Twilio, SendGrid, AWS SES |

---

## Example: the store, component by component

Real systems **mix** service models: each component goes where its trade-off is best. This is one reasonable way to run the store on AWS — the same shape as the course project, which runs the services on EKS:

``` mermaid-sim
flowchart LR
  client([Client]) --> gw["gateway<br/>CaaS: EKS"]
  gw --> acc["account<br/>CaaS: EKS"]
  gw --> ord["order<br/>CaaS: EKS"]
  acc --> db[("Postgres<br/>DBaaS: RDS")]
  ord --> db
  ord --> cache[("Redis<br/>DBaaS: ElastiCache")]
  ord --> kafka["Kafka<br/>managed: Amazon MSK"]
  kafka --> fn["notification<br/>FaaS: Lambda"]
  fn --> mail["e-mail<br/>CPaaS: AWS SES"]
```

| Component | Do it yourself | Managed option | What changes for the team |
|---|---|---|---|
| gateway, account, order | Docker Compose on an EC2 VM (IaaS) | EKS or ECS Fargate (CaaS) | No more SSH and OS patching; you write manifests or task definitions instead |
| Postgres | Postgres installed on EC2 (IaaS) | RDS (DBaaS) | Backups, replication and failover become configuration options |
| Redis | Redis container on the VM | ElastiCache (DBaaS) | Cache survives a VM reboot; you pay per node |
| Kafka | Kafka brokers on VMs | Amazon MSK | Broker patching and replacement move to AWS |
| Order notification | A consumer always running in the cluster | Lambda triggered by the Kafka topic (FaaS) | Pay per message; accept cold starts on an async path |
| CI/CD | Jenkins in a container ([Hands-on 4](../../hands-on/4/index.md)) | GitHub Actions (SaaS) | No Jenkins server to upgrade |
| Monitoring | Prometheus + Grafana ([Hands-on 6](../../hands-on/6/index.md)) | Grafana Cloud or Datadog (SaaS) | No storage to size for metrics; per-host or per-metric pricing |

Notice that moving a component *up* (from IaaS to a managed model) never removes the **data and access** column: you still decide who can connect to RDS, which security group reaches the gateway, and what is logged.

---

## Full comparison

| | On-Premises | IaaS | PaaS | CaaS | FaaS | SaaS |
|---|---|---|---|---|---|---|
| **Control** | Maximum | High | Medium | Medium | Low | Minimal |
| **Customer responsibility** | Everything | OS and above | App and data | Container and data | Code and data | Data and users |
| **Time to market** | Slow | Slow | Fast | Fast | Very fast | Instant |
| **Scaling** | Manual | Manual / scripted | Automatic | Automatic (some to zero) | Automatic to zero | Automatic |
| **Cost model** | CapEx | Per VM-hour | Per usage | Per container-hour | Per invocation | Per user/seat |
| **Portability** | Full | High | Medium | High (image) | Low (vendor API) | Low (data export only) |

---

## Decision framework

``` mermaid-sim
flowchart TD
  start([What do you need?]) --> q1{"Need full OS control<br/>or lift-and-shift?"}
  q1 -->|Yes| iaas["IaaS<br/>EC2, GCE, Azure VM"]
  q1 -->|No| q2{Deploying containers?}
  q2 -->|Yes| q3{"Want to manage<br/>Kubernetes yourself?"}
  q3 -->|Yes| k8s["CaaS on Kubernetes<br/>EKS, GKE, AKS"]
  q3 -->|No| caas["CaaS managed<br/>Cloud Run, ECS Fargate"]
  q2 -->|No| q4{"Event-driven /<br/>sporadic workload?"}
  q4 -->|Yes| faas["FaaS<br/>Lambda, Cloud Functions"]
  q4 -->|No| q5{"Building a<br/>custom application?"}
  q5 -->|Yes| paas["PaaS<br/>Heroku, App Engine"]
  q5 -->|No| saas["SaaS<br/>Use an existing product"]
```

Run the framework **per component**, not once per system: in the example above, the services land on CaaS, the order notification on FaaS, and monitoring on SaaS.

---

## Trade-offs and pitfalls

!!! warning "Common mistakes"
    - **"Managed" read as "not my problem".** Most cloud data leaks come from customer-side configuration — a public S3 bucket, a database open to `0.0.0.0/0`, a leaked access key — not from the provider. That layer is always yours[^2].
    - **Ignoring lock-in.** The higher the model, the more your code and data depend on one vendor's API (Lambda triggers, DynamoDB queries, a SaaS data format). Prefer open interfaces where they cost little: containers, Postgres, the Kubernetes API, OpenTelemetry.
    - **Assuming the higher model is always cheaper.** Managed services charge a premium per unit. At small scale it is far cheaper than an engineer's time; at large, steady scale a team may save money by running the component itself.
    - **Storing state on a PaaS or FaaS instance.** Local files and in-memory sessions disappear on restart or scale-in. Keep state in a database, cache or object store.
    - **Using FaaS for a latency-critical, high-traffic API.** Cold starts and per-invocation pricing make an always-on container cheaper and more predictable at sustained load.

---

## Key takeaways

- A service is "cloud" when it has the five NIST characteristics: on-demand self-service, broad network access, resource pooling, rapid elasticity and measured service — and it turns CapEx into OpEx.
- A service model defines **who manages which layer** of the six-layer stack; IaaS, PaaS and SaaS move the line up, step by step.
- CaaS (images), FaaS (functions, scale to zero, cold starts) and DBaaS (managed databases) carve out narrower slices of the stack.
- More managed means **faster and less operations**, but **less control and portability**.
- Real systems mix models: choose **per component** — the store's services on CaaS, Postgres on DBaaS, monitoring on SaaS.
- Your data, identities, access rules and configuration are **always** your responsibility.

## Connections

- [Containerization](../containerization/index.md) — the Docker image that CaaS platforms run.
- [Microservices](../microservices/index.md) — why the store is split into independently deployable services.
- [Cloud Deployment Roadmap](../deployment/index.md) — the next class: concrete platforms (Railway, Fly.io, Lightsail, ECS, EKS) and their costs.
- [Hands-on 5 — Orchestration](../../hands-on/5/index.md) — Kubernetes locally with Minikube, the API that EKS manages for you.
- Project: [AWS](../../exercises/project/aws/index.md), [EKS](../../exercises/project/eks/index.md) and [Costs & PaaS](../../exercises/project/costs/index.md).

---

:fontawesome-brands-youtube:{ .youtube } [IaaS vs PaaS vs SaaS](https://www.youtube.com/watch?v=SBQoyZXrpcY){:target="_blank"} — practical overview of the three foundational models.


[^1]: MELL, P.; GRANCE, T. [The NIST Definition of Cloud Computing](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-145.pdf){:target="_blank"}. NIST Special Publication 800-145, 2011.
[^2]: [AWS Shared Responsibility Model](https://aws.amazon.com/compliance/shared-responsibility-model/){:target="_blank"}
[^3]: [Azure Shared Responsibility](https://learn.microsoft.com/en-us/azure/security/fundamentals/shared-responsibility){:target="_blank"}
[^4]: WIGGINS, A. [The Twelve-Factor App](https://12factor.net/){:target="_blank"}, 2011.
[^5]: [AWS Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html){:target="_blank"} — function timeout up to 900 seconds (15 minutes).
[^6]: [Cloud Native Computing Foundation (CNCF)](https://www.cncf.io/){:target="_blank"}
