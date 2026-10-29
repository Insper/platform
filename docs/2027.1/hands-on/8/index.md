# 8. Observability

!!! info "Goal"

    Make BoxOffice explain itself. Attach the **OpenTelemetry Java agent** to every service and send
    traces, metrics and logs to **`grafana/otel-lgtm`**; build a **RED dashboard** as code; follow one
    order from the edge through Kafka to the e-mail in a single **trace**; and turn a promise to users
    into an **SLO** with a **multiwindow burn-rate alert** — then break the database and time how
    long the alert takes to fire.

The flash sale went live, and the support channel fills up: *"checkout is slow"*, *"the page shows an
error"*. Is it every fan or a few? Which of the seven services? The database, the pool, Kafka, the
e-mail provider? Until now the only instrument was k6, which measures from the outside. This lab
adds the inside view — the three signals of the
[observability class](../../classes/observability/index.md): **metrics** say *that* something is
wrong and how much, **traces** say *where* in the request the time went, **logs** say *why*.

This lab builds chapter 9 of the [story of the course](../../index.md#story) in BoxOffice: the RED
dashboard of [signals](../../classes/observability/signals/index.md), the trace context carried
through the outbox and Kafka of [OpenTelemetry](../../classes/observability/opentelemetry/index.md),
and the [SLO](../../classes/observability/slo/index.md) with the multiwindow burn-rate alert of
[alerting](../../classes/observability/alerting/index.md). It comes right before
[lab 9](../9/index.md) for a reason: you instrument BoxOffice before you break it on purpose,
otherwise the chaos experiments of lab 9 have nothing to show.

## Slides

<div class="slides-embed">
  <iframe src="slides/observability.html" title="Slides: observability" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/observability.html){:target="_blank"}

## Before you start

| | |
|---|---|
| Time | about 4 hours |
| Tools | the lab 7 ones: Docker with Compose v2 (`docker compose version`), k6 (`k6 version`), `curl`, `jq`; a browser for Grafana |
| Docker resources | at least 4 CPUs and **8 GB** (`otel-lgtm` needs about 1.5 GB; every JVM grows a little with the agent) |
| Ports | free on your machine: 3000, 4317, 4318 (plus the lab 7 ones) |

Every command runs from the **root of your `boxoffice` repository**, which must be in the state lab 7
left it:

``` text title="Start state (end of lab 7)"
boxoffice/
├── docker-compose.yaml     # lab 6 stack + kafka, kafka-init, kafka-ui, mailpit, order, notification
├── infra/                  # nginx/, postgres/, pgbouncer/
├── load/                   # ... orders-load.js, waiting-room-spike.js
├── scripts/                # ... kafka-lag.sh
└── services/
    ├── auth/  catalog/  gateway/  inventory/
    ├── notification/
    └── order/
```

!!! tip "Catch up"

    Skipped or broke lab 7? Download [boxoffice-after-lab-7.zip](../7/boxoffice-after-lab-7.zip),
    unzip it, `cd boxoffice`, and continue from here.

Every file of this lab is shown in full on these pages and published under
`https://insper.github.io/platform/2027.1/hands-on/8/code/<path>`.

## Architecture

``` diagram-sim
flowchart LR
    k6[k6 / fans] --> edge[edge]
    edge --> gw[gateway]
    gw --> catalog[catalog x3]
    gw --> order[order]
    order -.->|outbox + Kafka| notification[notification]
    catalog -->|OTLP 4318| col
    gw -->|OTLP| col
    order -->|OTLP| col
    notification -->|OTLP| col
    subgraph lgtm [otel-lgtm]
        col[OTel Collector] --> prom[(Prometheus)]
        col --> tempo[(Tempo)]
        col --> loki[(Loki)]
        prom --> grafana[Grafana :3000]
        tempo --> grafana
        loki --> grafana
    end
    grafana -->|burn rate > 14.4| alert[alert: page]
```

Each service runs the agent and pushes **OTLP** (OpenTelemetry Protocol) to the collector inside
`otel-lgtm`, which stores each signal in its own database. Grafana links them: a point on a latency
chart opens its trace, a span opens the logs it wrote.

