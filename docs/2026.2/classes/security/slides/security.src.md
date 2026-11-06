---
marp: true
lang: en
title: Security — OAuth2 & Zero Trust
description: Platforms, Microservices, DevOps and APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Platforms, Microservices, DevOps and APIs · Insper</div>

# Security — OAuth2 & Zero Trust

**Delegate identity to a standard, verify every request**

<!--
Outline: (1) overview: authN vs authZ, what Hands-on 3 built, what JWT alone cannot do, the security
layers; (2) OAuth 2.0: roles, tokens, scopes, grants, PKCE, Client Credentials, OIDC, JWKS vs
introspection, browser storage, pitfalls; (3) Zero Trust: PEP/PDP, the compromised pod, mTLS + policy,
NetworkPolicy, secrets.
-->

---

## Hands-on 3 works — until it doesn't

<div class="q">

`auth-service` signs an HMAC JWT in a cookie; the gateway calls `/auth/solve` and forwards `id-account`.
Now the store wants **Google login**, a **mobile app**, a **nightly job**… and one pod gets **hacked**. What breaks?

</div>

* The app would have to see the **Google password** — no way to delegate.
* The job has **no user** — whose token does it send?
* The hacked pod sends `id-account: <anyone>` — the internal network is **trusted**.

<!--
Let the class answer first. Each bullet maps to a part of the class: OAuth, Client Credentials, Zero Trust.
-->

---

## Authentication vs. authorization

| | **Authentication** (authN) | **Authorization** (authZ) |
|---|---|---|
| Question | *who are you?* | *what may you do?* |
| Failure | `401 Unauthorized` | `403 Forbidden` |
| In the store | login at `auth-service`; token check at the gateway | `order-service`: does order 123 belong to this `id-account`? |

<div class="warn">

The gateway **authenticates**; each service must still **authorize** its own objects. Skipping it = Broken Object Level Authorization, #1 in OWASP API Top 10.

</div>

<p class="small">Bearer token: whoever holds it can use it — like cash.</p>

---

## What Hands-on 3 built

1. `POST /auth/login` → `auth-service` checks the password, signs a JWT, returns it in a cookie.
2. Each request: gateway → `POST /auth/solve {token}` → `{idAccount}`.
3. Gateway forwards the call with the `id-account` header.

| Property | Consequence |
|---|---|
| **Symmetric signature** (HMAC, HS256) | only `auth-service` holds `JWT_SECRET_KEY` → only it can validate |
| **Remote validation** | one extra hop per request, but immediate refusal (e.g. after logout) |
| **Trust in the network** | `account-service` believes any `id-account`: only the gateway reaches it |

<p class="small">A sound design for <b>one</b> application — the token is a reference only <code>auth-service</code> can read.</p>

---

## What JWT alone cannot do

| Problem | Homemade JWT | Standard answer |
|---|---|---|
| Third-party login (Google) | cannot delegate | **Authorization Code + PKCE** |
| Service-to-service, no user | reuse a user token | **Client Credentials** |
| Other services verify tokens | HMAC secret copied everywhere | asymmetric keys + **JWKS** |
| Revoke before expiry | remote check on every call | short access + **refresh** tokens |
| Standard user identity | ad-hoc claims | OIDC **ID Token** |
| Compromised pod | internal network trusted | **mTLS**, **NetworkPolicy** |

<p class="small">JWT is a <b>format</b>. OAuth 2.0 and OIDC define how tokens are obtained, delegated and trusted.</p>

---

## The security layers of the store

**Defense in depth**: independent layers, so an attacker who defeats one still faces the next.

| Layer | Threat | Control |
|---|---|---|
| Edge | eavesdropping, abuse | TLS, rate limiting |
| Identity | stolen or forged credentials | OAuth 2.0 / OIDC, short-lived tokens |
| Request | user reads someone else's data | authorization in each service |
| Service-to-service | lateral movement from a pod | mTLS, NetworkPolicy, authz policies |
| Data | leaked passwords and keys | secrets manager, encryption at rest |

<div class="warn">

**Security only at the gateway**: a `NodePort` or debug port lets anyone send `id-account: <any id>`. Also: no homemade crypto; no 24-hour bearer tokens.

</div>

---

## OAuth 2.0: roles

| Role | In the store |
|---|---|
| **Resource Owner** — the user | Ada, a customer |
| **Client** — app requesting access | web frontend, mobile app, nightly job |
| **Authorization Server** — issues tokens | Keycloak, Auth0, Cognito (or `auth-service`) |
| **Resource Server** — API, validates tokens | `order-service`, `account-service` |

- **Confidential client**: runs on a server, can keep a `client_secret`.
- **Public client**: SPA or mobile app — cannot keep a secret.

<div class="ok">

**Delegated authorization**: the client gets a limited token **without ever seeing the password**.

</div>

---

## Tokens and scopes

