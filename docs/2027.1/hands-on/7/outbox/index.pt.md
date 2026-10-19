# 2. Transactional Outbox

O serviço `order` precisa fazer duas coisas quando um fã faz um pedido: **guardar o pedido** no
PostgreSQL e **anunciá-lo** no Kafka. Dois sistemas diferentes, nenhuma transação compartilhada. Este
passo mostra por que o código óbvio está errado e constrói a correção padrão, o **transactional
outbox**.

## O problema da escrita dupla

``` mermaid-sim
sequenceDiagram
    participant F as Fã
    participant O as order
    participant DB as PostgreSQL
    participant K as Kafka
    F->>O: POST /orders
    O->>DB: INSERT do pedido + COMMIT
    DB-->>O: ok
    Note over O: queda, deploy ou timeout do Kafka aqui
    O--xK: publica OrderPlaced (nunca acontece)
    O-->>F: 500 (mas o pedido existe!)
```

Qualquer ordem das duas escritas tem uma janela de falha:

| Ordem das escritas | Queda entre as escritas | Resultado |
|---|---|---|
| Banco, depois Kafka | pedido gravado, evento perdido | nenhum e-mail, e nenhum outro serviço fica sabendo do pedido |
| Kafka, depois banco | evento publicado, INSERT falha | um pedido *fantasma*: e-mail de um pedido que não existe |
| Kafka dentro da transação do banco | a publicação no Kafka dá certo, o commit falha | o mesmo fantasma; o PostgreSQL não consegue desfazer o Kafka |

O **outbox** tira o segundo sistema da requisição: o serviço grava o evento como uma linha de uma
tabela `outbox` **na mesma transação local** do pedido. Ou as duas linhas existem, ou nenhuma. Um
**relay** separado lê as linhas não publicadas e as publica, marcando-as como publicadas só depois que
o Kafka confirma.

``` mermaid-sim
sequenceDiagram
    participant F as Fã
    participant O as order
    participant DB as PostgreSQL
    participant R as relay do outbox
    participant K as Kafka
    F->>O: POST /orders
    O->>DB: BEGIN; INSERT orders; INSERT outbox; COMMIT
    O-->>F: 201 Created
    loop a cada 200 ms
        R->>DB: SELECT ... WHERE published_at IS NULL FOR UPDATE SKIP LOCKED
        R->>K: envia (chave = orderId), espera acks=all
        K-->>R: ack
        R->>DB: UPDATE outbox SET published_at = now()
    end
```

Se o relay cair depois do *ack* do Kafka mas antes do `UPDATE`, a linha é publicada de novo na
próxima execução: o outbox dá publicação ***at-least-once***. Tudo bem, porque o consumidor do
[passo 3](../consumer/index.md) é idempotente e cada evento carrega um `eventId` único.

!!! tip "Relay por polling ou CDC?"

    O relay aqui faz ***polling*** da tabela — simples, sem infraestrutura extra, algumas centenas de
    milissegundos de atraso. A alternativa é a **captura de mudanças** (*change data capture*, CDC):
    uma ferramenta como o Debezium lê o *write-ahead log* do PostgreSQL e publica cada inserção no
    outbox, com menos atraso e sem a carga do polling, ao custo de rodar e operar o Kafka Connect. Veja
    a [página de padrões](../../../classes/messaging/patterns/index.md) da aula de mensageria.

## O serviço `order`

Um novo serviço Spring Boot em `services/order/`, na porta **8084**, servindo tudo sob `/orders`. Ele
usa JDBC puro (`JdbcClient`) em vez de JPA para que cada comando da transação fique visível.

```
services/order/
├── .dockerignore
├── Dockerfile
├── pom.xml
└── src/main/
    ├── java/boxoffice/order/
    │   ├── OrderApplication.java
    │   ├── OrderProperties.java
    │   ├── OrderController.java
    │   ├── OrderService.java
    │   ├── OrderRequest.java
    │   ├── OrderView.java
    │   ├── OrderEvent.java
    │   ├── NotificationClient.java
    │   └── outbox/
    │       ├── Outbox.java
    │       └── OutboxRelay.java
    └── resources/
        ├── application.yaml
        └── db/migration/V1__create_orders.sql
```

### Arquivos de build

=== "pom.xml"

    ``` xml title="services/order/pom.xml"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/pom.xml"
    ```

=== "Dockerfile"

    ``` dockerfile title="services/order/Dockerfile"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/Dockerfile"
    ```

=== ".dockerignore"

    ``` text title="services/order/.dockerignore"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/.dockerignore"
    ```

=== "application.yaml"

    ``` yaml title="services/order/src/main/resources/application.yaml"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/resources/application.yaml"
    ```

O produtor usa o `StringSerializer` padrão do Spring Boot para chave e valor: o outbox já guarda o
evento como texto JSON, então o relay o publica byte a byte. `acks: all` mais
`enable.idempotence: true` fazem o broker deduplicar as próprias retentativas do produtor e manter a
ordem delas dentro de uma partição.

