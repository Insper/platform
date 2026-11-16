Click **"Answer"** to reveal the correct answer and explanation.

---

## Kafka Messaging

**Q1.** When does the Spring Kafka listener container of the `consumer-service` commit the offset, by default?

- A. Every 5 seconds, whether or not the listener finished — Kafka's auto-commit
- B. After the `@KafkaListener` method has returned for every record of a poll (`AckMode.BATCH`, with `enable.auto.commit=false`)
- C. Before calling the listener, so that a slow listener never holds the partition
- D. Never: the listener has to call `commit()` itself

??? success "Answer"
    **B — After the listener returned for every record of the poll.**

    The container sets `enable.auto.commit=false` (unless you set it) and commits the offsets itself once the records of a poll have been processed. A crash before that commit means the records come again on the next poll — at-least-once delivery. Kafka's own auto-commit (A) would commit on a timer, whether processing succeeded or not, and could lose a message; committing before processing (C) would lose a message on every crash.

---

**Q2.** The `KafkaProducerConfig` of the reference sets only the broker address and the two serializers. Why are its writes already safe against a leader failure and against duplicates from retries?

- A. Because `StringSerializer` adds a checksum that the broker verifies
- B. Because since Kafka 3.0 the producer's defaults are `acks=all` (every in-sync replica confirms) and `enable.idempotence=true` (a retried send is not written twice)
- C. Because `KafkaTemplate.send` is synchronous and waits for every consumer
- D. They are not: `acks=1` is the default, so the config must set `acks=all`

