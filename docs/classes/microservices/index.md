
**Microservices** — also called the microservices architecture — is an architectural style that structures an application as a collection of small, autonomous services each modelled around a specific business domain. Rather than building one large deployable unit (a *monolith*), the system is composed of independently deployable pieces that collaborate through well-defined APIs.

---

## Key principles

| Principle | What it means |
|---|---|
| **Single Responsibility** | Each service implements exactly one business capability. |
| **Independence** | Services can be developed, deployed, and scaled without coordinating with other services. |
| **Decentralisation** | Teams choose the technology stack that best fits their service — no forced uniformity. |
| **Failure isolation** | A failing service does not cascade and bring down the rest of the system. |
| **Data isolation** | Each service owns its own database. No shared schema, no shared tables. |
| **API-first communication** | Services talk through explicit contracts — HTTP/REST with JSON, or gRPC with Protobuf. |
| **Infrastructure automation** | Automated provisioning, scaling, and deployment are prerequisites, not afterthoughts. |
| **Observability** | With many independent services, comprehensive monitoring, logging, and tracing are essential. |

---

## Monolith vs. Microservices

``` mermaid
flowchart LR
  subgraph mono [Monolith]
    direction TB
    ui_m[UI]
    biz_m[Business Logic]
    data_m[Data Access]
    ui_m --> biz_m --> data_m
  end

  subgraph micro [Microservices]
    direction TB
    gw[API Gateway]
    s1[Service A]
    s2[Service B]
    s3[Service C]
    db1[(DB A)]
    db2[(DB B)]
    db3[(DB C)]
    gw --> s1 & s2 & s3
    s1 --> db1
    s2 --> db2
    s3 --> db3
  end
```

Neither style is universally better. Microservices bring independent deployability and scalability at the cost of distributed-system complexity. A monolith is simpler to develop, test, and operate — until the team or the domain grows large enough that the coupling becomes a bottleneck.

!!! tip "Start with a monolith"
    Most successful microservice architectures began as monoliths. Identify stable service boundaries (using Domain-Driven Design) before splitting, rather than decomposing prematurely.

---

## Topics covered

<div class="grid cards" markdown>

-   :material-domain:{ .lg .middle } **Domain-Driven Design**

    ---

    The vocabulary and techniques used to identify service boundaries: ubiquitous language, bounded contexts, entities, value objects, aggregates, domain events, and repositories.

    [:octicons-arrow-right-24: Domain-Driven Design](ddd/index.md)

-   :material-sitemap:{ .lg .middle } **Architecture & Components**

    ---

    The building blocks of a production microservices system: load balancers, API gateway, identity provider, service discovery, configuration service, and the course's reference architecture.

    [:octicons-arrow-right-24: Architecture & Components](architecture/index.md)

</div>

---

[^1]: XU, A. [System Design 101](https://github.com/ByteByteGoHq/system-design-101){target="_blank"}
[^2]: NEWMAN, S. *Building Microservices*. O'Reilly, 2021.
[^3]: EVANS, E. *Domain-Driven Design*. Addison-Wesley, 2003.
