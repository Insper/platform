---
marp: true
lang: pt-BR
title: Mensageria e Arquitetura Orientada a Eventos
description: Arquitetura de Sistemas · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">Arquitetura de Sistemas · Insper</div>

# Mensageria e Arquitetura Orientada a Eventos

**Envie uma mensagem, siga em frente — e trate o que isso implica**

<!--
Roteiro: (1) síncrono vs assíncrono e o que um broker oferece; (2) filas, backpressure e a sala de
espera; (3) pub/sub; (4) Kafka: log, partições, chaves, grupos, replicação, dimensionamento;
(5) semântica de entrega, idempotência, DLQ, schemas; (6) outbox, CDC, sagas, CQRS, event sourcing.
-->

---

## 10:00 — dois milhões de fãs, sessenta mil lugares

<div class="q">

A compra reserva lugares, cobra o cartão, **envia o e-mail**, atualiza busca e analytics — tudo em uma requisição.
O provedor de e-mail passa de 80 ms para 800 ms. O que acontece com o botão "Comprar"?

</div>

* Cada compra fica **720 ms mais lenta**; o `order` fica sem threads.
* Fãs prestes a pagar veem um spinner e depois um **erro**.
* Nada quebrou: cada passo só precisava **terminar antes de alguém receber resposta**.

<!--
Deixe a turma responder. O ponto: o e-mail não é necessário para responder ao fã, mas está no
caminho crítico. Essa é toda a motivação da mensageria.
-->

---

## Duas ligações da compra

<div class="flow">
<div class="arrow" style="flex: .4; text-align: left">Síncrono</div>
<div class="box">fã</div><div class="arrow">→</div>
<div class="box accent">order</div><div class="arrow">espera →</div>
<div class="box red">notification<small>800 ms hoje</small></div><div class="arrow">→</div>
<div class="box">search</div><div class="arrow">→</div>
<div class="box">analytics</div><div class="arrow">→ 201</div>
</div>
<div class="flow" style="align-items: stretch">
<div class="arrow" style="flex: .4; text-align: left; align-self: center">Assíncrono</div>
<div class="box" style="align-self: center">fã</div><div class="arrow" style="align-self: center">→</div>
<div class="box accent" style="align-self: center">order<small>201 depois de salvar e publicar</small></div><div class="arrow" style="align-self: center">publica →</div>
<div class="box orange" style="align-self: center">Kafka<small>OrderConfirmed</small></div><div class="arrow" style="align-self: center">→</div>
<div class="group">
<div class="caption">cada um no seu ritmo</div>
<div class="box green">notification</div><div class="box green">search</div><div class="box green">analytics</div>
</div>
</div>

- Síncrono: o fã espera a **soma** das chamadas e **qualquer** falha derruba a compra.
- Assíncrono: o fã espera um salvamento e uma publicação; um consumidor lento só aumenta o backlog **dele**.

<!--
A página desenha os dois como diagramas de sequência passo a passo (as duas abas de "Síncrono vs assíncrono").
-->

---

## Cadeia síncrona vs eventos assíncronos

| | Cadeia síncrona | Eventos assíncronos |
|---|---|---|
| Latência para o fã | soma de todas as chamadas | salvar + publicar uma mensagem |
| Disponibilidade do "Comprar" | `0.9995 × 0.999³ ≈ 99.65%` | `0.9995 × 0.9995 ≈ 99.90%` |
| Acoplamento | `order` conhece cada consumidor | `order` conhece um tópico + schema |
| Um consumidor falha | a compra falha | o backlog dele cresce |
| Consistência | pronto quando o fã vê `201` | consumidores alcançam depois (eventual) |

<div class="ok">

**Se quem chama precisa da resposta para continuar, chame. Se só precisa que o trabalho aconteça, envie uma mensagem.**

</div>

<!--
A reserva de lugares continua síncrona: o fã precisa da resposta agora e ela precisa ser fortemente
consistente.
-->

---

## O que um broker oferece — e quanto custa

<div class="cols">
<div>

### Oferece

- **Desacoplamento temporal** — o consumidor pode estar fora
- **Nivelamento de carga** — um pico vira backlog
- **Fan-out** — novos consumidores, produtor intacto
- **Escala independente** e isolamento de falhas

</div>
<div>

### Custa

