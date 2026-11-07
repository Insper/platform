---
marp: true
lang: en
title: Databases & Data Systems
description: System Architecture · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">System Architecture · Insper</div>

# Databases & Data Systems

**Choose — and scale — the store by the shape of the data**

<!--
Outline: (1) data has a shape: the BoxOffice data map, system of record vs derived data, five questions,
the scaling ladder; (2) data models, SQL vs NoSQL, B-tree vs LSM, indexes; (3) transactions, isolation,
the double-booking bug, seat holds, checkout across services; (4) replication, lag, pooling, failover;
(5) partitioning, consistent hashing, hot partitions, secondary indexes, NewSQL; (6) search, object
storage, warehouse, vector database.
-->

---

## 10:02 on sale day

<div class="q">

One PostgreSQL holds everything. The stadium show goes on sale. What breaks first?

</div>

- **CPU at 100%** — two million fans reading the event page.
- A **"sales per minute" report** scans millions of rows and holds locks for 40 s.
- **Posters in `bytea` columns** bloat the buffer pool and the backups.
- The search box runs `ILIKE '%taylor%'` — full table scans.
- Two fans get **seat A-12**.

<div class="ok">

Nothing is wrong with PostgreSQL: **different data has different shapes**, and one store was asked to be good at all of them.

</div>

---

## Data has a shape

| Property | Question | Why it matters |
|---|---|---|
| **Access pattern** | by key? range? full-text? aggregations? | each store is fast for a few patterns |
| **Read/write ratio, volume** | queries per second (QPS) at peak? bytes, growing how fast? | scale reads (replicas, cache) or writes (shards) |
| **Consistency need** | what breaks if a read is seconds old? if writers race? | money and seats need strong guarantees |
| **Query flexibility** | known queries, or ad hoc every week? | known → NoSQL tables; ad hoc → Structured Query Language (SQL) + indexes |

<div class="ok">

Describe the data **before** naming a database.

</div>

---

<!-- _class: tight -->

## The BoxOffice data map

| Data | Access pattern | Consistency | Component |
|---|---|---|---|
| Seats and holds | point update by `(event, seat)`; bursts at on-sale | **strong** | SQL |
| Orders, payments | by id, by customer, joins | **strong** | SQL |
| Event catalog | read-heavy, by id | seconds stale OK | SQL + cache |
| Search | full-text, typos, ranking | eventual | search engine |
| Posters, ticket PDFs | whole blob by key, via a content delivery network (CDN) | write once | object store |
| Clickstream, sales | aggregations over years | minutes OK | data warehouse |
| Assistant knowledge | nearest by meaning | eventual | vector database |

<p class="small">The volumes differ by orders of magnitude in every column: a store tuned for the first row is a poor fit for the sixth.</p>

---

## System of record, derived data

<div class="flow" style="align-items: stretch">
<div class="box accent" style="flex: .9; display: flex; flex-direction: column; justify-content: center">SQL: seats, orders, events<small>the system of record: every write lands here</small></div>
<div class="arrow" style="align-self: center">change data capture (CDC) →</div>
<div class="group">
<div class="caption">derived data · rebuildable</div>
<div class="box green">search index<small>CDC → indexer</small></div>
<div class="box green">data warehouse<small>CDC, batch loads</small></div>
<div class="box green">vector database<small>embedding worker</small></div>
<div class="box green">cache<small>filled on a miss</small></div>
</div>
</div>

- Writes go **only** to the system of record: back it up carefully.
- A derived store may be thrown away and rebuilt after a bug.
- **Polyglot persistence**: each service picks the store that fits its access pattern.

---

## Five questions that choose a store

1. What is the **system of record**, and what are its invariants?
2. What are the **top 3 queries** — known in advance?
3. **How big, how fast**, growing how? One node + replicas for 2–3 years?
4. **How stale** can a read be?
5. What can the **team operate** at 3 a.m.?

<div class="ok">

Seat inventory: one seat, one hold → **transactions**; 60 k rows is tiny, the problem is **write bursts** → PostgreSQL with row locks, and a slightly stale seat map from the cache.

</div>

---

## The database scaling ladder

