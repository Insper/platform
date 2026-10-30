!!! abstract "In this lab"

    - Add **Redis** to BoxOffice and implement **cache-aside** in `catalog`: read the cache first, load from PostgreSQL on a miss, store with a **TTL**.
    - Invalidate on writes, survive a Redis outage, and expose the outcome of every request in an `X-Cache` header.
    - **Measure** the hit ratio and its effect on p99 and capacity, with a realistic *skewed* popularity.
    - Reproduce a **cache stampede** on a hot key, then fix it with a distributed lock and TTL jitter — and measure the fix.

The catalog is the textbook read-heavy service: during the week of the stadium show, a few thousand popular events receive almost all the traffic, and the listing of "upcoming events in São Paulo" is requested thousands of times per minute while it changes a few times per day. Lab 2 showed that the database (through its connection pool) is what limits `catalog`. A **cache**[^1] answers the repeated questions from memory, so the database only sees the first one.

Caches are also, as every interview guide warns[^2], the most common source of subtle bugs in system design: stale data, cold starts, hot keys and stampedes. In this lab you will see each of them with your own measurements.

## Before you start { #before-you-start }

| | |
|---|---|
| **Time** | 2–3 hours |
| **You need** | the tools of lab 0; Docker with at least **6 GB**; ports 80, 8080 and **6379** free |
| **Directory** | every command runs from the root of your `boxoffice/` repository (Windows: inside WSL 2) |

``` { .bash .copy }
docker compose version        # Docker Compose v2.x (or newer)
java -version                 # 21 or newer
mvn -v                        # Apache Maven 3.9+
k6 version                    # k6 v1.0+
uv --version                  # uv (runs the Python helper scripts)
```

**Start state** — the end of lab 4:

``` { .tree title="boxoffice/ at the start of lab 5" }
boxoffice/
    docker-compose.yaml        # db, catalog-1..3, auth, gateway, edge
    infra/nginx/nginx.conf     # edge -> gateway
    load/  ... gateway.js login.js
    services/auth/  services/catalog/  services/gateway/
```

!!! tip "Catch up"

    Skipped or broke lab 4? Download [boxoffice-after-lab-4.zip](../4/boxoffice-after-lab-4.zip), unzip it and `cd boxoffice`. This lab **adds** `EventCache.java` and two k6 scripts, and **replaces** `docker-compose.yaml`, the catalog `pom.xml`, `application.yaml` and `EventController.java`; all are shown in full on the next pages and are in [`code/`](code/docker-compose.yaml).

## Slides

<div class="slides-embed">
  <iframe src="slides/caching.html" title="Slides: hands-on 5 — caching" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/caching.html){:target="_blank"}

