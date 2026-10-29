---
marp: true
lang: pt-BR
title: Observabilidade
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

# Observabilidade

**Fazer perguntas novas a um sistema em execução — e acordar pessoas só quando os usuários sofrem**

<!--
Roteiro: (1) monitoramento vs observabilidade, a paleta, health checks, custo; (2) sinais: métricas,
logs, traces, profiles, RED/USE, cardinalidade; (3) OpenTelemetry: propagação, Collector, amostragem;
(4) alertas sobre o burn rate do SLO; (5) resposta a incidentes e postmortems.
-->

---

## 10h04, dia de abertura de vendas

<div class="q">

Um show de estádio abriu as vendas às 10h00. Todos os pods estão verdes, a CPU está em 45%, a taxa de erros é 0,3%.
Os fãs esperam **nove segundos** para pagar. Quatro times mostram, cada um, um dashboard provando que o *seu* serviço está bem.

Onde você olharia primeiro?

</div>

* Os dashboards acompanham **causas** escolhidas de antemão, em média sobre todas as rotas.
* O problema é um sintoma de **latência**, em **uma jornada**, na **cauda** (p99), causado por uma dependência **externa**.
* Você precisa de SLIs por jornada para enxergá-lo — e de **traces** para achar para onde foi o tempo.

<!--
Deixe a turma responder antes de revelar. A ideia: o sistema não está fora do ar, está lento de um
jeito que ninguém previu. É para essa situação que existe a observabilidade.
-->

---

## Monitoramento vs observabilidade

| | Monitoramento | Observabilidade |
|---|---|---|
| Perguntas | conhecidas de antemão ("X > Y?") | descobertas durante a investigação |
| Saída | dashboards, alertas por limiar | consultas ad hoc, traces, quebras |
| Dados | métricas agregadas | métricas **mais** eventos ricos: logs, traces, profiles |
| Bom para | falhas já vistas | falhas **novas** de muitos serviços |

- Observabilidade = inferir o **estado interno a partir das saídas externas** (Kalman, teoria de controle).
- O monitoramento é um **subconjunto**: você ainda precisa de dashboards e alertas sobre sintomas conhecidos.

---

## A paleta de observabilidade

| Componente | Pergunta | Consumidor |
|---|---|---|
| **Metrics** | *há* algo errado? quanto, desde quando? | dashboards, regras de alerta |
| **Logs** | o que *exatamente* aconteceu neste evento? | humanos investigando |
| **Tracing** | *onde* foram o tempo / o erro? | humanos investigando |
| **Alerting** | um *humano* precisa agir *agora*? | engenheiro de on-call |
| **Health check** | esta *instância* deve receber tráfego ou ser reiniciada? | load balancer, Kubernetes |

<div class="ok">

A cola é o **contexto**: o mesmo `trace_id` na linha de log, no trace e no exemplar da métrica.

</div>

---

## O ciclo de investigação

1. **Alerta** sobre um sintoma: SLO do checkout queimando 14×.
2. **Dashboard RED**: p99 do `POST /checkout` 400 ms → 9 s; as outras rotas, normais.
3. **Exemplar**: uma amostra lenta → seu `trace_id`.
4. **Trace**: 8 dos 9 s dentro do span `payment`.
5. **Logs** daquele span: `connection pool exhausted, waited 7.9 s`.
6. **Mitigar** (breaker, failover), depois **postmortem**.

<p class="small">De sinais baratos e agregados para sinais caros e detalhados — estreitando a busca a cada passo.</p>

---

<!-- _class: tight -->

## Health checks: três probes

| Probe | Pergunta | Em caso de falha | Deve verificar |
|---|---|---|---|
| **Startup** | terminou de iniciar? | espera; mata após o limite | app inicializada |
| **Liveness** | travou sem conserto? | **reinicia** | só o próprio processo |
| **Readiness** | consegue atender *agora*? | **sai do LB** | o que esta instância precisa localmente |

<div class="warn">

**Cascata do check profundo**: a readiness verifica o PostgreSQL → um failover de 20 s deixa **todos** os pods do `order` não prontos → o Service fica sem endpoints → todas as rotas falham. Se a **liveness** verifica o banco, todos os pods reiniciam juntos → tempestade de reinícios.

</div>

