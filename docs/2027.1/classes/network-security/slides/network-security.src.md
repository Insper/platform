---
marp: true
lang: en
title: Network & Security
description: System Architecture · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">System Architecture · Insper</div>

# Network & Security

**Boundaries, identities and least privilege — designed, not bolted on**

<!--
Outline: (1) security as design: STRIDE, defense in depth, OWASP API Top 10; (2) cloud networking:
VPC, subnets, NAT, security groups; (3) service mesh: mTLS, policies, traffic; (4) identity: OAuth 2.1,
OIDC, JWT; (5) Zero Trust, secrets, supply chain.
-->

---

## Four stories from BoxOffice's first month

<div class="q">

Which of these is a *bug in one line of code*?

</div>

- A contractor's stolen laptop has the **payment API key** in a `.env` file.
- The mobile team wants to **store the user's password** in the app.
- At 10:00, **bots** grab 30% of the seat holds and resell the tickets.
- A vulnerable library in `search` gives an attacker a shell — and the **DB, `payment` and the Internet** are one connection away.

* None. They are **design** problems: boundaries, identities, privileges, secrets.

---

## Threat modeling in four questions

1. **What are we working on?** Draw the data-flow diagram (DFD).
2. **What can go wrong?** Mark the **trust boundaries**; run STRIDE per element.
3. **What will we do about it?** Mitigate, accept, transfer or eliminate.
4. **Did we do a good job?** Review and repeat when the design changes.

<div class="ok">

Checkout crosses **five** trust boundaries: Internet → edge → cluster → DB, cluster → payment provider → webhook back.

</div>

<!--
Adam Shostack's four questions. Draw the checkout DFD on the board with subgraphs as trust boundaries.
-->

---

<!-- _class: tight -->

## STRIDE on the checkout

| Threat | Property | BoxOffice example | Control |
|---|---|---|---|
| **S**poofing | authentication | forged "payment captured" webhook | HMAC signature + re-query |
| **T**ampering | integrity | price changed in the request body | server-side pricing, signed images |
| **R**epudiation | non-repudiation | "I never bought these tickets" | audit log with user + trace id |
| **I**nfo disclosure | confidentiality | `GET /orders/1043` shows another fan's order | ownership check, secrets manager |
| **D**enial of service | availability | bots hold 100 000 seats | WAF, rate limits, waiting room, TTL |
| **E**levation of privilege | authorization | `search` pod reaches the DB | NetworkPolicy, least privilege |

---

## Defense in depth

- **Edge** — TLS, WAF, rate limiting, waiting room.
- **Identity** — OAuth 2.1 / OIDC, short-lived tokens, MFA, passkeys.
- **Request authZ** — ownership and roles, in each service.
- **Service to service** — mTLS + mesh authorization policy.
- **Network** — private/isolated subnets, security groups, default-deny.
- **Secrets & data** — secrets manager, rotation, KMS encryption.
- **Supply chain** — SBOM, scan, signed images.

<div class="ok">

Layers are **independent**: when one fails, the next still holds.

</div>

---

<!-- _class: tight -->

## OWASP API Security Top 10 (2023) — the design checklist

| # | Risk | BoxOffice |
|---|---|---|
| API1 | Broken Object Level Authorization | `GET /orders/{id}` returns any order |
| API2 | Broken Authentication | 24 h tokens; brute-forceable login |
| API3 | Broken Object Property Level AuthZ | `PATCH {"status":"PAID"}` accepted |
| API4 | Unrestricted Resource Consumption | 5 000 holds per account |
| API5 | Broken Function Level AuthZ | fan calls `POST /admin/events` |
| API6 | Sensitive Business Flows | scalper bots at 10:00 |
| API7 | SSRF | "poster from URL" → cloud metadata |
| API10 | Unsafe Consumption of APIs | trusting the webhook body |

<div class="warn">

**BOLA** cannot be fixed at the gateway: only `order` knows who owns order 1043.

