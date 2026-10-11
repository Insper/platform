---
marp: true
lang: en
title: Hands-on 8 — In-Memory Cache
description: Platforms, Microservices, DevOps and APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Platforms, Microservices, DevOps and APIs · Hands-on 8</div>

# Hands-on 8 — In-Memory Cache

**One shared Redis cache for every replica, so the database answers only on a miss**

<!--
Outline: (1) why a shared cache once the gateway scales; (2) in-memory databases and cache-aside;
(3) Redis data structures and persistence; (4) compose; (5) Spring Cache annotations; (6) run, measure.
-->

---

## Three replicas, three caches?

<div class="q">

The gateway runs as **3 replicas**, each JVM with its own local cache. Replica 1 caches account 42.
The next request for account 42 lands on replica 2. **What happens?**

</div>

* Replica 2 has nothing cached → **another database query**.
* Each replica warms up its own cache: the database load barely drops.
* The fix: a **shared external cache** — all replicas read from and write to the **same store**.

---

## In-memory databases

| | Disk-based | In-memory |
|---|---|---|
| **Storage** | disk (HDD / SSD) | RAM |
| **Read latency** | 1–10 ms | < 1 ms |
| **Write latency** | 5–20 ms | < 1 ms |
| **Durability** | persistent by default | configurable |
| **Capacity** | terabytes | gigabytes (RAM-bound) |
| **Use case** | source of truth | cache, sessions, counters |

---

## Cache-aside

1. Service → Redis: `GET account:42`
2. **Hit** → return the value. Done.
3. **Miss** (`nil`) → Service → PostgreSQL: `SELECT * FROM accounts WHERE id = 42`
4. The database returns the row.
5. Service → Redis: `SET account:42 ... EX 300` — the next read is a hit.

<div class="ok">

The database stays the **source of truth**; the cache only saves round-trips.

</div>

---

<!-- _class: tight -->

## Redis

Remote Dictionary Server: cache, session store, message broker — the de-facto distributed cache.

| Type | Key commands | Typical use |
|---|---|---|
| **String** | `SET` `GET` `INCR` `EXPIRE` | cached JSON, counters, rate-limit tokens |
| **Hash** | `HSET` `HGET` `HGETALL` | session objects, configuration maps |
| **List** | `LPUSH` `RPOP` `LRANGE` | task queues, activity feeds |
| **Set** | `SADD` `SMEMBERS` `SISMEMBER` | unique visitors, tags |
| **Sorted Set** | `ZADD` `ZRANGE` `ZRANK` | leaderboards, priority queues |
| **Stream** | `XADD` `XREAD` `XACK` | durable event logs, fan-out |

<p class="small">Unlike Memcached (strings only), Redis has native data structures with O(1) or O(log n) operations.</p>

---

## Persistence

| Mode | How it works | Trade-off |
|---|---|---|
| **RDB** (snapshot) | point-in-time snapshot at intervals | fast restarts; may lose seconds of data |
| **AOF** (append-only file) | logs every write; replayed on restart | near-zero loss; larger files, slower restart |
| **RDB + AOF** | both | recommended for production |
| **None** | pure in-memory | acceptable for a pure cache |

This hands-on enables **AOF**: `--appendonly yes`.

---

## Architecture

internet → `:80` **Nginx** → gateway ×3 → `auth`, `account` → **Redis** `:6379` → PostgreSQL *(on a miss only)*

- All replicas share **one** Redis: an entry written via replica 1 is readable via replicas 2 and 3.
- Steps: **1** Docker Compose → **2** Spring Boot → **3** run and measure.

---

## 1 · Docker Compose

<div class="cols">
<div>

```yaml
  redis:
    image: redis:7-alpine
    hostname: redis
    ports:
      - 6379:6379
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes

volumes:
  redis_data:
```

</div>
<div>

```yaml
  account:
    # ... build, DATABASE_* ...
    environment:
      REDIS_HOST: redis
      REDIS_PORT: 6379
    deploy:
      replicas: 2
    depends_on:
      - db
      - redis
```

</div>
</div>

Same `REDIS_HOST` / `REDIS_PORT` on every service that uses the cache (e.g. `auth`).

---

## 2 · Spring Boot: dependencies and config

<div class="cols">
<div>

- `spring-boot-starter-data-redis` — Lettuce, the Redis client.
- `spring-boot-starter-cache` — `@Cacheable`, `@CachePut`, `@CacheEvict`.
- `@EnableCaching` on the main class.

</div>
<div>

