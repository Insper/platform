---
marp: true
lang: en
title: Microservices
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

# Microservices

**Small, autonomous services, each modelled around a business domain**

<!--
Objectives: compare monolith, modular monolith and microservices and justify splitting; explain Conway's Law and the
principles; choose sync or async and estimate the availability of a sync chain; apply DDD to find boundaries; describe
the platform components and follow one request through the course's architecture.
Outline: (1) why and when to split; (2) the store's services, data ownership, communication; (3) Domain-Driven Design;
(4) architecture and components, one request end to end, best practices.
-->

---

## Why split at all?

<div class="q">

The store is one Spring Boot app: login, catalogue, orders and payments, one database, one `.jar`. On Black Friday only checkout is overloaded, three teams share the code and every release needs all of them. What is wrong?

</div>

* Not the code — the **shape** of the system no longer fits the organisation.
* You can only scale **everything**; a catalogue bug takes login down with it.
* **Microservices**: small, autonomous, **independently deployable** services, each modelled around one business domain, collaborating through well-defined **APIs**.

---

<!-- _class: tight -->

## Monolith vs. microservices

| Dimension | Monolith | Microservices |
|---|---|---|
| **Deployment** | one unit — simple to ship | independent per service — complex to coordinate |
| **Scaling** | scale the whole app | scale only the bottleneck service |
| **Development speed** | fast initially | slower setup; faster at scale |
| **Operational complexity** | low | high — orchestration, tracing, service discovery |
| **Data consistency** | ACID transactions | eventual consistency across services |
| **Team fit** | small, co-located team | multiple teams, each owning a service |

<p class="small"><strong>ACID</strong>: orders and stock change in one database operation, all or nothing. Across services each one commits its own data and the system becomes consistent a moment later: <strong>eventual consistency</strong>.</p>

---

## Start with a monolith

- Most successful microservice systems **began as monoliths**: find stable domain boundaries (DDD) before splitting.
- **Modular monolith**: one deployable unit, internally split into modules with explicit interfaces and **no shared tables** — each could become a service later. Often the right answer for a small team.

<div class="warn">

**Distributed monolith** — all the complexity, none of the independence. Symptoms:

- services must be **deployed together** ("release train");
- two services **read and write the same tables**;
- one request triggers a long **chain of synchronous calls**;
- a shared library of domain classes forces everyone to upgrade at once.

</div>

---

## Conway's Law

> Any organisation that designs a system will produce a design whose structure is a copy of the organisation's communication structure. — Melvin Conway, 1967

- Month 1: **one team**, one monolith (Orders, Auth, Payments, Inventory).
- Month 6: **two teams** form → the code splits in two.
- Month 18: **three autonomous teams** → three services.

<div class="ok">

Boundaries **converge**, so design both together. The **inverse Conway maneuver** shapes the teams first (one per business capability) so that the architecture follows.

</div>

---

## Key principles

| Principle | Meaning |
|---|---|
| **Single Responsibility** | exactly one business capability per service |
| **Independence** | develop, deploy and scale without coordinating |
| **Data isolation** | each service owns its database — no shared schema or tables |
| **Decentralised governance** | teams choose the best technology for their service |
| **Failure isolation** | a failing service does not cascade |
| **API-first communication** | explicit, versioned contracts |
| **Observability** | monitoring, tracing and structured logs are prerequisites |

<p class="small"><strong>How small is "micro"?</strong> Not lines of code: one team owns it end to end, deploys it alone, and it maps to one capability. "Nanoservices" (one per table) spend more time talking than working.</p>

---

<!-- _class: tight -->

## The store, decomposed

| Service | Capability | Owns | Talks to | Built in |
|---|---|---|---|---|
| `gateway-service` | entry point, routing, auth check | — | every service | Hands-on 2, 3 |
| `account-service` | user accounts | `accounts` schema | — | Hands-on 1 |
| `auth-service` | register, login, issue and resolve JWTs | — (uses account) | account | Hands-on 3 |
| `product-service` | product catalogue | products data | — | Product API |
| `order-service` | orders of the current user | orders data | product, exchange, Kafka | Order API |
| `exchange-service` (Python) | currency conversion | — | third-party rates API | Exchange API |
| `notification-service` (Python) | order confirmation e-mails | — | Kafka | Hands-on 10 |

<div class="ok">

**Decentralised governance** in action: Python and Java side by side — the contract is HTTP/JSON or a Kafka event, so the language does not leak.

</div>

---

