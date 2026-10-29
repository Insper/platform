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

<div class="kicker">Arquitetura de Sistemas · Insper · Lab 6</div>

# Lab 6 — Dados em escala

**Reservas de assentos sem venda duplicada, uma réplica de leitura, PgBouncer e EXPLAIN**

<!--
Roteiro: (1) o invariante; (2) a corrida do lost update; (3) três estratégias; (4) o teste da venda
relâmpago e a auditoria; (5) réplica por streaming e roteamento; (6) read-your-writes; (7) PgBouncer;
(8) índices.
-->

---

## O único bug que não podemos entregar

<div class="q">

Dois fãs clicam nos mesmos dois assentos no mesmo milissegundo. Os dois recebem "201 Created". Quem vai ao show?

</div>

- Invariante: **um assento pertence a no máximo uma reserva viva**.
- O catálogo pode ficar segundos defasado; os assentos **nunca** podem estar errados.

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

---

## Três estratégias

| Estratégia | Mecanismo | Em conflito |
|---|---|---|
| naive | lê, confere, atualiza | **venda duplicada** |
| pessimistic | `SELECT … ORDER BY id FOR UPDATE` | espera, depois 409 |
| optimistic | `UPDATE … WHERE version = :v` | 0 linhas → 409, rollback |

<p class="small">Variante: <code>UPDATE … WHERE status = 'AVAILABLE'</code> e conferir a contagem de linhas.</p>

---

## O teste da venda relâmpago

```bash
INVENTORY_LOCKING=naive docker compose up -d inventory
bash scripts/reset-inventory.sh && k6 run load/flash-sale.js
```

- 200 fãs, 100 assentos, 2 assentos por reserva, 70% liberam.
- Teardown: `GET /inventory/audit/double-bookings`.

<div class="ok">

Pessimistic e optimistic: **0**. Naive: diferente de 0.

</div>

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
- WAL enviado de forma assíncrona; a réplica é **somente leitura**.
- `@Transactional(readOnly = true)` → pool da réplica, via `LazyConnectionDataSourceProxy`.

<div class="warn">

Uma réplica acrescenta **capacidade de leitura**. Ela não faz nada pelas escritas.

</div>

---

## Read-your-writes

```bash
REPLICA_DELAY=1s docker compose up -d db-replica
k6 run load/read-your-writes.js      # stale_reads ↑
```

- O fã reserva um assento… e o mapa de assentos diz AVAILABLE.
- Correção: as próprias escritas recentes pelo **primário**, leituras sticky, ou esperar o LSN.

---

## PgBouncer

| | Conexões de cliente | Conexões de servidor |
|---|---|---|
| sem pooler | 200 | 200 processos |
| PgBouncer (modo transação) | 200 | ≤ `default_pool_size` |

- Quebra o estado de sessão → **o Flyway conecta direto**.
- Acima do limite: os clientes fazem **fila** em vez de "too many clients".

---

## EXPLAIN antes do cache

```text
Limit → Sort → Hash Join → Seq Scan on events (200,000 rows)   ≈ 40 ms
```

```sql
CREATE INDEX events_starts_at_idx ON catalog.events (starts_at, id);
```

- O índice entrega a ordem → para depois de 20 linhas → **< 1 ms**.
- Índices custam em toda escrita; indexe o que você **mediu**.

---

## Pontos-chave

1. Nomeie o **invariante**; garanta-o de forma atômica (locks, versões, updates condicionais).
2. **Audite** a corretude sob carga, não só a latência.
3. Réplicas escalam **leituras** que toleram **defasagem**; roteie o read-your-writes para o primário.
4. Faça pool de conexões (**PgBouncer**) antes que o autoescalonamento as multiplique.
5. **EXPLAIN** primeiro: um índice pode vencer um cache.
