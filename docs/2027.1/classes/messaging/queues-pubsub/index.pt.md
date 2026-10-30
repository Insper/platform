Todo ingresso vendido no BoxOffice precisa de um PDF com QR code. Gerá-lo leva cerca de 400 ms de CPU — lento demais para fazer dentro da requisição de compra durante uma flash sale. A solução óbvia é colocar o trabalho em algum lugar e deixar um pool de workers pegá-lo. Esse "algum lugar" é o componente de mensageria mais antigo e mais simples: a **fila**. Pouco depois, o time de produto pede um e-mail, uma notificação push, uma atualização da busca e um registro de analytics para cada compra — quatro serviços *diferentes*, cada um precisando da própria cópia. Essa é a segunda forma: **publish/subscribe**.

Esta página cobre as duas formas, como elas se comportam sob carga, e a fila mais famosa do BoxOffice: a **sala de espera** que impede dois milhões de fãs de esmagarem o inventário de lugares às 10:00.

---

## Filas ponto a ponto { #point-to-point-queues }

Uma **fila de mensagens** guarda mensagens até que um consumidor as pegue. Cada mensagem é entregue a **um** consumidor; muitos consumidores podem ler a mesma fila, e eles *competem* pelas mensagens — o padrão **competing consumers** (consumidores concorrentes)[^1]. Adicionar consumidores aumenta o throughput sem nenhuma mudança no produtor.

``` diagram-sim
flowchart LR
    order["order"] -->|"GenerateTicketPdf"| q[["fila: ticket-pdf"]]
    q -->|"msg 1"| w1["worker 1"]
    q -->|"msg 2"| w2["worker 2"]
    q -->|"msg 3"| w3["worker 3"]
    w1 --> os[("object store<br/>tickets/*.pdf")]
    w2 --> os
    w3 --> os
```

### A vida de uma mensagem { #the-life-of-a-message }

Uma fila não pode simplesmente apagar uma mensagem quando um consumidor a recebe: o consumidor pode cair no meio do processamento. Por isso a entrega é um protocolo em dois passos — **receber** e depois **confirmar**:

1. O consumidor **recebe** uma mensagem. O broker não a apaga; ele a esconde dos outros consumidores (o SQS chama isso de **visibility timeout**; o RabbitMQ a mantém como *não confirmada* no canal daquele consumidor).
2. O consumidor a processa e envia uma **confirmação** (ack). Só então a mensagem é apagada.
3. Se o consumidor cai, ou se o visibility timeout expira antes do ack, a mensagem volta a ficar visível e **outro consumidor a recebe**.

``` diagram-sim
sequenceDiagram
    participant Q as fila ticket-pdf
    participant W1 as worker 1
    participant W2 as worker 2
    Q->>W1: GenerateTicketPdf (pedido o-7731)
    Note over Q: mensagem escondida por 30 s
    W1->>W1: gera o PDF...
    Note over W1: cai antes do ack
    Note over Q: 30 s sem ack: visível de novo
    Q->>W2: GenerateTicketPdf (pedido o-7731), entrega nº 2
    W2->>W2: gera o PDF, faz upload
    W2->>Q: ack
    Note over Q: mensagem apagada
```

Esse protocolo dá entrega **at-least-once**: nenhuma mensagem se perde quando um worker morre, mas uma mensagem pode ser processada duas vezes (o worker 1 pode ter feito upload do PDF logo antes de cair). Todo consumidor de fila precisa, portanto, ser **idempotente** — veja [Semântica de entrega](../semantics/index.md). Aqui é fácil: o PDF é salvo com um nome determinístico (`tickets/o-7731.pdf`), então gravá-lo duas vezes dá o mesmo resultado.

| Configuração | O que controla | Escolha típica |
|---|---|---|
| **Visibility timeout** (SQS) / timeout de ack | Quanto tempo uma mensagem recebida fica escondida antes de ser reentregue | Algumas vezes o p99 do tempo de processamento (aqui: 30 s para um job de 400 ms) |
| **Prefetch** (RabbitMQ `basic.qos`) / tamanho do lote | Quantas mensagens não confirmadas um consumidor pode segurar | Pequeno (1–20) para jobs lentos, para o trabalho se espalhar por igual |
| **Máximo de recebimentos** | Quantas entregas antes de a mensagem ir para a dead letter queue | 3–10 |
| **Retenção da mensagem** | Quanto tempo uma mensagem não consumida sobrevive | SQS: 4 dias por padrão, até 14 dias |
| **Atraso** | Esconde uma mensagem nova por um tempo antes da primeira entrega | "Envie o lembrete 24 h antes do show" |

