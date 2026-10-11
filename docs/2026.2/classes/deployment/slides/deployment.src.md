---
marp: true
lang: en
title: Cloud Deployment Roadmap
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

# Cloud Deployment Roadmap

**Choose the simplest platform that fits your team today — and grow into the next tier**

<!--
Objectives: compare platforms by what they hide; choose one per team size; estimate a monthly cost from
unit prices and spot the fixed costs; plan a migration on concrete pain; diagnose networking traps.
Outline: (1) two paths; (2) roadmap by team size; (3) Lightsail, ECS Express Mode, Railway, Fly.io;
(4) lightweight Kubernetes; (5) cost model; (6) migration path and pitfalls.
-->

---

## Kubernetes for everyone?

<div class="q">

A 3-person startup with 3 microservices wants to "do it right" and go straight to **EKS**.
Good idea?

</div>

* The EKS **control plane alone** costs **$0.10/h ≈ $73/month** — before any node.
* Two `t3.medium` nodes add **~$61**; with ALB and RDS: **~$180/month**.
* Operating it takes hours of platform work that ship **no user-facing feature**.

<!--
Kubernetes solves real problems at scale. The point of the class: the right choice depends on team size,
service count and operational maturity.
-->

---

## Two paths, not one axis

The trade-off is always the same: **less control, less operational burden**.

<div class="cols">
<div>

### Developer-experience path

**Railway / Render** → **Fly.io** → **Lightsail**

git push → URL · Dockerfile + regions · simple VM or containers.

</div>
<div>

### AWS-native path

**ECS Express Mode** → **ECS Fargate** → **EKS** → EC2

image → HTTPS URL · task definitions, no nodes · full Kubernetes · you run everything.

</div>
</div>

<div class="ok">

Left to right: **more control, more ops**. The paths target **different use cases** — your context picks the path.

</div>

---

## The landscape

| Platform | What it hides | What you manage | Best for |
|---|---|---|---|
| **Railway / Render** | everything except code | env vars, domains | startups, prototypes |
| **Fly.io** | infrastructure | Dockerfile, regions | global low-latency, edge |
| **AWS Lightsail** | hardware, networking | VM: OS, runtime · containers: image | first deploy, fixed budget |
| **ECS Express Mode** | ALB, scaling, network setup | image, env vars, 2 IAM roles | stateless services on AWS |
| **AWS ECS Fargate** | EC2 nodes | task definitions, scaling, ALB | medium-scale AWS production |
| **AWS EKS** | control plane | node groups, networking, add-ons | large teams, complex workloads |
| **Self-hosted K3s** | nothing beyond the VM | all K8s operations | on-prem, homelab, cost-sensitive |

<p class="small"><strong>AWS App Runner</strong> closed to new customers on 30 April 2026; AWS points to ECS Express Mode.</p>

---

## Small team: 1–5 devs, < 10 services

1. Not tied to AWS, users in one region? → **Railway / Render**: repo → live URL in minutes.
2. Not tied to AWS, users on several continents? → **Fly.io** (multi-region machines).
3. Must be on AWS, one VM / few containers enough? → **Lightsail** (fixed price).
4. Must be on AWS, want to grow into ECS? → **ECS Express Mode** (Fargate + ALB).

<div class="warn">

**EKS at this scale** (~$180/month before traffic) costs several times the whole bill elsewhere. It is not an option — it is a liability.

</div>

<!--
The course project uses EKS anyway: its goal is to learn Kubernetes, not to minimise cost.
-->

---

## Medium team: 5–20 devs, 10–50 services

No dedicated ops / platform engineer? → **ECS Fargate + ALB + RDS**. Otherwise → EKS (managed node groups).

| | ECS Fargate | EKS |
|---|---|---|
| Node management | none (serverless) | you manage node groups |
| Learning curve | low (task definitions) | high (full K8s API) |
| Ecosystem (Helm, CRDs) | limited | full |
| Fixed cost, no workload | none (pay per task) | ~$73/month per cluster |
| Portability | AWS-only | portable |
| GitOps (ArgoCD, Flux) | limited | first-class |

<p class="small">Fargate: no EC2 nodes to patch, native IAM, Secrets Manager, ECR, Service Connect. It does <strong>not</strong> scale to zero by itself: tasks bill 24/7.</p>

---

## Large team: 20+ devs, 50+ services

**Now EKS is the right answer** — the operational cost is justified.

| Add-on | Purpose |
|---|---|
| **Karpenter** / Cluster Autoscaler | node autoscaling, right instance types for pending pods |
| **ArgoCD** | GitOps: cluster state reconciled from Git |
| **AWS Load Balancer Controller** | ALB/NLB from Kubernetes Ingress resources |
| **External Secrets Operator** | Vault / Secrets Manager → Kubernetes Secrets |
| **Metrics Server** | enables the HPA |

<p class="small">Plus <strong>separate clusters per environment</strong> (dev, staging, prod). <strong>EKS Auto Mode</strong> (Dec 2024) lets AWS manage nodes too, for a fee.</p>

---

## AWS Lightsail Containers

Feels like Heroku: push an image, set env vars, pick a size, get a public **HTTPS endpoint**.

```bash
aws lightsail create-container-service --service-name my-api \
    --power small --scale 1
aws lightsail create-container-service-deployment \
    --service-name my-api \
    --containers '{"my-api":{"image":"my-registry/my-api:latest",...}}' \
    --public-endpoint '{"containerName":"my-api","containerPort":8080}'
```

<div class="warn">

No standard VPC: one public endpoint per service, others via `account.service.local`. Reaching **RDS** needs **Lightsail VPC peering**.

</div>

---

