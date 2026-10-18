The business asks a simple question: "Can we put the stadium show on sale on March 14 at 10:00?" Behind it are engineering questions with numeric answers: how many replicas of each service, how big the database, how many connections, what admission rate for the waiting room, how early to scale up — and how much it costs. **Capacity planning**[^2] turns the measurements of the previous pages into those numbers, with enough margin to survive what you did not predict.

---

## From measurements to replicas

Capacity planning is arithmetic on three inputs you now know how to obtain:

1. **Demand** — the peak arrival rate per endpoint, from the [workload model](../methodology/index.md#workload-model) (forecast × safety factor).
2. **Capacity per unit** — the **knee** of one pod (or one database) from a [breakpoint test](../load-testing/index.md): the highest rate at which it still meets the SLO.
3. **Headroom** — how far below the knee you want to run, and which failures you must survive.

$$
\text{replicas} = \left\lceil \frac{\text{peak demand}}{\text{knee per replica} \times (1 - \text{headroom})} \right\rceil
\quad\text{then add replicas to survive the loss of one zone}
$$

### Little's Law sizes everything that holds a request

Replicas are not the only resource. Every component that *holds* a request while it is in progress — threads, connections, sockets, VUs, queue slots — must be sized for the concurrency, and Little's Law gives it directly: **concurrency = arrival rate × time held**[^1].

| Resource | Rate | Time held | Concurrency needed |
|---|---|---|---|
| Request threads of `inventory` | 3 000 holds/s | 120 ms (p50 response) | 360 threads across all pods — more for the tail |
| PostgreSQL connections | 3 000 holds/s | 6 ms per transaction | 18 active connections (behind PgBouncer) |
| k6 VUs for the load test | 1 000 `hold()` iterations/s | 3.5 s per iteration | 3 500 VUs |
| Waiting room | 500 fans admitted/s | position 600 000 in the queue | 600 000 / 500 = 1 200 s: a 20-minute wait to show the fan |

### A capacity model for the on-sale

The model below combines the workload model's peak rates with per-pod knees measured in breakpoint tests (all values are illustrative assumptions — replace them with your measurements). It plans to run at most at 75 % of the knee and spreads replicas over three availability zones so that losing one zone still leaves enough capacity:

```python exec="1" html="1"
# Capacity model for the on-sale. Inputs are ASSUMPTIONS: peak demand from the
# workload model, per-pod knees from breakpoint tests. Change them and re-run.
import math

HEADROOM = 0.25          # plan to run at most at 75 % of the measured knee
ZONES = 3                # replicas spread over 3 availability zones; survive losing one
POOL = 10                # connections per pod (services that use PostgreSQL)

# service: (peak req/s without waiting room, peak with waiting room, knee per pod, uses SQL?)
SERVICES = {
    "gateway":   (30000, 30000, 4000, False),
    "catalog":   (19500, 19500, 1500, True),
    "search":    (3000,  3000,  600,  False),
    "inventory": (4500,  3000,  275,  True),
    "order":     (3000,  2000,  150,  True),
}

def pods(demand, knee):
    base = math.ceil(demand / (knee * (1 - HEADROOM)))
    survive_zone = math.ceil(base * ZONES / (ZONES - 1))      # after losing 1 zone, base remains
    return base, ZONES * math.ceil(survive_zone / ZONES)        # round up to a multiple of 3

rows, conns = [], {"no": 0, "wr": 0}
for name, (d_no, d_wr, knee, sql) in SERVICES.items():
    b_no, p_no = pods(d_no, knee)
    b_wr, p_wr = pods(d_wr, knee)
    if sql:
        conns["no"] += p_no * POOL
        conns["wr"] += p_wr * POOL
    rows.append(f"<tr><td><code>{name}</code></td><td>{knee:,}</td>"
                f"<td>{d_no:,}</td><td>{b_no} → <strong>{p_no}</strong></td>"
                f"<td>{d_wr:,}</td><td>{b_wr} → <strong>{p_wr}</strong></td></tr>")

print("<table><thead><tr><th>Service</th><th>Knee per pod (req/s)</th>"
      "<th>Peak, no waiting room</th><th>Pods (load → +zone loss)</th>"
      "<th>Peak, waiting room</th><th>Pods (load → +zone loss)</th></tr></thead><tbody>"
      + "".join(rows) +
      f"<tr><td><strong>PostgreSQL client connections</strong></td><td>pool {POOL}/pod</td>"
      f"<td></td><td><strong>{conns['no']:,}</strong></td><td></td><td><strong>{conns['wr']:,}</strong></td></tr>"
      "</tbody></table>")
```

What the model says:

- **The waiting room saves capacity where it is most expensive.** Capping admitted holds at 3 000/s (below the database's knee) cuts `inventory` and `order` replicas by about a third — and, more importantly, keeps the load on the single primary database bounded.
- **Zone resilience costs 50 % more replicas** at the peak. That is the price of "a zone outage at 10:01 does not stop the sale". It may be worth it on on-sale day and not on a Tuesday — autoscaling bounds can differ by day.
- **The connection count is a red flag.** Close to a thousand client connections cannot go directly to PostgreSQL; PgBouncer (transaction pooling) multiplexes them onto a few dozen server connections — the number Little's Law actually requires.
- **Pods become nodes become dollars.** About a hundred pods at the peak is roughly the "+24 nodes for 2 hours" of the [FinOps cost model](../../cloud-native/finops/index.md).

---

## Headroom: why not run at 100 % of the knee?

| Reason for headroom | What happens without it |
|---|---|
| **Forecast error** | The show is more popular than expected; demand exceeds the plan |
| **Sub-minute bursts** | Dashboards average over a minute; inside it, some seconds carry 2–3× the average |
| **Failures** | A zone, a node or a pod is lost; the survivors absorb its load |
| **Deployments** | Rolling updates and canaries temporarily remove or divert capacity |
| **Autoscaling lag** | New capacity arrives minutes after the demand |
| **Noisy neighbours, GC, compaction** | Capacity per pod varies run to run |

Typical targets run services at 50–75 % of their knee at the expected peak; the right number depends on how fast you can add capacity and how expensive a breach is. For BoxOffice's on-sale — minutes long, highly visible, impossible to repeat — generous headroom is cheap insurance.

---

## Autoscaling lag: the minutes that matter

Autoscaling reacts to demand; it does not anticipate it. A rough timeline for a JVM service on Kubernetes when the spike starts:

| Step | Typical duration |
|---|---|
| Metrics pipeline notices the change (scrape + aggregation) | 15–60 s |
| HPA evaluation and decision | up to 15 s |
| Pod scheduled — **if** a node has room; otherwise node provisioning | seconds / 1–3 min |
| Image pull on a new node | seconds to a minute |
| JVM start, Spring context, readiness, JIT warm-up | 20–60 s |
| **Total** | **≈ 1–4 minutes** |

During that window the backlog grows at the difference between demand and capacity. If holds jump from 500/s to 4 500/s while the deployment can serve 1 100/s for two minutes, the backlog is $(4\,500 - 1\,100) \times 120 \approx 408\,000$ requests — far beyond any timeout. They become errors, retries make it worse, and the fans who arrived first get the worst experience. Hence the rules for **known** peaks:

- **Pre-scale** before the event (a scheduled scale-up at 09:45; KEDA's cron scaler; raised `minReplicas`), and keep spare node capacity.
- **Admission control** (waiting room, rate limiting) so that excess demand waits *outside* the system, in order, instead of timing out inside it[^3].
- **Warm up** the new capacity: caches pre-loaded with the event, connection pools filled (`minimum-idle = maximum-pool-size`), a warm-up request to each new pod before it becomes ready.

Serverless platforms shorten the lag but do not remove it: new function instances have **cold starts**, and providers limit how fast concurrency may grow and how much concurrency an account may use (check the current quotas of your provider).

Try it: the scenario below sends a burst to a serverless component. Run it with the default settings and watch the cold-start latency at the start of the burst and the throttled (rejected) requests when the concurrency limit is reached. Then raise the limit or add provisioned (pre-warmed) concurrency, and compare the first seconds of the burst — the serverless version of pre-scaling.

<div class="sdp" data-scenario="serverless-burst" data-mode="compact" data-profile="spike" data-height="520"></div>

---

## Forecasting and the capacity review

Capacity planning is not done once. A simple, sustainable process:

- **Forecast** demand from history: trend (growth per month), seasonality (weekends, holidays) and **events** (on-sales are announced in advance — use the calendar, not only the trend).
- **Re-measure** capacity per unit after every significant change; a new feature can move the knee more than any infrastructure change. The performance budget in CI (below) catches most regressions before they reach production.
- **Review** monthly: peak utilization vs plan, headroom left, cost per unit of demand, upcoming events. Capacity, SLOs and cost belong in the same meeting.
- **Prefer elasticity to precision**: a system that scales out in one minute needs a less precise forecast than one that needs a week to order hardware.

---

## Performance budgets in CI { #performance-budgets }

A performance regression that reaches production is found by fans. A **performance budget** is a limit — per endpoint, per page, per build — that the pipeline enforces on every change, the same way tests enforce correctness[^4]. Useful budgets mix noisy and deterministic measures:

| Budget | Example for BoxOffice | Noise | How to enforce |
|---|---|---|---|
| **Latency** at a fixed moderate rate | `POST /holds` p95 < 150 ms at 20 holds/s | Medium–high on shared CI runners | k6 thresholds with margin + comparison with `main`'s baseline |
| **Error rate** | < 0.1 % | Low | k6 threshold |
| **Queries per request** | `GET /orders/{id}`: ≤ 3 SQL statements | None (deterministic) | Integration test counting statements (catches N+1 reliably) |
| **Payload size** | Seat-map JSON ≤ 60 KB | None | Contract test |
| **Allocations / CPU per request** | ≤ baseline + 10 % | Low (with JMH or a profiler) | Micro-benchmark job |
| **Image size and startup time** | Image ≤ 250 MB; ready in ≤ 30 s | Low | Pipeline step on the built image |

The k6 budget is a short, open-model test against a production-like stack started inside the job. It is not a capacity test — CI runners are small and noisy — but it reliably catches the big regressions: a missing index, an N+1, a synchronous call added to the hot path.

```javascript title="k6/budget.js"
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';
import { browse, hold } from './lib/boxoffice.js';
export { browse, hold };

export const options = {
  scenarios: {
    browse: { executor: 'constant-arrival-rate', exec: 'browse', rate: 100, timeUnit: '1s',
              duration: '3m', preAllocatedVUs: 50, maxVUs: 200 },
    hold:   { executor: 'constant-arrival-rate', exec: 'hold', rate: 20, timeUnit: '1s',
              duration: '3m', preAllocatedVUs: 100, maxVUs: 300 },
  },
  thresholds: {
    'http_req_duration{name:GET /events/{id}}': ['p(95)<80'],
    'http_req_duration{name:POST /holds}':      ['p(95)<150'],
    http_req_failed: ['rate<0.001'],
    dropped_iterations: ['count==0'],
  },
};

export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: false }),
    'results/summary.json': JSON.stringify(data),
  };
}
```

```yaml title=".github/workflows/perf-budget.yaml"
name: perf-budget
on:
  pull_request:
  push: { branches: [ main ] }        # main's runs become the baseline

jobs:
  k6:
    runs-on: ubuntu-latest
    permissions: { contents: read, actions: read }
    steps:
      - uses: actions/checkout@v4
      - name: Start BoxOffice with production-like settings
        run: docker compose -f compose.yaml -f compose.perf.yaml up -d --build --wait
      - name: Seed a 60 000-seat event
        run: docker compose exec -T db psql -U postgres -d boxoffice -f /seed/onsale.sql
      - uses: grafana/setup-k6-action@v1
      - name: Warm up (not measured)
        run: k6 run --quiet -e BASE_URL=http://localhost:8080 --vus 5 --duration 30s k6/smoke.js
      - name: Performance budget (fails on threshold breach)
        run: mkdir -p results && k6 run -e BASE_URL=http://localhost:8080 k6/budget.js
      - name: Compare with the latest baseline from main
        if: github.event_name == 'pull_request'
        env: { GH_TOKEN: "${{ github.token }}" }
        run: |
          id=$(gh run list --workflow perf-budget --branch main --status success --limit 1 \
                 --json databaseId -q '.[0].databaseId')
          gh run download "$id" --name k6-summary --dir baseline || echo "no baseline yet"
          python3 k6/compare.py results/summary.json baseline/summary.json --max-regression 0.15
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: k6-summary, path: results/summary.json }
```

```python title="k6/compare.py"
import argparse
import json
import os
import sys

parser = argparse.ArgumentParser(description="Compare k6 p95 per endpoint with a baseline")
parser.add_argument("current")
parser.add_argument("baseline")
parser.add_argument("--max-regression", type=float, default=0.15)
args = parser.parse_args()


def p95_by_endpoint(path):
    metrics = json.load(open(path))["metrics"]
    return {name: m["values"]["p(95)"] for name, m in metrics.items()
            if name.startswith("http_req_duration{name:")}


current = p95_by_endpoint(args.current)
baseline = p95_by_endpoint(args.baseline) if os.path.exists(args.baseline) else {}
failed = False
for name, value in sorted(current.items()):
    ref = baseline.get(name)
    if ref is None:
        print(f"{name}: {value:.1f} ms (no baseline)")
        continue
    change = (value - ref) / ref
    regression = change > args.max_regression
    failed |= regression
    print(f"{name}: {ref:.1f} -> {value:.1f} ms ({change:+.0%}){'  REGRESSION' if regression else ''}")
sys.exit(1 if failed else 0)
```

Two gates protect the budget: the **absolute** thresholds in `budget.js` (derived from the SLOs, with margin for the small runner) and the **relative** comparison with `main` (a 15 % slowdown fails even if the absolute threshold still passes). To keep the gate trusted rather than ignored:

- **Fight noise**: fixed arrival rate, warm-up step, the same runner type, and repeat once automatically before failing; a dedicated self-hosted runner reduces variance further.
- **Prefer deterministic budgets** where possible: a query-count assertion in an integration test never flakes, and catches the most common regression (N+1).
- **Make failures actionable**: upload the summary, link the trace of the slowest request, and say which endpoint regressed by how much.
- **Run the full campaign elsewhere**: the PR gate is a smoke alarm; the load, spike and breakpoint tests run nightly or before big events in the performance environment. [Hands-on 11](../../../hands-on/11/index.md) wires this gate into the BoxOffice pipeline.

!!! tip "In the interview"

    Close the capacity part of a design with an explicit calculation: "Peak 4 500 holds/s; one pod sustains ~275 within the SLO; at 75 % of the knee that is 22 pods, 33 to survive a zone loss; connections by Little's Law are 4 500 × 6 ms ≈ 27 active, so PgBouncer in front of the primary; autoscaling takes minutes, so we pre-scale at 09:45 and the waiting room admits at most what the database can take." Few candidates connect **measured knee → replicas → headroom → admission control**; doing it in one breath is a strong signal.

!!! warning "Pitfalls"

    - **Planning with the maximum throughput instead of the knee**: the system "handles" that rate with a broken SLO.
    - **Forgetting shared resources**: 30 more pods are 300 more database connections.
    - **Relying on reactive autoscaling for a known spike**: the lag is longer than the spike's critical minutes.
    - **Headroom that disappears in a failure**: compute capacity *after* losing a zone, not before.
    - **A flaky performance gate**: if it fails randomly, people learn to re-run it until green — reduce noise and prefer deterministic budgets.
    - **Never re-measuring**: the knee moves with every release; yesterday's capacity plan is a hypothesis.

---

## How it connects { #how-it-connects }

``` mermaid
flowchart LR
    KNEE["measured knee per pod<br/>← Load testing"] --> REP["replicas = peak ÷<br/>(knee × target utilization)"]
    LL["Little's Law<br/>N = X × R"] --> CONN["threads, connections,<br/>PgBouncer"]
    REP --> HEAD["headroom:<br/>zone loss, 75 % of the knee"]
    HEAD --> LAG["autoscaling lag, cold starts<br/>→ pre-scale before 10:00"]
    LAG --> WR["waiting room admits what<br/>the database can take"]
    REP --> COST["pods → nodes → dollars<br/>→ Cloud-native FinOps"]
    FC["forecast and<br/>capacity review"] --> REP
    BUD["performance budget in CI<br/>guards the knee"] --> KNEE
```

**Palette components:** [`app`](../../../reference/components/compute/index.md#app) (replicas per service) · [`sql`](../../../reference/components/storage/index.md#sql) (connections and the primary's limit) · [`queue`](../../../reference/components/messaging/index.md#queue) (the waiting room's admission rate) · [`serverless`](../../../reference/components/compute/index.md#serverless) (cold starts and concurrency limits) · [`metrics`](../../../reference/components/observability/index.md#metrics) (utilization, the autoscaler's signal). **Scenarios:** `serverless-burst`, `scale-out`, `flash-sale`. **Continues in:** [Estimation — queueing](../../estimation/queueing/index.md), [Compute — serverless & autoscaling](../../compute/serverless-autoscaling/index.md), [Cloud-native — Kubernetes](../../cloud-native/kubernetes/index.md), [Cloud-native — FinOps](../../cloud-native/finops/index.md), [Case study — ticketing](../../case-studies/ticketing/index.md).

---

[^1]: LITTLE, J. D. C. A Proof for the Queuing Formula: L = λW. *Operations Research*, v. 9, n. 3, p. 383–387, 1961.
[^2]: ALLSPAW, J.; KEJARIWAL, A. *The Art of Capacity Planning: Scaling Web Resources in the Cloud*. 2nd ed. O'Reilly, 2017.
[^3]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/sre-book/handling-overload/){target="_blank"}, ch. 21 "Handling Overload". O'Reilly, 2016.
[^4]: Grafana Labs. [Automated performance testing](https://grafana.com/docs/k6/latest/testing-guides/automated-performance-testing/){target="_blank"}. k6 documentation.