**A liveness nunca verifica dependências.** Saúde das dependências → métricas, alertas, timeouts, breakers.

---

## Telemetria é uma carga de trabalho

<div class="q">

500 req/s · 8 spans por requisição · 500 bytes por span. Quantos dados de trace por dia?

</div>

* `500 × 8 × 500 B = 2 MB/s ≈ 173 GB/dia` — mais de **5 TB/mês** com 100% de amostragem.
* Logs: 5 linhas × 300 B por requisição ≈ **65 GB/dia**.
* E a venda relâmpago multiplica o tráfego por 50.
* Três alavancas: **amostragem** (traces), **cardinalidade limitada** (métricas), **níveis e camadas de retenção** (logs).

<!--
Números ilustrativos. O ponto é o hábito: estimar a telemetria como qualquer outra carga de trabalho.
-->

---

## Quatro sinais, um espectro

| Sinal | Unidade | Responde | O custo cresce com |
|---|---|---|---|
| **Métricas** | número por série por intervalo | *há* algo errado? | número de séries (não o tráfego) |
| **Traces** | árvore de spans por requisição | *onde*? | tráfego × saltos (amostrado) |
| **Logs** | registro por evento | *o que* aconteceu? | tráfego |
| **Profiles** | amostras de pilha por processo | *qual código*? | número de processos |

- Tipos de métrica: **counter** (só sobe), **gauge** (sobe/desce), **histogram** (buckets, agregável), summary (evite).
- Buckets de histograma são contadores → podem ser **somados entre pods**.

---

## RED, USE, golden signals

| Método | Para | Sinais |
|---|---|---|
| **RED** | serviços / APIs | Rate, Errors, Duration |
| **USE** | recursos: CPU, pools, filas | Utilization, Saturation, Errors |
| **Golden signals** | tudo voltado ao usuário | latência, tráfego, erros, saturação |

- checkout do `order` → RED · chamadas ao provedor de pagamentos → RED (lado do cliente)
- Pool do PostgreSQL → USE: **aquisições pendentes** · Kafka → **consumer lag**

<div class="ok">

A **saturação** (trabalho esperando) subiu dois minutos antes do alerta do checkout: é o indicador antecedente.

</div>

---

<!-- _class: tight -->

## RED em PromQL

```promql
# Rate: requests/s per route
sum by (http_route) (rate(http_server_request_duration_seconds_count{job="order"}[5m]))

# Errors: fraction of 5xx
sum(rate(http_server_request_duration_seconds_count{job="order", http_response_status_code=~"5.."}[5m]))
/ sum(rate(http_server_request_duration_seconds_count{job="order"}[5m]))

# Duration: p99 per route, across all pods
histogram_quantile(0.99,
  sum by (le, http_route) (rate(http_server_request_duration_seconds_bucket{job="order"}[5m])))
```

- `rate()` nos counters **antes** do `sum` (trata reinícios); mantenha o `le` ao somar buckets.

---

## Nunca tire a média de percentis

<div class="q">

Quatro pods informam p99 = 180, 180, 180 e 1.260 ms (o lento recebe 10% do tráfego). Qual é o p99 da frota?

</div>

* Média dos p99: **450 ms**. p99 real da frota: cerca de **750 ms**.
* Percentis **não se compõem**; nem a média nem o máximo estão certos.
* Some os buckets do histograma (`sum by (le)`), **depois** calcule o percentil.
* E nunca use a **latência média**: ela esconde a cauda que os usuários sentem.

---

## Cardinalidade

| Label adicionado | × valores | Séries |
|---|---|---|
| um histograma (15 buckets + sum + count) | 17 | 17 |
| método · rota · status | 4 · 25 · 6 | 10.200 |
| pod | 20 | 204.000 |
| `customer_id` | 1.000.000 | **204.000.000.000** |

<div class="warn">

Séries = **produto** dos valores dos labels. Labels ilimitados (`user_id`, `order_id`, URLs cruas) derrubam o backend de métricas.

</div>

Perguntas de alta cardinalidade ("*quais* fãs ficaram lentos?") pertencem a **traces e logs**.

---

## Logs: estruturados, correlacionados, seguros

```json
{"timestamp":"2027-03-13T10:04:12.481Z","level":"WARN","service.name":"payment",
 "message":"provider call slow","trace_id":"4bf92f35...","span_id":"00f067aa...",
 "order_id":"ord_9912","duration_ms":8120,"pool_wait_ms":7900}
```

