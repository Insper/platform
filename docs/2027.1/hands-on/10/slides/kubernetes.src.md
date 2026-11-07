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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">System Architecture · Insper</div>

# Hands-on 10 — Kubernetes

**Declare the desired state; let control loops keep BoxOffice there**

<!--
Outline: (1) why control loops; (2) kind + Traefik + metrics-server; (3) Kustomize base/overlay;
(4) StatefulSet vs Deployment; (5) probes and graceful shutdown; (6) the controllers at work and the
lab twin; (7) HPA; (8) Ingress and Gateway API; (9) measure.
-->

---

## Nobody edits YAML at 10:00

<div class="q">

Lab 3 scaled `catalog` by editing Compose. Lab 9 restarted a fallen service by hand. Who does that
during the flash sale?

</div>

- Kubernetes: you declare **desired state** ("≥ 2 ready replicas, more above 60% central processing unit (CPU)").
- **Controllers** compare desired vs actual every few seconds and act.
- Self-healing, rollouts and autoscaling are all the same idea: **reconciliation**.

---

## Step 1 · A cluster on the laptop

<div class="flow" style="align-items: stretch">
<div class="box muted" style="flex: .5; display: flex; flex-direction: column; justify-content: center">you<small>localhost:80</small></div>
<div class="arrow" style="align-self: center">→ :30080</div>
<div class="group">
<div class="caption">control-plane</div>
<div class="box accent">Traefik<small>Ingress controller · Helm · NodePort 30080</small></div>
<div class="box">metrics-server<small>CPU for the autoscaler</small></div>
</div>
<div class="group">
<div class="caption">worker</div>
<div class="box green">catalog</div>
<div class="box orange">db-0 · redis</div>
</div>
<div class="group">
<div class="caption">worker2</div>
<div class="box green">catalog</div>
</div>
</div>

- **kind**: each node is a Docker container. **Horizontal Pod Autoscaler (HPA)** needs metrics-server (`--kubelet-insecure-tls` in kind only).
- Images: `docker tag … boxoffice/catalog:dev` + `kind load docker-image` — never `latest`.

<div class="warn">

ingress-nginx was **retired in March 2026**. Pick maintained, internet-facing components.

</div>

---

## Step 2 · Kustomize: base + overlays

<div class="flow">
<div class="box">k8s/base/<small>namespace, config, db, redis, catalog, hpa, ingress</small></div>
<div class="arrow">+</div>
<div class="box accent">k8s/overlays/local/<small>image tag "dev" + lab secrets</small></div>
<div class="arrow">→ kubectl apply -k →</div>
<div class="box green">namespace boxoffice<small>11 objects, one desired state</small></div>
</div>

- `secretGenerator` → `db-credentials-<hash>`: new content, new name, **rollout**.
- Lab 11 adds a GitOps overlay without touching the base.

---

## Stateful vs stateless

| | `db` | `catalog` |
|---|---|---|
| Kind | StatefulSet | Deployment |
| Identity | stable: `db-0` | interchangeable |
| Storage | PersistentVolumeClaim (PVC) per replica | none |
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

Never check a shared dependency in **liveness**: one database blip → every pod restarts at once.

</div>

---

## Resources and graceful shutdown

- `requests` (250m, 512Mi): what the scheduler reserves; **HPA % is relative to it**.
- `limits` (1 CPU, 768Mi): CPU throttled, memory → `OOMKilled`; heap = 75% of the limit.
- Rollout `maxSurge: 1`, `maxUnavailable: 0`: never below the desired ready count.

<div class="flow">
<div class="box red">pod Terminating</div><div class="arrow">→</div>
<div class="box orange">endpoints removed<small>Traefik updates a moment later</small></div><div class="arrow">∥</div>
<div class="box accent">preStop: sleep 5<small>the Java virtual machine (JVM) still serves</small></div><div class="arrow">→</div>
<div class="box">SIGTERM<small>server.shutdown=graceful</small></div><div class="arrow">→</div>
<div class="box green">exit<small>well within 30 s</small></div>
</div>

---

## Eventual convergence

<div class="q">

`catalog` restarted twice right after `kubectl apply`. Bug?

</div>

* No `depends_on`: `catalog` started before PostgreSQL → Flyway failed → exit → restart with back-off.
* Components **retry until dependencies exist**; the system converges.
* The first start also runs migrations → the startup budget must cover it (we raised it to 5 min).

---

<!-- _class: tight -->

## Watch the controllers work

