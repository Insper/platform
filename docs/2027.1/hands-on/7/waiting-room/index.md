# 4. Waiting Room

At 10:00, 2 million fans press "Buy" for 60 thousand seats. Kafka protects `notification` from the
burst, but the burst first hits the **synchronous** path: seat holds and orders, backed by a strongly
consistent inventory that cannot scale to 2 million requests per second. The usual answer of
ticketing and sneaker-drop sites is a **virtual waiting room**: a queue *in front of* the system that
lets fans in at the rate the system can serve, in arrival order, and tells everyone else their
position honestly.

``` diagram-sim
flowchart LR
    fans["2 M fans"] -->|POST join| wr["waiting room (Redis FIFO)"]
    wr -->|"position, ETA"| fans
    adm["admitter (every 1 s)"] -->|"ZPOPMIN N"| wr
    adm -->|"admitted ticket, TTL 5 min"| redis[(Redis)]
    fans -->|"POST /orders + X-Admission-Ticket"| order[order]
    order -->|"ticket admitted?"| redis
```

This is **queue-based load leveling**: arrivals are bursty, service is constant, and the queue holds
the difference. Little's Law gives the honest ETA a fan sees:

$$
\text{wait} \approx \frac{\text{position in the queue}}{\text{admission rate}}
\qquad \text{e.g. } \frac{30\,000}{500\ \text{fans/s}} = 60\ \text{s}
$$

## Design

| Decision | Choice here | Why |
|---|---|---|
| Queue store | a Redis **sorted set** per show, score = arrival sequence | O(log n) join and rank, atomic pop of the N first (`ZPOPMIN`) |
| Fairness | sequence from `INCR`, not client timestamps | clients' clocks lie; the server decides the order |
| Admission | every second, pop `admit-per-second` tickets and mark them admitted with a TTL | the rate is the knob; the TTL frees capacity of fans who give up |
| Gate | `POST /orders` requires an admitted `X-Admission-Ticket` **while the on-sale is open** | without enforcement, bots skip the queue |
| Position | the client polls `GET /tickets/{id}` | simple; at scale, push via SSE/WebSocket or long polling |

!!! warning "Where the gate belongs"

    The gate must cover **every** expensive step of the on-sale (seat holds in `inventory` and orders),
    so in production it lives at the edge: a gateway filter ([lab 4](../../4/index.md)) or a CDN
    waiting-room product. This lab enforces it in `order` to stay small; moving it to the gateway is
    a good extension.

## Code (in the `order` service)

=== "WaitingRoom.java"

    ``` java title="services/order/src/main/java/boxoffice/order/waitingroom/WaitingRoom.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/waitingroom/WaitingRoom.java"
    ```

=== "Ticket.java"

    ``` java title="services/order/src/main/java/boxoffice/order/waitingroom/Ticket.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/waitingroom/Ticket.java"
    ```

=== "WaitingRoomProperties.java"

    ``` java title="services/order/src/main/java/boxoffice/order/waitingroom/WaitingRoomProperties.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/waitingroom/WaitingRoomProperties.java"
    ```

=== "WaitingRoomController.java"

    ``` java title="services/order/src/main/java/boxoffice/order/waitingroom/WaitingRoomController.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/waitingroom/WaitingRoomController.java"
    ```

=== "OrderController.java (gated)"

    ``` java title="services/order/src/main/java/boxoffice/order/OrderController.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/OrderController.java"
    ```

The waiting-room properties are already in the complete `services/order/src/main/resources/application.yaml`
of [step 2](../outbox/index.md); check that yours has this block (add it if you wrote the file by hand):

``` yaml title="services/order/src/main/resources/application.yaml (additions)"
boxoffice:
  waiting-room:
    admit-per-second: ${ADMIT_PER_SECOND:20}
    admission-ttl: 5m
```

## Try it

<!-- termynal -->

``` shell
> docker compose up -d --build --wait order
> curl -s -X POST localhost:8084/orders/waiting-room/show-42/open -o /dev/null -w '%{http_code}\n'
204
> curl -s -X POST localhost:8084/orders/waiting-room/show-42/join
{"ticketId":"0c6f3b8e-0f2a-4a8e-9d55-1b7c5b3c9e21","status":"WAITING","position":1,"etaSeconds":1}
> curl -s localhost:8084/orders/waiting-room/show-42/tickets/0c6f3b8e-0f2a-4a8e-9d55-1b7c5b3c9e21
{"ticketId":"0c6f3b8e-0f2a-4a8e-9d55-1b7c5b3c9e21","status":"ADMITTED","expiresInSeconds":298}
> curl -s -X POST localhost:8084/orders -H 'Content-Type: application/json' \
    -d '{"showId":"show-42","holdId":"hold-0100","customerEmail":"caio@example.com","amount":350.00}' \
    -o /dev/null -w '%{http_code}\n'
403
> curl -s -X POST localhost:8084/orders -H 'Content-Type: application/json' \
    -H 'X-Admission-Ticket: 0c6f3b8e-0f2a-4a8e-9d55-1b7c5b3c9e21' \
    -d '{"showId":"show-42","holdId":"hold-0100","customerEmail":"caio@example.com","amount":350.00}' \
    -o /dev/null -w '%{http_code}\n'
201
```

Peek at the data structure while a k6 spike runs ([step 5](../measure/index.md)):

``` shell
docker compose exec redis redis-cli ZCARD wr:show-42:queue
docker compose exec redis redis-cli ZRANGE wr:show-42:queue 0 4 WITHSCORES
```

!!! warning "Pitfalls"

    - **The admitter must run once.** With 3 `order` replicas, three admitters pop 3 × N per second.
      Run it in a single instance (a dedicated worker), elect a leader, or use a distributed lock
      (e.g. ShedLock) — see the [scheduler discussion](../../../classes/compute/async-work/index.md).
    - **Admitted ≠ bought.** The TTL returns abandoned slots; a smarter admitter admits
      `capacity − active buyers` instead of a fixed N.
    - **The waiting room itself must scale.** Joins and polls are cheap Redis operations, but 2 M fans
      polling every second is 2 M requests per second: poll less often as the position is far, serve
      the waiting page from the CDN, and keep the queue on its own Redis.
    - **Bots** join many times. Rate-limit joins per client and require a challenge (WAF) before joining.

[Next: Measure it](../measure/index.md){ .md-button .md-button--primary }
