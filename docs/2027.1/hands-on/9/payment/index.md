# 1. Payment, Provider and Toxiproxy

BoxOffice does not move money itself: the `payment` service is an **adapter** to an external payment
service provider (PSP). That makes it the most dangerous dependency of the checkout — slow on a busy
day, outside your control, and the place where a retry can charge a fan twice. This step builds the
three pieces the rest of the lab breaks on purpose:

| Container | Image / build | Port | Role |
|---|---|---|---|
| `psp` | `wiremock/wiremock:3.13.2` | 8080 (internal) | a fake external provider: `POST /v1/charges` answers `approved` |
| `payment` | `services/payment` (Spring Boot) | 8085 | adapter: idempotent `POST /payments`, calls the PSP with timeouts |
| `toxiproxy` | `ghcr.io/shopify/toxiproxy:2.13.0` | 8474 (API) | TCP proxy in front of `payment` and `psp`; injects latency, resets, outages |

``` diagram-sim
flowchart LR
    order[order] -->|"PAYMENT_URL = toxiproxy:18085"| tp1["toxiproxy proxy: payment"]
    tp1 --> payment[payment :8085]
    payment -->|"PSP_URL = toxiproxy:18095"| tp2["toxiproxy proxy: psp"]
    tp2 --> psp["psp (WireMock)"]
    payment --> db[(db: schema payment)]
    you[you / game day] -->|"curl :8474 add toxic"| tp1
```

Every call crosses a Toxiproxy **proxy**, so you can make any hop slow or broken without touching
code: Toxiproxy works at the TCP level, below HTTP, exactly where real networks fail.

## The fake provider

WireMock answers HTTP from JSON **stub** files. One stub is enough: approve every charge and invent
a provider reference.

``` json title="infra/psp/mappings/charge.json"
--8<-- "docs/2027.1/hands-on/9/code/infra/psp/mappings/charge.json"
```

## The `payment` service

A Spring Boot service in `services/payment/`, port **8085**, serving under `/payments`, schema
`payment`. Its build files follow the same pattern as `notification` in
[lab 7](../../7/consumer/index.md), without Kafka and mail.

```
services/payment/
├── Dockerfile
├── .dockerignore
├── pom.xml
└── src/main/
    ├── java/boxoffice/payment/
    │   ├── PaymentApplication.java
    │   ├── PaymentController.java
    │   ├── PaymentService.java
    │   ├── PspClient.java
    │   ├── ChargeRequest.java
    │   └── PaymentOut.java
    └── resources/
        ├── application.yaml
        └── db/migration/V1__create_payments.sql
```

=== "pom.xml"

    ``` xml title="services/payment/pom.xml"
    --8<-- "docs/2027.1/hands-on/9/code/services/payment/pom.xml"
    ```

=== "Dockerfile"

    ``` dockerfile title="services/payment/Dockerfile"
    --8<-- "docs/2027.1/hands-on/9/code/services/payment/Dockerfile"
    ```

=== ".dockerignore"

    ``` { .text title="services/payment/.dockerignore" .copy }
    --8<-- "docs/2027.1/hands-on/9/code/services/payment/.dockerignore"
    ```

=== "application.yaml"

    ``` yaml title="services/payment/src/main/resources/application.yaml"
    --8<-- "docs/2027.1/hands-on/9/code/services/payment/src/main/resources/application.yaml"
    ```

=== "V1__create_payments.sql"

    ``` sql title="services/payment/src/main/resources/db/migration/V1__create_payments.sql"
    --8<-- "docs/2027.1/hands-on/9/code/services/payment/src/main/resources/db/migration/V1__create_payments.sql"
    ```

=== "ChargeRequest.java"

    ``` java title="services/payment/src/main/java/boxoffice/payment/ChargeRequest.java"
    --8<-- "docs/2027.1/hands-on/9/code/services/payment/src/main/java/boxoffice/payment/ChargeRequest.java"
    ```