## Owning the data

- **Database-per-service** = no service reads or writes another's **tables** — not one database *server* each.
- Hands-on: one Postgres, one **schema** per service (`hibernate.default_schema: accounts`, own Flyway migrations).
- Order needs a price → `GET /products/{id}` on the product **API**, never the product **table** — the product team stays free to change its schema.

Two consequences:

- **Queries across services** → API calls, or a local copy kept fresh by events (CQRS).
- **Business transactions across services** → no shared ACID transaction: a **saga** of local transactions with compensating actions.

---

## Inter-service communication

<div class="cols">
<div>

### Synchronous (HTTP / gRPC)

The caller **waits**. **Temporal coupling**: if the callee is down, the caller cannot finish.

**Use when** the result is needed now: checkout response, auth validation.

**Store**: order → product (the price, to compute the total).

</div>
<div>

### Asynchronous (messaging)

The producer **publishes an event** and continues; consumers process it in their own time, even after recovering.

**Use when** consistency can wait: e-mail, analytics, inventory reservation.

**Store**: order → `OrderCreated` on Kafka → notification (Hands-on 10).

</div>
</div>

---

## Synchronous chains multiply failure

<div class="q">

A request passes through **three** services, each available **99.9%** of the time. How available is the chain?

</div>

* 0.999 × 0.999 × 0.999 ≈ **99.7%**.
* From about **8.8 hours** of downtime a year to about **26 hours** — and every hop adds latency.
* Keep chains short, use **timeouts and circuit breakers**, move work that needs no immediate answer to **events**.

---

<div class="kicker">Domain-Driven Design</div>

## Where do you cut?

By table (`products`, `orders`, `order_items`)? By layer? By this month's work? All give services that change together: a **distributed monolith**. DDD (Eric Evans, 2003) finds where the **business itself** has a seam.

| Level | Question | Tools |
|---|---|---|
| **Strategic** | *where are the boundaries?* | subdomains, ubiquitous language, bounded contexts, context maps, Event Storming |
| **Tactical** | *what goes inside one boundary?* | entities, value objects, aggregates, repositories, domain events, domain services |

<p class="small">Strategic design decides the <strong>microservices</strong>; tactical design shapes the <strong>code inside each one</strong>.</p>

---

## Subdomains and ubiquitous language

| Kind | Meaning | In the store |
|---|---|---|
| **Core** | what makes the business different: best people, custom code | ordering, pricing, the catalogue experience |
| **Supporting** | specific to the business, not a differentiator | notifications, currency display |
| **Generic** | solved problems, the same everywhere — **buy or reuse** | authentication, payments, e-mail delivery |

**Ubiquitous Language**: one vocabulary for experts, documents and code. Not *Customer* in the business, `USER` in the database and `Person` in the code: the business says **account**, so `account-service`, `/accounts`, `AccountIn`, `AccountOut`, `AccountService`.

---

## Bounded Context

The boundary within which one model is valid. The **same word** can mean different things:

| Context | `Customer` holds |
|---|---|
| Sales | name, creditLimit, salesRegion |
| Support | name, ticketHistory, supportTier |
| Billing | name, taxId, billingAddress |

<div class="ok">

**"Product" in the store**: in **Catalogue**, name, current price, unit — it changes any day. In **Ordering**, the product *as sold*: id, quantity, total paid (each order item keeps its own `total`). Same word, two models, two services. A bounded context typically maps to **one microservice**.

</div>

---

<!-- _class: tight -->

## Context maps: how contexts relate

Upstream: its model influences the other side. Downstream: depends on the upstream model.

| Pattern | Meaning | In the store |
|---|---|---|
| **Customer / Supplier** | upstream plans for the downstream's needs | two teams of the same company |
| **Open Host Service** + **Published Language** | upstream publishes a documented API | product → order (REST + JSON, OpenAPI) |
| **Conformist** | downstream adopts the upstream model as is | auth reuses `AccountIn` / `AccountOut` |
| **Anti-Corruption Layer** | downstream translates a foreign model at the border | third-party rates API → exchange |
| **Shared Kernel** | a small shared model, changed by agreement | use sparingly — it couples |

```python
def get_rate(source: str, target: str) -> Rate:
    raw = provider.latest(base=source)
    return Rate(source=source, target=target, value=Decimal(str(raw["rates"][target])))
```

<p class="small">The exchange service's ACL: if the provider changes its format, or is replaced, only this function changes.</p>

---

## Building blocks: entity, value object

