
Click **"Answer"** to reveal the correct answer and explanation.

---

## Core Concepts

**Q1.** Which of the following best describes the difference between an **event**, a **command**, and a **message**?

- A. They are all equivalent terms for the same concept in messaging systems
- B. A command is an instruction that can be rejected; an event is an immutable record of something that already happened; a message is a generic data container that may represent either
- C. An event is sent to a single recipient; a command is broadcast to all consumers; a message is stored in a database
- D. A command carries no payload; an event carries a payload; a message carries metadata only

??? success "Answer"
    **B — Command = instruction (rejectable); event = immutable fact; message = generic container.**

    The distinction is semantic but important for system design. A command (`PlaceOrder`) expresses intent and implies a single handler that may reject it. An event (`OrderCreated`) is a statement of fact — it has already happened and cannot be undone. A message is the neutral transport-level term that encompasses both. Using the right vocabulary prevents ambiguity about who owns the decision.

---

**Q2.** In Kafka, when a topic has 3 partitions and a consumer group has 3 consumers, how are partitions assigned?

- A. All 3 consumers read from all 3 partitions simultaneously, tripling throughput
- B. Each partition is assigned to exactly one consumer in the group; each consumer owns one partition
- C. Kafka randomly delivers each message to any available consumer regardless of partition
- D. Only one consumer is active at a time; the other two are on standby

??? success "Answer"
    **B — Each partition is owned by exactly one consumer in the group.**

    Kafka's partition assignment protocol guarantees that within a consumer group, each partition is consumed by exactly one consumer at a time. This ensures ordered, non-duplicated processing within a partition. With 3 partitions and 3 consumers the assignment is 1:1. If a consumer leaves the group, Kafka triggers a rebalance and reassigns its partition to a remaining consumer.

---

**Q3.** Why are events considered **immutable** in event-driven systems?

- A. Because Kafka does not support update operations at the protocol level
- B. Because immutability allows brokers to compress events more efficiently
- C. Because events record something that already happened — the fact cannot change — making them safe to replay, audit, and use as a reliable source of truth
- D. Because consumer groups require a fixed schema to parse messages

??? success "Answer"
    **C — Events are facts about the past; facts cannot be retroactively changed.**

    Immutability is a design principle, not just a technical constraint. If an event could be mutated after publication, consumers that already processed it would hold a different view of history than consumers processing it later — destroying consistency. The append-only log is what makes event sourcing, time-travel debugging, and zero-downtime projection rebuilds possible.

---

**Q4.** In a **CQRS** architecture, which side handles write operations?

- A. The read model, because it holds the most recent state
- B. The query handler, which reads from the event store and materialises a projection
- C. The command handler, which validates the command, appends an event to the event store, and publishes it to the event bus
- D. The API gateway, which routes writes and reads to the same underlying service

??? success "Answer"
    **C — The command handler owns writes: validate, append event, publish.**

    CQRS separates the write path (commands → command handler → event store / event bus) from the read path (queries → read model). The command handler enforces business invariants and produces events as its output. The read model is a derived, denormalised projection updated asynchronously from those events. This separation allows each side to be optimised and scaled independently.

---

**Q5.** A user initiates a login and your service must return a session token before the HTTP response is sent. Which communication style is the correct choice and why?

- A. Asynchronous event, because publishing to Kafka is faster than an HTTP round-trip
- B. Synchronous REST, because the caller requires the result immediately before it can proceed
- C. Asynchronous event with a callback, so the UI polls for the token
- D. Either style — the choice only affects internal architecture, not latency visible to the user

??? success "Answer"
    **B — Synchronous REST, because the caller is blocked waiting for the result.**

    The defining question for choosing synchronous vs asynchronous is: *does the caller need the answer before it can continue?* For authentication the answer is yes — without the token there is nothing to do next. Asynchronous patterns introduce latency indirection (polling, webhooks, long-polling) that adds complexity without benefit when the result is required immediately.

---

**Q6.** What is the purpose of a **Dead Letter Queue (DLQ)**?

