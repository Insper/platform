!!! tip "Objetivo principal"

    O objetivo principal desta seção é implementar **autenticação e autorização** na plataforma de microsserviços usando [JWT (JSON Web Token)](https://datatracker.ietf.org/doc/html/rfc7519){target="_blank"} e Spring Cloud Gateway.

Segurança é um aspecto crítico de qualquer plataforma. Em uma arquitetura de microsserviços, todas as requisições recebidas passam por um ponto único de entrada — o **Gateway** —, responsável por verificar a identidade do usuário antes de encaminhar a requisição ao serviço adequado.

- **Autenticação** é o processo de verificar a identidade de um usuário. Após um login bem-sucedido, o sistema gera um JWT assinado que comprova a identidade do usuário por um período limitado.

- **Autorização** é o processo de verificar a que o usuário autenticado tem acesso. O Gateway intercepta cada requisição e verifica o JWT antes de roteá-la a qualquer serviço protegido.

## Slides

<div class="slides-embed">
  <iframe src="slides/security.pt.html" title="Slides: hands-on 3 — segurança" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/security.pt.html){:target="_blank"}

``` mermaid-sim
flowchart LR
    subgraph api [Camada confiável]
        gateway --> account
        gateway --> others
        gateway e4@==> auth:::red
        auth e2@==> account
        account --> db@{ shape: cyl, label: "Banco de dados" }
        others --> db
    end
    internet e1@==>|requisição| gateway:::orange
    e1@{ animate: true }
    e2@{ animate: true }
    e4@{ animate: true }
    classDef red fill:#fcc
    classDef orange fill:#FCBE3E
```

A camada de segurança é construída em três módulos:

- o módulo `auth` contém a definição da API e os DTOs do microsserviço de autenticação;
- o módulo `auth-service` contém a implementação do serviço, incluindo a geração e a validação de JWT, e delega a criação de contas ao microsserviço `account`;
- o módulo `gateway-service` atua como ponto único de entrada de todas as requisições, exigindo autenticação por meio de um filtro global.

``` mermaid-sim
classDiagram
    namespace auth {
        class AuthController {
            +login(LoginIn): void
            +register(RegisterIn): void
            +whoIAm(String idAccount): AccountOut
            +solveToken(TokenOut): Map
            +logout(): void
            +healthCheck(): void
        }
        class LoginIn {
            -String email
            -String password
        }
        class RegisterIn {
            -String name
            -String email
            -String password
        }
        class TokenOut {
            -String token
        }
    }
    namespace auth-service {
        class AuthResource {
            +login(LoginIn): void
            +register(RegisterIn): void
            +whoIAm(String idAccount): AccountOut
            +solveToken(TokenOut): Map
            +logout(): void
        }
        class AuthService {
            +login(String email, String password): TokenOut
            +register(RegisterIn): void
            +solveToken(String token): String
            +whoIAm(String idAccount): AccountOut
        }
        class JwtService {
            +generate(AccountOut account, long duration): String
            +getId(String jwt): String
        }
    }
    namespace gateway-service {
        class AuthorizationFilter {
            +filter(ServerWebExchange, GatewayFilterChain): Mono~Void~
        }
        class RouterValidator {
            +isSecured: Predicate~ServerHttpRequest~
        }
    }
    <<Interface>> AuthController
    AuthController ..> LoginIn
    AuthController ..> RegisterIn
    AuthController ..> TokenOut

    AuthController <|-- AuthResource
    AuthResource *-- AuthService
    AuthService *-- JwtService
    AuthorizationFilter *-- RouterValidator
```

Para desenvolver a camada de segurança, os passos são os seguintes:

<div class="grid cards" markdown>

-   :material-key:{ .lg .middle } **[JWT](./jwt/)**

    ---

    Crie o módulo de interface `auth`, que define os endpoints da API e os DTOs, e depois implemente o `JwtService` para gerar e validar tokens assinados;

    [JWT](./jwt/){ .md-button }

-   :material-road-variant:{ .lg .middle } **[Rotas abertas](./open-routes/)**

    ---

    Monte o módulo `auth-service` com `AuthResource` e `AuthService` e configure o `RouterValidator` para distinguir endpoints protegidos de endpoints abertos;

    [Rotas abertas](./open-routes/){ .md-button }

-   :material-shield-check:{ .lg .middle } **[Autorização](./authorization/)**

    ---

    Implemente o `AuthorizationFilter` no `gateway-service` para interceptar cada requisição, validar o cookie JWT e repassar a identidade resolvida aos serviços seguintes;

    [Autorização](./authorization/){ .md-button }

</div>
