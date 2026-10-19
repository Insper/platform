# 3. SLO and Burn-Rate Alert

A dashboard needs someone looking at it. An **alert** looks for you — and a bad alert wakes you up at
3 a.m. for nothing, until you learn to ignore it. This step turns a user-facing promise into an alert
that fires when, and only when, the promise is at risk. The theory is in the
[alerting class](../../../classes/observability/alerting/index.md) and the
[SLO class](../../../classes/reliability/slo/index.md).

## From promise to numbers

| Term | BoxOffice `catalog` |
|---|---|
| **SLI** (indicator) | share of `catalog` requests, health checks excluded, **not** answered with a 5xx |
| **SLO** (objective) | 99.5% over a rolling 28 days (the course standard window: four whole weeks) |
| **Error budget** | 0.5% of the requests may fail: at 100 req/s, 100 × 86 400 × 28 × 0.005 ≈ **1.21 million** failed requests, or about **202 minutes** of total outage per 28 days |
| **Burn rate** | how fast the budget is being spent, relative to "exactly on budget": `error ratio / 0.005` |

A burn rate of **1** spends the whole budget in exactly 28 days. A burn rate of **14.4** spends about 2.1% of
it in one hour (14.4 × 1 h / 672 h ≈ 2.1%) and all of it in less than two days. (The thresholds 14.4 and 6
come from the Google SRE workbook, which derived them for a 30-day window: 2% and 5% of the budget;
with 28 days they mean 2.1% and 5.4% — close enough to keep the standard numbers.)

??? question "Why exclude `/actuator/*` from the SLI?"

    Docker, Kubernetes and the edge call the health endpoints every few seconds, and those calls
    almost never fail. Counting them inflates the success ratio with requests no user made — the SLI
    must measure what **fans** experience. The same reasoning excludes synthetic load you generate
    yourself from production SLIs, unless it is labeled and filtered.

## Why "error rate > 1%" is a bad alert

| Alert | Problem |
|---|---|
| `errors > 1%` for 5 min | fires on a 5-minute blip that cost about 0.01% of the budget (noise), and stays silent on a 0.8% error rate that burns the whole budget in 17.5 days (missed) |
| `errors > 0` | pages all the time |
| `p99 > 1 s` on one instance | measures a machine, not users |

The Google SRE workbook's answer is the **multiwindow, multi-burn-rate** alert: page when the budget
burns fast over a **long** window (it is a real problem, not a blip) **and** over a **short** window
(it is still happening — the alert stops soon after recovery).

| Severity | Burn rate | Long window | Short window | Budget spent when it fires |
|---|---|---|---|---|
| page | 14.4 | 1 h | 5 min | ≈ 2.1% |
| page | 6 | 6 h | 30 min | ≈ 5.4% |
| ticket | 1 | 3 days | 6 h | ≈ 10.7% |

This lab provisions the first rule as a **page** and the second as a **ticket** (a slower, cheaper
signal for a smaller team); the third is left as an exercise.

## The rules, as code

Grafana loads alert rules from YAML files in its provisioning folder (mounted in
[step 1](../instrument/index.md) from `infra/grafana/alerting/`). Each rule runs queries **A** and
**B** — the burn rate over the two windows — and a math expression **C** that is the condition.

``` yaml title="infra/grafana/alerting/slo-catalog.yaml"
--8<-- "docs/2027.1/hands-on/8/code/infra/grafana/alerting/slo-catalog.yaml"
```

Restart `otel-lgtm` and open **Alerting → Alert rules**: both rules are listed in the folder
*BoxOffice* as *Normal*.

## Fire it

Produce steady traffic, then break the database that `catalog` depends on:

<!-- termynal -->

``` shell
> k6 run -e RATE=50 -e DURATION=10m load/catalog-otel.js &
> sleep 60 && docker compose stop db && date +%T
10:12:31
> # watch Alerting → Alert rules: Normal → Pending → Firing
> docker compose start db
```

??? question "Predict: how long until the fast-burn rule fires?"

    During the outage every `catalog` request fails, so the short (5 min) burn rate jumps to about
    1 / 0.005 = 200 within a minute. The long window is the slow one: the 1-hour error ratio must pass
    14.4 × 0.5% = **7.2%**. With steady traffic and an hour of healthy history, that takes
    0.072 × 60 min ≈ **4.3 minutes** of outage; add the `for: 1m` and up to 30 s of evaluation
    interval: **≈ 5–6 minutes** to page. (If the stack has been up for less than an hour, the window
    holds less healthy history and the alert fires sooner.)

    That is the trade-off of burn-rate alerts: a total outage takes minutes to page; a persistent 4%
    error rate (burn rate 8) is caught by the 6-hour rule once the 6-hour ratio passes 6 × 0.5% = 3%,
    after about 6 h × 3/4 = 4.5 hours; and a 30-second blip never pages.

In a test run of this lab (with less than an hour of history), the rule became *Firing* **288 s**
after `db` was stopped, with the description *"burn rate 18.2 (1 h) and 74.4 (5 min)"*.

Record in your results the time you stopped `db`, the time the rule became *Pending* and *Firing*,
and the burn rates shown in the alert's description.

!!! warning "Pitfalls"

    - **No traffic, no SLI.** Division by zero yields no data; `noDataState: OK` keeps a quiet night
      quiet, but a service that receives no traffic because the edge is down looks "healthy". Pair SLO
      alerts with a synthetic probe or an alert on traffic dropping to zero.
    - **Alert on symptoms, investigate causes.** CPU, heap and pool panels are for the dashboard; the
      page is about users. A full disk that does not hurt users yet is a ticket, not a page.
    - **Every page needs a runbook link** (an `annotations.runbook_url`) saying what to check first —
      see the [incident response class](../../../classes/observability/incident-response/index.md).

## Exercise: a latency SLO

Write a third rule for the promise "95% of `GET /catalog/events/{id}` complete in under 250 ms".
Hint: the SLI is the ratio of the `le="0.25"` bucket rate to the `_count` rate for that route; the
budget is 5%. Fire it by adding latency (in [lab 9](../../9/index.md) you will use Toxiproxy for
exactly this).

[Next: Measure it](../measure/index.md){ .md-button .md-button--primary }
