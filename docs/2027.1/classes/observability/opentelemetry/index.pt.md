
O BoxOffice é escrito em Java (gateway, order, inventory, payment, catalog) e Python (o `assistant` de IA), roda Nginx na borda, Kafka no meio e PostgreSQL embaixo. Dez anos atrás, rastrear um checkout por tudo isso significava um agente de fornecedor por linguagem, um header proprietário por fornecedor e uma reinstrumentação completa no dia em que a empresa trocasse de fornecedor. Pior: um trace se quebrava no primeiro componente que falasse outro dialeto. O **OpenTelemetry** (OTel) resolveu isso padronizando as partes chatas — a API, o protocolo de transmissão, o header de contexto e os nomes das coisas — para que toda biblioteca e todo backend falem a mesma língua[^1]. (As ideias em si — trace IDs, spans, ligações pai-filho, amostragem — vêm do artigo do Dapper, do Google[^4].)

---

## O que o OpenTelemetry é (e o que não é) { #what-opentelemetry-is-and-is-not }

O OpenTelemetry é um projeto da CNCF que define **como a telemetria é produzida e transportada**. Ele **não** é um backend: não armazena nem exibe nada. Você continua escolhendo para onde os dados vão — Prometheus, Tempo, Jaeger, Loki, um serviço de nuvem ou um fornecedor — e pode mudar essa escolha sem tocar no código da aplicação.

| Peça | O que é | Exemplo no BoxOffice |
|---|---|---|
| **API** | interfaces para criar spans, métricas e logs; viram no-ops seguros se nenhum SDK estiver instalado | `Tracer`, `Meter` usados dentro do `payment` |
| **SDK** | a implementação: amostragem, batching, detecção de recursos, exporters | configurado pelo agente Java a partir de variáveis de ambiente |
| **Bibliotecas de instrumentação** | spans/métricas prontos para frameworks: Spring MVC, JDBC, clientes Kafka, FastAPI, clientes HTTP | o span `SELECT seat_holds`, criado sem nenhum código |
| **Semantic conventions** | nomes padronizados para atributos e métricas: `http.route`, `db.system`, `messaging.destination.name` | todo serviço nomeia a rota do mesmo jeito, então um dashboard serve para todos |
| **OTLP** | o OpenTelemetry Protocol, sobre gRPC (porta **4317**) ou HTTP/protobuf (porta **4318**) | todos os serviços exportam para o Collector via OTLP |
| **Collector** | um processo independente que recebe, processa e exporta telemetria | remove números de cartão, aplica tail sampling, distribui para os backends |

Os sinais amadureceram em ritmos diferentes: **traces** e **métricas** são estáveis, **logs** ficaram estáveis depois (o OTel principalmente *faz a ponte* com bibliotecas de logging existentes, adicionando o contexto de trace), e os **profiles** foram adicionados como quarto sinal e ainda estão amadurecendo.

``` diagram
flowchart LR
    subgraph services ["Serviços do BoxOffice"]
        J["Serviços Java<br/>agente Java OTel"]
        PY["assistant (Python)<br/>SDK OTel"]
        NG["Nginx<br/>módulo OTel"]
    end
    subgraph col ["OTel Collector"]
        R["receivers<br/>otlp"] --> PR["processors<br/>memory_limiter, atributos k8s,<br/>remoção, tail sampling, batch"] --> E["exporters"]
    end
    J -- OTLP --> R
    PY -- OTLP --> R
    NG -- OTLP --> R
    E --> TEMPO[("Tempo / Jaeger<br/>traces")]
    E --> PROM[("Prometheus / Mimir<br/>métricas")]
    E --> LOKI[("Loki<br/>logs")]
```

---

## Propagação de contexto { #context-propagation }

Um trace só existe se cada salto souber a qual trace pertence. A **propagação de contexto** é o mecanismo: quem chama injeta o contexto de trace atual na requisição de saída, e quem é chamado o extrai e cria o próprio span como filho.