!!! example "BoxOffice components touched"

    | Palette component | In this lab |
    |---|---|
    | [Metrics](../../reference/components/observability/index.md#metrics) | Prometheus inside `otel-lgtm`; RED and USE panels |
    | [Tracing](../../reference/components/observability/index.md#tracing) | Tempo; one trace across HTTP, JDBC, the outbox and Kafka |
    | [Logs](../../reference/components/observability/index.md#logs) | Loki; every line carries `trace_id` |
    | [Alerting](../../reference/components/observability/index.md#alerting) | Grafana alert rules: multiwindow burn rate on the `catalog` SLO |
    | [Health Check](../../reference/components/observability/index.md#healthcheck) | the actuator probes, excluded from the SLI |

## What you will measure

| Question | Metric | Tool |
|---|---|---|
| What does the agent cost? | p50 / p95 / p99, CPU, memory, startup time with and without it | k6, `docker stats` |
| What does sampling save? | traces per minute, p95 | Tempo, k6 |
| How many time series does a service create? | series per service and per metric | PromQL |
| How long until a broken database pages someone? | stop → *Pending* → *Firing* | Grafana alerting |

## Prerequisites

- Labs [1](../1/index.md) to [7](../7/index.md) done: BoxOffice runs with the edge, the gateway,
  `catalog` replicas, `inventory`, `order`, `notification` and Kafka.
- Around 1.5 GB of free memory for `otel-lgtm`.
- Read the [observability class](../../classes/observability/index.md), especially
  [signals](../../classes/observability/signals/index.md),
  [OpenTelemetry](../../classes/observability/opentelemetry/index.md) and
  [alerting](../../classes/observability/alerting/index.md).

## Steps

1. [Instrument everything](instrument/index.md) — `otel-lgtm`, the Java agent in every service, logs with trace ids, and the trace context carried through the outbox.
2. [RED dashboard](dashboard/index.md) — a provisioned dashboard: Rate, Errors, Duration per service, plus USE for JVMs and connection pools.
3. [SLO and burn-rate alert](slo/index.md) — SLI, SLO and error budget for `catalog`; fast- and slow-burn rules as code; fire one.
4. [Measure it](measure/index.md) — agent overhead, sampling, cardinality and time to detect.

## Try it in the playground

**Try it:** run the `observability-stack` scenario with the `chaos` profile. First leave the metrics
node disconnected from a service: its utilization shows as "?" — you cannot fix what you do not
measure. Connect it, then watch which signal reacts first when a random failure hits: the error rate,
the latency percentiles or the health check.

<div class="sdp" data-scenario="observability-stack" data-mode="compact" data-height="520" data-profile="chaos"></div>

The full simulator is in the [playground](../../../playground/index.md).

## Measure it

The [Measure it](measure/index.md) step has the k6 script and the results table to fill in and keep
in `results/lab8.md`.

## Troubleshooting { #troubleshooting }

| Symptom | Likely cause | Fix |
|---|---|---|
| a service exits with `Error opening zip file or JAR manifest missing : /otel/opentelemetry-javaagent.jar` | the agent was not downloaded, or the volume path is wrong | `sh scripts/get-otel-agent.sh` from the repository root; `ls infra/otel` |
| services stay `starting` for minutes | JVMs with the agent start slower; Docker is short of CPU/memory | wait; give Docker 8 GB; stop other stacks (`docker ps`) |
| Grafana shows **No data** | metrics are exported every 10 s and the panels use rate windows | send traffic, wait one minute, check the time range (last 15 min) |
| no `service_name` in Prometheus | the service has no `OTEL_SERVICE_NAME` / `<<: *otel` | compare its `environment` with the `order` service |
| the dashboard or the alert rules are missing | provisioning files not mounted or invalid | `docker compose logs otel-lgtm | grep -i provision`; check the paths of the three volumes |
| still two traces per order | `order` was not rebuilt, or `V2__outbox_traceparent.sql` did not run | `docker compose up -d --build order`; `docker compose logs order | grep -i flyway` |
| port 3000 in use | another Grafana or a dev server | stop it, or map `"3001:3000"` and use `http://localhost:3001` |

## Best practices { #best-practices }

!!! success "Best practices in this lab"

    - **Telemetry configured once, for every service** — the `x-otel` anchor in `docker-compose.yaml`, with one `OTEL_SERVICE_NAME` per service ([OpenTelemetry](../../classes/observability/opentelemetry/index.md)).
    - **Trace context carried across the asynchronous hop** — `Outbox.java`, `OutboxRelay.java` and `V2__outbox_traceparent.sql` store and restore the `traceparent` ([OpenTelemetry — context propagation](../../classes/observability/opentelemetry/index.md)).
    - **Dashboards and alerts as code** — `infra/grafana/dashboards/boxoffice-red.json` and `infra/grafana/alerting/slo-catalog.yaml`, provisioned at startup ([Signals — dashboards](../../classes/observability/signals/index.md)).
    - **An SLI that counts only fans** — `http_route!~"/actuator.*"` in every query of `slo-catalog.yaml` ([SLOs](../../classes/observability/slo/index.md)).
    - **A page only on a fast multiwindow burn, tested by breaking `db`** — 14.4× over 1 h and 5 min in `slo-catalog.yaml`; the 6× rule is a ticket ([Alerting](../../classes/observability/alerting/index.md)).

## Clean up

``` shell
docker compose stop                 # keep everything for lab 9
docker compose down -v              # or remove containers and volumes (all data, including metrics)
```

Lab 9 uses this dashboard during its game day: keep `infra/grafana/` and `infra/otel/`.

## End state

``` text title="End state (what this lab added or changed)"
boxoffice/
├── .gitignore              # + infra/otel/*.jar
├── docker-compose.yaml     # + x-otel anchor, agent volume in every Java service, otel-lgtm
├── infra/
│   ├── grafana/
│   │   ├── dashboards.yaml
│   │   ├── dashboards/boxoffice-red.json
│   │   └── alerting/slo-catalog.yaml
│   └── otel/opentelemetry-javaagent.jar   # downloaded, not committed
├── load/catalog-otel.js
├── scripts/get-otel-agent.sh
└── services/order/
    ├── pom.xml             # + opentelemetry-api
    └── src/main/
        ├── java/boxoffice/order/outbox/Outbox.java, OutboxRelay.java   # traceparent
        └── resources/db/migration/V2__outbox_traceparent.sql
```

Commit and tag: `git add -A && git commit -m "lab 8: observability" && git tag lab8`.

## Checklist

- [ ] `scripts/get-otel-agent.sh` downloads the agent, and `docker-compose.yaml` attaches it to every Java service through the `x-otel` anchor and the `infra/otel` volume, each with its own `OTEL_SERVICE_NAME`
- [ ] Grafana Explore shows `http_server_request_duration_seconds_*` for every service, traces in Tempo and logs with `trace_id` in Loki
- [ ] a single trace goes from `POST /orders` in `order` through the outbox relay and Kafka to `notification`
- [ ] `infra/grafana/` holds the dashboard provider, `boxoffice-red.json` and `slo-catalog.yaml`, loaded at startup
- [ ] the fast-burn alert fired when `db` was stopped, and stopped firing after it came back
- [ ] results table of the [Measure it](measure/index.md) step filled in `results/lab8.md` and explained
- [ ] self-check: after `docker compose down -v && sh scripts/get-otel-agent.sh && docker compose up -d`, the dashboard and both alert rules appear without manual steps; pushed with the tag `lab8`

## Related

- Theory: [Observability](../../classes/observability/index.md) ·
  [Signals: RED, USE, golden signals](../../classes/observability/signals/index.md) ·
  [OpenTelemetry](../../classes/observability/opentelemetry/index.md) ·
  [Alerting and burn rate](../../classes/observability/alerting/index.md) ·
  [Incident response](../../classes/observability/incident-response/index.md) ·
  [SLOs and error budgets](../../classes/observability/slo/index.md)
- Previous lab: [7. Async messaging](../7/index.md) — the flow traced here.
- Next lab: [9. Resilience & chaos](../9/index.md) uses this dashboard during a game day.

[Start: Instrument everything](instrument/index.md){ .md-button .md-button--primary }
