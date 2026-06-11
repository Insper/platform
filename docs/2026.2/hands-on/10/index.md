!!! info "Goal"

    Add **OpenTelemetry** instrumentation to every Spring Boot service so that a single user request — traversing **Gateway → OrderService → ProductService** — generates a unified distributed trace visible in **Jaeger**, with trace IDs automatically injected into log lines.

You already have Prometheus scraping metrics and Grafana displaying dashboards. Metrics answer "how much" and "how often". They cannot tell you *which* service inside a multi-hop request chain is responsible for a 2-second tail latency. Distributed tracing answers that question.

## The Problem This Solves

Consider a slow `/orders` response. Prometheus shows elevated `http_server_requests_seconds` on the gateway, but the gateway delegates to OrderService which in turn calls ProductService and the database. The metric cannot tell you where the time went.

Without tracing, the only option is to stare at logs across four separate services and guess.

``` mermaid
sequenceDiagram
    participant C as Client
    participant G as Gateway
    participant O as OrderService
    participant P as ProductService
    participant D as Database

    C->>G: POST /orders  (? ms)
    G->>O: POST /orders  (? ms)
    O->>P: GET /products/{id}  (? ms)
    P->>D: SELECT ...  (? ms)
    D-->>P: row
    P-->>O: ProductDTO
    O-->>G: OrderDTO
    G-->>C: 200 OK  (total: 2 340 ms)
```

With tracing, every hop is measured as a **span** and all spans for one request share a **trace ID**. The Jaeger UI renders the full call graph as a flame chart so you can see the slow span immediately.

``` mermaid
sequenceDiagram
    participant C as Client
    participant G as Gateway
    participant O as OrderService
    participant P as ProductService
    participant D as Database

    C->>G: POST /orders<br/>traceparent: 00-4bf9...36-01
    note over G: span: gateway.POST /orders (45 ms)
    G->>O: POST /orders<br/>traceparent: 00-4bf9...36-01
    note over O: span: order.POST /orders (2 250 ms)
    O->>P: GET /products/7<br/>traceparent: 00-4bf9...36-01
    note over P: span: product.GET /products/7 (2 190 ms)
    P->>D: SELECT ...
    note over D: span: jdbc.query (2 180 ms)
    D-->>P: row
    P-->>O: ProductDTO
    O-->>G: OrderDTO
    G-->>C: 200 OK  trace_id=4bf9...36
```

The bottleneck is immediately visible: the JDBC query inside ProductService accounts for almost all of the latency.

## Architecture

This hands-on adds Jaeger to the observability layer and wires the OpenTelemetry Java agent into each service container:

``` mermaid
flowchart LR
    subgraph obs [Observability Layer]
        prometheus@{ shape: cyl, label: "Prometheus\n:9090" }
        grafana[Grafana\n:3000]
        jaeger["Jaeger\n:16686 UI\n:4317 OTLP"]:::highlighted
        prometheus --> grafana
    end
    subgraph api [Trusted Layer]
        loadbalancer --> gateway
        gateway --> order
        gateway --> account
        order --> product
        order --> db@{ shape: cyl, label: "PostgreSQL" }
    end
    gateway & order & account & product e1@-->|"OTLP traces"| jaeger
    prometheus e2@-.->|"scrape /actuator/prometheus"| gateway & order & account & product
    internet e0@==>|":80"| loadbalancer
    e0@{ animate: true }
    e1@{ animate: true }
    e2@{ animate: true }
    classDef highlighted fill:#fcc
```

## Adding Jaeger to Docker Compose

