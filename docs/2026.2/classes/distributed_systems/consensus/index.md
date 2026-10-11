
When the store runs on Kubernetes ([Hands-on 5](../../../hands-on/5/index.md)), the whole state of the cluster — which pods exist, which image each Deployment runs, which Secrets are defined — lives in **etcd**. A production cluster runs three or five etcd members so that the cluster survives the loss of a machine. But replication brings a question: if two `kubectl apply` commands arrive at two different members at the same moment, and one member then crashes, **which version is the truth**, and how do the survivors agree on it without a referee? Answering that question is the consensus problem.

**Consensus** is the problem of getting a group of distributed nodes to agree on a single value — despite messages being delayed, lost, or reordered, and despite some nodes failing. It is the foundational primitive for leader election, distributed locks, replicated state machines, and consistent configuration stores.

A **replicated state machine** is the most common use: every node starts in the same state and applies the same commands **in the same order** (a *log*), so every node ends in the same state. Consensus is what makes all nodes agree on the next entry of the log.

A correct consensus algorithm must guarantee two kinds of property:

**Safety** ("nothing bad happens")
: All nodes that decide, decide the **same** value, and that value was actually proposed by someone.

**Liveness** ("something good eventually happens")
: Every non-faulty node **eventually** decides.

---

## Why consensus is hard: the FLP Impossibility

The **FLP Impossibility Theorem** (Fischer, Lynch, Paterson, 1985)[^1] proves that in a purely asynchronous distributed system (no upper bound on message delays or processing time) with even a single node that may crash, **no deterministic algorithm can guarantee that consensus is always reached**. Some execution — an unlucky ordering of delays — can keep the algorithm undecided forever.

The implication is that every practical consensus algorithm makes a trade-off:

- It assumes *partial synchrony*: the network may misbehave for a while, but eventually delays become bounded — and it only guarantees progress (liveness) during those "good" periods, or
- It uses **randomisation**, so that it terminates with probability 1, or
- It weakens the problem (for example, accepting that it may block forever in adversarial conditions).

Paxos and Raft take the first route: they **never violate safety**, even when the network is chaotic, and make progress whenever the network is "well-behaved enough".

