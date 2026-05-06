!!! tip "Main Goal"

    The main goal of this hands-on is to add **Redis** as a shared in-memory cache to the microservice platform, reducing database load and improving response times — especially relevant now that the gateway runs as multiple replicas behind Nginx.

When the gateway scales horizontally, each JVM instance has its own local cache. A request routed to replica 1 caches an account; the same account fetched via replica 2 triggers another database query. A **shared external cache** (Redis) solves this: all replicas read from and write to the same store.

## In-Memory Databases

An **in-memory database** (IMDB) keeps its primary working dataset in RAM rather than on disk. Because RAM access latency is measured in nanoseconds while disk access is measured in milliseconds, IMDBs are orders of magnitude faster for read-heavy workloads.

| | Traditional (disk-based) | In-memory |
|---|---|---|
| **Storage** | Disk (HDD / SSD) | RAM |
| **Read latency** | 1–10 ms | < 1 ms |
| **Write latency** | 5–20 ms | < 1 ms |
| **Durability** | Persistent by default | Configurable |
| **Capacity** | Terabytes | Gigabytes (RAM-bound) |
| **Use case** | Source of truth | Cache, sessions, counters |

The typical production pattern is **cache-aside**: the application checks the in-memory store first; only on a **cache miss** does it query the database and then populate the cache with the result.

``` mermaid
flowchart LR
    app[Service] -->|"1. GET account:42"| redis[(Redis)]
    redis -->|"2a. cache hit → return"| app
    redis -->|"2b. cache miss (nil)"| app
    app -->|"3. SELECT * FROM accounts\nWHERE id = 42"| db[(PostgreSQL)]
    db -->|"4. return row"| app
    app -->|"5. SET account:42 ...EX 300"| redis
```

## Redis

[Redis](https://redis.io){target="_blank"} (Remote Dictionary Server) is the most widely deployed in-memory data structure store. It is used as a **cache, session store, message broker, and real-time data structure engine** simultaneously — and it is the de-facto standard for distributed caching in microservice architectures.

### Data structures

Unlike Memcached (strings only), Redis provides native data structures, each with O(1) or O(log n) operations:

| Type | Key commands | Typical use case |
|---|---|---|
| **String** | `SET` `GET` `INCR` `EXPIRE` | Cached JSON values, counters, rate-limit tokens |
| **Hash** | `HSET` `HGET` `HGETALL` | User session objects, configuration maps |
| **List** | `LPUSH` `RPOP` `LRANGE` | Task queues, activity feeds (chronological) |
| **Set** | `SADD` `SMEMBERS` `SISMEMBER` | Unique visitors, tags, friend graphs |
| **Sorted Set** | `ZADD` `ZRANGE` `ZRANK` | Leaderboards, priority queues, time-series indices |
| **Stream** | `XADD` `XREAD` `XACK` | Durable event logs, fan-out messaging |

### Persistence options

Redis is not purely volatile. Two persistence mechanisms allow controlled durability:

| Mode | How it works | Trade-off |
|---|---|---|
| **RDB (snapshot)** | Forks the process and writes a point-in-time snapshot to disk at configured intervals | Fast restarts; may lose seconds of data |
| **AOF (append-only file)** | Logs every write command; replayed on restart | Near-zero data loss; larger files, slower restart |
| **RDB + AOF** | Both active simultaneously | Recommended for production |
| **No persistence** | Pure in-memory; data lost on restart | Acceptable for a pure cache |

For this hands-on we enable AOF (`--appendonly yes`), providing durability without sacrificing write performance.

## Architecture

Adding Redis to the platform introduces a shared cache layer between all microservice replicas and the database:

``` mermaid
flowchart LR
    subgraph lb [Load Balancer]
        nginx["Nginx\n:80"]
    end
    subgraph api [Trusted Layer]
        nginx e1@==> gw1["gateway\n(replica 1)"]
        nginx e2@==> gw2["gateway\n(replica 2)"]
        nginx e3@==> gw3["gateway\n(replica 3)"]
        gw1 & gw2 & gw3 --> auth
        gw1 & gw2 & gw3 --> account
        auth & account e4@-->|"cache read/write"| redis["Redis\n:6379"]:::highlighted
        redis -->|"cache miss only"| db@{ shape: cyl, label: "PostgreSQL" }
    end
    internet e0@==>|":80"| nginx
    e0@{ animate: true }
    e1@{ animate: true }
    e2@{ animate: true }
    e3@{ animate: true }
    e4@{ animate: true }
    classDef highlighted fill:#fcc
```

All three gateway replicas share the same Redis instance. A cache entry written by replica 1 is immediately readable by replicas 2 and 3, eliminating redundant database queries regardless of which instance handles the next request.

<div class="grid cards" markdown>

-   __b. Docker Compose__

    ---

    Add the `redis` service to `compose.yaml` and configure each microservice to connect to it.

    [Docker Compose](./docker/){ .md-button }

-   __c. Spring Boot__

    ---

    Add Spring Data Redis dependencies and configure `@Cacheable`, `@CachePut`, and `@CacheEvict` on service methods.

    [Spring Boot](./spring/){ .md-button }

-   __d. Run__

    ---

    Start the full stack, verify cache hits and misses via Redis CLI, and measure the latency improvement.

    [Run](./run/){ .md-button }

</div>
