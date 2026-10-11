# Cloud Deployment Roadmap

Kubernetes is not the right answer for every team. It solves real problems at scale — but it introduces significant operational complexity and cost that can sink a small team or startup before they ship their first feature. This class maps the deployment landscape and provides a decision framework: given your team size, service count, and operational maturity, what is the right infrastructure choice *right now*, and how do you grow into the next tier?

The previous class, [Service Models](../service_models/index.md), gave the vocabulary (IaaS, PaaS, CaaS, DBaaS). This class turns it into concrete platforms, prices and a migration path for the store: gateway, account, order, Postgres.

!!! abstract "Learning objectives"

    By the end of this class you should be able to:

    - **Compare** the main deployment platforms (Railway, Render, Fly.io, Lightsail, ECS Fargate / Express Mode, EKS, K3s) by what they hide and what you still manage.
    - **Choose** a platform for a given team size, service count and operational maturity, and justify why Kubernetes is or is not worth it yet.
    - **Estimate** the monthly cost of a small microservice system from unit prices, and point out the fixed costs (control plane, load balancer, NAT gateway) that dominate at small scale.
    - **Plan** a migration path driven by concrete pain points instead of speculation about future scale.
    - **Diagnose** the common networking traps of simple platforms (private networking, reaching a managed database).

## Slides

<div class="slides-embed">
  <iframe src="slides/deployment.html" title="Slides: cloud deployment roadmap" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/deployment.html){:target="_blank"}

---

## 1. The Spectrum of Managed Infrastructure

Cloud providers have progressively abstracted away infrastructure concerns. The tradeoff is always the same: the more the platform manages, the less control you have and the less operational burden you carry. The diagram reads from the **most managed** option on the left to the **most control (and most work)** on the right:

``` mermaid-sim
flowchart LR
    subgraph dx ["Developer-experience path"]
        railway["Railway / Render<br/>(git push → URL)"] -->|"more control, more ops"| fly["Fly.io<br/>(Dockerfile, regions)"]
        fly -->|"more control, more ops"| lightsail["Lightsail<br/>(simple VM or containers)"]
    end
    subgraph aws ["AWS-native path"]
        express["ECS Express Mode<br/>(image → HTTPS URL)"] -->|"more control, more ops"| ecs["ECS Fargate<br/>(task definitions, no nodes)"]
        ecs -->|"more control, more ops"| eks["EKS<br/>(full Kubernetes)"]
        eks -->|"more control, more ops"| vm["EC2 VMs<br/>(you run everything)"]
    end
```

!!! info "Two paths, not one axis"
    There is no single spectrum here. ECS Express Mode is not "more managed" than Railway in any measurable way — they target different use cases. The diagram shows two paths: the **developer-experience path** (PaaS-style platforms that hide almost everything) and the **AWS-native path** (services that live in your AWS account, next to RDS, IAM and your VPC). Your team's context determines which path is relevant.

| Platform | Model | What it hides | What you manage | Best for |
|---|---|---|---|---|
| **Railway / Render** | PaaS | Everything except code | Env vars, domains | Startups, prototypes, side projects |
| **Fly.io** | PaaS / CaaS | Infrastructure | Dockerfile, regions, machine sizes | Global low-latency apps, edge deployments |
| **AWS Lightsail** | IaaS (VPS) or simple CaaS | Hardware, networking | Instance: OS and runtime; containers: image and scale | First cloud deployment, student projects, fixed budgets |
| **AWS ECS Express Mode** | CaaS | Load balancer, scaling, networking setup | Container image, env vars, two IAM roles | Stateless services on AWS, the simple entry to ECS |
| **AWS ECS Fargate** | CaaS | EC2 nodes | Task definitions, service scaling, ALB | Medium-scale, AWS-native, production |
| **AWS EKS** | CaaS (managed Kubernetes) | Control plane | Node groups, networking, add-ons | Large teams, complex workloads, multi-tenant |
| **Self-hosted K3s** | IaaS + your own Kubernetes | Nothing beyond the VM | All K8s operations | On-prem, homelab, cost-sensitive |

