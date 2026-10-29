# 1. Instrumente Tudo { #1-instrument-everything }

Neste passo cada serviço Java passa a enviar **traces, métricas e logs** para um único contêiner, o
`otel-lgtm`, sem nenhuma mudança no código de negócio. Depois você corrige o único lugar onde a
instrumentação automática não enxerga a requisição: o salto pelo outbox do [lab 7](../../7/index.md).
Todos os comandos rodam na **raiz do seu repositório `boxoffice`**.

## O backend: `otel-lgtm` { #the-backend-otel-lgtm }

O `grafana/otel-lgtm` reúne um backend de observabilidade inteiro em uma imagem, para desenvolvimento
e ensino: um **OpenTelemetry Collector** recebe OTLP (o *OpenTelemetry Protocol*) e encaminha cada
sinal para o **Prometheus** (métricas), o **Tempo** (traces) e o **Loki** (logs), com o **Grafana** por
cima, já ligado de modo que um *exemplar* de métrica abre o seu trace e um trace abre os seus logs. Em
produção esses são sistemas separados e replicados (ou um serviço gerenciado); o protocolo que seus
serviços falam — o OTLP — continua o mesmo.

``` yaml title="docker-compose.yaml (excerpt)"
  otel-lgtm:
    image: grafana/otel-lgtm:0.37.0
    ports:
      - "3000:3000"   # Grafana (no login)
      - "4317:4317"   # OTLP gRPC
      - "4318:4318"   # OTLP HTTP
    volumes:
      - ./infra/grafana/dashboards.yaml:/otel-lgtm/grafana/conf/provisioning/dashboards/boxoffice.yaml:ro
      - ./infra/grafana/dashboards:/otel-lgtm/boxoffice-dashboards:ro
      - ./infra/grafana/alerting:/otel-lgtm/grafana/conf/provisioning/alerting:ro
```

Os três volumes carregam o *seu* dashboard e as suas regras de alerta na inicialização; os arquivos
são criados no [passo 2](../dashboard/index.md) e no [passo 3](../slo/index.md).

## O agente: um jar, nenhum código { #the-agent-one-jar-no-code }

O **agente Java do OpenTelemetry** é conectado à JVM com `-javaagent`. No carregamento das classes ele
reescreve o bytecode das bibliotecas que conhece — Spring MVC e WebFlux, os clientes HTTP, JDBC e
HikariCP, Kafka, Redis, logback, a própria JVM — para que cada requisição vire um **span**, cada
biblioteca reporte **métricas** com nomes padronizados (as *convenções semânticas* do OpenTelemetry) e
cada linha de log carregue o **trace id** da requisição que a escreveu.

Baixe-o uma vez em `infra/otel/` (são 26 MB: o `.gitignore` o mantém fora do Git, e cada clone roda o
script):

``` shell title="scripts/get-otel-agent.sh"
--8<-- "docs/2027.1/hands-on/8/code/scripts/get-otel-agent.sh"
```

``` text title=".gitignore"
--8<-- "docs/2027.1/hands-on/8/code/.gitignore"
```

<!-- termynal -->

``` shell
> sh scripts/get-otel-agent.sh
-rw-r--r--  1 you  staff  26418479 Oct 18 15:06 infra/otel/opentelemetry-javaagent.jar
```

As imagens **não** mudam: o Compose monta `infra/otel/` somente leitura em cada serviço Java e liga o
agente com variáveis de ambiente compartilhadas por uma **âncora** YAML:

``` yaml title="docker-compose.yaml (excerpt)"
# lab 8: OpenTelemetry settings shared by every Java service (merged into each "environment")
x-otel: &otel
  JAVA_TOOL_OPTIONS: -javaagent:/otel/opentelemetry-javaagent.jar
  OTEL_JAVAAGENT_ENABLED: ${OTEL_ON:-true}          # false = same image, agent off
  OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-lgtm:4318
  OTEL_METRIC_EXPORT_INTERVAL: "10000"              # 10 s instead of 60 s
  OTEL_RESOURCE_ATTRIBUTES: service.namespace=boxoffice,deployment.environment.name=local
  OTEL_TRACES_SAMPLER: ${OTEL_TRACES_SAMPLER:-parentbased_always_on}
  OTEL_TRACES_SAMPLER_ARG: ${OTEL_TRACES_SAMPLER_ARG:-1.0}
  LOGGING_PATTERN_CORRELATION: "[%X{trace_id:-},%X{span_id:-}] "   # trace id in console logs

# ... and in every Java service, for example:
  order:
    build: ./services/order
    volumes:
      - ./infra/otel:/otel:ro
    environment:
      <<: *otel
      OTEL_SERVICE_NAME: order
```

