
BoxOffice launches its mobile app. Someone proposes the obvious design: a login screen in the app, the app sends e-mail and password to `POST /login`, keeps the password in the phone "so the user does not have to type it again", and sends it on every request. Within a week the product team also wants **"Sign in with Google"**, a **web checkout**, a nightly **reconciliation job** in `order` that calls `inventory` with no user behind it, and an **AI assistant** that acts on the user's behalf. A homemade login cannot express any of this safely. This page is about the standards that can: **sessions and tokens**, **JWT**, **OAuth 2.1** and **OpenID Connect**, and the authorization models that decide *what* an authenticated caller may do.

---

## Authentication vs authorization

Two different questions are asked on every request:

| | **Authentication** (authN) | **Authorization** (authZ) |
|---|---|---|
| Question | *Who are you?* | *What are you allowed to do?* |
| Input | a **credential**: password, passkey, certificate, token | the identity + a **policy** (roles, scopes, ownership) |
| Failure | `401 Unauthorized` | `403 Forbidden` (or `404` to hide existence) |
| In BoxOffice | the `auth` service (an identity provider) logs the user in; the gateway validates the token | `order` checks that order 1042 belongs to the caller; `admin` routes require the `organizer` role |

Vocabulary used below: a **principal** is the authenticated entity (a user or a workload); a **credential** is what it presents to prove it; a **token** is what it receives after authenticating and presents instead of the credential; a **claim** is a statement inside a token (`"sub": "acc-42"`). A **bearer token** works for *whoever holds it*, like cash.

---

## Sessions vs tokens

After login, the server must remember the user on the next request. Two families of designs:

``` mermaid
flowchart LR
    subgraph s ["Server-side session"]
        B1(["Browser"]) -->|"Cookie: sid=9f2c…"| A1["app"]
        A1 -->|"GET session:9f2c"| R[("Redis")]
    end
    subgraph t ["Self-contained token (JWT)"]
        B2(["App"]) -->|"Authorization: Bearer eyJ…"| A2["gateway"]
        A2 -->|"verify signature locally<br/>(cached public key)"| A2
    end
```

| | **Server-side session** (opaque id → store) | **Self-contained token** (JWT) |
|---|---|---|
| What the client holds | a random session id | a signed document with the claims |
| Validation | lookup in a shared store (Redis) | signature check with a public key, no lookup |
| Revocation (logout, stolen) | immediate: delete the key | hard: valid until `exp` unless you add a denylist or introspection |
| Horizontal scaling | needs a shared, highly available store | stateless; any instance validates |
| Cross-service use | services must call the session store | any service with the public key can verify |
| Size per request | ~32 bytes | often 0.5–2 KB in every request header |
| Best for | classic web apps, the BFF pattern | APIs, mobile apps, service-to-service |

Neither is "the modern one". Large systems combine them: a **short-lived JWT** (minutes) for APIs and a **revocable refresh token or session** stored server-side. Revocation latency then equals the access-token lifetime — a number you choose.

??? question "Think first: a user's phone is stolen at 14:00 and they log out from the web at 14:05. Access tokens live 15 minutes and are validated locally. Until when can the thief call the API?"

    The refresh token is revoked at 14:05, so the thief cannot get *new* access tokens. But the last access token issued — say at 13:58 — stays valid until **14:13**, because the gateway validates it locally and cannot know it was "logged out". The exposure window is up to one access-token lifetime after revocation. Shorter tokens shrink it; introspection or a denylist (by `jti`, the token id) closes it at the cost of a lookup.

---

## JSON Web Token (JWT)

A **JWT** (RFC 7519) is three Base64URL-encoded parts separated by dots: `header.payload.signature`. Decoded, a BoxOffice access token looks like this:

```text
header:  { "alg": "RS256", "typ": "at+jwt", "kid": "2026-10-a" }
payload: {
  "iss": "https://auth.boxoffice.com/realms/boxoffice",
  "sub": "acc-42",
  "aud": "boxoffice-api",
  "client_id": "boxoffice-mobile",
  "scope": "orders:read orders:write",
  "iat": 1792310400,
  "exp": 1792311300,
  "jti": "5b0e7c1a-6d1f-4c1e-9a43-0d6c2f6c9e10"
}
signature: RSASSA-PKCS1-v1_5( SHA-256( base64url(header) + "." + base64url(payload) ), private key )
```

