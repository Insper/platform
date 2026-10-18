---
marp: true
lang: en
title: Hands-on 10 — Kubernetes
description: System Architecture · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">System Architecture · Insper</div>

# Hands-on 10 — Kubernetes

**Declare the desired state; let control loops keep BoxOffice there**

<!--
Outline: (1) why control loops; (2) kind + Traefik + metrics-server; (3) Kustomize base/overlay;
(4) StatefulSet vs Deployment; (5) probes and graceful shutdown; (6) HPA; (7) Ingress and Gateway
API; (8) measure.
-->

---

## Nobody edits YAML at 10:00

<div class="q">

Lab 3 scaled `catalog` by editing Compose. Lab 9 restarted a fallen service by hand. Who does that
during the flash sale?

</div>

- Kubernetes: you declare **desired state** ("≥ 2 ready replicas, more above 60% CPU").
- **Controllers** compare desired vs actual every few seconds and act.
- Self-healing, rollouts and autoscaling are all the same idea: **reconciliation**.

---

## Step 1 · A cluster on the laptop

- **kind**: 1 control plane + 2 workers, each a Docker container; host `:80` → node `:30080`.
- **Traefik** (Helm, NodePort 30080): the Ingress controller.
- **metrics-server**: CPU for the HPA (`--kubelet-insecure-tls` in kind only).
- Images: `docker tag … boxoffice/catalog:dev` + `kind load docker-image` — never `latest`.

<div class="warn">

ingress-nginx was **retired in March 2026**. Pick maintained, internet-facing components.

</div>

---

## Step 2 · Kustomize: base + overlays

```text
k8s/base/            namespace, config, db, redis, catalog, hpa, ingress
k8s/overlays/local/  image tag "dev" + lab secrets
```

- `kubectl apply -k k8s/overlays/local`
- `secretGenerator` → `db-credentials-<hash>`: new content, new name, **rollout**.
- Lab 11 adds a GitOps overlay without touching the base.

---

## Stateful vs stateless

| | `db` | `catalog` |
|---|---|---|
| Kind | StatefulSet | Deployment |
| Identity | stable: `db-0` | interchangeable |
| Storage | PVC per replica | none |
| Service | headless (`clusterIP: None`) | ClusterIP, load-balanced |

<p class="small">Production databases: managed service or an operator (backups, failover, upgrades).</p>

---

## Three probes, three questions

| Probe | Question | On failure |
|---|---|---|
| startup | has it finished starting? | other probes wait; restart after the budget |
| liveness | is it stuck beyond repair? | **restart** |
| readiness | should it get traffic now? | **removed** from the Service |

<div class="warn">

Never check a shared dependency in **liveness**: one DB blip → every pod restarts at once.

</div>

---

## Resources and graceful shutdown

- `requests` (250m, 512Mi): what the scheduler reserves; **HPA % is relative to it**.
- `limits` (1 CPU, 768Mi): CPU throttled, memory → `OOMKilled`; heap = 75% of the limit.
- Shutdown: endpoints removed **∥** `preStop: sleep 5` → `SIGTERM` → `server.shutdown=graceful`.
- Rollout `maxSurge: 1`, `maxUnavailable: 0`: never below the desired ready count.

---

## Eventual convergence

<div class="q">

`catalog` restarted twice right after `kubectl apply`. Bug?

</div>

* No `depends_on`: `catalog` started before PostgreSQL → Flyway failed → exit → restart with back-off.
* Components **retry until dependencies exist**; the system converges.
* The first start also runs migrations → the startup budget must cover it (we raised it to 5 min).

---

## Step 3 · The HPA

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
spec:
  minReplicas: 2
  maxReplicas: 8
  metrics: [{ type: Resource, resource: { name: cpu,
             target: { type: Utilization, averageUtilization: 60 } } }]
  behavior:
    scaleUp:   { stabilizationWindowSeconds: 0 }    # + at most 100% or 2 pods / 15 s
    scaleDown: { stabilizationWindowSeconds: 120 }  # - 1 pod / 30 s
```

`desired = ⌈current × utilization / target⌉` → 2 pods at 150% → ⌈2 × 150 / 60⌉ = **5**.

---

## Reactive scaling lags

- Detect (15–30 s) + decide + **JVM start and readiness (~40 s)** ≈ a minute.
- During the lag, existing pods absorb the step: p95 rises, then falls.
- Known event (10:00 on-sale) → **pre-scale**; HPA for the unexpected.
- More pods → more DB connections: the bottleneck moves to the stateful tier.

---

## Step 4 · Ingress (and Gateway API)

- Path: `localhost:80` → node `:30080` → Traefik → rule `/catalog` → Service → **ready** pod.
- `Ingress`: host/path rules, `ingressClassName: traefik`.
- **Gateway API**: `Gateway` (platform team) + `HTTPRoute` (service team); weights, headers, timeouts.

<p class="small">LoadBalancer Service = one address per service; Ingress = one door, many services; API gateway = auth, quotas, transformations.</p>

---

<!-- _class: tight -->

## Step 5 · Measure it

| # | Experiment | Record |
|---|---|---|
| A | fixed 2 replicas vs HPA, k6 ramp to `PEAK` | p95, p99, errors, max replicas, time to scale |
| B | rolling update under 100 req/s, with vs without readiness + `preStop` | failed requests |
| C | delete a pod / stop a node | time until ready again |

<p class="small"><code>scripts/watch-hpa.sh</code> logs CPU, desired, current and ready replicas every 5 s → plot it.</p>

---

## Try it in the playground

- `scale-out` with the `stress` profile: fixed replicas until p99 explodes, then more replicas.
- Throughput per replica = the number behind your HPA target.
- Kill a replica with and without a health check.

<div class="ok">

The playground predicts the shape; your CSV of replicas over time is the evidence.

</div>

---

## Takeaways

1. Kubernetes = **desired state + control loops**; self-healing, rollouts and autoscaling are reconciliation.
2. StatefulSet + PVC for data; Deployments for interchangeable stateless pods.
3. **Startup, liveness, readiness** answer different questions — no dependencies in liveness.
4. Readiness + `preStop` + graceful shutdown = rollouts without errors.
5. The HPA scales on % of **requests**; it lags — pre-scale for known peaks.
6. Ingress (or Gateway API) is the door; choose a **maintained** controller.
