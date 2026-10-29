BoxOffice started like most products: one service and one PostgreSQL database holding everything — events, venues, seats, orders, users, even the poster images as `bytea` columns. It worked for a year. Then the stadium show went on sale at 10:00. Two million fans opened the event page, the search box was hammered with "taylor", the marketing team ran a "sales per minute" report on the same database, and 60,000 seats had to be sold **exactly once each**. At 10:02 the database CPU was at 100%, the report query held locks for 40 seconds, and two fans received tickets for seat `A-12`.

Nothing was "wrong" with PostgreSQL. The problem was that **different data has different shapes**, and one store was asked to be good at all of them at once. This class is about recognizing those shapes and choosing — and scaling — the right store for each.

!!! quote "The story so far"

    Chapter 6 of the [story of the course](../../index.md#story). [Class 5](../compute/index.md) made every replica stateless, so every hold, order and login now ends in the database, and the gateway of [lab 4](../../hands-on/4/index.md) can put as many replicas in front of it as we like. More replicas multiply the callers, not the database: at 10:00 about 33,000 holds/s arrive against the ~1,100 that one PostgreSQL serves ([class 2](../estimation/index.md)), and two fans click the same seat in the same millisecond. **This class** answers: which store for which data, how does the store guarantee "one seat, one hold", and how does it grow when one machine is not enough?

!!! abstract "Learning objectives"

    By the end of this class you should be able to:

    - **Classify** the data of a system by access pattern, volume, consistency need and query flexibility, and **map** each kind to a storage component (SQL, NoSQL, search, object store, data warehouse, vector database).
    - **Compare** relational, key-value, document, wide-column and graph models, and **justify** a SQL-vs-NoSQL choice with a decision guide instead of a slogan.
    - **Explain** how B-tree and LSM-tree storage engines and indexes work, and **predict** their effect on read and write cost.
    - **Diagnose** isolation anomalies (lost update, write skew, phantoms) and **fix** a double-booking bug with `SELECT … FOR UPDATE`, conditional updates, optimistic locking or constraints.
    - **Design** replication (leader-follower, multi-leader, leaderless) and partitioning (range, hash, consistent hashing) for a workload, and **anticipate** replication lag, hot partitions and resharding.
    - **Decide** when a search engine, object storage, a data warehouse or a vector database belongs in the architecture, and how data flows into it (CDC, ETL/ELT, embeddings).

## Roadmap

1. **This overview** — the data map of BoxOffice, the questions that choose a store, polyglot persistence, and the database scaling ladder.
2. [Data Models & Storage Engines](models/index.md) — relational, key-value, document, wide-column, graph; the SQL-vs-NoSQL decision guide; B-trees vs LSM-trees; indexes and `EXPLAIN`.
3. [Transactions & Isolation](transactions/index.md) — ACID, isolation levels and their anomalies, the double-booking bug and four ways to fix it, seat holds.
4. [Replication](replication/index.md) — leader-follower, synchronous vs asynchronous, replication lag, failover, multi-leader and leaderless quorums.
5. [Partitioning & NewSQL](partitioning/index.md) — range, hash and consistent hashing, hot partitions, secondary indexes, resharding, Spanner and CockroachDB.
6. [Specialized Stores](specialized/index.md) — search engines, object storage, data warehouses and lakehouses, vector databases.
7. [Quiz](quiz.md) — check your understanding.

## Slides

<div class="slides-embed">
  <iframe src="slides/databases.html" title="Slides: databases and data systems" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/databases.html){:target="_blank"}

---

## Data has a shape

Before picking a database, describe the data. Four properties decide almost everything:

| Property | Question to ask | Why it matters |
|---|---|---|
| **Access pattern** | How is it read and written? By key? By range? Full-text? Aggregations over millions of rows? | Each store is fast for a few patterns and slow for the rest. |
| **Read/write ratio and volume** | How many reads and writes per second, at peak? How many bytes, growing how fast? | Decides whether one node is enough, and whether to scale reads (replicas, cache) or writes (partitioning). |
| **Consistency need** | What breaks if a reader sees data that is a few seconds old? If two writers race? | Money and inventory need strong guarantees; a "views" counter does not. |
| **Query flexibility** | Are the queries known in advance, or will analysts invent new ones every week? | Fixed queries allow denormalized NoSQL tables; ad hoc queries need SQL and indexes. |

Applying them to BoxOffice gives a **data map**. The volumes below are illustrative assumptions for a mid-size ticketing company — the point is the order of magnitude and the contrast between rows, not the exact values.