### O header `traceparent` { #the-traceparent-header }

O OpenTelemetry usa por padrão o padrão W3C Trace Context[^2]. Um único header carrega o contexto:

```text
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
             │  │                                │                └─ flags: 01 = sampled
             │  │                                └─ parent-id: the caller's current span (64 bits)
             │  └─ trace-id: same for the whole request (128 bits)
             └─ version
```

Em cada chamada de saída, um serviço mantém o `trace-id` e as flags e **substitui o parent-id pelo ID do seu próprio span atual**. Nenhum serviço precisa entender o trace inteiro; a árvore é reconstruída pelo backend a partir das ligações com o pai. Um segundo header, `tracestate`, carrega dados específicos de fornecedor, e o **baggage** (`baggage: tenant=festival-x,channel=mobile`) carrega pares chave-valor de negócio que todo serviço adiante pode ler — útil, mas cada byte viaja em cada requisição, então mantenha-o pequeno e nunca coloque segredos nele.

### Acompanhando um checkout { #following-a-checkout }

Execute o diagrama e observe o parent-id mudar a cada salto enquanto o trace-id permanece o mesmo — inclusive através do Kafka, onde o contexto viaja num **header da mensagem**:

``` diagram-sim
sequenceDiagram
    autonumber
    participant GW as gateway
    participant O as order
    participant I as inventory
    participant P as payment
    participant X as provedor de pagamentos
    participant K as Kafka
    participant N as notification
    GW->>O: POST /orders<br/>traceparent: 00-4bf9…-a1a1…-01
    O->>I: PUT /holds/h7/confirm<br/>traceparent: 00-4bf9…-b2b2…-01
    I-->>O: 200 OK (90 ms)
    O->>P: POST /charges<br/>traceparent: 00-4bf9…-c3c3…-01
    P->>X: POST /v1/charges (span CLIENT registrado pelo payment)
    X-->>P: 200 OK (1,0 s)
    P-->>O: 201 Created
    O->>K: produz OrderConfirmed<br/>header traceparent: 00-4bf9…-d4d4…-01
    O-->>GW: 201 Created
    K->>N: consome OrderConfirmed (span CONSUMER, pai d4d4…)
    N->>N: envia e-mail e push
```

Três detalhes importam na prática:

- **O provedor externo é uma caixa-preta.** Ele não vai enviar os spans dele para você. O span `CLIENT` registrado pelo `payment` em torno da chamada é tudo o que você vai ver dele — e é por isso que a duração e o status desse span merecem um alerta próprio. Muitos times também **removem** `traceparent` e `baggage` na saída, para que IDs internos não vazem para terceiros.
- **Saltos assíncronos** propagam pelos headers das mensagens. Um consumidor que trata uma mensagem continua o trace do produtor (pai-filho). Um consumidor que processa um **lote** de 500 mensagens não pode ter 500 pais; ele inicia o próprio trace e adiciona **span links** para o span de cada produtor.
- **O trace termina onde a propagação quebra.** Um componente que descarta o header divide todos os traces em dois.

!!! warning "Onde a propagação costuma quebrar"

    | Lugar | Sintoma | Correção |
    |---|---|---|
    | Um proxy ou gateway que reconstrói requisições e descarta headers desconhecidos | os traces começam no serviço atrás dele | repassar `traceparent`, `tracestate`, `baggage`; instrumentar o proxy |
    | Trabalho entregue a outra thread (`@Async`, executors, código reativo) | spans filhos aparecem como traces separados | usar executors instrumentados (o agente Java encapsula os comuns) ou passar o `Context` explicitamente |
    | Mensageria sem headers (clientes antigos, envelopes próprios) | consumidores iniciam traces novos | usar headers; ou carregar o contexto no envelope da mensagem |
    | Um cliente HTTP caseiro | a chamada não tem span `CLIENT` e o chamado inicia um trace novo | usar um cliente instrumentado ou injetar o contexto manualmente |

