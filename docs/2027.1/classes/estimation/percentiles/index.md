
The BoxOffice dashboard says the seat-map endpoint has an **average latency of 55 ms**. Everyone is happy — except the fans, who complain on social media that the seat map "takes forever" during on-sales. Both are right. The average is 55 ms; but one request in a hundred takes more than half a second, and a fan who opens the seat map, refreshes it, zooms into two sections and tries three holds makes enough requests to hit one of those slow ones almost every visit. This page is about the slow requests: how to measure them, why they matter more than the average suggests, and why they get **worse** as systems become more distributed.

---

## Why averages lie

Latency distributions are not bell curves. Most requests are fast and similar; a minority — hitting a cache miss, a garbage-collection pause, a lock, a retry, a cold connection — are much slower. The result is a **long tail** to the right. The plot shows a synthetic but realistic distribution for 100,000 requests: 97% are "normal" (around 40 ms) and 3% hit a slow path (around 400 ms):

```python exec="1" html="1"
from io import StringIO

import matplotlib.pyplot as plt
import numpy as np

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "axes.edgecolor": "#888",
                     "xtick.color": "#888", "ytick.color": "#888", "font.size": 10})

rng = np.random.default_rng(42)
fast = rng.lognormal(mean=np.log(40), sigma=0.35, size=97_000)   # normal requests
slow = rng.lognormal(mean=np.log(400), sigma=0.6, size=3_000)    # cache misses, GC pauses, retries
ms = np.concatenate([fast, slow])

marks = [("p50", np.percentile(ms, 50), "#10b981", "right"),
         ("mean", ms.mean(), "#a855f7", "left"),
         ("p99", np.percentile(ms, 99), "#f59e0b", "left"),
         ("p99.9", np.percentile(ms, 99.9), "#ef4444", "left")]

fig, ax = plt.subplots(figsize=(8, 4.2))
ax.hist(ms, bins=np.logspace(np.log10(10), np.log10(5000), 120), color="#3b82f6", alpha=0.7)
ax.set_xscale("log")
ax.set_yscale("log")
for i, (name, value, color, side) in enumerate(marks):
    ax.axvline(value, color=color, lw=2)
    x = value * (0.94 if side == "right" else 1.06)
    ax.text(x, 10 ** (3.9 - 0.5 * i), f"{name} = {value:.0f} ms", color=color,
            fontweight="bold", ha=side)
ax.set_xlabel("ms (log)")
ax.set_ylabel("requests (log)")
ax.grid(alpha=0.2)
for side in ("top", "right"):
    ax.spines[side].set_visible(False)
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

The **mean** (about 55 ms) describes no actual request: it is pulled up by the tail, yet it hides how bad the tail is. The **median** says what a typical request experiences. The **p99** and **p99.9** say what the unlucky requests experience — and they are roughly 12× and 28× slower than the median (≈ 510 ms and ≈ 1.1 s vs ≈ 40 ms). A dashboard that shows only the average would never reveal that.

---

## Percentiles

The **p-th percentile** (written pXX) of a set of latencies is the value below which XX% of them fall[^1]:

| Percentile | Meaning | Also called | What it tells you |
|---|---|---|---|
| **p50** | half the requests are faster | median | the typical experience |
| **p90**, **p95** | 90% / 95% are faster | — | the common "slow-ish" experience |
| **p99** | 99% are faster; 1 in 100 is slower | "two nines" tail | the experience of the unlucky — and of heavy users |
| **p99.9** | 1 in 1,000 is slower | "three nines" tail | rare but real; dominates when requests fan out |
| **max** | the slowest one seen | p100 | outliers; noisy, but worth a look |

To compute a percentile exactly, sort the values and take the one at position ⌈p × n⌉ (the *nearest-rank* method): with 1,000 requests, p99 is the 990th fastest. In production, systems do not store every latency; they record **histograms** — counts of requests per latency bucket (0–5 ms, 5–10 ms, …) — and estimate percentiles from the buckets. Prometheus histograms, HdrHistogram and OpenTelemetry exponential histograms all work this way ([class 10](../../observability/index.md)).

!!! warning "You cannot average percentiles"

    If server A has p99 = 100 ms and server B has p99 = 1,000 ms, the p99 of the fleet is **not** 550 ms; it depends on how many requests each served and on the shape of both distributions. The same is true across time: the average of 60 per-minute p99 values is not the p99 of the hour. To aggregate, **merge the histograms** (add the bucket counts) and compute the percentile from the merged histogram. Dashboards that average percentiles are among the most common — and most misleading — mistakes in monitoring.

### Why the tail matters more than "1%" suggests

1. **Users make many requests.** A fan's visit during an on-sale (event page, seat map, refreshes, holds, payment, confirmation) easily involves **50 requests**. The probability that *at least one* is slower than the p99 is $1 - 0.99^{50} \approx 39\%$. The "1% tail" is felt by **four in ten visits**.
2. **The slowest users are often the best customers.** Fans with many orders, organizers with large events, accounts with a lot of data — their requests do more work and land in the tail. Amazon famously set its internal latency targets at the **p99.9** for this reason[^2].
3. **The tail is where overload starts.** As the [queueing](../queueing/index.md) curves show, the p99 rises long before the mean when a component approaches saturation. It is the earliest warning you get.

---

## Tail amplification under fan-out

Modern backends rarely answer a request with a single call. The BoxOffice seat-map page calls `inventory` (availability), `catalog` (venue layout and prices), `order` (the fan's existing tickets) and a recommendations service, in parallel; the search service queries **20 index shards** in parallel and merges the results. A request that **fans out** to N backends in parallel is as slow as the **slowest** of them.

If each backend call is slow (above its p99) with probability q = 1%, independently, the probability that the user request waits for at least one slow call is:

$$
P(\text{user request is slow}) = 1 - (1 - q)^N
$$

| Fan-out N | q = 1% (backend p99) | q = 0.1% (backend p99.9) |
|---|---|---|
| 1 | 1% | 0.1% |
| 5 | 4.9% | 0.5% |
| 20 | 18% | 2% |
| 100 | **63%** | 9.5% |
| 500 | 99% | 39% |

```python exec="1" html="1"
from io import StringIO

