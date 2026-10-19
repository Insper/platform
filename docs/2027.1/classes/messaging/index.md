It is 09:59:58 and a stadium show is about to go on sale on BoxOffice. At 10:00 two million fans press "Buy" for sixty thousand seats. Behind that button, the first version of BoxOffice does everything in one synchronous request: hold the seats, charge the card, send the e-mail, push a notification to the phone, update the search index and record the sale for analytics. The e-mail provider is a little slow today (800 ms instead of 80 ms), so every purchase now takes a second longer, the order service runs out of threads, and fans who were about to pay see a spinner and then an error. Nothing was *broken* — the system was simply wired so that every step had to finish before any user got an answer.

This class is about the other wiring: **messages**. Instead of calling every service and waiting, a service writes a message to a broker and moves on; whoever needs it reads it when it can. Done right, messaging absorbs spikes, decouples teams and keeps slow or failing services out of the critical path. Done carelessly, it loses orders, duplicates e-mails and hides failures in a queue nobody watches. We will learn both sides.

!!! abstract "Learning objectives"

    By the end of this class you should be able to:

    - **Decide** whether an interaction between two BoxOffice services should be a synchronous call, a queued command or a published event, and **justify** the choice with latency, availability and coupling arguments.
    - **Compare** message queues, pub/sub topics and event logs, and **choose** the right palette component (`queue`, `pubsub`, `stream`, `kafka`) for a requirement.
    - **Explain** how Kafka stores and serves data — topics, partitions, offsets, consumer groups, replication, retention and compaction — and **size** the number of partitions for a target throughput.
    - **Estimate** backlog, consumer lag and drain time under a traffic spike, and **design** backpressure for a queue.
    - **Explain** at-most-once, at-least-once and exactly-once delivery, and **implement** an idempotent consumer and a dead letter queue.
    - **Apply** the transactional outbox, change data capture, sagas (choreography and orchestration), CQRS and event sourcing to keep services consistent without distributed transactions.
    - **Evolve** an event schema without breaking consumers.

## Roadmap

1. **This overview** — synchronous vs asynchronous, what a broker buys you (and what it costs), load leveling in numbers, the vocabulary, and the four messaging components of the palette.
2. [Queues and pub/sub](queues-pubsub/index.md) — point-to-point queues, competing consumers, acknowledgements, backpressure, the flash-sale waiting room, and pub/sub fan-out.
3. [Kafka and event logs](kafka/index.md) — the log abstraction, partitions, keys and ordering, consumer groups, replication, retention, compaction and partition sizing.
4. [Delivery semantics](semantics/index.md) — at-most/at-least/exactly-once, idempotent consumers, ordering, retries and dead letter queues, schema evolution.
5. [Patterns](patterns/index.md) — transactional outbox, change data capture, sagas, CQRS and event sourcing, all applied to the BoxOffice purchase.
6. [Quiz](quiz.md) — check your understanding.

## Slides

<div class="slides-embed">
  <iframe src="slides/messaging.html" title="Slides: messaging and event-driven architecture" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/messaging.html){:target="_blank"}

---

## Synchronous vs asynchronous { #sync-vs-async }

In a **synchronous** interaction the caller sends a request and **waits** for the answer before it continues — an HTTP or gRPC call. In an **asynchronous** interaction the caller hands a message to an intermediary (a **broker**) and continues immediately; the receiver processes the message later, possibly much later, possibly on another continent.

Compare the two versions of the BoxOffice purchase. The user clicks "Buy"; the `order` service must create the order, and five other services need to know about it.

=== "Synchronous chain"

    ``` mermaid-sim
    sequenceDiagram
        autonumber
        participant U as Fan
        participant O as order
        participant N as notification
        participant S as search
        participant A as analytics
        U->>+O: POST /orders
        O->>+N: send e-mail + push
        N-->>-O: ok (800 ms today)
        O->>+S: update "seats left"
        S-->>-O: ok
        O->>+A: record sale
        A-->>-O: ok
        O-->>-U: 201 Created (after all of them)
    ```

    The response time is the **sum** of every call, and the purchase fails if **any** of them fails.

