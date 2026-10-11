
# Event-Driven Architecture

Synchronous REST works well when the caller needs an immediate answer. But when an order is placed, the system might need to notify 5 downstream services — email, inventory, fraud detection, shipping, analytics. Calling them all synchronously before returning to the user creates a latency cliff and a coupling explosion. Event-driven architecture solves this with a fundamentally different contract: publish an event, and let interested parties react asynchronously.

!!! abstract "Learning objectives"

    By the end of this class you should be able to:

    - **Decide** when a call between two services should be a synchronous request or an asynchronous event.
    - **Explain** how Kafka organises data in topics, partitions and offsets, and how consumer groups give both fan-out and load sharing.
    - **Choose** a message key that preserves the ordering the business needs, and configure producer durability (`acks`, replication).
    - **Explain** at-most-once, at-least-once and exactly-once delivery, and **design** an idempotent consumer.
    - **Apply** the transactional outbox and the saga pattern to keep data consistent across services without distributed transactions.
    - **Compare** event sourcing and CQRS with a classic CRUD model, and handle poison messages with a dead letter queue.

## Slides

<div class="slides-embed">
  <iframe src="slides/event-driven.html" title="Slides: event-driven architecture" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/event-driven.html){:target="_blank"}

---

## Why Event-Driven?

Two delivery models side by side: the synchronous chain forces the producer to wait for every downstream service before it can respond; the async model returns immediately after publishing.

=== "Synchronous Call Chain"

    The producer must wait for every downstream service to complete before returning a response to the client. Latency accumulates, and a single slow (or failing) dependency stalls the entire request.

    ``` mermaid-sim
    sequenceDiagram
        autonumber
        participant Client
        participant OrderService
        participant EmailService
        participant InventoryService
        participant FraudService

        Client->>+OrderService: POST /orders
        OrderService->>+EmailService: sendConfirmation()
        EmailService-->>-OrderService: ok
        OrderService->>+InventoryService: reserveStock()
        InventoryService-->>-OrderService: ok
        OrderService->>+FraudService: checkFraud()
        FraudService-->>-OrderService: ok
        OrderService-->>-Client: 201 Created
    ```

=== "Asynchronous Event Publish"

    The producer publishes a single event and immediately returns. Each downstream service consumes the event independently — in parallel, on its own schedule, without the producer knowing or caring.

    ``` mermaid-sim
    sequenceDiagram
        participant Client
        participant OrderService
        participant Kafka
        participant EmailService
        participant InventoryService
        participant FraudService

        Client->>+OrderService: POST /orders
        OrderService->>Kafka: publish OrderCreated
        OrderService-->>-Client: 202 Accepted
        Kafka-->>EmailService: OrderCreated (async)
        Kafka-->>InventoryService: OrderCreated (async)
        Kafka-->>FraudService: OrderCreated (async)
    ```

| Concern | Synchronous (REST) | Asynchronous (Event) |
|---|---|---|
| Latency | Sum of all calls | Only producer latency |
| Coupling | Producer knows all consumers | Producer knows none |
| Resilience | One slow consumer blocks all | Consumer failures are independent |
| Throughput | Limited by slowest dependency | Consumers scale independently |
| Debugging | Simple request trace | Requires distributed tracing |
| Consistency | Strong (synchronous) | Eventual |

The simulation below illustrates what happens to queue depth when the consumer cannot keep up with the producer — and what happens when it catches up.

```python exec="1" html="1"
import matplotlib.pyplot as plt

steps = list(range(21))

# Scenario 1: producer adds 3/step, consumer removes 2/step → queue grows
queue1 = [0]
for _ in steps[1:]:
    queue1.append(max(0, queue1[-1] + 3 - 2))

# Scenario 2: first 10 steps same overload, then consumer speeds up (removes 5/step)
queue2 = [0]
for i in steps[1:]:
    rate = 2 if i <= 10 else 5
    queue2.append(max(0, queue2[-1] + 3 - rate))

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(10, 4))
fig.patch.set_alpha(0)

ax1.plot(steps, queue1, color="#1976d2", linewidth=2, marker="o", markersize=4)
ax1.set_title("Overloaded Consumer\n(producer=3/step, consumer=2/step)", fontsize=10)
ax1.set_xlabel("Step")
ax1.set_ylabel("Queue depth (messages)")
ax1.set_facecolor("none")
ax1.grid(True, alpha=0.3)

ax2.plot(steps, queue2, color="#388e3c", linewidth=2, marker="o", markersize=4)
ax2.axvline(x=10, color="#e53935", linestyle="--", alpha=0.6, label="Consumer speeds up")
ax2.set_title("Consumer Catches Up\n(consumer scales to 5/step at step 10)", fontsize=10)
ax2.set_xlabel("Step")
ax2.set_ylabel("Queue depth (messages)")
ax2.set_facecolor("none")
ax2.legend(fontsize=8)
ax2.grid(True, alpha=0.3)

plt.tight_layout()
buffer = __import__('io').StringIO()
plt.savefig(buffer, format="svg", transparent=True)
print(buffer.getvalue())
plt.close()
```

