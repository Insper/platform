# 2. Transactional Outbox

The `order` service must do two things when a fan places an order: **store the order** in
PostgreSQL and **announce it** on Kafka. Two different systems, no shared transaction. This step
shows why the obvious code is wrong and builds the standard fix, the **transactional outbox**.

## The dual-write problem

``` diagram-sim
sequenceDiagram
    participant F as Fan
    participant O as order
    participant DB as PostgreSQL
    participant K as Kafka
    F->>O: POST /orders
    O->>DB: INSERT order + COMMIT
    DB-->>O: ok
    Note over O: crash, deploy or Kafka timeout here
    O--xK: publish OrderPlaced (never happens)
    O-->>F: 500 (but the order exists!)
```

Any order of the two writes has a failure window:

| Write order | Crash between the writes | Result |
|---|---|---|
| DB, then Kafka | order stored, event lost | no e-mail, and no other service ever hears of the order |
| Kafka, then DB | event published, DB insert fails | a *ghost* order: e-mail for an order that does not exist |
| Kafka inside a DB transaction | Kafka publish succeeds, commit fails | same ghost; Kafka cannot be rolled back by PostgreSQL |

The **outbox** removes the second system from the request: the service writes the event as a row in
an `outbox` table **in the same local transaction** as the order. Either both rows exist or neither.
A separate **relay** reads unpublished rows and publishes them, marking them as published only after
Kafka acknowledges.

``` diagram-sim
sequenceDiagram
    participant F as Fan
    participant O as order
    participant DB as PostgreSQL
    participant R as outbox relay
    participant K as Kafka
    F->>O: POST /orders
    O->>DB: BEGIN; INSERT orders; INSERT outbox; COMMIT
    O-->>F: 201 Created
    loop every 200 ms
        R->>DB: SELECT ... WHERE published_at IS NULL FOR UPDATE SKIP LOCKED
        R->>K: send (key = orderId), wait for acks=all
        K-->>R: ack
        R->>DB: UPDATE outbox SET published_at = now()
    end
```

If the relay crashes after Kafka's ack but before the `UPDATE`, the row is published again on the next
run: the outbox gives **at-least-once** publication. That is fine, because the consumer in
[step 3](../consumer/index.md) is idempotent and each event carries a unique `eventId`.

!!! tip "Polling relay or CDC?"

    The relay here **polls** the table — simple, no extra infrastructure, a few hundred milliseconds of
    delay. The alternative is **change data capture** (CDC): a tool such as Debezium reads the
    PostgreSQL write-ahead log and publishes each outbox insert, with lower delay and no polling load,
    at the cost of running and operating Kafka Connect. See the
    [patterns page](../../../classes/messaging/patterns/index.md) of the messaging class.

## The `order` service

A new Spring Boot service in `services/order/`, on port **8084**, serving everything under `/orders`. It
uses plain JDBC (`JdbcClient`) instead of JPA so that every statement of the transaction is visible.

```
services/order/
├── .dockerignore
├── Dockerfile
├── pom.xml
└── src/main/
    ├── java/boxoffice/order/
    │   ├── OrderApplication.java
    │   ├── OrderProperties.java
    │   ├── OrderController.java
    │   ├── OrderService.java
    │   ├── OrderRequest.java
    │   ├── OrderView.java
    │   ├── OrderEvent.java
    │   ├── NotificationClient.java
    │   └── outbox/
    │       ├── Outbox.java
    │       └── OutboxRelay.java
    └── resources/
        ├── application.yaml
        └── db/migration/V1__create_orders.sql
```

### Build files

=== "pom.xml"

    ``` xml title="services/order/pom.xml"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/pom.xml"
    ```

=== "Dockerfile"

    ``` dockerfile title="services/order/Dockerfile"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/Dockerfile"
    ```

=== ".dockerignore"

    ``` text title="services/order/.dockerignore"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/.dockerignore"
    ```

=== "application.yaml"

    ``` yaml title="services/order/src/main/resources/application.yaml"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/resources/application.yaml"
    ```

The producer uses Spring Boot's default `StringSerializer` for key and value: the outbox already
stores the event as JSON text, so the relay publishes it byte for byte. `acks: all` plus
`enable.idempotence: true` make the broker deduplicate the producer's own retries and keep their order
within a partition.

### Schema

