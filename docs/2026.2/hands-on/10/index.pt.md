# 10. Mensageria com Kafka

!!! info "Objetivo"

    Adicionar mensageria assíncrona à plataforma com o Apache Kafka. Primeiro o **par de referência** da aula: um `producer-service` que publica o que recebe em `GET /producer/{msg}` no tópico `store-producer-example` e um `consumer-service` que lê esse tópico — dois serviços Spring Boot que nunca chamam um ao outro. Depois o mesmo padrão **na loja**: o order-service publica um evento `OrderCreated` em `order-events` e um `notification-service` o consome e envia o e-mail de confirmação, sem que o order-service saiba que ele existe.

A plataforma usa chamadas REST síncronas em toda interação entre serviços. Cada chamada que o order-service faz — ao account-service, ao product-service — acontece em linha, antes de a resposta voltar ao cliente. Isso serve para operações cujo chamador precisa do resultado agora. Outras são do tipo *fire-and-forget* ("dispare e esqueça"): enviar o e-mail de confirmação de um pedido não precisa bloquear o cliente. O Apache Kafka é a espinha dorsal de mensageria para esses casos: um produtor acrescenta uma mensagem a um **tópico**, um log durável, e responde na hora; os consumidores leem o log no seu próprio tempo.

## Slides

<div class="slides-embed">
  <iframe src="slides/kafka.html" title="Slides: mensageria com Kafka" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/kafka.html){:target="_blank"}

## 1. Arquitetura

=== "Referência: producer → consumer"

    ``` mermaid-sim
    flowchart LR
        client[Cliente] -->|"GET /producer/{msg}"| gw[Gateway]
        gw -->|REST| producer[producer-service]
        producer -->|"send\nstore-producer-example"| kafka[(Kafka)]
        kafka -->|"@KafkaListener\ngrupo store"| consumer[consumer-service]
    ```

=== "Na loja: order → notification"

    ``` mermaid-sim
    flowchart LR
        client[Cliente] -->|"POST /orders"| gw[Gateway]
        gw -->|REST| order[order-service]
        order -->|REST síncrono| account[account-service]
        order -->|REST síncrono| product[product-service]
        order -->|"Kafka (assíncrono)\norder-events"| kafka[(Kafka)]
        kafka -->|"Kafka (assíncrono)\nnotification-group"| notification[notification-service]
    ```

!!! tip "Desacoplamento"

    O produtor publica num tópico; ele não sabe quem lê. O `producer-service` nunca chama o `consumer-service` e o order-service nunca chama o notification-service. Amanhã um analytics-service pode ler `order-events` também, num grupo próprio, sem tocar numa única linha do order-service.

| Peça | Referência (seções 2–5) | Na loja (seções 6–8) |
|---|---|---|
| Produtor | `producer-service`, `GET /producer/{msg}` | order-service, depois de salvar um pedido |
| Tópico | `store-producer-example` | `order-events` |
| Chave | nenhuma | o id do pedido |
| Consumidor | `consumer-service`, grupo `store` | `notification-service`, grupo `notification-group` |
| Mensagem | `{"id": "…", "message": "…"}` | `{"id": "…", "idAccount": "…", "total": "…"}` |

---

## 2. Kafka no Docker Compose

Acrescente o broker e os dois serviços de referência ao `compose.yaml` da plataforma (a pasta `api/`, ao lado dos outros serviços). Um único nó Kafka 4 roda em modo **KRaft** — sem container do ZooKeeper.

``` { .yaml .copy .select title="compose.yaml (additions)" }
--8<-- "docs/2026.2/hands-on/10/code/compose.yaml"
```

!!! info "KRaft — sem ZooKeeper"

    O Kafka guarda os metadados do cluster (tópicos, partições, líderes) no seu próprio quórum de controladores baseado em Raft, o **KRaft**. Antes, esses metadados ficavam num ensemble separado do ZooKeeper; o Kafka 4.0 (2025) removeu o suporte ao ZooKeeper por completo. Aqui o único nó é broker e controlador ao mesmo tempo (`KAFKA_PROCESS_ROLES: broker,controller`): os clientes falam com o listener `PLAINTEXT` em `kafka:9092` e o quórum de controladores usa o listener `CONTROLLER` na porta 9093. Veja [Arquitetura Orientada a Eventos](../../classes/event_driven/index.md).