- **Estruturados** (JSON / modelo de log do OTel) com nomes de campo estáveis, não texto livre.
- `trace_id` + `span_id`: saltar de uma linha de log para o trace dela, e voltar.
- Registre **eventos**, não passos; registre a **decisão** ("fallback porque o breaker abriu").
- **Nunca** segredos ou dados pessoais; remova na origem e no Collector.

---

<!-- _class: tight -->

## Traces: ache o caminho crítico

```text
gateway    SERVER POST /checkout          |██████████████████████████████|  9.12 s
 order     SERVER POST /orders            | █████████████████████████████|  9.08 s
  inventory CLIENT PUT /holds/{id}        | ▌                            |  0.09 s
  payment  SERVER POST /charges           |  ████████████████████████████|  8.95 s
   payment INTERNAL pool.acquire          |  ██████████████████████████  |  7.90 s
   payment CLIENT POST provider/charges   |                          ███▌|  1.02 s
```

- O provedor ficou mais lento (1 s) → cada chamada segura uma conexão por mais tempo → o pool de 20 satura (lei de Little).
- **7,9 s de fila dentro do BoxOffice**: a correção é espera limitada + timeout + bulkhead.
- Adicione spans para a **espera** (pools, locks, filas): a instrumentação automática só enxerga I/O.

---

## SLI → SLO → error budget → SLA

| Termo | Exemplo no BoxOffice |
|---|---|
| **SLI** — o que o usuário sente | % de `POST /holds` não-5xx em < 500 ms |
| **SLO** — meta interna | ≥ 99,9% em 28 dias |
| **Error budget** — 1 − SLO | 0,1% das reservas podem falhar ou ser lentas |
| **SLA** — contrato, multas | casas parceiras: 99,5% ao mês, ou créditos |

- SLI = **eventos bons / eventos válidos**, medido perto do usuário (gateway, probes sintéticos).
- CPU, heap, número de pods **não** são SLIs. Mantenha o SLO **mais rígido** que o SLA.

---

## Comece pelas jornadas do usuário

| Jornada | SLO (28 dias) |
|---|---|
| Reservar lugares | 99,9% com sucesso em < 500 ms |
| Navegar no catálogo | 99,5% em < 300 ms |
| Receber ingressos por e-mail | 99% em até **2 min** da confirmação (**atualidade**) |
| Sala de espera durante uma abertura | 99,95% das atualizações de posição |

- Meça primeiro, depois defina o SLO um pouco abaixo do que você alcança.
- Respeite a matemática das dependências: um provedor com 99,9% limita o SLO de compra. **Nunca 100%.**

<!--
O SLI de atualidade é o que pega falhas assíncronas: APIs verdes, e-mails atrasados.
-->

---

<!-- _class: tight -->

## Error budget e burn rate

1 M de requisições/dia × 28 dias × 0,1% = **28.000** requisições com falha permitidas.

> burn rate = taxa de erros ÷ (1 − SLO) — 1,44% de erros a 99,9% = 14,4× → orçamento acaba em ~1,9 dia

| Severidade | Burn rate | Janela longa | Janela curta | Orçamento gasto |
|---|---|---|---|---|
| acionar | 14,4× | 1 h | 5 min | 2% |
| acionar | 6× | 6 h | 30 min | 5% |
| chamado | 1× | 3 dias | 6 h | 10% |

<div class="warn">

Um deploy ruim (5% de erros por 3 h) custa ~22% do orçamento; uma degradação discreta de 0,2% (2×) **o esvazia até o dia 26**. Alerte pelo orçamento, não pela CPU.

</div>

---

## A política de error budget

- **> 50% restante**: deploy em qualquer dia útil; experimentos permitidos.
- **0–50%**: canary + plano de rollback; um item de confiabilidade em toda sprint.
- **Esgotado**: congelar deploys de funcionalidades no caminho de compra até o SLI se recuperar.
- **Regra de abertura de vendas**: nenhum deploy nas 24 h antes de uma grande abertura.
- **Um incidente > 20%**: postmortem sem culpados com ações com responsável.

<div class="ok">

Assinada por produto **e** engenharia, de antemão. Sem política, um SLO é decoração.

