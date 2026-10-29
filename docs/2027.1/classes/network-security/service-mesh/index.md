
BoxOffice now runs nine services in Kubernetes. Each team has re-implemented the same things in its own way: `order` has a 2-second timeout to `payment`, `inventory` has none; `catalog` retries three times, `search` retries forever; nobody encrypts traffic inside the cluster because "it's internal"; and when security asks *"which services can call `payment`?"*, the honest answer is "any pod that knows the URL". A **service mesh** moves these cross-cutting concerns — encryption, identity, authorization, timeouts, retries, traffic splitting, telemetry — out of the application code and into a uniform infrastructure layer.

---

## What a service mesh is

A service mesh is a dedicated infrastructure layer that handles **service-to-service communication**[^1]. It has two parts:

- **Data plane** — proxies that sit in the path of every request between services. They terminate and originate TLS, enforce policies, retry, time out, balance load and emit metrics and traces.
- **Control plane** — the brain that configures the proxies: it distributes routing rules and policies, and acts as a **certificate authority** that issues each workload its identity.

``` diagram
flowchart TB
    subgraph cp ["Control plane (istiod / linkerd-control-plane)"]
        CFG["config + policy"]
        CA["certificate authority"]
    end
    subgraph dp ["Data plane"]
        subgraph po ["pod: order"]
            O["order app"] --- PO["proxy"]
        end
        subgraph pp ["pod: payment"]
            PP["proxy"] --- P["payment app"]
        end
    end
    PO <-->|"mTLS"| PP
    CFG -.->|"routes, policies"| PO & PP
    CA -.->|"certificates (rotated)"| PO & PP
```

The application still calls `http://payment:8080/charges` in plain HTTP. The proxy on the way out upgrades it to **mutual TLS**, the proxy on the way in verifies the caller's identity, checks the policy and hands plain HTTP to `payment`. Neither application changed a line.

### What you get

| Capability | Without a mesh | With a mesh |
|---|---|---|
| Encryption in transit | each team configures TLS (usually nobody does inside the cluster) | mTLS everywhere, certificates rotated automatically |
| Service identity | IP addresses, shared secrets | a cryptographic identity per workload (SPIFFE) |
| Authorization between services | in code, if at all | declarative policies: "only `order` may `POST /charges` on `payment`" |
| Timeouts, retries, circuit breaking | libraries in each language (Resilience4j, Polly…) | uniform config per route |
| Traffic splitting (canary, mirroring) | in the load balancer or in code | weights per route, header-based routing |
| Golden-signal telemetry | each service instruments itself | request rate, errors and latency for every hop, out of the box |

The mesh is the natural home of three topics of the course: **reliability patterns** (see [Reliability](../../reliability/index.md)), **observability** of every hop (see [Observability](../../observability/index.md)) and **Zero Trust** between services ([Zero Trust](../zero-trust/index.md)).

---

## Data-plane architectures: sidecar, ambient, eBPF

Where does the proxy run? Three designs are in production today[^2][^3].

=== "Sidecar"

    One proxy container (Envoy for Istio, `linkerd2-proxy` for Linkerd) is **injected into every pod**. All traffic in and out of the pod is redirected through it.

    - Every hop is full L7 (HTTP-aware): retries, header routing, per-path policies.
    - Cost: one proxy per pod — memory and CPU multiplied by the number of pods, an extra hop on each side of every call, and the sidecar's lifecycle is coupled to the app (upgrading the mesh means restarting every pod; jobs need the sidecar to exit).

=== "Ambient (Istio)"

    The mesh is split into two layers:

    - **ztunnel** — one per **node**, a small proxy that handles L4: mTLS, identity, L4 authorization and telemetry for all pods on the node.
    - **waypoint proxy** — an optional Envoy deployed **per namespace or per service** only when L7 features are needed (HTTP routing, retries, path-based policies).

    Pods are not modified; adding a namespace to the mesh is a label. You pay for L7 only where you use it.

=== "eBPF / sidecarless (Cilium)"

    The **eBPF** (extended Berkeley Packet Filter) programs in the Linux kernel handle L3/L4 — routing, NetworkPolicy, load balancing, transparent encryption (WireGuard or IPsec) — with no proxy per pod. L7 features go through a shared per-node Envoy. Identity is tied to Kubernetes labels and, for mutual authentication, to SPIFFE-style identities.

