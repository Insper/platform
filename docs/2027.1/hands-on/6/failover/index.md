At 10:01, one minute into the sale, the primary dies. The replica of [step 2](../replicas/index.md) has been serving seat maps; now it is also the only copy of the data that is still running. This step makes that spare useful: you make replication **synchronous** and pay for it, **crash** the primary with a hold in flight, **fail over** by hand, watch a **split brain** happen, and bring the old primary back with **`pg_rewind`**. At the end the stack is exactly as lab 7 expects it.

``` diagram-sim
sequenceDiagram
    autonumber
    participant F as Fan (Ana)
    participant P as db (primary)
    participant R as db-replica
    participant S as services
    F->>P: POST /inventory/holds (seats 20, 21)
    P-->>F: 201 Created (asynchronous: R does not have it yet)
    Note over P: crash
    S->>P: writes fail (504)
    S->>R: seat maps still work
    R->>R: pg_promote(): primary on a new timeline
    Note over R: the name "db" moves to R
    S->>R: writes resume, no configuration changed
    F->>R: GET /inventory/holds/{id}
    R-->>F: 404: the hold was lost
```

Every command runs from the root of your `boxoffice/` repository, with the stack of [step 2](../replicas/index.md#3-compose) running.

<div class="csim" data-sim="boxoffice-db" data-script="crash"></div>

!!! tip "Try it"

    The whole step in the browser: here the simulator opens on the crash (sections 3 and 4). The simulator starts from the stack of step 2: `db` primary, `db-replica` streaming asynchronously, every seat on sale; play or → runs the lab's commands, and the buttons work at any time. In **Replica**, with `REPLICA_DELAY=1s`, Ana's hold answers `201` but the seat map read right after still shows seat 1 AVAILABLE; 1 s later it is HELD. In **Synchronous**, `remote_apply` makes the hold take 1.03 s and the read fresh; with `db-replica` stopped, the hold on seat 10 gets 504 after 5 s, and seat 10 is HELD anyway. In **Crash**, the probes give 200 for the seat map and 504 for the rest; after `pg_promote()` and the moved name, 15 s later every path answers, and Ana's hold is 404. In **Split brain**, two primaries disagree about seat 20, `pg_rewind` discards Ana's hold, and the switchback ends on timeline 3. In **free** mode, try what the lab warns about: `start` instead of `up --no-deps`, or `pg_rewind` without `wal_log_hints`.

## 1. Prepare the cluster { #prepare }

Two small changes to the scripts of step 2. The primary turns on `wal_log_hints`, which `pg_rewind` needs in section 6:

``` { .bash title="infra/postgres/10-replication.sh" .copy linenums="1" hl_lines="7-8" }
--8<-- "docs/2027.1/hands-on/6/code/infra/postgres/10-replication.sh"
```

The replica gets a name, `cluster_name=db-replica`: it is how the primary refers to it in `pg_stat_replication` and in `synchronous_standby_names`. `pg_basebackup` also gets `-c fast`, which makes a fresh clone start at once instead of waiting minutes for a checkpoint (you will clone again in section 7):

``` { .bash title="infra/postgres/replica-entrypoint.sh" .copy linenums="1" hl_lines="8 13-15" }
--8<-- "docs/2027.1/hands-on/6/code/infra/postgres/replica-entrypoint.sh"
```

`10-replication.sh` runs only when the volume is created, and yours already exists, so set the option by hand (`ALTER SYSTEM` writes it to `postgresql.auto.conf`, inside the data directory) and restart. `--force-recreate` makes the replica container pick up the new script:

``` { .bash .copy }
docker compose exec db psql -U boxoffice -c "ALTER SYSTEM SET wal_log_hints = on"
docker compose restart db
docker compose up -d --force-recreate --wait db-replica
docker compose exec db psql -U boxoffice -c "SHOW wal_log_hints" \
  -c "SELECT application_name, state, sync_state FROM pg_stat_replication"
```

You should see:

``` { .text }
 wal_log_hints
---------------
 on

 application_name |   state   | sync_state
------------------+-----------+------------
 db-replica       | streaming | async
```

Log in as Ana (the user of [step 1](../holds/index.md#5-check-it-by-hand); register her first if your volume is new) and keep the token for the whole step:

``` { .bash .copy }
curl -s -X POST localhost/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"Ana","email":"ana@example.com","password":"secret-123"}' > /dev/null
export TOKEN=$(curl -s -X POST localhost/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"ana@example.com","password":"secret-123"}' | jq -r .accessToken)
```

## 2. Synchronous replication { #synchronous }

So far the primary answers `COMMIT` as soon as the write-ahead log (WAL) is on **its own** disk: if it dies a moment later, the replica may never receive that transaction. `synchronous_standby_names` makes the primary wait for a standby before it answers:

``` { .bash .copy }
docker compose exec -T db psql -U boxoffice <<'SQL'
ALTER SYSTEM SET synchronous_standby_names = 'FIRST 1 ("db-replica")';
SELECT pg_reload_conf();
SELECT pg_sleep(1);          -- the primary re-reads its standbys right after the reload
SELECT application_name, sync_state FROM pg_stat_replication;
SQL
```

`sync_state` becomes `sync` (`potential` means it was read too early: run the `SELECT` again). The double quotes are not decoration: without them, PostgreSQL reads `db-replica` as `db` minus `replica` and rejects the setting with `syntax error at or near "-"`.

**How long does it wait?** `synchronous_commit` decides, per transaction:

| `synchronous_commit` | `COMMIT` returns when the WAL is… | A crash of the primary loses | Stale reads on the replica |
|---|---|---|---|
| `local` | on the primary's disk | ⚠️ the last transactions | ⚠️ yes |
| **`on`** (default) | on the primary's **and the standby's** disk | ✅ nothing | ⚠️ **yes**: on disk is not replayed yet |
| `remote_apply` | **replayed** on the standby | ✅ nothing | ✅ **no** |

``` diagram-sim
sequenceDiagram
    participant I as inventory
    participant P as db (primary)
    participant R as db-replica
    I->>P: COMMIT (the hold)
    P->>P: write the WAL to the primary's disk
    Note over I,P: local returns here
    P->>R: stream the WAL
    R->>R: write the WAL to the replica's disk
    R-->>P: flushed
    Note over P,R: on (the default) returns here
    R->>R: replay it, after REPLICA_DELAY
    R-->>P: replayed
    Note over P,R: remote_apply returns here
    P-->>I: COMMIT ok
```

Measure the last two columns with the read-your-writes test of step 2, with the artificial lag of 1 second:

``` { .bash .copy }
REPLICA_DELAY=1s docker compose up -d --wait db-replica
bash scripts/reset-inventory.sh && k6 run load/read-your-writes.js      # synchronous_commit = on
docker compose exec db psql -U boxoffice -c "ALTER SYSTEM SET synchronous_commit = 'remote_apply'" -c "SELECT pg_reload_conf()"
bash scripts/reset-inventory.sh && k6 run load/read-your-writes.js      # remote_apply
docker compose exec db psql -U boxoffice -c "ALTER SYSTEM RESET synchronous_commit" -c "SELECT pg_reload_conf()"
REPLICA_DELAY=0 docker compose up -d --wait db-replica
```

In two runs for this lab:

| `synchronous_commit` (replica 1 s behind) | `stale_reads` | `iteration_duration` (avg) |
|---|---:|---:|
| `on` | 93–100% | 45–380 ms |
| `remote_apply` | **0%** | **2 s** |

`remote_apply` fixes read-your-writes completely, and each iteration now takes 2 seconds: the hold waits for the replica to replay it (1 s), and so does the release at the end (1 s). Lag stops being a staleness problem and becomes a **latency** problem for every write.

!!! warning "Never turn `remote_apply` on for the whole server"

    Set this way, it applies to every transaction of every service: with the replica 1 s behind, registering one fan in `auth` took **1.1 s** in a test run, and every k6 script that creates fans slows down with it. If one operation needs it, ask for it in that transaction only: `SET LOCAL synchronous_commit = remote_apply` inside the hold's transaction.

**When the replica fails.** Synchronous replication with one standby makes that standby a single point of failure for **writes**:

``` { .bash .copy }
bash scripts/reset-inventory.sh
docker compose stop db-replica
curl -s -o /dev/null -w "hold: %{http_code} after %{time_total}s\n" --max-time 10 -X POST localhost/inventory/holds \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"eventId":1,"seatIds":[10]}'
curl -s -o /dev/null -w "seat map: %{http_code}\n" localhost/inventory/events/1/availability
docker compose exec db psql -U boxoffice -c "UPDATE inventory.seats SET version = version WHERE id = 1"
```

The hold gets `504` after 5 s (the gateway's timeout), the seat map `504` too (its reads go to the replica), and the `UPDATE` **hangs**. Press ++ctrl+c++:

``` { .text }
Cancel request sent
WARNING:  canceling wait for synchronous replication due to user request
DETAIL:  The transaction has already committed locally, but might not have been replicated to the standby.
UPDATE 1
```

"Already committed locally": cancelling does not undo anything. Bring the replica back and look at seat 10:

``` { .bash .copy }
docker compose start db-replica
docker compose exec db psql -U boxoffice -c "SELECT id, status FROM inventory.seats WHERE id = 10"
```

Seat 10 is `HELD`. The fan saw an error, and the hold exists. A client that retries must therefore be able to recognise its own earlier attempt (an idempotency key, see [delivery semantics](../../../classes/messaging/semantics/index.md)), or it will get `409` for a seat it already holds.

With two or more standbys, `ANY 1 (a, b)` waits for whichever answers first: one replica can fail without stopping writes. That is the usual production setup, and what managed services call a synchronous standby. Go back to asynchronous replication for the rest of the step:

``` { .bash .copy }
docker compose exec db psql -U boxoffice -c "ALTER SYSTEM RESET synchronous_standby_names" -c "SELECT pg_reload_conf()"
```

## 3. The primary dies { #crash }

On one machine, the replica is only milliseconds behind, too little to lose a write on demand. Stop it for a moment to open that window: Ana's hold reaches the primary and **only** the primary.

``` { .bash .copy }
bash scripts/reset-inventory.sh
docker compose stop db-replica
export HOLD_ID=$(curl -s -X POST localhost/inventory/holds -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"eventId":1,"seatIds":[20,21]}' | tee /dev/stderr | jq -r .id)
docker compose kill db
docker compose up -d --no-deps db-replica
```

The hold answered `201` with status `ACTIVE`: for Ana, seats 20 and 21 are hers. Then `kill` (not `stop`): no clean shutdown, as in a real crash.

!!! warning "`--no-deps`, not `docker compose start db-replica`"

    `db-replica` depends on `db`, so a plain start brings the dead primary back too, and there is nothing left to fail over. `up -d --no-deps` starts only the service you name.

What still works? Give `inventory` a few seconds to reconnect to the restarted replica, then probe each path of the stack (keep this terminal: the next sections reuse `probe`, `$TOKEN` and `$HOLD_ID`):

``` { .bash .copy }
sleep 10
probe() { curl -s -o /dev/null --max-time 10 -w "%{http_code} %{time_total}s  $1\n" "${@:2}"; }
probe "seat map (replica)"  localhost/inventory/events/1/availability
probe "hold (primary)"      -X POST localhost/inventory/holds -H "Authorization: Bearer $TOKEN" \
                              -H 'Content-Type: application/json' -d '{"eventId":1,"seatIds":[30]}'
probe "login (auth → db)"   -X POST localhost/auth/login -H 'Content-Type: application/json' \
                              -d '{"email":"ana@example.com","password":"secret-123"}'
probe "event 1 (catalog)"   localhost/catalog/events/1
```

You should see:

``` { .text }
200 0.58s  seat map (replica)
504 5.01s  hold (primary)
504 5.03s  login (auth → db)
504 5.01s  event 1 (catalog)
```

The replica keeps the seat maps alive: a read replica is also a little **availability**. Everything that writes, and everything that reads from the primary, waits until the gateway gives up. (A catalog entry still in Redis would answer `200` until its time to live (TTL) expires: the cache of lab 5 is another layer that hides a database outage, for a while.)

## 4. Fail over { #failover }

A failover is two decisions: **which** node becomes the primary, and **how the clients find it**. Promote the replica:

``` { .bash .copy }
docker compose exec db-replica psql -U boxoffice -c "SELECT pg_promote()" -c "SELECT pg_is_in_recovery()"
```

`pg_is_in_recovery` = `f`: `db-replica` now accepts writes, on a new **timeline** (its history forks from the old primary's here). But every service still connects to the name `db`: PgBouncer, `auth`, the three `catalog`s, `inventory`'s migrations. Instead of reconfiguring all of them, **move the name**. Docker's Domain Name System (DNS) server answers `db` with the address of whatever container holds that alias on the network:

``` { .bash .copy }
docker network disconnect boxoffice_default boxoffice-db-replica-1
docker network connect --alias db --alias db-replica boxoffice_default boxoffice-db-replica-1
docker compose exec pgbouncer getent hosts db db-replica
```

``` { .text }
172.23.0.3        db  db
172.23.0.3        db-replica  db-replica
```

Both names now lead to the new primary. This is what a managed database does on failover: RDS points the endpoint's DNS name at the standby, other setups move a virtual IP or reconfigure a proxy. The clients notice only that their connections broke. Run the probes again, twice, 15 seconds apart:

``` { .bash .copy }
sleep 15; probe "hold" -X POST localhost/inventory/holds -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"eventId":1,"seatIds":[40]}'
probe "login" -X POST localhost/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"ana@example.com","password":"secret-123"}'
probe "event 1" localhost/catalog/events/1
```

In a run for this lab, the first round right after the move still had `504`s; 15 seconds later everything answered `200`/`201`. The pools drop their broken connections and open new ones, and each process resolves `db` again (the Java virtual machine, JVM, caches a name for 30 s, PgBouncer for up to 15 s). No file changed, no service restarted.

Now look for Ana's hold:

``` { .bash .copy }
curl -s localhost/inventory/holds/$HOLD_ID -H "Authorization: Bearer $TOKEN" | jq -c '{status, title}'
docker compose exec db-replica psql -U boxoffice -c "SELECT id, status FROM inventory.seats WHERE id IN (20, 21)"
```

``` { .text }
{"status":404,"title":"Not Found"}
 id |  status
----+-----------
 20 | AVAILABLE
 21 | AVAILABLE
```

**The hold is gone**, and seats 20 and 21 are back on sale: another fan can buy them, while Ana has a `201` that says they are hers. The hold existed only in the WAL of the dead primary. This is the **RPO** (recovery point objective) of asynchronous replication: whatever was committed but not yet shipped. Section 2 is the price of making it zero.

!!! info "One node, no spare"

    The stack runs, but on a single database: `db-replica` is also the primary now, and the seat maps share it with the writes. Until section 7 there is no copy left to fail over to.

## 5. Split brain { #split-brain }

What if the old primary was not dead, only unreachable (a frozen VM, a cut network), and comes back? Start it as it is:

``` { .bash .copy }
docker compose start db
sleep 5
docker compose exec pgbouncer getent ahosts db | awk '{print $1}' | sort -u
for s in db db-replica; do
  echo "$s: primary=$(docker compose exec -T $s psql -U boxoffice -qAt -c 'SELECT NOT pg_is_in_recovery()')," \
       "seat 20=$(docker compose exec -T $s psql -U boxoffice -qAt -c 'SELECT status FROM inventory.seats WHERE id = 20')"
done
```

``` { .text }
172.23.0.3
172.23.0.8
db: primary=t, seat 20=HELD
db-replica: primary=t, seat 20=AVAILABLE
```

Two primaries, one name, two answers about seat 20. Each new connection to `db` lands on either one: PgBouncer could put Ana's next hold on one server and the audit on the other, and both would answer happily. Nothing here can tell which one is right. That is a **split brain**.

``` diagram-sim
sequenceDiagram
    participant I as inventory via PgBouncer
    participant N as Docker DNS
    participant P1 as db (old primary, timeline 1)
    participant P2 as db-replica (primary, timeline 2)
    I->>N: who is db?
    N-->>I: 172.23.0.8 and 172.23.0.3
    I->>P1: connection 1: Ana's next hold
    P1-->>I: 201, seat 20 is HELD here
    I->>P2: connection 2: the audit
    P2-->>I: seat 20 is AVAILABLE here
    Note over P1,P2: both accept writes: two histories that nothing can merge
```

**Fence** the old primary before anything writes to it:

``` { .bash .copy }
docker compose stop db
```

In production, a human doing this by hand at 10:01 is too slow and too risky. A failover manager such as Patroni keeps a **leader key** in etcd, renewed every few seconds: a primary that cannot renew it demotes itself, and a node can only promote if it holds the key. That is consensus deciding who the leader is ([Consensus & quorums](../../../classes/distributed/consensus/index.md)), and fencing making sure the loser stops (in the extreme, STONITH: "shoot the other node in the head").

<div class="csim" data-sim="boxoffice-db" data-script="split-brain"></div>

!!! tip "Try it"

    Here the simulator opens where section 4 ends, to replay sections 5 to 7. The simulator starts from the stack of step 2: `db` primary, `db-replica` streaming asynchronously, every seat on sale; play or → runs the lab's commands, and the buttons work at any time. In **Replica**, with `REPLICA_DELAY=1s`, Ana's hold answers `201` but the seat map read right after still shows seat 1 AVAILABLE; 1 s later it is HELD. In **Synchronous**, `remote_apply` makes the hold take 1.03 s and the read fresh; with `db-replica` stopped, the hold on seat 10 gets 504 after 5 s, and seat 10 is HELD anyway. In **Crash**, the probes give 200 for the seat map and 504 for the rest; after `pg_promote()` and the moved name, 15 s later every path answers, and Ana's hold is 404. In **Split brain**, two primaries disagree about seat 20, `pg_rewind` discards Ana's hold, and the switchback ends on timeline 3. In **free** mode, try what the lab warns about: `start` instead of `up --no-deps`, or `pg_rewind` without `wal_log_hints`.

## 6. Rejoin the old primary with `pg_rewind` { #rejoin }

The old primary's data directory has a history the new primary never had: Ana's lost hold, then the seat 20 write of the split brain. It cannot simply follow the new primary. `pg_rewind` finds where the two timelines forked, copies back from the new primary every block that changed since then, and throws away what only the old one had:

``` diagram-sim
flowchart LR
    c["common history<br/>timeline 1"]
    ana["Ana's hold, seats 20 and 21<br/>only on the old db"]:::problem
    tl2["pg_promote() on db-replica<br/>timeline 2, the hold on seat 40"]:::comp
    rw["pg_rewind: copy back the changed blocks,<br/>cut db at the fork"]
    f["db follows timeline 2<br/>as a standby"]:::comp
    c -->|"db kept writing"| ana
    c -->|"failover"| tl2
    ana -.->|"discarded"| rw
    rw --> f
    tl2 -->|"WAL"| f
```

``` { .bash title="infra/postgres/rejoin-as-replica.sh" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/infra/postgres/rejoin-as-replica.sh"
```

It needs the data directory but not a running server, so it runs in a one-off container of the `db` service, with the scripts folder mounted:

``` { .bash .copy }
chmod +x infra/postgres/*.sh
docker compose run --rm --no-deps -v ./infra/postgres:/scripts:ro --entrypoint bash db \
  /scripts/rejoin-as-replica.sh db-replica
```

``` { .text }
pg_rewind: connected to server
pg_rewind: servers diverged at WAL location 0/819D798 on timeline 1
pg_rewind: rewinding from last common checkpoint at 0/819B9C0 on timeline 1
pg_rewind: reading source file list
pg_rewind: reading target file list
pg_rewind: reading WAL in target
pg_rewind: need to copy 133 MB (total source directory size is 207 MB)
...
pg_rewind: Done!
rejoin: db will follow db-replica on its next start
```

``` { .bash .copy }
docker compose start db
sleep 5
docker compose exec db psql -U boxoffice -c "SELECT pg_is_in_recovery()" -c "SELECT status FROM inventory.seats WHERE id = 20"
docker compose exec db-replica psql -U boxoffice -c "SELECT application_name, state FROM pg_stat_replication"
```

`db` is now a replica (`pg_is_in_recovery` = `t`), seat 20 is `AVAILABLE` on both (the split-brain write was discarded), and `db-replica` lists it as `walreceiver`, `streaming`. Without `wal_log_hints`, `pg_rewind` stops with `target server needs to use either data checksums or "wal_log_hints = on"`, and the only way back is a full copy.

!!! warning "Until section 7, `db` resolves to two containers"

    The name `db` belongs to the `db` service, and you gave it to `db-replica` too. A write that lands on `db`, now a read-only standby, fails with `cannot execute INSERT in a read-only transaction`. Treat the next section as a maintenance window and do it right away.

## 7. Switch back { #switchback }

A **switchover** is a failover you plan: nothing crashes, so nothing is lost. It puts the primary back on `db` and leaves the stack exactly as it was before this step, which is what lab 7 expects.

``` { .bash .copy }
docker compose exec db-replica psql -U boxoffice -c "SELECT pg_current_wal_lsn(), replay_lsn FROM pg_stat_replication"
docker compose stop db-replica
docker compose exec db psql -U boxoffice -c "SELECT pg_promote()" -c "SELECT pg_is_in_recovery()"
```

The two LSNs are equal: `db` has replayed everything. A clean shutdown also waits until every connected standby has received the last WAL record, so the `stop` loses nothing. Writes pause between `stop` and `pg_promote()`, a few seconds.

`db-replica` is now an old primary in turn. It could rejoin with `pg_rewind` as in section 6; for a database this size, a fresh clone is simpler. Recreating the container also drops the alias you added by hand:

``` { .bash .copy }
docker compose rm -sf db-replica
docker volume rm boxoffice_replica-data
docker compose up -d --wait db-replica
docker compose exec db psql -U boxoffice -c "SELECT application_name, state, sync_state FROM pg_stat_replication"
docker compose exec pgbouncer getent hosts db db-replica
```

``` { .text }
 application_name |   state   | sync_state
------------------+-----------+------------
 db-replica       | streaming | async

172.23.0.8        db  db
172.23.0.3        db-replica  db-replica
```

One name, one address each, and the primary is `db` again (on timeline 3: one fork per promotion). A last check of the whole stack:

``` { .bash .copy }
probe "seat map" localhost/inventory/events/1/availability
probe "hold"     -X POST localhost/inventory/holds -H "Authorization: Bearer $TOKEN" \
                   -H 'Content-Type: application/json' -d '{"eventId":1,"seatIds":[90]}'
probe "login"    -X POST localhost/auth/login -H 'Content-Type: application/json' \
                   -d '{"email":"ana@example.com","password":"secret-123"}'
probe "event 1"  localhost/catalog/events/1
curl -s localhost/inventory/audit/double-bookings -H "Authorization: Bearer $TOKEN"; echo
bash scripts/reset-inventory.sh
```

Every probe answers `200` or `201`, and the audit says `{"doubleBookedSeats":0}`.

## 8. What you did by hand { #in-production }

| Step | By hand in this lab | In production |
|---|---|---|
| Detect the failure | you killed it | health checks with a timeout (Patroni, RDS): too short fails over on a garbage-collection (GC) pause, too long means minutes without writes |
| Choose the new primary | the only replica | the most up-to-date standby, chosen by consensus (leader key in etcd) |
| Promote | `pg_promote()` | the failover manager |
| Move the clients | a Docker network alias | DNS (RDS endpoint), a virtual IP, a proxy (HAProxy, PgBouncer reconfigured), or multi-host connection strings (`targetServerType=primary`) |
| Fence the old primary | `docker compose stop db` | leader-key expiry, STONITH, fencing tokens |
| Rejoin it | `pg_rewind` + `standby.signal` | the failover manager runs `pg_rewind` |
| Decide what may be lost | asynchronous: the last hold | `synchronous_standby_names = 'ANY 1 (…)'` with two standbys: RPO 0 without one replica stopping writes |

Managed services (RDS Multi-AZ, Cloud SQL high availability, Azure zone-redundant high availability) run all of this for you, typically in tens of seconds to a couple of minutes. Your design still has to decide what the application does meanwhile: retry with backoff, show "try again", hold the request in a queue (lab 7). See [Replication — failover](../../../classes/databases/replication/index.md#failover-when-the-leader-dies) for the theory.

??? question "Think first: Ana got `201`, the hold was lost, and the seats were sold to someone else. Whose problem is it, and what could have prevented it?"

    The database kept its promise: asynchronous replication says, by definition, that the last commits can be lost. The **design** decided that holds may be lost. Options, from cheapest: accept it and detect it (in lab 7, confirming the lost hold fails with `404`, and Ana is told the seats are gone); make only holds wait for a replica (`ANY 1` over two replicas, `synchronous_commit = local` as the server default, and `SET LOCAL synchronous_commit = on` in the hold's transaction); or use storage that replicates before it acknowledges (Aurora, Spanner, CockroachDB), paying the latency on every write.

!!! tip "In the interview"

    When you draw a primary and a replica, say what happens when the primary dies: **RPO** (what is lost: asynchronous = the last commits, synchronous = nothing), **RTO** (how long writes are down: detection + promotion + clients reconnecting), **split brain** (who decides the leader, and how the old one is fenced), and **how clients find the new primary** (DNS, a virtual IP (VIP), proxy, driver). "We add a replica for high availability" is incomplete without those four.

Back to the [lab overview](../index.md#measure-it) to record the results.
