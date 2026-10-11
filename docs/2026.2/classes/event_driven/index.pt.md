
# Arquitetura Orientada a Eventos

REST síncrono funciona bem quando quem chama precisa de uma resposta imediata. Mas, quando um pedido é feito, o sistema pode precisar avisar 5 serviços downstream — e-mail, estoque, detecção de fraude, entrega, analytics. Chamar todos eles de forma síncrona antes de responder ao usuário gera um abismo de latência e uma explosão de acoplamento. A arquitetura orientada a eventos resolve isso com um contrato fundamentalmente diferente: publique um evento e deixe os interessados reagirem de forma assíncrona.

!!! abstract "Objetivos de aprendizagem"

    Ao final desta aula, você deve ser capaz de:

    - **Decidir** quando uma chamada entre dois serviços deve ser uma requisição síncrona ou um evento assíncrono.
    - **Explicar** como o Kafka organiza os dados em tópicos, partições e offsets, e como os grupos de consumidores oferecem tanto fan-out quanto divisão de carga.
    - **Escolher** uma chave de mensagem que preserve a ordem de que o negócio precisa e configurar a durabilidade do produtor (`acks`, replicação).
    - **Explicar** as entregas at-most-once, at-least-once e exactly-once, e **projetar** um consumidor idempotente.
    - **Aplicar** o transactional outbox e o padrão saga para manter os dados consistentes entre serviços sem transações distribuídas.
    - **Comparar** event sourcing e CQRS com um modelo CRUD clássico e tratar mensagens envenenadas (poison messages) com uma dead letter queue.

## Slides

<div class="slides-embed">
  <iframe src="slides/event-driven.pt.html" title="Slides: arquitetura orientada a eventos" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/event-driven.pt.html){:target="_blank"}

---

## Por que orientado a eventos?

Dois modelos de entrega lado a lado: a cadeia síncrona obriga o produtor a esperar cada serviço downstream antes de responder; o modelo assíncrono retorna imediatamente após publicar.

=== "Cadeia de chamadas síncronas"

    O produtor precisa esperar que cada serviço downstream termine antes de devolver uma resposta ao cliente. A latência se acumula, e uma única dependência lenta (ou com falha) trava a requisição inteira.

    ``` mermaid-sim
    sequenceDiagram
        autonumber
        participant Client
        participant OrderService
        participant EmailService
        participant InventoryService
        participant FraudService

        Client->>+OrderService: POST /orders
        OrderService->>+EmailService: sendConfirmation()
        EmailService-->>-OrderService: ok
        OrderService->>+InventoryService: reserveStock()
        InventoryService-->>-OrderService: ok
        OrderService->>+FraudService: checkFraud()
        FraudService-->>-OrderService: ok
        OrderService-->>-Client: 201 Created
    ```

=== "Publicação assíncrona de evento"

    O produtor publica um único evento e retorna imediatamente. Cada serviço downstream consome o evento de forma independente — em paralelo, no seu próprio ritmo, sem que o produtor saiba ou se importe.

    ``` mermaid-sim
    sequenceDiagram
        participant Client
        participant OrderService
        participant Kafka
        participant EmailService
        participant InventoryService
        participant FraudService

        Client->>+OrderService: POST /orders
        OrderService->>Kafka: publica OrderCreated
        OrderService-->>-Client: 202 Accepted
        Kafka-->>EmailService: OrderCreated (assíncrono)
        Kafka-->>InventoryService: OrderCreated (assíncrono)
        Kafka-->>FraudService: OrderCreated (assíncrono)
    ```

| Aspecto | Síncrono (REST) | Assíncrono (evento) |
|---|---|---|
| Latência | Soma de todas as chamadas | Apenas a latência do produtor |
| Acoplamento | O produtor conhece todos os consumidores | O produtor não conhece nenhum |
| Resiliência | Um consumidor lento bloqueia todos | Falhas de consumidores são independentes |
| Vazão (throughput) | Limitada pela dependência mais lenta | Consumidores escalam de forma independente |
| Depuração | Rastreamento simples da requisição | Exige rastreamento distribuído |
| Consistência | Forte (síncrona) | Eventual |

