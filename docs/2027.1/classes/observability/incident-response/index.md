
10:03, Saturday. The phone of the on-call engineer vibrates: `CheckoutErrorBudgetFastBurn`. Two million fans are in the waiting room, the payment provider is answering in seconds, and the company's social media is already lighting up. What happens in the next thirty minutes decides whether this becomes a bad morning or a news story. Good telemetry tells you *what* is wrong; it does not decide *who* does *what*, *who* talks to the outside world, or *when* you stop investigating and start mitigating. That is incident response — a practice borrowed from firefighters and emergency services, adapted to software[^1].

---

## What counts as an incident

An **incident** is an unplanned event that degrades or threatens a service users depend on, and that needs a **coordinated** response. Not every alert is an incident; an incident is declared when the response needs more than one person working the normal way. **Severity levels** make that decision fast and consistent — nobody should debate the definition at 3 a.m.

| Severity | Criteria (BoxOffice) | Example | Response |
|---|---|---|---|
| **SEV1** | core journey down or badly degraded for many users; data loss or security breach; any on-sale affected | checkout failing for 10% of fans during an on-sale | page immediately, incident commander, status page, updates every 15–30 min |
| **SEV2** | significant degradation, workaround exists, or a non-core journey down | search returns stale results; e-mails delayed by 1 h | page the owning team, incident channel, internal updates |
| **SEV3** | minor impact, few users, no deadline pressure | the seat map is slow for one venue | ticket, fix in working hours |
| **SEV4** | no user impact yet; a near miss | a certificate expiring in 7 days | ticket |

!!! tip "Declare early, downgrade freely"

    Declaring an incident is cheap; declaring it late is expensive. A SEV1 that turns out to be a SEV3 costs a few people twenty minutes. A SEV3 that was really a SEV1 costs an on-sale. Make "declare and downgrade later" the norm, and never punish anyone for declaring.

---

## On-call

**On-call** means a named person is responsible, for a period, for responding to pages for a set of services. It is a production requirement, not a heroic act, and it must be sustainable.

- **Rotations**: a **primary** and a **secondary** (escalation if the primary does not acknowledge within a few minutes), usually week-long shifts with a written **handoff** — open issues, risky deploys, silences in place.
- **Follow-the-sun**: teams in different time zones split the day so nobody is paged at night; it needs at least two sites.
- **Sustainable load**: Google's SRE practice caps on-call work so that engineers spend most of their time on engineering, and aims for at most about **two incidents per 12-hour shift** — an incident takes hours of follow-up, not just the response[^2]. More than that means the alerting or the system needs work, not more stamina.
- **You build it, you run it**: the team that owns a service carries its pager. It is the strongest incentive to build operable software.
- **Preparation**: runbooks, access already granted (never "I'm waiting for production access"), dashboards bookmarked, and practice in **game days** ([Chaos engineering](../../reliability/chaos/index.md)).

---

## The incident lifecycle

``` mermaid-sim
stateDiagram-v2
    [*] --> Detected : alert, customer report, or engineer notices
    Detected --> Triaged : on-call acknowledges, assesses impact
    Triaged --> Declared : severity set, commander and channel assigned
    Triaged --> Closed : false alarm or no impact (tune the alert)
    Declared --> Mitigating : stop the bleeding
    Mitigating --> Monitoring : impact gone, SLIs recovering
    Monitoring --> Mitigating : impact returns
    Monitoring --> Resolved : stable, root fix scheduled
    Resolved --> Reviewed : blameless postmortem, action items
    Reviewed --> [*]
    Closed --> [*]
```

Each transition has a timestamp, and the gaps between them are the metrics that matter:

| Metric | From → to | Improved by |
|---|---|---|
| **MTTD** — mean time to detect | impact starts → someone knows | SLO burn-rate alerts, synthetic probes |
| **MTTA** — mean time to acknowledge | page → human on it | sane paging load, escalation policies |
| **MTTM** — mean time to mitigate | impact starts → users no longer affected | runbooks, rollbacks, feature flags, generic mitigations |
| **MTTR** — mean time to resolve / recover | impact starts → resolved | all of the above, plus fast diagnosis (traces) |

