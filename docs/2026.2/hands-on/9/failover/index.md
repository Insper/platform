Start from a clean cluster, so the output matches the one below:

``` { .bash .copy .select }
docker compose down -v
docker compose up -d --wait
docker compose exec pg-primary psql -U store -c "CREATE TABLE orders (id serial PRIMARY KEY, item text NOT NULL, created_at timestamptz DEFAULT now());" -c "INSERT INTO orders (item) VALUES ('keyboard'), ('mouse');"
```

<div class="csim" data-sim="pg-cluster" data-script="failover"></div>

!!! tip "Try it"

    The simulator runs this page: here it opens on the planned failover. The simulator starts where the lab starts: `orders` with keyboard and mouse, both replicas streaming; play or → runs the page's commands, and the buttons work at any time. In **Replication 1–4**, with the replay paused, pg-replica1 shows 2 rows and pg-replica2 3, 184 bytes behind. In **Replication 5 (sync)**, with `FIRST 1 ("pg-replica1")` and that replica stopped, the `INSERT` of headset hangs; with `ANY 1`, webcam returns at once. In **Lost write**, after-failover gets id 34 and `pg_rewind` discards lost-write. In **free** mode, try what the lab does not: start the old primary without `pg_rewind` and watch two primaries appear.

## 1. Planned failover

### The primary goes down

``` { .bash .copy .select }
docker compose stop pg-primary
```

A client that needs to write finds no primary:

``` { .bash .copy .select }
docker compose run --rm client "host=pg-primary,pg-replica1,pg-replica2 target_session_attrs=read-write connect_timeout=2" -c "SELECT 1;"
```

```
psql: error: could not translate host name "pg-primary" to address: Name or service not known
connection to server at "pg-replica1" (172.18.0.3), port 5432 failed: session is read-only
connection to server at "pg-replica2" (172.18.0.4), port 5432 failed: session is read-only
```

(The first line may also read `Connection refused`.) The replicas are still up and still answer reads — the data is not lost, but writes are **unavailable**. The replicas keep trying to reconnect:

``` { .bash .copy .select }
docker compose logs --tail 3 pg-replica2
```

```
FATAL:  could not connect to the primary server: connection to server at "pg-primary" (172.18.0.2), port 5432 failed: Connection refused
LOG:  waiting for WAL to become available at 0/4038AB8
```

### Promote a replica

``` { .bash .copy .select }
docker compose exec pg-replica1 psql -U store -c "SELECT pg_promote();"
```

`pg-replica1` leaves recovery, starts a new **timeline** (2) and accepts writes:

``` { .bash .copy .select }
docker compose logs --tail 4 pg-replica1
docker compose exec pg-replica1 psql -U store -c "SELECT pg_is_in_recovery();" -c "INSERT INTO orders (item) VALUES ('after-failover');"
```

```
LOG:  selected new timeline ID: 2
LOG:  database system is ready to accept connections
...
 pg_is_in_recovery
-------------------
 f

INSERT 0 1
```

The timeline marks the fork in the history: WAL on timeline 2 belongs to the new primary, and any server still on timeline 1 is a copy of the past.

### The clients find the new primary

Run **the same command** that failed a minute ago:

``` { .bash .copy .select }
docker compose run --rm client "host=pg-primary,pg-replica1,pg-replica2 target_session_attrs=read-write connect_timeout=2" -Atc "SELECT current_setting('cluster_name');"
```

```
pg-replica1
```

No configuration changed in the client: the driver tried the list again and kept the host that accepts writes. (A service already connected to the old primary loses its connections and must reconnect — connection pools such as HikariCP do this automatically.)

### Re-point the other replica

`pg-replica2` still streams from `pg-primary`, which no longer exists. Tell it where the new primary is; `primary_conninfo` takes effect with a reload, no restart:

``` { .bash .copy .select }
docker compose exec pg-replica2 psql -U store -c "ALTER SYSTEM SET primary_conninfo = 'host=pg-replica1 user=replicator password=replpass';" -c "SELECT pg_reload_conf();"
```

``` { .bash .copy .select }
docker compose logs --tail 3 pg-replica2
docker compose exec pg-replica2 psql -U store -c "SELECT count(*) FROM orders;" -c "SELECT status, sender_host, received_tli FROM pg_stat_wal_receiver;"
```

```
LOG:  new target timeline is 2
LOG:  restarted WAL streaming at 0/5000000 on timeline 2
...
 count
-------
     3

  status   | sender_host | received_tli
-----------+-------------+--------------
 streaming | pg-replica1 |            2
```

`pg-replica2` followed the timeline switch and already has the `after-failover` row.

### Bring the old primary back, as a replica

The old primary must **not** start as a primary again: there would be two primaries (split brain). `rejoin-as-replica.sh` runs `pg_rewind` against the new primary — it discards anything the old primary wrote after the fork — and adds `standby.signal` and `primary_conninfo`, like `pg_basebackup -R` did for the replicas. Run it in a one-off container that mounts the old primary's volume:

!!! warning "The node must be stopped"

    Check with `docker compose ps` that `pg-primary` is **not** running before you run the script: two servers on the same data directory corrupt it.

``` { .bash .copy .select }
docker compose run --rm --no-deps --entrypoint bash pg-primary /scripts/rejoin-as-replica.sh pg-replica1
```

```
pg_rewind: connected to server
pg_rewind: servers diverged at WAL location 0/4038AA0 on timeline 1
pg_rewind: no rewind required
rejoin: pg-primary will follow pg-replica1 on its next start
```

"No rewind required": the timelines split right after the old primary's last WAL record (its shutdown checkpoint, sent to the replicas during a clean stop), so it wrote nothing that the new primary lacks — nothing to discard. Start it:

``` { .bash .copy .select }
docker compose start pg-primary
docker compose exec pg-replica1 psql -U store -c "SELECT application_name, state FROM pg_stat_replication;"
```

```
 application_name |   state
------------------+-----------
 pg-replica2      | streaming
 pg-primary       | streaming
```

The cluster is whole again, with the roles swapped. The names `pg-primary` and `pg-replica1` no longer describe the roles — which is why real clusters name nodes neutrally (`pg-1`, `pg-2`, `pg-3`) and always ask a node its role (`pg_is_in_recovery()`).

``` mermaid-sim
stateDiagram-v2
    direction LR
    state "pg-primary: primary" as P1
    state "pg-primary: down" as P2
    state "pg-primary: replica of pg-replica1" as P3
    P1 --> P2: docker compose stop
    P2 --> P3: pg_rewind + standby.signal
    state "pg-replica1: replica" as R1
    state "pg-replica1: primary (timeline 2)" as R2
    R1 --> R2: pg_promote()
```

## 2. Unplanned failover: a lost write

A planned stop loses nothing. A **crash** with asynchronous replication can. To make it reproducible, keep the replicas away from the last write: stop them, write on the primary, and *kill* it.

``` { .bash .copy .select }
docker compose down -v
docker compose up -d --wait
docker compose exec pg-primary psql -U store -c "CREATE TABLE orders (id serial PRIMARY KEY, item text NOT NULL, created_at timestamptz DEFAULT now());" -c "INSERT INTO orders (item) VALUES ('keyboard'), ('mouse');"
```

``` { .bash .copy .select }
docker compose stop pg-replica1 pg-replica2
docker compose exec pg-primary psql -U store -c "INSERT INTO orders (item) VALUES ('lost-write');"
docker compose kill pg-primary
docker compose start pg-replica1 pg-replica2
```

The `INSERT` answered `INSERT 0 1`: for the client, the order **exists**. Now fail over as before:

``` { .bash .copy .select }
docker compose exec pg-replica1 psql -U store -c "SELECT pg_promote();" -c "INSERT INTO orders (item) VALUES ('after-failover');" -c "SELECT * FROM orders ORDER BY id;"
docker compose exec pg-replica2 psql -U store -c "ALTER SYSTEM SET primary_conninfo = 'host=pg-replica1 user=replicator password=replpass';" -c "SELECT pg_reload_conf();"
```

```
 id |      item      |          created_at
----+----------------+-------------------------------
  1 | keyboard       | 2026-10-31 18:51:44.203097+00
  2 | mouse          | 2026-10-31 18:51:44.203097+00
 34 | after-failover | 2026-10-31 18:51:50.223978+00
```

`lost-write` is **gone**: it existed only in the WAL of the dead primary. This is the **RPO** (*recovery point objective*) of asynchronous replication — the commits of the last instant before a crash. (The jump from 2 to 34 is not a bug: a sequence logs its values in batches of 32, and a failover skips the rest of the batch. Never expect `serial` ids without gaps.)

Now rejoin the old primary. Its data directory still has `lost-write`, on timeline 1, after the fork — this time `pg_rewind` has work to do:

``` { .bash .copy .select }
docker compose run --rm --no-deps --entrypoint bash pg-primary /scripts/rejoin-as-replica.sh pg-replica1
```

```
pg_rewind: executing "/usr/lib/postgresql/17/bin/postgres" for target server to complete crash recovery
...
pg_rewind: servers diverged at WAL location 0/5038A28 on timeline 1
pg_rewind: rewinding from last common checkpoint at 0/3000130 on timeline 1
...
pg_rewind: Done!
rejoin: pg-primary will follow pg-replica1 on its next start
```

``` { .bash .copy .select }
docker compose start pg-primary
docker compose exec pg-primary psql -U store -c "SELECT pg_is_in_recovery();" -c "SELECT item FROM orders ORDER BY id;"
```

`pg-primary` is now a replica and agrees with the new primary: `lost-write` was discarded for good.

