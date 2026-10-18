---
marp: true
lang: en
title: Messaging and Event-Driven Architecture
description: System Architecture · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">System Architecture · Insper</div>

# Messaging and Event-Driven Architecture

**Send a message, move on — and handle what that implies**

<!--
Outline: (1) sync vs async and what a broker buys; (2) queues, backpressure and the waiting room;
(3) pub/sub; (4) Kafka: log, partitions, keys, groups, replication, sizing; (5) delivery
semantics, idempotency, DLQ, schemas; (6) outbox, CDC, sagas, CQRS, event sourcing.
-->

---

## 10:00 — two million fans, sixty thousand seats

<div class="q">

The purchase holds seats, charges the card, **sends the e-mail**, updates search and analytics — all in one request.
The e-mail provider slows from 80 ms to 800 ms. What happens to the "Buy" button?

</div>

* Every purchase gets **720 ms slower**; `order` runs out of threads.
* Fans about to pay see a spinner, then an **error**.
* Nothing was broken: every step simply had to **finish before anyone got an answer**.

<!--
Let the class answer. The point: the e-mail is not needed to answer the fan, yet it sits in the
critical path. That is the whole motivation for messaging.
-->

---

## Synchronous chain vs asynchronous events

| | Synchronous chain | Asynchronous events |
|---|---|---|
| Latency for the fan | sum of every call | save + publish one message |
| Availability of "Buy" | `0.9995 × 0.999³ ≈ 99.65%` | `0.9995 × 0.9995 ≈ 99.90%` |
| Coupling | `order` knows every consumer | `order` knows one topic + schema |
| A consumer fails | the purchase fails | its backlog grows |
| Consistency | done when the fan sees `201` | consumers catch up (eventual) |

<div class="ok">

**If the caller needs the answer to continue, call. If it only needs the work done eventually, send a message.**

</div>

<!--
Seat hold stays synchronous: the fan needs the answer now and it must be strongly consistent.
-->

---

## What a broker buys — and what it costs

<div class="cols">
<div>

### Buys

- **Temporal decoupling** — consumer may be down
- **Load leveling** — a spike becomes backlog
- **Fan-out** — new consumers, producer unchanged
- **Independent scaling** and failure isolation

</div>
<div>

### Costs

- **Eventual consistency** — "120 seats left" for a while
- **Duplicates and reordering** — consumers must be idempotent
- **Harder debugging** — tracing and lag metrics
- **One more critical system** to run

</div>
</div>

---

## Load leveling in numbers

Spike of **6,000 req/s for 3 min**, workers drain **2,000 req/s**.

