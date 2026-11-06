---
marp: true
lang: pt-BR
title: Hands-on 10 — Mensageria com Kafka
description: Plataformas, Microsserviços, DevOps e APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">Plataformas, Microsserviços, DevOps e APIs · Hands-on 10</div>

# Hands-on 10 — Mensageria com Kafka

**O order-service publica `OrderCreated`; um notification-service reage por conta própria**

<!--
Roteiro: (1) por que não mais uma chamada REST; (2) Kafka (modo KRaft) e Kafka UI no compose; (3) o
producer do order-service; (4) o consumer Python do notification-service; (5) teste; (6) DLQ, idempotência.
-->

---

## O e-mail deve bloquear o cliente?

<div class="q">

Toda chamada que o order-service faz — ao account-service, ao product-service — acontece **antes** de ele responder.
Agora precisamos enviar um **e-mail de confirmação**. Mais uma chamada REST?

</div>

* O cliente não precisa do e-mail para **concluir o pedido**: é **fire-and-forget**.
* Então publique um evento **`OrderCreated`** no Kafka e retorne.
* Um novo **notification-service** o consome de forma **assíncrona** — o order-service nem sabe que ele existe.

---

## 1 · Arquitetura

<div class="flow">
<div class="arrow" style="flex: .45; text-align: left">Antes</div>
<div class="box">cliente</div><div class="arrow">→</div>
<div class="box">gateway</div><div class="arrow">→</div>
<div class="box accent">order-service</div><div class="arrow">REST, síncrono →</div>
<div class="box">account-service<small>e product-service</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .45; text-align: left">Depois</div>
<div class="box muted">as mesmas chamadas REST</div><div class="arrow">+</div>
<div class="box accent">order-service</div><div class="arrow">publica →</div>
<div class="box orange">order-events<small>tópico Kafka</small></div><div class="arrow">assíncrono →</div>
<div class="box green">notification-service</div>
</div>

<div class="ok">

Desacoplamento: amanhã um **analytics-service** pode consumir `order-events` sem mexer em uma única linha do order-service.

</div>

---

## Os passos

2. **Docker Compose** — adicionar o Kafka (modo KRaft, sem ZooKeeper) e o Kafka UI.
3. **order-service** — `spring-kafka`, o record `OrderCreatedEvent`, config do producer, publisher.
4. **notification-service** — um novo consumer em Python / FastAPI.
5. **Testes** — criar um pedido, ver o evento no Kafka UI e nos logs de notificação; escalar o consumer.
6. **Confiabilidade** — dead letter queue e consumers idempotentes.

---

<!-- _class: tight -->

## 2 · Docker Compose

Dois serviços novos no `docker-compose.yml`:

| Serviço | Imagem | Porta | Papel |
|---|---|---|---|
| `kafka` | `apache/kafka:4.3.1` | 9092 | broker + controller KRaft |
| `kafka-ui` | `provectuslabs/kafka-ui:latest` | 8090 → 8080 | tópicos, mensagens, lag dos consumers |

Configurações principais do Kafka:

- `KAFKA_PROCESS_ROLES: broker,controller` — **KRaft**: um nó é broker e controller (quórum em `CONTROLLER://:9093`); o ZooKeeper foi removido no Kafka 4.0.
- `KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092` — clientes se conectam pelo nome do serviço.
- `KAFKA_AUTO_CREATE_TOPICS_ENABLE: "true"` — `order-events` é criado na primeira publicação.
- `KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1` — um único broker em desenvolvimento.

---

## 3 · order-service: o evento

<div class="cols">
<div>

`pom.xml`:

```xml
<dependency>
    <groupId>org.springframework.kafka</groupId>
    <artifactId>spring-kafka</artifactId>
</dependency>
```

</div>
<div>

`store.order.OrderCreatedEvent`:

```java
public record OrderCreatedEvent(
    String orderId,
    String customerId,
    Double totalAmount,
    String timestamp
) {}
```

</div>
</div>

<p class="small">Um record: imutável, como o fato que ele representa.</p>

---

## 3 · Configuração do producer

