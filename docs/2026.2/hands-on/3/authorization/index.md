The `gateway-service` is the **single entry point** for all requests. Beyond routing, it enforces authentication: before forwarding any request to a secured service, it checks for a valid JWT cookie and resolves the caller's identity. This is done through two components — `RouterValidator` and `AuthorizationFilter`.

## 1. How Authorization Works

The Gateway uses Spring Cloud Gateway's `GlobalFilter` mechanism. Every request passes through `AuthorizationFilter` before being routed. The filter follows this decision tree:

``` mermaid-sim
flowchart TD
    A[Incoming request] --> B{RouterValidator\nisSecured?}
    B -- No --> C[Forward to service]
    B -- Yes --> D{Cookie\n__store_jwt_token\npresent?}
    D -- No --> E[401 Unauthorized]
    D -- Yes --> F[POST /auth/solve\nwith JWT]
    F --> G{Valid token?}
    G -- No --> E
    G -- Yes --> H[Add id-account header]
    H --> C
```

When the token is valid, the filter enriches the downstream request with one header:

| Header | Value | Purpose |
|---|---|---|
| `id-account` | Account UUID from token (`jti`) | Services use this to identify the caller |

Before that, the Gateway **removes any `id-account` sent by the client** (`RemoveRequestHeader=id-account` in `default-filters`, which run before `AuthorizationFilter`): otherwise anyone could call a secured route pretending to be another account. The header that reaches the services can only come from the Gateway.

This means downstream microservices **never need to parse JWTs themselves** — the Gateway handles it and passes the resolved identity as a plain header.

## 2. Full Request Sequence

