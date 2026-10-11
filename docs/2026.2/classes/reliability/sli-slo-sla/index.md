
"Is the store reliable enough?" is a question nobody can answer without numbers. The product manager wants to ship a new checkout this week; the on-call engineer says the order service had a bad month and wants to freeze deploys. Without a shared definition of "good enough", that discussion is opinion against opinion. Measuring reliability requires a shared vocabulary that connects raw telemetry to engineering decisions to customer commitments. Google's Site Reliability Engineering practice introduced a three-tier model for this purpose[^1], now standard across the industry.

| Term | Full name | Nature |
|---|---|---|
| **SLI** | Service Level Indicator | A measurable metric |
| **SLO** | Service Level Objective | An internal target for that metric |
| **SLA** | Service Level Agreement | A contractual commitment to customers |

``` mermaid-sim
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

The most useful way to write an SLI is as a ratio of events, so that it always lies between 0% and 100%[^2]:

$$
\text{SLI} = \frac{\text{good events}}{\text{valid events}} \times 100\%
$$

For example: *"the proportion of `GET /products` requests that return a non-5xx status in less than 300 ms"*. "Valid" lets you exclude events that should not count, such as `4xx` responses caused by the client.

### Canonical SLI categories

| Category | What it measures | Example measurement |
|---|---|---|
| **Availability** | Fraction of requests served successfully | `non-5xx responses / total HTTP requests` |
| **Latency** | Fraction of requests served fast enough | `requests faster than 200 ms / total requests` (equivalently, P95 < 200 ms) |
| **Error rate** | Fraction of requests resulting in errors | `HTTP 5xx / total HTTP requests` (the complement of availability) |
| **Throughput** | Volume of work the system processes | `Requests per second` (usually a capacity metric rather than an SLI) |
| **Durability** | Fraction of data that can be retrieved | `Successful reads / total attempted reads` |
| **Freshness** | Age of the most recent successful write | `Time since last successful cache refresh` |

!!! warning "Avoid vanity metrics"
    CPU utilisation, JVM heap size, and garbage collection pause time are **not** good SLIs on their own. A service can have 95% CPU and still serve all requests correctly — and conversely, a service can have 10% CPU and be completely down. SLIs must reflect what the user experiences, not what the infrastructure experiences.

### How SLIs are collected

- **Application-level instrumentation**: request counters and latency histograms exported via Spring Boot Actuator / Micrometer ([Hands-on 6](../../../hands-on/6/index.md)).
- **Synthetic monitoring**: probes that send real requests from outside the system on a schedule (e.g. Prometheus Blackbox Exporter).
- **Log-based**: parsing access logs to count 2xx vs 5xx responses.
- **Client-side**: measuring from the browser or mobile client for true end-user experience.

!!! example "The store's availability SLI in PromQL"

    Spring Boot exports the counter `http_server_requests_seconds_count` with a `status` label. The availability SLI of the order service over the last 5 minutes is:

    ```promql
    sum(rate(http_server_requests_seconds_count{application="order", status!~"5.."}[5m]))
    /
    sum(rate(http_server_requests_seconds_count{application="order"}[5m]))
    ```

    The numerator counts good events (anything that is not a `5xx`), the denominator counts all events. See the [Observability](../../observability/index.md) class for PromQL.

---

## SLO — The Target You Commit To

An SLO is a **specific, time-bound target for an SLI**. It answers: *"How good does this metric need to be for us to consider the service healthy?"*

**Format:**

> `SLI ≥ threshold` over a `rolling window`

A **rolling window** always covers the last N days (for example, from 28 days ago until now), so it moves forward every minute; a **calendar window** resets on the 1st of each month.

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
- Remember composite availability ([overview](../index.md)): a service cannot promise more than the product of the services it synchronously depends on.

---

## Error Budget

The error budget is the quantity of unreliability the SLO permits. It is the engineering team's **licence to take risk**.

$$
\text{Error Budget} = 1 - \text{SLO target}
$$

For a 99.9% availability SLO, the budget is 0.1% — of the **time** or of the **requests** in the window, depending on how the SLI is defined.

=== "Time-based"

    For a 99.9% SLO over a 28-day window:

    $$
    \text{Error Budget} = 0.1\% \times 28 \text{ days} \times 24 \text{ h} \times 60 \text{ min} \approx 40.3 \text{ minutes}
    $$

    (Over a 30.44-day calendar month the same 99.9% gives ≈ 43.8 minutes — the number usually quoted in "nines" tables.)

=== "Request-based"

    The order service receives about 1,000,000 requests per day. Over 28 days that is 28,000,000 requests, so a 99.9% SLO allows

    $$
    0.1\% \times 28\,000\,000 = 28\,000 \text{ failed requests}
    $$

    A bad deploy that returns `500` for 20,000 requests in an hour consumes about 70% of the month's budget at once.

If the error budget is **intact**, the team can:

- Deploy frequently and accept some deployment risk
- Run experiments on production systems
- Take on more technical debt

If the error budget is **exhausted**, the team must:

- Freeze non-essential deployments
- Prioritise reliability work over feature work
- Investigate and fix the root causes consuming the budget

These rules only work if they are agreed in advance: an **error budget policy** is a short document, signed by product and engineering, that says what happens when the budget runs out.

!!! tip "Error budget as a negotiation tool"
    When a product manager wants to ship a risky feature and the SRE team is reluctant, the error budget provides an objective answer: *"We have 12 minutes of budget remaining in this 28-day window. If we deploy and it causes 30 minutes of degradation, we will miss our SLO. Let's wait until enough budget has been recovered."*

### Burn rate

Burn rate measures how fast the error budget is being consumed relative to the SLO window[^2]:

$$
\text{burn rate} = \frac{\text{observed error rate}}{1 - \text{SLO}}
$$

With a 99.9% SLO, an error rate of 0.1% is a burn rate of 1 — the budget lasts exactly the whole window. An error rate of 1.44% is a burn rate of 14.4. A burn rate of $b$ exhausts the budget in (window ÷ $b$).

For a 28-day window:

| Burn rate | Budget exhausted in | Severity |
|---|---|---|
| 1× | End of SLO window (28 days) | Normal |
| 2× | 14 days | Warning |
| 6× | ~4.7 days | High — open a ticket |
| 14.4× | ~1.9 days (~47 hours) | Critical — page immediately |

The thresholds 14.4× and 6× come from the SRE Workbook: sustained for 1 hour, a 14.4× burn consumes about 2% of the budget; sustained for 6 hours, a 6× burn consumes about 5%. (The Workbook derives them for a 30-day window; with 28 days the percentages are almost the same.) High burn-rate alerts catch fast-moving incidents early, while low burn-rate alerts catch slow degradation that would otherwise be invisible[^2].

!!! example "A burn-rate alert for the order service"

    ```yaml
    # Prometheus alerting rule (99.9% SLO → budget = 0.001)
    - alert: OrderErrorBudgetFastBurn
      expr: |
        (
          sum(rate(http_server_requests_seconds_count{application="order", status=~"5.."}[1h]))
          /
          sum(rate(http_server_requests_seconds_count{application="order"}[1h]))
        ) > (14.4 * 0.001)
      for: 2m
      labels:
        severity: page
    ```

    The alert fires on a *symptom users feel* (errors burning the budget), not on a cause such as CPU — see alerting in the [Observability](../../observability/index.md) class.

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

The commitments below are taken from the providers' public SLA pages[^3][^4]; the exact conditions (deployment type, region, credit tiers) change over time, so always read the current page.

| Provider | Service | Committed monthly uptime | Remedy for breach |
|---|---|---|---|
| AWS | EC2 (region level) | 99.99% | Tiered service credits |
| AWS | S3 Standard | 99.9% | Tiered service credits |
| AWS | RDS Multi-AZ | 99.95% | Tiered service credits |
| Google Cloud | Compute Engine (instances in multiple zones) | 99.99% | Tiered service credits |
| Azure | Virtual Machines (across Availability Zones) | 99.99% | Tiered service credits |

Notice two things. First, the higher numbers apply only when *you* deploy redundantly (multiple zones, Multi-AZ) — redundancy is the price of the extra nine. Second, the remedy is a credit on your bill, not compensation for your lost sales: an SLA transfers some financial risk, it does not make your system available.

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
| **28-day rolling windows** | Four weeks always contain the same number of weekdays and weekend days, so the SLI is not distorted by calendar months of different lengths. |
| **Automate SLO dashboards** | Manual calculation is error-prone and too slow. Grafana + Prometheus or Cloud Monitoring should show current SLO compliance in real time. |
| **Review SLOs quarterly** | User expectations and system capabilities evolve. SLOs that were correct at launch may need adjustment after a year of scale. |
| **Never set SLO = 100%** | 100% is unachievable and leaves no room for planned maintenance or safe deployments. |

!!! warning "Common pitfalls"

    - **Measuring the wrong thing**: an SLI computed only from the health-check endpoint says nothing about `POST /orders`.
    - **Averages instead of percentiles**: a mean latency of 80 ms can hide 5% of users waiting 4 s. Use percentiles or "fraction of requests faster than X".
    - **Mixing windows**: an error budget computed over 30 days compared with an SLO over 28 days gives wrong decisions.
    - **SLO without a policy**: if nothing changes when the budget is gone, the SLO is just a number on a dashboard.

---

## Key takeaways

- An **SLI** is a ratio of good events to valid events that reflects what users feel; an **SLO** is a target for it over a window; an **SLA** is a contract with penalties, looser than the SLO.
- The **error budget** is 1 − SLO, in time or in requests: 99.9% over 28 days ≈ 40.3 minutes (≈ 43.8 minutes over a 30.44-day month).
- **Burn rate** = observed error rate ÷ budget; 14.4× empties a 28-day budget in about 2 days and should page someone.
- The budget turns "ship or freeze?" into a data-driven decision — if there is an agreed policy.
- Always state the **window** and use **percentiles**, never averages, for latency.

---

[^1]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/books/){target="_blank"}. Google / O'Reilly, 2016. Chapters 3–4 (Embracing Risk; Service Level Objectives).
[^2]: BEYER, B. et al. [The Site Reliability Workbook](https://sre.google/workbook/table-of-contents/){target="_blank"}. Google / O'Reilly, 2018. Chapter 2 — Implementing SLOs; Chapter 5 — Alerting on SLOs.
[^3]: [AWS Service Level Agreements](https://aws.amazon.com/legal/service-level-agreements/){target="_blank"}. Amazon Web Services.
[^4]: [Google Cloud Service Level Agreements](https://cloud.google.com/terms/sla){target="_blank"}. Google LLC.
