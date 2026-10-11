---
marp: true
lang: pt-BR
title: Observabilidade
description: Plataformas, Microsserviços, DevOps e APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Plataformas, Microsserviços, DevOps e APIs · Insper</div>

# Observabilidade

**O monitoramento diz que algo está errado; a observabilidade diz por quê**

<!--
Roteiro: (1) os três pilares; (2) métricas: Prometheus, PromQL, RED/USE; (3) logs estruturados e
correlation IDs; (4) alertas e cardinalidade; (5) traces, traceparent, amostragem; (6) OpenTelemetry;
(7) LGTM e DORA.
-->

---

## Uma requisição lenta

<div class="q">

Uma requisição passa por **oito serviços e três bancos de dados**, e está lenta.
Um único gráfico de CPU em um único dashboard consegue dizer por quê?

</div>

* Não: você precisa **seguir aquela requisição** por todos os saltos.
* O monitoramento responde a perguntas **predefinidas**: "a taxa de erros está abaixo de 1%?"
* A observabilidade permite fazer perguntas **em que você não pensou** no projeto.
* É uma propriedade do sistema: o estado interno **inferível a partir das saídas externas**.

<!--
Exemplo da página: "por que exatamente 7% das requisições de clientes móveis em São Paulo estão
dando timeout numa terça-feira?" — nenhum dashboard foi construído para essa pergunta.
-->

---

## Os três pilares

| Pilar | Responde | Ferramentas | Retenção |
|---|---|---|---|
| **Métricas** | Está saudável agora? Tendência de alta ou de queda? | Prometheus → Grafana | semanas a meses |
| **Logs** | O que exatamente aconteceu, em que ordem? | ELK / EFK / Loki | dias a semanas |
| **Traces** | Qual serviço foi lento? Onde o erro começou? | Jaeger / Tempo / Zipkin | dias |

<div class="ok">

Cada pilar responde a uma pergunta diferente; a observabilidade precisa dos **três funcionando juntos**.

</div>

---

## Métricas: o modelo do Prometheus

Uma série temporal = nome da métrica + **labels** chave-valor:

```text
http_requests_total{method="GET", status="200", service="order"} 4823
```

| Tipo | Mede | Exemplo |
|---|---|---|
| **Counter** | só cresce | `http_requests_total` |
| **Gauge** | sobe ou desce | `memory_bytes`, `active_connections` |
| **Histogram** | distribuição em buckets | `http_request_duration_seconds{le="0.1"}` |
| **Summary** | quantis pré-calculados | `…{quantile="0.99"}` |

---

## PromQL, RED e USE

<!-- _class: tight -->

| Consulta (métrica do Spring Boot `http_server_requests_seconds`) | Significado |
|---|---|
| `rate(…_count[5m])` | requisições por segundo em 5 minutos |
| `sum by (application) (rate(…_count{status=~"5.."}[5m]))` | erros 5xx por segundo, por serviço |
| `histogram_quantile(0.99, sum by (le) (rate(…_bucket[5m])))` | latência P99 entre instâncias |

- **RED** (Tom Wilkie) — serviços: **R**ate, **E**rrors, **D**uration → o que os usuários experimentam.
- **USE** (Brendan Gregg) — recursos: **U**tilisation, **S**aturation, **E**rrors.
- Os **quatro golden signals** do Google: latência, tráfego, erros, saturação.

<p class="small"><code>rate()</code> antes do <code>sum</code>; mantenha o <code>le</code> para percentis. Percentis, nunca médias: o P99 mostra a cauda lenta.</p>

---

## O pipeline de métricas

O Spring Boot (Actuator + Micrometer) expõe `/actuator/prometheus` → o Prometheus **coleta a cada 15 s** → o Grafana consulta com PromQL (dashboards + alertas).

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,prometheus
  metrics:
    tags:
      application: ${spring.application.name}
```

<p class="small">Modelo pull: a aplicação só expõe o endpoint; o Prometheus busca. Requer <code>micrometer-registry-prometheus</code>.</p>

---

## Alertas e cardinalidade

```yaml
- alert: OrderHighErrorRatio
  expr: |
    sum(rate(http_server_requests_seconds_count{application="order", status=~"5.."}[5m]))
    / sum(rate(http_server_requests_seconds_count{application="order"}[5m])) > 0.05
  for: 5m
  labels: { severity: page }
```

- **Alerte sobre sintomas** que os usuários sentem (erros, latência, consumo do SLO) — não sobre "CPU > 80%".

<div class="warn">

Nunca use **IDs de usuário ou de pedido** como label: cada valor é uma nova série — 100 mil usuários × 10 URIs × 5 status = 5 milhões. Coloque-os em logs e traces.

</div>

---

## Logs: estruturados, com níveis

| | Não estruturado | Estruturado (JSON) |
|---|---|---|
| Exemplo | `ERROR Order 42 failed` | `{"level":"ERROR","orderId":42,"traceId":"abc123"}` |
| Busca | grep / regex | consultas por campo |
| Agregação | difícil | fácil (Kibana, Loki) |

- `TRACE` / `DEBUG` — diagnóstico; **nunca em produção** / só em dev e staging.
- `INFO` — eventos significativos · `WARN` — inesperado, mas tratado (retry, fallback).
- `ERROR` — falha que exige atenção.

---

<!-- _class: tight -->

## Correlation IDs

O **MDC** é um mapa por thread impresso em cada linha de log com `%X{key}`.

- Com o **agente Java do OTel**, `trace_id` e `span_id` chegam ao MDC **sozinhos** — sem código:

```text
%d{ISO8601} %-5level [trace_id=%X{trace_id} span_id=%X{span_id}] - %msg%n
```

- `MDC.put` só para **suas chaves de negócio** — e sempre remova (as threads são reusadas):

```java
try (var c = MDC.putCloseable("customerId", in.customerId())) { … }
```

<p class="small">Pipeline: JSON no <b>stdout</b> → Filebeat / Fluentd → Elasticsearch → Kibana; ou <b>Loki</b> (só labels, mais barato, no Grafana).</p>

---

## Traces e spans

Um **trace** é uma requisição de ponta a ponta; ele é feito de **spans**, um por operação.

- Cada span: `traceId`, `spanId`, `parentSpanId`, `name`, início/duração, `status`, `attributes`.
- O contexto atravessa os serviços no cabeçalho W3C **`traceparent`**:

```text
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

