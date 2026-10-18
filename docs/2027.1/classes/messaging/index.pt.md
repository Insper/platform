São 09:59:58 e um show em estádio está prestes a abrir as vendas no BoxOffice. Às 10:00, dois milhões de fãs apertam "Comprar" para sessenta mil lugares. Por trás desse botão, a primeira versão do BoxOffice faz tudo em uma única requisição síncrona: reserva os lugares, cobra o cartão, envia o e-mail, manda uma notificação push para o celular, atualiza o índice de busca e registra a venda para o analytics. O provedor de e-mail está um pouco lento hoje (800 ms em vez de 80 ms), então cada compra passa a levar um segundo a mais, o serviço `order` fica sem threads e os fãs que estavam prestes a pagar veem um spinner e depois um erro. Nada estava *quebrado* — o sistema simplesmente foi ligado de um jeito em que cada passo precisava terminar antes que qualquer usuário recebesse uma resposta.

Esta aula é sobre a outra forma de ligar os serviços: **mensagens**. Em vez de chamar cada serviço e esperar, um serviço escreve uma mensagem em um broker e segue em frente; quem precisa dela a lê quando puder. Bem feita, a mensageria absorve picos, desacopla times e tira serviços lentos ou com falha do caminho crítico. Feita sem cuidado, perde pedidos, duplica e-mails e esconde falhas em uma fila que ninguém observa. Vamos aprender os dois lados.

!!! abstract "Objetivos de aprendizagem"

    Ao final desta aula você deve ser capaz de:

    - **Decidir** se uma interação entre dois serviços do BoxOffice deve ser uma chamada síncrona, um comando enfileirado ou um evento publicado, e **justificar** a escolha com argumentos de latência, disponibilidade e acoplamento.
    - **Comparar** filas de mensagens, tópicos pub/sub e logs de eventos, e **escolher** o componente certo da paleta (`queue`, `pubsub`, `stream`, `kafka`) para um requisito.
    - **Explicar** como o Kafka armazena e entrega dados — tópicos, partições, offsets, consumer groups, replicação, retenção e compactação — e **dimensionar** o número de partições para um throughput-alvo.
    - **Estimar** backlog, consumer lag e tempo de escoamento sob um pico de tráfego, e **projetar** backpressure para uma fila.
    - **Explicar** entrega at-most-once, at-least-once e exactly-once, e **implementar** um consumidor idempotente e uma dead letter queue.
    - **Aplicar** transactional outbox, change data capture, sagas (coreografia e orquestração), CQRS e event sourcing para manter serviços consistentes sem transações distribuídas.
    - **Evoluir** o schema de um evento sem quebrar os consumidores.

## Roteiro

1. **Esta visão geral** — síncrono vs assíncrono, o que um broker oferece (e quanto custa), nivelamento de carga em números, o vocabulário e os quatro componentes de mensageria da paleta.
2. [Filas e pub/sub](queues-pubsub/index.md) — filas ponto a ponto, consumidores concorrentes, confirmações, backpressure, a sala de espera da flash sale e o fan-out do pub/sub.
3. [Kafka e logs de eventos](kafka/index.md) — a abstração de log, partições, chaves e ordenação, consumer groups, replicação, retenção, compactação e dimensionamento de partições.
4. [Semântica de entrega](semantics/index.md) — at-most/at-least/exactly-once, consumidores idempotentes, ordenação, retries e dead letter queues, evolução de schema.
5. [Padrões](patterns/index.md) — transactional outbox, change data capture, sagas, CQRS e event sourcing, todos aplicados à compra no BoxOffice.
6. [Quiz](quiz.md) — teste seu entendimento.

## Slides

<div class="slides-embed">
  <iframe src="slides/messaging.html" title="Slides: mensageria e arquitetura orientada a eventos" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/messaging.html){:target="_blank"}

---

## Síncrono vs assíncrono { #sync-vs-async }

Em uma interação **síncrona**, quem chama envia uma requisição e **espera** a resposta antes de continuar — uma chamada HTTP ou gRPC. Em uma interação **assíncrona**, quem chama entrega uma mensagem a um intermediário (um **broker**) e continua imediatamente; o receptor processa a mensagem depois, possivelmente muito depois, possivelmente em outro continente.

