Six months after BoxOffice adopted pub/sub, three requests arrive in the same week. The data team wants to load *every* order event of the last seven days into the warehouse — including events published before their loader existed. The search team shipped a bug that indexed wrong prices for two hours and wants to **re-read** those two hours after the fix. And the fraud team wants all events of the same order, in order, to detect "hold, release, hold, release" patterns from bots. A queue cannot do any of this: once a message is acknowledged, it is gone, and competing consumers scramble the order.

All three requests ask for the same thing: keep the messages, in order, and let each reader decide where to read from. That is a **log**, and Apache Kafka is the system that made the log the backbone of modern data architectures[^1][^2].

---

## The log

A **log** here is not a text file of debug messages. It is the simplest storage abstraction there is: an **append-only, totally ordered sequence of records**. Writers can only add at the end; each record gets the next sequential number, its **offset**. Readers never remove anything — each reader just remembers the offset it has reached.

``` mermaid
flowchart LR
    subgraph log ["order-events (one partition)"]
        direction LR
        r0["0<br/>OrderPlaced<br/>o-1"] --- r1["1<br/>OrderPlaced<br/>o-2"] --- r2["2<br/>OrderConfirmed<br/>o-1"] --- r3["3<br/>OrderCancelled<br/>o-2"] --- r4["4<br/>OrderPlaced<br/>o-3"] --- r5["5<br/>(next write)"]
    end
    n["notification<br/>committed offset 4"] -.-> r4
    a["analytics<br/>committed offset 2"] -.-> r2
    w["warehouse loader<br/>replaying from 0"] -.-> r0
```

This tiny change — reading does not delete — has big consequences:

- **Any number of independent readers.** `notification`, `analytics` and the warehouse loader read the same data at their own pace. A slow reader only falls behind; it slows down nobody.
- **Replay.** A reader can move its offset backwards and re-read history (the search team's fix), and a new reader can start from the beginning (the data team's loader).
- **Order.** Records are read in the order they were written — within one log.
- **The log is the source of truth for "what happened".** Databases, caches and search indexes can be rebuilt from it — the idea behind change data capture and event sourcing ([Patterns](../patterns/index.md)).

---

## Topics, partitions and offsets

A single log on a single machine would limit throughput to one disk and one machine. Kafka splits each **topic** into **partitions**: each partition is an independent log, stored on a different broker, with its own offsets. The topic is just the name of a set of partitions.

``` mermaid-sim
flowchart LR
    p1["order (replica 1)"] -->|"key o-7731"| P1
    p2["order (replica 2)"] -->|"key o-1002"| P0
    p2 -->|"key o-5120"| P2
    subgraph topic ["topic order-events"]
        P0["partition 0 · broker 1<br/>0 1 2 3 4 5 →"]
        P1["partition 1 · broker 2<br/>0 1 2 3 →"]
        P2["partition 2 · broker 3<br/>0 1 2 3 4 →"]
    end
```

- A record is identified by **(topic, partition, offset)**. Offsets are per partition: offset 3 in partition 0 and offset 3 in partition 1 are unrelated records.
- **Order is guaranteed only inside a partition.** Two records in different partitions have no defined order.
- Partitions are the **unit of parallelism**: different partitions are written by different brokers and read by different consumers at the same time.
- On disk, a partition is a sequence of **segment** files (e.g. 1 GB each). Kafka only appends to the active segment and deletes or compacts whole old segments — this is what makes writes sequential and cheap.

### Keys decide the partition

Each record may have a **key**. The default partitioner hashes the key (murmur2) and takes the result modulo the number of partitions:

$$
\text{partition} = \text{murmur2}(\text{key}) \bmod N_{\text{partitions}}
$$

Same key → same partition → **in order**. So the key is how you say *what must stay in order*. For BoxOffice order events, the key is the `orderId`: `OrderPlaced`, `OrderConfirmed` and `OrderCancelled` of the same order are always read in sequence, while different orders spread across partitions and are processed in parallel. Records **without a key** are spread across partitions by the *sticky* partitioner (it fills a batch for one partition, then moves to another), with no ordering between them.