[Jaeger](https://www.jaegertracing.io){target="_blank"} ships as a single `all-in-one` container that includes the collector, query engine, and UI. For production you would run these as separate components, but for local development the all-in-one image is sufficient.

Add the following service to `compose.yaml`:

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

!!! note "Port 4317 vs 4318"
    The OTel Java agent defaults to **gRPC** on port 4317. Port 4318 is for HTTP/protobuf. Both carry the same OTLP protocol — use 4317 unless a firewall forces HTTP.

## OpenTelemetry Java Agent

The OpenTelemetry Java agent is a JVM instrumentation agent — a single JAR you attach with `-javaagent`. It uses Java's bytecode instrumentation API to intercept Spring MVC, Spring WebClient, RestTemplate, JDBC drivers, and dozens of other libraries **without any code changes**.

### Download the agent

Add a download step to each service's Dockerfile:

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

!!! tip "Pin the agent version"
    The OTel agent version and the Spring Boot version must be compatible. v2.4.0 works with Spring Boot 3.x. Check the [compatibility matrix](https://github.com/open-telemetry/opentelemetry-java-instrumentation#supported-libraries-frameworks-and-application-servers){target="_blank"} before upgrading either dependency.

### Configure each service in Docker Compose

The agent is configured entirely through environment variables. Add the following `environment` block to each service in `compose.yaml`:

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

!!! warning "Why `OTEL_METRICS_EXPORTER: none`?"
    By default the OTel agent also tries to export metrics via OTLP. You are already collecting metrics with Prometheus and Micrometer — exporting them a second time to Jaeger would create duplicates and waste resources. Setting `none` disables the OTel metric pipeline while leaving trace export fully enabled.

## Trace Propagation — How It Works

When the agent intercepts an outgoing HTTP call, it injects the **W3C `traceparent` header** into the request. The receiving service's agent reads that header and creates a child span under the same trace.

The `traceparent` format is:

```
00-{traceId}-{parentSpanId}-{flags}
 │   │            │               │
 │   │            │               └── 01 = sampled, 00 = not sampled
 │   │            └── 16-char parent span ID (hex)
 │   └── 32-char trace ID (hex) — identical on every hop
 └── version byte (always 00)
```

Example value seen in HTTP headers:

```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

The trace ID `4bf92f3577b34da6a3ce929d0e0e4736` is present on every service in the chain. All spans carrying that ID are grouped into one trace in Jaeger.

``` mermaid
sequenceDiagram
    participant G as Gateway Agent
    participant O as Order Agent
    participant P as Product Agent

    G->>G: start root span<br/>traceId=4bf9...  spanId=aaa1
    G->>O: POST /orders<br/>traceparent: 00-4bf9...-aaa1-01
    O->>O: start child span<br/>traceId=4bf9...  spanId=bbb2  parent=aaa1
    O->>P: GET /products/7<br/>traceparent: 00-4bf9...-bbb2-01
    P->>P: start child span<br/>traceId=4bf9...  spanId=ccc3  parent=bbb2
    P-->>O: 200
    O-->>G: 200
    G->>G: end root span → export to Jaeger
    O->>O: end child span → export to Jaeger
    P->>P: end child span → export to Jaeger
```

!!! note "Sampling"
    The `01` flags byte means the trace is sampled and will be exported. The default sampler exports 100% of traces. For production, switch to a rate-limiting sampler: set `OTEL_TRACES_SAMPLER=parentbased_traceidratio` and `OTEL_TRACES_SAMPLER_ARG=0.1` to sample 10% of requests.

## Correlating Traces with Logs

A trace ID in Jaeger is only useful if you can find the matching log lines. The OTel agent bridges both worlds: it injects the active trace ID and span ID into SLF4J's MDC, so every log statement emitted during a traced request automatically carries the trace context.

### Add the logback bridge dependency

In each service's `pom.xml`:

``` xml
<dependency>
    <groupId>io.opentelemetry.instrumentation</groupId>
    <artifactId>opentelemetry-logback-appender-1.0</artifactId>
    <version>2.4.0-alpha</version>
    <scope>runtime</scope>
</dependency>
```

### Configure logback-spring.xml

Create `src/main/resources/logback-spring.xml` in each service:

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

!!! tip "MDC key names"
    The OTel agent writes trace context under the keys `trace_id` and `span_id` in SLF4J MDC. These match the OTLP/W3C naming convention and are directly searchable in Loki, CloudWatch Insights, Splunk, and most other log aggregators.

With this configuration, every log line during a traced request will look like:

```
14:23:01.442 [http-nio-8080-exec-3] INFO  c.example.order.OrderService
    [trace_id=4bf92f3577b34da6a3ce929d0e0e4736 span_id=00f067aa0ba902b7] - creating order for account 42
14:23:01.501 [http-nio-8080-exec-3] INFO  c.example.order.OrderService
    [trace_id=4bf92f3577b34da6a3ce929d0e0e4736 span_id=00f067aa0ba902b7] - calling ProductService for product id 7
```

**Workflow**: open the slow trace in Jaeger → click the problematic span → copy the `trace_id` value → paste it into your log aggregator's search bar → all log lines from that exact request appear together.

## Viewing Traces in Jaeger UI

Rebuild and start the full stack:

``` { .bash .copy .select }
docker compose up -d --build
```

Verify Jaeger started:

``` { .bash .copy .select }
docker compose ps jaeger
```

Expected output:

```
NAME      IMAGE                          STATUS    PORTS
jaeger    jaegertracing/all-in-one:1.57  running   0.0.0.0:4317->4317/tcp, 0.0.0.0:16686->16686/tcp
```

Generate some traffic so there are traces to explore:

``` { .bash .copy .select }
curl -s -X POST http://localhost/orders \
  -H "Content-Type: application/json" \
  -d '{"accountId": 1, "productId": 7, "quantity": 2}' | jq
```

Open **[http://localhost:16686](http://localhost:16686){target="_blank"}** in your browser.

### Finding a trace

1. In the **Service** dropdown, select `gateway-service`.
2. Leave Operation as `all` and click **Find Traces**.
3. The results list recent traces sorted by timestamp. Each row shows the root operation name, total duration, and span count.
4. Click any trace to open the flame chart view.

### Reading the flame chart

The flame chart renders each span as a horizontal bar. The root span (gateway) is at the top. Child spans are indented below their parent. Bar width is proportional to duration — a wide bar is a slow operation.

!!! example "What to look for"
    - A span nearly as wide as the root span is the primary latency contributor.
    - Spans labelled `SELECT` or `jdbc.query` with long duration indicate slow database queries.
    - Spans labelled `HTTP GET` or `HTTP POST` are outbound HTTP calls captured by the agent.
    - A span with a red `!` icon recorded an exception — click it to see the full stack trace attached as a span event.

### Span attributes

Clicking a span expands its tags. The agent records these automatically:

| Tag | Example value |
|---|---|
| `http.method` | `POST` |
| `http.url` | `http://order:8080/orders` |
| `http.status_code` | `200` |
| `db.system` | `postgresql` |
| `db.statement` | `SELECT * FROM products WHERE id = ?` |
| `net.peer.name` | `db` |

## Adding Custom Spans

The Java agent instruments framework code automatically, but it knows nothing about your business logic. When validation, pricing calculation, or any significant processing step needs to be traced individually, add a **manual span**.

### Add the OpenTelemetry API dependency

``` xml
<dependency>
    <groupId>io.opentelemetry</groupId>
    <artifactId>opentelemetry-api</artifactId>
</dependency>
```

Spring Boot's dependency management includes `opentelemetry-bom`, so no version is needed here.

### Instrument business logic

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

!!! warning "Always call `span.end()` in a `finally` block"
    If `span.end()` is never called, the span is never exported to Jaeger. The `try-finally` pattern guarantees cleanup even when an exception is thrown. The agent handles this automatically for framework code; manual spans are your responsibility.

!!! note "When to add manual spans"
    Add manual spans when: (1) a method takes more than ~50 ms and you want to measure it independently, (2) you need to attach business-level attributes (`order.id`, `account.tier`) that are not captured by framework instrumentation, or (3) you need to record a caught exception as a span event. Do **not** add manual spans to trivial getters or field assignments — the noise obscures the useful data.

## Checklist

Before moving on, verify:

- [ ] `docker compose ps` shows `jaeger` running with ports 16686 and 4317 exposed
- [ ] `http://localhost:16686` loads the Jaeger UI without errors
- [ ] After sending a request, `gateway-service` appears in the Jaeger service dropdown
- [ ] A trace for `POST /orders` contains at least 3 spans: gateway, order-service, product-service
- [ ] Each span has `http.method` and `http.status_code` tags set by the agent automatically
- [ ] Log output includes `trace_id=` fields that match the trace ID shown in Jaeger

---

[Quiz](./quiz.md){ .md-button }
