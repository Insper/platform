"`inventory` is slow during the pre-sale test." Within ten minutes the team channel has four proposals: add a Redis cache, move to a bigger database instance, add more pods, rewrite the hot path in Go. Each costs days or dollars; at most one addresses the actual cause; and nobody has looked at a single metric yet. A **methodology** is what replaces this guessing: a systematic way to go from a symptom to the limiting resource, and from there to the one change that matters.

---

## Anti-methods: how not to do it

Brendan Gregg catalogues the approaches that feel productive and are not[^1]:

| Anti-method | What it looks like | Why it fails |
|---|---|---|
| **Streetlight** | Look at the tools you know (`top`, the default dashboard) because they are easy, not because the problem is there | You find what is visible, not what is wrong |
| **Random change** | Tweak JVM flags, pool sizes and replica counts until it "feels faster" | Changes interact; improvements are noise; regressions are hidden |
| **Blame someone else** | "It's the database." "It's the network." | Moves the problem without evidence; the other team repeats the cycle |
| **Ad hoc checklist** | Run last incident's checklist | Works only when the problem repeats exactly |

The alternative is the **scientific method**[^5]: ask a question ("why is the p99 of `POST /holds` 2 s at 1 500 req/s?"), form a **hypothesis** ("the connection pool is exhausted"), make a **prediction** ("pool pending > 0 and wait time ≈ the latency increase"), **test** it with a measurement, and only then change something — one thing — and re-measure.

---

## Workload characterization: what load, exactly?

A test is only as good as its model of the load. Workload characterization answers four questions[^1]:

| Question | Meaning | BoxOffice answer |
|---|---|---|
| **Who** is causing the load? | Clients, bots, internal jobs, regions | Fans on mobile (70 %) and web, partner resellers' API, scalper bots (blocked at the [WAF](../../../reference/components/edge/index.md#waf)) |
| **Why** is the load happening? | User flows and business events | Browsing on normal days; an on-sale at 10:00 creates a synchronized rush |
| **What** is the load? | Endpoint mix, payload sizes, read/write ratio, data accessed | 80 % reads (event page, seat map, search), 20 % writes (holds, orders) during the on-sale |
| **How** does it change over time? | Arrival pattern, peaks, seasonality | Flat daily wave; on-sale = near-vertical ramp at 10:00:00, peak in the first 5 minutes, long tail |

### From logs to a workload model { #workload-model }

