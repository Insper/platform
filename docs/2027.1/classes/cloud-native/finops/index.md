The first real invoice of BoxOffice's production environment arrives, and it is three times the estimate. Nobody can say why: the costs are spread over forty line items, half of them have names like `USE1-NatGateway-Bytes` and `DataTransfer-Regional-Bytes`, and no resource is tagged with the service that created it. In the cloud, **every architectural decision is also a purchasing decision** — and the bill is the one metric that every executive reads.

**FinOps** (cloud financial operations) is the practice of bringing financial accountability to the variable spending model of the cloud, so that engineering, finance and business make trade-offs between speed, cost and quality together[^1]. For a system designer it comes down to three skills: **estimate** what an architecture will cost, **attribute** what it actually costs, and **optimize** without breaking the SLOs[^2].

---

## The FinOps lifecycle

The FinOps Foundation organizes the practice in three phases that repeat continuously[^1]:

``` mermaid-sim
flowchart LR
    inform["Inform<br/>visibility: tags, allocation,<br/>showback, unit costs"] --> optimize["Optimize<br/>rightsizing, commitments,<br/>spot, architecture changes"]
    optimize --> operate["Operate<br/>budgets, anomaly alerts,<br/>policies, reviews"]
    operate --> inform
```

- **Inform** — you cannot optimize what you cannot see. Every resource carries tags (`project`, `env`, `service`, `team`); Kubernetes costs are split by namespace and label using the pods' **resource requests** (tools such as the CNCF project OpenCost[^4], or Kubecost). The result is **showback** (teams see their costs) or **chargeback** (teams are billed internally).
- **Optimize** — reduce waste (idle and oversized resources) and pay less per unit (commitments, spot, cheaper architectures).
- **Operate** — budgets with alerts, anomaly detection on daily spend, policies (no untagged resources, no GPU instances in dev), and a monthly cost review next to the SLO review.

---

## Anatomy of a cloud bill

| Cost type | Billed by | BoxOffice examples | Watch out for |
|---|---|---|---|
| **Compute** | vCPU-hour and GB-hour (VMs, containers), or request + GB-second (FaaS) | Kubernetes nodes, Lambda thumbnails | Idle replicas, oversized requests |
| **Managed services** | Instance-hour + storage + I/O | PostgreSQL, Redis, Kafka | Multi-AZ doubles the instance; replicas add up |
| **Storage** | GB-month, plus requests | S3 ticket PDFs, database volumes, snapshots | Snapshots and logs kept forever |
| **Data transfer** | GB moved | CDN egress to fans, cross-AZ traffic between services, NAT processing | Internet egress and **cross-AZ** traffic are charged; ingress usually is not |
| **Fixed hourly items** | Hour, whether used or not | Kubernetes control plane, load balancers, NAT gateways, public IPv4 addresses | They dominate small and non-production environments |
| **Observability** | GB ingested, retained, queried; active series | Logs, metrics, traces | High-cardinality metrics and debug logs in production |
| **Third-party SaaS** | Per transaction or per seat | Payment fees (a percentage of the ticket price), e-mail per thousand | Often larger than the whole infrastructure — but a business cost |

### Pricing models

| Model | Discount vs on-demand | Commitment | Good for |
|---|---|---|---|
| **On-demand** | — | None | Spiky and unknown workloads; the reference price |
| **Commitments** (AWS Savings Plans / Reserved Instances, GCP committed use discounts, Azure reservations) | Substantial (often tens of percent) for 1 or 3 years | Pay for a baseline whether you use it or not | The steady **baseline**: the 6 always-on nodes, the databases |
| **Spot / preemptible** | Large, variable | None, but the provider can reclaim the capacity with short notice (two minutes on AWS) | Stateless, interruptible work: workers, batch, CI runners, part of the stateless fleet |
| **Serverless / per request** | — | None | Low or very spiky traffic; scale to zero |

The usual portfolio is **commit for the floor, on-demand for the daily wave, spot for the interruptible part** — which only works if you know your baseline, i.e., after the *Inform* phase.

---

## A cost model of BoxOffice { #cost-model }

