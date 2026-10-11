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
Roteiro: (1) por que a cadeia síncrona dói; (2) eventos, tópicos, partições, offsets; (3) Kafka,
chaves e grupos de consumidores; (4) garantias de entrega, outbox e sagas; (5) event sourcing, CQRS;
(6) dead letter queue; (7) quando não usar.
-->

---

## Comece por um pedido

<div class="q">

Um pedido é feito. **E-mail, estoque, fraude, entrega e analytics** precisam saber.
O que acontece com o tempo de resposta se o order service chamar cada um antes de responder?

</div>

* A latência vira a **soma** de todas as chamadas.
* Uma dependência lenta (ou com falha) **trava a requisição inteira**.
* O order service precisa **conhecer cada consumidor** — adicionar um significa alterá-lo.

<!--
Deixe a turma responder antes de mostrar os tópicos. O argumento do acoplamento (terceiro tópico) é o
que cresce junto com o sistema.
-->

---

## Dois contratos

<div class="cols">
<div>

### Cadeia síncrona

`POST /orders` → e-mail → estoque → fraude → `201 Created`

O cliente espera **por todos eles**.

</div>
<div>

### Publicar um evento

`POST /orders` → publica `OrderCreated` → `202 Accepted`

Cada consumidor reage **no seu próprio ritmo**.

</div>
</div>

| Aspecto | Síncrono (REST) | Assíncrono (evento) |
|---|---|---|
| Latência | soma de todas as chamadas | só a do produtor |
| Acoplamento | produtor conhece todos os consumidores | produtor não conhece nenhum |
| Resiliência | um consumidor lento bloqueia todos | falhas são independentes |
| Consistência | forte | **eventual** |

---

## O vocabulário

| Conceito | O que é | Exemplo |
|---|---|---|
| **Evento** | registro imutável de algo que aconteceu | `OrderCreated { orderId, … }` |
| **Comando** | instrução para fazer algo — pode ser rejeitada | `PlaceOrder { items, … }` |
| **Tópico** | log nomeado, durável e ordenado | `order-events` |
| **Partição** | fragmento do tópico, para paralelismo | partição 0, 1, 2 |
| **Offset** | posição de uma mensagem na partição | offset 42 |
| **Grupo de consumidores** | consumidores que dividem o trabalho de um tópico | `notification-service` |

<div class="ok">

**Eventos são fatos**: o log é append-only, nunca atualizado. É isso que torna seguro o **replay**.

</div>

---

## Kafka: tópicos, partições, grupos

- Um **tópico** é dividido em **partições** ordenadas; a ordem é garantida **dentro** de uma partição.
- Cada **grupo de consumidores** mantém seu offset por partição — `notification-group` e `analytics-group` leem o mesmo log de forma **independente**.
- Dentro de um grupo, **uma partição → um consumidor** por vez.
- Adicionar um novo grupo nunca afeta os existentes.

<div class="warn">

Mais consumidores do que partições? Os excedentes ficam **ociosos**. As partições são o teto do paralelismo.

</div>

<p class="small">As mensagens ficam após a leitura: <code>retention.ms</code> (padrão 7 dias), <code>retention.bytes</code> (por partição) ou <code>cleanup.policy=compact</code> (último valor por chave).</p>

---

## Chaves, ordem e durabilidade

- Com **chave**, `hash(key) % partitions` escolhe a partição → mesma chave, mesma partição, **em ordem**.
- Hands-on 9: `send("order-events", orderId, event)` → os eventos de um pedido ficam em sequência; pedidos diferentes, em paralelo.
- Poucos valores de chave (ex.: `country`) → **partições quentes**; adicionar partições depois move chaves.
- Cada partição é **replicada** (tipicamente 3): uma líder + seguidoras; as atualizadas formam o **ISR**.

| `acks` | Confirmado quando… | Risco |
|---|---|---|
| `0` | enviado | perdido se o broker não recebeu |
| `1` | a líder gravou | perdido se a líder cair antes |
| `all` | todas as réplicas em sincronia têm | mais lento — sobrevive à perda de um broker |

---

## Pub/sub × consumidores concorrentes

<div class="cols">
<div>

### Pub/sub (fan-out)

Um evento → **cada** grupo recebe sua própria cópia.

E-mail, log de auditoria, analytics, invalidação de cache.

</div>
<div>

### Consumidores concorrentes

Consumidores do **mesmo** grupo dividem as partições → cada mensagem processada **uma vez**.

Processamento de pedidos, pagamentos, redimensionamento de imagens.

</div>
</div>

<div class="ok">

Mesmo broker, dois padrões: **grupos diferentes fazem fan-out**, **o mesmo grupo divide o trabalho**.

</div>

---

## Garantias de entrega

<div class="q">

O notification service envia o e-mail e **cai antes de fazer o commit** do offset. O que acontece no reinício?

</div>

