# 1. Kafka in Compose

In this step you replace your `docker-compose.yaml` with the complete file of this lab, start the four
new infrastructure containers and get to know Kafka from the command line before any Java code uses
it. All commands run from the **root of your `boxoffice` repository**.

| Container | Image | Host port | Role |
|---|---|---|---|
| `kafka` | `apache/kafka:4.3.1` | 9094 | one broker that is also its own controller (KRaft) |
| `kafka-init` | `apache/kafka:4.3.1` | — | one-shot job: creates the topics and exits |
| `kafka-ui` | `kafbat/kafka-ui:v1.5.0` | 8089 | browse topics, messages, headers and consumer lag |
| `mailpit` | `axllent/mailpit:v1.31` | 8025 (web), 1025 (SMTP) | fake e-mail provider with an inbox and an API |

## Kafka in KRaft mode

Kafka keeps its own metadata (topics, partitions, leaders) in a Raft quorum of **controllers** —
**KRaft**. ZooKeeper is gone since Kafka 4.0. Here a single node plays both roles,
`broker,controller`. This is the new part of `docker-compose.yaml`:

``` yaml title="docker-compose.yaml (excerpt)"
  kafka:
    image: apache/kafka:4.3.1
    hostname: kafka
    ports:
      - "9094:9094"
    environment:
      KAFKA_NODE_ID: 1
      KAFKA_PROCESS_ROLES: broker,controller
      KAFKA_CONTROLLER_QUORUM_VOTERS: 1@kafka:9093
      KAFKA_LISTENERS: PLAINTEXT://:9092,CONTROLLER://:9093,EXTERNAL://:9094
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092,EXTERNAL://localhost:9094
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT,EXTERNAL:PLAINTEXT
      KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER
      KAFKA_INTER_BROKER_LISTENER_NAME: PLAINTEXT
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: 1
      KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS: 0
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: "false"
    healthcheck:
      test: ["CMD-SHELL", "/opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server localhost:9092 > /dev/null 2>&1"]
      interval: 10s
      timeout: 10s
      start_period: 60s      # a busy laptop can take a minute to start the broker
      retries: 20

  kafka-init:
    image: apache/kafka:4.3.1
    depends_on:
      kafka:
        condition: service_healthy
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --create --if-not-exists \
          --topic order-events --partitions 6 --replication-factor 1 &&
        /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --create --if-not-exists \
          --topic order-events-dlt --partitions 6 --replication-factor 1
    restart: "no"

  kafka-ui:
    image: kafbat/kafka-ui:v1.5.0
    depends_on:
      kafka:
        condition: service_healthy
    ports:
      - "8089:8080"
    environment:
      KAFKA_CLUSTERS_0_NAME: boxoffice
      KAFKA_CLUSTERS_0_BOOTSTRAPSERVERS: kafka:9092

  mailpit:
    image: axllent/mailpit:v1.31
    ports:
      - "8025:8025"
      - "1025:1025"
```

!!! tip "Get the complete file"

    Run from the root of your `boxoffice` repository (it replaces the lab 6 version; keep a copy if you
    changed it):

    ``` shell
    cp docker-compose.yaml docker-compose.lab6.yaml
    curl -fsSL -o docker-compose.yaml https://insper.github.io/platform/2027.1/hands-on/7/code/docker-compose.yaml
    docker compose config --services
    ```

    You should see the lab 6 services plus `kafka`, `kafka-init`, `kafka-ui`, `mailpit`, `order` and
    `notification`. `order` and `notification` are built in steps 2 and 3; until then, start only the
    services named in each command. Delete `docker-compose.lab6.yaml` before you commit: Git already
    keeps the lab 6 version (`git show lab6:docker-compose.yaml`).

??? example "docker-compose.yaml — the complete file at the end of this lab"

    ``` yaml title="docker-compose.yaml"
    --8<-- "docs/2027.1/hands-on/7/code/docker-compose.yaml"
    ```

Three details matter:

- **Two client listeners.** Containers reach the broker as `kafka:9092` (`PLAINTEXT`). A program on
  your laptop (an IDE run, a CLI) uses `localhost:9094` (`EXTERNAL`). A client first connects to any
  address, then receives the *advertised* address of each partition leader and reconnects there — so
  each listener must advertise a name that *its* clients can resolve. Mixing them up is the classic
  "connects, then times out" bug. That is why Kafka is the one exception to the "same port inside and
  outside" rule of [lab 0](../../0/index.md): services use `kafka:9092`, your machine uses `localhost:9094`.
- **Topics are created explicitly** (`KAFKA_AUTO_CREATE_TOPICS_ENABLE: "false"`). Auto-creation uses
  the broker default of 1 partition, which would silently cap the consumer parallelism at 1.
- **The dead-letter topic has as many partitions as the main topic**: Spring's dead-letter
  publisher writes a failed record to the *same partition number* in `order-events-dlt`.

