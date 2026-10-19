Click **"Answer"** to reveal the correct answer and explanation.

---

## Why caching works and hit-ratio math

**Q1.** BoxOffice's event page receives **40,000 reads per second**. With the current cache the hit ratio is **95%**. The team improves it to **99%**. What happens to the number of reads that reach the database?

- A. It drops by about 4%, from 2,000 to 1,920 QPS
- B. It drops from 2,000 to 400 QPS — five times less
- C. It drops from 38,000 to 39,600 QPS
- D. It does not change; the hit ratio only affects latency

??? success "Answer"
    **B — From 2,000 to 400 QPS.**

    The database receives the misses: $(1-h) \times \text{QPS}$. At 95%, 0.05 × 40,000 = 2,000 QPS; at 99%, 0.01 × 40,000 = 400 QPS. Four points of hit ratio became a **5× cut** in database load. Always reason with the **miss ratio** — that is the number the database feels.

---

**Q2.** A cache hit costs **0.5 ms** and a miss costs **10.5 ms** (failed lookup + database). What is the average (effective) latency of a read at a **90%** hit ratio?

- A. 0.5 ms
- B. 1.5 ms
- C. 5.5 ms
- D. 9.5 ms

??? success "Answer"
    **B — 1.5 ms.**

    $t_{\text{eff}} = h \cdot t_{\text{hit}} + (1-h) \cdot t_{\text{miss}} = 0.9 \times 0.5 + 0.1 \times 10.5 = 0.45 + 1.05 = 1.5$ ms. Note that the 10% of misses contribute more than twice as much as the 90% of hits — and they also define the tail (p95/p99) of the latency.

---

**Q3.** Why can a cache that holds only **1%** of a catalog of 100,000 events answer more than half of the reads?

- A. Because Redis compresses the values, so 1% of the memory holds the whole catalog
- B. Because popularity is skewed (approximately Zipf): a few items receive most of the requests, and the cache keeps those
- C. Because the database also has a cache, so the two together cover 100%
- D. It cannot; a cache holding 1% of the data answers at most 1% of the reads

??? success "Answer"
    **B — Skewed popularity.**

    Web workloads follow Zipf-like distributions: the item of rank $i$ is requested with probability ∝ $1/i^s$. With $s \approx 1$, the top 1% of items gets around 60% of the requests. With a weak skew (many items with similar popularity), the same small cache would help much less — check the access pattern before adding a cache.

---

**Q4.** Which piece of BoxOffice data should **never** be decided from a cached value?

- A. The event description shown on the event page
- B. The list of events "this weekend in São Paulo"
- C. Whether seat A-12 can be held for the fan who just clicked it
- D. The venue's seating layout

??? success "Answer"
    **C — The seat hold.**

    The seat map can be cached for display (a stale map only produces a "seat no longer available" message), but the **decision** to give the seat to a fan must be made on the source of truth, in a SQL transaction, or two fans can get the same seat. Rule of thumb: cache what you display, not what you decide on.

---

## Patterns

**Q5.** An organizer edits event 42. The `catalog` service uses cache-aside. Which write sequence is the standard, safest choice?

- A. Delete the cache key, then update the database
- B. Update the database, commit, then delete the cache key
- C. Update the cache with the new value, then update the database
- D. Update the database and the cache in any order — both will end up equal

??? success "Answer"
    **B — Write the database, commit, then delete.**

    Deleting first (A) lets a reader refill the cache with the old row before the update. Updating the cache (C, D) lets concurrent writers reorder: the database ends with one value and the cache with the other. Deleting after the commit is idempotent and order-independent; the next read loads the fresh row. A TTL remains as a safety net for the rare race that is still possible.

---

**Q6.** A product manager wants to count **views per event** and show "1,834 people viewed this event today", at tens of thousands of increments per second. Which pattern fits best?

- A. Write-through to PostgreSQL on every view
- B. Write-behind: `INCR` in Redis, flushed to the database in batches every few seconds
- C. Cache-aside with a 5-minute TTL
- D. Write-around: write every view to the database and never cache

??? success "Answer"
    **B — Write-behind.**

    Counters are the textbook case for write-behind: increments are coalesced in memory and persisted in batches, protecting the database from the write rate. Losing a few seconds of counts on a cache failure is acceptable for this data. The same pattern would be unacceptable for orders, payments or seat holds.

---

**Q7.** What is the main risk of **write-behind** (write-back) caching?

- A. Reads after a write always miss
- B. Writes acknowledged to the client can be lost if the cache node fails before flushing to the database
- C. It requires a distributed lock for every read
- D. It cannot be used with Redis

??? success "Answer"
    **B — Acknowledged writes can be lost.**

    Write-behind confirms the write when it reaches the cache's memory; the database only receives it later. If the node dies (or fails over with asynchronous replication) before the flush, the write is gone even though the client was told it succeeded.

---

## Invalidation and eviction

**Q8.** In cache-aside, the code already deletes the key after every write. Why should cached events **still** have a TTL?

- A. Redis requires a TTL on every key
- B. Because explicit invalidation will eventually miss something — a race, a crashed process, a batch job or a manual SQL fix — and the TTL bounds how long the stale value lives
- C. Because without a TTL the hit ratio would be 100%, which overloads Redis
- D. It should not; a TTL only adds misses

