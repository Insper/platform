!!! info "Objetivo"

    Adicionar instrumentação **OpenTelemetry** a todos os serviços Spring Boot para que uma única requisição de usuário — passando por **Gateway → OrderService → ProductService** — gere um trace distribuído unificado, visível no **Jaeger**, com os trace IDs injetados automaticamente nas linhas de log.

Você já tem o Prometheus coletando métricas e o Grafana exibindo dashboards. Métricas respondem "quanto" e "com que frequência". Elas não conseguem dizer *qual* serviço, dentro de uma cadeia de requisições com vários saltos, é o responsável por uma latência de cauda de 2 segundos. O rastreamento distribuído responde a essa pergunta.

## Slides

<div class="slides-embed">
  <iframe src="slides/tracing.pt.html" title="Slides: rastreamento distribuído" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/tracing.pt.html){:target="_blank"}

## O problema que isso resolve

Considere uma resposta lenta de `/orders`. O Prometheus mostra `http_server_requests_seconds` elevado no gateway, mas o gateway delega ao OrderService, que por sua vez chama o ProductService e o banco de dados. A métrica não consegue dizer para onde foi o tempo.

Sem rastreamento, a única opção é ficar olhando os logs de quatro serviços separados e chutar.

``` mermaid-sim
sequenceDiagram
    participant C as Cliente
    participant G as Gateway
    participant O as OrderService
    participant P as ProductService
    participant D as Banco de dados

    C->>G: POST /orders  (? ms)
    G->>O: POST /orders  (? ms)
    O->>P: GET /products/{id}  (? ms)
    P->>D: SELECT ...  (? ms)
    D-->>P: linha
    P-->>O: ProductDTO
    O-->>G: OrderDTO
    G-->>C: 200 OK  (total: 2 340 ms)
```

Com rastreamento, cada salto é medido como um **span**, e todos os spans de uma requisição compartilham um **trace ID**. A UI do Jaeger desenha o grafo de chamadas completo como um flame chart, para que você veja o span lento imediatamente.

``` mermaid-sim
sequenceDiagram
    participant C as Cliente
    participant G as Gateway
    participant O as OrderService
    participant P as ProductService
    participant D as Banco de dados

    C->>G: POST /orders<br/>traceparent: 00-4bf9...36-01
    note over G: span: gateway.POST /orders (45 ms)
    G->>O: POST /orders<br/>traceparent: 00-4bf9...36-01
    note over O: span: order.POST /orders (2 250 ms)
    O->>P: GET /products/7<br/>traceparent: 00-4bf9...36-01
    note over P: span: product.GET /products/7 (2 190 ms)
    P->>D: SELECT ...
    note over D: span: jdbc.query (2 180 ms)
    D-->>P: linha
    P-->>O: ProductDTO
    O-->>G: OrderDTO
    G-->>C: 200 OK  trace_id=4bf9...36
```

O gargalo fica visível na hora: a query JDBC dentro do ProductService responde por quase toda a latência.

## Arquitetura

Este hands-on adiciona o Jaeger à camada de observabilidade e conecta o agente Java do OpenTelemetry ao container de cada serviço:

``` mermaid-sim
flowchart LR
    subgraph obs [Camada de observabilidade]
        prometheus@{ shape: cyl, label: "Prometheus\n:9090" }
        grafana[Grafana\n:3000]
        jaeger["Jaeger\n:16686 UI\n:4317 OTLP"]:::highlighted
        prometheus --> grafana
    end
    subgraph api [Camada confiável]
        loadbalancer --> gateway
        gateway --> order
        gateway --> account
        order --> product
        order --> db@{ shape: cyl, label: "PostgreSQL" }
    end
    gateway & order & account & product e1@-->|"traces OTLP"| jaeger
    prometheus e2@-.->|"scrape /actuator/prometheus"| gateway & order & account & product
    internet e0@==>|":80"| loadbalancer
    e0@{ animate: true }
    e1@{ animate: true }
    e2@{ animate: true }
    classDef highlighted fill:#fcc
```

## Adicionando o Jaeger ao Docker Compose

