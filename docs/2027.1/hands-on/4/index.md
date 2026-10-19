!!! abstract "In this lab"

    - Build **`auth`**: users, BCrypt passwords, login that returns a **JWT signed with RS256**, and a public **JWKS** endpoint.
    - Put **Spring Cloud Gateway** behind the edge: one place for **routing**, **token validation** and **authorization** (open vs protected vs admin routes).
    - Propagate the user's identity to the services as trusted headers (`X-User-Id`).
    - **Measure** what the extra hop and the token check cost, and how many logins per second `auth` can take.

Until now anyone could create or delete events in the catalog. BoxOffice needs to know **who** is calling (authentication) and **what they may do** (authorization) — and it should not ask every service to solve that problem again. The standard answer is an **API gateway**[^1]: the single front door for the API, where tokens are validated once and requests are routed to the right service. Behind it, services trust the identity the gateway passes along.

## Before you start { #before-you-start }

| | |
|---|---|
| **Time** | 3–4 hours |
| **You need** | the tools of lab 0; Docker with at least **6 GB** (five JVMs from now on); ports **80** and **8080** free |
| **Directory** | every command runs from the root of your `boxoffice/` repository (Windows: inside WSL 2) |

``` { .bash .copy }
docker compose version        # Docker Compose v2.x (or newer)
java -version                 # 21 or newer
mvn -v                        # Apache Maven 3.9+
k6 version                    # k6 v1.0+
uv --version                  # uv (runs the Python helper scripts)
```

**Start state** — the end of lab 3:

``` { .tree title="boxoffice/ at the start of lab 4" }
boxoffice/
    docker-compose.yaml        # db, catalog-1..3, edge
    infra/nginx/nginx.conf     # edge -> catalog replicas
    load/  hello.js smoke.js load.js stress.js ratelimit.js
    results/ ...
    scripts/ ...
    services/catalog/          # with InstanceHeaderFilter
```

!!! tip "Catch up"

    Skipped or broke lab 3? Download [boxoffice-after-lab-3.zip](../3/boxoffice-after-lab-3.zip), unzip it and `cd boxoffice`. This lab **adds** two services (`services/auth`, `services/gateway`) and two k6 scripts, and **replaces** `docker-compose.yaml` and `infra/nginx/nginx.conf`; every file is shown in full on the next pages and is in [`code/`](code/docker-compose.yaml).

## Slides

<div class="slides-embed">
  <iframe src="slides/gateway.html" title="Slides: hands-on 4 — gateway and identity" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/gateway.html){:target="_blank"}

