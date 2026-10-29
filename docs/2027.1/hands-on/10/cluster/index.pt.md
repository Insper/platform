# 1. Um Cluster Local { #1-a-local-cluster }

O Kubernetes é a mesma API num laptop e numa região de nuvem. Este passo cria um cluster de três nós
dentro do Docker com o **kind** (*Kubernetes IN Docker*), instala os dois add-ons de que o lab precisa —
um **Ingress controller** e o **metrics-server** — e carrega nele as suas imagens do BoxOffice.

## Ferramentas { #tools }

Além do `kubectl` e do `kind` (ou `minikube`) do lab 0, instale o **Helm**, o gerenciador de pacotes
com que a maioria dos add-ons é distribuída:

=== "macOS"

    ``` shell
    brew install helm kind kubectl
    ```

=== "Linux / WSL"

    ``` shell
    curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-4 | bash
    ```

!!! warning "Libere as portas antes"

    O cluster publica o Ingress na porta **80** da sua máquina, a mesma porta do `edge` do
    [lab 3](../../3/index.md). Pare o Compose antes de criar o cluster (`docker compose down`) e dê ao
    Docker pelo menos 4 CPUs e 8 GB de memória.

## O cluster { #the-cluster }

Um nó de control plane e dois workers, para que você veja os pods espalhados pelos nós e sobrevivendo à
perda de um deles. O `extraPortMappings` publica a porta 30080 do contêiner do control plane — onde o
Ingress controller vai escutar — como a porta 80 da sua máquina.

``` yaml title="k8s/kind.yaml"
--8<-- "docs/2027.1/hands-on/10/code/k8s/kind.yaml"
```

=== "kind"

    <!-- termynal -->

    ``` shell
    > kind create cluster --config k8s/kind.yaml
    Creating cluster "boxoffice" ...
     ✓ Ensuring node image (kindest/node:v1.37.0) 🖼
     ✓ Preparing nodes 📦 📦 📦
     ✓ Starting control-plane 🕹️
     ✓ Joining worker nodes 🚜
    Set kubectl context to "kind-boxoffice"
    > kubectl get nodes
    NAME                      STATUS   ROLES           AGE   VERSION
    boxoffice-control-plane   Ready    control-plane   60s   v1.37.0
    boxoffice-worker          Ready    <none>          40s   v1.37.0
    boxoffice-worker2         Ready    <none>          40s   v1.37.0
    ```

=== "minikube"

    ``` shell
    minikube start --nodes 3 --cpus 2 --memory 4g
    kubectl get nodes
    ```

    Com o minikube, pule o `k8s/kind.yaml`: depois de instalar o Traefik abaixo, chegue a ele com
    `minikube service -n traefik traefik --url` (ou `minikube tunnel` com `service.type=LoadBalancer`)
    e use essa URL onde este lab diz `http://localhost`.

## O Ingress controller: Traefik { #the-ingress-controller-traefik }

Um **Ingress** é só uma regra de roteamento ("`/catalog` → service `catalog`"); um **controller** lê
essas regras e de fato faz o proxy do tráfego. Por anos a escolha padrão foi o ingress-nginx; o projeto
Kubernetes **o aposentou em março de 2026** (o repositório está arquivado e não recebe mais correções),
então este lab usa o **Traefik**, um controller mantido que implementa tanto a API `Ingress` quanto a
sua sucessora, a **Gateway API**.

``` shell
helm repo add traefik https://traefik.github.io/charts
helm repo update
helm install traefik traefik/traefik --version 42.0.0 \
  --namespace traefik --create-namespace \
  --set service.type=NodePort \
  --set ports.web.nodePort=30080
```

O `ports.web.nodePort=30080` fixa o ponto de entrada HTTP na porta que o `kind.yaml` mapeia para a
porta 80 da sua máquina.

## metrics-server

O Horizontal Pod Autoscaler lê o uso de CPU da **metrics API**, servida pelo metrics-server. No kind os
kubelets usam certificados autoassinados, então o metrics-server precisa pular a verificação deles — um
atalho que só vale para o lab:

``` shell
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.9.0/components.yaml
kubectl patch -n kube-system deployment metrics-server --type=json \
  -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
kubectl top nodes        # works after ~1 minute
```

## Imagens { #images }

O cluster não enxerga as imagens do seu Docker; ele tem o seu próprio container runtime. Faça o build
com o Compose, marque com uma tag **fixa** (nunca `latest`: o Kubernetes tentaria sempre puxá-la de um
registry) e carregue a imagem em todos os nós:

``` shell
docker compose build catalog-1                     # builds the image "boxoffice-catalog" (lab 3 anchor)
docker tag boxoffice-catalog boxoffice/catalog:dev
kind load docker-image boxoffice/catalog:dev --name boxoffice
# minikube: minikube image load boxoffice/catalog:dev
```

Você deve ver `Image: "boxoffice/catalog:dev" with ID "sha256:…" not yet present on node
"boxoffice-worker", loading...` uma vez por nó.

Repita para cada serviço de que você fizer deploy. No [lab 11](../../11/index.md) um pipeline de CI
vai enviar as imagens para um registry, marcadas com o commit a partir do qual foram construídas.

[Próximo: Deploy do BoxOffice](../deploy/index.md){ .md-button .md-button--primary }
