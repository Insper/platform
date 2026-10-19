# 3. Consumidor Idempotente e DLT

O Kafka e o outbox entregam **pelo menos uma vez**: um relay que cai depois do *ack* republica um
lote; um consumidor que cai depois de enviar o e-mail, mas antes de confirmar o offset, recebe a
mensagem de novo; um operador que volta um grupo de consumidores reprocessa horas de eventos. O
serviço `notification` precisa, portanto, tornar uma duplicata **inofensiva** — e não pode deixar uma
mensagem ruim parar a partição inteira.

| Problema | Técnica | Onde no código |
|---|---|---|
| o mesmo evento chega duas vezes | **consumidor idempotente**: lembrar os `eventId` processados, na mesma transação do efeito | `NotificationService` |
| uma falha transitória (soluço do SMTP) | **retentativa com *backoff* exponencial**, no lugar | `KafkaConfig` |
| uma mensagem que nunca vai dar certo (malformada, endereço inválido) | **tópico de mensagens mortas** (DLT): estacioná-la e manter a partição andando | `KafkaConfig`, `DeadLetterListener` |

## O serviço `notification`

Um serviço Spring Boot em `services/notification/`, porta **8086**. Ele também mantém o endpoint
legado `POST /notifications` que `order` chama em `NOTIFY_MODE=sync`, para que as duas arquiteturas
possam ser medidas com o mesmo código.

```
services/notification/
├── .dockerignore
├── Dockerfile
├── pom.xml
└── src/main/
    ├── java/boxoffice/notification/
    │   ├── NotificationApplication.java
    │   ├── NotificationProperties.java
    │   ├── OrderEvent.java
    │   ├── EmailSender.java
    │   ├── NotificationService.java
    │   ├── NotificationController.java
    │   ├── OrderEventListener.java
    │   ├── DeadLetterListener.java
    │   └── KafkaConfig.java
    └── resources/
        ├── application.yaml
        └── db/migration/V1__create_notification.sql
```

### Arquivos de build e esquema

=== "pom.xml"

    ``` xml title="services/notification/pom.xml"
    --8<-- "docs/2027.1/hands-on/7/code/services/notification/pom.xml"
    ```

=== "Dockerfile"

    ``` dockerfile title="services/notification/Dockerfile"
    --8<-- "docs/2027.1/hands-on/7/code/services/notification/Dockerfile"
    ```

=== ".dockerignore"

    ``` text title="services/notification/.dockerignore"
    --8<-- "docs/2027.1/hands-on/7/code/services/notification/.dockerignore"
    ```

=== "application.yaml"

    ``` yaml title="services/notification/src/main/resources/application.yaml"
    --8<-- "docs/2027.1/hands-on/7/code/services/notification/src/main/resources/application.yaml"
    ```

=== "V1__create_notification.sql"

    ``` sql title="services/notification/src/main/resources/db/migration/V1__create_notification.sql"
    --8<-- "docs/2027.1/hands-on/7/code/services/notification/src/main/resources/db/migration/V1__create_notification.sql"
    ```

`sent_at` usa `clock_timestamp()` (a hora real do INSERT), não `now()` (a hora em que a *transação*
começou): com o e-mail enviado dentro da transação, `now()` esconderia a latência dele.

### O evento, o e-mail e as propriedades

=== "OrderEvent.java"

    ``` java title="services/notification/src/main/java/boxoffice/notification/OrderEvent.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/notification/src/main/java/boxoffice/notification/OrderEvent.java"
    ```

=== "EmailSender.java"

    ``` java title="services/notification/src/main/java/boxoffice/notification/EmailSender.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/notification/src/main/java/boxoffice/notification/EmailSender.java"
    ```

=== "NotificationProperties.java"

    ``` java title="services/notification/src/main/java/boxoffice/notification/NotificationProperties.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/notification/src/main/java/boxoffice/notification/NotificationProperties.java"
    ```

=== "NotificationApplication.java"

    ``` java title="services/notification/src/main/java/boxoffice/notification/NotificationApplication.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/notification/src/main/java/boxoffice/notification/NotificationApplication.java"
    ```

## Idempotência: deduplicar na mesma transação do efeito

