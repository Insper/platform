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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

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
* Os usuários virtuais (VUs, *virtual users*) **esperavam cada resposta**: quando o sistema ficou lento, o teste ficou lento junto.
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
- **Retrógrado** (Lei Universal de Escalabilidade, USL, *Universal Scalability Law*): depois do pico, *mais* concorrência → *menos* vazão.

<div class="ok">

Planeje com o **joelho** — a maior taxa que ainda cumpre o objetivo de nível de serviço (SLO, *service level objective*) —, não com o máximo.

</div>

<p class="small">Lab 2, <code>catalog</code> com 1 CPU e pool de 10: p99 de 38,6 ms a 300 req/s, 223,7 ms a 400, 2.056 ms a 500 — o joelho está entre 300 e 400 e quem saturou foi o pool, não a CPU.</p>

<!--
Mostre os dois gráficos da página de visão geral (latência M/M/8 vs carga, vazão USL vs N).
Depois rode o cenário monolith com o perfil breakpoint no playground.
-->

---

## O ciclo de engenharia de desempenho

<div class="flow">
<div class="box accent">1 · objetivos<small>SLOs por endpoint no pico</small></div><div class="arrow">→</div>
<div class="box">2 · modelo de carga<small>mix, chegadas, dados, assimetria</small></div><div class="arrow">→</div>
<div class="box">3 · teste<small>ambiente parecido com a produção</small></div><div class="arrow">→</div>
<div class="box orange">4 · análise<small>curva, RED, USE, perfis</small></div><div class="arrow">→</div>
<div class="box green">5 · mude UMA coisa<small>e teste de novo</small></div>
</div>

- **6 · Publique** com um orçamento na integração contínua (CI, *continuous integration*); as métricas de produção alimentam o próximo modelo de carga.
- Mude uma coisa por vez — senão você não consegue atribuir a melhora.

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

## USE: siga a espera, recurso por recurso

<div class="flow">
<div class="box green">CPU<small>45 %, sem throttling</small></div><div class="arrow">→</div>
<div class="box green">memória<small>coleta de lixo &lt; 2 %</small></div><div class="arrow">→</div>
<div class="box orange">threads do Tomcat<small>200/200 — esperando o quê?</small></div><div class="arrow">→</div>
<div class="box orange">pool Hikari<small>10/10, 180 pendentes</small></div><div class="arrow">→</div>
<div class="box red">PostgreSQL<small>CPU 35 % · Lock: tuple</small></div>
</div>

- **U**tilização, **S**aturação, **E**rros de cada recurso — hardware *e* software (pools, locks, filas).
- Gargalo: **contenção de locks de linha**, piorada por transações longas.

<div class="q">

De "ponha um cache, um banco maior, mais pods, reescreva em Go", qual ajuda?

</div>

* Nenhuma: cache não ajuda escritas, a CPU do banco está ociosa, mais pods somam gente esperando, Go espera os mesmos locks.

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

- **Paridade**: mesmos tipos de instância, limites, pools, flags da máquina virtual Java (JVM, *Java virtual machine*), Transport Layer Security (TLS, *segurança da camada de transporte*), gateway — da mesma infraestrutura como código.
- **Dados**: do tamanho da produção, **assimétricos**, sintéticos (sem dados pessoais); restaure um snapshot antes de cada execução.
- **Dependências**: mocks com **latência realista** (pagamento ≈ 300 ms), não 1 ms.
- **Aquecimento**: o compilador just-in-time, pools, caches — cenário separado, fora dos thresholds; teste **partidas a frio** de propósito.
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
| 0,5 s | 133 req/s | 182 — ⚠️ a fila cresce |
| 2,0 s | **67 req/s** | 182 — 🔴 a fila explode |

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

<div class="flow">
<div class="box">laço fechado<small>envia, espera a resposta</small></div><div class="arrow">servidor congelado 1,5 s →</div>
<div class="box red">1 amostra lenta<small>as outras ~150 nunca enviadas</small></div><div class="arrow">→</div>
<div class="box green">p99 = 1 ms ✓</div>
</div>
<div class="flow">
<div class="box">modelo aberto<small>envia a cada 10 ms, aconteça o que acontecer</small></div><div class="arrow">servidor congelado 1,5 s →</div>
<div class="box red">~150 amostras lentas<small>medidas do envio pretendido</small></div><div class="arrow">→</div>
<div class="box red">p99 = 1,37 s ✗</div>
</div>

- O mesmo servidor, quatro congelamentos por minuto: o laço fechado grava **595 amostras a menos** — justamente as lentas.
- Correção: geradores de modelo aberto (taxa de chegada do k6, wrk2, vegeta, `injectOpen` do Gatling), timeouts contados com duração total, percentis do cliente vs do servidor.

---

## Simulador: dois relatórios do mesmo minuto

<div class="flow">
<div class="box">4 congelamentos de 1,5 s<small>p99 fechado 1,0 ms ✓ · p99 aberto 1,37 s ✗</small></div><div class="arrow">→</div>
<div class="box orange">1 congelamento de 0,5 s<small>0,8 % do teste: até o p99 aberto é 1,0 ms</small></div><div class="arrow">→</div>
<div class="box">8 congelamentos<small>p99.9 fechado = 1,5 s, p99 ainda 1,0 ms</small></div>
</div>