``` sql title="services/order/src/main/resources/db/migration/V1__create_orders.sql"
--8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/resources/db/migration/V1__create_orders.sql"
```

`hold_id` is `UNIQUE`: one seat hold (from [lab 6](../../6/index.md)) can become at most one order.
That constraint is what makes `POST /orders` **idempotent** — a fan who double-clicks, or a gateway
that retries after a timeout, gets the same order back instead of a second one.

### Domain records

=== "OrderRequest.java"

    ``` java title="services/order/src/main/java/boxoffice/order/OrderRequest.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/OrderRequest.java"
    ```

=== "OrderView.java"

    ``` java title="services/order/src/main/java/boxoffice/order/OrderView.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/OrderView.java"
    ```

=== "OrderEvent.java"

    ``` java title="services/order/src/main/java/boxoffice/order/OrderEvent.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/OrderEvent.java"
    ```

=== "OrderProperties.java"

    ``` java title="services/order/src/main/java/boxoffice/order/OrderProperties.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/OrderProperties.java"
    ```

=== "OrderApplication.java"

    ``` java title="services/order/src/main/java/boxoffice/order/OrderApplication.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/OrderApplication.java"
    ```

### The transaction: order + outbox

The `NOTIFY_MODE` switch keeps the **"before"** version in the code so that you can measure both in
[step 5](../measure/index.md): `sync` calls `notification` over HTTP inside the request, `outbox`
writes the event row.

=== "OrderService.java"

    ``` java title="services/order/src/main/java/boxoffice/order/OrderService.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/OrderService.java"
    ```

=== "NotificationClient.java"

    ``` java title="services/order/src/main/java/boxoffice/order/NotificationClient.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/NotificationClient.java"
    ```

=== "OrderController.java"

    ``` java title="services/order/src/main/java/boxoffice/order/OrderController.java (step 2 version, replaced in step 4)"
    package boxoffice.order;

    import jakarta.validation.Valid;
    import java.net.URI;
    import java.util.UUID;
    import org.springframework.http.HttpStatus;
    import org.springframework.http.ResponseEntity;
    import org.springframework.web.bind.annotation.GetMapping;
    import org.springframework.web.bind.annotation.PathVariable;
    import org.springframework.web.bind.annotation.PostMapping;
    import org.springframework.web.bind.annotation.RequestBody;
    import org.springframework.web.bind.annotation.RequestMapping;
    import org.springframework.web.bind.annotation.RestController;
    import org.springframework.web.server.ResponseStatusException;

    @RestController
    @RequestMapping("/orders")
    public class OrderController {

        private final OrderService orders;

        public OrderController(OrderService orders) {
            this.orders = orders;
        }

        @PostMapping
        public ResponseEntity<OrderView> place(@Valid @RequestBody OrderRequest req) {
            OrderService.PlaceResult result = orders.place(req);
            if (!result.created()) {
                return ResponseEntity.ok(result.order());
            }
            return ResponseEntity.created(URI.create("/orders/" + result.order().id())).body(result.order());
        }

        @GetMapping("/{id}")
        public OrderView get(@PathVariable UUID id) {
            return orders.find(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        }
    }
    ```

`ON CONFLICT (hold_id) DO NOTHING` returns 0 rows when the hold was already ordered; the service then
returns the existing order with `200 OK` and **writes no event**. Under concurrency, PostgreSQL makes
the second insert wait for the first transaction and then skip — no race, no duplicate.

### The outbox and its relay

=== "Outbox.java"

    ``` java title="services/order/src/main/java/boxoffice/order/outbox/Outbox.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/outbox/Outbox.java"
    ```

=== "OutboxRelay.java"

    ``` java title="services/order/src/main/java/boxoffice/order/outbox/OutboxRelay.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/outbox/OutboxRelay.java"
    ```

Read the relay slowly; each line answers a failure question:

| Line | Failure it handles |
|---|---|
| `FOR UPDATE SKIP LOCKED` | two `order` replicas relaying at once: each locks different rows, none waits |
| `ORDER BY created_at` + key = `orderId` | events of the same order reach the same partition in commit order |
| `allOf(...).get(10, SECONDS)` | Kafka down or slow: the transaction rolls back, rows stay unpublished, the next run retries |
| `UPDATE ... published_at` after the acks | a crash before it republishes the batch (at-least-once) — never loses it |
| `purge()` | the table does not grow forever; published rows are kept one day for debugging |

