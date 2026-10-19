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
k6 run -e PEAK=250 load/catalog-hpa.js

# after: the HPA
kubectl apply -k k8s/overlays/local
mkdir -p results && sh scripts/watch-hpa.sh > results/lab10-hpa.csv &
k6 run -e PEAK=250 load/catalog-hpa.js
kill %1                                  # stop the watcher
```

From `results/lab10-hpa.csv` read: the time the CPU first crossed 60%, the time `desired` first
increased (reaction time), the time `ready` reached the maximum (time to capacity), and the maximum
number of replicas. Plot `cpu`, `desired` and `ready` over time — a spreadsheet is enough — and add
the chart to your results.

!!! example "Expected shape (illustrative)"

    One run with `PEAK=250` on a laptop (kind, 3 nodes sharing 8 CPUs), sampled from the CSV:

    | t (min:s) | CPU (% of request) | desired | current | ready |
    |---|---|---|---|---|
    | 0:00 | 8 | 2 | 2 | 2 |
    | 0:35 | 105 | 4 | 2 | 2 |
    | 0:54 | 153 | 6 | 4 | 2 |
    | 1:30 | 137 | 6 | 6 | 4 |
    | 3:40 | 197 | 8 | 6 | 4 |
    | 5:21 | 115 | 8 | 8 | 8 |
    | 8:43 | 6 | 7 | 8 | 7 |
    | 11:01 | 5 | 4 | 4 | 4 |

    The HPA asked for more pods 35 s into the ramp, but the eighth pod was ready only after more than
    five minutes: on a laptop, new JVMs compete for the same CPUs as the pods already overloaded, so
    starting capacity is slow exactly when it is needed. k6 reported p95 ≈ 7.8 s and dropped
    iterations during that window, then latency recovered at 8 replicas. After the ramp-down, pods
    left one at a time after the 2-minute stabilization window. On a real cluster nodes are not
    shared with the load generator, but the shape — a lag between demand and ready capacity — is the
    same; that lag is what pre-scaling removes.

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

Without readiness, a new pod receives traffic as soon as its container starts — seconds before Spring
Boot listens — and old pods are killed while still in the endpoint lists. Count the failed requests
(`http_req_failed`) in both runs.

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
