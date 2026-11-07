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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">System Architecture · Insper</div>

# Hands-on 7 — Async Messaging

**Outbox, Kafka, idempotent consumers, a dead-letter topic (DLT) and a waiting room for BoxOffice**

<!--
Outline: (1) why the e-mail must leave the request path; (2) Kafka in KRaft mode; (3) the
dual-write problem and the outbox; (4) idempotent consumer, retries and the DLT; (5) waiting room;
(6) what we measure, and the simulator that replays the lab.
-->

---

## Should the fan wait for the e-mail?

<div class="q">

`order` calls `notification` over HTTP before answering. A real e-mail provider takes tens to hundreds
of milliseconds and sometimes fails. At 10:00 the stadium show goes on sale. What can go wrong?

</div>

- Every order is **as slow as the e-mail provider**.
- An e-mail outage becomes an **ordering outage**.
- 2 M fans hit **every service at once**, including the slowest one.

---

## Architecture

<div class="flow">
<div class="arrow" style="flex: .5; text-align: left">Before</div>
<div class="box">fan</div><div class="arrow">→</div>
<div class="box">gateway</div><div class="arrow">→</div>
<div class="box accent">order</div><div class="arrow">POST, waits →</div>
<div class="box red">notification<small>SMTP, then 201</small></div><div class="arrow">→</div>
<div class="box">201 to the fan<small>after the e-mail</small></div>
</div>

<div class="flow">
<div class="arrow" style="flex: .5; text-align: left">After</div>
<div class="box green">waiting room</div><div class="arrow">→</div>
<div class="box accent">order<small>orders + outbox, 1 tx</small></div><div class="arrow">→</div>
<div class="box">201 to the fan<small>at the commit</small></div>
</div>

<div class="flow">
<div class="arrow" style="flex: .5; text-align: left"></div>
<div class="box green">outbox relay</div><div class="arrow">publish →</div>
<div class="box orange">order-events<small>Kafka, 6 partitions</small></div><div class="arrow">group →</div>
<div class="box accent">notification<small>dedupe, Mailpit</small></div><div class="arrow">failures →</div>
<div class="box red">order-events-dlt</div>
</div>

<!--
The page draws both architectures as step-by-step diagrams (tabs "Before" and "After").
-->

---

## Step 1 · Kafka in Compose (KRaft, Kafka Raft)

| Container | Port | Role |
|---|---|---|
| `kafka` (`apache/kafka:4.3.1`) | 9094 (host) | broker + controller, no ZooKeeper |
| `kafka-init` | — | creates `order-events` and `order-events-dlt`, 6 partitions each |
| `kafka-ui` | 8089 | topics, messages, headers, lag |
| `mailpit` | 8025 / 1025 | fake e-mail provider with an inbox |

- Two listeners: containers use `kafka:9092`, your machine `localhost:9094`.
- Auto-create **off**: the default 1 partition would cap consumers at 1.

---

## Two listeners: the advertised address wins

<div class="flow">
<div class="box accent">order (container)</div><div class="arrow">bootstrap →</div>
<div class="box">kafka:9092<small>PLAINTEXT</small></div><div class="arrow">metadata →</div>
<div class="box green">leaders at kafka:9092<small>resolves in the network</small></div>
</div>
<div class="flow">
<div class="box accent">CLI on your laptop</div><div class="arrow">bootstrap →</div>
<div class="box">localhost:9094<small>EXTERNAL</small></div><div class="arrow">metadata →</div>
<div class="box green">leaders at localhost:9094<small>resolves on the laptop</small></div>
</div>
<div class="flow">
<div class="box muted">one listener for both</div><div class="arrow">→</div>
<div class="box red">the laptop is told kafka:9092<small>connects, then times out</small></div>
</div>

- The first address only finds the broker; the client reconnects to the **advertised** one.
- That is why Kafka is the exception to "same port inside and outside".

---

## A log, not a queue

- Consuming does **not** delete: each group stores an **offset** per partition.
- **Lag** = log-end offset − committed offset → the consumer's health signal.
- Same **key** → same partition → **per-key order** (the only order Kafka promises).
- Partitions = **ceiling of consumer parallelism** in a group: 8 instances on 6 partitions → 2 idle.
- Groups can **rewind** (`--reset-offsets`) → replays → consumers must tolerate duplicates.

<!--
The tour of the page: order-1 lands twice on partition 4, order-2 on partition 3. Keep the three tour
messages: they become the poison messages of step 3.
-->

---

## Step 2 · The dual-write problem

<div class="flow">
<div class="box">database, then Kafka</div><div class="arrow">crash between →</div>
<div class="box red">order without its event<small>no e-mail, ever</small></div>
</div>
<div class="flow">
<div class="box">Kafka, then database</div><div class="arrow">insert fails →</div>
<div class="box red">a ghost order<small>e-mail for nothing</small></div>
</div>
<div class="flow">
<div class="box accent">Outbox: order + event row, 1 local tx</div><div class="arrow">crash anywhere →</div>
<div class="box green">both rows or neither<small>a relay publishes later</small></div>
</div>

- PostgreSQL cannot roll back Kafka; Kafka cannot roll back PostgreSQL.
- The **relay** publishes unpublished rows and marks them only after `acks=all`.

---

## The relay

```sql
SELECT id, aggregate_id, event_type, payload::text AS payload
FROM outbox WHERE published_at IS NULL
ORDER BY created_at LIMIT 100
FOR UPDATE SKIP LOCKED
```

- Every 200 ms: send all, wait for every ack (10 s), then `UPDATE ... published_at`.
- Kafka down → each run fails after `max.block.ms` (5 s), rolls back → **no event lost**.
- Crash after the ack → batch republished: **at-least-once**.
- `SKIP LOCKED` → several replicas relay disjoint batches.

