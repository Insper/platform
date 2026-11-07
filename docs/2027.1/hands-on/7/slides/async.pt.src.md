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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">Arquitetura de Sistemas · Insper</div>

# Hands-on 7 — Mensageria Assíncrona

**Outbox, Kafka, consumidores idempotentes, um tópico de mensagens mortas (DLT, *dead-letter topic*) e uma sala de espera para o BoxOffice**

<!--
Roteiro: (1) por que o e-mail precisa sair do caminho da requisição; (2) Kafka em modo KRaft; (3) o
problema da escrita dupla e o outbox; (4) consumidor idempotente, retentativas e DLT; (5) sala de
espera; (6) o que medimos e o simulador que repete o lab.
-->

---

## O fã deve esperar pelo e-mail?

<div class="q">

`order` chama `notification` por HTTP antes de responder. Um provedor de e-mail real leva de dezenas a
centenas de milissegundos e às vezes falha. Às 10:00 o show no estádio abre as vendas. O que pode dar errado?

</div>

- Todo pedido fica **tão lento quanto o provedor de e-mail**.
- Uma queda do e-mail vira uma **queda de pedidos**.
- 2 M de fãs atingem **todos os serviços de uma vez**, inclusive o mais lento.

---

## Arquitetura

<div class="flow">
<div class="arrow" style="flex: .5; text-align: left">Antes</div>
<div class="box">fã</div><div class="arrow">→</div>
<div class="box">gateway</div><div class="arrow">→</div>
<div class="box accent">order</div><div class="arrow">POST, espera →</div>
<div class="box red">notification<small>SMTP, depois 201</small></div><div class="arrow">→</div>
<div class="box">201 para o fã<small>depois do e-mail</small></div>
</div>

<div class="flow">
<div class="arrow" style="flex: .5; text-align: left">Depois</div>
<div class="box green">sala de espera</div><div class="arrow">→</div>
<div class="box accent">order<small>orders + outbox, 1 tx</small></div><div class="arrow">→</div>
<div class="box">201 para o fã<small>no commit</small></div>
</div>

<div class="flow">
<div class="arrow" style="flex: .5; text-align: left"></div>
<div class="box green">relay do outbox</div><div class="arrow">publica →</div>
<div class="box orange">order-events<small>Kafka, 6 partições</small></div><div class="arrow">grupo →</div>
<div class="box accent">notification<small>dedup, Mailpit</small></div><div class="arrow">falhas →</div>
<div class="box red">order-events-dlt</div>
</div>

<!--
A página desenha as duas arquiteturas como diagramas passo a passo (abas "Antes" e "Depois").
-->

---

## Passo 1 · Kafka no Compose (KRaft, *Kafka Raft*)

| Contêiner | Porta | Papel |
|---|---|---|
| `kafka` (`apache/kafka:4.3.1`) | 9094 (host) | broker + controlador, sem ZooKeeper |
| `kafka-init` | — | cria `order-events` e `order-events-dlt`, 6 partições cada |
| `kafka-ui` | 8089 | tópicos, mensagens, *headers*, *lag* |
| `mailpit` | 8025 / 1025 | provedor de e-mail falso com caixa de entrada |

- Dois *listeners*: contêineres usam `kafka:9092`, sua máquina `localhost:9094`.
- Criação automática **desligada**: o padrão de 1 partição limitaria os consumidores a 1.

---

## Dois listeners: vale o endereço anunciado

<div class="flow">
<div class="box accent">order (contêiner)</div><div class="arrow">bootstrap →</div>
<div class="box">kafka:9092<small>PLAINTEXT</small></div><div class="arrow">metadados →</div>
<div class="box green">líderes em kafka:9092<small>resolve na rede</small></div>
</div>
<div class="flow">
<div class="box accent">CLI no seu notebook</div><div class="arrow">bootstrap →</div>
<div class="box">localhost:9094<small>EXTERNAL</small></div><div class="arrow">metadados →</div>
<div class="box green">líderes em localhost:9094<small>resolve no notebook</small></div>
</div>
<div class="flow">
<div class="box muted">um listener para os dois</div><div class="arrow">→</div>
<div class="box red">o notebook recebe kafka:9092<small>conecta e depois dá timeout</small></div>
</div>

- O primeiro endereço só encontra o broker; o cliente se reconecta ao endereço **anunciado**.
- Por isso o Kafka é a exceção à regra "mesma porta dentro e fora".

---