The key also decides **load balance**. The simulation below hashes one minute of illustrative on-sale traffic into 12 partitions with Kafka's own hash function, using two different keys. In the on-sale minute, 60% of the purchases are for the stadium show.

```python exec="1" html="1"
import random
import matplotlib.pyplot as plt
from io import StringIO

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "xtick.color": "#888",
                     "ytick.color": "#888", "axes.edgecolor": "#888", "svg.fonttype": "none"})

def murmur2(data: bytes) -> int:
    """Kafka's default partitioner hash (Java murmur2, 32 bits)."""
    m, h = 0x5BD1E995, (0x9747B28C ^ len(data)) & 0xFFFFFFFF
    for i in range(len(data) // 4):
        k = int.from_bytes(data[4 * i:4 * i + 4], "little")
        k = (k * m) & 0xFFFFFFFF
        k ^= k >> 24
        k = (k * m) & 0xFFFFFFFF
        h = ((h * m) & 0xFFFFFFFF) ^ k
    tail, rem = data[len(data) & ~3:], len(data) % 4
    if rem == 3:
        h ^= tail[2] << 16
    if rem >= 2:
        h ^= tail[1] << 8
    if rem >= 1:
        h = ((h ^ tail[0]) * m) & 0xFFFFFFFF
    h ^= h >> 13
    h = (h * m) & 0xFFFFFFFF
    return h ^ (h >> 15)

def partition(key: str, n: int) -> int:
    return (murmur2(key.encode()) & 0x7FFFFFFF) % n

P, N = 12, 60_000
rng = random.Random(7)
# Illustrative on-sale minute: 60% of the purchases are for the stadium show ev-1,
# the rest spread over 200 smaller events
shows = ["ev-1"] * 60 + [f"ev-{rng.randint(2, 201)}" for _ in range(40)]
by_order, by_show = [0] * P, [0] * P
for i in range(N):
    by_order[partition(f"o-{i}", P)] += 1
    by_show[partition(rng.choice(shows), P)] += 1

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 3.6), sharey=True)
for ax, counts, title, color in [(ax1, by_order, "key = orderId", "#1976d2"),
                                 (ax2, by_show, "key = eventId (the show)", "#e53935")]:
    share = [100 * c / N for c in counts]
    ax.bar(range(P), share, color=color)
    ax.axhline(100 / P, color="#888", ls="--", lw=1)
    ax.set_title(f"{title}: busiest partition {max(share):.0f}%")
    ax.set_xlabel("partition")
    ax.set_xticks(range(P))
    ax.grid(True, axis="y", alpha=0.3)
ax1.set_ylabel("% of the messages")
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

Keyed by `orderId` (left), each partition gets about 1/12 of the traffic. Keyed by the show (right), every purchase of the stadium show lands in **one hot partition**: one broker and one consumer do most of the work while the others sit idle, and adding consumers does not help. The lesson: **choose the key with the finest granularity that still preserves the ordering the business needs.** Order events need per-order ordering, not per-show ordering.

!!! warning "Changing the number of partitions moves keys"
    `hash(key) mod N` changes when $N$ changes. If you grow `order-events` from 12 to 24 partitions, about half of the keys move to a different partition, and for a while new events of an order can be read before old events still waiting in the old partition. Size partitions with headroom up front; if you must grow, do it when traffic is low, or create a new topic and migrate consumers.

---

## Consumer groups { #consumer-groups }

A **consumer group** is a set of consumer instances that share the work of reading a topic. Kafka assigns each partition to **exactly one** consumer of the group, so each record is processed by one member — competing consumers, but with ordering preserved per partition. Different groups are completely independent: each has its own committed offsets, so each group receives **every** record — that is the fan-out.

``` mermaid-sim
flowchart LR
    subgraph topic ["order-events · 6 partitions"]
        P0["P0"]
        P1["P1"]
        P2["P2"]
        P3["P3"]
        P4["P4"]
        P5["P5"]
    end
    subgraph gn ["group notification · 3 consumers"]
        N1["notification #1"]
        N2["notification #2"]
        N3["notification #3"]
    end
    subgraph ga ["group analytics · 1 consumer"]
        A1["analytics #1"]
    end
    P0 --> N1
    P1 --> N1
    P2 --> N2
    P3 --> N2
    P4 --> N3
    P5 --> N3
    P0 --> A1
    P1 --> A1
    P2 --> A1
    P3 --> A1
    P4 --> A1
    P5 --> A1