=== "PaymentOut.java"

    ``` java title="services/payment/src/main/java/boxoffice/payment/PaymentOut.java"
    --8<-- "docs/2027.1/hands-on/9/code/services/payment/src/main/java/boxoffice/payment/PaymentOut.java"
    ```

=== "PaymentApplication.java"

    ``` java title="services/payment/src/main/java/boxoffice/payment/PaymentApplication.java"
    --8<-- "docs/2027.1/hands-on/9/code/services/payment/src/main/java/boxoffice/payment/PaymentApplication.java"
    ```

The provider client sets **both timeouts** explicitly. Without them, a Java HTTP client waits forever
for a response — the root cause of most cascading failures.

=== "PspClient.java"

    ``` java title="services/payment/src/main/java/boxoffice/payment/PspClient.java"
    --8<-- "docs/2027.1/hands-on/9/code/services/payment/src/main/java/boxoffice/payment/PspClient.java"
    ```

=== "PaymentService.java"

    ``` java title="services/payment/src/main/java/boxoffice/payment/PaymentService.java"
    --8<-- "docs/2027.1/hands-on/9/code/services/payment/src/main/java/boxoffice/payment/PaymentService.java"
    ```

=== "PaymentController.java"

    ``` java title="services/payment/src/main/java/boxoffice/payment/PaymentController.java"
    --8<-- "docs/2027.1/hands-on/9/code/services/payment/src/main/java/boxoffice/payment/PaymentController.java"
    ```

!!! info "Idempotency end to end"

    The **same key** travels `order → payment → PSP`: `order` sends `Idempotency-Key: order-<id>`,
    `payment` stores it with a `UNIQUE` constraint and forwards it to the provider. A retry at any
    layer — Resilience4j in `order`, a timeout in the gateway, a fan double-clicking — finds the key
    and gets the first result back. Retries are only safe on top of idempotency; this is the
    [payment-system](../../../classes/case-studies/payment-system/index.md) case study in miniature.

## Toxiproxy

Toxiproxy reads its proxies from a JSON file at startup:

``` json title="infra/toxiproxy/toxiproxy.json"
--8<-- "docs/2027.1/hands-on/9/code/infra/toxiproxy/toxiproxy.json"
```

## Compose

``` yaml title="docker-compose.yaml (excerpt)"
  psp:
    image: wiremock/wiremock:3.13.2
    volumes:
      - ./infra/psp:/home/wiremock:ro

  toxiproxy:
    image: ghcr.io/shopify/toxiproxy:2.13.0
    command: ["-host=0.0.0.0", "-config=/config/toxiproxy.json"]
    volumes:
      - ./infra/toxiproxy/toxiproxy.json:/config/toxiproxy.json:ro
    ports:
      - "8474:8474"

  payment:
    build: ./services/payment
    volumes:
      - ./infra/otel:/otel:ro
    environment:
      <<: *otel
      OTEL_SERVICE_NAME: payment
      DB_HOST: db
      DB_PORT: 5432
      DB_NAME: ${DB_NAME:-boxoffice}
      DB_USER: ${DB_USER:-boxoffice}
      DB_PASSWORD: ${DB_PASSWORD:-boxoffice}
      PSP_URL: http://toxiproxy:18095                 # the provider, through Toxiproxy
    ports:
      - "8085:8085"
    depends_on:
      db:
        condition: service_healthy
      toxiproxy:
        condition: service_started
      psp:
        condition: service_started
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 768M
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:8085/actuator/health/readiness || exit 1"]
      interval: 10s
      timeout: 3s
      start_period: 120s
      retries: 3
```

and the `order` service now reaches `payment` through the proxy (not directly), with the knobs of
[step 2](../patterns/index.md) as variables:

``` yaml title="docker-compose.yaml (excerpt of the order service)"
      PAYMENT_URL: http://toxiproxy:18085            # lab 9: through Toxiproxy, not payment:8085
      PAYMENT_RESILIENCE: ${PAYMENT_RESILIENCE:-true}
      PAYMENT_READ_TIMEOUT: ${PAYMENT_READ_TIMEOUT:-1s}
      PAYMENT_RETRY_ATTEMPTS: ${PAYMENT_RETRY_ATTEMPTS:-3}
      PAYMENT_BULKHEAD: ${PAYMENT_BULKHEAD:-10}
```

Get the complete file (lab 8's plus these services and variables), from the repository root:

``` shell
curl -fsSL -o docker-compose.yaml https://insper.github.io/platform/2027.1/hands-on/9/code/docker-compose.yaml
```

??? example "docker-compose.yaml — the complete file at the end of this lab"

    ``` yaml title="docker-compose.yaml"
    --8<-- "docs/2027.1/hands-on/9/code/docker-compose.yaml"
    ```

Start the three new containers; `--wait` returns when `payment` is healthy (the first build takes a
few minutes, the start about 30 s). Then list the proxies and charge once:

<!-- termynal -->

``` shell
> docker compose up -d --build --wait psp toxiproxy payment
> curl -s localhost:8474/proxies | jq 'keys'
[
  "payment",
  "psp"
]
> curl -s -w '\n%{http_code}\n' -X POST localhost:8085/payments -H 'Content-Type: application/json' \
    -H 'Idempotency-Key: test-1' -d '{"orderId":"5b0c2f9e-7d0a-4f43-9a55-1c1c2c8f8e10","amount":350.00}'
{"id":"a8744598-4ef4-4d4d-85f2-105e5661233c","orderId":"5b0c2f9e-7d0a-4f43-9a55-1c1c2c8f8e10","amount":350.00,"status":"AUTHORIZED","providerRef":"ch_2zm5esh2yuqd","createdAt":"2026-10-18T18:44:51.939198Z"}
201
```

You should see `201` and a body like
`{"id":"a8744598-…","orderId":"5b0c2f9e-…","amount":350.00,"status":"AUTHORIZED","providerRef":"ch_2zm5esh2yuqd",…}`.
Send the same `curl` again: `200` instead of `201`, the same `id` and the same `providerRef`.

## Your first toxic

Add 3 seconds of latency to every response of the `psp` proxy, time a payment, remove the toxic:

``` shell
curl -s -X POST localhost:8474/proxies/psp/toxics \
  -d '{"name":"slow","type":"latency","stream":"downstream","attributes":{"latency":3000}}'
time curl -s -X POST localhost:8085/payments -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: test-2' -d '{"orderId":"5b0c2f9e-7d0a-4f43-9a55-1c1c2c8f8e10","amount":350.00}'
curl -s -X DELETE localhost:8474/proxies/psp/toxics/slow
```

You should see `{"…","status":500,"error":"Internal Server Error","path":"/payments"}` after
`real 0m2.2s`: the **read timeout** of `PspClient` (2 s) fired before the 3 s response arrived. Without it, the thread would have waited the full 3 s — or forever.

| Toxic | Attributes | Simulates |
|---|---|---|
| `latency` | `latency`, `jitter` (ms) | a slow dependency, a congested network |
| `timeout` | `timeout` (ms; `0` = never close) | a black hole: packets go in, nothing comes back |
| `reset_peer` | `timeout` (ms) | connection reset by peer (a crash, a load balancer killing connections) |
| `bandwidth` | `rate` (KB/s) | a thin pipe |
| `limit_data` | `bytes` | a connection cut in the middle of a response |
| *(proxy disabled)* | `POST /proxies/<name>` with `{"enabled": false}` | the dependency is down: connection refused |

Each toxic also takes a `toxicity` between 0 and 1: the probability that it applies to a new
connection — perfect for "30% of the calls fail".

[Next: Resilience patterns](../patterns/index.md){ .md-button .md-button--primary }
