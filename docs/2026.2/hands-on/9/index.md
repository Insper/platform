!!! tip "Main Goal"

    The main goal of this hands-on is to build a **PostgreSQL cluster** in Docker Compose — one primary and two replicas kept in sync by **streaming replication** — and use it to *see* the concepts of a database cluster: replication, read scaling, replication lag, synchronous commits, failover and lost writes.

Every hands-on so far ran a single `db` container. When it stops, every service that depends on it stops too: it is a **single point of failure**. Scaling the gateway to three replicas (hands-on 7) and adding a cache (hands-on 8) took load off the database, but did not remove that single point. A **database cluster** keeps copies of the data on several servers, so one of them can take over when another fails.

## Slides

<div class="slides-embed">
  <iframe src="slides/db-cluster.html" title="Slides: database cluster" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/db-cluster.html){:target="_blank"}

## Why a database cluster

| Goal | What the cluster gives | What it does **not** give |
|---|---|---|
| **Availability** | ✅ another server already has the data and can become the primary | ❌ zero downtime: a failover still takes seconds |
| **Read scaling** | ✅ `SELECT`s spread across the replicas | ❌ write scaling: every write still goes to **one** primary |
| **Durability** | ✅ a copy of every commit on another machine | ❌ protection from a `DELETE` by mistake: it is replicated too (that is what backups are for) |

Scaling **writes** needs a different technique, **sharding** (splitting the data across independent primaries, as Citus or Vitess do). This hands-on is about **replication**: every node holds *all* the data.

## How PostgreSQL replicates: the WAL

Before changing a data page, PostgreSQL writes the change to the **WAL** (*write-ahead log*), an append-only log on disk. After a crash, the server replays the WAL to recover. Replication reuses the same log: the primary sends its WAL to the replicas, which replay it, byte by byte, and end up with identical copies.

``` mermaid-sim
sequenceDiagram
    participant App as Service
    participant P as Primary
    participant R1 as Replica 1
    participant R2 as Replica 2
    App->>P: INSERT INTO orders ...
    P->>P: append the change to the WAL
    P-->>App: COMMIT ok
    P->>R1: stream WAL records
    P->>R2: stream WAL records
    R1->>R1: replay the WAL
    R2->>R2: replay the WAL
    App->>R1: SELECT * FROM orders
    R1-->>App: rows (as of the last replayed record)
```

| | **Physical (streaming) replication** | **Logical replication** |
|---|---|---|
| **What travels** | WAL bytes: changes to data pages | row changes (`INSERT`/`UPDATE`/`DELETE`) per table |
| **Replica** | an exact copy of the whole server, **read-only** | an independent database, writable |
| **Granularity** | everything (all databases) | chosen tables (publication / subscription) |
| **Versions** | same major version | can differ (used for upgrades) |
| **Used for** | high availability, read replicas | migrations, integrations, partial copies |

This hands-on uses **physical streaming replication**: the basis of high availability in PostgreSQL and of managed services such as Amazon RDS.

## Asynchronous or synchronous?

The question is *when* the primary answers `COMMIT ok`:

| | **Asynchronous** (default) | **Synchronous** |
|---|---|---|
| **Commit returns** | as soon as the WAL is on the primary's disk | only after a replica confirms it has the WAL |
| **Write latency** | low | + one network round trip |
| **If the primary dies** | ⚠️ the last commits may not have reached any replica: **lost writes** (RPO > 0) | ✅ no committed transaction is lost (RPO = 0) |
| **If the replica dies** | ✅ nothing changes | ⚠️ commits **block** until a replica is back (or the configuration changes) |
``` mermaid-sim
sequenceDiagram
    participant App as Service
    participant P as Primary
    participant R as Replica
    alt asynchronous (default)
        App->>P: INSERT
        P->>P: WAL on the primary's disk
        P-->>App: COMMIT ok
        P->>R: stream the WAL (a moment later)
        Note over P,R: if the primary dies before this, the commit is lost
    else synchronous
        App->>P: INSERT
        P->>P: WAL on the primary's disk
        P->>R: stream the WAL
        R-->>P: I have it
        P-->>App: COMMIT ok
        Note over App,R: one more round trip; if the replica is down, the commit waits
    end
```

This is the [CAP theorem](../../classes/distributed_systems/cap/index.md) in practice: synchronous replication prefers **consistency** (no committed write is lost) and gives up **availability** of writes when the replica is unreachable; asynchronous replication prefers availability and accepts that a reader of a replica may see **stale data** and that a failover may lose the last writes.

