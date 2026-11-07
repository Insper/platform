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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

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

## Antes de medir: uma hipótese

<div class="flow">
<div class="box muted">playground <code>monolith</code><small>perfil breakpoint: qual caixa fica vermelha primeiro?</small></div><div class="arrow">→</div>
<div class="box accent">cenário <code>boxoffice-pool</code><small>catalog + pool de 10 sob uma rampa</small></div><div class="arrow">→</div>
<div class="box orange">a sua previsão<small>"quebra em ___ req/s porque ___ satura"</small></div><div class="arrow">→</div>
<div class="box green">o lab<small>varredura, medidores, docker stats</small></div>
</div>

- O playground modela a CPU do catalog (800 req/s) e o pool como os únicos limites: prevê que **30 conexões** levam o joelho para além de 600 req/s.
- Anote. O passo 6 testa a previsão no serviço real.

<!--
Um modelo é uma hipótese. A entrega tem uma linha de "conferência da hipótese": certa ou errada e por quê.
-->

---

## Modelo fechado vs aberto

| | Fechado (`vus`: usuários virtuais, VUs, *virtual users*) | Aberto (`*-arrival-rate`) |
|---|---|---|
| Você define | usuários simultâneos | requisições por segundo |
| O servidor fica lento | o k6 manda **menos** | o k6 mantém a taxa e inicia mais VUs |
| Sobrecarga | ⚠️ escondida | ✅ latência + `dropped_iterations` |

<div class="warn">

**Coordinated omission**: um testador fechado pula justamente as requisições que mais sofreriam.

</div>

---

## A família de testes

| Teste | Pergunta |
|---|---|
| smoke | funciona e quão rápido com 1 usuário? |
| carga | a X req/s, quais são os percentis p50, p95, p99 (mediana, 95º, 99º)? |
| varredura | onde está o joelho? |
| estresse | o que acontece depois dele — e ele se recupera? |

```bash
k6 run -e RATE=200 -e DURATION=1m load/load.js
```

---

## Medidores de dentro

<div class="flow">
<div class="box muted">k6<small>modelo aberto, RATE req/s</small></div><div class="arrow">→</div>
<div class="box accent">threads do Tomcat<small><code>tomcat.threads.busy</code> · máx. 200</small></div><div class="arrow">espera →</div>
<div class="box orange">pool Hikari<small><code>connections.pending</code> esperando · <code>active</code> ≤ <b>10</b></small></div><div class="arrow">→</div>
<div class="box green">PostgreSQL<small>a CPU dele no <code>docker stats</code></small></div>
</div>

- Uma thread segura uma conexão só durante a sua transação: busy ≥ active + pending.
- `pending` > 0 quer dizer threads esperando conexão, não falta de trabalho.

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

- Um minuto por taxa, **aquecimento antes** (uma máquina virtual Java, JVM, *Java virtual machine*, fria estraga o primeiro ponto), 10 s de pausa entre os passos.
- Uma linha por taxa: throughput, p50, p95, p99, erros, descartadas.

---

## Um joelho de exemplo (1 unidade central de processamento, CPU, *central processing unit*; pool de 10)

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

- Resposta ≈ `S / (1 − ρ)`, então a espera ≈ `ρ / (1 − ρ) × S`.
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

* 300 req/s × 10 ms = **3** requisições dentro → `tomcat.threads.busy` ≈ 3.
* O pool é um servidor com **10** vagas: satura quando λ × (tempo de banco por requisição) = 10.
* ~8 ms por requisição sem carga → 1.250 req/s. O joelho fica bem abaixo: sob carga cada consulta fica mais lenta e segura a conexão por mais tempo.
* No joelho: `db_active = 10`, `db_pending` cresce → **a fila está no pool**.

<div class="q">

200 threads ocupadas, 10 conexões ativas, 190 pendentes. Mais threads no Tomcat iriam…?

</div>

---

## Mude o gargalo de lugar

```bash
DB_POOL_SIZE=30 docker compose up -d catalog
OUT=results/lab2-pool30 bash scripts/sweep.sh 50 100 200 300 400 500 600
```

<div class="cols">
<div class="box green">o joelho <b>sobe</b><small>o pool era o cano mais estreito — até o próximo recurso saturar: a CPU do catalog ou o PostgreSQL</small></div>
<div class="box red">o joelho <b>quase não se move</b><small><code>db</code> no limite de CPU no <code>docker stats</code>: o pool era só onde a fila aparecia</small></div>
</div>

- Os dois resultados respondem à pergunta: a evidência é **qual recurso está cheio**. Compare com a sua previsão do playground.
- Pools maiores custam processos no banco: 3 serviços × 3 réplicas × 30 > `max_connections`.

---

## Estresse: além do joelho e de volta

```bash
K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=results/lab2-stress.html \
  k6 run -e PEAK=600 load/stress.js
```

<div class="flow">
<div class="box accent">1 · o joelho<small>na subida, o p95 sai do chão</small></div><div class="arrow">→</div>
<div class="box red">2 · o pico (600 req/s)<small>os VUs sobem em direção a <code>maxVUs</code>: Lei de Little do lado do cliente</small></div><div class="arrow">→</div>
<div class="box green">3 · a recuperação<small>depois da queda para 25%: segundos? nunca?</small></div>
</div>

<p class="small">Um serviço que se recupera sozinho é <b>estável</b>; um que continua lento precisa de load shedding (labs 3 e 9).</p>

---

## Sem Docker: o gêmeo

Um modelo da pilha do lab (200 threads, o pool, 1 CPU, PostgreSQL com 7 núcleos) repete os passos 1, 4, 6 e 7 com os comandos k6 da página.

| Passo | O que o gêmeo mostra |
|---|---|
| 4 · varredura | p99 plano até 300 req/s, 159 ms em 400, um muro em 500: 463 req/s, 1.688 descartadas |
| 6 · pool de 30 | o joelho não se move; detalhes mais rápidos, listagens mais lentas; `db` a 700% |
| 1 · fechado × aberto | 50 VUs: p99 de 266 ms, "tudo bem"; aberto a 500 req/s: 1.336 ms |
| 7 · estresse | de volta abaixo de 300 ms 8 s depois da queda |

<p class="small">Tempos de serviço escolhidos para reproduzir a forma da execução da página — não medidos. O seu notebook decide qual caso do passo 6 você encontra.</p>

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
4. A fila mostra **onde** as requisições esperam (aqui: o pool); o `docker stats` mostra **qual recurso está cheio**.
5. Resolver um gargalo o **muda de lugar**; meça de novo depois de cada mudança.
