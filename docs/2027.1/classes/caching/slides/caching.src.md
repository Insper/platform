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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

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
Why does the catalog database reach 100% of its central processing unit (CPU) — and take the checkout down with it?

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
- **Latency gap**: random-access memory (RAM) ~100 ns · Redis in the same data center ~0.5 ms · a Structured Query Language (SQL) query 1–100 ms.

<div class="ok">

A cache makes reads faster, but its real job is to **remove work** from the source of truth.

</div>

---

## Where caches live

<div class="flow">
<div class="box">browser / app<small>Cache-Control, ETag · cannot be recalled</small></div><div class="arrow">miss →</div>
<div class="box">content delivery network (CDN)<small>public pages · purge, versioned addresses</small></div><div class="arrow">→</div>
<div class="box">gateway<small>whole GET responses, a few seconds</small></div><div class="arrow">→</div>
<div class="box accent">in-process<small>Caffeine · each replica on its own</small></div><div class="arrow">→</div>
<div class="box green">Redis<small>shared · delete on write + time to live (TTL)</small></div><div class="arrow">→</div>
<div class="box orange">database<small>buffer pool · always consistent</small></div>
</div>

- Closer to the user: faster and cheaper per hit, but **harder to invalidate**.
- BoxOffice: event JavaScript Object Notation (JSON) with `max-age=10` in the browser, `GET /events/42` for 5 s at the gateway, venue geometry in Caffeine, event details in Redis.
- This class: the application side, in-process and distributed caches; CDNs are in Traffic & Edge.

---

## Hit-ratio math

$$t_{\text{eff}} = h \cdot t_{\text{hit}} + (1-h) \cdot t_{\text{miss}} \qquad \text{QPS}_{\text{DB}} = (1-h) \cdot \text{QPS}$$

| Hit ratio | Effective latency (0.5 / 8.5 ms) | Database load (queries per second, QPS) at 50,000 reads/s |
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

<div class="flow">
<div class="arrow" style="flex: .35; text-align: left">Read</div>
<div class="box">GET key</div><div class="arrow">hit →</div><div class="box green">return</div>
<div class="arrow">miss →</div><div class="box orange">read the database</div><div class="arrow">→</div>
<div class="box accent">SET key EX ttl</div><div class="arrow">→</div><div class="box">return</div>
</div>
<div class="flow">
<div class="arrow" style="flex: .35; text-align: left">Write</div>
<div class="box">update the database</div><div class="arrow">→</div><div class="box accent">commit</div><div class="arrow">→</div>
<div class="box green">DEL key<small>the next read refills it</small></div>
</div>

- Only what is read is cached; cache down → the app reads the database (if it can take it).

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
| Write-through | write cache + database (DB) together | fresh reads after writes | two writes, not atomic | organizer dashboard |
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
- Small values (compress > few KB); cache **data transfer objects (DTOs)**, not Java Persistence API (JPA) entities.
- **Negative caching**: store "not found" for 30–60 s.
- **Level 1 + level 2 (L1 + L2)**: Caffeine in each replica (µs) in front of Redis (~0.5 ms) — absorbs hot keys, but now **20 copies** to invalidate.

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

<div class="flow">
<div class="box">reader: miss<small>SELECT reads v1</small></div><div class="arrow">pauses →</div>
<div class="box accent">writer: v2 + COMMIT<small>then DEL key</small></div><div class="arrow">→</div>
<div class="box orange">reader: SET key v1<small>after the delete</small></div><div class="arrow">→</div>
<div class="box red">stale v1<small>until the TTL</small></div>
</div>

- **Update on write**: two writers reach DB and cache in different orders → the older value stays. **Delete** is idempotent.
- Write first, then delete — **after the commit**; deleting first lets a reader refill the old row.
- Fixes for the race above: **TTL** (always) · delayed double delete · **versioned set-if-newer** (Lua) · **leases**.

<!--
The page draws both races step by step: the reordered updates, and the slow reader.
-->

---

## Many writers, many copies — and what a cache can promise

- Jobs, scripts, other services? **Change data capture (CDC)**: Debezium reads the write-ahead log (WAL) → Kafka → invalidator `DEL` + pub/sub to every L1.
- Copies you cannot delete (CDN assets, browsers): **version the uniform resource locator (URL)** instead.

