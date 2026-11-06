!!! tip "Objetivo principal"

    O objetivo principal desta seção é implementar **autenticação e autorização** na plataforma de microsserviços usando [JWT (JSON Web Token)](https://datatracker.ietf.org/doc/html/rfc7519){target="_blank"} e Spring Cloud Gateway.

Segurança é um aspecto crítico de qualquer plataforma. Em uma arquitetura de microsserviços, todas as requisições recebidas passam por um ponto único de entrada — o **Gateway** —, responsável por verificar a identidade do usuário antes de encaminhar a requisição ao serviço adequado.

- **Autenticação** é o processo de verificar a identidade de um usuário. Após um login bem-sucedido, o sistema gera um JWT assinado que comprova a identidade do usuário por um período limitado.

- **Autorização** é o processo de verificar a que o usuário autenticado tem acesso. O Gateway intercepta cada requisição e verifica o JWT antes de roteá-la a qualquer serviço protegido.

## Slides

<div class="slides-embed">
  <iframe src="slides/security.html" title="Slides: hands-on 3 — segurança" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/security.html){:target="_blank"}

``` mermaid-sim
flowchart LR
    subgraph api [Camada confiável]
        gateway --> account
        gateway --> others
        gateway e4@==> auth
        auth e2@==> account
        account --> db@{ shape: cyl, label: "Banco de dados" }
        others --> db
    end
    internet e1@==>|requisição| gateway
    e1@{ animate: true }
    e2@{ animate: true }
    e4@{ animate: true }
```

A camada de segurança é construída em três módulos:

- o módulo `auth` contém a definição da API e os DTOs do microsserviço de autenticação;
- o módulo `auth-service` contém a implementação do serviço, incluindo a geração e a validação de JWT, e delega a criação de contas ao microsserviço `account`;
- o módulo `gateway-service` atua como ponto único de entrada de todas as requisições, exigindo autenticação por meio de um filtro global.

``` mermaid-sim
classDiagram
    namespace auth {
        class AuthController {
            +create(RegisterIn): void
            +login(LoginIn): void
            +me(String idAccount): AccountOut
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
            +create(RegisterIn): void
            +login(LoginIn): void
            +me(String idAccount): AccountOut
            +solveToken(TokenOut): Map
            +logout(): void
            +healthCheck(): void
        }
        class AuthService {
            +create(Register): void
            +login(String email, String password): String
            +solve(String jwt): Map
            +me(String idAccount): AccountOut
        }
        class AuthParser {
            +to(RegisterIn): Register
        }
        class Register {
            -String name
            -String email
            -String password
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
    AuthResource ..> AuthParser
    AuthParser ..> Register
    AuthorizationFilter *-- RouterValidator
```

Antes de escrever código, brinque com a camada pronta: cadastre-se, faça login, chame uma rota protegida e depois tente enganá-la.

<div class="csim" data-sim="jwt-gateway" data-script="tokens"></div>

!!! tip "Experimente"

    Sem Docker à mão, ou quer ver o que cada requisição faz por dentro? O simulador roda a pilha do lab: cada botão é um `curl` pelo Gateway e as caixas acendem pelo caminho que a requisição fez. Em **Autorização 5 (teste)**, os quatro comandos da página respondem 200, 200, 200 e 401 e o login emite exatamente o token de exemplo da página JWT: válido até 14:00:00, 3600 s depois do seu `nbf`. Em **tokens ruins**, senha errada é 401, um header `id-account` forjado é descartado, um payload editado falha na assinatura e um token assinado de novo com a chave padrão pública recebe 200 como Ana — até o `JWT_SECRET_KEY` ser seu. Passado o `Max-Age` do cookie, o curl para de enviá-lo; enviado à mão, o token esbarra em `ExpiredJwtException`.

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
