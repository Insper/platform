---
marp: true
lang: en
title: Distributed Systems
description: Platforms, Microservices, DevOps and APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Platforms, Microservices, DevOps and APIs · Insper</div>

# Distributed Systems

**Many independent machines that must look like one**

<!--
Objectives: explain what makes a system distributed and the three root problems; identify the 8 fallacies in a
call between two services; order events with Lamport clocks; choose C or A with CAP and PACELC; describe Raft
and size a cluster; compare quorums and consensus with eventual consistency (LWW, vector clocks, CRDTs).
Outline: (1) overview: the store, classification, gains and costs, fallacies, the three root problems, logical clocks;
(2) CAP and PACELC; (3) consensus: FLP, failure models, majorities, Paxos, Raft, quorums, CRDTs, use don't build.
-->

---

## From one machine to many

<div class="q">

The store as **one** Spring Boot application with **one** PostgreSQL on **one** machine is simple to reason about. What happens when traffic outgrows it, or the machine dies?

</div>

* Split the work: gateway, account, order, database, cache, message broker…
* …and you have built a **distributed system**: independent **nodes** that cooperate only by **passing messages**, with **no shared clock**, and look like **one coherent system** to the user.
* A new class of problems appears.

---

## Our store is a distributed system

One click on **Place order** crosses the network several times:

Browser → `POST /orders` → **Gateway** → Auth (validate token) · Gateway → **Order** → Product → Redis (cached price) · Order → **PostgreSQL** (`INSERT`) · Order → **Kafka** (`OrderCreated`)

- Each arrow is a **message** over the network; each box is a process that can **fail on its own**.
- Product slow → order waits. Kafka down → the order may be stored but the event never published.
- Nothing shares memory or a clock: exactly the definition of a distributed system.

---

## Classification

| Dimension | Option A | Option B |
|---|---|---|
| **Uniformity** | Homogeneous: all nodes run the same stack | **Heterogeneous**: diverse hardware and OS |
| **Coupling** | Tightly coupled: shared memory | **Loosely coupled**: messages, independent lifecycle |
| **Topology** | **Client-server**: servers hold resources | Peer-to-peer: all nodes share resources (BitTorrent) |

<div class="ok">

The store is **heterogeneous** (Java services, a Python notification service, PostgreSQL, Redis, Kafka), **loosely coupled** (HTTP and Kafka) and **client-server** (browser → gateway → services).

</div>

---

## What we gain, what we pay

<div class="cols">
<div>

### Advantages

- **Horizontal scalability**: add nodes (Cassandra)
- **Fault tolerance**: replication (Spanner)
- **Resource sharing**: pooled capacity (Folding@home)
- **Parallelism**: MapReduce (Hadoop)
- **Latency reduction**: nodes near users (CDNs)

</div>
<div>

### Disadvantages

- **Complexity**: coordination, distributed state
- **Network overhead**: delayed, lost, duplicated messages
- **Consistency vs availability** (CAP)
- **Expanded attack surface**: Byzantine faults
- **Operational cost**: Prometheus, Kubernetes, tracing

</div>
</div>

<p class="small">In the store: horizontal scaling with Nginx in front of replicas (Hands-on 7); lower latency with the Redis cache (Hands-on 8).</p>

---

<!-- _class: tight -->

## The 8 fallacies of distributed computing

Deutsch and colleagues at Sun (seven in 1994; Gosling added the eighth in 1997) — **all of them false**:

| Fallacy | In the store |
|---|---|
| The network is reliable | the call from order to product fails halfway |
| Latency is zero | five sequential calls of 40 ms make a 200 ms checkout |
| Bandwidth is infinite | returning the whole catalogue in one response |
| The network is secure | services trust any caller inside the cluster |
| Topology doesn't change | a Kubernetes pod is rescheduled with a new IP |
| There is one administrator | another team changes a firewall rule |
| Transport cost is zero | JSON parsing and cross-zone traffic on the cloud bill |
| The network is homogeneous | Java services, a Python service, Kafka's binary protocol |

<div class="warn">

Common root: treating the network as a **reliable local function call**. Design **for** failure: assume it will happen and degrade gracefully.

</div>

---

## The three root problems

Almost every difficulty in this course traces back to three facts:

1. **Partial failure** — part of the system fails while the rest keeps running: product is down, gateway and order are fine. Each component must decide what to do when a dependency stops answering.
2. **An unreliable network** — a caller cannot tell **slow** from **dead**.
3. **No global clock** — clocks drift; you cannot order events on different machines by their timestamps.

---

