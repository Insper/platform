A fan pays for two tickets at 10:00:41. The confirmation screen says *"Order 981 confirmed"*. She taps **My tickets** — and the list is empty. In a panic she buys again. Nothing was lost and nothing was buggy in the usual sense: the payment was written to the PostgreSQL **primary**, while *My tickets* was served by a **read replica** that had not yet received the write. BoxOffice had silently chosen a consistency model, and it was the wrong one for that screen.

This page explains how data is copied between nodes (**replication**) and what a reader is allowed to see while the copies disagree (**consistency models**). The two are inseparable: the replication design decides which consistency models are cheap, which are expensive and which are impossible.

---

## Why replicate?

Keeping a copy of the same data on several nodes serves three different goals, and it helps to say which one you want:

| Goal | How replication helps | BoxOffice |
|---|---|---|
| **Availability / durability** | If one node dies, another has the data | The `inventory` database survives the loss of a machine or a zone |
| **Read throughput** | Reads are spread over many copies | The event catalogue is read ~100× more than it is written (illustrative ratio) |
| **Latency** | A copy close to the user answers faster | A catalogue copy in a European region for fans in Lisbon |

All three are easy if the data never changes. The difficulty is entirely in **handling changes**: each write must reach every copy, and while it travels, the copies disagree.

---

## Replication models { #replication-models }

There are three families, distinguished by **who accepts writes**[^1].

### Single-leader (primary–replica)

One node, the **leader** (primary), accepts all writes and streams a log of changes to the **followers** (replicas). Reads can go to the leader or to followers. This is the default in PostgreSQL, MySQL, MongoDB, Redis and Kafka (one leader per partition).

``` mermaid-sim
flowchart LR
    w([order: write]) -->|"INSERT order 981"| L[("leader<br/>(primary)")]
    L -->|"WAL stream"| F1[("follower 1")]
    L -->|"WAL stream"| F2[("follower 2")]
    r1([My tickets: read]) -->|"SELECT"| F1
    r2([catalogue: read]) -->|"SELECT"| F2
```

### Multi-leader

Several nodes accept writes — typically one leader per data centre or region — and replicate to each other asynchronously. Writes are fast and local everywhere, but two leaders can accept **conflicting** writes to the same record, which must be resolved later. Typical uses: multi-region deployments, offline-first apps (each phone is a "leader"), collaborative editing.

### Leaderless

