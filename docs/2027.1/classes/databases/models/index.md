"Should we use SQL or NoSQL?" is the most common storage question in design reviews and interviews, and also the most badly posed. "NoSQL" is not one thing: a key-value store, a document database, a wide-column store and a graph database are as different from each other as each is from PostgreSQL. And underneath the data model sits a second choice that matters just as much for performance — the **storage engine** that lays the bytes on disk.

This page takes one piece of BoxOffice — events, venues, seats and orders — and stores it in each model, then opens the engine room: B-trees, LSM-trees and indexes.

---

## The relational model { #relational }

The relational model stores data as **tables** (relations) of **rows** with a fixed set of typed **columns**. Relationships are expressed by **foreign keys**, and queries combine tables with **joins**. The schema is declared up front and enforced on every write (**schema-on-write**)[^1].

```sql title="BoxOffice core schema (PostgreSQL)"
CREATE TABLE venues (
    id        BIGSERIAL PRIMARY KEY,
    name      TEXT NOT NULL,
    city      TEXT NOT NULL,
    capacity  INT  NOT NULL CHECK (capacity > 0)
);

CREATE TABLE events (
    id        BIGSERIAL PRIMARY KEY,
    venue_id  BIGINT NOT NULL REFERENCES venues(id),
    title     TEXT NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    on_sale_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE seats (
    event_id  BIGINT NOT NULL REFERENCES events(id),
    seat_id   TEXT   NOT NULL,              -- 'A-12'
    section   TEXT   NOT NULL,
    price_cents INT  NOT NULL,
    status    TEXT   NOT NULL DEFAULT 'AVAILABLE'
              CHECK (status IN ('AVAILABLE', 'HELD', 'SOLD')),
    held_by   BIGINT,
    hold_expires_at TIMESTAMPTZ,
    version   INT    NOT NULL DEFAULT 0,
    PRIMARY KEY (event_id, seat_id)
);

CREATE TABLE orders (
    id          BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL,
    event_id    BIGINT NOT NULL REFERENCES events(id),
    total_cents INT    NOT NULL,
    status      TEXT   NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tickets (
    order_id  BIGINT NOT NULL REFERENCES orders(id),
    event_id  BIGINT NOT NULL,
    seat_id   TEXT   NOT NULL,
    PRIMARY KEY (event_id, seat_id),        -- one ticket per seat, enforced by the database
    FOREIGN KEY (event_id, seat_id) REFERENCES seats(event_id, seat_id)
);
```

Three properties make the relational model the default for a system of record:

- **Normalization** — each fact is stored once (the venue's city lives in `venues`, not copied into every event), so an update cannot leave two copies disagreeing.
- **Constraints** — `PRIMARY KEY (event_id, seat_id)` on `tickets` makes double-selling a seat *impossible*, no matter how buggy the application code is.
- **Declarative queries** — you say *what* you want; the query planner decides *how*, using whatever indexes exist. New questions do not need new tables.

```sql title="An ad hoc question, answered with joins"
-- Revenue per city for shows in December, best first
SELECT v.city, SUM(o.total_cents) / 100.0 AS revenue
FROM orders o
JOIN events e ON e.id = o.event_id
JOIN venues v ON v.id = e.venue_id
WHERE o.status = 'PAID'
  AND e.starts_at >= '2026-12-01' AND e.starts_at < '2027-01-01'
GROUP BY v.city
ORDER BY revenue DESC;
```

The costs: rows that belong together (an event and its lineup and prices) are spread across tables and reassembled by joins; the schema must be migrated (with Flyway in [Hands-on 1](../../../hands-on/1/index.md)) before new fields appear; and scaling writes beyond one node needs partitioning, which breaks cross-partition joins and transactions (see [Partitioning](../partitioning/index.md)).

---

## Document databases

A **document database** stores self-contained, nested documents — usually JSON or a binary form of it — addressed by a key. Everything you need to render an event page can live in one document:

```json title="events/42 as a document"
{
  "_id": 42,
  "title": "Stadium Tour 2027",
  "venue": { "id": 7, "name": "Allianz Parque", "city": "São Paulo" },
  "startsAt": "2027-03-14T21:00:00-03:00",
  "lineup": ["Main act", "Opening act"],
  "priceTiers": [
    { "section": "Pista", "priceCents": 49000 },
    { "section": "Cadeira Superior", "priceCents": 29000 }
  ],
  "tags": ["pop", "stadium"]
}
```

- **Locality**: one read returns the whole page; no joins. Great for "load the aggregate by id".
- **Flexible schema** (**schema-on-read**): a festival can carry a `stages` array that a football game does not have.
- **Weakness — many-to-many relationships**: the venue is *copied* into every event. Renaming the venue means updating thousands of documents, or accepting stale copies. Queries that cut across documents ("all events at venue 7") need secondary indexes or a different collection.

Products: MongoDB, Couchbase, Google Firestore, Azure Cosmos DB, Amazon DocumentDB — and PostgreSQL itself with `JSONB` columns and GIN indexes, which is often enough.

---

## Key-value stores

The simplest model: an opaque **value** looked up by a **key** — `GET`, `PUT`, `DELETE`, sometimes with a TTL. No queries by value, no joins, so the store can be extremely fast and easy to partition by key.

| Store | Typical use at BoxOffice |
|---|---|
| Redis / Valkey (in memory) | sessions, rate-limit counters, cached event pages, waiting-room position (see [Caching](../../caching/index.md)) |
| Amazon DynamoDB, Azure Cosmos DB (key-value / document APIs) | huge, predictable lookups at any scale, e.g. "tickets of customer X" |
| etcd, ZooKeeper, Consul | small, strongly consistent configuration and leader election |

DynamoDB deserves a note because it is a common interview answer. It is a managed, partitioned key-value and document store: each item has a **partition key** (hashed to choose the partition) and an optional **sort key** (items with the same partition key are stored sorted, so range queries within a partition are cheap). You design the table around the queries — the opposite of normalization.

| Access pattern | Partition key | Sort key |
|---|---|---|
| Tickets of a customer, newest first | `CUSTOMER#7` | `ORDER#2027-03-01T10:02#9001` |
| Seats of an event section | `EVENT#42#SEC#B` | `SEAT#A-12` |

The design starts from the list of queries; a new query that does not fit the keys needs a **global secondary index** — or a new table.

---

## Wide-column stores

**Wide-column** stores (Apache Cassandra, ScyllaDB, Google Bigtable, Apache HBase) organize rows into **partitions** by a partition key, and sort rows *inside* a partition by **clustering columns**. They are built for very high write throughput across many nodes, with tunable consistency (see [Replication](../replication/index.md#leaderless)).

```sql title="Cassandra (CQL): one table per query"
-- Query: "the last 50 scans at gate 3 of event 42" (anti-fraud at the stadium)
CREATE TABLE gate_scans_by_event (
    event_id   bigint,
    gate       int,
    scanned_at timestamp,
    ticket_id  uuid,
    result     text,
    PRIMARY KEY ((event_id, gate), scanned_at, ticket_id)
) WITH CLUSTERING ORDER BY (scanned_at DESC, ticket_id ASC);

SELECT * FROM gate_scans_by_event
WHERE event_id = 42 AND gate = 3
LIMIT 50;
```

The syntax looks like SQL, but the rules are different: you can only filter by the partition key (and then by clustering columns in order); there are no joins; each query gets its own denormalized table. In exchange, writes are appends to an LSM-tree (see [below](#lsm-trees)) and spread over every node — ideal for time series, event logs, IoT and messaging at large scale.

---

## Graph databases

When the questions are about **relationships** — paths, neighbours, communities — a **graph database** stores nodes and edges as first-class citizens. Neo4j (query language Cypher), Amazon Neptune and the ISO standard query language GQL (2024) are examples.

```cypher title="Fans who bought this show also bought…"
MATCH (e:Event {id: 42})<-[:BOUGHT]-(f:Fan)-[:BOUGHT]->(other:Event)
WHERE other.startsAt > datetime()
RETURN other.title, count(f) AS fans
ORDER BY fans DESC
LIMIT 5;
```

In SQL the same query is a self-join of `orders` with itself; it works for one hop but grows painful for "friends of friends of friends" or fraud rings (cards, devices and accounts linked across many hops). Most systems never need a graph database; recommendation and fraud teams sometimes do.

---

## Comparing the models

| Model | Data unit | Best at | Weak at | Examples |
|---|---|---|---|---|
| Relational | rows in tables, joins | invariants, transactions, ad hoc queries | horizontal write scaling (without NewSQL) | PostgreSQL, MySQL, SQL Server, Oracle |
| Key-value | opaque value by key | the fastest lookups, easy partitioning | any query not by key | Redis, Valkey, DynamoDB, etcd |
| Document | nested JSON by key | aggregates read together, evolving schemas | many-to-many, cross-document invariants | MongoDB, Firestore, Cosmos DB, Postgres JSONB |
| Wide-column | rows sorted inside partitions | massive write throughput, time-ordered data | joins, ad hoc queries, strong consistency by default | Cassandra, ScyllaDB, Bigtable, HBase |
| Graph | nodes and edges | multi-hop relationship queries | bulk scans and aggregations | Neo4j, Neptune |
| Time series | (series, timestamp, value) | metrics, downsampling, retention | general-purpose queries | Prometheus, InfluxDB, TimescaleDB |

---

## SQL or NoSQL? A decision guide { #decision-guide }

The guide below encodes the questions from the [overview](../index.md#five-questions). Read it as "the default is relational; each arrow out of it needs a reason".

``` diagram
flowchart TD
    A["New data to store"] --> B{"Invariants across rows?<br/>money, stock, uniqueness"}
    B -->|yes| SQL["Relational database<br/>PostgreSQL / MySQL"]
    B -->|no| C{"Queries known in advance<br/>and mostly by key?"}
    C -->|no, ad hoc| SQL
    C -->|yes| D{"Scale beyond one node<br/>for writes or storage?"}
    D -->|no| SQL
    D -->|yes| E{"Shape of the data?"}
    E -->|"blob: images, PDFs"| OBJ["Object storage"]
    E -->|"key → value, TTL"| KV["Key-value<br/>Redis, DynamoDB"]
    E -->|"aggregate as JSON"| DOC["Document<br/>MongoDB, Firestore"]
    E -->|"time-ordered, huge writes"| WC["Wide-column<br/>Cassandra, Bigtable"]
    E -->|"multi-hop relationships"| GR["Graph<br/>Neo4j"]
    SQL --> F{"Outgrows one primary?"}
    F -->|"yes, need SQL + scale"| NEW["Distributed SQL<br/>Spanner, CockroachDB"]
```

And for the *derived* data, the question is the query, not the scale: full-text → [search engine](../specialized/index.md#search-engines), aggregations over history → [data warehouse](../specialized/index.md#data-warehouses), similarity by meaning → [vector database](../specialized/index.md#vector-databases).

Some myths to retire before an interview:

| Myth | Reality |
|---|---|
| "NoSQL has no schema." | It has an *implicit* schema in the application code — and every reader must handle every old version of it. |
| "SQL does not scale." | Read replicas, partitioning and distributed SQL scale relational databases to very large workloads; most companies never outgrow one primary. |
| "NoSQL has no transactions." | DynamoDB, MongoDB and Cosmos DB offer multi-item transactions, with limits on size and scope. |
| "NoSQL is faster." | A key lookup is fast on any engine. NoSQL is faster at the patterns it was designed for and slower (or unable) at the rest. |
| "Pick one for the whole company." | Polyglot persistence: choose per service and per access pattern. |

??? question "Think first: where would you store BoxOffice's seat inventory if it had to serve a 200 k-seat festival with 50 entry gates?"

    Still a relational database — the invariant (one seat, one ticket) is the deciding factor, and 200 k rows is small. The **gate scans**, on the other hand, are append-only, time-ordered, written by 50 gates at once and queried by `(event, gate)` → a wide-column store (or a partitioned SQL table) fits them. Same event, two different stores, decided by access pattern.

---

## Storage engines: how bytes reach the disk

A database is, at its core, two operations: *store this key and value* and *give me the value for this key* (or this range of keys). How it lays the data on disk determines the cost of each. Two families dominate: **B-trees** (update pages in place) and **LSM-trees** (append, then merge)[^2].

### B-trees

A **B-tree** keeps keys sorted in fixed-size **pages** (8 KiB in PostgreSQL, 16 KiB in MySQL InnoDB). Each internal page holds hundreds of keys and pointers to child pages; leaves hold the rows or pointers to them. Lookups walk from the root to a leaf[^3].

``` diagram-sim
flowchart TD
    R["root page<br/>… | 30 | 60 | …"] -->|"key 42"| I["internal page<br/>31 … 40 | 41 … 50 | …"]
    I -->|"key 42"| L["leaf page<br/>41, 42, 43 … → rows"]
    L -->|"update in place:<br/>rewrite the 8 KiB page"| D[("disk")]
    W["write-ahead log (WAL)<br/>append the change first"] --> D
```

The numbers explain why B-trees are everywhere. With 8 KiB pages and ~16 bytes per key + pointer, one page has a **fan-out** of ~500:

| Levels | Keys reachable (500^levels) |
|---|---|
| 2 | 250 thousand |
| 3 | 125 million |
| 4 | 62.5 billion |

A billion-row table is **4 levels deep**, and the top levels stay cached in memory, so a point lookup costs one or two disk reads. Writes, though, modify a page **in place**: changing a 100-byte row dirties a whole 8 KiB page that is later written back, and the change is also appended to the **write-ahead log** (WAL) for crash recovery. Used by PostgreSQL, MySQL InnoDB, SQL Server, Oracle, SQLite.

### LSM-trees { #lsm-trees }

A **log-structured merge-tree** (LSM-tree) never updates in place[^4]. Writes go to the WAL and to an in-memory sorted table (the **memtable**); when it fills, it is flushed to disk as an immutable sorted file (an **SSTable**). Background **compaction** merges SSTables into larger, sorted levels and drops overwritten and deleted values.

``` diagram-sim
flowchart LR
    W["write key=42"] --> WAL["WAL<br/>append"]
    W --> M["memtable<br/>in memory, sorted"]
    M -->|"full → flush"| L0["L0 SSTables"]
    L0 -->|"compaction"| L1["L1 (10× bigger)"]
    L1 -->|"compaction"| L2["L2 (10× bigger)"]
    R["read key=42"] --> M
    R -->|"bloom filter says<br/>'maybe here'"| L1
```

Writes are sequential appends — very fast, even on slow disks. Reads may have to check the memtable and several levels; **Bloom filters** (a compact probabilistic set per SSTable that answers "definitely not here" or "maybe here") skip most of them. Used by RocksDB (inside many systems), Cassandra, ScyllaDB, HBase, Bigtable, LevelDB, and CockroachDB's Pebble.

### Write amplification

**Write amplification** is the number of bytes the engine writes to disk for each byte the application writes. It drives SSD wear, I/O cost and peak write throughput. The model below is a back-of-the-envelope intuition, not a benchmark: a B-tree that rewrites a whole 8 KiB page per random small update (plus the WAL), and a leveled LSM-tree with size ratio 10 where each record is rewritten about 5 times per level during compaction (plus the WAL and the flush).

```python exec="1" html="1"
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

# Back-of-the-envelope model (assumptions, not a benchmark):
# B-tree: every random update dirties one 8 KiB page that is later written back
#         whole, plus the record in the write-ahead log (WAL).
# LSM (leveled): WAL + memtable flush + each record rewritten ~T/2 times per level.
page = 8 * 1024
row = np.logspace(np.log10(32), np.log10(8192), 200)
btree = 1 + np.maximum(page / row, 1)
T = 10

fig, ax = plt.subplots(figsize=(9, 4.2))
fig.patch.set_alpha(0)
ax.plot(row, btree, color="#4C78A8", lw=2.5, label="B-tree (8 KiB pages, random updates)")
for levels, style in [(3, ":"), (4, "--"), (5, "-.")]:
    lsm = 2 + levels * T / 2
    ax.plot(row, np.full_like(row, lsm), color="#E45756", lw=2, ls=style,
            label=f"LSM, leveled, {levels} levels (~{lsm:.0f}x)")
ax.set_xscale("log", base=2)
ax.set_yscale("log")
ax.set_xticks([32, 128, 512, 2048, 8192])
ax.set_xticklabels(["32 B", "128 B", "512 B", "2 KiB", "8 KiB"])
ax.set_xlabel("record size")
ax.set_ylabel("bytes written to disk per byte written by the app")
ax.set_title("Write amplification: a back-of-the-envelope model")
ax.grid(True, which="both", alpha=0.25)
for item in [ax.title, ax.xaxis.label, ax.yaxis.label] + ax.get_xticklabels() + ax.get_yticklabels():
    item.set_color("#888")
for s in ax.spines.values():
    s.set_color("#888")
ax.tick_params(colors="#888", which="both")
leg = ax.legend(frameon=False, fontsize=9)
for t in leg.get_texts():
    t.set_color("#888")
ax.set_facecolor("none")
plt.tight_layout()

buffer = StringIO()
plt.savefig(buffer, format="svg", transparent=True)
print(buffer.getvalue())
plt.close()
```

Read the plot as intuition:

- For **small records updated at random** (counters, statuses, events), the B-tree pays for a whole page per tiny change, and the LSM-tree's sequential, batched writes win. That is why write-heavy stores (Cassandra, RocksDB) are LSM-based.
- For **large records**, the page cost is amortized and the LSM-tree's repeated compaction dominates. Real B-tree engines also batch many updates to the same page before writing it, which lowers their curve a lot for workloads with locality.
- More data means more LSM levels, so its write amplification grows slowly with the dataset.

| | B-tree | LSM-tree |
|---|---|---|
| Point read | 1–2 page reads (upper levels cached) | memtable + one SSTable per level, mostly skipped by Bloom filters |
| Range scan | excellent: leaves are sorted and linked | good, but merges several levels |
| Random small writes | in-place page writes; amplification depends on record size | sequential appends; amplification ≈ levels × size ratio |
| Space | some free space inside pages (fragmentation) | obsolete versions until compaction; compressed files |
| Latency predictability | stable | compaction can cause background I/O spikes |
| Typical engines | PostgreSQL, InnoDB, SQL Server, SQLite | RocksDB, Cassandra, ScyllaDB, HBase, Pebble |

---

## Indexes

An **index** is an additional data structure — usually a B-tree — that maps column values to the rows that contain them, so the database finds rows without scanning the whole table. The primary key is always indexed; every other index is your decision, and each one **speeds up reads and slows down writes** (every `INSERT`/`UPDATE` must update every index on the table).

| Index kind | What it is | BoxOffice example |
|---|---|---|
| Single-column | B-tree on one column | `orders(customer_id)` for "my orders" |
| Composite | B-tree on several columns, sorted by the first, then the second… | `seats(event_id, section, status)` |
| Covering | composite index that also stores the columns the query returns (`INCLUDE`), so the table is not touched | `seats(event_id, section) INCLUDE (seat_id, price_cents)` |
| Partial | indexes only rows matching a condition | `seats(event_id, hold_expires_at) WHERE status = 'HELD'` — only holds, tiny |
| Unique | rejects duplicates | `tickets(event_id, seat_id)` — the anti-double-booking guarantee |
| GIN / full-text | inverted index on words or JSON keys | `events USING GIN (to_tsvector('portuguese', title))` |
| Vector (HNSW, IVF) | approximate nearest neighbours | `pgvector` index for the assistant ([Specialized](../specialized/index.md#vector-databases)) |

A composite index follows the **leftmost-prefix rule**: an index on `(event_id, section, status)` helps queries that filter by `event_id`, by `event_id AND section`, or by all three — but not by `section` alone, just as a phone book sorted by surname then first name does not help you find everyone named "Ana".

### Reading `EXPLAIN`

`EXPLAIN` shows the plan the database chose; `EXPLAIN ANALYZE` also runs the query and reports real times. The output below is illustrative, for a `seats` table with 3 million rows (50 events of 60 k seats):

```sql title="Before: no index on section/status"
EXPLAIN ANALYZE
SELECT seat_id, price_cents FROM seats
WHERE event_id = 42 AND section = 'B' AND status = 'AVAILABLE';

-- Seq Scan on seats  (cost=0.00..71842.00 rows=310 width=12)
--                    (actual time=0.031..212.448 rows=287 loops=1)
--   Filter: ((event_id = 42) AND (section = 'B') AND (status = 'AVAILABLE'))
--   Rows Removed by Filter: 2999713
-- Execution Time: 212.502 ms
```

```sql title="After: a composite index that matches the filter"
CREATE INDEX CONCURRENTLY seats_event_section_status_idx
    ON seats (event_id, section, status) INCLUDE (seat_id, price_cents);

-- Index Only Scan using seats_event_section_status_idx on seats
--                    (cost=0.43..18.10 rows=310 width=12)
--                    (actual time=0.025..0.391 rows=287 loops=1)
--   Index Cond: ((event_id = 42) AND (section = 'B') AND (status = 'AVAILABLE'))
-- Execution Time: 0.430 ms
```

Reading guide: **Seq Scan** with a large "Rows Removed by Filter" means a missing index; **Index Scan** walks the index and fetches rows from the table; **Index Only Scan** answers from the index alone; `cost` is the planner's estimate in arbitrary units, `actual time` is what happened. `CONCURRENTLY` builds the index without blocking writes — essential on a live table. [Hands-on 6](../../../hands-on/6/index.md) does the same diagnosis on the catalog (box below).

!!! example "In the BoxOffice code: the index that fixes the listing (lab 6)"

    In [Hands-on 6 — Indexes](../../../hands-on/6/indexes/index.md), `EXPLAIN ANALYZE` of "upcoming events in Recife, soonest first" shows a `Seq Scan` that reads and sorts 200,000 events to return 20 (~37 ms). With `(starts_at, id)`, PostgreSQL walks the events already in date order and stops after 20 from Recife: 189 index entries instead of 200,000 rows, and under 1 ms. The count goes through the smaller `(venue_id, starts_at)` index without touching the table (*Index Only Scan*): ~14 ms → ~4 ms. Note the shortcut: the migration uses a plain `CREATE INDEX`, which blocks writes on `events` while it builds — fine on a lab database, not on a live one, where you use `CONCURRENTLY` (it cannot run inside a transaction, so the migration must be told to run without one).

    ``` { .sql title="services/catalog/src/main/resources/db/migration/V3__index_events.sql" }
    --8<-- "docs/2027.1/hands-on/6/code/services/catalog/src/main/resources/db/migration/V3__index_events.sql"
    ```

!!! example "BoxOffice: the index budget of the `seats` table"

    The on-sale workload is write-heavy on `seats` (thousands of holds per second on one event), so every extra index costs throughput exactly when it hurts most. The team keeps three:

    1. the primary key `(event_id, seat_id)` — every hold is a point update by it;
    2. `(event_id, section, status) INCLUDE (seat_id, price_cents)` — the "available seats in this section" query;
    3. a partial index on `(hold_expires_at) WHERE status = 'HELD'` — the job that releases expired holds scans only the few thousand held rows.

    An index on `held_by` was proposed for "my current holds" and rejected: that query is rare and can be served from the `order` service instead.

---

!!! tip "In the interview"

    - Do not say "NoSQL because it scales". Say which **access pattern** forces you out of a relational database, and name the model that fits it: "gate scans are time-ordered appends at high rate, queried by `(event, gate)` — a wide-column table partitioned by that pair".
    - When you add a NoSQL store, **list its queries first** and derive the partition and sort keys from them.
    - Mention indexes with their cost: "a composite index on `(event_id, section, status)`; I keep the index count low on `seats` because it is write-hot".
    - If asked about storage engines: B-tree = read-optimized, in-place; LSM = write-optimized, append + compaction, Bloom filters for reads.

!!! success "Best practices"

    - **Put the rules in the schema, not only in the code** — `NOT NULL`, `CHECK`, `UNIQUE` and foreign keys inside a service catch the bug that the code review missed. In BoxOffice: `CHECK (status IN (...))` and `UNIQUE (event_id, section, seat_row, seat_number)` in `V1__create_inventory.sql` ([lab 6](../../../hands-on/6/holds/index.md)).
    - **Use exact types for money and time** — `NUMERIC(10,2)` for prices and `TIMESTAMPTZ` for instants; never floating point for money, never a time without its zone. In BoxOffice: the decisions table of [lab 1](../../../hands-on/1/api/index.md).
    - **Read plans on production-sized data** — `EXPLAIN (ANALYZE, BUFFERS)` on 100 rows says nothing about 200,000; seed realistic volumes before you judge a query. In BoxOffice: lab 6 indexes the 200,000 seeded events (box above).
    - **Give every index a query that justifies it, and review usage** — check `pg_stat_user_indexes.idx_scan` periodically and drop the indexes nobody scans; on a write-hot table each one costs every insert.
    - **Refresh statistics after bulk loads** — run `ANALYZE` after a seed or a large import; the planner chooses by estimates, and estimated rows far from actual rows are the sign of stale statistics.

!!! warning "Common pitfalls"

    - **An index per column** "just in case": slower writes, more memory, and the planner still cannot combine them as well as one good composite index.
    - **Wrong column order** in a composite index (`(status, event_id)` when every query filters by `event_id`): the leftmost-prefix rule makes it useless for most queries.
    - **Functions on indexed columns** (`WHERE lower(email) = …`) bypass a plain index; create an expression index instead.
    - **Documents that grow forever** (an event document with every ticket embedded): reads and writes get slower as the array grows, and many databases cap document size (16 MB in MongoDB).
    - **Modeling NoSQL like SQL** (normalized tables, joins in the application): you pay the network round trips and lose both models' strengths.

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    REL["relational model<br/>tables, joins, constraints"] --> GUIDE["SQL or NoSQL?<br/>access pattern first"]
    DOC["document"] --> GUIDE
    KV["key-value"] --> GUIDE
    WC["wide-column"] --> GUIDE
    GR["graph"] --> GUIDE
    IDX["indexes: composite order,<br/>EXPLAIN"] --> BT["B-tree<br/>read-optimized, in place"]
    BT -.-> REL
    LSM["LSM-tree<br/>write-optimized, compaction"] -.-> WC
    GUIDE --> TX["invariants<br/>→ Transactions"]
    GUIDE --> PART["known keys at scale<br/>→ Partitioning"]
    KV --> CACHE["in memory<br/>→ Caching, Redis"]
```

**Palette components:** [`sql`](../../../reference/components/storage/index.md#sql) (the default for data with invariants and ad hoc queries) · [`nosql`](../../../reference/components/storage/index.md#nosql) (key-value, document, wide-column or graph — chosen by access pattern, keys derived from the queries) · [`cache`](../../../reference/components/storage/index.md#cache) (a key-value store in memory) · [`vectordb`](../../../reference/components/storage/index.md#vectordb) (an ANN index is one more index type). **Scenarios:** `monolith`, `sharding`. **Continues in:** [Transactions](../transactions/index.md), [Partitioning](../partitioning/index.md), [Caching — Redis](../../caching/redis/index.md), [Estimation — numbers](../../estimation/numbers/index.md), [Hands-on 6](../../../hands-on/6/index.md) (indexes and `EXPLAIN`).

---

[^1]: CODD, E. F. A Relational Model of Data for Large Shared Data Banks. *Communications of the ACM*, 13(6), 1970.
[^2]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*. 2nd ed. O'Reilly. Chapter "Storage and Retrieval".
[^3]: BAYER, R.; McCREIGHT, E. Organization and Maintenance of Large Ordered Indexes. *Acta Informatica*, 1(3), 1972.
[^4]: O'NEIL, P. et al. The Log-Structured Merge-Tree (LSM-Tree). *Acta Informatica*, 33(4), 1996.
