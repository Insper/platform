
In [Hands-on 1](../../../hands-on/1/index.md) `AccountService` starts small: create, read, delete. Then someone adds email validation, a welcome email, an audit log, a discount rule per customer type, an admin bulk import… Six months later the class has 600 lines, every change breaks an unrelated test, and nobody can unit-test it without a database and an SMTP server. Nothing here is an *architecture* problem yet — it is a **class design** problem, and SOLID is the vocabulary for it.

**SOLID** is an acronym for five object-oriented design principles collected by Robert C. Martin[^1]. He first described them together in his 2000 paper *Design Principles and Design Patterns* and in the book *Agile Software Development: Principles, Patterns, and Practices* (2002); the acronym itself was suggested by Michael Feathers around 2004. These principles operate at the **class and module level** — they are the building blocks that Clean Architecture and Hexagonal Architecture enforce at the system level.

| Letter | Principle | Coined by |
|---|---|---|
| **S** | Single Responsibility Principle | Robert C. Martin |
| **O** | Open/Closed Principle | Bertrand Meyer, 1988[^2] |
| **L** | Liskov Substitution Principle | Barbara Liskov, 1987; formalised with Jeannette Wing in 1994[^3] |
| **I** | Interface Segregation Principle | Robert C. Martin |
| **D** | Dependency Inversion Principle | Robert C. Martin |

``` mermaid-sim
flowchart LR
    S["S — Single Responsibility\nOne reason to change"] -->|composes into| arch
    O["O — Open / Closed\nExtend, don't modify"] -->|composes into| arch
    L["L — Liskov Substitution\nSubtypes honour contracts"] -->|composes into| arch
    I["I — Interface Segregation\nNo forced dependencies"] -->|composes into| arch
    D["D — Dependency Inversion\nDepend on abstractions"] -->|composes into| arch
    arch["Clean / Hexagonal\nArchitecture"]:::highlight
    classDef highlight fill:#fcc
```

---

## S — Single Responsibility Principle

> "A class should have one, and only one, reason to change." — Robert C. Martin

A class is *responsible to* one actor[^4]. An actor is a group of users or stakeholders who care about the same concern. If a class serves two actors, changes requested by one risk breaking functionality for the other.

!!! info "What SRP does NOT mean"
    SRP does not mean a class should do only one thing. It means a class should have one *reason to change* — one owner. A service class may orchestrate several steps, but if all those steps serve the same business concern and the same stakeholder, the class has a single responsibility.

=== ":x: Violation"

    ``` { .java .copy .select linenums="1" title="AccountService.java — too many concerns" }
    --8<-- "docs/2026.2/classes/architectures/solid/examples/SrpBadAccountService.java"
    ```

    This class has **four reasons to change**: a different validation rule, a database schema change, a new email template, or a different audit format — all require modifying the same file.

=== ":white_check_mark: Applied"

    ``` { .java .copy .select linenums="1" title="AccountService.java — focused on orchestration" }
    --8<-- "docs/2026.2/classes/architectures/solid/examples/SrpGoodAccountService.java"
    ```

    Each specialist class changes for its own reason only. `AccountService` changes only when the account-creation workflow changes.

``` mermaid-sim
flowchart LR
    subgraph bad ["❌ Before — one class, many concerns"]
        as["AccountService\n• validate\n• persist\n• send email\n• audit"]
    end
    subgraph good ["✅ After — one class per concern"]
        direction TB
        as2["AccountService\n(orchestrate)"]
        r["AccountRepository\n(persist)"]
        e["EmailService\n(notify)"]
        a["AuditService\n(log)"]
        as2 --> r & e & a
    end
```

---

## O — Open/Closed Principle

> "Software entities should be open for extension, but closed for modification." — Bertrand Meyer

A module is *open* if it can be extended with new behaviour. It is *closed* if its source code is stable — existing consumers and tests do not break when new behaviour is added. The mechanism is **abstraction**: define an interface that callers depend on, then add new implementations without touching the callers.

=== ":x: Violation"

    ``` { .java .copy .select linenums="1" title="DiscountService.java — modified for every new type" }
    --8<-- "docs/2026.2/classes/architectures/solid/examples/OcpBadDiscountService.java"
    ```

=== ":white_check_mark: Applied — interface"

    ``` { .java .copy .select linenums="1" title="DiscountPolicy.java — extension point" }
    --8<-- "docs/2026.2/classes/architectures/solid/examples/OcpGoodDiscountPolicy.java"
    ```

=== ":white_check_mark: Applied — service"

    ``` { .java .copy .select linenums="1" title="DiscountService.java — closed for modification" }
    --8<-- "docs/2026.2/classes/architectures/solid/examples/OcpGoodDiscountService.java"
    ```

