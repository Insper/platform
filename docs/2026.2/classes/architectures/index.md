
Open the `account-service` of [Hands-on 1](../../hands-on/1/index.md) a year from now. The product team wants a mobile endpoint, the database team wants to move from Postgres to a managed service, the security team wants accounts created through a Kafka event, and someone has to write tests that run in seconds. If the business rules ("an email can be registered only once", "a password has at least 8 characters") are tangled with Spring annotations, SQL and HTTP status codes, every one of those requests becomes a rewrite.

Software architecture defines how the components of a system are organised, how they communicate, and — most importantly — which components are **allowed to know about which others**. The architectures covered here share the same foundational goal: **protect business logic from external concerns** such as frameworks, databases, and delivery mechanisms. This separation matters because external concerns change more often than business rules. A database migration, a framework upgrade, or a new API protocol should not require rewriting core logic.

!!! abstract "Learning objectives"

    By the end of this class you should be able to:

    - **Explain** each SOLID principle and **identify** a violation of it in Java code.
    - **Explain** the Dependency Rule and **place** a class of a Spring Boot service in the right Clean Architecture layer.
    - **Design** a service with ports and adapters, distinguishing driving from driven ports.
    - **Compare** layered, Clean and Hexagonal architectures, and **justify** when the extra structure pays off.
    - **Write** a unit test for a use case by replacing the database adapter with an in-memory one.
    - **Describe** CQRS and its cost (eventual consistency), and decide when it is worth it.

## Slides

<div class="slides-embed">
  <iframe src="slides/architectures.html" title="Slides: architectures" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/architectures.html){:target="_blank"}

---

## Roadmap

Read the pages in this order — each one builds on the previous:

<div class="grid cards" markdown>

-   :material-check-decagram:{ .lg .middle } **1. SOLID Principles**

    ---

    Five class-level design rules — Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion — that make code maintainable and testable. The foundation that both architectures below rely on.

    [:octicons-arrow-right-24: SOLID Principles](solid/index.md)

-   :material-layers:{ .lg .middle } **2. Clean Architecture**

    ---

    Organises code into concentric layers with an explicit **Dependency Rule**: nothing in an inner layer may reference anything in an outer layer. Proposed by Robert C. Martin as a synthesis of earlier ideas, including Hexagonal and Onion.

    [:octicons-arrow-right-24: Clean Architecture](clean/index.md)

-   :material-hexagon-outline:{ .lg .middle } **3. Hexagonal Architecture**

    ---

    Places the application core at the centre and exposes it through **ports** (interfaces). External systems connect via **adapters**. Also called *Ports & Adapters*, introduced by Alistair Cockburn in 2005.

    [:octicons-arrow-right-24: Hexagonal Architecture](hexagonal/index.md)

</div>

This overview page closes with a comparison of the two architectures and with **CQRS**, a pattern that splits the write and read sides of a service.

---

## The core problem

Without an explicit architectural rule, dependencies accumulate in both directions. A `UserService` ends up importing JPA annotations; a controller contains validation logic; a repository method returns HTTP status codes. The result is a **Big Ball of Mud**[^3] — a system where every component knows about every other, making isolated testing, replacement of parts, and parallel team work impossible.

The architectures in this class solve this through a single constraint: **dependencies flow in one direction only**, pointing toward the stable core.

``` mermaid-sim
flowchart LR
  External["External World<br>(HTTP, DB, MQ, CLI)"]
  Core["Application Core<br>(Business Rules)"]
  External -->|adapters / controllers| Core
  Core -.->|never imports| External
```

A **dependency** here means a compile-time reference: class `A` depends on `B` if `A`'s source code mentions `B` (an `import`, a field type, a `new B()`). If `B` changes, `A` may have to change too — so dependencies should point from what changes often (frameworks, protocols) to what changes rarely (business rules).

### The starting point: layered architecture

Most Spring Boot services — including the ones in the hands-on — start with the classic **layered (n-tier) architecture**: controller → service → repository → database. It is a good first step, because it separates HTTP handling from business logic. But look where the arrows point:

``` mermaid-sim
flowchart LR
  subgraph layered ["Layered: business depends on persistence"]
    direction LR
    c1["AccountController"] --> s1["AccountService"]
    s1 --> r1["JpaRepository<br>(Spring Data)"]
    r1 --> db1[("Postgres")]
  end
  subgraph clean ["Clean / Hexagonal: persistence depends on business"]
    direction LR
    c2["AccountController"] --> s2["AccountService"]
    s2 --> p2["«interface»<br>AccountRepository"]
    a2["AccountJpaAdapter"] -->|implements| p2
    a2 --> db2[("Postgres")]
  end
```

In the layered version the service — the business logic — depends on the persistence technology. In the Clean/Hexagonal version, the service owns an interface expressed in business terms, and the persistence code depends on it. That single change is the **Dependency Inversion Principle** (the "D" in SOLID) applied at the boundary, and it is what the next three pages develop.

---

## Side-by-side comparison

