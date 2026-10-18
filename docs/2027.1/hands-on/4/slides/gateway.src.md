---
marp: true
lang: en
title: Lab 4 — Gateway & identity
description: System Architecture · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">System Architecture · Insper · Lab 4</div>

# Lab 4 — Gateway & identity

**An `auth` service that issues RS256 JWTs, and a Spring Cloud Gateway that validates them once**

<!--
Outline: (1) authn vs authz; (2) sessions vs JWT; (3) RS256 and JWKS; (4) auth service; (5) gateway
routes and LB; (6) security rules; (7) identity headers; (8) measurements: hop, JWT, login.
-->

---

## Who are you, and what may you do?

<div class="q">

Anyone can delete events in the catalog today. Should every service learn to check passwords?

</div>

- **Authentication** — who is calling.
- **Authorization** — what they may do.
- Solve it **once**, at the front door: the API gateway.

---

## Sessions vs tokens

| | Session id | JWT |
|---|---|---|
| Client holds | random id | signed claims |
| Check | lookup in a store | verify signature locally |
| Revocation | immediate | wait for `exp` |
| Scales with | the session store | CPU only |

---

## RS256 and the JWKS

- `auth` signs with a **private** key; nobody else can mint tokens.
- The gateway verifies with the **public** key from `/auth/.well-known/jwks.json`.
- Fetched once, cached; refetched only for an unknown `kid`.

<div class="warn">

Signed ≠ encrypted: anyone can read the payload.

</div>

---

## The token

```json
{ "iss": "boxoffice-auth", "aud": "boxoffice",
  "sub": "0b9d8a6e-…", "email": "ana@example.com",
  "scope": "user", "iat": 1795000000, "exp": 1795003600 }
```

- Gateway checks signature, `exp`, `iss`, `aud`.
- `scope` → authorities `SCOPE_user`, `SCOPE_admin`.

---

## The `auth` service

- `POST /auth/register` — BCrypt (cost 10), never the password.
- `POST /auth/login` — same `401` for unknown user and wrong password.
- `GET /auth/me` — trusts `X-User-Id` from the gateway.
- Admin created at startup from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

---

## Gateway routes

```yaml
routes:
  - id: auth
    uri: http://auth:8081
    predicates: [ Path=/auth/** ]
  - id: catalog
    uri: lb://catalog          # catalog-1..3, health-checked
    predicates: [ Path=/catalog/** ]
```

- Timeouts: connect 1 s, response 5 s. Retry GET once.

---

## Who may call what

```java
.pathMatchers("/auth/register", "/auth/login", "/auth/.well-known/**").permitAll()
.pathMatchers(HttpMethod.GET, "/catalog/**").permitAll()
.pathMatchers("/catalog/**").hasAuthority("SCOPE_admin")
.anyExchange().authenticated()
```

- **Deny by default**: new routes are protected automatically.
- No token → `401`; wrong scope → `403`.

---

## Identity headers

- Strip `X-User-*` from the client — **always**.
- Set `X-User-Id`, `X-User-Email`, `X-User-Scope` from the validated JWT.
- Services trust them **because** they are reachable only through the gateway.

<div class="q">

What changes in a zero-trust network?

</div>

---

## Two load balancers, two tiers

```text
fans ─► edge (Nginx) ─► gateway (×N) ─► lb://catalog ─► catalog-1..3
         balances gateways        balances service instances
```

- Like a cloud L7 load balancer → gateway fleet → internal service LB.

---

## Measure it

| Path | What it adds |
|---|---|
| edge → catalog (lab 3) | baseline |
| gateway → catalog | the gateway hop |
| edge → gateway → catalog | full open path |
| edge → gateway → auth (JWT) | token validation |

```bash
k6 run -e RATE=50 load/gateway.js
```

---

## Login is slow on purpose

- BCrypt cost 10 → tens of ms of CPU per check.
- `auth` on 1 CPU: roughly 10–20 logins/s.
- Consequences: **reuse tokens**, rate-limit `/auth/login`, log in **before** 10:00.

```bash
for r in 5 10 20 40; do k6 run -q -e RATE=$r --summary-export results/lab4/login-$r.json load/login.js; done
```

---

## Takeaways

1. Authenticate once at the **gateway**; authorize fine-grained where the data lives.
2. **RS256 + JWKS**: only `auth` signs, everyone verifies locally.
3. Validate `exp`, `iss`, `aud` — not only the signature.
4. **Deny by default**; strip identity headers from clients.
5. The gateway hop and JWT checks are cheap; **password hashing is not**.
