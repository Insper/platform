# 10. Kafka Messaging

!!! info "Goal"

    Add asynchronous messaging to the platform. When an order is created, publish an `OrderCreated` event to Apache Kafka. A new `notification-service` (Python/FastAPI) consumes this event asynchronously and simulates sending a confirmation email — without the order-service knowing the notification-service exists.

The platform currently uses synchronous REST calls for all inter-service communication. Every call the order-service makes — to account-service, to product-service — happens inline, before the response is returned to the client. This works for operations where the caller needs a result immediately. But some operations are fire-and-forget: when an order is created, sending an email confirmation doesn't need to block the customer. This hands-on adds Apache Kafka as the messaging backbone for exactly these cases.

## Slides

<div class="slides-embed">
  <iframe src="slides/kafka.html" title="Slides: kafka messaging" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/kafka.html){:target="_blank"}

## 1. Architecture

=== "Before"

    ``` mermaid-sim
    flowchart LR
        client[Client] -->|REST| gw[Gateway]
        gw -->|REST| order[order-service]
        order -->|REST sync| account[account-service]
        order -->|REST sync| product[product-service]
    ```

=== "After"

    ``` mermaid-sim
    flowchart LR
        client[Client] -->|REST| gw[Gateway]
        gw -->|REST| order[order-service]
        order -->|REST sync| account[account-service]
        order -->|REST sync| product[product-service]
        order -->|"Kafka (async)\norder-events"| kafka[(Kafka)]
        kafka -->|"Kafka (async)"| notification[notification-service]
    ```

!!! tip "Decoupling"

    The order-service publishes to a topic called `order-events`. It has no knowledge of the notification-service. Tomorrow you could add an analytics-service consuming the same topic without touching a single line of order-service code.

---

## 2. Docker Compose — Adding Kafka

Add Kafka and Kafka UI to `docker-compose.yml`. A single Kafka 4 node runs in **KRaft** mode — no ZooKeeper container. Kafka UI provides a browser-based interface for inspecting topics and messages during development.

=== "docker-compose.yml additions"

    ``` { .yaml .copy .select }
      kafka:
        image: apache/kafka:4.3.1
        ports:
          - "9092:9092"
        environment:
          # KRaft combined mode: this single node is both broker and controller
          KAFKA_NODE_ID: 1
          KAFKA_PROCESS_ROLES: broker,controller
          KAFKA_CONTROLLER_QUORUM_VOTERS: 1@kafka:9093
          KAFKA_LISTENERS: PLAINTEXT://:9092,CONTROLLER://:9093
          KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
          KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT
          KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER
          KAFKA_INTER_BROKER_LISTENER_NAME: PLAINTEXT
          # single broker: internal topics cannot have more than 1 replica
          KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
          KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: 1
          KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: 1
          KAFKA_AUTO_CREATE_TOPICS_ENABLE: "true"

      kafka-ui:
        image: provectuslabs/kafka-ui:latest
        depends_on:
          - kafka
        ports:
          - "8090:8080"
        environment:
          KAFKA_CLUSTERS_0_NAME: local
          KAFKA_CLUSTERS_0_BOOTSTRAPSERVERS: kafka:9092
    ```

!!! info "KRaft — no ZooKeeper"

    Kafka keeps its cluster metadata (topics, partitions, leaders) in its own Raft-based controller quorum, **KRaft**. Before, this metadata lived in a separate ZooKeeper ensemble; Kafka 4.0 (2025) removed ZooKeeper support entirely. Here the single node is both broker and controller (`KAFKA_PROCESS_ROLES: broker,controller`): clients talk to the `PLAINTEXT` listener on `kafka:9092`, and the controller quorum uses the `CONTROLLER` listener on port 9093. See [Event-Driven Architecture](../../classes/event_driven/index.md).

!!! note "Kafka UI"

    Access Kafka UI at `http://localhost:8090`. You can browse topics, inspect messages, and monitor consumer group lag — essential for debugging during development.

