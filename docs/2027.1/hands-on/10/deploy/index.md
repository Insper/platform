# 2. Deploy BoxOffice

Compose describes *containers to start*. Kubernetes manifests describe a **desired state** — "two
ready replicas of `catalog`, reachable as `catalog:8082`" — and controllers work continuously to make
reality match it: a crashed pod is replaced, a dead node's pods are rescheduled, a new image is rolled
out pod by pod. This step writes that desired state for the read path of BoxOffice: `db`, `redis`
and `catalog`.

## Layout: base + overlays

Manifests live in `k8s/` of your repository, organized with **Kustomize** (built into `kubectl`):
a `base` with everything that is the same in every environment, and one **overlay** per environment
with only what differs (image tags, secrets, replica counts). [Lab 11](../../11/index.md) adds an
overlay for the GitOps deployment without touching the base.

```
k8s/
├── kind.yaml                      # the cluster (step 1)
├── base/
│   ├── kustomization.yaml
│   ├── namespace.yaml
│   ├── config.yaml                # ConfigMap: DB_HOST, REDIS_HOST, ...
│   ├── db.yaml                    # PostgreSQL StatefulSet + headless Service
│   ├── redis.yaml
│   ├── catalog.yaml               # Deployment + Service
│   ├── catalog-hpa.yaml           # step 3
│   └── ingress.yaml               # step 4
└── overlays/
    └── local/
        └── kustomization.yaml     # image tag "dev" + lab secrets
```

=== "base/kustomization.yaml"

    ``` yaml title="k8s/base/kustomization.yaml"
    --8<-- "docs/2027.1/hands-on/10/code/k8s/base/kustomization.yaml"
    ```

=== "overlays/local/kustomization.yaml"

    ``` yaml title="k8s/overlays/local/kustomization.yaml"
    --8<-- "docs/2027.1/hands-on/10/code/k8s/overlays/local/kustomization.yaml"
    ```

=== "namespace.yaml"

    ``` yaml title="k8s/base/namespace.yaml"
    --8<-- "docs/2027.1/hands-on/10/code/k8s/base/namespace.yaml"
    ```

=== "config.yaml"

    ``` yaml title="k8s/base/config.yaml"
    --8<-- "docs/2027.1/hands-on/10/code/k8s/base/config.yaml"
    ```

The `secretGenerator` appends a hash of the content to the Secret's name (`db-credentials-c67…`) and
rewrites every reference to it: changing a password produces a *new* Secret and therefore a rollout
of the pods that use it — a stale credential cannot linger in a running pod.

## Stateful and stateless

=== "db.yaml"

    ``` yaml title="k8s/base/db.yaml"
    --8<-- "docs/2027.1/hands-on/10/code/k8s/base/db.yaml"
    ```

=== "redis.yaml"

    ``` yaml title="k8s/base/redis.yaml"
    --8<-- "docs/2027.1/hands-on/10/code/k8s/base/redis.yaml"
    ```

A **StatefulSet** gives the database what a Deployment does not: a stable identity (`db-0`) and a
**PersistentVolumeClaim** per replica that survives pod restarts. Deleting the pod keeps the data;
deleting the PVC deletes it.

## The `catalog` Deployment

``` yaml title="k8s/base/catalog.yaml"
--8<-- "docs/2027.1/hands-on/10/code/k8s/base/catalog.yaml"
```

The three probes answer three different questions, and confusing them causes outages:

| Probe | Question | On failure | Spring Boot endpoint |
|---|---|---|---|
| `startupProbe` | has the process finished starting? | keeps the other probes off; restart after the budget | `/actuator/health/liveness` |
| `livenessProbe` | is the process stuck beyond repair? | **restart** the container | `/actuator/health/liveness` (internal state only) |
| `readinessProbe` | should this pod receive traffic now? | **remove** from the Service endpoints (no restart) | `/actuator/health/readiness` |

!!! warning "Never put a dependency in the liveness probe"

    If liveness checked the database, a database blip would make Kubernetes restart **every**
    `catalog` pod at once — turning a 10-second blip into minutes of outage while JVMs restart. Spring
    Boot's liveness group checks only the application's own state; that is why lab 1 enabled
    `management.endpoint.health.probes`.

`requests` are what the scheduler reserves on a node (and the base of HPA percentages); `limits` are
the ceiling — above the memory limit the container is killed (`OOMKilled`), above the CPU limit it
is throttled. Lab 1's Dockerfile sizes the heap with `-XX:MaxRAMPercentage=75`, so the JVM respects
the 768 Mi limit.

