Click **"Answer"** to reveal the correct answer and explanation.

---

## Models and storage engines

**Q1.** BoxOffice must guarantee that a seat is never sold twice, and analysts keep inventing new questions about orders. Which storage choice fits the **orders and seat inventory** best?

- A. A wide-column store, because it scales writes horizontally
- B. A document database, embedding every ticket inside the event document
- C. A relational database, because the invariant spans rows and needs transactions and constraints, and ad hoc queries need SQL
- D. A key-value store with a TTL on each seat

??? success "Answer"
    **C — A relational database.**

    The deciding factors are the **invariant** ("one seat, one ticket" — enforceable with a transaction and a unique constraint) and **query flexibility** (ad hoc questions need joins and indexes). Wide-column and key-value stores scale well but are designed around queries known in advance and offer limited transactions; embedding every ticket in the event document makes the document grow without bound and every purchase contend on one document.

---

**Q2.** Why does a B-tree index on a table with **one billion rows** usually answer a point lookup with only one or two disk reads?

- A. Because B-trees keep the entire table in memory
- B. Because with a fan-out of a few hundred keys per page the tree is only about 4 levels deep, and the upper levels stay cached in memory
- C. Because B-trees hash the key directly to the page on disk
- D. Because PostgreSQL compresses the index to fit in one page

??? success "Answer"
    **B — Shallow tree, cached top levels.**

    With 8 KiB pages and ~16 bytes per key + pointer, each page points to ~500 children: 500³ = 125 million, 500⁴ = 62.5 billion. A billion rows fit in 4 levels; the root and internal pages are hot and stay in the buffer pool, so only the leaf (and maybe one internal page) comes from disk.

---

**Q3.** A team is choosing a storage engine for **gate scans**: millions of tiny append-only writes per hour, read back by `(event, gate)` and time. Which statement is correct?

- A. A B-tree is better because in-place updates avoid compaction
- B. An LSM-tree fits well: writes are sequential appends to a memtable and SSTables, and Bloom filters keep point reads cheap; compaction is the price
- C. Neither: append-only data must go to object storage
- D. An LSM-tree, because it never needs to read more than one file per query

??? success "Answer"
    **B — LSM-tree.**

    LSM-trees turn random small writes into sequential appends and batch them, which is why write-heavy stores (Cassandra, ScyllaDB, RocksDB) use them. Reads may consult several levels — Bloom filters skip most SSTables, but D overstates it — and background compaction rewrites data (write amplification) and can cause I/O spikes.

---

**Q4.** An index exists on `seats(event_id, section, status)`. Which query **cannot** use it efficiently?

- A. `WHERE event_id = 42`
- B. `WHERE event_id = 42 AND section = 'B'`
- C. `WHERE section = 'B' AND status = 'AVAILABLE'`
- D. `WHERE event_id = 42 AND section = 'B' AND status = 'AVAILABLE'`

??? success "Answer"
    **C.**

    A composite B-tree is sorted by its first column, then the second, and so on (the **leftmost-prefix rule**). Without `event_id`, the matching entries are scattered across the whole index — like searching a phone book sorted by surname for everyone named "Ana".

---

## Transactions and isolation

**Q5.** Two requests run this on PostgreSQL (read committed) for seat `A-12`: `SELECT status …` → `AVAILABLE`, then `UPDATE seats SET status = 'HELD', held_by = :me WHERE event_id = 42 AND seat_id = 'A-12'`. Both report success. What is the anomaly, and which single change fixes it?

- A. Dirty read; switch to read uncommitted
- B. Phantom read; add an index on `status`
- C. Lost update (check-then-act race); add `AND status = 'AVAILABLE'` to the `UPDATE` and check that exactly 1 row was updated
- D. Deadlock; retry both transactions

??? success "Answer"
    **C — Lost update; make the update conditional.**

    Both transactions decided on a stale read; the row lock only serialized the two `UPDATE`s, and the second overwrote the first. With the condition inside the `UPDATE`, PostgreSQL re-checks the `WHERE` on the latest row version after the first transaction commits: the second update matches 0 rows and the application tells that fan the seat is taken.

---

**Q6.** Under PostgreSQL **repeatable read** (snapshot isolation), a customer with 4 tickets opens two tabs; each counts the customer's tickets (4), checks `4 + 2 ≤ 6`, and holds two *different* seats. Both commit. What happened, and what prevents it?

- A. Nothing wrong: repeatable read prevents every anomaly
- B. Write skew; use serializable isolation (with retries) or lock a shared row such as a per-customer limit row with `SELECT … FOR UPDATE`
- C. Dirty read; use read committed
- D. Lost update; add a `version` column to `seats`

??? success "Answer"
    **B — Write skew.**

    The two transactions wrote different rows, so there was no write–write conflict for snapshot isolation to detect, yet together they broke the invariant "at most 6 tickets". Serializable snapshot isolation detects the read/write dependency and aborts one (SQLSTATE `40001`); alternatively, **materialize the conflict** so both transactions must lock the same row.

---

**Q7.** For the "best available" feature, hundreds of fans per second ask for "any 2 free seats in section B". Which query avoids making them queue behind each other?

- A. `SELECT … WHERE status = 'AVAILABLE' LIMIT 2 FOR UPDATE`
- B. `SELECT … WHERE status = 'AVAILABLE' LIMIT 2 FOR UPDATE SKIP LOCKED`
- C. `SELECT … WHERE status = 'AVAILABLE' LIMIT 2` in serializable isolation
- D. `LOCK TABLE seats IN EXCLUSIVE MODE`

??? success "Answer"
    **B — `FOR UPDATE SKIP LOCKED`.**

    Plain `FOR UPDATE` makes every fan wait for the same first free rows; `SKIP LOCKED` hands each transaction rows nobody else is holding, so they proceed in parallel. Serializable would cause aborts and retries under this contention, and a table lock serializes everything.

