
O BoxOffice agora roda nove serviços no Kubernetes. Cada time reimplementou as mesmas coisas do seu jeito: `order` tem timeout de 2 segundos para `payment`, `inventory` não tem nenhum; `catalog` tenta de novo três vezes, `search` tenta para sempre; ninguém criptografa o tráfego dentro do cluster porque "é interno"; e quando o time de segurança pergunta *"quais serviços podem chamar `payment`?"*, a resposta honesta é "qualquer pod que saiba a URL". Um **service mesh** tira essas preocupações transversais — criptografia, identidade, autorização, timeouts, retries, divisão de tráfego, telemetria — do código da aplicação e as coloca em uma camada de infraestrutura uniforme.

---

## O que é um service mesh { #what-a-service-mesh-is }

Um service mesh é uma camada de infraestrutura dedicada à **comunicação entre serviços**[^1]. Ele tem duas partes:

- **Plano de dados** (*data plane*) — proxies que ficam no caminho de toda requisição entre serviços. Eles terminam e originam TLS, aplicam políticas, fazem retry, timeout, balanceamento de carga e emitem métricas e traces.
- **Plano de controle** (*control plane*) — o cérebro que configura os proxies: distribui regras de roteamento e políticas, e atua como **autoridade certificadora** que emite a identidade de cada workload.

``` diagram
flowchart TB
    subgraph cp ["Plano de controle (istiod / linkerd-control-plane)"]
        CFG["configuração + política"]
        CA["autoridade certificadora"]
    end
    subgraph dp ["Plano de dados"]
        subgraph po ["pod: order"]
            O["app order"] --- PO["proxy"]
        end
        subgraph pp ["pod: payment"]
            PP["proxy"] --- P["app payment"]
        end
    end
    PO <-->|"mTLS"| PP
    CFG -.->|"rotas, políticas"| PO & PP
    CA -.->|"certificados (rotacionados)"| PO & PP
```

A aplicação continua chamando `http://payment:8080/charges` em HTTP puro. O proxy na saída promove a chamada para **TLS mútuo**, o proxy na entrada verifica a identidade de quem chama, confere a política e entrega HTTP puro a `payment`. Nenhuma das aplicações mudou uma linha.

### O que você ganha { #what-you-get }

| Capacidade | Sem mesh | Com mesh |
|---|---|---|
| Criptografia em trânsito | cada time configura TLS (normalmente ninguém o faz dentro do cluster) | mTLS em todo lugar, certificados rotacionados automaticamente |
| Identidade de serviço | endereços IP, segredos compartilhados | uma identidade criptográfica por workload (SPIFFE) |
| Autorização entre serviços | no código, quando existe | políticas declarativas: "só `order` pode fazer `POST /charges` em `payment`" |
| Timeouts, retries, circuit breaking | bibliotecas em cada linguagem (Resilience4j, Polly…) | configuração uniforme por rota |
| Divisão de tráfego (canary, espelhamento) | no load balancer ou no código | pesos por rota, roteamento por cabeçalho |
| Telemetria dos golden signals | cada serviço se instrumenta | taxa de requisições, erros e latência de cada salto, prontos |

O mesh é a casa natural de três temas do curso: **padrões de confiabilidade** (veja [Confiabilidade](../../reliability/index.md)), **observabilidade** de cada salto (veja [Observabilidade](../../observability/index.md)) e **Zero Trust** entre serviços ([Zero Trust](../zero-trust/index.md)).

---

## Arquiteturas de plano de dados: sidecar, ambient, eBPF { #data-plane-architectures-sidecar-ambient-ebpf }

Onde o proxy roda? Três projetos estão em produção hoje[^2][^3].

=== "Sidecar"

    Um container de proxy (Envoy no Istio, `linkerd2-proxy` no Linkerd) é **injetado em todo pod**. Todo o tráfego de entrada e saída do pod é redirecionado por ele.

    - Todo salto é L7 completo (entende HTTP): retries, roteamento por cabeçalho, políticas por caminho.
    - Custo: um proxy por pod — memória e CPU multiplicadas pelo número de pods, um salto extra em cada ponta de toda chamada, e o ciclo de vida do sidecar fica acoplado ao da aplicação (atualizar o mesh significa reiniciar todos os pods; jobs precisam que o sidecar termine).