---

## 3. Order Service — Publishing Events

### 3.1 Dependency

Add `spring-kafka` to the order-service's `pom.xml`:

``` { .xml .copy .select }
<dependency>
    <groupId>org.springframework.kafka</groupId>
    <artifactId>spring-kafka</artifactId>
</dependency>
```

### 3.2 Event Record

Create `OrderCreatedEvent.java` in the `store.order` package:

``` { .java .copy .select }
package store.order;

public record OrderCreatedEvent(
    String orderId,
    String customerId,
    Double totalAmount,
    String timestamp
) {}
```

### 3.3 Kafka Producer Configuration

Add the following to `application.yaml`:

``` { .yaml .copy .select }
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

`kafka:9092` is the broker's name inside the Docker network: inside a container, `localhost:9092` is the container itself, not the broker.

!!! tip "acks=all"

    Setting `acks=all` means the Kafka broker will wait for all in-sync replicas to acknowledge the write before confirming. In a single-broker development setup this has no effect, but in production it prevents data loss during broker failover.

### 3.4 Publisher

Create `OrderEventPublisher.java`:

``` { .java .copy .select }
package store.order;

import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;
import lombok.RequiredArgsConstructor;
import java.time.Instant;

@Component
@RequiredArgsConstructor
public class OrderEventPublisher {

    private final KafkaTemplate<String, OrderCreatedEvent> kafkaTemplate;

    public void publishOrderCreated(Order order) {
        var event = new OrderCreatedEvent(
            order.getId().toString(),
            order.getCustomerId(),
            order.getTotalAmount(),
            Instant.now().toString()
        );
        kafkaTemplate.send("order-events", order.getId().toString(), event);
    }
}
```

### 3.5 Calling the Publisher

In `OrderService.java`, inject `OrderEventPublisher` and call it after saving the order:

``` { .java .copy .select }
// After saving:
eventPublisher.publishOrderCreated(savedOrder);
```

Publish **after** saving: never announce an order that does not exist. The request then goes like this — the synchronous part for the customer, the email later, on the consumer's own time:

``` mermaid-sim
sequenceDiagram
    participant C as Client
    participant O as order-service
    participant DB as Database
    participant K as Kafka (order-events)
    participant N as notification-service
    C->>O: POST /orders
    O->>O: REST calls to account-service and product-service
    O->>DB: save the order
    O->>K: send(order-events, key = orderId, event)
    O-->>C: 201 CREATED (does not wait for the email)
    K->>N: OrderCreated, on the next poll
    N->>N: log the confirmation email
    N->>K: commit the offset
```

---

## 4. Notification Service (Python / FastAPI)

A new Python microservice that consumes `order-events` and logs a simulated email notification.

### 4.1 File Structure

```
notification-service/
    main.py
    Dockerfile
    requirements.txt
```

### 4.2 Code

=== "requirements.txt"

    ``` { .text .copy .select }
    fastapi==0.110.0
    kafka-python==2.3.2
    uvicorn==0.29.0
    ```

=== "main.py"

    ``` { .python .copy .select linenums="1" }
    from fastapi import FastAPI
    from kafka import KafkaConsumer
    import json, threading, logging

    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

    app = FastAPI()

    def consume():
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
            logger.info(
                f"[NOTIFICATION] Order {event['orderId']} for customer "
                f"{event['customerId']} — sending confirmation email "
                f"(total: {event['totalAmount']})"
            )
            consumer.commit()

    @app.on_event("startup")
    def startup_event():
        thread = threading.Thread(target=consume, daemon=True)
        thread.start()

    @app.get("/health")
    def health():
        return {"status": "up"}
    ```

=== "Dockerfile"

    ``` { .dockerfile .copy .select }
    FROM python:3.12-slim
    WORKDIR /app
    COPY requirements.txt .
    RUN pip install --no-cache-dir -r requirements.txt
    COPY main.py .
    CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
    ```

Add the notification-service to `docker-compose.yml`:

``` { .yaml .copy .select }
  notification-service:
    build: ./notification-service
    depends_on:
      - kafka
    environment:
      - PYTHONUNBUFFERED=1
