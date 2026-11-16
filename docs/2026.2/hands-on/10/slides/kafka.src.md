---
marp: true
lang: en
title: Hands-on 10 — Kafka Messaging
description: Platforms, Microservices, DevOps and APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">Platforms, Microservices, DevOps and APIs · Hands-on 10</div>

# Hands-on 10 — Kafka Messaging

**A producer appends to a log and answers; a consumer reads it on its own time — first the reference pair, then the store**

<!--
Outline: (1) why not one more REST call; (2) Kafka in KRaft mode in compose; (3) the producer-service and its
gateway route; (4) the consumer-service; (5) run it, look inside Kafka, stop the consumer; (6) the store:
order-events and the notification-service; (7) partitions, groups, keys; (8) duplicates, bad messages, the
dead-letter topic; the simulator.
-->

---

## Should the email block the customer?

<div class="q">

Every call the order-service makes happens **before** it answers. Now it must send a **confirmation email**. One more REST call?

</div>

<div style="font-size: 1.15em">
<div class="flow">
<div class="arrow" style="flex: .55; text-align: left">REST</div>
<div class="box">POST /orders</div><div class="arrow">→</div>
<div class="box">account, product</div><div class="arrow">→</div>
<div class="box red">email service<small>slow or down: the order waits or fails</small></div><div class="arrow">→</div>
<div class="box muted">201</div>
</div>
<div class="flow" style="margin-top: .6em">
<div class="arrow" style="flex: .55; text-align: left">Kafka</div>
<div class="box">POST /orders</div><div class="arrow">→</div>
<div class="box">account, product</div><div class="arrow">→</div>
<div class="box accent">append to a topic<small>a durable log</small></div><div class="arrow">→</div>
<div class="box green">201 at once</div>
</div>
<div class="flow">
<div class="arrow" style="flex: .55; text-align: left"></div>
<div class="box muted" style="flex: 3.2">later, on its own time: the notification-service reads the topic and sends the email</div>
</div>
</div>

---

## Two steps: the reference, then the store

<div class="flow" style="font-size: 1.1em">
<div class="arrow" style="flex: .55; text-align: left">Reference</div>
<div class="box">GET /producer/{msg}</div><div class="arrow">→</div>
<div class="box accent">producer-service</div><div class="arrow">send →</div>
<div class="box orange">store-producer-example<small>no key</small></div><div class="arrow">→</div>
<div class="box green">consumer-service<small>group store</small></div>
</div>
<div class="flow" style="font-size: 1.1em">
<div class="arrow" style="flex: .55; text-align: left">Store</div>
<div class="box">POST /orders</div><div class="arrow">→</div>
<div class="box accent">order-service<small>after saving</small></div><div class="arrow">send →</div>
<div class="box orange">order-events<small>key = order id</small></div><div class="arrow">→</div>
<div class="box green">notification-service<small>group notification-group</small></div>
</div>

- Same pattern twice: two Spring Boot services that **never call each other**.
- The producer does not know who reads; a new reader (analytics) is a new **group**, not a code change.

<!--
The page's table "Reference / In the store" lists the same pieces: producer, topic, key, consumer, message.
-->

---

## A topic is a log

<div class="flow" style="font-size: 1.2em; align-items: stretch">
<div class="arrow" style="flex: .5; align-self: center; text-align: left">partition 0</div>
<div class="box green">0<small>hello</small></div>
<div class="box green">1<small>world</small></div>
<div class="box orange">2<small>a</small></div>
<div class="box orange">3<small>b</small></div>
<div class="box orange">4<small>c</small></div>
<div class="box muted">5<small>next write</small></div>
</div>
<div class="flow" style="font-size: 1.05em">
<div class="arrow" style="flex: .5"></div>
<div class="box green" style="flex: 2">read and committed by group store</div>
<div class="box orange" style="flex: 3">waiting: lag = 5 − 2 = 3</div>
<div class="box muted">log-end offset 5</div>
</div>