<p class="small">Alternative: change data capture (CDC) — Debezium reads the write-ahead log (WAL): lower delay, more infrastructure.</p>

---

## Idempotent API, too

```sql
INSERT INTO orders (...) VALUES (...)
ON CONFLICT (hold_id) DO NOTHING
```

- One hold → at most one order: `hold_id` is `UNIQUE`.
- A double click or a gateway retry gets **the same order** (`200`), and **no second event**.
- Kafka stopped, order placed: `201` anyway; a test run published it **71 s later**, when Kafka was back.

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

<div class="flow">
<div class="box">record</div><div class="arrow">→</div>
<div class="box green">e-mail sent, or duplicate<small>commit, next record</small></div>
</div>
<div class="flow">
<div class="box">record</div><div class="arrow">MailSendException →</div>
<div class="box orange">retry in place<small>0.5 s, 1 s, 2 s</small></div><div class="arrow">still failing →</div>
<div class="box red">order-events-dlt<small>same partition, exception in headers</small></div>
</div>
<div class="flow">
<div class="box">record</div><div class="arrow">IllegalArgumentException, JacksonException →</div>
<div class="box red">order-events-dlt at once<small>not retryable</small></div>
</div>

- Only the failing **partition** waits, at most 0.5 + 1 + 2 = 3.5 s; the others keep flowing.
- Non-blocking alternative: `@RetryableTopic` (retry topics) — no blocking, but no ordering.

---

## Step 3 · The experiments

- **Tour messages**: the new group starts at the earliest offset → 3 × `IllegalArgumentException` → DLT, without blocking the real events.
- **Replay** (`--reset-offsets --to-earliest`): `duplicate event … ignored`, Mailpit still has **2** e-mails.
- **`NOTIFY_IDEMPOTENT=false`**: every replay sends every e-mail again.
- **Poison order** (`poison@example.com`): `201` for the fan, the record in `order-events-dlt` and in `dead_letters`.

<div class="warn">

A DLT nobody reads is a silent data loss: alert on its growth, fix the cause, replay — safe because the consumer is idempotent.

</div>

---

## Step 4 · Waiting room

<div class="q">

2 M fans press "Buy" for 60 k seats; a strongly consistent inventory cannot serve 2 M requests per second. Who gets in first?

</div>

<div class="flow">
<div class="box">2 M fans</div><div class="arrow">join →</div>
<div class="box orange">Redis sorted set<small>score = INCR sequence</small></div><div class="arrow">ZPOPMIN N, every 1 s →</div>
<div class="box green">admitted ticket<small>time to live (TTL) 5 min</small></div><div class="arrow">X-Admission-Ticket →</div>
<div class="box accent">POST /orders<small>403 without it</small></div>
</div>

- Honest estimated time of arrival (ETA), by **Little's Law**: `wait = position / rate` → 30 000 / 500 = 60 s.

---

## Waiting room pitfalls

- **One admitter**: 3 replicas × N/s = 3N/s. Single worker, leader election or a lock.
- **Gate everything expensive** (holds and orders) — in production at the edge/gateway.
- **The room must scale too**: 2 M fans polling every second = 2 M req/s → poll less, serve the page from a content delivery network (CDN).
- **Bots** join many times: rate-limit joins, challenge before joining (web application firewall, WAF).

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

## What a test run gave (A and B)

| Load | Mode | p50 | p99 | throughput |
|---|---|---|---|---|
| 50/s for 60 s | `sync` | 58 ms | 352 ms | 50/s |
| 50/s for 60 s | `outbox` | 3.3 ms | 1.7 s | 49/s |
| 200/s for 30 s | `sync` | 2.7 s | 9.3 s | ❌ 113/s |
| 200/s for 30 s | `outbox` | 1.8 ms | 95 ms | ✅ 200/s |

- `sync` holds one of the pool's 10 connections per e-mail: at most 10 / 0.055 s ≈ 180 orders/s.
- B in `sync`: at least a third of the orders fail (54 % in a test run); in `outbox`, none.

---

## Predict before you run

<div class="q">

Concurrency 1, 50 ms per e-mail, 100 orders/s for 60 s. Lag at the end? Time to drain?

</div>

* Capacity: 1 / 50 ms = **20/s** per thread.
* Backlog grows at 100 − 20 = 80/s → **≈ 4 800** messages.
* Drains at 20/s → **≈ 240 s**. With 6 threads (120/s) → lag ≈ 0. A 7th thread: idle (6 partitions).
* A test run: about 4 900 and 320 s — each e-mail costs a little more than 50 ms.

---

## Without Docker: the lab's twin

<div class="flow">
<div class="box accent">2 · Outbox<small>200 on retry · Kafka down: the row waits · relay crash: 1 event twice</small></div>
<div class="box orange">3 · Consumer<small>tour → DLT · replay: 2 e-mails stay 2 · dedupe off: 4</small></div>
<div class="box red">5 · Measure (B, C)<small>sync: 1,000 of 3,000 fail · 1 thread: lag 4,800, 240 s · 6 threads: ≤ 17</small></div>
</div>

- Steps 2, 3 and 5 embed it: same topic, partitions, threads, back-off and e-mail latency as the lab.
- Play runs a page; the buttons (`POST`, stop Kafka, stop Mailpit, reset offsets) work at any time.
- In 5, change `NOTIFY_CONCURRENCY`: 4 or 5 threads drain as slowly as 3 — thread 1 still reads two partitions.

---

## Try it in the playground

- `event-fanout`: one producer, several consumer services, each with its own copy; raise the requests per second until one consumer lags.
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
