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
Outline: (1) why distribute and the three root problems; (2) fallacies, partial failure, timeouts
and idempotency; (3) logical clocks; (4) CAP and PACELC; (5) consensus: FLP, failure models,
majorities, Raft; (6) quorums, eventual consistency and CRDTs.
-->

---

## Why is this hard?

<div class="q">

Several computers collaborate and the user should see **a single coherent system**.
What makes coordinating them harder than running everything on one machine?

</div>

* **Partial failure** — each node can fail on its own while the rest keeps running.
* **Unreliable network** — messages can be delayed, lost or duplicated.
* **No shared clock** — no global notion of "now".

<!--
Let the class answer first. These three facts are the root of every topic in this class.
-->

---

## Our store is a distributed system

One click on **Place order**:

Browser → **Gateway** → Auth → **Order** → Product → Redis · Order → **PostgreSQL** · Order → **Kafka**

- Every arrow is a network message; every box can fail on its own.
- **Heterogeneous** (Java, Python, Postgres, Redis, Kafka), **loosely coupled** (HTTP, events), **client-server**.

<div class="cols">
<div>

### What we gain

- Horizontal scalability
- Fault tolerance (replication)
- Lower latency (caches, CDNs)

</div>
<div>

### What we pay

- Complexity, distributed state
- Network failures to handle
- Operational cost: monitoring, tracing

</div>
</div>

---

<!-- _class: tight -->

## The 8 fallacies of distributed computing

Deutsch and colleagues at Sun (1994; the 8th by Gosling) — **all of them false**:

<div class="cols">
<div>

1. The network is reliable
2. Latency is zero
3. Bandwidth is infinite
4. The network is secure

</div>
<div>

5. Topology doesn't change
6. There is one administrator
7. Transport cost is zero
8. The network is homogeneous

</div>
</div>

<div class="warn">

Common root: treating the network as a **reliable local function call**. Design **for** failure — assume it will happen and degrade gracefully.

</div>

<!--
Ask for a store example of each: five 40 ms calls in sequence, a pod rescheduled with a new IP...
-->

---

## Slow or dead?

Order → Product: *reserve 1 unit of product 42* … **silence**.

- Request lost? Product crashed? Reply lost? Product just slow? **They all look the same.**
- The only tool: a **timeout** — but it does not say whether the operation ran.
- A retry may apply it **twice** → retried operations must be **idempotent** (e.g. a unique request id).

<div class="ok">

Timeouts, retries with backoff and circuit breakers: see the **Reliability** class.

</div>

---

## No global clock: logical time

Clocks drift — never order events from different machines by `currentTimeMillis()`.

**Lamport clock** — one counter per process:

1. increment before each event;
2. attach the counter to every message sent;
3. on receive: `max(local, received) + 1`.

- Guarantee: if *a* happened-before *b*, then L(*a*) < L(*b*) — not the converse.
- **Vector clocks** (one counter per process) also detect **concurrent** events.

<p class="small">Kafka orders by partition offset; Raft by term — single authorities, not wall clocks.</p>

---

## CAP theorem

A system that **replicates data** cannot guarantee all three at once (Brewer 2000; Gilbert and Lynch 2002):

