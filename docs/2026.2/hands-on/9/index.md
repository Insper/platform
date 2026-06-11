# 9. Kafka Messaging

!!! info "Goal"

    Add asynchronous messaging to the platform. When an order is created, publish an `OrderCreated` event to Apache Kafka. A new `notification-service` (Python/FastAPI) consumes this event asynchronously and simulates sending a confirmation email — without the order-service knowing the notification-service exists.

The platform currently uses synchronous REST calls for all inter-service communication. Every call the order-service makes — to account-service, to product-service — happens inline, before the response is returned to the client. This works for operations where the caller needs a result immediately. But some operations are fire-and-forget: when an order is created, sending an email confirmation doesn't need to block the customer. This hands-on adds Apache Kafka as the messaging backbone for exactly these cases.

## 1. Architecture

=== "Before"

    ``` mermaid
    flowchart LR
        client[Client] -->|REST| gw[Gateway]
        gw -->|REST| order[order-service]
        order -->|REST sync| account[account-service]
        order -->|REST sync| product[product-service]
    ```

=== "After"

    ``` mermaid
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

Add Zookeeper, Kafka, and Kafka UI to `docker-compose.yml`. Kafka UI provides a browser-based interface for inspecting topics and messages during development.

=== "docker-compose.yml additions"

    ``` { .yaml .copy .select }
      zookeeper:
        image: confluentinc/cp-zookeeper:7.6.0
        environment:
          ZOOKEEPER_CLIENT_PORT: 2181

      kafka:
        image: confluentinc/cp-kafka:7.6.0
        depends_on:
          - zookeeper
        ports:
          - "9092:9092"
        environment:
          KAFKA_BROKER_ID: 1
          KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
          KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
          KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
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
    kafka-python==2.0.2
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

---

## 5. Testing

### 5.1 Start Everything

``` termynal
$ docker compose up --build -d
$ docker compose ps
NAME                    STATUS
kafka                   running
zookeeper               running
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

!!! warning "At-least-once delivery"

    Kafka guarantees at-least-once delivery — a message may be delivered more than once (e.g., after a consumer crash before commit). Your consumer logic should be **idempotent**: processing the same event twice must produce the same result as processing it once. For the notification service, this means checking whether an email was already sent for this `orderId` before sending again.

---

## 7. Checklist

- [ ] Kafka + Zookeeper + Kafka UI added to `docker-compose.yml`
- [ ] `OrderCreatedEvent` record created in order-service
- [ ] `spring-kafka` dependency added, `application.yaml` configured
- [ ] `OrderEventPublisher` publishes to `order-events` after save
- [ ] notification-service consumes events and logs confirmations
- [ ] Kafka UI shows the event after creating an order
- [ ] DLQ pattern understood (idempotent consumer)

[Next: Quiz](quiz.md){ .md-button .md-button--primary }
