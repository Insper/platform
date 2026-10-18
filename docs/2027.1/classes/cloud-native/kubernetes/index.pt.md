O Docker Compose inicia o BoxOffice em uma máquina. A produção precisa de mais: quarenta containers espalhados por várias máquinas, um substituto iniciado em segundos quando um deles morre, uma nova versão publicada sem indisponibilidade e capacidade adicionada automaticamente quando a venda começa. Fazer isso à mão — SSH em um nó, `docker run`, atualizar o load balancer — não sobrevive à primeira noite de plantão. Um **orquestrador** faz isso por você, e o Kubernetes é o padrão de fato[^5].

O Kubernetes descende dos gerenciadores de cluster internos do Google, Borg e Omega; seus projetistas resumiram a lição de uma década executando containers em escala como *estado declarativo reconciliado por laços de controle independentes*[^1].

---

## O laço de controle: estado desejado vs estado real

Você nunca diz ao Kubernetes "inicie um container". Você diz "deve haver **cinco** réplicas de `catalog`, versão `1.4.0`, cada uma com 1 CPU" — o **estado desejado** — e o armazena no API server. Os controladores então rodam para sempre:

```
loop:
    desired = read spec from the API server
    actual  = observe the cluster
    if actual != desired:
        act to reduce the difference (create, delete, update)
```

``` mermaid-sim
sequenceDiagram
    participant U as kubectl / Argo CD
    participant API as API server (+ etcd)
    participant RS as Controlador do ReplicaSet
    participant S as Scheduler
    participant K as kubelet (nó 2)
    U->>API: aplica Deployment catalog, replicas = 5
    API->>RS: watch: desejado 5, real 4 (um nó morreu)
    RS->>API: cria o Pod catalog-7f9c
    API->>S: watch: pod sem nó
    S->>API: associa catalog-7f9c ao nó 2 (CPU livre suficiente)
    API->>K: watch: novo pod para este nó
    K->>K: baixa a imagem, inicia o container, executa as probes
    K->>API: status: Running, Ready
    Note over RS,API: real = desejado → nada a fazer
```

É por isso que o Kubernetes **se autorrecupera**: um processo que caiu, um pod apagado ou um nó morto aparecem todos como "real ≠ desejado", e o mesmo laço os corrige. É também por isso que a API é **declarativa e idempotente**: aplicar o mesmo manifest duas vezes não muda nada.

### As peças de um cluster

| Componente | Onde | Papel |
|---|---|---|
| **API server** | Control plane | O único ponto de entrada; valida e armazena objetos; todo o resto *observa* (watch) o API server |
| **etcd** | Control plane | Armazenamento chave-valor fortemente consistente (consenso Raft) com o estado do cluster |
| **Scheduler** | Control plane | Escolhe um nó para cada novo pod (recursos livres, afinidade, restrições de espalhamento) |
| **Controller manager** | Control plane | Executa os controladores (Deployment, ReplicaSet, Job, Node, HPA…) |
| **kubelet** | Todo nó | Inicia os containers do pod via runtime de containers (containerd), executa as probes, reporta o status |
| **kube-proxy / plugin CNI** | Todo nó | Implementa os IPs virtuais dos Services e a rede dos pods (iptables, IPVS ou eBPF, ex.: Cilium) |

Com um serviço gerenciado (EKS, GKE, AKS), o provedor executa e atualiza o control plane; você gerencia os nós — ou, com GKE Autopilot ou EKS no Fargate, nem eles.

---

## Os objetos centrais