| | Sidecar | Ambient | eBPF (Cilium) |
|---|---|---|---|
| Proxy placement | one per pod | ztunnel per node + optional waypoint | kernel + shared Envoy per node |
| L7 everywhere? | yes | only where a waypoint is deployed | only where L7 policy is configured |
| Resource overhead (qualitative) | highest — grows with pod count | low for L4, pay per waypoint | lowest for L3/L4 |
| Added latency per hop | two proxies on the path | node-level hop; +waypoint for L7 | kernel fast path |
| Upgrade impact | restart every pod | upgrade node agents and waypoints | upgrade the node agent |
| Blast radius of a proxy bug | one pod | all pods on the node (ztunnel) | the node |
| Maturity | longest in production | GA in Istio since 1.24 (2024) | widely used as CNI; mesh features newer |

!!! note "Proxyless gRPC"
    A fourth option skips the proxy entirely: gRPC libraries can receive mesh configuration directly from the control plane (the xDS protocol). It is efficient but only works for gRPC services written with a supporting library.

??? question "Think first: BoxOffice has 9 services × 6 replicas, and each sidecar reserves 50 MB of memory. What does the mesh cost in memory?"

    54 pods × 50 MB ≈ **2.7 GB** just for sidecars (an illustrative reservation; measure yours), plus CPU proportional to the traffic. During a flash sale, when the autoscaler takes `order` and `inventory` to 40 replicas each, the sidecars scale too. That linear cost is the main motivation for ambient and eBPF data planes.

---

## Identity and mTLS { #mtls }

How does `payment` know that a call really comes from `order`? IP addresses prove nothing — pods are recreated with new IPs, and the attacker in the compromised `search` pod can send from any IP it likes. The mesh gives each workload a **cryptographic identity**.

- **TLS** (Transport Layer Security) — the server proves its identity with an **X.509 certificate** signed by a certificate authority; the channel is encrypted.
- **mTLS** (mutual TLS) — the client *also* presents a certificate. Both sides are authenticated.
- **SPIFFE** (Secure Production Identity Framework For Everyone)[^4] — a standard name for workload identities, `spiffe://<trust-domain>/<path>`. Istio uses `spiffe://cluster.local/ns/<namespace>/sa/<service-account>`: **the identity is the Kubernetes service account**.
- **SVID** (SPIFFE Verifiable Identity Document) — the short-lived X.509 certificate that carries that identity, rotated automatically (Istio's default lifetime is 24 hours; SPIRE's default is one hour).

``` diagram-sim
sequenceDiagram
    autonumber
    participant O as order (proxy)
    participant CA as Mesh CA (istiod)
    participant P as payment (proxy)
    O->>CA: CSR + proof of service account token
    CA-->>O: SVID spiffe://cluster.local/ns/boxoffice/sa/order (24 h)
    P->>CA: CSR + proof of service account token
    CA-->>P: SVID spiffe://cluster.local/ns/boxoffice/sa/payment
    O->>P: ClientHello
    P-->>O: payment certificate + CertificateRequest
    O->>O: verify payment's SVID against the trust bundle
    O->>P: order certificate + proof of private key
    P->>P: verify order's SVID, read its SPIFFE ID
    P->>P: authorization policy: may sa/order POST /charges? → allow
    Note over O,P: encrypted channel, both identities proven, policy applied
```

### Turn on strict mTLS

By default Istio accepts both plain-text and mTLS (*permissive* mode) so that services can migrate gradually. Once every workload has a proxy, make it strict:

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

### mTLS authenticates; a policy authorizes

A valid certificate says *who* is calling — not whether they *may*. That is an **authorization policy**, evaluated by the proxy on every request. Only `order` may charge cards:

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

    Once a workload has at least one `ALLOW` policy, any request that matches no rule is **denied**. The compromised `search` pod gets `403 RBAC: access denied`.

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

    Linkerd names the identity after the service account too; the policy attaches to a `Server` (a port of a set of pods).

!!! example "BoxOffice — the service call graph as policy"

    Draw the allowed edges once and turn each into a policy: `gateway → order, catalog, search, auth`; `order → inventory, payment, notification (via Kafka)`; `assistant → catalog, order (read-only)`. Everything else is denied. The diagram in the design document and the policies in the repository are the same thing — reviewable in a pull request.

---

## Traffic policy { #traffic-policy }

The second big job of a mesh is shaping traffic: timeouts, retries, circuit breaking and splitting.

### Timeouts and retries per route

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

Three decisions are encoded here: a **canary** sends 10% of the calls to `v2`; the whole call has a **3-second budget**; and retries happen only on failures where the request certainly did not reach the application (`connect-failure`, `refused-stream`, `unavailable`). Retrying a `POST /charges` after a timeout could charge the customer twice — that is what **idempotency keys** are for (see [Compute — integrations](../../compute/integrations/index.md)).

