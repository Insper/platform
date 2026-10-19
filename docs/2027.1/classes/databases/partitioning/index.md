Three years after launch, BoxOffice sells in 30 countries. The `orders` and `tickets` tables grow by hundreds of millions of rows a year, the primary's disk is measured in terabytes, and the write rate during big on-sales is close to what one machine can absorb. Replicas no longer help: they scale reads, and every replica must still apply **every** write. The next rung of the [scaling ladder](../index.md#scaling-ladder) is to split the data itself across machines.

**Partitioning** — also called **sharding** — divides a dataset so that each record belongs to exactly one **partition** (shard), and different partitions live on different nodes. Each node handles only its share of the reads, writes and storage. The words vary by product — *shard* in MongoDB and Elasticsearch, *region* in HBase, *tablet* in Bigtable, *range* in CockroachDB, *vnode* in Cassandra — but the questions are always the same: **by what key, how to spread it evenly, how to find it, and how to move it when nodes change**[^1].

``` mermaid-sim
flowchart LR
    R["router<br/>partition = f(key)"] -->|"customer 7"| S1[("shard 1<br/>+ replicas")]
    R -->|"customer 1042"| S2[("shard 2<br/>+ replicas")]
    R -->|"customer 98311"| S3[("shard 3<br/>+ replicas")]
```

Partitioning is usually **combined** with replication: each partition has its own leader and followers, so a node can be leader for some partitions and follower for others.

---

## Partitioning by key range

Assign each partition a **continuous range** of keys, like the volumes of an encyclopedia: `A–F`, `G–M`, `N–S`, `T–Z`. Within a partition, keys are kept sorted.

- **Range queries are cheap**: "orders from 2027-03-01 to 2027-03-07" reads one or two partitions.
- **Boundaries adapt** to the data: when a range grows too large, it is **split** in two (Bigtable tablets, HBase regions, CockroachDB and TiDB ranges do this automatically).
- **Danger — sequential keys.** If the key is a timestamp or an auto-increment id, *all new writes go to the last range*. Today's clickstream lands on one node while the others idle. Fix it by prefixing the key with something else: `(event_id, timestamp)` instead of `timestamp`.

## Partitioning by hash

Apply a hash function to the key and use the hash to choose the partition. A good hash spreads even sequential keys uniformly.

- **Even load** for writes and point reads.
- **Range queries scatter**: adjacent keys hash to unrelated partitions, so "orders this week" must ask every partition.
- **Compound keys** recover some locality: Cassandra hashes only the *partition key* and keeps rows sorted by the *clustering columns* inside it — `PRIMARY KEY ((event_id), scanned_at)` gives an even spread across events and cheap time ranges within one event.

The naive implementation, `partition = hash(key) mod N`, has a fatal flaw: when **N changes**, almost every key changes partition.

---

## Consistent hashing { #consistent-hashing }

**Consistent hashing**[^2] places both nodes and keys on the same circular hash space (a **ring**, e.g. 0 to 2^64 − 1). Each key belongs to the first node found walking clockwise from the key's position.

``` mermaid-sim
flowchart LR
    K1["key seat:A-12<br/>hash = 0x1F…"] -->|"walk clockwise"| N1["node B<br/>at 0x40…"]
    K2["key seat:C-07<br/>hash = 0x9A…"] -->|"walk clockwise"| N2["node C<br/>at 0xB0…"]
    K3["key seat:Z-99<br/>hash = 0xF3…"] -->|"wraps around"| N0["node A<br/>at 0x10…"]
    NEW["new node D at 0x80…"] -.->|"takes only keys<br/>between 0x40 and 0x80"| N2
```

When a node joins, it takes over only the keys between itself and its predecessor; when a node leaves, only its keys move to its successor. On average **1/N of the keys move**, the minimum possible — compared with almost all of them under `mod N`.

With only one position per node, the arcs are uneven and one node can own far more than its share. **Virtual nodes** (vnodes) fix this: each physical node takes many positions on the ring (100–256 is common), so its total share averages out, and a node with twice the capacity can simply take twice the vnodes.

