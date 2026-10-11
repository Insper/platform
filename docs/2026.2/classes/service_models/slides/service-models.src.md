---
marp: true
lang: en
title: Service Models
description: Platforms, Microservices, DevOps and APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Platforms, Microservices, DevOps and APIs · Insper</div>

# Service Models

**How much of the stack does the provider manage — and how much do you?**

<!--
Objectives: explain the NIST definition and CapEx vs OpEx; map each model onto the responsibility stack;
compare models; choose a model per component of the store; name what never moves to the provider.
Outline: (1) what makes it cloud; (2) the shared responsibility stack; (3) IaaS, PaaS, SaaS; (4) FaaS, CaaS,
DBaaS and others; (5) the store, component by component; (6) comparison, decision framework, pitfalls.
-->

---

## Who patches the OS?

<div class="q">

You must run the store API in the cloud. Who installs the JDK, patches the OS and scales the servers —
**you or the provider**?

</div>

* It depends on the **service model** you buy.
* The more the provider manages, the **less control** you have…
* …and the **faster** you can move.

<!--
Let the class answer first. The trade-off control × speed is the thread of the whole class.
-->

---

## What makes it "cloud"? (NIST SP 800-145)

| Characteristic | In the store |
|---|---|
| **On-demand self-service** | `aws rds create-db-instance` — no human at the provider |
| **Broad network access** | HTTPS endpoints, `kubectl` over the network |
| **Resource pooling** | your order service shares hosts with other tenants |
| **Rapid elasticity** | Black Friday: 2 → 20 replicas, then back |
| **Measured service** | billed per vCPU-hour, GB-month, request |

<p class="small"><strong>CapEx → OpEx</strong>: no up-front server purchase sized for the expected peak; pay monthly for use — flexible, but not automatically cheaper. Deployment models: public, private, hybrid, community.</p>

---

## The shared responsibility stack

Every model maps onto the same six layers. The line between **provider** and **customer** moves up.

| Layer | On-premises | IaaS | PaaS | SaaS |
|---|---|---|---|---|
| Data | you | you | you | provider |
| Application | you | you | you | provider |
| Middleware | you | you | provider | provider |
| OS | you | you | provider | provider |
| Virtualisation | you | provider | provider | provider |
| Hardware | you | provider | provider | provider |

<p class="small">IaaS, PaaS and SaaS are the three foundational models defined by NIST. Security splits the same way: the provider secures the cloud, you secure what you put <em>in</em> it.</p>

---

## IaaS — Infrastructure as a Service

**You rent raw infrastructure**: virtualised compute, storage and networking.

<div class="cols">
<div>

### You manage

- OS: installation, patching, hardening
- Runtime and middleware
- Application code and data
- Firewall rules, IAM, backups

</div>
<div>

### Choose it for

- Full OS-level control (custom kernel)
- **Lift-and-shift** of on-premises workloads
- HPC with GPU instances
- Compliance over the entire stack

</div>
</div>

<p class="small">AWS EC2, Google Compute Engine, Azure VMs, DigitalOcean Droplets. Lift-and-shift = move the app to VMs as is. Typical flow: provision a <code>t3.medium</code>, SSH in, install the JDK, configure nginx, cron backups, patch the OS.</p>

---

## PaaS — Platform as a Service

**You deploy code; the provider runs it** — OS, runtime, scaling, load balancing, build pipelines.

1. `git push heroku main` (or connect a GitHub repo).
2. **Buildpacks** detect the runtime (Java, Node, Python).
3. The provider builds, containerises and deploys.
4. Attach a **managed Postgres** add-on — no database server to maintain.

<div class="ok">

PaaS favours the **12-factor app**: stateless processes, config in env vars, logs to stdout. The local disk is **ephemeral** — state lives in external managed services.

</div>

<p class="small">Heroku, AWS Elastic Beanstalk, Google App Engine, Azure App Service, Railway, Render.</p>

---

## SaaS — Software as a Service

**You use the software; the provider runs everything.**

- You manage only **users, permissions** and the **data** you put in — plus integrations via APIs/webhooks.
- **Multi-tenancy**: one application instance serves every customer, data isolated by **tenant ID**.
- Economies of scale → the **lowest time-to-value**.
- Choose it when off-the-shelf software already meets the need (CRM, HR, email, monitoring).

<p class="small">Google Workspace, Salesforce, Slack, Notion, GitHub, Datadog, PagerDuty.</p>

---

## FaaS — Function as a Service (serverless)

The extreme end of PaaS: you deploy **functions**, not applications.

| | |
|---|---|
| **Unit of deployment** | a single function |
| **Scaling** | automatic, **to zero** when idle |
| **Billing** | per invocation + duration (ms) |
| **Constraint** | cold starts; max execution time (15 min on Lambda) |
| **Examples** | AWS Lambda, Cloud Functions, Azure Functions, Cloudflare Workers |

<div class="warn">

