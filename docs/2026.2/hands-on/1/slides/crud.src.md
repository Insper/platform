---
marp: true
lang: en
title: Hands-on 1 — CRUD
description: Platforms, Microservices, DevOps and APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Platforms, Microservices, DevOps and APIs · Hands-on 1</div>

# Hands-on 1 — CRUD

**One microservice, four layers, one database: the Account service**

<!--
Outline: (1) goal and the two modules; (2) clean architecture and parsers; (3) controller (interface);
(4) service skeleton; (5) containerization; (6) repository: JPA, Flyway; (7) run, verify, pitfalls.
-->

---

## The goal

<div class="q">

Almost every application has **user accounts**. What is the smallest service that can manage them?

</div>

* A **CRUD** API for accounts — here **C**reate, **R**ead and **D**elete (no update).
* Built with **Spring Boot**, following **Domain-Driven Design** and **Clean Architecture**.
* Persisted in **PostgreSQL**, running in **Docker Compose**.
* It is the template every other microservice of the course will copy.

---

## Two modules

<div class="cols">
<div>

### `account` — the interface

- API definition: `AccountController`
- DTOs: `AccountIn`, `AccountOut`
- A **library**, not a runnable app
- Installed with `mvn clean install`

</div>
<div>

### `account-service` — the implementation

- `AccountResource` implements the API
- `AccountService`, `AccountRepository`
- Entity `Account`, model `AccountModel`
- A Spring Boot app that **runs**

</div>
</div>

<div class="ok">

Splitting the contract from the implementation lets **other Java microservices reuse** `account` to call this service.

</div>

---

## Clean architecture: one object per layer

`Request → Controller/Resource → Service → Repository → Database`

| Layer | Object | Parser on the way in |
|---|---|---|
| Controller / Resource | `AccountIn`, `AccountOut` (DTOs) | JSON → `AccountIn` |
| Service | `Account` (entity) | `AccountIn → Account` |
| Repository | `AccountModel` (JPA) | `Account → AccountModel` |
| Database | table `accounts.accounts` | — |

<p class="small">On the way back: <code>AccountModel → Account → AccountOut</code>. <code>AccountParser</code> and <code>AccountModel</code> do the translations.</p>

<!--
Stress that business rules never see JSON or JPA annotations: that is the decoupling Clean Architecture asks for.
-->

---

## Step 1 — Controller: the contract

```java
@FeignClient(name = "account", url = "http://account:8080")
public interface AccountController {
    @PostMapping("/accounts")
    ResponseEntity<Void> create(@RequestBody AccountIn in);
    @GetMapping("/accounts")
    ResponseEntity<List<AccountOut>> findAll();
    @DeleteMapping("/accounts/{id}")
    ResponseEntity<Void> delete(@PathVariable String id);
    @GetMapping("/accounts/health-check")
    ResponseEntity<Void> healthCheck();
    @GetMapping("/accounts/{id}")
    ResponseEntity<AccountOut> findById(@PathVariable String id);
}
```

<p class="small">DTOs are Lombok <code>@Builder</code> records with <code>@Accessors(fluent = true)</code>: <code>AccountIn(name, email, password)</code> and <code>AccountOut(id, name, email)</code> — the password never goes out.</p>

---

## Project setup

| Spring Initializr | `account` | `account-service` |
|---|---|---|
| Project / Language | Maven / Java 25 | Maven / Java 25 |
| Spring Boot | 4.1.0 | 4.1.1 |
| Group / Package | `store` / `store.account` | `store` / `store.account` |
| Dependencies | Lombok, OpenFeign | Spring Web, Lombok, OpenFeign |
| Keeps | only the interface + DTOs | `AccountServiceApplication`, `application.yaml` |

Each module is its own git repository, added as a submodule:

```bash
git submodule add <repository_url> api/account
git submodule add <repository_url> api/account-service
```

---

## Step 2 — Service: make it answer

`AccountResource` implements `AccountController`; at first only `health-check` is real.

```java
@Controller
public class AccountResource implements AccountController {
    @Override
    public ResponseEntity<Void> healthCheck() {
        return ResponseEntity.ok().build();
    }
    // create, findAll, delete, findById: filled in later
}
```

```bash
mvn clean package spring-boot:run
curl -X GET http://localhost:8080/accounts/health-check   # 200 OK
```

---

## Step 3 — Containerization

<div class="cols">
<div>

```dockerfile
FROM eclipse-temurin:25
VOLUME /tmp
COPY target/*.jar /app.jar
ENTRYPOINT ["java", "-jar", "/app.jar"]
```

`.env` holds `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `VOLUME_DB`.

</div>
<div>

```yaml
services:
  db:
    image: postgres:17
    volumes:
      - ${VOLUME_DB}:/var/lib/postgresql/data
    environment:
      POSTGRES_USER: ${DB_USER:-store}
  account:
    build:
      context: ./account-service
    depends_on:
      - db