<div class="flow">
<div class="arrow" style="flex: .55; text-align: left">Self-healing</div>
<div class="box red">delete both pods</div><div class="arrow">→</div>
<div class="box orange">ReplicaSet: 0 of 2<small>two new pods at once</small></div><div class="arrow">→</div>
<div class="box green">2/2 ready<small>JVM start: tens of seconds</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .55; text-align: left">Losing a node</div>
<div class="box red">docker stop worker2</div><div class="arrow">→</div>
<div class="box orange">NotReady<small>about a minute</small></div><div class="arrow">→</div>
<div class="box orange">evicted<small>after the 5-min toleration</small></div><div class="arrow">→</div>
<div class="box green">replaced on worker</div>
</div>
<div class="flow">
<div class="arrow" style="flex: .55; text-align: left">Rolling update</div>
<div class="box accent">+1 new pod<small>maxSurge: 1</small></div><div class="arrow">→ ready →</div>
<div class="box">−1 old pod<small>maxUnavailable: 0</small></div><div class="arrow">→</div>
<div class="box green">repeat</div>
</div>

- Time each one: the self-healing time is the **mean time to repair (MTTR)** of a pod crash.
- **Detection dominates** the lost node; JVM startup dominates the deleted pod.

---

## Without a cluster: the simulator

- The pages embed the lab's cluster as a simulator: the same nodes, manifests and commands.
- **Deploy**: `apply -k` (catalog restarts twice), self-healing, a lost node.
- **Measure it**: experiment B, with and without readiness + `preStop`.
- Free mode: change how long Traefik takes to see an endpoint change.

<div class="ok">

Play it before the lab to know what to look for; your own cluster still gives the numbers you report.

</div>

<!--
The simulator models a laptop's timings (JVM start, PostgreSQL init) and Kubernetes' defaults (back-off,
node detection, the 300 s toleration); the tips on the pages quote its numbers.
-->

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

## One turn of the loop: reactive scaling lags

<div class="flow">
<div class="box">metrics-server<small>CPU per pod</small></div><div class="arrow">→</div>
<div class="box accent">HPA, every 15 s<small>desired = ⌈current × CPU / 60%⌉</small></div><div class="arrow">→</div>
<div class="box">Deployment<small>2 to 8 replicas</small></div><div class="arrow">→</div>
<div class="box red">new pod<small>JVM start + probes: tens of s</small></div><div class="arrow">→</div>
<div class="box green">ready<small>average CPU falls</small></div>
</div>

- The HPA decides in seconds; capacity arrives only when a JVM is ready.
- During the lag, existing pods absorb the step: p95 rises, then falls.
- Known event (10:00 on-sale) → **pre-scale**; HPA for the unexpected.
- More pods → more database connections: the bottleneck moves to the stateful tier.

---

## Load it: warm pods first

<div class="warn">

A starting JVM burns CPU compiling code, and the HPA scales on that CPU too.

</div>

- Right after a rollout, `PEAK=250` took `catalog` to **8** replicas; liveness timed out, pods restarted, k6 saw **26%** errors.
- The same run with warm pods never left **2** replicas.
- Warm up with lab 8's script, wait for 2 replicas, then `k6 run -e PEAK=1000 load/catalog-hpa.js`.
- `PEAK` must push two warm pods above 60% of their request (≈ 600 req/s on the test laptop).

---

## Step 4 · Ingress (and Gateway API)

<div class="flow">
<div class="box muted">curl localhost:80</div><div class="arrow">→</div>
<div class="box">node :30080<small>kind.yaml</small></div><div class="arrow">→</div>
<div class="box accent">Traefik<small>rule /catalog</small></div><div class="arrow">→</div>
<div class="box">Service catalog<small>:8082</small></div><div class="arrow">→</div>
<div class="box green">a <b>ready</b> pod</div>
</div>

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

<p class="small"><code>scripts/watch-hpa.sh</code> logs CPU, desired, current and ready replicas every 5 s into a comma-separated values (CSV) file → plot it.</p>

---

<!-- _class: tight -->

## A · One run on a laptop (illustrative)

| t | CPU (% of request) | desired | ready |
|---|---|---|---|
| 1:48 | 63 | 2 | 2 |
| 2:03 | 79 | 3 | 2 |
| 3:33 | 247 | **8** | 4 |
| 7:31 | 220 | 8 | **8** |
| 13:00 | 4 | 2 | 2 |

- The eighth pod, asked at 3:33, was ready at **7:31** — after the hold ended.
- HPA: p95 5–7 s, p99 ≈ 19 s, 0.3% errors. **Two fixed warm pods**: p95 ≈ 34 ms, no errors.
- On a laptop the new JVMs share the CPUs that serve the load: scale-out cost more than it added. The **lag** is what pre-scaling removes.

---

## B · A rollout under 100 req/s

| Run | Readiness probe + `preStop` | Failed requests (test run) |
|---|---|---|
| with | ✅ | **0** |
| without | ❌ | about **140 of 11,900** (1.2%, Traefik 502 and 504) |

- The startup probe still keeps a new pod out of the Service until the JVM answers.
- Without the `preStop` pause, old pods stop accepting while still in Traefik's endpoint list.

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
5. Detection dominates recovery: a lost node's pods are replaced only after NotReady + the toleration.
6. The HPA scales on % of **requests**; it lags — pre-scale for known peaks.
7. Ingress (or Gateway API) is the door; choose a **maintained** controller.
