A **cache stampede** (also *thundering herd* or *dog-piling*) happens when a **hot key** expires: every request that arrives before the value is rebuilt misses, and all of them run the same expensive query at the same time. The database, which the cache was protecting, receives a burst of identical work exactly when traffic is highest.

``` diagram-sim
sequenceDiagram
    autonumber
    participant F1 as Fan 1
    participant F2 as Fan 2..200
    participant C as catalog ×3
    participant R as redis
    participant DB as db
    Note over R: key "São Paulo, page 0" expires
    F1->>C: GET listing
    C->>R: GET → miss
    C->>DB: heavy query (join, sort, count)
    F2->>C: GET listing (same key, same moment)
    C->>R: GET → miss
    C->>DB: the SAME heavy query, ×199
    Note over DB: 200 identical queries, pool of 30 connections: queueing
    DB-->>C: rows (eventually)
    C->>R: SET (200 times, same value)
```

## 1. Reproduce it

Make the problem frequent: a hot listing with a **3 s TTL**, hammered by 200 closed-model users without think time.

``` { .javascript title="load/stampede.js" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/5/code/load/stampede.js"
```

``` { .bash .copy }
CACHE_TTL_LIST=3s CACHE_STAMPEDE_PROTECTION=false docker compose up -d --wait
k6 run -q -e DURATION=20s load/stampede.js > /dev/null    # warm-up: the replicas were recreated
k6 run load/stampede.js
```

In 60 s the key expires about 20 times. Without protection, `cache_misses` is far above 20 — each expiry lets through every request that arrived during the reload, one heavy query each. Watch `docker stats` during the test: the CPU of `db` spikes every ~3 seconds, and so does the latency (look at `max` and `p(99)` versus `med`).

## 2. Fix it: one rebuild per key

The fix implemented in `EventCache` (already in your code, behind a switch) is a **distributed lock per key**:

1. Miss → try `SET key:lock <token> NX PX 2000`. Redis guarantees only **one** request in the whole cluster (all three replicas) gets it.
2. The winner double-checks the cache, runs the query, writes the value, releases the lock.
3. The losers do **not** query the database: they poll the cache every 25 ms for up to 500 ms and return the value as soon as the winner writes it (a `HIT`).
4. If the winner dies, the lock expires after 2 s, so nobody waits forever.

``` { .java title="excerpt of services/catalog/src/main/java/boxoffice/catalog/EventCache.java (already in your code)" }
if (stampedeProtection) {
    var lockKey = key + ":lock";
    var token = UUID.randomUUID().toString();
    if (tryLock(lockKey, token)) {
        try {
            cached = read(key);               // someone may have filled it meanwhile
            if (cached != null) {
                return count(new Result(cached, "HIT"));
            }
            return count(load(key, ttl, loader));
        } finally {
            unlock(lockKey, token);
        }
    }
    // another request is already loading this key: wait for it instead of
    // sending one more identical query to the database
    for (int i = 0; i < 20; i++) {
        sleep(Duration.ofMillis(25));
        cached = read(key);
        if (cached != null) {
            return count(new Result(cached, "HIT"));
        }
    }
}
```

``` { .bash .copy }
CACHE_TTL_LIST=3s CACHE_STAMPEDE_PROTECTION=true docker compose up -d --wait
k6 run -q -e DURATION=20s load/stampede.js > /dev/null    # warm-up: the replicas were recreated
k6 run load/stampede.js
```

Now `cache_misses` should be close to the number of expirations (~20 per minute). In a test run of this script as it is (200 VUs, 60 s, TTL 3 s), the misses dropped from **2,238 to 19** — one database query per expiration instead of about a hundred and ten. In the same run p99 fell from about 1 s to about 0.3 s and the average CPU of `db` from 234% to 4%. The latency gain varies from machine to machine (Redis, the edge and the gateway also weigh on each request), but the database load during each expiration drops by about two orders of magnitude, and that is what protects it during a real spike. Fill in the stampede table of `results/lab5.md`.

## 3. Other cures, and their trade-offs

| Technique | Idea | Trade-off |
|---|---|---|
| **Lock / single flight** (this lab) | one loader per key, others wait | waiting threads (blocked Tomcat threads; virtual threads — `spring.threads.virtual.enabled=true` — make the wait cheap) |
| **TTL jitter** (also in this lab) | keys written together expire at different times | does not help a *single* hot key |
| **Probabilistic early refresh** (XFetch) | each request may refresh *before* expiry, with a probability that grows as expiry approaches | no locks; some duplicate work |
| **Stale-while-revalidate** | serve the expired value while one request refreshes in the background | clients see slightly stale data |
| **Refresh-ahead** | a background job refreshes hot keys before they expire | needs to know which keys are hot |
| **Request coalescing at the edge** | the CDN/proxy collapses identical concurrent misses (`proxy_cache_lock` in Nginx) | only for cacheable HTTP responses |

!!! warning "Pitfalls of the lock"

    - `unlock` does *get* then *delete*: between the two, the lock could expire and be taken by someone else, and we would delete *their* lock. The correct version is one atomic Lua script (`if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end`). The lab keeps the simple version for readability; the comment in the code says so.
    - A lock that is held longer than its expiry (a 3 s query with a 2 s lock) lets a second loader in. Size the lock TTL above the p99 of the query.
    - The waiters give up after 500 ms and load anyway: under extreme load, a bounded wait is safer than an unbounded queue.

??? question "Think first: the hot key is `catalog:event:1` (the flash-sale show), read 50,000 times per second. Is the stampede your only problem?"

    No: even with 100% hits, **one key lives on one Redis node**. In a Redis Cluster, all 50,000 requests per second hit the same shard — a **hot key**. Cures: a small local in-process cache in each replica (a few seconds of TTL) in front of Redis, replicating the hot key under several names (`event:1#0`…`event:1#9`, picked at random), or pushing the page to the CDN. Class 7 ([failure modes](../../../classes/caching/failure-modes/index.md)) covers these.

Back to the [lab overview](../index.md#measure-it) to record the results.
