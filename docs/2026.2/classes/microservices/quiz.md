
Click **"Answer"** to reveal the correct answer and explanation.

---

## Domain-Driven Design

**Q1.** What is the primary purpose of a **Bounded Context** in DDD?

- A. It limits the number of entities a single service can manage
- B. It defines the boundary within which a domain model is valid — the same term can mean different things in different contexts
- C. It enforces a maximum size for aggregates within the domain
- D. It specifies which database schema a service is allowed to access

??? success "Answer"
    **B — Defines the boundary where a domain model is valid.**

    A `Customer` in the Sales context (credit limit, region) is a completely different model from `Customer` in Billing (tax ID, billing address). Bounded contexts allow each team to use the term differently without creating one bloated class that satisfies none of them well. In microservices, a bounded context typically maps to one service.

---

**Q2.** Which DDD building block is the **sole entry point** for all modifications to the objects within it?

- A. Domain Service
- B. Repository
- C. Value Object
- D. Aggregate Root

??? success "Answer"
    **D — Aggregate Root.**

    The Aggregate Root is the only object external code holds a reference to. All state changes to child entities and value objects inside the aggregate must go through the root, which enforces invariants. For example, `Order.addItem()` checks the "max 50 items" rule before allowing a new `OrderItem` to be added.

---

**Q3.** What distinguishes an **Entity** from a **Value Object**?

- A. Entities are immutable; Value Objects change state over time
- B. An Entity has a persistent identity that survives attribute changes; a Value Object is defined entirely by its attributes and has no identity
- C. Entities exist only in memory; Value Objects are persisted to the database
- D. Entities are shared between bounded contexts; Value Objects are local to one context

??? success "Answer"
    **B — Entity has identity; Value Object is defined by its attributes.**

    Two `Order` objects with the same ID are the same order even if their status differs (entity). Two `Money(10.00, BRL)` objects are identical and interchangeable because they have the same attributes (value object). Value objects should be immutable — operations return new instances.

---

**Q4.** In Event Storming, what do **Domain Events** (orange sticky notes) represent?

- A. Commands that users send to the system to trigger state changes
- B. External API calls that the system makes to third-party services
- C. Things that happened in the domain, expressed in past tense, used to trigger reactions in other bounded contexts
- D. Business rules that enforce invariants within an aggregate

??? success "Answer"
    **C — Things that happened, past tense.**

    `OrderPlaced`, `PaymentCharged`, `ItemShipped` — domain events describe facts. They are immutable records that other bounded contexts (Inventory, Notifications, Analytics) subscribe to and react to independently. This decouples contexts without requiring direct calls between them.

---

**Q5.** According to the DDD-to-microservices mapping, what is the natural **starting point** for a microservice boundary?

- A. A database table — each table becomes one microservice
- B. A use case — each user story maps to one service
- C. A team — Conway's Law dictates that one team = one service
- D. A Bounded Context — the ubiquitous language and model are internally consistent within that boundary

??? success "Answer"
    **D — A Bounded Context.**

    The bounded context defines a conceptual seam where the model is self-consistent and the team owns the ubiquitous language. Starting there (rather than by table or use case) produces services that can evolve independently. However, a bounded context is a starting point — operational or team constraints may lead to merging or splitting.

---

## Microservice Architecture

**Q6.** What is the primary role of an **API Gateway** in a microservices architecture?

- A. It stores shared configuration for all microservices
- B. It acts as a message broker between services using async events
- C. It is the single external entry point — handling routing, authentication, rate limiting, and SSL termination on behalf of all services
- D. It manages the lifecycle of containers and restarts failed services

??? success "Answer"
    **C — Single external entry point.**

    The gateway is the only service exposed to the internet. Internal services never directly face external traffic. By centralising cross-cutting concerns (auth, rate limiting, SSL, logging), the gateway lets business microservices focus entirely on their domain logic.

---

**Q7.** Why does each microservice own its **own database** (database-per-service pattern)?

- A. It reduces infrastructure cost by using smaller, cheaper databases
- B. It is required by the OpenAPI specification
- C. It ensures services can evolve their schema independently without coupling to other services' data models
- D. It prevents services from reading each other's data, improving security

??? success "Answer"
    **C — Independent schema evolution.**

    A shared database creates a hidden coupling: changing a table that Service A owns might break Service B, which also reads it. With database-per-service, each service's schema is its private implementation detail. Services communicate through APIs, never through shared tables.

---

**Q8.** What is the key trade-off between **synchronous (HTTP)** and **asynchronous (messaging)** inter-service communication?

- A. Sync is more secure; async is less secure
- B. Sync gives immediate results but creates temporal coupling; async decouples services but the caller cannot wait for a result
- C. Async is always better — sync should never be used in microservices
- D. Sync uses more CPU; async uses more memory

??? success "Answer"
    **B — Sync = immediate result, temporal coupling; async = decoupled, no immediate result.**

    If the Order service calls the Inventory service synchronously and Inventory is down, Order is also broken. With async messaging, Order publishes an `OrderPlaced` event and continues; Inventory processes it when it recovers. Use sync when the caller needs the result immediately (e.g., auth validation); use async when strict consistency is not required (e.g., sending confirmation email).

---

**Q9.** What problem does **Service Discovery** solve in a dynamic microservice environment?

- A. It prevents two services from being deployed with the same name
- B. It allows services to find each other's current network locations dynamically, since IP addresses change as instances scale up or down
- C. It monitors health checks and restarts unhealthy services
- D. It routes external traffic to the correct microservice based on the URL path

??? success "Answer"
    **B — Finding current network locations of dynamic instances.**

    In a containerised environment, instances are created and destroyed constantly, and their IP addresses change on every restart. A service registry (Consul, Eureka, Kubernetes DNS) maintains the current location of all instances. Services register on startup and deregister on shutdown, and callers query the registry to find them.

---

**Q10.** In the course's reference architecture, who is responsible for **validating JWT tokens** on each request?

- A. Each business microservice validates the token independently on every request
- B. The identity provider re-validates the token on every request via a callback
- C. The Gateway delegates validation to the Auth Service; business microservices trust the claims in the forwarded JWT without re-validating
- D. The load balancer validates tokens before passing requests to the gateway

??? success "Answer"
    **C — Gateway delegates to Auth Service; business services trust forwarded claims.**

    The gateway intercepts every request, calls the Auth Service to validate the JWT, and then forwards the resolved identity (e.g., `X-Account-Id` header) to the downstream service. Business microservices trust these headers without calling Auth Service themselves, keeping each service focused on its domain.
