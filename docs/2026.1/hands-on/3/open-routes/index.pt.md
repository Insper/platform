O módulo `auth-service` é a **implementação executável** do microsserviço Auth. Ele expõe os endpoints definidos em `auth`, trata a geração de JWT por meio do `JwtService` e delega o gerenciamento de contas ao microsserviço `account` via Feign. O componente `RouterValidator` — também apresentado aqui — é a peça que diz ao Gateway quais rotas exigem autenticação e quais são abertas a todos.

## 1. Rotas abertas vs. rotas protegidas

Nem todo endpoint exige autenticação. O cadastro e o login precisam ser acessíveis publicamente — caso contrário, os usuários nunca conseguiriam se autenticar. Todas as outras rotas são protegidas: elas exigem um cookie com um JWT válido.

O `RouterValidator` codifica essa política como um predicado simples:

``` mermaid
flowchart LR
    request[Requisição recebida]
    open{É rota aberta?}
    secured[Segue para o filtro]
    forward[Encaminha a requisição]

    request --> open
    open -- Sim --> forward
    open -- Não --> secured
    secured --> forward
```

As rotas abertas definidas nesta plataforma são:

| Método | Caminho | Finalidade |
|---|---|---|
| `POST` | `/auth/register` | Criar uma nova conta |
| `POST` | `/auth/login` | Autenticar-se e receber um cookie com o JWT |
| `GET` | `/auth/logout` | Limpar o cookie com o JWT |

Todo o resto — incluindo todos os endpoints `/accounts/**` — exige um cookie válido.

## 2. O módulo `auth-service`

### 2.1 Repositório

Crie um novo repositório git para o serviço auth e adicione-o como submódulo:

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

### 2.2 Código

Use o [Spring Initializr](https://start.spring.io/){target="_blank"} para gerar um projeto Maven com as seguintes configurações:

- **Group:** `store`
- **Artifact:** `auth-service`
- **Package name:** `store.auth`
- **Packaging:** Jar
- **Java:** 25

Dependências a adicionar:

- *Spring Web* — suporte a controllers REST
- *Lombok* — redução de código repetitivo (boilerplate) em tempo de compilação
- *OpenFeign* — suporte a clientes Feign para chamar o `account-service`

Além disso, adicione manualmente a biblioteca [JJWT](https://github.com/jwtk/jjwt){target="_blank"} ao `pom.xml`, para a criação e a leitura de JWTs.

A estrutura resultante é:

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

| Classe | Descrição |
|---|---|
| `AuthApplication` | Ponto de entrada do Spring Boot; habilita os clientes Feign do pacote `store.account` |
| `AuthResource` | Controller REST que implementa `AuthController`; define o cookie com o JWT no login/logout |
| `AuthService` | Lógica de negócio: delega o cadastro ao `account` e chama o `JwtService` para gerar os tokens |
| `JwtService` | Encapsula a biblioteca JJWT; assina e lê JWTs usando uma chave secreta HMAC |

### 2.3 O JwtService em detalhe

O `JwtService` é responsável por duas coisas:

**Gerar um token** (`generate`): ele monta um JWT com o `id` da conta na claim `jti`, o `name` da conta como `subject` e o `email` como uma claim personalizada. O token é assinado com uma chave HMAC derivada do segredo codificado em base64 e expira depois da duração configurada (em milissegundos).

**Validar um token** (`getId`): ele lê o token e verifica a assinatura e, em seguida, confere se o token não é prematuro (`nbf`) nem está expirado (`exp`). Se for válido, retorna o `id` da conta.

``` mermaid
sequenceDiagram
    autonumber
    actor User
    User->>+AuthResource: POST /auth/login (LoginIn)
    AuthResource->>+AuthService: login(email, password)
    AuthService->>+AccountController: findByEmailAndPassword(AccountIn)
    AccountController-->>-AuthService: AccountOut
    AuthService->>+JwtService: generate(AccountOut, duration)
    JwtService-->>-AuthService: string do JWT assinado
    AuthService-->>-AuthResource: TokenOut
    AuthResource->>-User: Set-Cookie: __store_jwt_token=<jwt>
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

## 3. Segurança do cookie

O JWT é entregue ao navegador como um cookie `HttpOnly` chamado `__store_jwt_token`. Usar um cookie `HttpOnly` em vez de armazenar o token no `localStorage` impede que o JavaScript o leia, o que mitiga ataques de [XSS](https://owasp.org/www-community/attacks/xss/){target="_blank"}.

Outras flags de cookie usadas:

| Flag | Valor | Finalidade |
|---|---|---|
| `HttpOnly` | `true` | O JavaScript não consegue acessar o cookie |
| `Secure` | `true` | O cookie só é enviado via HTTPS |
| `SameSite` | `None` | O cookie é enviado em requisições cross-site (necessário para frontends SPA) |
| `Path` | `/` | O cookie vale para todos os caminhos |

!!! warning "SameSite=None exige Secure=true"

    Os navegadores rejeitam cookies `SameSite=None` sem a flag `Secure`. Isso significa que o frontend e a API precisam se comunicar via HTTPS em produção.

---

Pronto! O `auth-service` está pronto. Na próxima seção, vamos implementar o filtro do Gateway que intercepta cada requisição, extrai o cookie e pede ao `auth-service` que resolva o token.

[Autorização](../authorization/){ .md-button .md-button }