```

Rules that follow from "one partition, one consumer per group":

- **Maximum parallelism of a group = number of partitions.** With 6 partitions, a 7th `notification` instance gets nothing and sits idle.
- **Order per key is kept** as long as a consumer processes a partition's records sequentially. If it hands records to a thread pool, it breaks ordering again (unless it parallelizes *by key*).
- When a consumer joins, leaves or stops polling for too long (`max.poll.interval.ms`), the group **rebalances**: partitions are reassigned. Classic rebalances paused the whole group; the newer protocol (KIP-848, generally available in Kafka 4.0) and cooperative assignment move only the partitions that need to move.

### Offsets and consumer lag

A consumer **commits** the offset of the next record it will read, per partition; Kafka stores commits in an internal compacted topic (`__consumer_offsets`). After a restart or a rebalance, the new owner of the partition resumes from the last committed offset. *When* you commit — before or after processing — decides whether a crash loses or duplicates records ([Delivery semantics](../semantics/index.md)).

**Consumer lag** is the distance between the end of the partition and the committed offset — how many records are written but not yet processed. It is *the* health metric of a consumer:

```text
$ kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --group notification

GROUP         TOPIC         PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG    CONSUMER-ID
notification  order-events  0          182340          182355          15     notification-1-...
notification  order-events  1          181902          181910          8      notification-1-...
notification  order-events  2          120004          184771          64767  notification-2-...
```

Partition 2 is 64,767 records behind while the others are near zero: a hot key, a stuck consumer or a poison message in that partition — not a general capacity problem. Lag in **records** is easy to read from Kafka; lag in **seconds** (now minus the timestamp of the last processed record) is what you put in a freshness SLO.

!!! info "Try it in the playground"

    The `event-fanout` scenario publishes order events to Kafka with several consumer services. Run it with the **load** profile and watch the per-consumer lag. Then slow down one consumer (raise its processing time) and confirm that only *its* lag grows — the producer and the other consumers are unaffected. Finally add consumer instances to the slow service and observe that it stops improving once instances equal partitions.

<div class="sdp" data-scenario="event-fanout" data-mode="compact" data-profile="load" data-height="540"></div>

---

## Replication and durability { #replication-and-durability }

Each partition is **replicated** on several brokers — the **replication factor** (RF), typically 3, with the replicas in different availability zones. One replica is the **leader**: it receives all writes (and, by default, serves reads). The **followers** continuously fetch from the leader. Followers that are caught up form the **in-sync replica set** (ISR). If the leader's broker fails, the controller elects a new leader from the ISR.

``` mermaid-sim
sequenceDiagram
    participant P as producer (order)
    participant L as leader P1 (broker 2, AZ-b)
    participant F1 as follower (broker 1, AZ-a)
    participant F2 as follower (broker 3, AZ-c)
    P->>L: produce OrderConfirmed (acks=all)
    L->>L: append at offset 4211
    F1->>L: fetch from 4211
    L-->>F1: record 4211
    F2->>L: fetch from 4211
    L-->>F2: record 4211
    Note over L: all in-sync replicas have it: high watermark = 4212
    L-->>P: ack (offset 4211)
    Note over L,F2: consumers only see records below the high watermark