| Token | Goes to | Lifetime |
|---|---|---|
| **Access token** — `Authorization: Bearer …` | Resource Server | 5–60 min |
| **Refresh token** — gets new access tokens | Authorization Server only | hours to weeks |
| **ID token** (OIDC) — who the user is | the Client only | minutes |

- **Scope**: permission the user consents to — `openid`, `email`, `orders:read`.
- Spring turns scopes into authorities: `hasAuthority('SCOPE_orders:read')`.
- Short access tokens bound the damage of theft; **rotate** refresh tokens.

---

## Grant types

| Grant | Use case | Status |
|---|---|---|
| **Authorization Code + PKCE** | any app where a user logs in | default |
| **Client Credentials** | service-to-service, no user | default for M2M |
| **Device Authorization** | smart TV, CLI | niche |
| **Implicit** | old SPAs, token in URL | deprecated |
| **Password (ROPC)** | client collects the password | **must not be used** |

<p class="small">Choose: user involved? no → Client Credentials · has a browser? yes → Code + PKCE · no → Device.</p>

<div class="warn">

**Never ROPC**: it defeats delegation and blocks MFA — RFC 9700 forbids it; the OAuth 2.1 draft drops it.

</div>

---

<!-- _class: tight -->

## Authorization Code + PKCE

1. App creates `state`, a random `code_verifier` and `code_challenge = BASE64URL(SHA-256(verifier))`.
2. Redirect → `/authorize?response_type=code&client_id&code_challenge&state`.
3. User logs in **at the Authorization Server** (Keycloak), never in the app.
4. Redirect back with `?code=AUTH_CODE&state` — app checks `state`.
5. App → `POST /token {code, code_verifier}` → `access_token`, `refresh_token`, `id_token`.
6. App → `GET /orders` with `Bearer access_token`; the API verifies it with the cached JWKS.

<div class="ok">

An intercepted code is **useless** without the verifier, which never left the app.

</div>

<!--
Stress step 5: the server hashes the verifier and compares it with the challenge from step 2.
-->

---

## Client Credentials: a service as itself

```bash
curl -X POST http://keycloak:8080/realms/store/protocol/openid-connect/token \
  -d grant_type=client_credentials \
  -d client_id=order-service \
  -d client_secret="$ORDER_SERVICE_SECRET" \
  -d scope=stock:read
```

- Token says `sub=order-service`, `scope=stock:read` — not a person.
- `product-service` verifies it and checks the scope.
- **Never borrow a user's token** for background work: no audit trail, too many permissions.

---

## OpenID Connect

OAuth 2.0: *can this client access this resource?* OIDC adds: **who is this user?**

- the `openid` **scope**; the **ID Token** (a JWT for the client); **UserInfo** — `GET /userinfo`.

| Claim | Meaning |
|---|---|
| `sub` / `iss` | stable user id · issuer URL |
| `aud` | must contain the client's `client_id` |
| `exp` / `iat` | expiry / issued-at |
| `nonce` | echoed back — blocks replay of an old ID token |

<p class="small">Discovery: <code>GET /.well-known/openid-configuration</code> → endpoints and <code>jwks_uri</code>. APIs accept <b>access</b> tokens, never ID tokens.</p>

---

<!-- _class: tight -->

## Validating at the gateway

| | Local (JWKS) | Remote (`/auth/solve`, introspection) |
|---|---|---|
| Latency | no extra hop | one call per request |
| Auth Server down | still works | every request fails |
| Revocation | only at `exp` | immediate |
| Keys | public key only (RS256/ES256) | secret stays in the Auth Server |

```yaml
spring.security.oauth2.resourceserver.jwt:
  issuer-uri: http://keycloak:8080/realms/store   # discovers jwks_uri, checks iss
  audiences: store-api                            # Spring Boot 3.1+: checks aud
```

<p class="small">Check signature (allow-listed alg, never <code>none</code>), <code>exp</code>, <code>iss</code>, <code>aud</code>, scopes. Forward <code>id-account</code> — accept it <b>only from the gateway</b>.</p>

---

## Where the browser keeps the token

| Storage | Read by JS? | Main risk | Mitigation |
|---|---|---|---|
| `localStorage` / `sessionStorage` | yes | any XSS script steals it | avoid for tokens |
| `HttpOnly` cookie (Hands-on 3) | no | CSRF: the cookie goes automatically | `SameSite`, `Secure`, CSRF tokens |
| Server-side session (BFF) | no token in the browser | session theft | the BFF holds the tokens |

---

## OAuth 2.0 pitfalls

- **ROPC or Implicit** in new code — use Authorization Code + PKCE.
- **Skipping the `aud` check** — a valid token for another API is accepted by yours.
- **Long-lived access tokens** — a stolen bearer token is valid until `exp`.
- **One HMAC secret shared by many services** — whoever can verify can also *forge*; use a JWKS.
- **Tokens in URLs or logs** — they end up in proxy logs and history; use headers or cookies.
- **Calling the API with the ID token** — ID tokens are for the client; APIs accept access tokens.