</div>

---

## The VPC: your network in the cloud

- **Region** → several **AZs** (independent data centers).
- **VPC** = private range (RFC 1918), e.g. `10.20.0.0/16` = 65 536 addresses.
- **Subnet** = slice of the VPC in **one** AZ; AWS reserves **5** IPs per subnet.
- **Route table** decides where packets go; every table has the `local` route.

<div class="q">

Pods get VPC IPs. How many fit in a `/24` app subnet? And in a `/19`?

</div>

* `/24`: 256 − 5 = **251** — gone at the first autoscale. `/19`: 8 192 − 5 = **8 187**.

---

<!-- _class: tight -->

## Public, private, isolated

| Subnet | `0.0.0.0/0` → | Reachable from Internet | Reaches Internet | BoxOffice |
|---|---|---|---|---|
| **Public** | Internet Gateway | yes (public IP + SG) | yes | load balancer, NAT gateways |
| **Private** | NAT gateway | no | outbound only | EKS nodes: gateway, order, payment… |
| **Isolated** | — | no | no | PostgreSQL, Redis, Kafka |

- A subnet is public **because of its route table**, not a checkbox.
- **NAT gateway**: connections start only from inside; gives a **fixed egress IP** for the payment provider's allow-list.

<div class="warn">

A NAT lives in **one AZ**. One NAT for all AZs → an AZ outage becomes a checkout outage. Use one per AZ.

</div>

---

## Security groups vs NACLs

<div class="cols">
<div>

**Security group**
- on a network interface
- **stateful** (replies allowed)
- allow rules only
- source can be **another SG**: `5432 from sg-app`

</div>
<div>

**Network ACL**
- on a subnet
- **stateless** (open ephemeral ports)
- allow **and deny**, ordered
- CIDR sources only — coarse guard rail

</div>
</div>

<div class="warn">

An SG is not an identity: *every* pod on the app nodes — including the compromised `search` — matches `sg-app`.

</div>

---

## Getting in and out privately

- **VPC endpoints** — S3 (gateway, free) and ECR / Secrets Manager (interface) **off the NAT bill**.
- **Peering** (1:1, not transitive) vs **transit gateway** (hub) vs **PrivateLink** (one service).
- **Site-to-site VPN** (IPsec over the Internet) vs **dedicated link** (Direct Connect, Interconnect).
- **Session manager / IAP** instead of a bastion with port 22 open.

<p class="small">Illustrative: 30 nodes × 2 GB/day of image pulls + 50 GB/day of logs ≈ 3.3 TB/month through NAT that never needed the Internet.</p>

<!--
Mention the GCP difference: VPC is global, Cloud NAT is a managed service. Azure: VNet, NSG.
-->

---

## Service mesh: data plane + control plane

- **Data plane** — a proxy on every call: mTLS, policy, retries, timeouts, telemetry.
- **Control plane** — configures proxies and is the **certificate authority**.
- The app still calls `http://payment:8080`; the proxies upgrade to **mTLS**.

| Without a mesh | With a mesh |
|---|---|
| each team does TLS, retries, metrics its way | uniform, declarative, per route |
| "any pod that knows the URL can call `payment`" | only `sa/order` may `POST /charges` |

---

<!-- _class: tight -->

## Sidecar vs ambient vs eBPF

| | Sidecar | Ambient (Istio) | eBPF (Cilium) |
|---|---|---|---|
| Proxy | one per pod | ztunnel per node + optional waypoint | kernel + shared Envoy per node |
| L7 everywhere? | yes | only with a waypoint | only where configured |
| Overhead | grows with pod count | low for L4 | lowest for L3/L4 |
| Upgrade | restart every pod | node agents + waypoints | node agent |

<div class="q">

9 services × 6 replicas × 50 MB per sidecar (illustrative)?

</div>

* ≈ **2.7 GB** of memory just for proxies — and it scales with the flash-sale autoscaling.

