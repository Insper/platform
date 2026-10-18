A BoxOffice purchase touches three services that each own their data: `order` (the order), `inventory` (the seats) and `payment` (the charge, through an external provider). In a monolith with one database, the purchase would be one ACID transaction: hold the seats, charge, confirm — all or nothing. Split into services, there is no single database and no single transaction. The classic answer, a distributed transaction with two-phase commit (2PC), does not fit either: the payment provider will not join your transaction, and 2PC blocks every participant while a coordinator is unreachable.

This page collects the patterns that replace the distributed transaction in event-driven systems. Each one answers a precise question:

| Question | Pattern |
|---|---|
| How do I update my database **and** publish an event without losing either? | [Transactional outbox](#transactional-outbox) |
| How do I turn changes in a database into a stream of events? | [Change data capture](#cdc) |
| How do I run a business transaction that spans several services? | [Saga](#sagas) |
| How do I serve queries that need data shaped differently from the writes? | [CQRS](#cqrs) |
| How do I keep the full history as the source of truth? | [Event sourcing](#event-sourcing) |

---

## The dual-write problem

The simplest way to publish `OrderConfirmed` is to save the order and then send the event. That is two writes to two different systems — a **dual write** — and no transaction covers both:

``` mermaid-sim
sequenceDiagram
    participant O as order
    participant DB as order DB
    participant K as Kafka
    O->>DB: BEGIN · UPDATE orders SET status = 'CONFIRMED' · COMMIT
    Note over O: pod killed by a deploy
    O--xK: publish OrderConfirmed (never sent)
    Note over DB,K: the order is confirmed, but nobody is told: no e-mail, no ticket, no analytics
```

Swapping the order of the writes does not help:

| Order of writes | Crash between them | Result |
|---|---|---|
| DB commit, then publish | after the commit | Order confirmed, **event lost** (Bruno's missing e-mail) |
| Publish, then DB commit | after the publish | Event says "confirmed", but the transaction rolled back: **phantom event** |
| Publish inside the DB transaction | broker slow or down | The database transaction waits on the network; the broker's outage becomes your outage |

---

## Transactional outbox { #transactional-outbox }

The **transactional outbox**[^1] removes the dual write by writing the event **into the same database, in the same local transaction**, as the business change. A separate **relay** later reads the outbox table and publishes to the broker.

``` mermaid-sim
sequenceDiagram
    participant O as order
    participant DB as order DB
    participant R as outbox relay
    participant K as Kafka
    O->>DB: BEGIN
    O->>DB: UPDATE orders SET status = 'CONFIRMED'
    O->>DB: INSERT INTO outbox (OrderConfirmed)
    O->>DB: COMMIT (both rows or neither)
    R->>DB: SELECT unpublished rows
    R->>K: publish OrderConfirmed (key o-7731)
    K-->>R: ack
    R->>DB: mark row as published
```

The local transaction guarantees that the order and its event exist together or not at all. The relay guarantees that every committed event is eventually published — **at least once**: if it crashes after publishing but before marking the row, it publishes the row again on restart. Consumers must be idempotent anyway ([Delivery semantics](../semantics/index.md)).

The outbox table:

```sql
CREATE TABLE outbox (
    id              BIGSERIAL   PRIMARY KEY,           -- publication order
    event_id        UUID        NOT NULL UNIQUE,       -- consumers deduplicate on it
    aggregate_type  TEXT        NOT NULL,              -- 'order'
    aggregate_id    TEXT        NOT NULL,              -- 'o-7731', becomes the Kafka key
    type            TEXT        NOT NULL,              -- 'OrderConfirmed'
    payload         JSONB       NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at    TIMESTAMPTZ
);
CREATE INDEX outbox_unpublished ON outbox (id) WHERE published_at IS NULL;
```

The business code writes both rows in one transaction:

```java
@Service
@RequiredArgsConstructor
public class OrderService {

    private final OrderRepository orders;
    private final OutboxRepository outbox;

    @Transactional
    public void confirm(String orderId) {
        Order order = orders.findByIdForUpdate(orderId);
        order.confirm();                                   // PENDING -> CONFIRMED
        orders.save(order);
        outbox.save(OutboxEvent.of("order", order.id(), "OrderConfirmed",
                                   OrderConfirmed.from(order)));   // same transaction
    }
}
```

The relay has two common implementations:

=== "Polling publisher"

    A scheduled job reads unpublished rows in order, publishes them and marks them. `FOR UPDATE SKIP LOCKED` lets a second relay instance take over safely if the first one dies.

    ```java
    @Scheduled(fixedDelay = 200)
    @Transactional
    public void relay() {
        List<OutboxRow> rows = jdbc.query("""
            SELECT id, aggregate_id, payload FROM outbox
             WHERE published_at IS NULL
             ORDER BY id
             LIMIT 100
             FOR UPDATE SKIP LOCKED
            """, OutboxRow.MAPPER);
        for (OutboxRow row : rows) {
            kafka.send("order-events", row.aggregateId(), row.payload()).join();  // wait for the ack
            jdbc.update("UPDATE outbox SET published_at = now() WHERE id = ?", row.id());
        }
    }
    ```

    Simple and portable, but it adds polling load on the database and up to one polling interval of latency. Run a single active relay (or partition the work by aggregate) so events of the same order stay in order, and delete published rows after a few days.

=== "Log-based CDC (Debezium)"

    Debezium reads the database's replication log and publishes each new outbox row; nothing polls the table. Its *outbox event router* turns rows into events on the right topic with the right key.

    ```json
    {
      "name": "order-outbox",
      "config": {
        "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
        "database.hostname": "order-db",
        "database.port": "5432",
        "database.user": "debezium",
        "database.password": "debezium",
        "database.dbname": "order",
        "topic.prefix": "order",
        "plugin.name": "pgoutput",
        "table.include.list": "public.outbox",
        "transforms": "outbox",
        "transforms.outbox.type": "io.debezium.transforms.outbox.EventRouter",
        "transforms.outbox.table.field.event.id": "event_id",
        "transforms.outbox.table.field.event.key": "aggregate_id",
        "transforms.outbox.route.by.field": "aggregate_type",
        "transforms.outbox.route.topic.replacement": "${routedByValue}-events"
      }
    }
    ```

    Lower latency and no polling, at the price of running Kafka Connect and Debezium. Rows can be deleted right after insertion: the log already captured them.

---

## Change data capture { #cdc }

Every relational database keeps a **replication log** — PostgreSQL's write-ahead log (WAL), MySQL's binlog — that records every committed change in commit order; that is how replicas stay in sync (see [Replication](../../databases/replication/index.md)). **Change data capture** (CDC) reads that log and turns each change into an event[^2]. The outbox relay above is one use of CDC; there are many others.

``` mermaid-sim
flowchart LR
    cat["catalog"] -->|"INSERT / UPDATE events"| db[("catalog DB<br/>PostgreSQL")]
    db -->|"WAL (logical decoding)"| dbz["Debezium"]
    dbz -->|"catalog.public.events"| k{{"Kafka"}}
    k --> s["search indexer"]
    k --> c["cache invalidator"]
    k --> w["warehouse loader"]
```

For BoxOffice, CDC on the `catalog` database keeps three derived systems in sync without changing the `catalog` code: the search index (new shows appear in search seconds after being created), the cache (entries are invalidated when an event changes; see [Caching](../../caching/index.md)) and the data warehouse.

| | Transactional outbox (with CDC or polling) | Raw CDC on business tables |
|---|---|---|
| **What is published** | Events designed for consumers (`OrderConfirmed`) | Row changes (`orders` row 7731: status P → C) |
| **Contract** | An explicit, versioned event schema | The table schema — a refactoring of the table breaks consumers |
| **Code changes in the service** | Write the outbox row | None |
| **Best for** | Public domain events between services | Internal derived data: search, cache, warehouse, migrations |

!!! warning "Raw CDC leaks your schema"
    Publishing raw table changes makes your internal table layout a public API: renaming a column becomes a breaking change for consumers you may not know about. Use raw CDC for data you own end to end (your own search index, your warehouse), and an outbox with designed events for everything other teams consume.

---

## Sagas { #sagas }

A **saga** is a business transaction implemented as a **sequence of local transactions**, one per service; each step publishes an event or reply that triggers the next. If a step fails, the saga runs **compensating transactions** that semantically undo the steps already completed[^3][^1]. The idea comes from a 1987 database paper about long-lived transactions — older than microservices by decades.

### The BoxOffice purchase saga

| Step | Service | Local transaction | Compensation | Kind |
|---|---|---|---|---|
| 1 | `order` | Create order `PENDING` | Mark order `CANCELLED` | compensatable |
| 2 | `inventory` | Hold seats B-12, B-13 (hold expires in 10 min) | Release the seats | compensatable |
| 3 | `payment` | Charge the card through the provider (idempotency key = order id) | Refund | **pivot** |
| 4 | `inventory` | Mark seats `SOLD` | — | retriable |
| 5 | `order` | Mark order `CONFIRMED`, publish `OrderConfirmed` | — | retriable |

The **pivot** is the go/no-go point. Before it, every step can be compensated; after it, the saga never goes back — the remaining steps are **retriable**: they must eventually succeed, retried as many times as needed. That is why the seat hold must outlive the payment: if the hold could expire while the card is being charged, step 4 could fail permanently after the pivot and force a refund — a bad experience the design should make impossible (or at least rare and monitored).

There are two ways to coordinate the steps.

=== "Choreography"

    No central coordinator: each service reacts to the others' events.

    ``` mermaid-sim
    sequenceDiagram
        participant O as order
        participant I as inventory
        participant P as payment
        O->>I: OrderPlaced
        I->>I: hold seats
        I->>P: SeatsHeld
        P->>P: charge card
        alt payment succeeded
            P->>I: PaymentCaptured
            I->>I: mark seats SOLD
            I->>O: SeatsSold
            O->>O: CONFIRMED, publish OrderConfirmed
        else payment failed
            P->>I: PaymentFailed
            I->>I: release seats (compensation)
            I->>O: SeatsReleased
            O->>O: CANCELLED (compensation)
        end
    ```

=== "Orchestration"

    A **saga orchestrator** (here, inside `order`) sends commands and reacts to replies. The whole flow is in one place.

    ``` mermaid-sim
    sequenceDiagram
        participant S as purchase saga (order)
        participant I as inventory
        participant P as payment
        S->>I: HoldSeats
        I-->>S: SeatsHeld
        S->>P: ChargeCard (key o-7731)
        alt charged
            P-->>S: PaymentCaptured
            S->>I: MarkSeatsSold
            I-->>S: SeatsSold
            S->>S: CONFIRMED, publish OrderConfirmed
        else declined
            P-->>S: PaymentFailed
            S->>I: ReleaseSeats (compensation)
            I-->>S: SeatsReleased
            S->>S: CANCELLED
        end
    ```

The order's status *is* the saga's state, so the saga is a state machine:

``` mermaid-sim
stateDiagram-v2
    [*] --> PENDING
    PENDING --> SEATS_HELD : SeatsHeld
    PENDING --> CANCELLED : NoSeats
    SEATS_HELD --> PAID : PaymentCaptured (pivot)
    SEATS_HELD --> RELEASING : PaymentFailed / timeout
    RELEASING --> CANCELLED : SeatsReleased
    PAID --> CONFIRMED : SeatsSold (retried until success)
    CONFIRMED --> [*]
    CANCELLED --> [*]
```

A minimal orchestrator handles each reply in a local transaction, moves the state machine and sends the next command through the outbox:

```java
@Component
@RequiredArgsConstructor
public class PurchaseSaga {

    private final SagaRepository sagas;
    private final CommandPublisher commands;          // writes commands to the outbox

    @Transactional
    public void handle(SagaReply reply) {
        PurchaseState s = sagas.lock(reply.orderId());  // SELECT ... FOR UPDATE
        if (s.alreadyApplied(reply.replyId())) return;  // duplicate reply: ignore
        switch (s.step()) {
            case HOLDING_SEATS -> {
                if (reply.ok()) { s.moveTo(CHARGING);  commands.send(new ChargeCard(s.orderId(), s.total())); }
                else            { s.moveTo(CANCELLED); commands.send(new CancelOrder(s.orderId())); }
            }
            case CHARGING -> {
                if (reply.ok()) { s.moveTo(CONFIRMING); commands.send(new MarkSeatsSold(s.orderId())); }
                else            { s.moveTo(RELEASING);  commands.send(new ReleaseSeats(s.orderId())); }
            }
            case CONFIRMING -> { s.moveTo(CONFIRMED); commands.send(new ConfirmOrder(s.orderId())); }
            case RELEASING  -> { s.moveTo(CANCELLED); commands.send(new CancelOrder(s.orderId())); }
            default -> throw new IllegalStateException("unexpected reply in " + s.step());
        }
        sagas.save(s.applied(reply.replyId()));
    }
}
```

| | Choreography | Orchestration |
|---|---|---|
| **Coordination** | Each service reacts to events | One orchestrator sends commands and tracks state |
| **Coupling** | Services know each other's events | Participants only know their commands; the orchestrator knows the flow |
| **Visibility of the flow** | Spread over several codebases; hard to answer "where is order o-7731?" | One state machine; easy to inspect, test and change |
| **Risk** | Cyclic dependencies, "event spaghetti" as steps grow | The orchestrator can become a god service holding business logic |
| **Good for** | 2–3 steps, simple flows | 4+ steps, timeouts, branches — like the purchase |

In production, orchestrated sagas are often written on a **durable execution / workflow engine** — Temporal, AWS Step Functions, Azure Durable Functions, Camunda — which persists the state after each step, handles timers ("release the hold if no payment in 10 minutes") and retries, and survives restarts of the process running it.

### Sagas are not transactions

A saga is **ACD without I**: it is atomic (eventually all steps or all compensations), consistent and durable, but **not isolated**. Other requests see intermediate states — seats held but not sold, an order paid but not yet confirmed. Design for it:

- **Semantic lock**: the intermediate state is explicit and respected by everyone. Seats in `HELD` are not offered to other fans; the order page says "processing payment".
- **Compensations are business actions, not rollbacks.** A refund is a new transaction with its own trace in the books (and a notification to the fan), not an erase.
- **Every step and every compensation is idempotent**, because commands and events are delivered at least once.
- **Every step has a deadline.** If the payment provider does not answer, do not compensate blindly — the charge may have succeeded. Query the provider (by idempotency key) and reconcile first (see [Integrations](../../compute/integrations/index.md)).

!!! example "BoxOffice: what the fan sees during the saga"

    The purchase API answers `202 Accepted` with the order id right after step 1. The page shows "Seats held — processing payment" (semantic lock) and listens for the outcome (polling `GET /orders/o-7731` or a server-sent event). Most sagas finish in about a second, so the fan barely notices; when the provider is slow, the page keeps an honest status instead of a spinner that ends in a timeout.

---

## CQRS { #cqrs }

**Command Query Responsibility Segregation** (CQRS) separates the model that handles **writes** (commands) from the models that serve **reads** (queries)[^4]. The write model is optimized for correctness and invariants (normalized tables, transactions, locks); each read model is a denormalized **projection** shaped for one screen or query, built from the write side's events.

``` mermaid-sim
flowchart LR
    fan["fan"] -->|"POST /orders (command)"| order["order<br/>write model"]
    order --> odb[("order DB<br/>normalized")]
    order -->|"outbox: order events"| k{{"Kafka"}}
    k --> p1["my-tickets projector"]
    k --> p2["search projector"]
    p1 --> v1[("my_tickets view<br/>one row per ticket")]
    p2 --> v2[("search index")]
    fan -->|"GET /me/tickets (query)"| v1
```

The "My tickets" page needs, for one fan, every ticket with show name, date, venue, seat and QR code — data owned by `order`, `catalog` and `inventory`. Joining across three services on every page view is slow and fragile. Instead, a projector consumes their events and maintains a `my_tickets` table with exactly the columns the page needs. Reads become a single indexed query, and the read side scales independently (replicas, cache, even a different database).

The price is **eventual consistency between write and read**: right after buying, the fan opens "My tickets" and the new ticket is not there yet, because the projector is a few hundred milliseconds behind. Common fixes for this *read-your-writes* problem (see [Consistency](../../distributed/consistency/index.md)):

- Return the new state in the command's response and let the client show it immediately.
- Pass a version token: the client sends "I need at least version 42" and the read side waits briefly (or falls back to the write model) until it has it.
- Read the user's **own recent** writes from the write model, everything else from the projection.

!!! warning "CQRS is not a default"
    CQRS adds moving parts: projectors, more storage, lag to monitor, rebuild procedures. Use it where reads and writes truly differ in shape or scale (BoxOffice's catalog browsing, "My tickets", search), not for every CRUD entity.

---

## Event sourcing { #event-sourcing }

In most systems the database stores the **current state** and events are a side product. **Event sourcing** inverts this: the **sequence of events is the source of truth**, and the current state is computed by replaying them[^5].

```sql
CREATE TABLE order_events (
    order_id    TEXT        NOT NULL,
    version     INT         NOT NULL,      -- 1, 2, 3... per order
    type        TEXT        NOT NULL,      -- 'OrderPlaced', 'SeatsHeld', ...
    payload     JSONB       NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (order_id, version)        -- two writers cannot both append version 4
);
```

```java
public record Order(String id, OrderStatus status, List<String> seats, long totalCents) {

    public static Order replay(List<OrderEvent> history) {
        Order order = null;
        for (OrderEvent e : history) {                // oldest first
            order = switch (e) {
                case OrderPlaced p     -> new Order(p.orderId(), PENDING, p.seats(), p.totalCents());
                case SeatsHeld h       -> order.with(SEATS_HELD);
                case PaymentCaptured c -> order.with(PAID);
                case OrderConfirmed c  -> order.with(CONFIRMED);
                case OrderCancelled c  -> order.with(CANCELLED);
            };
        }
        return order;
    }

    Order with(OrderStatus s) { return new Order(id, s, seats, totalCents); }
}
```

To change an order, the service loads its events, rebuilds the state, checks the business rules, and appends new events with the next version; the primary key turns a concurrent append into a conflict (**optimistic concurrency**). Long histories are loaded from a **snapshot** plus the events after it. Read models are projections, as in CQRS — which is why the two patterns usually appear together.

| Benefits | Costs |
|---|---|
| Complete audit trail: *why* and *when* every change happened | Events are a permanent contract: every version must stay readable forever |
| Temporal queries: "what did this order look like at 10:03?" | Queries need projections; "all orders over R$ 1,000" is not a simple `SELECT` |
| Debugging by replay; new read models built from history | Unfamiliar to most teams; easy to get wrong |
| Natural fit for event-driven integration | Deleting personal data (LGPD/GDPR) in an immutable log needs care (e.g. encrypt per customer and delete the key) |

!!! tip "Where event sourcing fits in BoxOffice"
    Good candidates: the **payment ledger** (money must be auditable, and an append-only ledger is how accounting already works) and the order history. Bad candidates: the event catalog (a plain table with CDC is enough) and the seat map during an on-sale (it needs fast, locked updates of current state, not a growing history).

---

## Choosing the patterns

| Pattern | Solves | Costs | BoxOffice use |
|---|---|---|---|
| Transactional outbox | Lost or phantom events on publish | An extra table and a relay; at-least-once publication | Every service that publishes domain events |
| Change data capture | Keeping derived systems in sync with a database | Kafka Connect/Debezium to run; schema coupling if raw | Catalog → search, cache invalidation, warehouse |
| Saga | Business transactions across services | No isolation; compensations to design; harder to debug | Purchase: order → hold → payment → confirm |
| CQRS | Reads shaped differently from writes, or at a different scale | Projections, lag, read-your-writes handling | "My tickets", catalog browsing |
| Event sourcing | Full history as the source of truth | Event versioning forever; projections for every query | Payment ledger, order history |

!!! tip "In the interview"
    For any flow that crosses services and moves money or inventory, interviewers expect you to say "saga" *and* to make it concrete: list the steps with their compensations, name the pivot (the payment), explain what the user sees in the intermediate state (seats held, payment processing) and how timeouts are handled (reconcile with the provider before compensating). Publishing events? Say "transactional outbox" before they ask about the crash between the commit and the publish. Mention CQRS or event sourcing only when a requirement calls for them (audit, very different read shapes), and say what they cost.

!!! warning "Common pitfalls"

    - **Dual writes** "because the crash window is tiny" — at BoxOffice's volume, tiny windows happen every day.
    - **Compensations that are not idempotent** — a duplicated `ReleaseSeats` must not release seats someone else has since bought (release only seats held *by this order*).
    - **Compensating on timeout without reconciling** — refunding (or cancelling) a payment that actually succeeded, or leaving a charged customer without tickets.
    - **No deadline on saga steps** — orders stuck in `PENDING` forever, seats held forever.
    - **Raw CDC as an integration contract** between teams.
    - **Event sourcing everything** — most data is fine as current state plus an outbox.

## How it connects { #how-it-connects }

``` mermaid
flowchart LR
    DW["dual write:<br/>database + broker"] --> OUT["transactional outbox<br/>one local transaction"]
    OUT --> RELAY["relay: polling or<br/>Debezium"]
    RELAY --> K["kafka topic"]
    WAL["WAL / binlog<br/>→ Databases replication"] --> CDC["change data capture"]
    CDC --> RELAY
    CDC --> DER["search index, cache,<br/>warehouse"]
    K --> SAGA["saga: local transactions<br/>+ compensations"]
    SAGA --> PIVOT["pivot = payment<br/>→ Integrations"]
    SAGA --> ISO["no isolation:<br/>semantic locks, deadlines"]
    SAGA --> TPC["2PC vs sagas<br/>→ Distributed transactions"]
    K --> CQRS["CQRS projections<br/>read-your-writes"]
    ES["event sourcing:<br/>events are the truth"] --> CQRS
```

**Palette components:** [`sql`](../../../reference/components/storage/index.md#sql) (business rows + outbox, WAL for CDC) · [`kafka`](../../../reference/components/messaging/index.md#kafka) · [`stream`](../../../reference/components/messaging/index.md#stream) · [`search`](../../../reference/components/compute/index.md#search) (CDC-fed index) · [`cache`](../../../reference/components/storage/index.md#cache) (CDC invalidation) · [`dwh`](../../../reference/components/storage/index.md#dwh) (CDC-fed warehouse) · [`payment`](../../../reference/components/external/index.md#payment) (the saga's pivot). **Scenarios:** `payment-system`, `flash-sale`. **Continues in:** [Distributed — transactions](../../distributed/transactions/index.md) (2PC vs sagas), [Databases — replication](../../databases/replication/index.md) (the log CDC reads), [Caching — invalidation from CDC](../../caching/invalidation/index.md#cdc), [Compute — integrations](../../compute/integrations/index.md), [Case study: payment system](../../case-studies/payment-system/index.md), [Hands-on 7 — outbox](../../../hands-on/7/outbox/index.md), [Exercise — event-driven](../../../exercises/event-driven/index.md).

---

[^1]: RICHARDSON, C. *Microservices Patterns*. Manning, 2018. See also [microservices.io — Transactional outbox, Saga, CQRS, Event sourcing](https://microservices.io/patterns/){target="_blank"}.
[^2]: [Debezium Documentation — Outbox Event Router](https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html){target="_blank"}; KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2nd ed. O'Reilly. Section on change data capture.
[^3]: GARCIA-MOLINA, H.; SALEM, K. Sagas. In: *Proceedings of the ACM SIGMOD International Conference on Management of Data*, 1987, p. 249–259.
[^4]: FOWLER, M. [CQRS](https://martinfowler.com/bliki/CQRS.html){target="_blank"}. martinfowler.com, 2011; YOUNG, G. [CQRS Documents](https://cqrs.files.wordpress.com/2010/11/cqrs_documents.pdf){target="_blank"}, 2010.
[^5]: FOWLER, M. [Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html){target="_blank"}. martinfowler.com, 2005.
