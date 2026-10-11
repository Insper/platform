
The store launches a mobile app and wants a **"Sign in with Google"** button. The app must never see the user's Google password, Google must know which app is asking, and the user must be able to say "this app may read my email address, nothing else". At the same time, a nightly job in `order-service` needs to call `product-service` to reconcile stock — and there is no user at all. A homemade login endpoint cannot express any of this. **OAuth 2.0**[^1] is the standard framework for *delegated authorization*, and **OpenID Connect**[^5] is the identity layer built on top of it.

---

## OAuth 2.0 in one sentence

OAuth 2.0 lets a **client** application obtain a **limited, revocable access token** to call an API on behalf of a user — or on its own behalf — **without ever handling the user's password**. The user authenticates only at the **Authorization Server**, and *consents* to the access requested.

### Roles

| Role | Description | In the store |
|---|---|---|
| **Resource Owner** | The user who owns the data | Ada, a customer |
| **Client** | The application requesting access | the store's web frontend, the mobile app, a nightly job |
| **Authorization Server** | Authenticates the user and issues tokens | Keycloak, Auth0, AWS Cognito — or our `auth-service` |
| **Resource Server** | API that holds the protected resource and validates tokens | `order-service`, `account-service` (behind the gateway) |

Clients come in two kinds, and the difference drives the choice of flow:

- **Confidential client** — runs on a server and can keep a secret (`client_secret`) safe: a backend, a batch job.
- **Public client** — runs on the user's device and cannot keep a secret: a single-page app (anyone can read its JavaScript), a mobile app (anyone can decompile it).

### Tokens

| Token | Purpose | Audience | Typical lifetime |
|---|---|---|---|
| **Access token** | authorizes API calls; sent as `Authorization: Bearer <token>`[^3] | the Resource Server | 5–60 minutes |
| **Refresh token** | obtains a new access token without a new login | the Authorization Server only | hours to weeks |
| **ID token** (OIDC) | tells the *client* who the user is | the Client only | minutes |

An access token can be **self-contained** (a JWT the resource server verifies by itself) or **opaque** (a random reference string the resource server must look up at the Authorization Server). The Hands-on 3 token is a JWT, but the gateway treats it as opaque: it asks `auth-service` to resolve it.

### Scopes and claims

A **scope** is a named permission the client asks for and the user consents to, such as `openid`, `email` or `orders:read`. The granted scopes travel in the access token's `scope` claim. The Resource Server then combines **what the client may do** (scopes) with **who the user is and what they may do** (`sub`, roles) and **which object is being accessed** (ownership).

!!! example "Checking a scope in Spring Security"
    Spring Security turns each scope in a JWT into an authority prefixed with `SCOPE_`, so an endpoint can require it declaratively:

    ```java
    @GetMapping("/orders")
    @PreAuthorize("hasAuthority('SCOPE_orders:read')")
    public List<OrderOut> findMine(@AuthenticationPrincipal Jwt jwt) {
        return orderService.findByAccount(jwt.getSubject()); // ownership: only this user's orders
    }
    ```

---

## Grant types

A **grant** (or *flow*) is the procedure a client follows to obtain a token. Choosing the grant is the first design decision.

| Grant | Use case | Status |
|---|---|---|
| **Authorization Code + PKCE** | web, SPA and mobile apps where a user logs in | recommended default for every user-facing client |
| **Client Credentials** | service-to-service, no user involved | recommended for machine-to-machine |
| **Device Authorization**[^4] | devices without a browser or keyboard (smart TV, CLI) | recommended for that niche |
| **Refresh Token** | exchange a refresh token for a new access token | used together with the flows above |
| **Implicit** | old SPAs: token returned directly in the URL | **deprecated** — tokens leak via URL and history |
| **Resource Owner Password (ROPC)** | legacy: the client collects the password | **must not be used**[^2] |

