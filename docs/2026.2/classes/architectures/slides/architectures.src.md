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
Outline: (1) the Big Ball of Mud; layered vs. inverted dependencies; (2) SOLID at the class level;
(3) Clean Architecture: layers, the Dependency Rule, Hands-on 1 mapping; (4) Hexagonal: ports,
adapters, the store's adapters, testing; (5) Clean vs. Hexagonal, when not to; (6) CQRS; (7) mistakes.
-->

---

## Who knows about whom?

<div class="q">

A `UserService` imports JPA annotations, a controller validates input, a repository returns HTTP status codes. What happens when you **switch the database**?

</div>

* Every component knows about every other: a **Big Ball of Mud**.
* No isolated testing, no replacing parts, no parallel team work.
* External concerns (DB, framework, protocol) **change more often** than business rules — and drag the rules along.

---

## One rule: flip the arrow

<div class="cols">
<div>

### Layered (n-tier)

`Controller` → `Service` → `JpaRepository` → Postgres

The **business logic depends on persistence**.

</div>
<div>

### Clean / Hexagonal

`Service` → «interface» `AccountRepository` ← `AccountJpaAdapter` → Postgres

**Persistence depends on the business**.

</div>
</div>

<div class="ok">

**Dependencies flow in one direction only**, toward the stable core. The core **never imports** the external world (HTTP, DB, MQ, CLI).

</div>

<!--
Runtime calls still go service → DB; only the compile-time dependency flips. SOLID's D does this.
-->

---

## SOLID — class-level design

| | Principle | Problem solved → mechanism |
|---|---|---|
| **S** | Single Responsibility | one class, many reasons to change → **one concern per class** |
| **O** | Open/Closed | editing code to add features → **new implementations of an interface** |
| **L** | Liskov Substitution | subtypes break contracts → **honour behaviour, not just signatures** |
| **I** | Interface Segregation | fat interfaces → **split by client need** |
| **D** | Dependency Inversion | logic coupled to infrastructure → **both depend on an abstraction** |

<p class="small">Collected by Robert C. Martin (2000–2002); acronym by Michael Feathers; Open/Closed from Bertrand Meyer (1988); Liskov from Barbara Liskov (1987).</p>

---

## S and O

<div class="cols">
<div>

### Single Responsibility

> One, and only one, reason to change.

`AccountService` that validates, persists, emails and audits has **four reasons to change**.

Split: `AccountRepository`, `EmailService`, `AuditService`; the service only **orchestrates**.

</div>
<div>

### Open/Closed

> Open for extension, closed for modification.

`DiscountService` depends on the `DiscountPolicy` interface.

Adding `PartnerDiscountPolicy` = **one new class**; `DiscountService` is never touched.

</div>
</div>

---

## L and I

<div class="cols">
<div>

### Liskov Substitution

`Square extends Rectangle` overrides the setters:

`setWidth(5); setHeight(3);` → `area()` is **9**, not 15.

Fix: both implement a `Shape` interface with `area()`.

</div>
<div>

### Interface Segregation

A fat `AccountRepository` forces callers to depend on admin methods.

Split into `AccountReader`, `AccountWriter`, `AccountAdmin`: `AccountService` uses only the first two.

</div>
</div>

<p class="small">LSP test: a test written for the supertype must pass for every subtype — including <code>InMemoryAccountRepository</code> vs. the JPA adapter (same duplicate-email behaviour).</p>

---

## D — Dependency Inversion

```java
public interface AccountRepository {           // the abstraction
    Optional<Account> findById(String id);
    Account save(Account account);
}
public class AccountService {                   // high-level: depends on it
    private final AccountRepository repository;
    public AccountService(AccountRepository repository) { ... }
}
@Repository
public class JpaAccountRepository implements AccountRepository { ... }
```

Before: `new MySqlAccountRepository()`. Now JPA, or `InMemoryAccountRepository` in tests, plug in.

<p class="small">DI (Spring injecting beans) is the <i>mechanism</i>; DIP is the <i>principle</i>: the injected type is an abstraction <b>owned by the business code</b>.</p>

<!--
DIP is what makes Clean and Hexagonal possible: invert the dependency at every boundary.
-->

---

## Clean Architecture

Robert C. Martin, 2012 — a synthesis of Hexagonal, Onion, BCE and others.

| Layer | Also called | Responsibility |
|---|---|---|
| **Entities** | Domain | enterprise-wide business rules |
| **Use Cases** | Application | what the app *does*; orchestrates Entities |
| **Interface Adapters** | Adapters | Controllers, Presenters, Gateways — convert data |
| **Frameworks & Drivers** | Infrastructure | web, DB, UI, external APIs — all detail |

<div class="ok">

**The Dependency Rule**: nothing in an inner layer references an outer layer. No `@Entity` or `HttpServletRequest` inside a Use Case.

</div>

---

## Where does a class belong?

- Changes when the **business** changes → **Entity or Use Case**.
- Changes when the **interface** changes (REST → gRPC, JSON → XML) → **Interface Adapter**.
- Changes when a **library** is upgraded (Spring Boot, JPA dialect) → **Frameworks & Drivers**.

