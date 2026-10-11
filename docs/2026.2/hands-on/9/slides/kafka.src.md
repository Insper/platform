---
marp: true
lang: en
title: Hands-on 9 — Kafka Messaging
description: Platforms, Microservices, DevOps and APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Platforms, Microservices, DevOps and APIs · Hands-on 9</div>

# Hands-on 9 — Kafka Messaging

**The order-service publishes `OrderCreated`; a notification-service reacts on its own**

<!--
Outline: (1) why not one more REST call; (2) Kafka (KRaft mode) and Kafka UI in compose; (3) the
order-service producer; (4) the Python notification-service consumer; (5) test; (6) DLQ, idempotency.
-->

---

## Should the email block the customer?

<div class="q">

Every call the order-service makes — to account-service, to product-service — happens **before** it answers.
Now we must send a **confirmation email**. Add one more REST call?

</div>

* The customer does not need the email to **finish the order**: it is **fire-and-forget**.
* So publish an **`OrderCreated`** event to Kafka and return.
* A new **notification-service** consumes it **asynchronously** — the order-service does not even know it exists.

---

## Architecture

<div class="cols">
<div>

### Before

client → gateway → **order-service** → account-service, product-service *(REST, sync)*

</div>
<div>

### After

Same REST calls, plus:
**order-service** → topic `order-events` → **notification-service** *(Kafka, async)*

</div>
</div>

<div class="ok">

Decoupling: tomorrow an **analytics-service** can consume `order-events` without touching a single line of the order-service.

</div>

---

## The steps

1. **Docker Compose** — add Kafka (KRaft mode, no ZooKeeper) and Kafka UI.
2. **order-service** — `spring-kafka`, the `OrderCreatedEvent` record, producer config, publisher.
3. **notification-service** — a new Python / FastAPI consumer.
4. **Test** — create an order, see the event in Kafka UI and in the notification logs.
5. **Reliability** — dead letter queue and idempotent consumers.

---

## 1 · Docker Compose

| Service | Image | Port | Role |
|---|---|---|---|
| `kafka` | `apache/kafka:4.3.1` | 9092 | broker + KRaft controller |
| `kafka-ui` | `provectuslabs/kafka-ui:latest` | 8090 → 8080 | browse topics, messages, consumer lag |

Key Kafka settings:

- `KAFKA_PROCESS_ROLES: broker,controller` — **KRaft**: Kafka keeps its own metadata; ZooKeeper was removed in Kafka 4.0.
- `KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092` — clients connect by the service name.
- `KAFKA_AUTO_CREATE_TOPICS_ENABLE: "true"` — `order-events` is created on first publish.
- `KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1` — a single broker in development.

---

## 2 · order-service: the event

<div class="cols">
<div>

`pom.xml`:

```xml
<dependency>
    <groupId>org.springframework.kafka</groupId>
    <artifactId>spring-kafka</artifactId>
</dependency>
```

</div>
<div>

`store.order.OrderCreatedEvent`:

```java
public record OrderCreatedEvent(
    String orderId,
    String customerId,
    Double totalAmount,
    String timestamp
) {}
```

</div>
</div>

<p class="small">A record: immutable, like the fact it represents.</p>

---

## 2 · Producer configuration

```yaml
spring:
  kafka:
    bootstrap-servers: kafka:9092
    producer:
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.springframework.kafka.support.serializer.JsonSerializer
      acks: all
      retries: 3
      properties:
        enable.idempotence: true
```

<p class="small"><code>acks: all</code> waits for every in-sync replica before confirming. No effect on a single broker; in production it prevents data loss on broker failover.</p>

---

## 2 · Publishing

```java
@Component
@RequiredArgsConstructor
public class OrderEventPublisher {
    private final KafkaTemplate<String, OrderCreatedEvent> kafkaTemplate;

    public void publishOrderCreated(Order order) {
        var event = new OrderCreatedEvent(order.getId().toString(),
            order.getCustomerId(), order.getTotalAmount(), Instant.now().toString());
        kafkaTemplate.send("order-events", order.getId().toString(), event);
    }
}
```

