At 10:00:03, three seconds into the on-sale, the machine running the PostgreSQL **primary** of `inventory` freezes. Its synchronous standby is healthy. Someone — or something — must decide that the old primary is dead, promote the standby, and make every `inventory` replica write to the new one. Now imagine the old primary was not dead, only paused for eight seconds by a storage hiccup: it wakes up, still believes it is the primary, and accepts a hold on seat A-12 that the new primary has already given to someone else. Two primaries at once is called **split brain**, and in a ticketing system it means double-sold seats.

Deciding "who is the primary now" is an instance of the **consensus** problem: getting a group of nodes to **agree on a single value** — despite lost and delayed messages and despite some nodes failing. Consensus is the foundation of leader election, distributed locks, replicated configuration (etcd behind every Kubernetes cluster), and of every strongly consistent replicated database.

---

## Consensus and replicated state machines

The most useful form of consensus is agreeing on a **log**: an ordered sequence of commands. If every node starts in the same state and applies the same commands in the same order, every node ends in the same state — a **replicated state machine**:

``` mermaid
flowchart LR
    C([clients]) --> L
    subgraph L["leader"]
        LL["log: hold A-12 · hold B-3 · release A-12"] --> LS[("state")]
    end
    subgraph F1["follower 1"]
        F1L["same log"] --> F1S[("same state")]
    end
    subgraph F2["follower 2"]
        F2L["same log"] --> F2S[("same state")]
    end
    L -->|"replicate entries"| F1
    L -->|"replicate entries"| F2
```

A correct consensus algorithm guarantees:

**Safety** — "nothing bad happens"
: All nodes that decide, decide the **same** value (the same log entry at each position), and that value was proposed by someone.

**Liveness** — "something good eventually happens"
: Non-faulty nodes **eventually** decide.

### Why it is hard: FLP

The **FLP impossibility result** (Fischer, Lynch and Paterson, 1985)[^1] proves that in a fully **asynchronous** system — no bound on message delay — no deterministic algorithm can guarantee consensus if even **one** node may crash: some unlucky schedule of delays keeps it undecided forever. The way out, used by Paxos and Raft, is to **never compromise safety** and to guarantee progress only when the network behaves "well enough" (partial synchrony), using **timeouts** to suspect failures. A timeout can be wrong (the node was just slow), which is why the algorithms must remain safe even when suspicions are false.

---

## Majorities: why clusters have 3 or 5 nodes { #majorities }

The central trick is the **majority quorum**: a decision is valid only if more than half of the N nodes accept it. **Any two majorities of the same cluster share at least one node** — so two conflicting decisions can never both gather a majority: the shared node would have to vote for both, and the protocol forbids it.

| Cluster size N | Majority ⌊N/2⌋ + 1 | Failures tolerated ⌊(N−1)/2⌋ |
|---|---|---|
| 1 | 1 | 0 |
| 2 | 2 | 0 |
| 3 | 2 | **1** |
| 4 | 3 | 1 |
| 5 | 3 | **2** |
| 7 | 4 | 3 |

!!! tip "Use an odd number of nodes"
    Going from 3 to 4 nodes adds cost and one more machine that can fail, but tolerates **no extra failure**. A 2-node cluster is worse than one node: losing **either** node stops it. That is why etcd, ZooKeeper, Consul and Kafka controller quorums are sized 3 or 5 — and spread across 3 availability zones so that losing one zone leaves a majority.

What does the majority buy in availability? If each node is up with probability $a$ (independently), the cluster is up when at least a majority is:

$$
A_{cluster}(N) = \sum_{k=\lfloor N/2 \rfloor + 1}^{N} \binom{N}{k}\, a^{k} (1-a)^{N-k}
$$

```python exec="1" html="1"
import matplotlib.pyplot as plt
import numpy as np
from math import comb
from io import StringIO

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "xtick.color": "#888",
                     "ytick.color": "#888", "axes.edgecolor": "#888", "font.size": 10})

def cluster_up(n, a):
    """P(a majority of n independent nodes is up), each node up with probability a."""
    need = n // 2 + 1
    return sum(comb(n, k) * a**k * (1 - a)**(n - k) for k in range(need, n + 1))

a = np.linspace(0.90, 0.999, 200)
fig, ax = plt.subplots(figsize=(8, 3.8))
for n, color in [(1, "#888888"), (2, "#e5484d"), (3, "#2f6fed"), (5, "#1e9e5a"), (7, "#f59e0b")]:
    nines = -np.log10(1 - np.array([cluster_up(n, x) for x in a]))
    ax.plot(100 * a, nines, color=color, lw=2, label=f"N = {n}")
ax.set_xlabel("availability of each node, %")
ax.set_ylabel("cluster availability, in nines")
ax.grid(alpha=0.25)
ax.legend(frameon=False, loc="upper left")
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True, bbox_inches="tight")
print(buf.getvalue())
plt.close()
```

