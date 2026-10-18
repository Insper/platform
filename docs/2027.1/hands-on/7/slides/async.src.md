---
marp: true
lang: en
title: Hands-on 7 — Async Messaging
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

# Hands-on 7 — Async Messaging

**Outbox, Kafka, idempotent consumers, a DLT and a waiting room for BoxOffice**

<!--
Outline: (1) why the e-mail must leave the request path; (2) Kafka in KRaft mode; (3) the
dual-write problem and the outbox; (4) idempotent consumer; (5) retries and DLT; (6) waiting room;
(7) what we measure.
-->

---

## Should the fan wait for the e-mail?

<div class="q">

`order` calls `notification` over HTTP before answering. The e-mail provider takes 50–500 ms and
sometimes fails. At 10:00 the stadium show goes on sale. What can go wrong?

</div>

- Every order is **as slow as the e-mail provider**.
- An e-mail outage becomes an **ordering outage**.
- 2 M fans hit **every service at once**, including the slowest one.

---

## Architecture

<div class="cols">
<div>

### Before

fan → gateway → **order** → `POST /notifications` → SMTP → … → `201`

*The request ends after the e-mail.*

</div>
<div>

### After

fan → **waiting room** → **order** → `orders` + `outbox` (1 tx) → `201`

relay → Kafka `order-events` → **notification** → Mailpit

failures → `order-events-dlt`

</div>
</div>

---

## Step 1 · Kafka in Compose (KRaft)

| Container | Port | Role |
|---|---|---|
| `kafka` (`apache/kafka:4.3.1`) | 9094 (host) | broker + controller, no ZooKeeper |
| `kafka-init` | — | creates `order-events` and `order-events-dlt`, 6 partitions each |
| `kafka-ui` | 8089 | topics, messages, headers, lag |
| `mailpit` | 8025 / 1025 | fake e-mail provider with an inbox |

- Two listeners: containers use `kafka:9092`, your machine `localhost:9094`.
- Auto-create **off**: the default 1 partition would cap consumers at 1.

---

## A log, not a queue

- Consuming does **not** delete: each group stores an **offset** per partition.
- **Lag** = log-end offset − committed offset → the consumer's health signal.
- Same **key** → same partition → **per-key order** (the only order Kafka promises).
- Partitions = **ceiling of consumer parallelism** in a group.
- Groups can **rewind** (`--reset-offsets`) → replays → consumers must tolerate duplicates.

---

## Step 2 · The dual-write problem

<div class="warn">

`INSERT order; COMMIT;` then `kafka.send(...)` — a crash in between stores an order **without its
event**. Reversed, you announce an order that **does not exist**.

</div>

- PostgreSQL cannot roll back Kafka; Kafka cannot roll back PostgreSQL.
- Fix: write the event as a row of `outbox` **in the same transaction** as the order.
- A **relay** publishes unpublished rows and marks them only after `acks=all`.

---

## The relay

```sql
SELECT id, aggregate_id, event_type, payload::text AS payload
FROM outbox WHERE published_at IS NULL
ORDER BY created_at LIMIT 100
FOR UPDATE SKIP LOCKED
```

- Send all, wait for every ack (10 s), then `UPDATE ... published_at`.
- Kafka down → rollback → rows retried: **no event lost**.
- Crash after the ack → batch republished: **at-least-once**.
- `SKIP LOCKED` → several replicas relay disjoint batches.

<p class="small">Alternative: CDC (Debezium reads the WAL) — lower delay, more infrastructure.</p>

---

## Idempotent API, too

```sql
INSERT INTO orders (...) VALUES (...)
ON CONFLICT (hold_id) DO NOTHING
```

- One hold → at most one order: `hold_id` is `UNIQUE`.
- A double click or a gateway retry gets **the same order** (`200`), and **no second event**.

<div class="ok">

Idempotency is a design decision at **every** hop: API, relay, consumer.

</div>

---

## Step 3 · Idempotent consumer

