Putting a cache in front of a database raises two questions that have nothing to do with Redis itself: **who fills the cache** when a value is missing, and **what happens to the cache when the data is written**. The answers form a small set of named patterns. They are worth knowing by name: in a design review or an interview, "cache-aside with delete-on-write and a 5-minute TTL" says in one sentence what would otherwise take a paragraph[^2].

| Pattern | Who reads the DB on a miss | What happens on a write |
|---|---|---|
| [Cache-aside](#cache-aside) | the application | app writes the DB, then **deletes** the key |
| [Read-through](#read-through) | the cache (through a loader) | combined with one of the write patterns |
| [Write-through](#write-through) | — | cache and DB written **synchronously**, together |
| [Write-behind](#write-behind) | — | cache written now, DB written **later**, in batches |
| [Write-around](#write-around) | — | DB written, cache **not touched** (filled on the next read) |
| [Refresh-ahead](#refresh-ahead) | the cache, **before** expiry | — |

Throughout the page the example is the BoxOffice `catalog` service: `GET /events/{id}` returns an event with its venue and price table, and organizers occasionally edit an event with `PUT /events/{id}`.

---

## Cache-aside { #cache-aside }

**Cache-aside** (also called *lazy loading*) is the default pattern and the one you should assume unless there is a reason not to. The application talks to both the cache and the database; the cache is a passive key-value store that knows nothing about the database[^1].

``` diagram-sim
sequenceDiagram
    participant A as catalog service
    participant R as Redis
    participant D as PostgreSQL
    A->>R: GET event:42
    R-->>A: nil (miss)
    A->>D: SELECT event, venue, prices WHERE id = 42
    D-->>A: row
    A->>R: SET event:42 json EX 300
    A->>R: GET event:42 (next request)
    R-->>A: json (hit)
```

**Read path**: look in the cache; on a hit, return it; on a miss, read the database, store the result with a TTL, return it.
**Write path**: update the database, then **delete** the key (not update it — see [Invalidation](../invalidation/index.md#delete-vs-update)). The next read repopulates it.

Why it is the default:

- **Only what is read gets cached** — no memory wasted on data nobody asks for.
- **The cache is optional**: if Redis is down, reads go to the database (slower, but correct). The application keeps working, provided the database can take the load.
- **Simple to reason about**: the database is always the source of truth — the cache holds *derived data* that can be rebuilt at any time[^3].

Its costs:

- **The first read of each key is slow** (miss + database + SET): three round trips instead of one.
- **Staleness window**: between the database write and the delete, and in a few race conditions ([Invalidation](../invalidation/index.md#race)), readers can see an old value — bounded by the TTL.
- **Cache logic is spread through the application code** — unless a framework hides it.

### Cache-aside in Spring Boot

Spring's cache abstraction implements cache-aside with annotations: `@Cacheable` wraps the read path, `@CacheEvict` the delete on write. It is the shortest way to write the pattern in a Spring service; [Hands-on 5](../../../hands-on/5/index.md) writes it by hand instead, so that each step can be seen and measured (box below).

```java title="catalog/src/main/java/boxoffice/catalog/EventService.java"
@Service
public class EventService {

    private final EventRepository repository;

    public EventService(EventRepository repository) {
        this.repository = repository;
    }

    // Read path: key "events::42"; runs the method only on a miss
    @Cacheable(cacheNames = "events", key = "#id", unless = "#result == null")
    public EventDto findById(long id) {
        return repository.findWithVenueAndPrices(id)
                .map(EventDto::from)
                .orElse(null);
    }

    // Write path: update the database first, then delete the key
    @Transactional
    @CacheEvict(cacheNames = "events", key = "#id")
    public EventDto update(long id, EventUpdate change) {
        Event event = repository.findById(id).orElseThrow();
        event.apply(change);
        return EventDto.from(repository.save(event));
    }
}
```

```java title="catalog/src/main/java/boxoffice/catalog/CacheConfig.java"
@Configuration
@EnableCaching
public class CacheConfig {

    @Bean
    public RedisCacheManager cacheManager(RedisConnectionFactory factory) {
        RedisCacheConfiguration defaults = RedisCacheConfiguration.defaultCacheConfig()
                .entryTtl(Duration.ofMinutes(5))
                .disableCachingNullValues()
                .serializeValuesWith(RedisSerializationContext.SerializationPair
                        .fromSerializer(RedisSerializer.json()));

        return RedisCacheManager.builder(factory)
                .cacheDefaults(defaults)
                .withCacheConfiguration("events", defaults.entryTtl(Duration.ofMinutes(5)))
                .withCacheConfiguration("prices", defaults.entryTtl(Duration.ofSeconds(30)))
                .build();
    }
}
```

!!! warning "When does `@CacheEvict` run?"

    By default `@CacheEvict` runs **after** the method returns — but `@Transactional` may commit even later, when the proxy chain unwinds. If the eviction happens *before* the commit, a concurrent reader can miss, read the **old** row (still uncommitted change), and put it back in the cache. Make sure the delete happens after the commit: order the proxies so the transaction commits first, use `TransactionAwareCacheManagerProxy` (or `RedisCacheManager.builder(...).transactionAware()`), or evict in an `@TransactionalEventListener(phase = AFTER_COMMIT)`.

!!! example "In the BoxOffice code: cache-aside in `catalog` (lab 5)"

    [Hands-on 5 — Cache-aside](../../../hands-on/5/cache-aside/index.md) implements the pattern without annotations, so the decisions are explicit: read Redis first; on a miss, load from PostgreSQL and store the exact JSON returned to the client, with the TTL plus up to 10% of jitter; if Redis fails, log and treat it as a miss — **the cache is an optimization, not a dependency**. Every response carries the outcome (`HIT`, `MISS`, `BYPASS`) in an `X-Cache` header and a counter, which is how the lab measures the hit ratio.

    ``` { .java title="services/catalog/src/main/java/boxoffice/catalog/EventCache.java (get and load)" }
    --8<-- "docs/2027.1/hands-on/5/code/services/catalog/src/main/java/boxoffice/catalog/EventCache.java:54:61,86:87,99:117"
    ```

    The write path is in `EventController.java`: `service.updateEvent(...)` commits, and only then `cache.evict(eventKey(id))` deletes the key — *write first, then delete*, the order explained in [Invalidation](../invalidation/index.md#delete-vs-update).

### Cache-aside by hand (Python)

Without a framework, the pattern is a dozen lines. This is what `@Cacheable` does behind the scenes:

```python title="assistant/catalog_cache.py"
import json
import redis

r = redis.Redis(host="redis", port=6379, decode_responses=True)
TTL_SECONDS = 300


def get_event(event_id: int, db) -> dict | None:
    key = f"boxoffice:catalog:event:{event_id}:v3"
    cached = r.get(key)
    if cached is not None:                       # hit
        return json.loads(cached)
    event = db.fetch_event_with_venue_and_prices(event_id)   # miss → source of truth
    if event is not None:
        r.set(key, json.dumps(event), ex=TTL_SECONDS)
    return event


def update_event(event_id: int, change: dict, db) -> None:
    db.update_event(event_id, change)            # 1. commit to the database
    r.delete(f"boxoffice:catalog:event:{event_id}:v3")   # 2. then invalidate
```

---

## Read-through { #read-through }

In **read-through**, the application only talks to the cache. On a miss, *the cache itself* loads the value from the database, using a loader function you register. The logic moves from the application into the cache layer.

``` diagram-sim
sequenceDiagram
    participant A as catalog service
    participant C as Cache with loader
    participant D as PostgreSQL
    A->>C: get(42)
    C->>D: loader(42): SELECT ...
    D-->>C: row
    C-->>A: value (now cached)
    A->>C: get(42)
    C-->>A: value (hit)
```

In-process caches implement this natively — Caffeine's `LoadingCache`, Guava, .NET `MemoryCache` with a factory. Distributed caches rarely do (Redis has no idea how to query PostgreSQL), so "read-through Redis" in practice is a library in the application that behaves as if it were the cache.

```java title="Read-through with Caffeine (in-process)"
LoadingCache<Long, Venue> venues = Caffeine.newBuilder()
        .maximumSize(10_000)
        .expireAfterWrite(Duration.ofMinutes(10))
        .build(id -> venueRepository.findById(id).orElse(null));   // the loader

Venue v = venues.get(7L);   // miss → loader runs once, even with 100 concurrent callers
```

A useful property: a good read-through cache **coalesces** concurrent misses on the same key — 100 threads asking for venue 7 trigger a single loader call. That is the cure for the stampede described in [Failure Modes](../failure-modes/index.md#stampede).

---

## Write-through { #write-through }

In **write-through**, every write goes to the cache *and* to the database as part of the same operation, before the client gets an answer. The cache is always warm with the latest value for every key written.

``` diagram-sim
sequenceDiagram
    participant A as catalog service
    participant C as Cache
    participant D as PostgreSQL
    A->>C: put(42, new event)
    C->>D: UPDATE events SET ... WHERE id = 42
    D-->>C: ok
    C-->>A: ok (cache and DB both updated)
```

- **Good**: reads right after a write hit the cache with the fresh value (read-your-writes through the cache); no miss penalty after updates.
- **Bad**: every write pays two latencies; values that are written but never read still take memory (combine with a TTL); the two writes are **not atomic** — if the database write fails after the cache write, the cache holds a value that never existed. Write to the database first, and delete the key if anything fails.

Write-through fits data that is read soon after it is written: a user's profile after editing, the organizer's dashboard.

---

## Write-behind { #write-behind }

**Write-behind** (or *write-back*) acknowledges the write as soon as the cache has it and persists to the database **later**, asynchronously, often in batches.

``` diagram-sim
sequenceDiagram
    participant A as service
    participant C as Cache
    participant W as Flusher
    participant D as PostgreSQL
    A->>C: INCR views:event:42
    C-->>A: ok (fast, in memory)
    A->>C: INCR views:event:42
    C-->>A: ok
    W->>C: every 10 s: read and reset counters
    W->>D: UPDATE event_stats SET views = views + 1834
```

- **Good**: writes are as fast as memory; many writes to the same key are **coalesced** into one database write; the database is protected from write bursts.
- **Bad**: **acknowledged writes can be lost** if the cache node dies before flushing; the database is always behind; ordering and failures of the flusher need careful engineering.

Use it only for data where losing a few seconds of writes is acceptable: view counters, "people looking at this event right now", analytics events, rate-limit counters. **Never** for orders, payments or seat holds.

??? question "Think first: write-behind for seat holds?"

    During the flash sale, writing every seat hold to SQL is the bottleneck. A colleague proposes: "write holds to Redis, acknowledge the fan, and flush to PostgreSQL every second". What can go wrong?

    If the Redis primary fails before the flush, holds that fans already saw as confirmed vanish — and the seats can be sold again: double booking, the one bug BoxOffice must never have. Even with Redis replication, replication is asynchronous ([Redis](../redis/index.md#replication)) and the last acknowledged writes can be lost on failover. The right tools for the hold bottleneck are elsewhere: a waiting room to cap the arrival rate, fine-grained row locks, and partitioning the inventory ([Databases](../../databases/transactions/index.md#double-booking)).

---

## Write-around { #write-around }

In **write-around**, writes go straight to the database and the cache is not touched (or the key is simply deleted). The value enters the cache only when someone reads it.

This is what cache-aside does on the write path, and it is the right choice when **written data is rarely read soon after**: the ticket a fan just bought (read a handful of times, by one person), audit logs, order history. Writing those to the cache would only evict useful entries.

---

## Refresh-ahead { #refresh-ahead }

**Refresh-ahead** reloads a hot entry **before** it expires, so readers never see the miss. A background task (or the first reader after a threshold, e.g. when 80% of the TTL has passed) fetches the fresh value while the current one is still served.

``` diagram-sim
sequenceDiagram
    participant A as Reader
    participant C as Cache
    participant D as PostgreSQL
    A->>C: get(event:42), TTL 300 s, age 250 s
    C-->>A: current value (served immediately)
    C->>D: async reload (age > 80% of TTL)
    D-->>C: fresh value, TTL reset to 300 s
```

- **Good**: hot keys never expire under load — no latency spike, no stampede.
- **Bad**: if the prediction is wrong, the cache refreshes keys nobody will read (wasted database load). Works best for a **small, known set of hot keys** — like the events going on sale today.

Caffeine implements it with `refreshAfterWrite`; the probabilistic version, which needs no background job, is **XFetch** ([Failure Modes](../failure-modes/index.md#xfetch)). A related HTTP idea is `Cache-Control: stale-while-revalidate`, which lets a CDN serve the old copy while it fetches a new one.

---

## Comparing the patterns

| | Cache-aside | Read-through | Write-through | Write-behind | Write-around | Refresh-ahead |
|---|---|---|---|---|---|---|
| **Consistency with DB** | eventual (TTL-bounded) | eventual | strong-ish (two writes, not atomic) | DB lags the cache | eventual | eventual |
| **Read latency on miss** | high (3 round trips) | high (hidden in cache) | rare misses after writes | rare misses | high on first read | almost never misses |
| **Write latency** | DB + delete | — | DB + cache | memory only | DB only | — |
| **Risk of data loss** | none | none | none | **yes** (unflushed writes) | none | none |
| **Complexity** | low | low (in-process) / medium | medium | high | low | medium |
| **Cache survives outage?** | app falls back to DB | depends on library | writes fail or degrade | **writes are lost** | yes | falls back to misses |
| **BoxOffice use** | event details, search results | venue geometry (Caffeine) | organizer's own dashboard | view counters, "N people viewing" | tickets, order history | today's on-sale events |

In practice, systems **combine** them: cache-aside + write-around (delete on write) is the common baseline; refresh-ahead is added for the few hottest keys; write-behind is reserved for counters.

<div class="csim" data-sim="cache" data-size="500" data-strategy="aside"></div>

!!! tip "Try it"
    The TTL starts at 60 s, the `CACHE_TTL_EVENT` of [Hands-on 5](../../../hands-on/5/cache-aside/index.md). Press play and let the cache warm up: after a minute the hit ratio settles around 86% and the database takes about 29 of the 200 reads/s, with no stale read, because each edit deletes its key. Switch to **TTL only**: orange cells appear on the hot events, and about 11% of the reads return an event older than the database (with a 10 s TTL, about 2%, but the hit ratio drops to 79%: the TTL trades freshness for load). **Write-through** is as fresh as deleting the key and skips the miss after each edit. Shrink the cache to 100 keys: LRU evicts part of the hot set, and the hit ratio falls to about 58% (85 database reads/s).

---

## Designing cache keys and values

The patterns say *when* to read and write the cache; the key and value design decides whether it works at scale.

**Namespaced, structured keys.** Use a prefix per service and entity, and include anything that changes the answer:

```text
boxoffice:catalog:event:42:v3                 # one event, schema version 3
boxoffice:catalog:prices:42:BRL               # price table in a given currency
boxoffice:search:q=rock+sp:page=1:lang=pt     # a search result page
boxoffice:session:9f1c2e...                   # a session
```

- **Version in the key** (`:v3`): when the object's format changes in a deploy, bump the version — old and new replicas no longer read each other's incompatible values, and old keys simply expire.
- **Everything that changes the result** must be in the key: language, currency, page, the user's permissions. Forgetting one is how a page in Portuguese is served to an English user — or one user's data to another.
- **Keep keys short but readable**; avoid unbounded user input in keys (normalize and hash long search queries).

**What to cache.**

| Granularity | Example | Pro | Con |
|---|---|---|---|
| **Database row / object** | `event:42` | reusable by many pages; easy to invalidate | page needs several lookups |
| **Query result** | `search:q=rock` | saves the most expensive work | hard to invalidate (which queries contain event 42?) — rely on TTL |
| **Rendered fragment / response** | HTML of the event card, full JSON response | fastest | most duplicated; invalidation is coarse |

**Values.** JSON is readable and debuggable; binary formats (Protocol Buffers, MessagePack, Kryo) are smaller and faster to parse. Compress values above a few kilobytes (e.g. with LZ4 or Zstandard). Large values hurt more than they seem: a 1 MB value takes ~1 ms of network transfer per read on a 10 Gbit/s link and blocks Redis while it is being copied ([Failure Modes — big keys](../failure-modes/index.md#big-keys)).

**Negative caching.** If `GET /events/999999` does not exist, cache the *absence* too (a sentinel such as `"∅"` with a short TTL, e.g. 30 s). Otherwise, every request for a missing id — from a bug or a bot — goes straight to the database. This is the first defence against [cache penetration](../failure-modes/index.md#penetration).

---

## Two-level cache (near cache) { #two-level }

Each replica of the `catalog` service can keep a small **in-process cache (L1)** in front of the shared **Redis (L2)**:

``` diagram-sim
flowchart LR
    REQ["request"] --> L1["L1: Caffeine<br/>in the JVM, ~1 µs"]
    L1 -->|"miss"| L2[("L2: Redis<br/>shared, ~0.5 ms")]
    L2 -->|"miss"| DB[("PostgreSQL<br/>~5 ms")]
    DB --> L2
    L2 --> L1
```

- **Why**: a hit in L1 costs a hash-map lookup (microseconds, no network), and it absorbs **hot keys** that would otherwise hammer a single Redis shard ([Failure Modes — hot keys](../failure-modes/index.md#hot-keys)).
- **The catch — invalidation**: with 20 replicas, a write must invalidate 20 private L1 caches plus Redis. Options: a very short L1 TTL (1–5 s) and accept that staleness; or broadcast invalidations over Redis pub/sub (or Redis client-side caching with tracking, `CLIENT TRACKING`) so each replica drops its local copy.

!!! example "BoxOffice: what goes where"

    | Data | L1 (Caffeine) | L2 (Redis) | Why |
    |---|---|---|---|
    | Venue geometry (sections, rows, seats layout) | yes, 10 min | yes, 1 h | almost immutable; read on every seat-map render |
    | Event details | yes, **2 s** | yes, 5 min, delete on write | hot during on-sales; edits must show up quickly |
    | Price table | no | yes, 30 s | changes during dynamic pricing; a stale price at checkout is a business problem |
    | Search results | no | yes, 60 s | many distinct keys, low reuse per replica |
    | Session | no | yes (separate instance, `noeviction`) | must be shared by all replicas; must not be evicted |
    | Seat hold | **never** | **never** (decided in SQL) | strong consistency required |

!!! tip "In the interview"

    Name the pattern and the invalidation in one breath: "cache-aside on Redis for event details, TTL 5 minutes, delete on write after commit, and a 2-second in-process L1 for the hottest events during an on-sale". Then show that you know the costs: the miss penalty, the staleness window and the race that TTL bounds. If the interviewer pushes on consistency, say what you do **not** cache and why.

!!! success "Best practices"

    - **Start with cache-aside**; move to another pattern only when a requirement asks for it (read-through to share the loader, write-through when reads must see the last write, write-behind only for data you can lose).
    - **Cache the DTO or the exact response**, not the entity: a hit then costs no query and no serialization. In BoxOffice: `catalog` stores the JSON it returns ([box above](#cache-aside)).
    - **Design keys on purpose**: a namespace, every dimension the answer depends on (language, currency, page), and a version suffix you can bump on a format change (`boxoffice:catalog:event:42:v3`).
    - **Commit, then delete the key** — after the transaction, never inside it.
    - **Cache negative answers briefly** (a missing id for a few seconds), so repeated misses do not reach the database.

!!! warning "Common pitfalls"

    - **Updating the cache on write** instead of deleting: two concurrent writers can leave the older value in the cache forever (see [Invalidation](../invalidation/index.md#delete-vs-update)).
    - **Evicting before the transaction commits** (`@CacheEvict` + `@Transactional` in the wrong order).
    - **Caching `null` without meaning to** — or never caching it, and letting missing ids hit the database.
    - **Write-behind for data you cannot lose.**
    - **Keys that forget a dimension** (language, currency, user) — the cache serves the wrong answer, quickly.
    - **Java serialization of entities with lazy relations** — serializing a JPA entity can trigger queries or fail; cache DTOs, not entities.

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    CA["cache-aside<br/>the app fills on a miss"] --> INV["delete after commit<br/>→ Invalidation"]
    RT["read-through<br/>the cache library loads"] --> INV
    WA["write-around<br/>write the DB, skip the cache"] --> CA
    WT["write-through<br/>cache and DB together"] --> FRESH["fresh reads,<br/>slower writes"]
    WB["write-behind<br/>flush later, in batches"] --> LOSS["may lose acked writes:<br/>counters yes, seats never"]
    LOSS -.-> TX["seat holds stay in SQL<br/>→ Databases"]
    RA["refresh-ahead"] --> STAMP["no expiry spikes<br/>→ Failure modes"]
    KEYS["keys: namespace,<br/>version, small values"] --> CA
    L1["two-level cache<br/>Caffeine L1 + Redis"] --> HOT["hot keys<br/>→ Failure modes"]
```

**Palette components:** [`cache`](../../../reference/components/storage/index.md#cache) (Redis, the shared copy) · [`app`](../../../reference/components/compute/index.md#app) (`catalog` runs cache-aside and keeps a Caffeine L1 per replica) · [`sql`](../../../reference/components/storage/index.md#sql) (the source of truth behind every pattern) · [`worker`](../../../reference/components/compute/index.md#worker) (the flusher of write-behind counters) · [`pubsub`](../../../reference/components/messaging/index.md#pubsub) (tells every L1 copy to drop a key). **Scenarios:** `read-heavy-cache`, `search-autocomplete`. **Continues in:** [Invalidation and Eviction](../invalidation/index.md), [Failure Modes](../failure-modes/index.md), [Databases — the double-booking bug](../../databases/transactions/index.md#double-booking), [Hands-on 5](../../../hands-on/5/index.md), [Exercise: cache + database](../../../exercises/cache-db/index.md).

---

[^1]: AMAZON WEB SERVICES. [Database Caching Strategies Using Redis](https://docs.aws.amazon.com/whitepapers/latest/database-caching-strategies-using-redis/welcome.html){target="_blank"}. AWS Whitepaper.
[^2]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1. Byte Code LLC, 2020. Chapter 1 (cache tier) and chapter 6 (key-value store).
[^3]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2nd ed. O'Reilly. Chapters on storage and derived data.