!!! example "No código do BoxOffice: o trace através do outbox (lab 8)"

    O agente propaga o contexto por HTTP e nos headers do Kafka sozinho, mas os eventos do BoxOffice não vão direto para o Kafka: desde o lab 7, o `order` os grava numa tabela **outbox** na mesma transação do pedido, e um relay os publica depois, numa thread do agendador — um salto que o agente não enxerga, e que dividia cada pedido em dois traces sem relação. O [Hands-on 8 — instrumente tudo](../../../hands-on/8/instrument/index.md) carrega o `traceparent` junto com o dado: uma coluna nova (`V2__outbox_traceparent.sql`), `inject` quando a linha é gravada, depois `extract` e `makeCurrent()` antes de o relay enviar, para que o span de produtor do agente vire filho da requisição original. Na execução de teste do lab o resultado é **um** trace: a requisição levou 9 ms, o relay publicou 22 ms depois do início, e o `notification` gastou 67 ms.

    ``` { .java title="services/order/src/main/java/boxoffice/order/outbox/Outbox.java (write the event and its traceparent)" }
    --8<-- "docs/2027.1/hands-on/8/code/services/order/src/main/java/boxoffice/order/outbox/Outbox.java:26:39"
    ```

    ``` { .java title="services/order/src/main/java/boxoffice/order/outbox/OutboxRelay.java (publish inside the original context)" }
    --8<-- "docs/2027.1/hands-on/8/code/services/order/src/main/java/boxoffice/order/outbox/OutboxRelay.java:78:88"
    ```

---

## Instrumentando o BoxOffice { #instrumenting-boxoffice }

### Sem código: o agente Java { #zero-code-the-java-agent }

O agente Java do OpenTelemetry se anexa à JVM e instrumenta centenas de bibliotecas — Spring MVC/WebFlux, JDBC, HikariCP, clientes Kafka, clientes HTTP, Logback — por injeção de bytecode, sem mudanças no código. Ele também coloca `trace_id` e `span_id` no contexto de logging (MDC), então os logs estruturados os carregam automaticamente.

```dockerfile
# Dockerfile (excerpt) — pin a version; check the latest release before upgrading
ADD https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v2.32.0/opentelemetry-javaagent.jar /otel/opentelemetry-javaagent.jar
ENTRYPOINT ["java", "-javaagent:/otel/opentelemetry-javaagent.jar", "-jar", "/app/app.jar"]
```

```yaml
# docker-compose.yaml (excerpt) — the order service
environment:
  OTEL_SERVICE_NAME: order
  OTEL_RESOURCE_ATTRIBUTES: service.namespace=boxoffice,service.version=1.4.2,deployment.environment.name=dev
  OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318   # agent 2.x default protocol: http/protobuf
  OTEL_TRACES_SAMPLER: parentbased_always_on                 # keep all; the Collector decides (tail sampling)
  OTEL_METRIC_EXPORT_INTERVAL: "15000"
```

`service.name` é o atributo mais importante do OpenTelemetry: sem ele, todo serviço aparece como `unknown_service:java` e nenhum dashboard consegue distingui-los. `service.version` e `deployment.environment.name` permitem comparar um canary com a versão estável, ou staging com produção.

!!! example "No código do BoxOffice: um agente para todo serviço Java (lab 8)"

    O [Hands-on 8 — instrumente tudo](../../../hands-on/8/instrument/index.md) não embute o agente nas imagens, como faz o Dockerfile acima: o `scripts/get-otel-agent.sh` baixa uma versão fixada (2.32.0) uma vez em `infra/otel/`, e todo serviço Java a monta só para leitura e a carrega por `JAVA_TOOL_OPTIONS`. As configurações ficam numa única âncora YAML mesclada em cada serviço, para que os serviços não divirjam; só o `OTEL_SERVICE_NAME` muda — três réplicas do `catalog`, **um** serviço. `OTEL_ON=false` roda a mesma imagem sem o agente, e é assim que o lab mede quanto o agente custa; as métricas são exportadas a cada 10 s em vez de 60 s, para que os dashboards reajam dentro de um experimento curto.

    ``` { .yaml title="docker-compose.yaml (the x-otel anchor and the catalog replicas)" }
    --8<-- "docs/2027.1/hands-on/8/code/docker-compose.yaml:3:12,15:22"
    ```