Production access logs (or the gateway's metrics) are the source of truth. A query over one past on-sale gives the mix and the arrival rate:

```sql title="workload.sql — endpoint mix of the last on-sale (gateway access logs in the warehouse)"
SELECT route,
       count(*)                                         AS requests,
       round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct,
       max(per_second)                                  AS peak_rps
FROM (
  SELECT route, date_trunc('second', ts) AS sec, count(*) OVER (PARTITION BY route, date_trunc('second', ts)) AS per_second
  FROM gateway_access_log
  WHERE ts BETWEEN '2026-09-12 09:55' AND '2026-09-12 10:30'
) t
GROUP BY route
ORDER BY requests DESC;
```

The result becomes the workload model that every test in this class reuses (numbers are illustrative assumptions for a stadium on-sale):

| Endpoint | Share of requests | Peak req/s | Latency SLO (p99) | Notes |
|---|---|---|---|---|
| `GET /events/{id}` (event page) | 35 % | 10 500 | 200 ms | Cacheable; CDN + Redis |
| `GET /events/{id}/seats` (seat map) | 30 % | 9 000 | 300 ms | Changes every second during the on-sale |
| `GET /search` | 10 % | 3 000 | 400 ms | Search service |
| `POST /holds` (hold seats) | 15 % | 4 500 | 300 ms | Strongly consistent; row locks |
| `POST /orders` (checkout) | 7 % | 2 100 | 800 ms | Calls the payment provider |
| `GET /orders/{id}` | 3 % | 900 | 200 ms | Polling for confirmation |

Three properties of real workloads are routinely lost in tests and must be modelled on purpose:

- **Skew.** Requests are not uniform over the data. During an on-sale, one event receives almost all traffic, and the best sections receive most holds — the classic **hot key / hot row** problem. Popularity is often modelled with a Zipf distribution.
- **Sessions and think time.** A fan reads the seat map for a few seconds before holding. **Think time** (the pause between a user's requests) shapes concurrency: with the same arrival rate, longer think times mean more simultaneous sessions (Little's Law again).
- **Synchronized arrivals.** Real on-sales are not a gentle ramp: hundreds of thousands of clients refresh at 10:00:00. A test that ramps over 10 minutes misses the most dangerous second of the day.

---

## The USE method: a checklist for every resource

The **USE method** says: *for every resource, check Utilization, Saturation and Errors*[^2]. Its power is completeness — it makes you look at resources you would otherwise forget — and speed: a few minutes of checks narrow the search to one resource.

- **Utilization** — how busy the resource is (percent of time, or percent of capacity).
- **Saturation** — how much extra work is queued waiting for it.
- **Errors** — error events (failed allocations, dropped packets, timeouts).

Resources are not only hardware. In a Java service, the **software resources** — pools, locks, queues — saturate more often than the CPU does:

| Resource | Utilization | Saturation | Errors | Where to read it |
|---|---|---|---|---|
| **CPU** | `%usr + %sys` per core | Run-queue length (`vmstat` column `r` > number of cores); container **throttling** | — | `mpstat -P ALL 1`, `vmstat 1`, cgroup `cpu.stat` (`nr_throttled`) |
| **Memory** | Used vs limit | Swapping, page scanning; GC running more often | `OOMKilled`, `OutOfMemoryError` | `free -m`, `vmstat` (`si/so`), JVM GC logs / JFR |
| **Network** | Throughput vs link capacity | Socket backlog, retransmits | Drops, resets | `sar -n DEV,TCP,ETCP 1`, `ss -s`, `nstat` |
| **Disk** | `%util` | Average queue size (`aqu-sz`), await | I/O errors | `iostat -xz 1` |
| **Thread pool** (Tomcat) | Busy threads / max | Accept queue / requests waiting | Rejected requests | `tomcat_threads_busy_threads`, `..._config_max_threads` (Micrometer) |
| **Connection pool** (HikariCP) | Active / maximum | **Pending threads** waiting for a connection | Connection timeouts | `hikaricp_connections_active`, `..._pending`, `..._timeout_total` |
| **Database** | CPU, I/O of the DB host | Sessions waiting (`wait_event`), lock waits | Deadlocks, statement timeouts | `pg_stat_activity`, `pg_locks`, `pg_stat_statements` |
| **Kafka partition / queue** | Consumer busy time | **Consumer lag** | DLQ messages | Consumer-lag exporter, broker metrics |

### A walk-through: why is `POST /holds` slow?

During a pre-sale test at 1 500 holds/s, the p99 of `POST /holds` is 2.1 s (SLO: 300 ms). Following USE, top to bottom:

``` mermaid-sim
flowchart TD
    s["Symptom: p99 of POST /holds = 2.1 s at 1 500 req/s"] --> cpu{"inventory CPU?"}
    cpu -->|"U 45 %, run queue low,<br/>no throttling"| mem{"Memory / GC?"}
    mem -->|"GC < 2 % of time"| tp{"Tomcat threads?"}
    tp -->|"200 / 200 busy — saturated,<br/>but busy doing what?"| pool{"Hikari pool?"}
    pool -->|"10 / 10 active,<br/>180 threads pending"| db{"PostgreSQL?"}
    db -->|"CPU 35 %, but sessions in<br/>wait_event = Lock: tuple"| root["Bottleneck: row-lock contention on hot seats,<br/>held for the whole transaction"]
```

1. **CPU of `inventory`**: 45 % utilization, short run queue, no throttling. Not the bottleneck — adding pods would not help.
2. **Memory/GC**: GC uses under 2 % of time. Fine.
3. **Tomcat threads**: all 200 busy. Saturated — but threads are a *symptom* resource: they are busy *waiting* for something.
4. **Connection pool**: 10 of 10 connections active, **180 threads pending**. Every hold waits for a connection: by Little's Law, 180 waiting / 1 500 per second ≈ 120 ms of pool wait on average, and much more in the tail.
5. **PostgreSQL**: CPU only 35 % — so a bigger instance would not help either. But `pg_stat_activity` shows most sessions in `wait_event = Lock: tuple`: transactions wait for **row locks** on the same few hot seats, and each transaction holds its lock while it also calls the pricing service.

The bottleneck is **lock contention**, amplified by long transactions. Of the four proposals in the introduction, none would have fixed it: a cache does not help writes, a bigger database has idle CPU already, more pods would add more waiters, and Go would wait on the same locks. The fixes that work — shorter transactions (call pricing *before* `BEGIN`), `SELECT … FOR UPDATE SKIP LOCKED` to hand fans *different* free seats, and a waiting room to cap concurrent holds — are discussed in [Finding bottlenecks](../bottlenecks/index.md) and [Databases — transactions](../../databases/transactions/index.md).

```sql title="Who is waiting on what? (PostgreSQL)"
SELECT wait_event_type, wait_event, state, count(*)
FROM pg_stat_activity
WHERE datname = 'boxoffice'
GROUP BY 1, 2, 3
ORDER BY count(*) DESC;
```

---

## RED and the golden signals: the service view

USE looks at **resources** from the inside. The **RED method** looks at each **service** from the outside, the way users experience it[^3]:

- **Rate** — requests per second;
- **Errors** — failed requests per second (or as a fraction);
- **Duration** — the latency distribution (histograms → percentiles).

Google's four **golden signals** — latency, traffic, errors, saturation — are the same idea plus saturation[^4]. Use them together: **RED tells you *which service* is unhappy; USE tells you *which resource* inside it is the cause.** In a load test, the RED metrics of each service are the thresholds; the USE metrics are what you inspect when a threshold fails. The [Observability class](../../observability/signals/index.md) shows how to collect both with OpenTelemetry.

---

## Test environment parity

A load test measures *the environment it runs in*. Every difference from production is a reason the result may not transfer:

| Dimension | Must match production? | BoxOffice note |
|---|---|---|
| Instance types, CPU architecture, container requests/limits | **Yes** | A test on ARM nodes says little about x86 production, and vice versa |
| Replica counts and autoscaling configuration | Yes, or scale the test proportionally *and verify linearity* | Scaling down 10× is only valid where the system scales linearly — databases and locks rarely do |
| Configuration: pool sizes, timeouts, JVM flags, feature flags | **Yes** | Same Helm values / Kustomize overlay as production, from Git |
| Data volume and distribution | **Same order of magnitude**, same skew | 1 000 seats instead of 60 000 changes every index and every cache hit ratio |
| Network path: CDN, WAF, gateway, TLS, service mesh | Yes for system tests | TLS handshakes and the gateway add CPU and latency |
| Dependencies (payment provider, e-mail) | **Simulated with realistic behaviour** | A mock that answers in 1 ms hides the 300 ms the real provider takes; use the provider's sandbox or a mock with injected latency (Toxiproxy, WireMock) |
| Observability agents | Yes | The OpenTelemetry agent has a cost; measure with it on |

Because infrastructure is code ([Delivery](../../cloud-native/delivery/index.md)), the most reliable option is an **ephemeral performance environment**: created from the same Terraform/OpenTofu modules and manifests as production for the duration of the test campaign, loaded with a production-sized synthetic data set, and destroyed afterwards.

---

## Test data

- **Volume**: same order of magnitude as production — table sizes determine index depth, plan choices and whether the working set fits in memory.
- **Distribution**: reproduce the skew (one hot event, popular sections) — or you will miss lock contention and hot partitions, and overestimate cache misses on the long tail.
- **Uniqueness**: if every virtual user logs in as the same account or holds the same seat, you test an artificial hot spot; if every request asks for a *different* random event, you test an artificial cold cache. Parameterize from realistic data files.
- **State reset**: holds and orders change the data. Restore a database snapshot before each run so that runs are comparable.
- **Privacy**: never copy production personal data into a test environment; generate synthetic data with the same statistical shape.

```javascript title="k6: parameterized users and a skewed choice of events"
import { SharedArray } from 'k6/data';

const users  = new SharedArray('users',  () => JSON.parse(open('./data/users.json')));    // 50 000 synthetic fans
const events = new SharedArray('events', () => JSON.parse(open('./data/events.json')));   // sorted by popularity

// Zipf-like choice: low indexes (popular events) are chosen much more often
export function pickEvent() {
  const u = Math.random();
  return events[Math.floor(events.length * Math.pow(u, 3))];
}

export function pickUser() {
  return users[Math.floor(Math.random() * users.length)];
}
```

---

## Warm-up: measure the steady state — and test the cold one { #warm-up }

Right after a deploy, a JVM service is slower than it will be in five minutes: classes are loading, the JIT compiler has not yet compiled the hot methods, connection pools are filling, Redis and PostgreSQL's buffer cache are cold, and the autoscaler is at its minimum. Measuring that period mixes two different questions.

- **Steady-state tests** (load, soak, breakpoint) should **warm up first** and exclude the warm-up from the thresholds.
- **Cold-start tests** deliberately measure the cold system, because production has cold moments too: a deploy during traffic, a cache flush, a failover to a cold replica, new pods added by the autoscaler during the spike.

```javascript title="k6: a warm-up scenario excluded from the thresholds"
export const options = {
  scenarios: {
    warmup: {
      executor: 'constant-arrival-rate', rate: 200, timeUnit: '1s',
      duration: '3m', preAllocatedVUs: 100, exec: 'browse',
    },
    measure: {
      executor: 'constant-arrival-rate', rate: 1000, timeUnit: '1s',
      duration: '15m', preAllocatedVUs: 500, maxVUs: 2000,
      startTime: '3m', exec: 'browse',
    },
  },
  thresholds: {
    // only the 'measure' scenario counts towards pass/fail
    'http_req_duration{scenario:measure}': ['p(99)<300'],
    'http_req_failed{scenario:measure}': ['rate<0.001'],
  },
};
```

---

## Noise and repeatability

Cloud environments are noisy: neighbours share hosts, networks vary, autoscalers take different paths. One run is an anecdote.

- **Repeat** each configuration at least three times and report the median and the spread; a difference smaller than the run-to-run spread is not a result.
- **Check the load generator**: CPU below ~70 %, no network saturation, enough virtual users allocated (k6 warns when an arrival-rate scenario runs out of VUs: `dropped_iterations`). For large tests, run k6 distributed (k6-operator on Kubernetes or a cloud service).
- **Same conditions**: same data snapshot, same time window, same versions; record them in the report.
- **Long enough**: a 2-minute test cannot reveal a connection leak, log-file growth or a memory leak — that is the job of the [soak test](../load-testing/index.md#soak-test).

!!! example "A one-page test plan for the on-sale"

    - **Objective**: `POST /holds` p99 < 300 ms, errors < 0.1 %; `GET /events/{id}` p99 < 200 ms — at 45 000 req/s total — the expected peak of 30 000 req/s × 1.5.
    - **Workload**: the endpoint mix above; Zipf-skewed events; 50 000 synthetic users; think time 2–8 s inside sessions.
    - **Model**: open (arrival rate); a 0 → peak ramp in 30 s to reproduce 10:00:00.
    - **Environment**: ephemeral `perf` environment from the prod modules; database restored from a 60 000-seat snapshot; payment mock at 300 ms ± 100 ms.
    - **Tests**: smoke → load (peak, 20 min) → spike → breakpoint → soak (4 h at the daily average).
    - **Observe**: RED per service; USE on nodes, pools and PostgreSQL; traces of slow requests; profiles of `inventory`.
    - **Exit**: thresholds pass in 3 consecutive runs, headroom ≥ 30 % at the knee.

!!! tip "In the interview"

    "Find the bottleneck" questions reward structure. Name the method out loud: "I would start from the user-facing RED metrics to find the slow service, then apply USE to its resources — including the software ones: thread pool, connection pool, locks — and only change the resource that is saturated." Mentioning that **CPU at 45 % plus a saturated connection pool means more pods will not help** is exactly the kind of insight interviewers look for.

!!! warning "Pitfalls"

    - **Stopping at the first saturated resource**: thread pools are usually saturated *because* something downstream is slow; keep following the wait.
    - **Uniform random data**: hides hot rows and overstates cache misses.
    - **Mocks that answer instantly**: the real dependency's latency holds threads and connections.
    - **Including warm-up in the steady-state result** — or never testing cold starts at all.
    - **Scaling the environment down and the results up linearly**: contention and coherency (USL) make that wrong.

---

## How it connects { #how-it-connects }

``` mermaid
flowchart LR
    SYM["symptom:<br/>POST /holds is slow"] --> RED["RED per service<br/>→ Observability signals"]
    RED --> USE["USE per resource: CPU,<br/>thread pool, connection pool, locks"]
    USE --> BOT["the saturated resource"]
    BOT --> FIX["change ONE thing<br/>→ Bottlenecks"]
    LOGS["gateway access logs<br/>in the warehouse"] --> WL["workload model:<br/>mix, arrival rate"]
    WL --> TEST["load test<br/>→ Load testing"]
    ENV["environment parity,<br/>test data, warm-up"] --> TEST
    NOISE["repeat runs,<br/>check the load generator"] --> TEST
    TEST --> SYM
```

**Palette components:** [`metrics`](../../../reference/components/observability/index.md#metrics) and [`tracing`](../../../reference/components/observability/index.md#tracing) (RED for services, USE for resources) · [`logs`](../../../reference/components/observability/index.md#logs), [`apigw`](../../../reference/components/edge/index.md#apigw) and [`dwh`](../../../reference/components/storage/index.md#dwh) (access logs turned into a workload model) · [`app`](../../../reference/components/compute/index.md#app) (thread pools, CPU) · [`sql`](../../../reference/components/storage/index.md#sql) (connection pool, locks) · [`cache`](../../../reference/components/storage/index.md#cache) (warm vs cold) · [`waf`](../../../reference/components/edge/index.md#waf) (bots that are not part of the workload). **Scenarios:** `monolith` (breakpoint profile), `observability-stack`. **Continues in:** [Observability — signals](../../observability/signals/index.md), [Load testing](../load-testing/index.md), [Bottlenecks](../bottlenecks/index.md), [Databases — transactions](../../databases/transactions/index.md), [Cloud-native — delivery](../../cloud-native/delivery/index.md) (ephemeral performance environments).

---

[^1]: GREGG, B. *Systems Performance: Enterprise and the Cloud*. 2nd ed. Addison-Wesley, 2020. Ch. 2 "Methodologies".
[^2]: GREGG, B. [The USE Method](https://www.brendangregg.com/usemethod.html){target="_blank"}.
[^3]: WILKIE, T. [The RED Method: How to Instrument Your Services](https://grafana.com/blog/2018/08/02/the-red-method-how-to-instrument-your-services/){target="_blank"}. Grafana Labs, 2018.
[^4]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/sre-book/monitoring-distributed-systems/){target="_blank"}, ch. 6 "Monitoring Distributed Systems". O'Reilly, 2016.
[^5]: JAIN, R. *The Art of Computer Systems Performance Analysis*. Wiley, 1991.