```yaml
spring:
  data:
    redis:
      host: ${REDIS_HOST:localhost}
      port: ${REDIS_PORT:6379}
  cache:
    type: redis
    redis:
      time-to-live: 300000
      cache-null-values: false
```

</div>
</div>

<p class="small"><code>type: redis</code> replaces the default in-memory <code>ConcurrentMapCache</code>; TTL of 5 minutes; <code>null</code> is not cached.</p>

---

## 2 · `@Cacheable`: read-through

```java
@Cacheable(value = "accounts", key = "#id")
public AccountOut findById(String id) {
    return accountRepository.findById(id)
        .map(AccountOut::from)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
}
```

- **First call** for `id = "42"`: the method runs, queries the database, stores `accounts::42` in Redis.
- **Next calls**: the method body is **skipped**; the value comes straight from Redis.

<p class="small">Annotations go on <strong>service-layer</strong> methods, not on controllers or repositories.</p>

---

## 2 · Keeping the cache consistent

<div class="cols">
<div>

```java
@CachePut(value = "accounts", key = "#id")
public AccountOut update(String id, AccountIn dto)
```

```java
@CacheEvict(value = "accounts", key = "#id")
public void delete(String id)
```

</div>
<div>

| Annotation | Use on | Behaviour |
|---|---|---|
| `@Cacheable` | GET | cached; run only on miss |
| `@CachePut` | PUT/PATCH | always run; update cache |
| `@CacheEvict` | DELETE | run; remove the key |

</div>
</div>

<p class="small"><code>@CacheEvict(value = "accounts", allEntries = true)</code> clears the whole cache (bulk updates).</p>

---

## 2 · JSON serialisation

Default Java serialisation stores **unreadable binary**. A `RedisConfig` bean switches to JSON:

```java
@Bean
public RedisCacheConfiguration cacheConfiguration(ObjectMapper objectMapper) {
    return RedisCacheConfiguration.defaultCacheConfig()
        .serializeValuesWith(RedisSerializationContext.SerializationPair
            .fromSerializer(new GenericJackson2JsonRedisSerializer(objectMapper)))
        .entryTtl(Duration.ofMinutes(5))
        .disableCachingNullValues();
}
```

<div class="warn">

Cached classes (`AccountOut`) must be JSON-serialisable: no-arg constructor, public fields or getters, `@JsonIgnoreProperties(ignoreUnknown = true)`.

</div>

---

## 3 · Run and see a hit

```bash
docker compose up -d --build
curl -s http://localhost/accounts/42 | jq    # 1st: miss, hits the database
docker compose exec redis redis-cli
> KEYS accounts::*                           # 1) "accounts::42"
> GET "accounts::42"                         # {"id":"42","name":"Ada Lovelace",...}
curl -s http://localhost/accounts/42 | jq    # 2nd: hit
docker compose logs account --tail 20        # no database query this time
```

---

## 3 · Measure

```bash
curl -o /dev/null -s -w "Cache miss: %{time_total}s\n" http://localhost/accounts/42
curl -o /dev/null -s -w "Cache hit:  %{time_total}s\n" http://localhost/accounts/42
```

- Typical: **miss 0.058 s**, **hit 0.004 s** — 10–15× faster, no database round-trip.
- `TTL "accounts::42"` — seconds until the key expires; then the next read is a miss again.
- `redis-cli INFO stats` → `keyspace_hits` / `keyspace_misses`. Healthy: **> 90 % hits** on read-heavy loads.

<p class="small">High miss rate? Increase the TTL or pre-warm the cache on startup.</p>

---

## Pitfalls

<div class="warn">

A cache can serve **stale data**: `@CachePut` / `@CacheEvict` on writes and a **TTL** keep it eventually consistent.

</div>

- Forgetting `@EnableCaching` or `type: redis` → no shared cache.
- Binary values in `redis-cli` → JSON serialiser missing.
- `MONITOR` logs **every command**: use with caution in production.
- Port `6379` is published only for development; in production keep Redis inside the Docker network.

---

## Takeaways

1. With replicas, a **local** cache per JVM is not enough: use a **shared** cache (Redis).
2. **Cache-aside**: check the cache, go to the database only on a **miss**, then populate the cache.
3. Redis is in-memory (< 1 ms) with rich data structures; **AOF** adds durability.
4. Spring Cache: `@Cacheable` reads, `@CachePut` updates, `@CacheEvict` invalidates.
5. A **TTL** bounds staleness; **JSON** serialisation keeps the cache inspectable.
6. Verify with `redis-cli` (`KEYS`, `GET`, `TTL`, `INFO stats`) and compare miss × hit latency.