=== "Ambient (Istio)"

    O mesh é dividido em duas camadas:

    - **ztunnel** — um por **nó**, um proxy pequeno que cuida do L4: mTLS, identidade, autorização L4 e telemetria para todos os pods do nó.
    - **waypoint proxy** — um Envoy opcional implantado **por namespace ou por serviço**, só quando recursos L7 são necessários (roteamento HTTP, retries, políticas por caminho).

    Os pods não são modificados; colocar um namespace no mesh é um label. Você paga pelo L7 só onde o usa.

=== "eBPF / sem sidecar (Cilium)"

    Programas **eBPF** (extended Berkeley Packet Filter) no kernel Linux cuidam do L3/L4 — roteamento, NetworkPolicy, balanceamento de carga, criptografia transparente (WireGuard ou IPsec) — sem proxy por pod. Os recursos L7 passam por um Envoy compartilhado por nó. A identidade fica atrelada aos labels do Kubernetes e, para autenticação mútua, a identidades no estilo SPIFFE.

| | Sidecar | Ambient | eBPF (Cilium) |
|---|---|---|---|
| Posição do proxy | um por pod | ztunnel por nó + waypoint opcional | kernel + Envoy compartilhado por nó |
| L7 em todo lugar? | sim | só onde houver waypoint | só onde houver política L7 configurada |
| Sobrecarga de recursos (qualitativa) | a maior — cresce com o número de pods | baixa para L4, paga-se por waypoint | a menor para L3/L4 |
| Latência extra por salto | dois proxies no caminho | um salto no nível do nó; +waypoint para L7 | caminho rápido no kernel |
| Impacto de atualização | reiniciar todos os pods | atualizar agentes dos nós e waypoints | atualizar o agente do nó |
| Raio de impacto de um bug no proxy | um pod | todos os pods do nó (ztunnel) | o nó |
| Maturidade | o mais antigo em produção | GA no Istio desde a 1.24 (2024) | muito usado como CNI; recursos de mesh mais novos |

!!! note "gRPC sem proxy"
    Uma quarta opção dispensa o proxy: bibliotecas gRPC podem receber a configuração do mesh diretamente do plano de controle (o protocolo xDS). É eficiente, mas só funciona para serviços gRPC escritos com uma biblioteca compatível.

??? question "Pense antes: o BoxOffice tem 9 serviços × 6 réplicas, e cada sidecar reserva 50 MB de memória. Quanto o mesh custa em memória?"

    54 pods × 50 MB ≈ **2,7 GB** só para sidecars (uma reserva ilustrativa; meça a sua), mais CPU proporcional ao tráfego. Durante uma venda relâmpago, quando o autoscaler leva `order` e `inventory` a 40 réplicas cada, os sidecars escalam junto. Esse custo linear é a principal motivação dos planos de dados ambient e eBPF.

---

## Identidade e mTLS { #mtls }

Como `payment` sabe que uma chamada vem mesmo de `order`? Endereços IP não provam nada — pods são recriados com novos IPs, e o atacante no pod `search` comprometido pode enviar de qualquer IP. O mesh dá a cada workload uma **identidade criptográfica**.

- **TLS** (Transport Layer Security) — o servidor prova a sua identidade com um **certificado X.509** assinado por uma autoridade certificadora; o canal é criptografado.
- **mTLS** (TLS mútuo) — o cliente *também* apresenta um certificado. Os dois lados são autenticados.
- **SPIFFE** (Secure Production Identity Framework For Everyone)[^4] — um padrão de nomes para identidades de workloads, `spiffe://<trust-domain>/<path>`. O Istio usa `spiffe://cluster.local/ns/<namespace>/sa/<service-account>`: **a identidade é a service account do Kubernetes**.
- **SVID** (SPIFFE Verifiable Identity Document) — o certificado X.509 de vida curta que carrega essa identidade, rotacionado automaticamente (o tempo de vida padrão do Istio é 24 horas; o do SPIRE, uma hora).

