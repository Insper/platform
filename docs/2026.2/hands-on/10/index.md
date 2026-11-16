# 10. Kafka Messaging

!!! info "Goal"

    Add asynchronous messaging to the platform with Apache Kafka. First the **reference pair** of the class: a `producer-service` that publishes what it receives on `GET /producer/{msg}` to the topic `store-producer-example`, and a `consumer-service` that reads that topic — two Spring Boot services that never call each other. Then the same pattern **in the store**: the order-service publishes an `OrderCreated` event to `order-events`, and a `notification-service` consumes it and sends the confirmation email, without the order-service knowing it exists.

The platform uses synchronous REST calls for every interaction between services. Every call the order-service makes — to account-service, to product-service — happens inline, before the response goes back to the client. That fits operations whose caller needs the result now. Others are fire-and-forget: sending the confirmation email of an order does not need to block the customer. Apache Kafka is the messaging backbone for these cases: a producer appends a message to a **topic**, a durable log, and answers at once; the consumers read the log on their own time.

## Slides

<div class="slides-embed">
  <iframe src="slides/kafka.html" title="Slides: kafka messaging" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/kafka.html){:target="_blank"}

## 1. Architecture

=== "Reference: producer → consumer"

    ``` mermaid-sim
    flowchart LR
        client[Client] -->|"GET /producer/{msg}"| gw[Gateway]
        gw -->|REST| producer[producer-service]
        producer -->|"send\nstore-producer-example"| kafka[(Kafka)]
        kafka -->|"@KafkaListener\ngroup store"| consumer[consumer-service]
    ```

=== "In the store: order → notification"

    ``` mermaid-sim
    flowchart LR
        client[Client] -->|"POST /orders"| gw[Gateway]
        gw -->|REST| order[order-service]
        order -->|REST sync| account[account-service]
        order -->|REST sync| product[product-service]
        order -->|"Kafka (async)\norder-events"| kafka[(Kafka)]
        kafka -->|"Kafka (async)\nnotification-group"| notification[notification-service]
    ```

!!! tip "Decoupling"

    The producer publishes to a topic; it has no knowledge of who reads it. The `producer-service` never calls the `consumer-service`, and the order-service never calls the notification-service. Tomorrow an analytics-service can read `order-events` too, in a group of its own, without touching a single line of the order-service.

| Piece | Reference (sections 2–5) | In the store (sections 6–8) |
|---|---|---|
| Producer | `producer-service`, `GET /producer/{msg}` | order-service, after saving an order |
| Topic | `store-producer-example` | `order-events` |
| Key | none | the order id |
| Consumer | `consumer-service`, group `store` | `notification-service`, group `notification-group` |
| Message | `{"id": "…", "message": "…"}` | `{"id": "…", "idAccount": "…", "total": "…"}` |

---

## 2. Kafka in Docker Compose

Add the broker and the two reference services to the `compose.yaml` of the platform (the `api/` folder, next to the other services). A single Kafka 4 node runs in **KRaft** mode — no ZooKeeper container.

``` { .yaml .copy .select title="compose.yaml (additions)" }
--8<-- "docs/2026.2/hands-on/10/code/compose.yaml"
```

!!! info "KRaft — no ZooKeeper"

    Kafka keeps its cluster metadata (topics, partitions, leaders) in its own Raft-based controller quorum, **KRaft**. Before, this metadata lived in a separate ZooKeeper ensemble; Kafka 4.0 (2025) removed ZooKeeper support entirely. Here the single node is both broker and controller (`KAFKA_PROCESS_ROLES: broker,controller`): clients talk to the `PLAINTEXT` listener on `kafka:9092`, and the controller quorum uses the `CONTROLLER` listener on port 9093. See [Event-Driven Architecture](../../classes/event_driven/index.md).

