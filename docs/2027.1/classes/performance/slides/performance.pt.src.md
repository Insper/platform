---
marp: true
lang: pt-BR
title: Engenharia de desempenho e testes de carga
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

# Engenharia de desempenho e testes de carga

**Estratégias para testar sistemas de alto desempenho — e acreditar nos resultados**

<!--
Roteiro: (1) vocabulário, a curva e o joelho; (2) metodologia: modelo de carga, USE/RED,
ambientes e dados; (3) testes de carga: seis tipos, aberto vs fechado, thresholds,
omissão coordenada, caos sob carga; (4) gargalos: profiling e o banco de dados;
(5) planejamento de capacidade e orçamentos de desempenho na CI.
-->

---

## O teste que disse "tudo verde"

<div class="q">

200 usuários virtuais, p95 = 180 ms no staging. No dia, a venda caiu às 10:02. O que deu errado?

</div>

* O staging tinha **um décimo dos dados** — toda consulta acertava um cache quente.
* Os VUs **esperavam cada resposta**: quando o sistema ficou lento, o teste ficou lento junto.
* Dez minutos nunca chegaram ao ponto em que o **pool de conexões** se esgotava.
* Ninguém tinha escrito o que significava **"bom o suficiente"**.
* O relatório mostrava **médias**.

<!--
Colete palpites primeiro. Cada item corresponde a uma parte da aula: ambiente e dados,
modelo aberto vs fechado, tipos de teste, thresholds como SLOs, percentis.
-->

---

## O vocabulário

| Termo | Significado |
|---|---|
| **Tempo de serviço** S | tempo em que um recurso de fato trabalha em uma requisição |
| **Tempo de espera** | tempo na fila por um recurso ocupado |
| **Tempo de resposta** R | espera + serviço (+ rede) — o que o usuário sente |
| **Vazão** X | requisições concluídas por segundo |
| **Concorrência** N | requisições no sistema ao mesmo tempo |
| **Utilização** U / **Saturação** | fração ocupada / trabalho na fila |

- **Lei de Little** `N = X × R` — 1 800 reservas/s × 0,12 s = **216 em andamento**.
- **Lei da utilização** `U = X × S`. Reporte **percentis de histogramas**, nunca médias de percentis.

---

## Todo sistema tem um joelho

- **Região plana**: latência ≈ tempo de serviço.
- **Joelho** (~70–80 % ocupado): filas se formam, **o p99 se curva primeiro**.
- **Saturação**: a vazão para de crescer; timeouts viram erros.
- **Retrógrado** (USL): depois do pico, *mais* concorrência → *menos* vazão (locks, retries).

<div class="ok">

Planeje com o **joelho** — a maior taxa que ainda cumpre o SLO —, não com o máximo.

</div>

<!--
Mostre os dois gráficos da página de visão geral (latência M/M/8 vs carga, vazão USL vs N).
Depois rode o cenário monolith com o perfil breakpoint no playground.
-->

---

## O ciclo de engenharia de desempenho

1. **Objetivos**: SLOs por endpoint no pico esperado.
2. **Modelo de carga**: mix, padrão de chegada, dados, assimetria.
3. **Teste** em um ambiente parecido com a produção.
4. **Análise**: curva, RED por serviço, USE por recurso, perfis.
5. **Mude uma coisa**, teste de novo.
6. **Publique** com um orçamento na CI; monitore em produção.

<div class="warn">

"Rápido" não é requisito. "`POST /holds` p99 < 300 ms, erros < 0,1 % a 4 500 req/s" é.

</div>

---

## Anti-métodos

| Anti-método | Parece com |
|---|---|
| **Poste de luz** | olhar onde as ferramentas são fáceis (`top`), não onde está o problema |
| **Mudança aleatória** | ajustar flags até "parecer mais rápido" |
| **Culpar outra pessoa** | "é o banco" — sem evidência |
| **Checklist improvisado** | repetir o checklist do último incidente |

**Método científico**: pergunta → hipótese → previsão → medição → **uma** mudança → medir de novo.

---

<!-- _class: tight -->