### Sem código: o `assistant` em Python { #zero-code-the-python-assistant }

```bash
uv add opentelemetry-distro opentelemetry-exporter-otlp
uv run opentelemetry-bootstrap -a requirements > otel-instrumentations.txt   # instrumentations for the libraries found (FastAPI, httpx, psycopg…)
uv add -r otel-instrumentations.txt
OTEL_SERVICE_NAME=assistant \
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318 \
uv run opentelemetry-instrument uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Spans manuais onde o agente não enxerga { #manual-spans-where-the-agent-cannot-see }

A instrumentação automática enxerga I/O. Ela não enxerga **etapas de negócio** nem **espera dentro do seu código** — o pool de conexões do adaptador de pagamentos no waterfall de [Sinais](../signals/index.md#reading-a-waterfall). Alguns spans manuais nos lugares certos valem mais que centenas de spans automáticos:

```java
private static final Tracer tracer = GlobalOpenTelemetry.getTracer("boxoffice.payment");

ProviderConnection acquire() throws TimeoutException {
    Span span = tracer.spanBuilder("pool.acquire").startSpan();
    try (Scope ignored = span.makeCurrent()) {
        long start = System.nanoTime();
        ProviderConnection c = pool.borrow(Duration.ofMillis(500));   // bounded wait, never forever
        span.setAttribute("pool.wait_ms", (System.nanoTime() - start) / 1_000_000);
        return c;
    } catch (TimeoutException e) {
        span.recordException(e);
        span.setStatus(StatusCode.ERROR, "pool exhausted");
        throw e;
    } finally {
        span.end();
    }
}
```

Com o agente anexado, a alternativa mais simples é uma anotação no método: `@WithSpan("seatmap.render")`, com `@SpanAttribute` nos parâmetros que você quer registrar.

!!! tip "Atributos: ricos, mas não perigosos"

    Atributos de span podem ter alta cardinalidade — `order.id`, `event.id`, `customer.tier` são o que torna um trace pesquisável. Eles não podem conter segredos nem dados pessoais: nada de números de cartão, tokens ou e-mails completos. Remova na origem e adicione um processor de remoção no Collector como segunda barreira.

---

## O Collector { #the-collector }

Os serviços poderiam exportar direto para cada backend, mas aí cada serviço precisaria conhecer cada backend, suas credenciais e sua política de retry. O **Collector** os desacopla: os serviços enviam OTLP para um só lugar, e os **pipelines** do Collector decidem o que acontece em seguida. Um pipeline tem três estágios por sinal: **receivers** (como os dados entram), **processors** (o que é feito com eles, em ordem), **exporters** (para onde vão).

```yaml
# otel-collector.yaml — gateway Collector for BoxOffice (sketch)
receivers:
  otlp:
    protocols:
      grpc: { endpoint: 0.0.0.0:4317 }
      http: { endpoint: 0.0.0.0:4318 }

processors:
  memory_limiter:                 # first: refuse data instead of being OOM-killed
    check_interval: 1s
    limit_percentage: 80
    spike_limit_percentage: 20
  k8sattributes: {}               # add k8s.pod.name, k8s.namespace.name, k8s.deployment.name
  attributes/redact:
    actions:
      - key: payment.card_number
        action: delete
      - key: enduser.email
        action: hash
  tail_sampling:
    decision_wait: 10s            # wait for the trace's spans before deciding
    policies:
      - name: keep-errors
        type: status_code
        status_code: { status_codes: [ERROR] }
      - name: keep-slow
        type: latency
        latency: { threshold_ms: 2000 }
      - name: some-of-the-rest
        type: probabilistic
        probabilistic: { sampling_percentage: 5 }
  batch: {}                       # last: send in batches

