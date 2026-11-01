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

<div class="kicker">Platforms, Microservices, DevOps and APIs · Hands-on 9</div>

# Hands-on 9 — Database Cluster

**One primary, two replicas, streaming replication — and every trade-off you can provoke on a laptop**

<!--
Outline: (1) why a cluster, and what it does not solve; (2) the WAL and streaming replication;
(3) async vs sync, CAP; (4) the compose project; (5) experiments: lag, routing, sync commits;
(6) failover by hand, lost writes, pg_rewind; (7) why automation needs consensus.
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

## The compose project

<div class="cols">
<div>

- 3 × `postgres:17`, one volume each
- `pg-primary` `:5432`, `pg-replica1` `:5433`, `pg-replica2` `:5434`
- `PRIMARY_HOST` set → the node is a replica
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

<p class="small"><code>init-primary.sh</code>: role <code>replicator</code>, <code>wal_keep_size</code>, <code>wal_log_hints</code>, <code>pg_hba</code> rule — copied to every replica.</p>

---

## Check it

```bash
docker compose up -d --wait
docker compose exec pg-primary psql -U store \
  -c "SELECT application_name, state, sync_state FROM pg_stat_replication;"
```

```
 application_name | state     | sync_state
------------------+-----------+------------
 pg-replica1      | streaming | async
 pg-replica2      | streaming | async
```

- On a replica: `pg_is_in_recovery()` → `t`, `pg_stat_wal_receiver` → streaming from `pg-primary`.

---

## Experiments 1–3: copies, read-only, lag

- `CREATE TABLE` + `INSERT` on the primary → the rows appear on both replicas.
- `INSERT` on a replica → `cannot execute INSERT in a read-only transaction`.
- `pg_wal_replay_pause()` on `pg-replica1`, `INSERT` on the primary:
  - `pg-replica1` counts **2**, `pg-replica2` counts **3**
  - `pg_stat_replication` shows the bytes behind

<div class="warn">

**Read-your-writes**: "I created the order, but it is not in my list."

</div>

---

## Experiment 4: routing by role

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

## Experiment 5: synchronous commits

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

## Failover by hand

| Step | Command |
|---|---|
| primary fails | `docker compose stop pg-primary` |
| promote | `SELECT pg_promote();` on `pg-replica1` → **timeline 2** |
| clients | same connection string, `read-write` → `pg-replica1` |
| other replica | `ALTER SYSTEM SET primary_conninfo = 'host=pg-replica1 ...'` + reload |
| old primary | `rejoin-as-replica.sh` → `pg_rewind` + `standby.signal` |

<p class="small">Roles swapped, names stale: real clusters name nodes <code>pg-1</code>, <code>pg-2</code>… and ask <code>pg_is_in_recovery()</code>.</p>

---

## The lost write

- Stop both replicas, `INSERT 'lost-write'` → `INSERT 0 1`, then **kill** the primary.
- Start the replicas, promote `pg-replica1`: `lost-write` is **gone**.
- `pg_rewind` on the old primary: *servers diverged… rewinding* → it is discarded for good.

<div class="warn">

That is the **RPO** of async replication. Sync would have saved it — by **blocking** the `INSERT`.

</div>

<p class="small">ids 1, 2, <b>34</b>: sequences log values in batches of 32; never expect gapless <code>serial</code>.</p>

---

## Why not a failover script?

<div class="q">

The primary stops answering the health check. Is it dead?

</div>

- Or slow? Or cut off from the monitor but not from the clients?
- Promote a replica then → **two primaries**: split brain.
- **Patroni**: only the holder of the **leader key** in etcd (Raft, with TTL) runs as primary; an isolated primary demotes itself.
- Managed: RDS Multi-AZ, Aurora, Cloud SQL do the same for you.

---

## Takeaways

1. Replication copies the **WAL**: replicas are read-only, byte-identical copies.
2. It scales **reads** and gives **availability**; writes still go to one primary.
3. **Async**: fast, but stale reads and lost writes on a crash (RPO > 0).
4. **Sync** (`ANY 1`): RPO = 0, paid with latency and blocked writes.
5. Route by role in the **connection string**; it survives a failover.
6. Failover = promote, re-point, redirect, rewind — and deciding *when* needs **consensus**.
