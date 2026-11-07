---
marp: true
lang: en
title: Lab 5 — Caching
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

<div class="kicker">System Architecture · Insper · Lab 5</div>

# Lab 5 — Caching

**Redis cache-aside on `catalog`: hit ratio, p99, invalidation — and a stampede, reproduced and fixed**

<!--
Outline: (1) why cache the catalog; (2) what you will build; (3) cache-aside and EventCache; (4) keys and
time to live; (5) invalidation; (6) failure handling; (7) hit ratio math and measuring; (8) stampede and
the lock; (9) other cures; (10) the simulator.
-->

---

## The perfect cache candidate

<div class="q">

How many times is "upcoming events in São Paulo, page 1" read for each time it changes?

</div>

- Thousands of reads, a few writes per day.
- Strong **popularity skew**: a few events get most views.
- Lab 2: the database pool is the bottleneck.

---

## What you will build

<div class="flow">
<div class="box muted" style="flex: .5">fan</div><div class="arrow">→</div>
<div class="box">edge → gateway<small>round robin</small></div><div class="arrow">→</div>
<div class="box accent">catalog-1..3<small>EventCache · X-Cache header</small></div><div class="arrow">→</div>
<div class="group">
<div class="caption">shared by the three replicas</div>
<div class="box green">redis :6379<small>256 MB, allkeys-lru, no persistence</small></div>
<div class="box orange">db<small>PostgreSQL: only on a miss</small></div>
</div>
</div>

- First `GET /catalog/events/42`: `X-Cache: MISS` — the database answers, the JavaScript Object Notation (JSON) goes to Redis.
- Second one, even on another replica: `X-Cache: HIT` — no database access.

---

## Cache-aside in `EventCache`

<div class="flow">
<div class="box">GET key</div><div class="arrow">hit →</div>
<div class="box green">return the JSON<small>X-Cache: HIT</small></div>
</div>
<div class="flow">
<div class="box">GET key</div><div class="arrow">nil →</div>
<div class="box orange">SELECT … in PostgreSQL</div><div class="arrow">→</div>
<div class="box accent">SET key json PX ttl + 0–10%</div><div class="arrow">→</div>
<div class="box">return<small>X-Cache: MISS</small></div>
</div>

| Pattern | Who loads | Writes |
|---|---|---|
| **cache-aside** ✅ | the app, on miss | database, then evict |
| read-through | the cache | — |
| write-through | — | cache + database, sync |
| write-behind | — | cache now, database later ⚠️ |

---

## Keys and time to live (TTL)

| Key | TTL | Invalidation |
|---|---|---|
| `catalog:event:{id}` | 60 s | evicted on update/delete |
| `catalog:events:city=…:page=…` | 10 s | expires only |

- Store the **response JSON**: a hit costs no database access and no serialization.
- **Jitter** the TTL (+0–10%): keys written together do not expire together.

---

## Invalidation

<div class="flow">
<div class="box">PUT /catalog/events/42<small>admin token</small></div><div class="arrow">→</div>
<div class="box accent">UPDATE + COMMIT</div><div class="arrow">→</div>
<div class="box green">DEL catalog:event:42<small>next read: MISS, new data</small></div>
<div class="box orange">listing keys untouched<small>stale for up to 10 s</small></div>
</div>

- **Evict**, don't overwrite: concurrent updates could cache an older version.
- Every key keeps a **TTL**: the safety net for every race.

<div class="q">

An admin changes a price. How long can a fan see the old one, on each page?

</div>

---

## When Redis fails

<div class="flow">
<div class="box">GET key</div><div class="arrow">→</div>
<div class="box red">Redis down or slow<small>200 ms timeout</small></div><div class="arrow">→</div>
<div class="box orange">log, treat as a miss</div><div class="arrow">→</div>
<div class="box green">200 from PostgreSQL<small>X-Cache: MISS</small></div>
</div>

