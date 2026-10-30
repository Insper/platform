`auth` owns the users of BoxOffice. It does three things: **register** a user (storing a BCrypt hash, never the password), **log in** (check the password and issue a signed token) and **publish the public key** that lets anybody verify those tokens. It is a regular Spring Boot service on port **8081**, with its own schema `auth`.

``` diagram
flowchart LR
    subgraph auth["auth :8081"]
        ctl[AuthController] --> svc[AuthService]
        svc --> repo[UserRepository] --> db[("schema auth<br/>users")]
        svc --> tok["TokenService<br/>RSA key pair"]
    end
    gw[gateway] -->|"GET /auth/.well-known/jwks.json<br/>(public key, cached)"| ctl
```

## 1. Why a signed token?

After login, every request must prove who is calling. Two families of solutions:

| | Server-side session | Self-contained token (JWT) |
|---|---|---|
| What the client holds | a random session id (cookie) | the claims themselves, signed: `sub`, `scope`, `exp`… |
| How a request is checked | look the id up in a session store (Redis, DB) | verify the signature with the public key — **no lookup** |
| Revocation | delete the session: immediate | hard: the token is valid until `exp` (keep it short) |
| Scales with | the session store | CPU only; every node can verify alone |

BoxOffice uses JWTs signed with **RS256** (RSA + SHA-256): `auth` signs with a **private key** only it knows; the gateway verifies with the **public key**, published as a JWKS (JSON Web Key Set). The gateway can verify tokens but can never mint one — unlike HS256, where the same shared secret signs and verifies, and every service holding it could forge tokens.

A token looks like `header.payload.signature`, each part Base64URL-encoded:

``` { .json title="decoded payload of a BoxOffice token" }
{
  "iss": "boxoffice-auth",
  "aud": "boxoffice",
  "sub": "0b9d8a6e-4f3c-4c1e-9d52-1b0f3c2a7e11",
  "email": "ana@example.com",
  "name": "Ana",
  "scope": "user",
  "iat": 1795000000,
  "exp": 1795003600,
  "jti": "7c1f…"
}
```

!!! warning "Signed is not encrypted"

    Anybody can decode the payload (try `jwt.io`, or the `jq` command at the end of the curl session on the [lab page](../index.md)). Never put secrets or personal data you would not show the user in a JWT.

## 2. Project and configuration

Create `services/auth` like `catalog` (same `Dockerfile` with `EXPOSE 8081`, same `.dockerignore`).

??? example "`services/auth/Dockerfile` and `.dockerignore` (same as `catalog`, only `EXPOSE 8081` changes)"

    ``` { .dockerfile title="services/auth/Dockerfile" .copy linenums="1" }
    --8<-- "docs/2027.1/hands-on/4/code/services/auth/Dockerfile"
    ```

    ``` { .text title="services/auth/.dockerignore" .copy }
    --8<-- "docs/2027.1/hands-on/4/code/services/auth/.dockerignore"
    ```

``` { .xml title="services/auth/pom.xml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/4/code/services/auth/pom.xml"
```

Note what is **not** there: the full Spring Security starter. `auth` only needs the BCrypt encoder (`spring-security-crypto`) and a JWT library (`nimbus-jose-jwt`, the same one Spring Security uses inside the gateway).

``` { .yaml title="services/auth/src/main/resources/application.yaml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/4/code/services/auth/src/main/resources/application.yaml"
```

``` { .sql title="services/auth/src/main/resources/db/migration/V1__create_users.sql" .copy }
--8<-- "docs/2027.1/hands-on/4/code/services/auth/src/main/resources/db/migration/V1__create_users.sql"
```

## 3. Users

=== "User.java"

    ``` { .java title="services/auth/src/main/java/boxoffice/auth/User.java" .copy linenums="1" }
    --8<-- "docs/2027.1/hands-on/4/code/services/auth/src/main/java/boxoffice/auth/User.java"
    ```

=== "Role.java"

    ``` { .java title="services/auth/src/main/java/boxoffice/auth/Role.java" .copy }
    --8<-- "docs/2027.1/hands-on/4/code/services/auth/src/main/java/boxoffice/auth/Role.java"
    ```

