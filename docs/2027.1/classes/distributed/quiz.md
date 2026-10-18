Click **"Answer"** to reveal the correct answer and explanation.

---

## Failures, networks and idempotency

**Q1.** BoxOffice's `inventory` calls `payment` and gets no reply within 2 s. What can `inventory` conclude?

- A. The payment service has crashed and must be restarted
- B. The request was lost, so it is safe to retry without any precaution
- C. Nothing certain: the request may have been lost, the server may have crashed, the reply may have been lost, or the server may just be slow — the charge may or may not have happened
- D. The network is partitioned, so the system must switch to AP mode

??? success "Answer"
    **C — Nothing certain.**

    A lost request, a crashed server, a lost reply and a slow server all look like silence to the caller. A timeout lets the caller *assume* failure and move on, but it does not tell whether the operation was executed. That is why a retry must be made safe — the operation must be idempotent (for example, with an idempotency key the provider deduplicates).

---

**Q2.** Each machine in a fleet fails on a given day with probability 0.1%, independently. Approximately what is the probability that **at least one** of 1,000 machines fails today?

- A. 0.1%
- B. 1%
- C. About 63%
- D. 100%

??? success "Answer"
    **C — About 63%.**

    P(at least one failure) = 1 − (1 − 0.001)^1000 ≈ 1 − e^(−1) ≈ 0.63. With 3,000 machines it is about 95%. At scale, failures are a daily event, so the system must keep working through them instead of trying to avoid them.

---

**Q3.** The `/health` endpoint of the `search` service returns `200 OK`, the load balancer keeps it in rotation, but every real search query times out. Which failure model is this?

- A. Crash-stop
- B. Byzantine failure
- C. Gray failure
- D. Omission failure of the load balancer

??? success "Answer"
    **C — Gray failure.**

    A gray failure is one where the system's own monitoring sees the component as healthy while users experience failures. The fix is a health check that exercises the real dependency path (a readiness check that runs a cheap query) plus client-side signals such as error rates and passive outlier detection at the load balancer.

---

**Q4.** Which of these operations is **idempotent**?

- A. `POST /orders` creating a new order for fan 42
- B. `UPDATE seats SET sold = sold + 1 WHERE event_id = 42`
- C. `UPDATE seats SET status = 'HELD', fan_id = 42 WHERE id = 'A-12' AND status = 'FREE'`
- D. Sending a "your ticket is ready" e-mail

??? success "Answer"
    **C — The conditional write.**

    Running it twice leaves the same state: the second execution matches no row (the seat is no longer `FREE`). `POST` creates a new order each time, the increment adds again, and each e-mail send is a new e-mail — all need an idempotency key or deduplication to be safely retried.

---

**Q5.** An `order` service stores idempotency keys in an in-memory `HashSet` on each replica. Three replicas run behind a load balancer. What goes wrong?

- A. Nothing; the set is fast and correct
- B. A retry may reach a different replica that has never seen the key, so the order is created twice
- C. The keys use too much memory
- D. The load balancer rejects requests that carry an `Idempotency-Key` header

??? success "Answer"
    **B — The retry hits another replica.**

    Deduplication state must be shared (a unique key in the database, written in the same transaction as the order, or a shared store such as Redis). Per-replica memory also loses every key on restart. And the key must be stored atomically with the business change — otherwise a crash between the two writes reopens the duplicate window.

---

## Replication and consistency

**Q6.** A fan pays and is redirected to *My tickets*, which reads from an asynchronous read replica. The list is empty. Which guarantee is violated, and what is the cheapest fix?

- A. Linearizability; make all reads and writes go through consensus
- B. Read-your-writes; read the user's own data from the primary (or pass the write's log position and wait for a replica that has applied it)
- C. Monotonic writes; send writes in order
- D. Eventual consistency; the replica will never receive the write