!!! warning "Um visibility timeout menor que o job"
    Se um job leva 45 s e o visibility timeout é de 30 s, a mensagem reaparece enquanto o primeiro worker ainda está trabalhando nela: dois workers processam cada mensagem lenta, e a carga dobra justamente quando o sistema está mais lento. Defina o timeout acima do p99 do tempo de processamento, ou faça o worker estendê-lo enquanto trabalha (`ChangeMessageVisibility` no SQS).

### Ordenação { #ordering }

Com consumidores concorrentes, **a ordem não é preservada**: a mensagem 2 pode terminar antes da mensagem 1 porque elas rodam em workers diferentes. Para a maioria dos jobs (PDFs, e-mails) isso não é problema. Quando é, você precisa de um jeito de serializar mensagens relacionadas:

- **Filas FIFO com id de grupo** (`MessageGroupId` no SQS FIFO, sessions no Azure Service Bus): mensagens do mesmo grupo são entregues em ordem, uma de cada vez; grupos diferentes rodam em paralelo.
- **Um log particionado com chave pela entidade** — Kafka, na próxima página — dá o mesmo comportamento "ordenado por chave, paralelo entre chaves" com alto throughput.

### Dimensionando o pool de workers { #sizing-the-worker-pool }

A Lei de Little (veja [Filas](../../estimation/queueing/index.md)) diz quantos workers acompanham uma taxa de chegada estável: o número de jobs em andamento é a taxa de chegada vezes o tempo que cada um leva.

$$
\text{busy workers} = \lambda \times S
$$

!!! example "BoxOffice: workers de PDF para a flash sale"

    O estádio tem 60.000 lugares; os fãs compram em média 2 lugares, então são cerca de 30.000 pedidos. Suponha (de forma ilustrativa) que eles sejam confirmados nos primeiros 3 minutos: $\lambda \approx 30\,000 / 180 \approx 167$ pedidos/s, cada um precisando de um PDF de $S = 0.4$ s.

    - Para acompanhar em tempo real: $167 \times 0.4 \approx 67$ workers ocupados o tempo todo — cerca de 95 workers para ficar perto de 70% de utilização (acima disso, o atraso de fila explode; veja o joelho da curva em [Filas](../../estimation/queueing/index.md)).
    - Com apenas 20 workers ($20 / 0.4 = 50$ PDFs/s), o backlog cresce $167 - 50 = 117$ por segundo, chega a cerca de 21.000 depois de 3 minutos e escoa em $21\,000 / 50 \approx 7$ minutos depois da venda.

    Qual está certo? Depende do **objetivo de atualidade (freshness)**: se o produto promete "seus ingressos chegam por e-mail em até 15 minutos", 20 workers bastam e custam um quinto. Trabalho assíncrono é dimensionado por uma meta de *atraso*, não por uma meta de latência de requisição.

<div class="csim" data-sim="queue" data-lambda="167" data-workers="95" data-service="0.4"></div>

!!! tip "Experimente"
    O simulador começa com os números do exemplo: 167 PDFs/s, 0,4 s cada, 95 workers (ρ = 0,70). Dê play.

    - Leia a linha **Little**: cerca de 67 PDFs no sistema = 166/s × 0,40 s. A Lei de Little vale qualquer que seja a distribuição das chegadas e dos tempos de serviço.
    - Baixe **Workers K** para 70 (ρ = 0,95) e depois 68 (ρ = 0,98): W vai de 0,40 s para 0,48 s e 0,68 s, e a fila começa a oscilar. Abaixo de 67 não há regime estacionário: com 60 workers (ρ = 1,11), 2.006 jobs esperam depois de 2 minutos e 4.151 depois de 4 — o backlog só cresce. Um pool deste tamanho tem um joelho abrupto perto de ρ = 1; a meta de 70% é folga para picos.
    - De volta a 95, aperte **pico de abertura** (3× por 20 s): o backlog chega a cerca de 5.300 jobs, o mais antigo espera 22 s, e a fila só esvazia cerca de 100 s depois do início do pico — ela escoa nos 71 jobs/s de sobra.
    - Ligue **escalar workers pelo backlog** e repita o pico: os novos workers levam 15 s para subir, então o pico quase não muda (cerca de 4.500), mas o job mais antigo espera 9 s e a fila esvazia em cerca de 27 s.