=== "UserRepository.java"

    ``` { .java title="services/auth/src/main/java/boxoffice/auth/UserRepository.java" .copy }
    --8<-- "docs/2027.1/hands-on/4/code/services/auth/src/main/java/boxoffice/auth/UserRepository.java"
    ```

=== "AuthApplication.java"

    ``` { .java title="services/auth/src/main/java/boxoffice/auth/AuthApplication.java" .copy }
    --8<-- "docs/2027.1/hands-on/4/code/services/auth/src/main/java/boxoffice/auth/AuthApplication.java"
    ```

The records exchanged with clients:

=== "RegisterIn"

    ``` { .java title="services/auth/src/main/java/boxoffice/auth/RegisterIn.java" .copy }
    --8<-- "docs/2027.1/hands-on/4/code/services/auth/src/main/java/boxoffice/auth/RegisterIn.java"
    ```

=== "LoginIn"

    ``` { .java title="services/auth/src/main/java/boxoffice/auth/LoginIn.java" .copy }
    --8<-- "docs/2027.1/hands-on/4/code/services/auth/src/main/java/boxoffice/auth/LoginIn.java"
    ```

=== "TokenOut"

    ``` { .java title="services/auth/src/main/java/boxoffice/auth/TokenOut.java" .copy }
    --8<-- "docs/2027.1/hands-on/4/code/services/auth/src/main/java/boxoffice/auth/TokenOut.java"
    ```

=== "UserOut"

    ``` { .java title="services/auth/src/main/java/boxoffice/auth/UserOut.java" .copy }
    --8<-- "docs/2027.1/hands-on/4/code/services/auth/src/main/java/boxoffice/auth/UserOut.java"
    ```

## 4. Signing tokens and publishing the key

``` { .java title="services/auth/src/main/java/boxoffice/auth/TokenService.java" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/4/code/services/auth/src/main/java/boxoffice/auth/TokenService.java"
```

| Claim | Meaning | Checked by the gateway |
|---|---|---|
| `iss` | who issued it (`boxoffice-auth`) | yes: must match `JWT_ISSUER` |
| `aud` | who it is for (`boxoffice`) | yes: a token for another API is refused |
| `sub` | the user id | becomes `X-User-Id` |
| `scope` | `user` or `user admin` | becomes the authorities `SCOPE_user`, `SCOPE_admin` |
| `exp` | expiry | yes (with a 60 s clock-skew allowance) |
| `kid` (header) | which key signed it | used to pick the right key from the JWKS |

!!! warning "A new key at every restart"

    `TokenService` generates the RSA key pair in memory when `auth` starts. Restart `auth` and every token issued before is rejected (unknown `kid`), and two `auth` replicas would each sign with a different key. In production the private key lives in a **KMS or secrets manager**, the JWKS lists the current **and** the previous key during a rotation, and keys rotate on a schedule. For a lab, a restart that logs everybody out is a feature: you see why rotation needs care.

## 5. Register, login, me

``` { .java title="services/auth/src/main/java/boxoffice/auth/AuthService.java" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/4/code/services/auth/src/main/java/boxoffice/auth/AuthService.java"
```

``` { .java title="services/auth/src/main/java/boxoffice/auth/AuthController.java" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/4/code/services/auth/src/main/java/boxoffice/auth/AuthController.java"
```

Details that matter:

- **BCrypt cost 10** means 2¹⁰ rounds of key expansion: tens of milliseconds per hash. Fast enough for a human logging in, slow enough to make an offline attack on a leaked table expensive. It also makes `/auth/login` the most CPU-hungry endpoint of BoxOffice — you will measure it.
- **Same error** for "unknown e-mail" and "wrong password" (`401 invalid credentials`): different messages would let an attacker discover which e-mails have accounts.
- `/auth/me` does not read the token: it trusts `X-User-Id`, set by the gateway after validating it. `auth` is not reachable from outside except through the gateway.
- The administrator is created once, on `ApplicationReadyEvent`, from `ADMIN_EMAIL`/`ADMIN_PASSWORD`. Change the password in any shared environment.

!!! tip "In the interview"

    "Authentication at the gateway, authorization close to the data": the gateway rejects anonymous or malformed requests early and cheaply; fine-grained rules ("is this hold *yours*?") stay in the service that owns the data — `inventory` checks `user_id` on every hold in lab 6.

Next: [2. The gateway](../gateway/index.md).