The model below estimates the monthly bill of the production architecture designed in this course. Every number is an **assumption** you can change — that is the point of a model: it makes the drivers explicit and lets you ask "what if?". Prices are approximate on-demand list prices for AWS `us-east-1`; confirm them with the provider's calculator before quoting them, and remember that other regions (including `sa-east-1`, São Paulo) are more expensive.

!!! info "Assumptions"

    - Production only (staging and load-test environments are extra), running 24/7 (730 h per month).
    - Steady state: 6 worker nodes run all services. **Four on-sales per month**, each needing 24 extra nodes for 2 hours.
    - Not included: payment-provider fees, taxes, support plans, free tiers and discounts, cross-AZ transfer between services.

```python exec="1" html="1"
# BoxOffice monthly cost model. Approximate on-demand list prices in USD,
# AWS us-east-1, used as ILLUSTRATIVE assumptions: re-check them in the
# AWS Pricing Calculator before quoting any number.
import matplotlib.pyplot as plt
from io import StringIO

H = 730                       # hours in a billing month
ONSALES, PEAK_H = 4, 2        # 4 on-sales per month, 2 peak hours each
PEAK_HOURS = ONSALES * PEAK_H

P = {
    "eks_h": 0.10,            # EKS control plane per cluster-hour
    "node_h": 0.192,          # m6i.xlarge (4 vCPU, 16 GiB) on-demand
    "rds_h": 0.225,           # db.r6g.large PostgreSQL, single-AZ
    "rds_gb": 0.115,          # gp3 storage per GB-month (per copy)
    "redis_h": 0.206,         # cache.r6g.large
    "msk_h": 0.21,            # kafka.m5.large broker
    "msk_gb": 0.10,           # broker storage per GB-month
    "alb_h": 0.0225, "lcu_h": 0.008,
    "nat_h": 0.045, "nat_gb": 0.045,
    "s3_gb": 0.023,
    "cdn_gb": 0.085,          # CDN egress, first price tier
    "logs_gb": 0.50,          # log ingestion per GB
    "lambda_req": 0.20 / 1e6, "lambda_gbs": 0.0000166667,
    "email_1k": 0.10,
}

# (component, palette id, sizing, steady $/month, extra $/month for the on-sales)
ROWS = [
    ("Kubernetes control plane", "—", "1 cluster", P["eks_h"] * H, 0),
    ("Worker nodes (services)", "app", "6 × m6i.xlarge, +24 at peak", 6 * P["node_h"] * H,
     24 * P["node_h"] * PEAK_HOURS),
    ("PostgreSQL primary, Multi-AZ", "sql", "db.r6g.large ×2 + 2 × 200 GB",
     2 * P["rds_h"] * H + 2 * 200 * P["rds_gb"], 0),
    ("PostgreSQL read replica", "sql", "db.r6g.large + 200 GB", P["rds_h"] * H + 200 * P["rds_gb"], 0),
    ("Redis (primary + replica)", "cache", "2 × cache.r6g.large", 2 * P["redis_h"] * H, 0),
    ("Kafka (managed)", "kafka", "3 brokers + 3 × 500 GB", 3 * P["msk_h"] * H + 1500 * P["msk_gb"], 0),
    ("Load balancer", "lb", "1 ALB, ~5 LCU (×20 at peak)", (P["alb_h"] + 5 * P["lcu_h"]) * H,
     95 * P["lcu_h"] * PEAK_HOURS),
    ("NAT gateways", "nat", "3 AZs + 2 TB processed", 3 * P["nat_h"] * H + 2000 * P["nat_gb"], 0),
    ("Object storage", "objstore", "500 GB tickets and images", 500 * P["s3_gb"], 0),
    ("CDN egress", "cdn", "20 TB/month", 20000 * P["cdn_gb"], 0),
    ("Logs ingestion", "logs", "1 TB/month", 1000 * P["logs_gb"], 0),
    ("Serverless thumbnails", "serverless", "2 M runs × 0.5 s × 1 GB",
     2e6 * P["lambda_req"] + 2e6 * 0.5 * 1 * P["lambda_gbs"], 0),
    ("Transactional e-mail", "email", "1.5 M e-mails", 1500 * P["email_1k"], 0),
]

total_steady = sum(r[3] for r in ROWS)
total = sum(r[3] + r[4] for r in ROWS)
rows = "".join(
    f"<tr><td>{name}</td><td><code>{pid}</code></td><td>{size}</td>"
    f"<td style='text-align:right'>${s:,.0f}</td><td style='text-align:right'>${p:,.0f}</td>"
    f"<td style='text-align:right'>{(s + p) / total:.0%}</td></tr>"
    for name, pid, size, s, p in ROWS)
print("<table><thead><tr><th>Component</th><th>Palette</th><th>Sizing (assumption)</th>"
      "<th>Steady $/month</th><th>On-sale extra</th><th>Share</th></tr></thead><tbody>"
      f"{rows}<tr><td><strong>Total</strong></td><td></td><td></td>"
      f"<td style='text-align:right'><strong>${total_steady:,.0f}</strong></td>"
      f"<td style='text-align:right'><strong>${total - total_steady:,.0f}</strong></td>"
      "<td style='text-align:right'><strong>100%</strong></td></tr></tbody></table>")

peak_24_7 = 30 * P["node_h"] * H - 6 * P["node_h"] * H
TICKETS = 400_000             # tickets sold per month (assumption)
print(f"<p><strong>Total ≈ ${total:,.0f}/month.</strong> The four on-sales add only "
      f"${total - total_steady:,.0f} because the 24 extra nodes exist for {PEAK_HOURS} hours; "
      f"keeping them 24/7 'just in case' would add ≈ ${peak_24_7:,.0f}/month. "
      f"At {TICKETS:,} tickets per month the platform costs ≈ ${total / TICKETS:.3f} per ticket sold.</p>")

order = sorted(ROWS, key=lambda r: r[3] + r[4])
fig, ax = plt.subplots(figsize=(10, 5))
ax.barh([r[0] for r in order], [r[3] for r in order], color="#4C9BE8", label="steady")
ax.barh([r[0] for r in order], [r[4] for r in order], left=[r[3] for r in order],
        color="#F28E2B", label="on-sale extra")
for i, r in enumerate(order):
    ax.text(r[3] + r[4] + 15, i, f"${r[3] + r[4]:,.0f}", va="center", fontsize=8, color="gray")
ax.set_xlabel("USD per month (approx., us-east-1 list prices)", color="gray")
ax.set_title("BoxOffice: where the money goes", fontweight="bold", color="gray")
ax.tick_params(colors="gray", labelsize=8)
for side in ("top", "right"):
    ax.spines[side].set_visible(False)
ax.legend(frameon=False, labelcolor="gray", loc="lower right")
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

### Reading the model

- **The peak is cheap; the baseline is not.** Elastic capacity for the on-sales costs almost nothing because it exists for eight hours. Provisioning for the peak permanently would cost more than the entire rest of the compute bill. This is the economic argument for autoscaling, pre-scaling and waiting rooms ([Capacity planning](../../performance/capacity-planning/index.md)).
- **Data services dominate compute.** PostgreSQL, Redis and Kafka together cost more than the nodes running nine services. Before adding a fourth data store, ask whether an existing one can do the job.
- **Bytes cost more than CPUs.** CDN egress and log ingestion are two of the largest lines. Image compression, longer cache lifetimes, sampling debug logs and shorter retention change the bill more than tuning Java.
- **Unit economics** turns the bill into a business metric: *cost per ticket sold* (or per 1 000 requests, per active user). A bill that doubles while tickets triple is good news; a bill that grows while tickets are flat is a regression — track it like a performance regression.

### Pay per request or pay per hour?

When is FaaS cheaper than always-on containers? The plot compares a function (100 ms per request at 512 MB, behind an HTTP API front door) with a minimum of two small container tasks behind a load balancer, each serving 50 requests per second:

```python exec="1" html="1"
# Serverless (pay per request) vs always-on containers (pay per hour).
# Approximate us-east-1 list prices; workload numbers are assumptions.
import math
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

