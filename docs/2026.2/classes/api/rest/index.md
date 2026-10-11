
Your team must publish the store's Product API: create, list, fetch and delete products. Two other teams (the web front-end and the order service) will call it without ever reading your code. Which URLs should exist? Which HTTP method creates a product? What does the client receive when the product does not exist, or when the request times out and it tries again? REST gives a shared set of answers, so that every API in the platform behaves the same way.

**REST** (Representational State Transfer) is an architectural style — not a protocol — defined by Roy Fielding in his 2000 doctoral dissertation[^1]. A web API that follows REST constraints is called a **RESTful API**. REST uses HTTP as its transfer protocol and leverages the existing semantics of HTTP methods, status codes, and headers[^2].

---

## Resources and representations

Two words carry the whole idea:

- A **resource** is anything the API exposes that has a name: a product, the collection of all products, the orders of one user. Each resource is identified by a **URI** (Uniform Resource Identifier), e.g. `/products/0195abfb-7074-73a9-9d26-b4b9fbaab0a8`.
- A **representation** is a snapshot of the resource's state in some format — usually a JSON document. The client never touches the resource itself (a row in Postgres); it reads and sends representations of it. That is the "Representational State Transfer" of the name.

```json title="A representation of one product (from the Product API exercise)"
{
  "id": "0195abfb-7074-73a9-9d26-b4b9fbaab0a8",
  "name": "Tomato",
  "price": 10.12,
  "unit": "kg"
}
```

The `Content-Type` header says which format the body is in (`application/json`); the `Accept` header says which formats the client wants back.

---

## REST constraints

Fielding defined REST as a set of constraints. An API that respects them gets the properties the Web is known for: scalability, independent evolution of client and server, and intermediaries (caches, gateways) that work without knowing the application.

| Constraint | Meaning |
|---|---|
| **Client-Server** | The client and server are separate concerns. The server does not know about the UI; the client does not know about storage. |
| **Stateless** | Each request contains all information needed to process it. The server stores no session state between requests. Authentication tokens (JWT) travel with every request. |
| **Cacheable** | Responses must declare whether they can be cached. Caching reduces load and improves latency. |
| **Uniform Interface** | Resources are identified by URIs. Representations are manipulated through standard HTTP methods. Messages are self-descriptive (`Content-Type`, status code). Responses include links to related resources (HATEOAS). |
| **Layered System** | Clients cannot tell whether they are talking to the end server or an intermediary (gateway, cache, load balancer). |
| **Code on Demand** *(optional)* | The server may send executable code to the client (e.g. JavaScript). The only optional constraint. |

In the course's platform, **Stateless** and **Layered System** are what make horizontal scaling possible: because no replica keeps a session, the load balancer of [Hands-on 7](../../../hands-on/7/index.md) can send each request to any gateway instance, and the client cannot tell Nginx, the gateway and the service apart.

---

## Resources and URIs

A **resource** is a noun — a thing the API exposes. URIs identify resources, not actions.

| ✅ Good (noun) | ❌ Bad (verb) |
|---|---|
| `GET /orders` | `GET /getOrders` |
| `POST /orders` | `POST /createOrder` |
| `GET /orders/42` | `GET /order?id=42` |
| `DELETE /orders/42` | `POST /deleteOrder/42` |

### URI conventions

- Use **plural nouns** for collections: `/orders`, `/products`, `/users`
- Use **lowercase with hyphens**: `/order-items` not `/orderItems`
- Nest to express ownership: `/users/7/orders` — orders belonging to user 7
- Limit nesting depth to 2–3 levels; avoid `/users/7/orders/42/items/3/reviews`
- Use **query parameters** for things that are not identity: filtering, sorting, pagination (`/orders?status=PENDING`)

!!! tip "Actions that are not CRUD"
    Some operations do not map neatly to create/read/update/delete — cancelling an order, for example. Two common options: model the action as a state change (`PATCH /orders/42` with `{"status": "CANCELLED"}`) or as a sub-resource (`POST /orders/42/cancellation`). Both keep the verb out of the path.

---

## HTTP methods