- **Consistência eventual** — "120 lugares restantes" por um tempo
- **Duplicatas e reordenação** — consumidores idempotentes
- **Depuração mais difícil** — tracing e métricas de lag
- **Mais um sistema crítico** para operar

</div>
</div>

---

## Nivelamento de carga em números

Pico de **6.000 req/s por 3 min**, workers escoam **2.000 req/s**.

- O backlog cresce a `λ − μ = 4,000/s` → `4,000 × 180 = 720,000` mensagens.
- O último fã espera `backlog / μ = 720,000 / 2,000 = 360 s` (Lei de Little).
- Dobrar os workers → metade do pico **e** escoamento muito mais rápido.

<div class="warn">

Uma fila absorve **picos**, não uma falta permanente: se a chegada média passa da capacidade, o backlog cresce para sempre.

</div>

<p class="small">Playground: <code>async-queue</code> com o perfil spike — observe a profundidade da fila e o consumer lag.</p>

---

## A paleta de mensageria

| Componente | Forma | Quem recebe uma mensagem | Depois da leitura |
|---|---|---|---|
| `queue` | ponto a ponto | **um** consumidor do pool | apagada |
| `pubsub` | fan-out | **toda** assinatura | apagada por assinatura |
| `stream` | log particionado (gerenciado) | todo consumer group | **mantida** até a retenção |
| `kafka` | log particionado e replicado | todo consumer group | **mantida** (ou compactada) |

- **Comando** (`GenerateTicketPdf`) — faça algo; um receptor.
- **Evento** (`OrderConfirmed`) — um fato, no passado; qualquer um pode reagir.

<!--
Fila: ler é tirar. Log: ler é olhar, com um marcador por leitor.
-->

---

## O que vai dentro de um evento

<div class="cols">
<div>

### Notificação de evento

`{ type, eventId, orderId, occurredAt }`

- Pequeno e estável.
- Cada consumidor **chama de volta** `GET /orders/o-7731`: uma chamada a mais por consumidor e por evento, e o `order` precisa estar no ar.

</div>
<div>

### Transferência de estado no evento

`{ …, customer, event, seats, total }`

- Os consumidores **nunca chamam de volta**: desacoplados da disponibilidade do `order`.
- Payload maior, schema mais difícil de mudar, dado pessoal (o e-mail) copiado para todo consumidor.

</div>
</div>

<div class="ok">

Dê nome aos eventos **no passado** (`OrderConfirmed`); `SendConfirmationEmail` é um comando disfarçado.

</div>

---

## Chamada, fila, pub/sub ou log?

<div class="flow">
<div class="box accent" style="flex: 2">Quem chama precisa da resposta para continuar?</div><div class="arrow">sim →</div>
<div class="box" style="flex: 1.4">chamada síncrona<small>com timeout: login, reservar lugares</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .3">não ↓</div>
<div class="box accent" style="flex: 1.7">Quantos serviços precisam reagir?</div><div class="arrow">um trabalho só →</div>
<div class="box green" style="flex: 1.4">queue<small>consumidores concorrentes: o PDF do ingresso</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .3">vários ↓</div>
<div class="box accent" style="flex: 1.7">Precisa de replay, ordem por chave, alto throughput?</div><div class="arrow">não →</div>
<div class="box green">pubsub<small>e-mail e push</small></div><div class="arrow">sim →</div>
<div class="box orange">stream · kafka<small>warehouse, busca</small></div>
</div>

<p class="small">Numa fila, ler é <b>tirar</b>; num log, ler é <b>olhar</b>, com um marcador por leitor. A tabela "Quando <i>não</i> ir para o assíncrono" da página classifica oito interações do BoxOffice assim.</p>

---

## A vida de uma mensagem na fila

<div class="flow">
<div class="box">receber<small>worker 1 pega o o-7731</small></div><div class="arrow">→</div>
<div class="box orange">escondida 30 s<small>visibility timeout</small></div><div class="arrow">→</div>
<div class="box red">worker 1 cai<small>antes do ack</small></div><div class="arrow">→</div>
<div class="box orange">visível de novo</div><div class="arrow">→</div>
<div class="box">worker 2<small>entrega 2</small></div><div class="arrow">ack →</div>
<div class="box green">apagada</div>
</div>

- O broker só apaga a mensagem no **ack**: nenhuma mensagem se perde quando um worker morre.
- Com consumidores concorrentes **não há ordem**; filas FIFO (*first-in, first-out*) a mantêm por id de grupo.