```

!!! note "enable_auto_commit=False"

    Manual commit (`consumer.commit()`) ensures the offset advances only after the message has been successfully processed. If the service crashes mid-processing, it will re-consume the message on restart — at-least-once delivery semantics.

``` mermaid-sim
sequenceDiagram
    participant K as Kafka (order-events)
    participant N as notification-service
    K->>N: message at offset 0
    N->>N: send the email
    N-xK: crash before commit()
    Note over K,N: offset 0 was never committed
    K->>N: after the restart, offset 0 again
    N->>N: the same email a second time
    N->>K: commit(), the group now points at offset 1
```

---

## 5. Testing

### 5.1 Start Everything

``` termynal
$ docker compose up --build -d
$ docker compose ps
NAME                    STATUS
kafka                   running
kafka-ui                running
notification-service    running
order-service           running
```

### 5.2 Create an Order

``` termynal
$ curl -s -X POST http://localhost:8080/orders \
    -H "Content-Type: application/json" \
    -d '{"customerId":"cust-42","items":[{"productId":"p1","quantity":2}]}' \
    | jq .
{
  "id": "ord-7f3a",
  "status": "CREATED",
  "totalAmount": 49.98
}
```

### 5.3 Verify in Kafka UI

Open `http://localhost:8090`, navigate to **Topics → order-events → Messages**. You should see the `OrderCreated` event with `orderId: ord-7f3a`.

### 5.4 Verify Notification

``` termynal
$ docker compose logs notification-service
notification-service  | INFO: [NOTIFICATION] Order ord-7f3a for customer cust-42 — sending confirmation email (total: 49.98)
```

### 5.5 Scale the notification-service

A topic is split into **partitions**. The key picks the partition (a hash of `orderId`, modulo the number of partitions), so all events with the same key stay in order in one partition. Inside a consumer group, each partition is read by **one** member at a time, and Kafka keeps the committed offset per partition. When a member joins or leaves, the group **rebalances**: partitions change owner, and the new owner resumes at the committed offset. Lag is the log-end offset minus the committed offset.

`order-events` was auto-created on the first publish with the broker's default of **1 partition** (the compose sets no `KAFKA_NUM_PARTITIONS`). Start a second instance and look at the group:

``` { .bash .copy .select }
docker compose up -d --scale notification-service=2
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --group notification-group
```

Only one consumer owns partition 0: the second instance is in the group with nothing to read. Add partitions — Kafka can add them, never remove them:

``` { .bash .copy .select }
docker compose exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --alter --topic order-events --partitions 3
```

Once the clients refresh their metadata (up to five minutes, `metadata.max.age.ms`; `docker compose restart notification-service order-service` makes it immediate), the group rebalances and both instances work. Create a few orders and run `--describe` again: each partition shows its `CURRENT-OFFSET`, `LOG-END-OFFSET` and `LAG`.

``` mermaid-sim
flowchart LR
    os["order-service\nkey = orderId"]
    subgraph topic ["order-events"]
        p0["partition 0"]
        p1["partition 1"]
        p2["partition 2"]
    end
    subgraph group ["notification-group"]
        n1["notification-service-1"]
        n2["notification-service-2"]
    end
    os --> p0
    os --> p1
    os --> p2
    p0 --> n1
    p1 --> n1
    p2 --> n2
    p0 & p1 & p2 -.->|"another group gets every message"| an["analytics-group"]
```

| Instances in `notification-group` | With 1 partition (the lab) | With 3 partitions |
|---|---|---|
| 1 | ✅ reads partition 0 | ✅ reads 0, 1 and 2 |
| 2 | ⚠️ one instance is idle | ✅ 0 and 1 · 2 |
| 3 | ⚠️ two instances are idle | ✅ one partition each |
| 4 | ⚠️ three instances are idle | ⚠️ one instance is idle |

