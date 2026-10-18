# 2. RED Dashboard

Data you cannot read in ten seconds during an incident is not observability, it is storage. This step
builds **one** dashboard for every BoxOffice service, provisioned as code, organized around two
methods from the [signals class](../../../classes/observability/signals/index.md):

| Method | For | Signals | Question it answers |
|---|---|---|---|
| **RED** (Tom Wilkie) | request-driven services | **R**ate, **E**rrors, **D**uration | "Are my users being served well?" |
| **USE** (Brendan Gregg) | resources | **U**tilization, **S**aturation, **E**rrors | "Is a resource the bottleneck?" |

RED says *that* something is wrong for users; USE says *where* the capacity ran out. The top row of
the dashboard is RED per service; the bottom row is USE for the JVMs and their connection pools.

## Dashboards as code

Grafana loads dashboards from files listed by a **provider**. Both files live in your repository, so
the dashboard is reviewed, versioned and identical on every laptop:

``` yaml title="infra/grafana/dashboards.yaml"
--8<-- "docs/2027.1/hands-on/8/code/infra/grafana/dashboards.yaml"
```

The volumes of [step 1](../instrument/index.md) mount this provider into Grafana's provisioning
folder and `infra/grafana/dashboards/` at the path it points to. Save the dashboard below as
`infra/grafana/dashboards/boxoffice-red.json` and restart: `docker compose restart otel-lgtm`. It
appears under **Dashboards → BoxOffice → BoxOffice — RED**.

??? example "infra/grafana/dashboards/boxoffice-red.json (click to expand)"

    ``` json title="infra/grafana/dashboards/boxoffice-red.json"
    --8<-- "docs/2027.1/hands-on/8/code/infra/grafana/dashboards/boxoffice-red.json"
    ```

## Reading the panels

Every panel is one PromQL query over the histogram the agent exports. Learn the four shapes; every
RED dashboard you will ever see is a variation of them.

| Panel | Query shape | Read it as |
|---|---|---|
| Rate | `sum by (service_name) (rate(…_count[$__rate_interval]))` | requests per second, per service |
| Errors | `rate(…_count{status=~"5.."}) / rate(…_count)` | the **share** of requests that fail (not the count) |
| Duration p95 | `histogram_quantile(0.95, sum by (service_name, le) (rate(…_bucket[…])))` | 95% of requests were faster than this |
| Slowest routes | `topk(10, histogram_quantile(0.95, sum by (…, http_route, le) …))` | where to look first |
| DB connections | `db_client_connections_usage{state="used"}` vs `_max`, `_pending_requests` | the pool is saturated when *waiting* > 0 |

Three habits make the difference:

- **Aggregate before the quantile.** `histogram_quantile` must receive `sum by (le)` of the bucket
  *rates*: you can add buckets across instances, you **cannot** average percentiles (the average of
  three p95s is not the p95 of anything).
- **Errors as a ratio.** 50 errors per second is a disaster at 60 req/s and noise at 60 000 req/s.
- **Percentiles from buckets are estimates.** `histogram_quantile` interpolates inside a bucket; with
  the agent's default bucket boundaries (…, 0.25, 0.5, 0.75, 1, 2.5 s…), a p99 of "0.6 s" means
  "somewhere between 0.5 and 0.75 s".

!!! tip "Exemplars: from a spike to the trace that caused it"

    The `otel-lgtm` Prometheus stores **exemplars**: a few sample trace ids attached to histogram
    buckets. In the Duration panel, turn on *Exemplars* in the query options; the diamonds on the
    chart are real requests, and clicking one opens its trace in Tempo. This is the shortest path from
    "p99 went up" to "this SQL statement is slow".

## Exercise: watch a bottleneck appear

1. Run the staircase stress test of [lab 2](../../2/index.md) against the edge — it raises the arrival
   rate in steps up to `PEAK` and comes back down:
   `k6 run -e BASE_URL=http://localhost -e PEAK=600 load/stress.js`.
2. Watch **Duration p95** and **DB connections** side by side. When `waiting` leaves zero, the
   latency curve bends: requests now queue for a connection (Little's Law: with the pool full,
   extra concurrency becomes waiting time).
3. Open an exemplar at the top of the curve: the trace shows a long gap *before* the SQL span — time
   spent waiting for a connection, not running SQL.

Write in your results which resource saturated first and the request rate at which it happened.

[Next: SLO and burn-rate alert](../slo/index.md){ .md-button .md-button--primary }