Users only feel **impact**: the time until **mitigation** is the number that shapes availability (recall from [Reliability](../../reliability/index.md) that availability = MTTF / (MTTF + MTTR)). The root cause can be fixed on Monday.

---

## Roles

The most common way an incident goes wrong is not a missing tool — it is five engineers debugging the same thing in parallel, nobody deciding, and nobody telling customers what is going on. The **Incident Command System** (ICS), created for wildfire response in the 1970s, solved this with explicit roles; Google, PagerDuty and others adapted it to software[^1][^3].

| Role | Does | Does **not** |
|---|---|---|
| **Incident Commander (IC)** | owns the incident: sets severity, assigns roles, decides (rollback? failover?), keeps the timeline moving, declares the end | debug — the IC's attention is on the whole response |
| **Operations / Tech lead** | leads the investigation and mitigation; the only one changing production (or coordinating who does) | talk to customers |
| **Communications lead** | internal updates on a cadence, status page, support and business stakeholders | speculate about causes in public |
| **Scribe** | records the timeline: what was seen, decided, changed — with timestamps | filter what "looks bad" |
| **Subject-matter experts** | join when called (payments, database, network) | start parallel, uncoordinated changes |

In a small team, one person can hold several roles; the IC and the operations lead should still be different people whenever possible. Roles are handed over **explicitly** ("I am now IC") when shifts change or the incident escalates.

Play the first fifteen minutes of the flash-sale incident:

``` mermaid-sim
sequenceDiagram
    autonumber
    participant AM as Alertmanager
    participant OC as On-call (primary)
    participant IC as Incident commander
    participant OPS as Ops lead (payments)
    participant COM as Comms lead
    participant ST as Status page
    AM->>OC: page: CheckoutErrorBudgetFastBurn
    OC->>OC: ack, open dashboard: 504s on /checkout, on-sale live
    OC->>IC: declare SEV1, open channel inc-onsale-0313
    IC->>OPS: you lead mitigation, payments on-call joins
    IC->>COM: you own updates, every 15 min
    COM->>ST: "Some fans see errors at checkout. We are working on it."
    OPS->>OPS: exemplar trace: 7.9 s in payment pool.acquire
    OPS->>IC: provider slow, propose switch to secondary provider
    IC->>OPS: approved, go
    OPS->>OPS: flag payment.provider=secondary, waiting room throttled
    OPS->>IC: error ratio back under 0.5%, p99 1.4 s
    IC->>COM: mitigated, monitoring
    COM->>ST: "Checkout is working again. Monitoring."
```

---

## Mitigate first

During an incident the goal is to **stop the impact**, not to understand it. Understanding comes later, with the postmortem — and is much easier once the pressure is gone. The best mitigations are **generic**: they work regardless of the exact cause, and they are rehearsed in advance.

| Mitigation | When | BoxOffice example | Prerequisite |
|---|---|---|---|
| **Roll back** | a change preceded the impact (the most common case) | revert `order` 1.4.2 → 1.4.1 | fast, tested rollbacks; deploy annotations on dashboards |
| **Turn off a feature flag** | a new feature misbehaves | disable "seat upgrade suggestions" | features behind flags |
| **Fail over / drain** | one zone, region or provider is bad | switch to the secondary payment provider; drain `sa-east-1a` | a tested secondary and the switch documented |
| **Shed load** | demand exceeds capacity | throttle the waiting room admission rate | a waiting room / rate limiter in place |
| **Scale out** | saturation, the code is fine | more `inventory` replicas, bigger connection pool *if* the DB can take it | headroom, autoscaling limits known |
| **Block bad traffic** | abusive bots or an attack | WAF rule for the scalper ASN | WAF and rate limits at the edge |
| **Degrade gracefully** | a non-critical dependency fails | hide recommendations, keep checkout | fallbacks designed in |