=== "Asynchronous events"

    ``` mermaid-sim
    sequenceDiagram
        autonumber
        participant U as Fan
        participant O as order
        participant K as Kafka
        participant N as notification
        participant S as search
        participant A as analytics
        U->>+O: POST /orders
        O->>K: publish OrderConfirmed
        O-->>-U: 201 Created
        K-->>N: OrderConfirmed
        K-->>S: OrderConfirmed
        K-->>A: OrderConfirmed
    ```

    The response time is the time to save the order and publish one message. Each consumer reads the event independently, at its own pace.

The difference is not only speed. It shows up in three numbers you already know how to compute (see [Estimation](../estimation/index.md)):

| Property | Synchronous chain | Asynchronous events |
|---|---|---|
| **Latency** seen by the fan | $t_{order} + t_{notif} + t_{search} + t_{analytics}$ | $t_{order} + t_{publish}$ |
| **Availability** of "Buy" | $A_{order} \times A_{notif} \times A_{search} \times A_{analytics}$ | $A_{order} \times A_{broker}$ |
| **Coupling** | `order` knows every consumer and its API | `order` knows one topic name and the event schema |
| **Consistency** | everything is done when the user sees "201" | consumers catch up later (**eventual consistency**) |
| **Failure of a consumer** | the purchase fails | the consumer's backlog grows; the purchase still works |
| **Debugging** | one request, one stack of calls | a flow spread across topics and services: needs tracing |

!!! example "BoxOffice: availability of the Buy button"

    Suppose `order` is 99.95% available and each of the three downstream services is 99.9%. Synchronously, the purchase needs all four:

    $$
    A = 0.9995 \times 0.999^3 \approx 99.65\%
    $$

    That is about 2.5 hours of failed purchases per month. With events, the purchase needs `order` and the broker (a replicated Kafka cluster, say 99.95%):

    $$
    A = 0.9995 \times 0.9995 \approx 99.90\%
    $$

    The downstream services can still fail — but their failure now delays an e-mail instead of losing a sale.

??? question "Think first: should the seat hold be asynchronous too?"

    No. When the fan clicks a seat, they need to know **now** whether it is theirs. A seat hold is a question with an answer the caller needs to continue, and it must be strongly consistent (no double booking). It stays a synchronous call to `inventory` (see [Transactions](../databases/transactions/index.md)). Asynchrony is for work whose result the caller does **not** need to continue: notifications, search updates, analytics, invoices.

    The rule of thumb: **if the caller needs the answer to continue, call; if the caller only needs the work to happen eventually, send a message.**

---

## What a broker buys you

A **message broker** is a server that receives messages from **producers**, stores them durably and delivers them to **consumers**[^1]. Putting a broker between two services gives four properties that a direct call cannot:

1. **Temporal decoupling.** Producer and consumer do not need to be up at the same time. If `notification` is being redeployed, the `OrderConfirmed` events wait in the broker.
2. **Load leveling.** The broker is a buffer: producers can write faster than consumers read for a while, and the backlog drains later. A spike becomes a queue instead of an outage.
3. **Fan-out.** One published event can be delivered to many independent consumers. Adding a new consumer (fraud detection, a loyalty program) does not touch the producer.
4. **Independent scaling and failure isolation.** Each consumer scales with its own load and fails on its own. A slow analytics pipeline does not slow down e-mails.

Nothing is free. The price of asynchrony:

- **Eventual consistency.** For a while the search page may still show "120 seats left" when there are 80. The system must be designed (and the UI worded) for that[^2].
- **Duplicates and reordering.** Most brokers deliver *at least once*: consumers will see the same message twice and must be **idempotent** (see [Delivery semantics](semantics/index.md)).
- **Harder debugging.** A purchase is now a chain of events across topics; without distributed tracing and consumer-lag metrics, failures hide in a backlog (see [Observability](../observability/index.md)).
- **One more critical system.** The broker must be replicated, monitored, upgraded and capacity-planned.

