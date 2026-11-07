---
marp: true
lang: pt-BR
title: Lab 6 — Dados em escala
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

<div class="kicker">Arquitetura de Sistemas · Insper · Lab 6</div>

# Lab 6 — Dados em escala

**Reservas de assento sem venda duplicada, uma réplica de leitura, PgBouncer, EXPLAIN — e um failover à mão**

<!--
Roteiro: (1) o invariante; (2) a corrida do lost update; (3) três estratégias; (4) o teste da venda
relâmpago e a auditoria; (5) réplica por streaming e roteamento; (6) read-your-writes; (7) PgBouncer;
(8) índices; (9) replicação síncrona, uma queda, failover, split brain, pg_rewind; (10) o simulador.
-->

---

## O único bug que não podemos entregar

<div class="q">

Dois fãs clicam nos mesmos dois assentos no mesmo milissegundo. Os dois recebem "201 Created". Quem vai ao show?

</div>

- Invariante: **um assento pertence a no máximo uma reserva viva**.
- O catálogo pode ficar segundos defasado; os assentos **nunca** podem estar errados.

---

## O que você vai construir

<div class="flow" style="align-items: stretch">
<div class="box muted" style="flex: .6; display: flex; flex-direction: column; justify-content: center">fãs do k6<small>edge → gateway</small></div>
<div class="arrow" style="align-self: center">→</div>
<div class="box accent" style="display: flex; flex-direction: column; justify-content: center">inventory :8083<small>assentos, reservas, 3 estratégias de lock</small></div>
<div class="group">
<div class="caption">escritas, reservas · transações read-write</div>
<div class="box orange">pgbouncer :6432<small>pooling por transação</small></div>
<div class="box green">db · primário</div>
</div>
<div class="arrow" style="align-self: center">log de escrita antecipada (WAL, <em>write-ahead log</em>) →</div>
<div class="group">
<div class="caption">mapas de assentos · transações readOnly</div>
<div class="box green">db-replica :5433<small>hot standby</small></div>
</div>
</div>

- Evento **1**: 60.000 assentos (30 setores × 40 fileiras × 50); uma reserva dura 10 minutos, no máximo 6 assentos.
- O catálogo ganha seus índices (`V3__index_events.sql`); o passo 4 derruba o `db` de propósito.

---

## A corrida (READ COMMITTED)

```text
A: SELECT status → AVAILABLE
B: SELECT status → AVAILABLE
A: UPDATE … hold_id = A        (locks the rows)
B: UPDATE … hold_id = B        (waits…)
A: COMMIT  →  B's UPDATE runs  →  overwrites A
```

- Check-then-act sem lock = **lost update**.
- Com `FOR UPDATE`, B espera já na **leitura**, depois relê `HELD` → `409`.

---

## Três estratégias

| Estratégia | Mecanismo | Em conflito |
|---|---|---|
| naive | lê, confere, atualiza | ❌ **venda duplicada** |
| pessimistic | `SELECT … ORDER BY id FOR UPDATE` | ✅ espera, depois 409 |
| optimistic | `UPDATE … WHERE version = :v` | ✅ 0 linhas → 409, rollback |

<p class="small">Variante: <code>UPDATE … WHERE status = 'AVAILABLE'</code> e conferir a contagem de linhas.</p>

---

## O teste da venda relâmpago

```bash
INVENTORY_LOCKING=naive docker compose up -d inventory
bash scripts/reset-inventory.sh && k6 run load/flash-sale.js
```

<div class="flow">
<div class="box red">naive<small>162 reservas · auditoria: 9 assentos vendidos em dobro</small></div>
<div class="box green">pessimistic<small>141 reservas · auditoria 0 · p99 1,77 s</small></div>
<div class="box green">optimistic<small>141 reservas · auditoria 0 · p99 1,03 s</small></div>
</div>

- 200 fãs, 100 assentos, 2 assentos por reserva, 70% liberam; teardown: `GET /inventory/audit/double-bookings`.
- Uma execução num laptop ocupado: as contagens variam, o **formato** não (a naive nunca dá 0 com confiança).

---

## Pessimista ou otimista?

<div class="cols">
<div>

**Pessimista**
- serializa as linhas disputadas
- espera → p99 maior
- trave em **ordem de id** (sem deadlocks)

</div>
<div>

**Otimista**
- sem espera
- conflitos → falha rápido
- ótimo com contenção **baixa**

</div>
</div>