exporters:
  otlp/tempo:
    endpoint: tempo:4317
    tls: { insecure: true }
  otlphttp/prometheus:
    endpoint: http://prometheus:9090/api/v1/otlp
  otlphttp/loki:
    endpoint: http://loki:3100/otlp

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, k8sattributes, attributes/redact, tail_sampling, batch]
      exporters: [otlp/tempo]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, k8sattributes, batch]
      exporters: [otlphttp/prometheus]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, k8sattributes, attributes/redact, batch]
      exporters: [otlphttp/loki]
```

A ordem dos processors importa: `memory_limiter` primeiro, para que um Collector sobrecarregado descarte dados em vez de cair; `batch` por último, para agrupar o que sobreviveu.

### Padrões de implantação { #deployment-patterns }

| Padrão | Onde roda | Bom para | Cuidado |
|---|---|---|---|
| **Sem Collector** (SDK → backend) | — | demos, um único backend | todo serviço guarda configuração e credenciais do backend |
| **Agente** | DaemonSet (um por nó) ou sidecar | batching local, métricas do host, adicionar atributos do nó/pod | recursos por nó; não enxerga traces inteiros |
| **Gateway** | um Deployment atrás de um Service, escalado horizontalmente | política central: remoção de dados, tail sampling, roteamento, credenciais | um novo componente crítico: dimensione e monitore |
| **Agente + gateway** (duas camadas) | ambos | clusters grandes | o tail sampling exige **todos os spans de um trace na mesma instância do gateway** — roteie por trace ID (exporter `loadbalancing`) |

!!! warning "O Collector é infraestrutura de produção"

    Durante a venda relâmpago, o volume de telemetria cresce junto com o tráfego. Um Collector sem `memory_limiter`, sem réplicas suficientes ou exportando de forma síncrona para um backend lento vira um gargalo — e, se os SDKs bloquearem na exportação, pode até deixar os serviços lentos. Os SDKs exportam de forma assíncrona e descartam dados quando a fila enche: **perder telemetria é aceitável; deixar o checkout lento para reportar sobre ele, não.** Monitore as métricas do próprio Collector (spans aceitos vs recusados vs descartados, tamanho da fila).

---

## Amostragem (sampling) { #sampling }

Guardar todos os spans de todas as requisições raramente cabe no orçamento (veja [quanto custa a telemetria](../index.md#what-telemetry-costs)). A **amostragem** guarda um subconjunto dos traces — traces completos, não spans aleatórios, senão as árvores se quebram.

| Estratégia | Onde a decisão é tomada | Prós | Contras |
|---|---|---|---|
| **Head sampling** (ex.: `parentbased_traceidratio` 10%) | no primeiro span, a partir do trace ID; viaja na flag `sampled` para que todos os serviços concordem | barato; sem buffer; consistente entre serviços | **cego**: descarta também 90% dos traces raros de erro e de lentidão |
| **Tail sampling**[^3] | no Collector, depois que o trace inteiro chegou (`decision_wait`) | guarda traces *interessantes*: todo erro, toda requisição lenta, mais uma amostra do resto | todo span precisa chegar ao Collector; memória para o buffer; todos os spans de um trace numa instância |
| **Rate limiting** | SDK ou Collector: no máximo N traces por segundo | custo previsível | durante um pico, quase tudo é descartado — exatamente quando você mais precisa |

Head e tail sampling são aplicados em sequência: um trace descartado na cabeça nunca pode ser resgatado na cauda. A comparação abaixo usa números ilustrativos para um dia movimentado do BoxOffice — 2.000 requisições/s, 8 spans por requisição de 500 bytes, 1% das requisições falhando e 2% mais lentas que o limiar de 2 s:

```python exec="true"
RPS, SPANS, SPAN_BYTES, DAY = 2_000, 8, 500, 86_400
ERR, SLOW = 0.01, 0.02          # fraction of requests that fail / are slow (illustrative)

