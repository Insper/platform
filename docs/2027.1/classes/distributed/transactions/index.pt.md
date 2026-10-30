A fã segurou o assento A-12 e toca em **Pagar R$ 450**. Agora três coisas precisam acontecer juntas: o `inventory` muda o assento de `HELD` para `SOLD`, o `payment` cobra o cartão por meio de um provedor externo e o `order` registra um pedido confirmado. Dentro de um único banco PostgreSQL isso seria uma única transação — `BEGIN … COMMIT`, tudo ou nada. Mas as três partes vivem em **três serviços com três bancos de dados** (e uma delas é de outra empresa). O que acontece quando a cobrança dá certo e o banco do `inventory` está fora do ar? Ou quando o assento é marcado `SOLD` e a cobrança é recusada?

Uma **transação distribuída** é uma unidade de trabalho que altera dados em vários nós e precisa ser **atômica**: ou todas as mudanças acontecem, ou nenhuma acontece. Esta página mostra o protocolo clássico que garante isso — o **two-phase commit (2PC)** —, por que ele raramente é usado entre microsserviços e o que o substitui na prática: **sagas**, o padrão de **reserva (try–confirm–cancel)** e o **outbox transacional**.

---

## Atomicidade entre nós: o problema { #atomicity-across-nodes-the-problem }

Em um único nó, a atomicidade vem do log do banco de dados: as mudanças de uma transação se tornam duráveis e visíveis em um único ponto, o registro de commit. Entre nós não há um log único, e cada participante pode falhar de forma independente — então um ingênuo "faça commit em todos, um depois do outro" deixa uma janela em que alguns participantes fizeram commit e outros não:

``` diagram-sim
sequenceDiagram
    participant O as order (checkout)
    participant I as banco do inventory
    participant P as provedor de pagamento
    O->>I: UPDATE do assento A-12 para SOLD, depois COMMIT
    I-->>O: commit feito
    O->>P: cobrar R$ 450
    P-->>O: recusado (limite do cartão)
    Note over O,P: o assento está SOLD mas ninguém pagou:<br/>nenhum lugar único consegue desfazer os dois
```

Existem duas famílias de soluções:

| Abordagem | Ideia | Isolamento | Disponibilidade |
|---|---|---|---|
| **Commit atômico (2PC)** | Todos *se preparam*, depois um coordenador decide commit/abort para todos | ACID completo entre os participantes | Todos os participantes e o coordenador precisam estar no ar ao mesmo tempo |
| **Sagas e compensações** | Uma sequência de transações locais; em caso de falha, execute transações de **compensação** que desfazem os passos anteriores | Nenhum entre os passos (estados intermediários ficam visíveis) | Cada passo só precisa do próprio serviço |

---

## Two-phase commit (2PC) { #2pc }

O 2PC introduz um **coordenador** (muitas vezes o serviço ou o nó de banco que iniciou a transação) e divide o commit em duas fases[^1]:

1. **Prepare (votação)**: o coordenador pergunta a cada participante "você consegue fazer commit?". Um participante que responde **sim** precisa antes gravar de forma durável em disco todas as mudanças e um registro de *prepared*, e manter os locks: a partir desse momento ele **prometeu** fazer commit se for pedido — não pode mais abortar por conta própria.
2. **Commit (decisão)**: se **todos** votaram sim, o coordenador grava **commit** no próprio log e manda todos fazerem commit; se alguém votou não (ou estourou o timeout), ele decide **abort**.

``` diagram-sim
sequenceDiagram
    participant C as coordenador
    participant I as banco do inventory
    participant R as banco do order
    C->>I: PREPARE (assento A-12 → SOLD)
    C->>R: PREPARE (pedido 981 → CONFIRMED)
    I-->>C: YES (mudanças + registro prepared em disco, locks mantidos)
    R-->>C: YES
    Note over C: todos YES: grava COMMIT no log do coordenador
    C->>I: COMMIT
    C->>R: COMMIT
    I-->>C: feito (locks liberados)
    R-->>C: feito
```

O PostgreSQL expõe o lado do participante como `PREPARE TRANSACTION 'id'` seguido, mais tarde, de `COMMIT PREPARED 'id'` ou `ROLLBACK PREPARED 'id'`; o padrão X/Open **XA** define o mesmo protocolo para bancos de dados e message brokers coordenados por um gerenciador de transações (como no Jakarta EE).

