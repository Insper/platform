---
marp: true
lang: en
title: Distributed Systems Fundamentals
description: System Architecture · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">System Architecture · Insper</div>

# Distributed Systems Fundamentals

**No shared memory, no shared clock, and a network that lies**

<!--
Outline: (1) why distribute and failure models; (2) the unreliable network, timeouts and
idempotency; (3) replication and consistency models; (4) CAP and PACELC; (5) consensus and
quorums; (6) time and clocks.
-->

---

## 10:00:00 — the on-sale opens

<div class="q">

A fan on a train taps **Hold seat**. The spinner turns for 5 s, then *"Something went wrong"*.
She taps again. **Did the first tap hold a seat? Will she hold two? Be charged twice?**

</div>

- On one machine the function returned or threw — the question would not exist.
- BoxOffice runs on dozens of machines connected only by a **network**.
- A distributed system: nodes that cooperate **only by messages**, with **no shared memory and no shared clock**.

> "A distributed system is one in which the failure of a computer you didn't even know existed can render your own computer unusable." — Leslie Lamport

---

## Why distribute — and what it costs

<div class="cols">
<div>

### Reasons

- **Scale** beyond one machine
- **Fault tolerance**: no single point of failure
- **Latency**: be close to users
- **Isolation**: teams, blast radius
- **Data residency** (LGPD, GDPR)

</div>
<div>

### Costs

- **Partial failure**
- **Unreliable network**
- **No global clock**
- **Copies diverge** (consistency)
- **Coordination** and operations

</div>
</div>

<p class="small">At scale failure is the norm: 1 − (1 − p)<sup>N</sup>. With p = 0.1% per machine per day, 3,000 machines see a failure on ~95% of days.</p>

---

## Failure models

| Model | The faulty node… | BoxOffice example |
|---|---|---|
| **Crash-stop** | halts forever | VM terminated |
| **Crash-recovery** | halts, restarts from disk | `inventory` pod OOM-killed |
| **Omission** | drops messages | the `SeatHeld` event never sent |
| **Timing** | answers too late | 3 s GC pause in `payment` |
| **Byzantine** | lies, corrupts | forged ticket, bit flip |
| **Gray** | looks healthy, fails users | `/health` 200, every query times out |

<div class="warn">

The failures that hurt are not clean crashes: they are **slow**, **partial** and **gray**.

</div>

---

## The 8 fallacies of distributed computing

1. The network is reliable
2. Latency is zero — same DC ≈ 0.5 ms RTT, across continents ≈ 150 ms
3. Bandwidth is infinite
4. The network is secure
5. Topology doesn't change
6. There is one administrator
7. Transport cost is zero
8. The network is homogeneous

<p class="small">Deutsch et al., Sun Microsystems (1994; Gosling added the 8th in 1997). Each one returns in a later class.</p>

---

## Slow or dead?

`inventory → payment: authorise R$ 450` … **silence** … timeout after 2 s.

- (a) request lost · (b) `payment` crashed · (c) **reply lost** · (d) `payment` **just slow**
- All four look identical to the caller.
- A **timeout** lets you *assume* failure — not know it.
- In (c) and (d) the charge **happened**: a blind retry charges twice.

<div class="ok">

Timeouts are a trade-off (too long: threads pile up; too short: false alarms and extra load). Retries must be **safe** → **idempotency**.

</div>

---

## Delivery semantics

| Semantics | How | Risk |
|---|---|---|
| **At most once** | send, never retry | lost messages |
| **At least once** | retry until acknowledged | duplicates |
| **Exactly once** | impossible over an unreliable network alone | — |

> **Effectively once = at-least-once delivery + idempotent processing.**

<div class="warn">

"Exactly-once delivery" without qualification is a red flag in an interview.

</div>

---

## Making retries safe

- **Idempotent**: applying twice = applying once. `GET`, `PUT`, `DELETE` yes; `POST`, `x = x + 1` no.
- **Conditional write** (compare-and-set): the duplicate changes nothing.

```sql
UPDATE seats SET status = 'HELD', fan_id = 42, hold_key = :key
 WHERE id = 'A-12' AND (status = 'FREE' OR hold_key = :key);
```

- **Idempotency key**: the client sends a UUID per intended action; the server stores key + result **in the same transaction** and replays the stored result on a duplicate.
- Store keys in **shared** storage — the retry lands on another replica.

---

## Replication models

| | Single-leader | Multi-leader | Leaderless |
|---|---|---|---|
| Who writes | one leader | one per region | any replica |
| Write conflicts | none | yes | yes |
| Strong consistency | possible | not across leaders | only approximate |
| Examples | PostgreSQL, Kafka partitions | multi-region setups, CouchDB | Cassandra, Dynamo |

