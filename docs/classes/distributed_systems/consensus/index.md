
**Consensus** is the problem of getting a group of distributed nodes to agree on a single value — despite messages being delayed, lost, or reordered, and despite some nodes failing. It is the foundational primitive for leader election, distributed locks, replicated state machines, and consistent configuration stores.

---

## Why consensus is hard: the FLP Impossibility

The **FLP Impossibility Theorem** (Fischer, Lynch, Paterson, 1985)[^1] proves that in a purely asynchronous distributed system with even a single faulty node, no algorithm can guarantee consensus in bounded time.

The implication is that every practical consensus algorithm makes a trade-off:
- Either it assumes *partial synchrony* (message delays are bounded, eventually), or
- It sacrifices liveness (it may block forever in adversarial conditions), or
- It sacrifices safety (it may produce inconsistent results in rare cases).

Real systems handle this by using **timeouts** as a proxy for failure detection — accepting that a slow node looks indistinguishable from a crashed one.

---

## Failure models

Before choosing a consensus algorithm, you must know what failures to tolerate:

| Model | What a faulty node does | Tolerance cost |
|---|---|---|
| **Crash-stop** | The node halts and never recovers | Easiest to handle — a majority of N nodes can tolerate ⌊(N-1)/2⌋ failures |
| **Crash-recovery** | The node halts but may restart with persistent state | Requires durable logs; algorithms must handle rejoining nodes |
| **Byzantine** | The node behaves arbitrarily — incorrect messages, equivocation, malice | Hardest — requires 3f+1 nodes to tolerate f Byzantine failures |

Most datacenter algorithms assume crash-stop or crash-recovery. Byzantine fault tolerance (BFT) is used in blockchain and safety-critical systems.

---

## Paxos

Paxos[^2], introduced by Leslie Lamport (1998), was the first practical consensus algorithm for crash-stop failures in asynchronous networks. It operates in two phases and tolerates up to ⌊(N-1)/2⌋ failures with N nodes.

``` mermaid
sequenceDiagram
  participant P as Proposer
  participant A1 as Acceptor 1
  participant A2 as Acceptor 2
  participant A3 as Acceptor 3

  Note over P,A3: Phase 1 — Prepare
  P->>A1: Prepare(n)
  P->>A2: Prepare(n)
  P->>A3: Prepare(n)
  A1-->>P: Promise(n, -)
  A2-->>P: Promise(n, -)
  A3-->>P: Promise(n, -)

  Note over P,A3: Phase 2 — Accept
  P->>A1: Accept(n, value)
  P->>A2: Accept(n, value)
  P->>A3: Accept(n, value)
  A1-->>P: Accepted
  A2-->>P: Accepted
```

**Phase 1 (Prepare):** The proposer sends a ballot number `n` to a quorum of acceptors. Each acceptor promises not to accept any proposal with a lower number.

**Phase 2 (Accept):** The proposer sends its value to the quorum. Acceptors accept if they have not since promised a higher ballot.

Paxos is notoriously difficult to implement correctly. It does not specify leader election, log compaction, or membership changes — each production implementation must solve these separately.

---

## Raft

Raft[^3] (Ongaro and Ousterhout, 2014) was designed explicitly for understandability. It decomposes the consensus problem into three relatively independent sub-problems:

1. **Leader election** — one node becomes leader; all writes go through it.
2. **Log replication** — the leader appends entries to its log and replicates them to followers.
3. **Safety** — a committed entry is never overwritten; leaders only commit after a quorum acknowledges.

``` mermaid
stateDiagram-v2
  [*] --> Follower
  Follower --> Candidate : election timeout
  Candidate --> Leader : wins election (majority vote)
  Candidate --> Follower : sees higher term
  Leader --> Follower : sees higher term
```

**Terms** act as logical clocks: each term begins with an election. A node that receives a message from a higher term immediately steps down to follower.

Raft is used in **etcd** (the key-value store underpinning Kubernetes), **CockroachDB**, and **Consul**.

### Log replication

``` mermaid
sequenceDiagram
  participant C as Client
  participant L as Leader
  participant F1 as Follower 1
  participant F2 as Follower 2

  C->>L: Write x=5
  L->>F1: AppendEntries(x=5)
  L->>F2: AppendEntries(x=5)
  F1-->>L: OK
  F2-->>L: OK
  Note over L: Majority acknowledged — commit
  L-->>C: Success
```

The leader only responds to the client after a majority of nodes have durably written the entry. This guarantees that the entry survives any single node failure.

---

## Quorum systems

A **quorum** is the minimum number of nodes that must participate in an operation for it to be valid. Quorums are the mechanism that makes read/write pairs consistent without requiring every node to participate.

For a system with **N** replicas:

| Operation | Requirement |
|---|---|
| Write quorum (W) | W nodes must acknowledge the write |
| Read quorum (R) | R nodes must respond to the read |
| **Consistency condition** | **W + R > N** |

When W + R > N, every read quorum overlaps with every write quorum — at least one node in the read set has the latest write.

**Example:** N=5, W=3, R=3 → W + R = 6 > 5 ✅

**Cassandra's tunable consistency** exposes W and R as per-request parameters (`QUORUM`, `ALL`, `ONE`), letting the caller trade off between consistency and latency.

---

## Eventual consistency and CRDTs

**Eventual consistency** is the guarantee made by AP systems: if no new updates are made, all replicas will eventually converge to the same value. It does not specify *when*.

Strategies for convergence:

- **Last-Write-Wins (LWW):** Each write carries a timestamp; the highest timestamp wins. Simple but risks losing concurrent writes.
- **Vector clocks:** Track causality between operations; detect concurrent writes for explicit conflict resolution.
- **CRDTs (Conflict-Free Replicated Data Types):** Data structures mathematically designed so that concurrent updates always merge without conflict. Examples: counters, sets (add-only), registers.

```java
// A G-Counter CRDT: each node increments its own slot
// Total = sum of all slots — always convergent
long[] counters = new long[nodeCount];
counters[myNodeId]++;

long total() {
    return Arrays.stream(counters).sum();
}
```

CRDTs are used in shopping carts (Dynamo), collaborative editors (Google Docs), and distributed counters.

---

## Practical tools

| Tool | Role | Consensus algorithm |
|---|---|---|
| **etcd** | Key-value store, Kubernetes config | Raft |
| **Apache ZooKeeper** | Coordination, leader election | ZAB (Zookeeper Atomic Broadcast, Paxos-derived) |
| **Consul** | Service discovery, distributed locks | Raft |
| **Apache Kafka** | Distributed log, messaging | KRaft (Raft-based, replaces ZooKeeper) |

---

[^1]: FISCHER, M.; LYNCH, N.; PATERSON, M. [Impossibility of Distributed Consensus with One Faulty Process](https://dl.acm.org/doi/10.1145/3149.214121){target="_blank"}. JACM, 1985.
[^2]: LAMPORT, L. [Paxos Made Simple](https://lamport.azurewebsites.net/pubs/paxos-simple.pdf){target="_blank"}. ACM SIGACT News, 2001.
[^3]: ONGARO, D.; OUSTERHOUT, J. [In Search of an Understandable Consensus Algorithm (Raft)](https://raft.github.io/raft.pdf){target="_blank"}. USENIX ATC, 2014.
[^4]: [Raft Visualization](https://raft.github.io/){target="_blank"} — interactive animation of leader election and log replication.
