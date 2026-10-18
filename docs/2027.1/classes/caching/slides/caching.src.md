---
marp: true
lang: en
title: Caching
description: System Architecture · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">System Architecture · Insper</div>

# Caching

**Stop asking the database the same question two million times**

<!--
Outline: (1) why caches work and where they live; (2) hit-ratio math and sizing; (3) patterns;
(4) invalidation and eviction; (5) failure modes; (6) Redis.
-->

---

## 10:00, the stadium show goes on sale

<div class="q">

2 M fans press F5 on the same event page. The data has not changed in a week.
Why does the catalog database reach 100% CPU — and take the checkout down with it?

</div>

- Every `GET /events/42` runs the **same** three queries: event, venue, prices.
- Tens of thousands of identical questions per second; query time goes 3 ms → 800 ms.
- The checkout shares the database: **nobody has bought anything and the system is down**.
- The fix is not a bigger database. It is to **keep the answer** and serve the copy.

<!--
Let the class answer first. Lead them to: the work is redundant, so remove it.
-->

---

## Why caches work

- **Temporal locality** — what was read recently will be read again (F5).
- **Skew** — popularity is roughly **Zipf**: rank $i$ gets $\propto 1/i^s$ of the requests.
- With $s \approx 1$, the top **1%** of 100,000 events takes **~60%** of the reads.
- **Latency gap**: RAM ~100 ns · Redis in the DC ~0.5 ms · SQL 1–100 ms.

<div class="ok">

A cache makes reads faster, but its real job is to **remove work** from the source of truth.

</div>

---

<!-- _class: tight -->

## Where caches live

| Layer | Caches | Invalidated by | BoxOffice |
|---|---|---|---|
| Client (browser, app) | HTTP responses (`Cache-Control`, `ETag`) | headers only — cannot recall | versioned JS, event JSON `max-age=10` |
| CDN | static assets, public pages | purge API, versioned URLs | posters, public event page |
| API gateway | whole `GET` responses | short TTL | `GET /events/42` for 5 s |
| In-process (Caffeine) | hot objects in the heap | each replica separately | venue geometry |
| Distributed (Redis, Valkey) | objects, query results, sessions | app (delete) + TTL | event details, search |
| Database | pages in the buffer pool | the engine — always consistent | `seats` index pages |

<p class="small">Closer to the user: faster and cheaper per hit, but harder to invalidate.</p>

---

## Hit-ratio math

$$t_{\text{eff}} = h \cdot t_{\text{hit}} + (1-h) \cdot t_{\text{miss}} \qquad \text{QPS}_{\text{DB}} = (1-h) \cdot \text{QPS}$$

| Hit ratio | Effective latency (0.5 / 8.5 ms) | DB load at 50,000 reads/s |
|---|---|---|
| 90% | 1.3 ms | 5,000 QPS |
| 99% | 0.58 ms | 500 QPS |
| 99.9% | 0.51 ms | 50 QPS |

<div class="ok">

Think in **miss ratio**: each extra nine is **10× less** database load.

</div>

---

## Sizing and what not to cache

- Size for the **working set**, not the dataset: 20,000 events × 4 KB ≈ 82 MB.
- Measure item sizes (`MEMORY USAGE`); watch **evictions** vs hit ratio; keep headroom.
- A TTL $T$ on a key read $r$/s gives at best $1 - 1/(rT+1)$: short TTLs hurt the **long tail**.

<div class="warn">

**Cache what you display, not what you decide on.** The seat map may be 1 s stale; the **seat hold** is decided in a SQL transaction. Same for prices at checkout, payments, balances.

</div>

---

## Cache-aside: the default

<div class="cols">
<div>

**Read**: `GET` → hit? return. Miss → read DB → `SET key EX ttl` → return.

**Write**: update DB → **commit** → `DEL key`.

</div>
<div>

- Only what is read is cached.
- Cache down → app reads the DB (if it can take it).
- Costs: slow first read; staleness bounded by the TTL.

</div>
</div>

```java
@Cacheable(cacheNames = "events", key = "#id")
public EventDto findById(long id) { ... }

@CacheEvict(cacheNames = "events", key = "#id")   // after commit!
public EventDto update(long id, EventUpdate change) { ... }
```

---

<!-- _class: tight -->

