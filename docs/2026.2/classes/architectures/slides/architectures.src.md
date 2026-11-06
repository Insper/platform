---
marp: true
lang: en
title: Architectures
description: Platforms, Microservices, DevOps and APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Platforms, Microservices, DevOps and APIs · Insper</div>

# Architectures

**Protect the business logic: dependencies point toward the core**

<!--
Objectives: explain each SOLID principle and spot a violation; explain the Dependency Rule and place a class in a
Clean Architecture layer; design ports and adapters (driving vs driven); compare layered, Clean and Hexagonal and
justify the extra structure; unit-test a use case with an in-memory adapter; describe CQRS and its cost.
Outline: (1) the core problem and the layered starting point; (2) SOLID; (3) Clean Architecture; (4) Hexagonal;
(5) side-by-side comparison; (6) CQRS.
-->

---

## The account service, a year from now

<div class="q">

Mobile wants an endpoint, the database team wants a managed service, security wants accounts created through a Kafka event, and someone needs tests that run in seconds. What if the rules ("an email is registered only once", "a password has at least 8 characters") are tangled with Spring annotations, SQL and HTTP status codes?

</div>

* Every one of those requests becomes a **rewrite**.
* Architecture decides **which components may know about which others**.
* Goal: **protect business logic from external concerns** — frameworks, databases and protocols change more often than business rules.

---

## The core problem

- Without a rule, dependencies accumulate in both directions: a `UserService` imports JPA annotations, a controller validates, a repository returns HTTP status codes.
- The result is a **Big Ball of Mud**: no isolated testing, no replacing parts, no parallel team work.
- The fix is one constraint: **dependencies flow in one direction only**, toward the stable core — adapters and controllers point at the core, the core **never imports** the external world (HTTP, DB, MQ, CLI).

<div class="ok">

A **dependency** = a compile-time reference (an `import`, a field type, a `new B()`). Point it from what changes often (frameworks, protocols) to what changes rarely (business rules).

</div>

---

## The starting point: layered architecture

<div class="cols">
<div>

### Layered (n-tier)

`AccountController` → `AccountService` → `JpaRepository` (Spring Data) → Postgres

A good first step, but the **business logic depends on persistence**.

</div>
<div>

### Clean / Hexagonal

`AccountService` → «interface» `AccountRepository` ← `AccountJpaAdapter` → Postgres

The service owns an interface **in business terms**; **persistence depends on the business**.

</div>
</div>

<div class="ok">

That single change is the **Dependency Inversion Principle** (the "D" in SOLID) applied at the boundary — what the next three parts develop.

</div>

---

<div class="kicker">SOLID</div>

## SOLID — class-level design

`AccountService` grows: validation, welcome e-mail, audit log, discounts, bulk import… 600 lines, unrelated tests break, no unit test without a database and an SMTP server. A **class design** problem.

| | Principle | Coined by |
|---|---|---|
| **S** | Single Responsibility | Robert C. Martin |
| **O** | Open/Closed | Bertrand Meyer, 1988 |
| **L** | Liskov Substitution | Barbara Liskov, 1987; with Jeannette Wing, 1994 |
| **I** | Interface Segregation | Robert C. Martin |
| **D** | Dependency Inversion | Robert C. Martin |

<p class="small">Collected by Martin (2000 paper; 2002 book); acronym by Michael Feathers around 2004. Class level — the building blocks that Clean and Hexagonal enforce at the system level.</p>

---

## S — Single Responsibility

> "A class should have one, and only one, reason to change."

- A class is responsible to **one actor** (a group of stakeholders with the same concern).
- Violation: `AccountService` validates, persists, sends the e-mail and audits — **four reasons to change** in one file.
- Applied: `AccountRepository` (persist), `EmailService` (notify), `AuditService` (log); `AccountService` only **orchestrates** and changes only when the account-creation workflow changes.

<div class="q">

SRP does **not** mean "do only one thing": a service may orchestrate several steps if they all serve the same concern and the same owner.