The simulation below hashes 20,000 keys with MD5. On the left, the percentage of keys that change node when the cluster grows from N − 1 to N nodes; on the right, how unbalanced 10 nodes are (busiest node ÷ average) as the number of virtual nodes grows:

```python exec="1" html="1"
import hashlib
import bisect
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

def h(s):
    return int.from_bytes(hashlib.md5(s.encode()).digest()[:8], "big")

keys = [h(f"seat:{i}") for i in range(20000)]

def ring(n, vnodes):
    pts = sorted((h(f"node{n_}#{v}"), n_) for n_ in range(n) for v in range(vnodes))
    return [p for p, _ in pts], [o for _, o in pts]

def owners(n, vnodes):
    pos, own = ring(n, vnodes)
    return np.array([own[bisect.bisect(pos, k) % len(pos)] for k in keys])

ns = list(range(2, 17))
mod_moved, ch_moved, ideal = [], [], []
prev = owners(1, 100)
for n in ns:
    before = np.array([k % (n - 1) for k in keys])
    after = np.array([k % n for k in keys])
    mod_moved.append(100 * np.mean(before != after))
    cur = owners(n, 100)
    ch_moved.append(100 * np.mean(prev != cur))
    prev = cur
    ideal.append(100 / n)

vn = [1, 4, 16, 64, 256]
imbalance = []
for v in vn:
    counts = np.bincount(owners(10, v), minlength=10)
    imbalance.append(counts.max() / counts.mean())

fig, (a1, a2) = plt.subplots(1, 2, figsize=(11, 4.2))
fig.patch.set_alpha(0)
a1.plot(ns, mod_moved, "o-", color="#E45756", lw=2, label="hash(key) mod N")
a1.plot(ns, ch_moved, "s-", color="#4C78A8", lw=2, label="consistent hashing (100 vnodes)")
a1.plot(ns, ideal, ":", color="#888", lw=2, label="minimum possible: 1/N")
a1.set_xlabel("nodes after adding one (N)")
a1.set_ylabel("% of keys that change node")
a1.set_title("Adding a node: how much data moves?")
a1.set_ylim(0, 100)
a2.bar([str(v) for v in vn], imbalance, color="#54A24B")
a2.axhline(1, color="#888", ls=":")
a2.set_xlabel("virtual nodes per physical node (10 nodes)")
a2.set_ylabel("busiest node / average load")
a2.set_title("Virtual nodes even out the load")
for ax in (a1, a2):
    ax.set_facecolor("none")
    ax.grid(True, alpha=0.25)
    for item in [ax.title, ax.xaxis.label, ax.yaxis.label] + ax.get_xticklabels() + ax.get_yticklabels():
        item.set_color("#888")
    for s in ax.spines.values():
        s.set_color("#888")
    ax.tick_params(colors="#888")
leg = a1.legend(frameon=False, fontsize=9)
for t in leg.get_texts():
    t.set_color("#888")
plt.tight_layout()

buffer = StringIO()
plt.savefig(buffer, format="svg", transparent=True)
print(buffer.getvalue())
plt.close()
```

Going from 9 to 10 nodes with `mod N` moves about 90% of the keys — in a distributed cache, that is the same as flushing the whole cache onto the database at once. With consistent hashing, about 10% move. And with a single position per node, the busiest node carries several times its fair share; a few hundred vnodes bring it close to 1.

Consistent hashing is used by Dynamo and DynamoDB, Cassandra and ScyllaDB, Riak, client-side Memcached sharding (the *ketama* algorithm), Nginx's `hash … consistent` upstreams and many load balancers. Two relatives are worth recognizing: **rendezvous hashing** (highest random weight: each key picks the node with the highest `hash(key, node)`)[^3] and **jump consistent hash** (no ring, near-perfect balance, but nodes can only be added or removed at the end)[^4].

### Fixed number of partitions

