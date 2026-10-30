A cache changes how the system fails. Without it, the database degrades smoothly as load grows. With it, the database is sized for the **misses** — and anything that suddenly turns hits into misses (a restart, an expiry, a new kind of request, a cache node dying) sends the full load to a database that was never sized for it. Most cache incidents are not bugs in the cache; they are the moment the system discovers how much it depended on the cache.

This page goes through the classic failure modes in the order they tend to appear in a flash sale, each with its symptom and its fix.

| Failure | What happens | Main fix |
|---|---|---|
| [Cold cache](#cold-cache) | empty cache after restart or deploy | warm-up, gradual traffic shift |
| [Stampede](#stampede) | a hot key expires; thousands recompute it at once | lock/lease, coalescing, stale-while-revalidate, XFetch |
| [Avalanche](#avalanche) | many keys expire at the same moment | TTL jitter |
| [Penetration](#penetration) | requests for keys that never exist | negative caching, Bloom filter, validation |
| [Hot key](#hot-keys) | one key overloads one cache node | local L1 cache, key replication |
| [Big key](#big-keys) | huge values block the cache | split, compress, `UNLINK` |
| [Cache down](#cache-down) | the cache cluster fails | timeouts, fallback with load shedding, replicas, gutter pool |
| [Memory pressure](#memory) | evictions and fragmentation | sizing, separate instances, eviction policy |

---

## Cold cache { #cold-cache }

A **cold cache** is an empty one: after a restart of Redis without persistence, a deploy that changes the key version (`:v3` → `:v4`), a new region, or a cache node replaced by autoscaling. The hit ratio starts at zero and climbs as keys are read.

The danger is the gap between the load the database was sized for (the misses) and the load it receives (everything). With 50,000 reads/s and a usual 98% hit ratio, the database is sized for ~1,000 QPS; a cold start sends it 50,000.

??? question "Think first: when is the safest moment to deploy a new cache key version?"

    BoxOffice needs to change the format of the cached event (`:v3` → `:v4`). The release is ready at 09:30; the stadium on-sale starts at 10:00.

    Not at 09:30. A new key version is a cold cache for every event, and the hottest moment of the month is half an hour away. Deploy after the on-sale peak (or before, with a warm-up and enough time to verify the hit ratio). More generally: **schedule cache-invalidating deploys outside known peaks**, and roll them out gradually so old and new versions warm up in parallel.

Fixes:

- **Warm-up**: before a known peak, preload the keys you know will be hot — the events going on sale today, the home page lists — with a job that reads them through the normal path.
- **Gradual traffic shift**: send 5%, then 25%, then 100% of traffic to a new cache node or region (canary), so it warms under a fraction of the load.
- **Persistence for big caches**: a Redis restart that reloads an RDB snapshot comes back warm ([Redis — persistence](../redis/index.md#persistence)).
- **Never restart all cache nodes at once.**
- **Capacity floor**: know how many QPS the database can take with an empty cache, and protect it with load shedding (see [cache down](#cache-down)). The Google SRE book lists cold caches among the classic triggers of cascading failures[^1].

---

## Cache stampede { #stampede }

A **cache stampede** (also *thundering herd* or *dog-piling*) happens when a **hot** key expires or is deleted. Every request that arrives before someone puts the value back misses — and each one goes to the database to recompute the *same* value.

``` diagram-sim
sequenceDiagram
    participant A as 4,000 requests
    participant R as Redis
    participant D as PostgreSQL
    Note over R: event:42 expires at 10:00:00.000
    A->>R: GET event:42 (×4,000 within 200 ms)
    R-->>A: miss (×4,000)
    A->>D: same SELECT (×4,000)
    Note over D: CPU 100%, query time 3 ms to 2 s
    D-->>A: rows, slowly
    A->>R: SET event:42 (×4,000, all identical)
```

The arithmetic is Little's law. If event 42 is read **20,000 times per second** and recomputing it takes **200 ms**, then about $20{,}000 \times 0.2 = 4{,}000$ requests miss before the first one finishes. Worse: under that load the query slows down, the window grows, and more requests pile in. A stampede can take down a database that was serving the same page comfortably one second before.

There are four standard fixes. They are complementary.

### 1. Lock (or lease): only one recomputes

On a miss, a request tries to acquire a short lock for the key. The winner recomputes; the others wait a few milliseconds and read the cache again (or serve a stale copy).

```python title="catalog/stampede_lock.py"
import json
import time
import uuid

RELEASE = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"""


def get_event(event_id: int, db, r) -> dict:
    key = f"boxoffice:catalog:event:{event_id}:v3"
    lock = f"lock:{key}"
    for _ in range(50):                                   # wait at most ~1 s
        cached = r.get(key)
        if cached is not None:
            return json.loads(cached)
        token = str(uuid.uuid4())
        if r.set(lock, token, nx=True, px=5_000):          # only one winner
            try:
                event = db.fetch_event_with_venue_and_prices(event_id)
                r.set(key, json.dumps(event), ex=300)
                return event
            finally:
                r.eval(RELEASE, 1, lock, token)             # release only our own lock
        time.sleep(0.02)                                    # losers wait and re-read
    return db.fetch_event_with_venue_and_prices(event_id)   # last resort
```

- `SET ... NX PX 5000` is atomic: set only if absent, with a 5 s expiry so a crashed winner does not block the key forever.
- The release checks the token, so a slow winner whose lock already expired does not delete someone else's lock.
- Cost: losers wait (latency) and poll the cache. Facebook's memcache **leases** are a refined version of this, built into the cache server[^2].

!!! example "In the BoxOffice code: the stampede lock in `catalog` (lab 5)"

    [Hands-on 5 — Stampede](../../../hands-on/5/stampede/index.md) first *reproduces* the stampede (a hot listing with a 3 s TTL, hammered by 200 users) and then sets `CACHE_STAMPEDE_PROTECTION=true`, which runs this code: in a test run (60 s), the misses dropped from **2,238 to 19**, one database query per expiration instead of about a hundred and ten. Same idea as the Python above, in Java: `SET lock NX PX 2000`, re-read after winning (another request may have filled the key), losers poll for at most 20 × 25 ms and then load anyway. Note the honest comment in `unlock`: *get + delete* is not atomic, the Lua script above is.

    ``` { .java title="services/catalog/src/main/java/boxoffice/catalog/EventCache.java (the lock)" }
    --8<-- "docs/2027.1/hands-on/5/code/services/catalog/src/main/java/boxoffice/catalog/EventCache.java:62:85,119:138"
    ```

### 2. Request coalescing (single-flight)

Inside one process, concurrent misses for the same key can share **one** in-flight computation: the first caller starts it, the others wait for the same future. Caffeine's `LoadingCache` and `AsyncLoadingCache` do this automatically; Go has `singleflight`; in Java you can use a `ConcurrentHashMap<Key, CompletableFuture<V>>`.

Coalescing does not need Redis: with 20 replicas, a stampede of 4,000 requests becomes **20** database queries — usually harmless. It is the cheapest fix and should be the default for hot paths.

### 3. Stale-while-revalidate

Keep two expirations: a **soft TTL** stored inside the value (e.g. 60 s) and a longer **hard TTL** on the key (e.g. 10 min). After the soft TTL, the first reader triggers a background refresh (guarded by a lock) and *everyone*, including that reader, keeps getting the stale value until the new one arrives. Readers never wait; the database sees one query. The same idea exists in HTTP as `Cache-Control: max-age=60, stale-while-revalidate=600`.

### 4. Probabilistic early expiration (XFetch) { #xfetch }

Instead of a lock, let each reader decide **at random** to refresh the value *a little before* it expires, with a probability that grows as expiry approaches. Vattani, Chierichetti and Lowenstein showed that the following rule is optimal in a precise sense[^3]. Store with the value the time $\delta$ it took to compute it and its expiry time; on each read, recompute if

$$
t_{\text{now}} - \delta \cdot \beta \cdot \ln(u) \;\geq\; t_{\text{expiry}}, \qquad u \sim \text{Uniform}(0, 1]
$$

Since $-\ln u$ is an exponential random variable with mean 1, each read "looks ahead" by a random amount of about $\delta \beta$. The parameter $\beta$ (default 1) trades earlier refreshes for fewer stampedes. The probability that a single read refreshes, with $r$ seconds left before expiry, is $e^{-r/(\delta \beta)}$.

```python exec="1" html="1"
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

delta = 0.2                                   # seconds to recompute the value
remaining = np.linspace(0, 3, 300)            # seconds left before the TTL expires
rates = np.logspace(-1, 3, 300)               # reads per second on the key
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4))
fig.patch.set_alpha(0)
for beta, c in [(0.5, "#4e79a7"), (1.0, "#59a14f"), (2.0, "#e15759")]:
    # XFetch: a read refreshes early when delta * beta * (-ln U) >= time left, U ~ Uniform(0, 1]
    p = np.exp(-remaining / (delta * beta))
    ax1.plot(remaining, p * 100, color=c, lw=2, label=f"beta = {beta}")
    # with Poisson reads at a given rate, the chance that NO read refreshed early
    p_expire = np.exp(-rates * delta * beta)
    ax2.plot(rates, p_expire * 100, color=c, lw=2, label=f"beta = {beta}")
ax1.invert_xaxis()
ax1.set_xlabel("time left before expiry (s)")
ax1.set_ylabel("P(this read refreshes early) (%)")
ax1.set_title("One read, recompute time = 200 ms")
ax2.set_xscale("log")
ax2.set_xlabel("reads per second on the key (log scale)")
ax2.set_ylabel("P(key reaches expiry unrefreshed) (%)")
ax2.set_title("Hot keys are refreshed early; cold keys just expire")
for ax in (ax1, ax2):
    ax.set_facecolor("none")
    ax.grid(True, alpha=0.25)
    ax.title.set_color("#888")
    ax.xaxis.label.set_color("#888")
    ax.yaxis.label.set_color("#888")
    ax.tick_params(colors="#888")
    for sp in ax.spines.values():
        sp.set_color("#888")
    leg = ax.legend(frameon=False)
    for t in leg.get_texts():
        t.set_color("#888")

plt.tight_layout()
buffer = StringIO()
plt.savefig(buffer, format="svg", transparent=True)
print(buffer.getvalue())
plt.close()
```

The right panel is the elegant part. If reads arrive at rate $\lambda$, the probability that *nobody* refreshed early before expiry is $e^{-\lambda \delta \beta}$. A hot key (hundreds of reads per second) is almost surely refreshed just before it expires — by **one** reader, with no lock and no coordination — while a cold key, where a stampede cannot happen anyway, simply expires. The algorithm adapts to the traffic by itself.

```python title="catalog/xfetch.py"
import json
import math
import random
import time


def xfetch(r, key: str, recompute, ttl: int = 300, beta: float = 1.0):
    entry = r.hgetall(key)                     # {"data": ..., "delta": ..., "expiry": ...}
    now = time.time()
    if entry:
        delta, expiry = float(entry["delta"]), float(entry["expiry"])
        u = 1.0 - random.random()              # in (0, 1], so log(u) is defined
        if now - delta * beta * math.log(u) < expiry:
            return json.loads(entry["data"])   # serve the cached value
    start = time.time()
    value = recompute()                        # miss, or chosen to refresh early
    delta = time.time() - start
    r.hset(key, mapping={"data": json.dumps(value), "delta": delta, "expiry": start + ttl})
    r.expire(key, ttl)
    return value
```

| Fix | Readers wait? | DB queries per expiry | Complexity | Best for |
|---|---|---|---|---|
| Lock / lease | yes (losers) | 1 | medium | any shared hot key |
| Coalescing | yes, per process | 1 per replica | low (library) | always, as a baseline |
| Stale-while-revalidate | no | 1 | medium | data that tolerates seconds of staleness |
| XFetch | no | ~1 | low | hot keys with a known recompute cost |

<div class="csim" data-sim="stampede" data-rate="500"></div>

!!! tip "Try it"
    The run follows lab 5's stampede test: a warm-up caches the hot event page (500 reads/s) and 40 others with the same 3 s TTL, and the database runs 20 queries of 200 ms at a time (100/s). Press play with every switch off: at t = 3 s the queries jump to about 1,060/s, hundreds wait in line, and p99 reaches about 5 s, with 1,229 queries in 10 s for 41 pages. Turn on **request coalescing** (lab 5's `CACHE_STAMPEDE_PROTECTION=true`): 122 queries, p99 200 ms, and 543 requests wait for another request's load instead. The 280/s peak that remains is the 40 pages expiring together, the [avalanche](#avalanche) below: add **TTL jitter** (lab 5's 10%) and it falls to 120/s. **XFetch** alone needs no lock and nobody waits: the hot page is refreshed before it expires (314 queries, peak 230/s, since several readers refresh it at once). With all three, the peak stays under capacity, at 90/s.

---

## Cache avalanche { #avalanche }

A **cache avalanche** is a stampede on many keys at once: a large set of keys expires at the same moment, or the cache is flushed, and the misses for all of them hit the database together.

!!! example "BoxOffice: the warm-up that caused the outage"

    To prepare for the 10:00 on-sale, a job warms the cache at **09:50** with the 5,000 hottest pages, all with `TTL = 600 s`. Every one of them expires at **10:00:00** — the exact moment 2 million fans press F5. The warm-up made things worse than no warm-up at all.

The fix is **jitter**: add a random component to every TTL, e.g. `ttl = 600 + random(0, 120)`, so expirations spread over two minutes. Combine with refresh-ahead or XFetch for the very hottest keys, and with stampede protection for each individual key.

!!! example "In the BoxOffice code: jitter on every TTL (lab 5)"

    Every key that `catalog` writes in [Hands-on 5](../../../hands-on/5/cache-aside/index.md) gets up to 10% of random extra TTL, so keys written by the same warm-up do not expire in the same second:

    ``` { .java title="services/catalog/src/main/java/boxoffice/catalog/EventCache.java (TTL with jitter)" }
    --8<-- "docs/2027.1/hands-on/5/code/services/catalog/src/main/java/boxoffice/catalog/EventCache.java:140:144"
    ```

---

## Cache penetration { #penetration }

**Cache penetration** is traffic for keys that **do not exist** in the database. They are never cached (there is nothing to cache), so every request goes through to the database. A bot enumerating `GET /events/1`, `/events/2`, …, `/events/99999999`, or a buggy client asking for an id that was deleted, can generate a database query per request at the rate of the cache.

Fixes, in layers:

1. **Validate input** before touching anything: malformed or out-of-range ids are rejected at the gateway.
2. **Negative caching**: cache "not found" with a short TTL (e.g. 30–60 s) — see [patterns](../patterns/index.md).
3. **Bloom filter** of existing ids: a compact probabilistic set that answers "definitely not present" or "probably present". A request for an id the filter says is absent never reaches the cache or the database. Sizing: about $-\ln p / (\ln 2)^2 \approx 9.6$ bits per element for a 1% false-positive rate — **~120 KB** for 100,000 events[^4]. Redis Stack / Redis 8 offer Bloom filters natively (`BF.ADD`, `BF.EXISTS`).
4. **Rate limiting and bot mitigation** at the edge (WAF), since penetration is often abuse ([Traffic & Edge](../../edge/api-gateway/index.md)).

---

## Hot keys { #hot-keys }

A distributed cache spreads keys over nodes, but **one key lives on one node**. When a single key is extremely popular, that node saturates while the rest of the cluster is idle.

!!! example "BoxOffice: one key, one node"

    *Illustrative numbers:* 2 million fans refresh the event page about every 5 seconds → **400,000 reads/s** of `event:42`. The cached value is 4 KB. On a single Redis node that means 400,000 × 4 KB ≈ **1.6 GB/s ≈ 13 Gbit/s** of outgoing traffic — more than a 10 Gbit/s network interface — plus far more commands than one node's main thread is comfortable with. Adding nodes to the cluster does nothing: the key still lives on one of them.

Fixes:

- **L1 in-process cache** with a short TTL (1–2 s) in each `catalog` replica ([two-level cache](../patterns/index.md#two-level)). With 50 replicas and a 1 s TTL, Redis sees ~50 reads/s for that key instead of 400,000. This is by far the most effective fix.
- **Key replication**: store N copies under different keys (`event:42#0` … `event:42#7`), which hash to different nodes; readers pick one at random. Writes and invalidations must touch all N copies.
- **Read replicas** of the cache shard (Redis replicas with `READONLY` reads in Cluster), accepting slightly staler reads.
- **Shrink the value**: send the static part (description, images) through the CDN and cache only the small dynamic part.
- **Cache higher up**: the public event page can be cached at the CDN or gateway for a few seconds, so the hot key never reaches the application.

Detecting hot keys: client-side metrics per key prefix, `redis-cli --hotkeys` (requires an LFU eviction policy), or the `MONITOR` command on a replica for a few seconds (never on a busy primary).

---

## Big keys { #big-keys }

A **big key** is a value of megabytes, or a collection (hash, list, set, sorted set) with millions of members. Redis executes commands on a single main thread, so reading, writing, expiring or deleting a big key **blocks every other client** for its duration; transferring it saturates the network.

- Find them with `redis-cli --bigkeys` or `MEMORY USAGE key`.
- **Split** large objects (one key per section instead of one per venue), **paginate** collections (`HSCAN`, `ZRANGE ... LIMIT`), **compress** values above a few KB.
- Delete with `UNLINK` (frees memory in a background thread) instead of `DEL`.
- Keep values small — a common guideline is to stay well below 100 KB per value and avoid collections with more than ~10,000 elements; treat these as rules of thumb, not limits.

---

## The cache goes down { #cache-down }

Sooner or later, the Redis primary fails, the network partitions, or a failover takes 10–30 seconds. What happens next depends on decisions made long before:

``` diagram-sim
flowchart TD
    F["Redis unavailable"] --> T{"Cache calls have<br/>a short timeout?"}
    T -->|"no"| X1["threads block on Redis<br/>whole service stalls"]
    T -->|"yes"| B{"Fallback on error?"}
    B -->|"no"| X2["every read fails<br/>outage"]
    B -->|"read the DB"| C{"Can the DB take<br/>the full load?"}
    C -->|"yes"| OK1["slower but correct"]
    C -->|"no"| S["shed load and serve degraded:<br/>static page, waiting room,<br/>rate-limited misses"]
```

The uncomfortable truth: **once the database is sized for the misses, the cache is no longer optional**. It is a load-bearing dependency, and it needs the same reliability engineering as the database:

- **Timeouts** on every cache call (tens of milliseconds, not the client default) and a **circuit breaker**, so a sick cache fails fast instead of holding threads ([Reliability](../../reliability/patterns/index.md)).
- **Replication with automatic failover** (Redis Sentinel or Cluster; managed services do this for you) — see [Redis](../redis/index.md#replication).
- **Protected fallback**: falling back to the database for *every* miss during an outage is a self-inflicted stampede. Limit concurrent fallback queries (a bulkhead), serve degraded content for non-essential parts, and put the waiting room in front of the on-sale.
- **Gutter pool**: Facebook keeps a small pool of idle cache servers; when a server fails, clients send its keys to the gutter pool (with short TTLs) instead of to the database[^2].
- **Know the number**: test what the database can take with the cache off. That number is your real capacity floor.

---

## Memory pressure, evictions and stale failovers { #memory }

- **Eviction storms**: when the working set outgrows `maxmemory`, the cache evicts keys that will be needed again; the hit ratio falls, the database load rises. Watch `evicted_keys` and the hit ratio together.
- **Fragmentation**: memory used by the process can exceed the data size (`mem_fragmentation_ratio` in `INFO memory`); leave headroom.
- **Snapshot fork**: an RDB snapshot or AOF rewrite forks the process; with copy-on-write, a write-heavy instance can need up to twice its memory during the snapshot. Size for it, or run persistence on a replica.
- **Stale data after failover**: Redis replication is asynchronous. If the primary acknowledged a `DEL` and failed before replicating it, the promoted replica still has the old value — invalidations can be lost. One more reason every key needs a TTL.

---

## See it in the playground

Try it: this scenario runs the `read-heavy-cache` design under a **spike**. First watch the steady state: hit ratio, database QPS and p99. Then (1) flush the cache at the peak and watch the database load jump to the full request rate — a cold cache under load; (2) shorten the TTL of the hot keys and look for stampede spikes in the database QPS each time they expire; (3) enable chaos and watch what happens to p99 while the cache is unavailable.

<div class="sdp" data-scenario="read-heavy-cache" data-mode="compact" data-height="520" data-profile="spike"></div>

The [full playground](../../../../playground/index.md) lets you add a second cache layer or a waiting room and compare.

!!! example "BoxOffice: an on-sale, minute by minute"

    | Time | Event | Failure mode avoided |
    |---|---|---|
    | 09:30 | no cache-invalidating deploys until 11:00 | cold cache |
    | 09:45 | warm-up job loads today's on-sale events, TTL 600 s **+ jitter 0–120 s** | cold cache, avalanche |
    | 09:59 | 2 M fans on the event page; `catalog` serves it from a 1 s L1 cache in each replica | hot key |
    | 10:00 | the price table is edited; delete after commit, CDC broadcasts to L1 caches | stale data |
    | 10:02 | `event:42` reaches its soft TTL; one replica refreshes it in the background, others serve stale | stampede |
    | 10:05 | bots probe `/events/<random id>`; WAF rate-limits, Bloom filter and negative cache absorb the rest | penetration |
    | 10:11 | Redis primary fails; failover in 15 s; cache calls time out at 50 ms; circuit breaker opens; misses are limited to 2,000 QPS, the rest see the waiting room | cache down |

!!! tip "In the interview"

    After you draw a cache, the interviewer will often ask "what happens when a hot key expires?" or "what if Redis goes down?". Name the failure (stampede, avalanche, hot key, penetration), give the number that makes it dangerous (Little's law: reads/s × recompute time), and the fix (coalescing or a lock, TTL jitter, L1 cache, negative caching / Bloom filter). For "Redis goes down", say that the database is sized for the misses, so you need timeouts, a circuit breaker and load shedding — not a naive fallback.

!!! success "Best practices"

    - **Put a short timeout on every cache call** (milliseconds, not the client's default seconds) and treat an error as a miss. In BoxOffice: `timeout: 200ms` and `connect-timeout: 200ms` in `catalog`'s `application.yaml`, and `read()` in `EventCache.java` returns `null` on any Redis error.
    - **Add jitter to every TTL** and protect each hot key with a lock or request coalescing ([boxes above](#stampede)).
    - **Rehearse the cold cache**: flush Redis in a load test at the expected peak and check the database survives; if it does not, keep a warm-up plan and a rate limit on the miss path.
    - **Watch the cache like a database**: hit ratio, evictions, memory, latency per command, and the hottest keys (`redis-cli --hotkeys`, which needs an LFU policy; big keys with `--bigkeys`).
    - **Answer unknown keys cheaply** (negative caching or a Bloom filter) when ids come from the outside.

!!! warning "Common pitfalls"

    - **Warm-ups with identical TTLs** — they schedule an avalanche.
    - **Locks without expiry** — a crashed winner blocks the key forever. Always `PX`.
    - **Fallback to the database on every cache error** — a cache outage becomes a database outage.
    - **Default client timeouts** (seconds) on cache calls — a slow Redis stalls every thread.
    - **Ignoring keys that do not exist** — bots will find them.
    - **Scaling the cluster to fix a hot key** — the key still lives on one node.
    - **`DEL` of a huge collection, `KEYS *`, `MONITOR` on the primary** — they block the single main thread.

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    COLD["cold cache<br/>warm before traffic"] --> DB["the database takes the misses"]
    STAMP["stampede: a hot key expires<br/>reads/s × recompute time"] --> FIX["lock, coalescing,<br/>stale-while-revalidate, XFetch"]
    AVA["avalanche: many keys<br/>expire together"] --> JIT["TTL jitter"]
    PEN["penetration: keys<br/>that never exist"] --> NEG["negative caching,<br/>Bloom filter"]
    HOT["hot key: one node"] --> L1["L1, key copies, CDN<br/>→ Patterns, Edge"]
    DOWN["the cache goes down"] --> RES["timeouts, circuit breaker,<br/>bulkhead → Reliability"]
    DOWN --> DB
    DB --> SHED["shed load, waiting room<br/>→ Messaging"]
```

**Palette components:** [`cache`](../../../reference/components/storage/index.md#cache) (a load-bearing dependency once the database is sized for the misses) · [`sql`](../../../reference/components/storage/index.md#sql) (what it can take with the cache off is the real capacity floor) · [`app`](../../../reference/components/compute/index.md#app) (single-flight, an L1, short cache timeouts) · [`cdn`](../../../reference/components/edge/index.md#cdn) · [`apigw`](../../../reference/components/edge/index.md#apigw) (cache the hot public page higher up) · [`queue`](../../../reference/components/messaging/index.md#queue) (the waiting room when the fallback would drown the database) · [`metrics`](../../../reference/components/observability/index.md#metrics) (hit ratio, `evicted_keys`). **Scenarios:** `read-heavy-cache`, `flash-sale`, `cascading-failure`. **Continues in:** [Redis — replication](../redis/index.md#replication), [Reliability — circuit breaker](../../reliability/patterns/index.md#circuit-breaker), [Estimation — queueing](../../estimation/queueing/index.md) (Little's law), [Case study: distributed cache](../../case-studies/distributed-cache/index.md), [Hands-on 5](../../../hands-on/5/index.md) (reproduce and fix a stampede).

---

[^1]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/sre-book/addressing-cascading-failures/){target="_blank"}, chapter 22, "Addressing Cascading Failures". O'Reilly, 2016.
[^2]: NISHTALA, R. et al. Scaling Memcache at Facebook. *USENIX NSDI*, 2013. Leases (§3.2.1) and gutter pools (§3.3).
[^3]: VATTANI, A.; CHIERICHETTI, F.; LOWENSTEIN, K. Optimal Probabilistic Cache Stampede Prevention. *Proceedings of the VLDB Endowment*, v. 8, n. 8, 2015.
[^4]: BLOOM, B. H. Space/Time Trade-offs in Hash Coding with Allowable Errors. *Communications of the ACM*, v. 13, n. 7, 1970.
