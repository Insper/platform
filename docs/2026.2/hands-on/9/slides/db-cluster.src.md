---
marp: true
lang: en
title: Hands-on 9 — Database Cluster
description: Platforms, Microservices, DevOps and APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">Platforms, Microservices, DevOps and APIs · Hands-on 9</div>

# Hands-on 9 — Database Cluster

**One primary, two replicas, streaming replication — and every trade-off you can provoke on a laptop**

<!--
Outline: (1) why a cluster, and what it does not solve; (2) the WAL and streaming replication;
(3) async vs sync, CAP; (4) architecture and failover, by hand × automated; (5) Docker Compose: files,
start, check; (6) Replication: experiments 1–6; (7) Failover: planned, lost write, consensus, connecting
the platform.
-->

---

## One `db` container

<div class="q">

The gateway runs 3 replicas behind Nginx, Redis caches the reads. The `db` container stops. **What still works?**

</div>

- Writes stop, and so does every read that misses the cache.
- The database is the **single point of failure** that scaling the services did not remove.
- A **cluster** keeps copies of the data on several servers, so one can take over.

---

## What a cluster gives — and what it does not

| Goal | Gives | Does **not** give |
|---|---|---|
| **Availability** | a server with the data, ready to be promoted | zero downtime: failover takes seconds |
| **Read scaling** | `SELECT`s spread across replicas | **write** scaling: one primary takes every write |
| **Durability** | each commit on another machine | protection from a wrong `DELETE` (replicated too) |

<p class="small">Scaling writes = <b>sharding</b> (Citus, Vitess). This hands-on: <b>replication</b> — every node has all the data.</p>

---

## The WAL

- Before changing a page, PostgreSQL appends the change to the **write-ahead log**.
- After a crash, the server replays the WAL to recover.
- **Streaming replication** reuses it: the primary sends WAL records, each replica **replays** them.
- Result: byte-identical copies — so a replica is **read-only** and runs the **same major version**.

<div class="ok">

Physical replication copies **pages**; logical replication copies **row changes** per table (migrations, integrations).

</div>

---

## Asynchronous or synchronous?

When does the primary answer `COMMIT ok`?

| | **Async** (default) | **Sync** |
|---|---|---|
| Commit returns | WAL on the primary's disk | a replica confirmed the WAL |
| Write latency | low | + 1 network round trip |
| Primary dies | last commits may be **lost** (RPO > 0) | nothing committed is lost (RPO = 0) |
| Replica dies | nothing changes | commits **block** |

<div class="warn">

CAP in practice: sync prefers **consistency**, async prefers **availability**.

</div>

---

## When does `COMMIT ok` come back?

<div class="flow">
<div class="arrow" style="flex: .5; text-align: left">Async</div>
<div class="box">INSERT</div><div class="arrow">→</div>
<div class="box accent">WAL on the primary's disk</div><div class="arrow">→</div>
<div class="box green">COMMIT ok</div><div class="arrow">⋯</div>
<div class="box muted">the replica gets the WAL<small>a crash before this loses the commit</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .5; text-align: left">Sync</div>
<div class="box">INSERT</div><div class="arrow">→</div>
<div class="box accent">WAL on the primary's disk</div><div class="arrow">→</div>
<div class="box orange">a replica confirms<small>+1 round trip; waits if it is down</small></div><div class="arrow">→</div>
<div class="box green">COMMIT ok</div>
</div>

- Async: the client hears "ok" **before** any copy exists → **RPO > 0**.
- Sync: the client hears "ok" **after** a copy exists → **RPO = 0**, paid with latency and blocked commits.

<!--
The page's sequence diagram "Asynchronous or synchronous?" shows the same two paths step by step.
-->

---

## Architecture

