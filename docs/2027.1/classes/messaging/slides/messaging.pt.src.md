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

## A vida de uma mensagem na fila

1. **Receber** — o broker esconde a mensagem (visibility timeout / sem ack).
2. **Processar** — gerar o PDF, fazer upload de `tickets/o-7731.pdf`.
3. **Ack** — só agora ela é apagada.
4. Sem ack a tempo → visível de novo → **outro worker** a recebe.

<div class="warn">

At-least-once: um crash depois do upload faz o job rodar duas vezes → consumidor **idempotente**. Um visibility timeout **menor que o job** faz todo job lento rodar duas vezes.

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

---

<!-- _class: tight -->

## Backpressure: o que acontece quando a fila enche?

| Estratégia | Exemplo no BoxOffice | Custo |
|---|---|---|
| Buffer (limitado) | a fila de PDF absorve a abertura | o atraso cresce |
| Escalar consumidores | KEDA pelo tamanho da fila | a carga vai para frente |
| Rejeitar na borda | `429` / `503` + `Retry-After` | erro rápido e honesto |
| Desacelerar o produtor | o producer do Kafka bloqueia (`max.block.ms`) | a latência vai para trás |
| Descartar / expirar | "lugares restantes" velhos, TTL no push | perda de dados por projeto |
| Descartar por prioridade | confirmações antes de marketing | filas separadas |

<div class="ok">

Alerte sobre a **idade da mensagem mais antiga**, não só sobre a profundidade.

</div>

---

## A sala de espera da flash sale

1. Os fãs recebem uma **posição** (sorted set do Redis: `ZADD`, `ZRANK`).
2. Um job de admissão libera **N fãs/s** — capacidade medida do `inventory` × fator de segurança.
3. Fãs admitidos recebem um **token assinado** de vida curta; o gateway o exige.
4. Inventário zerado → "**esgotou**" pela borda, sem tocar no banco.

- Justiça: posição aleatória para quem chegou cedo, FIFO depois.
- Bots: desafio e limites por conta na sala de espera.

<p class="small">Playground: <code>flash-sale</code> — remova a fila e veja o SQL saturar.</p>

---

## Publish/subscribe

- O produtor publica em um **tópico**; cada **assinatura** recebe a própria cópia.
- Dentro de uma assinatura os consumidores competem; entre assinaturas todos veem tudo.
- Adicionar um consumidor de pontos de fidelidade = **uma assinatura nova**, `order` intacto.

| Pull | Push |
|---|---|
| consumidores pedem; controle de fluxo natural | o broker chama um endpoint HTTPS |
| workers, alto throughput | serverless, webhooks |

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

## Consumer groups e lag

- Cada partição → **exatamente um** consumidor por grupo; grupos diferentes = fan-out.
- Paralelismo máximo de um grupo = **número de partições** (12 consumidores, 8 partições → 4 ociosos).
- Rebalance quando membros entram/saem ou param de fazer poll (`max.poll.interval.ms`).
- **Consumer lag** = offset do fim do log − offset confirmado: *a* métrica de saúde do consumidor.

<p class="small">Lag concentrado em uma partição = chave quente, consumidor travado ou mensagem venenosa — não falta de capacidade. Playground: <code>event-fanout</code>.</p>

---

## Replicação e durabilidade

| `acks` | Confirmado quando… | Uma falha de broker pode… |
|---|---|---|
| `0` | enviado | perder registros em silêncio |
| `1` | a líder gravou | perder registros confirmados |
| `all` | toda réplica sincronizada tem | não perdê-los, com min ISR ≥ 2 |

- **RF 3 entre AZs + `min.insync.replicas=2` + `acks=all`**: um broker fora, as escritas continuam; nada confirmado vive em uma só máquina.
- Metadados com controllers **KRaft** (Raft); ZooKeeper removido no Kafka 4.0.

---

## Dimensionando partições

> N ≥ max(T / p, T / c), e depois adicione folga

- Pico: 30.000 pedidos × 10 eventos / 180 s ≈ **1.700 eventos/s** — trivial para os produtores.
- `notification`: 50 ms por e-mail → `c = 20/s` por partição.
- `OrderConfirmed` ≈ 167/s → `N ≥ 167 / 20 ≈ 9` → crie **24**.

<div class="ok">

O **consumidor** costuma ser o gargalo. Alternativas a mais partições: lotes, concorrência por chave.

</div>

---

## Semântica de entrega

| Garantia | Consumidor Kafka | Um crash significa |
|---|---|---|
| At-most-once | commit **antes** de processar | mensagem **perdida** |
| At-least-once | commit **depois** de processar | mensagem **repetida** |
| Exactly-once | transações do Kafka — *só dentro do Kafka* | nenhum dos dois |

<div class="ok">

**Efetivamente uma vez = at-least-once + processamento idempotente.** O Kafka não desenvia um e-mail.

</div>

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

---

## Ordenação, retries e dead letters

- A ordem quebra com: retries do produtor (resolvido pela idempotência), tópicos diferentes, pools de threads, tópicos de retry.
- Visões entre serviços: **versão por entidade**, aplique só as mais novas (`WHERE version < :v`).
- Erro **transitório** → retry com backoff (1 s, 4 s, 16 s).
- **Mensagem venenosa** → depois de N tentativas, o **dead letter topic** — e um alerta.

<div class="warn">

Uma DLQ que ninguém lê é um jeito mais lento de perder mensagens. O redrive só é seguro porque os consumidores são idempotentes.

</div>

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

<div class="cols">
<div>

### Escrita dupla

`COMMIT` do pedido → crash → evento **nunca publicado** (Bruno).
Publicar antes → rollback → **evento fantasma**.

</div>
<div>

### Outbox

`INSERT` do evento em `outbox` **na mesma transação**.
Um relay (polling com `SKIP LOCKED`, ou **CDC com Debezium**) o publica pelo menos uma vez.

</div>
</div>

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

Uma saga é **ACD sem o I**: mostre o estado intermediário ("lugares reservados — processando pagamento"). Num timeout do pagamento, **reconcilie** com o provedor antes de compensar.

</div>

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

## CQRS e event sourcing

<div class="cols">
<div>

### CQRS

- Modelo de escrita para invariantes; **projeções** para leitura.
- "Meus ingressos" = uma tabela indexada alimentada por eventos.
- Custo: lag → tratar **read-your-writes**.

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