## Slow or dead?

Order → Product: *reserve 1 unit of product 42* … **silence**.

- Request lost? Product crashed? Reply lost? Product just slow? **They all look the same.**
- The only practical tool: a **timeout** — after a deadline, assume failure.
- But a timeout does not say whether the operation ran: a retry may apply it **twice**.
- So retried operations must be **idempotent**: applying twice = applying once (e.g. a unique request id the server deduplicates).

<div class="ok">

Timeouts, retries with backoff and circuit breakers: **Resilience Patterns** (Reliability class).

</div>

---

## No global clock

- Each machine has its own quartz clock, and clocks **drift**.
- Two servers synchronised with NTP can still disagree by milliseconds — much more after a misconfiguration or a VM pause.
- An order created "at 10:00:00.120" on one node may have happened **after** a cancellation stamped "10:00:00.150" on another.

<div class="warn">

Do not order events by `System.currentTimeMillis()` across machines: in "last write wins", a node with a fast clock silently wins every conflict. Use a **single authority** (a database sequence, a Kafka partition offset) or **logical clocks**.

</div>

---

<!-- _class: tight -->

## Logical clocks (Lamport)

We need the **order** of events, not their real time: *happened-before* (→) — same process, message send → receive, transitivity. Neither → the other: **concurrent**.

<div class="cols">
<div>

**Lamport clock**, one counter per process:

1. increment before each local event;
2. attach the counter to every message;
3. on receive *t*: `max(local, t) + 1`.

</div>
<div>

**Example**

- Order: create order (1), send `OrderCreated` (2)
- Consumer: receive → `max(0,2)+1 = 3`, send `SendEmail` (4)
- Notification: local event (1), receive → `max(1,4)+1 = 5`

</div>
</div>

- Guarantee: if *a* → *b* then L(*a*) < L(*b*) — **not** the converse.
- **Vector clocks** (one counter per process) tell "happened before" from "concurrent": conflict detection in replicated databases.

<p class="small">In the course: Kafka orders by partition <strong>offset</strong> (Hands-on 10); Raft tells old leaders from new ones by <strong>term</strong>.</p>

---

<div class="kicker">CAP theorem</div>

## Answer or refuse?

Product data in PostgreSQL, replicated on two nodes, **one per data centre**. The link between the sites goes down; both nodes are alive.

<div class="q">

A customer on site B asks for the stock of product 42, just updated on site A. What should node B do?

</div>

* **Answer with what it has** (possibly stale)…
* …or **refuse to answer** until it can talk to A again. There is no third option.

---

## The CAP theorem

A system that **replicates data** cannot guarantee all three at once (Brewer 2000; Gilbert and Lynch 2002):

- **C — Consistency**: every read returns the most recent write, or an error (linearisability: as if there were a single copy).
- **A — Availability**: every request to a non-failing node gets a non-error response, maybe not the latest write.
- **P — Partition tolerance**: keeps operating when the network splits the nodes into groups that cannot talk.

<div class="warn">

Partitions **will** happen: P is not optional, the real choice is **C or A during a partition**. And CAP's C is **not** ACID's C (constraints valid): a single PostgreSQL is ACID-consistent; CAP only appears with **replicas**.

</div>

---

## A partition, step by step

3 replicas: Node 1 and Node 3 still talk, **Node 2 is cut off**.

1. Client A writes `stock[42] = 0` on Node 1 → replication to Node 2 fails → Node 1 answers OK.
2. Client B reads `stock[42]` from Node 2:
   - **CP**: `error: cannot reach majority`
   - **AP**: `stock[42] = 5` (stale)
3. The partition heals, replicas sync.

<div class="ok">

Neither answer is "wrong": the CP node refuses rather than lie; the AP node answers with the best value it has. Which one is acceptable depends on the **data**, not on the technology.

</div>

---

## CP or AP?

| | CP | AP | CA |
|---|---|---|---|
| **During a partition** | rejects requests | answers, maybe stale | — |
| **Consistency** | always | eventually | always |
| **Examples** | ZooKeeper, etcd, PostgreSQL (sync replication), MongoDB (majority) | Cassandra, DynamoDB, CouchDB, DNS | single-node RDBMS |
| **Use when** | payments, inventory, identity | carts, feeds, search indexes | only on one node |

<div class="warn">

CP and AP label a **configuration**, not a product: Cassandra with `QUORUM` behaves much like CP; PostgreSQL reading from an **asynchronous** replica can return stale data. Ask what happens to **your** requests during a partition.

</div>

---

## PACELC: and when there is no partition?