!!! info "Theory connection"

    - Class 7, [Caching](../../classes/caching/index.md): [patterns](../../classes/caching/patterns/index.md) (cache-aside, read-through, write-through), [invalidation and TTL](../../classes/caching/invalidation/index.md), [failure modes](../../classes/caching/failure-modes/index.md) (stampede, hot keys, cold cache), [Redis](../../classes/caching/redis/index.md).
    - Component catalog: [Cache](../../reference/components/storage/index.md#cache).

## Before you measure: the playground

**Try it:** the `read-heavy-cache` scenario puts a cache in front of a SQL database. Run it and note the hit ratio and the database load. Then (1) lower the cache TTL or size and watch the hit ratio fall and p99 rise; (2) restart with a **cold** cache and watch the first seconds; (3) switch to the *spike* profile and look for the moment many misses hit the database at once. Write down: *"with a hit ratio of 90%, the database receives ___% of the reads"*.

<div class="sdp" data-scenario="read-heavy-cache" data-mode="compact" data-height="500"></div>

## What you will build

``` diagram-sim
sequenceDiagram
    autonumber
    actor Fan
    participant C as catalog
    participant R as redis
    participant DB as db
    Fan->>C: GET /catalog/events/42
    C->>R: GET catalog:event:42
    R-->>C: (nil) — miss
    C->>DB: SELECT event 42 JOIN venue
    DB-->>C: row
    C->>R: SET catalog:event:42 <json> PX 60000..66000
    C-->>Fan: 200 + X-Cache: MISS
    Fan->>C: GET /catalog/events/42 (again)
    C->>R: GET catalog:event:42
    R-->>C: <json> — hit
    C-->>Fan: 200 + X-Cache: HIT (no database access)
```

| Key | Value | TTL | Invalidated when |
|---|---|---|---|
| `catalog:event:{id}` | JSON of `GET /catalog/events/{id}` | `CACHE_TTL_EVENT` (60 s) | the event is updated or deleted |
| `catalog:events:city=…:page=…:size=…` | JSON of a listing page | `CACHE_TTL_LIST` (10 s) | never: it simply expires |
| `…:lock` | a random token | 2 s | released by its owner (stampede protection) |

## Steps

<div class="grid cards" markdown>

-   :material-database-arrow-right:{ .lg .middle } **[1. Cache-aside with Redis](cache-aside/index.md)**

    ---

    Redis in Compose, the `EventCache` component, keys, TTLs, invalidation, behaviour when Redis is down.

-   :material-flash-alert:{ .lg .middle } **[2. Stampede](stampede/index.md)**

    ---

    One hot key expires, 200 requests miss at once: reproduce it, measure it, fix it.

</div>

## Measure it: hit ratio, p99 and capacity { #measure-it }

The load script mimics real popularity: **80% of the detail requests go to the 2,000 hottest events** (1% of the catalog); listings are spread over 10 cities and the first 3 pages. It reads the `X-Cache` header of every response, so k6 reports the hit ratio and separate latencies for hits and misses.

``` { .javascript title="load/cache.js" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/5/code/load/cache.js"
```

Run the same load **without** and **with** the cache — the switch is an environment variable, no rebuild needed:

``` { .bash .copy }
# 1. no cache (every request goes to PostgreSQL)
CACHE_ENABLED=false docker compose up -d --wait     # --wait: until the recreated replicas are healthy
k6 run -q -e RATE=300 -e DURATION=30s load/cache.js > /dev/null   # warm-up: new replicas are cold JVMs
k6 run -e RATE=300 load/cache.js

# 2. cache on, cold: warm up the new replicas, then flush Redis right before the test
CACHE_ENABLED=true docker compose up -d --wait
k6 run -q -e RATE=300 -e DURATION=30s load/cache.js > /dev/null
docker compose exec redis redis-cli FLUSHALL
k6 run -e RATE=300 load/cache.js

# 3. cache on, warm: run it again immediately
k6 run -e RATE=300 load/cache.js

# 4. capacity: repeat the lab 2 sweep, now with the cache, through the edge
BASE_URL=http://localhost OUT=results/lab5-cache bash scripts/sweep.sh 300 600 900 1200 1500
```

Also look at the cache from Redis's side:

``` { .bash .copy }
docker compose exec redis redis-cli INFO stats | grep -E "keyspace_(hits|misses)"
docker compose exec redis redis-cli INFO memory | grep used_memory_human
docker compose exec redis redis-cli --scan --pattern 'catalog:event:*' | wc -l
docker compose exec redis redis-cli TTL catalog:event:1
```

Record in `results/lab5.md`:

``` { .markdown title="results/lab5.md" .copy }
# Lab 5 — caching

## Same load (300 req/s, 80% of details on 1% of events)
| Run | cache_hit | p50 (ms) | p99 (ms) | p99 detail | p99 list | latency_hit p99 | latency_miss p99 |
|---|---:|---:|---:|---:|---:|---:|---:|
| no cache |  |  |  |  |  |  |  |
| cold cache |  |  |  |  |  |  |  |
| warm cache |  |  |  |  |  |  |  |

## Capacity (sweep through the edge, 3 replicas)
| Setup | Capacity with p99 < 300 ms (req/s) |
|---|---:|
| lab 3, no cache | |
| lab 5, cache | |

## Redis
- keyspace_hits / keyspace_misses: ____ / ____ → hit ratio ____ %
- keys cached: ____ ; memory used: ____

## Stampede (see step 2)
| CACHE_STAMPEDE_PROTECTION | cache_misses in 1 min | p99 (ms) | max (ms) |
|---|---:|---:|---:|
| false | | | |
| true  | | | |

## Questions
1. With hit ratio h, the database receives (1 − h) of the reads. Which hit ratio did you need to double the capacity?
2. Change HOT_SHARE to 0.2 (popularity almost uniform). What happens to the hit ratio, and why?
3. An admin changes the price of event 42. For how long can a fan see the old price on the listing page? On the event page?
```

??? question "Think first: why can a warm-cache run be much better than a cold one, if both use the same code?"

    In the cold run, every first request for a key is a miss — and with 2,000 hot events plus thousands of cold ones, the first seconds look exactly like the no-cache run. A cache is only as good as its **hit ratio**, and the hit ratio depends on the **key space**, the **popularity distribution** and the **TTL**, not on Redis's speed. That is why deploys that flush caches, or new nodes with empty caches, cause latency spikes in production — and why some systems *warm* caches before taking traffic. (In this lab the gap only shows when the TTL outlives the test: see the note below.)

!!! note "If your numbers differ"

    The hit ratio after one minute depends on the TTLs and on how many distinct keys k6 touched: at 300 req/s, a one-minute run with a cold cache reaches about 70% (72% in a run for this lab). With the default 60 s `CACHE_TTL_EVENT`, a second run right after is **not** much higher (72% again in that run): the keys written in the first seconds of the cold run expire in the first seconds of the next one, so each hot key misses about once per minute in both. Start the stack with `CACHE_TTL_EVENT=5m` (longer than a run) to see a warm cache win: 83% warm against 71% cold in a run for this lab. Hits should be faster than misses (about twice as fast at p50 in that run: with most reads absorbed by the cache, PostgreSQL answers the remaining misses quickly too); if they are not, Redis or the network is the bottleneck (`docker stats`). Your capacity gain depends on how much of the original load was the listing.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| no `X-Cache` header | the catalog image was not rebuilt | `docker compose up --build -d` |
| `X-Cache: MISS` on every request | Redis unreachable (see the catalog logs: `cache read failed`), or `CACHE_TTL_*` too short | `docker compose ps redis`; `docker compose logs catalog-1 \| grep cache` |
| `X-Cache: BYPASS` | `CACHE_ENABLED=false` is still set in your shell | `unset CACHE_ENABLED && docker compose up -d` |
| env var changes have no effect | the containers were not recreated | always `VAR=value docker compose up -d` (not `restart`) |
| `Bind for 0.0.0.0:6379 failed` | a local Redis is running | stop it or map `"16379:6379"` |
| the stampede run shows the same misses with and without protection | the TTL is not short, or the variable did not reach the replicas | `docker compose exec catalog-1 env \| grep CACHE_` |
| old data after an admin update on the listing page | listing keys are not evicted, by design | wait `CACHE_TTL_LIST` (10 s) — it is the bounded staleness of the design |

!!! success "Best practices in this lab"

    - **The cache is optional**: 200 ms client timeouts and every Redis error treated as a miss (`application.yaml`, `read()` in `EventCache.java`); the deliverable checks that stopping Redis does not break `catalog`. Why: [failure modes — the cache goes down](../../classes/caching/failure-modes/index.md#cache-down).
    - **Commit, then delete**: `EventController.java` evicts the key after `updateEvent` returns. Why: [invalidation — delete, don't update](../../classes/caching/invalidation/index.md#delete-vs-update).
    - **TTL with jitter on every key** (`withJitter` in `EventCache.java`), so a warm-up does not schedule an avalanche. Why: [avalanche](../../classes/caching/failure-modes/index.md#avalanche).
    - **One rebuild per key** under load (`SET … NX PX 2000` lock): misses dropped from 2,238 to 19 in a test run (200 VUs, 60 s). Why: [stampede](../../classes/caching/failure-modes/index.md#stampede).
    - **Measure, don't assume**: `X-Cache` plus a counter per outcome, and the same load before and after. Why: [hit-ratio math](../../classes/caching/index.md#hit-ratio-math).

## Clean up

``` { .bash .copy }
CACHE_TTL_LIST=10s CACHE_STAMPEDE_PROTECTION=false docker compose up -d   # back to the defaults
docker compose exec redis redis-cli FLUSHALL                               # optional: empty the cache
docker compose down
```

Keep everything: lab 6 adds `inventory`, a read replica and PgBouncer to this stack.

## Deliverable

- [ ] Redis in `docker-compose.yaml`; `EventCache` and the new `EventController` in `catalog`.
- [ ] `X-Cache` visible: `curl -sI localhost/catalog/events/1` twice shows `MISS` then `HIT`.
- [ ] An update through the gateway (admin token) evicts the event: the next read is a `MISS` with the new data.
- [ ] Stopping Redis (`docker compose stop redis`) does **not** break the catalog: requests answer with `X-Cache: MISS`.
- [ ] `results/lab5.md` complete: three runs, capacity, Redis stats, stampede table and the three answers.
- [ ] Repository tagged `lab5`; [quiz](quiz.md) answered.

## End state

``` { .tree title="changed in lab 5" }
boxoffice/
    docker-compose.yaml        # replaced: + redis (6379), catalog gets REDIS_* and CACHE_* variables
    load/cache.js  load/stampede.js                       # new
    services/catalog/pom.xml                              # replaced: + spring-boot-starter-data-redis
    services/catalog/src/main/resources/application.yaml  # replaced: Redis + cache settings
    services/catalog/src/main/java/boxoffice/catalog/EventCache.java        # new
    services/catalog/src/main/java/boxoffice/catalog/EventController.java   # replaced
    results/lab5.md
```

Next: [Lab 6 — Data at scale](../6/index.md).

[^1]: Redis documentation, [Client-side caching and cache-aside](https://redis.io/docs/latest/develop/clients/client-side-caching/){target="_blank"} and [Key eviction](https://redis.io/docs/latest/develop/reference/eviction/){target="_blank"}.
[^2]: Alex Xu, *System Design Interview — An Insider's Guide*, vol. 1, 2020 — chapter 1, "Cache".