- `KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092` is the address the broker hands to clients: the service name inside the Docker network. Inside a container, `localhost:9092` is the container itself, not the broker — and the broker publishes no port to your machine, so every Kafka command below runs **inside** the `kafka` container.
- A single broker cannot keep more than one copy of the internal topics: hence the three `…_REPLICATION_FACTOR: 1` / `MIN_ISR: 1`.
- A topic is **created on first use** (the broker's `auto.create.topics.enable` is `true` by default) with `KAFKA_NUM_PARTITIONS: 1` partition. Section 7 adds partitions.
- `KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS: 0` lets a consumer group start at once instead of waiting 3 s for more members — convenient in development.

!!! tip "Pin the image"

    `apache/kafka:latest` follows the newest release (Kafka 4.3.1 when this page was written). For a reproducible build, pin the version: `image: apache/kafka:4.3.1`.

---

## 3. The producer-service

A Spring Boot service with two endpoints: `GET /producer/health-check` answers `200` for the orchestrator, and `GET /producer/{msg}` wraps the text in a small JSON with a random id and publishes it to `store-producer-example`.

```
api/
    producer-service/
        src/main/java/store/kafka/producer/
            KafkaProducerConfig.java
            ProducerResource.java
            ProducerService.java
            ProducerServiceApplication.java
        src/main/resources/application.yaml
        Dockerfile
        pom.xml
```

=== "ProducerService.java"

    ``` { .java .copy .select linenums="1" title="producer-service/src/main/java/store/kafka/producer/ProducerService.java" }
    --8<-- "docs/2026.2/hands-on/10/code/producer-service/src/main/java/store/kafka/producer/ProducerService.java"
    ```

=== "KafkaProducerConfig.java"

    ``` { .java .copy .select linenums="1" title="producer-service/src/main/java/store/kafka/producer/KafkaProducerConfig.java" }
    --8<-- "docs/2026.2/hands-on/10/code/producer-service/src/main/java/store/kafka/producer/KafkaProducerConfig.java"
    ```

=== "ProducerResource.java"

    ``` { .java .copy .select linenums="1" title="producer-service/src/main/java/store/kafka/producer/ProducerResource.java" }
    --8<-- "docs/2026.2/hands-on/10/code/producer-service/src/main/java/store/kafka/producer/ProducerResource.java"
    ```

=== "ProducerServiceApplication.java"

    ``` { .java .copy .select linenums="1" title="producer-service/src/main/java/store/kafka/producer/ProducerServiceApplication.java" }
    --8<-- "docs/2026.2/hands-on/10/code/producer-service/src/main/java/store/kafka/producer/ProducerServiceApplication.java"
    ```

=== "application.yaml"

    ``` { .yaml .copy .select linenums="1" title="producer-service/src/main/resources/application.yaml" }
    --8<-- "docs/2026.2/hands-on/10/code/producer-service/src/main/resources/application.yaml"
    ```

=== "pom.xml"

    ``` { .xml .copy .select linenums="1" title="producer-service/pom.xml" }
    --8<-- "docs/2026.2/hands-on/10/code/producer-service/pom.xml"
    ```

=== "Dockerfile"

    ``` { .dockerfile .copy .select linenums="1" title="producer-service/Dockerfile" }
    --8<-- "docs/2026.2/hands-on/10/code/producer-service/Dockerfile"
    ```

- **`KafkaProducerConfig`** builds the `ProducerFactory` (where the broker is, how to turn key and value into bytes: `StringSerializer` for both) and the `KafkaTemplate`, the object the code sends with.
- **`ProducerService`** turns the map into JSON with Jackson's `ObjectMapper` and calls `kafkaTemplate.send(topic, value)`. There is **no key**: section 7 shows what that means for partitions.
- **`send` is asynchronous**: it hands the record to the client's buffer and returns a `CompletableFuture`; the `200` of the endpoint means "handed to the Kafka client", not "stored in Kafka". Since Kafka 3.0 the producer's defaults are already the safe ones — `acks=all` (the leader waits for every in-sync replica) and idempotence on (a retry never writes a duplicate) — so the factory sets only the address and the serializers.

``` mermaid-sim
sequenceDiagram
    participant C as Client
    participant G as Gateway
    participant P as producer-service
    participant K as Kafka (store-producer-example)
    participant S as consumer-service
    C->>G: GET /producer/hello
    G->>P: GET /producer/hello (open route, no cookie)
    P->>K: send(store-producer-example, {"id": "…", "message": "hello"})
    P-->>C: 200 OK (does not wait for any consumer)
    K->>S: the record, on the next poll
    S->>S: log enqueue {…}
    S->>K: commit the offset
```

### 3.1 Through the gateway

Add the route to the gateway's `application.yaml`, next to the others:

``` { .yaml .copy .select title="gateway-service/src/main/resources/application.yaml" }
            - id: producer-service
              uri: http://producer:8080
              predicates:
                - Path=/producer/**
```

and open it in the `RouterValidator` (see [Hands-on 3](../3/authorization/index.md)), so that it needs no login:

``` { .java .copy .select title="gateway-service/src/main/java/store/gateway/security/RouterValidator.java" }
    private List<String> openApiEndpoints = List.of(
            "GET /producer/**",
            "POST /auth/register",
            "GET /auth/logout",
            "POST /auth/login"
        );
```

!!! warning "An open route is a demo"

    `GET /producer/**` lets anyone publish to the topic — fine for the reference, never for real events. And a `GET` that changes state breaks HTTP semantics: a crawler or a browser prefetch would publish messages. In the store, the event comes out of `POST /orders`, a secured route.

---

## 4. The consumer-service

```
api/
    consumer-service/
        src/main/java/store/kafka/consumer/
            ConsumerResource.java
            ConsumerService.java
            ConsumerServiceApplication.java
            KafkaConsumerConfig.java
        src/main/resources/application.yaml
        Dockerfile
        pom.xml
```

=== "ConsumerService.java"

    ``` { .java .copy .select linenums="1" title="consumer-service/src/main/java/store/kafka/consumer/ConsumerService.java" }
    --8<-- "docs/2026.2/hands-on/10/code/consumer-service/src/main/java/store/kafka/consumer/ConsumerService.java"
    ```

=== "ConsumerResource.java"

    ``` { .java .copy .select linenums="1" title="consumer-service/src/main/java/store/kafka/consumer/ConsumerResource.java" }
    --8<-- "docs/2026.2/hands-on/10/code/consumer-service/src/main/java/store/kafka/consumer/ConsumerResource.java"
    ```

=== "KafkaConsumerConfig.java"

    ``` { .java .copy .select linenums="1" title="consumer-service/src/main/java/store/kafka/consumer/KafkaConsumerConfig.java" }
    --8<-- "docs/2026.2/hands-on/10/code/consumer-service/src/main/java/store/kafka/consumer/KafkaConsumerConfig.java"
    ```

=== "ConsumerServiceApplication.java"

    ``` { .java .copy .select linenums="1" title="consumer-service/src/main/java/store/kafka/consumer/ConsumerServiceApplication.java" }
    --8<-- "docs/2026.2/hands-on/10/code/consumer-service/src/main/java/store/kafka/consumer/ConsumerServiceApplication.java"
    ```

=== "application.yaml"

    ``` { .yaml .copy .select linenums="1" title="consumer-service/src/main/resources/application.yaml" }
    --8<-- "docs/2026.2/hands-on/10/code/consumer-service/src/main/resources/application.yaml"
    ```

=== "pom.xml"

    ``` { .xml .copy .select linenums="1" title="consumer-service/pom.xml" }
    --8<-- "docs/2026.2/hands-on/10/code/consumer-service/pom.xml"
    ```

=== "Dockerfile"

    ``` { .dockerfile .copy .select linenums="1" title="consumer-service/Dockerfile" }
    --8<-- "docs/2026.2/hands-on/10/code/consumer-service/Dockerfile"
    ```

- **`@KafkaListener(topics = "store-producer-example", groupId = "store")`**: Spring runs a listener container that polls the topic and calls the method once per record. The method never calls `poll()` nor `commit()`.
- **The group** (`store`) is the consumer's identity in Kafka: the broker keeps, per group and per partition, the **committed offset** — the next record the group will read. Another group reading the same topic gets every message again, at its own offsets.
- **When the offset is committed**: the container sets `enable.auto.commit=false` and, by default (`AckMode.BATCH`), commits after the method has returned for every record of a poll. A crash in the middle means those records come again: **at-least-once** (section 8).
- `pom.xml` is the producer's with `<artifactId>consumer-service</artifactId>`: a copy that keeps `producer-service` builds a jar with the wrong name.

---

## 5. Run the reference

Build both jars (the `Dockerfile` copies `target/*.jar`), then start the stack:

``` { .bash .copy .select }
cd api/producer-service && mvn clean package -DskipTests && cd ../..
cd api/consumer-service && mvn clean package -DskipTests && cd ../..
cd api
docker compose up -d --build
```

Send two messages through the gateway (the load balancer on port 8080):

``` termynal
$ curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/producer/hello
200
$ curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/producer/world
200
```

You should see each message twice — published by the producer, read by the consumer:

``` termynal
$ docker compose logs producer | grep queue
producer-1  | … DEBUG 1 --- [producer] [nio-8080-exec-1] store.kafka.producer.ProducerService     : queue {id=e29517a4-e00a-4ff6-9d0b-b64825763623, message=hello}
producer-1  | … DEBUG 1 --- [producer] [nio-8080-exec-3] store.kafka.producer.ProducerService     : queue {id=139b7a01-76ee-4fc4-9b65-a15467e35c81, message=world}
$ docker compose logs consumer | grep -E "assigned|enqueue"
consumer-1  | … INFO 1 --- [consumer] [ntainer#0-0-C-1] o.s.k.l.KafkaMessageListenerContainer    : store: partitions assigned: [store-producer-example-0]
consumer-1  | … DEBUG 1 --- [consumer] [ntainer#0-0-C-1] store.kafka.consumer.ConsumerService     : enqueue {id=e29517a4-e00a-4ff6-9d0b-b64825763623, message=hello}
consumer-1  | … DEBUG 1 --- [consumer] [ntainer#0-0-C-1] store.kafka.consumer.ConsumerService     : enqueue {id=139b7a01-76ee-4fc4-9b65-a15467e35c81, message=world}
```

(The order of `id` and `message` in the producer's line may differ: `Map.of` has no fixed order.)

### 5.1 Look inside Kafka

The broker ships its command-line tools in `/opt/kafka/bin`. The topic, created on first use with one partition:

``` termynal
$ docker compose exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --describe --topic store-producer-example
Topic: store-producer-example	TopicId: FMKKtZWTTTWB-zZHi-aYOA	PartitionCount: 1	ReplicationFactor: 1	Configs: min.insync.replicas=1
	Topic: store-producer-example	Partition: 0	Leader: 1	Replicas: 1	Isr: 1	Elr: 	LastKnownElr: 
```

The messages are still there after being read — a consumer only moves its offset:

``` termynal
$ docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server kafka:9092 --topic store-producer-example --from-beginning --max-messages 2 --formatter-property print.partition=true --formatter-property print.offset=true
Partition:0	Offset:0	{"id":"e29517a4-e00a-4ff6-9d0b-b64825763623","message":"hello"}
Partition:0	Offset:1	{"id":"139b7a01-76ee-4fc4-9b65-a15467e35c81","message":"world"}
Processed a total of 2 messages
```

And the group: where `store` is, per partition. **Lag** is the log-end offset minus the committed offset — the messages waiting.

``` { .bash .copy .select }
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --group store
```

### 5.2 The consumer was down

Stop the consumer, publish three messages and look at the group:

``` termynal
$ docker compose stop consumer
$ for m in a b c; do curl -s -o /dev/null http://localhost:8080/producer/$m; done
$ docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --group store
Consumer group 'store' has no active members.

GROUP  TOPIC                  PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG  CONSUMER-ID  HOST  CLIENT-ID
store  store-producer-example 0          2               5               3    -            -     -
```

The producer did not notice — it answered `200` three times. Start the consumer again: it resumes at offset 2 and logs `enqueue` for `a`, `b` and `c`; `--describe` shows lag `0`. With REST, those three calls would have failed; with a log in between, the consumer simply catches up.

!!! failure "Troubleshooting"

    | Symptom | Cause and fix |
    |---|---|
    | `Connection to node -1 (kafka/…:9092) could not be established` in the first seconds | the broker is still starting; the client retries on its own |
    | `{store-producer-example=UNKNOWN_TOPIC_OR_PARTITION}` once, at start | the topic does not exist yet; it is created on that first request |
    | `401` on `/producer/hello` | the route is missing from `openApiEndpoints` in the `RouterValidator` |
    | `404` on `/producer/hello` | the gateway has no `producer-service` route, or the gateway was not rebuilt |
    | `COPY target/*.jar` fails in the build | run `mvn clean package` in that service first |
    | the consumer jar is called `producer-service-1.0.0.jar` | the consumer's `pom.xml` still has the producer's `artifactId` |

---

## 6. In the store: order-events

The reference shows the mechanics; now the platform uses them. When an order is saved, the order-service publishes `OrderCreated` to `order-events`; a new `notification-service`, written exactly like the `consumer-service`, sends the confirmation email (here: a log line).

### 6.1 The order-service publishes

Add `spring-kafka` to the order-service's `pom.xml` and the broker to its `application.yaml`:

``` { .xml .copy .select title="order-service/pom.xml" }
<dependency>
    <groupId>org.springframework.kafka</groupId>
    <artifactId>spring-kafka</artifactId>
</dependency>
```

``` { .yaml .copy .select title="order-service/src/main/resources/application.yaml" }
spring:
  kafka:
    bootstrap-servers: kafka:9092
```

Then two classes in the order-service's package — the producer's `KafkaProducerConfig` unchanged (only the package), and a publisher like the `ProducerService`, now **with a key**:

=== "OrderEventPublisher.java"

    ``` { .java .copy .select linenums="1" title="order-service/src/main/java/store/order/OrderEventPublisher.java" }
    --8<-- "docs/2026.2/hands-on/10/code/order-service/src/main/java/store/order/OrderEventPublisher.java"
    ```

=== "KafkaProducerConfig.java"

    ``` { .java .copy .select linenums="1" title="order-service/src/main/java/store/order/KafkaProducerConfig.java" }
    --8<-- "docs/2026.2/hands-on/10/code/order-service/src/main/java/store/order/KafkaProducerConfig.java"
    ```

In `OrderService`, inject the publisher and call it **after** the order is saved — never announce an order that does not exist (adapt the accessors to your `Order`):

``` { .java .copy .select title="order-service: OrderService.java" }
@Autowired
private OrderEventPublisher orderEventPublisher;

// in create(), after saving:
orderEventPublisher.orderCreated(order.id(), idAccount, order.total());
```

### 6.2 The notification-service

A copy of the `consumer-service` with four changes: the package, the health-check path (`/notification/health-check`), the group (`notification-group`) and the listener, which reads `order-events`.

```
api/
    notification-service/
        src/main/java/store/notification/
            KafkaConsumerConfig.java
            NotificationResource.java
            NotificationService.java
            NotificationServiceApplication.java
        src/main/resources/application.yaml
        Dockerfile
        pom.xml
```

=== "NotificationService.java"

    ``` { .java .copy .select linenums="1" title="notification-service/src/main/java/store/notification/NotificationService.java" }
    --8<-- "docs/2026.2/hands-on/10/code/notification-service/src/main/java/store/notification/NotificationService.java"
    ```

=== "NotificationResource.java"

    ``` { .java .copy .select linenums="1" title="notification-service/src/main/java/store/notification/NotificationResource.java" }
    --8<-- "docs/2026.2/hands-on/10/code/notification-service/src/main/java/store/notification/NotificationResource.java"
    ```

=== "KafkaConsumerConfig.java"

    ``` { .java .copy .select linenums="1" title="notification-service/src/main/java/store/notification/KafkaConsumerConfig.java" }
    --8<-- "docs/2026.2/hands-on/10/code/notification-service/src/main/java/store/notification/KafkaConsumerConfig.java"
    ```

=== "NotificationServiceApplication.java"

    ``` { .java .copy .select linenums="1" title="notification-service/src/main/java/store/notification/NotificationServiceApplication.java" }
    --8<-- "docs/2026.2/hands-on/10/code/notification-service/src/main/java/store/notification/NotificationServiceApplication.java"
    ```

=== "application.yaml"

    ``` { .yaml .copy .select linenums="1" title="notification-service/src/main/resources/application.yaml" }
    --8<-- "docs/2026.2/hands-on/10/code/notification-service/src/main/resources/application.yaml"
    ```

=== "pom.xml"

    ``` { .xml .copy .select linenums="1" title="notification-service/pom.xml" }
    --8<-- "docs/2026.2/hands-on/10/code/notification-service/pom.xml"
    ```

=== "Dockerfile"

    ``` { .dockerfile .copy .select linenums="1" title="notification-service/Dockerfile" }
    --8<-- "docs/2026.2/hands-on/10/code/notification-service/Dockerfile"
    ```

``` { .yaml .copy .select title="compose.yaml (addition)" }
--8<-- "docs/2026.2/hands-on/10/code/compose.notification.yaml"
```

### 6.3 Create an order

Build the order-service and the notification-service (`mvn clean package -DskipTests` in each), `docker compose up -d --build`, log in and create an order (see [Hands-on 3](../3/authorization/index.md) for the cookie):

``` { .bash .copy .select }
curl -c cookies.txt -X POST http://localhost:8080/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "acme@insper.edu.br", "password": "123@321"}'
curl -b cookies.txt -X POST http://localhost:8080/orders \
  -H "Content-Type: application/json" \
  -d '{"items": [{"idProduct": "0195abfb-7074-73a9-9d26-b4b9fbaab0a8", "quantity": 2}]}'
```

The order comes back with `201` at once. You should see the email in the notification-service:

``` termynal
$ docker compose logs notification | grep NotificationService
notification-1  | … INFO 1 --- [notification] [ntainer#0-0-C-1] store.notification.NotificationService   : sending confirmation email: order 0195ac33-73e5-7cb3-90ca-7b5e7e549569 (account 0195abf8-…, total 20.24)
```

The request goes like this — the synchronous part for the customer, the email later, on the consumer's own time:

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
    O->>K: send(order-events, key = order id, event)
    O-->>C: 201 CREATED (does not wait for the email)
    K->>N: OrderCreated, on the next poll
    N->>N: log the confirmation email
    N->>K: commit the offset
```

---

## 7. Partitions and consumer groups

A topic is split into **partitions**. A record with a key goes to partition `hash(key) % partitions` (murmur2), so all events of one order stay in order in one partition. Inside a consumer group, each partition is read by **one** member at a time, and Kafka keeps the committed offset per partition. When a member joins or leaves, the group **rebalances**: partitions change owner, and the new owner resumes at the committed offset.

`order-events` was created with `KAFKA_NUM_PARTITIONS: 1`. Start a second notification-service and look at the group:

``` { .bash .copy .select }
docker compose up -d --scale notification=2
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --group notification-group --members
```

One member shows `#PARTITIONS 1`, the other `0`: the second instance is in the group with nothing to read. Add partitions — Kafka can add them, never remove them:

``` { .bash .copy .select }
docker compose exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --alter --topic order-events --partitions 3
```

Once the clients refresh their metadata (up to five minutes, `metadata.max.age.ms`; `docker compose restart notification order` makes it immediate), the group rebalances: one instance reads partitions 0 and 1, the other partition 2 (the range assignor, the Java client's first strategy). Create a few orders and run `--describe` again: each partition shows its `CURRENT-OFFSET`, `LOG-END-OFFSET` and `LAG`.

``` mermaid-sim
flowchart LR
    os["order-service\nkey = order id"]
    subgraph topic ["order-events"]
        p0["partition 0"]
        p1["partition 1"]
        p2["partition 2"]
    end
    subgraph group ["notification-group"]
        n1["notification-1"]
        n2["notification-2"]
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

!!! example "Without a key, partitions do not spread the work"

    Do the same with the reference: `--partitions 3` on `store-producer-example`, `docker compose up -d --scale consumer=2`, restart both services and send nine messages with `curl`. All nine land in **one** partition (in our run, partition 1: offsets 0 to 8), so one consumer works and the other idles. A record without a key goes to a partition chosen by the producer's *sticky* partitioner, which fills one partition before moving on (KIP-794, a *Kafka Improvement Proposal*) — good for batching, useless for spreading a trickle of messages. A key spreads the load **and** keeps each key's events in order: that is why `order-events` uses the order id.

<div class="csim" data-sim="order-events" data-script="scale"></div>

!!! tip "Try it"

    The simulator starts where the store's part of the lab starts: `order-events` with 1 partition, one notification-service in `notification-group`; play or → runs a page, and the buttons work at any time. In **7 Partitions and groups**, six orders land in partition 0 and a second instance gets nothing; after `--partitions 3`, notification-1 reads partitions 0 and 1, notification-2 reads partition 2, and the next six orders split 2, 2 and 2 by key. In **free** mode, scale to 4 instances with 3 partitions and watch one sit idle.

---

## 8. Failures: duplicates and bad messages

### 8.1 At-least-once

The container commits the offset **after** the listener returns. If the instance dies between sending the email and the commit, the offset never moved: whoever reads that partition next — the same instance after a restart, or another one after the rebalance — gets the message again and sends the email a second time.

``` mermaid-sim
sequenceDiagram
    participant K as Kafka (order-events)
    participant N as notification-service
    K->>N: record at offset 0
    N->>N: send the email
    N-xK: killed before the commit
    Note over K,N: offset 0 was never committed
    K->>N: after the restart, offset 0 again
    N->>N: the same email a second time
    N->>K: commit, the group now points at offset 1
```

!!! warning "Make the consumer idempotent"

    Kafka delivers **at least once**: a message may come twice. Processing the same event twice must give the same result as once. For the notification-service: record the order ids already notified in a **durable** store — a table with the order id as primary key, `INSERT … ON CONFLICT DO NOTHING`, and send the email only when the insert added a row. A set in memory does not help: it disappears in the very crash that causes the redelivery.

### 8.2 A message that cannot be processed

Publish something that is not JSON straight to the topic, with the console producer:

``` { .bash .copy .select }
echo 'oops' | docker compose exec -T kafka /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server kafka:9092 --topic order-events
```

`readValue` throws on every attempt. With no error handler of its own, the container uses Spring Kafka's `DefaultErrorHandler`: it retries the record **10 times** with no pause, logs an `ERROR` and **commits past it**:

``` termynal
$ docker compose logs notification | grep -E "ERROR|Caused by"
notification-1  | … ERROR 1 --- [notification] [ntainer#0-0-C-1] o.s.kafka.listener.DefaultErrorHandler   : Backoff FixedBackOffExecution[interval=0, currentAttempts=10, maxAttempts=9] exhausted for order-events-0@1
notification-1  | Caused by: tools.jackson.core.exc.StreamReadException: Unrecognized token 'oops': was expecting (JSON String, Number, Array, Object or token 'null', 'true' or 'false')
```

The stream does not block — the next orders are processed and the lag goes back to `0` — but the bad message is **gone**: one log line is all that is left. For an order whose event had a bug, that is a customer who never gets the email.

### 8.3 A dead-letter topic

A **dead-letter topic** (DLT) keeps the messages that failed, for someone to inspect, fix and replay. Replace the notification-service's `KafkaConsumerConfig` with this one: a `KafkaTemplate` to publish, and an error handler that tries **3 times, 1 s apart**, then hands the record to a `DeadLetterPublishingRecoverer`:

``` { .java .copy .select linenums="1" title="notification-service/src/main/java/store/notification/KafkaConsumerConfig.java" }
--8<-- "docs/2026.2/hands-on/10/code/dlt/KafkaConsumerConfig.java"
```

By default the recoverer writes to `<topic>-dlt` **in the same partition** as the original, so the DLT would need as many partitions as `order-events`; the resolver above returns partition `-1` and lets Kafka choose. Rebuild, publish `oops` again and read the DLT:

``` termynal
$ docker compose logs notification | grep "not yet recovered"
notification-1  | … INFO 1 --- [notification] [ntainer#0-0-C-1] o.s.k.l.KafkaMessageListenerContainer    : Record in retry and not yet recovered
notification-1  | … INFO 1 --- [notification] [ntainer#0-0-C-1] o.s.k.l.KafkaMessageListenerContainer    : Record in retry and not yet recovered
$ docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server kafka:9092 --topic order-events-dlt --from-beginning --max-messages 1 --formatter-property print.offset=true
Offset:0	oops
Processed a total of 1 messages
```

``` mermaid-sim
flowchart LR
    m["record from\norder-events"] --> p{"orderCreated()"}
    p -->|ok| c["commit"]
    p -->|"exception\n(3 attempts, 1 s apart)"| d["DeadLetterPublishingRecoverer\n→ order-events-dlt"]
    d --> c
    c --> n["next record"]
    d -.->|"inspected and replayed later"| ops["operations"]
```

Either way the offset advances and the main stream continues; with the DLT, nothing is lost. (The recoverer also adds headers to the DLT record — the original topic, partition, offset and the exception — which `--formatter-property print.headers=true` shows.)

<div class="csim" data-sim="order-events" data-script="failures"></div>

!!! tip "Try it"

    The simulator replays this section, one record per poll. A kill before the commit sends 1 duplicate email; the idempotent consumer skips the repeat. With the default error handler, a bad message is retried 10 times and skipped: the lag drops back to 0 and 1 message is lost. With the dead-letter topic, the next bad message ends in `order-events-dlt` after 3 attempts and nothing is lost.

---

## 9. Checklist

- [ ] Kafka (KRaft mode) added to `compose.yaml`
- [ ] `producer-service` publishes `GET /producer/{msg}` to `store-producer-example`; the route is in the gateway and open in the `RouterValidator`
- [ ] `consumer-service` logs `enqueue` for every message; `kafka-consumer-groups --describe --group store` shows lag `0`
- [ ] with the consumer stopped, the lag grows; started again, it catches up
- [ ] the order-service publishes `OrderCreated` to `order-events`, keyed by the order id, after saving
- [ ] `notification-service` (group `notification-group`) logs the confirmation email for a new order
- [ ] with 3 partitions, two notification instances share the work
- [ ] a bad message ends in `order-events-dlt`; idempotency understood

[Next: Quiz](quiz.md){ .md-button .md-button--primary }
