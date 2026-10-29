A fan pays for two seats, the BoxOffice `order` service saves the order… and crashes before telling anybody. No ticket e-mail. Or the opposite: the event goes out, the database transaction rolls back, and a fan receives a ticket for an order that does not exist. Or the broker delivers the same event twice and the fan gets two e-mails — and later, two tickets. This is the **dual-write problem**, and every event-driven system has to solve it. In this exercise you solve it with a **transactional outbox**, an **idempotent consumer** and a **dead-letter topic**, and then you try hard to break it.

!!! abstract "Learning objectives"

    After this exercise you will be able to:

    - **Explain** why "save to the database, then publish to Kafka" loses or invents events, and how the outbox fixes it.
    - **Implement** a transactional outbox with a polling relay and an idempotent consumer with retries and a DLQ.
    - **Reason** about delivery semantics: at-least-once delivery + idempotent processing = effectively-once side effects.
    - **Verify** correctness under failures with a reconciliation query, and **measure** end-to-end latency and consumer lag.

## Context

[Class 8](../../classes/messaging/index.md) covered queues, pub/sub and the event log, Kafka's partitions and consumer groups, delivery semantics and the outbox/saga patterns[^1]. [Lab 7](../../hands-on/7/index.md) set up Kafka (KRaft) with BoxOffice's `order` and `notification` services. Here you make that flow **correct under failure** and prove it.

``` diagram-sim
flowchart LR
    client([k6]) -->|POST /orders| order[order]
    order -->|"1 · one transaction: order + outbox row"| odb[("order_svc<br/>orders · outbox")]
    relay[outbox relay] -->|"2 · poll unpublished rows"| odb
    relay -->|"3 · publish, key = orderId"| kafka{{"Kafka · order-events"}}
    kafka -->|"4 · consume"| notif[notification]
    notif -->|"5 · one transaction: processed_events + ticket_emails"| ndb[("notification_svc<br/>processed_events · ticket_emails")]
    notif -.->|"poison message after retries"| dlt{{"order-events.DLT"}}
```

Why each piece exists:

| Piece | Failure it handles |
|-|-|
| Outbox row in the **same transaction** as the order | Crash between "save" and "publish": the event is in the database, it will be published later |
| Relay marks a row as published **after** the broker ack | Broker down or relay crash: the row is retried (→ duplicates are possible: at-least-once) |
| `processed_events` insert in the **same transaction** as the side effect | Duplicate delivery: the second insert conflicts and the side effect is skipped |
| Retries with backoff, then **DLT** | Transient errors are retried; a poison message does not block the partition forever |
| Kafka key = `orderId` | All events of an order go to the same partition, in order |

## Task

Implement and verify the flow **order confirmed → ticket e-mail** for BoxOffice (or the equivalent flow of your own services):

1. `order` writes the order and an **outbox** row (event envelope) in **one transaction**.
2. A **relay** publishes unpublished outbox rows to the `order-events` topic (key = `orderId`) and marks them after the broker acknowledges.
3. `notification` consumes the events **idempotently** (deduplication by event id in the same transaction as the side effect), retries transient errors with backoff and sends **poison messages to a DLT**.
4. Run a **10-minute load** while injecting failures (relay crash, broker outage, consumer crash, duplicate event, poison message) and prove with a **reconciliation query** that there are **zero lost and zero duplicated** e-mails.
5. Measure **end-to-end latency** and **consumer lag**, with and without failures.

## Requirements

