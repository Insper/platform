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

<div class="kicker">Arquitetura de Sistemas · Insper</div>

# Hands-on 8 — Observabilidade

**OpenTelemetry, um dashboard RED, um trace atravessando o Kafka e um SLO que aciona na hora certa**

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
- **Métricas**: *que* algo está errado, e quanto.
- **Traces**: *onde* o tempo foi gasto, requisição por requisição.
- **Logs**: *por quê*, quando você já sabe onde olhar.

---

## Arquitetura

- Todo serviço Java roda o **agente Java do OpenTelemetry**.
- Ele envia **OTLP** para o `otel-lgtm` (porta 4318).
- Dentro: **Collector** do OTel → **Prometheus** (métricas), **Tempo** (traces), **Loki** (logs).
- O **Grafana** (porta 3000) os liga: exemplar → trace → logs.

<div class="ok">

Backend de desenvolvimento em uma imagem; produção o troca por sistemas separados — os serviços continuam falando OTLP.

</div>

---

## Passo 1 · O agente: um jar, nenhum código

```shell
sh scripts/get-otel-agent.sh      # downloads infra/otel/opentelemetry-javaagent.jar (v2.32.0)
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

- O outbox é uma **linha do banco** lida por outra thread: o contexto da requisição não foi guardado.
- Correção: salvar o **`traceparent`** W3C da requisição na linha (`V2__outbox_traceparent.sql`).
- O relay torna esse contexto atual antes do `kafka.send` → o agente injeta o **mesmo** trace id.
- Resultado: um trace, com o atraso do relay visível como um intervalo.

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
| SLI | fração das requisições (sem `/actuator`) não respondidas com 5xx |
| SLO | 99,5% em 28 dias |
| Orçamento de erros | 0,5% → ≈ 202 min de queda total a cada 28 dias |
| Taxa de queima | fração de erros / 0,005 (1 = exatamente no orçamento) |

---

## Múltiplas janelas, múltiplas taxas de queima

| Severidade | Taxa | Longa | Curta | Orçamento gasto |
|---|---|---|---|---|
| página | 14,4 | 1 h | 5 min | ≈ 2,1% |
| página / ticket | 6 | 6 h | 30 min | ≈ 5,4% |
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
6. Observabilidade tem **custo** — meça, e amostre traces, não métricas.
