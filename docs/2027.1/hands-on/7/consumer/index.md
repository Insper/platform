# 3. Idempotent Consumer and DLT

Kafka and the outbox both deliver **at least once**: a relay that crashes after the ack republishes a
batch; a consumer that crashes after sending the e-mail but before committing its offset receives the
message again; an operator who rewinds a consumer group replays hours of events. The `notification`
service must therefore make a duplicate **harmless**, and it must not let one bad message stop the
whole partition.

| Problem | Technique | Where in the code |
|---|---|---|
| the same event arrives twice | **idempotent consumer**: remember processed `eventId`s, in the same transaction as the effect | `NotificationService` |
| a transient failure (SMTP hiccup) | **retry with exponential backoff**, in place | `KafkaConfig` |
| a message that can never succeed (malformed, invalid address) | **dead-letter topic** (DLT): park it, keep the partition flowing | `KafkaConfig`, `DeadLetterListener` |

## The `notification` service

A Spring Boot service in `services/notification/`, port **8086**. It also keeps the legacy
`POST /notifications` endpoint that `order` calls in `NOTIFY_MODE=sync`, so both architectures can be
measured with the same code.

```
services/notification/
├── .dockerignore
├── Dockerfile
├── pom.xml
└── src/main/
    ├── java/boxoffice/notification/
    │   ├── NotificationApplication.java
    │   ├── NotificationProperties.java
    │   ├── OrderEvent.java
    │   ├── EmailSender.java
    │   ├── NotificationService.java
    │   ├── NotificationController.java
    │   ├── OrderEventListener.java
    │   ├── DeadLetterListener.java
    │   └── KafkaConfig.java
    └── resources/
        ├── application.yaml
        └── db/migration/V1__create_notification.sql
```

### Build files and schema

=== "pom.xml"

    ``` xml title="services/notification/pom.xml"
    --8<-- "docs/2027.1/hands-on/7/code/services/notification/pom.xml"
    ```

=== "Dockerfile"

    ``` dockerfile title="services/notification/Dockerfile"
    --8<-- "docs/2027.1/hands-on/7/code/services/notification/Dockerfile"
    ```

=== ".dockerignore"

    ``` text title="services/notification/.dockerignore"
    --8<-- "docs/2027.1/hands-on/7/code/services/notification/.dockerignore"
    ```

=== "application.yaml"

    ``` yaml title="services/notification/src/main/resources/application.yaml"
    --8<-- "docs/2027.1/hands-on/7/code/services/notification/src/main/resources/application.yaml"
    ```

=== "V1__create_notification.sql"

    ``` sql title="services/notification/src/main/resources/db/migration/V1__create_notification.sql"
    --8<-- "docs/2027.1/hands-on/7/code/services/notification/src/main/resources/db/migration/V1__create_notification.sql"
    ```

`sent_at` uses `clock_timestamp()` (the real time of the insert), not `now()` (the time the
*transaction* started): with the e-mail sent inside the transaction, `now()` would hide its latency.

### The event, the e-mail and the properties

=== "OrderEvent.java"

    ``` java title="services/notification/src/main/java/boxoffice/notification/OrderEvent.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/notification/src/main/java/boxoffice/notification/OrderEvent.java"
    ```

=== "EmailSender.java"

    ``` java title="services/notification/src/main/java/boxoffice/notification/EmailSender.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/notification/src/main/java/boxoffice/notification/EmailSender.java"
    ```

=== "NotificationProperties.java"

    ``` java title="services/notification/src/main/java/boxoffice/notification/NotificationProperties.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/notification/src/main/java/boxoffice/notification/NotificationProperties.java"
    ```

=== "NotificationApplication.java"

    ``` java title="services/notification/src/main/java/boxoffice/notification/NotificationApplication.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/notification/src/main/java/boxoffice/notification/NotificationApplication.java"
    ```

## Idempotency: dedupe in the same transaction as the effect

``` java title="services/notification/src/main/java/boxoffice/notification/NotificationService.java"
--8<-- "docs/2027.1/hands-on/7/code/services/notification/src/main/java/boxoffice/notification/NotificationService.java"
```

The order of operations is the whole point:

1. **Claim** the event: `INSERT ... ON CONFLICT DO NOTHING` on the primary key `event_id`. Zero rows
   means another delivery (or another consumer instance, concurrently) already claimed it → skip.
2. **Do the effect** — send the e-mail.
3. **Commit.** If step 2 throws, the claim is rolled back and the retry can try again.

One window remains: the e-mail is sent and then the commit fails (database down at that exact
instant). The redelivery will send a second e-mail. No consumer can make an **external** side
effect exactly-once on its own; the complete fix is an **idempotency key** accepted by the provider
(most e-mail and payment APIs take one — pass the `eventId`). Exactly-once *processing* inside Kafka
(transactions, `read_committed`) covers Kafka-to-Kafka pipelines, not e-mails.

!!! tip "In the interview"

    "Kafka gives at-least-once; I make consumers idempotent with a dedupe table keyed by event id,
    written in the same transaction as the effect, and pass the event id as the idempotency key to
    external providers." That sentence answers most "what about duplicates?" follow-ups.

## Listeners, retries and the dead-letter topic

=== "OrderEventListener.java"

    ``` java title="services/notification/src/main/java/boxoffice/notification/OrderEventListener.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/notification/src/main/java/boxoffice/notification/OrderEventListener.java"
    ```

=== "KafkaConfig.java"

    ``` java title="services/notification/src/main/java/boxoffice/notification/KafkaConfig.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/notification/src/main/java/boxoffice/notification/KafkaConfig.java"
    ```

=== "DeadLetterListener.java"

    ``` java title="services/notification/src/main/java/boxoffice/notification/DeadLetterListener.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/notification/src/main/java/boxoffice/notification/DeadLetterListener.java"
    ```

