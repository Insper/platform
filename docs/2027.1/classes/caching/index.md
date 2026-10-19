It is 09:59 on the day a stadium show goes on sale. BoxOffice has 60,000 seats to sell and about 2 million fans with the event page open, pressing F5. At 10:00 the `catalog` service receives tens of thousands of `GET /events/42` requests per second, and each one runs the same three SQL queries: the event, the venue, the price table. The data has not changed in a week. Still, the catalog database reaches 100% CPU, queries that took 3 ms now take 800 ms, and the **checkout** — which shares that database — starts timing out. Nobody bought a ticket yet, and the system is already down.

The fix is not a bigger database. It is to stop asking the database the same question two million times. That is **caching**: keeping a copy of the answer to an expensive question in a place that is faster and cheaper to read, and serving the copy for as long as it is good enough.

!!! abstract "Learning objectives"

    By the end of this class you should be able to:

    - **Explain** why caches work (locality and skewed popularity) and **identify** the layers where a request can be cached, from the browser to the database buffer pool.
    - **Calculate** the effective latency and the database load for a given hit ratio, and **size** a cache for a working set.
    - **Compare** cache-aside, read-through, write-through, write-behind, write-around and refresh-ahead, and **choose** one for each kind of BoxOffice data.
    - **Design** an invalidation strategy (TTL, explicit delete, versioned keys, change data capture) and **select** an eviction policy.
    - **Diagnose** cache failure modes — stampede, avalanche, penetration, hot keys, cache outage — and **apply** the matching fix.
    - **Use** Redis data structures and **reason** about Redis persistence, replication and Cluster hash slots.

## Roadmap

1. **This overview** — why caching works, where caches live, hit-ratio math, sizing and what never to cache.
2. [Caching Patterns](patterns/index.md) — cache-aside, read-through, write-through, write-behind, write-around, refresh-ahead; key design.
3. [Invalidation & Eviction](invalidation/index.md) — TTLs, explicit invalidation, the cache-aside race, CDC, LRU/LFU/W-TinyLFU.
4. [Failure Modes](failure-modes/index.md) — cold cache, stampede, avalanche, penetration, hot keys, the cache going down.
5. [Redis](redis/index.md) — data structures, atomicity, persistence, replication, Redis Cluster, managed offerings.
6. [Quiz](quiz.md) — check your understanding.

## Slides

<div class="slides-embed">
  <iframe src="slides/caching.html" title="Slides: caching" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/caching.html){:target="_blank"}

---

## Why caching works

A cache is a bet: *the data I read now will be read again soon*. Two properties of real workloads make that bet pay off.

