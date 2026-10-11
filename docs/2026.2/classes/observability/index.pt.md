# Observabilidade

Um sistema que você não consegue observar é um sistema que você não consegue operar. O monitoramento diz que algo está errado; a observabilidade diz *por quê*. A distinção importa em microsserviços: uma requisição que passa por oito serviços e três bancos de dados não pode ser diagnosticada a partir de uma única métrica em um único dashboard. Observabilidade é a propriedade de um sistema que permite inferir seu estado interno a partir de suas saídas externas.

Imagine um cliente reclamando que "o checkout está lento" na loja. A requisição passou pelo Nginx, pelo gateway, pela verificação de autenticação, pelo serviço de pedidos, pelo serviço de produtos e pelo Postgres, e talvez tenha publicado um evento no Kafka. Qual deles foi lento? Foi lento para todo mundo ou só para esse cliente? Sem telemetria projetada de antemão — números, registros e caminhos de requisição emitidos por cada serviço —, a única resposta é chutar.

!!! abstract "Objetivos de aprendizagem"

    Ao final desta aula, você deve ser capaz de:

    - **Explicar** a diferença entre monitoramento e observabilidade, e qual pergunta cada pilar (métricas, logs, traces) responde.
    - **Escrever** consultas PromQL para a taxa de requisições, a proporção de erros e os percentis de latência de um serviço Spring Boot, e **construir** dashboards RED / USE.
    - **Configurar** logs estruturados que carregam o trace ID e **correlacionar** uma linha de log com seu trace.
    - **Explicar** como o contexto de rastreamento atravessa os serviços com o cabeçalho W3C `traceparent` e **escolher** uma estratégia de amostragem.
    - **Instrumentar** um serviço Spring Boot com OpenTelemetry (agente Java e spans manuais) e **projetar** alertas baseados em sintomas.

## Slides

<div class="slides-embed">
  <iframe src="slides/observability.pt.html" title="Slides: observabilidade" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/observability.pt.html){:target="_blank"}

---

## Os três pilares

A observabilidade se apoia em três tipos de dados complementares. Cada um responde a uma pergunta diferente sobre o comportamento do sistema.

| Pilar | Responde | Ferramentas | Retenção |
|---|---|---|---|
| **Métricas** | O sistema está saudável agora? A tendência é de alta ou de queda? | Prometheus → Grafana | Semanas a meses (agregadas) |
| **Logs** | O que exatamente aconteceu, e em que sequência? | ELK / EFK / Loki | Dias a semanas |
| **Traces** | Qual serviço desta requisição foi lento? Onde o erro se originou? | Jaeger / Tempo / Zipkin | Dias |

Os três descrevem os mesmos eventos sob ângulos diferentes. Um `POST /orders` que falha produz: um incremento de um contador `http_server_requests_seconds_count{status="500"}` (métrica), uma linha JSON `{"level":"ERROR","msg":"product not found",...}` (log) e um trace com um span por salto, o último marcado como `ERROR` (trace). Métricas são baratas e dizem *que* algo mudou; logs e traces são mais caros e dizem *o quê* e *onde*.

!!! info "Observabilidade ≠ Monitoramento"
    O monitoramento faz perguntas predefinidas: "A taxa de erros está abaixo de 1%?" A observabilidade permite fazer perguntas em que você não pensou na fase de projeto: "Por que exatamente 7% das requisições de clientes móveis em São Paulo estão dando timeout numa terça-feira?" A observabilidade exige os três pilares funcionando juntos[^2].

---

## Métricas

### Modelo de dados do Prometheus

Toda série temporal tem um nome de métrica e um conjunto de labels chave-valor:

```
http_requests_total{method="GET", status="200", service="order"} 4823
```

| Tipo | O que mede | Exemplo |
|---|---|---|
| **Counter** | Valor monotonicamente crescente; nunca diminui | `http_requests_total`, `errors_total` |
| **Gauge** | Valor atual, que pode subir ou descer | `memory_bytes`, `active_connections` |
| **Histogram** | Distribuição de valores em buckets configuráveis | `http_request_duration_seconds{le="0.1"}` |
| **Summary** | Quantis pré-calculados (menos flexível que o histogram) | `http_request_duration_seconds{quantile="0.99"}` |