``` mermaid-sim
flowchart TD
    q1{"Is a user<br>involved?"} -->|no| cc["Client Credentials"]
    q1 -->|yes| q2{"Does the device<br>have a browser?"}
    q2 -->|yes| pkce["Authorization Code + PKCE"]
    q2 -->|no| dev["Device Authorization"]
```

!!! danger "Never use ROPC"
    Resource Owner Password Credentials requires the client to collect the user's username and password directly. This defeats the purpose of OAuth 2.0 (delegated authorization without sharing credentials), cannot support multi-factor login, and teaches users to type passwords into any app. The OAuth 2.0 Security Best Current Practice (RFC 9700) says it **must not** be used, and the OAuth 2.1 draft removes it together with the Implicit grant[^2].

### Authorization Code + PKCE

The user logs in at the Authorization Server, never in the app. The app receives a short-lived, single-use **authorization code** through a browser redirect and exchanges it for tokens in a direct back-channel call. **PKCE** (Proof Key for Code Exchange, pronounced "pixy")[^6] binds the code to the app that started the flow:

1. The app creates a random **`code_verifier`** (43–128 characters) and keeps it in memory.
2. It sends only its hash, **`code_challenge = BASE64URL(SHA-256(code_verifier))`**, in the authorization request.
3. When exchanging the code, it sends the original `code_verifier`; the server hashes it and compares.

An attacker who intercepts the redirect (a malicious app registered for the same URL scheme, a leaked log) gets the code but not the verifier, so the code is useless.

``` mermaid-sim
sequenceDiagram
    autonumber
    actor User
    participant App as Client App
    participant Auth as Authorization Server (Keycloak)
    participant API as Resource Server (order-service)

    User->>App: click "Login"
    App->>App: generate state, code_verifier, code_challenge (S256)
    App->>Auth: redirect to /authorize?response_type=code&client_id&code_challenge&state
    Auth->>User: login form (and consent)
    User->>Auth: credentials (+ MFA)
    Auth->>App: redirect to callback ?code=AUTH_CODE&state
    App->>App: check state matches
    App->>Auth: POST /token {code, code_verifier}
    Auth->>App: {access_token, refresh_token, id_token}
    App->>API: GET /orders  Authorization: Bearer access_token
    API->>API: verify signature with cached JWKS, check exp, iss, aud, scope
    API->>App: 200 OK order data
```

The `state` parameter is a random value the app checks on the way back; it prevents an attacker from injecting *their own* code into the victim's session (a CSRF attack on the callback).

??? example "Computing a PKCE pair by hand"
    ```bash
    # 64 random URL-safe characters
    verifier=$(openssl rand -base64 48 | tr -d '=+/\n' | cut -c1-64)
    # BASE64URL(SHA-256(verifier)), without '=' padding
    challenge=$(printf '%s' "$verifier" | openssl dgst -sha256 -binary \
                | openssl base64 | tr '+/' '-_' | tr -d '=')
    echo "verifier=$verifier"; echo "challenge=$challenge"
    ```

### Client Credentials

When no user is involved, the client authenticates **as itself** with its own credentials and receives a token that represents the *service*, not a person.

``` mermaid-sim
sequenceDiagram
    autonumber
    participant Job as order-service (nightly job)
    participant Auth as Authorization Server (Keycloak)
    participant P as product-service
    Job->>Auth: POST /token grant_type=client_credentials, client_id, client_secret
    Auth-->>Job: access_token (sub=order-service, scope=stock:read)
    Job->>P: GET /products/stock  Bearer access_token
    P->>P: verify token, check scope stock:read
    P-->>Job: 200 OK
```

```bash
curl -s -X POST http://keycloak:8080/realms/store/protocol/openid-connect/token \
  -d grant_type=client_credentials \
  -d client_id=order-service \
  -d client_secret="$ORDER_SERVICE_SECRET" \
  -d scope=stock:read
```

!!! tip "Do not reuse a user's token for background work"
    A job that borrows "some user's" token breaks the audit trail (who did this?), stops working when that token expires, and usually has far more permissions than it needs. Give each service its own client and only the scopes it needs.

