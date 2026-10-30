Ten minutes before the on-sale, the catalog database is at 90% CPU — almost all of it from `SELECT`s for the event page. The team adds two **read replicas** and routes reads to them. CPU drops to 30%. Then the support channel lights up: "I paid, the confirmation e-mail arrived, but *My tickets* is empty!" Nothing was lost. The fan's next read simply went to a replica that had not yet received the write.

Replication — keeping a copy of the same data on several machines — is the most used scaling and availability tool in databases, and it comes with exactly this kind of surprise. This page covers the three ways to replicate (single-leader, multi-leader, leaderless), what replication lag does to users, and what happens when the leader dies.

---

## Why replicate

| Goal | How replication helps | BoxOffice example |
|---|---|---|
| **Availability** | if one node dies, another has the data and takes over | the inventory primary crashes at 10:01; a standby is promoted in seconds |
| **Read scaling** | reads are spread over several copies | catalog reads go to 2–5 replicas |
| **Latency** | a copy close to the user | a replica in another region for the event pages |
| **Durability** | a disk or machine loss does not lose committed data | a synchronous standby holds every committed hold |

Replication does **not** scale writes: every copy must apply every write. For that you need [partitioning](../partitioning/index.md).

---

## Single-leader replication

One node, the **leader** (primary), accepts all writes. It records each change in its log — the **write-ahead log** (WAL) in PostgreSQL, the binlog in MySQL — and ships the log to **followers** (replicas, standbys), which replay it in the same order. Reads can go to any node[^1].

``` diagram-sim
flowchart LR
    app["catalog service"] -->|"writes"| P[("primary")]
    P -->|"WAL stream"| R1[("replica 1")]
    P -->|"WAL stream"| R2[("replica 2")]
    app -->|"reads"| R1
    app -->|"reads"| R2
    app -->|"reads that must be fresh"| P
```

This is the model of PostgreSQL streaming replication, MySQL replication, SQL Server Always On, MongoDB replica sets and most managed services (Amazon RDS read replicas, Cloud SQL, Azure Database). It is simple to reason about because there is exactly one order of writes — the leader's.

### Synchronous, asynchronous, semi-synchronous

The key decision is **when the leader tells the client "committed"**:

``` diagram-sim
sequenceDiagram
    participant C as Client
    participant P as Primary
    participant S as Sync standby
    participant A as Async replica
    C->>P: COMMIT hold A-12
    P->>P: write WAL locally
    P->>S: ship WAL
    S-->>P: flushed
    P-->>C: committed
    P->>A: ship WAL (later)
    Note over A: may lag ms … s behind
```

| Mode | Leader answers "committed" after… | Durability on leader loss | Write latency | Availability risk |
|---|---|---|---|---|
| **Asynchronous** | its own disk flush | the last writes not yet shipped are **lost** | lowest | none from replicas |
| **Synchronous** (all replicas) | every replica confirms | no loss | highest: slowest replica decides | any replica down blocks writes |
| **Semi-synchronous** / one sync standby | one replica confirms, others async | no loss if that standby survives | + one network round trip | if the sync standby dies, another must take its role |
| **Quorum storage** (Aurora: 4 of 6 copies across 3 zones)[^4] | a write quorum of storage nodes confirms | survives a zone loss | + round trip to the quorum | tolerates slow nodes |

In PostgreSQL this is the `synchronous_commit` and `synchronous_standby_names` settings[^5]; `ANY 1 (s1, s2)` means "wait for any one of the two standbys" — a quorum that tolerates one slow standby. Within one region, a synchronous round trip costs around a millisecond; across continents it costs tens to hundreds of milliseconds, which is why cross-region replicas are almost always asynchronous.

---

## Replication lag and its anomalies { #lag }

An asynchronous replica is behind the leader by the **replication lag**: usually milliseconds, but seconds or minutes when the leader takes a burst of writes, a replica replays a huge transaction, or the network is congested. Lag creates three user-visible anomalies[^2]:

