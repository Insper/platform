---
marp: true
lang: pt-BR
title: Lab 2 — Meça primeiro
description: Arquitetura de Sistemas · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Arquitetura de Sistemas · Insper · Lab 2</div>

# Lab 2 — Meça primeiro

**Testes de carga, de estresse e de varredura com o k6: encontre o joelho, confira a Lei de Little, dê nome ao gargalo**

<!--
Roteiro: (1) por que medir antes de otimizar; (2) modelos fechado vs aberto; (3) os scripts; (4) medidores
de dentro; (5) a varredura e o joelho; (6) a Lei de Little e o pool; (7) mudar o gargalo de lugar; (8) estresse.
-->

---

## Meça antes de escalar

<div class="q">

O `catalog` fica lento sob carga. Cache? Réplica? Mais dez servidores? Qual — e como você sabe?

</div>

- Chutando, times constroem um cache para um serviço limitado por um pool de 10.
- Três perguntas: **quanta** carga, **onde** quebra, **por quê**.
- Ferramentas: um gerador de carga fora (k6), medidores dentro (Actuator), `docker stats`.

---

## Modelo fechado vs aberto

| | Fechado (`vus`) | Aberto (`*-arrival-rate`) |
|---|---|---|
| Você define | usuários simultâneos | requisições por segundo |
| O servidor fica lento | o k6 manda **menos** | o k6 mantém a taxa |
| Sobrecarga | escondida | latência + `dropped_iterations` |

<div class="warn">

**Coordinated omission**: um testador fechado pula justamente as requisições que mais sofreriam.

</div>

---

## A família de testes

| Teste | Pergunta |
|---|---|
| smoke | funciona, e quão rápido com 1 usuário? |
| carga | a X req/s, quais são p50/p95/p99? |
| varredura | onde está o joelho? |
| estresse | o que acontece depois dele — e ele se recupera? |

```bash
k6 run -e RATE=200 -e DURATION=1m load/load.js
```

---

## Medidores de dentro

| Métrica | Limite |
|---|---|
| `tomcat.threads.busy` | 200 threads |
| `hikaricp.connections.active` | pool = **10** |
| `hikaricp.connections.pending` | deveria ser 0 |

```bash
bash scripts/watch-metrics.sh http://localhost:8082
```

<p class="small">Três terminais em todo teste: k6, watch-metrics, docker stats.</p>

---

## A varredura

```bash
bash scripts/sweep.sh 50 100 200 300 400 500 600
uv run scripts/summarize.py results/lab2/rate-*.json
```

- Um minuto por taxa, **aquecimento antes**.
- Uma linha por taxa: throughput, p50, p95, p99, erros, descartadas.

---

## Um joelho de exemplo (1 CPU, pool de 10)

| Oferecido | Atendido | p50 | p99 |
|---|---|---|---|
| 200 | 200 | 0,5 ms | 34 ms |
| 300 | 300 | 0,6 ms | 39 ms |
| 400 | 400 | 1,5 ms | 224 ms |
| 500 | 490 | 15 ms | **2.056 ms** |

<p class="small">Um notebook, uma execução. Os seus números serão outros — o formato, não.</p>

---

## Por que a latência explode

<div class="cols">
<div>

- Espera ≈ `S / (1 − ρ)`.
- ρ = 50% → espera ≈ 1×S.
- ρ = 90% → ≈ 9×S.
- ρ = 99% → ≈ 99×S.

</div>
<div>

<div class="ok">

**Capacidade** = a maior taxa com o p99 dentro da meta — não o maior throughput já impresso.

</div>

</div>
</div>

---

## Lei de Little: L = λ × W

* 300 req/s × 20 ms = **6** requisições dentro → `tomcat.threads.busy` ≈ 6.
* O pool é um servidor com **10** vagas: satura quando λ × (tempo de banco por requisição) = 10.
* No joelho: `db_active = 10`, `db_pending` cresce → **o pool é o gargalo**.

<div class="q">

200 threads ocupadas, 10 conexões ativas, 190 pendentes. Mais threads no Tomcat iriam…?

</div>

---

## Mude o gargalo de lugar

```bash
DB_POOL_SIZE=30 docker compose up -d catalog
OUT=results/lab2-pool30 bash scripts/sweep.sh 50 100 200 300 400 500 600
```

- O joelho **sobe** — até o próximo recurso saturar (CPU, PostgreSQL).
- Pools maiores custam processos no banco: 3 serviços × 3 réplicas × 30 > `max_connections`.

---

## Estresse: além do joelho e de volta

```bash
K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=results/lab2-stress.html \
  k6 run -e PEAK=600 load/stress.js
```

- O joelho na subida; os VUs sobem no pico (Lei de Little do lado do cliente).
- **Recuperação** depois da queda: segundos? nunca?

---

## Entrega

- Duas varreduras (pool 10, pool 30), o joelho e a capacidade de cada uma.
- Tabela da Lei de Little vs os medidores.
- Relatório de estresse com joelho, pico e recuperação.
- Um parágrafo: **o gargalo do `catalog` e a evidência**.

---

## Pontos-chave

1. Use um modelo **aberto** para tráfego público; observe `dropped_iterations`.
2. O **joelho**: latência plana, depois explosão — a capacidade mora logo abaixo dele.
3. A **Lei de Little** liga throughput, latência e concorrência — confira com medidores reais.
4. O gargalo é o recurso cuja **fila cresce** (aqui: o pool do banco).
5. Resolver um gargalo o **muda de lugar**; meça de novo depois de cada mudança.
