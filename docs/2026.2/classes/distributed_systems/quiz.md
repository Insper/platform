
Click **"Answer"** to reveal the correct answer and explanation. Try to answer before revealing.

---

## Foundations

**Q1.** The order service calls the product service to reserve one unit of stock and gets no reply within its 2-second timeout. What can it safely conclude?

- A. The product service has crashed and must be restarted
- B. The reservation was not applied, so it is safe to retry without any precaution
- C. Nothing certain — the request may have been lost, applied with the reply lost, or still be in progress; a retry must be idempotent
- D. The network is partitioned, so the order service must switch to CP mode

??? success "Answer"
    **C — Nothing certain; retries must be idempotent.**

    A lost request, a crashed server, a lost reply and a very slow server all look the same to the caller: silence. The timeout only says "I stopped waiting". If the reservation was actually applied and the reply was lost, a naive retry reserves the unit twice. Making the operation idempotent (for example, with a unique request id that the server deduplicates) makes the retry safe.

---

**Q2.** Using **Lamport clocks**, process B has counter 3 and receives a message stamped 7. What is B's counter after the receive event?

- A. 3
- B. 4
- C. 7
- D. 8

??? success "Answer"
    **D — 8.**

    On receipt, the rule is `max(local, received) + 1` = `max(3, 7) + 1` = 8. This guarantees that the receive event gets a larger timestamp than the send event, so "happened-before" is always reflected in the timestamps. Note the converse does not hold: a smaller Lamport timestamp does not prove causality — vector clocks are needed for that.

---

## CAP Theorem

**Q3.** What does the **P** in CAP stand for, and why is it non-negotiable in any real distributed system?

- A. Performance — slow systems are considered unavailable
- B. Persistence — data must survive node restarts
- C. Partition Tolerance — the system continues operating despite network partitions
- D. Predictability — responses must arrive within a bounded time

??? success "Answer"
    **C — Partition Tolerance.**

    Network partitions — where messages between nodes are lost or delayed — happen in any real distributed system due to hardware failures, congestion, or physical distance. Because partitions cannot be prevented, the practical design choice is between **C** (refuse requests during partition) and **A** (continue serving, possibly stale data).

---

**Q4.** A distributed database refuses all reads during a network partition to avoid returning stale data. Which CAP category does it belong to?

- A. CA — Consistent and Available
- B. CP — Consistent and Partition-Tolerant
- C. AP — Available and Partition-Tolerant
- D. None — it violates all three properties simultaneously

??? success "Answer"
    **B — CP.**

    By refusing reads during a partition, the system prioritises **consistency** (no stale data) over availability. Once the partition heals, service resumes. ZooKeeper and etcd are classic CP examples.

---

**Q5.** Which of the following systems are typically classified as **AP** (Available and Partition-Tolerant)?

- A. Apache ZooKeeper and etcd
- B. PostgreSQL and MongoDB
- C. Apache Cassandra and DNS
- D. Redis and SQLite

??? success "Answer"
    **C — Apache Cassandra and DNS.**

    Both continue serving requests during partitions, accepting that responses may be temporarily stale (eventual consistency). ZooKeeper and etcd are CP; PostgreSQL with synchronous replication and MongoDB with its default majority writes behave as CP. A single-node Redis or SQLite is not replicated at all, so CAP does not really apply to it — it sits in the "CA" corner only because there is no second node to be partitioned from.

---

**Q6.** The PACELC theorem extends CAP. What does the **ELC** part address that CAP ignores?

- A. Even when a partition heals, the system must re-elect a leader before serving
- B. Even without a partition, the system must choose between Latency and Consistency
- C. Every lost connection requires a Checkpoint before normal operation resumes
- D. Eventual consistency is always preferred over strong consistency at low load

??? success "Answer"
    **B — Even without a partition: Latency vs Consistency trade-off.**

    CAP only describes behaviour during a partition. PACELC adds that even in normal operation, systems must trade off between **lower latency** (serve quickly, risk slightly stale reads) and **stronger consistency** (wait for replication agreement before responding). Cassandra is PA/EL; MongoDB with majority writes is PC/EC.

---

**Q7.** A payment service must never allow a double charge. A network partition occurs between the payment node and the replication node. Which design is correct?

- A. Use an AP store — availability ensures the payment always goes through
- B. Use a CA store — the single-node guarantee prevents concurrency issues
- C. Use a CP store — refuse the request during the partition rather than risk an inconsistent state
- D. Use an AP store with last-write-wins — timestamps prevent duplicates

??? success "Answer"
    **C — CP store.**

    For financial transactions, correctness is non-negotiable. A CP store refuses to process the payment during the partition (the customer gets an error, not a double charge). An AP store might process the payment on two nodes simultaneously before the partition heals, creating a duplicate transaction that cannot be safely undone. Last-write-wins (D) would silently discard one of the conflicting writes, and depends on clocks that drift.