### Token lifecycle

``` mermaid-sim
stateDiagram-v2
    [*] --> Active : issued by POST /token
    Active --> Expired : exp reached
    Active --> Revoked : logout / admin action
    Expired --> Active : client presents refresh_token, gets a new access token
    Expired --> [*] : refresh token also expired, user logs in again
    Revoked --> [*]
```

The **access token** is short-lived (typically 5–60 minutes) and sent with every API request. The **refresh token** is long-lived (hours to weeks), stored securely by the client, and sent **only** to the Authorization Server to obtain new access tokens without prompting the user again. For public clients, the server should use **refresh token rotation**: each use returns a new refresh token and invalidates the old one, so a stolen refresh token is detected the moment both the thief and the legitimate app try to use it[^2].

Why short access tokens? A self-contained JWT cannot be "un-issued": a resource server that validates it locally will accept it until `exp`. Keeping `exp` short bounds the damage of a stolen token, while revocation is enforced where the refresh token is exchanged.

---

## OpenID Connect (OIDC)

OAuth 2.0 handles authorization ("can this client access this resource?"). It deliberately does not say *who the user is* — an access token is meant for the API, not for the client to read. OpenID Connect adds authentication ("who is this user?") by defining an **ID Token** — a JWT with standardised user claims, addressed to the client[^5].

OIDC extends OAuth 2.0 with three additions:

- The `openid` scope in the authorization request
- **ID Token** — a JWT containing user identity claims (`sub`, `name`, `email`, `iss`, `aud`)
- **UserInfo endpoint** — `GET /userinfo` returns additional profile claims on demand

### ID Token claims

| Claim | Meaning |
|---|---|
| `sub` | Subject — unique, stable user identifier at this provider |
| `iss` | Issuer — URL of the authorization server |
| `aud` | Audience — must contain the client's `client_id` |
| `exp` / `iat` | Expiry / issued-at timestamps |
| `name`, `email` | Standard user profile claims (requested with the `profile` and `email` scopes) |
| `nonce` | Value sent by the client in the request and echoed back — prevents replaying an old ID token |

The client **must validate** the ID token before trusting it: signature, `iss`, `aud` equal to its own `client_id`, `exp`, and `nonce`.

### OAuth 2.0 and OIDC layers

``` mermaid-sim
flowchart TB
    subgraph oidc ["OIDC layer (identity)"]
        id["ID Token<br>(who is the user?)"]
        ui["UserInfo endpoint"]
    end
    subgraph oauth ["OAuth 2.0 layer (authorization)"]
        at["Access Token<br>(what can the client do?)"]
        rt["Refresh Token"]
    end
    app["Client App"] --> id
    app --> at
    at -->|"sent to"| api["Resource Server"]
```

The Authorization Server exposes a **discovery document** at `GET /.well-known/openid-configuration` which returns all endpoint URLs (`authorization_endpoint`, `token_endpoint`, `userinfo_endpoint`), supported scopes, and the `jwks_uri`. Clients and resource servers can bootstrap from the issuer URL alone, without hardcoded configuration.

### Common OIDC providers

| Provider | Use case |
|---|---|
| **Keycloak** | Self-hosted, open source, full-featured — ideal for internal services and for the course |
| **Auth0** | Managed cloud, fast integration |
| **AWS Cognito** | Native AWS integration |
| **Google / GitHub** | Social login for public-facing apps |

!!! warning "Do not call APIs with the ID token"
    The ID token's audience is the *client*, not your API. Resource servers must accept **access tokens** only, and must reject tokens whose `aud` is not their own — otherwise a token issued for another app can be replayed against yours.

---

## Validating tokens at the gateway

Rather than every microservice implementing validation, the gateway is the first **enforcement point**: it rejects requests without a valid token and forwards a trusted identity downstream. There are two ways to validate.

### Local validation with JWKS

