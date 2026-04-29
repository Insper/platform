
Cloud service models define **how much of the stack the cloud provider manages** versus how much the customer manages. The more the provider manages, the less control the customer has — and the faster they can move.

The three foundational models defined by NIST[^1] are **IaaS**, **PaaS**, and **SaaS**. Beyond them, several specialised models have emerged — **FaaS**, **CaaS**, **DBaaS**, and others — each carving out a narrower slice of the stack.

---

## The shared responsibility stack

Every cloud service model can be mapped to the same six-layer stack. The dividing line between what the provider manages (green) and what the customer manages (orange) shifts as you move up the model hierarchy:

``` mermaid
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
- Lift-and-shift of existing on-premises workloads
- High-performance computing with specialised hardware (GPU instances)
- Strict compliance that requires controlling the entire stack

!!! example "Typical IaaS workflow"
    1. Provision a VM (e.g., `t3.medium` on EC2)
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

**Architectural implication:** PaaS favours the **12-factor app** pattern — stateless processes, config via environment variables, logs to stdout. Persistent state must live in external managed services (database, object storage).

**When to choose PaaS:**
- Building a new application without infrastructure expertise on the team
- Rapid prototyping and MVPs
- API backends and microservices that don't need OS control
- Teams that want to ship features, not manage servers

!!! example "Typical PaaS workflow"
    1. `git push heroku main` (or connect a GitHub repo)
    2. Provider detects the runtime (Java, Node, Python) via buildpacks
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

**Multi-tenancy:** A single application instance serves all customers, with data isolated by tenant ID. This enables economies of scale — and is why SaaS has the lowest time-to-value.

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
| **Constraint** | Cold starts; max execution time (e.g., 15 min on Lambda) |
| **Examples** | AWS Lambda, Google Cloud Functions, Azure Functions, Cloudflare Workers |

**Best for:** event-driven workloads, webhooks, scheduled jobs, sporadic or bursty tasks. Not suited for long-running or consistently low-latency applications.

### CaaS — Container as a Service

Between IaaS and PaaS. You provide **Docker images**; the provider manages the container runtime, orchestration, networking, and scaling. You retain full control of the runtime inside the container.

| | |
|---|---|
| **Unit of deployment** | Docker image |
| **What you control** | Everything inside the container |
| **What provider manages** | Scheduling, networking, scaling, node health |
| **Examples** | AWS ECS / Fargate, Google Cloud Run, Azure Container Instances |

**Best for:** microservices teams already using Docker who want managed orchestration without operating Kubernetes themselves.

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

## Full comparison

| | On-Premises | IaaS | PaaS | CaaS | FaaS | SaaS |
|---|---|---|---|---|---|---|
| **Control** | Maximum | High | Medium | Medium | Low | Minimal |
| **Customer responsibility** | Everything | OS and above | App and data | Container and data | Code only | Data only |
| **Time to market** | Slow | Slow | Fast | Fast | Very fast | Instant |
| **Scaling** | Manual | Manual / scripted | Automatic | Automatic | Automatic to zero | Automatic |
| **Cost model** | CapEx | Per VM-hour | Per usage | Per container-hour | Per invocation | Per user/seat |
| **Portability** | Full | High | Medium | High (image) | Low (vendor API) | None |

---

## Decision framework

``` mermaid
flowchart TD
  start([What do you need?]) --> q1{Need full OS control\nor lift-and-shift?}
  q1 -->|Yes| iaas[IaaS\nEC2, GCE, Azure VM]
  q1 -->|No| q2{Deploying containers?}
  q2 -->|Yes| q3{Want to manage\nKubernetes yourself?}
  q3 -->|Yes| k8s[CaaS on Kubernetes\nEKS, GKE, AKS]
  q3 -->|No| caas[CaaS managed\nCloud Run, ECS Fargate]
  q2 -->|No| q4{Event-driven /\nsporadic workload?}
  q4 -->|Yes| faas[FaaS\nLambda, Cloud Functions]
  q4 -->|No| q5{Building a\ncustom application?}
  q5 -->|Yes| paas[PaaS\nHeroku, App Engine]
  q5 -->|No| saas[SaaS\nUse an existing product]
```

---

:fontawesome-brands-youtube:{ .youtube } [IaaS vs PaaS vs SaaS](https://www.youtube.com/watch?v=SBQoyZXrpcY){:target="_blank"} — practical overview of the three foundational models.


[^1]: MELL, P.; GRANCE, T. [The NIST Definition of Cloud Computing](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-145.pdf){:target="_blank"}. NIST Special Publication 800-145, 2011.
[^2]: [AWS Shared Responsibility Model](https://aws.amazon.com/compliance/shared-responsibility-model/){:target="_blank"}
[^3]: [Azure Shared Responsibility](https://learn.microsoft.com/en-us/azure/security/fundamentals/shared-responsibility){:target="_blank"}
[^4]: [Cloud Native Computing Foundation (CNCF)](https://www.cncf.io/){:target="_blank"}