Compare as duas versões da compra no BoxOffice. O usuário clica em "Comprar"; o serviço `order` precisa criar o pedido, e outros cinco serviços precisam ficar sabendo dele.

=== "Cadeia síncrona"

    ``` mermaid-sim
    sequenceDiagram
        autonumber
        participant U as Fã
        participant O as order
        participant N as notification
        participant S as search
        participant A as analytics
        U->>+O: POST /orders
        O->>+N: envia e-mail + push
        N-->>-O: ok (800 ms hoje)
        O->>+S: atualiza "lugares restantes"
        S-->>-O: ok
        O->>+A: registra a venda
        A-->>-O: ok
        O-->>-U: 201 Created (depois de todos eles)
    ```

    O tempo de resposta é a **soma** de todas as chamadas, e a compra falha se **qualquer** uma delas falhar.

=== "Eventos assíncronos"

    ``` mermaid-sim
    sequenceDiagram
        autonumber
        participant U as Fã
        participant O as order
        participant K as Kafka
        participant N as notification
        participant S as search
        participant A as analytics
        U->>+O: POST /orders
        O->>K: publica OrderConfirmed
        O-->>-U: 201 Created
        K-->>N: OrderConfirmed
        K-->>S: OrderConfirmed
        K-->>A: OrderConfirmed
    ```

    O tempo de resposta é o tempo de salvar o pedido e publicar uma mensagem. Cada consumidor lê o evento de forma independente, no seu próprio ritmo.

A diferença não é só velocidade. Ela aparece em três números que você já sabe calcular (veja [Estimativas](../estimation/index.md)):

| Propriedade | Cadeia síncrona | Eventos assíncronos |
|---|---|---|
| **Latência** vista pelo fã | $t_{order} + t_{notif} + t_{search} + t_{analytics}$ | $t_{order} + t_{publish}$ |
| **Disponibilidade** do "Comprar" | $A_{order} \times A_{notif} \times A_{search} \times A_{analytics}$ | $A_{order} \times A_{broker}$ |
| **Acoplamento** | `order` conhece cada consumidor e sua API | `order` conhece o nome de um tópico e o schema do evento |
| **Consistência** | tudo está feito quando o usuário vê "201" | os consumidores alcançam depois (**consistência eventual**) |
| **Falha de um consumidor** | a compra falha | o backlog do consumidor cresce; a compra continua funcionando |
| **Depuração** | uma requisição, uma pilha de chamadas | um fluxo espalhado por tópicos e serviços: exige tracing |

!!! example "BoxOffice: disponibilidade do botão Comprar"

    Suponha que `order` tenha 99,95% de disponibilidade e cada um dos três serviços seguintes, 99,9%. De forma síncrona, a compra precisa dos quatro:

    $$
    A = 0.9995 \times 0.999^3 \approx 99.65\%
    $$

    São cerca de 2,5 horas de compras com falha por mês. Com eventos, a compra precisa de `order` e do broker (um cluster Kafka replicado, digamos 99,95%):

    $$
    A = 0.9995 \times 0.9995 \approx 99.90\%
    $$

    Os serviços seguintes ainda podem falhar — mas agora a falha deles atrasa um e-mail em vez de perder uma venda.

??? question "Pense antes: a reserva de lugares também deveria ser assíncrona?"

    Não. Quando o fã clica em um lugar, ele precisa saber **agora** se o lugar é dele. Uma reserva é uma pergunta cuja resposta quem chama precisa para continuar, e ela precisa ser fortemente consistente (nada de venda duplicada). Ela continua sendo uma chamada síncrona ao `inventory` (veja [Transações](../databases/transactions/index.md)). Assincronia é para trabalho cujo resultado quem chama **não** precisa para continuar: notificações, atualização da busca, analytics, notas fiscais.

    A regra prática: **se quem chama precisa da resposta para continuar, chame; se só precisa que o trabalho aconteça em algum momento, envie uma mensagem.**