``` diagram-sim
sequenceDiagram
    autonumber
    participant O as order (proxy)
    participant CA as CA do mesh (istiod)
    participant P as payment (proxy)
    O->>CA: CSR + prova do token da service account
    CA-->>O: SVID spiffe://cluster.local/ns/boxoffice/sa/order (24 h)
    P->>CA: CSR + prova do token da service account
    CA-->>P: SVID spiffe://cluster.local/ns/boxoffice/sa/payment
    O->>P: ClientHello
    P-->>O: certificado de payment + CertificateRequest
    O->>O: verifica o SVID de payment contra o trust bundle
    O->>P: certificado de order + prova da chave privada
    P->>P: verifica o SVID de order, lê o seu SPIFFE ID
    P->>P: política de autorização: sa/order pode POST /charges? → permitir
    Note over O,P: canal criptografado, as duas identidades provadas, política aplicada
```

### Ligue o mTLS estrito { #turn-on-strict-mtls }

Por padrão, o Istio aceita tanto texto puro quanto mTLS (modo *permissive*), para que os serviços migrem aos poucos. Quando todo workload tiver um proxy, torne-o estrito:

```yaml
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: default
  namespace: boxoffice
spec:
  mtls:
    mode: STRICT        # reject any plain-text connection to pods in this namespace
```

### mTLS autentica; uma política autoriza { #mtls-authenticates-a-policy-authorizes }

Um certificado válido diz *quem* está chamando — não se ele *pode*. Isso é uma **política de autorização**, avaliada pelo proxy em toda requisição. Só `order` pode cobrar cartões:

=== "Istio"

    ```yaml
    apiVersion: security.istio.io/v1
    kind: AuthorizationPolicy
    metadata:
      name: payment-allow-order
      namespace: boxoffice
    spec:
      selector:
        matchLabels:
          app: payment
      action: ALLOW
      rules:
        - from:
            - source:
                principals: ["cluster.local/ns/boxoffice/sa/order"]
          to:
            - operation:
                methods: ["POST"]
                paths: ["/charges", "/refunds"]
    ```

    Assim que um workload tem pelo menos uma política `ALLOW`, qualquer requisição que não case com nenhuma regra é **negada**. O pod `search` comprometido recebe `403 RBAC: access denied`.

=== "Linkerd"

    ```yaml
    # API versions change between Linkerd releases: check yours
    apiVersion: policy.linkerd.io/v1beta3
    kind: Server
    metadata:
      name: payment-http
      namespace: boxoffice
    spec:
      podSelector:
        matchLabels:
          app: payment
      port: 8080
      proxyProtocol: HTTP/1
    ---
    apiVersion: policy.linkerd.io/v1alpha1
    kind: MeshTLSAuthentication
    metadata:
      name: order-only
      namespace: boxoffice
    spec:
      identities:
        - "order.boxoffice.serviceaccount.identity.linkerd.cluster.local"
    ---
    apiVersion: policy.linkerd.io/v1alpha1
    kind: AuthorizationPolicy
    metadata:
      name: payment-allow-order
      namespace: boxoffice
    spec:
      targetRef:
        group: policy.linkerd.io
        kind: Server
        name: payment-http
      requiredAuthenticationRefs:
        - group: policy.linkerd.io
          kind: MeshTLSAuthentication
          name: order-only
    ```

    O Linkerd também nomeia a identidade a partir da service account; a política se associa a um `Server` (uma porta de um conjunto de pods).

!!! example "BoxOffice — o grafo de chamadas como política"

    Desenhe as arestas permitidas uma vez e transforme cada uma em uma política: `gateway → order, catalog, search, auth`; `order → inventory, payment, notification (via Kafka)`; `assistant → catalog, order (somente leitura)`. Todo o resto é negado. O diagrama no documento de projeto e as políticas no repositório são a mesma coisa — revisáveis em um pull request.

---

## Políticas de tráfego { #traffic-policy }

O segundo grande trabalho de um mesh é moldar o tráfego: timeouts, retries, circuit breaking e divisão.

### Timeouts e retries por rota { #timeouts-and-retries-per-route }

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: payment
  namespace: boxoffice