A simulação abaixo ilustra o que acontece com a profundidade da fila quando o consumidor não acompanha o produtor — e o que acontece quando ele consegue alcançá-lo.

```python exec="1" html="1"
import matplotlib.pyplot as plt

steps = list(range(21))

# Scenario 1: producer adds 3/step, consumer removes 2/step → queue grows
queue1 = [0]
for _ in steps[1:]:
    queue1.append(max(0, queue1[-1] + 3 - 2))

# Scenario 2: first 10 steps same overload, then consumer speeds up (removes 5/step)
queue2 = [0]
for i in steps[1:]:
    rate = 2 if i <= 10 else 5
    queue2.append(max(0, queue2[-1] + 3 - rate))

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(10, 4))
fig.patch.set_alpha(0)

ax1.plot(steps, queue1, color="#1976d2", linewidth=2, marker="o", markersize=4)
ax1.set_title("Overloaded Consumer\n(producer=3/step, consumer=2/step)", fontsize=10)
ax1.set_xlabel("Step")
ax1.set_ylabel("Queue depth (messages)")
ax1.set_facecolor("none")
ax1.grid(True, alpha=0.3)

ax2.plot(steps, queue2, color="#388e3c", linewidth=2, marker="o", markersize=4)
ax2.axvline(x=10, color="#e53935", linestyle="--", alpha=0.6, label="Consumer speeds up")
ax2.set_title("Consumer Catches Up\n(consumer scales to 5/step at step 10)", fontsize=10)
ax2.set_xlabel("Step")
ax2.set_ylabel("Queue depth (messages)")
ax2.set_facecolor("none")
ax2.legend(fontsize=8)
ax2.grid(True, alpha=0.3)

plt.tight_layout()
buffer = __import__('io').StringIO()
plt.savefig(buffer, format="svg", transparent=True)
print(buffer.getvalue())
plt.close()
```

---

## Conceitos fundamentais

| Conceito | Definição | Exemplo |
|---|---|---|
| **Evento** | Um registro imutável de algo que aconteceu | `OrderCreated { orderId, customerId, timestamp }` |
| **Mensagem** | Contêiner genérico de dados enviado entre serviços | Qualquer payload em uma fila |
| **Comando** | Uma instrução para fazer algo (pode ser rejeitada) | `PlaceOrder { items, paymentToken }` |
| **Produtor / Consumidor** | O serviço que escreve / lê mensagens | o order-service produz; o notification-service consome |
| **Broker** | O servidor que armazena as mensagens e as entrega aos consumidores | Um broker Kafka (`kafka:9092`) |
| **Tópico** | Um log de eventos nomeado, durável e ordenado | `order-events` |
| **Partição** | Um fragmento (shard) do tópico para paralelismo; a ordem só é mantida dentro dele | Partições 0, 1, 2 de `order-events` |
| **Chave** | Valor opcional que decide a partição de uma mensagem | `orderId` |
| **Offset** | Inteiro sequencial que identifica a posição de uma mensagem | Offset 42 na partição 1 |
| **Grupo de consumidores** | Um conjunto de consumidores que divide o trabalho de um tópico | `notification-group` |

!!! tip "Eventos são fatos"
    Diferentemente de registros de banco de dados, eventos nunca são atualizados nem apagados — o log é append-only (só aceita inserções no final). Essa imutabilidade torna seguro reprocessar (replay) os eventos para reconstruir o estado, auditar o histórico ou popular novas projeções sem tocar nos dados originais.

---

## Arquitetura do Kafka

O Apache Kafka[^1] é um **log** distribuído e append-only: produtores acrescentam mensagens ao final, consumidores leem a partir de qualquer posição que escolherem, e as mensagens continuam no disco depois de lidas (até que a política de retenção as apague). Essa é a principal diferença em relação a uma *fila* de mensagens clássica, como o RabbitMQ, em que a mensagem é removida assim que um consumidor confirma o recebimento.

