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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">Platforms, Microservices, DevOps and APIs · Insper</div>

# Service Models

**Who operates each layer of the stack?**

<!--
Objectives: explain what makes a service "cloud" and CapEx vs OpEx; place IaaS, CaaS, PaaS, FaaS and SaaS on the
responsibility stack, saying who acts when something breaks; compare the models; choose a model per component;
name what never moves to the provider.
Outline: (1) what makes it cloud; (2) the responsibility stack; (3) climbing the stack, one model at a time;
(4) managed building blocks; (5) comparing the models; (6) how to choose, the store component by component; (7) mistakes.
-->

---

## The store has to run somewhere real

The gateway, auth, account, product, order and exchange, plus Postgres, Redis and Kafka, run fine on a laptop with Docker Compose. Four kinds of options:

1. **Buy** servers.
2. **Rent** virtual machines.
3. **Hand** your code or container to a platform that runs it.
4. **Skip** the component and pay for a product that already does the job.

<div class="ok">

**The one idea:** every service model answers the same question — **who operates each layer of the stack?** The more you hand over, the faster you move and the less you control.

</div>

<!--
Each option draws a different line between what your team operates and what someone else operates.
That line is what a cloud service model defines.
-->

---

## What makes it "cloud"?

NIST SP 800-145: **five essential characteristics**, and a service must have **all** of them.

| Characteristic | In the store |
|---|---|
| **On-demand self-service** | `aws rds create-db-instance` creates Postgres in minutes |
| **Broad network access** | the gateway is an HTTPS endpoint |
| **Resource pooling** | order may share a physical host with another company's workload, isolated |
| **Rapid elasticity** | Black Friday: order goes from 2 to 20 replicas, then back |
| **Measured service** | the bill shows vCPU-hours, GB stored, GB transferred |

<p class="small">Renting a server in a datacentre on a three-year contract is not cloud, even if the server is far away.</p>

---

## CapEx vs OpEx

<div class="cols">
<div>

### CapEx (capital expenditure) — buy servers

- A large payment **up front**.
- Hardware sized for the peak you **expect**.

</div>
<div>

### OpEx (operational expenditure) — the cloud

- Pay **monthly** for what you **use**.
- Removes the up-front bet…
- …but is **not automatically cheaper**: full load 24/7 for years can cost more than owned hardware.

</div>
</div>

<div class="q">

**Service model ≠ deployment model.** Deployment models say *who shares* the infrastructure: public, private, hybrid, community. This class is about the other axis: *how much of it you operate*.

</div>

---

## The responsibility stack

Every application in production needs the same six layers. Read them **from the bottom up**:

| Layer | What it is | In the store |
|---|---|---|
| **Data and access** | what the application stores and who may read it | orders, accounts, DB users, API keys |
| **Application** | your code | the gateway and the services |
| **Middleware** | what your code needs to run | JDK, web server, Redis |
| **OS** | the operating system of each machine | Linux |
| **Virtualisation** | hypervisor slicing a host into VMs | KVM, Xen |
| **Hardware** | servers, disks, network, power, cooling | the datacentre |

---

## The central picture

From left to right, the provider takes over more of the stack: <span class="chip orange">you</span> operate it · <span class="chip accent">provider</span> operates it

<div class="matrix" style="--n: 6">
<div class="head"></div>
<div class="head">On-premises</div>
<div class="head">IaaS</div>
<div class="head">CaaS</div>
<div class="head">PaaS</div>
<div class="head">FaaS</div>
<div class="head">SaaS</div>
<div class="row">Data and access</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="row">Application</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box accent">provider</div>
<div class="row">Middleware</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="row">OS</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="row">Virtualisation</div>
<div class="box orange">you</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="row">Hardware</div>
<div class="box orange">you</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
</div>

<!--
This is the picture to remember. Ask the class to read it column by column before the next slide.
-->

---

## Three things to notice

- **The top row never changes.** The provider may store your data, but only you decide who may read it: security *of* the cloud (provider) vs security *in* the cloud (customer).
- **CaaS and PaaS differ by one layer: the middleware.** On CaaS the JDK is inside the image you build; on PaaS the platform supplies it.
- **PaaS and FaaS have the same colours.** What changes is the size of what you deploy: an application or a single function.

