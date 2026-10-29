At 10:00 the BoxOffice catalog goes from a quiet morning to ten times its normal traffic in under a minute. Nobody can add servers that fast by hand — a **Horizontal Pod Autoscaler** can. But "automatic" is not "instant": metrics are sampled, decisions are periodic, new pods must start, warm up and pass their readiness probe. In this exercise you deploy a service on Kubernetes, put it under a k6 ramp, and **measure how fast and how well it scales** — and what breaks while it does.

!!! abstract "Learning objectives"

    After this exercise you will be able to:

    - **Configure** a production-shaped Deployment: requests/limits, startup/readiness/liveness probes, graceful shutdown, Service, Ingress.
    - **Configure** an HPA (`autoscaling/v2`) with a CPU target and scaling behavior.
    - **Predict** the number of replicas with the HPA formula and **measure** the actual scaling timeline under load.
    - **Decompose** the scaling lag (metrics window, sync period, pod start-up, JVM warm-up, readiness).
    - **Prove** a zero-downtime rolling update under load, and **find** the next bottleneck (connections to the database).

## Context

[Class 11](../../classes/cloud-native/index.md) covered containers, Kubernetes objects, probes and autoscaling; [Class 5](../../classes/compute/index.md) the theory of autoscaling (target tracking, warm-up, predictive). [Lab 10](../../hands-on/10/index.md) deployed BoxOffice to kind or minikube with an Ingress. This exercise turns that deployment into an **experiment**.

The HPA controller computes, every sync period (15 s by default)[^1]:

$$
\text{desiredReplicas} = \left\lceil \text{currentReplicas} \times \frac{\text{currentMetricValue}}{\text{targetMetricValue}} \right\rceil
$$

For CPU, the metric is the **average utilization relative to the pod's CPU request**. If 2 pods run at 150% of their request and the target is 60%, the HPA asks for `⌈2 × 150 / 60⌉ = 5` pods.

``` diagram-sim
sequenceDiagram
    participant K as k6 (load ramp)
    participant P as catalog pods
    participant M as metrics-server
    participant H as HPA controller
    participant D as Deployment
    K->>P: requests per second grow
    M->>P: scrape CPU (every ~15 s)
    H->>M: read average utilization
    H->>D: replicas = ceil(current × util / target)
    D->>P: create pods
    P-->>P: start JVM, startup probe, warm-up
    P-->>H: readiness OK: pods receive traffic, utilization drops
```

## Task

1. Deploy the BoxOffice `catalog` (or your own service) and PostgreSQL on **kind or minikube** with the manifests below (adapted): requests/limits, three probes, graceful shutdown, Service, Ingress and an **HPA** (min 2, max 10, CPU target 60%).
2. **E1 — Scale-up timeline:** run a k6 ramp from a low rate to a rate that needs ~3× the minimum replicas; record replicas, CPU utilization, p99 and errors **over time**; then watch it scale down.
3. **E2 — One variable:** repeat E1 changing **one** thing: no readiness probe, a different CPU request, or a different scale-up policy. Compare.
4. **E3 — Rolling update under load:** `kubectl rollout restart` during steady load, with **zero failed requests**.
5. Compute the **database connection budget** at maximum scale and say what breaks first.

## Requirements

