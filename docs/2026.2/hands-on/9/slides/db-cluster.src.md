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
Outline: (1) why a cluster and what it does not solve; (2) the WAL and streaming replication;
(3) async × sync, CAP; (4) architecture and failover, by hand × automated, split brain;
(5) Docker Compose: files, the role of each node, start, check; (6) Replication: experiments 1–6;
(7) Failover: planned, lost write, consensus, connecting the platform; (8) the simulator.
-->

---

## One `db` container

<div class="q">

The gateway runs 3 replicas behind Nginx, Redis caches the reads. The `db` container stops. **What still works?**

</div>

<div class="flow" style="font-size: 1.25em; align-items: stretch">
<div class="box muted" style="flex: .6; display: flex; flex-direction: column; justify-content: center">clients</div>
<div class="arrow" style="align-self: center">→</div>
<div class="box" style="flex: .7; display: flex; flex-direction: column; justify-content: center">Nginx</div>
<div class="arrow" style="align-self: center">→</div>
<div class="group">
<div class="caption">gateway × 3</div>
<div class="box green">gateway</div>
<div class="box green">gateway</div>
<div class="box green">gateway</div>
</div>
<div class="arrow" style="align-self: center">→</div>
<div class="box green" style="display: flex; flex-direction: column; justify-content: center">account, order…<small>scale at will</small></div>
<div class="arrow" style="align-self: center">→</div>
<div class="group">
<div class="caption">data</div>
<div class="box accent">Redis<small>only what is cached</small></div>
<div class="box red">db stopped<small>single point of failure</small></div>
</div>
</div>

- Writes stop, and so does every read that misses the cache.
- A **cluster** keeps copies of the data on several servers, so one can take over.

---

## What a cluster gives — and what it does not

| Goal | ✅ Gives | ❌ Does **not** give |
|---|---|---|
| **Availability** | a server with the data, ready to be promoted | zero downtime: failover takes seconds |
| **Read scaling** | `SELECT`s spread across replicas | **write** scaling: one primary takes every write |
| **Durability** | each commit on another machine | protection from a wrong `DELETE` (replicated too: that is what backups are for) |

<div class="flow" style="font-size: 1.1em">
<div class="box accent">Replication · this hands-on<small>every node holds <b>all</b> the data; one primary writes</small></div>
<div class="arrow">≠</div>
<div class="box orange">Sharding · Citus, Vitess<small>the data split across independent primaries: scales the writes</small></div>
</div>

---

## The WAL (write-ahead log)

<div class="flow" style="font-size: 1.2em; align-items: stretch">
<div class="box" style="flex: .6; display: flex; flex-direction: column; justify-content: center">INSERT</div>
<div class="arrow" style="align-self: center">→</div>
<div class="box accent" style="display: flex; flex-direction: column; justify-content: center">the primary's WAL<small>append-only, written before the page</small></div>
<div class="arrow" style="align-self: center">stream →</div>
<div class="group">
<div class="caption">each replica replays the WAL</div>
<div class="box green">pg-replica1<small>byte-identical copy</small></div>
<div class="box green">pg-replica2<small>byte-identical copy</small></div>
</div>
</div>

- Before changing a page, PostgreSQL appends the change to the WAL; after a crash, it replays the WAL to recover.
- **Streaming replication** reuses the same log: identical copies, so a replica is **read-only** and runs the **same major version**.

<div class="ok">

**Physical** replication copies pages (high availability, read replicas); **logical** replication copies row changes per table (migrations, upgrades, integrations).

</div>

---

## Asynchronous or synchronous?

When does the primary answer `COMMIT ok`?

| | **Async** (default) | **Sync** |
|---|---|---|
| Commit returns | WAL on the primary's disk | a replica confirmed the WAL |
| Write latency | low | + 1 network round trip |
| Primary dies | last commits may be **lost** | nothing committed is lost |
| Replica dies | nothing changes | commits **block** |

<p class="small"><b>RPO</b> (recovery point objective): how much committed data a crash may lose. Async: RPO &gt; 0; sync: RPO = 0.</p>

<div class="warn">

CAP theorem (consistency, availability, partition tolerance) in practice: sync prefers **consistency**, async prefers **availability**.