import matplotlib.pyplot as plt
import numpy as np

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "axes.edgecolor": "#888",
                     "xtick.color": "#888", "ytick.color": "#888", "font.size": 10})

n = np.arange(1, 501)
fig, ax = plt.subplots(figsize=(8, 4.2))
for q, label, color in [(0.01, "q = 1% (p99)", "#ef4444"),
                        (0.001, "q = 0.1% (p99.9)", "#3b82f6"),
                        (0.0001, "q = 0.01% (p99.99)", "#10b981")]:
    ax.plot(n, 100 * (1 - (1 - q) ** n), color=color, lw=2.5, label=label)
for x in (10, 100):
    y = 100 * (1 - 0.99 ** x)
    ax.plot(x, y, "o", color="#ef4444")
    ax.annotate(f"N = {x}: {y:.0f}%", xy=(x, y), xytext=(x * 0.35, y + 9), color="#ef4444")
ax.set_xscale("log")
ax.set_xlim(1, 500)
ax.set_ylim(0, 100)
ax.set_xlabel("N (log)")
ax.set_ylabel("1 − (1 − q)ᴺ  (%)")
ax.grid(alpha=0.2)
ax.legend(frameon=False, loc="upper left")
for side in ("top", "right"):
    ax.spines[side].set_visible(False)
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

This is the central observation of Dean and Barroso's *The Tail at Scale*[^3]: with a fan-out of 100, a backend whose p99 is 1 second makes **63% of user requests** take more than 1 second. In a large distributed system, **the backend's tail becomes the user's median**. The more you split a system into parallel pieces (shards, microservices), the more the rare slowness of each piece dominates.

!!! example "BoxOffice — search across 20 shards"

    The search service splits the event index into 20 shards to keep each one small and fast. Each shard answers in 15 ms at p50 and 120 ms at p99 (a merge or a cache miss now and then). The user's search waits for all 20:

    - P(at least one shard above 120 ms) = 1 − 0.99²⁰ ≈ **18%** — so the **user-facing p82** is already ≥ 120 ms, and the user-facing p99 is driven by the shards' p99.9 or worse.
    - Halving the number of shards to 10 cuts that probability to ~10%, but makes each shard bigger and slower. Keeping 20 shards and **hedging** (below) is usually the better trade.

---

## Where the tail comes from