``` java title="services/notification/src/main/java/boxoffice/notification/NotificationService.java"
--8<-- "docs/2027.1/hands-on/7/code/services/notification/src/main/java/boxoffice/notification/NotificationService.java"
```

A ordem das operações é o ponto central:

1. **Reivindicar** o evento: `INSERT ... ON CONFLICT DO NOTHING` na chave primária `event_id`. Zero
   linhas significa que outra entrega (ou outra instância do consumidor, ao mesmo tempo) já o
   reivindicou → pular.
2. **Fazer o efeito** — enviar o e-mail.
3. **Commit.** Se o passo 2 lançar exceção, a reivindicação é desfeita e a retentativa pode tentar de novo.

Sobra uma janela: o e-mail é enviado e então o commit falha (o banco caiu exatamente naquele
instante). A reentrega enviará um segundo e-mail. Nenhum consumidor consegue, sozinho, tornar um efeito
colateral **externo** *exactly-once*; a correção completa é uma **chave de idempotência** aceita pelo
provedor (a maioria das APIs de e-mail e de pagamento aceita uma — passe o `eventId`). O
processamento *exactly-once* dentro do Kafka (transações, `read_committed`) cobre pipelines de Kafka
para Kafka, não e-mails.

!!! tip "Na entrevista"

    "O Kafka dá *at-least-once*; eu torno os consumidores idempotentes com uma tabela de deduplicação
    indexada pelo id do evento, gravada na mesma transação do efeito, e passo o id do evento como chave
    de idempotência para os provedores externos." Essa frase responde à maioria das perguntas de
    acompanhamento do tipo "e as duplicatas?".

## Listeners, retentativas e o tópico de mensagens mortas

=== "OrderEventListener.java"

    ``` java title="services/notification/src/main/java/boxoffice/notification/OrderEventListener.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/notification/src/main/java/boxoffice/notification/OrderEventListener.java"
    ```

=== "KafkaConfig.java"

    ``` java title="services/notification/src/main/java/boxoffice/notification/KafkaConfig.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/notification/src/main/java/boxoffice/notification/KafkaConfig.java"
    ```

=== "DeadLetterListener.java"

    ``` java title="services/notification/src/main/java/boxoffice/notification/DeadLetterListener.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/notification/src/main/java/boxoffice/notification/DeadLetterListener.java"
    ```

=== "NotificationController.java"

    ``` java title="services/notification/src/main/java/boxoffice/notification/NotificationController.java"
    --8<-- "docs/2027.1/hands-on/7/code/services/notification/src/main/java/boxoffice/notification/NotificationController.java"
    ```

Como flui um registro que falha:

``` mermaid-sim
sequenceDiagram
    participant K as order-events (partição 3)
    participant L as listener
    participant H as DefaultErrorHandler
    participant D as order-events-dlt (partição 3)
    K->>L: offset 41
    L--xH: MailSendException (transitória)
    H->>L: tenta de novo após 0,5 s
    L--xH: falha de novo
    H->>L: tenta após 1 s, depois 2 s
    L--xH: continua falhando
    H->>D: publica o registro + headers da exceção
    H->>K: confirma o offset 42, segue em frente
    K->>L: offset 42 (a partição volta a andar)
```

- **As retentativas acontecem no lugar**, bloqueando só *aquela* partição por no máximo
  0,5 + 1 + 2 = 3,5 s; as outras partições continuam andando nas outras *threads* consumidoras.
- **Exceções não retentáveis pulam o *backoff***: um JSON malformado ou um endereço recusado vai para a
  DLT imediatamente.
- O Spring Boot liga o único bean `CommonErrorHandler` à sua fábrica de contêineres de listener; não é
  preciso nenhuma configuração extra.

!!! info "Retentativas bloqueantes vs não bloqueantes"

    O Spring Kafka também oferece `@RetryableTopic`: registros que falham vão para os tópicos
    `order-events-retry-0`, `-retry-1`… com atrasos, então a partição principal **nunca** é bloqueada.
    O preço é ter mais tópicos e **nenhuma ordem** entre um evento retentado e eventos posteriores da
    mesma chave. Para e-mails, bloquear alguns segundos é aceitável; para fluxos de alto volume,
    retentativas não bloqueantes são comuns.

## Adicione `notification` ao Compose e teste

