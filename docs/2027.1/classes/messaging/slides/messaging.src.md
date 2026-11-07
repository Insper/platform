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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

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

## Two wirings of the purchase

<div class="flow">
<div class="arrow" style="flex: .4; text-align: left">Sync</div>
<div class="box">fan</div><div class="arrow">→</div>
<div class="box accent">order</div><div class="arrow">waits →</div>
<div class="box red">notification<small>800 ms today</small></div><div class="arrow">→</div>
<div class="box">search</div><div class="arrow">→</div>
<div class="box">analytics</div><div class="arrow">→ 201</div>
</div>
<div class="flow" style="align-items: stretch">
<div class="arrow" style="flex: .4; text-align: left; align-self: center">Async</div>
<div class="box" style="align-self: center">fan</div><div class="arrow" style="align-self: center">→</div>
<div class="box accent" style="align-self: center">order<small>201 after save + publish</small></div><div class="arrow" style="align-self: center">publish →</div>
<div class="box orange" style="align-self: center">Kafka<small>OrderConfirmed</small></div><div class="arrow" style="align-self: center">→</div>
<div class="group">
<div class="caption">each at its own pace</div>
<div class="box green">notification</div><div class="box green">search</div><div class="box green">analytics</div>
</div>
</div>

- Sync: the fan waits for the **sum** of the calls, and **any** failure fails the purchase.
- Async: the fan waits for one save and one publish; a slow consumer only grows **its** backlog.

<!--
The page draws both as step-by-step sequence diagrams (the two tabs of "Synchronous vs asynchronous").
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

## What goes inside an event

<div class="cols">
<div>

### Event notification

`{ type, eventId, orderId, occurredAt }`

- Small and stable.
- Every consumer **calls back** `GET /orders/o-7731`: one extra call per consumer per event, and `order` must be up.

</div>
<div>

### Event-carried state transfer

`{ …, customer, event, seats, total }`

- Consumers **never call back**: decoupled from `order`'s availability.
- Bigger payload, a schema harder to change, personal data (the e-mail) copied to every consumer.

</div>
</div>

<div class="ok">

Name events in the **past tense** (`OrderConfirmed`); `SendConfirmationEmail` is a command in disguise.

</div>

---

## Call, queue, pub/sub or log?

<div class="flow">
<div class="box accent" style="flex: 2">Does the caller need the answer to continue?</div><div class="arrow">yes →</div>
<div class="box" style="flex: 1.4">synchronous call<small>with a timeout: log in, hold seats</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .3">no ↓</div>
<div class="box accent" style="flex: 1.7">How many services must react?</div><div class="arrow">exactly one job →</div>
<div class="box green" style="flex: 1.4">queue<small>competing consumers: the PDF ticket</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .3">many ↓</div>
<div class="box accent" style="flex: 1.7">Need replay, order per key, high throughput?</div><div class="arrow">no →</div>
<div class="box green">pubsub<small>e-mail and push</small></div><div class="arrow">yes →</div>
<div class="box orange">stream · kafka<small>warehouse feed, search</small></div>
</div>

<p class="small">In a queue reading is <b>taking</b>; in a log reading is <b>looking</b>, with a bookmark per reader. The page's table "When not to go asynchronous" sorts eight BoxOffice interactions this way.</p>

---

## The life of a queued message

<div class="flow">
<div class="box">receive<small>worker 1 gets o-7731</small></div><div class="arrow">→</div>
<div class="box orange">hidden 30 s<small>visibility timeout</small></div><div class="arrow">→</div>
<div class="box red">worker 1 crashes<small>before the ack</small></div><div class="arrow">→</div>
<div class="box orange">visible again</div><div class="arrow">→</div>
<div class="box">worker 2<small>delivery 2</small></div><div class="arrow">ack →</div>
<div class="box green">deleted</div>
</div>

- The broker deletes a message only on the **ack**: no message is lost when a worker dies.
- With competing consumers there is **no order**; first-in, first-out (FIFO) queues keep it per group id.

<div class="warn">

At-least-once: a crash after the upload means the job runs twice → **idempotent** consumer (`tickets/o-7731.pdf` is a deterministic name). A visibility timeout **shorter than the job** makes every slow job run twice.

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