| Guarantee | With a cache |
|---|---|
| Bounded staleness | ✅ TTL ≤ T |
| Read-your-writes | ⚠️ write-through for that key, or bypass the cache briefly |
| Monotonic reads | ⚠️ do not mix caches of different freshness for one user |
| Linearizability | ❌ not with a cache: read the source of truth (the checkout reads the price) |

---

## Eviction policies

| Policy | Keeps | Weakness |
|---|---|---|
| least recently used (LRU) | recently used | one **scan** flushes the hot set |
| least frequently used (LFU) | frequently used | slow to forget (needs aging) |
| first in, first out (FIFO) / random | — | ignore popularity |
| W-TinyLFU (Caffeine) | frequency-admitted + small LRU window | more complex |

- Redis: `allkeys-lru` / `allkeys-lfu` for caches; `noeviction` for sessions and locks.
- Redis LRU/LFU are **approximated** by sampling (`maxmemory-samples 5`).

---

## Failure modes at a glance

| Failure | Symptom | Fix |
|---|---|---|
| Cold cache | DB gets everything after restart/deploy | warm-up, gradual shift |
| **Stampede** | hot key expires, N identical queries | coalescing, lock, stale-while-revalidate, XFetch |
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
- Persistence: none · Redis Database (RDB) snapshots · append-only file (AOF, `everysec`) · both.
- Replication **asynchronous**; Sentinel promotes a replica in seconds.
- 2024: license change → **Valkey** fork (Linux Foundation); 2025: Redis 8 adds AGPLv3.

---

## Redis Cluster

<div class="flow">
<div class="box">cluster-aware client<small>slot map cached</small></div><div class="arrow">CRC16(key) mod 16384 →</div>
<div class="group">
<div class="caption">3 primaries, each with a replica</div>
<div class="box">primary A<small>slots 0–5460</small></div>
<div class="box">primary B<small>5461–10922 · prices:42 → 9049</small></div>
<div class="box accent">primary C<small>10923–16383 · event:42 → 16271</small></div>
</div>
</div>

- **16,384 hash slots** (a cyclic redundancy check, CRC16, picks the slot); `MOVED` / `ASK` redirect when the map changes.
- Adding a node = moving slots, live. Multi-key ops only within one slot → **hash tags**: `{event:42}:seats`.

<div class="warn">

`{boxoffice}:*` puts the whole app on one node — tag by something with **many** values.

</div>

---

## Seat pre-hold: Redis filters, SQL decides

<div class="flow">
<div class="box">fan 1017<small>SET hold:42:A-12 … NX PX 600000</small></div><div class="arrow">OK →</div>
<div class="box accent">inventory</div><div class="arrow">→</div>
<div class="box green">PostgreSQL transaction<small>unique per seat: it decides</small></div>
</div>
<div class="flow">
<div class="box">fan 2203<small>the same SET</small></div><div class="arrow">nil →</div>
<div class="box red">"seat taken"<small>microseconds, no database work</small></div>
</div>

- Rejects most competing clicks in microseconds, before the database.
- But async replication, eviction or a flush can **lose** a granted hold.
- The winner still takes the hold in a **PostgreSQL transaction** with a constraint.

<div class="ok">

If Redis loses a pre-hold, two fans reach the DB and one loses there. Correctness never depended on Redis.

</div>

---

## Play it: the two simulators

<div class="flow">
<div class="box accent">cache (Patterns)<small>TTL 60 s, lab 5's: ~86% hits, ~29 of 200 reads/s reach the database, no stale read · TTL only: ~11% stale</small></div>
<div class="box orange">stampede (Failure modes)<small>no protection: ~1,060 queries/s at t = 3 s, p99 ~5 s · coalescing: 122 queries · + jitter: peak 120/s · all three: 90/s</small></div>
</div>

- Each knob is a decision of this class: invalidation strategy, TTL, cache size; coalescing, jitter, XFetch.
- Both take their defaults from lab 5 (`CACHE_TTL_EVENT`, the 3 s stampede test, 10% jitter).

<!--
The cache simulator sits after the comparison of patterns; the stampede simulator after the table of fixes.
-->

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
