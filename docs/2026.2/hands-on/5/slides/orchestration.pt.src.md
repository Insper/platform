---
marp: true
lang: pt-BR
title: Hands-on 5 — Orquestração
description: Plataformas, Microsserviços, DevOps e APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Plataformas, Microsserviços, DevOps e APIs · Hands-on 5</div>

# Hands-on 5 — Orquestração

**Declare o estado desejado; o Kubernetes mantém o cluster nele**

<!--
Roteiro: (1) o que um orquestrador faz; (2) Compose × Kubernetes e as alternativas; (3) Deployment,
ReplicaSet, Pod, Service, ConfigMap, Secret; (4) manifestos do Postgres e do gateway; (5) HPA, kubectl,
Minikube.
-->

---

## Além de uma máquina

<div class="q">

A loja roda bem com `docker compose up`. O que acontece quando um container **morre às 3 da manhã**, o tráfego **triplica** ou um hospedeiro **não dá conta**?

</div>

* **Escalonamento** — posicionar os containers nos servidores adequados.
* **Escala** — adicionar ou remover containers conforme a demanda.
* **Rede** e **descoberta de serviços** — os containers se encontram.
* **Autorrecuperação** — reiniciar containers com falha, redistribuir workloads.

<!--
Essas cinco tarefas são a definição de um orquestrador. O Kubernetes é o mais adotado;
Docker Swarm e Apache Mesos são outros.
-->

---

## Docker Compose × Kubernetes

| Aspecto | Docker Compose | Kubernetes |
|---|---|---|
| **Escopo** | um único hospedeiro | cluster com vários hospedeiros |
| **Configuração** | YAML: serviços, redes, volumes | YAML declarativo: **estado desejado** + controllers |
| **Escalabilidade** | sem escala automática | escala automática dinâmica |
| **Recursos** | políticas básicas de reinício | balanceamento de carga, rolling updates, autorrecuperação |
| **Complexidade** | simples, curva de aprendizado baixa | mais íngreme: pods, services, deployments |
| **Caso de uso** | dev local, testes, produção pequena | produção em grande escala |

<p class="small">O <strong>Kompose</strong> ajuda a migrar um arquivo do Compose para manifestos do Kubernetes.</p>

---

## Alternativas ao Kubernetes

| Ambiente | Opções |
|---|---|
| **On-premise** | Nomad (simples, também workloads fora de containers), Apache Mesos, OpenShift (K8s + ferramentas corporativas) |
| **Nuvem** | Amazon ECS, Google Cloud Run, AWS Fargate, Azure Container Instances |
| **K8s gerenciado** | Google GKE, Amazon EKS — operação mais simples, mas ainda exige saber K8s |
| **Local** | Docker Compose, Minikube, Docker Swarm, Kind, Rancher Desktop, MicroK8s, k3s |

- **Nomad** e **Swarm** priorizam a simplicidade; as opções **cloud-native** reduzem o gerenciamento, mas prendem você a um provedor.
- As **ferramentas locais** não servem para produção — brilham no desenvolvimento e no aprendizado.

---

## Os objetos do Kubernetes

`Deployment` → define um `ReplicaSet` → gerencia `Pod`s → executam `Container`s

| Objeto | Papel |
|---|---|
| **Deployment** | o gerente: quantas réplicas, como atualizá-las |
| **ReplicaSet** | mantém vivo o número certo de Pods |
| **Pod** | menor unidade; um ou mais containers |
| **Service** | balanceador de carga: roteia o tráfego para os Pods |
| **ConfigMap** | configuração, fora da imagem |
| **Secret** | dados sensíveis: senhas, chaves de API |

---

## Tipos de Service

| Tipo | Acessível a partir de |
|---|---|
| **ClusterIP** (padrão) | só de dentro do cluster |
| **NodePort** | de fora, em `<NodeIP>:<NodePort>` em todos os nós |
| **LoadBalancer** | um balanceador de carga externo do provedor de nuvem |

<div class="ok">

Na loja: o **Postgres** é um `ClusterIP` (só interno); o **gateway** é um `LoadBalancer` (a única entrada pública).