A simpler alternative many systems use: create **many more partitions than nodes** up front and assign whole partitions to nodes. Adding a node means moving some *whole partitions* to it; the key → partition mapping never changes.

- **Redis Cluster**: 16,384 hash slots, `slot = CRC16(key) mod 16384`; slots are moved between nodes (see [Redis](../../caching/redis/index.md)).
- **Elasticsearch / OpenSearch**: the number of primary shards is fixed when the index is created.
- **Kafka**: a topic's partitions (see [Kafka](../../messaging/kafka/index.md)).

The catch: choose the count well. Too few partitions limits how far you can scale; too many adds per-partition overhead.

| Strategy | Key → partition | Range queries | Adding a node | Used by |
|---|---|---|---|---|
| Key range | sorted boundaries, split when large | efficient | split and move ranges | Bigtable, HBase, CockroachDB, TiDB, MongoDB (ranged) |
| Hash mod N | `hash(k) mod N` | scatter to all | **moves almost everything** | nothing serious — avoid |
| Consistent hashing | first node clockwise on a ring | scatter to all | ~1/N of keys move | Dynamo, Cassandra, Riak, Memcached clients |
| Fixed partitions | `hash(k) mod P`, P fixed and large | scatter to all | move whole partitions | Redis Cluster, Elasticsearch, Kafka, Couchbase |
| Directory | lookup table key → shard | depends | update the table | custom sharding, Vitess (vindexes) |

---

## Choosing the partition key

The partition key is the most consequential and the least reversible decision of a sharded design. A good key has:

1. **High cardinality** — many distinct values, so the data can be cut into many pieces.
2. **Even distribution** of both data *and traffic* across values.
3. **Query locality** — the most frequent queries and every transaction touch **one** partition.

