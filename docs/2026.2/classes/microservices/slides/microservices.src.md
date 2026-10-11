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
Outline: (1) why and when to split: monolith, modular monolith, Conway's Law, principles;
(2) the store's services, data ownership, sync vs. async; (3) DDD: strategic and tactical design,
bounded contexts, context maps, aggregates, Event Storming; (4) infrastructure components and one request end to end.
-->

---

## Why split at all?

<div class="q">

The store is one Spring Boot app. On Black Friday only checkout is overloaded, three teams share the code, and every release needs all of them. What is wrong?

</div>

* Not the code — the **shape**: one change means understanding and testing the **entire system**.
* You can only scale **everything**, and one bug can take **everything** down.
* Microservices: **independently deployable** services, one business capability each, collaborating through **APIs**.

---

<!-- _class: tight -->

## Monolith vs. microservices

| Dimension | Monolith | Microservices |
|---|---|---|
| **Deployment** | one unit — simple to ship | independent per service — complex to coordinate |
| **Scaling** | scale the whole app | scale only the bottleneck service |
| **Development speed** | fast initially | slower setup; faster at scale |
| **Operational complexity** | low | high — orchestration, tracing, discovery |
| **Data consistency** | ACID transactions | eventual consistency |
| **Team fit** | small, co-located team | multiple teams, one service each |

<div class="warn">

**Start with a (modular) monolith.** Premature decomposition creates a **distributed monolith**: services deployed together, shared tables, long sync chains.

</div>

---

## Conway's Law

> Any organisation that designs a system will produce a design whose structure is a copy of the organisation's communication structure. — Melvin Conway, 1967

- Month 1: **one team**, one monolith (Orders, Auth, Payments, Inventory).
- Month 6: **two teams** form → the code splits in two.
- Month 18: **three autonomous teams** → three services.

<div class="ok">

Boundaries **converge** — so design both together (the *inverse Conway maneuver*: shape the teams first).

</div>

---

## Key principles

| Principle | Meaning |
|---|---|
| **Single Responsibility** | one business capability per service |
| **Independence** | develop, deploy and scale without coordinating |
| **Data isolation** | each service owns its data — no shared tables |
| **Decentralised governance** | teams choose the best technology for their service |
| **Failure isolation** | a failing service does not bring the system down |
| **API-first communication** | explicit, versioned contracts |
| **Observability** | monitoring, tracing and structured logs are prerequisites |

<!--
How small is micro? One team owns it end to end and can deploy it alone. Not "one service per table".
-->

---

<!-- _class: tight -->

## The store, decomposed

| Service | Capability | Talks to | Built in |
|---|---|---|---|
| `gateway-service` | entry point, routing, auth check | every service | Hands-on 2, 3 |
| `account-service` | user accounts (`accounts` schema) | — | Hands-on 1 |
| `auth-service` | register, login, JWT | account | Hands-on 3 |
| `product-service` | product catalogue | — | Product API |
| `order-service` | orders of the current user | product, exchange, Kafka | Order API |
| `exchange-service` (Python) | currency conversion | third-party rates API | Exchange API |
| `notification-service` (Python) | confirmation e-mails | Kafka | Hands-on 9 |

<p class="small">Python and Java side by side: the contract is HTTP/JSON or a Kafka event, so the language does not leak.</p>

---

## Owning the data

- **Database-per-service** = no service touches another's **tables** — not necessarily one server each.
- Hands-on: one Postgres, one **schema** per service (`hibernate.default_schema: accounts`, own Flyway migrations).
- Order needs a price → `GET /products/{id}` on the **API**, never `SELECT` on the product table.
- Queries across services → API calls, or a local copy kept fresh by events (CQRS).
- Transactions across services → no shared ACID: a **saga** of local transactions with compensations.

<div class="ok">

The product team can change its schema tomorrow without telling anyone.

</div>

---

## Inter-service communication

<div class="cols">
<div>

### Synchronous (HTTP / gRPC)

The caller **waits**. **Temporal coupling**: if the callee is down, the caller cannot finish.

Order → Product: the price is needed **now**.

</div>
<div>

### Asynchronous (messaging)

The producer **publishes** `OrderCreated` and continues; consumers process it **when they can**.

Order → Kafka → Notification e-mail.

</div>
</div>

<div class="warn">

A sync chain of three services at 99.9% each: 0.999³ ≈ **99.7%** — from ~8.8 h to ~26 h of downtime a year.

</div>

---

## Domain-Driven Design

Eric Evans (2003): put the **domain** at the centre of design decisions.

| Level | Question | Tools |
|---|---|---|
| **Strategic** | where are the boundaries? | subdomains, bounded contexts, context maps, Event Storming |
| **Tactical** | what goes inside one boundary? | entities, value objects, aggregates, repositories, events |

