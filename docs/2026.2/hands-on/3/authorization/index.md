The `gateway-service` is the **single entry point** for all requests. Beyond routing, it enforces authentication: before forwarding any request to a secured service, it checks for a valid JWT cookie and resolves the caller's identity. This is done through two components — `RouterValidator` and `AuthorizationFilter`.

## 1. How Authorization Works

The Gateway uses Spring Cloud Gateway's `GlobalFilter` mechanism. Every request passes through `AuthorizationFilter` before being routed. The filter follows this decision tree:

``` mermaid
flowchart TD
    A[Incoming request] --> B{RouterValidator\nisSecured?}
    B -- No --> C[Forward to service]
    B -- Yes --> D{Cookie\n__store_jwt_token\npresent?}
    D -- No --> E[401 Unauthorized]
    D -- Yes --> F[POST /auth/solve\nwith JWT]
    F --> G{Valid token?}
    G -- No --> E
    G -- Yes --> H[Add id-account header\nAdd Authorization header]
    H --> C
```

When the token is valid, the filter enriches the downstream request with two headers:

| Header | Value | Purpose |
|---|---|---|
| `id-account` | Account UUID from token | Services use this to identify the caller |
| `Authorization` | `Bearer <jwt>` | Standard bearer token for downstream services |

This means downstream microservices **never need to parse JWTs themselves** — the Gateway handles it and passes the resolved identity as a plain header.

## 2. Full Request Sequence

``` mermaid
sequenceDiagram
  autonumber
  actor User
  User->>+Gateway: request with cookie __store_jwt_token
  Gateway->>+AuthorizationFilter: filter(exchange, chain)
  AuthorizationFilter->>RouterValidator: isSecured.test(request)
  RouterValidator-->>AuthorizationFilter: true
  AuthorizationFilter->>AuthorizationFilter: read cookie value
  AuthorizationFilter->>+Auth Service: POST /auth/solve (token)
  Auth Service->>Auth Service: JwtService.getId(token)
  Auth Service-->>-AuthorizationFilter: { idAccount: "..." }
  AuthorizationFilter->>AuthorizationFilter: mutate request headers
  AuthorizationFilter->>-Gateway: chain.filter(mutated exchange)
  Gateway->>-User: service response
```

## 3. The `gateway-service` Module

### 3.1 Repository

Create a new git repository for the gateway service and add it as a submodule:

``` bash
git submodule add <repository_url> api/gateway-service
```

``` tree
api/
    account/
    account-service/
    auth/
    auth-service/
    gateway-service/
```

### 3.2 Code

