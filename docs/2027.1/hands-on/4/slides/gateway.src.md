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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">System Architecture · Insper · Lab 4</div>

# Lab 4 — Gateway & identity

**An `auth` service that signs JSON Web Tokens (JWTs), and a Spring Cloud Gateway that validates them once**

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
- Solve it **once**, at the front door: the application programming interface (API) gateway.

---

## What you will build

<div class="flow">
<div class="box muted" style="flex: .6">fans · k6</div><div class="arrow">:80 →</div>
<div class="box">edge<small>Nginx · rate limit · /actuator → 404</small></div><div class="arrow">→</div>
<div class="box accent">gateway :8080<small>JWT, rules, routes, lb://catalog</small></div><div class="arrow">→</div>
<div class="group">
<div class="caption">services</div>
<div class="box orange">auth :8081<small>users, BCrypt, signs tokens</small></div>
<div class="box green">catalog-1..3 :8082<small>trust X-User-* from the gateway</small></div>
</div>
</div>

- Two load balancers: the **edge** spreads over gateways, the **gateway** over service instances.
- Only the edge is public; port 8080 is published only for the measurements.

<!--
Like the cloud: a public layer-7 load balancer → a fleet of API gateways → internal service load balancing.
The page draws the same topology under "What you will build".
-->

---

## Sessions vs tokens

| | Session id | JWT |
|---|---|---|
| Client holds | random id | signed claims |
| Check | lookup in a store | verify signature locally |
| Revocation | immediate | wait for `exp` |
| Scales with | the session store | central processing unit (CPU) only |

---

## RS256 and the JSON Web Key Set (JWKS)

<div class="flow">
<div class="box orange">auth<small>private key · signs</small></div><div class="arrow">token →</div>
<div class="box">client<small>sends Bearer on every request</small></div><div class="arrow">→</div>
<div class="box accent">gateway<small>public key · verifies locally</small></div>
<div class="arrow">← once</div>
<div class="box muted">/auth/.well-known/jwks.json<small>downloaded again only for an unknown kid</small></div>
</div>

- RS256 = a Rivest–Shamir–Adleman (RSA) signature over SHA-256: only `auth` can **mint**; anyone can **verify**.
- With HS256, a hash-based message authentication code (HMAC), one secret signs and verifies: every holder could forge tokens.

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
- New RSA key pair at every start: old tokens die (see *A new key*, below).

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

- Timeouts: connect 1 s, response 5 s. Retry a failed GET once, on another instance.
- Health check: probe each `/actuator/health/readiness` every 5 s, skip the ones not `UP`.

---

## Who may call what

```java
.pathMatchers("/auth/register", "/auth/login", "/auth/.well-known/**").permitAll()
.pathMatchers(HttpMethod.GET, "/catalog/**").permitAll()
.pathMatchers("/catalog/**").hasAuthority("SCOPE_admin")
.anyExchange().authenticated()
```

<div class="flow">
<div class="box">token sent?<small>validated first, even on an open route</small></div><div class="arrow">→</div>
<div class="box accent">first rule that matches<small>in order</small></div><div class="arrow">→</div>
<div class="box green">permitted → route</div>
<div class="box red">no / bad token<small>401</small></div>
<div class="box orange">valid, wrong scope<small>403</small></div>
</div>

- **Deny by default**: new routes are protected automatically.

---

## Identity headers

<div class="flow">
<div class="box red">client<small>Bearer (Ana) + X-User-Id: admin</small></div><div class="arrow">→</div>
<div class="box accent">gateway<small>strip X-User-* · validate · sub = Ana</small></div><div class="arrow">→</div>
<div class="box green">auth<small>X-User-Id: Ana</small></div>
</div>

- Strip `X-User-*` from the client — **always**; then set them from the validated JWT.
- Services trust them **because** they are reachable only through the gateway.

<div class="q">

What changes in a zero-trust network?

</div>

---

## Try it end to end

| Request | Answer | Who answered |
|---|---|---|
| `POST /auth/register` | `201` | auth |
| `POST /auth/login` | `200` + token | auth |
| `GET /auth/me` with the token | `200` Ana | auth (via the gateway) |
| `GET /auth/me` without a token | `401` | **gateway** |
| `DELETE /catalog/events/2` as Ana | `403` | **gateway** |
| `PUT /catalog/events/2` as admin | `200` | a catalog replica |

- The rejections never reach a service: they cost the gateway microseconds.

---

## A new key at every restart

<div class="flow">
<div class="box">restart auth<small>new key pair, kid B</small></div><div class="arrow">→</div>
<div class="box orange">old token (kid A)<small>200: the gateway still has kid A cached</small></div><div class="arrow">→</div>
<div class="box accent">first token with kid B<small>unknown kid → download the JWKS</small></div><div class="arrow">→</div>
<div class="box red">old token (kid A)<small>401: not in the JWKS any more</small></div>
</div>

- The gateway caches the JWKS and downloads it again only for an **unknown kid**.
- Production: the key lives in a key management service (KMS); the JWKS lists current **and** previous keys.
- Expired tokens: the gateway tolerates **60 s** of clock skew past `exp`.

---

## Measure it

| Path | What it adds |
|---|---|
| catalog alone | baseline |
| gateway → catalog | + the gateway hop |
| edge → gateway → catalog | + the edge hop |
| same, with a token | + JWT validation |

```bash
# k6 inside the compose network: catalog replicas publish no port
docker run --rm -i --network boxoffice_default -v "$PWD":/w -w /w \
  grafana/k6 run -e RATE=50 load/gateway.js
```

---

## Login is slow on purpose

- BCrypt cost 10 → tens of ms of CPU per check.
- `auth` on 1 CPU: roughly 10–20 logins/s.
- Measured: 10 logins/s kept p99 < 200 ms (~80% CPU); 20 logins/s → `504` at the 5 s timeout.
- Consequences: **reuse tokens**, rate-limit `/auth/login`, log in **before** 10:00.

```bash
for r in 5 10 20 40; do k6 run -q -e RATE=$r --summary-export results/lab4/rate-$r.json load/login.js; done
```

---

## Without Docker: the simulator

<div class="flow">
<div class="box accent">Try it end to end<small>201, 200, 200, 401, 403 · one JWKS download</small></div>
<div class="box orange">Failure cases<small>forged header, edited payload, new key, 60 s skew</small></div>
<div class="box green">Edge and replicas<small>/actuator 404, a retried GET, 41 pass and 9 get 429</small></div>
</div>

- The overview embeds lab 4's stack as a simulator: same requests, same answers.
- The path lights up as far as each request got; the box that answered shows the status.

<!--
The simulator sits right after the failure cases in "Try it end to end".
-->

---

## Takeaways

1. Authenticate once at the **gateway**; authorize fine-grained where the data lives.
2. **RS256 + JWKS**: only `auth` signs, everyone verifies locally.
3. Validate `exp`, `iss`, `aud` — not only the signature.
4. **Deny by default**; strip identity headers from clients.
5. The gateway hop and JWT checks are cheap; **password hashing is not**.