Real systems handle this by using **timeouts** as a proxy for failure detection — accepting that a slow node looks indistinguishable from a crashed one (see [the three root problems](../index.md#the-three-root-problems)).

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

## Majorities: why clusters have 3 or 5 nodes

Paxos, Raft and ZooKeeper all rely on the same idea: a decision is valid only if a **majority** (more than half) of the N nodes agrees. Any two majorities of the same cluster **share at least one node**, so two conflicting decisions can never both collect a majority — that shared node would have to vote for both.

| Cluster size N | Majority (⌊N/2⌋ + 1) | Failures tolerated (⌊(N-1)/2⌋) |
|---|---|---|
| 1 | 1 | 0 |
| 2 | 2 | 0 |
| 3 | 2 | **1** |
| 4 | 3 | 1 |
| 5 | 3 | **2** |
| 7 | 4 | 3 |

!!! tip "Use an odd number of nodes"
    Going from 3 to 4 nodes adds cost and one more machine that can fail, but tolerates **no extra failure**. That is why etcd, ZooKeeper and Consul clusters are sized 3 or 5. A 2-node cluster is worse than a single node: losing either node stops it.

A majority also protects against **split brain** — two parts of a partitioned cluster both believing they are in charge. With 5 nodes split 3/2, only the side with 3 can form a majority:

``` mermaid-sim
flowchart LR
    subgraph maj ["Majority side (3 of 5)"]
        n1[Node 1 leader] --- n2[Node 2]
        n2 --- n3[Node 3]
    end
    subgraph min ["Minority side (2 of 5)"]
        n4[Node 4] --- n5[Node 5]
    end
    n3 -.-|partition| n4
    maj -->|"can elect and commit"| ok([keeps serving writes])
    min -->|"cannot reach 3 votes"| ko([rejects writes])
```

---

## Paxos

Paxos[^2], introduced by Leslie Lamport (published in 1998, explained more simply in 2001), is the classic consensus algorithm for crash failures in asynchronous networks. It operates in two phases and tolerates up to ⌊(N-1)/2⌋ failures with N nodes. Nodes play three roles: **proposers** suggest values, **acceptors** vote on them, and **learners** find out the decided value.

``` mermaid-sim
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

**Phase 1 (Prepare):** The proposer picks a unique ballot number `n` and sends it to the acceptors. Each acceptor promises not to accept any proposal with a lower number, and replies with the highest-numbered proposal it has **already accepted**, if any (the `-` in the diagram means "none").

**Phase 2 (Accept):** Once a majority has promised, the proposer sends `Accept(n, value)`. The value is **not free**: if any promise carried a previously accepted value, the proposer must propose the value of the highest-numbered one; only if none did can it propose its own. Acceptors accept if they have not since promised a higher ballot. The value is **chosen** once a majority has accepted it — in the diagram, two of three acceptors are enough.

The rule "adopt the previously accepted value" is what makes Paxos safe: once a value may have been chosen, every later proposer is forced to propose that same value.

Paxos is notoriously difficult to implement correctly. It does not specify leader election, log compaction, or membership changes — each production implementation must solve these separately.

---

## Raft

Raft[^3] (Ongaro and Ousterhout, 2014) was designed explicitly for understandability. It decomposes the consensus problem into three relatively independent sub-problems:

1. **Leader election** — one node becomes leader; all writes go through it.
2. **Log replication** — the leader appends entries to its log and replicates them to followers.
3. **Safety** — a committed entry is never overwritten; leaders only commit after a quorum acknowledges.

``` mermaid-sim
stateDiagram-v2
  [*] --> Follower
  Follower --> Candidate : election timeout
  Candidate --> Leader : wins election (majority vote)
  Candidate --> Follower : sees higher term
  Leader --> Follower : sees higher term
```

**Terms** act as logical clocks (see [Time and ordering](../index.md#time-and-ordering-logical-clocks)): each term begins with an election, and there is at most one leader per term. A node that receives a message from a higher term immediately steps down to follower.

### Leader election sequence

``` mermaid-sim
sequenceDiagram
  participant N1 as Node 1 (Candidate)
  participant N2 as Node 2 (Follower)
  participant N3 as Node 3 (Follower)

  Note over N1,N3: Term 1 — leader is silent, election timeout fires on Node 1
  N1->>N1: increment term to 2, vote for self
  N1->>N2: RequestVote(term=2, lastLogIndex=5)
  N1->>N3: RequestVote(term=2, lastLogIndex=5)
  N2-->>N1: VoteGranted(term=2)
  N3-->>N1: VoteGranted(term=2)
  Note over N1: majority (2/3) — becomes Leader for term 2
  N1->>N2: AppendEntries(term=2, heartbeat)
  N1->>N3: AppendEntries(term=2, heartbeat)
```

A candidate wins the election only if it receives votes from a majority of nodes **and** its log is at least as up-to-date as the voters' logs (the *election restriction*). This ensures the new leader already holds all committed entries. Each node votes for at most one candidate per term.

Election timeouts are **randomised** (the Raft paper suggests 150–300 ms): if all followers timed out at the same instant, they would all become candidates, split the votes and nobody would win. With random timeouts, one node usually times out first and wins before the others start.

Raft is used in **etcd** (the key-value store underpinning Kubernetes), **CockroachDB**, and **Consul**.

### Log replication

``` mermaid-sim
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

The leader only responds to the client after a majority of nodes (counting itself) have durably written the entry. Because any future leader must win votes from a majority, and any majority contains at least one node holding the entry, a committed entry survives the failure of any **minority** of nodes.

!!! info "Try it"
    The [Raft visualization](https://raft.github.io/){target="_blank"}[^4] lets you stop nodes and watch a new election, and [The Secret Lives of Data](https://thesecretlivesofdata.com/raft/){target="_blank"}[^5] walks through Raft step by step.

---

## Quorum systems

A **quorum** is the minimum number of nodes that must participate in an operation for it to be valid. Quorums are the mechanism that makes read/write pairs consistent without requiring every node to participate. Raft's majority is one kind of quorum; leaderless databases such as Cassandra and DynamoDB use **read and write quorums** directly.

For a system with **N** replicas:

| Operation | Requirement |
|---|---|
| Write quorum (W) | W nodes must acknowledge the write |
| Read quorum (R) | R nodes must respond to the read |
| **Consistency condition** | **W + R > N** |

When W + R > N, every read quorum overlaps with every write quorum — at least one node in the read set has the latest write.

**Example:** N=5, W=3, R=3 → W + R = 6 > 5 ✅

**Counter-example:** N=3, W=1, R=1 → W + R = 2 ≤ 3 ❌ — a read may hit only the replica that missed the write.

**Cassandra's tunable consistency** exposes W and R as per-request parameters (`QUORUM`, `ALL`, `ONE`), letting the caller trade off between consistency and latency.

| Setting (N = 3) | W | R | W + R > N? | Effect |
|---|---|---|---|---|
| write `ONE`, read `ONE` | 1 | 1 | ❌ | fastest; reads may be stale |
| write `QUORUM`, read `QUORUM` | 2 | 2 | ✅ | reads see the latest acknowledged write; tolerates 1 node down |
| write `ALL`, read `ONE` | 3 | 1 | ✅ | fast reads, but a single node down blocks every write |

!!! warning "W + R > N is necessary, not sufficient"
    The overlap guarantees that a read *contacts* a node with the latest write, but edge cases remain: two concurrent writes, a write that succeeded on fewer than W nodes and was reported as failed, or "sloppy" quorums that accept writes on substitute nodes during failures. Quorum databases are therefore usually described as offering *tunable* consistency, not linearisability.

---

## Eventual consistency and CRDTs

**Eventual consistency** is the guarantee made by AP systems: if no new updates are made, all replicas will eventually converge to the same value. It does not specify *when*.

Strategies for convergence:

- **Last-Write-Wins (LWW):** Each write carries a timestamp; the highest timestamp wins. Simple but risks losing concurrent writes — and depends on clocks that drift (see [No global clock](../index.md#3-no-global-clock)).
- **Vector clocks:** Track causality between operations; detect concurrent writes for explicit conflict resolution (see [logical clocks](../index.md#time-and-ordering-logical-clocks)).
- **CRDTs (Conflict-Free Replicated Data Types):**[^6] Data structures mathematically designed so that concurrent updates always merge without conflict. Examples: counters, sets (add-only), registers.

The trick behind a CRDT is a **merge** function that is commutative, associative and idempotent: replicas can exchange their state in any order, any number of times, and still end up equal. The simplest one is the grow-only counter (*G-Counter*), for example "number of views of a product" counted on several nodes:

```java
// A G-Counter CRDT: each node increments only its own slot
class GCounter {
    private final long[] counts;   // one slot per node
    private final int me;          // this node's index

    GCounter(int nodes, int me) { this.counts = new long[nodes]; this.me = me; }

    void increment() { counts[me]++; }

    long value() { return Arrays.stream(counts).sum(); }

    // merge = element-wise max: order and repetition do not matter
    void merge(GCounter other) {
        for (int i = 0; i < counts.length; i++)
            counts[i] = Math.max(counts[i], other.counts[i]);
    }
}
```

If node 0 counted 3 views (`[3, 0]`) and node 1 counted 2 (`[0, 2]`), both merge to `[3, 2]` and report 5 — no update is lost, and no coordination was needed. Using a single shared number with "last write wins" would have reported 3 or 2.

CRDTs are used in Riak's data types, Redis Enterprise Active-Active databases and collaborative-editing libraries such as Automerge and Yjs. Amazon's Dynamo shopping cart (2007) used a related idea: divergent cart versions, detected with vector clocks, were merged by set union.

---

## In practice: use, don't build

| Tool | Role | Consensus algorithm |
|---|---|---|
| **etcd** | Key-value store, Kubernetes config | Raft |
| **Apache ZooKeeper** | Coordination, leader election | ZAB (Zookeeper Atomic Broadcast, Paxos-derived) |
| **Consul** | Service discovery, distributed locks | Raft |
| **Apache Kafka** | Distributed log, messaging | KRaft (Raft-based); ZooKeeper mode was removed in Kafka 4.0 (2025) |

The Kafka setup of [Hands-on 9](../../../hands-on/9/index.md) still runs a ZooKeeper container next to the broker; newer Kafka versions run the same coordination inside the brokers themselves with KRaft.

!!! warning "Pitfalls"
    - **Do not implement Paxos or Raft yourself** for an application. Delegate to a proven system: etcd, ZooKeeper, Consul, or the database (a `SELECT … FOR UPDATE`, a unique constraint, an advisory lock).
    - **Consensus is not free.** Every write waits for a majority round-trip and goes through a single leader, so consensus systems store small, critical data (configuration, leadership, locks) — not your product catalogue.
    - **A lock is not a guarantee.** A process holding a distributed lock can pause (garbage collection, VM migration) and wake up after its lease expired, while another process now holds the lock. Protect the resource with a *fencing token* (a number that increases with each lock grant and is checked by the storage).

---

## Connections

- [CAP Theorem](../cap/index.md) — consensus-based stores (etcd, ZooKeeper) are the classic CP systems.
- [Hands-on 5](../../../hands-on/5/index.md) — Kubernetes keeps its whole state in etcd, replicated with Raft.
- [Hands-on 9](../../../hands-on/9/index.md) and [Event-Driven Architecture](../../event_driven/index.md) — Kafka replicates partitions with a leader per partition.

## Key takeaways

- Consensus makes nodes agree on one value (or one log order) despite failures; it underlies leader election, locks and replicated state machines.
- **FLP**: in a fully asynchronous system no deterministic algorithm always terminates; real algorithms keep **safety** always and rely on timeouts for **liveness**.
- **Majorities** overlap, which prevents split brain; N nodes tolerate ⌊(N-1)/2⌋ crash failures, so use 3 or 5 nodes.
- **Raft**: randomised election timeouts, one leader per term, commit after a majority acknowledges; used by etcd, Consul and Kafka (KRaft).
- Quorums need **W + R > N**; AP systems converge with LWW, vector clocks or **CRDTs** with a commutative, idempotent merge.

---

[^1]: FISCHER, M.; LYNCH, N.; PATERSON, M. [Impossibility of Distributed Consensus with One Faulty Process](https://dl.acm.org/doi/10.1145/3149.214121){target="_blank"}. JACM, 1985.
[^2]: LAMPORT, L. [Paxos Made Simple](https://lamport.azurewebsites.net/pubs/paxos-simple.pdf){target="_blank"}. ACM SIGACT News, 2001.
[^3]: ONGARO, D.; OUSTERHOUT, J. [In Search of an Understandable Consensus Algorithm (Raft)](https://raft.github.io/raft.pdf){target="_blank"}. USENIX ATC, 2014.
[^4]: [Raft Visualization](https://raft.github.io/){target="_blank"} — interactive animation of leader election and log replication.
[^5]: [The Secret Lives of Data: Raft](https://thesecretlivesofdata.com/raft/){target="_blank"} — an engaging narrative visualization of Raft's mechanics and design decisions.
[^6]: SHAPIRO, M. et al. [Conflict-free Replicated Data Types](https://inria.hal.science/inria-00609399){target="_blank"}. SSS, 2011.
