At 10:00:03 on sale day, Alice and Bob both click seat `A-12` of the stadium show. Both see "Seat held — you have 10 minutes to pay". Both pay. At the gate, one of them is turned away. The code that did this had been in production for a year, had 100% test coverage and passed every code review — because the bug only exists when **two requests interleave** in the database, which never happens in a unit test.

This page explains why, using the vocabulary every database engineer shares: transactions, isolation levels and anomalies. Then it fixes the bug four different ways and builds the seat-hold flow BoxOffice really uses.

---

## ACID, concretely

A **transaction** groups several reads and writes into one logical unit. The classic guarantees are summarized as **ACID**[^1]:

| Letter | Guarantee | What it means for a seat hold | What it does *not* mean |
|---|---|---|---|
| **A**tomicity | all writes of the transaction happen, or none | the seat is marked `HELD` *and* the hold row is created, or neither | nothing about concurrency |
| **C**onsistency | the database moves from one valid state to another | constraints (`CHECK`, `UNIQUE`, foreign keys) hold after every commit | it is mostly *your* invariants, enforced by A, I and D plus constraints |
| **I**solation | concurrent transactions do not interfere *as defined by the isolation level* | Bob's transaction does not see Alice's half-done work | it does **not** mean "as if run one at a time" — unless the level is serializable |
| **D**urability | once committed, the data survives a crash | after "Seat held", a power cut does not undo the hold | survival of a disk or region loss — that needs replication ([Replication](../replication/index.md)) |

The trap is in the **I**: most databases do not run transactions *as if* one at a time by default. PostgreSQL, Oracle and SQL Server default to **read committed**; MySQL InnoDB defaults to **repeatable read**. Both permit anomalies — including the one that sold seat `A-12` twice.

---

## The double-booking bug { #double-booking }

This is the code path, written as the SQL each request sends (the application checks the result of the `SELECT` before issuing the `UPDATE`):

```sql title="Hold a seat — naive version (check, then act)"
BEGIN;  -- PostgreSQL default: READ COMMITTED

SELECT status FROM seats
WHERE event_id = 42 AND seat_id = 'A-12';
-- application: if status != 'AVAILABLE' then ROLLBACK and show "seat taken"

UPDATE seats
SET status = 'HELD', held_by = :customer_id,
    hold_expires_at = now() + interval '10 minutes'
WHERE event_id = 42 AND seat_id = 'A-12';

COMMIT;
```

Now interleave two requests:

``` mermaid-sim
sequenceDiagram
    participant A as Alice (T1)
    participant DB as PostgreSQL
    participant B as Bob (T2)
    A->>DB: SELECT status … A-12
    DB-->>A: AVAILABLE
    B->>DB: SELECT status … A-12
    DB-->>B: AVAILABLE
    A->>DB: UPDATE … SET HELD, held_by = Alice
    Note over DB: T1 locks row A-12
    B->>DB: UPDATE … SET HELD, held_by = Bob
    Note over DB: T2 waits for T1's row lock
    A->>DB: COMMIT
    DB-->>A: ok — "seat held"
    Note over DB: lock released: T2's UPDATE runs<br/>and overwrites Alice's hold
    B->>DB: COMMIT
    DB-->>B: ok — "seat held"
```

Both requests read `AVAILABLE` *before* either wrote; both decided "free"; the second `UPDATE` overwrote the first. This is the **check-then-act race**, and the anomaly is called a **lost update**: Alice's write was silently lost. The row lock did not help, because it only serialized the two `UPDATE`s — the decision had already been made on stale reads.