<p class="small">De qualquer forma, proteja as linhas quentes <em>antes</em> do banco: uma sala de espera (lab 7).</p>

---

## Reservas expiram

```sql
WITH expired AS (
  UPDATE inventory.holds SET status = 'EXPIRED'
  WHERE id IN (SELECT id FROM inventory.holds
               WHERE status = 'ACTIVE' AND expires_at < now()
               LIMIT 500 FOR UPDATE SKIP LOCKED)
  RETURNING id)
UPDATE inventory.seats SET status = 'AVAILABLE', hold_id = NULL
WHERE hold_id IN (SELECT id FROM expired);
```

- `SKIP LOCKED`: várias réplicas dividem o job com segurança.

---

## Uma réplica por streaming

- `pg_basebackup -R`: clone + `standby.signal`.
- O WAL é enviado de forma assíncrona; a réplica é **somente leitura**.
- `@Transactional(readOnly = true)` → pool da réplica, via `LazyConnectionDataSourceProxy`.
- O `find` (a reserva do próprio fã) e a auditoria ficam no **primário**.

<div class="warn">

Uma réplica acrescenta **capacidade de leitura**. Ela não faz nada pelas escritas.

</div>

---

## Read-your-writes

```bash
REPLICA_DELAY=1s docker compose up -d db-replica
k6 run load/read-your-writes.js      # stale_reads ↑
```

- Sem atraso artificial: **~6%** de leituras defasadas — a próxima requisição também chega em milissegundos.
- `REPLICA_DELAY=1s`: **98%** — o fã reserva um assento… e o mapa de assentos diz AVAILABLE.
- Correção: as próprias escritas recentes pelo **primário**, leituras sticky, ou esperar o número de sequência do log (LSN, *log sequence number*).

---

## PgBouncer

<div class="flow" style="align-items: stretch">
<div class="group">
<div class="caption">clientes</div>
<div class="box">catalog ×3<small>3 × 10 conexões</small></div>
<div class="box">auth<small>10 conexões</small></div>
<div class="box">inventory<small>o pool inteiro</small></div>
</div>
<div class="arrow" style="align-self: center">inventory →</div>
<div class="box orange" style="display: flex; flex-direction: column; justify-content: center">pgbouncer<small>modo transaction · ≤ 20 conexões de servidor</small></div>
<div class="arrow" style="align-self: center">→</div>
<div class="box green" style="display: flex; flex-direction: column; justify-content: center">db<small>~60 conexões numa execução de teste</small></div>
</div>

- `max_connections=80`, pool do `inventory` de 40, direto → `FATAL: sorry, too many clients already`; pelo PgBouncer → **fila** (`cl_waiting`).
- O pooling por transação quebra o estado de sessão → **o Flyway conecta direto**.

---

<!-- _class: tight -->

## EXPLAIN antes do cache

<div class="flow">
<div class="arrow" style="flex: .45; text-align: left">antes</div>
<div class="box">Limit 20</div><div class="arrow">←</div>
<div class="box red">Sort<small>starts_at, id</small></div><div class="arrow">←</div>
<div class="box red">Seq Scan em events<small>200.000 linhas</small></div>
<div class="box muted">36,8 ms<small>+ 13,9 ms do count(*)</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .45; text-align: left">depois</div>
<div class="box">Limit 20</div><div class="arrow">←</div>
<div class="box">Nested Loop</div><div class="arrow">←</div>
<div class="box green">Index Scan events_starts_at_idx<small>189 entradas, em ordem de data</small></div>
<div class="box muted">0,62 ms<small>count(*): 4 ms, Index Only Scan</small></div>
</div>

```sql
CREATE INDEX events_starts_at_idx ON catalog.events (starts_at, id);
```

- Índices custam em toda escrita; indexe o que você **mediu**.

---

## Replicação síncrona: quanto custa

| `synchronous_commit` (réplica 1 s atrás) | leituras defasadas | por iteração |
|---|---:|---:|
| `on`: WAL no disco do standby | ⚠️ 93–100% | ~0,05–0,4 s |
| `remote_apply`: reaplicado no standby | ✅ **0%** | ⚠️ **2 s** |

- Réplica parada → a reserva recebe **504 depois de 5 s** e mesmo assim o assento 10 está `HELD`: "already committed locally".
- Um standby síncrono só = ponto único de falha para as escritas → `ANY 1` sobre dois.

---

<!-- _class: tight -->

## O primário morre com uma reserva no ar

