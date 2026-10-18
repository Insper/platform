During the sale, for every fan who holds a seat, dozens look at the seat map. Those reads do not need the primary: a **read replica** — a copy of the database kept up to date by streaming the primary's write-ahead log (WAL) — can serve them. Two costs come with it: the copy is **slightly behind** (replication lag), and you now route queries to two places. This step also adds **PgBouncer**, because every replica of every service opening its own pool of connections is how PostgreSQL runs out of connections.

## 1. Streaming replication

``` mermaid-sim
sequenceDiagram
    autonumber
    participant I as inventory
    participant P as db (primary)
    participant R as db-replica (hot standby)
    Note over R: first start: pg_basebackup copies the primary
    I->>P: BEGIN; UPDATE seats ...; COMMIT
    P->>P: write WAL record, flush
    P-->>I: COMMIT ok (asynchronous replication: does not wait for R)
    P->>R: stream WAL
    R->>R: replay (after recovery_min_apply_delay)
    I->>R: SELECT availability (readOnly tx)
    R-->>I: result, possibly a few ms old
```

The primary needs a user allowed to replicate. This script runs **once**, when the primary's volume is created:

``` { .bash title="infra/postgres/10-replication.sh" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/infra/postgres/10-replication.sh"
```

The replica clones the primary on its first start and then follows it:

``` { .bash title="infra/postgres/replica-entrypoint.sh" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/infra/postgres/replica-entrypoint.sh"
```

!!! warning "Recreate the database volume"

    `10-replication.sh` only runs on an **empty** data directory. Your `db-data` volume exists since lab 1, so recreate it (Flyway seeds everything again on startup): `docker compose down -v` before the first `up` of this lab. Remember to `chmod +x infra/postgres/*.sh`.

## 2. PgBouncer

Each PostgreSQL connection is an operating-system **process** with its own memory; a few hundred are fine, thousands are not. Count the clients: 3 catalog replicas × 10 + auth × 10 + inventory × 20 × 2 pools… and in lab 10 Kubernetes will autoscale replicas. **PgBouncer** accepts many cheap client connections and multiplexes them onto a small pool of real ones.

``` { .ini title="infra/pgbouncer/pgbouncer.ini" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/infra/pgbouncer/pgbouncer.ini"
```

``` { .text title="infra/pgbouncer/userlist.txt" .copy }
--8<-- "docs/2027.1/hands-on/6/code/infra/pgbouncer/userlist.txt"
```

| Pool mode | A server connection is lent for… | Breaks |
|---|---|---|
| `session` | the whole client connection | nothing, but saves little |
| **`transaction`** | one transaction | session state: `SET`, session advisory locks, `LISTEN`, temp tables |
| `statement` | one statement | multi-statement transactions |

Transaction pooling is what makes PgBouncer effective — and why **Flyway does not go through it**: migrations use session-level locks. `inventory` therefore has two hosts: `DB_HOST=pgbouncer` for the application, `DB_MIGRATION_HOST=db` for Flyway.

## 3. Compose { #3-compose }

``` { .yaml title="docker-compose.yaml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/docker-compose.yaml"
```

``` { .bash .copy }
chmod +x infra/postgres/*.sh
docker compose down -v
docker compose up --build -d
docker compose exec db psql -U boxoffice -c "SELECT client_addr, state, sent_lsn, replay_lsn FROM pg_stat_replication"
docker compose exec db-replica psql -U boxoffice -c "SELECT pg_is_in_recovery(), now() - pg_last_xact_replay_timestamp() AS lag"
```

The `lag` column is the time since the replica replayed the last transaction: while the primary is idle it keeps growing even though the replica is fully up to date. Compare `sent_lsn` and `replay_lsn` on the primary for the real distance.

<!-- termynal -->
``` shell
> docker compose exec db psql -U boxoffice -c "SELECT client_addr, state FROM pg_stat_replication"
 client_addr |   state
-------------+-----------
 172.22.0.4  | streaming
> docker compose exec db-replica psql -U boxoffice -c "INSERT INTO inventory.holds VALUES (gen_random_uuid(), 1, 'x', 'ACTIVE', now(), now())"
ERROR:  cannot execute INSERT in a read-only transaction
```

## 4. Routing reads to the replica

``` { .java title="services/inventory/src/main/java/boxoffice/inventory/DataSourceConfig.java" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/java/boxoffice/inventory/DataSourceConfig.java"
```