## Um log, não uma fila

- Consumir **não** apaga: cada grupo guarda um **offset** por partição.
- ***Lag*** = offset do fim do log − offset confirmado → o sinal de saúde do consumidor.
- Mesma **chave** → mesma partição → **ordem por chave** (a única ordem que o Kafka promete).
- Partições = **teto do paralelismo de consumo** de um grupo: 8 instâncias em 6 partições → 2 ociosas.
- Grupos podem **voltar** (`--reset-offsets`) → reprocessamento → consumidores precisam tolerar duplicatas.

<!--
O passeio da página: order-1 cai duas vezes na partição 4, order-2 na partição 3. Guarde as três
mensagens do passeio: elas viram as mensagens envenenadas do passo 3.
-->

---

## Passo 2 · O problema da escrita dupla

<div class="flow">
<div class="box">banco, depois Kafka</div><div class="arrow">queda no meio →</div>
<div class="box red">pedido sem o seu evento<small>nunca sai e-mail</small></div>
</div>
<div class="flow">
<div class="box">Kafka, depois banco</div><div class="arrow">INSERT falha →</div>
<div class="box red">um pedido fantasma<small>e-mail de nada</small></div>
</div>
<div class="flow">
<div class="box accent">Outbox: pedido + linha do evento, 1 tx local</div><div class="arrow">queda em qualquer ponto →</div>
<div class="box green">as duas linhas ou nenhuma<small>um relay publica depois</small></div>
</div>

- O PostgreSQL não desfaz o Kafka; o Kafka não desfaz o PostgreSQL.
- O **relay** publica as linhas não publicadas e só as marca depois do `acks=all`.

---

## O relay

```sql
SELECT id, aggregate_id, event_type, payload::text AS payload
FROM outbox WHERE published_at IS NULL
ORDER BY created_at LIMIT 100
FOR UPDATE SKIP LOCKED
```

- A cada 200 ms: envia tudo, espera cada *ack* (10 s), depois `UPDATE ... published_at`.
- Kafka fora → cada execução falha depois de `max.block.ms` (5 s) e é desfeita → **nenhum evento perdido**.
- Queda depois do *ack* → lote republicado: ***at-least-once***.
- `SKIP LOCKED` → várias réplicas fazem relay de lotes disjuntos.

<p class="small">Alternativa: captura de mudanças (CDC, <em>change data capture</em>) — o Debezium lê o log de escrita antecipada (WAL, <em>write-ahead log</em>): menos atraso, mais infraestrutura.</p>

---

## API idempotente, também

```sql
INSERT INTO orders (...) VALUES (...)
ON CONFLICT (hold_id) DO NOTHING
```

- Uma reserva → no máximo um pedido: `hold_id` é `UNIQUE`.
- Um clique duplo ou uma retentativa do gateway recebe **o mesmo pedido** (`200`) e **nenhum segundo evento**.
- Kafka parado, pedido feito: `201` mesmo assim; numa execução de teste ele foi publicado **71 s depois**, quando o Kafka voltou.

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

<div class="flow">
<div class="box">registro</div><div class="arrow">→</div>
<div class="box green">e-mail enviado, ou duplicata<small>commit, próximo registro</small></div>
</div>
<div class="flow">
<div class="box">registro</div><div class="arrow">MailSendException →</div>
<div class="box orange">tenta de novo no lugar<small>0,5 s, 1 s, 2 s</small></div><div class="arrow">continua falhando →</div>
<div class="box red">order-events-dlt<small>mesma partição, exceção nos headers</small></div>
</div>
<div class="flow">
<div class="box">registro</div><div class="arrow">IllegalArgumentException, JacksonException →</div>
<div class="box red">order-events-dlt na hora<small>não retentável</small></div>
</div>

- Só a **partição** que falha espera, no máximo 0,5 + 1 + 2 = 3,5 s; as outras continuam andando.
- Alternativa não bloqueante: `@RetryableTopic` (tópicos de retentativa) — sem bloqueio, mas sem ordem.

---

## Passo 3 · Os experimentos

- **Mensagens do passeio**: o grupo novo começa no offset mais antigo → 3 × `IllegalArgumentException` → DLT, sem bloquear os eventos reais.
- **Reprocessamento** (`--reset-offsets --to-earliest`): `duplicate event … ignored`, o Mailpit continua com **2** e-mails.
- **`NOTIFY_IDEMPOTENT=false`**: cada reprocessamento envia todos os e-mails de novo.
- **Pedido envenenado** (`poison@example.com`): `201` para o fã, o registro em `order-events-dlt` e em `dead_letters`.

