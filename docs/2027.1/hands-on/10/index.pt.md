# 10. Kubernetes

!!! info "Objetivo"

    Rodar o BoxOffice num cluster Kubernetes de verdade no seu laptop. Criar um cluster **kind** com
    três nós, instalar um **Ingress controller** (Traefik) e o **metrics-server**, fazer o deploy de
    `db`, `redis` e `catalog` com o **Kustomize** — probes, requests e limits de recursos, graceful
    shutdown — e deixar um **Horizontal Pod Autoscaler** escalar o `catalog` sob uma rampa do k6. Medir
    quão rápido a capacidade acompanha a carga, quantas requisições um rolling update perde e quanto
    tempo a autocura leva.

No lab 3 você escalou o `catalog` editando o `docker-compose.yaml` e reiniciando; no lab 9 você viu um
serviço cair e teve que reiniciá-lo à mão. Às 10:00 do dia da venda ninguém deveria estar editando YAML
ou reiniciando contêineres. O Kubernetes transforma as duas coisas em **laços de controle**: você
declara o estado desejado — "pelo menos duas réplicas prontas, mais quando a CPU passar de 60%" — e os
controllers mantêm a realidade ali, a cada poucos segundos, para sempre. Este lab é o lado prático da
[aula de cloud-native](../../classes/cloud-native/index.md) e constrói o capítulo 11 da
[história do curso](../../index.md#story): ele implementa as decisões da aula sobre
[probes](../../classes/cloud-native/kubernetes/index.md#probes),
[requests e limits](../../classes/cloud-native/kubernetes/index.md#requests-limits),
[autoscaling](../../classes/cloud-native/kubernetes/index.md#autoscaling) e
[perder um nó](../../classes/cloud-native/kubernetes/index.md#losing-a-node).

## Slides

<div class="slides-embed">
  <iframe src="slides/kubernetes.html" title="Slides: Kubernetes" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/kubernetes.html){:target="_blank"}

## Antes de começar { #before-you-start }

| | |
|---|---|
| Tempo | cerca de 4 horas |
| Ferramentas | `kubectl` (`kubectl version --client`), `kind` 0.33+ (`kind version`) ou `minikube`, **Helm** 4 (`helm version`, instalado no passo 1), Docker, k6 |
| Recursos do Docker | pelo menos 4 CPUs e **8 GB**; a stack do Compose precisa estar **parada** (o cluster usa a porta 80) |
| Portas | 80 na sua máquina (o Ingress) |

Todo comando roda na **raiz do seu repositório `boxoffice`**, no estado em que o lab 9 o deixou:

``` text title="Start state (end of lab 9)"
boxoffice/
├── docker-compose.yaml     # the full Compose stack of labs 1-9
├── infra/  load/  scripts/
└── services/               # auth, catalog, gateway, inventory, notification, order, payment
```

!!! tip "Recupere o atraso"

    Pulou ou quebrou o lab 9? Baixe [boxoffice-after-lab-9.zip](../9/boxoffice-after-lab-9.zip),
    descompacte, `cd boxoffice` e continue daqui. Este lab só precisa da imagem do `catalog`,
    construída a partir de `services/catalog` com `docker compose build catalog-1`.

Todo arquivo deste lab aparece completo nestas páginas e é publicado em
`https://insper.github.io/platform/2027.1/hands-on/10/code/<caminho>`.

## Arquitetura { #architecture }

``` diagram-sim
flowchart LR
    k6[k6] -->|"localhost:80"| traefik["Traefik (Ingress)"]
    subgraph cluster [cluster kind: 1 control plane + 2 workers]
        traefik -->|/catalog| svc[Service catalog]
        svc --> c1[pod catalog]
        svc --> c2[pod catalog]
        svc -.-> cN["pod catalog ... (HPA: 2..8)"]
        c1 --> redis[(redis)]
        c1 --> db[("db-0 (StatefulSet + PVC)")]
        ms[metrics-server] -.->|CPU| hpa[HPA]
        hpa -.->|réplicas| svc
    end
```

!!! example "Componentes do BoxOffice envolvidos"

    | Componente da paleta | Neste lab |
    |---|---|
    | [Ingress](../../reference/components/edge/index.md#ingress) | Traefik, com um `Ingress` (ou uma `HTTPRoute` da Gateway API) para `/catalog` |
    | [Load Balancer](../../reference/components/edge/index.md#lb) | o Service `catalog` distribuindo as requisições entre os pods prontos |
    | [App Server](../../reference/components/compute/index.md#app) | o Deployment `catalog`, escalado por um HPA |
    | [Health Check](../../reference/components/observability/index.md#healthcheck) | probes de startup, liveness e readiness |
    | [SQL Database](../../reference/components/storage/index.md#sql) / [Cache](../../reference/components/storage/index.md#cache) | StatefulSet `db` com um volume persistente, `redis` |

## O que você vai medir { #what-you-will-measure }

| Pergunta | Métrica | Ferramenta |
|---|---|---|
| Quão rápido a capacidade acompanha uma rampa de carga? | tempo até o primeiro scale-up, tempo até a capacidade total, p95 durante a rampa | k6, `watch-hpa.sh` |
| Réplicas fixas vs autoscaling? | p95, p99, erros no mesmo pico | k6 |
| Um rolling update perde requisições? | requisições com falha com e sem readiness + `preStop` | k6 |
| Quanto tempo leva a autocura? | pod apagado / nó parado → pronto de novo | `kubectl get -w` |

## Pré-requisitos { #prerequisites }

- Labs [1](../1/index.md) a [5](../5/index.md) concluídos (a imagem do `catalog` com o seu cache); o
  `load/catalog-otel.js` do lab 8 é reaproveitado no passo 5.
- `kubectl`, `kind` (ou `minikube`) do [lab 0](../0/index.md), mais o Helm (passo 1).
- Leia a [página de Kubernetes](../../classes/cloud-native/kubernetes/index.md) da aula de cloud-native
  e [autoscaling](../../classes/compute/serverless-autoscaling/index.md) na aula de computação.

## Passos { #steps }

1. [Um cluster local](cluster/index.md) — kind com três nós, Traefik, metrics-server, imagens carregadas no cluster.
2. [Deploy do BoxOffice](deploy/index.md) — base e overlay do Kustomize; StatefulSet, Deployment, probes, recursos, graceful shutdown; autocura.
3. [Autoscaling](autoscaling/index.md) — um HPA `autoscaling/v2` com comportamento de scale-up e scale-down, sob uma rampa do k6.
4. [Ingress](ingress/index.md) — o caminho de uma requisição para dentro do cluster; Ingress e Gateway API.
5. [Meça](measure/index.md) — fixo vs autoscaling, rollouts com e sem probes, tempos de recuperação.

## Experimente no playground { #try-it-in-the-playground }

**Experimente:** rode o `scale-out` com o perfil `stress` e um número fixo de réplicas até o p99
explodir; depois aumente o número de réplicas e rode de novo. Anote a vazão por réplica — o mesmo
número em que o alvo do seu HPA se baseia implicitamente. Ligue um health check e mate uma réplica:
por quanto tempo o load balancer continua mandando tráfego para ela?

<div class="sdp" data-scenario="scale-out" data-mode="compact" data-height="520" data-profile="stress"></div>

O simulador completo está no [playground](../../../playground/index.md).

## Meça { #measure-it }

O passo [Meça](measure/index.md) tem os comandos e a tabela de resultados para guardar em
`results/lab10.md`, com o log do `watch-hpa.sh` em `results/lab10-hpa.csv`.

## Solução de problemas { #troubleshooting }

| Sintoma | Causa provável | Correção |
|---|---|---|
| `kind create cluster` falha com `port is already allocated` | o `edge` do Compose (ou outro servidor) usa a porta 80 | `docker compose down`; `lsof -i :80` |
| pods em `ImagePullBackOff` / `ErrImagePull` | a imagem não foi carregada nos nós, ou a tag é `latest` | `kind load docker-image boxoffice/catalog:dev --name boxoffice`; mantenha `imagePullPolicy: IfNotPresent` |
| `catalog` em `CrashLoopBackOff` nos primeiros minutos | o PostgreSQL ainda não estava pronto (normal), ou credenciais erradas | espere; `kubectl -n boxoffice logs deploy/catalog --previous` |
| `catalog` morto com `failed startup probe` | a primeira inicialização (migrations) mais lenta que o orçamento de startup num laptop ocupado | aumente o `failureThreshold` da `startupProbe`; dê mais CPU ao Docker |
| `kubectl get hpa` mostra `cpu: <unknown>/60%` | o metrics-server não está pronto, ou não recebeu o patch com `--kubelet-insecure-tls` | `kubectl -n kube-system get pods`; repita o patch; espere um minuto |
| pods ficam em `Pending` | CPU/memória insuficientes para os recursos pedidos | `kubectl -n boxoffice describe pod <name>`; diminua `PEAK`/`maxReplicas` ou dê mais recursos ao Docker |
| `curl localhost/catalog/...` devolve `404` | o Ingress não existe ou tem o `ingressClassName` errado | `kubectl -n boxoffice get ingress`; `kubectl -n traefik get pods` |
| o `kubectl` fala com o cluster errado | outro contexto está ativo | `kubectl config use-context kind-boxoffice` |

!!! success "Boas práticas neste lab"

    - **Uma probe por pergunta**: startup dimensionada para a inicialização mais lenta (5 min, com migrations), liveness local à JVM, readiness para o tráfego — `k8s/base/catalog.yaml`; por quê: [Kubernetes — probes](../../classes/cloud-native/kubernetes/index.md#probes).
    - **Requests definidos de propósito, porque são a base da porcentagem do HPA** (60% de 250m) — `catalog.yaml` e `catalog-hpa.yaml`; por quê: [requests e limits](../../classes/cloud-native/kubernetes/index.md#requests-limits).
    - **Nenhuma requisição perdida num rollout**: `maxUnavailable: 0`, uma pausa de 5 s no `preStop` e graceful shutdown — `catalog.yaml`; por quê: [graceful shutdown](../../classes/cloud-native/containers/index.md#graceful-shutdown-the-other-half-of-disposability).
    - **Escale para cima rápido, para baixo devagar**: dobrar ou +2 pods a cada 15 s, um pod a cada 30 s depois de uma janela de 2 minutos — `catalog-hpa.yaml`; por quê: [autoscaling](../../classes/cloud-native/kubernetes/index.md#autoscaling).
    - **Uma base, overlays finos**: o que muda por ambiente fica em `k8s/overlays/`, então o lab 11 reaproveita o `k8s/base/` sem mudanças; por quê: [GitOps](../../classes/cloud-native/delivery/index.md#gitops).

## Limpeza { #clean-up }

``` shell
kind delete cluster --name boxoffice     # frees all the memory of the three nodes
docker compose up -d                     # back to the Compose stack, if you need it
```

O lab 11 precisa de um cluster de novo: você pode mantê-lo (`docker stop boxoffice-control-plane
boxoffice-worker boxoffice-worker2` e `docker start …` depois) ou recriá-lo com os comandos do passo 1.

## Estado final { #end-state }

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

Faça commit e tag: `git add -A && git commit -m "lab 10: kubernetes" && git tag lab10`.

## Checklist

- [ ] `k8s/kind.yaml`, `k8s/base/` e `k8s/overlays/local/` no seu repositório; `kubectl apply -k k8s/overlays/local` faz o deploy de tudo no namespace `boxoffice`
- [ ] `curl localhost/catalog/events/1` responde pelo Traefik
- [ ] o `catalog` tem probes de startup, liveness e readiness, requests e limits, graceful shutdown e uma pausa no `preStop`
- [ ] o HPA escalou o `catalog` para cima durante a rampa do k6 e de volta para baixo depois; o log em CSV está no commit
- [ ] o experimento de rolling update mostra o efeito de readiness + `preStop` nas requisições com falha
- [ ] tabela de resultados preenchida e explicada; `git tag lab10`

## Relacionados { #related }

- Teoria: [Plataformas cloud-native](../../classes/cloud-native/index.md) ·
  [Contêineres](../../classes/cloud-native/containers/index.md) ·
  [Kubernetes](../../classes/cloud-native/kubernetes/index.md) ·
  [Serverless e autoscaling](../../classes/compute/serverless-autoscaling/index.md) ·
  [Balanceamento de carga](../../classes/edge/load-balancing/index.md)
- Exercício: [Autoscaling no Kubernetes](../../exercises/kubernetes-autoscaling/index.md)
- Próximo lab: [11. Entrega](../11/index.md) faz o deploy destes manifestos a partir do Git com o Argo CD.

[Começar: Um cluster local](cluster/index.md){ .md-button .md-button--primary }