1. **Claim**: `INSERT INTO processed_events (event_id) ... ON CONFLICT DO NOTHING`
2. 0 rows → duplicate → **skip**.
3. **Effect**: send the e-mail.
4. **Commit** — if the e-mail throws, the claim rolls back and the retry can try again.

<div class="warn">

E-mail sent, commit fails → a second e-mail on redelivery. External effects need the provider's
**idempotency key** (`eventId`).

</div>

---

## Retries and the dead-letter topic

- `DefaultErrorHandler` + `ExponentialBackOffWithMaxRetries(3)`: 0.5 s, 1 s, 2 s **in place**.
- Then `DeadLetterPublishingRecoverer` → `order-events-dlt`, **same partition**, exception in headers.
- **Not retryable**: `JacksonException`, `IllegalArgumentException` → DLT immediately.
- Only the failing **partition** waits; the others keep flowing.

<p class="small">Non-blocking alternative: <code>@RetryableTopic</code> (retry topics) — no blocking, but no ordering.</p>

---

## Step 4 · Waiting room

<div class="q">

2 M fans, 60 k seats, an inventory that serves a few hundred holds per second. Who gets in first?

</div>

- Redis **sorted set** per show, score = `INCR` sequence → fair FIFO.
- Every second the admitter pops **N** fans (`ZPOPMIN`) and marks them admitted (TTL 5 min).
- `POST /orders` requires an admitted `X-Admission-Ticket` while the on-sale is open.
- Honest ETA by **Little's Law**: `wait = position / rate` → 45 000 / 500 = 90 s.

---

## Waiting room pitfalls

- **One admitter**: 3 replicas × N/s = 3N/s. Single worker, leader election or a lock.
- **Gate everything expensive** (holds and orders) — in production at the edge/gateway.
- **The room must scale too**: 2 M fans polling every second = 2 M req/s → poll less, CDN for the page.
- **Bots** join many times: rate-limit joins, challenge before joining (WAF).

---

<!-- _class: tight -->

## Step 5 · Measure it

| # | Experiment | What to record |
|---|---|---|
| A | `NOTIFY_MODE` sync vs outbox | `POST /orders` p50 / p95 / p99 |
| B | stop `notification` 20 s | error rate, lag peak, drain time |
| C | 100 orders/s, concurrency 1 vs 6 | lag, drain time, e-mail delay p95 |
| D | reset offsets, idempotency off vs on | e-mails per order |
| E | waiting room, 20 fans/s, admit 10/s | admitted/s, wait p95, ETA error, bots refused |

<p class="small">k6 in open model (<code>constant-arrival-rate</code>); lag from <code>kafka-consumer-groups.sh</code>; delays from SQL.</p>

---

## Predict before you run

<div class="q">

Concurrency 1, 50 ms per e-mail, 100 orders/s for 60 s. Lag at the end? Time to drain?

</div>

* Capacity: 1 / 50 ms = **20/s** per thread.
* Backlog grows at 100 − 20 = 80/s → **≈ 4 800** messages.
* Drains at 20/s → **≈ 240 s**. With 6 threads (120/s) → lag ≈ 0. A 7th thread: idle (6 partitions).

---

## Try it in the playground

- `event-fanout`: one producer, several consumer services, each with its own copy; raise RPS until one consumer lags.
- `async-queue` with the `spike` profile: the backlog absorbs the spike while workers stay at a constant rate.

<div class="ok">

Form a hypothesis in the simulator, then check it with k6 on your own services.

</div>

---

## Takeaways

1. Take slow, fallible work **out of the request path**: the fan's request ends at the commit.
2. **Outbox**: order + event in one local transaction; a relay publishes at-least-once.
3. Kafka orders **per partition**; key by aggregate id; partitions cap consumer parallelism.
4. **Idempotent consumers**: claim the `eventId` in the same transaction as the effect.
5. Classify errors: transient → **retry with backoff**; permanent → **DLT**, then fix and replay.
6. A **waiting room** turns a spike into a constant rate with an honest ETA (Little's Law).