### Esquema

``` sql title="services/order/src/main/resources/db/migration/V1__create_orders.sql"
--8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/resources/db/migration/V1__create_orders.sql"
```

`hold_id` é `UNIQUE`: uma reserva de assentos (do [lab 6](../../6/index.md)) vira no máximo um pedido.
Essa restrição é o que torna o `POST /orders` **idempotente** — um fã que clica duas vezes, ou um
gateway que tenta de novo depois de um timeout, recebe o mesmo pedido de volta em vez de um segundo.

### Records de domínio

=== "OrderRequest.java"

    ``` java title="services/order/src/main/java/boxoffice/order/OrderRequest.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/OrderRequest.java"
    ```

=== "OrderView.java"

    ``` java title="services/order/src/main/java/boxoffice/order/OrderView.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/OrderView.java"
    ```

=== "OrderEvent.java"

    ``` java title="services/order/src/main/java/boxoffice/order/OrderEvent.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/OrderEvent.java"
    ```

=== "OrderProperties.java"

    ``` java title="services/order/src/main/java/boxoffice/order/OrderProperties.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/OrderProperties.java"
    ```

=== "OrderApplication.java"

    ``` java title="services/order/src/main/java/boxoffice/order/OrderApplication.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/OrderApplication.java"
    ```

### A transação: pedido + outbox

A chave `NOTIFY_MODE` mantém a versão **"antes"** no código para que você possa medir as duas no
[passo 5](../measure/index.md): `sync` chama `notification` por HTTP dentro da requisição, `outbox`
grava a linha do evento.

=== "OrderService.java"

    ``` java title="services/order/src/main/java/boxoffice/order/OrderService.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/OrderService.java"
    ```

=== "NotificationClient.java"

    ``` java title="services/order/src/main/java/boxoffice/order/NotificationClient.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/NotificationClient.java"
    ```

=== "OrderController.java"

    ``` java title="services/order/src/main/java/boxoffice/order/OrderController.java (step 2 version, replaced in step 4)"
    package boxoffice.order;

    import jakarta.validation.Valid;
    import java.net.URI;
    import java.util.UUID;
    import org.springframework.http.HttpStatus;
    import org.springframework.http.ResponseEntity;
    import org.springframework.web.bind.annotation.GetMapping;
    import org.springframework.web.bind.annotation.PathVariable;
    import org.springframework.web.bind.annotation.PostMapping;
    import org.springframework.web.bind.annotation.RequestBody;
    import org.springframework.web.bind.annotation.RequestMapping;
    import org.springframework.web.bind.annotation.RestController;
    import org.springframework.web.server.ResponseStatusException;

    @RestController
    @RequestMapping("/orders")
    public class OrderController {

        private final OrderService orders;

        public OrderController(OrderService orders) {
            this.orders = orders;
        }

        @PostMapping
        public ResponseEntity<OrderView> place(@Valid @RequestBody OrderRequest req) {
            OrderService.PlaceResult result = orders.place(req);
            if (!result.created()) {
                return ResponseEntity.ok(result.order());
            }
            return ResponseEntity.created(URI.create("/orders/" + result.order().id())).body(result.order());
        }

        @GetMapping("/{id}")
        public OrderView get(@PathVariable UUID id) {
            return orders.find(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        }
    }
    ```

`ON CONFLICT (hold_id) DO NOTHING` devolve 0 linhas quando a reserva já virou pedido; o serviço então
devolve o pedido existente com `200 OK` e **não grava evento**. Sob concorrência, o PostgreSQL faz o
segundo INSERT esperar a primeira transação e então pular — sem corrida, sem duplicata.

### O outbox e seu relay

=== "Outbox.java"

    ``` java title="services/order/src/main/java/boxoffice/order/outbox/Outbox.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/outbox/Outbox.java"
    ```

=== "OutboxRelay.java"

    ``` java title="services/order/src/main/java/boxoffice/order/outbox/OutboxRelay.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/outbox/OutboxRelay.java"
    ```

Leia o relay com calma; cada linha responde a uma pergunta sobre falhas:

| Linha | Falha que ela trata |
|---|---|
| `FOR UPDATE SKIP LOCKED` | duas réplicas de `order` fazendo relay ao mesmo tempo: cada uma trava linhas diferentes, nenhuma espera |
| `ORDER BY created_at` + chave = `orderId` | eventos do mesmo pedido chegam à mesma partição na ordem do commit |
| `allOf(...).get(10, SECONDS)` | Kafka fora ou lento: a transação é desfeita, as linhas continuam não publicadas, a próxima execução tenta de novo |
| `UPDATE ... published_at` depois dos acks | uma queda antes dele republica o lote (*at-least-once*) — nunca o perde |
| `purge()` | a tabela não cresce para sempre; linhas publicadas ficam um dia para depuração |

