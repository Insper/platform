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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">Platforms, Microservices, DevOps and APIs · Hands-on 3</div>

# Hands-on 3 — Security

**Log in once, get a signed JSON Web Token (JWT), and let the Gateway check it on every request**

<!--
Outline: (1) authentication × authorization; (2) JWT and its claims; (3) the auth interface and the open routes;
(4) auth-service and the credential check in account; (5) the cookie; (6) AuthorizationFilter at the gateway;
(7) compose, testing and pitfalls.
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

## Three modules

<div class="flow">
<div class="box muted" style="flex: .5">internet</div><div class="arrow">→</div>
<div class="box accent">gateway<small>the only published port, :8080</small></div><div class="arrow">→</div>
<div class="box orange">auth<small>login, JWT, /auth/solve</small></div><div class="arrow">→</div>
<div class="box">account<small>password hash, db</small></div>
</div>
<p class="small">gateway, auth and account: all inside the <strong>trusted layer</strong> (the Compose network).</p>

| Module | Role |
|---|---|
| `auth` | interface library: `AuthController` + DTOs `LoginIn`, `RegisterIn`, `TokenOut` |
| `auth-service` | implementation: `AuthResource`, `AuthService`, `JwtService`; delegates accounts to `account` via Feign |
| `gateway-service` | the single entry point of hands-on 2, now with `AuthorizationFilter` + `RouterValidator` |

<p class="small">Same pattern as <code>account</code> / <code>account-service</code>: each one a git submodule under <code>api/</code>; the library is installed with <code>mvn clean install</code>.</p>

---

## JSON Web Token

Three Base64Url parts separated by dots: <span class="chip red">header</span> . <span class="chip accent">payload</span> . <span class="chip green">signature</span> — encoded, **not encrypted**

```
HMACSHA256( base64UrlEncode(header) + "." + base64UrlEncode(payload),
            Base64.decode(JWT_SECRET_KEY) )   // 32 bytes = 256 bits
```

- **Header**: the signing algorithm — JJWT writes only `{"alg": "HS256"}`.
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

## Open vs. secured routes: `RouterValidator`

Register and login must be open — otherwise nobody could ever log in.

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

<!-- _class: tight -->

## Checking credentials in `account`

`auth-service` never checks a password: `account` gains **`POST /accounts/login`** (`AccountController.login`).

```java
// account-service: AccountService (calcHash already exists)
public Account findByEmailAndPassword(String email, String password) {
    if (password == null || password.isEmpty())
        throw new ResponseStatusException(BAD_REQUEST, "Password is empty");
    final String hash = calcHash(password);
    return accountRepository.findByEmailAndHashPassword(email, hash)
        .map(AccountModel::to)
        .orElseThrow(() -> new ResponseStatusException(
            UNAUTHORIZED, "Invalid credentials"));
}
```

- `findByEmailAndHashPassword`: a Spring Data derived query in `AccountRepository`. The endpoint answers `200` + `AccountOut`, or `401`.
- The hash never leaves `account`; `AuthService.login` turns `FeignException.Unauthorized` / `BadRequest` into `401`.
- `AccountController` changed: run `mvn clean install` in `api/account` again.

<!--
Plain SHA-256 keeps the course simple; production uses a slow, salted algorithm (bcrypt, Argon2, Spring Security's PasswordEncoder).
-->

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

1. `POST /auth/login` → `AuthService.login` → `POST /accounts/login` (hash check, or `401`) → `JwtService.generate`.
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

## The Gateway decides: `AuthorizationFilter`

A `GlobalFilter`: **every** request passes through it before routing.

<div class="flow">
<div class="box">request</div><div class="arrow">→</div>
<div class="box accent">isSecured?<small>RouterValidator</small></div><div class="arrow">yes →</div>
<div class="box accent">cookie<small>__store_jwt_token</small></div><div class="arrow">→</div>
<div class="box orange">POST /auth/solve<small>signature, nbf, exp</small></div><div class="arrow">→</div>
<div class="box green">+ id-account<small>the jti, then forward</small></div>
</div>
<div class="flow">
<div class="box muted">open route<small>register, login, logout: forward as is</small></div>
<div class="box red">no cookie<small>401 Unauthorized</small></div>
<div class="box red">invalid or expired token<small>401, kept by onStatus(4xx)</small></div>
</div>

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

<p class="small">Spring Cloud Gateway is <strong>reactive</strong> (WebFlux): the filter returns <code>Mono&lt;Void&gt;</code> and calls auth with <code>WebClient</code>, not <code>RestTemplate</code>. Its <code>onStatus(4xx)</code> keeps an invalid token a <code>401</code>, not a <code>500</code>.</p>

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

## Common pitfalls

- **Wrong credentials → `500`**: a bare `.orElseThrow()` throws `NoSuchElementException`; throw a `401`.
- **Expired cookie → `500`**: `getId` must catch `JwtException`; the filter's `onStatus` keeps the `401`.
- **Build fails after `login`**: reinstall the `account` library before `account-service` and `auth-service`.
- **Cookie ignored**: `SameSite=None` without `Secure` is rejected by the browser.
- **Leaky health check**: `/health-check` is not a route, the filter does not run there — return only the hostname.

<div class="warn">

The default `JWT_SECRET_KEY` is in the repository: anyone could forge tokens for a deployment that keeps it.

</div>

---

## Without Docker: the simulator

<div class="flow">
<div class="box accent">Authorization 5 (test)<small>200, 200, 200, 401 · the JWT page's token, byte for byte</small></div>
<div class="box orange">bad tokens<small>wrong password, forged id-account, edited payload</small></div>
<div class="box red">forged with the default key<small>200 as another user, until JWT_SECRET_KEY is yours</small></div>
</div>

- Each button is a `curl` of the lab through the Gateway; the boxes light up along the path.
- The tokens are real HS256 JWTs signed with the key of `application.yaml`: paste one into jwt.io.
- Past the cookie's `Max-Age`, curl stops sending it; sent by hand, the token meets `ExpiredJwtException`.

<!--
The simulator sits on the overview (bad tokens) and in section 5 of Authorization (the page's four commands).
-->

---

## Takeaways

1. **Authentication** issues a signed JWT; **authorization** checks it on every request.
2. A JWT is `header.payload.signature`; the **secret key** is what makes it trustworthy.
3. `account` checks the password hash (`POST /accounts/login`); `JwtService` signs `jti`, `sub`, `iss`, `nbf`, `exp`, `email`.
4. The token travels in an `HttpOnly`, `Secure` cookie: `__store_jwt_token`.
5. `RouterValidator`: only register, login and logout are open — **secured by default**.
6. `AuthorizationFilter` resolves the token via `/auth/solve` and forwards `id-account`.
7. Downstream services **never parse JWTs**; bad credentials or tokens are a `401`, never a `500`.
