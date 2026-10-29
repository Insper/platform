Up to now your system "works". Milestone 6 asks a harder question: **does it meet its SLOs at the test target, for long enough, every time — and what breaks first beyond it?** A load-test *campaign* answers it the way a performance team would: a written plan, a realistic workload model, a sequence of test types, repetitions, correctness checks after every run, and a log of hypotheses and fixes until the numbers hold.

!!! abstract "Goals"

    With this milestone your team will:

    - **Plan** a campaign from the test-target SLOs of your [system option](../index.md#system-options): user journeys, mix, arrival rates, data and environment.
    - **Model** the workload with an open model and per-journey thresholds in k6.
    - **Execute** smoke, load (×3), stress, spike, soak and breakpoint tests and read them with dashboards.
    - **Find** the knee and the bottleneck, and **improve** the system in documented iterations.
    - **Guard** correctness (no double booking, no lost message) and **automate** a performance gate in CI.

This milestone builds on the [load-test report](../../load-test-report/index.md) exercise, [Class 15 — Performance](../../../classes/performance/index.md) and the observability stack of [Lab 8](../../../hands-on/8/index.md). Due in **week 16**, weight **15%** of the project.

## What to deliver

- A **campaign plan** (before running anything) in the docs, following the [template](#templates).
- k6 scripts in `load/`, the data seeding script, raw results (`load/results/`, one summary JSON per run), dashboard screenshots.
- A **campaign report**: results per test, SLO verdict, knee, bottleneck, iteration log, correctness checks.
- A **performance gate** job in the CI workflow ([Lab 11](../../../hands-on/11/index.md)).
- The tag `m6` on the commit with all of the above.

## Acceptance criteria

- [ ] **(mandatory)** Plan written and committed **before** the first load run (the commit history shows it).
- [ ] **(mandatory)** At the **test target** of your option, every SLO holds for **≥ 10 minutes** of steady state in **3 repetitions** (or, if not reachable, the bottleneck is proven and a new target was agreed with the instructor before week 14).
- [ ] Workload model with **at least 3 user journeys**, a mix in %, and **open-model** executors (`constant-arrival-rate` / `ramping-arrival-rate`).
- [ ] Per-journey thresholds (tags) that encode the SLOs; k6 exits non-zero when an SLO fails.
- [ ] Smoke, load ×3, stress up to **2× the target**, spike, soak **≥ 30 minutes** and breakpoint executed; raw results committed.
- [ ] Knee identified (throughput vs p99) and the **bottleneck** named with evidence (dashboards, USE, Little's Law).
- [ ] **≥ 2 improvement iterations** documented with before/after numbers under the same workload.
- [ ] A **correctness check** after every run (e.g. 0 double bookings) with its output.
- [ ] A **performance gate** in CI: a k6 smoke run with thresholds that fails the pipeline on regression.
- [ ] *AI usage* section (see the [policy](../../index.md#use-of-ai-tools)).

## Step by step

### 1. Write the plan first

A plan forces the team to agree on what "success" means **before** the numbers tempt you to move the goalposts. Start from the SLO table of your option; turn each SLO into a k6 threshold; define the journeys and their share of the traffic from your M1 estimates; decide where the tests run (Docker Compose or Kubernetes, which machine, which resources) and what data is seeded.

``` diagram
flowchart LR
    plan["Plan<br/>SLOs → thresholds<br/>journeys, mix, data"] --> smoke["Smoke<br/>script works"]
    smoke --> load["Load ×3<br/>target, ≥ 10 min"]
    load --> stress["Stress<br/>up to 2× target"]
    stress --> spike["Spike"]
    spike --> soak["Soak<br/>≥ 30 min"]
    soak --> bp["Breakpoint"]
    bp --> analyse["Analyse<br/>knee, bottleneck"]
    analyse -->|"hypothesis → change"| load
```

### 2. Model the workload

Real users do not hit one endpoint: a BoxOffice fan browses, joins the waiting room, holds seats and (sometimes) pays. One k6 scenario per journey, each with its own arrival rate, keeps the mix exact and lets you set a threshold per journey[^1].

```javascript title="load/boxoffice.js"
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:8080';
const TYPE = __ENV.TEST_TYPE || 'load';
const BROWSE = Number(__ENV.BROWSE_RATE || 1000); // catalog reads/s at the test target
const HOLD = Number(__ENV.HOLD_RATE || 100);      // seat holds/s at the test target
const EVENTS = Number(__ENV.EVENTS || 1000);
const TOKEN = __ENV.TOKEN || '';

const JSON_HEADERS = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };
// 409 (seat already taken) and 429 (waiting room full) are business outcomes, not failures
const BUSINESS = http.expectedStatuses({ min: 200, max: 299 }, 409, 429);

function profile(rate) {
  const r = (f) => Math.max(1, Math.round(rate * f));
  const base = { timeUnit: '1s', preAllocatedVUs: Math.max(10, r(0.2)), maxVUs: Math.max(100, r(3)) };
  switch (TYPE) {
    case 'smoke':
      return { ...base, executor: 'constant-arrival-rate', rate: 1, duration: '1m' };
    case 'stress': {
      const stages = [];
      for (const f of [0.5, 1, 1.25, 1.5, 1.75, 2]) {
        stages.push({ target: r(f), duration: '30s' }, { target: r(f), duration: '2m' });
      }
      return { ...base, executor: 'ramping-arrival-rate', startRate: r(0.1), stages };
    }
    case 'spike':
      return { ...base, executor: 'ramping-arrival-rate', startRate: r(0.2), stages: [
        { target: r(0.2), duration: '2m' }, { target: r(3), duration: '10s' },
        { target: r(3), duration: '2m' }, { target: r(0.2), duration: '10s' },
        { target: r(0.2), duration: '3m' } ] };
    case 'soak':
      return { ...base, executor: 'ramping-arrival-rate', startRate: r(0.1), stages: [
        { target: r(1), duration: '2m' }, { target: r(1), duration: '30m' } ] };
    case 'breakpoint':
      return { ...base, executor: 'ramping-arrival-rate', startRate: r(0.1), stages: [
        { target: r(4), duration: '20m' } ] };
    default: // load
      return { ...base, executor: 'ramping-arrival-rate', startRate: r(0.1), stages: [
        { target: r(1), duration: '2m' }, { target: r(1), duration: '10m' }, { target: 0, duration: '30s' } ] };
  }
}

export const options = {
  scenarios: {
    browse: { ...profile(BROWSE), exec: 'browse' },          // 1. browse the catalog
    queue: { ...profile(HOLD * 2), exec: 'joinQueue' },      // 2. join the waiting room
    hold: { ...profile(HOLD * 0.3), exec: 'holdAndLeave' },  // 3. hold and abandon (hold expires)
    purchase: { ...profile(HOLD * 0.7), exec: 'purchase' },  // 4. hold and pay
  },
  thresholds: {
    'http_req_duration{name:catalog}': ['p(99)<200'],
    'http_req_duration{name:hold}': ['p(99)<500'],
    'http_req_failed{scenario:browse}': ['rate<0.001'],
    'http_req_failed{scenario:purchase}': ['rate<0.001'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

const eventId = () => 1 + Math.floor(Math.random() * EVENTS);

export function browse() {
  const res = http.get(`${BASE}/events/${eventId()}`, { tags: { name: 'catalog' } });
  check(res, { 'catalog 200': (r) => r.status === 200 });
}

export function joinQueue() {
  const res = http.post(`${BASE}/queue/${eventId()}`, null,
    { headers: JSON_HEADERS, tags: { name: 'queue' }, responseCallback: BUSINESS });
  check(res, { 'queue accepted or full': (r) => r.status === 200 || r.status === 202 || r.status === 429 });
}

function hold() {
  const body = JSON.stringify({ eventId: eventId(), quantity: 1 + Math.floor(Math.random() * 4) });
  return http.post(`${BASE}/holds`, body,
    { headers: JSON_HEADERS, tags: { name: 'hold' }, responseCallback: BUSINESS });
}

export function holdAndLeave() {
  const res = hold();
  check(res, { 'hold created or seat taken': (r) => r.status === 201 || r.status === 409 });
}

export function purchase() {
  const res = hold();
  if (res.status !== 201) {
    return; // seat taken: the fan tries again later
  }
  const pay = http.post(`${BASE}/orders`, JSON.stringify({ holdId: res.json('id') }),
    { headers: JSON_HEADERS, tags: { name: 'pay' } });
  check(pay, { 'order created': (r) => r.status === 201 });
}
```

Adapt URLs, payloads and authentication to your API (obtain a token in `setup()` or disable auth for a dedicated test profile — and say so). For other options the journeys change (chat: connect, send, read history; ride-sharing: location updates, nearby query, request ride; feed: read timeline, post, like; video: request manifest/segments, upload; assistant: ask, ask with tool call), but the structure stays the same.

??? example "AI support assistant: TTFT with a stub LLM"

    Load-test the assistant against a **stub LLM** (a tiny HTTP server that streams tokens with a fixed latency distribution), so that you measure *your* system and not the model provider. For a streaming endpoint, the time until the first byte arrives is a good proxy for the time to first token:

    ```javascript title="load/assistant.js (excerpt)"
    import http from 'k6/http';
    import { Trend } from 'k6/metrics';

    const ttft = new Trend('ttft', true);

    export const options = { thresholds: { ttft: ['p(95)<2000'] } };

    export default function () {
      const body = JSON.stringify({ question: 'Can I change the name on my ticket?' });
      const res = http.post(`${__ENV.BASE_URL}/assistant/chat`, body,
        { headers: { 'Content-Type': 'application/json' }, tags: { name: 'chat' } });
      ttft.add(res.timings.waiting); // time to first byte of the streamed answer
    }
    ```

    Measure the real model separately at a low rate (e.g. 1 request/s) and report both.

### 3. Seed the data and fix the environment

Every run starts from the **same state**: the same events, seats and users, an empty (or known) waiting room, caches flushed or warmed the same way. Write it as a script (`load/seed.sh`) and run it before each test. Fix the resources (Compose `cpus`/`mem_limit`, Kubernetes requests/limits, HPA min/max) and write them in the plan.

### 4. Run the sequence

```bash title="load/campaign.sh"
#!/usr/bin/env bash
# usage: ./load/campaign.sh <test-type> <run-number>   e.g. ./load/campaign.sh load 2
set -euo pipefail
TYPE=${1:-smoke}; RUN=${2:-1}
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p load/results
./load/seed.sh
k6 run -e TEST_TYPE="$TYPE" -e BASE_URL="${BASE_URL:-http://localhost:8080}" \
  --summary-export "load/results/${TYPE}-run${RUN}-${STAMP}.json" \
  load/boxoffice.js | tee "load/results/${TYPE}-run${RUN}-${STAMP}.txt"
psql "${CHECK_DB_URL:?set CHECK_DB_URL}" -f load/correctness.sql \
  | tee "load/results/${TYPE}-run${RUN}-${STAMP}-correctness.txt"
```

While each test runs, watch the RED dashboard (rate, errors, duration per service) and the saturation signals (CPU, pool usage, consumer lag, HPA replicas) in Grafana. Take screenshots at the steady state and at the knee; write down timestamps of anything odd.

| Test | What it answers | Pass criterion |
|-|-|-|
| Smoke | Do the script, data and system work? | 0 errors |
| Load ×3 | Are the SLOs met at the target, repeatably? | All thresholds pass in the 3 runs |
| Stress (to 2×) | Where is the knee? What saturates first? | Knee located; graceful degradation (no crash) |
| Spike | Does the system absorb a sudden ×3 (waiting room, autoscaling)? | Errors bounded; recovery time measured |
| Soak (≥ 30 min) | Leaks, slow growth (memory, connections, lag, disk)? | No upward trend in latency or resources |
| Breakpoint | What is the maximum before failure? | Breaking rate reported |

### 5. Check correctness after every run

A fast system that sells the same seat twice has failed. After **every** run, execute a correctness query and keep its output.

```sql title="load/correctness.sql"
-- BoxOffice: a seat may belong to at most one active hold or sold order
SELECT event_id, seat_id, count(*) AS owners
  FROM seat_allocations
 WHERE status IN ('HELD', 'SOLD')
 GROUP BY event_id, seat_id
HAVING count(*) > 1;

-- every paid order has exactly its seats marked SOLD
SELECT o.id
  FROM orders o
  LEFT JOIN seat_allocations s ON s.order_id = o.id AND s.status = 'SOLD'
 WHERE o.status = 'PAID'
 GROUP BY o.id, o.quantity
HAVING count(s.seat_id) <> o.quantity;
```

| Option | Correctness check |
|-|-|
| BoxOffice flash sale | 0 double bookings; sold seats = seats of paid orders |
| Real-time chat | No gaps in per-conversation sequence numbers for acknowledged messages |
| Ride-sharing dispatch | No driver assigned to two active trips |
| Social feed | Sampled followers see the post within the SLO; counters consistent |
| Video platform | Every acknowledged upload has all renditions or a failed job with a reason |
| AI support assistant | 0 unsafe tool actions; every tool call logged with the user's identity |

### 6. Iterate: hypothesis → change → result

When a test fails (or to move the knee), write the **hypothesis first**, with a number: "the inventory pool (10 connections) is exhausted at ~400 holds/s because L = λ × W = 400 × 0.025 = 10". Change **one** thing, rerun the same test, record the result — confirmed or refuted. Two documented iterations at least; each one is a small story with evidence.

### 7. Gate performance in CI

A smoke test with thresholds in the pipeline catches regressions (a missing index, an N+1 query) before they reach the campaign. Add a job to the workflow of [Lab 11](../../../hands-on/11/index.md):

```yaml title=".github/workflows/ci.yaml (excerpt)"
  performance-gate:
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: actions/checkout@v4
      - name: Start the system
        run: docker compose up -d --wait
      - name: Seed test data
        run: ./load/seed.sh
      - uses: grafana/setup-k6-action@v1
      - name: k6 smoke with SLO thresholds (fails the job on regression)
        run: k6 run -e TEST_TYPE=smoke -e BASE_URL=http://localhost:8080 load/boxoffice.js
```

The runner is small and shared, so the gate uses **smoke rates** and generous thresholds; it detects regressions, not capacity.

## Templates

=== "English"

    ~~~markdown
    # Load-test campaign — <team / system>

    ## 1. Plan (committed before the first run)
    ### Objectives (test-target SLOs)
    | SLI | Journey | Threshold | k6 threshold |
    |-|-|-|-|
    | p99 latency | browse | < 200 ms | `http_req_duration{name:catalog}: p(99)<200` |

    ### Workload model
    | Journey | Steps | Share | Arrival rate at target |
    |-|-|-|-|
    | browse | GET event | ...% | ... /s |

    ### Data and environment
    Seeded data (volumes); environment (Compose/K8s, machine, resources, HPA); where k6 runs.

    ### Entry and exit criteria
    Entry: smoke passes, dashboards up, data seeded. Exit: 3 load runs pass, or bottleneck proven.

    ## 2. Results
    | Test | Run | Rate | p50 | p95 | p99 | Errors | Thresholds | Correctness |
    |-|-|-|-|-|-|-|-|-|
    | load | 1 | | | | | | pass/fail | 0 violations |

    Charts: throughput vs p99 (knee), spike timeline, soak trends. Dashboard screenshots.

    ## 3. Bottleneck
    Resource, evidence (USE, Little's Law), why it saturates first.

    ## 4. Iteration log
    | # | Hypothesis (with numbers) | Change | Before | After | Verdict |
    |-|-|-|-|-|-|
    | 1 | | | | | confirmed / refuted |
    | 2 | | | | | |

    ## 5. Verdict
    At the test target, the SLOs hold / do not hold because ... Capacity statement: ...

    ## 6. Performance gate
    Link to the workflow run; thresholds used.

    ## 7. AI usage
    ~~~

=== "Português"

    ~~~markdown
    # Campanha de testes de carga — <time / sistema>

    ## 1. Plano (versionado antes da primeira execução)
    ### Objetivos (SLOs da meta de teste)
    | SLI | Jornada | Limite | Threshold do k6 |
    |-|-|-|-|
    | latência p99 | navegar | < 200 ms | `http_req_duration{name:catalog}: p(99)<200` |

    ### Modelo de carga
    | Jornada | Passos | Parcela | Taxa de chegada na meta |
    |-|-|-|-|
    | navegar | GET evento | ...% | ... /s |

    ### Dados e ambiente
    Dados carregados (volumes); ambiente (Compose/K8s, máquina, recursos, HPA); onde o k6 roda.

    ### Critérios de entrada e saída
    Entrada: smoke passa, dashboards no ar, dados carregados. Saída: 3 execuções de load passam, ou gargalo provado.

    ## 2. Resultados
    | Teste | Execução | Taxa | p50 | p95 | p99 | Erros | Thresholds | Correção |
    |-|-|-|-|-|-|-|-|-|
    | load | 1 | | | | | | passou/falhou | 0 violações |

    Gráficos: vazão vs p99 (joelho), linha do tempo do spike, tendências do soak. Capturas dos dashboards.

    ## 3. Gargalo
    Recurso, evidência (USE, Lei de Little), por que satura primeiro.

    ## 4. Registro de iterações
    | # | Hipótese (com números) | Mudança | Antes | Depois | Veredito |
    |-|-|-|-|-|-|
    | 1 | | | | | confirmada / refutada |
    | 2 | | | | | |

    ## 5. Veredito
    Na meta de teste, os SLOs se mantêm / não se mantêm porque ... Declaração de capacidade: ...

    ## 6. Portão de desempenho
    Link para a execução do workflow; thresholds usados.

    ## 7. Uso de IA
    ~~~

## Rubric

Levels as defined in [How the exercises are graded](../../index.md#how-the-exercises-are-graded).

| Criterion | I | D | C | B | A |
|-|-|-|-|-|-|
| Plan **(mandatory)** | None | Written after the runs, or SLOs missing | SLOs, journeys, mix, data, environment, entry/exit criteria | Mix and rates derived from the M1 estimates | Risks of the test itself (generator limits, data) planned for |
| SLO verdict **(mandatory)** | No load runs | Fewer than 3 runs, or < 10 min steady | SLOs met at the target in 3 runs (or bottleneck proven and target agreed) | Spread across runs reported and explained | Margin above the target quantified (e.g. holds at 1.3×) |
| Workload and scripts | Single endpoint, closed model | Open model but no per-journey thresholds | ≥ 3 journeys, open model, per-journey thresholds | Business outcomes (409/429) handled correctly | Think time, sessions or data skew modelled and justified |
| Test sequence | — | Some types missing | All six types with raw results | Each type interpreted (knee, recovery, trends, breaking rate) | Soak or spike reveals and fixes a real problem |
| Bottleneck and iterations | Guess | One iteration or no before/after | ≥ 2 iterations with before/after | Hypotheses quantified before the change | Next bottleneck predicted and confirmed |
| Correctness and CI gate | — | Correctness not checked | Check after every run + CI gate running | Gate caught (or would catch) a demonstrated regression | Correctness checked under spike and failure, not only at steady state |

## FAQ

??? question "Our machine cannot reach the test target. What now?"

    That is a result, if you prove it: show the bottleneck (often the load generator or the laptop's CPU, not the service), the knee and the evidence. Then agree a new target with the instructor **before week 14** — not the night before the deadline.

??? question "Should the campaign run on Docker Compose or on Kubernetes?"

    On the environment you will present, preferably Kubernetes (M5) with the HPA active, since autoscaling is part of how the system meets its SLOs. If you run on Compose, say why and keep the resources fixed.

??? question "One of the three load runs failed. Can we drop it?"

    No. Report all runs. Investigate the failing one (noise, a GC pause, a cold cache, an autoscaling delay); if you fix the cause, rerun all three.

??? question "Do 409 and 429 responses count as errors?"

    Not when they are the designed behaviour (seat taken, waiting room full). Mark them as expected in k6 (`responseCallback`) and report them separately: a waiting room that rejects 90% of fans is "correct" but deserves a sentence in the report.

??? question "How long does the whole campaign take?"

    Count it: 3 × 13 min of load, ~15 min of stress, ~8 min of spike, 32 min of soak, ~20 min of breakpoint — about two hours of runs, plus analysis and iterations. Start early in the milestone.

??? question "Can AI write the k6 script?"

    It can draft it — declare it. You must be able to explain every scenario, rate and threshold, and why the model is open. Results, as always, must come from your own runs.

[^1]: Grafana k6 documentation, "Scenarios" and "Thresholds" (tags and per-scenario thresholds), [grafana.com/docs/k6](https://grafana.com/docs/k6/latest/using-k6/scenarios/){target="_blank"}.
