
BoxOffice leaves the laptop and goes to production in the cloud. Within a month, four stories land on the team's desk. A contractor's laptop is stolen, and on it is a `.env` file with the **payment provider API key**. The new **mobile app** needs users to log in, and someone proposes "just store the password in the app". At 10:00 on the day a stadium show goes on sale, **bots** grab 30% of the seat holds in the first minute and resell the tickets at three times the price. And a vulnerable library in the `search` service lets an attacker run code inside one pod — from where, in the default setup, every other service, the database and the Internet are one connection away.

None of these is a bug in a single line of code. They are **design** problems: where the network boundaries are, who is allowed to talk to whom, how identities are proven, where secrets live and how fast they can be revoked. This class treats security and networking the way the rest of the course treats scalability — as **architecture decisions with trade-offs**, made on purpose, drawn on the diagram, and defended in an interview.

!!! quote "The story so far"

    Chapter 12 of the [story of the course](../../index.md#story). The gateway already checks every fan's token once ([class 4 — Identity](../edge/identity/index.md), built in [lab 4](../../hands-on/4/index.md)), and [class 11](../cloud-native/index.md) replaced Compose with Kubernetes and a delivery pipeline. Now many services, built by many people and by a pipeline, share one platform — and the four stories above show what that trust costs: bots in the on-sale line, a leaked key, a pod that can reach everything, libraries nobody reviewed. **This class** answers: where are the trust boundaries, who may talk to whom, how are secrets limited and revoked, and how do we know what we ship?

!!! abstract "Learning objectives"

    By the end of this class you should be able to:

    - **Build** a threat model of a BoxOffice flow with STRIDE, and **map** each threat to a control and to the OWASP API Security Top 10.
    - **Design** a cloud network for BoxOffice: VPC, CIDR plan, public/private/isolated subnets across zones, route tables, NAT gateway, security groups and private connectivity.
    - **Explain** what a service mesh adds (mTLS, traffic policy, telemetry), **compare** sidecar, ambient and eBPF data planes, and **write** an authorization policy between two services.
    - **Choose** the right OAuth 2.1 / OpenID Connect flow for each client (mobile app, web app, batch job), and **validate** a JWT correctly at the gateway.
    - **Apply** Zero Trust to service-to-service traffic, **design** the lifecycle of a secret (the payment API key), and **secure** the software supply chain with SBOMs and signed images.

## Roadmap

1. **This overview** — security as design: threat modeling with STRIDE, defense in depth, and the OWASP API Security Top 10 mapped to BoxOffice. Identity — tokens, OAuth 2.1 and OIDC — was taught where BoxOffice first needed it, at the gateway: [class 4 — Identity](../edge/identity/index.md).
2. [How the Internet works](internet/index.md) — layers, routing hop by hop and BGP, IP addresses and CIDR, public vs private addresses, NAT, subnets and the default gateway; two simulators (address explorer, packet walk through the BoxOffice VPC).
3. [Cloud networking](cloud-network/index.md) — VPC, subnets, route tables, Internet and NAT gateways, security groups vs NACLs, private endpoints, VPN and dedicated links.
4. [Service mesh](service-mesh/index.md) — data plane and control plane, sidecar vs ambient vs eBPF, mTLS, authorization and traffic policies.
5. [Zero Trust, secrets & supply chain](zero-trust/index.md) — never trust the network, workload identity, secrets management, SBOM, image signing and SLSA.
6. [Quiz](quiz.md) — check your understanding.

## Slides

<div class="slides-embed">
  <iframe src="slides/network-security.html" title="Slides: network and security" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/network-security.html){:target="_blank"}

---

## Security is a design property

A common mistake is to treat security as a checklist applied at the end ("add HTTPS and a login page"). By then the expensive decisions are already made: the database sits in a subnet with an Internet route, every service shares one database password, the gateway is the only place that checks anything. Changing those later means re-architecting.

The alternative is to ask security questions **while drawing the architecture**, with the same seriousness as "how many QPS?". Three ideas organize the whole class:

| Idea | Question it answers | Where in the class |
|---|---|---|
| **Threat modeling** | What can go wrong, and where? | this page |
| **Defense in depth** | If one control fails, what stops the attacker next? | this page, every subpage |
| **Least privilege / Zero Trust** | What is the *minimum* each user, service and network path needs? | [Zero Trust](zero-trust/index.md), [Service mesh](service-mesh/index.md) |

Two words used throughout:

- **Attack surface** — the sum of all the points where an attacker can try to enter or extract data: public endpoints, open ports, dependencies, people with access.
- **Blast radius** — what an attacker can reach *after* one component is compromised. Good design keeps it small.

---

## Threat modeling with STRIDE { #stride }

**Threat modeling** is a structured conversation about a design: draw how data flows, mark where the level of trust changes, and ask systematically what could go wrong at each element[^1]. Adam Shostack summarizes it in four questions[^2]:

1. *What are we working on?* — draw a **data-flow diagram** (DFD).
2. *What can go wrong?* — enumerate threats, for example with STRIDE.
3. *What are we going to do about it?* — pick a control for each threat (mitigate, accept, transfer, eliminate).
4. *Did we do a good job?* — review, test, repeat when the design changes.

### Step 1 — the checkout data-flow diagram

A **trust boundary** is a line where data moves between components with different levels of trust: the Internet and our edge, our cluster and the payment provider, a service and its database. Threats concentrate on the boundaries.

``` diagram-sim
flowchart LR
    subgraph internet ["Internet (untrusted)"]
        M(["Mobile app"])
        B(["Bot"])
    end
    subgraph edge ["Edge (public subnet)"]
        W["WAF + API gateway"]
    end
    subgraph cluster ["BoxOffice cluster (private subnets)"]
        O["order"]
        I["inventory"]
        P["payment"]
        A["auth"]
    end
    subgraph data ["Data (isolated subnets)"]
        DB[("PostgreSQL")]
    end
    subgraph ext ["Payment provider (3rd party)"]
        PSP["PSP API"]
    end
    M -->|"POST /orders + token"| W
    B -.->|"POST /holds × 10 000"| W
    W --> O
    O --> I
    I --> DB
    O --> P
    P -->|"API key, via NAT"| PSP
    PSP -.->|"webhook: payment captured"| W
    M -->|"login"| A
```

Five trust boundaries are crossed in a single checkout: Internet → edge, edge → cluster, service → database, cluster → provider and provider → cluster (the webhook). Each arrow is a question: *who is calling, how do we know, and what can they do?*

### Step 2 — STRIDE

**STRIDE** is a mnemonic created at Microsoft for six categories of threat, each the violation of a security property[^1]:

| Threat | Violated property | BoxOffice example | Control | Where |
|---|---|---|---|---|
| **S**poofing | Authentication | an attacker calls `payment` pretending to be `order`; a forged webhook says "payment captured" | OAuth tokens, mTLS between services, webhook signature (HMAC) | [Identity](../edge/identity/index.md), [Service mesh](service-mesh/index.md) |
| **T**ampering | Integrity | the price is changed in the request body; a malicious image is pushed to the registry | server-side pricing, TLS, signed images | [Zero Trust](zero-trust/index.md#supply-chain-security) |
| **R**epudiation | Non-repudiation | a customer says "I never bought these tickets" and we cannot prove otherwise | audit log with user id + trace id, signed events | [Observability](../observability/index.md) |
| **I**nformation disclosure | Confidentiality | `GET /orders/1042` returns another user's order; the API key leaks in a log | object-level authorization, secrets manager, log masking | [Identity](../edge/identity/index.md#authorization-models), [Zero Trust](zero-trust/index.md#secrets-management) |
| **D**enial of service | Availability | bots open 100 000 seat holds and nobody else can buy | WAF, rate limiting, waiting room, hold TTL | [Edge](../edge/index.md) |
| **E**levation of privilege | Authorization | a normal user calls `POST /admin/events`; the compromised `search` pod reaches the database | function-level authorization, NetworkPolicy, least privilege | [Zero Trust](zero-trust/index.md), [Cloud networking](cloud-network/index.md) |

STRIDE is applied **per element of the DFD**: processes are exposed to all six; data stores mainly to tampering, information disclosure and denial of service; data flows to tampering, disclosure and DoS; external entities to spoofing and repudiation[^2].

### Step 3 — rate the risk and decide

Not every threat deserves the same effort. A simple practice is to estimate **likelihood × impact** (low / medium / high) and act from the top of the list. The output of a threat-modeling session is a short table of *threat → decision → owner*, kept with the design document and revisited when the design changes.

!!! example "BoxOffice — three decisions from one session"

    | Threat | Likelihood × impact | Decision |
    |---|---|---|
    | Bots hoard seat holds at 10:00 | high × high | **Mitigate**: WAF bot rules + per-account and per-IP rate limits + waiting room + 10-minute hold TTL |
    | Forged "payment captured" webhook | medium × high | **Mitigate**: verify the provider's HMAC signature and re-query the payment status before issuing tickets |
    | Provider outage leaks no data but blocks sales | medium × medium | **Accept** for now; revisit with a second provider next quarter |

??? question "Think first: where is the most valuable asset in BoxOffice?"

    Not the database of events — that is public information. The most valuable assets are the **payment provider API key** (whoever has it can issue refunds or charges), **customer personal data** (regulated by Brazil's LGPD, the General Data Protection Law), and the **seat inventory itself** during a flash sale (a business asset that bots try to steal). The controls should be strongest around them.

---

## Defense in depth { #defense-in-depth }

No single control is perfect: WAF rules have gaps, tokens get stolen, a library ships with a remote-code-execution bug. **Defense in depth** stacks independent layers, so that an attacker who defeats one still faces the next. The layers of BoxOffice, from the outside in:

``` diagram-sim
flowchart LR
    U(["Client"]) -->|"1 · TLS, WAF, rate limit"| GW["API gateway"]
    GW -->|"2 · validate token (OAuth/OIDC)"| O["order"]
    O -->|"3 · check ownership (authZ)"| O
    O -->|"4 · mTLS + mesh policy"| P["payment"]
    P -->|"5 · subnet + security group"| DB[("PostgreSQL")]
    P -->|"6 · short-lived secret"| PSP["PSP"]
```

| # | Layer | Main threats | Controls | Subpage |
|---|---|---|---|---|
| 1 | Edge | DDoS, bots, injection, eavesdropping | TLS, WAF, rate limiting, waiting room | [Edge](../edge/index.md) |
| 2 | Identity | stolen or forged credentials | OAuth 2.1 / OIDC, short-lived tokens, MFA, passkeys | [Identity](../edge/identity/index.md) |
| 3 | Request authorization | user reads someone else's data | ownership, roles, scopes checked in each service | [Identity](../edge/identity/index.md#authorization-models) |
| 4 | Service to service | lateral movement, spoofed callers | mTLS, mesh authorization policy | [Service mesh](service-mesh/index.md) |
| 5 | Network | reaching what should be unreachable | private subnets, security groups, NetworkPolicy, no public DB | [Cloud networking](cloud-network/index.md) |
| 6 | Data and secrets | leaked keys and passwords | secrets manager, rotation, encryption at rest (KMS) | [Zero Trust](zero-trust/index.md#secrets-management) |
| 7 | Supply chain | malicious dependency or image | SBOM, vulnerability scan, signed images, provenance | [Zero Trust](zero-trust/index.md#supply-chain-security) |

The layers are **independent**: the database security group does not care whether the token was valid, and the mesh policy does not care whether the WAF was bypassed. That independence is the point.

---

## OWASP API Security Top 10 (2023) { #owasp-api-top-10 }

The **OWASP** (Open Worldwide Application Security Project) publishes a list of the most critical risks of APIs[^3]. It is the best checklist to bring to a design review, because almost every item is an *architecture* decision, not a typo. Mapped to BoxOffice:

| # | Risk | BoxOffice example | Main control |
|---|---|---|---|
| API1 | **Broken Object Level Authorization** (BOLA) | `GET /orders/1042` returns order 1042 to *any* logged-in user | every service checks that the object belongs to the caller |
| API2 | Broken Authentication | tokens without expiry; login endpoint without brute-force protection | standard OIDC provider, short tokens, rate-limited login, MFA |
| API3 | Broken Object Property Level Authorization | `PATCH /orders/1042 {"status":"PAID"}` accepted; `GET /users/me` returns the password hash | explicit input/output DTOs, never bind the request to the entity |
| API4 | Unrestricted Resource Consumption | one account opens 5 000 seat holds; `GET /events?size=1000000` | rate limits, quotas, pagination caps, hold TTL |
| API5 | Broken Function Level Authorization | a customer calls `POST /admin/events` | role checks per endpoint, admin API on a separate route/network |
| API6 | Unrestricted Access to Sensitive Business Flows | scalper bots buy the whole stadium in seconds | bot detection, per-account purchase limits, waiting room, CAPTCHA/device attestation |
| API7 | Server-Side Request Forgery (SSRF) | "import event poster from URL" fetches `http://169.254.169.254/` (cloud metadata) | allow-list destinations, block internal ranges, egress control |
| API8 | Security Misconfiguration | debug endpoints in production; permissive CORS; verbose stack traces | hardened defaults, config review in CI |
| API9 | Improper Inventory Management | an old `/v1/orders` without the new checks is still online | API inventory, deprecate and remove old versions |
| API10 | Unsafe Consumption of APIs | trusting the provider's webhook body blindly | verify signatures, validate and re-query, timeouts |

!!! warning "BOLA is number one for a reason"
    The gateway can say "this is user 42". Only the `order` service knows whether order 1042 belongs to user 42. Object-level authorization **cannot** be centralized at the edge; it lives in the code that owns the data. Test it explicitly: "user A requests user B's order → `404` or `403`".

**Try it.** Open the `flash-sale` scenario and press **Run**: watch how the burst when the sale opens (t = 60 s, our 10:00) saturates `app` and then `inventory-db`. Now select `users` and set its *bot traffic* to 0.45 — bots become about 30% of the requests (API6) — and run again. Which component would you add first, and where — WAF at the edge, rate limiting at the gateway, or the waiting-room queue? Use the [full playground](../../../playground/index.md) (↗) to add the components and compare p99 and the error rate (goals count only real users).

<div class="sdp" data-scenario="flash-sale" data-mode="compact" data-height="520"></div>

## The network & security concept map { #concept-map }

Security is not one box on the diagram: every hop of a request answers a different **trust question**. The map links each **palette component** (green) to the **concepts** it enforces (blue) and to the subpage that teaches them; the blue nodes are the layers of [defense in depth](#defense-in-depth):

``` diagram
flowchart LR
    client["client · mobile"]:::comp -->|"login"| auth["auth"]:::comp
    client --> waf["waf"]:::comp
    waf --> apigw["apigw"]:::comp
    apigw --> mesh["mesh<br/>(order, payment, …)"]:::comp
    mesh -->|"egress via nat"| pay["payment (PSP)"]:::comp
    vpc["vpc · subnet ·<br/>nat · vpn"]:::comp -.->|"contains"| mesh
    waf -.- c1["bots, rate limits,<br/>OWASP API4 / API6"]:::tech
    auth -.- c2["OAuth 2.1 + PKCE, OIDC,<br/>RBAC / ABAC / ReBAC"]:::tech
    apigw -.- c3["JWT validation (JWKS),<br/>strip identity headers"]:::tech
    mesh -.- c4["mTLS, SPIFFE identity,<br/>authz policy, NetworkPolicy"]:::tech
    vpc -.- c5["CIDR plan, public / private /<br/>isolated subnets, SGs"]:::tech
    pay -.- c6["secrets manager,<br/>dual-key rotation"]:::tech
    c4 -.- d1["Zero Trust: assume breach,<br/>default deny"]
    c1 -.- d2["STRIDE, OWASP API Top 10<br/>(this overview)"]
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

| Palette component | Question it answers | Concepts | Taught in | Scenarios |
|---|---|---|---|---|
| [`waf`](../../reference/components/edge/index.md#waf) | Is this request an attack or a bot? | OWASP API4/API6, bot rules, rate limits, waiting room | [OWASP API Top 10](#owasp-api-top-10), [Edge — security](../edge/index.md#edge-security) | `flash-sale`, `rate-limiter` |
| [`auth`](../../reference/components/compute/index.md#auth) | *Who* is the user, and which client asks? | OAuth 2.1, Authorization Code + PKCE, OIDC, Client Credentials, Token Exchange | [Identity](../edge/identity/index.md#oauth) | `flash-sale` (extend it), `blank` |
| [`apigw`](../../reference/components/edge/index.md#apigw) | Does the request carry a valid token? | JWT validation (JWKS, `iss`, `aud`, `exp`), header stripping | [Identity — gateway](../edge/identity/index.md#gateway-validation) | `rate-limiter`, `flash-sale` |
| [`vpc`](../../reference/components/network/index.md#vpc) · [`subnet`](../../reference/components/network/index.md#subnet) | *Where* does each component live, and what can reach it? | CIDR plan, public/private/isolated subnets, route tables, SGs/NACLs | [Cloud networking](cloud-network/index.md#subnets) | `multi-region`, `scale-out` |
| [`nat`](../../reference/components/network/index.md#nat) | How do private services call *out*? | NAT per AZ, stable egress IP, VPC endpoints | [Cloud networking](cloud-network/index.md#subnets) | `payment-system` |
| [`vpn`](../../reference/components/network/index.md#vpn) | How do other networks and people get *in*? | peering, transit, PrivateLink, VPN, session manager | [Cloud networking](cloud-network/index.md#private-connectivity) | `multi-region` |
| [`mesh`](../../reference/components/network/index.md#mesh) | *Which service* may call which? | mTLS, SPIFFE, authorization policy, traffic policy, NetworkPolicy | [Service mesh](service-mesh/index.md) | `cascading-failure`, `retry-storm` |
| [`payment`](../../reference/components/external/index.md#payment) | Who holds the key that moves money? | secrets manager, dual-key rotation, workload identity, webhook HMAC | [Zero Trust — secrets](zero-trust/index.md#secrets-management) | `payment-system` |
| *(all of them)* | Can we trust the code that runs? | Zero Trust, SBOM, scanning, signing, SLSA | [Zero Trust — supply chain](zero-trust/index.md#supply-chain-security) | `ai-assistant` |

!!! tip "In the interview"
    You will rarely be asked "do threat modeling". But a strong candidate **volunteers security in one or two sentences at the right time**: "the database lives in an isolated subnet with no Internet route; services talk over mTLS; the mobile app uses Authorization Code with PKCE; the payment key is in a secrets manager and rotated; and at the edge, WAF plus per-account rate limits protect the on-sale flow from bots." Then move on — unless the interviewer digs in. Mention **BOLA** whenever you design an endpoint with an id in the path.

!!! success "Best practices"

    - **Draw the trust boundaries on the architecture diagram and record each STRIDE decision with an owner** — mitigate, accept or transfer, in the design doc, so a reviewer can see which threats were left open on purpose.
    - **Deny by default** — a route is protected unless it is explicitly listed as open, so a new endpoint cannot ship unprotected. In BoxOffice: the gateway's `SecurityConfig` ends with `.anyExchange().authenticated()` ([gateway box](../edge/identity/index.md#gateway-validation)).
    - **Write negative authorization tests for every endpoint that takes an id** — "user A requests user B's order → `404`" runs in CI; BOLA is API1 because nobody tests it.
    - **Rate-limit per account and per IP on expensive endpoints** — login is slow on purpose (BCrypt, ~10–20 checks/s per CPU in [lab 4](../../hands-on/4/index.md)) and holds are scarce; bots (API6) must hit a limit before they hit the database.
    - **Log security events to an append-only store and alert on them** — failed logins, `401`/`403` bursts, admin actions and denied service-to-service calls, kept long enough to investigate (e.g. 1 year).
    - **Patch on a clock enforced by the pipeline** — a fixable critical vulnerability blocks the release. In BoxOffice: the Trivy gate of [lab 11](../../hands-on/11/supply-chain/index.md).

!!! warning "Common pitfalls"
    - **Security only at the gateway** — any service reachable without passing through it (a `NodePort`, a debug port, a second Ingress) bypasses everything.
    - **Trusting the internal network** — "it's inside the VPC, so it's safe" is how one compromised pod becomes a full breach.
    - **Rolling your own** crypto, token format or login protocol — use standards and vetted libraries.
    - **Threat model once, never again** — the model is stale the day a new flow (webhooks, an AI assistant with tools) is added.

---

## Related

- Components in the [catalog](../../reference/components/network/index.md#vpc): VPC, Subnet, NAT Gateway, VPN, Service Mesh; plus [Auth Service](../../reference/components/compute/index.md#auth) and [WAF](../../reference/components/edge/index.md#waf).
- Classes: [Traffic & edge](../edge/index.md) (WAF, API gateway, rate limiting), [Cloud-native](../cloud-native/index.md) (Kubernetes, CI/CD), [Observability](../observability/index.md) (audit trails, security alerts).
- Hands-on: [4 — Gateway & identity](../../hands-on/4/index.md), [10 — Kubernetes](../../hands-on/10/index.md), [11 — Delivery](../../hands-on/11/supply-chain/index.md) (image scan, SBOM, signed provenance).
- Case study: [Payment system](../case-studies/payment-system/index.md). Exercise: [Design doc](../../exercises/design-doc/index.md). Project: [team project](../../exercises/project/index.md).

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - Security is a **design property**: decide boundaries, identities and privileges while drawing the architecture.
    - **Threat modeling** = draw the data flow, mark the trust boundaries, run **STRIDE** per element, decide and record.
    - **Defense in depth** stacks independent layers: edge, identity, request authorization, service-to-service, network, secrets, supply chain.
    - The **OWASP API Top 10** is a design-review checklist; **BOLA** is number one and can only be fixed in the service that owns the data.
    - In an interview, mention security briefly and concretely at the right moment — private subnets, mTLS, PKCE, secrets manager, rate limits.

## What breaks next { #what-breaks-next }

Every caller in this class is a person or a service we wrote: the fan with a token, `order` with a workload identity, the pipeline with a signed provenance. The next caller is neither. Fans want to ask "two seats under R$ 300 on Saturday, hold them", and an assistant answers by calling `catalog` and `inventory` for them: a slow, expensive, non-deterministic dependency that can **act** on the inventory, on the fan's behalf, and can be talked into doing the wrong thing by the text it reads. Designing a system around a model — and deciding what it may touch — is [class 13 — AI Systems](../ai-systems/index.md).

---

[^1]: KOHNFELDER, L.; GARG, P. [The Threats to Our Products](https://www.microsoft.com/en-us/security/blog/2009/08/27/the-threats-to-our-products/){target="_blank"}. Microsoft, 1999 (republished by Adam Shostack on the Microsoft Security blog, 2009) — origin of STRIDE. See also Microsoft's [Threat Modeling Tool — STRIDE](https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats){target="_blank"}.
[^2]: SHOSTACK, A. *Threat Modeling: Designing for Security*. Wiley, 2014. See also the [Threat Modeling Manifesto](https://www.threatmodelingmanifesto.org/){target="_blank"}.
[^3]: OWASP. [API Security Top 10 — 2023](https://owasp.org/API-Security/editions/2023/en/0x11-t10/){target="_blank"}.
