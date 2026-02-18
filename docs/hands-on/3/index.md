A secutiry of the system is a very important aspect of the system. All security systems are based on authentication and authorization.

- **Authentication** is the process of verifying the identity of a user.

- **Authorization** is the process of verifying what the user has access to.


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


``` mermaid
classDiagram
    namespace auth {
        class AuthController {
            +register(RegisterIn RegisterIn): TokenOut
            +login(LoginIn loginIn): TokenOut
        }
        class RegisterIn {
            -String name
            -String email
            -String password
        }
        class LoginIn {
            -String name
            -String email
        }
        class TokenOut {
            -String token
        }
        class SolveOut {
            -String idAccount
        }
    }
    namespace auth-service {
        class AuthResource {
            +register(RegisterIn RegisterIn) TokenOut
            +login(LoginIn loginIn) TokenOut
        }
        class AuthService {
            +register(Register) Regiter
            +login(LoginIn loginIn) String
        }
        class Register {
            -String id
            -String name
            -String email
            -String password
        }
    }
    <<Interface>> AuthController
    AuthController ..> RegisterIn
    AuthController ..> LoginIn
    AuthController ..> TokenOut

    AuthController <|-- AuthResource
    AuthResource *-- AuthService
    AuthService ..> Register
```

## Auth

``` tree
api
    auth
        src
            main
                java
                    store
                        auth
                            AuthController.java
                            LoginIn.java
                            RegisterIn.java
                            TokenOut.java
        pom.xml
```

??? info "Source"

    === "pom.xml"

        ``` { .yaml .copy .select linenums="1" }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.auth/refs/heads/main/pom.xml"
        ```

    === "AuthController.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.auth/refs/heads/main/src/main/java/store/auth/AuthController.java"
        ```

    === "LoginIn.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.auth/refs/heads/main/src/main/java/store/auth/LoginIn.java"
        ```

    === "RegisterIn.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.auth/refs/heads/main/src/main/java/store/auth/RegisterIn.java"
        ```

    === "TokenOut.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.auth/refs/heads/main/src/main/java/store/auth/TokenOut.java"
        ```





## Auth-Service

``` tree
api
    auth-service
        src
            main
                java
                    store
                        auth
                            AuthApplication.java
                            AuthResource.java
                            AuthService.java
                            JwtService.java
            resources
                application.yaml
        pom.xml
        Dockerfile
```

??? info "Source"

    === "pom.xml"

        ``` { .yaml .copy .select linenums="1" }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.auth-service/refs/heads/main/pom.xml"
        ```

    === "application.yaml"

        ``` { .yaml .copy .select linenums="1" }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.auth-service/refs/heads/main/src/main/resources/application.yaml"
        ```

    === "AuthApplication.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.auth-service/refs/heads/main/src/main/java/store/auth/AuthApplication.java"
        ```

    === "AuthResource.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.auth-service/refs/heads/main/src/main/java/store/auth/AuthResource.java"
        ```

    === "AuthService.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.auth-service/refs/heads/main/src/main/java/store/auth/AuthService.java"
        ```

    === "JwtService.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.auth-service/refs/heads/main/src/main/java/store/auth/JwtService.java"
        ```

    === "Dockerfile"

        ``` { .java .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.auth-service/refs/heads/main/Dockerfile"
        ```

---

=== "Register"
    
    ``` url
    POST /auth/register
    ```

    Body
    ``` json
    {
        "name": "Antonio do Estudo",
        "email": "acme@insper.edu.br",
        "password": "123@321"
    }
    ```

    Sequence Diagram

    ``` mermaid
    sequenceDiagram
    autonumber
    actor User
    User->>+Auth: register (RegisterIn)
    Auth->>+Account: create (AccountIn)
    Account->>-Auth: returns the new account (AccountOut)
    Auth->>-User: returns 201 (TokenOut)
    ```

---

=== "Login"

    ``` 
    POST /auth/login
    ```

    Body
    ``` json
    {
        "email": "acme@bussiness.com",
        "password": "123@321"
    }
    ```

    Sequence Diagram

    ``` mermaid
    sequenceDiagram
    autonumber
    actor User
    User->>+Auth: authenticate (LoginIn)
    Auth->>+Account: findByEmailAndPassword
    critical validated
        Account->>-Auth: returns the account
    option denied
        Auth-->>User: unauthorized message
    end  
    Auth->>Auth: generates a token
    Auth->>-User: returns TokenOut
    User->>User: stores the token to use for the next requests
    ```

