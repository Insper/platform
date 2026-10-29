Um fã paga por dois lugares, o serviço `order` da BoxOffice grava o pedido… e cai antes de avisar alguém. Nada de e-mail com o ingresso. Ou o contrário: o evento sai, a transação no banco é desfeita e um fã recebe um ingresso de um pedido que não existe. Ou o broker entrega o mesmo evento duas vezes e o fã recebe dois e-mails — e depois, dois ingressos. Esse é o **problema da escrita dupla** (*dual write*), e todo sistema orientado a eventos precisa resolvê-lo. Neste exercício você o resolve com um **outbox transacional**, um **consumidor idempotente** e um **tópico de mensagens mortas** (DLT), e depois se esforça para quebrá-lo.

!!! abstract "Objetivos de aprendizagem"

    Ao final deste exercício você será capaz de:

    - **Explicar** por que "gravar no banco, depois publicar no Kafka" perde ou inventa eventos, e como o outbox resolve isso.
    - **Implementar** um outbox transacional com um relay por polling e um consumidor idempotente com retentativas e DLQ.
    - **Raciocinar** sobre semânticas de entrega: entrega at-least-once + processamento idempotente = efeitos colaterais effectively-once.
    - **Verificar** a correção sob falhas com uma consulta de reconciliação, e **medir** a latência fim a fim e o atraso do consumidor.

## Contexto { #context }

A [Aula 8](../../classes/messaging/index.md) tratou de filas, pub/sub e do log de eventos, das partições e grupos de consumidores do Kafka, das semânticas de entrega e dos padrões outbox/saga[^1]. O [Lab 7](../../hands-on/7/index.md) montou o Kafka (KRaft) com os serviços `order` e `notification` da BoxOffice. Aqui você torna esse fluxo **correto sob falhas** e prova isso.

``` diagram-sim
flowchart LR
    client([k6]) -->|POST /orders| order[order]
    order -->|"1 · uma transação: pedido + linha no outbox"| odb[("order_svc<br/>orders · outbox")]
    relay[relay do outbox] -->|"2 · busca linhas não publicadas"| odb
    relay -->|"3 · publica, chave = orderId"| kafka{{"Kafka · order-events"}}
    kafka -->|"4 · consome"| notif[notification]
    notif -->|"5 · uma transação: processed_events + ticket_emails"| ndb[("notification_svc<br/>processed_events · ticket_emails")]
    notif -.->|"mensagem envenenada após retentativas"| dlt{{"order-events.DLT"}}
```

Por que cada peça existe:

| Peça | Falha que ela trata |
|-|-|
| Linha no outbox na **mesma transação** do pedido | Queda entre "gravar" e "publicar": o evento está no banco e será publicado depois |
| O relay marca a linha como publicada **depois** do ack do broker | Broker fora ou queda do relay: a linha é reenviada (→ duplicatas são possíveis: at-least-once) |
| Inserção em `processed_events` na **mesma transação** do efeito colateral | Entrega duplicada: a segunda inserção conflita e o efeito colateral é pulado |
| Retentativas com backoff, depois **DLT** | Erros transitórios são repetidos; uma mensagem envenenada não trava a partição para sempre |
| Chave do Kafka = `orderId` | Todos os eventos de um pedido vão para a mesma partição, em ordem |

## Tarefa { #task }

Implemente e verifique o fluxo **pedido confirmado → e-mail com o ingresso** da BoxOffice (ou o fluxo equivalente dos seus serviços):

1. `order` grava o pedido e uma linha no **outbox** (envelope do evento) em **uma transação**.
2. Um **relay** publica as linhas não publicadas do outbox no tópico `order-events` (chave = `orderId`) e as marca depois que o broker confirma.
3. `notification` consome os eventos de forma **idempotente** (deduplicação pelo id do evento na mesma transação do efeito colateral), repete erros transitórios com backoff e manda **mensagens envenenadas para uma DLT**.
4. Execute uma **carga de 10 minutos** injetando falhas (queda do relay, queda do broker, queda do consumidor, evento duplicado, mensagem envenenada) e prove com uma **consulta de reconciliação** que há **zero e-mails perdidos e zero duplicados**.
5. Meça a **latência fim a fim** e o **atraso do consumidor**, com e sem falhas.

## Requisitos { #requirements }