</div>

---

## OpenTelemetry

| Peça | Papel |
|---|---|
| **API / SDK** | criar spans, métricas, logs; amostragem, batching, exportação |
| **Instrumentação** | sem código: agente Java, `opentelemetry-instrument` em Python |
| **Semantic conventions** | `http.route`, `db.system`, `service.name`… os mesmos nomes em todo lugar |
| **OTLP** | o protocolo: gRPC **4317**, HTTP **4318** |
| **Collector** | receber → processar → exportar |

<div class="ok">

O OTel padroniza a **produção e o transporte**, não o backend: troque o Tempo por um SaaS sem reinstrumentar.

</div>

---

## Propagação de contexto

```text
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
                version · trace-id (same for all hops) · parent-id (changes) · flags (sampled)
```

- Cada salto mantém o **trace-id** e substitui o **parent-id** pelo próprio span.
- Kafka: contexto nos **headers da mensagem**; consumidores em lote usam **span links**.
- O provedor é uma caixa-preta: só o **span CLIENT** do `payment` o enxerga.
- Quebra em: proxies que descartam headers, trocas de thread, clientes HTTP caseiros.

---

<!-- _class: tight -->

## O pipeline do Collector

```yaml
processors:
  memory_limiter: { check_interval: 1s, limit_percentage: 80, spike_limit_percentage: 20 }
  attributes/redact: { actions: [ { key: payment.card_number, action: delete } ] }
  tail_sampling:
    decision_wait: 10s
    policies:
      - { name: keep-errors, type: status_code, status_code: { status_codes: [ERROR] } }
      - { name: keep-slow, type: latency, latency: { threshold_ms: 2000 } }
      - { name: some-of-the-rest, type: probabilistic, probabilistic: { sampling_percentage: 5 } }
  batch: {}
```

- `memory_limiter` **primeiro**, `batch` **por último**. Agente (por nó) vs **gateway** (política central).
- Perder telemetria é aceitável; **deixar o checkout lento para reportar sobre ele, não**.

---

## Amostragem

| Estratégia (2.000 req/s, 1% de erros) | Armazenado | Traces de erro guardados |
|---|---|---|
| guardar tudo | 691 GB/dia | 100% |
| head 10% | 69 GB/dia | 10% |
| head 1% | 7 GB/dia | 1% |
| **tail**: todos os erros + lentos + 5% do resto | 54 GB/dia | **100%** |

- Head = decidido no primeiro span, **cego** ao resultado. Tail = decidido no Collector depois que o trace termina.
- O tail sampling precisa de **todos os spans de um trace numa instância** (roteie por trace ID).
- Calcule **métricas sobre 100% do tráfego** antes de amostrar; use **exemplars** para saltar para os traces.

---

## O que merece um page

Um page precisa ser **urgente**, **acionável** e **visível para o usuário**.

| Situação | Destino |
|---|---|
| checkout falhando para 5% dos fãs durante uma abertura | **page** |
| budget queimando devagar, acaba em 10 dias | ticket |
| disco do Kafka cheio em 4 dias | ticket |
| CPU em 85% com todos os SLIs bem | nada / revisão de capacidade |

<div class="warn">

Alerte sobre **sintomas** (queima do SLO), não **causas** (CPU, reinícios): causas acionam à toa e perdem a falha que ninguém previu.

</div>

---

## Burn rate

> burn rate = razão de erros observada ÷ (1 − SLO) · budget gasto = burn × tempo ÷ janela

| Burn rate (SLO 99,9%, 28 dias) | Razão de erros | Budget acaba em | Gasto em 1 h |
|---|---|---|---|
| 1× | 0,1% | 28 dias | 0,15% |
| 6× | 0,6% | ~4,7 dias | 0,9% |
| 14,4× | 1,44% | ~1,9 dia | **≈ 2%** |
| 1000× (indisponibilidade total) | 100% | 40 min | 100% |

---

## Multiwindow, multi-burn-rate

| Severidade | Janela longa | Janela curta | Burn rate | Budget gasto ao disparar |
|---|---|---|---|---|
| **page** | 1 h | 5 min | 14,4× | 2% |
| **page** | 6 h | 30 min | 6× | 5% |
| ticket | 3 dias | 6 h | 1× | 10% |

