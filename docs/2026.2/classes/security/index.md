# Security: OAuth 2.0, OIDC & Zero Trust

In [Hands-on 3](../../hands-on/3/index.md) we secured the store with a homemade scheme: `auth-service` checks the password, signs a JSON Web Token (JWT) with an HMAC secret and returns it in a cookie; on every request the gateway asks `auth-service` to resolve the token and forwards the caller's id in the `id-account` header. That works for one web app with one login form. Now the store wants **"Sign in with Google"**, a **mobile app**, a **nightly job** that calls `order-service` with no user behind it, and — one day — a vulnerable library lets an attacker run code inside the `product-service` pod. The homemade scheme has no answer to any of these.

JWT is a transport format — it carries claims such as "this is account 42". It says nothing about how the user proved their identity, who may issue tokens, how a third-party app gets access without seeing the password, or why one service should trust a call from another. **OAuth 2.0** and **OpenID Connect** are the standards that fill these gaps; **Zero Trust** is the architecture that stops trusting the network itself: distrust everything, verify always.

!!! abstract "Learning objectives"

    By the end of this class you should be able to:

    - **Distinguish** authentication from authorization and point out which component of the store performs each one.
    - **Explain** the four OAuth 2.0 roles and **choose** the right grant (Authorization Code + PKCE, Client Credentials, Device Code) for a given client.
    - **Compare** access, refresh and ID tokens, and explain what OpenID Connect adds on top of OAuth 2.0.
    - **Configure** a gateway to validate JWTs locally with a JWKS, and **compare** it with the remote validation (`/auth/solve`) used in Hands-on 3.
    - **Apply** Zero Trust controls — mTLS, NetworkPolicy, least privilege — to service-to-service traffic in Kubernetes.
    - **Choose** a secrets-management approach and explain why a base64 Kubernetes Secret is not encryption.

!!! warning "Prerequisite"
    This class builds on the JWT concepts from [Hands-on 3](../../hands-on/3/index.md). Make sure you are comfortable with the JWT structure (header.payload.signature), the `sub`, `exp` and `iss` claims, and how the gateway validates tokens before reading this — see [Hands-on 3 — JWT](../../hands-on/3/jwt/index.md) and [Hands-on 3 — Authorization](../../hands-on/3/authorization/index.md).

## Slides

<div class="slides-embed">
  <iframe src="slides/security.html" title="Slides: security — oauth2 & zero trust" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/security.html){:target="_blank"}

---

## Roadmap

1. **Overview** (this page) — authentication vs. authorization, what Hands-on 3 built, what JWT alone cannot do, and the map of security layers of the store.
2. [OAuth 2.0 & OpenID Connect](oauth/index.md) — roles, tokens and scopes, grant types (Authorization Code + PKCE, Client Credentials), OIDC and the ID Token, and how the gateway validates tokens (JWKS vs. introspection).
3. [Zero Trust, mTLS & Secrets](zero-trust/index.md) — perimeter vs. Zero Trust, mutual TLS and workload identity, Kubernetes NetworkPolicy, and secrets management.

---

## Authentication vs. authorization

Two questions are asked on every request, and they are often confused:

| | **Authentication** (authN) | **Authorization** (authZ) |
|---|---|---|
| Question | *Who are you?* | *What are you allowed to do?* |
| Input | a **credential**: password, certificate, token | the authenticated identity + a **policy** (roles, scopes, ownership) |
| Failure | `401 Unauthorized` (no or invalid credential) | `403 Forbidden` (valid identity, not allowed) |
| In the store | `auth-service` checks email + password at `POST /auth/login`; the gateway checks the token on each request | `order-service` checks that order `123` belongs to the `id-account` that asked for it |

A few terms used throughout the class:

- **Principal** — the authenticated entity: a user (`ada@store.com`) or a workload (`order-service`).
- **Credential** — what a principal presents to prove its identity (a password, a private key, a token).
- **Token** — a string issued after authentication that the principal presents instead of the credential. A **bearer token** grants access to *whoever holds it*, like cash: steal it and you can spend it.
- **Claim** — a statement inside a token, such as `"sub": "42"` or `"scope": "orders:read"`.

!!! warning "Authorization is not done once at the gateway"
    The gateway can say "this is account 42". Only `order-service` knows whether order `123` belongs to account 42. Forgetting this check — `GET /orders/123` returns any order to any logged-in user — is **Broken Object Level Authorization**, the number-one risk in the OWASP API Security Top 10 (2023)[^1].

---

## What Hands-on 3 built

The flow below is the one you implemented: the token is a **reference** that only `auth-service` can read, and the gateway asks for it on every call.

``` mermaid-sim
sequenceDiagram
    autonumber
    actor B as Browser
    participant GW as gateway-service
    participant AU as auth-service
    participant AC as account-service
    B->>GW: POST /auth/login {email, password}
    GW->>AU: forward (open route)
    AU->>AU: check password, sign JWT (HMAC secret)
    AU-->>B: Set-Cookie: __store_jwt_token
    B->>GW: GET /accounts/me + cookie
    GW->>AU: POST /auth/solve {token}
    AU-->>GW: {idAccount}
    GW->>AC: GET /accounts/me + id-account header
    AC-->>B: 200 OK
```

