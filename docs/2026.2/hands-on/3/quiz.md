Click **"Answer"** to reveal the correct answer and explanation.

---

## Security / JWT

**Q1.** What are the three structural parts of a JWT, and how are they separated?

- A. Header, Body, Footer — separated by newlines
- B. Algorithm, Claims, Secret — separated by semicolons
- C. Header, Payload, Signature — separated by dots (`.`)
- D. Type, Data, Hash — separated by underscores

??? success "Answer"
    **C — Header.Payload.Signature.**

    Each part is Base64URL-encoded and joined by dots. The Header declares the algorithm (`HS256`, `RS256`). The Payload contains claims (user ID, roles, expiry). The Signature is computed over Header + Payload using the secret key — any tampering invalidates the signature without requiring a database lookup.

---

**Q2.** Which service **generates JWT tokens** after a successful login, and why is this responsibility there?

- A. The gateway — it handles all authentication logic as the entry point
- B. The account service — it owns user identity data
- C. The auth service — it validates credentials and issues signed tokens with configurable expiry and claims
- D. The client — JWTs are self-signed by the browser

??? success "Answer"
    **C — Auth service.**

    The auth service is responsible for: receiving login credentials, validating them against the account service, generating a signed JWT with the user's identity and roles, and returning it to the client. Separating this from the account service keeps authentication logic cohesive and independently deployable.

---

**Q3.** What is the role of `RouterValidator` in the gateway service?

- A. It validates JSON request bodies against a schema before routing
- B. It selects which downstream microservice instance to route to based on load
- C. It determines which routes require a valid JWT (secured) and which pass through without a token (open routes like `/login`, `/register`)
- D. It validates that the gateway's routing configuration matches the OpenAPI specification

??? success "Answer"
    **C — Distinguishes secured from open routes.**

    Not all endpoints require authentication: the login and registration endpoints must be accessible without a token (otherwise users could never log in). `RouterValidator` provides a predicate that the `AuthorizationFilter` checks — if the route is open, the filter lets it through; if secured, it validates the JWT first.

---

**Q4.** Where is **JWT validation** performed in the request lifecycle?

- A. Inside each business microservice, on every incoming request
- B. At the database layer, when the user's session is looked up
- C. In the `AuthorizationFilter` inside the gateway service, before the request is forwarded to any downstream service
- D. In the identity provider, via a callback on every request

??? success "Answer"
    **C — `AuthorizationFilter` in the gateway.**

    The gateway intercepts every request. The `AuthorizationFilter` checks the JWT on the request (from a cookie or `Authorization` header), calls the auth service to validate it, and either forwards the request with the resolved identity or returns `401 Unauthorized`. Business microservices never see unauthenticated requests.

---

**Q5.** Why is `AuthService` defined as an **interface in the `auth` module** rather than directly inside `auth-service`?

- A. Spring Boot requires interfaces and implementations to be in separate Maven modules
- B. It reduces compilation time by separating the interface from the implementation
- C. Other services (gateway, account) can depend on the `auth` interface module without pulling in the full implementation and its transitive dependencies — following the Dependency Inversion Principle
- D. It allows the auth service to be deployed as a separate Docker image with a smaller footprint

??? success "Answer"
    **C — Interface separation for clean dependency management.**

    The gateway needs to call the auth service (to validate tokens). It depends on the `auth` interface module — a thin library with just the interface and DTOs. If it depended on `auth-service`, it would pull in Spring Data JPA, the database driver, and all other auth-service dependencies into the gateway's classpath.

---