---

## Zero Trust

<div class="cols">
<div>

### Perimeter model

Firewall outside; **everything inside is trusted**.

One compromised pod → **lateral movement** everywhere.

</div>
<div>

### Zero Trust (NIST SP 800-207)

**Every request** → **PEP** (enforcement point: gateway, sidecar) → **PDP** (policy decision) → allow with **least privilege** or deny.

</div>
</div>

| Principle | Mechanism |
|---|---|
| Verify identity explicitly | OIDC tokens, mTLS, SPIFFE |
| Least privilege · assume breach | scopes, RBAC, NetworkPolicy |
| Continuous validation | short TTLs, re-auth, monitoring |

---

## Example: the compromised pod, again

| Attacker step | Perimeter model | Zero Trust control |
|---|---|---|
| Call `account-service` with a forged `id-account` | accepted: caller is "inside" | only the gateway's workload identity (mTLS + authz policy) |
| Connect to any pod | allowed | NetworkPolicy: only declared flows |
| Reuse the DB password from the env | works for months | short-lived, per-service credential (≤ 1 hour) |

<div class="ok">

**Assume breach**: limit what a compromised pod can **call**, **reach** and **read**.

</div>

---

<!-- _class: tight -->

## Service identity: mTLS + policy

- **TLS**: only the server shows a certificate. **mTLS**: **both** do → encrypted + mutual identity.
- **SPIFFE/SPIRE** issue short-lived **SVIDs**: `spiffe://cluster.local/ns/store/sa/order-service`.
- **Service meshes** (Istio, Linkerd): sidecars do mTLS — no code changes.

```yaml
kind: AuthorizationPolicy            # Istio: mTLS says who, the policy says whether
spec:
  selector: { matchLabels: { app: product-service } }
  action: ALLOW
  rules:
    - from: [{ source: { principals: ["cluster.local/ns/store/sa/order-service"] } }]
      to:   [{ operation: { methods: ["GET"], paths: ["/products/*"] } }]
```

---

## NetworkPolicy: default deny, then allow

```yaml
kind: NetworkPolicy
metadata: { name: order-service-ingress, namespace: store }
spec:
  podSelector: { matchLabels: { app: order-service } }
  policyTypes: [Ingress]
  ingress:
    - from: [{ podSelector: { matchLabels: { app: gateway-service } } }]
      ports: [{ port: 8080 }]
```

- Start with `podSelector: {}` + no rules = **deny all ingress**.
- Only `gateway-service` reaches `order-service:8080`; everything else is dropped.

<div class="warn">

Enforced by the **CNI**: Calico/Cilium yes, default minikube **no**: start it with `--cni=calico`.

</div>

---

## Secrets management

<div class="warn">

A Kubernetes Secret is **base64, not encryption**: `echo c3RvcmU= | base64 -d` → `store` (Hands-on 5's Postgres password).

</div>

| Approach | Pros | Cons |
|---|---|---|
| **Kubernetes Secrets** | simple, native | needs encryption at rest + RBAC; keep out of Git |
| **Cloud secret managers** | managed, rotation, audit | one cloud; extra latency |
| **HashiCorp Vault** | dynamic secrets, any cloud | operational overhead |

<p class="small">Vault <b>dynamic secrets</b>: a unique DB user per lease, dropped at expiry. The <b>Agent Injector</b> writes it to <code>/vault/secrets/db</code> (<code>vault.hashicorp.com/agent-inject: "true"</code>).</p>

---

## Secrets: common mistakes

- **Secrets in Git**, even private or "just for dev" — history keeps them; rotate any secret ever committed.
- **One shared credential for every service** — a leak cannot be traced; rotating it breaks everyone.
- **Secrets in logs and error messages** — mask them, as Jenkins does with `withCredentials`.
- **Treating mTLS as authorization** — a certificate proves identity, not permission.

<div class="ok">

Minimum hygiene for native Secrets: **encryption at rest** for etcd, **RBAC** on `get`/`list`, manifests **out of Git** (or Sealed Secrets / SOPS).

</div>

---

## Takeaways

1. **AuthN** = who, **authZ** = what; the gateway authenticates, each service authorizes its objects.
2. JWT is a **format**; OAuth 2.0 + OIDC define how tokens are **obtained, delegated and trusted**.
3. **Code + PKCE** for users, **Client Credentials** for services — **never ROPC or Implicit**.
4. Short **access tokens** to APIs, **refresh tokens** to the Auth Server, **ID token** to the client.
5. **JWKS** = local validation, no hop; **introspection** (`/auth/solve`) = immediate revocation.
6. **Zero Trust**: assume breach, verify every call — mTLS identity, authorization policy, default-deny NetworkPolicy.
7. Security is **layered**: TLS at the edge, tokens for users, mTLS between services, a secrets manager — base64 is not encryption.
