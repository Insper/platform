!!! abstract "In this lab"

    - Build **`inventory`**, the strongly consistent heart of BoxOffice: seats and **holds**, where one seat can never belong to two fans.
    - Compare three concurrency strategies under a flash sale — **naive check-then-act**, **pessimistic locking** (`SELECT … FOR UPDATE`) and **optimistic locking** (version column) — and *prove* which ones double-book[^2].
    - Add a **read replica** with streaming replication, route read-only transactions to it, and observe **replication lag** breaking read-your-writes.
    - Put **PgBouncer** between the services and PostgreSQL, and use **`EXPLAIN ANALYZE`** + indexes to fix the slow catalog listing.
    - **Measure** each change: conflicts, double bookings, p99, lag, connections, query time.

The flash sale is the moment BoxOffice exists for: at 10:00, 60,000 seats and two million fans. The catalog could be cached because a few seconds of staleness is harmless. **Seats are the opposite**: selling the same seat twice is the one bug a ticketing company cannot afford. This lab is about the data layer under pressure[^1] — correctness first (transactions and locks), then scale (replicas, pooling, indexes) — and about the trade-offs between them.

This lab builds chapter 6 of the [story of the course](../../index.md#story), the database that every stateless service now depends on. It implements the decisions of class 6: [one seat, one hold](../../classes/databases/transactions/index.md#double-booking) with locks or a version check, a [read replica and its lag](../../classes/databases/replication/index.md#lag), [connection pooling](../../classes/databases/replication/index.md) with PgBouncer, and [indexes read with `EXPLAIN`](../../classes/databases/models/index.md).

## Before you start { #before-you-start }

| | |
|---|---|
| **Time** | 4–5 hours (three parts: do one per sitting if needed) |
| **You need** | the tools of lab 0; Docker with **8 GB** (eleven containers, six JVMs); ports 80, 8080, 8083, 5432, **5433**, **6432**, 6379 free |
| **Directory** | every command runs from the root of your `boxoffice/` repository (Windows: inside WSL 2) |

``` { .bash .copy }
docker compose version        # Docker Compose v2.x (or newer)
java -version                 # 21 or newer
mvn -v                        # Apache Maven 3.9+
k6 version                    # k6 v1.0+
uv --version                  # uv (runs the Python helper scripts)
```

**Start state** — the end of lab 5:

``` { .tree title="boxoffice/ at the start of lab 6" }
boxoffice/
    docker-compose.yaml        # db, redis, catalog-1..3, auth, gateway, edge
    infra/nginx/nginx.conf
    load/ ...  scripts/ ...  results/ ...
    services/auth/  services/catalog/ (with the cache)  services/gateway/
```

!!! tip "Catch up"

    Skipped or broke lab 5? Download [boxoffice-after-lab-5.zip](../5/boxoffice-after-lab-5.zip), unzip it and `cd boxoffice`. This lab **adds** `services/inventory`, `infra/postgres/*`, `infra/pgbouncer/*`, the catalog migration `V3__index_events.sql`, four k6 files and `scripts/reset-inventory.sh`, and **replaces** `docker-compose.yaml` and the gateway's `application.yaml` and `SecurityConfig.java`; all are shown in full on the next pages and are in [`code/`](code/docker-compose.yaml). It also needs a **fresh database volume** (`docker compose down -v`, explained in step 2).

## Slides

<div class="slides-embed">
  <iframe src="slides/data-at-scale.html" title="Slides: hands-on 6 — data at scale" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/data-at-scale.html){:target="_blank"}