spec:
  hosts: ["payment"]
  http:
    - route:
        - destination:
            host: payment
            subset: v1
          weight: 90
        - destination:
            host: payment
            subset: v2        # canary: 10% of the traffic
          weight: 10
      timeout: 3s             # total budget for the call
      retries:
        attempts: 2
        perTryTimeout: 1s
        retryOn: connect-failure,refused-stream,unavailable
```

Três decisões estão codificadas aqui: um **canary** manda 10% das chamadas para `v2`; a chamada inteira tem um **orçamento de 3 segundos**; e os retries só acontecem em falhas nas quais a requisição certamente não chegou à aplicação (`connect-failure`, `refused-stream`, `unavailable`). Repetir um `POST /charges` depois de um timeout poderia cobrar o cliente duas vezes — é para isso que existem as **chaves de idempotência** (veja [Computação — integrações](../../compute/integrations/index.md)).

### Circuit breaking com detecção de outliers { #circuit-breaking-with-outlier-detection }

```yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: payment
  namespace: boxoffice
spec:
  host: payment
  subsets:
    - name: v1
      labels: { version: v1 }
    - name: v2
      labels: { version: v2 }
  trafficPolicy:
    connectionPool:
      http:
        http2MaxRequests: 200          # bulkhead: max concurrent requests
        maxRequestsPerConnection: 50
    outlierDetection:
      consecutive5xxErrors: 5          # eject a replica after 5 errors in a row
      interval: 10s
      baseEjectionTime: 30s
      maxEjectionPercent: 50           # never eject more than half the replicas
```

A **detecção de outliers** tira uma *réplica* problemática do pool de balanceamento por um tempo — um circuit breaker por instância. Os limites do **pool de conexões** são um bulkhead: quando `payment` está lento, no máximo 200 requisições esperam por ele, em vez de todas as threads de `order`.

**Experimente.** Abra o cenário `cascading-failure`: uma dependência externa lenta, sem timeouts, esgota as threads de quem a chama, e requisições sem relação começam a falhar. Ligue o timeout e o circuit breaker, rode de novo e compare a taxa de erros e o p99 das outras rotas. No BoxOffice, o timeout do `VirtualService` e os limites da `DestinationRule` do mesh são uma forma de aplicar exatamente essa correção sem tocar no código.

<div class="sdp" data-scenario="cascading-failure" data-mode="compact" data-height="520" data-profile="load"></div>

!!! warning "Retries em dois lugares se multiplicam"
    Se `order` usa Resilience4j com 3 tentativas e o mesh acrescenta mais 2 por tentativa, um clique do usuário pode virar 3 × 3 = 9 chamadas a um `payment` que já está sofrendo — uma tempestade de retries. Escolha **uma camada** que faz retry (normalmente o mesh, ou a biblioteca cliente, não os dois) e mantenha um orçamento de retries.

### Gateway API para o mesh (GAMMA) { #gateway-api-for-the-mesh-gamma }

A **Gateway API** do Kubernetes nasceu como sucessora do Ingress para o tráfego norte–sul (veja [Borda](../../edge/index.md)). A iniciativa GAMMA estende o mesmo recurso `HTTPRoute` ao tráfego leste–oeste dentro do mesh, de modo que um canary fica igual no Istio, no Linkerd ou no Cilium:

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: payment-canary
  namespace: boxoffice
spec:
  parentRefs:
    - group: ""
      kind: Service           # attach to a Service = mesh (east-west) routing
      name: payment
      port: 8080
  rules:
    - backendRefs:
        - name: payment-v1
          port: 8080
          weight: 90
        - name: payment-v2
          port: 8080
          weight: 10
```

---

## Política do mesh e NetworkPolicy: duas camadas { #network-policy }

Uma **NetworkPolicy** do Kubernetes é um firewall para pods em L3/L4 (IP e porta), aplicado pelo plugin CNI (Calico, Cilium)[^5]. Uma política de autorização do mesh atua em L7, com identidade criptográfica. São camadas complementares de defesa em profundidade:

| | NetworkPolicy | Política de autorização do mesh |
|---|---|---|
| Camada | L3/L4 — IPs, portas | L7 — identidade, método, caminho, cabeçalhos |
| Identidade | labels do pod → IPs | identidade SPIFFE no certificado |
| Aplicada por | o CNI, no kernel | o proxy (sidecar, ztunnel, waypoint) |
| Resiste a um proxy contornado? | sim | não |
| Consegue dizer "só `POST /charges`"? | não | sim |

