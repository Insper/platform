# 5. Measure It

Kubernetes promises elasticity and self-healing. Put numbers on both. As always, run each experiment
twice and report the second run; numbers in "expected shape" boxes are **illustrative** (they come
from one run on a laptop, and yours will differ).

| # | Experiment | Knob | What you record |
|---|---|---|---|
| A | fixed replicas vs HPA | HPA deleted vs applied | p95, p99, errors, max replicas, time to scale |
| B | rolling update under load | with vs without readiness probe + `preStop` | failed requests during the rollout |
| C | self-healing | delete a pod / stop a node | time until capacity is back (MTTR) |

## A. Fixed replicas vs HPA

``` shell
# before: two fixed replicas
kubectl -n boxoffice delete hpa catalog
kubectl -n boxoffice scale deployment catalog --replicas=2
k6 run -e PEAK=1000 load/catalog-hpa.js

# after: the HPA
kubectl apply -k k8s/overlays/local
mkdir -p results && sh scripts/watch-hpa.sh > results/lab10-hpa.csv &
k6 run -e PEAK=1000 load/catalog-hpa.js
kubectl -n boxoffice get hpa catalog -w  # until REPLICAS is 2 again (minutes after k6 ends), then Ctrl+C
kill %1                                  # stop the watcher
```

From `results/lab10-hpa.csv` read: the time the CPU first crossed 60%, the time `desired` first
increased (reaction time), the time `ready` reached the maximum (time to capacity), and the maximum
number of replicas, and the time `desired` was back at 2 (scale-down). Plot `cpu`, `desired` and `ready` over time — a spreadsheet is enough — and add
the chart to your results.

!!! example "Expected shape (illustrative)"

    One run with `PEAK=1000` on a laptop (kind, 3 nodes sharing 8 CPUs), starting from warm pods,
    sampled from the CSV:

    | t (min:s) | CPU (% of request) | desired | current | ready |
    |---|---|---|---|---|
    | 0:00 | 3 | 2 | 2 | 2 |
    | 1:48 | 63 | 2 | 2 | 2 |
    | 2:03 | 79 | 3 | 2 | 2 |
    | 2:34 | 123 | 5 | 3 | 3 |
    | 3:33 | 247 | 8 | 6 | 4 |
    | 4:05 | 109 | 8 | 8 | 3 |
    | 5:37 | 131 | 8 | 8 | 5 |
    | 7:31 | 220 | 8 | 8 | 8 |
    | 10:26 | 13 | 7 | 8 | 7 |
    | 13:00 | 4 | 2 | 3 | 2 |

    The two warm pods crossed 60% 1:48 into the ramp (about 600 req/s); the HPA asked for a third pod
    15 s later and for eight at 3:33, but the eighth pod was ready only at 7:31, when the hold was
    already over. On a laptop the new JVMs start on the same CPUs that serve the load and run k6: each
    took more than a minute to start and, still cold, failed its readiness probe on and off for a
    while (`ready` goes down as well as up). k6 reported p95 of 5–7 s, p99 ≈ 19 s, 0.3% errors and
    dropped over 40% of the arrivals. The same ramp with two fixed replicas gave p95 ≈ 34 ms, p99 ≈
    180 ms and no errors: the two warm pods used about 300m each, far below their 1-CPU limit, so on
    this laptop the scale-out cost more CPU than it added. After the load dropped (8:00), pods left one
    at a time after the 2-minute stabilization window, back at 2 replicas at 13:00. On a real cluster
    nodes are not shared with the load generator and new nodes bring their own CPUs, but the shape — a
    lag between demand and ready capacity — is the same; that lag is what pre-scaling removes.

## B. Rolling update under load

Keep a steady load running (the k6 script of [lab 8](../../8/measure/index.md) works as is) and
restart the Deployment in the middle:

``` shell
k6 run -e RATE=100 -e DURATION=2m load/catalog-otel.js &
sleep 30 && kubectl -n boxoffice rollout restart deployment/catalog
wait                                     # until k6 ends; note http_req_failed
```

Now remove the readiness probe and the `preStop` pause, wait for that change to roll out, and repeat:

``` shell
kubectl -n boxoffice patch deployment catalog --type=json -p '[
  {"op": "remove", "path": "/spec/template/spec/containers/0/readinessProbe"},
  {"op": "remove", "path": "/spec/template/spec/containers/0/lifecycle"}]'
kubectl -n boxoffice rollout status deployment/catalog
k6 run -e RATE=100 -e DURATION=2m load/catalog-otel.js &
sleep 30 && kubectl -n boxoffice rollout restart deployment/catalog
wait                                     # until k6 ends; note http_req_failed
kubectl apply -k k8s/overlays/local      # restore the probes and the preStop pause
```

The startup probe still keeps a new pod out of the Service until the JVM answers; what changes is the
other end: without the `preStop` pause, old pods stop accepting connections while they are still in
Traefik's endpoint lists. Count the failed requests (`http_req_failed`) in both runs. In a test run:
0 failed requests with the probes, about 140 of 11,900 (1.2%, Traefik `502` and `504`) without.

## C. Self-healing

``` shell
kubectl -n boxoffice delete pod -l app=catalog --wait=false; date +%T
kubectl -n boxoffice get pods -l app=catalog -w        # note the time both are 1/1 again
```

Repeat with `docker stop boxoffice-worker2` (a node failure) and compare: what dominates each
recovery time — detection, scheduling or JVM startup?

## Results

Copy into `results/lab10.md` and fill in.

| Metric | Before | After |
|---|---|---|
| A · Throughput at peak (req/s) — fixed 2 vs HPA | | |
| A · p50 (ms) | | |
| A · p95 (ms) | | |
| A · p99 (ms) | | |
| A · Error rate (%) | | |
| A · Max replicas / time to first scale-up (s) / time to full capacity (s) | — | |
| A · Time from load end to back at 2 replicas (s) | — | |
| B · Failed requests during a rollout — no probes vs probes + `preStop` | | |
| C · Pod deleted → ready again (s) | — | |
| C · Node stopped → pods ready elsewhere (s) | — | |

Below the table: for the BoxOffice flash sale at 10:00, would you rely on the HPA, pre-scale, or
both? Use your reaction-time numbers to justify it.

[Back to the overview](../index.md){ .md-button } [Quiz](../quiz.md){ .md-button .md-button--primary }
