O primeiro passo para construir a camada de segurança é entender os **JSON Web Tokens (JWT)** e criar o módulo de interface `auth`, que define o contrato da API de autenticação.

## 1. JSON Web Token

O JWT é uma forma compacta e segura para URLs de representar claims (afirmações) entre duas partes. É o padrão usado pela plataforma para transportar a identidade do usuário autenticado entre os serviços sem armazenar estado de sessão no servidor — o que o torna naturalmente compatível com a escalabilidade horizontal.

Um JWT é composto de três partes codificadas em Base64Url, separadas por pontos.

!!! example "Exemplo de JWT"

    ```
    eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.eyJpc3MiOiJJbnNwZXIiLCJpYXQiOjE3MDMwMDgzMzgsImV4cCI6MjAxODU0MTEz
    OCwiYXVkIjoid3d3Lmluc3Blci5lZHUuYnIiLCJzdWIiOiJodW1iZXJ0b3JzQGluc3Blci5lZHUuYnIiLCJHaXZlbk5hbWUiOiJId
    W1iZXJ0byIsIlN1cm5hbWUiOiJTYW5kbWFubiIsIkVtYWlsIjoiaHVtYmVydG9yc0BpbnNwZXIuZWR1LmJyIiwiUm9sZSI6IlByb2
    Zlc3NvciJ9.SsGdvR5GbYWTRbxY7IGxHt1vSxhkpRueBJWsi0lrPhJVCICp119QjU8F3QvHW0yF5tw-HhQ9RVh0l89t4M0LNw
    ```

    === "Header"

        ```json
        {
            "alg": "HS256"
        }
        ```

        O header normalmente tem duas partes: o tipo do token (JWT) e o algoritmo de assinatura usado, como HMAC SHA256 ou RSA.

    === "Payload (Claims)"

        ```json
        {
            "iss": "Insper",
            "iat": 1703008338,
            "exp": 2018541138,
            "aud": "www.insper.edu.br",
            "sub": "humbertors@insper.edu.br",
            "GivenName": "Humberto",
            "Surname": "Sandmann",
            "Email": "humbertors@insper.edu.br",
            "Role": "Professor"
            }
        ```

        O payload contém as claims. Claims são afirmações sobre uma entidade (normalmente, o usuário) e dados adicionais. Há três tipos de claims: registradas, públicas e privadas. As claims registradas são um conjunto de claims predefinidas, não obrigatórias, mas recomendadas, que oferecem um conjunto de claims úteis e interoperáveis. Alguns exemplos são `iss` (emissor), `exp` (instante de expiração), `sub` (assunto) e `aud` (público-alvo). As claims públicas podem ser definidas livremente por quem usa JWTs; para evitar colisões, elas devem ser registradas no IANA JSON Web Token Registry ou definidas como uma URI que contenha um namespace resistente a colisões. As claims privadas são claims personalizadas, criadas para compartilhar informações entre partes que concordam em usá-las, e não são nem registradas nem públicas.

    === "Signature"

        ```
        HMACSHA512(
            base64UrlEncode(header) + "." +
            base64UrlEncode(payload),
            qwertyuiopasdfghjklzxcvbnm123456,
        )
        ```

        Para criar a parte da assinatura, você pega o header codificado, o payload codificado, um segredo e o algoritmo especificado no header, e assina tudo isso.

!!! warning "Chave secreta"

    A chave secreta usada para assinar o JWT deve ser mantida em sigilo. Qualquer pessoa com acesso a ela pode forjar tokens. Armazene-a como variável de ambiente — **nunca a escreva diretamente** no código-fonte.

As principais claims usadas nesta plataforma são:

| Claim | Campo | Descrição |
|---|---|---|
| `jti` | `id` | O identificador único da conta |
| `sub` | `subject` | O nome da conta |
| `iss` | `issuer` | A plataforma emissora |
| `nbf` | `notBefore` | O token passa a ser válido neste instante |
| `exp` | `expiration` | O token expira neste instante |

