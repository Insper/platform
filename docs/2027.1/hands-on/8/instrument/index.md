# 1. Instrument Everything

In this step every Java service starts sending **traces, metrics and logs** to one container,
`otel-lgtm`, without a single change to business code. Then you fix the one place where automatic
instrumentation cannot see the request: the outbox hop of [lab 7](../../7/index.md). All commands
run from the **root of your `boxoffice` repository**.

## The backend: `otel-lgtm`

`grafana/otel-lgtm` packs a whole observability backend into one image, for development and
teaching: an **OpenTelemetry Collector** receives OTLP (the OpenTelemetry Protocol) and routes each
signal to **Prometheus** (metrics), **Tempo** (traces) and **Loki** (logs), with **Grafana** on top,
already wired so that a metric exemplar opens its trace and a trace opens its logs. In production
these are separate, replicated systems (or a managed service); the protocol your services speak —
OTLP — stays the same.

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

The three volumes load *your* dashboard and alert rules at startup; their files are created in
[step 2](../dashboard/index.md) and [step 3](../slo/index.md).

## The agent: one jar, no code

The **OpenTelemetry Java agent** is attached to the JVM with `-javaagent`. At class-loading time it
rewrites the bytecode of the libraries it knows — Spring MVC and WebFlux, the HTTP clients, JDBC and
HikariCP, Kafka, Redis, logback, the JVM itself — so that each request becomes a **span**, each
library reports **metrics** with standard names (the OpenTelemetry *semantic conventions*), and each
log line carries the **trace id** of the request that wrote it.

Download it once into `infra/otel/` (it is 26 MB: `.gitignore` keeps it out of Git, and every
clone runs the script):

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

The images do **not** change: Compose mounts `infra/otel/` read-only into every Java service and
turns the agent on with environment variables shared through a YAML **anchor**:

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

| Variable | Effect |
|---|---|
| `JAVA_TOOL_OPTIONS` | the JVM reads it before `main`: attaches the agent without changing the image or the `ENTRYPOINT` |
| `OTEL_JAVAAGENT_ENABLED` | `false` turns the agent off with the same image — used in the [Measure it](../measure/index.md) step |
| `OTEL_SERVICE_NAME` | the `service.name` attribute: the name you filter by everywhere. The replicas `catalog-1..3` all use `catalog`: **one service**, three **instances** |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | where to send; the agent uses OTLP over HTTP (`4318`) by default |
| `OTEL_METRIC_EXPORT_INTERVAL` | 10 s instead of the default 60 s, so that dashboards react during a lab |
| `OTEL_RESOURCE_ATTRIBUTES` | extra attributes on every signal; `service.namespace` groups the BoxOffice services |
| `OTEL_TRACES_SAMPLER` | which requests are traced; all of them by default (experiment B of [Measure it](../measure/index.md) changes it) |
| `LOGGING_PATTERN_CORRELATION` | Spring Boot's `logging.pattern.correlation`: prints `[trace id,span id]` in every console line |

Get the complete file of this lab (it is the lab 7 file plus the anchor, the volumes and
`otel-lgtm`):

``` shell
curl -fsSL -o docker-compose.yaml https://insper.github.io/platform/2027.1/hands-on/8/code/docker-compose.yaml
```

??? example "docker-compose.yaml — the complete file at the end of this lab"

    ``` yaml title="docker-compose.yaml"
    --8<-- "docs/2027.1/hands-on/8/code/docker-compose.yaml"
    ```

Create the provisioning folders (step 2 fills them) and restart everything — the Java services
restart to pick up the agent:

<!-- termynal -->

``` shell
> mkdir -p infra/grafana/dashboards infra/grafana/alerting
> docker compose up -d
> docker compose logs catalog-1 | grep -m1 javaagent
catalog-1-1  | [otel.javaagent 2026-10-18 18:08:22:121 +0000] [main] INFO io.opentelemetry.javaagent.tooling.VersionLogger - opentelemetry-javaagent - version: 2.32.0
> curl -s -o /dev/null -w '%{http_code}\n' localhost/catalog/events/1
200
```

