---
marp: true
lang: en
title: API
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

# API

**A contract that lets each side evolve on its own**

<!--
Objectives: explain why a stable contract lets teams deploy independently; compare REST, gRPC, GraphQL, WebSocket
and messaging and choose one; design a REST resource (URIs, methods, status codes, errors, pagination); tell a
breaking change from a compatible one and version when needed; document a Spring Boot service with OpenAPI and
Swagger UI and decide where the documentation may be exposed.
Outline: (1) the API contract, styles, Richardson; (2) REST API design; (3) OpenAPI and Swagger.
-->

---

## Three clients, one product service

<div class="q">

The web front-end, the mobile app and the order service all need product data. How does each one know which URL to call, what to send and what comes back? And what happens to them when the product team **rewrites** its service next semester?

</div>

* An **API** is a contract: the **operations**, their **inputs** and their **outputs** — without exposing the implementation.
* Clients depend on the contract and **cannot see** the language, database or framework behind it.
* Respect the contract and the implementation can be **completely replaced** without impacting any consumer.

---

## Why APIs matter

| Without a stable API | With a stable API contract |
|---|---|
| every internal change risks breaking consumers | consumers are isolated from implementation changes |
| teams coordinate every deployment | teams deploy independently |
| integration errors surface at runtime | the contract is testable before integration |
| documentation drifts and goes stale | the contract is the single source of truth |

<p class="small"><strong>Consumer</strong> (client): the code that calls the API · <strong>Provider</strong>: the service that implements it · <strong>Endpoint</strong>: one operation, method + path (<code>GET /accounts/{id}</code>) · <strong>DTO</strong>: a class that only carries data across the boundary.</p>

---

## The contract in our platform

| Module | Contains | Who depends on it |
|---|---|---|
| `account` | the **contract**: `AccountController` interface (`POST /accounts`, `GET /accounts/{id}`…) and DTOs `AccountIn` / `AccountOut` | the implementation **and** every client — auth calls accounts through it as an OpenFeign client |
| `account-service` | the **implementation**: `AccountResource`, `AccountService`, `AccountModel` (JPA), the repository | nobody — private to the account team |

<div class="ok">

The account team changes the database, model or logic freely. Only a change to `AccountController`, `AccountIn` or `AccountOut` is visible to others — the change that must be negotiated and, if it breaks clients, **versioned**.

</div>

---

## Types of APIs

| Style | Protocol | Format | Typical use |
|---|---|---|---|
| **REST** | HTTP/1.1 or HTTP/2 | JSON / XML | public and internal web APIs — the dominant choice |
| **gRPC** | HTTP/2 | Protocol Buffers (binary) | high-performance internal service-to-service calls |
| **GraphQL** | HTTP | JSON | client-driven queries; Backend for Frontend (BFF) |
| **WebSocket** | starts as an HTTP `Upgrade`, then full-duplex | any | real time: chat, live feeds, collaboration |
| **Message-based** | AMQP / Kafka protocol | JSON / Avro | asynchronous, event-driven integration |

---

## "Give me product 42", three ways

<div class="cols3">
<div>

### REST

```http
GET /products/42 HTTP/1.1
Accept: application/json
```

The URL identifies the **resource**; the method says what to do. Any HTTP client works.

</div>
<div>

### gRPC

```protobuf
service ProductService {
  rpc GetProduct (GetProductRequest)
    returns (Product);
}
```

A `.proto` contract, **generated** code, compact binary. No direct browser call.

</div>
<div>

### GraphQL

```graphql
query {
  product(id: "42") { name price }
}
```

One endpoint (`POST /graphql`); the **client chooses the fields**.

</div>
</div>

<div class="ok">

**How to choose**: REST for the store's public API (universal tooling, cacheable `GET`s); gRPC for chatty internal calls; GraphQL for a front-end composing many services; messaging when the producer should not wait.

</div>

---

## How RESTful? The Richardson model

| Level | Characteristic | Example |
|---|---|---|
| **0 — Swamp of POX** | one endpoint for all operations | `POST /service?op=getOrder` |
| **1 — Resources** | separate URIs per resource | `GET /orders/42` |
| **2 — HTTP verbs** | GET, POST, PUT, DELETE + status codes | `DELETE /orders/42` → `204` |
| **3 — Hypermedia** | responses link to the next actions | `"links": [{"rel": "cancel", "href": "/orders/42/cancel"}]` |