``` mermaid-sim
classDiagram
    class DiscountService {
        +calculate(account) double
    }
    class DiscountPolicy {
        <<interface>>
        +appliesTo(account) bool
        +calculate(account) double
    }
    class VipDiscountPolicy
    class EmployeeDiscountPolicy
    class PartnerDiscountPolicy

    DiscountService --> DiscountPolicy
    VipDiscountPolicy ..|> DiscountPolicy
    EmployeeDiscountPolicy ..|> DiscountPolicy
    PartnerDiscountPolicy ..|> DiscountPolicy
```

Adding `PartnerDiscountPolicy` requires creating one new class — `DiscountService` is never touched. In Spring, annotating each policy with `@Component` is enough: the container injects every `DiscountPolicy` bean into the `List<DiscountPolicy>` constructor parameter.

!!! warning "Closed against which changes?"
    No class is closed against every change. OCP asks you to anticipate the **likely** axis of variation (here: new customer types) and put the abstraction there. Adding extension points "just in case" produces interfaces with a single implementation forever.

---

## L — Liskov Substitution Principle

> "If S is a subtype of T, then objects of type T may be replaced with objects of type S without altering any of the desirable properties of the program." — the usual paraphrase of Barbara Liskov (1987) and Liskov & Wing (1994)

Every subtype must honour the **contract** of the supertype — not just the method signatures, but the **behaviour**. A caller that works correctly with `T` must work correctly with any `S extends T` without modification.

=== ":x: Violation — Square extends Rectangle"

    ``` { .java .copy .select linenums="1" title="Rectangle.java / Square.java — contract broken" }
    --8<-- "docs/2026.2/classes/architectures/solid/examples/LspBadSquare.java"
    ```

=== ":white_check_mark: Applied — common interface"

    ``` { .java .copy .select linenums="1" title="Shape.java — subtypes honour the contract" }
    --8<-- "docs/2026.2/classes/architectures/solid/examples/LspGoodShape.java"
    ```

``` mermaid-sim
classDiagram
    class Shape {
        <<interface>>
        +area() int
    }
    class Rectangle {
        -width int
        -height int
        +area() int
    }
    class Square {
        -side int
        +area() int
    }
    Rectangle ..|> Shape
    Square ..|> Shape
```

!!! tip "LSP and testing"
    A practical test: if substituting a subtype causes a test written for the supertype to fail, the subtype violates LSP. This is why a test suite written against an interface (`Shape`) must pass for every implementation.

!!! example "LSP in the store: test adapters"
    `InMemoryAccountRepository` (used in unit tests) and `AccountJpaAdapter` (used in production) both implement `AccountRepository`. If the database rejects a duplicate email through a `UNIQUE` constraint but the in-memory version silently overwrites it, the two are **not** substitutable: unit tests pass and production fails. Keep the behaviour the port promises — not just its method signatures — identical in every implementation, ideally by running one shared *contract test* against both.

---

## I — Interface Segregation Principle

> "Clients should not be forced to depend on interfaces they do not use." — Robert C. Martin

A fat interface forces clients to declare dependencies on methods they never call. When those methods change — for reasons unrelated to the client — the client must be recompiled and re-deployed. Smaller, focused interfaces minimise coupling.

=== ":x: Violation — fat interface"

    ``` { .java .copy .select linenums="1" title="AccountRepository.java — fat interface" }
    --8<-- "docs/2026.2/classes/architectures/solid/examples/IspBadAccountRepository.java"
    ```

=== ":white_check_mark: Applied — segregated"

    ``` { .java .copy .select linenums="1" title="AccountReader / AccountWriter / AccountAdmin" }
    --8<-- "docs/2026.2/classes/architectures/solid/examples/IspGoodAccountRepository.java"
    ```

``` mermaid-sim
classDiagram
    class AccountReader {
        <<interface>>
        +findById(id)
        +findByEmail(email)
        +findAll()
    }
    class AccountWriter {
        <<interface>>
        +save(account)
        +delete(id)
    }
    class AccountAdmin {
        <<interface>>
        +findByRole(role)
        +bulkImport(accounts)
    }
    AccountAdmin --|> AccountReader
    class JpaAccountAdapter
    JpaAccountAdapter ..|> AccountReader
    JpaAccountAdapter ..|> AccountWriter
    JpaAccountAdapter ..|> AccountAdmin

    class AccountService {
        -reader AccountReader
        -writer AccountWriter
    }
    AccountService --> AccountReader
    AccountService --> AccountWriter
```

`AccountService` depends only on `AccountReader` and `AccountWriter`. Changes to admin or reporting methods never affect it.

---

## D — Dependency Inversion Principle

> "High-level modules should not depend on low-level modules. Both should depend on abstractions. Abstractions should not depend on details. Details should depend on abstractions." — Robert C. Martin