- `KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092` é o endereço que o broker entrega aos clientes: o nome do serviço dentro da rede do Docker. Dentro de um container, `localhost:9092` é o próprio container, não o broker — e o broker não publica porta nenhuma na sua máquina, por isso todo comando de Kafka abaixo roda **dentro** do container `kafka`.
- Um único broker não consegue manter mais de uma cópia dos tópicos internos: daí os três `…_REPLICATION_FACTOR: 1` / `MIN_ISR: 1`.
- Um tópico é **criado no primeiro uso** (o `auto.create.topics.enable` do broker é `true` por padrão) com `KAFKA_NUM_PARTITIONS: 1` partição. A seção 7 acrescenta partições.
- `KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS: 0` deixa um grupo de consumidores começar na hora em vez de esperar 3 s por mais membros — conveniente em desenvolvimento.

!!! tip "Fixe a imagem"

    `apache/kafka:latest` segue a versão mais nova (Kafka 4.3.1 quando esta página foi escrita). Para um build reprodutível, fixe a versão: `image: apache/kafka:4.3.1`.

---

## 3. O producer-service

Um serviço Spring Boot com um endpoint: `GET /producer/{msg}` embrulha o texto num pequeno JSON com um id aleatório e o publica em `store-producer-example`.

```
api/
    producer-service/
        src/main/java/store/kafka/producer/
            KafkaProducerConfig.java
            ProducerResource.java
            ProducerService.java
            ProducerServiceApplication.java
        src/main/resources/application.yaml
        Dockerfile
        pom.xml
```

=== "ProducerService.java"

    ``` { .java .copy .select linenums="1" title="producer-service/src/main/java/store/kafka/producer/ProducerService.java" }
    --8<-- "docs/2026.2/hands-on/10/code/producer-service/src/main/java/store/kafka/producer/ProducerService.java"
    ```

=== "KafkaProducerConfig.java"

    ``` { .java .copy .select linenums="1" title="producer-service/src/main/java/store/kafka/producer/KafkaProducerConfig.java" }
    --8<-- "docs/2026.2/hands-on/10/code/producer-service/src/main/java/store/kafka/producer/KafkaProducerConfig.java"
    ```

=== "ProducerResource.java"

    ``` { .java .copy .select linenums="1" title="producer-service/src/main/java/store/kafka/producer/ProducerResource.java" }
    --8<-- "docs/2026.2/hands-on/10/code/producer-service/src/main/java/store/kafka/producer/ProducerResource.java"
    ```

=== "ProducerServiceApplication.java"

    ``` { .java .copy .select linenums="1" title="producer-service/src/main/java/store/kafka/producer/ProducerServiceApplication.java" }
    --8<-- "docs/2026.2/hands-on/10/code/producer-service/src/main/java/store/kafka/producer/ProducerServiceApplication.java"
    ```

=== "application.yaml"

    ``` { .yaml .copy .select linenums="1" title="producer-service/src/main/resources/application.yaml" }
    --8<-- "docs/2026.2/hands-on/10/code/producer-service/src/main/resources/application.yaml"
    ```

=== "pom.xml"

    ``` { .xml .copy .select linenums="1" title="producer-service/pom.xml" }
    --8<-- "docs/2026.2/hands-on/10/code/producer-service/pom.xml"
    ```

=== "Dockerfile"

    ``` { .dockerfile .copy .select linenums="1" title="producer-service/Dockerfile" }
    --8<-- "docs/2026.2/hands-on/10/code/producer-service/Dockerfile"
    ```

- **`KafkaProducerConfig`** monta a `ProducerFactory` (onde está o broker, como transformar chave e valor em bytes: `StringSerializer` para os dois) e o `KafkaTemplate`, o objeto com que o código envia.
- **`ProducerService`** transforma o mapa em JSON com o `ObjectMapper` do Jackson e chama `kafkaTemplate.send(topic, value)`. **Não há chave**: a seção 7 mostra o que isso significa para as partições.
- **`send` é assíncrono**: ele entrega o registro ao buffer do cliente e devolve um `CompletableFuture`; o `200` do endpoint significa "entregue ao cliente do Kafka", não "gravado no Kafka". Desde o Kafka 3.0 os padrões do produtor já são os seguros — `acks=all` (o líder espera todas as réplicas em sincronia) e idempotência ligada (um retry nunca grava duplicata) — por isso a factory define só o endereço e os serializadores.

