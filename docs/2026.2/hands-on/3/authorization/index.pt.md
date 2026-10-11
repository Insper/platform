O `gateway-service` é o **ponto único de entrada** de todas as requisições. Além do roteamento, ele garante a autenticação: antes de encaminhar qualquer requisição a um serviço protegido, verifica se há um cookie JWT válido e resolve a identidade de quem fez a chamada. Isso é feito por dois componentes — `RouterValidator` e `AuthorizationFilter`.

## 1. Como a autorização funciona

O Gateway usa o mecanismo de `GlobalFilter` do Spring Cloud Gateway. Toda requisição passa pelo `AuthorizationFilter` antes de ser roteada. O filtro segue esta árvore de decisão:

``` mermaid-sim
flowchart TD
    A[Requisição recebida] --> B{RouterValidator\nisSecured?}
    B -- Não --> C[Encaminha ao serviço]
    B -- Sim --> D{Cookie\n__store_jwt_token\npresente?}
    D -- Não --> E[401 Unauthorized]
    D -- Sim --> F[POST /auth/solve\ncom o JWT]
    F --> G{Token válido?}
    G -- Não --> E
    G -- Sim --> H[Adiciona o header id-account]
    H --> C
```

Quando o token é válido, o filtro enriquece a requisição repassada com um header:

| Header | Valor | Finalidade |
|---|---|---|
| `id-account` | UUID da conta, extraído do token (`jti`) | Os serviços o usam para identificar quem chamou |

Antes disso, o Gateway **remove qualquer `id-account` enviado pelo cliente** (`RemoveRequestHeader=id-account` em `default-filters`, que rodam antes do `AuthorizationFilter`): senão qualquer pessoa poderia chamar uma rota protegida se passando por outra conta. O header que chega aos serviços só pode vir do Gateway.

Isso significa que os microsserviços seguintes **nunca precisam interpretar JWTs por conta própria** — o Gateway cuida disso e repassa a identidade já resolvida em um header simples.

## 2. Sequência completa da requisição

``` mermaid-sim
sequenceDiagram
  autonumber
  actor User as Usuário
  User->>+Gateway: requisição com o cookie __store_jwt_token
  Gateway->>+AuthorizationFilter: filter(exchange, chain)
  AuthorizationFilter->>RouterValidator: isSecured.test(request)
  RouterValidator-->>AuthorizationFilter: true
  AuthorizationFilter->>AuthorizationFilter: lê o valor do cookie
  AuthorizationFilter->>+Auth Service: POST /auth/solve (token)
  Auth Service->>Auth Service: JwtService.getId(token)
  Auth Service-->>-AuthorizationFilter: { idAccount: "..." }
  AuthorizationFilter->>AuthorizationFilter: altera os headers da requisição
  AuthorizationFilter->>-Gateway: chain.filter(exchange alterado)
  Gateway->>-User: resposta do serviço
```

## 3. O módulo `gateway-service`

### 3.1 Repositório

Crie um novo repositório git para o serviço de gateway e adicione-o como submódulo:

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

!!! note "Stack reativa"

    O Spring Cloud Gateway roda sobre o **Project Reactor** (WebFlux), e não sobre a stack tradicional de servlets. É por isso que o `AuthorizationFilter` devolve `Mono<Void>` em vez de `void`, e que o cliente HTTP dentro dele usa `WebClient` em vez de `RestTemplate`.

A estrutura resultante é:

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

| Classe | Descrição |
|---|---|
| `GatewayServiceApplication` | Ponto de entrada do Spring Boot |
| `GatewayResource` | O `GET /health-check` do próprio Gateway; responde com o `HOSTNAME` do container, útil para ver qual réplica respondeu |
| `RouterValidator` | Guarda a lista de rotas abertas; oferece o predicado `isSecured` |
| `AuthorizationFilter` | Filtro global; valida o cookie JWT e enriquece a requisição |

### 3.3 O RouterValidator em detalhe

O `RouterValidator` define quais rotas dispensam autenticação. Ele as guarda como strings `"METHOD /path"` e expõe o predicado `isSecured`. Uma requisição corresponde a uma rota aberta se o método HTTP e o caminho coincidem (com suporte opcional ao curinga `/**`).

``` java
private List<String> openApiEndpoints = List.of(
    "POST /auth/register",
    "GET /auth/logout",
    "POST /auth/login"
);
```

Qualquer requisição que **não** esteja nesta lista faz `isSecured` devolver `true`, ou seja, o filtro vai exigir um cookie válido.

### 3.4 Configuração da aplicação

O `application.yaml` define a política de CORS, os filtros padrão e a tabela de rotas. As rotas associam padrões de URL aos hostnames dos serviços de destino (resolvidos dentro da rede do Docker Compose):

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

!!! example "Código-fonte"

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

!!! warning "Health check: exponha só o necessário"

    O `/health-check` é um endpoint do próprio Gateway, não uma rota, então o `AuthorizationFilter` não roda nele — qualquer pessoa pode chamá-lo. Responda só o que ele precisa (aqui, o hostname); devolver `System.getenv()` exporia todas as variáveis de ambiente, segredos inclusive.

!!! note "Token inválido → `401`"

    O `retrieve()` transforma uma resposta de erro do `/auth/solve` em exceção, e uma exceção não tratada no Gateway vira `500`. O `onStatus(...)` converte o `401` de um token inválido ou expirado em `401` no Gateway, para o front end saber que precisa fazer login de novo.

## 4. Atualizando o Docker Compose

Adicione o serviço `auth` ao `compose.yaml` do [Hands-on 2](../../2/index.md). Como o `account`, ele não publica porta: só o Gateway é acessível de fora, enquanto `account` e `auth` são alcançados apenas dentro da rede do Compose, pelos nomes dos serviços — a camada confiável.

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

`auth` e `gateway` não precisam de variáveis para rodar na sua máquina: o `application.yaml` do `auth` lê `JWT_SECRET_KEY`, `JWT_HTTP_ONLY` e `JWT_DURATION` com valores padrão de desenvolvimento, e o Gateway lê `CORS_ALLOWED_ORIGINS` (padrão `http://localhost,http://localhost:3000,http://localhost:8080`).

!!! warning "JWT_SECRET_KEY fora do desenvolvimento"

    A chave padrão do `application.yaml` é pública — está no repositório —, então qualquer pessoa conseguiria forjar tokens para uma implantação que a mantenha. Gere uma chave sua, com 256 bits (32 bytes aleatórios, codificados em Base64):

    ``` bash
    openssl rand -base64 32
    ```

    e entregue-a ao `auth` pelo ambiente — por exemplo, no `compose.yaml`, com o valor em um arquivo `.env` que nunca é commitado:

    ``` yaml
      auth:
        environment:
          JWT_SECRET_KEY: ${JWT_SECRET_KEY}
    ```

## 5. Testando a camada de segurança

Suba a plataforma:

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

Pronto! A camada de segurança está completa. Toda requisição a uma rota protegida agora passa pelo Gateway, que valida o cookie JWT com o `auth-service` e repassa a identidade resolvida aos serviços seguintes — sem que nenhum serviço precise interpretar tokens por conta própria.