## Amazon ECS Express Mode

App Runner's successor: image + two IAM roles → Fargate service, **ALB with HTTPS**, auto scaling, URL.

```bash
aws ecs create-express-gateway-service \
    --service-name order-service \
    --execution-role-arn arn:aws:iam::123456789012:role/ecsTaskExecutionRole \
    --infrastructure-role-arn arn:aws:iam::123456789012:role/ecsInfrastructureRoleForExpressServices \
    --primary-container '{"image":"<ecr-repo>/order:1.0","containerPort":8080}' \
    --health-check-path "/actuator/health"
```

- **Image only**: CI builds and pushes to ECR (Hands-on 4). No extra fee: you pay Fargate + ALB.
- Everything is plain ECS **in your account**: "graduate" to full ECS by editing, not migrating.

<div class="warn">

Tasks run in **your VPC**: reaching RDS is a security-group rule (port 5432) — no VPC Connector.

</div>

---

## Railway and Fly.io

<div class="cols">
<div>

### Railway

- Detects language, builds and deploys **on push**
- Automatic HTTPS, custom domains
- Postgres, Redis, MongoDB add-ons
- Logs, metrics, env vars in a dashboard

- Private network: `account.railway.internal`

<p class="small">No VPC design, no Helm/CRDs/GitOps — lock-in grows past 10–15 services.</p>

</div>
<div>

### Fly.io

Containers as **Machines** in regions near users; `fly.toml` + `fly deploy`.

```toml
app = "my-order-service"
primary_region = "gru"  # São Paulo
```

`gru`: a few ms for São Paulo users vs 100+ ms to US East. `fly scale count 3 --region gru,iad,lhr`.

<p class="small">Classic Fly Postgres is yours to operate; Managed Postgres costs more. No free tier.</p>

</div>
</div>

---

## Kubernetes without EKS

| | Minikube | K3s | K0s | Kind |
|---|---|---|---|---|
| Use case | local dev | on-prem / edge prod | on-prem prod | CI/CD testing |
| Full K8s API | ✓ | ✓ | ✓ | ✓ |
| Production-grade | ✗ | ✓ | ✓ | ✗ |
| Resources | medium | very low | very low | low |

- **Minikube**: upstream K8s on your laptop — the environment of Hands-on 5.
- **K3s** (Rancher/SUSE): < 100 MB binary, SQLite by default; **K0s** (Mirantis): zero host dependencies.
- **Kind**: nodes as Docker containers — test manifests in CI before a real cluster.

<p class="small">Same manifests everywhere — but self-hosting makes the control plane <strong>your</strong> job.</p>

---

<!-- _class: tight -->

## What it costs: the store on each platform

3 services (gateway, account, order) + 1 small Postgres, 24/7. **Approximate** USD/month, `us-east-1` list prices, Oct 2026:

| Platform | Low | High |
|---|---|---|
| Railway (Hobby) | 19 | 60 |
| Fly.io | 15 | 61 |
| Lightsail | 24 | 60 |
| K3s on one VM | 24 | 59 |
| ECS Fargate / Express Mode | 71 | 196 |
| EKS | 180 | 350 |

<p class="small">One cost model on the class page generates both the table and the chart. No data transfer, logs, taxes or free tiers; São Paulo costs more.</p>

---

## Where the money goes

At small scale, **fixed costs** billed by the hour dominate — even with zero traffic:

| Line item | ≈ per month |
|---|---|
| EKS control plane | $73 per cluster |
| Application Load Balancer (+ its IPv4) | $30 |
| NAT gateway (private subnets) | $33 + data |
| Public IPv4 address | $3.65 each |
| Smallest RDS (`db.t4g.micro` + 20 GB) | $14 |

<div class="ok">

Three small Fargate tasks cost **~$27**: compute is often the *smallest* line. Fixed fees pay off at 50 services, not at 3.

</div>

---

## Migration path

1. **Day 1** — Railway / Fly.io: ship fast.
2. **Month 3** — ECS Express Mode: need AWS services or compliance.
3. **Year 1** — ECS Fargate, full control: sidecars, private services (same ECS, edited).
4. **Year 2+** — AWS EKS: multi-team, 50+ services, GitOps required.

<div class="ok">

Each migration is driven by a **concrete pain point**, not by speculation about future scale.

</div>

> A working app on Railway is worth more than a perfect EKS cluster with no users.

---

## Avoid premature optimization

<div class="warn">

Migrating Railway → ECS at 20 services: **a few weeks** of focused work.
Operating EKS for a 3-person startup for a year: **40+ hours** of platform ops that produce no features.

</div>

- Start simple; migrate when the pain is **real, measurable** and no cheaper fix exists.
- **Forgotten resources**: a cluster, NAT or ALB left running bills by the hour — set a budget alert first.
- **Hidden networking**: Lightsail VPC peering; a missing security-group rule looks like a timeout.
- **Lock-in**: App Runner closed to new customers — keep the app portable (containers, env vars, Postgres).

---

## Takeaways

1. Kubernetes is not the default: pick by **team size, service count and ops maturity**.
2. Two paths: **developer experience** (Railway → Fly.io → Lightsail) and **AWS-native** (Express → ECS → EKS).
3. Small: **Railway, Render, Fly.io, Lightsail, ECS Express Mode**. Medium: **ECS Fargate**. Large: **EKS**.
4. **Fixed costs** (control plane $73, ALB $30, NAT $33) dominate small bills — state region, date, sizing.
5. **K3s, K0s, Kind, Minikube** give the K8s API without EKS — and hand you its operations.
6. Migrate on **concrete pain**, not on speculation.
7. Keep the app **portable**: managed products change (App Runner).