``` yaml title="docker-compose.yaml (excerpt)"
  notification:
    build: ./services/notification
    environment:
      DB_HOST: db
      DB_PORT: 5432
      DB_NAME: ${DB_NAME:-boxoffice}
      DB_USER: ${DB_USER:-boxoffice}
      DB_PASSWORD: ${DB_PASSWORD:-boxoffice}
      KAFKA_BOOTSTRAP_SERVERS: kafka:9092
      MAIL_HOST: mailpit
      NOTIFY_CONCURRENCY: ${NOTIFY_CONCURRENCY:-3}   # consumer threads (max useful: 6 partitions)
      EMAIL_LATENCY: ${EMAIL_LATENCY:-50ms}          # simulated e-mail provider latency
      NOTIFY_IDEMPOTENT: ${NOTIFY_IDEMPOTENT:-true}  # false = no dedupe (to see duplicates)
    ports:
      - "8086:8086"
    depends_on:
      db:
        condition: service_healthy
      mailpit:
        condition: service_started
      kafka-init:
        condition: service_completed_successfully
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 768M
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:8086/actuator/health/readiness || exit 1"]
      interval: 10s
      timeout: 3s
      start_period: 40s
      retries: 3
```

<!-- termynal -->

``` shell
> docker compose up -d --build notification
> docker compose logs notification | grep -i "dead letter"
notification-1  | ... b.notification.DeadLetterListener        : dead letter at order-events-dlt-4@0: java.lang.IllegalArgumentException
notification-1  | ... b.notification.DeadLetterListener        : dead letter at order-events-dlt-3@0: java.lang.IllegalArgumentException
notification-1  | ... b.notification.DeadLetterListener        : dead letter at order-events-dlt-4@1: java.lang.IllegalArgumentException
> curl -s localhost:8025/api/v1/messages | jq '.total'
2
```

O que aconteceu, em ordem:

1. O grupo `notification` é novo, então começa no offset **mais antigo** e encontra primeiro as três
   mensagens do passeio do [passo 1](../kafka/index.md): elas não são eventos do BoxOffice →
   `IllegalArgumentException` → direto para a DLT, sem bloquear os eventos reais atrás delas.
2. Os dois eventos `OrderPlaced` reais (reservas `0001` e `0002`) produzem **dois e-mails** no Mailpit
   (`http://localhost:8025`).

### Experimento: reprocessar sem duplicatas

Volte o grupo inteiro e deixe-o consumir tudo de novo:

``` shell
docker compose stop notification
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka:9092 \
  --group notification --topic order-events --reset-offsets --to-earliest --execute
docker compose start notification
docker compose logs notification | grep duplicate
curl -s localhost:8025/api/v1/messages | jq '.total'
```

Os logs mostram `duplicate event ... ignored` para cada pedido e o Mailpit continua com **2** e-mails.
Repita com `NOTIFY_IDEMPOTENT=false docker compose up -d notification` e conte de novo: cada
reprocessamento envia todos os e-mails outra vez.

### Experimento: um pedido envenenado

``` shell
curl -s -X POST localhost:8084/orders -H 'Content-Type: application/json' \
  -d '{"showId":"show-42","holdId":"hold-0003","customerEmail":"poison@example.com","amount":350.00}'
docker compose exec db psql -U boxoffice -d boxoffice \
  -c "SELECT topic, partition, record_offset, reason FROM notification.dead_letters;"
```

O pedido dá certo (o fã não é afetado), o e-mail falha de forma permanente e o registro cai em
`order-events-dlt`; abra-o no Kafka UI e veja os *headers* `kafka_dlt-*` (tópico, partição e offset
originais, exceção).

!!! warning "Uma DLT que ninguém lê é perda de dados silenciosa"

    Cada mensagem morta é um cliente que não recebeu e-mail. Em produção: alerte quando a DLT crescer
    ([lab 8](../../8/index.md)), corrija a causa e então **reprocesse** os registros de volta para
    `order-events` (uma pequena ferramenta ou `kafka-console-consumer | kafka-console-producer` com as
    chaves originais). Reprocessar é seguro justamente porque o consumidor é idempotente.

[Próximo: Sala de espera](../waiting-room/index.md){ .md-button .md-button--primary }
