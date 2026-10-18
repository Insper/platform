Click **"Answer"** to reveal the correct answer and explanation.

---

## Synchronous vs asynchronous

**Q1.** The BoxOffice purchase calls `order` (99.95%) and then, synchronously, `notification`, `search` and `analytics` (99.9% each). The team changes the three downstream calls into an event published to Kafka (99.95%). What happens to the availability of the purchase?

- A. It stays the same: the same services are involved
- B. It goes from about 99.65% to about 99.90%
- C. It goes from about 99.9% to 100%, because events never fail
- D. It gets worse, because Kafka is one more component in the chain

??? success "Answer"
    **B — from about 99.65% to about 99.90%.**

    Synchronously the purchase needs all four: $0.9995 \times 0.999^3 \approx 0.9965$. With events it needs only `order` and the broker: $0.9995 \times 0.9995 \approx 0.9990$. The downstream services can still fail, but now their failure delays an e-mail or an index update instead of failing a sale. Kafka is indeed one more component (D), but it replaces three synchronous dependencies.

---

**Q2.** During a flash sale, purchase requests enter a queue at **5,000 per second for 2 minutes**, and the workers process **3,000 per second**. Ignoring traffic before and after, what is the backlog at the end of the spike, and how long does the last request wait?

- A. 240,000 messages; about 80 seconds
- B. 600,000 messages; about 200 seconds
- C. 240,000 messages; about 48 seconds
- D. 120,000 messages; about 40 seconds

??? success "Answer"
    **A — 240,000 messages; about 80 seconds.**

    The backlog grows at the difference of the rates: $(5000 - 3000) \times 120 = 240{,}000$. By Little's Law, the waiting time is the backlog divided by the throughput that drains it: $240{,}000 / 3000 = 80$ s. (600,000 is the total that arrived, not the backlog; 48 s would divide by the arrival rate.)

---

**Q3.** The backlog of the `ticket-pdf` queue has grown steadily for three days, through quiet hours and busy hours alike. What does this tell you?

- A. Nothing: queues exist to absorb load
- B. The average arrival rate is above the consumers' capacity; the queue is hiding a permanent shortage, not absorbing a spike
- C. The visibility timeout is too long
- D. The broker is running out of disk and must be replaced by Kafka

??? success "Answer"
    **B — a permanent shortage.**

    A queue absorbs spikes: the backlog grows during the peak and drains when arrivals fall below capacity. A backlog that grows even in quiet hours means the consumers are slower than the producers *on average*; no queue size fixes that. Add capacity (more or faster workers), reduce the work, or shed it — and alert on the age of the oldest message so this is noticed in hours, not days.

---

## Queues and pub/sub

**Q4.** A PDF worker takes **45 s** to render a large ticket bundle, and the SQS **visibility timeout is 30 s**. What happens?

- A. The message is deleted after 30 s and the PDF is lost
- B. SQS waits automatically for the worker to finish
- C. The message becomes visible again while the first worker is still processing it, so a second worker processes it too — every slow job runs (at least) twice
- D. The worker receives a timeout exception and stops

??? success "Answer"
    **C — the slow job is processed twice.**

    The visibility timeout only hides the message; if no ack arrives before it expires, the broker assumes the consumer died and redelivers. Set the timeout above the p99 processing time (or extend it while working with `ChangeMessageVisibility`), and keep the consumer idempotent anyway — redelivery also happens after real crashes.

---

**Q5.** Why does BoxOffice put a **waiting room** (a queue at the edge) in front of the purchase flow at 10:00?

- A. To sell tickets faster by processing all two million requests in parallel
- B. To admit fans at the rate `inventory` can handle safely, give everyone an honest position, and tell late fans "sold out" without touching the database
- C. To cache the seat map at the CDN
- D. To make purchases asynchronous, so fans receive their seats by e-mail

