
The store has a web front-end, a mobile app and an order service, and all three need product data held by the product service. How does each of them know which URL to call, what to send and what comes back? And what happens to them when the product team rewrites its service next semester? The answer to both questions is the **API**.

An **API** (Application Programming Interface) is a contract that defines how two software components communicate. It specifies what operations are available, what inputs they accept, and what outputs they return — without exposing the internal implementation.

In the context of microservices, APIs are the primary integration mechanism: services expose APIs, clients consume them, and teams evolve each side independently as long as the contract is respected. A stable API boundary means the implementation behind it can be completely replaced without impacting any consumer.

``` mermaid-sim
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

!!! abstract "Learning objectives"

    By the end of this class you should be able to:

    - **Explain** why a stable API contract lets teams change and deploy services independently.
    - **Compare** REST, gRPC, GraphQL, WebSocket and message-based APIs, and **choose** one for a given interaction.
    - **Design** a REST resource with correct URIs, HTTP methods, status codes, error bodies and pagination.
    - **Distinguish** a breaking change from a backward-compatible one, and version an API when needed.
    - **Document** a Spring Boot service with OpenAPI and Swagger UI, and **decide** where the documentation may be exposed.

## Roadmap

1. **This page** — what an API contract is, why it matters, the main API styles and how RESTful an API is.
2. [REST API Design](rest/index.md) — resources, methods, idempotency, status codes, errors, pagination and versioning.
3. [OpenAPI & Swagger](swagger/index.md) — describing the contract in a machine-readable document and serving it with springdoc.

## Slides

<div class="slides-embed">
  <iframe src="slides/api.html" title="Slides: api" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/api.html){:target="_blank"}

---

## Why APIs matter

| Without a stable API | With a stable API contract |
|---|---|
| Every internal change risks breaking consumers | Consumers are isolated from implementation changes |
| Teams must coordinate every deployment | Teams deploy independently |
| Integration errors surface at runtime | Contract is testable before integration |
| Documentation drifts and becomes stale | Contract is the single source of truth |

### The contract in our platform

The hands-on makes the contract tangible. In [Hands-on 1](../../hands-on/1/index.md), the Account microservice is split into two Maven modules:

| Module | Contains | Who depends on it |
|---|---|---|
| `account` | the **contract**: the `AccountController` interface (`POST /accounts`, `GET /accounts/{id}`…) and the DTOs `AccountIn` / `AccountOut` | the implementation **and** every client — the auth service calls accounts through it, as an OpenFeign client |
| `account-service` | the **implementation**: `AccountResource`, `AccountService`, the JPA model `AccountModel` and the repository | nobody — it is private to the account team |

Because the auth service ([Hands-on 3](../../hands-on/3/index.md)) only depends on the `account` module, the account team can change the database, the model or the service logic freely. Only a change to `AccountController`, `AccountIn` or `AccountOut` is visible to others — and that is exactly the change that must be negotiated and, if it breaks clients, versioned (see [Versioning](rest/index.md#versioning)).

!!! info "Terms used in this class"

    - **Consumer** (or client): the code that calls the API — a browser, a mobile app or another service.
    - **Provider**: the service that implements the API.
    - **Endpoint**: one operation of the API, identified by an HTTP method and a path, such as `GET /accounts/{id}`.
    - **DTO** (Data Transfer Object): a class whose only job is to carry data across the API boundary — `AccountIn`, `AccountOut`. It is deliberately different from the database entity.

---

## Types of APIs

| Style | Protocol | Format | Typical use |
|---|---|---|---|
| **REST** | HTTP/1.1 or HTTP/2 | JSON / XML | Public and internal web APIs — the dominant choice |
| **gRPC** | HTTP/2 | Protocol Buffers (binary) | High-performance internal service-to-service calls |
| **GraphQL** | HTTP | JSON | Flexible client-driven queries; Backend for Frontend (BFF) pattern |
| **WebSocket** | WebSocket protocol (starts as an HTTP `Upgrade`, then full-duplex over TCP) | Any | Real-time bidirectional communication — chat, live feeds, collaboration |
| **Message-based** | AMQP / Kafka protocol | JSON / Avro | Asynchronous event-driven integration between services |

The same operation — "give me product 42" — looks quite different in each of the three request/response styles:

=== "REST"

    ```http
    GET /products/42 HTTP/1.1
    Accept: application/json
    ```

    The **URL identifies the resource** and the **HTTP method says what to do**. Any HTTP client (browser, `curl`, Postman) can call it.

=== "gRPC"

    ```protobuf
    service ProductService {
      rpc GetProduct (GetProductRequest) returns (Product);
    }
    message GetProductRequest { string id = 1; }
    message Product { string id = 1; string name = 2; double price = 3; }
    ```

    The contract is a `.proto` file; code is **generated** for client and server, and messages travel as compact binary. Calling it needs a gRPC client — a browser cannot call it directly.

=== "GraphQL"

    ```graphql
    query {
      product(id: "42") { name price }
    }
    ```

    A single endpoint (usually `POST /graphql`); the **client chooses the fields** it wants, which avoids over-fetching on mobile screens.

**How to choose.** For the store's public API (browsers, mobile apps, partners), **REST** is the default: universal tooling, cacheable `GET`s, easy to debug. **gRPC** pays off for chatty internal calls where latency and payload size matter. **GraphQL** fits a front-end that composes data from many services. **Messaging** is the choice when the producer should not wait for the consumer — covered in [Event-Driven Architecture](../event_driven/index.md).

### REST maturity (Richardson Model)[^3]

Not all HTTP APIs are equally RESTful. Leonard Richardson defined a maturity model with four levels:

| Level | Characteristic | Example |
|---|---|---|
| **0 — Swamp of POX** | Single endpoint for all operations | `POST /service?op=getOrder` |
| **1 — Resources** | Separate URIs per resource | `GET /orders/42` |
| **2 — HTTP Verbs** | Correct use of GET, POST, PUT, DELETE + status codes | `DELETE /orders/42` → `204` |
| **3 — Hypermedia (HATEOAS)** | Responses include links to next possible actions | `"links": [{"rel": "cancel", "href": "/orders/42/cancel"}]` |

*POX* means "Plain Old XML": the HTTP request is only a tunnel for a remote procedure call. *HATEOAS* stands for "Hypermedia As The Engine Of Application State": the client discovers what it can do next from links in the response, as a person does when browsing a website.

Most production REST APIs operate at level 2. Level 3 is rare in practice, in internal microservices and in public APIs alike; PayPal's REST API is a well-known example that returns `links` with `rel` and `href` in its responses.

This course focuses on **Level 2 REST** and on documenting APIs with **OpenAPI / Swagger**.

!!! warning "Common pitfalls when designing an API"

    - **Leaking the implementation**: returning the JPA entity directly exposes columns such as the password hash and ties the contract to the database schema. Use DTOs (`AccountOut` has no password).
    - **Chatty APIs**: a screen that needs ten calls to render is slow across a network; design resources around what consumers need.
    - **Silent breaking changes**: renaming a JSON field is invisible to the provider's own tests but breaks every consumer. Treat the contract as public — see [Versioning](rest/index.md#versioning).
    - **RPC disguised as REST**: verbs in the URL (`/createOrder`) put the API at Richardson level 0–1.

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

## Key takeaways

- An API is a **contract**: consumers depend on it, never on the implementation behind it.
- In the hands-on, the contract is a separate module (`account`: interface + DTOs) from the implementation (`account-service`).
- REST over HTTP is the default for web APIs; gRPC, GraphQL, WebSocket and messaging solve specific needs.
- Most APIs live at Richardson **level 2**: resources + HTTP methods + status codes. REST was defined by Roy Fielding[^2] on top of HTTP semantics[^1].
- Never expose entities; changing a DTO is changing the contract.

## Connections

- Build the contract and its implementation: [Hands-on 1 — CRUD](../../hands-on/1/index.md).
- Route external clients to the APIs: [Hands-on 2 — Gateway](../../hands-on/2/index.md).
- Design your own APIs: [Product API](../../exercises/product/index.md) and [Order API](../../exercises/order/index.md) exercises.
- Asynchronous APIs: [Event-Driven Architecture](../event_driven/index.md). How services fit together: [Microservices](../microservices/index.md).

---

[^1]: [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110){:target="_blank"}
[^2]: FIELDING, R. T. *Architectural Styles and the Design of Network-based Software Architectures*. Doctoral dissertation, UC Irvine, 2000. (Original REST definition.)
[^3]: FOWLER, M. [Richardson Maturity Model](https://martinfowler.com/articles/richardsonMaturityModel.html){:target="_blank"}. martinfowler.com, 2010.
