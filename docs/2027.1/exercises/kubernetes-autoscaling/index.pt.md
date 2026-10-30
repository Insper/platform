Às 10:00 o catálogo da BoxOffice passa de uma manhã tranquila a dez vezes o tráfego normal em menos de um minuto. Ninguém consegue acrescentar servidores tão rápido à mão — um **Horizontal Pod Autoscaler** consegue. Mas "automático" não é "instantâneo": as métricas são amostradas, as decisões são periódicas, os pods novos precisam subir, aquecer e passar na readiness probe. Neste exercício você implanta um serviço no Kubernetes, aplica uma rampa de carga com k6 e **mede quão rápido e quão bem ele escala** — e o que quebra enquanto isso.

!!! abstract "Objetivos de aprendizagem"

    Ao final deste exercício você será capaz de:

    - **Configurar** um Deployment com cara de produção: requests/limits, probes de startup/readiness/liveness, desligamento gracioso, Service, Ingress.
    - **Configurar** um HPA (`autoscaling/v2`) com meta de CPU e comportamento de escala.
    - **Prever** o número de réplicas com a fórmula do HPA e **medir** a linha do tempo real da escalada sob carga.
    - **Decompor** o atraso da escalada (janela de métricas, período de sincronização, subida do pod, aquecimento da JVM, readiness).
    - **Provar** uma atualização gradual sem indisponibilidade sob carga, e **encontrar** o próximo gargalo (conexões com o banco).

## Contexto { #context }

A [Aula 11](../../classes/cloud-native/index.md) tratou de contêineres, objetos do Kubernetes, probes e autoscaling; a [Aula 5](../../classes/compute/index.md), da teoria de autoscaling (target tracking, aquecimento, preditivo). O [Lab 10](../../hands-on/10/index.md) implantou a BoxOffice no kind ou no minikube com um Ingress. Este exercício transforma essa implantação em um **experimento**.

O controlador do HPA calcula, a cada período de sincronização (15 s por padrão)[^1]:

$$
\text{desiredReplicas} = \left\lceil \text{currentReplicas} \times \frac{\text{currentMetricValue}}{\text{targetMetricValue}} \right\rceil
$$

Para CPU, a métrica é a **utilização média relativa ao request de CPU do pod**. Se 2 pods rodam a 150% do request e a meta é 60%, o HPA pede `⌈2 × 150 / 60⌉ = 5` pods.

``` diagram-sim
sequenceDiagram
    participant K as k6 (rampa de carga)
    participant P as pods do catalog
    participant M as metrics-server
    participant H as controlador do HPA
    participant D as Deployment
    K->>P: requisições por segundo crescem
    M->>P: coleta CPU (a cada ~15 s)
    H->>M: lê a utilização média
    H->>D: réplicas = ceil(atual × util / meta)
    D->>P: cria pods
    P-->>P: sobe a JVM, startup probe, aquecimento
    P-->>H: readiness OK: pods recebem tráfego, a utilização cai
```

## Tarefa { #task }

1. Implante o `catalog` da BoxOffice (ou o seu próprio serviço) e o PostgreSQL no **kind ou minikube** com os manifestos abaixo (adaptados): requests/limits, três probes, desligamento gracioso, Service, Ingress e um **HPA** (mín 2, máx 10, meta de CPU de 60%).
2. **E1 — Linha do tempo da escalada:** execute uma rampa k6 de uma taxa baixa até uma taxa que exija ~3× as réplicas mínimas; registre réplicas, utilização de CPU, p99 e erros **ao longo do tempo**; depois observe a redução.
3. **E2 — Uma variável:** repita o E1 mudando **uma** coisa: sem readiness probe, outro request de CPU ou outra política de escalada. Compare.
4. **E3 — Atualização gradual sob carga:** `kubectl rollout restart` durante uma carga estável, com **zero requisições com falha**.
5. Calcule o **orçamento de conexões com o banco** na escala máxima e diga o que quebra primeiro.

## Requisitos { #requirements }

