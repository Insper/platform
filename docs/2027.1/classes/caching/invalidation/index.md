> "There are only two hard things in Computer Science: cache invalidation and naming things." — Phil Karlton[^1]

Filling a cache is easy. The hard part is knowing **when a copy stopped being true**. The database changes; the copy in Redis, in twenty JVMs, in a CDN and in a million browsers does not know it. Every caching design is, at its core, an answer to two questions:

1. **How stale may each piece of data be?** (the *staleness budget*)
2. **How does a change in the source reach every copy within that budget?** (the *invalidation mechanism*)

And because memory is finite, a third question follows: **when the cache is full, what do we throw away?** (the *eviction policy*). This page covers the three.

---

## The staleness budget

Before choosing a mechanism, decide — with the product team, not alone — how wrong each kind of data may be, and for how long. The answer is different for every entity.

!!! example "BoxOffice: staleness budget per data type"

    | Data | Changes | Acceptable staleness | Mechanism | Why |
    |---|---|---|---|---|
    | Event description, images, line-up | rarely (organizer edits) | ~1 minute | delete on write + TTL 5 min | a typo fix may take a minute to appear |
    | Venue geometry | almost never | hours | TTL 1 h + versioned key on change | immutable in practice |
    | Price table | dynamic pricing, during sales | **seconds** | TTL 30 s + delete on write; price re-read from DB at checkout | displaying an old price is tolerable; *charging* it is not |
    | Seat map (display) | every hold and sale | 1–2 s | TTL 1 s, or no cache | a stale map only causes "seat no longer available" |
    | Availability counter ("1,203 left") | every sale | a few seconds | TTL 2 s | approximate is fine for display |
    | User profile | rarely | ~1 minute, but **read-your-writes** for the owner | delete on write; owner reads bypass the cache briefly | the user must see their own edit |
    | Session | on login/logout | **none** (logout must work) | written to Redis as the source of truth for sessions, not a cache | security |
    | Seat hold, order, payment | — | **zero** | not cached | correctness |

Writing this table is half of the design: once each row has a budget, the mechanism follows.

---

## TTL: the safety net

A **TTL** (time to live) makes every entry expire after a fixed time. It is the simplest mechanism and the one you should **always** have, even when you also invalidate explicitly — because explicit invalidation will eventually miss something (a bug, a manual SQL fix, a crashed process between the commit and the delete), and the TTL bounds how long the error lives.

Choosing the TTL is a trade-off between freshness and hit ratio:

- **Too long**: stale data lives long after a change.
- **Too short**: the long tail of keys always misses (a key read once every 10 minutes never hits with a 60 s TTL), and hot keys expire often, which risks a [stampede](../failure-modes/index.md#stampede).

Practical rules:

- Start from the staleness budget: TTL ≤ budget when there is no explicit invalidation; TTL = a few × budget when there is (the TTL then only bounds the damage of a missed invalidation).
- **Add jitter** — `TTL = base ± 10%` — so that keys written together do not expire together ([cache avalanche](../failure-modes/index.md#avalanche)).
- **Absolute vs. sliding expiration**: an absolute TTL expires a fixed time after the write; a *sliding* one is extended on every read (`GETEX key EX 300` in Redis). Sliding expiration keeps hot keys forever — good for sessions, dangerous for data that changes, since a hot stale key may never be refreshed.

---

## Explicit invalidation

To get freshness better than the TTL, the code that writes to the database also tells the cache that the value changed. Two decisions matter: **delete or update**, and **in which order**.

### Delete, don't update { #delete-vs-update }

When the event changes, the writer can either **update** the cache with the new value or **delete** the key and let the next read fill it. Deleting is safer. Consider two organizers editing event 42 at the same time:

``` diagram-sim
sequenceDiagram
    participant W1 as Writer 1
    participant W2 as Writer 2
    participant D as PostgreSQL
    participant R as Redis
    W1->>D: UPDATE price = 100
    W2->>D: UPDATE price = 120
    W2->>R: SET event:42 price 120
    W1->>R: SET event:42 price 100
    Note over D,R: DB says 120, cache says 100 until the TTL expires
```

The writes reached the database in one order and the cache in the other. With **delete**, both writers send `DEL event:42`: the operations are idempotent and their order does not matter; the next reader loads 120 from the database. Updating the cache is also wasteful when the value is written more often than it is read.

### Write first, then delete

| Order | What can go wrong |
|---|---|
| Delete cache → write DB | between the two, a reader misses, reads the **old** row and puts it back. The cache is stale until the TTL. **Avoid.** |
| Write DB → delete cache (after commit) | a narrow race remains (next section), but this is the standard choice |
| Write DB → update cache | concurrent writers can reorder (above) |
| Write DB, delete **inside** the transaction | the delete can happen before the commit is visible; a reader refills the old value. Delete **after commit**. |

### The cache-aside race { #race }

Even "write DB, then delete after commit" leaves one race. It needs a slow reader:

``` diagram-sim
sequenceDiagram
    participant Rd as Reader
    participant R as Redis
    participant D as PostgreSQL
    participant W as Writer
    Rd->>R: GET event:42
    R-->>Rd: miss
    Rd->>D: SELECT event 42
    D-->>Rd: old row v1
    Note over Rd: reader pauses (GC, slow network)
    W->>D: UPDATE event 42 to v2 and COMMIT
    W->>R: DEL event:42
    Rd->>R: SET event:42 v1
    Note over R: stale v1 stays until the TTL expires
```

The reader read before the write and stored after the delete. It is rare — the reader must be slower than a whole write plus a delete — but at tens of thousands of reads per second, rare things happen every day. The fixes, from simplest to most robust:

1. **A TTL as safety net** — bounds the damage. For most data, this is enough.
2. **Delayed double delete** — the writer deletes, and deletes again a short time later (e.g. 500 ms, longer than a typical read). The second delete removes what a slow reader put back. Cheap, but probabilistic.
3. **Versioned values** — store the row version with the value and only write to the cache if the version is newer than what is there. Since versions come from the database (`version` column, or the commit LSN), a slow reader with `v1` cannot overwrite `v2`. With versions, *updating* on write is safe too.
4. **Leases** — on a miss, the cache hands the reader a **lease token**; a delete invalidates outstanding tokens, and a `SET` with an invalid token is rejected. Facebook's memcache uses leases both for this race and to limit stampedes (only one lease per key every few seconds)[^2].

```lua title="set_if_newer.lua — versioned set in Redis"
-- KEYS[1] = cache key; ARGV[1] = version; ARGV[2] = value; ARGV[3] = TTL in seconds
local current = redis.call('HGET', KEYS[1], 'version')
if current and tonumber(current) >= tonumber(ARGV[1]) then
  return 0                       -- a newer (or equal) version is already cached
end
redis.call('HSET', KEYS[1], 'version', ARGV[1], 'data', ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1
```

The script runs atomically inside Redis ([Redis — atomicity](../redis/index.md#atomicity)), so the compare and the set cannot interleave with another writer.

---

## Invalidation from the database log (CDC) { #cdc }

Invalidation in application code has a structural weakness: it only covers writes that go through *that* code. A batch job, another service, a migration or a DBA fixing a row by hand will change the database without deleting anything.

**Change data capture (CDC)** moves invalidation to the source: a connector reads the database's replication log (the PostgreSQL write-ahead log, WAL) and publishes every committed change as an event. An invalidator consumes the events and deletes the affected keys.

``` diagram-sim
flowchart LR
    APP["catalog service"] -->|"UPDATE events"| DB[("PostgreSQL")]
    ADM["admin script"] -->|"UPDATE events"| DB
    DB -->|"WAL"| DBZ["Debezium<br/>CDC connector"]
    DBZ -->|"change event<br/>events id=42"| K[["Kafka topic<br/>catalog.events"]]
    K --> INV["cache invalidator"]
    INV -->|"DEL event:42"| R[("Redis")]
    INV -->|"publish invalidate 42"| PS(("pub/sub<br/>L1 caches"))
```

- **Complete**: every committed change is seen, whatever wrote it; uncommitted changes never are.
- **Ordered per key**: the log is in commit order, so invalidations cannot be reordered (with Kafka partitioned by key).
- **Decoupled**: the writer does not know which caches exist.
- **Costs**: an extra pipeline to run (Debezium, Kafka); invalidation lags the commit by milliseconds to seconds; still needs a TTL in case the pipeline stops.

CDC and the outbox pattern are covered in [Messaging](../../messaging/patterns/index.md).

### Invalidating many copies

A value may be cached in several places at once. Each needs its own mechanism:

| Copy | How to invalidate | Notes |
|---|---|---|
| Redis (shared) | `DEL key` | one call reaches every reader |
| In-process L1 in each replica | broadcast via pub/sub (Redis `PUBLISH`, Kafka) or Redis client-side caching (`CLIENT TRACKING`); or a very short TTL | a replica that misses the message stays stale until its TTL |
| CDN | purge API (by URL or by **tag** / surrogate key) | purges take seconds to propagate worldwide and may be rate-limited; prefer versioned URLs for assets |
| Browser / mobile app | **impossible** to recall | only `Cache-Control: max-age` (short for data) and versioned URLs (for assets) |

**Tag-based invalidation** helps when one change affects many keys: tag every cached response that contains event 42 with `event-42` and purge by tag. Some CDNs support it natively; in Redis you can keep a set of keys per tag (`SADD tag:event-42 key1 key2`) and delete them together.

---

## Eviction policies

A cache has a memory limit. When it is full and a new value arrives, the **eviction policy** chooses a victim. A good policy keeps the items that will be read again soonest — which nobody knows, so every policy is a guess based on the past.

| Policy | Evicts | Strength | Weakness |
|---|---|---|---|
| **LRU** (least recently used) | the item unused for the longest time | adapts fast to change; simple | a single **scan** of cold items flushes the hot ones |
| **LFU** (least frequently used) | the item with fewest accesses | keeps steadily popular items; resists scans | slow to adapt: yesterday's hit lingers (needs aging); new items are evicted before they prove themselves |
| **FIFO** (first in, first out) | the oldest insertion | trivial, cheap | ignores popularity |
| **Random** | a random item | no metadata at all | ignores popularity, but surprisingly decent with skew |
| **TTL-based** (`volatile-ttl`) | the item closest to expiry | uses the developer's hint | only as good as the TTLs |
| **W-TinyLFU** | admission by frequency estimate + small LRU window | near-optimal hit ratio on many real traces; scan-resistant and adaptive | more complex (built into Caffeine) |

**W-TinyLFU**, used by Caffeine, combines both worlds: new items enter a small LRU *window*; to move into the main cache, an item must have a higher estimated frequency than the victim it would replace. Frequencies are kept in a compact probabilistic sketch (a Count-Min sketch) and periodically halved, so old popularity fades[^3].

The simulation below shows why the policy matters. A cache of 1,000 entries serves Zipf-distributed reads over 20,000 items; in the middle of the run, a reporting job **scans** 2,000 items that nobody else reads.

```python exec="1" html="1"
import heapq
import matplotlib.pyplot as plt
import numpy as np
from collections import OrderedDict, deque
from io import StringIO

rng = np.random.default_rng(7)
N, CAP = 20_000, 1_000                     # catalog items, cache entries
w = np.arange(1, N + 1) ** -0.9
reads = rng.choice(N, size=40_000, p=w / w.sum()).tolist()   # Zipf-like reads
scan = list(range(N - 2_000, N))           # a nightly report reads 2,000 cold items
reqs = reads[:15_000] + scan + reads[15_000:]


def lru(reqs):
    cache, hits = OrderedDict(), []
    for k in reqs:
        if k in cache:
            cache.move_to_end(k)
            hits.append(1)
        else:
            hits.append(0)
            cache[k] = True
            if len(cache) > CAP:
                cache.popitem(last=False)   # least recently used
    return hits


def fifo(reqs):
    cache, order, hits = set(), deque(), []
    for k in reqs:
        if k in cache:
            hits.append(1)
        else:
            hits.append(0)
            cache.add(k)
            order.append(k)
            if len(cache) > CAP:
                cache.discard(order.popleft())   # oldest insertion
    return hits


def lfu(reqs):
    freq, heap, hits, seq = {}, [], [], 0
    for k in reqs:
        seq += 1
        if k in freq:
            freq[k] += 1
            hits.append(1)
        else:
            hits.append(0)
            if len(freq) >= CAP:            # evict the least frequently used
                while True:
                    f, _, victim = heapq.heappop(heap)
                    if freq.get(victim) == f:
                        del freq[victim]
                        break
            freq[k] = 1
        heapq.heappush(heap, (freq[k], seq, k))
    return hits


fig, ax = plt.subplots(figsize=(11, 4))
fig.patch.set_alpha(0)
win = 500
x = np.arange(len(reqs))
for name, fn, c in [("LRU", lru, "#e15759"), ("FIFO", fifo, "#f28e2b"), ("LFU", lfu, "#4e79a7")]:
    h = np.array(fn(reqs), dtype=float)
    rolling = np.convolve(h, np.ones(win) / win, mode="same") * 100
    ax.plot(x[win:-win:50], rolling[win:-win:50], color=c, lw=2, label=f"{name} (overall {h.mean():.0%})")
ax.axvspan(15_000, 17_000, color="#888", alpha=0.2)
ax.text(16_000, 75, "sequential\nscan", ha="center", color="#888")
ax.set_ylim(0, 100)
ax.set_xlabel("request number")
ax.set_ylabel(f"hit ratio over the last {win} requests (%)")
ax.set_title("Cache of 1,000 entries, Zipf reads over 20,000 items, one scan of 2,000 cold items")
ax.set_facecolor("none")
ax.grid(True, alpha=0.25)
ax.title.set_color("#888")
ax.xaxis.label.set_color("#888")
ax.yaxis.label.set_color("#888")
ax.tick_params(colors="#888")
for sp in ax.spines.values():
    sp.set_color("#888")
leg = ax.legend(frameon=False, loc="lower right")
for t in leg.get_texts():
    t.set_color("#888")

plt.tight_layout()
buffer = StringIO()
plt.savefig(buffer, format="svg", transparent=True)
print(buffer.getvalue())
plt.close()
```

How to read it:

- During the scan, every policy misses — the scanned items were never cached. What matters is **what the cache looks like afterwards**.
- **LRU and FIFO** filled the whole cache with the 2,000 scanned items (more than its capacity), evicting every hot item; the hit ratio needs a while to climb back.
- **LFU** evicted scanned items among themselves (each had frequency 1) and kept the hot set: it recovers immediately and has a higher hit ratio overall, because with a stable Zipf workload frequency is a better predictor than recency.
- The weakness of plain LFU does not show here: if popularity *changes* (yesterday's sold-out show), it keeps old favourites too long. That is why real LFU implementations **age** their counters — and why W-TinyLFU exists.

### Eviction in Redis

Redis applies a policy only when memory reaches `maxmemory`. Its LRU and LFU are **approximated**: instead of a global ordered list, Redis samples a few keys (`maxmemory-samples`, default 5) and evicts the best candidate among them; LFU uses a small logarithmic counter per key that decays over time[^4].

| `maxmemory-policy` | Evicts | Use when |
|---|---|---|
| `noeviction` | nothing — writes fail with an error when full | Redis holds data that must not disappear (sessions, queues, locks) |
| `allkeys-lru` | any key, least recently used | a pure cache — the usual default for caching |
| `allkeys-lfu` | any key, least frequently used | a pure cache with stable popularity (catalogs) |
| `volatile-lru` | keys **with a TTL**, LRU | mixed instance: keys without TTL are protected |
| `volatile-lfu` | keys with a TTL, LFU | same, with frequency |
| `allkeys-random` | any key, at random | uniform access, cheapest |
| `volatile-random` | keys with a TTL, at random | rarely the best choice |
| `volatile-ttl` | keys with a TTL, shortest remaining TTL first | the TTLs encode priority |

!!! warning "Mixed instances"

    With a `volatile-*` policy and keys that have no TTL, Redis may find nothing it is allowed to evict and start rejecting writes, exactly like `noeviction`. Prefer separate instances (or databases in separate clusters) for "cache" and "must keep" data.

---

## What consistency can a cache offer?

A cache-aside cache in front of a database is **eventually consistent**: after a write, readers may see the old value until the invalidation arrives or the TTL expires. You can strengthen specific guarantees, at a cost:

| Guarantee | Meaning | How to get it with a cache |
|---|---|---|
| **Bounded staleness** | no value older than T | TTL ≤ T (and nothing else is needed) |
| **Read-your-writes** | after I write, *I* see my write | write-through for that key; or mark the session "recently wrote" and bypass the cache for a few seconds; for L1 caches, route the user to the same replica |
| **Monotonic reads** | I never see a value go back in time | avoid mixing caches with different freshness for the same user (e.g. L1 with 30 s TTL and L2 with 5 s) |
| **Linearizability** | everyone sees the latest write | **not with a cache.** Read the source of truth. |

These are the same consistency models seen in [Distributed Systems](../../distributed/consistency/index.md) — a cache is just another replica, with weaker guarantees and no replication protocol.

!!! example "BoxOffice: a price change during the on-sale"

    Dynamic pricing raises the price of section B from R$ 300 to R$ 350 at 10:07. The `catalog` service commits the change and deletes `prices:42:BRL`; CDC also publishes an invalidation for the in-process caches of the event details that embed the price. The event page may show R$ 300 for up to ~2 s on replicas that missed the message (L1 TTL = 2 s for event details during on-sales; the price table itself is not kept in L1, see [Patterns](../patterns/index.md#two-level)).

    At checkout, the `order` service **does not** use the cached price: it reads the price in the same SQL transaction that confirms the hold. If it differs from what the fan saw, the fan is asked to confirm the new price. The cache made the page fast; the database kept the money correct.

!!! tip "In the interview"

    When you add a cache, the follow-up question is always "how do you keep it consistent?". A strong answer has three layers: (1) the staleness budget for this data ("prices: a few seconds; descriptions: a minute"); (2) the mechanism — TTL as the safety net, delete after commit, CDC if many writers; (3) the escape hatch for decisions — "the checkout reads the price from the database". Mention the cache-aside race and how the TTL (or versions, or leases) bounds it, and you are ahead of most candidates.

!!! success "Best practices"

    - **Write a staleness budget per kind of data** before choosing TTLs: seconds for prices during the on-sale, minutes for descriptions, never for seat availability.
    - **TTL plus explicit delete**: the delete gives freshness, the TTL bounds the damage of the delete you will one day miss.
    - **Version what you cannot purge** (CDN assets, client caches): change the URL or the key instead of invalidating every copy.
    - **Invalidate from the database log (CDC) when many services write the same data**, so no write path can forget the delete.
    - **Choose the eviction policy by the access pattern** (`allkeys-lru` or `allkeys-lfu` for a pure cache) and watch `evicted_keys`: steady evictions mean the working set does not fit. In BoxOffice: lab 5 runs Redis with `--maxmemory 256mb --maxmemory-policy allkeys-lru`.

!!! warning "Common pitfalls"

    - **No TTL "because we invalidate explicitly"** — the first missed delete becomes permanent.
    - **Deleting before writing** the database, or inside the transaction before it commits.
    - **Updating** instead of deleting without versions — concurrent writers reorder.
    - **Forgetting derived keys**: the event changed, but the search results, the "events this weekend" list and the venue page that embed it did not. Use tags, CDC, or short TTLs for aggregate keys.
    - **Purging the CDN for every change** — slow and rate-limited; version the URLs instead.
    - **LRU caches next to batch jobs** — a nightly scan evicts the hot set; give batch jobs their own path or bypass the cache.

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    BUD["staleness budget<br/>per data item"] --> TTL["TTL: the safety net"]
    BUD --> EXP["explicit invalidation<br/>delete, don't update"]
    EXP --> RACE["write first, then delete<br/>the cache-aside race"]
    EXP --> CDC["CDC from the WAL<br/>Debezium → Kafka"]
    CDC --> MANY["many copies: L1 via pub/sub,<br/>CDN purge, versioned URLs"]
    CDC -.-> MSG["change streams<br/>→ Messaging patterns"]
    EV["eviction: LRU, LFU,<br/>W-TinyLFU"] --> MEM["maxmemory policy<br/>→ Redis"]
    TTL --> CONS["what consistency a cache offers<br/>→ Distributed consistency"]
    RACE --> CONS
```

**Palette components:** [`cache`](../../../reference/components/storage/index.md#cache) (TTLs, deletes, eviction policy) · [`app`](../../../reference/components/compute/index.md#app) (deletes after the commit, keeps L1 copies) · [`sql`](../../../reference/components/storage/index.md#sql) (its write-ahead log is the source of invalidations) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (Debezium change events, ordered per key) · [`pubsub`](../../../reference/components/messaging/index.md#pubsub) (broadcast to in-process caches) · [`cdn`](../../../reference/components/edge/index.md#cdn) (purge by URL or tag — or better, versioned URLs). **Scenarios:** `read-heavy-cache`, `cdn-static`, `event-fanout`. **Continues in:** [Failure Modes](../failure-modes/index.md), [Distributed — consistency](../../distributed/consistency/index.md), [Messaging — patterns](../../messaging/patterns/index.md) (CDC, outbox), [Edge — DNS & CDN](../../edge/dns-cdn/index.md#cdn), [Hands-on 5](../../../hands-on/5/index.md).

---

[^1]: Quoted by FOWLER, M. [TwoHardThings](https://martinfowler.com/bliki/TwoHardThings.html){target="_blank"}. Bliki, 2009.
[^2]: NISHTALA, R. et al. Scaling Memcache at Facebook. *USENIX NSDI*, 2013.
[^3]: EINZIGER, G.; FRIEDMAN, R.; MANES, B. TinyLFU: A Highly Efficient Cache Admission Policy. *ACM Transactions on Storage*, v. 13, n. 4, 2017. See also the [Caffeine efficiency notes](https://github.com/ben-manes/caffeine/wiki/Efficiency){target="_blank"}.
[^4]: REDIS. [Key eviction](https://redis.io/docs/latest/develop/reference/eviction/){target="_blank"}. Redis documentation.