---

## mTLS authenticates, a policy authorizes

```yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata: { name: payment-allow-order, namespace: boxoffice }
spec:
  selector: { matchLabels: { app: payment } }
  action: ALLOW
  rules:
    - from: [{ source: { principals: ["cluster.local/ns/boxoffice/sa/order"] } }]
      to:   [{ operation: { methods: ["POST"], paths: ["/charges"] } }]
```

- Identity = **SPIFFE ID** from the service account, in a short-lived certificate.
- `PeerAuthentication` **STRICT** rejects plain text; NetworkPolicy adds L3/L4 default-deny.

---

## Traffic policy in the mesh

- **Canary**: `VirtualService` weights 90 / 10 between `v1` and `v2`.
- **Timeout** budget per route (`3s`), **retries** only on connect failures.
- **Outlier detection**: eject a replica after 5 consecutive 5xx.
- **Connection pool** limits = bulkhead.

<div class="warn">

Retries in the library (3) × retries in the mesh (3) = **9 calls** per click on a struggling `payment`. Retry in **one** layer, and only idempotent calls.

</div>

---

## Sessions vs tokens

| | Server-side session | JWT access token |
|---|---|---|
| Client holds | random id | signed claims |
| Validation | lookup (Redis) | signature, locally |
| Revocation | immediate | only at `exp` |
| Scaling | shared store | stateless |

<div class="q">

Tokens live 15 min, validated locally. Refresh revoked at 14:05, last token issued 13:58. Until when can a thief call?

</div>

* **14:13** — the exposure window is one token lifetime. Shorter tokens, introspection or DPoP shrink it.

---

## OAuth 2.1 in one slide

- **Delegated authorization**: the client gets a limited, short-lived token; it **never sees the password**.
- Roles: resource owner · client (public / confidential) · authorization server · resource server.
- **PKCE for every** authorization-code client; **Implicit and ROPC removed**.
- **Exact** redirect-URI matching; no tokens in URLs; refresh tokens **rotated** or sender-constrained.
- Grants: **Auth Code + PKCE** (users) · **Client Credentials** (jobs) · **Device** (TVs) · **Token Exchange** (delegation).

---

## The mobile app: Authorization Code + PKCE

1. App creates `code_verifier`; sends `code_challenge = S256(verifier)` + `state` + `nonce`.
2. **System browser** opens `/authorize`; user logs in at `auth` (MFA / passkey).
3. Redirect brings back a one-time **code**; app checks `state`.
4. App posts `code` + `code_verifier` to `/token`; server compares hashes.
5. Gets **access** (15 min) + **refresh** (rotating) + **ID** token.
6. Gateway verifies the JWT **locally** (JWKS): signature, `iss`, `aud`, `exp`, scope.

<div class="ok">

A stolen code is useless without the verifier. The password never touches BoxOffice code.

</div>

---

## OIDC and validating a JWT

<div class="cols">
<div>

**OIDC adds**
- `openid` scope
- **ID token** for the *client*
- UserInfo endpoint
- discovery: `/.well-known/openid-configuration`
- web: a **BFF** keeps tokens, browser gets an `HttpOnly` cookie

</div>
<div>

**Validate (RFC 8725)**
- allow-listed `alg`, key by `kid`
- `iss` = our provider
- `aud` = **this** API
- `exp` / `nbf`, small skew
- `typ` = `at+jwt`, scopes

</div>
</div>

---

## Authorization models

| Model | Decides by | BoxOffice |
|---|---|---|
| **RBAC** | roles | `organizer` creates events |
| **ABAC** | attributes + context | refund only > 48 h before the show |
| **ReBAC** | relationships | Bruno sees the ticket Ana shared |

- Scopes limit the **client**; ownership limits the **user** → BOLA check in `order`.
- Policy as code: **OPA / Rego**, **Cedar**, OpenFGA.

---

## Zero Trust: never trust the network