- [ ] **(mandatory)** Outbox row written in the **same transaction** as the business change (show the code).
- [ ] **(mandatory)** Idempotent consumer: deduplication by event id **in the same transaction** as the side effect.
- [ ] **(mandatory)** Reconciliation after the 10-minute run with failures: **0 lost** and **0 duplicated** side effects (query and its output in the report).
- [ ] Event envelope with at least `eventId`, `type`, `version`, `occurredAt` and the business key.
- [ ] Relay publishes with `acks=all` and marks rows only after the ack; the outbox returns to **0 unpublished rows** after the broker comes back (time measured).
- [ ] Retries with exponential backoff and a **DLT**; the poison message is in the DLT and the consumer keeps processing the next messages.
- [ ] Failure schedule executed during the load: relay/`order` crash, broker stopped ≥ 60 s, consumer killed (`SIGKILL`) mid-processing, one duplicated valid event, one poison message.
- [ ] End-to-end latency (order confirmed → side effect) p50/p95/p99, and consumer lag over time.
- [ ] A discussion of ordering (what the key guarantees and what it does not), and of the real e-mail (an external side effect outside your database).
- [ ] *AI usage* section (see the [policy](../index.md#use-of-ai-tools)).

## Deliverables

In your repository (tag `ex4`): code of both services, migrations, `compose.yaml`, k6 script, failure script, the reconciliation and latency queries and their outputs; an `event-driven` page on your documentation site following the [template](#templates).

## Step by step

### 1. Kafka (KRaft) and the schemas

Reuse the Kafka of Lab 7. For reference, a single-node KRaft broker with the official image:

```yaml title="compose.yaml (excerpt)"
services:
  kafka:
    image: apache/kafka:3.8.0
    environment:
      KAFKA_NODE_ID: 1
      KAFKA_PROCESS_ROLES: broker,controller
      KAFKA_LISTENERS: PLAINTEXT://:9092,CONTROLLER://:9093,EXTERNAL://:29092
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092,EXTERNAL://localhost:29092
      KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT,EXTERNAL:PLAINTEXT
      KAFKA_CONTROLLER_QUORUM_VOTERS: 1@kafka:9093
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: 1
      KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS: 0
    ports:
      - "29092:29092"
```

Each service owns its data. To make the reconciliation a single query, this exercise keeps both services in **one PostgreSQL instance with two schemas** (Compose service `postgres`, database `boxoffice`: `order_svc` and `notification_svc`), each service using only its own schema. In production they would be separate databases and the reconciliation a small job.

```sql title="order/src/main/resources/db/migration/V2__outbox.sql"
CREATE TABLE outbox (
    id             UUID PRIMARY KEY,
    aggregate_type VARCHAR(50)  NOT NULL,
    aggregate_id   VARCHAR(50)  NOT NULL,
    event_type     VARCHAR(100) NOT NULL,
    payload        JSONB        NOT NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    published_at   TIMESTAMPTZ
);
CREATE INDEX outbox_unpublished ON outbox (created_at) WHERE published_at IS NULL;
```

```sql title="notification/src/main/resources/db/migration/V1__notification.sql"
CREATE TABLE processed_events (
    event_id     UUID PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ticket_emails (
    id         BIGSERIAL PRIMARY KEY,
    order_id   UUID         NOT NULL,
    event_id   UUID         NOT NULL,
    recipient  VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

!!! warning "No unique constraint on `ticket_emails.order_id`"

    It is tempting to add one — and in production you might. Here, leave it out: the point is to show that **the consumer logic** prevents duplicates. A unique constraint would hide a broken consumer.

### 2. Write the order and the event together

```java title="order/src/main/java/boxoffice/order/OrderService.java"
package boxoffice.order;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OrderService {

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public OrderService(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Transactional
    public UUID confirm(NewOrder cmd) throws Exception {
        UUID orderId = UUID.randomUUID();
        Instant now = Instant.now();
        jdbc.update("""
            INSERT INTO orders (id, event_id, seats, customer_email, status, confirmed_at)
            VALUES (?, ?, ?, ?, 'CONFIRMED', ?)
            """, orderId, cmd.eventId(), cmd.seats(), cmd.customerEmail(), java.sql.Timestamp.from(now));

        UUID eventId = UUID.randomUUID();
        Map<String, Object> envelope = Map.of(
            "eventId", eventId.toString(),
            "type", "OrderConfirmed",
            "version", 1,
            "occurredAt", now.toString(),
            "orderId", orderId.toString(),
            "customerEmail", cmd.customerEmail(),
            "seats", cmd.seats());
        jdbc.update("""
            INSERT INTO outbox (id, aggregate_type, aggregate_id, event_type, payload)
            VALUES (?, 'order', ?, 'OrderConfirmed', ?::jsonb)
            """, eventId, orderId.toString(), json.writeValueAsString(envelope));
        return orderId; // both rows commit together, or neither does
    }
}
```

In this exercise an order is confirmed when it is created (the payment is out of scope); if your service has a separate confirm step, write the outbox row there.

### 3. The relay

A polling publisher reads unpublished rows, publishes each one and waits for the broker's acknowledgement before marking it. `FOR UPDATE SKIP LOCKED` lets you run a second relay without both publishing the same row at the same time.

```java title="order/src/main/java/boxoffice/order/OutboxRelay.java"
package boxoffice.order;

import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class OutboxRelay {

    private final JdbcTemplate jdbc;
    private final KafkaTemplate<String, String> kafka;

    public OutboxRelay(JdbcTemplate jdbc, KafkaTemplate<String, String> kafka) {
        this.jdbc = jdbc;
        this.kafka = kafka;
    }

    @Scheduled(fixedDelay = 200)   // requires @EnableScheduling on a configuration class
    @Transactional
    public void publishBatch() {
        List<Map<String, Object>> rows = jdbc.queryForList("""
            SELECT id, aggregate_id, payload::text AS payload
              FROM outbox
             WHERE published_at IS NULL
             ORDER BY created_at
             LIMIT 100
             FOR UPDATE SKIP LOCKED
            """);
        for (Map<String, Object> row : rows) {
            String key = (String) row.get("aggregate_id");
            String payload = (String) row.get("payload");
            kafka.send("order-events", key, payload).join();   // wait for the ack (acks=all)
            jdbc.update("UPDATE outbox SET published_at = now() WHERE id = ?", row.get("id"));
        }
    }
}
```

```yaml title="order/src/main/resources/application.yaml (excerpt)"
spring:
  kafka:
    bootstrap-servers: kafka:9092
    producer:
      acks: all
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.apache.kafka.common.serialization.StringSerializer
      properties:
        enable.idempotence: true
        delivery.timeout.ms: 30000
```

If the relay crashes after `send` and before the transaction commits, the row is published **again** on the next poll. That is fine — the consumer is idempotent. Change Data Capture with Debezium (reading the outbox from the PostgreSQL WAL) is an alternative relay; it is a good A-level extension.

### 4. The idempotent consumer, retries and the DLT

```java title="notification/src/main/java/boxoffice/notification/TicketEmailService.java"
package boxoffice.notification;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TicketEmailService {

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public TicketEmailService(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Transactional
    public void handle(String message) {
        JsonNode event = parse(message);
        UUID eventId = UUID.fromString(event.path("eventId").asText());
        int inserted = jdbc.update(
            "INSERT INTO processed_events (event_id) VALUES (?) ON CONFLICT DO NOTHING", eventId);
        if (inserted == 0) {
            return; // duplicate delivery: already processed, skip the side effect
        }
        jdbc.update("INSERT INTO ticket_emails (order_id, event_id, recipient) VALUES (?, ?, ?)",
            UUID.fromString(event.path("orderId").asText()), eventId, event.path("customerEmail").asText());
        // The real e-mail is sent from ticket_emails by a separate sender,
        // using event_id as the idempotency key with the e-mail provider.
    }

    private JsonNode parse(String message) {
        try {
            JsonNode event = json.readTree(message);
            if (!"OrderConfirmed".equals(event.path("type").asText()) || event.path("eventId").isMissingNode()) {
                throw new InvalidEventException("unexpected event: " + message);
            }
            return event;
        } catch (InvalidEventException e) {
            throw e;
        } catch (Exception e) {
            throw new InvalidEventException("malformed event: " + e.getMessage());
        }
    }
}
```

```java title="notification/src/main/java/boxoffice/notification/KafkaConfig.java"
package boxoffice.notification;

import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.common.TopicPartition;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.config.TopicBuilder;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.listener.DeadLetterPublishingRecoverer;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.kafka.support.ExponentialBackOffWithMaxRetries;
import org.springframework.stereotype.Component;

@Configuration
public class KafkaConfig {

    @Bean
    NewTopic orderEvents() {
        return TopicBuilder.name("order-events").partitions(3).replicas(1).build();
    }

    @Bean
    NewTopic orderEventsDlt() {
        return TopicBuilder.name("order-events.DLT").partitions(3).replicas(1).build();
    }

    // Picked up by Spring Boot's listener container factory.
    @Bean
    DefaultErrorHandler errorHandler(KafkaTemplate<String, String> template) {
        DeadLetterPublishingRecoverer recoverer = new DeadLetterPublishingRecoverer(template,
            (record, ex) -> new TopicPartition(record.topic() + ".DLT", record.partition()));
        ExponentialBackOffWithMaxRetries backOff = new ExponentialBackOffWithMaxRetries(3);
        backOff.setInitialInterval(500);
        backOff.setMultiplier(2.0);
        DefaultErrorHandler handler = new DefaultErrorHandler(recoverer, backOff);
        handler.addNotRetryableExceptions(InvalidEventException.class); // poison: straight to the DLT
        return handler;
    }

    @Component
    static class OrderEventsListener {
        private final TicketEmailService service;

        OrderEventsListener(TicketEmailService service) {
            this.service = service;
        }

        @KafkaListener(topics = "order-events", groupId = "notification")
        void onMessage(ConsumerRecord<String, String> record) {
            service.handle(record.value());
        }
    }
}
```

`InvalidEventException` is a plain `RuntimeException`. The consumer commits the offset only after `handle` returns (Spring Kafka's default `BATCH`/`RECORD` ack modes commit after the listener)[^2], so a crash in the middle means **redelivery** — which the `processed_events` table absorbs.

### 5. Load and failures

```javascript title="load/orders.js"
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:8081';

export const options = {
  scenarios: {
    orders: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 20), timeUnit: '1s',
      duration: __ENV.DURATION || '10m',
      preAllocatedVUs: 20, maxVUs: 200,
    },
  },
};

export default function () {
  const body = JSON.stringify({
    eventId: 1 + Math.floor(Math.random() * 100),
    seats: 1 + Math.floor(Math.random() * 4),
    customerEmail: `fan${__VU}-${__ITER}@example.com`,
  });
  const res = http.post(`${BASE}/orders`, body, { headers: { 'Content-Type': 'application/json' } });
  check(res, { 'order accepted': (r) => r.status === 201 });
}
```

```bash title="chaos/failures.sh"
#!/usr/bin/env bash
# Failure schedule, started together with the 10-minute k6 run.
set -x
sleep 90;  docker compose kill order;          sleep 20; docker compose start order
sleep 90;  docker compose stop kafka;          sleep 60; docker compose start kafka
sleep 90;  docker compose kill notification;   sleep 20; docker compose start notification
sleep 30
# a duplicate: publish again an event that was already published
docker compose exec -T postgres psql -U boxoffice -d boxoffice -tAc \
  "select aggregate_id || '|' || payload::text from order_svc.outbox where published_at is not null limit 1" \
  | docker compose exec -T kafka /opt/kafka/bin/kafka-console-producer.sh \
      --bootstrap-server kafka:9092 --topic order-events \
      --property parse.key=true --property key.separator='|'
# a poison message
echo 'poison|{"type":"OrderConfirmed","orderId":' \
  | docker compose exec -T kafka /opt/kafka/bin/kafka-console-producer.sh \
      --bootstrap-server kafka:9092 --topic order-events \
      --property parse.key=true --property key.separator='|'
```

```bash
k6 run load/orders.js & ./chaos/failures.sh; wait
```

Requests to `order` fail while it is down — that is expected (the k6 errors are not the point here). What must hold is: **every order that was accepted gets exactly one ticket e-mail**.

### 6. Verify and measure

```sql title="verify.sql"
-- lost: confirmed orders without exactly one ticket e-mail
SELECT o.id, count(t.id) AS emails
  FROM order_svc.orders o
  LEFT JOIN notification_svc.ticket_emails t ON t.order_id = o.id
 WHERE o.status = 'CONFIRMED'
 GROUP BY o.id
HAVING count(t.id) <> 1;

-- duplicated side effects
SELECT order_id, count(*) FROM notification_svc.ticket_emails GROUP BY order_id HAVING count(*) > 1;

-- outbox backlog (must return to 0)
SELECT count(*) AS unpublished FROM order_svc.outbox WHERE published_at IS NULL;

-- end-to-end latency in seconds: order confirmed -> ticket e-mail recorded
SELECT percentile_cont(ARRAY[0.5, 0.95, 0.99]) WITHIN GROUP (
         ORDER BY extract(epoch FROM t.created_at - o.confirmed_at)) AS p50_p95_p99
  FROM notification_svc.ticket_emails t
  JOIN order_svc.orders o ON o.id = t.order_id;
```

```bash
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server kafka:9092 --describe --group notification
docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server kafka:9092 --topic order-events.DLT --from-beginning --timeout-ms 5000
```

Sample the consumer lag every few seconds during the run (a loop around `kafka-consumer-groups.sh`, or the Kafka metrics of the observability stack in [Lab 8](../../hands-on/8/index.md)) to plot it over time: you should see it grow while `notification` is down and drain afterwards.

## Templates

=== "English"

    ~~~markdown
    # Event-driven — outbox and idempotent consumer

    ## 1. Flow and design
    Diagram; event envelope (fields and an example); topic, partitions, key; consumer group.

    ## 2. Why it is correct
    | Failure | What happens | Why nothing is lost or duplicated |
    |-|-|-|
    | order/relay crash after the commit | | |
    | broker down | | |
    | consumer crash mid-processing | | |
    | duplicate event | | |
    | poison message | | |

    ## 3. Run with failures
    Rate ... orders/s, 10 min. Failure timeline: T+90 s order killed, ...

    ## 4. Verification
    | Check | Result |
    |-|-|
    | Accepted orders | |
    | Lost (query 1) | 0 |
    | Duplicated (query 2) | 0 |
    | Outbox back to 0 unpublished after broker restart | ... s |
    | Poison message in the DLT | yes / no |

    ## 5. Latency and lag
    | | p50 | p95 | p99 |
    |-|-|-|-|
    | Without failures | | | |
    | With failures | | | |
    Consumer lag over time (chart) and explanation.

    ## 6. Discussion
    Ordering per key; exactly-once vs effectively-once; sending the real e-mail; outbox vs CDC.

    ## 7. AI usage
    ~~~

=== "Português"

    ~~~markdown
    # Orientado a eventos — outbox e consumidor idempotente

    ## 1. Fluxo e design
    Diagrama; envelope do evento (campos e um exemplo); tópico, partições, chave; grupo de consumidores.

    ## 2. Por que está correto
    | Falha | O que acontece | Por que nada se perde nem se duplica |
    |-|-|-|
    | queda do order/relay depois do commit | | |
    | broker fora do ar | | |
    | queda do consumidor no meio do processamento | | |
    | evento duplicado | | |
    | mensagem envenenada | | |

    ## 3. Execução com falhas
    Taxa ... pedidos/s, 10 min. Linha do tempo das falhas: T+90 s order derrubado, ...

    ## 4. Verificação
    | Verificação | Resultado |
    |-|-|
    | Pedidos aceitos | |
    | Perdidos (consulta 1) | 0 |
    | Duplicados (consulta 2) | 0 |
    | Outbox de volta a 0 não publicados depois do reinício do broker | ... s |
    | Mensagem envenenada na DLT | sim / não |

    ## 5. Latência e atraso
    | | p50 | p95 | p99 |
    |-|-|-|-|
    | Sem falhas | | | |
    | Com falhas | | | |
    Atraso do consumidor ao longo do tempo (gráfico) e explicação.

    ## 6. Discussão
    Ordem por chave; exactly-once vs effectively-once; envio do e-mail real; outbox vs CDC.

    ## 7. Uso de IA
    ~~~

## Rubric

Levels as defined in [How the exercises are graded](../index.md#how-the-exercises-are-graded).

| Criterion | I | D | C | B | A |
|-|-|-|-|-|-|
| Transactional outbox **(mandatory)** | Absent | Publish outside the transaction (dual write) | Outbox in the same transaction, relay marks after ack | Envelope versioned; relay safe with two instances | CDC (Debezium) relay compared with polling |
| Idempotent consumer **(mandatory)** | Absent | Dedup outside the side-effect transaction | Dedup by event id in the same transaction | Retention/cleanup of `processed_events` discussed | Real e-mail sender idempotent with the provider (key = event id) |
| Retries and DLT | — | No DLT, or poison blocks the partition | Backoff + DLT; consumer keeps going | Retryable vs non-retryable errors justified | DLT replay procedure documented and tested |
| Verification under failures **(mandatory)** | No proof | Some failures not executed | All five failures; 0 lost, 0 duplicated | Timeline of the run with outbox backlog and lag | Additional failure (e.g. network partition) tested |
| Measurements | — | Only averages | p50/p95/p99 end to end + lag | With vs without failures compared and explained | Lag predicted from rates (backlog ÷ drain rate) and checked |
| Discussion | — | Missing | Ordering and external side effect addressed | Trade-offs of exactly-once in Kafka vs idempotency | Clear statement of the guarantees of the whole flow |

## FAQ

??? question "Kafka has exactly-once semantics. Why do I need all this?"

    Kafka's transactions give exactly-once **inside Kafka** (consume → produce → commit offsets). Your side effects — a row in PostgreSQL, an e-mail — live outside Kafka. The robust recipe is at-least-once delivery plus idempotent processing, which makes the *effect* happen once.

??? question "Can I use `@TransactionalEventListener` instead of an outbox?"

    It publishes after the commit, but if the process dies between the commit and the publish, the event is lost — the dual-write problem again, only rarer. The outbox survives crashes because the event is in the database.

??? question "Will the relay publish events out of order?"

    With one relay and `ORDER BY created_at`, events are published in commit order (approximately). Kafka keeps the order **per partition**, and the key `orderId` puts all events of an order in the same partition. There is no global order across orders — and BoxOffice does not need one. Explain this in your discussion.

??? question "How long do I keep `processed_events`?"

    At least as long as a duplicate can arrive (retention of the topic, relay retries). In practice, days; then delete old rows with a scheduled job. Say what you would choose and why.

??? question "My consumer lag never goes down after the broker comes back."

    Check that the consumer reconnects (logs), that it is not stuck retrying a poison message (is the DLT configured?), and that the topic has as many partitions as you expect. `kafka-consumer-groups.sh --describe` shows the lag per partition.

??? question "The duplicate injection did not create a duplicate e-mail. Did it work?"

    That is the expected result. Prove that the duplicate **was delivered**: the consumer's log line for a skipped duplicate, or the count of consumed messages vs rows in `processed_events`.

[^1]: Chris Richardson, "Pattern: Transactional outbox", [microservices.io](https://microservices.io/patterns/data/transactional-outbox.html){target="_blank"}.
[^2]: Spring for Apache Kafka reference, "Handling exceptions" and "Publishing dead-letter records", [docs.spring.io/spring-kafka](https://docs.spring.io/spring-kafka/reference/){target="_blank"}.