If the `tickets` table has `PRIMARY KEY (event_id, seat_id)` (see [Data Models](../models/index.md#relational)), the second *ticket* insert fails at payment confirmation — after the money was taken. The constraint saved the stadium from two people in one seat, but turned the bug into a refund and an angry customer. Constraints are the last line of defense, not the design.

??? question "Think first: would wrapping the code in a transaction with a stricter isolation level fix it?"

    In PostgreSQL, yes: under **repeatable read**, T2's `UPDATE` fails with `could not serialize access due to concurrent update` because the row changed after T2's snapshot; the application retries, reads `HELD` and tells Bob the seat is taken. Under **serializable** the same happens. In MySQL InnoDB, **repeatable read does not detect it**: the `UPDATE` reads the latest committed row and overwrites it. Isolation levels have the same names across databases but not the same behaviour — test yours, or use one of the fixes below that work everywhere.

---

## Isolation levels and their anomalies

An **anomaly** is an outcome that could never happen if transactions ran one at a time (**serially**). Each weaker isolation level permits some of them in exchange for more concurrency[^2].

| Anomaly | What happens | BoxOffice example |
|---|---|---|
| **Dirty read** | T2 reads data T1 wrote but has not committed | the seat map shows `A-12` sold; Alice's card is declined and T1 rolls back — the seat was never sold |
| **Non-repeatable read** (read skew) | T reads the same data twice and gets different values, because another transaction committed in between | a report counts 59,990 sold seats, then sums paid orders and gets 60,002 tickets — the two numbers disagree |
| **Lost update** | two transactions read, modify and write the same row; one write is lost | the double booking above |
| **Phantom** | a query's *set* of matching rows changes because another transaction inserted or updated rows | "how many tickets does customer 7 hold?" returns 2, while another transaction adds 2 more |
| **Write skew** | two transactions read the same data, then write *different* rows based on it; each is fine alone, together they break an invariant | the ticket limit below |

The levels, as implemented by **PostgreSQL** (other databases differ — check the documentation[^3]):

| Level | Dirty read | Non-repeatable read | Phantom | Lost update | Write skew |
|---|---|---|---|---|---|
| Read uncommitted (behaves as read committed in PostgreSQL) | no | possible | possible | possible | possible |
| **Read committed** (default) | no | possible | possible | possible | possible |
| **Repeatable read** (snapshot isolation) | no | no | no | detected → error, retry | **possible** |
| **Serializable** (serializable snapshot isolation) | no | no | no | no | no — aborts with error `40001`, retry |

### How snapshots work: MVCC

PostgreSQL, MySQL InnoDB, Oracle and most modern engines use **multi-version concurrency control** (MVCC): an update writes a *new version* of the row instead of overwriting it, tagged with the transaction that created it. Each transaction reads from a **snapshot** — the versions committed before it (repeatable read) or before each statement (read committed) started.

| Row `A-12` version | Created by | Visible to |
|---|---|---|
| `status = AVAILABLE` | T100 (loading the event) | transactions whose snapshot predates T205's commit |
| `status = HELD, held_by = Alice` | T205 (Alice) | transactions that start after T205 commits |

The payoff: **readers never block writers, and writers never block readers**. The cost: old versions accumulate and must be cleaned up (`VACUUM` in PostgreSQL), and two writers to the *same row* still serialize on a row lock.

### Write skew: the ticket limit

BoxOffice allows at most 6 tickets per customer per event. Alice already holds 4 and opens two browser tabs, each trying to hold 2 more seats:

| Time | Tab 1 (T1) | Tab 2 (T2) |
|---|---|---|
| 1 | `SELECT count(*) … WHERE held_by = 7` → **4** | |
| 2 | | `SELECT count(*) … WHERE held_by = 7` → **4** |
| 3 | 4 + 2 ≤ 6 → `UPDATE seats … 'B-1', 'B-2'` | |
| 4 | | 4 + 2 ≤ 6 → `UPDATE seats … 'C-7', 'C-8'` |
| 5 | `COMMIT` | `COMMIT` |
| | **Alice now holds 8 tickets** | |

No row was written by both transactions, so no row lock conflicts and snapshot isolation sees nothing wrong. This is **write skew**, and it is driven by a phantom: each transaction's `count(*)` would have changed had it seen the other's writes. Two fixes:

- **Serializable** isolation: PostgreSQL's serializable snapshot isolation (SSI)[^4] tracks read/write dependencies and aborts one transaction with `ERROR: could not serialize access due to read/write dependencies among transactions` (SQLSTATE `40001`). The application must **retry** it.
- **Materialize the conflict**: make both transactions lock the *same* row first, e.g. a per-customer-per-event row:

```sql title="Turn write skew into a plain row-lock conflict"
BEGIN;
SELECT tickets_held FROM customer_event_limits
WHERE customer_id = 7 AND event_id = 42
FOR UPDATE;                         -- the second tab waits here
-- application: if tickets_held + 2 > 6 then ROLLBACK
UPDATE seats SET status = 'HELD', held_by = 7,
                 hold_expires_at = now() + interval '10 minutes'
WHERE event_id = 42 AND seat_id IN ('B-1', 'B-2') AND status = 'AVAILABLE';
UPDATE customer_event_limits SET tickets_held = tickets_held + 2
WHERE customer_id = 7 AND event_id = 42;
COMMIT;
```

---

## Four ways to fix the double booking

All four work on any mainstream relational database at read committed, which is why they are preferred over "just raise the isolation level".

### 1. Atomic conditional update (compare-and-set)

Put the check *inside* the write, so check and act are one atomic statement:

```sql title="Fix 1 — conditional UPDATE"
UPDATE seats
SET status = 'HELD', held_by = :customer_id,
    hold_expires_at = now() + interval '10 minutes'
WHERE event_id = 42 AND seat_id = 'A-12'
  AND status = 'AVAILABLE';
-- 1 row updated → the hold is yours; 0 rows → someone else got it
```

When Bob's `UPDATE` waits for Alice's lock and then runs, PostgreSQL **re-checks the `WHERE` clause against the new row version**: `status` is now `HELD`, so 0 rows are updated. One round trip, no explicit lock, no retry loop. This is the BoxOffice default.

### 2. Pessimistic locking: `SELECT … FOR UPDATE`

Lock the row when you read it, so nobody can change it until you commit:

```sql title="Fix 2 — lock on read"
BEGIN;
SELECT status FROM seats
WHERE event_id = 42 AND seat_id = 'A-12'
FOR UPDATE;                 -- Bob blocks here until Alice commits
-- application: if status != 'AVAILABLE' then ROLLBACK
UPDATE seats SET status = 'HELD', held_by = :customer_id,
                 hold_expires_at = now() + interval '10 minutes'
WHERE event_id = 42 AND seat_id = 'A-12';
COMMIT;
```

Use it when the decision needs application logic between the read and the write (pricing rules, the ticket limit). Variants matter under load:

- `FOR UPDATE NOWAIT` fails immediately instead of waiting — good for "seat taken, choose another".
- `FOR UPDATE SKIP LOCKED` skips rows other transactions hold — perfect for **"best available"**: hand each fan different free seats without them queuing on the same rows.

```sql title="Best available: two free seats in section B, without waiting on other fans"
SELECT seat_id FROM seats
WHERE event_id = 42 AND section = 'B' AND status = 'AVAILABLE'
ORDER BY seat_id
LIMIT 2
FOR UPDATE SKIP LOCKED;
```

When one transaction locks **several** rows (a group of 4 seats), always lock them **in the same order** (e.g. `ORDER BY seat_id`). Otherwise T1 locks A-1 then waits for A-2 while T2 locks A-2 then waits for A-1 — a **deadlock**; the database kills one of them.

### 3. Optimistic locking with a version column

Do not lock at all; detect conflicts at write time with a `version` counter:

```sql title="Fix 3 — optimistic concurrency control"
SELECT status, version FROM seats
WHERE event_id = 42 AND seat_id = 'A-12';     -- AVAILABLE, version 7

UPDATE seats
SET status = 'HELD', held_by = :customer_id, version = version + 1,
    hold_expires_at = now() + interval '10 minutes'
WHERE event_id = 42 AND seat_id = 'A-12' AND version = 7;
-- 0 rows → somebody changed the seat since you read it: reload and retry
```

JPA/Hibernate does this automatically with an `@Version` field and throws `OptimisticLockException`. It shines when conflicts are **rare** (editing an event description) and holds no locks during user think time. It is a poor fit for a flash sale, where thousands of fans collide on the same few rows and most attempts fail and retry.

### 4. Let a constraint decide

Make the invariant a **unique constraint**, and let the database reject the loser. With a separate holds table, an expired hold can even be taken over atomically:

```sql title="Fix 4 — unique key + upsert that only steals expired holds"
CREATE TABLE seat_holds (
    event_id   BIGINT NOT NULL,
    seat_id    TEXT   NOT NULL,
    customer_id BIGINT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (event_id, seat_id)
);

INSERT INTO seat_holds (event_id, seat_id, customer_id, expires_at)
VALUES (42, 'A-12', :customer_id, now() + interval '10 minutes')
ON CONFLICT (event_id, seat_id) DO UPDATE
    SET customer_id = EXCLUDED.customer_id, expires_at = EXCLUDED.expires_at
    WHERE seat_holds.expires_at < now();   -- only if the old hold expired
-- 1 row → hold acquired; 0 rows → a live hold exists
```

### Comparing the fixes

| Approach | How conflicts are resolved | Under heavy contention | Round trips | Best for |
|---|---|---|---|---|
| Conditional `UPDATE` | the `WHERE` is re-checked; loser updates 0 rows | good: short lock, no retries | 1 | single-row check-and-set (seat hold) |
| `SELECT … FOR UPDATE` | losers wait for the lock | waits pile up; use `NOWAIT` / `SKIP LOCKED` | 2+ | logic between read and write; multi-row decisions |
| Optimistic (`version`) | loser detects the change and retries | many failed attempts and retries | 2 + retries | rare conflicts, long user think time |
| Unique constraint / upsert | loser gets a constraint violation or 0 rows | good | 1 | "at most one" invariants; last line of defense |
| Serializable + retry | database aborts one transaction | aborts grow with contention | n + retries | complex invariants across many rows |

---

## Seat holds, end to end { #seat-holds }

A hold is a **lease**: a temporary, expiring claim. The seat's life cycle:

``` mermaid-sim
stateDiagram-v2
    [*] --> AVAILABLE
    AVAILABLE --> HELD: hold (conditional UPDATE)
    HELD --> SOLD: payment confirmed
    HELD --> AVAILABLE: hold expired or cancelled
    SOLD --> AVAILABLE: refund (rare, audited)
    SOLD --> [*]
```

Two design decisions make it robust:

1. **Lazy expiry.** The hold query treats an expired hold as available, so a seat is never stuck because a cleanup job is late:

    ```java title="InventoryRepository.java (Spring Data JPA)"
    @Modifying
    @Query("""
        UPDATE Seat s
           SET s.status = 'HELD', s.heldBy = :customerId, s.holdExpiresAt = :expiresAt
         WHERE s.eventId = :eventId AND s.seatId = :seatId
           AND (s.status = 'AVAILABLE'
                OR (s.status = 'HELD' AND s.holdExpiresAt < CURRENT_TIMESTAMP))
        """)
    int tryHold(@Param("eventId") long eventId, @Param("seatId") String seatId,
                @Param("customerId") long customerId, @Param("expiresAt") Instant expiresAt);
    ```

    The service throws `SeatTakenException` when `tryHold` returns 0. A background job still flips expired holds back to `AVAILABLE` (using the partial index on `hold_expires_at`) so the seat map stays accurate.

2. **Confirm conditionally, too.** Payment confirmation runs `UPDATE seats SET status = 'SOLD' WHERE … AND status = 'HELD' AND held_by = :customer_id AND hold_expires_at > now()`. If the hold expired while the fan was paying, 0 rows are updated and the payment is refunded or the fan is offered another seat. Never assume the state you saw minutes ago is still true.

---

## Contention: why hot rows cap throughput { #contention }

A row lock behaves like a server that serves one transaction at a time. If each transaction holds it for *t* seconds, that row admits at most **1 / t** transactions per second, no matter how big the machine is (Little's Law, from [Queueing](../../estimation/queueing/index.md)). The plot compares three designs under illustrative assumptions (load spread evenly over the contended rows; the database itself tops out at 10,000 transactions per second):

```python exec="1" html="1"
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

# A row lock is a server with capacity 1: if each transaction holds it for
# `hold` seconds, that row admits at most 1 / hold transactions per second.
# Assumptions (illustrative): load spread evenly over the contended rows,
# and the database tops out at 10,000 transactions/s overall.
hold_ms = np.linspace(1, 50, 200)
cap = 10_000
designs = [
    ("1 row: events.seats_left counter", 1, "#E45756"),
    ("40 rows: one counter per section", 40, "#F58518"),
    ("60,000 rows: one row per seat", 60_000, "#4C78A8"),
]

fig, ax = plt.subplots(figsize=(9, 4.2))
fig.patch.set_alpha(0)
for label, rows, color in designs:
    x = np.minimum(rows / (hold_ms / 1000), cap)
    ax.plot(hold_ms, x, color=color, lw=2.5, label=label)
ax.axhline(cap, color="#888", ls=":", lw=1.5)
ax.text(50, cap * 1.15, "database limit (assumed)", color="#888", ha="right", fontsize=9)
ax.set_yscale("log")
ax.set_ylim(10, 30_000)
ax.set_xlabel("time each transaction holds the row lock (ms)")
ax.set_ylabel("max purchases per second")
ax.set_title("A hot row caps throughput at 1 / lock time")
ax.grid(True, which="both", alpha=0.25)
ax.set_facecolor("none")
for item in [ax.title, ax.xaxis.label, ax.yaxis.label] + ax.get_xticklabels() + ax.get_yticklabels():
    item.set_color("#888")
for s in ax.spines.values():
    s.set_color("#888")
ax.tick_params(colors="#888", which="both")
leg = ax.legend(frameon=False, fontsize=9, loc="lower left")
for t in leg.get_texts():
    t.set_color("#888")
plt.tight_layout()

buffer = StringIO()
plt.savefig(buffer, format="svg", transparent=True)
print(buffer.getvalue())
plt.close()
```

The lessons:

- **Never keep a global counter in the hot path.** Decrementing `events.seats_left` in every hold serializes the whole on-sale on one row: at 5 ms per transaction, 200 holds per second, for 2 million fans. Compute "seats left" asynchronously (or with per-section counters) and show it from a cache.
- **Keep transactions short.** A transaction that calls the payment provider (hundreds of milliseconds to seconds) while holding a seat lock multiplies lock time by 100. Hold the seat, **commit**, call the provider *outside* any transaction, then confirm in a new short transaction.
- **Fine-grained rows spread contention.** One row per seat means fans only collide when they want the *same* seat.

**Try it.** The `flash-sale` scenario puts a waiting room (queue) in front of the inventory database. Run it, then remove the queue or raise the arrival rate and watch the SQL node's utilization and p99 latency: the queue exists precisely to keep the number of concurrent hold transactions below what the database can serve.

<div class="sdp" data-scenario="flash-sale" data-mode="compact" data-height="520"></div>

---

## Transactions across services { #across-services }

The hold lives in the `inventory` database, the order in the `order` database, and the payment at an external provider. No single ACID transaction spans them.

- **Two-phase commit (2PC)** coordinates several databases: a coordinator asks every participant to *prepare* (promise to commit), then tells all of them to *commit*. It is atomic, but a participant that prepared must wait — holding locks — until the coordinator answers; if the coordinator crashes at the wrong moment, they block. It is used inside some databases and with XA transactions, rarely across microservices, and never across an external payment provider.
- **Sagas** split the business transaction into local transactions, each with a **compensation** (release the hold, refund the payment), coordinated by events or an orchestrator. Combined with the **transactional outbox** (write the event in the same local transaction as the state change), they give atomicity *eventually*. See [Messaging patterns](../../messaging/patterns/index.md).
- Calls to the payment provider carry an **idempotency key**, so a retry never charges twice. See [Integrations](../../compute/integrations/index.md).

!!! example "BoxOffice: the checkout, transaction by transaction"

    1. `inventory`: conditional `UPDATE` → seat `HELD` for 10 minutes. **Commit.** (~2 ms of lock time)
    2. `order`: insert the order as `PENDING` + an outbox event `OrderCreated`. **Commit.**
    3. `payment`: call the provider with idempotency key = order id. No database transaction open.
    4. On `PaymentSucceeded`: `inventory` runs the conditional confirm (`HELD` by this customer and not expired → `SOLD`) and inserts the ticket (unique key). **Commit.**
    5. On failure or timeout: compensations release the hold and cancel the order.

    Every step is short, idempotent and safe to retry, and no lock is held while waiting for the network.

!!! tip "In the interview"

    - When a design has a **scarce resource** (seats, stock, usernames, coupon codes), say the words "check-then-act race" and show the fix: "a conditional `UPDATE … WHERE status = 'AVAILABLE'` and I check the affected row count", plus "a unique constraint as the last line of defense".
    - Know the default isolation level of the database you name (PostgreSQL: read committed; MySQL InnoDB: repeatable read) and one anomaly it allows.
    - For "best available" or job queues on SQL, mention `FOR UPDATE SKIP LOCKED`.
    - For flows across services, say **saga + outbox + idempotency keys**, not distributed transactions.
    - Mention contention: "a single counter row would cap the on-sale at 1 / lock-time — I avoid it".

!!! warning "Common pitfalls"

    - **Check in the application, act in the database** — the double booking. Move the check into the `WHERE` clause or a constraint.
    - **Long transactions**: a transaction open during an HTTP call, a user's think time, or a big report holds locks and old MVCC versions for its whole duration.
    - **Retrying without idempotency**: serializable and optimistic strategies require retries; the retried code must be safe to run twice.
    - **Raising the isolation level as a magic fix**: it changes behaviour per database, adds aborts under load, and still needs a retry loop.
    - **Inconsistent lock order** when locking several rows: deadlocks under exactly the load you are testing for.
    - **Caching the decision**: the seat *map* may come from a cache; the *hold* must always hit the database (see [Caching](../../caching/index.md)).

## How it connects { #how-it-connects }

``` mermaid
flowchart LR
    ACID["ACID"] --> ISO["isolation levels<br/>MVCC snapshots"]
    ISO --> ANOM["anomalies: lost update,<br/>write skew"]
    ANOM --> BUG["the double-booking bug<br/>check-then-act race"]
    BUG --> FIX["conditional UPDATE, FOR UPDATE,<br/>version column, unique constraint"]
    FIX --> HOLD["seat holds as leases<br/>lazy expiry + cleanup job"]
    FIX --> CONT["hot rows cap throughput<br/>at 1 / lock time"]
    CONT --> WR["waiting room<br/>→ Messaging"]
    BUG -.-> DIST["consistency models<br/>→ Distributed"]
    ACID --> XS["across services: saga, outbox,<br/>idempotency keys"]
```

**Palette components:** [`sql`](../../../reference/components/storage/index.md#sql) (the `inventory` database decides: conditional updates, row locks, constraints) · [`app`](../../../reference/components/compute/index.md#app) (`inventory` answers `409` to the losers; transactions stay short) · [`queue`](../../../reference/components/messaging/index.md#queue) (the waiting room bounds contention on hot rows) · [`scheduler`](../../../reference/components/compute/index.md#scheduler) (the job that flips expired holds back) · [`stream`](../../../reference/components/messaging/index.md#stream) (outbox events between `order`, `inventory` and `payment`) · [`payment`](../../../reference/components/external/index.md#payment) (called with an idempotency key, never inside a transaction). **Scenarios:** `flash-sale`, `payment-system`. **Continues in:** [Replication](../replication/index.md), [Distributed — transactions](../../distributed/transactions/index.md), [Messaging — patterns](../../messaging/patterns/index.md), [Compute — schedulers](../../compute/async-work/index.md#schedulers), [Case study: ticketing](../../case-studies/ticketing/index.md), [Hands-on 6](../../../hands-on/6/index.md).

---

[^1]: GRAY, J.; REUTER, A. *Transaction Processing: Concepts and Techniques*. Morgan Kaufmann, 1992.
[^2]: BERENSON, H. et al. A Critique of ANSI SQL Isolation Levels. *ACM SIGMOD*, 1995. See also KLEPPMANN, M. [Hermitage: testing transaction isolation levels](https://github.com/ept/hermitage){target="_blank"}.
[^3]: PostgreSQL Global Development Group. [Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html){target="_blank"}. PostgreSQL Documentation.
[^4]: PORTS, D. R. K.; GRITTNER, K. Serializable Snapshot Isolation in PostgreSQL. *Proceedings of the VLDB Endowment*, 5(12), 2012.