<div class="warn">

At-least-once: um crash depois do upload faz o job rodar duas vezes → consumidor **idempotente** (`tickets/o-7731.pdf` é um nome determinístico). Um visibility timeout **menor que o job** faz todo job lento rodar duas vezes.

</div>

---

## Dimensionando o pool de workers

> workers ocupados = λ × S (Lei de Little)

- ~30.000 pedidos confirmados em 3 min → `λ ≈ 167/s`; o PDF leva `S = 0.4 s`.
- Em tempo real: `167 × 0.4 ≈ 67` ocupados → ~95 workers a 70% de utilização.
- 20 workers (50/s): backlog ≈ 21.000, escoa em ~7 min depois da venda.

<div class="ok">

Trabalho assíncrono é dimensionado por um **objetivo de atraso** ("ingressos por e-mail em até 15 min"), não por latência de requisição.

</div>

<p class="small">Simulador <code>queue</code>: 95 workers (ρ = 0,70) dão conta; com 60 (ρ = 1,11) o backlog só cresce; um pico de 3× chega a cerca de 5.300 jobs.</p>

---

<!-- _class: tight -->

## Backpressure: o que acontece quando a fila enche?

| Estratégia | Exemplo no BoxOffice | Custo |
|---|---|---|
| Buffer (limitado) | a fila de PDF absorve a abertura | o atraso cresce |
| Escalar consumidores | KEDA (*Kubernetes Event-driven Autoscaling*) pelo tamanho da fila | a carga vai para frente |
| Rejeitar na borda | `429` / `503` + `Retry-After` | erro rápido e honesto |
| Desacelerar o produtor | o producer do Kafka bloqueia (`max.block.ms`) | a latência vai para trás |
| Descartar / expirar | "lugares restantes" velhos, tempo de vida (TTL, *time to live*) no push | perda de dados por projeto |
| Descartar por prioridade | confirmações antes de marketing | filas separadas |

<div class="ok">

Alerte sobre a **idade da mensagem mais antiga**, não só sobre a profundidade.

</div>

---

## A sala de espera da flash sale

<div class="flow">
<div class="box">2 M de fãs</div><div class="arrow">entram →</div>
<div class="box orange">sala de espera<small>sorted set do Redis: posição</small></div><div class="arrow">admite N/s →</div>
<div class="box accent">token de admissão<small>vida curta, assinado</small></div><div class="arrow">→</div>
<div class="box">gateway<small>rejeita chamadas sem ele</small></div><div class="arrow">→</div>
<div class="box green">inventory<small>~1.100 reservas/s</small></div>
</div>

- N = capacidade medida × fator de segurança: `1.100 × 0,5 ≈ 500` fãs/s; espera honesta = posição / N.
- Esgotou → "**esgotado**" pela borda, sem tocar no banco. Bots: desafio e limites por conta aqui.
- Justiça: posição aleatória para quem chegou cedo, ordem de chegada depois.
- Lab 7: o score vem de `INCR` (o servidor decide a ordem), 20 fãs/s por padrão, uma chave de *admitido* com TTL de 5 minutos, conferida pelo `POST /orders`.

<p class="small">Playground: <code>flash-sale</code> começa <b>sem</b> sala de espera — veja <code>app</code> e <code>inventory-db</code> saturarem às 10:00 e depois construa a fila.</p>

---

<!-- _class: tight -->

## Publish/subscribe

<div class="flow" style="align-items: stretch">
<div class="box accent" style="align-self: center; flex: .8">order</div><div class="arrow" style="align-self: center">OrderConfirmed →</div>
<div class="box orange" style="align-self: center">tópico<small>order-events</small></div><div class="arrow" style="align-self: center">uma cópia cada →</div>
<div class="group"><div class="caption">assinatura notification</div><div class="box green">notification #1</div><div class="box green">notification #2</div></div>
<div class="group"><div class="caption">assinatura search</div><div class="box green">indexador da busca</div></div>
<div class="group"><div class="caption">assinatura analytics</div><div class="box green">carregador do analytics</div></div>
</div>

- Dentro de uma assinatura os consumidores **competem**; entre assinaturas todos veem tudo.
- Um consumidor de pontos de fidelidade = **uma assinatura nova**, `order` intacto e sem saber.
- **Pull**: os consumidores pedem, controle de fluxo natural (workers). **Push**: o broker chama um endpoint HTTPS (serverless, webhooks).