## Adicione `order` ao Compose e teste

``` yaml title="docker-compose.yaml (excerpt)"
  order:
    build: ./services/order
    environment:
      DB_HOST: db
      DB_PORT: 5432
      DB_NAME: ${DB_NAME:-boxoffice}
      DB_USER: ${DB_USER:-boxoffice}
      DB_PASSWORD: ${DB_PASSWORD:-boxoffice}
      REDIS_HOST: redis
      KAFKA_BOOTSTRAP_SERVERS: kafka:9092
      NOTIFICATION_URL: http://notification:8086
      NOTIFY_MODE: ${NOTIFY_MODE:-outbox}            # outbox (after) | sync (before)
      ADMIT_PER_SECOND: ${ADMIT_PER_SECOND:-20}      # waiting-room admission rate
    ports:
      - "8084:8084"
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
      kafka-init:
        condition: service_completed_successfully
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 768M
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:8084/actuator/health/readiness || exit 1"]
      interval: 10s
      timeout: 3s
      start_period: 40s
      retries: 3
```

<!-- termynal -->

``` shell
> docker compose up -d --build order
> curl -s -X POST localhost:8084/orders -H 'Content-Type: application/json' \
    -d '{"showId":"show-42","holdId":"hold-0001","customerEmail":"ana@example.com","amount":350.00}'
{"id":"28cb9305-e1ce-4b49-aba7-665bb1b244b5","showId":"show-42","holdId":"hold-0001","customerEmail":"ana@example.com","amount":350.00,"status":"PENDING_PAYMENT","createdAt":"2026-10-18T17:55:45.063089Z"}
> docker compose logs order | grep relayed
order-1  | 2026-10-18T17:55:48.594Z  INFO 1 --- [order] [   scheduling-1] boxoffice.order.outbox.OutboxRelay       : relayed 1 event(s) to order-events
```

Abra o Kafka UI (`http://localhost:8089`) → **Topics → order-events → Messages**: o evento está lá,
com chave = id do pedido e os *headers* `eventId` e `eventType`.

Agora prove as duas garantias:

1. **Requisição idempotente.** Envie o mesmo `curl` de novo: a resposta é `200` (não `201`) com o
   mesmo `id`, e nenhuma mensagem nova aparece no tópico.
2. **Nenhum evento perdido.** Pare o Kafka, faça um pedido, suba o Kafka de novo:

    ``` shell
    docker compose stop kafka
    curl -s -X POST localhost:8084/orders -H 'Content-Type: application/json' \
      -d '{"showId":"show-42","holdId":"hold-0002","customerEmail":"bia@example.com","amount":350.00}'
    docker compose exec db psql -U boxoffice -d boxoffice \
      -c "SELECT event_type, created_at, published_at FROM orders.outbox ORDER BY created_at DESC LIMIT 2;"
    docker compose start kafka
    ```

    Você deve ver `201` no pedido e, na primeira consulta, a nova linha com `published_at` vazio.
    Espere o `docker compose ps kafka` voltar a `healthy` (cerca de um minuto) e rode a consulta de
    novo: `published_at` agora está preenchido. Em uma execução de teste:

    ``` text
     event_type  |          created_at           |         published_at
    -------------+-------------------------------+-------------------------------
     OrderPlaced | 2026-10-18 18:02:40.865762+00 | 2026-10-18 18:03:51.614915+00
     OrderPlaced | 2026-10-18 17:57:39.391694+00 | 2026-10-18 17:57:39.691802+00
    ```

    O pedido foi aceito com o Kafka fora e publicado 71 s depois, quando o Kafka voltou; o fã nunca
    viu a queda. Enquanto isso, `docker compose logs order` mostra `ERROR … Unexpected error occurred
    in scheduled task` a cada poucos segundos: cada execução do relay falha depois de `max.block.ms`
    (5 s) e a próxima tenta de novo — esperado.

!!! warning "Armadilhas"

    - **Publicar dentro da requisição HTTP "depois do commit"** (por exemplo, com
      `@TransactionalEventListener`) ainda perde o evento se o processo morrer entre o commit e o envio.
      Só uma linha durável no outbox sobrevive a uma queda.
    - **Ordem entre réplicas.** Com vários relays, dois eventos do *mesmo* pedido poderiam ser
      publicados por réplicas diferentes fora de ordem. Aqui cada pedido tem um evento por vez; se você
      emitir vários por pedido, faça o relay por agregado (por exemplo,
      `ORDER BY aggregate_id, created_at`) ou use CDC.
    - **O outbox não é uma fila para o mundo.** Ele é privado de `order`; os outros serviços leem o
      tópico do Kafka, nunca a tabela.

[Próximo: Consumidor idempotente e DLT](../consumer/index.md){ .md-button .md-button--primary }
