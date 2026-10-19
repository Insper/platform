The fan has held seat A-12 and taps **Pay R$ 450**. Three things must now happen together: `inventory` turns the seat from `HELD` into `SOLD`, `payment` charges the card through an external provider, and `order` records a confirmed order. Inside one PostgreSQL database this would be a single transaction — `BEGIN … COMMIT`, all or nothing. But the three pieces live in **three services with three databases** (and one of them is someone else's company). What happens when the charge succeeds and the `inventory` database is down? Or the seat is marked `SOLD` and the charge is declined?

A **distributed transaction** is a unit of work that changes data on several nodes and must be **atomic**: either every change happens, or none does. This page shows the classic protocol that achieves it — **two-phase commit (2PC)** —, why it is rarely used across microservices, and what replaces it in practice: **sagas**, the **reservation (try–confirm–cancel)** pattern and the **transactional outbox**.

---

## Atomicity across nodes: the problem

On one node, atomicity is provided by the database's log: a transaction's changes become durable and visible at a single point, the commit record. Across nodes there is no single log, and each participant can fail independently — so a naïve "commit everywhere, one after the other" leaves a window where some participants committed and others did not:

``` mermaid-sim
sequenceDiagram
    participant O as order (checkout)
    participant I as inventory DB
    participant P as payment provider
    O->>I: UPDATE seat A-12 to SOLD, then COMMIT
    I-->>O: committed
    O->>P: charge R$ 450
    P-->>O: declined (card limit)
    Note over O,P: the seat is SOLD but nobody paid:<br/>no single place can roll both back
```

Two families of solutions exist:

| Approach | Idea | Isolation | Availability |
|---|---|---|---|
| **Atomic commitment (2PC)** | Everyone *prepares*, then a coordinator decides commit/abort for all | Full ACID across participants | All participants and the coordinator must be up at the same time |
| **Sagas and compensations** | A sequence of local transactions; on failure, run **compensating** transactions that undo the earlier steps | None between steps (intermediate states are visible) | Each step only needs its own service |

---

## Two-phase commit (2PC) { #2pc }

2PC introduces a **coordinator** (often the service or database node that started the transaction) and splits the commit into two phases[^1]:

1. **Prepare (voting)**: the coordinator asks every participant "can you commit?". A participant that answers **yes** must first write all the changes and a *prepared* record durably to disk and keep the locks: from that moment it has **promised** to commit if asked — it can no longer abort on its own.
2. **Commit (decision)**: if **all** voted yes, the coordinator writes **commit** to its own log and tells everyone to commit; if anyone voted no (or timed out), it decides **abort**.

``` mermaid-sim
sequenceDiagram
    participant C as coordinator
    participant I as inventory DB
    participant R as order DB
    C->>I: PREPARE (seat A-12 → SOLD)
    C->>R: PREPARE (order 981 → CONFIRMED)
    I-->>C: YES (changes + prepared record on disk, locks held)
    R-->>C: YES
    Note over C: all YES: write COMMIT to the coordinator log
    C->>I: COMMIT
    C->>R: COMMIT
    I-->>C: done (locks released)
    R-->>C: done
```

PostgreSQL exposes the participant side as `PREPARE TRANSACTION 'id'` followed later by `COMMIT PREPARED 'id'` or `ROLLBACK PREPARED 'id'`; the X/Open **XA** standard defines the same protocol for databases and message brokers coordinated by a transaction manager (as in Jakarta EE).

### The blocking problem { #blocking }

The weak point is the moment **after a participant voted yes and before it hears the decision**. If the coordinator crashes there, the participant is **in doubt**: it cannot commit (maybe someone voted no) and cannot abort (maybe the coordinator decided commit and others already committed). It must **wait**, holding its locks, until the coordinator recovers:

``` mermaid-sim
sequenceDiagram
    participant C as coordinator
    participant I as inventory DB
    participant R as order DB
    C->>I: PREPARE
    C->>R: PREPARE
    I-->>C: YES (locks on seat A-12 held)
    R-->>C: YES
    Note over C: crashes before sending the decision
    Note over I: in doubt: cannot commit, cannot abort
    Note over I,R: seat A-12 stays locked until<br/>the coordinator comes back
```

During the 10:00 on-sale, a locked seat row blocks every other fan trying to hold it, and a crashed coordinator can freeze a whole block of seats. **Three-phase commit (3PC)** tries to remove the blocking but assumes bounded network delays, which real networks do not guarantee; production systems instead make the **coordinator itself fault-tolerant** by replicating its decision with **consensus** — exactly what Google Spanner (2PC over Paxos groups) and CockroachDB (over Raft) do[^2].

### What 2PC costs

- **Latency**: two round trips to every participant, plus forced disk writes (fsync) at each prepare and at the decision. Locks are held for the whole duration — the slowest participant decides how long.
- **Availability**: the coordinator and **every** participant must be up *at the same time*. Availabilities multiply, like services in series:

```python exec="1" html="1"
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "xtick.color": "#888",
                     "ytick.color": "#888", "axes.edgecolor": "#888", "font.size": 10})

# 2PC needs the coordinator and EVERY participant up at the same time: availabilities multiply.
n = np.arange(1, 11)                     # number of participants
fig, ax = plt.subplots(figsize=(8, 3.6))
for a, color in [(0.9999, "#1e9e5a"), (0.999, "#2f6fed"), (0.99, "#e5484d")]:
    ax.plot(n, 100 * a ** (n + 1), "o-", color=color, lw=2,
            label=f"each node available {100 * a:g}%")
ax.set_xlabel("participants in the transaction (plus 1 coordinator)")
ax.set_ylabel("P(all available), %")
ax.set_xticks(n)
ax.grid(alpha=0.25)
ax.legend(frameon=False, loc="lower left")
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True, bbox_inches="tight")
print(buf.getvalue())
plt.close()
```

- **Coupling**: every participant must speak the same protocol and expose "prepared" state. An external payment provider will **never** join your 2PC: its API charges or declines, with no "prepare and wait for my decision" step.

!!! info "Where 2PC is alive and well"
    2PC is the standard **inside** a distributed database or broker, where one vendor controls all participants and the coordinator is replicated: Spanner, CockroachDB, YugabyteDB, TiDB, and Kafka transactions (atomic writes to several partitions plus consumer offsets). What is discouraged is 2PC **across independently deployed microservices** and third parties.

??? question "Think first: `inventory` and `order` share the same PostgreSQL cluster but use different schemas. Do you need 2PC between them?"

    No — if both tables are in the **same database**, a single local transaction covers both, and that is far simpler and faster than any distributed protocol. Splitting data into separate databases is a decision with a price; when two pieces of data must change atomically all the time, that is a strong hint they belong to the same service or at least the same database (see [Compute — services](../../compute/services/index.md)).

---

## Sagas { #sagas }

A **saga** (Garcia-Molina and Salem, 1987)[^3] splits a long transaction into a **sequence of local transactions** $T_1, T_2, …, T_n$, each committed in its own service's database. If step $T_k$ fails, the saga runs **compensating transactions** $C_{k-1}, …, C_1$ that semantically undo the steps already done. There is no global lock and no global commit point.

The BoxOffice checkout as a saga:

| Step | Local transaction (service) | Compensation |
|---|---|---|
| 1 | Create order `PENDING` (`order`) | Mark order `CANCELLED` |
| 2 | Confirm the hold: seat `HELD` → `RESERVED_FOR_PAYMENT` (`inventory`) | Release the seat → `FREE` |
| 3 | Charge the card (`payment` → provider) | Refund the charge |
| 4 | Seat → `SOLD`, order → `CONFIRMED`, issue ticket | *(last step: no compensation; it must succeed — retried until it does)* |

``` mermaid-sim
sequenceDiagram
    participant O as order (orchestrator)
    participant I as inventory
    participant P as payment
    participant N as notification
    O->>O: T1: order 981 PENDING
    O->>I: T2: reserve seat A-12 for payment
    I-->>O: reserved
    O->>P: T3: charge R$ 450 (idempotency key)
    P-->>O: declined
    Note over O: T3 failed: compensate in reverse order
    O->>I: C2: release seat A-12
    I-->>O: seat FREE
    O->>O: C1: order 981 CANCELLED
    O->>N: tell the fan "payment declined"
```

Two ways to coordinate the steps:

=== "Orchestration"

    A central **orchestrator** (here, the `order` service or a workflow engine such as Temporal or AWS Step Functions) tells each participant what to do and decides when to compensate. The saga's logic is in one place, easy to read, monitor and change; the orchestrator must persist its state so it survives restarts. Preferred when there are more than a few steps.

=== "Choreography"

    No central brain: each service reacts to **events** from the others (`OrderCreated` → `inventory` reserves → `SeatReserved` → `payment` charges → `PaymentFailed` → `inventory` releases…). Loosely coupled and simple for two or three steps; with more, the flow is spread over many services and hard to follow ("who compensates what?"). Covered with Kafka in [Messaging — patterns](../../messaging/patterns/index.md).

### Sagas give up isolation

Between steps, other transactions see intermediate states: an order `PENDING`, a seat `RESERVED_FOR_PAYMENT`. Sagas are **ACD without the I**. Design countermeasures explicitly[^4]:

- **Semantic locks**: the intermediate state *is* the lock — while a seat is `RESERVED_FOR_PAYMENT`, no other fan can hold it, and the hold expires after 10 minutes if the saga never finishes.
- **Commutative and idempotent steps**: every step and compensation may be retried (at-least-once), so each one needs an idempotency key ([Idempotency](../index.md#idempotency)).
- **Order the steps by risk**: do the cheap, invisible, easily reversed steps first, and the steps that are hard or impossible to compensate (a charge, an e-mail) last, so that a failure late in the saga has little to undo. A refund is a compensation the fan *sees*; releasing a seat is invisible.
- **Pivot step**: the step after which the saga can only go forward (here, the successful charge) — after it, the remaining steps must be retried until they succeed, never compensated.

### Reservation: try, confirm, cancel { #tcc }

The **TCC** pattern (try–confirm–cancel) makes each participant offer a *tentative* operation with a timeout. BoxOffice already works this way: the **hold** is the *try* (the seat is reserved for 10 minutes), the **sale** is the *confirm*, and **expiry or release** is the *cancel*. Payment providers offer the same shape: **authorise** (reserve funds) → **capture** (take them) or **void** (release them). Because every tentative state expires by itself, a crash anywhere leaves the system converging to a safe state instead of blocking.

---

## The dual-write problem and the outbox { #outbox }

Every saga step does two things: change its own database **and** tell the next step (send an event or a command). Doing them as two separate writes is the **dual-write problem** — if the service crashes between them, the database says "seat reserved" but no event is ever sent, and the saga stalls:

``` mermaid-sim
sequenceDiagram
    participant I as inventory
    participant DB as inventory DB
    participant K as Kafka
    I->>DB: UPDATE seat + INSERT INTO outbox (SeatReserved), one COMMIT
    Note over I,DB: one local transaction: both or neither
    DB-->>I: committed
    Note over DB,K: a relay (poller or CDC such as Debezium)<br/>reads the outbox table
    DB->>K: publish SeatReserved
    K-->>DB: ack: mark outbox row as sent
```

The **transactional outbox** writes the event into an `outbox` table **in the same local transaction** as the business change; a separate relay publishes outbox rows to the broker and marks them sent. Publishing is at-least-once, so consumers must be idempotent. The details (polling vs change data capture, ordering, cleanup) are in [Messaging — patterns](../../messaging/patterns/index.md) and [Hands-on 7](../../../hands-on/7/index.md).

---

## Choosing

| | Local transaction | 2PC / distributed DB | Saga (orchestrated) | Saga (choreographed) | TCC / reservation |
|---|---|---|---|---|---|
| **Atomicity** | Yes | Yes | Eventually, via compensation | Eventually, via compensation | Eventually, via confirm/cancel |
| **Isolation** | Yes | Yes | No (semantic locks) | No | Partial (the reservation) |
| **Availability** | One DB | All participants at once | Each step independently | Each step independently | Each step independently |
| **Latency** | Lowest | 2 round trips + fsyncs, locks held | Sum of steps, asynchronous possible | Asynchronous | Try now, confirm later |
| **Works with third parties** | — | No | Yes | Yes | Yes, if they offer reserve/capture |
| **Complexity** | Lowest | In the database (if it offers it) | Orchestrator state, compensations | Event flow spread across services | Timeouts and expiry logic |
| **BoxOffice use** | Hold a seat; seat + outbox row | Inside CockroachDB/Spanner if used | Checkout | Notifications, analytics | Seat hold; card authorise/capture |

!!! example "BoxOffice: the checkout, end to end"
    1. **Hold** (TCC *try*): `inventory` runs one local transaction — conditional `UPDATE` of the seat to `HELD` with `expires_at`, plus an outbox row `SeatHeld`.
    2. **Checkout saga**, orchestrated by `order`: create order `PENDING` → `inventory` moves the seat to `RESERVED_FOR_PAYMENT` → `payment` **authorises** the card with an idempotency key → `inventory` marks the seat `SOLD` → `payment` **captures** → order `CONFIRMED` → `notification` sends the ticket.
    3. **Failures**: card declined → release the seat, cancel the order. Timeout talking to the provider → query the provider by idempotency key before deciding (the charge may have happened — see [Slow or dead?](../index.md#slow-or-dead)). Orchestrator crash → it resumes from its persisted state. Abandoned hold → expires after 10 minutes and the sweeper releases the seat.
    4. **No 2PC anywhere** across services — the external provider could not join one anyway.

!!! tip "In the interview"
    When a design touches several services' data "atomically", say: *"I won't use 2PC across services — it blocks if the coordinator fails, couples availability of every participant, and the payment provider can't participate. I'll use an orchestrated saga with compensations, idempotent steps, a semantic lock on the seat, and a transactional outbox to publish each step's event."* Then name the **pivot step** and what happens on a timeout with the provider. If the data can live in one database, say so — the best distributed transaction is the one you avoid.

!!! warning "Pitfalls"
    - **Dual writes** (database, then broker) without an outbox: a crash between them silently stalls the saga.
    - **Non-idempotent steps or compensations**: retries double-charge or double-refund.
    - **Forgetting that compensations can fail**: they must be retried until they succeed, and alerted on when they cannot.
    - **Treating sagas as isolated**: another fan sees `RESERVED_FOR_PAYMENT`; design for it (semantic locks, expiry).
    - **2PC with a non-replicated coordinator**: a coordinator crash leaves participants in doubt with locks held.

## How it connects { #how-it-connects }

``` mermaid
flowchart LR
    IDEM["idempotency keys<br/>(overview)"] --> SAGA["saga steps<br/>retried safely"]
    OUT["transactional outbox"] --> SAGA
    SAGA --> ORCH["orchestration<br/>(workflow engine)"]
    SAGA --> CHOR["choreography<br/>(events on Kafka)"]
    TCC["reservations: hold, authorise"] --> SAGA
    TPC["2PC"] --> BLOCK["blocks if the<br/>coordinator fails"]
    BLOCK --> CONS["replicate the coordinator<br/>→ Consensus"]
    CONS --> NEWSQL["inside Spanner,<br/>CockroachDB, Kafka txns"]
```

**Palette components involved:** [`stream`](../../../reference/components/messaging/index.md#stream) / [`kafka`](../../../reference/components/messaging/index.md#kafka) (saga events, outbox relay) · [`queue`](../../../reference/components/messaging/index.md#queue) (commands to participants) · [`payment`](../../../reference/components/external/index.md#payment) (authorise / capture / void) · [`sql`](../../../reference/components/storage/index.md#sql) (local transactions + outbox table) · [`worker`](../../../reference/components/compute/index.md#worker) (orchestrator, relay). Try the `payment-system` and `flash-sale` scenarios in the [playground](../../../../playground/index.md). **Continues in:** [Messaging — patterns](../../messaging/patterns/index.md), [Compute — integrations](../../compute/integrations/index.md), [Case study: ticketing](../../case-studies/ticketing/index.md).

## Key takeaways

- A distributed transaction must be **atomic across nodes**; there is no single log to make it so.
- **2PC** (prepare, then commit) gives ACID across participants but **blocks** when the coordinator fails, holds locks for two round trips, and needs every participant up at once — use it **inside** distributed databases, not across microservices.
- **Sagas** chain local transactions with **compensations**; they trade isolation for availability — use semantic locks, idempotent steps and a pivot step.
- **TCC / reservations** (hold → sell / expire; authorise → capture / void) make tentative states expire safely.
- The **transactional outbox** solves the dual-write problem between a database and a broker.

---

[^1]: GRAY, J.; LAMPORT, L. [Consensus on Transaction Commit](https://www.microsoft.com/en-us/research/publication/consensus-on-transaction-commit/){target="_blank"}. ACM TODS, 2006.
[^2]: CORBETT, J. C. et al. [Spanner: Google's Globally-Distributed Database](https://research.google/pubs/spanner-googles-globally-distributed-database-2/){target="_blank"}. OSDI, 2012.
[^3]: GARCIA-MOLINA, H.; SALEM, K. [Sagas](https://www.cs.cornell.edu/andru/cs711/2002fa/reading/sagas.pdf){target="_blank"}. ACM SIGMOD, 1987.
[^4]: RICHARDSON, C. [Pattern: Saga](https://microservices.io/patterns/data/saga.html){target="_blank"} and *Microservices Patterns*. Manning, 2018.