| Data | Example | Volume (assumed) | Access pattern | Consistency need | Palette component |
|---|---|---|---|---|---|
| Seat inventory and holds | seat `A-12` of event 42 is `HELD` by Alice until 10:07 | 60 k rows per stadium event; bursts of thousands of writes/s at on-sale | point read/update by `(event_id, seat_id)`; "best available" range scan | **strong** — never sell a seat twice | [`sql`](../../reference/components/storage/index.md#sql) |
| Orders and payments | order 9001: 2 tickets, R$ 980, `PAID` | ~100 k orders/day (≈ 36 M/year) × ~1 KB ≈ 37 GB/year | by id, by customer; joins with tickets | **strong** — money | `sql` |
| Event catalog | name, venue, date, lineup, prices | ~20 k events/year, a few KB each | read-heavy (≫ 100 reads per write), by id and by listing | stale by seconds is fine | `sql` + [`cache`](../../reference/components/storage/index.md#cache) |
| Search | "taylor são paulo december" | same events, as an inverted index | full-text, typo-tolerant, ranked, autocomplete | eventual (seconds) | [`search`](../../reference/components/compute/index.md#search) |
| Event posters and tickets as PDF | `posters/42/hero.webp`, 2 MB | posters: ~20 k events × ~5 images ≈ 100 GB/year; ticket PDFs: ~7 TB/year (or render on demand) | whole object by key, served through a CDN | write once, read many | [`objstore`](../../reference/components/storage/index.md#objstore) |
| Clickstream and sales analytics | `page_view`, `add_to_cart`, `purchase` events | ~100 M events/day × ~200 B ≈ 20 GB/day | aggregations over months ("sales per minute per city") | minutes of delay is fine | [`dwh`](../../reference/components/storage/index.md#dwh) |
| Sessions, rate-limit counters, waiting-room position | `session:abc → user 7` | millions of small keys | key lookup, sub-millisecond, with TTL | losing some is tolerable | `cache` / [`nosql`](../../reference/components/storage/index.md#nosql) |
| Assistant knowledge | FAQ chunks, refund policy, event descriptions as embeddings | ~100 k vectors × 1,024 dims × 4 B ≈ 400 MB | nearest-neighbour by meaning | eventual | [`vectordb`](../../reference/components/storage/index.md#vectordb) |

Notice that the rows differ by **orders of magnitude** in every column. A store tuned for the first row (small, hot, transactional) is a poor fit for the sixth (huge, append-only, scanned in bulk), and vice versa.

``` diagram-sim
flowchart LR
    gw["gateway"] --> inv["inventory"]
    gw --> ord["order"]
    gw --> cat["catalog"]
    gw --> srch["search"]
    gw --> ast["assistant"]
    inv --> sqlI[("SQL<br/>seats, holds")]
    ord --> sqlO[("SQL<br/>orders, payments")]
    cat --> cache[("Cache")]
    cache -->|miss| sqlC[("SQL<br/>events, venues")]
    sqlC -->|"CDC"| idx[("Search index")]
    srch --> idx
    cat -->|"poster URLs"| obj[("Object store")]
    sqlO -->|"CDC / ELT"| dwh[("Data warehouse")]
    ast --> vec[("Vector DB")]
```

This is **polyglot persistence**: each service keeps its data in the store that fits its access pattern, and data flows between stores through change streams rather than shared tables.

??? question "Think first: is the search index a second source of truth?"

    No. The catalog SQL database is the **system of record**; the search index, the cache, the warehouse and the vector database are **derived data** — they can be rebuilt from the system of record. That distinction tells you where writes go (only to the system of record), what to back up carefully, and what you may throw away and rebuild after a bug. Kleppmann calls this split "systems of record vs derived data"[^1].

---

## Five questions that choose a store { #five-questions }

When a requirement arrives — in a design review or in an interview — walk through these questions in order. Most of the time the answer is "a relational database", and you only leave it with a reason.

1. **What is the system of record, and what are its invariants?** Seats must never be sold twice; an order total must equal the sum of its items. Invariants that span several rows want **transactions** — a relational database is the default.
2. **What are the top 3 queries, and are they known in advance?** Known key lookups at huge scale fit a key-value or wide-column store; unknown, ad hoc queries fit SQL.
3. **How big, how fast, growing how?** Estimate peak QPS and bytes (see [Estimation](../estimation/numbers/index.md)). If one node with replicas can hold it for the next two to three years, you do not need to partition yet.
4. **How stale can a read be?** Seconds of staleness unlock replicas, caches and asynchronous indexes — the cheapest scaling tools there are.
5. **What can the team operate?** A managed PostgreSQL that everybody understands beats an exotic store that one person can debug at 3 a.m.

!!! example "BoxOffice: applying the questions to the seat inventory"

    1. Invariant: one seat, at most one valid hold or ticket → needs atomic check-and-set → **transactions**.
    2. Top queries: hold seat by `(event_id, seat_id)`; list available seats of a section; release expired holds → known, but the second one is a range scan → **SQL with a composite index** fits.
    3. Volume: the whole inventory of a stadium event is 60 k rows — tiny. The challenge is **write bursts** on a single event, not size.
    4. Staleness: the seat *map* shown to fans can be seconds old; the *hold* decision must read the current state.
    5. Team: PostgreSQL is in every hands-on of the course.

    Decision: PostgreSQL for inventory, with row-level locking (see [Transactions](transactions/index.md)) and a cached, slightly stale seat map for display.

---

## The database scaling ladder { #scaling-ladder }

The database is usually the first component to saturate, because it is the one component that is hard to make stateless. The classic mistake is to jump straight to sharding. Climb the ladder one step at a time, and measure before each step[^2]:

| Step | What you do | What it buys | What it costs |
|---|---|---|---|
| 1. Fix the queries | Add the missing index, remove N+1 queries, read `EXPLAIN` | Often 10–100× on the slow query | Almost nothing |
| 2. Pool connections | PgBouncer or the driver pool; cap connections per service | Stops the database from drowning in connections | A config file |
| 3. Scale up | Bigger instance: more RAM (working set in memory), faster SSD | 2–4× with no code change | Money; there is a largest instance |
| 4. Cache reads | Cache-aside for hot, read-mostly data ([Caching](../caching/index.md)) | Removes most read traffic | Staleness and invalidation |
| 5. Read replicas | Route reads to followers ([Replication](replication/index.md)) | Read throughput × replicas | Replication lag; reads may be stale |
| 6. Split by function | One database per service (catalog, inventory, order) | Isolates workloads; smaller databases | No cross-service joins or transactions |
| 7. Partition (shard) | Spread one table across nodes by key ([Partitioning](partitioning/index.md)) | Write throughput and storage × shards | Cross-shard queries, resharding, operations |
| 8. Specialized stores | Search, warehouse, object store, vector DB for derived data | Each query on the engine built for it | More systems and pipelines to run |

Steps 1–5 are cheap and reversible; steps 6–8 change the architecture. In 2026 a single well-tuned relational node with a few replicas comfortably serves a large majority of products; sharding is for the few that outgrow it, and managed distributed SQL (see [NewSQL](partitioning/index.md#newsql)) has made that last step less painful than it used to be.

**Try it.** The scenario below is the one-node starting point: client → app → SQL. Raise the load until the database saturates and watch the p99 latency bend upward (the "knee" from [Queueing](../estimation/queueing/index.md)). Then think about which rung of the ladder you would climb first — and check it in the `db-replicas` scenario on the [Replication](replication/index.md) page.

<div class="sdp" data-scenario="monolith" data-mode="compact" data-height="520"></div>

The full simulator, with every storage component in the palette, is in the [Playground](../../../playground/index.md).

---

## One database per service, or one database for everything?

Two opposite pieces of advice coexist, and both are right in their context.

**Database per service.** In a microservice architecture each service owns its data and nobody else reads its tables ([Compute & Services](../compute/services/index.md)). The catalog can change its schema without breaking inventory; a slow analytics query cannot lock the order tables. The price: no joins and no transactions across services — you need events, sagas and the transactional outbox ([Messaging patterns](../messaging/patterns/index.md)).

**"Just use Postgres".** Modern PostgreSQL covers a surprising range[^3]: JSONB documents with GIN indexes, full-text search (`tsvector`), geospatial (PostGIS), time series (partitioned tables, TimescaleDB), queues (`SELECT … FOR UPDATE SKIP LOCKED`), and vector search (`pgvector`). Fewer systems means fewer things to operate, back up, secure and learn.

| | One engine for many needs | Specialized store per need |
|---|---|---|
| Operations | one thing to run, monitor and back up | one more system per need |
| Consistency | can update everything in one transaction | derived stores lag behind (CDC, ETL) |
| Peak performance | good enough up to medium scale | best for that access pattern at large scale |
| Features | basic full-text, basic vector search | relevance tuning, facets, billions of vectors, columnar scans |
| Team skills | one skill set | several |

The pragmatic path for BoxOffice: start with PostgreSQL per service (owned schemas, separate databases or at least separate users), and **add a specialized store when a measured need appears** — the search relevance team needs facets and typo tolerance, analysts need to scan two years of clicks, the assistant needs tens of millions of vectors.

## The databases concept map { #concept-map }

Each storage component is built for one family of access patterns; the system of record feeds the derived stores through change streams. The map links each **palette component** (green) to the **concepts** it relies on (blue):

``` diagram
flowchart LR
    cache["cache"]:::comp -->|"miss"| sql["sql"]:::comp
    sql -.- c1["transactions, isolation, indexes,<br/>replication, failover"]:::tech
    nosql["nosql"]:::comp -.- c2["key-value, document, wide-column,<br/>LSM-trees, partition keys"]:::tech
    nosql -.- c3["consistent hashing, hot partitions,<br/>quorums, NewSQL"]:::tech
    sql -->|"CDC"| search["search"]:::comp
    search -.- c4["inverted index,<br/>ranking"]:::tech
    sql -->|"CDC, ELT"| dwh["dwh"]:::comp
    dwh -.- c5["OLAP, columns,<br/>star schema"]:::tech
    objstore["objstore"]:::comp -.- c6["objects by key,<br/>presigned URLs, CDN"]:::tech
    vectordb["vectordb"]:::comp -.- c7["embeddings,<br/>ANN, HNSW"]:::tech
    sql -->|"keys only"| objstore
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

| Palette component | Question it answers | Concepts | Taught in | Scenarios |
|---|---|---|---|---|
| [`sql`](../../reference/components/storage/index.md#sql) | Where does data with invariants live? | ACID, isolation levels, conditional `UPDATE`, `SELECT … FOR UPDATE`, indexes, `EXPLAIN` | [Data Models](models/index.md#relational), [Transactions](transactions/index.md) | `monolith`, `flash-sale` |
| [`sql`](../../reference/components/storage/index.md#sql) (replicas) | How do we scale reads and survive a dead leader? | leader–follower, sync vs async, replication lag, read-your-writes, pooling, failover | [Replication](replication/index.md) | `db-replicas` |
| [`nosql`](../../reference/components/storage/index.md#nosql) | Which access pattern forces us out of a relational database? | key-value, document, wide-column, graph, LSM-trees, partition and sort keys | [Data Models — decision guide](models/index.md#decision-guide) | `sharding` |
| [`nosql`](../../reference/components/storage/index.md#nosql) (partitioned) | How do writes and storage grow past one node? | range vs hash, consistent hashing, hot partitions, resharding, leaderless quorums, NewSQL | [Partitioning](partitioning/index.md), [Replication — leaderless](replication/index.md#leaderless) | `sharding` |
| [`search`](../../reference/components/compute/index.md#search) | How do fans find "rock in São Paulo"? | inverted index, ranking, kept in sync by CDC, derived data | [Specialized — search engines](specialized/index.md#search-engines) | `search-autocomplete` |
| [`objstore`](../../reference/components/storage/index.md#objstore) | Where do posters and ticket PDFs live? | objects by key, presigned URLs, a CDN in front | [Specialized — object storage](specialized/index.md#object-storage) | `cdn-static`, `video-streaming` |
| [`dwh`](../../reference/components/storage/index.md#dwh) | Where do the analysts' queries run? | OLTP vs OLAP, columnar storage, star schema, ETL/ELT, lakehouse | [Specialized — warehouses](specialized/index.md#data-warehouses) | `event-fanout` |
| [`vectordb`](../../reference/components/storage/index.md#vectordb) | How does the assistant find text by meaning? | embeddings, exact vs approximate search, HNSW, pgvector first | [Specialized — vector databases](specialized/index.md#vector-databases) | `ai-assistant` |
| [`cache`](../../reference/components/storage/index.md#cache) · [`stream`](../../reference/components/messaging/index.md#stream) | How do reads skip the database, and derived stores stay in sync? | the scaling ladder, cache-aside, CDC, outbox | [this overview](#scaling-ladder), [Caching](../caching/index.md) | `read-heavy-cache` |

!!! tip "In the interview"

    Interviewers listen for *why* you chose a store, not for brand names. A strong pattern is: "**Seats and orders go to a relational database** because the invariant 'one seat, one ticket' needs transactions; the catalog is read-heavy, so a **cache** in front of it; search goes to an **inverted index** fed by CDC; posters in **object storage** behind the CDN; analytics in a **warehouse**, never on the OLTP database." Then estimate: "60 k seats per event is tiny — the problem is write contention, not size", which shows you know *which* dimension is hard.

!!! success "Best practices"

    - **Name the system of record of every entity in the design doc** — and mark every other copy as derived, with the way it is rebuilt (replay, re-index, re-embed).
    - **Turn on query statistics from day one** — `pg_stat_statements` and a slow-query log: the first rung of the ladder (queries and indexes) needs data, and the top 10 statements by total time usually explain most of the load.
    - **Change schemas only through versioned, backward-compatible migrations** — expand, migrate, contract: add the column, deploy code that writes both, backfill, then drop the old one; every step can be rolled back. In BoxOffice: Flyway in every service and `ddl-auto: validate` ([lab 1](../../hands-on/1/index.md)).
    - **Test restores, not only backups** — restore into a scratch instance on a schedule and time it: that time is your real recovery time, and the restore is the only proof that the backup works.
    - **Keep a written connection budget for each database** — `max_connections` against the sum of every pool of every replica. In BoxOffice: PgBouncer keeps `inventory` at 20 server connections ([lab 6](../../hands-on/6/replicas/index.md)).

!!! warning "Common pitfalls"

    - **Sharding first.** Partitioning a 50 GB database adds months of complexity to solve a problem an index and a replica would have solved.
    - **Analytics on the OLTP database.** A report that scans millions of rows competes with checkout for CPU, I/O and locks. Move it to a replica at least, to a warehouse at best.
    - **Blobs in the database.** Images and PDFs bloat backups and the buffer pool; store them in object storage and keep only the key.
    - **Choosing NoSQL "for scale" without knowing the queries.** NoSQL tables are designed around access patterns; if you do not know them yet, you will design the wrong table.
    - **Treating derived data as the source of truth.** If the search index or cache is the only place where a value lives, a rebuild loses data.

---

## Connections

- [Data Models & Storage Engines](models/index.md) continues this page with the SQL-vs-NoSQL decision guide.
- [Distributed Systems](../distributed/index.md) — replication and partitioning rely on its consistency models, quorums and consensus.
- [Caching](../caching/index.md) — step 4 of the ladder, and the next class.
- [Messaging & Event-Driven](../messaging/index.md) — CDC and the transactional outbox keep derived stores in sync.
- [AI Systems](../ai-systems/rag-memory/index.md) — the vector database inside a RAG pipeline.

**Related:** [Hands-on 6 — Data at scale](../../hands-on/6/index.md) (seat holds, read replica, PgBouncer, `EXPLAIN`) · [Hands-on 1 — First service](../../hands-on/1/index.md) (catalog on PostgreSQL + Flyway) · [Exercise: cache + database](../../exercises/cache-db/index.md) · [Case study: BoxOffice ticketing](../case-studies/ticketing/index.md) · [Case study: URL shortener](../case-studies/url-shortener/index.md) · [Interview prep](../../support/interview/index.md) · Component catalog: [Storage](../../reference/components/storage/index.md).

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - Describe data by **access pattern, volume, consistency need and query flexibility** before choosing a store.
    - Separate the **system of record** from **derived data** (cache, search index, warehouse, vectors) that can be rebuilt.
    - The relational database is the default for data with **invariants**; leave it for a measured reason.
    - Climb the **scaling ladder** in order: queries and indexes → pooling → scale up → cache → replicas → split by function → shard → specialized stores.
    - Polyglot persistence buys performance per access pattern at the price of operations and pipelines.

## What breaks next { #what-breaks-next }

The seat is now safe: a row lock or a conditional update decides, and lab 6 shows that only the naive version sells a seat twice. But the event pages are read about 100 times more than they change, and every one of those reads still reaches PostgreSQL or a read replica: two million fans refreshing at 09:59 ask the same question millions of times. A replica copies the whole database, lag included, to answer reads that could come from memory. Keeping a copy of the answer, and knowing what must never be answered from a copy, is [class 7 — Caching](../caching/index.md), the next rung of the [scaling ladder](#scaling-ladder).

---

[^1]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*. 2nd ed. O'Reilly. Chapter on derived data; the 1st edition (2017) calls it "Systems of Record and Derived Data" (Part III).
[^2]: XU, A. *System Design Interview – An Insider's Guide*. Vol. 1. Byte Code LLC, 2020. Chapter 1, "Scale from zero to millions of users".
[^3]: PostgreSQL Global Development Group. [PostgreSQL Documentation](https://www.postgresql.org/docs/current/){target="_blank"}.