With nodes at 99% each, one node gives 2 nines, **two nodes give less** (98.01% — both must be up), three nodes give ≈ 99.97% and five ≈ 99.999%. The independence assumption is optimistic — nodes in the same zone, on the same version, or overloaded by the same traffic fail together — which is why the nodes are spread over failure domains.

### Split brain, and why the majority prevents it

A partition splits a 5-node cluster 3/2. Only the side with 3 nodes can form a majority, elect a leader and commit writes; the side with 2 knows it is a minority and stops accepting writes:

``` mermaid-sim
flowchart LR
    subgraph maj ["Majority side (3 of 5)"]
        n1[node 1: leader] --- n2[node 2]
        n2 --- n3[node 3]
    end
    subgraph min ["Minority side (2 of 5)"]
        n4[node 4] --- n5[node 5]
    end
    n3 -.-|partition| n4
    maj -->|"can elect and commit"| ok([keeps selling seats])
    min -->|"cannot reach 3 votes"| ko([rejects writes: 503])
```

This is exactly the CP behaviour of [CAP](../cap-pacelc/index.md): the minority side is unavailable, so the system stays consistent.

---

## Raft { #raft }

Raft (Ongaro and Ousterhout, 2014)[^2] was designed to be **understandable**, and it is the consensus algorithm you are most likely to meet: etcd (Kubernetes), Consul, CockroachDB, TiKV, YugabyteDB and Kafka's KRaft controller all use it. It splits the problem into three parts:

1. **Leader election** — exactly one leader per term; all writes go through it.
2. **Log replication** — the leader appends commands to its log and replicates them to followers.
3. **Safety** — an entry acknowledged by a majority (committed) is never lost or overwritten.

### Roles and terms

