Click **"Answer"** to reveal the correct answer and explanation.

---

## In-Memory Cache / Redis

**Q1.** What is the **cache-aside** pattern, and how does it differ from write-through?

- A. Cache-aside: the application writes to cache only; write-through: the database writes to cache
- B. Cache-aside: the application checks cache first, queries DB on miss, writes result to cache; write-through: the cache layer intercepts writes and writes to both cache and DB atomically
- C. They are equivalent — the terms describe the same pattern
- D. Cache-aside: only reads are cached; write-through: only writes are cached

??? success "Answer"
    **B — Cache-aside: app manages the cache; write-through: cache layer intercepts writes.**

    With cache-aside (lazy loading), the application explicitly checks the cache, fetches from DB on miss, and populates the cache. With write-through, the cache intercepts every write and synchronously updates both itself and the database — ensuring strong consistency but adding write latency. This course uses cache-aside via `@Cacheable`.

---

**Q2.** What does `@Cacheable` do when the cache **already contains** the requested key?

- A. It updates the cache with the current database value and returns it
- B. It executes the method body and compares its result to the cached value for consistency
- C. It returns the cached value immediately, skipping the method body entirely — the database is not queried
- D. It extends the TTL of the cached entry and then executes the method normally

??? success "Answer"
    **C — Returns cached value, method body skipped.**

    This is the entire point of `@Cacheable`. Spring's AOP proxy intercepts the method call, checks Redis for the key (e.g., `accounts::42`), and if found, returns the cached value directly. The `findById` implementation — including the database query — is never executed. The performance gain is the difference between a Redis lookup (<1 ms) and a PostgreSQL query (5–50 ms).

---

**Q3.** Why configure **JSON serialization** instead of the default Java serialization for Redis values?

- A. JSON serialization is faster and uses less memory than Java serialization
- B. Java serialization is not supported by the Lettuce Redis client
- C. JSON produces human-readable keys and values inspectable with `redis-cli`; Java's binary format is opaque and breaks when class structures change between deployments
- D. Redis only accepts UTF-8 encoded strings and rejects binary data

??? success "Answer"
    **C — Human-readable and version-stable.**

    Java serialization produces binary blobs tied to the exact class definition. If you add or rename a field between deployments, deserialization fails with `InvalidClassException`. JSON is both human-readable (you can inspect values with `redis-cli GET "accounts::42"`) and resilient to field additions (Jackson ignores unknown fields with `@JsonIgnoreProperties`).

---

**Q4.** What does TTL (time-to-live) achieve for cached entries, and what would happen without it?

- A. TTL limits the number of reads per entry; without it, hot keys would monopolise memory
- B. TTL expires entries automatically after a configured duration — without it, stale data would accumulate indefinitely as the database changes but the cache does not
- C. TTL controls write rate; without it, cache writes would overwhelm Redis
- D. TTL has no effect on correctness — it is only a performance hint

??? success "Answer"
    **B — Prevents stale data from accumulating indefinitely.**

    If an account's email is updated in PostgreSQL but the cache has no TTL, `accounts::42` would return the old email forever (until a server restart). With a 5-minute TTL, the stale entry expires and the next read re-queries the database. `@CachePut` on the update method also ensures the cache is refreshed immediately when data changes.

---

**Q5.** Why is Redis especially valuable when the gateway runs as **3 replicas** (as from Hands-on 7)?

- A. Redis acts as a message broker between gateway replicas, synchronising their local caches
- B. Each gateway replica has its own Redis instance, reducing load on the shared database
- C. All replicas share the same Redis instance; a cache entry written by replica 1 is immediately available to replicas 2 and 3, eliminating redundant database queries regardless of which replica handles each request
- D. Redis stores JWT tokens for each replica, enabling stateless session sharing

??? success "Answer"
    **C — Shared external cache eliminates per-replica redundancy.**

    Without Redis, each gateway replica has its own JVM heap cache. A request routed to replica 1 caches account 42. The next request for account 42 routed to replica 2 causes another database query — the cache on replica 1 is invisible to replica 2. Redis is external to all replicas; one query result is cached once and available to all three replicas instantly.
