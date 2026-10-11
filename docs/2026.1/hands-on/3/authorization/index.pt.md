O `gateway-service` é o **ponto de entrada único** de todas as requisições. Além de rotear, ele exige a autenticação: antes de encaminhar qualquer requisição a um serviço protegido, ele verifica se há um cookie com um JWT válido e resolve a identidade de quem está chamando. Isso é feito por dois componentes — `RouterValidator` e `AuthorizationFilter`.

## 1. Como a autorização funciona

O Gateway usa o mecanismo de `GlobalFilter` do Spring Cloud Gateway. Toda requisição passa pelo `AuthorizationFilter` antes de ser roteada. O filtro segue esta árvore de decisão:

``` mermaid
flowchart TD
    A[Requisição recebida] --> B{RouterValidator\nisSecured?}
    B -- Não --> C[Encaminha ao serviço]
    B -- Sim --> D{Cookie\n__store_jwt_token\npresente?}
    D -- Não --> E[401 Unauthorized]
    D -- Sim --> F[POST /auth/solve\ncom o JWT]
    F --> G{Token válido?}
    G -- Não --> E
    G -- Sim --> H[Adiciona o header id-account\nAdiciona o header Authorization]
    H --> C
```

Quando o token é válido, o filtro enriquece a requisição encaminhada aos serviços downstream com dois headers:

| Header | Valor | Finalidade |
|---|---|---|
| `id-account` | UUID da conta, vindo do token | Os serviços o usam para identificar quem está chamando |
| `Authorization` | `Bearer <jwt>` | Bearer token padrão para os serviços downstream |

Isso significa que os microsserviços downstream **nunca precisam ler JWTs por conta própria** — o Gateway cuida disso e repassa a identidade resolvida como um header simples.

## 2. Sequência completa da requisição

``` mermaid
sequenceDiagram
  autonumber
  actor User
  User->>+Gateway: requisição com o cookie __store_jwt_token
  Gateway->>+AuthorizationFilter: filter(exchange, chain)
  AuthorizationFilter->>RouterValidator: isSecured.test(request)
  RouterValidator-->>AuthorizationFilter: true
  AuthorizationFilter->>AuthorizationFilter: lê o valor do cookie
  AuthorizationFilter->>+Auth Service: POST /auth/solve (token)
  Auth Service->>Auth Service: JwtService.getId(token)
  Auth Service-->>-AuthorizationFilter: { idAccount: "..." }
  AuthorizationFilter->>AuthorizationFilter: altera os headers da requisição
  AuthorizationFilter->>-Gateway: chain.filter(mutated exchange)
  Gateway->>-User: resposta do serviço
```

## 3. O módulo `gateway-service`

### 3.1 Repositório

Crie um novo repositório git para o serviço gateway e adicione-o como submódulo:

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

### 3.2 Código

Use o [Spring Initializr](https://start.spring.io/){target="_blank"} para gerar um projeto Maven com as seguintes configurações:

- **Group:** `store`
- **Artifact:** `gateway-service`
- **Package name:** `store.gateway`
- **Packaging:** Jar
- **Java:** 25

Dependências a adicionar:

- *Gateway* (`spring-cloud-starter-gateway-server-webflux`) — gateway reativo com suporte a roteamento e filtros
- *Reactive Web* (`spring-boot-starter-webflux`) — stack reativa exigida pelo Spring Cloud Gateway
- *Lombok* — redução de código repetitivo (boilerplate) em tempo de compilação

!!! note "Stack reativa"

    O Spring Cloud Gateway roda sobre o **Project Reactor** (WebFlux), e não sobre a stack tradicional de servlets. É por isso que o `AuthorizationFilter` retorna `Mono<Void>` em vez de `void`, e que o cliente HTTP dentro dele usa `WebClient` em vez de `RestTemplate`.

A estrutura resultante é:

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

| Classe | Descrição |
|---|---|
| `GatewayApplication` | Ponto de entrada do Spring Boot |
| `GatewayResource` | Controller REST mínimo; expõe um endpoint de health check na raiz |
| `RouterValidator` | Guarda a lista de rotas abertas; fornece o predicado `isSecured` |
| `AuthorizationFilter` | Filtro global; valida o cookie com o JWT e enriquece a requisição |

### 3.3 O RouterValidator em detalhe

O `RouterValidator` define quais rotas dispensam a autenticação. Ele as armazena como strings no formato `"METHOD /path"` e expõe o predicado `isSecured`. Uma requisição corresponde a uma rota aberta se o método HTTP e o caminho coincidirem (com suporte opcional ao curinga `/**`).

``` java
private List<String> openApiEndpoints = List.of(
    "POST /auth/register",
    "GET /auth/logout",
    "POST /auth/login"
);
```

Qualquer requisição que **não** corresponda a essa lista faz `isSecured` retornar `true`, o que significa que o filtro vai exigir um cookie válido.

### 3.4 Configuração da aplicação

O `application.yaml` define a política de CORS e a tabela de rotas. As rotas mapeiam padrões de URL para os nomes de host dos serviços upstream (resolvidos dentro da rede do Docker Compose):

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

!!! example "Código-fonte"

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

## 4. Atualizando o Docker Compose

Adicione os serviços `auth` e `gateway` ao `compose.yaml`. Observe a cadeia de dependências: `db` → `account` → `auth` → `gateway`:

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

Adicione as novas variáveis ao `.env`:

``` { .bash .copy }
JWT_SECRET_KEY=jYCiN0YPiaBP53bGJi/kjfw79HW7xnBu9UPoD/QFFAE=
JWT_HTTP_ONLY=true
CORS_ALLOWED_CREDENTIALS=true
CORS_ALLOWED_ORIGINS=http://localhost:3000
```

!!! warning "JWT_SECRET_KEY em produção"

    Gere um segredo adequado, com pelo menos 256 bits de entropia. Nunca reutilize a chave de exemplo acima em um ambiente real.

    ``` bash
    openssl rand -base64 32
    ```

## 5. Testando a camada de segurança

Inicie a plataforma:

``` bash
docker compose up -d --build
```

**Cadastre um novo usuário:**

``` bash
curl -X POST http://localhost:8080/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name": "Antonio do Estudo", "email": "acme@insper.edu.br", "password": "123@321"}'
```

**Faça login e capture o cookie:**

``` bash
curl -c cookies.txt -X POST http://localhost:8080/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "acme@insper.edu.br", "password": "123@321"}'
```

**Acesse um endpoint protegido usando o cookie:**

``` bash
curl -b cookies.txt http://localhost:8080/accounts
```

**Acesse sem o cookie — espere um 401:**

``` bash
curl http://localhost:8080/accounts
```

---

Pronto! A camada de segurança está completa. Toda requisição a uma rota protegida agora passa pelo Gateway, que valida o cookie com o JWT junto ao `auth-service` e encaminha a identidade resolvida aos serviços downstream — sem que nenhum serviço precise ler tokens por conta própria.