Tail latency is rarely caused by the "normal" code path. Typical causes[^3]:

| Source | Example | Mitigation |
|---|---|---|
| **Queueing** | a burst arrives while a server is busy | headroom (lower utilization), load balancing on least-loaded |
| **Shared resources** | noisy neighbours on the same host, disk or network | isolation, dedicated capacity for critical paths |
| **Garbage collection** | a JVM pauses for 200 ms | GC tuning, low-pause collectors, smaller heaps |
| **Background work** | database compaction, log rotation, backups | schedule off-peak, rate-limit background tasks |
| **Cache misses** | cold cache after deploy; rare keys | pre-warming, larger cache, request coalescing |
| **Retries and timeouts** | the first attempt times out at 1 s, the retry succeeds | well-tuned timeouts, hedging instead of waiting |
| **Cold starts** | a new container or serverless function initializes | warm pools, provisioned concurrency |
| **Slow dependencies** | the payment provider has a bad minute | timeouts, circuit breakers, async processing |

---

## Taming the tail

You cannot eliminate variability; you can design so that it does not reach the user.

- **Hedged requests**: send the request to one replica; if it has not answered within, say, the **p95** latency, send a second copy to another replica and use whichever answers first. Only ~5% of requests are duplicated, but the tail shrinks dramatically. Dean and Barroso report a Google case where hedging after 10 ms cut the p99.9 of a 1,000-key read from 1,800 ms to 74 ms with only 2% more requests[^3]. Hedge only **idempotent** reads.
- **Tied requests**: send to two replicas at once, each knowing about the other; the first to *start* processing cancels the other. Removes queueing variability at the cost of a little coordination.
- **Reduce fan-out**: fewer, larger partitions for latency-critical paths; precompute aggregates (a materialized seat-map summary instead of calling five services).
- **Degrade gracefully**: give each backend a deadline and return a **partial** answer — the seat map without the recommendations panel is still a seat map.
- **Take work off the critical path**: what does not need to finish before the response (e-mails, analytics, search indexing) goes to a queue.
- **Keep utilization low** on latency-critical components, and **isolate** them from batch work.

### Latency budgets

A user-facing target must be split across the components on the path. For BoxOffice checkout (p99 < 1.5 s):

| Step | Budget (p99) | Notes |
|---|---|---|
| Edge (CDN, WAF, gateway) | 50 ms | TLS termination near the user |
| `order` service logic | 50 ms | validation, idempotency check |
| `inventory` (confirm hold) | 100 ms | one transaction on the primary |
| `payment` → provider | 1,000 ms | the provider dominates; timeout at 1.2 s |
| Write order + outbox | 50 ms | one transaction |
| Slack | 250 ms | network variance, retries |
| **Total** | **1,500 ms** | — |

Summing p99s is pessimistic (they rarely all happen on the same request), which is exactly what you want in a budget. When a step exceeds its budget, you know whose problem it is. Each budget also sets that component's **timeout** — a timeout longer than the caller's whole budget protects nothing.

---

## Measuring percentiles honestly

Two traps make tail latency look better than it is:

- **Coordinated omission**: a load generator that sends the next request only after the previous one returns *stops sending* when the server stalls — so it never records the requests that *would* have arrived during the stall, and the tail disappears from the results. Use tools that keep a constant arrival rate (open model: k6's `constant-arrival-rate`, wrk2) and compare intended vs actual send times[^4]. [Class 15](../../performance/index.md) covers it in depth.
- **Measuring at the wrong place**: the server's own timer misses the time spent in the accept queue, the load balancer and the network. Measure where the user is (client-side, or at the edge), and compare with server-side numbers.

**Try it:** in the scale-out scenario, run the `load` profile and note the p50 and p99. Then use `chaos` at `low` to make one replica occasionally slow. Which percentile moves first? By how much does the p99 move compared with the p50?

<div class="sdp" data-scenario="scale-out" data-mode="compact" data-profile="load" data-chaos="low" data-height="500"></div>

??? question "Think first: SLO for the seat map"

    BoxOffice wants an SLO for the seat-map endpoint. Option A: "average latency < 100 ms". Option B: "99% of requests < 300 ms, measured at the gateway over 28 days". Which one, and why?

    **Answer**: **B**. It is stated as a percentile (it constrains the tail, which users feel), it has a threshold that matters to users, a measurement point (the gateway, closer to the user than the service) and a window. Option A can be met while 3% of requests take more than a second — exactly the complaint on social media. SLOs are developed in [class 9](../../reliability/index.md).

!!! tip "In the interview"

    Always state latency targets as **percentiles** ("p99 < 200 ms for reads"), and when your design fans out (sharded search, a page aggregating several services, scatter-gather), mention **tail amplification** and one mitigation: "with 20 shards, the slowest shard dominates, so I'd add hedged requests after the p95 and return partial results after a deadline." It shows you understand how distributed systems behave, not just how they are drawn.

!!! warning "Common pitfalls"

    - **Reporting averages** for latency — or SLOs on averages.
    - **Averaging percentiles** across servers or time windows instead of merging histograms.
    - **Ignoring fan-out**: the backend's p99 is not the user's p99 when one request makes many calls.
    - **Hedging non-idempotent requests**: duplicating a `POST /orders` duplicates the order.
    - **Coordinated omission** in load tests: the tail you do not measure is the tail you do not fix.

---

## How it connects { #how-it-connects }

``` mermaid
flowchart LR
    DIST["long-tailed latency"] --> PCT["p50, p99, p99.9<br/>from histograms"]
    PCT --> SLO["latency SLOs<br/>→ Reliability"]
    PCT --> OBS["merge histograms,<br/>never average → Observability"]
    FAN["fan-out N<br/>1 − (1 − q)ᴺ"] --> AMP["the backend tail becomes<br/>the common case (large N)"]
    DIST --> SRC["sources: GC, cache misses,<br/>cold starts, slow dependencies"]
    AMP --> TAME["hedging, partial results,<br/>less fan-out, headroom"]
    SRC --> TAME
    TAME --> BUD["latency budgets<br/>and timeouts → Reliability"]
    PCT --> CO["measure at the client,<br/>coordinated omission → Performance"]
```

**Palette components:** [`search`](../../../reference/components/compute/index.md#search) (20 shards: the fan-out tail) · [`app`](../../../reference/components/compute/index.md#app) (a page that aggregates several services; hedging to another replica) · [`cache`](../../../reference/components/storage/index.md#cache) (misses are a tail source) · [`serverless`](../../../reference/components/compute/index.md#serverless) (cold starts) · [`apigw`](../../../reference/components/edge/index.md#apigw) (where the SLO is measured) · [`payment`](../../../reference/components/external/index.md#payment) (the provider dominates the checkout budget) · [`metrics`](../../../reference/components/observability/index.md#metrics) (histograms, never averaged percentiles). **Scenarios:** `scale-out` (with `chaos`), `search-autocomplete`. **Continues in:** [Availability Math](../availability-math/index.md), [Reliability — SLOs](../../reliability/slo/index.md), [Reliability — timeouts](../../reliability/patterns/index.md#timeout), [Observability — signals](../../observability/signals/index.md), [Performance — load testing](../../performance/load-testing/index.md), [Hands-on 2](../../../hands-on/2/index.md).

## Key takeaways

- Latency distributions have **long tails**; the mean hides them — use **p50, p99, p99.9**.
- Percentiles come from **histograms**; aggregate by merging histograms, **never by averaging** percentiles.
- Users and heavy customers make many requests, so the "1% tail" touches a large share of **visits**.
- Under fan-out N, P(slow) = **1 − (1 − q)ᴺ**: with 20 calls the backend's p99 hits 18 % of user requests; from ~70 calls on, it is the user's median.
- Fight the tail with **hedging, partial results, less fan-out, headroom and async work**; split end-to-end targets into **latency budgets** and matching timeouts.

---

[^1]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2nd ed. O'Reilly. Chapter 2 (describing performance: response time percentiles and tail latency amplification).
[^2]: DeCANDIA, G. et al. Dynamo: Amazon's Highly Available Key-value Store. *SOSP*, 2007 (service-level agreements expressed at the 99.9th percentile).
[^3]: DEAN, J.; BARROSO, L. A. The Tail at Scale. *Communications of the ACM*, 56(2), 2013, pp. 74–80.
[^4]: TENE, G. *How NOT to Measure Latency*. Talk, Strange Loop, 2015.