``` mermaid-sim
sequenceDiagram
    participant C as Cliente
    participant G as Gateway
    participant P as producer-service
    participant K as Kafka (store-producer-example)
    participant S as consumer-service
    C->>G: GET /producer/hello
    G->>P: GET /producer/hello (rota aberta, sem cookie)
    P->>K: send(store-producer-example, {"id": "…", "message": "hello"})
    P-->>C: 200 OK (não espera consumidor algum)
    K->>S: o registro, no próximo poll
    S->>S: registra enqueue {…}
    S->>K: confirma o offset
```

### 3.1 Pelo gateway

Acrescente a rota ao `application.yaml` do gateway, ao lado das outras:

``` { .yaml .copy .select title="gateway-service/src/main/resources/application.yaml" }
            - id: producer-service
              uri: http://producer:8080
              predicates:
                - Path=/producer/**
```

e abra-a no `RouterValidator` (veja o [Hands-on 3](../3/authorization/index.md)), para que ela não exija login:

``` { .java .copy .select title="gateway-service/src/main/java/store/gateway/security/RouterValidator.java" }
    private List<String> openApiEndpoints = List.of(
            "GET /producer/**",
            "POST /auth/register",
            "GET /auth/logout",
            "POST /auth/login"
        );
```

!!! warning "Uma rota aberta é uma demonstração"

    `GET /producer/**` deixa qualquer um publicar no tópico — tudo bem para a referência, nunca para eventos reais. E um `GET` que muda estado quebra a semântica do HTTP: um crawler ou o prefetch de um navegador publicariam mensagens. Na loja, o evento sai de `POST /orders`, uma rota protegida.

---

## 4. O consumer-service

```
api/
    consumer-service/
        src/main/java/store/kafka/consumer/
            ConsumerService.java
            ConsumerServiceApplication.java
            KafkaConsumerConfig.java
        src/main/resources/application.yaml
        Dockerfile
        pom.xml
```

=== "ConsumerService.java"

    ``` { .java .copy .select linenums="1" title="consumer-service/src/main/java/store/kafka/consumer/ConsumerService.java" }
    --8<-- "docs/2026.2/hands-on/10/code/consumer-service/src/main/java/store/kafka/consumer/ConsumerService.java"
    ```

=== "KafkaConsumerConfig.java"

    ``` { .java .copy .select linenums="1" title="consumer-service/src/main/java/store/kafka/consumer/KafkaConsumerConfig.java" }
    --8<-- "docs/2026.2/hands-on/10/code/consumer-service/src/main/java/store/kafka/consumer/KafkaConsumerConfig.java"
    ```

=== "ConsumerServiceApplication.java"

    ``` { .java .copy .select linenums="1" title="consumer-service/src/main/java/store/kafka/consumer/ConsumerServiceApplication.java" }
    --8<-- "docs/2026.2/hands-on/10/code/consumer-service/src/main/java/store/kafka/consumer/ConsumerServiceApplication.java"
    ```

=== "application.yaml"

    ``` { .yaml .copy .select linenums="1" title="consumer-service/src/main/resources/application.yaml" }
    --8<-- "docs/2026.2/hands-on/10/code/consumer-service/src/main/resources/application.yaml"
    ```

=== "pom.xml"

    ``` { .xml .copy .select linenums="1" title="consumer-service/pom.xml" }
    --8<-- "docs/2026.2/hands-on/10/code/consumer-service/pom.xml"
    ```

=== "Dockerfile"

    ``` { .dockerfile .copy .select linenums="1" title="consumer-service/Dockerfile" }
    --8<-- "docs/2026.2/hands-on/10/code/consumer-service/Dockerfile"
    ```