<div class="warn">

Uma DLT que ninguém lê é perda de dados silenciosa: alerte quando ela crescer, corrija a causa e reprocesse — seguro porque o consumidor é idempotente.

</div>

---

## Passo 4 · Sala de espera

<div class="q">

2 M de fãs apertam "Comprar" para 60 mil assentos; um inventário fortemente consistente não atende 2 M de requisições por segundo. Quem entra primeiro?

</div>

<div class="flow">
<div class="box">2 M de fãs</div><div class="arrow">entram →</div>
<div class="box orange">sorted set do Redis<small>score = sequência do INCR</small></div><div class="arrow">ZPOPMIN N, a cada 1 s →</div>
<div class="box green">ticket admitido<small>tempo de vida (TTL) 5 min</small></div><div class="arrow">X-Admission-Ticket →</div>
<div class="box accent">POST /orders<small>403 sem ele</small></div>
</div>

- Estimativa honesta de espera (ETA, *estimated time of arrival*) pela **Lei de Little**: `espera = posição / taxa` → 30 000 / 500 = 60 s.

---

## Armadilhas da sala de espera

- **Um admissor só**: 3 réplicas × N/s = 3N/s. *Worker* único, eleição de líder ou trava.
- **Proteja tudo o que é caro** (reservas e pedidos) — em produção, na borda/gateway.
- **A sala também precisa escalar**: 2 M de fãs consultando a cada segundo = 2 M req/s → consulte menos, página pela rede de distribuição de conteúdo (CDN, *content delivery network*).
- **Robôs** entram muitas vezes: limite as entradas, desafio antes de entrar (WAF, *web application firewall*).

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

## O que uma execução de teste deu (A e B)

| Carga | Modo | p50 | p99 | vazão |
|---|---|---|---|---|
| 50/s por 60 s | `sync` | 58 ms | 352 ms | 50/s |
| 50/s por 60 s | `outbox` | 3,3 ms | 1,7 s | 49/s |
| 200/s por 30 s | `sync` | 2,7 s | 9,3 s | ❌ 113/s |
| 200/s por 30 s | `outbox` | 1,8 ms | 95 ms | ✅ 200/s |

- `sync` segura uma das 10 conexões do pool por e-mail: no máximo 10 / 0,055 s ≈ 180 pedidos/s.
- B em `sync`: pelo menos um terço dos pedidos falha (54 % numa execução de teste); em `outbox`, nenhum.

---

## Preveja antes de rodar

<div class="q">

Concorrência 1, 50 ms por e-mail, 100 pedidos/s por 60 s. *Lag* no fim? Tempo para drenar?

</div>

* Capacidade: 1 / 50 ms = **20/s** por thread.
* O *backlog* cresce a 100 − 20 = 80/s → **≈ 4 800** mensagens.
* Drena a 20/s → **≈ 240 s**. Com 6 threads (120/s) → *lag* ≈ 0. Uma 7ª thread: ociosa (6 partições).
* Uma execução de teste: cerca de 4 900 e 320 s — cada e-mail custa um pouco mais que 50 ms.

---

## Sem Docker: o gêmeo do lab

<div class="flow">
<div class="box accent">2 · Outbox<small>200 na repetição · Kafka fora: a linha espera · queda do relay: 1 evento duas vezes</small></div>
<div class="box orange">3 · Consumidor<small>passeio → DLT · reprocessamento: 2 e-mails seguem 2 · dedup desligado: 4</small></div>
<div class="box red">5 · Medir (B, C)<small>sync: 1.000 de 3.000 falham · 1 thread: lag 4.800, 240 s · 6 threads: ≤ 17</small></div>
</div>

- Os passos 2, 3 e 5 o embutem: mesmo tópico, partições, threads, backoff e latência de e-mail do lab.
- Play roda uma página; os botões (`POST`, parar o Kafka, parar o Mailpit, *reset* de offsets) funcionam a qualquer momento.
- No 5, mude `NOTIFY_CONCURRENCY`: 4 ou 5 threads drenam tão devagar quanto 3 — a thread 1 continua lendo duas partições.

---

## Experimente no playground

- `event-fanout`: um produtor, vários serviços consumidores, cada um com sua cópia; aumente as requisições por segundo até um consumidor atrasar.
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
