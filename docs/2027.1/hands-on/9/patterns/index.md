# 2. Resilience Patterns

`order` now calls `payment` synchronously: `POST /orders/{id}/pay` charges the fan and, on success,
confirms the order. This step first shows what one slow dependency does to an unprotected service,
then adds the four patterns of the [reliability class](../../../classes/reliability/patterns/index.md)
one at a time — **timeout, retry, circuit breaker, bulkhead** — measuring after each.

## The failure we are defending against

``` mermaid-sim
sequenceDiagram
    participant F as fans (20/s)
    participant O as order (50 threads)
    participant P as payment (+3 s latency)
    F->>O: POST /orders/1/pay
    O->>P: charge (waits 3 s)
    F->>O: POST /orders/2/pay
    O->>P: charge (waits 3 s)
    Note over O: 20 req/s x 3 s = 60 calls in flight > 50 threads
    F->>O: GET /orders/7 (unrelated!)
    Note over O: no free thread: queued, then times out
    O-->>F: 503 / timeout for EVERY endpoint
```

Little's Law says it all: threads busy = arrival rate × time each call holds a thread. With
20 payments/s and a dependency that takes 3 s, `order` needs 60 threads just to wait. When the pool
(50 here, 200 by default) runs out, **every** endpoint of `order` stops — including `GET /orders/{id}`,
which never touches `payment`. One slow dependency took the whole service down: a **cascading
failure**.

!!! info "Why `order` gets only 50 threads in this lab"

    Tomcat's default pool is 200 threads. A laptop running fourteen containers cannot generate enough
    load to exhaust 200 threads against a 3-second dependency without k6 itself becoming the
    bottleneck, so the lab shrinks the pool (`server.tomcat.threads.max: 50`) — the same trick lab 1
    used when it limited `catalog` to one CPU. The mechanism is identical at any size.

## Code

Add Resilience4j to `order` (its Spring Boot 4 module, `resilience4j-spring-boot4`); the annotations
need AspectJ (`spring-boot-starter-aspectj`). The complete `pom.xml`:

``` xml title="services/order/pom.xml"
--8<-- "docs/2027.1/hands-on/9/code/services/order/pom.xml"
```

The new package `boxoffice.order.payment` holds the client and the protected gateway:

=== "PaymentRequest.java / PaymentResponse.java"

    ``` java title="services/order/src/main/java/boxoffice/order/payment/PaymentRequest.java"
    --8<-- "docs/2027.1/hands-on/9/code/services/order/src/main/java/boxoffice/order/payment/PaymentRequest.java"
    ```

    ``` java title="services/order/src/main/java/boxoffice/order/payment/PaymentResponse.java"
    --8<-- "docs/2027.1/hands-on/9/code/services/order/src/main/java/boxoffice/order/payment/PaymentResponse.java"
    ```

=== "PaymentClient.java"

    ``` java title="services/order/src/main/java/boxoffice/order/payment/PaymentClient.java"
    --8<-- "docs/2027.1/hands-on/9/code/services/order/src/main/java/boxoffice/order/payment/PaymentClient.java"
    ```

=== "PaymentGateway.java"

    ``` java title="services/order/src/main/java/boxoffice/order/payment/PaymentGateway.java"
    --8<-- "docs/2027.1/hands-on/9/code/services/order/src/main/java/boxoffice/order/payment/PaymentGateway.java"
    ```

=== "PaymentUnavailableException.java"

    ``` java title="services/order/src/main/java/boxoffice/order/payment/PaymentUnavailableException.java"
    --8<-- "docs/2027.1/hands-on/9/code/services/order/src/main/java/boxoffice/order/payment/PaymentUnavailableException.java"
    ```

`OrderService` gains `pay`. Note **where the transaction is**: the remote call happens with no
transaction open, and only the short status update runs in one — holding a database connection while
waiting 3 s for a dependency would move the cascade into the connection pool.

=== "OrderService.java"

    ``` java title="services/order/src/main/java/boxoffice/order/OrderService.java"
    --8<-- "docs/2027.1/hands-on/9/code/services/order/src/main/java/boxoffice/order/OrderService.java"
    ```

