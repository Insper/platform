---
marp: true
lang: en
title: Event-Driven Architecture
description: Platforms, Microservices, DevOps and APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Platforms, Microservices, DevOps and APIs · Insper</div>

# Event-Driven Architecture

**Publish a fact, let others react**

<!--
Outline: (1) why the synchronous chain hurts; (2) events, topics, partitions, offsets; (3) Kafka,
keys and consumer groups; (4) delivery guarantees, outbox and sagas; (5) event sourcing, CQRS;
(6) dead letter queue; (7) when not to use it.
-->

---

## Start with an order

<div class="q">

An order is placed. **Email, inventory, fraud, shipping and analytics** all need to know.
What happens to the response time if the order service calls each of them before answering?

</div>

* Latency becomes the **sum** of every call.
* One slow (or failing) dependency **stalls the whole request**.
* The order service must **know every consumer** — adding one means changing it.

<!--
Let the class answer before showing the bullets. The coupling argument (third bullet) is the one
that grows with the system.
-->

---

## Two contracts

<div class="cols">
<div>

### Synchronous chain

`POST /orders` → email → inventory → fraud → `201 Created`

The client waits for **all of them**.

</div>
<div>

### Publish an event

`POST /orders` → publish `OrderCreated` → `202 Accepted`

Each consumer reacts **on its own schedule**.

</div>
</div>

| Concern | Synchronous (REST) | Asynchronous (event) |
|---|---|---|
| Latency | sum of all calls | only the producer |
| Coupling | producer knows all consumers | producer knows none |
| Resilience | one slow consumer blocks all | failures are independent |
| Consistency | strong | **eventual** |

---

## The vocabulary

| Concept | What it is | Example |
|---|---|---|
| **Event** | immutable record of something that happened | `OrderCreated { orderId, … }` |
| **Command** | instruction to do something — can be rejected | `PlaceOrder { items, … }` |
| **Topic** | named, durable, ordered log | `order-events` |
| **Partition** | shard of a topic, for parallelism | partition 0, 1, 2 |
| **Offset** | position of a message in a partition | offset 42 |
| **Consumer group** | consumers sharing the work of a topic | `notification-service` |

<div class="ok">

**Events are facts**: the log is append-only, never updated. That is what makes it safe to **replay**.

</div>

---

## Kafka: topics, partitions, groups

- A **topic** is split into ordered **partitions**; order is guaranteed **within** a partition.
- Each **consumer group** keeps its own offset per partition — `notification-group` and `analytics-group` read the same log **independently**.
- Inside a group, **one partition → one consumer** at a time.
- Adding a new group never affects the existing ones.

<div class="warn">

More consumers than partitions? The extra consumers sit **idle**. Partitions are the ceiling of parallelism.

</div>

<p class="small">Messages stay after being read: <code>retention.ms</code> (default 7 days), <code>retention.bytes</code> (per partition) or <code>cleanup.policy=compact</code> (last value per key).</p>

---

## Keys, ordering and durability

- With a **key**, `hash(key) % partitions` picks the partition → same key, same partition, **in order**.
- Hands-on 9: `send("order-events", orderId, event)` → all events of one order stay in sequence; different orders run in parallel.
- Few key values (e.g. `country`) → **hot partitions**; adding partitions later moves keys.
- Each partition is **replicated** (typically 3): a leader + followers; the up-to-date ones form the **ISR**.

| `acks` | Confirmed when… | Risk |
|---|---|---|
| `0` | sent | lost if the broker never got it |
| `1` | the leader wrote it | lost if the leader dies first |
| `all` | all in-sync replicas have it | slowest — survives a broker loss |

---

## Pub/sub × competing consumers

<div class="cols">
<div>

### Pub/sub (fan-out)

One event → **every** group gets its own copy.

Email, audit log, analytics, cache invalidation.

</div>
<div>

### Competing consumers

Consumers of the **same** group split the partitions → each message processed **once**.

Order processing, payments, image resizing.

</div>
</div>

<div class="ok">

Same broker, two patterns: **different groups fan out**, **same group shares the work**.

</div>

---

## Delivery guarantees

<div class="q">

The notification service sends the e-mail, then **crashes before committing** the offset. What happens on restart?

</div>

