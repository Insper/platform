
Measuring reliability requires a shared vocabulary that connects raw telemetry to engineering decisions to customer commitments. Google's Site Reliability Engineering practice introduced a three-tier model for this purpose[^1], now standard across the industry.

| Term | Full name | Nature |
|---|---|---|
| **SLI** | Service Level Indicator | A measurable metric |
| **SLO** | Service Level Objective | An internal target for that metric |
| **SLA** | Service Level Agreement | A contractual commitment to customers |

``` mermaid
flowchart LR
    telemetry["Telemetry\n(logs, metrics, traces)"]
    sli["SLI\nRaw measurement"]
    slo["SLO\nInternal target"]
    sla["SLA\nExternal contract"]
    budget["Error Budget\nEngineering lever"]

    telemetry e1@-->|aggregated into| sli
    sli e2@-->|evaluated against| slo
    slo e3@-->|informs| sla
    slo e4@-->|remainder becomes| budget

    e1@{ animate: true }
    e2@{ animate: true }
    e3@{ animate: true }
    e4@{ animate: true }
```

---

## SLI — The Raw Measurement

An SLI is a **quantitative metric pulled directly from instrumentation** that reflects user-perceived system quality. Not every metric is a good SLI; only those that correlate with whether the user is getting value from the service.

### Canonical SLI categories

| Category | What it measures | Example measurement |
|---|---|---|
| **Availability** | Fraction of requests served successfully | `HTTP 2xx or 3xx / total HTTP requests` |
| **Latency** | Time to serve a request | `95th percentile request duration < 200 ms` |
| **Error rate** | Fraction of requests resulting in errors | `HTTP 5xx / total HTTP requests` |
| **Throughput** | Volume of work the system processes | `Requests per second` |
| **Durability** | Fraction of data that can be retrieved | `Successful reads / total attempted reads` |
| **Freshness** | Age of the most recent successful write | `Time since last successful cache refresh` |

!!! warning "Avoid vanity metrics"
    CPU utilisation, JVM heap size, and garbage collection pause time are **not** good SLIs on their own. A service can have 95% CPU and still serve all requests correctly — and conversely, a service can have 10% CPU and be completely down. SLIs must reflect what the user experiences, not what the infrastructure experiences.

### How SLIs are collected

- **Application-level instrumentation**: request counters and latency histograms exported via Spring Boot Actuator / Micrometer.
- **Synthetic monitoring**: probes that send real requests from outside the system on a schedule (e.g. Prometheus Blackbox Exporter).
- **Log-based**: parsing access logs to count 2xx vs 5xx responses.
- **Client-side**: measuring from the browser or mobile client for true end-user experience.

---

## SLO — The Target You Commit To

An SLO is a **specific, time-bound target for an SLI**. It answers: *"How good does this metric need to be for us to consider the service healthy?"*

**Format:**

> `SLI ≥ threshold` over a `rolling window`

**Examples:**

| SLO | Meaning |
|---|---|
| `Availability ≥ 99.9%` over 28 days | At most 0.1% of requests may fail in any 28-day period |
| `P95 latency ≤ 200 ms` over 7 days | 95% of requests complete within 200 ms in any 7-day window |
| `Error rate ≤ 0.5%` over 24 hours | No more than 5 in 1000 requests return 5xx in any day |

### Choosing the right SLO

SLOs must be **ambitious but achievable**. An SLO that is never breached is not driving reliability work — it is too loose. An SLO that is constantly breached is noise — the team stops trusting it.

- Start by measuring the current SLI over 30–90 days.
- Set the initial SLO at the observed baseline minus a small buffer.
- Tighten it over time as the system improves.
- Make SLOs public within the engineering org so all teams understand the targets they are building toward.

---

## Error Budget

The error budget is the quantity of unreliability the SLO permits. It is the engineering team's **licence to take risk**.

$$
\text{Error Budget} = 1 - \text{SLO target}
$$

For a 99.9% availability SLO over 28 days:

$$
\text{Error Budget} = 0.1\% \times 28 \text{ days} \times 24 \text{ h} \times 60 \text{ min} \approx 43.8 \text{ minutes}
$$

If the error budget is **intact**, the team can:

- Deploy frequently and accept some deployment risk
- Run experiments on production systems
- Take on more technical debt

