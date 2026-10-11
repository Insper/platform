The `auth-service` module is the **runnable implementation** of the Auth microservice. It exposes the endpoints defined in `auth`, handles JWT generation via `JwtService`, and delegates account management to the `account` microservice via Feign. The `RouterValidator` component — also introduced here — is the piece that tells the Gateway which routes require authentication and which are open to everyone.

## 1. Open vs. Secured Routes

Not every endpoint requires authentication. Registration and login must be publicly accessible — otherwise, users could never authenticate in the first place. All other routes are secured: they require a valid JWT cookie.

The `RouterValidator` encodes this policy as a simple predicate:

``` mermaid-sim
flowchart LR
    request[Incoming Request]
    open{Is open route?}
    secured[Proceed to filter]
    forward[Forward request]

    request --> open
    open -- Yes --> forward
    open -- No --> secured
    secured --> forward
```

The open routes defined in this platform are:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/auth/register` | Create a new account |
| `POST` | `/auth/login` | Authenticate and receive a JWT cookie |
| `GET` | `/auth/logout` | Clear the JWT cookie |

Everything else — including all `/accounts/**` endpoints — requires a valid cookie.

## 2. The `auth-service` Module

### 2.1 Repository

Create a new git repository for the auth service and add it as a submodule:

``` bash
git submodule add <repository_url> api/auth-service
```

``` tree
api/
    account/
    account-service/
    auth/
    auth-service/
```

### 2.2 Code

Use [Spring Initializr](https://start.spring.io/){target="_blank"} to generate a Maven project with the following settings:

- **Group:** `store`
- **Artifact:** `auth-service`
- **Package name:** `store.auth`
- **Packaging:** Jar
- **Java:** 25

Dependencies to add:

- *Spring Web* — REST controller support
- *Lombok* — compile-time boilerplate reduction
- *OpenFeign* — Feign client support for calling `account-service`

Additionally, add the [JJWT](https://github.com/jwtk/jjwt){target="_blank"} library manually to `pom.xml` for JWT creation and parsing.

The resulting structure is:

``` tree
api/
    auth-service/
        src/
            main/
                java/
                    store/
                        auth/
                            AuthApplication.java
                            AuthParser.java
                            AuthResource.java
                            AuthService.java
                            JwtService.java
                            Register.java
                resources/
                    application.yaml
        pom.xml
        Dockerfile
```

| Class | Description |
|---|---|
| `AuthApplication` | Spring Boot entry point; enables Feign clients from the `store.account` package |
| `AuthResource` | REST controller implementing `AuthController`; sets the JWT cookie on login/logout |
| `AuthService` | Business logic: delegates registration and the credential check to `account`, calls `JwtService` to generate tokens |
| `JwtService` | Wraps the JJWT library; signs and parses JWTs using an HMAC secret key |
| `AuthParser` | Converts the `RegisterIn` DTO into the internal `Register` object |
| `Register` | Internal registration data (name, email, password) handed to `AuthService.create` |

### 2.3 Checking credentials in `account`

`auth-service` never checks a password itself. The check belongs to `account`: it is the only service that stores the password, and it stores only its SHA-256 hash (field `hashPassword`, column `hash_password`, computed by `AccountService.calcHash` on `create`). So the `account` contract from [Hands-on 1](../../1/repository/) gains one operation — `POST /accounts/login` (`AccountController.login`); add the pieces below to `account` and `account-service`. `account-service` hashes the received password with the **same** `calcHash` and looks for an account with that email **and** that hash, through the Spring Data derived query `findByEmailAndHashPassword`. It answers `200` with the `AccountOut` (never the hash) or `401 Unauthorized`. The password travels only inside the trusted layer — exactly as it already does on `POST /accounts` during registration — and the hash never leaves `account`.

!!! example "Source"

    === "AccountController.java"

        ``` { .java .copy .select linenums="1" }
        // account: AccountController (interface module)
        @PostMapping("/accounts/login")
        public ResponseEntity<AccountOut> login(
            @RequestBody AccountIn in
        );
        ```

    === "AccountRepository.java"

        ``` { .java .copy .select linenums="1" }
        package store.account;

        import java.util.List;
        import java.util.Optional;

        import org.springframework.data.repository.CrudRepository;

        public interface AccountRepository extends CrudRepository<AccountModel, String> {

            List<AccountModel> findAll();

            // Implementa JPQL
            // https://docs.spring.io/spring-data/jpa/reference/jpa/query-methods.html
            Optional<AccountModel> findByEmailAndHashPassword(
                String email,
                String hashPassword
            );

        }
        ```

    === "AccountService.java"

        ``` { .java .copy .select linenums="1" }
        // account-service: AccountService (calcHash already exists)
        public Account findByEmailAndPassword(String email, String password) {

            if (password == null || password.isEmpty()) {
                throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "Password is empty"
                );
            }

            final String hash = calcHash(password);
            return accountRepository.findByEmailAndHashPassword(email, hash)
                .map(AccountModel::to)
                .orElseThrow(() -> new ResponseStatusException(
                    HttpStatus.UNAUTHORIZED, "Invalid credentials"
                ));

        }
        ```

    === "AccountResource.java"

        ``` { .java .copy .select linenums="1" }
        // account-service: AccountResource
        @Override
        public ResponseEntity<AccountOut> login(AccountIn in) {
            return ResponseEntity
                .ok(AccountParser.to(
                    accountService.findByEmailAndPassword(in.email(), in.password())
                ));
        }
        ```

!!! warning "Wrong credentials are a `401`, not a `500`"

    A bare `.orElseThrow()` throws `NoSuchElementException` when no account matches, and Spring answers `500 Internal Server Error` — as if the server were broken. Pass the exception to throw: `.orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, ...))`. On the other side, Feign turns that `401` into a `FeignException.Unauthorized` inside `auth-service` (and the `400` of an empty password into a `FeignException.BadRequest`); `AuthService.login` (below) catches them and answers `401`, otherwise the login would fail with `500` again.

!!! note "Reinstall the `account` library"

    `AccountController` lives in the `account` interface module, so run `mvn clean install` in `api/account` again before building `account-service` and `auth-service`.

!!! info "A note on the hash"

    A plain SHA-256 keeps the course simple, but it is fast and unsalted, so leaked hashes are easy to brute-force. Production systems use a slow, salted algorithm such as **bcrypt** or **Argon2** (e.g. Spring Security's `PasswordEncoder`, which verifies with `matches(raw, hash)` instead of a database lookup by hash).

### 2.4 JwtService in detail

`JwtService` is responsible for two things:

**Generating a token** (`generate`): it builds a JWT with the account's `id` as the `jti` claim, the account's `name` as `subject`, and the `email` as a custom claim. The token is signed with an HMAC key derived from the base64-encoded secret, and it expires after the configured duration (`store.jwt.duration`, in milliseconds — 1 hour by default).

**Validating a token** (`getId`): the JJWT parser verifies the signature and also rejects a token that is premature (`nbf`) or expired (`exp`), throwing a `JwtException` (`SignatureException`, `PrematureJwtException`, `ExpiredJwtException`, …). `getId` turns any of them into `401 Unauthorized` — without the `catch`, a merely expired cookie would end in `500`. If the token is valid, it returns the account's `id` (`jti`).

``` mermaid-sim
sequenceDiagram
    autonumber
    actor User
    User->>+AuthResource: POST /auth/login (LoginIn)
    AuthResource->>+AuthService: login(email, password)
    AuthService->>+AccountController: POST /accounts/login (AccountIn)
    AccountController-->>-AuthService: AccountOut (or 401)
    AuthService->>+JwtService: generate(AccountOut, duration)
    JwtService-->>-AuthService: signed JWT string
    AuthService-->>-AuthResource: signed JWT (String)
    AuthResource->>-User: Set-Cookie: __store_jwt_token=<jwt>
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
                <version>4.1.1</version>
            </parent>
            <groupId>store</groupId>
            <artifactId>auth-service</artifactId>
            <version>1.0.0</version>

            <properties>
                <java.version>25</java.version>
                <spring-cloud.version>2025.1.3</spring-cloud.version>
                <maven.compiler.proc>full</maven.compiler.proc>
            </properties>

            <dependencies>
                <dependency>
                    <groupId>org.springframework.boot</groupId>
                    <artifactId>spring-boot-starter-webmvc</artifactId>
                </dependency>
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
                    <artifactId>auth</artifactId>
                    <version>1.0.0</version>
                </dependency>
                <dependency>
                    <groupId>store</groupId>
                    <artifactId>account</artifactId>
                    <version>1.0.0</version>
                </dependency>


                <!-- JJWT -->
                <dependency>
                    <groupId>io.jsonwebtoken</groupId>
                    <artifactId>jjwt-api</artifactId>
                    <version>[0.13,)</version>
                </dependency>
                <dependency>
                    <groupId>io.jsonwebtoken</groupId>
                    <artifactId>jjwt-impl</artifactId>
                    <version>[0.13,)</version>
                    <scope>runtime</scope>
                </dependency>
                <dependency>
                    <groupId>io.jsonwebtoken</groupId>
                    <artifactId>jjwt-jackson</artifactId>
                    <version>[0.13,)</version>
                    <scope>runtime</scope>
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
                        <groupId>org.springframework.boot</groupId>
                        <artifactId>spring-boot-maven-plugin</artifactId>
                    </plugin>
                    <plugin>
                        <groupId>org.apache.maven.plugins</groupId>
                        <artifactId>maven-compiler-plugin</artifactId>
                        <executions>
                            <execution>
                                <id>default-compile</id>
                                <phase>compile</phase>
                                <goals>
                                    <goal>compile</goal>
                                </goals>
                                <configuration>
                                    <annotationProcessorPaths>
                                        <path>
                                            <groupId>org.projectlombok</groupId>
                                            <artifactId>lombok</artifactId>
                                        </path>
                                    </annotationProcessorPaths>
                                </configuration>
                            </execution>
                            <execution>
                                <id>default-testCompile</id>
                                <phase>test-compile</phase>
                                <goals>
                                    <goal>testCompile</goal>
                                </goals>
                                <configuration>
                                    <annotationProcessorPaths>
                                        <path>
                                            <groupId>org.projectlombok</groupId>
                                            <artifactId>lombok</artifactId>
                                        </path>
                                    </annotationProcessorPaths>
                                </configuration>
                            </execution>
                        </executions>
                    </plugin>
                </plugins>
            </build>

        </project>
        ```

    === "application.yaml"

        ``` { .yaml .copy .select linenums="1" }
        spring:
          application:
            name: auth

        store:
          jwt:
            secretKey: ${JWT_SECRET_KEY:EBwrdOOcAIDRLON9hbJV0+O3PTdfTjgMCQIxwLH7ws8=}
            httpOnly: ${JWT_HTTP_ONLY:true}
            duration: ${JWT_DURATION:3600000} # 1 hour in milliseconds
        ```

    === "AuthApplication.java"

        ``` { .java .copy .select linenums="1" }
        package store.auth;

        import org.springframework.boot.SpringApplication;
        import org.springframework.boot.autoconfigure.SpringBootApplication;
        import org.springframework.cloud.openfeign.EnableFeignClients;

        @SpringBootApplication
        @EnableFeignClients(basePackages = {
            "store.account"
        })
        public class AuthApplication {

            public static void main(String[] args) {
                SpringApplication.run(AuthApplication.class, args);
            }

        }
        ```

    === "AuthParser.java"

        ``` { .java .copy .select linenums="1" }
        package store.auth;

        public final class AuthParser {

            public static Register to(RegisterIn in) {
                return in == null ? null :
                    Register.builder()
                        .name(in.name())
                        .email(in.email())
                        .password(in.password())
                        .build();
            }

        }
        ```

    === "AuthResource.java"

        ``` { .java .copy .select linenums="1" }
        package store.auth;

        import java.time.Duration;
        import java.util.Map;

        import org.springframework.beans.factory.annotation.Autowired;
        import org.springframework.http.HttpHeaders;
        import org.springframework.http.ResponseCookie;
        import org.springframework.http.ResponseEntity;
        import org.springframework.web.bind.annotation.RestController;

        import store.account.AccountOut;

        @RestController
        public class AuthResource implements AuthController {

            @Autowired
            private AuthService authService;

            @Override
            public ResponseEntity<Void> create(RegisterIn in) {
                final Register register = AuthParser.to(in);
                authService.create(register);
                return ResponseEntity.ok().build();
            }

            @Override
            public ResponseEntity<Void> login(LoginIn in) {
                final String token = authService.login(in.email(), in.password());
                return ResponseEntity
                    .ok()
                    .header(
                        HttpHeaders.SET_COOKIE,
                        buildTokenCookie(AuthController.AUTH_COOKIE_TOKEN, token, authService.getDuration()).toString()
                    )
                    .build();
            }

            @Override
            public ResponseEntity<AccountOut> me(String idAccount) {
                return ResponseEntity.ok(authService.me(idAccount));
            }

            @Override
            public ResponseEntity<Void> logout() {
                return ResponseEntity
                    .ok()
                    .header(
                        HttpHeaders.SET_COOKIE,
                        buildTokenCookie(
                            AuthController.AUTH_COOKIE_TOKEN,
                            null,
                            0l
                        ).toString()
                    )
                    .build();
            }

            @Override
            public ResponseEntity<Void> healthCheck() {
                return ResponseEntity.ok().build();
            }

            @Override
            public ResponseEntity<Map<String, String>> solveToken(TokenOut map) {
                return ResponseEntity.ok(authService.solve(map.token()));
            }

            private ResponseCookie buildTokenCookie(String alias, String content, Long duration) {
                return ResponseCookie.from(alias, content)
                    .httpOnly(authService.getHttpOnly())
                    .sameSite("None")
                    .secure(true)
                    .path("/")
                    .maxAge(Duration.ofMillis(duration))
                    .build();
            }

        }
        ```

    === "AuthService.java"

        ``` { .java .copy .select linenums="1" }
        package store.auth;

        import java.util.Map;

        import org.springframework.beans.factory.annotation.Autowired;
        import org.springframework.beans.factory.annotation.Value;
        import org.springframework.http.HttpStatus;
        import org.springframework.stereotype.Service;
        import org.springframework.web.server.ResponseStatusException;

        import feign.FeignException;
        import store.account.AccountController;
        import store.account.AccountIn;
        import store.account.AccountOut;

        @Service
        public class AuthService {

            @Autowired
            private AccountController accountController;

            @Autowired
            private JwtService jwtService;

            @Value("${store.jwt.duration}")
            private Long duration;

            @Value("${store.jwt.httpOnly}")
            private Boolean httpOnly;

            public void create(Register register) {

                accountController.create(
                    AccountIn.builder()
                        .name(register.name())
                        .email(register.email())
                        .password(register.password())
                        .build()
                );

            }

            public String login(String email, String password) {
                final AccountOut account;
                try {
                    // account hashes the password and compares it with the stored hash
                    account = accountController.login(
                        AccountIn.builder().email(email).password(password).build()
                    ).getBody();
                } catch (FeignException.Unauthorized | FeignException.BadRequest e) {
                    throw new ResponseStatusException(
                        HttpStatus.UNAUTHORIZED, "Invalid credentials"
                    );
                }
                return jwtService.generate(account, getDuration());
            }

            public long getDuration() {
                return duration;
            }

            public boolean getHttpOnly() {
                return httpOnly;
            }

            public Map<String, String> solve(final String jwt) {
                return Map.of(
                    "idAccount", jwtService.getId(jwt)
                );
            }

            public AccountOut me(String idAccount) {
                return accountController.findById(idAccount).getBody();
            }

        }
        ```

    === "JwtService.java"

        ``` { .java .copy .select linenums="1" }
        package store.auth;

        import java.util.Base64;
        import java.util.Date;
        import java.util.Map;

        import javax.crypto.SecretKey;

        import org.springframework.beans.factory.annotation.Value;
        import org.springframework.http.HttpStatus;
        import org.springframework.stereotype.Service;
        import org.springframework.web.server.ResponseStatusException;

        import io.jsonwebtoken.Claims;
        import io.jsonwebtoken.JwtException;
        import io.jsonwebtoken.JwtParser;
        import io.jsonwebtoken.Jwts;
        import io.jsonwebtoken.security.Keys;
        import store.account.AccountOut;

        @Service
        public class JwtService {

            @Value("${store.jwt.secretKey}")
            private String secretKey;

            public String generate(AccountOut account, long duration) {

                Date now = new Date();
                return Jwts.builder()
                    .header().and()
                    .id(account.id())
                    .issuer("Insper::PMA")
                    .claims(Map.of("email", account.email()))
                    .signWith(getKey())
                    .subject(account.name())
                    .notBefore(now)
                    .expiration(new Date(now.getTime() + duration))
                    .compact();
            }

            private SecretKey getKey() {
                return Keys.hmacShaKeyFor(Base64.getDecoder().decode(secretKey));
            }

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

        }
        ```

    === "Register.java"

        ``` { .java .copy .select linenums="1" }
        package store.auth;

        import lombok.Builder;
        import lombok.Data;
        import lombok.experimental.Accessors;

        @Builder @Data
        @Accessors(fluent = true)
        public class Register {

            private String id;
            private String name;
            private String email;
            private String password;
            private String hashPassword;

        }
        ```

    === "Dockerfile"

        ``` { .dockerfile .copy .select linenums="1" }
        FROM eclipse-temurin:25
        VOLUME /tmp
        COPY target/*.jar /app.jar
        ENTRYPOINT ["java", "-jar", "/app.jar"]
        ```

## 3. Cookie Security

The JWT is delivered to the browser as an `HttpOnly` cookie named `__store_jwt_token`. Using an `HttpOnly` cookie instead of storing the token in `localStorage` prevents JavaScript from reading it, which mitigates [XSS](https://owasp.org/www-community/attacks/xss/){target="_blank"} attacks.

Additional cookie flags used:

| Flag | Value | Purpose |
|---|---|---|
| `HttpOnly` | `true` | JavaScript cannot access the cookie |
| `Secure` | `true` | Cookie is only sent over HTTPS |
| `SameSite` | `None` | Cookie is sent on cross-site requests (needed for SPA frontends) |
| `Path` | `/` | Cookie applies to all paths |

!!! warning "SameSite=None requires Secure=true"

    Browsers reject `SameSite=None` cookies without the `Secure` flag. This means the frontend and the API must communicate over HTTPS in production.

---

Done! The `auth-service` is ready. In the next section we will implement the Gateway filter that intercepts every request, extracts the cookie, and asks `auth-service` to resolve the token.

[Authorization](../authorization/){ .md-button .md-button }
