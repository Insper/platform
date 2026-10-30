# 5. Canary with Argo Rollouts

A rolling update replaces every pod with the new version as soon as it is *ready* — but "ready" only
means the process started. A version that answers 20% of the requests with `500` is ready too. A
**canary** sends a small share of the traffic to the new version first, **measures** it against the
SLO, and continues only while the numbers are good; otherwise it aborts and the old version keeps
serving. With **Argo Rollouts** the decision is automatic.

## The pieces

| Object | File | Role |
|---|---|---|
| `Rollout` `catalog` | `catalog-rollout.yaml` | replaces the Deployment's controller; `workloadRef` reuses the pod template of `base/catalog.yaml` |
| `Service` `catalog-stable` / `catalog-canary` | `catalog-services.yaml` | Argo Rollouts points each at its version's pods (it adds the pod-template hash to the selectors) |
| `AnalysisTemplate` `catalog-slo` | `catalog-analysis.yaml` | every 30 s, two PromQL queries on the **canary**: error ratio < 1%, p99 < 500 ms |
| Prometheus | `k8s/monitoring/prometheus.yaml` | scrapes the annotated Services and labels every series with `service="<Service name>"` |
| HPA | patched by the overlay | now scales the `Rollout` |

The Prometheus of this lab is deliberately minimal (one Deployment, one scrape job):

``` yaml title="k8s/monitoring/prometheus.yaml"
--8<-- "docs/2027.1/hands-on/11/code/k8s/monitoring/prometheus.yaml"
```

The metric is Spring Boot's own (Micrometer) `http_server_requests_seconds`, exposed at
`/actuator/prometheus` by the dependency added in [step 1](../ci/index.md) and the overlay's
`MANAGEMENT_ENDPOINTS_WEB_EXPOSURE_INCLUDE` patch. Micrometer publishes only `_count` and `_sum` by
default; the overlay's `MANAGEMENT_METRICS_DISTRIBUTION_PERCENTILESHISTOGRAM_HTTP_SERVER_REQUESTS`
patch adds the `_bucket` series, without which the p99 query returns nothing and that metric would
always pass. With the `service` label, the same query compares
`service="catalog-canary"` with `service="catalog-stable"`.

The steps of the Rollout (see `catalog-rollout.yaml` in [step 4](../gitops/index.md)): 25% → wait
2 min → 50% → wait 2 min → 100%, with the analysis running in the background from the first step.
Without a traffic router, Argo Rollouts reaches a weight by **replica counts** (with 2 replicas,
"25%" is 1 canary pod next to the stable ones), so the real share is approximate; the
[delivery class](../../../classes/cloud-native/delivery/index.md#canary-with-automated-metrics-analysis)
shows exact weights with the Gateway API plugin.

## Watch a rollout

Install the `kubectl` plugin of Argo Rollouts:

=== "macOS"

    ``` shell
    brew install argoproj/tap/kubectl-argo-rollouts
    ```

=== "Linux / WSL"

    ``` shell
    curl -fsSLo kubectl-argo-rollouts https://github.com/argoproj/argo-rollouts/releases/download/v1.10.1/kubectl-argo-rollouts-linux-amd64
    chmod +x kubectl-argo-rollouts && sudo mv kubectl-argo-rollouts /usr/local/bin/
    ```

Keep load on the service while a new version rolls out — the analysis needs requests to measure —
using the k6 script of lab 10 at a modest rate:

``` shell
k6 run -e PEAK=40 load/catalog-hpa.js &          # about 11 minutes of traffic through the Ingress
kubectl argo rollouts -n boxoffice get rollout catalog --watch
```

Any commit to `services/catalog` on `main` produces a new image and a new rollout; a quick one is a
comment in `ChaosFilter.java`. You should see the steps advance (`SetWeight: 25` → `50` → `100`), an
`AnalysisRun` with ✔ measurements, and at the end the new ReplicaSet marked `stable`.

## A bad release

Now ship a release that breaks 30% of the requests, *through Git*. In
`k8s/overlays/gitops/kustomization.yaml`, add one more operation to the Deployment patch (after the
`MANAGEMENT_METRICS_DISTRIBUTION_PERCENTILESHISTOGRAM_HTTP_SERVER_REQUESTS` one), with its `- op:`
exactly under the other `- op:` lines of that patch. The `Deploy` commits have reformatted the file
(4 spaces, as below); a different indentation breaks the patch, and Argo CD reports a
`ComparisonError` instead of starting a canary:

``` yaml
    - op: add                      # lab 11 experiment: a bad release (remove it afterwards)
      path: /spec/template/spec/containers/0/env/-
      value: { name: CHAOS_ERROR_RATE, value: "0.3" }
```

`CHAOS_ERROR_RATE` is read by `ChaosFilter`, which exists only for this experiment:

``` java title="services/catalog/src/main/java/boxoffice/catalog/ChaosFilter.java"
--8<-- "docs/2027.1/hands-on/11/code/services/catalog/src/main/java/boxoffice/catalog/ChaosFilter.java"
```

Commit, push, and watch (keep the k6 load running):

``` shell
git commit -am "experiment: bad release" && git pull --rebase && git push
kubectl argo rollouts -n boxoffice get rollout catalog --watch
```

You should see, about a minute after Argo CD syncs, the rollout **aborted** and the canary scaled
down. From a test run:

``` text
Name:            catalog
Namespace:       boxoffice
Status:          ✖ Degraded
Message:         RolloutAborted: Rollout aborted update to revision 2: Background analysis phase error/failed: Metric "error-rate" assessed Failed due to failed (2) > failureLimit (1)
Strategy:        Canary
  Step:          0/4
  SetWeight:     0
  ActualWeight:  0
Images:          boxoffice/catalog:v1 (stable)
```

(That test run used a locally loaded `boxoffice/catalog:v1`; yours shows
`ghcr.io/<you>/boxoffice-catalog:sha-…` as the stable image.)

and the measurements of the `error-rate` metric were `[]` (no canary traffic yet: counted as a
success by `len(result) == 0`), `0.068` and `0.285` — two failures above `failureLimit: 1`. The fans
who hit the canary saw errors for about a minute; everyone else never noticed.

`Degraded` is the signal to fix forward in Git: revert the experiment (`git revert HEAD && git push`),
Argo CD syncs, and the next rollout starts from a clean state.

!!! warning "What a canary cannot catch"

    - **Database migrations** run once, for both versions: they must be backward compatible
      (expand/contract), because the old version keeps running during — and after an aborted — canary.
    - **Rare errors** need many canary requests to be visible; at low traffic, lengthen the pauses.
    - **Side effects** (payments, e-mails) of canary requests are real.

[Next: Measure it](../measure/index.md){ .md-button .md-button--primary }