---

## Backpressure { #backpressure }

**Backpressure** é qualquer mecanismo pelo qual um consumidor lento faz um produtor rápido desacelerar — ou pelo menos faz o sistema *perceber* que não está dando conta. Sem isso, uma fila entre um produtor rápido e um consumidor lento é só um lugar onde o problema cresce em silêncio.

Uma fila que pode crescer sem limite é uma ilusão: a memória ou o disco acabam em algum momento, e muito antes disso as mensagens do fim da fila ficam **velhas** (um push "seus lugares estão reservados" que chega duas horas depois é pior que nenhum). Toda fila precisa de uma resposta para "o que acontece quando ela enche?"[^2]:

| Estratégia | O que acontece | Exemplo no BoxOffice | Custo |
|---|---|---|---|
| **Buffer (limitado)** | Absorve até N mensagens ou T minutos de backlog | A fila de PDF absorve o pico da abertura de vendas | O atraso cresce com o backlog |
| **Escalar consumidores** | Adiciona workers quando a profundidade ou o lag crescem | O KEDA escala os workers de PDF pelo tamanho da fila | Exige folga mais adiante (banco, object store) |
| **Rejeitar na borda** | Recusa trabalho novo com `429`/`503` + `Retry-After` | O gateway rejeita compras quando a sala de espera está cheia | Usuários veem um erro — mas um erro rápido e honesto |
| **Desacelerar o produtor** | O produtor bloqueia ou recebe menos créditos | O producer do Kafka bloqueia quando seu buffer enche (`max.block.ms`) | A latência passa para o produtor |
| **Descartar / expirar** | Descarta mensagens de pouco valor ou antigas | Descartar atualizações de "lugares restantes" com mais de 30 s; TTL nos pushes | Perda de dados, por projeto |
| **Descartar por prioridade** | Mantém as mensagens críticas, descarta ou atrasa o resto | Confirmações de compra antes de e-mails de marketing | Exige filas ou prioridades separadas |

!!! tip "Monitore a idade, não só a profundidade"
    A profundidade da fila sozinha é ambígua: 50.000 mensagens está ótimo para um pool que faz 10.000/s e é um desastre para um que faz 10/s. A **idade da mensagem mais antiga** (`ApproximateAgeOfOldestMessage` no SQS, consumer lag em tempo no Kafka) é o que o usuário sente. Escreva o SLO de atualidade sobre ela — "99% dos e-mails de confirmação enviados em até 2 minutos" — e alerte quando ele estiver em risco (veja [SLOs](../../observability/slo/index.md)).

---

## A sala de espera da flash sale { #the-flash-sale-waiting-room }

Às 10:00, dois milhões de fãs chegam para 60.000 lugares. O `inventory` consegue reservar lugares com segurança (com locks de linha, veja [Transações](../../databases/transactions/index.md)) a cerca de 1.100 reservas por segundo — a ordem de grandeza da estimativa da [aula 2](../../estimation/index.md), contra 33.000 que chegam; você o mediria com um teste de carga. Deixar todo mundo bater no caminho de compra ao mesmo tempo não vende ingressos mais rápido; faz o banco de dados entrar em colapso e o site inteiro falhar.

A **sala de espera virtual** é uma fila colocada *na frente* do fluxo de compra, na borda:

1. Os fãs que chegam recebem uma **posição** na sala de espera em vez da página de compra.
2. Um **job de admissão** libera os fãs a uma taxa controlada, ajustada ao que o `inventory` aguenta com margem.
3. Um fã admitido recebe um **token de admissão** assinado e de vida curta; o gateway rejeita chamadas de compra sem ele.
4. Quando o inventário chega a zero, a sala de espera avisa todos que ainda esperam que "esgotou" — de forma barata, pela borda, sem tocar no banco de dados.