## Add `order` to Compose and test

``` yaml title="docker-compose.yaml (excerpt)"
  order:
    build: ./services/order
    environment:
      DB_HOST: db
      DB_PORT: 5432
      DB_NAME: ${DB_NAME:-boxoffice}
      DB_USER: ${DB_USER:-boxoffice}
      DB_PASSWORD: ${DB_PASSWORD:-boxoffice}
      REDIS_HOST: redis
      KAFKA_BOOTSTRAP_SERVERS: kafka:9092
      NOTIFICATION_URL: http://notification:8086
      NOTIFY_MODE: ${NOTIFY_MODE:-outbox}            # outbox (after) | sync (before)
      ADMIT_PER_SECOND: ${ADMIT_PER_SECOND:-20}      # waiting-room admission rate
    ports:
      - "8084:8084"
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
      kafka-init:
        condition: service_completed_successfully
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 768M
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:8084/actuator/health/readiness || exit 1"]
      interval: 10s
      timeout: 3s
      start_period: 40s
      retries: 3
```

<!-- termynal -->

``` shell
> docker compose up -d --build order
> curl -s -X POST localhost:8084/orders -H 'Content-Type: application/json' \
    -d '{"showId":"show-42","holdId":"hold-0001","customerEmail":"ana@example.com","amount":350.00}'
{"id":"28cb9305-e1ce-4b49-aba7-665bb1b244b5","showId":"show-42","holdId":"hold-0001","customerEmail":"ana@example.com","amount":350.00,"status":"PENDING_PAYMENT","createdAt":"2026-10-18T17:55:45.063089Z"}
> docker compose logs order | grep relayed
order-1  | 2026-10-18T17:55:48.594Z  INFO 1 --- [order] [   scheduling-1] boxoffice.order.outbox.OutboxRelay       : relayed 1 event(s) to order-events
```

Open Kafka UI (`http://localhost:8089`) → **Topics → order-events → Messages**: the event is there,
with key = order id and the `eventId` and `eventType` headers.

Now prove the two guarantees:

1. **Idempotent request.** Send the same `curl` again: the response is `200` (not `201`) with the
   same `id`, and no new message appears in the topic.
2. **No lost event.** Stop Kafka, place an order, start Kafka again:

    ``` shell
    docker compose stop kafka
    curl -s -X POST localhost:8084/orders -H 'Content-Type: application/json' \
      -d '{"showId":"show-42","holdId":"hold-0002","customerEmail":"bia@example.com","amount":350.00}'
    docker compose exec db psql -U boxoffice -d boxoffice \
      -c "SELECT event_type, created_at, published_at FROM orders.outbox ORDER BY created_at DESC LIMIT 2;"
    docker compose start kafka
    ```

    You should see `201` for the order and, in the first query, the new row with an empty
    `published_at`. Wait until `docker compose ps kafka` says `healthy` again (about a minute) and run
    the query once more: `published_at` is now filled. In a test run:

    ``` text
     event_type  |          created_at           |         published_at
    -------------+-------------------------------+-------------------------------
     OrderPlaced | 2026-10-18 18:02:40.865762+00 | 2026-10-18 18:03:51.614915+00
     OrderPlaced | 2026-10-18 17:57:39.391694+00 | 2026-10-18 17:57:39.691802+00
    ```

    The order was accepted while Kafka was down and published 71 s later, when Kafka was back; the
    fan never saw the outage. Meanwhile `docker compose logs order` shows `ERROR … Unexpected error
    occurred in scheduled task` every few seconds: each relay run fails after `max.block.ms` (5 s)
    and the next one retries — expected.

!!! warning "Pitfalls"

    - **Publishing inside the HTTP request "after commit"** (e.g. `@TransactionalEventListener`) still
      loses the event if the process dies between the commit and the send. Only a durable outbox row
      survives a crash.
    - **Ordering across replicas.** With several relays, two events of the *same* order could be
      published by different replicas out of order. Here each order has one event at a time; if you
      emit several per order, relay per aggregate (e.g. `ORDER BY aggregate_id, created_at`) or use CDC.
    - **The outbox is not a queue for the world.** It is private to `order`; other services read the
      Kafka topic, never the table.

[Next: Idempotent consumer and DLT](../consumer/index.md){ .md-button .md-button--primary }