??? success "Answer"
    **B — The producer's defaults are `acks=all` and idempotence on, since Kafka 3.0.**

    With `acks=all` the leader answers only after every in-sync replica has the record, so a leader that dies right after the write does not take it along. With idempotence, the broker discards a retried batch it already wrote, so a retry after a timeout does not duplicate the message in the partition. (On the lab's single broker, `acks=all` changes nothing — there is no other replica.) `send` is asynchronous (C) and never waits for consumers; D was true before Kafka 3.0.

---

**Q3.** The notification-service is killed after sending the email of an order but before the container commits. How should an idempotent consumer handle the redelivery?

- A. Throw an exception, so that the duplicate goes to the dead-letter topic
- B. Process the event normally — duplicate processing is unavoidable and acceptable
- C. Check, in a durable store, whether this order id was already notified; skip the send if it was
- D. Keep the notified order ids in a `HashSet` in memory and skip the ids found there

??? success "Answer"
    **C — Check a durable record of the order id and skip if it was already processed.**

    Idempotency means that processing the same event twice gives the same result as once. The consumer records the order ids it notified in a durable store — a table with the order id as primary key, `INSERT … ON CONFLICT DO NOTHING` — and sends the email only when the insert added a row. A set in memory (D) disappears in the very crash that causes the redelivery. This is essential whenever delivery is at-least-once, which is Kafka's default.

---

**Q4.** What is the purpose of the `groupId` of a `@KafkaListener` (`"store"` in the reference, `"notification-group"` in the store)?

- A. It identifies the Kafka cluster the consumer connects to
- B. It sets the maximum number of consumers allowed to read from a single partition simultaneously
- C. It groups consumers into a logical unit that collectively reads a topic — Kafka tracks the committed offset per group, and each partition is assigned to exactly one consumer within the group
- D. It encrypts the consumer's connection to the broker using a shared group key

??? success "Answer"
    **C — Groups consumers into a unit with shared offset tracking; each partition goes to one member.**

    When several instances of the notification-service run, they all share `groupId = "notification-group"`. Kafka distributes the topic's partitions across the members so that each message is processed by exactly one instance — horizontal scaling of consumers, up to the number of partitions. If each instance had its own group, each would receive every message, and every customer would get one email per instance.

---

**Q5.** The order-service publishes to `order-events`. Two new services (analytics-service, fraud-service) also need these events. What change is required in order-service?

- A. Add two more `kafkaTemplate.send()` calls to push events to the new services' dedicated topics
- B. Register the new services as subscribers in the order-service configuration
- C. No change — other consumers join a different consumer group and independently consume from the same topic
- D. Partition the `order-events` topic into three partitions, one per consumer service

??? success "Answer"
    **C — No change. Other consumers join a different consumer group and independently consume from the same topic.**

    This is the key decoupling benefit of Kafka over REST. Each consumer group maintains its own offset pointer on the topic. `analytics-group` and `fraud-group` each receive every message from `order-events` independently, at their own pace, without the order-service having any knowledge of their existence. With REST, the order-service would need an explicit call to each downstream service — every new subscriber requires a code change in the publisher.

---

**Q6.** What does the `LAG` column of `kafka-consumer-groups.sh --describe` tell you?

- A. The number of messages the producer has published but the broker has not yet persisted to disk
- B. The difference between the log-end offset of a partition and the committed offset of the group — how far behind the consumer is
- C. The average time in milliseconds between a message being published and it being received by the consumer
- D. The number of partitions that have no active consumer assigned

??? success "Answer"
    **B — The gap between the partition's log-end offset and the group's committed offset.**

    A lag of 0 means the consumer is keeping up. A growing lag means the consumer is slower than the producer — or down, as in section 5.2, where three messages waited with lag 3 until the consumer came back. For the notification-service, sustained lag means delayed confirmation emails. Common remedies are more consumer instances (up to the number of partitions) or faster processing. The tool shows the lag per partition, which reveals uneven consumption.

---

**Q7.** Why is `KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092` the correct setting for Docker Compose (using the service name, not `localhost`)?

- A. `localhost` is reserved for the KRaft controller listener; client traffic needs a separate hostname
- B. Kafka brokers use `KAFKA_ADVERTISED_LISTENERS` to tell clients which address to connect to after the initial bootstrap; inside Docker Compose, other containers resolve service names via Docker's internal DNS, so `kafka:9092` is reachable while `localhost:9092` would refer to each container's own loopback interface
- C. The official `apache/kafka` image refuses `localhost` as a listener address
- D. Using `localhost` would expose the Kafka broker on the host machine, creating a security vulnerability

??? success "Answer"
    **B — Docker's internal DNS resolves service names; `localhost` inside a container refers to that container's own loopback.**

    When the order-service container connects to `kafka:9092`, Docker's embedded DNS resolves `kafka` to the Kafka container's internal IP. If `KAFKA_ADVERTISED_LISTENERS` were set to `localhost:9092`, the broker would advertise an address that only routes back to itself — every client trying to connect would reach their own loopback instead of the broker. Using the service name makes the advertised address valid from any container in the same Docker network.

---

**Q8.** The notification-service, with the `KafkaConsumerConfig` of section 6.2 (no error handler of its own), receives a message that is not JSON. What happens?

- A. The partition blocks forever: the consumer retries the same message until someone fixes it
- B. Spring Kafka's `DefaultErrorHandler` tries the record 10 times, logs an `ERROR` and commits past it — the stream goes on, but the message is lost
- C. The message goes to `order-events-dlt` automatically
- D. The consumer thread dies and the container restarts the service

??? success "Answer"
    **B — 10 attempts, one `ERROR` line, and the offset moves past the record.**

    The default `DefaultErrorHandler` uses `FixedBackOff(0, 9)`: ten deliveries without pause, then it logs the record (`Backoff … exhausted for order-events-0@1`) and commits its offset, so the next records flow. Nothing blocks — and nothing keeps the message. A dead-letter topic (section 8.3) changes the last step: after the attempts, a `DeadLetterPublishingRecoverer` publishes the record to `order-events-dlt`, where it can be inspected and replayed. Nothing goes to the DLT unless you configure it (C).

---

**Q9.** `store-producer-example` now has 3 partitions and two consumer-service instances share them. Nine messages are sent with `curl /producer/…` — the producer sends them **without a key**. What do you expect?

- A. Three messages per partition, round-robin, so both consumers work
- B. All nine in one partition, picked by the producer's sticky partitioner — one consumer works, the other may idle
- C. The messages are rejected: a topic with several partitions requires a key
- D. Each message goes to every partition, so both consumers process all nine

??? success "Answer"
    **B — A keyless record goes to the partition the sticky partitioner is filling.**

    Without a key, the producer does not hash anything: it fills one partition before moving to another (KIP-794), which builds bigger batches. A trickle of manual messages therefore lands in a single partition — in the lab's run, partition 1, offsets 0 to 8. That is why the store's events carry the order id as key: the key spreads orders over the partitions **and** keeps each order's events in order in one of them.
