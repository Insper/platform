**Redis** (*REmote DIctionary Server*) is the default answer to "which distributed cache?" — and much more than a cache. It is an in-memory server of **data structures**: strings, hashes, lists, sets, sorted sets, streams and more, each with atomic operations. BoxOffice uses it as the catalog cache, but also as the session store, the rate limiter, the waiting-room line and the "people viewing now" counter. Knowing what each structure costs, how Redis persists and replicates, and how Redis Cluster spreads keys is what lets you use it well — and recognise when it is the wrong tool.

---

## What makes Redis fast

- **Everything is in RAM.** A read is a hash-table lookup plus a memory copy; disk is only used for persistence, in the background.
- **One thread executes commands.** Commands run one at a time on a single main thread (since Redis 6, separate I/O threads can handle network reads and writes). There are no locks inside the server, and **every command is atomic**: no other command runs in the middle of an `INCR`.
- **Simple protocol, small values.** Most commands are O(1) or O(log n). In the same data center, a round trip of a small `GET` costs a fraction of a millisecond, dominated by the network.

The single thread is also Redis's main constraint: one slow command (an O(n) scan of a big key, a long Lua script) **blocks every client**. Throughput per node is high — on the order of 100,000 simple commands per second or more on typical hardware, an illustrative figure you should verify with `redis-benchmark` on your own setup — and scaling beyond one node means [Redis Cluster](#cluster).

### Redis, Valkey and the alternatives (2026)

In 2024 Redis changed from the open-source BSD license to source-available licenses (RSALv2/SSPLv1). In response, the Linux Foundation started **Valkey**, a fork of Redis 7.2 backed by several cloud providers, which stays BSD-licensed and protocol-compatible. In 2025, Redis 8 added the open-source AGPLv3 as a license option. For this course — and in most interviews — "Redis" means the protocol and data model, which Redis and Valkey share[^1][^2].

| | Redis / Valkey | Memcached | Dragonfly |
|---|---|---|---|
| Data model | rich data structures | strings only | Redis-compatible |
| Threads | single command thread (+ I/O threads) | multi-threaded | multi-threaded, shared-nothing |
| Persistence | RDB, AOF | none | snapshots |
| Replication / cluster | built-in (Sentinel, Cluster) | none (clients shard) | built-in replication |
| When | default choice | a pure, simple, very large cache of blobs | when one big node must replace a cluster |

---

## Data structures and what BoxOffice does with them

| Type | Key commands | Complexity | BoxOffice use |
|---|---|---|---|
| **String** | `GET` `SET` `INCR` `EXPIRE` `MGET` | O(1) | cached event JSON; counters; idempotency markers |
| **Hash** | `HSET` `HGET` `HGETALL` `HINCRBY` | O(1) per field | session (`session:9f1c` → user, roles, cart); event fields updated separately |
| **List** | `LPUSH` `RPOP` `LRANGE` | O(1) at the ends | simple work queues; "last 10 events viewed" |
| **Set** | `SADD` `SISMEMBER` `SMEMBERS` | O(1) per member | tags of an event; ids already notified |
| **Sorted set** | `ZADD` `ZRANK` `ZRANGE` `ZPOPMIN` | O(log n) | **waiting room**: fans ordered by arrival time; top-selling events |
| **HyperLogLog** | `PFADD` `PFCOUNT` | O(1), ~12 KB per counter | unique visitors per event (~0.81% standard error) |
| **Bitmap** | `SETBIT` `BITCOUNT` | O(1) per bit | daily active users by user id |
| **Geo** | `GEOADD` `GEOSEARCH` | O(log n) | "events near me" |
| **Stream** | `XADD` `XREADGROUP` `XACK` | O(1) append | lightweight event log with consumer groups (Kafka is covered in [Messaging](../../messaging/index.md)) |

