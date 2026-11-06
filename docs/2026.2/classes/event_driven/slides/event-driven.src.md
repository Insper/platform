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
Outline: (1) why event-driven: the synchronous chain vs publishing an event; (2) core concepts;
(3) Kafka: the log, keys and ordering, durability; (4) messaging patterns: pub/sub, competing
consumers, event sourcing, CQRS; (5) delivery guarantees and idempotent consumers; (6) outbox and
sagas; (7) dead letter queue; (8) when to use it, and the pitfalls.
-->

---

## Start with an order

<div class="q">

An order is placed. **Email, inventory, fraud, shipping and analytics** all need to know.
What happens to the response time if the order service calls each of them before answering?

</div>

* Latency becomes the **sum** of every call — a latency cliff.
* One slow (or failing) dependency **stalls the whole request**.
* The order service must **know every consumer** — a coupling explosion.

<!--
Let the class answer before showing the bullets. The alternative contract: publish an event and let
interested parties react asynchronously.
-->

---

<!-- _class: tight -->

## Two contracts

<div class="cols">
<div>

### Synchronous chain

`POST /orders` → email → inventory → fraud → `201 Created`: the client waits for **all of them**.

</div>
<div>

### Publish an event

`POST /orders` → publish `OrderCreated` → `202 Accepted`: each consumer reacts **on its own schedule**.

</div>
</div>

| Concern | Synchronous (REST) | Asynchronous (event) |
|---|---|---|
| Latency | sum of all calls | only the producer |
| Coupling | producer knows all consumers | producer knows none |
| Resilience | one slow consumer blocks all | failures are independent |
| Throughput | limited by the slowest dependency | consumers scale independently |
| Debugging | simple request trace | needs distributed tracing |
| Consistency | strong | **eventual** |

<!--
The page's queue-depth simulation: producer 3/step, consumer 2/step → the queue grows without bound;
the consumer scales to 5/step at step 10 → it catches up. That backlog is the consumer lag.
-->

---

<!-- _class: tight -->

## Core concepts

| Concept | What it is | Example |
|---|---|---|
| **Event** | immutable record of something that happened | `OrderCreated { orderId, … }` |
| **Command** | instruction to do something — can be rejected | `PlaceOrder { items, … }` |
| **Broker** | stores messages and serves them to consumers | a Kafka broker (`kafka:9092`) |
| **Topic** | named, durable, ordered log | `order-events` |
| **Partition** | shard of a topic; order kept only inside it | partition 0, 1, 2 |
| **Key** | optional value that decides the partition | `orderId` |
| **Offset** | position of a message in a partition | offset 42 in partition 1 |
| **Consumer group** | consumers sharing the work of a topic | `notification-group` |

<div class="ok">

**Events are facts**: the log is append-only, never updated or deleted. That is what makes it safe to **replay**.

</div>

---

## Kafka: a log, not a queue

- Producers **append** to the end; consumers read from **any position**; messages **stay** after being read.
- A classic queue (RabbitMQ) removes a message once a consumer acknowledges it.
- A **topic** is split into ordered **partitions**; each **consumer group** keeps its own offset per partition.
- `notification-group` and `analytics-group` read the same log **independently**; a new group never affects the others.

| Retention | Config | Behaviour |
|---|---|---|
| Time | `retention.ms=604800000` | delete after 7 days (the default) |
| Size | `retention.bytes=1073741824` | oldest segments go when a **partition** passes 1 GB |
| Compact | `cleanup.policy=compact` | keep only the latest message per key |

---

## Keys, partitions and ordering

- With a **key**, `hash(key) % partitions` picks the partition → same key, same partition, **in order**.
- No key → messages spread over partitions, **no ordering** between related events.
- Order holds only **inside** a partition: the key chooses **what** must stay in order.
- Hands-on 10: `kafkaTemplate.send("order-events", order.getId().toString(), event)` → `OrderCreated`, `OrderPaid`, `OrderShipped` of one order in sequence; different orders in parallel.

<div class="warn">

**Choosing the key**: few values (e.g. `country`) → **hot partitions**; adding partitions later changes `hash(key) % partitions` and moves keys — size partitions up front.

</div>

---

## Durability: replication and `acks`

Each partition is **replicated** (typically 3): a **leader** takes the writes, **followers** copy it; the up-to-date ones form the **ISR**. If the leader dies, an in-sync follower takes over.

| `acks` | Confirmed when… | Risk |
|---|---|---|
| `0` | sent (no confirmation) | lost if the broker never got it |
| `1` | the leader wrote it | lost if the leader dies before followers copy it |
| `all` | all in-sync replicas have it (`min.insync.replicas` ≥ 2) | slowest — survives a broker loss |

- Hands-on 10: `acks: all` + `enable.idempotence: true` — the producer's own retries create no duplicates (the defaults since Kafka 3.0).
- Metadata: **KRaft** (Raft quorum) replaced ZooKeeper, removed in Kafka 4.0; Hands-on 10 runs one node as broker and controller.

---

## Pub/sub × competing consumers

<div class="cols">
<div>

### Pub/sub (fan-out)

One event → **every** group gets its own copy; a slow analytics pipeline does not slow notifications.

Email, audit log, analytics, cache invalidation.

</div>
<div>

### Competing consumers

Consumers of the **same** group split the partitions → each message processed by **one** consumer.

Order processing, payments, image resizing.

</div>
</div>

<div class="warn">

Parallelism ceiling = partitions: with 3 partitions a fourth consumer sits **idle**. A consumer joining or leaving triggers a **rebalance**.

</div>

---

## Event sourcing