---

## Core Concepts

| Concept | Definition | Example |
|---|---|---|
| **Event** | An immutable record of something that happened | `OrderCreated { orderId, customerId, timestamp }` |
| **Message** | Generic data container sent between services | Any payload in a queue |
| **Command** | An instruction to do something (can be rejected) | `PlaceOrder { items, paymentToken }` |
| **Producer / Consumer** | The service that writes / reads messages | order-service produces; notification-service consumes |
| **Broker** | The server that stores messages and serves them to consumers | A Kafka broker (`kafka:9092`) |
| **Topic** | A named, durable, ordered log of events | `order-events` |
| **Partition** | A shard of a topic for parallelism; order is kept only inside it | Partition 0, 1, 2 of `order-events` |
| **Key** | Optional value that decides the partition of a message | `orderId` |
| **Offset** | Sequential integer identifying a message position | Offset 42 in partition 1 |
| **Consumer Group** | A set of consumers sharing the work of a topic | `notification-group` |

!!! tip "Events are facts"
    Unlike database records, events are never updated or deleted — the log is append-only. This immutability makes events safe to replay for rebuilding state, auditing history, or populating new projections without touching the original data.

---

## Kafka Architecture

Apache Kafka[^1] is a distributed, append-only **log**: producers append messages to the end, consumers read from any position they choose, and messages stay on disk after being read (until the retention policy deletes them). This is the main difference from a classic message *queue* such as RabbitMQ, where a message is removed once a consumer acknowledges it.

Kafka organises messages into **topics**, each split into ordered **partitions**. Multiple consumer groups can read the same topic independently — each group maintains its own offset pointer per partition.

``` mermaid-sim
flowchart LR
    subgraph broker ["Kafka Broker"]
        subgraph topic ["Topic: order-events"]
            P0["Partition 0\n0, 1, 2, 3, →"]
            P1["Partition 1\n0, 1, 2, →"]
            P2["Partition 2\n0, 1, →"]
        end
    end
    subgraph ng ["notification-group"]
        N0[Consumer A]
        N1[Consumer B]
        N2[Consumer C]
    end
    subgraph ag ["analytics-group"]
        A0[Consumer X]
    end
    P0 --> N0
    P1 --> N1
    P2 --> N2
    P0 --> A0
    P1 --> A0
    P2 --> A0
```

Each consumer group tracks its own offsets, so `notification-group` and `analytics-group` progress through the log independently. Adding a new consumer group never affects existing groups.

**Retention policies** control how long Kafka keeps messages:

| Policy | Config | Behavior |
|---|---|---|
| Time-based | `retention.ms=604800000` | Delete messages older than 7 days |
| Size-based | `retention.bytes=1073741824` | Delete the oldest segments when a **partition** exceeds 1 GB (the limit is per partition, not per topic) |
| Compact | `cleanup.policy=compact` | Keep only the latest message per key (useful for state snapshots) |

`retention.ms=604800000` (7 days) is Kafka's default; `retention.bytes` defaults to `-1` (no size limit).

### Keys, partitions and ordering

When a producer sends a message **with a key**, Kafka's default partitioner hashes the key to choose the partition: the same key always goes to the same partition (as long as the number of partitions does not change). Messages **without a key** are spread across partitions.

Since order is only guaranteed *inside* a partition, the key is how you choose **what** must stay in order. In [Hands-on 9](../../hands-on/9/index.md) the order service sends `kafkaTemplate.send("order-events", order.getId().toString(), event)` — the `orderId` is the key, so `OrderCreated`, `OrderPaid` and `OrderShipped` of the same order are always read in sequence, while different orders are processed in parallel.

``` mermaid-sim
flowchart LR
    p["order-service<br/>(producer)"] -->|"key=order-7"| h{"hash(key) % 3"}
    h -->|"order-7 → P1"| P1["Partition 1"]
    h -.->|"other keys"| P0["Partition 0"]
    h -.->|"other keys"| P2["Partition 2"]
    P1 --> c["consumer B<br/>reads order-7 events in order"]
```

