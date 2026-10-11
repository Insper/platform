
Look at the `auth-service` of [Hands-on 3](../../../hands-on/3/index.md) from the outside. It is *called* by the gateway over HTTP, and could soon be called by a Kafka consumer or a CLI tool for administrators; your tests want to call it too. It *calls* other things: `account-service` via Feign, a JWT library, maybe Redis for revoked tokens. Layer diagrams draw HTTP "on top" and the database "at the bottom", but for the business logic they are the same kind of thing — **the outside world** — and each of them should be replaceable without touching the login rules.

[Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/){:target="_blank"} — also called **Ports & Adapters** — was introduced by Alistair Cockburn in 2005. The idea is to place the application core at the centre and expose it through *ports* (interfaces), which external *adapters* connect to. The hexagon shape is arbitrary; it signals that the application has multiple equivalent entry/exit points with no privileged side — there is no "top" and "bottom", only **inside** and **outside**[^1].

``` mermaid-sim
flowchart LR
  subgraph hexagon [Application Core]
    domain[Domain Model]
    app[Application Services]
    inport[«port»\nDriving Interfaces]:::port
    outport[«port»\nDriven Interfaces]:::port
    domain <--> app
    app --> inport
    app --> outport
  end

  rest([REST Controller]):::adapter -->|driving adapter| inport
  cli([CLI]):::adapter -->|driving adapter| inport
  test([Test Suite]):::adapter -->|driving adapter| inport

  outport -->|driven adapter| db[(Database)]:::adapter
  outport -->|driven adapter| mq([Message Broker]):::adapter
  outport -->|driven adapter| ext([External API]):::adapter

  classDef port fill:#adf,stroke:#36c
  classDef adapter fill:#fd9,stroke:#a60
```

---

## Ports

A **port** is a pure interface — a contract defined *by* the application core, not by the external technology. There are two kinds:

| Type | Direction | Defined by | Implemented by | Example |
|---|---|---|---|---|
| **Primary / Driving port** | Outside → App | The application | The application itself | `AuthService` interface called by the REST controller |
| **Secondary / Driven port** | App → Outside | The application | An external adapter | `AccountRepository` implemented by JPA adapter |

!!! info "Ownership matters"
    Both port types are *owned and defined by the application core*. The adapter is the piece that lives outside and plugs into the port — **the core never imports the adapter**.

### Primary (driving) ports

Primary ports represent *what the application can do* — they are the use-case API. Any external actor that wants to interact with the application must go through a primary port.

```java
// Defined inside the application core
public interface AuthService {
    TokenOut login(String email, String password);
    void logout(String token);
}
```

The implementation of this interface also lives inside the core — it is the application service:

```java
// Also inside the core — depends only on secondary ports
public class AuthServiceImpl implements AuthService {
    private final AccountRepository accounts; // ← secondary port
    private final JwtService jwt;

    @Override
    public TokenOut login(String email, String password) {
        Account account = accounts.findByEmail(email)
            .filter(a -> a.matchesPassword(password))
            .orElseThrow(InvalidCredentialsException::new);
        return new TokenOut(jwt.generate(account));
    }
}
```

### Secondary (driven) ports

Secondary ports represent *what the application needs* from the outside world — persistence, messaging, external APIs. The core defines the interface; the infrastructure provides the implementation.

```java
// Defined inside the application core
public interface AccountRepository {
    Optional<Account> findByEmail(String email);
    Account save(Account account);
}
```

---

## Adapters

An adapter is a class that **translates** between an external technology and a port contract. It lives outside the core and depends on it — never the reverse.

=== "Driving adapter (REST)"

    ```java
    // Adapter: translates HTTP → primary port
    @RestController
    public class AuthController {
        private final AuthService authService; // ← primary port

        public AuthController(AuthService authService) {
            this.authService = authService;
        }

        @PostMapping("/auth/login")
        public ResponseEntity<TokenOut> login(@RequestBody LoginIn in) {
            TokenOut token = authService.login(in.email(), in.password());
            return ResponseEntity.ok(token);
        }
    }
    ```

=== "Driving adapter (CLI)"

    ```java
    // Any driver can plug into the same primary port
    public class AuthCLI {
        private final AuthService authService;

        public void run(String[] args) {
            String email = args[0], password = args[1];
            TokenOut token = authService.login(email, password);
            System.out.println("Token: " + token.token());
        }
    }
    ```

