# 4. GitOps com Argo CD { #4-gitops-with-argo-cd }

Até agora você fez deploy com `kubectl apply` a partir do seu notebook: quem tem as credenciais muda o
cluster, e nada registra o que está rodando. O **GitOps** inverte a direção: o estado desejado vive no
Git, e um agente **dentro** do cluster — o **Argo CD** — o puxa e mantém o cluster igual a ele, para
sempre. O CI nunca toca no cluster; ele só escreve no Git. A teoria está na
[aula de entrega](../../../classes/cloud-native/delivery/index.md).

``` diagram-sim
flowchart LR
    dev[git push] --> ci[CI: testes, scan, imagem]
    ci -->|imagem sha-…| ghcr[(ghcr.io)]
    ci -->|sucesso| deploy[workflow Deploy]
    deploy -->|"commit: nova tag em k8s/overlays/gitops"| git[(repositório no GitHub)]
    argo[Argo CD no cluster] -->|consulta a cada 3 min| git
    argo -->|apply, prune, self-heal| k8s[namespace boxoffice]
    k8s -->|pull da imagem| ghcr
```

## Os componentes da plataforma { #the-platform-components }

Use o cluster kind do [lab 10](../../10/cluster/index.md) (recrie-o com o passo 1 do lab 10 se você o
apagou; Traefik e metrics-server são necessários). Primeiro remova o que o lab 10 implantou à mão — daqui
em diante o Argo CD é dono do namespace:

``` shell
kubectl config use-context kind-boxoffice
kubectl delete namespace boxoffice --wait=true
```

Instale o Argo CD, o Argo Rollouts (o passo 5 o usa, e o overlay de GitOps já contém um `Rollout`) e o
pequeno Prometheus do passo 5. As CRDs grandes precisam de server-side apply:

``` shell
kubectl create namespace argocd
kubectl apply -n argocd --server-side --force-conflicts \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/v3.5.5/manifests/install.yaml
kubectl create namespace argo-rollouts
kubectl apply -n argo-rollouts --server-side \
  -f https://github.com/argoproj/argo-rollouts/releases/download/v1.10.1/install.yaml
kubectl apply -f k8s/monitoring/prometheus.yaml
kubectl -n argocd rollout status deployment/argocd-server --timeout=300s
```

Você deve ver `deployment "argocd-server" successfully rolled out`, e `kubectl get pods -n
argo-rollouts` e `kubectl get pods -n monitoring` devem mostrar um pod rodando cada.

O Argo CD só considera um `Ingress` `Healthy` quando o controller escreveu um endereço no status dele,
e um Traefik exposto como NodePort não escreve nenhum: a Application ficaria em `Progressing` para
sempre. Faça o Traefik publicar `127.0.0.1`:

``` shell
helm upgrade traefik traefik/traefik --version 42.0.0 --namespace traefik --reuse-values \
  --set providers.kubernetesIngress.publishedService.enabled=false \
  --set providers.kubernetesIngress.ingressEndpoint.ip=127.0.0.1
```

Depois de um minuto, `kubectl -n boxoffice get ingress` mostra `127.0.0.1` em `ADDRESS` (quando a
Application tiver criado o Ingress, abaixo).

Abra a interface do Argo CD num segundo terminal e entre como `admin`:

``` shell
kubectl -n argocd port-forward svc/argocd-server 8443:443          # keep it running
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d; echo
```

Acesse `https://localhost:8443` (aceite o certificado autoassinado) e use essa senha.

## Acesso ao seu repositório e às suas imagens { #access-to-your-repository-and-images }

O seu repositório e os seus pacotes são privados, então o cluster precisa de credenciais só de leitura.
Crie um **fine-grained personal access token** no GitHub (*Settings → Developer settings → Fine-grained
tokens*) para o seu repositório `boxoffice` com *Contents: read*, e um **token clássico** com
`read:packages` para as imagens (ou torne o pacote `boxoffice-catalog` público e pule o segundo
segredo). Nunca faça commit deles:

``` shell
export GH_USER=<your GitHub user, lowercase>
export REPO_TOKEN=<the fine-grained token>
export PKG_TOKEN=<the read:packages token>

kubectl -n argocd create secret generic boxoffice-repo \
  --from-literal=type=git \
  --from-literal=url=https://github.com/$GH_USER/boxoffice.git \
  --from-literal=username=$GH_USER --from-literal=password=$REPO_TOKEN
kubectl -n argocd label secret boxoffice-repo argocd.argoproj.io/secret-type=repository

kubectl create namespace boxoffice
kubectl -n boxoffice create secret docker-registry ghcr-pull \
  --docker-server=ghcr.io --docker-username=$GH_USER --docker-password=$PKG_TOKEN
```