</div>

---

<!-- _class: tight -->

## O — Open/Closed

> "Open for extension, but closed for modification." — Bertrand Meyer

```java
public class DiscountService {
    private final List<DiscountPolicy> policies;   // the extension point
    public double calculate(Account account) {
        return policies.stream()
            .filter(p -> p.appliesTo(account))
            .findFirst()
            .map(p -> p.calculate(account))
            .orElse(account.orderTotal() * 0.05);
    }
}
```

- Adding `PartnerDiscountPolicy` = **one new class** with `@Component`; Spring injects every `DiscountPolicy` into the list.
- **Closed against which changes?** Put the abstraction on the **likely** axis of variation (new customer types), not "just in case".

---

## L — Liskov Substitution

Subtypes must honour the **contract** of the supertype — the behaviour, not just the signatures.

<div class="cols">
<div>

### Violation

`Square extends Rectangle` overrides the setters: `setWidth(5); setHeight(3);` → `area()` is **9**, not 15.

Fix: `Rectangle` and `Square` both implement a `Shape` interface with `area()`.

</div>
<div>

### In the store: test adapters

`InMemoryAccountRepository` and `AccountJpaAdapter` both implement `AccountRepository`. If the database rejects a duplicate email but the in-memory version overwrites it, **unit tests pass and production fails**.

</div>
</div>

<div class="ok">

A test written for the supertype must pass for every subtype: run one shared **contract test** against both adapters.

</div>

---

## I — Interface Segregation

> "Clients should not be forced to depend on interfaces they do not use."

- A fat `AccountRepository` (find, save, delete, `findByRole`, `bulkImport`…) makes every caller depend on admin and reporting methods — and recompile when they change.
- Split by client need: `AccountReader`, `AccountWriter`, `AccountAdmin` (which extends the reader).
- `JpaAccountAdapter` implements all three; `AccountService` depends only on `AccountReader` and `AccountWriter`.

---

<!-- _class: tight -->

## D — Dependency Inversion

> "High-level modules should not depend on low-level modules. Both should depend on abstractions."

```java
public interface AccountRepository {            // owned by the business code
    Optional<Account> findById(String id);
    Account save(Account account);
}
public class AccountService {                    // high-level: depends on the abstraction
    private final AccountRepository repository;
    public AccountService(AccountRepository repository) { this.repository = repository; }
}
@Repository
public class JpaAccountRepository implements AccountRepository { /* ... */ }
```

- Before: `new MySqlAccountRepository()`. After: JPA in production, `InMemoryAccountRepository` in tests.
- **Who owns the interface** matters: declared next to `AccountService`, in business terms — not mirroring JPA in the persistence package.
- **Dependency Injection** (Spring wiring beans) is the *technique*; **Inversion of Control**, the framework calling your code; DIP is the *principle*: the injected type is an abstraction owned by the high-level module.

---

## SOLID is a guide, not a goal

| Principle | Problem solved | Mechanism |
|---|---|---|
| **SRP** | classes changing for several reasons | one concern per class |
| **OCP** | editing code to add features | new implementations of an interface |
| **LSP** | subtypes breaking contracts | honour behaviour, not just signatures |
| **ISP** | fat interfaces | split by client need |
| **DIP** | logic coupled to infrastructure | both depend on an abstraction |

<div class="warn">

**Over-use**: an interface for every class (one implementation, no fake) · SRP down to one method per class · inheritance for reuse (prefer composition) · speculative generality (**YAGNI**).

</div>

---

<div class="kicker">Clean Architecture</div>

## Clean Architecture

Robert C. Martin, 2012 — a synthesis of Hexagonal, Onion, Screaming Architecture, DCI and BCE.

| Layer | Also called | Responsibility |
|---|---|---|
| **Entities** | Domain | enterprise-wide business rules and data |
| **Use Cases** | Application | what the app *does*; orchestrates Entities |
| **Interface Adapters** | Adapters | Controllers, Presenters, Gateways — convert data |
| **Frameworks & Drivers** | Infrastructure | web, DB, UI, external APIs — all detail |