</div>

---

## When does `COMMIT ok` come back?

<div style="font-size: 1.2em">
<div class="flow">
<div class="arrow" style="flex: .45; text-align: left">Async</div>
<div class="box">INSERT</div><div class="arrow">→</div>
<div class="box accent">WAL on the primary's disk</div><div class="arrow">→</div>
<div class="box green">COMMIT ok</div><div class="arrow">⋯</div>
<div class="box red">the replica gets the WAL<small>a crash before this loses the commit</small></div>
</div>
<div class="flow" style="margin-top: .6em">
<div class="arrow" style="flex: .45; text-align: left">Sync</div>
<div class="box">INSERT</div><div class="arrow">→</div>
<div class="box accent">WAL on the primary's disk</div><div class="arrow">→</div>
<div class="box orange">a replica confirms<small>+1 round trip; waits if it is down</small></div><div class="arrow">→</div>
<div class="box green">COMMIT ok</div>
</div>
</div>

- Async: the client hears "ok" **before** any copy exists → <span class="chip red">RPO &gt; 0</span>
- Sync: the client hears "ok" **after** a copy exists → <span class="chip green">RPO = 0</span>, paid with latency and blocked commits.

<!--
The page's sequence diagram "Asynchronous or synchronous?" shows the same two paths step by step.
-->

---

## Architecture

<div class="flow" style="font-size: 1.2em; align-items: stretch">
<div class="box muted" style="flex: .6; display: flex; flex-direction: column; justify-content: center">service<small>account, order…</small></div>
<div style="display: flex; flex-direction: column; justify-content: space-around">
<div class="arrow">writes + reads ⇒</div>
<div class="arrow" style="font-weight: 400">reads (optional) ⇢ replicas</div>
</div>
<div class="box accent" style="display: flex; flex-direction: column; justify-content: center">pg-primary<small>:5432 · read-write</small></div>
<div class="arrow" style="align-self: center">WAL stream →</div>
<div class="group">
<div class="caption">hot standbys · reads</div>
<div class="box green">pg-replica1<small>:5433 · read-only</small></div>
<div class="box green">pg-replica2<small>:5434 · read-only</small></div>
</div>
</div>

- All three run `postgres:17`; an entrypoint picks the role of each node.
- The **application** decides where each query goes: here, in the **connection string** (`target_session_attrs` / `targetServerType`).

<div class="flow">
<div class="box accent">1 · Docker Compose<small>files, start, check</small></div><div class="arrow">→</div>
<div class="box orange">2 · Replication<small>experiments 1–6</small></div><div class="arrow">→</div>
<div class="box red">3 · Failover<small>planned, lost write, consensus</small></div>
</div>

---

## Failover: by hand × automated

| Step | By hand (this hands-on) | Automated |
|---|---|---|
| detect the failure | `docker compose ps` | health checks, heartbeats |
| choose and promote a replica | `SELECT pg_promote();` | leader election |
| re-point the other replicas | `ALTER SYSTEM SET primary_conninfo` | the tool reconfigures them |
| redirect the clients | multi-host connection string | virtual IP, DNS, proxy (HAProxy, PgBouncer) |
| bring the old primary back | `pg_rewind` | the tool rewinds it |

<p class="small">The hard step is the first one: deciding that the primary is <b>really</b> dead.</p>

---

## Split brain: the primary that only *looks* dead

<div class="flow" style="font-size: 1.15em; align-items: stretch">
<div class="group">
<div class="caption">one side of the partition</div>
<div class="box muted">Client A<small>INSERT 'x'</small></div>
<div class="arrow">↓</div>
<div class="box accent">pg-primary<small>alive, still accepts writes</small></div>
</div>
<div class="box red" style="flex: .45; display: flex; flex-direction: column; justify-content: center">✂ network<small>breaks between them</small></div>
<div class="group">
<div class="caption">the other side</div>
<div class="box muted">Monitor<small>health check unanswered → pg_promote()</small></div>
<div class="arrow">↓</div>
<div class="box accent">pg-replica1<small>promoted</small></div>
<div class="arrow">↑</div>
<div class="box muted">Client B<small>INSERT 'y'</small></div>
</div>
</div>