<p class="small">Simulator <code>queue</code>: 95 workers (ρ = 0.70) keep up; with 60 (ρ = 1.11) the backlog only grows; a 3× spike peaks at about 5,300 jobs.</p>

---

<!-- _class: tight -->

## Backpressure: what happens when the queue fills?

| Strategy | BoxOffice example | Cost |
|---|---|---|
| Buffer (bounded) | PDF queue absorbs the on-sale | delay grows |
| Scale consumers | KEDA (Kubernetes Event-driven Autoscaling) on queue length | load moves downstream |
| Reject at the edge | `429` / `503` + `Retry-After` | fast, honest error |
| Slow the producer | Kafka producer blocks (`max.block.ms`) | latency moves upstream |
| Drop / expire | stale "seats left" updates, push time to live (TTL) | data loss by design |
| Shed by priority | confirmations before marketing | separate queues |

<div class="ok">

Alert on the **age of the oldest message**, not only on depth.

</div>

---

## The flash-sale waiting room

<div class="flow">
<div class="box">2 M fans</div><div class="arrow">join →</div>
<div class="box orange">waiting room<small>Redis sorted set: position</small></div><div class="arrow">admit N/s →</div>
<div class="box accent">admission token<small>short-lived, signed</small></div><div class="arrow">→</div>
<div class="box">gateway<small>rejects calls without it</small></div><div class="arrow">→</div>
<div class="box green">inventory<small>~1,100 holds/s</small></div>
</div>

- N = measured capacity × a safety factor: `1,100 × 0.5 ≈ 500` fans/s; honest wait = position / N.
- Sold out → "**sold out**" from the edge, no database touched. Bots: challenge and per-account limits here.
- Fairness: a random position for fans who arrived early, first come first served afterwards.
- Lab 7: the score comes from `INCR` (the server decides the order), 20 fans/s by default, an *admitted* key with a 5-minute TTL, checked by `POST /orders`.

<p class="small">Playground: <code>flash-sale</code> starts <b>without</b> a waiting room — watch <code>app</code> and <code>inventory-db</code> saturate at 10:00, then build the queue.</p>

---

<!-- _class: tight -->

## Publish/subscribe

<div class="flow" style="align-items: stretch">
<div class="box accent" style="align-self: center; flex: .8">order</div><div class="arrow" style="align-self: center">OrderConfirmed →</div>
<div class="box orange" style="align-self: center">topic<small>order-events</small></div><div class="arrow" style="align-self: center">one copy each →</div>
<div class="group"><div class="caption">sub: notification</div><div class="box green">notification #1</div><div class="box green">notification #2</div></div>
<div class="group"><div class="caption">sub: search</div><div class="box green">search indexer</div></div>
<div class="group"><div class="caption">sub: analytics</div><div class="box green">analytics loader</div></div>
</div>

- Inside a subscription consumers **compete**; across subscriptions everyone sees everything.
- A loyalty-points consumer = **one new subscription**, `order` unchanged and unaware.
- **Pull**: consumers ask, natural flow control (workers). **Push**: the broker calls an HTTPS endpoint (serverless, webhooks).

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

<!-- _class: tight -->

## Consumer groups and lag

<div class="flow" style="align-items: stretch">
<div class="group" style="flex: .7"><div class="caption">order-events · 6 partitions</div>
<div class="box orange">P0 · P1</div><div class="box orange">P2 · P3</div><div class="box orange">P4 · P5</div></div>
<div class="arrow" style="align-self: center">one reader per<br>partition, per group →</div>
<div class="group"><div class="caption">group notification · 3 consumers</div>
<div class="box green">notification #1<small>P0, P1</small></div><div class="box green">notification #2<small>P2, P3</small></div><div class="box green">notification #3<small>P4, P5</small></div></div>
<div class="group" style="flex: .8"><div class="caption">group analytics</div>
<div class="box green">analytics #1<small>all 6, its own offsets</small></div></div>
</div>