- [ ] **(obrigatório)** Linha do outbox gravada na **mesma transação** da mudança de negócio (mostre o código).
- [ ] **(obrigatório)** Consumidor idempotente: deduplicação pelo id do evento **na mesma transação** do efeito colateral.
- [ ] **(obrigatório)** Reconciliação depois da execução de 10 minutos com falhas: **0 perdidos** e **0 duplicados** (a consulta e sua saída no relatório).
- [ ] Envelope do evento com pelo menos `eventId`, `type`, `version`, `occurredAt` e a chave de negócio.
- [ ] O relay publica com `acks=all` e marca as linhas só depois do ack; o outbox volta a **0 linhas não publicadas** depois que o broker volta (tempo medido).
- [ ] Retentativas com backoff exponencial e uma **DLT**; a mensagem envenenada está na DLT e o consumidor continua processando as mensagens seguintes.
- [ ] Roteiro de falhas executado durante a carga: queda do relay/`order`, broker parado por ≥ 60 s, consumidor morto (`SIGKILL`) no meio do processamento, um evento válido duplicado, uma mensagem envenenada.
- [ ] Latência fim a fim (pedido confirmado → efeito colateral) p50/p95/p99, e atraso do consumidor ao longo do tempo.
- [ ] Uma discussão sobre ordem (o que a chave garante e o que não garante) e sobre o e-mail real (um efeito colateral externo, fora do seu banco).
- [ ] Seção *Uso de IA* (veja a [política](../index.md#use-of-ai-tools)).

## Entregáveis { #deliverables }

No seu repositório (tag `ex4`): o código dos dois serviços, as migrações, o `compose.yaml`, o script k6, o script de falhas, as consultas de reconciliação e de latência e suas saídas; uma página `event-driven` no site da sua documentação seguindo o [template](#templates).

## Passo a passo { #step-by-step }

### 1. Kafka (KRaft) e os schemas { #1-kafka-kraft-and-the-schemas }

Reaproveite o Kafka do Lab 7. Como referência, um broker KRaft de nó único com a imagem oficial:

```yaml title="compose.yaml (excerpt)"
services:
  kafka:
    image: apache/kafka:3.8.0
    environment:
      KAFKA_NODE_ID: 1
      KAFKA_PROCESS_ROLES: broker,controller
      KAFKA_LISTENERS: PLAINTEXT://:9092,CONTROLLER://:9093,EXTERNAL://:29092
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092,EXTERNAL://localhost:29092
      KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT,EXTERNAL:PLAINTEXT
      KAFKA_CONTROLLER_QUORUM_VOTERS: 1@kafka:9093
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: 1
      KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS: 0
    ports:
      - "29092:29092"
```

Cada serviço é dono dos seus dados. Para que a reconciliação seja uma única consulta, este exercício mantém os dois serviços em **uma instância PostgreSQL com dois schemas** (serviço `postgres` do Compose, banco `boxoffice`: `order_svc` e `notification_svc`), cada serviço usando apenas o seu schema. Em produção seriam bancos separados e a reconciliação, um pequeno job.

```sql title="order/src/main/resources/db/migration/V2__outbox.sql"
CREATE TABLE outbox (
    id             UUID PRIMARY KEY,
    aggregate_type VARCHAR(50)  NOT NULL,
    aggregate_id   VARCHAR(50)  NOT NULL,
    event_type     VARCHAR(100) NOT NULL,
    payload        JSONB        NOT NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    published_at   TIMESTAMPTZ
);
CREATE INDEX outbox_unpublished ON outbox (created_at) WHERE published_at IS NULL;
```

```sql title="notification/src/main/resources/db/migration/V1__notification.sql"
CREATE TABLE processed_events (
    event_id     UUID PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ticket_emails (
    id         BIGSERIAL PRIMARY KEY,
    order_id   UUID         NOT NULL,
    event_id   UUID         NOT NULL,
    recipient  VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

!!! warning "Sem restrição de unicidade em `ticket_emails.order_id`"

    É tentador acrescentar uma — e em produção talvez você acrescente. Aqui, deixe de fora: a ideia é mostrar que **a lógica do consumidor** evita duplicatas. Uma restrição de unicidade esconderia um consumidor com defeito.

### 2. Grave o pedido e o evento juntos { #2-write-the-order-and-the-event-together }

```java title="order/src/main/java/boxoffice/order/OrderService.java"
package boxoffice.order;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OrderService {

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public OrderService(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Transactional
    public UUID confirm(NewOrder cmd) throws Exception {
        UUID orderId = UUID.randomUUID();
        Instant now = Instant.now();
        jdbc.update("""
            INSERT INTO orders (id, event_id, seats, customer_email, status, confirmed_at)
            VALUES (?, ?, ?, ?, 'CONFIRMED', ?)
            """, orderId, cmd.eventId(), cmd.seats(), cmd.customerEmail(), java.sql.Timestamp.from(now));

        UUID eventId = UUID.randomUUID();
        Map<String, Object> envelope = Map.of(
            "eventId", eventId.toString(),
            "type", "OrderConfirmed",
            "version", 1,
            "occurredAt", now.toString(),
            "orderId", orderId.toString(),
            "customerEmail", cmd.customerEmail(),
            "seats", cmd.seats());
        jdbc.update("""
            INSERT INTO outbox (id, aggregate_type, aggregate_id, event_type, payload)
            VALUES (?, 'order', ?, 'OrderConfirmed', ?::jsonb)
            """, eventId, orderId.toString(), json.writeValueAsString(envelope));
        return orderId; // both rows commit together, or neither does
    }
}
```

Neste exercício um pedido é confirmado quando é criado (o pagamento está fora do escopo); se o seu serviço tem uma etapa de confirmação separada, grave a linha do outbox nela.

### 3. O relay { #3-the-relay }

Um publicador por polling lê as linhas não publicadas, publica cada uma e espera a confirmação do broker antes de marcá-la. `FOR UPDATE SKIP LOCKED` permite rodar um segundo relay sem que os dois publiquem a mesma linha ao mesmo tempo.

```java title="order/src/main/java/boxoffice/order/OutboxRelay.java"
package boxoffice.order;

import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class OutboxRelay {

    private final JdbcTemplate jdbc;
    private final KafkaTemplate<String, String> kafka;

    public OutboxRelay(JdbcTemplate jdbc, KafkaTemplate<String, String> kafka) {
        this.jdbc = jdbc;
        this.kafka = kafka;
    }

    @Scheduled(fixedDelay = 200)   // requires @EnableScheduling on a configuration class
    @Transactional
    public void publishBatch() {
        List<Map<String, Object>> rows = jdbc.queryForList("""
            SELECT id, aggregate_id, payload::text AS payload
              FROM outbox
             WHERE published_at IS NULL
             ORDER BY created_at
             LIMIT 100
             FOR UPDATE SKIP LOCKED
            """);
        for (Map<String, Object> row : rows) {
            String key = (String) row.get("aggregate_id");
            String payload = (String) row.get("payload");
            kafka.send("order-events", key, payload).join();   // wait for the ack (acks=all)
            jdbc.update("UPDATE outbox SET published_at = now() WHERE id = ?", row.get("id"));
        }
    }
}
```

```yaml title="order/src/main/resources/application.yaml (excerpt)"
spring:
  kafka:
    bootstrap-servers: kafka:9092
    producer:
      acks: all
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.apache.kafka.common.serialization.StringSerializer
      properties:
        enable.idempotence: true
        delivery.timeout.ms: 30000
```

Se o relay cair depois do `send` e antes do commit da transação, a linha é publicada **de novo** no próximo polling. Tudo bem — o consumidor é idempotente. Change Data Capture com Debezium (lendo o outbox a partir do WAL do PostgreSQL) é um relay alternativo; é uma boa extensão nível A.

### 4. O consumidor idempotente, as retentativas e a DLT { #4-the-idempotent-consumer-retries-and-the-dlt }

```java title="notification/src/main/java/boxoffice/notification/TicketEmailService.java"
package boxoffice.notification;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TicketEmailService {

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public TicketEmailService(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Transactional
    public void handle(String message) {
        JsonNode event = parse(message);
        UUID eventId = UUID.fromString(event.path("eventId").asText());
        int inserted = jdbc.update(
            "INSERT INTO processed_events (event_id) VALUES (?) ON CONFLICT DO NOTHING", eventId);
        if (inserted == 0) {
            return; // duplicate delivery: already processed, skip the side effect
        }
        jdbc.update("INSERT INTO ticket_emails (order_id, event_id, recipient) VALUES (?, ?, ?)",
            UUID.fromString(event.path("orderId").asText()), eventId, event.path("customerEmail").asText());
        // The real e-mail is sent from ticket_emails by a separate sender,
        // using event_id as the idempotency key with the e-mail provider.
    }

    private JsonNode parse(String message) {
        try {
            JsonNode event = json.readTree(message);
            if (!"OrderConfirmed".equals(event.path("type").asText()) || event.path("eventId").isMissingNode()) {
                throw new InvalidEventException("unexpected event: " + message);
            }
            return event;
        } catch (InvalidEventException e) {
            throw e;
        } catch (Exception e) {
            throw new InvalidEventException("malformed event: " + e.getMessage());
        }
    }
}
```

```java title="notification/src/main/java/boxoffice/notification/KafkaConfig.java"
package boxoffice.notification;

import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.common.TopicPartition;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.config.TopicBuilder;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.listener.DeadLetterPublishingRecoverer;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.kafka.support.ExponentialBackOffWithMaxRetries;
import org.springframework.stereotype.Component;

@Configuration
public class KafkaConfig {

    @Bean
    NewTopic orderEvents() {
        return TopicBuilder.name("order-events").partitions(3).replicas(1).build();
    }

    @Bean
    NewTopic orderEventsDlt() {
        return TopicBuilder.name("order-events.DLT").partitions(3).replicas(1).build();
    }

    // Picked up by Spring Boot's listener container factory.
    @Bean
    DefaultErrorHandler errorHandler(KafkaTemplate<String, String> template) {
        DeadLetterPublishingRecoverer recoverer = new DeadLetterPublishingRecoverer(template,
            (record, ex) -> new TopicPartition(record.topic() + ".DLT", record.partition()));
        ExponentialBackOffWithMaxRetries backOff = new ExponentialBackOffWithMaxRetries(3);
        backOff.setInitialInterval(500);
        backOff.setMultiplier(2.0);
        DefaultErrorHandler handler = new DefaultErrorHandler(recoverer, backOff);
        handler.addNotRetryableExceptions(InvalidEventException.class); // poison: straight to the DLT
        return handler;
    }

    @Component
    static class OrderEventsListener {
        private final TicketEmailService service;

        OrderEventsListener(TicketEmailService service) {
            this.service = service;
        }

        @KafkaListener(topics = "order-events", groupId = "notification")
        void onMessage(ConsumerRecord<String, String> record) {
            service.handle(record.value());
        }
    }
}
```

`InvalidEventException` é uma `RuntimeException` simples. O consumidor só confirma o offset depois que `handle` retorna (os modos de ack padrão do Spring Kafka, `BATCH`/`RECORD`, confirmam depois do listener)[^2], então uma queda no meio significa **reentrega** — que a tabela `processed_events` absorve.

### 5. Carga e falhas { #5-load-and-failures }

```javascript title="load/orders.js"
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:8081';

export const options = {
  scenarios: {
    orders: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 20), timeUnit: '1s',
      duration: __ENV.DURATION || '10m',
      preAllocatedVUs: 20, maxVUs: 200,
    },
  },
};

export default function () {
  const body = JSON.stringify({
    eventId: 1 + Math.floor(Math.random() * 100),
    seats: 1 + Math.floor(Math.random() * 4),
    customerEmail: `fan${__VU}-${__ITER}@example.com`,
  });
  const res = http.post(`${BASE}/orders`, body, { headers: { 'Content-Type': 'application/json' } });
  check(res, { 'order accepted': (r) => r.status === 201 });
}
```

```bash title="chaos/failures.sh"
#!/usr/bin/env bash
# Failure schedule, started together with the 10-minute k6 run.
set -x
sleep 90;  docker compose kill order;          sleep 20; docker compose start order
sleep 90;  docker compose stop kafka;          sleep 60; docker compose start kafka
sleep 90;  docker compose kill notification;   sleep 20; docker compose start notification
sleep 30
# a duplicate: publish again an event that was already published
docker compose exec -T postgres psql -U boxoffice -d boxoffice -tAc \
  "select aggregate_id || '|' || payload::text from order_svc.outbox where published_at is not null limit 1" \
  | docker compose exec -T kafka /opt/kafka/bin/kafka-console-producer.sh \
      --bootstrap-server kafka:9092 --topic order-events \
      --property parse.key=true --property key.separator='|'
# a poison message
echo 'poison|{"type":"OrderConfirmed","orderId":' \
  | docker compose exec -T kafka /opt/kafka/bin/kafka-console-producer.sh \
      --bootstrap-server kafka:9092 --topic order-events \
      --property parse.key=true --property key.separator='|'
```

```bash
k6 run load/orders.js & ./chaos/failures.sh; wait
```

As requisições para o `order` falham enquanto ele está fora — isso é esperado (os erros do k6 não são o foco aqui). O que precisa valer é: **todo pedido aceito recebe exatamente um e-mail com o ingresso**.

### 6. Verifique e meça { #6-verify-and-measure }

```sql title="verify.sql"
-- lost: confirmed orders without exactly one ticket e-mail
SELECT o.id, count(t.id) AS emails
  FROM order_svc.orders o
  LEFT JOIN notification_svc.ticket_emails t ON t.order_id = o.id
 WHERE o.status = 'CONFIRMED'
 GROUP BY o.id
HAVING count(t.id) <> 1;

-- duplicated side effects
SELECT order_id, count(*) FROM notification_svc.ticket_emails GROUP BY order_id HAVING count(*) > 1;

-- outbox backlog (must return to 0)
SELECT count(*) AS unpublished FROM order_svc.outbox WHERE published_at IS NULL;

-- end-to-end latency in seconds: order confirmed -> ticket e-mail recorded
SELECT percentile_cont(ARRAY[0.5, 0.95, 0.99]) WITHIN GROUP (
         ORDER BY extract(epoch FROM t.created_at - o.confirmed_at)) AS p50_p95_p99
  FROM notification_svc.ticket_emails t
  JOIN order_svc.orders o ON o.id = t.order_id;
```

```bash
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server kafka:9092 --describe --group notification
docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server kafka:9092 --topic order-events.DLT --from-beginning --timeout-ms 5000
```

Amostre o atraso do consumidor a cada poucos segundos durante a execução (um loop em volta de `kafka-consumer-groups.sh`, ou as métricas do Kafka na stack de observabilidade do [Lab 8](../../hands-on/8/index.md)) para plotá-lo ao longo do tempo: você deve vê-lo crescer enquanto o `notification` está fora e esvaziar depois.

## Templates

=== "English"

    ~~~markdown
    # Event-driven — outbox and idempotent consumer

    ## 1. Flow and design
    Diagram; event envelope (fields and an example); topic, partitions, key; consumer group.

    ## 2. Why it is correct
    | Failure | What happens | Why nothing is lost or duplicated |
    |-|-|-|
    | order/relay crash after the commit | | |
    | broker down | | |
    | consumer crash mid-processing | | |
    | duplicate event | | |
    | poison message | | |

    ## 3. Run with failures
    Rate ... orders/s, 10 min. Failure timeline: T+90 s order killed, ...

    ## 4. Verification
    | Check | Result |
    |-|-|
    | Accepted orders | |
    | Lost (query 1) | 0 |
    | Duplicated (query 2) | 0 |
    | Outbox back to 0 unpublished after broker restart | ... s |
    | Poison message in the DLT | yes / no |

    ## 5. Latency and lag
    | | p50 | p95 | p99 |
    |-|-|-|-|
    | Without failures | | | |
    | With failures | | | |
    Consumer lag over time (chart) and explanation.

    ## 6. Discussion
    Ordering per key; exactly-once vs effectively-once; sending the real e-mail; outbox vs CDC.

    ## 7. AI usage
    ~~~

=== "Português"

    ~~~markdown
    # Orientado a eventos — outbox e consumidor idempotente

    ## 1. Fluxo e design
    Diagrama; envelope do evento (campos e um exemplo); tópico, partições, chave; grupo de consumidores.

    ## 2. Por que está correto
    | Falha | O que acontece | Por que nada se perde nem se duplica |
    |-|-|-|
    | queda do order/relay depois do commit | | |
    | broker fora do ar | | |
    | queda do consumidor no meio do processamento | | |
    | evento duplicado | | |
    | mensagem envenenada | | |

    ## 3. Execução com falhas
    Taxa ... pedidos/s, 10 min. Linha do tempo das falhas: T+90 s order derrubado, ...

    ## 4. Verificação
    | Verificação | Resultado |
    |-|-|
    | Pedidos aceitos | |
    | Perdidos (consulta 1) | 0 |
    | Duplicados (consulta 2) | 0 |
    | Outbox de volta a 0 não publicados depois do reinício do broker | ... s |
    | Mensagem envenenada na DLT | sim / não |

    ## 5. Latência e atraso
    | | p50 | p95 | p99 |
    |-|-|-|-|
    | Sem falhas | | | |
    | Com falhas | | | |
    Atraso do consumidor ao longo do tempo (gráfico) e explicação.

    ## 6. Discussão
    Ordem por chave; exactly-once vs effectively-once; envio do e-mail real; outbox vs CDC.

    ## 7. Uso de IA
    ~~~

## Rubrica { #rubric }

Níveis conforme definidos em [Como os exercícios são avaliados](../index.md#how-the-exercises-are-graded).

| Critério | I | D | C | B | A |
|-|-|-|-|-|-|
| Outbox transacional **(obrigatório)** | Ausente | Publicação fora da transação (escrita dupla) | Outbox na mesma transação, relay marca depois do ack | Envelope versionado; relay seguro com duas instâncias | Relay por CDC (Debezium) comparado com o polling |
| Consumidor idempotente **(obrigatório)** | Ausente | Deduplicação fora da transação do efeito colateral | Deduplicação pelo id do evento na mesma transação | Retenção/limpeza de `processed_events` discutida | Envio real do e-mail idempotente com o provedor (chave = id do evento) |
| Retentativas e DLT | — | Sem DLT, ou a mensagem envenenada trava a partição | Backoff + DLT; o consumidor segue em frente | Erros repetíveis vs não repetíveis justificados | Procedimento de reprocessamento da DLT documentado e testado |
| Verificação sob falhas **(obrigatório)** | Sem prova | Algumas falhas não executadas | As cinco falhas; 0 perdidos, 0 duplicados | Linha do tempo da execução com backlog do outbox e atraso | Falha adicional (por exemplo, partição de rede) testada |
| Medições | — | Só médias | p50/p95/p99 fim a fim + atraso | Com vs sem falhas comparados e explicados | Atraso previsto a partir das taxas (backlog ÷ taxa de consumo) e conferido |
| Discussão | — | Ausente | Ordem e efeito colateral externo tratados | Trade-offs do exactly-once do Kafka vs idempotência | Enunciado claro das garantias do fluxo inteiro |

## FAQ

??? question "O Kafka tem semântica exactly-once. Por que preciso de tudo isso?"

    As transações do Kafka dão exactly-once **dentro do Kafka** (consumir → produzir → confirmar offsets). Os seus efeitos colaterais — uma linha no PostgreSQL, um e-mail — vivem fora do Kafka. A receita robusta é entrega at-least-once mais processamento idempotente, o que faz o *efeito* acontecer uma vez.

??? question "Posso usar `@TransactionalEventListener` em vez de um outbox?"

    Ele publica depois do commit, mas se o processo morrer entre o commit e a publicação, o evento se perde — o problema da escrita dupla de novo, só que mais raro. O outbox sobrevive a quedas porque o evento está no banco.

??? question "O relay vai publicar eventos fora de ordem?"

    Com um relay e `ORDER BY created_at`, os eventos são publicados na ordem de commit (aproximadamente). O Kafka mantém a ordem **por partição**, e a chave `orderId` coloca todos os eventos de um pedido na mesma partição. Não há ordem global entre pedidos — e a BoxOffice não precisa de uma. Explique isso na sua discussão.

??? question "Por quanto tempo guardo `processed_events`?"

    Pelo menos enquanto uma duplicata puder chegar (retenção do tópico, retentativas do relay). Na prática, dias; depois apague as linhas antigas com um job agendado. Diga o que você escolheria e por quê.

??? question "O atraso do meu consumidor nunca diminui depois que o broker volta."

    Confira se o consumidor reconecta (logs), se não está preso repetindo uma mensagem envenenada (a DLT está configurada?) e se o tópico tem o número de partições que você espera. `kafka-consumer-groups.sh --describe` mostra o atraso por partição.

??? question "A injeção da duplicata não criou e-mail duplicado. Funcionou?"

    Esse é o resultado esperado. Prove que a duplicata **foi entregue**: a linha de log do consumidor para uma duplicata pulada, ou a contagem de mensagens consumidas vs linhas em `processed_events`.

[^1]: Chris Richardson, "Pattern: Transactional outbox", [microservices.io](https://microservices.io/patterns/data/transactional-outbox.html){target="_blank"}.
[^2]: Referência do Spring for Apache Kafka, "Handling exceptions" e "Publishing dead-letter records", [docs.spring.io/spring-kafka](https://docs.spring.io/spring-kafka/reference/){target="_blank"}.