## Modelo de carga da venda (ilustrativo)

| Endpoint | Fatia | Pico req/s | SLO p99 |
|---|---|---|---|
| `GET /events/{id}` | 35 % | 10 500 | 200 ms |
| `GET /events/{id}/seats` | 30 % | 9 000 | 300 ms |
| `GET /search` | 10 % | 3 000 | 400 ms |
| `POST /holds` | 15 % | 4 500 | 300 ms |
| `POST /orders` | 7 % | 2 100 | 800 ms |
| `GET /orders/{id}` | 3 % | 900 | 200 ms |

- Derivado dos **logs de acesso de produção** da última venda.
- Mantenha o que os testes costumam perder: **assimetria** (um evento quente, setores quentes), **think time**, **chegadas sincronizadas** às 10:00:00.

---

## USE: utilização, saturação, erros — por recurso

- **Hardware**: CPU (fila de execução, **throttling**), memória (GC, OOM), rede, disco.
- **Software** — satura com mais frequência: pool de threads, **pool de conexões** (pendentes), **locks**, filas (lag de consumidores).

<div class="q">

`inventory` com CPU a 45 %, threads 200/200, pool 10/10 com 180 pendentes, PostgreSQL com CPU a 35 % e sessões em `Lock: tuple`. Gargalo?

</div>

* **Contenção de locks de linha**, piorada por transações longas. Mais pods = mais gente esperando; um banco maior já tem CPU ociosa.

---

## RED + USE

<div class="cols">
<div>

### RED — por serviço

- **R**ate, **E**rrors, **D**uration
- qual serviço está infeliz?
- vira os **thresholds**

</div>
<div>

### USE — por recurso

- **U**tilização, **S**aturação, **E**rros
- qual recurso dentro dele é a causa?
- o que você inspeciona quando um threshold falha

</div>
</div>

---

## Faça o ambiente de teste dizer a verdade

- **Paridade**: mesmos tipos de instância, limites, pools, flags da JVM, TLS, gateway — do mesmo IaC.
- **Dados**: do tamanho da produção, **assimétricos**, sintéticos (sem dados pessoais); restaure um snapshot antes de cada execução.
- **Dependências**: mocks com **latência realista** (pagamento ≈ 300 ms), não 1 ms.
- **Aquecimento**: JIT, pools, caches — cenário separado, fora dos thresholds; teste **partidas a frio** de propósito.
- **Ruído**: ≥ 3 execuções; verifique o **gerador de carga** (CPU, `dropped_iterations`).

---

<!-- _class: tight -->

## Seis tipos de teste

| Tipo | Pergunta | Forma |
|---|---|---|
| **Smoke** | funciona? | 1–2 VUs, 1 min |
| **Load** | SLOs no pico esperado? | rampa → platô de 20 min |
| **Stress** | elegante acima do pico? recupera? | degraus 1× → 1,5× → 2× → volta |
| **Spike** | absorve as 10:00:00? atraso do autoscaling? | base → 1,5× em 30 s |
| **Soak** | vazamentos, crescimento lento? | carga média, 4–24 h |
| **Breakpoint** | onde está o joelho? o que quebra primeiro? | rampa até os thresholds abortarem |

<div class="ok">

Mesmos fluxos de usuário (`lib/boxoffice.js`), **formas de carga** diferentes.

</div>

---

## Modelos de carga aberto vs fechado

| Tempo de resposta R | Fechado: 200 VUs, Z = 1 s → `N/(R+Z)` | Aberto: 182 req/s |
|---|---|---|
| 0,1 s | 182 req/s | 182 req/s |
| 0,5 s | 133 req/s | 182 — a fila cresce |
| 2,0 s | **67 req/s** | 182 — a fila explode |

- **Fechado** (`constant-vus`, `ramping-vus`): populações fixas que esperam respostas.
- **Aberto** (`constant-arrival-rate`, `ramping-arrival-rate`): usuários de internet, que não esperam.
- VUs necessários ≈ **taxa × duração da iteração**; `dropped_iterations` precisa ser **0**.

---

