The first step in building the security layer is understanding **JSON Web Tokens (JWT)** and creating the `auth` interface module that defines the API contract for authentication.

## 1. JSON Web Token

JWT is a compact, URL-safe way to represent claims between two parties. It is the standard used by the platform to carry the authenticated user's identity across services without storing server-side session state — making it naturally compatible with [horizontal scalability](../../concepts.md#horizontal-scalability-scale-out).

A JWT consists of three Base64Url-encoded parts separated by dots.

!!! example "Example JWT"

    ```
    eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.eyJpc3MiOiJJbnNwZXIiLCJpYXQiOjE3MDMwMDgzMzgsImV4cCI6MjAxODU0MTEz
    OCwiYXVkIjoid3d3Lmluc3Blci5lZHUuYnIiLCJzdWIiOiJodW1iZXJ0b3JzQGluc3Blci5lZHUuYnIiLCJHaXZlbk5hbWUiOiJId
    W1iZXJ0byIsIlN1cm5hbWUiOiJTYW5kbWFubiIsIkVtYWlsIjoiaHVtYmVydG9yc0BpbnNwZXIuZWR1LmJyIiwiUm9sZSI6IlByb2
    Zlc3NvciJ9.SsGdvR5GbYWTRbxY7IGxHt1vSxhkpRueBJWsi0lrPhJVCICp119QjU8F3QvHW0yF5tw-HhQ9RVh0l89t4M0LNw
    ```

    === "Header"

        ```json
        {
            "alg": "HS256"
        }
        ```

        The header typically consists of two parts: the type of the token (JWT) and the signing algorithm being used, such as HMAC SHA256 or RSA.

    === "Payload (Claims)"

        ```json
        {
            "iss": "Insper",
            "iat": 1703008338,
            "exp": 2018541138,
            "aud": "www.insper.edu.br",
            "sub": "humbertors@insper.edu.br",
            "GivenName": "Humberto",
            "Surname": "Sandmann",
            "Email": "humbertors@insper.edu.br",
            "Role": "Professor"
            }
        ```

        The payload contains the claims. Claims are statements about an entity (typically, the user) and additional data. There are three types of claims: registered, public, and private claims. Registered claims are a set of predefined claims which are not mandatory but recommended, to provide a set of useful, interoperable claims. Some examples are `iss` (issuer), `exp` (expiration time), `sub` (subject), and `aud` (audience). Public claims can be defined at will by those using JWTs. To avoid collisions they should be defined in the IANA JSON Web Token Registry or be defined as a URI that contains a collision resistant namespace. Private claims are the custom claims created to share information between parties that agree on using them and are neither registered nor public claims.

    === "Signature"

        ```
        HMACSHA512(
            base64UrlEncode(header) + "." +
            base64UrlEncode(payload),
            qwertyuiopasdfghjklzxcvbnm123456,
        )
        ```

        To create the signature part, you take the encoded header, the encoded payload, a secret, the algorithm specified in the header, and sign that.

!!! warning "Secret Key"

    The secret key used to sign the JWT must be kept confidential. Anyone with access to it can forge tokens. Store it as an environment variable — **never hardcode it** in source code.

The key claims used in this platform are:

| Claim | Field | Description |
|---|---|---|
| `jti` | `id` | The account's unique identifier |
| `sub` | `subject` | The account's name |
| `iss` | `issuer` | The issuing platform |
| `nbf` | `notBefore` | Token becomes valid at this timestamp |
| `exp` | `expiration` | Token expires at this timestamp |

After a successful login, the server generates a JWT, sets it in an `HttpOnly` cookie, and returns it to the browser. For every subsequent request, the browser sends the cookie automatically — the Gateway reads it and resolves the identity without asking the user to log in again.

``` mermaid
sequenceDiagram
  autonumber
  actor User
  User->>+Auth Service: login (email + password)
  Auth Service->>Auth Service: validates credentials and generates JWT
  Auth Service->>-User: Set-Cookie: __store_jwt_token=<jwt>
  User->>User: browser stores the cookie
  User->>Gateway: subsequent requests carry the cookie automatically
```

## 2. The `auth` Interface Module

The `auth` module follows the same pattern as the `account` module: it is a **library** (not a runnable application) that defines the API contract and DTOs shared between the `auth-service` and any other microservice that needs to call the auth endpoints via Feign.

### 2.1 Repository

Create a new git repository for the auth interface and add it as a submodule:

``` bash
git submodule add <repository_url> api/auth
```

``` tree
api/
    account/
    account-service/
    auth/
```

### 2.2 Code

