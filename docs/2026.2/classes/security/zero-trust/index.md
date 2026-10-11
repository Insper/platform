
Picture the store running in Kubernetes. A vulnerable JSON library lets an attacker execute code inside one `product-service` pod. From there, in a classic setup, the attacker can call `account-service` directly with the header `id-account: <any id>` and read every customer, connect to Postgres with the password found in the pod's environment variables, and reach any other pod in the cluster — because "inside the cluster" means "trusted". Nothing the gateway does helps: the attacker is already behind it. This page is about limiting what an attacker can do **after** one component is compromised.

---

## From perimeter security to Zero Trust

Traditional **perimeter security** (the "castle and moat" model) trusts everything inside the network and blocks everything outside. The problem: once an attacker is inside — via a compromised credential, a vulnerable dependency, or an insider — they can move from machine to machine. This is called **lateral movement**.

**Zero Trust** removes the idea of a trusted network. Its principle is **"never trust, always verify"**: every request is authenticated and authorized on its own merits, regardless of where it comes from. Google popularised the model with its BeyondCorp project[^1], and NIST standardised it in SP 800-207[^2].

``` mermaid-sim
flowchart LR
    subgraph perimeter ["Perimeter model"]
        fw["Firewall"] -->|"trusted zone"| int["Internal services<br>(trust each other implicitly)"]
    end
    subgraph zt ["Zero Trust model"]
        any["Any request<br>(internal or external)"] -->|"identity + context"| pep["Enforcement point<br>(gateway, sidecar)"]
        pep -->|"ask"| pdp["Policy decision"]
        pdp -->|"allow, least privilege"| res["Resource"]
        pdp -->|"deny"| rej["Rejected"]
    end
```

NIST names the two moving parts: a **Policy Enforcement Point (PEP)** sits in the path of the request and blocks or forwards it, and a **Policy Decision Point (PDP)** decides, from identity and context, whether the request is allowed. In the store, the **gateway** is the PEP for external traffic; inside the cluster, a **service-mesh sidecar** next to each service plays the same role for internal calls.

### Zero Trust principles

| Principle | What it means | Mechanisms |
|---|---|---|
| **Verify identity explicitly** | every user *and every workload* proves who it is on every request | OAuth 2.0 / OIDC tokens, mTLS, SPIFFE |
| **Least privilege** | grant only the access needed, for only as long as needed | scopes, RBAC/ABAC, short-lived tokens and credentials |
| **Assume breach** | design as if an attacker is already inside; limit the blast radius | micro-segmentation (NetworkPolicy), encryption in transit and at rest |
| **Continuous validation** | trust is re-evaluated, not granted once | short token TTLs, re-authentication for sensitive actions, monitoring |

### Example: the compromised pod, again