``` diagram-sim
sequenceDiagram
    participant F as Fã
    participant W as sala de espera (borda)
    participant R as Redis (fila)
    participant G as gateway
    participant I as inventory
    F->>W: GET /events/ev-88/buy (10:00:01)
    W->>R: ZADD room:ev-88 score=chegada fan-123
    W-->>F: posição 512.384 (cerca de 17 min)
    loop a cada 15 s
        F->>W: GET /room/status
        W->>R: ZRANK room:ev-88 fan-123
        W-->>F: posição 30.112
    end
    Note over R: job de admissão: 500 fãs/s
    W-->>F: admitido + token (válido por 10 min)
    F->>G: POST /holds (Authorization: token de admissão)
    G->>I: reserva lugares B-12, B-13
    I-->>F: reservados até 10:21
```

A fila em si pode ser bem simples. Um sorted set do Redis ordenado por horário de chegada dá posições em $O(\log n)$:

```text
# a fan joins (score = arrival time in ms; NX: joining twice keeps the first position)
ZADD room:ev-88 NX 1804406400123 fan-123

# where am I? (0-based rank)
ZRANK room:ev-88 fan-123

# admission job, once per second: let the next 500 fans in
ZPOPMIN room:ev-88 500

# how many are still waiting?
ZCARD room:ev-88
```

Decisões de projeto que vale discutir:

- **Taxa de admissão.** É um número de capacidade, não um chute: o throughput medido do `inventory` × um fator de segurança (digamos 50%): cerca de 1.100 × 0,5 ≈ 500 fãs/s, a taxa usada acima. Ela pode se adaptar: reduzir as admissões quando o p99 ou a taxa de erros do `inventory` sobem — um laço de realimentação.
- **Justiça.** FIFO estrito premia quem tem a menor latência até o data center (e os bots). Muitos sites de ingressos dão aos fãs que chegaram *antes* do horário de abertura uma posição **aleatória** às 10:00, e só usam FIFO depois disso.
- **Bots.** A sala de espera é o lugar de exigir um desafio e aplicar detecção de bots e limites por conta (veja [Tráfego e borda](../../edge/index.md)).
- **Expiração da reserva.** A admissão dá ao fã um direito de compra com prazo; a reserva dos lugares expira (aqui, depois de 10 minutos) e os lugares voltam para o estoque. Isso é um timer — outro job assíncrono.
- **Onde roda.** As posições são servidas pela borda (funções de CDN ou um serviço pequeno, escalado horizontalmente, com Redis), então o polling de dois milhões de navegadores nunca chega aos serviços centrais.

!!! example "No código do BoxOffice: a sala de espera no `order` (lab 7)"

    O [Hands-on 7 — Sala de espera](../../../hands-on/7/waiting-room/index.md) constrói uma versão menor deste projeto. A fila é o mesmo sorted set do Redis, mas o score vem de `INCR`, não de um timestamp: o servidor decide a ordem, porque o relógio dos clientes mente. A cada segundo, `admit()` retira `admit-per-second` fãs (20 por padrão) e dá a cada um uma chave de *admitido* com TTL de 5 minutos, num único script Lua para que um fã que consulta nunca veja um ticket que não está nem na fila nem admitido — uma chave no Redis, não um token assinado — e quem confere `mayEnter` é o `POST /orders`, não o gateway: o lab diz isso e chama de boa extensão levar o portão para a borda. Veja o comentário em `admit()`: com três réplicas do `order`, três schedulers admitiriam o triplo da taxa. No pico do lab (cerca de 700 fãs em 40 s, 10 admitidos por segundo), a latência dos pedidos fica estável e a espera real fica a poucos segundos do ETA prometido na entrada — a lei de Little é uma promessa honesta quando a taxa é constante.

    ``` { .java title="services/order/src/main/java/boxoffice/order/waitingroom/WaitingRoom.java (join, admit, gate)" }
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/waitingroom/WaitingRoom.java:37:42,59:86"
    ```

!!! info "Experimente no playground"

    O cenário `flash-sale` é uma versão genérica do BoxOffice às 10:00, e começa **sem** sala de espera: `users → lb → app → inventory-db`, com os compradores chamando também o `payment provider` (cota de 500 req/s). Aperte **Run**: quando a venda abre (t = 60 s) o tráfego salta 20×, o `app` satura e aparecem erros; aumente as réplicas dele e quem satura passa a ser o `inventory-db` e o provedor de pagamento. Depois abra no playground completo (↗) e monte a sala de espera — um API Gateway que manda as escritas para uma Message Queue drenada por workers `order` (as dicas, ou **Mostrar uma solução possível**). O número de workers é a taxa de admissão: com poucos, o atraso do consumidor (quanto o comprador espera na fila) passa da meta de 300 s; com muitos, o `inventory-db` e a cota do pagamento voltam a ficar sob pressão. Ache a quantidade que mantém os dois dentro das metas.