Any replica accepts reads and writes. The client (or a coordinator) sends each write to several replicas and each read to several replicas, and **quorums** decide what counts as success (`R + W > N`, see [Consensus & Quorums](../consensus/index.md#quorums)). This is the design of Amazon's Dynamo paper[^2], Cassandra and ScyllaDB.

| | Single-leader | Multi-leader | Leaderless |
|---|---|---|---|
| **Who accepts writes** | One leader | One leader per region/site | Any replica |
| **Write conflicts** | None (the leader orders writes) | Yes — must be resolved | Yes — must be resolved |
| **Write latency** | Round trip to the leader (maybe far away) | Local | Round trip to W replicas |
| **Leader failure** | Failover needed (seconds) | Other leaders continue | No leader to lose |
| **Strong consistency possible?** | Yes (read from leader, sync replication) | Not across leaders | Only approximately (quorums) |
| **Typical systems** | PostgreSQL, MySQL, MongoDB, Kafka partitions | Multi-region MySQL/Postgres setups, CouchDB, Active-Active Redis | Cassandra, ScyllaDB, Riak, DynamoDB (internally) |
| **BoxOffice use** | `inventory`, `order`, `payment` | — (avoid for seats!) | Fan activity, view counters |

### Synchronous or asynchronous?

Independently of who leads, the leader must decide **when to tell the client "OK"**:

``` mermaid-sim
sequenceDiagram
    participant C as order
    participant L as leader
    participant F1 as follower 1 (sync)
    participant F2 as follower 2 (async)
    C->>L: INSERT order 981
    L->>F1: replicate
    L->>F2: replicate
    F1-->>L: written to disk
    L-->>C: OK (after 1 sync follower)
    Note over F2: still applying...<br/>a read here is stale
    F2-->>L: written (later)
```

| Mode | Client gets OK when… | If the leader dies right after OK | Write latency | Availability of writes |
|---|---|---|---|---|
| **Asynchronous** | the leader wrote locally | Recent writes may be **lost** | Lowest | High: followers can be down |
| **Synchronous (all)** | every follower wrote | Nothing lost | Slowest follower decides | Low: any follower down blocks writes |
| **Semi-synchronous** | the leader + *k* followers wrote | Nothing lost if a sync follower is promoted | One extra round trip | Good: tolerates other followers down |
| **Quorum (consensus)** | a majority wrote | Nothing lost | Median of the fastest majority | Tolerates a minority down |

PostgreSQL exposes this choice in `synchronous_commit` and `synchronous_standby_names` (for example `ANY 1 (replica_a, replica_b)` — semi-synchronous with one of two). In practice, "fully synchronous" is rare: one slow follower would stall every write. Semi-synchronous or quorum replication is the usual compromise.

### Replication lag

With asynchronous followers, the delay between a write on the leader and its visibility on a follower is the **replication lag**. On a healthy system it is usually milliseconds; under heavy write load, during a long transaction or after a network hiccup, it can grow to seconds or minutes. The time between a write and a following read decides whether that read is stale:

```python exec="1" html="1"
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "xtick.color": "#888",
                     "ytick.color": "#888", "axes.edgecolor": "#888", "font.size": 10})

# Illustrative model: replication lag is exponentially distributed with a given mean.
# A read issued t ms after the write is stale if the replica has not applied it yet.
t = np.linspace(0, 2000, 400)            # ms between the write and the read
fig, ax = plt.subplots(figsize=(8, 3.6))
for mean, color, label in [(20, "#1e9e5a", "quiet day: mean lag 20 ms"),
                           (200, "#2f6fed", "busy: mean lag 200 ms"),
                           (800, "#e5484d", "10:00 on-sale: mean lag 800 ms")]:
    ax.plot(t, 100 * np.exp(-t / mean), color=color, lw=2, label=label)
ax.axvline(300, color="#888", lw=0.8, ls=":")
ax.text(310, 92, "fan opens 'My tickets'\n~300 ms after paying", fontsize=9)
ax.set_xlabel("time between the write (primary) and the read (replica), ms")
ax.set_ylabel("P(read is stale), %")
ax.set_ylim(0, 102)
ax.grid(alpha=0.25)
ax.legend(frameon=False, loc="upper right")
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True, bbox_inches="tight")
print(buf.getvalue())
plt.close()
```

With an (assumed) exponential lag, the same screen that is almost never stale on a quiet day is stale for about **69%** of fans who open it 300 ms after paying during the on-sale, when the mean lag grows to 800 ms. The bug of the opening story is not rare under load — it is the *expected* behaviour.

**Try it.** Load the `db-replicas` scenario, run the `load` profile and watch the replica lag metric. Then raise the write rate (or switch to `spike`) and see the lag — and the fraction of stale reads — grow. Finally route the reads to the primary and compare the primary's CPU and p99.

<div class="sdp" data-scenario="db-replicas" data-mode="compact" data-height="520"></div>

[:material-open-in-new: Open the full playground](../../../../playground/index.md)

---

## Consistency models: a contract { #models }

A **consistency model** is a contract between a data store and its programmers: *if you follow these rules, the results of reads will be predictable in this way*[^3]. Stronger models are easier to program against and cost more coordination (latency, availability); weaker models are cheaper and push the complexity into the application.

``` mermaid
flowchart TD
    LIN["Linearizable<br/>(strong consistency)"] --> SEQ["Sequential"]
    SEQ --> CAU["Causal"]
    CAU --> RYW["Read-your-writes"]
    CAU --> MR["Monotonic reads"]
    CAU --> CP["Consistent prefix"]
    RYW --> EV["Eventual"]
    MR --> EV
    CP --> EV
```

An arrow from A to B means "A guarantees everything B guarantees, and more". The three middle-row models are **session guarantees**: they hold for one client's session, not for everyone.

### Linearizability (strong consistency) { #linearizability }

**Linearizability** makes a replicated system behave **as if there were a single copy of the data**, and every operation took effect atomically at one instant between its start and its end[^4]. Once any read has returned a new value, every later read (by anyone, on any replica) must return that value or a newer one.

``` mermaid-sim
sequenceDiagram
    participant A as Fan A
    participant N1 as replica 1
    participant N2 as replica 2
    participant B as Fan B
    A->>N1: hold seat A-12
    N1-->>A: OK (hold committed)
    Note over A,B: the write has completed
    B->>N2: is seat A-12 free?
    N2-->>B: yes, FREE (stale)
    Note over N2,B: violates linearizability:<br/>B started after A's write finished
    B->>N2: hold seat A-12
    Note over N2: double booking if N2 accepts
```

Linearizability is what you need when correctness depends on **one up-to-date answer**:

- **uniqueness and inventory** — a seat, a username, the last unit of stock;
- **leader election and locks** — only one node may believe it is the leader;
- **cross-channel timing** — a fan pays, then the `notification` service (reading elsewhere) must see the paid order.

It is obtained by routing all reads and writes for a key through **one leader** that is itself elected by **consensus** (with care about stale leaders), or by consensus on every operation. Its price: every operation pays at least one round trip to the leader or to a majority, and nodes that cannot reach the leader/majority must refuse — the C-or-A choice of [CAP](../cap-pacelc/index.md).

!!! info "Serializable is not linearizable"
    **Serializability** is an *isolation* guarantee for transactions over many objects (the result equals some serial order of the transactions). **Linearizability** is a *recency* guarantee for single objects (reads see the latest write in real time). A database can offer one, both ("strict serializability", as in Spanner) or neither. Isolation levels are covered in [Databases — transactions](../../databases/transactions/index.md).

### Sequential consistency

All nodes see all operations in the **same order**, and each node's operations appear in its program order — but that order need not respect real time. A read may return a value that is "old" in wall-clock terms, as long as everyone agrees on the sequence. It is mainly a hardware-memory and theory concept; in system design you rarely choose it explicitly.

### Causal consistency { #causal }

Operations that are **causally related** — one could have influenced the other — are seen by everyone in that order; **concurrent** operations may be seen in different orders by different nodes.

The classic example is a conversation: if Ana posts *"Is the 10:00 sale delayed?"* and the organiser replies *"No, it starts on time"*, nobody may see the reply without the question. In BoxOffice: a `SeatReleased` event caused by a `HoldExpired` event must not be applied before it.

Causal consistency is interesting because it is the **strongest model that remains available during a network partition**[^5]: nodes can keep accepting reads and writes on both sides and still respect causality. It is tracked with logical clocks — see [Time & Clocks](../time-clocks/index.md#vector-clocks).

### Session guarantees { #session-guarantees }

Most "my data disappeared" bugs are violations of one of these four guarantees, defined for a single client session (Terry et al., Bayou project)[^6]:

| Guarantee | Promise | Violation in BoxOffice |
|---|---|---|
| **Read-your-writes** | After you write, your reads see that write | The opening story: you paid, *My tickets* is empty |
| **Monotonic reads** | You never see the data go back in time | Remaining seats shows 120, then 340, then 95 as you hit different replicas |
| **Monotonic writes** | Your writes are applied in the order you made them | "Change e-mail" then "send ticket" — the ticket goes to the old address |
| **Writes-follow-reads** (causal) | A write you make after reading X is ordered after X | You reply to a support message that other replicas have not received yet |

``` mermaid-sim
sequenceDiagram
    participant F as Fan's app
    participant R1 as replica 1 (lag 10 ms)
    participant R2 as replica 2 (lag 2 s)
    F->>R1: GET /events/42/availability
    R1-->>F: 95 seats left
    F->>R2: refresh (load balancer picks R2)
    R2-->>F: 340 seats left
    Note over F: the count went back in time:<br/>monotonic reads violated
```

How to provide them on top of asynchronous replicas:

- **Read from the leader after a write**: for a short window (e.g. 1–5 s) after the fan writes, route *her* reads to the primary — or always read data the user owns (*My tickets*) from the primary.
- **Version tokens**: the write returns the leader's log position (in PostgreSQL, the WAL LSN — Log Sequence Number); the client sends it with the next read, and a replica only answers once it has applied at least that position (otherwise it waits or forwards to the leader). Many databases expose this as *causal sessions* or *read-after-write tokens* (MongoDB causal consistency sessions, Cosmos DB session consistency).
- **Sticky replica**: pin each session to one replica (hash of the session id) — gives monotonic reads, not read-your-writes.

### Eventual consistency { #eventual }

**Eventual consistency** only promises that *if writes stop*, all replicas will **eventually converge** to the same value. It says nothing about *when*, and nothing about what you read meanwhile. It is the guarantee of DNS, of most caches and CDNs, of asynchronous replicas, and of leaderless stores at low quorum settings.

It is perfectly fine for many domains — the event description, the poster image, the "312 people are looking at this event" counter. The hard part is what happens when replicas accepted **concurrent writes** to the same item and must converge:

| Strategy | How | Trade-off |
|---|---|---|
| **Last-write-wins (LWW)** | Keep the write with the highest timestamp | Simple; **silently drops** concurrent writes and depends on clocks that drift ([Time & Clocks](../time-clocks/index.md#lww)) |
| **Version vectors / siblings** | Detect concurrent versions, keep all, let the application merge | No silent loss; the application must write merge logic (Dynamo's shopping cart merged by union) |
| **CRDTs** | Data types whose merge is commutative, associative and idempotent | Automatic, provably convergent; only for data that fits a CRDT (counters, sets, registers, text) |
| **Avoid conflicts** | Route all writes for a key to one leader (a "home" region) | No conflicts at all; that key's writes pay the latency to its home |

A **CRDT** (Conflict-free Replicated Data Type)[^7] is designed so that replicas can exchange state in any order, any number of times, and still end up equal. The simplest is the grow-only counter: each replica increments only its own slot, and merge takes the element-wise maximum.

```java title="GCounter.java"
// Grow-only counter CRDT: e.g. "fans interested in event 42", counted in 3 regions
class GCounter {
    private final long[] counts;   // one slot per replica
    private final int me;          // this replica's index

    GCounter(int replicas, int me) { this.counts = new long[replicas]; this.me = me; }

    void increment() { counts[me]++; }

    long value() { return java.util.Arrays.stream(counts).sum(); }

    // merge = element-wise max: commutative, associative, idempotent
    void merge(GCounter other) {
        for (int i = 0; i < counts.length; i++)
            counts[i] = Math.max(counts[i], other.counts[i]);
    }
}
```

If São Paulo counted `[3, 0, 0]` and Lisbon `[0, 2, 0]`, both merge to `[3, 2, 0]` and report 5 — no increment lost, no coordination needed. A single shared number with LWW would report 3 or 2.

---

## The spectrum at a glance

| Model | Guarantee | Coordination cost | Available during a partition? | Typical implementation |
|---|---|---|---|---|
| **Linearizable** | Single-copy, real-time recency | Highest: leader or majority round trip per operation | No (minority side must refuse) | Raft/Paxos-based stores (etcd, Spanner, CockroachDB), single leader with reads at the leader |
| **Sequential** | One global order for all | High | No | Mostly theory / hardware memory models |
| **Causal** | Cause before effect, for everyone | Medium: track dependencies | **Yes** | Logical/vector clocks, causal sessions |
| **Read-your-writes, monotonic reads** | Per-session sanity | Low: route or wait per session | Yes, if the session stays on its side | Leader reads after write, LSN tokens, sticky replicas |
| **Eventual** | Converge if writes stop | Lowest | Yes | Async replication, caches, DNS, leaderless at `ONE` |

!!! example "BoxOffice: one consistency model per data domain"
    | Data | Model | Why | How |
    |---|---|---|---|
    | Seat status and holds | **Linearizable** | Two fans must never hold the same seat | Single PostgreSQL primary per event; conditional `UPDATE`/`SELECT … FOR UPDATE` |
    | Payments | **Linearizable** + idempotent | A double charge is unacceptable | Primary only; idempotency key forwarded to the provider |
    | *My tickets*, *My orders* | **Read-your-writes** | The fan must see what she just bought | Read from the primary for the fan's own data, or LSN token |
    | Remaining-seats counter on the event page | **Monotonic reads** (eventual is tolerable) | It may lag, but must not jump backwards | Sticky replica or cache with a short TTL |
    | Event catalogue, images, descriptions | **Eventual** | Seconds of staleness hurt nobody | Replicas, cache, CDN |
    | "Fans interested" counters, analytics | **Eventual** (CRDT) | Approximate is fine, availability matters | Per-region counters merged |

    The design principle: **strong where money or uniqueness is at stake, weak everywhere else** — because strong consistency is paid on every request.

!!! tip "In the interview"
    When the interviewer says "and the user should see their update immediately", translate it into a model: *"that's read-your-writes, not global strong consistency — I'll read the user's own data from the leader, or pass the write's log position as a token."* Then name the one place that **does** need linearizability (inventory, balances, uniqueness) and explain how you get it (single leader + consensus-based failover, conditional writes). Interviewers reward precise vocabulary and a per-domain choice; they penalise "everything is strongly consistent" (slow, expensive) and "everything is eventually consistent" (double bookings).

!!! warning "Pitfalls"
    - **Read/write split by default**: sending *all* reads to replicas breaks read-your-writes on the first screen after a write.
    - **Caches are replicas too**: putting Redis or a CDN in front of a linearizable store makes those reads eventually consistent ([Caching](../../caching/index.md)).
    - **Load balancers break session guarantees**: two consecutive reads may hit two different replicas with different lag.
    - **Async replication + automatic failover = lost writes**: the promoted follower may not have the last acknowledged writes. Use semi-synchronous replication for data you cannot lose.
    - **Confusing "eventual" with "soon"**: eventual consistency has no time bound; under load the lag can reach minutes. Monitor replication lag and alert on it.

## How it connects { #how-it-connects }

``` mermaid
flowchart LR
    W["write on the leader"] --> REPL{"replication<br/>sync or async?"}
    REPL -->|"sync / quorum"| LIN["linearizable reads"]
    LIN --> COST["pays latency and availability<br/>→ CAP & PACELC"]
    REPL -->|"async: lag"| STALE["stale reads"]
    STALE --> SG["session guarantees<br/>read-your-writes, monotonic reads"]
    W2["writes on several leaders"] --> CONF["concurrent writes"]
    CONF --> RES["LWW · version vectors · CRDTs<br/>→ Time & Clocks"]
    LIN --> CONS["leader chosen by consensus<br/>→ Consensus & Quorums"]
```

**Palette components that are replicas (and therefore have a consistency model):** [`sql`](../../../reference/components/storage/index.md#sql) (primary + read replicas, scenario `db-replicas`) · [`nosql`](../../../reference/components/storage/index.md#nosql) (leaderless, scenario `sharding`) · [`cache`](../../../reference/components/storage/index.md#cache) (scenario `read-heavy-cache`) · [`cdn`](../../../reference/components/edge/index.md#cdn) (scenario `cdn-static`) · [`stream`](../../../reference/components/messaging/index.md#stream) (replicated partitions). **Builds on:** [failure models](../index.md#failure-models). **Continues in:** [CAP & PACELC](../cap-pacelc/index.md), [Databases — replication](../../databases/replication/index.md), [Caching — invalidation](../../caching/invalidation/index.md).

## Key takeaways

- **Replication** serves availability, read throughput and latency; all the difficulty is in propagating **writes**.
- **Single-leader** avoids write conflicts; **multi-leader** and **leaderless** accept writes everywhere and must resolve conflicts (LWW, version vectors, CRDTs, or avoid them with a home leader).
- **Synchronous vs asynchronous** replication trades write latency and availability for durability on failover; semi-synchronous or quorum is the usual compromise.
- **Consistency models** range from **linearizable** (single-copy illusion) through **causal** and **session guarantees** (read-your-writes, monotonic reads) to **eventual**.
- Choose **per data domain**: linearizable for seats and money, read-your-writes for a user's own data, eventual for the catalogue and counters.

---

[^1]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2nd ed. O'Reilly. Chapter "Replication".
[^2]: DECANDIA, G. et al. [Dynamo: Amazon's Highly Available Key-value Store](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf){target="_blank"}. SOSP, 2007.
[^3]: [Consistency Models](https://jepsen.io/consistency){target="_blank"} — Jepsen (Kyle Kingsbury), a clickable map of the models and their relationships.
[^4]: HERLIHY, M.; WING, J. [Linearizability: A Correctness Condition for Concurrent Objects](https://dl.acm.org/doi/10.1145/78969.78972){target="_blank"}. ACM TOPLAS, 1990.
[^5]: MAHAJAN, P.; ALVISI, L.; DAHLIN, M. [Consistency, Availability, and Convergence](https://www.cs.utexas.edu/users/dahlin/papers/cac-tr.pdf){target="_blank"}. UT Austin TR-11-22, 2011.
[^6]: TERRY, D. et al. [Session Guarantees for Weakly Consistent Replicated Data](https://www.cs.utexas.edu/users/dahlin/Classes/GradOS/papers/SessionGuaranteesPDIS.pdf){target="_blank"}. PDIS, 1994.
[^7]: SHAPIRO, M. et al. [Conflict-free Replicated Data Types](https://inria.hal.science/inria-00609399){target="_blank"}. SSS, 2011.