| Anomaly | What the user sees | Guarantee that prevents it |
|---|---|---|
| **Reading your own write fails** | pays, opens *My tickets*, sees nothing | **read-your-writes** (read-after-write) consistency |
| **Time goes backwards** | refreshes the page: the ticket appears, refreshes again: gone (second read hit a more-lagged replica) | **monotonic reads** |
| **Effect before cause** | sees the reply "refund approved" before the refund request in a chat thread | **consistent prefix reads** |

``` diagram-sim
sequenceDiagram
    participant F as Fan
    participant O as order service
    participant P as Primary
    participant R as Replica (lag 800 ms)
    F->>O: POST /orders/9001/confirm
    O->>P: UPDATE orders SET status = 'PAID'
    P-->>O: committed
    O-->>F: 200 "Payment confirmed"
    F->>O: GET /me/tickets
    O->>R: SELECT … WHERE customer_id = 7
    R-->>O: (no row yet)
    O-->>F: "You have no tickets"
```

How likely is it? Under an illustrative model — lag exponentially distributed around a mean, and the fan's next click going to a replica — the answer depends entirely on the lag at that moment:

```python exec="1" html="1"
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

# Illustrative model: replication lag is exponentially distributed with a given
# mean; the user's next read goes to a replica. P(stale) = P(lag > delay).
delay_ms = np.linspace(0, 2000, 400)
cases = [(20, "#54A24B", "mean lag 20 ms (quiet primary)"),
         (200, "#F58518", "mean lag 200 ms (busy primary)"),
         (1000, "#E45756", "mean lag 1 s (on-sale write burst)")]

fig, ax = plt.subplots(figsize=(9, 4.2))
fig.patch.set_alpha(0)
for mean, color, label in cases:
    ax.plot(delay_ms, 100 * np.exp(-delay_ms / mean), color=color, lw=2.5, label=label)
ax.axvline(300, color="#888", ls=":", lw=1.5)
ax.text(320, 50, "user clicks 'My tickets'\n~300 ms after paying", color="#888", fontsize=9, va="top")
ax.set_xlabel("time between the write and the next read (ms)")
ax.set_ylabel("% of reads that miss the user's own write")
ax.set_title("Read-your-writes on an asynchronous replica")
ax.set_ylim(0, 100)
ax.grid(True, alpha=0.25)
ax.set_facecolor("none")
for item in [ax.title, ax.xaxis.label, ax.yaxis.label] + ax.get_xticklabels() + ax.get_yticklabels():
    item.set_color("#888")
for s in ax.spines.values():
    s.set_color("#888")
ax.tick_params(colors="#888")
leg = ax.legend(frameon=False, fontsize=9, loc="upper right")
for t in leg.get_texts():
    t.set_color("#888")
plt.tight_layout()

buffer = StringIO()
plt.savefig(buffer, format="svg", transparent=True)
print(buffer.getvalue())
plt.close()
```

On a quiet day the bug is invisible; during the on-sale — exactly when the most fans are watching — most of them hit it. That is why lag bugs survive testing.

### Fixing read-your-writes

| Technique | How | Trade-off |
|---|---|---|
| **Read from the leader after a write** | for N seconds after a user writes, route *that user's* reads to the primary (a timestamp in the session or a cookie) | simple; the primary takes some extra reads |
| **Read from the leader for owned data** | "my orders", "my tickets" always on the primary; catalog on replicas | simple rule; does not scale if most reads are "mine" |
| **Wait for the replica to catch up** | the write returns its log position (PostgreSQL LSN, MySQL GTID); the next read goes to a replica only once it has replayed that position (`pg_last_wal_replay_lsn()`) | precise; needs plumbing in the data access layer |
| **Sticky replica per user** | hash the user to one replica | gives **monotonic reads**, not read-your-writes |
| **Synchronous replica for reads** | read from a sync standby | no lag, but writes pay the latency |

<div class="csim" data-sim="replication" data-mode="async"></div>