Use [Spring Initializr](https://start.spring.io/){target="_blank"} to generate a Maven project with the following settings:

- **Group:** `store`
- **Artifact:** `gateway-service`
- **Package name:** `store.gateway`
- **Packaging:** Jar
- **Java:** 25

Dependencies to add:

- *Gateway* (`spring-cloud-starter-gateway-server-webflux`) — reactive gateway with routing and filter support
- *Reactive Web* (`spring-boot-starter-webflux`) — reactive stack required by Spring Cloud Gateway
- *Lombok* — compile-time boilerplate reduction

!!! note "Reactive stack"

    Spring Cloud Gateway runs on **Project Reactor** (WebFlux), not on the traditional servlet stack. This is why `AuthorizationFilter` returns `Mono<Void>` instead of `void`, and why the HTTP client inside it uses `WebClient` instead of `RestTemplate`.

The resulting structure is:

``` tree
api/
    gateway-service/
        src/
            main/
                java/
                    store/
                        gateway/
                            GatewayApplication.java
                            GatewayResource.java
                            security/
                                AuthorizationFilter.java
                                RouterValidator.java
                resources/
                    application.yaml
        pom.xml
        Dockerfile
```

| Class | Description |
|---|---|
| `GatewayApplication` | Spring Boot entry point |
| `GatewayResource` | Minimal REST controller; exposes a root health-check endpoint |
| `RouterValidator` | Holds the list of open routes; provides an `isSecured` predicate |
| `AuthorizationFilter` | Global filter; validates the JWT cookie and enriches the request |

### 3.3 RouterValidator in detail

`RouterValidator` defines which routes bypass authentication. It stores them as `"METHOD /path"` strings and exposes an `isSecured` predicate. A request matches an open route if the HTTP method and path both match (with optional `/**` wildcard support).

``` java
private List<String> openApiEndpoints = List.of(
    "POST /auth/register",
    "GET /auth/logout",
    "POST /auth/login"
);
```

Any request **not** matching this list returns `true` from `isSecured`, meaning the filter will require a valid cookie.

### 3.4 Application configuration

The `application.yaml` defines the CORS policy and the route table. Routes map URL patterns to upstream service hostnames (resolved inside the Docker Compose network):

``` yaml
routes:
  - id: accounts
    uri: http://account:8080
    predicates:
      - Path=/accounts/**

  - id: auth
    uri: http://auth:8080
    predicates:
      - Path=/auth/**
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
            <artifactId>gateway-service</artifactId>
            <version>1.0.0</version>

            <properties>
                <java.version>25</java.version>
                <spring-cloud.version>2025.1.0</spring-cloud.version>
                <maven.compiler.proc>full</maven.compiler.proc>
            </properties>

            <dependencies>
                <dependency>
                    <groupId>org.springframework.boot</groupId>
                    <artifactId>spring-boot-starter-webflux</artifactId>
                </dependency>
                <dependency>
                    <groupId>org.springframework.cloud</groupId>
                    <artifactId>spring-cloud-starter-gateway-server-webflux</artifactId>
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
        spring:
          application:
            name: gateway

          cloud:
            gateway:
              server:
                webflux:

                  globalcors:
                    corsConfigurations:
                      '[/**]':
                        allowedOrigins: ${CORS_ALLOWED_ORIGINS}
                        allowedHeaders: "*"
                        allowedMethods: "*"
                        allowCredentials: ${CORS_ALLOWED_CREDENTIALS}

                  routes:

                    - id: insper
                      uri: https://www.insper.edu.br
                      predicates:
                        - Path=/insper/**

                    - id: accounts
                      uri: http://account:8080
                      predicates:
                        - Path=/accounts/**

                    - id: auth
                      uri: http://auth:8080
                      predicates:
                        - Path=/auth/**

        logging:
          level:
            root: info
            store: debug
            org.springframework.web: debug
        ```

    === "GatewayApplication.java"

        ``` { .java .copy .select linenums="1" }
        package store.gateway;

        import org.springframework.boot.SpringApplication;
        import org.springframework.boot.autoconfigure.SpringBootApplication;

        @SpringBootApplication
        public class GatewayApplication {

            public static void main(String[] args) {
                SpringApplication.run(GatewayApplication.class, args);
            }

        }
        ```

    === "GatewayResource.java"

        ``` { .java .copy .select linenums="1" }
        package store.gateway;

        import org.springframework.http.ResponseEntity;
        import org.springframework.web.bind.annotation.GetMapping;
        import org.springframework.web.bind.annotation.RestController;

        @RestController
        public class GatewayResource {

            @GetMapping("/")
            public ResponseEntity<String> hello() {
                return ResponseEntity.ok("Store API");
            }

            @GetMapping("/health-check")
            public ResponseEntity<Void> healthCheck() {
                return ResponseEntity.ok().build();
            }

        }
        ```

    === "RouterValidator.java"

        ``` { .java .copy .select linenums="1" }
        package store.gateway.security;

        import java.util.List;
        import java.util.function.Predicate;

        import org.springframework.http.server.reactive.ServerHttpRequest;
        import org.springframework.stereotype.Component;

        @Component
        public class RouterValidator {

            private List<String> openApiEndpoints = List.of(
                    "POST /auth/register",
                    "GET /auth/logout",
                    "POST /auth/login");

            public Predicate<ServerHttpRequest> isSecured = request -> openApiEndpoints
                    .stream()
                    .noneMatch(uri -> {
                        String[] parts = uri.replaceAll("[^a-zA-Z0-9// *]", "").split(" ");
                        final String method = parts[0];
                        final String path = parts[1];
                        final boolean deep = path.endsWith("/**");
                        return ("ANY".equalsIgnoreCase(method) || request.getMethod().toString().equalsIgnoreCase(method))
                                && (request.getURI().getPath().equals(path)
                                        || (deep && request.getURI().getPath().startsWith(path.replace("/**", ""))));
                    });

        }
        ```

    === "AuthorizationFilter.java"

        ``` { .java .copy .select linenums="1" }
        package store.gateway.security;

        import java.util.Map;

        import org.springframework.beans.factory.annotation.Autowired;
        import org.springframework.cloud.gateway.filter.GatewayFilterChain;
        import org.springframework.cloud.gateway.filter.GlobalFilter;
        import org.springframework.http.HttpHeaders;
        import org.springframework.http.HttpStatus;
        import org.springframework.http.MediaType;
        import org.springframework.http.server.reactive.ServerHttpRequest;
        import org.springframework.stereotype.Component;
        import org.springframework.web.reactive.function.client.WebClient;
        import org.springframework.web.server.ResponseStatusException;
        import org.springframework.web.server.ServerWebExchange;

        import reactor.core.publisher.Mono;

        @Component
        public class AuthorizationFilter implements GlobalFilter {

            public static String AUTH_COOKIE_TOKEN = "__store_jwt_token";
            public static String AUTH_SERVICE_TOKEN_SOLVE = "http://auth:8080/auth/solve";

            @Autowired
            private RouterValidator routerValidator;

            @Override
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

            private Mono<Void> requestAuthTokenSolve(ServerWebExchange exchange, GatewayFilterChain chain, String jwt) {
                return WebClient.builder()
                    .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                    .build()
                    .post()
                    .uri(AUTH_SERVICE_TOKEN_SOLVE)
                    .bodyValue(Map.of("token", jwt))
                    .retrieve()
                    .toEntity(Map.class)
                    .flatMap(response -> {
                        if (response != null && response.hasBody() && response.getBody() != null) {
                            final Map<String, String> map = response.getBody();
                            String idAccount = map.get("idAccount");
                            ServerWebExchange authorized = updateRequest(exchange, idAccount, jwt);
                            return chain.filter(authorized);
                        } else {
                            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid token");
                        }
                    });
            }

            private ServerWebExchange updateRequest(ServerWebExchange exchange, String idAccount, String jwt) {
                return exchange.mutate()
                    .request(
                        exchange.getRequest()
                            .mutate()
                            .header("id-account", idAccount)
                            .header("Authorization", "Bearer " + jwt)
                            .build()
                    ).build();
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

## 4. Updating Docker Compose

Add the `auth` and `gateway` services to `compose.yaml`. Note the dependency chain: `db` → `account` → `auth` → `gateway`:

``` { .yaml .copy .select linenums="1" }
name: store

services:

  db:
    image: postgres:17
    hostname: db
    ports:
      - 5432:5432
    volumes:
      - ${VOLUME_DB}:/var/lib/postgresql/data
    environment:
      POSTGRES_USER: ${DB_USER:-store}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-devpass}
      POSTGRES_DB: ${DB_NAME:-store}

  account:
    build:
      context: ./account-service
      dockerfile: Dockerfile
    hostname: account
    environment:
      DATABASE_HOST: db
      DATABASE_PORT: 5432
      DATABASE_DB: ${DB_NAME:-store}
      DATABASE_USERNAME: ${DB_USER:-store}
      DATABASE_PASSWORD: ${DB_PASSWORD:-devpass}
    deploy:
      replicas: 1
    depends_on:
      - db

  auth:
    build:
      context: ./auth-service
      dockerfile: Dockerfile
    hostname: auth
    deploy:
      replicas: 1
    environment:
      JWT_SECRET_KEY: ${JWT_SECRET_KEY}
      JWT_HTTP_ONLY: ${JWT_HTTP_ONLY:-true}
    depends_on:
      - account

  gateway:
    build:
      context: ./gateway-service
      dockerfile: Dockerfile
    hostname: gateway
    environment:
      CORS_ALLOWED_CREDENTIALS: ${CORS_ALLOWED_CREDENTIALS:-true}
      CORS_ALLOWED_ORIGINS: ${CORS_ALLOWED_ORIGINS}
    ports:
      - 8080:8080