| Variável | Efeito |
|---|---|
| `JAVA_TOOL_OPTIONS` | a JVM a lê antes do `main`: conecta o agente sem mudar a imagem nem o `ENTRYPOINT` |
| `OTEL_JAVAAGENT_ENABLED` | `false` desliga o agente com a mesma imagem — usado no passo [Meça](../measure/index.md) |
| `OTEL_SERVICE_NAME` | o atributo `service.name`: o nome pelo qual você filtra em todo lugar. As réplicas `catalog-1..3` usam todas `catalog`: **um serviço**, três **instâncias** |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | para onde enviar; o agente usa OTLP sobre HTTP (`4318`) por padrão |
| `OTEL_METRIC_EXPORT_INTERVAL` | 10 s em vez dos 60 s padrão, para que os dashboards reajam durante o lab |
| `OTEL_RESOURCE_ATTRIBUTES` | atributos extras em todo sinal; `service.namespace` agrupa os serviços do BoxOffice |
| `OTEL_TRACES_SAMPLER` | quais requisições são rastreadas; todas por padrão (o experimento B do [Meça](../measure/index.md) muda isso) |
| `LOGGING_PATTERN_CORRELATION` | o `logging.pattern.correlation` do Spring Boot: imprime `[trace id,span id]` em toda linha do console |

Pegue o arquivo completo deste lab (é o arquivo do lab 7 mais a âncora, os volumes e o `otel-lgtm`):

``` shell
curl -fsSL -o docker-compose.yaml https://insper.github.io/platform/2027.1/hands-on/8/code/docker-compose.yaml
```

??? example "docker-compose.yaml — o arquivo completo ao fim deste lab"

    ``` yaml title="docker-compose.yaml"
    --8<-- "docs/2027.1/hands-on/8/code/docker-compose.yaml"
    ```

Crie as pastas de provisionamento (o passo 2 as preenche) e reinicie tudo — os serviços Java
reiniciam para pegar o agente:

<!-- termynal -->

``` shell
> mkdir -p infra/grafana/dashboards infra/grafana/alerting
> docker compose up -d
> docker compose logs catalog-1 | grep -m1 javaagent
catalog-1-1  | [otel.javaagent 2026-10-18 18:08:22:121 +0000] [main] INFO io.opentelemetry.javaagent.tooling.VersionLogger - opentelemetry-javaagent - version: 2.32.0
> curl -s -o /dev/null -w '%{http_code}\n' localhost/catalog/events/1
200
```

Com o agente, cada JVM sobe visivelmente mais devagar (a instrumentação acontece no carregamento das
classes): espere até o `docker compose ps` mostrar todos os serviços `healthy`.

Abra o Grafana em `http://localhost:3000` (sem login nesta imagem) → **Explore**. Você deve ver:

- **Prometheus**: `sum by (service_name) (http_server_request_duration_seconds_count)` devolve uma linha
  por serviço — `auth`, `catalog`, `gateway`, `inventory`, `notification`, `order`. Cada série tem
  labels como `http_route="/catalog/events/{id}"`, `http_request_method="GET"` e
  `http_response_status_code="200"` — a rota é o *template*, nunca a URL crua, o que mantém o número de
  séries limitado.
- **Tempo**: busque pelo serviço `gateway`. Uma requisição pela borda mostra spans do `gateway` e do
  `catalog`, e dentro do `catalog` um span por comando SQL.
- **Loki**: `{service_name="order"}`. Cada linha tem `trace_id` e `span_id`, e um botão que leva ao
  trace. O console também: `docker compose logs order` imprime linhas como
  `[14263dc50b861be8bcf0bc1f4dbad3c5,a1c96ae57fb41b45] o.s.web.servlet.DispatcherServlet …`.

!!! info "Os nomes das métricas seguem as convenções semânticas"

    O histograma de duração de servidor HTTP se chama `http.server.request.duration` no
    OpenTelemetry; o Prometheus o recebe como `http_server_request_duration_seconds_bucket`, `_count` e
    `_sum` (pontos viram sublinhados, a unidade vira sufixo). Atributos de recurso como `service.name`
    viram labels (`service_name`) e o `job` vira `boxoffice/catalog` (namespace/nome). Todos os
    dashboards e alertas deste lab dependem desses nomes.

## O salto que o agente não enxerga: o outbox { #the-hop-the-agent-cannot-see-the-outbox }