SECONDS = 730 * 3600                       # seconds in a billing month
# FaaS: 100 ms per request at 512 MB, plus an HTTP API front door
faas_per_req = 0.20e-6 + 0.100 * 0.5 * 0.0000166667 + 1.00e-6
# Containers: 0.5 vCPU / 1 GB tasks; each one serves 50 req/s at the target utilization
task_month = (0.5 * 0.04048 + 1.0 * 0.004445) * 730
alb_month = (0.0225 + 0.008) * 730
RPS_PER_TASK, MIN_TASKS = 50, 2

rps = np.linspace(0.1, 60, 600)
faas = rps * SECONDS * faas_per_req
containers = np.array([max(MIN_TASKS, math.ceil(r / RPS_PER_TASK)) * task_month + alb_month for r in rps])
cross = rps[np.argmax(faas > containers)]

fig, ax = plt.subplots(figsize=(10, 4.5))
ax.plot(rps, faas, color="#F28E2B", linewidth=2, label="FaaS + HTTP API (per request)")
ax.step(rps, containers, color="#4C9BE8", linewidth=2, where="post",
        label=f"containers: ≥ {MIN_TASKS} tasks + load balancer (per hour)")
ax.axvline(cross, color="gray", linestyle="--", linewidth=0.8)
ax.text(cross + 0.8, faas.max() * 0.85, f"break-even ≈ {cross:.0f} req/s average", color="gray", fontsize=9)
ax.set_xlabel("average requests per second over the month", color="gray")
ax.set_ylabel("USD per month (approx.)", color="gray")
ax.set_title("Pay per request vs pay per hour", fontweight="bold", color="gray")
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