| Attacker step | Perimeter model | Zero Trust control | Section |
|---|---|---|---|
| Call `account-service` with a forged `id-account` header | accepted — the caller is "inside" | `account-service` accepts calls only from the gateway's workload identity (mTLS + authorization policy) | [mTLS](#service-to-service-identity-mtls) |
| Open a connection to any pod | allowed | NetworkPolicy allows only declared flows; `product-service` → `account-service` is not one of them | [NetworkPolicy](#network-segmentation-with-networkpolicy) |
| Read the DB password from the environment and use it later | works for months | a short-lived, per-service credential that expires within the hour | [Secrets](#secrets-management) |

---

## Service-to-service identity: mTLS

How does `product-service` know that a call really comes from `order-service`? An IP address proves nothing — pods are recreated with new IPs, and an attacker can send from any pod. The answer is a cryptographic identity per workload.

- **TLS** (Transport Layer Security) — the protocol behind HTTPS. The **server** presents an **X.509 certificate** (its public key plus its name, signed by a **Certificate Authority**, CA); the client verifies it. The channel is encrypted, but the server does not know who the client is.
- **mTLS** (mutual TLS) — the server *also* asks for the client's certificate. **Both sides** present certificates and verify each other: the channel is encrypted **and** both identities are proven.

``` mermaid-sim
sequenceDiagram
    autonumber
    participant Order as order-service
    participant CA as SPIRE (workload CA)
    participant Prod as product-service

    Order->>CA: attest workload, request SVID
    CA-->>Order: X.509 SVID: spiffe://cluster.local/ns/store/sa/order-service
    Prod->>CA: attest workload, request SVID
    CA-->>Prod: X.509 SVID
    Order->>Prod: ClientHello
    Prod-->>Order: ServerHello + product cert + CertificateRequest
    Order->>Order: verify product cert against trust bundle
    Order->>Prod: order cert + CertificateVerify (proof of private key)
    Prod->>Prod: verify order cert, read SPIFFE ID
    Note over Order,Prod: encrypted channel + mutual identity
```

Issuing and rotating certificates by hand for dozens of services does not scale. **SPIFFE**[^3] (Secure Production Identity Framework for Everyone) standardises a workload identity — a URI such as `spiffe://cluster.local/ns/store/sa/order-service` — and the **SVID** (SPIFFE Verifiable Identity Document), a short-lived X.509 certificate carrying it. **SPIRE** is its reference implementation: it checks (*attests*) which workload is asking, typically from its Kubernetes service account, and issues certificates that live for about an hour by default and rotate automatically.

**Service meshes** (Istio, Linkerd) inject a sidecar proxy next to each pod that performs mTLS transparently — no application code changes. Istio derives the identity from the pod's Kubernetes service account in the same SPIFFE format.

### mTLS authenticates; a policy authorizes

mTLS proves *who* is calling; it does not decide whether the caller *may* call. That is an **authorization policy**, evaluated by the sidecar on every request. With Istio[^4], allowing only `order-service` to read products looks like this:

```yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: product-allow-order
  namespace: store
spec:
  selector:
    matchLabels:
      app: product-service
  action: ALLOW
  rules:
    - from:
        - source:
            principals: ["cluster.local/ns/store/sa/order-service"]
      to:
        - operation:
            methods: ["GET"]
            paths: ["/products/*"]
```

Once a workload has at least one `ALLOW` policy, requests that match none of its rules are denied.

---

## Network segmentation with NetworkPolicy

A Kubernetes **NetworkPolicy**[^5] is a firewall rule for pods: it selects pods by label and lists which other pods (or namespaces, or IP ranges) may connect to them, on which ports. It works at layers 3/4 (IP and port), so it complements mTLS: even if an attacker steals a certificate, the network refuses connections that were never declared.

The recommended pattern is **default deny, then allow explicitly**. First, deny all ingress to every pod in the namespace:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: store
spec:
  podSelector: {}        # all pods in the namespace
  policyTypes:
    - Ingress            # no ingress rules listed = nothing allowed
```

Then open each legitimate flow. This policy allows only `gateway-service` pods to reach `order-service` on port 8080:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: order-service-ingress
  namespace: store
spec:
  podSelector:
    matchLabels:
      app: order-service
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: gateway-service
      ports:
        - port: 8080
```

Policies are additive: a pod selected by any policy accepts only the traffic that at least one policy allows. A `podSelector` inside `from` matches pods **in the same namespace**; to allow another namespace, add a `namespaceSelector`.

!!! warning "A NetworkPolicy only works if the network plugin enforces it"
    The Kubernetes API accepts NetworkPolicy objects on any cluster, but they are enforced by the CNI (network) plugin. Calico and Cilium enforce them; the default minikube network does not, so the policy is silently ignored. To try it in [Hands-on 5](../../../hands-on/5/index.md), start the cluster with `minikube start --cni=calico`.

---

## Secrets management

A **secret** is any value that grants access: database passwords, the `JWT_SECRET_KEY` of Hands-on 3, API keys, the Docker Hub token of [Hands-on 4](../../../hands-on/4/index.md), private keys. Secrets must not live in source code, container images, or plain configuration — anything that gets copied, versioned, or logged.

!!! danger "Kubernetes Secrets are base64, not encrypted"
    A Kubernetes Secret stores data as base64-encoded strings. Base64 is **encoding**, not encryption — the Postgres secret of [Hands-on 5](../../../hands-on/5/index.md) decodes in one command:

    ```bash
    echo c3RvcmU= | base64 -d        # prints: store
    kubectl get secret postgres-secrets -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d
    ```

    Anyone allowed to read Secrets in the namespace — or to create a pod there that mounts them — can read them all. By default they are also stored unencrypted in etcd, and a `secrets.yaml` committed to Git is public to everyone with access to the repository[^6].

Minimum hygiene for native Secrets: enable **encryption at rest** for etcd[^7], restrict `get`/`list` on Secrets with **RBAC**, and keep secret manifests **out of Git** (or commit them only encrypted, e.g. with Sealed Secrets or SOPS). Beyond that, use an external secrets manager:

| Approach | Pros | Cons |
|---|---|---|
| **Kubernetes Secrets** | simple, native | base64 only; needs encryption at rest and RBAC discipline |
| **Cloud secret managers** (AWS Secrets Manager, GCP Secret Manager) | managed, automatic rotation, audit log | tied to one cloud; extra latency |
| **HashiCorp Vault** | dynamic secrets, any cloud or on-prem, fine-grained audit | operational overhead |

Tools such as the External Secrets Operator synchronise values from a cloud manager or Vault into native Secrets, so applications keep reading them the usual way.

HashiCorp Vault introduces **dynamic secrets**[^8]: instead of storing one long-lived database password shared by every replica, Vault creates a **short-lived, unique** database user for each requester, with a *lease* (for example, one hour). When the lease expires, Vault drops the user. A password stolen from a compromised pod stops working on its own, and the audit log shows exactly which pod used which credential.

The **Vault Agent Injector** pattern adds a sidecar that authenticates to Vault with the pod's service account and writes the secret into a file — here `/vault/secrets/db` — which the application reads; the credential never appears in the pod spec, a ConfigMap, or an environment variable[^9]:

```yaml
annotations:
  vault.hashicorp.com/agent-inject: "true"
  vault.hashicorp.com/role: "order-service"
  vault.hashicorp.com/agent-inject-secret-db: "database/creds/order-service"
```

!!! warning "Common mistakes"
    - **Secrets in Git**, even in a private repository or "just for the dev environment" — history keeps them forever; rotate any secret that was ever committed.
    - **One shared credential for every service** — when it leaks you cannot tell who used it, and rotating it breaks everyone at once.
    - **Secrets in logs and error messages** — mask them, as Jenkins does with `withCredentials`.
    - **Treating mTLS as authorization** — a valid certificate proves identity, not permission; add an authorization policy.

---

## Key takeaways

- **Zero Trust** drops the "trusted internal network": every request, internal or external, carries an identity and is checked against a policy (PEP + PDP).
- Design for **assume breach**: limit what a compromised pod can reach (NetworkPolicy), call (authorization policy) and read (short-lived secrets).
- **mTLS** gives each workload a cryptographic identity; SPIFFE/SPIRE or a service mesh issue and rotate those certificates automatically.
- **NetworkPolicy** should start from **default deny**, and it only works with a CNI that enforces it.
- A Kubernetes Secret is **base64, not encryption**; enable encryption at rest, restrict RBAC, keep secrets out of Git, and prefer a secrets manager with short-lived credentials.

[^1]: WARD, R.; BEYER, B. [BeyondCorp: A New Approach to Enterprise Security](https://research.google/pubs/beyondcorp-a-new-approach-to-enterprise-security/){target="_blank"}. *;login:*, v. 39, n. 6, 2014.
[^2]: ROSE, S. et al. [NIST SP 800-207 — Zero Trust Architecture](https://csrc.nist.gov/pubs/sp/800/207/final){target="_blank"}. NIST, 2020.
[^3]: SPIFFE. [SPIFFE Overview](https://spiffe.io/docs/latest/spiffe-about/overview/){target="_blank"}.
[^4]: ISTIO. [Authorization Policy](https://istio.io/latest/docs/reference/config/security/authorization-policy/){target="_blank"}.
[^5]: KUBERNETES. [Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/){target="_blank"}.
[^6]: KUBERNETES. [Good practices for Kubernetes Secrets](https://kubernetes.io/docs/concepts/security/secrets-good-practices/){target="_blank"}.
[^7]: KUBERNETES. [Encrypting Confidential Data at Rest](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/){target="_blank"}.
[^8]: HASHICORP. [Vault — Database secrets engine](https://developer.hashicorp.com/vault/docs/secrets/databases){target="_blank"}.
[^9]: HASHICORP. [Vault Agent Injector](https://developer.hashicorp.com/vault/docs/platform/k8s/injector){target="_blank"}.
