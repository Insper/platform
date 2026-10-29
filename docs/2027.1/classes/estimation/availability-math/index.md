
BoxOffice promises organizers that checkout will be available **99.95%** of the time. Every team proudly reports that its service runs at "three nines and a half" — gateway, auth, inventory, order, all at 99.95%. The payment provider's contract says 99.9%. And the checkout still calls the e-mail service synchronously to send the ticket. At the end of the month, checkout was available only **99.2%** of the time — almost six hours of failures — and no single team missed its target. This page is the arithmetic that predicts that result in advance, and shows the design moves that change it.

---

## Availability, MTTF and MTTR

**Availability** is the fraction of time — or of requests — in which a system does its job. Two ways of measuring it are common:

| Kind | Formula | Good for |
|---|---|---|
| **Time-based** | uptime / (uptime + downtime) | infrastructure, "is it up?" |
| **Request-based** | successful requests / valid requests | services; what users actually experience; the basis of SLOs[^2] |

For a component that alternates between working and being repaired, availability follows from two averages:

$$
A = \frac{\text{MTTF}}{\text{MTTF} + \text{MTTR}}
$$

- **MTTF** (*Mean Time To Failure*): how long it runs, on average, before failing.
- **MTTR** (*Mean Time To Recovery/Repair*): how long it takes, on average, to **detect, diagnose and restore** service.
- **MTBF** (*Mean Time Between Failures*) = MTTF + MTTR.

!!! example "BoxOffice — two ways to improve the inventory service"

    The inventory service fails about once a month (MTTF ≈ 720 h); each time, it takes 2 h until someone is paged, finds the problem and restarts it (MTTR = 2 h).

    A = 720 / 722 ≈ **99.72%**.

    - Make failures half as frequent (MTTF = 1,440 h): A = 1,440 / 1,442 ≈ 99.86%.
    - Detect the failure with a health check and replace the instance automatically in 2 minutes (MTTR ≈ 0.033 h): A = 720 / 720.033 ≈ **99.995%**.

    **Recovering faster is usually the cheaper lever.** Automation (health checks, automatic restarts, failover) attacks MTTR; testing and redundancy attack MTTF.

## The nines

Availability targets are quoted as a number of "nines". The table is computed for several **windows** — the same percentage allows different downtimes depending on the period it is measured over:

```python exec="1"
def human(seconds):
    for unit, size in (("d", 86400), ("h", 3600), ("min", 60)):
        if seconds >= size:
            return f"{seconds / size:.3g} {unit}"
    return f"{seconds:.3g} s"


windows = [("365.25 d", 365.25), ("30.44 d", 365.25 / 12), ("28 d", 28), ("7 d", 7), ("1 d", 1)]
targets = [0.9, 0.99, 0.995, 0.999, 0.9995, 0.9999, 0.99999, 0.999999]

print("| A | " + " | ".join(name for name, _ in windows) + " |")
print("|---|" + "---|" * len(windows))
for a in targets:
    cells = [human((1 - a) * days * 86400) for _, days in windows]
    print(f"| **{a * 100:.6g}%** | " + " | ".join(cells) + " |")
```

Each column header is the length of the window (a year of 365.25 days, an average month, 28 days, a week, a day); each cell is the **downtime allowed** in that window.

Each additional nine is a **10× reduction** in allowed downtime — and roughly a change in how the system must be operated:

| Target | Allowed per month | What it takes, roughly |
|---|---|---|
| 99% | ~7 h | one server, manual recovery, backups |
| 99.9% | ~44 min | redundancy, health checks, on-call humans, practiced recovery |
| 99.99% | ~4 min | automatic failover (humans are too slow to be in the loop), multi-zone, safe deploys (canary, instant rollback) |
| 99.999% | ~26 s | multi-region active-active, everything automated, extreme change discipline — very expensive |

A useful sanity check: at 99.99% you cannot afford **one** 5-minute incident per month. If your recovery procedure involves a human reading a dashboard, you are not a four-nines system.

!!! warning "Request-based numbers are big numbers"

    At 2,000 requests per second, "99.9% of requests succeed" still means **2 failed requests every second**, ~170,000 per day. Availability targets are about **rates**, never about "no errors" — 100% is neither achievable nor a sensible goal. The gap to 100% is the **error budget** ([class 9](../../observability/slo/index.md)).

---

## Components in series

When a request needs **every** component in a chain to work (a synchronous dependency chain), the system works only if all of them work. If failures are independent, availabilities **multiply**:

$$
A_{series} = a_1 \times a_2 \times \dots \times a_n = \prod_{i=1}^{n} a_i
$$

The chain is always **worse than its weakest link**, and every extra synchronous dependency lowers the ceiling. The plot shows $a^n$ for n identical components:

```python exec="1" html="1"
from io import StringIO

import matplotlib.pyplot as plt
import numpy as np

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "axes.edgecolor": "#888",
                     "xtick.color": "#888", "ytick.color": "#888", "font.size": 10})

n = np.arange(1, 31)
fig, ax = plt.subplots(figsize=(8, 4.2))
for a, color in [(0.999, "#ef4444"), (0.9995, "#f59e0b"), (0.9999, "#3b82f6"), (0.99999, "#10b981")]:
    ax.plot(n, 100 * a ** n, "o-", ms=3, color=color, lw=2, label=f"a = {a * 100:g}%")
ax.axhline(99.9, color="#888", ls=":", lw=1)
ax.text(1.3, 99.9, "99.9%", va="bottom")
ax.set_xlim(1, 30)
ax.set_ylim(97, 100.05)
ax.set_xlabel("n")
ax.set_ylabel("A = aⁿ (%)")
ax.grid(alpha=0.2)
ax.legend(frameon=False, loc="lower left")
for side in ("top", "right"):
    ax.spines[side].set_visible(False)
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

Ten components at 99.9% give 99.0%; thirty give 97.0%. A microservice architecture in which a request synchronously crosses ten services needs each of them to be **much** better than the target of the whole.

## Components in parallel

When **any one** of n redundant, independent components is enough (replicas behind a load balancer, a primary with a standby, two payment providers), the system fails only if **all** of them fail at the same time:

$$
A_{parallel} = 1 - \prod_{i=1}^{n} (1 - a_i) \qquad \text{(identical: } 1 - (1 - a)^n \text{)}
$$

| One replica | Two replicas | Three replicas |
|---|---|---|
| 99% | 1 − 0.01² = **99.99%** | 1 − 0.01³ = 99.9999% |
| 99.5% | 1 − 0.005² = 99.9975% | 1 − 0.005³ ≈ 99.99999% |

Redundancy turns mediocre components into very available systems — **if the failures are independent** (see below) and **if failover actually works** (the load balancer notices the failure and stops sending traffic, the standby really takes over).

### k-of-n: quorums

Some systems need **a majority** of replicas, not just one — consensus protocols and quorum-replicated databases ([class 3](../../distributed/index.md)). With 3 replicas of availability a, a 2-of-3 quorum is available when all 3 or exactly 2 are up:

$$
A_{2\text{-of-}3} = a^3 + 3a^2(1 - a)
$$

With a = 99%: 0.970299 + 0.029403 = **99.97%** — better than one node, worse than "any one of three" (99.9999%). The price of consistency is paid in availability, even in the arithmetic.

---

## BoxOffice checkout, computed

The checkout path, as described at the top of the page (availabilities are illustrative assumptions):

``` diagram-sim
flowchart LR
    fan([Fan]) --> edge["Edge + gateway<br/>99.99%"]
    edge --> auth["auth<br/>99.95%"]
    auth --> order["order<br/>99.95%"]
    order --> inv["inventory<br/>99.95%"]
    inv --> db[("inventory DB<br/>99.95%")]
    order --> pay["payment provider<br/>99.9%"]
    order --> mail["email (sync)<br/>99.5%"]
