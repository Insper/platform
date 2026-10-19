Click **"Answer"** to reveal the correct answer and explanation.

---

## Kafka basics

**Q1.** The `notification` consumer group runs 8 instances on the 6-partition topic `order-events`. How many instances receive messages?

- A. 8 — Kafka balances messages round-robin across all members
- B. 6 — each partition is assigned to one member of the group; 2 instances stay idle
- C. 1 — a consumer group always has a single active reader
- D. 48 — every instance reads every partition

??? success "Answer"
    **B — 6 active, 2 idle.**

    Inside a consumer group, a partition is consumed by at most one member at a time; this is how Kafka keeps per-partition order. The number of partitions is therefore the ceiling of the group's parallelism. The idle instances are not useless: they take over partitions when an active member fails.

---

**Q2.** The outbox relay publishes each event with key = `orderId`. What does the key guarantee?

- A. That each event is delivered exactly once
- B. That events of the same order go to the same partition and are therefore read in the order they were written
- C. That the event is encrypted with the key
- D. That events of different orders never share a partition

??? success "Answer"
    **B — same key → same partition → per-key ordering.**

    The default partitioner hashes the key modulo the number of partitions. Kafka only guarantees order within a partition, so keying by aggregate id gives ordering *per order*, which is what the consumers need. Different keys can share a partition (D is false), and the key has nothing to do with delivery semantics or encryption.

---

**Q3.** A consumer group reads `order-events`. `kafka-consumer-groups.sh --describe` shows, for partition 2, `CURRENT-OFFSET 1200` and `LOG-END-OFFSET 1500`. What is the lag, and what does it mean?

- A. 2 700; the broker has 2 700 messages in memory
- B. 300; the group still has 300 messages of that partition to process
- C. 1 200; the group processed 1 200 messages since it started
- D. 300; 300 messages were lost

??? success "Answer"
    **B — lag = log-end offset − committed offset = 300 messages still to process.**

    Lag is the distance between the newest message in the partition and the group's committed position. It is the main health signal of a consumer: growing lag means arrivals exceed the consumer's capacity. Nothing is lost — Kafka keeps the messages for the retention period whether they were read or not.

---

## Outbox and idempotency

**Q4.** Why can't the `order` service simply save the order and then call `kafkaTemplate.send(...)` in the same method?

- A. Spring does not allow Kafka calls inside a `@Transactional` method
- B. Kafka is slower than PostgreSQL
- C. The two writes go to different systems with no shared transaction: a crash between them stores an order without its event (or publishes an event for an order that was rolled back)
- D. Kafka requires events to be published from a separate service

??? success "Answer"
    **C — the dual-write problem.**

    PostgreSQL cannot roll back a Kafka publish, and Kafka cannot roll back a database commit. Whatever the order of the two writes, a crash, deploy or timeout between them leaves the systems inconsistent. The transactional outbox writes the event into the same database transaction as the order; a relay publishes it afterwards, retrying until Kafka acknowledges.

---

**Q5.** The relay sends a batch, Kafka acknowledges, and the process crashes before `UPDATE outbox SET published_at = ...` commits. What happens?

- A. The events are lost
- B. The events are published again on the next run; consumers see duplicates and must be idempotent
- C. Kafka detects the duplicate and drops it, because `enable.idempotence=true`
- D. The database rolls back the orders too

??? success "Answer"
    **B — republished: the outbox is at-least-once.**

    The rows are still unpublished, so the next run (or another replica) sends them again. Producer idempotence (C) only deduplicates retries *within one producer session*; after a crash the new producer has a new identity. That is why every event carries an `eventId` and the consumer deduplicates on it.

---

**Q6.** The relay query ends with `FOR UPDATE SKIP LOCKED`. What problem does `SKIP LOCKED` solve?

- A. It skips events that failed to serialize
- B. It lets several `order` replicas run the relay concurrently: each locks a different set of rows instead of waiting for (or duplicating) the others' rows
- C. It avoids locking the `orders` table during inserts
- D. It makes the query faster by skipping the index

??? success "Answer"
    **B — concurrent relays take disjoint batches.**

    `FOR UPDATE` locks the selected rows until the transaction ends; `SKIP LOCKED` makes another transaction skip rows that are already locked instead of blocking on them. Each replica takes a different batch, so the work is shared without double publishing. The same idiom implements job queues in PostgreSQL.

---

**Q7.** In `NotificationService.handle`, the dedupe insert into `processed_events` and the e-mail send are inside one transaction, in this order. Which failure can still produce a duplicate e-mail?

- A. The consumer receives the same event twice in a row
- B. Two consumer instances receive the same event at the same time
- C. The e-mail is sent, then the database commit fails; the redelivered event is processed again
- D. The event is malformed JSON