<div class="warn">

**Two primaries**: `'x'` only on one, `'y'` only on the other, the data diverge. That is why automation needs **consensus**.

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

<p class="small"><code>init-primary.sh</code>: role <code>replicator</code>, <code>wal_keep_size</code>, <code>wal_log_hints</code>, <code>pg_hba</code> rule — copied to every replica. Save the scripts with <b>LF</b> line endings (not CRLF, the Windows ones).</p>

---

## 1 · How each node picks its role

<div style="font-size: 1.15em">
<div class="flow">
<div class="box">the container starts</div><div class="arrow">→</div>
<div class="box orange">data directory already initialised?</div><div class="arrow">yes →</div>
<div class="box muted">start PostgreSQL<small>primary or standby, as it was</small></div>
</div>
<div class="flow" style="margin-top: .5em">
<div class="arrow" style="flex: .55; text-align: right">no →</div>
<div class="box orange">PRIMARY_HOST set?</div><div class="arrow">no →</div>
<div class="box">initdb + init-primary.sh</div><div class="arrow">→</div>
<div class="box accent">new primary</div>
</div>
<div class="flow" style="margin-top: .5em">
<div class="arrow" style="flex: .55; text-align: right">yes →</div>
<div class="box">wait for the primary</div><div class="arrow">→</div>
<div class="box">pg_basebackup -X stream -R<small>copy of the primary</small></div><div class="arrow">→</div>
<div class="box green">hot standby<small>read-only, receiving the WAL</small></div>
</div>
</div>

- A node that already has data comes back **in the role it ended in**: after a failover, `pg-primary` may be a replica.
- That is why `docker compose down -v` (removes the volumes) is how you start over with the original roles.

<!--
The same flow plays step by step on the Docker Compose page, in "How it works".
-->

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

<div class="flow" style="font-size: 1.1em">
<div class="arrow" style="flex: .5; text-align: left">logs pg-replica1</div>
<div class="box muted">waiting for pg-primary</div><div class="arrow">→</div>
<div class="box orange">cloning pg-primary<small>pg_basebackup</small></div><div class="arrow">→</div>
<div class="box">entering standby mode</div><div class="arrow">→</div>
<div class="box green">started streaming WAL</div>
</div>

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

<div class="matrix" style="--n: 3; font-size: 1.2em">
<div></div><div class="head">keyboard</div><div class="head">mouse</div><div class="head">monitor · INSERT on the primary</div>
<div class="row">pg-primary</div><div class="box green">✓</div><div class="box green">✓</div><div class="box green">✓</div>
<div class="row">pg-replica1 · replay paused</div><div class="box green">✓</div><div class="box green">✓</div><div class="box red" style="flex-direction: column">missing<small>184 bytes behind</small></div>
<div class="row">pg-replica2</div><div class="box green">✓</div><div class="box green">✓</div><div class="box green">✓</div>
</div>

- 1 · `CREATE TABLE` + `INSERT` on the primary → the rows appear on the replicas, through the WAL.
- 2 · `INSERT` on a replica → `cannot execute INSERT in a read-only transaction`.
- 3 · `pg_wal_replay_pause()` on `pg-replica1`: it counts **2** rows, `pg-replica2` counts **3**; `pg_stat_replication` shows the bytes behind.

---

## 2 · Read-your-writes: the stale read

<div class="flow" style="font-size: 1.15em">
<div class="box muted">user creates an order</div><div class="arrow">→</div>
<div class="box accent">INSERT on pg-primary</div><div class="arrow">→</div>
<div class="box green">COMMIT ok</div><div class="arrow">→</div>
<div class="box muted">"list my orders"</div><div class="arrow">→</div>
<div class="box orange">SELECT on pg-replica1<small>lagging</small></div><div class="arrow">→</div>
<div class="box red">"where is my order?"</div>
</div>

- The WAL reaches the replica — too late for that read.
- Lag grows under heavy load, long queries on the replica or a slow network.

<div class="ok">

Fixes: read from the **primary** right after a write (for that user, for a few seconds), or `remote_apply` (experiment 5) for the queries that must not see stale data.

</div>

---

<!-- _class: tight -->

## 2 · Experiment 4: routing by role