??? success "Answer"
    **B — Read-your-writes.**

    The fan does not need the whole system to be linearizable — she needs to see *her own* writes. Routing her reads of her own data to the primary (or for a few seconds after a write), or using a version token such as the PostgreSQL WAL LSN, provides read-your-writes at a much lower cost than global strong consistency.

---

**Q7.** Refreshing the event page, a fan sees "95 seats left", then "340 seats left", then "90 seats left", because each refresh hits a different replica. Which session guarantee is missing?

- A. Read-your-writes
- B. Monotonic reads
- C. Monotonic writes
- D. Linearizability of writes

??? success "Answer"
    **B — Monotonic reads.**

    Monotonic reads promise that a session never sees data go back in time. Pinning the session to one replica (hash of the session id) or tracking the last version seen and only accepting replicas at least that fresh fixes it. The counter may still lag — that is fine for this screen — but it must not jump backwards.

---

**Q8.** Which statement about replication modes is correct?

- A. Asynchronous replication with automatic failover never loses acknowledged writes
- B. Fully synchronous replication to every follower makes writes highly available
- C. Semi-synchronous replication (leader + at least one follower acknowledge) avoids losing acknowledged writes on failover if a synchronous follower is promoted, at the cost of one extra round trip
- D. Multi-leader replication eliminates write conflicts

??? success "Answer"
    **C — Semi-synchronous.**

    Asynchronous replication can lose the last acknowledged writes when the leader dies before followers received them. Fully synchronous replication blocks every write if any follower is down or slow. Multi-leader replication accepts writes in several places and therefore creates conflicts. Semi-synchronous (or quorum) replication is the usual compromise for data you cannot lose.

---

## CAP and PACELC

**Q9.** BoxOffice's seat inventory is replicated across two regions, and the link between them drops. A fan in region 2 asks to hold a seat whose latest state lives in region 1. A **CP** configuration will:

- A. Hold the seat in region 2 and reconcile later
- B. Refuse the request (error or timeout) until it can confirm the latest state
- C. Return the seat as free and let the payment provider decide
- D. Automatically become CA until the partition heals

??? success "Answer"
    **B — Refuse until it can confirm.**

    During a partition, a CP system sacrifices availability on the side that cannot reach the latest state (typically the minority) rather than risk an inconsistent answer — here, a double-sold seat. An AP system would answer and reconcile later. "CA" is not an option for replicated data.

---

**Q10.** Why do most designs replicate **synchronously across availability zones** but **asynchronously across regions**?

- A. CAP forbids synchronous replication between regions
- B. Because of PACELC's *else* branch: an extra round trip across zones costs ~1–2 ms, while across continents it costs ~150 ms on every write
- C. Availability zones never partition
- D. Regions use different database engines

??? success "Answer"
    **B — Latency (the "EL/EC" choice).**

    Even with no partition, consistency costs latency: a write must wait for the confirming replicas. A cross-zone round trip is cheap enough to pay on every write; a cross-continent one is not. Across regions, systems choose latency (async replication) or avoid the question by giving each record a home region.

---

## Consensus and quorums

**Q11.** An etcd cluster must keep accepting writes if any **two** nodes fail at the same time. What is the minimum cluster size?

- A. 3
- B. 4
- C. 5
- D. 6

??? success "Answer"
    **C — 5.**

    N nodes tolerate ⌊(N−1)/2⌋ failures: 3 tolerate 1, 4 still tolerate only 1, 5 tolerate 2. Even sizes add cost without adding fault tolerance. The 5 nodes should be spread across zones so that no single zone holds a majority.

---

**Q12.** A Cassandra table uses N = 3 replicas. Which read/write settings guarantee that a read overlaps with the latest acknowledged write?

- A. W = 1, R = 1
- B. W = 1, R = 2
- C. W = 2, R = 2
- D. W = 2, R = 1