Each node is a **follower**, a **candidate** or the **leader**. Time is divided into **terms** numbered 1, 2, 3…, each starting with an election; a term has **at most one leader**. Terms act as a logical clock ([Time & Clocks](../time-clocks/index.md#lamport)): any node that sees a message with a higher term than its own updates its term and steps down to follower — which is how a stale leader that wakes up after a pause discovers it has been replaced.

``` mermaid-sim
stateDiagram-v2
  [*] --> Follower
  Follower --> Candidate : election timeout (no heartbeat)
  Candidate --> Leader : votes from a majority
  Candidate --> Follower : sees a leader or a higher term
  Candidate --> Candidate : split vote, new timeout
  Leader --> Follower : sees a higher term
```

### Leader election

The leader sends periodic **heartbeats** (empty `AppendEntries` messages). A follower that hears nothing for an **election timeout** assumes the leader is dead, increments the term, votes for itself and asks the others for votes:

``` mermaid-sim
sequenceDiagram
  participant N1 as node 1 (follower)
  participant N2 as node 2 (follower)
  participant N3 as node 3 (old leader, frozen)
  Note over N1,N3: term 4: node 3 stops sending heartbeats
  N1->>N1: election timeout: term 5, candidate, votes for itself
  N1->>N2: RequestVote(term 5, last log index 812, term 4)
  N1->>N3: RequestVote(term 5, ...)
  N2-->>N1: vote granted (my log is not newer than yours)
  Note over N1: 2 of 3 votes: leader of term 5
  N1->>N2: AppendEntries(term 5, heartbeat)
  N1->>N3: AppendEntries(term 5, heartbeat)
  Note over N3: wakes up, sees term 5 > 4: steps down to follower
```

Three rules make it safe:

- **One vote per node per term** — so at most one candidate can collect a majority in a term.
- **Election restriction** — a node only votes for a candidate whose log is **at least as up-to-date** as its own. Since every committed entry is on a majority, and the winner needs votes from a majority, the new leader is guaranteed to hold every committed entry.
- **Randomised election timeouts** (the paper suggests 150–300 ms) — if all followers timed out together they would split the votes forever; with random timeouts, one usually fires first and wins before the others start.

How long are writes unavailable when a leader dies? Roughly **election timeout + one round of voting**. etcd's defaults are a 100 ms heartbeat and a 1,000 ms election timeout[^3] (tuned up for cross-zone latency), so a crashed leader means about one to two seconds without writes — a number to remember when a client's timeout is shorter than that.

### Log replication { #log-replication }

``` mermaid-sim
sequenceDiagram
  participant C as inventory
  participant L as leader
  participant F1 as follower 1
  participant F2 as follower 2
  C->>L: hold A-12 for fan 42
  L->>L: append to log at index 813 (term 5)
  L->>F1: AppendEntries(index 813, prev = 812/term 4)
  L->>F2: AppendEntries(index 813, prev = 812/term 4)
  F1-->>L: OK (written to disk)
  Note over L: 2 of 3 have it: committed, apply to state
  L-->>C: OK, seat held
  F2-->>L: OK (later)
  L->>F1: next heartbeat carries commit index 813
```

- The leader answers the client only after a **majority** (counting itself) has **durably** written the entry: committed entries survive the loss of any minority.
- Each `AppendEntries` carries the index and term of the previous entry; a follower rejects it if its log does not match there, and the leader walks back until the logs agree, then overwrites the follower's uncommitted divergent suffix. This **log matching** keeps all logs identical up to the commit index.
- Followers learn the **commit index** from later messages and apply entries to their own state machine.

!!! info "Reads in Raft are not free either"
    A leader that answers reads from its local state might be a **stale** leader that has not yet noticed a newer term. Linearizable reads must confirm leadership — by a round of heartbeats to a majority (etcd's *ReadIndex*) or by a time-based **leader lease**, which depends on bounded clock drift. Serving reads from followers is faster but only eventually consistent, unless the follower first asks the leader for the current commit index.

??? question "Think first: a 5-node etcd cluster spread over 3 zones (2 + 2 + 1). Zone A, with 2 nodes, goes down. Can the cluster still accept writes? And if it were 3 + 1 + 1 and the 3-node zone failed?"

    In the first case, 3 nodes remain — a majority of 5 — so yes: a new leader is elected (if needed) and writes continue. In the second case only 2 nodes remain, which is **not** a majority of 5, so the cluster stops accepting writes, even though 2 machines are perfectly healthy. Placement matters as much as N: with 3 zones, spread as evenly as possible so that **no single zone holds a majority**.

### Paxos, in one paragraph

**Paxos** (Lamport, 1989/1998; "Paxos Made Simple", 2001)[^4] is the original consensus algorithm with the same guarantees. Its single-decree form agrees on one value in two phases (*prepare/promise*, then *accept/accepted*) among proposers and acceptors with numbered ballots; production systems run **Multi-Paxos** — a stable leader skipping the first phase — which looks a lot like Raft. Paxos is proven and widely deployed (Google's Chubby and Spanner), but famously hard to implement; Raft's contribution was not new guarantees but a structure that engineers can follow. ZooKeeper uses a related protocol, ZAB (ZooKeeper Atomic Broadcast).

---

## Quorums in leaderless stores: R + W > N { #quorums }

Leaderless databases in the Dynamo family (Cassandra, ScyllaDB, Riak) use quorums **per request**, without a leader. With **N** replicas of each key, a write waits for **W** acknowledgements and a read queries **R** replicas and keeps the newest version:

| Parameter | Meaning |
|---|---|
| **N** | Number of replicas of each key |
| **W** | Replicas that must acknowledge a write |
| **R** | Replicas that must answer a read |
| **Overlap condition** | **R + W > N** — every read set intersects every write set |

When **R + W > N**, at least one replica in any read set holds the latest acknowledged write. With **N = 3**:

| Setting | W | R | R + W > N? | Behaviour |
|---|---|---|---|---|
| write `ONE`, read `ONE` | 1 | 1 | No | Fastest; reads may be stale; available with 2 nodes down |
| write `QUORUM`, read `QUORUM` | 2 | 2 | **Yes** | Reads see the latest acknowledged write; tolerates 1 node down |
| write `ALL`, read `ONE` | 3 | 1 | Yes | Fast reads, but one node down blocks every write |
| write `ONE`, read `ALL` | 1 | 3 | Yes | Fast writes, but one node down blocks every read |

Three mechanisms make leaderless replicas converge: **read repair** (a read that sees an old version writes back the newest), **hinted handoff** (a write meant for a dead node is held by another and delivered later — a *sloppy quorum* that breaks the overlap guarantee meanwhile), and **anti-entropy** (background comparison of replicas using Merkle trees)[^5].

!!! warning "R + W > N is necessary, not sufficient"
    The overlap guarantees that a read *contacts* a replica with the latest write. It does not make the store linearizable: concurrent writes, a write that reached fewer than W replicas and was reported as failed (but stays on some), sloppy quorums and LWW with skewed clocks all produce anomalies. Quorum stores offer **tunable** consistency, not consensus. Use a consensus-based store when you need a single agreed order.

---

## Leases, locks and fencing tokens { #fencing }

A common use of consensus is a **distributed lock** or **lease**: "only one `scheduler` replica sends the 09:55 *on-sale starts soon* push". You take a lease from etcd/ZooKeeper/Consul with a time-to-live and renew it while you are alive. But a lock holder can **pause** — a long garbage collection, a VM migration — and keep working after its lease expired and someone else took it[^6]:

``` mermaid-sim
sequenceDiagram
    participant A as worker A
    participant LK as lock service (etcd)
    participant B as worker B
    participant S as storage
    A->>LK: acquire lease
    LK-->>A: granted, fencing token 33
    Note over A: GC pause 15 s: lease expires
    B->>LK: acquire lease
    LK-->>B: granted, fencing token 34
    B->>S: write (token 34)
    S-->>B: OK, highest token seen = 34
    Note over A: wakes up, still thinks it holds the lock
    A->>S: write (token 33)
    S-->>A: rejected: 33 < 34
```

The fix is a **fencing token**: a number that increases with every grant (etcd's revision, ZooKeeper's `zxid`), sent with every write; the storage rejects any token lower than the highest it has seen. The same idea — a monotonically increasing *epoch* or *term* — protects the PostgreSQL failover of the opening story: the old primary, fenced off (its writes rejected, or its machine forcibly isolated — "STONITH", *shoot the other node in the head*), cannot corrupt the new one.

```sql title="fenced-write.sql"
-- The storage enforces the fence: a write carrying an old token changes nothing
UPDATE scheduled_jobs
   SET last_run_at = now(), fencing_token = :token
 WHERE job_id = 'onsale-reminder-42'
   AND fencing_token <= :token;     -- 0 rows updated → a newer token exists: we are a stale holder
```

---

## In practice: use, don't build

| Tool | What you use it for | Consensus |
|---|---|---|
| **etcd** | Kubernetes state, leader election, config, locks | Raft |
| **Apache ZooKeeper** | Coordination for older Hadoop/Kafka-era systems | ZAB |
| **Consul** | Service discovery, KV config, locks | Raft |
| **Kafka (KRaft)** | Cluster metadata and controller election; ZooKeeper mode removed in Kafka 4.0 | Raft-based |
| **Patroni** (for PostgreSQL) | Automatic primary failover, with leader key in etcd/Consul/ZooKeeper | Delegates to the DCS |
| **Spanner, CockroachDB, YugabyteDB, TiDB** | SQL with consensus per data range | Paxos (Spanner) / Raft |

!!! example "BoxOffice: who is the primary?"
    The `inventory` PostgreSQL runs under **Patroni**, with a 3-node **etcd** cluster spread across 3 availability zones. The primary holds a **leader key** in etcd with a TTL of ~30 s (Patroni's default), renewed every ~10 s. If it stops renewing — crash, freeze, network loss — the key expires, the healthiest synchronous standby takes it (an atomic compare-and-set in etcd: only one can win), promotes itself, and clients follow the new leader through the service endpoint. An old primary that wakes up finds it no longer holds the key and **demotes itself** (Patroni can also use a watchdog to reset the machine). The seat decision itself stays a plain `UPDATE … WHERE status = 'FREE'` on the single primary — consensus is used **only** to decide which node that is.

!!! tip "In the interview"
    Use consensus as a **component**, not a topic to re-derive. Say: *"leader election and the cluster metadata go in etcd/ZooKeeper (Raft, 3 or 5 nodes across 3 zones); the data path stays on a single leader per shard."* Know the numbers: N nodes tolerate ⌊(N−1)/2⌋ failures; a leader failover costs about an election timeout (~1 s in etcd defaults); every committed write pays a majority round trip. If you mention locks, mention **fencing tokens** — it is the follow-up question that separates candidates.

!!! warning "Pitfalls"
    - **Implementing Paxos or Raft yourself** for an application. Use etcd, ZooKeeper, Consul, or the database's own guarantees (a unique constraint, `SELECT … FOR UPDATE`, an advisory lock).
    - **Putting bulk data through consensus.** Every write goes through one leader and waits for a majority; consensus stores hold small, critical data (leaders, config, locks) — not the catalogue.
    - **Even-sized clusters and bad placement**: 4 nodes tolerate what 3 do; a zone that holds a majority is a single point of failure.
    - **Locks without fencing**: a paused process will eventually write after losing its lease.
    - **Client timeouts shorter than a failover**: a 500 ms client timeout against a store that needs ~1–2 s to elect a leader turns every failover into a burst of errors (and retries).

## How it connects { #how-it-connects }

``` mermaid
flowchart LR
    MAJ["majority quorums<br/>no split brain"] --> RAFT["Raft / Paxos<br/>replicated log"]
    RAFT --> ETCD["etcd · ZooKeeper · KRaft"]
    ETCD --> LE["leader election<br/>(DB failover, scheduler)"]
    ETCD --> LOCK["leases & locks"]
    LOCK --> FT["fencing tokens"]
    RAFT --> NEWSQL["Spanner · CockroachDB<br/>(consensus per range)"]
    NEWSQL --> TX2["2PC over consensus groups<br/>→ Distributed Transactions"]
    Q["R + W > N<br/>leaderless quorums"] --> TUNE["tunable consistency<br/>(Cassandra, Dynamo)"]
    TERMS["terms / epochs"] --> FT
    TERMS -.-> CLK["logical clocks<br/>→ Time & Clocks"]
```

**Palette components that rely on consensus:** [`kafka`](../../../reference/components/messaging/index.md#kafka) (KRaft controller, partition leaders) · [`sql`](../../../reference/components/storage/index.md#sql) (Patroni + etcd failover) · [`nosql`](../../../reference/components/storage/index.md#nosql) (quorums) · [`scheduler`](../../../reference/components/compute/index.md#scheduler) (one leader runs the jobs). **Continues in:** [Distributed Transactions](../transactions/index.md), [Cloud-native — Kubernetes](../../cloud-native/kubernetes/index.md) (etcd), [Compute — async work](../../compute/async-work/index.md) (scheduler leader election).

## Key takeaways

- **Consensus** makes nodes agree on one value — in practice, one **log** — despite failures; it underlies leader election, locks, configuration and strongly consistent databases.
- **FLP**: no deterministic algorithm always terminates in an asynchronous system; Paxos and Raft are always **safe** and use timeouts for **liveness**.
- **Majorities overlap**: N nodes tolerate ⌊(N−1)/2⌋ crashes; use 3 or 5, spread so no zone holds a majority; the minority side of a partition stops (no split brain).
- **Raft**: terms, randomised election timeouts, one vote per term, election restriction, commit after a majority writes.
- **Leaderless quorums** need **R + W > N** for overlap, but give tunable consistency, not linearizability.
- Leases need **fencing tokens**; and above all: **use** a proven coordination service, don't build one.

---

[^1]: FISCHER, M.; LYNCH, N.; PATERSON, M. [Impossibility of Distributed Consensus with One Faulty Process](https://dl.acm.org/doi/10.1145/3149.214121){target="_blank"}. Journal of the ACM, 1985.
[^2]: ONGARO, D.; OUSTERHOUT, J. [In Search of an Understandable Consensus Algorithm](https://raft.github.io/raft.pdf){target="_blank"}. USENIX ATC, 2014. Interactive visualisation: [raft.github.io](https://raft.github.io/){target="_blank"}.
[^3]: ETCD. [Tuning](https://etcd.io/docs/v3.5/tuning/){target="_blank"} — heartbeat interval and election timeout.
[^4]: LAMPORT, L. [Paxos Made Simple](https://lamport.azurewebsites.net/pubs/paxos-simple.pdf){target="_blank"}. ACM SIGACT News, 2001.
[^5]: DECANDIA, G. et al. [Dynamo: Amazon's Highly Available Key-value Store](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf){target="_blank"}. SOSP, 2007.
[^6]: KLEPPMANN, M. [How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html){target="_blank"}, 2016.