```text title="redis-cli — a tour with BoxOffice data"
> SET boxoffice:catalog:event:42:v3 '{"id":42,"name":"Stadium Show"}' EX 300
OK
> TTL boxoffice:catalog:event:42:v3
(integer) 300
> HSET session:9f1c user 1017 roles fan cart 3
(integer) 3
> INCR views:event:42
(integer) 1
> ZADD waitingroom:42 1760695200123 fan:1017 1760695200456 fan:2203
(integer) 2
> ZRANK waitingroom:42 fan:2203
(integer) 1
> ZPOPMIN waitingroom:42 1
1) "fan:1017"
2) "1760695200123"
> PFADD visitors:event:42 fan:1017 fan:2203 fan:1017
(integer) 1
> PFCOUNT visitors:event:42
(integer) 2
```

The waiting room is a good example of choosing a structure: a sorted set with the arrival time (in milliseconds) as the score gives each fan their position in O(log n) (`ZRANK`), and lets the admission job take the next 500 fans in one command (`ZPOPMIN waitingroom:42 500`).

### Round trips: pipelining and multi-key commands

At 0.5 ms per round trip, reading 100 keys one by one costs 50 ms. `MGET` (or **pipelining** — sending many commands without waiting for each reply) does it in about one round trip. A page that needs many cached objects should fetch them together.

---

## Atomicity { #atomicity }

Because commands run one at a time, a single command is atomic. For more than one command, Redis offers three tools:

| Tool | What it gives | Limits |
|---|---|---|
| **Single command** (`INCR`, `SET ... NX`, `ZPOPMIN`) | atomic read-modify-write | one key, one operation |
| **`MULTI` / `EXEC`** (+ `WATCH`) | queue commands and run them together, without interleaving; `WATCH` aborts if a watched key changed (optimistic locking) | **no rollback**: if a command fails, the others still run; cannot use a read result inside the transaction |
| **Lua scripts** (`EVAL`) / **functions** (`FCALL`, Redis 7+) | arbitrary logic executed atomically on the server | blocks the server while it runs — keep scripts short |

A fixed-window **rate limiter** for the API gateway in two commands:

```text title="redis-cli — 100 requests per minute per client"
> INCR rl:client:abc:202610171000
(integer) 1
> EXPIRE rl:client:abc:202610171000 60 NX
(integer) 1
```

If the counter returned by `INCR` exceeds 100, the request is rejected. (`EXPIRE ... NX` sets the expiry only the first time. More refined algorithms — token bucket, sliding window — are in [Traffic & Edge](../../edge/api-gateway/index.md).)

### A seat pre-hold in Redis — and why SQL still decides

During the flash sale, thousands of fans click the same good seats. A Redis **pre-hold** can reject most of the losers in microseconds, before they reach the database:

```text title="redis-cli — pre-hold seat A-12 of event 42 for 10 minutes"
> SET hold:42:A-12 fan:1017 NX PX 600000
OK
> SET hold:42:A-12 fan:2203 NX PX 600000
(nil)
```

`NX` makes the set succeed only if nobody holds the key; `PX 600000` releases it automatically after 10 minutes. The second fan gets `nil` immediately: "seat taken".