With **asymmetric** signatures (RS256, ES256) the Authorization Server signs with a **private key** that never leaves it, and anyone can verify with the matching **public key**. The public keys are published as a **JSON Web Key Set (JWKS)**[^7] — a JSON document where each key has a `kid` (key id); every JWT header names the `kid` that signed it.

1. The Authorization Server publishes its public keys at its `jwks_uri` (Keycloak: `/realms/<realm>/protocol/openid-connect/certs`).
2. The gateway fetches and **caches** the JWKS.
3. Each incoming request carries `Authorization: Bearer <token>`.
4. The gateway picks the key by `kid` and verifies the signature **locally** — no call to the Authorization Server.
5. On an unknown `kid` (the server rotated its keys): re-fetch the JWKS once, then retry.

``` mermaid-sim
sequenceDiagram
    participant C as Client
    participant GW as API Gateway
    participant Auth as Auth Server
    participant SVC as order-service

    GW->>Auth: GET jwks_uri (at startup, then cached)
    Auth-->>GW: {keys: [{kid, kty, n, e}]}
    C->>GW: GET /orders  Bearer token
    GW->>GW: verify signature with cached key, check exp, iss, aud
    alt token invalid
        GW-->>C: 401 Unauthorized
    else token valid
        GW->>SVC: GET /orders + id-account header
        SVC-->>GW: 200 OK
        GW-->>C: 200 OK
    end
```

With Spring Security (also in the reactive Spring Cloud Gateway), local validation is configuration only:

=== "application.yml (issuer)"
    ```yaml
    spring:
      security:
        oauth2:
          resourceserver:
            jwt:
              # discovers jwks_uri and also validates the iss claim
              issuer-uri: http://keycloak:8080/realms/store
              # Spring Boot 3.1+: also reject tokens whose aud is not this API
              audiences: store-api
    ```

=== "application.yml (JWKS only)"
    ```yaml
    spring:
      security:
        oauth2:
          resourceserver:
            jwt:
              jwk-set-uri: http://keycloak:8080/realms/store/protocol/openid-connect/certs
    ```

Whatever the library, a correct validation checks[^8]:

- the **signature**, with an algorithm from an explicit allow-list — never `alg: none`, and never let the token header choose the algorithm;
- **`exp`** and **`nbf`** (with a small clock skew);
- **`iss`** — the token comes from *your* Authorization Server;
- **`aud`** — the token was issued *for this API*;
- the **scopes / roles** required by the endpoint.

### Remote validation (introspection)

The alternative is to ask the Authorization Server on every request: "is this token valid, and whose is it?". OAuth standardises this as **token introspection** (RFC 7662)[^9]. The `POST /auth/solve` call in [Hands-on 3 — Authorization](../../../hands-on/3/authorization/index.md) is exactly this pattern, with a custom endpoint.

| | Local (JWKS) | Remote (introspection, `/auth/solve`) |
|---|---|---|
| Latency | no extra hop | one network call per request (cacheable) |
| Availability | works while the Auth Server is down | Auth Server outage = every request fails |
| Revocation | effective only at `exp` | immediate |
| Key handling | public keys only; private key stays in one place | any key type; the secret stays in the Auth Server |
| Token type | JWT | JWT or opaque |

Large systems often combine both: short-lived JWTs validated locally for most calls, introspection for sensitive operations.

!!! tip "Forward user context downstream"
    After validation, the gateway forwards the identity as a header — `id-account: <sub>` in Hands-on 3 — so downstream services do not need to parse tokens. Downstream services must only accept this header **from the gateway**: strip it from incoming external requests, and make sure services are not reachable from outside (see [Zero Trust](../zero-trust/index.md)). Some teams forward the original token instead (*token relay*), so each service can verify it again.

---

## Where the browser keeps the token