Hands-on 1: `AccountResource` + `AccountIn/Out` (adapters) → **`AccountParser`** → `AccountService` (use case) → `AccountRepository` → `AccountModel` (`@Entity`)

<p class="small">Shortcut: Hands-on 1's repository is a Spring Data interface — a framework type in the use case. Fine for a small CRUD service; the strict version adds a port + adapter + <b>Mapper</b>.</p>

---

## `POST /accounts`, layer by layer

1. `AccountController` (adapter) receives JSON → `service.create(AccountIn)`.
2. `AccountService` (use case) → `repository.findByEmail` — **application rule**: email is unique.
3. `Account.of(in)` (entity) — **domain invariants**: valid email, password ≥ 8 chars, hash it.
4. `repository.save(account)` → the port is implemented by `AccountJpaAdapter`.
5. Adapter → `AccountMapper.toTable` → JPA `INSERT` into Postgres.
6. `AccountOut` → `201 Created`.

<div class="ok">

Calls go **outward** at runtime; source dependencies point **inward**. No rule knows Postgres exists.

</div>

---

## Hexagonal: ports & adapters

Alistair Cockburn, 2005. A **port** is an interface **owned by the core**; an **adapter** plugs into it from outside.

| Port | Direction | Implemented by | Example |
|---|---|---|---|
| **Primary / driving** | outside → app | the application | `AuthService`, called by the REST controller |
| **Secondary / driven** | app → outside | an external adapter | `AccountRepository`, implemented by JPA |

- Driving adapters: REST controller, `@KafkaListener`, CLI, the **test suite**.
- Driven adapters: JPA (Postgres), Feign (`account-service`), Redis, Kafka producer, in-memory fakes.

<p class="small">The hexagon shape is arbitrary: many equivalent entry/exit points, no privileged side.</p>

---

## Test the core without infrastructure

```java
class AuthServiceTest {
    InMemoryAccountRepository accounts = new InMemoryAccountRepository();
    AuthService service = new AuthServiceImpl(accounts, tokens, jwt); // tokens: in-memory too

    @Test
    void loginFails_whenPasswordIsWrong() {
        accounts.save(Account.of(new RegisterIn("Ada", "ada@example.com", "securepass")));
        assertThatThrownBy(() -> service.login("ada@example.com", "wrongpassword"))
            .isInstanceOf(InvalidCredentialsException.class);
    }
}
```

No `@SpringBootTest`, no H2, no port 8080 — runs in **milliseconds**.

---

## Clean × Hexagonal

| Concern | Clean | Hexagonal |
|---|---|---|
| Core abstraction | concentric layers + Dependency Rule | hexagon + ports & adapters |
| Dependency direction | always inward | always toward the core |
| Vocabulary | Entities · Use Cases · Adapters · Frameworks | Domain · App Services · Ports · Adapters |
| Testing | inner layers in isolation | substitute adapters |

<div class="ok">

Complementary: **Hexagonal** defines *how* the boundary works; **Clean** defines *what* goes inside it. Most modern microservices combine both.

</div>

<p class="small">Don't over-architect a CRUD service: ports and mappers pay off with rich rules, long life, or swappable I/O.</p>

---

## CQRS

Most apps read far more than they write: split **commands** from **queries**.

- Lightest: two sets of classes over the **same DB**.
- Middle: a **separate read store** (e.g. Redis, search index) fed by events.
- Heaviest: `POST /orders` → Event Store → Kafka → Projector → **Read Model** ← `GET /orders`.

| | Command side | Query side |
|---|---|---|
| Consistency | strong | **eventual** (read model lags) |
| Scalability | write throughput | read throughput, independently |
| Storage | normalised or event log | denormalised, pre-joined |

<p class="small">Pitfall: read-your-own-writes. Event Sourcing is optional — see the Event-Driven class and Hands-on 9.</p>

---

## Common mistakes

<div class="warn">

- **Leaking framework types inward**: `@Entity`, `@JsonProperty`, `HttpServletRequest` in a Use Case.
- **Fat controllers**: `if` statements and orchestration — controllers translate and delegate.
- **Anemic domain model**: entities as data bags; move invariants into the Entity.
- **Ports shaped by the adapter**: mirroring `JpaRepository` names instead of domain concepts.
- **The core importing the adapter**: `import com.example.adapter.*` in the domain.
- **Port per method**: `SaveAccountPort`, `FindAccountPort`… → interface explosion.

</div>

---

## Takeaways

1. Without a rule you get a **Big Ball of Mud**; the fix is **one dependency direction**, toward the core — flip the layered arrow.
2. **SOLID** is the class-level foundation; **DIP** is what makes the architectures possible.
3. **Clean**: Entities → Use Cases → Adapters → Frameworks; the **Dependency Rule** points inward.
4. **Hexagonal**: the core owns the **ports**; **adapters** plug in from outside.
5. Swap adapters to test the core in **milliseconds**, without Spring or a database.
6. Clean and Hexagonal are **complementary** — most microservices use both.
7. **CQRS** splits writes from reads, at the price of **eventual consistency** — use it where reads dominate.