=== "OrderController.java"

    ``` java title="services/order/src/main/java/boxoffice/order/OrderController.java"
    --8<-- "docs/2027.1/hands-on/9/code/services/order/src/main/java/boxoffice/order/OrderController.java"
    ```

Rebuild `order` and pay an order end to end (from the repository root):

``` shell
docker compose up -d --build order
ID=$(curl -s -X POST localhost:8084/orders -H 'Content-Type: application/json' \
  -d '{"showId":"show-9","holdId":"hold-pay-1","customerEmail":"bia@example.com","amount":350.00}' | jq -r .id)
curl -s -X POST localhost:8084/orders/$ID/pay
```

You should see the order with `"status":"CONFIRMED"`. The **first** payment after a restart can
answer `503` instead: the cold JVMs of `order`, `payment` and WireMock may need more than the 1 s
read timeout for the very first call — the fallback at work. Call `pay` again: `payment` already
stored the charge under the same idempotency key, so the second call answers at once with
`CONFIRMED` (no second charge).

The `UPDATE … WHERE status = 'PENDING_PAYMENT'` makes the confirmation idempotent too: two
concurrent `pay` calls for the same order may both reach `payment` (which deduplicates by key), but
only one changes the status and writes the `OrderConfirmed` event.

## Configuration

All the knobs live in `application.yaml` (the complete file; the lab 9 parts are `server.tomcat`,
`boxoffice.payment`, `resilience4j` and the new actuator endpoints); the environment variables let you
switch them off one by one in the experiments without rebuilding.

``` yaml title="services/order/src/main/resources/application.yaml"
--8<-- "docs/2027.1/hands-on/9/code/services/order/src/main/resources/application.yaml"
```

## Pattern by pattern

Each experiment uses the k6 script of [step 4](../measure/index.md) (`load/pay-under-chaos.js`):
20 payments per second plus 20 `GET /orders/{id}` per second, for 2 minutes. Rebuild `order` once
(`docker compose up -d --build order`), then change only environment variables.

### 0. Unprotected

``` shell
PAYMENT_RESILIENCE=false PAYMENT_READ_TIMEOUT=0 docker compose up -d order
curl -s -X POST localhost:8474/proxies/payment/toxics \
  -d '{"name":"slow","type":"latency","stream":"downstream","attributes":{"latency":3000}}'
k6 run load/pay-under-chaos.js
```

Watch the `browse` scenario: `GET /orders/{id}` — which does not call `payment` — degrades with
`pay`. That is the cascade.

### 1. Timeout

``` shell
PAYMENT_RESILIENCE=false PAYMENT_READ_TIMEOUT=1s docker compose up -d order
k6 run load/pay-under-chaos.js
```

Every payment now fails after 1 s instead of hanging for 3 s: a thread is held 1 s, not 3 s, so
20/s × 1 s = 20 threads — inside the pool. `GET /orders/{id}` recovers. **A timeout converts a slow
failure into a fast failure**, and fast failures do not cascade.

!!! warning "Timeouts must be shorter than the caller's"

    The edge or the gateway in front of `order` has its own timeout. If `order` waits longer for
    `payment` than the gateway waits for `order`, the gateway gives up first and `order` keeps working
    for nobody. Budgets shrink at each hop: edge 10 s > gateway 5 s > order→payment 1 s × retries.

### 2. Retry with backoff and jitter

Replace the latency with a flaky network — 30% of the connections reset:

``` shell
curl -s -X DELETE localhost:8474/proxies/payment/toxics/slow
curl -s -X POST localhost:8474/proxies/payment/toxics \
  -d '{"name":"flaky","type":"reset_peer","toxicity":0.3,"attributes":{"timeout":0}}'
PAYMENT_RETRY_ATTEMPTS=1 docker compose up -d order    # resilience on, retry off
k6 run load/pay-under-chaos.js
PAYMENT_RETRY_ATTEMPTS=3 docker compose up -d order
k6 run load/pay-under-chaos.js
```