Use [Spring Initializr](https://start.spring.io/){target="_blank"} to generate a Maven project with the following settings:

- **Group:** `store`
- **Artifact:** `auth`
- **Package name:** `store.auth`
- **Packaging:** Jar
- **Java:** 25

Dependencies to add:

- *Lombok* — reduces boilerplate with compile-time annotation processing
- *OpenFeign* — declarative HTTP client for inter-service calls

Delete `AuthApplication.java`, `src/test/`, and `src/main/resources/` — this module is a library, not a runnable service.

The resulting structure is:

``` tree
api/
    auth/
        src/
            main/
                java/
                    store/
                        auth/
                            AuthController.java
                            LoginIn.java
                            RegisterIn.java
                            TokenOut.java
        pom.xml
```

!!! example "Source"

    === "pom.xml"

        ``` { .xml .copy .select linenums="1" }
        <?xml version="1.0" encoding="UTF-8"?>
        <project xmlns="http://maven.apache.org/POM/4.0.0"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
            <modelVersion>4.0.0</modelVersion>
            <parent>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-starter-parent</artifactId>
                <version>4.0.3</version>
                <relativePath/>
            </parent>

            <groupId>store</groupId>
            <artifactId>auth</artifactId>
            <version>1.0.0</version>
            <name>auth</name>

            <properties>
                <java.version>25</java.version>
                <spring-cloud.version>2025.1.0</spring-cloud.version>
                <maven.compiler.proc>full</maven.compiler.proc>
            </properties>

            <dependencies>
                <dependency>
                    <groupId>org.springframework.cloud</groupId>
                    <artifactId>spring-cloud-starter-openfeign</artifactId>
                </dependency>
                <dependency>
                    <groupId>store</groupId>
                    <artifactId>account</artifactId>
                    <version>${project.version}</version>
                </dependency>
                <dependency>
                    <groupId>org.projectlombok</groupId>
                    <artifactId>lombok</artifactId>
                    <optional>true</optional>
                </dependency>
            </dependencies>

            <dependencyManagement>
                <dependencies>
                    <dependency>
                        <groupId>org.springframework.cloud</groupId>
                        <artifactId>spring-cloud-dependencies</artifactId>
                        <version>${spring-cloud.version}</version>
                        <type>pom</type>
                        <scope>import</scope>
                    </dependency>
                </dependencies>
            </dependencyManagement>
        </project>
        ```

    === "AuthController.java"

        ``` { .java .copy .select linenums="1" }
        package store.auth;

        import java.util.Map;

        import org.springframework.cloud.openfeign.FeignClient;
        import org.springframework.http.ResponseEntity;
        import org.springframework.web.bind.annotation.GetMapping;
        import org.springframework.web.bind.annotation.PostMapping;
        import org.springframework.web.bind.annotation.RequestBody;
        import org.springframework.web.bind.annotation.RequestHeader;

        import store.account.AccountOut;

        @FeignClient(
            name="auth",
            url="http://auth:8080"
        )
        public interface AuthController {

            public static String AUTH_COOKIE_TOKEN = "__store_jwt_token";

            @PostMapping("/auth/login")
            public ResponseEntity<Void> login(
                @RequestBody LoginIn in
            );

            @PostMapping("/auth/register")
            public ResponseEntity<Void> register(
                @RequestBody RegisterIn in
            );

            @GetMapping("/auth/whoiam")
            public ResponseEntity<AccountOut> whoIAm(
                @RequestHeader(value = "id-account", required = true) String idAccount
            );

            @GetMapping("/auth/health-check")
            public ResponseEntity<Void> healthCheck();

            @PostMapping("/auth/solve")
            public ResponseEntity<Map<String, String>> solveToken(
                @RequestBody TokenOut map
            );

            @GetMapping("/auth/logout")
            public ResponseEntity<Void> logout();

        }
        ```

    === "LoginIn.java"

        ``` { .java .copy .select linenums="1" }
        package store.auth;

        import lombok.Builder;

        @Builder
        public record LoginIn(

            String email,
            String password

        ) {
        }
        ```

    === "RegisterIn.java"

        ``` { .java .copy .select linenums="1" }
        package store.auth;

        import lombok.Builder;

        @Builder
        public record RegisterIn(

            String name,
            String email,
            String password

        ) {
        }
        ```

    === "TokenOut.java"

        ``` { .java .copy .select linenums="1" }
        package store.auth;

        import lombok.Builder;

        @Builder
        public record TokenOut(

            String token

        ) {
        }
        ```

!!! note "The `/auth/solve` endpoint"

    `solveToken` is an internal endpoint called by the Gateway only. It receives a raw JWT string and returns the corresponding `idAccount`. It is never exposed directly to the browser.

### 2.3 Install

Install the interface to the local Maven repository so `auth-service` can depend on it:

``` bash
mvn clean install
```

---

Done! The `auth` interface is ready. In the next section we will implement `auth-service`, including the `JwtService` that signs and validates tokens, and `AuthService` that orchestrates login and registration.

[Open Routes](../open-routes/){ .md-button .md-button }