!!! tip "Try it"
    The simulator starts where the support ticket starts: the fan held A-12 300 ms ago, and the lag is 1 s (the `REPLICA_DELAY=1s` of [Hands-on 6](../../../hands-on/6/index.md)). Press **read my holds**: db-2 answers without A-12, a stale read. Press play until the dots arrive (1 s for db-2, 1.5 s for db-3) and read again: fresh. Restart with **read your writes** on: the read goes to the leader and is fresh at once. Then hold a new seat in each mode: *async* commits in 2 ms, *semi-sync* in 1,003 ms, *sync* in 1,503 ms (it waits for db-3, the slowest). Finally, restart in *async* and **crash the leader** while A-12 is in flight: db-2 is promoted without it and the hold is lost; in *semi-sync* or *sync* nothing is lost (see the failover section below).

Monitor lag as a first-class metric — `pg_stat_replication.replay_lag` in PostgreSQL, `ReplicaLag` in Amazon RDS — and alert on it (see [Observability](../../observability/index.md)). A replica that is minutes behind is worse than no replica.

!!! example "In the BoxOffice code: reads routed by transaction type (lab 6)"

    [Hands-on 6 — Replica and pooling](../../../hands-on/6/replicas/index.md) gives `inventory` two pools behind one `DataSource`: a transaction marked `@Transactional(readOnly = true)` (the seat map) gets a replica connection, every other one gets the primary. It is the "read from the leader for owned data" row of the table: `find` reads the fan's own hold with a plain `@Transactional`, on the primary, because the fan has just created it. The lab then measures the bug it avoids: reading the seat map right after a hold, about **6%** of the fans did not see their own hold with the replica on the same machine, and **98%** with `REPLICA_DELAY=1s`.

    ``` { .java title="services/inventory/src/main/java/boxoffice/inventory/DataSourceConfig.java (two pools, one DataSource)" }
    --8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/java/boxoffice/inventory/DataSourceConfig.java:11:38"
    ```

**Try it.** In the `db-replicas` scenario, a primary takes the writes and replicas serve the reads. Add replicas and watch read throughput rise while the primary's load stays flat; then increase the write rate and watch the replication lag grow — and with it, the share of stale reads.

<div class="sdp" data-scenario="db-replicas" data-mode="compact" data-height="520"></div>

---

## Connection pooling

Replicas multiply *where* queries can go; connection pools decide *how many* can run at once. In PostgreSQL each connection is a separate operating-system process with its own memory, so thousands of idle connections cost real RAM and CPU — and the database does not get faster beyond a few concurrent queries per CPU core.

Size pools with Little's Law, not with guesses: busy connections = queries per second × query time. At **2,000 queries/s × 5 ms = 10 connections** busy on average. A pool of 20–30 handles bursts; a pool of 500 only adds contention.

The catch in microservices: 20 pods × a pool of 50 = **1,000 connections** to one primary. A connection pooler such as **PgBouncer** (or RDS Proxy, or Cloud SQL Auth Proxy with pooling) sits between them, multiplexing thousands of client connections onto a few dozen server connections. In *transaction pooling* mode a server connection is lent per transaction, so session state (`SET`, temporary tables, some prepared-statement uses) must not leak across transactions. You will measure this in [Hands-on 6](../../../hands-on/6/index.md).

!!! example "In the BoxOffice code: PgBouncer in front of PostgreSQL (lab 6)"

    In [Hands-on 6](../../../hands-on/6/replicas/index.md) `inventory` connects through PgBouncer in transaction mode, and PostgreSQL sees at most 20 server connections from it, however many client connections arrive. In a test run during the flash sale, `pg_stat_activity` showed about 60 application connections (30 from the three `catalog` replicas, 10 from `auth`, 20 from PgBouncer). With `max_connections` lowered to 80 and an `inventory` pool of 40, the same stack fails with `too many clients already` when `inventory` connects directly, and keeps working through the pooler, which turns "too many clients" into queueing. The migrations still go straight to the primary: Flyway takes session-level locks, which transaction pooling does not keep.

    ``` { .ini title="infra/pgbouncer/pgbouncer.ini (transaction pooling)" }
    --8<-- "docs/2027.1/hands-on/6/code/infra/pgbouncer/pgbouncer.ini:12:17"
    ```

---

## Failover: when the leader dies

