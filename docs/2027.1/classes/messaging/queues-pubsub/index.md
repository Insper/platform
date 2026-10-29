Every ticket sold on BoxOffice needs a PDF with a QR code. Generating it takes about 400 ms of CPU — far too slow to do inside the purchase request during a flash sale. The obvious fix is to put the job somewhere and let a pool of workers pick it up. That "somewhere" is the oldest and simplest messaging component: the **queue**. A few lines later the product team asks for an e-mail, a push notification, a search update and an analytics record for each purchase — four *different* services that each need their own copy. That is the second shape: **publish/subscribe**.

This page covers both shapes, how they behave under load, and the most famous queue of BoxOffice: the **waiting room** that keeps two million fans from crushing the seat inventory at 10:00.

---

## Point-to-point queues

A **message queue** holds messages until a consumer takes them. Each message is delivered to **one** consumer; many consumers can read the same queue, and they *compete* for messages — the **competing consumers** pattern[^1]. Adding consumers increases throughput without any change to the producer.

``` diagram-sim
flowchart LR
    order["order"] -->|"GenerateTicketPdf"| q[["queue: ticket-pdf"]]
    q -->|"msg 1"| w1["worker 1"]
    q -->|"msg 2"| w2["worker 2"]
    q -->|"msg 3"| w3["worker 3"]
    w1 --> os[("object store<br/>tickets/*.pdf")]
    w2 --> os
    w3 --> os
```

### The life of a message

A queue cannot simply delete a message when a consumer receives it: the consumer might crash halfway through. So delivery is a two-step protocol — **receive**, then **acknowledge**:

1. The consumer **receives** a message. The broker does not delete it; it hides it from other consumers (SQS calls this the **visibility timeout**; RabbitMQ keeps it as *unacknowledged* on that consumer's channel).
2. The consumer processes it and sends an **acknowledgement** (ack). Only now is the message deleted.
3. If the consumer crashes, or the visibility timeout expires before the ack, the message becomes visible again and **another consumer receives it**.

``` diagram-sim
sequenceDiagram
    participant Q as queue ticket-pdf
    participant W1 as worker 1
    participant W2 as worker 2
    Q->>W1: GenerateTicketPdf (order o-7731)
    Note over Q: message hidden for 30 s
    W1->>W1: render PDF...
    Note over W1: crashes before ack
    Note over Q: 30 s pass without ack: visible again
    Q->>W2: GenerateTicketPdf (order o-7731), delivery 2
    W2->>W2: render PDF, upload
    W2->>Q: ack
    Note over Q: message deleted
```

This protocol gives **at-least-once** delivery: no message is lost when a worker dies, but a message can be processed twice (worker 1 may have uploaded the PDF just before crashing). Every queue consumer must therefore be **idempotent** — see [Delivery semantics](../semantics/index.md). Here it is easy: the PDF is stored under a deterministic name (`tickets/o-7731.pdf`), so writing it twice gives the same result.

| Setting | What it controls | Typical choice |
|---|---|---|
| **Visibility timeout** (SQS) / ack timeout | How long a received message stays hidden before redelivery | A few times the p99 processing time (here: 30 s for a 400 ms job) |
| **Prefetch** (RabbitMQ `basic.qos`) / batch size | How many unacknowledged messages a consumer may hold | Small (1–20) for slow jobs, so work spreads evenly |
| **Max receive count** | How many deliveries before a message is moved to the dead letter queue | 3–10 |
| **Message retention** | How long an unconsumed message survives | SQS: 4 days by default, up to 14 days |
| **Delay** | Hide a new message for some time before first delivery | "Send the reminder 24 h before the show" |

!!! warning "A visibility timeout shorter than the job"
    If a job takes 45 s and the visibility timeout is 30 s, the message reappears while the first worker is still working on it: two workers process every slow message, the load doubles exactly when the system is slowest. Set the timeout above the p99 processing time, or have the worker extend it while it works (SQS `ChangeMessageVisibility`).

### Ordering

With competing consumers, **order is not preserved**: message 2 may finish before message 1 because they run on different workers. For most jobs (PDFs, e-mails) this is fine. When it is not, you need a way to serialize related messages:

- **FIFO queues with a group id** (SQS FIFO `MessageGroupId`, Azure Service Bus sessions): messages with the same group are delivered in order, one at a time; different groups run in parallel.
- **A partitioned log keyed by the entity** — Kafka, next page — gives the same "ordered per key, parallel across keys" behaviour at high throughput.

### Sizing the worker pool

Little's Law (see [Queueing](../../estimation/queueing/index.md)) tells you how many workers keep up with a steady arrival rate: the number of jobs in progress equals the arrival rate times the time each one takes.

$$
\text{busy workers} = \lambda \times S
$$

!!! example "BoxOffice: PDF workers for the flash sale"

    The stadium has 60,000 seats; fans buy on average 2 seats, so about 30,000 orders. Assume (illustratively) they are confirmed over the first 3 minutes: $\lambda \approx 30\,000 / 180 \approx 167$ orders/s, each needing one PDF of $S = 0.4$ s.

    - To keep up in real time: $167 \times 0.4 \approx 67$ workers busy all the time — about 95 workers to stay near 70% utilization (beyond that, queueing delay explodes; see the knee in [Queueing](../../estimation/queueing/index.md)).
    - With only 20 workers ($20 / 0.4 = 50$ PDFs/s), the backlog grows by $167 - 50 = 117$ per second, reaches about 21,000 after 3 minutes, and drains in $21\,000 / 50 \approx 7$ minutes after the sale.

    Which one is right? It depends on the **freshness objective**: if the product promises "your tickets arrive by e-mail within 15 minutes", 20 workers are enough and cost a fifth. Async work is sized against a *delay* target, not a request latency target.

<div class="csim" data-sim="queue" data-lambda="167" data-workers="95" data-service="0.4"></div>

!!! tip "Try it"
    The simulator starts with the example's numbers: 167 PDFs/s, 0.4 s each, 95 workers (ρ = 0.70). Press play.

    - Read the **Little** line: about 67 PDFs in the system = 166/s × 0.40 s. Little's law holds whatever the distribution of arrivals and service times.
    - Lower **Workers K** to 70 (ρ = 0.95), then 68 (ρ = 0.98): W goes from 0.40 s to 0.48 s and 0.68 s, and the queue starts to flicker. Below 67 there is no steady state: with 60 workers (ρ = 1.11) 2,006 jobs wait after 2 minutes and 4,151 after 4 — the backlog only grows. A pool this large has a sharp knee close to ρ = 1; the 70% target is headroom for bursts.
    - Back at 95, press **on-sale spike** (3× for 20 s): the backlog peaks at about 5,300 jobs, the oldest waits 22 s, and the queue is empty only about 100 s after the spike began — it drains at the spare 71 jobs/s.
    - Turn on **scale workers on backlog** and spike again: new workers need 15 s to start, so the peak barely changes (about 4,500), but the oldest job waits 9 s and the queue is empty after about 27 s.

---

## Backpressure { #backpressure }

**Backpressure** is any mechanism by which a slow consumer makes a fast producer slow down — or at least makes the system *notice* that it cannot keep up. Without it, a queue between a fast producer and a slow consumer is just a place where the problem grows quietly.

A queue that is allowed to grow without limit is a lie: memory or disk runs out eventually, and long before that the messages at the tail become **stale** (a "your seats are held" push that arrives two hours late is worse than none). Every queue needs an answer to "what happens when it is full?"[^2]:

| Strategy | What happens | BoxOffice example | Cost |
|---|---|---|---|
| **Buffer (bounded)** | Absorb up to N messages or T minutes of backlog | PDF queue absorbs the on-sale spike | Delay grows with the backlog |
| **Scale consumers** | Add workers when depth or lag grows | KEDA scales PDF workers on queue length | Needs headroom downstream (DB, object store) |
| **Reject at the edge** | Refuse new work with `429`/`503` + `Retry-After` | Gateway rejects purchases when the waiting room is full | Users see an error — but a fast, honest one |
| **Slow the producer** | Producer blocks or receives fewer credits | Kafka producer blocks when its buffer is full (`max.block.ms`) | The latency moves to the producer |
| **Drop / expire** | Discard low-value or old messages | Drop "seats left" updates older than 30 s; TTL on push notifications | Data loss, by design |
| **Shed by priority** | Keep critical messages, drop or delay the rest | Purchase confirmations before marketing e-mails | Requires separate queues or priorities |

!!! tip "Monitor age, not only depth"
    Queue depth alone is ambiguous: 50,000 messages is fine for a pool that does 10,000/s and a disaster for one that does 10/s. The **age of the oldest message** (SQS `ApproximateAgeOfOldestMessage`, Kafka consumer lag in time) is what the user feels. Write the freshness SLO on it — "99% of confirmation e-mails sent within 2 minutes" — and alert when it is at risk (see [SLOs](../../observability/slo/index.md)).

---

## The flash-sale waiting room { #the-flash-sale-waiting-room }

At 10:00, two million fans arrive for 60,000 seats. `inventory` can hold seats safely (with row locks, see [Transactions](../../databases/transactions/index.md)) at about 1,100 holds per second — the order of magnitude of [class 2](../../estimation/index.md)'s estimate, against 33,000 that arrive; you would measure it with a load test. Letting everybody hit the purchase path at once does not sell tickets faster; it makes the database thrash and the whole site fail.

The **virtual waiting room** is a queue placed *in front of* the purchase flow, at the edge:

1. Fans who arrive are given a **position** in the waiting room instead of the purchase page.
2. An **admission job** lets fans out at a controlled rate, matched to what `inventory` can handle with margin.
3. An admitted fan receives a short-lived, signed **admission token**; the gateway rejects purchase calls without one.
4. When the inventory reaches zero, the waiting room tells everybody still waiting "sold out" — cheaply, from the edge, without touching the database.

``` diagram-sim
sequenceDiagram
    participant F as Fan
    participant W as waiting room (edge)
    participant R as Redis (queue)
    participant G as gateway
    participant I as inventory
    F->>W: GET /events/ev-88/buy (10:00:01)
    W->>R: ZADD room:ev-88 score=arrival fan-123
    W-->>F: position 512,384 (about 17 min)
    loop every 15 s
        F->>W: GET /room/status
        W->>R: ZRANK room:ev-88 fan-123
        W-->>F: position 30,112
    end
    Note over R: admission job: 500 fans/s
    W-->>F: admitted + token (valid 10 min)
    F->>G: POST /holds (Authorization: admission token)
    G->>I: hold seats B-12, B-13
    I-->>F: held until 10:21
```

The queue itself can be very simple. A Redis sorted set ordered by arrival time gives positions in $O(\log n)$:

```text
# a fan joins (score = arrival time in ms; NX: joining twice keeps the first position)
ZADD room:ev-88 NX 1804406400123 fan-123

# where am I? (0-based rank)
ZRANK room:ev-88 fan-123

# admission job, once per second: let the next 500 fans in
ZPOPMIN room:ev-88 500

# how many are still waiting?
ZCARD room:ev-88
```

Design decisions worth discussing:

- **Admission rate.** It is a capacity number, not a guess: measured `inventory` throughput × a safety factor (say 50%): about 1,100 × 0.5 ≈ 500 fans/s, the rate used above. It can adapt: slow admissions down when `inventory` p99 or error rate rises — a feedback loop.
- **Fairness.** Strict FIFO rewards whoever has the lowest latency to the data center (and bots). Many ticketing sites give fans who arrived *before* the on-sale time a **random** position at 10:00, and FIFO only after that.
- **Bots.** The waiting room is the place to require a challenge and apply bot detection and per-account limits (see [Traffic & edge](../../edge/index.md)).
- **Hold expiry.** Admission gives a fan a time-boxed right to buy; the seat hold expires (here, after 10 minutes) and the seats go back to the pool. That is a timer — another asynchronous job.
- **Where it runs.** Positions are served from the edge (CDN functions or a small, horizontally scaled service with Redis), so polling by two million browsers never reaches the core services.

!!! example "In the BoxOffice code: the waiting room in `order` (lab 7)"

    [Hands-on 7 — Waiting room](../../../hands-on/7/waiting-room/index.md) builds a smaller version of this design. The queue is the same Redis sorted set, but the score comes from `INCR`, not from a timestamp: the server decides the order, because clients' clocks lie. Every second `admit()` pops `admit-per-second` fans (20 by default) and gives each an *admitted* key with a 5-minute TTL — a Redis key, not a signed token — and `mayEnter` is checked by `POST /orders`, not by the gateway: the lab says so, and calls moving the gate to the edge a good extension. Look at the comment on `admit()`: with three `order` replicas, three schedulers would admit three times the rate. In the lab's spike (about 700 fans in 40 s, 10 admitted per second), the order latency stays flat and the actual wait stays within a couple of seconds of the ETA promised at join — Little's law is an honest promise when the rate is constant.

    ``` { .java title="services/order/src/main/java/boxoffice/order/waitingroom/WaitingRoom.java (join, admit, gate)" }
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/waitingroom/WaitingRoom.java:36:41,57:80"
    ```

!!! info "Try it in the playground"

    The `flash-sale` scenario is a generic version of BoxOffice at 10:00, and it starts **without** a waiting room: `users → lb → app → inventory-db`, with buyers also calling the `payment provider` (quota 500 req/s). Press **Run**: when the sale opens (t = 60 s) the traffic jumps 20×, `app` saturates and errors appear; raise its replicas and `inventory-db` and the payment provider saturate instead. Then open it in the full playground (↗) and build the waiting room — an API Gateway that sends writes to a Message Queue drained by `order` workers (the hints, or **Show a possible solution**). The number of workers is the admission rate: with too few, the consumer lag (how long a buyer waits in line) passes the 300 s goal; with too many, `inventory-db` and the payment quota are under pressure again. Find the count that keeps both within their goals.

<div class="sdp" data-scenario="flash-sale" data-mode="compact" data-height="560"></div>

---

## Publish/subscribe { #pubsub }

In **publish/subscribe** (pub/sub) the producer publishes to a **topic**, and each **subscription** to that topic receives its own copy of every message[^3]. Inside one subscription, consumers compete as in a queue; *across* subscriptions, every subscription sees everything. In effect, each subscription is a queue that the broker fills automatically.

``` diagram-sim
flowchart LR
    order["order"] -->|"OrderConfirmed"| t{{"topic: order-events"}}
    t --> s1[["sub: notification"]]
    t --> s2[["sub: search"]]
    t --> s3[["sub: analytics"]]
    s1 --> n1["notification #1"]
    s1 --> n2["notification #2"]
    s2 --> se["search indexer"]
    s3 --> an["analytics loader"]
```

Adding a fourth consumer — say, a loyalty program that grants points — is a new subscription. The `order` service does not change, is not redeployed and does not even know. That is the main reason to use pub/sub: **the producer is decoupled from the set of consumers**.

### Push or pull

| | Pull subscription | Push subscription |
|---|---|---|
| **How** | Consumers ask the broker for messages | The broker calls an HTTPS endpoint of the consumer |
| **Flow control** | Natural: consumers take what they can handle | The broker must back off when the endpoint errors or slows |
| **Good for** | Long-running workers, high throughput, batching | Serverless consumers (Cloud Run, Lambda), webhooks, low volume |
| **Examples** | Google Cloud Pub/Sub pull, SQS, Kafka | Google Cloud Pub/Sub push, Amazon SNS to HTTPS, EventBridge targets |

### Filtering and routing

Not every subscriber wants every message. Brokers let a subscription declare a **filter** on message attributes, so only matching messages are copied to it — for example, the SMS service subscribes only to `OrderConfirmed` events whose `channel` attribute is `sms`. RabbitMQ generalizes this with **exchanges**: a `fanout` exchange copies to every bound queue, a `direct` exchange routes by an exact routing key, and a `topic` exchange routes by patterns such as `order.*.br`.

### Durable and ephemeral pub/sub

Some pub/sub systems do not store messages at all: Redis Pub/Sub and core NATS deliver a message only to subscribers connected *at that moment*. If a subscriber is down, it simply misses the message. That is perfect for "user is typing…" indicators in a chat and unacceptable for order confirmations. Durable pub/sub (Google Cloud Pub/Sub, SNS → SQS, NATS JetStream, Kafka) keeps each subscription's messages until they are acknowledged.

!!! example "BoxOffice: the SNS → SQS fan-out"

    On AWS, a common way to build the `order-events` fan-out is an SNS topic with one SQS queue subscribed per consumer service. SNS copies every `OrderConfirmed` into each queue; each service reads its own queue with competing consumers and its own retry policy and DLQ. A slow `analytics` loader only grows the `analytics` queue. This is the same picture as the diagram above, built from two managed services.

---

## Queue, pub/sub or log?

The next page introduces the third shape, the **log** (Kafka, Kinesis). The table summarizes all three; the main question is what happens to a message after it is read.

| | Queue | Pub/Sub | Log (stream) |
|---|---|---|---|
| **Delivery** | each message to one consumer | each message to every subscription | every consumer group reads everything |
| **After reading** | deleted on ack | deleted per subscription on ack | kept until retention expires |
| **Replay old messages** | no | limited (some offer seek/snapshot) | yes: reset the offset |
| **Per-message ack and redelivery** | yes | yes | no: a consumer commits a *position* |
| **Ordering** | none (FIFO queues: per group) | none (optional ordering keys) | per partition (per key) |
| **New consumer sees** | only new messages | only messages after it subscribes | history still in retention |
| **Throughput** | high | high | very high (sequential I/O, batching) |
| **Typical use** | jobs, tasks, commands | notifications, fan-out of events | event backbone, analytics, CDC, replay |

### Products

=== "AWS"

    - **Amazon SQS** — fully managed queue; standard (at-least-once, best-effort order) and FIFO (ordered per `MessageGroupId`, deduplication window).
    - **Amazon SNS** — pub/sub; fan-out to SQS, Lambda, HTTPS, e-mail, SMS.
    - **Amazon EventBridge** — event bus with content-based routing rules and a schema registry.
    - **Amazon MQ** — managed RabbitMQ / ActiveMQ for existing applications.

=== "Google Cloud"

    - **Cloud Pub/Sub** — global pub/sub with pull and push subscriptions, ordering keys, dead letter topics, filters.
    - **Cloud Tasks** — queue for explicit, rate-limited calls to HTTP handlers (commands).
    - **Eventarc** — routes events from Google services and Pub/Sub to Cloud Run and other targets.

=== "Azure"

    - **Azure Service Bus** — queues and topics with subscriptions, sessions (ordered groups), dead-lettering, transactions.
    - **Azure Event Grid** — push-based event routing between Azure services and webhooks.
    - **Azure Queue Storage** — simple, cheap queue on top of storage accounts.

=== "Open source"

    - **RabbitMQ** — the classic AMQP broker; exchanges for routing, quorum queues (Raft-replicated), and streams.
    - **NATS** — very light pub/sub; **JetStream** adds persistence, replay and acknowledgements.
    - **Redis** — Lists (`LPUSH`/`BRPOP`) as simple queues, Pub/Sub (ephemeral), Streams (log with consumer groups).
    - **Apache ActiveMQ Artemis**, **Apache Pulsar** (pub/sub and log in one system).

!!! tip "In the interview"
    When you draw a queue, say three things about it: **who consumes** (one worker pool, or one subscription per service), **what happens on failure** (visibility timeout → redelivery → DLQ after N attempts, so consumers are idempotent) and **what happens when it fills up** (bounded, autoscaled on age of oldest message, or rejecting at the edge). For a flash sale, propose the waiting room before the interviewer asks "what happens at 10:00?" — and size the admission rate from the inventory's measured throughput.

!!! success "Best practices"

    - **Attach a dead-letter queue with a maximum receive count to every work queue** — e.g. 5 attempts: a poison job leaves the queue instead of running forever.
    - **Make the admission rate a configuration value derived from measured capacity** — about 50% of what `inventory` sustains, changed without a deploy. In BoxOffice: `ADMIT_PER_SECOND` feeds `WaitingRoomProperties` ([waiting-room box](#the-flash-sale-waiting-room)).
    - **Run singleton jobs once per cluster** — leader election or a distributed lock for the admitter: three replicas running it admit three times the rate. In BoxOffice: the comment on `WaitingRoom.admit()`, and the lab's pitfalls ([lab 7 — waiting room](../../../hands-on/7/waiting-room/index.md)).
    - **Promise an ETA computed from the queue, not a spinner** — Little's law, `wait = position / admission rate`; in lab 7 the actual wait stayed within a couple of seconds of the promised ETA.
    - **Give each subscriber its own durable queue in a fan-out** (SNS → one SQS queue per service) — each one retries, scales and dead-letters on its own, so a slow analytics consumer never delays confirmations.
    - **Use long polling for pull consumers** (SQS `WaitTimeSeconds=20`) — idle workers stop making empty receives, which cuts cost and API calls.

!!! warning "Common pitfalls"

    - **Unbounded queues.** "The queue will absorb it" until the backlog is three hours old and every message is stale. Set limits, TTLs and alerts on age.
    - **Visibility timeout shorter than processing time** — every slow job runs twice.
    - **Non-idempotent consumers** on an at-least-once queue: duplicate e-mails, duplicate charges.
    - **Ephemeral pub/sub for important events** — Redis Pub/Sub drops messages for disconnected subscribers.
    - **One queue for everything.** A burst of marketing e-mails delays purchase confirmations. Separate queues (or priorities) by importance.
    - **Forgetting the downstream.** Autoscaling workers from 20 to 200 moves the bottleneck to the database they write to.

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    P["producer: order"] --> Q["queue<br/>competing consumers"]
    Q --> ACK["receive, then ack<br/>visibility timeout"]
    ACK --> ALO["at-least-once<br/>→ Delivery semantics"]
    Q --> LL["worker pool sized by<br/>Little's Law → Estimation"]
    Q --> BP["backpressure: bound,<br/>scale, reject, drop"]
    BP --> AGE["age of oldest message<br/>→ freshness SLO"]
    WR["waiting room<br/>Redis sorted set"] --> TOK["admission token<br/>checked at the gateway"]
    TOK --> INV["inventory holds on SQL<br/>→ Databases"]
    P --> T["pubsub topic"]
    T --> SUBS["one subscription<br/>per consumer service"]
    T --> LOG["need replay or order per key?<br/>→ Kafka"]
```

**Palette components:** [`queue`](../../../reference/components/messaging/index.md#queue) · [`pubsub`](../../../reference/components/messaging/index.md#pubsub) · [`worker`](../../../reference/components/compute/index.md#worker) · [`objstore`](../../../reference/components/storage/index.md#objstore) (the PDFs) · [`cache`](../../../reference/components/storage/index.md#cache) (Redis waiting room) · [`apigw`](../../../reference/components/edge/index.md#apigw) (rejects calls without an admission token) · [`waf`](../../../reference/components/edge/index.md#waf) (bots at the waiting room) · [`sql`](../../../reference/components/storage/index.md#sql) (`inventory`) · [`notifications`](../../../reference/components/compute/index.md#notifications) (one subscription). **Scenarios:** `async-queue`, `flash-sale`, `notification-system`, `chat` (ephemeral pub/sub). **Continues in:** [Kafka and event logs](../kafka/index.md), [Delivery semantics](../semantics/index.md), [Compute — async work](../../compute/async-work/index.md), [Estimation — queueing](../../estimation/queueing/index.md), [Observability — SLOs](../../observability/slo/index.md), [Traffic & edge — WAF and bots](../../edge/index.md#edge-security), [Hands-on 7 — waiting room](../../../hands-on/7/waiting-room/index.md).

---

[^1]: HOHPE, G.; WOOLF, B. *Enterprise Integration Patterns*. Addison-Wesley, 2003. Patterns "Point-to-Point Channel", "Competing Consumers" and "Publish-Subscribe Channel".
[^2]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2nd ed. O'Reilly. Section on messaging systems: what happens if producers send faster than consumers can process.
[^3]: [Amazon SQS Developer Guide — Visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html){target="_blank"}; [Google Cloud Pub/Sub — Overview](https://cloud.google.com/pubsub/docs/overview){target="_blank"}; [RabbitMQ — Consumer Acknowledgements and Publisher Confirms](https://www.rabbitmq.com/docs/confirms){target="_blank"}.