Depois de um login bem-sucedido, o servidor gera um JWT, coloca-o em um cookie `HttpOnly` e o devolve ao navegador. Em cada requisição seguinte, o navegador envia o cookie automaticamente — o Gateway o lê e resolve a identidade sem pedir que o usuário faça login de novo.

``` mermaid
sequenceDiagram
  autonumber
  actor User
  User->>+Auth Service: login (email + senha)
  Auth Service->>Auth Service: valida as credenciais e gera o JWT
  Auth Service->>-User: Set-Cookie: __store_jwt_token=<jwt>
  User->>User: o navegador armazena o cookie
  User->>Gateway: as requisições seguintes levam o cookie automaticamente
```

## 2. O módulo de interface `auth`

O módulo `auth` segue o mesmo padrão do módulo `account`: é uma **biblioteca** (e não uma aplicação executável) que define o contrato da API e os DTOs compartilhados entre o `auth-service` e qualquer outro microsserviço que precise chamar os endpoints de autenticação via Feign.

### 2.1 Repositório

Crie um novo repositório git para a interface auth e adicione-o como submódulo:

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

- *Lombok* — reduz o código repetitivo (boilerplate) com processamento de anotações em tempo de compilação
- *OpenFeign* — cliente HTTP declarativo para chamadas entre serviços

Apague o `AuthApplication.java`, o `src/test/` e o `src/main/resources/` — este módulo é uma biblioteca, não um serviço executável.

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
            <artifactId>auth</artifactId>
            <version>1.0.0</version>
            <name>auth</name>

            <properties>
                <java.version>25</java.version>
                <spring-cloud.version>2025.1.0</spring-cloud.version>
                <maven.compiler.proc>full</maven.compiler.proc>
            </properties>

            <dependencies>
                <dependency>
                    <groupId>org.springframework.cloud</groupId>
                    <artifactId>spring-cloud-starter-openfeign</artifactId>
                </dependency>
                <dependency>
                    <groupId>store</groupId>
                    <artifactId>account</artifactId>
                    <version>${project.version}</version>
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

            public static String AUTH_COOKIE_TOKEN = "__store_jwt_token";

            @PostMapping("/auth/login")
            public ResponseEntity<Void> login(
                @RequestBody LoginIn in
            );

            @PostMapping("/auth/register")
            public ResponseEntity<Void> register(
                @RequestBody RegisterIn in
            );

            @GetMapping("/auth/whoiam")
            public ResponseEntity<AccountOut> whoIAm(
                @RequestHeader(value = "id-account", required = true) String idAccount
            );

            @GetMapping("/auth/health-check")
            public ResponseEntity<Void> healthCheck();

            @PostMapping("/auth/solve")
            public ResponseEntity<Map<String, String>> solveToken(
                @RequestBody TokenOut map
            );

            @GetMapping("/auth/logout")
            public ResponseEntity<Void> logout();

        }
        ```

    === "LoginIn.java"

        ``` { .java .copy .select linenums="1" }
        package store.auth;

        import lombok.Builder;

        @Builder
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

        @Builder
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

        @Builder
        public record TokenOut(

            String token

        ) {
        }
        ```

!!! note "O endpoint `/auth/solve`"

    O `solveToken` é um endpoint interno, chamado apenas pelo Gateway. Ele recebe a string bruta do JWT e retorna o `idAccount` correspondente. Ele nunca é exposto diretamente ao navegador.

### 2.3 Instalação

Instale a interface no repositório Maven local para que o `auth-service` possa depender dela:

``` bash
mvn clean install
```

---

Pronto! A interface `auth` está pronta. Na próxima seção, vamos implementar o `auth-service`, incluindo o `JwtService`, que assina e valida os tokens, e o `AuthService`, que orquestra o login e o cadastro.

[Rotas abertas](../open-routes/){ .md-button .md-button }