If a follower dies, it reconnects and catches up from the log. If the **leader** dies, the system must **fail over**:

``` diagram-sim
sequenceDiagram
    participant M as Failover manager (e.g. Patroni + etcd)
    participant P as Old primary
    participant S as Standby
    participant A as Apps
    M->>P: health check
    Note over P: no answer for 10 s
    M->>S: promote to primary
    S-->>M: promoted (new timeline)
    M->>A: update DNS / virtual IP / proxy
    A->>S: writes resume
    Note over P: if it comes back, it must be fenced<br/>and rejoin as a follower
```

Each step hides a hard problem:

- **Detection** uses timeouts. Too short: a GC pause or network blip triggers an unnecessary failover. Too long: minutes of write downtime.
- **Lost writes.** With asynchronous replication, writes acknowledged by the old leader but not yet shipped are gone. If those were seat holds, the new primary may sell the same seats again.
- **Split brain.** If the old leader was only *partitioned*, not dead, two nodes may accept writes. Systems prevent this with consensus on who the leader is (Patroni stores the leader key in etcd; see [Consensus](../../distributed/consensus/index.md)) and **fencing**: the old leader is cut off (STONITH, "shoot the other node in the head") or its writes are rejected by fencing tokens.
- **Clients must follow.** Through DNS, a virtual IP, a proxy or a driver that knows the topology.

Managed services package all of this — Amazon RDS Multi-AZ with a synchronous standby, Aurora with quorum storage, Cloud SQL high availability, Azure zone-redundant HA — with failovers that typically take from tens of seconds to a couple of minutes; the design question for you is what the application does meanwhile (retries with backoff, see [Reliability](../../reliability/patterns/index.md)).

**Try it.** The `db-failover` scenario is a flash-sale checkout on a cluster with one primary and one **asynchronous** follower: 1,500 req/s, half of them writes. At t = 90 s the primary dies. Press **Run** and read the report: with the default seed about **1,600 writes are lost** (acknowledged by the old primary, never shipped to the follower) and availability falls to about **90.6%**, because every write fails during the 30 s failover. Select `orders-db` and set *Replication* to `sync`: lost writes drop to **0**, but availability does not move. Set it back to `async` and the *Failover time* to 5 s: availability rises to about **98%**, and the writes are lost again. The two knobs answer different questions: replication mode sets how much you lose (the RPO), detection and promotion set how long you are down (the RTO). The possible solution (open it in the full playground ↗) combines quorum replication with 2 followers, 2 shards and a 5 s failover: 0 lost writes, about 99.2% availability.

<div class="sdp" data-scenario="db-failover" data-mode="compact" data-height="520"></div>

---

## Multi-leader replication

In **multi-leader** (multi-primary, active-active) replication, several nodes accept writes and replicate to each other asynchronously. Typical reasons: one leader per region so writes are local; offline-first clients (a mobile app or a collaborative editor is effectively a leader); a second data center that must accept writes during a partition.

The price is **write conflicts**: two leaders accept different writes to the same record concurrently.

| Resolution strategy | How it works | Risk |
|---|---|---|
| **Last write wins (LWW)** | keep the write with the highest timestamp | silently drops the other write; clocks drift (see [Time & Clocks](../../distributed/time-clocks/index.md)) |
| **Merge** | application-specific merge (union of tags, sum of counters) | only works for mergeable data |
| **CRDTs** | conflict-free replicated data types that merge automatically (counters, sets, text) | limited data types; more metadata |
| **Avoid conflicts** | route all writes for a record to one "home" leader | back to single-leader, per record |

