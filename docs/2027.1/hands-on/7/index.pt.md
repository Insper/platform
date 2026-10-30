# 7. Mensageria Assíncrona { #7-async-messaging }

!!! info "Objetivo"

    Tirar o trabalho lento e frágil do caminho da requisição no BoxOffice. O serviço `order` registra
    cada pedido e um evento `OrderPlaced` **na mesma transação do banco** (*transactional outbox*); um
    *relay* publica o evento no **Kafka**; o serviço `notification` o consome de forma **idempotente**,
    envia o e-mail e estaciona mensagens envenenadas em um **tópico de mensagens mortas** (DLT). Por
    fim, uma **sala de espera** enfileira a multidão da venda relâmpago para que só entrem tantos fãs
    quanto o sistema consegue atender.

São 10:00 e o show no estádio abre as vendas. Cada `POST /orders` aceito pelo serviço `order` também
precisa gerar um e-mail de confirmação. Se `order` chamar `notification` por HTTP, o fã espera pelo
provedor de e-mail, uma queda do e-mail vira uma queda de pedidos, e os 2 milhões de fãs que chegam no
mesmo segundo atingem todos os serviços de uma vez. Este lab troca esse acoplamento por três ideias da
[aula de mensageria](../../classes/messaging/index.md): **eventos em um log**, **entrega
*at-least-once* tratada com idempotência** e **filas que absorvem um pico**.