<div class="warn">

Redis Pub/Sub e NATS core são **efêmeros**: assinantes desconectados perdem mensagens. Serve para "digitando…", não para pedidos.

</div>

---

## O log: ler não apaga

- Registros só de acréscimo e ordenados; cada um recebe um **offset**.
- Cada leitor guarda a própria posição → **muitos leitores independentes**.
- **Replay**: volte o offset (reindexar depois de um bug); comece um leitor novo do 0.
- Um **tópico** = N **partições**, cada uma um log independente em um broker diferente.
- A ordem é garantida **só dentro de uma partição**.

<!--
Os três pedidos do gancho: carregador do warehouse (histórico), correção da busca (replay), fraude
(ordem por pedido). Uma fila não faz nenhum deles.
-->

---

## A chave decide a partição

> partição = murmur2(chave) mod N

- Mesma chave → mesma partição → **em ordem**. Chave por `orderId`.
- Chave pelo show na abertura do estádio → **uma partição recebe ~60%** do tráfego.
- Escolha a **chave mais fina que preserve a ordem de que você precisa**.

<div class="warn">

Mudar N move as chaves (`hash mod N` muda) — dimensione as partições com folga desde o início.

</div>

---

<!-- _class: tight -->

## Consumer groups e lag

<div class="flow" style="align-items: stretch">
<div class="group" style="flex: .7"><div class="caption">order-events · 6 partições</div>
<div class="box orange">P0 · P1</div><div class="box orange">P2 · P3</div><div class="box orange">P4 · P5</div></div>
<div class="arrow" style="align-self: center">um leitor por<br>partição, por grupo →</div>
<div class="group"><div class="caption">grupo notification · 3 consumidores</div>
<div class="box green">notification #1<small>P0, P1</small></div><div class="box green">notification #2<small>P2, P3</small></div><div class="box green">notification #3<small>P4, P5</small></div></div>
<div class="group" style="flex: .8"><div class="caption">grupo analytics</div>
<div class="box green">analytics #1<small>as 6, com offsets próprios</small></div></div>
</div>

- Paralelismo máximo de um grupo = **número de partições**: 8 consumidores em 6 partições → 2 ociosos.
- **Lag** = offset do fim do log − offset confirmado, por partição: uma partição quente = chave quente, consumidor travado ou mensagem venenosa.
- Rebalance quando membros entram, saem ou param de fazer poll (`max.poll.interval.ms`).

<p class="small">Simulador <code>kafka</code> (as 6 partições e os 3 consumidores do lab 7): chave pelo show → <code>ev-1</code> cai na P5, que fica para trás. Playground: <code>event-fanout</code>.</p>

---

## Replicação e durabilidade

| `acks` | Confirmado quando… | Uma falha de broker pode… |
|---|---|---|
| `0` | enviado | ❌ perder registros em silêncio |
| `1` | a líder gravou | ⚠️ perder registros confirmados |
| `all` | toda réplica sincronizada (ISR, *in-sync replica*) tem | ✅ não perdê-los, com min ISR ≥ 2 |

- **Fator de replicação (RF, *replication factor*) 3 entre zonas de disponibilidade (AZs, *availability zones*) + `min.insync.replicas=2` + `acks=all`**: um broker fora, as escritas continuam; nada confirmado vive em uma só máquina.
- O lab 7 roda um broker com RF 1: ali `acks: all` espera exatamente uma réplica — a armadilha acima.
- Metadados com controllers **KRaft** (Raft); ZooKeeper removido no Kafka 4.0.

---

## Retenção, compactação e por que o Kafka é rápido

<div class="flow">
<div class="box red">0 · ev-88<small>21:00</small></div><div class="box red">1 · ev-90<small>Jazz Night</small></div>
<div class="box">2 · ev-88<small>20:00</small></div><div class="box">3 · ev-91<small>Theater</small></div><div class="box muted">4 · ev-90<small>null (tombstone)</small></div>
<div class="arrow">compacta →</div>
<div class="box green">2 · ev-88<small>20:00</small></div><div class="box green">3 · ev-91<small>Theater</small></div>
</div>