<div class="csim" data-sim="pg-cluster" data-script="sync"></div>

!!! tip "Try it"

    Before the lab, the same cluster in the browser: here it opens on experiment 5 of Replication. The simulator starts where the lab starts: `orders` with keyboard and mouse, both replicas streaming; play or → runs the page's commands, and the buttons work at any time. In **Replication 1–4**, with the replay paused, pg-replica1 shows 2 rows and pg-replica2 3, 184 bytes behind. In **Replication 5 (sync)**, with `FIRST 1 ("pg-replica1")` and that replica stopped, the `INSERT` of headset hangs; with `ANY 1`, webcam returns at once. In **Lost write**, after-failover gets id 34 and `pg_rewind` discards lost-write. In **free** mode, try what the lab does not: start the old primary without `pg_rewind` and watch two primaries appear.

## Architecture

``` mermaid-sim
flowchart LR
    app["service\n(account, order...)"]
    subgraph cluster [PostgreSQL cluster]
        p[("pg-primary\n:5432\nread-write")]
        r1[("pg-replica1\n:5433\nread-only")]
        r2[("pg-replica2\n:5434\nread-only")]
        p e1@-->|"WAL stream"| r1
        p e2@-->|"WAL stream"| r2
    end
    app e0@==>|"writes + reads"| p
    app e3@-.->|"reads"| r1
    app e4@-.->|"reads"| r2
    e0@{ animate: true }
    e1@{ animate: true }
    e2@{ animate: true }
```

- All three nodes run the official `postgres:17` image. A small entrypoint decides the role: an empty node **with** `PRIMARY_HOST` clones the primary with `pg_basebackup` and starts as a **hot standby** (it accepts reads).
- The application decides where each query goes. Here the routing lives in the **connection string**: libpq and the PostgreSQL JDBC driver accept a list of hosts and pick the one with the right role (`target_session_attrs` / `targetServerType`).

## Failover

When the primary fails, a replica must be **promoted** to primary, the other replicas must follow it, and the clients must find it. In this hands-on you do each step by hand, to see what an automatic tool does for you:

| Step | By hand (this hands-on) | Automated |
|---|---|---|
| detect the failure | `docker compose ps` | health checks, heartbeats |
| choose and promote a replica | `SELECT pg_promote();` | leader election |
| re-point the other replicas | `ALTER SYSTEM SET primary_conninfo` | the tool reconfigures them |
| redirect the clients | multi-host connection string | virtual IP, DNS, proxy (HAProxy, PgBouncer) |
| bring the old primary back | `pg_rewind` | the tool rewinds it |

``` mermaid-sim
sequenceDiagram
    participant A as Client A
    participant P as pg-primary
    participant M as Monitor
    participant R as pg-replica1
    participant B as Client B
    Note over P,M: the network between them breaks
    M-xP: health check (no answer)
    M->>R: pg_promote()
    A->>P: INSERT 'x' (pg-primary is alive)
    B->>R: INSERT 'y'
    Note over P,R: two primaries: 'x' only on one, 'y' only on the other
```

!!! warning "Split brain"

    The dangerous failure is not a dead primary, but a primary that **looks** dead — isolated by the network, yet still accepting writes. If a replica is promoted, the cluster has **two primaries** and the data diverges. Automatic failover therefore needs agreement among several nodes, a [consensus](../../classes/distributed_systems/consensus/index.md) algorithm: [Patroni](https://patroni.readthedocs.io){target="_blank"} keeps the leader lock in etcd (Raft), and managed services (RDS Multi-AZ, Aurora, Cloud SQL) do the same internally.

<div class="grid cards" markdown>

-   :material-file-code:{ .lg .middle } **[Docker Compose](./docker/)**

    ---

    Write `compose.yaml` and the scripts, start the cluster and check that both replicas are streaming.

    [Docker Compose](./docker/){ .md-button }

-   :material-database-sync:{ .lg .middle } **[Replication](./replication/)**

    ---

    Write on the primary, read on the replicas, provoke stale reads, route by role and turn on synchronous commits.

    [Replication](./replication/){ .md-button }

-   :material-swap-horizontal:{ .lg .middle } **[Failover](./failover/)**

    ---

    Stop the primary, promote a replica, re-point the cluster, lose a write on purpose and bring the old primary back.

    [Failover](./failover/){ .md-button }

</div>