=== "Driven adapter (JPA)"

    ```java
    // Adapter: translates secondary port → JPA
    @Repository
    public class AccountJpaAdapter implements AccountRepository {

        private final AccountJpaRepository jpa;

        @Override
        public Optional<Account> findByEmail(String email) {
            return jpa.findByEmail(email).map(AccountMapper::toDomain);
        }

        @Override
        public Account save(Account account) {
            AccountTable table = AccountMapper.toTable(account);
            return AccountMapper.toDomain(jpa.save(table));
        }
    }
    ```

=== "Driven adapter (in-memory / test)"

    ```java
    // Swap the JPA adapter for a map in tests — no Spring context needed
    public class InMemoryAccountRepository implements AccountRepository {
        private final Map<String, Account> store = new HashMap<>();

        @Override
        public Optional<Account> findByEmail(String email) {
            return Optional.ofNullable(store.get(email));
        }

        @Override
        public Account save(Account account) {
            store.put(account.email(), account);
            return account;
        }
    }
    ```

<figure markdown>
  ![Hexagonal Architecture](https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/Hexagonal_Architecture.svg/1920px-Hexagonal_Architecture.svg.png){ width="80%" }
  <figcaption><i>Source: <a href="https://en.wikipedia.org/wiki/Hexagonal_architecture_(software)" target="_blank">Wikipedia — Hexagonal Architecture</a></i></figcaption>
</figure>

---

### A request through the hexagon

A login crosses the hexagon twice: in through a primary port, out through a secondary port, and back.

``` mermaid-sim
sequenceDiagram
    autonumber
    participant GW as gateway
    participant In as AuthController (driving adapter)
    participant Core as AuthServiceImpl (core)
    participant Out as AccountJpaAdapter (driven adapter)
    participant DB as Postgres
    GW->>In: POST /auth/login {email, password}
    In->>Core: login(email, password) via AuthService port
    Core->>Out: findByEmail(email) via AccountRepository port
    Out->>DB: SELECT ... WHERE email = ?
    DB-->>Out: row
    Out-->>Core: Account (mapped from AccountTable)
    Core->>Core: matchesPassword, generate JWT
    Core-->>In: TokenOut
    In-->>GW: 200 OK + token
```

Replace the first participant with a test and the fourth with `InMemoryAccountRepository`, and the core runs exactly the same code — that is the whole point.

### The store's services as hexagons

| Outside actor | Kind | Adapter in the store |
|---|---|---|
| Gateway calling `POST /auth/login` | driving | `AuthResource` / `AuthController` (REST) |
| Kafka topic `accounts` (see [Hands-on 9](../../../hands-on/9/index.md)) | driving | a `@KafkaListener` consumer |
| JUnit test | driving | the test class itself |
| `account-service` | driven | Feign client (`AccountController` in Hands-on 3) |
| Postgres | driven | `AccountJpaAdapter` |
| Redis (cache, revoked tokens) | driven | a Redis adapter (see [Hands-on 8](../../../hands-on/8/index.md)) |
| Kafka (publishing `AccountCreated`) | driven | a `KafkaTemplate` adapter |

!!! info "Hands-on 3, read through this lens"
    In Hands-on 3, `AuthService` calls the Feign interface `AccountController` directly. That interface is defined by the `account` API module, not by the auth core — so the port is shaped by the remote service, and a change in `account`'s API reaches the login logic. The strict hexagonal version declares a small port in the auth core (for example `AccountLookup.findByEmail`) and makes the Feign client one adapter behind it.

---

## Full working example

The files below show the complete authentication slice of the `auth-service`. Each file is annotated with its location relative to the hexagon boundary.

=== "AuthService.java — primary port"

    ``` { .java .copy .select linenums="1" }
    --8<-- "docs/2026.2/classes/architectures/hexagonal/examples/AuthService.java"
    ```

=== "AuthServiceImpl.java — core implementation"

    ``` { .java .copy .select linenums="1" }
    --8<-- "docs/2026.2/classes/architectures/hexagonal/examples/AuthServiceImpl.java"
    ```

=== "AccountRepository.java — secondary port"

    ``` { .java .copy .select linenums="1" }
    --8<-- "docs/2026.2/classes/architectures/hexagonal/examples/AccountRepository.java"
    ```

=== "AuthController.java — driving adapter"

    ``` { .java .copy .select linenums="1" }
    --8<-- "docs/2026.2/classes/architectures/hexagonal/examples/AuthController.java"
    ```