- **Apagar** por tempo (`retention.ms`, 7 dias para `order-events`: replay e o warehouse) ou por tamanho.
- **Compactar** (`event-catalog`): sobrevive o registro mais recente de cada chave, com seu offset; um tombstone apaga uma chave.
- **Tiered storage**: segmentos antigos vão para object storage — meses de retenção, barato.
- Rápido: acréscimos sequenciais, o page cache do sistema operacional, zero-copy com `sendfile`, lotes comprimidos com `zstd`. O preço: alguns ms de `linger.ms`.

---

## Dimensionando partições

> N ≥ max(T / p, T / c) e depois adicione folga

- Pico: 30.000 pedidos × 10 eventos / 180 s ≈ **1.700 eventos/s** — trivial para os produtores.
- `notification`: 50 ms por e-mail → `c = 20/s` por partição.
- `OrderConfirmed` ≈ 167/s → `N ≥ 167 / 20 ≈ 9` → crie **24**.
- Lab 7: um broker, **6** partições → no máximo 6 × 20 = **120/s**; uma 7ª thread fica ociosa.

<div class="ok">

O **consumidor** costuma ser o gargalo. Alternativas a mais partições: lotes, concorrência por chave.

</div>

---

## Onde uma mensagem se perde ou se duplica

<div class="flow">
<div class="box accent">order<small>produtor</small></div><div class="arrow">1 · envia →</div>
<div class="box orange">Kafka<small>2 · replica</small></div><div class="arrow">3 · entrega →</div>
<div class="box">notification<small>consumidor</small></div><div class="arrow">4 · e-mail →</div>
<div class="box">provedor</div><div class="arrow">5 · commit do offset ↩</div>
</div>

| Trecho | Falha | Efeito | Defesa |
|---|---|---|---|
| 1 | ack perdido, o produtor tenta de novo | duplicata no log | produtor idempotente |
| 1 | crash antes de enviar | **perda** (Bruno) | transactional outbox |
| 2 | a líder morre com `acks=1` | **perda** de registro confirmado | `acks=all`, min ISR 2 |
| 3–5 | crash entre o e-mail e o commit | duplicata (Ana, três vezes) | consumidor idempotente |

---

## Semântica de entrega

| Garantia | Consumidor Kafka | Um crash significa |
|---|---|---|
| At-most-once | commit **antes** de processar | ❌ mensagem **perdida** |
| At-least-once | commit **depois** de processar | ⚠️ mensagem **repetida** |
| Exactly-once | transações do Kafka — *só dentro do Kafka* | ✅ nenhum dos dois |

<div class="ok">

**Efetivamente uma vez = at-least-once + processamento idempotente.** O Kafka não desenvia um e-mail.

</div>

<p class="small">Simulador <code>delivery</code>: cobra → commit com um crash → 7 cobranças para 6 pedidos; commit → cobra → o pedido se perde; a chave de idempotência resolve a repetição, não a perda.</p>

<!--
Os três e-mails da Ana: crash entre o envio e o commit, duas vezes. O e-mail que faltou para o
Bruno: crash entre o commit no banco e a publicação (lado do produtor) — resolvido pelo outbox.
-->

---

## O consumidor idempotente

```java
@KafkaListener(topics = "order-events", groupId = "notification")
@Transactional
public void on(OrderConfirmed event) {
    int inserted = jdbc.update("""
        INSERT INTO processed_events (consumer, event_id)
        VALUES ('notification', ?) ON CONFLICT DO NOTHING
        """, event.eventId());
    if (inserted == 0) return;       // duplicate: already handled
    emails.schedule(event);          // same transaction
}
```

- Linha de deduplicação e mudança de negócio **em uma transação**; offset confirmado depois.
- Chamadas externas levam uma **chave de idempotência**; o id do evento é criado **uma vez**, pelo produtor.
- Lab 7: `processed_events (event_id)`, mas o e-mail é **enviado** dentro da transação — um crash depois do envio o repete.

---

## Ordenação, retries e dead letters

- A ordem quebra com: retries do produtor (resolvido pela idempotência), tópicos diferentes, pools de threads, tópicos de retry.
- Visões entre serviços: **versão por entidade**, aplique só as mais novas (`WHERE version < :v`).
- Erro **transitório** → retries **bloqueantes** no lugar (lab 7: 0,5 s, 1 s, 2 s — a partição espera, a ordem se mantém) ou **tópicos de retry** (1 s, 4 s, 16 s — a partição segue, eventos posteriores ultrapassam).
- **Mensagem venenosa** → a fila de mensagens mortas (DLQ, *dead letter queue*; no Kafka, um dead letter topic) depois de N tentativas — ou na hora, para erros de parsing — e um alerta.