* It reads the same message **again**: commit-after-processing = **at-least-once**.
* Commit *before* processing = **at-most-once**: a crash **loses** the message.
* Kafka's exactly-once covers only Kafka → Kafka; it cannot "un-send" an e-mail.
* So: at-least-once + an **idempotent consumer** — processed-IDs table, upserts, unique constraints.

<!--
Hands-on 9 uses enable_auto_commit=False and commit() after processing: at-least-once.
-->

---

## The dual write and the outbox

Saving the order in Postgres **and** publishing to Kafka are two systems, no shared transaction:

- commit, then crash before publishing → order exists, **event lost**;
- publish, then rollback → event about an order that **does not exist**.

**Transactional outbox**: `INSERT INTO orders` + `INSERT INTO outbox` in **one local transaction** → a relay (polling or CDC/Debezium) publishes to Kafka and marks the row as sent.

<div class="warn">

The relay can publish twice after a crash: consumers still need to be **idempotent**.

</div>

---

## Sagas

One business operation, several databases: reserve stock, then charge the card.

`OrderCreated` → inventory reserves → `StockReserved` → payment fails → `PaymentFailed` → inventory **releases** (compensation) → order `CANCELLED`

| Style | Coordination | Watch out |
|---|---|---|
| **Choreography** | services react to each other's events | the flow is spread everywhere |
| **Orchestration** | an orchestrator sends commands | one more service to run |

<p class="small">No isolation: others see intermediate states — model them (<code>PENDING</code>, <code>CONFIRMED</code>, <code>CANCELLED</code>).</p>

---

## Event sourcing

Store the **history**, not just the current state.

- The write model **is** the event log: `OrderCreated`, `ItemAdded`, `OrderPaid`, …
- Current state = **replay** the events (or start from a snapshot).
- Projections (read models) can be **rebuilt at any time** — time-travel debugging, new views without migrating data.

> The database stores where you are; the event log stores how you got there.

---

## CQRS

Separate the **write side** from the **read side**.

- **Commands** (`POST /orders`) → command handler → event store → event bus.
- **Queries** (`GET /orders`) → a **read model** shaped for the query.
- Often paired with event sourcing, but not required: change-data-capture can sync two databases.

<div class="warn">

The read model is **eventually consistent**: right after a command, a query may not see it yet.

</div>

---

## When a message keeps failing

A poison message must not **block the stream**.

1. Consumer picks it up → **processing**.
2. Transient failure → **retry** after backoff.
3. Max retries exceeded → move to the **Dead Letter Queue** (a separate topic).
4. The main stream continues; the DLQ is inspected and **reprocessed manually**.

<p class="small">Spring Kafka: <code>@RetryableTopic</code> configures attempts, backoff and the DLQ topic declaratively.</p>

---

## REST or event?

| Scenario | Fit | Why |
|---|---|---|
| Login / token generation | REST | the caller needs the token now |
| Order confirmation email | event | the user does not wait for it |
| Real-time fraud check that must block | REST | the answer gates the next step |
| Audit log of every mutation | event | fire-and-forget, fan-out |
| Payment | depends | idempotent retry → event; blocking confirmation → REST + saga |
| Analytics pipeline | event | high volume, slow consumers are fine |

---

## The price

<div class="warn">

A request that crosses **5 services and 3 topics** is hard to debug: you need **distributed tracing** (Observability class) to follow it.

</div>

- Eventual consistency must be **designed for** — in the UI and in the business rules.
- Consumers must be **idempotent**: at-least-once delivery means duplicates happen.
- Events are a public contract: only **add optional fields**; version breaking changes.
- Watch **consumer lag** per group — a growing backlog is an incident in slow motion.
- Adopt events when the **coupling and latency** of synchronous calls are concrete problems — not for their own sake.

---

## Takeaways

1. Synchronous chains add up **latency** and **coupling**; events decouple producer and consumers.
2. An **event** is an immutable fact; a **command** can be rejected.
3. Kafka: topic → **partitions**; the **key** picks the partition and so the order; `acks=all` for durability.
4. Different groups **fan out**; the same group **shares** the work.
5. Delivery is **at-least-once**: commit after processing, make consumers **idempotent**.
6. **Outbox** instead of dual writes; **sagas** with compensations instead of distributed transactions.
7. **Event sourcing**, **CQRS** and **DLQs** solve specific problems — the cost is eventual consistency and **tracing**.