- **`@KafkaListener(topics = "store-producer-example", groupId = "store")`**: o Spring roda um listener container que faz poll no tópico e chama o método uma vez por registro. O método nunca chama `poll()` nem `commit()`.
- **O grupo** (`store`) é a identidade do consumidor no Kafka: o broker guarda, por grupo e por partição, o **offset confirmado** — o próximo registro que o grupo vai ler. Outro grupo lendo o mesmo tópico recebe todas as mensagens de novo, nos seus próprios offsets.
- **Quando o offset é confirmado**: o container define `enable.auto.commit=false` e, por padrão (`AckMode.BATCH`), confirma depois que o método retornou para todos os registros de um poll. Uma queda no meio faz esses registros voltarem: **at-least-once** (seção 8).
- O `pom.xml` é o do produtor com `<artifactId>consumer-service</artifactId>`: uma cópia que mantém `producer-service` gera um jar com o nome errado.

---

## 5. Rode a referência

Gere os dois jars (o `Dockerfile` copia `target/*.jar`) e suba a stack:

``` { .bash .copy .select }
cd api/producer-service && mvn clean package -DskipTests && cd ../..
cd api/consumer-service && mvn clean package -DskipTests && cd ../..
cd api
docker compose up -d --build
```

Envie duas mensagens pelo gateway (o balanceador de carga na porta 8080):

``` termynal
$ curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/producer/hello
200
$ curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/producer/world
200
```

Você deve ver cada mensagem duas vezes — publicada pelo produtor, lida pelo consumidor:

``` termynal
$ docker compose logs producer | grep queue
producer-1  | … DEBUG 1 --- [producer] [nio-8080-exec-1] store.kafka.producer.ProducerService     : queue {id=e29517a4-e00a-4ff6-9d0b-b64825763623, message=hello}
producer-1  | … DEBUG 1 --- [producer] [nio-8080-exec-3] store.kafka.producer.ProducerService     : queue {id=139b7a01-76ee-4fc4-9b65-a15467e35c81, message=world}
$ docker compose logs consumer | grep -E "assigned|enqueue"
consumer-1  | … INFO 1 --- [consumer] [ntainer#0-0-C-1] o.s.k.l.KafkaMessageListenerContainer    : store: partitions assigned: [store-producer-example-0]
consumer-1  | … DEBUG 1 --- [consumer] [ntainer#0-0-C-1] store.kafka.consumer.ConsumerService     : enqueue {id=e29517a4-e00a-4ff6-9d0b-b64825763623, message=hello}
consumer-1  | … DEBUG 1 --- [consumer] [ntainer#0-0-C-1] store.kafka.consumer.ConsumerService     : enqueue {id=139b7a01-76ee-4fc4-9b65-a15467e35c81, message=world}
```

(A ordem de `id` e `message` na linha do produtor pode mudar: `Map.of` não tem ordem fixa.)

### 5.1 Olhe dentro do Kafka

O broker traz suas ferramentas de linha de comando em `/opt/kafka/bin`. O tópico, criado no primeiro uso com uma partição:

``` termynal
$ docker compose exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --describe --topic store-producer-example
Topic: store-producer-example	TopicId: FMKKtZWTTTWB-zZHi-aYOA	PartitionCount: 1	ReplicationFactor: 1	Configs: min.insync.replicas=1
	Topic: store-producer-example	Partition: 0	Leader: 1	Replicas: 1	Isr: 1	Elr: 	LastKnownElr: 
```

As mensagens continuam lá depois de lidas — um consumidor só move o seu offset:

``` termynal
$ docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server kafka:9092 --topic store-producer-example --from-beginning --max-messages 2 --formatter-property print.partition=true --formatter-property print.offset=true
Partition:0	Offset:0	{"id":"e29517a4-e00a-4ff6-9d0b-b64825763623","message":"hello"}
Partition:0	Offset:1	{"id":"139b7a01-76ee-4fc4-9b65-a15467e35c81","message":"world"}
Processed a total of 2 messages
```

E o grupo: onde o `store` está, por partição. O **atraso** (*lag*) é o offset final do log menos o offset confirmado — as mensagens esperando.

``` { .bash .copy .select }
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --group store
```

### 5.2 O consumidor estava fora do ar

Pare o consumidor, publique três mensagens e olhe o grupo:

``` termynal
$ docker compose stop consumer
$ for m in a b c; do curl -s -o /dev/null http://localhost:8080/producer/$m; done
$ docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --group store
Consumer group 'store' has no active members.

GROUP  TOPIC                  PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG  CONSUMER-ID  HOST  CLIENT-ID
store  store-producer-example 0          2               5               3    -            -     -
```

