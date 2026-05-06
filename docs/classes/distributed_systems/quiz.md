
Click **"Answer"** to reveal the correct answer and explanation. Try to answer before revealing.

---

## CAP Theorem

**Q1.** What does the **P** in CAP stand for, and why is it non-negotiable in any real distributed system?

- A. Performance — slow systems are considered unavailable
- B. Persistence — data must survive node restarts
- C. Partition Tolerance — the system continues operating despite network partitions
- D. Predictability — responses must arrive within a bounded time

??? success "Answer"
    **C — Partition Tolerance.**

    Network partitions — where messages between nodes are lost or delayed — happen in any real distributed system due to hardware failures, congestion, or physical distance. Because partitions cannot be prevented, the practical design choice is between **C** (refuse requests during partition) and **A** (continue serving, possibly stale data).

---

**Q2.** A distributed database refuses all reads during a network partition to avoid returning stale data. Which CAP category does it belong to?

- A. CA — Consistent and Available
- B. CP — Consistent and Partition-Tolerant
- C. AP — Available and Partition-Tolerant
- D. None — it violates all three properties simultaneously

??? success "Answer"
    **B — CP.**

    By refusing reads during a partition, the system prioritises **consistency** (no stale data) over availability. Once the partition heals, service resumes. ZooKeeper and etcd are classic CP examples.

---

**Q3.** Which of the following systems are typically classified as **AP** (Available and Partition-Tolerant)?

- A. Apache ZooKeeper and etcd
- B. PostgreSQL and MongoDB
- C. Apache Cassandra and DNS
- D. Redis and SQLite

??? success "Answer"
    **C — Apache Cassandra and DNS.**

    Both continue serving requests during partitions, accepting that responses may be temporarily stale (eventual consistency). ZooKeeper and etcd are CP; PostgreSQL and MongoDB are CP by default; Redis in single-node mode is neither (it is CA, unrealistic for production distribution).

---

**Q4.** The PACELC theorem extends CAP. What does the **ELC** part address that CAP ignores?

- A. Even when a partition heals, the system must re-elect a leader before serving
- B. Even without a partition, the system must choose between Latency and Consistency
- C. Every lost connection requires a Checkpoint before normal operation resumes
- D. Eventual consistency is always preferred over strong consistency at low load

??? success "Answer"
    **B — Even without a partition: Latency vs Consistency trade-off.**

    CAP only describes behaviour during a partition. PACELC adds that even in normal operation, systems must trade off between **lower latency** (serve quickly, risk slightly stale reads) and **stronger consistency** (wait for replication agreement before responding). Cassandra is PA/EL; MongoDB is PC/EC.

---

**Q5.** A payment service must never allow a double charge. A network partition occurs between the payment node and the replication node. Which design is correct?

- A. Use an AP store — availability ensures the payment always goes through
- B. Use a CA store — the single-node guarantee prevents concurrency issues
- C. Use a CP store — refuse the request during the partition rather than risk an inconsistent state
- D. Use an AP store with last-write-wins — timestamps prevent duplicates

??? success "Answer"
    **C — CP store.**

    For financial transactions, correctness is non-negotiable. A CP store refuses to process the payment during the partition (the customer gets an error, not a double charge). An AP store might process the payment on two nodes simultaneously before the partition heals, creating a duplicate transaction that cannot be safely undone.

---

**Q6.** In which scenario is a **CA system** (Consistent and Available) actually achievable?

- A. In a three-node cluster with synchronous replication
- B. In a geographically distributed system with dedicated links
- C. Only on a single-machine system or tightly controlled LAN with no partitions possible
- D. Never — CA is theoretically impossible

??? success "Answer"
    **C — Single-machine or tightly controlled LAN.**

    CA only works when partitions genuinely cannot occur — which is only realistic for a single server or a local area network under strict control. In any internet-connected or geographically distributed deployment, P is effectively mandatory, leaving the real choice between C and A.

---

**Q7.** In PACELC terms, how would you classify a system that favours **low latency** during normal operation and **availability** during a partition?

- A. PC/EC
- B. PA/EC
- C. PC/EL
- D. PA/EL

??? success "Answer"
    **D — PA/EL.**

    PA = during a Partition, favours Availability. EL = Else (normal operation), favours Latency. Apache Cassandra is the canonical PA/EL system — it always responds quickly and accepts eventual consistency in both scenarios.

---

## Consensus Algorithms

**Q8.** What does the **FLP Impossibility Theorem** prove about distributed consensus?

- A. Consensus is impossible in any system with more than one node
- B. In a purely asynchronous system with even one faulty process, no algorithm can guarantee consensus in bounded time
- C. Leader election always terminates within a fixed number of rounds
- D. Byzantine failures make consensus impossible even with synchronous networks

??? success "Answer"
    **B — No bounded-time guarantee in an async system with ≥1 faulty node.**

    FLP (Fischer, Lynch, Paterson, 1985) proves this fundamental limit. Real algorithms respond by assuming *partial synchrony* (delays are bounded eventually) or by sacrificing liveness in adversarial conditions. This is why Raft and Paxos use timeouts as a proxy for failure detection.

---

**Q9.** In Raft, what event triggers a new **leader election**?

- A. The current leader sends a `resign` message to the cluster
- B. A majority of followers vote to remove the current leader
- C. A follower's election timeout expires without receiving a heartbeat from the current leader
- D. The cluster detects that the leader's log has diverged from followers

??? success "Answer"
    **C — Follower election timeout expires.**

    Each follower maintains a randomised election timeout. If no heartbeat arrives before it expires, the follower assumes the leader has crashed and starts a new election by incrementing the term and requesting votes. Randomised timeouts prevent multiple followers from starting elections simultaneously.

---

**Q10.** Which formula guarantees that any read quorum overlaps with any write quorum, ensuring you always read the latest write?

- A. W > N / 2
- B. R > N / 2
- C. W = R = N
- D. W + R > N

??? success "Answer"
    **D — W + R > N.**

    If write quorum W plus read quorum R exceeds total replicas N, at least one node that acknowledged the write must also participate in any read quorum. This overlap ensures the latest write is always visible in a quorum read, forming the basis of systems like Dynamo and Cassandra's tunable consistency.
