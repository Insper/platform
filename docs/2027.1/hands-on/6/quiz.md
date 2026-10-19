Click **"Answer"** to reveal the correct answer and explanation.

---

**Q1.** Under PostgreSQL's default isolation (READ COMMITTED), why does the **naive** strategy (SELECT, check in Java, UPDATE) double-book seats?

- A. READ COMMITTED does not use transactions
- B. Two transactions can both read the seats as AVAILABLE before either writes; the second UPDATE then waits for the first and overwrites it — a lost update
- C. The UPDATE statement is not atomic
- D. JdbcClient does not support transactions

??? success "Answer"
    **B — Check-then-act race.**

    Each statement sees committed data, but nothing links the decision made on the SELECT to the state at the time of the UPDATE. The fix must make the check and the write one atomic step: a lock, a version check, or a conditional UPDATE.

---

**Q2.** What does `SELECT … FOR UPDATE` do in the pessimistic strategy?

- A. Reads the rows faster
- B. Locks the selected rows until the transaction ends; another transaction trying to lock them waits, then sees the committed (HELD) state and gets a 409
- C. Prevents anyone from reading the rows
- D. Updates the rows automatically

??? success "Answer"
    **B — Row locks, held until commit.**

    Plain reads (without `FOR UPDATE`) are not blocked thanks to MVCC; only other lockers and writers wait. That waiting is the cost of pessimism, visible in the p99 of the hold requests.

---

**Q3.** Why do we lock seats `ORDER BY id`?

- A. To return them sorted to the client
- B. To avoid deadlocks: if two holds lock overlapping seats in different orders, each can wait for the other forever
- C. Because PostgreSQL requires an ORDER BY with FOR UPDATE
- D. To make the index scan cheaper

??? success "Answer"
    **B — A global lock order prevents cycles.**

    Fan A locks 7 then 8; fan B locks 8 then 7: a cycle. PostgreSQL would detect it and abort one transaction after `deadlock_timeout`, but ordering acquisition removes the cycle altogether.

---

**Q4.** When is **optimistic** locking (version column) a better choice than pessimistic?

- A. When contention is high, as in the first rows of a flash sale
- B. When contention is low: most transactions touch different rows, so they never wait and rarely conflict
- C. Never: it allows double bookings
- D. Only with SERIALIZABLE isolation

??? success "Answer"
    **B — Low contention.**

    Optimistic locking is correct (it never double-books) but under high contention most attempts fail and must be retried or rejected. Pessimistic locking serializes contended work more gracefully.

---

**Q5.** Which request should **not** be served by the read replica?

- A. The seat map of section S07 for a fan browsing
- B. Availability per section on the event page
- C. `GET /inventory/holds/{id}` right after the fan created that hold
- D. A nightly report of sold seats

??? success "Answer"
    **C — Read-your-writes.**

    Replication is asynchronous; the replica may not have the hold yet, and the fan would see a 404 for something they just created. Reads of one's own recent writes go to the primary.

---

**Q6.** With `REPLICA_DELAY=1s`, most fans do not see their own seat as HELD on the seat map. Which consistency guarantee is violated?

- A. Linearizability of the primary
- B. Read-your-writes (a session guarantee)
- C. Durability
- D. Atomicity

??? success "Answer"
    **B — Read-your-writes.**

    The system is still *eventually* consistent: after the lag, the replica catches up. Fixes: read from the primary after a write, sticky routing for a short time, or wait for the replica to reach the write's log position.

---

**Q7.** What can read replicas **not** help with?

- A. Seat-map traffic during the sale
- B. Reporting queries that would compete with the sale
- C. The rate of holds (writes) that the primary must process
- D. Availability of reads if the primary is busy

??? success "Answer"
    **C — Writes.**

    Every write goes to the primary and is then replayed on every replica. Scaling writes needs less work per write, batching, queues in front (lab 7), or partitioning the data across primaries (sharding).

---

**Q8.** Why does Flyway connect to `db` directly while the application goes through PgBouncer?

- A. PgBouncer cannot run SQL
- B. In transaction pooling, session state (such as the session-level advisory lock Flyway uses) does not survive between transactions, because each transaction may get a different server connection
- C. Flyway is slower through PgBouncer
- D. PgBouncer blocks DDL

??? success "Answer"
    **B — Transaction pooling breaks session state.**

    `SET`, session advisory locks, `LISTEN/NOTIFY` and temporary tables assume one server connection per session. Use session pooling or a direct connection for code that needs them.

---

**Q9.** What does PgBouncer change when `inventory` scales from 1 to 10 replicas with 20 connections each?

- A. Nothing: PostgreSQL still receives 200 connections
- B. PostgreSQL receives at most `default_pool_size` server connections; the 200 client connections are multiplexed, and excess clients queue in PgBouncer instead of failing with "too many clients"
- C. It makes every query faster
- D. It caches query results

??? success "Answer"
    **B — Many cheap client connections, few expensive server ones.**

    Each PostgreSQL connection is a process with its own memory; thousands of them degrade the database. A pooler bounds them, which matters most with autoscaling (lab 10).

---

**Q10.** Before the index, the plan for the listing showed `Seq Scan on events` + `Sort`. After `CREATE INDEX … (starts_at, id)`, what changes?

- A. Nothing, PostgreSQL ignores indexes on timestamps
- B. PostgreSQL can walk events already ordered by `starts_at` through the index and stop after 20 matching rows, avoiding reading and sorting 200,000 rows
- C. The count query becomes free
- D. Writes become faster

??? success "Answer"
    **B — The index provides both filtering and order.**

    `LIMIT` + an index in the right order is one of the most effective optimizations there is. The count still visits all matching rows, and every insert/update now also maintains the indexes — indexes are a write-side cost.

---

**Q11.** For the flash sale's seat inventory, which design statement is the strongest in an interview?

- A. "Put seats in Redis with a TTL; it is faster"
- B. "Seats need strong consistency: a relational database with row locks or conditional updates and a hold TTL; everything around it (catalog, seat maps, search) can be cached and eventually consistent, and a waiting room limits how many fans reach the inventory at once"
- C. "Use eventual consistency everywhere and refund double bookings"
- D. "Shard the seats table by seat number"

??? success "Answer"
    **B — Strong where it matters, cheap elsewhere.**

    It names the invariant, the mechanism that enforces it, the expiry of holds, what can relax, and how to protect the hot rows from overload — the core of the ticketing case study.
