**Cache-aside** (also called *lazy loading*) is the most common caching pattern: the application talks to both the cache and the database, and the cache only ever contains what somebody asked for recently.

| Pattern | Who loads the cache | Writes | Used here? |
|---|---|---|---|
| **Cache-aside** | the application, on a miss | go to the database; the app evicts/updates the key | **yes** |
| Read-through | the cache itself (a loader plugged into it) | — | no |
| Write-through | — | app writes to the cache, which writes to the database synchronously | no |
| Write-behind | — | cache acknowledges, writes to the database later (risk of loss) | no |

## 1. Redis in Compose

Add a `redis` service and give the catalog replicas the cache settings (the whole file, for reference):

``` { .yaml title="docker-compose.yaml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/5/code/docker-compose.yaml"
```

| Setting | Why |
|---|---|
| `--maxmemory 256mb --maxmemory-policy allkeys-lru` | a cache must be **bounded**; when full, Redis evicts the least recently used keys instead of failing writes |
| `--save "" --appendonly no` | no persistence: a cache can always be rebuilt from the database (and a restart is a cold start — measure it!) |
| `depends_on: redis: condition: service_healthy` | start the replicas after Redis answers `PING` (but they also survive without it, see below) |
| `CACHE_*` variables | turn the cache on/off, change TTLs and stampede protection **without rebuilding** |

## 2. Dependencies and configuration

Add the Redis starter to `services/catalog/pom.xml` (it brings Lettuce, a non-blocking Redis client, and `StringRedisTemplate`):

``` { .xml title="services/catalog/pom.xml" .copy linenums="1" hl_lines="59-63" }
--8<-- "docs/2027.1/hands-on/5/code/services/catalog/pom.xml"
```

``` { .yaml title="services/catalog/src/main/resources/application.yaml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/5/code/services/catalog/src/main/resources/application.yaml"
```

The **200 ms timeouts** matter: Lettuce's default command timeout is 60 seconds. If Redis hangs, every request would hang with it — a cache that is supposed to make things faster would take the whole service down.

## 3. The cache component

``` { .java title="services/catalog/src/main/java/boxoffice/catalog/EventCache.java" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/5/code/services/catalog/src/main/java/boxoffice/catalog/EventCache.java"
```

Design decisions, one by one:

- **Store the response JSON**, not Java objects. A hit returns the string as-is: no database, no object mapping, no serialization. It is also readable with `redis-cli GET`.
- **Jackson 3**: Spring Boot 4 ships Jackson 3 (package `tools.jackson`). The JSON bean is a `JsonMapper`, and its exceptions are unchecked, so `toJson` needs no `try/catch`.
- **TTL with jitter** (`+0–10%`): keys written in the same second do not all expire in the same second.
- **Redis failures become misses** (`catch (DataAccessException e)`): the cache is an optimization, never a hard dependency. With Redis down, `catalog` is as slow as before lab 5, but it works.
- **A counter per outcome** (`catalog.cache.requests{result=HIT|MISS|BYPASS}`) on every replica, visible at `/actuator/metrics/catalog.cache.requests` — and on Grafana in lab 8.
- The **stampede protection** branch is explained in [step 2](../stampede/index.md); it is off by default so that you can see the problem first.

## 4. The controller

The GET endpoints now return `ResponseEntity<String>` — the JSON comes from the cache or is produced on a miss — plus the `X-Cache` header. Writes **evict** the event's key after the database commit:

``` { .java title="services/catalog/src/main/java/boxoffice/catalog/EventController.java" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/5/code/services/catalog/src/main/java/boxoffice/catalog/EventController.java"
```

!!! warning "Why evict instead of updating the key?"

    Two concurrent updates can write the cache in the opposite order of the database commits, leaving the *older* version cached until the TTL. Deleting the key is idempotent: the next read loads whatever the database has. Even eviction has a race (a reader loads the old row just before the update commits and writes it *after* the eviction), which is why every key also has a TTL: **TTL is the safety net of every invalidation scheme**.

Listing pages are **not** evicted: a change to one event can affect thousands of listing keys (every city/page that contains it). They expire after `CACHE_TTL_LIST` (10 s) instead — a deliberate choice of **bounded staleness** for the listing in exchange for simplicity.

## 5. Check it

``` { .bash .copy }
docker compose up --build -d
curl -s -o /dev/null -D - localhost/catalog/events/42 | grep -iE "x-cache|x-instance"
curl -s -o /dev/null -D - localhost/catalog/events/42 | grep -iE "x-cache|x-instance"
docker compose exec redis redis-cli GET catalog:event:42
docker compose exec redis redis-cli TTL catalog:event:42
```

<!-- termynal -->
``` shell
> curl -s -o /dev/null -D - localhost/catalog/events/42 | grep -iE "x-cache|x-instance"
X-Instance: catalog-2
X-Cache: MISS
> curl -s -o /dev/null -D - localhost/catalog/events/42 | grep -iE "x-cache|x-instance"
X-Instance: catalog-3
X-Cache: HIT
> docker compose exec redis redis-cli TTL catalog:event:42
(integer) 62
```

The second request was served by **another replica** (if both landed on the same one, run it again: the gateway alternates the replicas) and was still a hit: the cache is **shared** (distributed), not local to each JVM. With a local cache (Caffeine, a `HashMap`), each of the three replicas would warm up separately and could hold a different version of the same event.

Now break it on purpose:

``` { .bash .copy }
# invalidation: update event 42 as admin, then read it
ADMIN=$(curl -s -X POST localhost/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@boxoffice.dev","password":"boxoffice-admin"}' | jq -r .accessToken)
curl -s -X PUT localhost/catalog/events/42 -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"title":"Festival #42 (new lineup)","category":"FESTIVAL","venueId":45,"startsAt":"2027-03-03T14:00:00-03:00","priceFrom":175}' > /dev/null
curl -s -D - localhost/catalog/events/42 | grep -iE "x-cache|title"

# resilience: no Redis, still working (slower, all MISS)
docker compose stop redis
curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" -D - localhost/catalog/events/42 | grep -iE "x-cache|^200"
docker compose start redis
```

!!! tip "In the interview"

    When you add a cache, say four things: **what** is cached (and the key), the **TTL and invalidation** strategy (and the staleness you accept), the expected **hit ratio** (and why — popularity skew), and **what happens when the cache fails** (fall back to the database, protected against a stampede). Interviewers probe the last two.

Next: [2. Stampede](../stampede/index.md).