<div class="ok">

**The Dependency Rule**: nothing in an inner layer references an outer layer. Data crosses boundaries as plain objects or records — no `@Entity` or `HttpServletRequest` inside a Use Case.

</div>

---

## Crossing a boundary, and where a class belongs

How does a Use Case save an account without referencing the database? **Dependency Inversion**: it declares `AccountRepository`, the outer layer implements it. At runtime the call goes **outward**; in the source code the dependency points **inward**.

- Changes when the **business** changes → **Entity or Use Case**.
- Changes when the **interface** changes (REST → gRPC, JSON → XML) → **Interface Adapter**.
- Changes when a **library** is upgraded (Spring Boot, JPA dialect) → **Frameworks & Drivers**.

<p class="small">A business rule that needs a framework annotation? Move the rule to an inner class and leave the annotation in the adapter.</p>

---

<!-- _class: tight -->

## In our architecture: Hands-on 1

| Hands-on 1 class | Role | Layer |
|---|---|---|
| `AccountController` (interface) + `AccountResource` | Interface | Interface Adapters |
| `AccountIn`, `AccountOut` | RecordIn / RecordOut: the HTTP contract | Interface Adapters |
| `AccountParser` | Parser: `Record*` ↔ use-case DTOs | boundary Adapters ↔ Use Cases |
| `AccountService` | Service: the use-case logic | Use Cases |
| `Account` | DTO / domain object | Use Cases / Entities |
| `AccountRepository` (Spring Data `CrudRepository`) | Repository | persistence boundary |
| `AccountModel` (`@Entity`) | Table, reached through a **Mapper** | persistence boundary |

<div class="warn">

**A pragmatic shortcut**: the repository extends a Spring Data interface, so the service depends on a framework type — strictly a violation. A fair trade for a small CRUD service; the strict version gives the service a plain interface and only the adapter knows JPA.

</div>

---

## `POST /accounts`, layer by layer

1. `AccountController` (adapter) receives the JSON → `service.create(AccountIn)`.
2. `AccountService` (use case) → `repository.findByEmail` — **application rule**: the email is unique.
3. `Account.of(in)` (entity) — **domain invariants**: email contains @, password ≥ 8 characters, hash it.
4. `repository.save(account)` → the port is implemented by `AccountJpaAdapter`.
5. The adapter → `AccountMapper.toTable` → `INSERT` into Postgres.
6. `AccountOut` → `201 Created`.

<div class="ok">

No rule knows Postgres exists. Payoff: use cases tested with plain JUnit, REST or persistence swapped without touching them, teams building adapters in parallel against agreed ports.

</div>

---

## Clean Architecture: common mistakes

- **Leaking framework types inward**: `@Entity`, `@Column`, `@JsonProperty` or `HttpServletRequest` in a Use Case or Entity.
- **Fat controllers**: `if` statements, several services, workflows — controllers translate and delegate, nothing more.
- **Anemic domain model**: entities as data bags with all logic in the service; move invariants into the Entity, as `Account.of(...)` does.
- **Mapping everything everywhere**: one model per layer in a CRUD service with no real rules is pure overhead; keep the strict separation where the rules are.

---

<div class="kicker">Hexagonal Architecture</div>

## Hexagonal: inside and outside

The auth service is **called** by the gateway (soon a Kafka consumer, a CLI, your tests) and **calls** account via Feign, a JWT library, Redis. For the login rules they are all **the outside world**.

Alistair Cockburn, 2005 — **Ports & Adapters**. No top or bottom: only **inside** and **outside**.

| Port | Direction | Implemented by | Example |
|---|---|---|---|
| **Primary / driving** | outside → app | the application itself | `AuthService`, called by the REST controller |
| **Secondary / driven** | app → outside | an external adapter | `AccountRepository`, implemented by JPA |