</div>

<!--
Conecte com o hands-on 2: o gateway continua sendo a única porta — agora no nível do cluster.
-->

---

## Postgres: Secret e ConfigMap

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

Os valores de um Secret são **codificados em base64, não criptografados**: `c3RvcmU=` é só `store`. Mantenha os segredos reais fora do Git.

</div>

---

## Postgres: o Deployment

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

- O `env` lê `POSTGRES_DB` via **`configMapKeyRef`**, e o usuário e a senha via **`secretKeyRef`**.
- O `selector` precisa corresponder aos **labels** do Pod — é assim que o Deployment encontra seus Pods.

---

## Postgres: Service e apply

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

<p class="small">O nome do Service, <code>postgres</code>, é o hostname que os outros Pods usam — o mesmo valor de <code>POSTGRES_HOST</code>.</p>

---

## Gateway: um arquivo, dois objetos

O `gateway-service/k8s/k8s.yaml` contém um Deployment e um Service, separados por `---`:

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

<p class="small">A imagem vem do Docker Hub; <code>imagePullPolicy: Always</code> a baixa de novo sempre que um Pod sobe.</p>

---

## Executar e verificar

```bash
kubectl apply -f ./k8s/k8s.yaml
kubectl get deployments
kubectl get pods
kubectl get services
```

- O Service `gateway` recebe um **EXTERNAL-IP** (na AWS, um hostname `…elb.amazonaws.com`): abra `http://<EXTERNAL-IP>:8080/health-check` → `{"hostname": …}`.
- É **HTTP**, não HTTPS: TLS exige certificados e um **Ingress**.
- Um **Ingress** roteia o tráfego HTTP/S externo para vários serviços sob um único domínio.

<p class="small">No Minikube, um LoadBalancer fica <code>&lt;pending&gt;</code> até que o <code>minikube tunnel</code> esteja rodando.</p>

---

## Escala: o HPA

O **Horizontal Pod Autoscaler** muda o número de réplicas a partir da CPU observada (ou de outras métricas).

```bash
kubectl autoscale deployment <name> --cpu-percent=<target> --min=<min> --max=<max>
kubectl get hpa
kubectl delete hpa <hpa-name>
kubectl scale deployment <name> --replicas=<number>   # manual alternative
```

<div class="ok">

Você define a **CPU alvo** e o **mínimo / máximo de réplicas**; o controller faz o resto, sem intervenção manual.

</div>

---

## O essencial de kubectl e Minikube

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

### Minikube (um nó, local)

- `minikube start --driver=<d> --profile=<p>`
- `minikube status`
- `minikube dashboard`
- `minikube stop --all`
- `minikube delete --all --purge`

</div>
</div>

---

## Armadilhas comuns

- **Labels**: um `selector` de Service ou Deployment que não corresponde aos labels do Pod **não encontra nada**.
- **Ordem**: aplique o Secret e o ConfigMap **antes** do Deployment que os referencia.
- **Imagens desatualizadas**: `:latest` + `imagePullPolicy: Always` baixa a imagem a cada reinício — fixe as tags em produção.
- **Segredos em texto puro**: base64 é codificação; um `secrets.yaml` versionado é uma senha vazada.
- **Tipo de Service errado**: um banco de dados como `LoadBalancer` fica exposto à internet.

---

## Pontos-chave

1. Um orquestrador faz **escalonamento, escala, rede, autorrecuperação e descoberta de serviços**.
2. O **Compose** é de um único hospedeiro; o **Kubernetes** reconcilia um **estado desejado** declarado em um cluster.
3. Deployment → ReplicaSet → **Pod** → Container; um **Service** expõe Pods por **label**.
4. **ClusterIP** para serviços internos (Postgres), **LoadBalancer** para o ponto de entrada (gateway).
5. Configuração em **ConfigMaps**, credenciais em **Secrets** (base64, não criptografia).
6. `kubectl apply -f` + `kubectl get …` para implantar e verificar; **HPA** para escalar pela CPU.
7. O **Minikube** roda um cluster de um único nó localmente; K8s gerenciado (EKS, GKE) na nuvem.
