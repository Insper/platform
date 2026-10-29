# 2. Padrões de Resiliência { #2-resilience-patterns }

O `order` agora chama o `payment` de forma síncrona: `POST /orders/{id}/pay` cobra o fã e, se der
certo, confirma o pedido. Este passo primeiro mostra o que uma dependência lenta faz com um serviço
sem proteção, depois adiciona os quatro padrões da
[aula de confiabilidade](../../../classes/reliability/patterns/index.md), um de cada vez — **timeout,
retry, circuit breaker, bulkhead** —, medindo depois de cada um.

## A falha contra a qual nos defendemos { #the-failure-we-are-defending-against }

``` diagram-sim
sequenceDiagram
    participant F as fãs (20/s)
    participant O as order (50 threads)
    participant P as payment (+3 s de latência)
    F->>O: POST /orders/1/pay
    O->>P: cobrança (espera 3 s)
    F->>O: POST /orders/2/pay
    O->>P: cobrança (espera 3 s)
    Note over O: 20 req/s x 3 s = 60 chamadas em andamento > 50 threads
    F->>O: GET /orders/7 (não tem relação!)
    Note over O: nenhuma thread livre: vai para a fila, depois estoura o timeout
    O-->>F: 503 / timeout em TODO endpoint
```

A Lei de Little diz tudo: threads ocupadas = taxa de chegada × tempo em que cada chamada segura uma
thread. Com 20 pagamentos/s e uma dependência que leva 3 s, o `order` precisa de 60 threads só para
esperar. Quando o pool (50 aqui, 200 por padrão) acaba, **todo** endpoint do `order` para — inclusive o
`GET /orders/{id}`, que nunca toca o `payment`. Uma dependência lenta derrubou o serviço inteiro: uma
**falha em cascata**.

!!! info "Por que o `order` tem só 50 threads neste lab"

    O pool padrão do Tomcat tem 200 threads. Um laptop rodando catorze contêineres não consegue gerar
    carga suficiente para esgotar 200 threads contra uma dependência de 3 segundos sem que o próprio k6
    vire o gargalo, então o lab encolhe o pool (`server.tomcat.threads.max: 50`) — o mesmo truque do
    lab 1, quando limitou o `catalog` a uma CPU. O mecanismo é idêntico em qualquer tamanho.

## Código { #code }

Adicione o Resilience4j ao `order` (o seu módulo para Spring Boot 4, `resilience4j-spring-boot4`); as
anotações precisam do AspectJ (`spring-boot-starter-aspectj`). O `pom.xml` completo:

``` xml title="services/order/pom.xml"
--8<-- "docs/2027.1/hands-on/9/code/services/order/pom.xml"
```

O novo pacote `boxoffice.order.payment` contém o cliente e o gateway protegido:

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

O `OrderService` ganha o `pay`. Repare **onde está a transação**: a chamada remota acontece sem
transação aberta, e só a curta atualização de status roda dentro de uma — segurar uma conexão do banco
enquanto se espera 3 s por uma dependência levaria a cascata para o pool de conexões.

=== "OrderService.java"

    ``` java title="services/order/src/main/java/boxoffice/order/OrderService.java"
    --8<-- "docs/2027.1/hands-on/9/code/services/order/src/main/java/boxoffice/order/OrderService.java"
    ```

=== "OrderController.java"

    ``` java title="services/order/src/main/java/boxoffice/order/OrderController.java"
    --8<-- "docs/2027.1/hands-on/9/code/services/order/src/main/java/boxoffice/order/OrderController.java"
    ```

Reconstrua o `order` e pague um pedido de ponta a ponta (na raiz do repositório):

``` shell
docker compose up -d --build order
ID=$(curl -s -X POST localhost:8084/orders -H 'Content-Type: application/json' \
  -d '{"showId":"show-9","holdId":"hold-pay-1","customerEmail":"bia@example.com","amount":350.00}' | jq -r .id)
curl -s -X POST localhost:8084/orders/$ID/pay
```