<div class="ok">

Both kinds are **owned by the core**; the adapter plugs in from outside — **the core never imports the adapter**.

</div>

---

## Ports and adapters in code

<div class="cols">
<div>

```java
// primary port, in the core
public interface AuthService {
    TokenOut login(String email,
                   String password);
    void logout(String token);
}
// secondary port, in the core
public interface AccountRepository {
    Optional<Account> findByEmail(String email);
    Account save(Account account);
}
```

</div>
<div>

- `AuthServiceImpl` implements the primary port and depends only on secondary ports.
- **Driving adapters**: `AuthController` (`POST /auth/login`), a CLI, a `@KafkaListener`, the test suite.
- **Driven adapters**: `AccountJpaAdapter` (maps `AccountTable` ↔ `Account`), Feign, Redis, a Kafka producer, `InMemoryAccountRepository`.

</div>
</div>

---

## A request through the hexagon

1. Gateway → `AuthController` (driving adapter): `POST /auth/login {email, password}`.
2. → `login(email, password)` through the **`AuthService` port** → `AuthServiceImpl` (core).
3. → `findByEmail(email)` through the **`AccountRepository` port** → `AccountJpaAdapter` → Postgres.
4. `Account` (mapped from `AccountTable`) → `matchesPassword`, generate the JWT.
5. `TokenOut` → `200 OK` + token.

<div class="ok">

Replace the gateway with a test and the JPA adapter with `InMemoryAccountRepository`: the core runs exactly the same code — that is the whole point.

</div>

---

<!-- _class: tight -->

## The store's services as hexagons

| Outside actor | Kind | Adapter in the store |
|---|---|---|
| gateway calling `POST /auth/login` | driving | `AuthResource` / `AuthController` (REST) |
| Kafka topic `accounts` | driving | a `@KafkaListener` consumer |
| JUnit test | driving | the test class itself |
| `account-service` | driven | Feign client (`AccountController` in Hands-on 3) |
| Postgres | driven | `AccountJpaAdapter` |
| Redis (cache, revoked tokens) | driven | a Redis adapter |
| Kafka (publishing `AccountCreated`) | driven | a `KafkaTemplate` adapter |

<div class="q">

**Hands-on 3 through this lens**: `AuthService` calls the Feign interface `AccountController`, defined by the `account` module — a port shaped by the remote service. The strict version declares a small port in the auth core (`AccountLookup.findByEmail`) with Feign as one adapter behind it.

</div>

---

<!-- _class: tight -->

## Test the core without infrastructure

```java
class AuthServiceTest {
    private final InMemoryAccountRepository accounts = new InMemoryAccountRepository();
    private final InMemoryTokenRepository   tokens   = new InMemoryTokenRepository();
    private final JwtService                jwt      = new JwtService("test-secret");
    private final AuthService               service  =
        new AuthServiceImpl(accounts, tokens, jwt);

    @Test
    void loginFails_whenPasswordIsWrong() {
        accounts.save(Account.of(new RegisterIn("Ada", "ada@example.com", "securepass")));

        assertThatThrownBy(() -> service.login("ada@example.com", "wrongpassword"))
            .isInstanceOf(InvalidCredentialsException.class);
    }
}
```

No `@SpringBootTest`, no H2, no port 8080 — the test drives the primary port and runs in **milliseconds**.

---

## Hexagonal: common mistakes

- **Ports defined by the adapter**: an `AccountRepository` mirroring `JpaRepository` names — name ports in **domain** terms.
- **The core importing the adapter**: any `import com.example.adapter.*` in the domain; DI resolves the adapter at runtime.
- **Wrong port granularity**: one port *per method* (`SaveAccountPort`, `FindAccountByEmailPort`…) explodes; group by cohesion. One interface per **use case** on the driving side is a legitimate style — pick one convention per service.
- **Leaking domain objects through the driving adapter**: returning `Account` (with its `passwordHash`) from the controller couples HTTP to the domain and leaks a secret — return `TokenOut`, `AccountOut`.