- Lettuce's default timeout is **60 s** → set **200 ms**.
- Every Redis error becomes a **miss**: slower, but working.
- No persistence: after a restart the cache is **cold**.

<div class="warn">

If the cache absorbed 95% of reads, its outage sends **20×** the load to the database.

</div>

---

## Hit ratio math

* Database reads = (1 − h) × total reads.
* h = 90% → the database sees 10%. h = 99% → it sees **1%**.
* Hit ratio depends on **key space, skew and TTL** — not on Redis speed.

---

## Measure it

```bash
CACHE_ENABLED=false docker compose up -d --wait && k6 run -e RATE=300 load/cache.js
CACHE_ENABLED=true  docker compose up -d --wait && docker compose exec redis redis-cli FLUSHALL
k6 run -e RATE=300 load/cache.js     # cold
k6 run -e RATE=300 load/cache.js     # warm
```

- 80% of the detail requests go to the 2,000 hottest events (1% of the catalog).
- k6 reads `X-Cache`: `cache_hit` rate, `latency_hit`, `latency_miss`.
- A run for this lab: ~72% cold, 72% again warm with the 60 s TTL; with `CACHE_TTL_EVENT=5m`, 83% warm vs 71% cold.

<!--
With 60 s, the keys written early in the cold run expire early in the next one: each hot key misses about
once per minute in both. A TTL longer than the run shows the warm cache win. Warm-ups before each run:
the recreated replicas are cold JVMs.
-->

---

## The stampede

- A **hot key** expires.
- Every request arriving during the reload **misses**.
- 200 identical heavy queries hit the database at once.

```bash
CACHE_TTL_LIST=3s CACHE_STAMPEDE_PROTECTION=false docker compose up -d --wait
k6 run load/stampede.js       # cache_misses ≫ expirations
```

---

## Fix: one rebuild per key

<div class="flow">
<div class="box">miss</div><div class="arrow">→</div>
<div class="box accent">SET key:lock token NX PX 2000</div><div class="arrow">won →</div>
<div class="box green">re-check, load, SET, release<small>one query per expiry</small></div>
</div>
<div class="flow">
<div class="box muted" style="flex: .45">everyone else</div><div class="arrow">lost →</div>
<div class="box orange">poll the cache every 25 ms<small>≤ 500 ms, then load anyway</small></div><div class="arrow">→</div>
<div class="box green">HIT</div>
</div>

- A test run (200 virtual users, 60 s): misses **2,238 → 19**; p99 ~1 s → ~0.3 s; `db` central processing unit (CPU) 234% → 4%.
- Lock expires if the owner dies; release only **your** token (atomically: a Lua script).

---

## Other cures

| Technique | Trade-off |
|---|---|
| TTL jitter | does not help one hot key |
| probabilistic early refresh | some duplicate work |
| stale-while-revalidate | clients see stale data briefly |
| refresh-ahead | must know the hot keys |
| edge request coalescing | only cacheable Hypertext Transfer Protocol (HTTP) responses |

---

## Without Docker: the simulator

<div class="flow">
<div class="box accent">Check it (step 5)<small>MISS on catalog-2, HIT on catalog-3, TTL 62</small></div>
<div class="box orange">Listing after an update<small>a stale HIT for 7 s, ≤ CACHE_TTL_LIST</small></div>
<div class="box green">TTL and BYPASS<small>one miss per expiry, every BYPASS a query</small></div>
</div>

- The Cache-aside page embeds lab 5's cache as a simulator: same keys, TTLs and outputs.
- Stop Redis: still a 200; start it: empty, since there is no persistence.

<!--
The simulator sits at the end of step 5 of Cache-aside.
-->

---

## Takeaways

1. Cache-aside: the app loads on miss, **evicts** on write, every key has a **TTL**.
2. A cache is only as good as its **hit ratio** — which feeds on skew.
3. The cache is an optimization: **fail open** to the database, with short timeouts.
4. Hot keys expiring cause **stampedes**: collapse concurrent misses into one load.
5. State the staleness you accept — it is a product decision.
