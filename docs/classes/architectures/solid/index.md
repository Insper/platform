
**SOLID** is an acronym for five object-oriented design principles introduced by Robert C. Martin[^1]. They were first articulated in his 2000 paper *Design Principles and Design Patterns* and popularised by the book *Clean Code* (2008). These principles operate at the **class and module level** — they are the building blocks that Clean Architecture and Hexagonal Architecture enforce at the system level.

| Letter | Principle | Coined by |
|---|---|---|
| **S** | Single Responsibility Principle | Robert C. Martin |
| **O** | Open/Closed Principle | Bertrand Meyer, 1988[^2] |
| **L** | Liskov Substitution Principle | Barbara Liskov, 1987[^3] |
| **I** | Interface Segregation Principle | Robert C. Martin |
| **D** | Dependency Inversion Principle | Robert C. Martin |

``` mermaid
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

A class is *responsible to* one actor. An actor is a group of users or stakeholders who care about the same concern. If a class serves two actors, changes requested by one risk breaking functionality for the other.

!!! info "What SRP does NOT mean"
    SRP does not mean a class should do only one thing. It means a class should have one *reason to change* — one owner. A service class may orchestrate several steps, but if all those steps serve the same business concern and the same stakeholder, the class has a single responsibility.

=== ":x: Violation"

    ``` { .java .copy .select linenums="1" title="AccountService.java — too many concerns" }
    --8<-- "docs/classes/architectures/solid/examples/SrpBadAccountService.java"
    ```

    This class has **four reasons to change**: a different validation rule, a database schema change, a new email template, or a different audit format — all require modifying the same file.

=== ":white_check_mark: Applied"

    ``` { .java .copy .select linenums="1" title="AccountService.java — focused on orchestration" }
    --8<-- "docs/classes/architectures/solid/examples/SrpGoodAccountService.java"
    ```

    Each specialist class changes for its own reason only. `AccountService` changes only when the account-creation workflow changes.

``` mermaid
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
    --8<-- "docs/classes/architectures/solid/examples/OcpBadDiscountService.java"
    ```

=== ":white_check_mark: Applied — interface"

    ``` { .java .copy .select linenums="1" title="DiscountPolicy.java — extension point" }
    --8<-- "docs/classes/architectures/solid/examples/OcpGoodDiscountPolicy.java"
    ```

=== ":white_check_mark: Applied — service"

    ``` { .java .copy .select linenums="1" title="DiscountService.java — closed for modification" }
    --8<-- "docs/classes/architectures/solid/examples/OcpGoodDiscountService.java"
    ```

``` mermaid
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

Adding `PartnerDiscountPolicy` requires creating one new class — `DiscountService` is never touched.

---

## L — Liskov Substitution Principle

> "If S is a subtype of T, then objects of type T may be replaced with objects of type S without altering any of the desirable properties of the program." — Barbara Liskov, 1987

Every subtype must honour the **contract** of the supertype — not just the method signatures, but the **behaviour**. A caller that works correctly with `T` must work correctly with any `S extends T` without modification.

=== ":x: Violation — Square extends Rectangle"

    ``` { .java .copy .select linenums="1" title="Rectangle.java / Square.java — contract broken" }
    --8<-- "docs/classes/architectures/solid/examples/LspBadSquare.java"
    ```

=== ":white_check_mark: Applied — common interface"

    ``` { .java .copy .select linenums="1" title="Shape.java — subtypes honour the contract" }
    --8<-- "docs/classes/architectures/solid/examples/LspGoodShape.java"
    ```

``` mermaid
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

---

## I — Interface Segregation Principle

> "Clients should not be forced to depend on interfaces they do not use." — Robert C. Martin

A fat interface forces clients to declare dependencies on methods they never call. When those methods change — for reasons unrelated to the client — the client must be recompiled and re-deployed. Smaller, focused interfaces minimise coupling.

=== ":x: Violation — fat interface"

    ``` { .java .copy .select linenums="1" title="AccountRepository.java — fat interface" }
    --8<-- "docs/classes/architectures/solid/examples/IspBadAccountRepository.java"
    ```

=== ":white_check_mark: Applied — segregated"

    ``` { .java .copy .select linenums="1" title="AccountReader / AccountWriter / AccountAdmin" }
    --8<-- "docs/classes/architectures/solid/examples/IspGoodAccountRepository.java"
    ```

``` mermaid
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
    --8<-- "docs/classes/architectures/solid/examples/DipBadAccountService.java"
    ```

=== ":white_check_mark: Applied — depends on abstraction"

    ``` { .java .copy .select linenums="1" title="AccountService.java + AccountRepository + JpaAccountRepository" }
    --8<-- "docs/classes/architectures/solid/examples/DipGoodAccountService.java"
    ```

``` mermaid
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

---

[^1]: MARTIN, R. C. *Agile Software Development: Principles, Patterns, and Practices*. Pearson, 2002.
[^2]: MEYER, B. *Object-Oriented Software Construction*, 1st ed. Prentice Hall, 1988.
[^3]: LISKOV, B.; WING, J. [A Behavioral Notion of Subtyping](https://dl.acm.org/doi/10.1145/197320.197383){target="_blank"}. ACM TOPLAS, 1994.
[^4]: MARTIN, R. C. [The Single Responsibility Principle](https://blog.cleancoder.com/uncle-bob/2014/05/08/SingleReponsibilityPrinciple.html){target="_blank"}. The Clean Code Blog, 2014.
