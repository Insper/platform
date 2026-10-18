
A vulnerable image-parsing library lets an attacker run code inside one `search` pod. Now replay the default setup. From that pod, the attacker calls `order` with the header `X-Account-Id: acc-42` and reads Ana's orders, because "only the gateway can reach `order`". They read the environment variables and find `DATABASE_URL` with the one password every service shares. They find `PSP_API_KEY`, because the payment key was put in a ConfigMap "temporarily". They open a connection to `https://attacker.example` and upload everything, because the private subnet has a NAT route and nothing restricts egress. Every step was possible because something **trusted the network**.

This page is about the architecture that removes that trust — **Zero Trust** — and about two places where trust hides in every system: **secrets** and the **software supply chain**.

---

## From perimeter to Zero Trust

The **perimeter model** ("castle and moat") protects the edge — firewall, VPN — and trusts everything inside. Once an attacker is inside, through a stolen laptop, a phished password or a vulnerable dependency, they move from machine to machine: **lateral movement**.

**Zero Trust** removes the idea of a trusted network. Its motto is **"never trust, always verify"**: every request — from the Internet, from the office, from the pod next door — is authenticated, authorized and encrypted on its own merits[^1]. Google built its corporate network this way in the BeyondCorp project after 2011[^2]; NIST standardized the architecture in SP 800-207[^1].

``` mermaid-sim
flowchart LR
    subgraph perimeter ["Perimeter model"]
        fw["Firewall / VPN"] -->|"inside = trusted"| int["search, order, payment, DB<br/>(trust each other)"]
    end
    subgraph zt ["Zero Trust model"]
        any["Any request<br/>(user or workload)"] -->|"identity + context"| pep["Policy Enforcement Point<br/>(gateway, mesh proxy)"]
        pep -->|"ask"| pdp["Policy Decision Point<br/>(policies, identity, device, risk)"]
        pdp -->|"allow, least privilege"| res["Resource"]
        pdp -->|"deny"| rej["Rejected + logged"]
    end
```

NIST names the moving parts: a **Policy Enforcement Point (PEP)** sits in the path of every request and blocks or forwards it; a **Policy Decision Point (PDP)** decides from identity and context. In BoxOffice, the **API gateway** is the PEP for users, and the **mesh proxy** next to each service is the PEP for workloads ([Service mesh](../service-mesh/index.md)).

### Principles

| Principle | What it means | BoxOffice mechanisms |
|---|---|---|
| **Verify explicitly** | every user *and every workload* proves who it is on every request | OIDC tokens, mTLS with SPIFFE identities, signed webhooks |
| **Least privilege** | the minimum access, for the minimum time | narrow scopes, one DB user per service, short-lived credentials, egress allow-lists |
| **Assume breach** | design as if an attacker is already inside; limit the blast radius | default-deny NetworkPolicy, isolated subnets, per-service secrets, audit logs |
| **Continuous evaluation** | trust is re-checked, not granted once | short token lifetimes, re-authentication for sensitive actions, anomaly alerts |

### The compromised `search` pod, again