??? success "Answer"
    **B — admission at a controlled rate.**

    Sending two million fans to the seat-hold path at once does not sell faster; it saturates the database and fails everyone. The waiting room turns the spike into an ordered backlog, admits fans at a rate derived from `inventory`'s measured throughput (with margin), and answers "sold out" from the edge once the inventory is gone. The purchase itself stays synchronous for the admitted fan (D is wrong).

---

**Q6.** The data team wants to load every order event of the **last seven days** into the warehouse, including events published before their loader existed. Which messaging shape supports this directly?

- A. A point-to-point queue with competing consumers
- B. Ephemeral pub/sub (Redis Pub/Sub)
- C. A pub/sub subscription created today
- D. A log (Kafka or another event stream) with 7 days of retention: a new consumer group starts from the oldest offset

??? success "Answer"
    **D — a log with retention.**

    In a queue, consumed messages are deleted; a new subscription only receives messages published after it was created; ephemeral pub/sub keeps nothing. A log keeps records until the retention expires regardless of who read them, so a new consumer group with `auto.offset.reset=earliest` reads the whole week.

---

## Kafka

**Q7.** `order-events` has **8 partitions**. The `notification` service runs **12 instances** in the same consumer group. How many instances receive records?

- A. 12 — Kafka balances records across all instances
- B. 8 — each partition is assigned to one consumer of the group; 4 instances sit idle
- C. 4 — Kafka assigns two partitions per instance
- D. 1 — only the group leader reads

??? success "Answer"
    **B — 8 active, 4 idle.**

    Within a group, each partition is owned by exactly one consumer (that is how per-partition order is preserved). The maximum parallelism of a group is the number of partitions. To use 12 instances you need at least 12 partitions — which is why partitions are sized with headroom up front.

---

**Q8.** A developer keys `order-events` by **`eventId`** (the show) "so all purchases of a show are together". During the stadium on-sale, 60% of purchases are for one show. What is the main consequence?

- A. Nothing: Kafka spreads records with the same key across partitions
- B. Better throughput, because related records are batched together
- C. One hot partition receives about 60% of the traffic; one consumer does most of the work and adding consumers does not help
- D. Records of the same order are read out of order

??? success "Answer"
    **C — a hot partition.**

    The default partitioner sends equal keys to the same partition, so a dominant key concentrates load on one partition, one broker and one consumer. Choose the finest key that still preserves the order the business needs: purchases need per-order ordering, so key by `orderId`.

---

**Q9.** A topic has **replication factor 3** and **`min.insync.replicas=2`**; producers use **`acks=all`**. Two of the three brokers holding a partition fail. What happens to writes to that partition?

- A. They continue normally on the remaining broker
- B. They are accepted with `acks=1` automatically
- C. They are rejected (not enough in-sync replicas) until at least one more replica is back in sync — no acknowledged write can exist on a single machine
- D. Kafka elects an out-of-sync replica as leader to keep accepting writes

??? success "Answer"
    **C — rejected until two replicas are in sync.**

    With one broker down, two replicas remain and writes continue. With two down, only one replica is in sync, below `min.insync.replicas=2`, so the broker refuses `acks=all` writes (`NotEnoughReplicas`). That is the point of the setting: favour durability over availability for business events. D describes unclean leader election, which is disabled by default because it can lose acknowledged data.

---

**Q10.** The `analytics` consumer processes **25 records per second per partition** (it writes each record to a warehouse staging table). The target peak is **600 records per second**, and the producer side is not a bottleneck. What is the minimum number of partitions?

- A. 6
- B. 24
- C. 25
- D. 600

??? success "Answer"
    **B — 24.**

    $N \ge T / c = 600 / 25 = 24$ partitions, one consumer per partition. In practice you would round up for growth (for example, 32) because adding partitions later moves keys between partitions. Alternatively, the consumer could batch its writes and raise $c$.

---

## Delivery semantics

**Q11.** `notification` commits the offset **after** sending the e-mail. The pod is killed during a deploy right after the e-mail is sent and before the commit. What happens, and what is the right fix?