<div class="flow">
<div class="box">réplica parada<small>reserva da Ana → 201</small></div><div class="arrow">→</div>
<div class="box red">kill db</div><div class="arrow">→</div>
<div class="box orange">sondas<small>mapa 200 · reserva, login, catálogo 504</small></div><div class="arrow">→</div>
<div class="box accent">pg_promote()<small>timeline 2</small></div><div class="arrow">→</div>
<div class="box accent">mover o nome db<small>um alias de rede do Docker</small></div><div class="arrow">→</div>
<div class="box red">reserva da Ana: 404</div>
</div>

- 15 s depois da troca todos os caminhos voltam a responder: os pools reconectam, nenhum arquivo mudou, nenhum serviço reiniciou.
- A reserva existia só no WAL do primário morto: o **objetivo de ponto de recuperação (RPO, *recovery point objective*)** da replicação assíncrona.
- Um banco gerenciado faz o mesmo com o seu endpoint (Amazon RDS: um nome no sistema de nomes de domínio, DNS, *Domain Name System*), um IP virtual ou um proxy.

---

## Split brain, e o caminho de volta

<div class="flow" style="align-items: stretch">
<div class="box" style="display: flex; flex-direction: column; justify-content: center">história comum<small>timeline 1</small></div>
<div class="arrow" style="align-self: center">→</div>
<div class="group">
<div class="caption">depois da bifurcação</div>
<div class="box red">db antigo, iniciado como estava<small>primário · assento 20 HELD (a reserva perdida da Ana)</small></div>
<div class="box green">db-replica<small>primário, timeline 2 · assento 20 AVAILABLE</small></div>
</div>
<div class="arrow" style="align-self: center">→</div>
<div class="box orange" style="display: flex; flex-direction: column; justify-content: center">isolar, depois pg_rewind<small>exige wal_log_hints; db segue a timeline 2</small></div>
</div>

- Dois primários atrás de **um nome**: cada conexão nova cai em qualquer um deles.
- Volta ao original: LSNs iguais, pare o `db-replica`, promova o `db` (timeline 3), clone uma réplica nova.

---

<!-- _class: tight -->

## O que você fez à mão

| Passo | Neste lab | Em produção |
|---|---|---|
| Detectar | você o matou | health checks com timeout |
| Escolher o novo primário | a única réplica | o standby mais atualizado, por consenso |
| Mover os clientes | um alias de rede do Docker | endpoint de DNS, IP virtual, proxy, strings multi-host |
| Isolar o antigo primário | `docker compose stop db` | expiração da chave de líder, STONITH ("shoot the other node in the head"), fencing tokens |
| Trazê-lo de volta | `pg_rewind` + `standby.signal` | o gerenciador de failover |
| Decidir o que pode se perder | assíncrono: a última reserva | `ANY 1 (…)` sobre dois standbys: RPO 0 |

<div class="warn">

Uma pessoa às 10:01 é lenta demais: Patroni + etcd decidem o líder por **consenso**.

</div>

---

## Sem Docker: o simulador

<div class="flow">
<div class="box accent">Réplica<small>REPLICA_DELAY 1 s: o assento 1 ainda AVAILABLE no mapa</small></div>
<div class="box orange">Síncrona<small>remote_apply: 1,03 s · standby fora: 504, assento 10 HELD</small></div>
<div class="box red">Queda<small>mapa 200, o resto 504 · reserva da Ana 404</small></div>
<div class="box green">Split brain<small>o pg_rewind descarta a reserva · timeline 3</small></div>
</div>

- As páginas de Réplica e de Failover trazem os dois bancos do lab: mesmos nomes, mesmos comandos, mesmas saídas.
- Modo **livre**: `start` em vez de `up --no-deps`, ou `pg_rewind` sem `wal_log_hints`.

<!--
O simulador fica depois do experimento read-your-writes, no topo de Failover (abrindo na queda) e no fim
da seção 5 (split brain, volta do primário, switchback).
-->

---

## Pontos-chave

1. Nomeie o **invariante**; garanta-o de forma atômica (locks, versões, updates condicionais).
2. **Audite** a corretude sob carga, não só a latência.
3. Réplicas escalam **leituras** que toleram **defasagem**; roteie o read-your-writes para o primário.
4. Faça pool de conexões (**PgBouncer**) antes que o autoescalonamento as multiplique.
5. **EXPLAIN** primeiro: um índice pode vencer um cache.
6. Saiba o que um **failover** perde (RPO) e quem decide o líder; isole o antigo primário.