```

| Design | Calculation | Availability | Failures per 30 days |
|---|---|---|---|
| **Naive** (everything synchronous, in series) | 0.9999 × 0.9995⁴ × 0.999 × 0.995 | **99.19%** | ~5.8 h |
| **E-mail made asynchronous** (queue + worker; off the critical path) | 0.9999 × 0.9995⁴ × 0.999 | 99.69% | ~2.2 h |
| **+ second payment provider** (fail over when the first is down) | 0.9999 × 0.9995⁴ × (1 − 0.001²) | 99.79% | ~1.5 h |
| **+ every internal component at 99.99%** (replicas, automatic failover, safe deploys) | 0.9999⁵ × (1 − 0.001²) | **99.95%** | ~22 min |

Three lessons, in decreasing order of cost-effectiveness:

1. **Remove dependencies from the critical path.** Making the e-mail asynchronous gained more than any other single change — and cost almost nothing. If the user does not need it to finish *before* the response, it should not be in the chain.
2. **Add redundancy where a dependency is weak and critical.** A second payment provider turns a 99.9% dependency into an effectively 99.9999% one (if their failures are independent).
3. **Make each remaining link better than the target.** A chain of five components can only meet 99.95% if each is around 99.99%. This is the "**rule of the extra nine**": a service's critical dependencies should each be roughly one nine more available than the service itself[^1].

!!! tip "Soft dependencies are not in the chain"

    A dependency whose failure the service can **tolerate** — by serving a cached value, a default, or a partial page — does not multiply into the availability of the critical path. Recommendations, view counters and the AI assistant should all be *soft* dependencies of checkout: if they fail, checkout still works. Turning hard dependencies into soft ones (fallbacks, caches, async) is a design skill you will practise in [class 10](../../reliability/index.md).

---

## The independence assumption

All the formulas above assume that components fail **independently**. Real failures are often **correlated**, and correlation destroys the parallel formula:

- Two replicas on the **same host, rack or availability zone** go down together with it.
- Two replicas running the **same buggy release** crash on the same input.
- A **bad configuration** pushed everywhere at once breaks every replica at once.
- A shared dependency — the same DNS provider, the same certificate that expires, the same database — is a **single point of failure** hidden behind apparent redundancy.
- Overload: when one replica dies, its traffic moves to the others, which may then fail too (a cascading failure).

!!! example "BoxOffice — three replicas, one outage"

    The inventory service runs 3 replicas, each 99.5% available on its own: the parallel formula promises 1 − 0.005³ ≈ 99.99999%. In practice, the year's worst outage came from a release with a connection-pool misconfiguration, deployed to all three replicas within 2 minutes. All three failed together, for 40 minutes, until the rollback. **The redundancy did not help, because the failure was not independent.** The fixes are not more replicas, but *diversity in time and space*: canary deploys (one replica first, watch, then the rest), replicas spread across zones, and fast rollback (lower MTTR).

Designing for independence — separate failure domains (zones, regions), staged rollouts, no hidden shared dependencies — is as important as adding replicas.

---

## Detection and failover time

Redundancy only helps after the failure is **detected** and traffic is **moved**. If a load balancer checks health every 10 s and needs 3 consecutive failures to mark a replica down, users hit the failed replica for up to ~30 s each time. With frequent small failures this matters:

$$
\text{downtime per year} \approx \text{failures per year} \times (\text{detection time} + \text{failover time})
$$

Ten failovers a year at 30 s + 30 s each is 10 minutes: fine for 99.99% (52 minutes per year), but it consumes a fifth of the budget. Faster health checks, client-side retries to another replica, and connection draining reduce it.

**Try it.** In the `scale-out` scenario one `catalog` replica crashes at t = 80 s, and nothing tells the load balancer: it keeps sending that replica its share of the traffic for ~30 s. First give the design enough capacity to survive the loss — click `catalog` and raise its replicas to **5** — and press **Run**: watch the error rate from t = 80 s on. Then open it in the full playground (↗), add a **Health Check**, connect it to the load balancer, and run again.

<div class="sdp" data-scenario="scale-out" data-mode="compact" data-height="520"></div>

??? question "What should you have observed?"

    With 5 replicas and no health check, one request in five goes to the dead replica: about **20% of the requests fail from t ≈ 81 s to t ≈ 110 s**, about 4% of the whole 3-minute run. With the health check, the replica is out in 3 s: errors last from t ≈ 81 s to 83 s and the run ends at about **0.4%** — the same failure, a tenth of the damage, exactly as *downtime ≈ failures × detection time* predicts. With the 2 replicas as drawn, detection is not the first problem: the two replicas are overloaded before the crash (ρ > 1), and losing one halves the capacity again.

!!! example "In the BoxOffice code: passive health checks and a retry (lab 3)"

    The Nginx edge of [Hands-on 3](../../../hands-on/3/index.md) detects failures **passively**, from real requests: 3 failures within 10 s take a replica out of rotation for 10 s, and `proxy_next_upstream` retries the failed request once on another replica, so the fan does not see the error. The lab measured both kinds of failure under 150 req/s: a **stopped** replica cost almost nothing (the connection is refused at once and retried elsewhere); a **frozen** one cost the read timeout — no errors in 14,990 requests, but p99 = 1 s and max = 5.05 s, the `proxy_read_timeout`. Detection time is paid in errors when nobody retries, and in latency when someone does.

    ``` { .nginx title="infra/nginx/nginx.conf (detection and retry)" }
    --8<-- "docs/2027.1/hands-on/3/code/infra/nginx/nginx.conf:19:26,56:60"
    ```

??? question "Think first: is a second region worth it?"

    BoxOffice runs in one region with three availability zones. The provider's documentation suggests that a full-region outage is rare, but when it happens it can last hours. A second region (active-passive, with DNS failover) would roughly double infrastructure cost. How would you decide?

    **Answer sketch**: estimate the **expected cost of downtime** versus the cost of the second region. If a region outage of ~4 h happens about once every two years (an assumption to validate with your provider's history), the expected downtime is ~2 h/year — almost half of the ~4.4 h/year that a 99.95% target allows, before any other incident. Then consider *when* it happens: a region outage during a stadium on-sale costs the business far more than one at 4 a.m. on a Tuesday. If the SLA with organizers carries penalties, or one lost on-sale costs more than a year of a second region, it is worth it — and then the hard part is the data (class 3 and class 10), not the servers.

!!! tip "In the interview"

    When you draw a high-level design, do the series calculation **out loud** for the critical path: "the request crosses five components; at 99.9% each that is about 99.5%, so to promise 99.9% overall I need redundancy in each and I'd take the e-mail off the path." Then mention correlated failures — "replicas in different zones, canary deploys" — which shows you know where the formulas stop being true. Quote downtime with a window: "four nines is about four minutes a month".

!!! success "Best practices"

    - **Draw the critical path and compute its availability before promising an SLO** — multiply the links; if the product is below the promise, change the design, not the promise's wording. In BoxOffice: the checkout chain on this page.
    - **Automate detection and recovery** — health checks every few seconds, automatic restarts, a retry on another replica; MTTR is the cheap lever. In BoxOffice: `max_fails` and `proxy_next_upstream` in lab 3's `nginx.conf` (box above), and the gateway's health check every 5 s in [lab 4](../../../hands-on/4/gateway/index.md).
    - **Drill failover on a schedule and time it** — kill a replica or a primary in a test environment and measure detection + failover against the budget. In BoxOffice: step 5 of [Hands-on 3](../../../hands-on/3/index.md) (stop and pause a replica) and the game day of lab 9.
    - **Track the error budget, not just uptime** — 99.95% of requests over 28 days is about 20 minutes of total failure; spend it on purpose (releases, experiments), not by accident.
    - **Give every dependency a timeout and a fallback** — a timeout bounds how long a weak dependency can hurt; a fallback keeps it soft. In BoxOffice: the 1 s read timeout of `order → payment` in lab 9.

!!! warning "Common pitfalls"

    - **Quoting a target without a window**: 99.9% is 43.8 min per average month but 40.3 min per 28 days.
    - **Ignoring the chain**: each team meets its target and the product misses its own.
    - **Assuming independence**: replicas in the same zone, on the same release, behind the same DNS.
    - **Counting redundancy without failover**: a standby that is never tested is not redundancy.
    - **Chasing nines everywhere**: different paths deserve different targets; five nines for the recommendations widget is wasted money.

---

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    MT["A = MTTF / (MTTF + MTTR)"] --> NINES["nines over a window<br/>→ Reliability SLOs"]
    SER["series: ∏ aᵢ"] --> CHAIN["critical path: edge, auth,<br/>order, inventory, provider"]
    CHAIN --> ASYNC["move deps off the path<br/>queue + worker → Messaging"]
    PAR["parallel: 1 − ∏(1 − aᵢ)"] --> RED["replicas,<br/>a second provider"]
    QUO["k-of-n quorums<br/>→ Distributed"] --> RED
    RED --> IND["independent? zones,<br/>releases, config"]
    IND --> DR["multi-AZ, multi-region<br/>→ Reliability"]
    MT --> DET["detection + failover time<br/>health checks"]
    DET --> RED
```

