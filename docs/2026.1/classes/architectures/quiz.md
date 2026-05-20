
Click **"Answer"** to reveal the correct answer and explanation.

---

## Clean Architecture

**Q1.** The **Dependency Rule** in Clean Architecture states that source-code dependencies must always point in which direction?

- A. Outward — inner layers depend on outer layers for framework utilities
- B. Bidirectionally — inner and outer layers may import each other freely
- C. Inward — outer layers depend on inner layers, and inner layers never reference anything in an outer layer
- D. Downward — higher-level layers depend on lower-level infrastructure

??? success "Answer"
    **C — Always inward.**

    The Entities layer knows nothing about Use Cases; Use Cases know nothing about Controllers or databases. This means swapping the web framework, changing the ORM, or adding a new delivery mechanism (REST → gRPC) requires touching only the outermost layers — the business rules remain untouched.

---

**Q2.** Which layer contains **application-specific business rules** that orchestrate Entities to fulfil a use case?

- A. Entities (Domain) layer — it contains all business logic
- B. Interface Adapters layer — it processes incoming requests
- C. Use Cases (Application) layer — it defines what the application does and orchestrates domain objects
- D. Frameworks & Drivers layer — it coordinates between the web framework and the database

??? success "Answer"
    **C — Use Cases (Application) layer.**

    The Entities layer holds *enterprise-wide* rules (valid Money, Order invariants). The Use Cases layer holds *application-specific* rules: "to place an order, validate the cart, reserve inventory, charge the customer." Use cases depend on entity interfaces, never on frameworks.

---

**Q3.** A Spring `@Entity` annotation must **not** appear in which layers?

- A. Interface Adapters layer — it bridges framework and use case
- B. Frameworks & Drivers layer — all infrastructure detail lives here
- C. Entities (Domain) layer and Use Cases (Application) layer — these must be framework-free
- D. It can appear anywhere as long as the business logic is in the service

??? success "Answer"
    **C — Domain and Use Cases layers must be framework-free.**

    `@Entity` is a JPA annotation — a Frameworks & Drivers concern. If it appears in a domain class or use case, that layer now depends on the persistence framework, violating the Dependency Rule. Domain objects should be plain Java classes with no framework imports. The `@Entity` belongs on a separate persistence model class in the Adapters layer.

---

**Q4.** What is the role of the **Parser** in the course's Spring Boot Clean Architecture?

- A. It validates incoming JSON against a schema before passing it to the controller
- B. It translates between HTTP `RecordIn`/`RecordOut` types and Use Case DTOs, keeping both sides of the boundary clean
- C. It converts database query results into HTTP responses
- D. It encrypts sensitive fields before they leave the service

??? success "Answer"
    **B — Translates between adapter boundary types and use-case types.**

    The Parser sits at the boundary between the Interface Adapters layer and the Use Cases layer. It converts `AccountIn` (HTTP contract) into `Account` (domain object) on the way in, and `Account` back into `AccountOut` on the way out. Neither the controller nor the service needs to know about the other's representation.

---

**Q5.** A `Service` class calls `accountRepository.findById()` where `accountRepository` is a **Spring Data `JpaRepository`** — not a domain-defined interface. Which Clean Architecture mistake does this illustrate?

- A. Anemic domain model — all logic is in the service layer
- B. Fat controller — the service is doing too much work
- C. Leaking framework types inward — the Use Case now depends on a Frameworks & Drivers type
- D. Swappable persistence — the service is correctly using an abstraction

??? success "Answer"
    **C — Leaking framework types inward.**

    `JpaRepository` is a Spring Data / Frameworks & Drivers type. If the `Service` (Use Cases layer) imports it directly, the Use Case layer now depends on the outermost layer — a direct violation of the Dependency Rule. The correct approach: declare a `AccountRepository` interface in the domain layer; let the JPA adapter implement it.

---

## Hexagonal Architecture

**Q6.** In Hexagonal Architecture, who **defines** the secondary (driven) port interface?

- A. The external technology that implements it (e.g., the JPA provider)
- B. The adapter that bridges the technology to the application
- C. The application core — both port types are owned and defined by the core, not by the external technology
- D. The framework's dependency injection container at runtime

??? success "Answer"
    **C — The application core owns all port definitions.**

    This is the fundamental inversion of control. The `AccountRepository` interface is declared inside the application core in domain terms (`findByEmail`, `save`). The JPA adapter implements that interface and lives in the outer layer. The core never imports the adapter.

---

**Q7.** What distinguishes a **driving (primary) adapter** from a **driven (secondary) adapter**?

- A. Driving adapters live inside the hexagon; driven adapters live outside it
- B. A driving adapter initiates interaction with the core (e.g., REST controller calls the primary port); a driven adapter implements what the core needs from the outside (e.g., JPA adapter implements the repository port)
- C. Driven adapters are tested automatically; driving adapters require manual testing
- D. Driving adapters handle writes; driven adapters handle reads

??? success "Answer"
    **B — Driving initiates; driven implements.**

    A driving adapter is something that *calls* the application: REST controller, CLI, message consumer, test. A driven adapter is something the application *calls*: database, email service, external API. Both live outside the hexagon and connect through their respective ports.

---

**Q8.** What is the key **testing benefit** of Hexagonal Architecture?

- A. All adapters can be tested without a running application core
- B. The framework handles all test setup via annotations like `@SpringBootTest`
- C. The application core can be fully tested with plain unit tests by substituting driven adapters with in-memory stubs — no Spring context, no database, no running server required
- D. Integration tests run 10× faster because the hexagon compiles to bytecode more efficiently

??? success "Answer"
    **C — Core testable with plain unit tests and in-memory stubs.**

    `AuthServiceImpl` takes an `AccountRepository` interface. In a test, replace it with `InMemoryAccountRepository` (a `HashMap`). The test runs in milliseconds with no infrastructure. This is the architectural property that makes TDD practical — the business rule is tested directly, not through HTTP and a real database.

---

**Q9.** A team defines `AccountRepository` with methods that mirror Spring Data `JpaRepository`. What is wrong with this?

- A. Nothing — mirroring JPA methods is the correct way to define a secondary port
- B. The adapter (JPA) is shaping the port instead of the core defining it in domain terms — the interface should express domain intent, not persistence mechanics
- C. The interface has too few methods — ports should expose every possible database operation
- D. The port should extend `JpaRepository` directly to avoid duplication

??? success "Answer"
    **B — Adapter is shaping the port.**

    If `AccountRepository` has `findAll()`, `saveAll()`, `deleteById(Long id)` — these are JPA concepts. A domain-driven port would express domain concepts: `findByEmail(String email)`, `save(Account account)`. When the port mirrors the adapter, you have accidentally made the domain depend on the infrastructure's vocabulary, not the other way around.

---

**Q10.** How do **Clean Architecture** and **Hexagonal Architecture** relate to each other?

- A. They are competing approaches — a system must choose one or the other
- B. Hexagonal Architecture is a simpler subset; Clean Architecture is always preferred in production
- C. They are complementary — Hexagonal defines *how* the application boundary works (ports & adapters); Clean Architecture defines *what* goes inside those boundaries (layers with explicit dependency policies)
- D. Clean Architecture is the older model; Hexagonal Architecture replaced it entirely

??? success "Answer"
    **C — Complementary, often used together.**

    Hexagonal Architecture gives you the *outside* of the hexagon — ports and adapters at the boundary. Clean Architecture gives you the *inside* — explicit layers (Entities, Use Cases) with a Dependency Rule. Most modern Spring Boot microservices combine both: hexagonal at the boundary, clean-architecture layering internally.