---

## O que um broker oferece

Um **message broker** é um servidor que recebe mensagens de **produtores**, as armazena de forma durável e as entrega a **consumidores**[^1]. Colocar um broker entre dois serviços traz quatro propriedades que uma chamada direta não traz:

1. **Desacoplamento temporal.** Produtor e consumidor não precisam estar no ar ao mesmo tempo. Se o `notification` está sendo reimplantado, os eventos `OrderConfirmed` esperam no broker.
2. **Nivelamento de carga.** O broker é um buffer: produtores podem escrever mais rápido do que os consumidores leem por um tempo, e o backlog escoa depois. Um pico vira uma fila em vez de uma indisponibilidade.
3. **Fan-out.** Um evento publicado pode ser entregue a muitos consumidores independentes. Adicionar um novo consumidor (detecção de fraude, programa de fidelidade) não mexe no produtor.
4. **Escala independente e isolamento de falhas.** Cada consumidor escala com a própria carga e falha sozinho. Um pipeline de analytics lento não atrasa os e-mails.

Nada é de graça. O preço da assincronia:

- **Consistência eventual.** Por um tempo, a página de busca pode ainda mostrar "120 lugares restantes" quando já são 80. O sistema precisa ser projetado (e a interface, redigida) para isso[^2].
- **Duplicatas e reordenação.** A maioria dos brokers entrega *at least once*: consumidores vão ver a mesma mensagem duas vezes e precisam ser **idempotentes** (veja [Semântica de entrega](semantics/index.md)).
- **Depuração mais difícil.** Uma compra agora é uma cadeia de eventos entre tópicos; sem tracing distribuído e métricas de consumer lag, as falhas se escondem em um backlog (veja [Observabilidade](../observability/index.md)).
- **Mais um sistema crítico.** O broker precisa ser replicado, monitorado, atualizado e ter sua capacidade planejada.

### Nivelamento de carga em números

A flash sale é o caso clássico de nivelamento de carga. As requisições de compra dos fãs chegam muito mais rápido do que o `inventory` consegue processar reservas, mas só por alguns minutos. Se o `order` chamasse o `inventory` diretamente, o excesso viraria timeouts e erros. Com uma fila no meio, o excesso vira **backlog** — mensagens esperando — e o único custo é tempo de espera.

A simulação abaixo usa números ilustrativos: 200 requisições/s antes das 10:00, um pico de 6.000 requisições/s por três minutos e depois uma multidão que diminui devagar. Os workers processam 2.000 ou 4.000 requisições/s.