```

The producer setting `acks` chooses how much of this the producer waits for:

| `acks` | Producer gets the confirmation when… | A broker failure can… | Latency |
|---|---|---|---|
| `0` | the record is sent (no confirmation) | lose records silently | lowest |
| `1` | the leader has written it | lose acknowledged records if the leader dies before followers copy them | low |
| `all` | every in-sync replica has it | not lose acknowledged records, if `min.insync.replicas` ≥ 2 | highest (one extra round trip inside the cluster) |

`acks=all` alone is not enough: if the ISR shrinks to just the leader, "all in-sync replicas" is one replica. **`min.insync.replicas=2`** makes the broker refuse writes when fewer than 2 replicas are in sync. With RF = 3 and min ISR = 2, the topic keeps accepting writes with one broker down and never acknowledges a write that exists on only one machine. Keep `unclean.leader.election.enable=false` (the default) so an out-of-date replica is never elected leader. Since Kafka 3.0, producers default to `acks=all` with idempotence enabled.

!!! info "KRaft: Kafka's own consensus"
    Cluster metadata — which topics exist, which broker leads each partition, the ISR — is kept by a small quorum of **controllers** using KRaft, a Raft-based protocol (see [Consensus](../../distributed/consensus/index.md)). Older clusters used ZooKeeper; Kafka 4.0 (2025) removed ZooKeeper entirely. The course labs run Kafka in KRaft mode.

---

## Retention, compaction and tiered storage

A log cannot grow forever. Each topic has a **cleanup policy**:

| Policy | Configuration | Keeps | BoxOffice use |
|---|---|---|---|
| **Delete by time** | `retention.ms` (default 7 days) | everything newer than the limit | `order-events`: 7 days for replay and the warehouse loader |
| **Delete by size** | `retention.bytes` (per partition; default unlimited) | the newest N bytes of each partition | High-volume click-stream with a disk budget |
| **Compact** | `cleanup.policy=compact` | at least the **latest record of each key** | `event-catalog`: the current state of each event (name, venue, date) |
| **Both** | `cleanup.policy=compact,delete` | latest per key, but not older than the retention | Latest seat-map snapshot per show, for 30 days |

A **compacted** topic behaves like a table that is also a stream: a new consumer reads it from the start and ends up with the latest value of every key. Deleting a key is done by writing a **tombstone** (the key with a `null` value). Kafka's own `__consumer_offsets` is a compacted topic.

**Tiered storage** (production-ready since Kafka 3.9) keeps only recent segments on the brokers' disks and moves older segments to object storage (S3, GCS, Azure Blob). Long retention — months of events for replay — becomes cheap, and brokers become lighter to replace.

---

## Why Kafka is fast

A Kafka broker routinely moves hundreds of megabytes per second on commodity hardware. The reasons are worth knowing because they reappear in many systems[^3]:

- **Sequential I/O.** Appends go to the end of a segment file; reads by caught-up consumers come from the same recent region. Sequential disk access is orders of magnitude faster than random access (see [Numbers](../../estimation/numbers/index.md)).
- **The OS page cache.** Kafka does not keep its own cache; it lets the operating system cache recent segments in memory, so consumers that keep up read from RAM.
- **Zero-copy.** To serve a consumer, the broker asks the kernel to send file bytes straight to the socket (`sendfile`), without copying them through the application.
- **Batching and compression.** Producers group records into batches per partition (`linger.ms`, `batch.size`) and compress whole batches (`zstd`, `lz4`). Fewer, bigger requests; fewer bytes on disk and on the network.
- **Partitioning.** Load spreads across many brokers and many consumers.

The trade-off is latency: batching adds a few milliseconds (`linger.ms`), and `acks=all` adds a replication round trip. Typical end-to-end latency is a few to tens of milliseconds — fine for events, not a replacement for an in-memory RPC.

---

## Sizing partitions { #sizing-partitions }

Partitions are cheap but not free (more files, more leader elections, longer rebalances, more memory in clients). A common starting rule[^4]: with a target throughput $T$, a measured per-partition producer throughput $p$ and a per-partition consumer throughput $c$,

$$
N_{\text{partitions}} \ge \max\left(\frac{T}{p},\ \frac{T}{c}\right)
$$

then round up with headroom for growth, because increasing partitions later moves keys.

!!! example "BoxOffice: partitions for order-events"

    Illustrative peak: 30,000 orders in the first 3 minutes of a big on-sale, each producing about 10 events (placed, held, payment authorized, confirmed, ticket issued…): $T \approx 30\,000 \times 10 / 180 \approx 1{,}700$ events/s. The records are small (~1 KB), so the producer side is trivial: a single partition handles far more than 1.7 MB/s.

    The consumer side decides. `notification` calls the e-mail provider for each `OrderConfirmed`, ~50 ms per call, processing one record at a time per partition: $c = 1 / 0.05 = 20$ records/s per partition. For its share of the traffic (the 30,000 `OrderConfirmed` in 180 s ≈ 167/s):

    $$
    N \ge \frac{167}{20} \approx 9 \text{ partitions}
    $$

    With headroom for bigger shows and growth, BoxOffice creates `order-events` with **24 partitions**. If one day that is not enough, `notification` can batch e-mails or process records concurrently *per key* inside each partition instead of adding partitions.

The topic is created explicitly (never rely on auto-creation in production):

```bash
kafka-topics.sh --bootstrap-server kafka:9092 --create --topic order-events \
  --partitions 24 --replication-factor 3 \
  --config min.insync.replicas=2 \
  --config retention.ms=604800000 \
  --config compression.type=zstd