<div class="ok">

**Pizza as a service.** On-premises: you cook at home · IaaS: you rent a kitchen · PaaS: you order delivery · SaaS: you eat at a restaurant — and you still decide who sits at your table.

</div>

---

## Who acts when something happens?

Find the event and read across the row: <span class="chip orange">you</span> operate it · <span class="chip accent">provider</span> operates it

<div class="matrix" style="--n: 6">
<div class="head"></div>
<div class="head">On-premises</div>
<div class="head">IaaS</div>
<div class="head">CaaS</div>
<div class="head">PaaS</div>
<div class="head">FaaS</div>
<div class="head">SaaS</div>
<div class="row">A disk fails</div>
<div class="box orange">you</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="row">A flaw in the Linux kernel</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="row">A flaw in the JDK</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="row">Black Friday: traffic ×10</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="box accent">provider</div>
<div class="row">A bug in the application</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box accent">provider</div>
<div class="row">An access key leaks</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
<div class="box orange">you</div>
</div>

<p class="small">The usual setup of each model. On CaaS and PaaS the platform scales, but you still set the limits; on managed Kubernetes with classic node groups the OS of the nodes is still partly yours.</p>

---

## Check your understanding

<div class="q">

The store runs on a **PaaS** and a flaw is published in the **Linux kernel**. What does your team do?

</div>

* Nothing, as far as the OS is concerned: the provider patches it (the OS row).
* Now the store runs on **CaaS** and the flaw is in the **JDK**…
* …your team acts: the JDK is inside your image. Update the base image, rebuild, deploy again.

---

## Climbing the stack, one model at a time

NIST defines three foundational models: **IaaS**, **PaaS** and **SaaS**. The market later added **CaaS** and **FaaS** between them.

Each model gets the same parts, so you can compare them:

- what **you hand over** and what **you keep**;
- the **order service** (or the store) on that model;
- **choose it when** / **avoid it when**.

<div class="ok">

What you **deploy** tells the models apart: a VM (IaaS), an image (CaaS), code (PaaS), a function (FaaS) or nothing (SaaS).

</div>

---

<!-- _class: tight -->

## IaaS: Infrastructure as a Service

**You rent a machine and do the rest.** You hand over datacentre, hardware and hypervisor; you keep the OS (patches, hardening), runtime, code, data, firewall rules and backups.

```bash
aws ec2 run-instances --image-id <ubuntu-ami> --instance-type t3.medium --key-name <key>
ssh ubuntu@<public-ip>
sudo apt update && sudo apt install -y openjdk-21-jre-headless nginx
java -jar order.jar
```

That is just the first day: configure nginx, restart the service if it crashes, patch the OS, schedule backups.

- **Choose it when** you need control of the OS (kernel, drivers, GPUs) or for **lift-and-shift** of an existing application.
- **Avoid it when** nobody wants to be on call for servers: every layer above the hypervisor is yours.

<p class="small">AWS EC2, Google Compute Engine, Azure Virtual Machines, DigitalOcean Droplets.</p>

---

<!-- _class: tight -->

## CaaS: Container as a Service

**You hand over a container image; the platform runs it.** The provider handles scheduling, networking, scaling and machine health; everything **inside the image** (base image, JDK, code) is still yours.

```bash
docker build -t <registry>/order:1.0 .
docker push <registry>/order:1.0
gcloud run deploy order --image <registry>/order:1.0 --region southamerica-east1 --max-instances 10
```

The same image you run with Docker Compose: moving provider means pushing it somewhere else.

- **Managed Kubernetes** (EKS, GKE, AKS) is CaaS too: the provider runs the control plane, you use the standard Kubernetes API. **Your project uses it.**
- **Choose it when** your services are already containers. **Avoid it when** the team would rather not patch base images: PaaS is one step up.

<p class="small">AWS ECS / Fargate, Google Cloud Run, Azure Container Apps.</p>

---

<!-- _class: tight -->