| Objeto | O que é | Uso no BoxOffice |
|---|---|---|
| **Pod** | Um ou mais containers que compartilham rede e volumes; a unidade de escalonamento. Efêmero | Uma instância de `catalog` (às vezes com um sidecar) |
| **Deployment** | Mantém N pods idênticos rodando e publica novas versões (via ReplicaSets) | `catalog`, `inventory`, `order`, `gateway` |
| **Service** | Um IP virtual e um nome DNS estáveis na frente de um conjunto mutável de pods, selecionados por labels | `http://inventory:8080` sempre funciona, quaisquer que sejam os pods existentes |
| **Ingress / Gateway API** | Roteamento HTTP de fora do cluster para Services (host, caminho, TLS) | `api.boxoffice.example/catalog/**` → `catalog` |
| **ConfigMap / Secret** | Configuração e credenciais injetadas como variáveis de ambiente ou arquivos | URL do banco; senha do banco (de um gerenciador de segredos) |
| **StatefulSet** | Pods com identidade estável e volume persistente próprio | Kafka ou PostgreSQL *se* auto-hospedados |
| **Job / CronJob** | Trabalho que roda até terminar, uma vez ou em um agendamento | Liberar reservas expiradas a cada minuto; reconciliação noturna com o provedor de pagamento |
| **HorizontalPodAutoscaler** | Ajusta o número de réplicas de um Deployment a partir de métricas | `catalog` de 4 → 40 réplicas durante a venda |
| **PodDisruptionBudget** | Limita quantos pods disrupções voluntárias (drenagem de nós, upgrades) podem derrubar de uma vez | Nunca menos de 3 pods de `inventory` durante um upgrade de nó |

### O `catalog` do BoxOffice no Kubernetes

Os manifests abaixo são o coração do [Hands-on 10](../../../hands-on/10/index.md). Leia-os de cima para baixo; cada bloco responde a uma pergunta operacional.

```yaml title="k8s/catalog/deployment.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: catalog
  labels: { app: catalog }
spec:
  replicas: 4
  selector:
    matchLabels: { app: catalog }
  strategy:
    type: RollingUpdate
    rollingUpdate: { maxSurge: 25%, maxUnavailable: 0 }   # never below 4 ready pods
  template:
    metadata:
      labels: { app: catalog }
    spec:
      terminationGracePeriodSeconds: 30
      topologySpreadConstraints:                           # spread replicas across zones
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: ScheduleAnyway
          labelSelector: { matchLabels: { app: catalog } }
      containers:
        - name: catalog
          image: ghcr.io/boxoffice/catalog@sha256:9f2c0d7e1b4a   # digest, not a tag
          ports: [ { containerPort: 8080 } ]
          envFrom:
            - configMapRef: { name: catalog-config }
            - secretRef:    { name: catalog-db }
          resources:
            requests: { cpu: "500m", memory: "768Mi" }      # what the scheduler reserves
            limits:   { memory: "768Mi" }                   # hard ceiling (OOMKilled above)
          startupProbe:                                     # JVM warm-up: up to 60 s
            httpGet: { path: /actuator/health/liveness, port: 8080 }
            periodSeconds: 5
            failureThreshold: 12
          readinessProbe:                                   # receive traffic?
            httpGet: { path: /actuator/health/readiness, port: 8080 }
            periodSeconds: 5
            failureThreshold: 3
          livenessProbe:                                    # restart me?
            httpGet: { path: /actuator/health/liveness, port: 8080 }
            periodSeconds: 10
            failureThreshold: 3
          lifecycle:
            preStop: { sleep: { seconds: 5 } }              # let endpoints update before SIGTERM
```

```yaml title="k8s/catalog/service-hpa-pdb.yaml"
apiVersion: v1
kind: Service
metadata: { name: catalog }
spec:
  selector: { app: catalog }
  ports: [ { port: 8080, targetPort: 8080 } ]
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: catalog }
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: catalog }
  minReplicas: 4
  maxReplicas: 40
  metrics:
    - type: Resource
      resource:
        name: cpu
        target: { type: Utilization, averageUtilization: 60 }   # % of the CPU request
  behavior:
    scaleUp:   { stabilizationWindowSeconds: 0,   policies: [ { type: Percent, value: 100, periodSeconds: 15 } ] }
    scaleDown: { stabilizationWindowSeconds: 300, policies: [ { type: Pods,    value: 2,   periodSeconds: 60 } ] }
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata: { name: catalog }
spec:
  minAvailable: 3
  selector: { matchLabels: { app: catalog } }
```

```yaml title="k8s/edge/httproute.yaml"
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata: { name: boxoffice-api }
spec:
  parentRefs: [ { name: public-gateway } ]
  hostnames: [ "api.boxoffice.example" ]
  rules:
    - matches: [ { path: { type: PathPrefix, value: /catalog } } ]
      backendRefs: [ { name: catalog, port: 8080 } ]
    - matches: [ { path: { type: PathPrefix, value: /inventory } } ]
      backendRefs: [ { name: inventory, port: 8080 } ]
```

