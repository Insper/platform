Na manhã seguinte a uma grande abertura de vendas, chegam dois chamados ao suporte. A Ana recebeu **três** e-mails de confirmação idênticos. O Bruno não recebeu **nenhum**, embora seu pedido esteja confirmado e os ingressos estejam no app. Os dois problemas têm a mesma raiz: as mensagens atravessam várias máquinas e redes, qualquer uma delas pode falhar entre dois passos, e cada falha ou **perde** uma mensagem ou a **repete**. Esta página é sobre decidir qual das duas você pode tolerar, e sobre escrever consumidores para os quais uma repetição não causa dano.

---

## Onde mensagens se perdem ou se duplicam

Siga um `OrderConfirmed` do `order` até o `notification`. Ele atravessa três trechos, e cada trecho tem a sua falha:

``` mermaid-sim
flowchart LR
    O["order<br/>(produtor)"] -->|"1 · envia"| B[("broker<br/>Kafka")]
    B -->|"2 · replica"| R[("réplicas")]
    B -->|"3 · entrega"| N["notification<br/>(consumidor)"]
    N -->|"4 · efeito colateral"| E["provedor de e-mail"]
    N -->|"5 · commit do offset"| B
```

| Trecho | O que pode dar errado | Efeito | Defesa |
|---|---|---|---|
| 1 · produtor → broker | O broker gravou o registro mas o ack se perdeu; o produtor faz retry | **Duplicata** no log | Produtor idempotente |
| 1 · produtor → broker | O produtor caiu antes de enviar (ou desistiu) | **Perda** | Transactional outbox ([Padrões](../patterns/index.md#transactional-outbox)) |
| 2 · broker | A líder morreu antes de as seguidoras copiarem o registro (`acks=1`) | **Perda** de um registro confirmado | `acks=all`, `min.insync.replicas=2` ([Kafka](../kafka/index.md#replication-and-durability)) |
| 3–5 · consumidor | Crash entre o efeito colateral (4) e o commit (5) | Processamento **duplicado** | Consumidor idempotente |
| 3–5 · consumidor | Commit (5) antes do efeito colateral (4), depois crash | **Perda** | Commit depois de processar |

Os três e-mails da Ana são o trecho 3–5: o `notification` enviou o e-mail e foi derrubado durante um deploy antes do commit, duas vezes. O e-mail que faltou para o Bruno é o trecho 1: o `order` salvou o pedido dele e caiu antes de publicar.

---

## As três garantias de entrega

Uma **garantia de entrega** diz quantas vezes cada mensagem é *processada* na presença de falhas[^1]:

| Garantia | Significado | Como (consumidor Kafka) | Um crash significa | Use quando |
|---|---|---|---|---|
| **At-most-once** | 0 ou 1 vez | commit do offset **antes** de processar | a mensagem pode ser **perdida** | perder algumas é aceitável: amostras de métricas, "usuário está digitando" |
| **At-least-once** | 1 ou mais vezes | commit do offset **depois** de processar | a mensagem é **processada de novo** | quase sempre — com consumidores idempotentes |
| **Exactly-once** | exatamente 1 vez (no efeito) | at-least-once + deduplicação, ou transações do Kafka dentro do Kafka | nenhum dos dois | dinheiro, inventário, qualquer coisa que se conte |

=== "At-most-once"

    ``` mermaid-sim
    sequenceDiagram
        participant K as Kafka
        participant N as notification
        participant M as provedor de e-mail
        K->>N: OrderConfirmed o-7731 (offset 42)
        N->>K: commit do offset 43
        Note over N: cai antes de enviar
        N->>K: (restart) fetch a partir de 43
        Note over M: o Bruno nunca recebe o e-mail
    ```

=== "At-least-once"

    ``` mermaid-sim
    sequenceDiagram
        participant K as Kafka
        participant N as notification
        participant M as provedor de e-mail
        K->>N: OrderConfirmed o-7731 (offset 42)
        N->>M: envia e-mail
        Note over N: cai antes do commit
        N->>K: (restart) fetch a partir de 42
        K->>N: OrderConfirmed o-7731 (offset 42) de novo
        N->>M: envia e-mail (a duplicata da Ana)
        N->>K: commit do offset 43
    ```

### Exactly-once, com honestidade

"Entrega exactly-once" no sentido estrito é impossível sobre uma rede não confiável: o receptor nunca pode ter certeza de que o remetente viu a sua confirmação (o problema dos Dois Generais; veja [Sistemas distribuídos](../../distributed/index.md)). O que os sistemas realmente oferecem é **processamento exactly-once *dentro de uma fronteira***:

- **Produtor idempotente** (`enable.idempotence=true`, padrão desde o Kafka 3.0). O broker dá a cada produtor um id e acompanha um número de sequência por partição; um lote reenviado com uma sequência já gravada é descartado. Elimina as duplicatas do trecho 1.
- **Transações do Kafka**[^2]. Um produtor pode escrever em várias partições *e* confirmar offsets de consumo de forma atômica. Consumidores com `isolation.level=read_committed` só veem transações confirmadas. Isso dá exactly-once para pipelines **ler do Kafka → processar → escrever no Kafka** (Kafka Streams: `processing.guarantee=exactly_once_v2`).
- **A fronteira.** Transações do Kafka não conseguem desenviar um e-mail, estornar uma cobrança no cartão ou desfazer uma linha no PostgreSQL. Assim que um efeito colateral sai do Kafka, você volta ao at-least-once.

Então a receita prática, usada em quase todo lugar, é:

> **Efetivamente uma vez = entrega at-least-once + processamento idempotente.**

---

## Consumidores idempotentes { #idempotent-consumers }

Uma operação é **idempotente** se fazê-la duas vezes tem o mesmo efeito que fazê-la uma vez[^3]. Um consumidor idempotente torna entregas duplicadas inofensivas. Há três famílias de técnicas:

| Técnica | Como funciona | Exemplo no BoxOffice |
|---|---|---|
| **Idempotência natural** | Expressar a mudança como "definir para" em vez de "somar" | `UPDATE seats SET status = 'SOLD' WHERE id = 'B-12'` (em vez de `sold_count = sold_count + 1`) |
| **Tabela de deduplicação** | Registrar o id de cada mensagem processada na mesma transação da mudança de negócio; pular ids já registrados | `processed_events (consumer, event_id)` no banco do `notification` |
| **Restrição de unicidade / escrita condicional** | Deixar o banco rejeitar o segundo efeito | `UNIQUE (order_id, kind)` na tabela de e-mails; `INSERT … ON CONFLICT DO NOTHING` |

A tabela de deduplicação é a solução geral. Ela exige que toda mensagem carregue um **id de evento** único (um UUID gerado uma vez, pelo produtor, quando o evento é criado — não a cada retry):

```sql
CREATE TABLE processed_events (
    consumer      TEXT        NOT NULL,
    event_id      UUID        NOT NULL,
    processed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (consumer, event_id)
);
```

```java
@Component
@RequiredArgsConstructor
public class OrderConfirmedListener {

    private final JdbcTemplate jdbc;
    private final ConfirmationEmails emails;

    @KafkaListener(topics = "order-events", groupId = "notification")
    @Transactional   // dedup row and business change commit together, or not at all
    public void on(OrderConfirmed event) {
        int inserted = jdbc.update("""
            INSERT INTO processed_events (consumer, event_id)
            VALUES ('notification', ?)
            ON CONFLICT DO NOTHING
            """, event.eventId());
        if (inserted == 0) {
            return;                     // duplicate delivery: already handled
        }
        emails.schedule(event);         // INSERT INTO outgoing_emails ... (same transaction)
    }
}
```

Dois detalhes tornam isso correto:

1. **Mesma transação.** A linha de deduplicação e a mudança de negócio são confirmadas juntas. Se o serviço cai antes do commit, nenhuma das duas existe e a mensagem reentregue é processada normalmente; depois do commit, a reentrega é pulada. O offset é confirmado depois da transação.
2. **Efeitos colaterais externos são agendados, não executados, dentro da transação.** `emails.schedule` só insere uma linha em `outgoing_emails` (com `UNIQUE (order_id, kind)`). Um enviador separado lê essa tabela e chama o provedor de e-mail passando o id da linha como **chave de idempotência**, então um retry da chamada não envia duas vezes. Provedores de e-mail, SMS e pagamentos costumam aceitar esse tipo de chave (veja [Integrações](../../compute/integrations/index.md)).

Mantenha a tabela de deduplicação limitada: apague linhas mais antigas que a retenção do tópico mais uma margem (uma reentrega mais antiga que a retenção não pode acontecer).

---

## Ordenação { #ordering }

O Kafka garante ordem **por partição**, ou seja, por chave. Várias coisas ainda podem colocar eventos fora de ordem:

- **Retries do produtor.** Se o lote 1 falha e o lote 2 dá certo, o retry do lote 1 chega depois do lote 2. O produtor idempotente evita isso (ele mantém a ordem com até 5 requisições em voo por conexão).
- **Chaves ou tópicos diferentes.** `SeatsHeld` em `inventory-events` e `OrderCancelled` em `order-events` não têm ordem relativa nenhuma.
- **Processamento paralelo dentro de um consumidor.** Um pool de threads processa registros da mesma chave ao mesmo tempo.
- **Retries no consumidor.** Mover um registro com falha para um tópico de retry deixa registros posteriores da mesma chave passarem na frente (próxima seção).

Quando a ordem importa e o transporte não consegue garanti-la, torne o **consumidor** tolerante: carregue em cada evento uma **versão** (ou número de sequência) vinda da fonte da verdade, e ignore qualquer coisa mais antiga do que você já aplicou:

```sql
-- search keeps "seats left" per event; inventory stamps each change with a version
UPDATE event_availability
   SET seats_left = :seatsLeft, version = :version
 WHERE event_id = :eventId
   AND version < :version;     -- a late, older update changes nothing
```

Isso torna a atualização idempotente *e* insensível à ordem: aplicar as versões 7, 9, 8 deixa a versão 9.

??? question "Pense antes: ordenar por `orderId` basta para o índice de busca?"

    Não, se os eventos vêm de serviços diferentes. O `inventory` publica `SeatsHeld` e `SeatsReleased` com chave pelo lugar ou pelo evento, o `order` publica `OrderConfirmed` com chave pelo pedido. O índice de busca os vê intercalados de forma arbitrária. A solução não é uma ordem global (que mataria o paralelismo), e sim uma **versão por entidade** produzida pelo serviço que é dono dela: a disponibilidade do evento `ev-88` é versionada pelo `inventory`, e a busca só aplica versões mais novas.

---

## Retries e dead letter queues { #dlq }

Um consumidor vai encontrar mensagens que não consegue processar. Por dois motivos bem diferentes:

- **Falhas transitórias**: o banco está reiniciando, o provedor de e-mail responde `503`. Tentar de novo mais tarde vai funcionar.
- **Falhas permanentes**: o payload é JSON inválido, referencia um id de evento que não existe, um bug lança exceção em um campo específico. Tentar de novo vai falhar para sempre. Uma mensagem assim é uma **mensagem venenosa** (*poison message*).

Uma mensagem venenosa no início de uma partição bloqueia tudo o que vem atrás: o consumidor tenta de novo para sempre e o lag cresce para todos os outros pedidos daquela partição. A solução é uma **dead letter queue** (DLQ, no Kafka normalmente um *dead letter topic*, DLT): depois de um número limitado de tentativas, a mensagem é colocada de lado, junto com o erro, e o consumidor segue em frente.

``` mermaid-sim
stateDiagram-v2
    state "Entregue" as Delivered
    state "Processada" as Processed
    state "Tópico de retry" as RetryTopic
    state "Dead letter" as DeadLetter
    [*] --> Delivered
    Delivered --> Processed : sucesso
    Delivered --> RetryTopic : erro transitório (tentativa < máx.)
    RetryTopic --> Delivered : depois do backoff (1 s, 4 s, 16 s)
    Delivered --> DeadLetter : erro permanente, ou máx. de tentativas
    DeadLetter --> Delivered : corrigida e reenviada por um operador
    Processed --> [*]
```

Com o Spring Kafka, **retries não bloqueantes** são declarativos: registros com falha vão para tópicos de retry com atrasos crescentes, enquanto o tópico principal continua fluindo.

```java
@RetryableTopic(
    attempts = "4",                                      // 1 try + 3 retries
    backOff = @BackOff(delay = 1000, multiplier = 4.0),  // 1 s, 4 s, 16 s
    exclude = { InvalidEventException.class },           // permanent: straight to the DLT
    dltTopicSuffix = "-dlt")
@KafkaListener(topics = "order-events", groupId = "notification")
public void on(OrderConfirmed event) {
    confirmations.send(event);
}

@DltHandler
public void onDeadLetter(OrderConfirmed event,
                         @Header(KafkaHeaders.DLT_EXCEPTION_MESSAGE) String error) {
    log.error("order {} moved to order-events-dlt: {}", event.orderId(), error);
}
```

Operando uma DLQ:

- **Alerte sobre ela.** Uma DLQ com mensagens é um incidente em câmera lenta: cada mensagem é um cliente sem e-mail ou um pedido fora do warehouse. Abra um chamado ou acione o plantão quando ela não estiver vazia ou estiver crescendo.
- **Guarde o contexto.** Armazene o tópico, a partição e o offset originais, a exceção e o número de tentativas como cabeçalhos (o Spring faz isso).
- **Reenvie (redrive).** Depois de corrigir o bug, reenvie a DLQ para o tópico principal. Isso só é seguro porque os consumidores são idempotentes.
- **Cuidado com a ordem.** Retries não bloqueantes deixam eventos posteriores do mesmo pedido passarem na frente de um que está em retry. Se a ordem por chave é essencial (um `OrderCancelled` não pode ser aplicado antes do seu `OrderConfirmed`), use retries **bloqueantes** para erros transitórios (tentar no lugar, com backoff, pausando a partição) ou consumidores protegidos por versão.

### Backpressure no consumidor

Um consumidor Kafka *puxa* as mensagens, então nunca é inundado pelo broker — mas ele pode inundar quem ele chama. O serviço `notification` não deve exceder o limite de taxa do provedor de e-mail só porque há um backlog de 100.000 mensagens esperando. Controle o ritmo com `max.poll.records` e um rate limiter no cliente, **pause** as partições enquanto um circuit breaker mais adiante estiver aberto (veja [Padrões de resiliência](../../reliability/patterns/index.md)), e deixe o lag crescer: um backlog que escoa no ritmo do provedor é melhor que ser banido pelo provedor.

---

## Evolução de schema { #schema-evolution }

Eventos vivem mais que o código que os produziu: um tópico com 7 dias de retenção contém mensagens escritas pela versão da semana passada do `order`, e os consumidores que as leem podem ser meses mais velhos ou mais novos. Você não consegue implantar produtores e consumidores de forma atômica, então **toda mudança de schema precisa ser compatível** com as versões ainda em execução[^4].

| Compatibilidade | Garante | Mudanças seguras | Ordem do deploy |
|---|---|---|---|
| **Backward** | consumidores novos leem dados escritos com o schema antigo | remover campos; adicionar campos **com default** | consumidores primeiro |
| **Forward** | consumidores antigos leem dados escritos com o schema novo | adicionar campos; remover campos que tinham default | produtores primeiro |
| **Full** | as duas | adicionar ou remover campos opcionais com default | qualquer ordem |
| **None** | nada | qualquer coisa — quebra consumidores | tópico novo |

Nunca compatível: renomear um campo, mudar seu tipo (`total` de número para string), mudar seu significado (`total` de reais para centavos), reutilizar um número de campo do Protobuf.

!!! example "BoxOffice: adicionando a moeda ao OrderConfirmed"

    O BoxOffice começa a vender em outros países e precisa da moeda no `OrderConfirmed`. A versão 1 tinha só o total; a versão 2 adiciona `currency` com um default e um `couponCode` opcional:

    ```json
    {
      "type": "record", "name": "OrderConfirmed", "namespace": "boxoffice.events",
      "fields": [
        { "name": "eventId",    "type": "string" },
        { "name": "orderId",    "type": "string" },
        { "name": "totalCents", "type": "long" },
        { "name": "currency",   "type": "string", "default": "BRL" },
        { "name": "couponCode", "type": ["null", "string"], "default": null }
      ]
    }
    ```

    Um consumidor na versão 2 lendo um registro antigo recebe `currency = "BRL"` e nenhum cupom (compatível backward); um consumidor ainda na versão 1 ignora os campos novos (compatível forward). O schema registry rejeita uma versão 3 que renomeie `totalCents`.

As ferramentas:

- **Formatos de serialização com schema**: Avro, Protobuf ou JSON Schema. JSON puro sem schema "funciona" até a primeira quebra silenciosa.
- **Um schema registry** (Confluent Schema Registry, Apicurio, AWS Glue Schema Registry) guarda todas as versões, verifica a compatibilidade quando um produtor registra uma nova e deixa as mensagens carregarem um pequeno id de schema em vez do schema inteiro.
- **Um envelope** com metadados padronizados. A especificação **CloudEvents** da CNCF define atributos comuns para que ferramentas possam rotear e rastrear eventos sem interpretar o payload:

```json
{
  "specversion": "1.0",
  "id": "e-9f2c",
  "source": "/boxoffice/order",
  "type": "com.boxoffice.order.confirmed.v2",
  "subject": "o-7731",
  "time": "2027-03-14T10:00:07Z",
  "datacontenttype": "application/json",
  "data": { "orderId": "o-7731", "totalCents": 78000, "currency": "BRL" }
}
```

Para uma mudança realmente **incompatível**, publique a nova versão em um tópico novo (`order-events.v2`), faça o produtor escrever nos dois durante um período de transição, migre os consumidores um a um e então aposente o tópico antigo.

---

## Juntando tudo

| Preocupação | Decisão no BoxOffice |
|---|---|
| Duplicatas do produtor | Produtor idempotente (`enable.idempotence=true`, `acks=all`) |
| Perdas no produtor (crash depois do commit no banco) | Transactional outbox |
| Perdas no broker | RF 3, `min.insync.replicas=2`, sem eleição de líder "unclean" |
| Garantia no consumidor | At-least-once: commit depois de processar |
| Duplicatas nos consumidores | Tabela `processed_events` na mesma transação; chaves de idempotência para provedores externos |
| Ordenação | Chave por `orderId`; atualizações protegidas por versão para visões entre serviços |
| Mensagens venenosas | 3 retries com backoff, depois `order-events-dlt`, alerta quando não estiver vazia |
| Mudanças de schema | Avro + schema registry, compatibilidade full, tópico novo só para mudanças incompatíveis |

!!! tip "Na entrevista"
    Nunca diga "o Kafka dá exactly-once" e pare aí — entrevistadores usam isso para testar profundidade. Diga: "a entrega é at-least-once; o consumidor é idempotente porque registra o id do evento na mesma transação da sua escrita; as chamadas ao provedor de e-mail levam uma chave de idempotência". Depois mencione onde a mensagem poderia se perder do lado do produtor e como o outbox fecha essa brecha. Se o problema envolve dinheiro (pagamentos, carteiras, inventário de ingressos), comece pela idempotência antes de qualquer outra coisa.

!!! warning "Armadilhas comuns"

    - **Gerar o id do evento a cada envio.** Um retry com um id novo anula a deduplicação. O id pertence ao evento e é criado uma vez.
    - **Verificação de deduplicação e mudança de negócio em transações diferentes** — um crash entre elas perde ou duplica.
    - **Auto-commit** (`enable.auto.commit=true`) confirma em um timer, independentemente de o processamento ter terminado: pode dar at-most-once *e* duplicatas.
    - **Retries infinitos** de uma mensagem venenosa: a partição trava e o lag cresce para todo mundo.
    - **Uma DLQ que ninguém lê.** É só um jeito mais lento de perder mensagens.
    - **Mudar o tipo ou o significado de um campo de evento** sem uma nova versão: consumidores que você nem conhece quebram ou, pior, calculam valores errados em silêncio.

## Como se conecta { #how-it-connects }

``` mermaid
flowchart LR
    H1["salto 1: produtor → broker"] --> IP["produtor idempotente"]
    H1 --> OB["transactional outbox<br/>→ Padrões"]
    H2["salto 2: broker"] --> DUR["acks=all, min ISR 2<br/>→ Kafka"]
    H3["salto 3: broker → consumidor"] --> ALO["pelo menos uma vez:<br/>commit após processar"]
    TG["Dois Generais: não há entrega<br/>exatamente uma vez → aula 3"] --> EO
    ALO --> IDEM["consumidor idempotente<br/>tabela de dedup, chaves únicas"]
    IDEM --> EO["efetivamente uma vez"]
    ALO --> RETRY["retries com backoff<br/>→ Confiabilidade"]
    RETRY --> DLQ["dead letter queue<br/>alerta, redrive"]
    VER["atualizações guardadas por versão"] --> ORD["ordenação entre chaves"]
    REG["schema registry<br/>regras de compatibilidade"] --> EVO["evolução de schema"]
```

**Componentes da paleta:** [`queue`](../../../reference/components/messaging/index.md#queue) · [`kafka`](../../../reference/components/messaging/index.md#kafka) · [`worker`](../../../reference/components/compute/index.md#worker) · [`notifications`](../../../reference/components/compute/index.md#notifications) · [`sql`](../../../reference/components/storage/index.md#sql) (`processed_events` na mesma transação) · [`search`](../../../reference/components/compute/index.md#search) ("lugares restantes" guardados por versão) · [`email`](../../../reference/components/external/index.md#email) (efeito colateral externo: volta a pelo menos uma vez) · [`alerting`](../../../reference/components/observability/index.md#alerting) (DLQ não vazia). **Cenários:** `notification-system`, `payment-system`, `retry-storm`. **Continua em:** [Sistemas distribuídos — idempotência](../../distributed/index.md#idempotency), [Confiabilidade — retry com backoff e jitter](../../reliability/patterns/index.md#retry-with-backoff-and-jitter), [Compute — integrações](../../compute/integrations/index.md) (chaves de idempotência com provedores), [Observabilidade — alertas](../../observability/alerting/index.md), [Hands-on 7 — consumidor idempotente](../../../hands-on/7/consumer/index.md), [Exercício — event-driven](../../../exercises/event-driven/index.md).

---

[^1]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2. ed. O'Reilly. Capítulo sobre processamento de streams: tolerância a falhas, idempotência e exactly-once.
[^2]: [KIP-98 — Exactly Once Delivery and Transactional Messaging](https://cwiki.apache.org/confluence/display/KAFKA/KIP-98+-+Exactly+Once+Delivery+and+Transactional+Messaging){target="_blank"}. Apache Kafka, 2017.
[^3]: HELLAND, P. [Idempotence Is Not a Medical Condition](https://queue.acm.org/detail.cfm?id=2187821){target="_blank"}. *ACM Queue*, v. 10, n. 4, 2012.
[^4]: [Confluent Schema Registry — Schema Evolution and Compatibility](https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html){target="_blank"}; [especificação CloudEvents](https://cloudevents.io){target="_blank"}, CNCF.