<div class="sdp" data-scenario="flash-sale" data-mode="compact" data-height="560"></div>

---

## Publish/subscribe { #pubsub }

No **publish/subscribe** (pub/sub) o produtor publica em um **tópico**, e cada **assinatura** desse tópico recebe a própria cópia de toda mensagem[^3]. Dentro de uma assinatura, os consumidores competem como em uma fila; *entre* assinaturas, cada assinatura vê tudo. Na prática, cada assinatura é uma fila que o broker preenche automaticamente.

``` diagram-sim
flowchart LR
    order["order"] -->|"OrderConfirmed"| t{{"tópico: order-events"}}
    t --> s1[["assinatura: notification"]]
    t --> s2[["assinatura: search"]]
    t --> s3[["assinatura: analytics"]]
    s1 --> n1["notification #1"]
    s1 --> n2["notification #2"]
    s2 --> se["indexador da busca"]
    s3 --> an["carregador do analytics"]
```

Adicionar um quarto consumidor — digamos, um programa de fidelidade que dá pontos — é uma nova assinatura. O serviço `order` não muda, não é reimplantado e nem fica sabendo. Esse é o principal motivo para usar pub/sub: **o produtor fica desacoplado do conjunto de consumidores**.

### Push ou pull { #push-or-pull }

| | Assinatura pull | Assinatura push |
|---|---|---|
| **Como** | Os consumidores pedem mensagens ao broker | O broker chama um endpoint HTTPS do consumidor |
| **Controle de fluxo** | Natural: cada consumidor pega o que aguenta | O broker precisa recuar quando o endpoint dá erro ou fica lento |
| **Bom para** | Workers de longa duração, alto throughput, lotes | Consumidores serverless (Cloud Run, Lambda), webhooks, baixo volume |
| **Exemplos** | Google Cloud Pub/Sub pull, SQS, Kafka | Google Cloud Pub/Sub push, Amazon SNS para HTTPS, alvos do EventBridge |

### Filtragem e roteamento { #filtering-and-routing }

Nem todo assinante quer toda mensagem. Os brokers deixam uma assinatura declarar um **filtro** sobre atributos da mensagem, de modo que só as mensagens que casam são copiadas para ela — por exemplo, o serviço de SMS assina apenas eventos `OrderConfirmed` cujo atributo `channel` é `sms`. O RabbitMQ generaliza isso com **exchanges**: uma exchange `fanout` copia para toda fila ligada a ela, uma `direct` roteia por uma routing key exata, e uma `topic` roteia por padrões como `order.*.br`.

### Pub/sub durável e efêmero { #durable-and-ephemeral-pubsub }

Alguns sistemas pub/sub não armazenam mensagens: o Redis Pub/Sub e o NATS core entregam uma mensagem apenas aos assinantes conectados *naquele momento*. Se um assinante está fora do ar, ele simplesmente perde a mensagem. Isso é perfeito para indicadores de "usuário está digitando…" em um chat e inaceitável para confirmações de pedido. O pub/sub durável (Google Cloud Pub/Sub, SNS → SQS, NATS JetStream, Kafka) guarda as mensagens de cada assinatura até serem confirmadas.

!!! example "BoxOffice: o fan-out SNS → SQS"

    Na AWS, um jeito comum de montar o fan-out de `order-events` é um tópico SNS com uma fila SQS assinada por serviço consumidor. O SNS copia cada `OrderConfirmed` para cada fila; cada serviço lê a própria fila com consumidores concorrentes e com a própria política de retry e DLQ. Um carregador de `analytics` lento só aumenta a fila do `analytics`. É o mesmo desenho do diagrama acima, montado com dois serviços gerenciados.

---

## Fila, pub/sub ou log? { #queue-pubsub-or-log }

A próxima página apresenta a terceira forma, o **log** (Kafka, Kinesis). A tabela resume as três; a pergunta principal é o que acontece com uma mensagem depois que ela é lida.

