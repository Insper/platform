# 9. Mensageria com Kafka

!!! info "Objetivo"

    Adicionar mensageria assíncrona à plataforma. Quando um pedido é criado, publique um evento `OrderCreated` no Apache Kafka. Um novo `notification-service` (Python/FastAPI) consome esse evento de forma assíncrona e simula o envio de um e-mail de confirmação — sem que o order-service saiba que o notification-service existe.

Hoje a plataforma usa chamadas REST síncronas para toda a comunicação entre serviços. Cada chamada que o order-service faz — ao account-service, ao product-service — acontece em linha, antes de a resposta ser devolvida ao cliente. Isso funciona para operações em que quem chama precisa de um resultado imediatamente. Mas algumas operações são do tipo *fire-and-forget* ("dispare e esqueça"): quando um pedido é criado, enviar um e-mail de confirmação não precisa bloquear o cliente. Este hands-on adiciona o Apache Kafka como a espinha dorsal de mensageria exatamente para esses casos.

## Slides

<div class="slides-embed">
  <iframe src="slides/kafka.pt.html" title="Slides: mensageria com Kafka" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/kafka.pt.html){:target="_blank"}

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

    O Kafka guarda os metadados do cluster (tópicos, partições, líderes) em seu próprio quórum de controllers baseado em Raft, o **KRaft**. Antes, esses metadados ficavam em um ensemble ZooKeeper separado; o Kafka 4.0 (2025) removeu completamente o suporte ao ZooKeeper. Aqui o único nó é ao mesmo tempo broker e controller (`KAFKA_PROCESS_ROLES: broker,controller`): os clientes falam com o listener `PLAINTEXT` em `kafka:9092`, e o quórum de controllers usa o listener `CONTROLLER` na porta 9093. Veja [Arquitetura Orientada a Eventos](../../classes/event_driven/index.md).

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