<div class="flow" style="font-size: 1.15em">
<div class="box accent">driver<small>target_session_attrs=read-write</small></div><div class="arrow">→</div>
<div class="box">pg-primary<small>accepts writes?</small></div><div class="arrow">no or down →</div>
<div class="box">pg-replica1<small>accepts writes?</small></div><div class="arrow">no or down →</div>
<div class="box">pg-replica2<small>accepts writes?</small></div><div class="arrow">no →</div>
<div class="box red">error<small>none with the role</small></div>
</div>
<div class="flow"><div class="box green">the first one that says "yes" keeps the connection</div></div>

```bash
host=pg-primary,pg-replica1,pg-replica2 target_session_attrs=read-write
host=pg-primary,pg-replica1,pg-replica2 target_session_attrs=standby load_balance_hosts=random
```

```text
jdbc:postgresql://pg-primary:5432,pg-replica1:5432,pg-replica2:5432/store?targetServerType=primary
```

- The list names **candidates**, not *the* primary — it survives a failover.

---

<!-- _class: tight -->

## 2 · Experiment 5: synchronous commits

<div style="font-size: 1.15em">
<div class="flow">
<div class="arrow" style="flex: .7; text-align: left">FIRST 1 ("pg-replica1")</div>
<div class="box">INSERT headset</div><div class="arrow">→</div>
<div class="box muted">pg-replica1 stopped<small>the only one that counts</small></div><div class="arrow">→</div>
<div class="box red">hangs<small>Ctrl+C cancels only the wait</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .7; text-align: left">ANY 1 (r1, r2) · quorum</div>
<div class="box">INSERT webcam</div><div class="arrow">→</div>
<div class="box green">pg-replica2 confirms</div><div class="arrow">→</div>
<div class="box green">COMMIT ok<small>at once</small></div>
</div>
</div>

```
WARNING:  canceling wait for synchronous replication due to user request
DETAIL:  The transaction has already committed locally, but might not
         have been replicated to the standby.
```

<div class="q">

Is the `headset` row committed? *(Yes — on the primary; only the wait was cancelled.)*

</div>

---

<!-- _class: tight -->

## 2 · How long the primary waits

<div class="flow" style="font-size: 1.15em">
<div class="box">COMMIT</div><div class="arrow">→</div>
<div class="box orange">received in memory<small>remote_write</small></div><div class="arrow">→</div>
<div class="box accent">written to disk<small>on (default)</small></div><div class="arrow">→</div>
<div class="box green">replayed<small>remote_apply</small></div><div class="arrow">→</div>
<div class="box">COMMIT ok</div>
</div>

| `synchronous_commit` | Commit returns when the sync replica has… | Guarantees |
|---|---|---|
| `remote_write` | received the WAL (in memory) | survives a primary crash |
| `on` (default) | written the WAL to disk | survives a crash of both |
| `remote_apply` | **replayed** the WAL | a read on that replica sees the commit |

- `ANY 1` → both replicas show `sync_state = quorum`; one may be down.
- Back to async before the failover page: `ALTER SYSTEM RESET synchronous_standby_names;` + `pg_reload_conf()`.

---

<!-- _class: tight -->

## 2 · Experiment 6: under load (optional)

```bash
docker compose run --rm --entrypoint pgbench client -h pg-primary -i -s 10
docker compose run --rm --entrypoint pgbench client -h pg-primary -c 8 -T 30 -P 5
docker compose run --rm --entrypoint pgbench client -S -n -c 8 -T 15 \
  "host=pg-replica1,pg-replica2 load_balance_hosts=random"
```

<div class="flow" style="font-size: 1.15em; align-items: stretch">
<div class="box muted" style="flex: .7; display: flex; flex-direction: column; justify-content: center">pgbench -c 8<small>writes</small></div>
<div class="arrow" style="align-self: center">→</div>
<div class="box accent" style="display: flex; flex-direction: column; justify-content: center">pg-primary<small>takes every write</small></div>
<div class="arrow" style="align-self: center">WAL · replay_lag grows →</div>
<div class="group">
<div class="caption">pgbench -S · reads</div>
<div class="box green">pg-replica1<small>part of the reads</small></div>
<div class="box green">pg-replica2<small>part of the reads</small></div>
</div>
</div>