Comece com **negar por padrão** na camada de rede e depois abra só as arestas do grafo de chamadas:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
  namespace: boxoffice
spec:
  podSelector: {}
  policyTypes: ["Ingress"]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: payment-from-order
  namespace: boxoffice
spec:
  podSelector:
    matchLabels:
      app: payment
  policyTypes: ["Ingress"]
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: order
      ports:
        - port: 8080
```

!!! warning "O egress é a metade esquecida"
    A maioria dos times escreve só políticas de entrada. Políticas de saída (e um **egress gateway**) decidem o que um pod pode alcançar *lá fora*: só `payment` deve alcançar o endereço do provedor; `search` não deve alcançar nada na Internet. É isso que transforma um pod comprometido em um beco sem saída, em vez de um canal de exfiltração de dados.

---

## Custos e quando não usar um mesh { #costs-and-when-not-to-use-a-mesh }

Um mesh é poderoso e caro de operar. Ele acrescenta um plano de controle para operar e atualizar, proxies que consomem CPU e memória, alguns milissegundos por salto, uma nova classe de falhas ("o proxy rejeitou") e uma curva de aprendizado íngreme para depurar.

| Situação | Recomendação |
|---|---|
| 3–5 serviços, um time, uma linguagem | provavelmente sem mesh: TLS no ingress, NetworkPolicy, uma biblioteca de resiliência |
| Muitos serviços, várias linguagens e times | um mesh dá mTLS, política e telemetria uniformes |
| Conformidade exige criptografia em trânsito em todo lugar | um mesh (ou criptografia no CNI) é o jeito mais barato de comprovar |
| Caminho crítico sensível a latência (microssegundos) | meça; considere ambient/eBPF ou gRPC sem proxy |
| Só precisa de mTLS + política L4 | ambient (só ztunnel) ou Cilium, sem proxies L7 |

!!! tip "Na entrevista"
    Traga o mesh quando o projeto tiver **muitos serviços** e alguém perguntar sobre segurança ou resiliência entre serviços: "dentro do cluster, um service mesh dá a cada serviço uma identidade e TLS mútuo; políticas de autorização dizem que só `order` pode chamar `payment`; timeouts, retries e detecção de outliers são configurados por rota." Depois mostre que conhece o custo: "ele acrescenta um salto de proxy e complexidade operacional — planos de dados ambient ou eBPF reduzem a sobrecarga por pod; para um punhado de serviços, eu não usaria."

!!! success "Boas práticas"

    - **Implante o mTLS em etapas, com prazo** — modo permissivo, acompanhe a métrica de conexões em texto puro cair a zero, e então STRICT por namespace numa data escrita no plano.
    - **Derive as políticas de autorização do grafo de chamadas** — negar por padrão por namespace, e então permitir cada aresta (`order → payment`) pela identidade do serviço; o grafo serve também de documentação.
    - **Ponha retries em uma camada só, com orçamento de retries** — por exemplo, no máximo 20% de requisições extras, e só para métodos idempotentes; a outra camada fica com os timeouts.
    - **Faça o timeout de cada salto menor que o de quem chama** — o gateway espera 5 s (o [lab 4](../../../hands-on/4/gateway/index.md) define `response-timeout: 5s`), então `order → payment` precisa desistir bem antes disso.
    - **Orce o data plane** — defina requests de CPU e memória para os proxies e conte cerca de 1 ms por salto no orçamento de latência de um caminho com 4–5 saltos.
    - **Mantenha os certificados dos workloads curtos e renovados pela malha** — horas, não anos (o Istio emite certificados de 24 horas por padrão), para que um certificado roubado expire sozinho.

!!! warning "Armadilhas comuns"
    - **Deixar o mTLS em modo permissive para sempre** — texto puro continua aceito, então o mesh não criptografa nada que interesse a um atacante.
    - **mTLS sem políticas de autorização** — todo workload do mesh ainda pode chamar `payment`; você só criptografou o ataque.
    - **Retries duplos** (biblioteca + mesh) — tempestades de retries no primeiro incidente.
    - **Repetir chamadas não idempotentes** depois de um timeout — cobranças em dobro.
    - **Achar que o mesh substitui a autorização do usuário** — o mesh conhece o *serviço*; só `order` sabe se *este usuário* é dono do pedido 1042.
    - **Esquecer o egress** — o mesh protege as chamadas entre serviços, mas o pod comprometido ainda alcança a Internet, a menos que a saída seja restringida.

---

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    CP["plano de controle<br/>config + CA"] --> DP["plano de dados:<br/>sidecar, ambient, eBPF"]
    CP --> SVID["identidade SPIFFE (SVID)<br/>da service account"]
    SVID --> MTLS["mTLS estrito"]
    MTLS --> AUTHZ["política de autorização<br/>só order → payment"]
    AUTHZ --> NP["NetworkPolicy L3/L4<br/>negar por padrão + saída"]
    AUTHZ --> ZT["PEP para workloads<br/>→ Zero Trust"]
    DP --> TP["timeouts, retries,<br/>outlier detection"]
    TP --> REL["padrões de resiliência<br/>→ Confiabilidade"]
    DP --> CAN["pesos no HTTPRoute (GAMMA)<br/>→ canary em Cloud-native"]
    DP --> TEL["sinais de ouro por salto<br/>→ Observabilidade"]
```