### Circuit breaking with outlier detection

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

**Outlier detection** removes a misbehaving *replica* from the load-balancing pool for a while — a per-instance circuit breaker. The **connection pool** limits are a bulkhead: when `payment` is slow, at most 200 requests wait on it, instead of every thread of `order`.

**Try it.** Open the `cascading-failure` scenario: a slow third-party dependency with no timeouts exhausts the caller's threads, and unrelated requests start failing. Turn on the timeout and the circuit breaker, run again, and compare the error rate and p99 of the other routes. In BoxOffice, the mesh `VirtualService` timeout and `DestinationRule` limits are one way to apply exactly that fix without touching the code.

<div class="sdp" data-scenario="cascading-failure" data-mode="compact" data-height="520" data-profile="load"></div>

!!! warning "Retries in two places multiply"
    If `order` uses Resilience4j with 3 attempts and the mesh adds 2 more per attempt, one user click can become 3 × 3 = 9 calls to a struggling `payment` — a retry storm. Decide **one layer** that retries (usually the mesh, or the client library, not both) and keep a retry budget.

### Gateway API for the mesh (GAMMA)

The Kubernetes **Gateway API** started as the successor of Ingress for north–south traffic (see [Edge](../../edge/index.md)). The GAMMA initiative extends the same `HTTPRoute` resource to east–west traffic inside the mesh, so a canary looks the same in Istio, Linkerd or Cilium:

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

## Mesh policy and NetworkPolicy: two layers { #network-policy }

A Kubernetes **NetworkPolicy** is a firewall for pods at L3/L4 (IP and port), enforced by the CNI plugin (Calico, Cilium)[^5]. A mesh authorization policy works at L7 with cryptographic identity. They are complementary layers of defense in depth:

| | NetworkPolicy | Mesh authorization policy |
|---|---|---|
| Layer | L3/L4 — IPs, ports | L7 — identity, method, path, headers |
| Identity | pod labels → IPs | SPIFFE identity in the certificate |
| Enforced by | the CNI, in the kernel | the proxy (sidecar, ztunnel, waypoint) |
| Survives a bypassed proxy? | yes | no |
| Can say "only `POST /charges`"? | no | yes |

Start with **default deny** at the network layer, then open only the edges of the call graph:

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

!!! warning "Egress is the forgotten half"
    Most teams write ingress policies only. Egress policies (and an **egress gateway**) decide what a pod may reach *outside*: only `payment` should reach the provider's address; `search` should reach nothing on the Internet. That is what turns a compromised pod into a dead end instead of a data-exfiltration channel.

---

## Costs and when not to use a mesh

A mesh is powerful and expensive to run. It adds a control plane to operate and upgrade, proxies that consume CPU and memory, a few milliseconds per hop, a new class of failures ("the proxy rejected it"), and a steep learning curve for debugging.

| Situation | Recommendation |
|---|---|
| 3–5 services, one team, one language | probably no mesh: TLS at the ingress, NetworkPolicy, a resilience library |
| Many services, several languages and teams | a mesh gives uniform mTLS, policy and telemetry |
| Compliance requires encryption in transit everywhere | a mesh (or CNI-level encryption) is the cheapest way to prove it |
| Latency-critical hot path (microseconds) | measure; consider ambient/eBPF or proxyless gRPC |
| Only need mTLS + L4 policy | ambient (ztunnel only) or Cilium, without L7 proxies |

!!! tip "In the interview"
    Bring up a mesh when the design has **many services** and someone asks about service-to-service security or resilience: "inside the cluster, a service mesh gives every service an identity and mutual TLS; authorization policies say only `order` can call `payment`; timeouts, retries and outlier detection are configured per route." Then show you know the cost: "it adds a proxy hop and operational complexity — ambient or eBPF data planes reduce the per-pod overhead; for a handful of services I'd skip it."

!!! success "Best practices"

    - **Roll out mTLS in steps with a deadline** — permissive mode, watch the plaintext-connection metric fall to zero, then STRICT per namespace on a date written in the plan.
    - **Derive authorization policies from the call graph** — deny by default per namespace, then allow each edge (`order → payment`) by service identity; the graph doubles as documentation.
    - **Put retries in one layer only, with a retry budget** — e.g. at most 20% extra requests, and only for idempotent methods; the other layer gets timeouts.
    - **Make each hop's timeout shorter than its caller's** — the gateway waits 5 s ([lab 4](../../../hands-on/4/gateway/index.md) sets `response-timeout: 5s`), so `order → payment` must give up well before that.
    - **Budget the data plane** — set CPU and memory requests for the proxies, and count about 1 ms per hop in the latency budget of a path with 4–5 hops.
    - **Keep workload certificates short-lived and rotated by the mesh** — hours, not years (Istio issues 24-hour certificates by default), so a stolen certificate expires on its own.

