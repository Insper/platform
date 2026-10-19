Click **"Answer"** to reveal the correct answer and explanation.

---

**Q1.** In **cache-aside**, who writes a value into the cache?

- A. The database, through a trigger
- B. The application, after a miss: it loads from the database and stores the result with a TTL
- C. Redis, automatically, by reading the database
- D. The client

??? success "Answer"
    **B — The application, lazily.**

    The cache only contains what was requested recently. Read-through moves the loading into the cache layer; write-through writes the cache on every update. Cache-aside is the simplest and most common.

---

**Q2.** With a hit ratio of 90%, what fraction of the reads reaches PostgreSQL? And with 99%?

- A. 90% and 99%
- B. 10% and 1%
- C. 9% and 0.9%
- D. 50% and 5%

??? success "Answer"
    **B — 10% and 1%.**

    Going from 90% to 99% hit ratio divides the database load by ten. Small improvements at high hit ratios are worth a lot — which is why popularity skew (a few very hot keys) makes caches so effective.

---

**Q3.** Why does `catalog` **evict** the event key on update instead of writing the new value into the cache?

- A. Redis cannot overwrite keys
- B. Concurrent updates could write the cache in a different order from the database commits, leaving an old value cached; deleting is idempotent and the next read loads the committed state
- C. Eviction is faster than writing
- D. To reduce memory usage

??? success "Answer"
    **B — Avoid ordering races.**

    Even eviction has a narrow race (a slow reader re-caching an old value after the eviction), which is why every key also has a TTL: the TTL bounds how long any inconsistency can last.

---

**Q4.** Listing keys are not evicted on updates. What is the consequence?

- A. Listings are always wrong
- B. A listing can show old data for up to `CACHE_TTL_LIST` (10 s + jitter): bounded staleness, accepted to avoid tracking which listing pages contain each event
- C. Updates fail
- D. Redis runs out of memory

??? success "Answer"
    **B — Bounded staleness by design.**

    An event appears in many listing pages (city, page, size). Precise invalidation would need an index from event to keys. A short TTL is a simple, explicit trade-off — state it in a design review.

---

**Q5.** Redis is stopped. What does `catalog` do in this lab's implementation?

- A. Returns `503 Service Unavailable`
- B. Hangs for 60 s per request
- C. Treats every cache error as a miss and serves from PostgreSQL (with 200 ms Redis timeouts), so it is slower but works
- D. Switches to an in-memory cache

??? success "Answer"
    **C — The cache is an optimization, not a dependency.**

    But beware: if the cache absorbed 95% of the reads, its failure sends 20× the usual load to the database — which may fall over. Plan database capacity (or load shedding) for a cache outage.

---

**Q6.** Why add **jitter** to the TTL?

- A. To make keys expire in random order for security
- B. Keys written at the same time (a cold start, a bulk load) would otherwise expire at the same time and cause a synchronized wave of misses
- C. Redis requires it
- D. To save memory

??? success "Answer"
    **B — Desynchronize expirations.**

    Jitter spreads expirations over a window. It does not fix a single hot key expiring — that is the stampede, which needs a lock, early refresh or stale-while-revalidate.

---

**Q7.** In the stampede test without protection, `cache_misses` is 3,000 in a minute with a 3 s TTL. With protection it is ~20. What does each miss represent?

- A. A failed request
- B. One execution of the expensive listing query in PostgreSQL
- C. One Redis eviction
- D. One k6 iteration that timed out

??? success "Answer"
    **B — One heavy query each.**

    20 expirations per minute should cost 20 queries. Without coordination, every request arriving during the reload runs its own copy; the lock collapses them into one ("single flight").

---

**Q8.** Why does the lock have an expiry (`PX 2000`)?

- A. Redis requires every key to expire
- B. If the request holding the lock crashes, the lock frees itself and another request can rebuild the value; without expiry the key could stay locked forever
- C. To make the lock faster
- D. To count requests

??? success "Answer"
    **B — Liveness of the lock.**

    And size it above the p99 of the query: if the work takes longer than the lock lives, a second loader gets in. Releasing must check the token so a request never deletes someone else's lock (atomically, with a Lua script, in production).

---

**Q9.** The cache is **shared** in Redis rather than a local `HashMap` in each replica. Which advantage did you observe?

- A. Redis is faster than a HashMap
- B. A value loaded by one replica is a hit for the others, and all replicas see the same version (one eviction invalidates everywhere)
- C. Local caches cannot have TTLs
- D. Redis compresses JSON

??? success "Answer"
    **B — One cache for all replicas.**

    Local caches are faster (no network hop) but each replica warms separately and can disagree. Many systems use both: a tiny local cache with a short TTL for the very hottest keys, in front of the shared one.

---

**Q10.** HOT_SHARE drops from 0.8 to 0.2 (popularity almost uniform over 200,000 events). What happens to the detail hit ratio, and why?

- A. It increases, because more keys are cached
- B. It drops sharply: with a 60 s TTL and uniform access, most events are not requested again before their key expires
- C. It stays the same; Redis handles it
- D. It becomes 100% after warm-up

??? success "Answer"
    **B — Caches feed on skew.**

    Hit ratio depends on how often the same key is requested within its TTL. Uniform access over a large key space defeats caching; for such workloads, make the query itself cheap (lab 6) or cache at a coarser grain.
