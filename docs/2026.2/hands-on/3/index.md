!!! tip "Main Goal"

    The main goal of this section is to implement **authentication and authorization** for the microservice platform using [JWT (JSON Web Token)](https://datatracker.ietf.org/doc/html/rfc7519){target="_blank"} and Spring Cloud Gateway.

Security is a critical aspect of any platform. In a microservice architecture, all incoming requests pass through a single entry point — the **Gateway** — which is responsible for verifying the identity of the user before forwarding the request to the appropriate service.

- **Authentication** is the process of verifying the identity of a user. After a successful login, the system generates a signed JWT that proves the user's identity for a limited period.

- **Authorization** is the process of verifying what the authenticated user has access to. The Gateway intercepts every request and checks the JWT before routing it to any secured service.

## Slides

<div class="slides-embed">
  <iframe src="slides/security.html" title="Slides: hands-on 3 — security" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/security.html){:target="_blank"}

``` mermaid-sim
flowchart LR
    subgraph api [Trusted Layer]
        gateway --> account
        gateway --> others
        gateway e4@==> auth
        auth e2@==> account
        account --> db@{ shape: cyl, label: "Database" }
        others --> db
    end
    internet e1@==>|request| gateway
    e1@{ animate: true }
    e2@{ animate: true }
    e4@{ animate: true }
```

The security layer is built across three modules:

- the `auth` module contains the API definition and DTOs for the Auth microservice;
- the `auth-service` module contains the service implementation, including JWT generation and validation, and delegates account creation to the `account` microservice;
- the `gateway-service` module acts as the single entry point for all requests, enforcing authentication via a global filter.

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

Before writing any code, play the finished layer: register, log in, call a secured route, then try to cheat it.

<div class="csim" data-sim="jwt-gateway" data-script="tokens"></div>

!!! tip "Try it"

    No Docker at hand, or want to see what each request does inside? The simulator runs the lab's stack: every button is a `curl` through the Gateway, and the boxes light up along the path the request took. In **Authorization 5 (test)**, the four commands of the page answer 200, 200, 200 and 401, and the login issues exactly the example token of the JWT page: valid until 14:00:00, 3600 s after its `nbf`. In **bad tokens**, a wrong password is a 401, a forged `id-account` header is dropped, an edited payload fails the signature, and a token signed again with the public default key gets 200 as Ana — until `JWT_SECRET_KEY` is your own. Past the cookie's `Max-Age`, curl stops sending it; sent by hand, the token meets `ExpiredJwtException`.

To develop the security layer, the steps are as follows:

<div class="grid cards" markdown>

-   :material-key:{ .lg .middle } **[JWT](./jwt/)**

    ---

    Create the `auth` interface module defining the API endpoints and DTOs, then implement `JwtService` to generate and validate signed tokens;

    [JWT](./jwt/){ .md-button }

-   :material-road-variant:{ .lg .middle } **[Open Routes](./open-routes/)**

    ---

    Set up the `auth-service` module with `AuthResource` and `AuthService`, and configure `RouterValidator` to distinguish secured from open endpoints;

    [Open Routes](./open-routes/){ .md-button }

-   :material-shield-check:{ .lg .middle } **[Authorization](./authorization/)**

    ---

    Implement the `AuthorizationFilter` in `gateway-service` to intercept every request, validate the JWT cookie, and forward the resolved identity to downstream services;

    [Authorization](./authorization/){ .md-button }

</div>