!!! info "Theory connection"

    - Class 4, [API gateway](../../classes/edge/api-gateway/index.md): routing, authentication at the edge, rate limiting, BFF.
    - Class 11, [Identity](../../classes/network-security/identity/index.md): OAuth 2.1/OIDC, JWT, sessions; [Zero trust](../../classes/network-security/zero-trust/index.md): why "trust the gateway's headers" is only acceptable inside a protected network.
    - Component catalog: [API Gateway](../../reference/components/edge/index.md#apigw), [Auth Service](../../reference/components/compute/index.md#auth).

## What you will build

``` mermaid-sim
sequenceDiagram
    autonumber
    actor Fan
    participant E as edge :80
    participant G as gateway :8080
    participant A as auth :8081
    participant C as catalog-1..3 :8082
    Fan->>E: POST /auth/login {email, password}
    E->>G: forward
    G->>A: route /auth/** (open)
    A->>A: BCrypt check, sign JWT with private key
    A-->>Fan: 200 {accessToken: "eyJ..."}
    Fan->>E: POST /catalog/events + Authorization: Bearer eyJ...
    E->>G: forward
    G->>A: GET /auth/.well-known/jwks.json (first time only, then cached)
    G->>G: verify signature, exp, iss, aud — scope "admin"?
    G->>C: route lb://catalog + X-User-Id, X-User-Scope
    C-->>Fan: 201 Created
```

Tokens are JWTs[^2]: signed JSON that any holder of the public key can verify without calling `auth`.

| Route | Who may call it | Enforced by |
|---|---|---|
| `POST /auth/register`, `POST /auth/login`, `GET /auth/.well-known/jwks.json` | anyone | gateway: `permitAll` |
| `GET /catalog/**` | anyone | gateway: `permitAll` |
| `POST`/`PUT`/`DELETE /catalog/**` | tokens with scope `admin` | gateway: `hasAuthority("SCOPE_admin")` |
| `GET /auth/me` and **every other route** (including future ones) | any valid token | gateway: `anyExchange().authenticated()` |

The topology after this lab: **edge** (Nginx: TLS termination in production, rate limiting, load balancing over gateway replicas) → **gateway** (identity, routing, load balancing over service instances) → **services**.

## Steps

<div class="grid cards" markdown>

-   :material-account-key:{ .lg .middle } **[1. The `auth` service](auth/index.md)**

    ---

    Users table, BCrypt, login, JWT signing with an RSA key pair, the JWKS document.

-   :material-gate:{ .lg .middle } **[2. The gateway](gateway/index.md)**

    ---

    Spring Cloud Gateway routes, client-side load balancing over `catalog-1..3`, JWT validation, identity headers, the new edge and Compose.

</div>

## 3. Try it end to end

With both steps done, rebuild and start everything:

``` { .bash .copy }
docker compose up --build -d
docker compose ps        # db, catalog-1..3, auth, gateway healthy; edge running
```

<!-- termynal -->
``` shell
> curl -s -X POST localhost/auth/register -H 'Content-Type: application/json' -d '{"name":"Ana","email":"ana@example.com","password":"secret-123"}'
{"id":"0b9d8a6e-…","name":"Ana","email":"ana@example.com","role":"USER"}
> TOKEN=$(curl -s -X POST localhost/auth/login -H 'Content-Type: application/json' -d '{"email":"ana@example.com","password":"secret-123"}' | jq -r .accessToken)
> curl -s localhost/auth/me -H "Authorization: Bearer $TOKEN"
{"id":"0b9d8a6e-…","name":"Ana","email":"ana@example.com","role":"USER"}
> curl -s -o /dev/null -w "%{http_code}\n" localhost/auth/me
401
> curl -s -o /dev/null -w "%{http_code}\n" -X DELETE localhost/catalog/events/2 -H "Authorization: Bearer $TOKEN"
403
```

Now as the administrator (created at startup from `ADMIN_EMAIL`/`ADMIN_PASSWORD`):

``` { .bash .copy }
ADMIN=$(curl -s -X POST localhost/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@boxoffice.dev","password":"boxoffice-admin"}' | jq -r .accessToken)

curl -s -X PUT localhost/catalog/events/2 -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"title":"Match #2 (rescheduled)","category":"SPORTS","venueId":15,"startsAt":"2027-03-02T21:00:00-03:00","priceFrom":100}' | jq .title

# look inside the token: header and claims are only Base64URL, NOT encrypted
echo "$ADMIN" | cut -d. -f2 | tr '_-' '/+' | base64 -d 2>/dev/null; echo
```

??? question "Think first: a client sends `X-User-Id: <the admin's id>` itself. What happens?"

    Nothing useful for the attacker: the gateway's `UserHeadersFilter` **removes** any `X-User-*` header coming from outside before setting its own from the validated token. Without that line, any client could impersonate any user, because the services trust those headers blindly. That trust is acceptable only because the services are not reachable except through the gateway — zero-trust networks (class 11) go further and authenticate every hop (mTLS, or re-validating the JWT in each service).

Try the other failure cases too: an expired token (start `auth` with `JWT_TTL=PT30S`, wait a minute), a token with one character changed (signature check fails), and restarting `auth` (new key pair: old tokens are rejected because their `kid` no longer exists in the JWKS — see the warning in [step 1](auth/index.md)).

## Measure it: the price of a front door { #measure-it }

Every hop and every check costs something. Measure three request types at the same rate — open route through the edge, protected route (JWT validation) through the edge, and the open route straight to the gateway port — plus the throughput of `auth` itself.

``` { .javascript title="load/gateway.js" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/4/code/load/gateway.js"
```

``` { .javascript title="load/login.js" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/4/code/load/login.js"
```

``` { .bash .copy }
k6 run -e RATE=50 load/gateway.js        # 3 scenarios × 50 req/s
mkdir -p results/lab4
for r in 5 10 20 40; do k6 run -q -e RATE=$r --summary-export results/lab4/login-$r.json load/login.js; done
uv run scripts/summarize.py results/lab4/login-*.json
```

Record in `results/lab4.md`:

``` { .markdown title="results/lab4.md" .copy }
# Lab 4 — gateway and identity

## Hops (50 req/s each, 1 min)
| Path | p50 (ms) | p95 (ms) | p99 (ms) |
|---|---:|---:|---:|
| edge → catalog (lab 3, same rate) | | | |
| gateway → catalog (direct) | | | |
| edge → gateway → catalog (open) | | | |
| edge → gateway → auth, JWT validated (protected) | | | |

Cost of the gateway hop ≈ ____ ms at p50; cost of JWT validation ≈ ____ ms.

## Login capacity
<table from summarize.py: rate, p50, p99, errors>
- Max logins/s with p99 < 1 s: ____ ; CPU of auth at that rate (docker stats): ____ %
- One BCrypt check (cost 10) takes about ____ ms on my machine.

## Questions
- Why does the gateway validate tokens locally instead of calling auth on every request?
- What would happen to the flash sale if every request called /auth/login?
```

How to read it:

- The **gateway hop** adds a fraction of a millisecond to a few milliseconds at p50 (an extra network hop and a non-blocking proxy). Signature checking with RS256 is microseconds of CPU: JWT validation is cheap **because it is local** — the gateway fetched the public key once and never calls `auth` per request.
- **Login is expensive on purpose.** BCrypt with cost 10 burns tens of milliseconds of CPU per attempt, so `auth` with 1 CPU tops out at roughly **ten to twenty logins per second** (in a test run for this lab, 10 logins/s already pushed p99 into seconds). That is exactly what makes password guessing slow — and why clients must **reuse tokens** instead of logging in per request. During a flash sale, logins should happen *before* 10:00.

!!! note "If your numbers differ"

    On a laptop, the gateway (1 CPU) shares the machine with five other JVMs and PostgreSQL, so the hop can cost more than in production — in a run for this lab on a busy machine, p50 reached hundreds of milliseconds at 150 req/s. Compare **relative** costs on the same machine and the same run: direct to the gateway vs through the edge vs with JWT. For logins, the ceiling scales with CPU: one core gives roughly 10–20 BCrypt checks per second.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `503` from `/catalog/**` for a few seconds after the gateway starts; log `No servers available for service: catalog` | the load balancer's health checks have not run yet | wait ~10 s; if it persists, check `docker compose ps` (catalog replicas healthy?) and that the gateway pom has `spring-boot-starter-webclient` |
| `401` on every protected route | no `Authorization: Bearer …` header, an expired token, or `auth` restarted (new key) | log in again: `export TOKEN=$(curl -s -X POST localhost/auth/login -H 'Content-Type: application/json' -d '{"email":"ana@example.com","password":"secret-123"}' \| jq -r .accessToken)` |
| `403` as admin | you used the user's token, or the admin was not created | `docker compose logs auth \| grep administrator`; log in with `admin@boxoffice.dev` / `boxoffice-admin` |
| `409 e-mail already registered` | you ran the register command twice | fine: just log in |
| `Bind for 0.0.0.0:8080 failed` | another program uses 8080 | change only the host side: `"18080:8080"` |
| the gateway logs `Unable to resolve the Configuration with the provided Issuer` or JWKS errors | `AUTH_JWKS_URI`/`JWT_ISSUER` differ between `auth` and `gateway` | use the `docker-compose.yaml` of this lab unchanged |
| containers restart or get killed (`exit 137`) | Docker is out of memory | give Docker ≥ 6 GB (Docker Desktop → Settings → Resources) |

## Clean up

``` { .bash .copy }
docker compose down          # keeps the database (users and events)
# docker compose down -v     # resets everything: users are created again from scratch
```

Keep everything: lab 5 adds Redis to this stack.

## Deliverable

- [ ] `services/auth` and `services/gateway` running; the new `infra/nginx/nginx.conf` sends everything to the gateway.
- [ ] The curl session above reproduced: `201`, `200`, `401`, `403`, and an admin update that works.
- [ ] The spoofing test: sending `X-User-Id` yourself has no effect (show the evidence).
- [ ] `results/lab4.md` with the hop table, the login capacity and the two answers.
- [ ] Repository tagged `lab4`; [quiz](quiz.md) answered.

## End state

``` { .tree title="changed in lab 4" }
boxoffice/
    docker-compose.yaml        # replaced: + auth (8081), + gateway (8080); edge -> gateway
    infra/nginx/nginx.conf     # replaced: everything goes to the gateway, /actuator hidden
    load/gateway.js  load/login.js           # new
    services/auth/             # new: users, BCrypt, RS256 JWT, JWKS
    services/gateway/          # new: routes, lb://catalog, JWT validation, identity headers
    results/lab4.md  results/lab4/
```

Next: [Lab 5 — Caching](../5/index.md).

[^1]: Spring Cloud Gateway reference, [Server WebFlux](https://docs.spring.io/spring-cloud-gateway/reference/spring-cloud-gateway-server-webflux.html){target="_blank"}; Spring Security reference, [OAuth 2.0 Resource Server — JWT](https://docs.spring.io/spring-security/reference/reactive/oauth2/resource-server/jwt.html){target="_blank"}.
[^2]: IETF, [RFC 7519 — JSON Web Token](https://www.rfc-editor.org/rfc/rfc7519){target="_blank"} and [RFC 7517 — JSON Web Key](https://www.rfc-editor.org/rfc/rfc7517){target="_blank"}.