<div class="flow">
<div class="box green">1 · fix queries, indexes<small>10–100× on slow queries</small></div><div class="arrow">→</div>
<div class="box green">2 · pool connections<small>a config file</small></div><div class="arrow">→</div>
<div class="box green">3 · scale up<small>2–4×, money</small></div><div class="arrow">→</div>
<div class="box green">4 · cache reads<small>staleness</small></div><div class="arrow">→</div>
<div class="box green">5 · read replicas<small>replication lag</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .7">measured: still not enough →</div>
<div class="box orange">6 · one database per service<small>no cross-service joins</small></div><div class="arrow">→</div>
<div class="box red">7 · partition (shard)<small>cross-shard queries, resharding</small></div><div class="arrow">→</div>
<div class="box orange">8 · specialized stores<small>more systems and pipelines</small></div>
</div>

<p class="small">Green: cheap and reversible. Orange and red: they change the architecture.</p>

<div class="warn">

Climb **in order** and measure before each step. Sharding first is the classic mistake.

</div>

---

## One engine, or a store per need?

| | "Just use Postgres" | A specialized store per need |
|---|---|---|
| Operations | ✅ one thing to run and back up | ⚠️ one more system per need |
| Consistency | ✅ one transaction updates everything | ⚠️ derived stores lag behind (CDC) |
| Peak performance | ⚠️ good enough up to medium scale | ✅ best for its access pattern |
| Features | ⚠️ basic full-text and vector search | ✅ relevance, facets, billions of vectors |

- Microservices: **database per service** — nobody reads another service's tables.
- BoxOffice: PostgreSQL per service; add a store when a **measured** need appears.

---

## Data models compared

| Model | Best at | Weak at | Examples |
|---|---|---|---|
| Relational | invariants, transactions, ad hoc SQL | write scaling (without NewSQL) | PostgreSQL, MySQL |
| Key-value | fastest lookups, easy partitioning | anything not by key | Redis, DynamoDB, etcd |
| Document | aggregates read together, evolving schema | many-to-many, cross-doc invariants | MongoDB, Firestore, JSONB |
| Wide-column | huge write rates, time-ordered rows | joins, ad hoc queries | Cassandra, Bigtable |
| Graph | multi-hop relationships | bulk scans | Neo4j, Neptune |

<p class="small">NoSQL tables are designed from the <b>list of queries</b> (partition key + sort key), the opposite of normalization.</p>

---

## SQL or NoSQL? A decision guide

- **Invariants across rows** (money, stock, uniqueness)? → relational.
- **Ad hoc queries**? → relational.
- Fits **one primary + replicas** for 2–3 years? → relational.
- Otherwise, by shape: blobs → **object store** · key → value with a time to live (TTL) → **key-value** · JSON aggregates → **document** · time-ordered huge writes → **wide-column** · relationships → **graph**.
- Need SQL transactions **and** more than one primary? → **distributed SQL**.

<div class="warn">

Myths: "NoSQL has no schema" (it is in your code) · "SQL does not scale" (replicas, shards, NewSQL) · "NoSQL has no transactions" (most have, with limits).

</div>

---

## Storage engines: B-tree vs log-structured merge (LSM) tree

<div class="cols">
<div>

**B-tree** — sorted pages, update in place

- 8 KiB pages, fan-out ~500 → 1 B rows in **4 levels**
- point read: 1–2 disk reads
- small random write rewrites a whole page (+ the write-ahead log, WAL)
- PostgreSQL, InnoDB, SQL Server

</div>
<div>

**LSM-tree** — append, then merge

- WAL + memtable → immutable sorted string tables (**SSTables**)
- background **compaction** into levels
- **Bloom filters** skip files on reads
- RocksDB, Cassandra, ScyllaDB, Pebble

</div>
</div>

<div class="ok">

B-tree: read-optimized, predictable. LSM: write-optimized; pays in compaction (**write amplification**) and read fan-out.

</div>

---

<!-- _class: tight -->

## Indexes and `EXPLAIN`

<div class="flow">
<div class="box red">Seq Scan<small>3,000,000 rows read, 2,999,713 thrown away · 212 ms</small></div>
<div class="box">Index Scan<small>walk the B-tree, then fetch each row</small></div>
<div class="box green">Index Only Scan<small>answer from the index alone · 0.43 ms</small></div>
</div>

