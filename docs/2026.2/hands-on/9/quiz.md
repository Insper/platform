Click **"Answer"** to reveal the correct answer and explanation.

---

## Database Cluster / PostgreSQL Replication

**Q1.** A team adds two read replicas to its PostgreSQL primary. Which problem does this **not** solve?

- A. The primary being a single copy of the data
- B. Too many `SELECT`s for one server
- C. Too many `INSERT`s and `UPDATE`s for one server
- D. Having a server ready to take over when the primary fails

??? success "Answer"
    **C — Replication does not scale writes.**

    Every node holds all the data and every write must still be applied on the single primary (and then replayed on each replica). Replicas spread reads and give availability and a second copy; scaling writes needs sharding (splitting the data across independent primaries).

---

**Q2.** What does the primary send to its replicas in **physical streaming replication**?

- A. The SQL statements it executed, to be re-executed on each replica
- B. The WAL (write-ahead log) records: changes to data pages, replayed byte by byte
- C. A full copy of the data directory every few seconds
- D. Row changes of the tables listed in a publication

??? success "Answer"
    **B — The WAL.**

    Before changing a page, PostgreSQL writes the change to the WAL; the replicas receive and replay those records and end up with identical pages. That is why a physical replica is read-only and must run the same major version. Row changes per table (D) are **logical** replication; the full copy (C) happens only once, with `pg_basebackup`, to create the replica.

---

**Q3.** In the lab, `pg_wal_replay_pause()` on `pg-replica1` followed by an `INSERT` on the primary made `pg-replica1` return the old row count. In production, without pausing anything, what does the same effect look like?

- A. An error `cannot execute INSERT in a read-only transaction`
- B. A user creates an order and, right after, does not see it in the list read from a replica
- C. The primary blocks the commit until every replica has replayed it
- D. The replica rejects queries until it catches up

??? success "Answer"
    **B — A stale read (read-your-writes violation).**

    Asynchronous replicas are always slightly behind; under load, long queries or a slow network, the lag grows. Reading right after writing may hit a replica that has not replayed the write yet. Fixes: read from the primary after a write, or `synchronous_commit = remote_apply` for reads that cannot be stale.

---

**Q4.** With `synchronous_standby_names = 'FIRST 1 ("pg-replica1")'`, `pg-replica1` stops. A client runs an `INSERT`, waits, and presses Ctrl+C. What is the state of the row?

- A. It was rolled back: synchronous replication makes the commit atomic across servers
- B. It is committed on the primary, but may not exist on any replica
- C. It exists only on `pg-replica2`
- D. It is lost on the primary and on the replicas

??? success "Answer"
    **B — Committed locally; only the wait was cancelled.**

    PostgreSQL warns: *"The transaction has already committed locally, but might not have been replicated to the standby."* Synchronous replication delays the answer to the client until a replica confirms; it is not a distributed transaction. And with one named synchronous replica, that replica's failure blocks every write.

---

**Q5.** Why is `ANY 1 ("pg-replica1", "pg-replica2")` usually preferred to `FIRST 1 ("pg-replica1")`?

- A. It makes every commit faster than asynchronous replication
- B. It waits for both replicas, so no data is ever lost
- C. A commit needs a confirmation from either replica, so one replica can fail without blocking writes
- D. It turns both replicas into writable nodes

??? success "Answer"
    **C — Quorum: any one of the two confirms.**

    `FIRST 1` makes the named replica a single point of failure for writes. `ANY 1` (quorum) keeps RPO = 0 while tolerating the loss of one replica. It is still slower than asynchronous commits: every commit waits for one network round trip.

---

**Q6.** After `SELECT pg_promote();` on `pg-replica1`, the connection string `host=pg-primary,pg-replica1,pg-replica2 target_session_attrs=read-write` reaches the new primary with no change. Why?

- A. Docker Compose renames `pg-replica1` to `pg-primary`
- B. The driver tries the hosts in order and keeps the first one that accepts writes; `pg-primary` is down and `pg-replica2` is read-only
- C. `pg_promote()` updates the DNS of the Docker network
- D. The old primary forwards the connection to the new one

??? success "Answer"
    **B — Routing by role in the client.**

    libpq (`target_session_attrs`) and the JDBC driver (`targetServerType`) connect to each host and check whether it accepts writes. The configuration lists *candidates*, not *the* primary. Connections already open to the old primary break and must be reopened — connection pools do this automatically.

---

**Q7.** In the unplanned failover, `lost-write` answered `INSERT 0 1` but disappeared after the promotion. What happened?

- A. `pg_rewind` deleted it from the new primary
- B. It existed only in the WAL of the killed primary: no replica received it before the crash, so the promoted replica never had it
- C. The sequence skipped its id
- D. Synchronous replication rolled it back

??? success "Answer"
    **B — The RPO of asynchronous replication.**

    The commit returned as soon as the WAL was on the primary's disk. The replicas were down, the primary was killed, and the promoted replica started timeline 2 without that record. When the old primary rejoins, `pg_rewind` discards its writes after the fork so it matches the new primary. Synchronous replication would have prevented the loss — by blocking the `INSERT`.

---

**Q8.** Why does automatic failover (Patroni, RDS Multi-AZ) rely on a consensus store such as etcd instead of a script that promotes a replica when the primary stops answering?

- A. etcd replicates the data faster than streaming replication
- B. A primary that only *looks* dead (slow or isolated) would keep accepting writes while a replica is promoted: two primaries, a split brain. Consensus guarantees that only the holder of the leader key acts as primary
- C. PostgreSQL cannot promote a replica without etcd
- D. The script would need superuser access

??? success "Answer"
    **B — To avoid split brain.**

    Detecting failure in a distributed system is unreliable: a timeout cannot tell "dead" from "slow" or "unreachable from here". With a leader key with TTL in a Raft store, an isolated primary cannot renew the key and demotes itself, and only one node can win the election.
