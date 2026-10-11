O primeiro passo para construir a camada de segurança é entender os **JSON Web Tokens (JWT)** e criar o módulo de interface `auth`, que define o contrato da API de autenticação.

## 1. JSON Web Token

O JWT é uma forma compacta e segura para URLs de representar declarações (claims) entre duas partes. É o padrão usado pela plataforma para transportar a identidade do usuário autenticado entre os serviços sem guardar estado de sessão no servidor — o que o torna naturalmente compatível com escalabilidade horizontal.

Um JWT é formado por três partes codificadas em Base64Url, separadas por pontos.

!!! example "Exemplo de JWT"

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

        O header declara o algoritmo de assinatura (`alg`) e pode declarar o tipo do token (`typ`). O JJWT, a biblioteca usada pela plataforma, só escreve o `alg`, a menos que se peça outra coisa — o exemplo acima é exatamente o que o `JwtService` produz.

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

        O payload contém as claims. Claims são declarações sobre uma entidade (normalmente, o usuário) e dados adicionais. Há três tipos de claims: registradas, públicas e privadas. As claims registradas são um conjunto de claims predefinidas, não obrigatórias, mas recomendadas, que oferecem um conjunto de claims úteis e interoperáveis. Alguns exemplos são `iss` (emissor), `exp` (instante de expiração), `sub` (assunto) e `aud` (público-alvo). As claims públicas podem ser definidas livremente por quem usa JWTs; para evitar colisões, elas devem ser registradas no IANA JSON Web Token Registry ou definidas como uma URI que contenha um namespace resistente a colisões. As claims privadas são claims personalizadas, criadas para compartilhar informações entre partes que concordam em usá-las, e não são nem registradas nem públicas.

    === "Signature"

        ```
        HMACSHA256(
            base64UrlEncode(header) + "." +
            base64UrlEncode(payload),
            Base64.decode(JWT_SECRET_KEY)   // 32 bytes = 256 bits
        )
        ```

        Para criar a assinatura, você pega o header codificado, o payload codificado, um segredo e o algoritmo indicado no header, e assina o conjunto.

        `HS256` é HMAC com SHA-256 e exige uma chave de pelo menos 256 bits. Na plataforma, `JwtService.getKey()` devolve `Keys.hmacShaKeyFor(Base64.getDecoder().decode(secretKey))`: a chave é a `store.jwt.secretKey` (variável de ambiente `JWT_SECRET_KEY`) **decodificada de Base64**, 32 bytes — gere uma com `openssl rand -base64 32`. O `signWith(key)` deixa o JJWT escolher o algoritmo pelo tamanho da chave: 256 bits → `HS256` (uma chave de 384 bits daria `HS384`; uma de 512 bits, `HS512`; uma chave com menos de 256 bits é recusada com `WeakKeyException`). O token de exemplo acima foi assinado assim, com o valor padrão de desenvolvimento do `application.yaml` — cole-o no [jwt.io](https://jwt.io/){target="_blank"} com esse segredo (marcado como Base64) para conferir a assinatura.

!!! warning "Chave secreta"

    A chave secreta usada para assinar o JWT deve ser mantida em sigilo. Quem tiver acesso a ela consegue forjar tokens. O `application.yaml` do `auth-service` a lê da variável de ambiente `JWT_SECRET_KEY` e traz um valor padrão **de desenvolvimento** só para a stack subir sem configuração — esse valor é público (está no repositório), então fora da sua máquina defina sempre a `JWT_SECRET_KEY` com uma chave sua e **nunca coloque fixa** uma chave real no código-fonte.

As principais claims usadas nesta plataforma são:

| Claim | Campo | Descrição |
|---|---|---|
| `jti` | `id` | Identificador único da conta |
| `sub` | `subject` | Nome da conta |
| `iss` | `issuer` | Plataforma emissora |
| `nbf` | `notBefore` | O token passa a valer a partir deste instante |
| `exp` | `expiration` | O token expira neste instante |
| `email` | `claims(Map.of("email", …))` | Uma claim privada: o e-mail da conta |

Após um login bem-sucedido, o servidor gera um JWT, coloca-o em um cookie `HttpOnly` e o devolve ao navegador. Em cada requisição seguinte, o navegador envia o cookie automaticamente — o Gateway o lê e resolve a identidade sem pedir que o usuário faça login de novo.

``` mermaid-sim
sequenceDiagram
  autonumber
  actor User as Usuário
  User->>+Auth Service: login (e-mail + senha)
  Auth Service->>Auth Service: valida as credenciais e gera o JWT
  Auth Service->>-User: Set-Cookie: __store_jwt_token=<jwt>
  User->>User: o navegador armazena o cookie
  User->>Gateway: as requisições seguintes levam o cookie automaticamente
```

## 2. O módulo de interface `auth`

O módulo `auth` segue o mesmo padrão do módulo `account`: é uma **biblioteca** (não uma aplicação executável) que define o contrato da API e os DTOs compartilhados entre o `auth-service` e qualquer outro microsserviço que precise chamar os endpoints de autenticação via Feign.

### 2.1 Repositório

Crie um novo repositório git para a interface de autenticação e adicione-o como submódulo:

``` bash
git submodule add <repository_url> api/auth
```

``` tree
api/
    account/
    account-service/
    auth/
```

### 2.2 Código

Use o [Spring Initializr](https://start.spring.io/){target="_blank"} para gerar um projeto Maven com as seguintes configurações:

- **Group:** `store`
- **Artifact:** `auth`
- **Package name:** `store.auth`
- **Packaging:** Jar
- **Java:** 25

Dependências a adicionar:

- *Lombok* — reduz código repetitivo com processamento de anotações em tempo de compilação
- *OpenFeign* — cliente HTTP declarativo para chamadas entre serviços

Apague `AuthApplication.java`, `src/test/` e `src/main/resources/` — este módulo é uma biblioteca, não um serviço executável.

A estrutura resultante é:

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

!!! note "O endpoint `/auth/solve`"

    `solveToken` é um endpoint interno, pensado para o Gateway: recebe uma string JWT bruta e devolve o `idAccount` correspondente. Ele não é uma rota aberta, então o navegador não consegue usá-lo sem um cookie válido. O `me` (`GET /auth/me`) devolve a conta logada: o Gateway preenche o header `id-account` a partir do token.

### 2.3 Instalação

Instale a interface no repositório Maven local para que o `auth-service` possa depender dela:

``` bash
mvn clean install
```

---

Pronto! A interface `auth` está pronta. Na próxima seção vamos implementar o `auth-service`, incluindo o `JwtService`, que assina e valida tokens, e o `AuthService`, que orquestra o login e o cadastro.

[Rotas abertas](../open-routes/){ .md-button .md-button }