It is tempting to stop there. Do not. The fan who got `OK` still goes to the `inventory` service, which takes the hold **in a PostgreSQL transaction** with a constraint that makes double booking impossible ([Databases — the double-booking bug](../../databases/transactions/index.md#double-booking)). Redis is a **fast filter**; the database **decides**. Why:

- Redis replication is asynchronous: after a failover, the new primary may not have the hold that was just granted — two fans could both get `OK` ([replication](#replication)).
- Memory pressure, a `FLUSHALL` by mistake, or a cache restart without persistence erase holds silently.
- The order, the payment and the ticket live in SQL; the seat state must be in the same transaction as them.

If Redis loses a pre-hold, the worst case is that two fans reach the database and one of them loses there. Correctness never depended on Redis.

---

## Persistence { #persistence }

Redis keeps data in memory but can write it to disk, so a restart does not start cold.

| Mode | How it works | Data loss on crash | Restart | Use |
|---|---|---|---|---|
| **None** | memory only | everything | cold, fast | pure cache that can be rebuilt |
| **RDB** (snapshot) | forks and writes a point-in-time snapshot every N minutes / M writes | since the last snapshot (minutes) | fast load of a compact file | caches that should restart warm; backups |
| **AOF** (append-only file) | logs every write; `appendfsync everysec` (default) or `always` | ~1 s with `everysec`; ~none with `always` (slow) | replays the log (slower) | Redis as a primary store for non-critical data (sessions) |
| **RDB + AOF** | both | as AOF | AOF used for recovery | the recommended setting when data matters |

For a cache, **RDB or nothing** is usually enough. If you find yourself tuning `appendfsync always`, ask whether this data belongs in a database.

---

## Replication and failover { #replication }

A Redis primary can have several **replicas** that receive a stream of its writes. Replicas serve reads (slightly stale) and are candidates for promotion if the primary fails.

``` diagram-sim
flowchart LR
    APP["catalog service"] -->|"writes and reads"| P[("Redis primary")]
    P -->|"async replication"| R1[("replica 1")]
    P -->|"async replication"| R2[("replica 2")]
    S1["Sentinel 1"] -.->|"monitor"| P
    S2["Sentinel 2"] -.->|"monitor"| P
    S3["Sentinel 3"] -.->|"monitor"| P
    S1 -.->|"quorum agrees: promote"| R1
```

- Replication is **asynchronous**: the primary acknowledges a write before the replicas have it. If the primary dies, the last acknowledged writes may be lost. `WAIT numreplicas timeout` makes a client wait until N replicas have its writes — it reduces the window but does not make Redis strongly consistent.
- **Redis Sentinel** is a group of processes (at least 3) that monitor the primary; when a quorum agrees it is down, they promote a replica and tell clients the new address. Failover takes seconds — the cache is unavailable or read-only meanwhile.
- `min-replicas-to-write` makes the primary refuse writes when it cannot reach enough replicas, limiting loss during a partition.

For a cache this is fine: a lost write is a future miss. For data that must not be lost, it is the reason to keep the source of truth in a database.

---

## Redis Cluster { #cluster }

When one node is not enough — memory or throughput — **Redis Cluster** shards the keyspace over several primaries, each with its own replicas[^3].

- The keyspace is divided into **16,384 hash slots**. A key's slot is `CRC16(key) mod 16384`.
- Each primary owns a set of slots (e.g. three primaries: 0–5460, 5461–10922, 10923–16383).
- Clients are **cluster-aware**: they cache the slot → node map and send each command directly to the right node. If the map is outdated, the node answers `MOVED <slot> <address>` and the client updates its map; during a slot migration, `ASK` redirects a single request.
- Adding a node = **moving some slots** to it, live, without rehashing every key.

``` diagram-sim
flowchart LR
    C["cluster-aware client<br/>slot map cached"] -->|"event:42 → slot 16271"| N3
    C -->|"prices:42 → slot 9049"| N2
    N1[("primary A<br/>slots 0–5460")] --- R1[("replica A")]
    N2[("primary B<br/>slots 5461–10922")] --- R2[("replica B")]
    N3[("primary C<br/>slots 10923–16383")] --- R3[("replica C")]
```

```text title="redis-cli — which slot does a key go to?"
> CLUSTER KEYSLOT event:42
(integer) 16271
> CLUSTER KEYSLOT prices:42
(integer) 9049
> CLUSTER KEYSLOT {event:42}:seats
(integer) 16271
> CLUSTER KEYSLOT {event:42}:prices
(integer) 16271
```

**Multi-key operations** (`MGET`, `MULTI`/`EXEC`, Lua scripts touching several keys) only work when **all keys are in the same slot** — otherwise Redis answers `CROSSSLOT`. **Hash tags** solve this: if a key contains `{...}`, only the part inside the braces is hashed. `{event:42}:seats` and `{event:42}:prices` land in the same slot, so a script can update both atomically.

!!! warning "Hash tags concentrate load"

    Everything with the same tag lives on one node. Tag by something with many values (one event, one user), never by something with few (`{boxoffice}` would put the whole application on one node — a self-made [hot key](../failure-modes/index.md#hot-keys)).

### Hash slots vs. consistent hashing

Memcached takes a different approach: the servers do not know about each other, and **the client** decides which server holds a key, usually with **consistent hashing** (the *ketama* algorithm) so that adding a server remaps only ~1/N of the keys ([Databases — consistent hashing](../../databases/partitioning/index.md#consistent-hashing)). Redis Cluster uses a fixed number of slots instead: the mapping key → slot never changes, only slot → node does, and the nodes themselves coordinate failover and redirects.

| | Redis Cluster (hash slots) | Client-side consistent hashing (Memcached) |
|---|---|---|
| Who knows the mapping | servers + cluster-aware clients | clients only |
| Adding a node | move some slots, live | ~1/N of keys remap (become misses) |
| Replication / failover | built-in | none (a dead node = misses) |
| Multi-key operations | within one slot (hash tags) | none |

---

## Managed Redis

=== "AWS"

    - **Amazon ElastiCache** (Redis OSS, Valkey, Memcached): managed cache with replication, automatic failover, Cluster mode and a serverless option.
    - **Amazon MemoryDB**: Redis/Valkey-compatible with a durable, multi-AZ transaction log — designed to be a primary database, not just a cache.

=== "GCP"

    - **Memorystore for Redis**, **Memorystore for Redis Cluster** and **Memorystore for Valkey**: managed instances with replicas and automatic failover.
    - **Memorystore for Memcached**.

=== "Azure"

    - **Azure Managed Redis** (based on Redis Enterprise) and the older **Azure Cache for Redis** tiers, with replication, clustering and geo-replication options.

=== "Open source"

    - Self-hosted **Redis** or **Valkey**: a single node with Docker for development ([Hands-on 5](../../../hands-on/5/index.md)); Sentinel or Cluster on VMs; on Kubernetes with an operator or a Helm chart (StatefulSet + persistent volumes).
    - **Memcached** and **Dragonfly** as alternatives.

Managed services take care of failover, patching and backups; you still own **sizing, eviction policy, key design, timeouts and what happens when it fails**.

---

## Sizing a Redis deployment

!!! example "Worked example — the BoxOffice cache cluster"

    *Illustrative assumptions:* 2 million cached keys (events, prices, search results, fragments); average key 50 bytes; average value 2 KB; per-key overhead (dictionary entry, object headers, expiry) ~100 bytes.

    - Data: 2,000,000 × (50 + 2,048 + 100) B ≈ **4.4 GB**.
    - Fragmentation and growth headroom (+30%): ≈ 5.7 GB.
    - Fork headroom for RDB snapshots on a write-heavy primary: keep memory use ≤ ~70% of RAM → ≈ **8 GB per copy**.
    - Throughput: 300,000 reads/s at peak after the L1 caches; assume (to be benchmarked) ~100,000 ops/s per primary → **3 primaries**, each with **1 replica**.
    - Result: Redis Cluster with 3 primaries × ~1.5 GB of data each (≈ 2.7 GB of RAM with the headroom above) + 3 replicas — **6 nodes with 4–8 GB of RAM**. The constraint is throughput, not memory.

    Sessions (2 M fans × 0.5 KB ≈ 1 GB) go to a **separate** small instance with `noeviction` and AOF, so cache evictions can never log a fan out.

---

## Connecting from Spring Boot

The configuration used in [Hands-on 5](../../../hands-on/5/index.md):

```yaml title="catalog/src/main/resources/application.yaml"
spring:
  data:
    redis:
      host: ${REDIS_HOST:redis}
      port: 6379
      timeout: 50ms            # command timeout: fail fast if Redis is slow
      connect-timeout: 200ms
      # cluster:
      #   nodes: redis-0:6379,redis-1:6379,redis-2:6379
  cache:
    type: redis
    redis:
      time-to-live: 5m         # default TTL for @Cacheable caches
      cache-null-values: false
      key-prefix: "boxoffice:catalog:"
```

```yaml title="compose.yaml (excerpt)"
services:
  redis:
    image: redis:8-alpine
    command: ["redis-server", "--maxmemory", "256mb", "--maxmemory-policy", "allkeys-lru"]
    ports:
      - "6379:6379"
```

!!! tip "In the interview"

    When you say "Redis", be ready for three follow-ups. **Data model**: pick the structure that matches the access pattern ("a sorted set for the waiting room, a hash for sessions"). **Scaling**: Redis Cluster with 16,384 hash slots, hash tags for multi-key operations, and replicas for failover — and why a hot key is not fixed by adding nodes. **Durability**: replication is asynchronous, so Redis is a cache or a store for data you can afford to lose; the seat hold and the payment live in the database.

!!! success "Best practices"

    - **Separate a cache from a store**: a pure cache runs with `maxmemory`, an `allkeys-*` eviction policy and no persistence; sessions or queues need their own instance with `noeviction` and persistence. In BoxOffice: lab 5's Redis is a pure cache (`--save "" --appendonly no`).
    - **Pick the data structure that answers the question in one command** (a hash for an object, a sorted set for a ranking, `INCR` for a counter) instead of read-modify-write in the application.
    - **Pipeline or batch round trips** (`MGET`, pipelines) when a page needs many keys: the network, not Redis, is the cost.
    - **Use `SCAN`, `UNLINK` and replicas** for maintenance, never `KEYS *` or a blocking `DEL` on the primary.
    - **Plan memory with headroom** (working set × 1.5) and alert on memory, evictions and replication lag.

!!! warning "Common pitfalls"

    - **`KEYS *` in production** — O(n) over the whole keyspace, blocks the server. Use `SCAN`.
    - **Keys without TTL** in a cache — memory grows until evictions or `OOM` errors start.
    - **Big values and huge collections** — see [big keys](../failure-modes/index.md#big-keys).
    - **Redis as the only copy of money data** — orders, payments, seat holds belong in the database.
    - **Default timeouts** — a slow or failing Redis must not stall the service.
    - **One instance for cache and sessions** — the cache's eviction policy will evict sessions.
    - **Hash tags with low cardinality** — the whole application on one node.

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    FAST["in memory,<br/>one command at a time"] --> DS["data structures: strings,<br/>hashes, sorted sets, streams"]
    DS --> WR["sorted set =<br/>waiting room → Messaging"]
    DS --> SESS["hashes = sessions,<br/>strings = cached JSON"]
    FAST --> ATOM["atomicity: single commands,<br/>MULTI, Lua"]
    ATOM --> RL["rate-limit counters<br/>→ Edge API gateway"]
    ATOM --> PRE["seat pre-hold in Redis,<br/>SQL still decides → Databases"]
    FAST --> PERS["persistence: RDB, AOF"]
    FAST --> REP["asynchronous replication,<br/>failover"]
    REP --> CL["Redis Cluster<br/>16,384 hash slots"]
    CL -.-> CH["vs consistent hashing<br/>→ Partitioning"]
```

**Palette components:** [`cache`](../../../reference/components/storage/index.md#cache) (Redis or Valkey, managed or self-run) · [`queue`](../../../reference/components/messaging/index.md#queue) (a sorted-set waiting room; lists as simple job queues) · [`stream`](../../../reference/components/messaging/index.md#stream) (Redis Streams, a lightweight event log) · [`apigw`](../../../reference/components/edge/index.md#apigw) (rate-limit counters with `INCR` + `EXPIRE`) · [`sql`](../../../reference/components/storage/index.md#sql) (still decides the seat hold) · [`app`](../../../reference/components/compute/index.md#app) (Spring Boot clients with pools and timeouts). **Scenarios:** `read-heavy-cache`, `flash-sale`, `rate-limiter`. **Continues in:** [Databases — consistent hashing](../../databases/partitioning/index.md#consistent-hashing), [Databases — replication](../../databases/replication/index.md), [Edge — token bucket](../../edge/api-gateway/index.md#token-bucket), [Case study: distributed cache](../../case-studies/distributed-cache/index.md), [Hands-on 5](../../../hands-on/5/index.md).

---

[^1]: REDIS. [Redis documentation](https://redis.io/docs/latest/){target="_blank"}.
[^2]: LINUX FOUNDATION. [Valkey](https://valkey.io){target="_blank"}.
[^3]: REDIS. [Redis cluster specification](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/){target="_blank"}.