```sql
CREATE INDEX CONCURRENTLY seats_event_section_status_idx
  ON seats (event_id, section, status) INCLUDE (seat_id, price_cents);
```

- **Leftmost prefix**: helps `event_id`, `event_id + section`, all three — not `section` alone.
- Covering (`INCLUDE`), partial (`WHERE status = 'HELD'`), unique, generalized inverted index (GIN), vector (hierarchical navigable small world, HNSW).
- Every index **speeds reads and slows writes** — keep few on write-hot tables.

---

## ACID, concretely

| | Guarantee | For a seat hold |
|---|---|---|
| **A**tomicity | all or nothing | seat `HELD` *and* hold row, or neither |
| **C**onsistency | constraints hold after commit | `UNIQUE (event_id, seat_id)` on tickets |
| **I**solation | interference limited *by the level* | not "one at a time" unless serializable |
| **D**urability | committed survives a crash | not a disk or region loss → replication |

<div class="warn">

Defaults: PostgreSQL **read committed**, MySQL InnoDB **repeatable read**. Both allow anomalies.

</div>

---

## The double-booking bug

| t | Alice (T1) | Bob (T2) |
|---|---|---|
| 1 | `SELECT status` → AVAILABLE | |
| 2 | | `SELECT status` → AVAILABLE |
| 3 | `UPDATE … SET HELD` (locks row) | |
| 4 | | `UPDATE … SET HELD` → waits |
| 5 | `COMMIT` → "seat held" | |
| 6 | | update runs, overwrites → "seat held" |

<div class="warn">

**Check-then-act race → lost update.** The row lock serialized the writes, not the decision.

</div>

<!--
Ask the class before revealing step 6: will Bob's UPDATE fail? Under read committed it re-runs on the
new row version and still matches, because the WHERE has no status condition.
-->

---

<!-- _class: tight -->

## Isolation levels (PostgreSQL)

| Level | Non-repeatable read | Phantom | Lost update | Write skew |
|---|---|---|---|---|
| Read committed (default) | possible | possible | possible | possible |
| Repeatable read (snapshot) | no | no | error → retry | **possible** |
| Serializable snapshot isolation (SSI) | no | no | no | no — error `40001`, retry |

**Write skew** — max 6 tickets per customer. Alice holds 4; two tabs each count 4, each holds 2 *different* seats, both commit → **8 tickets**. No row written twice, so snapshot isolation sees nothing.

- Fix: **serializable** + retry, or **materialize the conflict**: `SELECT … FROM customer_event_limits … FOR UPDATE`.

<p class="small">Multi-version concurrency control (MVCC): readers never block writers; writers to the same row still serialize.</p>

---

<!-- _class: tight -->

## Four ways to fix the double booking

| Fix | Conflict resolution | Under contention | Best for |
|---|---|---|---|
| Conditional `UPDATE … AND status = 'AVAILABLE'` | `WHERE` re-checked; loser updates 0 rows | ✅ good, 1 round trip | single-row check-and-set |
| `SELECT … FOR UPDATE` | loser waits | ⚠️ queues; `NOWAIT` / `SKIP LOCKED` | logic between read and write |
| Optimistic `version` column | loser retries | ❌ many retries | rare conflicts |
| Unique constraint / upsert | constraint rejects loser | ✅ good | "at most one"; last line of defense |

```sql
UPDATE seats SET status = 'HELD', held_by = :me, hold_expires_at = now() + interval '10 minutes'
WHERE event_id = 42 AND seat_id = 'A-12' AND status = 'AVAILABLE';   -- 1 row: yours; 0: taken
```

---

## Try it: two fans, one seat

<div class="flow">
<div class="box red">naive<small>both hear 201 · held_by = Bob</small></div>
<div class="box green">conditional UPDATE<small>Bob waits, then UPDATE 0 → 409</small></div>
<div class="box green">FOR UPDATE<small>Bob waits at the read, reads HELD</small></div>
<div class="box green">optimistic<small>version 8, not 7 → 0 rows</small></div>
<div class="box orange">repeatable read<small>40001 → retry</small></div>
</div>