Um **label** é uma dimensão da série: cada combinação distinta de valores de labels é uma série temporal separada armazenada pelo Prometheus.

### Noções básicas de PromQL

PromQL é a linguagem de consulta do Prometheus. As consultas abaixo usam a métrica que o Spring Boot (Micrometer) exporta para cada endpoint HTTP, `http_server_requests_seconds`, com os labels `application`, `uri`, `method` e `status`:

| Consulta | Significado |
|---|---|
| `rate(http_server_requests_seconds_count[5m])` | Requisições por segundo, em média nos últimos 5 minutos |
| `sum by (application) (rate(http_server_requests_seconds_count{status=~"5.."}[5m]))` | Erros 5xx por segundo, por serviço |
| `sum(rate(http_server_requests_seconds_count{status=~"5.."}[5m])) / sum(rate(http_server_requests_seconds_count[5m]))` | **Proporção** de erros (0–1) — a base de um SLI de disponibilidade |
| `histogram_quantile(0.99, sum by (le) (rate(http_server_requests_seconds_bucket[5m])))` | Latência P99 considerando todas as instâncias |
| `increase(http_server_requests_seconds_count[1h])` | Total de requisições na última hora |

Duas regras: aplique `rate()` ou `increase()` a um counter **antes** de somar (essas funções tratam os zeramentos do contador quando um pod reinicia) e mantenha o label `le` ao somar os buckets de um histogram (`sum by (le)`), porque o `histogram_quantile` precisa dele. As séries `_bucket` só existem se os histogramas estiverem habilitados: `management.metrics.distribution.percentiles-histogram.http.server.requests=true`.

!!! info "Por que percentis, e não médias"
    Se 99 requisições levam 50 ms e 1 leva 5 s, a média é ~100 ms — parece ótimo, mas um em cada cem usuários espera 5 segundos. O P99 (o valor abaixo do qual estão 99% das requisições) expõe essa cauda; com muitas chamadas por página, a maioria dos usuários cai na cauda em algum momento.

### RED, USE e os Golden Signals

| Método | Para | Métricas |
|---|---|---|
| **RED** (Tom Wilkie) | Serviços / APIs | **R**ate (requisições/s), **E**rrors (taxa de erros), **D**uration (percentis de latência) |
| **USE** (Brendan Gregg) | Infraestrutura / Recursos | **U**tilisation (% ocupado), **S**aturation (tamanho da fila), **E**rrors |
| **Quatro golden signals** (Google SRE[^1]) | Qualquer sistema voltado ao usuário | Latência, Tráfego, Erros, Saturação |

!!! tip "Qual método usar?"
    Use RED para dashboards no nível do serviço (o que os usuários experimentam) e USE para dashboards de infraestrutura (o que os recursos experimentam). Os dois juntos dão cobertura completa.

### Pipeline de métricas

``` mermaid-sim
flowchart LR
    app["Spring Boot\n(Actuator + Micrometer)"]
    prom["Prometheus"]
    grafana["Grafana\n(dashboards + alertas)"]
    prom -->|"coleta /actuator/prometheus (ex.: a cada 15 s)"| app
    prom -->|"consultas PromQL"| grafana
```

O Prometheus usa um modelo **pull**: a aplicação apenas expõe seus valores atuais em um endpoint HTTP, e o Prometheus os busca (faz o *scrape*) periodicamente e os armazena como séries temporais. É isso que o [Hands-on 6](../../hands-on/6/index.md) configura para a loja.

Configuração do Spring Boot Actuator para expor o endpoint do Prometheus (também é necessária a dependência `io.micrometer:micrometer-registry-prometheus`):

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

!!! warning "Cardinalidade de labels"
    Nunca coloque valores ilimitados — ID de usuário, ID de pedido, e-mail, URL completa com IDs — em um label de métrica. Cada valor distinto cria uma nova série temporal; 100.000 usuários × 10 endpoints × 5 códigos de status são 5 milhões de séries, e o Prometheus fica sem memória. Detalhes de alta cardinalidade pertencem a **logs e traces**. (É por isso que o Spring Boot usa o *template* da URI, `/orders/{id}`, como label `uri`, e não `/orders/42`.)