Store the **full history of events**, not just the current state.

- The write model **is** the event log: `OrderCreated`, `OrderPaid`, `OrderShipped`, …
- Current state = **replay** the events from the beginning (or from a snapshot).
- Command → append to the **event store** → `202 Accepted`; a **projection** updates the read model.
- Projections can be **rebuilt at any time**: time-travel debugging, zero-downtime schema migration.

---

## CQRS

Separate the **write side** (commands, events, event store) from the **read side** (queries, projections).

- **Commands** (`POST /orders`) → command handler → event store + event bus (Kafka).
- **Queries** (`GET /orders`) → a **read model** optimised for the query.
- Often paired with event sourcing, but not required: **CDC** (Debezium reads the transaction log) can sync two databases.

<div class="warn">

**Not defaults**: events versioned forever, **eventually consistent** read models, slow rebuilds. Use them where the domain needs an audit trail or very different read and write shapes (order history, ledgers) — not for every CRUD entity.

</div>

---

## Delivery guarantees

A consumer reads, processes (e.g. sends an e-mail) and **commits its offset**. *When* it commits decides what a crash costs:

| Guarantee | How | A crash means |
|---|---|---|
| **At-most-once** | commit **before** processing | the message is **lost** |
| **At-least-once** | commit **after** processing | the message is **processed again** |
| **Exactly-once** | Kafka transactions (`read_committed`) | neither — but only Kafka → Kafka |

<p class="small">Hands-on 10: <code>enable_auto_commit=False</code> + <code>commit()</code> after processing = at-least-once. Kafka cannot "un-send" an e-mail or roll back a Postgres row.</p>

---

## Idempotent consumers

<div class="q">

The notification service sends the e-mail and **crashes before committing** offset 42. On restart it reads offset 42 again. Does the customer get two e-mails?

</div>

Not if processing twice has the **same effect** as processing once:

- **Processed-message table**: store the event ID in the same transaction as the business change; skip events already stored.
- **Natural idempotency**: `UPSERT`, "set status to PAID" instead of "add 10 to the balance".
- **Unique constraints**: the database rejects a second insert of the same `orderId`.

---

## The dual write and the outbox

Hands-on 10 saves the order in Postgres and *then* publishes to Kafka — two systems, no shared transaction:

- commit, then crash before publishing → the order exists, **nobody is notified**;
- publish, then rollback → consumers react to an order that **does not exist**.

**Transactional outbox**: `INSERT INTO orders` + `INSERT INTO outbox` in **one local transaction** (both or neither) → a relay (polling or CDC/Debezium) publishes to Kafka and marks the row as sent.

<div class="warn">

The relay can publish twice after a crash: consumers still need to be **idempotent**.

</div>

---

## Sagas

One business operation, several databases (reserve stock, charge the card): no single ACID transaction. A **saga** = local transactions, each triggered by the previous event; on failure, **compensations**.

`OrderCreated` → inventory reserves → `StockReserved` → payment fails → `PaymentFailed` → inventory **releases** → order `CANCELLED`

| Style | Coordination | Watch out |
|---|---|---|
| **Choreography** | services react to each other's events | the flow is spread, hard to follow |
| **Orchestration** | an orchestrator sends commands | one more service to build and run |

<p class="small">Sagas are not transactions: no isolation — model the states (<code>PENDING</code>, <code>CONFIRMED</code>, <code>CANCELLED</code>) and make every step and compensation idempotent.</p>

---

<!-- _class: tight -->

## Dead letter queue

A message that keeps failing must not **block the stream**: after the retries it moves to a **DLQ** (a separate topic), inspected and reprocessed manually.

```java
@RetryableTopic(backOff = @BackOff(delay = 1000, multiplier = 2))   // 3 attempts in total
@KafkaListener(topics = "order-events", groupId = "invoice-group")
public void onOrderCreated(OrderCreatedEvent event) {
    invoiceService.create(event);   // throws → retried after 1 s, then 2 s
}

@DltHandler
public void onDeadLetter(OrderCreatedEvent event) { log.error(...); }
```

<div class="warn">

Retry only failures that can succeed later (a database briefly down). Invalid JSON or an unknown product ID goes **straight to the DLQ**: retrying only delays the partition.

</div>

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
| Service health check | REST | synchronous by nature |

---

## The price, and the pitfalls

<div class="warn">

A request across **5 services and 3 topics** needs **distributed tracing** to debug. Adopt events when the coupling and latency of synchronous calls are **concrete** problems.

</div>

- **Assuming exactly-once**: duplicates *will* arrive; every consumer must be idempotent.
- **Dual writes** without an outbox lose or invent events after a crash.
- **Breaking the event schema**: only add optional fields; version (`OrderCreatedV2`) — a schema registry can enforce it.
- **Ignoring consumer lag**: monitor it per group (Kafka UI, Prometheus) and alert when it grows.
- **Commands in disguise**: `SendEmailToCustomer` couples to one consumer — publish the fact (`OrderCreated`).

---

## Takeaways

1. Use **events** when the caller does not need the answer to continue; a **synchronous request** when it does.
2. Kafka is a replicated, partitioned **log**: order holds within a partition, the **key** picks the partition, each group keeps its own offsets — different groups **fan out**, the same group **shares** the work.
3. Delivery is realistically **at-least-once**: commit after processing, make every consumer **idempotent**.
4. Never dual-write: the **transactional outbox** publishes reliably; **sagas** with compensations replace distributed transactions.
5. **Event sourcing** and **CQRS** are for specific domains, not defaults; a **DLQ** keeps poison messages from blocking a partition.