| | Fila | Pub/Sub | Log (stream) |
|---|---|---|---|
| **Entrega** | cada mensagem a um consumidor | cada mensagem a toda assinatura | todo consumer group lê tudo |
| **Depois da leitura** | apagada no ack | apagada por assinatura no ack | mantida até a retenção expirar |
| **Replay de mensagens antigas** | não | limitado (alguns oferecem seek/snapshot) | sim: volte o offset |
| **Ack e reentrega por mensagem** | sim | sim | não: o consumidor confirma uma *posição* |
| **Ordenação** | nenhuma (filas FIFO: por grupo) | nenhuma (chaves de ordenação opcionais) | por partição (por chave) |
| **Um consumidor novo vê** | só mensagens novas | só mensagens depois da assinatura | o histórico ainda em retenção |
| **Throughput** | alto | alto | muito alto (I/O sequencial, lotes) |
| **Uso típico** | jobs, tarefas, comandos | notificações, fan-out de eventos | espinha dorsal de eventos, analytics, CDC, replay |

### Produtos { #products }

=== "AWS"

    - **Amazon SQS** — fila totalmente gerenciada; standard (at-least-once, ordem de melhor esforço) e FIFO (ordenada por `MessageGroupId`, janela de deduplicação).
    - **Amazon SNS** — pub/sub; fan-out para SQS, Lambda, HTTPS, e-mail, SMS.
    - **Amazon EventBridge** — barramento de eventos com regras de roteamento por conteúdo e um schema registry.
    - **Amazon MQ** — RabbitMQ / ActiveMQ gerenciado para aplicações existentes.

=== "Google Cloud"

    - **Cloud Pub/Sub** — pub/sub global com assinaturas pull e push, chaves de ordenação, dead letter topics, filtros.
    - **Cloud Tasks** — fila para chamadas explícitas, com limite de taxa, a handlers HTTP (comandos).
    - **Eventarc** — roteia eventos de serviços do Google e do Pub/Sub para o Cloud Run e outros alvos.

=== "Azure"

    - **Azure Service Bus** — filas e tópicos com assinaturas, sessions (grupos ordenados), dead-lettering, transações.
    - **Azure Event Grid** — roteamento de eventos por push entre serviços do Azure e webhooks.
    - **Azure Queue Storage** — fila simples e barata sobre storage accounts.

=== "Open source"

    - **RabbitMQ** — o broker AMQP clássico; exchanges para roteamento, quorum queues (replicadas com Raft) e streams.
    - **NATS** — pub/sub muito leve; o **JetStream** adiciona persistência, replay e confirmações.
    - **Redis** — Lists (`LPUSH`/`BRPOP`) como filas simples, Pub/Sub (efêmero), Streams (log com consumer groups).
    - **Apache ActiveMQ Artemis**, **Apache Pulsar** (pub/sub e log em um único sistema).

!!! tip "Na entrevista"
    Quando desenhar uma fila, diga três coisas sobre ela: **quem consome** (um pool de workers, ou uma assinatura por serviço), **o que acontece numa falha** (visibility timeout → reentrega → DLQ depois de N tentativas, por isso os consumidores são idempotentes) e **o que acontece quando ela enche** (limitada, com autoscaling pela idade da mensagem mais antiga, ou rejeitando na borda). Numa flash sale, proponha a sala de espera antes de o entrevistador perguntar "e às 10:00?" — e dimensione a taxa de admissão a partir do throughput medido do inventário.