O Kafka organiza as mensagens em **tópicos**, cada um dividido em **partições** ordenadas. Vários grupos de consumidores podem ler o mesmo tópico de forma independente — cada grupo mantém seu próprio ponteiro de offset por partição.

``` mermaid-sim
flowchart LR
    subgraph broker ["Broker Kafka"]
        subgraph topic ["Tópico: order-events"]
            P0["Partição 0\n0, 1, 2, 3, →"]
            P1["Partição 1\n0, 1, 2, →"]
            P2["Partição 2\n0, 1, →"]
        end
    end
    subgraph ng ["notification-group"]
        N0[Consumidor A]
        N1[Consumidor B]
        N2[Consumidor C]
    end
    subgraph ag ["analytics-group"]
        A0[Consumidor X]
    end
    P0 --> N0
    P1 --> N1
    P2 --> N2
    P0 --> A0
    P1 --> A0
    P2 --> A0
```

Cada grupo de consumidores controla seus próprios offsets, então `notification-group` e `analytics-group` avançam pelo log de forma independente. Adicionar um novo grupo de consumidores nunca afeta os grupos existentes.

**Políticas de retenção** controlam por quanto tempo o Kafka mantém as mensagens:

| Política | Configuração | Comportamento |
|---|---|---|
| Por tempo | `retention.ms=604800000` | Apaga mensagens com mais de 7 dias |
| Por tamanho | `retention.bytes=1073741824` | Apaga os segmentos mais antigos quando uma **partição** passa de 1 GB (o limite é por partição, não por tópico) |
| Compactação | `cleanup.policy=compact` | Mantém apenas a última mensagem de cada chave (útil para snapshots de estado) |

`retention.ms=604800000` (7 dias) é o padrão do Kafka; `retention.bytes` tem padrão `-1` (sem limite de tamanho).

### Chaves, partições e ordem

Quando um produtor envia uma mensagem **com chave**, o particionador padrão do Kafka calcula o hash da chave para escolher a partição: a mesma chave sempre vai para a mesma partição (enquanto o número de partições não mudar). Mensagens **sem chave** são espalhadas entre as partições.

Como a ordem só é garantida *dentro* de uma partição, a chave é a forma de escolher **o que** precisa permanecer em ordem. No [Hands-on 9](../../hands-on/9/index.md), o order service envia `kafkaTemplate.send("order-events", order.getId().toString(), event)` — o `orderId` é a chave, então `OrderCreated`, `OrderPaid` e `OrderShipped` de um mesmo pedido são sempre lidos em sequência, enquanto pedidos diferentes são processados em paralelo.

``` mermaid-sim
flowchart LR
    p["order-service<br/>(produtor)"] -->|"key=order-7"| h{"hash(key) % 3"}
    h -->|"order-7 → P1"| P1["Partição 1"]
    h -.->|"outras chaves"| P0["Partição 0"]
    h -.->|"outras chaves"| P2["Partição 2"]
    P1 --> c["consumidor B<br/>lê os eventos de order-7 em ordem"]
```

!!! warning "Escolhendo a chave"
    - Uma chave com poucos valores (por exemplo, `country`) cria **partições quentes** (hot partitions): uma partição recebe a maior parte do tráfego enquanto as outras ficam ociosas.
    - Adicionar partições depois muda `hash(key) % partitions`, então chaves existentes podem migrar para outra partição e perder a ordem por um tempo — dimensione as partições desde o início.
    - Sem chave nenhuma, não há ordem entre eventos relacionados.

### Durabilidade: replicação e `acks`

Em produção, cada partição é **replicada** em vários brokers (fator de replicação, tipicamente 3). Uma réplica é a **líder** e recebe todas as escritas; as outras são **seguidoras** (followers) que a copiam. As réplicas atualizadas formam o **ISR** (in-sync replicas). Se o broker da líder cair, uma seguidora em sincronia é eleita líder.

A configuração `acks` do produtor escolhe quanto disso o produtor espera:

| `acks` | O produtor recebe confirmação quando… | Risco |
|---|---|---|
| `0` | a mensagem foi enviada (sem confirmação) | Perdida se o broker nunca a recebeu |
| `1` | a líder a gravou | Perdida se a líder morrer antes de as seguidoras copiarem |
| `all` | todas as réplicas em sincronia a têm (com `min.insync.replicas` ≥ 2) | Mais lenta, mas sobrevive à perda de um broker |

O Hands-on 9 usa `acks: all` com `enable.idempotence: true`; o produtor idempotente anexa um número de sequência a cada mensagem, para que os retries do próprio produtor não criem duplicatas no log. (Desde o Kafka 3.0, ambos já são o padrão do produtor.)

!!! info "ZooKeeper e KRaft"
    Clusters Kafka mais antigos guardavam seus metadados em um ensemble ZooKeeper separado. Hoje o Kafka tem seu próprio quórum de metadados baseado em Raft (**KRaft**; veja [Consenso](../distributed_systems/consensus/index.md)), e o Kafka 4.0 (2025) removeu completamente o suporte ao ZooKeeper. O [Hands-on 9](../../hands-on/9/index.md) roda o Kafka 4 em modo KRaft: um único nó que é broker e controller ao mesmo tempo.

---

## Padrões de mensageria

### Pub/Sub (fan-out)

Um evento publicado é entregue a **todos** os grupos de consumidores interessados. Cada grupo recebe uma cópia completa e independente da mensagem. Como os grupos controlam seus próprios offsets, um pipeline de analytics lento não afeta o pipeline de notificações.

Casos de uso: notificações por e-mail, logs de auditoria, pipelines de analytics, invalidação de cache.

### Consumidores concorrentes (competing consumers)

Vários consumidores dentro do **mesmo** grupo dividem as partições — cada partição pertence a exatamente um consumidor por vez, então cada mensagem é processada por exatamente um consumidor. Esse padrão permite escalar o processamento horizontalmente sem trabalho duplicado.

Casos de uso: processamento de pedidos, tratamento de pagamentos, jobs de redimensionamento de imagens.

O paralelismo máximo de um grupo é o número de partições: com 3 partições, um quarto consumidor no mesmo grupo fica ocioso. Quando um consumidor entra ou sai, o Kafka faz o **rebalanceamento** (rebalance) do grupo e redistribui as partições.

### Event Sourcing

Em vez de armazenar apenas o estado atual, o sistema armazena o **histórico completo de eventos**[^3]. O estado atual é obtido reprocessando todos os eventos desde o início (ou a partir de um snapshot).

``` mermaid-sim
sequenceDiagram
    actor User
    User->>+CommandHandler: PlaceOrder
    CommandHandler->>+EventStore: append OrderCreated
    EventStore-->>-CommandHandler: ack
    CommandHandler-->>-User: 202 Accepted
    EventStore-->>Projection: evento OrderCreated
    Projection->>ReadModel: atualiza a visão do pedido
```

Isso significa que o modelo de escrita é o próprio log de eventos. As projeções (modelos de leitura) podem ser reconstruídas a partir dos eventos a qualquer momento, o que permite depuração com "viagem no tempo" e migração de esquema sem downtime.

### CQRS (Command Query Responsibility Segregation)

Separe o **lado de escrita** (comandos, eventos, event store) do **lado de leitura** (consultas, projeções, modelo de leitura)[^4]. O lado de escrita é otimizado para consistência e auditabilidade; o lado de leitura, para desempenho de consulta.

``` mermaid-sim
flowchart LR
    client --> |"POST /orders (Comando)"| cmd["Command Handler"]
    cmd --> |"OrderCreated"| bus["Barramento de eventos (Kafka)"]
    bus --> |"projeta"| view["Modelo de leitura\n(otimizado para consultas)"]
    client --> |"GET /orders (Consulta)"| view
    cmd --> |"append"| store["Event Store"]
```

O CQRS costuma ser combinado com Event Sourcing, porque o log de eventos é o modelo de escrita natural. Mas o CQRS também pode ser aplicado sem event sourcing — usando bancos separados de leitura e escrita, mantidos em sincronia via change-data-capture (CDC: uma ferramenta como o Debezium lê o log de transações do banco e publica cada alteração como um evento).

