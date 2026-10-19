
The first question during an incident is never "why?" — it is "*is* something wrong, and where should I look?". The second is "what exactly happened to *this* request?". The third is "which line of code is burning the time?". Each question needs a different kind of data, with a different cost. Emitting every detail of every request answers all of them and bankrupts you; emitting only CPU graphs is cheap and answers none. This page is about choosing the right **signal** for each question.

---

## Four signals, one spectrum

| Signal | Unit of data | Answers | Volume / cost | Typical retention | Backends |
|---|---|---|---|---|---|
| **Metrics** | a number per time series per interval | *is* something wrong? how much, since when? | low and **independent of traffic** | months (downsampled: years) | Prometheus, Mimir, Thanos, CloudWatch |
| **Logs** | one record per event | *what* happened in this event? | grows **linearly with traffic** | days to weeks hot, months cold | Loki, Elasticsearch/OpenSearch, Cloud Logging |
| **Traces** | a tree of spans per request | *where* did the time / error go across services? | grows with traffic × hops (sampled) | days to weeks | Tempo, Jaeger, X-Ray, Honeycomb |
| **Profiles** | stack samples per process over time | *which code* uses CPU / memory / locks? | roughly constant per process | days to weeks | Pyroscope, Parca, cloud profilers |

Think of it as a spectrum from **aggregated and cheap** to **detailed and expensive**. Metrics compress a million requests into a few numbers per interval — you can keep them for months, but you cannot ask about one request. Logs and traces keep each request — you can ask anything about it, but you must sample, filter or expire them.

``` mermaid
flowchart LR
    M["Metrics<br/>aggregate · cheap · long retention"] --> T["Traces<br/>per request · sampled"]
    T --> L["Logs<br/>per event · verbose"]
    L --> P["Profiles<br/>per code path"]
```

!!! note "Names used in this class"

    BoxOffice is instrumented with the **OpenTelemetry Java agent** ([Hands-on 8](../../../hands-on/8/index.md)), which follows the OpenTelemetry *semantic conventions*[^1]. Its HTTP server metric `http.server.request.duration` (a histogram, in seconds) arrives in Prometheus as `http_server_request_duration_seconds_bucket`, `_count` and `_sum`, with the labels `http_route`, `http_request_method` and `http_response_status_code`; the service name becomes the `job` label. Spring Boot's own Micrometer metrics use other names (`http_server_requests_seconds` with `uri`, `status`, `application`). The queries are the same idea — check which names your stack emits before copying a query.

---

## Metrics { #metrics }

### The data model

A metric is a **time series**: a name, a set of key-value **labels** (also called attributes or dimensions), and a sequence of `(timestamp, value)` samples.

```text
http_server_request_duration_seconds_count{job="order", http_route="/orders", http_request_method="POST", http_response_status_code="201"}  48213
```