!!! info "Why 6 partitions?"

    A partition is consumed by **at most one consumer of a group** at a time, so the number of
    partitions is the ceiling of consumer parallelism. Six lets the `notification` group grow to six
    consumers. Partitions are cheap to start with and painful to add later: adding partitions changes
    which partition a key maps to, breaking per-key ordering for keys already in flight.

## Start and check

<!-- termynal -->

``` shell
> docker compose up -d kafka kafka-init kafka-ui mailpit
 ✔ Container boxoffice-mailpit-1     Healthy
 ✔ Container boxoffice-kafka-1       Healthy
 ✔ Container boxoffice-kafka-init-1  Started
 ✔ Container boxoffice-kafka-ui-1    Started
> docker compose logs kafka-init
kafka-init-1  | Created topic order-events.
kafka-init-1  | Created topic order-events-dlt.
> docker compose exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --describe --topic order-events
Topic: order-events	TopicId: hwjrAir1Q8m_ZV4fyhnctw	PartitionCount: 6	ReplicationFactor: 1	Configs: min.insync.replicas=1
	Topic: order-events	Partition: 0	Leader: 1	Replicas: 1	Isr: 1	Elr: 	LastKnownElr:
	Topic: order-events	Partition: 1	Leader: 1	Replicas: 1	Isr: 1	Elr: 	LastKnownElr:
	Topic: order-events	Partition: 2	Leader: 1	Replicas: 1	Isr: 1	Elr: 	LastKnownElr:
	Topic: order-events	Partition: 3	Leader: 1	Replicas: 1	Isr: 1	Elr: 	LastKnownElr:
	Topic: order-events	Partition: 4	Leader: 1	Replicas: 1	Isr: 1	Elr: 	LastKnownElr:
	Topic: order-events	Partition: 5	Leader: 1	Replicas: 1	Isr: 1	Elr: 	LastKnownElr:
```

You should see all four containers running (`docker compose ps`), six partitions for `order-events`,
Kafka UI at `http://localhost:8089` (cluster *boxoffice* online, topics `order-events` and
`order-events-dlt`) and an empty Mailpit inbox at `http://localhost:8025`. The `TopicId` differs on
every machine. If `kafka` stays `starting` for more than a minute, see Troubleshooting in the
[overview](../index.md#troubleshooting).

## A five-minute tour of the log

Before Spring hides it, feel how a **log** differs from a queue. Open two terminals.

In terminal A, start a consumer in group `tour`:

``` shell
docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server kafka:9092 --topic order-events --group tour \
  --formatter-property print.key=true --formatter-property print.partition=true
```

In terminal B, produce three keyed messages (`key:value`):

``` shell
docker compose exec -T kafka /opt/kafka/bin/kafka-console-producer.sh \
  --bootstrap-server kafka:9092 --topic order-events \
  --reader-property parse.key=true --reader-property key.separator=: <<'EOF'
order-1:{"hello":"first"}
order-2:{"hello":"second"}
order-1:{"hello":"third"}
EOF
```

Terminal A prints each message with its partition, for example:

``` text
Partition:4	order-1	{"hello":"first"}
Partition:3	order-2	{"hello":"second"}
Partition:4	order-1	{"hello":"third"}
```

Both `order-1` messages land on the **same
partition** — the default partitioner hashes the key (murmur2) modulo the number of partitions — and
that is the only ordering Kafka promises: **per partition, hence per key**.

Now stop the consumer (++ctrl+c++) and look at the group:

<!-- termynal -->

``` shell
> docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --group tour

Consumer group 'tour' has no active members.

GROUP           TOPIC           PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG             CONSUMER-ID     HOST            CLIENT-ID
tour            order-events    0          0               0               0               -               -               -
tour            order-events    1          0               0               0               -               -               -
tour            order-events    2          0               0               0               -               -               -
tour            order-events    3          1               1               0               -               -               -
tour            order-events    4          2               2               0               -               -               -
tour            order-events    5          0               0               0               -               -               -
```

The messages are **still in the log**: consuming does not delete. Each group only stores its
**offset** per partition (`CURRENT-OFFSET`), and **lag** = `LOG-END-OFFSET − CURRENT-OFFSET` is how
far behind it is. Rewind the group and read everything again:

``` shell
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka:9092 \
  --group tour --topic order-events --reset-offsets --to-earliest --execute
```

That replay ability is what makes Kafka a good backbone for new consumers (analytics can read the
whole history) — and also why **every consumer must tolerate seeing a message twice**.

!!! warning "Keep the tour messages"

    The three test messages are not valid BoxOffice events. They will be useful later: in
    [step 3](../consumer/index.md) they are exactly the kind of *poison message* the consumer must
    survive. Leave them there.

??? question "Think first: a consumer group with 8 instances on a 6-partition topic"

    How many instances receive messages? What do the other ones do?

    Six. Each partition is assigned to one member of the group, so two instances stay **idle** (they
    take over if another member dies). To use more consumers, the topic needs more partitions.

[Next: Transactional outbox](../outbox/index.md){ .md-button .md-button--primary }