- **Reads scale** with the replicas; writes do not.
- Repeat with `ANY 1`: the drop in write `tps` (transactions per second) is the **price of RPO = 0**.

---

<!-- _class: tight -->

## 3 · Planned failover

<div class="matrix" style="--n: 3; font-size: 1.3em">
<div></div><div class="head">before</div><div class="head">the primary fails · promote</div><div class="head">after</div>
<div class="row">pg-primary</div><div class="box accent">primary</div><div class="box red" style="flex-direction: column">down<small>docker compose stop</small></div><div class="box green" style="flex-direction: column">replica of pg-replica1<small>rejoin-as-replica.sh: pg_rewind + standby.signal</small></div>
<div class="row">pg-replica1</div><div class="box green">replica</div><div class="box accent" style="flex-direction: column">primary · timeline 2<small>SELECT pg_promote();</small></div><div class="box accent">primary</div>
<div class="row">pg-replica2</div><div class="box green">follows pg-primary</div><div class="box muted">no primary to follow</div><div class="box green" style="flex-direction: column">follows pg-replica1<small>primary_conninfo + reload</small></div>
<div class="row">clients</div><div class="box muted">read-write → pg-primary</div><div class="box muted">read-write: none</div><div class="box muted">same string → pg-replica1</div>
</div>

- Before the rejoin, `pg-primary` must be **stopped**: two servers on one data directory corrupt it.
- After a clean stop: *no rewind required* — the old primary wrote nothing the new one lacks.

<p class="small">Roles swapped, names stale: real clusters name nodes <code>pg-1</code>, <code>pg-2</code>… and ask <code>pg_is_in_recovery()</code>.</p>

---

## 3 · Unplanned failover: the lost write

<div class="flow" style="font-size: 1.1em">
<div class="box muted">1 · stop both replicas</div><div class="arrow">→</div>
<div class="box orange">2 · INSERT 'lost-write'<small>INSERT 0 1</small></div><div class="arrow">→</div>
<div class="box red">3 · kill the primary</div><div class="arrow">→</div>
<div class="box green">4 · start the replicas, promote pg-replica1</div><div class="arrow">→</div>
<div class="box red">5 · lost-write is gone</div>
</div>

- `pg_rewind` on the old primary: *servers diverged… rewinding* → `lost-write` is discarded for good.

<div class="warn">

That is the **RPO** of async replication. Sync would have saved it — by **blocking** the `INSERT`: the client would never have heard the order existed.

</div>

<p class="small">ids 1, 2, <b>34</b>: sequences log values in batches of 32; never expect gapless <code>serial</code>.</p>

---

## The fork: where `lost-write` went

<div class="flow" style="font-size: 1.2em; align-items: stretch">
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

<!-- _class: tight -->

## 3 · Why not a failover script?

<div class="q">

The primary stops answering the health check. Is it dead — or slow? Or cut off from the monitor but not from the clients?

</div>

**Patroni**: only the holder of the **leader key** in etcd (Raft) runs as primary. The key has a TTL (time to live):

<div style="font-size: 1.25em">
<div class="flow">
<div class="box accent">pg-1 · primary</div><div class="arrow">renews the key (TTL 30 s) →</div>
<div class="box">etcd · Raft</div><div class="arrow">→</div>
<div class="box green">"ok, you are the leader"</div>
</div>
<div class="flow">
<div class="box red">network pg-1 ↔ etcd breaks</div><div class="arrow">→</div>
<div class="box orange">pg-1 cannot renew<small>demotes itself</small></div><div class="arrow">→</div>
<div class="box muted">the key expires</div><div class="arrow">→</div>
<div class="box green">pg-2 takes the key<small>and only then promotes</small></div>
</div>
</div>

- Never two primaries: the isolated one steps down **before** another steps up. Managed services (RDS Multi-AZ, Aurora, Cloud SQL) do the same for you.

---

## 3 · Connecting the platform

```yaml
  account:
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://pg-primary:5432,pg-replica1:5432,pg-replica2:5432/store?targetServerType=primary
      SPRING_DATASOURCE_USERNAME: store
      SPRING_DATASOURCE_PASSWORD: devpass
```