<div class="warn">

Uma DLQ que ninguém lê é um jeito mais lento de perder mensagens. O redrive só é seguro porque os consumidores são idempotentes.

</div>

---

## O simulador: retry no lugar ou em tópicos de retry?

<div class="flow">
<div class="arrow" style="flex: .55; text-align: left">Bloqueante</div>
<div class="box red">o-1005 falha<small>nos primeiros 2 s</small></div><div class="arrow">→</div>
<div class="box orange">espera 0,5 s, 1 s, 2 s<small>no lugar</small></div><div class="arrow">→</div>
<div class="box green">enviado na tentativa 4<small>parada 3,5 s · atraso 8 · ordem mantida ✅</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .55; text-align: left">Tópicos de retry</div>
<div class="box red">o-1005 falha</div><div class="arrow">→</div>
<div class="box orange">retry-0 · 1 s<small>falha de novo</small></div><div class="arrow">→</div>
<div class="box orange">retry-1 · 4 s</div><div class="arrow">→</div>
<div class="box red">enviado<small>nunca parou · Cancelled 4,1 s antes ❌</small></div>
</div>

- **Venenosa** sem classificação: o bloqueante chega à DLQ depois de 3,5 s, os tópicos de retry depois de 21,2 s; **para sempre** nunca larga — 53 registros esperam depois de 30 s.
- Classifique os erros permanentes (lab 7: `IllegalArgumentException`): direto para a DLQ, sem espera.

<!--
O simulador está na página Semântica de entrega, em "Retries e dead letter queues" (retry-topics). Os mesmos números da dica dele.
-->

---

## Evolução de schema

| Compatibilidade | Mudanças seguras | Implante primeiro |
|---|---|---|
| Backward | remover campos; adicionar campos **com default** | consumidores |
| Forward | adicionar campos; remover campos com default | produtores |
| Full | adicionar/remover campos opcionais com default | qualquer ordem |

- Nunca: renomear, mudar tipo, mudar significado (reais → centavos).
- Avro/Protobuf + **schema registry**; envelope CloudEvents; mudança incompatível → `order-events.v2`.

---

## Escrita dupla → transactional outbox

<div class="flow" style="align-items: stretch">
<div class="box accent" style="align-self: center; flex: .8">order<small>POST /orders</small></div><div class="arrow" style="align-self: center">uma transação →</div>
<div class="group" style="flex: .9"><div class="caption">banco do order</div><div class="box">INSERT orders</div><div class="box">INSERT outbox</div></div>
<div class="arrow" style="align-self: center">relay faz polling →<br>SKIP LOCKED</div>
<div class="box orange" style="align-self: center">Kafka<small>chave = orderId, acks=all</small></div><div class="arrow" style="align-self: center">ack →</div>
<div class="box green" style="align-self: center">marca como publicado</div>
</div>

- **Escrita dupla**: `COMMIT`, crash, evento nunca publicado (Bruno); publicar antes, rollback, **evento fantasma**.
- Um crash depois do ack e antes da marcação **republica**: pelo menos uma vez, nunca perdido.
- Relay por polling (lab 7) ou por captura de mudanças (CDC, *change data capture*) com Debezium, que lê o write-ahead log. Lab 7 a 200 pedidos/s: p50 do `POST /orders` **2,7 s** (sync) → **1,8 ms** (outbox).

<p class="small">O CDC também mantém busca, cache e warehouse sincronizados a partir do banco do catalog — mas CDC bruto vaza o schema das suas tabelas; use eventos projetados para outros times.</p>

---

<!-- _class: tight -->

## A saga de compra

| Passo | Serviço | Transação local | Compensação |
|---|---|---|---|
| 1 | `order` | cria o pedido `PENDING` | cancela |
| 2 | `inventory` | reserva lugares (10 min) | libera |
| 3 | `payment` | cobra o cartão (chave = id do pedido) — **pivô** | estorna |
| 4 | `inventory` | marca lugares `SOLD` | — repetido |
| 5 | `order` | `CONFIRMED`, publica `OrderConfirmed` | — repetido |

<div class="warn">