## The other patterns

| Pattern | Idea | Good | Risk | BoxOffice |
|---|---|---|---|---|
| Read-through | the cache loads on miss | coalesces concurrent misses | — | venue geometry (Caffeine) |
| Write-through | write cache + DB together | fresh reads after writes | two writes, not atomic | organizer dashboard |
| Write-behind | write cache now, DB later | memory-speed writes | **loses acked writes** | view counters |
| Write-around | write DB, skip cache | no pollution | first read misses | tickets, order history |
| Refresh-ahead | reload before expiry | hot keys never miss | wasted refreshes | today's on-sales |

<div class="warn">

Write-behind for seat holds = double booking after a cache failure.

</div>

---

## Keys, values and two levels

- Namespaced, versioned keys: `boxoffice:catalog:event:42:v3`.
- Put **everything that changes the answer** in the key: language, currency, page, user.
- Small values (compress > few KB); cache **DTOs**, not JPA entities.
- **Negative caching**: store "not found" for 30–60 s.
- **L1 + L2**: Caffeine in each replica (µs) in front of Redis (~0.5 ms) — absorbs hot keys, but now **20 copies** to invalidate.

---

## Invalidation: the staleness budget

| Data | Staleness OK | Mechanism |
|---|---|---|
| Event description | ~1 min | delete on write + TTL 5 min |
| Price table | seconds | TTL 30 s + delete; **checkout reads the DB** |
| Seat map (display) | 1–2 s | TTL 1 s |
| User profile | read-your-writes for the owner | delete + bypass for the writer |
| Seat hold, order, payment | **zero** | not cached |

<div class="ok">

Decide the budget per data type **with the product team**; the mechanism follows.

</div>

---

## Delete, don't update — and mind the race

- **Update on write**: two writers reach DB and cache in different orders → cache keeps the older value.
- **Delete** is idempotent and order-independent.
- Still one race: slow reader reads `v1` → writer commits `v2` + `DEL` → reader `SET v1`.
- Fixes: **TTL** (always) · delayed double delete · **versioned set-if-newer** (Lua) · **leases** (Facebook memcache).
- Many writers (jobs, scripts)? **CDC**: Debezium reads the WAL → Kafka → invalidator `DEL` + pub/sub to L1.

<!--
Draw the race on the board as a timeline with four steps.
-->

---

## Eviction policies

| Policy | Keeps | Weakness |
|---|---|---|
| LRU | recently used | one **scan** flushes the hot set |
| LFU | frequently used | slow to forget (needs aging) |
| FIFO / random | — | ignore popularity |
| W-TinyLFU (Caffeine) | frequency-admitted + small LRU window | more complex |

- Redis: `allkeys-lru` / `allkeys-lfu` for caches; `noeviction` for sessions and locks.
- Redis LRU/LFU are **approximated** by sampling (`maxmemory-samples 5`).

---

## Failure modes at a glance

| Failure | Symptom | Fix |
|---|---|---|
| Cold cache | DB gets everything after restart/deploy | warm-up, gradual shift |
| **Stampede** | hot key expires, N identical queries | coalescing, lock, SWR, XFetch |
| Avalanche | many keys expire together | **TTL jitter** |
| Penetration | ids that do not exist | negative cache, Bloom filter |
| Hot key | one node saturates | L1 cache, key replication |
| Cache down | DB sized for misses gets 100% | timeouts, breaker, load shedding |

---

## Stampede: the numbers

<div class="q">

`event:42`: **20,000 reads/s**; recompute takes **200 ms**. The key expires. How many identical queries hit the DB?

</div>

- Little's law: 20,000 × 0.2 s ≈ **4,000** — and the query slows down under load.
- **Coalescing** (single-flight): one query per replica → 20.
- **Lock**: `SET lock:key token NX PX 5000`; losers wait and re-read.
- **Stale-while-revalidate**: soft TTL inside the value; serve old while one refreshes.

---

## XFetch: probabilistic early expiration

Recompute if $\;t_{\text{now}} - \delta \beta \ln(u) \geq t_{\text{expiry}}$, with $u \sim U(0,1]$, $\delta$ = recompute time.

