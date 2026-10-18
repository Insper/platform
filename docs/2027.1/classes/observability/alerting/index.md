
An alert is a request for a human's attention, often at 3 a.m. That makes it the most expensive signal in the system: it costs sleep, focus and, over time, trust. Two failure modes kill alerting. **Too many alerts** — "CPU above 80%" on every pod, every blip of every dependency — and the on-call engineer learns to ignore the pager; the real incident drowns in the noise. **Too few, or the wrong ones** — and the first person to notice the broken checkout is a fan on social media. This page is about alerts that fire when, and only when, users are being hurt enough that someone must act.

---

## What deserves a page

A good page is **urgent**, **actionable**, and about a **user-visible** problem[^1]. If any of the three is missing, it should be something else:

| Situation | Urgent? | Actionable? | Users affected? | Destination |
|---|---|---|---|---|
| Checkout failing for 5% of fans during an on-sale | yes | yes | yes | **page** the on-call |
| Error budget burning slowly: will run out in 10 days | no | yes | a little | **ticket** for the team, this week |
| Disk of the Kafka broker will be full in 4 days at this rate | no | yes | not yet | **ticket** |
| One of 30 `catalog` pods restarted and recovered | no | no | no | **dashboard / log** only |
| CPU at 85% while all SLIs are fine | no | no | no | nothing — or a capacity review |
| The alerting pipeline itself is broken | yes | yes | indirectly | page (via a *dead man's switch*, below) |

### Symptoms, not causes

Alert on **symptoms** — what users experience: errors, latency, freshness, correctness. Use **causes** — CPU, memory, a pod restart, a full queue — for dashboards and diagnosis, not for pages.

| | Symptom-based alert | Cause-based alert |
|---|---|---|
| Example | "checkout success ratio below SLO" | "PostgreSQL CPU > 90%" |
| Fires when users are fine? | no | often (high CPU, happy users) |
| Misses real problems? | rarely — whatever the cause, users feel it | often — the failure you did not predict has no alert |
| Number of rules | few, per user journey | many, per component and resource |
| Tells you where to look? | no — that is what dashboards and traces are for | yes, but only for known failure modes |

The exception is a **leading indicator** that will certainly become a symptom and gives time to act — a disk filling up, a certificate expiring in 7 days. Those are tickets, not pages, unless the deadline is hours away.

---

## From the SLO to the alert

The [SLO](../../reliability/slo/index.md) already says how much failure is acceptable: with **99.9% of checkouts succeeding over a rolling 28-day window** (the window used throughout [Reliability](../../reliability/slo/index.md)), the error budget is 0.1% of checkouts. The question an alert must answer is therefore not "are there errors?" — there always are — but "**are we spending the budget fast enough to be in trouble?**".

The natural measure is the **burn rate**:

$$
\text{burn rate} = \frac{\text{error ratio observed over a window}}{1 - \text{SLO}}
$$

A burn rate of 1 spends exactly the whole budget in the whole window; a burn rate of 14.4 spends it 14.4 times faster. If a burn rate $b$ is sustained for a time $t$, the fraction of the budget consumed is

$$
\text{budget consumed} = \frac{b \cdot t}{\text{SLO window}}
$$

```python exec="true"
WINDOW_H = 28 * 24          # 28-day SLO window, in hours
SLO = 0.999
print("| Burn rate | Error ratio (SLO 99.9%) | Budget exhausted in | Budget spent in 1 h | in 6 h |")
print("|---:|---:|---:|---:|---:|")
for b in [1, 2, 3, 6, 14.4, 36, 1000]:
    err = b * (1 - SLO)
    hours = WINDOW_H / b
    when = f"{hours / 24:,.1f} days" if hours >= 48 else (f"{hours:,.1f} h" if hours >= 1 else f"{hours * 60:,.0f} min")
    print(f"| {b:g}× | {min(err, 1):.2%} | {when} | {min(b / WINDOW_H, 1):.1%} | {min(6 * b / WINDOW_H, 1):.1%} |")
```

A burn rate of 1000× is a total outage (100% errors against a 0.1% budget): the whole 28-day budget is gone in about 40 minutes. That is why fast alerts must fire within minutes — and why slow burns can wait for office hours.

### Six ways to write the alert

The SRE Workbook[^2] compares six progressively better designs for an SLO alert. Their quality is measured by four properties: **precision** (fraction of alerts that were real problems), **recall** (fraction of real problems that alerted), **detection time** and **reset time** (how long the alert keeps firing after the problem ends).

| # | Rule | Precision | Recall | Detection | Reset | Problem |
|---|---|---|---|---|---|---|
| 1 | error ratio > 0.1% over 10 min | low | high | fast | fast | pages for blips that barely touch the budget |
| 2 | error ratio > 0.1% over 36 h | high | high | **very slow** | **very slow** | a total outage takes ~2 min to alert, and the alert lasts 36 h |
| 3 | rule 1 + `for: 1h` | medium | **low** | slow | fast | a 100% outage still waits an hour |
| 4 | burn rate 14.4× over 1 h | high | medium | good | slow | slow burns (3×) never alert; reset takes up to an hour |
| 5 | several burn rates (14.4× / 6× / 1×) | high | high | good | slow | complex; still slow to reset |
| 6 | **multiwindow, multi-burn-rate** | high | high | good | **fast** | the most rules — generate them with a tool |

### Multiwindow, multi-burn-rate

The recommended design combines, for each severity, a **long window** that proves the burn is significant and a **short window** (1/12 of the long one) that proves it is *still happening* — so the alert stops quickly once the problem is fixed:

| Severity | Long window | Short window | Burn rate | Budget spent when it fires |
|---|---|---|---|---|
| **page** | 1 h | 5 min | 14.4× | 2% |
| **page** | 6 h | 30 min | 6× | 5% |
| **ticket** | 3 days | 6 h | 1× | 10% |

The plot shows the detection time for a sudden failure of a given error ratio, for the two paging rules. Note the trade-off it encodes: the worse the incident, the faster the alert — and for a given rule, the budget spent at the moment it fires is always the same (2% and 5%).

```python exec="1" html="1"
import io
import numpy as np
import matplotlib.pyplot as plt

BUDGET = 0.001
err = np.logspace(np.log10(0.002), 0, 300)          # error ratio from 0.2% to 100%

def detection_minutes(long_window_min, burn):
    threshold = burn * BUDGET
    t = long_window_min * threshold / err           # average over the window reaches the threshold
    return np.where(err >= threshold, np.maximum(t, 0.0), np.nan)

fig, ax = plt.subplots(figsize=(8, 4))
ax.plot(err * 100, detection_minutes(60, 14.4), label="page: 14.4× over 1 h (+5 min)", color="tomato", lw=2)
ax.plot(err * 100, detection_minutes(360, 6), label="page: 6× over 6 h (+30 min)", color="steelblue", lw=2)
ax.set_xscale("log")
ax.set_yscale("log")
ax.set_xlabel("error ratio of the incident (%)")
ax.set_ylabel("time to fire (minutes)")
ax.set_title("SLO 99.9% — how fast the burn-rate alerts fire")
ax.grid(True, which="both", alpha=0.25)
ax.legend()
fig.patch.set_alpha(0)
ax.set_facecolor("none")
plt.tight_layout()
buf = io.StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close(fig)
```

A total outage (100% errors) fires the fast rule in under a minute; an incident failing 2% of checkouts takes about 43 minutes to fire the fast rule, and one failing 0.7% never fires it, but fires the 6-hour rule after about 5 hours. Below 0.6% — a burn rate under 6× — only the ticket rule catches it.

### The rules in PromQL

Recording rules precompute the error ratio of the checkout journey over each window; the alert rules compare them with the thresholds. (Tools such as Sloth, Pyrra or the OpenSLO specification generate these rules from a short SLO definition, which avoids copy-paste mistakes.)

```yaml
# prometheus-rules.yaml — checkout availability SLO: 99.9% over 28 days
groups:
  - name: slo-checkout-recordings
    rules:
      - record: slo:checkout_errors:ratio_rate5m
        expr: |
          sum(rate(http_server_request_duration_seconds_count{job="order", http_route="/checkout", http_response_status_code=~"5.."}[5m]))
          /
          sum(rate(http_server_request_duration_seconds_count{job="order", http_route="/checkout"}[5m]))
      - record: slo:checkout_errors:ratio_rate1h
        expr: |
          sum(rate(http_server_request_duration_seconds_count{job="order", http_route="/checkout", http_response_status_code=~"5.."}[1h]))
          /
          sum(rate(http_server_request_duration_seconds_count{job="order", http_route="/checkout"}[1h]))
      # ... the same expression for 30m, 6h and 3d

  - name: slo-checkout-alerts
    rules:
      - alert: CheckoutErrorBudgetFastBurn
        expr: |
          slo:checkout_errors:ratio_rate1h > (14.4 * 0.001)
          and
          slo:checkout_errors:ratio_rate5m > (14.4 * 0.001)
        labels:
          severity: page
          team: checkout
        annotations:
          summary: "Checkout is burning its 28-day error budget at more than 14.4x"
          runbook_url: "runbooks/checkout-slo.md"
      - alert: CheckoutErrorBudgetSlowBurn
        expr: |
          slo:checkout_errors:ratio_rate6h > (6 * 0.001)
          and
          slo:checkout_errors:ratio_rate30m > (6 * 0.001)
        labels:
          severity: page
          team: checkout
      - alert: CheckoutErrorBudgetTicket
        expr: |
          slo:checkout_errors:ratio_rate3d > (1 * 0.001)
          and
          slo:checkout_errors:ratio_rate6h > (1 * 0.001)
        labels:
          severity: ticket
          team: checkout
```

A **latency SLO** works the same way: the "bad events" are the requests slower than the threshold, computed from the histogram bucket that ends at the threshold:

```promql
# fraction of checkouts slower than 2 s over 1 h (the "error ratio" of a latency SLO)
1 - (
  sum(rate(http_server_request_duration_seconds_bucket{job="order", http_route="/checkout", le="2"}[1h]))
  /
  sum(rate(http_server_request_duration_seconds_count{job="order", http_route="/checkout"}[1h]))
)
```

!!! example "BoxOffice — the 10:00 on-sale, through the alert's eyes"

    At 10:02 the payment provider slows down; at 10:03 the checkout error ratio (timeouts returned as `504`) reaches 4%. That is a burn rate of 40×: the fast rule's 1-hour average crosses 1.44% after about 60 × 1.44 / 4 ≈ 22 minutes of a constant 4%… far too slow for an on-sale that is over in 30 minutes. The team therefore adds a **dedicated on-sale SLO** with a shorter window (for example 99% of checkouts under 2 s during the on-sale hour, alerting on 5-minute and 1-minute windows) — the general rules are tuned for a 28-day budget and cannot react to an event that lasts half an hour. Different journeys, different SLOs.

---

## Routing: from a firing rule to a person

An alert rule only produces a *firing alert*. Something must decide **who** hears about it, **how**, and **how often**. In the Prometheus ecosystem this is **Alertmanager**[^3] (Grafana Alerting has the same concepts): it **groups** related alerts into one notification, **deduplicates** them, applies **inhibitions** and **silences**, and **routes** them by labels to receivers.

``` mermaid-sim
flowchart LR
    R["Rule evaluation<br/>Prometheus / Mimir ruler"] --> F["Firing alert<br/>severity=page, team=checkout"]
    F --> G["Alertmanager<br/>group · dedupe"]
    G --> S{"Silenced or<br/>inhibited?"}
    S -->|yes| X["Dropped<br/>(still visible in the UI)"]
    S -->|no| RT{"Route by labels"}
    RT -->|severity=page| PD["Pager<br/>on-call phone"]
    RT -->|severity=page| SL["Slack #incidents"]
    RT -->|severity=ticket| TK["Ticket queue"]
    PD --> ACK["On-call acknowledges<br/>or escalates after 5 min"]
```

```yaml
# alertmanager.yaml (sketch)
route:
  receiver: slack-observability          # default for anything unmatched
  group_by: [alertname, team]
  group_wait: 30s                        # wait to batch related alerts into one notification
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - matchers: [severity="page"]
      receiver: pager-checkout
      continue: true                     # also evaluate the next route
    - matchers: [severity="page"]
      receiver: slack-incidents
    - matchers: [severity="ticket"]
      receiver: ticket-queue

inhibit_rules:
  - source_matchers: [alertname="RegionDown"]
    target_matchers: [severity=~"page|ticket"]
    equal: [region]                      # one page for the region, not fifty for its services

receivers:
  - name: pager-checkout
    pagerduty_configs:
      - routing_key_file: /etc/alertmanager/secrets/pager-checkout
  - name: slack-incidents
    slack_configs:
      - api_url_file: /etc/alertmanager/secrets/slack-incidents
        channel: "#incidents"
  - name: slack-observability
    slack_configs:
      - api_url_file: /etc/alertmanager/secrets/slack-observability
        channel: "#observability"
  - name: ticket-queue
    webhook_configs:
      - url: http://ticket-bridge:8080/alerts
```

| Mechanism | What it does | BoxOffice use |
|---|---|---|
| **Grouping** | many alerts with the same labels → one notification | 40 `order` pods failing → one page, not 40 |
| **Inhibition** | an alert suppresses others while it fires | `RegionDown` silences the per-service alerts of that region |
| **Silence** | mute matching alerts for a period, with an author and a reason | planned database maintenance on Tuesday 02:00–03:00 |
| **Escalation** (in the paging tool) | if not acknowledged in N minutes, page the secondary, then the manager | primary asleep or out of signal |

### Who watches the watcher?

If Prometheus or Alertmanager is down, nothing alerts — and silence looks exactly like health. Two standard protections:

- A **dead man's switch**: a rule that *always* fires (`expr: vector(1)`, often named `Watchdog`), sent to an external service that pages if the heartbeat **stops** arriving.
- **Absent data** alerts: `absent(up{job="order"})` or `absent_over_time(...)` fire when a metric disappears — a crashed exporter, a renamed metric, a job that stopped being scraped.

For journeys with little traffic at night, a ratio of zero requests is undefined; **synthetic probes** (a k6 or Blackbox Exporter check that buys a test ticket on a fake event every minute) keep the SLI meaningful at any hour.

---

## Runbooks

Every page must link a **runbook**: a short document that tells a tired engineer what the alert means and what to try first. Runbooks reduce MTTR because the first 10 minutes stop being improvisation.

```markdown
# CheckoutErrorBudgetFastBurn

**Meaning**: checkout is failing at more than 14.4x the rate the 99.9% SLO allows;
at this pace the 28-day budget is gone in about 2 days.

**Impact**: fans cannot buy tickets. During an on-sale, declare an incident immediately (SEV1).

**First checks (5 minutes)**
1. Checkout dashboard: which status codes? which route? since when? any deploy or flag change?
2. Payment provider panel: latency and error ratio of the provider call.
3. Open an exemplar trace of a failed checkout: which span fails or waits?

**Mitigations**
- Recent deploy → roll back (`argocd app rollback order`).
- Provider slow or failing → switch to the secondary provider (flag `payment.provider=secondary`).
- Database saturated → enable the waiting room (flag `waiting-room.enabled=true`).

**Escalate to**: payments team (secondary on-call), then the incident commander rotation.
```

---

## Trade-offs

| Decision | Option A | Option B | Guidance |
|---|---|---|---|
| What to alert on | causes (CPU, restarts) | symptoms (SLO burn) | symptoms page; causes go to dashboards and tickets |
| Thresholds | static error ratio | burn rate against the SLO | burn rate — the threshold follows the business target |
| Windows | one window | long + short window | multiwindow: precise *and* resets quickly |
| Sensitivity | page early (more false alarms) | page late (more budget lost) | tune to the budget: fast burns page, slow burns ticket |
| Notification | everything to Slack | page / ticket / dashboard by severity | a channel everyone mutes is no alerting at all |

!!! tip "In the interview"

    When the interviewer asks "how would you know if this is broken?", answer with an **SLO and its burn-rate alert**, not with a list of metrics: *"Checkout SLO 99.9% over 28 days; page when the 1-hour burn rate exceeds 14.4× confirmed by the 5-minute window, ticket for slow burns; every alert links a runbook."* Mention that you alert on **symptoms** and use dashboards and traces for causes, and that a dead man's switch protects the alerting pipeline itself. That is a senior-level answer in four sentences.

!!! warning "Common pitfalls"

    - **Paging on causes**: CPU, memory and restarts wake people up for nothing and train them to ignore the pager.
    - **`for: 1h` to reduce noise**: it also delays the page for a total outage by an hour; use burn rates instead.
    - **One SLO window for every situation**: a 28-day budget cannot protect a 30-minute on-sale; give critical events their own SLO.
    - **Alerts without runbooks or owners**: the alert fires, nobody knows what to do, the incident lasts longer.
    - **No dead man's switch**: the monitoring stack dies silently, and silence looks like health.
    - **Never deleting alerts**: review every page after the shift — if it was not actionable, fix it or delete it.

## How it connects { #how-it-connects }

``` mermaid
flowchart LR
    SLO["SLO 99.9% over 28 days<br/>→ Reliability: SLOs"] --> BUD["error budget 0.1%"]
    SLI["SLI from metrics<br/>(RED, histograms)"] --> BR["burn rate =<br/>error ratio ÷ budget"]
    BUD --> BR
    BR --> MW["multiwindow rules:<br/>14.4× and 6× page, 1× ticket"]
    MW --> AM["Alertmanager: group,<br/>inhibit, silence, route"]
    AM --> PAGE["page + runbook"]
    AM --> TK["ticket"]
    PAGE --> IR["Incident Response"]
    DMS["dead man's switch,<br/>absent(), synthetic probes"] --> AM
    MW -.-> ONS["on-sale SLO,<br/>short windows"]
```

**Palette components:** [`alerting`](../../../reference/components/observability/index.md#alerting) · [`metrics`](../../../reference/components/observability/index.md#metrics) (the SLI and the recording rules) · [`payment`](../../../reference/components/external/index.md#payment) (the slow provider that burns the on-sale budget) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (a broker disk filling up: a ticket, not a page). **Scenarios:** `observability-stack`, `flash-sale` (a 30-minute on-sale needs its own SLO). **Continues in:** [Reliability — SLOs](../../reliability/slo/index.md) (SLI, SLO, error budget policy), [Incident Response](../incident-response/index.md), [Cloud-native — delivery](../../cloud-native/delivery/index.md) (rollbacks named in the runbook), [Hands-on 8 — SLO and burn-rate alert](../../../hands-on/8/slo/index.md).

---

## Key takeaways

- A page must be **urgent, actionable and user-visible**; everything else is a ticket, a dashboard, or nothing.
- Alert on **symptoms** derived from the **SLO**; causes are for diagnosis.
- **Burn rate** = observed error ratio ÷ error budget; with a 28-day window, 14.4× spends about 2% of the budget in an hour (14.4 ÷ 672 h).
- Use **multiwindow, multi-burn-rate** rules: 14.4× (1 h + 5 min) and 6× (6 h + 30 min) page, 1× (3 d + 6 h) opens a ticket.
- **Alertmanager** groups, deduplicates, inhibits, silences and routes; a **dead man's switch** and **absent()** alerts watch the watcher.
- Every alert has an **owner** and a **runbook**.

---

[^1]: EWASCHUK, R. *My Philosophy on Alerting*. Google, 2013. Its rules are summarized in BEYER, B. et al. [Site Reliability Engineering — Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/){target="_blank"}. O'Reilly, 2016. Chapter 6.
[^2]: BEYER, B. et al. [The Site Reliability Workbook — Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/){target="_blank"}. O'Reilly, 2018. Chapter 5.
[^3]: PROMETHEUS. [Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/){target="_blank"} and [Alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/){target="_blank"}.