### Load leveling in numbers

The flash sale is the textbook case for load leveling. Fans' purchase requests arrive much faster than `inventory` can process seat holds, but only for a few minutes. If `order` called `inventory` directly, the excess would turn into timeouts and errors. With a queue in between, the excess turns into **backlog** — messages waiting — and the only cost is waiting time.

The simulation below uses illustrative numbers: 200 requests/s before 10:00, a spike of 6,000 requests/s for three minutes, and then a crowd that thins out slowly. Workers process 2,000 or 4,000 requests/s.

```python exec="1" html="1"
import matplotlib.pyplot as plt
from io import StringIO

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "xtick.color": "#888",
                     "ytick.color": "#888", "axes.edgecolor": "#888", "svg.fonttype": "none"})

# BoxOffice purchase requests from 09:58 to 10:20, one point per second (illustrative numbers)
def arrivals(t):                      # t = seconds after 09:58
    if t < 120:
        return 200                    # normal traffic before the on-sale
    if t < 300:
        return 6000                   # 10:00-10:03: the flash-sale spike
    return 200 + 2800 * 0.99 ** (t - 300)   # the crowd thins out slowly

seconds = range(22 * 60)
lam = [arrivals(t) for t in seconds]
minutes = [t / 60 for t in seconds]

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4))
ax1.plot(minutes, lam, color="#e53935", lw=2, label="arrivals (requests/s)")
for mu, color in [(2000, "#1976d2"), (4000, "#388e3c")]:
    backlog, b = [], 0
    for a in lam:
        b = max(0, b + a - mu)        # what arrives and cannot be processed waits
        backlog.append(b)
    ax1.axhline(mu, color=color, ls="--", lw=1.5, label=f"worker capacity {mu}/s")
    ax2.plot(minutes, [x / 1000 for x in backlog], color=color, lw=2,
             label=f"{mu}/s: peak {max(backlog) / 1000:.0f}k, wait {max(backlog) / mu / 60:.1f} min")
ax1.set_xlabel("minutes after 09:58")
ax1.set_ylabel("requests per second")
ax1.set_title("Arrivals vs consumer capacity")
ax1.legend(fontsize=8)
ax2.set_xlabel("minutes after 09:58")
ax2.set_ylabel("backlog (thousand messages)")
ax2.set_title("Queue backlog")
ax2.legend(fontsize=8)
for ax in (ax1, ax2):
    ax.grid(True, alpha=0.3)
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

Three things to read from the chart:

- **The backlog grows at the difference of the rates.** During the spike it grows by $6000 - 2000 = 4000$ messages per second with the smaller worker pool: in three minutes, $4000 \times 180 = 720{,}000$ messages.
- **The wait is backlog divided by throughput** — Little's Law again (see [Queueing](../estimation/queueing/index.md)): $720{,}000 / 2000 = 360$ s, six minutes for the last fan in line. Doubling the workers halves the peak *and* drains it much faster.
- **The backlog only drains when arrivals fall below capacity.** If the average arrival rate stays above the capacity, no queue saves you: the backlog grows forever. A queue absorbs **spikes**, not a permanent shortage.

!!! info "Try it in the playground"

    The `async-queue` scenario puts a queue and a pool of workers behind an app server. Press **Run** with the **spike** profile and watch the queue depth and consumer lag. Then (1) lower the number of workers and see the backlog grow and the end-to-end delay rise while the API latency stays flat; (2) raise the workers until the backlog drains within a minute of the spike. Open the [full playground](../../../playground/index.md) to add an autoscaling rule on queue depth.

<div class="sdp" data-scenario="async-queue" data-mode="compact" data-profile="spike" data-height="520"></div>

---

## The vocabulary

Messaging has many words for similar things. These are the ones we use in the course.

| Term | Meaning | BoxOffice example |
|---|---|---|
| **Message** | Any unit of data sent through a broker: headers + payload | Any of the below |
| **Command** | A request for a specific receiver to *do* something; it may be rejected | `GenerateTicketPdf { orderId }` on the `ticket-pdf` queue |
| **Event** | An immutable fact about something that *already happened*; the producer does not know who reacts | `OrderConfirmed { orderId, eventId, seats, total }` |
| **Producer / publisher** | The service that writes messages | `order` |
| **Consumer / subscriber** | The service that reads them | `notification`, `search`, `analytics` |
| **Broker** | The server (cluster) that stores and delivers messages | Kafka, RabbitMQ, Amazon SQS |
| **Queue** | A channel where each message is processed by **one** consumer | `ticket-pdf` |
| **Topic** | A channel where each message is delivered to **every** subscription | `order-events` |
| **Backlog / consumer lag** | Messages written but not yet processed | "notification is 42,000 messages behind" |
| **Acknowledgement (ack)** | The consumer telling the broker "done, you may forget/advance" | `basicAck`, offset commit |

!!! tip "Name events in the past tense"
    An event is a fact: `OrderConfirmed`, `SeatsReleased`, `PaymentFailed`. A name in the imperative — `SendConfirmationEmail` — is a command in disguise: it couples the producer to one consumer and one action. Publish what happened and let each consumer decide what to do about it.

### What goes inside an event

Martin Fowler distinguishes several things people mean by "event-driven"[^3]. Two of them change how you design the payload:

=== "Event notification"

    The event carries little more than an identifier. Consumers that need details call back the producer.

    ```json
    { "type": "OrderConfirmed", "eventId": "e-9f2c", "orderId": "o-7731", "occurredAt": "2027-03-14T10:00:07Z" }
    ```

    Small and stable, but every consumer adds load on `order` (and depends on it being up) to fetch the details.

=== "Event-carried state transfer"

    The event carries the data consumers need, so they never call back.

    ```json
    {
      "type": "OrderConfirmed", "eventId": "e-9f2c", "orderId": "o-7731",
      "occurredAt": "2027-03-14T10:00:07Z",
      "customer": { "id": "c-12", "email": "ana@example.com", "locale": "pt-BR" },
      "event": { "id": "ev-88", "name": "Stadium Show", "startsAt": "2027-05-01T21:00:00-03:00" },
      "seats": ["B-12", "B-13"], "total": { "amount": 780.00, "currency": "BRL" }
    }
    ```

    Consumers are fully decoupled from `order`'s availability, at the price of a bigger payload, a schema that is harder to change, and personal data (the e-mail) copied to every consumer.

The other two meanings — **event sourcing** and **CQRS** — are architectural patterns covered in [Patterns](patterns/index.md).

---

## The messaging palette

The [System Design Playground](../../../playground/index.md) has four messaging components. They are not four brands; they are four *shapes* of communication. The [component catalog](../../reference/components/messaging/index.md) has the details of each one.

| Component | Shape | Who gets a message | After it is consumed | Ordering | Typical products |
|---|---|---|---|---|---|
| [`queue`](../../reference/components/messaging/index.md#queue) Message Queue | point-to-point | **one** consumer of the pool | deleted | usually none (FIFO queues: per group) | Amazon SQS, RabbitMQ, Azure Service Bus queues, Google Cloud Tasks |
| [`pubsub`](../../reference/components/messaging/index.md#pubsub) Pub/Sub | fan-out | **every** subscription (one copy each) | deleted per subscription | usually none (optional ordering keys) | Google Cloud Pub/Sub, Amazon SNS, Azure Service Bus topics, NATS, Redis Pub/Sub |
| [`stream`](../../reference/components/messaging/index.md#stream) Event Stream | partitioned log (managed) | every consumer group, each at its own position | **kept** until retention expires | per partition / shard | Amazon Kinesis Data Streams, Azure Event Hubs, Redis Streams |
| [`kafka`](../../reference/components/messaging/index.md#kafka) Kafka | partitioned, replicated log | every consumer group, each at its own position | **kept** until retention expires (or compacted) | per partition | Apache Kafka, Confluent Cloud, Amazon MSK, Redpanda |

The deciding question is what happens to a message **after it is read**:

- In a **queue**, reading is *taking*: the message is gone once acknowledged. Great for distributing work.
- In a **log**, reading is *looking*: the message stays, and each reader keeps a bookmark. Great for many independent readers, replay and history.

``` mermaid
flowchart TD
    q1{"Does the caller need<br/>the answer to continue?"}
    q1 -->|yes| sync["Synchronous call<br/>(REST / gRPC) + timeout"]
    q1 -->|no| q2{"How many services<br/>must react?"}
    q2 -->|"exactly one<br/>(a job to do)"| queue["queue<br/>competing consumers"]
    q2 -->|"many, each its own copy"| q3{"Need replay, ordering<br/>per key, or high throughput?"}
    q3 -->|no| pubsub["pubsub<br/>topic + subscriptions"]
    q3 -->|yes| log["stream / kafka<br/>partitioned log"]