| Method | Idempotent | Safe | Use |
|---|---|---|---|
| `GET` | ✅ | ✅ | Retrieve a resource or collection. Must not modify state. |
| `POST` | ❌ | ❌ | Create a new resource. The server assigns the ID. |
| `PUT` | ✅ | ❌ | Replace a resource completely. The client provides the full representation. |
| `PATCH` | ❌ | ❌ | Partial update — only the provided fields are changed. |
| `DELETE` | ✅ | ❌ | Remove a resource. |

**Safe** — the request does not change server state. `GET`, `HEAD` and `OPTIONS` are safe; `POST`, `PUT`, `PATCH` and `DELETE` are not. Because they are safe, caches and crawlers may call them freely.

**Idempotent** — calling the same request multiple times has the same *effect on the server* as calling it once. `PUT /orders/42` with the same body can be retried freely; `POST /orders` would create duplicates. `PATCH` is not guaranteed to be idempotent: `{"op": "increment", "field": "quantity"}` changes the result on every call.

!!! warning "Idempotent is about the state, not the response"
    `DELETE /products/42` returns `204 No Content` the first time and `404 Not Found` the second. It is still idempotent: after one call or after ten, product 42 does not exist. Clients must therefore treat a `404` on a retried `DELETE` as success.

### Making `POST` safe to retry: idempotency keys

Networks lose messages. If the client sends `POST /orders` and the response never arrives, it cannot tell whether the order was created (see [Distributed Systems](../../distributed_systems/index.md)). Retrying may create a **duplicate order**; not retrying may lose it.

The standard solution is an **idempotency key**: the client generates a unique id (a UUID) per *logical* operation and sends it in a header; the server remembers which keys it has already processed and, on a repeat, returns the stored result instead of executing again[^4][^5].

``` mermaid-sim
sequenceDiagram
    participant C as Client
    participant O as Order Service
    C->>O: POST /orders, Idempotency-Key k1
    O->>O: create order 42, remember k1 → 42
    O--xC: 201 Created (response lost)
    Note over C: timeout, retry with the SAME key
    C->>O: POST /orders, Idempotency-Key k1
    O->>O: k1 already processed
    O-->>C: 201 Created, order 42 (no duplicate)
```

The server stores the key with the result (for example, in a table with a unique constraint on the key, or in Redis with an expiry). Payment providers such as Stripe use exactly this mechanism. Retries, timeouts and backoff are covered in [Resilience Patterns](../../reliability/patterns/index.md).

---

## HTTP status codes

Use the right code — clients and intermediaries rely on them[^3]. The first digit gives the class: **2xx** success, **3xx** redirection, **4xx** the client did something wrong (do not retry unchanged), **5xx** the server failed (a retry may succeed).

### 2xx — Success

| Code | Name | When to use |
|---|---|---|
| `200 OK` | Success | `GET`, `PUT`, `PATCH`, `DELETE` completed successfully |
| `201 Created` | Created | `POST` created a new resource; include `Location: /orders/42` header |
| `202 Accepted` | Accepted | The request was queued for asynchronous processing; the result is not ready yet |
| `204 No Content` | No content | Success with no response body (e.g., `DELETE`) |

### 4xx — Client error

| Code | Name | When to use |
|---|---|---|
| `400 Bad Request` | Bad request | Malformed JSON, missing required fields, invalid values |
| `401 Unauthorized` | Unauthenticated | No token provided, or token is invalid/expired |
| `403 Forbidden` | Forbidden | Token is valid but the user lacks permission |
| `404 Not Found` | Not found | The resource does not exist (or the caller must not know it exists) |
| `409 Conflict` | Conflict | Duplicate resource, optimistic lock failure |
| `422 Unprocessable Content` | Validation error | Well-formed request, but business validation failed (named "Unprocessable Entity" before RFC 9110) |
| `429 Too Many Requests` | Rate limited | The client exceeded its rate limit; send `Retry-After` |

### 5xx — Server error

| Code | Name | When to use |
|---|---|---|
| `500 Internal Server Error` | Unexpected error | Unhandled exception — never expose stack traces |
| `502 Bad Gateway` | Bad gateway | A gateway or proxy got an invalid response from the service behind it |
| `503 Service Unavailable` | Unavailable | The service is down for maintenance or overloaded |
| `504 Gateway Timeout` | Gateway timeout | A gateway or proxy did not get a response from the service behind it in time |