- The producer **appends**; a record gets the next **offset** and stays — reading does not delete it.
- Kafka keeps, per **group** and partition, the **committed offset**: the next record that group will read.
- **Lag** = log-end offset − committed offset. Another group reads the same log from its own offset.

---

## 2 · Kafka in Docker Compose

<div class="flow" style="font-size: 1.15em; align-items: stretch">
<div class="group">
<div class="caption">Docker network</div>
<div class="box">producer · consumer<small>bootstrap-servers: kafka:9092</small></div>
</div>
<div class="arrow" style="align-self: center">PLAINTEXT →</div>
<div class="box accent" style="display: flex; flex-direction: column; justify-content: center">kafka · one node, KRaft<small>broker + controller · :9092 clients · :9093 controller quorum</small></div>
<div class="arrow" style="align-self: center">no ports →</div>
<div class="box muted" style="flex: .7; display: flex; flex-direction: column; justify-content: center">your machine<small>tools run inside the container</small></div>
</div>

- **KRaft**: Kafka keeps its metadata on its own Raft quorum; Kafka 4.0 removed ZooKeeper.
- `ADVERTISED_LISTENERS: kafka:9092` — the service name; in a container, `localhost` is the container itself.
- A topic is **created on first use** with `KAFKA_NUM_PARTITIONS: 1`; one broker → replication factor 1.

<p class="small">The reference uses <code>apache/kafka:latest</code> (4.3.1 when written); pin it for reproducible builds.</p>

---

## 3 · The producer-service

<div class="flow" style="font-size: 1.1em">
<div class="box">GET /producer/hello</div><div class="arrow">→</div>
<div class="box">ProducerResource</div><div class="arrow">→</div>
<div class="box accent">ProducerService<small>Map → JSON (ObjectMapper)</small></div><div class="arrow">→</div>
<div class="box orange">kafkaTemplate.send<small>(topic, json) · no key</small></div><div class="arrow">→</div>
<div class="box green">200<small>handed to the client buffer</small></div>
</div>

```java
Map<String, String> map = Map.of("id", id, "message", msg);
kafkaTemplate.send("store-producer-example", objectMapper.writeValueAsString(map));
```

- `KafkaProducerConfig`: the broker address + `StringSerializer` for key and value — nothing else.
- `send` is **asynchronous**: `200` = "handed to the Kafka client", not "stored".
- Since Kafka 3.0 the defaults are safe: `acks=all` and **idempotence** on.

---

## 3.1 · Through the gateway