---

## Security

Security is an important aspect of software development. It involves protecting the confidentiality, integrity, and availability of data and resources. Two key concepts in security are authentication and authorization.

### [Authentication](#authentication)

Authentication is the process of verifying the identity of a user or system. It ensures that the user or system is who they claim to be. Common authentication methods include passwords, biometrics, and two-factor authentication. The system checks these credentials against the stored data. If the credentials are valid, the system confirms the user's identity.

In many systems, after successful authentication, the system generates a token. This token is a piece of data that represents the user's authentication session. It's like a digital ticket that proves the user's identity for a certain period of time.

This token is then sent back to the user. The user's client software (like a web browser) stores this token and sends it along with every subsequent request to the server (in case of stateless server). This way, the server knows that the request comes from an authenticated user without needing to ask for the credentials again.

Here's a simplified step-by-step process:

``` mermaid
sequenceDiagram
  autonumber
  actor User
  User->>+Auth Service: authentication(credentials)
  Auth Service->>Auth Service: verifies credenditals and generates a token
  Auth Service->>-User: returns the token
  User->>User: stores the token to use for the next requests
```

1. The user sends their username and password (or other credentials) to the server;
2. The server verifies the credentials. If they're valid, the server generates a token.
3. The server sends this token back to the user.
4. The user's client software stores this token.
5. For every subsequent request, the client sends this token along with the request.
6. The server checks the token to ensure it's valid and hasn't expired.
7. This token-based authentication process is commonly used in many modern web applications and APIs. It helps maintain the user's session and allows the server to authenticate requests without storing the user's state.

### [Authorization](#authorization)

Authorization is the process of granting or denying access to specific resources or actions based on the authenticated user's privileges. It determines what a user is allowed to do within a system. Authorization can be role-based, where permissions are assigned based on predefined roles, or attribute-based, where permissions are based on specific attributes of the user.

In many systems, the token not only represents the user's identity, but also includes information about their permissions or roles. This is often done using a type of token called a [JSON Web Token (JWT)](./jwt.md), which can include a payload of data.

Here's a simplified step-by-step process:

``` mermaid
sequenceDiagram
  autonumber
  actor User
  User->>Auth Service: request with token
  Auth Service->>Auth Service: decodes the token and extracts claims
  Auth Service->>Auth Service: verifies permissions
  critical allowed
    Auth Service->>Secured Resource: authorizes the request
    Secured Resource->>User: returns the response
  option denied
    Auth Service-->>User: unauthorized message
  end  
```

1. After authentication, the user's client software sends a request to a server. This request includes the token.
2. The server decodes the token and extracts the user's identity and permissions.
3. The server checks whether the user has the necessary permissions for the requested action. This could involve checking the user's roles or other attributes against the requirements for the action.
4. If the user has the necessary permissions, the server allows the action. If not, the server denies the action.

This process allows the server to authorize actions without needing to repeatedly look up the user's permissions. It also allows for stateless servers, as the necessary information is included in every request.

By implementing strong authentication and authorization mechanisms, software systems can ensure that only authorized users have access to sensitive data and functionalities, reducing the risk of unauthorized access and potential security breaches.


As the platform has only one entrace point, it is

JWT is a decentralized 

The point of entrance of API is the gateway, then as suggested by [^8].

The gateway is responsible for the security of the system. It is the first point of contact for all incoming requests. The gateway is responsible for routing requests to the appropriate services and ensuring that only authorized users can access the system.

``` mermaid
sequenceDiagram
  autonumber
  actor User
  User->>Gateway: route(ServerHttpRequest)
  Gateway->>+AuthorizationFilter: filter(ServerWebExchange, GatewayFilterChain)
  AuthorizationFilter->>RouteValidator: isSecured.test(ServerHttpRequest)
  RouteValidator-->>AuthorizationFilter: True | False
  critical notSecured
    AuthorizationFilter->>Gateway: follow the flux
  end
  AuthorizationFilter->>AuthorizationFilter: isAuthMissing(ServerHttpRequest)
  critical isAuthMissing
    AuthorizationFilter->>User: unauthorized message
  end
  AuthorizationFilter->>AuthorizationFilter: validateAuthorizationHeader()
  critical isInvalidAuthorizationHeader
    AuthorizationFilter->>User: unauthorized message
  end
  AuthorizationFilter->>Auth: solve(Token)
  critical isInvalidToken
    Auth->>User: unauthorized message
  end
  Auth->>AuthorizationFilter: returns SolveOut
  AuthorizationFilter->>AuthorizationFilter: updateRequestHeader(ServerHttpRequest)
  AuthorizationFilter->>Gateway: follow the flux
```