<p class="small">When to say OK: <b>async</b> (fast, may lose writes on failover) · <b>sync</b> (slowest follower decides) · <b>semi-sync / quorum</b> (the usual compromise).</p>

---

## Replication lag in the wild

<div class="q">

The fan pays at 10:00:41, opens *My tickets* 300 ms later — served by an async replica. The list is **empty**.

</div>

- Quiet day, mean lag 20 ms → almost never stale.
- On-sale, mean lag 800 ms → stale for **~69%** of fans at 300 ms (exponential model, illustrative).
- Under load, the bug is not rare — it is **expected**.

<div class="ok">

Fix it precisely: **read-your-writes**, not global strong consistency.

</div>

---

## The consistency spectrum

| Model | Promise | Available in a partition? |
|---|---|---|
| **Linearizable** | behaves like a single copy, real-time recency | no |
| **Causal** | cause before effect, for everyone | **yes** |
| **Read-your-writes** | you see your own writes | yes (per session) |
| **Monotonic reads** | your view never goes back in time | yes (per session) |
| **Eventual** | replicas converge if writes stop | yes |

- Linearizable for **seats, money, uniqueness, leaders**.
- Session guarantees via leader reads after a write, **LSN tokens**, sticky replicas.
- Eventual conflicts: **LWW** (loses writes), version vectors, **CRDTs**.

---

## CAP: during a partition, choose

<div class="cols">
<div>

### CP — refuse

- minority side returns errors
- no double-sold seat
- etcd, ZooKeeper, Spanner, PostgreSQL sync

</div>
<div>

### AP — answer

- every node answers, maybe stale
- reconcile afterwards
- Cassandra (defaults), DNS, CDN, caches

</div>
</div>

<div class="warn">

**P is not optional** — "CA" is not a choice for replicated data. And CAP's C is **linearizability**, not ACID's C.

</div>

---

## PACELC: the trade-off you pay every day

> **P**artition → **A** or **C**; **E**lse → **L**atency or **C**onsistency.

| Confirming replicas are… | Extra RTT per consistent write |
|---|---|
| same rack | < 0.5 ms |
| another zone, same region | ~1–2 ms |
| another region, same continent | ~10–40 ms |
| another continent | ~150–200 ms |

<p class="small">Hence: synchronous across zones (EC), asynchronous or home-region partitioning across regions (EL). Illustrative orders of magnitude.</p>

---

## BoxOffice: one choice per data domain

| Data | Choice | How |
|---|---|---|
| Seats, holds, payments | **CP / linearizable** | one primary per event, conditional `UPDATE` |
| *My tickets* | **read-your-writes** | user's own data from the primary |
| Seats-left counter | **monotonic reads** | sticky replica / short-TTL cache |
| Catalogue, images | **AP / eventual** | replicas, cache, CDN |
| Interest counters | **eventual (CRDT)** | per-region counters merged |