## O overlay de GitOps { #the-gitops-overlay }

Um novo overlay, ao lado do `local` do lab 10: a mesma base, a imagem do GHCR, o `Rollout` do passo 5 e
um patch que expõe `/actuator/prometheus`.

=== "kustomization.yaml"

    ``` yaml title="k8s/overlays/gitops/kustomization.yaml"
    --8<-- "docs/2027.1/hands-on/11/code/k8s/overlays/gitops/kustomization.yaml"
    ```

=== "catalog-services.yaml"

    ``` yaml title="k8s/overlays/gitops/catalog-services.yaml"
    --8<-- "docs/2027.1/hands-on/11/code/k8s/overlays/gitops/catalog-services.yaml"
    ```

=== "catalog-rollout.yaml"

    ``` yaml title="k8s/overlays/gitops/catalog-rollout.yaml"
    --8<-- "docs/2027.1/hands-on/11/code/k8s/overlays/gitops/catalog-rollout.yaml"
    ```

=== "catalog-analysis.yaml"

    ``` yaml title="k8s/overlays/gitops/catalog-analysis.yaml"
    --8<-- "docs/2027.1/hands-on/11/code/k8s/overlays/gitops/catalog-analysis.yaml"
    ```

Troque `your-user` em `newName` pelo seu usuário do GitHub (em minúsculas) e deixe `newTag` como está:
o workflow `Deploy` o escreve depois da próxima execução bem-sucedida do CI.
`kubectl kustomize k8s/overlays/gitops` deve imprimir os manifestos sem erros.

## O workflow Deploy { #the-deploy-workflow }

``` yaml title=".github/workflows/deploy.yaml"
--8<-- "docs/2027.1/hands-on/11/code/.github/workflows/deploy.yaml"
```

Ele roda quando o `CI` termina na `main`, edita a entrada `images` do overlay com
`kustomize edit set image` (o Kustomize vem pré-instalado nos runners Ubuntu do GitHub) e faz push do
commit. O Kustomize reescreve o arquivo inteiro ao editá-lo: os comentários somem e as listas são
reindentadas, o que é esperado. Um commit enviado com o `GITHUB_TOKEN` do workflow não inicia novas execuções de workflow, e o
`CI` ignora mudanças em `k8s/**` de qualquer forma, então não há loop. Como o `Deploy` faz commit na
`main`, a sua `main` local fica para trás depois de cada deploy: daqui em diante, rode
`git pull --rebase` antes de cada `git push`.

!!! info "Proteção de branch"

    Se a `main` exige pull requests, o bot não consegue fazer push nela. Ou permita que o bot do GitHub
    Actions faça bypass da regra, ou mude o workflow para abrir um pull request com a nova tag (um
    humano — ou uma política — aprova cada deploy).

## A Application { #the-application }

``` yaml title="k8s/argocd/application.yaml"
--8<-- "docs/2027.1/hands-on/11/code/k8s/argocd/application.yaml"
```

Troque `your-user` em `repoURL`, faça commit e push de tudo, e então registre a Application (o único
`kubectl apply` do fluxo — daqui em diante quem aplica é o Argo CD):

``` shell
git add .github k8s && git commit -m "lab 11: gitops" && git push
kubectl apply -f k8s/argocd/application.yaml
kubectl -n argocd get applications -w
```

Até o primeiro commit do `Deploy` chegar, o `catalog` não consegue subir (`newTag` ainda é o
placeholder) e a Application aparece como `Degraded` — esperado. Quando o push dispara o `CI` e depois o
`Deploy`, o Argo CD pega o novo commit (ele consulta a cada 3 minutos; **Refresh** na interface força a
consulta). Você deve ver a Application passar para `Synced` e `Healthy`, a árvore de recursos na
interface (Namespace, StatefulSet `db`, Deployment `redis`, Rollout `catalog` com seus pods…) e
`curl localhost/catalog/events/1` respondendo `200` pelo Traefik.

## Drift e autocorreção { #drift-and-self-healing }

Mude o cluster à mão e veja o Argo CD desfazer:

``` shell
kubectl -n boxoffice scale deployment redis --replicas=0
kubectl -n boxoffice get deployment redis -w
```

Em segundos o Argo CD reporta `OutOfSync` e, com `selfHeal: true`, restaura 1 réplica: o cluster só pode
ser mudado pelo Git. Para fazer rollback de uma release, você faz `git revert` do commit de deploy.

[Próximo: Canary com Argo Rollouts](../canary/index.md){ .md-button .md-button--primary }