Without DIP, high-level business logic (use cases) knows about and instantiates low-level infrastructure (databases, HTTP clients). A change to the database forces a rewrite of the business logic. DIP inverts this: the high-level module declares an interface (the abstraction), and the low-level module implements it. Both depend on the interface — the arrow of dependency points toward the business rule, not the infrastructure.

=== ":x: Violation — direct instantiation"

    ``` { .java .copy .select linenums="1" title="AccountService.java — tightly coupled to MySql" }
    --8<-- "docs/2026.2/classes/architectures/solid/examples/DipBadAccountService.java"
    ```

=== ":white_check_mark: Applied — depends on abstraction"

    ``` { .java .copy .select linenums="1" title="AccountService.java + AccountRepository + JpaAccountRepository" }
    --8<-- "docs/2026.2/classes/architectures/solid/examples/DipGoodAccountService.java"
    ```

``` mermaid-sim
flowchart LR
    subgraph bad ["❌ Before"]
        as_bad["AccountService"] -->|new| mysql["MySqlAccountRepository"]
    end
    subgraph good ["✅ After"]
        as_good["AccountService"] -->|depends on| iface["«interface»\nAccountRepository"]
        jpa["JpaAccountRepository"] -->|implements| iface
        memory["InMemoryAccountRepository\n(test)"] -->|implements| iface
    end
```

Notice **who owns the interface**: `AccountRepository` is declared next to `AccountService` (the high-level module), in business terms, and the JPA class implements it. If the interface lived in the persistence package and mirrored JPA, the dependency would not really be inverted.

DIP (a design principle) is often confused with two related mechanisms:

- **Dependency Injection** — a technique: objects receive their dependencies (usually through the constructor) instead of creating them with `new`. Spring's container does this for every `@Service`, `@Repository` and `@Component`.
- **Inversion of Control** — the general idea that a framework calls your code (and wires it), rather than your code calling the framework.

Dependency Injection is how DIP is usually *implemented* in Spring, but injecting a concrete class still couples you to it; DIP requires that the injected type be an abstraction owned by the high-level module.

DIP is the principle that makes **Clean Architecture** and **Hexagonal Architecture** possible: by inverting dependencies at every layer boundary, each layer can be developed, tested, and replaced independently.

---

## Summary

| Principle | Problem solved | Mechanism |
|---|---|---|
| **SRP** | Classes that change for multiple reasons break unrelated callers | One concern per class |
| **OCP** | Modifying existing code to add features breaks existing behaviour | Extend via new implementations of an interface |
| **LSP** | Subtypes that break supertype contracts cause subtle runtime bugs | Honour behavioural contracts, not just method signatures |
| **ISP** | Fat interfaces force callers to depend on unused methods | Split interfaces by client need |
| **DIP** | High-level logic coupled to low-level infrastructure | Both depend on an abstraction; details depend on policies |

!!! warning "SOLID is a guide, not a goal"
    - **Interface for every class.** An interface with exactly one implementation and no test double adds a file and nothing else. Introduce the abstraction when a second implementation (or a test fake) appears.
    - **SRP taken to one method per class.** Splitting too far scatters one business concept across ten files; split by *reason to change*, not by line count.
    - **Inheritance for reuse.** Most LSP violations come from `extends` used to share code; prefer composition and small interfaces.
    - **Speculative generality.** Principles applied to imagined future requirements produce complexity you pay for today (YAGNI — *You Aren't Gonna Need It*).

---

## Key takeaways

- SOLID is about **managing change**: each principle limits how far a change in one place ripples through the code.
- **SRP**: one reason to change (one actor) per class. **OCP**: add behaviour by adding classes behind an interface.
- **LSP**: subtypes and implementations must keep the **behaviour** of the contract — including test doubles and adapters.
- **ISP**: give each client a small interface with only what it uses. **DIP**: business code owns the interfaces; infrastructure implements them.
- **DIP + dependency injection** is the bridge to [Clean Architecture](../clean/index.md) and [Hexagonal Architecture](../hexagonal/index.md), where the same ideas are applied to the whole service.

---

[^1]: MARTIN, R. C. *Agile Software Development: Principles, Patterns, and Practices*. Pearson, 2002.
[^2]: MEYER, B. *Object-Oriented Software Construction*, 1st ed. Prentice Hall, 1988.
[^3]: LISKOV, B.; WING, J. [A Behavioral Notion of Subtyping](https://dl.acm.org/doi/10.1145/197320.197383){target="_blank"}. ACM TOPLAS, 1994.
[^4]: MARTIN, R. C. [The Single Responsibility Principle](https://blog.cleancoder.com/uncle-bob/2014/05/08/SingleReponsibilityPrinciple.html){target="_blank"}. The Clean Code Blog, 2014.
