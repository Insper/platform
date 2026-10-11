The first step in building the security layer is understanding **JSON Web Tokens (JWT)** and creating the `auth` interface module that defines the API contract for authentication.

## 1. JSON Web Token

JWT is a compact, URL-safe way to represent claims between two parties. It is the standard used by the platform to carry the authenticated user's identity across services without storing server-side session state — making it naturally compatible with horizontal scalability.

A JWT consists of three Base64Url-encoded parts separated by dots.

!!! example "Example JWT"

    ```
    eyJhbGciOiJIUzI1NiJ9.eyJqdGkiOiI1ZjNjOWEyZS04YjFkLTRjN2EtOWU2Zi0yYTRiOGMxZDNlNWYiLCJpc3MiOiJJbnNwZXI
    6OlBNQSIsImVtYWlsIjoiYWNtZUBpbnNwZXIuZWR1LmJyIiwic3ViIjoiQW50b25pbyBkbyBFc3R1ZG8iLCJuYmYiOjE3ODc1NzY
    0MDAsImV4cCI6MTc4NzU4MDAwMH0.KeKkcoXFaiijMekCSRk8rUrh69RXEzOZmP1U23MIb0E
    ```

    === "Header"

        ```json
        {
            "alg": "HS256"
        }
        ```

        The header declares the signing algorithm (`alg`) and may declare the token type (`typ`). JJWT, the library used by the platform, writes only `alg` unless told otherwise — the example above is exactly what `JwtService` produces.

    === "Payload (Claims)"

        ```json
        {
            "jti": "5f3c9a2e-8b1d-4c7a-9e6f-2a4b8c1d3e5f",
            "iss": "Insper::PMA",
            "email": "acme@insper.edu.br",
            "sub": "Antonio do Estudo",
            "nbf": 1787576400,
            "exp": 1787580000
        }
        ```

        The payload contains the claims. Claims are statements about an entity (typically, the user) and additional data. There are three types of claims: registered, public, and private claims. Registered claims are a set of predefined claims which are not mandatory but recommended, to provide a set of useful, interoperable claims. Some examples are `iss` (issuer), `exp` (expiration time), `sub` (subject), and `aud` (audience). Public claims can be defined at will by those using JWTs. To avoid collisions they should be defined in the IANA JSON Web Token Registry or be defined as a URI that contains a collision resistant namespace. Private claims are the custom claims created to share information between parties that agree on using them and are neither registered nor public claims.

    === "Signature"

        ```
        HMACSHA256(
            base64UrlEncode(header) + "." +
            base64UrlEncode(payload),
            Base64.decode(JWT_SECRET_KEY)   // 32 bytes = 256 bits
        )
        ```

        To create the signature part, you take the encoded header, the encoded payload, a secret, the algorithm specified in the header, and sign that.

        `HS256` is HMAC with SHA-256 and needs a key of at least 256 bits. In the platform, `JwtService.getKey()` returns `Keys.hmacShaKeyFor(Base64.getDecoder().decode(secretKey))`: the key is the **Base64-decoded** `store.jwt.secretKey` (environment variable `JWT_SECRET_KEY`), 32 bytes — generate one with `openssl rand -base64 32`. `signWith(key)` lets JJWT pick the algorithm from the key size: 256 bits → `HS256` (a 384-bit key would give `HS384`, a 512-bit key `HS512`; a key under 256 bits is rejected with a `WeakKeyException`). The example token above was signed this way with the development default of `application.yaml` — paste it into [jwt.io](https://jwt.io/){target="_blank"} with that secret (marked as Base64) to check the signature.

!!! warning "Secret Key"

    The secret key used to sign the JWT must be kept confidential. Anyone with access to it can forge tokens. The `application.yaml` of `auth-service` reads it from the environment variable `JWT_SECRET_KEY` and ships a **development** default only so the stack runs out of the box — that default is public (it is in the repository), so outside your machine always set `JWT_SECRET_KEY` with a key of your own and **never hardcode** a real one in source code.

The key claims used in this platform are:

| Claim | Field | Description |
|---|---|---|
| `jti` | `id` | The account's unique identifier |
| `sub` | `subject` | The account's name |
| `iss` | `issuer` | The issuing platform |
| `nbf` | `notBefore` | Token becomes valid at this timestamp |
| `exp` | `expiration` | Token expires at this timestamp |
| `email` | `claims(Map.of("email", …))` | A private claim: the account's email |

After a successful login, the server generates a JWT, sets it in an `HttpOnly` cookie, and returns it to the browser. For every subsequent request, the browser sends the cookie automatically — the Gateway reads it and resolves the identity without asking the user to log in again.

``` mermaid-sim
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
        <project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
            xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
            <modelVersion>4.0.0</modelVersion>
            <parent>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-starter-parent</artifactId>
                <version>4.1.0</version>
            </parent>
            <groupId>store</groupId>
            <artifactId>auth</artifactId>
            <version>1.0.0</version>

            <properties>
                <java.version>25</java.version>
                <spring-cloud.version>2025.1.3</spring-cloud.version>
                <maven.compiler.proc>full</maven.compiler.proc>
            </properties>

            <dependencies>
                <dependency>
                    <groupId>org.springframework.cloud</groupId>
                    <artifactId>spring-cloud-starter-openfeign</artifactId>
                </dependency>

                <dependency>
                    <groupId>org.projectlombok</groupId>
                    <artifactId>lombok</artifactId>
                    <optional>true</optional>
                </dependency>
                <dependency>
                    <groupId>${project.groupId}</groupId>
                    <artifactId>account</artifactId>
                    <version>1.0.0</version>
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

            <build>
                <plugins>
                    <plugin>
                        <groupId>org.apache.maven.plugins</groupId>
                        <artifactId>maven-compiler-plugin</artifactId>
                        <configuration>
                            <annotationProcessorPaths>
                                <path>
                                    <groupId>org.projectlombok</groupId>
                                    <artifactId>lombok</artifactId>
                                </path>
                            </annotationProcessorPaths>
                            <source>${java.version}</source>
                            <target>${java.version}</target>
                            <release>${java.version}</release>
                        </configuration>
                    </plugin>
                </plugins>
            </build>

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

            public static final String AUTH_COOKIE_TOKEN = "__store_jwt_token";

            @PostMapping("/auth/register")
            public ResponseEntity<Void> create(
                @RequestBody RegisterIn in
            );

            @PostMapping("/auth/login")
            public ResponseEntity<Void> login(
                @RequestBody LoginIn in
            );

            @GetMapping("/auth/me")
            public ResponseEntity<AccountOut> me(
                @RequestHeader(value = "id-account", required = true) String idAccount
            );

            @PostMapping("/auth/solve")
            public ResponseEntity<Map<String, String>> solveToken(
                @RequestBody TokenOut map
            );

            @GetMapping("/auth/logout")
            public ResponseEntity<Void> logout();

            @GetMapping("/auth/health-check")
            public ResponseEntity<Void> healthCheck();

        }
        ```

    === "LoginIn.java"

        ``` { .java .copy .select linenums="1" }
        package store.auth;

        import lombok.Builder;
        import lombok.experimental.Accessors;

        @Builder
        @Accessors(fluent = true)
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
        import lombok.experimental.Accessors;

        @Builder
        @Accessors(fluent = true)
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
        import lombok.experimental.Accessors;

        @Builder
        @Accessors(fluent = true)
        public record TokenOut(

            String token

        ) {

        }
        ```

!!! note "The `/auth/solve` endpoint"

    `solveToken` is an internal endpoint meant for the Gateway: it receives a raw JWT string and returns the corresponding `idAccount`. It is not an open route, so the browser cannot use it without a valid cookie. `me` (`GET /auth/me`) returns the logged-in account: the Gateway fills the `id-account` header from the token.

### 2.3 Install

Install the interface to the local Maven repository so `auth-service` can depend on it:

``` bash
mvn clean install
```

---

Done! The `auth` interface is ready. In the next section we will implement `auth-service`, including the `JwtService` that signs and validates tokens, and `AuthService` that orchestrates login and registration.

[Open Routes](../open-routes/){ .md-button .md-button }