!!! warning "Do not debug in production during the incident unless it mitigates"

    "Let me add a log line and redeploy to understand" turns a 15-minute incident into a 2-hour one. If a mitigation is available, take it; if not, investigate with the telemetry you already have. Every change during an incident goes through the operations lead and into the timeline.

### Communication

Silence during an incident is read as incompetence or indifference. Updates have a **fixed cadence** (for a SEV1, every 15–30 minutes) even when there is nothing new, and a fixed shape:

```text
[SEV1] Checkout errors during the 10:00 on-sale — update #3, 10:21
Impact:   since 10:02, ~12% of checkout attempts failed; fans in the waiting room were not affected.
Status:   MITIGATED at 10:14 — traffic moved to the secondary payment provider.
Next:     monitoring until 10:45; the primary provider is investigating on their side.
Next update: 10:45 or earlier if anything changes.
IC: @ana   Ops: @bruno   Comms: @carla
```

Outside the company, the status page states **impact and progress**, never internal names, guesses or blame ("our provider failed").

---

## The BoxOffice incident, by the numbers

| Time | Event | Metric |
|---|---|---|
| 10:00 | on-sale opens | |
| 10:02 | the payment provider slows down; the payment pool saturates; checkouts start failing | impact starts |
| 10:03 | fast-burn page fires | **MTTD ≈ 1 min** |
| 10:04 | on-call acknowledges | **MTTA ≈ 1 min** |
| 10:06 | SEV1 declared, IC and roles assigned | |
| 10:11 | exemplar trace shows time inside `pool.acquire`; switch proposed | |
| 10:14 | secondary provider active, waiting room throttled; errors back to normal | **MTTM ≈ 12 min** |
| 10:40 | stable, incident resolved | **MTTR ≈ 38 min** |

What did it cost in SLO terms? With illustrative numbers — 200 checkout attempts per second during the on-sale and an average of 12% failures for the 12 minutes of impact:

$$
200 \times 720\ \text{s} \times 0.12 \approx 17\,300 \text{ failed checkouts}
$$

If BoxOffice handles about 2 million checkouts in a normal 28-day window (the SLO window used in [Reliability](../../reliability/slo/index.md)), a 99.9% SLO allows **2,000** failures. This one incident spent more than eight 28-day budgets — over seven months' worth — in twelve minutes. The [error budget policy](../../reliability/slo/index.md) now applies: feature work on checkout pauses until the reliability action items are done. That is the error budget doing its job — turning one bad morning into a funded engineering priority.

---

## Postmortems

A **postmortem** (also called *incident review* or *retrospective*) is a written analysis of an incident, done after it is resolved, with one goal: **reduce the chance and the impact of the next one**. Write one for every SEV1/SEV2, any data loss, any significant budget spend — and for interesting near misses.

### Blameless

A postmortem is **blameless**[^4]: it assumes everyone acted reasonably given what they knew at the time, and it asks *how the system made the mistake easy*, not *who made it*. This is not about being nice. If people are punished for honest accounts, they stop giving them, and the organisation loses the only accurate source of information about how its systems really fail. "The engineer ran the wrong command" becomes "the tool allowed a destructive command against production without confirmation, and the runbook showed it next to a harmless one".

### Root cause — or contributing factors?

Complex systems rarely fail for **one** reason; incidents need several factors lining up[^5]. In the BoxOffice incident:

- the provider slowed down (external trigger, outside BoxOffice's control);
- the payment adapter had **no timeout** shorter than the provider's own, and a pool of 20 connections shared by every call;
- the secondary provider existed, but switching was a manual, undocumented step;
- the general 28-day SLO alerts were not designed for a 30-minute on-sale;
- the load test before the on-sale used a provider mock that always answered in 100 ms.

Asking "five whys" down a single chain would have stopped at "the provider was slow" — the one factor BoxOffice cannot fix. Looking for **all** contributing factors finds four that it can.

### Template

```markdown
# Postmortem: checkout errors during the 13 March on-sale (SEV1)

**Status**: final · **Authors**: … · **Reviewed**: …

## Summary
Two to four sentences: what happened, impact, how it was mitigated.

## Impact
Users affected, duration, failed checkouts, revenue and SLO budget consumed, support tickets.

## Timeline (UTC-3)
10:02 provider latency rises … 10:03 page … 10:14 mitigated … 10:40 resolved.

## Contributing factors
Technical, process and organisational factors — no names, no blame.

## What went well / what went poorly / where we got lucky

## Action items
| Action | Type (prevent / detect / mitigate) | Owner | Due | Ticket |
|---|---|---|---|---|
| Timeout 800 ms + bulkhead on the provider client | prevent | payments | 27/03 | PAY-312 |
| Automatic failover to the secondary provider | mitigate | payments | 10/04 | PAY-313 |
| On-sale SLO with 1 min / 5 min burn-rate alerts | detect | SRE | 20/03 | OBS-88 |
| Provider latency injected in the pre-sale load test | prevent | performance | 27/03 | PERF-41 |
```

Action items are the only part of a postmortem that changes anything. Each one is **specific**, has **one owner** and a **date**, and is tracked like any other work. A postmortem whose actions are never done is a story, not a fix.

### Closing the loop

- **Review meeting**: the authors walk the team through the document; questions are about the system, not the people.
- **Share widely**: other teams have the same pool, the same missing timeout.
- **Look for trends**: many incidents from deploys → invest in canaries and rollbacks ([Delivery](../../cloud-native/delivery/index.md)); many from one dependency → bulkheads and fallbacks.
- **Practice**: turn the incident into a **game day** scenario — inject provider latency with Toxiproxy and check that the new timeout, breaker and alert behave ([Hands-on 9](../../../hands-on/9/index.md)).
- **Measure delivery health**: the DORA metrics *change failure rate* and *failed deployment recovery time*[^6] show whether incidents caused by changes are becoming rarer and shorter.

!!! note "AI assistants in incident response"

    In 2026 many teams use LLM-based assistants to summarise the incident channel into a draft timeline, suggest queries, or search past postmortems for similar incidents. They are useful scribes and search tools. They are not incident commanders: an assistant can produce a confident but wrong root cause, so every claim must be checked against the telemetry, and decisions stay with the humans in the roles above.

---

## Trade-offs

| Decision | Option A | Option B | Guidance |
|---|---|---|---|
| Who carries the pager | central ops team | the team that builds the service | "you build it, you run it", with a central SRE team for platforms and coaching |
| When to declare | only when sure | early, downgrade later | early — declaring is cheap |
| During the incident | find the root cause | mitigate first | mitigate first; understand afterwards |
| Postmortem tone | find who erred | blameless, system-focused | blameless — it is the only way to get accurate accounts |
| Analysis | single root cause (5 whys) | contributing factors | contributing factors; complex failures have several |

!!! tip "In the interview"

    Interviews rarely ask "how do you run an incident?" directly, but they often ask "**what happens when X fails?**" A strong answer covers three layers: *how the system degrades* (timeouts, fallbacks, waiting room), *how you find out* (SLO burn-rate alert, before customers tell you), and *how you recover* (a generic mitigation — failover, rollback, flag — that is documented and tested). In behavioural interviews, a well-told incident story — your role, how you mitigated, what the postmortem changed — is one of the strongest signals of real experience (see [Interview preparation](../../../support/interview/index.md)).

!!! warning "Common pitfalls"

    - **No incident commander**: everyone debugs, nobody decides, nobody communicates.
    - **Investigating before mitigating**: users keep suffering while the team understands a problem a rollback would have stopped.
    - **Silent incidents**: no updates for an hour; support and business invent their own story.
    - **Blameful postmortems**: people hide what they did, and the real contributing factors stay hidden.
    - **Action items without owners or dates**: the same incident happens again next on-sale.
    - **Unsustainable on-call**: too many pages burn people out, and tired people make the next incident worse.

## How it connects { #how-it-connects }

``` mermaid
flowchart LR
    AL["burn-rate page<br/>→ Alerting"] --> TRI["triage: severity<br/>SEV1 to SEV4"]
    TRI --> ROLES["IC, ops lead,<br/>comms lead, scribe"]
    ROLES --> MIT["mitigate first"]
    MIT --> RB["rollback, flag off<br/>→ Cloud-native delivery"]
    MIT --> FO["failover, shed load,<br/>degrade → Reliability"]
    MIT --> BLK["block bad traffic<br/>→ Edge (WAF)"]
    MIT -->|"timestamps"| MTT["MTTD, MTTM, MTTR<br/>→ availability"]
    MTT --> BUD["error budget spent<br/>→ SLO policy"]
    MIT --> PM["blameless postmortem,<br/>action items"]
    PM --> GD["game day<br/>→ Chaos engineering"]
```

**Palette components:** [`alerting`](../../../reference/components/observability/index.md#alerting) (the page that starts it) · [`tracing`](../../../reference/components/observability/index.md#tracing) (the exemplar trace that found `pool.acquire`) · [`payment`](../../../reference/components/external/index.md#payment) (failover to the secondary provider) · [`queue`](../../../reference/components/messaging/index.md#queue) (the waiting room, throttled to shed load) · [`waf`](../../../reference/components/edge/index.md#waf) (blocking abusive traffic) · [`app`](../../../reference/components/compute/index.md#app) (rollback or scale-out of a service). **Scenarios:** `flash-sale` (the on-sale incident), `cascading-failure` (a slow provider without timeouts). **Continues in:** [Reliability](../../reliability/index.md) (availability = MTTF / (MTTF + MTTR)), [Reliability — SLOs](../../reliability/slo/index.md), [Reliability — chaos engineering](../../reliability/chaos/index.md), [Cloud-native — delivery](../../cloud-native/delivery/index.md) (rollbacks, canaries, DORA), [Project — game day](../../../exercises/project/game-day/index.md), [Interview preparation](../../../support/interview/index.md).

---

## Key takeaways

- An **incident** needs coordination; **severity levels** with clear criteria make declaring fast — declare early, downgrade freely.
- On-call must be **sustainable**: primary/secondary, handoffs, runbooks, and a page load that leaves time for engineering.
- Measure **MTTD, MTTA, MTTM, MTTR**; users feel the time to **mitigation**.
- Roles — **incident commander**, ops lead, comms lead, scribe — prevent chaos; the IC coordinates and does not debug.
- **Mitigate first** with generic, rehearsed mitigations (rollback, flag, failover, shed load); communicate on a fixed cadence.
- **Blameless postmortems** look for all **contributing factors** and produce owned, dated **action items**; the loop closes with game days.

---

[^1]: BEYER, B. et al. [Site Reliability Engineering — Managing Incidents](https://sre.google/sre-book/managing-incidents/){target="_blank"}. O'Reilly, 2016. Chapter 14.
[^2]: BEYER, B. et al. [Site Reliability Engineering — Being On-Call](https://sre.google/sre-book/being-on-call/){target="_blank"}. O'Reilly, 2016. Chapter 11.
[^3]: PAGERDUTY. [Incident Response Documentation](https://response.pagerduty.com/){target="_blank"}.
[^4]: ALLSPAW, J. [Blameless PostMortems and a Just Culture](https://www.etsy.com/codeascraft/blameless-postmortems){target="_blank"}. Etsy Code as Craft, 2012. See also *Site Reliability Engineering*, chapter 15 — Postmortem Culture.
[^5]: COOK, R. I. [How Complex Systems Fail](https://how.complexsystems.fail/){target="_blank"}. Cognitive Technologies Laboratory, University of Chicago, 1998.
[^6]: DORA. [DORA's software delivery metrics](https://dora.dev/guides/dora-metrics-four-keys/){target="_blank"}. Google Cloud.
