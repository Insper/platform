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

<div class="kicker">System Architecture · Insper</div>

# Databases & Data Systems

**Choose — and scale — the store by the shape of the data**

<!--
Outline: (1) data has a shape: the BoxOffice data map, system of record vs derived data, the scaling
ladder; (2) data models, SQL vs NoSQL, B-tree vs LSM, indexes; (3) transactions, isolation and the
double-booking bug; (4) replication and lag; (5) partitioning, consistent hashing, hot partitions,
NewSQL; (6) search, object storage, warehouse, vector DB.
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
| **Read/write ratio, volume** | QPS at peak? bytes, growing how fast? | scale reads (replicas, cache) or writes (shards) |
| **Consistency need** | what breaks if a read is seconds old? if writers race? | money and seats need strong guarantees |
| **Query flexibility** | known queries, or ad hoc every week? | known → NoSQL tables; ad hoc → SQL + indexes |

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
| Posters, ticket PDFs | whole blob by key, via CDN | write once | object store |
| Clickstream, sales | aggregations over years | minutes OK | data warehouse |
| Assistant knowledge | nearest by meaning | eventual | vector DB |

<p class="small">System of record = the SQL rows. Cache, index, warehouse and vectors are <b>derived data</b>: rebuildable from it, fed by CDC.</p>

---

<!-- _class: tight -->

## The database scaling ladder

| Step | Buys | Costs |
|---|---|---|
| 1. Fix queries, add indexes | 10–100× on slow queries | almost nothing |
| 2. Pool connections | stops connection storms | a config file |
| 3. Scale up | 2–4×, no code change | money; a largest machine |
| 4. Cache reads | removes most read traffic | staleness, invalidation |
| 5. Read replicas | reads × replicas | replication lag |
| 6. One DB per service | isolated workloads | no cross-service joins |
| 7. Partition (shard) | writes and storage × shards | cross-shard queries, resharding |
| 8. Specialized stores | the right engine per query | more systems and pipelines |

<div class="warn">

Climb **in order** and measure before each step. Sharding first is the classic mistake.

</div>

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
- Otherwise, by shape: blobs → **object store** · key → value with TTL → **key-value** · JSON aggregates → **document** · time-ordered huge writes → **wide-column** · relationships → **graph**.
- Need SQL transactions **and** more than one primary? → **distributed SQL**.

<div class="warn">

Myths: "NoSQL has no schema" (it is in your code) · "SQL does not scale" (replicas, shards, NewSQL) · "NoSQL has no transactions" (most have, with limits).

</div>

---

## Storage engines: B-tree vs LSM-tree

<div class="cols">
<div>

**B-tree** — sorted pages, update in place

- 8 KiB pages, fan-out ~500 → 1 B rows in **4 levels**
- point read: 1–2 disk reads
- small random write rewrites a whole page (+ WAL)
- PostgreSQL, InnoDB, SQL Server

</div>
<div>

**LSM-tree** — append, then merge

- WAL + memtable → immutable **SSTables**
- background **compaction** into levels
- **Bloom filters** skip files on reads
- RocksDB, Cassandra, ScyllaDB, Pebble

</div>
</div>

<div class="ok">

B-tree: read-optimized, predictable. LSM: write-optimized; pays in compaction (**write amplification**) and read fan-out.

</div>

---

## Indexes and `EXPLAIN`

```sql
CREATE INDEX CONCURRENTLY seats_event_section_status_idx
  ON seats (event_id, section, status) INCLUDE (seat_id, price_cents);
-- before: Seq Scan, Rows Removed by Filter: 2999713, 212 ms
-- after:  Index Only Scan, 0.43 ms
```

- **Leftmost prefix**: helps `event_id`, `event_id + section`, all three — not `section` alone.
- Covering (`INCLUDE`), partial (`WHERE status = 'HELD'`), unique, GIN, HNSW.
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
| Serializable (SSI) | no | no | no | no — error `40001`, retry |

**Write skew** — max 6 tickets per customer. Alice holds 4; two tabs each count 4, each holds 2 *different* seats, both commit → **8 tickets**. No row written twice, so snapshot isolation sees nothing.

- Fix: **serializable** + retry, or **materialize the conflict**: `SELECT … FROM customer_event_limits … FOR UPDATE`.

<p class="small">MVCC: readers never block writers; writers to the same row still serialize.</p>

---

<!-- _class: tight -->

## Four ways to fix the double booking

| Fix | Conflict resolution | Under contention | Best for |
|---|---|---|---|
| Conditional `UPDATE … AND status = 'AVAILABLE'` | `WHERE` re-checked; loser updates 0 rows | good, 1 round trip | single-row check-and-set |
| `SELECT … FOR UPDATE` | loser waits | queues; `NOWAIT` / `SKIP LOCKED` | logic between read and write |
| Optimistic `version` column | loser retries | many retries | rare conflicts |
| Unique constraint / upsert | constraint rejects loser | good | "at most one"; last line of defense |

```sql
UPDATE seats SET status = 'HELD', held_by = :me, hold_expires_at = now() + interval '10 minutes'
WHERE event_id = 42 AND seat_id = 'A-12' AND status = 'AVAILABLE';   -- 1 row: yours; 0: taken
```

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

