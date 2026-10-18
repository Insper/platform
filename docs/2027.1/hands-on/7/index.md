# 7. Async Messaging

!!! info "Goal"

    Take the slow, fragile work out of BoxOffice's request path. The `order` service records each
    order and an `OrderPlaced` event **in the same database transaction** (transactional outbox); a
    relay publishes the event to **Kafka**; the `notification` service consumes it **idempotently**,
    sends the e-mail and parks poison messages in a **dead-letter topic**. Finally, a **waiting room**
    queues the flash-sale crowd so that only as many fans enter as the system can serve.

It is 10:00 and the stadium show goes on sale. Every `POST /orders` that the `order` service accepts
must also produce a confirmation e-mail. If `order` calls `notification` over HTTP, the fan waits for
the e-mail provider, an e-mail outage becomes an ordering outage, and the 2 million fans who arrive at
the same second hit every service at once. This lab replaces that coupling with three ideas from the
[messaging class](../../classes/messaging/index.md): **events on a log**, **at-least-once delivery
handled with idempotency**, and **queues that absorb a spike**.

## Slides

<div class="slides-embed">
  <iframe src="slides/async.html" title="Slides: async messaging" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/async.html){:target="_blank"}

## Before you start

| | |
|---|---|
| Time | about 4 hours (two meetings) |
| Tools | Docker with Compose v2 (`docker compose version`), k6 1.x (`k6 version`), `curl`, `jq` — all from [lab 0](../0/index.md). The Java services are built **inside Docker**: no local JDK or Maven needed for this lab |
| Docker resources | at least 4 CPUs and **8 GB** of memory (Kafka and two more JVMs join the lab 6 stack) |
| Ports | free on your machine: 8084, 8086, 8089, 8025, 1025, 9094 (plus the lab 6 ones) |

Your repository must be in the state lab 6 left it. Every command of this lab runs from the **root
of your `boxoffice` repository**.

``` text title="Start state (end of lab 6)"
boxoffice/
├── docker-compose.yaml     # db, db-replica, pgbouncer, redis, catalog-1..3, inventory, auth, gateway, edge
├── infra/                  # nginx/, postgres/, pgbouncer/
├── load/                   # k6 scripts of labs 0-6
├── scripts/
└── services/
    ├── auth/
    ├── catalog/
    ├── gateway/
    └── inventory/
```

!!! tip "Catch up"

    Skipped or broke lab 6? Download [boxoffice-after-lab-6.zip](../6/boxoffice-after-lab-6.zip),
    unzip it, `cd boxoffice`, and continue from here.

Every file of this lab is shown **in full** on these pages, with its path as the title, and is also
published under `https://insper.github.io/platform/2027.1/hands-on/7/code/<path>` — for example
`curl -fsSL -o docker-compose.yaml https://insper.github.io/platform/2027.1/hands-on/7/code/docker-compose.yaml`.

## Architecture

=== "Before (synchronous)"

    ``` mermaid-sim
    flowchart LR
        fan[Fan] -->|POST /orders| gw[gateway]
        gw --> order[order]
        order -->|INSERT order| db[(PostgreSQL)]
        order -->|"POST /notifications (waits)"| notification[notification]
        notification -->|SMTP| mail[mailpit]
        notification -->|201 after the e-mail| order
        order -->|201| gw
    ```

=== "After (events)"

    ``` mermaid-sim
    flowchart LR
        fan[Fan] -->|join| wr[waiting room]
        wr -->|admitted| gw[gateway]
        gw -->|POST /orders| order[order]
        order -->|"INSERT order + outbox (1 tx)"| db[(PostgreSQL)]
        order -->|201 right away| gw
        relay[outbox relay] -->|poll unpublished| db
        relay -->|publish OrderPlaced| kafka[(Kafka: order-events)]
        kafka -->|consumer group notification| notification[notification]
        notification -->|"processed_events (dedupe)"| ndb[(PostgreSQL)]
        notification -->|SMTP| mail[mailpit]
        notification -.->|after 3 failed retries| dlt[(order-events-dlt)]
    ```