Ele constrói o capítulo 8 da [história da disciplina](../../index.md#story). As decisões que você implementa
são justificadas na aula: [síncrono vs assíncrono](../../classes/messaging/index.md#sync-vs-async),
o [transactional outbox](../../classes/messaging/patterns/index.md#transactional-outbox),
[consumidores idempotentes](../../classes/messaging/semantics/index.md#idempotent-consumers),
[retries e mensagens mortas](../../classes/messaging/semantics/index.md#dlq) e a
[sala de espera da venda relâmpago](../../classes/messaging/queues-pubsub/index.md#the-flash-sale-waiting-room).

## Slides

<div class="slides-embed">
  <iframe src="slides/async.html" title="Slides: mensageria assíncrona" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/async.html){:target="_blank"}

## Antes de começar { #before-you-start }

| | |
|---|---|
| Tempo | cerca de 4 horas (dois encontros) |
| Ferramentas | Docker com Compose v2 (`docker compose version`), k6 1.x (`k6 version`), `curl`, `jq` — todos do [lab 0](../0/index.md). Os serviços Java são construídos **dentro do Docker**: não é preciso JDK nem Maven locais neste lab |
| Recursos do Docker | pelo menos 4 CPUs e **8 GB** de memória (o Kafka e mais duas JVMs entram na stack do lab 6) |
| Portas | livres na sua máquina: 8084, 8086, 8089, 8025, 1025, 9094 (além das do lab 6) |

Seu repositório precisa estar no estado em que o lab 6 o deixou. Todo comando deste lab roda na
**raiz do seu repositório `boxoffice`**.

``` text title="Start state (end of lab 6)"
boxoffice/
├── docker-compose.yaml     # db, db-replica, pgbouncer, redis, catalog-1..3, inventory, auth, gateway, edge
├── infra/                  # nginx/, postgres/, pgbouncer/
├── load/                   # k6 scripts of labs 0-6
├── scripts/
└── services/
    ├── auth/
    ├── catalog/
    ├── gateway/
    └── inventory/
```

!!! tip "Recupere o atraso"

    Pulou ou quebrou o lab 6? Baixe [boxoffice-after-lab-6.zip](../6/boxoffice-after-lab-6.zip),
    descompacte, `cd boxoffice` e continue daqui.

Todo arquivo deste lab aparece **completo** nestas páginas, com o caminho no título, e também é
publicado em `https://insper.github.io/platform/2027.1/hands-on/7/code/<caminho>` — por exemplo
`curl -fsSL -o docker-compose.yaml https://insper.github.io/platform/2027.1/hands-on/7/code/docker-compose.yaml`.

## Arquitetura { #architecture }

=== "Antes (síncrono)"

    ``` mermaid-sim
    flowchart LR
        fan[Fã] -->|POST /orders| gw[gateway]
        gw --> order[order]
        order -->|INSERT do pedido| db[(PostgreSQL)]
        order -->|"POST /notifications (espera)"| notification[notification]
        notification -->|SMTP| mail[mailpit]
        notification -->|201 depois do e-mail| order
        order -->|201| gw
    ```

=== "Depois (eventos)"

    ``` mermaid-sim
    flowchart LR
        fan[Fã] -->|entra| wr[sala de espera]
        wr -->|admitido| gw[gateway]
        gw -->|POST /orders| order[order]
        order -->|"INSERT pedido + outbox (1 tx)"| db[(PostgreSQL)]
        order -->|201 na hora| gw
        relay[relay do outbox] -->|busca não publicados| db
        relay -->|publica OrderPlaced| kafka[(Kafka: order-events)]
        kafka -->|grupo de consumidores notification| notification[notification]
        notification -->|"processed_events (dedup)"| ndb[(PostgreSQL)]
        notification -->|SMTP| mail[mailpit]
        notification -.->|após 3 tentativas falhas| dlt[(order-events-dlt)]
    ```

A requisição do fã agora termina no *commit* do banco. Tudo o que vem depois — publicar, enviar o
e-mail, tentar de novo — acontece de forma **assíncrona** e pode ser lento, falhar ou se repetir sem
que o fã perceba.

!!! example "Componentes do BoxOffice envolvidos"

    | Componente da paleta | Neste lab |
    |---|---|
    | [Kafka](../../reference/components/messaging/index.md#kafka) | Kafka 4 de um nó em modo KRaft, tópico `order-events` com 6 partições |
    | [Message Queue](../../reference/components/messaging/index.md#queue) | a sala de espera: uma FIFO de fãs no Redis, esvaziada a uma taxa fixa de admissão |
    | [App Server](../../reference/components/compute/index.md#app) | `order` (produtor, relay do outbox, sala de espera) |
    | [Notifications](../../reference/components/compute/index.md#notifications) | `notification` (consumidor idempotente, DLT) |
    | [Email](../../reference/components/external/index.md#email) | Mailpit, um servidor SMTP local com caixa de entrada web |

## O que você vai medir { #what-you-will-measure }

| Pergunta | Métrica | Ferramenta |
|---|---|---|
| Quanto mais rápido fica o `POST /orders` sem o e-mail em linha? | p50 / p95 / p99, taxa de erro | k6 |
| O que acontece com os pedidos enquanto `notification` está fora? | taxa de erro, *lag* do consumidor | k6, `kafka-consumer-groups.sh` |
| Uma rajada forma *backlog*? Em quanto tempo ele é drenado? | *lag* ao longo do tempo, tempo de drenagem, atraso p95 do e-mail | `kafka-consumer-groups.sh`, SQL |
| A reentrega envia e-mails duplicados? | e-mails por pedido | API do Mailpit |
| A sala de espera mantém a taxa de admissão durante um pico? | admitidos/s, posição na fila, p95 dos pedidos | k6 |

## Pré-requisitos { #prerequisites }

- Labs [1](../1/index.md) a [6](../6/index.md) concluídos: seu repositório `boxoffice` roda `db` (PostgreSQL), `redis`,
  `catalog`, `inventory` e o `gateway` com `docker compose`.
- Cerca de 2 GB extras de memória para o Docker (o Kafka é uma JVM).
- Leia a [aula de mensageria](../../classes/messaging/index.md), em especial
  [Kafka](../../classes/messaging/kafka/index.md), [semânticas de entrega](../../classes/messaging/semantics/index.md)
  e o [padrão outbox](../../classes/messaging/patterns/index.md).

## Passos { #steps }

1. [Kafka no Compose](kafka/index.md) — um broker KRaft, o tópico `order-events`, o Kafka UI e o Mailpit; um passeio pela CLI.
2. [Transactional outbox](outbox/index.md) — o serviço `order` grava o pedido e o evento em uma transação; um relay o publica.
3. [Consumidor idempotente e DLT](consumer/index.md) — o serviço `notification` deduplica por `eventId`, tenta de novo com *backoff* e manda mensagens envenenadas para a DLT.
4. [Sala de espera](waiting-room/index.md) — uma FIFO no Redis que admite fãs a uma taxa fixa durante a abertura das vendas.
5. [Meça](measure/index.md) — latência síncrona vs assíncrona, comportamento na queda, *lag* e drenagem, duplicatas, taxa de admissão.

## Experimente no playground { #try-it-in-the-playground }

Antes de escrever código, veja as duas formas que este lab constrói. **Experimente:** no primeiro
simulador, rode o perfil `load` e observe cada serviço consumidor receber sua própria cópia de cada
evento (*fan-out*); depois aumente o RPS alvo até um consumidor ficar para trás enquanto o produtor
continua rápido. No segundo, rode `spike` e observe o *backlog* da fila crescer e drenar enquanto os
*workers* seguem em ritmo constante.

<div class="sdp" data-scenario="event-fanout" data-mode="compact" data-height="520"></div>

<div class="sdp" data-scenario="async-queue" data-mode="compact" data-height="520" data-profile="spike"></div>

O simulador completo está no [playground](../../../playground/index.md).

## Meça { #measure-it }

O passo [Meça](measure/index.md) tem os scripts k6 e a tabela de resultados. Preencha-a e guarde-a no
seu repositório: ela faz parte da entrega.

## Solução de problemas { #troubleshooting }

| Sintoma | Causa provável | Correção |
|---|---|---|
| `kafka` fica `starting`/`unhealthy`; `kafka-init` nunca roda | pouca memória no Docker, ou porta 9094 ocupada | dê 8 GB ao Docker; `lsof -i :9094`; `docker compose logs kafka` |
| `order`/`notification` reiniciam com `Connection to node -1 … could not be established` | subiram antes do Kafka (só se você removeu o `depends_on`) | `docker compose up -d order notification` de novo quando o `kafka` estiver saudável |
| `order` falha com `Unable to obtain connection from database` | `db` ainda não saudável, ou variáveis `DB_*` erradas | `docker compose ps db`; as variáveis estão no serviço `order` do `docker-compose.yaml` |
| `POST /orders` responde `403 on-sale in progress` | a sala de espera daquele show está aberta (passo 4) | use outro `showId`, ou `curl -X POST localhost:8084/orders/waiting-room/show-42/close` |
| Nenhum e-mail no Mailpit | `notification` fora, atrasado, ou o evento foi para a DLT | `docker compose logs notification`; `sh scripts/kafka-lag.sh`; consulte `notification.dead_letters` |
| `docker compose exec kafka …` falha com `service "kafka" is not running` | o broker foi parado em um experimento | `docker compose start kafka` |
| O build falha com `Could not resolve dependencies` | sem Internet durante o `docker compose build` | tente de novo com rede; o Maven baixa uma vez e guarda em cache (`--mount=type=cache`) |
| Apple Silicon: `no matching manifest for linux/arm64` | imagem sem variante arm64 | todas as imagens deste lab são multiarquitetura; confira se digitou as tags exatamente |

!!! success "Boas práticas neste lab"

    - **Escreva o evento na mesma transação que a mudança de negócio** — o `OrderService.java` chama `Outbox.append` (que se recusa a rodar fora de uma transação) e o `OutboxRelay.java` publica depois do commit. Por quê: [transactional outbox](../../classes/messaging/patterns/index.md#transactional-outbox).
    - **Torne o consumidor idempotente no seu próprio banco** — o `NotificationService.java` insere o `eventId` em `processed_events` (`V1__create_notification.sql`) na mesma transação que a linha do e-mail. Por quê: [consumidores idempotentes](../../classes/messaging/semantics/index.md#idempotent-consumers).
    - **Limite os retries e guarde as mensagens envenenadas para inspeção** — `KafkaConfig.java` (3 retries, depois `order-events-dlt`; erros de parse sem retry) e `DeadLetterListener.java` (a tabela `dead_letters`). Por quê: [retries e filas de mensagens mortas](../../classes/messaging/semantics/index.md#dlq).
    - **Crie os tópicos explicitamente e produza de forma durável** — `docker-compose.yaml` (`kafka-init`, criação automática desligada) e `services/order/src/main/resources/application.yaml` (`acks: all`, `enable.idempotence: true`). Por quê: [replicação e durabilidade](../../classes/messaging/kafka/index.md#replication-and-durability).
    - **Admita a multidão a uma taxa configurada e medida, numa ordem decidida pelo servidor** — `WaitingRoom.java` (sequência por `INCR`, `ADMIT_PER_SECOND`). Por quê: [a sala de espera da venda relâmpago](../../classes/messaging/queues-pubsub/index.md#the-flash-sale-waiting-room).

## Limpeza { #clean-up }

Ao terminar (ou antes do lab 8), pare a stack e mantenha os dados, ou remova tudo:

``` shell
docker compose stop                 # keep containers and volumes for the next lab
docker compose down -v              # or: remove containers, networks and volumes (all data)
```

O lab 8 começa deste estado; não é preciso guardar nada além do seu repositório.

## Estado final { #end-state }

``` text title="End state (what this lab added)"
boxoffice/
├── docker-compose.yaml     # + kafka, kafka-init, kafka-ui, mailpit, order, notification
├── load/
│   ├── orders-load.js
│   └── waiting-room-spike.js
├── scripts/
│   └── kafka-lag.sh
└── services/
    ├── notification/       # new: idempotent consumer, DLT, e-mail
    └── order/              # new: orders, outbox relay, waiting room
```

Faça commit e tag: `git add -A && git commit -m "lab 7: async messaging" && git tag lab7`.

## Checklist

- [ ] `kafka`, `kafka-init`, `kafka-ui` e `mailpit` rodam no `docker-compose.yaml`; `order-events` e `order-events-dlt` têm 6 partições cada
- [ ] `order` grava `orders` e `outbox` em uma transação; repetir o `POST /orders` com o mesmo `holdId` devolve o mesmo pedido e não cria evento novo
- [ ] o relay do outbox publica com chave = `orderId` e marca as linhas como publicadas; parar o Kafka não perde nenhum evento
- [ ] `notification` envia um e-mail por pedido mesmo depois de um *reset* de offsets (duplicatas são ignoradas)
- [ ] uma mensagem envenenada chega à `order-events-dlt` depois das tentativas, e a partição continua andando
- [ ] a sala de espera admite na taxa configurada; um `POST /orders` sem ticket de admissão é recusado durante a abertura das vendas
- [ ] tabela de resultados do passo [Meça](measure/index.md) preenchida em `results/lab7.md`, com uma explicação curta de cada número
- [ ] autoverificação: `docker compose down -v && docker compose up -d --build` a partir de um clone limpo sobe tudo saudável; depois, push para o GitHub com a tag `lab7`

## Relacionados { #related }

- Teoria: [Mensageria e eventos](../../classes/messaging/index.md) ·
  [Filas e pub/sub](../../classes/messaging/queues-pubsub/index.md) ·
  [Kafka](../../classes/messaging/kafka/index.md) ·
  [Padrões: outbox, saga, CQRS](../../classes/messaging/patterns/index.md) ·
  [Semânticas de entrega](../../classes/messaging/semantics/index.md)
- Estudo de caso: [Venda de ingressos (venda relâmpago do BoxOffice)](../../classes/case-studies/ticketing/index.md)
- Exercício: [Orientado a eventos](../../exercises/event-driven/index.md)
- Próximo lab: [8. Observabilidade](../8/index.md) rastreia este fluxo de ponta a ponta, inclusive o salto pelo Kafka.

[Começar: Kafka no Compose](kafka/index.md){ .md-button .md-button--primary }