In `OrderService`, **after saving**: `eventPublisher.publishOrderCreated(savedOrder);`

<p class="small">Topic <code>order-events</code>, key = order id, value = the event as JSON.</p>

---

## 3 · notification-service (Python / FastAPI)

<div class="cols">
<div>

```text
notification-service/
    main.py
    Dockerfile
    requirements.txt
```

```text
fastapi==0.110.0
kafka-python==2.3.2
uvicorn==0.29.0
```

</div>
<div>

- `Dockerfile`: `python:3.12-slim`, runs `uvicorn main:app` on port `8080`.
- On startup, a **daemon thread** runs the consumer loop.
- `GET /health` → `{"status": "up"}`.
- In compose: `build: ./notification-service`, `depends_on: kafka`, `PYTHONUNBUFFERED=1`.

</div>
</div>

---

## 3 · The consumer

```python
consumer = KafkaConsumer(
    "order-events",
    bootstrap_servers="kafka:9092",
    group_id="notification-group",
    value_deserializer=lambda m: json.loads(m.decode("utf-8")),
    auto_offset_reset="earliest",
    enable_auto_commit=False,
)
for message in consumer:
    event = message.value
    logger.info(f"[NOTIFICATION] Order {event['orderId']} ... sending confirmation email")
    consumer.commit()
```

<p class="small"><code>enable_auto_commit=False</code> + <code>commit()</code> after processing: a crash mid-processing means the message is consumed again — <strong>at-least-once</strong>.</p>

---

<!-- _class: tight -->

## 4 · Test

```bash
docker compose up --build -d
docker compose ps        # kafka, kafka-ui, notification-service, order-service
curl -s -X POST http://localhost:8080/orders \
    -H "Content-Type: application/json" \
    -d '{"customerId":"cust-42","items":[{"productId":"p1","quantity":2}]}' | jq .
# { "id": "ord-7f3a", "status": "CREATED", "totalAmount": 49.98 }
docker compose logs notification-service
# [NOTIFICATION] Order ord-7f3a for customer cust-42 — sending confirmation email (total: 49.98)
```

- Kafka UI `http://localhost:8090` → **Topics → order-events → Messages**: the event with `orderId: ord-7f3a`.

---

## 5 · When processing fails: DLQ

A message that keeps failing must not **block the stream**. Send it to `order-events-dlq` instead:

```python
try:
    process_event(event)
    consumer.commit()
except Exception as e:
    logger.error(f"Failed to process {event['orderId']}: {e} — sending to DLQ")
    dlq_producer.send("order-events-dlq", value=event)
    consumer.commit()
```

<p class="small">Either way the offset advances: the main stream continues, the DLQ is inspected later.</p>

---

## Pitfalls

<div class="warn">

**At-least-once** means duplicates happen. The consumer must be **idempotent**: before sending, check whether an email was already sent for this `orderId`.

</div>

- Publish **after saving** the order — never announce an order that does not exist.
- Inside the Docker network the broker is `kafka:9092`, not `localhost:9092`.
- `acks: all` only protects data when there is more than one broker.
- Use Kafka UI to check topics, messages and **consumer group lag** while debugging.

---

## Takeaways

1. Use REST when the caller needs the answer now; use **events** for fire-and-forget work.
2. The order-service publishes `OrderCreated` to `order-events` and **does not know its consumers**.
3. Kafka runs in **KRaft** mode in compose (no ZooKeeper); **Kafka UI** shows topics, messages and lag.
4. Spring: `KafkaTemplate.send(topic, key, event)` with a **JSON** serializer and `acks: all`.
5. Python: a `KafkaConsumer` in group `notification-group` with **manual commit** → at-least-once.
6. Failing messages go to a **DLQ**; consumers must be **idempotent**.
