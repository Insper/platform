# 5. Measure It

Five experiments, one results table. Run each experiment at least twice and report the second run
(the first one warms up the JVMs and the connection pools). The numbers in the "expected shape"
boxes are **illustrative** — what matters is that you can explain *your* numbers.

| # | Experiment | Knob | What you record |
|---|---|---|---|
| A | sync vs outbox | `NOTIFY_MODE` | `POST /orders` p50 / p95 / p99 |
| B | `notification` outage | stop the container mid-test | error rate, lag peak, time to drain |
| C | burst and drain | `NOTIFY_CONCURRENCY` 1 vs 6 | lag over time, drain time, e-mail delay p95 |
| D | replay | `NOTIFY_IDEMPOTENT` | e-mails per order after an offset reset |
| E | flash-sale spike | waiting room open, `ADMIT_PER_SECOND=10` | admitted/s, wait p95, ETA error, order p95 |

## The k6 scripts

=== "orders-load.js"

    ``` javascript title="load/orders-load.js"
    --8<-- "docs/2027.1/hands-on/7/code/load/orders-load.js"
    ```

=== "waiting-room-spike.js"

    ``` javascript title="load/waiting-room-spike.js"
    --8<-- "docs/2027.1/hands-on/7/code/load/waiting-room-spike.js"
    ```

=== "kafka-lag.sh"

    ``` shell title="scripts/kafka-lag.sh"
    --8<-- "docs/2027.1/hands-on/7/code/scripts/kafka-lag.sh"
    ```

Run every k6 test with the percentiles in the summary:

``` shell
k6 run --summary-trend-stats="avg,p(50),p(95),p(99),max" load/orders-load.js
```

## A. Sync vs outbox

``` shell
NOTIFY_MODE=sync docker compose up -d order        # "before"
k6 run --summary-trend-stats="avg,p(50),p(95),p(99),max" load/orders-load.js
NOTIFY_MODE=outbox docker compose up -d order      # "after"
k6 run --summary-trend-stats="avg,p(50),p(95),p(99),max" load/orders-load.js
```

The variables reach the containers because `docker-compose.yaml` interpolates them
(`NOTIFY_MODE: ${NOTIFY_MODE:-outbox}`), as written in steps 2 and 3.

!!! example "Expected shape (illustrative)"

    With `EMAIL_LATENCY=50ms` on an idle machine, the synchronous p50 sits a little above 50 ms — the
    fan pays for the e-mail on every order — while the outbox version answers in a few milliseconds
    (two inserts and a commit). On a **busy** laptop (the whole lab 7 stack plus other containers, load
    average above 10 on 8 cores) one test run gave:

    | 50 orders/s for 30 s | p50 | p95 | p99 | throughput |
    |---|---|---|---|---|
    | `NOTIFY_MODE=sync` | 4.12 s | 8.14 s | 11.51 s | 38.7/s (k6 could not keep the rate) |
    | `NOTIFY_MODE=outbox` | 47 ms | 658 ms | 1.29 s | 49.5/s |

    The absolute numbers depend on your machine; the **ratio** is the lesson: when the e-mail is in the
    request path, every order waits for it and the service saturates far earlier. If even the outbox
    version is slow for you, close other containers (`docker ps`) and run again.

## B. `notification` outage

Run the load for 60 s and, in another terminal, kill `notification` for 20 s in the middle:

``` shell
sleep 20; docker compose stop notification; sleep 20; docker compose start notification
```

Do it once per mode, with `sh scripts/kafka-lag.sh` running in a third terminal. In `sync` mode, about a third
of the orders fail — an e-mail outage became an ordering outage. In `outbox` mode no order fails; the
lag climbs while `notification` is down and drains after it comes back.

## C. Burst and drain

``` shell
NOTIFY_CONCURRENCY=1 docker compose up -d notification
RATE=100 k6 run load/orders-load.js           # kafka-lag.sh in another terminal
NOTIFY_CONCURRENCY=6 docker compose up -d notification
RATE=100 k6 run load/orders-load.js
```

Then measure how late the e-mails were:

``` sql
-- docker compose exec db psql -U boxoffice -d boxoffice
SELECT count(*) AS emails,
       percentile_cont(0.50) WITHIN GROUP (ORDER BY extract(epoch FROM sent_at - occurred_at)) AS p50_s,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM sent_at - occurred_at)) AS p95_s
FROM notification.notifications
WHERE sent_at > now() - interval '10 minutes';
```

??? question "Predict before you run: what lag will concurrency 1 reach?"

    Each consumer thread handles at most 1 / 50 ms = **20 e-mails/s**. With one thread and 100 orders/s,
    the backlog grows at 100 − 20 = 80 messages/s: after 60 s, **≈ 4 800** messages of lag, and it
    drains at 20/s → **≈ 240 s** to empty. With six threads (capacity 120/s > 100/s) the lag stays near
    zero. More than six threads would not help: the topic has six partitions.

## D. Replay

``` shell
docker compose stop notification
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka:9092 \
  --group notification --topic order-events --reset-offsets --to-earliest --execute
docker compose start notification
```

Wait until `kafka-lag.sh` shows 0, then compare e-mails with distinct orders:

``` sql
SELECT count(*) AS emails, count(DISTINCT order_id) AS orders FROM notification.notifications;
```

Do it with `NOTIFY_IDEMPOTENT=true` and with `NOTIFY_IDEMPOTENT=false` (restart `notification` with
the variable set, as in C).

## E. Flash-sale spike through the waiting room

``` shell
ADMIT_PER_SECOND=10 docker compose up -d order
k6 run --summary-trend-stats="avg,p(50),p(95),p(99),max" load/waiting-room-spike.js
```

About 700 fans arrive in 40 s, at 20 per second; the room lets 10 per second in. Check in the
summary: `wr_admitted` grows at 10/s, `http_req_duration{name:order}` stays flat, every bot request
gets `403`, and `wr_eta_error_seconds` — the actual wait minus the ETA promised at join — stays within
a couple of seconds: Little's Law, `wait = position / rate`, is an honest promise when the rate is
constant.

## Results

Copy this table into your repository (`results/lab7.md`) and fill it in.

| Metric | Before | After |
|---|---|---|
| A · Throughput (req/s) | | |
| A · `POST /orders` p50 (ms) | | |
| A · `POST /orders` p95 (ms) | | |
| A · `POST /orders` p99 (ms) | | |
| A · Error rate (%) | | |
| B · Error rate with `notification` down 20 s (%) | | |
| B · Peak lag (messages) / time to drain (s) | — | |
| C · Peak lag, concurrency 1 vs 6 (messages) | | |
| C · Drain time, concurrency 1 vs 6 (s) | | |
| C · E-mail delay p95, concurrency 1 vs 6 (s) | | |
| D · E-mails / distinct orders after replay (idempotent off vs on) | | |
| E · Orders per second during the spike | — | |
| E · Wait p95 (s) / ETA error p95 (s) | — | |
| E · Order p95 (ms) / bots refused (%) | — | |

"Before" is `sync` (A, B), concurrency 1 (C), idempotency off (D). Under the table, write one
paragraph per experiment: what changed, **why** (with the formula or the mechanism), and what you
would do next in production.

[Back to the overview](../index.md){ .md-button } [Quiz](../quiz.md){ .md-button .md-button--primary }