| Storage | Readable by JavaScript? | Main risk | Mitigation |
|---|---|---|---|
| `localStorage` / `sessionStorage` | yes | any XSS script steals the token | avoid for tokens |
| `HttpOnly` cookie (Hands-on 3) | no | CSRF — the browser sends the cookie automatically | `SameSite`, `Secure`, CSRF tokens |
| Server-side session (*Backend for Frontend*) | no token in the browser at all | session theft | the BFF holds tokens; the browser holds only a session cookie |

Hands-on 3 chose the `HttpOnly` cookie: see the cookie flags in [Hands-on 3 — Open Routes](../../../hands-on/3/open-routes/index.md).

---

## Pitfalls

!!! warning "Common mistakes with OAuth 2.0 and JWT"
    - **Using ROPC or Implicit** in new code — use Authorization Code + PKCE.
    - **Skipping the `aud` check** — a valid token for another API is accepted by yours.
    - **Long-lived access tokens** — a stolen bearer token is valid until `exp`; keep them short and use refresh tokens.
    - **Sharing an HMAC secret among many services** — every service that can verify can also *forge* tokens; use asymmetric keys and a JWKS.
    - **Tokens in URLs or logs** — query strings end up in proxy logs and browser history; send tokens in headers or cookies, and mask them in logs.
    - **Calling the API with the ID token** — ID tokens are for the client; APIs accept access tokens.

---

## Key takeaways

- OAuth 2.0 is **delegated authorization**: the client gets a limited, short-lived token and never sees the user's password.
- Choose the grant by the client: **Authorization Code + PKCE** for anything with a user, **Client Credentials** for services, **never ROPC or Implicit**.
- **Access tokens** go to APIs and live minutes; **refresh tokens** go only to the Authorization Server; the **ID token** (OIDC) tells the client who the user is.
- With asymmetric keys and a **JWKS**, the gateway validates tokens **locally**; introspection (like `/auth/solve`) trades a network hop for immediate revocation.
- Validation is more than the signature: check `exp`, `iss`, `aud` and scopes — then each service still checks **ownership** of the data.

[^1]: HARDT, D. (ed.). [RFC 6749 — The OAuth 2.0 Authorization Framework](https://datatracker.ietf.org/doc/html/rfc6749){target="_blank"}. IETF, 2012.
[^2]: LODDERSTEDT, T. et al. [RFC 9700 — Best Current Practice for OAuth 2.0 Security](https://datatracker.ietf.org/doc/html/rfc9700){target="_blank"}. IETF, 2025. See also the [OAuth 2.1 draft](https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/){target="_blank"}.
[^3]: JONES, M.; HARDT, D. [RFC 6750 — The OAuth 2.0 Authorization Framework: Bearer Token Usage](https://datatracker.ietf.org/doc/html/rfc6750){target="_blank"}. IETF, 2012.
[^4]: DENNISS, W. et al. [RFC 8628 — OAuth 2.0 Device Authorization Grant](https://datatracker.ietf.org/doc/html/rfc8628){target="_blank"}. IETF, 2019.
[^5]: SAKIMURA, N. et al. [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html){target="_blank"}. OpenID Foundation.
[^6]: SAKIMURA, N.; BRADLEY, J.; AGARWAL, N. [RFC 7636 — Proof Key for Code Exchange by OAuth Public Clients](https://datatracker.ietf.org/doc/html/rfc7636){target="_blank"}. IETF, 2015.
[^7]: JONES, M. [RFC 7517 — JSON Web Key (JWK)](https://datatracker.ietf.org/doc/html/rfc7517){target="_blank"}. IETF, 2015.
[^8]: SHEFFER, Y.; HARDT, D.; JONES, M. [RFC 8725 — JSON Web Token Best Current Practices](https://datatracker.ietf.org/doc/html/rfc8725){target="_blank"}. IETF, 2020.
[^9]: RICHER, J. (ed.). [RFC 7662 — OAuth 2.0 Token Introspection](https://datatracker.ietf.org/doc/html/rfc7662){target="_blank"}. IETF, 2015.