def gb_per_day(fraction_kept):
    return RPS * SPANS * SPAN_BYTES * DAY * fraction_kept / 1e9

strategies = [
    ("keep everything", 1.0, 1.0),
    ("head sampling 10%", 0.10, 0.10),
    ("head sampling 1%", 0.01, 0.01),
    ("tail: all errors + all slow + 5% of the rest", ERR + SLOW + 0.05 * (1 - ERR - SLOW), 1.0),
]
errors_per_day = RPS * ERR * DAY
print("| Strategy | Traces kept | Storage per day | Error traces kept per day |")
print("|---|---:|---:|---:|")
for name, kept, err_kept in strategies:
    print(f"| {name} | {kept:.1%} | {gb_per_day(kept):,.1f} GB | {errors_per_day * err_kept:,.0f} ({err_kept:.0%}) |")
```

O tail sampling armazena menos que o head sampling de 10% e ainda guarda **todos** os traces de erro — ao preço de enviar 100% dos spans pela rede até o Collector e mantê-los em buffer durante a janela de decisão. Uma receita comum em produção: head sampling de 100% (ou uma razão alta) nos serviços, tail sampling num Collector gateway, e **métricas calculadas a partir de todas as requisições antes da amostragem**, para que dashboards e SLOs sejam exatos mesmo que a maioria dos traces seja descartada.

!!! example "Exemplars: de uma métrica para um trace"

    Um **exemplar** é um `trace_id` anexado a uma amostra de métrica — por exemplo, ao bucket do histograma de latência em que caiu um checkout de 9 s. No Grafana, o painel de latência mostra os exemplars como pontos; clicar num deles abre exatamente aquele trace no Tempo. É a ponte entre "o p99 está alto" e "aqui está uma requisição que foi lenta" — garanta que o trace do exemplar foi *guardado* pelo seu sampler (o tail sampling das requisições lentas garante isso).

---

## Backends e uma stack local { #backends-and-a-local-stack }

O OpenTelemetry deixa o backend por sua conta. Os mesmos dados OTLP podem ir para qualquer um deles:

=== "Open source"

    **Grafana LGTM**: **L**oki (logs), **G**rafana (UI), **T**empo (traces), **M**imir ou Prometheus (métricas), mais o Pyroscope (profiles). Alternativas: Jaeger para traces, OpenSearch para logs, stacks baseadas em ClickHouse (SigNoz) para tudo. Você opera o armazenamento.

=== "AWS"

    CloudWatch (métricas, logs, alarmes), X-Ray / CloudWatch Application Signals (traces), Amazon Managed Service for Prometheus e Managed Grafana. O AWS Distro for OpenTelemetry (ADOT) empacota o Collector.

=== "GCP"

    Cloud Monitoring, Cloud Logging e Cloud Trace (Google Cloud Observability); Managed Service for Prometheus. Aceita OTLP através do Collector.

=== "Azure"

    Azure Monitor: Application Insights (traces, requisições), Log Analytics (logs), Managed Prometheus e Managed Grafana. A distro OpenTelemetry do Azure Monitor instrumenta as aplicações.

=== "SaaS"

    Datadog, Honeycomb, New Relic, Grafana Cloud, Dynatrace, Elastic Cloud e outros aceitam OTLP. Você paga por volume (spans, séries, GB de logs) — as decisões de amostragem e cardinalidade desta aula também são decisões de custo.

Para desenvolvimento — e no [Hands-on 8](../../../hands-on/8/index.md) — um único container junta um Collector com toda a stack LGTM:

```yaml
# docker-compose.yaml (excerpt)
services:
  otel-lgtm:
    image: grafana/otel-lgtm
    ports:
      - "3000:3000"   # Grafana
      - "4317:4317"   # OTLP gRPC
      - "4318:4318"   # OTLP HTTP
