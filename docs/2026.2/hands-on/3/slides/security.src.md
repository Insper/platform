---
marp: true
lang: en
title: Hands-on 3 — Security
description: Platforms, Microservices, DevOps and APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Platforms, Microservices, DevOps and APIs · Hands-on 3</div>

# Hands-on 3 — Security

**Log in once, get a signed JWT, and let the Gateway check it on every request**

<!--
Outline: (1) authentication × authorization; (2) JWT and its claims; (3) auth interface and auth-service;
(4) the cookie; (5) open routes; (6) AuthorizationFilter at the gateway; (7) compose and testing.
-->

---

## Who are you, and what can you do?

<div class="q">

Requests to `/accounts` now arrive from the internet. Should **every service** check the user's password?

</div>

* **Authentication**: verify *who* the user is → after login, issue a **signed JWT** valid for a limited time.
* **Authorization**: verify *what* the user can access → the **Gateway** checks the JWT before routing.
* One **single entry point**: services behind it never see an unauthenticated request.

<!--
Let the class answer first: checking credentials in every service multiplies the attack surface and the code.
-->

---

## Three new modules

`internet → gateway → account / auth / others` · `auth → account` · all inside the **trusted layer**

| Module | Role |
|---|---|
| `auth` | interface library: `AuthController` + DTOs `LoginIn`, `RegisterIn`, `TokenOut` |
| `auth-service` | implementation: `AuthResource`, `AuthService`, `JwtService`; delegates accounts to `account` via Feign |
| `gateway-service` | single entry point: `AuthorizationFilter` + `RouterValidator` |

<p class="small">Same pattern as <code>account</code> / <code>account-service</code>: a library installed with <code>mvn clean install</code>, plus a runnable service.</p>

---

## JSON Web Token

Three Base64Url parts separated by dots: `header.payload.signature`

```
HMAC( base64UrlEncode(header) + "." + base64UrlEncode(payload), secret )
```

- **Header**: token type and signing algorithm.
- **Payload**: the **claims** — statements about the user.
- **Signature**: proves the token was issued by whoever holds the secret and was not altered.
- **Stateless**: no server-side session, so it scales horizontally.

<div class="warn">

Anyone with the **secret key** can forge tokens: keep it in an environment variable, **never hardcode it**.

</div>

---

## The claims this platform uses

| Claim | JJWT field | Content |
|---|---|---|
| `jti` | `id` | the account's unique identifier |
| `sub` | `subject` | the account's name |
| `iss` | `issuer` | the issuing platform (`Insper::PMA`) |
| `nbf` | `notBefore` | valid from this timestamp |
| `exp` | `expiration` | expires at this timestamp |

<p class="small">Plus a custom (private) claim: <code>email</code>. The payload is only encoded, not encrypted — anyone can read it.</p>

---

## The `auth` contract

`@FeignClient(name="auth", url="http://auth:8080")` · cookie name `AUTH_COOKIE_TOKEN = "__store_jwt_token"`

| Method | Path | Does |
|---|---|---|
| `POST` | `/auth/register` | `create`: `RegisterIn(name, email, password)` → creates the account |
| `POST` | `/auth/login` | `LoginIn(email, password)` → sets the JWT cookie |
| `GET` | `/auth/logout` | clears the cookie |
| `GET` | `/auth/me` | header `id-account` → `AccountOut` |
| `POST` | `/auth/solve` | `TokenOut(token)` → `{ "idAccount": … }` — **internal, Gateway only** |
| `GET` | `/auth/health-check` | `200 OK` |

---

## `auth-service`

| Class | Responsibility |
|---|---|
| `AuthApplication` | `@EnableFeignClients(basePackages = "store.account")` |
| `AuthResource` | implements `AuthController`; writes the cookie on login/logout |
| `AuthService` | registers via `account` (`AuthParser` → `Register`); on login, `POST /accounts/login` checks the credentials, then asks for a token |
| `JwtService` | signs and parses JWTs with the **JJWT** library (HMAC key: 256-bit secret → `HS256`) |

```yaml
store:
  jwt:
    secretKey: ${JWT_SECRET_KEY:EBwrdOOcAIDRLON9hbJV0+O3PTdfTjgMCQIxwLH7ws8=}
    httpOnly: ${JWT_HTTP_ONLY:true}
    duration: ${JWT_DURATION:3600000} # 1 hour in milliseconds
```

---

## `JwtService.generate`

```java
public String generate(AccountOut account, long duration) {
    Date now = new Date();
    return Jwts.builder()
        .id(account.id())
        .issuer("Insper::PMA")
        .claims(Map.of("email", account.email()))
        .signWith(getKey())  // Keys.hmacShaKeyFor(Base64-decoded secretKey)
        .subject(account.name())
        .notBefore(now)
        .expiration(new Date(now.getTime() + duration))
        .compact();
}
```

---

## `JwtService.getId`

```java
public String getId(String jwt) {
    try {
        JwtParser parser = Jwts.parser().verifyWith(getKey()).build();
        // checks the signature, nbf and exp: a JwtException otherwise
        Claims claims = parser.parseSignedClaims(jwt).getPayload();
        return claims.getId();
    } catch (JwtException e) {
        throw new ResponseStatusException(
            HttpStatus.UNAUTHORIZED, "Invalid token");
    }
}
```