<div class="flow" style="align-items: stretch">
<div class="box muted" style="flex: .55; display: flex; flex-direction: column; justify-content: center">service<small>account, order…</small></div>
<div class="arrow" style="align-self: center">writes + reads →</div>
<div class="box accent" style="display: flex; flex-direction: column; justify-content: center">pg-primary<small>:5432 · read-write</small></div>
<div class="arrow" style="align-self: center">WAL stream →</div>
<div class="group">
<div class="caption">hot standbys · reads</div>
<div class="box green">pg-replica1<small>:5433 · read-only</small></div>
<div class="box green">pg-replica2<small>:5434 · read-only</small></div>
</div>
</div>

- All three run `postgres:17`; an entrypoint picks the role: empty + `PRIMARY_HOST` → clone the primary with `pg_basebackup`.
- The **application** decides where each query goes: here, in the **connection string** (`target_session_attrs` / `targetServerType`).

<p class="small">Steps: <b>1</b> Docker Compose → <b>2</b> Replication (experiments) → <b>3</b> Failover.</p>

---

## Failover: by hand × automated

| Step | By hand (this hands-on) | Automated |
|---|---|---|
| detect the failure | `docker compose ps` | health checks, heartbeats |
| choose and promote a replica | `SELECT pg_promote();` | leader election |
| re-point the other replicas | `ALTER SYSTEM SET primary_conninfo` | the tool reconfigures them |
| redirect the clients | multi-host connection string | virtual IP, DNS, proxy (HAProxy, PgBouncer) |
| bring the old primary back | `pg_rewind` | the tool rewinds it |

<div class="warn">

**Split brain**: a primary that only *looks* dead keeps accepting writes → two primaries. Automation needs **consensus**.

</div>

---

<!-- _class: tight -->

## 1 · The compose project

`pgcluster/`: `compose.yaml` + `scripts/` (`node-entrypoint.sh`, `init-primary.sh`, `rejoin-as-replica.sh`)

<div class="cols">
<div>

- 3 × `postgres:17`, **one volume each**, shared via YAML anchors
- `cluster_name`: which node answered
- `PRIMARY_HOST` set → the node is a replica
- replicas have **no `depends_on`**: the entrypoint waits
- `client` (profile `tools`): `psql` inside the network

</div>
<div>

```bash
# node-entrypoint.sh, empty data dir
pg_basebackup -h "$PRIMARY_HOST" \
  -U "$REPLICATION_USER" \
  -D "$PGDATA" -X stream -R
# -R → standby.signal
#      + primary_conninfo
```

</div>
</div>

<p class="small"><code>init-primary.sh</code>: role <code>replicator</code>, <code>wal_keep_size</code>, <code>wal_log_hints</code>, <code>pg_hba</code> rule — copied to every replica. Save the scripts with <b>LF</b> line endings.</p>

---

<!-- _class: tight -->

## 1 · Start and check

```bash
docker compose up -d --wait     # returns when all three nodes are healthy
docker compose exec pg-primary psql -U store \
  -c "SELECT application_name, state, sync_state FROM pg_stat_replication;"
```

```
 application_name | state     | sync_state
------------------+-----------+------------
 pg-replica1      | streaming | async
 pg-replica2      | streaming | async
```

- `docker compose logs pg-replica1`: *cloning pg-primary … entering standby mode … started streaming WAL*.
- On a replica: `pg_is_in_recovery()` → `t`, `pg_stat_wal_receiver` → streaming from `pg-primary`.

---

## 1 · Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `$'\r': command not found` | scripts saved with CRLF: save as LF, recreate the cluster |
| replica loops on `no pg_hba.conf entry for replication connection` | primary created before `init-primary.sh` existed: recreate |
| `port is already allocated` on 5432 | the `db` of a previous hands-on is up: stop it or change the ports |
| replica stuck on `waiting for pg-primary...` | the primary is not up: `docker compose logs pg-primary` |

```bash
docker compose down -v && docker compose up -d --wait    # start over: one primary, two replicas
```

---