It is a sound design for a single application, and it has three properties worth naming:

- **Symmetric signature (HMAC, e.g. HS256)** — the same secret signs and verifies. Only `auth-service` holds `JWT_SECRET_KEY`, so only it can validate tokens; that is why the gateway must call it.
- **Remote validation** — one extra network hop per request, but `auth-service` could refuse a token immediately (for example, after logout).
- **Trust in the network** — `account-service` believes any `id-account` header, because only the gateway can reach it inside the Docker network.

## What JWT alone cannot do

| Problem | Homemade JWT (Hands-on 3) | Standard answer | Where |
|---|---|---|---|
| Third-party login ("Sign in with Google") | ✗ no way to delegate | Authorization Code + PKCE flow | [OAuth](oauth/index.md#authorization-code-pkce) |
| Service-to-service calls with no user | ✗ no standard; services reuse a user token or a shared password | Client Credentials grant | [OAuth](oauth/index.md#client-credentials) |
| Let other services verify tokens themselves | ✗ HMAC secret would have to be copied to every service | asymmetric keys published as a JWKS | [OAuth](oauth/index.md#local-validation-with-jwks) |
| Revoke a token before it expires | only with a remote check on every call | short-lived access tokens + refresh tokens; introspection | [OAuth](oauth/index.md#token-lifecycle) |
| Standard user identity for the client app | ✗ ad-hoc claims | OIDC ID Token + UserInfo endpoint | [OAuth](oauth/index.md#openid-connect-oidc) |
| A compromised pod calling other services | ✗ the internal network is trusted | mTLS, NetworkPolicy, authorization policies | [Zero Trust](zero-trust/index.md) |

---

## The security layers of the store

No single control protects a system. **Defense in depth** stacks independent layers, so that an attacker who defeats one still faces the next. The diagram follows a request from the Internet down to the data:

``` mermaid-sim
flowchart LR
    U(["Client"]) -->|"HTTPS (TLS)"| GW["Gateway<br>validates token"]
    IdP["Identity Provider<br>(auth-service / Keycloak)"] -->|"issues tokens"| U
    GW -->|"identity header<br>(mTLS inside)"| SVC["order-service<br>checks ownership"]
    SVC -->|"allowed by<br>NetworkPolicy"| PS["product-service"]
    SVC -->|"short-lived<br>DB credential"| DB[("Postgres")]
```

| Layer | Threat | Control | Where in the course |
|---|---|---|---|
| Edge | eavesdropping, abuse | TLS, rate limiting | [Hands-on 2 — Gateway](../../hands-on/2/index.md), [Hands-on 7 — Nginx](../../hands-on/7/index.md) |
| Identity | stolen or forged credentials | OAuth 2.0 / OIDC, short-lived tokens | [OAuth 2.0 & OIDC](oauth/index.md), [Hands-on 3](../../hands-on/3/index.md) |
| Request | user reads someone else's data | authorization in each service (ownership, roles, scopes) | this page |
| Service-to-service | lateral movement from a compromised pod | mTLS, NetworkPolicy, authorization policies | [Zero Trust](zero-trust/index.md), [Hands-on 5](../../hands-on/5/index.md) |
| Data | leaked passwords and keys | secrets manager, encryption at rest | [Zero Trust — Secrets](zero-trust/index.md#secrets-management) |

!!! warning "Common mistakes"
    - **Security only at the gateway.** If any service is reachable without passing through the gateway (a `NodePort`, a debug port, a misconfigured Ingress), anyone can send `id-account: <any id>` and impersonate any user.
    - **Rolling your own crypto or protocol.** Hashing, signing and token flows are subtle; use a vetted library (JJWT, Spring Security) and a standard flow.
    - **Long-lived bearer tokens.** Hands-on 3 issues 24-hour tokens; a stolen one is valid for a day. Short access tokens plus refresh tokens shrink that window.

---

## Key takeaways

- **Authentication** answers *who*, **authorization** answers *what*; the gateway authenticates, but each service must still authorize access to its own objects.
- A JWT is only a **format**. OAuth 2.0 defines **how tokens are obtained and delegated**; OIDC adds a standard **identity** (ID Token).
- Hands-on 3 uses a **symmetric** key and **remote** validation; standard deployments use **asymmetric** keys and a **JWKS** so any service can validate locally.
- **Zero Trust** removes the assumption that the internal network is safe: every call carries a verifiable identity and is checked against a policy.
- Security is **layered**: TLS at the edge, tokens for users, mTLS and NetworkPolicy between services, a secrets manager for credentials.

[^1]: OWASP. [API1:2023 — Broken Object Level Authorization](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/){target="_blank"}. OWASP API Security Top 10, 2023.