A **Gateway API** (`Gateway` + `HTTPRoute`) é a sucessora do antigo objeto `Ingress`: ela separa o dono da infraestrutura (quem opera o Gateway) dos times de aplicação (donos das rotas) e suporta nativamente backends com pesos[^3] — que é como os canaries dividem o tráfego (veja [Entrega](../delivery/index.md)). A [aula de Borda](../../edge/load-balancing/index.md) trata do componente [Ingress](../../../reference/components/edge/index.md#ingress).

---

## Probes: três perguntas diferentes { #probes }

| Probe | Pergunta | Em caso de falha | Erro comum |
|---|---|---|---|
| **Startup** | A aplicação terminou de iniciar? | Mantém as outras probes desativadas; após `failureThreshold`, reinicia o container | Sem ela → uma JVM lenta é morta pela liveness antes de terminar de iniciar |
| **Readiness** | Este pod deve receber tráfego *agora*? | Removido dos endpoints do Service (sem reinício) | Verificar dependências: quando o PostgreSQL pisca, *todos* os pods ficam não prontos e o serviço inteiro some |
| **Liveness** | O processo travou sem conserto? | Container reiniciado | Fazê-la depender do banco: uma queda do banco dispara tempestades de reinício que atrasam a recuperação |

Mantenha a liveness **local** (a JVM está respondendo?) e faça a readiness refletir apenas o que o próprio pod precisa para atender. O Spring Boot Actuator expõe `/actuator/health/liveness` e `/actuator/health/readiness` exatamente com essa semântica. A [aula de Observabilidade](../../observability/index.md) trata health checks como um componente da paleta ([Health Check](../../../reference/components/observability/index.md#healthcheck)).

---

## Requests, limits e qualidade de serviço

- **Request** — o que o scheduler *reserva* em um nó. Decide onde um pod cabe e é a base da porcentagem de utilização do HPA.
- **Limit** — o teto. Acima do limite de **memória**, o container é morto (`OOMKilled`); acima do limite de **CPU**, ele é **estrangulado** (*throttled*) — simplesmente espera, o que aparece como latência, não como erros.

| Classe de QoS | Regra | Despejado sob pressão no nó |
|---|---|---|
| **Guaranteed** | requests = limits para CPU e memória | Por último |
| **Burstable** | alguns requests definidos, menores que os limits | No meio |
| **BestEffort** | nada definido | Primeiro |

!!! warning "Limites de CPU e latência"

    Um serviço Java com limite de 1 CPU que mantém 4 threads (GC e requisições) ocupadas em paralelo num nó com vários núcleos pode consumir sua cota de 100 ms nos primeiros 25 ms de cada período de 100 ms e então ficar parado por 75 ms. O p99 cresce enquanto a CPU média parece normal. Observe a métrica do cgroup `nr_throttled` (exposta pelo cAdvisor como `container_cpu_cfs_throttled_periods_total`). Muitos times definem um **request** de CPU mas nenhum **limit** de CPU para serviços sensíveis à latência, e sempre definem um **limite de memória**. A [aula de Desempenho](../../performance/bottlenecks/index.md) mostra como identificar throttling em um teste de carga.

---

## Autoscaling em três níveis { #autoscaling }

``` mermaid-sim
flowchart LR
    load["k6 / fãs<br/>requisições por segundo ↑"] --> hpa["HPA<br/>mais pods"]
    hpa --> pend["Pods Pending<br/>(sem espaço nos nós)"]
    pend --> ca["Cluster Autoscaler / Karpenter<br/>mais nós"]
    ca --> run["Pods escalonados<br/>imagem baixada, JVM aquecida"]
    run --> ready["Ready → recebem tráfego"]
```

**1. Pods — Horizontal Pod Autoscaler (HPA).** A cada 15 s o HPA calcula[^2]

$$
\text{desejado} = \left\lceil \text{atual} \times \frac{\text{métrica atual}}{\text{métrica alvo}} \right\rceil
$$

Com 4 pods de `catalog` a 90 % de CPU (do request) e meta de 60 %: ⌈4 × 90/60⌉ = **6 pods**. Escalar por CPU funciona para serviços limitados por CPU; para serviços limitados por I/O, escale por **requisições por segundo por pod** ou pelo **atraso da fila** por meio de métricas customizadas/externas.

**2. Nós — Cluster Autoscaler ou Karpenter.** Quando pods ficam `Pending` porque nenhum nó tem espaço, um autoscaler de nós provisiona novas máquinas (o Karpenter escolhe tipos de instância por carga de trabalho e pode usar capacidade spot). Isso leva **minutos**: boot da VM, entrada do nó no cluster, download da imagem.

**3. Eventos — KEDA.** O Kubernetes Event-Driven Autoscaler escala a partir de fontes externas (atraso de consumidores Kafka, tamanho de filas, janelas de cron) e consegue escalar até zero — natural para os workers de `notification`[^4].

!!! example "BoxOffice: por que só o HPA não salva a venda"

    O HPA reage *depois* que a CPU sobe; o autoscaler de nós precisa de minutos; cada JVM precisa de ~20–40 s para iniciar e aquecer. Uma venda relâmpago vai de 5 % a 100 % do pico em segundos. Por isso o time **pré-escala** antes das 10:00 — um CronJob ou o scaler de cron do KEDA ajusta `minReplicas` para o pico esperado às 09:45 —, mantém uma reserva de nós livres (pods "balão" de baixa prioridade, despejados quando pods reais precisam de espaço) e coloca uma [sala de espera](../../messaging/queues-pubsub/index.md) na frente, para que a admissão, e não o autoscaling, controle a taxa. Os números de capacidade vêm da página de [Planejamento de capacidade](../../performance/capacity-planning/index.md).

Experimente: no cenário abaixo, rode o perfil `spike` com 2 réplicas e depois com 6. Observe a latência p99 e os erros enquanto as réplicas estão ocupadas; depois ative o autoscaling (se disponível) e observe o **atraso** entre o início do pico e o momento em que as novas réplicas ficam saudáveis.

<div class="sdp" data-scenario="scale-out" data-mode="compact" data-profile="spike" data-height="520"></div>

---

## Onde rodar Kubernetes

=== "AWS"

    **Amazon EKS** — control plane gerenciado (cobrado por hora de cluster), nós como node groups gerenciados de EC2, Karpenter ou Fargate. AWS Load Balancer Controller para Ingress/Gateway; IAM Roles for Service Accounts para credenciais dos pods.

=== "Google Cloud"

    **GKE** Standard (você gerencia os node pools) ou **Autopilot** (cobrado pelos requests de recursos dos pods; o Google gerencia os nós). A Gateway API é suportada nativamente.

=== "Azure"

    **AKS** — control plane gerenciado, node pools sobre VM scale sets, KEDA disponível como add-on, Azure Container Apps como alternativa serverless mais simples construída sobre Kubernetes.

=== "Local / código aberto"

    **kind** (Kubernetes in Docker) e **minikube** para os labs; **k3s** para clusters pequenos de borda ou de uma única VM. Mesma API — os manifests acima rodam sem alterações.

---

## Trade-offs

| Pergunta | Kubernetes | Alternativa mais simples (ECS, Cloud Run, PaaS) |
|---|---|---|
| Tamanho do time e número de serviços | Compensa com muitos serviços e times compartilhando ferramentas | Melhor para poucos serviços e um time pequeno |
| Portabilidade | Mesma API em qualquer nuvem e on-premises | Preso a um provedor |
| Ecossistema | Enorme: Argo CD, KEDA, operators, service mesh, motores de política | Menor, mas integrado |
| Carga operacional | Upgrades a cada poucos meses, add-ons, rede, políticas de segurança | A maior parte fica com o provedor |
| Custo fixo | Control plane + pods de sistema + capacidade ociosa nos nós | Perto de zero quando ocioso (escala a zero no Cloud Run) |

!!! tip "Na entrevista"

    Você raramente desenha Kubernetes em uma entrevista de system design — você desenha *réplicas de serviços sem estado atrás de um load balancer com autoscaling*. O Kubernetes é o detalhe de implementação que você menciona quando perguntam "como você faz o deploy e escala isso?". Bons sinais: distinguir **readiness de liveness**, saber que o **autoscaling tem atraso** (e pré-escalar para picos conhecidos), manter os **bancos de dados fora do cluster** ou em operators com cuidado e espalhar réplicas **entre zonas de disponibilidade**.

!!! warning "Armadilhas"

    - **Sem requests/limits**: o scheduler empacota pods às cegas e um pod barulhento sufoca os vizinhos.
    - **Liveness dependendo de serviços downstream**: uma piscada do banco reinicia a frota inteira.
    - **Sem PodDisruptionBudget**: um upgrade rotineiro de nó drena todos os pods de `inventory` de uma vez.
    - **Todas as réplicas em uma zona ou em um nó**: "redundância" que falha junto.
    - **HPA por CPU em um serviço limitado por I/O**: a CPU fica baixa enquanto a latência explode; escale por RPS ou atraso.
    - **`kubectl apply` a partir de notebooks** em produção: ninguém sabe o que está implantado — use GitOps ([Entrega](../delivery/index.md)).

## Como se conecta { #how-it-connects }

``` mermaid
flowchart LR
    ETCD["etcd: Raft<br/>→ Consenso (aula 3)"] --> DS["estado desejado<br/>no API server"]
    DS --> CL["laço de controle:<br/>real → desejado"]
    CL --> DEP["Deployment → pods"]
    DEP --> SVC["Service, Ingress, Gateway API<br/>→ Balanceamento de carga"]
    DEP --> PR["probes de startup,<br/>readiness, liveness"]
    PR --> HC["endpoints de saúde<br/>→ Confiabilidade, Observabilidade"]
    DEP --> RL["requests e limits,<br/>QoS, throttling de CPU"]
    RL --> HPA["HPA, autoscaler de nós,<br/>KEDA por lag"]
    HPA --> PRE["pré-escalar antes das 10:00<br/>→ Autoscaling em Compute"]
    RL --> COST["requests movem a fatura<br/>→ FinOps"]
    DEP --> PDB["PDB, espalhar por zonas<br/>→ redundância"]
```

**Componentes da paleta:** [`app`](../../../reference/components/compute/index.md#app) · [`worker`](../../../reference/components/compute/index.md#worker) (KEDA escala o `notification` pelo lag) · [`scheduler`](../../../reference/components/compute/index.md#scheduler) (CronJob libera reservas expiradas) · [`lb`](../../../reference/components/edge/index.md#lb) (um Service é um balanceador L4) · [`ingress`](../../../reference/components/edge/index.md#ingress) · [`healthcheck`](../../../reference/components/observability/index.md#healthcheck) · [`metrics`](../../../reference/components/observability/index.md#metrics) (o que o HPA lê). **Cenários:** `scale-out`, `flash-sale` (pré-escala). **Continua em:** [Tráfego e borda — balanceamento no Kubernetes](../../edge/load-balancing/index.md#kubernetes), [Distribuídos — consenso](../../distributed/consensus/index.md) (etcd), [Compute — atraso do autoscaling](../../compute/serverless-autoscaling/index.md#autoscaling-lag), [Confiabilidade — health checks](../../reliability/patterns/index.md#health-checks), [FinOps](../finops/index.md), [Exercício — autoscaling no Kubernetes](../../../exercises/kubernetes-autoscaling/index.md).

---

[^1]: BURNS, B.; GRANT, B.; OPPENHEIMER, D.; BREWER, E.; WILKES, J. [Borg, Omega, and Kubernetes](https://queue.acm.org/detail.cfm?id=2898444){target="_blank"}. *ACM Queue*, v. 14, n. 1, 2016.
[^2]: Documentação do Kubernetes. [Concepts](https://kubernetes.io/docs/concepts/){target="_blank"}; [Horizontal Pod Autoscaling](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/){target="_blank"}; [Configure liveness, readiness and startup probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/){target="_blank"}.
[^3]: Kubernetes SIG Network. [Gateway API](https://gateway-api.sigs.k8s.io/){target="_blank"}.
[^4]: KEDA. [Kubernetes Event-driven Autoscaling](https://keda.sh/){target="_blank"}; Karpenter. [Documentation](https://karpenter.sh/){target="_blank"}.
[^5]: BURNS, B.; BEDA, J.; HIGHTOWER, K.; EVENSON, L. *Kubernetes: Up and Running*. 3rd ed. O'Reilly, 2022.
