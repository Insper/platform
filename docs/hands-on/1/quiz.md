Click **"Answer"** to reveal the correct answer and explanation.

---

## CRUD Microservice

**Q1.** Which Maven **module** contains the API interface (controller definition and DTOs) — not the implementation?

- A. `account-service` — it contains all microservice code
- B. `account` — it defines the interface and DTOs that other services can depend on without depending on the implementation
- C. `gateway-service` — the gateway owns all API contracts
- D. There is no separation; interface and implementation are in the same module

??? success "Answer"
    **B — `account` module.**

    The `account` module defines the `AccountController` interface and the `AccountIn`/`AccountOut` record DTOs. Other services (e.g., the auth service that calls the account service) depend on this interface module only — never on `account-service` which contains the Spring Boot implementation, JPA entities, and business logic.

---

**Q2.** According to Clean Architecture, which layer should contain the Spring `@Entity` annotation?

- A. Domain (Entities) layer — entities represent the core business model, so the annotation belongs there
- B. Use Cases (Application) layer — the service needs to persist data
- C. Frameworks & Drivers / Interface Adapters layer — ORM annotations are infrastructure detail that must not leak into the domain or use-case layers
- D. Any layer — Spring annotations are framework-neutral

??? success "Answer"
    **C — Frameworks & Drivers / Interface Adapters layer.**

    `@Entity` is a JPA annotation — it belongs to the persistence infrastructure, not the domain. The domain object `Account` is a plain Java class. A separate `AccountModel` (or `AccountTable`) class in the adapter layer carries the `@Entity` annotation. A `Mapper` converts between them at the persistence boundary.

---

**Q3.** What HTTP status code does a successful `POST` creating a new account return, and what header should accompany it?

- A. `200 OK` with no additional headers
- B. `201 Created` with a `Location` header pointing to the new resource's URI
- C. `204 No Content` — creation succeeded with nothing to return
- D. `202 Accepted` — creation is queued asynchronously

??? success "Answer"
    **B — `201 Created` with `Location` header.**

    `201` signals that a new resource was created. The `Location: /accounts/42` header tells the client exactly where to find the new account. This allows the client to immediately cache or navigate to the resource without making a separate GET request.

---

**Q4.** What is the role of `AccountService` versus `AccountRepository` in this architecture?

- A. They are interchangeable — either can be used to persist data
- B. `AccountService` handles HTTP; `AccountRepository` handles business logic
- C. `AccountService` implements business logic (validation, orchestration); `AccountRepository` is the persistence abstraction — a Java interface that hides database details
- D. `AccountService` calls external APIs; `AccountRepository` handles internal state

??? success "Answer"
    **C — Service = business logic; Repository = persistence abstraction.**

    `AccountService` decides *what* to do (validate the account, check for duplicates, hash the password). `AccountRepository` knows *how to persist* it. The Service depends on the Repository *interface* — never on the JPA implementation — making it testable with an in-memory repository.

---

**Q5.** In the sequence diagram, what does the **Parser** do between the Controller and the Service layers?

- A. It validates the HTTP request headers before forwarding to the service
- B. It encrypts the account data before storing it
- C. It converts the HTTP DTO (`AccountIn`) into the domain `Account` object, maintaining the boundary between adapter and use-case layers
- D. It logs the incoming request for audit purposes

??? success "Answer"
    **C — Converts `AccountIn` → domain `Account`.**

    The Parser enforces the layer boundary: the Controller knows about `AccountIn` (HTTP contract); the Service knows about `Account` (domain object). The Parser is the only class that knows both, and it lives at the boundary. This way, changing the JSON field names never requires touching the service logic.

---

**Q6.** Why does the sequence diagram show a second conversion (Mapper) between the Service and Repository layers?

- A. Because the service always returns data in JSON format
- B. Because the `Account` domain object must be converted to an `AccountModel` (`@Entity`) to be persisted — keeping ORM annotations out of the domain layer
- C. Because Spring Data requires all objects to implement `Serializable`
- D. There is no second conversion — the service directly calls the JPA repository

??? success "Answer"
    **B — `Account` → `AccountModel` (`@Entity`) at the persistence boundary.**

    The domain `Account` class has no JPA annotations. The persistence adapter converts it to `AccountModel` (which has `@Entity`, `@Column`, etc.) before persisting, and back to `Account` after reading. This keeps the domain layer free of infrastructure concerns — the pattern is called the *Repository Adapter* or *Anti-Corruption Layer*.

---

**Q7.** What is the purpose of the `account` module being a **separate Maven module** from `account-service`?

- A. It speeds up compilation by parallelising build tasks
- B. Other services can declare a dependency on the interface (`account`) without pulling in the full Spring Boot application (`account-service`) and its transitive dependencies
- C. Maven requires interfaces and implementations to be in separate modules
- D. It allows the interface to be written in a different programming language

??? success "Answer"
    **B — Interface module without Spring Boot dependencies.**

    The `account` module is a thin library: just the `AccountController` interface, `AccountIn`, and `AccountOut` records. The auth service declares `<dependency>account</dependency>` to use the Feign client generated from this interface. It does NOT pull in Spring Data JPA, PostgreSQL driver, or any of the implementation's heavy dependencies.

---

**Q8.** A developer adds `@Column(name = "user_email")` directly to the domain `Account` class. What Clean Architecture principle does this violate?

- A. Single Responsibility Principle — the class now has two responsibilities
- B. The Dependency Rule — the domain layer now depends on a Frameworks & Drivers (JPA) annotation, pointing outward instead of inward
- C. Open/Closed Principle — the class is no longer open for extension
- D. This is acceptable — JPA annotations are transparent metadata

??? success "Answer"
    **B — Dependency Rule violation.**

    The domain layer must know nothing about persistence frameworks. Adding `@Column` to `Account` makes the domain class aware of JPA — the dependency now points outward (domain → framework). If JPA is replaced or the column mapping changes, the domain class must change too, coupling domain logic to infrastructure decisions.

---

**Q9.** The `AccountController` interface is declared in the `account` module. Its implementation `AccountResource` lives in `account-service`. Which design pattern does this exemplify?

- A. Factory Method — `AccountController` creates instances of `AccountResource`
- B. Observer — `AccountController` observes changes in `AccountResource`
- C. Interface Segregation combined with Dependency Inversion — callers depend on the interface; the implementation is in a separate module
- D. Singleton — only one instance of `AccountController` exists per JVM

??? success "Answer"
    **C — Interface Segregation + Dependency Inversion.**

    Callers depend on the `AccountController` interface (the abstraction), not on `AccountResource` (the implementation). The Dependency Inversion Principle states that high-level modules should depend on abstractions, not concretions. Separating them into different Maven modules enforces this at the build level.

---

**Q10.** After adding the `account-service` Docker image to `compose.yaml`, which two environment variables are used to configure the database connection instead of hard-coded values?

- A. `SPRING_DATASOURCE_URL` and `SPRING_DATASOURCE_PASSWORD` hard-coded in compose.yaml
- B. `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_DB`, `DATABASE_USERNAME`, `DATABASE_PASSWORD` passed as env vars — resolved from `.env` at runtime
- C. The database connection is auto-detected from the container network
- D. Only `POSTGRES_URL` — Spring Boot builds the full JDBC URL automatically

??? success "Answer"
    **B — `DATABASE_HOST`, `DATABASE_PORT`, etc. from `.env`.**

    The compose.yaml passes individual connection parts as environment variables. `application.yaml` reads them via `${DATABASE_HOST:localhost}` with defaults for local development. The `.env` file provides production values without ever appearing in the repository.

---