O produtor não percebeu — ele respondeu `200` três vezes. Suba o consumidor de novo: ele retoma no offset 2 e registra `enqueue` para `a`, `b` e `c`; o `--describe` mostra atraso `0`. Com REST, essas três chamadas teriam falhado; com um log no meio, o consumidor simplesmente alcança o atraso.

!!! failure "Solução de problemas"

    | Sintoma | Causa e correção |
    |---|---|
    | `Connection to node -1 (kafka/…:9092) could not be established` nos primeiros segundos | o broker ainda está subindo; o cliente tenta de novo sozinho |
    | `{store-producer-example=UNKNOWN_TOPIC_OR_PARTITION}` uma vez, no início | o tópico ainda não existe; ele é criado nessa primeira requisição |
    | `401` em `/producer/hello` | a rota falta em `openApiEndpoints` no `RouterValidator` |
    | `404` em `/producer/hello` | o gateway não tem a rota `producer-service` ou não foi reconstruído |
    | `COPY target/*.jar` falha no build | rode `mvn clean package` nesse serviço antes |
    | o jar do consumidor se chama `producer-service-1.0.0.jar` | o `pom.xml` do consumidor ainda tem o `artifactId` do produtor |

---

## 6. Na loja: order-events

A referência mostra a mecânica; agora a plataforma a usa. Quando um pedido é salvo, o order-service publica `OrderCreated` em `order-events`; um novo `notification-service`, escrito exatamente como o `consumer-service`, envia o e-mail de confirmação (aqui: uma linha de log).

### 6.1 O order-service publica

Acrescente o `spring-kafka` ao `pom.xml` do order-service e o broker ao `application.yaml` dele:

``` { .xml .copy .select title="order-service/pom.xml" }
<dependency>
    <groupId>org.springframework.kafka</groupId>
    <artifactId>spring-kafka</artifactId>
</dependency>
```

``` { .yaml .copy .select title="order-service/src/main/resources/application.yaml" }
spring:
  kafka:
    bootstrap-servers: kafka:9092
```

Depois, duas classes no pacote do order-service — o `KafkaProducerConfig` do produtor sem mudanças (só o pacote) e um publicador como o `ProducerService`, agora **com chave**:

=== "OrderEventPublisher.java"

    ``` { .java .copy .select linenums="1" title="order-service/src/main/java/store/order/OrderEventPublisher.java" }
    --8<-- "docs/2026.2/hands-on/10/code/order-service/src/main/java/store/order/OrderEventPublisher.java"
    ```

=== "KafkaProducerConfig.java"

    ``` { .java .copy .select linenums="1" title="order-service/src/main/java/store/order/KafkaProducerConfig.java" }
    --8<-- "docs/2026.2/hands-on/10/code/order-service/src/main/java/store/order/KafkaProducerConfig.java"
    ```

No `OrderService`, injete o publicador e chame-o **depois** de salvar o pedido — nunca anuncie um pedido que não existe (adapte os acessores ao seu `Order`):

``` { .java .copy .select title="order-service: OrderService.java" }
@Autowired
private OrderEventPublisher orderEventPublisher;

// in create(), after saving:
orderEventPublisher.orderCreated(order.id(), idAccount, order.total());
```

### 6.2 O notification-service

Uma cópia do `consumer-service` com três mudanças: o pacote, o grupo (`notification-group`) e o listener, que lê `order-events`.

```
api/
    notification-service/
        src/main/java/store/notification/
            KafkaConsumerConfig.java
            NotificationService.java
            NotificationServiceApplication.java
        src/main/resources/application.yaml
        Dockerfile
        pom.xml
```

=== "NotificationService.java"

    ``` { .java .copy .select linenums="1" title="notification-service/src/main/java/store/notification/NotificationService.java" }
    --8<-- "docs/2026.2/hands-on/10/code/notification-service/src/main/java/store/notification/NotificationService.java"
    ```

=== "KafkaConsumerConfig.java"

    ``` { .java .copy .select linenums="1" title="notification-service/src/main/java/store/notification/KafkaConsumerConfig.java" }
    --8<-- "docs/2026.2/hands-on/10/code/notification-service/src/main/java/store/notification/KafkaConsumerConfig.java"
    ```

