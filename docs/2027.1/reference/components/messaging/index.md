# Messaging

**Messaging** components put an **asynchronous boundary** between the part of the system that produces work and the part that does it. Instead of calling a service and waiting, a producer writes a message to a broker and moves on; consumers read it when they can. That single change decouples the two sides in **time** (the consumer may be down or slow), in **rate** (a spike becomes a backlog that drains at the consumers' pace) and in **knowledge** (the producer does not need to know who consumes). The price: the result is no longer immediate, messages can arrive twice or out of order, and you now have to watch backlogs and lag.

In BoxOffice, the waiting room of the flash sale is a queue; `order` publishes `OrderConfirmed` events to Kafka, and `notification`, `analytics` and `search` each consume them independently; e-mail sending sits behind a queue so a slow provider never slows checkout.

| Component | One-liner | Playground id |
|---|---|---|
| [Message Queue](#queue) | Each message is processed by one of the competing consumers; work distribution | `queue` |
| [Pub/Sub](#pubsub) | Each message is delivered to every subscriber; fan-out of notifications | `pubsub` |
| [Event Stream](#stream) | An ordered, retained, partitioned log that consumers read at their own position | `stream` |
| [Kafka](#kafka) | The most widely used event-streaming platform (topics, partitions, consumer groups) | `kafka` |

``` mermaid
flowchart LR
    P1[order] -->|OrderConfirmed| K[(Kafka topic)]
    K --> N[notification]
    K --> A[analytics]
    K --> S[search]
    W[gateway] -->|admission tickets| Q[[Queue: waiting room]]
    Q --> I1[inventory worker]
    Q --> I2[inventory worker]
```

| | Queue | Pub/Sub | Event stream / Kafka |
|---|---|---|---|
| Who gets a message | one consumer | every subscriber | every consumer group (one consumer per partition inside a group) |
| After consumption | deleted (acked) | deleted per subscription | kept until retention expires; can be replayed |
| Ordering | usually none (FIFO variants exist) | usually none | per partition (per key) |
| Typical use | background jobs, buffering spikes | notifications, cache invalidation, fan-out | event-driven architecture, CDC, analytics pipelines |

---

## Message Queue { #queue }

**What it is.** A message queue stores messages until a consumer takes them. Several consumers can read from the same queue — **competing consumers** — and each message goes to only **one** of them, so adding consumers increases throughput. A consumer **acknowledges** a message after processing it; if it crashes before the ack, the message becomes visible again (after a *visibility timeout*) and another consumer retries it. Messages that keep failing are moved to a **dead-letter queue (DLQ)** for inspection.

**When to use.**

- Background work the user does not need to wait for: sending e-mails, generating PDF tickets, transcoding videos, resizing posters.
- **Absorbing spikes**: producers enqueue at 10× the rate for a minute; consumers drain at a steady rate — the backlog is the buffer (scenario `async-queue`).
- **Load leveling in front of a fragile resource**: BoxOffice's waiting room admits fans into `inventory` at the rate the database can sustain.
- Retrying calls to unreliable external providers without blocking the request path.

**When not to (or watch out).**

- When the caller needs the result now (show the seat as held): keep that path synchronous.
- When several independent services need the same message: use pub/sub or a stream, not one queue per consumer glued by hand.
- Delivery is usually **at-least-once**: a message may be processed twice → consumers must be **idempotent**.
- Ordering is usually not guaranteed (or limited to FIFO queues with lower throughput).
- A growing backlog is a silent failure: monitor queue depth and the age of the oldest message, and alert on them.

**Key numbers.**

| Metric | Typical value | Note |
|---|---|---|
| Enqueue latency (managed queue) | ≈ a few to tens of ms | Producer gets an ack and continues |
| Drain time of a backlog | backlog ÷ (consumer rate − arrival rate) | 120 k messages, consumers 2 k/s faster than arrivals ⇒ 60 s |
| SQS visibility timeout | default 30 s, max 12 h | Must exceed the processing time |
| SQS retention | default 4 days, max 14 days | Older messages are dropped |
| Message size | small — KBs, up to the broker's limit | Large payloads by reference (claim check: store in object store, send the key) |

**Failure modes.**

- **Poison message** — one message always crashes the consumer and is retried forever → max receive count, then DLQ.
- **Duplicate processing** — consumer crashed after doing the work but before the ack → idempotent consumer (dedupe by message id).
- **Unbounded backlog** — consumers slower than producers for a long time → autoscale consumers on queue depth, backpressure, shed or reject at the edge.
- **Visibility timeout too short** — slow messages reappear and are processed in parallel by two consumers → timeout longer than p99 processing time, heartbeat extension.
- **Consumer overload of the downstream** — scaling consumers floods the database → cap consumer concurrency.

**In the playground.** `queue` is a **messaging** node and therefore an **async boundary**: the producer gets an ack after the broker's few milliseconds, the message enters the **backlog**, and downstream consumers (e.g. `worker`) drain it at their capacity, each message going to **one** consumer. Watch the metrics backlog, consumer lag (s) and end-to-end (async) latency; when the backlog exceeds its maximum or retention, messages are dropped and counted as errors. Scale the consumers' `replicas` or `autoscale` to drain faster. Scenarios: [`async-queue`](../../../../playground/scenarios/index.md#async-queue), [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale), [`notification-system`](../../../../playground/scenarios/index.md#notification-system), [`video-streaming`](../../../../playground/scenarios/index.md#video-streaming).

**Real products.**

=== "AWS"

    - **Amazon SQS** — fully managed queues: Standard (at-least-once, best-effort order) and FIFO (ordered, exactly-once processing within a deduplication window).
    - **Amazon MQ** — managed RabbitMQ and ActiveMQ.

=== "GCP"

    - **Cloud Tasks** — managed queue of HTTP tasks with rate limits and retries.
    - **Pub/Sub** with pull subscriptions — competing consumers on one subscription.

=== "Azure"

    - **Azure Service Bus** (queues) — enterprise messaging with sessions, DLQ and transactions.
    - **Azure Queue Storage** — simple, cheap queues.

=== "Open source"

    - **RabbitMQ** — the classic message broker (AMQP), queues and exchanges.
    - **Apache ActiveMQ** — JMS message broker.
    - **Redis Streams** / libraries such as **Celery** (Python) and **BullMQ** (Node.js) — job queues on top of Redis or RabbitMQ.

!!! tip "In the interview"
    "Anything the user doesn't need to wait for goes to a queue: checkout responds immediately and workers send the e-mail and generate the ticket. The queue absorbs spikes, retries failures and parks poison messages in a DLQ; because delivery is at-least-once, the consumers are idempotent, and I alert on queue depth and the age of the oldest message."

**Learn more:** [Messaging › Queues & pub/sub](../../../classes/messaging/queues-pubsub/index.md) · [Messaging › Delivery semantics](../../../classes/messaging/semantics/index.md) · [Compute › Async work](../../../classes/compute/async-work/index.md) · [Case study: notification system](../../../classes/case-studies/notification-system/index.md) · [Hands-on 7](../../../hands-on/7/index.md)

---

## Pub/Sub { #pubsub }

**What it is.** In publish/subscribe, a producer publishes a message to a **topic** and the broker delivers a **copy to every subscription**. Publishers don't know who listens; adding a new subscriber requires no change to the publisher. Each subscription behaves like its own queue (with acks and retries). Classic pub/sub systems delete a message once each subscription has acknowledged it, and are optimized for low-latency fan-out rather than long retention or replay.

**When to use.**

- **Fan-out of events** to several independent services: `EventCancelled` → refunds, notifications, search index, cache invalidation.
- Real-time delivery across servers: in a chat, the server that receives a message publishes it on the conversation's channel and the servers holding the recipients' WebSockets deliver it (scenario `chat`).
- Cache invalidation across many app replicas.
- Notifications to many endpoints (mobile push, e-mail, webhooks) through per-channel subscriptions.

**When not to (or watch out).**

- When you need to **replay** history or add a consumer that must read past events: use an event stream (Kafka) with retention.
- When only one worker should process each message: that is a queue (or one subscription with competing consumers).
- Ordering across messages is usually not guaranteed; per-key ordering may be an option with lower throughput.
- In-memory pub/sub (Redis Pub/Sub) is fire-and-forget: subscribers that are offline **lose** the messages.
- Fan-out multiplies load: one publish × N subscribers × their downstream calls.

**Key numbers.**

| Metric | Typical value | Note |
|---|---|---|
| Publish-to-deliver latency | ≈ tens of ms (managed services) | ≈ illustrative; in-memory brokers ≈ sub-ms to a few ms |
| Fan-out cost | one publish → N deliveries | N subscriptions × message rate = delivery rate |
| GCP Pub/Sub message retention | default 7 days on subscriptions (configurable) | Unacked messages are redelivered |
| Max message size | from ≈ 256 KB (SNS) to 10 MB (GCP Pub/Sub) | Documented limits; large payloads by reference |
| Delivery semantics | at-least-once (typical) | Subscribers must be idempotent |

**Failure modes.**

- **Slow subscriber** — one subscription accumulates a backlog while the others are fine → per-subscription monitoring, scale that consumer, DLQ.
- **Lost messages** with fire-and-forget pub/sub when a subscriber is down → durable subscriptions or a stream.
- **Duplicates** on redelivery → idempotent subscribers.
- **Fan-out storm** — a popular topic triggers thousands of downstream calls at once → batching, rate limits on subscribers.
- **Accidental coupling** — subscribers depend on undocumented fields of the message → schemas and versioning.

**In the playground.** `pubsub` is a **messaging** node (async boundary) that delivers a **copy of every message to each consumer** connected to it (fan-out), unlike `queue`, where consumers compete. Each consumer has its own backlog and lag. Watch how adding a consumer multiplies the total work but does not slow the producer. Scenarios: [`chat`](../../../../playground/scenarios/index.md#chat), [`event-fanout`](../../../../playground/scenarios/index.md#event-fanout), [`notification-system`](../../../../playground/scenarios/index.md#notification-system).

**Real products.**

=== "AWS"

    - **Amazon SNS** — managed pub/sub topics; often fanned out to SQS queues (SNS + SQS).
    - **Amazon EventBridge** — event bus with content-based routing rules.

=== "GCP"

    - **Pub/Sub** — global, managed publish/subscribe with push and pull subscriptions.
    - **Eventarc** — event routing to Cloud Run and other services.

=== "Azure"

    - **Azure Service Bus** (topics and subscriptions) — durable pub/sub with filters.
    - **Azure Event Grid** — event routing with push delivery.
    - **Azure Web PubSub** — pub/sub over WebSockets to clients.

=== "Open source"

    - **NATS** — lightweight, very fast messaging (core pub/sub; JetStream adds persistence).
    - **RabbitMQ** — fan-out and topic exchanges.
    - **Redis Pub/Sub** — in-memory, fire-and-forget channels.

!!! tip "In the interview"
    "When an event is cancelled, the event service just publishes `EventCancelled`; refunds, notifications and search each have their own subscription and react independently. Adding a consumer doesn't touch the publisher. Delivery is at-least-once, so every subscriber is idempotent, and I monitor each subscription's backlog separately."

**Learn more:** [Messaging › Queues & pub/sub](../../../classes/messaging/queues-pubsub/index.md) · [Messaging › Patterns](../../../classes/messaging/patterns/index.md) · [Edge › Protocols](../../../classes/edge/protocols/index.md) · [Case study: chat](../../../classes/case-studies/chat/index.md) · [Case study: news feed](../../../classes/case-studies/news-feed/index.md)

---

## Event Stream { #stream }

**What it is.** An event stream is an **append-only, ordered log** split into **partitions** and **retained** for a period (hours, days or forever), not deleted on consumption. Each consumer (or consumer group) keeps its own **offset** — its position in the log — so many independent consumers can read the same events at their own pace, and a new consumer can **replay** history from the beginning. Events with the same key go to the same partition, which gives **ordering per key**. This is the backbone of event-driven architectures, change data capture (CDC) and real-time analytics. Kafka is the best-known implementation and has its own entry below; this entry covers the concept and the managed alternatives.

**When to use.**

- Many consumers of the same facts, each at its own pace: `OrderConfirmed` read by notification (now), analytics (in batches) and a new fraud service (replaying last month).
- **Event sourcing** and **CQRS**: the log is the source of truth and read models are rebuilt from it.
- **CDC**: every change of the orders table published as an event (e.g. Debezium) to feed search, cache invalidation and the warehouse.
- High-throughput ingestion: clicks, location updates, metrics, logs.

**When not to (or watch out).**

- Simple background jobs with one consumer type: a queue is simpler (per-message acks, DLQ built in).
- Request/response interactions: a stream adds latency and complexity for no gain.
- Parallelism is bounded by the number of **partitions**; ordering only holds **within** a partition — pick the key carefully (e.g. `order_id`).
- A slow consumer does not slow the others, but its **lag** grows; if lag exceeds retention, it loses events.
- Schemas evolve: use a schema registry and compatible changes, or old consumers break.

**Key numbers.**

| Metric | Typical value | Note |
|---|---|---|
| Kinesis shard capacity | 1 MB/s or 1,000 records/s in; 2 MB/s out | Documented per-shard limits |
| Kinesis default retention | 24 h (extendable up to 365 days) | Documented |
| Max consumer parallelism (per group) | = number of partitions/shards | Extra consumers sit idle |
| Consumer lag | messages (or seconds) behind the head of the log | The key health metric |
| End-to-end latency | ≈ tens to hundreds of ms | ≈ illustrative; depends on batching and polling |

**Failure modes.**

- **Consumer lag growing** — consumers slower than producers → more consumers (up to the partition count), more partitions, batching, faster handlers.
- **Hot partition** — one key (the flash-sale event) gets most events → a finer key (`seat_id` instead of `event_id`), or accept the limit.
- **Lag beyond retention** — events lost for that consumer → alert on lag well before retention, longer retention.
- **Reprocessing side effects** on replay (e-mails sent again) → idempotent consumers, separate replay pipelines.
- **Breaking schema change** → schema registry with compatibility checks.

**In the playground.** `stream` is a **messaging** node with fan-out (every consumer gets every event) and a `partitions` parameter (default 4): the maximum parallelism of each consumer is `min(partitions, consumer replicas)`. Adding consumer replicas beyond the partition count does not reduce lag — try it. Metrics: backlog, consumer lag (s), end-to-end latency. Scenarios: [`event-fanout`](../../../../playground/scenarios/index.md#event-fanout), [`ride-sharing`](../../../../playground/scenarios/index.md#ride-sharing), [`news-feed`](../../../../playground/scenarios/index.md#news-feed).

**Real products.**

=== "AWS"

    - **Amazon Kinesis Data Streams** — managed, sharded event streams.
    - **Amazon MSK** — managed Apache Kafka (see [Kafka](#kafka)).

=== "GCP"

    - **Pub/Sub** with ordering keys and seek/replay — a managed stream-like service.
    - **Managed Service for Apache Kafka** — managed Kafka clusters.

=== "Azure"

    - **Azure Event Hubs** — partitioned event ingestion service, with a Kafka-compatible endpoint.

=== "Open source"

    - **Apache Kafka** — the reference event-streaming platform.
    - **Apache Pulsar** — streaming and queuing with tiered storage.
    - **NATS JetStream** — persistent streams on NATS.
    - **Redis Streams** — lightweight streams with consumer groups.

!!! tip "In the interview"
    "Order events go to a partitioned, retained log keyed by `order_id`: each consumer group reads at its own offset, so notification, analytics and a future fraud service are independent and can replay history. Ordering is per key, parallelism is capped by the partition count, and the number I watch is consumer lag."

**Learn more:** [Messaging › Queues & pub/sub](../../../classes/messaging/queues-pubsub/index.md) · [Messaging › Kafka](../../../classes/messaging/kafka/index.md) · [Messaging › Patterns](../../../classes/messaging/patterns/index.md) · [Case study: ride sharing](../../../classes/case-studies/ride-sharing/index.md)

---

## Kafka { #kafka }

**What it is.** Apache Kafka is a distributed event-streaming platform. Data is organized in **topics**, each split into **partitions**; each partition is an ordered, append-only log replicated across **brokers** (one leader, followers in the *in-sync replica* set). Producers choose the partition by **key** (same key → same partition → ordered). Consumers join **consumer groups**: within a group each partition is assigned to one consumer, and the group commits **offsets** to remember where it stopped. Messages are retained by time or size (or kept forever as the latest value per key with **log compaction**). Since Kafka 4.0, clusters run in **KRaft** mode (Raft-based metadata quorum, no ZooKeeper). Around the core: Kafka Connect (integrations, CDC with Debezium), Kafka Streams (stream processing) and schema registries.

**When to use.**

- The event backbone of a microservice system: BoxOffice `order`, `payment` and `inventory` publish domain events; others react (choreographed sagas, read models).
- **Transactional outbox + CDC**: Debezium reads the outbox table and publishes to Kafka, so database and events never diverge.
- High-volume pipelines: clickstreams, logs, metrics, location updates — with replay for reprocessing.
- When several teams need the same events with independent pace and retention.

**When not to (or watch out).**

- Small systems with a few background jobs: a managed queue is far simpler to operate.
- Per-message routing, priorities, delayed messages and per-message retries are not Kafka's strengths (queues do them better).
- Partition count is a capacity decision made up front: it caps consumer parallelism, and adding partitions later changes the key → partition mapping (ordering per key breaks across the change).
- "Exactly-once" exists for Kafka-to-Kafka processing (idempotent producer + transactions); side effects outside Kafka still need idempotent consumers.
- Operating Kafka (brokers, storage, rebalancing, upgrades) is real work → consider a managed service.

**Key numbers.**

| Metric | Typical value | Note |
|---|---|---|
| Default retention | 7 days (`log.retention.hours = 168`) | Configurable per topic; compaction keeps last value per key |
| Default max message size | ≈ 1 MB | Large payloads by reference |
| Replication | factor 3 with `min.insync.replicas = 2` and `acks=all` | Tolerates one broker failure without losing acknowledged writes |
| Produce latency (acks=all, same region) | ≈ a few ms to tens of ms | ≈ illustrative; batching (`linger.ms`) trades latency for throughput |
| Throughput per partition | ≈ tens of MB/s | ≈ illustrative; plan partitions = target throughput ÷ per-consumer throughput |
| Consumer parallelism per group | ≤ partitions | 6 partitions, 10 consumers ⇒ 4 idle |

**Failure modes.**

- **Consumer lag** — consumers can't keep up → scale consumers up to the partition count, add partitions (planned), optimize the handler, batch.
- **Rebalance storms** — consumers joining/leaving repeatedly pause consumption → cooperative rebalancing, stable group membership, longer session timeouts.
- **Broker failure** → leader election for its partitions from the in-sync replicas; with RF 3 and `min.insync.replicas = 2`, writes continue.
- **Poison message** blocks a partition (consumer keeps failing on the same offset) → retry topic + DLQ topic, skip after N attempts.
- **Duplicates** after a consumer crash between processing and offset commit → idempotent consumer (dedupe table keyed by event id).
- **Hot partition** from a skewed key → better key choice, or split hot keys.
- **Disk full** from retention too long or a stuck compaction → monitor broker disk, tiered storage.

**In the playground.** `kafka` is a **messaging** node like `stream` (fan-out to every consumer, retained backlog) with an explicit `partitions` parameter (default 12, on 3 brokers): each consumer's parallelism is `min(partitions, consumer replicas)`. Try the classic mistake: 3 partitions, scale the consumer to 10 replicas, and watch the lag not move. Metrics: backlog, consumer lag (s), end-to-end latency; retention limits turn excess backlog into drops (errors). Scenarios: [`event-fanout`](../../../../playground/scenarios/index.md#event-fanout), [`payment-system`](../../../../playground/scenarios/index.md#payment-system), [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale), [`observability-stack`](../../../../playground/scenarios/index.md#observability-stack).

**Real products.**

=== "AWS"

    - **Amazon MSK** (Managed Streaming for Apache Kafka) — provisioned or serverless Kafka clusters; MSK Connect for connectors.

=== "GCP"

    - **Managed Service for Apache Kafka** — managed Kafka clusters on Google Cloud.

=== "Azure"

    - **Azure Event Hubs** — exposes a Kafka-compatible endpoint, so Kafka clients work without running brokers.
    - **Confluent Cloud** (available through cloud marketplaces) — fully managed Kafka from Kafka's original creators.

=== "Open source"

    - **Apache Kafka** — brokers in KRaft mode (used in Hands-on 7).
    - **Strimzi** — Kubernetes operator to run Kafka.
    - **Debezium** — CDC connectors that turn database changes (or an outbox table) into Kafka events.
    - **Kafka Connect** and **Kafka Streams** — integration and stream processing, part of the Apache Kafka project.

!!! tip "In the interview"
    "I'd use Kafka as the event backbone: the order service writes to an outbox in the same transaction, Debezium publishes to a topic keyed by `order_id`, and notification, analytics and search are separate consumer groups. I size partitions for the consumer parallelism I need, run replication factor 3 with `acks=all`, and make every consumer idempotent because delivery is at-least-once."

**Learn more:** [Messaging › Kafka](../../../classes/messaging/kafka/index.md) · [Messaging › Delivery semantics](../../../classes/messaging/semantics/index.md) · [Messaging › Patterns](../../../classes/messaging/patterns/index.md) · [Distributed › Consensus](../../../classes/distributed/consensus/index.md) · [Case study: payment system](../../../classes/case-studies/payment-system/index.md) · [Hands-on 7](../../../hands-on/7/index.md)