With one attempt, a share of the payments fail (not exactly 30%: the toxicity applies per TCP
connection, and healthy connections are reused). With three attempts, a payment fails only if all
three fail: if one attempt fails with probability *p*, three fail with *p*³ — 30% becomes 2.7%. Retries fix **transient** errors — at the price of extra load on the
dependency (up to 3×) and extra latency (the backoff). They are safe only because the request carries
an idempotency key.

??? question "Why jitter?"

    Without it, every client that failed at the same instant retries at the same instant (200 ms
    later, then 400 ms later): synchronized waves that hit a recovering dependency like a hammer. A
    random ±50% spreads the retries over time. Try the `retry-storm` scenario in the playground to see
    the amplification.

### 3. Circuit breaker

Now a full outage: disable the proxy, so every connection to `payment` is refused.

``` shell
curl -s -X DELETE localhost:8474/proxies/payment/toxics/flaky
curl -s -X POST localhost:8474/proxies/payment -d '{"enabled": false}'
k6 run load/pay-under-chaos.js                                                          # terminal 1
watch -n 1 "curl -s localhost:8084/actuator/circuitbreakers | jq '.circuitBreakers.payment.state'"   # terminal 2
```

After 10 failed calls (the `minimum-number-of-calls`) the breaker **opens**: for the next 10 s,
`charge` fails immediately with `CallNotPermittedException` — no network call, no retry, no
waiting — and the fallback answers `503`. Then it goes **half-open**, lets 3 trial calls through and
closes again if they succeed. Re-enable the proxy in the middle of the run
(`curl -s -X POST localhost:8474/proxies/payment -d '{"enabled": true}'`) and watch it close.
`/actuator/circuitbreakerevents` lists every transition.

The breaker protects **both sides**: `order` stops wasting threads and time on calls that will fail,
and `payment` gets breathing room to recover instead of a flood of retries.

### 4. Bulkhead

Back to latency, but this time calls that **succeed** slowly — 700 ms: under the read timeout
(1 s) and under the circuit breaker's slow-call threshold (800 ms), so neither of them reacts — and
more of them: 70 payments per second.

``` shell
curl -s -X POST localhost:8474/proxies/payment -d '{"enabled": true}'
curl -s -X POST localhost:8474/proxies/payment/toxics \
  -d '{"name":"slow","type":"latency","stream":"downstream","attributes":{"latency":700}}'
PAYMENT_BULKHEAD=1000 docker compose up -d order   # effectively no bulkhead
k6 run -e PAY_RATE=70 load/pay-under-chaos.js
PAYMENT_BULKHEAD=10 docker compose up -d order
k6 run -e PAY_RATE=70 load/pay-under-chaos.js
curl -s -X POST localhost:8474/reset                # remove every toxic
```

Without a bulkhead, 70/s × 0.7 s ≈ 49 threads wait on `payment`: the pool of 50 is practically full
and `GET /orders/{id}` queues behind the payments. With `max-concurrent-calls: 10`, at most 10 threads
wait on `payment`; the extra concurrent payments are rejected at once (`503`), and the other 40
threads keep serving `GET /orders/{id}` at normal latency. A bulkhead is a **budget of concurrency per
dependency** — named after the watertight compartments of a ship.

| Pattern | Protects against | Cost |
|---|---|---|
| Timeout | waiting forever on a slow dependency | some slow-but-successful calls become errors |
| Retry + backoff + jitter | transient errors | more load on the dependency, more latency; needs idempotency |
| Circuit breaker | hammering a dependency that is down | rejects calls for `wait-duration` even if it recovered sooner |
| Bulkhead | one dependency consuming all threads | rejects calls above the limit even if threads are free elsewhere |
| Fallback | showing a raw error | must be honest: "try again", not a fake success |

!!! tip "In the interview"

    "Every remote call gets a timeout shorter than its caller's, retries only on transient errors with
    exponential backoff and jitter, on idempotent operations, behind a circuit breaker; each
    dependency gets its own bulkhead so one slow dependency cannot exhaust the service."

[Next: Game day](../game-day/index.md){ .md-button .md-button--primary }