- [ ] **(mandatory)** Deployment with CPU/memory **requests and limits**, **startup, readiness and liveness** probes and graceful shutdown; Service; Ingress; HPA `autoscaling/v2` with `behavior`.
- [ ] **(mandatory)** A **time series** (CSV committed) of desired/current/ready replicas and CPU utilization, every ≤ 5 s, aligned with k6 latency and errors.
- [ ] **(mandatory)** A chart of replicas and p99 over time for E1, with the load ramp marked.
- [ ] HPA scales from 2 to **≥ 4** replicas during E1 and back down after the stabilization window.
- [ ] The **predicted** steady-state replicas (formula, with your measured CPU per request) vs the **observed** ones — within ±1 replica, or the difference explained.
- [ ] The **scaling lag** decomposed: load step → utilization above target → HPA decision → pod scheduled → pod ready.
- [ ] E2 compared with E1 (same load, one change), with a conclusion.
- [ ] E3: **0 failed requests** during a rolling restart at a steady rate (k6 summary).
- [ ] Connection budget: `maxReplicas × pool size` vs PostgreSQL `max_connections`, and the fix you would apply.
- [ ] A video of **at most 3 minutes** showing E1 (k6 running, `kubectl get hpa -w`, pods appearing).
- [ ] *AI usage* section (see the [policy](../index.md#use-of-ai-tools)).

## Deliverables

In your repository (tag `ex5`): `k8s/` manifests, k6 scripts, the recording script, CSVs and charts in `k8s/results/`, the video (or a link to it); a `kubernetes-autoscaling` page on your documentation site following the [template](#templates).

## Step by step

### 1. Cluster and metrics-server

The HPA needs resource metrics, served by **metrics-server**.

=== "minikube"

    ```bash
    minikube start --cpus=4 --memory=8g
    minikube addons enable metrics-server
    minikube addons enable ingress
    minikube image load boxoffice/catalog:latest
    ```

=== "kind"

    ```bash
    kind create cluster --config kind.yaml   # with extraPortMappings for the Ingress, as in Lab 10
    kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
    # kind's kubelets use self-signed certificates
    kubectl patch -n kube-system deployment metrics-server --type=json \
      -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
    kind load docker-image boxoffice/catalog:latest
    ```

Check with `kubectl top pods -A` (it takes about a minute after start-up). PostgreSQL comes from Lab 10 (Secret, PVC, Deployment and Service `postgres`).

### 2. The Deployment

```yaml title="k8s/catalog.yaml"
apiVersion: v1
kind: ConfigMap
metadata:
  name: catalog
data:
  SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/catalog
  SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE: "10"
  SERVER_SHUTDOWN: graceful
  SPRING_LIFECYCLE_TIMEOUT_PER_SHUTDOWN_PHASE: 20s
  MANAGEMENT_ENDPOINT_HEALTH_PROBES_ENABLED: "true"
  JAVA_TOOL_OPTIONS: -XX:MaxRAMPercentage=75
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: catalog
spec:
  replicas: 2
  selector:
    matchLabels:
      app: catalog
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: catalog
    spec:
      terminationGracePeriodSeconds: 30
      containers:
        - name: catalog
          image: boxoffice/catalog:latest
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 8080
          envFrom:
            - configMapRef:
                name: catalog
            - secretRef:
                name: catalog-db   # SPRING_DATASOURCE_USERNAME / SPRING_DATASOURCE_PASSWORD
          resources:
            requests:
              cpu: 500m
              memory: 512Mi
            limits:
              cpu: "1"
              memory: 768Mi
          startupProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            periodSeconds: 2
            failureThreshold: 60   # up to 120 s to start
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8080
            periodSeconds: 5
            failureThreshold: 2
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            periodSeconds: 10
            failureThreshold: 3
          lifecycle:
            preStop:
              sleep:
                seconds: 5   # let the endpoints update before shutdown (Kubernetes >= 1.30)
---
apiVersion: v1
kind: Service
metadata:
  name: catalog
spec:
  selector:
    app: catalog
  ports:
    - port: 8080
      targetPort: 8080
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: catalog
spec:
  ingressClassName: nginx
  rules:
    - http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: catalog
                port:
                  number: 8080
```

Why each block matters[^2]:

| Block | What goes wrong without it |
|-|-|
| `requests.cpu` | The HPA cannot compute utilization (it is relative to the request); the scheduler overcommits nodes |
| `limits.memory` + `MaxRAMPercentage` | The JVM sizes its heap for the node, not the container, and gets OOM-killed |
| `startupProbe` | A slow JVM start is killed by the liveness probe before it is up (restart loop) |
| `readinessProbe` | New pods receive traffic before they can serve it: errors exactly when you scale up |
| `preStop` + graceful shutdown + `maxUnavailable: 0` | In-flight requests fail on every deploy and every scale-down |

### 3. The HPA

```yaml title="k8s/catalog-hpa.yaml"
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: catalog
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: catalog
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Percent
          value: 100        # at most double the replicas...
          periodSeconds: 30 # ...every 30 s
    scaleDown:
      stabilizationWindowSeconds: 120
      policies:
        - type: Pods
          value: 1
          periodSeconds: 30
```

```bash
kubectl apply -f k8s/catalog.yaml -f k8s/catalog-hpa.yaml
kubectl get hpa catalog -w
```

### 4. Record the timeline

```bash title="k8s/record.sh"
#!/usr/bin/env bash
# usage: ./k8s/record.sh k8s/results/e1-hpa.csv   (stop with Ctrl+C)
OUT=${1:-k8s/results/hpa.csv}
mkdir -p "$(dirname "$OUT")"
echo "ts,desired,current,ready,cpu_util" > "$OUT"
while true; do
  H=$(kubectl get hpa catalog -o jsonpath='{.status.desiredReplicas},{.status.currentReplicas},{.status.currentMetrics[0].resource.current.averageUtilization}')
  R=$(kubectl get deployment catalog -o jsonpath='{.status.readyReplicas}')
  IFS=, read -r DESIRED CURRENT CPU <<< "$H"
  echo "$(date +%s),${DESIRED},${CURRENT},${R:-0},${CPU}" >> "$OUT"
  sleep 5
done
```

### 5. The load

Measure the CPU cost of one request first (a short constant rate with 2 replicas: CPU used ÷ requests per second) so that you can **predict** the replicas before running E1.

```javascript title="load/hpa-ramp.js"
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost';
const PEAK = Number(__ENV.PEAK || 600); // req/s at the top of the ramp

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-arrival-rate', startRate: Math.round(PEAK * 0.1), timeUnit: '1s',
      preAllocatedVUs: 100, maxVUs: 1000,
      stages: [
        { target: Math.round(PEAK * 0.1), duration: '1m' }, // quiet morning
        { target: PEAK, duration: '1m' },                   // 10:00, the on-sale starts
        { target: PEAK, duration: '6m' },                   // sustained peak
        { target: Math.round(PEAK * 0.1), duration: '1m' },
        { target: Math.round(PEAK * 0.1), duration: '4m' }, // watch the scale-down
      ],
    },
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const id = 1 + Math.floor(Math.random() * 1000);
  const res = http.get(`${BASE}/events/${id}`, { tags: { name: 'GET /events/{id}' } });
  check(res, { 'status is 200': (r) => r.status === 200 });
}
```

```bash
./k8s/record.sh k8s/results/e1-hpa.csv &
k6 run -e BASE_URL=http://localhost -e PEAK=600 --out csv=k8s/results/e1-k6.csv load/hpa-ramp.js
kill %1
```

!!! warning "Do not load test through `kubectl port-forward`"

    `port-forward` is a debugging tunnel through the API server; it becomes the bottleneck long before your pods do. Use the Ingress (Lab 10). If your local networking does not allow it, run k6 **inside** the cluster as a Job (below).

??? example "k6 as a Job inside the cluster"

    ```yaml title="k8s/k6-job.yaml"
    apiVersion: batch/v1
    kind: Job
    metadata:
      name: k6-ramp
    spec:
      backoffLimit: 0
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: k6
              image: grafana/k6:latest
              args: ["run", "--quiet", "--no-summary", "--out", "csv=/dev/stdout",
                     "-e", "BASE_URL=http://catalog:8080", "-e", "PEAK=600", "/scripts/hpa-ramp.js"]
              volumeMounts:
                - name: scripts
                  mountPath: /scripts
          volumes:
            - name: scripts
              configMap:
                name: k6-scripts
    ```

    ```bash
    kubectl create configmap k6-scripts --from-file=load/hpa-ramp.js
    kubectl apply -f k8s/k6-job.yaml
    kubectl wait --for=condition=complete job/k6-ramp --timeout=20m
    kubectl logs job/k6-ramp > k8s/results/e1-k6.csv
    ```

    k6 then shares the cluster's CPU with your pods — say so in the report.

### 6. Plot replicas and latency together

```python title="k8s/plot_hpa.py"
import csv
import sys
from collections import defaultdict

import matplotlib.pyplot as plt

# usage: python k8s/plot_hpa.py k8s/results/e1-hpa.csv k8s/results/e1-k6.csv k8s/results/e1.png
hpa_file, k6_file, out = sys.argv[1:4]

hpa = list(csv.DictReader(open(hpa_file)))
t0 = int(hpa[0]["ts"])
t = [int(r["ts"]) - t0 for r in hpa]

lat, err = defaultdict(list), defaultdict(lambda: [0, 0])
for row in csv.DictReader(open(k6_file)):
    if row.get("metric_name") == "http_req_duration":
        lat[int(float(row["timestamp"])) // 10 * 10].append(float(row["metric_value"]))
    elif row.get("metric_name") == "http_req_failed":
        bucket = err[int(float(row["timestamp"])) // 10 * 10]
        bucket[0] += float(row["metric_value"])
        bucket[1] += 1


def p99(values):
    values = sorted(values)
    return values[int(0.99 * (len(values) - 1))]


windows = sorted(lat)
fig, ax1 = plt.subplots(figsize=(10, 4))
ax1.step(t, [int(r["desired"] or 0) for r in hpa], where="post", label="desired")
ax1.step(t, [int(r["ready"] or 0) for r in hpa], where="post", label="ready")
ax1.set_xlabel("time (s)")
ax1.set_ylabel("replicas")
ax2 = ax1.twinx()
ax2.plot([w - t0 for w in windows], [p99(lat[w]) for w in windows], color="tab:red", label="p99 (10 s)")
ax2.set_ylabel("p99 (ms)")
fig.legend(loc="upper right")
fig.tight_layout()
fig.savefig(out, dpi=150)
print("error rate per window:", {w - t0: round(e[0] / e[1], 4) for w, e in sorted(err.items()) if e[1]})
```

### 7. Rolling update under load (E3)

Run a constant rate at about half of what the minimum replicas sustain, and restart the Deployment in the middle:

```bash
k6 run -e BASE_URL=http://localhost -e PEAK=150 load/hpa-ramp.js &
sleep 120 && kubectl rollout restart deployment/catalog && kubectl rollout status deployment/catalog
wait
```

The k6 summary must show `http_req_failed` = 0. If it does not, find which piece is missing: readiness, `preStop`, graceful shutdown, `maxUnavailable: 0`.

### 8. The next bottleneck

Each replica has its own connection pool. At `maxReplicas: 10` with a pool of 10, that is **100 connections** — exactly PostgreSQL's default `max_connections`, with nothing left for migrations, admin or a second service. The autoscaler can make things *worse* by scaling the stateless tier into a database that cannot follow. Compute your budget and propose a fix (smaller pools, PgBouncer, a `maxReplicas` derived from the database, read replicas, a cache).

## Templates

=== "English"

    ~~~markdown
    # Kubernetes autoscaling — <service>

    ## 1. Cluster and manifests
    kind/minikube version, nodes, CPU/RAM; links to the manifests; table of requests/limits, probes, HPA settings.

    ## 2. Prediction
    CPU per request: ... millicores (measured at ... req/s with 2 replicas).
    At ... req/s: total CPU = ...; replicas = ceil(total / (request × 0.60)) = ...

    ## 3. E1 — scale-up timeline
    Chart: replicas (desired, ready) and p99 over time, load ramp marked.
    | Event | Time (s) |
    |-|-|
    | Load reaches the peak | |
    | Utilization above target | |
    | HPA raises desired replicas | |
    | First new pod ready | |
    | Steady state (replicas, p99) | |
    | Scale-down finished | |
    Observed replicas at steady state ... vs predicted ...; errors during scale-up ...

    ## 4. E2 — one change
    Change: ... · Result compared with E1: ... · Conclusion: ...

    ## 5. E3 — rolling update under load
    Rate ...; failed requests: ... (k6 summary).

    ## 6. Connection budget
    maxReplicas × pool = ... vs max_connections = ...; fix: ...

    ## 7. Video
    Link (≤ 3 min).

    ## 8. AI usage
    ~~~

=== "Português"

    ~~~markdown
    # Autoscaling no Kubernetes — <serviço>

    ## 1. Cluster e manifestos
    Versão do kind/minikube, nós, CPU/RAM; links para os manifestos; tabela de requests/limits, probes, configuração do HPA.

    ## 2. Previsão
    CPU por requisição: ... milicores (medido a ... req/s com 2 réplicas).
    A ... req/s: CPU total = ...; réplicas = ceil(total / (request × 0,60)) = ...

    ## 3. E1 — linha do tempo da escalada
    Gráfico: réplicas (desejadas, prontas) e p99 ao longo do tempo, rampa de carga marcada.
    | Evento | Tempo (s) |
    |-|-|
    | Carga atinge o pico | |
    | Utilização acima da meta | |
    | HPA aumenta as réplicas desejadas | |
    | Primeiro pod novo pronto | |
    | Regime (réplicas, p99) | |
    | Fim da redução | |
    Réplicas observadas em regime ... vs previstas ...; erros durante a escalada ...

    ## 4. E2 — uma mudança
    Mudança: ... · Resultado comparado com o E1: ... · Conclusão: ...

    ## 5. E3 — atualização gradual sob carga
    Taxa ...; requisições com falha: ... (resumo do k6).

    ## 6. Orçamento de conexões
    maxReplicas × pool = ... vs max_connections = ...; correção: ...

    ## 7. Vídeo
    Link (≤ 3 min).

    ## 8. Uso de IA
    ~~~

## Rubric

Levels as defined in [How the exercises are graded](../index.md#how-the-exercises-are-graded).

| Criterion | I | D | C | B | A |
|-|-|-|-|-|-|
| Manifests **(mandatory)** | Do not apply | Requests/limits or a probe missing | Requests/limits, 3 probes, graceful shutdown, Service, Ingress, HPA v2 with behavior | Each setting justified (table) | JVM memory, probes and timeouts tuned from measurements |
| Timeline data **(mandatory)** | No data | Screenshots only | CSV time series + chart of replicas and p99 | Lag decomposed into its phases with timestamps | Lag reduced by a change and the reduction measured |
| Prediction | — | None | Formula applied | Within ±1 replica or difference explained | CPU per request measured at several rates (linearity checked) |
| E2 comparison | — | Not done | Done with the same load | Clear conclusion with numbers | Second variable or a custom metric (e.g. requests per second, KEDA) |
| Zero-downtime update | — | Errors not investigated | 0 failed requests | Explains which setting prevents which failure | Shows the failure without one setting and with it |
| Next bottleneck and communication | — | Missing | Connection budget computed | Fix proposed and argued | Fix implemented and tested at max scale; video crisp |

## FAQ

??? question "`kubectl get hpa` shows `<unknown>/60%`."

    metrics-server is not running or not ready yet (wait a minute after start-up; on kind, check the `--kubelet-insecure-tls` patch), or the pods have no CPU **request** — utilization is relative to the request.

??? question "The HPA does not scale even with high load."

    Check the actual CPU of the pods (`kubectl top pods`): if the bottleneck is the database or the connection pool, CPU stays low and the HPA has no reason to scale. That is a valid — and important — finding. Say what metric would have scaled correctly.

??? question "Pods scale up but errors appear exactly at that moment."

    Usually a missing or too permissive readiness probe (traffic before the app is ready) or a cold JVM (the first requests are slow). Compare with E2, and consider a warm-up step before the readiness probe passes.

??? question "Scale-down takes forever."

    By design: the default scale-down stabilization window is 5 minutes, to avoid flapping. The manifest above shortens it to 2 minutes for the experiment. Discuss the trade-off for BoxOffice (an on-sale may have a second wave).

??? question "My laptop cannot generate enough load to need 4 replicas."

    Lower the CPU request (e.g. 250m) so that each pod saturates sooner, or make each request more expensive (a heavier endpoint). Explain the choice; the goal is to observe the mechanism, not a big number.

??? question "Can I use a cloud cluster instead?"

    Yes (EKS, GKE, AKS), if you watch the costs and delete it afterwards. The manifests are the same; the Ingress class and the metrics-server setup may differ.

[^1]: Kubernetes documentation, "Horizontal Pod Autoscaling — Algorithm details", [kubernetes.io](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/#algorithm-details){target="_blank"}.
[^2]: Kubernetes documentation, "Configure Liveness, Readiness and Startup Probes", [kubernetes.io](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/){target="_blank"}.