!!! warning "Common pitfalls"
    - **Leaving mTLS in permissive mode forever** — plain text is still accepted, so the mesh encrypts nothing an attacker cares about.
    - **mTLS without authorization policies** — every workload in the mesh can still call `payment`; you only encrypted the attack.
    - **Double retries** (library + mesh) — retry storms on the first incident.
    - **Retrying non-idempotent calls** after a timeout — double charges.
    - **Assuming the mesh replaces user authorization** — the mesh knows the *service*; only `order` knows whether *this user* owns order 1042.
    - **Forgetting egress** — the mesh protects calls between services, but the compromised pod can still reach the Internet unless egress is restricted.

---

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    CP["control plane<br/>config + CA"] --> DP["data plane:<br/>sidecar, ambient, eBPF"]
    CP --> SVID["SPIFFE identity (SVID)<br/>from the service account"]
    SVID --> MTLS["strict mTLS"]
    MTLS --> AUTHZ["authorization policy<br/>only order → payment"]
    AUTHZ --> NP["NetworkPolicy L3/L4<br/>default deny + egress"]
    AUTHZ --> ZT["PEP for workloads<br/>→ Zero Trust"]
    DP --> TP["timeouts, retries,<br/>outlier detection"]
    TP --> REL["resilience patterns<br/>→ Reliability"]
    DP --> CAN["HTTPRoute weights (GAMMA)<br/>→ canary in Cloud-native"]
    DP --> TEL["golden signals per hop<br/>→ Observability"]
```

**Palette components:** [`mesh`](../../../reference/components/network/index.md#mesh) · [`app`](../../../reference/components/compute/index.md#app) (the services behind each proxy) · [`ingress`](../../../reference/components/edge/index.md#ingress) (Gateway API, north–south) · [`metrics`](../../../reference/components/observability/index.md#metrics) · [`tracing`](../../../reference/components/observability/index.md#tracing) (telemetry of every hop). **Scenarios:** `cascading-failure`, `retry-storm`. **Continues in:** [Zero Trust](../zero-trust/index.md), [Reliability — patterns](../../reliability/patterns/index.md#circuit-breaker), [Observability — signals](../../observability/signals/index.md), [Edge — load balancing in Kubernetes](../../edge/load-balancing/index.md#kubernetes), [Cloud-native — delivery](../../cloud-native/delivery/index.md) (canary).

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - A service mesh = **data plane** (proxies on every call) + **control plane** (config + certificate authority); it moves mTLS, policy, resilience and telemetry out of the code.
    - **Sidecar** gives full L7 everywhere at a per-pod cost; **ambient** splits L4 (ztunnel per node) from optional L7 (waypoints); **eBPF** does L3/L4 in the kernel.
    - **mTLS** authenticates workloads with SPIFFE identities derived from service accounts; an **authorization policy** decides who may call what.
    - Traffic policy — **timeouts, retries, outlier detection, canary weights** — is declared per route; retry in only one layer, and only idempotent calls.
    - **NetworkPolicy** (L3/L4, default deny, ingress *and* egress) and mesh policy (L7, identity) are complementary layers. For a handful of services, a mesh may not be worth it.

---

[^1]: MORGAN, W. [What's a service mesh? And why do I need one?](https://buoyant.io/service-mesh-manifesto){target="_blank"}. Buoyant. See also the [Linkerd documentation](https://linkerd.io/2/overview/){target="_blank"}.
[^2]: ISTIO. [Ambient mode overview](https://istio.io/latest/docs/ambient/overview/){target="_blank"} and [Security — authorization policy](https://istio.io/latest/docs/reference/config/security/authorization-policy/){target="_blank"}.
[^3]: CILIUM. [Cilium Service Mesh](https://docs.cilium.io/en/stable/network/servicemesh/){target="_blank"}.
[^4]: SPIFFE. [SPIFFE Overview](https://spiffe.io/docs/latest/spiffe-about/overview/){target="_blank"}.
[^5]: KUBERNETES. [Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/){target="_blank"}; [Gateway API — GAMMA (service mesh)](https://gateway-api.sigs.k8s.io/mesh/){target="_blank"}.
