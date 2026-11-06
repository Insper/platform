---
marp: true
lang: pt-BR
title: Arquitetura Orientada a Eventos
description: Plataformas, Microsserviços, DevOps e APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Plataformas, Microsserviços, DevOps e APIs · Insper</div>

# Arquitetura Orientada a Eventos

**Publique um fato, deixe os outros reagirem**

<!--
Roteiro: (1) por que orientado a eventos: a cadeia síncrona vs. publicar um evento; (2) conceitos
fundamentais; (3) Kafka: o log, chaves e ordem, durabilidade; (4) padrões de mensageria: pub/sub,
consumidores concorrentes, event sourcing, CQRS; (5) garantias de entrega e consumidores idempotentes;
(6) outbox e sagas; (7) dead letter queue; (8) quando usar e as armadilhas.
-->

---

## Comece por um pedido

<div class="q">

Um pedido é feito. **E-mail, estoque, fraude, entrega e analytics** precisam saber.
O que acontece com o tempo de resposta se o order service chamar cada um antes de responder?

</div>

* A latência vira a **soma** de todas as chamadas — um penhasco de latência.
* Uma dependência lenta (ou com falha) **trava a requisição inteira**.
* O order service precisa **conhecer cada consumidor** — uma explosão de acoplamento.

<!--
Deixe a turma responder antes de mostrar os tópicos. O contrato alternativo: publicar um evento e
deixar os interessados reagirem de forma assíncrona.
-->

---

<!-- _class: tight -->

## Dois contratos

<div class="cols">
<div>

### Cadeia síncrona

`POST /orders` → e-mail → estoque → fraude → `201 Created`: o cliente espera **por todos eles**.

</div>
<div>

### Publicar um evento

`POST /orders` → publica `OrderCreated` → `202 Accepted`: cada consumidor reage **no seu próprio ritmo**.

</div>
</div>

| Aspecto | Síncrono (REST) | Assíncrono (evento) |
|---|---|---|
| Latência | soma de todas as chamadas | só a do produtor |
| Acoplamento | produtor conhece todos os consumidores | produtor não conhece nenhum |
| Resiliência | um consumidor lento bloqueia todos | falhas são independentes |
| Vazão | limitada pela dependência mais lenta | consumidores escalam de forma independente |
| Depuração | trace simples da requisição | exige rastreamento distribuído |
| Consistência | forte | **eventual** |

<!--
A simulação de profundidade da fila na página: produtor 3/passo, consumidor 2/passo → a fila cresce
sem limite; o consumidor escala para 5/passo no passo 10 → ele alcança. Esse backlog é o lag do consumidor.
-->

---

<!-- _class: tight -->

## Conceitos fundamentais

| Conceito | O que é | Exemplo |
|---|---|---|
| **Evento** | registro imutável de algo que aconteceu | `OrderCreated { orderId, … }` |
| **Comando** | instrução para fazer algo — pode ser rejeitada | `PlaceOrder { items, … }` |
| **Broker** | guarda as mensagens e as entrega aos consumidores | um broker Kafka (`kafka:9092`) |
| **Tópico** | log nomeado, durável e ordenado | `order-events` |
| **Partição** | fragmento do tópico; a ordem só vale dentro dela | partição 0, 1, 2 |
| **Chave** | valor opcional que decide a partição | `orderId` |
| **Offset** | posição de uma mensagem na partição | offset 42 na partição 1 |
| **Grupo de consumidores** | consumidores que dividem o trabalho de um tópico | `notification-group` |

<div class="ok">

**Eventos são fatos**: o log é append-only, nunca atualizado nem apagado. É isso que torna seguro o **replay**.

</div>

---

## Kafka: um log, não uma fila

- Produtores **acrescentam** ao final; consumidores leem de **qualquer posição**; as mensagens **ficam** depois de lidas.
- Uma fila clássica (RabbitMQ) remove a mensagem assim que um consumidor confirma o recebimento.
- Um **tópico** é dividido em **partições** ordenadas; cada **grupo de consumidores** mantém seu offset por partição.
- `notification-group` e `analytics-group` leem o mesmo log de forma **independente**; um grupo novo nunca afeta os outros.

| Retenção | Configuração | Comportamento |
|---|---|---|
| Tempo | `retention.ms=604800000` | apaga após 7 dias (o padrão) |
| Tamanho | `retention.bytes=1073741824` | os segmentos mais antigos saem quando uma **partição** passa de 1 GB |
| Compactação | `cleanup.policy=compact` | guarda só a última mensagem por chave |

---

## Chaves, partições e ordem