```

### When *not* to go asynchronous

| BoxOffice interaction | Best fit | Why |
|---|---|---|
| Log in, get a token | Synchronous | The user needs the token now |
| Hold seats B-12 and B-13 | Synchronous | The user needs to know now; must be strongly consistent |
| Authorize the card | Synchronous with idempotency key, or async with a status page | The user waits for the result, but the provider may be slow (see [Integrations](../compute/integrations/index.md)) |
| Enter the on-sale waiting room | **Queue** | Admit fans at the rate `inventory` can handle |
| Send e-mail and push after the purchase | **Event** (`pubsub` or `kafka`) | The user does not wait; can lag a few seconds |
| Update "seats left" in search | **Event** / change data capture | Eventual consistency is acceptable for browsing |
| Generate the PDF ticket | **Queue** (command) | One worker should do it once; retries are fine |
| Feed the data warehouse | **Event stream** | High volume, replayable, many readers |

## The messaging concept map { #concept-map }

Every message crosses the same path: a producer hands it to one of the four messaging components, and a consumer processes it later. The map links each **palette component** (green) to the **concepts** of this class (blue) and to the classes that continue them:

``` mermaid
flowchart LR
    order["app (order)<br/>producer"]:::comp --> queue["queue"]:::comp
    order --> pubsub["pubsub"]:::comp
    order --> log["stream · kafka"]:::comp
    queue --> worker["worker"]:::comp
    pubsub --> cons["notifications · search ·<br/>analytics"]:::comp
    log --> cons
    order -.- c0["sync vs async, outbox,<br/>sagas, CQRS, event sourcing"]:::tech
    queue -.- c1["competing consumers, ack,<br/>backpressure, waiting room"]:::tech
    pubsub -.- c2["fan-out, subscriptions,<br/>push/pull, filters"]:::tech
    log -.- c3["partitions, keys, offsets,<br/>consumer groups, retention"]:::tech
    worker -.- c4["at-least-once, idempotent consumer,<br/>ordering, DLQ, schemas"]:::tech
    c3 -.- d1["consensus, KRaft<br/>(class 3)"]
    c4 -.- d2["retries, freshness SLO<br/>(class 9)"]
    c4 -.- d3["consumer lag, tracing<br/>(class 10)"]
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