- Max parallelism of a group = **number of partitions**: 8 consumers on 6 partitions → 2 idle.
- **Lag** = log-end offset − committed offset, per partition: one hot partition = hot key, stuck consumer or poison message.
- Rebalance when members join, leave or stop polling (`max.poll.interval.ms`).

<p class="small">Simulator <code>kafka</code> (lab 7's 6 partitions, 3 consumers): key by show → <code>ev-1</code> hashes to P5, which falls behind. Playground: <code>event-fanout</code>.</p>

---

## Replication and durability

| `acks` | Confirmed when… | A broker failure can… |
|---|---|---|
| `0` | sent | ❌ lose records silently |
| `1` | leader wrote it | ⚠️ lose acknowledged records |
| `all` | every in-sync replica (ISR) has it | ✅ not lose them, with min ISR ≥ 2 |

- **Replication factor (RF) 3 across availability zones (AZs) + `min.insync.replicas=2` + `acks=all`**: one broker down, writes continue; nothing acknowledged lives on one machine.
- Lab 7 runs one broker with RF 1: there `acks: all` waits for exactly one replica — the trap above.
- Metadata by **KRaft** controllers (Raft); ZooKeeper removed in Kafka 4.0.

---

## Retention, compaction and why Kafka is fast

<div class="flow">
<div class="box red">0 · ev-88<small>21:00</small></div><div class="box red">1 · ev-90<small>Jazz Night</small></div>
<div class="box">2 · ev-88<small>20:00</small></div><div class="box">3 · ev-91<small>Theater</small></div><div class="box muted">4 · ev-90<small>null (tombstone)</small></div>
<div class="arrow">compact →</div>
<div class="box green">2 · ev-88<small>20:00</small></div><div class="box green">3 · ev-91<small>Theater</small></div>
</div>

- **Delete** by time (`retention.ms`, 7 days for `order-events`: replay and the warehouse) or by size.
- **Compact** (`event-catalog`): the latest record of each key survives, with its offset; a tombstone deletes a key.
- **Tiered storage**: old segments go to object storage — months of retention, cheap.
- Fast: sequential appends, the operating system's page cache, zero-copy `sendfile`, batches compressed with `zstd`. The price: a few ms of `linger.ms`.

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

## Where a message gets lost or duplicated

<div class="flow">
<div class="box accent">order<small>producer</small></div><div class="arrow">1 · send →</div>
<div class="box orange">Kafka<small>2 · replicate</small></div><div class="arrow">3 · deliver →</div>
<div class="box">notification<small>consumer</small></div><div class="arrow">4 · e-mail →</div>
<div class="box">provider</div><div class="arrow">5 · commit the offset ↩</div>
</div>

| Hop | Failure | Effect | Defence |
|---|---|---|---|
| 1 | ack lost, producer retries | duplicate in the log | idempotent producer |
| 1 | crash before sending | **loss** (Bruno) | transactional outbox |
| 2 | leader dies with `acks=1` | **loss** of an acked record | `acks=all`, min ISR 2 |
| 3–5 | crash between e-mail and commit | duplicate (Ana, three times) | idempotent consumer |

---

## Delivery semantics

| Guarantee | Kafka consumer | Crash means |
|---|---|---|
| At-most-once | commit **before** processing | ❌ message **lost** |
| At-least-once | commit **after** processing | ⚠️ message **repeated** |
| Exactly-once | Kafka transactions — *inside Kafka only* | ✅ neither |

<div class="ok">

**Effectively-once = at-least-once + idempotent processing.** Kafka cannot un-send an e-mail.

</div>

<p class="small">Simulator <code>delivery</code>: charge → commit with a crash → 7 charges for 6 orders; commit → charge → the order is lost; the idempotency key fixes the repeat, not the loss.</p>

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
- Lab 7: `processed_events (event_id)`, but the e-mail is **sent** inside the transaction — a crash after the send repeats it.

---

## Ordering, retries and dead letters

- Order breaks with: producer retries (fixed by idempotence), different topics, thread pools, retry topics.
- Cross-service views: **version per entity**, apply only newer (`WHERE version < :v`).
- **Transient** error → **blocking** retries in place (lab 7: 0.5 s, 1 s, 2 s — the partition waits, the order holds) or **retry topics** (1 s, 4 s, 16 s — the partition flows, later events overtake).
- **Poison message** → the dead letter queue (DLQ, in Kafka a dead letter topic) after N attempts — or at once for parse errors — and an alert.

<div class="warn">

A DLQ nobody reads is a slower way to lose messages. Redrive is safe only because consumers are idempotent.

</div>

---

## The simulator: retry in place or in retry topics?

<div class="flow">
<div class="arrow" style="flex: .55; text-align: left">Blocking</div>
<div class="box red">o-1005 fails<small>for its first 2 s</small></div><div class="arrow">→</div>
<div class="box orange">waits 0.5 s, 1 s, 2 s<small>in place</small></div><div class="arrow">→</div>
<div class="box green">sent at attempt 4<small>stopped 3.5 s · lag 8 · order kept ✅</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .55; text-align: left">Retry topics</div>
<div class="box red">o-1005 fails</div><div class="arrow">→</div>
<div class="box orange">retry-0 · 1 s<small>fails again</small></div><div class="arrow">→</div>
<div class="box orange">retry-1 · 4 s</div><div class="arrow">→</div>
<div class="box red">sent<small>never stopped · Cancelled 4.1 s earlier ❌</small></div>
</div>

- **Poison** without classification: blocking reaches the DLQ after 3.5 s, retry topics after 21.2 s; **forever** never lets go — 53 records wait after 30 s.
- Classify permanent errors (lab 7: `IllegalArgumentException`): straight to the DLQ, no wait.

<!--
The simulator is on the Delivery semantics page, under "Retries and dead letter queues" (retry-topics). Same numbers as its tip.
-->

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

<div class="flow" style="align-items: stretch">
<div class="box accent" style="align-self: center; flex: .8">order<small>POST /orders</small></div><div class="arrow" style="align-self: center">one transaction →</div>
<div class="group" style="flex: .9"><div class="caption">order DB</div><div class="box">INSERT orders</div><div class="box">INSERT outbox</div></div>
<div class="arrow" style="align-self: center">relay polls →<br>SKIP LOCKED</div>
<div class="box orange" style="align-self: center">Kafka<small>key = orderId, acks=all</small></div><div class="arrow" style="align-self: center">ack →</div>
<div class="box green" style="align-self: center">mark published</div>
</div>

- **Dual write**: `COMMIT`, crash, event never published (Bruno); publish first, rollback, **phantom event**.
- A crash after the ack and before the mark **republishes**: at least once, never lost.
- Relay by polling (lab 7) or by change data capture (CDC) with Debezium, which reads the write-ahead log. Lab 7 at 200 orders/s: `POST /orders` p50 **2.7 s** (sync) → **1.8 ms** (outbox).

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

A saga is atomic, consistent and durable, but **not isolated**: show the intermediate state ("seats held — processing payment"). On a payment timeout, **reconcile** with the provider before compensating.

</div>

---

## The saga as a state machine

<div class="flow">
<div class="box">PENDING</div><div class="arrow">SeatsHeld →</div>
<div class="box">SEATS_HELD</div><div class="arrow">PaymentCaptured →<br>(the pivot)</div>
<div class="box accent">PAID</div><div class="arrow">SeatsSold →<br>retried until success</div>
<div class="box green">CONFIRMED</div>
</div>
<div class="flow">
<div class="box muted">SEATS_HELD</div>
<div class="arrow">PaymentFailed / timeout →</div>
<div class="box orange">RELEASING</div><div class="arrow">SeatsReleased →</div>
<div class="box red">CANCELLED</div>
</div>

- Before the pivot every step can be **compensated**; after it, steps are **retried**, never undone.
- The order's status *is* the saga's state: move it with conditional updates (`WHERE status = 'PENDING_PAYMENT'`).
- The fan gets `202 Accepted` and "seats held — processing payment" (a semantic lock), not a spinner.

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

## Command Query Responsibility Segregation (CQRS) and event sourcing

<div class="cols">
<div>

### CQRS

- Write model for invariants; **projections** for reads.
- "My tickets" = one indexed table fed by events.
- Cost: lag → handle **read-your-writes** (return the new state, or a version token).

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