- [ ] **(obrigatório)** Deployment com **requests e limits** de CPU/memória, probes de **startup, readiness e liveness** e desligamento gracioso; Service; Ingress; HPA `autoscaling/v2` com `behavior`.
- [ ] **(obrigatório)** Uma **série temporal** (CSV versionado) de réplicas desejadas/atuais/prontas e utilização de CPU, a cada ≤ 5 s, alinhada com a latência e os erros do k6.
- [ ] **(obrigatório)** Um gráfico de réplicas e p99 ao longo do tempo para o E1, com a rampa de carga marcada.
- [ ] O HPA escala de 2 para **≥ 4** réplicas durante o E1 e volta depois da janela de estabilização.
- [ ] As réplicas **previstas** em regime (fórmula, com a sua CPU medida por requisição) vs as **observadas** — dentro de ±1 réplica, ou a diferença explicada.
- [ ] O **atraso da escalada** decomposto: degrau de carga → utilização acima da meta → decisão do HPA → pod agendado → pod pronto.
- [ ] E2 comparado com o E1 (mesma carga, uma mudança), com uma conclusão.
- [ ] E3: **0 requisições com falha** durante um rollout restart a uma taxa estável (resumo do k6).
- [ ] Orçamento de conexões: `maxReplicas × tamanho do pool` vs `max_connections` do PostgreSQL, e a correção que você aplicaria.
- [ ] Um vídeo de **no máximo 3 minutos** mostrando o E1 (k6 rodando, `kubectl get hpa -w`, pods aparecendo).
- [ ] Seção *Uso de IA* (veja a [política](../index.md#use-of-ai-tools)).

## Entregáveis { #deliverables }

No seu repositório (tag `ex5`): manifestos em `k8s/`, scripts k6, o script de registro, CSVs e gráficos em `k8s/results/`, o vídeo (ou um link para ele); uma página `kubernetes-autoscaling` no site da sua documentação seguindo o [template](#templates).

## Passo a passo { #step-by-step }

### 1. Cluster e metrics-server { #1-cluster-and-metrics-server }

O HPA precisa de métricas de recursos, servidas pelo **metrics-server**.

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

Confira com `kubectl top pods -A` (leva cerca de um minuto depois de subir). O PostgreSQL vem do Lab 10 (Secret, PVC, Deployment e Service `postgres`).

### 2. O Deployment { #2-the-deployment }

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

Por que cada bloco importa[^2]:

| Bloco | O que dá errado sem ele |
|-|-|
| `requests.cpu` | O HPA não consegue calcular a utilização (ela é relativa ao request); o escalonador sobrecarrega os nós |
| `limits.memory` + `MaxRAMPercentage` | A JVM dimensiona o heap pelo nó, não pelo contêiner, e é morta por OOM |
| `startupProbe` | Uma JVM que demora a subir é morta pela liveness probe antes de ficar pronta (loop de reinícios) |
| `readinessProbe` | Pods novos recebem tráfego antes de conseguir atendê-lo: erros justamente quando você escala |
| `preStop` + desligamento gracioso + `maxUnavailable: 0` | Requisições em andamento falham a cada deploy e a cada redução |

### 3. O HPA { #3-the-hpa }

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

### 4. Registre a linha do tempo { #4-record-the-timeline }

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

### 5. A carga { #5-the-load }

Meça primeiro o custo de CPU de uma requisição (uma taxa constante curta com 2 réplicas: CPU usada ÷ requisições por segundo) para conseguir **prever** as réplicas antes de executar o E1.

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

!!! warning "Não faça teste de carga por `kubectl port-forward`"

    O `port-forward` é um túnel de depuração que passa pelo API server; ele vira o gargalo muito antes dos seus pods. Use o Ingress (Lab 10). Se a sua rede local não permitir, execute o k6 **dentro** do cluster como um Job (abaixo).

??? example "k6 como Job dentro do cluster"

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

    O k6 passa então a dividir a CPU do cluster com os seus pods — diga isso no relatório.

### 6. Plote réplicas e latência juntas { #6-plot-replicas-and-latency-together }

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

### 7. Atualização gradual sob carga (E3) { #7-rolling-update-under-load-e3 }

Execute uma taxa constante de cerca de metade do que as réplicas mínimas sustentam e reinicie o Deployment no meio:

```bash
k6 run -e BASE_URL=http://localhost -e PEAK=150 load/hpa-ramp.js &
sleep 120 && kubectl rollout restart deployment/catalog && kubectl rollout status deployment/catalog
wait
```

O resumo do k6 precisa mostrar `http_req_failed` = 0. Se não mostrar, descubra qual peça falta: readiness, `preStop`, desligamento gracioso, `maxUnavailable: 0`.

### 8. O próximo gargalo { #8-the-next-bottleneck }

Cada réplica tem o seu próprio pool de conexões. Com `maxReplicas: 10` e um pool de 10, são **100 conexões** — exatamente o `max_connections` padrão do PostgreSQL, sem sobrar nada para migrações, administração ou um segundo serviço. O autoscaler pode *piorar* as coisas ao escalar a camada sem estado contra um banco que não consegue acompanhar. Calcule o seu orçamento e proponha uma correção (pools menores, PgBouncer, um `maxReplicas` derivado do banco, réplicas de leitura, um cache).

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

## Rubrica { #rubric }

Níveis conforme definidos em [Como os exercícios são avaliados](../index.md#how-the-exercises-are-graded).

| Critério | I | D | C | B | A |
|-|-|-|-|-|-|
| Manifestos **(obrigatório)** | Não aplicam | Falta requests/limits ou uma probe | Requests/limits, 3 probes, desligamento gracioso, Service, Ingress, HPA v2 com behavior | Cada configuração justificada (tabela) | Memória da JVM, probes e timeouts ajustados a partir de medições |
| Dados da linha do tempo **(obrigatório)** | Sem dados | Só capturas de tela | Série temporal em CSV + gráfico de réplicas e p99 | Atraso decomposto em fases com instantes | Atraso reduzido por uma mudança e a redução medida |
| Previsão | — | Nenhuma | Fórmula aplicada | Dentro de ±1 réplica ou diferença explicada | CPU por requisição medida em várias taxas (linearidade conferida) |
| Comparação do E2 | — | Não feita | Feita com a mesma carga | Conclusão clara com números | Segunda variável ou métrica customizada (por exemplo, requisições por segundo, KEDA) |
| Atualização sem indisponibilidade | — | Erros não investigados | 0 requisições com falha | Explica qual configuração evita qual falha | Mostra a falha sem uma configuração e com ela |
| Próximo gargalo e comunicação | — | Ausente | Orçamento de conexões calculado | Correção proposta e argumentada | Correção implementada e testada na escala máxima; vídeo objetivo |

## FAQ

??? question "`kubectl get hpa` mostra `<unknown>/60%`."

    O metrics-server não está rodando ou ainda não está pronto (espere um minuto depois de subir; no kind, confira o patch `--kubelet-insecure-tls`), ou os pods não têm **request** de CPU — a utilização é relativa ao request.

??? question "O HPA não escala mesmo com carga alta."

    Veja a CPU real dos pods (`kubectl top pods`): se o gargalo é o banco ou o pool de conexões, a CPU fica baixa e o HPA não tem motivo para escalar. Essa é uma constatação válida — e importante. Diga que métrica teria escalado corretamente.

??? question "Os pods escalam, mas aparecem erros exatamente nesse momento."

    Geralmente é uma readiness probe ausente ou permissiva demais (tráfego antes de a aplicação estar pronta) ou uma JVM fria (as primeiras requisições são lentas). Compare com o E2 e considere uma etapa de aquecimento antes de a readiness probe passar.

??? question "A redução demora uma eternidade."

    Por projeto: a janela de estabilização padrão da redução é de 5 minutos, para evitar oscilações. O manifesto acima a encurta para 2 minutos no experimento. Discuta o trade-off para a BoxOffice (uma venda pode ter uma segunda onda).

??? question "Meu notebook não gera carga suficiente para precisar de 4 réplicas."

    Diminua o request de CPU (por exemplo, 250m) para que cada pod sature antes, ou torne cada requisição mais cara (um endpoint mais pesado). Explique a escolha; o objetivo é observar o mecanismo, não um número grande.

??? question "Posso usar um cluster na nuvem?"

    Sim (EKS, GKE, AKS), desde que acompanhe os custos e apague tudo depois. Os manifestos são os mesmos; a classe do Ingress e a configuração do metrics-server podem mudar.

[^1]: Documentação do Kubernetes, "Horizontal Pod Autoscaling — Algorithm details", [kubernetes.io](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/#algorithm-details){target="_blank"}.
[^2]: Documentação do Kubernetes, "Configure Liveness, Readiness and Startup Probes", [kubernetes.io](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/){target="_blank"}.