!!! warning "Event sourcing e CQRS não são o padrão"
    Ambos adicionam complexidade real: os eventos precisam ser versionados para sempre, os modelos de leitura são eventualmente consistentes e reconstruir projeções leva tempo. Use-os nas partes do domínio que precisam de trilha de auditoria ou de formatos de leitura e escrita muito diferentes (por exemplo, histórico de pedidos, livros-razão) — não em toda entidade CRUD da loja.

---

## Garantias de entrega e consumidores idempotentes

Um consumidor lê uma mensagem, a processa (por exemplo, envia um e-mail) e **faz o commit do offset** para dizer ao Kafka "terminei até aqui". Uma queda pode acontecer entre quaisquer dois desses passos, e *quando* você faz o commit decide quanto uma queda custa:

| Garantia | Como | Uma queda significa | Uso típico |
|---|---|---|---|
| **At-most-once** | Commit **antes** de processar | A mensagem é **perdida** | Métricas em que uma lacuna é aceitável |
| **At-least-once** | Commit **depois** de processar | A mensagem é **processada de novo** | A escolha padrão — Hands-on 9 (`enable_auto_commit=False` + `commit()` após o processamento) |
| **Exactly-once** | Transações do Kafka (produtor idempotente + `isolation.level=read_committed`) | Nenhuma das duas — mas só para *ler do Kafka → escrever no Kafka* | Processamento de streams (Kafka Streams) |

``` mermaid-sim
sequenceDiagram
    participant K as Kafka
    participant N as notification-service
    participant M as Servidor de e-mail
    K->>N: OrderCreated (offset 42)
    N->>M: envia o e-mail de confirmação
    Note over N: cai antes do commit
    N->>K: (reinício) busca a partir do último offset commitado
    K->>N: OrderCreated (offset 42) de novo
    N->>N: já enviado para o pedido 7? sim → ignora
    N->>K: commit do offset 43
```

O exactly-once *dentro do Kafka* não se estende a efeitos colaterais fora dele: o Kafka não consegue "desenviar" um e-mail nem desfazer uma linha no Postgres. Na prática, os sistemas usam **entrega at-least-once + consumidores idempotentes**: processar a mesma mensagem duas vezes tem o mesmo efeito que processá-la uma vez.

Formas comuns de tornar um consumidor idempotente:

- **Tabela de mensagens processadas**: guarde o ID do evento (ou `orderId` + tipo do evento) no banco do consumidor, na mesma transação da alteração de negócio; ignore eventos já armazenados.
- **Idempotência natural**: use operações de escrita idempotentes por natureza — `UPSERT`, "definir status como PAID" em vez de "somar 10 ao saldo".
- **Restrições de unicidade**: deixe o banco rejeitar a segunda inserção do mesmo `orderId`.

---

## Mantendo os serviços consistentes

### O problema da escrita dupla (dual write)

No Hands-on 9, o order service salva o pedido no Postgres e *depois* publica `OrderCreated` no Kafka. São dois sistemas diferentes, e nenhuma transação cobre os dois:

- O commit no banco funciona, e o serviço cai antes de publicar → o pedido existe, mas ninguém nunca é avisado.
- O evento é publicado, e a transação do banco sofre rollback → os consumidores reagem a um pedido que não existe.

### Transactional outbox

O **transactional outbox**[^2] elimina a escrita dupla. O serviço grava o evento em uma tabela `outbox` **na mesma transação local do banco** que o pedido. Um relay separado (um job de polling, ou CDC com Debezium) lê o outbox e publica no Kafka, marcando as linhas como enviadas.

``` mermaid-sim
sequenceDiagram
    participant O as order-service
    participant DB as Postgres
    participant R as Relay do outbox
    participant K as Kafka
    O->>DB: BEGIN
    O->>DB: INSERT INTO orders ...
    O->>DB: INSERT INTO outbox (OrderCreated)
    O->>DB: COMMIT (ambos ou nenhum)
    R->>DB: lê as linhas não enviadas do outbox
    R->>K: publica OrderCreated
    R->>DB: marca a linha como enviada
```