## Replication: one leader, many copies

- Leader takes writes, ships its log (WAL) to followers; reads anywhere.
- Buys **availability, read scaling, latency, durability** — not write scaling.

| Mode | "Committed" after | On leader loss | Latency |
|---|---|---|---|
| Asynchronous | leader's disk | last writes **lost** | lowest |
| One sync standby | + one replica | no loss | + 1 round trip |
| Quorum (Aurora 4/6) | write quorum | survives a zone | + quorum round trip |

<div class="ok">

Money and seats → **synchronous standby**. Catalog → async replicas.

</div>

---

## Replication lag bites users

| Anomaly | User sees | Fix |
|---|---|---|
| Read-your-writes | pays, *My tickets* is empty | read from primary after own writes; wait for LSN |
| Monotonic reads | ticket appears, then disappears | sticky replica per user |
| Consistent prefix | answer before question | causally ordered writes |

- Lag is ms on a quiet day, **seconds during the on-sale** — exactly when everyone looks.
- Monitor `replay_lag`; alert on it. Never decide (seat free?) on a replica.
- Failover: detect by timeout, promote, **fence** the old leader (split brain).

---

## Multi-leader and leaderless

<div class="cols">
<div>

**Multi-leader**: writes in several regions

- conflicts: LWW (loses data), merge, CRDTs
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
| Key range (split when big) | efficient | split, move ranges | Bigtable, HBase, CockroachDB |
| `hash(k) mod N` | scatter | **moves ~everything** | avoid |
| Consistent hashing + vnodes | scatter | ~1/N of keys move | Dynamo, Cassandra, Memcached clients |
| Fixed partitions (P ≫ nodes) | scatter | move whole partitions | Redis Cluster (16,384 slots), Kafka, Elasticsearch |

<div class="q">

9 → 10 cache nodes: `mod N` moves **~90%** of the keys (a cache flush onto the DB); consistent hashing moves **~10%**.

</div>

---

## Choosing the key, and hot partitions

- Key criteria: **cardinality · even traffic · hot path in one partition**.
- `orders` by `customer_id` ✓ — event reports scatter → warehouse.
- `orders` by `created_at` ✗ — all writes on the last range.
- `seats` by `event_id` → the stadium show is **one hot shard**.
- Better: `(event_id, section)` + waiting room + sharded "seats left" counter.
- Other tools: cache reads, key salting (`event:42#7`), dedicated capacity.

<div class="warn">

Hashing cannot spread load that targets **one key**. Scatter/gather p99 = slowest shard.

</div>

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

## Specialized stores for derived data

| Store | Answers | Fed by | Key ideas |
|---|---|---|---|
| Search engine | words → ranked documents | CDC → indexer | inverted index, analyzer, BM25, fuzzy, ~1 s refresh |
| Object storage | blob by key | presigned upload | 11 nines design durability, CDN, lifecycle tiers |
| Data warehouse | aggregates over history | ELT / streaming CDC | column store, star schema, Iceberg lakehouse |
| Vector DB | nearest by meaning | embedding worker | cosine, ANN (HNSW, IVF), recall vs latency |

<div class="warn">

No **dual writes** (DB + index from the app): they drift. Use CDC or the outbox; rebuild derived stores by replay.

</div>

---

## In the interview

- Name the store **per data**, justified by the access pattern: "seats → SQL, the invariant needs transactions".
- Estimate to show **which dimension is hard**: "60 k seats is tiny — the problem is write contention".
- Scarce resource → **check-then-act race** → conditional `UPDATE` + unique constraint.
- Replicas → **and** "own writes read from the primary".
- Shards → key by the three criteria, **raise the hot partition yourself**, consistent hashing with vnodes.

---

<!-- _class: tight -->

## The databases concept map

| Component | Question it answers | Key concepts |
|---|---|---|
| `sql` | where does data with invariants live? | ACID, isolation, conditional `UPDATE`, indexes |
| `sql` (replicas) | how to scale reads, survive a dead leader? | lag, read-your-writes, pooling, failover |
| `nosql` | which access pattern leaves SQL — and grows past one node? | KV / document / wide-column, LSM, partition keys, hot partitions |
| `search` | how do fans find events by text? | inverted index, ranking, CDC |
| `objstore` | where do posters and PDFs live? | keys in the DB, presigned URLs, CDN |
| `dwh` | where do analysts' queries run? | OLAP, columns, star schema, ELT |
| `vectordb` | how to find text by meaning? | embeddings, ANN / HNSW, pgvector first |

<p class="small">One <b>system of record</b>; every other store is derived data, fed by change streams and rebuildable.</p>

---

## Takeaways

1. Describe data by **access pattern, volume, consistency, query flexibility**; separate system of record from derived data.
2. Relational is the default for **invariants**; NoSQL tables are designed from the queries.
3. B-tree reads well, LSM writes well; every index costs writes.
4. Default isolation levels allow anomalies: fix the **check-then-act race** in the `WHERE` or with a constraint.
5. Replicas scale reads and bring **lag**; sync standby for money and seats.
6. Partition by a key that keeps the hot path local; consistent hashing moves ~1/N; **hot keys** need more than hashing.
7. Search, object storage, warehouse and vector DB answer the questions SQL answers badly.