!!! warning "Choosing the key"
    - A key with few values (e.g. `country`) creates **hot partitions**: one partition gets most of the traffic while others sit idle.
    - Adding partitions later changes `hash(key) % partitions`, so existing keys may move to a different partition and lose their ordering for a while — size partitions up front.
    - No key at all means no ordering between related events.

### Durability: replication and `acks`

In production each partition is **replicated** on several brokers (replication factor, typically 3). One replica is the **leader** and receives all writes; the others are **followers** that copy it. The replicas that are up to date form the **ISR** (in-sync replicas). If the leader's broker dies, an in-sync follower is elected leader.

The producer setting `acks` chooses how much of this the producer waits for:

| `acks` | The producer gets a confirmation when… | Risk |
|---|---|---|
| `0` | it has sent the message (no confirmation) | Lost if the broker never received it |
| `1` | the leader has written it | Lost if the leader dies before followers copy it |
| `all` | all in-sync replicas have it (with `min.insync.replicas` ≥ 2) | Slowest, but survives the loss of a broker |

Hands-on 9 uses `acks: all` with `enable.idempotence: true`; the idempotent producer attaches a sequence number to each message so that the producer's own retries do not create duplicates in the log. (Since Kafka 3.0 both are already the producer defaults.)

!!! info "ZooKeeper and KRaft"
    Older Kafka clusters stored their metadata in a separate ZooKeeper ensemble. Kafka now has its own Raft-based metadata quorum (**KRaft**; see [Consensus](../distributed_systems/consensus/index.md)), and Kafka 4.0 (2025) removed ZooKeeper support entirely. [Hands-on 9](../../hands-on/9/index.md) runs Kafka 4 in KRaft mode: a single node that is both broker and controller.

---

## Messaging Patterns

### Pub/Sub (Fan-out)

One published event is delivered to **every** interested consumer group. Each group receives a full, independent copy of the message. Because groups track their own offsets, a slow analytics pipeline does not affect the notification pipeline.

Use cases: email notifications, audit logs, analytics pipelines, cache invalidation.

### Competing Consumers

Multiple consumers within the **same** group share partitions — each partition is owned by exactly one consumer at a time, so each message is processed by exactly one consumer. This pattern enables horizontal scaling of processing without duplicated work.

Use cases: order processing, payment handling, image resizing jobs.

The maximum parallelism of a group is the number of partitions: with 3 partitions, a fourth consumer in the same group sits idle. When a consumer joins or leaves, Kafka **rebalances** the group and reassigns partitions.

### Event Sourcing

Instead of storing only the current state, the system stores the **full history of events**[^3]. Current state is derived by replaying all events from the beginning (or from a snapshot).

``` mermaid-sim
sequenceDiagram
    actor User
    User->>+CommandHandler: PlaceOrder
    CommandHandler->>+EventStore: append OrderCreated
    EventStore-->>-CommandHandler: ack
    CommandHandler-->>-User: 202 Accepted
    EventStore-->>Projection: OrderCreated event
    Projection->>ReadModel: update order view
```

This means the write model is the event log itself. Projections (read models) are rebuilt from events at any time, enabling time travel debugging and zero-downtime schema migration.

### CQRS (Command Query Responsibility Segregation)

Separate the **write side** (commands, events, event store) from the **read side** (queries, projections, read model)[^4]. The write side is optimised for consistency and auditability; the read side is optimised for query performance.

``` mermaid-sim
flowchart LR
    client --> |"POST /orders (Command)"| cmd["Command Handler"]
    cmd --> |"OrderCreated"| bus["Event Bus (Kafka)"]
    bus --> |"project"| view["Read Model\n(optimised for queries)"]
    client --> |"GET /orders (Query)"| view
    cmd --> |"append"| store["Event Store"]
```

