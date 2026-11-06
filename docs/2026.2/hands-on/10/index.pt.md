# 10. Mensageria com Kafka

!!! info "Objetivo"

    Adicionar mensageria assíncrona à plataforma. Quando um pedido é criado, publique um evento `OrderCreated` no Apache Kafka. Um novo `notification-service` (Python/FastAPI) consome esse evento de forma assíncrona e simula o envio de um e-mail de confirmação — sem que o order-service saiba que o notification-service existe.

Hoje a plataforma usa chamadas REST síncronas para toda a comunicação entre serviços. Cada chamada que o order-service faz — ao account-service, ao product-service — acontece em linha, antes de a resposta ser devolvida ao cliente. Isso funciona para operações em que quem chama precisa de um resultado imediatamente. Mas algumas operações são do tipo *fire-and-forget* ("dispare e esqueça"): quando um pedido é criado, enviar um e-mail de confirmação não precisa bloquear o cliente. Este hands-on adiciona o Apache Kafka como a espinha dorsal de mensageria exatamente para esses casos.

## Slides

<div class="slides-embed">
  <iframe src="slides/kafka.html" title="Slides: mensageria com Kafka" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/kafka.html){:target="_blank"}

## 1. Arquitetura

=== "Antes"

    ``` mermaid-sim
    flowchart LR
        client[Cliente] -->|REST| gw[Gateway]
        gw -->|REST| order[order-service]
        order -->|REST síncrono| account[account-service]
        order -->|REST síncrono| product[product-service]
    ```

=== "Depois"

    ``` mermaid-sim
    flowchart LR
        client[Cliente] -->|REST| gw[Gateway]
        gw -->|REST| order[order-service]
        order -->|REST síncrono| account[account-service]
        order -->|REST síncrono| product[product-service]
        order -->|"Kafka (assíncrono)\norder-events"| kafka[(Kafka)]
        kafka -->|"Kafka (assíncrono)"| notification[notification-service]
    ```

!!! tip "Desacoplamento"

    O order-service publica em um tópico chamado `order-events`. Ele não sabe nada sobre o notification-service. Amanhã você poderia adicionar um analytics-service consumindo o mesmo tópico sem mexer em uma única linha do código do order-service.

---

## 2. Docker Compose — Adicionando o Kafka

Adicione o Kafka e o Kafka UI ao `docker-compose.yml`. Um único nó Kafka 4 roda em modo **KRaft** — sem container do ZooKeeper. O Kafka UI oferece uma interface no navegador para inspecionar tópicos e mensagens durante o desenvolvimento.

=== "Acréscimos ao docker-compose.yml"

    ``` { .yaml .copy .select }
      kafka:
        image: apache/kafka:4.3.1
        ports:
          - "9092:9092"
        environment:
          # KRaft combined mode: this single node is both broker and controller
          KAFKA_NODE_ID: 1
          KAFKA_PROCESS_ROLES: broker,controller
          KAFKA_CONTROLLER_QUORUM_VOTERS: 1@kafka:9093
          KAFKA_LISTENERS: PLAINTEXT://:9092,CONTROLLER://:9093
          KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
          KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT
          KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER
          KAFKA_INTER_BROKER_LISTENER_NAME: PLAINTEXT
          # single broker: internal topics cannot have more than 1 replica
          KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
          KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: 1
          KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: 1
          KAFKA_AUTO_CREATE_TOPICS_ENABLE: "true"

      kafka-ui:
        image: provectuslabs/kafka-ui:latest
        depends_on:
          - kafka
        ports:
          - "8090:8080"
        environment:
          KAFKA_CLUSTERS_0_NAME: local
          KAFKA_CLUSTERS_0_BOOTSTRAPSERVERS: kafka:9092
    ```

!!! info "KRaft — sem ZooKeeper"

    O Kafka guarda os metadados do cluster (tópicos, partições, líderes) em seu próprio quórum de controllers baseado em Raft, o **KRaft**. Antes, esses metadados ficavam em um ensemble ZooKeeper separado; o Kafka 4.0 (2025) removeu completamente o suporte ao ZooKeeper. Aqui o único nó é ao mesmo tempo broker e controller (`KAFKA_PROCESS_ROLES: broker,controller`): os clientes falam com o listener `PLAINTEXT` em `kafka:9092` e o quórum de controllers usa o listener `CONTROLLER` na porta 9093. Veja [Arquitetura Orientada a Eventos](../../classes/event_driven/index.md).