* Ele lê a mesma mensagem **de novo**: commit após processar = **at-least-once**.
* Commit *antes* de processar = **at-most-once**: uma queda **perde** a mensagem.
* O exactly-once do Kafka cobre só Kafka → Kafka; não dá para "desenviar" um e-mail.
* Então: at-least-once + **consumidor idempotente** — tabela de IDs processados, upserts, restrições de unicidade.

<!--
O Hands-on 9 usa enable_auto_commit=False e commit() após o processamento: at-least-once.
-->

---

## A escrita dupla e o outbox

Salvar o pedido no Postgres **e** publicar no Kafka são dois sistemas, sem transação em comum:

- commit, depois queda antes de publicar → o pedido existe, **evento perdido**;
- publica, depois rollback → evento sobre um pedido que **não existe**.

**Transactional outbox**: `INSERT INTO orders` + `INSERT INTO outbox` em **uma transação local** → um relay (polling ou CDC/Debezium) publica no Kafka e marca a linha como enviada.

<div class="warn">

O relay pode publicar duas vezes após uma queda: os consumidores ainda precisam ser **idempotentes**.

</div>

---

## Sagas

Uma operação de negócio, vários bancos: reservar estoque, depois cobrar o cartão.

`OrderCreated` → estoque reserva → `StockReserved` → pagamento falha → `PaymentFailed` → estoque **libera** (compensação) → pedido `CANCELLED`

| Estilo | Coordenação | Cuidado |
|---|---|---|
| **Coreografia** | serviços reagem aos eventos uns dos outros | o fluxo fica espalhado |
| **Orquestração** | um orquestrador envia comandos | mais um serviço para operar |

<p class="small">Sem isolamento: outros veem estados intermediários — modele-os (<code>PENDING</code>, <code>CONFIRMED</code>, <code>CANCELLED</code>).</p>

---

## Event sourcing

Guarde o **histórico**, não só o estado atual.

- O modelo de escrita **é** o log de eventos: `OrderCreated`, `ItemAdded`, `OrderPaid`, …
- Estado atual = **replay** dos eventos (ou a partir de um snapshot).
- Projeções (modelos de leitura) podem ser **reconstruídas a qualquer momento** — depuração com "viagem no tempo", novas visões sem migrar dados.

> O banco guarda onde você está; o log de eventos guarda como você chegou lá.

---

## CQRS

Separe o **lado de escrita** do **lado de leitura**.

- **Comandos** (`POST /orders`) → command handler → event store → barramento de eventos.
- **Consultas** (`GET /orders`) → um **modelo de leitura** moldado para a consulta.
- Costuma vir com event sourcing, mas não é obrigatório: change-data-capture pode sincronizar dois bancos.

<div class="warn">

O modelo de leitura é **eventualmente consistente**: logo após um comando, uma consulta pode ainda não vê-lo.

</div>

---

## Quando uma mensagem continua falhando

Uma mensagem envenenada não pode **bloquear o stream**.

1. O consumidor a pega → **processamento**.
2. Falha transitória → **retry** após um backoff.
3. Máximo de retries excedido → vai para a **Dead Letter Queue** (um tópico separado).
4. O stream principal continua; a DLQ é inspecionada e **reprocessada manualmente**.

<p class="small">Spring Kafka: <code>@RetryableTopic</code> configura tentativas, backoff e o tópico da DLQ de forma declarativa.</p>

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

---

## O preço

<div class="warn">

Uma requisição que cruza **5 serviços e 3 tópicos** é difícil de depurar: você precisa de **rastreamento distribuído** (aula de Observabilidade) para segui-la.

</div>

- A consistência eventual precisa ser **projetada** — na interface e nas regras de negócio.
- Os consumidores precisam ser **idempotentes**: entrega at-least-once significa que duplicatas acontecem.
- Eventos são um contrato público: só **adicione campos opcionais**; versione mudanças incompatíveis.
- Acompanhe o **lag dos consumidores** por grupo — um backlog crescente é um incidente em câmera lenta.
- Adote eventos quando o **acoplamento e a latência** das chamadas síncronas forem problemas concretos — não por si só.

---

## Pontos-chave

1. Cadeias síncronas somam **latência** e **acoplamento**; eventos desacoplam produtor e consumidores.
2. Um **evento** é um fato imutável; um **comando** pode ser rejeitado.
3. Kafka: tópico → **partições**; a **chave** escolhe a partição e, com isso, a ordem; `acks=all` para durabilidade.
4. Grupos diferentes fazem **fan-out**; o mesmo grupo **divide** o trabalho.
5. A entrega é **at-least-once**: commit após processar, consumidores **idempotentes**.
6. **Outbox** em vez de escritas duplas; **sagas** com compensações em vez de transações distribuídas.
7. **Event sourcing**, **CQRS** e **DLQs** resolvem problemas específicos — o custo é a consistência eventual e o **rastreamento**.
