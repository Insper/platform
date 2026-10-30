# 4. Measure It

Observability is not free: every span is allocated, every metric point aggregated, every batch sent
over the network. This step puts a number on that cost and on the benefit — how long it takes to know
that users are hurting. As always, run each experiment twice and report the second run; numbers in
"expected shape" boxes are **illustrative**.

| # | Experiment | Knob | What you record |
|---|---|---|---|
| A | agent overhead | `OTEL_ON=true` vs `false` | p50 / p95 / p99, throughput, CPU %, memory, startup time |
| B | trace sampling | `OTEL_TRACES_SAMPLER` | p95, traces stored per minute |
| C | cardinality | — | number of series per service |
| D | time to detect | stop `db` | stop → *Pending* → *Firing* times |

## The k6 script

``` javascript title="load/catalog-otel.js"
--8<-- "docs/2027.1/hands-on/8/code/load/catalog-otel.js"
```

## A. Agent overhead

Same image, same load, agent on and off:

<!-- termynal -->

``` shell
> OTEL_ON=false docker compose up -d --wait catalog-1 catalog-2 catalog-3
> k6 run load/catalog-otel.js
> docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' | grep catalog
> docker compose logs catalog-1 | grep "Started CatalogApplication"
> OTEL_ON=true docker compose up -d --wait catalog-1 catalog-2 catalog-3
> k6 run load/catalog-otel.js
> docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' | grep catalog
> docker compose logs catalog-1 | grep "Started CatalogApplication"
```

Run `docker stats` in a second terminal *while* k6 runs (the numbers after the test are idle
numbers). The `docker compose logs` lines show the startup time with the agent off and on (the
logs of a container are gone once it is recreated, so read them before switching).

!!! example "Expected shape (illustrative)"

    The agent adds work per request (creating spans, recording histograms) and per process (bytecode
    instrumentation at startup). Expect a small increase in p50, a few percent more CPU at the same
    throughput, tens of MB more memory and a noticeably slower startup. If your p99 grows much more
    than your p50, look at garbage collection: more allocation means more frequent pauses.

## B. Sampling

Keeping 100% of the traces is right for a lab and wrong for 2 million fans. Sample 10% **at the
root** and let every downstream service follow the root's decision (`parentbased_…`), so that a
trace is either complete or absent:

The `x-otel` anchor already reads both settings from the environment
(`${OTEL_TRACES_SAMPLER:-parentbased_always_on}`), so no file changes: recreate the services with the
two variables set and run the same load.

``` shell
OTEL_TRACES_SAMPLER=parentbased_traceidratio OTEL_TRACES_SAMPLER_ARG=0.1 docker compose up -d --wait
k6 run load/catalog-otel.js
docker compose up -d --wait # afterwards: back to 100% (the defaults of the anchor)
```

Count the traces stored per minute in Tempo (Explore → Tempo → Search, service
`gateway`, last 5 minutes) and compare p95 with experiment A. Note that **metrics are not sampled**:
the RED dashboard still counts every request — that is why rates and percentiles come from metrics,
and examples (the *why*) from traces.

## C. Cardinality

Every distinct combination of label values is a separate time series, stored and queried separately.
In Grafana Explore (Prometheus), run:

``` text
count by (service_name) ({service_namespace="boxoffice"})
count by (__name__) ({service_name="catalog"})
```

The first gives the series per service; the second shows which metrics are the most expensive.
Now imagine adding a label `user_id` to the HTTP histogram: with 2 million fans and 14 buckets, how
many series would `catalog` create? (Answer it in your results: this is why the agent records
`http_route`, the template, and never the raw URL.)

## D. Time to detect

Follow "Fire it" in [step 3](../slo/index.md) and record the three times.

## Results

Copy this table into `results/lab8.md` and fill it in.

| Metric | Agent off | Agent on |
|---|---|---|
| A · Throughput (req/s) | | |
| A · p50 (ms) | | |
| A · p95 (ms) | | |
| A · p99 (ms) | | |
| A · Error rate (%) | | |
| A · CPU per `catalog` replica under load (%) | | |
| A · Memory per `catalog` replica (MB) | | |
| A · Startup time (s) | | |
| B · p95 with 100% vs 10% sampling (ms) | | |
| B · Traces stored per minute, 100% vs 10% | | |
| C · Series of `catalog` / of all BoxOffice | — | |
| C · Series if `user_id` were a label (estimate) | — | |
| D · Stop `db` → Pending → Firing (mm:ss) | — | |

Below the table, answer in a paragraph each: is the agent's overhead worth it for BoxOffice? Which
sampling rate would you choose for the flash sale, and why? Does your measured time to detect match
the prediction of step 3?

[Back to the overview](../index.md){ .md-button } [Quiz](../quiz.md){ .md-button .md-button--primary }