- **Verify explicitly** — every user *and workload*, every request.
- **Least privilege** — narrow scopes, one DB user per service, egress allow-lists.
- **Assume breach** — default deny, isolated data, per-service secrets.
- **Continuous** — short lifetimes, re-auth for sensitive actions, alerts.

<div class="ok">

The compromised `search` pod becomes a **dead end**: no route to the DB, 403 from `payment`, no `PSP_API_KEY`, no egress.

</div>

<!--
NIST SP 800-207: PEP (gateway, mesh proxy) asks the PDP. BeyondCorp for people.
-->

---

## Workload identity and secrets

- Pod → pod: **SPIFFE / mTLS**. Pod → cloud: **service account → cloud role**. CI → cloud: **OIDC token**, no stored keys.
- K8s Secrets are **base64, not encryption** — encrypt etcd, tight RBAC, never in Git.
- Source of truth: **secrets manager / Vault**, synced by External Secrets.
- Payment key: **two active keys** → roll out #2 → verify → revoke #1.
- **Dynamic secrets**: one DB user per pod, 1 h lease. **KMS** envelope encryption at rest.

---

## Supply chain: what, vulnerable, from us?

- **SBOM** (CycloneDX / SPDX via syft) — what is inside.
- **Scan** (Trivy / Grype) — gate on fixable critical CVEs.
- **Sign** (cosign keyless, OIDC identity of the CI job) + **SLSA provenance**.
- **Verify at admission** (Kyverno): only images signed by our release workflow run.
- Pin by **digest**; distroless, non-root; private package proxy against dependency confusion.

<div class="warn">

Signing without verifying protects **nothing**.

</div>

---

## In the interview

- Draw a **VPC** box: public (LB, NAT) and private (services, data) subnets in **2+ AZs**.
- "Egress to the payment provider via **NAT per AZ** with allow-listed IPs."
- "Mobile: **Auth Code + PKCE**; gateway validates **short JWTs** with JWKS; services check **ownership**."
- "Inside: **mesh mTLS + authorization policies**, default deny."
- "Payment key in a **secrets manager**, rotated; CI **signs** images, cluster verifies."

<div class="ok">

One or two concrete sentences at the right time beat a security lecture.

</div>

---

## The network & security concept map

<!-- _class: tight -->

| Component | Question it answers | Key concepts |
|---|---|---|
| `waf` | is it an attack or a bot? | OWASP API4/API6, bot rules, rate limits |
| `auth` | *who* is the user, which client? | OAuth 2.1 + PKCE, OIDC, Token Exchange |
| `apigw` | is the token valid? | JWKS, `iss`/`aud`/`exp`, strip headers |
| `vpc` `subnet` `nat` `vpn` | *where* does it live, what reaches it? | CIDR, public/private/isolated, SGs, egress IP |
| `mesh` | *which service* may call which? | mTLS, SPIFFE, authz policy, NetworkPolicy |
| `payment` | who holds the key that moves money? | secrets manager, dual-key rotation |
| *(all)* | can we trust the code that runs? | SBOM, scan, cosign, SLSA |

<p class="small">Each row is one layer of <b>defense in depth</b>; Zero Trust means none of them trusts the network.</p>

---

## Takeaways

1. Security is **design**: threat model with **STRIDE** on the data flow; check the **OWASP API Top 10**.
2. **Defense in depth**: independent layers from edge to supply chain.
3. **VPC**: public only via IGW route; private egress via **NAT per AZ**; SGs stateful, NACLs stateless.
4. **Mesh**: mTLS authenticates, **policies authorize**; retry in one layer.
5. **OAuth 2.1 + OIDC**: PKCE everywhere, short tokens, validate `iss`/`aud`/`exp`; **BOLA** in each service.
6. **Zero Trust**: identity on every call, least privilege, assume breach.
7. **Secrets** in a manager, rotated or dynamic; **sign and verify** what you run.