``` mermaid-sim
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
                            GatewayServiceApplication.java
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
| `GatewayServiceApplication` | Spring Boot entry point |
| `GatewayResource` | The Gateway's own `GET /health-check`; answers with the container's `HOSTNAME`, handy to see which replica answered |
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

The `application.yaml` defines the CORS policy, the default filters and the route table. Routes map URL patterns to upstream service hostnames (resolved inside the Docker Compose network):

``` yaml
default-filters:
  - RemoveRequestHeader=id-account
  - DedupeResponseHeader=Access-Control-Allow-Credentials Access-Control-Allow-Origin

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
                <relativePath/> <!-- lookup parent from repository -->
            </parent>

            <groupId>store</groupId>
            <artifactId>gateway-service</artifactId>
            <version>1.0.0</version>

            <properties>
                <java.version>25</java.version>
                <spring-cloud.version>2025.1.3</spring-cloud.version>
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

                  default-filters:
                    - RemoveRequestHeader=id-account
                    - DedupeResponseHeader=Access-Control-Allow-Credentials Access-Control-Allow-Origin

                  globalcors:
                    corsConfigurations:
                      '[/**]':
                        allowedOrigins: ${CORS_ALLOWED_ORIGINS:http://localhost,http://localhost:3000,http://localhost:8080}
                        allowedHeaders: "*"
                        allowedMethods: "*"
                        allowCredentials: true

                  routes:

                    - id: insper-service
                      uri: https://www.insper.edu.br
                      predicates:
                        - Path=/insper/**

                    - id: account-service
                      uri: http://account:8080
                      predicates:
                        - Path=/accounts/**

        logging:
          level:
            root: info
            store: debug
            org.springframework.web: debug
        ```

    === "GatewayServiceApplication.java"

        ``` { .java .copy .select linenums="1" }
        package store.gateway;

        import org.springframework.boot.SpringApplication;
        import org.springframework.boot.autoconfigure.SpringBootApplication;

        @SpringBootApplication
        public class GatewayServiceApplication {

            public static void main(String[] args) {
                SpringApplication.run(GatewayServiceApplication.class, args);
            }

        }
        ```

    === "GatewayResource.java"

        ``` { .java .copy .select linenums="1" }
        package store.gateway;

        import java.util.Map;

        import org.springframework.http.ResponseEntity;
        import org.springframework.web.bind.annotation.GetMapping;
        import org.springframework.web.bind.annotation.RestController;

        @RestController
        public class GatewayResource {

            @GetMapping("/health-check")
            public ResponseEntity<Map<String, String>> healthCheck() {
                // only the container's hostname: it tells which replica answered
                // (never return System.getenv(): it would expose every secret)
                return ResponseEntity.ok(Map.of(
                    "hostname", System.getenv().getOrDefault("HOSTNAME", "unknown")
                ));
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

        import org.slf4j.Logger;
        import org.slf4j.LoggerFactory;
        import org.springframework.beans.factory.annotation.Autowired;
        import org.springframework.cloud.gateway.filter.GatewayFilterChain;
        import org.springframework.cloud.gateway.filter.GlobalFilter;
        import org.springframework.http.HttpHeaders;
        import org.springframework.http.HttpStatus;
        import org.springframework.http.HttpStatusCode;
        import org.springframework.http.MediaType;
        import org.springframework.http.server.reactive.ServerHttpRequest;
        import org.springframework.stereotype.Component;
        import org.springframework.web.reactive.function.client.WebClient;
        import org.springframework.web.server.ResponseStatusException;
        import org.springframework.web.server.ServerWebExchange;

        import reactor.core.publisher.Mono;

        @Component
        public class AuthorizationFilter implements GlobalFilter {

            private static Logger logger = LoggerFactory.getLogger(AuthorizationFilter.class);

            public static String AUTH_COOKIE_TOKEN = "__store_jwt_token";
            public static String AUTH_SERVICE_TOKEN_SOLVE = "http://auth:8080/auth/solve";

            @Autowired
            private RouterValidator routerValidator;

            @Override
            public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {

                // get the request content
                final ServerHttpRequest request = exchange.getRequest();

                // check if the route is open
                if (!routerValidator.isSecured.test(request)) {
                    logger.debug("this route is open");
                    return chain.filter(exchange);
                }

                // route is not open
                // check if the cookie exists
                if (request.getCookies().containsKey(AUTH_COOKIE_TOKEN)) {
                    logger.debug("I got the cookie");
                    // get cookie value that is the jwt
                    String token = request.getCookies().getFirst(AUTH_COOKIE_TOKEN).getValue();
                    if (null != token && token.length() > 0) {
                        logger.debug("Cookie is not empty");
                        return requestAuthTokenSolve(exchange, chain, token.trim());
                    }
                }

                // error by default
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
            }

            private Mono<Void> requestAuthTokenSolve(
                ServerWebExchange exchange,
                GatewayFilterChain chain,
                final String jwt) {

                return WebClient.builder()
                    .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                    .build()
                    .post()
                    .uri(AUTH_SERVICE_TOKEN_SOLVE)
                    .bodyValue(Map.of("token", jwt))
                    .retrieve()
                    // auth answers 401 for an invalid or expired token: keep it a 401
                    .onStatus(HttpStatusCode::is4xxClientError, response -> Mono.error(
                        new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid token")))
                    .toEntity(Map.class)
                    .flatMap(response -> {
                        if (response != null && response.hasBody() && response.getBody() != null) {
                            final Map<String, String> map = response.getBody();
                            logger.debug(map.toString());
                            String idAccount = map.get("idAccount");
                            logger.debug("header before update: " + exchange.getRequest().getHeaders().toString());
                            ServerWebExchange authorized = updateRequest(exchange, idAccount, jwt);
                            logger.debug("header after update: " + authorized.getRequest().getHeaders().toString());
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
                            // .header("Authorization", "Bearer " + jwt)
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

!!! warning "Health check: expose only what you need"

    `/health-check` is the Gateway's own endpoint, not a route, so `AuthorizationFilter` does not run on it — anyone can call it. Answer only what it needs (here, the hostname); returning `System.getenv()` would expose every environment variable, secrets included.

!!! note "Invalid token → `401`"

    `retrieve()` turns an error answer from `/auth/solve` into an exception, and an unhandled exception in the Gateway is a `500`. The `onStatus(...)` maps the `401` of an invalid or expired token to a `401` at the Gateway, so the front end knows it must log in again.

## 4. Updating Docker Compose

Add the `auth` service to the `compose.yaml` of [Hands-on 2](../../2/index.md). Like `account`, it publishes no port: only the Gateway is reachable from outside, while `account` and `auth` are reached only inside the Compose network, by their service names — the trusted layer.

``` { .yaml .copy .select linenums="1" }
name: store

services:

  db:
    image: postgres:17
    volumes:
      - ${VOLUME_DB}:/var/lib/postgresql/data
    environment:
      POSTGRES_USER: ${DB_USER:-store}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-store}
      POSTGRES_DB: ${DB_NAME:-store}

  account:
    build:
      context: ./account-service
      dockerfile: Dockerfile
    environment:
      DATABASE_HOST: db
      DATABASE_PORT: 5432
      DATABASE_DB: ${DB_NAME:-store}
      DATABASE_USERNAME: ${DB_USER:-store}
      DATABASE_PASSWORD: ${DB_PASSWORD:-store}
    deploy:
      replicas: 1
    depends_on:
      - db

  auth:
    build:
      context: ./auth-service
      dockerfile: Dockerfile

  gateway:
    build:
      context: ./gateway-service
      dockerfile: Dockerfile
    ports:
      - 8080:8080
    deploy:
      replicas: 1
```

`auth` and `gateway` need no variables to run on your machine: `auth`'s `application.yaml` reads `JWT_SECRET_KEY`, `JWT_HTTP_ONLY` and `JWT_DURATION` with development defaults, and the Gateway reads `CORS_ALLOWED_ORIGINS` (default `http://localhost,http://localhost:3000,http://localhost:8080`).

!!! warning "JWT_SECRET_KEY outside development"

    The default key in `application.yaml` is public — it is in the repository — so anyone could forge tokens for a deployment that keeps it. Generate a key of your own, with 256 bits (32 random bytes, Base64-encoded):

    ``` bash
    openssl rand -base64 32
    ```

    and hand it to `auth` from the environment — e.g. in `compose.yaml`, with the value in a `.env` file that is never committed:

    ``` yaml
      auth:
        environment:
          JWT_SECRET_KEY: ${JWT_SECRET_KEY}
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