Faça um pedido e procure o trace dele no Tempo. Com o código do lab 7 você encontra **dois traces sem
relação**: um para o `POST /orders` (order → INSERTs) e outro que começa na tarefa agendada do relay do
outbox e continua pelo Kafka até o `notification`. O agente propaga o contexto em chamadas HTTP e
mensagens Kafka automaticamente, mas o outbox é uma **linha do banco** lida depois por outra thread: o
contexto da requisição não está na linha, então se perde.

``` diagram-sim
sequenceDiagram
    participant O as order (thread HTTP)
    participant DB as tabela outbox
    participant R as relay (thread do agendador)
    participant K as Kafka
    participant N as notification
    O->>DB: INSERT da linha do outbox + traceparent da requisição
    R->>DB: SELECT da linha (com o seu traceparent)
    Note over R: torna esse contexto o atual
    R->>K: send: o agente injeta o MESMO trace id nos headers
    K->>N: consumo: o agente continua o trace
```

A correção é a mesma ideia que o W3C Trace Context usa no HTTP: **levar o `traceparent` junto com o
dado**. Guarde-o na linha do outbox e torne-o o contexto atual quando o relay publicar. Quatro arquivos
do `order` mudam:

=== "V2__outbox_traceparent.sql"

    ``` sql title="services/order/src/main/resources/db/migration/V2__outbox_traceparent.sql"
    --8<-- "docs/2027.1/hands-on/8/code/services/order/src/main/resources/db/migration/V2__outbox_traceparent.sql"
    ```

=== "pom.xml"

    ``` xml title="services/order/pom.xml"
    --8<-- "docs/2027.1/hands-on/8/code/services/order/pom.xml"
    ```

=== "Outbox.java"

    ``` java title="services/order/src/main/java/boxoffice/order/outbox/Outbox.java"
    --8<-- "docs/2027.1/hands-on/8/code/services/order/src/main/java/boxoffice/order/outbox/Outbox.java"
    ```

=== "OutboxRelay.java"

    ``` java title="services/order/src/main/java/boxoffice/order/outbox/OutboxRelay.java"
    --8<-- "docs/2027.1/hands-on/8/code/services/order/src/main/java/boxoffice/order/outbox/OutboxRelay.java"
    ```

O `pom.xml` adiciona só `io.opentelemetry:opentelemetry-api` (a versão vem do Spring Boot): sem o
agente, toda chamada da API é uma operação vazia, então o serviço continua rodando sem ele.

Reconstrua o `order`, faça um pedido e encontre o seu trace:

``` shell
docker compose up -d --build order
curl -s -X POST localhost:8084/orders -H 'Content-Type: application/json' \
  -d '{"showId":"show-7","holdId":"trace-1","customerEmail":"t@example.com","amount":10}'
```

No Grafana → Explore → Tempo, rode a consulta TraceQL `{resource.service.name="order" && name="POST /orders"}`
e abra o trace mais recente. Você deve ver **um** trace com spans dos dois serviços, como este de uma
execução de teste (início relativo, serviço, span, duração):

``` text
    0.0 ms  order         POST /orders                         9.0 ms
    5.3 ms  order         INSERT boxoffice.orders              0.4 ms
    5.8 ms  order         SELECT boxoffice.orders              0.2 ms
    6.6 ms  order         INSERT boxoffice.outbox              0.2 ms
   22.3 ms  order         order-events publish                11.2 ms
   36.4 ms  notification  order-events process                67.2 ms
   38.1 ms  notification  INSERT boxoffice.processed_events    0.4 ms
   99.7 ms  notification  INSERT boxoffice.notifications       0.4 ms
```

A requisição levou 9 ms; o relay publicou 22 ms depois do início (o período de 200 ms do polling põe
isso em qualquer ponto entre 0 e 200 ms); o `notification` gastou 67 ms, a maior parte no provedor de
e-mail simulado de 50 ms — a latência assíncrona do lab 7, visível de relance. O primeiro pedido depois
de um reinício é bem mais lento (JVMs frias com o agente): olhe o segundo.

!!! tip "Na entrevista"

    "A propagação de contexto quebra em todo salto que não é uma chamada direta — filas, outboxes,
    jobs em lote. Eu levo o `traceparent` do W3C na mensagem ou na linha, e o consumidor continua o
    trace; para *fan-in* (um job processando muitas mensagens) eu uso **span links** em vez de um
    único pai."

[Próximo: Dashboard RED](../dashboard/index.md){ .md-button .md-button--primary }
