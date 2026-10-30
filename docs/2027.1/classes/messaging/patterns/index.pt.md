Uma compra no BoxOffice envolve três serviços, e cada um é dono dos seus dados: `order` (o pedido), `inventory` (os lugares) e `payment` (a cobrança, por meio de um provedor externo). Em um monólito com um só banco de dados, a compra seria uma transação ACID: reservar os lugares, cobrar, confirmar — tudo ou nada. Dividida em serviços, não há um banco único nem uma transação única. A resposta clássica, uma transação distribuída com two-phase commit (2PC), também não serve: o provedor de pagamento não vai participar da sua transação, e o 2PC bloqueia todos os participantes enquanto um coordenador estiver inacessível.

Esta página reúne os padrões que substituem a transação distribuída em sistemas orientados a eventos. Cada um responde a uma pergunta precisa:

| Pergunta | Padrão |
|---|---|
| Como atualizo meu banco de dados **e** publico um evento sem perder nenhum dos dois? | [Transactional outbox](#transactional-outbox) |
| Como transformo mudanças em um banco de dados em um fluxo de eventos? | [Change data capture](#cdc) |
| Como executo uma transação de negócio que atravessa vários serviços? | [Saga](#sagas) |
| Como atendo consultas que precisam de dados num formato diferente do das escritas? | [CQRS](#cqrs) |
| Como mantenho o histórico completo como fonte da verdade? | [Event sourcing](#event-sourcing) |

---

## O problema da escrita dupla { #the-dual-write-problem }

O jeito mais simples de publicar `OrderConfirmed` é salvar o pedido e depois enviar o evento. São duas escritas em dois sistemas diferentes — uma **escrita dupla** (*dual write*) — e nenhuma transação cobre as duas:

``` diagram-sim
sequenceDiagram
    participant O as order
    participant DB as banco do order
    participant K as Kafka
    O->>DB: BEGIN · UPDATE orders SET status = 'CONFIRMED' · COMMIT
    Note over O: pod derrubado por um deploy
    O--xK: publica OrderConfirmed (nunca enviado)
    Note over DB,K: o pedido está confirmado, mas ninguém fica sabendo: sem e-mail, sem ingresso, sem analytics
```

Inverter a ordem das escritas não ajuda:

| Ordem das escritas | Crash entre elas | Resultado |
|---|---|---|
| Commit no banco, depois publica | depois do commit | Pedido confirmado, **evento perdido** (o e-mail que faltou para o Bruno) |
| Publica, depois commit no banco | depois da publicação | O evento diz "confirmado", mas a transação foi desfeita: **evento fantasma** |
| Publica dentro da transação do banco | broker lento ou fora do ar | A transação do banco espera pela rede; a indisponibilidade do broker vira a sua |

---

## Transactional outbox { #transactional-outbox }

O **transactional outbox**[^1] elimina a escrita dupla gravando o evento **no mesmo banco de dados, na mesma transação local**, que a mudança de negócio. Um **relay** separado lê depois a tabela de outbox e publica no broker.

``` diagram-sim
sequenceDiagram
    participant O as order
    participant DB as banco do order
    participant R as relay do outbox
    participant K as Kafka
    O->>DB: BEGIN
    O->>DB: UPDATE orders SET status = 'CONFIRMED'
    O->>DB: INSERT INTO outbox (OrderConfirmed)
    O->>DB: COMMIT (as duas linhas ou nenhuma)
    R->>DB: SELECT linhas não publicadas
    R->>K: publica OrderConfirmed (chave o-7731)
    K-->>R: ack
    R->>DB: marca a linha como publicada
```

A transação local garante que o pedido e seu evento existam juntos ou não existam. O relay garante que todo evento confirmado seja publicado em algum momento — **pelo menos uma vez**: se ele cai depois de publicar e antes de marcar a linha, publica a linha de novo ao reiniciar. Os consumidores precisam ser idempotentes de qualquer forma ([Semântica de entrega](../semantics/index.md)).

A tabela de outbox:

```sql
CREATE TABLE outbox (
    id              BIGSERIAL   PRIMARY KEY,           -- publication order
    event_id        UUID        NOT NULL UNIQUE,       -- consumers deduplicate on it
    aggregate_type  TEXT        NOT NULL,              -- 'order'
    aggregate_id    TEXT        NOT NULL,              -- 'o-7731', becomes the Kafka key
    type            TEXT        NOT NULL,              -- 'OrderConfirmed'
    payload         JSONB       NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at    TIMESTAMPTZ
);
CREATE INDEX outbox_unpublished ON outbox (id) WHERE published_at IS NULL;
```

O código de negócio grava as duas linhas em uma transação:

```java
@Service
@RequiredArgsConstructor
public class OrderService {

    private final OrderRepository orders;
    private final OutboxRepository outbox;

    @Transactional
    public void confirm(String orderId) {
        Order order = orders.findByIdForUpdate(orderId);
        order.confirm();                                   // PENDING -> CONFIRMED
        orders.save(order);
        outbox.save(OutboxEvent.of("order", order.id(), "OrderConfirmed",
                                   OrderConfirmed.from(order)));   // same transaction
    }
}
```

O relay tem duas implementações comuns:

=== "Publicador por polling"

    Um job agendado lê as linhas não publicadas em ordem, publica e as marca. `FOR UPDATE SKIP LOCKED` permite que uma segunda instância do relay assuma com segurança se a primeira morrer.

    ```java
    @Scheduled(fixedDelay = 200)
    @Transactional
    public void relay() {
        List<OutboxRow> rows = jdbc.query("""
            SELECT id, aggregate_id, payload FROM outbox
             WHERE published_at IS NULL
             ORDER BY id
             LIMIT 100
             FOR UPDATE SKIP LOCKED
            """, OutboxRow.MAPPER);
        for (OutboxRow row : rows) {
            kafka.send("order-events", row.aggregateId(), row.payload()).join();  // wait for the ack
            jdbc.update("UPDATE outbox SET published_at = now() WHERE id = ?", row.id());
        }
    }
    ```

    Simples e portável, mas adiciona carga de polling no banco e até um intervalo de polling de latência. Rode um único relay ativo (ou particione o trabalho por agregado) para que os eventos do mesmo pedido fiquem em ordem, e apague as linhas publicadas depois de alguns dias.

=== "CDC por log (Debezium)"

    O Debezium lê o log de replicação do banco e publica cada nova linha do outbox; nada faz polling na tabela. O seu *outbox event router* transforma as linhas em eventos no tópico certo, com a chave certa.

    ```json
    {
      "name": "order-outbox",
      "config": {
        "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
        "database.hostname": "order-db",
        "database.port": "5432",
        "database.user": "debezium",
        "database.password": "debezium",
        "database.dbname": "order",
        "topic.prefix": "order",
        "plugin.name": "pgoutput",
        "table.include.list": "public.outbox",
        "transforms": "outbox",
        "transforms.outbox.type": "io.debezium.transforms.outbox.EventRouter",
        "transforms.outbox.table.field.event.id": "event_id",
        "transforms.outbox.table.field.event.key": "aggregate_id",
        "transforms.outbox.route.by.field": "aggregate_type",
        "transforms.outbox.route.topic.replacement": "${routedByValue}-events"
      }
    }
    ```

    Menor latência e nenhum polling, ao preço de operar o Kafka Connect e o Debezium. As linhas podem ser apagadas logo depois de inseridas: o log já as capturou.

!!! example "No código do BoxOffice: o outbox no `order` (lab 7)"

    O [Hands-on 7 — Transactional outbox](../../../hands-on/7/outbox/index.md) constrói o publicador por polling. `place()` insere o pedido e, no mesmo método `@Transactional`, acrescenta `OrderPlaced` ao outbox (`Outbox.append` é `Propagation.MANDATORY`: falha se alguém o chamar fora de uma transação). `NOTIFY_MODE=sync` mantém a versão "antes", que chama o `notification` por HTTP, para que você possa medir as duas. O relay envia um lote de até 100 linhas, espera o ack do Kafka para **todas** e só então marca as linhas: um crash no meio as republica (pelo menos uma vez), nunca as perde. Note uma diferença em relação ao conselho acima: várias réplicas do `order` podem fazer o relay em paralelo (`SKIP LOCKED`), o que é seguro aqui porque, por enquanto, cada pedido produz um único evento; com mais eventos por pedido, a ordem por pedido exigiria um único relay ou o particionamento por agregado. Numa execução de teste num laptop ocupado, o p50 do `POST /orders` caiu de **4,12 s** (sync) para **47 ms** (outbox), e parar o `notification` por 20 s derrubou cerca de um terço dos pedidos no modo sync e nenhum com o outbox ([Meça](../../../hands-on/7/measure/index.md)).

    ``` { .java title="services/order/src/main/java/boxoffice/order/OrderService.java (order + event, one transaction)" }
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/OrderService.java:35:62"
    ```

    ``` { .java title="services/order/src/main/java/boxoffice/order/outbox/OutboxRelay.java (the polling publisher)" }
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/outbox/OutboxRelay.java:42:74"
    ```

---

## Change data capture { #cdc }

Todo banco relacional mantém um **log de replicação** — o write-ahead log (WAL) do PostgreSQL, o binlog do MySQL — que registra cada mudança confirmada na ordem dos commits; é assim que as réplicas ficam sincronizadas (veja [Replicação](../../databases/replication/index.md)). O **change data capture** (CDC) lê esse log e transforma cada mudança em um evento[^2]. O relay do outbox acima é um uso do CDC; há muitos outros.

``` diagram-sim
flowchart LR
    cat["catalog"] -->|"INSERT / UPDATE de eventos"| db[("banco do catalog<br/>PostgreSQL")]
    db -->|"WAL (logical decoding)"| dbz["Debezium"]
    dbz -->|"catalog.public.events"| k{{"Kafka"}}
    k --> s["indexador da busca"]
    k --> c["invalidador de cache"]
    k --> w["carregador do warehouse"]
```

No BoxOffice, o CDC sobre o banco do `catalog` mantém três sistemas derivados sincronizados sem mudar o código do `catalog`: o índice de busca (shows novos aparecem na busca segundos depois de criados), o cache (entradas são invalidadas quando um evento muda; veja [Caching](../../caching/index.md)) e o data warehouse.

| | Transactional outbox (com CDC ou polling) | CDC bruto sobre tabelas de negócio |
|---|---|---|
| **O que é publicado** | Eventos projetados para os consumidores (`OrderConfirmed`) | Mudanças de linha (linha 7731 de `orders`: status P → C) |
| **Contrato** | Um schema de evento explícito e versionado | O schema da tabela — uma refatoração da tabela quebra os consumidores |
| **Mudanças de código no serviço** | Gravar a linha do outbox | Nenhuma |
| **Melhor para** | Eventos de domínio públicos entre serviços | Dados derivados internos: busca, cache, warehouse, migrações |

!!! warning "CDC bruto vaza o seu schema"
    Publicar mudanças brutas de tabelas transforma o layout interno das suas tabelas em uma API pública: renomear uma coluna vira uma mudança incompatível para consumidores que você talvez nem conheça. Use CDC bruto para dados que você controla de ponta a ponta (seu próprio índice de busca, seu warehouse), e um outbox com eventos projetados para tudo o que outros times consomem.

---

## Sagas { #sagas }

Uma **saga** é uma transação de negócio implementada como uma **sequência de transações locais**, uma por serviço; cada passo publica um evento ou uma resposta que dispara o próximo. Se um passo falha, a saga executa **transações de compensação** que desfazem semanticamente os passos já concluídos[^3][^1]. A ideia vem de um artigo de bancos de dados de 1987 sobre transações de longa duração — décadas mais velha que os microsserviços.

### A saga de compra do BoxOffice { #the-boxoffice-purchase-saga }

| Passo | Serviço | Transação local | Compensação | Tipo |
|---|---|---|---|---|
| 1 | `order` | Cria o pedido `PENDING` | Marca o pedido como `CANCELLED` | compensável |
| 2 | `inventory` | Reserva os lugares B-12, B-13 (a reserva expira em 10 min) | Libera os lugares | compensável |
| 3 | `payment` | Cobra o cartão pelo provedor (chave de idempotência = id do pedido) | Estorno | **pivô** |
| 4 | `inventory` | Marca os lugares como `SOLD` | — | repetível |
| 5 | `order` | Marca o pedido como `CONFIRMED`, publica `OrderConfirmed` | — | repetível |

O **pivô** é o ponto de não retorno. Antes dele, todo passo pode ser compensado; depois dele, a saga nunca volta atrás — os passos restantes são **repetíveis** (*retriable*): precisam ter sucesso em algum momento, com quantos retries forem necessários. É por isso que a reserva dos lugares precisa durar mais que o pagamento: se a reserva pudesse expirar enquanto o cartão é cobrado, o passo 4 poderia falhar de vez depois do pivô e forçar um estorno — uma experiência ruim que o projeto deveria tornar impossível (ou pelo menos rara e monitorada).

Há duas formas de coordenar os passos.

=== "Coreografia"

    Sem coordenador central: cada serviço reage aos eventos dos outros.

    ``` mermaid-sim
    sequenceDiagram
        participant O as order
        participant I as inventory
        participant P as payment
        O->>I: OrderPlaced
        I->>I: reserva os lugares
        I->>P: SeatsHeld
        P->>P: cobra o cartão
        alt pagamento aprovado
            P->>I: PaymentCaptured
            I->>I: marca os lugares como SOLD
            I->>O: SeatsSold
            O->>O: CONFIRMED, publica OrderConfirmed
        else pagamento recusado
            P->>I: PaymentFailed
            I->>I: libera os lugares (compensação)
            I->>O: SeatsReleased
            O->>O: CANCELLED (compensação)
        end
    ```

=== "Orquestração"

    Um **orquestrador da saga** (aqui, dentro do `order`) envia comandos e reage às respostas. O fluxo inteiro fica em um só lugar.

    ``` mermaid-sim
    sequenceDiagram
        participant S as saga de compra (order)
        participant I as inventory
        participant P as payment
        S->>I: HoldSeats
        I-->>S: SeatsHeld
        S->>P: ChargeCard (chave o-7731)
        alt cobrado
            P-->>S: PaymentCaptured
            S->>I: MarkSeatsSold
            I-->>S: SeatsSold
            S->>S: CONFIRMED, publica OrderConfirmed
        else recusado
            P-->>S: PaymentFailed
            S->>I: ReleaseSeats (compensação)
            I-->>S: SeatsReleased
            S->>S: CANCELLED
        end
    ```

O status do pedido *é* o estado da saga, então a saga é uma máquina de estados:

``` diagram-sim
stateDiagram-v2
    [*] --> PENDING
    PENDING --> SEATS_HELD : SeatsHeld
    PENDING --> CANCELLED : NoSeats
    SEATS_HELD --> PAID : PaymentCaptured (pivô)
    SEATS_HELD --> RELEASING : PaymentFailed / timeout
    RELEASING --> CANCELLED : SeatsReleased
    PAID --> CONFIRMED : SeatsSold (repetido até dar certo)
    CONFIRMED --> [*]
    CANCELLED --> [*]
```

Um orquestrador mínimo trata cada resposta em uma transação local, avança a máquina de estados e envia o próximo comando pelo outbox:

```java
@Component
@RequiredArgsConstructor
public class PurchaseSaga {

    private final SagaRepository sagas;
    private final CommandPublisher commands;          // writes commands to the outbox

    @Transactional
    public void handle(SagaReply reply) {
        PurchaseState s = sagas.lock(reply.orderId());  // SELECT ... FOR UPDATE
        if (s.alreadyApplied(reply.replyId())) return;  // duplicate reply: ignore
        switch (s.step()) {
            case HOLDING_SEATS -> {
                if (reply.ok()) { s.moveTo(CHARGING);  commands.send(new ChargeCard(s.orderId(), s.total())); }
                else            { s.moveTo(CANCELLED); commands.send(new CancelOrder(s.orderId())); }
            }
            case CHARGING -> {
                if (reply.ok()) { s.moveTo(CONFIRMING); commands.send(new MarkSeatsSold(s.orderId())); }
                else            { s.moveTo(RELEASING);  commands.send(new ReleaseSeats(s.orderId())); }
            }
            case CONFIRMING -> { s.moveTo(CONFIRMED); commands.send(new ConfirmOrder(s.orderId())); }
            case RELEASING  -> { s.moveTo(CANCELLED); commands.send(new CancelOrder(s.orderId())); }
            default -> throw new IllegalStateException("unexpected reply in " + s.step());
        }
        sagas.save(s.applied(reply.replyId()));
    }
}
```

| | Coreografia | Orquestração |
|---|---|---|
| **Coordenação** | Cada serviço reage a eventos | Um orquestrador envia comandos e acompanha o estado |
| **Acoplamento** | Os serviços conhecem os eventos uns dos outros | Os participantes só conhecem seus comandos; o orquestrador conhece o fluxo |
| **Visibilidade do fluxo** | Espalhado por vários códigos; difícil responder "onde está o pedido o-7731?" | Uma máquina de estados; fácil de inspecionar, testar e mudar |
| **Risco** | Dependências cíclicas, "espaguete de eventos" à medida que os passos crescem | O orquestrador pode virar um serviço-deus cheio de lógica de negócio |
| **Bom para** | 2–3 passos, fluxos simples | 4+ passos, timeouts, ramificações — como a compra |

Em produção, sagas orquestradas costumam ser escritas sobre um **motor de execução durável / workflow** — Temporal, AWS Step Functions, Azure Durable Functions, Camunda — que persiste o estado depois de cada passo, cuida de timers ("libere a reserva se não houver pagamento em 10 minutos") e de retries, e sobrevive a reinícios do processo que o executa.

### Sagas não são transações { #sagas-are-not-transactions }

Uma saga é **ACD sem o I**: ela é atômica (no fim, todos os passos ou todas as compensações), consistente e durável, mas **não é isolada**. Outras requisições veem estados intermediários — lugares reservados mas não vendidos, um pedido pago mas ainda não confirmado. Projete para isso:

- **Lock semântico**: o estado intermediário é explícito e respeitado por todos. Lugares em `HELD` não são oferecidos a outros fãs; a página do pedido diz "processando pagamento".
- **Compensações são ações de negócio, não rollbacks.** Um estorno é uma nova transação com seu próprio registro na contabilidade (e uma notificação ao fã), não um apagar.
- **Todo passo e toda compensação são idempotentes**, porque comandos e eventos são entregues pelo menos uma vez.
- **Todo passo tem um prazo.** Se o provedor de pagamento não responde, não compense às cegas — a cobrança pode ter sido feita. Consulte o provedor (pela chave de idempotência) e reconcilie antes (veja [Integrações](../../compute/integrations/index.md)).

!!! example "BoxOffice: o que o fã vê durante a saga"

    A API de compra responde `202 Accepted` com o id do pedido logo depois do passo 1. A página mostra "Lugares reservados — processando pagamento" (lock semântico) e aguarda o resultado (polling em `GET /orders/o-7731` ou um server-sent event). A maioria das sagas termina em cerca de um segundo, então o fã mal percebe; quando o provedor está lento, a página mantém um status honesto em vez de um spinner que termina em timeout.

---

## CQRS { #cqrs }

**Command Query Responsibility Segregation** (CQRS) separa o modelo que trata as **escritas** (comandos) dos modelos que atendem as **leituras** (consultas)[^4]. O modelo de escrita é otimizado para correção e invariantes (tabelas normalizadas, transações, locks); cada modelo de leitura é uma **projeção** desnormalizada, no formato de uma tela ou consulta, construída a partir dos eventos do lado de escrita.

``` diagram-sim
flowchart LR
    fan["fã"] -->|"POST /orders (comando)"| order["order<br/>modelo de escrita"]
    order --> odb[("banco do order<br/>normalizado")]
    order -->|"outbox: eventos de pedido"| k{{"Kafka"}}
    k --> p1["projetor de meus ingressos"]
    k --> p2["projetor da busca"]
    p1 --> v1[("visão my_tickets<br/>uma linha por ingresso")]
    p2 --> v2[("índice de busca")]
    fan -->|"GET /me/tickets (consulta)"| v1
```

A página "Meus ingressos" precisa, para um fã, de todos os ingressos com nome do show, data, local, lugar e QR code — dados que pertencem ao `order`, ao `catalog` e ao `inventory`. Fazer join entre três serviços a cada visualização da página é lento e frágil. Em vez disso, um projetor consome os eventos deles e mantém uma tabela `my_tickets` com exatamente as colunas de que a página precisa. As leituras viram uma única consulta indexada, e o lado de leitura escala de forma independente (réplicas, cache, até um banco de dados diferente).

O preço é a **consistência eventual entre escrita e leitura**: logo depois de comprar, o fã abre "Meus ingressos" e o ingresso novo ainda não está lá, porque o projetor está algumas centenas de milissegundos atrás. Soluções comuns para esse problema de *read-your-writes* (veja [Consistência](../../distributed/consistency/index.md)):

- Devolver o novo estado na resposta do comando e deixar o cliente exibi-lo imediatamente.
- Passar um token de versão: o cliente envia "preciso de pelo menos a versão 42" e o lado de leitura espera um pouco (ou recorre ao modelo de escrita) até tê-la.
- Ler as escritas **recentes do próprio usuário** do modelo de escrita e todo o resto da projeção.

!!! warning "CQRS não é padrão"
    CQRS adiciona peças móveis: projetores, mais armazenamento, lag para monitorar, procedimentos de reconstrução. Use onde leituras e escritas realmente diferem em formato ou escala (a navegação no catálogo do BoxOffice, "Meus ingressos", a busca), não para toda entidade CRUD.

---

## Event sourcing { #event-sourcing }

Na maioria dos sistemas, o banco guarda o **estado atual** e os eventos são um subproduto. O **event sourcing** inverte isso: a **sequência de eventos é a fonte da verdade**, e o estado atual é calculado reproduzindo-os[^5].

```sql
CREATE TABLE order_events (
    order_id    TEXT        NOT NULL,
    version     INT         NOT NULL,      -- 1, 2, 3... per order
    type        TEXT        NOT NULL,      -- 'OrderPlaced', 'SeatsHeld', ...
    payload     JSONB       NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (order_id, version)        -- two writers cannot both append version 4
);
```

```java
public record Order(String id, OrderStatus status, List<String> seats, long totalCents) {

    public static Order replay(List<OrderEvent> history) {
        Order order = null;
        for (OrderEvent e : history) {                // oldest first
            order = switch (e) {
                case OrderPlaced p     -> new Order(p.orderId(), PENDING, p.seats(), p.totalCents());
                case SeatsHeld h       -> order.with(SEATS_HELD);
                case PaymentCaptured c -> order.with(PAID);
                case OrderConfirmed c  -> order.with(CONFIRMED);
                case OrderCancelled c  -> order.with(CANCELLED);
            };
        }
        return order;
    }

    Order with(OrderStatus s) { return new Order(id, s, seats, totalCents); }
}
```

Para mudar um pedido, o serviço carrega seus eventos, reconstrói o estado, verifica as regras de negócio e acrescenta novos eventos com a próxima versão; a chave primária transforma um acréscimo concorrente em conflito (**concorrência otimista**). Históricos longos são carregados a partir de um **snapshot** mais os eventos posteriores a ele. Os modelos de leitura são projeções, como no CQRS — por isso os dois padrões costumam aparecer juntos.

| Benefícios | Custos |
|---|---|
| Trilha de auditoria completa: *por que* e *quando* cada mudança aconteceu | Eventos são um contrato permanente: toda versão precisa continuar legível para sempre |
| Consultas temporais: "como estava este pedido às 10:03?" | Consultas precisam de projeções; "todos os pedidos acima de R$ 1.000" não é um simples `SELECT` |
| Depuração por replay; novos modelos de leitura construídos a partir do histórico | Pouco familiar para a maioria dos times; fácil de errar |
| Encaixe natural com integração orientada a eventos | Apagar dados pessoais (LGPD/GDPR) em um log imutável exige cuidado (por exemplo, cifrar por cliente e apagar a chave) |

!!! tip "Onde event sourcing cabe no BoxOffice"
    Bons candidatos: o **livro-razão de pagamentos** (dinheiro precisa ser auditável, e um razão só de acréscimos é como a contabilidade já funciona) e o histórico de pedidos. Maus candidatos: o catálogo de eventos (uma tabela simples com CDC basta) e o mapa de lugares durante uma abertura de vendas (precisa de atualizações rápidas e com lock do estado atual, não de um histórico crescente).

---

## Escolhendo os padrões { #choosing-the-patterns }

| Padrão | Resolve | Custos | Uso no BoxOffice |
|---|---|---|---|
| Transactional outbox | Eventos perdidos ou fantasmas na publicação | Uma tabela a mais e um relay; publicação at-least-once | Todo serviço que publica eventos de domínio |
| Change data capture | Manter sistemas derivados em sincronia com um banco | Kafka Connect/Debezium para operar; acoplamento de schema se bruto | Catalog → busca, invalidação de cache, warehouse |
| Saga | Transações de negócio entre serviços | Sem isolamento; compensações a projetar; mais difícil de depurar | Compra: order → reserva → pagamento → confirmação |
| CQRS | Leituras em formato diferente das escritas, ou em outra escala | Projeções, lag, tratamento de read-your-writes | "Meus ingressos", navegação no catálogo |
| Event sourcing | Histórico completo como fonte da verdade | Versionamento de eventos para sempre; projeções para toda consulta | Livro-razão de pagamentos, histórico de pedidos |

!!! tip "Na entrevista"
    Para qualquer fluxo que atravessa serviços e movimenta dinheiro ou inventário, os entrevistadores esperam que você diga "saga" *e* a torne concreta: liste os passos com suas compensações, nomeie o pivô (o pagamento), explique o que o usuário vê no estado intermediário (lugares reservados, pagamento em processamento) e como os timeouts são tratados (reconciliar com o provedor antes de compensar). Vai publicar eventos? Diga "transactional outbox" antes de perguntarem sobre o crash entre o commit e a publicação. Mencione CQRS ou event sourcing só quando um requisito pedir (auditoria, formatos de leitura muito diferentes), e diga quanto custam.

!!! success "Boas práticas"

    - **Torne impossível escrever no outbox fora da transação de negócio** — um helper que exige uma transação existente falha nos testes em vez de perder eventos em produção. No BoxOffice: `Outbox.append` é `@Transactional(propagation = MANDATORY)` ([quadro do outbox](#transactional-outbox)).
    - **Alerte sobre a idade da linha não publicada mais antiga do outbox** — o relay roda a cada 200 ms, então uma linha com mais de cerca de 30 s indica relay ou broker travado, bem antes de um fã reclamar.
    - **Apague periodicamente as linhas já publicadas do outbox e indexe as não publicadas** — senão a tabela cresce uma linha por evento para sempre e a consulta do relay fica lenta. No BoxOffice: `OutboxRelay.purge` apaga, a cada hora, as linhas publicadas há mais de 1 dia.
    - **Persista o estado da saga e altere-o só com updates condicionais** — `UPDATE orders SET status = 'CONFIRMED' WHERE id = ? AND status = 'PENDING_PAYMENT'`: um evento atrasado ou duplicado não consegue fazer um pedido concluído voltar.
    - **Ordene os passos da saga para que o irreversível venha por último** — o que pode ser desfeito (a reserva do assento) antes do pivô (a cobrança), o que não pode ser desfeito (emitir o ingresso) depois dele.
    - **Mantenha os modelos de leitura do CQRS reconstruíveis e ensaie a reconstrução** — guarde os eventos (ou o stream de CDC) por tempo suficiente para refazer uma projeção do zero, e cronometre quanto ela leva.

!!! warning "Armadilhas comuns"

    - **Escritas duplas** "porque a janela de crash é minúscula" — no volume do BoxOffice, janelas minúsculas acontecem todo dia.
    - **Compensações não idempotentes** — um `ReleaseSeats` duplicado não pode liberar lugares que outra pessoa comprou nesse meio-tempo (libere só os lugares reservados *por este pedido*).
    - **Compensar no timeout sem reconciliar** — estornar (ou cancelar) um pagamento que na verdade foi aprovado, ou deixar um cliente cobrado sem ingressos.
    - **Nenhum prazo nos passos da saga** — pedidos presos em `PENDING` para sempre, lugares reservados para sempre.
    - **CDC bruto como contrato de integração** entre times.
    - **Event sourcing em tudo** — a maioria dos dados vai bem como estado atual mais um outbox.

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    DW["escrita dupla:<br/>banco + broker"] --> OUT["transactional outbox<br/>uma transação local"]
    OUT --> RELAY["relay: polling ou<br/>Debezium"]
    RELAY --> K["tópico kafka"]
    WAL["WAL / binlog<br/>→ Replicação"] --> CDC["change data capture"]
    CDC --> RELAY
    CDC --> DER["índice de busca, cache,<br/>warehouse"]
    K --> SAGA["saga: transações locais<br/>+ compensações"]
    SAGA --> PIVOT["pivô = pagamento<br/>→ Integrações"]
    SAGA --> ISO["sem isolamento:<br/>semantic locks, prazos"]
    SAGA --> TPC["2PC vs sagas<br/>→ Transações distribuídas"]
    K --> CQRS["projeções CQRS<br/>read-your-writes"]
    ES["event sourcing:<br/>eventos são a verdade"] --> CQRS
```

**Componentes da paleta:** [`sql`](../../../reference/components/storage/index.md#sql) (linhas de negócio + outbox, WAL para CDC) · [`kafka`](../../../reference/components/messaging/index.md#kafka) · [`stream`](../../../reference/components/messaging/index.md#stream) · [`search`](../../../reference/components/compute/index.md#search) (índice alimentado por CDC) · [`cache`](../../../reference/components/storage/index.md#cache) (invalidação por CDC) · [`dwh`](../../../reference/components/storage/index.md#dwh) (warehouse alimentado por CDC) · [`payment`](../../../reference/components/external/index.md#payment) (o pivô da saga). **Cenários:** `payment-system`, `flash-sale`. **Continua em:** [Distribuídos — transações](../../distributed/transactions/index.md) (2PC vs sagas), [Bancos de dados — replicação](../../databases/replication/index.md) (o log que o CDC lê), [Caching — invalidação por CDC](../../caching/invalidation/index.md#cdc), [Compute — integrações](../../compute/integrations/index.md), [Estudo de caso: sistema de pagamentos](../../case-studies/payment-system/index.md), [Hands-on 7 — outbox](../../../hands-on/7/outbox/index.md), [Exercício — event-driven](../../../exercises/event-driven/index.md).

---

[^1]: RICHARDSON, C. *Microservices Patterns*. Manning, 2018. Veja também [microservices.io — Transactional outbox, Saga, CQRS, Event sourcing](https://microservices.io/patterns/){target="_blank"}.
[^2]: [Debezium Documentation — Outbox Event Router](https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html){target="_blank"}; KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2. ed. O'Reilly. Seção sobre change data capture.
[^3]: GARCIA-MOLINA, H.; SALEM, K. Sagas. In: *Proceedings of the ACM SIGMOD International Conference on Management of Data*, 1987, p. 249–259.
[^4]: FOWLER, M. [CQRS](https://martinfowler.com/bliki/CQRS.html){target="_blank"}. martinfowler.com, 2011; YOUNG, G. [CQRS Documents](https://cqrs.files.wordpress.com/2010/11/cqrs_documents.pdf){target="_blank"}, 2010.
[^5]: FOWLER, M. [Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html){target="_blank"}. martinfowler.com, 2005.
