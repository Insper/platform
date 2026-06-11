The `auth-service` module is the **runnable implementation** of the Auth microservice. It exposes the endpoints defined in `auth`, handles JWT generation via `JwtService`, and delegates account management to the `account` microservice via Feign. The `RouterValidator` component — also introduced here — is the piece that tells the Gateway which routes require authentication and which are open to everyone.

## 1. Open vs. Secured Routes

Not every endpoint requires authentication. Registration and login must be publicly accessible — otherwise, users could never authenticate in the first place. All other routes are secured: they require a valid JWT cookie.

The `RouterValidator` encodes this policy as a simple predicate:

``` mermaid
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
                            AuthResource.java
                            AuthService.java
                            JwtService.java
                resources/
                    application.yaml
        pom.xml
        Dockerfile
```

| Class | Description |
|---|---|
| `AuthApplication` | Spring Boot entry point; enables Feign clients from the `store.account` package |
| `AuthResource` | REST controller implementing `AuthController`; sets the JWT cookie on login/logout |
| `AuthService` | Business logic: delegates registration to `account`, calls `JwtService` to generate tokens |
| `JwtService` | Wraps the JJWT library; signs and parses JWTs using an HMAC secret key |

### 2.3 JwtService in detail

`JwtService` is responsible for two things:

**Generating a token** (`generate`): it builds a JWT with the account's `id` as the `jti` claim, the account's `name` as `subject`, and the `email` as a custom claim. The token is signed with an HMAC key derived from the base64-encoded secret, and it expires after the configured duration (milliseconds).

**Validating a token** (`getId`): it parses and verifies the signature, then checks that the token is neither premature (`nbf`) nor expired (`exp`). If valid, it returns the account's `id`.

``` mermaid
sequenceDiagram
    autonumber
    actor User
    User->>+AuthResource: POST /auth/login (LoginIn)
    AuthResource->>+AuthService: login(email, password)
    AuthService->>+AccountController: findByEmailAndPassword(AccountIn)
    AccountController-->>-AuthService: AccountOut
    AuthService->>+JwtService: generate(AccountOut, duration)
    JwtService-->>-AuthService: signed JWT string
    AuthService-->>-AuthResource: TokenOut
    AuthResource->>-User: Set-Cookie: __store_jwt_token=<jwt>
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
            <artifactId>auth-service</artifactId>
            <version>1.0.0</version>
            <name>auth-service</name>

            <properties>
                <java.version>25</java.version>
                <spring-cloud.version>2025.1.0</spring-cloud.version>
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
                    <groupId>store</groupId>
                    <artifactId>auth</artifactId>
                    <version>${project.version}</version>
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
                        <groupId>org.apache.maven.plugins</groupId>
                        <artifactId>maven-compiler-plugin</artifactId>
                        <configuration>
                            <annotationProcessorPaths>
                                <path>
                                    <groupId>org.projectlombok</groupId>
                                    <artifactId>lombok</artifactId>
                                </path>
                            </annotationProcessorPaths>
                        </configuration>
                    </plugin>
                    <plugin>
                        <groupId>org.springframework.boot</groupId>
                        <artifactId>spring-boot-maven-plugin</artifactId>
                        <configuration>
                            <excludes>
                                <exclude>
                                    <groupId>org.projectlombok</groupId>
                                    <artifactId>lombok</artifactId>
                                </exclude>
                            </excludes>
                        </configuration>
                    </plugin>
                </plugins>
            </build>
        </project>
        ```

    === "application.yaml"

        ``` { .yaml .copy .select linenums="1" }
        server:
          port: 8080

        spring:
          application:
            name: auth

        store:
          jwt:
            secretKey: ${JWT_SECRET_KEY}
            duration: 86400000 # 24 hours in milliseconds
            httpOnly: ${JWT_HTTP_ONLY}

        logging:
          level:
            root: info
            store: debug
            org.springframework.web: debug
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
            public ResponseEntity<Void> login(LoginIn in) {
                final TokenOut out = authService.login(in.email(), in.password());
                return ResponseEntity
                    .ok()
                    .header(
                        HttpHeaders.SET_COOKIE,
                        buildTokenCookie(out.token(), authService.getDuration()).toString()
                    )
                    .build();
            }

            @Override
            public ResponseEntity<Void> logout() {
                return ResponseEntity
                    .ok()
                    .header(
                        HttpHeaders.SET_COOKIE,
                        buildTokenCookie(null, 0l).toString()
                    )
                    .build();
            }

            @Override
            public ResponseEntity<Void> register(RegisterIn in) {
                authService.register(in);
                return ResponseEntity.created(null).build();
            }

            @Override
            public ResponseEntity<AccountOut> whoIAm(String idAccount) {
                return ResponseEntity.ok(authService.whoIAm(idAccount));
            }

            @Override
            public ResponseEntity<Void> healthCheck() {
                return ResponseEntity.ok().build();
            }

            private ResponseCookie buildTokenCookie(String content, Long duration) {
                return ResponseCookie.from(AuthController.AUTH_COOKIE_TOKEN, content)
                    .httpOnly(authService.getHttpOnly())
                    .sameSite("None")
                    .secure(true)
                    .path("/")
                    .maxAge(Duration.ofMillis(duration))
                    .build();
            }

            @Override
            public ResponseEntity<Map<String, String>> solveToken(TokenOut map) {
                final String idAccount = authService.solveToken(map.token());
                return ResponseEntity.ok(Map.of("idAccount", idAccount));
            }

        }
        ```

    === "AuthService.java"

        ``` { .java .copy .select linenums="1" }
        package store.auth;

        import org.springframework.beans.factory.annotation.Autowired;
        import org.springframework.beans.factory.annotation.Value;
        import org.springframework.stereotype.Service;

        import store.account.AccountController;
        import store.account.AccountIn;
        import store.account.AccountOut;

        @Service
        public class AuthService {

            @Value("${store.jwt.duration}")
            private Long duration;

            @Value("${store.jwt.httpOnly}")
            private Boolean httpOnly;

            @Autowired
            private AccountController accountController;

            @Autowired
            private JwtService jwtService;

            public void register(RegisterIn in) {
                accountController.create(AccountIn.builder()
                    .name(in.name())
                    .email(in.email())
                    .password(in.password())
                    .build()
                );
            }

            public TokenOut login(String email, String password) {
                final AccountOut account = accountController.findByEmailAndPassword(
                    AccountIn.builder()
                        .email(email)
                        .password(password)
                        .build()
                ).getBody();

                return TokenOut.builder()
                    .token(jwtService.generate(account, duration))
                    .build();
            }

            public Long getDuration() { return duration; }
            public Boolean getHttpOnly() { return httpOnly; }

            public String solveToken(String token) {
                return jwtService.getId(token);
            }

            public AccountOut whoIAm(String idAccount) {
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
                JwtParser parser = Jwts.parser().verifyWith(getKey()).build();
                Claims claims = parser.parseSignedClaims(jwt).getPayload();
                Date now = new Date();
                if (claims.getNotBefore().after(now)) {
                    throw new ResponseStatusException(
                        HttpStatus.UNAUTHORIZED, "Token is not valid yet!");
                }
                if (claims.getExpiration().before(now)) {
                    throw new ResponseStatusException(
                        HttpStatus.UNAUTHORIZED, "Token is expired!");
                }
                return claims.getId();
            }

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