<div class="flow" style="font-size: 1.15em">
<div class="box muted">curl</div><div class="arrow">→</div>
<div class="box">lb :8080</div><div class="arrow">→</div>
<div class="box accent">gateway<small>route Path=/producer/**</small></div><div class="arrow">→</div>
<div class="box green">RouterValidator<small>"GET /producer/**" is open: no cookie</small></div><div class="arrow">→</div>
<div class="box">producer:8080</div>
</div>

- Without the route: `404`. Without the open entry: `401` (the route needs a login).

<div class="warn">

An open `GET` that **publishes** is a demo only: anyone can write to the topic, and a crawler or a prefetch would publish too. In the store the event comes out of `POST /orders`, a secured route.

</div>

---

## 4 · The consumer-service

<div class="flow" style="font-size: 1.15em">
<div class="box accent">listener container<small>polls store-producer-example</small></div><div class="arrow">→</div>
<div class="box">@KafkaListener<small>called once per record</small></div><div class="arrow">→</div>
<div class="box green">all records of the poll done</div><div class="arrow">→</div>
<div class="box orange">commit the offsets<small>AckMode.BATCH</small></div><div class="arrow">↺</div>
</div>

```java
@KafkaListener(topics = "store-producer-example", groupId = "store")
public void consumerMsg(String message) { … logger.debug("enqueue {}", map); }
```

- The method never calls `poll()` or `commit()`: the container does, with `enable.auto.commit=false`.
- A crash before the commit → those records come **again**: at-least-once (section 8).

<p class="small"><code>pom.xml</code> is the producer's with <code>artifactId</code> <code>consumer-service</code> — keep the old one and the jar gets the producer's name.</p>

---

<!-- _class: tight -->

## 5 · Run the reference

```bash
cd api/producer-service && mvn clean package -DskipTests && cd ../..
cd api/consumer-service && mvn clean package -DskipTests && cd ../..
cd api && docker compose up -d --build
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/producer/hello     # 200
```

<div class="flow" style="font-size: 1.05em">
<div class="box accent">producer-1<small>queue {id=e295…, message=hello}</small></div><div class="arrow">→</div>
<div class="box orange">store-producer-example<small>partition 0 · offset 0</small></div><div class="arrow">→</div>
<div class="box green">consumer-1<small>enqueue {id=e295…, message=hello}</small></div>
</div>

| Tool (inside the `kafka` container) | Shows |
|---|---|
| `kafka-topics.sh --describe --topic …` | partitions, leader, replicas |
| `kafka-console-consumer.sh --from-beginning` | the records, still there after being read |
| `kafka-consumer-groups.sh --describe --group store` | committed offset, log-end offset, **lag** |

---

## 5.2 · The consumer was down

<div class="flow" style="font-size: 1.15em">
<div class="box red">docker compose stop consumer</div><div class="arrow">→</div>
<div class="box orange">3 × curl /producer/…<small>200, 200, 200</small></div><div class="arrow">→</div>
<div class="box orange">--describe<small>no active members · lag 3</small></div><div class="arrow">→</div>
<div class="box green">start consumer<small>resumes at offset 2: a, b, c · lag 0</small></div>
</div>

- The producer **did not notice**: it answered `200` three times.
- With REST, those three calls would have **failed**; with a log in between, the consumer catches up.

<div class="ok">

Asynchronous messaging turns "the other service is down" from an error into a **delay**.

</div>

---

## 6 · In the store: order-events

<div class="flow" style="font-size: 1.1em">
<div class="box">POST /orders</div><div class="arrow">→</div>
<div class="box">account, product<small>REST, synchronous</small></div><div class="arrow">→</div>
<div class="box">save the order</div><div class="arrow">→</div>
<div class="box accent">send(order-events, key = order id)</div><div class="arrow">→</div>
<div class="box green">201</div>
</div>
<div class="flow" style="font-size: 1.1em">
<div class="arrow" style="flex: 2.6"></div>
<div class="box orange">next poll</div><div class="arrow">→</div>
<div class="box green">notification-service<small>sending confirmation email: order …</small></div>
</div>

- Publish **after** saving: never announce an order that does not exist.
- The order-service never calls the notification-service, and does not wait for the email.

---

## 6 · Same pattern, three changes

<div class="matrix" style="--n: 2; font-size: 1.15em">
<div></div><div class="head">reference</div><div class="head">store</div>
<div class="row">producer</div><div class="box" style="flex-direction: column">ProducerService<small>send(topic, json)</small></div><div class="box accent" style="flex-direction: column">OrderEventPublisher<small>send("order-events", id, json): with a key</small></div>
<div class="row">config</div><div class="box">KafkaProducerConfig</div><div class="box">the same class, in package store.order</div>
<div class="row">consumer</div><div class="box">consumer-service</div><div class="box green" style="flex-direction: column">notification-service<small>new package, group notification-group, topic order-events</small></div>
<div class="row">message</div><div class="box">{id, message}</div><div class="box">{id, idAccount, total}</div>
</div>

- Test: log in, `POST /orders` → `201` at once → the email line in `docker compose logs notification`.

---

## 7 · Partitions: the key picks one

<div class="flow" style="font-size: 1.15em; align-items: stretch">
<div class="box accent" style="flex: .8; display: flex; flex-direction: column; justify-content: center">order-service<small>key = order id</small></div>
<div class="arrow" style="align-self: center">murmur2(key) % 3 →</div>
<div class="group">
<div class="caption">order-events · 3 partitions</div>
<div class="box">P0<small>events of some orders, in order</small></div>
<div class="box">P1<small>…</small></div>
<div class="box">P2<small>…</small></div>
</div>
<div class="arrow" style="align-self: center">→</div>
<div class="group">
<div class="caption">notification-group</div>
<div class="box green">notification-1<small>reads P0, P1</small></div>
<div class="box green">notification-2<small>reads P2</small></div>
</div>
</div>

- Same key → same partition → the events of one order stay **in order**.
- In a group, each partition has **one** reader; joining or leaving → **rebalance**, resuming at the committed offset.
- Kafka can **add** partitions (`--alter --partitions 3`), never remove them.

---

## 7 · How many instances help?

<div class="matrix" style="--n: 4; font-size: 1.2em">
<div></div><div class="head">1 instance</div><div class="head">2</div><div class="head">3</div><div class="head">4</div>
<div class="row">1 partition (the lab)</div><div class="box green">reads P0</div><div class="box orange">1 idle</div><div class="box orange">2 idle</div><div class="box orange">3 idle</div>
<div class="row">3 partitions</div><div class="box green">reads all 3</div><div class="box green">P0, P1 · P2</div><div class="box green">one each</div><div class="box orange">1 idle</div>
</div>

- The number of partitions **caps** the parallelism of a group.
- `docker compose up -d --scale notification=2` + `kafka-consumer-groups --describe --members`: `#PARTITIONS 1` and `0`.
- Another group (analytics) reads **every** message, at its own offsets.

---

## 7 · Without a key, partitions do not spread

<div class="flow" style="font-size: 1.15em; align-items: stretch">
<div class="box accent" style="flex: .8; display: flex; flex-direction: column; justify-content: center">9 × curl /producer/…<small>no key</small></div>
<div class="arrow" style="align-self: center">sticky partitioner →</div>
<div class="group">
<div class="caption">store-producer-example · 3 partitions</div>
<div class="box muted">P0<small>nothing new</small></div>
<div class="box orange">P1<small>all nine: offsets 0 to 8</small></div>
<div class="box muted">P2<small>nothing</small></div>
</div>
<div class="arrow" style="align-self: center">→</div>
<div class="group">
<div class="caption">group store</div>
<div class="box green">consumer-1<small>reads P0, P1: does all the work</small></div>
<div class="box orange">consumer-2<small>reads P2: idle</small></div>
</div>
</div>

- No key → the producer **fills one partition** before moving on (KIP-794, a *Kafka Improvement Proposal*): big batches, no spreading.
- A key spreads the load **and** keeps each key in order: that is why `order-events` uses the order id.

<!--
Measured in the lab's stack: after --partitions 3 and a restart, nine curl messages all went to partition 1.
-->

---

## Simulator: partitions and groups

<div class="q">

The store's part of the lab without Docker: `order-events` with 1 partition, one notification-service. Play runs a page; the buttons work at any time.

</div>

<div class="flow" style="font-size: 1.15em">
<div class="box orange">6 orders, 1 partition<small>all in P0 · notification-2 gets nothing</small></div><div class="arrow">→</div>
<div class="box accent">--partitions 3<small>notification-1 ← P0, P1 · notification-2 ← P2</small></div><div class="arrow">→</div>
<div class="box green">6 more orders<small>split 2, 2 and 2 by key</small></div>
</div>

- Stop one instance: its partition moves to the other, which drains the lag one message per poll.
- **Free** mode: 4 instances on 3 partitions — one sits idle.

<p class="small">Page section 7 · simulator <code>order-events</code>, script "7 · Partitions and groups".</p>

---

## 8.1 · At-least-once

<div class="flow" style="font-size: 1.1em">
<div class="box">record at offset 0</div><div class="arrow">→</div>
<div class="box green">email sent</div><div class="arrow">→</div>
<div class="box red">killed before the commit</div><div class="arrow">→</div>
<div class="box orange">restart / rebalance<small>offset 0 again</small></div><div class="arrow">→</div>
<div class="box red">the same email twice</div>
</div>

- The container commits **after** the listener returns: a crash in between means redelivery.
- Kafka delivers **at least once** — the consumer must be **idempotent**.

<div class="ok">

Record the notified order ids in a **durable** store (`INSERT … ON CONFLICT DO NOTHING`) and email only when the insert added a row. A set in memory dies in the very crash that causes the redelivery.

</div>

---

## 8.2 · A message that cannot be processed

<div class="flow" style="font-size: 1.15em">
<div class="box orange">echo 'oops' | console producer<small>not JSON</small></div><div class="arrow">→</div>
<div class="box">readValue throws<small>10 attempts, no pause</small></div><div class="arrow">→</div>
<div class="box red">ERROR · Backoff … exhausted<small>for order-events-0@1</small></div><div class="arrow">→</div>
<div class="box red">commit past it<small>the message is gone</small></div>
</div>

- No error handler of your own → Spring Kafka's `DefaultErrorHandler`: `FixedBackOff(0, 9)`, log, skip.
- Nothing blocks — the next orders flow, lag back to `0` — but **one log line** is all that is left.

<div class="warn">

For an order whose event had a bug, that is a customer who never gets the email — and nobody notices.

</div>

---

## 8.3 · A dead-letter topic (DLT)

<div class="flow" style="font-size: 1.15em">
<div class="box orange">bad record</div><div class="arrow">→</div>
<div class="box">3 attempts, 1 s apart<small>Record in retry and not yet recovered</small></div><div class="arrow">→</div>
<div class="box accent">DeadLetterPublishingRecoverer</div><div class="arrow">→</div>
<div class="box green">order-events-dlt<small>offset 0 · oops · inspect, fix, replay</small></div>
</div>

```java
new DefaultErrorHandler(new DeadLetterPublishingRecoverer(kafkaTemplate(),
    (record, ex) -> new TopicPartition(record.topic() + "-dlt", -1)), new FixedBackOff(1000L, 2L))
```

- Default destination: `<topic>-dlt`, **same partition** → the DLT would need as many partitions; `-1` lets Kafka choose.
- The DLT record carries headers: original topic, partition, offset, exception.

---

## Simulator: failures

<div class="flow" style="font-size: 1.1em">
<div class="arrow" style="flex: .5; text-align: left">duplicates</div>
<div class="box red">kill before the commit<small>1 duplicate email</small></div><div class="arrow">→</div>
<div class="box green">idempotent consumer<small>the repeat is skipped</small></div>
</div>
<div class="flow" style="font-size: 1.1em">
<div class="arrow" style="flex: .5; text-align: left">bad message</div>
<div class="box red">default handler<small>10 attempts, skipped · 1 lost · lag 0</small></div><div class="arrow">→</div>
<div class="box green">dead-letter topic<small>3 attempts → order-events-dlt · 0 lost</small></div>
</div>

- The tiles count it: emails sent, duplicate emails, group lag, **messages lost**, `order-events-dlt`.
- One record per poll: each step of the page is one click.

<p class="small">Page section 8 · simulator <code>order-events</code>, script "8 · Failures".</p>

---

## Pitfalls

| Symptom | Cause |
|---|---|
| `401` / `404` on `/producer/hello` | route not open in the `RouterValidator` / missing in the gateway |
| `COPY target/*.jar` fails | `mvn clean package` not run in that service |
| consumer jar named `producer-service-1.0.0.jar` | copied `pom.xml` still has the producer's `artifactId` |
| a second instance never works | 1 partition — or no key: everything in one partition |
| an email sent twice | crash before the commit: make the consumer idempotent |
| a bad event vanished | default error handler skipped it: add a dead-letter topic |

---

## Takeaways

1. A **topic is a log**: the producer appends and answers; consumers read at their own offsets.
2. Spring Kafka: `KafkaTemplate.send` to publish, `@KafkaListener` + a **group** to consume; the container commits.
3. A consumer that is down means **lag**, not errors: it catches up.
4. **Partitions** cap a group's parallelism; a **key** spreads the load and keeps each key in order.
5. Delivery is **at-least-once**: idempotent consumers, with a durable record.
6. Without a **dead-letter topic**, a bad message is retried 10 times and **lost**.
