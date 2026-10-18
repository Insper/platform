# 3. Game Day

The patterns of step 2 were tested one at a time, by the person who wrote them, knowing what would
break. Real incidents are not like that. A **game day** is a rehearsed incident: a team injects
failures into a running system, *without telling the operators which ones*, and checks two
hypotheses at once — that the **system** degrades the way the design says, and that the **people**
notice, diagnose and mitigate in time. It is the practice side of
[chaos engineering](../../../classes/reliability/chaos/index.md).

## Roles (groups of 3–4)

| Role | Does | Must not |
|---|---|---|
| **Game master** | picks and injects the failures with Toxiproxy, keeps the clock | tell the others what was injected |
| **Operator(s)** | watches Grafana (lab 8) and the logs, diagnoses, mitigates | look at the game master's terminal |
| **Scribe** | writes the timeline: every observation and decision, with the time | fix anything |

Rotate roles between rounds, so that everyone operates once.

## Before you start

1. **Steady state.** Run `load/pay-under-chaos.js` with `DURATION=30m` and write down the normal
   values from the RED dashboard: `order` and `payment` rate, error %, p95. This is the baseline every
   experiment is compared with.
2. **Hypotheses.** For each experiment below, the team writes *before* injecting what it expects to see
   (e.g. "with `payment` +2 s, `order` p95 for `pay` stays under 1.5 s and `GET /orders/{id}` is
   unaffected").
3. **Blast radius and abort.** Only your laptop's BoxOffice. Abort condition: anything outside the
   experiment breaks (e.g. `catalog` errors). The abort button is one command:
   `curl -s -X POST localhost:8474/reset` (removes every toxic and re-enables every proxy).
4. **Detection.** The burn-rate alert from [lab 8](../../8/slo/index.md) watches only `catalog`.
   Add the same two rules for `order` (the lab 8 file with `catalog` replaced by `order`, shown
   below), then `docker compose restart otel-lgtm`: **Alerting → Alert rules** now lists four rules
   in the folder *BoxOffice*, all *Normal*, so that the operators can be paged.

??? example "infra/grafana/alerting/slo-order.yaml — the complete file"

    ``` yaml title="infra/grafana/alerting/slo-order.yaml"
    --8<-- "docs/2027.1/hands-on/9/code/infra/grafana/alerting/slo-order.yaml"
    ```

## The experiments

The game master picks three of these, in any order, 5–8 minutes each with recovery time in between:

| # | Injection (game master) | What a good system does | What a good operator does |
|---|---|---|---|
| 1 | `payment` +2 s latency | timeouts + breaker: fast `503`s on `pay`, `browse` unaffected | finds `payment` in the trace, sees the breaker open |
| 2 | `psp` black hole (`timeout` toxic, 0) | `payment` read timeout (2 s) fails calls; `order` breaker opens | follows the trace one hop further, to the provider |
| 3 | 40% `reset_peer` on `payment` | retries hide most errors; error rate rises only a little | notices retries in the metrics, does not panic |
| 4 | `payment` proxy disabled | breaker open, fast `503`, orders stay `PENDING_PAYMENT` | communicates "payments down, orders safe" |
| 5 | `db` paused (`docker compose pause db`) | everything slows; the SLO alert fires | identifies the shared dependency, not the symptom |
| 6 | 1 KB/s `bandwidth` on `payment` | slow responses hit the read timeout | distinguishes "slow" from "down" |

Injection commands:

``` shell title="scripts/game-day.sh"
--8<-- "docs/2027.1/hands-on/9/code/scripts/game-day.sh"
```

## During the round

The operators work as in a real incident (see the
[incident response class](../../../classes/observability/incident-response/index.md)): declare the
incident when an alert fires or a symptom is seen, assign an incident commander, diagnose with the
dashboard → trace → logs path, **mitigate first** (e.g. stop sending traffic to a broken path,
raise a timeout, scale), investigate later. The scribe records times in this format:

| Time | Who | Observation / decision |
|---|---|---|
| 10:02:10 | GM | (hidden) experiment 1 injected |
| 10:04:30 | Op | `order` p95 rising on the dashboard; no alert yet |
| 10:05:05 | Op | trace shows `payment` span ~2 s; breaker `OPEN` in actuator |
| … | | |

From the timeline you get the two numbers every incident review asks for: **time to detect**
(injection → first correct observation) and **time to mitigate** (injection → users no longer
affected).

## After: a blameless review

Write one review per round in `results/lab9-gameday.md`. *Blameless* means the review explains how
the system and the process allowed the outcome — never who is to blame.

``` markdown title="results/lab9-gameday.md (template)"
# Game day — round <n>

**Experiment:** <what was injected, when> · **Duration:** <mm:ss>
**Hypothesis:** <what we expected>
**Result:** <confirmed | refuted> — <one sentence>

## Impact
- Users affected: <which requests, how many, for how long> (from the RED dashboard)
- SLO budget spent: <% of the 28-day budget>

## Timeline
| Time | Event |
|---|---|

## Detection and mitigation
- Time to detect: <min> — how: <alert | dashboard | trace>
- Time to mitigate: <min> — how: <...>

## What went well / what was hard

## Action items
| Action | Type (prevent / detect / mitigate) | Owner |
|---|---|---|
```

!!! warning "Pitfalls"

    - **No hypothesis, no experiment.** Breaking things to "see what happens" teaches little; a
      refuted hypothesis is the valuable outcome.
    - **Start small.** Latency before outages, one dependency before two, a laptop before production.
    - **The abort button must work** before the first injection. Test `reset` first.
    - **Fix the action items.** A game day whose findings stay in a document will be repeated, with
      the same findings, by a real incident.

[Next: Measure it](../measure/index.md){ .md-button .md-button--primary }