??? success "Answer"
    **C — the effect succeeded but the record of it did not.**

    A and B are handled: the primary key on `event_id` lets only one transaction claim the event, and later deliveries find it claimed. But the e-mail is an external side effect that the database cannot roll back. If the commit fails after the send, the claim disappears and a retry sends again. The complete fix is an idempotency key accepted by the provider (pass the `eventId`).

---

**Q8.** `POST /orders` uses `INSERT ... ON CONFLICT (hold_id) DO NOTHING`. A fan double-clicks "Buy". What happens?

- A. Two orders are created for the same seats
- B. The second request fails with a 500 because of the unique violation
- C. The second request finds the hold already ordered, returns the same order with `200 OK`, and writes no second event
- D. The second request waits until the first e-mail is sent

??? success "Answer"
    **C — the unique `hold_id` makes the request idempotent.**

    The natural key of the operation (one hold → one order) becomes a unique constraint. PostgreSQL serializes the two inserts: the second one skips, the service reads the existing row and returns it. No duplicate order, no duplicate event — idempotency at the API, not only at the consumer.

---

## Errors and the DLT

**Q9.** A message on partition 3 makes the listener throw a transient `MailSendException` every time, and the error handler is configured with 3 retries and exponential backoff (0.5 s, 1 s, 2 s). What happens to the other messages?

- A. All partitions stop until an operator intervenes
- B. Messages behind it **on partition 3** wait about 3.5 s; other partitions keep flowing; then the record goes to `order-events-dlt` and partition 3 resumes
- C. The record is skipped silently after the first failure
- D. Kafka moves the record to the end of the partition and tries later

??? success "Answer"
    **B — blocking retries delay only that partition, then the DLT unblocks it.**

    `DefaultErrorHandler` retries in place, so ordering is kept and only the affected partition waits. After the retries, `DeadLetterPublishingRecoverer` publishes the record (with exception headers) to the DLT and the offset is committed. Kafka never reorders a partition (D).

---

**Q10.** Why are `JacksonException` and `IllegalArgumentException` registered as **not retryable**?

- A. Because Spring Kafka cannot retry checked exceptions
- B. Because they signal permanent failures: a malformed payload or a rejected address will fail on every attempt, so retrying only delays the partition
- C. To make the consumer faster in the happy path
- D. Because the DLT only accepts these exception types

??? success "Answer"
    **B — classify errors: transient → retry, permanent → dead-letter now.**

    Retrying a poison message wastes the backoff time and blocks the partition for nothing. Classifying exceptions is the core design decision of any consumer: timeouts and 5xx from dependencies are transient; validation and parsing errors are permanent.

---

## Waiting room and capacity

**Q11.** The waiting room admits 500 fans per second. A fan joins and is at position 45 000. What ETA should the page show, and which law justifies it?

- A. 9 s — position × rate
- B. 90 s — Little's Law: wait = queue length / throughput
- C. 45 s — one second per thousand fans
- D. It cannot be estimated

??? success "Answer"
    **B — 45 000 / 500 = 90 s.**

    Little's Law, L = λ·W, rearranged as W = L / λ: with a constant admission rate the queue drains at λ, so the wait is the position divided by the rate. The k6 experiment E checks this promise against the measured wait (`wr_eta_error_seconds`).

---

**Q12.** With `EMAIL_LATENCY=50ms` and `NOTIFY_CONCURRENCY=1`, orders arrive at 100 per second for 60 s. Approximately what is the consumer lag at the end of the burst, and how long does it take to drain?

- A. 0 messages; Kafka absorbs the burst
- B. ≈ 4 800 messages; ≈ 240 s
- C. ≈ 6 000 messages; ≈ 60 s
- D. ≈ 1 200 messages; ≈ 12 s

??? success "Answer"
    **B — capacity 20/s, arrivals 100/s.**

    One thread at 50 ms per e-mail handles 20 messages/s. The backlog grows at 100 − 20 = 80/s, reaching ≈ 4 800 after 60 s, and drains at 20/s after the burst: 4 800 / 20 = 240 s. With 6 threads (120/s) the lag stays near zero; a seventh thread would be idle, since the topic has 6 partitions.

---

**Q13.** The waiting room's admitter is a `@Scheduled` method in `order`. You scale `order` to 3 replicas. What goes wrong, and what is a fix?

- A. Nothing; Redis serializes the pops
- B. Each replica admits N fans per second, so the real admission rate triples; run the admitter in a single instance (worker, leader election or a distributed lock)
- C. Fans lose their position in the queue
- D. The queue is split into three independent queues

??? success "Answer"
    **B — three schedulers, three times the rate.**

    `ZPOPMIN` is atomic, so no fan is admitted twice, but every replica pops its own N per second. The admission rate is the capacity knob of the whole on-sale, so it must be enforced once: a dedicated worker, a leader-elected scheduler, or a distributed lock such as ShedLock.

[Back to the lab](index.md){ .md-button }