<div class="cols">
<div>

### Entity

A distinct **identity** that persists: two `Order`s with the same `OrderId` are the same order, even if their status differs.

### Value Object

Defined by its **attributes**, no identity, **immutable**: operations return new instances. Java `record`s fit.

</div>
<div>

```java
public record Money(BigDecimal amount,
                    Currency currency) {
    public Money add(Money other) {
        if (!this.currency.equals(other.currency))
            throw new CurrencyMismatchException();
        return new Money(
            this.amount.add(other.amount),
            this.currency);
    }
}
```

</div>
</div>

---

<!-- _class: tight -->

## Aggregates

A cluster of entities and value objects changed as **one unit**, through its **root**: `Order` → `OrderItem`s, `ShippingAddress`.

```java
public void addItem(ProductId productId, int quantity, Money unitPrice) {
    if (quantity <= 0)
        throw new IllegalArgumentException("quantity must be positive");
    if (items.size() >= MAX_ITEMS)
        throw new IllegalStateException("an order has at most " + MAX_ITEMS + " items");
    OrderItem item = new OrderItem(productId, quantity, unitPrice.multiply(quantity));
    items.add(item);
    total = total.add(item.total());              // invariant: total = sum of items
}
```

- External code references only the **root**; the root enforces the **invariants**.
- Saved and loaded as a whole; **one transaction changes one aggregate**.
- Other aggregates **by id only**: the item keeps the product id, the order the account id.

---

## Repositories, events and domain services

- **Repository**: collection-like access, **one per aggregate root** (no `OrderItemRepository`). The domain declares `OrderRepository`; infrastructure implements it — in the hands-on, Spring Data implements `AccountRepository extends CrudRepository<AccountModel, String>`.
- **Domain Event**: past tense, immutable — `record OrderPlaced(OrderId orderId, CustomerId customerId, Instant occurredAt)`. Other contexts react without the producer knowing them: Hands-on 10's `OrderCreated` on topic `order-events`.
- **Domain Service**: logic no single entity owns — `PricingService.calculateTotal(order, discount)`.

---

## Event Storming

Alberto Brandolini: experts and developers map the domain on a wall of sticky notes.

1. **Domain events** (orange), past tense: *OrderPlaced*, *PaymentFailed*, *ItemShipped*.
2. **Commands** (blue) that trigger them: *Place Order*, *Charge Card*.
3. **Group by bounded context**, under the same ubiquitous language.
4. **Draw context maps**: how the groups interact.
5. **One context → one service** as a start; merge or split for operational and team reasons.

<div class="ok">

Bounded context ≠ microservice, always: a small team may keep two related contexts in one service. Split when independent deployment or scale becomes valuable.

</div>

---

## Common DDD mistakes

- **Entity services**: one service per table or noun (`OrderItemService`, `AddressService`) — no behaviour, always called together.
- **Anemic domain model**: getters and setters only, every rule in a service class — nothing protects the invariants.
- **One giant model**: one `Customer` / `Product` class shared by every service through a library — every change redeploys everyone.
- **Aggregates that are too big**: an `Account` containing all its orders — loading one account loads thousands of orders, and edits conflict. Keep aggregates small; link by id.

---

<div class="kicker">Architecture and components</div>

## Cross-cutting concerns

Six services, and each needs HTTPS, must check who the user is, must be found by the others while containers come and go, needs configuration and secrets, and must produce logs and metrics.

<div class="warn">

Solved inside every service → six slightly different (and slightly wrong) implementations of the same thing.

</div>

<div class="ok">

Move these **cross-cutting concerns** — present in every service, part of no business domain — into **shared infrastructure**, so each service stays focused on its domain.

</div>

---

## Load balancer and API gateway

<div class="cols">
<div>

### Load balancer

Spreads requests for **one** service over its identical replicas; knows nothing about the application.

- **L4 (TCP)**: by IP/port, raw throughput.
- **L7 (HTTP)**: by path, headers, cookies — canary deployments.

Course: **Nginx**, `least_conn`, in front of the gateway replicas (Hands-on 7).

</div>
<div>

### API gateway

The **single entry point** and trust boundary: decides **which** service and applies application rules.

- routing (`/orders/**` → order), JWT check, rate limiting, transformation, SSL termination.

Course: **Spring Cloud Gateway** (Hands-on 2), `Path=/accounts/**` → `http://account:8080`.

</div>
</div>

<p class="small">A <strong>CDN</strong> serves static assets (images, JS, CSS) from the location nearest to the user.</p>