```

And the Spring Boot services configure their clients accordingly:

=== "order (producer)"

    ```yaml
    spring:
      kafka:
        bootstrap-servers: kafka:9092
        producer:
          key-serializer: org.apache.kafka.common.serialization.StringSerializer
          value-serializer: org.springframework.kafka.support.serializer.JacksonJsonSerializer
          acks: all                    # wait for every in-sync replica
          properties:
            enable.idempotence: true   # producer retries do not duplicate records
            linger.ms: 5               # wait up to 5 ms to fill a batch
            compression.type: zstd
    ```

=== "notification (consumer)"

    ```yaml
    spring:
      kafka:
        bootstrap-servers: kafka:9092
        consumer:
          group-id: notification
          auto-offset-reset: earliest  # a brand-new group starts from the oldest record
          enable-auto-commit: false    # the container commits after processing
          max-poll-records: 100
          key-deserializer: org.apache.kafka.common.serialization.StringDeserializer
          value-deserializer: org.springframework.kafka.support.serializer.JacksonJsonDeserializer
          properties:
            spring.json.trusted.packages: "boxoffice.events"
        listener:
          ack-mode: record             # commit the offset after each record
          concurrency: 3               # 3 consumer threads in this instance
    ```

---

## Kafka and its alternatives

| | Apache Kafka | Amazon Kinesis Data Streams | Google Cloud Pub/Sub | Apache Pulsar |
|---|---|---|---|---|
| **Model** | partitioned replicated log | partitioned log (shards) | pub/sub with per-message ack | pub/sub + log (segments in BookKeeper) |
| **Ordering** | per partition | per shard | per ordering key (optional) | per partition / key |
| **Replay** | yes, any offset in retention | yes, within retention (up to 365 days) | seek to a time or snapshot | yes |
| **Operations** | self-managed or managed (MSK, Confluent Cloud, Aiven) | fully managed | fully managed, global | self-managed or managed |
| **Good fit** | event backbone, CDC, stream processing, very high throughput | AWS-native streaming | GCP-native fan-out, push to serverless | multi-tenant messaging and streaming |

Redpanda and Azure Event Hubs expose the **Kafka protocol**, so Kafka clients work against them unchanged. Kafka itself is also growing queue semantics: **share groups** ("Queues for Kafka", KIP-932, introduced in Kafka 4.0) let several consumers share a partition with per-record acknowledgement, like a classic queue.

!!! tip "In the interview"
    When you put Kafka on the board, the interviewer expects four decisions, said out loud: **(1) the topic and the key** ("`order-events`, keyed by `orderId`, because we need per-order ordering and an even spread"); **(2) partitions** from a throughput estimate with the consumer as the usual bottleneck; **(3) durability** (RF 3 across zones, `acks=all`, `min.insync.replicas=2`); **(4) retention** (7 days to allow replay, or compaction for state). Mention consumer lag as the metric you alert on. Be ready for "what happens if a broker dies?" (leader election from the ISR, producers retry, no acknowledged data lost) and "how do you scale consumers?" (up to the number of partitions).

!!! warning "Common pitfalls"

    - **A low-cardinality key** (country, show, `true`/`false`) creates hot partitions that no number of consumers can fix.
    - **Too few partitions**: the group cannot scale beyond them, and adding partitions later remaps keys.
    - **`acks=1` or `min.insync.replicas=1`** for business events: "acknowledged" does not mean "safe".
    - **Processing a partition with a thread pool** without keying the work: ordering is silently lost.
    - **Slow processing inside the poll loop** beyond `max.poll.interval.ms`: the consumer is kicked out, the group rebalances, another consumer gets the same records — a rebalance storm with duplicates.
    - **Using Kafka as a database** for queries by arbitrary fields. Kafka is read sequentially by offset; build query models in a database from it ([CQRS](../patterns/index.md#cqrs)).

## How it connects { #how-it-connects }

``` mermaid
flowchart LR
    LOG["append-only log<br/>offsets"] --> PART["partitions<br/>unit of parallelism"]
    KEY["key = orderId<br/>murmur2 mod N"] --> PART
    PART --> ORD["order per key<br/>→ Delivery semantics"]
    PART --> CG["consumer groups<br/>one consumer per partition"]
    CG --> LAG["consumer lag<br/>→ Observability"]
    PART --> REP["RF 3, acks=all,<br/>min.insync.replicas=2"]
    REP --> KRAFT["KRaft controllers<br/>→ Consensus (class 3)"]
    LOG --> RET["retention, compaction,<br/>tiered storage"]
    LOG --> REPLAY["replay: CDC, event sourcing<br/>→ Patterns"]
    PART --> SIZE["N ≥ max(T/p, T/c)<br/>→ Estimation"]
    KEY --> HOT["hot key, hash mod N moves keys<br/>→ Databases partitioning"]