!!! note "Kafka UI"

    Acesse o Kafka UI em `http://localhost:8090`. Você pode navegar pelos tópicos, inspecionar mensagens e monitorar o lag dos consumer groups — essencial para depurar durante o desenvolvimento.

---

## 3. Order Service — Publicando eventos

### 3.1 Dependência

Adicione `spring-kafka` ao `pom.xml` do order-service:

``` { .xml .copy .select }
<dependency>
    <groupId>org.springframework.kafka</groupId>
    <artifactId>spring-kafka</artifactId>
</dependency>
```

### 3.2 Record do evento

Crie `OrderCreatedEvent.java` no pacote `store.order`:

``` { .java .copy .select }
package store.order;

public record OrderCreatedEvent(
    String orderId,
    String customerId,
    Double totalAmount,
    String timestamp
) {}
```

### 3.3 Configuração do producer Kafka

Adicione o seguinte ao `application.yaml`:

``` { .yaml .copy .select }
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

`kafka:9092` é o nome do broker dentro da rede do Docker: dentro de um container, `localhost:9092` é o próprio container, não o broker.

!!! tip "acks=all"

    Definir `acks=all` significa que o broker Kafka vai esperar que todas as réplicas sincronizadas (*in-sync replicas*) confirmem a escrita antes de confirmá-la. Em um ambiente de desenvolvimento com um único broker isso não tem efeito, mas em produção evita perda de dados durante o failover de um broker.

### 3.4 Publisher

Crie `OrderEventPublisher.java`:

``` { .java .copy .select }
package store.order;

import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;
import lombok.RequiredArgsConstructor;
import java.time.Instant;

@Component
@RequiredArgsConstructor
public class OrderEventPublisher {

    private final KafkaTemplate<String, OrderCreatedEvent> kafkaTemplate;

    public void publishOrderCreated(Order order) {
        var event = new OrderCreatedEvent(
            order.getId().toString(),
            order.getCustomerId(),
            order.getTotalAmount(),
            Instant.now().toString()
        );
        kafkaTemplate.send("order-events", order.getId().toString(), event);
    }
}
```

### 3.5 Chamando o publisher

Em `OrderService.java`, injete o `OrderEventPublisher` e chame-o depois de salvar o pedido:

``` { .java .copy .select }
// After saving:
eventPublisher.publishOrderCreated(savedOrder);
```

Publique **depois** de salvar: nunca anuncie um pedido que não existe. A requisição então segue assim — a parte síncrona para o cliente, o e-mail depois, no tempo do consumidor:

``` mermaid-sim
sequenceDiagram
    participant C as Cliente
    participant O as order-service
    participant DB as Banco de dados
    participant K as Kafka (order-events)
    participant N as notification-service
    C->>O: POST /orders
    O->>O: chamadas REST a account-service e product-service
    O->>DB: salva o pedido
    O->>K: send(order-events, chave = orderId, evento)
    O-->>C: 201 CREATED (não espera o e-mail)
    K->>N: OrderCreated, no próximo poll
    N->>N: registra o e-mail de confirmação
    N->>K: confirma o offset
```

---

## 4. Notification Service (Python / FastAPI)

Um novo microsserviço em Python que consome `order-events` e registra no log uma notificação de e-mail simulada.

### 4.1 Estrutura de arquivos

```
notification-service/
    main.py
    Dockerfile
    requirements.txt
```

### 4.2 Código

=== "requirements.txt"

    ``` { .text .copy .select }
    fastapi==0.110.0
    kafka-python==2.3.2
    uvicorn==0.29.0
    ```

=== "main.py"

    ``` { .python .copy .select linenums="1" }
    from fastapi import FastAPI
    from kafka import KafkaConsumer
    import json, threading, logging

    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

    app = FastAPI()

    def consume():
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
            logger.info(
                f"[NOTIFICATION] Order {event['orderId']} for customer "
                f"{event['customerId']} — sending confirmation email "
                f"(total: {event['totalAmount']})"
            )
            consumer.commit()

    @app.on_event("startup")
    def startup_event():
        thread = threading.Thread(target=consume, daemon=True)
        thread.start()

    @app.get("/health")
    def health():
        return {"status": "up"}
    ```

=== "Dockerfile"

    ``` { .dockerfile .copy .select }
    FROM python:3.12-slim
    WORKDIR /app
    COPY requirements.txt .
    RUN pip install --no-cache-dir -r requirements.txt
    COPY main.py .
    CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
    ```

Adicione o notification-service ao `docker-compose.yml`:

``` { .yaml .copy .select }
  notification-service:
    build: ./notification-service
    depends_on:
      - kafka
    environment:
      - PYTHONUNBUFFERED=1
