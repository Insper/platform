---
marp: true
lang: pt-BR
title: Hands-on 8 — Observabilidade
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

# Hands-on 8 — Observabilidade

**OpenTelemetry, um dashboard RED (taxa, erros e duração, *rate, errors, duration*), um trace atravessando o Kafka e um objetivo de nível de serviço (SLO, *service level objective*) que aciona na hora certa**

<!--
Roteiro: (1) as perguntas que o k6 não responde; (2) otel-lgtm e o agente Java; (3) o outbox quebra
o trace; (4) RED e USE como código; (5) SLO, orçamento de erros, taxa de queima; (6) disparar o
alerta; (7) medir.
-->

---

## "O checkout está lento"

<div class="q">

A venda relâmpago está no ar e o suporte está lotado. É com todos os fãs ou com alguns? Qual dos sete
serviços? O banco, o pool, o Kafka, o provedor de e-mail?

</div>

- O k6 mede de **fora**; precisamos da visão de **dentro**.
- **Métricas**: *que* algo está errado e quanto.
- **Traces**: *onde* o tempo foi gasto, requisição por requisição.
- **Logs**: *por quê*, quando você já sabe onde olhar.

---

## Arquitetura

<div class="flow">
<div class="group">
<div class="caption">todo serviço Java + o agente</div>
<div class="box">gateway</div>
<div class="box">catalog ×3</div>
<div class="box">order · notification</div>
</div>
<div class="arrow">OTLP :4318 →</div>
<div class="group">
<div class="caption">otel-lgtm (um contêiner)</div>
<div class="box accent">OpenTelemetry Collector</div>
<div class="box green">Prometheus<small>métricas</small></div>
<div class="box green">Tempo<small>traces</small></div>
<div class="box green">Loki<small>logs</small></div>
</div>
<div class="arrow">→</div>
<div class="box orange" style="flex: .7">Grafana :3000<small>exemplar → trace → logs; regras de alerta</small></div>
</div>

- O agente envia **OTLP** (o OpenTelemetry Protocol); o Grafana liga os três sinais.

<div class="ok">

Backend de desenvolvimento em uma imagem; produção o troca por sistemas separados — os serviços continuam falando OTLP.

</div>

---

## Passo 1 · O agente: um jar, nenhum código

```shell
sh scripts/get-otel-agent.sh      # downloads infra/otel/opentelemetry-javaagent.jar (v2.32.0)
```

```yaml
x-otel: &otel
  JAVA_TOOL_OPTIONS: -javaagent:/otel/opentelemetry-javaagent.jar
  OTEL_JAVAAGENT_ENABLED: ${OTEL_ON:-true}
  OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-lgtm:4318
```

<p class="small">Cada serviço Java monta <code>./infra/otel:/otel:ro</code> e adiciona <code>&lt;&lt;: *otel</code> e o seu <code>OTEL_SERVICE_NAME</code>. As imagens não mudam.</p>

---

## O que o agente entrega

- **Spans** para servidor/cliente HTTP, JDBC, Kafka, Redis, `@Scheduled`.
- **Métricas** com nomes padronizados: `http_server_request_duration_seconds_bucket{service_name, http_route, http_response_status_code}`.
- **Logs** via OTLP, cada um com `trace_id` e `span_id`.
- `http_route` é o **template** (`/catalog/events/{id}`), nunca a URL crua → cardinalidade limitada.

---

## O salto que o agente não enxerga

<div class="warn">

Um pedido produz **dois traces sem relação**: `POST /orders` e, depois, relay → Kafka → `notification`.

</div>

<div class="flow">
<div class="box">order<small>thread HTTP</small></div><div class="arrow">INSERT →</div>
<div class="box accent">linha do outbox<small>+ traceparent (migração V2)</small></div><div class="arrow">SELECT →</div>
<div class="box">relay<small>thread do scheduler: makeCurrent()</small></div><div class="arrow">→</div>
<div class="box green">Kafka → notification<small>o mesmo trace id</small></div>
</div>

- O outbox é uma **linha do banco** lida por outra thread: o contexto da requisição precisa viajar nela.
- Resultado: **um** trace — 9 ms de requisição, o relay 22 ms depois, 67 ms no `notification`.

---

## Passo 2 · RED e USE

| Método | Para | Sinais |
|---|---|---|
| **RED** | serviços movidos a requisições | Rate, Errors, Duration |
| **USE** | recursos | Utilization, Saturation, Errors |

- O RED diz que os usuários estão sofrendo; o USE diz qual **recurso** acabou.
- Dashboard como **código**: `infra/grafana/dashboards/boxoffice-red.json` + um arquivo de provedor.

---

## Quatro formas de PromQL

```text
sum by (service_name) (rate(…_count[$__rate_interval]))                     # Rate
rate(…_count{http_response_status_code=~"5.."}) / rate(…_count)             # Errors (ratio)
histogram_quantile(0.95, sum by (service_name, le) (rate(…_bucket[…])))      # Duration
db_client_connections_pending_requests                                      # Saturation
```

<div class="warn">