- **POX** = Plain Old XML: HTTP as a tunnel for remote procedure calls. **HATEOAS** = Hypermedia As The Engine Of Application State: the client discovers next steps from links.
- Most production APIs live at **level 2** — the focus of this course; level 3 is rare (PayPal's `links` with `rel` and `href`).

---

## Common pitfalls when designing an API

- **Leaking the implementation**: returning the JPA entity exposes columns such as the password hash and ties the contract to the schema — use DTOs (`AccountOut` has no password).
- **Chatty APIs**: a screen that needs ten calls is slow across a network — design resources around what consumers need.
- **Silent breaking changes**: renaming a JSON field passes the provider's own tests and breaks every consumer — treat the contract as public.
- **RPC disguised as REST**: verbs in the URL (`/createOrder`) put the API at Richardson level 0–1.

---

<div class="kicker">REST API design</div>

## REST: resources and representations

You must publish the store's **Product API**; the web front-end and the order service will call it without reading your code. REST (Roy Fielding, 2000) — an architectural **style**, not a protocol — gives shared answers on top of HTTP.

- A **resource** is anything with a name: a product, all products, one user's orders — identified by a **URI** (`/products/0195abfb-...`).
- A **representation** is a snapshot of its state, usually JSON. The client never touches the row in Postgres: **Representational State Transfer**.
- `Content-Type` says the body's format; `Accept` says what the client wants back.

---

<!-- _class: tight -->

## REST constraints

| Constraint | Meaning |
|---|---|
| **Client-Server** | the server does not know the UI; the client does not know the storage |
| **Stateless** | each request carries everything; no session between requests — the JWT travels with every call |
| **Cacheable** | responses declare whether they can be cached |
| **Uniform Interface** | URIs + standard methods + self-descriptive messages (`Content-Type`, status) + links (HATEOAS) |
| **Layered System** | the client cannot tell the end server from a gateway, cache or load balancer |
| **Code on Demand** *(optional)* | the server may send executable code (JavaScript) |

<div class="ok">

**Stateless** + **Layered System** make horizontal scaling possible: no replica keeps a session, so Hands-on 7's load balancer sends each request to any gateway instance.

</div>

---

## Resources are nouns

<div class="cols">
<div>

| ✅ Good | ❌ Bad |
|---|---|
| `GET /orders` | `GET /getOrders` |
| `POST /orders` | `POST /createOrder` |
| `GET /orders/42` | `GET /order?id=42` |
| `DELETE /orders/42` | `POST /deleteOrder/42` |

</div>
<div>

- **Plural** nouns: `/orders`, `/products`
- **Lowercase with hyphens**: `/order-items`
- Nest for ownership: `/users/7/orders`, at most 2–3 levels
- Filters, sort, pages → **query** parameters

</div>
</div>

<div class="ok">

**Actions that are not CRUD** (cancel an order): a state change, `PATCH /orders/42` with `{"status": "CANCELLED"}`, or a sub-resource, `POST /orders/42/cancellation`. The verb stays out of the path.

</div>

---

## HTTP methods

| Method | Idempotent | Safe | Use |
|---|---|---|---|
| `GET` | ✅ | ✅ | retrieve a resource or collection; must not modify state |
| `POST` | ❌ | ❌ | create — the server assigns the ID |
| `PUT` | ✅ | ❌ | replace completely — the client sends the full representation |
| `PATCH` | ❌ | ❌ | partial update (`{"op": "increment"}` changes on every call) |
| `DELETE` | ✅ | ❌ | remove |

- **Safe**: no change to server state (`GET`, `HEAD`, `OPTIONS`) — caches and crawlers may call them freely.
- **Idempotent**: same **effect on the server** once or many times. `DELETE /products/42` → `204`, then `404`: still idempotent — treat a `404` on a retried `DELETE` as success.

---

## Retrying a `POST`: idempotency keys

<div class="q">

`POST /orders` and the response never arrives. Was the order created? Retrying may create a **duplicate**; not retrying may **lose** it.

</div>

1. The client generates a unique **`Idempotency-Key`** (a UUID) per *logical* operation.
2. The server creates order 42 and remembers `k1 → 42`; the `201` is lost.
3. Timeout: the client retries with the **same key**.
4. The server sees `k1` already processed → `201 Created`, order 42, **no duplicate**.

<p class="small">Keys stored with the result (a table with a unique constraint, or Redis with an expiry) — Stripe's mechanism. Retries and backoff: Resilience Patterns.</p>

---

<!-- _class: tight -->

## Status codes: use the right one

**4xx**: the client did something wrong (do not retry unchanged) · **5xx**: the server failed (a retry may succeed)

<div class="cols3">
<div>

### 2xx

- `200 OK`
- `201 Created` + `Location`
- `202 Accepted` (queued, async)
- `204 No Content`

</div>
<div>

### 4xx

- `400` malformed, missing fields
- `401` no / invalid / expired token
- `403` valid token, no permission
- `404` not found
- `409` conflict, duplicate
- `422` business validation failed
- `429` rate limited + `Retry-After`

</div>
<div>

### 5xx

- `500` unhandled — **no stack traces**
- `502` invalid answer behind the gateway
- `503` down or overloaded
- `504` no answer behind the gateway

</div>
</div>

<div class="warn">

`401` = "who are you?"; `403` = "I know who you are, and the answer is no". A `502`/`504` usually means "the gateway is fine, the service behind it is not".

</div>

<!--
Order API exercise: 201 on create, 400 when an item references a missing product, 404 (not 403) for someone
else's order — it does not reveal that the order exists.
-->

---

<!-- _class: tight -->

## Request and response

<div class="cols">
<div>

```http
POST /orders HTTP/1.1
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...

{
  "customerId": 7,
  "items": [
    { "productId": 101, "quantity": 2 }
  ]
}
```

</div>
<div>

```http
HTTP/1.1 201 Created
Content-Type: application/json
Location: /orders/42

{
  "id": 42,
  "customerId": 7,
  "status": "PENDING",
  "total": { "amount": 59.90, "currency": "BRL" },
  "createdAt": "2026-04-28T14:30:00Z"
}
```

</div>
</div>

<div class="ok">

Conventions for every service: **camelCase** fields, dates in **ISO 8601** with time zone, money with an explicit **currency**, ids as opaque strings (the course uses UUIDs).

</div>

---

<!-- _class: tight -->

## Errors with a standard shape: Problem Details

RFC 9457, media type `application/problem+json`:

<div class="cols">
<div>

```json
{
  "type": "https://store.example.com/problems/out-of-stock",
  "title": "Product out of stock",
  "status": 422,
  "detail": "Product 101 is out of stock",
  "instance": "/orders"
}
```

</div>
<div>

| Field | Meaning |
|---|---|
| `type` | URI of the *kind* of problem |
| `title` | short summary of the kind |
| `status` | the HTTP status, repeated |
| `detail` | *this* occurrence |
| `instance` | URI of this occurrence |

</div>
</div>

- Spring: `@RestControllerAdvice` + `@ExceptionHandler` returning a `ProblemDetail`; `spring.mvc.problemdetails.enabled: true` for the framework's own errors (a failed `@Valid`).

<div class="warn">

**Never leak internals**: a stack trace or SQL message tells an attacker your framework, versions and tables. Log details with a trace id; return a generic message.

</div>

---

## Pagination and filtering

Never return unbounded collections: `GET /orders?page=2&size=20&sort=createdAt,desc` · `GET /orders?status=PENDING`

| Pattern | Parameters | Notes |
|---|---|---|
| **Offset** | `?page=2&size=20` | `OFFSET 40 LIMIT 20` still reads 40 rows; an insert makes an item appear twice |
| **Cursor** | `?after=eyJpZCI6NDJ9` | `WHERE id > :last ORDER BY id LIMIT 20`: uses the index, no page drift |
| **Filtering** | `?status=PENDING` | always on the server, never in the client |
| **Sorting** | `?sort=name,asc&sort=createdAt,desc` | several fields allowed |

<p class="small">Spring Data's <code>Pageable</code> reads page, size and sort (pages are <strong>0-based</strong>: <code>page=2</code> is the third); <code>PagedModel</code> returns <code>content</code> + <code>page</code> metadata (size, number, totalElements, totalPages).</p>

---

## Breaking or not?

Would an existing client, **unchanged**, stop working?

| Backward compatible (no new version) | Breaking (new version) |
|---|---|
| add an endpoint | remove or rename an endpoint |
| add an **optional** request field | add a **required** request field |
| add a response field | remove or rename a response field |
| accept a new input value | change a type or meaning (`price` in cents instead of reais) |
| | change a status code clients depend on |

<div class="ok">

Compatible changes rely on **tolerant readers**: clients ignore unknown fields (Jackson's default — do not turn it off in clients).

</div>

---

## Versioning

| Strategy | Example | Notes |
|---|---|---|
| **URI path** | `/v1/orders`, `/v2/orders` | most common in microservices; easy to test in a browser |
| **Header** | `Accept: application/vnd.myapi.v2+json` | cleaner URIs; harder to test manually |
| **Query param** | `/orders?version=2` | avoid — a version is not a filter |

- Major increments (`v1` → `v2`) signal breaking changes; run both side by side, announce a deprecation date, remove `v1` when its traffic is gone (`Sunset` header, RFC 8594).

<div class="warn">

**Pitfalls**: a version per change (clients cannot keep up) · breaking "just for one internal client" (you rarely know every client) · the shared `account` module: a change to `AccountOut` rebuilds every dependent service — treat it as a published contract.

</div>

---

<!-- _class: tight -->

## Spring Boot quick reference

```java
@RestController
@RequestMapping("/products")
public class ProductResource {
    @GetMapping("/{id}")
    public ResponseEntity<ProductOut> findById(@PathVariable String id) {
        return ResponseEntity.ok(productService.findById(id));            // 200, or 404 via the advice
    }
    @PostMapping
    public ResponseEntity<ProductOut> create(@RequestBody @Valid ProductIn in) {
        ProductOut created = productService.create(in);
        return ResponseEntity
            .created(URI.create("/products/" + created.id()))             // 201 + Location
            .body(created);
    }
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable String id) {
        productService.delete(id);
        return ResponseEntity.noContent().build();                        // 204
    }
}
```

<p class="small"><code>@ResponseStatus(CREATED)</code> also returns 201 but cannot set <code>Location</code>. <code>@Valid</code> runs Bean Validation (<code>@NotBlank</code>, <code>@Positive</code>) → <code>400</code>.</p>

---

<div class="kicker">OpenAPI and Swagger</div>

## The contract, written down

A teammate building the order service must call your product service. Your code is in another repo, a wiki goes stale, a Postman collection shows only what someone saved. They need **the contract itself**, readable by people and tools, generated from the code.

- **OpenAPI**: a language-agnostic YAML/JSON description of every endpoint — URL, method, parameters, body, responses.
- **Swagger UI**: renders it as an interactive page where you read and **execute** calls.
- *Swagger* was the spec's original name; donated to the OpenAPI Initiative in 2016. Today OpenAPI is the **format** (3.0, 3.1, 3.2 since 2025) and Swagger the **tools** (UI, Editor, Codegen).

<p class="small">Machine-readable, so it also feeds client generators, contract tests, mock servers and gateways that import routes.</p>

---

<!-- _class: tight -->

## Anatomy of an OpenAPI document

`GET /products/{id}` of the Product API exercise, in OpenAPI 3.1:

```yaml
openapi: 3.1.0
info: { title: Product Service API, version: 1.0.0 }
servers:
  - url: http://localhost:8080
paths:
  /products/{id}:
    get:
      summary: Find a product by ID
      parameters:
        - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
      responses:
        "200":
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ProductOut" }
        "404": { description: Product not found }
components:
  schemas: { ProductOut: { type: object } }
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer, bearerFormat: JWT }
```

---

## The sections of the document

| Section | What it holds |
|---|---|
| `info` | title, version and description of the **API** (not of OpenAPI) |
| `servers` | base URLs where the API can be reached |
| `paths` | every endpoint: method, parameters (`in: path`, `query`, `header`, `cookie`), request body, responses per status code |
| `components.schemas` | data models (the DTOs), referenced with `$ref` so they are defined once |
| `components.securitySchemes` | how clients authenticate (bearer token, API key, OAuth 2.0) |

<div class="ok">

You rarely write this file by hand in this course — springdoc generates it from the Java code — but knowing its structure is what lets you **read and review** the generated document.

</div>

---

## Code-first or contract-first?

| | **Code-first** (this course) | **Contract-first** |
|---|---|---|
| Source of truth | the Java controllers and DTOs | the `openapi.yaml` |
| Document | generated at startup (springdoc) | written first, reviewed by consumers |
| Code | written by hand | generated (`openapi-generator-maven-plugin`) |
| Good for | small teams, fast iteration | public APIs, many consumers, parallel front-end work |
| Risk | the API "just happens", design not reviewed | extra build step, rigid generated code |

<div class="ok">

Code-first matches the hands-on: the `account` module *is* the contract, in Java. Either way, review the generated document as a consumer would before merging.

</div>

---

## springdoc in a Spring Boot service

- Dependency `org.springdoc:springdoc-openapi-starter-webmvc-ui` — **3.0.x for Spring Boot 4** (the hands-on uses 4.0.3), 2.8.x for Boot 3; a mismatch fails at startup. WebFlux (the gateway): `springdoc-openapi-starter-webflux-ui`.
- Then: `/swagger-ui.html` (interactive) · `/v3/api-docs` (JSON) · `/v3/api-docs.yaml`.

<div class="q">

**Where to open it in our platform**: only the gateway publishes a port (`8080:8080`) and it routes `/accounts/**`, not `/swagger-ui/**`. Open a service's Swagger UI when running it alone (IDE, `localhost`) or by publishing its port during development — the documentation stays inside the trusted network.

</div>

---

<!-- _class: tight -->

## Annotating the API

```java
@Tag(name = "Products", description = "Manage the product catalogue")
public class ProductController {
    @GetMapping("/{id}")
    @Operation(summary = "Find a product by ID")
    @ApiResponse(responseCode = "200", description = "Product found")
    @ApiResponse(responseCode = "404", description = "Product not found")
    public ProductOut findById(@PathVariable String id) { ... }
}

public record ProductIn(
    @Schema(description = "Product name", example = "Tomato") @NotBlank String name,
    @Schema(description = "Unit price", example = "10.12") @Positive BigDecimal price,
    @Schema(description = "Unit of sale", example = "kg") @NotBlank String unit) {}
```

- springdoc infers paths, methods, types and DTO fields; annotations add descriptions, examples and non-obvious responses.
- Mappings and annotations on the interface (`AccountController`) are picked up: the documentation sits next to the contract.
- Bean Validation is documented: `@NotBlank` → `required`; `@Size`, `@Min`, `@Max` → schema limits.

---

## Metadata and security scheme

- Paths in `application.yml` (`springdoc.api-docs.path`, `springdoc.swagger-ui.path`); title, version and contact in an `OpenAPI` **`@Bean`**.
- A `bearerAuth` security scheme (`HTTP`, `bearer`, `JWT`) in the same bean → an **Authorize** button: paste a JWT and every call sends `Authorization: Bearer <token>`.

<div class="ok">

**In our platform** the gateway validates the JWT (from a cookie) and forwards `id-account`. To test a business service directly, fill the `id-account` header field springdoc generates from the `@RequestHeader` parameter; the bearer scheme is for services that validate tokens themselves.

</div>

---

## Swagger off in production

```yaml
# application-prod.yml
springdoc:
  api-docs:
    enabled: false
  swagger-ui:
    enabled: false
```

Activate with `SPRING_PROFILES_ACTIVE=prod` (in `compose.yaml` or the Kubernetes deployment). A public API on purpose? Publish the generated document on a documentation site instead.

<div class="warn">

- Swagger UI in production **documents your entire attack surface**.
- **Documentation that lies**: `@ApiResponse(responseCode = "404")` on a method that returns `500` — test the status codes.
- **Entities in the document**: document DTOs. **No examples**: add `example` to `@Schema`.

</div>

---

## Takeaways

1. An API is a **contract**: consumers depend on it, never on the implementation (`account` vs `account-service`); never expose entities — changing a DTO is changing the contract.
2. REST over HTTP is the default; gRPC, GraphQL, WebSocket and messaging solve specific needs. Most APIs live at Richardson **level 2**.
3. URIs name **resources**; `GET` is safe; `GET`, `PUT`, `DELETE` are idempotent; make `POST` retry-safe with an **idempotency key**.
4. Return the precise **status code** and errors as **Problem Details**; paginate every collection (cursors for large tables).
5. Add, do not remove: compatible changes need no version; breaking ones need **`/v2/`** and a deprecation period.
6. **OpenAPI** is the machine-readable contract; springdoc generates it (code-first); keep Swagger UI **off in production** and test the documented status codes.