```python exec="1" html="1"
import matplotlib.pyplot as plt
from io import StringIO

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "xtick.color": "#888",
                     "ytick.color": "#888", "axes.edgecolor": "#888", "svg.fonttype": "none"})

# BoxOffice purchase requests from 09:58 to 10:20, one point per second (illustrative numbers)
def arrivals(t):                      # t = seconds after 09:58
    if t < 120:
        return 200                    # normal traffic before the on-sale
    if t < 300:
        return 6000                   # 10:00-10:03: the flash-sale spike
    return 200 + 2800 * 0.99 ** (t - 300)   # the crowd thins out slowly

seconds = range(22 * 60)
lam = [arrivals(t) for t in seconds]
minutes = [t / 60 for t in seconds]

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4))
ax1.plot(minutes, lam, color="#e53935", lw=2, label="arrivals (requests/s)")
for mu, color in [(2000, "#1976d2"), (4000, "#388e3c")]:
    backlog, b = [], 0
    for a in lam:
        b = max(0, b + a - mu)        # what arrives and cannot be processed waits
        backlog.append(b)
    ax1.axhline(mu, color=color, ls="--", lw=1.5, label=f"worker capacity {mu}/s")
    ax2.plot(minutes, [x / 1000 for x in backlog], color=color, lw=2,
             label=f"{mu}/s: peak {max(backlog) / 1000:.0f}k, wait {max(backlog) / mu / 60:.1f} min")
ax1.set_xlabel("minutes after 09:58")
ax1.set_ylabel("requests per second")
ax1.set_title("Arrivals vs consumer capacity")
ax1.legend(fontsize=8)
ax2.set_xlabel("minutes after 09:58")
ax2.set_ylabel("backlog (thousand messages)")
ax2.set_title("Queue backlog")
ax2.legend(fontsize=8)
for ax in (ax1, ax2):
    ax.grid(True, alpha=0.3)
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

Três coisas para ler no gráfico:

- **O backlog cresce na diferença das taxas.** Durante o pico ele cresce $6000 - 2000 = 4000$ mensagens por segundo com o pool menor de workers: em três minutos, $4000 \times 180 = 720{,}000$ mensagens.
- **A espera é o backlog dividido pelo throughput** — a Lei de Little de novo (veja [Filas](../estimation/queueing/index.md)): $720{,}000 / 2000 = 360$ s, seis minutos para o último fã da fila. Dobrar os workers reduz o pico pela metade *e* o escoa muito mais rápido.
- **O backlog só escoa quando as chegadas caem abaixo da capacidade.** Se a taxa média de chegada fica acima da capacidade, nenhuma fila salva você: o backlog cresce para sempre. Uma fila absorve **picos**, não uma falta permanente de capacidade.

!!! info "Experimente no playground"

    O cenário `async-queue` coloca uma fila e um pool de workers atrás de um servidor de aplicação. Aperte **Run** com o perfil **spike** e observe a profundidade da fila e o consumer lag. Depois (1) reduza o número de workers e veja o backlog crescer e o atraso de ponta a ponta subir enquanto a latência da API continua estável; (2) aumente os workers até o backlog escoar em até um minuto depois do pico. Abra o [playground completo](../../../playground/index.md) para adicionar uma regra de autoscaling pela profundidade da fila.

<div class="sdp" data-scenario="async-queue" data-mode="compact" data-profile="spike" data-height="520"></div>

---

## O vocabulário

Mensageria tem muitas palavras para coisas parecidas. Estas são as que usamos no curso.

| Termo | Significado | Exemplo no BoxOffice |
|---|---|---|
| **Mensagem** | Qualquer unidade de dados enviada por um broker: cabeçalhos + payload | Qualquer um dos abaixo |
| **Comando** | Um pedido para que um receptor específico *faça* algo; pode ser rejeitado | `GenerateTicketPdf { orderId }` na fila `ticket-pdf` |
| **Evento** | Um fato imutável sobre algo que *já aconteceu*; o produtor não sabe quem reage | `OrderConfirmed { orderId, eventId, seats, total }` |
| **Produtor / publisher** | O serviço que escreve mensagens | `order` |
| **Consumidor / subscriber** | O serviço que as lê | `notification`, `search`, `analytics` |
| **Broker** | O servidor (cluster) que armazena e entrega mensagens | Kafka, RabbitMQ, Amazon SQS |
| **Fila** | Um canal em que cada mensagem é processada por **um** consumidor | `ticket-pdf` |
| **Tópico** | Um canal em que cada mensagem é entregue a **toda** assinatura | `order-events` |
| **Backlog / consumer lag** | Mensagens escritas mas ainda não processadas | "o notification está 42.000 mensagens atrasado" |
| **Confirmação (ack)** | O consumidor dizendo ao broker "feito, pode esquecer/avançar" | `basicAck`, commit de offset |

!!! tip "Nomeie eventos no passado"
    Um evento é um fato: `OrderConfirmed`, `SeatsReleased`, `PaymentFailed`. Um nome no imperativo — `SendConfirmationEmail` — é um comando disfarçado: acopla o produtor a um consumidor e a uma ação. Publique o que aconteceu e deixe cada consumidor decidir o que fazer com isso.

### O que vai dentro de um evento

Martin Fowler distingue várias coisas que as pessoas querem dizer com "orientado a eventos"[^3]. Duas delas mudam a forma de projetar o payload:

=== "Notificação de evento"

    O evento carrega pouco mais que um identificador. Consumidores que precisam de detalhes chamam o produtor de volta.

    ```json
    { "type": "OrderConfirmed", "eventId": "e-9f2c", "orderId": "o-7731", "occurredAt": "2027-03-14T10:00:07Z" }
    ```

    Pequeno e estável, mas cada consumidor gera carga no `order` (e depende de ele estar no ar) para buscar os detalhes.

=== "Transferência de estado no evento"

    O evento carrega os dados de que os consumidores precisam, então eles nunca chamam de volta.

    ```json
    {
      "type": "OrderConfirmed", "eventId": "e-9f2c", "orderId": "o-7731",
      "occurredAt": "2027-03-14T10:00:07Z",
      "customer": { "id": "c-12", "email": "ana@example.com", "locale": "pt-BR" },
      "event": { "id": "ev-88", "name": "Stadium Show", "startsAt": "2027-05-01T21:00:00-03:00" },
      "seats": ["B-12", "B-13"], "total": { "amount": 780.00, "currency": "BRL" }
    }
    ```

    Os consumidores ficam totalmente desacoplados da disponibilidade do `order`, ao preço de um payload maior, de um schema mais difícil de mudar e de dados pessoais (o e-mail) copiados para todos os consumidores.

Os outros dois significados — **event sourcing** e **CQRS** — são padrões de arquitetura tratados em [Padrões](patterns/index.md).

---

## A paleta de mensageria

O [System Design Playground](../../../playground/index.md) tem quatro componentes de mensageria. Não são quatro marcas; são quatro *formas* de comunicação. O [catálogo de componentes](../../reference/components/messaging/index.md) tem os detalhes de cada um.

| Componente | Forma | Quem recebe uma mensagem | Depois de consumida | Ordenação | Produtos típicos |
|---|---|---|---|---|---|
| [`queue`](../../reference/components/messaging/index.md#queue) Message Queue | ponto a ponto | **um** consumidor do pool | apagada | em geral nenhuma (filas FIFO: por grupo) | Amazon SQS, RabbitMQ, filas do Azure Service Bus, Google Cloud Tasks |
| [`pubsub`](../../reference/components/messaging/index.md#pubsub) Pub/Sub | fan-out | **toda** assinatura (uma cópia para cada) | apagada por assinatura | em geral nenhuma (chaves de ordenação opcionais) | Google Cloud Pub/Sub, Amazon SNS, tópicos do Azure Service Bus, NATS, Redis Pub/Sub |
| [`stream`](../../reference/components/messaging/index.md#stream) Event Stream | log particionado (gerenciado) | todo consumer group, cada um na sua posição | **mantida** até a retenção expirar | por partição / shard | Amazon Kinesis Data Streams, Azure Event Hubs, Redis Streams |
| [`kafka`](../../reference/components/messaging/index.md#kafka) Kafka | log particionado e replicado | todo consumer group, cada um na sua posição | **mantida** até a retenção expirar (ou compactada) | por partição | Apache Kafka, Confluent Cloud, Amazon MSK, Redpanda |

A pergunta decisiva é o que acontece com uma mensagem **depois que ela é lida**:

- Em uma **fila**, ler é *tirar*: a mensagem some quando confirmada. Ótimo para distribuir trabalho.
- Em um **log**, ler é *olhar*: a mensagem fica, e cada leitor guarda um marcador. Ótimo para muitos leitores independentes, replay e histórico.

``` mermaid
flowchart TD
    q1{"Quem chama precisa da<br/>resposta para continuar?"}
    q1 -->|sim| sync["Chamada síncrona<br/>(REST / gRPC) + timeout"]
    q1 -->|não| q2{"Quantos serviços<br/>precisam reagir?"}
    q2 -->|"exatamente um<br/>(um trabalho a fazer)"| queue["queue<br/>consumidores concorrentes"]
    q2 -->|"muitos, cada um com sua cópia"| q3{"Precisa de replay, ordem<br/>por chave ou alto throughput?"}
    q3 -->|não| pubsub["pubsub<br/>tópico + assinaturas"]
    q3 -->|sim| log["stream / kafka<br/>log particionado"]