- A. The e-mail is lost; commit before sending instead
- B. The record is redelivered and the e-mail is sent again; make the consumer idempotent (dedup by event id, idempotency key towards the provider)
- C. Kafka detects the duplicate automatically thanks to the idempotent producer
- D. Nothing: Kafka transactions make the e-mail exactly-once

??? success "Answer"
    **B — duplicate; make the consumer idempotent.**

    Committing after processing gives at-least-once delivery: after the crash the new owner of the partition resumes from the last committed offset and processes the record again. Committing first (A) turns duplicates into losses. The idempotent producer (C) only removes duplicates between producer and broker, and Kafka transactions (D) cannot cover a side effect outside Kafka such as an e-mail.

---

**Q12.** Which implementation of an idempotent consumer is **correct**?

- A. Check `processed_events` for the event id; if absent, process; in a separate transaction later, insert the id
- B. Insert the event id into `processed_events` (unique key) and apply the business change **in the same database transaction**; skip if the insert finds a conflict; commit the offset afterwards
- C. Generate a new UUID for each delivery and store it
- D. Keep processed ids in the consumer's memory

??? success "Answer"
    **B — dedup row and business change in one transaction.**

    If the service crashes before the commit, neither the dedup row nor the change exists, and the redelivery is processed normally; after the commit, the redelivery hits the unique key and is skipped. A leaves a window where a crash duplicates or loses the change; C defeats deduplication (the id must belong to the event, created once by the producer); D is lost on restart and not shared between instances.

---

**Q13.** BoxOffice adds a field to `OrderConfirmed`. Which change is **compatible** in both directions (full compatibility), so producers and consumers can be deployed in any order?

- A. Renaming `total` to `totalCents`
- B. Changing `total` from a number in reais to a number in cents
- C. Adding `currency` with a default value of `"BRL"`
- D. Removing the required field `orderId`

??? success "Answer"
    **C — add an optional field with a default.**

    New consumers reading old records get the default; old consumers ignore the new field. Renaming (A) and removing a required field (D) break readers; changing the meaning of a field (B) is worse — it breaks nothing visibly and computes wrong values. Breaking changes go to a new topic version.

---

## Patterns

**Q14.** `order` commits the confirmed order to PostgreSQL and then publishes `OrderConfirmed` to Kafka. Occasionally a confirmed order never produces an e-mail. What is the standard fix?

- A. Publish to Kafka first and then commit to the database
- B. Retry the publish three times
- C. A transactional outbox: insert the event into an `outbox` table in the same transaction as the order, and let a relay (polling or CDC) publish it at least once
- D. Use a distributed transaction (2PC) between PostgreSQL, Kafka and the payment provider

??? success "Answer"
    **C — transactional outbox.**

    The problem is a dual write: two systems, no shared transaction, and a crash between the writes loses the event. Swapping the order (A) creates phantom events instead; retries (B) do not help if the process dies; 2PC (D) is not supported by the external provider and blocks participants when the coordinator fails. The outbox makes the event part of the local transaction; the relay publishes it, possibly twice, so consumers stay idempotent.

---

**Q15.** In the purchase saga, the payment provider **does not answer** the charge request within the timeout. What should the orchestrator do?

- A. Release the seats and cancel the order immediately — no answer means no charge
- B. Charge again with a new idempotency key
- C. Query the provider using the order's idempotency key (or wait for its webhook) and reconcile: continue the saga if the charge succeeded, compensate only if it did not happen
- D. Mark the order `CONFIRMED`, since most payments succeed

??? success "Answer"
    **C — reconcile before compensating.**

    A timeout means "unknown", not "failed": the charge may have succeeded and only the answer was lost. Compensating blindly (A) leaves a charged customer without tickets; a new idempotency key (B) risks a double charge; assuming success (D) gives away seats. Query by the original idempotency key, then continue (seats `SOLD`, order `CONFIRMED`) or compensate (release seats, cancel order).