| BoxOffice data | Candidate key | Locality | Distribution | Verdict |
|---|---|---|---|---|
| `orders`, `tickets` | `customer_id` | "my orders" and checkout touch one shard | millions of customers, even | **good**; event-level reports scatter → run them in the [warehouse](../specialized/index.md#data-warehouses) |
| `orders` | `created_at` | time ranges are local | all of today's writes on one shard | bad (sequential key) |
| `seats` (inventory) | `event_id` | a hold transaction stays in one shard | **one stadium show = one hot shard** | good locality, dangerous skew — see below |
| `seats` | `(event_id, section)` | a hold of seats in one section stays local | the stadium show spreads over ~40 sections | **better** for big events |
| `gate_scans` | `(event_id, gate)` | the gate's recent scans are local | 50 gates spread the load | good |

??? question "Think first: why not partition `seats` by `seat_id` alone?"

    The distribution would be perfect, but the main query — "available seats of event 42, section B" — would scatter to every shard, and a group hold of 4 adjacent seats would become a cross-shard transaction. Locality of the dominant query and of transactions beats a perfect spread.

---

## Hot partitions { #hot-partitions }

Even with a perfect hash, **traffic** is rarely uniform. A **hot partition** (or hot key) receives far more load than the others: the celebrity whose posts everyone reads, the product on a Black Friday deal, the stadium show at 10:00. Hashing cannot spread load that targets *one key*.

**Try it.** The `sharding` scenario spreads a NoSQL table over several partitions. Run it with uniform traffic and note the per-partition load; then make the key distribution skewed (one hot key) and watch a single partition saturate and its latency climb while the others are idle — adding partitions does not help.

<div class="sdp" data-scenario="sharding" data-mode="compact" data-height="520"></div>

Mitigations, from the least to the most invasive:

| Technique | How | Cost |
|---|---|---|
| **Cache the reads** | the hot event page is served from the cache or CDN, not the shard ([Caching](../../caching/index.md)) | staleness |
| **Throttle and queue the writes** | a waiting room admits fans at the rate the shard can serve ([flash-sale scenario](../transactions/index.md#contention)) | users wait |
| **Finer key** | `(event_id, section)` instead of `event_id` | queries over the whole event scatter over ~40 partitions |
| **Key salting / write sharding** | append a suffix `0–9` to a hot key (`event:42#7`); writes pick a random suffix, reads merge all ten | reads do 10× the work |
| **Sharded counters** | "seats left" kept as 10 sub-counters, summed on read | approximate reads during updates |
| **Dedicated capacity** | move the hot partition to its own node; managed stores may split it automatically (DynamoDB adaptive capacity) | operations, cost |

!!! example "BoxOffice: the inventory partition plan"

    - Partition key `(event_id, section)`. A normal concert has 5–10 sections; the stadium show has ~40, spread over many nodes.
    - Holds and confirms are single-partition transactions (all seats of a group hold are in the same section by design of the UI).
    - "Seats left" for the event page is a **sharded counter** per section, aggregated every second into the cache — never a hot row.
    - The **waiting room** limits concurrent hold attempts to what the busiest partition can serve.

---

## Secondary indexes on partitioned data

Partitioning by `customer_id` makes "orders of customer 7" fast. What about "orders of event 42"? A **secondary index** is needed, and on partitioned data it comes in two flavours:

``` mermaid
flowchart TB
    subgraph local ["Local (document-partitioned) index"]
        Q1["query: event_id = 42"] --> P1["shard 1<br/>+ its own index"]
        Q1 --> P2["shard 2<br/>+ its own index"]
        Q1 --> P3["shard 3<br/>+ its own index"]
    end
    subgraph global ["Global (term-partitioned) index"]
        Q2["query: event_id = 42"] --> IX["index partition<br/>for event_id 42"]
        IX --> D1["shard 1"]
        IX --> D3["shard 3"]
    end
```

| | Local index | Global index |
|---|---|---|
| Write | updates the index on the same shard — cheap, transactional | updates an index partition elsewhere — often **asynchronous** |
| Read by indexed column | **scatter/gather** to every shard; tail latency of the slowest one | one index partition, then only the shards that hold matches |
| Examples | MongoDB, Cassandra secondary indexes, Elasticsearch | DynamoDB global secondary indexes (eventually consistent), Spanner/CockroachDB indexes (transactional) |

Scatter/gather is more dangerous than it looks: a query to 20 shards is as slow as the **slowest** of the 20. The chance that all 20 answer within their own p99 is 0.99²⁰ ≈ 82 %, so a shard's p99 is only about the **p82** of the query — 18 % of queries are slower. For the *query* p99 to stay under a target, each shard must meet it at its **p99.95** (0.99^(1/20) ≈ 0.9995) (see [Percentiles](../../estimation/percentiles/index.md)).

---

## Rebalancing and resharding

Nodes are added, removed and fail; data grows unevenly. **Rebalancing** moves partitions so that load stays even, ideally while the database keeps serving traffic and moving only the data that must move.

- Prefer schemes where the key → partition mapping is stable (fixed partitions, consistent hashing, range splits), so rebalancing moves partitions, not individual keys.
- Rebalancing competes with live traffic for network and disk; throttle it, and avoid fully automatic rebalancing triggered by a node that is merely slow (it can cascade).
- **Changing the partition key** (resharding) is a migration project. The common recipe is online:

``` mermaid-sim
flowchart LR
    A["1. create new shards<br/>with the new key"] --> B["2. dual-write:<br/>old + new"]
    B --> C["3. backfill history<br/>(copy + CDC catch-up)"]
    C --> D["4. verify:<br/>compare reads"]
    D --> E["5. switch reads<br/>to new shards"]
    E --> F["6. stop old writes,<br/>delete old shards"]
```

Sharding layers automate much of this for existing relational databases: **Vitess** for MySQL (built at YouTube) and **Citus** for PostgreSQL handle routing, resharding and distributed queries.

### Request routing

Some component must know which node holds which partition:

| Approach | How | Examples |
|---|---|---|
| Any node forwards | the client contacts any node; it forwards or redirects | Cassandra, Redis Cluster (`MOVED` redirects) |
| Routing tier | a stateless proxy knows the map | MongoDB `mongos`, Vitess `vtgate`, Citus coordinator |
| Partition-aware client | the client library caches the map | Kafka clients, DynamoDB SDK via endpoints, smart Redis clients |

The map itself is small, critical metadata — kept in a consensus store such as etcd or ZooKeeper, or gossiped between nodes (see [Consensus](../../distributed/consensus/index.md)).

---

## Cross-partition queries and transactions

Partitioning works beautifully until an operation needs **several partitions at once**:

- **Joins and aggregates** across shards become scatter/gather, done by a coordinator — slower, and limited by the slowest shard.
- **Transactions** across shards need a coordination protocol — two-phase commit or consensus-based commit — with extra round trips and failure modes (see [Transactions](../transactions/index.md#across-services)).
- **Unique constraints** on non-key columns (unique e-mail when sharding by `customer_id`) need a global index or a separate lookup table.

So the design goal is: **choose keys so that the hot path is single-partition**, and send the rest to systems built for it (a warehouse for analytics, a search index for cross-cutting lookups).

---

## NewSQL: distributed SQL databases { #newsql }

What if you want partitioning *and* SQL transactions across partitions, without writing a sharding layer? **NewSQL** or **distributed SQL** databases do this[^5]:

- **Google Spanner**[^6] splits tables into ranges, replicates each range with **Paxos** across zones or regions, and runs distributed transactions with two-phase commit over those groups. Its **TrueTime** API exposes clock uncertainty (a few milliseconds, bounded by GPS and atomic clocks); a commit waits out that uncertainty, which gives **external consistency** (linearizable transactions) across the world.
- **CockroachDB**[^7] (PostgreSQL wire protocol) splits data into ranges of a few hundred megabytes, replicates each with **Raft**, and uses hybrid logical clocks instead of special hardware; serializable isolation is the default.
- **YugabyteDB** (PostgreSQL-compatible) and **TiDB** (MySQL-compatible) follow similar designs; cloud providers offer managed and serverless distributed SQL as well.

``` mermaid-sim
sequenceDiagram
    participant C as Client
    participant G as Gateway node
    participant R1 as Range 1 leader (orders)
    participant R2 as Range 2 leader (tickets)
    C->>G: BEGIN, INSERT order, INSERT tickets, COMMIT
    G->>R1: write intent (replicated by Raft)
    G->>R2: write intent (replicated by Raft)
    R1-->>G: ok (majority acked)
    R2-->>G: ok (majority acked)
    G->>G: commit record (atomic)
    G-->>C: COMMIT ok
```

| | Single-node SQL + replicas | Sharded SQL (Citus, Vitess) | Distributed SQL (Spanner, CockroachDB…) | NoSQL (Cassandra, DynamoDB) |
|---|---|---|---|---|
| Write scaling | one primary | per shard | automatic, per range | automatic, per partition |
| Cross-partition transactions | n/a (one node) | limited / 2PC | **yes**, serializable | limited or none |
| Write latency | lowest | low | + consensus round trip (more if multi-region) | low, tunable |
| SQL and joins | full | most, with caveats | most | none / limited |
| Operations | simple | sharding layer to run | managed or complex | managed or complex |

Distributed SQL is not free: every write is replicated by consensus, so latency is higher than on a single node, and a transaction that spans regions pays inter-region round trips. It is the right answer when you **need** both SQL transactions and more write capacity or geographic resilience than one primary can give — not as a default.

!!! tip "In the interview"

    - Introduce sharding only after estimating: "~1 B orders × 1 KB ≈ 1 TB, ~5 k writes/s at peak — beyond one comfortable primary, so I partition `orders` by `customer_id`".
    - Justify the key with the **three criteria** (cardinality, distribution, locality of the hot path) and name what scatters ("event-level reports go to the warehouse").
    - Say "consistent hashing **with virtual nodes**" and why: adding a node moves ~1/N of the keys, not all of them.
    - Always raise the **hot partition** before the interviewer does — the celebrity, the flash sale — and give a concrete mitigation (cache, finer key, salting, queue).
    - If transactions must span partitions, mention distributed SQL (Spanner, CockroachDB) and its cost: consensus round trips.

!!! warning "Common pitfalls"

    - **`hash mod N`** for anything that will ever resize.
    - **Sequential partition keys** (timestamps, auto-increment) on range partitioning: one hot shard takes every write.
    - **A key that ignores the hot path**: transactions that become cross-shard on day one.
    - **Too few fixed partitions**: you cannot scale past one node per partition later.
    - **Scatter/gather on the hot path**: p99 of the query becomes the p99 of the slowest shard.
    - **Sharding too early**: you pay the complexity for years before you need the capacity.

## How it connects { #how-it-connects }

``` mermaid
flowchart LR
    RANGE["by key range"] --> KEY["choosing the partition key<br/>cardinality, distribution, locality"]
    HASH["by hash"] --> KEY
    CH["consistent hashing<br/>virtual nodes"] --> HASH
    KEY --> HOT["hot partitions<br/>the on-sale event"]
    HOT --> MIT["cache, finer key, salting,<br/>queue → Caching, Messaging"]
    KEY --> SEC["secondary indexes<br/>local vs global"]
    KEY --> RESH["rebalancing,<br/>request routing"]
    KEY --> XP["cross-partition queries<br/>reports → warehouse"]
    XP --> NEW["NewSQL: Spanner, CockroachDB<br/>consensus per range → Distributed"]
    CH -.-> LB["the same ring in load balancers<br/>→ Edge"]
```

**Palette components:** [`nosql`](../../../reference/components/storage/index.md#nosql) (Cassandra, DynamoDB, MongoDB partition by key) · [`sql`](../../../reference/components/storage/index.md#sql) (sharded PostgreSQL, or distributed SQL) · [`cache`](../../../reference/components/storage/index.md#cache) (Redis Cluster hash slots; serves the hot event page instead of the shard) · [`search`](../../../reference/components/compute/index.md#search) (Elasticsearch shards) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (partitions by key) · [`queue`](../../../reference/components/messaging/index.md#queue) (the waiting room in front of a hot partition) · [`lb`](../../../reference/components/edge/index.md#lb) (consistent hashing for affinity) · [`dwh`](../../../reference/components/storage/index.md#dwh) (where scatter-gather reports belong). **Scenarios:** `sharding`, `flash-sale`. **Continues in:** [Specialized Stores](../specialized/index.md), [Distributed — consensus](../../distributed/consensus/index.md), [Edge — load balancing](../../edge/load-balancing/index.md), [Caching — Redis Cluster](../../caching/redis/index.md#cluster), [Case study: distributed cache](../../case-studies/distributed-cache/index.md).

---

[^1]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*. 2nd ed. O'Reilly. Chapter "Sharding" (called "Partitioning" in the 1st edition).
[^2]: KARGER, D. et al. Consistent Hashing and Random Trees: Distributed Caching Protocols for Relieving Hot Spots on the World Wide Web. *ACM STOC*, 1997.
[^3]: THALER, D. G.; RAVISHANKAR, C. V. Using Name-Based Mappings to Increase Hit Rates. *IEEE/ACM Transactions on Networking*, 6(1), 1998.
[^4]: LAMPING, J.; VEACH, E. A Fast, Minimal Memory, Consistent Hash Algorithm. arXiv:1406.2294, 2014.
[^5]: PAVLO, A.; ASLETT, M. What's Really New with NewSQL? *ACM SIGMOD Record*, 45(2), 2016.
[^6]: CORBETT, J. C. et al. Spanner: Google's Globally-Distributed Database. *USENIX OSDI*, 2012.
[^7]: TAFT, R. et al. CockroachDB: The Resilient Geo-Distributed SQL Database. *ACM SIGMOD*, 2020.