Below roughly ten requests per second *on average*, paying per request wins — idle containers are pure waste. Above it, the per-request premium accumulates and always-on containers win, more so with commitments. Spiky traffic shifts the picture: what matters is the **average**, while containers must be sized for the **peak** (or autoscale). This is why BoxOffice runs the thumbnail generator and webhook receivers as functions and the purchase path as containers.

---

## Optimization levers { #optimization-levers }

The levers below follow the cost-optimization practices of the cloud providers' well-architected frameworks[^3]. Each one saves money and each one, except the last, can hurt an SLO if applied blindly.

| Lever | What to do | Typical effect | Risk to the SLOs |
|---|---|---|---|
| **Rightsizing** | Set requests from measured usage (e.g. p95 of CPU and max of memory over two weeks), not guesses | Fewer nodes for the same pods | Too tight → throttling and `OOMKilled`; re-run the load test |
| **Autoscaling and scale to zero** | HPA + node autoscaling; KEDA scale-to-zero for workers; turn off staging at night and weekends | Non-production hours: 730 → ~250 per month | Cold starts; scale-up lag at peaks |
| **Commitments** | Cover the measured baseline with 1-year commitments | Lower unit price on the floor | Paying for unused commitment if the architecture changes |
| **Spot capacity** | Run workers, CI and a share of stateless replicas on spot, spread across instance types | Large discount on that share | Interruptions: needs graceful shutdown, PDBs, on-demand fallback |
| **ARM instances** | Graviton/Axion/Ampere nodes for JVM and Python services (multi-arch images) | Lower price per vCPU for similar performance on many workloads | Verify with a benchmark; native libraries must exist for ARM |
| **Reduce data transfer** | CDN with long TTLs; keep chatty services in the same AZ; VPC endpoints for S3/ECR instead of NAT | Lower egress and NAT processing | Zone affinity reduces spreading |
| **Storage lifecycle** | Move old ticket PDFs to infrequent-access/archive tiers; expire snapshots | Lower GB-month | Slower, priced retrieval |
| **Observability hygiene** | Sample traces, drop debug logs in production, cap metric cardinality, shorter retention | Lower ingestion bill | Less detail when debugging — keep exemplars and error traces |
| **Delete idle resources** | Unattached volumes, old load balancers, forgotten test clusters | Pure savings | None |

!!! warning "Cost and reliability pull in opposite directions"

    Multi-AZ doubles the database cost; a second region roughly doubles everything. Those are not waste — they buy availability. FinOps is not "spend less", it is "**know what each dollar buys**". Write the trade-off in the design document: "Multi-AZ PostgreSQL costs $187/month more and turns a zone failure from a multi-hour outage into a one-minute failover."

---

## Estimating in a system-design interview

Interviewers rarely want dollars, but cost-awareness is a strong signal. A three-step habit is enough:

1. **Name the drivers**: "Cost is dominated by egress for images (CDN), the data tier, and peak compute."
2. **Order of magnitude** from your capacity estimate: "30 nodes for 8 hours a month is cheap; 30 nodes for 730 hours is not — so we autoscale and pre-scale."
3. **One optimization with its trade-off**: "Spot for workers, because they are idempotent and retry; never for the primary database."

!!! tip "In the interview"

    Cost questions often come disguised: "Do we really need Kafka here?", "Why three replicas?", "Could this be serverless?". Answer with **utilization and peak-to-average ratio**: always-on capacity is cheapest when it is busy; per-request pricing is cheapest when traffic is low or very spiky. Mention that **data transfer** and **managed data stores** usually dominate before compute does.

!!! warning "Pitfalls"

    - **No tags**: costs that cannot be attributed cannot be owned or optimized.
    - **Estimating compute only**: the fixed hourly items, data transfer and observability are where surprises come from.
    - **Rightsizing without a load test**: the savings show up in the bill, the throttling shows up in the p99 at the next peak.
    - **Commitments before measuring the baseline**: locking in capacity for an architecture you are about to change.
    - **Non-production environments running 24/7**: often a large share of the total bill.
    - **Optimizing cents while the NAT gateway processes terabytes**: sort by cost before optimizing.

## How it connects { #how-it-connects }

``` mermaid
flowchart LR
    BILL["the bill: compute, managed services,<br/>storage, transfer, fixed items"] --> INF["Inform: tags,<br/>cost by pod requests"]
    INF --> OPT["Optimize: rightsizing,<br/>commitments, spot, ARM"]
    OPT --> OPS["Operate: budgets,<br/>anomalies, monthly review"]
    BASE["baseline vs peak<br/>→ autoscaling, pre-scaling"] --> OPT
    FAAS["per request vs per hour<br/>→ serverless break-even"] --> OPT
    UNIT["unit economics:<br/>cost per ticket sold"] --> OPS
    OPT --> SLO["every lever can hurt an SLO<br/>→ Reliability"]
    OPT --> LT["re-run the load test<br/>→ Performance"]
    BILL --> MAZ["Multi-AZ, second region:<br/>cost that buys availability"]
    BILL --> OBS["observability bill:<br/>cardinality, retention"]
```

**Palette components:** [`sql`](../../../reference/components/storage/index.md#sql) · [`cache`](../../../reference/components/storage/index.md#cache) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (the data tier dominates compute) · [`cdn`](../../../reference/components/edge/index.md#cdn) (egress) · [`nat`](../../../reference/components/network/index.md#nat) (fixed hourly + per GB processed) · [`objstore`](../../../reference/components/storage/index.md#objstore) (lifecycle tiers) · [`logs`](../../../reference/components/observability/index.md#logs) (ingestion) · [`serverless`](../../../reference/components/compute/index.md#serverless) · [`worker`](../../../reference/components/compute/index.md#worker) (spot candidates) · [`payment`](../../../reference/components/external/index.md#payment) (fees, a business cost). **Scenarios:** `serverless-burst`, `multi-region` (what a second region costs). **Continues in:** [Compute — containers or serverless](../../compute/serverless-autoscaling/index.md), [Performance — capacity planning](../../performance/capacity-planning/index.md), [Reliability — disaster recovery](../../reliability/disaster-recovery/index.md), [Network & security — the cloud network](../../network-security/cloud-network/index.md) (NAT gateways), [Observability — signals](../../observability/signals/index.md) (cardinality), [Project — cost report](../../../exercises/project/cost-report/index.md).

---

[^1]: FinOps Foundation. [FinOps Framework](https://www.finops.org/framework/){target="_blank"}.
[^2]: STORMENT, J. R.; FULLER, M. *Cloud FinOps*. 2nd ed. O'Reilly, 2023.
[^3]: AWS. [Well-Architected Framework — Cost Optimization Pillar](https://docs.aws.amazon.com/wellarchitected/latest/cost-optimization-pillar/welcome.html){target="_blank"}.
[^4]: OpenCost. [Open source cost monitoring for cloud-native environments](https://www.opencost.io/){target="_blank"} (CNCF project).