**If Partition** → **A** or **C** · **Else** → **L**atency or **C**onsistency (Abadi, 2010)

To be consistent, a write waits for the replicas (a round-trip); to be fast, it answers before they confirm.

| System | Partition | Normal operation | Class |
|---|---|---|---|
| Cassandra, DynamoDB | favours A | favours L | PA/EL |
| MongoDB (majority writes) | favours C | favours C | PC/EC |
| PostgreSQL (sync replication) | favours C | favours C | PC/EC |

<div class="ok">

**In the store**: an **async read replica** for `GET /products` is the EL choice — faster, but replication lag can return an old price. The **Redis cache** (Hands-on 8) makes the same choice until the TTL expires.

</div>

---

## Choose per data domain

<div class="cols">
<div>

### AP

- **Product catalogue**: showing an item in stock a moment too long is acceptable.
- **Shopping cart**: diverging replicas reconcile on checkout.

</div>
<div>

### CP

- **Payments**: a double charge cannot be reconciled afterwards.
- **Authentication**: a revoked token must be invalid everywhere at once.

</div>
</div>

<div class="warn">

**Common mistakes**: "we chose CA" (with data on more than one machine, partitions happen) · treating CAP as permanent (the C/A choice only applies *during* a partition) · forgetting the cache (Redis in front of a CP database makes those reads AP-like).

</div>

---

<div class="kicker">Consensus</div>

## Which version is the truth?

Kubernetes keeps the whole cluster state in **etcd**, with 3 or 5 members. Two `kubectl apply` arrive at two members at once, then one member crashes: how do the survivors agree, **without a referee**?

- **Consensus**: nodes agree on **one value** despite delayed, lost or reordered messages and failed nodes — leader election, locks, configuration stores.
- **Replicated state machine**: same start state + same commands **in the same order** (a log) → same end state.
- **Safety**: all nodes that decide, decide the **same** value. **Liveness**: every non-faulty node **eventually** decides.

---

## Why consensus is hard: FLP

> **FLP (Fischer, Lynch, Paterson, 1985)**: fully asynchronous network + a single node that may crash → **no deterministic algorithm always reaches consensus**.

Every practical algorithm makes a trade-off:

- assume **partial synchrony** and only guarantee progress when delays become bounded, or
- use **randomisation** (terminates with probability 1), or
- weaken the problem (accept blocking forever in adversarial conditions).

<div class="ok">

Paxos and Raft take the first route: they **never violate safety** and make progress when the network behaves — using **timeouts**, so a slow node looks just like a crashed one.

</div>

---

## Failure models

| Model | What a faulty node does | Cost to tolerate |
|---|---|---|
| **Crash-stop** | halts and never recovers | N nodes tolerate ⌊(N-1)/2⌋ failures |
| **Crash-recovery** | halts, may restart with persistent state | durable logs, rejoining nodes |
| **Byzantine** | arbitrary: wrong messages, equivocation, malice | **3f+1** nodes to tolerate f failures |

- Most datacenter algorithms assume **crash-stop** or **crash-recovery**.
- Byzantine fault tolerance: blockchains and safety-critical systems.

---

## Majorities: why 3 or 5 nodes

A decision is valid only with a **majority**; any two majorities **share a node**, so two conflicting decisions can never both win.

<div class="cols">
<div>

| N | Majority | Tolerated |
|---|---|---|
| 1 | 1 | 0 |
| 2 | 2 | 0 |
| 3 | 2 | **1** |
| 4 | 3 | 1 |
| 5 | 3 | **2** |
| 7 | 4 | 3 |

</div>
<div>

- Use an **odd** number: a 4th node costs money and tolerates **no** extra failure.
- 2 nodes is worse than 1: losing either stops it.
- **Split brain**: 5 nodes split 3/2 → only the side with 3 elects and commits; the side with 2 rejects writes.

</div>
</div>

---

## Paxos

Lamport (1998; "Paxos Made Simple", 2001). Roles: **proposers**, **acceptors**, **learners**.

1. **Prepare**: the proposer sends ballot `n`; each acceptor promises to ignore lower ballots and replies with the highest proposal it has **already accepted**, if any.
2. **Accept**: after a majority of promises, it sends `Accept(n, value)`. The value is **not free**: if a promise carried an accepted value, it must propose the highest-numbered one.
3. The value is **chosen** once a majority accepts it (2 of 3).

- "Adopt the previously accepted value" is what makes Paxos **safe**.
- Notoriously hard to implement: no leader election, log compaction or membership changes in the algorithm.