**Palette components:** [`lb`](../../../reference/components/edge/index.md#lb) · [`healthcheck`](../../../reference/components/observability/index.md#healthcheck) (detection time = interval × failures to mark down) · [`app`](../../../reference/components/compute/index.md#app) (replicas in parallel, if failures are independent) · [`sql`](../../../reference/components/storage/index.md#sql) (primary + standby with automatic failover) · [`payment`](../../../reference/components/external/index.md#payment) (a 99.9% dependency; a second provider) · [`email`](../../../reference/components/external/index.md#email) (moved off the critical path) · [`queue`](../../../reference/components/messaging/index.md#queue) · [`worker`](../../../reference/components/compute/index.md#worker) (the asynchronous path) · [`dns`](../../../reference/components/edge/index.md#dns) (multi-region failover). **Scenarios:** `scale-out`, `multi-region`, `payment-system`, `notification-system`. **Continues in:** [Distributed — consensus](../../distributed/consensus/index.md) (quorums), [Observability — SLOs](../../observability/slo/index.md), [Reliability — multi-AZ and multi-region](../../reliability/disaster-recovery/index.md#multi-region), [Compute — provider outages](../../compute/integrations/index.md#provider-outages), [Exercise: design doc](../../../exercises/design-doc/index.md).

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - A = **MTTF / (MTTF + MTTR)**; reducing MTTR through automation is often the cheapest lever.
    - Each nine is **10× less downtime**; always state the **window**.
    - **Series** multiplies (worse than the weakest link); **parallel** gives 1 − ∏(1 − aᵢ); quorums lie in between.
    - Improve a chain by **removing hard dependencies** from the critical path, adding **redundancy** to weak links, and making each link ~**one nine better** than the target.
    - The formulas assume **independent** failures; correlated failures (same zone, same release, same config) are what actually take systems down.

---

[^1]: TREYNOR, B.; DAHLIN, M.; RAU, V.; BEYER, B. The Calculus of Service Availability. *ACM Queue*, 15(2), 2017.
[^2]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/books/){target="_blank"}. Google / O'Reilly, 2016. Chapter 3 (embracing risk).