If the error budget is **exhausted**, the team must:

- Freeze non-essential deployments
- Prioritise reliability work over feature work
- Investigate and fix the root causes consuming the budget

!!! tip "Error budget as a negotiation tool"
    When a product manager wants to ship a risky feature and the SRE team is reluctant, the error budget provides an objective answer: *"We have 12 minutes of budget remaining this month. If we deploy and it causes 30 minutes of degradation, we will miss our SLO. Let's wait until next month's budget resets."*

### Burn rate

Burn rate measures how fast the error budget is being consumed relative to the SLO window. A burn rate of 1 means the budget will be exactly exhausted by the end of the window. A burn rate of 2 means the budget will run out in half the window.

| Burn rate | Budget exhausted in | Severity |
|---|---|---|
| 1× | End of SLO window (28 days) | Normal |
| 2× | 14 days | Warning |
| 6× | ~5 days | High |
| 14.4× | ~48 hours | Critical — page immediately |

High burn-rate alerts catch fast-moving incidents early, while low burn-rate alerts catch slow degradation that would otherwise be invisible[^2].

---

## SLA — The Contractual Commitment

An SLA is a **formal agreement between service provider and customer** that defines the expected level of service and the remedies (typically service credits) if that level is not met. SLAs are legal documents; missing them has financial consequences.

### Structure of an SLA

1. **Covered services** — which products and regions are in scope
2. **SLO targets** — the availability or latency commitments
3. **Measurement methodology** — how uptime is calculated, which incidents count
4. **Exclusions** — scheduled maintenance, force majeure, customer-caused outages
5. **Remedies** — service credit schedule for each tier of breach

### Real-world SLA examples

| Provider | Service | Committed uptime | Credit for breach |
|---|---|---|---|
| AWS | EC2 | 99.99% monthly | 10–30% of affected charges |
| AWS | S3 | 99.9% monthly | 10–25% of affected charges |
| AWS | RDS Multi-AZ | 99.95% monthly | 10–100% of affected charges |
| Google Cloud | GCE | 99.99% monthly | 10–50% of charges |
| Google Cloud | Cloud Storage | 99.9% monthly | 10–25% of charges |
| Azure | Virtual Machines (2+ instances) | 99.99% monthly | 10–25% of monthly charges |

### SLA vs SLO

SLA and SLO are often confused. The critical distinction:

| | SLO | SLA |
|---|---|---|
| **Audience** | Engineering team | Customer / business |
| **Nature** | Internal target | Legal contract |
| **Strictness** | Higher (stricter) | Lower (more lenient) |
| **Consequence of breach** | Reliability work, feature freeze | Service credits, penalties |

> **Best practice**: set your SLO *stricter* than your SLA. The buffer between SLO and SLA is the safety margin that prevents a reliability incident from triggering contractual penalties. If the SLA is 99.9%, the SLO might be 99.95%.

---

## Best practices

| Practice | Rationale |
|---|---|
| **Fewer, more meaningful SLIs** | Two or three well-chosen indicators outperform ten noisy ones. Start with availability and P99 latency. |
| **28-day rolling windows** | Monthly windows smooth out weekday/weekend variation and match most billing cycles. |
| **Automate SLO dashboards** | Manual calculation is error-prone and too slow. Grafana + Prometheus or Cloud Monitoring should show current SLO compliance in real time. |
| **Review SLOs quarterly** | User expectations and system capabilities evolve. SLOs that were correct at launch may need adjustment after a year of scale. |
| **Never set SLO = 100%** | 100% is unachievable and leaves no room for planned maintenance or safe deployments. |

---

[^1]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/books/){target="_blank"}. Google / O'Reilly, 2016. Chapters 4–5.
[^2]: MURPHY, N. et al. [The Site Reliability Workbook](https://sre.google/workbook/table-of-contents/){target="_blank"}. Google / O'Reilly, 2018. Chapter 5 — Alerting on SLOs.
[^3]: [AWS Service Level Agreements](https://aws.amazon.com/legal/service-level-agreements/){target="_blank"}. Amazon Web Services.
[^4]: [Google Cloud Service Level Agreements](https://cloud.google.com/terms/sla){target="_blank"}. Google LLC.