- **C — Consistency**: every read returns the most recent write, or an error (linearisability — **not** ACID's C).
- **A — Availability**: every request to a live node gets a non-error response, maybe not the latest write.
- **P — Partition tolerance**: keeps working when the network splits the nodes into groups.

<div class="warn">

Partitions **will** happen. P is not optional: the real choice is **C or A during a partition**.

</div>

---

## CP or AP?

<div class="cols">
<div>

### CP

During a partition, **refuse** rather than return stale data.

ZooKeeper, etcd, PostgreSQL (sync replication), MongoDB (majority writes).

**Payments, inventory, auth.**

</div>
<div>

### AP

During a partition, **every node answers** — then replicas **converge** (eventual consistency).

Cassandra, DynamoDB, CouchDB, DNS.

**Catalogue, shopping cart, feeds.**

</div>
</div>

<p class="small">CA only exists on a single node. CP/AP describe a <strong>configuration</strong>, not a product — choose per data domain.</p>

---

## PACELC: and when there is no partition?

**If Partition** → **A** or **C** · **Else** → **L**atency or **C**onsistency

| System | Partition | Normal operation | Class |
|---|---|---|---|
| Cassandra, DynamoDB | favours A | favours L | PA/EL |
| MongoDB (majority writes) | favours C | favours C | PC/EC |
| PostgreSQL (sync replication) | favours C | favours C | PC/EC |

<div class="ok">

Most of the time there is **no partition** — but latency vs consistency is **always** there: an async read replica or a Redis cache can return stale data.

</div>

---

## Consensus — and why it is hard

**Consensus**: nodes agree on **one value** (or one log order) despite lost messages and failed nodes — leader election, locks, replicated state machines.

- **Safety**: nobody decides differently. **Liveness**: everyone eventually decides.

> **FLP (1985)**: fully asynchronous + one node may crash → no deterministic algorithm always terminates.

- Paxos and Raft **never break safety**; they progress when the network behaves (partial synchrony).
- In practice: **timeouts** — a slow node looks just like a crashed one.

---

## Failure models

| Model | What a faulty node does | Cost to tolerate |
|---|---|---|
| **Crash-stop** | halts and never recovers | N nodes tolerate ⌊(N-1)/2⌋ failures |
| **Crash-recovery** | halts, may restart with persistent state | durable logs, rejoining nodes |
| **Byzantine** | arbitrary — wrong messages, malice | **3f+1** nodes to tolerate f failures |

- Datacenter algorithms assume **crash-stop** or **crash-recovery**.
- Byzantine fault tolerance: blockchains and safety-critical systems.

---

## Majorities: why 3 or 5 nodes

Any two majorities **overlap** → two conflicting decisions can never both win (no split brain).

| Nodes | Majority | Failures tolerated |
|---|---|---|
| 3 | 2 | **1** |
| 4 | 3 | 1 |
| 5 | 3 | **2** |

<div class="ok">

Use an **odd** number: a 4th node costs money and tolerates **no** extra failure. A partition 3/2 → only the side with 3 keeps writing.

</div>

<!--
Quick check: with 7 nodes, how many can fail? (3.)
-->

---

## Raft

Designed for **understandability** (Ongaro and Ousterhout, 2014).

- **Election**: Follower → *randomised* election timeout → Candidate → **majority vote** → Leader. A higher **term** makes any node step down.
- **Replication**: client writes `x=5` to the leader → `AppendEntries` → **commit after a majority** acknowledges → reply.
- **Safety**: a candidate's log must be at least as up-to-date as the voters'; committed entries survive any **minority** failure.

<p class="small">Raft: etcd (Kubernetes), Consul, CockroachDB, Kafka KRaft. Paxos (Lamport) is the older, harder ancestor; ZooKeeper uses ZAB.</p>

<!--
Show raft.github.io: stop the leader and watch the election.
-->

---

## Quorums

For **N** replicas, a write needs **W** acknowledgements and a read needs **R** responses.

<div class="ok">

**W + R > N** → every read quorum overlaps every write quorum: at least one node read has the latest write.

</div>

| N = 3 (Cassandra) | W + R | Effect |
|---|---|---|
| `ONE` / `ONE` | 2 ❌ | fastest, reads may be stale |
| `QUORUM` / `QUORUM` | 4 ✅ | latest write; tolerates 1 node down |
| `ALL` / `ONE` | 4 ✅ | one node down blocks every write |

---

## Eventual consistency and CRDTs

AP systems promise: with no new updates, replicas **eventually converge** — but not *when*.

- **Last-Write-Wins** — highest timestamp wins; loses concurrent writes, trusts drifting clocks.
- **Vector clocks** — detect concurrent writes for explicit resolution.
- **CRDTs** — a **merge** that is commutative and idempotent: order and repetition do not matter.

```java
void increment() { counts[me]++; }               // G-Counter: own slot only
void merge(GCounter o) {                          // element-wise max
    for (int i = 0; i < counts.length; i++) counts[i] = Math.max(counts[i], o.counts[i]);
}
```

---

## Takeaways

1. Distributed: independent nodes, **messages only**, **no shared clock** — our store is one.
2. The **8 fallacies** are false; a caller cannot tell slow from dead: **timeouts** + **idempotent** retries.
3. Order events with a single authority or **logical clocks**, not wall clocks.
4. **CAP**: during a partition choose **C or A**; **PACELC** adds latency vs consistency. Choose per data domain.
5. **FLP**: consensus keeps safety and relies on timeouts for progress.
6. **Majorities** overlap — use 3 or 5 nodes; **Raft** elects a leader and commits on a majority.
7. Quorums need **W + R > N**; AP systems converge with LWW, vector clocks or **CRDTs**.