---

## Raft: leader election

Designed for **understandability** (Ongaro and Ousterhout, 2014): leader election, log replication, safety.

- Follower → **election timeout** → Candidate → **majority vote** → Leader. Higher **term** seen → back to follower.
- **Terms** are logical clocks: each starts with an election, at most **one leader per term**; one vote per node per term.
- `RequestVote(term=2, lastLogIndex=5)`: a candidate wins only if its log is **at least as up-to-date** as the voters' (election restriction) → the new leader holds every committed entry.
- Timeouts are **randomised** (150–300 ms): otherwise everyone becomes candidate at once and splits the votes.

<p class="small">Try it: raft.github.io (stop the leader and watch the election) and The Secret Lives of Data.</p>

---

## Raft: log replication

1. Client: `Write x=5` → Leader.
2. Leader → `AppendEntries(x=5)` → followers.
3. A **majority** (counting the leader) has durably written it → **commit** → `Success` to the client.

<div class="ok">

Every future leader needs a majority of votes, and every majority holds the entry: a committed entry survives the failure of any **minority**.

</div>

<p class="small">Raft runs in etcd (Kubernetes), CockroachDB and Consul.</p>

---

## Quorums

Leaderless databases (Cassandra, DynamoDB): **N** replicas, a write needs **W** acks, a read needs **R** responses. **W + R > N** → every read quorum overlaps every write quorum.

| Setting (N = 3) | W | R | W + R > N? | Effect |
|---|---|---|---|---|
| `ONE` / `ONE` | 1 | 1 | ❌ | fastest; reads may be stale |
| `QUORUM` / `QUORUM` | 2 | 2 | ✅ | latest acknowledged write; tolerates 1 node down |
| `ALL` / `ONE` | 3 | 1 | ✅ | fast reads; one node down blocks every write |

<div class="warn">

**Necessary, not sufficient**: concurrent writes, a write on fewer than W nodes reported as failed, "sloppy" quorums. Quorum databases offer **tunable** consistency, not linearisability.

</div>

---

<!-- _class: tight -->

## Eventual consistency and CRDTs

AP systems: with no new updates, replicas **eventually converge** — not saying *when*.

- **Last-Write-Wins**: highest timestamp wins; loses concurrent writes and trusts drifting clocks.
- **Vector clocks**: detect concurrent writes for explicit resolution.
- **CRDTs**: a **merge** that is commutative, associative and idempotent.

```java
void increment() { counts[me]++; }               // G-Counter: each node, its own slot

void merge(GCounter other) {                      // element-wise max
    for (int i = 0; i < counts.length; i++)
        counts[i] = Math.max(counts[i], other.counts[i]);
}
```

Product views: node 0 `[3, 0]`, node 1 `[0, 2]` → both merge to `[3, 2]` = **5**. LWW on one number: 3 or 2.

<p class="small">Riak data types, Redis Active-Active, Automerge and Yjs; Dynamo's cart (2007) merged versions by set union.</p>

---

## In practice: use, don't build

| Tool | Role | Algorithm |
|---|---|---|
| **etcd** | key-value store, Kubernetes config | Raft |
| **ZooKeeper** | coordination, leader election | ZAB (Paxos-derived) |
| **Consul** | service discovery, locks | Raft |
| **Kafka** | distributed log | KRaft (Raft); ZooKeeper mode removed in 4.0 |

<div class="warn">

- **Do not implement Paxos or Raft yourself**: etcd, ZooKeeper, Consul, or the database (`SELECT … FOR UPDATE`, unique constraint).
- **Consensus is not free**: a majority round-trip through one leader — small, critical data only.
- **A lock is not a guarantee**: a paused holder wakes after its lease expired; use a **fencing token**.

</div>

---

## Takeaways

1. Distributed: independent nodes, **messages only**, **no shared clock** — the store is one as soon as it has more than one service.
2. We gain scalability, fault tolerance and latency; we pay in complexity, network failures and operations. The **8 fallacies** are false.
3. A caller cannot tell slow from dead: **timeouts** + **idempotent** retries. Order events with a single authority or **logical clocks**.
4. **CAP**: during a partition, **C or A** (CA only on one node); **PACELC** adds latency vs consistency. Choose **per data domain**.
5. **FLP**: consensus always keeps safety and relies on timeouts for liveness.
6. **Majorities** overlap: 3 or 5 nodes. **Raft**: randomised timeouts, one leader per term, commit on a majority.
7. Quorums need **W + R > N**; AP systems converge with LWW, vector clocks or **CRDTs**.