| Concern | Layered (n-tier) | Clean Architecture | Hexagonal Architecture |
|---|---|---|---|
| Core abstraction | horizontal layers | concentric layers + Dependency Rule | hexagon + ports & adapters |
| Dependency direction | top-down, toward the database | always inward | always toward the core |
| Vocabulary | Controller · Service · Repository | Entities · Use Cases · Interface Adapters · Frameworks & Drivers | Domain · Application Services · Ports · Adapters |
| Testing strategy | usually needs a database (or mocks of framework types) | inner layers testable in isolation | core testable by substituting adapters |
| Flexibility | swapping the DB touches the services | framework and DB can be swapped | any external system can be swapped |
| Relationship | the usual starting point | explicitly builds on Hexagonal and Onion, naming the inner layers[^1] | the original boundary idea[^2] |

!!! tip "Which to use?"
    The two architectures are complementary and commonly used together. Think of **Hexagonal** as defining *how* the application boundary works (ports & adapters), and **Clean Architecture** as defining *what* goes inside those boundaries (layers with explicit dependency policies). Most modern microservices combine both.

!!! warning "Do not over-architect a CRUD service"
    Ports, adapters and mappers have a cost: more classes, more conversions, more indirection to read. A service that only stores and returns records with no real business rules (a lookup table, a simple catalogue) can stay layered. The extra structure pays off when the **business rules are rich**, the service **lives long**, or you need to **swap or add** delivery mechanisms and data stores. Microservices help here: each service can choose the level of structure it needs.

---

## CQRS — Command Query Responsibility Segregation

Think of the store's product catalogue: thousands of `GET /products?category=...` requests per second, a few `PUT /products/{id}` per hour. A single model has to be normalised for safe writes *and* denormalised for fast searches — and serves neither well. CQRS separates the **write side** (commands that mutate state) from the **read side** (queries that return views), allowing each to be modelled, stored and scaled independently. The idea extends Bertrand Meyer's *Command-Query Separation* (a method either changes state or returns data, never both) from methods to whole models; Greg Young named it around 2010[^4].

``` mermaid-sim
flowchart LR
    client(["Client"])

    subgraph write ["Write Side (Command)"]
        cmd["Command Handler"]
        store["Event Store<br>(append-only)"]
        bus["Event Bus<br>(Kafka / in-process)"]
    end

    subgraph read ["Read Side (Query)"]
        proj["Projector<br>(builds read models)"]
        view[("Read Model<br>(optimised for queries)")]
    end

    client -->|"POST /orders (Command)"| cmd
    cmd -->|"append OrderCreated"| store
    store --> bus
    bus -->|"project"| proj
    proj --> view
    client -->|"GET /orders (Query)"| view
```

| Concern | Command Side | Query Side |
|---|---|---|
| Responsibility | Validates and applies mutations | Serves denormalised, query-optimised views |
| Consistency | Strong (write succeeds or fails atomically) | Eventual (read model lags behind commands) |
| Scalability | Scale for write throughput | Scale independently for read throughput |
| Storage | Normalised or event log | Denormalised, pre-joined tables or documents |

CQRS comes in degrees. The lightest form is two sets of classes over the **same database** (commands go through the domain model; queries read straight into DTOs). The next step is a **separate read store** — for example Postgres for writes and a Redis or search index for reads — kept in sync by events. The diagram above shows the heaviest form, with an event store.

!!! tip "CQRS and Event Sourcing"
    CQRS is often paired with **Event Sourcing**: rather than updating a row in a database, commands append immutable events to an event store. The read model is rebuilt by replaying those events through a projector. This combination is powerful but complex — adopt it when auditability, temporal queries, or very high read/write asymmetry justifies the overhead. Both patterns are covered in the [Event-Driven Architecture](../event_driven/index.md) class and implemented with Kafka in [Hands-on 9](../../hands-on/9/index.md).

!!! warning "CQRS pitfalls"
    - **Read-your-own-writes**: the user saves a product and the list still shows the old name, because the projection has not caught up. The UI must tolerate or hide the lag.
    - **Applying it everywhere**: Martin Fowler warns that CQRS fits only *some* parts of a system and adds risky complexity elsewhere[^5]. Use it for the hot, read-heavy part (the catalogue), not for every service.

---

## Key takeaways

- Architecture is about **who may depend on whom**: dependencies should point from volatile details (frameworks, databases, protocols) toward stable business rules.
- The classic **layered** architecture makes business logic depend on persistence; **Dependency Inversion** at the boundary flips that arrow.
- **SOLID** works at the class level; **Clean** (layers + Dependency Rule) and **Hexagonal** (ports + adapters) apply the same idea to the whole service, and are usually combined.
- The payoff is **testability and replaceability**; the cost is more classes and mappings — match the structure to the complexity of the service.
- **CQRS** splits writes from reads so each can be optimised, at the price of **eventual consistency**; it does not require Event Sourcing.

[^1]: MARTIN, R. C. *Clean Architecture: A Craftsman's Guide to Software Structure and Design*. Prentice Hall, 2017. [:fontawesome-brands-amazon:](https://www.amazon.com.br/Clean-Architecture-Craftsmans-Software-Structure/dp/B075LRM681/){:target='_blank'}

[^2]: COCKBURN, A. [Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/){:target="_blank"}, 2005.

[^3]: FOOTE, B.; YODER, J. [Big Ball of Mud](http://www.laputan.org/mud/){:target="_blank"}. PLoP '97, 1997.

[^4]: YOUNG, G. [CQRS Documents](https://cqrs.files.wordpress.com/2010/11/cqrs_documents.pdf){:target="_blank"}, 2010.

[^5]: FOWLER, M. [CQRS](https://martinfowler.com/bliki/CQRS.html){:target="_blank"}, 2011.