```

---

## Trade-offs

| Decisão | Opção A | Opção B | Orientação |
|---|---|---|---|
| Instrumentação | agente sem código | chamadas manuais ao SDK | comece pelo agente; adicione spans manuais para etapas de negócio e esperas internas |
| Caminho de exportação | SDK → backend | SDK → Collector → backend | um Collector assim que houver dois serviços ou uma política (remoção, amostragem) |
| Topologia do Collector | agente por nó | gateway central | agentes para enriquecimento local; um gateway para tail sampling e credenciais |
| Amostragem | head | tail | head pela simplicidade de custo; tail para guardar todo erro e todo trace lento |
| Protocolo | OTLP gRPC (4317) | OTLP HTTP (4318) | qualquer um; HTTP é mais amigável a proxies e navegadores |
| Backend | auto-hospedado | gerenciado / SaaS | gerenciado, até que a fatura ou regras de residência de dados digam o contrário |

!!! tip "Na entrevista"

    "Como você rastreia uma requisição entre microsserviços?" — *"Todo serviço é instrumentado com OpenTelemetry; o header W3C `traceparent` (e os headers das mensagens do Kafka nos saltos assíncronos) propaga o trace ID; os spans vão via OTLP para um Collector que aplica tail sampling — guarda todos os erros e traces lentos, alguns por cento do resto — e exporta para um backend de tracing. Os logs carregam o trace ID, e os histogramas de latência carregam exemplars, então consigo ir de um dashboard para um trace e dele para os seus logs."* Depois acrescente o ângulo de custo: as métricas são calculadas sobre 100% do tráfego; os traces são amostrados.

!!! success "Boas práticas"

    - **Fixe as versões do agente e do SDK, e atualize de propósito** — uma nova versão da instrumentação pode renomear métricas e atributos (as semantic conventions evoluem), quebrando dashboards e alertas em silêncio. No BoxOffice: `scripts/get-otel-agent.sh` fixa a 2.32.0.
    - **Configure o OpenTelemetry uma vez, por variáveis de ambiente compartilhadas por todos os serviços** — exporter, sampler, atributos de recurso; só o `OTEL_SERVICE_NAME` muda por serviço. No BoxOffice: a âncora `x-otel` (caixa acima).
    - **Use um sampler baseado no pai na cabeça** — a raiz decide uma vez e todo salto segue, então um trace é mantido ou descartado inteiro, nunca em fragmentos. No BoxOffice: `OTEL_TRACES_SAMPLER=parentbased_always_on`, e `parentbased_traceidratio` a 10% no experimento B do [Hands-on 8 — meça](../../../hands-on/8/measure/index.md).
    - **Carregue o `traceparent` por todo salto assíncrono que é seu** — linhas de outbox, tabelas de jobs, envelopes próprios; cada salto sem ele divide todo trace em dois. No BoxOffice: a coluna `traceparent` do outbox (caixa acima).
    - **Remova `traceparent` e `baggage` na saída para terceiros** — ids internos e contexto de negócio não devem vazar para um provedor de pagamentos que nunca vai mandar os spans dele para você.
    - **Monitore o próprio Collector** — suas métricas (exportações recusadas e com falha, tamanho da fila, memória) são o único sinal de que telemetria está sendo descartada; um Collector mudo parece exatamente um sistema tranquilo.

!!! warning "Armadilhas comuns"

    - **Protocolo e porta trocados**: o agente Java 2.x usa por padrão OTLP sobre HTTP (4318); apontá-lo para a 4317 sem `OTEL_EXPORTER_OTLP_PROTOCOL=grpc` silenciosamente não produz dados.
    - **Sem `service.name`**: tudo aparece como `unknown_service`.
    - **Head sampling de 1% e nenhum tail sampling**: o único trace de que você precisa durante o incidente foi descartado.
    - **Tail sampling atrás de um load balancer round-robin**: spans do mesmo trace caem em Collectors diferentes, e cada decisão é tomada sobre fragmentos.
    - **Sem `memory_limiter`**: o Collector é morto por falta de memória (OOM) justamente no pico de tráfego.
    - **Segredos e dados pessoais em atributos ou baggage**: a telemetria é copiada para muitos sistemas e guardada por semanas.

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    KH["Kafka message headers,<br/>span links → Messaging"] --> CTX["context propagation:<br/>traceparent, baggage"]
    CTX --> SVC["services: Java agent,<br/>Python SDK, Nginx"]
    SVC -->|"OTLP 4317 / 4318"| COL["Collector:<br/>receivers → processors → exporters"]
    COL --> RD["redaction:<br/>no cards, no e-mails"]
    COL --> TS["tail sampling:<br/>errors + slow + 5%"]
    TS --> TR["traces backend<br/>Tempo / Jaeger"]
    COL --> MET["metrics from all traffic<br/>→ SLOs, Alerting"]
    COL --> LG["logs backend<br/>Loki"]
    MET -->|"exemplars"| TR
    COL --> OPS["memory_limiter, gateway replicas<br/>→ Cloud-native"]
```