Se o relay cair depois de publicar, mas antes de marcar a linha, o evento é publicado de novo — mais um motivo para os consumidores serem idempotentes.

### Sagas

Algumas operações de negócio atravessam vários serviços: fazer um pedido exige reservar estoque (product service) e cobrar o cliente (payment service). Cada serviço tem seu próprio banco, então uma única transação ACID é impossível (veja [Microsserviços](../microservices/index.md)). Uma **saga**[^2] é uma sequência de transações locais, uma por serviço, em que cada passo é disparado pelo evento do passo anterior. Se um passo falha, a saga executa **transações de compensação** que desfazem semanticamente os passos já realizados (liberar o estoque, estornar o pagamento).

``` mermaid-sim
sequenceDiagram
    participant O as Pedido
    participant I as Estoque
    participant P as Pagamento
    O->>I: OrderCreated
    I->>P: StockReserved
    P->>I: PaymentFailed
    I->>O: StockReleased (compensação)
    O->>O: marca o pedido como CANCELLED
```

| Estilo | Como é coordenado | Vantagem | Cuidado |
|---|---|---|---|
| **Coreografia** | Cada serviço reage aos eventos dos outros (diagrama acima) | Sem componente central, baixo acoplamento | O fluxo fica espalhado por muitos serviços; difícil de acompanhar e de mudar |
| **Orquestração** | Um orquestrador da saga envia comandos e espera as respostas | O fluxo fica explícito em um só lugar | O orquestrador é mais um serviço para construir e operar |

!!! warning "Sagas não são transações"
    Uma saga abre mão do isolamento: outras requisições podem ver o estado intermediário (estoque reservado, pagamento ainda não feito). Projete os estados explicitamente (`PENDING`, `CONFIRMED`, `CANCELLED`) e torne idempotentes todos os passos e todas as compensações.

---

## Dead Letter Queue

Quando um consumidor falha repetidamente ao processar uma mensagem, ele não pode bloquear o resto do stream. Uma **Dead Letter Queue (DLQ)** é um tópico separado para onde as mensagens são movidas depois de esgotadas as tentativas de retry, permitindo que o stream principal continue enquanto as mensagens com falha são investigadas e reprocessadas manualmente.

``` mermaid-sim
stateDiagram-v2
    [*] --> Pending
    Pending --> Processing : consumidor pega a mensagem
    Processing --> Committed : sucesso
    Processing --> Retry : falha transitória (tentativa < máx.)
    Retry --> Processing : após o backoff
    Processing --> DLQ : máximo de retries excedido
    DLQ --> Processing : reprocessamento manual
```

!!! tip "Spring Kafka"
    A anotação `@RetryableTopic` do Spring Kafka cuida automaticamente do agendamento dos retries e do roteamento para a DLQ. Configure `attempts`, `backoff` e o nome do tópico da DLQ de forma declarativa, sem código repetitivo de tratamento de erros.

    ```java
    // default: 3 attempts in total; Spring Kafka 4 (Spring Boot 4) annotation
    @RetryableTopic(backOff = @BackOff(delay = 1000, multiplier = 2))
    @KafkaListener(topics = "order-events", groupId = "invoice-group")
    public void onOrderCreated(OrderCreatedEvent event) {
        invoiceService.create(event);   // throws → retried after 1 s, then 2 s
    }

    @DltHandler
    public void onDeadLetter(OrderCreatedEvent event) {
        log.error("order {} sent to the dead letter topic", event.orderId());
    }
    ```

Faça retry apenas das falhas que podem dar certo depois (um banco brevemente indisponível). Uma mensagem que *nunca* poderá ser processada — JSON inválido, um ID de produto desconhecido — deve ir direto para a DLQ; fazer retry dela só atrasa o resto da partição.

---

## Quando usar (e quando não usar) eventos