=== "NotificationServiceApplication.java"

    ``` { .java .copy .select linenums="1" title="notification-service/src/main/java/store/notification/NotificationServiceApplication.java" }
    --8<-- "docs/2026.2/hands-on/10/code/notification-service/src/main/java/store/notification/NotificationServiceApplication.java"
    ```

=== "application.yaml"

    ``` { .yaml .copy .select linenums="1" title="notification-service/src/main/resources/application.yaml" }
    --8<-- "docs/2026.2/hands-on/10/code/notification-service/src/main/resources/application.yaml"
    ```

=== "pom.xml"

    ``` { .xml .copy .select linenums="1" title="notification-service/pom.xml" }
    --8<-- "docs/2026.2/hands-on/10/code/notification-service/pom.xml"
    ```

=== "Dockerfile"

    ``` { .dockerfile .copy .select linenums="1" title="notification-service/Dockerfile" }
    --8<-- "docs/2026.2/hands-on/10/code/notification-service/Dockerfile"
    ```

``` { .yaml .copy .select title="compose.yaml (addition)" }
--8<-- "docs/2026.2/hands-on/10/code/compose.notification.yaml"
```

### 6.3 Crie um pedido

Gere o order-service e o notification-service (`mvn clean package -DskipTests` em cada um), rode `docker compose up -d --build`, faça login e crie um pedido (veja o [Hands-on 3](../3/authorization/index.md) para o cookie):

``` { .bash .copy .select }
curl -c cookies.txt -X POST http://localhost:8080/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "acme@insper.edu.br", "password": "123@321"}'
curl -b cookies.txt -X POST http://localhost:8080/orders \
  -H "Content-Type: application/json" \
  -d '{"items": [{"idProduct": "0195abfb-7074-73a9-9d26-b4b9fbaab0a8", "quantity": 2}]}'
```

O pedido volta com `201` na hora. Você deve ver o e-mail no notification-service:

``` termynal
$ docker compose logs notification | grep NotificationService
notification-1  | … INFO 1 --- [notification] [ntainer#0-0-C-1] store.notification.NotificationService   : sending confirmation email: order 0195ac33-73e5-7cb3-90ca-7b5e7e549569 (account 0195abf8-…, total 20.24)
```

A requisição acontece assim — a parte síncrona para o cliente, o e-mail depois, no tempo do consumidor:

``` mermaid-sim
sequenceDiagram
    participant C as Cliente
    participant O as order-service
    participant DB as Banco de dados
    participant K as Kafka (order-events)
    participant N as notification-service
    C->>O: POST /orders
    O->>O: chamadas REST ao account-service e ao product-service
    O->>DB: salva o pedido
    O->>K: send(order-events, chave = id do pedido, evento)
    O-->>C: 201 CREATED (não espera o e-mail)
    K->>N: OrderCreated, no próximo poll
    N->>N: registra o e-mail de confirmação
    N->>K: confirma o offset
```

---

## 7. Partições e grupos de consumidores

Um tópico é dividido em **partições**. Um registro com chave vai para a partição `hash(chave) % partições` (murmur2), então todos os eventos de um pedido ficam em ordem numa partição. Dentro de um grupo de consumidores, cada partição é lida por **um** membro por vez e o Kafka guarda o offset confirmado por partição. Quando um membro entra ou sai, o grupo **rebalanceia**: as partições mudam de dono e o novo dono retoma no offset confirmado.

`order-events` foi criado com `KAFKA_NUM_PARTITIONS: 1`. Suba um segundo notification-service e olhe o grupo:

``` { .bash .copy .select }
docker compose up -d --scale notification=2
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --group notification-group --members
```

Um membro mostra `#PARTITIONS 1`, o outro `0`: a segunda instância está no grupo sem nada para ler. Acrescente partições — o Kafka consegue acrescentá-las, nunca removê-las:

``` { .bash .copy .select }
docker compose exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --alter --topic order-events --partitions 3
```

Quando os clientes atualizam os metadados (até cinco minutos, `metadata.max.age.ms`; `docker compose restart notification order` torna imediato), o grupo rebalanceia: uma instância lê as partições 0 e 1, a outra a partição 2 (o range assignor, a primeira estratégia do cliente Java). Crie alguns pedidos e rode o `--describe` de novo: cada partição mostra o seu `CURRENT-OFFSET`, `LOG-END-OFFSET` e `LAG`.