The number of partitions caps the parallelism of a group. A different group (an analytics-service, say) reads every message independently, at its own offsets.

<div class="csim" data-sim="order-events" data-script="scale"></div>

!!! tip "Try it"

    The simulator starts where the lab starts: `order-events` auto-created with 1 partition, one notification-service in `notification-group`; play or → runs a page, and the buttons work at any time. In **5.5 Scale the consumer**, six orders land in partition 0 and a second instance gets nothing; after `--partitions 3`, notification-service-1 reads partitions 0 and 1, notification-service-2 reads partition 2, and the next six orders split 2, 2 and 2 by key. In **6 Failures**, a kill before `consumer.commit()` sends 1 duplicate email, the idempotent consumer skips the repeat, and without the try/except a bad event stops the consumer while the lag grows to 3; with the DLQ it ends in `order-events-dlq` and the lag drops to 0. In **free** mode, scale to 4 instances with 3 partitions and watch one sit idle.

---

## 6. Reliability — Dead Letter Queue

When a consumer fails to process a message repeatedly, it should go to a DLQ rather than blocking the stream. The Python manual DLQ pattern publishes failed events to a separate `order-events-dlq` topic instead of crashing:

``` { .python .copy .select }
try:
    process_event(event)
    consumer.commit()
except Exception as e:
    logger.error(f"Failed to process {event['orderId']}: {e} — sending to DLQ")
    dlq_producer.send("order-events-dlq", value=event)
    consumer.commit()
```

Either way the offset advances: the main stream continues, and the DLQ is inspected (and replayed) later.

``` mermaid-sim
flowchart LR
    m["message from\norder-events"] --> p{"process_event"}
    p -->|ok| c["consumer.commit()"]
    p -->|exception| d["send to\norder-events-dlq"]
    d --> c
    c --> n["next message"]
    d -.->|"inspected and replayed later"| ops["operations"]
```

Without the try/except (the code of section 4), the exception ends the consume thread: `/health` still answers `up`, but the offset no longer moves and the lag grows behind the bad message. After `max.poll.interval.ms` (five minutes) Kafka hands the partition to another member — which meets the same message.

<div class="csim" data-sim="order-events" data-script="failures"></div>

!!! tip "Try it"

    The simulator starts where the lab starts: `order-events` auto-created with 1 partition, one notification-service in `notification-group`; play or → runs a page, and the buttons work at any time. In **5.5 Scale the consumer**, six orders land in partition 0 and a second instance gets nothing; after `--partitions 3`, notification-service-1 reads partitions 0 and 1, notification-service-2 reads partition 2, and the next six orders split 2, 2 and 2 by key. In **6 Failures**, a kill before `consumer.commit()` sends 1 duplicate email, the idempotent consumer skips the repeat, and without the try/except a bad event stops the consumer while the lag grows to 3; with the DLQ it ends in `order-events-dlq` and the lag drops to 0. In **free** mode, scale to 4 instances with 3 partitions and watch one sit idle.

!!! warning "At-least-once delivery"

    Kafka guarantees at-least-once delivery — a message may be delivered more than once (e.g., after a consumer crash before commit). Your consumer logic should be **idempotent**: processing the same event twice must produce the same result as processing it once. For the notification service, this means checking whether an email was already sent for this `orderId` before sending again.

---

## 7. Checklist

- [ ] Kafka (KRaft mode) + Kafka UI added to `docker-compose.yml`
- [ ] `OrderCreatedEvent` record created in order-service
- [ ] `spring-kafka` dependency added, `application.yaml` configured
- [ ] `OrderEventPublisher` publishes to `order-events` after save
- [ ] notification-service consumes events and logs confirmations
- [ ] Kafka UI shows the event after creating an order
- [ ] DLQ pattern understood (idempotent consumer)

[Next: Quiz](quiz.md){ .md-button .md-button--primary }