- **Temporal locality** — something read recently is likely to be read again. A fan who opened the event page will refresh it a dozen times before 10:00.
- **Skewed popularity** — a small fraction of the items receives most of the requests. BoxOffice lists 100,000 events, but on a Friday night a few hundred of them (the big shows, this weekend's games) take almost all the traffic.

Popularity on the web follows, approximately, a **Zipf-like distribution**: the item of rank $i$ is requested with probability proportional to $1/i^{s}$, where $s$ (the *skew*) is typically between 0.6 and 1 for web objects[^1]. The higher $s$, the more concentrated the traffic, and the more a small cache helps.

??? question "Think first: how big must the cache be?"

    BoxOffice has 100,000 events. If popularity is Zipf with $s = 1$, what fraction of the requests would a cache holding only the 1,000 most popular events (1% of the catalog) answer?

    Around **60%**. With $s = 1$, the share of the top $k$ items out of $N$ is about $\ln k / \ln N = \ln 1000 / \ln 100000 \approx 0.6$. Holding 1% of the data absorbs well over half of the reads — the plot below shows this for several skews.

The second ingredient is the **latency gap** between storage layers. The numbers below are orders of magnitude — they vary with hardware and network, but the ratios between them are what matter[^2]:

| Operation | Order of magnitude | Relative to a RAM read |
|---|---|---|
| Read from main memory (RAM) | ~100 ns | 1× |
| Read 4 KB at random from an NVMe SSD | ~10–100 µs | ~100–1,000× |
| Round trip inside one data center | ~0.5 ms | ~5,000× |
| `GET` of a small key from Redis in the same data center (network included) | ~0.2–1 ms | ~2,000–10,000× |
| Indexed SQL query on a warm database (network included) | ~1–5 ms | ~10,000–50,000× |
| SQL query with joins on a busy database | ~10–100+ ms | ~100,000× and more |
| Round trip São Paulo ↔ US East coast | ~110–130 ms | ~1,000,000× |

A cache does not only make a read faster. It also **removes work from the system behind it**: every hit is a query that the database never sees. In most real systems that second effect — protecting the source of truth — is the reason the cache exists.

---

## Where caches live

A single BoxOffice request can be answered by six different caches before it reaches the database. Each layer is closer to the user (faster, cheaper per hit) but holds less, and is harder to invalidate.

``` mermaid-sim
flowchart LR
    U["Browser / app<br/>HTTP cache"] -->|"miss"| CDN["CDN edge<br/>static + public pages"]
    CDN -->|"miss"| GW["API gateway<br/>response cache"]
    GW -->|"miss"| APP["catalog service<br/>in-process cache"]
    APP -->|"miss"| R[("Redis<br/>distributed cache")]
    R -->|"miss"| DB[("PostgreSQL<br/>buffer pool + OS page cache")]
    DB -->|"row"| APP
    APP -->|"SET with TTL"| R
```

| Layer | What it caches | Typical TTL | Who invalidates | BoxOffice example |
|---|---|---|---|---|
| **Client** (browser, mobile app) | HTTP responses, images, scripts, using `Cache-Control`, `ETag` and conditional `If-None-Match` requests[^3] | seconds to a year (versioned assets) | the server, only through headers; you cannot delete a copy on a user's phone | `app.3f9a1c.js` cached for a year; event JSON with `max-age=10` |
| **CDN** (Content Delivery Network) | static assets, images, public pages at points of presence near the user | minutes to days | purge API, versioned URLs | event posters from the object store; the public event page |
| **API gateway / reverse proxy** | whole responses of public `GET` routes | seconds | short TTL; rarely explicit | `GET /events/42` cached for 5 s at the gateway during the on-sale |
| **In-process** (local, e.g. Caffeine in the JVM) | hot objects in the service's own heap | seconds to minutes | each replica separately (hard!) | venue and seat-map geometry, which almost never change |
| **Distributed cache** (Redis, Valkey, Memcached) | objects and query results shared by all replicas | seconds to hours | the application (delete on write) or TTL | event details, price tables, search results, sessions |
| **Database** (buffer pool, OS page cache) | data and index pages in RAM | managed by the engine (LRU-like) | the engine itself — always consistent | the `seats` index pages of tonight's events |

The deeper the layer, the more consistent it is: the database buffer pool can never return stale data, while a copy in the browser cannot be recalled at all. Choosing *where* to cache is therefore a choice about **how much staleness each kind of data tolerates** — the subject of [Invalidation & Eviction](invalidation/index.md). CDNs and HTTP caching are covered in depth in [Traffic & Edge](../edge/dns-cdn/index.md); this class focuses on the application side: in-process and distributed caches.

!!! info "Cache vs. buffer vs. replica"

    A **cache** keeps a *disposable* copy: losing it costs performance, never data. A **buffer** holds data in transit (for example, writes waiting to be flushed). A **read replica** ([Databases](../databases/index.md)) is a full, continuously updated copy of the database. If losing your "cache" loses data, it is not a cache — it is a database, and must be treated as one.

---

## Hit-ratio math

The **hit ratio** $h$ is the fraction of reads answered by the cache. Two formulas carry almost every caching decision.

**Effective latency** — the average time of a read:

$$
t_{\text{eff}} = h \cdot t_{\text{hit}} + (1 - h) \cdot t_{\text{miss}}
$$

where $t_{\text{miss}}$ includes the failed cache lookup *plus* the database query (and the write-back to the cache).

**Load on the database** — the reads that pass through:

$$
\text{QPS}_{\text{DB}} = (1 - h) \cdot \text{QPS}_{\text{total}}
$$

!!! example "Worked example — the event page at 10:00"

    The event page generates **50,000 reads per second**. A Redis hit costs 0.5 ms; a miss costs 0.5 ms (failed lookup) + 8 ms (database under load) = 8.5 ms.

    | Hit ratio | Effective latency | Reads reaching the DB |
    |---|---|---|
    | 0% (no cache) | 8.0 ms (if the DB survives) | 50,000 QPS |
    | 90% | 0.9 × 0.5 + 0.1 × 8.5 = **1.3 ms** | **5,000 QPS** |
    | 99% | 0.99 × 0.5 + 0.01 × 8.5 = **0.58 ms** | **500 QPS** |
    | 99.9% | ≈ 0.51 ms | **50 QPS** |

    Going from 90% to 99% looks like "9 points better". For the database it is **10× less load**. Think of the **miss ratio** $1-h$, not the hit ratio: each extra nine divides the load behind the cache by ten — *the last nines of hit ratio matter most*.

The plot below shows both effects. On the left, the hit ratio of an *ideal* cache that always keeps the $k$ most popular items, for a catalog of 100,000 items and several skews (a real cache, with an eviction policy that must guess, does somewhat worse). On the right, the database load as a function of the hit ratio for 50,000 reads per second.

```python exec="1" html="1"
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

N = 100_000                      # items in the catalog
ranks = np.arange(1, N + 1)
fracs = np.logspace(-4, 0, 200)  # cache size as a fraction of the catalog

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4.2))
fig.patch.set_alpha(0)
colors = ["#4e79a7", "#59a14f", "#f28e2b", "#e15759"]
for s, c in zip([0.6, 0.8, 1.0, 1.2], colors):
    w = ranks ** (-s)
    cum = np.cumsum(w) / w.sum()          # ideal cache: keeps the top-k items
    k = np.maximum(1, (fracs * N).astype(int))
    ax1.plot(fracs * 100, cum[k - 1] * 100, color=c, lw=2, label=f"Zipf s = {s}")
ax1.set_xscale("log")
ax1.set_xlabel("cache size (% of the catalog, log scale)")
ax1.set_ylabel("hit ratio (%)")
ax1.set_title("Hit ratio of an ideal top-k cache")
ax1.axvline(1, color="#888", ls=":", lw=1)
ax1.legend(frameon=False)

qps = 50_000
h = np.linspace(0.80, 0.999, 300)
ax2.plot(h * 100, (1 - h) * qps, color="#e15759", lw=2)
for hv in [0.90, 0.95, 0.99]:
    ax2.plot(hv * 100, (1 - hv) * qps, "o", color="#4e79a7")
    ax2.annotate(f"{(1 - hv) * qps:,.0f} QPS", (hv * 100, (1 - hv) * qps),
                 textcoords="offset points", xytext=(6, 6), color="#888")
ax2.set_xlabel("hit ratio (%)")
ax2.set_ylabel("queries per second reaching the DB")
ax2.set_title("DB load with 50,000 reads/s in front of the cache")

for ax in (ax1, ax2):
    ax.set_facecolor("none")
    ax.grid(True, alpha=0.25)
    ax.title.set_color("#888")
    ax.xaxis.label.set_color("#888")
    ax.yaxis.label.set_color("#888")
    ax.tick_params(colors="#888")
    for sp in ax.spines.values():
        sp.set_color("#888")
for t in ax1.get_legend().get_texts():
    t.set_color("#888")

plt.tight_layout()
buffer = StringIO()
plt.savefig(buffer, format="svg", transparent=True)
print(buffer.getvalue())
plt.close()
```

Two lessons from the left panel:

- With a strong skew ($s \geq 1$), a cache holding **1% of the catalog** (dotted line) already answers 60–85% of the reads. Doubling the cache from there buys only a few points: the returns diminish quickly.
- With a weak skew ($s = 0.6$, many items with similar popularity — e.g. a long tail of user profiles), a small cache barely helps. Before adding a cache, ask whether the access pattern is skewed at all.

!!! warning "The hit ratio depends on the TTL, too"

    The plot assumes items stay in the cache until evicted. With a TTL, every item misses once per TTL period: a key read $r$ times per second with TTL $T$ has, at best, a hit ratio of $1 - 1/(r \cdot T + 1)$. A hot event read 1,000 times per second with a 60 s TTL: 1 miss in 60,001 reads. A cold event read once every 10 minutes with a 60 s TTL: every read misses. **Short TTLs hurt the long tail, not the hot keys.**

---

## Sizing a cache

The cache must hold the **working set** — the items that are read again while they are still in the cache — not the whole dataset.

!!! example "Worked example — sizing the catalog cache"

    *Illustrative assumptions:* 100,000 events; the cached JSON of an event (event + venue + prices) averages 4 KB; Redis adds per-key overhead (key string, pointers, expiry metadata) that we round up to 100 bytes per key; we want to cache the 20,000 most-read events.

    - Data: 20,000 × (4 KB + 0.1 KB) ≈ **82 MB**.
    - Search results (`GET /search?q=...`): 200,000 distinct queries × 2 KB ≈ **400 MB**.
    - Sessions: 2 M concurrent fans × 0.5 KB ≈ **1 GB**.
    - Total ≈ 1.5 GB → with a replica for availability, 3 GB; with 50% headroom for fragmentation, snapshots and growth, **~4.5 GB of RAM**.

    That is a single small Redis node with one replica. Caches for a mid-sized product are usually measured in gigabytes, not terabytes — the expensive resource they save is the database.

Rules of thumb for sizing:

- **Measure the item size**, do not guess: serialize a real object and check its length (`MEMORY USAGE key` in Redis).
- **Monitor evictions**: if `evicted_keys` grows steadily while the hit ratio falls, the cache is too small for the working set.
- **Separate by purpose**: sessions (must not be evicted) and query caches (can be evicted) should not compete for the same memory — use different instances or eviction policies ([Redis](redis/index.md)).

---

## What not to cache

A cache answers *"what was the value a moment ago?"*. Some questions need *"what is the value now?"*.

!!! example "BoxOffice: the seat map vs. the seat hold"

    - The **seat map** shown on the event page (which seats look free) can be cached for 1–2 seconds. If it is slightly stale, a fan clicks a seat that was just taken and gets a polite "this seat is no longer available".
    - The **seat hold** — the decision that seat A-12 now belongs to Alice for 10 minutes — must **never** be made on cached data. It goes to the `inventory` service, which decides in a SQL transaction on the source of truth ([Databases — transactions](../databases/transactions/index.md#double-booking)). A cache can *filter* obviously sold-out seats before the database is asked, but it never *grants* a seat.

The same logic applies to account balances, payment status, idempotency keys, and anything where acting on an old value causes a wrong, irreversible action. A good rule: **cache what you display, not what you decide on**.

Other things that should not go in a shared cache: data that is read once (a cache full of one-hit items only evicts useful ones), personal data without a clear TTL and access control (a cache is a copy that also needs to be protected and erased), and values that are cheaper to compute than to fetch over the network.

---

## See it in the playground

Try it: the scenario below puts a cache-aside Redis in front of the catalog database. Start the run with the default settings and watch the **hit ratio**, the **database QPS** and the **p99 latency**. Then (1) set the cache TTL to a very short value and watch the hit ratio and the database load move together; (2) flush the cache in the middle of the run (cold cache) and see how long p99 takes to recover; (3) raise the load until the database saturates on misses alone.

<div class="sdp" data-scenario="read-heavy-cache" data-mode="compact" data-height="520"></div>

Open the [full playground](../../../playground/index.md) to add an in-process cache or a CDN in front of the same design. The `cache` component is described in the [component catalog](../../reference/components/storage/index.md#cache).

## The caching concept map { #concept-map }

A cache is not one component but a layer at every hop: each palette component on the read path can answer from a copy before the request reaches the source of truth. The map links each **palette component** (green) to the **caching concepts** it uses (blue):

``` mermaid
flowchart LR
    client["client · mobile"]:::comp -->|"miss"| cdn["cdn"]:::comp
    cdn -->|"miss"| apigw["apigw"]:::comp
    apigw -->|"miss"| app["app"]:::comp
    app -->|"miss"| cache["cache"]:::comp
    cache -->|"miss"| sql["sql"]:::comp
    sql -->|"CDC"| stream["stream · pubsub"]:::comp
    stream -->|"invalidate"| cache
    client -.- c1["Cache-Control, ETag,<br/>versioned URLs"]:::tech
    cdn -.- c2["purge by tag,<br/>short edge TTL"]:::tech
    app -.- c3["in-process L1,<br/>two-level cache"]:::tech
    cache -.- c4["cache-aside, TTL, eviction,<br/>hit ratio, sizing"]:::tech
    cache -.- c5["stampede, hot keys,<br/>the cache goes down"]:::tech
    sql -.- c6["buffer pool,<br/>never cache decisions"]:::tech
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

| Palette component | Question it answers | Concepts | Taught in | Scenarios |
|---|---|---|---|---|
| [`client`](../../reference/components/client/index.md#client) · [`mobile`](../../reference/components/client/index.md#mobile) | Can the device skip the request entirely? | `Cache-Control`, `ETag`, conditional requests, versioned assets | this overview (*Where caches live*), [Edge — DNS & CDN](../edge/dns-cdn/index.md#cdn) | `cdn-static` |
| [`cdn`](../../reference/components/edge/index.md#cdn) | Can the edge answer for the origin? | public pages and assets, versioned URLs, purge by URL or tag | [Edge — DNS & CDN](../edge/dns-cdn/index.md#cdn), [Invalidation — CDC](invalidation/index.md#cdc) | `cdn-static`, `video-streaming` |
| [`apigw`](../../reference/components/edge/index.md#apigw) | Can a public `GET` be answered without the service? | whole-response cache with a TTL of seconds during the on-sale | this overview (*Where caches live*) | `flash-sale` |
| [`app`](../../reference/components/compute/index.md#app) | Can each replica keep the hottest objects in its own heap? | in-process L1 (Caffeine), near cache, invalidation by broadcast | [Patterns — two-level cache](patterns/index.md#two-level) | `read-heavy-cache` |
| [`cache`](../../reference/components/storage/index.md#cache) | Can a shared copy absorb most reads? | cache-aside, read/write-through, write-behind, TTL, LRU/LFU/W-TinyLFU, hit-ratio math, sizing, Redis structures | [Patterns](patterns/index.md), [Invalidation](invalidation/index.md), [Redis](redis/index.md) | `read-heavy-cache`, `search-autocomplete` |
| [`cache`](../../reference/components/storage/index.md#cache) (under stress) | What happens when a hot key expires, or the cache dies? | cold cache, stampede, avalanche, penetration, hot and big keys, protected fallback | [Failure Modes](failure-modes/index.md) | `read-heavy-cache`, `flash-sale` |
| [`sql`](../../reference/components/storage/index.md#sql) | What does the cache protect — and what must never come from it? | source of truth, buffer pool, "cache what you display, not what you decide on" | this overview (*What not to cache*), [Databases — transactions](../databases/transactions/index.md#double-booking) | `db-replicas`, `flash-sale` |
| [`stream`](../../reference/components/messaging/index.md#stream) · [`kafka`](../../reference/components/messaging/index.md#kafka) · [`pubsub`](../../reference/components/messaging/index.md#pubsub) | How does a change in the database reach every copy? | CDC from the WAL (Debezium), ordered per key, broadcast to L1 caches | [Invalidation — CDC](invalidation/index.md#cdc) | `event-fanout` |

!!! tip "In the interview"

    Do not add a cache by reflex. Justify it with the read/write ratio and the skew ("reads outnumber writes 100:1 and the top 1% of events take most of the traffic"), state the hit ratio you expect and **what it does to the database load** ("at 95%, the DB sees 2,500 QPS instead of 50,000"), then say how you keep it fresh (TTL + delete on write) and what happens when it fails. Interviewers reward the follow-up questions you answer before they ask.

!!! warning "Common pitfalls"

    - **Caching to hide a slow query** that an index would fix. Fix the query first; the cache then protects capacity, not a bug.
    - **No TTL**: keys that live forever turn every missed invalidation into permanent wrong data.
    - **Counting on the cache for capacity without planning for its failure**: if the database cannot survive a cold cache, the cache is now a critical dependency ([Failure Modes](failure-modes/index.md)).
    - **Measuring only the average**: a 95% hit ratio still sends 5% of requests down the slow path; that is your p99.

---

## Connections

- [Databases](../databases/index.md) — the source of truth the cache protects; read replicas are the other way to scale reads.
- [Traffic & Edge — DNS and CDN](../edge/dns-cdn/index.md) — HTTP caching and CDNs, the outermost cache layers.
- [Hands-on 5 — Caching](../../hands-on/5/index.md) — Redis cache-aside on the `catalog` service; measure the hit ratio and p99; reproduce and fix a stampede.
- [Exercise — cache + replica](../../exercises/cache-db/index.md) — before/after measurements of a cache and a read replica.
- Case studies: [distributed cache](../case-studies/distributed-cache/index.md), [URL shortener](../case-studies/url-shortener/index.md), [search autocomplete](../case-studies/search-autocomplete/index.md).
- [Playground](../../../playground/index.md) — scenario `read-heavy-cache`.

## Key takeaways

- Caches work because of **locality and skew**: a cache holding 1% of a Zipf-distributed catalog can absorb most reads.
- A request crosses many cache layers (client, CDN, gateway, in-process, distributed, database); closer to the user is faster but harder to invalidate.
- $t_{\text{eff}} = h \cdot t_{\text{hit}} + (1-h) \cdot t_{\text{miss}}$ and $\text{QPS}_{\text{DB}} = (1-h) \cdot \text{QPS}$: think in **miss ratio** — each extra nine is 10× less database load.
- Size for the **working set**, measure item sizes, watch evictions, and keep headroom.
- **Cache what you display, not what you decide on**: seat holds, payments and balances go to the source of truth.

---

[^1]: BRESLAU, L. et al. Web Caching and Zipf-like Distributions: Evidence and Implications. *IEEE INFOCOM*, 1999.
[^2]: DEAN, J. *Designs, Lessons and Advice from Building Large Distributed Systems*. Keynote, LADIS, 2009 ("latency numbers every programmer should know"). Network and SSD values updated to current hardware as orders of magnitude.
[^3]: FIELDING, R.; NOTTINGHAM, M.; RESCHKE, J. [RFC 9111 — HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111){target="_blank"}. IETF, 2022.
