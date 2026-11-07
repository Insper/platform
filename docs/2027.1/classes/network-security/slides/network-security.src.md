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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">System Architecture · Insper</div>

# Network & Security

**Boundaries, identities and least privilege — designed, not bolted on**

<!--
Outline: (1) security as design: STRIDE, defense in depth, OWASP API Top 10; (2) cloud networking:
VPC, subnets, NAT, security groups; (3) service mesh: mTLS, policies, traffic; (4) Zero Trust, secrets,
supply chain. Identity (OAuth 2.1, OIDC, JWT) was class 4; here it is one layer of defense in depth.
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

1. **What are we working on?** Draw the data-flow diagram (DFD). 2. **What can go wrong?** Mark the **trust boundaries**; run STRIDE (spoofing, tampering, repudiation, information disclosure, denial of service, elevation of privilege) per element. 3. **What will we do?** Mitigate, accept, transfer or eliminate. 4. **Did we do a good job?** Repeat when the design changes.

<div class="flow">
<div class="group"><div class="caption">Internet</div><div class="box muted">mobile app</div><div class="box red">bot</div></div><div class="arrow">①</div>
<div class="group"><div class="caption">edge</div><div class="box accent">WAF + API gateway</div></div><div class="arrow">②</div>
<div class="group"><div class="caption">cluster</div><div class="box">order → payment</div><div class="box">inventory · auth</div></div><div class="arrow">③</div>
<div class="group"><div class="caption">data</div><div class="box green">PostgreSQL</div></div>
<div class="group"><div class="caption">provider</div><div class="box orange">PSP API<small>④ API key out · ⑤ webhook in</small></div></div>
</div>

<div class="ok">

Checkout crosses **five** trust boundaries. Each arrow asks: *who is calling, how do we know, what can they do?*

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
| **D**enial of service | availability | bots hold 100 000 seats | WAF, rate limits, waiting room, hold time to live (TTL) |
| **E**levation of privilege | authorization | `search` pod reaches the DB | NetworkPolicy, least privilege |

---

## Defense in depth

<div class="flow">
<div class="box red">1 · edge<small>Transport Layer Security (TLS), web application firewall (WAF), rate limits, waiting room</small></div>
<div class="box orange">2 · identity<small>OAuth 2.1 / OpenID Connect (OIDC), short tokens, multi-factor authentication (MFA)</small></div>
<div class="box orange">3 · request authZ<small>ownership and roles, in each service</small></div>
<div class="box accent">4 · service to service<small>mutual TLS (mTLS) + mesh policy</small></div>
</div>
<div class="flow">
<div class="box accent">5 · network<small>private and isolated subnets, security groups, default deny</small></div>
<div class="box green">6 · secrets and data<small>secrets manager, rotation, encryption with a key management service (KMS)</small></div>
<div class="box green">7 · supply chain<small>software bill of materials (SBOM), scan, signed images</small></div>
</div>

<div class="ok">

Layers are **independent**: the database security group does not care whether the token was valid. When one fails, the next still holds.

</div>

<p class="small">Rate the threats (likelihood × impact) and record a decision with an owner: 🔴 bots at 10:00 → mitigate · 🟠 forged webhook → mitigate · 🟡 provider outage → accept for now.</p>

---

<!-- _class: tight -->

## OWASP API Security Top 10 (2023) — the design checklist

<p class="small">OWASP: the Open Worldwide Application Security Project.</p>

| # | Risk | BoxOffice |
|---|---|---|
| API1 | Broken Object Level Authorization (BOLA) | `GET /orders/{id}` returns any order |
| API2 | Broken Authentication | 24 h tokens; brute-forceable login |
| API3 | Broken Object Property Level AuthZ | `PATCH {"status":"PAID"}` accepted |
| API4 | Unrestricted Resource Consumption | 5 000 holds per account |
| API5 | Broken Function Level AuthZ | fan calls `POST /admin/events` |
| API6 | Sensitive Business Flows | scalper bots at 10:00 |
| API7 | Server-Side Request Forgery (SSRF) | "poster from URL" → cloud metadata |
| API10 | Unsafe Consumption of APIs | trusting the webhook body |

<div class="warn">

**BOLA** cannot be fixed at the gateway: only `order` knows who owns order 1043.

</div>

---

## How a packet crosses the Internet

<div class="flow">
<div class="box muted">phone<small>192.168.0.12</small></div><div class="arrow">→</div>
<div class="box orange">home router<small>source NAT → 198.51.100.7</small></div><div class="arrow">→</div>
<div class="box accent">Internet core<small>longest prefix match, no default route</small></div><div class="arrow">→</div>
<div class="box orange">cloud gateway<small>public 203.0.113.10 → ALB's private IP</small></div><div class="arrow">→</div>
<div class="box green">load balancer → order</div>
</div>