**Nunca tire a média de percentis.** Some as taxas dos buckets e depois calcule o quantil.

</div>

---

## Passo 3 · Da promessa aos números

| Termo | `catalog` |
|---|---|
| SLI (indicador de nível de serviço) | fração das requisições (sem `/actuator`) não respondidas com 5xx |
| SLO | 99,5% em 28 dias |
| Orçamento de erros | 0,5% → ≈ 202 min de queda total a cada 28 dias |
| Taxa de queima | fração de erros / 0,005 (1 = exatamente no orçamento) |

---

## Múltiplas janelas, múltiplas taxas de queima

| Severidade | Taxa | Longa | Curta | Orçamento gasto |
|---|---|---|---|---|
| page | 14,4 | 1 h | 5 min | ≈ 2,1% |
| page / ticket | 6 | 6 h | 30 min | ≈ 5,4% |
| ticket | 1 | 3 dias | 6 h | ≈ 10,7% |

- Janela **longa**: o problema é significativo, não um soluço.
- Janela **curta**: ainda está acontecendo → resolve logo depois da correção.
- Como código: `infra/grafana/alerting/slo-catalog.yaml` (consultas A, B + matemática `$A > 14.4 && $B > 14.4`).

---

## Dispare-o

<div class="q">

Tráfego constante, uma hora saudável, depois `docker compose stop db`. Quando a regra de queima rápida aciona?

</div>

* A fração de erros da última hora precisa chegar a 14,4 × 0,5% = **7,2%**.
* 0,072 × 60 min ≈ **4,3 min** de queda, + `for: 1m` + avaliação ≈ **5–6 min**.
* Um soluço de 30 segundos nunca aciona; um vazamento lento de 4% é pego pela regra de 6 horas.
* Execução de teste: *Firing* **cerca de 440 s** depois do stop — o teste de estresse do passo 2 ainda estava na janela de 1 hora.
* `start db`: o page some **cerca de 5 min depois**, quando a queda sai da janela de 5 minutos.

---

## Sem Docker: repita-o

<div class="flow">
<div class="box red">10:12:31<small>stop db</small></div><div class="arrow">→</div>
<div class="box orange">taxa de queima de 5 min: 200<small>em um minuto</small></div><div class="arrow">→</div>
<div class="box orange">taxa de queima de 1 h &gt; 14,4<small>após 4,3 min</small></div><div class="arrow">→</div>
<div class="box red">Pending → Firing<small>for: 1m → 5:30</small></div><div class="arrow">→</div>
<div class="box green">start db → Normal<small>5:00 depois</small></div>
</div>

- O simulador do passo de SLO: `slo-catalog.yaml` avaliado a cada 30 s, k6 a 50 req/s, um tick = 10 s.
- Com o teste de estresse do passo 2 na janela → **7:30**, "Burn rate 17.0 (1 h) and 200.0 (5 min)"; 10 min de histórico → **2:00**.
- 4% de erros nunca acionam; o ticket de 6 horas dispara após **3,1 h**.

---

<!-- _class: tight -->

## Passo 4 · Meça

| # | Experimento | Registrar |
|---|---|---|
| A | agente ligado vs desligado (`OTEL_ON`) | p50 / p95 / p99, CPU, memória, inicialização |
| B | amostragem 100% vs 10% (`parentbased_traceidratio`) | p95, traces por minuto |
| C | cardinalidade | séries por serviço, o custo de um label `user_id` |
| D | tempo de detecção | parar `db` → Pending → Firing |

<p class="small">k6 <code>constant-arrival-rate</code> em <code>GET /catalog/events/{id}</code> pela borda; <code>docker stats</code> durante a execução.</p>

---

## Armadilhas

- **O contexto quebra em saltos assíncronos**: leve o `traceparent` em mensagens e linhas.
- **Labels ilimitados** (ids, URLs, e-mails) explodem o número de séries.
- **Sem tráfego, sem SLI**: combine alertas de SLO com uma sonda ou um alerta de "tráfego caiu".
- ***Health checks* no SLI** escondem falhas reais.
- **Amostragem** vale para traces, não para métricas: as taxas vêm das métricas.

---

## Experimente no playground

- `observability-stack` com o perfil `chaos`.
- Desconecte as métricas de um serviço: a utilização dele vira "?".
- O que reage primeiro a uma falha: erros, percentis ou *health checks*?
- `boxoffice-observability`: o banco do `catalog` para por 100 s; só o Alerting encurta a queda.

<div class="ok">

Você não conserta o que não mede — e não mede o que não instrumentou.

</div>

---

## Pontos-chave

1. **Métricas** dizem que, **traces** dizem onde, **logs** dizem por quê — ligados pelo `trace_id`.
2. O **agente Java** instrumenta HTTP, JDBC, Kafka e logs sem código; o OTLP é o contrato.
3. Saltos assíncronos (outbox, filas) precisam do **`traceparent` levado com o dado**.
4. Dashboards e alertas são **código** no repositório.
5. Alerte pela **taxa de queima do SLO** em duas janelas, não por limiares crus.
6. Observabilidade tem **custo** — meça e amostre traces, não métricas.
