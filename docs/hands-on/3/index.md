!!! tip "Main Goal"

    The main goal of this section is to implement **authentication and authorization** for the microservice platform using [JWT (JSON Web Token)](https://datatracker.ietf.org/doc/html/rfc7519){target="_blank"} and Spring Cloud Gateway.

Security is a critical aspect of any platform. In a microservice architecture, all incoming requests pass through a single entry point — the **Gateway** — which is responsible for verifying the identity of the user before forwarding the request to the appropriate service.

- **Authentication** is the process of verifying the identity of a user. After a successful login, the system generates a signed JWT that proves the user's identity for a limited period.

- **Authorization** is the process of verifying what the authenticated user has access to. The Gateway intercepts every request and checks the JWT before routing it to any secured service.

``` mermaid
flowchart LR
    subgraph api [Trusted Layer]
        direction TB
        gateway --> account
        gateway --> others
        gateway e4@==> auth:::red
        auth e2@==> account
        account --> db@{ shape: cyl, label: "Database" }
        others --> db
    end
    internet e1@==>|request| gateway:::orange
    e1@{ animate: true }
    e2@{ animate: true }
    e4@{ animate: true }
    classDef red fill:#fcc
    classDef orange fill:#FCBE3E
```

The security layer is built across three modules:

- the `auth` module contains the API definition and DTOs for the Auth microservice;
- the `auth-service` module contains the service implementation, including JWT generation and validation, and delegates account creation to the `account` microservice;
- the `gateway-service` module acts as the single entry point for all requests, enforcing authentication via a global filter.

``` mermaid
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

To develop the security layer, the steps are as follows:

<div class="grid cards" markdown>

-   __[1. JWT](./jwt/)__

    ---

    Create the `auth` interface module defining the API endpoints and DTOs, then implement `JwtService` to generate and validate signed tokens;

    [JWT](./jwt/){ .md-button .md-button }

-   __[2. Open Routes](./open-routes/)__

    ---

    Set up the `auth-service` module with `AuthResource` and `AuthService`, and configure `RouterValidator` to distinguish secured from open endpoints;

    [Open Routes](./open-routes/){ .md-button .md-button }

-   __[3. Authorization](./authorization/)__

    ---

    Implement the `AuthorizationFilter` in `gateway-service` to intercept every request, validate the JWT cookie, and forward the resolved identity to downstream services;

    [Authorization](./authorization/){ .md-button .md-button }

</div>
