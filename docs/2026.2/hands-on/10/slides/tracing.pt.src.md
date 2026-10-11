---
marp: true
lang: pt-BR
title: Hands-on 10 — Rastreamento distribuído
description: Plataformas, Microsserviços, DevOps e APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Plataformas, Microsserviços, DevOps e APIs · Hands-on 10</div>

# Hands-on 10 — Rastreamento distribuído

**Uma requisição, um trace ID, cada salto medido**

<!--
Roteiro: (1) por que métricas não localizam um salto lento; (2) Jaeger + agente Java do OpenTelemetry;
(3) propagação do traceparent e amostragem; (4) trace IDs nos logs; (5) lendo traces no Jaeger;
(6) spans personalizados.
-->

---

## Para onde foi o tempo?

<div class="q">

`POST /orders` leva **2 340 ms**. O Prometheus mostra `http_server_requests_seconds` alto no gateway.
O gateway chama o OrderService, que chama o ProductService, que consulta o banco de dados.
**Qual salto está lento?**

</div>

* Métricas respondem **quanto** e **com que frequência** — não **onde**, numa cadeia de vários saltos.
* Sem rastreamento: ler os logs de quatro serviços e **chutar**.
* Com rastreamento: cada salto é um **span**, todos compartilham um **trace ID** → o span lento aparece.

<!--
Deixe a turma propor como encontraria isso hoje. A resposta na página: o span jdbc.query
dentro do ProductService levou 2 180 ms dos 2 340 ms.
-->

---

## O objetivo

Instrumentar todos os serviços Spring Boot com **OpenTelemetry** para que uma requisição por
**Gateway → OrderService → ProductService** produza **um trace** no **Jaeger**, com o trace ID em cada linha de log.

| Componente | Papel |
|---|---|
| **Agente Java do OTel** | instrumenta Spring MVC, WebClient, RestTemplate, JDBC — **sem mudar código** |
| **Jaeger** `all-in-one` | coletor + mecanismo de consulta + UI |
| `:4317` / `:4318` | receptor OTLP — gRPC / HTTP |
| `:16686` | UI do Jaeger |
| Prometheus + Grafana | continuam cuidando das **métricas**, como antes |

---

## O vocabulário

| Termo | O que é |
|---|---|
| **Span** | uma operação cronometrada — uma chamada HTTP, uma query, uma etapa de negócio |
| **Trace** | todos os spans de uma requisição, agrupados por um **trace ID** comum |
| **Pai / filho** | cada span aponta para o span que o chamou |
| **`traceparent`** | cabeçalho W3C que leva o contexto ao próximo serviço |
| **OTLP** | o protocolo que o agente usa para exportar os spans |
| **Flame chart** | visão do Jaeger: uma barra por span, largura = duração |

---

## Passo 1 — Jaeger no `compose.yaml`

```yaml
  jaeger:
    image: jaegertracing/all-in-one:1.57
    container_name: jaeger
    environment:
      COLLECTOR_OTLP_ENABLED: "true"
    ports:
      - "16686:16686"   # Jaeger UI
      - "4317:4317"     # OTLP gRPC receiver
      - "4318:4318"     # OTLP HTTP receiver
    networks:
      - store-net
```

<p class="small">O all-in-one basta para o desenvolvimento local; em produção, coletor, consulta e UI rodam separados.</p>

---

## Passo 2 — Acople o agente no Dockerfile

```dockerfile
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
ADD https://github.com/open-telemetry/opentelemetry-java-instrumentation/\
releases/download/v2.4.0/opentelemetry-javaagent.jar \
    /app/opentelemetry-javaagent.jar
COPY target/*.jar app.jar
ENTRYPOINT ["java", \
  "-javaagent:/app/opentelemetry-javaagent.jar", \
  "-jar", "/app/app.jar"]
```

<div class="warn">

**Fixe a versão do agente**: a v2.4.0 funciona com o Spring Boot 3.x — consulte a matriz de compatibilidade antes de atualizar qualquer um dos dois.

</div>

---

## Passo 3 — Configure com variáveis de ambiente

```yaml
  order:
    build: ./order-service
    environment:
      OTEL_SERVICE_NAME: order-service
      OTEL_EXPORTER_OTLP_ENDPOINT: http://jaeger:4317
      OTEL_METRICS_EXPORTER: none
      OTEL_LOGS_EXPORTER: none
      OTEL_PROPAGATORS: tracecontext,baggage
```

- O mesmo bloco para `gateway-service`, `product-service` e `account-service` — só muda o **nome**.
- `OTEL_METRICS_EXPORTER: none`: Prometheus/Micrometer já coletam as métricas — evite **duplicatas**.

---

## Como a propagação funciona

```text
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
             │  │                                │                └ 01 = sampled
             │  │                                └ 16-char parent span ID
             │  └ 32-char trace ID — identical on every hop
             └ version (always 00)
```

1. O agente do gateway inicia o **span raiz** (`spanId=aaa1`).
2. A chamada de saída leva `traceparent: 00-4bf9…-aaa1-01`.
3. O agente do Order o lê → **span filho** `bbb2`, pai `aaa1`; e assim até o Product (`ccc3`).
4. Cada span **termina** e é **exportado** para o Jaeger, que os agrupa pelo trace ID.