**Cold start**: the first request to an idle function waits for a sandbox and runtime to start. Great for webhooks, scheduled jobs and bursty work — **not** for long-running or latency-critical APIs.

</div>

---

## CaaS and DBaaS

<div class="cols">
<div>

### CaaS — Container as a Service

Between IaaS and PaaS: you ship a **Docker image**.

- You control everything **inside** the container.
- Provider: scheduling, networking, scaling, node health.
- AWS ECS / Fargate, Google Cloud Run, Azure Container Instances.

</div>
<div>

### DBaaS — Database as a Service

A managed database behind a standard client.

- You: schema design, query tuning, access control.
- Provider: replication, backups, OS patching, failover.
- AWS RDS, Aurora, Cloud SQL, Azure Database, PlanetScale, Neon.

</div>
</div>

<p class="small">Managed Kubernetes (EKS, GKE, AKS) is CaaS too. Cloud Run and Azure Container Apps even <strong>scale to zero</strong>: "serverless" is not only functions.</p>

---

## Other "as a Service" slices

| Model | Abbreviation | Examples |
|---|---|---|
| Storage as a Service | STaaS | AWS S3, Google Cloud Storage, Backblaze B2 |
| AI / ML as a Service | AIaaS | AWS Bedrock, Google Vertex AI, Azure AI |
| Monitoring as a Service | — | Datadog, New Relic, Grafana Cloud |
| Security as a Service | SECaaS | Cloudflare, AWS Shield, Snyk |
| Communication as a Service | CPaaS | Twilio, SendGrid, AWS SES |

<div class="ok">

Each specialised model carves out a **narrower slice of the stack** and hands it to the provider.

</div>

---

## The store, component by component

| Component | Do it yourself | Managed option |
|---|---|---|
| gateway, account, order | Compose on an EC2 VM (IaaS) | EKS / ECS Fargate (CaaS) |
| Postgres | Postgres on EC2 (IaaS) | RDS (DBaaS) |
| Redis · Kafka | containers on the VM | ElastiCache · Amazon MSK |
| order notification | always-on consumer | Lambda on the Kafka topic (FaaS) |
| CI/CD · monitoring | Jenkins · Prometheus + Grafana | GitHub Actions · Grafana Cloud (SaaS) |

<div class="ok">

Real systems **mix** models: run the decision **per component**. The course project puts the services on EKS.

</div>

---

## Full comparison

| | On-prem | IaaS | PaaS | CaaS | FaaS | SaaS |
|---|---|---|---|---|---|---|
| **Control** | maximum | high | medium | medium | low | minimal |
| **You own** | everything | OS and above | app + data | container + data | code + data | data + users |
| **Time to market** | slow | slow | fast | fast | very fast | instant |
| **Scaling** | manual | manual / scripted | automatic | auto (some to zero) | to zero | automatic |
| **Cost model** | CapEx | per VM-hour | per usage | per container-hour | per invocation | per user/seat |
| **Portability** | full | high | medium | high (image) | low (vendor API) | low (data export) |

<!--
Read the table row by row: control and portability fall as time to market improves.
FaaS is the outlier on portability: the code is written against a vendor API.
-->

---

## Decision framework

1. Need **full OS control** or lift-and-shift? → **IaaS** (EC2, GCE, Azure VM)
2. Deploying **containers**?
   - want to manage Kubernetes yourself → **CaaS on Kubernetes** (EKS, GKE, AKS)
   - otherwise → **managed CaaS** (Cloud Run, ECS Fargate)
3. **Event-driven / sporadic** workload? → **FaaS** (Lambda, Cloud Functions)
4. Building a **custom application**? → **PaaS** (Heroku, App Engine)
5. None of the above → **SaaS**: use an existing product.

---

## Trade-offs and pitfalls

> The more the provider manages, the less control you have — and the faster you can move.

- **Lock-in**: FaaS triggers and SaaS data are the hardest to move; prefer open interfaces (containers, Postgres, K8s API).
- **Not always cheaper**: managed services charge a premium per unit — worth it until steady, large scale.
- **State on PaaS/FaaS instances** vanishes on restart or scale-in.
- **FaaS for a hot, latency-critical API**: cold starts and per-call pricing hurt.

<div class="warn">

"Managed" never means "no responsibility": a public S3 bucket is **your** leak — security *in* the cloud is always yours.

</div>

---

## Takeaways

1. Cloud = the five NIST characteristics; it turns **CapEx into OpEx**.
2. A service model defines **who manages which layer** of the six-layer stack.
3. **IaaS** rents infrastructure; **PaaS** runs your (12-factor) code; **SaaS** is software you only configure.
4. **CaaS** ships images, **FaaS** ships functions (scale to zero, cold starts), **DBaaS** runs the database.
5. More managed = **faster** and **less control / portability**.
6. Choose **per component**: the store mixes CaaS, DBaaS, FaaS and SaaS.
7. Data, identities and access rules are **always yours**.