---

**Q8.** Each hold transaction decrements a single `events.seats_left` counter and holds that row lock for about **5 ms**. Ignoring everything else, what is the maximum hold rate for the whole event?

- A. About 20 holds/s
- B. About 200 holds/s
- C. About 2,000 holds/s
- D. Unlimited, because PostgreSQL uses MVCC

??? success "Answer"
    **B — About 200 holds/s.**

    A row lock serves one transaction at a time: 1 / 0.005 s = 200 per second, regardless of hardware. MVCC lets readers proceed without blocking, but two writers to the same row still serialize. The fix is to remove the hot row from the hot path (per-section or sharded counters, computed asynchronously).

---

## Replication

**Q9.** After adding asynchronous read replicas, fans sometimes see an empty *My tickets* page right after paying. Which fix provides **read-your-writes** consistency?

- A. Add more replicas to reduce the load on each one
- B. Route each user to the same replica every time (sticky replica)
- C. For a short period after a user writes, route that user's reads to the primary (or to a replica that has replayed the write's log position)
- D. Increase the cache TTL of the page

??? success "Answer"
    **C.**

    The problem is replication lag: the read reached a replica that had not yet applied the write. Reading from the primary after a write — or waiting until the replica's replayed LSN passes the write's LSN — guarantees the user sees their own write. A sticky replica gives **monotonic reads** (time does not go backwards) but can still be behind; more replicas do not reduce lag.

---

**Q10.** The inventory primary uses **asynchronous** replication and crashes; a replica is promoted automatically. What is the specific risk for BoxOffice?

- A. None, because WAL replay guarantees no data loss
- B. Holds acknowledged by the old primary but not yet shipped are lost, so the new primary may sell those seats again
- C. The replica refuses to be promoted while the old primary is down
- D. Reads become slower because the new primary has a cold cache, but data is safe

??? success "Answer"
    **B — Lost acknowledged writes.**

    With asynchronous replication, "committed" means "on the leader's disk". Writes in flight to the replicas disappear on failover. For data where a lost write means a double booking or lost money, use a **synchronous standby** (or quorum commit) and accept one extra round trip per commit. (D is a real but secondary effect.)

---

**Q11.** A leaderless store has **N = 3** replicas per key. Which configuration guarantees that a read overlaps the latest acknowledged write while tolerating **one** replica being down for both reads and writes?

- A. W = 1, R = 1
- B. W = 2, R = 2
- C. W = 3, R = 1
- D. W = 1, R = 3

??? success "Answer"
    **B — W = 2, R = 2.**

    R + W = 4 > N = 3, so read and write sets always share at least one replica, and both operations still succeed with one node down. A gives no overlap; C blocks writes and D blocks reads when any single node is down.

---

## Partitioning and specialized stores

**Q12.** A distributed cache with 9 nodes uses `node = hash(key) mod N`. One node is added. Roughly what fraction of keys now maps to a different node, and what would consistent hashing give?

- A. About 10% with mod N; about 90% with consistent hashing
- B. About 90% with mod N; about 10% with consistent hashing
- C. About 50% with both
- D. 0% with both, because hashes do not change

??? success "Answer"
    **B — ~90% vs ~10%.**

    A key keeps its node under `mod N` only when `hash mod 9 = hash mod 10`, which happens for about 1 in 10 keys — so ~90% move, effectively flushing the cache onto the database. With consistent hashing, the new node takes over only its arcs of the ring: about 1/N = 1/10 of the keys.

---

**Q13.** The inventory is partitioned by `event_id`. At 10:00 the stadium show's partition is at 100% while the others idle. Which change addresses the **hot partition** without making every hold a cross-partition transaction?

- A. Partition by `hash(seat_id)` instead
- B. Add more nodes to the cluster
- C. Partition by `(event_id, section)`, keep group holds inside one section, and put a waiting room in front to cap the hold rate
- D. Switch the partition to asynchronous replication

??? success "Answer"
    **C.**

    A finer key spreads the big event over ~40 sections while keeping each hold transaction local, and the waiting room limits concurrency to what one partition can serve. Partitioning by seat (A) spreads load but turns "available seats in section B" into scatter/gather and group holds into cross-shard transactions; more nodes (B) do not help when the load targets one key.

---

**Q14.** Marketing wants "tickets sold per minute per city for the last two years" every morning. Where should this query run, and why?

- A. On the order primary, with an index on `created_at`
- B. In a column-oriented data warehouse fed by CDC/ELT, because it scans few columns of very many rows and must not compete with checkout
- C. In the search engine, because it has aggregations
- D. In the vector database, because it is fast

??? success "Answer"
    **B — In the warehouse.**

    This is an OLAP query: few columns, billions of rows, seconds of latency acceptable. A column store reads only the needed columns, compresses them well and scans in parallel. Running it on the OLTP primary competes with checkout for CPU, I/O and locks.

---

**Q15.** The support assistant must find the policy paragraph for "can I get my money back if the show changes date?", which shares almost no words with "Refunds for rescheduled events". Which component and technique fit?

- A. A full-text search index with BM25 and stemming
- B. Embeddings stored in a vector database (for example pgvector with an HNSW index), queried by cosine similarity
- C. A `LIKE '%money back%'` query on the policies table
- D. A key-value store keyed by the question text

??? success "Answer"
    **B — Embeddings + approximate nearest-neighbour search.**

    Lexical search (A, C) matches words, and the two texts share few. Embeddings place texts with similar **meaning** close together; an ANN index such as HNSW finds the nearest ones quickly at the cost of slightly imperfect recall. In practice, hybrid search (BM25 + vectors) and a reranker often work best.