Every distinct combination of label values is a **separate time series** that the database must index and keep in memory. This single fact explains most of the operational problems with metrics (see [cardinality](#cardinality)).

| Type | Behaviour | Use for | BoxOffice example |
|---|---|---|---|
| **Counter** | only goes up (resets to 0 on restart) | events: requests, errors, bytes | tickets sold, `5xx` responses |
| **Gauge** | goes up and down | current state | seats left in a hold pool, queue depth, open connections |
| **Histogram** | counts observations in **buckets** (`le` = less or equal) plus `_sum` and `_count` | latency and size distributions, percentiles | checkout duration |
| **Summary** | quantiles computed **in the process** | legacy; a single instance's percentiles | — avoid: cannot be aggregated |

Histograms are the important one. Each bucket is a counter "how many observations were ≤ this bound": with bounds 0.1, 0.25, 0.5, 1, 2.5 s, a 0.3 s checkout increments the buckets `0.5`, `1`, `2.5` and `+Inf`. Because buckets are counters, histograms from 20 pods can be **summed** and a percentile estimated from the total. Newer formats — Prometheus *native histograms* and OpenTelemetry *exponential histograms* — choose bucket bounds automatically with bounded relative error, which removes the most common mistake: buckets that do not cover your SLO threshold.

### Pull vs push

| | Pull (scrape) | Push |
|---|---|---|
| How | Prometheus calls `GET /metrics` on every target every 15–60 s | the process sends metrics (OTLP, StatsD) to a collector |
| Discovers dead targets | yes — a failed scrape is itself a signal (`up == 0`) | only by absence of data |
| Short-lived jobs, serverless | awkward (needs a push gateway) | natural |
| Behind NAT / many networks | the scraper must reach every target | targets only need to reach the collector |
| Typical stack | Prometheus + Kubernetes service discovery | OpenTelemetry SDK → Collector → Prometheus/Mimir (OTLP) |

Both are fine; modern stacks mix them. With OpenTelemetry the default is **push over OTLP** to a Collector, which can also **scrape** existing Prometheus endpoints ([OpenTelemetry](../opentelemetry/index.md)).

### RED, USE and the four golden signals

You do not need hundreds of metrics per service. Three well-known checklists tell you which few matter:

| Method | Applies to | Signals | Origin |
|---|---|---|---|
| **RED** | request-driven services (APIs) | **R**ate, **E**rrors, **D**uration | Tom Wilkie (Weaveworks/Grafana)[^2] |
| **USE** | resources (CPU, disk, pools, queues) | **U**tilization, **S**aturation, **E**rrors | Brendan Gregg[^3] |
| **Four golden signals** | any user-facing system | latency, traffic, errors, saturation | Google SRE book[^4] |

The golden signals are essentially RED + saturation. **Saturation** is the subtle one: how *full* a resource is, usually visible as **waiting** — a queue, a pool with pending requests, threads blocked. Utilization near 100% is not a problem by itself; work waiting in line is.

!!! example "BoxOffice — RED for services, USE for resources"

    | Component | Method | What to plot |
    |---|---|---|
    | `order` (`POST /checkout`) | RED | checkouts/s; fraction of `5xx`; p50/p95/p99 duration |
    | `payment` → external provider | RED (client side) | calls/s; fraction failed or timed out; p99 of the provider call |
    | PostgreSQL connection pool of `inventory` | USE | active / max connections; **pending** acquisitions and wait time; acquisition timeouts |
    | Kafka topic `order-events` | USE | produce rate vs consume rate; **consumer lag** (messages and seconds); failed deliveries / DLQ size |
    | `order` JVM | USE | CPU; heap after GC; GC pause time; thread pool queue |

    During the flash sale, the payment pool's **pending acquisitions** (saturation) rose two minutes before the checkout p99 alert fired. Saturation is the leading indicator; RED is what users feel.

### RED in PromQL

PromQL is the query language of Prometheus (and of Mimir, Thanos and most compatible backends). Two rules prevent most wrong queries: apply `rate()` to a counter **before** summing it (it handles counter resets when a pod restarts), and keep the `le` label when summing histogram buckets.

```promql
# Rate: requests per second, per route, of the order service
sum by (http_route) (
  rate(http_server_request_duration_seconds_count{job="order"}[5m])
)

# Errors: fraction (0..1) of 5xx responses
sum(rate(http_server_request_duration_seconds_count{job="order", http_response_status_code=~"5.."}[5m]))
/
sum(rate(http_server_request_duration_seconds_count{job="order"}[5m]))

# Duration: p99 latency per route, aggregated across all pods
histogram_quantile(0.99,
  sum by (le, http_route) (
    rate(http_server_request_duration_seconds_bucket{job="order"}[5m])
  )
)

# SLI style: fraction of checkouts faster than 2 s (needs a bucket at le="2")
sum(rate(http_server_request_duration_seconds_bucket{job="order", http_route="/checkout", le="2"}[5m]))
/
sum(rate(http_server_request_duration_seconds_count{job="order", http_route="/checkout"}[5m]))
```

### Percentiles, not averages — and never average percentiles

An average latency hides the tail: if 99 checkouts take 100 ms and one takes 10 s, the average is ~200 ms and looks fine, but one fan in a hundred waits ten seconds — and a page that makes 20 calls hits that tail on most loads (see [Percentiles](../../estimation/percentiles/index.md)).

A subtler mistake is to compute p99 **per pod** and then average across pods. Percentiles do not compose: the p99 of the whole fleet is not the mean of the pods' p99s. The simulation below has four `order` pods; one of them shares a node with a noisy neighbour and is slow, and it receives 10% of the traffic.

```python exec="true"
import numpy as np

rng = np.random.default_rng(7)
# three healthy pods (30% of traffic each, ~80 ms) and one slow pod (10%, ~400 ms)
pods = {
    "pod-a": rng.lognormal(np.log(0.08), 0.35, 30_000),
    "pod-b": rng.lognormal(np.log(0.08), 0.35, 30_000),
    "pod-c": rng.lognormal(np.log(0.08), 0.35, 30_000),
    "pod-d (noisy neighbour)": rng.lognormal(np.log(0.40), 0.50, 10_000),
}
print("| Pod | Requests | p99 (ms) |")
print("|---|---:|---:|")
p99s = []
for name, lat in pods.items():
    p = np.percentile(lat, 99) * 1000
    p99s.append(p)
    print(f"| {name} | {len(lat):,} | {p:,.0f} |")
fleet = np.percentile(np.concatenate(list(pods.values())), 99) * 1000
print(f"| **average of the four p99s** | | **{np.mean(p99s):,.0f}** |")
print(f"| **true fleet p99** (from all requests) | 100,000 | **{fleet:,.0f}** |")
```

Averaging the pods' percentiles understates the tail users actually experience. Histograms avoid the problem because their buckets are counters that can be summed *before* the percentile is estimated — which is exactly what `sum by (le)` does in the query above.

---

## Cardinality { #cardinality }

**Cardinality** is the number of distinct time series a metric produces: the product of the number of values of each label. It is the main driver of the memory, cost and query speed of a metrics backend — and the most common way teams accidentally take down their monitoring.

The table below grows the checkout latency histogram label by label. Each histogram series is really 17 series (15 buckets, `_sum`, `_count`); the memory column assumes, for illustration, about 4 KB per active series in the time-series database.

```python exec="true"
BYTES_PER_SERIES = 4 * 1024  # illustrative assumption

steps = [
    ("one histogram (15 buckets + _sum + _count)", 17),
    ("http_request_method (4 values)", 4),
    ("http_route (25 route templates)", 25),
    ("http_response_status_code (6 values seen)", 6),
    ("pod (20 replicas)", 20),
    ("customer_id (1,000,000 fans)", 1_000_000),
]

def human(n_bytes):
    for unit in ["B", "KB", "MB", "GB", "TB", "PB"]:
        if n_bytes < 1024:
            return f"{n_bytes:,.1f} {unit}"
        n_bytes /= 1024
    return f"{n_bytes:,.1f} EB"

print("| Label added | × values | Series | Memory |")
print("|---|---:|---:|---:|")
series = 1
for label, values in steps:
    series *= values
    print(f"| {label} | {values:,} | {series:,} | {human(series * BYTES_PER_SERIES)} |")
```

The first five labels are **bounded**: their number of values is small and known (routes are *templates* such as `/orders/{id}`, not `/orders/42`). Together they produce at most about 200 thousand series (an upper bound: not every route returns every status code) — a normal load for one Prometheus server. The last label is **unbounded**: it grows with the number of users, and it multiplies everything before it. No metrics system survives that.

| Label | Bounded? | Where it belongs |
|---|---|---|
| `http_route` (template), `method`, `status_code`, `region`, `pod` | yes | metric labels |
| `event_id` (≈ thousands of events on sale) | borderline — only if small and you need per-event SLOs | usually traces |
| `customer_id`, `order_id`, `email`, full URL, `trace_id` | **no** | **traces and logs** (high-cardinality data is their job) |
| error message text | no (free text) | logs; use an error *class* as the label |

!!! tip "High cardinality is not bad — it is in the wrong place"

    "Which fans had slow checkouts?" is a great question. It is answered by **traces and wide events** with `customer_id` as an *attribute*, queried on demand — not by a metric label that pre-aggregates every possible value forever. Metrics answer "how many / how fast"; traces and logs answer "which ones".

---

## Logs { #logs }

A log is a timestamped record of a discrete event. Logs are the most familiar signal and the easiest to abuse: they are free to write and expensive to keep.

### Structured logs

Write logs as **structured** records (JSON, or the OpenTelemetry log data model) with fixed field names, not as free text.

| | Unstructured | Structured |
|---|---|---|
| Example | `10:04:12 WARN payment slow for order 9912 (8120ms)` | see below |
| Query | grep and regular expressions | field filters and aggregations |
| Correlation | by timestamp, by hand | by `trace_id` / `span_id` fields |
| Parsing | brittle; breaks when a message changes | stable |

```json
{
  "timestamp": "2027-03-13T10:04:12.481Z",
  "level": "WARN",
  "service.name": "payment",
  "message": "provider call slow",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "order_id": "ord_9912",
  "provider": "acme-pay",
  "duration_ms": 8120,
  "pool_wait_ms": 7900
}
```

The `trace_id` and `span_id` fields are what turn a log line into part of an investigation: from a slow span you jump to exactly its log lines, and from an error line you jump to the full trace. With the OpenTelemetry Java agent, they are added to the logging context automatically ([OpenTelemetry](../opentelemetry/index.md)).

### What (not) to log

| Level | Use | Production? |
|---|---|---|
| `ERROR` | a failure that needs attention: exception, dependency unreachable | yes |
| `WARN` | unexpected but handled: retry, fallback, slow call | yes |
| `INFO` | significant business or lifecycle events: order confirmed, service started | yes, but not one per inner step |
| `DEBUG` / `TRACE` | diagnostic detail | off by default; enable per service or per request when investigating |

- **Log events, not steps.** One line "checkout completed" with ten fields beats ten lines "entering method X".
- **Never log secrets or personal data**: passwords, tokens, card numbers, full e-mails. Mask at the source and, as a second barrier, redact in the Collector.
- **Log the decision, not just the outcome**: "fallback to provider B because breaker open" explains the next hour of graphs.
- **Errors once**: log an exception where it is handled, not at every layer it passes through.

### Querying logs

With Loki (the "L" of the Grafana LGTM stack), labels select streams and the rest of the line is parsed at query time, which keeps indexing cheap:

```text
{service_name="payment"} | json | level="WARN" | duration_ms > 5000
```

| | Loki | Elasticsearch / OpenSearch |
|---|---|---|
| Indexes | only labels (stream selectors) | the full text of every field |
| Storage | compressed chunks in object storage — cheap | inverted index on disks — expensive |
| Fast for | "logs of service X around time T", trace-ID lookups | arbitrary full-text search across everything |
| Cost driver | volume scanned per query | index size |

---

## Traces { #traces }

A **trace** records the path of one request through the system as a tree of **spans**. A span is one timed operation — an HTTP call received or sent, a database query, a message produced or consumed — with a start time, a duration, a status and attributes.

| Field | Meaning | Example |
|---|---|---|
| `trace_id` | same for every span of the request (128 bits) | `4bf92f3577b34da6a3ce929d0e0e4736` |
| `span_id` / `parent_span_id` | build the tree | `00f067aa0ba902b7` / `a2fb4a1d1a96d312` |
| `name` | the operation, low cardinality | `POST /checkout`, `SELECT seat_holds` |
| `kind` | `SERVER`, `CLIENT`, `PRODUCER`, `CONSUMER`, `INTERNAL` | `CLIENT` for the call to the provider |
| `status` | `OK`, `ERROR` (unset by default) | `ERROR` |
| `attributes` | key-value details — **high cardinality is fine here** | `order.id=ord_9912`, `http.response.status_code=504` |
| `events` | timestamped annotations inside the span | `exception` with stack trace, `retry` |
| `links` | references to spans of *other* traces | a batch consumer linking to each producer's trace |

### Reading a waterfall

The trace of one slow checkout during the flash sale, drawn as the waterfall that Tempo or Jaeger shows:

```text
trace 4bf92f35…   POST /checkout                       total 9.12 s
                                         0s        3s        6s        9s
gateway    SERVER POST /checkout          |██████████████████████████████|  9.12 s
 order     SERVER POST /orders            | █████████████████████████████|  9.08 s
  inventory CLIENT PUT /holds/{id}        | ▌                            |  0.09 s
   postgres CLIENT UPDATE seat_holds      | ▏                            |  0.02 s
  payment  SERVER POST /charges           |  ████████████████████████████|  8.95 s
   payment INTERNAL pool.acquire          |  ██████████████████████████  |  7.90 s
   payment CLIENT POST provider/charges   |                          ███▌|  1.02 s
  order    PRODUCER order-events publish  |                             ▏|  0.01 s
```

Read it top-down and look for the **critical path** — the chain of spans that determines the total time. Here it is not the provider call (1 s, slow but not dramatic): it is **7.9 s waiting for a connection** from the payment adapter's pool. The provider got slower, every call held its connection longer, and by Little's law (concurrency = throughput × time) the pool of 20 connections saturated — so most of the time was spent *queueing inside BoxOffice*. Without the `pool.acquire` span you would blame the provider for nine seconds; with it, you know a bounded pool plus a timeout is the fix ([Resilience patterns](../../reliability/patterns/index.md)).

!!! tip "Spans for waiting, not just for doing"

    Automatic instrumentation creates spans for I/O (HTTP, SQL, Kafka). Queueing *inside* a service — a connection pool, a semaphore, a thread pool queue, a rate limiter — is invisible unless you add a span or at least an attribute for the wait time. Those are exactly the places where saturation hides.

---

## Profiles

A **profile** samples, many times per second, what each thread of a process is executing — the full call stack — and aggregates the samples. **Continuous profiling** does this all the time in production with low overhead (the tools typically target around 1–2% CPU), so you can compare "10:00 today" with "10:00 last week".

The usual visualization is the **flame graph**[^5]: each box is a function, its **width** is the fraction of samples in which it was on the stack, and children sit on top of their callers. Wide plateaus at the top are where the CPU actually goes.

| Profile type | Shows | BoxOffice question |
|---|---|---|
| CPU | where CPU time is spent | why does `search` use 4 cores for autocomplete? |
| Allocation / heap | who allocates memory | what triggers the GC pauses in `order` during the on-sale? |
| Lock / mutex | where threads wait for locks | is the seat-map cache lock contended? |
| Wall-clock | where time passes, including waiting | where do checkout threads sleep? |

Profiling became the fourth OpenTelemetry signal (still maturing in 2026), and eBPF-based profilers (Parca, Pyroscope, cloud profilers) can profile every process on a node without changing the application. Traces tell you *which service and operation* is slow; profiles tell you *which function inside it*.

---

## Dashboards

A dashboard is a set of saved queries arranged to answer a question quickly. Most dashboards fail because they try to show *everything*; the useful ones are designed top-down, from what users feel to what resources do.

``` mermaid
flowchart TB
    L1["1 · User journeys and SLOs<br/>search, seat hold, checkout: SLI, budget left"]
    L2["2 · Services — RED<br/>per service and route: rate, errors, p50/p99"]
    L3["3 · Dependencies<br/>provider latency, DB, cache hit ratio, Kafka lag"]
    L4["4 · Resources — USE<br/>CPU, memory, pools, queues per pod/node"]
    L1 --> L2 --> L3 --> L4
```

- **One dashboard, one purpose.** The on-call "is checkout healthy?" view fits on one screen; deep dives live elsewhere.
- **Same time axis, same units**: seconds for latency, ratios (0–1) or percentages for errors, never mixed on one panel.
- **Show percentiles and the SLO threshold** as a line on the latency panel, so the eye compares at once.
- **Annotate deploys and feature flags**: most incidents start at a change.
- **Dashboards as code** (Grafana JSON in Git, Jsonnet/Grafonnet, Terraform): reviewed, versioned and reproducible, instead of clicked by hand and lost.

---

## Trade-offs

| Decision | Option A | Option B | Rule of thumb |
|---|---|---|---|
| Latency metric | summary (quantiles in-process) | histogram (buckets) | histogram — it aggregates across pods |
| Per-user detail | metric label | trace / log attribute | attribute; labels must be bounded |
| Logs | free text | structured with `trace_id` | structured, always |
| Coverage | log every step | log events + traces | events + traces; turn on DEBUG when needed |
| Collection | pull (scrape) | push (OTLP) | either; OTLP is the portable default |
| Retention | keep everything long | tiers: hot (days) → cold object storage | tiers; metrics long, raw logs/traces short |

!!! tip "In the interview"

    When you add a component to a design, name its **one key metric** in the same sentence — it shows you have operated systems: cache → **hit ratio**; queue → **consumer lag / age of oldest message**; database replica → **replication lag**; connection pool → **pending acquisitions**; API → **RED**. If asked "how do you debug a slow request across services?", the answer is **distributed tracing with propagated context**, then the logs of the slow span. And if you propose a metric with `user_id` as a label, expect the follow-up question about **cardinality**.

!!! warning "Common pitfalls"

    - **Unbounded labels** (`user_id`, `order_id`, raw URLs): the metrics backend runs out of memory or the bill explodes.
    - **Averages and averaged percentiles**: use histograms, aggregate buckets, then compute the percentile.
    - **Histogram buckets that miss the SLO**: if the SLO is "under 2 s" and no bucket ends at 2 s, the SLI cannot be computed exactly.
    - **Logging personal data and secrets**: logs are copied, indexed and retained — a leak multiplier.
    - **Only automatic spans**: waiting inside the service (pools, locks, queues) stays invisible.
    - **Dashboards nobody owns**: a hundred stale panels slow down every investigation.

## How it connects { #how-it-connects }

``` mermaid
flowchart LR
    REQ["one checkout:<br/>gateway → order → payment"] --> MET["metrics: RED per route,<br/>USE per pool and topic"]
    REQ --> TR["trace: spans,<br/>critical path"]
    REQ --> LOG["structured log<br/>with trace_id"]
    MET --> HIST["histograms → p99<br/>→ Estimation: percentiles"]
    MET --> CARD["bounded labels<br/>(cardinality)"]
    CARD -->|"high-cardinality detail"| TR
    TR --> WAIT["pool.acquire wait<br/>→ Little's law"]
    WAIT --> RES["timeout + bulkhead<br/>→ Reliability patterns"]
    TR --> PROF["profiles: which function<br/>→ Performance"]
    MET --> SLI["SLI per journey<br/>→ Alerting, SLOs"]
```

**Palette components:** [`metrics`](../../../reference/components/observability/index.md#metrics) · [`logs`](../../../reference/components/observability/index.md#logs) · [`tracing`](../../../reference/components/observability/index.md#tracing) · [`app`](../../../reference/components/compute/index.md#app) (RED per service) · [`sql`](../../../reference/components/storage/index.md#sql) (USE of the connection pool) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (consumer lag) · [`payment`](../../../reference/components/external/index.md#payment) (client-side RED of the provider call). **Scenarios:** `observability-stack`, `event-fanout` (consumer lag), `cascading-failure` (a slow provider saturating a pool). **Continues in:** [OpenTelemetry](../opentelemetry/index.md), [Alerting](../alerting/index.md), [Estimation — percentiles](../../estimation/percentiles/index.md), [Estimation — queueing](../../estimation/queueing/index.md), [Reliability — patterns](../../reliability/patterns/index.md), [Performance — bottlenecks](../../performance/bottlenecks/index.md) (flame graphs), [Hands-on 8 — RED dashboard](../../../hands-on/8/dashboard/index.md).

---

## Key takeaways

- Four signals on a cost–detail spectrum: **metrics** (cheap, aggregate), **traces** (per request, sampled), **logs** (per event), **profiles** (per code path).
- **RED** for services, **USE** for resources, the **golden signals** for anything user-facing; **saturation** (waiting) is the leading indicator.
- Use **histograms**, aggregate buckets with `sum by (le)`, then compute percentiles; never average percentiles.
- **Cardinality** is the product of label values; keep metric labels bounded and put high-cardinality detail in traces and logs.
- Logs must be **structured** and carry the `trace_id`; traces show the **critical path**, including time spent waiting; profiles show the **function**.
- Design dashboards top-down: journeys/SLOs → RED → dependencies → USE.

---

[^1]: OPENTELEMETRY. [Semantic conventions for HTTP metrics](https://opentelemetry.io/docs/specs/semconv/http/http-metrics/){target="_blank"}.
[^2]: WILKIE, T. [The RED Method: key metrics for microservices architecture](https://grafana.com/blog/2018/08/02/the-red-method-how-to-instrument-your-services/){target="_blank"}. Grafana Labs, 2018.
[^3]: GREGG, B. [The USE Method](https://www.brendangregg.com/usemethod.html){target="_blank"}. See also *Systems Performance*, 2nd ed. Addison-Wesley, 2020.
[^4]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/sre-book/monitoring-distributed-systems/){target="_blank"}. O'Reilly, 2016. Chapter 6 — Monitoring Distributed Systems.
[^5]: GREGG, B. [Flame Graphs](https://www.brendangregg.com/flamegraphs.html){target="_blank"}.