---

<div class="kicker">Comparison</div>

<!-- _class: tight -->

## Side by side

| Concern | Layered (n-tier) | Clean | Hexagonal |
|---|---|---|---|
| **Core abstraction** | horizontal layers | concentric layers + Dependency Rule | hexagon + ports & adapters |
| **Dependency direction** | top-down, toward the database | always inward | always toward the core |
| **Vocabulary** | Controller · Service · Repository | Entities · Use Cases · Interface Adapters · Frameworks & Drivers | Domain · Application Services · Ports · Adapters |
| **Testing** | usually needs a database (or mocks of framework types) | inner layers in isolation | core tested by substituting adapters |
| **Flexibility** | swapping the DB touches the services | framework and DB can be swapped | any external system can be swapped |
| **Relationship** | the usual starting point | builds on Hexagonal and Onion, naming the inner layers | the original boundary idea |

<div class="ok">

Complementary: **Hexagonal** defines *how* the boundary works; **Clean** defines *what* goes inside it. Most modern microservices combine both.

</div>

---

## Do not over-architect a CRUD service

Ports, adapters and mappers cost **more classes, more conversions, more indirection** to read.

- A service that only stores and returns records (a lookup table, a simple catalogue) can **stay layered**.
- The structure pays off when the **business rules are rich**, the service **lives long**, or you need to **swap or add** delivery mechanisms and data stores.

<div class="ok">

Microservices help: each service chooses the level of structure it needs.

</div>

---

<div class="kicker">CQRS</div>

## CQRS — Command Query Responsibility Segregation

The catalogue: thousands of `GET /products?category=...` per second, a few `PUT /products/{id}` per hour. One model must be normalised for safe writes **and** denormalised for fast searches — and serves neither well.

- Split the **write side** (commands mutate state) from the **read side** (queries return views): modelled, stored and scaled independently.
- Extends Bertrand Meyer's *Command-Query Separation* (a method changes state or returns data, never both) from methods to whole models; named by Greg Young around 2010.
- Heaviest form: `POST /orders` → command handler → event store (append `OrderCreated`) → event bus → projector → read model ← `GET /orders`.

---

<!-- _class: tight -->

## CQRS: the two sides, and its degrees

| Concern | Command side | Query side |
|---|---|---|
| **Responsibility** | validates and applies mutations | serves denormalised, query-optimised views |
| **Consistency** | strong (atomic success or failure) | **eventual** (the read model lags) |
| **Scalability** | write throughput | read throughput, independently |
| **Storage** | normalised or event log | denormalised, pre-joined tables or documents |

- Lightest: two sets of classes over the **same database**. Middle: a **separate read store** (Redis, a search index) fed by events. Heaviest: an **event store**.
- Often paired with **Event Sourcing** (commands append immutable events; the read model is rebuilt by replay) — but CQRS does not require it. See the Event-Driven class and Hands-on 10.

<div class="warn">

**Read-your-own-writes**: the user saves a product and the list still shows the old name — the UI must tolerate or hide the lag. **Applying it everywhere**: Fowler warns CQRS fits only *some* parts of a system — use it for the hot, read-heavy part.

</div>

---

## Takeaways

1. Architecture is about **who may depend on whom**: from volatile details (frameworks, databases, protocols) toward stable business rules.
2. The classic **layered** architecture makes business logic depend on persistence; **Dependency Inversion** at the boundary flips that arrow.
3. **SOLID** works at the class level; **Clean** (layers + Dependency Rule) and **Hexagonal** (ports + adapters) apply the same idea to the whole service, and are usually combined.
4. Ports are **owned by the core** and named in domain terms; swapping adapters tests the core in **milliseconds**.
5. The payoff is **testability and replaceability**; the cost is more classes and mappings — match the structure to the complexity of the service.
6. **CQRS** splits writes from reads, at the price of **eventual consistency**; it does not require Event Sourcing.