---

## Amostragem

- O sampler padrão exporta **100%** dos traces — ok para o laboratório.
- Em produção, amostre uma fração das requisições:

```yaml
OTEL_TRACES_SAMPLER: parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG: "0.1"   # 10% of requests
```

<div class="ok">

**Parent-based**: a decisão é tomada uma vez, na raiz, e viaja na flag `01`/`00` — um trace nunca é amostrado pela metade.

</div>

---

<!-- _class: tight -->

## Passo 4 — Trace IDs nos logs

O agente grava `trace_id` e `span_id` no **MDC** do SLF4J. Adicione `opentelemetry-logback-appender-1.0` (`2.4.0-alpha`, `runtime`) e imprima-os no `logback-spring.xml`:

```xml
<pattern>
    %d{HH:mm:ss.SSS} [%thread] %-5level %logger{36}
    [trace_id=%X{trace_id} span_id=%X{span_id}] - %msg%n
</pattern>
```

```text
14:23:01.442 [http-nio-8080-exec-3] INFO  c.example.order.OrderService
    [trace_id=4bf92f3577b34da6a3ce929d0e0e4736 span_id=00f067aa0ba902b7]
    - creating order for account 42
```

<p class="small">Fluxo: trace lento no Jaeger → copie o <code>trace_id</code> → busque-o no agregador de logs → todas as linhas de log daquela requisição.</p>

---

## Passo 5 — Rode e encontre um trace

```bash
docker compose up -d --build
docker compose ps jaeger
curl -s -X POST http://localhost:8080/orders \
  -H "Content-Type: application/json" \
  -d '{"accountId": 1, "productId": 7, "quantity": 2}' | jq
```

1. Abra `http://localhost:16686` e escolha `gateway-service` em **Service**.
2. Deixe Operation como `all` → **Find Traces**.
3. Clique em um trace para abrir o **flame chart**.

---

## Lendo o flame chart

- Span raiz (gateway) no topo, filhos **recuados** abaixo; **largura da barra = duração**.
- Um span quase tão largo quanto a raiz é o **principal responsável pela latência**.
- Spans `SELECT` / `jdbc.query` → queries lentas; `HTTP GET` / `HTTP POST` → chamadas de saída.
- Um `!` vermelho marca uma **exceção** — o stack trace vem anexado como evento do span.

| Tag (definida pelo agente) | Exemplo |
|---|---|
| `http.method` / `http.status_code` | `POST` / `200` |
| `http.url` | `http://order:8080/orders` |
| `db.system` / `db.statement` | `postgresql` / `SELECT * FROM products WHERE id = ?` |

---

<!-- _class: tight -->

## Passo 6 — Spans personalizados para a lógica de negócio

O agente conhece o framework, não as suas **etapas de negócio**. Adicione `io.opentelemetry:opentelemetry-api` (versão do BOM do Spring Boot):

```java
Span span = tracer.spanBuilder("validateOrder").startSpan();
try (Scope scope = span.makeCurrent()) {
    span.setAttribute("order.account_id", orderIn.getAccountId());
    validateAccount(orderIn.getAccountId());
    checkInventory(orderIn.getProductId(), orderIn.getQuantity());
} catch (Exception e) {
    span.recordException(e);
    throw e;
} finally {
    span.end();
}
```

<p class="small">Vale a pena para etapas acima de ~50 ms, atributos de negócio (<code>order.id</code>, <code>account.tier</code>) ou exceções capturadas — não para getters triviais.</p>

---

## Armadilhas comuns

<div class="warn">

Um span manual sem `span.end()` em um `finally` **nunca é exportado** para o Jaeger.

</div>

- Versões do agente e do Spring Boot **incompatíveis** → instrumentação ausente ou quebrada.
- `OTEL_METRICS_EXPORTER` deixado no padrão → métricas exportadas **duas vezes**.
- `OTEL_EXPORTER_OTLP_ENDPOINT` errado (ex.: `localhost` dentro de um container) → nenhum trace chega; use `http://jaeger:4317`.
- Sem `OTEL_SERVICE_NAME` → fica difícil distinguir os serviços no menu.
- Spans manuais em tudo → **ruído** que esconde os dados úteis.

<!--
O ponto localhost vs. nome do serviço é um erro bem conhecido no Compose, não citado literalmente na página.
-->

---

## Pontos-chave

1. Métricas dizem **quanto**; um trace diz **onde** foi o tempo numa requisição de vários saltos.
2. Um **trace** reúne os **spans** de um mesmo **trace ID**; o span lento se destaca no flame chart.
3. O **agente Java do OTel** (`-javaagent`) instrumenta HTTP e JDBC **sem mudar código**, configurado por variáveis `OTEL_*`.
4. O contexto viaja no cabeçalho W3C **`traceparent`**; o Jaeger agrupa os spans exportados.
5. Coloque `trace_id` / `span_id` nos **logs** para saltar de um trace para suas linhas de log.
6. **Spans personalizados** para etapas de negócio — sempre com `end()` no `finally`.
7. Verifique: ≥ 3 spans para `POST /orders` (gateway, order, product), com `trace_id` correspondente nos logs.