The payload is **encoded, not encrypted** — anyone can read it. Never put secrets or personal data there you would not show the user.

With **asymmetric** algorithms (RS256, ES256, EdDSA) the identity provider signs with a private key that never leaves it, and anyone verifies with the public key, published as a **JWKS** (JSON Web Key Set) at the provider's `jwks_uri`. With **symmetric** HMAC (HS256), every verifier holds the same secret and can therefore also **forge** tokens — acceptable only when issuer and verifier are the same service.

### Validation checklist

RFC 8725 (JWT Best Current Practices) is the reference[^1]. A resource server must check:

| Check | Why |
|---|---|
| Signature with an **allow-listed algorithm** (never `alg: none`, never let the token header choose) | algorithm-confusion attacks forge tokens |
| Key selected by `kid` from **your** JWKS, re-fetched on unknown `kid` | key rotation without downtime |
| `iss` equals your identity provider | tokens from another issuer are rejected |
| `aud` contains **this** API | a token minted for another API cannot be replayed here |
| `exp` and `nbf`, with a small clock skew (≈ 30–60 s) | expired tokens rejected |
| `typ` is `at+jwt` for access tokens (RFC 9068) | an ID token cannot be used as an access token |
| required **scopes / roles** for the endpoint | least privilege |

---

## OAuth 2.1 { #oauth }

**OAuth** is a framework for **delegated authorization**: a client application obtains a **limited, short-lived access token** to call an API on behalf of a user — or on its own behalf — **without ever handling the user's password**. The user authenticates only at the authorization server[^2].

| Role | Description | In BoxOffice |
|---|---|---|
| **Resource owner** | the user who owns the data | Ana, a fan |
| **Client** | the application requesting access | mobile app, web checkout (BFF), reconciliation job, AI assistant |
| **Authorization server** (AS) | authenticates the user, asks for consent, issues tokens | the `auth` service (Keycloak in the course; Auth0, Cognito, Entra ID in industry) |
| **Resource server** (RS) | API that validates tokens and serves data | gateway + `order`, `inventory`, … |