With the agent, each JVM starts noticeably slower (instrumentation happens at class loading): wait
until `docker compose ps` shows every service `healthy`.

Open Grafana at `http://localhost:3000` (no login in this image) → **Explore**. You should see:

- **Prometheus**: `sum by (service_name) (http_server_request_duration_seconds_count)` returns one line
  per service — `auth`, `catalog`, `gateway`, `inventory`, `notification`, `order`. Each series has
  labels such as `http_route="/catalog/events/{id}"`, `http_request_method="GET"` and
  `http_response_status_code="200"` — the route is the *template*, never the raw URL, which keeps the
  number of series bounded.
- **Tempo**: search by service `gateway`. A request through the edge shows spans from `gateway` and
  `catalog`, and inside `catalog` one span per SQL statement.
- **Loki**: `{service_name="order"}`. Each line has `trace_id` and `span_id`, and a button that jumps
  to the trace. The console has them too: `docker compose logs order` prints lines like
  `[14263dc50b861be8bcf0bc1f4dbad3c5,a1c96ae57fb41b45] o.s.web.servlet.DispatcherServlet …`.

!!! info "Metric names follow the semantic conventions"

    The HTTP server duration histogram is called `http.server.request.duration` in OpenTelemetry;
    Prometheus receives it as `http_server_request_duration_seconds_bucket`, `_count` and `_sum` (dots
    become underscores, the unit becomes a suffix). Resource attributes such as `service.name` become
    labels (`service_name`) and `job` becomes `boxoffice/catalog` (namespace/name). Every dashboard
    and alert of this lab relies on these names.

## The hop the agent cannot see: the outbox

Place an order and look for its trace in Tempo. With the lab 7 code you find **two unrelated
traces**: one for `POST /orders` (order → INSERTs), and another one that starts in the outbox relay's
scheduled job and continues through Kafka to `notification`. The agent propagates context across
HTTP calls and Kafka messages automatically, but the outbox is a **database row** read later by a
different thread: the context of the request is not in the row, so it is lost.

``` mermaid-sim
sequenceDiagram
    participant O as order (HTTP thread)
    participant DB as outbox table
    participant R as relay (scheduler thread)
    participant K as Kafka
    participant N as notification
    O->>DB: INSERT outbox row + traceparent of the request
    R->>DB: SELECT row (with its traceparent)
    Note over R: make that context current
    R->>K: send: the agent injects the SAME trace id in the headers
    K->>N: consume: the agent continues the trace
```

The fix is the same idea W3C Trace Context uses on HTTP: **carry the `traceparent` with the data**.
Store it in the outbox row, and make it the current context when the relay publishes. Four files of
`order` change:

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

The `pom.xml` adds only `io.opentelemetry:opentelemetry-api` (the version comes from Spring Boot):
without the agent, every call of the API is a no-op, so the service still runs without it.

Rebuild `order`, place an order and find its trace:

``` shell
docker compose up -d --build order
curl -s -X POST localhost:8084/orders -H 'Content-Type: application/json' \
  -d '{"showId":"show-7","holdId":"trace-1","customerEmail":"t@example.com","amount":10}'
```

In Grafana → Explore → Tempo, run the TraceQL query `{resource.service.name="order" && name="POST /orders"}`
and open the most recent trace. You should see **one** trace with spans of both services, like this
one from a test run (start offset, service, span, duration):

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

The request itself took 9 ms; the relay published 22 ms after it started (its 200 ms polling period
puts this anywhere between 0 and 200 ms); `notification` spent 67 ms, most of it in the simulated
50 ms e-mail provider — the asynchronous latency of lab 7, visible at a glance. The very first order
after a restart is much slower (cold JVMs with the agent): look at the second one.

!!! tip "In the interview"

    "Context propagation breaks at every hop that is not a direct call — queues, outboxes, batch jobs.
    I carry the W3C `traceparent` in the message or the row, and the consumer continues the trace; for
    fan-in (one job processing many messages) I use **span links** instead of a single parent."

[Next: RED dashboard](../dashboard/index.md){ .md-button .md-button--primary }
