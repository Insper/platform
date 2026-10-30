The test that failed to predict last year's outage used 200 virtual users, each looping "request, wait for the response, sleep one second". It reported p95 = 180 ms. On the real day the p99 was over 10 seconds. Both numbers were *measured*; only one described reality. The difference was not the tool — it was how the test generated load, what it measured, and what it asked. This page is about designing load tests that tell the truth: the six classic test types, the workload model behind each, thresholds that encode SLOs, and the measurement errors that make tests lie.

All examples use **k6** (Grafana Labs), the load-testing tool of the course labs: tests are JavaScript, the engine is Go, and it supports both workload models through its *executors*[^1]. Equivalent snippets for Gatling, Locust, JMeter, wrk2 and vegeta are at the end.

---

## Anatomy of a k6 test

A k6 script has an **init** part (imports, data, `options`), an optional `setup()` that runs once, the **VU code** (the default function or a named function per scenario) that runs many times, and an optional `teardown()`. BoxOffice's tests share one module with the user flows, so every test type below is just a different *load shape* over the same behaviour:

```javascript title="k6/lib/boxoffice.js"
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import { pickEvent, pickUser } from './data.js';

export const BASE = __ENV.BASE_URL || 'http://localhost:8080';

// A 409 (seat already taken) is a valid business outcome, not a failed request.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 409));

const holdTime = new Trend('hold_time', true);   // business metric, in ms
const seatsHeld = new Counter('seats_held');

const json = (user) => ({
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
});

export function browse() {
  const ev = pickEvent();
  const res = http.get(`${BASE}/events/${ev.id}`, { tags: { name: 'GET /events/{id}' } });
  check(res, { 'event page 200': (r) => r.status === 200 });
}

export function search() {
  const res = http.get(`${BASE}/search?q=rock&city=sao-paulo`, { tags: { name: 'GET /search' } });
  check(res, { 'search 200': (r) => r.status === 200 });
}

export function hold() {
  const ev = pickEvent();
  const user = pickUser();
  const map = http.get(`${BASE}/events/${ev.id}/seats?available=true&limit=8`,
                       { tags: { name: 'GET /events/{id}/seats' } });
  if (!check(map, { 'seat map 200': (r) => r.status === 200 })) return;
  const free = map.json('seats') || [];
  if (free.length === 0) return;                       // sold out: a valid outcome
  sleep(1 + Math.random() * 3);                        // think time: the fan picks a seat
  const seat = free[Math.floor(Math.random() * free.length)];
  const res = http.post(`${BASE}/holds`, JSON.stringify({ eventId: ev.id, seatIds: [seat.id] }),
                        Object.assign(json(user), { tags: { name: 'POST /holds' } }));
  holdTime.add(res.timings.duration);
  if (res.status === 201) seatsHeld.add(1);
  check(res, { 'hold 201 or 409': (r) => r.status === 201 || r.status === 409 });
}

export function checkout() {
  const user = pickUser();
  const res = http.post(`${BASE}/orders`, JSON.stringify({ holdId: `test-${user.id}` }),
                        Object.assign(json(user), { tags: { name: 'POST /orders' } }));
  check(res, { 'order accepted': (r) => r.status === 201 || r.status === 202 });
}
```

Three details in this module prevent the most common reporting errors:

- **The `name` tag.** Without it, every URL with a different event id becomes a separate metric series — thousands of them — and per-endpoint thresholds become impossible.
- **Expected statuses.** By default k6 counts any 4xx/5xx as `http_req_failed`. A sold-out seat (409) is correct behaviour; a 503 is not. Decide explicitly.
- **Business metrics.** `seats_held` tells you whether the system did useful work; a test with perfect latency and zero seats held is testing an error page.

---

## Open vs closed workload models

This is the single most important design decision in a load test[^2].

- In a **closed model**, a fixed population of N users loops: send a request, **wait for the response**, think for Z seconds, repeat. A new request is only sent when a previous one finished. Throughput is a *consequence*: by the interactive response-time law, $X = N / (R + Z)$.
- In an **open model**, requests arrive at a rate λ **independent of how fast the system answers** — like fans on the internet, who do not coordinate with each other or wait for strangers' requests to finish. If the system slows down, requests keep arriving and the queue grows.

``` diagram-sim
sequenceDiagram
    participant C as Closed: 1 virtual user
    participant S as BoxOffice (slow phase)
    participant O as Open: arrivals every 100 ms
    C->>S: request 1
    O->>S: request A (t = 0)
    O->>S: request B (t = 100 ms)
    O->>S: request C (t = 200 ms)
    S-->>C: response 1 after 2 s
    Note over C: only now sends request 2 — the slow phase generated ONE sample
    O->>S: requests D…T keep arriving on schedule
    S-->>O: A…T answered late — 20 slow samples, a growing queue
```

The consequence is dramatic exactly when it matters. Take 200 virtual users with 1 s of think time:

| System response time R | Closed model: throughput $N/(R+Z)$ | Open model at 182 req/s |
|---|---|---|
| 0.1 s (healthy) | 200 / 1.1 = **182 req/s** | 182 req/s |
| 0.5 s (degrading) | 200 / 1.5 = 133 req/s | 182 req/s — queue starts to grow |
| 2.0 s (struggling) | 200 / 3.0 = **67 req/s** | 182 req/s — queue grows without bound |

The closed test **reduced the load by 63 % at the moment the system struggled** — a load generator that backs off is a gift no real on-sale gives you. Use the model that matches the real population:

| Use a **closed** model when… | Use an **open** model when… |
|---|---|
| The number of clients is fixed and each waits for its answer: a partner's batch job with 20 workers, call-centre agents, a fixed-size consumer pool | Clients are independent and numerous: internet users, mobile apps, webhooks, other services calling you at their own pace |
| You want to know "how many concurrent sessions can we sustain?" | You want to know "can we sustain this arrival rate within the SLO?" |

### k6 executors

| Executor | Model | Parameters | Typical use |
|---|---|---|---|
| `shared-iterations`, `per-vu-iterations` | Closed | iterations, VUs | Data seeding, quick functional checks |
| `constant-vus` | Closed | VUs, duration | Smoke tests; fixed populations |
| `ramping-vus` | Closed | stages of VU targets | Session-concurrency questions |
| **`constant-arrival-rate`** | **Open** | rate per time unit, duration, pre-allocated/max VUs | Load and soak tests at a target rate |
| **`ramping-arrival-rate`** | **Open** | stages of rate targets | Load, stress, spike and breakpoint tests |
| `externally-controlled` | Either | controlled through the k6 REST API | Interactive exploration |

In arrival-rate executors, VUs are just the *workers* that execute iterations. k6 needs enough of them to keep the schedule — Little's Law again: **VUs needed ≈ arrival rate × iteration duration**. A `hold()` iteration takes about 3 s (two requests plus think time); at 500 iterations/s you need ~1 500 VUs. If k6 runs out, it cannot start iterations on time and counts them in the **`dropped_iterations`** metric — which must be zero, or your "open" test silently became a closed one.

!!! example "In the BoxOffice code: an open-model load test (lab 2)"

    The scripts on this page model the full on-sale campaign; [Hands-on 2 — Measure first](../../../hands-on/2/index.md) starts with one service. Its `load.js` sends `RATE` requests per second to `catalog` with `constant-arrival-rate`, whatever the latency, with an 80/20 mix of event pages and city listings. Note the VU sizing: `preAllocatedVUs` covers the rate when requests are fast, and `maxVUs` lets k6 add workers when they slow down — when even those run out, `dropped_iterations` appears, which the lab reads as the sign that the knee was passed. The thresholds are per endpoint (`name:detail`, `name:list`), as in the table below.

    ``` { .javascript title="load/load.js (the open-model options)" }
    --8<-- "docs/2027.1/hands-on/2/code/load/load.js:14:31"
    ```

---

## Thresholds: SLOs as pass/fail criteria

