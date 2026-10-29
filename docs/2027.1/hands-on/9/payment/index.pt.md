# 1. Pagamento, Provedor e Toxiproxy { #1-payment-provider-and-toxiproxy }

O BoxOffice não movimenta dinheiro sozinho: o serviço `payment` é um **adaptador** para um provedor
externo de serviços de pagamento (PSP, *payment service provider*). Isso faz dele a dependência mais
perigosa do checkout — lento num dia movimentado, fora do seu controle, e o lugar onde um retry pode
cobrar um fã duas vezes. Este passo constrói as três peças que o resto do lab quebra de propósito:

| Contêiner | Imagem / build | Porta | Papel |
|---|---|---|---|
| `psp` | `wiremock/wiremock:3.13.2` | 8080 (interna) | um provedor externo falso: `POST /v1/charges` responde `approved` |
| `payment` | `services/payment` (Spring Boot) | 8085 | adaptador: `POST /payments` idempotente, chama o PSP com timeouts |
| `toxiproxy` | `ghcr.io/shopify/toxiproxy:2.13.0` | 8474 (API) | proxy TCP na frente do `payment` e do `psp`; injeta latência, resets, quedas |

``` diagram-sim
flowchart LR
    order[order] -->|"PAYMENT_URL = toxiproxy:18085"| tp1["toxiproxy proxy: payment"]
    tp1 --> payment[payment :8085]
    payment -->|"PSP_URL = toxiproxy:18095"| tp2["toxiproxy proxy: psp"]
    tp2 --> psp["psp (WireMock)"]
    payment --> db[(db: schema payment)]
    you[você / game day] -->|"curl :8474 adiciona toxic"| tp1
```

Toda chamada atravessa um **proxy** do Toxiproxy, então você consegue deixar qualquer salto lento ou
quebrado sem tocar no código: o Toxiproxy trabalha no nível TCP, abaixo do HTTP, exatamente onde as
redes reais falham.

## O provedor falso { #the-fake-provider }

O WireMock responde HTTP a partir de arquivos JSON de **stub**. Um stub basta: aprovar toda cobrança e
inventar uma referência do provedor.

``` json title="infra/psp/mappings/charge.json"
--8<-- "docs/2027.1/hands-on/9/code/infra/psp/mappings/charge.json"
```

## O serviço `payment` { #the-payment-service }

Um serviço Spring Boot em `services/payment/`, porta **8085**, servindo em `/payments`, schema
`payment`. Os arquivos de build seguem o mesmo padrão do `notification` do
[lab 7](../../7/consumer/index.md), sem Kafka nem e-mail.

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

O cliente do provedor define **os dois timeouts** explicitamente. Sem eles, um cliente HTTP Java
espera uma resposta para sempre — a causa raiz da maioria das falhas em cascata.

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

!!! info "Idempotência de ponta a ponta"

    A **mesma chave** viaja `order → payment → PSP`: o `order` envia `Idempotency-Key: order-<id>`, o
    `payment` a guarda com uma restrição `UNIQUE` e a repassa ao provedor. Um retry em qualquer camada —
    o Resilience4j no `order`, um timeout no gateway, um fã clicando duas vezes — encontra a chave e
    recebe de volta o primeiro resultado. Retries só são seguros sobre idempotência; este é o estudo de
    caso do [sistema de pagamentos](../../../classes/case-studies/payment-system/index.md) em miniatura.

## Toxiproxy

O Toxiproxy lê os seus proxies de um arquivo JSON na inicialização:

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
      start_period: 40s
      retries: 3
```

e o serviço `order` agora chega ao `payment` pelo proxy (não diretamente), com os ajustes do
[passo 2](../patterns/index.md) como variáveis:

``` yaml title="docker-compose.yaml (excerpt of the order service)"
      PAYMENT_URL: http://toxiproxy:18085            # lab 9: through Toxiproxy, not payment:8085
      PAYMENT_RESILIENCE: ${PAYMENT_RESILIENCE:-true}
      PAYMENT_READ_TIMEOUT: ${PAYMENT_READ_TIMEOUT:-1s}
      PAYMENT_RETRY_ATTEMPTS: ${PAYMENT_RETRY_ATTEMPTS:-3}
      PAYMENT_BULKHEAD: ${PAYMENT_BULKHEAD:-10}
```

Pegue o arquivo completo (o do lab 8 mais estes serviços e variáveis), na raiz do repositório:

``` shell
curl -fsSL -o docker-compose.yaml https://insper.github.io/platform/2027.1/hands-on/9/code/docker-compose.yaml
```

??? example "docker-compose.yaml — o arquivo completo ao fim deste lab"

    ``` yaml title="docker-compose.yaml"
    --8<-- "docs/2027.1/hands-on/9/code/docker-compose.yaml"
    ```

Suba os três contêineres novos e espere até o `docker compose ps payment` mostrar `(healthy)` (o
primeiro build leva alguns minutos, a inicialização cerca de 30 s); depois liste os proxies e faça uma
cobrança:

<!-- termynal -->

``` shell
> docker compose up -d --build psp toxiproxy payment
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

Você deve ver `201` e um corpo como
`{"id":"a8744598-…","orderId":"5b0c2f9e-…","amount":350.00,"status":"AUTHORIZED","providerRef":"ch_2zm5esh2yuqd",…}`.
Envie o mesmo `curl` de novo: `200` em vez de `201`, o mesmo `id` e o mesmo `providerRef`.

## O seu primeiro toxic { #your-first-toxic }

Adicione 3 segundos de latência a toda resposta do proxy `psp`, cronometre um pagamento e remova o
toxic:

``` shell
curl -s -X POST localhost:8474/proxies/psp/toxics \
  -d '{"name":"slow","type":"latency","stream":"downstream","attributes":{"latency":3000}}'
time curl -s -X POST localhost:8085/payments -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: test-2' -d '{"orderId":"5b0c2f9e-7d0a-4f43-9a55-1c1c2c8f8e10","amount":350.00}'
curl -s -X DELETE localhost:8474/proxies/psp/toxics/slow
```

Você deve ver `{"…","status":500,"error":"Internal Server Error","path":"/payments"}` depois de
`real 0m2.2s`: o **timeout de leitura** do `PspClient` (2 s) disparou antes de a resposta de 3 s
chegar. Sem ele, a thread teria esperado os 3 s inteiros — ou para sempre.

| Toxic | Atributos | Simula |
|---|---|---|
| `latency` | `latency`, `jitter` (ms) | uma dependência lenta, uma rede congestionada |
| `timeout` | `timeout` (ms; `0` = nunca fecha) | um buraco negro: os pacotes entram, nada volta |
| `reset_peer` | `timeout` (ms) | conexão resetada pelo outro lado (um crash, um load balancer matando conexões) |
| `bandwidth` | `rate` (KB/s) | um cano estreito |
| `limit_data` | `bytes` | uma conexão cortada no meio de uma resposta |
| *(proxy desativado)* | `POST /proxies/<name>` com `{"enabled": false}` | a dependência está fora do ar: conexão recusada |

Cada toxic também aceita uma `toxicity` entre 0 e 1: a probabilidade de que ele se aplique a uma nova
conexão — perfeito para "30% das chamadas falham".

[Próximo: Padrões de resiliência](../patterns/index.md){ .md-button .md-button--primary }
