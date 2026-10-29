Every design decision has a price tag. A cache that saves 90% of database reads, a CDN that absorbs the on-sale, three availability zones instead of one, an agent that calls the LLM five times per question — each one shows up on the monthly bill. In the real world, "it scales" is only half an answer; the other half is **"and it costs US$ X per month, or US$ Y per ticket sold"**. Milestone 8 asks your team to price its design honestly, connect the cost to the measurements of the load-test campaign, and say where the money would be better spent.

!!! abstract "Goals"

    With this milestone your team will:

    - **Estimate** the monthly cost of your design at the **design target** on one cloud, with an official pricing calculator.
    - **Compute** unit economics (cost per 1,000 requests and per business unit: ticket, message, ride, view, conversation).
    - **Report** the cost of the environment you actually used.
    - **Analyse** sensitivity (×10 traffic, peak vs average, commitments and spot) and compare **service models** (IaaS, PaaS, SaaS, serverless) for at least one component.
    - **Propose** saving levers backed by your own measurements.

This milestone builds on the FinOps part of [Class 11 — Cloud-native](../../../classes/cloud-native/index.md), on your M1 estimates and on the [load-test campaign](../load-test-campaign/index.md). Due in **week 18**, weight **10%** of the project.

## What to deliver

- A **cost report** page in the docs, following the [template](#templates).
- The **calculator export** (shareable link, PDF or CSV) with the **date** and the **region** used — prices change, so the export is the evidence.
- A small script or spreadsheet with the formulas (committed), so that the numbers can be recomputed.
- The **final update of the design doc** (with a changelog of what changed since M1).
- The tag `m8`.

## Acceptance criteria

- [ ] **(mandatory)** A **bill of materials** covering every component of your design doc (compute, databases, cache, broker, load balancer, NAT, egress/CDN, storage, observability, and LLM tokens for the AI option), each with quantity, size, hours and the price used.
- [ ] **(mandatory)** Every price comes from an **official pricing calculator or pricing page**, with date and region; no price is invented. Assumptions (hours per month, GB transferred, utilization, retention) are listed.
- [ ] Unit economics: **cost per 1,000 requests** and **cost per business unit** of your option.
- [ ] Cost of the **environment you actually used** (laptop, CI minutes, any cloud account — with the bill if a cloud was used).
- [ ] Sensitivity: cost at **×10 traffic**, provisioned-for-peak vs autoscaled, and with **commitments/spot** (reserved instances, savings plans, committed-use discounts).
- [ ] A **service-model comparison** for at least one component (e.g. Kafka self-managed on Kubernetes vs a managed Kafka service vs a serverless queue): cost, operational effort, limits.
- [ ] **≥ 3 saving levers**, each tied to a **measurement** from M6 (e.g. "hit ratio 95% → database can be one size smaller") with an estimated saving.
- [ ] *AI usage* section (see the [policy](../../index.md#use-of-ai-tools)).

## Step by step

### 1. Pick one cloud and its calculator

Use **one** provider for the whole estimate (you may compare a single component across providers as an extra). Map each palette component of your design to a concrete service:

=== "AWS"

    Calculator: [AWS Pricing Calculator](https://calculator.aws/){target="_blank"}

    | Palette | Typical service |
    |-|-|
    | `app`, `worker` on Kubernetes | Amazon EKS (control plane) + EC2 nodes (or Fargate) |
    | `sql` | Amazon RDS / Aurora PostgreSQL |
    | `cache` | Amazon ElastiCache (Redis/Valkey) |
    | `kafka` / `queue` | Amazon MSK / Amazon SQS |
    | `lb`, `ingress` | Application Load Balancer |
    | `nat` | NAT Gateway |
    | `cdn` | Amazon CloudFront |
    | `objstore` | Amazon S3 |
    | `metrics`, `logs`, `tracing` | Amazon CloudWatch / Managed Prometheus / X-Ray |
    | `llmgw` model | Amazon Bedrock |

=== "Google Cloud"

    Calculator: [Google Cloud Pricing Calculator](https://cloud.google.com/products/calculator){target="_blank"}

    | Palette | Typical service |
    |-|-|
    | `app`, `worker` on Kubernetes | Google Kubernetes Engine (Standard or Autopilot) |
    | `sql` | Cloud SQL for PostgreSQL / AlloyDB |
    | `cache` | Memorystore for Redis |
    | `kafka` / `queue` | Managed Service for Apache Kafka / Pub/Sub |
    | `lb`, `ingress` | Cloud Load Balancing |
    | `nat` | Cloud NAT |
    | `cdn` | Cloud CDN |
    | `objstore` | Cloud Storage |
    | `metrics`, `logs`, `tracing` | Cloud Monitoring / Logging / Trace |
    | `llmgw` model | Vertex AI |

=== "Azure"

    Calculator: [Azure Pricing Calculator](https://azure.microsoft.com/en-us/pricing/calculator/){target="_blank"}

    | Palette | Typical service |
    |-|-|
    | `app`, `worker` on Kubernetes | Azure Kubernetes Service + VM node pools |
    | `sql` | Azure Database for PostgreSQL (Flexible Server) |
    | `cache` | Azure Cache for Redis |
    | `kafka` / `queue` | Event Hubs (Kafka endpoint) / Service Bus |
    | `lb`, `ingress` | Application Gateway / Load Balancer |
    | `nat` | NAT Gateway |
    | `cdn` | Azure Front Door |
    | `objstore` | Blob Storage |
    | `metrics`, `logs`, `tracing` | Azure Monitor / Application Insights |
    | `llmgw` model | Azure OpenAI |

### 2. Size each component from your numbers

Start from the M1 estimates and the M6 measurements, not from guesses: the **capacity per replica** you measured, the **peak** of the design target, a **target utilization** (≈ 0.6–0.7), the **hit ratio** of the cache, the **GB** that leave the cloud (egress is often the surprise), retention of logs and metrics, and — for the AI option — tokens per request × requests.

| Item | Formula |
|-|-|
| Instance-hours per month | instances × 730 h (or the autoscaled average × 730 h) |
| Replicas at peak | ⌈ peak req/s ÷ (capacity per replica × target utilization) ⌉ |
| Database reads after the cache | (1 − hit ratio) × read req/s |
| Egress (GB/month) | req/s × response size × 2.6 M s/month (minus what the CDN serves) |
| LLM cost per month | requests × (input tokens × input price + output tokens × output price) ÷ 10⁶ |
| Cost per 1,000 requests | monthly cost ÷ (monthly requests ÷ 1,000) |
| Cost per business unit | monthly cost ÷ units per month (tickets, messages, rides, views, conversations) |

### 3. Visualize where the money goes

A stacked chart of the bill by category makes the dominant costs obvious. The chart below uses **illustrative placeholder prices** — not real quotes — only to show the shape of the analysis; your report must use the prices of your calculator export.

```python exec="1" html="1"
import matplotlib.pyplot as plt
from io import StringIO

# ILLUSTRATIVE placeholder numbers (US$/month), NOT real prices.
# Two variants of the same design: everything on demand and provisioned for the peak,
# versus autoscaling + commitments + a cache that allows a smaller database.
categories = ["Compute", "Database", "Cache", "Broker", "Edge/CDN + egress", "Observability", "LLM tokens"]
on_demand = [6000, 3000, 600, 1200, 2500, 900, 1800]
optimized = [2800, 1500, 600, 900, 1600, 700, 900]

plt.rcParams.update({  # gray reads well in light and dark mode
    "text.color": "gray", "axes.labelcolor": "gray", "axes.edgecolor": "gray",
    "xtick.color": "gray", "ytick.color": "gray",
})
colors = ["tab:blue", "tab:orange", "tab:red", "tab:olive", "tab:purple", "tab:cyan", "tab:pink"]
fig, ax = plt.subplots(figsize=(8, 3))
variants = ["provisioned for peak,\non demand", "autoscaled + commitments\n+ cache"]
left = [0, 0]
for cat, a, b, c in zip(categories, on_demand, optimized, colors):
    ax.barh(variants, [a, b], left=left, color=c, label=cat, edgecolor="white")
    left = [left[0] + a, left[1] + b]
for i, total in enumerate(left):
    ax.text(total + 200, i, f"US$ {total:,}/month", va="center", fontsize=9)
ax.set_xlim(0, max(left) * 1.3)
ax.set_xlabel("US$ per month (illustrative placeholders, not real prices)")
ax.legend(ncol=4, fontsize=7, loc="upper center", bbox_to_anchor=(0.5, -0.35), frameon=False)
for side in ("top", "right"):
    ax.spines[side].set_visible(False)
plt.tight_layout()

buffer = StringIO()
plt.savefig(buffer, format="svg", transparent=True)
print(buffer.getvalue())
plt.close()
```

### 4. Unit economics

Divide by the unit your business cares about. For BoxOffice, **cost per ticket sold** is the number a product manager understands; for chat, cost per 1,000 messages; for video, cost per hour watched; for the assistant, cost per conversation (with tokens as the main driver). Compare it with what the unit is worth (a ticketing fee, an ad impression) — an architecture that costs more per ticket than the fee is not a business.

!!! example "BoxOffice — peak versus month"

    A flash sale lasts minutes, but capacity provisioned for it is paid for all month. Compare: (a) provisioned for the on-sale peak 730 h/month; (b) a baseline plus autoscaling during on-sales; (c) (b) plus a waiting room that caps the inventory path. The waiting room is not only a fairness feature — it is a **cost** feature: it lets the expensive, strongly consistent path be sized for the admission rate instead of the crowd.

### 5. Service models

Pick at least one component and compare how you would run it:

| Model | Example for the broker | You manage | Typical trade-off |
|-|-|-|-|
| IaaS | Kafka on VMs | OS, Kafka, upgrades, scaling, backups | Lowest unit price, highest effort |
| Containers on your cluster | Kafka on Kubernetes (operator) | Kafka, storage, upgrades | Reuses the cluster; on-call is yours |
| PaaS / managed | A managed Kafka service | Topics, clients, sizing | Higher unit price, much less operations |
| Serverless / SaaS | A serverless queue or event service | Only the usage | Pay per request; limits on throughput, retention or semantics |

Put the effort in hours per month next to the bill: an engineer's time is the largest hidden cost of self-managed components.

### 6. Saving levers backed by measurements

Every lever must point to a measurement: *"M6 shows the catalog cache at 95% hit ratio, so the database can drop one instance size (−US$ …)"*, *"CPU of `notification` averages 8% — move it to serverless or a smaller node pool"*, *"the semantic cache answered 30% of questions — LLM tokens −30%"*, *"logs are 60% of observability cost — sample debug logs and shorten retention"*. Also consider commitments (1-year reserved capacity or savings plans), spot/preemptible nodes for stateless workers, and the egress saved by the CDN.

## Templates

=== "English"

    ~~~markdown
    # Cost report — <team / system>

    ## 1. Scope and assumptions
    Cloud and region: ... · Calculator export: <link/file>, date ...
    Design target: ... req/s peak, ... average; 730 h/month; egress ... GB/month; retention ...

    ## 2. Bill of materials (design target)
    | Component (palette id) | Service | Size | Qty | Hours/month | Unit price (source) | US$/month |
    |-|-|-|-|-|-|-|
    | app (catalog) | ... | 2 vCPU / 4 GB | ... | 730 | ... | |
    | sql | ... | | | | | |
    | **Total** | | | | | | |

    ## 3. Unit economics
    | Unit | Monthly volume | Cost per unit |
    |-|-|-|
    | 1,000 requests | | |
    | ticket / message / ride / view / conversation | | |

    ## 4. Environment actually used
    Laptop / CI minutes / cloud account (bill attached): ...

    ## 5. Sensitivity
    | Scenario | US$/month | Notes |
    |-|-|-|
    | Baseline (design target) | | |
    | ×10 traffic | | which items grow linearly, stepwise, stay fixed |
    | Provisioned for peak vs autoscaled | | |
    | With commitments / spot | | |

    ## 6. Service-model comparison: <component>
    | Option | US$/month | Effort (h/month) | Limits | Choice |
    |-|-|-|-|-|

    ## 7. Saving levers
    | Lever | Evidence (M6 measurement) | Estimated saving | Risk |
    |-|-|-|-|

    ## 8. AI usage
    ~~~

=== "Português"

    ~~~markdown
    # Relatório de custos — <time / sistema>

    ## 1. Escopo e premissas
    Nuvem e região: ... · Exportação da calculadora: <link/arquivo>, data ...
    Meta de design: ... req/s no pico, ... na média; 730 h/mês; tráfego de saída ... GB/mês; retenção ...

    ## 2. Lista de materiais (meta de design)
    | Componente (id da paleta) | Serviço | Tamanho | Qtd | Horas/mês | Preço unitário (fonte) | US$/mês |
    |-|-|-|-|-|-|-|
    | app (catalog) | ... | 2 vCPU / 4 GB | ... | 730 | ... | |
    | sql | ... | | | | | |
    | **Total** | | | | | | |

    ## 3. Economia unitária
    | Unidade | Volume mensal | Custo por unidade |
    |-|-|-|
    | 1.000 requisições | | |
    | ingresso / mensagem / corrida / visualização / conversa | | |

    ## 4. Ambiente realmente usado
    Notebook / minutos de CI / conta na nuvem (fatura anexada): ...

    ## 5. Sensibilidade
    | Cenário | US$/mês | Observações |
    |-|-|-|
    | Base (meta de design) | | |
    | ×10 de tráfego | | o que cresce linearmente, em degraus, fica fixo |
    | Provisionado para o pico vs autoscaling | | |
    | Com compromissos / spot | | |

    ## 6. Comparação de modelos de serviço: <componente>
    | Opção | US$/mês | Esforço (h/mês) | Limites | Escolha |
    |-|-|-|-|-|

    ## 7. Alavancas de economia
    | Alavanca | Evidência (medição do M6) | Economia estimada | Risco |
    |-|-|-|-|

    ## 8. Uso de IA
    ~~~

## Rubric

Levels as defined in [How the exercises are graded](../../index.md#how-the-exercises-are-graded).

| Criterion | I | D | C | B | A |
|-|-|-|-|-|-|
| Bill of materials **(mandatory)** | Not delivered | Components missing or no quantities | Every component with size, quantity, hours, price | Sizes derived from M1/M6 numbers | Hidden costs found (egress, NAT per GB, log ingestion, cross-AZ traffic) |
| Sources **(mandatory)** | Invented prices | Prices without date/region | Calculator export with date and region; assumptions listed | Formulas committed; numbers recomputable | Cross-checked with a second calculator for the largest item |
| Unit economics | — | Missing | Cost per 1,000 requests and per business unit | Compared with what the unit is worth | Unit cost at ×10 traffic (economies or diseconomies of scale) explained |
| Sensitivity and service models | — | One scenario only | ×10, peak vs autoscaled, commitments; one service-model comparison | Effort (h/month) included in the comparison | Break-even point between two models computed |
| Saving levers | — | Generic advice | 3 levers with estimated savings | Each tied to an M6 measurement | One lever implemented and its effect measured |
| Actual environment and design-doc update | — | Missing | Actual cost reported; design doc updated | Changelog since M1 linked to ADRs | Cost guardrails proposed (budgets, alerts, tagging) |

## FAQ

??? question "We never deployed to a cloud. Do we still need a cloud estimate?"

    Yes. The estimate is for the **design target** on one cloud; it does not require a deployment. The "environment actually used" section then says: laptop and CI minutes (and whether you stayed within free tiers).

??? question "The calculator does not have exactly our component."

    Choose the closest managed service or price it as compute (e.g. a self-hosted search engine on VMs) and say so. What matters is that the assumption is explicit.

??? question "How do we price autoscaling?"

    Use the average number of replicas over the month (from your traffic curve: hours at baseline × baseline replicas + hours at peak × peak replicas) × the instance price. Show the arithmetic.

??? question "Do we include engineers' salaries?"

    Not in the bill, but do include **effort in hours per month** in the service-model comparison. It is often what decides between self-managed and managed.

??? question "Prices changed after we exported the estimate."

    That is why the date and region are mandatory. Keep the export; the report is judged against it.

??? question "For the AI option, where do token prices come from?"

    From the model provider's official pricing page (or the cloud's model service in the calculator), with the date. Report tokens per request **measured** in M6 (input and output separately) and the effect of the semantic cache and model routing.