```

!!! note "enable_auto_commit=False"

    O commit manual (`consumer.commit()`) garante que o offset só avança depois que a mensagem foi processada com sucesso. Se o serviço cair no meio do processamento, ele vai consumir a mensagem de novo ao reiniciar — semântica de entrega *at-least-once* (pelo menos uma vez).

``` mermaid-sim
sequenceDiagram
    participant K as Kafka (order-events)
    participant N as notification-service
    K->>N: mensagem no offset 0
    N->>N: envia o e-mail
    N-xK: cai antes do commit()
    Note over K,N: o offset 0 nunca foi confirmado
    K->>N: depois do reinício, o offset 0 de novo
    N->>N: o mesmo e-mail uma segunda vez
    N->>K: commit(), o grupo agora aponta para o offset 1
```

---

## 5. Testes

### 5.1 Suba tudo

``` termynal
$ docker compose up --build -d
$ docker compose ps
NAME                    STATUS
kafka                   running
kafka-ui                running
notification-service    running
order-service           running
```

### 5.2 Crie um pedido

``` termynal
$ curl -s -X POST http://localhost:8080/orders \
    -H "Content-Type: application/json" \
    -d '{"customerId":"cust-42","items":[{"productId":"p1","quantity":2}]}' \
    | jq .
{
  "id": "ord-7f3a",
  "status": "CREATED",
  "totalAmount": 49.98
}
```

### 5.3 Verifique no Kafka UI

Abra `http://localhost:8090` e navegue até **Topics → order-events → Messages**. Você deve ver o evento `OrderCreated` com `orderId: ord-7f3a`.

### 5.4 Verifique a notificação

``` termynal
$ docker compose logs notification-service
notification-service  | INFO: [NOTIFICATION] Order ord-7f3a for customer cust-42 — sending confirmation email (total: 49.98)
```

### 5.5 Escale o notification-service

Um tópico é dividido em **partições**. A chave escolhe a partição (um hash do `orderId`, módulo o número de partições), então todos os eventos com a mesma chave ficam em ordem numa partição. Dentro de um grupo de consumidores (*consumer group*), cada partição é lida por **um** membro por vez e o Kafka guarda o offset confirmado de cada partição. Quando um membro entra ou sai, o grupo **rebalanceia**: as partições mudam de dono e o novo dono recomeça no offset confirmado. O atraso (*lag*) é o offset final do log menos o offset confirmado.

`order-events` foi criado automaticamente na primeira publicação com o padrão do broker, **1 partição** (o compose não define `KAFKA_NUM_PARTITIONS`). Suba uma segunda instância e olhe o grupo:

``` { .bash .copy .select }
docker compose up -d --scale notification-service=2
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --group notification-group
```

Só um consumidor é dono da partição 0: a segunda instância está no grupo sem nada para ler. Acrescente partições — o Kafka pode acrescentá-las, nunca removê-las:

``` { .bash .copy .select }
docker compose exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --alter --topic order-events --partitions 3
```

Quando os clientes atualizam os metadados (até cinco minutos, `metadata.max.age.ms`; `docker compose restart notification-service order-service` torna isso imediato), o grupo rebalanceia e as duas instâncias trabalham. Crie alguns pedidos e rode `--describe` de novo: cada partição mostra `CURRENT-OFFSET`, `LOG-END-OFFSET` e `LAG`.

``` mermaid-sim
flowchart LR
    os["order-service\nchave = orderId"]
    subgraph topic ["order-events"]
        p0["partição 0"]
        p1["partição 1"]
        p2["partição 2"]
    end
    subgraph group ["notification-group"]
        n1["notification-service-1"]
        n2["notification-service-2"]
    end
    os --> p0
    os --> p1
    os --> p2
    p0 --> n1
    p1 --> n1
    p2 --> n2
    p0 & p1 & p2 -.->|"outro grupo recebe todas as mensagens"| an["analytics-group"]
```

| Instâncias no `notification-group` | Com 1 partição (o lab) | Com 3 partições |
|---|---|---|
| 1 | ✅ lê a partição 0 | ✅ lê 0, 1 e 2 |
| 2 | ⚠️ uma instância fica ociosa | ✅ 0 e 1 · 2 |
| 3 | ⚠️ duas instâncias ficam ociosas | ✅ uma partição cada |
| 4 | ⚠️ três instâncias ficam ociosas | ⚠️ uma instância fica ociosa |

O número de partições limita o paralelismo de um grupo. Um grupo diferente (um analytics-service, por exemplo) lê todas as mensagens de forma independente, com os próprios offsets.