```yaml
spring:
  kafka:
    bootstrap-servers: kafka:9092
    producer:
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.springframework.kafka.support.serializer.JsonSerializer
      acks: all
      retries: 3
      properties:
        enable.idempotence: true
```

<p class="small"><code>acks: all</code> espera todas as réplicas sincronizadas antes de confirmar. Sem efeito com um único broker; em produção, evita perda de dados no failover de um broker.</p>

---

## 3 · Publicando

```java
@Component
@RequiredArgsConstructor
public class OrderEventPublisher {
    private final KafkaTemplate<String, OrderCreatedEvent> kafkaTemplate;

    public void publishOrderCreated(Order order) {
        var event = new OrderCreatedEvent(order.getId().toString(),
            order.getCustomerId(), order.getTotalAmount(), Instant.now().toString());
        kafkaTemplate.send("order-events", order.getId().toString(), event);
    }
}
```

No `OrderService`, **depois de salvar**: `eventPublisher.publishOrderCreated(savedOrder);`

<p class="small">Tópico <code>order-events</code>, chave = id do pedido, valor = o evento em JSON.</p>

---

## 4 · notification-service (Python / FastAPI)

<div class="cols">
<div>

```text
notification-service/
    main.py
    Dockerfile
    requirements.txt
```

```text
fastapi==0.110.0
kafka-python==2.3.2
uvicorn==0.29.0
```

</div>
<div>

- `Dockerfile`: `python:3.12-slim`, roda `uvicorn main:app` na porta `8080`.
- Na inicialização, uma **thread daemon** executa o loop do consumer.
- `GET /health` → `{"status": "up"}`.
- No compose: `build: ./notification-service`, `depends_on: kafka`, `PYTHONUNBUFFERED=1`.

</div>
</div>

---

## 4 · O consumer

```python
consumer = KafkaConsumer(
    "order-events",
    bootstrap_servers="kafka:9092",
    group_id="notification-group",
    value_deserializer=lambda m: json.loads(m.decode("utf-8")),
    auto_offset_reset="earliest",
    enable_auto_commit=False,
)
for message in consumer:
    event = message.value
    logger.info(f"[NOTIFICATION] Order {event['orderId']} ... sending confirmation email")
    consumer.commit()
```

<p class="small"><code>enable_auto_commit=False</code> + <code>commit()</code> depois do processamento: uma queda no meio do processamento faz a mensagem ser consumida de novo — <strong>at-least-once</strong>.</p>

---

## At-least-once: uma queda antes do `commit()`

<div class="flow">
<div class="box">offset 0<small>OrderCreated ord-7f3a</small></div><div class="arrow">→</div>
<div class="box green">e-mail enviado</div><div class="arrow">→</div>
<div class="box red">queda<small>antes de consumer.commit()</small></div><div class="arrow">→</div>
<div class="box">reinício<small>recomeça no offset confirmado: 0</small></div><div class="arrow">→</div>
<div class="box orange">o mesmo e-mail de novo</div>
</div>

- O Kafka só conhece o offset **confirmado**: tudo depois dele é entregue de novo.
- Duplicatas são normais, então o consumer deve ser **idempotente**: pular um `orderId` já notificado.

<!--
A página desenha a mesma linha do tempo num diagrama passo a passo em "enable_auto_commit=False"; o simulador a reproduz em "6 · Falhas".
-->

---

<!-- _class: tight -->

## 5 · Testes

```bash
docker compose up --build -d
docker compose ps        # kafka, kafka-ui, notification-service, order-service
curl -s -X POST http://localhost:8080/orders \
    -H "Content-Type: application/json" \
    -d '{"customerId":"cust-42","items":[{"productId":"p1","quantity":2}]}' | jq .
# { "id": "ord-7f3a", "status": "CREATED", "totalAmount": 49.98 }
docker compose logs notification-service
# [NOTIFICATION] Order ord-7f3a for customer cust-42 — sending confirmation email (total: 49.98)
```

- Kafka UI `http://localhost:8090` → **Topics → order-events → Messages**: o evento com `orderId: ord-7f3a`.