## Apply

<!-- termynal -->

``` shell
> kubectl apply -k k8s/overlays/local
namespace/boxoffice created
configmap/boxoffice-config created
secret/db-credentials-c677754gbf created
service/catalog created
service/db created
service/redis created
deployment.apps/catalog created
deployment.apps/redis created
statefulset.apps/db created
horizontalpodautoscaler.autoscaling/catalog created
ingress.networking.k8s.io/boxoffice created
> kubectl -n boxoffice get pods -o wide
NAME                      READY   STATUS    RESTARTS      AGE     NODE
catalog-8685666c5-5bv8t   1/1     Running   2 (45s ago)   3m31s   boxoffice-worker
catalog-8685666c5-9z7n6   1/1     Running   2 (2m ago)    3m31s   boxoffice-worker2
db-0                      1/1     Running   0             3m31s   boxoffice-worker
redis-6757b9b5ff-9klb4    1/1     Running   0             3m31s   boxoffice-worker
> curl -s -o /dev/null -w '%{http_code}\n' localhost/catalog/events/1
200
```

??? question "Why did `catalog` restart twice?"

    Kubernetes has no `depends_on`: all pods start at once. `catalog` started before PostgreSQL
    accepted connections, Flyway failed, the JVM exited, and Kubernetes restarted it with an
    exponential back-off until the database was there (`kubectl -n boxoffice logs deploy/catalog
    --previous` shows the first failure). This is **eventual convergence**: instead of ordering the
    startup, every component retries until its dependencies exist. It also means the first start can
    be slow — the startup probe allows up to 5 minutes because the first successful start also runs
    the Flyway migrations of lab 1.

## Watch the controllers work

=== "Self-healing"

    ``` shell
    kubectl -n boxoffice delete pod -l app=catalog --wait=false
    kubectl -n boxoffice get pods -l app=catalog -w
    ```

    The Deployment's ReplicaSet sees 0 of 2 pods and creates two new ones immediately. Time how long
    until both are `1/1 Running` again: that is your **MTTR** (mean time to repair) for a pod crash —
    dominated by JVM startup.

=== "Losing a node"

    ``` shell
    docker stop boxoffice-worker2
    kubectl get nodes -w            # NotReady after about a minute
    kubectl -n boxoffice get pods -o wide -w
    docker start boxoffice-worker2
    ```

    Pods on the lost node are replaced on the remaining nodes — but only after the node is declared
    unhealthy and the pods' tolerations expire (about 5 minutes by default). Detection time dominates
    recovery, exactly as in the [availability math](../../../classes/estimation/availability-math/index.md).

=== "Rolling update"

    ``` shell
    kubectl -n boxoffice rollout restart deployment/catalog
    kubectl -n boxoffice rollout status deployment/catalog
    ```

    With `maxSurge: 1` and `maxUnavailable: 0`, Kubernetes starts one new pod, waits until it is
    **ready**, then terminates one old pod, and repeats. In [step 5](../measure/index.md) you will run
    k6 during a rollout, with and without the readiness probe and the `preStop` pause, and count the
    errors.

!!! info "Graceful shutdown, step by step"

    When a pod is terminated: (1) it is removed from the Service endpoints **and**, in parallel, (2)
    the `preStop` hook runs (5 s sleep), then (3) `SIGTERM` reaches the JVM, which with
    `server.shutdown=graceful` stops accepting and finishes in-flight requests. Without the `preStop`
    pause, step 3 can happen before every node's proxy has stopped sending traffic to the pod — and
    those requests fail with connection refused.

## Your turn: the other services

Deploy the rest of BoxOffice the same way — one Deployment + Service each, same probes, same
`envFrom`. The table summarizes what changes:

| Service | Port | Extra configuration | Notes |
|---|---|---|---|
| `auth` | 8081 | `JWT_ISSUER`, `ADMIN_EMAIL`/`ADMIN_PASSWORD` (Secret) | private key in a Secret |
| `gateway` | 8080 | `AUTH_JWKS_URI`, `CATALOG_URL`, `ORDER_URL`… (`http://<service>:<port>`) | then point the Ingress at `gateway` instead of `catalog` |
| `inventory` | 8083 | `DB_REPLICA_HOST` | a second StatefulSet for the replica, or skip the replica here |
| `order`, `notification` | 8084, 8086 | `KAFKA_BOOTSTRAP_SERVERS` | Kafka on Kubernetes is usually run by an operator (e.g. Strimzi); optional in this lab |

[Next: Autoscaling](../autoscaling/index.md){ .md-button .md-button--primary }
