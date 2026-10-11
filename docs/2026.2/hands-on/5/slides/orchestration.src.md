---
marp: true
lang: en
title: Hands-on 5 — Orchestration
description: Platforms, Microservices, DevOps and APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Platforms, Microservices, DevOps and APIs · Hands-on 5</div>

# Hands-on 5 — Orchestration

**Declare the desired state; Kubernetes keeps the cluster there**

<!--
Outline: (1) what an orchestrator does; (2) Compose × Kubernetes and the alternatives; (3) Deployment,
ReplicaSet, Pod, Service, ConfigMap, Secret; (4) Postgres and gateway manifests; (5) HPA, kubectl,
Minikube.
-->

---

## Beyond one machine

<div class="q">

The store runs fine with `docker compose up`. What happens when a container **dies at 3 a.m.**, traffic
**triples**, or one host is **not enough**?

</div>

* **Scheduling** — place containers on appropriate servers.
* **Scaling** — add or remove containers with demand.
* **Networking** and **service discovery** — containers find each other.
* **Self-healing** — restart failed containers, redistribute workloads.

<!--
These five tasks are the definition of an orchestrator. Kubernetes is the most widely adopted;
Docker Swarm and Apache Mesos are others.
-->

---

## Docker Compose × Kubernetes

| Aspect | Docker Compose | Kubernetes |
|---|---|---|
| **Scope** | single host | multi-host cluster |
| **Configuration** | YAML: services, networks, volumes | declarative YAML: **desired state** + controllers |
| **Scalability** | no auto-scaling | dynamic auto-scaling |
| **Features** | basic restart policies | load balancing, rolling updates, self-healing |
| **Complexity** | simple, low learning curve | steeper: pods, services, deployments |
| **Use case** | local dev, testing, small prod | large-scale production |

<p class="small"><strong>Kompose</strong> helps migrate a Compose file to Kubernetes manifests.</p>

---

## Alternatives to Kubernetes

| Environment | Options |
|---|---|
| **On-premise** | Nomad (simple, also non-container workloads), Apache Mesos, OpenShift (K8s + enterprise tools) |
| **Cloud** | Amazon ECS, Google Cloud Run, AWS Fargate, Azure Container Instances |
| **Managed K8s** | Google GKE, Amazon EKS — simpler operations, still K8s expertise |
| **Local** | Docker Compose, Minikube, Docker Swarm, Kind, Rancher Desktop, MicroK8s, k3s |

- **Nomad** and **Swarm** favour simplicity; **cloud-native** options cut management but tie you to a provider.
- **Local tools** are not production-ready — they excel at development and learning.

---

## The Kubernetes objects

`Deployment` → defines a `ReplicaSet` → manages `Pod`s → run `Container`s

| Object | Role |
|---|---|
| **Deployment** | the manager: how many replicas, how to update them |
| **ReplicaSet** | keeps the right number of Pods alive |
| **Pod** | smallest unit; one or more containers |
| **Service** | load balancer: routes traffic to the Pods |
| **ConfigMap** | configuration, outside the image |
| **Secret** | sensitive data: passwords, API keys |

---

## Service types

| Type | Reachable from |
|---|---|
| **ClusterIP** (default) | inside the cluster only |
| **NodePort** | outside, at `<NodeIP>:<NodePort>` on every node |
| **LoadBalancer** | an external load balancer from the cloud provider |

<div class="ok">

In the store: **Postgres** is a `ClusterIP` (internal only); the **gateway** is a `LoadBalancer` (the single public entry).

</div>

<!--
Connect to hands-on 2: the gateway is still the only door — now at cluster level.
-->

---

## Postgres: Secret and ConfigMap

<div class="cols">
<div>

```yaml
apiVersion: v1
kind: Secret
metadata:
    name: postgres-secrets
data:
    POSTGRES_USER: c3RvcmU=
    POSTGRES_PASSWORD: c3RvcmU=
```

</div>
<div>

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
    name: postgres-configmap
data:
    POSTGRES_HOST: postgres
    POSTGRES_DB: store
```

</div>
</div>

<div class="warn">

Secret values are **base64-encoded, not encrypted**: `c3RvcmU=` is just `store`. Keep real secrets out of Git.

</div>

---

## Postgres: the Deployment

```yaml
spec:
  replicas: 1
  selector:
    matchLabels: { app: postgres }
  template:
    metadata:
      labels: { app: postgres }
    spec:
      containers:
        - name: postgres
          image: postgres:latest
          resources: { requests: { memory: "256Mi", cpu: "250m" },
                       limits:   { memory: "512Mi", cpu: "500m" } }