<p class="small">version · traceId (128 bits) · parentSpanId (64 bits) · flags (<code>01</code> = amostrado). Cada salto mantém o traceId e troca o parentSpanId pelo ID do próprio span.</p>

`User → Gateway (120 ms) → OrderService (95 ms) → PostgreSQL (40 ms)`

---

## Amostragem

| Estratégia | Como | Trade-off |
|---|---|---|
| **Head** | decidida no primeiro span, viaja nas `flags` | barata — mas cega: descarta também erros raros |
| **Tail** | o Collector decide após o trace terminar | mantém erros / traces lentos — guarda todos os spans |
| **Rate-limiting** | no máximo N traces por segundo | custo previsível |

<div class="warn">

Um trace descartado no **head** nunca chega ao Collector: uma regra de tail não consegue resgatá-lo.

</div>

<div class="ok">

Para manter todo erro: **100% no head** + uma **política de tail** que mantém todos os traces ERROR/lentos e 1–10% do resto.

</div>

---

## OpenTelemetry

O padrão da CNCF para gerar, coletar e exportar telemetria — uma API neutra; trocar de backend é uma mudança de **configuração**, não de código.

| Componente | Papel |
|---|---|
| **API** | interfaces: Tracer, Meter, Logger |
| **SDK** | implementação: amostragem, lotes, exporters |
| **Collector** | processo independente: recebe, processa, exporta |
| **Exporter** | envia os dados: **OTLP** (gRPC 4317 / HTTP 4318), Zipkin, Prometheus |

`Application (OTel SDK) → OTLP → OTel Collector → Prometheus · Jaeger · Loki`

---

## Instrumentação sem código

O agente Java do OTel instrumenta o Spring Boot por **injeção de bytecode**:

```dockerfile
ENTRYPOINT ["java", \
  "-javaagent:/app/opentelemetry-javaagent.jar", \
  "-jar", "/app/app.jar"]
```

```yaml
environment:
  OTEL_SERVICE_NAME: order-service
  OTEL_EXPORTER_OTLP_PROTOCOL: grpc   # agent 2.x default: http/protobuf on 4318
  OTEL_EXPORTER_OTLP_ENDPOINT: http://jaeger:4317
  OTEL_METRICS_EXPORTER: none
  OTEL_LOGS_EXPORTER: none
```

<p class="small">Exporters de métricas e logs desligados: o Prometheus já coleta o Actuator e o Loki/ELK cuida dos logs. Protocolo e porta precisam combinar.</p>

---

## Spans manuais

O mais simples: `@WithSpan("calculateTotal")` em um método. Controle total (`opentelemetry-api`):

```java
Tracer tracer = GlobalOpenTelemetry.getTracer("store.order");
Span span = tracer.spanBuilder("processOrder").startSpan();
try (Scope scope = span.makeCurrent()) {
    span.setAttribute("order.customerId", request.customerId());
    // ... business logic
} catch (Exception e) {
    span.recordException(e);
    span.setStatus(StatusCode.ERROR, e.getMessage());
    throw e;
} finally {
    span.end();
}
```

<!--
Destaque o finally { span.end(); }: um span que nunca é encerrado nunca é exportado.
-->

---

## Uma só interface: LGTM, e DORA

**Loki + Grafana + Tempo + Mimir/Prometheus** — todos os sinais no Grafana. Investigação: alerta de métrica → "View Traces" no Tempo → clique em um span → suas linhas de log no Loki.

| Métrica DORA | Mede | Elite (2024) |
|---|---|---|
| Deployment Frequency | com que frequência o código chega à produção | sob demanda |
| Change Lead Time | do commit à produção | < 1 dia |
| Change Failure Rate | % de deploys que exigem correção ou rollback | ~5% |
| Failed Deployment Recovery Time | tempo de recuperação (antes MTTR) | < 1 hora |

<p class="small">As métricas DORA também são telemetria: não dá para medi-las sem observabilidade.</p>

---

## Pontos-chave

1. O monitoramento diz **que** algo está errado; a observabilidade permite perguntar **por quê**.
2. Três pilares: **métricas** (saúde), **logs** (o que aconteceu), **traces** (onde).
3. O Prometheus coleta `/actuator/prometheus`; **PromQL**, **RED**/**USE**, labels de baixa cardinalidade, alertas sobre **sintomas**.
4. Os logs devem ser **estruturados** e carregar o `trace_id` — o agente do OTel preenche o MDC para você.
5. Um trace é uma árvore de **spans**; o `traceparent` carrega o contexto; head sampling é cego, tail sampling é seletivo.
6. O **OpenTelemetry** é o padrão neutro em relação a fornecedores; o agente Java exige **zero código**.
7. Correlacione os sinais em um só lugar (**LGTM**) — e meça a entrega com **DORA**.