## 2 · Experiments 1–3: copies, read-only, lag

- `CREATE TABLE` + `INSERT` on the primary → the rows appear on both replicas.
- `INSERT` on a replica → `cannot execute INSERT in a read-only transaction`.
- `pg_wal_replay_pause()` on `pg-replica1`, `INSERT` on the primary:
  - `pg-replica1` counts **2**, `pg-replica2` counts **3**
  - `pg_stat_replication` shows the bytes behind

<div class="warn">

**Read-your-writes**: "I created the order, but it is not in my list."

</div>

---

## 2 · Experiment 4: routing by role

```bash
host=pg-primary,pg-replica1,pg-replica2 target_session_attrs=read-write
host=pg-primary,pg-replica1,pg-replica2 target_session_attrs=standby load_balance_hosts=random
```

```text
jdbc:postgresql://pg-primary:5432,pg-replica1:5432,pg-replica2:5432/store?targetServerType=primary
```

- The driver tries the hosts and keeps the one with the right role.
- The list names **candidates**, not *the* primary — it survives a failover.

---

## 2 · Experiment 5: synchronous commits

- `synchronous_standby_names = 'FIRST 1 ("pg-replica1")'` → `sync_state = sync`
- Stop `pg-replica1`, `INSERT` → **hangs**. Ctrl+C:

```
WARNING:  canceling wait for synchronous replication due to user request
DETAIL:  The transaction has already committed locally, but might not
         have been replicated to the standby.
```

- `ANY 1 ("pg-replica1", "pg-replica2")` → quorum: one replica may fail.

<div class="q">

Is the row committed? *(Yes — only the wait was cancelled.)*

</div>

---

## 2 · How long the primary waits

| `synchronous_commit` | Commit returns when the sync replica has… | Guarantees |
|---|---|---|
| `remote_write` | received the WAL (in memory) | survives a primary crash |
| `on` (default) | written the WAL to disk | survives a crash of both |
| `remote_apply` | **replayed** the WAL | a read on that replica sees the commit |

- `ANY 1` → both replicas show `sync_state = quorum`; one may be down.
- Back to async before the failover page: `ALTER SYSTEM RESET synchronous_standby_names;` + `pg_reload_conf()`.

---

## 2 · Experiment 6: under load (optional)

```bash
docker compose run --rm --entrypoint pgbench client -h pg-primary -i -s 10
docker compose run --rm --entrypoint pgbench client -h pg-primary -c 8 -T 30 -P 5
docker compose run --rm --entrypoint pgbench client -S -n -c 8 -T 15 \
  "host=pg-replica1,pg-replica2 load_balance_hosts=random"
```

- While writing, watch `replay_lag` in `pg_stat_replication`: the lag grows under load.
- The read-only run (`-S`) spreads over the replicas: **reads scale** with them.
- Repeat with `ANY 1`: the drop in write `tps` is the **price of RPO = 0**.

---

<!-- _class: tight -->

## 3 · Planned failover

| Step | Command |
|---|---|
| primary fails | `docker compose stop pg-primary` |
| promote | `SELECT pg_promote();` on `pg-replica1` → **timeline 2** |
| clients | same connection string, `read-write` → `pg-replica1` |
| other replica | `ALTER SYSTEM SET primary_conninfo = 'host=pg-replica1 ...'` + reload |
| old primary | `rejoin-as-replica.sh` → `pg_rewind` + `standby.signal` |

- Before the rejoin, `pg-primary` must be **stopped**: two servers on one data directory corrupt it.
- After a clean stop: *no rewind required* — the old primary wrote nothing the new one lacks.

<p class="small">Roles swapped, names stale: real clusters name nodes <code>pg-1</code>, <code>pg-2</code>… and ask <code>pg_is_in_recovery()</code>.</p>

---

## 3 · Unplanned failover: the lost write

