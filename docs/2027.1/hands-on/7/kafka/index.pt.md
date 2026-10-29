# 1. Kafka no Compose { #1-kafka-in-compose }

Neste passo você substitui o seu `docker-compose.yaml` pelo arquivo completo deste lab, sobe os quatro
novos contêineres de infraestrutura e conhece o Kafka pela linha de comando. Todos os comandos rodam na
**raiz do seu repositório `boxoffice`**.

| Contêiner | Imagem | Porta no host | Papel |
|---|---|---|---|
| `kafka` | `apache/kafka:4.3.1` | 9094 | um broker que também é o próprio controlador (KRaft) |
| `kafka-init` | `apache/kafka:4.3.1` | — | tarefa única: cria os tópicos e termina |
| `kafka-ui` | `kafbat/kafka-ui:v1.5.0` | 8089 | navegar por tópicos, mensagens, *headers* e *lag* dos consumidores |
| `mailpit` | `axllent/mailpit:v1.31` | 8025 (web), 1025 (SMTP) | provedor de e-mail falso, com caixa de entrada e API |

## Kafka em modo KRaft { #kafka-in-kraft-mode }

O Kafka guarda os próprios metadados (tópicos, partições, líderes) em um quórum Raft de
**controladores** — o **KRaft**. O ZooKeeper não existe mais desde o Kafka 4.0. Aqui um único nó faz
os dois papéis, `broker,controller`. Esta é a parte nova do `docker-compose.yaml`:

``` yaml title="docker-compose.yaml (excerpt)"
  kafka:
    image: apache/kafka:4.3.1
    hostname: kafka
    ports:
      - "9094:9094"
    environment:
      KAFKA_NODE_ID: 1
      KAFKA_PROCESS_ROLES: broker,controller
      KAFKA_CONTROLLER_QUORUM_VOTERS: 1@kafka:9093
      KAFKA_LISTENERS: PLAINTEXT://:9092,CONTROLLER://:9093,EXTERNAL://:9094
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092,EXTERNAL://localhost:9094
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT,EXTERNAL:PLAINTEXT
      KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER
      KAFKA_INTER_BROKER_LISTENER_NAME: PLAINTEXT
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: 1
      KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS: 0
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: "false"
    healthcheck:
      test: ["CMD-SHELL", "/opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server localhost:9092 > /dev/null 2>&1"]
      interval: 10s
      timeout: 10s
      start_period: 60s      # a busy laptop can take a minute to start the broker
      retries: 20

  kafka-init:
    image: apache/kafka:4.3.1
    depends_on:
      kafka:
        condition: service_healthy
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --create --if-not-exists \
          --topic order-events --partitions 6 --replication-factor 1 &&
        /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --create --if-not-exists \
          --topic order-events-dlt --partitions 6 --replication-factor 1
    restart: "no"

  kafka-ui:
    image: kafbat/kafka-ui:v1.5.0
    depends_on:
      kafka:
        condition: service_healthy
    ports:
      - "8089:8080"
    environment:
      KAFKA_CLUSTERS_0_NAME: boxoffice
      KAFKA_CLUSTERS_0_BOOTSTRAPSERVERS: kafka:9092

  mailpit:
    image: axllent/mailpit:v1.31
    ports:
      - "8025:8025"
      - "1025:1025"
```

!!! tip "Pegue o arquivo completo"

    Rode na raiz do seu repositório `boxoffice` (substitui a versão do lab 6; guarde uma cópia se você
    a alterou):

    ``` shell
    cp docker-compose.yaml docker-compose.lab6.yaml
    curl -fsSL -o docker-compose.yaml https://insper.github.io/platform/2027.1/hands-on/7/code/docker-compose.yaml
    docker compose config --services
    ```

    Você deve ver os serviços do lab 6 mais `kafka`, `kafka-init`, `kafka-ui`, `mailpit`, `order` e
    `notification`. `order` e `notification` são construídos nos passos 2 e 3; até lá, suba só os
    serviços citados em cada comando. Apague `docker-compose.lab6.yaml` antes de commitar: o Git já
    guarda a versão do lab 6 (`git show lab6:docker-compose.yaml`).

??? example "docker-compose.yaml — o arquivo completo ao fim deste lab"

    ``` yaml title="docker-compose.yaml"
    --8<-- "docs/2027.1/hands-on/7/code/docker-compose.yaml"
    ```

Três detalhes importam:

- **Dois *listeners* de cliente.** Os contêineres chegam ao broker como `kafka:9092` (`PLAINTEXT`). Um
  programa no seu notebook (uma execução na IDE, uma CLI) usa `localhost:9094` (`EXTERNAL`). O cliente
  primeiro se conecta a qualquer endereço, depois recebe o endereço *anunciado* do líder de cada
  partição e se reconecta lá — então cada listener precisa anunciar um nome que os *seus* clientes
  consigam resolver. Trocar um pelo outro é o clássico bug "conecta e depois dá timeout". Por isso o
  Kafka é a única exceção à regra "mesma porta dentro e fora" do [lab 0](../../0/index.md): os
  serviços usam `kafka:9092`, sua máquina usa `localhost:9094`.
- **Os tópicos são criados explicitamente** (`KAFKA_AUTO_CREATE_TOPICS_ENABLE: "false"`). A criação
  automática usa o padrão do broker, 1 partição, o que limitaria em silêncio o paralelismo dos
  consumidores a 1.
- **O tópico de mensagens mortas tem tantas partições quanto o principal**: o publicador de DLT do
  Spring grava um registro que falhou no *mesmo número de partição* em `order-events-dlt`.

