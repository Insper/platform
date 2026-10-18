---
marp: true
lang: pt-BR
title: Hands-on 7 — Mensageria Assíncrona
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

# Hands-on 7 — Mensageria Assíncrona

**Outbox, Kafka, consumidores idempotentes, uma DLT e uma sala de espera para o BoxOffice**

<!--
Roteiro: (1) por que o e-mail precisa sair do caminho da requisição; (2) Kafka em modo KRaft; (3) o
problema da escrita dupla e o outbox; (4) consumidor idempotente; (5) retentativas e DLT; (6) sala de
espera; (7) o que medimos.
-->

---

## O fã deve esperar pelo e-mail?

<div class="q">

`order` chama `notification` por HTTP antes de responder. O provedor de e-mail leva 50–500 ms e às
vezes falha. Às 10:00 o show no estádio abre as vendas. O que pode dar errado?

</div>

- Todo pedido fica **tão lento quanto o provedor de e-mail**.
- Uma queda do e-mail vira uma **queda de pedidos**.
- 2 M de fãs atingem **todos os serviços de uma vez**, inclusive o mais lento.

---

## Arquitetura

<div class="cols">
<div>

### Antes

fã → gateway → **order** → `POST /notifications` → SMTP → … → `201`

*A requisição termina depois do e-mail.*

</div>
<div>

### Depois

fã → **sala de espera** → **order** → `orders` + `outbox` (1 tx) → `201`

relay → Kafka `order-events` → **notification** → Mailpit

falhas → `order-events-dlt`

</div>
</div>

---

## Passo 1 · Kafka no Compose (KRaft)

| Contêiner | Porta | Papel |
|---|---|---|
| `kafka` (`apache/kafka:4.3.1`) | 9094 (host) | broker + controlador, sem ZooKeeper |
| `kafka-init` | — | cria `order-events` e `order-events-dlt`, 6 partições cada |
| `kafka-ui` | 8089 | tópicos, mensagens, *headers*, *lag* |
| `mailpit` | 8025 / 1025 | provedor de e-mail falso com caixa de entrada |

- Dois *listeners*: contêineres usam `kafka:9092`, sua máquina `localhost:9094`.
- Criação automática **desligada**: o padrão de 1 partição limitaria os consumidores a 1.

---

## Um log, não uma fila

- Consumir **não** apaga: cada grupo guarda um **offset** por partição.
- ***Lag*** = offset do fim do log − offset confirmado → o sinal de saúde do consumidor.
- Mesma **chave** → mesma partição → **ordem por chave** (a única ordem que o Kafka promete).
- Partições = **teto do paralelismo de consumo** de um grupo.
- Grupos podem **voltar** (`--reset-offsets`) → reprocessamento → consumidores precisam tolerar duplicatas.

---

## Passo 2 · O problema da escrita dupla

<div class="warn">

`INSERT order; COMMIT;` e depois `kafka.send(...)` — uma queda no meio guarda um pedido **sem o seu
evento**. Ao contrário, você anuncia um pedido que **não existe**.

</div>

- O PostgreSQL não desfaz o Kafka; o Kafka não desfaz o PostgreSQL.
- Correção: gravar o evento como uma linha do `outbox` **na mesma transação** do pedido.
- Um **relay** publica as linhas não publicadas e só as marca depois do `acks=all`.

---

## O relay

```sql
SELECT id, aggregate_id, event_type, payload::text AS payload
FROM outbox WHERE published_at IS NULL
ORDER BY created_at LIMIT 100
FOR UPDATE SKIP LOCKED
```

- Envia tudo, espera cada *ack* (10 s), depois `UPDATE ... published_at`.
- Kafka fora → *rollback* → linhas tentadas de novo: **nenhum evento perdido**.
- Queda depois do *ack* → lote republicado: ***at-least-once***.
- `SKIP LOCKED` → várias réplicas fazem relay de lotes disjuntos.

<p class="small">Alternativa: CDC (o Debezium lê o WAL) — menos atraso, mais infraestrutura.</p>

---

## API idempotente, também

```sql
INSERT INTO orders (...) VALUES (...)
ON CONFLICT (hold_id) DO NOTHING
```

- Uma reserva → no máximo um pedido: `hold_id` é `UNIQUE`.
- Um clique duplo ou uma retentativa do gateway recebe **o mesmo pedido** (`200`), e **nenhum segundo evento**.

<div class="ok">

Idempotência é uma decisão de projeto em **cada** salto: API, relay, consumidor.

</div>

---

## Passo 3 · Consumidor idempotente