```

</div>
</div>

<p class="small"><code>docker compose up -d --build</code> · <code>docker compose ps -a</code> — the services live in a <strong>trusted layer</strong>.</p>

---

## Step 4 — Repository: ORM with JPA

<div class="cols">
<div>

```java
@Entity
@Table(name = "accounts")
public class AccountModel {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;
    private String name;
    private String email;
    @Column(name = "hash_password")
    private String hashPassword;
}
```

</div>
<div>

```java
public interface AccountRepository
    extends CrudRepository<AccountModel, String> {
    List<AccountModel> findAll();
}
```

- **ORM** maps tables → classes, rows → objects.
- `CrudRepository` gives `save`, `findById`, `findAll`, `deleteById` for free.

</div>
</div>

---

<!-- _class: tight -->

## The business rule lives in `AccountService`

```java
public Account create(Account account) {
    if (null == account.password())
        throw new ResponseStatusException(BAD_REQUEST, "Password is empty");
    final String pass = account.password().trim();
    if (pass.length() < 6)
        throw new ResponseStatusException(BAD_REQUEST,
            "Password must have at least 6 characters");
    if (account.email() == null || account.email().trim().isEmpty())
        throw new ResponseStatusException(BAD_REQUEST, "Email is empty");
    account.hashPassword(calcHash(pass));
    return accountRepository.save(new AccountModel(account)).to();
}
```

- Bad input → `400 Bad Request`; only the **SHA-256 hash** (Base64) is stored, never the raw password.
- `AccountModel(account)` and `.to()` are the parsers between entity and model.

---

## The finished endpoints

| Method | Path | Response |
|---|---|---|
| `POST` | `/accounts` | `201 Created` + `Location: /accounts/{id}` |
| `GET` | `/accounts` | `200 OK` + list of `AccountOut` |
| `GET` | `/accounts/{id}` | `200 OK`, or `404 Not Found` |
| `DELETE` | `/accounts/{id}` | `204 No Content` |
| `GET` | `/accounts/health-check` | `200 OK` |

<p class="small"><code>create</code> builds the <code>Location</code> header with <code>ServletUriComponentsBuilder.fromCurrentRequest().path("/{id}")</code>; an unknown id in <code>findById</code> throws <code>ResponseStatusException(NOT_FOUND)</code>.</p>

---

<!-- _class: tight -->

## Database migrations with Flyway

The schema is **versioned**: scripts in `resources/db/migration`, run in order at startup.

| Script | Change |
|---|---|
| `V2026.08.24.001__create_schema.sql` | `CREATE SCHEMA IF NOT EXISTS accounts` |
| `V2026.08.24.002__create_table.sql` | table `accounts.accounts (id, name, email UNIQUE, hash_password)` |

```yaml
spring:
  datasource:
    url: jdbc:postgresql://${DATABASE_HOST}:${DATABASE_PORT}/${DATABASE_DB}
  flyway:
    baseline-on-migrate: true
    schemas: accounts
  jpa.properties.hibernate.default_schema: accounts
```

<!--
Name format: V<version>__<description>.sql. A new change is a new script, never an edit of an applied one.
-->

---

## Run and verify

`compose.yaml` passes `DATABASE_HOST: db`, `DATABASE_PORT: 5432`, `DATABASE_DB`, `DATABASE_USERNAME`, `DATABASE_PASSWORD` to `account`.

```bash
docker compose up --build                     # build images and start db + account
docker compose ps -a                          # container names and status
docker compose logs -f account                # look for the Flyway migrations
docker compose exec db psql -U store -d store # open psql in the db container
```

Inside `psql` (it runs in the `db` container, not in `account`):

- `\dn` lists the schemas — `accounts` must be there.
- `\dt *.*` lists the tables — `accounts.accounts` must be there.

---

## Common pitfalls

<div class="warn">

`account-service` depends on `account`: run **`mvn clean install`** in `account` first, or the build cannot find it.

</div>

- The Dockerfile copies `target/*.jar`: **package before** `docker compose up --build`.
- Inside Compose, services talk by **hostname** (`db`, `account`), not `localhost`.
- A migration already applied is history: change the schema with a **new** `V…__…sql` script.
- Keep the password out of `AccountOut` — the output DTO is the public face of the service.

---

## Takeaways

1. A microservice = an **interface module** (`account`) + an **implementation** (`account-service`).
2. **Clean Architecture**: DTO → entity → model, with parsers between layers.
3. `@FeignClient` on the interface makes the contract **reusable** by other services.
4. **JPA** maps `AccountModel` to a table; `CrudRepository` gives the CRUD for free.
5. **Flyway** versions the schema with ordered `V…__…sql` scripts.
6. **Docker Compose** runs the service and PostgreSQL together, wired by environment variables.
7. Store a **hash**, never the password — and never return it.