Section [5](#5-cost-comparison) estimates the monthly cost of each one for the same workload.

!!! warning "AWS App Runner is closed to new customers"
    Earlier editions recommended **AWS App Runner** (container image or Git repo → HTTPS URL). Since **30 April 2026**, App Runner no longer accepts new customers; existing customers keep using it, but no new features are planned. AWS recommends **Amazon ECS Express Mode** as the replacement[^2]. Managed platforms have a lifecycle — this is one more face of vendor lock-in.

---

## 2. Decision Roadmap by Team Size

=== "Small (1–5 devs)"

    **Fewer than 10 services? Start here.**

    ``` mermaid-sim
    flowchart TD
        A{"Must it run on AWS?<br/>(credits, compliance)"}
        A -->|No| B{"Users spread over<br/>several continents?"}
        B -->|No| C["Railway / Render<br/>(git push → URL)"]
        B -->|Yes| D["Fly.io<br/>(multi-region machines)"]
        A -->|Yes| E{"One VM or a few<br/>containers is enough?"}
        E -->|Yes| F["Lightsail<br/>(fixed monthly price)"]
        E -->|No| G["ECS Express Mode<br/>(Fargate + ALB)"]
    ```

    **Key recommendation:** Railway or Render for the fastest time-to-live — connect a GitHub repo and you have a live URL in minutes. On AWS, Lightsail when a fixed, predictable bill matters most; ECS Express Mode when you want a managed container platform that can later grow into full ECS without migrating.

    !!! danger "EKS at this scale"
        The EKS control plane alone costs **$0.10/hour ≈ $73/month**[^1]. Add a minimum node group (2 × `t3.medium` ≈ $61/month), a load balancer and a database, and you are spending around **$180/month** before any traffic — several times the whole bill on the simpler platforms (see [section 5](#5-cost-comparison)). For a small product team, Kubernetes is not an option here — it is a liability.

=== "Medium (5–20 devs)"

    **10–50 services. You need production-grade infrastructure but probably not a full platform engineering team.**

    ``` mermaid-sim
    flowchart TD
        A{"Dedicated ops /<br/>platform engineer?"}
        B["ECS Fargate + ALB + RDS<br/>(serverless containers, no nodes)"]
        C["EKS (managed node groups)<br/>or ECS with more control"]

        A -->|No| B
        A -->|Yes| C
    ```

    **Why ECS Fargate for medium teams:** no EC2 nodes to patch, and native integration with AWS IAM, Secrets Manager, ECR, and service discovery (Cloud Map / Service Connect). You lose the Kubernetes ecosystem but avoid the fixed control-plane fee and the node operations, which makes day-to-day work dramatically simpler.

    !!! note "Fargate does not scale to zero by itself"
        An ECS service keeps its `desiredCount` of tasks running and billing 24/7. Auto scaling adjusts that count between a minimum and a maximum; reaching zero requires setting the minimum (or a schedule) to 0 yourself, and the next request then has no task to serve it.

    | | ECS Fargate | EKS |
    |---|---|---|
    | Node management | None (serverless) | You manage node groups (or pay for Auto Mode) |
    | Learning curve | Low (task definitions) | High (full K8s API) |
    | Ecosystem (Helm, CRDs) | Limited | Full |
    | Fixed cost before any workload | None — pay per task | ~$73/month control plane per cluster |
    | Multi-cloud portability | AWS-only | Portable (standard K8s API) |
    | GitOps (ArgoCD, Flux) | Limited | First-class |

=== "Large (20+ devs)"

    **50+ services. EKS is the right answer — now the operational cost is justified.**

    At this scale, you need:

    - **Managed node groups** (or Karpenter for bin-packing autoscaling)
    - **ArgoCD** for GitOps — declarative cluster state from Git
    - **AWS Load Balancer Controller** — provision ALB/NLB from Kubernetes Ingress resources
    - **external-secrets-operator** — sync Vault or AWS Secrets Manager secrets into Kubernetes Secrets
    - **Separate clusters per environment** — dev, staging, prod each get their own EKS cluster

    | Add-on | Purpose |
    |---|---|
    | **Karpenter** | Node autoscaling — provision exactly the right instance types for pending pods |
    | **ArgoCD** | GitOps — declarative cluster state reconciled from Git |
    | **AWS Load Balancer Controller** | Provision ALB/NLB from Kubernetes Ingress resources |
    | **External Secrets Operator** | Sync Vault/Secrets Manager secrets into Kubernetes Secrets |
    | **Metrics Server** | Enables HPA (Horizontal Pod Autoscaler) |
    | **Cluster Autoscaler** | Alternative to Karpenter for node scaling |

    !!! tip "EKS Auto Mode"
        Since December 2024, **EKS Auto Mode** lets AWS manage the worker nodes as well (Karpenter-based provisioning, OS patching) together with core add-ons such as load balancing and block storage, for a management fee on top of the EC2 price[^1][^9]. It reduces the node work in this list, not the need to understand Kubernetes.

!!! info "Then why does the course project use EKS?"
    The [project](../../exercises/project/index.md) deploys the store on [EKS](../../exercises/project/eks/index.md) with a team of 2–3 people — exactly what this class advises a *startup* not to do. The goal is different: the project exists to **learn** Kubernetes and AWS, not to minimise cost or time-to-market. Keep the cluster small, delete it when you are not using it, and use the [Costs](../../exercises/project/costs/index.md) task to compare its bill with the alternatives from section 5.

---

## 3. Platform Deep-Dives

### AWS Lightsail Containers

Lightsail wraps containers in an abstraction that feels like Heroku: push an image, set environment variables, choose a node size (*power*) and a number of nodes (*scale*), get a public HTTPS endpoint. No VPCs, security groups, or IAM policies to configure, and a **fixed monthly price** per node[^4].

```termynal
$ aws lightsail create-container-service --service-name my-api \
    --power small --scale 1
$ aws lightsail create-container-service-deployment \
    --service-name my-api \
    --containers '{"my-api":{"image":"my-registry/my-api:latest","ports":{"8080":"HTTP"}}}' \
    --public-endpoint '{"containerName":"my-api","containerPort":8080}'
```

The image must come from a **public** registry (e.g., Docker Hub) or be pushed to the service's own registry with `aws lightsail push-container-image`; Lightsail then refers to it as `:my-api.<label>.<version>`.

!!! warning "Lightsail networking limitations"
    Lightsail does not use standard AWS VPC networking. Each container service has **one** public endpoint and a private domain, `<service-name>.service.local`, reachable only from other Lightsail resources in the same Region — so the store's gateway can be public while account and order are reached as `account.service.local:8080`. Reaching an **RDS** instance in a normal VPC requires **Lightsail VPC peering** with the account's default VPC — an extra configuration step many tutorials skip. There are no security groups, service mesh or fine-grained network policies.

---

### Amazon ECS Express Mode (successor to App Runner)

ECS Express Mode (launched November 2025[^3]) keeps App Runner's "image in, HTTPS URL out" simplicity, but everything it creates is an ordinary ECS resource **in your own account**. With one call you provide a container image and two IAM roles; ECS provisions a Fargate service, an Application Load Balancer with HTTPS, auto scaling, security groups and a default URL[^2]. There is no extra charge for Express Mode — you pay for the Fargate tasks, the load balancer and the rest of the underlying resources.

```bash
aws ecs create-express-gateway-service \
    --service-name order-service \
    --execution-role-arn arn:aws:iam::123456789012:role/ecsTaskExecutionRole \
    --infrastructure-role-arn arn:aws:iam::123456789012:role/ecsInfrastructureRoleForExpressServices \
    --primary-container '{
        "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/order:1.0",
        "containerPort": 8080,
        "environment": [{"name": "SPRING_PROFILES_ACTIVE", "value": "prod"}]
    }' \
    --health-check-path "/actuator/health" \
    --scaling-target '{"minTaskCount":1,"maxTaskCount":4}'
```

- **Image only.** Unlike App Runner, Express Mode does not build from source: your CI must build and push the image to ECR — exactly what the Jenkins pipeline of [Hands-on 4](../../hands-on/4/index.md) does.
- **Shared load balancer.** Several Express services (up to 25) can share one ALB, with rule-based routing keeping them isolated[^3] — useful for the store, which has several small services.
- **No dead end.** Because the ALB, target groups and task definitions are visible in your account, "graduating" to full ECS Fargate means editing those resources, not migrating.

!!! warning "Reaching RDS"
    The tasks run in subnets of **your** VPC, so reaching an RDS instance is a matter of security-group rules (allow the task's security group on port 5432) — no special connector. App Runner, by contrast, ran in an AWS-managed VPC and needed a *VPC Connector* to reach private resources.

---

### Railway

Railway provides the simplest developer experience in the ecosystem: connect a GitHub repo, Railway detects the language and framework, builds and deploys automatically. Billing is usage-based (per vCPU and GB of memory actually used, per second), on top of a small monthly plan fee that counts as usage credit[^6].

What Railway provides out of the box:

- Automatic HTTPS with custom domains
- Built-in Postgres, Redis, and MongoDB as add-on services
- Deploy on push — no CI/CD pipeline needed initially
- Private networking between services of the same project (`<service>.railway.internal`), so only the gateway needs a public domain
- Dashboard with logs, metrics, and environment variable management

!!! warning "Railway trade-offs at scale"
    Railway gives you very little control over networking — you cannot design VPCs, subnets or security group equivalents, only choose which services get a public domain. There is also no Kubernetes ecosystem (no Helm, no CRDs, no GitOps tooling). Vendor lock-in becomes a real risk once you have more than 10–15 services and complex inter-service networking requirements.

---

### Fly.io

Fly.io runs containers as lightweight VMs (*Machines*) on servers in regions around the world, close to your users. A `fly.toml` config file defines the application; `fly deploy` builds and deploys it[^7].

```toml
app = "my-order-service"
primary_region = "gru"  # São Paulo

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 8080
  force_https = true

[env]
  SPRING_PROFILES_ACTIVE = "prod"
```

**Strong suit:** Fly.io places your containers in regions close to your users. A user in São Paulo reaches `gru` in a few milliseconds, against more than 100 ms of round trip to a US East region. Adding regions is one command — `fly scale count 3 --region gru,iad,lhr` — and Fly's Anycast routing sends each user to the nearest Machine. Apps in the same organisation talk over a private network (`<app>.internal`).

**Weak suit:** Stateful services are more complex than on AWS. The classic *Fly Postgres* is an app that you operate yourself (backups, failover, upgrades); the newer **Managed Postgres** removes that work but starts at a higher fixed price than the compute of a small app[^7]. There is no free tier for new organisations, only a short trial.

---

## 4. Kubernetes Alternatives for Orchestration

If you want Kubernetes features but not EKS cost or complexity, these distributions are worth knowing. All of them expose the same Kubernetes API, so the manifests from [Hands-on 5](../../hands-on/5/index.md) run unchanged:

**Minikube** — Runs upstream Kubernetes in a VM or container on your laptop, single node by default, with add-ons (ingress, dashboard, metrics-server). It is the environment of [Hands-on 5](../../hands-on/5/index.md) and the [MiniKube exercise](../../exercises/minikube/index.md) — built for learning and local development, not for production.

**K3s** — Lightweight, CNCF-certified Kubernetes (single binary under 100 MB) originally from Rancher, now SUSE[^8]. It implements the same API as upstream Kubernetes, uses SQLite instead of etcd by default on a single server (embedded etcd for HA), and bundles Traefik as ingress. Ideal for on-premises deployments, edge devices, and small production clusters on one or a few VMs.

**K0s** — "Zero-friction" Kubernetes from Mirantis. A single binary with no host dependencies beyond the kernel; it bundles and manages its own control-plane components (etcd, or kine with SQLite/MySQL/Postgres). Common choice for on-premises production where a vanilla, minimal distribution is preferred.

**Kind (Kubernetes in Docker)** — Runs each Kubernetes node as a Docker container. Created to test Kubernetes itself, it is now the standard choice for integration tests in CI and for validating manifests before pushing to a real cluster.

| | Minikube | K3s | K0s | Kind |
|---|---|---|---|---|
| Use case | Local dev | On-prem / edge prod | On-prem prod | CI/CD testing |
| Full K8s API | ✓ | ✓ | ✓ | ✓ |
| Production-grade | ✗ | ✓ | ✓ | ✗ |
| Resource requirements | Medium | Very low | Very low | Low |

!!! warning "Self-hosting moves the work, not just the cost"
    K3s on a $24 VM gives you the Kubernetes API for a fraction of the EKS price (section 5), but the control plane is now **yours**: a single VM is a single point of failure, and upgrades, backups of the datastore and certificates are your job.

---

## 5. Cost Comparison

How much does it cost to run the store's three microservices (gateway, account, order) plus one small Postgres database on each platform? The table and the chart below are generated from **one cost model**: a list of unit prices and, for each platform, a *low* and a *high* configuration built from those prices. Change a price in the code and both update together.

!!! info "Assumptions — read before quoting a number"
    - **Approximate** on-demand list prices in USD, cheapest US region (AWS `us-east-1` N. Virginia, Fly.io `iad`), checked in **October 2026**[^1][^4][^5][^6][^7]. Prices change; confirm with the [AWS Pricing Calculator](https://calculator.aws/){:target="_blank"} and each provider's page.
    - Everything runs **24/7** (730 hours per month) at moderate traffic.
    - **Not included:** data transfer out, logs and metrics storage, domain names, taxes, free tiers and credits.
    - **São Paulo costs more.** `sa-east-1` list prices are noticeably higher than `us-east-1` for most services, and Fly.io charges more in `gru` as well. Use your real region when you estimate.

```python exec="1" html="1"
# Single source of truth for the cost numbers of this class (table + chart).
# Approximate on-demand list prices in USD, cheapest US region
# (AWS us-east-1, Fly.io iad), checked in October 2026. Re-check before using.
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

H = 730  # hours in a billing month

P = {
    "fargate_vcpu_h": 0.04048, "fargate_gb_h": 0.004445,      # ECS Fargate, Linux/x86
    "alb_h": 0.0225, "alb_lcu_h": 0.008,                       # Application Load Balancer
    "ipv4_h": 0.005, "nat_h": 0.045,                           # public IPv4, NAT gateway
    "rds_micro_h": 0.016, "rds_small_h": 0.032,                # RDS Postgres db.t4g.micro / small
    "rds_gb": 0.115, "ebs_gb": 0.08,                           # storage, per GB-month
    "eks_cluster_h": 0.10,                                     # EKS control plane
    "t3_medium_h": 0.0416, "t3_large_h": 0.0832,               # EC2 worker nodes
    "ls_vm_4gb": 24, "ls_vm_8gb": 44,                          # Lightsail instances
    "ls_ctr_small": 15, "ls_db": 15,                           # Lightsail container node, database
    "rw_vcpu": 20, "rw_gb": 10, "rw_hobby": 5,                 # Railway usage, Hobby plan
    "fly_512": 3.69, "fly_1gb": 6.70, "fly_vol_gb": 0.15,      # Fly.io shared-cpu-1x, volume
    "fly_mpg": 38, "fly_mpg_gb": 0.28,                         # Fly Managed Postgres (Basic)
}

def task(vcpu, gb):          # one always-on Fargate task
    return (vcpu * P["fargate_vcpu_h"] + gb * P["fargate_gb_h"]) * H

def alb():                   # ALB in 2 AZs: hourly + ~1 LCU + 2 public IPv4
    return (P["alb_h"] + P["alb_lcu_h"] + 2 * P["ipv4_h"]) * H

def rds(size, gb=20):
    return P[f"rds_{size}_h"] * H + gb * P["rds_gb"]

def railway(vcpu, gb):       # usage-based; the $5 Hobby fee counts as usage credit
    return max(P["rw_hobby"], vcpu * P["rw_vcpu"] + gb * P["rw_gb"])

# 3 services (gateway, account, order) + 1 small Postgres, running 24/7.
# "low" = smallest sensible sizing; "high" = more headroom and production extras.
PLATFORMS = [
    ("Railway (Hobby)",
     [("3 services + Postgres, ~0.2 vCPU / 1.5 GB used in total", railway(0.2, 1.5))],
     [("3 services + Postgres, ~1 vCPU / 4 GB used in total", railway(1.0, 4.0))]),
    ("Fly.io",
     [("3 machines shared-1x 512 MB", 3 * P["fly_512"]),
      ("self-run Postgres machine + 1 GB volume", P["fly_512"] + P["fly_vol_gb"])],
     [("3 machines shared-1x 1 GB", 3 * P["fly_1gb"]),
      ("Managed Postgres Basic + 10 GB", P["fly_mpg"] + 10 * P["fly_mpg_gb"])]),
    ("Lightsail",
     [("one 4 GB instance running Docker Compose (Postgres in a container)", P["ls_vm_4gb"])],
     [("3 container services (Small)", 3 * P["ls_ctr_small"]),
      ("managed database", P["ls_db"])]),
    ("K3s on one VM",
     [("Lightsail 4 GB instance, Postgres as a pod", P["ls_vm_4gb"])],
     [("Lightsail 8 GB instance", P["ls_vm_8gb"]), ("managed database", P["ls_db"])]),
    ("ECS Fargate\n(or Express Mode)",
     [("3 tasks 0.25 vCPU / 0.5 GB", 3 * task(0.25, 0.5)), ("ALB", alb()),
      ("RDS db.t4g.micro", rds("micro"))],
     [("3 tasks 1 vCPU / 2 GB", 3 * task(1, 2)), ("ALB", alb()),
      ("RDS db.t4g.small", rds("small")), ("NAT gateway", P["nat_h"] * H)]),
    ("EKS",
     [("control plane", P["eks_cluster_h"] * H), ("2 × t3.medium nodes", 2 * P["t3_medium_h"] * H),
      ("EBS 2 × 20 GB", 40 * P["ebs_gb"]), ("ALB", alb()), ("RDS db.t4g.micro", rds("micro"))],
     [("control plane", P["eks_cluster_h"] * H), ("3 × t3.large nodes", 3 * P["t3_large_h"] * H),
      ("EBS 3 × 30 GB", 90 * P["ebs_gb"]), ("ALB", alb()), ("RDS db.t4g.small", rds("small")),
      ("NAT gateway", P["nat_h"] * H)]),
]

def total(items):
    return round(sum(c for _, c in items))

def detail(items):
    return " + ".join(f"{name} (${cost:.0f})" for name, cost in items)

rows = "".join(
    f"<tr><td><strong>{name.replace(chr(10), ' ')}</strong></td>"
    f"<td>${total(low)}</td><td>${total(high)}</td>"
    f"<td>{detail(low)}</td><td>{detail(high)}</td></tr>"
    for name, low, high in PLATFORMS)
print("<table><thead><tr><th>Platform</th><th>Low</th><th>High</th>"
      "<th>Low estimate assumes</th><th>High estimate assumes</th></tr></thead>"
      f"<tbody>{rows}</tbody></table>")

names = [n for n, _, _ in PLATFORMS]
lows = [total(l) for _, l, _ in PLATFORMS]
highs = [total(h) for _, _, h in PLATFORMS]
eks_cp = round(P["eks_cluster_h"] * H)

x = np.arange(len(names))
width = 0.35
fig, ax = plt.subplots(figsize=(11, 5))
b1 = ax.bar(x - width / 2, lows, width, label="Low estimate", color="#4C9BE8")
b2 = ax.bar(x + width / 2, highs, width, label="High estimate", color="#F28E2B")
ax.axhline(y=eks_cp, color="gray", linestyle="--", linewidth=0.8)
ax.text(1.6, eks_cp + 6, f"EKS control plane alone (${eks_cp})", fontsize=8, color="gray")
for bar in list(b1) + list(b2):
    ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 3,
            f"${bar.get_height():.0f}", ha="center", va="bottom", fontsize=8, color="gray")
ax.set_ylabel("USD per month (approx.)", color="gray")
ax.set_title("Estimated monthly cost: 3 services + Postgres, 24/7 (us-east-1, Oct 2026 list prices)",
             fontweight="bold", color="gray")
ax.set_xticks(x)
ax.set_xticklabels(names, fontsize=9, color="gray")
ax.tick_params(colors="gray")
for side in ("top", "right"):
    ax.spines[side].set_visible(False)
ax.legend(frameon=False, labelcolor="gray")
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

### Reading the estimate: where the money goes

Look at the *assumes* columns rather than the totals. At this scale the bill is dominated by **fixed costs** that exist even with zero traffic:

| Line item | Approx. per month | Why it appears |
|---|---|---|
| EKS control plane | $73 per cluster | $0.10/hour for the managed API server, scheduler and etcd[^1] |
| Application Load Balancer | ~$30 | Hourly fee + capacity units + its public IPv4 addresses |
| NAT gateway | ~$33 + data | Lets tasks or nodes in **private** subnets reach the internet (ECR, external APIs) |
| Public IPv4 address | ~$3.65 each | AWS charges every public IPv4 address since February 2024[^10] |
| Smallest RDS instance | ~$14 | `db.t4g.micro` + 20 GB storage, single-AZ (Multi-AZ doubles it) |

The compute for three small Spring Boot services is often the *smallest* line. This is why a platform with a fixed control-plane fee loses at three services and wins at fifty: the fixed cost is spread across more workloads. It is also why "one EKS cluster per environment" (dev, staging, prod) triples the fixed part of the bill.

!!! tip "Protect your AWS account"
    Create an **AWS Budget** with an e-mail alert before you create a cluster, tag every resource with the project name, and delete NAT gateways, load balancers and clusters when you stop working — they bill by the hour whether you use them or not. The [Costs](../../exercises/project/costs/index.md) task of the project asks for exactly this analysis.

---

## 6. Example: the store at each stage

The same four components, deployed on the three platforms of the migration path below:

| Store component | Day 1 — Railway | Year 1 — ECS Fargate | Year 2+ — EKS |
|---|---|---|---|
| **gateway** | Service with a public domain | ECS service behind the ALB (Express Mode creates it) | Deployment + Service, exposed by an Ingress (AWS Load Balancer Controller) |
| **account, order** | Services on private networking (`account.railway.internal`) | ECS services discovered via Service Connect / Cloud Map | Deployments + `ClusterIP` Services (as in [Hands-on 5](../../hands-on/5/index.md)) |
| **Postgres** | Railway Postgres add-on | RDS, reached through security-group rules | RDS, credentials synced by External Secrets |
| **Deploy** | `git push` to `main` | CI builds image → ECR → new task definition | CI builds image → ECR → ArgoCD syncs manifests from Git |

The application code does not change across the three columns: the 12-factor style (configuration in environment variables, stateless services, state in Postgres) is what makes each migration a deployment exercise rather than a rewrite.

---

## 7. Migration Path

!!! tip "The right answer changes as you grow"
    Start simple and migrate deliberately. Each migration should be driven by a **concrete pain point**, not speculation about future scale. A working app on Railway is worth more than a perfectly architected EKS cluster with no users.

``` mermaid-sim
flowchart TD
    start(["Idea / Prototype"])
    r["Railway / Fly.io<br/>(Day 1 — ship fast)"]
    ex["ECS Express Mode<br/>(Month 3 — AWS-native, stateless)"]
    ecs["ECS Fargate, full control<br/>(Year 1 — production)"]
    eks["AWS EKS<br/>(Year 2+ — scale, team grows)"]

    start --> r
    r -->|"Need AWS services<br/>or compliance"| ex
    ex -->|"Need sidecars, private<br/>services, fine control"| ecs
    ecs -->|"Multi-team, 50+ services,<br/>GitOps required"| eks

    style r fill:#4CAF50,color:#fff
    style ex fill:#FF9800,color:#fff
    style ecs fill:#FF5722,color:#fff
    style eks fill:#F44336,color:#fff
```

Note that the step from Express Mode to "full" ECS Fargate is not a migration at all: Express Mode *is* ECS, so you start editing the task definitions, load balancer rules and networking it created.

!!! warning "Avoid premature optimization"
    The cost of migrating from Railway to ECS at 20 services is a few weeks of focused engineering work. The cost of operating EKS for a 3-person startup for a year is 40+ hours of platform ops work that produces no user-facing features. Start simple. Migrate when the pain is real, measurable, and no cheaper fix exists.

!!! warning "Other common pitfalls"
    - **Forgotten resources.** A test EKS cluster, NAT gateway or load balancer left running over a holiday is the classic student bill. Set a budget alert first.
    - **Hidden networking steps.** Lightsail needs VPC peering to reach RDS; on ECS and EKS, a missing security-group rule looks like a "connection timed out" from the service.
    - **Quoting prices without assumptions.** A cost number without region, date, sizing and hours per month cannot be compared or checked.
    - **Betting on a single managed product.** App Runner's closure to new customers shows that the simplest platforms can change under you; keep the application portable (containers, environment variables, Postgres).

---

## Key takeaways

- Kubernetes is not the default: pick the platform by **team size, service count and operational maturity**.
- There are two paths: **developer experience** (Railway/Render → Fly.io → Lightsail) and **AWS-native** (ECS Express Mode → ECS Fargate → EKS → raw EC2), each trading simplicity for control.
- At small scale, **fixed costs** (EKS control plane ~$73, ALB ~$30, NAT ~$33) dominate the bill; state every estimate with its region, date and sizing.
- Small teams: Railway, Render, Fly.io, Lightsail or ECS Express Mode. Medium teams: **ECS Fargate**. Large teams: **EKS** with Karpenter/Auto Mode, ArgoCD, the Load Balancer Controller and External Secrets.
- K3s, K0s, Kind and Minikube give the Kubernetes API without EKS — and hand you the control plane's operations.
- Migrate on **concrete pain**, keep the application portable, and never assume a managed product will exist forever (App Runner).

## Connections

- [Service Models](../service_models/index.md) — the IaaS / PaaS / CaaS vocabulary used here.
- [Containerization](../containerization/index.md) — the images every platform in this class deploys.
- [Hands-on 4 — DevOps](../../hands-on/4/index.md) — the pipeline that builds and pushes the images.
- [Hands-on 5 — Orchestration](../../hands-on/5/index.md) and the [MiniKube exercise](../../exercises/minikube/index.md) — the Kubernetes API that EKS, K3s and Kind all expose.
- [Reliability](../reliability/index.md) — what you lose when the whole store runs on a single VM.
- Project: [AWS](../../exercises/project/aws/index.md), [EKS](../../exercises/project/eks/index.md) and [Costs & PaaS](../../exercises/project/costs/index.md).


[^1]: [Amazon EKS pricing](https://aws.amazon.com/eks/pricing/){:target="_blank"} — $0.10 per cluster per hour with standard Kubernetes version support ($0.60 with extended support); Auto Mode adds a per-instance management fee.
[^2]: [AWS App Runner availability change](https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html){:target="_blank"} — closure to new customers and migration guide to ECS Express Mode.
[^3]: [Announcing Amazon ECS Express Mode](https://aws.amazon.com/about-aws/whats-new/2025/11/announcing-amazon-ecs-express-mode/){:target="_blank"}, AWS What's New, November 2025.
[^4]: [Amazon Lightsail pricing](https://aws.amazon.com/lightsail/pricing/){:target="_blank"} and [Lightsail container services](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-container-services.html){:target="_blank"}.
[^5]: [AWS Fargate pricing](https://aws.amazon.com/fargate/pricing/){:target="_blank"}
[^6]: [Railway pricing](https://railway.com/pricing){:target="_blank"}
[^7]: [Fly.io resource pricing](https://fly.io/docs/about/pricing/){:target="_blank"}
[^8]: [K3s documentation](https://docs.k3s.io/){:target="_blank"}
[^9]: [Amazon EKS Auto Mode](https://docs.aws.amazon.com/eks/latest/userguide/automode.html){:target="_blank"}
[^10]: [New — AWS Public IPv4 Address Charge](https://aws.amazon.com/blogs/aws/new-aws-public-ipv4-address-charge-public-ip-insights/){:target="_blank"}, AWS News Blog, 2023.