- Stop both replicas, `INSERT 'lost-write'` → `INSERT 0 1`, then **kill** the primary.
- Start the replicas, promote `pg-replica1`: `lost-write` is **gone**.
- `pg_rewind` on the old primary: *servers diverged… rewinding* → it is discarded for good.

<div class="warn">

That is the **RPO** of async replication. Sync would have saved it — by **blocking** the `INSERT`.

</div>

<p class="small">ids 1, 2, <b>34</b>: sequences log values in batches of 32; never expect gapless <code>serial</code>.</p>

---

## The fork: where `lost-write` went

<div class="flow" style="align-items: stretch">
<div class="box" style="display: flex; flex-direction: column; justify-content: center">keyboard, mouse<small>timeline 1, on every node</small></div>
<div class="arrow" style="align-self: center">→</div>
<div class="group">
<div class="caption">after the fork</div>
<div class="box red">lost-write<small>only on the killed pg-primary, timeline 1</small></div>
<div class="box green">after-failover · id 34<small>pg-replica1 promoted, timeline 2</small></div>
</div>
<div class="arrow" style="align-self: center">→</div>
<div class="box orange" style="display: flex; flex-direction: column; justify-content: center">pg_rewind<small>cuts pg-primary back to the fork; it follows timeline 2</small></div>
</div>

- The client heard `INSERT 0 1` for `lost-write`: the order existed, then vanished.
- A planned stop has no red branch: *no rewind required*.

<!--
The page draws the same fork as a step-by-step diagram in "Unplanned failover: a lost write".
-->

---

## 3 · Why not a failover script?

<div class="q">

The primary stops answering the health check. Is it dead?

</div>

- Or slow? Or cut off from the monitor but not from the clients?
- Promote a replica then → **two primaries**: split brain.
- **Patroni**: only the holder of the **leader key** in etcd (Raft, with TTL) runs as primary; an isolated primary demotes itself.
- Managed: RDS Multi-AZ, Aurora, Cloud SQL do the same for you.

---

## 3 · Connecting the platform

```yaml
  account:
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://pg-primary:5432,pg-replica1:5432,pg-replica2:5432/store?targetServerType=primary
      SPRING_DATASOURCE_USERNAME: store
      SPRING_DATASOURCE_PASSWORD: devpass
```

- After a failover, HikariCP drops the broken connections and the driver finds the **new** primary.
- Reads on the replicas: a second `DataSource` (`preferSecondary`) + `AbstractRoutingDataSource` for `readOnly` — mind the stale reads.

<p class="small">Clean-up: <code>docker compose down -v</code> — without <code>-v</code> the cluster comes back with the roles it ended in.</p>

---

## Without Docker: the simulator

<div class="flow">
<div class="box accent">Replication 1–4<small>2 rows on the paused replica, 3 on the other, 184 bytes behind</small></div>
<div class="box orange">Replication 5 (sync)<small>FIRST 1 hangs, ANY 1 returns</small></div>
<div class="box green">Planned failover<small>promote, follow, no rewind required</small></div>
<div class="box red">Lost write<small>id 34, lost-write discarded</small></div>
</div>

- The pages embed the cluster of the lab as a simulator: same nodes, same commands, same outputs.
- Play runs a page step by step; the buttons work at any time.
- **Free** mode: start the old primary without `pg_rewind` → two primaries, **split brain**.

<!--
The simulator sits on the overview (opening on experiment 5), at the top of Replication and Failover, and in the lost-write section.
-->

---

## Takeaways

1. Replication copies the **WAL**: replicas are read-only, byte-identical copies.
2. It scales **reads** and gives **availability**; writes still go to one primary.
3. **Async**: fast, but stale reads and lost writes on a crash (RPO > 0).
4. **Sync** (`ANY 1`): RPO = 0, paid with latency and blocked writes.
5. Route by role in the **connection string**; it survives a failover.
6. Failover = promote, re-point, redirect, rewind — and deciding *when* needs **consensus**.