Clients are **confidential** (run on a server, can keep a secret: the BFF, a batch job) or **public** (run on the user's device, cannot keep a secret: the mobile app, a single-page app — anyone can decompile or read them).

### What OAuth 2.1 changes

OAuth 2.0 (RFC 6749, 2012) accumulated a decade of security lessons in separate documents. **OAuth 2.1** — an IETF draft that consolidates them, together with the Security Best Current Practice (RFC 9700) — is what new systems should follow[^3][^4]:

| OAuth 2.0 allowed | OAuth 2.1 requires |
|---|---|
| Authorization Code with or without PKCE | **PKCE for every client** using the authorization code, including confidential ones |
| **Implicit** grant (token in the URL fragment) | removed — tokens leaked through history, referrers, logs |
| **Resource Owner Password Credentials** (the app collects the password) | removed — defeats delegation, blocks MFA, trains users to type passwords anywhere |
| redirect URIs matched by prefix or pattern | **exact string matching** of redirect URIs |
| bearer tokens in query strings | **never** in the URL; header or body only |
| long-lived refresh tokens for public clients | refresh tokens **sender-constrained or rotated** on every use |

### Choosing the grant

``` mermaid-sim
flowchart TD
    q1{"Is a user<br/>involved?"} -->|no| cc["Client Credentials<br/>(reconciliation job)"]
    q1 -->|yes| q2{"Can the device<br/>open a browser?"}
    q2 -->|yes| pkce["Authorization Code + PKCE<br/>(mobile app, web BFF)"]
    q2 -->|no| dev["Device Authorization<br/>(smart TV, CLI)"]
    pkce --> q3{"A service must call another<br/>on the user's behalf?"}
    q3 -->|yes| tx["Token Exchange<br/>(assistant → order)"]
```

---

## Authorization Code + PKCE for the mobile app

The app never sees the password. It opens the **system browser** (not an embedded WebView, where the app could read keystrokes — RFC 8252[^5]) at the authorization server, the user logs in there (with MFA or a passkey), and the app receives a short-lived, single-use **authorization code** through a redirect. The app then exchanges the code for tokens in a direct back-channel request.

**PKCE** (Proof Key for Code Exchange, "pixy", RFC 7636[^6]) binds the code to the app instance that started the flow:

1. The app generates a random **`code_verifier`** (43–128 characters) and keeps it in memory.
2. It sends only **`code_challenge = BASE64URL(SHA-256(code_verifier))`** in the authorization request.
3. At the token exchange it sends the original `code_verifier`; the server hashes and compares.

A malicious app that registered the same redirect scheme and intercepts the code does not have the verifier, so the code is useless.

``` mermaid-sim
sequenceDiagram
    autonumber
    actor Ana
    participant App as BoxOffice app
    participant Br as System browser
    participant AS as auth (Keycloak)
    participant GW as API gateway
    participant O as order
    Ana->>App: tap "Log in"
    App->>App: create state, nonce, code_verifier, code_challenge (S256)
    App->>Br: open /authorize?response_type=code&client_id=boxoffice-mobile&scope=openid orders:write&code_challenge&state&nonce
    Br->>AS: GET /authorize
    AS->>Ana: login page (password + MFA, or passkey)
    Ana->>AS: credentials
    AS-->>Br: 302 https://app.boxoffice.com/cb?code=XYZ&state
    Br-->>App: redirect delivered to the app (claimed HTTPS link)
    App->>App: check state
    App->>AS: POST /token {code, code_verifier, redirect_uri}
    AS->>AS: SHA-256(code_verifier) == code_challenge?
    AS-->>App: access_token (15 min) + refresh_token (rotating) + id_token
    App->>GW: POST /orders  Authorization: Bearer access_token
    GW->>GW: verify signature (cached JWKS), iss, aud, exp, scope
    GW->>O: POST /orders + X-Account-Id: acc-42
    O-->>App: 201 Created
```

The `state` parameter prevents an attacker from injecting *their* code into Ana's session (CSRF on the callback); the `nonce` is echoed inside the ID token and prevents replaying an old one.

??? example "Computing a PKCE pair by hand"

    ```bash
    # 64 random URL-safe characters
    verifier=$(openssl rand -base64 48 | tr -d '=+/\n' | cut -c1-64)
    # BASE64URL(SHA-256(verifier)), without '=' padding
    challenge=$(printf '%s' "$verifier" | openssl dgst -sha256 -binary \
                | openssl base64 | tr '+/' '-_' | tr -d '=')
    echo "verifier=$verifier"; echo "challenge=$challenge"
    ```

**Where the mobile app keeps tokens.** The access token lives in memory; the refresh token in the platform's secure storage (iOS Keychain, Android Keystore-backed storage). The authorization server **rotates** the refresh token on every use: if a stolen copy and the legitimate app both try to use the same one, the server detects the reuse and revokes the whole family.

---

## OpenID Connect: who is the user?

OAuth answers "may this client call this API?". It deliberately does not tell the *client* who the user is — the access token is addressed to the API. **OpenID Connect** (OIDC) adds an identity layer on top of OAuth[^7]:

- the **`openid` scope** in the authorization request;
- the **ID token** — a JWT addressed **to the client** (`aud` = its `client_id`) with `sub`, `iss`, `exp`, `nonce`, `auth_time` and, with the `profile`/`email` scopes, name and e-mail;
- the **UserInfo** endpoint for more profile claims;
- **discovery** at `/.well-known/openid-configuration`, which lists the endpoints and the `jwks_uri`, so clients and resource servers bootstrap from the issuer URL alone.

| Token | Audience | Purpose | Typical lifetime |
|---|---|---|---|
| **ID token** | the client | "the user who logged in is `acc-42`, at 14:02, with MFA" | minutes, used once at login |
| **Access token** | the API (resource server) | "this client may `orders:write` for `acc-42`" | 5–60 minutes |
| **Refresh token** | the authorization server only | obtain new access tokens without a new login | hours to weeks, rotated |

### Web checkout: OIDC through a Backend-for-Frontend

For the browser, the current recommendation is to keep **no tokens in JavaScript** at all. A **BFF** (Backend for Frontend) is a confidential client on the server: it runs the OIDC flow, keeps the tokens, and gives the browser only an `HttpOnly`, `Secure`, `SameSite` session cookie[^8].

``` mermaid-sim
sequenceDiagram
    autonumber
    actor Ana
    participant Br as Browser (checkout SPA)
    participant BFF as web BFF (confidential client)
    participant AS as auth (OIDC provider)
    participant GW as API gateway
    Ana->>Br: click "Log in"
    Br->>BFF: GET /login
    BFF-->>Br: 302 to AS /authorize (code + PKCE, scope openid, nonce)
    Br->>AS: login (passkey)
    AS-->>Br: 302 to BFF /callback?code&state
    Br->>BFF: GET /callback?code&state
    BFF->>AS: POST /token {code, code_verifier, client secret or private_key_jwt}
    AS-->>BFF: id_token + access_token + refresh_token
    BFF->>BFF: validate id_token (sig, iss, aud, exp, nonce), store tokens server-side
    BFF-->>Br: Set-Cookie: session=… HttpOnly Secure SameSite=Lax
    Br->>BFF: GET /api/orders (cookie)
    BFF->>GW: GET /orders  Bearer access_token
    GW-->>BFF: 200 orders
    BFF-->>Br: 200 orders
```

| Where the browser keeps credentials | Readable by JS? | Main risk |
|---|---|---|
| `localStorage` / `sessionStorage` | yes | any XSS (cross-site scripting) steals the token |
| `HttpOnly` cookie with the token | no | CSRF (cross-site request forgery); mitigated by `SameSite` + CSRF tokens |
| BFF session cookie, tokens on the server | no token in the browser | session theft; the BFF is a component to scale |

---

## Machines and delegation { #delegation }

### Client Credentials: the reconciliation job

When no user is involved, the client authenticates **as itself** and receives a token that represents the *service*. The `order` reconciliation job asks for exactly the scope it needs:

```bash
curl -s -X POST https://auth.boxoffice.com/realms/boxoffice/protocol/openid-connect/token \
  -d grant_type=client_credentials \
  -d client_id=order-reconciler \
  -d client_secret="$ORDER_RECONCILER_SECRET" \
  -d scope=inventory:read
```

Better than a client secret: authenticate the client with a **signed JWT** (`private_key_jwt`) or with its **workload identity** (mTLS certificate or the Kubernetes service-account token) — no shared secret to leak ([Zero Trust](../zero-trust/index.md)).

### Token Exchange: the assistant acting for the user

The AI `assistant` must call `order` *on behalf of Ana*, with less power than Ana's own token. **Token Exchange** (RFC 8693) lets a service trade the token it received for a new one with a different audience and narrower scope (`aud=order`, `scope=orders:read`), keeping `sub=acc-42` and recording the actor (`act: assistant`). The audit log then shows "assistant, acting for acc-42, read order 1042".

### Sender-constrained tokens

A bearer token works for anyone who steals it. **Sender-constrained** tokens are bound to a key the legitimate client holds: with **DPoP** (RFC 9449) the client signs a small proof for every request with a private key on the device; with **mTLS-bound tokens** (RFC 8705) the token is tied to the client certificate. A stolen token alone is then useless. Financial-grade APIs require them; for BoxOffice they are worth it on payment endpoints.

### Passkeys

**Passkeys** (WebAuthn/FIDO2) replace passwords with a key pair per site, kept on the device and unlocked with biometrics. The private key never leaves the device and the signature is bound to the site's origin, so they resist phishing. They change *how the user authenticates at the authorization server*; the OAuth/OIDC flows after it stay the same.

---

## Validating tokens at the gateway { #gateway-validation }

The gateway is the first **enforcement point**: it rejects requests without a valid token and forwards a trusted identity downstream (see [Edge — API gateway](../../edge/api-gateway/index.md)).

| | **Local validation (JWKS)** | **Remote validation (introspection, RFC 7662)** |
|---|---|---|
| Extra hop | none — signature checked with a cached public key | one call to the AS per request (cacheable for seconds) |
| AS outage | requests keep working | every request fails (or uses the cache) |
| Revocation | effective only at `exp` | immediate |
| Token type | JWT | JWT or opaque |
| Typical use | most API traffic | sensitive operations, opaque tokens |

With Spring Security (also in Spring Cloud Gateway), local validation is configuration:

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: https://auth.boxoffice.com/realms/boxoffice  # discovers jwks_uri, checks iss
          audiences: boxoffice-api                                 # rejects tokens for other APIs
```

!!! warning "Strip identity headers at the edge"
    If the gateway forwards `X-Account-Id: acc-42` to services, it must **remove** any `X-Account-Id` sent by the client, and services must be unreachable except through the gateway (or must verify the token themselves). Otherwise anyone who reaches a service directly can become any user.

---

## Authorization models { #authorization-models }

Authentication produced an identity. Now: may *this* identity do *this* action on *this* object?

| Model | Decides by | BoxOffice example | Good for | Weak at |
|---|---|---|---|---|
| **RBAC** (role-based) | the user's roles | `organizer` may create events; `support` may read any order | coarse, stable permissions | per-object rules ("only *their* events") |
| **ABAC** (attribute-based) | attributes of user, resource, context | refunds allowed if `order.eventDate > now + 48h` and `user.country == order.country` | rich, contextual rules | harder to audit "who can access X?" |
| **ReBAC** (relationship-based) | a graph of relationships | Ana may view order 1042 because she *owns* it; Bruno because Ana *shared* the ticket with him | sharing, organizations, hierarchies | needs a relationship store (Google Zanzibar, OpenFGA, SpiceDB) |

**OAuth scopes** are not a replacement: a scope limits what the *client* may do (`orders:read`), not which *objects* the user may touch. The ownership check — the fix for OWASP **API1: BOLA** — always runs in the service that owns the data[^9]:

=== "In code (order service)"

    ```java
    @GetMapping("/orders/{id}")
    @PreAuthorize("hasAuthority('SCOPE_orders:read')")
    public OrderOut get(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        Order order = repository.findById(id)
            .filter(o -> o.getAccountId().equals(jwt.getSubject()))  // ownership (BOLA)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        return OrderOut.from(order);                                 // explicit DTO (BOPLA)
    }
    ```

=== "Policy as code (OPA / Rego)"

    ```rego
    package boxoffice.orders

    import rego.v1

    default allow := false

    # owners can read their own orders
    allow if {
        input.action == "read"
        input.resource.owner_id == input.user.sub
    }

    # support staff can read any order, never modify it
    allow if {
        input.action == "read"
        "support" in input.user.roles
    }
    ```

=== "Policy as code (Cedar)"

    ```cedar
    permit (
      principal,
      action == Action::"ReadOrder",
      resource
    )
    when { resource.owner == principal };

    permit (
      principal in Role::"support",
      action == Action::"ReadOrder",
      resource
    );
    ```

Policy engines (OPA, Cedar, OpenFGA) move the rules out of the code into a reviewable, testable artifact that several services share. The service still asks the question for every object.

!!! tip "In the interview"
    Whenever the design has users, say in one breath: "users log in through an **OIDC provider**; the mobile app uses **Authorization Code with PKCE**; the gateway validates **short-lived JWT access tokens** locally against the provider's JWKS; refresh tokens rotate; service-to-service calls use **client credentials** or the mesh identity; and every service checks **object ownership**." If they ask about logout or revocation, explain the trade-off between local validation and introspection — and the exposure window equal to the token lifetime.

!!! warning "Common pitfalls"
    - **Implicit or password (ROPC) grants** in new code — removed in OAuth 2.1; use Authorization Code + PKCE.
    - **Skipping `aud`** — a token issued for another API is accepted by yours.
    - **Long-lived access tokens** (24 h) — a stolen bearer token is a 24-hour master key.
    - **Tokens in `localStorage`** or in URLs and logs — XSS and log leaks.
    - **Calling APIs with the ID token** — it is for the client; APIs accept access tokens only.
    - **Authorization only at the gateway** — BOLA: `GET /orders/{id}` returns any order to any logged-in user.
    - **Sharing an HMAC secret across services** — every verifier can forge tokens.

---

## How it connects { #how-it-connects }

``` mermaid
flowchart LR
    AS["auth: OIDC provider<br/>(authorization server)"] --> PKCE["Authorization Code + PKCE<br/>mobile app, web BFF"]
    AS --> CC["Client Credentials<br/>reconciliation job"]
    AS --> TX["Token Exchange<br/>assistant → order"]
    PKCE --> JWT["short-lived JWT access token<br/>+ rotating refresh token"]
    PKCE --> SESS["BFF session cookie<br/>shared store → Caching"]
    JWT --> GW["gateway validates via JWKS<br/>iss, aud, exp → Edge"]
    GW --> SVC["each service checks ownership<br/>RBAC / ABAC / ReBAC"]
    SVC --> BOLA["fixes OWASP API1 (BOLA)"]
    CC --> WI["workload identity<br/>→ Zero Trust"]
    TX --> AI["agents acting for users<br/>→ AI systems"]
```

**Palette components:** [`auth`](../../../reference/components/compute/index.md#auth) · [`apigw`](../../../reference/components/edge/index.md#apigw) (the first enforcement point) · [`client`](../../../reference/components/client/index.md#client) · [`mobile`](../../../reference/components/client/index.md#mobile) · [`cache`](../../../reference/components/storage/index.md#cache) (server-side sessions) · [`orchestrator`](../../../reference/components/ai/index.md#orchestrator) (the assistant acting on the user's behalf). **Scenarios:** `rate-limiter`, `flash-sale`, `ai-assistant`. **Continues in:** [Edge — API gateway](../../edge/api-gateway/index.md), [Zero Trust](../zero-trust/index.md#workload-identity), [Caching — Redis](../../caching/redis/index.md), [AI systems — agents](../../ai-systems/agents/index.md), [Hands-on 4 — Gateway & identity](../../../hands-on/4/index.md).

## Key takeaways

- **AuthN** (who) ≠ **authZ** (what). The gateway authenticates; each service still authorizes access to its own objects.
- **Sessions** revoke instantly but need a shared store; **JWTs** scale statelessly but stay valid until `exp`. Combine short access tokens with revocable refresh tokens.
- Validate JWTs properly: allow-listed algorithm, `kid` from your JWKS, `iss`, `aud`, `exp`, `typ`, scopes.
- **OAuth 2.1**: Authorization Code + **PKCE** for every user-facing client (system browser for mobile, BFF for web), **Client Credentials** for jobs, **Token Exchange** for delegation; no Implicit, no ROPC.
- **OIDC** adds the ID token, UserInfo and discovery. Choose RBAC, ABAC or ReBAC for authorization, and always check ownership (BOLA).

---

[^1]: SHEFFER, Y.; HARDT, D.; JONES, M. [RFC 8725 — JSON Web Token Best Current Practices](https://datatracker.ietf.org/doc/html/rfc8725){target="_blank"}. IETF, 2020. See also [RFC 9068 — JWT Profile for OAuth 2.0 Access Tokens](https://datatracker.ietf.org/doc/html/rfc9068){target="_blank"}.
[^2]: HARDT, D. (ed.). [RFC 6749 — The OAuth 2.0 Authorization Framework](https://datatracker.ietf.org/doc/html/rfc6749){target="_blank"}. IETF, 2012.
[^3]: HARDT, D.; PARECKI, A.; LODDERSTEDT, T. [The OAuth 2.1 Authorization Framework](https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/){target="_blank"}. IETF Internet-Draft.
[^4]: LODDERSTEDT, T. et al. [RFC 9700 — Best Current Practice for OAuth 2.0 Security](https://datatracker.ietf.org/doc/html/rfc9700){target="_blank"}. IETF, 2025.
[^5]: DENNISS, W.; BRADLEY, J. [RFC 8252 — OAuth 2.0 for Native Apps](https://datatracker.ietf.org/doc/html/rfc8252){target="_blank"}. IETF, 2017.
[^6]: SAKIMURA, N.; BRADLEY, J.; AGARWAL, N. [RFC 7636 — Proof Key for Code Exchange by OAuth Public Clients](https://datatracker.ietf.org/doc/html/rfc7636){target="_blank"}. IETF, 2015.
[^7]: SAKIMURA, N. et al. [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html){target="_blank"}. OpenID Foundation.
[^8]: PARECKI, A.; DE RYCK, P. [OAuth 2.0 for Browser-Based Applications](https://datatracker.ietf.org/doc/draft-ietf-oauth-browser-based-apps/){target="_blank"}. IETF Internet-Draft.
[^9]: OWASP. [API1:2023 — Broken Object Level Authorization](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/){target="_blank"}.