- Com **chave**, `hash(key) % partitions` escolhe a partição → mesma chave, mesma partição, **em ordem**.
- Sem chave → mensagens espalhadas pelas partições, **sem ordem** entre eventos relacionados.
- A ordem só vale **dentro** de uma partição: a chave escolhe **o que** precisa ficar em ordem.
- Hands-on 10: `kafkaTemplate.send("order-events", order.getId().toString(), event)` → `OrderCreated`, `OrderPaid`, `OrderShipped` de um pedido em sequência; pedidos diferentes, em paralelo.

<div class="warn">

**Escolhendo a chave**: poucos valores (ex.: `country`) → **partições quentes**; adicionar partições depois muda `hash(key) % partitions` e move chaves — dimensione as partições desde o início.

</div>

---

## Durabilidade: replicação e `acks`

Cada partição é **replicada** (tipicamente 3): uma **líder** recebe as escritas e **seguidoras** a copiam; as atualizadas formam o **ISR**. Se a líder cai, uma seguidora em sincronia assume.

| `acks` | Confirmado quando… | Risco |
|---|---|---|
| `0` | enviado (sem confirmação) | perdido se o broker não recebeu |
| `1` | a líder gravou | perdido se a líder cair antes de as seguidoras copiarem |
| `all` | todas as réplicas em sincronia têm (`min.insync.replicas` ≥ 2) | mais lento — sobrevive à perda de um broker |

- Hands-on 10: `acks: all` + `enable.idempotence: true` — os retries do próprio produtor não criam duplicatas (os padrões desde o Kafka 3.0).
- Metadados: o **KRaft** (quórum Raft) substituiu o ZooKeeper, removido no Kafka 4.0; o Hands-on 10 roda um nó que é broker e controller.

---

## Pub/sub × consumidores concorrentes

<div class="cols">
<div>

### Pub/sub (fan-out)

Um evento → **cada** grupo recebe sua própria cópia; um pipeline de analytics lento não atrasa as notificações.

E-mail, log de auditoria, analytics, invalidação de cache.

</div>
<div>

### Consumidores concorrentes

Consumidores do **mesmo** grupo dividem as partições → cada mensagem processada por **um** consumidor.

Processamento de pedidos, pagamentos, redimensionamento de imagens.

</div>
</div>

<div class="warn">

Teto do paralelismo = partições: com 3 partições, um quarto consumidor fica **ocioso**. Um consumidor que entra ou sai dispara um **rebalanceamento**.

</div>

---

## Event sourcing

Guarde o **histórico completo de eventos**, não só o estado atual.

- O modelo de escrita **é** o log de eventos: `OrderCreated`, `OrderPaid`, `OrderShipped`, …
- Estado atual = **replay** dos eventos desde o início (ou a partir de um snapshot).
- Comando → append no **event store** → `202 Accepted`; uma **projeção** atualiza o modelo de leitura.
- Projeções podem ser **reconstruídas a qualquer momento**: depuração com "viagem no tempo", migração de esquema sem downtime.

---

## CQRS

Separe o **lado de escrita** (comandos, eventos, event store) do **lado de leitura** (consultas, projeções).

- **Comandos** (`POST /orders`) → command handler → event store + barramento de eventos (Kafka).
- **Consultas** (`GET /orders`) → um **modelo de leitura** otimizado para a consulta.
- Costuma vir com event sourcing, mas não é obrigatório: **CDC** (o Debezium lê o log de transações) pode sincronizar dois bancos.

<div class="warn">

**Não são o padrão**: eventos versionados para sempre, modelos de leitura **eventualmente consistentes**, reconstruções lentas. Use-os onde o domínio precisa de trilha de auditoria ou de formatos de leitura e escrita muito diferentes (histórico de pedidos, livros-razão) — não em toda entidade CRUD.

</div>

---

## Garantias de entrega

Um consumidor lê, processa (p. ex. envia um e-mail) e **faz o commit do offset**. *Quando* ele faz o commit decide o custo de uma queda:

| Garantia | Como | Uma queda significa |
|---|---|---|
| **At-most-once** | commit **antes** de processar | a mensagem é **perdida** |
| **At-least-once** | commit **depois** de processar | a mensagem é **processada de novo** |
| **Exactly-once** | transações do Kafka (`read_committed`) | nenhum dos dois — mas só Kafka → Kafka |

<p class="small">Hands-on 10: <code>enable_auto_commit=False</code> + <code>commit()</code> após o processamento = at-least-once. O Kafka não consegue "desenviar" um e-mail nem desfazer uma linha no Postgres.</p>

---

## Consumidores idempotentes

<div class="q">

O notification service envia o e-mail e **cai antes do commit** do offset 42. No reinício, lê o offset 42 de novo. O cliente recebe dois e-mails?

</div>

Não, se processar duas vezes tiver o **mesmo efeito** que processar uma:

- **Tabela de mensagens processadas**: grave o ID do evento na mesma transação da mudança de negócio; pule eventos já gravados.
- **Idempotência natural**: `UPSERT`, "definir status como PAID" em vez de "somar 10 ao saldo".
- **Restrições de unicidade**: o banco rejeita um segundo insert do mesmo `orderId`.