!!! info "Por que 6 partições?"

    Uma partição é consumida por **no máximo um consumidor do grupo** de cada vez; logo, o número de
    partições é o teto do paralelismo de consumo. Seis permitem que o grupo `notification` cresça até
    seis consumidores. Partições são baratas no começo e dolorosas de adicionar depois: aumentar o
    número de partições muda para qual partição cada chave vai, quebrando a ordem por chave das
    mensagens em trânsito.

## Suba e confira { #start-and-check }

<!-- termynal -->

``` shell
> docker compose up -d kafka kafka-init kafka-ui mailpit
 ✔ Container boxoffice-mailpit-1     Healthy
 ✔ Container boxoffice-kafka-1       Healthy
 ✔ Container boxoffice-kafka-init-1  Started
 ✔ Container boxoffice-kafka-ui-1    Started
> docker compose logs kafka-init
kafka-init-1  | Created topic order-events.
kafka-init-1  | Created topic order-events-dlt.
> docker compose exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --describe --topic order-events
Topic: order-events	TopicId: hwjrAir1Q8m_ZV4fyhnctw	PartitionCount: 6	ReplicationFactor: 1	Configs: min.insync.replicas=1
	Topic: order-events	Partition: 0	Leader: 1	Replicas: 1	Isr: 1	Elr: 	LastKnownElr:
	Topic: order-events	Partition: 1	Leader: 1	Replicas: 1	Isr: 1	Elr: 	LastKnownElr:
	Topic: order-events	Partition: 2	Leader: 1	Replicas: 1	Isr: 1	Elr: 	LastKnownElr:
	Topic: order-events	Partition: 3	Leader: 1	Replicas: 1	Isr: 1	Elr: 	LastKnownElr:
	Topic: order-events	Partition: 4	Leader: 1	Replicas: 1	Isr: 1	Elr: 	LastKnownElr:
	Topic: order-events	Partition: 5	Leader: 1	Replicas: 1	Isr: 1	Elr: 	LastKnownElr:
```

Você deve ver os quatro contêineres rodando (`docker compose ps`), seis partições em `order-events`,
o Kafka UI em `http://localhost:8089` (cluster *boxoffice* online, tópicos `order-events` e
`order-events-dlt`) e a caixa vazia do Mailpit em `http://localhost:8025`. O `TopicId` muda em cada
máquina. Se o `kafka` ficar em `starting` por mais de um minuto, veja Solução de problemas na
[visão geral](../index.md#troubleshooting).

## Um passeio de cinco minutos pelo log { #a-five-minute-tour-of-the-log }

Antes que o Spring esconda tudo, sinta como um **log** difere de uma fila. Abra dois terminais.

No terminal A, inicie um consumidor no grupo `tour`:

``` shell
docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server kafka:9092 --topic order-events --group tour \
  --formatter-property print.key=true --formatter-property print.partition=true
```

No terminal B, produza três mensagens com chave (`chave:valor`):

``` shell
docker compose exec -T kafka /opt/kafka/bin/kafka-console-producer.sh \
  --bootstrap-server kafka:9092 --topic order-events \
  --reader-property parse.key=true --reader-property key.separator=: <<'EOF'
order-1:{"hello":"first"}
order-2:{"hello":"second"}
order-1:{"hello":"third"}
EOF
```

O terminal A imprime cada mensagem com sua partição, por exemplo:

``` text
Partition:4	order-1	{"hello":"first"}
Partition:3	order-2	{"hello":"second"}
Partition:4	order-1	{"hello":"third"}
```

As duas mensagens de `order-1` caem na **mesma
partição** — o particionador padrão faz o *hash* da chave (murmur2) módulo o número de partições — e
essa é a única ordem que o Kafka promete: **por partição, portanto por chave**.

Agora pare o consumidor (++ctrl+c++) e olhe o grupo:

<!-- termynal -->

``` shell
> docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --group tour

Consumer group 'tour' has no active members.

GROUP           TOPIC           PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG             CONSUMER-ID     HOST            CLIENT-ID
tour            order-events    0          0               0               0               -               -               -
tour            order-events    1          0               0               0               -               -               -
tour            order-events    2          0               0               0               -               -               -
tour            order-events    3          1               1               0               -               -               -
tour            order-events    4          2               2               0               -               -               -
tour            order-events    5          0               0               0               -               -               -
```

As mensagens **continuam no log**: consumir não apaga. Cada grupo só guarda seu **offset** por
partição (`CURRENT-OFFSET`), e o ***lag*** = `LOG-END-OFFSET − CURRENT-OFFSET` diz quão atrasado ele
está. Volte o grupo para o início e leia tudo de novo:

``` shell
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka:9092 \
  --group tour --topic order-events --reset-offsets --to-earliest --execute
```

Essa capacidade de reprocessar é o que faz do Kafka uma boa espinha dorsal para novos consumidores (o
*analytics* pode ler todo o histórico) — e também o motivo pelo qual **todo consumidor precisa tolerar
ver uma mensagem duas vezes**.

!!! warning "Não apague as mensagens do passeio"

    As três mensagens de teste não são eventos válidos do BoxOffice. Elas serão úteis depois: no
    [passo 3](../consumer/index.md) elas são exatamente o tipo de *mensagem envenenada* que o
    consumidor precisa sobreviver. Deixe-as lá.

??? question "Pense primeiro: um grupo de consumidores com 8 instâncias em um tópico de 6 partições"

    Quantas instâncias recebem mensagens? O que as outras fazem?

    Seis. Cada partição é atribuída a um membro do grupo, então duas instâncias ficam **ociosas** (elas
    assumem se outro membro morrer). Para usar mais consumidores, o tópico precisa de mais partições.

[Próximo: Transactional outbox](../outbox/index.md){ .md-button .md-button--primary }