!!! example "BoxOffice: where multi-leader fits — and where it must not"

    Event descriptions edited by venue staff in two regions: conflicts are rare and LWW or a "last editor wins, keep history" rule is acceptable.

    Seat inventory: a conflict *is* a double booking. Two regions accepting holds for the same seat is exactly the bug of the [transactions](../transactions/index.md#double-booking) page, at continental scale. Inventory stays **single-leader per event** — if BoxOffice expands to another continent, each event's inventory lives in one "home" region.

---

## Leaderless replication { #leaderless }

Amazon's **Dynamo** paper (2007)[^3] popularized a third design, used by Cassandra, ScyllaDB and Riak: **no leader at all**. The client (or a coordinator node) sends each write to all **N** replicas of a key and considers it successful when **W** of them acknowledge; it reads from **R** replicas and takes the newest version.

<div class="csim" data-sim="quorum" data-n="3" data-w="2" data-r="2" data-down="C"></div>

!!! tip "Try it"
    The simulator starts with the usual setting: N = 3, W = 2, R = 2, replica C down. Press play: every write lands on A and B, every read asks A and B, and no read is stale. Set W = 1 and R = 1: now about half the reads miss the last write (the tile computes C(U − W, R) / C(U, R): 50% with 2 live replicas, 67% once C is back). Return to W = 2, R = 2 and click C to bring it back: it comes back at an old version, yet quorum reads stay fresh; switch on **read repair** and watch C catch up. Finally take B down as well: with one replica alive, writes and reads fail, because the coordinator cannot collect 2 answers.

If **R + W > N**, every read set overlaps every write set in at least one replica, so a read sees the latest acknowledged write (with caveats under concurrent writes and failures — quorums alone are not linearizable). With N = 3:

| W | R | R + W > N? | Behaviour |
|---|---|---|---|
| 1 | 1 | no | fastest, highest availability; reads may be stale |
| 2 | 2 | yes | the usual "quorum" setting; tolerates 1 node down for reads and writes |
| 3 | 1 | yes | fast reads; a single node down blocks writes |
| 1 | 3 | yes | fast writes; a single node down blocks reads |

Missed writes are repaired by **read repair** (a read that sees an old version writes the new one back), **hinted handoff** (a neighbour holds writes for a down node and replays them later; with a **sloppy quorum** those temporary holders even count toward W) and **anti-entropy** (background comparison of replicas with Merkle trees). Cassandra exposes the choice per query as consistency levels `ONE`, `QUORUM`, `LOCAL_QUORUM`, `ALL`.

---

## Comparing the designs

| | Single-leader | Multi-leader | Leaderless |
|---|---|---|---|
| Writes accepted by | one node | several leaders | any W of N replicas |
| Write conflicts | none (one order) | yes — must be resolved | yes — versions, LWW or siblings |
| Failover | needed, delicate | another leader keeps going | not needed |
| Read-your-writes | via routing tricks | per leader | with R + W > N, mostly |
| Good for | most OLTP: orders, inventory, users | multi-region writes, offline clients | high write availability, time series, carts |
| Examples | PostgreSQL, MySQL, RDS, MongoDB | MySQL group replication (multi-primary), CouchDB, collaborative editors | Cassandra, ScyllaDB, Riak, DynamoDB internally |

!!! example "BoxOffice: the replication plan"

    - **catalog**: primary + 2 asynchronous read replicas; event pages read from replicas (staleness of a second is fine) behind the cache.
    - **inventory**: primary + one **synchronous** standby in another availability zone — a lost hold is a double booking, so no acknowledged write may be lost on failover. All holds and confirms go to the primary; the seat *map* may be served from a replica or the cache.
    - **order**: primary + async replica for reports; *My tickets* reads from the primary for 30 seconds after a purchase (session timestamp), from the replica otherwise.
    - Lag alert: page the on-call if any replica is more than 5 s behind for 2 minutes.

!!! tip "In the interview"

    - "Add read replicas" is never the whole answer: add "**…and I handle replication lag**: reads that must reflect the user's own writes go to the primary".
    - State the durability choice: async (may lose the last writes on failover) vs a synchronous standby (no loss, + one round trip per commit). Tie it to the data: money and seats → sync standby.
    - For leaderless stores, write **R + W > N** and say what it buys and what it does not (it is not a transaction).
    - Mention failover time and what clients do meanwhile: retries with backoff, idempotent writes.

!!! success "Best practices"

    - **Make the read target explicit in the code, per transaction** — a reader of the code must see which queries may be stale. In BoxOffice: `@Transactional(readOnly = true)` goes to the replica through `DataSourceConfig` ([lab 6](../../../hands-on/6/replicas/index.md), box above).
    - **Give the driver every host and let it find the primary** — with `jdbc:postgresql://db1,db2/boxoffice?targetServerType=primary` the application reconnects to the new primary after a failover without a redeploy.
    - **Run migrations straight against the primary** — schema changes need a real session, not a pooled transaction. In BoxOffice: `DB_MIGRATION_HOST=db` while the application goes through PgBouncer (lab 6).
    - **Rehearse failover on a schedule** — a planned switchover every quarter measures your real RTO and proves that every client follows the new primary.
    - **Keep long reports off the failover standby** — a long query on a hot standby conflicts with replay and delays it, so the standby you count on for failover falls behind; give reports their own replica.

!!! warning "Common pitfalls"

    - **Reading your own writes from a replica** — the empty *My tickets* page.
    - **Using replicas for decisions**: checking seat availability on a replica and then writing on the primary reintroduces the check-then-act race with extra lag.
    - **Replicas as backups**: a `DELETE` without `WHERE` replicates in milliseconds. Backups and point-in-time recovery are separate (see [Disaster Recovery](../../reliability/disaster-recovery/index.md)).
    - **Unmonitored lag**: a replica hours behind still answers queries — with hours-old data.
    - **Too many connections** from many pods with big pools; use a pooler and size pools with Little's Law.
    - **Automatic failover without fencing**: split brain is worse than downtime.

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    WHY["why replicate: availability,<br/>read scale, latency"] --> SL["single leader"]
    SL --> SYNC["sync vs async<br/>durability vs commit latency"]
    SL --> LAG["replication lag"]
    LAG --> RYW["read-your-writes,<br/>monotonic reads"]
    RYW -.-> CM["consistency models<br/>→ Distributed"]
    SL --> FO["failover: Patroni + etcd<br/>→ Distributed consensus"]
    SL --> POOL["connection pooling<br/>PgBouncer"]
    WHY --> ML["multi-leader<br/>conflicts, LWW"]
    WHY --> LL["leaderless<br/>R + W > N"]
    LL --> PART["partitioned stores<br/>→ Partitioning"]
```

**Palette components:** [`sql`](../../../reference/components/storage/index.md#sql) (a primary with read replicas; a synchronous standby for seats and money) · [`nosql`](../../../reference/components/storage/index.md#nosql) (leaderless quorums: Cassandra, DynamoDB) · [`app`](../../../reference/components/compute/index.md#app) (routes reads and writes, retries with backoff during a failover) · [`cache`](../../../reference/components/storage/index.md#cache) (sits in front of the catalog replicas) · [`dns`](../../../reference/components/edge/index.md#dns) (one way clients follow the new leader). **Scenarios:** `db-replicas`, `db-failover`, `multi-region`. **Continues in:** [Partitioning](../partitioning/index.md), [Distributed — consistency](../../distributed/consistency/index.md), [Distributed — consensus](../../distributed/consensus/index.md), [Reliability — disaster recovery](../../reliability/disaster-recovery/index.md#rpo-rto), [Hands-on 6](../../../hands-on/6/index.md) (read replica, PgBouncer), [Exercise: cache + database](../../../exercises/cache-db/index.md).

---

[^1]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*. 2nd ed. O'Reilly. Chapter "Replication".
[^2]: TERRY, D. B. et al. Session Guarantees for Weakly Consistent Replicated Data. *Proceedings of the 3rd International Conference on Parallel and Distributed Information Systems (PDIS)*, 1994.
[^3]: DeCANDIA, G. et al. Dynamo: Amazon's Highly Available Key-value Store. *ACM SOSP*, 2007.
[^4]: VERBITSKI, A. et al. Amazon Aurora: Design Considerations for High Throughput Cloud-Native Relational Databases. *ACM SIGMOD*, 2017.
[^5]: PostgreSQL Global Development Group. [High Availability, Load Balancing, and Replication](https://www.postgresql.org/docs/current/high-availability.html){target="_blank"}. PostgreSQL Documentation.