<div class="csim" data-sim="order-events" data-script="scale"></div>

!!! tip "Experimente"

    O simulador começa onde o lab começa: `order-events` criado automaticamente com 1 partição, um notification-service no `notification-group`; play ou → roda uma página e os botões funcionam a qualquer momento. Em **5.5 Escalar o consumidor**, seis pedidos caem na partição 0 e uma segunda instância não recebe nada; depois de `--partitions 3`, notification-service-1 lê as partições 0 e 1, notification-service-2 lê a partição 2 e os seis pedidos seguintes se dividem em 2, 2 e 2 pela chave. Em **6 Falhas**, um kill antes de `consumer.commit()` envia 1 e-mail duplicado, o consumidor idempotente pula a repetição e, sem o try/except, um evento ruim para o consumidor enquanto o atraso cresce para 3; com a DLQ ele termina em `order-events-dlq` e o atraso cai para 0. No modo **livre**, escale para 4 instâncias com 3 partições e veja uma ficar ociosa.

---

## 6. Confiabilidade — Dead Letter Queue

Quando um consumer falha repetidamente ao processar uma mensagem, ela deve ir para uma DLQ em vez de travar o fluxo. O padrão de DLQ manual em Python publica os eventos que falharam em um tópico separado, `order-events-dlq`, em vez de derrubar o serviço:

``` { .python .copy .select }
try:
    process_event(event)
    consumer.commit()
except Exception as e:
    logger.error(f"Failed to process {event['orderId']}: {e} — sending to DLQ")
    dlq_producer.send("order-events-dlq", value=event)
    consumer.commit()
```

Nos dois casos o offset avança: o fluxo principal continua e a DLQ é inspecionada (e reprocessada) depois.

``` mermaid-sim
flowchart LR
    m["mensagem de\norder-events"] --> p{"process_event"}
    p -->|ok| c["consumer.commit()"]
    p -->|exceção| d["envia para\norder-events-dlq"]
    d --> c
    c --> n["próxima mensagem"]
    d -.->|"inspecionada e reprocessada depois"| ops["operações"]
```

Sem o try/except (o código da seção 4), a exceção encerra a thread consume: o `/health` ainda responde `up`, mas o offset não anda mais e o atraso cresce atrás da mensagem ruim. Depois de `max.poll.interval.ms` (cinco minutos) o Kafka entrega a partição a outro membro — que encontra a mesma mensagem.

<div class="csim" data-sim="order-events" data-script="failures"></div>

!!! tip "Experimente"

    O simulador começa onde o lab começa: `order-events` criado automaticamente com 1 partição, um notification-service no `notification-group`; play ou → roda uma página e os botões funcionam a qualquer momento. Em **5.5 Escalar o consumidor**, seis pedidos caem na partição 0 e uma segunda instância não recebe nada; depois de `--partitions 3`, notification-service-1 lê as partições 0 e 1, notification-service-2 lê a partição 2 e os seis pedidos seguintes se dividem em 2, 2 e 2 pela chave. Em **6 Falhas**, um kill antes de `consumer.commit()` envia 1 e-mail duplicado, o consumidor idempotente pula a repetição e, sem o try/except, um evento ruim para o consumidor enquanto o atraso cresce para 3; com a DLQ ele termina em `order-events-dlq` e o atraso cai para 0. No modo **livre**, escale para 4 instâncias com 3 partições e veja uma ficar ociosa.

!!! warning "Entrega at-least-once"

    O Kafka garante entrega *at-least-once* — uma mensagem pode ser entregue mais de uma vez (por exemplo, depois que um consumer cai antes do commit). A lógica do seu consumer deve ser **idempotente**: processar o mesmo evento duas vezes deve produzir o mesmo resultado que processá-lo uma vez. No notification service, isso significa verificar se um e-mail já foi enviado para aquele `orderId` antes de enviá-lo de novo.

---

## 7. Checklist

- [ ] Kafka (modo KRaft) + Kafka UI adicionados ao `docker-compose.yml`
- [ ] Record `OrderCreatedEvent` criado no order-service
- [ ] Dependência `spring-kafka` adicionada e `application.yaml` configurado
- [ ] `OrderEventPublisher` publica em `order-events` depois de salvar
- [ ] notification-service consome os eventos e registra as confirmações no log
- [ ] Kafka UI mostra o evento depois de criar um pedido
- [ ] Padrão de DLQ compreendido (consumer idempotente)

[Próximo: Quiz](quiz.md){ .md-button .md-button--primary }