<!-- _class: tight -->

## Um teste load em k6

```javascript
const flow = (exec, share, iterSeconds) => ({
  executor: 'ramping-arrival-rate', exec, startRate: 0, timeUnit: '1s',
  preAllocatedVUs: Math.ceil(PEAK * share * iterSeconds),   // Little's Law
  maxVUs: Math.ceil(PEAK * share * iterSeconds * 3),
  stages: [ { target: PEAK * share, duration: '5m' },
            { target: PEAK * share, duration: '20m' },
            { target: 0, duration: '2m' } ],
});
export const options = {
  scenarios: { browse: flow('browse', 0.55, 0.2), hold: flow('hold', 0.20, 3.5) },
  thresholds: {
    'http_req_duration{name:POST /holds}': ['p(99)<300'],   // the SLO
    http_req_failed: ['rate<0.001'],
    dropped_iterations: ['count==0'],
  },
};
```

Dê nome às URLs (`tags: { name }`), declare **409 = esperado**, conte os **assentos reservados**.

---

## Omissão coordenada

<div class="q">

O servidor congela 1,5 s quatro vezes por minuto. Um testador de laço fechado reporta **p99 = 1 ms**. Verdade?

</div>

* Ele **parou de enviar** durante cada congelamento: uma amostra lenta em vez de ~150.
* Medido a partir do horário **pretendido** de envio: p90 ≈ 150 ms, **p99 ≈ 1,4 s**.
* Correção: geradores de modelo aberto (taxa de chegada do k6, wrk2, vegeta, `injectOpen` do Gatling), timeouts contados com duração total, comparar percentis do cliente e do servidor.

---

## Spike, soak, breakpoint — o que ler

- **Spike**: erros durante o salto, minutos para voltar ao SLO; compare **com e sem pré-escala**.
- **Soak**: tendências, não totais — heap depois do GC, conexões, p99 na hora 8 vs hora 1.
- **Breakpoint**: thresholds com `abortOnFail` o interrompem; resultado = **joelho + primeiro recurso saturado**. Nunca em produção.
- **Stress**: elegante = 429/503 rápidos + recuperação; catastrófico = timeouts → retries → continua fora.

---

## Carga + caos juntos

| Falha durante o teste de carga | Hipótese |
|---|---|
| pagamento +3 s (Toxiproxy, xk6-disruptor) | breaker abre em < 10 s; navegação e reservas mantêm o SLO |
| matar 1 de 3 pods de `inventory` | < 1 % de erros por < 30 s; recupera sozinho |
| Redis fora por 60 s | fallback para SQL; p99 < 1 s; sem estouro na volta |

<div class="ok">

Padrões de resiliência só são provados **no pico**. Playground: `cascading-failure` com o perfil `chaos`.

</div>

---

## Lendo a curva e os sintomas

- Latência ↑ **e CPU ~100 %** → limitado por CPU → flame graph de CPU.
- Latência ↑ **e CPU baixa** → espera: pool, lock, I/O, dependência → perfil **wall-clock**, USE.
- Vazão **cai** a partir de um ponto → contenção, retries (retrógrado).
- Histograma **bimodal** → dois caminhos (hit/miss de cache).
- Crescimento lento com carga constante → **vazamento**.
- p99 do cliente ≫ p99 do servidor → fila **antes** do serviço.

---

## Profiling: qual código?

- **Flame graph**: largura = fração das amostras; y = pilha; x **não** é o tempo.
- **async-profiler** (JVM): `asprof -d 30 -e wall -t -f wall.html 1` · `-e cpu` · `-e lock` · `-e alloc`.
- **py-spy** (Python): `py-spy record --pid 1 --idle -o wall.svg` · `top` · `dump`.
- Faça profiling **no platô**; distroless → **container efêmero de debug**.

<div class="warn">

`POST /holds` wall-clock: 33 % espera por lock de linha, 28 % chamada HTTP **dentro** da transação, 24 % espera no pool. Um perfil de CPU teria culpado o JSON.

</div>

---

<!-- _class: tight -->