---

## 5.5 · Partições e o grupo de consumidores

<div class="flow" style="align-items: stretch">
<div class="box" style="flex: .7; display: flex; flex-direction: column; justify-content: center">order-service<small>chave = orderId</small></div>
<div class="arrow" style="align-self: center">hash(chave) →</div>
<div class="group">
<div class="caption">order-events · 3 partições</div>
<div class="box orange">partição 0</div><div class="box orange">partição 1</div><div class="box orange">partição 2</div>
</div>
<div class="arrow" style="align-self: center">um leitor cada →</div>
<div class="group">
<div class="caption">notification-group</div>
<div class="box green">notification-service-1<small>partições 0 e 1</small></div>
<div class="box green">notification-service-2<small>partição 2</small></div>
</div>
</div>

- O tópico do lab é criado automaticamente com **1 partição**: uma segunda instância não tem nada para ler.
- `kafka-topics.sh --alter --partitions 3` → o grupo **rebalanceia**; o novo dono recomeça no offset confirmado.
- Atraso (*lag*) = offset final do log − offset confirmado: `kafka-consumer-groups.sh --describe --group notification-group`.

<!--
A seção 5.5 da página tem os comandos, um diagrama e uma tabela: o número de partições limita o paralelismo de um grupo.
-->

---

## 6 · Confiabilidade: dead letter queue

Uma mensagem que falha sempre não pode **travar o fluxo**. Envie-a para `order-events-dlq`:

```python
try:
    process_event(event)
    consumer.commit()
except Exception as e:
    logger.error(f"Failed to process {event['orderId']}: {e} — sending to DLQ")
    dlq_producer.send("order-events-dlq", value=event)
    consumer.commit()
```

<p class="small">Nos dois casos o offset avança: o fluxo principal continua e a DLQ é inspecionada depois.</p>

---

## Sem Docker: o simulador

<div class="flow">
<div class="box accent">5 · Testes<small>ord-7f3a → partição 0, offset 0, atraso 0</small></div>
<div class="box orange">5.5 · Escalar o consumidor<small>1 partição: a 2ª instância fica ociosa · 3 partições: 0 e 1 · 2</small></div>
<div class="box red">6 · Falhas<small>1 e-mail duplicado · atraso 3 atrás de um evento ruim · a DLQ o zera</small></div>
</div>

- As páginas embutem o tópico e o grupo do lab: mesmos nomes, mesmo hash chave → partição do cliente do Kafka.
- O play roda uma página passo a passo; os botões (POST, poll, scale, kill, `--partitions`) funcionam a qualquer momento.
- Modo **livre**: 4 instâncias em 3 partições → uma fica ociosa.

<!--
O simulador está na seção 5.5 (abrindo em "Escalar o consumidor") e na seção 6 (abrindo em "Falhas").
-->

---

## Armadilhas

<div class="warn">

**At-least-once** significa que duplicatas acontecem. O consumer deve ser **idempotente**: antes de enviar, verifique se um e-mail já foi enviado para esse `orderId`.

</div>

- Publique **depois de salvar** o pedido — nunca anuncie um pedido que não existe.
- Dentro da rede Docker, o broker é `kafka:9092`, não `localhost:9092`.
- `acks: all` só protege os dados quando há mais de um broker.
- Use o Kafka UI para conferir tópicos, mensagens e o **lag do consumer group** ao depurar.

---

## Pontos-chave

1. Use REST quando quem chama precisa da resposta agora; use **eventos** para trabalho fire-and-forget.
2. O order-service publica `OrderCreated` em `order-events` e **não conhece seus consumers**.
3. O Kafka roda em modo **KRaft** no compose (sem ZooKeeper); o **Kafka UI** mostra tópicos, mensagens e lag.
4. Spring: `KafkaTemplate.send(topic, key, event)` com serializer **JSON** e `acks: all`.
5. Python: um `KafkaConsumer` no grupo `notification-group` com **commit manual** → at-least-once.
6. Mensagens que falham vão para uma **DLQ**; os consumers devem ser **idempotentes**.