| Palette component | Question it answers | Concepts | Taught in | Scenarios |
|---|---|---|---|---|
| [`app`](../../reference/components/compute/index.md#app) | Call and wait, or send a message? | sync vs async, availability of a chain, eventual consistency, commands vs events | [this overview](#sync-vs-async) | `async-queue` |
| [`queue`](../../reference/components/messaging/index.md#queue) | Who does this *job*, and at what rate? | competing consumers, ack and visibility timeout, backpressure, waiting room | [Queues and pub/sub](queues-pubsub/index.md), [the waiting room](queues-pubsub/index.md#the-flash-sale-waiting-room) | `async-queue`, `flash-sale` |
| [`pubsub`](../../reference/components/messaging/index.md#pubsub) | How does *every* interested service get its own copy? | topic, subscriptions, push/pull, filters, durable vs ephemeral | [Queues and pub/sub](queues-pubsub/index.md#pubsub) | `notification-system`, `chat` |
| [`stream`](../../reference/components/messaging/index.md#stream) · [`kafka`](../../reference/components/messaging/index.md#kafka) | Who needs *history*, replay and order per key? | log, partitions, keys, consumer groups, lag, replication, retention, compaction | [Kafka and event logs](kafka/index.md) | `event-fanout` |
| [`worker`](../../reference/components/compute/index.md#worker) · [`notifications`](../../reference/components/compute/index.md#notifications) · [`search`](../../reference/components/compute/index.md#search) · [`analytics`](../../reference/components/compute/index.md#analytics) | What if a message arrives *twice*, late, out of order or broken? | at-least-once, idempotent consumer, version-guarded updates, DLQ, schema evolution | [Delivery semantics](semantics/index.md) | `notification-system`, `payment-system` |
| [`sql`](../../reference/components/storage/index.md#sql) + [`kafka`](../../reference/components/messaging/index.md#kafka) · [`payment`](../../reference/components/external/index.md#payment) | How do I change my data *and* publish, across services, without 2PC? | transactional outbox, CDC, sagas, CQRS, event sourcing | [Patterns](patterns/index.md) | `payment-system`, `flash-sale` |

!!! tip "In the interview"
    Interviewers listen for *why* you add a queue. "I'll put Kafka here" is a red flag on its own; "the e-mail does not need to block the purchase, so `order` publishes `OrderConfirmed` and `notification` consumes it — that removes the e-mail provider from the purchase's availability chain and absorbs the 10:00 spike as backlog" is a strong signal. Always follow with the consequences you will handle: duplicates (idempotent consumer), ordering (key by `orderId`), failures (retries + DLQ) and monitoring (consumer lag)[^4].

!!! warning "Common pitfalls"

    - **Async for everything.** Turning a question that needs an answer ("is this seat free?") into a message adds latency, complexity and a polling loop, and gains nothing.
    - **A queue as a capacity plan.** A queue absorbs spikes; it does not fix a consumer that is permanently slower than the producer. Watch the trend of the backlog.
    - **Nobody watches the backlog.** An unmonitored queue turns an outage into a silent delay: the API is green while e-mails are three hours late. Alert on consumer lag and on the age of the oldest message.
    - **Assuming exactly-once.** Plan for duplicates from day one.
    - **Dual writes.** Saving to the database and then publishing to the broker loses or invents events after a crash; use the [transactional outbox](patterns/index.md#transactional-outbox).

---

## Related

- **Hands-on:** [Hands-on 7 — Async](../../hands-on/7/index.md): Kafka, transactional outbox in `order`, idempotent consumer in `notification`, DLQ and the waiting-room queue.
- **Exercise:** [Event-driven exercise](../../exercises/event-driven/index.md) — outbox + idempotent consumer.
- **Case studies:** [Ticketing (BoxOffice flash sale)](../case-studies/ticketing/index.md), [Notification system](../case-studies/notification-system/index.md), [Payment system](../case-studies/payment-system/index.md), [Chat](../case-studies/chat/index.md).
- **Classes:** [Compute — async work](../compute/async-work/index.md) (workers and schedulers), [Reliability](../reliability/index.md) (retries, backoff, idempotency), [Observability](../observability/index.md) (consumer lag and tracing across topics).

---

[^1]: HOHPE, G.; WOOLF, B. *Enterprise Integration Patterns: Designing, Building, and Deploying Messaging Solutions*. Addison-Wesley, 2003. See also [enterpriseintegrationpatterns.com](https://www.enterpriseintegrationpatterns.com){target="_blank"}.
[^2]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2nd ed. O'Reilly. Chapter on stream processing.
[^3]: FOWLER, M. [What do you mean by "Event-Driven"?](https://martinfowler.com/articles/201701-event-driven.html){target="_blank"}. martinfowler.com, 2017.
[^4]: XU, A. *System Design Interview — An Insider's Guide*, vol. 2. ByteByteGo, 2022. Chapter "Distributed Message Queue".