### O problema do bloqueio { #blocking }

O ponto fraco é o momento **depois que um participante votou sim e antes de ele ouvir a decisão**. Se o coordenador cai ali, o participante fica **em dúvida**: não pode fazer commit (talvez alguém tenha votado não) e não pode abortar (talvez o coordenador tenha decidido commit e outros já tenham feito commit). Ele precisa **esperar**, segurando os locks, até o coordenador se recuperar:

``` diagram-sim
sequenceDiagram
    participant C as coordenador
    participant I as banco do inventory
    participant R as banco do order
    C->>I: PREPARE
    C->>R: PREPARE
    I-->>C: YES (locks no assento A-12 mantidos)
    R-->>C: YES
    Note over C: cai antes de enviar a decisão
    Note over I: em dúvida: não pode fazer commit, não pode abortar
    Note over I,R: o assento A-12 fica travado até<br/>o coordenador voltar
```

Você mesmo pode provocar isso no simulador em [Sagas](#sagas): escolha **2PC** e **queda do coordenador**.

Durante a abertura das vendas às 10:00, a linha travada de um assento bloqueia todos os outros fãs que tentam segurá-lo, e um coordenador que caiu pode congelar um bloco inteiro de assentos. O **three-phase commit (3PC)** tenta eliminar o bloqueio, mas pressupõe atrasos de rede limitados, que redes reais não garantem; sistemas em produção, em vez disso, tornam o **próprio coordenador tolerante a falhas** replicando sua decisão com **consenso** — exatamente o que fazem o Google Spanner (2PC sobre grupos Paxos) e o CockroachDB (sobre Raft)[^2].

### Quanto o 2PC custa { #what-2pc-costs }

- **Latência**: duas idas e voltas a cada participante, mais gravações forçadas em disco (fsync) em cada prepare e na decisão. Os locks ficam presos durante todo o processo — o participante mais lento decide por quanto tempo.
- **Disponibilidade**: o coordenador e **todos** os participantes precisam estar no ar *ao mesmo tempo*. As disponibilidades se multiplicam, como serviços em série:

```python exec="1" html="1"
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "xtick.color": "#888",
                     "ytick.color": "#888", "axes.edgecolor": "#888", "font.size": 10})

# 2PC needs the coordinator and EVERY participant up at the same time: availabilities multiply.
n = np.arange(1, 11)                     # number of participants
fig, ax = plt.subplots(figsize=(8, 3.6))
for a, color in [(0.9999, "#1e9e5a"), (0.999, "#2f6fed"), (0.99, "#e5484d")]:
    ax.plot(n, 100 * a ** (n + 1), "o-", color=color, lw=2,
            label=f"each node available {100 * a:g}%")
ax.set_xlabel("participants in the transaction (plus 1 coordinator)")
ax.set_ylabel("P(all available), %")
ax.set_xticks(n)
ax.grid(alpha=0.25)
ax.legend(frameon=False, loc="lower left")
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True, bbox_inches="tight")
print(buf.getvalue())
plt.close()
```

- **Acoplamento**: todo participante precisa falar o mesmo protocolo e expor um estado "prepared". Um provedor de pagamento externo **nunca** vai entrar no seu 2PC: a API dele cobra ou recusa, sem um passo de "prepare e espere minha decisão".

!!! info "Onde o 2PC continua vivo e bem"
    O 2PC é o padrão **dentro** de um banco de dados ou broker distribuído, onde um único fornecedor controla todos os participantes e o coordenador é replicado: Spanner, CockroachDB, YugabyteDB, TiDB e as transações do Kafka (escritas atômicas em várias partições mais os offsets dos consumidores). O que se desaconselha é o 2PC **entre microsserviços implantados de forma independente** e terceiros.

??? question "Pense antes: `inventory` e `order` compartilham o mesmo cluster PostgreSQL, mas usam schemas diferentes. Você precisa de 2PC entre eles?"

    Não — se as duas tabelas estão no **mesmo banco de dados**, uma única transação local cobre as duas, e isso é muito mais simples e rápido do que qualquer protocolo distribuído. Separar os dados em bancos diferentes é uma decisão com preço; quando dois dados precisam mudar atomicamente o tempo todo, é um forte indício de que pertencem ao mesmo serviço ou pelo menos ao mesmo banco de dados (veja [Compute — serviços](../../compute/services/index.md)).

---

## Sagas { #sagas }

Uma **saga** (Garcia-Molina e Salem, 1987)[^3] divide uma transação longa em uma **sequência de transações locais** $T_1, T_2, …, T_n$, cada uma com commit no banco de dados do próprio serviço. Se o passo $T_k$ falha, a saga executa **transações de compensação** $C_{k-1}, …, C_1$ que desfazem semanticamente os passos já realizados. Não há lock global nem ponto de commit global.

O checkout do BoxOffice como uma saga:

| Passo | Transação local (serviço) | Compensação |
|---|---|---|
| 1 | Criar o pedido `PENDING` (`order`) | Marcar o pedido `CANCELLED` |
| 2 | Confirmar a reserva: assento `HELD` → `RESERVED_FOR_PAYMENT` (`inventory`) | Liberar o assento → `FREE` |
| 3 | Cobrar o cartão (`payment` → provedor) | Estornar a cobrança |
| 4 | Assento → `SOLD`, pedido → `CONFIRMED`, emitir o ingresso | *(último passo: sem compensação; precisa dar certo — repetido até dar)* |

<div class="csim" data-sim="saga" data-mode="saga" data-fail="declined"></div>

!!! tip "Experimente"
    Dê play na execução padrão, **cobrança recusada**: T1 e T2 fazem commit, T3 falha, e o orquestrador executa C2 (libera A-12) e depois C1 (cancela o pedido 981) — o log da saga as lista na ordem inversa dos passos que desfazem, e o *tempo segurando locks* fica em 0 ms. Escolha **timeout na cobrança**: o cartão *foi* cobrado, mas a resposta se perdeu, então o orquestrador acrescenta C3, um estorno com a mesma chave de idempotência, antes de liberar o assento. Escolha **ticket fora**: a falha vem depois do pivô (a cobrança bem-sucedida), então nada é compensado — o passo do ingresso falha duas vezes, dá certo na terceira tentativa, e o pedido termina `CONFIRMED`. Depois mude para **2PC**: sem falha, a linha do assento fica travada por 145 ms; com **queda do coordenador**, todos os participantes votaram YES e esperam em dúvida — o tempo de lock cresce um segundo por passo e os fãs fazem fila atrás do assento A-12 até você reiniciar o coordenador, que não encontra decisão no seu log e aborta.


Duas formas de coordenar os passos:

=== "Orquestração"

    Um **orquestrador** central (aqui, o serviço `order` ou um motor de workflow como Temporal ou AWS Step Functions) diz a cada participante o que fazer e decide quando compensar. A lógica da saga fica em um só lugar, fácil de ler, monitorar e mudar; o orquestrador precisa persistir seu estado para sobreviver a reinícios. Preferível quando há mais do que alguns poucos passos.

=== "Coreografia"

    Sem cérebro central: cada serviço reage a **eventos** dos outros (`OrderCreated` → `inventory` reserva → `SeatReserved` → `payment` cobra → `PaymentFailed` → `inventory` libera…). Pouco acoplada e simples para dois ou três passos; com mais, o fluxo fica espalhado por muitos serviços e difícil de acompanhar ("quem compensa o quê?"). Tratada com Kafka em [Mensageria — padrões](../../messaging/patterns/index.md).

### Sagas abrem mão do isolamento { #sagas-give-up-isolation }

Entre os passos, outras transações veem estados intermediários: um pedido `PENDING`, um assento `RESERVED_FOR_PAYMENT`. Sagas são **ACD sem o I**. Projete contramedidas explicitamente[^4]:

- **Locks semânticos**: o estado intermediário *é* o lock — enquanto um assento está `RESERVED_FOR_PAYMENT`, nenhum outro fã consegue segurá-lo, e a reserva expira depois de 10 minutos se a saga nunca terminar.
- **Passos comutativos e idempotentes**: todo passo e toda compensação podem ser repetidos (at-least-once), então cada um precisa de uma chave de idempotência ([Idempotência](../index.md#idempotency)).
- **Ordene os passos por risco**: faça primeiro os passos baratos, invisíveis e fáceis de reverter, e por último os difíceis ou impossíveis de compensar (uma cobrança, um e-mail), de modo que uma falha no fim da saga tenha pouco a desfazer. Um estorno é uma compensação que o fã *vê*; liberar um assento é invisível.
- **Passo pivô**: o passo depois do qual a saga só pode seguir em frente (aqui, a cobrança bem-sucedida) — depois dele, os passos restantes precisam ser repetidos até darem certo, nunca compensados.

!!! example "No código do BoxOffice: um passo da saga em torno da cobrança (lab 9)"

    Os labs constroem uma versão encurtada desta saga no `order`: o [lab 7](../../../hands-on/7/outbox/index.md) cria o pedido `PENDING_PAYMENT`, e o [Hands-on 9 — Padrões](../../../hands-on/9/patterns/index.md) acrescenta o passo de pagamento. Observe três escolhas. A cobrança acontece **fora** de qualquer transação de banco (uma conexão nunca fica presa enquanto se espera o provedor). O resultado é aplicado com um `UPDATE … WHERE status = 'PENDING_PAYMENT'` **condicional**, então duas chamadas `pay` concorrentes — ambas deduplicadas pelo `payment` por meio da mesma chave de idempotência — mudam o status uma vez e emitem um evento. E o resultado (`OrderConfirmed` ou `OrderCancelled`, o gatilho da compensação) sai pelo **outbox**, na mesma transação local que a mudança de status.

    ``` { .java title="services/order/src/main/java/boxoffice/order/OrderService.java (pay)" }
    --8<-- "docs/2027.1/hands-on/9/code/services/order/src/main/java/boxoffice/order/OrderService.java:77:100"
    ```

### Reserva: try, confirm, cancel { #tcc }

O padrão **TCC** (try–confirm–cancel) faz cada participante oferecer uma operação *provisória* com um timeout. O BoxOffice já funciona assim: o **hold** é o *try* (o assento fica reservado por 10 minutos), a **venda** é o *confirm*, e a **expiração ou liberação** é o *cancel*. Provedores de pagamento oferecem o mesmo formato: **autorizar** (reservar o valor) → **capturar** (efetivar a cobrança) ou **cancelar** (*void*, liberar o valor). Como todo estado provisório expira sozinho, uma queda em qualquer lugar deixa o sistema convergindo para um estado seguro em vez de bloquear.

---

## O problema da escrita dupla e o outbox { #outbox }

Todo passo de uma saga faz duas coisas: altera o próprio banco de dados **e** avisa o próximo passo (envia um evento ou um comando). Fazer isso como duas escritas separadas é o **problema da escrita dupla** (*dual write*) — se o serviço cai entre elas, o banco diz "assento reservado", mas nenhum evento é enviado, e a saga trava:

``` diagram-sim
sequenceDiagram
    participant I as inventory
    participant DB as banco do inventory
    participant K as Kafka
    I->>DB: UPDATE do assento + INSERT INTO outbox (SeatReserved), um COMMIT
    Note over I,DB: uma transação local: as duas ou nenhuma
    DB-->>I: commit feito
    Note over DB,K: um relay (poller ou CDC como o Debezium)<br/>lê a tabela de outbox
    DB->>K: publica SeatReserved
    K-->>DB: ack: marca a linha do outbox como enviada
```

O **outbox transacional** grava o evento em uma tabela `outbox` **na mesma transação local** que a mudança de negócio; um relay separado publica as linhas do outbox no broker e as marca como enviadas. A publicação é at-least-once, então os consumidores precisam ser idempotentes. Os detalhes (polling vs change data capture, ordenação, limpeza) estão em [Mensageria — padrões](../../messaging/patterns/index.md) e no [Hands-on 7](../../../hands-on/7/index.md).

!!! example "No código do BoxOffice: pedido + outbox em uma transação (lab 7)"

    O [Hands-on 7 — Outbox](../../../hands-on/7/outbox/index.md) grava o pedido e seu evento `OrderPlaced` em **um** método `@Transactional`; `Outbox.append` é declarado `Propagation.MANDATORY`, então falha se alguém o chamar fora da transação de negócio. O mesmo método é idempotente: `ON CONFLICT (hold_id) DO NOTHING` transforma uma requisição repetida para o mesmo hold em um replay que devolve o pedido existente e não acrescenta um segundo evento. O lab prova a garantia parando o Kafka: o pedido foi aceito enquanto o broker estava fora, e seu evento foi publicado **71 s depois**, quando o Kafka voltou — o fã nunca viu a falha.

    ``` { .java title="services/order/src/main/java/boxoffice/order/OrderService.java (place)" }
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/OrderService.java:35:62"
    ```

---

## Escolhendo { #choosing }

| | Transação local | 2PC / banco distribuído | Saga (orquestrada) | Saga (coreografada) | TCC / reserva |
|---|---|---|---|---|---|
| **Atomicidade** | Sim | Sim | Eventual, via compensação | Eventual, via compensação | Eventual, via confirm/cancel |
| **Isolamento** | Sim | Sim | Não (locks semânticos) | Não | Parcial (a reserva) |
| **Disponibilidade** | Um banco | Todos os participantes ao mesmo tempo | Cada passo de forma independente | Cada passo de forma independente | Cada passo de forma independente |
| **Latência** | A menor | 2 idas e voltas + fsyncs, locks mantidos | Soma dos passos, pode ser assíncrona | Assíncrona | Try agora, confirm depois |
| **Funciona com terceiros** | — | Não | Sim | Sim | Sim, se oferecerem reservar/capturar |
| **Complexidade** | A menor | No banco de dados (se ele oferecer) | Estado do orquestrador, compensações | Fluxo de eventos espalhado pelos serviços | Lógica de timeouts e expiração |
| **Uso no BoxOffice** | Segurar um assento; assento + linha do outbox | Dentro do CockroachDB/Spanner, se usados | Checkout | Notificações, analytics | Hold do assento; autorizar/capturar o cartão |

!!! example "BoxOffice: o checkout, de ponta a ponta"
    1. **Hold** (o *try* do TCC): o `inventory` executa uma transação local — `UPDATE` condicional do assento para `HELD` com `expires_at`, mais uma linha `SeatHeld` no outbox.
    2. **Saga do checkout**, orquestrada pelo `order`: cria o pedido `PENDING` → o `inventory` move o assento para `RESERVED_FOR_PAYMENT` → o `payment` **autoriza** o cartão com uma chave de idempotência → o `inventory` marca o assento `SOLD` → o `payment` **captura** → pedido `CONFIRMED` → o `notification` envia o ingresso.
    3. **Falhas**: cartão recusado → libera o assento, cancela o pedido. Timeout ao falar com o provedor → consulta o provedor pela chave de idempotência antes de decidir (a cobrança pode ter acontecido — veja [Lento ou morto?](../index.md#slow-or-dead)). Queda do orquestrador → ele retoma do seu estado persistido. Hold abandonado → expira depois de 10 minutos e o sweeper libera o assento.
    4. **Nenhum 2PC** entre serviços — o provedor externo não poderia participar de um, de qualquer forma.

!!! tip "Na entrevista"
    Quando um design mexe "atomicamente" nos dados de vários serviços, diga: *"Não vou usar 2PC entre serviços — ele bloqueia se o coordenador falha, acopla a disponibilidade de todos os participantes, e o provedor de pagamento não consegue participar. Vou usar uma saga orquestrada com compensações, passos idempotentes, um lock semântico no assento e um outbox transacional para publicar o evento de cada passo."* Depois nomeie o **passo pivô** e o que acontece em um timeout com o provedor. Se os dados podem viver em um único banco, diga isso — a melhor transação distribuída é a que você evita.

!!! success "Boas práticas"

    - **Mantenha chamadas remotas fora das transações de banco** — uma conexão presa enquanto o provedor leva 3 s é um pool de 10 esgotado por 4 pedidos por segundo. No BoxOffice: `OrderService.pay` cobra primeiro e depois abre uma transação curta ([lab 9](../../../hands-on/9/patterns/index.md), quadro acima).
    - **Modele cada saga como estados explícitos com transições condicionais** — `UPDATE … WHERE status = 'PENDING_PAYMENT'` torna todo passo seguro de repetir e todo salto ilegal impossível.
    - **Torne impossível chamar o outbox fora da transação** — `@Transactional(propagation = MANDATORY)` em `Outbox.append` transforma uma transação esquecida em um erro no primeiro teste ([lab 7](../../../hands-on/7/outbox/index.md)).
    - **Dê a todo estado provisório uma expiração e um sweeper** — um hold que ninguém confirma se libera sozinho. No BoxOffice: holds de 10 minutos e um sweeper a cada 5 s no lab 6.
    - **Alerte sobre sagas presas além do timeout e concilie com o provedor diariamente** — um pedido `PENDING_PAYMENT` há uma hora, ou uma cobrança sem pedido, é um bug ou uma mensagem perdida; encontre-o antes do fã.

!!! warning "Armadilhas"
    - **Escritas duplas** (banco, depois broker) sem outbox: uma queda entre elas trava a saga silenciosamente.
    - **Passos ou compensações não idempotentes**: retries cobram ou estornam em dobro.
    - **Esquecer que compensações podem falhar**: elas precisam ser repetidas até darem certo, e gerar alerta quando não derem.
    - **Tratar sagas como isoladas**: outro fã vê `RESERVED_FOR_PAYMENT`; projete para isso (locks semânticos, expiração).
    - **2PC com coordenador não replicado**: uma queda do coordenador deixa os participantes em dúvida com locks mantidos.

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    IDEM["chaves de idempotência<br/>(visão geral)"] --> SAGA["passos da saga<br/>repetidos com segurança"]
    OUT["outbox transacional"] --> SAGA
    SAGA --> ORCH["orquestração<br/>(motor de workflow)"]
    SAGA --> CHOR["coreografia<br/>(eventos no Kafka)"]
    TCC["reservas: hold, autorizar"] --> SAGA
    TPC["2PC"] --> BLOCK["bloqueia se o<br/>coordenador falha"]
    BLOCK --> CONS["replicar o coordenador<br/>→ Consenso"]
    CONS --> NEWSQL["dentro do Spanner,<br/>CockroachDB, transações do Kafka"]
```

**Componentes da paleta envolvidos:** [`stream`](../../../reference/components/messaging/index.md#stream) / [`kafka`](../../../reference/components/messaging/index.md#kafka) (eventos da saga, relay do outbox) · [`queue`](../../../reference/components/messaging/index.md#queue) (comandos aos participantes) · [`payment`](../../../reference/components/external/index.md#payment) (autorizar / capturar / cancelar) · [`sql`](../../../reference/components/storage/index.md#sql) (transações locais + tabela de outbox) · [`worker`](../../../reference/components/compute/index.md#worker) (orquestrador, relay). Experimente os cenários `payment-system` e `flash-sale` no [playground](../../../../playground/index.md). **Continua em:** [Mensageria — padrões](../../messaging/patterns/index.md), [Compute — integrações](../../compute/integrations/index.md), [Estudo de caso: venda de ingressos](../../case-studies/ticketing/index.md).

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - Uma transação distribuída precisa ser **atômica entre nós**; não existe um log único que garanta isso.
    - O **2PC** (prepare, depois commit) dá ACID entre participantes, mas **bloqueia** quando o coordenador falha, segura locks por duas idas e voltas e precisa de todos os participantes no ar ao mesmo tempo — use-o **dentro** de bancos de dados distribuídos, não entre microsserviços.
    - **Sagas** encadeiam transações locais com **compensações**; trocam isolamento por disponibilidade — use locks semânticos, passos idempotentes e um passo pivô.
    - **TCC / reservas** (hold → venda / expiração; autorizar → capturar / cancelar) fazem os estados provisórios expirarem com segurança.
    - O **outbox transacional** resolve o problema da escrita dupla entre um banco de dados e um broker.

---

[^1]: GRAY, J.; LAMPORT, L. [Consensus on Transaction Commit](https://www.microsoft.com/en-us/research/publication/consensus-on-transaction-commit/){target="_blank"}. ACM TODS, 2006.
[^2]: CORBETT, J. C. et al. [Spanner: Google's Globally-Distributed Database](https://research.google/pubs/spanner-googles-globally-distributed-database-2/){target="_blank"}. OSDI, 2012.
[^3]: GARCIA-MOLINA, H.; SALEM, K. [Sagas](https://www.cs.cornell.edu/andru/cs711/2002fa/reading/sagas.pdf){target="_blank"}. ACM SIGMOD, 1987.
[^4]: RICHARDSON, C. [Pattern: Saga](https://microservices.io/patterns/data/saga.html){target="_blank"} e *Microservices Patterns*. Manning, 2018.