- Each read "looks ahead" by an exponential amount with mean $\delta\beta$.
- P(key expires with nobody refreshing early) $= e^{-\lambda \delta \beta}$ for $\lambda$ reads/s.
- Hot key (1,000 reads/s, δ = 0.2 s): refreshed early by **one** reader, almost surely.
- Cold key: just expires — no stampede possible anyway.

<div class="ok">

No locks, no coordination: the algorithm adapts to the traffic.

</div>

---

## Hot keys and the cache going down

<div class="cols">
<div>

**Hot key**: 400,000 reads/s × 4 KB ≈ **13 Gbit/s** on one node.

- Adding nodes does not help.
- L1 cache with 1 s TTL in 50 replicas → ~50 reads/s.
- Key replicas `event:42#0..7`, CDN for the static part.

</div>
<div>

**Cache down**: the DB was sized for the misses.

- Timeouts (~50 ms) + circuit breaker.
- Limit fallback queries; serve degraded / waiting room.
- Replicas + automatic failover; gutter pool.

</div>
</div>

<div class="warn">

Once the DB depends on the hit ratio, the cache is a **load-bearing dependency**.

</div>

---

## Redis in one slide

- In-memory server of **data structures**; one thread executes commands → each command is **atomic**.
- Strings · hashes (sessions) · sorted sets (**waiting room**) · HyperLogLog (unique visitors) · streams.
- Atomic multi-step: `MULTI/EXEC` (no rollback), **Lua scripts / functions**.
- Persistence: none · RDB snapshots · AOF (`everysec`) · both.
- Replication **asynchronous**; Sentinel promotes a replica in seconds.
- 2024: license change → **Valkey** fork (Linux Foundation); 2025: Redis 8 adds AGPLv3.

---

## Redis Cluster

- **16,384 hash slots**; `slot = CRC16(key) mod 16384`; each primary owns a range.
- Cluster-aware clients cache the map; `MOVED` / `ASK` redirect when it changes.
- Adding a node = moving slots, live.
- Multi-key ops only within one slot → **hash tags**: `{event:42}:seats`, `{event:42}:prices`.

<div class="warn">

`{boxoffice}:*` puts the whole app on one node — tag by something with **many** values.

</div>

---

## Seat pre-hold: Redis filters, SQL decides

```text
> SET hold:42:A-12 fan:1017 NX PX 600000
OK
> SET hold:42:A-12 fan:2203 NX PX 600000
(nil)
```

- Rejects most competing clicks in microseconds, before the database.
- But async replication, eviction or a flush can **lose** a granted hold.
- The winner still takes the hold in a **PostgreSQL transaction** with a constraint.

<div class="ok">

If Redis loses a pre-hold, two fans reach the DB and one loses there. Correctness never depended on Redis.

</div>

---

<!-- _class: tight -->

## The caching concept map

| Component | Question it answers | Key concepts |
|---|---|---|
| `client` `mobile` | can the device skip the request? | `Cache-Control`, `ETag`, versioned assets |
| `cdn` `apigw` | can the edge answer for the origin? | public pages, short TTLs, purge by tag |
| `app` | can each replica keep the hottest objects? | in-process L1, two-level cache |
| `cache` | can a shared copy absorb most reads? | cache-aside, TTL, eviction, hit ratio, sizing |
| `cache` (under stress) | hot key expires? cache dies? | stampede, avalanche, hot keys, fallback |
| `sql` | what does the cache protect? | source of truth — cache what you display, not what you decide |
| `stream` `pubsub` | how does a change reach every copy? | CDC from the WAL, broadcast to L1 |

<p class="small">Each layer is faster and closer to the user but holds less and is <b>harder to invalidate</b>.</p>

---

## Takeaways

1. Caches work because of **locality and skew**; their main job is protecting the source of truth.
2. $\text{QPS}_{\text{DB}} = (1-h) \cdot \text{QPS}$: think in **miss ratio**; each nine is 10× less load.
3. **Cache-aside + delete after commit + TTL** is the baseline; write-behind only for data you can lose.
4. Set a **staleness budget** per data type; TTL is always the safety net; CDC for many writers.
5. Prefer frequency-aware eviction (LFU, W-TinyLFU) when scans pollute LRU.
6. Plan for stampede, avalanche, penetration, hot keys and **the cache going down**.
7. **Cache what you display, not what you decide on**: seat holds and payments go to the database.