`LazyConnectionDataSourceProxy` hands out a placeholder connection when a transaction starts and fetches the real one at the first statement — by then Spring knows whether the transaction is `readOnly`, and picks the pool. The rule becomes an annotation:

| Method | Annotation | Goes to | Why |
|---|---|---|---|
| `SeatQueries.availability`, `seats` | `@Transactional(readOnly = true)` | **replica** | browsing; a few ms of staleness is fine |
| `HoldService.hold`, `confirm`, `release` | `@Transactional` | primary | writes |
| `HoldService.find` | `@Transactional` | primary | **read-your-writes**: the fan just created this hold |
| `SeatQueries.doubleBookedSeats` | `@Transactional` | primary | an audit must not be stale |

Both pools publish metrics (`hikaricp.connections.active{pool=primary|replica}`): check them while a test runs, `curl -s 'localhost:8083/actuator/metrics/hikaricp.connections.active?tag=pool:replica' | jq`.

## 5. Experiments

**Replica offload.** Run the read load against the replica, then point the "replica" pool at the primary and run it again — no code change:

``` { .javascript title="load/availability.js" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/load/availability.js"
```

``` { .bash .copy }
k6 run -e RATE=200 load/availability.js                     # reads on db-replica
DB_REPLICA_HOST=db docker compose up -d inventory && sleep 25
k6 run -e RATE=200 load/availability.js                     # reads on the primary
docker compose up -d inventory                              # back to the replica
```

Keep `docker stats` open: the CPU moves from `db` to `db-replica`. The seat-map latency barely changes — a replica does not make a query faster, it **adds capacity** and keeps reads from competing with the writes of the sale.

**Read-your-writes.** A fan holds a seat and immediately reloads the seat map, served by the replica:

``` { .javascript title="load/read-your-writes.js" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/load/read-your-writes.js"
```

``` { .bash .copy }
bash scripts/reset-inventory.sh && k6 run load/read-your-writes.js    # lag ~ milliseconds
REPLICA_DELAY=1s docker compose up -d db-replica && sleep 10
bash scripts/reset-inventory.sh && k6 run load/read-your-writes.js    # lag of 1 second
REPLICA_DELAY=0 docker compose up -d db-replica
```

Even with no artificial delay, `stale_reads` is not zero: in a test run for this lab it was **about 6%** — the replica on the same machine is only milliseconds behind, but the fan's next request arrives within milliseconds too. With `REPLICA_DELAY=1s` it was **98%**: almost no fan **saw their own hold** on the seat map, although `GET /inventory/holds/{id}` (primary) shows it. In production, lag grows with write volume, network distance and long queries on the replica — exactly during a flash sale.

Ways out: read your own recent writes from the primary (what `find` does), route a user to the primary for a few seconds after they write ("sticky" reads), or wait until the replica has replayed the write's LSN (log sequence number).

**PgBouncer.** Count connections during the flash sale, with and without the pooler:

``` { .bash .copy }
# during load/flash-sale.js:
docker compose exec db psql -U boxoffice -c "SELECT usename, application_name, count(*) FROM pg_stat_activity GROUP BY 1, 2"
docker compose exec -e PGPASSWORD=boxoffice db psql -h pgbouncer -p 6432 -U boxoffice pgbouncer -c "SHOW POOLS"

# without PgBouncer:
INVENTORY_DB_HOST=db INVENTORY_DB_PORT=5432 docker compose up -d inventory
```

In a test run for this lab, `pg_stat_activity` showed about 60 application connections: 30 from the three catalog replicas, 10 from `auth`, and 20 from PgBouncer — which served all of `inventory`'s client connections. `SHOW POOLS` showed `cl_active` 20 against `sv_active` + `sv_idle` + `sv_used` ≤ 20.

Push it: restart with `DB_MAX_CONNECTIONS=80 INVENTORY_POOL_SIZE=40 docker compose up -d`. Through PgBouncer everything works (PostgreSQL still sees at most 20 connections from it). Directly against `db` (`INVENTORY_DB_HOST=db INVENTORY_DB_PORT=5432`), 30 + 10 + 40 connections plus the reserved superuser slots exceed 80, and `inventory` fails with `FATAL: sorry, too many clients already`. A pooler turns "too many clients" into **queueing** (`cl_waiting`).

!!! tip "In the interview"

    "Add read replicas" is only an answer for **read-heavy** load that tolerates **staleness**. Say which reads go to replicas, how you handle read-your-writes, and what happens to writes — replicas do nothing for them; that needs partitioning (class 6) or less work per write.

Next: [3. Indexes and EXPLAIN](../indexes/index.md).