- Routers read only the **destination IP**, never the URL; 10–20 hops, and the time is **distance**.
- Tens of thousands of networks (autonomous systems, **AS**) announce their blocks with the Border Gateway Protocol (**BGP**).

<div class="q">

Why can't a fan reach the `payment` pod at `10.20.40.17`, even with every firewall open?

</div>

* `10.20.40.17` is **private**: nobody announces it, so the first core router has no route and drops it.

<!-- The page "How the Internet works" has the packet-walk simulator: run "A fan tries a pod directly". Cloud networking embeds it again at the security groups, with the database rule switched off. -->

---

<!-- _class: tight -->

## Public, private, and the CIDR (classless inter-domain routing) math

| Block | Kind | Routed on the Internet? | Where |
|---|---|---|---|
| `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` | private (RFC 1918) | no | virtual private cloud (VPC) `10.20.0.0/16`, Docker, Wi-Fi |
| `100.64.0.0/10` | carrier-grade NAT (CGNAT) | no | your phone on 4G |
| `169.254.0.0/16` | link-local | no | metadata service: credentials! |
| everything else | **public** | **yes** | the load balancer and the NAT gateway |

- `/n` fixes the first *n* bits: the block has **2³²⁻ⁿ** addresses; each extra bit **halves** it.
- `10.20.32.0/19` = 8 192 addresses: `10.20.32.0` – `10.20.63.255`.

<div class="warn">

Private is about **reachability**, not trust: anything inside the network still reaches it.

</div>

---

## NAT (network address translation): many private hosts, one public address

- Source NAT rewrites `10.20.40.17:51000` → `203.0.113.20:62001` and writes it in a **table**.
- Replies match the table; a **new inbound connection** matches nothing → dropped.
- The server sees the **NAT's IP**: thousands of fans behind one carrier IP.
- A NAT gives a **fixed egress IP** → the payment provider's allow-list.
- Destination NAT publishes a private service: load balancer, cloud Internet Gateway (IGW), Docker `ports:`.

<div class="ok">

Rate-limit **per API key or user**, not per IP: behind CGNAT one IP is a whole neighbourhood.

</div>

---

## The VPC: your network in the cloud

- **Region** → several availability zones (**AZs**: independent data centers).
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
| **Public** | Internet Gateway | yes (public IP + security group, SG) | yes | load balancer, NAT gateways |
| **Private** | NAT gateway | no | outbound only | EKS nodes: gateway, order, payment… |
| **Isolated** | — | no | no | PostgreSQL, Redis, Kafka |

- A subnet is public **because of its route table**, not a checkbox.
- **NAT gateway**: connections start only from inside; gives a **fixed egress IP** for the payment provider's allow-list.

<div class="warn">

A NAT lives in **one AZ**. One NAT for all AZs → an AZ outage becomes a checkout outage. Use one per AZ.

</div>

---

## The BoxOffice VPC (two of three AZs)

<div class="flow">
<div class="group"><div class="caption">public · 10.20.0.0/24, .1.0/24</div><div class="box accent">ALB nodes</div><div class="box orange">NAT gateway + fixed IP, one per AZ</div></div><div class="arrow">→</div>
<div class="group"><div class="caption">private app · 10.20.32.0/19, .64.0/19</div><div class="box">EKS nodes<small>gateway · order · payment · …</small></div><div class="box muted">VPC endpoints<small>S3 · ECR · Secrets Manager</small></div></div><div class="arrow">→</div>
<div class="group"><div class="caption">isolated data · 10.20.8.0/22, .12.0/22</div><div class="box green">PostgreSQL primary → standby</div><div class="box green">Redis + replica</div></div>
</div>

- Only the public subnets route `0.0.0.0/0` to the Internet Gateway; the app subnets route it to the NAT of **their own** AZ.
- The data subnets have **no** default route: no way in or out, even for an update download.

---

## Security groups vs network ACLs (NACLs)

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
- **Site-to-site virtual private network (VPN)** (IPsec over the Internet) vs **dedicated link** (Direct Connect, Interconnect).
- **Session manager / Identity-Aware Proxy** instead of a bastion with port 22 open.

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

| | Sidecar | Ambient (Istio) | eBPF, extended Berkeley Packet Filter (Cilium) |
|---|---|---|---|
| Proxy | one per pod | ztunnel per node + optional waypoint | kernel + shared Envoy per node |
| L7 everywhere? | yes | only with a waypoint | only where configured |
| Overhead | grows with pod count | low for L4 | lowest for L3/L4 |
| Upgrade | restart every pod | node agents + waypoints | node agent |

<div class="q">

9 services × 6 replicas × 50 MB per sidecar (illustrative)?

</div>

* ≈ **2.7 GB** of memory just for proxies — and it scales with the flash-sale autoscaling.

