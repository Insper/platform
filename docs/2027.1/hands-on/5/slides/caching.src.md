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

<div class="kicker">System Architecture · Insper · Lab 5</div>

# Lab 5 — Caching

**Redis cache-aside on `catalog`: hit ratio, p99, invalidation — and a stampede, reproduced and fixed**

<!--
Outline: (1) why cache the catalog; (2) cache-aside; (3) keys and TTLs; (4) failure handling; (5) hit
ratio math; (6) measuring; (7) stampede and the lock; (8) other cures.
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

## Cache-aside

```text
GET key ──► hit?  ── yes ─► return (no DB)
              │
              no ─► SELECT … ─► SET key value PX ttl ─► return
```

| Pattern | Who loads | Writes |
|---|---|---|
| **cache-aside** | the app, on miss | DB, then evict |
| read-through | the cache | — |
| write-through | — | cache + DB, sync |
| write-behind | — | cache now, DB later |

---

## Keys and TTLs

| Key | TTL | Invalidation |
|---|---|---|
| `catalog:event:{id}` | 60 s | evicted on update/delete |
| `catalog:events:city=…:page=…` | 10 s | expires only |

- Store the **response JSON**: a hit costs no DB and no serialization.
- **Jitter** the TTL (+0–10%).

---

## When Redis fails

- Lettuce's default timeout is **60 s** → set **200 ms**.
- Every Redis error becomes a **miss**: slower, but working.

<div class="warn">

If the cache absorbed 95% of reads, its outage sends **20×** the load to the database.

</div>

---

## Invalidation

- **Evict**, don't overwrite: concurrent updates could cache an older version.
- Every key keeps a **TTL**: the safety net for every race.
- Listings: no eviction, **bounded staleness** of ~10 s.

<div class="q">

An admin changes a price. How long can a fan see the old one, on each page?

</div>

---

## Hit ratio math

* Database reads = (1 − h) × total reads.
* h = 90% → DB sees 10%. h = 99% → DB sees **1%**.
* Hit ratio depends on **key space, skew and TTL** — not on Redis speed.

---

## Measure it

```bash
CACHE_ENABLED=false docker compose up -d && k6 run -e RATE=300 load/cache.js
CACHE_ENABLED=true  docker compose up -d && docker compose exec redis redis-cli FLUSHALL
k6 run -e RATE=300 load/cache.js     # cold
k6 run -e RATE=300 load/cache.js     # warm
```

- k6 reads `X-Cache`: `cache_hit` rate, `latency_hit`, `latency_miss`.

---

## The stampede

- A **hot key** expires.
- Every request arriving during the reload **misses**.
- 200 identical heavy queries hit the database at once.

```bash
CACHE_TTL_LIST=3s CACHE_STAMPEDE_PROTECTION=false docker compose up -d
k6 run load/stampede.js       # cache_misses ≫ expirations
```

---

## Fix: one rebuild per key

```text
miss ─► SET key:lock token NX PX 2000
          ├─ won  ─► re-check, load, SET, release
          └─ lost ─► poll the cache every 25 ms (≤ 500 ms)
```

- One query per expiry, across **all** replicas.
- Lock expires if the owner dies; release only **your** token.

---

## Other cures

| Technique | Trade-off |
|---|---|
| TTL jitter | does not help one hot key |
| probabilistic early refresh | some duplicate work |
| stale-while-revalidate | clients see stale data briefly |
| refresh-ahead | must know the hot keys |
| edge request coalescing | only cacheable HTTP |

---

## Takeaways

1. Cache-aside: the app loads on miss, **evicts** on write, every key has a **TTL**.
2. A cache is only as good as its **hit ratio** — which feeds on skew.
3. The cache is an optimization: **fail open** to the database, with short timeouts.
4. Hot keys expiring cause **stampedes**: collapse concurrent misses into one load.
5. State the staleness you accept — it is a product decision.