Você deve ver o pedido com `"status":"CONFIRMED"`. O **primeiro** pagamento depois de um restart pode
responder `503`: as JVMs a frio do `order`, do `payment` e do WireMock podem precisar de mais que o
timeout de leitura de 1 s na primeiríssima chamada — é o fallback em ação. Chame o `pay` de novo: o
`payment` já guardou a cobrança sob a mesma chave de idempotência, então a segunda chamada responde na
hora com `CONFIRMED` (sem segunda cobrança).

O `UPDATE … WHERE status = 'PENDING_PAYMENT'` também torna a confirmação idempotente: duas chamadas
`pay` concorrentes para o mesmo pedido podem chegar ambas ao `payment` (que deduplica pela chave), mas
só uma muda o status e grava o evento `OrderConfirmed`.

## Configuração { #configuration }

Todos os ajustes ficam no `application.yaml` (o arquivo completo; as partes do lab 9 são
`server.tomcat`, `boxoffice.payment`, `resilience4j` e os novos endpoints do actuator); as variáveis de
ambiente permitem desligá-los um a um nos experimentos, sem reconstruir.

``` yaml title="services/order/src/main/resources/application.yaml"
--8<-- "docs/2027.1/hands-on/9/code/services/order/src/main/resources/application.yaml"
```

## Padrão por padrão { #pattern-by-pattern }

Cada experimento usa o script do k6 do [passo 4](../measure/index.md) (`load/pay-under-chaos.js`):
20 pagamentos por segundo mais 20 `GET /orders/{id}` por segundo, por 2 minutos. Reconstrua o `order`
uma vez (`docker compose up -d --build order`) e depois mude só variáveis de ambiente.

### 0. Sem proteção { #0-unprotected }

``` shell
PAYMENT_RESILIENCE=false PAYMENT_READ_TIMEOUT=0 docker compose up -d order
curl -s -X POST localhost:8474/proxies/payment/toxics \
  -d '{"name":"slow","type":"latency","stream":"downstream","attributes":{"latency":3000}}'
k6 run load/pay-under-chaos.js
```

Observe o cenário `browse`: o `GET /orders/{id}` — que não chama o `payment` — degrada junto com o
`pay`. Essa é a cascata.

### 1. Timeout

``` shell
PAYMENT_RESILIENCE=false PAYMENT_READ_TIMEOUT=1s docker compose up -d order
k6 run load/pay-under-chaos.js
```

Agora todo pagamento falha depois de 1 s em vez de travar por 3 s: uma thread fica presa 1 s, não 3 s,
então 20/s × 1 s = 20 threads — dentro do pool. O `GET /orders/{id}` se recupera. **Um timeout
converte uma falha lenta numa falha rápida**, e falhas rápidas não se propagam em cascata.

!!! warning "Os timeouts precisam ser menores que o de quem chama"

    A borda ou o gateway na frente do `order` tem o seu próprio timeout. Se o `order` espera o
    `payment` por mais tempo do que o gateway espera o `order`, o gateway desiste primeiro e o `order`
    continua trabalhando para ninguém. Os orçamentos encolhem a cada salto: borda 10 s > gateway 5 s >
    order→payment 1 s × retries.

### 2. Retry com backoff e jitter { #2-retry-with-backoff-and-jitter }

Troque a latência por uma rede instável — 30% das conexões são resetadas:

``` shell
curl -s -X DELETE localhost:8474/proxies/payment/toxics/slow
curl -s -X POST localhost:8474/proxies/payment/toxics \
  -d '{"name":"flaky","type":"reset_peer","toxicity":0.3,"attributes":{"timeout":0}}'
PAYMENT_RETRY_ATTEMPTS=1 docker compose up -d order    # resilience on, retry off
k6 run load/pay-under-chaos.js
PAYMENT_RETRY_ATTEMPTS=3 docker compose up -d order
k6 run load/pay-under-chaos.js
```