- A. To store messages that have been successfully processed so they can be audited later
- B. To buffer messages when the broker is under high load, releasing them when load drops
- C. To capture messages that could not be processed after exhausting retry attempts, preventing them from blocking the main stream while preserving them for investigation
- D. To compact the topic by removing duplicate messages with the same key

??? success "Answer"
    **C — DLQ captures unprocessable messages without blocking the main stream.**

    Without a DLQ, a message that consistently causes a consumer to throw an exception would either be retried forever (stalling progress) or silently dropped (losing data). The DLQ is a safety valve: failing messages are moved there so the stream continues, and an operator can inspect the message, fix the root cause, and replay it. Spring Kafka's `@RetryableTopic` automates retry scheduling and DLQ routing.

---

**Q7.** What does **consumer group offset tracking** enable that a simple queue does not?

- A. It allows multiple independent groups to read the same topic at their own pace without interfering with each other
- B. It prevents consumers from reading the same partition more than once per day
- C. It encrypts messages so that only the group with the correct key can decode them
- D. It limits the rate at which producers can publish to a topic

??? success "Answer"
    **A — Each group owns its own offset, so groups progress independently.**

    In a traditional queue, once a message is consumed it is gone. In Kafka, the message remains in the log and each consumer group maintains its own pointer (offset) per partition. The `notification-group` can be at offset 42 while the `analytics-group` is still at offset 10 — both reading the same topic without interfering. This is what makes fan-out (pub/sub) to multiple independent consumers possible at scale.

---

**Q8.** In **event sourcing**, what does "replaying events" mean, and why is it useful?

- A. Resending failed events to consumers that did not acknowledge receipt
- B. Re-publishing events to a new topic to trigger downstream services again
- C. Iterating through the full history of stored events in order to reconstruct the current state of an entity, or to populate a new read model projection from scratch
- D. Synchronising the event store with a relational database by re-executing SQL statements

??? success "Answer"
    **C — Replay reconstructs state by iterating the event history in order.**

    Because the event store is append-only and immutable, the complete history is always available. Replaying means iterating events from offset 0 (or a snapshot) and applying each event to an in-memory aggregate until the current state is reached. This enables building entirely new projections, migrating to a new schema, or debugging by inspecting what the system looked like at any point in the past.

---

**Q9.** What is the key operational difference between **pub/sub (fan-out)** and **competing consumers**?

- A. In pub/sub each consumer group receives a full copy of every message; in competing consumers multiple consumers in one group share the partitions so each message is processed by exactly one consumer
- B. Pub/sub requires a dedicated broker per consumer; competing consumers share a single broker
- C. Competing consumers are only possible with RabbitMQ, not Kafka
- D. In pub/sub only one consumer can be active at a time; in competing consumers all consumers run in parallel on the same message

??? success "Answer"
    **A — Fan-out = every group gets a copy; competing consumers = one group shares the work.**

    The distinction is determined by consumer group membership. Put `email-service`, `analytics-service`, and `audit-service` in separate groups → each receives every `OrderCreated` event (fan-out). Put three instances of `payment-processor` in the same group → Kafka assigns each partition to one instance, so each event is processed once (competing consumers). The same Kafka topic supports both patterns simultaneously.

---

**Q10.** Within a single Kafka **partition**, message ordering is guaranteed. Why is ordering **not** guaranteed across partitions of the same topic?

- A. Because Kafka replicates partitions to different brokers, introducing variable network delays
- B. Because each partition is an independent ordered log with its own offset sequence; a message in partition 0 at offset 5 and a message in partition 1 at offset 3 have no defined temporal relationship — the consumer receives them based on whichever is polled first
- C. Because consumer groups read partitions in reverse order by default to balance load
- D. Because Kafka uses timestamps instead of offsets for cross-partition ordering, and clocks are never perfectly synchronised

??? success "Answer"
    **B — Each partition is an independent log; offsets are not comparable across partitions.**

    A partition is an ordered, append-only sequence. Within partition 0 you know message at offset 5 came after offset 4. But partition 0 offset 5 and partition 1 offset 3 were written independently — there is no global sequence number linking them. If strict global ordering is required, use a single partition (at the cost of parallelism) or include an application-level timestamp and sort at read time.

---
