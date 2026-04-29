
The **CAP Theorem**, proposed by Eric Brewer in 2000 and formally proven by Seth Gilbert and Nancy Lynch in 2002[^1], states that a distributed system that replicates data across nodes **cannot simultaneously guarantee all three** of the following properties:

[![CAP Theorem Euler Diagram](https://upload.wikimedia.org/wikipedia/commons/9/98/CAP_Theorem_Euler_Diagram.png){ width="55%" }](https://en.wikipedia.org/wiki/CAP_theorem){target="_blank"}

---

## The three properties

**Consistency (C)**
: Every read returns the most recent write, or an error. All nodes see the same data at the same time — equivalent to *linearisability* in concurrent programming. In a consistent system, it is impossible to read stale data.

**Availability (A)**
: Every request receives a non-error response. The system remains operational as long as at least one node is running, even if the response may not contain the most recent write.

**Partition Tolerance (P)**
: The system continues to operate despite arbitrary network partitions — message drops or delays between nodes. Partitions are a fact of life in any real distributed network; hardware failures, congestion, and physical distances all cause them.

!!! warning "Partition Tolerance is not optional"
    In any real-world distributed system, network partitions *will* happen. The practical choice is therefore between **C** and **A** during a partition — not whether to include **P**.

---

## System classes

### CP — Consistent and Partition-Tolerant

During a partition, the system refuses requests rather than returning potentially stale data. When the partition heals, consistency is restored before serving again.

**Examples:** PostgreSQL in distributed mode, MongoDB (default configuration), Apache ZooKeeper, etcd.

**Use when:** correctness is non-negotiable — financial transactions, inventory systems, identity stores.

```
Node A ──── [partition] ──── Node B
   │                            │
Client                       Returns error
writes here                  (unavailable)
```

### AP — Available and Partition-Tolerant

During a partition, every node continues to respond, but nodes may diverge and return different data. After the partition heals, the system converges to a consistent state (*eventual consistency*).

**Examples:** Apache Cassandra, Amazon DynamoDB, CouchDB, DNS.

**Use when:** availability matters more than momentary accuracy — shopping carts, social media feeds, search indexes.

```
Node A ──── [partition] ──── Node B
   │                            │
Client A sees              Client B sees
version 5                  version 4 (stale)
         ← converge after partition heals →
```

### CA — Consistent and Available

Assumes no partitions, which is only realistic for single-machine systems or tightly controlled LANs. Not a practical category for distributed systems.

---

## Comparison table

| | CP | AP | CA |
|---|---|---|---|
| **Consistency** | ✅ Always | ❌ Eventually | ✅ Always |
| **Availability** | ❌ During partition | ✅ Always | ✅ Always |
| **Partition tolerance** | ✅ | ✅ | ❌ (unrealistic) |
| **Trade-off** | Reject requests during partition | Return possibly stale data | Only works on single node |
| **Examples** | ZooKeeper, etcd, PostgreSQL | Cassandra, DynamoDB, DNS | Single-node RDBMS |

---

## The PACELC extension

The CAP theorem only addresses the partition scenario. **PACELC** (Daniel Abadi, 2010)[^2] extends it by asking: *even when there is no partition, what is the trade-off?*

```
If Partition:
  → choose between Availability and Consistency
Else (normal operation):
  → choose between Latency and Consistency
```

| System | Partition behaviour | Normal behaviour | Classification |
|---|---|---|---|
| Cassandra | Favours A | Favours L (low latency) | PA/EL |
| DynamoDB | Favours A | Favours L | PA/EL |
| MongoDB | Favours C | Favours C | PC/EC |
| PostgreSQL | Favours C | Favours C | PC/EC |

PACELC is more useful than CAP for making day-to-day database choices, because most of the time there is no partition — yet the latency/consistency trade-off is always present.

---

## Practical implications for system design

**E-commerce product catalogue** → AP
: Showing a product as in-stock when it has just gone out of stock is acceptable. A brief period of stale data does not harm correctness.

**Shopping cart** → AP
: Adding an item to a cart that temporarily diverges across replicas is fine; the cart can reconcile on checkout.

**Payment processing** → CP
: A double charge or missed debit cannot be reconciled after the fact. Consistency is required.

**User authentication** → CP
: A revoked token must be immediately invalid across all nodes. Stale auth state is a security vulnerability.

!!! tip "Most systems mix both"
    A single application can use an AP store (Cassandra) for user activity logs and a CP store (PostgreSQL) for financial records. Choose per data domain, not per application.

---

[^1]: GILBERT, S.; LYNCH, N. [Brewer's Conjecture and the Feasibility of Consistent, Available, Partition-Tolerant Web Services](https://dl.acm.org/doi/10.1145/564585.564601){target="_blank"}. ACM SIGACT News, 2002.
[^2]: ABADI, D. [Consistency Tradeoffs in Modern Distributed Database System Design](https://cs.yale.edu/homes/abadi/papers/pacelc.pdf){target="_blank"}. IEEE Computer, 2012.
[^3]: [CAP Theorem — Wikipedia](https://en.wikipedia.org/wiki/CAP_theorem){target="_blank"}
[^4]: [PACELC Theorem](https://www.geeksforgeeks.org/operating-systems/pacelc-theorem/){target="_blank"}