**Componentes da paleta:** [`tracing`](../../../reference/components/observability/index.md#tracing) · [`metrics`](../../../reference/components/observability/index.md#metrics) · [`logs`](../../../reference/components/observability/index.md#logs) · [`app`](../../../reference/components/compute/index.md#app) (serviços instrumentados) · [`apigw`](../../../reference/components/edge/index.md#apigw) (precisa repassar o `traceparent`) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (contexto nos headers das mensagens) · [`payment`](../../../reference/components/external/index.md#payment) (uma caixa-preta: só o span `CLIENT`). **Cenários:** `observability-stack`, `event-fanout` (traces que atravessam o Kafka). **Continua em:** [Sinais](../signals/index.md), [Alertas](../alerting/index.md), [Mensageria — Kafka](../../messaging/kafka/index.md), [Cloud-native — Kubernetes](../../cloud-native/kubernetes/index.md) (Collector como DaemonSet ou Deployment), [Hands-on 8 — instrumentar tudo](../../../hands-on/8/instrument/index.md).

---

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - O OpenTelemetry padroniza a **API, o SDK, as semantic conventions, o protocolo (OTLP) e o Collector** — não o backend; troque de backend sem reinstrumentar.
    - A **propagação de contexto** com o W3C `traceparent` (e headers de mensagem no Kafka) é o que forma um trace; um salto que o descarta divide todos os traces.
    - Comece pela **instrumentação sem código**, depois adicione spans manuais para etapas de negócio e para o **tempo gasto esperando** dentro dos serviços.
    - Os pipelines do **Collector** (receivers → processors → exporters) centralizam remoção de dados, enriquecimento, amostragem e roteamento; trate-o como infraestrutura de produção.
    - O **tail sampling** guarda todo erro e todo trace lento a uma fração do armazenamento; calcule métricas sobre todo o tráfego antes da amostragem e use **exemplars** para saltar de métricas para traces.

---

[^1]: OPENTELEMETRY. [What is OpenTelemetry?](https://opentelemetry.io/docs/what-is-opentelemetry/){target="_blank"} e [documentação do Collector](https://opentelemetry.io/docs/collector/){target="_blank"}.
[^2]: W3C. [Trace Context](https://www.w3.org/TR/trace-context/){target="_blank"}. W3C Recommendation. Veja também [W3C Baggage](https://www.w3.org/TR/baggage/){target="_blank"}.
[^3]: OPENTELEMETRY COLLECTOR CONTRIB. [Tail Sampling Processor](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/tailsamplingprocessor){target="_blank"}.
[^4]: SIGELMAN, B. H. et al. [Dapper, a Large-Scale Distributed Systems Tracing Infrastructure](https://research.google/pubs/dapper-a-large-scale-distributed-systems-tracing-infrastructure/){target="_blank"}. Google Technical Report, 2010.
