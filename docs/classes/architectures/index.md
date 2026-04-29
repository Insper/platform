
Software architecture defines how the components of a system are organised, how they communicate, and — most importantly — which components are **allowed to know about which others**. The two architectures covered here share the same foundational goal: **protect business logic from external concerns** such as frameworks, databases, and delivery mechanisms.

This separation matters because external concerns change more often than business rules. A database migration, a framework upgrade, or a new API protocol should not require rewriting core logic.

---

## The core problem

Without an explicit architectural rule, dependencies accumulate in both directions. A `UserService` ends up importing JPA annotations; a controller contains validation logic; a repository method returns HTTP status codes. The result is a **Big Ball of Mud** — a system where every component knows about every other, making isolated testing, replacement of parts, and parallel team work impossible.

Both architectures solve this through a single constraint: **dependencies flow in one direction only**, pointing toward the stable core.

``` mermaid
flowchart LR
  External["External World\n(HTTP, DB, MQ, CLI)"]
  Core["Application Core\n(Business Rules)"]
  External -->|adapters / controllers| Core
  Core -.->|never imports| External
```

---

## Architectures covered

<div class="grid cards" markdown>

-   :material-layers:{ .lg .middle } **Clean Architecture**

    ---

    Organises code into concentric layers with an explicit **Dependency Rule**: nothing in an inner layer may reference anything in an outer layer. Proposed by Robert C. Martin as a synthesis of Hexagonal, Onion, and BCE.

    [:octicons-arrow-right-24: Clean Architecture](clean/index.md)

-   :material-hexagon-outline:{ .lg .middle } **Hexagonal Architecture**

    ---

    Places the application core at the centre and exposes it through **ports** (interfaces). External systems connect via **adapters**. Also called *Ports & Adapters*, introduced by Alistair Cockburn in 2005.

    [:octicons-arrow-right-24: Hexagonal Architecture](hexagonal/index.md)

</div>

---

## Side-by-side comparison

| Concern | Clean Architecture | Hexagonal Architecture |
|---|---|---|
| Core abstraction | Concentric layers + Dependency Rule | Hexagon + Ports & Adapters |
| Dependency direction | Always inward | Always toward the core |
| Vocabulary | Entities · Use Cases · Adapters · Frameworks | Domain · Application Services · Ports · Adapters |
| Testing strategy | Inner layers testable in isolation | Core testable by substituting adapters |
| Flexibility | Framework and DB can be swapped | Any external system can be swapped |
| Relationship | Incorporates Hexagonal ideas | Clean Architecture is a superset |

!!! tip "Which to use?"
    The two architectures are complementary and commonly used together. Think of **Hexagonal** as defining *how* the application boundary works (ports & adapters), and **Clean Architecture** as defining *what* goes inside those boundaries (layers with explicit dependency policies). Most modern microservices combine both.

---

[^1]: MARTIN, R. C. *Clean Architecture: A Craftsman's Guide to Software Structure and Design*. Prentice Hall, 2017. [:fontawesome-brands-amazon:](https://www.amazon.com.br/Clean-Architecture-Craftsmans-Software-Structure/dp/B075LRM681/){:target='_blank'}

[^2]: COCKBURN, A. [Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/){:target="_blank"}, 2005.