- Janela **longa**: a queima é significativa. Janela **curta**: ainda está acontecendo → reset rápido.
- Indisponibilidade total → dispara em < 1 min; 2% de erros → ~43 min.
- O **Alertmanager** agrupa, deduplica, inibe, silencia, roteia; um **dead man's switch** vigia o vigia.

<!--
Um budget de 28 dias não protege uma abertura de vendas de 30 minutos: dê aos eventos críticos o próprio SLO, com janelas curtas.
-->

---

## Conduzindo o incidente

| Papel | Faz | Não faz |
|---|---|---|
| **Incident commander** | severidade, papéis, decisões, linha do tempo | depurar |
| **Líder de ops** | investiga e mitiga; altera a produção | falar com clientes |
| **Líder de comunicação** | atualizações a cada 15–30 min, página de status | especular em público |
| **Escriba** | registra com horário tudo o que foi visto, decidido, alterado | filtrar |

- **SEV1**: jornada principal fora do ar ou qualquer abertura de vendas afetada → page, IC, página de status.
- **Declare cedo, rebaixe à vontade.** O on-call precisa ser sustentável (≈ ≤ 2 incidentes por turno).

---

## Mitigar primeiro

* 10h02 impacto → 10h03 page (**MTTD 1 min**) → 10h14 provedor secundário + sala de espera estrangulada (**MTTM 12 min**) → 10h40 resolvido.
* Mitigações genéricas e ensaiadas: **rollback**, **desligar flag**, **failover**, **descartar carga**, escalar, bloquear tráfego ruim.
* Custo: 200 tentativas/s × 720 s × 12% ≈ **17.300 checkouts com falha** contra um budget de 28 dias de **2.000**.
* A política de error budget entra em ação: funcionalidades do checkout pausam até as ações de confiabilidade saírem.

<div class="ok">

Os usuários sentem o tempo até a **mitigação**. A causa raiz pode esperar até segunda-feira.

</div>

---

## Postmortems blameless

- Assuma que as pessoas agiram de forma razoável com o que sabiam; pergunte **como o sistema tornou isso possível**.
- Busque **fatores contribuintes**, não uma única causa raiz:
  - provedor lento (externo) · sem timeout + pool compartilhado de 20 · failover manual e não documentado
  - alertas de SLO de 28 dias cegos a uma abertura de 30 minutos · teste de carga com mock do provedor a 100 ms
- **Ações**: prevenir / detectar / mitigar, um **dono**, uma **data**, acompanhadas.
- Feche o ciclo com um **game day** que reproduz o incidente (Toxiproxy).

---

## O mapa de conceitos da observabilidade

| Componente | Pergunta que responde | Conceitos-chave |
|---|---|---|
| `metrics` | *há* algo errado? quanto? | RED, USE, histogramas, cardinalidade |
| `logs` | *o que* aconteceu neste evento? | estruturados, `trace_id`, níveis, retenção |
| `tracing` | *onde* foi parar o tempo? | spans, `traceparent`, Collector, tail sampling |
| `alerting` | um humano precisa agir *agora*? | burn rate do SLO (janela de 28 dias), multijanela, runbooks |
| `healthcheck` | tráfego ou restart para esta instância? | startup, liveness, readiness, raso vs profundo |

<p class="small">O contexto compartilhado os une: métrica → <b>exemplar</b> → trace → <b>trace_id</b> → logs. Alertas levam à resposta a incidentes; os SLOs que eles fazem cumprir são definidos antes, nesta mesma aula.</p>

---

## Conclusões

1. **Observabilidade** permite fazer perguntas novas; a paleta: métricas, logs, tracing, alertas, health checks.
2. **A liveness nunca verifica dependências**; checks profundos causam indisponibilidades correlacionadas.
3. **RED** para serviços, **USE** para recursos; histogramas, nunca médias de percentis.
4. **Cardinalidade** é um produto: labels limitados nas métricas, detalhes em traces e logs.
5. **OpenTelemetry**: propague o `traceparent`, pipelines do Collector, **tail sampling** guarda todo erro.
6. Acione pages pelo **burn rate do SLO** com regras multiwindow; todo alerta tem dono e runbook.
7. Incidentes: papéis, **mitigar primeiro**, postmortems blameless com ações que têm dono.
