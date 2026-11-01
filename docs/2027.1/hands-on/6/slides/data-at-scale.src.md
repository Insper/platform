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

<div class="kicker">System Architecture · Insper · Lab 6</div>

# Lab 6 — Data at scale

**Seat holds without double booking, a read replica, PgBouncer and EXPLAIN**

<!--
Outline: (1) the invariant; (2) the lost-update race; (3) three strategies; (4) the flash-sale test and
audit; (5) streaming replica and routing; (6) read-your-writes; (7) PgBouncer; (8) indexes.
-->

---

## The one bug we cannot ship

<div class="q">

Two fans click the same two seats in the same millisecond. Both get "201 Created". Who goes to the show?

</div>

- Invariant: **a seat belongs to at most one live hold**.
- Catalog may be stale for seconds; seats may **never** be wrong.

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

---

## Three strategies

| Strategy | Mechanism | On conflict |
|---|---|---|
| naive | read, check, update | **double booking** |
| pessimistic | `SELECT … ORDER BY id FOR UPDATE` | wait, then 409 |
| optimistic | `UPDATE … WHERE version = :v` | 0 rows → 409, rollback |

<p class="small">Variant: <code>UPDATE … WHERE status = 'AVAILABLE'</code> and check the row count.</p>

---

## The flash-sale test

```bash
INVENTORY_LOCKING=naive docker compose up -d inventory
bash scripts/reset-inventory.sh && k6 run load/flash-sale.js
```

- 200 fans, 100 seats, 2 seats per hold, 70% release.
- Teardown: `GET /inventory/audit/double-bookings`.

<div class="ok">

Pessimistic and optimistic: **0**. Naive: not 0.

</div>

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
- WAL streamed asynchronously; replica is **read-only**.
- `@Transactional(readOnly = true)` → replica pool, via `LazyConnectionDataSourceProxy`.

<div class="warn">

A replica adds **read capacity**. It does nothing for writes.

</div>

---

## Read-your-writes

```bash
REPLICA_DELAY=1s docker compose up -d db-replica
k6 run load/read-your-writes.js      # stale_reads ↑
```

- The fan holds a seat… and the seat map says AVAILABLE.
- Fix: own recent writes from the **primary**, sticky reads, or wait for the LSN.

---

## PgBouncer

| | Client connections | Server connections |
|---|---|---|
| no pooler | 200 | 200 processes |
| PgBouncer (transaction mode) | 200 | ≤ `default_pool_size` |

- Breaks session state → **Flyway connects directly**.
- Over the limit: clients **queue** instead of "too many clients".

---

## EXPLAIN before you cache

```text
Limit → Sort → Hash Join → Seq Scan on events (200,000 rows)   ≈ 40 ms
```

```sql
CREATE INDEX events_starts_at_idx ON catalog.events (starts_at, id);
```

- Index delivers the order → stop after 20 rows → **< 1 ms**.
- Indexes cost every write; index what you **measured**.

---

## Synchronous replication: what it costs

| `synchronous_commit` (replica 1 s behind) | stale reads | per iteration |
|---|---:|---:|
| `on`: WAL on the standby's disk | 93–100% | ~0.05–0.4 s |
| `remote_apply`: replayed on the standby | **0%** | **2 s** |

- Replica stopped → every write **hangs**; Ctrl+C: "already committed locally".
- One synchronous standby = a single point of failure for writes → `ANY 1` over two.

---

<!-- _class: tight -->

## Failover by hand

1. Ana's hold answers **201** → `docker compose kill db`.
2. `pg_promote()` on the replica: a new **timeline**.
3. Move the **name**: Docker network alias `db` → the new primary (like an RDS endpoint).
4. 15 s later writes work again… and Ana's hold is **404**: the **RPO** of async.
5. Old primary back as it was → **two primaries**, one name: split brain → **fence** it.
6. `pg_rewind` (needs `wal_log_hints`) → it rejoins as a replica; then switch back.

<div class="warn">

A human at 10:01 is too slow: Patroni + etcd decide the leader by **consensus**.

</div>

---

## Takeaways

1. Name the **invariant**; enforce it atomically (locks, versions, conditional updates).
2. **Audit** correctness under load, not just latency.
3. Replicas scale **reads** that tolerate **staleness**; route read-your-writes to the primary.
4. Pool connections (**PgBouncer**) before autoscaling multiplies them.
5. **EXPLAIN** first: an index can beat a cache.
6. Know what a **failover** loses (RPO) and who decides the leader; fence the old primary.
