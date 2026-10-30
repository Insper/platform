"Is BoxOffice reliable enough?" Nobody can answer that without numbers. The product manager wants to ship a new seat-map feature the week before a stadium on-sale; the on-call engineer says the purchase path had a bad month and wants to freeze deploys. Without a shared definition of "good enough", that discussion is opinion against opinion. Google's Site Reliability Engineering (SRE) practice introduced a vocabulary that turns it into arithmetic[^1], and it is now standard across the industry:

| Term | Full name | Nature | BoxOffice example |
|---|---|---|---|
| **SLI** | Service Level Indicator | A measurement of what users experience | % of seat-hold requests that succeed in under 500 ms |
| **SLO** | Service Level Objective | An internal target for an SLI, over a window | ≥ 99.9% over 28 days |
| **Error budget** | — | The failure the SLO allows: 1 − SLO | 0.1% of seat-hold requests may fail or be slow |
| **SLA** | Service Level Agreement | A contract with customers, with penalties | Promised to partner venues: 99.5% monthly, or service credits |

``` diagram-sim
flowchart LR
    tel["Telemetry<br/>(metrics, logs, traces)"] -->|"aggregated into"| sli["SLI<br/>good / valid events"]
    sli -->|"compared with"| slo["SLO<br/>internal target"]
    slo -->|"the gap is"| budget["Error budget<br/>licence to take risk"]
    slo -->|"looser version"| sla["SLA<br/>external contract"]
    budget -->|"drives"| decisions["Ship or freeze?<br/>Page or ticket?"]
```

---

## Start from user journeys

An SLO is only useful if it measures what users care about. Start by listing BoxOffice's **critical user journeys** (CUJs) — the few interactions that must work — and then decide how to measure each one.

| Critical user journey | Why it matters | Type of SLI |
|---|---|---|
| Browse the catalog and event pages | Most traffic; first impression | Availability + latency |
| Join the waiting room and get admitted | The flash sale depends on it | Availability + latency of position updates |
| Hold seats | Revenue; strongly consistent | Availability + latency |
| Pay and get the order confirmed | Revenue; external provider involved | Availability (end to end, including the saga) |
| Receive tickets by e-mail / in the app | Trust; asynchronous | **Freshness**: time from confirmation to delivery |
| Search events | Discovery | Latency + quality (results not stale) |

Not every journey needs the same target. Browsing can tolerate an occasional slow page; a failed payment loses a sale and a fan's trust.

---

## SLI — measuring what users feel

An SLI is best written as a **ratio of events**, so it always lies between 0% and 100%[^2]:

$$
\text{SLI} = \frac{\text{good events}}{\text{valid events}} \times 100\%
$$

Both words matter. **Good** defines success from the user's point of view — "status is not 5xx **and** latency is below 500 ms". **Valid** excludes what should not count — `4xx` responses caused by the client, health-check requests, synthetic load tests.

| SLI category | Good event | BoxOffice example |
|---|---|---|
| **Availability** | Request answered without a server error | `POST /holds` returned non-5xx |
| **Latency** | Request answered faster than a threshold | `GET /events/{id}` in < 300 ms |
| **Freshness** | Data or side effect is recent enough | Confirmation e-mail sent < 2 min after `OrderConfirmed` |
| **Correctness** | Output is right | No seat sold twice (checked by a reconciliation job) |
| **Durability** | Stored data can be read back | Every confirmed order is readable a day later |

!!! warning "Avoid vanity metrics"
    CPU usage, JVM heap or the number of pods are **not** SLIs. A service can be at 95% CPU and serve everyone well, or at 5% CPU and be completely down (deadlocked, misrouted). They are useful to *diagnose*; SLIs must reflect what users experience.

### Where to measure

| Measurement point | Sees | Misses |
|---|---|---|
| **Application metrics** (OpenTelemetry, Micrometer) | Per-route detail, cheap | Requests that never reached the app (LB, DNS, network) |
| **Load balancer / gateway logs** | Everything that reached the edge | Client-side failures, CDN |
| **Synthetic probes** | A scripted journey from outside, even with no traffic | Real users' diversity |
| **Client (browser / app) telemetry** | What users truly experience | Noisy; depends on users' networks |

A common choice is to compute SLIs at the **gateway** (close to the user, but under your control) and complement them with synthetic probes of the purchase journey. With OpenTelemetry metrics exported to Prometheus (see [Signals](../signals/index.md)), the availability SLI of the seat-hold route over 5 minutes is:

```promql
sum(rate(http_server_request_duration_seconds_count{service_name="gateway", http_route="/holds", http_response_status_code!~"5.."}[5m]))
/
sum(rate(http_server_request_duration_seconds_count{service_name="gateway", http_route="/holds"}[5m]))
```

!!! example "A freshness SLI for asynchronous work"

    Request SLIs do not see asynchronous failures: `POST /orders` can be 100% green while the `notification` consumer is two hours behind (see [Messaging](../../messaging/index.md)). BoxOffice measures the journey "receive tickets" with a freshness SLI: for each `OrderConfirmed`, the time until the e-mail is accepted by the provider. Good event: under 2 minutes. The SLO: 99% of confirmations over 28 days. Consumer lag in seconds is its early-warning signal.

---

## SLO — the target

An SLO is a target for an SLI over a window:

> `SLI ≥ target` over a `window`

| BoxOffice SLO | Meaning |
|---|---|
| Seat holds: 99.9% succeed in < 500 ms, over 28 days | At most 1 in 1,000 holds may fail or be slow |
| Catalog pages: 99.5% served in < 300 ms, over 28 days | Browsing tolerates more slowness |
| Ticket delivery: 99% within 2 min of confirmation, over 28 days | Freshness of the asynchronous path |
| On-sale waiting room: 99.95% of position updates succeed, during each on-sale | An *event-scoped* SLO for the hours that matter most |

Use a **rolling window** (the last 28 days, moving every minute) rather than a calendar month: 28 days always contain four of each weekday, and the budget does not "reset" magically on the 1st.

How to choose the number:

- **Measure first.** Look at the SLI over the last 30–90 days, then set the SLO slightly below what you already achieve. A target you already miss every week is noise.
- **Respect the dependency math.** `order` cannot promise more than the product of what it calls synchronously ([Reliability — composite availability](../../reliability/index.md#composite-availability)). If the payment provider offers 99.9%, a purchase SLO of 99.99% is fiction.
- **Ask what users notice.** Going from 99.9% to 99.99% costs a lot (see the nines table); if fans would not notice, the money is better spent on features.
- **Never 100%.** It leaves no room for deploys, maintenance or the unavoidable, and every dependency you have is below it anyway.

---

## Error budget

The **error budget** is the amount of unreliability the SLO allows — the team's **licence to take risk**:

$$
\text{Error budget} = 1 - \text{SLO}
$$

=== "Request-based"

    The purchase path receives about 1,000,000 requests per day. Over 28 days that is 28,000,000 requests, and a 99.9% SLO allows

    $$
    0.001 \times 28\,000\,000 = 28\,000 \text{ failed requests}
    $$

    A bad deploy that returns errors for 5% of requests during 3 hours ($0.05 \times 3 \times 41\,667 \approx 6\,250$ failures) spends about 22% of the month's budget in one afternoon.

=== "Time-based"

    For a 99.9% SLO over 28 days:

    $$
    0.001 \times 28 \times 24 \times 60 \approx 40.3 \text{ minutes}
    $$

    Time-based budgets are intuitive ("we have 40 minutes of downtime"), but they treat 3 a.m. like 10:00 on an on-sale day. Request-based budgets weight failures by the traffic they hurt.

### Burn rate

The **burn rate** says how fast the budget is being spent relative to the window[^2]:

$$
\text{burn rate} = \frac{\text{observed error rate}}{1 - \text{SLO}}
$$

With a 99.9% SLO, an error rate of 0.1% is a burn rate of 1 — the budget lasts exactly the 28 days. An error rate of 1.44% is a burn rate of 14.4, which exhausts the budget in $28 / 14.4 \approx 1.9$ days.

The simulation below follows the purchase path's budget over one 28-day window with illustrative numbers: a quiet background of 0.01% errors, a bad deploy on day 9 (5% errors for 3 hours) and a slow degradation from day 16 (0.2% errors — a burn rate of only 2).

```python exec="1" html="1"
import matplotlib.pyplot as plt
from io import StringIO

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "xtick.color": "#888",
                     "ytick.color": "#888", "axes.edgecolor": "#888", "svg.fonttype": "none"})

SLO, DAYS = 0.999, 28
REQ_PER_HOUR = 1_000_000 / 24              # ~1 M purchase-path requests per day (illustrative)
budget = (1 - SLO) * REQ_PER_HOUR * 24 * DAYS   # failed requests allowed in the window

def error_rate(h):                          # h = hour since the window started
    day = h / 24
    if 9 * 24 + 10 <= h < 9 * 24 + 13:      # day 9, 10:00-13:00: bad deploy, 5% errors
        return 0.05
    if day >= 16:                           # from day 16: slow degradation, 0.2% errors
        return 0.002
    return 0.0001                           # normal background: 0.01%

hours = range(DAYS * 24)
spent, remaining, burn = 0.0, [], []
for h in hours:
    rate = error_rate(h)
    spent += rate * REQ_PER_HOUR
    remaining.append(100 * (1 - spent / budget))
    burn.append(rate / (1 - SLO))
days = [h / 24 for h in hours]

fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 5.2), sharex=True)
ax1.plot(days, burn, color="#e53935", lw=1.8)
for level, label in [(14.4, "page: 14.4x"), (6, "page: 6x"), (1, "budget lasts exactly 28 days")]:
    ax1.axhline(level, color="#888", ls="--", lw=1)
    ax1.text(0.2, level * 1.15, label, fontsize=8)
ax1.set_yscale("log")
ax1.set_ylabel("burn rate")
ax1.grid(True, alpha=0.3)
ax2.plot(days, remaining, color="#1976d2", lw=2)
ax2.axhline(0, color="#e53935", lw=1)
ax2.set_ylim(-35, 105)
ax2.set_ylabel("error budget left (%)")
ax2.set_xlabel("day of the 28-day window")
ax2.grid(True, alpha=0.3)
ax2.annotate("bad deploy: 3 h at 5% errors", xy=(9.5, remaining[9 * 24 + 13]),
             xytext=(10.5, 92), arrowprops={"arrowstyle": "->", "color": "#888"}, fontsize=8)
ax2.annotate("slow degradation: 0.2% errors (2x)", xy=(21, remaining[21 * 24]),
             xytext=(9, 20), arrowprops={"arrowstyle": "->", "color": "#888"}, fontsize=8)
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

The two incidents teach different lessons:

- The **bad deploy** has a huge burn rate (50×) for a short time. It must **page** someone within minutes, and the budget shows what it cost: about a fifth of the month.
- The **slow degradation** never looks dramatic — 0.2% errors would not alarm anyone on a dashboard — but at 2× it **exhausts the budget around day 26**. Only a slow-burn alert over a long window catches it.

### Alerting on burn rate { #alerting-on-burn-rate }

Alert on the budget, not on raw error rates or CPU. The SRE Workbook recommends **multi-window, multi-burn-rate** alerts[^2]: a long window to measure significance, a short window to stop the alert quickly once the problem is fixed.

| Severity | Burn rate | Long window | Short window | Budget consumed when it fires |
|---|---|---|---|---|
| Page | 14.4× | 1 h | 5 min | 2% |
| Page | 6× | 6 h | 30 min | 5% |
| Ticket | 1× | 3 days | 6 h | 10% |

<div class="csim" data-sim="slo-burn" data-slo="99.9"></div>

!!! tip "Try it"
    The window holds the two incidents of the plot above plus a few short blips. Press play (speed up with the `1×` button) and compare the four alert lanes.

    - **Blips**: the naive rule (*errors > 0.1% over 5 min*) pages on almost every one — 10 times this month — although all 14 blips together cost only 1.6% of the budget. The burn-rate rules stay silent.
    - **Bad deploy** (day 9, 5% for 3 h): the 14.4× rule pages 17 minutes in, when the incident has cost 2.2% of the budget; the 6× rule follows after 42 minutes (5.3%). The whole incident costs 22.3%.
    - **Slow degradation** (2× from day 16): no page at all; the 3-day ticket fires 34 hours in (day 17.4) with 39% of the budget spent — more than 8 days before it runs out (day 25.9).
    - Press **clear incidents**, play to day 2, pause and inject *0.7% for 3 days*: no fast page, but the 6× rule pages after about 5 hours. With *20% for 30 min* the page comes after 4 minutes, yet the incident still costs about 15%: an alert can only save the budget that is not burnt yet.

    Lab 9 provisions the same 14.4× and 6× rules (as page and ticket) for `order`, with a 99.5% SLO.

```yaml
# Prometheus alerting rule: purchase path, SLO 99.9% (budget = 0.001)
- alert: PurchaseErrorBudgetFastBurn
  expr: |
    (
      sum(rate(http_server_request_duration_seconds_count{service_name="gateway", http_route=~"/holds|/orders", http_response_status_code=~"5.."}[1h]))
      / sum(rate(http_server_request_duration_seconds_count{service_name="gateway", http_route=~"/holds|/orders"}[1h]))
    ) > (14.4 * 0.001)
    and
    (
      sum(rate(http_server_request_duration_seconds_count{service_name="gateway", http_route=~"/holds|/orders", http_response_status_code=~"5.."}[5m]))
      / sum(rate(http_server_request_duration_seconds_count{service_name="gateway", http_route=~"/holds|/orders"}[5m]))
    ) > (14.4 * 0.001)
  labels:
    severity: page
  annotations:
    summary: "Purchase path burning the 28-day error budget 14.4x faster than allowed"
```

The details of alert design, routing and on-call are in [Observability — alerting](../alerting/index.md).

!!! example "In the BoxOffice code: the SLO as an alert rule (labs 8 and 9)"

    [Hands-on 8 — SLO and burn-rate alert](../../../hands-on/8/slo/index.md) writes the promise for `catalog`: 99.5% of the requests, health checks excluded, answered without a 5xx over 28 days — at 100 req/s, a budget of about 1.21 million failed requests. It provisions the 14.4× rule as a page and the 6× rule as a ticket, as files Grafana loads at startup. [Hands-on 9 — Game day](../../../hands-on/9/game-day/index.md) copies the file for `order`, so that a hidden failure on the payment path pages the operators. Read the excerpt for the three parts of the rule: query A (error ratio over 1 h, divided by the budget 0.005, is the burn rate), query B (the same over 5 min; B repeats A with `[5m]`, cut here) and condition C, which needs both. `http_route!~"/actuator.*"` keeps the probes out of the SLI.

    ``` { .yaml title="infra/grafana/alerting/slo-order.yaml (the fast-burn rule)" }
    --8<-- "docs/2027.1/hands-on/9/code/infra/grafana/alerting/slo-order.yaml:12:26,38:52"
    ```

### The error budget policy

An error budget is only a number on a dashboard unless product and engineering agree **in advance** what happens as it is spent. That agreement is the **error budget policy**:

!!! example "BoxOffice error budget policy (purchase path)"

    - **Budget above 50%**: normal operation; deploy any working day; experiments allowed.
    - **Budget between 0 and 50%**: deploys need a rollback plan and a canary; a reliability item enters every sprint.
    - **Budget exhausted**: feature deploys to the purchase path are frozen until the 28-day SLI is back above the SLO; only fixes and reliability work ship.
    - **On-sale rule**: no deploys to the purchase path in the 24 hours before a major on-sale, whatever the budget.
    - **Single incident > 20% of the budget**: mandatory blameless postmortem with action items (see [Incident response](../incident-response/index.md)).

    Signed by the product manager and the engineering lead of the purchase path; reviewed every quarter.

!!! tip "The budget as a negotiation tool"
    The product manager wants to ship the new seat map; the engineer is nervous. The budget answers objectively: "we have 70% of the budget left and the change goes out behind a feature flag to 5% of fans — ship it." Or: "we have 8% left and the stadium on-sale is on Friday — it waits until next week." Notice it also works the other way: an unspent budget is a signal that the team is being *too* careful and could move faster.

---

## SLA — the contract

An **SLA** is a formal agreement with customers that defines the expected service and the **remedies** (usually service credits) if it is not met. It is a legal document: breaching it costs money.

An SLA typically states: covered services and regions; the commitment (e.g. 99.9% monthly uptime); how it is measured; exclusions (scheduled maintenance, customer-caused problems, force majeure); and the credit schedule.

The commitments below come from the providers' public SLA pages[^3]; conditions change over time, so always read the current page.

| Provider | Service | Monthly commitment | Condition |
|---|---|---|---|
| AWS | Amazon EC2 | 99.99% (region level) | Instances across multiple AZs |
| AWS | Amazon RDS | 99.95% | Multi-AZ deployments |
| AWS | Amazon S3 Standard | 99.9% | — |
| Google Cloud | Compute Engine | 99.99% | Instances in multiple zones |
| Azure | Virtual Machines | 99.99% | Two or more VMs across availability zones |

Two lessons hide in that table. First, the highest numbers apply only if **you** deploy redundantly — redundancy is the price of the extra nine. Second, the remedy is a credit on your bill, not compensation for your lost ticket sales: **an SLA transfers a little financial risk; it does not make your system available**.

| | SLO | SLA |
|---|---|---|
| **Audience** | The engineering team | Customers, partners, lawyers |
| **Nature** | Internal target | Legal contract |
| **Strictness** | Stricter | Looser |
| **When missed** | Reliability work, deploy freeze | Credits, penalties, reputation |

Keep the **SLO stricter than the SLA** (e.g. SLO 99.95%, SLA 99.9%): the gap is a safety margin that warns you long before the contract is at risk.

!!! tip "In the interview"
    In the requirements step, turn vague "highly available" into SLOs per journey: "seat holds 99.9% under 500 ms; browsing 99.5%; ticket e-mail within 2 minutes for 99%". Then use them: they justify redundancy (dependency math), asynchrony (removing non-critical dependencies) and alerting (burn rate). Mention that 99.99% means about 4 minutes a month, so it implies automated failover. Interviewers value hearing *why* a number was chosen more than the number itself.

!!! success "Best practices"

    - **Keep SLOs and their alert rules as code, in the repository, reviewed like any change** — a target nobody can diff or reproduce drifts. In BoxOffice: `slo-catalog.yaml` and `slo-order.yaml`, loaded by Grafana at startup (labs 8 and 9, [box above](#alerting-on-burn-rate)).
    - **Filter probes and synthetic traffic out of the SLI with an explicit label** — health checks every few seconds inflate the success ratio with requests no fan made. In BoxOffice: `http_route!~"/actuator.*"` in the rules.
    - **Start each SLO slightly below 30–90 days of measured SLI, and review it every quarter** — a target you already miss every week is noise, one you always beat is a budget nobody spends.
    - **Show the remaining error budget wherever releases are planned** — the ship-or-freeze decision becomes routine instead of a debate: 28,000 failed purchases per 28 days at 99.9%.
    - **Add an event-scoped SLO for every major on-sale** — one bad hour barely moves a 28-day budget, but it is the hour that matters; the waiting room promises 99.95% during each on-sale.

!!! warning "Common pitfalls"

    - **Measuring the wrong thing**: an SLI from the health-check endpoint says nothing about `POST /holds`.
    - **Averages instead of thresholds or percentiles**: a mean of 80 ms can hide 5% of fans waiting 4 s.
    - **Too many SLOs**: two or three per journey that someone acts on beat thirty nobody reads.
    - **Ignoring asynchronous paths**: green APIs, three-hour-old e-mails. Add freshness SLIs.
    - **SLO without a policy**: if nothing changes when the budget is gone, the SLO is decoration.
    - **Mixing windows**: a budget computed over 30 days compared with an SLO over 28 days gives wrong decisions.

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    CUJ["critical user journeys"] --> SLI["SLI = good / valid events"]
    TEL["telemetry at the gateway<br/>→ Observability"] --> SLI
    SLI --> SLO["SLO over a<br/>28-day rolling window"]
    DEP["dependency math<br/>→ composite availability"] --> SLO
    SLO --> EB["error budget = 1 − SLO"]
    SLO --> SLA["SLA: a looser<br/>external contract"]
    EB --> BR["multi-window burn-rate alerts<br/>→ Observability — alerting"]
    EB --> POL["error budget policy:<br/>ship or freeze?"]
    POL --> DEL["canary, deploy freeze<br/>→ Cloud-native — delivery"]
    POL --> PM["postmortem over 20% of budget<br/>→ Incident response"]
```

**Palette components:** [`metrics`](../../../reference/components/observability/index.md#metrics) (the SLI is a ratio of request counters) · [`alerting`](../../../reference/components/observability/index.md#alerting) (multi-window burn-rate rules) · [`apigw`](../../../reference/components/edge/index.md#apigw) (where BoxOffice measures the purchase SLI) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (consumer lag, the early warning of the ticket-delivery freshness SLI) · [`payment`](../../../reference/components/external/index.md#payment) (its 99.9% caps the purchase SLO). **Scenarios:** `observability-stack`, `flash-sale` (the event-scoped on-sale SLO). **Continues in:** [Observability — alerting](../alerting/index.md), [Observability — incident response](../incident-response/index.md), [Estimation — availability math](../../estimation/availability-math/index.md), [Cloud-native — delivery](../../cloud-native/delivery/index.md), [Hands-on 8 — SLO and burn-rate alert](../../../hands-on/8/slo/index.md).

---

[^1]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/books/){target="_blank"}. O'Reilly, 2016. Chapter 3, "Embracing Risk"; chapter 4, "Service Level Objectives".
[^2]: BEYER, B. et al. [The Site Reliability Workbook](https://sre.google/workbook/table-of-contents/){target="_blank"}. O'Reilly, 2018. Chapter 2, "Implementing SLOs"; chapter 5, "Alerting on SLOs".
[^3]: [AWS Service Level Agreements](https://aws.amazon.com/legal/service-level-agreements/){target="_blank"}; [Google Cloud Service Level Agreements](https://cloud.google.com/terms/sla){target="_blank"}; [Azure Service Level Agreements](https://www.microsoft.com/licensing/docs/view/Service-Level-Agreements-SLA-for-Online-Services){target="_blank"}.