CQRS is commonly paired with Event Sourcing because the event log is the natural write model. However, CQRS can also be applied without event sourcing — using separate read/write databases kept in sync via change-data-capture (CDC: a tool such as Debezium reads the database's transaction log and publishes every change as an event).

!!! warning "Event sourcing and CQRS are not defaults"
    Both add real complexity: events must be versioned forever, read models are eventually consistent, and rebuilding projections takes time. Use them for parts of the domain that need an audit trail or very different read and write shapes (e.g. order history, ledgers) — not for every CRUD entity of the store.

---

## Delivery Guarantees and Idempotent Consumers

A consumer reads a message, processes it (e.g. sends an e-mail), and **commits its offset** to tell Kafka "I am done up to here". A crash can happen between any two of these steps, and *when* you commit decides what a crash costs:

| Guarantee | How | A crash means | Typical use |
|---|---|---|---|
| **At-most-once** | Commit **before** processing | The message is **lost** | Metrics where a gap is acceptable |
| **At-least-once** | Commit **after** processing | The message is **processed again** | The default choice — Hands-on 9 (`enable_auto_commit=False` + `commit()` after processing) |
| **Exactly-once** | Kafka transactions (idempotent producer + `isolation.level=read_committed`) | Neither — but only for *read from Kafka → write to Kafka* | Stream processing (Kafka Streams) |

``` mermaid-sim
sequenceDiagram
    participant K as Kafka
    participant N as notification-service
    participant M as Mail server
    K->>N: OrderCreated (offset 42)
    N->>M: send confirmation e-mail
    Note over N: crashes before commit
    N->>K: (restart) fetch from last committed offset
    K->>N: OrderCreated (offset 42) again
    N->>N: already sent for order 7? yes → skip
    N->>K: commit offset 43
```

Exactly-once *inside Kafka* does not extend to side effects outside it: Kafka cannot "un-send" an e-mail or roll back a row in Postgres. In practice, systems use **at-least-once delivery + idempotent consumers**: processing the same message twice has the same effect as processing it once.

Common ways to make a consumer idempotent:

- **Processed-message table**: store the event ID (or `orderId` + event type) in the consumer's database in the same transaction as the business change; skip events already stored.
- **Natural idempotency**: write operations that are idempotent by nature — `UPSERT`, "set status to PAID" instead of "add 10 to the balance".
- **Unique constraints**: let the database reject the second insert of the same `orderId`.

---

## Keeping Services Consistent

### The dual-write problem

In Hands-on 9 the order service saves the order in Postgres and *then* publishes `OrderCreated` to Kafka. These are two different systems, and no transaction covers both:

- The database commit succeeds, then the service crashes before publishing → the order exists, but nobody is ever notified.
- The event is published, then the database transaction rolls back → consumers react to an order that does not exist.

### Transactional outbox

The **transactional outbox**[^2] removes the dual write. The service writes the event into an `outbox` table **in the same local database transaction** as the order. A separate relay (a polling job, or CDC with Debezium) reads the outbox and publishes to Kafka, marking rows as sent.

``` mermaid-sim
sequenceDiagram
    participant O as order-service
    participant DB as Postgres
    participant R as Outbox relay
    participant K as Kafka
    O->>DB: BEGIN
    O->>DB: INSERT INTO orders ...
    O->>DB: INSERT INTO outbox (OrderCreated)
    O->>DB: COMMIT (both or neither)
    R->>DB: read unsent outbox rows
    R->>K: publish OrderCreated
    R->>DB: mark row as sent
```

If the relay crashes after publishing but before marking the row, the event is published again — another reason consumers must be idempotent.

### Sagas

Some business operations span several services: placing an order must reserve stock (product service) and charge the customer (payment service). Each service has its own database, so a single ACID transaction is impossible (see [Microservices](../microservices/index.md)). A **saga**[^2] is a sequence of local transactions, one per service, where each step is triggered by the previous one's event. If a step fails, the saga runs **compensating transactions** that semantically undo the steps already done (release the stock, refund the payment).

``` mermaid-sim
sequenceDiagram
    participant O as Order
    participant I as Inventory
    participant P as Payment
    O->>I: OrderCreated
    I->>P: StockReserved
    P->>I: PaymentFailed
    I->>O: StockReleased (compensation)
    O->>O: mark order CANCELLED
```

| Style | How it is coordinated | Good | Watch out |
|---|---|---|---|
| **Choreography** | Each service reacts to the others' events (diagram above) | No central component, loose coupling | The flow is spread over many services; hard to follow and to change |
| **Orchestration** | A saga orchestrator sends commands and waits for replies | The flow is explicit in one place | The orchestrator is one more service to build and run |

!!! warning "Sagas are not transactions"
    A saga gives up isolation: other requests can see the intermediate state (stock reserved, payment not yet done). Design the states explicitly (`PENDING`, `CONFIRMED`, `CANCELLED`) and make every step and every compensation idempotent.

---

## Dead Letter Queue

When a consumer fails to process a message repeatedly, it must not block the rest of the stream. A **Dead Letter Queue (DLQ)** is a separate topic where messages are moved after exhausting retry attempts, allowing the main stream to continue while the failing messages are investigated and reprocessed manually.

``` mermaid-sim
stateDiagram-v2
    [*] --> Pending
    Pending --> Processing : consumer picks up
    Processing --> Committed : success
    Processing --> Retry : transient failure (attempt < max)
    Retry --> Processing : after backoff
    Processing --> DLQ : max retries exceeded
    DLQ --> Processing : manual reprocessing
```

!!! tip "Spring Kafka"
    Spring Kafka's `@RetryableTopic` annotation handles retry scheduling and DLQ routing automatically. Configure `attempts`, `backoff`, and the DLQ topic name declaratively without manual error-handling boilerplate.

    ```java
    // default: 3 attempts in total; Spring Kafka 4 (Spring Boot 4) annotation
    @RetryableTopic(backOff = @BackOff(delay = 1000, multiplier = 2))
    @KafkaListener(topics = "order-events", groupId = "invoice-group")
    public void onOrderCreated(OrderCreatedEvent event) {
        invoiceService.create(event);   // throws → retried after 1 s, then 2 s
    }

    @DltHandler
    public void onDeadLetter(OrderCreatedEvent event) {
        log.error("order {} sent to the dead letter topic", event.orderId());
    }
    ```

Retry only failures that can succeed later (a database briefly unavailable). A message that can *never* be processed — invalid JSON, an unknown product ID — should go straight to the DLQ; retrying it only delays the rest of the partition.

---

## When to Use (and Not Use) Event-Driven

| Scenario | Best fit | Reason |
|---|---|---|
| Login / auth token generation | REST | Caller needs the token synchronously |
| Order confirmation email | Event | User doesn't wait; email can lag |
| Real-time fraud check (must block) | REST | Need the answer before proceeding |
| Audit log for all order mutations | Event | Fire-and-forget, fan-out |
| Payment processing | Depends | If idempotent retry is guaranteed: event. If blocking confirmation needed: REST + saga |
| Analytics data pipeline | Event | High volume, consumers can be slow |
| Service health check | REST | Synchronous by nature |

!!! warning "Operational Complexity"
    Event-driven systems are harder to debug than REST. A request that spans 5 services and 3 Kafka topics requires distributed tracing (covered in the [Observability](../observability/index.md) class) to diagnose. Do not adopt event-driven architecture for its own sake — adopt it when the coupling and latency costs of synchronous calls become concrete problems.

!!! warning "Common pitfalls"
    - **Assuming exactly-once**: duplicates *will* arrive; every consumer must be idempotent.
    - **Dual writes**: saving to the database and publishing to Kafka without an outbox loses or invents events after a crash.
    - **Breaking the event schema**: consumers you do not know about read your events. Only add optional fields; never rename or remove fields without a new version (`OrderCreatedV2`) — a schema registry with Avro or Protobuf can enforce this.
    - **Ignoring consumer lag**: the queue-depth chart above is real. Monitor the lag of each consumer group (Kafka UI, Prometheus) and alert when it grows.
    - **Events that are commands in disguise**: `SendEmailToCustomer` couples the producer to one consumer; publish the fact (`OrderCreated`) and let consumers decide.

---

## Connections

- [Hands-on 9](../../hands-on/9/index.md) — Kafka in the store: `OrderCreated` published by the order service and consumed by the notification service, with a DLQ.
- [Microservices](../microservices/index.md) — database per service, the reason sagas and outboxes are needed.
- [Distributed Systems](../distributed_systems/index.md) — eventual consistency, ordering and consensus (KRaft).
- [Reliability](../reliability/index.md) — retries, backoff and idempotency apply to consumers too.
- [Observability](../observability/index.md) and [Hands-on 10](../../hands-on/10/index.md) — tracing a request across topics.

## Key takeaways

- Use **events** when the caller does not need the answer to continue; use a **synchronous request** when it does.
- Kafka is a replicated, partitioned **log**: order holds within a partition, the **key** decides the partition, and each consumer group keeps its own offsets — different groups fan out, the same group shares the work.
- Delivery is realistically **at-least-once**: commit after processing and make every consumer **idempotent**.
- Never dual-write: the **transactional outbox** publishes events reliably; **sagas** with compensations replace distributed transactions.
- **Event sourcing** and **CQRS** are powerful for specific domains, not defaults; a **DLQ** keeps poison messages from blocking a partition.

---

[^1]: NARKHEDE, N.; SHAPIRA, G.; PALINO, T. *Kafka: The Definitive Guide*, 2nd ed. O'Reilly, 2021.
[^2]: RICHARDSON, C. [Microservices Patterns](https://microservices.io){target="_blank"} — Event Sourcing, CQRS, Saga.
[^3]: FOWLER, M. [Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html){target="_blank"}, 2005.
[^4]: YOUNG, G. [CQRS Documents](https://cqrs.files.wordpress.com/2010/11/cqrs_documents.pdf){target="_blank"}, 2010.