``` mermaid-sim
flowchart LR
    os["order-service\nchave = id do pedido"]
    subgraph topic ["order-events"]
        p0["partição 0"]
        p1["partição 1"]
        p2["partição 2"]
    end
    subgraph group ["notification-group"]
        n1["notification-1"]
        n2["notification-2"]
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

O número de partições limita o paralelismo de um grupo. Um grupo diferente (um analytics-service, por exemplo) lê todas as mensagens de forma independente, nos seus próprios offsets.

!!! example "Sem chave, as partições não espalham o trabalho"

    Faça o mesmo com a referência: `--partitions 3` em `store-producer-example`, `docker compose up -d --scale consumer=2`, reinicie os dois serviços e envie nove mensagens com `curl`. As nove caem numa **única** partição (na nossa rodada, a partição 1: offsets 0 a 8), então um consumidor trabalha e o outro fica ocioso. Um registro sem chave vai para uma partição escolhida pelo particionador *sticky* do produtor, que enche uma partição antes de passar à próxima (KIP-794, uma *Kafka Improvement Proposal*) — bom para formar lotes, inútil para espalhar um fluxo pequeno de mensagens. Uma chave espalha a carga **e** mantém em ordem os eventos de cada chave: é por isso que `order-events` usa o id do pedido.

<div class="csim" data-sim="order-events" data-script="scale"></div>

!!! tip "Experimente"

    O simulador começa onde começa a parte da loja no lab: `order-events` com 1 partição, um notification-service no `notification-group`; play ou → roda uma página e os botões funcionam a qualquer momento. Em **7 Partições e grupos**, seis pedidos caem na partição 0 e uma segunda instância não recebe nada; depois de `--partitions 3`, notification-1 lê as partições 0 e 1, notification-2 lê a partição 2 e os seis pedidos seguintes se dividem em 2, 2 e 2 pela chave. No modo **livre**, escale para 4 instâncias com 3 partições e veja uma ficar ociosa.

---

## 8. Falhas: duplicatas e mensagens ruins

### 8.1 At-least-once

O container confirma o offset **depois** que o listener retorna. Se a instância morre entre enviar o e-mail e o commit, o offset nunca andou: quem ler essa partição depois — a mesma instância após reiniciar ou outra após o rebalanceamento — recebe a mensagem de novo e envia o e-mail uma segunda vez.

``` mermaid-sim
sequenceDiagram
    participant K as Kafka (order-events)
    participant N as notification-service
    K->>N: registro no offset 0
    N->>N: envia o e-mail
    N-xK: morto antes do commit
    Note over K,N: o offset 0 nunca foi confirmado
    K->>N: depois do reinício, offset 0 de novo
    N->>N: o mesmo e-mail uma segunda vez
    N->>K: commit, o grupo agora aponta para o offset 1