<p class="small">This is what <code>/auth/solve</code> runs: a valid token becomes an <code>idAccount</code>; a bad or expired one, a <code>401</code> (not a <code>500</code>).</p>

---

<!-- _class: tight -->

## Login → cookie

1. `POST /auth/login` → `AuthService.login` → `POST /accounts/login` (hash check) → `JwtService.generate`.
2. `AuthResource` answers with `Set-Cookie: __store_jwt_token=<jwt>`.
3. The browser stores it and **sends it automatically** on every later request.

| Flag | Value | Why |
|---|---|---|
| `HttpOnly` | `true` | JavaScript cannot read it → mitigates **XSS** (unlike `localStorage`) |
| `Secure` | `true` | sent only over HTTPS |
| `SameSite` | `None` | sent on cross-site requests (SPA frontends) |
| `Path` | `/` | valid for all paths |

<div class="warn">

Browsers reject `SameSite=None` without `Secure`: in production, frontend and API must use **HTTPS**.

</div>

---

## Open routes: `RouterValidator`

Without open routes, nobody could ever log in.

```java
private List<String> openApiEndpoints = List.of(
    "POST /auth/register",
    "GET /auth/logout",
    "POST /auth/login");

public Predicate<ServerHttpRequest> isSecured = request ->
    openApiEndpoints.stream().noneMatch(/* method and path match, /** = prefix */);
```

<div class="ok">

**Secured by default**: everything not in the list — including all `/accounts/**` — needs a valid cookie.

</div>

---

## The Gateway decides: `AuthorizationFilter`

A `GlobalFilter`: **every** request passes through it before routing.

1. `isSecured`? **No** → forward as is.
2. Cookie `__store_jwt_token` present? **No** → `401 Unauthorized`.
3. `POST http://auth:8080/auth/solve` with `{ "token": jwt }`.
4. Invalid token → `401`. Valid → add the header and forward:

| Header | Value |
|---|---|
| `id-account` | the account UUID from the token |

<p class="small">An <code>id-account</code> sent by the client is dropped first (<code>RemoveRequestHeader</code>): nobody can pose as another account.</p>

<!--
Stress: downstream services never parse JWTs; they just read the id-account header.
-->

---

## `AuthorizationFilter.filter`

```java
public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
    ServerHttpRequest request = exchange.getRequest();
    if (!routerValidator.isSecured.test(request)) {
        return chain.filter(exchange);
    }
    if (request.getCookies().containsKey(AUTH_COOKIE_TOKEN)) {
        String token = request.getCookies().getFirst(AUTH_COOKIE_TOKEN).getValue();
        if (null != token && token.length() > 0) {
            return requestAuthTokenSolve(exchange, chain, token.trim());
        }
    }
    throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
}
```

<p class="small">Spring Cloud Gateway is <strong>reactive</strong> (WebFlux): the filter returns <code>Mono&lt;Void&gt;</code> and calls auth with <code>WebClient</code>, not <code>RestTemplate</code>.</p>

---

<!-- _class: tight -->

## Wiring: routes and Compose

<div class="cols">
<div>

```yaml
default-filters:
  - RemoveRequestHeader=id-account
routes:
  - id: account-service
    uri: http://account:8080
    predicates:
      - Path=/accounts/**
  - id: auth-service
    uri: http://auth:8080
    predicates:
      - Path=/auth/**
```

</div>
<div>

- New service: `auth` (after `gateway`, hands-on 2).
- **Only `gateway` publishes** port `8080`; `auth` stays inside.
- `auth` runs on defaults: `JWT_SECRET_KEY`, `JWT_HTTP_ONLY`, `JWT_DURATION`.
- `gateway`: `CORS_ALLOWED_ORIGINS` has a default too.

</div>
</div>

<div class="warn">

The default key is public (it is in the repo): outside dev, set `JWT_SECRET_KEY` to your own — `openssl rand -base64 32`.

</div>

---

## Test it

```bash
docker compose up -d --build

curl -X POST http://localhost:8080/auth/register -H "Content-Type: application/json" \
  -d '{"name": "Antonio do Estudo", "email": "acme@insper.edu.br", "password": "123@321"}'

curl -c cookies.txt -X POST http://localhost:8080/auth/login -H "Content-Type: application/json" \
  -d '{"email": "acme@insper.edu.br", "password": "123@321"}'

curl -b cookies.txt http://localhost:8080/accounts   # 200 — cookie sent
curl http://localhost:8080/accounts                  # 401 — no cookie
```

---

## Takeaways

1. **Authentication** issues a signed JWT; **authorization** checks it on every request.
2. A JWT is `header.payload.signature`; the **secret key** is what makes it trustworthy.
3. `JwtService` signs with `jti`, `sub`, `iss`, `nbf`, `exp` — and validates signature, `nbf` and `exp`.
4. The token travels in an `HttpOnly`, `Secure` cookie: `__store_jwt_token`.
5. `RouterValidator`: only register, login and logout are open — **secured by default**.
6. `AuthorizationFilter` resolves the token via `/auth/solve` and forwards `id-account`.
7. Downstream services **never parse JWTs**: the Gateway does it once.