Com uma tentativa, uma parte dos pagamentos falha (não exatamente 30%: a toxicity se aplica por conexão
TCP, e as conexões saudáveis são reutilizadas). Com três tentativas, um pagamento só falha se as três
falharem: se uma tentativa falha com probabilidade *p*, três falham com *p*³ — 30% vira 2,7%. Retries
corrigem erros **transitórios** — ao preço de carga extra na dependência (até 3×) e latência extra (o
backoff). Eles só são seguros porque a requisição carrega uma chave de idempotência.

??? question "Por que jitter?"

    Sem ele, todo cliente que falhou no mesmo instante tenta de novo no mesmo instante (200 ms depois,
    depois 400 ms depois): ondas sincronizadas que atingem uma dependência em recuperação como um
    martelo. Um aleatório de ±50% espalha os retries no tempo. Experimente o cenário `retry-storm` no
    playground para ver a amplificação.

### 3. Circuit breaker

Agora uma queda total: desative o proxy, para que toda conexão ao `payment` seja recusada.

``` shell
curl -s -X DELETE localhost:8474/proxies/payment/toxics/flaky
curl -s -X POST localhost:8474/proxies/payment -d '{"enabled": false}'
k6 run load/pay-under-chaos.js                                                          # terminal 1
watch -n 1 "curl -s localhost:8084/actuator/circuitbreakers | jq '.circuitBreakers.payment.state'"   # terminal 2
```

Depois de 10 chamadas com falha (o `minimum-number-of-calls`) o breaker **abre**: pelos próximos 10 s,
o `charge` falha imediatamente com `CallNotPermittedException` — sem chamada de rede, sem retry, sem
espera — e o fallback responde `503`. Depois ele passa a **half-open**, deixa passar 3 chamadas de
teste e fecha de novo se elas derem certo. Reative o proxy no meio da execução
(`curl -s -X POST localhost:8474/proxies/payment -d '{"enabled": true}'`) e veja-o fechar. O
`/actuator/circuitbreakerevents` lista cada transição.

O breaker protege **os dois lados**: o `order` para de gastar threads e tempo em chamadas que vão
falhar, e o `payment` ganha fôlego para se recuperar em vez de uma enxurrada de retries.

### 4. Bulkhead

De volta à latência, mas desta vez com chamadas que **dão certo** devagar — 700 ms: abaixo do timeout
de leitura (1 s) e abaixo do limite de chamada lenta do circuit breaker (800 ms), então nenhum dos dois
reage — e em maior número: 70 pagamentos por segundo.

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

Sem bulkhead, 70/s × 0,7 s ≈ 49 threads esperam o `payment`: o pool de 50 fica praticamente cheio e o
`GET /orders/{id}` entra na fila atrás dos pagamentos. Com `max-concurrent-calls: 10`, no máximo 10
threads esperam o `payment`; os pagamentos concorrentes excedentes são rejeitados na hora (`503`), e as
outras 40 threads continuam servindo o `GET /orders/{id}` com latência normal. Um bulkhead é um
**orçamento de concorrência por dependência** — o nome vem dos compartimentos estanques de um navio.

| Padrão | Protege contra | Custo |
|---|---|---|
| Timeout | esperar para sempre por uma dependência lenta | algumas chamadas lentas, mas bem-sucedidas, viram erros |
| Retry + backoff + jitter | erros transitórios | mais carga na dependência, mais latência; exige idempotência |
| Circuit breaker | martelar uma dependência que está fora do ar | rejeita chamadas durante o `wait-duration` mesmo que ela tenha se recuperado antes |
| Bulkhead | uma dependência consumir todas as threads | rejeita chamadas acima do limite mesmo com threads livres em outro lugar |
| Fallback | mostrar um erro cru | precisa ser honesto: "tente de novo", não um falso sucesso |

!!! tip "Na entrevista"

    "Toda chamada remota tem um timeout menor que o de quem a chama, retries só em erros transitórios,
    com backoff exponencial e jitter, em operações idempotentes, atrás de um circuit breaker; cada
    dependência tem o seu próprio bulkhead, para que uma dependência lenta não esgote o serviço."

[Próximo: Game day](../game-day/index.md){ .md-button .md-button--primary }