<p class="small">Multi-region: each event has a <b>home region</b> (the venue's) — strong consistency stays local, a partition only affects cross-region holds.</p>

---

## Consensus: agreeing on one log

- **Replicated state machine**: same commands, same order → same state on every node.
- **Safety** always (never two different decisions); **liveness** when the network behaves.
- **FLP**: no deterministic algorithm always terminates in an asynchronous system → timeouts.
- **Majorities overlap** → no split brain.

| N | 1 | 2 | 3 | 4 | 5 | 7 |
|---|---|---|---|---|---|---|
| Failures tolerated | 0 | 0 | **1** | 1 | **2** | 3 |

<p class="small">Use 3 or 5 nodes, spread so that <b>no zone holds a majority</b>. Two nodes at 99% each = 98.01%.</p>

---

## Raft in one slide

- **Follower → Candidate → Leader**; time divided into **terms**, at most one leader per term.
- No heartbeat for an **election timeout** (randomised) → become candidate, `term + 1`, request votes.
- **One vote per term**; vote only for a log **at least as up-to-date** (election restriction).
- Leader appends, replicates with `AppendEntries`, **commits after a majority** wrote to disk.
- A stale leader sees a higher term → **steps down**.

<p class="small">etcd defaults: heartbeat 100 ms, election timeout 1,000 ms → a leader crash costs ~1–2 s of no writes. Used by etcd, Consul, CockroachDB, Kafka KRaft.</p>

---

## Leaderless quorums: R + W > N

| N = 3 | W | R | R + W > N? | Behaviour |
|---|---|---|---|---|
| `ONE` / `ONE` | 1 | 1 | no | fastest, may be stale |
| `QUORUM` / `QUORUM` | 2 | 2 | **yes** | sees latest ack'd write, tolerates 1 down |
| `ALL` / `ONE` | 3 | 1 | yes | one node down blocks writes |

<div class="warn">

Overlap is **necessary, not sufficient**: sloppy quorums, concurrent writes and LWW still produce anomalies. Tunable consistency ≠ consensus.

</div>

---

## Leases need fencing tokens

1. Worker A gets the lease, **token 33** — then a 15 s GC pause; the lease expires.
2. Worker B gets the lease, **token 34**, writes with 34.
3. A wakes up, still "holds the lock", writes with 33 → **storage rejects 33 < 34**.

```sql
UPDATE scheduled_jobs SET last_run_at = now(), fencing_token = :token
 WHERE job_id = 'onsale-reminder-42' AND fencing_token <= :token;
```

<div class="ok">

BoxOffice: Patroni + 3-node etcd elects the PostgreSQL primary; the old primary demotes itself. Use consensus, **don't build it**.

</div>

---

## Atomic across services? Two-phase commit

1. **Prepare**: every participant writes its changes + a *prepared* record, keeps the locks, votes **yes/no**.
2. **Commit**: all yes → coordinator logs COMMIT and tells everyone; any no → ABORT.

<div class="warn">

Coordinator crashes after the votes → participants are **in doubt**, seat A-12 **stays locked**. Availabilities multiply (all up at once), two round trips + fsyncs, and the **payment provider cannot join**.

</div>

<p class="small">2PC lives on <b>inside</b> distributed databases with a replicated coordinator (Spanner, CockroachDB, Kafka transactions) — not across microservices.</p>

---

## Sagas: compensate instead of lock

| Step | Local transaction | Compensation |
|---|---|---|
| 1 | order `PENDING` | order `CANCELLED` |
| 2 | seat → `RESERVED_FOR_PAYMENT` | release the seat |
| 3 | **authorise** the card (pivot) | void / refund |
| 4 | seat `SOLD`, order `CONFIRMED` | — retry until it succeeds |

- **Orchestrated** (one brain, e.g. `order` or Temporal) or **choreographed** (events).
- No isolation → **semantic locks** with expiry; every step **idempotent**.
- Each step writes DB + event atomically with a **transactional outbox**.

---

## No global clock

- Quartz drifts: 20 ppm ≈ **1.7 s/day**; NTP keeps servers within ~ms — if it keeps running.
- **Wall clock** (`currentTimeMillis`) can jump → only for human timestamps.
- **Monotonic clock** (`nanoTime`) → durations, timeouts.

<div class="warn">

**Last-write-wins** with a node 50 ms fast: a release at .040 stamped **.090** beats a hold at .060 → Carla paid and has no seat. The fastest clock wins every conflict.

</div>

---

## Ordering without trusting clocks

| Tool | Gives you | Used by |
|---|---|---|
| **Lamport clock** | a → b ⇒ L(a) < L(b) | Raft terms, fencing |
| **Vector clock** | detects **concurrency** | Dynamo, Riak |
| **HLC** | causal + close to real time, 64 bits | CockroachDB, YugabyteDB, MongoDB |
| **TrueTime** | bounded uncertainty, **commit wait** | Spanner |
| **Single authority** | total order from one leader | DB sequence, conditional `UPDATE` |
| **Kafka key → partition** | order per key | events of one show |
| **Snowflake / UUIDv7** | unique, roughly time-sorted ids | keys — **not** "who came first" |

---

## The concept map

| Root problem | Technique | Palette components |
|---|---|---|
| Partial failure | replication, consistency models | `sql` `nosql` `cache` `cdn` |
| Partial failure | CAP / PACELC, multi-region | `dns` `sql` `nosql` |
| Unreliable network | timeouts, retries, idempotency | `payment` `thirdparty` `queue` |
| Unreliable network | sagas, outbox, 2PC | `stream` `kafka` `payment` |
| No global clock | consensus, quorums, fencing | `kafka` `scheduler` `sql` |
| No global clock | logical / hybrid clocks, ids | `kafka` `sql` `scheduler` |

<p class="small">Every component in the playground inherits one of these problems — ask which one before adding it to a design.</p>

---

## Takeaways

1. Distribute only for **scale, fault tolerance, latency, isolation, residency**; failure becomes the norm.
2. **Slow ≈ dead** to the caller: timeouts + **idempotent** retries (conditional writes, idempotency keys).
3. Exactly-once **delivery** is impossible → at-least-once + idempotent processing.
4. Pick a **consistency model per data domain**: linearizable for seats and money, read-your-writes for a user's data, eventual for the catalogue.
5. **CAP** during partitions, **PACELC** every day; partition by **home region**; **sagas + outbox**, not 2PC, across services.
6. **Majorities** (3 or 5 nodes), **Raft**, `R + W > N`, **fencing tokens** — use etcd, don't build it.
7. Never order events by timestamps from different machines.
