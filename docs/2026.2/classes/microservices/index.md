
Picture the store as a single Spring Boot application: login, catalogue, orders and payments in one codebase, one database, one deployable `.jar`. On Black Friday only checkout is overloaded, but the only way to scale it is to run more copies of *everything*. A bug in the catalogue page takes login down with it. Three teams now share the codebase, and every release needs all of them to agree on the same day. Nothing is wrong with the code — the **shape** of the system no longer fits the organisation.

The microservices style is a response to this specific problem: as teams and codebases grow, a single monolith becomes increasingly expensive to change — a modification to one module requires understanding and testing the entire system, and a deployment requires coordinating across the whole organisation.

**Microservices** is an architectural style that structures an application as a collection of small, autonomous services, each modelled around a specific business domain[^5][^2]. Rather than building one large deployable unit (a *monolith*), the system is composed of independently deployable pieces that collaborate through well-defined APIs.

!!! abstract "Learning objectives"

    By the end of this class you should be able to:

    - **Compare** a monolith, a modular monolith and microservices, and **justify** when splitting is worth its cost.
    - **Explain** Conway's Law and the core principles of microservices (single capability, independence, data isolation).
    - **Choose** between synchronous and asynchronous communication for an interaction, and **estimate** the availability cost of a synchronous chain.
    - **Apply** Domain-Driven Design (bounded contexts, aggregates, context maps) to find service boundaries.
    - **Describe** the infrastructure components of a microservice platform and follow one request through the course's architecture.

## Roadmap

1. **This page** — why and when to split, Conway's Law, principles, data ownership, synchronous vs asynchronous communication, the store's services.
2. [Domain-Driven Design](ddd/index.md) — the vocabulary and techniques to find good service boundaries.
3. [Architecture & Components](architecture/index.md) — load balancer, gateway, identity provider, discovery, configuration, broker, observability, and the course's reference architecture.

## Slides

<div class="slides-embed">
  <iframe src="slides/microservices.html" title="Slides: microservices" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/microservices.html){:target="_blank"}

---

## Monolith vs. Microservices

``` mermaid-sim
flowchart LR
    subgraph mono [Monolith]
        direction TB
        ui_m[UI]
        biz_m[Business Logic\nOrders · Auth · Payments · Inventory]
        data_m[Single Database]
        ui_m --> biz_m --> data_m
    end
    subgraph micro [Microservices]
        direction TB
        gw[API Gateway]
        s1[Orders\nService]
        s2[Auth\nService]
        s3[Inventory\nService]
        db1[(Orders DB)]
        db2[(Auth DB)]
        db3[(Inventory DB)]
        gw --> s1 & s2 & s3
        s1 --> db1
        s2 --> db2
        s3 --> db3
    end
```

Neither style is universally better. The right choice depends on team size, domain complexity, and operational maturity:

| Dimension | Monolith | Microservices |
|---|---|---|
| **Deployment** | One unit — simple to ship | Independent per service — complex to coordinate |
| **Scaling** | Scale the whole app | Scale only the bottleneck service |
| **Development speed** | Fast initially | Slower setup; faster at scale |
| **Operational complexity** | Low | High — needs orchestration, tracing, service discovery |
| **Data consistency** | ACID transactions | Eventual consistency across services |
| **Team fit** | Small, co-located team | Multiple teams, each owning a service |

Two terms in the table deserve a definition. An **ACID transaction** (Atomicity, Consistency, Isolation, Durability) lets the monolith change orders and stock in one database operation that either fully happens or not at all. Across services there is no shared transaction: each service commits its own data, and the system becomes consistent a moment later — **eventual consistency** (see [CAP Theorem](../distributed_systems/cap/index.md)).

!!! tip "Start with a monolith"
    Most successful microservice systems began as monoliths. Identify stable domain boundaries (using Domain-Driven Design) before splitting. Premature decomposition creates a *distributed monolith* — all the complexity of microservices with none of the independence benefits.

**The middle ground: a modular monolith.** One deployable unit, but internally split into modules with explicit interfaces and no shared tables — each module could become a service later. It gives the team practice with boundaries before paying for the network, and it is often the right answer for a small team.

!!! warning "Symptoms of a distributed monolith"
    - Services must be **deployed together** ("release train") because a change in one breaks the others.
    - Two services **read and write the same tables**.
    - One user request triggers a long **chain of synchronous calls**; if any link is down, everything is down.
    - A shared library with domain classes forces every service to upgrade at once.

### Conway's Law

> *"Any organisation that designs a system will produce a design whose structure is a copy of the organisation's communication structure."*
> — Melvin Conway, 1967[^6]

Service boundaries and team boundaries converge over time. The simulation below shows how an initially unified codebase fragments into services that mirror the communication patterns of the teams that built it:

```python exec="1" html="1"
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np

rng = np.random.default_rng(7)

fig, axes = plt.subplots(1, 3, figsize=(12, 4))
titles = ["Month 1\n(one team, monolith)", "Month 6\n(two teams form)", "Month 18\n(three autonomous teams)"]

team_configs = [
    {"teams": 1, "modules": ["Orders\nAuth\nPayments\nInventory"], "colors": ["#4C72B0"]},
    {"teams": 2, "modules": ["Orders\nPayments", "Auth\nInventory"], "colors": ["#4C72B0", "#DD8452"]},
    {"teams": 3, "modules": ["Orders\nPayments", "Auth", "Inventory\nCatalogue"], "colors": ["#4C72B0", "#DD8452", "#55A868"]},
]

for ax, cfg, title in zip(axes, team_configs, titles):
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 10)
    ax.set_title(title, fontsize=9, fontweight="bold")
    ax.axis("off")

    n = len(cfg["modules"])
    positions = [(5, 7), (2.5, 3.5), (7.5, 3.5), (5, 1)][:n]
    for (x, y), label, color in zip(positions, cfg["modules"], cfg["colors"]):
        ax.add_patch(plt.Rectangle((x - 1.5, y - 1), 3, 2, color=color, alpha=0.75, zorder=2))
        ax.text(x, y, label, ha="center", va="center", fontsize=7.5, color="white", fontweight="bold", zorder=3)

    if n == 1:
        ax.text(5, 1.5, "Shared codebase\n(high coupling)", ha="center", va="center", fontsize=7.5, color="#666")
    else:
        for i in range(n):
            for j in range(i + 1, n):
                x1, y1 = positions[i]
                x2, y2 = positions[j]
                lw = 2.5 if i // 1 != j // 1 else 1
                style = "--" if n == 3 else "-"
                ax.plot([x1, x2], [y1, y2], style, color="#aaa", linewidth=lw, zorder=1)

patches = [mpatches.Patch(color=c, label=f"Team {i+1}") for i, c in enumerate(["#4C72B0","#DD8452","#55A868"])]
fig.legend(handles=patches, loc="lower center", ncol=3, fontsize=8, frameon=False)

plt.suptitle("Conway's Law: org structure shapes service boundaries", fontsize=10, y=1.02)
plt.tight_layout()
from io import StringIO
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True, bbox_inches="tight")
print(buf.getvalue())
plt.close()
```

The law also works in reverse, which is how organisations use it on purpose: the **inverse Conway maneuver** shapes the teams first (one team per business capability) so that the architecture follows.

---

## Key principles

| Principle | Meaning |
|---|---|
| **Single Responsibility** | Each service implements exactly one business capability |
| **Independence** | Services can be developed, deployed, and scaled without coordinating with others |
| **Data isolation** | Each service owns its own database — no shared schema, no shared tables |
| **Decentralised governance** | Teams choose the technology that best fits their service |
| **Failure isolation** | A failing service does not cascade and bring down the entire system |
| **API-first communication** | Services interact through explicit, versioned contracts |
| **Observability** | Comprehensive monitoring, distributed tracing, and structured logging are prerequisites |

**How small is "micro"?** Not a number of lines. A service is the right size when one team can own it end to end, it can be deployed without coordinating with others, and it maps to one business capability. Services that are too small ("nanoservices", e.g. one service per table) spend more time talking to each other than doing work.

---

## The store, decomposed

The course builds one platform step by step. Each service owns one capability and its own data[^4]:

| Service | Capability | Owns | Talks to | Built in |
|---|---|---|---|---|
| `gateway-service` | Single entry point, routing, authentication check | — | every service | [Hands-on 2](../../hands-on/2/index.md), [3](../../hands-on/3/index.md) |
| `account-service` | User accounts | `accounts` schema | — | [Hands-on 1](../../hands-on/1/index.md) |
| `auth-service` | Register, login, issue and resolve JWTs | — (uses account) | account | [Hands-on 3](../../hands-on/3/index.md) |
| `product-service` | Product catalogue | products data | — | [Product API](../../exercises/product/index.md) |
| `order-service` | Orders of the current user | orders data | product, exchange, Kafka | [Order API](../../exercises/order/index.md) |
| `exchange-service` (Python) | Currency conversion | — | third-party rates API | [Exchange API](../../exercises/exchange/index.md) |
| `notification-service` (Python) | Order confirmation e-mails | — | Kafka | [Hands-on 9](../../hands-on/9/index.md) |

Note *decentralised governance* in action: the exchange and notification services are written in Python, the others in Java — the contract is HTTP/JSON or a Kafka event, so the language does not leak.

### Owning the data

**Database-per-service** means that no service reads or writes another service's tables. It does not require one database *server* per service. In the hands-on, a single Postgres container hosts several **schemas**, and each service is the only one that touches its own (the account service sets `hibernate.default_schema: accounts` and runs its own Flyway migrations):

``` mermaid-sim
flowchart LR
    subgraph pg ["one Postgres server"]
        s1[("schema accounts")]
        s2[("schema products")]
        s3[("schema orders")]
    end
    account["account-service"] --> s1
    product["product-service"] --> s2
    order["order-service"] --> s3
    order -->|"GET /products/{id}"| product
    order -.-x|"no direct SQL"| s2
```

When the order service needs a product's price, it asks the product **API**, never the product **table**. That keeps the product team free to change its schema. Two consequences follow:

- **Queries across services** become API calls (or a local copy of the data, kept up to date by events — see [CQRS](../event_driven/index.md)).
- **Business transactions across services** cannot use one ACID transaction. They become a sequence of local transactions coordinated by events, with compensating actions when a step fails — the **saga** pattern[^4].

---

## Inter-service communication

Services in a microservice system communicate in two fundamentally different ways, each with distinct trade-offs:

=== "Synchronous (HTTP / gRPC)"

    The caller sends a request and **waits** for a response. Simple to reason about, but creates **temporal coupling** — the caller cannot complete its operation if the callee is down.

    ``` mermaid-sim
    sequenceDiagram
        participant Client
        participant Gateway
        participant Order Service
        participant Inventory Service

        Client->>+Gateway: POST /orders
        Gateway->>+Order Service: create order
        Order Service->>+Inventory Service: reserve items
        Inventory Service-->>-Order Service: reserved ✓
        Order Service-->>-Gateway: 201 Created
        Gateway-->>-Client: 201 Created
    ```

    **Use when:** the caller needs the result immediately (e.g., checkout response, auth validation).

=== "Asynchronous (Messaging)"

    The producer **publishes an event** and continues. Consumers process the event independently, in their own time. This eliminates temporal coupling — services can be down and process the message when they recover.

    ``` mermaid-sim
    sequenceDiagram
        participant Order Service
        participant Message Broker
        participant Inventory Service
        participant Notification Service

        Order Service->>Message Broker: OrderPlaced event
        Note over Order Service: continues immediately
        Message Broker->>Inventory Service: OrderPlaced
        Message Broker->>Notification Service: OrderPlaced
        Inventory Service->>Message Broker: InventoryReserved
    ```

    **Use when:** strict consistency is not needed immediately (e.g., sending an email, updating analytics, inventory reservation).

In the store, the order service calls the product service **synchronously** (it needs the price to compute the total before answering), and publishes an `OrderCreated` event to Kafka **asynchronously** so that the notification service can send the e-mail without slowing the customer down ([Hands-on 9](../../hands-on/9/index.md)).

!!! warning "Synchronous chains multiply failure"
    If a request must pass through three services, and each one is available 99.9% of the time, the chain is available only 0.999 × 0.999 × 0.999 ≈ **99.7%** of the time — from about 8.8 hours of downtime a year to about 26 hours. Every extra synchronous hop lowers availability and adds latency. Keep chains short, use timeouts and circuit breakers ([Resilience Patterns](../reliability/patterns/index.md)), and move work that does not need an immediate answer to events ([Event-Driven Architecture](../event_driven/index.md)).

---

## Topics covered

<div class="grid cards" markdown>

-   :material-domain:{ .lg .middle } **Domain-Driven Design**

    ---

    The vocabulary and techniques for identifying service boundaries: ubiquitous language, bounded contexts, entities, value objects, aggregates, domain events, repositories and context maps.

    [:octicons-arrow-right-24: Domain-Driven Design](ddd/index.md)

-   :material-sitemap:{ .lg .middle } **Architecture & Components**

    ---

    The building blocks of a production microservices system: load balancers, API gateway, identity provider, service discovery, configuration service, message broker, observability, and the course's reference architecture[^1].

    [:octicons-arrow-right-24: Architecture & Components](architecture/index.md)

</div>

---

## Key takeaways

- Microservices trade **operational complexity** for **independent deployment, scaling and team autonomy** — worth it only when those are real problems.
- Start with a (modular) monolith; split along stable domain boundaries found with DDD[^3], or you get a **distributed monolith**.
- **Conway's Law**: service boundaries mirror team communication — design both together.
- Each service owns **one capability and its data**; others use its API, never its tables.
- Synchronous calls are simple but **couple availability**; events decouple producers from consumers.

## Connections

- Why the network makes this hard: [Distributed Systems](../distributed_systems/index.md).
- The contracts between services: [API](../api/index.md).
- Build the platform: [Hands-on 1 — CRUD](../../hands-on/1/index.md), [Hands-on 2 — Gateway](../../hands-on/2/index.md), [Hands-on 3 — Security](../../hands-on/3/index.md).
- Inside one service: [Software Architectures](../architectures/index.md) (clean and hexagonal).
- Asynchronous integration: [Event-Driven Architecture](../event_driven/index.md) and [Hands-on 9 — Kafka](../../hands-on/9/index.md).

---

[^1]: XU, A. [System Design 101](https://github.com/ByteByteGoHq/system-design-101){target="_blank"}
[^2]: NEWMAN, S. *Building Microservices*, 2nd ed. O'Reilly, 2021.
[^3]: EVANS, E. *Domain-Driven Design*. Addison-Wesley, 2003.
[^4]: RICHARDSON, C. [Microservices Patterns](https://microservices.io){target="_blank"}.
[^5]: LEWIS, J.; FOWLER, M. [Microservices — a definition of this new architectural term](https://martinfowler.com/articles/microservices.html){target="_blank"}. martinfowler.com, 2014.
[^6]: CONWAY, M. E. [How Do Committees Invent?](https://www.melconway.com/Home/Committees_Paper.html){target="_blank"} *Datamation*, 14(4), 1968, p. 28–31.