??? success "Answer"
    **B — The TTL is the safety net.**

    The cache-aside race (a slow reader storing an old value after the writer's delete), writes that bypass the application, or a failover that loses a `DEL` all leave stale entries. Without a TTL, these errors are permanent. With one, they are bounded.

---

**Q9.** A nightly report reads **every** event once, in id order, through the same cache used by the website. The next morning the hit ratio is very low for the first minutes. Which eviction policy was most likely in use, and what would resist this?

- A. LFU was in use; switch to LRU
- B. LRU was in use; the scan replaced the hot items with items read once. LFU or W-TinyLFU (or bypassing the cache for the report) would resist it
- C. Random eviction was in use; switch to FIFO
- D. `noeviction` was in use; switch to `volatile-ttl`

??? success "Answer"
    **B — Scan pollution of LRU.**

    LRU treats "read once a second ago" as more valuable than "read a thousand times a minute ago", so a sequential scan larger than the cache evicts the whole hot set. Frequency-based policies (LFU, W-TinyLFU) keep the steadily popular items. The simplest fix is often to keep batch reads out of the shared cache.

---

**Q10.** BoxOffice runs 20 replicas of `catalog`, each with an in-process (L1) Caffeine cache in front of Redis. An organizer fixes a typo in the event name. Why might some users still see the typo after Redis was invalidated, and what fixes it?

- A. Redis replicates asynchronously; the fix is `WAIT`
- B. Each replica's L1 cache still has its own copy; fix with a short L1 TTL and/or a broadcast invalidation (pub/sub or CDC) to every replica
- C. The CDN cached the database; purge the database
- D. Caffeine ignores TTLs; replace it with a `HashMap`

??? success "Answer"
    **B — Twenty private copies.**

    Deleting the Redis key does not reach the 20 local caches. A two-level cache needs its own invalidation: a short L1 TTL (accepting a few seconds of staleness), a message broadcast to every replica (Redis pub/sub, client-side caching with tracking, or a CDC pipeline), or both.

---

## Failure modes

**Q11.** The cached event page for the stadium show is read **20,000 times per second**. Recomputing it takes **200 ms**. When the key expires and nothing protects it, about how many requests hit the database for the same query?

- A. 1
- B. 20
- C. About 4,000
- D. 20,000 every second, forever

??? success "Answer"
    **C — About 4,000 (a cache stampede).**

    By Little's law, requests arriving during the recompute window = rate × time = 20,000 × 0.2 s = 4,000, each missing and running the same query. Under that load the query slows down, so the real number tends to be larger. Fixes: request coalescing, a lock/lease so only one recomputes, stale-while-revalidate, or probabilistic early expiration (XFetch).

---

**Q12.** At 09:50 a job warms the cache with the 5,000 hottest pages, all with `TTL = 600 s`. The on-sale starts at 10:00. What is the problem and the fix?

- A. No problem; a warm cache is always good
- B. All 5,000 keys expire together at 10:00, the peak — a cache avalanche. Add random jitter to the TTLs (e.g. 600 + random 0–120 s)
- C. The TTL is too long; use 60 s
- D. The keys will be evicted by LRU before 10:00

??? success "Answer"
    **B — Avalanche, fixed with TTL jitter.**

    Keys written together with the same TTL expire together. Spreading expirations with jitter (and refreshing the hottest keys ahead of time) avoids a synchronized wave of misses at the worst possible moment.

---

**Q13.** Bots request `GET /events/{random id}` for ids that do not exist, at 5,000 requests per second. The hit ratio of the cache is fine for real traffic, but the database load jumps. What is happening and what helps?

- A. Hot key; use key replication
- B. Cache penetration: missing ids are never cached, so every request reaches the database. Validate input, cache "not found" with a short TTL, use a Bloom filter of valid ids, and rate-limit at the edge
- C. Cache avalanche; add TTL jitter
- D. Big key; split the value

??? success "Answer"
    **B — Cache penetration.**

    There is nothing to cache for a key that does not exist, so plain cache-aside sends every such request to the database. Negative caching stores the absence; a Bloom filter (~9.6 bits per id for 1% false positives) rejects ids that certainly do not exist before touching the cache or the database.

---

## Redis

**Q14.** In Redis Cluster, a Lua script must update `seats:42` and `prices:42` atomically, but fails with a `CROSSSLOT` error. What is the fix?

- A. Increase the number of hash slots
- B. Rename the keys with a hash tag, e.g. `{event:42}:seats` and `{event:42}:prices`, so only `event:42` is hashed and both keys land in the same slot
- C. Use `KEYS *` to find the slots first
- D. Disable cluster mode for Lua scripts

??? success "Answer"
    **B — Hash tags.**

    Redis Cluster maps each key to one of 16,384 slots with `CRC16(key) mod 16384`; multi-key operations require all keys in the same slot. With a hash tag, only the text inside `{...}` is hashed. Choose tags with high cardinality (one per event), or the tag becomes a hot spot.

---

**Q15.** A colleague proposes to implement seat holds **only** in Redis with `SET hold:42:A-12 fan:1017 NX PX 600000`, replicated with Sentinel, to avoid touching PostgreSQL during the flash sale. What is the strongest objection?

- A. `SET NX` is not atomic
- B. Redis replication is asynchronous: after a failover the new primary may not have a hold that was already granted, so the seat can be granted again — the decision must stay in the database, with Redis only as a fast pre-filter
- C. Redis cannot store keys with colons
- D. `PX` only accepts seconds

??? success "Answer"
    **B — Asynchronous replication can lose acknowledged holds.**

    `SET NX` is atomic on one node, which makes it a great **filter** that rejects most competing clicks in microseconds. But a failover, an eviction or a flush can erase a hold silently, and then two fans can both succeed. The seat hold is taken in a SQL transaction with a constraint that makes double booking impossible; Redis only reduces how many requests reach it.
