# 4. Ingress

A Service gives a set of pods one stable virtual address *inside* the cluster. The **Ingress** is the
[`ingress`](../../../reference/components/edge/index.md#ingress) of the palette: the door from the
outside world, routing HTTP requests by host and path to Services — the Kubernetes counterpart of
the Nginx `edge` of [lab 3](../../3/index.md).

## The path of a request

``` diagram-sim
flowchart LR
    curl["curl localhost/catalog/events/1"] -->|"host :80 → node :30080 (kind.yaml)"| node[control-plane node]
    node -->|NodePort Service| traefik[Traefik pod]
    traefik -->|"rule /catalog → Service catalog:8082"| svc[Service catalog]
    svc -->|"one of the READY endpoints"| p1[catalog pod 1]
    svc --> p2[catalog pod 2]
```

Traefik watches the Kubernetes API: when an Ingress (or a pod's readiness) changes, its routing table
changes within seconds, with no reload. It sends traffic directly to the **ready** pod endpoints of
the Service, so a pod that fails its readiness probe stops receiving requests from the edge too.

## The rule

=== "Ingress"

    ``` yaml title="k8s/base/ingress.yaml"
    --8<-- "docs/2027.1/hands-on/10/code/k8s/base/ingress.yaml"
    ```

=== "Gateway API (HTTPRoute)"

    The **Gateway API** is the successor of Ingress: the same idea, split by role — the platform team
    owns the `Gateway` (ports, TLS), each service team owns its `HTTPRoute` — with features Ingress only
    had as vendor annotations (header matching, traffic splitting by weight, timeouts). Enable it in
    Traefik, which then creates a `GatewayClass` named `traefik` and a default `Gateway` named
    `traefik-gateway` listening on its `web` entry point:

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

    To switch, replace `ingress.yaml` with `catalog-route.yaml` in `k8s/base/kustomization.yaml`,
    apply again and delete the old rule (`kubectl apply` never deletes what you removed from the
    files):

    ``` shell
    kubectl apply -k k8s/overlays/local
    kubectl -n boxoffice delete ingress boxoffice
    curl -s -o /dev/null -w '%{http_code}\n' localhost/catalog/events/1   # 200, now through the HTTPRoute
    ```

    Use either the Ingress or the HTTPRoute for `/catalog`, not both.

??? question "Ingress, Service of type LoadBalancer, or API gateway?"

    A `LoadBalancer` Service gives *one* service its own external address (in the cloud, one cloud
    load balancer each — and one bill each). An Ingress shares one entry point among many services
    with HTTP routing. An API gateway (Spring Cloud Gateway in [lab 4](../../4/index.md)) adds
    application concerns — authentication, rate limits per user, request transformation. A typical
    production path is cloud load balancer → Ingress/Gateway → API gateway → services.

## Check the routing

``` shell
curl -s -o /dev/null -w '%{http_code}\n' localhost/catalog/events/1        # 200: routed
curl -s -o /dev/null -w '%{http_code}\n' localhost/nothing-here            # 404: no rule matches
for i in $(seq 1 6); do curl -s -D - -o /dev/null localhost/catalog/events/1 | grep -i x-instance; done
```

If `catalog` still sets the `X-Instance` header of lab 3, the last command shows the requests spread
over the pods: the pod name is the container hostname.

[Next: Measure it](../measure/index.md){ .md-button .md-button--primary }