!!! info "Theory connection"

    - Class 6, [Databases](../../classes/databases/index.md): [transactions and isolation](../../classes/databases/transactions/index.md) (anomalies, `SELECT … FOR UPDATE` for seat holds), [replication](../../classes/databases/replication/index.md) (leader–follower, lag), indexes and B-trees.
    - Class 3, [Consistency models](../../classes/distributed/consistency/index.md): read-your-writes.
    - Case study: [Ticketing](../../classes/case-studies/ticketing/index.md) (the BoxOffice flash sale).
    - Component catalog: [SQL Database](../../reference/components/storage/index.md#sql).

## Before you measure: the playground

**Try it:** the `db-replicas` scenario has a primary and read replicas, with reads and writes split. Run it, then raise the share of writes: what happens to the primary while the replicas stay idle? Increase the replication lag and watch the "stale reads" indicator. Write down which kind of traffic replicas help with — and which they cannot help with at all.

<div class="sdp" data-scenario="db-replicas" data-mode="compact" data-height="500"></div>

Then look at the whole sale in `flash-sale`: the waiting room, inventory in SQL, payment. Lab 7 builds the waiting room; today you build the inventory box.

<div class="sdp" data-scenario="flash-sale" data-mode="compact" data-height="500"></div>

## What you will build

``` diagram-sim
flowchart LR
    k6([k6 fans]) --> edge[edge] --> gw[gateway]
    gw -->|"/catalog/**"| cat["catalog ×3"]
    gw -->|"/inventory/**"| inv["inventory :8083"]
    inv -->|"writes, holds<br/>(read-write tx)"| pgb["pgbouncer :6432"]
    pgb --> db[("db (primary)")]
    inv -->|"seat maps, availability<br/>(readOnly tx)"| rep[("db-replica")]
    db -->|"WAL streaming"| rep
    cat --> db
    cat --> redis[(redis)]
```

| Method | Path | Auth | Database | Answer |
|---|---|---|---|---|
| `GET` | `/inventory/events/{eventId}/availability` | open | replica | seats per section: available, held, sold |
| `GET` | `/inventory/events/{eventId}/seats?section=S01` | open | replica | the seat map of one section |
| `POST` | `/inventory/holds` `{eventId, seatIds}` | token | primary | `201` hold (10 min), `409` if any seat is taken |
| `GET` | `/inventory/holds/{id}` | token (owner) | primary | the hold |
| `POST` | `/inventory/holds/{id}/confirm` | token (owner) | primary | seats become `SOLD` (called by `order` in lab 7) |
| `DELETE` | `/inventory/holds/{id}` | token (owner) | primary | release the seats |
| `GET` | `/inventory/audit/double-bookings` | token | primary | `{"doubleBookedSeats": 0}` — the invariant |

Event **1** has **60,000 seats** (30 sections × 40 rows × 50 seats); events 2–100 have 500 seats each.

## Steps

<div class="grid cards" markdown>

-   :material-seat:{ .lg .middle } **[1. Holds and locking](holds/index.md)**

    ---

    The `inventory` service, three locking strategies, the flash-sale test and the double-booking audit.

-   :material-database-sync:{ .lg .middle } **[2. Replica and pooling](replicas/index.md)**

    ---

    Streaming replication, routing `readOnly` transactions, replication lag and read-your-writes, PgBouncer.

-   :material-magnify-scan:{ .lg .middle } **[3. Indexes and EXPLAIN](indexes/index.md)**

    ---

    Read a query plan, add the right indexes to the catalog listing, measure before and after.

</div>

## Measure it { #measure-it }

Each step has its own experiment; collect the results in `results/lab6.md`:

``` { .markdown title="results/lab6.md" .copy }
# Lab 6 — data at scale

## 1. Flash sale: 200 fans, 100 seats, 30 s (load/flash-sale.js)
| INVENTORY_LOCKING | holds 201 | holds 409 | p50 hold (ms) | p99 hold (ms) | double-booked seats (audit) |
|---|---:|---:|---:|---:|---:|
| naive       | | | | | |
| pessimistic | | | | | |
| optimistic  | | | | | |

## 2. Reads: availability + seat maps at 200 req/s (load/availability.js)
| Reads served by | p50 (ms) | p99 (ms) | CPU db (%) | CPU db-replica (%) |
|---|---:|---:|---:|---:|
| primary (DB_REPLICA_HOST=db) | | | | |
| replica | | | | |

## 3. Read-your-writes (load/read-your-writes.js)
| REPLICA_DELAY | stale_reads (%) |
|---|---:|
| 0  | |
| 1s | |

## 4. Connections
| Setup | connections in pg_stat_activity during the flash sale |
|---|---:|
| inventory → db directly (INVENTORY_DB_HOST=db, PORT=5432) | |
| inventory → pgbouncer | |
PgBouncer SHOW POOLS: cl_active ____ , sv_active ____ , cl_waiting ____

## 5. Catalog listing before/after the indexes (EXPLAIN ANALYZE + sweep)
| | Execution time (ms) | Plan (main node) | Capacity with p99 < 300 ms (req/s) |
|---|---:|---|---:|
| before (V2) | | | |
| after (V3)  | | | |

## Conclusions
- Which locking strategy would you ship for the flash sale, and why?
- Which reads may go to the replica, and which must not?
- Cache (lab 5) or index (lab 6) for the listing — or both? Justify with your numbers.
```

!!! note "If your numbers differ"

    Correctness results must match everywhere: `naive` ends with double bookings (how many varies run to run — 9 and 11 in runs for this lab; if you get 0, run it again or raise `VUS`), `pessimistic` and `optimistic` always end with 0. Latencies, stale-read percentages and connection counts depend on your machine; compare them between your own runs only.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `db-replica` restarts with `permission denied` on `replica-entrypoint.sh` | the script is not executable | `chmod +x infra/postgres/*.sh` and `docker compose up -d db-replica` |
| `db-replica` logs `no pg_hba.conf entry for replication connection` | the primary's volume is older than this lab, so `10-replication.sh` never ran | `docker compose down -v` and `docker compose up --build -d` (Flyway seeds everything again) |
| `db-replica` exits: `max_connections ... must be at least the primary's value` | `DB_MAX_CONNECTIONS` on the primary is above 100 | keep it ≤ 100, or also raise it on the replica |
| inventory logs `password authentication failed` via PgBouncer | `userlist.txt` does not match `DB_PASSWORD` | keep both at `boxoffice` (or update both) |
| `prepared statement "S_1" already exists` | a PgBouncer without `max_prepared_statements` (older image or edited ini) | use `edoburu/pgbouncer:v1.26.0-p0` and the ini of this page |
| `503`/`404` on `/inventory/**` through the edge | the gateway was not rebuilt with the new route | `docker compose up --build -d gateway`, then `curl -s localhost:8080/actuator/gateway/routes \| jq -r '.[].route_id'` must list `inventory` |
| holds return `401` | no token (holds are protected) | log in and pass `-H "Authorization: Bearer $TOKEN"` |
| containers killed (`exit 137`), very slow startup | not enough memory for eleven containers | give Docker 8 GB, close other programs, or stop `catalog-2`/`catalog-3` during the inventory experiments |

!!! success "Best practices in this lab"

    - **Decide in the database, not in the application** — `SELECT … FOR UPDATE` in `ORDER BY id`, or a version compare-and-set, in `HoldService.java`; see [Transactions — the double-booking bug](../../classes/databases/transactions/index.md#double-booking).
    - **Send reads that may be stale to the replica, and everything else to the primary** — `@Transactional(readOnly = true)` routed by `DataSourceConfig.java`; see [Replication — lag and its anomalies](../../classes/databases/replication/index.md#lag).
    - **Pool connections in front of PostgreSQL, and migrate around the pooler** — `pgbouncer.ini` in transaction mode, `DB_MIGRATION_HOST` for Flyway in `inventory`'s `application.yaml`; see [Replication](../../classes/databases/replication/index.md) (connection pooling).
    - **Add an index for a measured query, checked with `EXPLAIN ANALYZE`** — `V3__index_events.sql`; see [Data models & storage engines](../../classes/databases/models/index.md) (reading `EXPLAIN`).
    - **Audit the invariant after every test** — `SeatQueries.doubleBookedSeats` behind `/inventory/audit/double-bookings`; see [Transactions — seat holds](../../classes/databases/transactions/index.md#seat-holds).

## Clean up

``` { .bash .copy }
REPLICA_DELAY=0 docker compose up -d db-replica             # if you left the artificial lag on
INVENTORY_LOCKING=pessimistic docker compose up -d inventory
bash scripts/reset-inventory.sh                             # all seats back on sale
docker compose down                                         # keep the volumes for lab 7
```

Keep everything: lab 7 adds `order` and Kafka on top of this stack and confirms holds through `inventory`.

## Deliverable

- [ ] `services/inventory` running behind the gateway; the gateway routes `/inventory/**` (GETs on `/inventory/events/**` open, holds protected).
- [ ] The flash-sale table with the three strategies, including the **audit** result of each: at least one run of `naive` with double bookings > 0, and `pessimistic`/`optimistic` with 0.
- [ ] `db-replica` streaming (`pg_stat_replication` shows it), reads routed to it, and the read-your-writes experiment with and without `REPLICA_DELAY`.
- [ ] PgBouncer in front of the primary, with the connection counts.
- [ ] `EXPLAIN ANALYZE` of the catalog listing before and after `V3__index_events.sql`, and the sweep after.
- [ ] `results/lab6.md` complete with the three conclusions.
- [ ] Repository tagged `lab6`; [quiz](quiz.md) answered.

## End state

``` { .tree title="changed in lab 6" }
boxoffice/
    docker-compose.yaml        # replaced: + db-replica (5433), + pgbouncer (6432), + inventory (8083)
    infra/postgres/10-replication.sh  infra/postgres/replica-entrypoint.sh     # new
    infra/pgbouncer/pgbouncer.ini  infra/pgbouncer/userlist.txt               # new
    load/lib.js  load/flash-sale.js  load/availability.js  load/read-your-writes.js   # new
    scripts/reset-inventory.sh                                                # new
    services/inventory/        # new: seats, holds, three locking strategies, replica routing
    services/catalog/src/main/resources/db/migration/V3__index_events.sql    # new
    services/gateway/src/main/resources/application.yaml                     # replaced: + /inventory/** route
    services/gateway/src/main/java/boxoffice/gateway/SecurityConfig.java     # replaced: GET /inventory/events/** open
    results/lab6.md
```

Next: [Lab 7 — Async](../7/index.md), where `order` confirms holds through events.

[^1]: Martin Kleppmann and Chris Riccomini, *Designing Data-Intensive Applications*, 2nd ed., O'Reilly — chapters on transactions and replication.
[^2]: PostgreSQL documentation, [Explicit Locking](https://www.postgresql.org/docs/17/explicit-locking.html){target="_blank"}, [Log-Shipping Standby Servers](https://www.postgresql.org/docs/17/warm-standby.html){target="_blank"} and [Using EXPLAIN](https://www.postgresql.org/docs/17/using-explain.html){target="_blank"}.