1. **Reivindicar**: `INSERT INTO processed_events (event_id) ... ON CONFLICT DO NOTHING`
2. 0 linhas → duplicata → **pular**.
3. **Efeito**: enviar o e-mail.
4. **Commit** — se o e-mail lançar exceção, a reivindicação é desfeita e a retentativa pode tentar de novo.

<div class="warn">

E-mail enviado, commit falha → um segundo e-mail na reentrega. Efeitos externos precisam da **chave
de idempotência** do provedor (`eventId`).

</div>

---

## Retentativas e o tópico de mensagens mortas

- `DefaultErrorHandler` + `ExponentialBackOffWithMaxRetries(3)`: 0,5 s, 1 s, 2 s **no lugar**.
- Depois `DeadLetterPublishingRecoverer` → `order-events-dlt`, **mesma partição**, exceção nos *headers*.
- **Não retentáveis**: `JacksonException`, `IllegalArgumentException` → DLT imediatamente.
- Só a **partição** que falha espera; as outras continuam andando.

<p class="small">Alternativa não bloqueante: <code>@RetryableTopic</code> (tópicos de retentativa) — sem bloqueio, mas sem ordem.</p>

---

## Passo 4 · Sala de espera

<div class="q">

2 M de fãs, 60 mil assentos, um inventário que atende algumas centenas de reservas por segundo. Quem
entra primeiro?

</div>

- **Sorted set** do Redis por show, score = sequência do `INCR` → FIFO justa.
- A cada segundo o admissor retira **N** fãs (`ZPOPMIN`) e os marca como admitidos (TTL 5 min).
- `POST /orders` exige um `X-Admission-Ticket` admitido enquanto a venda está aberta.
- ETA honesto pela **Lei de Little**: `espera = posição / taxa` → 45 000 / 500 = 90 s.

---

## Armadilhas da sala de espera

- **Um admissor só**: 3 réplicas × N/s = 3N/s. *Worker* único, eleição de líder ou trava.
- **Proteja tudo o que é caro** (reservas e pedidos) — em produção, na borda/gateway.
- **A sala também precisa escalar**: 2 M de fãs consultando a cada segundo = 2 M req/s → consulte menos, página pela CDN.
- **Robôs** entram muitas vezes: limite as entradas, desafio antes de entrar (WAF).

---

<!-- _class: tight -->

## Passo 5 · Meça

| # | Experimento | O que registrar |
|---|---|---|
| A | `NOTIFY_MODE` sync vs outbox | p50 / p95 / p99 do `POST /orders` |
| B | parar `notification` por 20 s | taxa de erro, pico de *lag*, tempo de drenagem |
| C | 100 pedidos/s, concorrência 1 vs 6 | *lag*, drenagem, atraso p95 do e-mail |
| D | *reset* de offsets, idempotência desligada vs ligada | e-mails por pedido |
| E | sala de espera, 20 fãs/s, admite 10/s | admitidos/s, espera p95, erro do ETA, robôs recusados |

<p class="small">k6 em modelo aberto (<code>constant-arrival-rate</code>); <em>lag</em> pelo <code>kafka-consumer-groups.sh</code>; atrasos por SQL.</p>

---

## Preveja antes de rodar

<div class="q">

Concorrência 1, 50 ms por e-mail, 100 pedidos/s por 60 s. *Lag* no fim? Tempo para drenar?

</div>

* Capacidade: 1 / 50 ms = **20/s** por thread.
* O *backlog* cresce a 100 − 20 = 80/s → **≈ 4 800** mensagens.
* Drena a 20/s → **≈ 240 s**. Com 6 threads (120/s) → *lag* ≈ 0. Uma 7ª thread: ociosa (6 partições).

---

## Experimente no playground

- `event-fanout`: um produtor, vários serviços consumidores, cada um com sua cópia; aumente o RPS até um consumidor atrasar.
- `async-queue` com o perfil `spike`: o *backlog* absorve o pico enquanto os *workers* seguem em ritmo constante.

<div class="ok">

Forme uma hipótese no simulador e depois confira com o k6 nos seus próprios serviços.

</div>

---

## Pontos-chave

1. Tire o trabalho lento e falível **do caminho da requisição**: a requisição do fã termina no commit.
2. **Outbox**: pedido + evento em uma transação local; um relay publica *at-least-once*.
3. O Kafka ordena **por partição**; use o id do agregado como chave; partições limitam o paralelismo.
4. **Consumidores idempotentes**: reivindique o `eventId` na mesma transação do efeito.
5. Classifique os erros: transitório → **retentativa com backoff**; permanente → **DLT**, depois corrija e reprocesse.
6. Uma **sala de espera** transforma um pico em taxa constante com um ETA honesto (Lei de Little).