``` mermaid-sim
flowchart LR
    c["keyboard, mouse\ntimeline 1"]
    lw["lost-write\nonly on the dead pg-primary"]
    af["after-failover (id 34)\npg-replica1, timeline 2"]
    rw["pg_rewind cuts pg-primary\nback to the fork"]
    c e1@-->|"pg-primary keeps writing"| lw
    c e2@-->|"pg_promote()"| af
    lw e3@-.->|"discarded"| rw
    rw e4@-->|"follows timeline 2"| af
```

<div class="csim" data-sim="pg-cluster" data-script="lost-write"></div>

!!! tip "Try it"

    The simulator replays this section: here it opens on the lost write. The simulator starts where the lab starts: `orders` with keyboard and mouse, both replicas streaming; play or → runs the page's commands, and the buttons work at any time. In **Replication 1–4**, with the replay paused, pg-replica1 shows 2 rows and pg-replica2 3, 184 bytes behind. In **Replication 5 (sync)**, with `FIRST 1 ("pg-replica1")` and that replica stopped, the `INSERT` of headset hangs; with `ANY 1`, webcam returns at once. In **Lost write**, after-failover gets id 34 and `pg_rewind` discards lost-write. In **free** mode, try what the lab does not: start the old primary without `pg_rewind` and watch two primaries appear.

!!! question "Would synchronous replication have saved `lost-write`?"

    Yes, but not for free. With `synchronous_standby_names = 'ANY 1 (...)'`, the `INSERT` would not have answered while both replicas were down — it would have **blocked** (experiment 5 of [Replication](../replication/index.md#5-synchronous-replication)). The client would never have been told the order existed. RPO = 0 is paid with write availability: CAP again.

## 3. Why not automate it with a script?

Everything you did by hand fits in a script. The hard part is the first step — deciding that the primary is dead:

- A primary that does not answer the health check may be **slow**, or **isolated** from the monitor but not from the clients. Promoting a replica then creates **two primaries** accepting different writes: a *split brain*, much worse than a few seconds of downtime.
- The monitor itself may fail, or two monitors may disagree.

That is why automatic failover is built on [consensus](../../../classes/distributed_systems/consensus/index.md): in [Patroni](https://patroni.readthedocs.io){target="_blank"}, each node runs an agent, and only the agent that holds the **leader key** in etcd (Raft) may run as primary. The key has a TTL: an isolated primary cannot renew it and **demotes itself** before a replica is promoted. Managed services (Amazon RDS Multi-AZ, Aurora, Google Cloud SQL) run the same logic for you.

``` mermaid-sim
sequenceDiagram
    participant P as pg-1 (primary)
    participant E as etcd (Raft)
    participant R as pg-2 (replica)
    P->>E: renew the leader key (TTL 30 s)
    E-->>P: ok, you are the leader
    Note over P,E: the network between pg-1 and etcd breaks
    P-xE: renew the leader key
    P->>P: cannot renew: demote itself
    R->>E: the key expired: take it
    E-->>R: ok, you are the leader
    R->>R: promote
```

## 4. Connecting the platform

The services of the previous hands-on read the JDBC URL from `spring.datasource.url`, which the environment variable `SPRING_DATASOURCE_URL` overrides. To point the `account` service at the cluster (with the cluster's services in the same `compose.yaml`), list the nodes and ask for the primary:

``` { .yaml .copy .select title="compose.yaml" hl_lines="3" }
  account:
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://pg-primary:5432,pg-replica1:5432,pg-replica2:5432/store?targetServerType=primary
      SPRING_DATASOURCE_USERNAME: store
      SPRING_DATASOURCE_PASSWORD: devpass
```

After a failover, HikariCP drops the broken connections and the driver finds the new primary. Sending the **reads** to the replicas needs a second `DataSource` with `targetServerType=preferSecondary` and a router that picks it for `@Transactional(readOnly = true)` methods (Spring's `AbstractRoutingDataSource`) — a good exercise, as long as you remember the stale reads of experiment 3.

## Clean-up

``` { .bash .copy .select }
docker compose down -v
```

`-v` removes the three volumes; without it the cluster, with whatever roles it ended in, comes back on the next `up`.

## Checklist

- [ ] Both replicas appear as `streaming` in `pg_stat_replication`.
- [ ] A row inserted on the primary is read on both replicas; an `INSERT` on a replica fails.
- [ ] With replay paused, a replica returns stale data, and `bytes_behind` shows it.
- [ ] `target_session_attrs=read-write` finds the primary, before and after a failover.
- [ ] With `FIRST 1 ("pg-replica1")` and that replica stopped, a commit blocks; with `ANY 1` it does not.
- [ ] After a crash failover, you can explain why `lost-write` disappeared and what would have prevented it.
- [ ] The old primary rejoins as a replica with `pg_rewind`.
