---
marp: true
lang: en
title: Lab 6 — Data at scale
description: System Architecture · Insper
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

<div class="kicker">System Architecture · Insper · Lab 6</div>

# Lab 6 — Data at scale

**Seat holds without double booking, a read replica, PgBouncer, EXPLAIN — and a failover by hand**

<!--
Outline: (1) the invariant; (2) the lost-update race; (3) three strategies; (4) the flash-sale test and
audit; (5) streaming replica and routing; (6) read-your-writes; (7) PgBouncer; (8) indexes;
(9) synchronous replication, a crash, failover, split brain, pg_rewind; (10) the simulator.
-->

---

## The one bug we cannot ship

<div class="q">

Two fans click the same two seats in the same millisecond. Both get "201 Created". Who goes to the show?

</div>

- Invariant: **a seat belongs to at most one live hold**.
- Catalog may be stale for seconds; seats may **never** be wrong.

---

## What you will build

<div class="flow" style="align-items: stretch">
<div class="box muted" style="flex: .6; display: flex; flex-direction: column; justify-content: center">k6 fans<small>edge → gateway</small></div>
<div class="arrow" style="align-self: center">→</div>
<div class="box accent" style="display: flex; flex-direction: column; justify-content: center">inventory :8083<small>seats, holds, 3 locking strategies</small></div>
<div class="group">
<div class="caption">writes, holds · read-write transactions</div>
<div class="box orange">pgbouncer :6432<small>transaction pooling</small></div>
<div class="box green">db · primary</div>
</div>
<div class="arrow" style="align-self: center">write-ahead log (WAL) →</div>
<div class="group">
<div class="caption">seat maps · readOnly transactions</div>
<div class="box green">db-replica :5433<small>hot standby</small></div>
</div>
</div>

- Event **1**: 60,000 seats (30 sections × 40 rows × 50); a hold lasts 10 minutes, at most 6 seats.
- The catalog gets its indexes (`V3__index_events.sql`); step 4 crashes `db` on purpose.

---

## The race (READ COMMITTED)

```text
A: SELECT status → AVAILABLE
B: SELECT status → AVAILABLE
A: UPDATE … hold_id = A        (locks the rows)
B: UPDATE … hold_id = B        (waits…)
A: COMMIT  →  B's UPDATE runs  →  overwrites A
```

- Check-then-act without a lock = **lost update**.
- With `FOR UPDATE`, B waits at the **read** instead, then re-reads `HELD` → `409`.

---

## Three strategies

| Strategy | Mechanism | On conflict |
|---|---|---|
| naive | read, check, update | ❌ **double booking** |
| pessimistic | `SELECT … ORDER BY id FOR UPDATE` | ✅ wait, then 409 |
| optimistic | `UPDATE … WHERE version = :v` | ✅ 0 rows → 409, rollback |

<p class="small">Variant: <code>UPDATE … WHERE status = 'AVAILABLE'</code> and check the row count.</p>

---

## The flash-sale test

```bash
INVENTORY_LOCKING=naive docker compose up -d inventory
bash scripts/reset-inventory.sh && k6 run load/flash-sale.js
```

<div class="flow">
<div class="box red">naive<small>162 holds · audit: 9 double-booked seats</small></div>
<div class="box green">pessimistic<small>141 holds · audit 0 · p99 1.77 s</small></div>
<div class="box green">optimistic<small>141 holds · audit 0 · p99 1.03 s</small></div>
</div>

- 200 fans, 100 seats, 2 seats per hold, 70% release; teardown: `GET /inventory/audit/double-bookings`.
- One run on a busy laptop: the counts vary, the **shape** does not (naive is never reliably 0).

---

## Pessimistic or optimistic?

<div class="cols">
<div>

**Pessimistic**
- serializes contended rows
- waiting → higher p99
- lock in **id order** (no deadlocks)

</div>
<div>

**Optimistic**
- no waiting
- conflicts → fail fast
- great with **low** contention

</div>
</div>

