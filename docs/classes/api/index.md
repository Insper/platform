
An **API** (Application Programming Interface) is a contract that defines how two software components communicate. It specifies what operations are available, what inputs they accept, and what outputs they return — without exposing the internal implementation.

In the context of microservices, APIs are the primary integration mechanism: services expose APIs, clients consume them, and teams evolve each side independently as long as the contract is respected. A stable API boundary means the implementation behind it can be completely replaced without impacting any consumer.

``` mermaid
flowchart LR
    consumer["Client\n(mobile, browser, service)"]
    api["API\n(contract)"]:::highlighted
    impl["Implementation\n(language, DB, framework)"]

    consumer -->|"request"| api
    api -->|"response"| consumer
    api -->|"hides"| impl
    consumer -.-x|"cannot see"| impl

    classDef highlighted fill:#fcc
```

---

## Why APIs matter

| Without a stable API | With a stable API contract |
|---|---|
| Every internal change risks breaking consumers | Consumers are isolated from implementation changes |
| Teams must coordinate every deployment | Teams deploy independently |
| Integration errors surface at runtime | Contract is testable before integration |
| Documentation drifts and becomes stale | Contract is the single source of truth |

---

## Types of APIs

| Style | Protocol | Format | Typical use |
|---|---|---|---|
| **REST** | HTTP/1.1 or HTTP/2 | JSON / XML | Public and internal web APIs — the dominant choice |
| **gRPC** | HTTP/2 | Protocol Buffers (binary) | High-performance internal service-to-service calls |
| **GraphQL** | HTTP | JSON | Flexible client-driven queries; Backend for Frontend (BFF) pattern |
| **WebSocket** | TCP (full-duplex) | Any | Real-time bidirectional communication — chat, live feeds, collaboration |
| **Message-based** | AMQP / Kafka | JSON / Avro | Asynchronous event-driven integration between services |

### REST maturity (Richardson Model)[^3]

Not all HTTP APIs are equally RESTful. Leonard Richardson defined a maturity model with four levels:

| Level | Characteristic | Example |
|---|---|---|
| **0 — Swamp of POX** | Single endpoint for all operations | `POST /service?op=getOrder` |
| **1 — Resources** | Separate URIs per resource | `GET /orders/42` |
| **2 — HTTP Verbs** | Correct use of GET, POST, PUT, DELETE + status codes | `DELETE /orders/42` → `204` |
| **3 — Hypermedia (HATEOAS)** | Responses include links to next possible actions | `"links": [{"rel": "cancel", "href": "/orders/42/cancel"}]` |

Most production REST APIs operate at level 2. Level 3 is rare in microservices but common in public APIs.

This course focuses on **Level 2 REST** and on documenting APIs with **OpenAPI / Swagger**.

---

## Topics covered

<div class="grid cards" markdown>

-   :material-api:{ .lg .middle } **REST API Design**

    ---

    HTTP methods, status codes, URL conventions, request and response structure, versioning, and the design principles that make APIs predictable and easy to consume.

    [:octicons-arrow-right-24: REST API Design](rest/index.md)

-   :material-file-document-outline:{ .lg .middle } **OpenAPI & Swagger**

    ---

    Documenting APIs with the OpenAPI specification. Integrating Swagger UI into a Spring Boot service so that API documentation is always in sync with the code.

    [:octicons-arrow-right-24: OpenAPI & Swagger](swagger/index.md)

</div>

---

[^1]: [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110){:target="_blank"}
[^2]: FIELDING, R. T. *Architectural Styles and the Design of Network-based Software Architectures*. Doctoral dissertation, UC Irvine, 2000. (Original REST definition.)
[^3]: FOWLER, M. [Richardson Maturity Model](https://martinfowler.com/articles/richardsonMaturityModel.html){:target="_blank"}. martinfowler.com, 2010.