A threshold turns a metric into a verdict; k6 exits with a non-zero code when one fails, which is what lets a pipeline gate on it. Write the SLOs from the [workload model](../methodology/index.md#workload-model) as thresholds, **per endpoint**:

| SLO (from the design doc) | k6 threshold |
|---|---|
| Event page: 99 % of requests under 200 ms | `'http_req_duration{name:GET /events/{id}}': ['p(99)<200']` |
| Holds: 99 % under 300 ms | `'http_req_duration{name:POST /holds}': ['p(99)<300']` |
| Fewer than 0.1 % failed requests | `http_req_failed: ['rate<0.001']` |
| Functional correctness | `checks: ['rate>0.999']` |
| The test itself kept its schedule | `dropped_iterations: ['count==0']` |
| Stop a breakpoint test once the SLO is clearly broken | `{ threshold: 'p(99)<1000', abortOnFail: true, delayAbortEval: '1m' }` |

Thresholds on percentiles are evaluated over the whole test run (or over the tagged subset), which is why the warm-up must be a separate, untagged scenario (see [Methodology — warm-up](../methodology/index.md#warm-up)).

---

## The six test types

Each type answers a different question. Their load shapes, relative to the expected peak:

```python exec="1" html="1"
# The shape of each test type: arrival rate (as a fraction of the expected peak) over time.
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

def ramp(points):                      # piecewise-linear profile from (minute, level) points
    t = np.linspace(points[0][0], points[-1][0], 400)
    return t, np.interp(t, [p[0] for p in points], [p[1] for p in points])

SHAPES = [
    ("Smoke", "minutes", ramp([(0, 0.01), (1, 0.01)])),
    ("Load", "minutes", ramp([(0, 0), (5, 1.0), (25, 1.0), (28, 0)])),
    ("Stress", "minutes", ramp([(0, 0), (5, 1.0), (10, 1.0), (12, 1.5), (17, 1.5), (19, 2.0),
                                (24, 2.0), (26, 0.3), (31, 0.3)])),
    ("Spike", "minutes", ramp([(0, 0.05), (2, 0.05), (2.5, 1.5), (7.5, 1.5), (8, 0.05), (12, 0.05)])),
    ("Soak", "hours", ramp([(0, 0), (0.2, 0.4), (8, 0.4), (8.2, 0)])),
    ("Breakpoint", "minutes", ramp([(0, 0), (40, 4.0)])),
]

fig, axes = plt.subplots(2, 3, figsize=(11, 5), sharey=True)
for ax, (name, unit, (t, y)) in zip(axes.flat, SHAPES):
    ax.fill_between(t, y, color="#4C9BE8", alpha=0.25)
    ax.plot(t, y, color="#4C9BE8", linewidth=2)
    ax.axhline(1.0, color="#F28E2B", linestyle="--", linewidth=1)
    ax.set_title(name, fontweight="bold", color="gray")
    ax.set_xlabel(unit, color="gray")
    ax.tick_params(colors="gray", labelsize=8)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
axes[0][0].set_ylabel("× expected peak", color="gray")
axes[1][0].set_ylabel("× expected peak", color="gray")
axes[1][2].text(1, 3.3, "abort when the\nthresholds fail", color="gray", fontsize=8)
axes[0][0].text(0.05, 1.08, "expected peak", color="#F28E2B", fontsize=8)
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

| Type | Question it answers | Load | Duration | Pass when |
|---|---|---|---|---|
| **Smoke** | Does the script work and does the system respond correctly under minimal load? | 1–2 VUs | 1–2 min | Zero errors, all checks pass |
| **Load** | Does the system meet its SLOs at the expected (peak) load? | Expected peak, realistic mix | 15–60 min at plateau | All thresholds pass |
| **Stress** | How does it behave *above* the expected peak — gracefully or catastrophically? Does it recover? | Steps to 1.5×, 2× peak, then back down | 20–40 min | Degrades by rejecting fast (429/503), recovers on its own |
| **Spike** | Can it absorb a sudden jump (10:00:00) — autoscaling lag, cold caches, waiting room? | Baseline → 1–2× peak in seconds | 5–15 min | Errors bounded during the jump; back to SLO within N minutes |
| **Soak** (endurance) | Does it stay healthy for hours — leaks, growth, slow degradation? | ~Average daily load | 4–24 h | Flat memory, latency and error trends |
| **Breakpoint** | Where is the knee and where is the breaking point? Which resource breaks first? | Continuous ramp far above peak | Until abort | Not pass/fail: the output is the capacity number |

### Smoke test

The smoke test is the "does it even run?" check — run it after every change to the script or the system, and as the first step in CI. A closed model with one or two VUs is fine here.

```javascript title="k6/smoke.js"
import { browse, search, hold } from './lib/boxoffice.js';

export const options = {
  vus: 2,
  duration: '1m',
  thresholds: {
    http_req_failed: ['rate==0'],
    checks: ['rate==1'],
  },
};

export default function () {
  browse();
  search();
  hold();
}
```

### Load test

The load test is the main verdict: the realistic mix, at the expected peak arrival rate, long enough to reach a steady state. Each flow gets its own **open** scenario with its share of the rate, so the mix stays right even when one endpoint slows down.

```javascript title="k6/load.js"
import { browse, search, hold, checkout } from './lib/boxoffice.js';
export { browse, search, hold, checkout };

const PEAK = Number(__ENV.PEAK || 1000);           // iterations/s at peak (scaled for the lab)

function flow(exec, share, iterSeconds) {
  const rate = Math.round(PEAK * share);
  return {
    executor: 'ramping-arrival-rate',
    exec,
    startRate: 0,
    timeUnit: '1s',
    preAllocatedVUs: Math.ceil(rate * iterSeconds),        // Little's Law: VUs = rate × duration
    maxVUs: Math.ceil(rate * iterSeconds * 3),
    stages: [
      { target: rate, duration: '5m' },                    // ramp up
      { target: rate, duration: '20m' },                   // plateau at the expected peak
      { target: 0, duration: '2m' },                       // ramp down
    ],
  };
}

export const options = {
  scenarios: {
    browse:   flow('browse',   0.55, 0.2),
    search:   flow('search',   0.15, 0.3),
    hold:     flow('hold',     0.20, 3.5),
    checkout: flow('checkout', 0.10, 1.0),
  },
  thresholds: {
    'http_req_duration{name:GET /events/{id}}':       ['p(99)<200'],
    'http_req_duration{name:GET /events/{id}/seats}': ['p(99)<300'],
    'http_req_duration{name:GET /search}':            ['p(99)<400'],
    'http_req_duration{name:POST /holds}':            ['p(99)<300'],
    'http_req_duration{name:POST /orders}':           ['p(99)<800'],
    http_req_failed: ['rate<0.001'],
    checks: ['rate>0.999'],
    dropped_iterations: ['count==0'],
  },
};
```

The shares are of *iterations*; since `hold()` makes two requests, calibrate the shares so that the resulting *request* mix matches the workload model (k6's end-of-test summary shows requests per `name`).

### Stress test

The stress test goes beyond the expected peak in steps, holds each step long enough to observe, then drops back to see whether the system **recovers by itself**. The interesting output is not "pass/fail" but *how* it fails:

- **Graceful**: past capacity, the gateway or the service rejects the excess quickly (429/503 in milliseconds), latency of accepted requests stays near the SLO, and everything returns to normal when the load drops. This is what [rate limiting and load shedding](../../reliability/patterns/index.md) buy.
- **Catastrophic**: everything slows down, timeouts trigger retries, retries add load (a [retry storm](../../../../playground/index.md)), the connection pool and threads are exhausted, and the system stays degraded *after* the load drops (memory pressure, a backlog of queued work, circuit breakers flapping).

```javascript title="k6/stress.js"
import { browse, hold } from './lib/boxoffice.js';
export { browse, hold };

const PEAK = Number(__ENV.PEAK || 1000);
const steps = (share) => [
  { target: PEAK * share,       duration: '5m' },   // 1× peak
  { target: PEAK * share,       duration: '5m' },
  { target: PEAK * share * 1.5, duration: '2m' },   // 1.5×
  { target: PEAK * share * 1.5, duration: '5m' },
  { target: PEAK * share * 2,   duration: '2m' },   // 2×
  { target: PEAK * share * 2,   duration: '5m' },
  { target: PEAK * share * 0.3, duration: '2m' },   // back to normal: does it recover?
  { target: PEAK * share * 0.3, duration: '5m' },
];

export const options = {
  scenarios: {
    browse: { executor: 'ramping-arrival-rate', exec: 'browse', startRate: 0, timeUnit: '1s',
              preAllocatedVUs: 400, maxVUs: 4000, stages: steps(0.75) },
    hold:   { executor: 'ramping-arrival-rate', exec: 'hold', startRate: 0, timeUnit: '1s',
              preAllocatedVUs: 1000, maxVUs: 10000, stages: steps(0.25) },
  },
  // No pass/fail on latency: the stress test is read on the dashboards.
  thresholds: { checks: ['rate>0.5'] },
};
```

!!! example "In the BoxOffice code: a stress test that comes back down (lab 2)"

    [Hands-on 2](../../../hands-on/2/index.md) runs the same shape on `catalog`: steps of 25 %, 50 %, 75 % and 100 % of `PEAK`, the peak held for one minute, then a drop to 25 % for another minute. The last two stages are the point of the test: the lab asks how many seconds p95 takes to return to normal after the drop. A service that recovers by itself is stable; one that stays slow needs load shedding (labs 3 and 9). The 2 s threshold on p99 does not judge the peak — it only flags a run that never recovered.

    ``` { .javascript title="load/stress.js (the staircase and back down)" }
    --8<-- "docs/2027.1/hands-on/2/code/load/stress.js:13:38"
    ```

### Spike test

The spike test reproduces 10:00:00: from a quiet baseline to above the peak within seconds. It exercises exactly what the load test cannot — autoscaling lag, cold caches, connection storms against the database, and the waiting room.

```javascript title="k6/spike.js"
import { hold } from './lib/boxoffice.js';
export { hold };

const PEAK = Number(__ENV.PEAK || 1000);

export const options = {
  scenarios: {
    onsale: {
      executor: 'ramping-arrival-rate', exec: 'hold', startRate: PEAK * 0.05, timeUnit: '1s',
      preAllocatedVUs: 2000, maxVUs: 12000,
      stages: [
        { target: PEAK * 0.05, duration: '2m' },   // quiet morning
        { target: PEAK * 1.5,  duration: '30s' },  // 10:00:00
        { target: PEAK * 1.5,  duration: '5m' },
        { target: PEAK * 0.05, duration: '30s' },
        { target: PEAK * 0.05, duration: '4m' },   // recovery window
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],                     // bounded errors during the jump
    'http_req_duration{name:POST /holds}': ['p(99)<1500'],
  },
};
```

Run it twice — with the autoscaler at its normal minimum and with **pre-scaling** — and compare the first two minutes. The difference is the case for pre-scaling (see [Kubernetes — autoscaling](../../cloud-native/kubernetes/index.md)).

Try it: the scenario below is a flash sale like BoxOffice's on-sale, and its `load` profile already contains the spike: a scripted event at t = 60 s (*the sale opens*) multiplies the traffic by 20 for 90 s (do not pick the `spike` profile on top of it — that would multiply it by 5 again). The design as drawn has no waiting room: `users → lb → app → inventory-db`, with buyers calling the `payment provider`. Run it and see where the excess load goes: `app` saturates and rejects it (errors), and p99 explodes. Then open it in the full playground (↗), press **Show a possible solution** (CDN, catalog cache, and a waiting-room queue drained by `order` workers) and run again. Compare p99, the error rate and the utilization of `inventory-db`: the excess now waits in the queue — the consumer lag — instead of failing.

<div class="sdp" data-scenario="flash-sale" data-mode="compact" data-height="560"></div>

### Soak test { #soak-test }

The soak (endurance) test holds a realistic load — typically the daily average — for hours. It finds problems that need *time*: memory leaks, connection or file-descriptor leaks, unbounded caches, log volumes filling disks, slowly growing tables without an index, certificate or token refreshes that fail after N hours, and GC behaviour after the heap has filled once.

```javascript title="k6/soak.js"
import { browse, search, hold } from './lib/boxoffice.js';
export { browse, search, hold };

const RATE = Number(__ENV.RATE || 300);           // ~ average daily load

export const options = {
  scenarios: {
    browse: { executor: 'constant-arrival-rate', exec: 'browse', rate: RATE * 0.7, timeUnit: '1s',
              duration: '8h', preAllocatedVUs: 100, maxVUs: 1000 },
    search: { executor: 'constant-arrival-rate', exec: 'search', rate: RATE * 0.2, timeUnit: '1s',
              duration: '8h', preAllocatedVUs: 50, maxVUs: 500 },
    hold:   { executor: 'constant-arrival-rate', exec: 'hold', rate: RATE * 0.1, timeUnit: '1s',
              duration: '8h', preAllocatedVUs: 150, maxVUs: 1500 },
  },
  thresholds: {
    http_req_failed: ['rate<0.001'],
    'http_req_duration{name:POST /holds}': ['p(99)<300'],
  },
};
```

A soak test is read as **trends**, not totals: the p99 in hour 8 vs hour 1, and the slope of resource usage. A PromQL query such as the one below on the JVM's old-generation heap *after* garbage collections should be flat; a steady positive slope is a leak.

```promql
deriv(jvm_memory_used_bytes{service="inventory", area="heap", id=~".*Old Gen"}[1h])
```

### Breakpoint test

The breakpoint (capacity) test ramps the arrival rate continuously, far beyond the expected peak, and stops itself when the system clearly breaks. Its output is a number: the **knee** (the highest rate at which the SLO still holds) and the **breaking point** — plus the name of the resource that saturated first.

```javascript title="k6/breakpoint.js"
import { hold } from './lib/boxoffice.js';
export { hold };

export const options = {
  scenarios: {
    breakpoint: {
      executor: 'ramping-arrival-rate', exec: 'hold', startRate: 10, timeUnit: '1s',
      preAllocatedVUs: 1000, maxVUs: 20000,
      stages: [ { target: 4000, duration: '40m' } ],          // ~ +100 req/s per minute
    },
  },
  thresholds: {
    'http_req_duration{name:POST /holds}': [
      { threshold: 'p(99)<1000', abortOnFail: true, delayAbortEval: '1m' },
    ],
    http_req_failed: [ { threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '1m' } ],
  },
};
```

Never run a breakpoint test against production, and always watch the **load generator**: at thousands of VUs a single k6 machine may become the bottleneck — check its CPU and `dropped_iterations`, and distribute the test (k6-operator) when needed. The [Finding bottlenecks](../bottlenecks/index.md) page shows how to read the resulting curve.

---

## Coordinated omission

Coordinated omission is the measurement error that made last year's test lie[^3]. It happens whenever the load generator **waits for a response before sending the next request** and measures latency **from the moment it actually sent the request**. When the server stalls, the tester stops sending — so it *omits* exactly the requests that would have experienced the stall, in *coordination* with the server's misbehaviour. The few samples it does record during the stall are drowned among thousands of fast ones.

The simulation below reproduces it. A server answers in 1 ms, but freezes for 1.5 s four times during a 60 s test — a stop-the-world GC pause or a table lock. The tester intends to send 100 requests per second. The closed loop waits for each response; the open model sends on schedule and measures from the *intended* send time:

```python exec="1" html="1"
# Coordinated omission, simulated. A server answers in 1 ms, but freezes for
# 1.5 s four times in a 60 s test (think: a stop-the-world GC pause or a lock).
# The load generator intends to send 100 requests per second.
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

RATE, DURATION, SERVICE = 100, 60.0, 0.001
STALLS = [(10.0, 1.5), (25.0, 1.5), (40.0, 1.5), (55.0, 1.5)]   # (start, length) in s

def serve(arrival, free_at):
    start = max(arrival, free_at)
    for s, d in STALLS:
        if s <= start < s + d:
            start = s + d                 # frozen: nothing runs until the stall ends
    return start + SERVICE

# Closed loop: one virtual user, paced at 10 ms, waits for each response
# before sending the next one -> it stops sending while the server is frozen.
closed_t, closed_lat, t, slot, free = [], [], 0.0, 0.0, 0.0
while slot < DURATION:
    send = max(t, slot)
    done = serve(send, free)
    free = done
    closed_t.append(send)
    closed_lat.append(done - send)        # measured from the ACTUAL send time
    t, slot = done, slot + 1 / RATE
    if slot < t:
        slot = t                          # the missed slots are silently skipped

# Open model: requests arrive on schedule whether or not the server keeps up;
# latency is measured from the INTENDED send time.
open_t = np.arange(0, DURATION, 1 / RATE)
open_lat, free = [], 0.0
for a in open_t:
    done = serve(a, free)
    free = done
    open_lat.append(done - a)

def row(name, lat):
    ms = np.array(lat) * 1000
    cells = [f"{len(ms):,}"] + [f"{v:.1f}" for v in np.percentile(ms, [50, 90, 99, 99.9])] + [f"{ms.max():.0f}"]
    return f"<tr><td>{name}</td>" + "".join(f"<td style='text-align:right'>{c}</td>" for c in cells) + "</tr>"

print("<table><thead><tr><th>Measurement (latency in ms)</th><th>Samples</th><th>p50</th>"
      "<th>p90</th><th>p99</th><th>p99.9</th><th>max</th></tr></thead><tbody>"
      + row("Closed loop (coordinated omission)", closed_lat)
      + row("Open model / corrected", open_lat) + "</tbody></table>")

fig, ax = plt.subplots(figsize=(11, 3.6))
ax.plot(open_t, np.array(open_lat) * 1000, color="#F28E2B", linewidth=1.5, label="open model: what users would see")
ax.scatter(closed_t, np.array(closed_lat) * 1000, s=8, color="#4C9BE8", rasterized=True,
           label="closed loop: what the tool recorded")
ax.set_yscale("symlog", linthresh=1)
ax.set_xlabel("test time (s)", color="gray")
ax.set_ylabel("latency (ms, log)", color="gray")
ax.set_title("Same server, same 60 s: two very different reports", fontweight="bold", color="gray")
ax.tick_params(colors="gray")
for side in ("top", "right"):
    ax.spines[side].set_visible(False)
ax.legend(frameon=False, labelcolor="gray", loc="center left")
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

The server and its four freezes are identical; only the measurement differs. The closed loop recorded ~600 fewer samples (the ones it never sent during the freezes) and reports a perfect p99 of 1 ms. In reality, about one request in ten during that minute would have waited between a few milliseconds and 1.5 s — the corrected p90 is ~150 ms and the p99 is over a second. **An SLO checked with the first row passes; an SLO checked with the second fails. Users experience the second.**

How to avoid it:

- **Use open-model generators** for open-world traffic: k6 `constant-arrival-rate`/`ramping-arrival-rate`, Gatling `injectOpen`, wrk2, vegeta. They start requests on schedule regardless of earlier responses (as long as they have free VUs/connections — watch `dropped_iterations`).
- **Measure from the intended start time** when you control the client (HdrHistogram's `recordValueWithExpectedInterval`, wrk2's correction).
- **Count timeouts at their full duration** and as errors; a test that discards timed-out requests omits the worst samples too.
- **Beware server-side metrics** as the only source: a server's own latency histogram starts the clock when the request is *accepted*, missing the time spent in the TCP accept queue or the load balancer. Compare client-side and server-side percentiles; a large gap means queuing in front of the service.

---

## Think time and pacing

Real users pause between actions. **Think time** (`sleep()` between requests inside an iteration) makes a session realistic; **pacing** controls how often a whole iteration starts.

- In a **closed** model, think time *reduces* throughput for a given number of VUs ($X = N/(R+Z)$). Removing it to "generate more load" changes the population you are simulating.
- In an **open** model, the arrival rate fixes the throughput; think time only increases the number of VUs busy at once (VUs ≈ rate × iteration duration) — and therefore the number of concurrent sessions, open connections and held seats, which is realistic and often exactly where systems break.
- Randomize think times (`1 + Math.random() * 3`): constant pauses synchronize VUs into artificial waves.

---

## Running, observing and correlating

A load test produces two sets of data that must be read **together**: the client-side results (k6) and the server-side telemetry (metrics, traces, logs, profiles). Run them on the same time axis:

```bash
# stream k6 metrics to Prometheus (remote write) and tag the run
K6_PROMETHEUS_RW_SERVER_URL=http://localhost:9090/api/v1/write \
K6_PROMETHEUS_RW_TREND_STATS="p(50),p(95),p(99),max" \
k6 run --out experimental-prometheus-rw --tag testid=onsale-2027-03-14-run2 \
       -e BASE_URL=https://perf.boxoffice.example -e PEAK=1200 k6/load.js

# or watch the built-in web dashboard and export an HTML report
K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=report.html k6 run k6/load.js
```

With k6 and the services' OpenTelemetry metrics in the same Grafana (the `grafana/otel-lgtm` stack of [Hands-on 8](../../../hands-on/8/index.md)), one dashboard shows the k6 arrival rate and p99 next to each service's RED metrics and each resource's USE metrics. Slow requests are found through **trace exemplars**, and their spans show where the time went. For tests beyond one machine, the **k6-operator** runs a test as several parallel pods in a Kubernetes cluster.

---

## Load and chaos together

Failures rarely arrive on a quiet afternoon; they arrive at the peak, when retries, timeouts and pools are all under pressure. Testing resilience patterns *without* load proves little: a circuit breaker that never sees 2 000 concurrent requests has not been tested. Combine a load test with fault injection[^4], each with a hypothesis written in advance ([Chaos engineering](../../reliability/chaos/index.md)):

| Fault injected during the load test | Hypothesis | Tool |
|---|---|---|
| Payment provider +3 s latency | Circuit breaker opens within 10 s; holds and browsing keep their SLO; orders fail fast with a clear message | Toxiproxy, xk6-disruptor |
| Kill 1 of 3 `inventory` pods | Error spike < 1 % for < 30 s; p99 recovers without manual action | `kubectl delete pod`, Chaos Mesh |
| Redis unavailable for 60 s | Catalog falls back to PostgreSQL; p99 rises but stays < 1 s; no stampede on recovery | Toxiproxy, Chaos Mesh |
| PostgreSQL failover | Writes fail for < 30 s; the connection pool recovers; no stuck threads | Managed DB failover API |

```bash title="chaos-under-load.sh — Toxiproxy between order and payment"
k6 run -e PEAK=800 k6/load.js &                       # steady load in the background
sleep 300                                             # 5 minutes of baseline
toxiproxy-cli toxic add --type latency --attribute latency=3000 --attribute jitter=500 \
              --toxicName slow-payment payment        # inject: provider answers in ~3 s
sleep 300                                             # 5 minutes degraded
toxiproxy-cli toxic remove --toxicName slow-payment payment   # recover
wait                                                  # compare the three phases in Grafana
```

With **xk6-disruptor** (a k6 extension), the fault is part of the test script and targets a Kubernetes Service directly:

```javascript title="k6/chaos-payment.js (requires a k6 binary built with xk6-disruptor)"
import { ServiceDisruptor } from 'k6/x/disruptor';
import { checkout } from './lib/boxoffice.js';
export { checkout };

export const options = {
  scenarios: {
    load:  { executor: 'constant-arrival-rate', exec: 'checkout', rate: 200, timeUnit: '1s',
             duration: '15m', preAllocatedVUs: 400, maxVUs: 2000 },
    fault: { executor: 'shared-iterations', exec: 'disrupt', iterations: 1, vus: 1, startTime: '5m' },
  },
  thresholds: { 'http_req_duration{name:POST /orders}': ['p(99)<1500'] },
};

export function disrupt() {
  const payment = new ServiceDisruptor('payment', 'boxoffice');
  payment.injectHTTPFaults({ averageDelay: '3s', errorRate: 0.1, errorCode: 503 }, '5m');
}
```

!!! example "In the BoxOffice code: load and a slow provider together (lab 9)"

    [Hands-on 9 — Resilience patterns](../../../hands-on/9/patterns/index.md) runs the first row of the table: Toxiproxy adds 3 s to every call from `order` to `payment` while `pay-under-chaos.js` keeps two open-model scenarios running — 20 payments/s and 20 `GET /orders/{id}`/s. The second scenario never calls `payment`; its threshold (`browse` p95 < 200 ms) is the hypothesis that the failure stays contained. In the lab's test run, unprotected, `browse` p50 was **9.04 s**; with timeout, retry, circuit breaker and bulkhead it was **6.5 ms** ([Measure it](../../../hands-on/9/measure/index.md)).

    ``` { .javascript title="load/pay-under-chaos.js (two scenarios, two verdicts)" }
    --8<-- "docs/2027.1/hands-on/9/code/load/pay-under-chaos.js:13:40"
    ```

Try it: the scenario below has a slow third-party dependency and callers **without timeouts**, running with the **chaos** profile. Run it and watch threads (or concurrency) pile up in the callers until unrelated requests fail too — a cascading failure. Then enable the timeout and the circuit breaker on the call to the dependency and run again: the failure should stay contained to the feature that needs the dependency.

<div class="sdp" data-scenario="cascading-failure" data-mode="compact" data-profile="chaos" data-chaos="medium" data-height="520"></div>

---

## From the playground to real tools

The playground's load profiles are the same six test types (plus chaos), applied to a queueing simulation. Use the playground to build intuition and to form hypotheses quickly; confirm them with real tools on real services.

| Playground profile | What the playground does | k6 | Gatling | Locust |
|---|---|---|---|---|
| `smoke` | A trickle of requests to check that the design works end to end | `constant-vus`, 1–2 VUs | `atOnceUsers(1)` | `-u 1 -r 1` |
| `load` | Ramp to the target rate and hold | `ramping-arrival-rate` → plateau | `rampUsersPerSec(...).to(...)`, `constantUsersPerSec(...)` | `LoadTestShape` ramp + hold |
| `stress` | Steps above the target, then back down | `ramping-arrival-rate` with steps | `incrementUsersPerSec(...).times(n)` | `LoadTestShape` steps |
| `spike` | A sudden jump to a multiple of the baseline | `ramping-arrival-rate`, stage of seconds | `nothingFor`, `atOnceUsers`, `constantUsersPerSec` | `LoadTestShape` jump |
| `soak` | A long, moderate, constant rate | `constant-arrival-rate`, hours | `constantUsersPerSec(...).during(hours)` | `-t 8h` with pacing |
| `breakpoint` | An ever-increasing rate until the SLO breaks | `ramping-arrival-rate` + `abortOnFail` | `rampUsersPerSec` + `assertions` | `LoadTestShape` + stop condition |
| `chaos` | Load plus injected faults (latency, errors, instance loss) at the chosen chaos level | load script + xk6-disruptor / Toxiproxy | load + Toxiproxy | load + Toxiproxy |

What the playground **simplifies**: it models capacity, service times, queues, timeouts, retries and failures, but not JIT warm-up, garbage collection, lock contention inside a database, network variance or the cost of your actual code. A design that fails in the playground will fail in reality; a design that passes in the playground still has to be measured.

---

## Other tools

All the tools below can express the six test types; they differ in scripting language, support for the open model, distribution and reporting[^5].

=== "Gatling"

    Java/Kotlin/Scala DSL, open and closed injection profiles, detailed HTML reports. Strong for JVM teams.

    ```java
    public class HoldSimulation extends Simulation {
      HttpProtocolBuilder httpProtocol = http.baseUrl("http://localhost:8080");

      ScenarioBuilder holds = scenario("hold")
          .exec(http("GET /events/{id}/seats").get("/events/42/seats?available=true").check(status().is(200)))
          .pause(1, 4)
          .exec(http("POST /holds").post("/holds")
              .body(StringBody("{\"eventId\":42,\"seatIds\":[\"A-12\"]}")).asJson());

      {
        setUp(holds.injectOpen(
                rampUsersPerSec(0).to(500).during(300),
                constantUsersPerSec(500).during(1200)))
            .protocols(httpProtocol)
            .assertions(
                global().responseTime().percentile(99.0).lt(300),
                global().failedRequests().percent().lt(0.1));
      }
    }
    ```

=== "Locust"

    Python, user classes with tasks and wait times; a web UI and distributed workers. Each user is a closed loop; use `constant_throughput` pacing and many users to approximate an open model.

    ```python
    from locust import HttpUser, task, between

    class Fan(HttpUser):
        wait_time = between(1, 4)          # think time

        @task(7)
        def event_page(self):
            self.client.get("/events/42", name="GET /events/{id}")

        @task(3)
        def hold(self):
            self.client.post("/holds", json={"eventId": 42, "seatIds": ["A-12"]}, name="POST /holds")
    ```

=== "JMeter"

    The veteran: GUI to build plans, CLI to run them, many protocols. Thread groups are closed-model; use the *Constant Throughput Timer* or the *Arrivals Thread Group* plugin for arrival rates.

    ```bash
    jmeter -n -t onsale.jmx -l results.jtl -e -o report/    # headless run + HTML report
    ```

=== "wrk2 / vegeta"

    Command-line, constant-rate HTTP generators: ideal for one endpoint, quick checks and CO-free latency distributions.

    ```bash
    # wrk2: constant 5 000 req/s, latency corrected for coordinated omission
    wrk2 -t4 -c200 -d60s -R5000 --latency http://localhost:8080/events/42

    # vegeta: constant 2 000 req/s, latency histogram
    echo "GET http://localhost:8080/events/42" | vegeta attack -rate=2000/s -duration=60s \
      | vegeta report -type='hist[0,50ms,100ms,200ms,500ms,1s]'
    ```

| Tool | Language | Open model | Distributed | Best for |
|---|---|---|---|---|
| **k6** | JavaScript (Go engine) | Yes (arrival-rate executors) | k6-operator, cloud | Scripted scenarios, CI gates, thresholds |
| **Gatling** | Java/Kotlin/Scala | Yes (`injectOpen`) | Enterprise edition | JVM teams, rich reports |
| **Locust** | Python | Approximate | Yes (workers) | Python teams, custom protocols |
| **JMeter** | XML plans (GUI) | With plugins | Yes | Many protocols, legacy suites |
| **wrk2**, **vegeta** | CLI | Yes (constant rate) | No | Single endpoints, quick CO-free numbers |

!!! tip "In the interview"

    Two sentences signal real experience: "I would use an **open-model** test — arrival rate, not virtual users — because fans do not wait for each other; a closed model backs off when the system slows down and hides the queue (**coordinated omission**)." and "Thresholds are the **SLOs per endpoint**, and I would run load, spike and breakpoint tests: the load test for the verdict, the spike for autoscaling lag and the waiting room, the breakpoint for the knee and the headroom."

!!! success "Best practices"

    - **Share one module of user flows and vary only the load shape** — smoke, load, stress, spike and breakpoint then differ only in *how much* and *when*, so their results can be compared.
    - **Size the VUs with Little's Law before the run** — `preAllocatedVUs` ≈ rate × iteration time, `maxVUs` a few times that, so that a slowdown is absorbed instead of turning into a closed test. In BoxOffice: `load/load.js` of [lab 2](../../../hands-on/2/index.md).
    - **Give every test above the peak a recovery phase, and measure the time to recover** — the drop back to normal load is where you learn whether the system is stable. In BoxOffice: the last two stages of `load/stress.js` ([lab 2](../../../hands-on/2/index.md)).
    - **Write the hypothesis of a chaos run as a threshold on the traffic that should *not* suffer** — the failure is contained when the unaffected route keeps its SLO. In BoxOffice: `browse` p95 < 200 ms in `load/pay-under-chaos.js` ([lab 9](../../../hands-on/9/patterns/index.md)).
    - **Tag every run and stream k6 to the services' metrics backend** — `--tag testid=…` lets you find, compare and annotate a run on the same dashboards as the services months later.

!!! warning "Pitfalls"

    - **Closed model for internet traffic**: throughput falls exactly when latency rises; the test is kinder than reality.
    - **Ignoring `dropped_iterations`**: an arrival-rate test without enough VUs silently becomes closed.
    - **One threshold for all endpoints**: a fast event page hides a slow `POST /holds`.
    - **Counting 409 (sold out) as errors** — or counting 503 as success.
    - **Unnamed URLs**: thousands of metric series and no per-endpoint verdict.
    - **Load generator in the same cluster** (or on the same node) as the system under test: they compete for CPU and network.
    - **Chaos without load** (or load without chaos): resilience patterns are only proven at the peak.

---

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    SLO["SLOs per endpoint"] --> THR["k6 thresholds:<br/>pass or fail"]
    WM{"workload model"} -->|"open: arrival rate"| OPEN["fans do not wait<br/>for each other"]
    WM -->|"closed: virtual users"| CLOSED["coordinated omission<br/>hides the queue"]
    OPEN --> TYPES["smoke, load, stress,<br/>spike, soak, breakpoint"]
    THR --> TYPES
    TYPES --> KNEE["breakpoint finds the knee<br/>→ Capacity planning"]
    TYPES --> LAG["spike shows autoscaling lag<br/>→ Cloud-native Kubernetes"]
    TYPES --> CHAOS["load + Toxiproxy faults<br/>→ Reliability chaos"]
    TYPES --> CORR["correlate with metrics<br/>and traces → Hands-on 8"]
```

**Palette components:** [`client`](../../../reference/components/client/index.md#client) and [`mobile`](../../../reference/components/client/index.md#mobile) (what the load generator imitates) · [`apigw`](../../../reference/components/edge/index.md#apigw) and [`lb`](../../../reference/components/edge/index.md#lb) (where graceful rejection — `429`/`503` — should happen past capacity) · [`app`](../../../reference/components/compute/index.md#app) (the replicas under test) · [`queue`](../../../reference/components/messaging/index.md#queue) (the waiting room in the spike test) · [`thirdparty`](../../../reference/components/external/index.md#thirdparty) (the dependency Toxiproxy slows down) · [`metrics`](../../../reference/components/observability/index.md#metrics) and [`tracing`](../../../reference/components/observability/index.md#tracing) (correlating k6 results with the server side). **Scenarios:** `flash-sale` (spike), `cascading-failure` (load and chaos together); the profiles `smoke`, `load`, `stress`, `spike`, `soak` and `breakpoint` mirror the six test types. **Continues in:** [Capacity planning](../capacity-planning/index.md), [Cloud-native — Kubernetes](../../cloud-native/kubernetes/index.md), [Reliability — chaos](../../reliability/chaos/index.md), [Reliability — patterns](../../reliability/patterns/index.md), [Estimation — percentiles](../../estimation/percentiles/index.md), [Hands-on 2](../../../hands-on/2/index.md).

---

[^1]: Grafana Labs. [k6 documentation](https://grafana.com/docs/k6/latest/){target="_blank"} — scenarios and executors, thresholds, test types.
[^2]: SCHROEDER, B.; WIERMAN, A.; HARCHOL-BALTER, M. [Open Versus Closed: A Cautionary Tale](https://www.usenix.org/conference/nsdi-06/open-versus-closed-cautionary-tale){target="_blank"}. *USENIX NSDI*, 2006.
[^3]: TENE, G. [How NOT to Measure Latency](https://www.infoq.com/presentations/latency-response-time/){target="_blank"}. QCon / InfoQ, 2015; [wrk2](https://github.com/giltene/wrk2){target="_blank"}.
[^4]: Toxiproxy. [A TCP proxy to simulate network and system conditions](https://github.com/Shopify/toxiproxy){target="_blank"}; Grafana Labs. [xk6-disruptor](https://grafana.com/docs/k6/latest/testing-guides/injecting-faults-with-xk6-disruptor/){target="_blank"}.
[^5]: Gatling. [Documentation](https://docs.gatling.io/){target="_blank"}; Locust. [Documentation](https://docs.locust.io/){target="_blank"}.