<p class="small">3–5 services, one team: probably no mesh (TLS at the ingress, NetworkPolicy, a resilience library). Only mTLS + L4 policy: ambient or Cilium, without L7 proxies.</p>

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

- Identity = **SPIFFE ID** (Secure Production Identity Framework For Everyone) from the service account, in a short-lived certificate.
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

## Zero Trust: never trust the network

<div class="flow">
<div class="box">any request<small>user or workload</small></div><div class="arrow">identity + context →</div>
<div class="box accent">enforcement point<small>gateway, mesh proxy</small></div><div class="arrow">asks →</div>
<div class="box orange">decision point<small>policy, identity, device, risk</small></div><div class="arrow">→</div>
<div class="box green">allow, least privilege</div><div class="box red">deny + log</div>
</div>

- **Verify explicitly** every user *and workload*; **least privilege**; **assume breach**; re-check **continuously**.
- The compromised `search` pod, perimeter vs Zero Trust: forged `X-Account-Id` ❌ accepted → 403 · shared DB password ❌ works → no route, no credential · `PSP_API_KEY` ❌ in its env → only in `payment` · exfiltration ❌ NAT route → egress denied.

<div class="ok">

The attack still *starts*; Zero Trust makes the pod a **dead end**.

</div>

<!--
NIST SP 800-207: PEP (gateway, mesh proxy) asks the PDP. BeyondCorp for people.
-->

---

## Workload identity and secrets

- Pod → pod: **SPIFFE / mTLS**. Pod → cloud: **service account → cloud role**. CI → cloud: the job's **OIDC token** traded for credentials that die with the job; no stored keys.
- K8s Secrets are **base64, not encryption** — encrypt etcd, tight role-based access control (RBAC), never in Git.
- Source of truth: **secrets manager / Vault**, synced by External Secrets.
- Payment key: **two active keys** → roll out #2 → verify → revoke #1.
- **Dynamic secrets**: one DB user per pod, 1 h lease. **KMS** envelope encryption at rest.

---

## Supply chain: what, vulnerable, from us?

- **SBOM** (CycloneDX / SPDX via syft) — what is inside.
- **Scan** (Trivy / Grype) — gate on fixable critical vulnerabilities (CVEs).
- **Sign** (cosign keyless, OIDC identity of the CI job) + provenance of the Supply-chain Levels for Software Artifacts (**SLSA**).
- **Verify at admission** (Kyverno): only images signed by our release workflow run.
- Pin by **digest**; distroless, non-root; private package proxy against dependency confusion.

<div class="warn">

Signing without verifying protects **nothing**.

</div>

---

## In the interview

- Draw a **VPC** box: public (LB, NAT) and private (services, data) subnets in **2+ AZs**.
- "Egress to the payment provider via **NAT per AZ** with allow-listed IPs."
- "Mobile: **Auth Code + PKCE** (Proof Key for Code Exchange, class 4); gateway validates **short JSON Web Tokens** with the provider's public keys; services check **ownership**."
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
| `apigw` | is the token valid? | JSON Web Key Set (JWKS), `iss`/`aud`/`exp`, strip headers |
| `vpc` `subnet` `nat` `vpn` | *where* does it live, what reaches it? | CIDR, public/private/isolated, SGs, egress IP |
| `mesh` | *which service* may call which? | mTLS, SPIFFE, authz policy, NetworkPolicy |
| `payment` | who holds the key that moves money? | secrets manager, dual-key rotation |
| *(all)* | can we trust the code that runs? | SBOM, scan, cosign, SLSA |

<p class="small">Each row is one layer of <b>defense in depth</b>; Zero Trust means none of them trusts the network.</p>

---

## What breaks next

<div class="warn">

Every caller in this class is a person or a service we wrote: the fan with a token, `order` with a workload identity, the pipeline with a signed provenance.

</div>

- The next caller is neither: an **assistant** that answers "two seats under R$ 300 on Saturday, hold them" by calling `catalog` and `inventory` for the fan.
- A slow, expensive, non-deterministic dependency that can **act** on the inventory — and can be talked into the wrong thing by the text it reads.
- Designing around a model, and deciding what it may touch: class 13, AI Systems.

---

## Takeaways

1. Security is **design**: threat model with **STRIDE** on the data flow; check the **OWASP API Top 10**.
2. **Defense in depth**: independent layers from edge to supply chain.
3. **VPC**: public only via IGW route; private egress via **NAT per AZ**; SGs stateful, NACLs stateless.
4. **Mesh**: mTLS authenticates, **policies authorize**; retry in one layer.
5. Identity (class 4) is one layer: short tokens validated at the gateway; **BOLA** checked in each service.
6. **Zero Trust**: identity on every call, least privilege, assume breach.
7. **Secrets** in a manager, rotated or dynamic; **sign and verify** what you run.
