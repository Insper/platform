
> *"Design a distributed in-memory cache like Memcached or Redis Cluster: a key-value store that many application servers use to avoid hitting the database, holding more data than one machine can, with sub-millisecond latency."*

Almost every case in this course ends with "and put a cache in front of it". This case opens that box. A distributed cache is a small **distributed database** with relaxed rules: it may lose data (the source of truth is elsewhere), but it must be fast, spread keys evenly over many nodes, survive nodes coming and going without a stampede on the database, and cope with keys that are much hotter than others. It is the interview where **consistent hashing**, **eviction policies**, **replication lag** and **hot keys** all appear in one design — the same ideas behind Dynamo, Cassandra and Redis Cluster.

In BoxOffice, the cache holds event pages, seat-availability snapshots and sessions. At 10:00 on an on-sale day it absorbs millions of reads per minute; if one cache node dies at 10:01, the question is whether its share of the traffic moves smoothly to the others or falls on PostgreSQL all at once.

| | |
|---|---|
| **Difficulty** | :material-star::material-star: medium |
| **Key concepts** | partitioning with consistent hashing and virtual nodes, hash slots, eviction (LRU, LFU, W-TinyLFU) and TTL, memory sizing, primary/replica replication and failover, split brain, hot keys and big keys, client-side vs. proxy routing, cache-aside, stampede protection (leases, request coalescing, early expiration) |
| **Palette components** | [`cache`](../../../reference/components/storage/index.md#cache), [`app`](../../../reference/components/compute/index.md#app), [`nosql`](../../../reference/components/storage/index.md#nosql), [`metrics`](../../../reference/components/observability/index.md#metrics) |
| **Playground scenarios** | `read-heavy-cache`, `sharding` |

!!! abstract "What this case trains"

    - **Size** a cache cluster by memory **and** by operations per second, and **relate** hit ratio to database load.
    - **Explain** why `hash(key) % N` fails when nodes change and how consistent hashing with virtual nodes fixes it.
    - **Choose** an eviction policy and TTLs for a workload, and **explain** what W-TinyLFU adds over LRU.
    - **Design** replication and failover, and **state** what is lost with asynchronous replication.
    - **Mitigate** hot keys, big keys and cache stampedes.

---

## 1. Clarify the requirements

([interview framework](../../intro/interview-framework/index.md))

### Functional requirements

1. `get(key)`, `set(key, value, ttl)`, `delete(key)`; optional atomic operations (`incr`, compare-and-set).
2. Keys expire after their **TTL**; when memory is full, the cache **evicts** some keys.
3. The data set is larger than one machine: keys are **partitioned** over many nodes.
4. Nodes can be **added or removed** (scaling, failures) without restarting clients.

### Non-functional requirements

| Quality | Target |
|---|---|
| **Latency** | p99 < 1 ms inside the data center |
| **Throughput** | ~2 M operations/s at peak, growing |
| **Capacity** | ~1 TB of hot data |
| **Availability** | A node failure must not cause an outage or a database stampede |
| **Consistency** | Eventual; a few stale reads after a write are acceptable (the source of truth is the database) |
| **Durability** | Not required — losing a node's data costs misses, not correctness |

### Out of scope (say it explicitly)

Persistence to disk (snapshots/AOF), cross-region replication, complex data structures beyond strings and counters, authentication — mention that Redis offers several of them.

??? question "Questions to ask the interviewer"

    | Question | Why it matters |
    |---|---|
    | Is it a cache (data can be lost) or a primary store? | A cache can use asynchronous replication and evict freely; a store cannot. |
    | Total data size and value sizes? | Memory sizing; big values (MBs) need special care. |
    | Read/write ratio and peak ops/s? | Often ops/s, not memory, decides the number of nodes. |
    | Is stale data acceptable? For how long? | TTLs, invalidation strategy, replica reads. |
    | Are some keys much hotter than others? | Hot keys break even partitioning. |
    | Who routes: the client library, a proxy, or the servers? | Affects latency, client complexity and operations. |

---

## 2. Back-of-the-envelope estimates

```python exec="1" source="tabbed-right"
# Distributed cache: assumptions (illustrative)
items         = 1_000_000_000   # cached objects (working set)
value_b       = 1_000           # average value size
key_b         = 50
overhead_b    = 50              # per-item metadata, pointers, allocator slack
node_mem_gb   = 64              # RAM per node usable for data (leave headroom)
ops_s         = 2_000_000       # total cache operations per second at peak
ops_per_node  = 80_000          # comfortable ops/s per node (single-threaded engine)
replicas      = 1               # replicas per primary
hit_ratio     = 0.95

data_tb       = items * (value_b + key_b + overhead_b) / 1e12
nodes_memory  = data_tb * 1e3 / node_mem_gb
nodes_ops     = ops_s / ops_per_node
primaries     = max(nodes_memory, nodes_ops)
total_nodes   = primaries * (1 + replicas)
net_gb_s      = ops_s * value_b / 1e9
db_rps        = ops_s * (1 - hit_ratio)
db_rps_90     = ops_s * (1 - 0.90)

rows = [
    ("data_tb", data_tb, "TB"), ("nodes_memory", nodes_memory, "nodes"),
    ("nodes_ops", nodes_ops, "nodes"), ("primaries", primaries, "nodes"),
    ("total_nodes", total_nodes, "nodes"), ("net_gb_s", net_gb_s, "GB/s"),
    ("db_rps", db_rps, "req/s"), ("db_rps_90", db_rps_90, "req/s"),
]
print("| quantity | value | unit |\n|---|---:|---|")
for name, value, unit in rows:
    v = f"{value:,.0f}" if abs(value) >= 100 else f"{value:,.2f}"
    print(f"| `{name}` | {v} | {unit} |")
```

What the numbers tell us:

- **~1.1 TB** of data needs **~17 nodes** by memory, but **2 M ops/s** need **25 nodes** by throughput. ⇒ size by **both** and take the larger: here throughput decides (25 primaries, 50 nodes with one replica each).
- **2 GB/s** of values cross the network at peak — spread over 25 nodes it is ~80 MB/s each, fine for modern NICs, but a single **big key** read thousands of times per second can saturate one node's link.
- At a 95% hit ratio the database receives **100 k req/s**; at 90% it receives **200 k req/s**. ⇒ every point of hit ratio is worth 20 k database requests per second. Losing one node of 25 (4% of the keys) cold is a sudden +80 k misses/s for the database — the reason failover and warm replicas matter ([caching](../../caching/index.md)).

---

## 3. API

```text
GET    key                         → value | nil
SET    key value EX 300            → OK                 (TTL in seconds)
SET    key value NX EX 30          → OK | nil           (only if absent: locks, leases)
DEL    key                         → 1 | 0
INCRBY key 5                       → 42                 (atomic counter)
MGET   k1 k2 k3                    → [v1, v2, v3]       (batched: one round trip)

# Cluster-aware client: the key decides the node
slot = CRC16(key) mod 16384        → node owning that slot (Redis Cluster)
-MOVED 3999 10.0.1.17:6379         → slot moved: update the client's map and retry there
```

- The client library is part of the API: it hashes the key, keeps the **map of partitions → nodes**, pools connections and pipelines requests.
- `MGET` across keys on different nodes becomes a **scatter-gather**; use hash tags (`{event:42}:seats`, `{event:42}:page`) to keep related keys on the same node when they are read together.

---

## 4. Data model

```text
# On each node: a hash table of entries + an eviction structure
entry  = { key, value, expires_at, flags, lru_clock | lfu_counter }
index  = hash table key → entry                   (O(1) get/set)
policy = LRU list / sampled LRU / LFU counters   (who to evict when memory is full)

# Cluster metadata (gossiped between nodes or stored in a coordination service)
slots 0–5460      → node-a (primary), node-d (replica)
slots 5461–10922  → node-b (primary), node-e (replica)
slots 10923–16383 → node-c (primary), node-f (replica)
```

| Data | Store | Why |
|---|---|---|
| Cached values | In-memory hash table per node (`cache`) | O(1) access, no disk on the path |
| Partition map (slots/ring → nodes) | Gossip between nodes, or a coordination service (etcd/ZooKeeper); cached in every client | Small, read on every request, changes rarely |
| Source of truth | Database (`nosql`/SQL) behind the cache | The cache can always be rebuilt from it |
| Hit ratio, evictions, memory, latency per node | Metrics (`metrics`) | Hot nodes, eviction storms and memory pressure are visible only here |

---

## 5. High-level design

``` mermaid-sim
flowchart LR
    app1["App server #1<br/>cluster-aware client"] --> a["node-a<br/>slots 0–5460"]
    app1 --> b["node-b<br/>slots 5461–10922"]
    app2["App server #2<br/>cluster-aware client"] --> b
    app2 --> c["node-c<br/>slots 10923–16383"]
    a -. async replication .-> ra["replica a'"]
    b -. async replication .-> rb["replica b'"]
    c -. async replication .-> rc["replica c'"]
    app1 -- miss --> db[("Database<br/>source of truth")]
    app2 -- miss --> db
    a -. metrics .-> m["Metrics"]
```

A read with cache-aside, including a slot that moved:

``` mermaid-sim
sequenceDiagram
    autonumber
    participant A as App (client lib)
    participant B as node-b
    participant C as node-c
    participant D as Database
    A->>A: slot = CRC16("event:42") mod 16384 → node-b (cached map)
    A->>B: GET event:42
    B-->>A: -MOVED 9001 node-c (slot was migrated)
    A->>A: update slot map
    A->>C: GET event:42
    C-->>A: nil (miss)
    A->>D: SELECT event 42
    D-->>A: row
    A->>C: SET event:42 … EX 300
```

---

## 6. Deep dives

### 6.1 Partitioning: why `hash % N` breaks, and consistent hashing

With `node = hash(key) % N`, going from 4 to 5 nodes changes the owner of almost every key — a cache with 80% of its keys suddenly in the wrong place is, for the database, the same as an empty cache. **Consistent hashing** places nodes and keys on the same ring of hash values; a key belongs to the first node clockwise. Adding a node only takes keys from its neighbors — about `1/N` of them. Each physical node gets many **virtual nodes** (points on the ring) so that load is even and a failed node's keys spread over all the others, not just one neighbor ([partitioning](../../databases/partitioning/index.md)).

```python exec="1" source="tabbed-right"
import bisect
import hashlib

def h(s: str) -> int:
    return int.from_bytes(hashlib.md5(s.encode()).digest()[:8], "big")

keys = [f"event:{i}" for i in range(50_000)]
kh = {k: h(k) for k in keys}

def mod_n(n):
    return {k: kh[k] % n for k in keys}

def ring(nodes, vnodes):
    points = sorted((h(f"node{n}#{v}"), n) for n in range(nodes) for v in range(vnodes))
    hashes = [p for p, _ in points]
    owner = {}
    for k in keys:
        i = bisect.bisect(hashes, kh[k]) % len(points)
        owner[k] = points[i][1]
    return owner

def moved(a, b):
    return sum(a[k] != b[k] for k in keys) / len(keys)

def max_over_avg(owner, nodes):
    counts = [0] * nodes
    for n in owner.values():
        counts[n] += 1
    return max(counts) / (len(keys) / nodes)

print("| scheme | keys_moved_pct | max_load_vs_avg |\n|---|---:|---:|")
a, b = mod_n(4), mod_n(5)
print(f"| `hash % N` | {moved(a, b):.1%} | {max_over_avg(b, 5):.2f} |")
for v in (1, 10, 100, 1000):
    a, b = ring(4, v), ring(5, v)
    print(f"| `ring, {v} vnodes/node` | {moved(a, b):.1%} | {max_over_avg(b, 5):.2f} |")
```

Read the table in two columns. **Keys moved** going from 4 to 5 nodes: `hash % N` moves ~80%; the ring moves ~20% — the theoretical minimum, `1/5`. **Load balance** (the busiest node relative to the average): with one point per node the ring is very uneven (the busiest node holds almost twice its share); with hundreds of virtual nodes it approaches 1.0.

=== "Ring with virtual nodes"

    Used by Dynamo, Cassandra and many client libraries (e.g. ketama for Memcached). Each node owns many arcs; adding/removing a node moves ~`1/N` of the keys, taken from or given to all other nodes.

=== "Fixed hash slots (Redis Cluster)"

    The key space is split into a fixed number of slots (16 384); each node owns a set of slots. Rebalancing **moves slots**, not individual hash ranges, and the cluster tells clients with `MOVED`/`ASK` redirects. Same benefit as the ring (only moved slots change owner), simpler to reason about and to migrate gradually.

=== "Rendezvous hashing"

    For each key, compute `hash(key, node)` for every node and pick the highest. No ring, perfect `1/N` movement, but O(N) per lookup — fine for tens of nodes.

### 6.2 Eviction, TTL and memory

When memory is full, something must go. The policy decides the hit ratio you get from the same RAM ([caching failure modes](../../caching/failure-modes/index.md)):

| Policy | Keeps | Good for | Weakness |
|---|---|---|---|
| **LRU** (least recently used) | Recently used keys | Recency-driven workloads | A one-off scan of many keys flushes the hot set |
| **LFU** (least frequently used) | Often used keys | Stable popularity | Slow to forget yesterday's hits; needs decay |
| **W-TinyLFU** (Caffeine) | A small LRU "window" + an admission filter by approximate frequency | Mixed workloads; resists scans | More complex; mostly in-process caches |
| **TTL-only** | Everything until it expires | Small, bounded data sets | Memory grows with traffic |
| **Random** | Random keys | Very cheap | Lower hit ratio |

- Real engines **approximate**: Redis samples a few keys and evicts the best candidate among them (approximated LRU or LFU with decaying counters) instead of maintaining a perfect global order.
- **TTL is a consistency tool, eviction is a memory tool.** Always set a TTL (so stale data has a bound), and add **jitter** to TTLs written in bulk (e.g. 300 s ± 10%) so they do not expire at the same second.
- **Leave headroom**: plan for ~70–80% of RAM for data. Fragmentation, replication buffers and forking for snapshots need the rest; a node that swaps to disk is slower than no cache at all.

### 6.3 Replication and failover

``` mermaid-sim
sequenceDiagram
    autonumber
    participant A as App
    participant P as Primary (node-b)
    participant R as Replica (node-e)
    participant S as Failure detector
    A->>P: SET seats:42 v7
    P-->>A: OK
    P--)R: replicate v7 (async)
    Note over P: primary crashes before v7 reaches the replica
    S->>S: node-b missed heartbeats → majority agrees
    S->>R: promote node-e to primary
    A->>R: GET seats:42
    R-->>A: v6 (the acknowledged write v7 is lost)
```

- Replication is usually **asynchronous**: fast writes, but a failover can lose the last acknowledged writes. For a cache that is acceptable — the next miss reloads from the database. If a stale value is dangerous (seat availability), keep TTLs short or delete keys on write ([invalidation](../../caching/patterns/index.md)).
- **Failure detection** needs a **majority** (Redis Sentinel, or the cluster nodes voting) so that one isolated observer does not promote a replica on its own.
- **Split brain**: after a partition, the old primary may still accept writes from clients on its side. Mitigate by having a primary stop accepting writes when it cannot see enough replicas/peers (`min-replicas-to-write`), and by epochs/terms so clients and nodes reject the stale primary.
- **Warm replicas** also serve reads (if stale reads are acceptable) and avoid the cold-node stampede after failover.

### 6.4 Hot keys, big keys and stampedes

- **Hot key** — one key (the event page during an on-sale, a celebrity's profile) receives so many requests that its node saturates while the rest are idle. Consistent hashing cannot help: one key lives on one node. Fixes: a small **in-process L1 cache** with a TTL of seconds on every app server; **replicate the key** under several names (`event:42#1 … #8`) and read a random copy; serve it from replicas.
- **Big key** — a 5 MB value read 1 000 times per second is 5 GB/s on one node. Split it (paginate, compress), or cache the rendered fragments instead of the whole object.
- **Stampede** (*thundering herd*) — a hot key expires and thousands of requests miss at once and all hit the database. Fixes ([caching failure modes](../../caching/failure-modes/index.md)):
    - **Request coalescing / leases**: the first miss gets a lease (`SET lock:key NX EX 5`) and reloads; the others wait briefly or get the stale value. Memcache at Facebook used leases for exactly this.
    - **Probabilistic early expiration**: each reader may refresh *before* the TTL with a probability that grows as expiry approaches, so one request refreshes early instead of all at once.
    - **Serve stale while revalidating** for data where a few seconds of staleness are fine.

```python
import math, random, time

def should_refresh_early(expires_at: float, recompute_s: float, beta: float = 1.0) -> bool:
    """XFetch: refresh before expiry with a probability that grows near the deadline."""
    return time.time() - recompute_s * beta * math.log(random.random()) >= expires_at
```

### 6.5 Routing: who knows where a key lives?

| | Client-side routing (smart client) | Proxy (twemproxy, mcrouter, Envoy) | Server-side redirects (Redis Cluster) |
|---|---|---|---|
| Hops | 1 (client → node) | 2 (client → proxy → node) | 1, plus a redirect after rebalancing |
| Client complexity | High (map, retries, pooling in every language) | Low (looks like one server) | Medium (cluster-aware client) |
| Config changes | Pushed to every client | Only to proxies | Learned through `MOVED` |
| Extra features | — | Pooling, replication, shadow traffic | Slot migration built in |

Facebook's memcache deployment, for example, put routing in a proxy (mcrouter) so that thousands of web servers did not each manage connections to every cache node.

---

## 7. Bottlenecks, failure modes and trade-offs

| Where | What goes wrong | Mitigation | Trade-off |
|---|---|---|---|
| Adding/removing nodes | `hash % N` remaps almost every key → mass misses | Consistent hashing or hash slots; migrate gradually | Rebalancing traffic for a while |
| Node failure | Its keys go cold; database spike | Replicas with automatic failover; spread keys with vnodes; L1 cache absorbs some reads | Replicas double the memory cost |
| Async replication | Acknowledged writes lost on failover | Accept it for a cache; short TTLs or delete-on-write for sensitive keys | Stale or missing values briefly |
| Network partition | Two primaries (split brain) | Majority-based failover; primary stops writes without quorum; epochs | Writes rejected on the minority side |
| Hot key | One node saturated | L1 cache, key replication with suffixes, read from replicas | Staleness, more memory |
| Big key | Network link saturated; slow commands block the node | Split/compress; avoid O(N) commands on big structures | More keys to manage |
| Stampede on expiry | Thousands of misses for one key | Leases/coalescing, early refresh, TTL jitter, serve stale | Slight staleness |
| Memory pressure | Eviction storms, fragmentation, swapping | Headroom (~70–80%), right policy, alerts on evictions and memory | Fewer bytes per node used |

The trade-offs to **say out loud**: **availability and speed over consistency** (a cache may be stale or lose writes, the database is the truth), **memory vs. throughput** (size by both), and **even distribution vs. hot keys** (hashing spreads keys, not popularity).

---

## 8. Try it in the playground

Two scenarios cover the two halves of this case: the cache in front of a database, and the partitioning of data over nodes.

!!! tip "Try it — cache in front of the database"

    1. Run `read-heavy-cache` with the **load** profile and note the hit ratio, the database utilization and the p99.
    2. Lower the hit ratio (or shrink the cache) by 5 points and run again: compare the change in database load with the estimate in section 2.
    3. Turn chaos on to fail the cache (or flush it): watch the cold-cache stampede on the database and how long p99 takes to recover.

<div class="sdp" data-scenario="read-heavy-cache" data-mode="full" data-height="640" data-profile="load"></div>

!!! tip "Try it — partitions and hot keys"

    1. Run `sharding` with the **load** profile and compare utilization across partitions.
    2. Concentrate traffic on one key/partition (a hot key): one node saturates while the others idle — more partitions do not help.
    3. Add partitions/nodes with an even workload and observe how throughput scales; then fail one node and see where its traffic goes.

<div class="sdp" data-scenario="sharding" data-mode="full" data-height="640" data-profile="load"></div>

[Open the full playground](../../../../playground/index.md){ .md-button }

---

## 9. Follow-up questions an interviewer asks

??? question "Why not just use `hash(key) % N`? It is simpler."

    It distributes keys well while N is fixed. The moment N changes — a node fails, you scale for an on-sale — about `1 - 1/N` of the keys change owner (80% going from 4 to 5 nodes), which is equivalent to flushing the cache in the middle of the peak. Consistent hashing or fixed slots move only the keys that must move (~`1/N`).

??? question "A node fails during the BoxOffice on-sale. Walk me through what happens."

    Clients get timeouts/connection errors for that node's slots. The failure detector (a majority of nodes or Sentinels) marks it failed after a few seconds and promotes its replica; clients learn the new owner (redirect or config push) and continue. Writes acknowledged by the old primary but not yet replicated are lost — harmless for a cache. Without a replica, that node's keys would be misses until refilled; L1 caches, request coalescing and a database with headroom keep that spike survivable.

??? question "How do you keep the cache consistent with the database?"

    You don't make it strongly consistent — you **bound** the inconsistency. Cache-aside with: write to the database, then **delete** the key (not update it, to avoid racing writers putting an old value back); a TTL as a safety net; and, for critical data, invalidation driven by change data capture from the database log. Short TTLs for data that changes often (seat availability), long ones for data that rarely does (venue descriptions).

??? question "LRU or LFU?"

    LRU when recent use predicts future use and the workload has no big scans; LFU (with decay) when popularity is stable and you must protect the hot set from one-off traffic, like a crawler reading every event page once. Modern in-process caches use W-TinyLFU, which combines a small recency window with a frequency-based admission filter and is robust to both. In Redis, `allkeys-lfu` or `allkeys-lru` are the usual choices for a pure cache.

??? question "How would you make the cache survive a whole-cluster restart without hammering the database?"

    Avoid it being cold: persist snapshots and reload them on start (Redis RDB), restart nodes one by one with replicas serving meanwhile, or **warm** the cache from the database with a background job (top-N keys from access logs) before sending traffic. Rate-limit the misses that reach the database during warm-up.

??? question "When should you not add a cache?"

    When the hit ratio would be low (uniform random access over a huge key space), when data must be strongly consistent on every read, when the database already serves the load comfortably, or when the added operational complexity (invalidation bugs, stampedes, a new failure mode) costs more than the latency it saves. Measure first ([performance engineering](../../performance/index.md)).

---

## 10. Self-assessment rubric

| Level | What the answer contains |
|---|---|
| **Junior** | A key-value map in memory with get/set and TTL; several nodes with `hash % N`; LRU eviction. Does not notice what happens when N changes. |
| **Mid** | Consistent hashing with virtual nodes (or hash slots); eviction and TTL choices; primary/replica with failover; cache-aside and stampede protection; sizing by memory. |
| **Senior** | Sizes by memory and ops/s and links hit ratio to database load; explains key movement and load balance quantitatively; async replication loss and split brain with quorum-based failover; hot keys (L1, key replication) and big keys; routing options with trade-offs; leases/early expiration; warm-up and operational metrics; knows when a cache is the wrong tool. |

**Related:** [Caching](../../caching/index.md), [Redis](../../caching/redis/index.md), [Caching failure modes](../../caching/failure-modes/index.md), [Partitioning](../../databases/partitioning/index.md), [Hands-on 5](../../../hands-on/5/index.md) (Redis cache-aside, hit ratio and stampede).

---

## How it connects { #how-it-connects }

Which classes does this case test? Each branch is a class whose ideas the design relies on (blue), with the palette components where they show up (green):

``` mermaid
flowchart LR
    CASE(["Distributed cache"]) --> EST["Estimation<br/>size by memory and ops/s"]:::tech
    CASE --> PART["Databases<br/>consistent hashing, virtual nodes"]:::tech
    CASE --> EVI["Caching<br/>eviction LRU, LFU, W-TinyLFU, TTL"]:::tech
    CASE --> REP["Databases<br/>async replication, failover"]:::tech
    CASE --> HOT["Caching<br/>hot keys, big keys, stampedes"]:::tech
    CASE --> ROUTE["routing<br/>cluster-aware client"]:::tech
    PART -.-> k1["cache (cluster)"]:::comp
    REP -.-> k2["sql · nosql<br/>(source of truth)"]:::comp
    ROUTE -.-> k3["app"]:::comp
    HOT -.-> k4["metrics"]:::comp
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

**Classes it tests:** [Caching — patterns](../../caching/patterns/index.md) · [Caching — Redis](../../caching/redis/index.md) · [Caching — failure modes](../../caching/failure-modes/index.md) · [Databases — partitioning](../../databases/partitioning/index.md) · [Databases — replication](../../databases/replication/index.md) · [Estimation — numbers](../../estimation/numbers/index.md) · [Hands-on 5](../../../hands-on/5/index.md). **Palette components:** [`cache`](../../../reference/components/storage/index.md#cache) · [`app`](../../../reference/components/compute/index.md#app) · [`sql`](../../../reference/components/storage/index.md#sql) · [`nosql`](../../../reference/components/storage/index.md#nosql) · [`metrics`](../../../reference/components/observability/index.md#metrics). **Scenarios:** `read-heavy-cache`, `sharding`.

---

## References

- KARGER, D. et al. *Consistent Hashing and Random Trees*[^1].
- DECANDIA, G. et al. *Dynamo: Amazon's Highly Available Key-value Store*[^2].
- NISHTALA, R. et al. *Scaling Memcache at Facebook* — leases, regional pools, mcrouter[^3].
- EINZIGER, G.; FRIEDMAN, R.; MANES, B. *TinyLFU: A Highly Efficient Cache Admission Policy*[^4].
- XU, A. *System Design Interview*, vol. 1, ch. 5 "Design Consistent Hashing" and ch. 6 "Design a Key-Value Store"[^5]; Redis Cluster specification[^6].

[^1]: KARGER, D. et al. Consistent Hashing and Random Trees: Distributed Caching Protocols for Relieving Hot Spots on the World Wide Web. *Proceedings of the 29th ACM STOC*, 1997.
[^2]: DECANDIA, G. et al. [Dynamo: Amazon's Highly Available Key-value Store](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf){target="_blank"}. *SOSP*, 2007.
[^3]: NISHTALA, R. et al. [Scaling Memcache at Facebook](https://www.usenix.org/conference/nsdi13/technical-sessions/presentation/nishtala){target="_blank"}. *USENIX NSDI*, 2013.
[^4]: EINZIGER, G.; FRIEDMAN, R.; MANES, B. TinyLFU: A Highly Efficient Cache Admission Policy. *ACM Transactions on Storage*, 13(4), 2017.
[^5]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1. Byte Code LLC, 2020.
[^6]: [Redis Cluster specification](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/){target="_blank"}. Redis documentation.
