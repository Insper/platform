# 3. Autoscaling

Lab 3 scaled `catalog` by hand: three replicas behind Nginx, whatever the load. The **Horizontal Pod
Autoscaler** (HPA) closes the loop — it measures, compares with a target and changes the number of
replicas — the [autoscaling](../../../classes/compute/serverless-autoscaling/index.md) control loop of
the compute class, running every 15 seconds.

## The rule

``` yaml title="k8s/base/catalog-hpa.yaml"
--8<-- "docs/2027.1/hands-on/10/code/k8s/base/catalog-hpa.yaml"
```

The HPA's core formula is simple:

$$
\text{desired replicas} = \left\lceil \text{current replicas} \times \frac{\text{current utilization}}{\text{target utilization}} \right\rceil
$$

With 2 pods at 150% of their CPU request and a 60% target: ⌈2 × 150 / 60⌉ = 5 pods. Utilization is a
percentage of the **request** (250m), not of the node: a pod using 150m is at 60%.

| `behavior` field | Why it exists |
|---|---|
| `scaleUp.stabilizationWindowSeconds: 0` | scale up as soon as the load is seen — slow scale-up is lost requests |
| `scaleUp.policies` (100% or +2 pods per 15 s) | bounded growth: at most double per period, so one noisy reading cannot explode the deployment |
| `scaleDown.stabilizationWindowSeconds: 120` | use the *highest* recommendation of the last 2 min — no flapping when load oscillates |
| `scaleDown.policies` (1 pod per 30 s) | release capacity slowly; scaling down too fast re-triggers scale-up |

??? question "Why CPU, and when is it the wrong signal?"

    `catalog` is CPU-bound when its cache hit ratio is high: more requests → more CPU, almost
    linearly, so CPU is a good proxy for load. It is the wrong signal when the bottleneck is elsewhere:
    a service waiting on a database (low CPU, high latency), a Kafka consumer (scale on **lag**), a
    WebSocket server (scale on connections). For those, the HPA accepts custom and external metrics
    (requests per second, queue length) through an adapter such as KEDA or the Prometheus adapter.

## Load it

The k6 script ramps the **arrival rate** (open model) through the Ingress, holds it, and comes back
down. The watcher logs what the HPA sees and decides every 5 seconds.

=== "load/catalog-hpa.js"

    ``` javascript title="load/catalog-hpa.js"
    --8<-- "docs/2027.1/hands-on/10/code/load/catalog-hpa.js"
    ```

=== "scripts/watch-hpa.sh"

    ``` shell title="scripts/watch-hpa.sh"
    --8<-- "docs/2027.1/hands-on/10/code/scripts/watch-hpa.sh"
    ```

Three terminals:

``` shell
mkdir -p results && sh scripts/watch-hpa.sh | tee results/lab10-hpa.csv   # 1: the control loop
kubectl -n boxoffice get pods -l app=catalog -w            # 2: pods appearing
k6 run -e PEAK=250 load/catalog-hpa.js                     # 3: the load (≈ 11 min)
```

Adjust `PEAK` to your machine: it should be clearly above what two pods can serve (lab 2 gave you
that number) but below what the whole laptop can serve.

!!! example "Expected shape (illustrative)"

    CPU climbs during the ramp; the HPA adds pods in steps (2 → 4 → 6 …) as fast as the
    `scaleUp` policy allows; **each new pod needs tens of seconds before it is ready** (JVM start +
    probes), so p95 rises during the ramp and comes back down during the hold. After the load drops,
    replicas stay up for the 2-minute stabilization window and then leave one by one.

    The lag between "load arrives" and "capacity is ready" is the price of reactive autoscaling. For a
    flash sale at a known time, you would **pre-scale** (raise `minReplicas` before 10:00) instead of
    hoping the HPA is fast enough — reactive scaling handles the unexpected, scheduling handles the
    expected.

## Pitfalls

- **No requests, no HPA.** Utilization is relative to `resources.requests.cpu`; without requests the
  HPA reports `<unknown>` and does nothing.
- **JVM warm-up looks like load.** A starting JVM burns CPU (class loading, JIT): new pods can push
  the average up and trigger *more* scale-up. The startup probe keeps unready pods out of traffic but
  their CPU still counts; the stabilization window and the scale-up policy limit the damage.
- **The database does not autoscale.** Eight `catalog` pods × 10 connections = 80 connections to one
  PostgreSQL. Scaling the stateless tier moves the bottleneck to the stateful one — check
  `max_connections` (or use the PgBouncer of [lab 6](../../6/index.md)).
- **Node capacity.** If the pods requested do not fit on the nodes, they stay `Pending`. In the cloud
  a **cluster autoscaler** (or Karpenter) adds nodes, which takes minutes, not seconds.

[Next: Ingress](../ingress/index.md){ .md-button .md-button--primary }