```

Add the new variables to `.env`:

``` { .bash .copy }
JWT_SECRET_KEY=jYCiN0YPiaBP53bGJi/kjfw79HW7xnBu9UPoD/QFFAE=
JWT_HTTP_ONLY=true
CORS_ALLOWED_CREDENTIALS=true
CORS_ALLOWED_ORIGINS=http://localhost:3000
```

!!! warning "JWT_SECRET_KEY in production"

    Generate a proper secret with at least 256 bits of entropy. Never reuse the example key above in a real environment.

    ``` bash
    openssl rand -base64 32
    ```

## 5. Testing the Security Layer

Start the platform:

``` bash
docker compose up -d --build
```

**Register a new user:**

``` bash
curl -X POST http://localhost:8080/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name": "Antonio do Estudo", "email": "acme@insper.edu.br", "password": "123@321"}'
```

**Login and capture the cookie:**

``` bash
curl -c cookies.txt -X POST http://localhost:8080/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "acme@insper.edu.br", "password": "123@321"}'
```

**Access a secured endpoint using the cookie:**

``` bash
curl -b cookies.txt http://localhost:8080/accounts
```

**Access without the cookie — expect 401:**

``` bash
curl http://localhost:8080/accounts
```

---

Done! The security layer is complete. Every request to a secured route now passes through the Gateway, which validates the JWT cookie with `auth-service` and forwards the resolved identity to downstream services — without any service needing to parse tokens themselves.
