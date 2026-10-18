# 3. Performance Gate

Tests catch wrong answers; they do not catch a change that makes the right answer ten times slower.
A **performance budget** turns the latency you promised (lab 8's SLO, the
[capacity plan](../../../classes/performance/capacity-planning/index.md#performance-budgets)) into a
build check: CI starts the service, runs a short k6 test with thresholds, and **fails the pull
request** when a threshold is crossed.

## A fixed environment

Comparisons only make sense if every run uses the same environment. CI starts a small, dedicated
stack — PostgreSQL, Redis and `catalog` with the same CPU limit as in `docker-compose.yaml` — from its
own Compose file:

``` yaml title=".github/ci/compose.perf.yaml"
--8<-- "docs/2027.1/hands-on/11/code/.github/ci/compose.perf.yaml"
```

`docker compose … up --wait` returns only when every healthcheck passes, so k6 never measures a JVM
that is still starting.

## The budget

``` javascript title="load/budget.js"
--8<-- "docs/2027.1/hands-on/11/code/load/budget.js"
```

| Choice | Why |
|---|---|
| a 20 s `warmup` scenario, not measured | JIT compilation, connection pools and the cache warm up; thresholds only apply to `scenario:budget` |
| open model (`constant-arrival-rate`) | the arrival rate does not slow down when the service does, as with real users |
| p95 < 300 ms **and** p99 < 800 ms | the typical request and the tail; generous for one runner, so that only real regressions fail |
| failed < 1%, checks > 99% | a fast `500` is not a success |

The `performance budget` job of `ci.yaml` (step 1) installs k6 with `grafana/setup-k6-action`, runs the
script with `grafana/run-k6-action`, and prints the service logs if it fails. A crossed threshold makes
k6 exit with code 99 and the job fails.

## Run it locally

``` shell
docker compose -f .github/ci/compose.perf.yaml up -d --build --wait --wait-timeout 300
k6 run load/budget.js
docker compose -f .github/ci/compose.perf.yaml down -v
```

You should see all thresholds with `✓`. A test run on a laptop:

``` text
  █ THRESHOLDS

    checks{scenario:budget}
    ✓ 'rate>0.99' rate=100.00%

    http_req_duration{scenario:budget}
    ✓ 'p(95)<300' p(95)=6.7ms
    ✓ 'p(99)<800' p(99)=9.13ms

    http_req_failed{scenario:budget}
    ✓ 'rate<0.01' rate=0.00%
```

## Break it on purpose

Prove the gate works. On a new branch, add an artificial delay to the event endpoint of
`services/catalog/src/main/java/boxoffice/catalog/EventController.java` — the first line of the
`get` method:

``` java
try { Thread.sleep(400); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
```

Run the local commands again: `p(95)<300` now shows `✗` and k6 ends with
`level=error msg="thresholds on metrics 'http_req_duration{scenario:budget}' have been crossed"`. Push
the branch and open a pull request: the `performance budget` check is red and the merge button warns
you. Close the pull request without merging (and delete the branch) — it was only an experiment.

!!! warning "A noisy gate is worse than no gate"

    Shared CI runners vary from run to run. Set thresholds with a safety margin over your normal
    numbers (here, p95 is ~7 ms against a 300 ms budget), keep the test short but long enough to have
    thousands of samples, and look at the trend of the numbers over many runs before tightening them.
    A gate that fails randomly trains people to re-run until green.

[Next: GitOps with Argo CD](../gitops/index.md){ .md-button .md-button--primary }