## Gateway-Service

``` tree
api
    gateway-service
        src
            main
                java
                    store
                        gateway
                            GatewayApplication.java
                            GatewayResource.java
                            security
                                AuthorizationFilter.java
                                CorsFilter.java
                                RouterValidator.java
                resources
                    application.yaml
        pom.xml
        Dockerfile
```

??? info "Source"

    === "pom.xml"

        ``` { .yaml .copy .select linenums="1" }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.gateway-service/refs/heads/main/pom.xml"
        ```

    === "application.yaml"

        ``` { .yaml .copy .select linenums="1" }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.gateway-service/refs/heads/main/src/main/resources/application.yaml"
        ```

    === "GatewayApplication.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.gateway-service/refs/heads/main/src/main/java/store/gateway/GatewayApplication.java"
        ```

    === "GatewayResource.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.gateway-service/refs/heads/main/src/main/java/store/gateway/GatewayResource.java"
        ```

    === "AuthorizationFilter.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.gateway-service/refs/heads/main/src/main/java/store/gateway/security/AuthorizationFilter.java"
        ```

    === "CorsFilter.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.gateway-service/refs/heads/main/src/main/java/store/gateway/security/CorsFilter.java"
        ```

    === "RouterValidator.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.gateway-service/refs/heads/main/src/main/java/store/gateway/security/RouterValidator.java"
        ```

    === "Dockerfile"

        ``` { .dockerfile .copy .select linenums="1" }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.gateway-service/refs/heads/main/Dockerfile"
        ```




## JWT - JSON Web Token

JWT stands for JSON Web Token. It is a compact, URL-safe means of representing claims between two parties. JWTs are commonly used to secure the transmission of information between parties in a web environment, typically for authentication and information exchange. The JWT specification is defined by RFC 7519[^1] and it is a decentralized approach for security (which can support [horizontal scalability](../concepts.md#horizontal-scalability-scale-out)).

Here are the key components and concepts of JWT:

* **JSON Format:** JWTs are represented as JSON objects that are easy to parse and generate. The JSON format makes them human-readable and easy to work with.
* **Three Parts:** JWTs consist of three parts separated by dots (`.`): Header, Payload, and Signature.

    - **Header:** The header typically consists of two parts: the type of the token (JWT) and the signing algorithm being used, such as HMAC SHA256 or RSA.
    
    - **Payload:** The payload contains the claims. Claims are statements about an entity (typically, the user) and additional data. There are three types of claims: registered, public, and private claims.
    
    - **Signature:** To create the signature part, you take the encoded header, the encoded payload, a secret, the algorithm specified in the header, and sign that.

* **Encoding:** Each of the three parts is Base64Url encoded, and the resulting strings are concatenated with periods between them. The final JWT looks like: `xxxxx.yyyyy.zzzzz`.
* **Stateless and Self-contained:** JWTs are stateless, meaning that all the information needed is within the token itself. The server doesn't need to store the user's state. They are also self-contained, meaning that all the information needed is contained within the token.
* **Use Cases:** JWTs are commonly used for authentication and information exchange between parties. For example, after a user logs in, a server could generate a JWT and send it to the client. The client can then include the JWT in the headers of subsequent requests to access protected resources. The server can verify the authenticity of the JWT using the stored secret key.
* **Security Considerations:** While JWTs are widely used and versatile, it's important to handle them securely. For instance, the key used to sign the JWT should be kept secret, and HTTPS should be used to transmit JWTs to prevent man-in-the-middle attacks.

Here's a simple example of a JWT created on JWT Builder[^2]:

`eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.eyJpc3MiOiJJbnNwZXIiLCJpYXQiOjE3MDMwMDgzMzgsImV4cCI6MjAxODU0MTEzOCwiYXVkIjoid3d3Lmluc3Blci5lZHUuYnIiLCJzdWIiOiJodW1iZXJ0b3JzQGluc3Blci5lZHUuYnIiLCJHaXZlbk5hbWUiOiJIdW1iZXJ0byIsIlN1cm5hbWUiOiJTYW5kbWFubiIsIkVtYWlsIjoiaHVtYmVydG9yc0BpbnNwZXIuZWR1LmJyIiwiUm9sZSI6IlByb2Zlc3NvciJ9.SsGdvR5GbYWTRbxY7IGxHt1vSxhkpRueBJWsi0lrPhJVCICp119QjU8F3QvHW0yF5tw-HhQ9RVh0l89t4M0LNw`

This JWT consists of three parts, decoded by [^3]:

=== "Header"

    `eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9`

    ```json
    {
      "typ": "JWT",
      "alg": "HS512"
    }
    ```

=== "Payload"

    `eyJpc3MiOiJJbnNwZXIiLCJpYXQiOjE3MDMwMDgzMzgsImV4cCI6MjAxODU0MTEzOCwiYXVkIjoid3d3Lmluc3Blci5lZHUuYnIiLCJzdWIiOiJodW1iZXJ0b3JzQGluc3Blci5lZHUuYnIiLCJHaXZlbk5hbWUiOiJIdW1iZXJ0byIsIlN1cm5hbWUiOiJTYW5kbWFubiIsIkVtYWlsIjoiaHVtYmVydG9yc0BpbnNwZXIuZWR1LmJyIiwiUm9sZSI6IlByb2Zlc3NvciJ9`

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

=== "Signature"

    `SsGdvR5GbYWTRbxY7IGxHt1vSxhkpRueBJWsi0lrPhJVCICp119QjU8F3QvHW0yF5tw-HhQ9RVh0l89t4M0LNw`

    ```py
    HMACSHA512(
      base64UrlEncode(header) + "." +
      base64UrlEncode(payload),
      qwertyuiopasdfghjklzxcvbnm123456,
    )
    ```

JWTs are widely used in web development due to their simplicity, flexibility, and support across various programming languages and frameworks. They are commonly used in token-based authentication systems.

### Addtional Material


[^1]: [RFC 7519 - JSON Web Token (JWT)](https://datatracker.ietf.org/doc/html/rfc7519){:target="_blank"}, 2015.
    
[^2]: [JWT - Builder](http://jwtbuilder.jamiekurtz.com){:target="_blank"}.
    
[^3]: [jwt.io - JWT Verification](https://jwt.io/){:target="_blank"}.

[^4]: [Unix Time Stamp - Epoch Converter](https://www.unixtimestamp.com){:target="_blank"}.

[^5]: DELANTHA, R., [Spring Cloud Gateway security with JWT](https://medium.com/@rajithgama/spring-cloud-gateway-security-with-jwt-23045ba59b8a){:target="_blank"}, 2023.

[^6]: [Wikipedia - Pepper (cryptography)](https://en.wikipedia.org/wiki/Pepper_(cryptography)){:target="_blank"}.

[^7]: PGzlan, [Serve your hash with Salt and Pepper for Stronger Account Security](https://dev.to/0xog_pg/serve-your-hash-with-salt-and-pepper-for-stronger-account-security-587k){:target="_blank"}, 2023.

[^8]: DELANTHA, R., [Spring Cloud Gateway security with JWT](https://medium.com/@rajithgama/spring-cloud-gateway-security-with-jwt-23045ba59b8a){:target="_blank"}, 2023.

- [JSON Web Token](./jwt.md){:target="_blank"}

- :fontawesome-brands-youtube:{ .youtube } [Autenticação e Autorização com Spring Security e JWT Tokens](https://www.youtube.com/watch?v=5w-YCcOjPD0){:target="_blank"} by [Fernanda Kipper](https://github.com/Fernanda-Kipper){:target="_blank"}

    [![](https://img.youtube.com/vi/5w-YCcOjPD0/0.jpg){ width=60% }](https://www.youtube.com/watch?v=5w-YCcOjPD0){:target="_blank"}

- [Spring Cloud Security](../../handout/microservices/auth.md)

- :fontawesome-brands-youtube:{ .youtube } [ByeteByteGo - Why is JWT popular?](https://www.youtube.com/watch?v=P2CPd9ynFLg){:target='_blank'}

    [![](https://img.youtube.com/vi/P2CPd9ynFLg/0.jpg){ width=60% }](https://www.youtube.com/watch?v=P2CPd9ynFLg){:target="_blank"}
