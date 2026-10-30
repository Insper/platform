# Mensageria { #messaging }

Os componentes de **mensageria** colocam uma **fronteira assíncrona** entre a parte do sistema que produz trabalho e a parte que o executa. Em vez de chamar um serviço e esperar, o produtor grava uma mensagem num broker e segue em frente; os consumidores a leem quando puderem. Essa única mudança desacopla os dois lados no **tempo** (o consumidor pode estar fora do ar ou lento), na **taxa** (um pico vira um backlog que é drenado no ritmo dos consumidores) e no **conhecimento** (o produtor não precisa saber quem consome). O preço: o resultado deixa de ser imediato, mensagens podem chegar duas vezes ou fora de ordem, e agora é preciso vigiar backlogs e atrasos.

No BoxOffice, a sala de espera da venda relâmpago é uma fila; o `order` publica eventos `OrderConfirmed` no Kafka, e `notification`, `analytics` e `search` os consomem cada um de forma independente; o envio de e-mails fica atrás de uma fila, para que um provedor lento nunca deixe o checkout lento.

| Componente | Em uma frase | Id no playground |
|---|---|---|
| [Message Queue](#queue) | Cada mensagem é processada por um dos consumidores concorrentes; distribuição de trabalho | `queue` |
| [Pub/Sub](#pubsub) | Cada mensagem é entregue a todos os assinantes; fan-out de notificações | `pubsub` |
| [Event Stream](#stream) | Um log ordenado, retido e particionado, que os consumidores leem cada um na sua posição | `stream` |
| [Kafka](#kafka) | A plataforma de streaming de eventos mais usada (tópicos, partições, consumer groups) | `kafka` |

``` diagram
flowchart LR
    P1[order] -->|OrderConfirmed| K[(Tópico Kafka)]
    K --> N[notification]
    K --> A[analytics]
    K --> S[search]
    W[gateway] -->|senhas de admissão| Q[[Fila: sala de espera]]
    Q --> I1[worker de inventory]
    Q --> I2[worker de inventory]
```

| | Fila | Pub/Sub | Event stream / Kafka |
|---|---|---|---|
| Quem recebe a mensagem | um consumidor | todos os assinantes | cada consumer group (um consumidor por partição dentro do grupo) |
| Depois do consumo | apagada (ack) | apagada por assinatura | mantida até a retenção expirar; pode ser reprocessada |
| Ordem | em geral nenhuma (há variantes FIFO) | em geral nenhuma | por partição (por chave) |
| Uso típico | jobs em segundo plano, amortecer picos | notificações, invalidação de cache, fan-out | arquitetura orientada a eventos, CDC, pipelines de análise |

---

## Message Queue { #queue }

**O que é.** Uma fila de mensagens guarda as mensagens até que um consumidor as pegue. Vários consumidores podem ler da mesma fila — **consumidores concorrentes** — e cada mensagem vai para **um só** deles, então acrescentar consumidores aumenta a vazão. O consumidor **confirma** (*ack*) a mensagem depois de processá-la; se ele cair antes do ack, a mensagem volta a ficar visível (depois de um *visibility timeout*) e outro consumidor tenta de novo. Mensagens que falham repetidamente vão para uma **dead-letter queue (DLQ)**, para inspeção.

**Quando usar.**

- Trabalho em segundo plano que o usuário não precisa esperar: enviar e-mails, gerar ingressos em PDF, transcodificar vídeos, redimensionar pôsteres.
- **Absorver picos**: os produtores enfileiram a 10× a taxa por um minuto; os consumidores drenam num ritmo constante — o backlog é o amortecedor (cenário `async-queue`).
- **Nivelar a carga na frente de um recurso frágil**: a sala de espera do BoxOffice admite fãs no `inventory` no ritmo que o banco aguenta.
- Repetir chamadas a provedores externos instáveis sem bloquear o caminho da requisição.

**Quando não usar (ou cuidado).**

- Quando quem chama precisa do resultado agora (mostrar o assento como reservado): mantenha esse caminho síncrono.
- Quando vários serviços independentes precisam da mesma mensagem: use pub/sub ou um stream, não uma fila por consumidor colada à mão.
- A entrega costuma ser **at-least-once**: uma mensagem pode ser processada duas vezes → os consumidores precisam ser **idempotentes**.
- Em geral a ordem não é garantida (ou fica restrita a filas FIFO, de vazão menor).
- Um backlog crescendo é uma falha silenciosa: monitore a profundidade da fila e a idade da mensagem mais antiga, com alertas.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Latência para enfileirar (fila gerenciada) | ≈ alguns a dezenas de ms | O produtor recebe um ack e continua |
| Tempo para drenar um backlog | backlog ÷ (taxa dos consumidores − taxa de chegada) | 120 mil mensagens, consumidores 2 mil/s mais rápidos que as chegadas ⇒ 60 s |
| Visibility timeout do SQS | padrão 30 s, máximo 12 h | Precisa ser maior que o tempo de processamento |
| Retenção do SQS | padrão 4 dias, máximo 14 dias | Mensagens mais antigas são descartadas |
| Tamanho de mensagem | pequeno — KBs, até o limite do broker | Payloads grandes por referência (claim check: guardar no object store e enviar a chave) |

**Modos de falha.**

- **Mensagem venenosa** — uma mensagem sempre derruba o consumidor e é repetida para sempre → contagem máxima de recebimentos e depois DLQ.
- **Processamento duplicado** — o consumidor caiu depois de fazer o trabalho e antes do ack → consumidor idempotente (deduplicar pelo id da mensagem).
- **Backlog sem limite** — consumidores mais lentos que os produtores por muito tempo → autoscaling dos consumidores pela profundidade da fila, backpressure, descartar ou recusar na borda.
- **Visibility timeout curto demais** — mensagens lentas reaparecem e são processadas em paralelo por dois consumidores → timeout maior que o p99 do processamento, extensão por heartbeat.
- **Consumidores sobrecarregando o que está a jusante** — escalar consumidores inunda o banco → limitar a concorrência dos consumidores.

**No playground.** `queue` é um nó de **mensageria** e, portanto, uma **fronteira assíncrona**: o produtor recebe um ack depois dos poucos milissegundos do broker, a mensagem entra no **backlog** e os consumidores a jusante (por exemplo, `worker`) a drenam na sua capacidade, cada mensagem indo para **um** consumidor. Observe as métricas de backlog, atraso do consumidor (s) e latência ponta a ponta (assíncrona); quando o backlog passa do máximo ou da retenção, mensagens são descartadas e contadas como erros. Aumente `replicas` ou `autoscale` dos consumidores para drenar mais rápido. Cenários: [`async-queue`](../../../../playground/scenarios/index.md#async-queue), [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale), [`notification-system`](../../../../playground/scenarios/index.md#notification-system), [`video-streaming`](../../../../playground/scenarios/index.md#video-streaming).

**Produtos reais.**

=== "AWS"

    - **Amazon SQS** — filas totalmente gerenciadas: Standard (at-least-once, ordem de melhor esforço) e FIFO (ordenada, processamento exactly-once dentro de uma janela de deduplicação).
    - **Amazon MQ** — RabbitMQ e ActiveMQ gerenciados.

=== "GCP"

    - **Cloud Tasks** — fila gerenciada de tarefas HTTP, com limites de taxa e retries.
    - **Pub/Sub** com assinaturas pull — consumidores concorrentes numa assinatura.

=== "Azure"

    - **Azure Service Bus** (filas) — mensageria corporativa com sessões, DLQ e transações.
    - **Azure Queue Storage** — filas simples e baratas.

=== "Código aberto"

    - **RabbitMQ** — o broker de mensagens clássico (AMQP), com filas e exchanges.
    - **Apache ActiveMQ** — broker de mensagens JMS.
    - **Redis Streams** / bibliotecas como **Celery** (Python) e **BullMQ** (Node.js) — filas de jobs sobre Redis ou RabbitMQ.

!!! tip "Na entrevista"
    "Tudo o que o usuário não precisa esperar vai para uma fila: o checkout responde na hora e os workers enviam o e-mail e geram o ingresso. A fila absorve picos, repete as falhas e estaciona as mensagens venenosas numa DLQ; como a entrega é at-least-once, os consumidores são idempotentes, e eu alerto pela profundidade da fila e pela idade da mensagem mais antiga."

**Saiba mais:** [Mensageria › Filas e pub/sub](../../../classes/messaging/queues-pubsub/index.md) · [Mensageria › Semânticas de entrega](../../../classes/messaging/semantics/index.md) · [Computação › Trabalho assíncrono](../../../classes/compute/async-work/index.md) · [Estudo de caso: sistema de notificações](../../../classes/case-studies/notification-system/index.md) · [Hands-on 7](../../../hands-on/7/index.md)

---

## Pub/Sub { #pubsub }

**O que é.** No publish/subscribe, o produtor publica uma mensagem num **tópico** e o broker entrega uma **cópia para cada assinatura**. Os publicadores não sabem quem escuta; acrescentar um novo assinante não exige mudança alguma no publicador. Cada assinatura se comporta como uma fila própria (com acks e retries). Os sistemas clássicos de pub/sub apagam a mensagem quando todas as assinaturas a confirmam e são otimizados para fan-out de baixa latência, e não para retenção longa ou reprocessamento.

**Quando usar.**

- **Fan-out de eventos** para vários serviços independentes: `EventCancelled` → reembolsos, notificações, índice de busca, invalidação de cache.
- Entrega em tempo real entre servidores: num chat, o servidor que recebe uma mensagem a publica no canal da conversa e os servidores que mantêm os WebSockets dos destinatários a entregam (cenário `chat`).
- Invalidação de cache em muitas réplicas da aplicação.
- Notificações para muitos destinos (push móvel, e-mail, webhooks) por meio de assinaturas por canal.

**Quando não usar (ou cuidado).**

- Quando você precisa **reprocessar** o histórico ou acrescentar um consumidor que deve ler eventos passados: use um event stream (Kafka) com retenção.
- Quando só um worker deve processar cada mensagem: isso é uma fila (ou uma assinatura com consumidores concorrentes).
- Em geral a ordem entre mensagens não é garantida; ordem por chave pode ser uma opção, com vazão menor.
- Pub/sub em memória (Redis Pub/Sub) é dispare-e-esqueça: assinantes fora do ar **perdem** as mensagens.
- O fan-out multiplica a carga: uma publicação × N assinantes × as chamadas que cada um faz a jusante.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Latência da publicação à entrega | ≈ dezenas de ms (serviços gerenciados) | ≈ ilustrativo; brokers em memória ≈ abaixo de 1 ms a poucos ms |
| Custo do fan-out | uma publicação → N entregas | N assinaturas × taxa de mensagens = taxa de entregas |
| Retenção de mensagens no GCP Pub/Sub | padrão 7 dias nas assinaturas (configurável) | Mensagens sem ack são reentregues |
| Tamanho máximo de mensagem | de ≈ 256 KB (SNS) a 10 MB (GCP Pub/Sub) | Limites documentados; payloads grandes por referência |
| Semântica de entrega | at-least-once (típico) | Assinantes precisam ser idempotentes |

**Modos de falha.**

- **Assinante lento** — uma assinatura acumula backlog enquanto as outras vão bem → monitoramento por assinatura, escalar aquele consumidor, DLQ.
- **Mensagens perdidas** em pub/sub dispare-e-esqueça quando um assinante está fora → assinaturas duráveis ou um stream.
- **Duplicatas** na reentrega → assinantes idempotentes.
- **Tempestade de fan-out** — um tópico popular dispara milhares de chamadas a jusante de uma vez → lotes, limites de taxa nos assinantes.
- **Acoplamento acidental** — assinantes dependem de campos não documentados da mensagem → esquemas e versionamento.

**No playground.** `pubsub` é um nó de **mensageria** (fronteira assíncrona) que entrega uma **cópia de cada mensagem a cada consumidor** ligado a ele (fan-out), ao contrário da `queue`, em que os consumidores competem. Cada consumidor tem seu próprio backlog e atraso. Observe como acrescentar um consumidor multiplica o trabalho total, mas não deixa o produtor mais lento. Cenários: [`chat`](../../../../playground/scenarios/index.md#chat), [`event-fanout`](../../../../playground/scenarios/index.md#event-fanout), [`notification-system`](../../../../playground/scenarios/index.md#notification-system).

**Produtos reais.**

=== "AWS"

    - **Amazon SNS** — tópicos de pub/sub gerenciados; muitas vezes com fan-out para filas SQS (SNS + SQS).
    - **Amazon EventBridge** — barramento de eventos com regras de roteamento por conteúdo.

=== "GCP"

    - **Pub/Sub** — publish/subscribe global e gerenciado, com assinaturas push e pull.
    - **Eventarc** — roteamento de eventos para o Cloud Run e outros serviços.

=== "Azure"

    - **Azure Service Bus** (tópicos e assinaturas) — pub/sub durável com filtros.
    - **Azure Event Grid** — roteamento de eventos com entrega push.
    - **Azure Web PubSub** — pub/sub sobre WebSockets até os clientes.

=== "Código aberto"

    - **NATS** — mensageria leve e muito rápida (pub/sub no núcleo; o JetStream acrescenta persistência).
    - **RabbitMQ** — exchanges fanout e topic.
    - **Redis Pub/Sub** — canais em memória, dispare-e-esqueça.

!!! tip "Na entrevista"
    "Quando um evento é cancelado, o serviço de eventos só publica `EventCancelled`; reembolsos, notificações e busca têm cada um a sua assinatura e reagem de forma independente. Acrescentar um consumidor não mexe no publicador. A entrega é at-least-once, então todo assinante é idempotente, e eu monitoro o backlog de cada assinatura separadamente."

**Saiba mais:** [Mensageria › Filas e pub/sub](../../../classes/messaging/queues-pubsub/index.md) · [Mensageria › Padrões](../../../classes/messaging/patterns/index.md) · [Borda › Protocolos](../../../classes/edge/protocols/index.md) · [Estudo de caso: chat](../../../classes/case-studies/chat/index.md) · [Estudo de caso: feed de notícias](../../../classes/case-studies/news-feed/index.md)

---

## Event Stream { #stream }

**O que é.** Um event stream é um **log ordenado, apenas de acréscimo** (*append-only*), dividido em **partições** e **retido** por um período (horas, dias ou para sempre), sem ser apagado ao ser consumido. Cada consumidor (ou consumer group) guarda o seu **offset** — a sua posição no log —, de modo que muitos consumidores independentes podem ler os mesmos eventos no próprio ritmo, e um consumidor novo pode **reprocessar** o histórico desde o começo. Eventos com a mesma chave vão para a mesma partição, o que dá **ordem por chave**. É a espinha dorsal de arquiteturas orientadas a eventos, de captura de mudanças (CDC) e de análises em tempo real. O Kafka é a implementação mais conhecida e tem uma entrada própria abaixo; esta entrada cobre o conceito e as alternativas gerenciadas.

**Quando usar.**

- Muitos consumidores dos mesmos fatos, cada um no seu ritmo: `OrderConfirmed` lido por notification (agora), analytics (em lotes) e um novo serviço antifraude (reprocessando o último mês).
- **Event sourcing** e **CQRS**: o log é a fonte da verdade e os modelos de leitura são reconstruídos a partir dele.
- **CDC**: cada mudança na tabela de pedidos publicada como evento (por exemplo, com o Debezium) para alimentar a busca, a invalidação de cache e o warehouse.
- Ingestão de alta vazão: cliques, atualizações de localização, métricas, logs.

**Quando não usar (ou cuidado).**

- Jobs simples em segundo plano com um só tipo de consumidor: uma fila é mais simples (ack por mensagem e DLQ prontos).
- Interações de requisição/resposta: um stream acrescenta latência e complexidade sem ganho.
- O paralelismo é limitado pelo número de **partições**; a ordem só vale **dentro** de uma partição — escolha bem a chave (por exemplo, `order_id`).
- Um consumidor lento não atrasa os outros, mas o seu **atraso** (*lag*) cresce; se passar da retenção, ele perde eventos.
- Esquemas evoluem: use um schema registry e mudanças compatíveis, ou os consumidores antigos quebram.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Capacidade de um shard do Kinesis | 1 MB/s ou 1.000 registros/s de entrada; 2 MB/s de saída | Limites documentados por shard |
| Retenção padrão do Kinesis | 24 h (extensível até 365 dias) | Documentado |
| Paralelismo máximo de consumo (por grupo) | = número de partições/shards | Consumidores extras ficam ociosos |
| Atraso do consumidor | mensagens (ou segundos) atrás da ponta do log | A métrica de saúde principal |
| Latência ponta a ponta | ≈ dezenas a centenas de ms | ≈ ilustrativo; depende de lotes e polling |

**Modos de falha.**

- **Atraso do consumidor crescendo** — consumidores mais lentos que os produtores → mais consumidores (até o número de partições), mais partições, lotes, handlers mais rápidos.
- **Partição quente** — uma chave (o evento da venda relâmpago) recebe a maior parte dos eventos → uma chave mais fina (`seat_id` em vez de `event_id`), ou aceitar o limite.
- **Atraso além da retenção** — eventos perdidos para aquele consumidor → alertar sobre o atraso bem antes da retenção, retenção maior.
- **Efeitos colaterais no reprocessamento** (e-mails enviados de novo) → consumidores idempotentes, pipelines de reprocessamento separados.
- **Mudança de esquema incompatível** → schema registry com verificação de compatibilidade.

**No playground.** `stream` é um nó de **mensageria** com fan-out (todo consumidor recebe todo evento) e um parâmetro `partitions` (padrão 4): o paralelismo máximo de cada consumidor é `min(partitions, réplicas do consumidor)`. Acrescentar réplicas do consumidor além do número de partições não reduz o atraso — experimente. Métricas: backlog, atraso do consumidor (s), latência ponta a ponta. Cenários: [`event-fanout`](../../../../playground/scenarios/index.md#event-fanout), [`ride-sharing`](../../../../playground/scenarios/index.md#ride-sharing), [`news-feed`](../../../../playground/scenarios/index.md#news-feed).

**Produtos reais.**

=== "AWS"

    - **Amazon Kinesis Data Streams** — streams de eventos gerenciados e particionados em shards.
    - **Amazon MSK** — Apache Kafka gerenciado (veja [Kafka](#kafka)).

=== "GCP"

    - **Pub/Sub** com chaves de ordenação e seek/replay — um serviço gerenciado parecido com um stream.
    - **Managed Service for Apache Kafka** — clusters Kafka gerenciados.

=== "Azure"

    - **Azure Event Hubs** — serviço de ingestão de eventos particionado, com endpoint compatível com Kafka.

=== "Código aberto"

    - **Apache Kafka** — a plataforma de referência em streaming de eventos.
    - **Apache Pulsar** — streaming e filas com armazenamento em camadas.
    - **NATS JetStream** — streams persistentes sobre o NATS.
    - **Redis Streams** — streams leves com consumer groups.

!!! tip "Na entrevista"
    "Os eventos de pedido vão para um log particionado e retido, com chave `order_id`: cada consumer group lê no seu próprio offset, então notification, analytics e um futuro serviço antifraude são independentes e podem reprocessar o histórico. A ordem é por chave, o paralelismo é limitado pelo número de partições, e o número que eu vigio é o atraso do consumidor."

**Saiba mais:** [Mensageria › Filas e pub/sub](../../../classes/messaging/queues-pubsub/index.md) · [Mensageria › Kafka](../../../classes/messaging/kafka/index.md) · [Mensageria › Padrões](../../../classes/messaging/patterns/index.md) · [Estudo de caso: transporte por aplicativo](../../../classes/case-studies/ride-sharing/index.md)

---

## Kafka { #kafka }

**O que é.** O Apache Kafka é uma plataforma distribuída de streaming de eventos. Os dados são organizados em **tópicos**, cada um dividido em **partições**; cada partição é um log ordenado, apenas de acréscimo, replicado entre **brokers** (um líder, seguidores no conjunto de *réplicas em sincronia*, ISR). Os produtores escolhem a partição pela **chave** (mesma chave → mesma partição → em ordem). Os consumidores entram em **consumer groups**: dentro de um grupo, cada partição é atribuída a um consumidor, e o grupo registra **offsets** para lembrar onde parou. As mensagens ficam retidas por tempo ou tamanho (ou para sempre, como o último valor por chave, com **log compaction**). Desde o Kafka 4.0, os clusters rodam em modo **KRaft** (quórum de metadados baseado em Raft, sem ZooKeeper). Em volta do núcleo: Kafka Connect (integrações, CDC com Debezium), Kafka Streams (processamento de streams) e schema registries.

**Quando usar.**

- A espinha dorsal de eventos de um sistema de microsserviços: `order`, `payment` e `inventory` do BoxOffice publicam eventos de domínio; os demais reagem (sagas coreografadas, modelos de leitura).
- **Transactional outbox + CDC**: o Debezium lê a tabela outbox e publica no Kafka, de modo que banco e eventos nunca divergem.
- Pipelines de alto volume: clickstreams, logs, métricas, atualizações de localização — com reprocessamento quando preciso.
- Quando vários times precisam dos mesmos eventos, com ritmo e retenção independentes.

**Quando não usar (ou cuidado).**

- Sistemas pequenos com poucos jobs em segundo plano: uma fila gerenciada é muito mais simples de operar.
- Roteamento por mensagem, prioridades, mensagens atrasadas e retries por mensagem não são o forte do Kafka (filas fazem isso melhor).
- O número de partições é uma decisão de capacidade tomada de antemão: limita o paralelismo dos consumidores, e acrescentar partições depois muda o mapeamento chave → partição (a ordem por chave quebra na transição).
- "Exactly-once" existe para processamento Kafka-para-Kafka (produtor idempotente + transações); efeitos colaterais fora do Kafka continuam exigindo consumidores idempotentes.
- Operar Kafka (brokers, armazenamento, rebalanceamento, upgrades) dá trabalho de verdade → considere um serviço gerenciado.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Retenção padrão | 7 dias (`log.retention.hours = 168`) | Configurável por tópico; a compactação mantém o último valor por chave |
| Tamanho máximo padrão de mensagem | ≈ 1 MB | Payloads grandes por referência |
| Replicação | fator 3 com `min.insync.replicas = 2` e `acks=all` | Tolera a queda de um broker sem perder escritas confirmadas |
| Latência de produção (acks=all, mesma região) | ≈ alguns ms a dezenas de ms | ≈ ilustrativo; lotes (`linger.ms`) trocam latência por vazão |
| Vazão por partição | ≈ dezenas de MB/s | ≈ ilustrativo; planeje partições = vazão alvo ÷ vazão por consumidor |
| Paralelismo de consumo por grupo | ≤ partições | 6 partições, 10 consumidores ⇒ 4 ociosos |

**Modos de falha.**

- **Atraso dos consumidores** — os consumidores não dão conta → escalar consumidores até o número de partições, acrescentar partições (com planejamento), otimizar o handler, processar em lote.
- **Tempestades de rebalanceamento** — consumidores entrando e saindo sem parar pausam o consumo → rebalanceamento cooperativo, membros estáveis no grupo, session timeouts maiores.
- **Queda de um broker** → eleição de líder para as partições dele a partir das réplicas em sincronia; com fator 3 e `min.insync.replicas = 2`, as escritas continuam.
- **Mensagem venenosa** trava uma partição (o consumidor falha sempre no mesmo offset) → tópico de retry + tópico DLQ, pular após N tentativas.
- **Duplicatas** depois que um consumidor cai entre o processamento e o commit do offset → consumidor idempotente (tabela de deduplicação pelo id do evento).
- **Partição quente** por uma chave assimétrica → escolher melhor a chave, ou dividir as chaves quentes.
- **Disco cheio** por retenção longa demais ou compactação travada → monitorar o disco dos brokers, armazenamento em camadas.

**No playground.** `kafka` é um nó de **mensageria** como o `stream` (fan-out para todo consumidor, backlog retido), com um parâmetro `partitions` explícito (padrão 12, em 3 brokers): o paralelismo de cada consumidor é `min(partitions, réplicas do consumidor)`. Experimente o erro clássico: 3 partições, escale o consumidor para 10 réplicas e veja o atraso não se mexer. Métricas: backlog, atraso do consumidor (s), latência ponta a ponta; os limites de retenção transformam o backlog excedente em descartes (erros). Cenários: [`event-fanout`](../../../../playground/scenarios/index.md#event-fanout), [`payment-system`](../../../../playground/scenarios/index.md#payment-system), [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale), [`observability-stack`](../../../../playground/scenarios/index.md#observability-stack).

**Produtos reais.**

=== "AWS"

    - **Amazon MSK** (Managed Streaming for Apache Kafka) — clusters Kafka provisionados ou serverless; MSK Connect para conectores.

=== "GCP"

    - **Managed Service for Apache Kafka** — clusters Kafka gerenciados no Google Cloud.

=== "Azure"

    - **Azure Event Hubs** — expõe um endpoint compatível com Kafka, então clientes Kafka funcionam sem que você rode brokers.
    - **Confluent Cloud** (disponível nos marketplaces das nuvens) — Kafka totalmente gerenciado pelos criadores originais do Kafka.

=== "Código aberto"

    - **Apache Kafka** — brokers em modo KRaft (usado no Hands-on 7).
    - **Strimzi** — operador Kubernetes para rodar Kafka.
    - **Debezium** — conectores de CDC que transformam mudanças no banco (ou numa tabela outbox) em eventos Kafka.
    - **Kafka Connect** e **Kafka Streams** — integração e processamento de streams, parte do projeto Apache Kafka.

!!! tip "Na entrevista"
    "Eu usaria o Kafka como espinha dorsal de eventos: o serviço de pedidos grava num outbox na mesma transação, o Debezium publica num tópico com chave `order_id`, e notification, analytics e search são consumer groups separados. Dimensiono as partições pelo paralelismo de consumo de que preciso, uso fator de replicação 3 com `acks=all` e torno todo consumidor idempotente, porque a entrega é at-least-once."

**Saiba mais:** [Mensageria › Kafka](../../../classes/messaging/kafka/index.md) · [Mensageria › Semânticas de entrega](../../../classes/messaging/semantics/index.md) · [Mensageria › Padrões](../../../classes/messaging/patterns/index.md) · [Distribuídos › Consenso](../../../classes/distributed/consensus/index.md) · [Estudo de caso: sistema de pagamentos](../../../classes/case-studies/payment-system/index.md) · [Hands-on 7](../../../hands-on/7/index.md)