---

**Q8.** In which scenario is a **CA system** (Consistent and Available) actually achievable?

- A. In a three-node cluster with synchronous replication
- B. In a geographically distributed system with dedicated links
- C. Only on a single-machine system or tightly controlled LAN with no partitions possible
- D. Never — CA is theoretically impossible

??? success "Answer"
    **C — Single-machine or tightly controlled LAN.**

    CA only works when partitions genuinely cannot occur — which is only realistic for a single server or a local area network under strict control. In any internet-connected or geographically distributed deployment, P is effectively mandatory, leaving the real choice between C and A.

---

**Q9.** In PACELC terms, how would you classify a system that favours **low latency** during normal operation and **availability** during a partition?

- A. PC/EC
- B. PA/EC
- C. PC/EL
- D. PA/EL

??? success "Answer"
    **D — PA/EL.**

    PA = during a Partition, favours Availability. EL = Else (normal operation), favours Latency. Apache Cassandra is the canonical PA/EL system — it always responds quickly and accepts eventual consistency in both scenarios.

---

## Consensus Algorithms

**Q10.** What does the **FLP Impossibility Theorem** prove about distributed consensus?

- A. Consensus is impossible in any system with more than one node
- B. In a purely asynchronous system where even one process may crash, no deterministic algorithm can guarantee that consensus is always reached
- C. Leader election always terminates within a fixed number of rounds
- D. Byzantine failures make consensus impossible even with synchronous networks

??? success "Answer"
    **B — No guaranteed termination in an async system with ≥1 faulty node.**

    FLP (Fischer, Lynch, Paterson, 1985) proves this fundamental limit: some unlucky ordering of delays can keep any deterministic algorithm undecided forever. Real algorithms respond by assuming *partial synchrony* (delays are eventually bounded) or by using randomisation. Paxos and Raft never violate safety, and use timeouts as a proxy for failure detection to make progress.

---

**Q11.** In Raft, what event triggers a new **leader election**?

- A. The current leader sends a `resign` message to the cluster
- B. A majority of followers vote to remove the current leader
- C. A follower's election timeout expires without receiving a heartbeat from the current leader
- D. The cluster detects that the leader's log has diverged from followers

??? success "Answer"
    **C — Follower election timeout expires.**

    Each follower maintains a randomised election timeout. If no heartbeat arrives before it expires, the follower assumes the leader has crashed and starts a new election by incrementing the term and requesting votes. Randomised timeouts prevent multiple followers from starting elections simultaneously.

---

**Q12.** A team runs etcd on **4** nodes "to be safer than 3". How many node failures can the 4-node cluster tolerate while still accepting writes?

- A. 1 — the same as a 3-node cluster
- B. 2 — half of the nodes
- C. 3 — any single surviving node can serve writes
- D. 0 — an even number of nodes cannot elect a leader

??? success "Answer"
    **A — 1.**

    A write needs a majority: ⌊4/2⌋ + 1 = 3 nodes. With 2 nodes down only 2 remain, which is not a majority. So 4 nodes tolerate ⌊(4-1)/2⌋ = 1 failure — the same as 3 nodes, with one more machine that can fail. That is why consensus clusters use odd sizes (3 or 5). An even cluster can still elect a leader (D is false); it just gains nothing.

---

**Q13.** Which formula guarantees that any read quorum overlaps with any write quorum, ensuring you always read the latest write?

- A. W > N / 2
- B. R > N / 2
- C. W = R = N
- D. W + R > N

??? success "Answer"
    **D — W + R > N.**

    If write quorum W plus read quorum R exceeds total replicas N, at least one node that acknowledged the write must also participate in any read quorum. This overlap ensures the latest write is always visible in a quorum read, forming the basis of systems like Dynamo and Cassandra's tunable consistency (for example, `QUORUM` reads and writes with N = 3: 2 + 2 > 3).

---

**Q14.** Two replicas of a **G-Counter** CRDT hold `[4, 1, 0]` and `[2, 3, 0]` (one slot per node). What is the counter's value after they merge?

- A. 5 — the larger of the two totals
- B. 7 — the element-wise maximum `[4, 3, 0]`, summed
- C. 10 — the sum of both totals
- D. It depends on which replica merged last

??? success "Answer"
    **B — 7.**

    The G-Counter merge takes the **element-wise maximum** of the slots: `[max(4,2), max(1,3), max(0,0)]` = `[4, 3, 0]`, whose sum is 7. Because each node only increments its own slot, the maximum of a slot is its latest value; summing the two totals (C) would double-count, and the merge is commutative and idempotent, so the order of merges does not matter (D is false).