### Alertas

Dashboards precisam de alguém olhando para eles; **alertas** notificam uma pessoa quando é preciso agir. O Prometheus avalia regras de alerta e envia os alertas disparados ao Alertmanager (ou ao Grafana Alerting), que os encaminha para e-mail, Slack ou um pager.

```yaml
groups:
  - name: order-service
    rules:
      - alert: OrderHighErrorRatio
        expr: |
          sum(rate(http_server_requests_seconds_count{application="order", status=~"5.."}[5m]))
          /
          sum(rate(http_server_requests_seconds_count{application="order"}[5m])) > 0.05
        for: 5m                     # must hold for 5 minutes, avoids flapping
        labels:
          severity: page
        annotations:
          summary: "More than 5% of order requests are failing"
```

!!! tip "Alerte sobre sintomas, não sobre causas"
    Acione pessoas pelo que os usuários sentem — proporção de erros, latência, um error budget de SLO sendo consumido rápido (veja [SLI / SLO / SLA](../reliability/sli-slo-sla/index.md)) — e não por "CPU acima de 80%". CPU alta com usuários satisfeitos não é emergência; um alerta que dispara sem exigir ação ensina as pessoas a ignorar alertas.

---

## Logs

### Estruturados vs não estruturados

| | Não estruturado | Estruturado (JSON) |
|---|---|---|
| Exemplo | `2024-01-15 ERROR Order 42 failed` | `{"level":"ERROR","orderId":42,"msg":"failed","traceId":"abc123"}` |
| Pesquisável | Só com grep / regex | Consultas completas por campo |
| Agregável | Difícil | Fácil (Kibana, Loki) |
| Processável por máquina | Frágil | Confiável |

### Níveis de log

| Nível | Uso |
|---|---|
| TRACE | Extremamente detalhado — cada entrada/saída de método. Nunca em produção. |
| DEBUG | Diagnóstico — valores de variáveis, pontos de decisão. Só em dev/staging. |
| INFO | Eventos significativos — inicialização, configuração carregada, requisição recebida |
| WARN | Algo inesperado, mas tratado — retry disparado, fallback usado |
| ERROR | Falha que exige atenção — exceção capturada, downstream inacessível |

### Correlation IDs e MDC

Quando uma requisição passa por vários serviços, um ID compartilhado em todas as linhas de log — um **correlation ID** — permite reconstruir a sequência completa de chamadas buscando por esse único valor. Com rastreamento distribuído, o correlation ID natural é o **trace ID**.

Em Java, o lugar para colocá-lo é o **MDC** (Mapped Diagnostic Context) do SLF4J/Logback: um mapa de pares chave-valor por thread que o framework de logging pode imprimir em todas as linhas com `%X{key}`. Quem preenche o MDC depende de como o serviço é instrumentado:

=== "Agente Java do OpenTelemetry (automático)"

    Com o agente Java do OTel anexado (veja [abaixo](#java-zero-code-instrumentation) e o [Hands-on 10](../../hands-on/10/index.md)), você **não escreve nenhum código de MDC** para o contexto de rastreamento. A instrumentação de Logback/Log4j do agente coloca `trace_id`, `span_id` e `trace_flags` ativos no MDC sempre que há um span corrente, e os remove em seguida. Você só referencia as chaves no padrão:

    ```
    %d{ISO8601} [%thread] %-5level %logger{36} [trace_id=%X{trace_id} span_id=%X{span_id}] - %msg%n
    ```

    Sem o agente, as mesmas chaves podem ser preenchidas pela biblioteca `opentelemetry-logback-mdc-1.0`; o próprio Micrometer Tracing do Spring Boot preenche, em vez delas, as chaves `traceId` e `spanId`. Use os nomes de chave da ferramenta que você de fato executa.

=== "MDC manual (suas próprias chaves)"

    `MDC.put` serve para **contexto de negócio** que nenhuma ferramenta tem como conhecer — o ID do cliente, o ID do pedido — ou para um correlation ID quando não há rastreamento nenhum. Sempre remova o que você colocou: as threads são reaproveitadas pelo pool do servidor, e uma chave esquecida vaza para os logs da próxima requisição.

    ```java
    public Order create(OrderIn in) {
        try (var ignored = MDC.putCloseable("customerId", in.customerId())) {  // removed at the end
            log.info("creating order");   // ... [trace_id=4bf9...] customerId=c-42 ... creating order
            return repository.save(...);
        }
    }
    ```

    ```
    %d{ISO8601} %-5level [trace_id=%X{trace_id}] customerId=%X{customerId} %logger{36} - %msg%n
    ```

!!! warning "O MDC é por thread"
    O MDC vive em um `ThreadLocal`. Trabalho entregue a outra thread (`@Async`, `CompletableFuture`, código reativo como o gateway WebFlux) não o enxerga, a menos que o contexto seja propagado; o agente do OTel faz isso para as bibliotecas que instrumenta, mas os seus próprios valores de `MDC.put` não são copiados automaticamente.

### Pipeline de agregação de logs

``` mermaid-sim
flowchart LR
    svc1["Serviço A\n(logs JSON → stdout)"]
    svc2["Serviço B\n(logs JSON → stdout)"]
    svc3["Serviço C\n(logs JSON → stdout)"]
    collector["Filebeat / Fluentd\n(coletor)"]
    elastic["Elasticsearch\n(indexação + armazenamento)"]
    kibana["Kibana\n(busca + dashboards)"]
    svc1 --> collector
    svc2 --> collector
    svc3 --> collector
    collector --> elastic
    elastic --> kibana
```

!!! note "Loki como alternativa mais leve"
    O Loki (Grafana Labs) indexa apenas labels, não o texto completo, o que o torna muito mais barato de operar do que o Elasticsearch. Se você já roda Prometheus e Grafana, adicionar o Loki dá agregação de logs sem nenhuma interface nova para aprender — todos os sinais ficam nos mesmos dashboards do Grafana.

---

## Traces distribuídos

### Anatomia de um trace

Um **trace** representa uma única requisição de ponta a ponta. Ele é composto de **spans** — um por operação (chamada de serviço, consulta ao banco, acesso ao cache etc.).

| Campo | Descrição | Exemplo |
|---|---|---|
| `traceId` | ID globalmente único da requisição inteira (128 bits) | `4bf92f3577b34da6a3ce929d0e0e4736` |
| `spanId` | ID único desta operação | `00f067aa0ba902b7` |
| `parentSpanId` | Span que disparou este | `a2fb4a1d1a96d312` |
| `name` | Nome da operação | `GET /orders/{id}` |
| `startTime` / `duration` | Quando começou e quanto tempo levou | `2024-01-15T10:30:00Z, 45ms` |
| `status` | OK / ERROR | `ERROR` |
| `attributes` | Tags chave-valor | `http.status_code=500, db.type=postgresql` |

### Cabeçalho W3C `traceparent`

O cabeçalho `traceparent` propaga o contexto de rastreamento entre fronteiras de serviço usando o formato `version-traceId-parentSpanId-flags`:

```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

| Campo | Valor | Significado |
|---|---|---|
| `version` | `00` | Versão da especificação W3C |
| `traceId` | `4bf92f3577b34da6a3ce929d0e0e4736` | ID de trace globalmente único de 128 bits |
| `parentSpanId` | `00f067aa0ba902b7` | ID de 64 bits do span que enviou esta requisição |
| `flags` | `01` | Flag de amostragem (`01` = amostrado) |

Em cada chamada downstream, um serviço mantém `version`, `traceId` e (normalmente) `flags` exatamente como recebidos, e substitui o campo `parentSpanId` pelo ID do **seu próprio** span corrente. É assim que o contexto de rastreamento atravessa as fronteiras de serviço sem que nenhum serviço precise entender o trace completo. O cabeçalho é definido pela recomendação W3C Trace Context[^5]; o OpenTelemetry o usa por padrão.

### Fluxo de uma requisição com spans

``` mermaid-sim
sequenceDiagram
    autonumber
    actor User as Usuário
    participant GW as Gateway [span: raiz, 120ms]
    participant OS as OrderService [span: filho, 95ms]
    participant DB as PostgreSQL [span: folha, 40ms]

    User->>+GW: GET /orders/42<br/>traceparent: 00-abc...-root-01
    GW->>+OS: GET /orders/42<br/>traceparent: 00-abc...-gw_span-01
    OS->>+DB: SELECT * FROM orders WHERE id=42
    DB-->>-OS: dados da linha
    OS-->>-GW: 200 OK (95ms)
    GW-->>-User: 200 OK (120ms)
```

### Estratégias de amostragem

Registrar todos os spans de todas as requisições é caro em escala, então os sistemas de rastreamento guardam apenas uma **amostra** dos traces.

| Estratégia | Como | Trade-off |
|---|---|---|
| **Head sampling** | A decisão é tomada no primeiro span (por exemplo, manter 10% pelo trace ID: `parentbased_traceidratio`) e viaja nas `flags` do `traceparent`, então todos os serviços concordam | Barato e simples, mas cego: descarta também 90% dos raros traces de erro |
| **Tail sampling** | Todos os spans são enviados ao OTel Collector, que espera o trace ficar completo e então decide | Consegue manter todo trace de erro ou lento, mas o Collector precisa manter todos os spans em memória |
| **Rate-limiting** | Manter no máximo N traces por segundo | Custo previsível; num pico, a maioria dos traces é descartada |

!!! tip "Recomendação para produção"
    Head e tail sampling são aplicados em sequência, então um trace descartado no head nunca pode ser "resgatado" pelo tail. Para manter todo trace de erro, amostre **100% no head** (ou uma proporção alta) nos serviços e deixe uma política de **tail sampling** no OTel Collector manter todos os traces com um span `ERROR` ou alta latência, mais uma pequena porcentagem (1–10%) dos normais. Se não puder usar tail sampling, uma proporção de 1–10% no head é um padrão razoável — aceitando que alguns traces de erro serão perdidos e que os logs deles serão sua alternativa.

---

## OpenTelemetry (OTel)

O OpenTelemetry é o padrão da CNCF para gerar, coletar e exportar telemetria[^3]. Ele substitui SDKs específicos de fornecedores (cliente Zipkin, cliente Jaeger etc.) por uma única API neutra, de modo que trocar de backend exige apenas uma mudança de configuração, não de código.

| Componente | Papel |
|---|---|
| **API** | Interfaces específicas de cada linguagem — Tracer, Meter, Logger |
| **SDK** | Implementação da API; inclui amostragem, envio em lotes, exporters |
| **Collector** | Processo independente que recebe, processa e exporta telemetria |
| **Exporter** | Adaptador de protocolo que envia os dados: OTLP (o padrão), Zipkin, Prometheus, console |
| **OTLP** | O OpenTelemetry Protocol, sobre gRPC (porta 4317) ou HTTP/protobuf (porta 4318); Jaeger, Tempo e a maioria dos fornecedores o aceitam nativamente |

``` mermaid-sim
flowchart LR
    app["Aplicação\n(OTel SDK)"]
    collector["OTel Collector"]
    prom["Prometheus\n(métricas)"]
    jaeger["Jaeger\n(traces)"]
    loki["Loki\n(logs)"]
    app -->|"OTLP (gRPC/HTTP)"| collector
    collector --> prom
    collector --> jaeger
    collector --> loki
```

### Instrumentação Java sem código { #java-zero-code-instrumentation }

O agente Java do OTel instrumenta o Spring Boot automaticamente por injeção de bytecode — sem nenhuma alteração de código.

```dockerfile
# pin a version: "latest" makes builds unreproducible
ADD https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v2.4.0/opentelemetry-javaagent.jar /app/opentelemetry-javaagent.jar

ENTRYPOINT ["java", \
  "-javaagent:/app/opentelemetry-javaagent.jar", \
  "-jar", "/app/app.jar"]
```

Configure o agente por variáveis de ambiente no Docker Compose:

```yaml
environment:
  OTEL_SERVICE_NAME: order-service
  OTEL_EXPORTER_OTLP_PROTOCOL: grpc            # agent 2.x defaults to http/protobuf (port 4318)
  OTEL_EXPORTER_OTLP_ENDPOINT: http://jaeger:4317
  OTEL_METRICS_EXPORTER: none
  OTEL_LOGS_EXPORTER: none
```

!!! warning "Combine o protocolo com a porta"
    Desde a versão 2.0, o agente Java envia OTLP sobre **HTTP/protobuf** por padrão, que escuta na porta **4318**. Ou aponte-o para `http://jaeger:4318`, ou mantenha a porta 4317 e defina `OTEL_EXPORTER_OTLP_PROTOCOL=grpc`, como acima. Uma incompatibilidade não produz nenhum trace, apenas um erro de exportação no log do serviço.

!!! note "Por que desabilitar os exporters de métricas/logs?"
    O agente Java pode exportar os três sinais via OTLP. Aqui desabilitamos métricas e logs porque o Prometheus já coleta as métricas via Actuator e o Loki (ou o ELK) cuida dos logs separadamente. Habilitar os três no agente duplicaria dados e inflaria os custos de armazenamento.

### Spans manuais

Quando a instrumentação automática não tem granularidade suficiente — você quer ver quanto tempo levou o *seu* cálculo de preço, e não apenas as chamadas HTTP e SQL ao redor dele —, adicione spans personalizados. Adicione a dependência da API do OTel (sua versão é gerenciada pelo `opentelemetry-bom`, ou defina-a explicitamente):

```xml
<dependency>
    <groupId>io.opentelemetry</groupId>
    <artifactId>opentelemetry-api</artifactId>
</dependency>
```

A forma mais simples, com o agente anexado, é uma anotação (dependência `io.opentelemetry.instrumentation:opentelemetry-instrumentation-annotations`):

```java
@WithSpan("calculateTotal")
public BigDecimal calculateTotal(@SpanAttribute("order.items") int items, ...) { ... }
```

Para ter controle total, crie o span você mesmo. O agente registra a instância global de `OpenTelemetry`, então obtenha o tracer a partir dela (ele não é um bean do Spring, a menos que você declare um):

```java
private static final Tracer tracer =
    GlobalOpenTelemetry.getTracer("store.order");

public Order processOrder(OrderRequest request) {
    Span span = tracer.spanBuilder("processOrder").startSpan();
    try (Scope scope = span.makeCurrent()) {
        span.setAttribute("order.customerId", request.customerId());
        // ... business logic
        return order;
    } catch (Exception e) {
        span.recordException(e);
        span.setStatus(StatusCode.ERROR, e.getMessage());
        throw e;
    } finally {
        span.end();
    }
}
```

---

## Stack unificada do Grafana (LGTM)

Loki + Grafana + Tempo + Mimir/Prometheus — a stack LGTM — reúne os três sinais de observabilidade em uma única interface. A grande vantagem é a **correlação de sinais**: você pode saltar de um pico em uma métrica para os traces que o causaram e daí para as linhas de log que o explicam, tudo sem sair do Grafana.

``` mermaid-sim
flowchart LR
    app["Aplicação"]
    prom["Prometheus\n(métricas)"]
    loki["Loki\n(logs)"]
    tempo["Tempo\n(traces)"]
    grafana["Grafana"]
    app --> prom
    app --> loki
    app --> tempo
    prom --> grafana
    loki --> grafana
    tempo --> grafana
```

Um fluxo típico de investigação: um alerta de métrica dispara no Grafana → clique em "View Traces" para abrir o trace correlacionado no Tempo → clique em um span para ver as linhas de log correlacionadas no Loki. Essa navegação entre sinais é o que separa uma plataforma de observabilidade de três ferramentas de monitoramento isoladas.

---

## Métricas DORA

O DORA (DevOps Research and Assessment) identificou quatro métricas que predizem o desempenho na entrega de software e o desempenho organizacional[^4]. Duas medem **vazão** (com que rapidez as mudanças fluem) e duas medem **estabilidade** (com que frequência as mudanças quebram algo e com que rapidez você se recupera). Equipes de desempenho elite pontuam bem nas quatro ao mesmo tempo — velocidade e estabilidade não são um trade-off.

| Métrica | Mede | Referência elite (State of DevOps 2024) |
|---|---|---|
| **Deployment Frequency** (frequência de deploy) | Com que frequência o código chega à produção | Sob demanda (vários deploys por dia) |
| **Change Lead Time** (lead time de mudanças) | Do commit até rodar em produção | Menos de um dia |
| **Change Failure Rate** (taxa de falha de mudanças) | % dos deploys que exigem correção ou rollback | ~5% |
| **Failed Deployment Recovery Time** (antes MTTR / tempo para restaurar o serviço) | Quanto tempo leva para se recuperar de um deploy com falha | Menos de uma hora |

!!! tip "DORA e observabilidade"
    As métricas DORA são, elas mesmas, telemetria. A frequência de deploy vem dos logs de CI/CD ([Hands-on 4](../../hands-on/4/index.md)). O tempo de recuperação exige marcações precisas de início e fim dos incidentes, vindas do seu sistema de monitoramento. A Change Failure Rate exige correlacionar eventos de deploy com picos na taxa de erros. Você não consegue melhorar o que não consegue medir — e não consegue medir sem infraestrutura de observabilidade.

---

## Retrato da observabilidade: simulação de um pico

O gráfico abaixo simula como os três pilares da observabilidade aparecem durante um pico de tráfego. O painel 1 mostra a taxa de requisições subindo bruscamente nos passos 10–12; o painel 2 mostra os eventos de erro concentrados na mesma janela; o painel 3 mostra as durações dos spans dos traces se alongando sob carga.

```python exec="1" html="1"
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np

rng = np.random.default_rng(42)
steps = list(range(20))

# Panel 1: request rate — normal ~50 req/s, spike to ~180 at steps 10-12
req_rate = [50 + rng.integers(-5, 6) for _ in steps]
for i in [10, 11, 12]:
    req_rate[i] = 170 + rng.integers(0, 20)
bar_colors = ["tomato" if 10 <= i <= 12 else "steelblue" for i in steps]

# Panel 2: error events — sparse outside spike, dense inside
error_x, error_y = [], []
for i in steps:
    n = rng.integers(4, 8) if 10 <= i <= 12 else rng.integers(0, 2)
    for _ in range(n):
        error_x.append(i + rng.uniform(-0.4, 0.4))
        error_y.append(rng.uniform(0.1, 0.9))
scatter_colors = ["tomato" if 10 <= int(round(x)) <= 12 else "steelblue" for x in error_x]

# Panel 3: horizontal bars for span durations — slow during spike
service_labels = ["gateway", "order-svc", "db-query", "inventory", "notification"]
span_starts = [0, 2, 8, 5, 14]
normal_durations = [25, 18, 12, 15, 8]
spike_durations = [110, 90, 75, 82, 50]

fig, (ax1, ax2, ax3) = plt.subplots(1, 3, figsize=(12, 4))
fig.patch.set_alpha(0)

# --- Panel 1: request rate bar chart ---
ax1.bar(steps, req_rate, color=bar_colors, edgecolor="none", width=0.7)
ax1.set_title("Request Rate (req/s)", fontsize=10, fontweight="bold")
ax1.set_xlabel("Time step")
ax1.set_ylabel("req/s")
ax1.set_facecolor("none")
ax1.grid(True, axis="y", alpha=0.25)
ax1.set_xlim(-0.5, 19.5)
normal_patch = mpatches.Patch(color="steelblue", label="Normal")
spike_patch = mpatches.Patch(color="tomato", label="Spike")
ax1.legend(handles=[normal_patch, spike_patch], fontsize=8, loc="upper left")

# --- Panel 2: error events scatter ---
ax2.scatter(error_x, error_y, c=scatter_colors, s=30, alpha=0.75, edgecolors="none")
ax2.axvspan(9.5, 12.5, color="tomato", alpha=0.08, label="Spike window")
ax2.set_title("Error Events", fontsize=10, fontweight="bold")
ax2.set_xlabel("Time step")
ax2.set_yticks([])
ax2.set_facecolor("none")
ax2.set_xlim(-0.5, 19.5)
ax2.grid(True, axis="x", alpha=0.2)
ax2.legend(fontsize=8)

# --- Panel 3: span duration horizontal bars ---
y_positions = list(range(len(service_labels)))
ax3.barh(y_positions, spike_durations, left=span_starts, color="tomato",
         alpha=0.85, height=0.4, label="During spike")
ax3.barh([y + 0.45 for y in y_positions], normal_durations, left=span_starts,
         color="steelblue", alpha=0.85, height=0.4, label="Normal")
ax3.set_yticks([y + 0.225 for y in y_positions])
ax3.set_yticklabels(service_labels, fontsize=8)
ax3.set_title("Trace Span Durations (ms)", fontsize=10, fontweight="bold")
ax3.set_xlabel("ms")
ax3.set_facecolor("none")
ax3.grid(True, axis="x", alpha=0.25)
ax3.legend(fontsize=8, loc="lower right")

plt.tight_layout()
buf = __import__('io').StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

Os três painéis compartilham a mesma linha do tempo: o pico visível no painel 1 explica diretamente o agrupamento de erros no painel 2, e os dois explicam o alongamento das durações dos spans no painel 3. Sem os três pilares, você veria apenas uma parte do quadro.

!!! warning "Armadilhas comuns"
    - **Registrar tudo em INFO** (ou DEBUG em produção): o volume e o custo dos logs explodem, e as linhas úteis se afogam.
    - **Registrar segredos ou dados pessoais**: senhas, JWTs, números de cartão e e-mails nunca devem chegar ao pipeline de logs.
    - **Labels de métrica ilimitados**: IDs de usuário ou de pedido como labels derrubam o Prometheus — coloque-os em logs e traces.
    - **Propagação de contexto quebrada**: um único serviço sem instrumentação (ou um proxy que descarta o `traceparent`) parte cada trace em dois.
    - **Alertar sobre causas, não sobre sintomas**: dezenas de alertas de CPU e memória sobre os quais ninguém age escondem aquele que importa.

---

## Conexões

- [Hands-on 6](../../hands-on/6/index.md) — Prometheus e Grafana para as métricas da loja.
- [Hands-on 10](../../hands-on/10/index.md) — agente Java do OpenTelemetry, Jaeger e `trace_id` nos logs.
- [Confiabilidade](../reliability/index.md) e [SLI / SLO / SLA](../reliability/sli-slo-sla/index.md) — SLIs são consultas PromQL sobre essas métricas; os alertas de burn rate as usam.
- [Arquitetura Orientada a Eventos](../event_driven/index.md) — rastreamento através de tópicos do Kafka e monitoramento do consumer lag.
- [Exercício: Gargalos](../../exercises/bottlenecks/index.md) — usar a observabilidade para descobrir onde a plataforma está lenta.

## Pontos-chave

- O monitoramento responde a perguntas conhecidas; a **observabilidade** permite investigar perguntas novas a partir de **métricas** (que algo mudou), **logs** (o quê) e **traces** (onde).
- O Prometheus **coleta** `/actuator/prometheus`; use `rate()` em counters, `histogram_quantile` com `sum by (le)` para percentis, e mantenha os labels com baixa cardinalidade.
- Monte dashboards com **RED** (serviços) e **USE** (recursos); **alerte sobre sintomas** que os usuários sentem.
- Os logs devem ser **estruturados** e carregar o `trace_id` — preenchido automaticamente pelo agente do OTel; use `MDC.put` só para suas próprias chaves de negócio.
- Um trace é uma árvore de **spans** ligados pelo `traceparent`; o head sampling é barato, mas cego, e o tail sampling mantém os traces interessantes.
- O **OpenTelemetry** é o padrão neutro em relação a fornecedores; meça o desempenho de entrega com as quatro métricas **DORA**.

---

[^1]: BEYER, B. et al. *Site Reliability Engineering: How Google Runs Production Systems*. O'Reilly, 2016.
[^2]: MAJORS, C.; FONG-JONES, L.; MIRANDA, G. *Observability Engineering*. O'Reilly, 2022.
[^3]: OPENTELEMETRY. [opentelemetry.io](https://opentelemetry.io){target="_blank"} — especificação, SDKs, Collector.
[^4]: FORSGREN, N.; HUMBLE, J.; KIM, G. *Accelerate: The Science of Lean Software and DevOps*. IT Revolution, 2018. Veja também os relatórios anuais [DORA State of DevOps](https://dora.dev/research/){target="_blank"}.
[^5]: W3C. [Trace Context](https://www.w3.org/TR/trace-context/){target="_blank"}. W3C Recommendation.
