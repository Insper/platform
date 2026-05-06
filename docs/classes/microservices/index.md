
**Microservices** is an architectural style that structures an application as a collection of small, autonomous services, each modelled around a specific business domain. Rather than building one large deployable unit (a *monolith*), the system is composed of independently deployable pieces that collaborate through well-defined APIs.

The microservices style is a response to a specific problem: as teams and codebases grow, a single monolith becomes increasingly expensive to change — a modification to one module requires understanding and testing the entire system, and a deployment requires coordinating across the whole organisation.

---

## Monolith vs. Microservices

``` mermaid
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

!!! tip "Start with a monolith"
    Most successful microservice systems began as monoliths. Identify stable domain boundaries (using Domain-Driven Design) before splitting. Premature decomposition creates a *distributed monolith* — all the complexity of microservices with none of the independence benefits.

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

---

## Inter-service communication

Services in a microservice system communicate in two fundamentally different ways, each with distinct trade-offs:

=== "Synchronous (HTTP / gRPC)"

    The caller sends a request and **waits** for a response. Simple to reason about, but creates **temporal coupling** — the caller cannot complete its operation if the callee is down.

    ``` mermaid
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

    ``` mermaid
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

---

## Topics covered

<div class="grid cards" markdown>

-   :material-domain:{ .lg .middle } **Domain-Driven Design**

    ---

    The vocabulary and techniques for identifying service boundaries: ubiquitous language, bounded contexts, entities, value objects, aggregates, domain events, and repositories.

    [:octicons-arrow-right-24: Domain-Driven Design](ddd/index.md)

-   :material-sitemap:{ .lg .middle } **Architecture & Components**

    ---

    The building blocks of a production microservices system: load balancers, API gateway, identity provider, service discovery, configuration service, and the course's reference architecture.

    [:octicons-arrow-right-24: Architecture & Components](architecture/index.md)

</div>

---

[^1]: XU, A. [System Design 101](https://github.com/ByteByteGoHq/system-design-101){target="_blank"}
[^2]: NEWMAN, S. *Building Microservices*, 2nd ed. O'Reilly, 2021.
[^3]: EVANS, E. *Domain-Driven Design*. Addison-Wesley, 2003.
[^4]: RICHARDSON, C. [Microservices Patterns](https://microservices.io){target="_blank"}.
