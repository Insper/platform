---
marp: true
lang: en
title: Hands-on 8 — Observability
description: System Architecture · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">System Architecture · Insper</div>

# Hands-on 8 — Observability

**OpenTelemetry, a RED dashboard, one trace across Kafka and an SLO that pages on time**

<!--
Outline: (1) the questions k6 cannot answer; (2) otel-lgtm and the Java agent; (3) the outbox breaks
the trace; (4) RED and USE as code; (5) SLO, error budget, burn rate; (6) fire the alert; (7) measure.
-->

---

## "Checkout is slow"

<div class="q">

The flash sale is live and support is flooded. Is it every fan or a few? Which of seven services?
The database, the pool, Kafka, the e-mail provider?

</div>

- k6 measures from **outside**; we need the **inside** view.
- **Metrics**: *that* something is wrong, and how much.
- **Traces**: *where* the time went, request by request.
- **Logs**: *why*, once you know where to look.

---

## Architecture

- Every Java service runs the **OpenTelemetry Java agent**.
- It pushes **OTLP** to `otel-lgtm` (port 4318).
- Inside: OTel **Collector** → **Prometheus** (metrics), **Tempo** (traces), **Loki** (logs).
- **Grafana** (port 3000) links them: exemplar → trace → logs.

<div class="ok">

Development backend in one image; production swaps it for separate systems — the services still speak OTLP.

</div>

---

## Step 1 · The agent: one jar, no code

```shell
sh scripts/get-otel-agent.sh      # downloads infra/otel/opentelemetry-javaagent.jar (v2.32.0)
```yaml
x-otel: &otel
  JAVA_TOOL_OPTIONS: -javaagent:/otel/opentelemetry-javaagent.jar
  OTEL_JAVAAGENT_ENABLED: ${OTEL_ON:-true}
  OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-lgtm:4318
```

<p class="small">Each Java service mounts <code>./infra/otel:/otel:ro</code> and adds <code>&lt;&lt;: *otel</code> plus its own <code>OTEL_SERVICE_NAME</code>. No image changes.</p>

---

## What the agent gives you

- **Spans** for HTTP server/client, JDBC, Kafka, Redis, `@Scheduled`.
- **Metrics** with standard names: `http_server_request_duration_seconds_bucket{service_name, http_route, http_response_status_code}`.
- **Logs** via OTLP, each with `trace_id` and `span_id`.
- `http_route` is the **template** (`/catalog/events/{id}`), never the raw URL → bounded cardinality.

---

## The hop the agent cannot see

<div class="warn">

An order produces **two unrelated traces**: `POST /orders`, and later the relay → Kafka → `notification`.

</div>

- The outbox is a **database row** read by another thread: the request's context was not stored.
- Fix: save the request's W3C **`traceparent`** in the row (`V2__outbox_traceparent.sql`).
- The relay makes that context current before `kafka.send` → the agent injects the **same** trace id.
- Result: one trace, with the relay delay visible as a gap.

---

## Step 2 · RED and USE

| Method | For | Signals |
|---|---|---|
| **RED** | request-driven services | Rate, Errors, Duration |
| **USE** | resources | Utilization, Saturation, Errors |

- RED says users are hurting; USE says which **resource** ran out.
- Dashboard as **code**: `infra/grafana/dashboards/boxoffice-red.json` + a provider file.

---

## Four PromQL shapes

```text
sum by (service_name) (rate(…_count[$__rate_interval]))                     # Rate
rate(…_count{http_response_status_code=~"5.."}) / rate(…_count)             # Errors (ratio)
histogram_quantile(0.95, sum by (service_name, le) (rate(…_bucket[…])))      # Duration
db_client_connections_pending_requests                                      # Saturation
```

<div class="warn">

**Never average percentiles.** Sum the bucket rates, then take the quantile.

</div>

---

## Step 3 · From promise to numbers

| Term | `catalog` |
|---|---|
| SLI | share of requests (no `/actuator`) not answered 5xx |
| SLO | 99.5% over 28 days |
| Error budget | 0.5% → ≈ 202 min of total outage per 28 days |
| Burn rate | error ratio / 0.005 (1 = exactly on budget) |

---

## Multiwindow, multi-burn-rate

| Severity | Burn rate | Long | Short | Budget spent |
|---|---|---|---|---|
| page | 14.4 | 1 h | 5 min | ≈ 2.1% |
| page / ticket | 6 | 6 h | 30 min | ≈ 5.4% |
| ticket | 1 | 3 days | 6 h | ≈ 10.7% |

- **Long** window: the problem is significant, not a blip.
- **Short** window: it is still happening → resolves soon after the fix.
- As code: `infra/grafana/alerting/slo-catalog.yaml` (queries A, B + math `$A > 14.4 && $B > 14.4`).

---

## Fire it

<div class="q">

Steady traffic, one healthy hour, then `docker compose stop db`. When does the fast-burn rule page?

</div>

* The 1-hour error ratio must reach 14.4 × 0.5% = **7.2%**.
* 0.072 × 60 min ≈ **4.3 min** of outage, + `for: 1m` + evaluation ≈ **5–6 min**.
* A 30-second blip never pages; a slow 4% leak is caught by the 6-hour rule.

---

<!-- _class: tight -->

## Step 4 · Measure it

| # | Experiment | Record |
|---|---|---|
| A | agent on vs off (`OTEL_ON`) | p50 / p95 / p99, CPU, memory, startup |
| B | sampling 100% vs 10% (`parentbased_traceidratio`) | p95, traces per minute |
| C | cardinality | series per service, the cost of a `user_id` label |
| D | time to detect | stop `db` → Pending → Firing |

<p class="small">k6 <code>constant-arrival-rate</code> on <code>GET /catalog/events/{id}</code> through the edge; <code>docker stats</code> during the run.</p>

---

## Pitfalls

- **Context breaks at async hops**: carry `traceparent` in messages and rows.
- **Unbounded labels** (ids, URLs, e-mails) explode the number of series.
- **No traffic, no SLI**: pair SLO alerts with a probe or a "traffic dropped" alert.
- **Health checks in the SLI** hide real failures.
- **Sampling** applies to traces, not metrics: rates come from metrics.

---

## Try it in the playground

- `observability-stack` with the `chaos` profile.
- Disconnect metrics from a service: its utilization becomes "?".
- Which reacts first to a failure: errors, percentiles or health checks?

<div class="ok">

You cannot fix what you do not measure — and you cannot measure what you did not instrument.

</div>

---

## Takeaways

1. **Metrics** say that, **traces** say where, **logs** say why — linked by `trace_id`.
2. The **Java agent** instruments HTTP, JDBC, Kafka and logs with zero code; OTLP is the contract.
3. Async hops (outbox, queues) need the **`traceparent` carried with the data**.
4. Dashboards and alerts are **code** in the repository.
5. Alert on **SLO burn rate** over two windows, not on raw thresholds.
6. Observability has a **cost** — measure it, and sample traces, not metrics.