<p class="small">Either way, protect hot rows <em>before</em> the database: a waiting room (lab 7).</p>

---

## Holds expire

```sql
WITH expired AS (
  UPDATE inventory.holds SET status = 'EXPIRED'
  WHERE id IN (SELECT id FROM inventory.holds
               WHERE status = 'ACTIVE' AND expires_at < now()
               LIMIT 500 FOR UPDATE SKIP LOCKED)
  RETURNING id)
UPDATE inventory.seats SET status = 'AVAILABLE', hold_id = NULL
WHERE hold_id IN (SELECT id FROM expired);
```

- `SKIP LOCKED`: several replicas share the job safely.

---

## A streaming replica

- `pg_basebackup -R`: clone + `standby.signal`.
- The WAL is streamed asynchronously; the replica is **read-only**.
- `@Transactional(readOnly = true)` → replica pool, via `LazyConnectionDataSourceProxy`.
- `find` (the fan's own hold) and the audit stay on the **primary**.

<div class="warn">

A replica adds **read capacity**. It does nothing for writes.

</div>

---

## Read-your-writes

```bash
REPLICA_DELAY=1s docker compose up -d db-replica
k6 run load/read-your-writes.js      # stale_reads ↑
```

- No artificial delay: **~6%** stale reads — the next request also arrives within milliseconds.
- `REPLICA_DELAY=1s`: **98%** — the fan holds a seat… and the seat map says AVAILABLE.
- Fix: own recent writes from the **primary**, sticky reads, or wait for the log sequence number (LSN).

---

## PgBouncer

<div class="flow" style="align-items: stretch">
<div class="group">
<div class="caption">clients</div>
<div class="box">catalog ×3<small>3 × 10 connections</small></div>
<div class="box">auth<small>10 connections</small></div>
<div class="box">inventory<small>its whole pool</small></div>
</div>
<div class="arrow" style="align-self: center">inventory →</div>
<div class="box orange" style="display: flex; flex-direction: column; justify-content: center">pgbouncer<small>transaction mode · ≤ 20 server connections</small></div>
<div class="arrow" style="align-self: center">→</div>
<div class="box green" style="display: flex; flex-direction: column; justify-content: center">db<small>~60 connections in a test run</small></div>
</div>

- `max_connections=80`, `inventory` pool 40, direct → `FATAL: sorry, too many clients already`; through PgBouncer → **queueing** (`cl_waiting`).
- Transaction pooling breaks session state → **Flyway connects directly**.

---

<!-- _class: tight -->

## EXPLAIN before you cache

<div class="flow">
<div class="arrow" style="flex: .45; text-align: left">before</div>
<div class="box">Limit 20</div><div class="arrow">←</div>
<div class="box red">Sort<small>starts_at, id</small></div><div class="arrow">←</div>
<div class="box red">Seq Scan on events<small>200,000 rows</small></div>
<div class="box muted">36.8 ms<small>+ 13.9 ms for count(*)</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .45; text-align: left">after</div>
<div class="box">Limit 20</div><div class="arrow">←</div>
<div class="box">Nested Loop</div><div class="arrow">←</div>
<div class="box green">Index Scan events_starts_at_idx<small>189 entries, in date order</small></div>
<div class="box muted">0.62 ms<small>count(*): 4 ms, Index Only Scan</small></div>
</div>

```sql
CREATE INDEX events_starts_at_idx ON catalog.events (starts_at, id);
```

- Indexes cost every write; index what you **measured**.

---

## Synchronous replication: what it costs

| `synchronous_commit` (replica 1 s behind) | stale reads | per iteration |
|---|---:|---:|
| `on`: WAL on the standby's disk | ⚠️ 93–100% | ~0.05–0.4 s |
| `remote_apply`: replayed on the standby | ✅ **0%** | ⚠️ **2 s** |

- Replica stopped → the hold gets **504 after 5 s**, yet seat 10 is `HELD`: "already committed locally".
- One synchronous standby = a single point of failure for writes → `ANY 1` over two.

---

<!-- _class: tight -->

## The primary dies with a hold in flight

<div class="flow">
<div class="box">replica stopped<small>Ana's hold → 201</small></div><div class="arrow">→</div>
<div class="box red">kill db</div><div class="arrow">→</div>
<div class="box orange">probes<small>seat map 200 · hold, login, catalog 504</small></div><div class="arrow">→</div>
<div class="box accent">pg_promote()<small>timeline 2</small></div><div class="arrow">→</div>
<div class="box accent">move the name db<small>a Docker network alias</small></div><div class="arrow">→</div>
<div class="box red">Ana's hold: 404</div>
</div>

- 15 s after the move every path answers again: the pools reconnect, no file changed, no service restarted.
- The hold existed only in the dead primary's WAL: the **recovery point objective (RPO)** of async replication.
- A managed database does the same with its endpoint (Amazon RDS: a Domain Name System (DNS) name), a virtual IP or a proxy.

---

## Split brain, and the way back

<div class="flow" style="align-items: stretch">
<div class="box" style="display: flex; flex-direction: column; justify-content: center">common history<small>timeline 1</small></div>
<div class="arrow" style="align-self: center">→</div>
<div class="group">
<div class="caption">after the fork</div>
<div class="box red">old db, started as it was<small>primary · seat 20 HELD (Ana's lost hold)</small></div>
<div class="box green">db-replica<small>primary, timeline 2 · seat 20 AVAILABLE</small></div>
</div>
<div class="arrow" style="align-self: center">→</div>
<div class="box orange" style="display: flex; flex-direction: column; justify-content: center">fence, then pg_rewind<small>needs wal_log_hints; db follows timeline 2</small></div>
</div>

- Two primaries behind **one name**: each new connection lands on either one.
- Switch back: equal LSNs, stop `db-replica`, promote `db` (timeline 3), clone a fresh replica.

---

<!-- _class: tight -->

## What you did by hand

| Step | In this lab | In production |
|---|---|---|
| Detect | you killed it | health checks with a timeout |
| Choose the new primary | the only replica | the most up-to-date standby, by consensus |
| Move the clients | a Docker network alias | DNS endpoint, virtual IP, proxy, multi-host strings |
| Fence the old primary | `docker compose stop db` | leader-key expiry, STONITH ("shoot the other node in the head"), fencing tokens |
| Rejoin it | `pg_rewind` + `standby.signal` | the failover manager |
| Decide what may be lost | async: the last hold | `ANY 1 (…)` over two standbys: RPO 0 |

<div class="warn">

A human at 10:01 is too slow: Patroni + etcd decide the leader by **consensus**.

</div>

---

## Without Docker: the simulator

<div class="flow">
<div class="box accent">Replica<small>REPLICA_DELAY 1 s: seat 1 still AVAILABLE on the map</small></div>
<div class="box orange">Synchronous<small>remote_apply: 1.03 s · standby down: 504, seat 10 HELD</small></div>
<div class="box red">Crash<small>seat map 200, the rest 504 · Ana's hold 404</small></div>
<div class="box green">Split brain<small>pg_rewind discards the hold · timeline 3</small></div>
</div>

- The Replica and Failover pages embed the lab's two databases: same names, same commands, same outputs.
- **Free** mode: `start` instead of `up --no-deps`, or `pg_rewind` without `wal_log_hints`.

<!--
The simulator sits after the read-your-writes experiment, at the top of Failover (opening on the crash)
and at the end of section 5 (split brain, rejoin, switchback).
-->

---

## Takeaways

1. Name the **invariant**; enforce it atomically (locks, versions, conditional updates).
2. **Audit** correctness under load, not just latency.
3. Replicas scale **reads** that tolerate **staleness**; route read-your-writes to the primary.
4. Pool connections (**PgBouncer**) before autoscaling multiplies them.
5. **EXPLAIN** first: an index can beat a cache.
6. Know what a **failover** loses (RPO) and who decides the leader; fence the old primary.