## O banco: encontrar, explicar, corrigir

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT ... FROM seats
WHERE event_id = 4242 AND status = 'AVAILABLE' ORDER BY section, row_label, seat_number LIMIT 8;
-- Seq Scan ... Rows Removed by Filter: 5968520   Buffers: read=59861   412 ms

CREATE INDEX CONCURRENTLY seats_available_idx
    ON seats (event_id, section, row_label, seat_number) WHERE status = 'AVAILABLE';
-- Index Scan using seats_available_idx ...       Buffers: hit=5        0.08 ms
```

- Comece pelo `pg_stat_statements`, ordenado pelo tempo **total**.
- Linhas quentes: transações curtas, `FOR UPDATE SKIP LOCKED`, uma **sala de espera**.
- Pool = **vazão × tempo segurado**: 1 500/s × 46 ms = 69 → tire a chamada HTTP → 9. Depois, PgBouncer.

---

## Planejamento de capacidade

> réplicas = ⌈ pico / (joelho × (1 − folga)) ⌉, depois sobreviver à perda de uma zona

- Reservas: ⌈4 500 / (275 × 0,75)⌉ = **22** pods → ⌈22 × 3/2⌉ = **33** em 3 zonas.
- Sala de espera a 3 000 reservas/s → **24** pods, carga limitada no banco.
- Folga para erro de previsão, rajadas de segundos, falhas, deploys, **atraso do autoscaling**.

<div class="warn">

O autoscaling leva **1–4 min**. Demanda de 4 500/s vs capacidade de 1 100/s por 120 s = backlog de **408 000** requisições → **pré-escale** às 09:45.

</div>

---

## Orçamentos de desempenho na CI

- Teste k6 curto, de **modelo aberto**, por PR, sobre uma stack Compose parecida com a produção; aquecimento antes.
- Gate **absoluto**: thresholds derivados dos SLOs, com margem (`p(95)<150` para reservas).
- Gate **relativo**: mais de 15 % mais lento que a linha de base da `main` reprova.
- Orçamentos **determinísticos**: statements SQL por requisição (pega N+1), tamanho de payload, tamanho da imagem, tempo de início.
- Campanha completa (load, spike, breakpoint, soak) toda noite ou antes de eventos.

---

<!-- _class: tight -->

## O mapa de conceitos

| Componente | Pergunta que responde | Ensinado em |
|---|---|---|
| `client` · `mobile` | Como a carga real chega? | Metodologia · Testes de carga |
| `app` | Quanto uma réplica aguenta dentro do SLO? | Visão geral · Gargalos |
| `sql` | Qual consulta ou lock limita o caminho? | Gargalos |
| `cache` | Estamos medindo um cache quente? | Metodologia (aquecimento) |
| `metrics` · `tracing` | Qual recurso satura primeiro? | Metodologia · Gargalos |
| `queue` · `serverless` | Quantas réplicas, quanto admitimos? | Planejamento de capacidade |
| `thirdparty` | E se uma dependência ficar lenta sob carga? | Testes de carga (+ caos) |

<p class="small">Desempenho não acrescenta caixas à paleta: mede as que você já tem. Cenários: <code>monolith</code>, <code>flash-sale</code>, <code>serverless-burst</code>, <code>cascading-failure</code>.</p>

---

## Pontos-chave

1. Tempo de resposta = serviço + **espera**; `N = X × R`; planeje com o **joelho**.
2. Método antes de ferramenta: **modelo de carga**, depois **RED** por serviço e **USE** por recurso.
3. Teste um sistema **parecido com a produção**, com dados realistas e assimétricos — aquecido, e frio de propósito.
4. **Modelo aberto** para tráfego de internet; **thresholds = SLOs** por endpoint; `dropped_iterations = 0`.
5. Cuidado com a **omissão coordenada**; confie em percentis de histogramas.
6. Perfis **wall-clock** e `EXPLAIN ANALYZE` encontram o gargalo real; mude **uma** coisa por vez.
7. Capacidade = demanda / (joelho × folga) + perda de zona; **pré-escale** picos conhecidos; **orçamentos na CI**.