- **Subdomains**: *core* (ordering, pricing) gets custom code; *generic* (auth, payments) can be bought.
- **Ubiquitous Language**: business says *account* → `account-service`, `/accounts`, `AccountOut`.

---

## Bounded Context

The boundary within which a model is valid. The **same word** can mean different things:

| Context | `Customer` holds |
|---|---|
| Sales | name, creditLimit, salesRegion |
| Support | name, ticketHistory, supportTier |
| Billing | name, taxId, billingAddress |

<div class="ok">

"Product" in **Catalogue**: current price. In **Ordering**: the price *paid* (each order item keeps its own total). One context → typically **one microservice**.

</div>

---

<!-- _class: tight -->

## Context maps

| Pattern | Meaning | In the store |
|---|---|---|
| **Open Host Service** | upstream publishes a documented API | product → order (REST + OpenAPI) |
| **Customer / Supplier** | upstream plans for downstream needs | two teams of the same company |
| **Conformist** | downstream adopts the upstream model | auth reuses `AccountOut` |
| **Anti-Corruption Layer** | downstream translates a foreign model | exchange ← third-party rates API |
| **Shared Kernel** | a small shared model, changed by agreement | use sparingly — it couples |

<p class="small">Upstream = its model influences the other side; downstream = depends on it. An ACL means a provider change touches one function.</p>

---

<!-- _class: tight -->

## Building blocks

| Block | Idea | Example |
|---|---|---|
| **Entity** | distinct **identity** that persists | `Order` with `OrderId` |
| **Value Object** | defined by attributes, **immutable** | `Money(amount, currency)` |
| **Aggregate** | cluster changed as one unit, via its **root** | `Order` → `OrderItem`, `ShippingAddress` |
| **Repository** | collection-like access, one per root | `OrderRepository.findById(id)` |
| **Domain Event** | past-tense, immutable fact | `OrderPlaced` / Kafka `OrderCreated` |
| **Domain Service** | logic no single entity owns | `PricingService.calculateTotal(...)` |

<p class="small">Aggregate rules: only the root is referenced; it enforces invariants ("max 50 items" in <code>Order.addItem()</code>); other aggregates by <b>id only</b>; one transaction changes one aggregate.</p>

---

## Event Storming

Alberto Brandolini: experts and developers map the domain on a wall of sticky notes.

1. **Domain events** (orange), past tense: *OrderPlaced*, *PaymentFailed*.
2. **Commands** (blue) that trigger them: *Place Order*, *Charge Card*.
3. **Group by bounded context** — same ubiquitous language.
4. **Context maps**: how the groups relate.
5. **One context → one service** as a start; merge or split later.

<div class="warn">

Avoid **entity services** (one per table) and **anemic models** (rules outside the root).

</div>

---

<!-- _class: tight -->

## Infrastructure components

| Component | Role | In our platform |
|---|---|---|
| **Load Balancer** | spreads load over identical replicas | Nginx, `least_conn` (HO 7) |
| **API Gateway** | single entry point, trust boundary | Spring Cloud Gateway (HO 2, 3) |
| **Identity Provider** | issues and checks tokens (OAuth 2.0, OIDC, JWT) | `auth-service` (HO 3) |
| **Service Discovery** | find live instances | Compose DNS `account:8080`, Kubernetes Services |
| **Configuration** | config and secrets from the environment | `.env`, ConfigMaps, Secrets (HO 5) |
| **Broker · Cache** | async events · shared memory | Kafka (HO 9) · Redis (HO 8) |
| **Observability** | metrics and traces | Prometheus, Grafana, Jaeger (HO 6, 10) |

---

<!-- _class: tight -->

## Following one request: `POST /orders`

1. Browser → **Nginx** → one **gateway** replica.
2. Gateway → **auth** `POST /auth/solve` with the JWT cookie → `idAccount`.
3. Gateway → **order** with header `id-account` (services never parse JWTs).
4. Order → **product** `GET /products/{id}` for the price.
5. Order saves in **its own schema**, publishes `OrderCreated` to **Kafka** (no wait).
6. `201 Created` travels back; **Jaeger** shows every hop as a span.

<div class="warn">

A service exposed outside the gateway can receive a **forged `id-account`**. Expose only the entry point; run gateway **replicas**; no business logic in the gateway.

</div>

---

## Takeaways

1. Microservices trade **operational complexity** for **independent deployment, scaling and teams**.
2. **Start with a (modular) monolith**; split along stable boundaries — or get a distributed monolith.
3. **Conway's Law**: service boundaries mirror team communication.
4. Each service owns **one capability and its data**: use its API, never its tables.
5. Sync calls **multiply unavailability**; events decouple producers from consumers.
6. **DDD** finds the seams: bounded contexts, context maps, aggregates referenced by id.
7. Gateway, identity, discovery, config, broker and observability carry the **cross-cutting concerns**.