| Attacker step | Perimeter model | Zero Trust control | Where |
|---|---|---|---|
| Call `order` with a forged `X-Account-Id` | accepted — "only internal callers" | `order` accepts calls only from the gateway's mesh identity; header stripped at the edge | [Service mesh](../service-mesh/index.md), [Identity](../identity/index.md) |
| Connect to PostgreSQL with the shared password | works | `search` has no route/SG/NetworkPolicy to the DB, and no DB credential at all | [Cloud networking](../cloud-network/index.md) |
| Read `PSP_API_KEY` from the environment | it is there | the key exists only in `payment` pods, fetched from a secrets manager | [Secrets](#secrets-management) |
| Exfiltrate to the Internet | NAT route, no egress rules | egress default-deny; only `payment` may reach the provider | [Service mesh](../service-mesh/index.md) |
| Stay hidden | nobody looks at internal traffic | denied calls are logged and alerted | [Observability](../../observability/index.md) |

The attack still *started* — Zero Trust does not prevent the first compromise. It makes the compromised pod a **dead end**.

---

## Workload identity: no more long-lived keys { #workload-identity }

Zero Trust needs every workload to have an identity it can prove **without a static secret**. Three common forms:

| Workload | Identity mechanism | What it replaces |
|---|---|---|
| Pod → pod | SPIFFE ID in an mTLS certificate issued by the mesh or SPIRE, rotated hourly to daily | IP allow-lists, shared API tokens |
| Pod → cloud API (S3, Secrets Manager, KMS) | the Kubernetes service account federated to a cloud role: EKS Pod Identity / IRSA, GKE Workload Identity Federation, Azure Workload Identity | access keys in environment variables |
| CI pipeline → cloud | the CI system's **OIDC token** exchanged for short-lived cloud credentials | cloud access keys stored as CI secrets |

The third is a small change with a big effect: GitHub Actions can request an OIDC token that says "I am workflow `release.yaml` of this repository on branch `main`", and the cloud trusts that claim for a role valid only for the job's duration[^3]:

```yaml
permissions:
  contents: read
  id-token: write          # allow the job to request an OIDC token
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/boxoffice-deploy
          aws-region: sa-east-1
      - run: aws eks update-kubeconfig --name boxoffice-prod
```

No AWS key is stored in GitHub; the role's trust policy accepts only tokens whose `sub` matches `repo:<org>/<repo>:ref:refs/heads/main`. A forked repository or another branch cannot assume it.

!!! note "People are workloads too"
    For engineers, Zero Trust means: single sign-on with MFA or passkeys, device posture checks, and access through an identity-aware proxy or session manager instead of a VPN that puts the laptop "inside" ([Cloud networking](../cloud-network/index.md)). Every access is per application and logged.

---

## Secrets management { #secrets-management }

A **secret** is any value that grants access: the payment provider API key, database passwords, the signing key of the identity provider, webhook HMAC secrets, registry tokens. Secrets must not live where things get copied, versioned or logged: source code, container images, plain ConfigMaps, CI logs.

!!! danger "Kubernetes Secrets are base64, not encrypted"
    A Kubernetes Secret stores values base64-*encoded*. Anyone who can `get` Secrets in the namespace — or create a pod that mounts them — reads them in one command:

    ```bash
    kubectl get secret psp-api-key -n boxoffice -o jsonpath='{.data.PSP_API_KEY}' | base64 -d
    ```

    By default they are also stored unencrypted in etcd. Minimum hygiene: **encryption at rest** for etcd (with a KMS provider), tight **RBAC** on Secrets, and **never** committing Secret manifests to Git unencrypted[^4].

### Where secrets should live

| Approach | Pros | Cons |
|---|---|---|
| Kubernetes Secrets only | simple, native | base64; rotation and audit are on you |
| Encrypted in Git (Sealed Secrets, SOPS) | GitOps-friendly, reviewed in PRs | rotation still manual; key management for the sealing key |
| **Cloud secrets manager** (AWS Secrets Manager, GCP Secret Manager, Azure Key Vault) | managed, versioned, audit log, rotation hooks, IAM per secret | tied to one cloud; per-secret and per-call cost |
| **HashiCorp Vault / OpenBao** | dynamic secrets, any cloud, fine-grained policies and audit | a critical, stateful system to operate |

The **External Secrets Operator** (ESO) bridges both worlds: the source of truth is the secrets manager; ESO syncs values into native Secrets that pods read as usual.

```yaml
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: psp-api-key
  namespace: boxoffice
spec:
  refreshInterval: 1h
  secretStoreRef:
    kind: ClusterSecretStore
    name: aws-secrets-manager
  target:
    name: psp-api-key            # Kubernetes Secret created and kept in sync by ESO
  data:
    - secretKey: PSP_API_KEY
      remoteRef:
        key: prod/boxoffice/payment/psp-api-key
```

### The life of the payment API key

The payment provider lets a merchant hold **two active keys** at once — the standard trick for rotation without downtime. The lifecycle of BoxOffice's most valuable secret:

``` mermaid-sim
sequenceDiagram
    autonumber
    actor Ops as Payments on-call
    participant PSP as Payment provider
    participant SM as Secrets Manager
    participant ESO as External Secrets Operator
    participant K8s as Secret psp-api-key
    participant Pay as payment pods
    Ops->>PSP: create key 2 (key 1 still active)
    Ops->>SM: put key 2 as a new version of prod/boxoffice/payment/psp-api-key
    ESO->>SM: refresh (every 1 h, or forced)
    SM-->>ESO: version 2
    ESO->>K8s: update Secret
    K8s-->>Pay: mounted file changes → app reloads (or rolling restart)
    Pay->>PSP: charges now signed with key 2
    Ops->>Ops: confirm in metrics: zero calls with key 1 for 24 h
    Ops->>PSP: revoke key 1
```

Notice what the design gives you: only the `payment` service account may read that secret (IAM); every read is in the audit log; the key never appears in Git, images or CI logs; and if it leaks, the same procedure runs in minutes instead of days.

!!! example "BoxOffice — leaked key runbook (short version)"

    1. **Revoke first, investigate second**: create a new key, roll it out (sequence above), revoke the leaked one.
    2. Search the provider's dashboard for calls from unknown IPs (BoxOffice only calls from its NAT Elastic IPs).
    3. Find how it leaked (Git history, logs, a laptop) and close that path.
    4. Write a blameless postmortem ([Observability — incident response](../../observability/incident-response/index.md)).

### Dynamic secrets

Even better than rotating a shared secret is not having one. **Dynamic secrets** (Vault's database engine, cloud IAM database authentication) create a **unique, short-lived credential per requester**:

```bash
$ vault read database/creds/order
Key                Value
lease_id           database/creds/order/8sTt3lV0b2yL
lease_duration     1h
username           v-k8s-order-x7Qa2
password           A1a-4kd0s8f7GQpz
```

Each `order` pod gets its own database user that expires in an hour. A credential stolen from a pod stops working by itself, and the database logs show exactly which pod did what.

### Encryption at rest with envelope encryption

Databases, object storage and backups are encrypted at rest with **envelope encryption**: each object is encrypted with a **data key**; the data key is itself encrypted with a **key-encryption key** that never leaves a **KMS** (Key Management Service) or HSM (hardware security module).

``` mermaid
flowchart LR
    D["order data"] -->|"AES-256-GCM with data key"| E["ciphertext"]
    DK["data key (plaintext, in memory only)"] -->|"encrypt via KMS API"| EDK["encrypted data key<br/>(stored next to the ciphertext)"]
    KMS["KMS master key<br/>(never leaves the KMS/HSM)"] -.-> EDK
```

Rotating or revoking the master key in KMS controls access to all the data without re-encrypting terabytes; every decrypt call is authorized by IAM and logged.

### Keep secrets out of Git

Scan before they land: a **pre-commit hook** and a CI job with a secret scanner (gitleaks, trufflehog, GitHub secret scanning with push protection) block commits that look like keys. If a secret is ever committed, **rotate it** — deleting the commit does not delete clones, forks or caches.

---

## Supply-chain security { #supply-chain-security }

BoxOffice's `order` image contains a few hundred libraries written by strangers, built by a CI system, stored in a registry, and pulled by the cluster. Each step is an attack path: a malicious or compromised dependency (the 2024 `xz-utils` backdoor), a vulnerable one (Log4Shell, 2021), a compromised build system (SolarWinds, 2020), **typosquatting** (`spring-boot-strater`) and **dependency confusion** (a public package with the name of your internal one). Supply-chain security answers three questions: *what is inside?*, *is it vulnerable?*, *did it come from our pipeline, unmodified?*

``` mermaid-sim
flowchart LR
    src["Source<br/>(reviewed PR)"] --> build["CI build<br/>(isolated runner)"]
    build --> sbom["SBOM<br/>(syft → CycloneDX)"]
    build --> scan["Scan<br/>(trivy / grype)"]
    scan -->|"no critical CVEs"| sign["Sign + provenance<br/>(cosign keyless, SLSA)"]
    sbom --> sign
    sign --> reg[("Registry<br/>image@sha256 + attestations")]
    reg --> adm{"Admission policy<br/>(Kyverno)"}
    adm -->|"signature valid"| run["Pod runs"]
    adm -->|"unsigned / wrong signer"| deny["Rejected"]
```

### What is inside: the SBOM

An **SBOM** (Software Bill of Materials) is the ingredient list of an artifact: every package, version and license, in a standard format — **CycloneDX** (OWASP) or **SPDX** (Linux Foundation, ISO/IEC 5962)[^5]. When the next Log4Shell is announced, the question "which of our images contain this version?" becomes a query instead of a week of panic.

### Is it vulnerable: scanning

Scanners (Trivy, Grype, Dependabot/Renovate for upgrades) match the SBOM against vulnerability databases (CVE identifiers, GitHub advisories). Gate the pipeline on a policy — e.g. "no *critical* vulnerability with a fix available" — not on zero findings, which never happens.

### Did it come from us: signing and provenance

**Sigstore cosign** signs container images. In **keyless** mode, the CI job proves its identity with its OIDC token, a short-lived certificate is issued by Sigstore's CA (Fulcio), and the signature is recorded in a public transparency log (Rekor) — no long-lived signing key to protect[^6]. **SLSA** (Supply-chain Levels for Software Artifacts) defines levels of build integrity; its *provenance* attestation records which source, workflow and builder produced the artifact[^7].

| SLSA Build level | Requirement | Protects against |
|---|---|---|
| L1 | provenance exists, describing how the artifact was built | "nobody knows how this binary was produced" |
| L2 | provenance is signed by a hosted build platform | tampering after the build |
| L3 | hardened build platform: isolated runs, signing keys not accessible to the build steps | a compromised build step forging provenance |

The BoxOffice release job, trimmed to the security steps (tool installation omitted):

```yaml
permissions:
  contents: read
  packages: write
  id-token: write                      # keyless signing uses the job's OIDC identity
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - id: build
        uses: docker/build-push-action@v6
        with:
          push: true
          tags: registry.example.com/boxoffice/order:${{ github.sha }}
      - name: SBOM
        run: syft registry.example.com/boxoffice/order@${{ steps.build.outputs.digest }} -o cyclonedx-json > sbom.cdx.json
      - name: Scan (fail on fixable critical CVEs)
        run: trivy image --severity CRITICAL --ignore-unfixed --exit-code 1 registry.example.com/boxoffice/order@${{ steps.build.outputs.digest }}
      - name: Sign and attest
        run: |
          IMAGE=registry.example.com/boxoffice/order@${{ steps.build.outputs.digest }}
          cosign sign --yes "$IMAGE"
          cosign attest --yes --type cyclonedx --predicate sbom.cdx.json "$IMAGE"
```

The last link is **verification at deploy time**. An admission controller (Kyverno, Sigstore policy-controller, OPA Gatekeeper) rejects any pod whose image was not signed by *our* release workflow:

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: verify-boxoffice-images
spec:
  validationFailureAction: Enforce
  rules:
    - name: signed-by-release-workflow
      match:
        any:
          - resources:
              kinds: ["Pod"]
              namespaces: ["boxoffice"]
      verifyImages:
        - imageReferences: ["registry.example.com/boxoffice/*"]
          mutateDigest: true             # pin the tag to the verified digest
          attestors:
            - entries:
                - keyless:
                    issuer: "https://token.actions.githubusercontent.com"
                    subject: "https://github.com/repo-classes/pma271/.github/workflows/release.yaml@refs/heads/main"
```

Other habits that close common gaps: **pin by digest** (`image@sha256:…`, actions by commit SHA), use minimal or distroless base images, run containers as non-root with a read-only filesystem, use a private package proxy with scoped names to prevent dependency confusion, and follow the NIST Secure Software Development Framework (SSDF) as the checklist for the process[^8].

**Try it.** Open the `ai-assistant` scenario. The assistant calls tools (`catalog`, `order`) on the user's behalf: list every identity in the path (user, assistant, tool registry, services) and what each one should be allowed to do. Where would you put the PEP for a tool call? Which secrets does the LLM gateway hold? (The [AI systems](../../ai-systems/index.md) class goes deeper into the safety mesh.)

<div class="sdp" data-scenario="ai-assistant" data-mode="compact" data-height="520"></div>

---

## A defense checklist for BoxOffice

| Area | Control | Done when… |
|---|---|---|
| Network | isolated data subnets, per-AZ NAT, egress default-deny | `search` cannot open a TCP connection to the DB or the Internet |
| Workload identity | mesh mTLS STRICT + authorization policies | `curl payment/charges` from `search` returns 403 |
| User identity | OIDC, PKCE, 15-minute access tokens, rotating refresh tokens | no password ever touches the app or our services |
| Authorization | ownership checks; admin API separated | test "user A reads user B's order" fails |
| Secrets | secrets manager + ESO, per-service IAM, dual-key rotation | `PSP_API_KEY` readable only by `payment`; rotation runbook tested |
| Data | KMS encryption at rest, TLS in transit | backups and snapshots are encrypted |
| Supply chain | SBOM, scan gate, keyless signing, admission verification | an unsigned image cannot start in `boxoffice` |
| Detection | audit logs, denied-request alerts | a denied call from `search` pages someone |

!!! tip "In the interview"
    "Zero Trust" is a buzzword unless you make it concrete. Say three things: **every call carries an identity** (tokens for users, mTLS for services), **every resource checks a policy** (least privilege, default deny, including egress), and **credentials are short-lived** (workload identity, dynamic secrets, no static keys in CI). If the design has a payment provider, add: "the API key lives in a secrets manager, only the payment service can read it, and we rotate with two active keys." For supply chain, one line is enough: "CI produces an SBOM, scans, and signs images; the cluster only runs signed images."

!!! warning "Common pitfalls"
    - **"It's internal, so it's safe"** — the definition of the perimeter model.
    - **One shared credential for all services** — when it leaks, you cannot tell who used it, and rotation breaks everyone at once.
    - **Secrets in Git, images, ConfigMaps or CI logs** — and "deleting the commit" instead of rotating.
    - **Static cloud keys in CI** — use the CI's OIDC token and short-lived roles.
    - **Signing without verifying** — a signature nobody checks at deploy time protects nothing.
    - **Scanning without a policy** — 400 findings and no gate means nothing changes.

---

## How it connects { #how-it-connects }

``` mermaid
flowchart LR
    PER["perimeter model:<br/>inside = trusted"] -->|"replaced by"| ZT["Zero Trust:<br/>never trust, always verify"]
    ZT --> PEP["PEP: gateway for users,<br/>mesh proxy for workloads"]
    PEP --> MESH["mTLS + authorization policy<br/>→ Service mesh"]
    ZT --> WI["workload identity:<br/>SPIFFE, cloud roles, CI OIDC"]
    WI --> SEC["secrets manager, dynamic secrets,<br/>dual-key rotation"]
    SEC --> KMS["envelope encryption<br/>with a KMS"]
    ZT --> SC["supply chain: SBOM, scan,<br/>cosign, SLSA"]
    SC --> ADM["admission policy at deploy<br/>→ Cloud-native"]
    ZT --> DET["denied calls logged and alerted<br/>→ Observability"]
    DET --> IR["leaked-key runbook<br/>→ incident response"]
```

**Palette components:** [`apigw`](../../../reference/components/edge/index.md#apigw) and [`mesh`](../../../reference/components/network/index.md#mesh) (the enforcement points) · [`payment`](../../../reference/components/external/index.md#payment) (the key only `payment` may read) · [`logs`](../../../reference/components/observability/index.md#logs) · [`alerting`](../../../reference/components/observability/index.md#alerting) (audit and denied-call alerts) · [`llmgw`](../../../reference/components/ai/index.md#llmgw) · [`toolreg`](../../../reference/components/ai/index.md#toolreg) (identities in an agent's tool calls). **Scenarios:** `ai-assistant`, `payment-system`. **Continues in:** [Service mesh](../service-mesh/index.md#mtls), [Identity](../identity/index.md#delegation), [Cloud-native — delivery](../../cloud-native/delivery/index.md), [Observability — incident response](../../observability/incident-response/index.md), [AI systems — safety & evals](../../ai-systems/safety-evals/index.md), [Hands-on 13 — security](../../../hands-on/13/security/index.md).

## Key takeaways

- **Zero Trust**: no trusted network; every request is authenticated, authorized and encrypted at a **PEP** using a **PDP**'s decision. It turns a compromised pod into a dead end.
- **Workload identity** (SPIFFE/mTLS, cloud roles for service accounts, CI OIDC) replaces static keys with short-lived, verifiable credentials.
- **Secrets** belong in a secrets manager or Vault, scoped per service, audited, rotated (dual keys) — ideally **dynamic**; Kubernetes Secrets are base64, not encryption.
- **Envelope encryption** with a KMS protects data at rest; secret scanning keeps keys out of Git.
- **Supply chain**: SBOM (what is inside), scanning (is it vulnerable), signing + provenance + admission verification (did it come from us, unmodified).

---

[^1]: ROSE, S. et al. [NIST SP 800-207 — Zero Trust Architecture](https://csrc.nist.gov/pubs/sp/800/207/final){target="_blank"}. NIST, 2020.
[^2]: WARD, R.; BEYER, B. [BeyondCorp: A New Approach to Enterprise Security](https://research.google/pubs/beyondcorp-a-new-approach-to-enterprise-security/){target="_blank"}. *;login:*, v. 39, n. 6, 2014.
[^3]: GITHUB. [About security hardening with OpenID Connect](https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect){target="_blank"}.
[^4]: KUBERNETES. [Good practices for Kubernetes Secrets](https://kubernetes.io/docs/concepts/security/secrets-good-practices/){target="_blank"} and [Encrypting Confidential Data at Rest](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/){target="_blank"}.
[^5]: OWASP. [CycloneDX](https://cyclonedx.org/){target="_blank"}; LINUX FOUNDATION. [SPDX](https://spdx.dev/){target="_blank"}.
[^6]: SIGSTORE. [Sigstore documentation — cosign, Fulcio, Rekor](https://docs.sigstore.dev/){target="_blank"}.
[^7]: OPENSSF. [SLSA — Supply-chain Levels for Software Artifacts, v1.0](https://slsa.dev/spec/v1.0/levels){target="_blank"}.
[^8]: SOUPPAYA, M.; SCARFONE, K.; DODSON, D. [NIST SP 800-218 — Secure Software Development Framework (SSDF)](https://csrc.nist.gov/pubs/sp/800/218/final){target="_blank"}. NIST, 2022.