O [Jaeger](https://www.jaegertracing.io){target="_blank"} é distribuído como um único container `all-in-one` que inclui o coletor, o mecanismo de consulta e a UI. Em produção você rodaria esses componentes separadamente, mas para o desenvolvimento local a imagem all-in-one é suficiente.

Adicione o seguinte serviço ao `compose.yaml`:

``` yaml
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

!!! note "Porta 4317 vs 4318"
    O agente Java do OTel usa por padrão **gRPC** na porta 4317. A porta 4318 é para HTTP/protobuf. As duas transportam o mesmo protocolo OTLP — use a 4317, a menos que um firewall obrigue o uso de HTTP.

## Agente Java do OpenTelemetry

O agente Java do OpenTelemetry é um agente de instrumentação da JVM — um único JAR que você acopla com `-javaagent`. Ele usa a API de instrumentação de bytecode do Java para interceptar Spring MVC, Spring WebClient, RestTemplate, drivers JDBC e dezenas de outras bibliotecas **sem nenhuma alteração de código**.

### Baixe o agente

Adicione uma etapa de download ao Dockerfile de cada serviço:

``` dockerfile
FROM eclipse-temurin:21-jre-alpine

WORKDIR /app

ADD https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v2.4.0/opentelemetry-javaagent.jar \
    /app/opentelemetry-javaagent.jar

COPY target/*.jar app.jar

ENTRYPOINT ["java", \
  "-javaagent:/app/opentelemetry-javaagent.jar", \
  "-jar", "/app/app.jar"]
```

!!! tip "Fixe a versão do agente"
    A versão do agente OTel e a versão do Spring Boot precisam ser compatíveis. A v2.4.0 funciona com o Spring Boot 3.x. Consulte a [matriz de compatibilidade](https://github.com/open-telemetry/opentelemetry-java-instrumentation#supported-libraries-frameworks-and-application-servers){target="_blank"} antes de atualizar qualquer uma das duas dependências.

### Configure cada serviço no Docker Compose

O agente é configurado inteiramente por variáveis de ambiente. Adicione o seguinte bloco `environment` a cada serviço no `compose.yaml`:

=== "gateway-service"

    ``` yaml
      gateway:
        build: ./gateway-service
        environment:
          OTEL_SERVICE_NAME: gateway-service
          OTEL_EXPORTER_OTLP_ENDPOINT: http://jaeger:4317
          OTEL_METRICS_EXPORTER: none
          OTEL_LOGS_EXPORTER: none
          OTEL_PROPAGATORS: tracecontext,baggage
    ```

=== "order-service"

    ``` yaml
      order:
        build: ./order-service
        environment:
          OTEL_SERVICE_NAME: order-service
          OTEL_EXPORTER_OTLP_ENDPOINT: http://jaeger:4317
          OTEL_METRICS_EXPORTER: none
          OTEL_LOGS_EXPORTER: none
          OTEL_PROPAGATORS: tracecontext,baggage
    ```

=== "product-service"

    ``` yaml
      product:
        build: ./product-service
        environment:
          OTEL_SERVICE_NAME: product-service
          OTEL_EXPORTER_OTLP_ENDPOINT: http://jaeger:4317
          OTEL_METRICS_EXPORTER: none
          OTEL_LOGS_EXPORTER: none
          OTEL_PROPAGATORS: tracecontext,baggage
    ```

=== "account-service"

    ``` yaml
      account:
        build: ./account-service
        environment:
          OTEL_SERVICE_NAME: account-service
          OTEL_EXPORTER_OTLP_ENDPOINT: http://jaeger:4317
          OTEL_METRICS_EXPORTER: none
          OTEL_LOGS_EXPORTER: none
          OTEL_PROPAGATORS: tracecontext,baggage
    ```

!!! warning "Por que `OTEL_METRICS_EXPORTER: none`?"
    Por padrão, o agente OTel também tenta exportar métricas via OTLP. Você já coleta métricas com Prometheus e Micrometer — exportá-las uma segunda vez para o Jaeger criaria duplicatas e desperdiçaria recursos. Definir `none` desativa o pipeline de métricas do OTel, mantendo a exportação de traces totalmente ativa.

## Propagação de traces — como funciona

Quando o agente intercepta uma chamada HTTP de saída, ele injeta o **cabeçalho W3C `traceparent`** na requisição. O agente do serviço que a recebe lê esse cabeçalho e cria um span filho no mesmo trace.

O formato do `traceparent` é:

```
00-{traceId}-{parentSpanId}-{flags}
 │   │            │               │
 │   │            │               └── 01 = sampled, 00 = not sampled
 │   │            └── 16-char parent span ID (hex)
 │   └── 32-char trace ID (hex) — identical on every hop
 └── version byte (always 00)
```

Exemplo de valor visto nos cabeçalhos HTTP:

```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

O trace ID `4bf92f3577b34da6a3ce929d0e0e4736` está presente em todos os serviços da cadeia. Todos os spans que carregam esse ID são agrupados em um único trace no Jaeger.

``` mermaid-sim
sequenceDiagram
    participant G as Agente do Gateway
    participant O as Agente do Order
    participant P as Agente do Product

    G->>G: inicia o span raiz<br/>traceId=4bf9...  spanId=aaa1
    G->>O: POST /orders<br/>traceparent: 00-4bf9...-aaa1-01
    O->>O: inicia span filho<br/>traceId=4bf9...  spanId=bbb2  parent=aaa1
    O->>P: GET /products/7<br/>traceparent: 00-4bf9...-bbb2-01
    P->>P: inicia span filho<br/>traceId=4bf9...  spanId=ccc3  parent=bbb2
    P-->>O: 200
    O-->>G: 200
    G->>G: encerra o span raiz → exporta para o Jaeger
    O->>O: encerra o span filho → exporta para o Jaeger
    P->>P: encerra o span filho → exporta para o Jaeger
```

!!! note "Amostragem"
    O byte de flags `01` significa que o trace foi amostrado e será exportado. O sampler padrão exporta 100% dos traces. Em produção, troque por um sampler com limitação de taxa: defina `OTEL_TRACES_SAMPLER=parentbased_traceidratio` e `OTEL_TRACES_SAMPLER_ARG=0.1` para amostrar 10% das requisições.

## Correlacionando traces com logs

Um trace ID no Jaeger só é útil se você conseguir encontrar as linhas de log correspondentes. O agente OTel faz a ponte entre os dois mundos: ele injeta o trace ID e o span ID ativos no MDC do SLF4J, de modo que toda instrução de log emitida durante uma requisição rastreada carrega automaticamente o contexto do trace.

### Adicione a dependência da ponte com o logback

No `pom.xml` de cada serviço:

``` xml
<dependency>
    <groupId>io.opentelemetry.instrumentation</groupId>
    <artifactId>opentelemetry-logback-appender-1.0</artifactId>
    <version>2.4.0-alpha</version>
    <scope>runtime</scope>
</dependency>
```

### Configure o logback-spring.xml

Crie `src/main/resources/logback-spring.xml` em cada serviço:

``` xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
    <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <encoder>
            <pattern>
                %d{HH:mm:ss.SSS} [%thread] %-5level %logger{36}
                [trace_id=%X{trace_id} span_id=%X{span_id}] - %msg%n
            </pattern>
        </encoder>
    </appender>

    <root level="INFO">
        <appender-ref ref="CONSOLE"/>
    </root>
</configuration>
```

!!! tip "Nomes das chaves no MDC"
    O agente OTel grava o contexto do trace nas chaves `trace_id` e `span_id` do MDC do SLF4J. Elas seguem a convenção de nomes do OTLP/W3C e podem ser pesquisadas diretamente no Loki, no CloudWatch Insights, no Splunk e na maioria dos outros agregadores de logs.

Com essa configuração, cada linha de log durante uma requisição rastreada vai ficar assim:

```
14:23:01.442 [http-nio-8080-exec-3] INFO  c.example.order.OrderService
    [trace_id=4bf92f3577b34da6a3ce929d0e0e4736 span_id=00f067aa0ba902b7] - creating order for account 42
14:23:01.501 [http-nio-8080-exec-3] INFO  c.example.order.OrderService
    [trace_id=4bf92f3577b34da6a3ce929d0e0e4736 span_id=00f067aa0ba902b7] - calling ProductService for product id 7
```

**Fluxo de trabalho**: abra o trace lento no Jaeger → clique no span problemático → copie o valor de `trace_id` → cole-o na barra de busca do seu agregador de logs → todas as linhas de log daquela requisição exata aparecem juntas.

## Visualizando traces na UI do Jaeger

Refaça o build e suba a stack completa:

``` { .bash .copy .select }
docker compose up -d --build
```

Verifique se o Jaeger subiu:

``` { .bash .copy .select }
docker compose ps jaeger
```

Saída esperada:

```
NAME      IMAGE                          STATUS    PORTS
jaeger    jaegertracing/all-in-one:1.57  running   0.0.0.0:4317->4317/tcp, 0.0.0.0:16686->16686/tcp
```

Gere algum tráfego para que haja traces para explorar:

``` { .bash .copy .select }
curl -s -X POST http://localhost:8080/orders \
  -H "Content-Type: application/json" \
  -d '{"accountId": 1, "productId": 7, "quantity": 2}' | jq
```

Abra **[http://localhost:16686](http://localhost:16686){target="_blank"}** no navegador.

### Encontrando um trace

1. No menu **Service**, selecione `gateway-service`.
2. Deixe Operation como `all` e clique em **Find Traces**.
3. Os resultados listam os traces recentes ordenados por timestamp. Cada linha mostra o nome da operação raiz, a duração total e o número de spans.
4. Clique em qualquer trace para abrir a visualização em flame chart.

### Lendo o flame chart

O flame chart desenha cada span como uma barra horizontal. O span raiz (gateway) fica no topo. Os spans filhos aparecem recuados abaixo do pai. A largura da barra é proporcional à duração — uma barra larga é uma operação lenta.

!!! example "O que procurar"
    - Um span quase tão largo quanto o span raiz é o principal responsável pela latência.
    - Spans rotulados `SELECT` ou `jdbc.query` com longa duração indicam queries lentas no banco de dados.
    - Spans rotulados `HTTP GET` ou `HTTP POST` são chamadas HTTP de saída capturadas pelo agente.
    - Um span com um ícone `!` vermelho registrou uma exceção — clique nele para ver o stack trace completo anexado como um evento do span.

### Atributos do span

Clicar em um span expande suas tags. O agente registra estas automaticamente:

| Tag | Valor de exemplo |
|---|---|
| `http.method` | `POST` |
| `http.url` | `http://order:8080/orders` |
| `http.status_code` | `200` |
| `db.system` | `postgresql` |
| `db.statement` | `SELECT * FROM products WHERE id = ?` |
| `net.peer.name` | `db` |

## Adicionando spans personalizados

O agente Java instrumenta o código dos frameworks automaticamente, mas não sabe nada sobre a sua lógica de negócio. Quando uma validação, um cálculo de preço ou qualquer etapa de processamento relevante precisa ser rastreada individualmente, adicione um **span manual**.

### Adicione a dependência da API do OpenTelemetry

``` xml
<dependency>
    <groupId>io.opentelemetry</groupId>
    <artifactId>opentelemetry-api</artifactId>
</dependency>
```

O gerenciamento de dependências do Spring Boot inclui o `opentelemetry-bom`, então não é preciso informar a versão aqui.

### Instrumente a lógica de negócio

``` java
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.context.Scope;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class OrderService {

    @Autowired
    private Tracer tracer;

    public OrderOut create(OrderIn orderIn) {

        Span span = tracer.spanBuilder("validateOrder").startSpan();
        try (Scope scope = span.makeCurrent()) {
            span.setAttribute("order.account_id", orderIn.getAccountId());
            span.setAttribute("order.product_id", orderIn.getProductId());

            validateAccount(orderIn.getAccountId());
            checkInventory(orderIn.getProductId(), orderIn.getQuantity());

        } catch (Exception e) {
            span.recordException(e);
            throw e;
        } finally {
            span.end();
        }

        return persist(orderIn);
    }
}
```

!!! warning "Sempre chame `span.end()` em um bloco `finally`"
    Se `span.end()` nunca for chamado, o span nunca é exportado para o Jaeger. O padrão `try-finally` garante a finalização mesmo quando uma exceção é lançada. O agente cuida disso automaticamente no código dos frameworks; os spans manuais são responsabilidade sua.

!!! note "Quando adicionar spans manuais"
    Adicione spans manuais quando: (1) um método leva mais de ~50 ms e você quer medi-lo de forma independente, (2) você precisa anexar atributos de negócio (`order.id`, `account.tier`) que não são capturados pela instrumentação dos frameworks, ou (3) você precisa registrar uma exceção capturada como um evento do span. **Não** adicione spans manuais a getters triviais ou atribuições de campos — o ruído esconde os dados úteis.

## Checklist

Antes de seguir em frente, verifique:

- [ ] `docker compose ps` mostra o `jaeger` rodando com as portas 16686 e 4317 expostas
- [ ] `http://localhost:16686` carrega a UI do Jaeger sem erros
- [ ] Depois de enviar uma requisição, `gateway-service` aparece no menu de serviços do Jaeger
- [ ] Um trace de `POST /orders` contém pelo menos 3 spans: gateway, order-service, product-service
- [ ] Cada span tem as tags `http.method` e `http.status_code` definidas automaticamente pelo agente
- [ ] A saída de log inclui campos `trace_id=` que correspondem ao trace ID mostrado no Jaeger

---

[Quiz](./quiz.md){ .md-button }