=== "NotificationController.java"

    ``` java title="services/notification/src/main/java/boxoffice/notification/NotificationController.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/notification/src/main/java/boxoffice/notification/NotificationController.java"
    ```

How a failing record flows:

``` diagram-sim
sequenceDiagram
    participant K as order-events (partition 3)
    participant L as listener
    participant H as DefaultErrorHandler
    participant D as order-events-dlt (partition 3)
    K->>L: offset 41
    L--xH: MailSendException (transient)
    H->>L: retry after 0.5 s
    L--xH: fails again
    H->>L: retry after 1 s, then 2 s
    L--xH: still failing
    H->>D: publish the record + exception headers
    H->>K: commit offset 42, move on
    K->>L: offset 42 (the partition flows again)
```

- **Retries happen in place**, blocking only *that* partition for at most 0.5 + 1 + 2 = 3.5 s; the
  other partitions keep flowing on the other consumer threads.
- **Non-retryable exceptions skip the backoff**: a malformed JSON or a rejected address goes to the
  DLT immediately.
- Spring Boot plugs the single `CommonErrorHandler` bean into its listener container factory; no
  extra wiring is needed.

!!! info "Blocking vs non-blocking retries"

    Spring Kafka also offers `@RetryableTopic`: failed records go to `order-events-retry-0`,
    `-retry-1`… topics with delays, so the main partition is **never** blocked. The price is more
    topics and **no ordering** between a retried event and later events of the same key. For e-mails,
    blocking a few seconds is fine; for high-volume streams, non-blocking retries are common.

## Add `notification` to Compose and test

``` yaml title="docker-compose.yaml (excerpt)"
  notification:
    build: ./services/notification
    environment:
      DB_HOST: db
      DB_PORT: 5432
      DB_NAME: ${DB_NAME:-boxoffice}
      DB_USER: ${DB_USER:-boxoffice}
      DB_PASSWORD: ${DB_PASSWORD:-boxoffice}
      KAFKA_BOOTSTRAP_SERVERS: kafka:9092
      MAIL_HOST: mailpit
      NOTIFY_CONCURRENCY: ${NOTIFY_CONCURRENCY:-3}   # consumer threads (max useful: 6 partitions)
      EMAIL_LATENCY: ${EMAIL_LATENCY:-50ms}          # simulated e-mail provider latency
      NOTIFY_IDEMPOTENT: ${NOTIFY_IDEMPOTENT:-true}  # false = no dedupe (to see duplicates)
    ports:
      - "8086:8086"
    depends_on:
      db:
        condition: service_healthy
      mailpit:
        condition: service_started
      kafka-init:
        condition: service_completed_successfully
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 768M
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:8086/actuator/health/readiness || exit 1"]
      interval: 10s
      timeout: 3s
      start_period: 40s
      retries: 3
```

<!-- termynal -->

``` shell
> docker compose up -d --build --wait notification
> docker compose logs notification | grep -i "dead letter"
notification-1  | ... b.notification.DeadLetterListener        : dead letter at order-events-dlt-4@0: java.lang.IllegalArgumentException
notification-1  | ... b.notification.DeadLetterListener        : dead letter at order-events-dlt-3@0: java.lang.IllegalArgumentException
notification-1  | ... b.notification.DeadLetterListener        : dead letter at order-events-dlt-4@1: java.lang.IllegalArgumentException
> curl -s localhost:8025/api/v1/messages | jq '.total'
2
```

What happened, in order:

1. The group `notification` is new, so it starts at the **earliest** offset and meets the three
   tour messages from [step 1](../kafka/index.md) first: they are not BoxOffice events →
   `IllegalArgumentException` → straight to the DLT, without blocking the real events behind them.
2. The two real `OrderPlaced` events (holds `0001` and `0002`) produce **two e-mails** in Mailpit
   (`http://localhost:8025`).

### Experiment: replay without duplicates

Rewind the whole group and let it consume everything again:

``` shell
docker compose stop notification
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka:9092 \
  --group notification --topic order-events --reset-offsets --to-earliest --execute
docker compose start --wait notification
docker compose logs notification | grep duplicate
curl -s localhost:8025/api/v1/messages | jq '.total'
```

The logs show `duplicate event ... ignored` for each order and Mailpit still has **2** e-mails. Run
`NOTIFY_IDEMPOTENT=false docker compose up -d --wait notification`, repeat the first three commands and
count again: every replay sends every e-mail again. Turn the dedupe back on with
`docker compose up -d --wait notification` before you go on.

### Experiment: a poison order { #experiment-a-poison-order }

``` shell
curl -s -X POST localhost:8084/orders -H 'Content-Type: application/json' \
  -d '{"showId":"show-42","holdId":"hold-0003","customerEmail":"poison@example.com","amount":350.00}'
docker compose exec db psql -U boxoffice -d boxoffice \
  -c "SELECT topic, partition, record_offset, reason FROM notification.dead_letters;"
```

The order succeeds (the fan is not affected), the e-mail fails permanently, and the record lands in
`order-events-dlt`: after a second or two, the query's last row is the poison order (the rows before
it are the tour messages, once per pass of the group over the topic); open it in Kafka UI and look
at the `kafka_dlt-*` headers (original topic, partition, offset, exception).

!!! warning "A DLT nobody reads is a silent data loss"

    Every dead letter is a customer who did not get an e-mail. In production: alert on DLT growth
    ([lab 8](../../8/index.md)), fix the cause, then **replay** the records back to `order-events`
    (a small tool or `kafka-console-consumer | kafka-console-producer` with the original keys). Replay
    is safe precisely because the consumer is idempotent.

[Next: Waiting room](../waiting-room/index.md){ .md-button .md-button--primary }