??? success "Answer"
    **C — W = 2, R = 2.**

    The overlap condition is R + W > N: 2 + 2 = 4 > 3. Options A (2), B (3) and D (3) are not greater than N. Remember the overlap is necessary but not sufficient for linearizability: concurrent writes, sloppy quorums and LWW with skewed clocks still cause anomalies.

---

**Q13.** A `scheduler` replica holds a lease from etcd, pauses for 15 s in garbage collection, and wakes up after its lease has expired and another replica took it. What prevents the old holder from corrupting the shared state?

- A. A longer lease TTL
- B. A fencing token that increases with every grant and is checked by the storage, which rejects writes with an older token
- C. Synchronised clocks with NTP
- D. Running the scheduler with more memory

??? success "Answer"
    **B — A fencing token.**

    A paused process cannot know it was paused. Longer TTLs only make the window rarer; clocks do not help a process that is not running. The storage must reject stale holders by comparing a monotonically increasing token (etcd revision, ZooKeeper zxid, a Raft term).

---

## Distributed transactions

**Q14.** In two-phase commit, the coordinator crashes after every participant voted **yes** but before sending the decision. What happens to the participants?

- A. They commit on their own, since everybody voted yes
- B. They abort on their own after a timeout
- C. They stay **in doubt**, holding their locks, until the coordinator recovers and tells them the decision
- D. They elect a new coordinator with Raft and continue

??? success "Answer"
    **C — In doubt, holding locks.**

    A participant that voted yes has promised to commit if told so, and cannot know whether the coordinator decided commit (and others already committed) or abort (maybe someone else voted no). It must wait — this is 2PC's blocking problem. Systems such as Spanner and CockroachDB avoid it by replicating the coordinator's state with consensus; option D describes that design, not plain 2PC.

---

**Q15.** BoxOffice's checkout spans `inventory`, `payment` (an external provider) and `order`. The card is declined after the seat was moved to `RESERVED_FOR_PAYMENT`. In an orchestrated saga, what should happen?

- A. Nothing: sagas are isolated, so the seat was never visible as reserved
- B. The orchestrator runs compensations in reverse order: release the seat, then cancel the order
- C. The orchestrator asks the payment provider to roll back its prepared transaction
- D. The whole checkout is retried until the card is accepted

??? success "Answer"
    **B — Compensate in reverse order.**

    A saga is a sequence of local transactions; when a step fails, the already-completed steps are undone by compensating transactions. Sagas are not isolated — other fans saw the seat as reserved, which is why the intermediate state works as a semantic lock with an expiry. An external provider has no "prepared transaction" to roll back (it cannot join 2PC), and retrying a declined card forever is not a business rule.

---

## Time and clocks

**Q16.** Two `inventory` nodes resolve conflicting writes to the same seat with last-write-wins using their own wall clocks. Node 1's clock is 50 ms ahead. What happens to two conflicting writes made 20 ms apart, the later one on node 2?

- A. The later write always wins, because NTP corrects the clocks
- B. The earlier write (on node 1) can win, because its timestamp is higher; the later write is silently lost
- C. Both writes are kept as siblings
- D. The database rejects both writes

??? success "Answer"
    **B — The earlier write can win.**

    With clocks that disagree by more than the gap between the events, timestamps order them wrongly, and LWW silently discards one write — always biased towards the node with the fastest clock. For seats and money, let a single authority decide (a conditional write on one primary), or detect concurrency with version vectors.

---

**Q17.** Lamport clock values satisfy L(a) = 7 and L(b) = 9. What can you conclude?

- A. a happened before b
- B. b happened before a
- C. Either a happened before b, or a and b are concurrent — but b did not happen before a
- D. a and b are concurrent

??? success "Answer"
    **C — Not "b → a", but a may be concurrent with b.**

    Lamport clocks guarantee that if a → b then L(a) < L(b). Contrapositive: if L(a) < L(b), b did not happen before a. They cannot distinguish "a → b" from "concurrent". Vector clocks can.
