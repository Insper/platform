Click **"Answer"** to reveal the correct answer and explanation.

---

## Kafka Messaging

**Q1.** What does `enable_auto_commit=False` achieve in the Kafka consumer?

- A. It disables Kafka's internal retry mechanism, forcing the application to handle retries manually
- B. It prevents the consumer from committing its offset until `consumer.commit()` is called explicitly — ensuring the offset only advances after successful processing
- C. It tells Kafka not to persist messages to disk, reducing broker latency
- D. It disables the consumer group protocol, making the consumer read every partition independently

??? success "Answer"
    **B — Offset only advances after explicit `consumer.commit()`.**

    With `enable_auto_commit=True` (the default), Kafka periodically commits the offset regardless of whether processing succeeded. If the service crashes between auto-commit and finishing the work, the message is silently lost. Setting it to `False` and calling `consumer.commit()` only after successful processing guarantees at-least-once delivery: a crash before the commit causes the message to be re-delivered on the next startup.

---

**Q2.** Why is `acks=all` important in production even if it adds latency?

- A. It compresses messages before sending, reducing network bandwidth at the cost of CPU time
- B. It ensures the producer retries indefinitely until the broker acknowledges receipt
- C. It requires all in-sync replicas to acknowledge the write before the broker confirms — preventing data loss if the leader broker fails immediately after accepting the message
- D. It is only relevant for consumers and has no effect on producer behaviour

??? success "Answer"
    **C — All in-sync replicas acknowledge before confirmation, preventing data loss on leader failure.**

    With `acks=1` (default), the broker confirms the write once the partition leader has written the message to its local log. If the leader crashes before replicating to followers, the message is lost. With `acks=all`, the broker waits for every in-sync replica to persist the write before responding — the message survives a leader failover. Combined with `enable.idempotence=true`, this gives exactly-once producer semantics.

---

**Q3.** The notification-service processes the same `orderId` twice due to a crash before commit. How should the idempotent consumer handle this?

- A. Throw an exception and send the duplicate to the DLQ
- B. Process the event normally — duplicate processing is unavoidable and acceptable
- C. Check whether a notification was already sent for this `orderId` before acting; skip the send if a record already exists
- D. Increase the consumer group replication factor to prevent duplicates at the broker level

??? success "Answer"
    **C — Check for a prior record of the `orderId` and skip if already processed.**

    Idempotency means that applying the same operation multiple times produces the same result as applying it once. The consumer should maintain a store (database, Redis set, or log) of processed `orderId` values. Before sending an email, it checks that store: if the `orderId` is already present, the event is acknowledged and skipped. This pattern is essential whenever at-least-once delivery is in use — which is the default for Kafka.

---

**Q4.** What is the purpose of the `group_id` in a Kafka consumer?

- A. It identifies the Kafka cluster the consumer connects to
- B. It sets the maximum number of consumers allowed to read from a single partition simultaneously
- C. It groups consumers into a logical unit that collectively reads a topic — Kafka tracks the committed offset per group, and each partition is assigned to exactly one consumer within the group
- D. It encrypts the consumer's connection to the broker using a shared group key

??? success "Answer"
    **C — Groups consumers into a unit with shared offset tracking; each partition goes to one member.**

    When multiple instances of notification-service run, they all share `group_id="notification-group"`. Kafka distributes the topic's partitions across the group members so that each message is processed by exactly one instance — enabling horizontal scaling of consumers. If the group_id were unique per instance, each instance would independently receive every message, causing duplicate email notifications.

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

**Q6.** What does the Kafka UI consumer group lag metric tell you?

- A. The number of messages the producer has published but the broker has not yet persisted to disk
- B. The difference between the latest offset on the topic and the last committed offset of a consumer group — indicating how far behind the consumer is
- C. The average time in milliseconds between a message being published and it being received by the consumer
- D. The number of partitions that have no active consumer assigned

??? success "Answer"
    **B — The gap between the topic's latest offset and the consumer group's committed offset.**

    A lag of 0 means the consumer is keeping up in real time. A growing lag signals that the consumer is slower than the producer — messages are accumulating. For the notification-service, sustained lag means email confirmations are delayed. Common remedies are increasing consumer instances (within the partition count) or optimising the processing logic. Kafka UI displays per-partition lag, making it easy to identify uneven consumption across partitions.

---

**Q7.** Why is `KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092` the correct setting for Docker Compose (using the service name, not `localhost`)?

- A. `localhost` is reserved for the Zookeeper connection; Kafka requires a separate hostname
- B. Kafka brokers use `KAFKA_ADVERTISED_LISTENERS` to tell clients which address to connect to after the initial bootstrap; inside Docker Compose, other containers resolve service names via Docker's internal DNS, so `kafka:9092` is reachable while `localhost:9092` would refer to each container's own loopback interface
- C. The Confluent Platform image does not support `localhost` as a listener address due to a licensing restriction
- D. Using `localhost` would expose the Kafka broker on the host machine, creating a security vulnerability

??? success "Answer"
    **B — Docker's internal DNS resolves service names; `localhost` inside a container refers to that container's own loopback.**

    When the order-service container connects to `kafka:9092`, Docker's embedded DNS resolves `kafka` to the Kafka container's internal IP. If `KAFKA_ADVERTISED_LISTENERS` were set to `localhost:9092`, the broker would advertise an address that only routes back to itself — every client trying to connect would reach their own loopback instead of the broker. Using the service name makes the advertised address valid from any container in the same Docker network.

---

**Q8.** What is the DLQ (Dead Letter Queue) pattern solving?

- A. Throttling the producer when it publishes faster than the broker can replicate
- B. Compressing large messages that exceed the broker's maximum message size
- C. Preventing a single unprocessable message ("poison pill") from blocking the consumer indefinitely — failed messages are moved to a separate topic for later inspection and replay, allowing the consumer to continue processing the rest of the stream
- D. Distributing partitions evenly across consumer group members to reduce lag

??? success "Answer"
    **C — Moves unprocessable messages aside so they don't block the consumer stream.**

    Without a DLQ, a single malformed or unprocessable message would cause the consumer to retry indefinitely, blocking all subsequent messages in that partition. The DLQ pattern catches the exception, publishes the problematic message to `order-events-dlq`, commits the original offset, and moves on. Operations teams can then inspect the DLQ, fix the root cause, and replay the events once the consumer is patched — without losing any data.