```

### Quando *não* usar assincronia

| Interação no BoxOffice | Melhor escolha | Por quê |
|---|---|---|
| Fazer login, obter um token | Síncrona | O usuário precisa do token agora |
| Reservar os lugares B-12 e B-13 | Síncrona | O usuário precisa saber agora; precisa ser fortemente consistente |
| Autorizar o cartão | Síncrona com chave de idempotência, ou assíncrona com página de status | O usuário espera o resultado, mas o provedor pode ser lento (veja [Integrações](../compute/integrations/index.md)) |
| Entrar na sala de espera da abertura de vendas | **Fila** | Admitir fãs na taxa que o `inventory` aguenta |
| Enviar e-mail e push depois da compra | **Evento** (`pubsub` ou `kafka`) | O usuário não espera; pode atrasar alguns segundos |
| Atualizar "lugares restantes" na busca | **Evento** / change data capture | Consistência eventual é aceitável para navegação |
| Gerar o ingresso em PDF | **Fila** (comando) | Um worker deve fazer isso uma vez; retries são aceitáveis |
| Alimentar o data warehouse | **Event stream** | Alto volume, com replay, muitos leitores |

## O mapa de conceitos de mensageria { #concept-map }

Toda mensagem percorre o mesmo caminho: um produtor a entrega a um dos quatro componentes de mensageria, e um consumidor a processa depois. O mapa liga cada **componente da paleta** (verde) aos **conceitos** desta aula (azul) e às aulas que os continuam:

``` mermaid
flowchart LR
    order["app (order)<br/>produtor"]:::comp --> queue["queue"]:::comp
    order --> pubsub["pubsub"]:::comp
    order --> log["stream · kafka"]:::comp
    queue --> worker["worker"]:::comp
    pubsub --> cons["notifications · search ·<br/>analytics"]:::comp
    log --> cons
    order -.- c0["síncrono vs assíncrono, outbox,<br/>sagas, CQRS, event sourcing"]:::tech
    queue -.- c1["consumidores concorrentes, ack,<br/>backpressure, sala de espera"]:::tech
    pubsub -.- c2["fan-out, assinaturas,<br/>push/pull, filtros"]:::tech
    log -.- c3["partições, chaves, offsets,<br/>consumer groups, retenção"]:::tech
    worker -.- c4["pelo menos uma vez, consumidor idempotente,<br/>ordenação, DLQ, schemas"]:::tech
    c3 -.- d1["consenso, KRaft<br/>(aula 3)"]
    c4 -.- d2["retries, SLO de atualidade<br/>(aula 9)"]
    c4 -.- d3["consumer lag, tracing<br/>(aula 10)"]
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

