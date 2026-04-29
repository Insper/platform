
An **API** (Application Programming Interface) is a contract that defines how two software components can communicate. It specifies what operations are available, what inputs they accept, and what outputs they return — without exposing the internal implementation.

In the context of microservices and web platforms, APIs are the primary integration mechanism: services expose APIs, clients consume them, and teams can evolve each side independently as long as the contract is respected.

---

## Why APIs matter

Without a stable API contract, every change to a service risks breaking all of its consumers. A well-designed API:

- **Decouples** producer from consumer — each can evolve independently.
- **Hides implementation** — clients have no knowledge of the database, language, or framework behind it.
- **Enables scaling** — the same API can be consumed by web clients, mobile apps, other microservices, and third-party integrators.
- **Enforces boundaries** — an API is the explicit expression of what a service *does*, nothing more.

---

## Types of APIs

| Style | Protocol | Format | Typical use |
|---|---|---|---|
| **REST** | HTTP | JSON / XML | Public and internal web APIs; the most common choice |
| **gRPC** | HTTP/2 | Protobuf (binary) | High-performance internal service-to-service calls |
| **GraphQL** | HTTP | JSON | Flexible client-driven queries; BFF (backend for frontend) |
| **WebSocket** | TCP | Any | Real-time bidirectional communication (chat, live feeds) |
| **Message-based** | AMQP / Kafka | JSON / Avro | Async event-driven integration |

This course focuses on **REST**, the dominant style for microservice APIs, and on documenting them with **OpenAPI/Swagger**.

---

## Topics covered

<div class="grid cards" markdown>

-   :material-api:{ .lg .middle } **REST API Design**

    ---

    HTTP methods, status codes, URL conventions, request/response structure, versioning, and design principles that make APIs predictable and easy to consume.

    [:octicons-arrow-right-24: REST API Design](rest/index.md)

-   :material-file-document-outline:{ .lg .middle } **OpenAPI & Swagger**

    ---

    Documenting APIs with the OpenAPI specification. Integrating Swagger UI into a Spring Boot service so that API documentation is always in sync with the code.

    [:octicons-arrow-right-24: OpenAPI & Swagger](swagger/index.md)

</div>

---

[^1]: [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110){:target="_blank"}
[^2]: FIELDING, R. T. *Architectural Styles and the Design of Network-based Software Architectures*. Doctoral dissertation, UC Irvine, 2000. (Original REST definition.)