| Cenário | Melhor opção | Motivo |
|---|---|---|
| Login / geração de token de autenticação | REST | Quem chama precisa do token de forma síncrona |
| E-mail de confirmação do pedido | Evento | O usuário não espera; o e-mail pode atrasar |
| Verificação de fraude em tempo real (precisa bloquear) | REST | É preciso a resposta antes de prosseguir |
| Log de auditoria de todas as alterações de pedidos | Evento | Fire-and-forget, fan-out |
| Processamento de pagamento | Depende | Se o retry idempotente for garantido: evento. Se for preciso confirmação bloqueante: REST + saga |
| Pipeline de dados de analytics | Evento | Alto volume, consumidores podem ser lentos |
| Health check de serviço | REST | Síncrono por natureza |

!!! warning "Complexidade operacional"
    Sistemas orientados a eventos são mais difíceis de depurar do que REST. Uma requisição que passa por 5 serviços e 3 tópicos do Kafka exige rastreamento distribuído (visto na aula de [Observabilidade](../observability/index.md)) para ser diagnosticada. Não adote a arquitetura orientada a eventos por si só — adote-a quando os custos de acoplamento e latência das chamadas síncronas virarem problemas concretos.

!!! warning "Erros comuns"
    - **Supor exactly-once**: duplicatas *vão* chegar; todo consumidor precisa ser idempotente.
    - **Escritas duplas**: salvar no banco e publicar no Kafka sem um outbox perde ou inventa eventos após uma queda.
    - **Quebrar o esquema do evento**: consumidores que você não conhece leem seus eventos. Apenas adicione campos opcionais; nunca renomeie nem remova campos sem uma nova versão (`OrderCreatedV2`) — um schema registry com Avro ou Protobuf pode garantir isso.
    - **Ignorar o lag do consumidor**: o gráfico de profundidade da fila acima é real. Monitore o lag de cada grupo de consumidores (Kafka UI, Prometheus) e gere alertas quando ele crescer.
    - **Eventos que são comandos disfarçados**: `SendEmailToCustomer` acopla o produtor a um consumidor; publique o fato (`OrderCreated`) e deixe os consumidores decidirem.

---

## Conexões

- [Hands-on 9](../../hands-on/9/index.md) — Kafka na loja: `OrderCreated` publicado pelo order service e consumido pelo notification service, com uma DLQ.
- [Microsserviços](../microservices/index.md) — um banco por serviço, o motivo pelo qual sagas e outboxes são necessários.
- [Sistemas distribuídos](../distributed_systems/index.md) — consistência eventual, ordem e consenso (KRaft).
- [Confiabilidade](../reliability/index.md) — retries, backoff e idempotência também se aplicam aos consumidores.
- [Observabilidade](../observability/index.md) e [Hands-on 10](../../hands-on/10/index.md) — rastreando uma requisição através dos tópicos.

## Pontos-chave

- Use **eventos** quando quem chama não precisa da resposta para continuar; use uma **requisição síncrona** quando precisa.
- O Kafka é um **log** replicado e particionado: a ordem vale dentro de uma partição, a **chave** decide a partição e cada grupo de consumidores mantém seus próprios offsets — grupos diferentes fazem fan-out, o mesmo grupo divide o trabalho.
- Na prática, a entrega é **at-least-once**: faça o commit depois de processar e torne todo consumidor **idempotente**.
- Nunca faça escrita dupla: o **transactional outbox** publica eventos de forma confiável; **sagas** com compensações substituem transações distribuídas.
- **Event sourcing** e **CQRS** são poderosos em domínios específicos, não são o padrão; uma **DLQ** impede que mensagens envenenadas bloqueiem uma partição.

---

[^1]: NARKHEDE, N.; SHAPIRA, G.; PALINO, T. *Kafka: The Definitive Guide*, 2nd ed. O'Reilly, 2021.
[^2]: RICHARDSON, C. [Microservices Patterns](https://microservices.io){target="_blank"} — Event Sourcing, CQRS, Saga.
[^3]: FOWLER, M. [Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html){target="_blank"}, 2005.
[^4]: YOUNG, G. [CQRS Documents](https://cqrs.files.wordpress.com/2010/11/cqrs_documents.pdf){target="_blank"}, 2010.