| Componente da paleta | Pergunta que responde | Conceitos | Ensinado em | Cenários |
|---|---|---|---|---|
| [`app`](../../reference/components/compute/index.md#app) | Chamar e esperar, ou enviar uma mensagem? | síncrono vs assíncrono, disponibilidade de uma cadeia, consistência eventual, comandos vs eventos | [esta visão geral](#sync-vs-async) | `async-queue` |
| [`queue`](../../reference/components/messaging/index.md#queue) | Quem faz este *trabalho*, e em que taxa? | consumidores concorrentes, ack e visibility timeout, backpressure, sala de espera | [Filas e pub/sub](queues-pubsub/index.md), [a sala de espera](queues-pubsub/index.md#the-flash-sale-waiting-room) | `async-queue`, `flash-sale` |
| [`pubsub`](../../reference/components/messaging/index.md#pubsub) | Como *cada* serviço interessado recebe a sua cópia? | tópico, assinaturas, push/pull, filtros, durável vs efêmero | [Filas e pub/sub](queues-pubsub/index.md#pubsub) | `notification-system`, `chat` |
| [`stream`](../../reference/components/messaging/index.md#stream) · [`kafka`](../../reference/components/messaging/index.md#kafka) | Quem precisa de *histórico*, replay e ordem por chave? | log, partições, chaves, consumer groups, lag, replicação, retenção, compactação | [Kafka e logs de eventos](kafka/index.md) | `event-fanout` |
| [`worker`](../../reference/components/compute/index.md#worker) · [`notifications`](../../reference/components/compute/index.md#notifications) · [`search`](../../reference/components/compute/index.md#search) · [`analytics`](../../reference/components/compute/index.md#analytics) | E se uma mensagem chegar *duas vezes*, atrasada, fora de ordem ou quebrada? | pelo menos uma vez, consumidor idempotente, atualizações guardadas por versão, DLQ, evolução de schema | [Semântica de entrega](semantics/index.md) | `notification-system`, `payment-system` |
| [`sql`](../../reference/components/storage/index.md#sql) + [`kafka`](../../reference/components/messaging/index.md#kafka) · [`payment`](../../reference/components/external/index.md#payment) | Como altero meus dados *e* publico, entre serviços, sem 2PC? | transactional outbox, CDC, sagas, CQRS, event sourcing | [Padrões](patterns/index.md) | `payment-system`, `flash-sale` |

!!! tip "Na entrevista"
    Entrevistadores prestam atenção no *porquê* de você adicionar uma fila. "Vou colocar Kafka aqui", sozinho, é um sinal ruim; "o e-mail não precisa bloquear a compra, então o `order` publica `OrderConfirmed` e o `notification` consome — isso tira o provedor de e-mail da cadeia de disponibilidade da compra e absorve o pico das 10:00 como backlog" é um sinal forte. Sempre continue com as consequências que você vai tratar: duplicatas (consumidor idempotente), ordenação (chave por `orderId`), falhas (retries + DLQ) e monitoramento (consumer lag)[^4].

!!! warning "Armadilhas comuns"

    - **Assincronia para tudo.** Transformar uma pergunta que precisa de resposta ("este lugar está livre?") em mensagem adiciona latência, complexidade e um loop de polling, e não ganha nada.
    - **Uma fila como plano de capacidade.** Uma fila absorve picos; ela não conserta um consumidor permanentemente mais lento que o produtor. Observe a tendência do backlog.
    - **Ninguém observa o backlog.** Uma fila sem monitoramento transforma uma indisponibilidade em um atraso silencioso: a API está verde enquanto os e-mails estão três horas atrasados. Alerte sobre o consumer lag e sobre a idade da mensagem mais antiga.
    - **Supor exactly-once.** Planeje para duplicatas desde o primeiro dia.
    - **Escrita dupla.** Salvar no banco e depois publicar no broker perde ou inventa eventos depois de um crash; use o [transactional outbox](patterns/index.md#transactional-outbox).

---

## Relacionados

- **Hands-on:** [Hands-on 7 — Assíncrono](../../hands-on/7/index.md): Kafka, transactional outbox no `order`, consumidor idempotente no `notification`, DLQ e a fila da sala de espera.
- **Exercício:** [Exercício orientado a eventos](../../exercises/event-driven/index.md) — outbox + consumidor idempotente.
- **Estudos de caso:** [Venda de ingressos (flash sale do BoxOffice)](../case-studies/ticketing/index.md), [Sistema de notificações](../case-studies/notification-system/index.md), [Sistema de pagamentos](../case-studies/payment-system/index.md), [Chat](../case-studies/chat/index.md).
- **Aulas:** [Computação — trabalho assíncrono](../compute/async-work/index.md) (workers e schedulers), [Confiabilidade](../reliability/index.md) (retries, backoff, idempotência), [Observabilidade](../observability/index.md) (consumer lag e tracing entre tópicos).

---

[^1]: HOHPE, G.; WOOLF, B. *Enterprise Integration Patterns: Designing, Building, and Deploying Messaging Solutions*. Addison-Wesley, 2003. Veja também [enterpriseintegrationpatterns.com](https://www.enterpriseintegrationpatterns.com){target="_blank"}.
[^2]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2. ed. O'Reilly. Capítulo sobre processamento de streams.
[^3]: FOWLER, M. [What do you mean by "Event-Driven"?](https://martinfowler.com/articles/201701-event-driven.html){target="_blank"}. martinfowler.com, 2017.
[^4]: XU, A. *System Design Interview — An Insider's Guide*, vol. 2. ByteByteGo, 2022. Capítulo "Distributed Message Queue".