<div class="flow" style="font-size: 1.15em">
<div class="arrow" style="flex: .55; text-align: left">after the failover</div>
<div class="box">account<small>HikariCP drops the broken connections</small></div><div class="arrow">→</div>
<div class="box accent">JDBC driver<small>targetServerType=primary</small></div><div class="arrow">→</div>
<div class="box muted">pg-primary<small>down</small></div><div class="arrow">→</div>
<div class="box green">pg-replica1<small>the new primary</small></div>
</div>

- Reads on the replicas: a second `DataSource` (`preferSecondary`) + `AbstractRoutingDataSource` for `readOnly` — mind the stale reads.

<p class="small">Clean-up: <code>docker compose down -v</code> — without <code>-v</code> the cluster comes back with the roles it ended in.</p>

---

## Simulator: replication and synchronous commits

<div class="q">

The lab's cluster in the browser: same nodes, same commands, same outputs. It starts where the lab starts: `orders` with keyboard and mouse, both replicas streaming.

</div>

<div style="font-size: 1.15em">
<div class="flow">
<div class="arrow" style="flex: .55; text-align: left">Replication 1–4</div>
<div class="box accent">pg-primary<small>3 rows</small></div>
<div class="box orange">pg-replica1 · replay paused<small>2 rows, 184 bytes behind</small></div>
<div class="box green">pg-replica2<small>3 rows</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .55; text-align: left">Replication 5</div>
<div class="box red">FIRST 1 · pg-replica1 stopped<small>INSERT headset hangs: 1 commit hung</small></div>
<div class="box green">ANY 1<small>webcam returns at once; both become quorum</small></div>
</div>
</div>

- The replica refuses the `INSERT`; `read-write` finds pg-primary and `standby` picks a random replica.
- `synchronous_commit = remote_apply` + paused replay: the commit waits for the replica to **replay**.

<p class="small">Overview (opens on experiment 5) and top of Replication · simulator <code>pg-cluster</code>.</p>

---

## Simulator: failover and the lost write

<div class="flow" style="font-size: 1.15em">
<div class="arrow" style="flex: .5; text-align: left">Planned failover</div>
<div class="box muted">read-write: nobody<small>primary stopped</small></div><div class="arrow">→</div>
<div class="box accent">pg_promote()<small>timeline 2</small></div><div class="arrow">→</div>
<div class="box green">same string → pg-replica1</div><div class="arrow">→</div>
<div class="box green">no rewind required<small>1 primary, 0 lost</small></div>
</div>
<div class="flow" style="font-size: 1.15em">
<div class="arrow" style="flex: .5; text-align: left">Lost write</div>
<div class="box orange">INSERT 0 1<small>lost-write</small></div><div class="arrow">→</div>
<div class="box red">the primary dies</div><div class="arrow">→</div>
<div class="box green">ids 1, 2, 34<small>pg-replica1 promoted</small></div><div class="arrow">→</div>
<div class="box red">pg_rewind discards<small>1 write lost</small></div>
</div>

<div class="flow" style="font-size: 1.15em">
<div class="arrow" style="flex: .5; text-align: left">free mode</div>
<div class="box red">pg-primary · primary<small>timeline 1, no pg_rewind</small></div>
<div class="box red">pg-replica1 · primary<small>timeline 2</small></div>
<div class="box green">pg-replica2<small>follows pg-replica1</small></div>
<div class="arrow">→</div>
<div class="box red">primaries up: 2</div>
</div>

<p class="small">The simulator's counters: primaries up, rows on the primary, commits that hung, writes lost. Top of Failover and the lost-write section · simulator <code>pg-cluster</code>.</p>

---

## Takeaways

1. Replication copies the **WAL**: replicas are read-only, byte-identical copies.
2. It scales **reads** and gives **availability**; writes still go to one primary.
3. **Async**: fast, but stale reads and lost writes on a crash (RPO > 0).
4. **Sync** (`ANY 1`): RPO = 0, paid with latency and blocked writes.
5. Route by role in the **connection string**; it survives a failover.
6. Failover = promote, re-point, redirect, rewind — and deciding *when* needs **consensus**, or it ends in split brain.