The fan's request now ends at the database commit. Everything after the commit — publishing,
e-mail, retries — happens **asynchronously** and can be slow, fail or be repeated without the fan
noticing.

!!! example "BoxOffice components touched"

    | Palette component | In this lab |
    |---|---|
    | [Kafka](../../reference/components/messaging/index.md#kafka) | single-node Kafka 4 in KRaft mode, topic `order-events` with 6 partitions |
    | [Message Queue](../../reference/components/messaging/index.md#queue) | the waiting room: a FIFO of fans in Redis, drained at a fixed admission rate |
    | [App Server](../../reference/components/compute/index.md#app) | `order` (producer, outbox relay, waiting room) |
    | [Notifications](../../reference/components/compute/index.md#notifications) | `notification` (idempotent consumer, DLT) |
    | [Email](../../reference/components/external/index.md#email) | Mailpit, a local SMTP server with a web inbox |

## What you will measure

| Question | Metric | Tool |
|---|---|---|
| How much faster is `POST /orders` without the e-mail inline? | p50 / p95 / p99, error rate | k6 |
| What happens to orders while `notification` is down? | error rate, consumer lag | k6, `kafka-consumer-groups.sh` |
| Does a burst build a backlog, and how fast does it drain? | lag over time, drain time, e-mail delay p95 | `kafka-consumer-groups.sh`, SQL |
| Does redelivery send duplicate e-mails? | e-mails per order | Mailpit API |
| Does the waiting room hold the admission rate under a spike? | admitted/s, queue position, order p95 | k6 |

## Prerequisites

- Labs [1](../1/index.md) to [6](../6/index.md) done: your `boxoffice` repository runs `db` (PostgreSQL), `redis`,
  `catalog`, `inventory` and the `gateway` with `docker compose`.
- About 2 GB of extra memory for Docker (Kafka is a JVM).
- Read the [messaging class](../../classes/messaging/index.md), especially
  [Kafka](../../classes/messaging/kafka/index.md), [delivery semantics](../../classes/messaging/semantics/index.md)
  and the [outbox pattern](../../classes/messaging/patterns/index.md).

## Steps

1. [Kafka in Compose](kafka/index.md) — a KRaft broker, the `order-events` topic, Kafka UI and Mailpit; a tour of the CLI.
2. [Transactional outbox](outbox/index.md) — the `order` service writes the order and the event in one transaction; a relay publishes it.
3. [Idempotent consumer and DLT](consumer/index.md) — the `notification` service dedupes by `eventId`, retries with backoff and dead-letters poison messages.
4. [Waiting room](waiting-room/index.md) — a Redis FIFO that admits fans at a fixed rate during the on-sale.
5. [Measure it](measure/index.md) — sync vs async latency, outage behavior, lag and drain time, duplicates, admission rate.

## Try it in the playground

Before writing code, see the two shapes this lab builds. **Try it:** in the first simulator, run the
`load` profile and watch every consumer service receive its own copy of each event (fan-out); then
raise the target RPS until one consumer lags behind while the producer stays fast. In the second, run
`spike` and watch the queue backlog grow and drain while the workers stay at a constant rate.

<div class="sdp" data-scenario="event-fanout" data-mode="compact" data-height="520"></div>

<div class="sdp" data-scenario="async-queue" data-mode="compact" data-height="520" data-profile="spike"></div>

The full simulator is in the [playground](../../../playground/index.md).

## Measure it

The [Measure it](measure/index.md) step has the k6 scripts and the results table. Fill it in and keep
it in your repository: it is part of the deliverable.

## Troubleshooting { #troubleshooting }

| Symptom | Likely cause | Fix |
|---|---|---|
| `kafka` stays `starting`/`unhealthy`; `kafka-init` never runs | not enough memory for Docker, or port 9094 in use | give Docker 8 GB; `lsof -i :9094`; `docker compose logs kafka` |
| `order`/`notification` restart with `Connection to node -1 … could not be established` | they started before Kafka was ready (only if you removed `depends_on`) | `docker compose up -d order notification` again once `kafka` is healthy |
| `order` fails with `Unable to obtain connection from database` | `db` not healthy yet, or wrong `DB_*` variables | `docker compose ps db`; the variables are in the `order` service of `docker-compose.yaml` |
| `POST /orders` answers `403 on-sale in progress` | the waiting room of that show is open (step 4) | use another `showId`, or `curl -X POST localhost:8084/orders/waiting-room/show-42/close` |
| No e-mail in Mailpit | `notification` is down, lagging, or the event went to the DLT | `docker compose logs notification`; `sh scripts/kafka-lag.sh`; query `notification.dead_letters` |
| `docker compose exec kafka …` fails with `service "kafka" is not running` | the broker was stopped in an experiment | `docker compose start kafka` |
| Build fails with `Could not resolve dependencies` | no Internet access during `docker compose build` | retry with network; Maven downloads once and caches (`--mount=type=cache`) |
| Apple Silicon: `no matching manifest for linux/arm64` | an image without an arm64 variant | all images of this lab are multi-arch; check you typed the tags exactly |

## Clean up

When you finish (or before lab 8), stop the stack and keep the data, or remove everything:

``` shell
docker compose stop                 # keep containers and volumes for the next lab
docker compose down -v              # or: remove containers, networks and volumes (all data)
```

Lab 8 starts from this state; nothing needs to be kept besides your repository.

## End state

``` text title="End state (what this lab added)"
boxoffice/
├── docker-compose.yaml     # + kafka, kafka-init, kafka-ui, mailpit, order, notification
├── load/
│   ├── orders-load.js
│   └── waiting-room-spike.js
├── scripts/
│   └── kafka-lag.sh
└── services/
    ├── notification/       # new: idempotent consumer, DLT, e-mail
    └── order/              # new: orders, outbox relay, waiting room
```

Commit and tag: `git add -A && git commit -m "lab 7: async messaging" && git tag lab7`.

## Checklist

- [ ] `kafka`, `kafka-init`, `kafka-ui` and `mailpit` run in `docker-compose.yaml`; `order-events` and `order-events-dlt` have 6 partitions each
- [ ] `order` writes `orders` and `outbox` in one transaction; retrying `POST /orders` with the same `holdId` returns the same order and creates no new event
- [ ] the outbox relay publishes with key = `orderId` and marks rows as published; stopping Kafka loses no event
- [ ] `notification` sends one e-mail per order even after an offset reset (duplicates are skipped)
- [ ] a poison message lands in `order-events-dlt` after the retries, and the partition keeps flowing
- [ ] the waiting room admits at the configured rate; `POST /orders` without an admission ticket is refused during the on-sale
- [ ] results table of the [Measure it](measure/index.md) step filled in `results/lab7.md`, with a short explanation of each number
- [ ] self-check: `docker compose down -v && docker compose up -d --build` from a clean clone brings everything up healthy; then pushed to GitHub with the tag `lab7`

## Related

- Theory: [Messaging & event-driven](../../classes/messaging/index.md) ·
  [Queues and pub/sub](../../classes/messaging/queues-pubsub/index.md) ·
  [Kafka](../../classes/messaging/kafka/index.md) ·
  [Patterns: outbox, saga, CQRS](../../classes/messaging/patterns/index.md) ·
  [Delivery semantics](../../classes/messaging/semantics/index.md)
- Case study: [Ticketing (BoxOffice flash sale)](../../classes/case-studies/ticketing/index.md)
- Exercise: [Event-driven](../../exercises/event-driven/index.md)
- Next lab: [8. Observability](../8/index.md) traces this flow end to end, across the Kafka hop.

[Start: Kafka in Compose](kafka/index.md){ .md-button .md-button--primary }