In a microservice platform the gateway codes matter: a `502` or `504` returned to the browser usually means "the gateway is fine, the service behind it is not" — the first clue when debugging.

!!! example "Status codes in the Order API exercise"
    The [Order API](../../../exercises/order/index.md) asks for `201` when an order is created, `400` when an item references a product that does not exist, and `404` when a user asks for an order that belongs to someone else. Returning `404` instead of `403` there is deliberate: it does not reveal that the order exists.

---

## Request and response format

### Request

```http
POST /orders HTTP/1.1
Host: api.example.com
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...

{
  "customerId": 7,
  "items": [
    { "productId": 101, "quantity": 2 }
  ]
}
```

### Response

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

Conventions worth keeping across all services: **camelCase** field names, dates in **ISO 8601** with time zone (`2026-04-28T14:30:00Z`), money with an explicit currency, and ids as opaque strings (the course uses UUIDs).

### Error response

Standardise error responses so clients can handle them generically. The IETF standard for this is **Problem Details for HTTP APIs** (RFC 9457[^6]), served with the media type `application/problem+json`:

```json
{
  "type": "https://store.example.com/problems/out-of-stock",
  "title": "Product out of stock",
  "status": 422,
  "detail": "Product 101 is out of stock",
  "instance": "/orders"
}
```

| Field | Meaning |
|---|---|
| `type` | A URI that identifies the *kind* of problem (default `about:blank`) |
| `title` | A short, human-readable summary of the kind of problem |
| `status` | The HTTP status code, repeated for convenience |
| `detail` | An explanation specific to *this* occurrence |
| `instance` | A URI identifying this occurrence (often the request path) |

Spring Boot's `@ControllerAdvice` / `@RestControllerAdvice` + `@ExceptionHandler` is the standard way to produce consistent error responses, and Spring's `ProblemDetail` class produces the RFC 9457 shape:

```java
@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(ProductNotFoundException.class)
    public ProblemDetail handleNotFound(ProductNotFoundException e) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
            HttpStatus.NOT_FOUND, e.getMessage());
        problem.setTitle("Product not found");
        return problem; // serialised as application/problem+json
    }
}
```

Setting `spring.mvc.problemdetails.enabled: true` makes Spring MVC's own errors (for example, a failed `@Valid`) use the same format.

!!! danger "Never leak internals in errors"
    A stack trace or an SQL message in a `500` response tells an attacker your framework, versions and table names. Log the details on the server (with a trace id, see [Observability](../../observability/index.md)) and return a generic message.

---

## Pagination and filtering

Collections should never return unbounded results. Use query parameters for pagination and filtering:

``` http
GET /orders?page=2&size=20&sort=createdAt,desc
GET /orders?status=PENDING&customerId=7
```

| Pattern | Parameters | Notes |
|---|---|---|
| **Offset pagination** | `?page=2&size=20` | Simple; expensive on large datasets (DB must skip rows) |
| **Cursor pagination** | `?after=eyJpZCI6NDJ9` | Efficient for large tables; opaque cursor prevents page drift |
| **Filtering** | `?status=PENDING` | Always filter on the server — never return all records and filter in the client |
| **Sorting** | `?sort=field,direction` | Multiple sort fields: `?sort=name,asc&sort=createdAt,desc` |

Offset pagination asks the database for `OFFSET 40 LIMIT 20`: the database still reads and discards the first 40 rows, and if a row is inserted meanwhile, the client sees an item twice. A cursor encodes "the last item I saw" (e.g. its id) and the query becomes `WHERE id > :last ORDER BY id LIMIT 20`, which uses the index and is not affected by inserts.

The response should include pagination metadata. Spring Data's `Pageable` reads `page`, `size` and `sort` automatically (pages are **0-based**, so `page=2` is the third page), and its `PagedModel` serialises as:

```json
{
  "content": [...],
  "page": { "size": 20, "number": 2, "totalElements": 150, "totalPages": 8 }
}
```

---

## Versioning

APIs evolve. The first question is whether a change is **breaking** — whether an existing client, unchanged, would stop working:

| Backward compatible (no new version) | Breaking (needs a new version) |
|---|---|
| Add a new endpoint | Remove or rename an endpoint |
| Add an **optional** field to a request | Add a **required** field to a request |
| Add a field to a response | Remove or rename a response field |
| Accept a new value in an input | Change a field's type or meaning (`price` in cents instead of reais) |
|  | Change a status code clients depend on |

Compatible changes rely on clients being **tolerant readers**: they ignore fields they do not know. (Jackson in Spring Boot ignores unknown properties by default; do not turn that off in clients.)

When a breaking change is unavoidable, version the API so existing clients are not broken:

| Strategy | Example | Notes |
|---|---|---|
| **URI path** | `/v1/orders`, `/v2/orders` | Most visible; easiest to test in a browser |
| **Header** | `Accept: application/vnd.myapi.v2+json` | Cleaner URIs; harder to test manually |
| **Query param** | `/orders?version=2` | Avoid — version is not a filter |

URI path versioning is the most common choice for microservices. Major version increments (`v1` → `v2`) signal breaking changes; minor improvements are added without a version bump. Run both versions side by side, announce a deprecation date, and remove `v1` only when its traffic has gone — the `Sunset` header (RFC 8594) tells clients when an endpoint will disappear.

!!! warning "Versioning pitfalls"
    - Bumping the version for every change: clients cannot keep up. Prefer compatible changes.
    - Breaking a contract "just for one internal client": in a microservice platform you rarely know every client.
    - Sharing the `account` interface module between services (as in the hands-on) means a change to `AccountOut` forces every dependent service to rebuild — treat that module as a published contract.

---

## Spring Boot quick reference

The Product API of the [exercise](../../../exercises/product/index.md), with the status codes chosen above:

```java
@RestController
@RequestMapping("/products")
public class ProductResource {

    @Autowired
    private ProductService productService;

    @GetMapping
    public ResponseEntity<List<ProductOut>> findAll() {
        return ResponseEntity.ok(productService.findAll());               // 200
    }

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

`@ResponseStatus(HttpStatus.CREATED)` on a method also returns `201`, but it cannot set the `Location` header; `ResponseEntity.created(uri)` sets both. `@Valid` triggers Bean Validation on the DTO (`@NotBlank`, `@Positive`…) and turns a violation into `400 Bad Request`.

---

## Key takeaways

- URIs name **resources** (plural nouns); the **HTTP method** says what to do; clients exchange **representations** (JSON).
- `GET` is safe; `GET`, `PUT` and `DELETE` are idempotent; `POST` is neither — make it retry-safe with an **idempotency key**.
- Return the precise status code (`201` + `Location`, `204`, `401` vs `403`, `422`, `502`/`504`) and errors as **Problem Details**.
- Paginate every collection; prefer cursors for large or fast-changing tables.
- Add, do not remove: compatible changes need no version; breaking ones need `/v2/` and a deprecation period.

## Connections

- Implement these conventions: [Hands-on 1 — CRUD](../../../hands-on/1/index.md), [Product API](../../../exercises/product/index.md), [Order API](../../../exercises/order/index.md).
- `401` and `403` in practice: [Hands-on 3 — Security](../../../hands-on/3/index.md) and [Security](../../security/index.md).
- Retries and `429`/`503`: [Resilience Patterns](../../reliability/patterns/index.md).
- Document the contract: [OpenAPI & Swagger](../swagger/index.md).

---

[^1]: FIELDING, R. T. *Architectural Styles and the Design of Network-based Software Architectures*. Doctoral dissertation, UC Irvine, 2000. [Read online](https://ics.uci.edu/~fielding/pubs/dissertation/top.htm){:target="_blank"}
[^2]: [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110){:target="_blank"}
[^3]: [HTTP Status Codes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status){:target="_blank"} — MDN Web Docs
[^4]: [The Idempotency-Key HTTP Header Field](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/){:target="_blank"} — IETF HTTPAPI working group draft.
[^5]: [Idempotent requests](https://docs.stripe.com/api/idempotent_requests){:target="_blank"} — Stripe API reference.
[^6]: [RFC 9457 — Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457){:target="_blank"}
