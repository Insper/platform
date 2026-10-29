# 4. Ingress

Um Service dá a um conjunto de pods um endereço virtual estável *dentro* do cluster. O **Ingress** é o
[`ingress`](../../../reference/components/edge/index.md#ingress) da paleta: a porta de entrada do mundo
externo, que roteia requisições HTTP por host e caminho para os Services — a contraparte, no
Kubernetes, do `edge` Nginx do [lab 3](../../3/index.md).

## O caminho de uma requisição { #the-path-of-a-request }

``` diagram-sim
flowchart LR
    curl["curl localhost/catalog/events/1"] -->|"host :80 → nó :30080 (kind.yaml)"| node[nó do control plane]
    node -->|Service NodePort| traefik[pod do Traefik]
    traefik -->|"regra /catalog → Service catalog:8082"| svc[Service catalog]
    svc -->|"um dos endpoints PRONTOS"| p1[pod catalog 1]
    svc --> p2[pod catalog 2]
```

O Traefik observa a API do Kubernetes: quando um Ingress (ou a readiness de um pod) muda, a tabela de
roteamento dele muda em segundos, sem reload. Ele manda o tráfego diretamente para os endpoints de pods
**prontos** do Service, então um pod que falha na readiness probe também deixa de receber requisições
da borda.

## A regra { #the-rule }

=== "Ingress"

    ``` yaml title="k8s/base/ingress.yaml"
    --8<-- "docs/2027.1/hands-on/10/code/k8s/base/ingress.yaml"
    ```

=== "Gateway API (HTTPRoute)"

    A **Gateway API** é a sucessora do Ingress: a mesma ideia, dividida por papel — o time de
    plataforma é dono do `Gateway` (portas, TLS), cada time de serviço é dono da sua `HTTPRoute` —, com
    recursos que o Ingress só tinha como anotações de fornecedor (match por header, divisão de tráfego
    por peso, timeouts). Ative-a no Traefik, que então cria uma `GatewayClass` chamada `traefik` e um
    `Gateway` padrão chamado `traefik-gateway`, escutando no ponto de entrada `web`:

    ``` shell
    # the Gateway API is a set of CRDs: install the version the Traefik chart recommends
    kubectl apply --server-side -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.6.2/standard-install.yaml
    helm upgrade traefik traefik/traefik --version 42.0.0 --namespace traefik --reuse-values \
      --set providers.kubernetesGateway.enabled=true \
      --set gateway.listeners.web.namespacePolicy.from=All
    kubectl get gatewayclass,gateway -A     # ACCEPTED / PROGRAMMED = True
    ```

    ``` yaml title="k8s/base/catalog-route.yaml"
    --8<-- "docs/2027.1/hands-on/10/code/k8s/base/catalog-route.yaml"
    ```

    Para trocar, substitua `ingress.yaml` por `catalog-route.yaml` no `k8s/base/kustomization.yaml`,
    aplique de novo e apague a regra antiga (o `kubectl apply` nunca apaga o que você removeu dos
    arquivos):

    ``` shell
    kubectl apply -k k8s/overlays/local
    kubectl -n boxoffice delete ingress boxoffice
    curl -s -o /dev/null -w '%{http_code}\n' localhost/catalog/events/1   # 200, now through the HTTPRoute
    ```

    Use o Ingress ou a HTTPRoute para `/catalog`, não os dois.

??? question "Ingress, Service do tipo LoadBalancer ou API gateway?"

    Um Service `LoadBalancer` dá a *um* serviço o seu próprio endereço externo (na nuvem, um load
    balancer de nuvem para cada — e uma conta para cada). Um Ingress compartilha um ponto de entrada
    entre muitos serviços, com roteamento HTTP. Um API gateway (o Spring Cloud Gateway do
    [lab 4](../../4/index.md)) adiciona preocupações de aplicação — autenticação, rate limits por
    usuário, transformação de requisições. Um caminho típico em produção é load balancer de nuvem →
    Ingress/Gateway → API gateway → serviços.

## Confira o roteamento { #check-the-routing }

``` shell
curl -s -o /dev/null -w '%{http_code}\n' localhost/catalog/events/1        # 200: routed
curl -s -o /dev/null -w '%{http_code}\n' localhost/nothing-here            # 404: no rule matches
for i in $(seq 1 6); do curl -s -D - -o /dev/null localhost/catalog/events/1 | grep -i x-instance; done
```

Se o `catalog` ainda define o header `X-Instance` do lab 3, o último comando mostra as requisições
espalhadas pelos pods: o nome do pod é o hostname do contêiner.

[Próximo: Meça](../measure/index.md){ .md-button .md-button--primary }