Uma saga é atômica, consistente e durável, mas **não isolada**: mostre o estado intermediário ("lugares reservados — processando pagamento"). Num timeout do pagamento, **reconcilie** com o provedor antes de compensar.

</div>

---

## A saga como máquina de estados

<div class="flow">
<div class="box">PENDING</div><div class="arrow">SeatsHeld →</div>
<div class="box">SEATS_HELD</div><div class="arrow">PaymentCaptured →<br>(o pivô)</div>
<div class="box accent">PAID</div><div class="arrow">SeatsSold →<br>repetido até dar certo</div>
<div class="box green">CONFIRMED</div>
</div>
<div class="flow">
<div class="box muted">SEATS_HELD</div>
<div class="arrow">PaymentFailed / timeout →</div>
<div class="box orange">RELEASING</div><div class="arrow">SeatsReleased →</div>
<div class="box red">CANCELLED</div>
</div>

- Antes do pivô todo passo pode ser **compensado**; depois dele, os passos são **repetidos**, nunca desfeitos.
- O status do pedido *é* o estado da saga: mude-o com updates condicionais (`WHERE status = 'PENDING_PAYMENT'`).
- O fã recebe `202 Accepted` e "lugares reservados — processando pagamento" (um bloqueio semântico), não um spinner.

---

## Coreografia ou orquestração?

| | Coreografia | Orquestração |
|---|---|---|
| Coordenação | serviços reagem a eventos | orquestrador envia comandos |
| Visibilidade do fluxo | espalhada pelos serviços | uma máquina de estados |
| Risco | espaguete de eventos | um orquestrador "deus" |
| Bom para | 2–3 passos simples | 4+ passos, timers, ramificações |

<p class="small">Motores de execução durável — Temporal, AWS Step Functions, Azure Durable Functions, Camunda — persistem o estado da saga, timers e retries.</p>

---

## Segregação de comando e consulta (CQRS) e event sourcing

<div class="cols">
<div>

### CQRS

- Modelo de escrita para invariantes; **projeções** para leitura.
- "Meus ingressos" = uma tabela indexada alimentada por eventos.
- Custo: lag → tratar **read-your-writes** (devolver o estado novo ou um token de versão).

</div>
<div>

### Event sourcing

- Os **eventos** são a fonte da verdade; estado = replay.
- Auditoria, viagem no tempo, novos modelos de leitura a partir do histórico.
- Custo: eventos são um contrato **para sempre**.

</div>
</div>

<div class="ok">

Use quando os requisitos pedem (livro-razão de pagamentos, leituras muito diferentes) — não por padrão.

</div>

---

<!-- _class: tight -->

## O mapa de conceitos de mensageria

| Componente | Pergunta que responde | Conceitos-chave |
|---|---|---|
| `app` (produtor) | chamar e esperar, ou enviar? | síncrono vs assíncrono, consistência eventual |
| `queue` | quem faz este *trabalho*, em que taxa? | consumidores concorrentes, ack, backpressure, sala de espera |
| `pubsub` | como *cada* serviço recebe uma cópia? | assinaturas, push/pull, filtros |
| `stream` · `kafka` | quem precisa de histórico, replay, ordem por chave? | partições, chaves, grupos, lag, RF 3 |
| `worker` + consumidores | e se chegar duas vezes ou quebrar? | pelo menos uma vez, idempotência, DLQ, schemas |
| `sql` + `kafka` | alterar dados *e* publicar, entre serviços? | outbox, CDC, sagas, CQRS, event sourcing |

<p class="small">O produtor só conhece um tópico e um schema; cada consumidor paga por essa liberdade com <b>idempotência</b> e <b>monitoramento de lag</b>.</p>

---

## Conclusões

1. Chame quando precisa da resposta; **envie mensagem** quando o trabalho pode acontecer depois.
2. Uma fila transforma um pico em **backlog**: dimensione workers com a Lei de Little e um objetivo de atraso.
3. Toda fila precisa de **backpressure** e de um alerta sobre a **idade** da mensagem mais antiga.
4. Kafka: **chave** = ordem + balanceamento; **partições** = paralelismo máximo; RF 3, `acks=all`, min ISR 2.
5. A entrega é **at-least-once**: consumidores idempotentes, DLQ, schemas compatíveis.
6. **Outbox** para publicar, **sagas** com compensações entre serviços, CQRS/ES só quando necessário.