---

## Identity, discovery, configuration

- **Identity provider**: OAuth 2.0 (delegation), OIDC (identity, `id_token`), **JWT** (signed claims, validated without calling the provider). Course: **auth-service** issues a JWT in a cookie and resolves it to an account id for the gateway (Hands-on 3).
- **Service discovery**: instances come and go, so no hard-coded endpoints. Client-side (caller asks the registry) or server-side (gateway/LB asks). Course: the **platform's DNS** — Compose gives `http://account:8080`; Kubernetes `Service` objects (Hands-on 5).
- **Configuration**: in the **environment** (twelve-factor): `${DATABASE_HOST}` from `.env` and `compose.yaml`, later **ConfigMaps** and **Secrets**. One image for every environment.

---

<!-- _class: tight -->

## The course's platform

| Component | Common options | In our platform | Hands-on |
|---|---|---|---|
| Load balancer | Nginx, HAProxy, cloud LBs | Nginx in front of the gateway replicas | 7 |
| API gateway | Spring Cloud Gateway, Kong | Spring Cloud Gateway (`gateway-service`) | 2, 3 |
| Identity provider | Keycloak, Auth0, Cognito | `auth-service` issuing JWTs | 3 |
| Service discovery | Eureka, Consul, Kubernetes DNS | Compose DNS, then Kubernetes Services | 1, 5 |
| Configuration | Spring Cloud Config, Vault, ConfigMaps | `.env` + env vars, then ConfigMaps and Secrets | 5 |
| Message broker | Kafka, RabbitMQ | Kafka (`OrderCreated` on `order-events`) | 10 |
| Cache | Redis, Memcached | Redis, shared by all gateway replicas | 8 |
| Observability | Prometheus, Grafana, OpenTelemetry, Jaeger | Prometheus + Grafana, OpenTelemetry + Jaeger | 6, 11 |

---

## Our architecture: key decisions

Internet (web, mobile, desktop) → **load balancer** → **API gateway** (→ auth) → business microservices (account, product, order), each with its database → exchange → third-party API.

- **All external traffic enters through the gateway**: internal services are not reachable from the internet.
- **Auth is a separate service**: the gateway calls `POST /auth/solve` and forwards the identity in the `id-account` header; services never parse the JWT.
- **Each service has its own database**: APIs, not shared tables.
- **Services can call each other**: fine for sync sub-operations; consider events for reliability at scale.

---

<!-- _class: tight -->

## Following one request: `POST /orders`

1. Browser → **Nginx** (JWT cookie) → one **gateway** replica.
2. Gateway → **auth** `POST /auth/solve` (token) → `idAccount`.
3. Gateway → **order** `POST /orders` + header `id-account`.
4. Order → **product** `GET /products/{id}` → product with price (the API, never the table).
5. Order saves in **its own schema** and publishes `OrderCreated` to **Kafka**, without waiting.
6. `201 Created` travels back; a **Jaeger** trace shows exactly these hops as spans.

<div class="warn">

**Pitfalls**: a service port published outside the gateway → anyone can **forge `id-account`** (the gateway must overwrite it) · a single gateway instance → single point of failure · business logic in the gateway · "trusted network" as the only defence (add mutual TLS).

</div>

---

## Best practices

| Practice | Why it matters |
|---|---|
| **Design for failure** | any downstream call can fail: timeouts, retries with backoff, circuit breakers |
| **Automate everything** | CI/CD, IaC and orchestration are prerequisites at scale |
| **Own your data** | a shared database prevents independent evolution |
| **Async where possible** | sync chains amplify latency and couple availability |
| **Observe everything** | traces, structured logs and metrics explain cross-service failures |
| **Version your APIs** | independent deploys need non-breaking or versioned changes |

---

## Takeaways

1. Microservices trade **operational complexity** for **independent deployment, scaling and team autonomy** — worth it only when those are real problems.
2. Start with a (modular) monolith; split along stable boundaries found with DDD, or get a **distributed monolith**.
3. **Conway's Law**: service boundaries mirror team communication — design both together.
4. Each service owns **one capability and its data**; others use its API, never its tables.
5. Synchronous calls **couple availability**; events decouple producers from consumers.
6. **DDD**: bounded contexts and context maps find the seams; aggregates protect invariants and reference others by id.
7. **Cross-cutting concerns** live in shared infrastructure: the gateway is the entry point and trust boundary, resolving the JWT and forwarding `id-account`.