**Componentes da paleta:** [`mesh`](../../../reference/components/network/index.md#mesh) · [`app`](../../../reference/components/compute/index.md#app) (os serviços atrás de cada proxy) · [`ingress`](../../../reference/components/edge/index.md#ingress) (Gateway API, norte–sul) · [`metrics`](../../../reference/components/observability/index.md#metrics) · [`tracing`](../../../reference/components/observability/index.md#tracing) (telemetria de cada salto). **Cenários:** `cascading-failure`, `retry-storm`. **Continua em:** [Zero Trust](../zero-trust/index.md), [Confiabilidade — padrões](../../reliability/patterns/index.md#circuit-breaker), [Observabilidade — sinais](../../observability/signals/index.md), [Borda — balanceamento no Kubernetes](../../edge/load-balancing/index.md#kubernetes), [Cloud-native — entrega](../../cloud-native/delivery/index.md) (canary).

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - Um service mesh = **plano de dados** (proxies em toda chamada) + **plano de controle** (configuração + autoridade certificadora); ele tira mTLS, política, resiliência e telemetria do código.
    - **Sidecar** dá L7 completo em todo lugar a um custo por pod; **ambient** separa o L4 (ztunnel por nó) do L7 opcional (waypoints); **eBPF** faz L3/L4 no kernel.
    - **mTLS** autentica workloads com identidades SPIFFE derivadas das service accounts; uma **política de autorização** decide quem pode chamar o quê.
    - Políticas de tráfego — **timeouts, retries, detecção de outliers, pesos de canary** — são declaradas por rota; faça retry em uma só camada, e só de chamadas idempotentes.
    - **NetworkPolicy** (L3/L4, negar por padrão, entrada *e* saída) e política do mesh (L7, identidade) são camadas complementares. Para um punhado de serviços, um mesh pode não valer a pena.

---

[^1]: MORGAN, W. [What's a service mesh? And why do I need one?](https://buoyant.io/service-mesh-manifesto){target="_blank"}. Buoyant. Veja também a [documentação do Linkerd](https://linkerd.io/2/overview/){target="_blank"}.
[^2]: ISTIO. [Ambient mode overview](https://istio.io/latest/docs/ambient/overview/){target="_blank"} e [Security — authorization policy](https://istio.io/latest/docs/reference/config/security/authorization-policy/){target="_blank"}.
[^3]: CILIUM. [Cilium Service Mesh](https://docs.cilium.io/en/stable/network/servicemesh/){target="_blank"}.
[^4]: SPIFFE. [SPIFFE Overview](https://spiffe.io/docs/latest/spiffe-about/overview/){target="_blank"}.
[^5]: KUBERNETES. [Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/){target="_blank"}; [Gateway API — GAMMA (service mesh)](https://gateway-api.sigs.k8s.io/mesh/){target="_blank"}.