## PaaS: Platform as a Service

**You hand over the code; the platform builds and runs it.** It supplies OS, JDK, deploys, load balancing and scaling; you keep the code, the configuration (env vars, scaling rules), data and access.

```bash
heroku create store-order
heroku addons:create heroku-postgresql:essential-0
git push heroku main
heroku ps:scale web=2
```

A **buildpack** finds the `pom.xml` and builds the project: nobody installed a JDK or a database.

- **12-factor app**: stateless processes, config in env vars, logs to stdout — the platform may restart or move your process and **wipe its local disk**.
- **Choose it when** the team wants to ship features, not manage servers. **Avoid it when** you need software the platform lacks, or at large, steady scale.

<p class="small">Heroku, AWS Elastic Beanstalk, Google App Engine, Azure App Service, Railway, Render.</p>

---

<!-- _class: tight -->

## FaaS: Function as a Service

**You hand over a single function; it runs only when something calls it.** PaaS taken to the extreme (**serverless**): instances on demand, **scale to zero**, pay per invocation and per millisecond.

The whole order service is not a good fit, but the e-mail sent after each order is:

```java
public class OrderCreated implements RequestHandler<Map<String, Object>, String> {
    @Override
    public String handleRequest(Map<String, Object> event, Context context) {
        // send the confirmation e-mail for this order
        return "sent";
    }
}
```

<p class="small">AWS Lambda, Google Cloud Functions, Azure Functions, Cloudflare Workers.</p>

---

## FaaS: two constraints

- **Cold start**: the first request to a function with no instance ready waits for a sandbox, the code and the runtime — seconds for a Spring Boot application.
- **Maximum execution time**: 15 minutes on Lambda.
- **Choose it when** the work is short, event-driven and sporadic: webhooks, scheduled jobs, a file after upload.
- **Avoid it when** every request needs low latency or traffic is steady and heavy: an always-on container is cheaper and more predictable.

<div class="q">

**Serverless containers blur the line.** Cloud Run and Azure Container Apps also scale to zero and bill by usage, but run any image. "Serverless" is the *operating model*, not only functions.

</div>

---

## SaaS: Software as a Service

**You use the product; the provider runs everything else.** You keep user accounts and permissions, the data you enter and the integrations (APIs, webhooks).

- **The store on SaaS**: Shopify already is a store. Create an account, register products, set up payments — live the same day, but it can only do what the product allows.
- **Multi-tenant**: one application serves all customers, each one's data kept apart — that is what makes SaaS cheap and instant.
- **Choose it when** a product meets the need and the tool is not your differentiator: e-mail, CRM, monitoring, CI/CD.
- **Avoid it when** the software *is* your differentiator, or you need customisation the product will never offer.

<p class="small">Google Workspace, Salesforce, Slack, GitHub, Datadog, Shopify.</p>

---

## Managed building blocks: DBaaS

Not everything fits on the ladder. **DBaaS** applies the same handover to a **single component**: instead of operating a Postgres server, you rent one.

| Running Postgres on a VM | Using a DBaaS |
|---|---|
| You install it and patch the OS and the database | The provider patches in a window you choose |
| You write backup scripts and test them | You set the retention period |
| You build replication and failover | You turn on an option (Multi-AZ on RDS) |
| Schema, queries, access | Schema, queries, access: **these stay with you** |

<p class="small">AWS RDS, Amazon Aurora, Google Cloud SQL, Azure Database, Neon.</p>

---

## The same idea for other components

| Model | Abbreviation | Examples |
|---|---|---|
| Storage as a Service | STaaS | AWS S3, Google Cloud Storage, Backblaze B2 |
| AI / ML as a Service | AIaaS | AWS Bedrock, Google Vertex AI, Azure AI |
| Monitoring as a Service | — | Datadog, New Relic, Grafana Cloud |
| Security as a Service | SECaaS | Cloudflare, AWS Shield, Snyk |
| Communication as a Service | CPaaS | Twilio, SendGrid, AWS SES |

---

<!-- _class: tight -->

## Comparing the models

Read by rows, watching each characteristic change from left to right:

| | On-premises | IaaS | CaaS | PaaS | FaaS | SaaS |
|---|---|---|---|---|---|---|
| **You deploy** | everything | a VM | an image | code | a function | nothing |
| **Control** | maximum | high | medium | medium | low | minimal |
| **Time to go live** | months | hours | minutes | minutes | minutes | immediate |
| **Scaling** | buy hardware | manual or scripted | automatic (some to zero) | automatic | automatic to zero | automatic |
| **You pay for** | hardware (CapEx) | VM-hours | container time | instances or usage | invocations and duration | users or seats |
| **Portability** | full | high | high (the image) | medium | low (vendor API) | low (data export) |

<!--
Control and portability fall as time to go live improves. FaaS is the outlier on portability:
the code is written against a vendor API.
-->

---

<!-- _class: tight -->

## Who offers each model

| Model | AWS | Google Cloud | Microsoft | Other providers |
|---|---|---|---|---|
| **IaaS** | EC2 | Compute Engine | Azure Virtual Machines | DigitalOcean Droplets, Oracle Cloud Compute, Magalu Cloud |
| **CaaS** | ECS / Fargate, EKS | Cloud Run, GKE | Azure Container Apps, AKS | DigitalOcean Kubernetes, Fly.io |
| **PaaS** | Elastic Beanstalk | App Engine | Azure App Service | Heroku, Railway, Render |
| **FaaS** | Lambda | Cloud Run functions | Azure Functions | Cloudflare Workers, Vercel Functions |
| **SaaS** | Amazon Connect, QuickSight | Google Workspace | Microsoft 365, Dynamics 365 | Salesforce, Slack, GitHub, Shopify, TOTVS |
| **Managed blocks** | RDS, ElastiCache, MSK | Cloud SQL, Memorystore | Azure Database, Azure Cache for Redis | Neon, Upstash, Confluent Cloud |

<div class="ok">

Read by columns: **a model describes a service, not a company** — AWS appears on every row. The big clouds offer almost every model; smaller providers specialise in one step of the stack.

</div>

<!--
The store could use a single provider (on AWS: EKS for the services, RDS for Postgres) or mix providers
(GitHub for the code and CI): the requirement of each component decides, as the next slide shows.
Cloud Run functions was formerly called Cloud Functions.
-->

---

<!-- _class: tight -->

## How to choose

**Per component, not per system.** Start from the most managed option; ask in order and stop at the first **yes** (each **no** goes one step down):

<div class="matrix" style="grid-template-columns: 1.15fr auto 1fr; gap: 6px 10px">
<div class="box accent">1 · Does a product already do the job?</div><div class="arrow">yes →</div><div class="box green"><span><strong>SaaS</strong> · GitHub Actions, Datadog</span></div>
<div class="box accent">2 · A standard database, cache or broker?</div><div class="arrow">yes →</div><div class="box green"><span><strong>Managed service</strong> · RDS, ElastiCache, MSK</span></div>
<div class="box accent">3 · Short, event-driven and sporadic?</div><div class="arrow">yes →</div><div class="box green"><span><strong>FaaS</strong> · Lambda, Cloud Functions</span></div>
<div class="box accent">4 · Control of the OS or special hardware?</div><div class="arrow">yes →</div><div class="box green"><span><strong>IaaS</strong> · EC2, Compute Engine, Azure VM</span></div>
<div class="box accent">5 · A container that needs the Kubernetes API?</div><div class="arrow">yes →</div><div class="box green"><span><strong>CaaS, managed Kubernetes</strong> · EKS, GKE, AKS</span></div>
<div class="box accent">6 · A container?</div><div class="arrow">yes →</div><div class="box green"><span><strong>CaaS, managed containers</strong> · Cloud Run, ECS Fargate</span></div>
<div class="box muted">None of the above</div><div class="arrow">→</div><div class="box green"><span><strong>PaaS</strong> · Heroku, App Engine</span></div>
</div>

---

## The store on AWS

Running each component through the questions gives one reasonable result, with the same shape as the course project:

<div class="flow" style="align-items: stretch">
<div class="box muted" style="flex: .55; display: flex; align-items: center; justify-content: center">Client</div>
<div class="arrow" style="align-self: center">→</div>
<div class="group">
<div class="caption">CaaS · EKS</div>
<div class="box accent">gateway<small>CaaS: EKS</small></div>
<div class="box accent">account<small>CaaS: EKS</small></div>
<div class="box accent">order<small>CaaS: EKS</small></div>
</div>
<div class="arrow" style="align-self: center">→</div>
<div class="group">
<div class="caption">Managed data</div>
<div class="box green">Postgres<small>DBaaS: RDS</small></div>
<div class="box green">Redis<small>DBaaS: ElastiCache</small></div>
<div class="box green">Kafka<small>managed: Amazon MSK</small></div>
</div>
<div class="arrow" style="align-self: center">→</div>
<div class="group">
<div class="caption">Events</div>
<div class="box orange">notification<small>FaaS: Lambda</small></div>
<div class="arrow">↓</div>
<div class="box">e-mail<small>CPaaS: AWS SES</small></div>
</div>
</div>

<div class="ok">

Real systems **mix** models: CaaS for the services, DBaaS for the data, FaaS for the sporadic work. The data and access row stays yours in every box.

</div>

<!--
Arrows: client → gateway → account and order; account and order → Postgres; order → Redis and Kafka; Kafka triggers the Lambda, which sends the e-mail through SES.
-->

---

<!-- _class: tight -->

## The store, component by component

| Component | Do it yourself | Managed option | What changes for the team |
|---|---|---|---|
| gateway, account, order | Compose on EC2 (IaaS) | EKS or ECS Fargate (CaaS) | no SSH or OS patching; manifests instead |
| Postgres | Postgres on EC2 | RDS (DBaaS) | backups, replication, failover become options |
| Redis | container on the VM | ElastiCache (DBaaS) | survives a VM reboot; pay per node |
| Kafka | brokers on VMs | Amazon MSK | broker patching and replacement move to AWS |
| Order notification | consumer always running | Lambda on the Kafka topic (FaaS) | pay per message; cold starts on an async path |
| CI/CD | Jenkins in a container | GitHub Actions (SaaS) | no Jenkins server to upgrade |
| Monitoring | Prometheus and Grafana | Grafana Cloud or Datadog (SaaS) | no metric storage to size |

<div class="ok">

Real systems **mix** models — the same shape as the course project. The data and access row never goes away: you still decide who connects to RDS and who reaches the gateway.

</div>

---

## Your turn: the exchange service

<div class="q">

Where would you run **exchange**, which converts currencies by calling an external rate API?

</div>

* No product does this job, and it is not a database.
* Synchronous requests during checkout: FaaS is possible, but cold starts would hurt.
* No OS control needed; already a container; the project has Kubernetes → **CaaS on EKS**.
* A small team without a cluster could reasonably pick Cloud Run: what matters is the **justification**.

---

## Common mistakes

- **"Managed" as "not my problem"**: most cloud leaks are customer-side configuration — a public S3 bucket, a database open to `0.0.0.0/0`, a leaked access key.
- **Ignoring lock-in**: the higher the model, the more you depend on one vendor's API. Prefer containers, Postgres, the Kubernetes API.
- **The higher model is always cheaper**: managed services charge a premium per unit; at large, steady scale running it yourself can pay off.
- **State on a PaaS or FaaS instance**: local files and in-memory sessions vanish on restart or scale-in.
- **FaaS for a latency-critical, high-traffic API**: an always-on container is cheaper and more predictable.

---

## Takeaways

- A service model defines **who operates each layer** of the stack; from IaaS to SaaS you hand over more of it.
- More managed = **faster, less operations**, but **less control and portability**.
- What you deploy tells the models apart: a VM, an image, code, a function or nothing.
- "Cloud" = the five NIST characteristics; it turns CapEx into OpEx, which is not always cheaper.
- Real systems mix models: **choose per component**, starting from the most managed option.
- Your data, access rules and configuration are **always** yours.

<p class="small">On the class page: try the simulators to move the line between you and the provider, and compare costs.</p>
