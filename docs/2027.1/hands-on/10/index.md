# 10. Kubernetes

!!! info "Goal"

    Run BoxOffice on a real Kubernetes cluster on your laptop. Create a three-node **kind** cluster,
    install an **Ingress controller** (Traefik) and **metrics-server**, deploy `db`, `redis` and
    `catalog` with **Kustomize** — probes, resource requests and limits, graceful shutdown — and let a
    **Horizontal Pod Autoscaler** scale `catalog` under a k6 ramp. Measure how fast capacity follows
    load, how many requests a rolling update loses, and how long self-healing takes.

In lab 3 you scaled `catalog` by editing `docker-compose.yaml` and restarting; in lab 9 you watched a
service fall over and had to restart it by hand. At 10:00 on sale day nobody should be editing YAML
or restarting containers. Kubernetes turns both into **control loops**: you declare the desired
state — "at least two ready replicas, more when CPU passes 60%" — and controllers keep reality there,
every few seconds, forever. This lab is the hands-on side of the
[cloud-native class](../../classes/cloud-native/index.md) and builds chapter 11 of the
[story of the course](../../index.md#story): it implements the class's decisions on
[probes](../../classes/cloud-native/kubernetes/index.md#probes),
[requests and limits](../../classes/cloud-native/kubernetes/index.md#requests-limits),
[autoscaling](../../classes/cloud-native/kubernetes/index.md#autoscaling) and
[losing a node](../../classes/cloud-native/kubernetes/index.md#losing-a-node).

## Slides

<div class="slides-embed">
  <iframe src="slides/kubernetes.html" title="Slides: Kubernetes" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/kubernetes.html){:target="_blank"}

## Before you start

| | |
|---|---|
| Time | about 4 hours |
| Tools | `kubectl` (`kubectl version --client`), `kind` 0.33+ (`kind version`) or `minikube`, **Helm** 4 (`helm version`, installed in step 1), Docker, k6 |
| Docker resources | at least 4 CPUs and **8 GB**; the Compose stack must be **stopped** (the cluster uses port 80) |
| Ports | 80 on your machine (the Ingress) |

Every command runs from the **root of your `boxoffice` repository**, in the state lab 9 left it:

``` text title="Start state (end of lab 9)"
boxoffice/
├── docker-compose.yaml     # the full Compose stack of labs 1-9
├── infra/  load/  scripts/
└── services/               # auth, catalog, gateway, inventory, notification, order, payment
```

!!! tip "Catch up"

    Skipped or broke lab 9? Download [boxoffice-after-lab-9.zip](../9/boxoffice-after-lab-9.zip),
    unzip it, `cd boxoffice`, and continue from here. This lab only needs the `catalog` image, built
    from `services/catalog` with `docker compose build catalog-1`.

Every file of this lab is shown in full on these pages and published under
`https://insper.github.io/platform/2027.1/hands-on/10/code/<path>`.

## Architecture

``` diagram-sim
flowchart LR
    k6[k6] -->|"localhost:80"| traefik["Traefik (Ingress)"]
    subgraph cluster [kind cluster: 1 control plane + 2 workers]
        traefik -->|/catalog| svc[Service catalog]
        svc --> c1[catalog pod]
        svc --> c2[catalog pod]
        svc -.-> cN["catalog pod ... (HPA: 2..8)"]
        c1 --> redis[(redis)]
        c1 --> db[("db-0 (StatefulSet + PVC)")]
        ms[metrics-server] -.->|CPU| hpa[HPA]
        hpa -.->|replicas| svc
    end
```

!!! example "BoxOffice components touched"

    | Palette component | In this lab |
    |---|---|
    | [Ingress](../../reference/components/edge/index.md#ingress) | Traefik, with an `Ingress` (or a Gateway API `HTTPRoute`) for `/catalog` |
    | [Load Balancer](../../reference/components/edge/index.md#lb) | the `catalog` Service spreading requests over ready pods |
    | [App Server](../../reference/components/compute/index.md#app) | `catalog` Deployment, autoscaled by an HPA |
    | [Health Check](../../reference/components/observability/index.md#healthcheck) | startup, liveness and readiness probes |
    | [SQL Database](../../reference/components/storage/index.md#sql) / [Cache](../../reference/components/storage/index.md#cache) | `db` StatefulSet with a persistent volume, `redis` |

## What you will measure

| Question | Metric | Tool |
|---|---|---|
| How fast does capacity follow a ramp of load? | time to first scale-up, time to full capacity, p95 during the ramp | k6, `watch-hpa.sh` |
| Fixed replicas vs autoscaling? | p95, p99, errors at the same peak | k6 |
| Does a rolling update lose requests? | failed requests with and without readiness + `preStop` | k6 |
| How long does self-healing take? | pod deleted / node stopped → ready again | `kubectl get -w` |

## Prerequisites

- Labs [1](../1/index.md) to [5](../5/index.md) done (the `catalog` image with its cache); lab 8's
  `load/catalog-otel.js` is reused in step 5.
- `kubectl`, `kind` (or `minikube`) from [lab 0](../0/index.md), plus Helm (step 1).
- Read the [Kubernetes page](../../classes/cloud-native/kubernetes/index.md) of the cloud-native class
  and [autoscaling](../../classes/compute/serverless-autoscaling/index.md) in the compute class.

## Steps

1. [A local cluster](cluster/index.md) — kind with three nodes, Traefik, metrics-server, images loaded into the cluster.
2. [Deploy BoxOffice](deploy/index.md) — Kustomize base and overlay; StatefulSet, Deployment, probes, resources, graceful shutdown; self-healing.
3. [Autoscaling](autoscaling/index.md) — an `autoscaling/v2` HPA with scale-up and scale-down behavior, under a k6 ramp.
4. [Ingress](ingress/index.md) — the path of a request into the cluster; Ingress and Gateway API.
5. [Measure it](measure/index.md) — fixed vs autoscaled, rollouts with and without probes, recovery times.

## Try it in the playground

**Try it:** run `scale-out` with the `stress` profile and a fixed number of replicas until p99
explodes; then raise the replica count and run again. Note the throughput per replica — the same
number your HPA target is implicitly based on. Turn on a health check and kill a replica: how long
does the load balancer keep sending it traffic?

<div class="sdp" data-scenario="scale-out" data-mode="compact" data-height="520" data-profile="stress"></div>

The full simulator is in the [playground](../../../playground/index.md).

## Measure it

The [Measure it](measure/index.md) step has the commands and the results table to keep in
`results/lab10.md`, with the `watch-hpa.sh` log in `results/lab10-hpa.csv`.

## Troubleshooting { #troubleshooting }

| Symptom | Likely cause | Fix |
|---|---|---|
| `kind create cluster` fails with `port is already allocated` | the Compose `edge` (or another server) uses port 80 | `docker compose down`; `lsof -i :80` |
| pods in `ImagePullBackOff` / `ErrImagePull` | the image was not loaded into the nodes, or the tag is `latest` | `kind load docker-image boxoffice/catalog:dev --name boxoffice`; keep `imagePullPolicy: IfNotPresent` |
| `catalog` in `CrashLoopBackOff` during the first minutes | PostgreSQL was not ready yet (normal), or wrong credentials | wait; `kubectl -n boxoffice logs deploy/catalog --previous` |
| `catalog` killed with `failed startup probe` | first start (migrations) slower than the startup budget on a busy laptop | raise `failureThreshold` of the `startupProbe`; give Docker more CPU |
| `kubectl get hpa` shows `cpu: <unknown>/60%` | metrics-server not ready, or not patched with `--kubelet-insecure-tls` | `kubectl -n kube-system get pods`; repeat the patch; wait one minute |
| pods stay `Pending` | not enough CPU/memory for the requested resources | `kubectl -n boxoffice describe pod <name>`; lower `PEAK`/`maxReplicas` or give Docker more resources |
| `curl localhost/catalog/...` returns `404` | the Ingress is missing or has the wrong `ingressClassName` | `kubectl -n boxoffice get ingress`; `kubectl -n traefik get pods` |
| `kubectl` talks to the wrong cluster | another context is active | `kubectl config use-context kind-boxoffice` |

!!! success "Best practices in this lab"

    - **One probe per question**: startup sized for the slowest start (5 min, with migrations), liveness local to the JVM, readiness for traffic — `k8s/base/catalog.yaml`; why: [Kubernetes — probes](../../classes/cloud-native/kubernetes/index.md#probes).
    - **Requests set on purpose, because they are the base of the HPA percentage** (60% of 250m) — `catalog.yaml` and `catalog-hpa.yaml`; why: [requests and limits](../../classes/cloud-native/kubernetes/index.md#requests-limits).
    - **No request lost in a rollout**: `maxUnavailable: 0`, a 5 s `preStop` pause and graceful shutdown — `catalog.yaml`; why: [graceful shutdown](../../classes/cloud-native/containers/index.md#graceful-shutdown-the-other-half-of-disposability).
    - **Scale up fast, down slowly**: double or +2 pods every 15 s, one pod every 30 s after a 2-minute window — `catalog-hpa.yaml`; why: [autoscaling](../../classes/cloud-native/kubernetes/index.md#autoscaling).
    - **One base, thin overlays**: what differs per environment lives in `k8s/overlays/`, so lab 11 reuses `k8s/base/` unchanged; why: [GitOps](../../classes/cloud-native/delivery/index.md#gitops).

## Clean up

``` shell
kind delete cluster --name boxoffice     # frees all the memory of the three nodes
docker compose up -d                     # back to the Compose stack, if you need it
```

Lab 11 needs a cluster again: you can keep it (`docker stop boxoffice-control-plane boxoffice-worker
boxoffice-worker2` and `docker start …` later) or recreate it with the commands of step 1.

## End state

``` text title="End state (what this lab added)"
boxoffice/
├── k8s/
│   ├── kind.yaml
│   ├── base/               # kustomization, namespace, config, db, redis, catalog, catalog-hpa,
│   │                       # ingress (+ catalog-route.yaml, the Gateway API alternative)
│   └── overlays/local/kustomization.yaml
├── load/catalog-hpa.js
├── scripts/watch-hpa.sh
└── results/lab10.md, lab10-hpa.csv
```

Commit and tag: `git add -A && git commit -m "lab 10: kubernetes" && git tag lab10`.

## Checklist

- [ ] `k8s/kind.yaml`, `k8s/base/` and `k8s/overlays/local/` in your repository; `kubectl apply -k k8s/overlays/local` deploys everything into the `boxoffice` namespace
- [ ] `curl localhost/catalog/events/1` answers through Traefik
- [ ] `catalog` has startup, liveness and readiness probes, requests and limits, graceful shutdown and a `preStop` pause
- [ ] the HPA scaled `catalog` up during the k6 ramp and back down afterwards; the CSV log is committed
- [ ] the rolling-update experiment shows the effect of readiness + `preStop` in failed requests
- [ ] results table filled in and explained; `git tag lab10`

## Related

- Theory: [Cloud-native platforms](../../classes/cloud-native/index.md) ·
  [Containers](../../classes/cloud-native/containers/index.md) ·
  [Kubernetes](../../classes/cloud-native/kubernetes/index.md) ·
  [Serverless and autoscaling](../../classes/compute/serverless-autoscaling/index.md) ·
  [Load balancing](../../classes/edge/load-balancing/index.md)
- Exercise: [Kubernetes autoscaling](../../exercises/kubernetes-autoscaling/index.md)
- Next lab: [11. Delivery](../11/index.md) deploys these manifests from Git with Argo CD.

[Start: A local cluster](cluster/index.md){ .md-button .md-button--primary }