- The Transactions page embeds the race: pick a strategy, then choose who sends the next statement.
- **Alice first** is safe with every strategy: the bug needs the transactions to overlap — which a unit test never does.

<!--
The simulator sits after "Comparing the fixes". Play the interleaved order with naive first, then switch
strategies without changing the order.
-->

---

## Seat holds: a lease that expires

<div class="flow">
<div class="box">AVAILABLE</div><div class="arrow">hold: conditional UPDATE →</div>
<div class="box orange">HELD<small>for 10 minutes</small></div><div class="arrow">payment confirmed →</div>
<div class="box green">SOLD</div>
</div>
<div class="flow">
<div class="box orange">HELD</div><div class="arrow">expired or cancelled →</div><div class="box">AVAILABLE</div>
<div class="box muted">SOLD → AVAILABLE<small>refund: rare, audited</small></div>
</div>

- **Lazy expiry**: the hold query treats an expired hold as free; a cleanup job only keeps the map accurate.
- **Confirm conditionally**: `… AND status = 'HELD' AND held_by = :me AND hold_expires_at > now()`; 0 rows → refund or another seat.

---

## Hot rows cap throughput

<div class="q">

Every hold decrements `events.seats_left`, holding its lock for **5 ms**. Max holds per second?

</div>

* `1 / 0.005 s` = **200 holds/s** — for two million fans, on any hardware.
* A row lock is a server of capacity 1 (Little's Law).
* Per-seat rows: fans collide only on the **same seat**.
* Never call the payment provider **inside** a transaction: hold → commit → pay → confirm.
* "Best available": `FOR UPDATE SKIP LOCKED`; lock several rows **in the same order**.

---

## Transactions across services: the checkout

<div class="flow">
<div class="box accent">inventory<small>conditional UPDATE → HELD · commit, ~2 ms of lock</small></div><div class="arrow">→</div>
<div class="box accent">order<small>PENDING + outbox event · commit</small></div><div class="arrow">→</div>
<div class="box orange">payment<small>idempotency key = order id · no transaction open</small></div><div class="arrow">→</div>
<div class="box green">inventory<small>conditional confirm → SOLD + ticket · commit</small></div>
</div>

- No ACID transaction spans three databases and a payment provider.
- **Two-phase commit (2PC)** blocks the participants that prepared if the coordinator dies: rare across services, never with a provider.
- **Saga + outbox + idempotency keys**: on failure, compensations release the hold and cancel the order.

---

## Replication: one leader, many copies

- Leader takes writes, ships its log (WAL) to followers; reads anywhere.
- Buys **availability, read scaling, latency, durability** — not write scaling.

| Mode | "Committed" after | On leader loss | Latency |
|---|---|---|---|
| Asynchronous | leader's disk | ❌ last writes **lost** | lowest |
| One sync standby | + one replica | ✅ no loss | + 1 round trip |
| Quorum (Aurora 4/6) | write quorum | ✅ survives a zone | + quorum round trip |

<div class="ok">

Money and seats → **synchronous standby**. Catalog → async replicas.

</div>

---

## When does the leader say "committed"?

<div class="flow">
<div class="arrow" style="flex: .5; text-align: left">Async</div>
<div class="box">COMMIT hold A-12</div><div class="arrow">→</div>
<div class="box accent">WAL on the leader's disk</div><div class="arrow">→</div>
<div class="box green">"committed"</div><div class="arrow">⋯</div>
<div class="box muted">the replica gets the WAL<small>a crash before this loses the hold</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .5; text-align: left">Sync</div>
<div class="box">COMMIT hold A-12</div><div class="arrow">→</div>
<div class="box accent">WAL on the leader's disk</div><div class="arrow">→</div>
<div class="box orange">a standby confirms<small>+1 round trip; waits if it is down</small></div><div class="arrow">→</div>
<div class="box green">"committed"</div>
</div>

- About 1 ms of round trip inside a region, tens to hundreds of ms across continents → cross-region replicas are async.
- `ANY 1 (s1, s2)`: a quorum of standbys tolerates one slow standby.

---

## Replication lag bites users

| Anomaly | User sees | Guarantee, and how |
|---|---|---|
| Read-your-writes | pays, *My tickets* is empty | read from the primary after own writes; wait for the log sequence number (LSN) |
| Monotonic reads | ticket appears, then disappears | a sticky replica per user |
| Consistent prefix | answer before question | causally related writes through one leader or partition |

- Lag is ms on a quiet day, **seconds during the on-sale** — exactly when everyone looks.
- Monitor `replay_lag`; alert on it. Never decide (seat free?) on a replica.
- The page's simulator: lag 1 s, the fan's read on a replica misses A-12; **read your writes** sends it to the leader.

---

## Connection pooling

<div class="q">

2,000 queries/s, 5 ms each. How many connections are busy?

</div>

* **10** on average (Little's Law): a pool of 20–30 absorbs bursts; a pool of 500 only adds contention.
* 20 pods × a pool of 50 = **1,000 connections**, each one a PostgreSQL process.
* PgBouncer in **transaction** mode lends a server connection per transaction: thousands of clients, a few dozen servers.
* Lab 6: PostgreSQL sees at most **20** connections from `inventory`; Flyway goes straight to the primary.

---

## Failover: when the leader dies

<div class="flow">
<div class="box">detect<small>timeout: too short fails over on a garbage-collection (GC) pause; too long, minutes without writes</small></div><div class="arrow">→</div>
<div class="box accent">promote the standby<small>a new timeline</small></div><div class="arrow">→</div>
<div class="box accent">move the clients<small>Domain Name System (DNS), virtual IP, proxy, driver</small></div><div class="arrow">→</div>
<div class="box red">fence the old leader<small>STONITH ("shoot the other node in the head"), fencing tokens</small></div>
</div>

- **Lost writes**: acknowledged by an async leader, never shipped (lab 6: a `201` hold becomes `404`).
- **Split brain**: a leader that is isolated, not dead, keeps writing → consensus decides (Patroni + etcd).
- Managed high availability fails over in tens of seconds to minutes: decide what the app does meanwhile.

---

## Multi-leader and leaderless

<div class="cols">
<div>

**Multi-leader**: writes in several regions

- conflicts: last write wins (LWW, loses data), merge, conflict-free replicated data types (CRDTs)
- OK: event descriptions
- **Not** seats: a conflict is a double booking

</div>
<div>

**Leaderless** (Dynamo, Cassandra)

| N=3 | W | R | |
|---|---|---|---|
| fast | 1 | 1 | stale reads |
| quorum | 2 | 2 | R+W>N ✓ |
| read-fast | 3 | 1 | R+W>N ✓ |

</div>
</div>

<p class="small">Repair: read repair, hinted handoff, anti-entropy (Merkle trees). Quorums are not transactions.</p>

---

<!-- _class: tight -->

## Partitioning (sharding)

| Strategy | Range queries | Adding a node | Used by |
|---|---|---|---|
| Key range (split when big) | ✅ efficient | split, move ranges | Bigtable, HBase, CockroachDB |
| `hash(k) mod N` | scatter | ❌ **moves ~everything** | avoid |
| Consistent hashing + virtual nodes | scatter | ✅ ~1/N of keys move | Dynamo, Cassandra, Memcached clients |
| Fixed partitions (P ≫ nodes) | scatter | move whole partitions | Redis Cluster (16,384 slots), Kafka, Elasticsearch |

<div class="q">

9 → 10 cache nodes: `mod N` moves **~90%** of the keys (a cache flush onto the database); consistent hashing moves **~10%**.

</div>

---

## Choosing the key, and hot partitions

- Key criteria: **cardinality · even traffic · hot path in one partition**.
- `orders` by `customer_id` ✅ — event reports scatter → warehouse.
- `orders` by `created_at` ❌ — all writes on the last range.
- `seats` by `event_id` ⚠️ → the stadium show is **one hot shard**.
- Better: `(event_id, section)` + waiting room + sharded "seats left" counter.
- Other tools: cache reads, key salting (`event:42#7`), dedicated capacity.

<div class="warn">

Hashing cannot spread load that targets **one key**.

</div>

---

<!-- _class: tight -->

## Secondary indexes, scatter/gather, resharding

| | Local index | Global index |
|---|---|---|
| Write | ✅ same shard, transactional | ⚠️ another partition, often async |
| Read by the indexed column | ⚠️ scatter/gather to every shard | ✅ one index partition, then the matching shards |

- 20 shards: all answer within their p99 only 0.99²⁰ ≈ **82%** of the time → each shard must meet the target at its **p99.95**.

<div class="flow">
<div class="box">new shards</div><div class="arrow">→</div>
<div class="box">dual-write</div><div class="arrow">→</div>
<div class="box">backfill + CDC</div><div class="arrow">→</div>
<div class="box orange">verify</div><div class="arrow">→</div>
<div class="box">switch reads</div><div class="arrow">→</div>
<div class="box green">stop old writes</div>
</div>

<p class="small">Changing the partition key is a migration project; Vitess and Citus automate much of it.</p>

---

## NewSQL: distributed SQL

- **Spanner**: ranges replicated by **Paxos**, 2PC across groups, **TrueTime** + commit wait → external consistency.
- **CockroachDB**: ranges replicated by **Raft**, hybrid logical clocks, serializable by default.
- YugabyteDB (Postgres-compatible), TiDB (MySQL-compatible); Citus and Vitess shard existing engines.
- Pay with **latency**: every write is a consensus round trip, more across regions.

<div class="ok">

Use it when you need **SQL transactions and** more write capacity or geo-resilience than one primary — not as a default.

</div>

---

<!-- _class: tight -->

## Specialized stores for derived data

| Store | Answers | Fed by | Key ideas |
|---|---|---|---|
| Search engine | words → ranked documents | CDC → indexer | inverted index, analyzer, BM25, fuzzy, ~1 s refresh |
| Object storage | blob by key | presigned upload | 11 nines design durability, CDN, lifecycle tiers |
| Data warehouse | aggregates over history | extract, load, transform (ELT) / streaming CDC | column store, star schema, Iceberg lakehouse |
| Vector database | nearest by meaning | embedding worker | cosine, approximate nearest neighbour (ANN): HNSW, inverted file (IVF); recall vs latency |

<div class="warn">

No **dual writes** (database + index from the app): they drift. Use CDC or the outbox; rebuild derived stores by replay.

</div>

---

## In the interview

- Name the store **per data**, justified by the access pattern: "seats → SQL, the invariant needs transactions".
- Estimate to show **which dimension is hard**: "60 k seats is tiny — the problem is write contention".
- Scarce resource → **check-then-act race** → conditional `UPDATE` + unique constraint.
- Replicas → **and** "own writes read from the primary".
- Shards → key by the three criteria, **raise the hot partition yourself**, consistent hashing with virtual nodes.

---

<!-- _class: tight -->

## The databases concept map

| Component | Question it answers | Key concepts |
|---|---|---|
| `sql` | where does data with invariants live? | ACID, isolation, conditional `UPDATE`, indexes |
| `sql` (replicas) | how to scale reads, survive a dead leader? | lag, read-your-writes, pooling, failover |
| `nosql` | which access pattern leaves SQL — and grows past one node? | key-value / document / wide-column, LSM, partition keys, hot partitions |
| `search` | how do fans find events by text? | inverted index, ranking, CDC |
| `objstore` | where do posters and PDFs live? | keys in the DB, presigned URLs, CDN |
| `dwh` | where do analysts' queries run? | online analytical processing (OLAP), columns, star schema, ELT |
| `vectordb` | how to find text by meaning? | embeddings, ANN / HNSW, pgvector first |

<p class="small">One <b>system of record</b>; every other store is derived data, fed by change streams and rebuildable.</p>

---

## Takeaways

1. Describe data by **access pattern, volume, consistency, query flexibility**; separate system of record from derived data.
2. Relational is the default for **invariants**; NoSQL tables are designed from the queries.
3. B-tree reads well, LSM writes well; every index costs writes.
4. Default isolation levels allow anomalies: fix the **check-then-act race** in the `WHERE` or with a constraint.
5. Replicas scale reads and bring **lag**; sync standby for money and seats; a failover needs fencing.
6. Partition by a key that keeps the hot path local; consistent hashing moves ~1/N; **hot keys** need more than hashing.
7. Search, object storage, warehouse and vector database answer the questions SQL answers badly.