- Backlog grows at `λ − μ = 4,000/s` → `4,000 × 180 = 720,000` messages.
- Last fan waits `backlog / μ = 720,000 / 2,000 = 360 s` (Little's Law).
- Double the workers → half the peak **and** a much faster drain.

<div class="warn">

A queue absorbs **spikes**, not a permanent shortage: if average arrivals exceed capacity, the backlog grows forever.

</div>

<p class="small">Playground: <code>async-queue</code> with the spike profile — watch queue depth and consumer lag.</p>

---

## The messaging palette

| Component | Shape | Who gets a message | After reading |
|---|---|---|---|
| `queue` | point-to-point | **one** consumer of the pool | deleted |
| `pubsub` | fan-out | **every** subscription | deleted per subscription |
| `stream` | partitioned log (managed) | every consumer group | **kept** until retention |
| `kafka` | partitioned, replicated log | every consumer group | **kept** (or compacted) |

- **Command** (`GenerateTicketPdf`) — do something; one receiver.
- **Event** (`OrderConfirmed`) — a fact, past tense; anyone may react.

<!--
Queue: reading is taking. Log: reading is looking, with a bookmark per reader.
-->

---

## The life of a queued message

1. **Receive** — the broker hides the message (visibility timeout / unacked).
2. **Process** — render the PDF, upload `tickets/o-7731.pdf`.
3. **Ack** — only now is it deleted.
4. No ack in time → visible again → **another worker** gets it.

<div class="warn">

At-least-once: a crash after the upload means the job runs twice → **idempotent** consumer. A visibility timeout **shorter than the job** makes every slow job run twice.

</div>

---

## Sizing the worker pool

> busy workers = λ × S (Little's Law)

- ~30,000 orders confirmed in 3 min → `λ ≈ 167/s`; PDF takes `S = 0.4 s`.
- Real time: `167 × 0.4 ≈ 67` busy → ~95 workers at 70% utilization.
- 20 workers (50/s): backlog ≈ 21,000, drains in ~7 min after the sale.

<div class="ok">

Async work is sized against a **delay objective** ("tickets by e-mail within 15 min"), not a request latency.

</div>

---

<!-- _class: tight -->

## Backpressure: what happens when the queue fills?

| Strategy | BoxOffice example | Cost |
|---|---|---|
| Buffer (bounded) | PDF queue absorbs the on-sale | delay grows |
| Scale consumers | KEDA on queue length | load moves downstream |
| Reject at the edge | `429` / `503` + `Retry-After` | fast, honest error |
| Slow the producer | Kafka producer blocks (`max.block.ms`) | latency moves upstream |
| Drop / expire | stale "seats left" updates, push TTL | data loss by design |
| Shed by priority | confirmations before marketing | separate queues |

<div class="ok">

Alert on the **age of the oldest message**, not only on depth.

</div>

---

## The flash-sale waiting room

1. Fans get a **position** (Redis sorted set: `ZADD`, `ZRANK`).
2. An admission job lets out **N fans/s** — measured `inventory` capacity × safety factor.
3. Admitted fans get a short-lived **signed token**; the gateway requires it.
4. Inventory at zero → "**sold out**" from the edge, no database touched.

- Fairness: random position for early arrivals, FIFO afterwards.
- Bots: challenge and per-account limits at the waiting room.

<p class="small">Playground: <code>flash-sale</code> — remove the queue and watch SQL saturate.</p>

---

## Publish/subscribe

- The producer publishes to a **topic**; each **subscription** gets its own copy.
- Inside a subscription consumers compete; across subscriptions everyone sees everything.
- Adding a loyalty-points consumer = **one new subscription**, `order` unchanged.

| Pull | Push |
|---|---|
| consumers ask; natural flow control | broker calls an HTTPS endpoint |
| workers, high throughput | serverless, webhooks |

<div class="warn">

Redis Pub/Sub and core NATS are **ephemeral**: disconnected subscribers miss messages. Fine for "typing…", not for orders.

</div>

---

## The log: reading does not delete

- Append-only, ordered records; each gets an **offset**.
- Each reader keeps its own position → **many independent readers**.
- **Replay**: move the offset back (re-index after a bug); start a new reader from 0.
- A **topic** = N **partitions**, each an independent log on a different broker.
- Order is guaranteed **only inside a partition**.

<!--
The three requests from the hook: warehouse loader (history), search fix (replay), fraud (order per
order). A queue can do none of them.
-->

---

## Keys decide the partition

> partition = murmur2(key) mod N

- Same key → same partition → **in order**. Key by `orderId`.
- Key by show during the stadium on-sale → **one partition gets ~60%** of the traffic.
- Choose the **finest key that preserves the ordering you need**.

<div class="warn">

Changing N moves keys (`hash mod N` changes) — size partitions with headroom up front.

</div>

---

## Consumer groups and lag

- Each partition → **exactly one** consumer per group; different groups = fan-out.
- Max parallelism of a group = **number of partitions** (12 consumers, 8 partitions → 4 idle).
- Rebalance when members join/leave or stop polling (`max.poll.interval.ms`).
- **Consumer lag** = log-end offset − committed offset: *the* consumer health metric.

<p class="small">Lag concentrated in one partition = hot key, stuck consumer or poison message — not a capacity problem. Playground: <code>event-fanout</code>.</p>

---

## Replication and durability

| `acks` | Confirmed when… | A broker failure can… |
|---|---|---|
| `0` | sent | lose records silently |
| `1` | leader wrote it | lose acknowledged records |
| `all` | every in-sync replica has it | not lose them, with min ISR ≥ 2 |

- **RF 3 across AZs + `min.insync.replicas=2` + `acks=all`**: one broker down, writes continue; nothing acknowledged lives on one machine.
- Metadata by **KRaft** controllers (Raft); ZooKeeper removed in Kafka 4.0.

---

## Sizing partitions

> N ≥ max(T / p, T / c), then add headroom

- Peak: 30,000 orders × 10 events / 180 s ≈ **1,700 events/s** — trivial for producers.
- `notification`: 50 ms per e-mail → `c = 20/s` per partition.
- `OrderConfirmed` ≈ 167/s → `N ≥ 167 / 20 ≈ 9` → create **24**.

<div class="ok">

The **consumer** is usually the bottleneck. Alternatives to more partitions: batching, per-key concurrency.

</div>

---

## Delivery semantics

| Guarantee | Kafka consumer | Crash means |
|---|---|---|
| At-most-once | commit **before** processing | message **lost** |
| At-least-once | commit **after** processing | message **repeated** |
| Exactly-once | Kafka transactions — *inside Kafka only* | neither |

<div class="ok">

**Effectively-once = at-least-once + idempotent processing.** Kafka cannot un-send an e-mail.

</div>

<!--
Ana's three e-mails: crash between send and commit, twice. Bruno's missing e-mail: crash between DB
commit and publish (producer side) — fixed by the outbox.
-->

---

## The idempotent consumer

```java
@KafkaListener(topics = "order-events", groupId = "notification")
@Transactional
public void on(OrderConfirmed event) {
    int inserted = jdbc.update("""
        INSERT INTO processed_events (consumer, event_id)
        VALUES ('notification', ?) ON CONFLICT DO NOTHING
        """, event.eventId());
    if (inserted == 0) return;       // duplicate: already handled
    emails.schedule(event);          // same transaction
}
```

- Dedup row and business change **in one transaction**; offset committed after.
- External calls carry an **idempotency key**; the event id is created **once**, by the producer.

---

## Ordering, retries and dead letters

- Order breaks with: producer retries (fixed by idempotence), different topics, thread pools, retry topics.
- Cross-service views: **version per entity**, apply only newer (`WHERE version < :v`).
- **Transient** error → retry with backoff (1 s, 4 s, 16 s).
- **Poison message** → after N attempts, the **dead letter topic** — and an alert.

<div class="warn">

A DLQ nobody reads is a slower way to lose messages. Redrive is safe only because consumers are idempotent.

</div>

---

## Schema evolution

| Compatibility | Safe changes | Deploy first |
|---|---|---|
| Backward | delete fields; add fields **with defaults** | consumers |
| Forward | add fields; delete fields with defaults | producers |
| Full | add/delete optional fields with defaults | any order |

- Never: rename, change type, change meaning (reais → cents).
- Avro/Protobuf + **schema registry**; CloudEvents envelope; breaking change → `order-events.v2`.

---

## Dual write → transactional outbox

<div class="cols">
<div>

### Dual write

`COMMIT` the order → crash → event **never published** (Bruno).
Publish first → rollback → **phantom event**.

</div>
<div>

### Outbox

`INSERT` the event into `outbox` **in the same transaction**.
A relay (polling with `SKIP LOCKED`, or **Debezium CDC**) publishes it at least once.

</div>
</div>

<p class="small">CDC also keeps search, cache and warehouse in sync from the catalog DB — but raw CDC leaks your table schema; use designed events for other teams.</p>

---

<!-- _class: tight -->

## The purchase saga

| Step | Service | Local transaction | Compensation |
|---|---|---|---|
| 1 | `order` | create order `PENDING` | cancel |
| 2 | `inventory` | hold seats (10 min) | release |
| 3 | `payment` | charge card (key = order id) — **pivot** | refund |
| 4 | `inventory` | mark seats `SOLD` | — retried |
| 5 | `order` | `CONFIRMED`, publish `OrderConfirmed` | — retried |

<div class="warn">

A saga is **ACD without I**: show the intermediate state ("seats held — processing payment"). On a payment timeout, **reconcile** with the provider before compensating.

</div>

---

## Choreography or orchestration?

| | Choreography | Orchestration |
|---|---|---|
| Coordination | services react to events | orchestrator sends commands |
| Flow visibility | spread across services | one state machine |
| Risk | event spaghetti | a "god" orchestrator |
| Good for | 2–3 simple steps | 4+ steps, timers, branches |

<p class="small">Durable execution engines — Temporal, AWS Step Functions, Azure Durable Functions, Camunda — persist saga state, timers and retries.</p>

---

## CQRS and event sourcing

<div class="cols">
<div>

### CQRS

- Write model for invariants; **projections** for reads.
- "My tickets" = one indexed table fed by events.
- Cost: lag → handle **read-your-writes**.

</div>
<div>

### Event sourcing

- The **events** are the source of truth; state = replay.
- Audit, time travel, new read models from history.
- Cost: events are a contract **forever**.

</div>
</div>

<div class="ok">

Use them where requirements ask (payment ledger, very different read shapes) — not by default.

</div>

---

<!-- _class: tight -->

## The messaging concept map

| Component | Question it answers | Key concepts |
|---|---|---|
| `app` (producer) | call and wait, or send? | sync vs async, eventual consistency |
| `queue` | who does this *job*, at what rate? | competing consumers, ack, backpressure, waiting room |
| `pubsub` | how does *every* service get a copy? | subscriptions, push/pull, filters |
| `stream` · `kafka` | who needs history, replay, order per key? | partitions, keys, groups, lag, RF 3 |
| `worker` + consumers | what if it arrives twice or breaks? | at-least-once, idempotency, DLQ, schemas |
| `sql` + `kafka` | change data *and* publish, across services? | outbox, CDC, sagas, CQRS, event sourcing |

<p class="small">The producer only knows a topic and a schema; every consumer pays for that freedom with <b>idempotency</b> and <b>lag monitoring</b>.</p>

---

## Takeaways

1. Call when you need the answer; **message** when the work can happen later.
2. A queue turns a spike into **backlog**: size workers with Little's Law and a delay objective.
3. Every queue needs **backpressure** and an alert on the **age** of the oldest message.
4. Kafka: **key** = ordering + balance; **partitions** = max parallelism; RF 3, `acks=all`, min ISR 2.
5. Delivery is **at-least-once**: idempotent consumers, DLQ, compatible schemas.
6. **Outbox** for publishing, **sagas** with compensations across services, CQRS/ES only when needed.
