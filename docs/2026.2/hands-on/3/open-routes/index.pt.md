O módulo `auth-service` é a **implementação executável** do microsserviço de autenticação. Ele expõe os endpoints definidos em `auth`, cuida da geração de JWT via `JwtService` e delega o gerenciamento de contas ao microsserviço `account` via Feign. O componente `RouterValidator` — também apresentado aqui — é a peça que diz ao Gateway quais rotas exigem autenticação e quais são abertas a todos.

## 1. Rotas abertas vs. rotas protegidas

Nem todo endpoint exige autenticação. O cadastro e o login precisam ser públicos — caso contrário, os usuários nunca conseguiriam se autenticar. Todas as outras rotas são protegidas: elas exigem um cookie JWT válido.

O `RouterValidator` codifica essa política como um predicado simples:

``` mermaid-sim
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
| `POST` | `/auth/login` | Autenticar e receber um cookie JWT |
| `GET` | `/auth/logout` | Apagar o cookie JWT |

Todo o resto — inclusive todos os endpoints `/accounts/**` — exige um cookie válido.

## 2. O módulo `auth-service`

### 2.1 Repositório

Crie um novo repositório git para o serviço de autenticação e adicione-o como submódulo:

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
- *Lombok* — redução de código repetitivo em tempo de compilação
- *OpenFeign* — suporte a clientes Feign para chamar o `account-service`

Além disso, adicione manualmente a biblioteca [JJWT](https://github.com/jwtk/jjwt){target="_blank"} ao `pom.xml` para criar e interpretar JWTs.

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

| Classe | Descrição |
|---|---|
| `AuthApplication` | Ponto de entrada do Spring Boot; habilita os clientes Feign do pacote `store.account` |
| `AuthResource` | Controller REST que implementa `AuthController`; define o cookie JWT no login/logout |
| `AuthService` | Lógica de negócio: delega o cadastro e a conferência das credenciais ao `account` e chama o `JwtService` para gerar tokens |
| `JwtService` | Encapsula a biblioteca JJWT; assina e interpreta JWTs com uma chave secreta HMAC |
| `AuthParser` | Converte o DTO `RegisterIn` no objeto interno `Register` |
| `Register` | Dados internos de cadastro (nome, e-mail, senha) entregues ao `AuthService.create` |

### 2.3 Conferindo as credenciais no `account`

O `auth-service` nunca confere uma senha por conta própria. Essa conferência pertence ao `account`: ele é o único serviço que guarda a senha, e guarda apenas o seu hash SHA-256 (campo `hashPassword`, coluna `hash_password`, calculado por `AccountService.calcHash` no `create`). Por isso, o contrato do `account` do [Hands-on 1](../../1/repository/) ganha uma operação — `POST /accounts/login` (`AccountController.login`); adicione as partes abaixo ao `account` e ao `account-service`. O `account-service` calcula o hash da senha recebida com o **mesmo** `calcHash` e procura uma conta com aquele e-mail **e** aquele hash, pela query derivada do Spring Data `findByEmailAndHashPassword`. Ele responde `200` com o `AccountOut` (nunca o hash) ou `401 Unauthorized`. A senha só trafega dentro da camada confiável — exatamente como já acontece no `POST /accounts` durante o cadastro — e o hash nunca sai do `account`.

!!! example "Código-fonte"

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

!!! warning "Credenciais erradas são `401`, não `500`"

    Um `.orElseThrow()` sem argumento lança `NoSuchElementException` quando nenhuma conta confere, e o Spring responde `500 Internal Server Error` — como se o servidor estivesse quebrado. Passe a exceção a lançar: `.orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, ...))`. Do outro lado, o Feign transforma esse `401` em uma `FeignException.Unauthorized` dentro do `auth-service` (e o `400` de uma senha vazia em uma `FeignException.BadRequest`); o `AuthService.login` (abaixo) as captura e responde `401` — senão o login voltaria a falhar com `500`.

!!! note "Reinstale a biblioteca `account`"

    O `AccountController` fica no módulo de interface `account`, então rode `mvn clean install` em `api/account` de novo antes de compilar o `account-service` e o `auth-service`.

!!! info "Uma observação sobre o hash"

    Um SHA-256 simples mantém o curso enxuto, mas é rápido e não usa salt, então hashes vazados são fáceis de quebrar por força bruta. Sistemas em produção usam um algoritmo lento e com salt, como **bcrypt** ou **Argon2** (por exemplo, o `PasswordEncoder` do Spring Security, que confere com `matches(raw, hash)` em vez de buscar no banco pelo hash).

### 2.4 O JwtService em detalhe

O `JwtService` é responsável por duas coisas:

**Gerar um token** (`generate`): ele monta um JWT com o `id` da conta na claim `jti`, o `name` da conta como `subject` e o `email` como claim personalizada. O token é assinado com uma chave HMAC derivada do segredo codificado em base64 e expira após a duração configurada (`store.jwt.duration`, em milissegundos — 1 hora por padrão).

**Validar um token** (`getId`): o parser do JJWT verifica a assinatura e também recusa um token prematuro (`nbf`) ou expirado (`exp`), lançando uma `JwtException` (`SignatureException`, `PrematureJwtException`, `ExpiredJwtException`, …). O `getId` transforma qualquer uma delas em `401 Unauthorized` — sem o `catch`, um cookie apenas expirado terminaria em `500`. Se o token for válido, devolve o `id` da conta (`jti`).

``` mermaid-sim
sequenceDiagram
    autonumber
    actor User as Usuário
    User->>+AuthResource: POST /auth/login (LoginIn)
    AuthResource->>+AuthService: login(email, password)
    AuthService->>+AccountController: POST /accounts/login (AccountIn)
    AccountController-->>-AuthService: AccountOut (ou 401)
    AuthService->>+JwtService: generate(AccountOut, duration)
    JwtService-->>-AuthService: string JWT assinada
    AuthService-->>-AuthResource: string JWT assinada
    AuthResource->>-User: Set-Cookie: __store_jwt_token=<jwt>
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

## 3. Segurança do cookie

O JWT é entregue ao navegador em um cookie `HttpOnly` chamado `__store_jwt_token`. Usar um cookie `HttpOnly`, em vez de guardar o token no `localStorage`, impede que o JavaScript o leia, o que mitiga ataques de [XSS](https://owasp.org/www-community/attacks/xss/){target="_blank"}.

Outros atributos do cookie usados:

| Atributo | Valor | Finalidade |
|---|---|---|
| `HttpOnly` | `true` | O JavaScript não consegue acessar o cookie |
| `Secure` | `true` | O cookie só é enviado por HTTPS |
| `SameSite` | `None` | O cookie é enviado em requisições cross-site (necessário para frontends SPA) |
| `Path` | `/` | O cookie vale para todos os caminhos |

!!! warning "SameSite=None exige Secure=true"

    Os navegadores rejeitam cookies `SameSite=None` sem o atributo `Secure`. Isso significa que o frontend e a API precisam se comunicar por HTTPS em produção.

---

Pronto! O `auth-service` está pronto. Na próxima seção vamos implementar o filtro do Gateway que intercepta cada requisição, extrai o cookie e pede ao `auth-service` que resolva o token.

[Autorização](../authorization/){ .md-button .md-button }
