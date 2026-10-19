The morning after a big on-sale, two support tickets arrive. Ana received **three** identical confirmation e-mails. Bruno received **none**, although his order is confirmed and his tickets are in the app. Both problems have the same root: messages cross several machines and networks, any of them can fail between two steps, and each failure either **loses** a message or **repeats** it. This page is about deciding which of the two you can tolerate, and about writing consumers for which a repeat does no harm.

---

## Where messages get lost or duplicated

Follow one `OrderConfirmed` from `order` to `notification`. It crosses three hops, and each hop has its own failure:

``` mermaid-sim
flowchart LR
    O["order<br/>(producer)"] -->|"1 · send"| B[("Kafka<br/>broker")]
    B -->|"2 · replicate"| R[("replicas")]
    B -->|"3 · deliver"| N["notification<br/>(consumer)"]
    N -->|"4 · side effect"| E["e-mail provider"]
    N -->|"5 · commit offset"| B
```

| Hop | What can go wrong | Effect | Defence |
|---|---|---|---|
| 1 · producer → broker | The broker wrote the record but the ack was lost; the producer retries | **Duplicate** in the log | Idempotent producer |
| 1 · producer → broker | The producer crashed before sending (or gave up) | **Loss** | Transactional outbox ([Patterns](../patterns/index.md#transactional-outbox)) |
| 2 · broker | The leader died before followers copied the record (`acks=1`) | **Loss** of an acknowledged record | `acks=all`, `min.insync.replicas=2` ([Kafka](../kafka/index.md#replication-and-durability)) |
| 3–5 · consumer | Crash between the side effect (4) and the commit (5) | **Duplicate** processing | Idempotent consumer |
| 3–5 · consumer | Commit (5) before the side effect (4), then crash | **Loss** | Commit after processing |

Ana's three e-mails are hop 3–5: `notification` sent the e-mail, then was killed during a deploy before committing, twice. Bruno's missing e-mail is hop 1: `order` saved his order and crashed before publishing.

---

## The three delivery guarantees

A **delivery guarantee** says how many times each message is *processed* in the presence of failures[^1]:

| Guarantee | Meaning | How (Kafka consumer) | A crash means | Use when |
|---|---|---|---|---|
| **At-most-once** | 0 or 1 time | commit the offset **before** processing | the message may be **lost** | losing some is acceptable: metrics samples, "user is typing" |
| **At-least-once** | 1 or more times | commit the offset **after** processing | the message is **processed again** | almost always — with idempotent consumers |
| **Exactly-once** | exactly 1 time (in effect) | at-least-once + deduplication, or Kafka transactions within Kafka | neither | money, inventory, anything counted |

=== "At-most-once"

    ``` mermaid-sim
    sequenceDiagram
        participant K as Kafka
        participant N as notification
        participant M as e-mail provider
        K->>N: OrderConfirmed o-7731 (offset 42)
        N->>K: commit offset 43
        Note over N: crashes before sending
        N->>K: (restart) fetch from 43
        Note over M: Bruno never gets the e-mail
    ```

=== "At-least-once"

    ``` mermaid-sim
    sequenceDiagram
        participant K as Kafka
        participant N as notification
        participant M as e-mail provider
        K->>N: OrderConfirmed o-7731 (offset 42)
        N->>M: send e-mail
        Note over N: crashes before commit
        N->>K: (restart) fetch from 42
        K->>N: OrderConfirmed o-7731 (offset 42) again
        N->>M: send e-mail (Ana's duplicate)
        N->>K: commit offset 43
    ```

### Exactly-once, honestly

"Exactly-once delivery" in the strict sense is impossible over an unreliable network: the receiver can never be sure the sender saw its acknowledgement (the Two Generals problem; see [Distributed systems](../../distributed/index.md)). What systems actually offer is **exactly-once *processing* within a boundary**:

- **Idempotent producer** (`enable.idempotence=true`, default since Kafka 3.0). The broker gives each producer an id and tracks a sequence number per partition; a retried batch with a sequence it has already written is discarded. Removes hop-1 duplicates.
- **Kafka transactions**[^2]. A producer can write to several partitions *and* commit consumer offsets atomically. Consumers with `isolation.level=read_committed` only see committed transactions. This gives exactly-once for **read from Kafka → process → write to Kafka** pipelines (Kafka Streams: `processing.guarantee=exactly_once_v2`).
- **The boundary.** Kafka transactions cannot un-send an e-mail, un-charge a card or roll back a row in PostgreSQL. As soon as a side effect leaves Kafka, you are back to at-least-once.

So the practical recipe, used almost everywhere, is:

> **Effectively-once = at-least-once delivery + idempotent processing.**

---

## Idempotent consumers { #idempotent-consumers }

An operation is **idempotent** if doing it twice has the same effect as doing it once[^3]. An idempotent consumer makes duplicate deliveries harmless. There are three families of techniques:

| Technique | How it works | BoxOffice example |
|---|---|---|
| **Natural idempotency** | Express the change as "set to" instead of "add" | `UPDATE seats SET status = 'SOLD' WHERE id = 'B-12'` (instead of `sold_count = sold_count + 1`) |
| **Deduplication table** | Record each processed message id in the same transaction as the business change; skip ids already recorded | `processed_events (consumer, event_id)` in `notification`'s database |
| **Unique constraint / conditional write** | Let the database reject the second effect | `UNIQUE (order_id, kind)` on the e-mails table; `INSERT … ON CONFLICT DO NOTHING` |

The deduplication table is the general solution. It requires every message to carry a unique **event id** (a UUID generated once, by the producer, when the event is created — not on each retry):

```sql
CREATE TABLE processed_events (
    consumer      TEXT        NOT NULL,
    event_id      UUID        NOT NULL,
    processed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (consumer, event_id)
);
```

```java
@Component
@RequiredArgsConstructor
public class OrderConfirmedListener {

    private final JdbcTemplate jdbc;
    private final ConfirmationEmails emails;

    @KafkaListener(topics = "order-events", groupId = "notification")
    @Transactional   // dedup row and business change commit together, or not at all
    public void on(OrderConfirmed event) {
        int inserted = jdbc.update("""
            INSERT INTO processed_events (consumer, event_id)
            VALUES ('notification', ?)
            ON CONFLICT DO NOTHING
            """, event.eventId());
        if (inserted == 0) {
            return;                     // duplicate delivery: already handled
        }
        emails.schedule(event);         // INSERT INTO outgoing_emails ... (same transaction)
    }
}
```

Two details make this correct:

1. **Same transaction.** The dedup row and the business change commit together. If the service crashes before the commit, neither exists and the redelivered message is processed normally; after the commit, the redelivery is skipped. The offset is committed after the transaction.
2. **External side effects are scheduled, not performed, inside the transaction.** `emails.schedule` only inserts a row into `outgoing_emails` (with `UNIQUE (order_id, kind)`). A separate sender reads that table and calls the e-mail provider passing the row id as an **idempotency key**, so a retry of the call does not send twice. Providers of e-mail, SMS and payments commonly accept such keys (see [Integrations](../../compute/integrations/index.md)).

Keep the dedup table bounded: delete rows older than the topic retention plus a margin (a redelivery older than the retention cannot happen).

---

## Ordering { #ordering }

Kafka guarantees order **per partition**, so per key. Several things can still put events out of order:

- **Producer retries.** If batch 1 fails and batch 2 succeeds, the retry of batch 1 lands after batch 2. The idempotent producer prevents this (it keeps order with up to 5 in-flight requests per connection).
- **Different keys or topics.** `SeatsHeld` on `inventory-events` and `OrderCancelled` on `order-events` have no relative order at all.
- **Parallel processing inside a consumer.** A thread pool processes records of the same key concurrently.
- **Retries in the consumer.** Moving a failed record to a retry topic lets later records of the same key overtake it (next section).

When order matters and cannot be guaranteed by the transport, make the **consumer** tolerant: carry a **version** (or sequence number) from the source of truth in each event, and ignore anything older than what you already applied:

```sql
-- search keeps "seats left" per event; inventory stamps each change with a version
UPDATE event_availability
   SET seats_left = :seatsLeft, version = :version
 WHERE event_id = :eventId
   AND version < :version;     -- a late, older update changes nothing
```

This makes the update idempotent *and* order-insensitive: applying versions 7, 9, 8 leaves version 9.

??? question "Think first: is ordering by `orderId` enough for the search index?"

    Not if the events come from different services. `inventory` publishes `SeatsHeld` and `SeatsReleased` keyed by seat or event, `order` publishes `OrderConfirmed` keyed by order. The search index sees them in an arbitrary interleaving. The fix is not a global order (which would kill parallelism) but a **version per entity** produced by the service that owns it: the availability of event `ev-88` is versioned by `inventory`, and search applies only newer versions.

---

## Retries and dead letter queues { #dlq }

A consumer will meet messages it cannot process. Two very different reasons:

- **Transient failures**: the database is restarting, the e-mail provider answers `503`. Retrying later will work.
- **Permanent failures**: the payload is invalid JSON, it references an event id that does not exist, a bug throws on a specific field. Retrying will fail forever. Such a message is a **poison message**.

A poison message at the head of a partition blocks everything behind it: the consumer retries it forever and lag grows for every other order in that partition. The solution is a **dead letter queue** (DLQ, in Kafka usually a *dead letter topic*, DLT): after a bounded number of attempts, the message is moved aside, with the error, and the consumer moves on.

``` mermaid-sim
stateDiagram-v2
    [*] --> Delivered
    Delivered --> Processed : success
    Delivered --> RetryTopic : transient error (attempt < max)
    RetryTopic --> Delivered : after backoff (1 s, 4 s, 16 s)
    Delivered --> DeadLetter : permanent error, or max attempts reached
    DeadLetter --> Delivered : fixed and redriven by an operator
    Processed --> [*]
```

With Spring Kafka, **non-blocking retries** are declarative: failed records go to retry topics with increasing delays, while the main topic keeps flowing.

```java
@RetryableTopic(
    attempts = "4",                                      // 1 try + 3 retries
    backOff = @BackOff(delay = 1000, multiplier = 4.0),  // 1 s, 4 s, 16 s
    exclude = { InvalidEventException.class },           // permanent: straight to the DLT
    dltTopicSuffix = "-dlt")
@KafkaListener(topics = "order-events", groupId = "notification")
public void on(OrderConfirmed event) {
    confirmations.send(event);
}

@DltHandler
public void onDeadLetter(OrderConfirmed event,
                         @Header(KafkaHeaders.DLT_EXCEPTION_MESSAGE) String error) {
    log.error("order {} moved to order-events-dlt: {}", event.orderId(), error);
}
```

Operating a DLQ:

- **Alert on it.** A DLQ with messages is an incident in slow motion: each message is a customer without an e-mail or an order not in the warehouse. Page or ticket when it is non-empty or growing.
- **Keep context.** Store the original topic, partition, offset, exception and attempt count as headers (Spring does this).
- **Redrive.** After fixing the bug, replay the DLQ into the main topic. This is only safe because consumers are idempotent.
- **Mind the order.** Non-blocking retries let later events of the same order overtake a retried one. If per-key order is essential (an `OrderCancelled` must not be applied before its `OrderConfirmed`), use **blocking** retries for transient errors (retry in place, with backoff, pausing the partition) or version-guarded consumers.

### Backpressure in the consumer

A Kafka consumer *pulls*, so it is never flooded by the broker — but it can flood what it calls. The `notification` service must not exceed the e-mail provider's rate limit just because a backlog of 100,000 messages is waiting. Control the pace with `max.poll.records` and a client-side rate limiter, **pause** partitions while a downstream circuit breaker is open (see [Resilience patterns](../../reliability/patterns/index.md)), and let lag grow: a backlog that drains at the provider's pace is better than a ban from the provider.

---

## Schema evolution { #schema-evolution }

Events outlive the code that produced them: a topic with 7 days of retention contains messages written by last week's version of `order`, and the consumers that read them may be months older or newer. You cannot deploy producers and consumers atomically, so **every schema change must be compatible** with the versions still running[^4].

| Compatibility | Guarantees | Safe changes | Deploy order |
|---|---|---|---|
| **Backward** | new consumers can read data written with the old schema | delete fields; add fields **with defaults** | consumers first |
| **Forward** | old consumers can read data written with the new schema | add fields; delete fields that had defaults | producers first |
| **Full** | both | add or delete optional fields with defaults | any order |
| **None** | nothing | anything — breaks consumers | new topic |

Never compatible: renaming a field, changing its type (`total` from number to string), changing its meaning (`total` from reais to cents), reusing a Protobuf field number.

!!! example "BoxOffice: adding currency to OrderConfirmed"

    BoxOffice starts selling in other countries and needs the currency in `OrderConfirmed`. Version 1 had only the total; version 2 adds `currency` with a default and an optional `couponCode`:

    ```json
    {
      "type": "record", "name": "OrderConfirmed", "namespace": "boxoffice.events",
      "fields": [
        { "name": "eventId",    "type": "string" },
        { "name": "orderId",    "type": "string" },
        { "name": "totalCents", "type": "long" },
        { "name": "currency",   "type": "string", "default": "BRL" },
        { "name": "couponCode", "type": ["null", "string"], "default": null }
      ]
    }
    ```

    A consumer on version 2 reading an old record gets `currency = "BRL"` and no coupon (backward compatible); a consumer still on version 1 ignores the new fields (forward compatible). The schema registry rejects a version 3 that renames `totalCents`.

The tools:

- **Serialization formats with schemas**: Avro, Protobuf or JSON Schema. Plain JSON without a schema "works" until the first silent break.
- **A schema registry** (Confluent Schema Registry, Apicurio, AWS Glue Schema Registry) stores every version, checks compatibility when a producer registers a new one, and lets messages carry a small schema id instead of the full schema.
- **An envelope** with standard metadata. The CNCF **CloudEvents** specification defines common attributes so tools can route and trace events without parsing the payload:

```json
{
  "specversion": "1.0",
  "id": "e-9f2c",
  "source": "/boxoffice/order",
  "type": "com.boxoffice.order.confirmed.v2",
  "subject": "o-7731",
  "time": "2027-03-14T10:00:07Z",
  "datacontenttype": "application/json",
  "data": { "orderId": "o-7731", "totalCents": 78000, "currency": "BRL" }
}
```

For a truly **breaking** change, publish the new version to a new topic (`order-events.v2`), have the producer write both for a transition period, migrate consumers one by one, then retire the old topic.

---

## Putting it together

| Concern | BoxOffice decision |
|---|---|
| Producer duplicates | Idempotent producer (`enable.idempotence=true`, `acks=all`) |
| Producer losses (crash after DB commit) | Transactional outbox |
| Broker losses | RF 3, `min.insync.replicas=2`, no unclean leader election |
| Consumer guarantee | At-least-once: commit after processing |
| Duplicates in consumers | `processed_events` table in the same transaction; idempotency keys towards external providers |
| Ordering | Key by `orderId`; version-guarded updates for cross-service views |
| Poison messages | 3 retries with backoff, then `order-events-dlt`, alert when non-empty |
| Schema changes | Avro + schema registry, full compatibility, new topic only for breaking changes |

!!! tip "In the interview"
    Never claim "Kafka gives exactly-once" and stop there — interviewers use it to test depth. Say: "delivery is at-least-once; the consumer is idempotent by recording the event id in the same transaction as its write; calls to the e-mail provider carry an idempotency key". Then mention where the message could be lost on the producer side and how the outbox closes it. If the problem involves money (payments, wallets, ticket inventory), lead with idempotency before anything else.

!!! warning "Common pitfalls"

    - **Generating the event id on each send.** A retry with a new id defeats deduplication. The id belongs to the event, created once.
    - **Dedup check and business change in different transactions** — a crash between them loses or duplicates.
    - **Auto-commit** (`enable.auto.commit=true`) commits on a timer, regardless of whether processing finished: it can give at-most-once *and* duplicates.
    - **Infinite retries** of a poison message: the partition stalls and lag grows for everybody.
    - **A DLQ nobody reads.** It is just a slower way to lose messages.
    - **Changing an event field's type or meaning** without a new version: consumers you do not even know about break, or worse, compute wrong values silently.

## How it connects { #how-it-connects }

``` mermaid
flowchart LR
    H1["hop 1: producer → broker"] --> IP["idempotent producer"]
    H1 --> OB["transactional outbox<br/>→ Patterns"]
    H2["hop 2: broker"] --> DUR["acks=all, min ISR 2<br/>→ Kafka"]
    H3["hop 3: broker → consumer"] --> ALO["at-least-once:<br/>commit after processing"]
    TG["Two Generals: no exactly-once<br/>delivery → class 3"] --> EO
    ALO --> IDEM["idempotent consumer<br/>dedup table, unique keys"]
    IDEM --> EO["effectively-once"]
    ALO --> RETRY["retries with backoff<br/>→ Reliability"]
    RETRY --> DLQ["dead letter queue<br/>alert, redrive"]
    VER["version-guarded updates"] --> ORD["ordering across keys"]
    REG["schema registry<br/>compatibility rules"] --> EVO["schema evolution"]
```

**Palette components:** [`queue`](../../../reference/components/messaging/index.md#queue) · [`kafka`](../../../reference/components/messaging/index.md#kafka) · [`worker`](../../../reference/components/compute/index.md#worker) · [`notifications`](../../../reference/components/compute/index.md#notifications) · [`sql`](../../../reference/components/storage/index.md#sql) (`processed_events` in the same transaction) · [`search`](../../../reference/components/compute/index.md#search) (version-guarded "seats left") · [`email`](../../../reference/components/external/index.md#email) (an external side effect: back to at-least-once) · [`alerting`](../../../reference/components/observability/index.md#alerting) (a non-empty DLQ). **Scenarios:** `notification-system`, `payment-system`, `retry-storm`. **Continues in:** [Distributed systems — idempotency](../../distributed/index.md#idempotency), [Reliability — retry with backoff and jitter](../../reliability/patterns/index.md#retry-with-backoff-and-jitter), [Compute — integrations](../../compute/integrations/index.md) (idempotency keys to providers), [Observability — alerting](../../observability/alerting/index.md), [Hands-on 7 — idempotent consumer](../../../hands-on/7/consumer/index.md), [Exercise — event-driven](../../../exercises/event-driven/index.md).

---

[^1]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2nd ed. O'Reilly. Chapter on stream processing: fault tolerance, idempotence and exactly-once.
[^2]: [KIP-98 — Exactly Once Delivery and Transactional Messaging](https://cwiki.apache.org/confluence/display/KAFKA/KIP-98+-+Exactly+Once+Delivery+and+Transactional+Messaging){target="_blank"}. Apache Kafka, 2017.
[^3]: HELLAND, P. [Idempotence Is Not a Medical Condition](https://queue.acm.org/detail.cfm?id=2187821){target="_blank"}. *ACM Queue*, v. 10, n. 4, 2012.
[^4]: [Confluent Schema Registry — Schema Evolution and Compatibility](https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html){target="_blank"}; [CloudEvents specification](https://cloudevents.io){target="_blank"}, CNCF.