=== "AccountJpaAdapter.java — driven adapter"

    ``` { .java .copy .select linenums="1" }
    --8<-- "docs/2026.2/classes/architectures/hexagonal/examples/AccountJpaAdapter.java"
    ```

=== "InMemoryAccountRepository.java — test adapter"

    ``` { .java .copy .select linenums="1" }
    --8<-- "docs/2026.2/classes/architectures/hexagonal/examples/InMemoryAccountRepository.java"
    ```

---

## Testing strategy

The key testing insight of Hexagonal Architecture is that the **application core can be fully tested without any infrastructure**. Replace every driven adapter with an in-memory stub; drive the primary port directly from a test.

``` mermaid-sim
flowchart LR
  test([JUnit Test]):::adapter -->|drives| AuthService
  AuthService --> AccountRepository
  AccountRepository -->|implemented by| InMemory([InMemoryAccountRepository]):::adapter

  classDef adapter fill:#fd9,stroke:#a60
```

``` { .java .copy .select linenums="1" title="AuthServiceTest.java" }
--8<-- "docs/2026.2/classes/architectures/hexagonal/examples/AuthServiceTest.java"
```

No Spring `@SpringBootTest`, no H2, no port 8080 — the test runs in milliseconds and covers the business rule directly.

---

## Suggested package layout

```
com.example.auth/
├── domain/                         ← Domain Model
│   └── Account.java                # Aggregate root — no framework annotations
├── application/                    ← Application Services + Ports
│   ├── AuthService.java            # Primary port (interface)
│   ├── AuthServiceImpl.java        # Primary port implementation
│   └── port/
│       └── AccountRepository.java  # Secondary port (interface)
├── adapter/
│   ├── in/
│   │   └── AuthController.java     # Driving adapter (REST)
│   └── out/
│       ├── AccountJpaAdapter.java  # Driven adapter (JPA)
│       ├── AccountTable.java       # @Entity — stays in the adapter
│       └── AccountMapper.java
```

---

## Common mistakes

!!! warning "Ports defined by the adapter"
    If the `AccountRepository` interface mirrors the Spring Data `JpaRepository` method names, it is being shaped by JPA rather than by the application's needs. Define ports in terms of domain concepts, not persistence concepts.

!!! warning "The core importing the adapter"
    Any `import com.example.adapter.*` inside the domain or application package is an immediate violation. Dependency injection (Spring, CDI) should resolve the adapter at runtime, not at compile time.

!!! warning "Wrong port granularity"
    One port *per method* (`FindAccountByEmailPort`, `SaveAccountPort`, `DeleteAccountPort`…) leads to interface explosion. Group operations by cohesion — `AccountRepository` is one port for one concept. On the driving side, one interface per **use case** (`RegisterAccountUseCase`, `LoginUseCase`) is a legitimate style that keeps each interface small (ISP); a single `AuthService` with a few related methods is also fine. Pick one convention per service and keep it.

!!! warning "Leaking domain objects through the driving adapter"
    Returning the domain `Account` (with its `passwordHash`) straight from the REST controller couples the HTTP contract to the domain — and here leaks a secret. Driving adapters convert domain results into response records (`TokenOut`, `AccountOut`).

---

## Key takeaways

- The application has an **inside** (domain + application services) and an **outside** (everything else); there is no privileged top or bottom.
- **Ports** are interfaces owned by the core: **driving/primary** ports say what the application *offers*; **driven/secondary** ports say what it *needs*.
- **Adapters** translate between a technology and a port: REST, CLI, Kafka listeners and tests *drive* the core; JPA, Feign, Redis and Kafka producers are *driven* by it.
- Ports are named in **domain terms**, never shaped by the technology behind them.
- Swapping driven adapters for in-memory ones lets the core be tested with plain JUnit in milliseconds — compare with the layers of [Clean Architecture](../clean/index.md), which describe the inside of the hexagon.

Video introductions: CodeOpinion[^2] (English) and Fernanda Kipper[^3] (Portuguese).

---

[^1]: COCKBURN, A. [Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/){:target="_blank"}, 2005.

[^2]: :fontawesome-brands-youtube:{ .youtube } [Hexagonal Architecture — What Is It? Why Should You Use It?](https://www.youtube.com/watch?v=bDWApqAUjEI){:target="_blank"} by CodeOpinion

[^3]: :fontawesome-brands-youtube:{ .youtube } [Arquitetura Hexagonal na Prática | Arquitetura com Java e Spring Boot](https://www.youtube.com/watch?v=UKSj5VJEzps){:target="_blank"} by Fernanda Kipper