---

## A escrita dupla e o outbox

O Hands-on 10 salva o pedido no Postgres e *depois* publica no Kafka — dois sistemas, sem transação em comum:

- commit, depois queda antes de publicar → o pedido existe, **ninguém é avisado**;
- publica, depois rollback → consumidores reagem a um pedido que **não existe**.

**Transactional outbox**: `INSERT INTO orders` + `INSERT INTO outbox` em **uma transação local** (os dois ou nenhum) → um relay (polling ou CDC/Debezium) publica no Kafka e marca a linha como enviada.

<div class="warn">

O relay pode publicar duas vezes após uma queda: os consumidores ainda precisam ser **idempotentes**.

</div>

---

## Sagas

Uma operação de negócio, vários bancos (reservar estoque, cobrar o cartão): não há uma única transação ACID. Uma **saga** = transações locais, cada uma disparada pelo evento anterior; na falha, **compensações**.

`OrderCreated` → estoque reserva → `StockReserved` → pagamento falha → `PaymentFailed` → estoque **libera** → pedido `CANCELLED`

| Estilo | Coordenação | Cuidado |
|---|---|---|
| **Coreografia** | serviços reagem aos eventos uns dos outros | o fluxo fica espalhado, difícil de seguir |
| **Orquestração** | um orquestrador envia comandos | mais um serviço para construir e operar |

<p class="small">Sagas não são transações: sem isolamento — modele os estados (<code>PENDING</code>, <code>CONFIRMED</code>, <code>CANCELLED</code>) e torne cada passo e cada compensação idempotentes.</p>

---

<!-- _class: tight -->

## Dead letter queue

Uma mensagem que continua falhando não pode **bloquear o stream**: esgotados os retries, ela vai para uma **DLQ** (um tópico separado), inspecionada e reprocessada manualmente.

```java
@RetryableTopic(backOff = @BackOff(delay = 1000, multiplier = 2))   // 3 attempts in total
@KafkaListener(topics = "order-events", groupId = "invoice-group")
public void onOrderCreated(OrderCreatedEvent event) {
    invoiceService.create(event);   // throws → retried after 1 s, then 2 s
}

@DltHandler
public void onDeadLetter(OrderCreatedEvent event) { log.error(...); }
```

<div class="warn">

Faça retry só de falhas que podem dar certo depois (um banco fora por instantes). JSON inválido ou um ID de produto desconhecido vai **direto para a DLQ**: o retry só atrasa a partição.

</div>

---

## REST ou evento?

| Cenário | Opção | Por quê |
|---|---|---|
| Login / geração de token | REST | quem chama precisa do token agora |
| E-mail de confirmação do pedido | evento | o usuário não espera por ele |
| Checagem de fraude que precisa bloquear | REST | a resposta libera o próximo passo |
| Log de auditoria de toda alteração | evento | fire-and-forget, fan-out |
| Pagamento | depende | retry idempotente → evento; confirmação bloqueante → REST + saga |
| Pipeline de analytics | evento | alto volume, consumidores lentos não são problema |
| Health check do serviço | REST | síncrono por natureza |

---

## O preço e as armadilhas

<div class="warn">

Uma requisição que cruza **5 serviços e 3 tópicos** exige **rastreamento distribuído** para ser depurada. Adote eventos quando o acoplamento e a latência das chamadas síncronas forem problemas **concretos**.

</div>

- **Supor exactly-once**: duplicatas *vão* chegar; todo consumidor precisa ser idempotente.
- **Escritas duplas** sem outbox perdem ou inventam eventos após uma queda.
- **Quebrar o esquema do evento**: só adicione campos opcionais; versione (`OrderCreatedV2`) — um schema registry pode garantir isso.
- **Ignorar o lag do consumidor**: monitore-o por grupo (Kafka UI, Prometheus) e alerte quando crescer.
- **Comandos disfarçados**: `SendEmailToCustomer` acopla a um consumidor — publique o fato (`OrderCreated`).

---

## Pontos-chave

1. Use **eventos** quando quem chama não precisa da resposta para continuar; uma **requisição síncrona** quando precisa.
2. O Kafka é um **log** replicado e particionado: a ordem vale dentro de uma partição, a **chave** escolhe a partição, cada grupo mantém seus offsets — grupos diferentes fazem **fan-out**, o mesmo grupo **divide** o trabalho.
3. Na prática, a entrega é **at-least-once**: commit depois de processar, todo consumidor **idempotente**.
4. Nunca faça escrita dupla: o **transactional outbox** publica com confiabilidade; **sagas** com compensações substituem transações distribuídas.
5. **Event sourcing** e **CQRS** são para domínios específicos, não são o padrão; uma **DLQ** impede que mensagens envenenadas bloqueiem uma partição.