- O simulador **coordinated-omission** da página de testes de carga: mude os congelamentos, toque o minuto, compare amostras e veredictos.
- Um p99 só enxerga uma cauda maior que 1 % das requisições: paradas curtas pedem **p99.9 e max**.

<div class="warn">

Por mais que o servidor congele, o laço fechado continua omitindo as requisições que teriam esperado.

</div>

---

## Spike, soak, breakpoint — o que ler

- **Spike**: erros durante o salto, minutos para voltar ao SLO; compare **com e sem pré-escala**.
- **Soak**: tendências, não totais — heap depois da coleta de lixo, conexões, p99 na hora 8 vs hora 1.
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

Padrões de resiliência só são provados **no pico**. Lab 9: p50 do `browse` de 9,04 s sem proteção e 6,5 ms com os padrões.

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

## Uma mudança por vez: o gargalo se move

<div class="flow">
<div class="box red">400/s<small>Seq Scan do mapa de assentos</small></div><div class="arrow">índice →</div>
<div class="box red">700/s<small>pool 10/10, 150 pendentes</small></div><div class="arrow">preços fora →</div>
<div class="box red">1 100/s<small>locks de linha</small></div><div class="arrow">SKIP LOCKED →</div>
<div class="box red">1 800/s<small>CPU do inventory a 85 %</small></div>
</div>
<div class="flow">
<div class="arrow">10 pods + PgBouncer →</div>
<div class="box red">3 400/s<small>CPU do primário a 80 %</small></div><div class="arrow">sala de espera →</div>
<div class="box green">3 000 admitidas<small>p99 140 ms · o limite é escolhido</small></div>
</div>

- Mantenha um diário: mudança, novo joelho, o que saturou em seguida — a evidência por trás de cada número de capacidade.
- Somar capacidade onde o gargalo **não** está não compra nada (playground `monolith`: 12 réplicas = 6 réplicas, a um custo maior).

---

## Planejamento de capacidade

> réplicas = ⌈ pico / (joelho × (1 − folga)) ⌉, depois sobreviver à perda de uma zona

- Reservas: ⌈4 500 / (275 × 0,75)⌉ = **22** pods → ⌈22 × 3/2⌉ = **33** em 3 zonas.
- Sala de espera a 3 000 reservas/s → **24** pods, carga limitada no banco.
- Folga para erro de previsão, rajadas de segundos, falhas, deploys, **atraso do autoscaling**.
- Conexões: 4 500 × 6 ms ≈ 27 ativas — PgBouncer na frente do primário.

---

## O autoscaling chega atrasado

<div class="flow">
<div class="box red">10:00:00<small>500 → 4 500 reservas/s</small></div><div class="arrow">→</div>
<div class="box">métricas<small>15–60 s</small></div><div class="arrow">→</div>
<div class="box">Horizontal Pod Autoscaler (HPA)<small>≤ 15 s</small></div><div class="arrow">→</div>
<div class="box">agendar / nó novo<small>s – 3 min</small></div><div class="arrow">→</div>
<div class="box">JVM pronta<small>20–60 s</small></div>
</div>

- **1–4 minutos**: demanda de 4 500/s vs capacidade de 1 100/s por 120 s = backlog de **408 000** requisições.
- Picos conhecidos: **pré-escale** às 09:45, controle de admissão, aqueça os pods novos.

<p class="small">Playground: <code>boxoffice-hpa</code> (lab 10) — aumente o mínimo do HPA para 4 pods e os descartes somem.</p>

---

## Orçamentos de desempenho na CI

<div class="flow">
<div class="box">pull request</div><div class="arrow">→</div>
<div class="box">compose up<small>+ aquecimento</small></div><div class="arrow">→</div>
<div class="box accent">gate absoluto<small>thresholds com margem</small></div><div class="arrow">→</div>
<div class="box accent">gate relativo<small>> 15 % mais lento que a main?</small></div><div class="arrow">→</div>
<div class="box green">merge</div>
</div>

- Orçamentos **determinísticos** nunca falham por acaso: statements SQL por requisição (pega N+1), tamanho de payload, tamanho da imagem, tempo de início.
- Lab 11: p95 < 300 ms contra ~7 ms medidos; o job da imagem `needs` dele — um orçamento quebrado nunca vira imagem.
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
3. Teste um sistema **parecido com a produção**, com dados realistas e assimétricos — aquecido e frio de propósito.
4. **Modelo aberto** para tráfego de internet; **thresholds = SLOs** por endpoint; `dropped_iterations = 0`.
5. Cuidado com a **omissão coordenada**; confie em percentis de histogramas — e olhe além do p99 para paradas curtas.
6. Perfis **wall-clock** e `EXPLAIN ANALYZE` encontram o gargalo real; mude **uma** coisa por vez.
7. Capacidade = demanda / (joelho × folga) + perda de zona; **pré-escale** picos conhecidos; **orçamentos na CI**.