!!! success "Boas práticas"

    - **Associe a toda fila de trabalho uma fila de mensagens mortas com número máximo de recebimentos** — por exemplo 5 tentativas: um job envenenado sai da fila em vez de rodar para sempre.
    - **Faça da taxa de admissão um valor de configuração derivado da capacidade medida** — cerca de 50% do que o `inventory` sustenta, alterado sem deploy. No BoxOffice: `ADMIT_PER_SECOND` alimenta o `WaitingRoomProperties` ([quadro da sala de espera](#the-flash-sale-waiting-room)).
    - **Rode jobs singulares uma vez por cluster** — eleição de líder ou lock distribuído para o admissor: três réplicas rodando-o admitem o triplo da taxa. No BoxOffice: o comentário em `WaitingRoom.admit()` e as armadilhas do lab ([lab 7 — sala de espera](../../../hands-on/7/waiting-room/index.md)).
    - **Prometa um ETA calculado a partir da fila, não um spinner** — lei de Little, `espera = posição / taxa de admissão`; no lab 7, a espera real ficou a poucos segundos do ETA prometido.
    - **Dê a cada assinante sua própria fila durável num fan-out** (SNS → uma fila SQS por serviço) — cada um faz retry, escala e descarta mensagens mortas por conta própria, então um consumidor lento de analytics nunca atrasa as confirmações.
    - **Use long polling em consumidores pull** (SQS `WaitTimeSeconds=20`) — workers ociosos param de fazer recebimentos vazios, o que corta custo e chamadas de API.

!!! warning "Armadilhas comuns"

    - **Filas sem limite.** "A fila absorve" até o backlog ter três horas e toda mensagem estar velha. Defina limites, TTLs e alertas sobre idade.
    - **Visibility timeout menor que o tempo de processamento** — todo job lento roda duas vezes.
    - **Consumidores não idempotentes** em uma fila at-least-once: e-mails duplicados, cobranças duplicadas.
    - **Pub/sub efêmero para eventos importantes** — o Redis Pub/Sub descarta mensagens de assinantes desconectados.
    - **Uma fila para tudo.** Uma rajada de e-mails de marketing atrasa as confirmações de compra. Separe filas (ou prioridades) por importância.
    - **Esquecer quem está depois.** Escalar workers de 20 para 200 move o gargalo para o banco onde eles escrevem.

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    P["produtor: order"] --> Q["fila<br/>consumidores concorrentes"]
    Q --> ACK["receber, depois ack<br/>visibility timeout"]
    ACK --> ALO["pelo menos uma vez<br/>→ Semântica de entrega"]
    Q --> LL["pool de workers pela<br/>Lei de Little → Estimativas"]
    Q --> BP["backpressure: limitar,<br/>escalar, rejeitar, descartar"]
    BP --> AGE["idade da mensagem mais antiga<br/>→ SLO de atualidade"]
    WR["sala de espera<br/>sorted set no Redis"] --> TOK["token de admissão<br/>validado no gateway"]
    TOK --> INV["reservas do inventory no SQL<br/>→ Bancos de dados"]
    P --> T["tópico pubsub"]
    T --> SUBS["uma assinatura<br/>por serviço consumidor"]
    T --> LOG["precisa de replay ou ordem por chave?<br/>→ Kafka"]
```

**Componentes da paleta:** [`queue`](../../../reference/components/messaging/index.md#queue) · [`pubsub`](../../../reference/components/messaging/index.md#pubsub) · [`worker`](../../../reference/components/compute/index.md#worker) · [`objstore`](../../../reference/components/storage/index.md#objstore) (os PDFs) · [`cache`](../../../reference/components/storage/index.md#cache) (sala de espera no Redis) · [`apigw`](../../../reference/components/edge/index.md#apigw) (rejeita chamadas sem token de admissão) · [`waf`](../../../reference/components/edge/index.md#waf) (bots na sala de espera) · [`sql`](../../../reference/components/storage/index.md#sql) (`inventory`) · [`notifications`](../../../reference/components/compute/index.md#notifications) (uma assinatura). **Cenários:** `async-queue`, `flash-sale`, `notification-system`, `chat` (pub/sub efêmero). **Continua em:** [Kafka e logs de eventos](../kafka/index.md), [Semântica de entrega](../semantics/index.md), [Compute — trabalho assíncrono](../../compute/async-work/index.md), [Estimativas — filas](../../estimation/queueing/index.md), [Observabilidade — SLOs](../../observability/slo/index.md), [Tráfego e borda — WAF e bots](../../edge/index.md#edge-security), [Hands-on 7 — sala de espera](../../../hands-on/7/waiting-room/index.md).

---

[^1]: HOHPE, G.; WOOLF, B. *Enterprise Integration Patterns*. Addison-Wesley, 2003. Padrões "Point-to-Point Channel", "Competing Consumers" e "Publish-Subscribe Channel".
[^2]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2. ed. O'Reilly. Seção sobre sistemas de mensageria: o que acontece se os produtores enviam mais rápido do que os consumidores processam.
[^3]: [Amazon SQS Developer Guide — Visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html){target="_blank"}; [Google Cloud Pub/Sub — Overview](https://cloud.google.com/pubsub/docs/overview){target="_blank"}; [RabbitMQ — Consumer Acknowledgements and Publisher Confirms](https://www.rabbitmq.com/docs/confirms){target="_blank"}.