```

!!! warning "Torne o consumidor idempotente"

    O Kafka entrega **pelo menos uma vez**: uma mensagem pode chegar duas vezes. Processar o mesmo evento duas vezes precisa dar o mesmo resultado que uma vez. Para o notification-service: registre os ids de pedido já notificados num armazenamento **durável** — uma tabela com o id do pedido como chave primária, `INSERT … ON CONFLICT DO NOTHING` — e envie o e-mail só quando o insert acrescentou uma linha. Um conjunto em memória não ajuda: ele some justamente na queda que causa a reentrega.

### 8.2 Uma mensagem que não pode ser processada

Publique algo que não é JSON direto no tópico, com o console producer:

``` { .bash .copy .select }
echo 'oops' | docker compose exec -T kafka /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server kafka:9092 --topic order-events
```

O `readValue` lança exceção em toda tentativa. Sem um error handler próprio, o container usa o `DefaultErrorHandler` do Spring Kafka: ele tenta o registro **10 vezes** sem pausa, registra um `ERROR` e **confirma o offset depois dele**:

``` termynal
$ docker compose logs notification | grep -E "ERROR|Caused by"
notification-1  | … ERROR 1 --- [notification] [ntainer#0-0-C-1] o.s.kafka.listener.DefaultErrorHandler   : Backoff FixedBackOffExecution[interval=0, currentAttempts=10, maxAttempts=9] exhausted for order-events-0@1
notification-1  | Caused by: tools.jackson.core.exc.StreamReadException: Unrecognized token 'oops': was expecting (JSON String, Number, Array, Object or token 'null', 'true' or 'false')
```

O fluxo não trava — os próximos pedidos são processados e o atraso volta a `0` — mas a mensagem ruim **sumiu**: uma linha de log é tudo o que sobra. Para um pedido cujo evento tinha um bug, é um cliente que nunca recebe o e-mail.

### 8.3 Um dead-letter topic

Um **dead-letter topic** (DLT, "tópico de mensagens mortas") guarda as mensagens que falharam, para alguém inspecionar, corrigir e reprocessar. Troque o `KafkaConsumerConfig` do notification-service por este: um `KafkaTemplate` para publicar e um error handler que tenta **3 vezes, a 1 s uma da outra**, e depois entrega o registro a um `DeadLetterPublishingRecoverer`:

``` { .java .copy .select linenums="1" title="notification-service/src/main/java/store/notification/KafkaConsumerConfig.java" }
--8<-- "docs/2026.2/hands-on/10/code/dlt/KafkaConsumerConfig.java"
```

Por padrão o recoverer grava em `<tópico>-dlt` **na mesma partição** do original, então o DLT precisaria de tantas partições quanto `order-events`; o resolver acima devolve a partição `-1` e deixa o Kafka escolher. Reconstrua, publique `oops` de novo e leia o DLT:

``` termynal
$ docker compose logs notification | grep "not yet recovered"
notification-1  | … INFO 1 --- [notification] [ntainer#0-0-C-1] o.s.k.l.KafkaMessageListenerContainer    : Record in retry and not yet recovered
notification-1  | … INFO 1 --- [notification] [ntainer#0-0-C-1] o.s.k.l.KafkaMessageListenerContainer    : Record in retry and not yet recovered
$ docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server kafka:9092 --topic order-events-dlt --from-beginning --max-messages 1 --formatter-property print.offset=true
Offset:0	oops
Processed a total of 1 messages
```

``` mermaid-sim
flowchart LR
    m["registro de\norder-events"] --> p{"orderCreated()"}
    p -->|ok| c["commit"]
    p -->|"exceção\n(3 tentativas, a 1 s)"| d["DeadLetterPublishingRecoverer\n→ order-events-dlt"]
    d --> c
    c --> n["próximo registro"]
    d -.->|"inspecionado e reprocessado depois"| ops["operações"]
```

De um jeito ou de outro, o offset avança e o fluxo principal continua; com o DLT, nada se perde. (O recoverer também acrescenta headers ao registro do DLT — o tópico, a partição e o offset originais e a exceção — que `--formatter-property print.headers=true` mostra.)

<div class="csim" data-sim="order-events" data-script="failures"></div>

!!! tip "Experimente"

    O simulador refaz esta seção, um registro por poll. Um kill antes do commit envia 1 e-mail duplicado; o consumidor idempotente pula a repetição. Com o error handler padrão, uma mensagem ruim é tentada 10 vezes e pulada: o atraso volta a 0 e 1 mensagem se perde. Com o dead-letter topic, a mensagem ruim seguinte termina em `order-events-dlt` depois de 3 tentativas e nada se perde.

---

## 9. Checklist

- [ ] Kafka (modo KRaft) acrescentado ao `compose.yaml`
- [ ] o `producer-service` publica `GET /producer/{msg}` em `store-producer-example`; a rota está no gateway e aberta no `RouterValidator`
- [ ] o `consumer-service` registra `enqueue` para toda mensagem; `kafka-consumer-groups --describe --group store` mostra atraso `0`
- [ ] com o consumidor parado, o atraso cresce; de volta, ele alcança
- [ ] o order-service publica `OrderCreated` em `order-events`, com o id do pedido como chave, depois de salvar
- [ ] o `notification-service` (grupo `notification-group`) registra o e-mail de confirmação de um pedido novo
- [ ] com 3 partições, duas instâncias do notification dividem o trabalho
- [ ] uma mensagem ruim termina em `order-events-dlt`; idempotência entendida

[Próximo: Quiz](quiz.md){ .md-button .md-button--primary }
