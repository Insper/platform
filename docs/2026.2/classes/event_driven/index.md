
# 8. Event-Driven Architecture

Synchronous REST works well when the caller needs an immediate answer. But when an order is placed, the system might need to notify 5 downstream services — email, inventory, fraud detection, shipping, analytics. Calling them all synchronously before returning to the user creates a latency cliff and a coupling explosion. Event-driven architecture solves this with a fundamentally different contract: publish an event, and let interested parties react asynchronously.

---

## Why Event-Driven?

Two delivery models side by side: the synchronous chain forces the producer to wait for every downstream service before it can respond; the async model returns immediately after publishing.

=== "Synchronous Call Chain"

    The producer must wait for every downstream service to complete before returning a response to the client. Latency accumulates, and a single slow (or failing) dependency stalls the entire request.

    ``` mermaid
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

    ``` mermaid
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
| **Topic** | A named, durable, ordered log of events | `order-events` |
| **Partition** | A shard of a topic for parallelism | Partition 0, 1, 2 of `order-events` |
| **Offset** | Sequential integer identifying a message position | Offset 42 in partition 1 |
| **Consumer Group** | A set of consumers sharing the work of a topic | `notification-service` group |

!!! tip "Events are facts"
    Unlike database records, events are never updated or deleted — the log is append-only. This immutability makes events safe to replay for rebuilding state, auditing history, or populating new projections without touching the original data.

---

## Kafka Architecture

Kafka organises messages into **topics**, each split into ordered **partitions**. Multiple consumer groups can read the same topic independently — each group maintains its own offset pointer per partition.

``` mermaid
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
| Size-based | `retention.bytes=1073741824` | Delete when topic exceeds 1 GB |
| Compact | `cleanup.policy=compact` | Keep only the latest message per key (useful for state snapshots) |

---

## Messaging Patterns

### Pub/Sub (Fan-out)

One published event is delivered to **every** interested consumer group. Each group receives a full, independent copy of the message. Because groups track their own offsets, a slow analytics pipeline does not affect the notification pipeline.

Use cases: email notifications, audit logs, analytics pipelines, cache invalidation.

### Competing Consumers

Multiple consumers within the **same** group share partitions — each partition is owned by exactly one consumer at a time, so each message is processed by exactly one consumer. This pattern enables horizontal scaling of processing without duplicated work.

Use cases: order processing, payment handling, image resizing jobs.

### Event Sourcing

Instead of storing only the current state, the system stores the **full history of events**. Current state is derived by replaying all events from the beginning (or from a snapshot).

``` mermaid
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

Separate the **write side** (commands, events, event store) from the **read side** (queries, projections, read model). The write side is optimised for consistency and auditability; the read side is optimised for query performance.

``` mermaid
flowchart LR
    client --> |"POST /orders (Command)"| cmd["Command Handler"]
    cmd --> |"OrderCreated"| bus["Event Bus (Kafka)"]
    bus --> |"project"| view["Read Model\n(optimised for queries)"]
    client --> |"GET /orders (Query)"| view
    cmd --> |"append"| store["Event Store"]
```

CQRS is commonly paired with Event Sourcing because the event log is the natural write model. However, CQRS can also be applied without event sourcing — using separate read/write databases kept in sync via change-data-capture.

---

## Dead Letter Queue

When a consumer fails to process a message repeatedly, it must not block the rest of the stream. A **Dead Letter Queue (DLQ)** is a separate topic where messages are moved after exhausting retry attempts, allowing the main stream to continue while the failing messages are investigated and reprocessed manually.

``` mermaid
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
    Event-driven systems are harder to debug than REST. A request that spans 5 services and 3 Kafka topics requires distributed tracing (covered in the Observability class) to diagnose. Do not adopt event-driven architecture for its own sake — adopt it when the coupling and latency costs of synchronous calls become concrete problems.

---

[^1]: NARKHEDE, N.; SHAPIRA, G.; PALINO, T. *Kafka: The Definitive Guide*, 2nd ed. O'Reilly, 2021.
[^2]: RICHARDSON, C. [Microservices Patterns](https://microservices.io){target="_blank"} — Event Sourcing, CQRS, Saga.
[^3]: FOWLER, M. [Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html){target="_blank"}, 2005.
[^4]: YOUNG, G. [CQRS Documents](https://cqrs.files.wordpress.com/2010/11/cqrs_documents.pdf){target="_blank"}, 2010.