```

- `env` reads `POSTGRES_DB` via **`configMapKeyRef`**, user and password via **`secretKeyRef`**.
- The `selector` must match the Pod **labels** — that is how the Deployment finds its Pods.

---

## Postgres: Service and apply

```yaml
kind: Service
metadata:
    name: postgres
spec:
    type: ClusterIP
    ports:
        - port: 5432
    selector:
        app: postgres
```

```bash
kubectl apply -f ./k8s/secrets.yaml      # then configmap, deployment, service
kubectl get secrets; kubectl get pods; kubectl get services
```

<p class="small">The Service name <code>postgres</code> is the hostname the other Pods use — the same value as <code>POSTGRES_HOST</code>.</p>

---

## Gateway: one file, two objects

`gateway-service/k8s/k8s.yaml` holds a Deployment and a Service, separated by `---`:

<div class="cols">
<div>

```yaml
kind: Deployment
metadata: { name: gateway }
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: gateway
          image: humbertosandmann/gateway:latest
          imagePullPolicy: Always
          ports:
            - containerPort: 8080
```

</div>
<div>

```yaml
kind: Service
metadata: { name: gateway }
spec:
  selector:
    app: gateway
  ports:
    - protocol: TCP
      port: 8080
      targetPort: 8080
  type: LoadBalancer
```

</div>
</div>

<p class="small">The image comes from Docker Hub; <code>imagePullPolicy: Always</code> pulls it again whenever a Pod starts.</p>

---

## Run and verify

```bash
kubectl apply -f ./k8s/k8s.yaml
kubectl get deployments
kubectl get pods
kubectl get services
```

- The `gateway` Service gets an **EXTERNAL-IP** (on AWS, an `…elb.amazonaws.com` hostname): call it from a browser.
- It is **HTTP**, not HTTPS: TLS needs certificates and an **Ingress**.
- An **Ingress** routes external HTTP/S traffic to several services under one domain.

<p class="small">On Minikube, a LoadBalancer stays <code>&lt;pending&gt;</code> until <code>minikube tunnel</code> is running.</p>

---

## Scaling: the HPA

The **Horizontal Pod Autoscaler** changes the replica count from observed CPU (or other metrics).

```bash
kubectl autoscale deployment <name> --cpu-percent=<target> --min=<min> --max=<max>
kubectl get hpa
kubectl delete hpa <hpa-name>
kubectl scale deployment <name> --replicas=<number>   # manual alternative
```

<div class="ok">

You set the **target CPU** and the **min / max replicas**; the controller does the rest, no manual intervention.

</div>

---

## kubectl and Minikube essentials

<div class="cols">
<div>

### kubectl

- `kubectl get all`
- `kubectl describe pod <pod>`
- `kubectl logs <pod>`
- `kubectl exec -it <pod> -- bash`
- `kubectl port-forward <pod> 8080:8080`
- `kubectl delete deployment <name>`

</div>
<div>

### Minikube (single-node, local)

- `minikube start --driver=<d> --profile=<p>`
- `minikube status`
- `minikube dashboard`
- `minikube stop --all`
- `minikube delete --all --purge`

</div>
</div>

---

## Common pitfalls

- **Labels**: a Service or Deployment `selector` that does not match the Pod labels finds **nothing**.
- **Order**: apply the Secret and ConfigMap **before** the Deployment that references them.
- **Stale images**: `:latest` + `imagePullPolicy: Always` pulls on every restart — pin tags in production.
- **Plain-text secrets**: base64 is encoding; a committed `secrets.yaml` is a leaked password.
- **Wrong Service type**: a database as `LoadBalancer` exposes it to the internet.

---

## Takeaways

1. An orchestrator does **scheduling, scaling, networking, self-healing and service discovery**.
2. **Compose** is single-host; **Kubernetes** reconciles a declared **desired state** across a cluster.
3. Deployment → ReplicaSet → **Pod** → Container; a **Service** exposes Pods by **label**.
4. **ClusterIP** for internal services (Postgres), **LoadBalancer** for the entry point (gateway).
5. Configuration in **ConfigMaps**, credentials in **Secrets** (base64, not encryption).
6. `kubectl apply -f` + `kubectl get …` to deploy and verify; **HPA** to scale on CPU.
7. **Minikube** runs a single-node cluster locally; managed K8s (EKS, GKE) in the cloud.