```

**Palette components:** [`kafka`](../../../reference/components/messaging/index.md#kafka) · [`stream`](../../../reference/components/messaging/index.md#stream) (the managed equivalent: Kinesis, Event Hubs) · [`objstore`](../../../reference/components/storage/index.md#objstore) (tiered storage) · [`dwh`](../../../reference/components/storage/index.md#dwh) (the warehouse loader replays the log) · [`notifications`](../../../reference/components/compute/index.md#notifications) · [`analytics`](../../../reference/components/compute/index.md#analytics) · [`search`](../../../reference/components/compute/index.md#search) (consumer groups reading at their own pace). **Scenarios:** `event-fanout`. **Continues in:** [Delivery semantics](../semantics/index.md), [Patterns](../patterns/index.md), [Distributed — consensus](../../distributed/consensus/index.md) (KRaft is Raft), [Databases — partitioning](../../databases/partitioning/index.md) (hot keys, resharding), [Observability — signals](../../observability/signals/index.md) (lag as a metric), [Hands-on 7 — Kafka](../../../hands-on/7/kafka/index.md).

---

[^1]: KREPS, J.; NARKHEDE, N.; RAO, J. Kafka: a Distributed Messaging System for Log Processing. In: *NetDB Workshop*, 2011.
[^2]: KREPS, J. [The Log: What every software engineer should know about real-time data's unifying abstraction](https://engineering.linkedin.com/distributed-systems/log-what-every-software-engineer-should-know-about-real-time-datas-unifying){target="_blank"}. LinkedIn Engineering, 2013.
[^3]: [Apache Kafka Documentation — Design](https://kafka.apache.org/documentation/#design){target="_blank"}. Apache Software Foundation.
[^4]: SHAPIRA, G.; PALINO, T.; SIVARAM, R.; PETTY, K. *Kafka: The Definitive Guide*, 2nd ed. O'Reilly, 2021. Chapters on producers, consumers and reliable delivery.
