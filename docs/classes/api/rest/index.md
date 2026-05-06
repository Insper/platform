
**REST** (Representational State Transfer) is an architectural style — not a protocol — defined by Roy Fielding in his 2000 doctoral dissertation[^1]. A web API that follows REST constraints is called a **RESTful API**. REST uses HTTP as its transfer protocol and leverages the existing semantics of HTTP methods, status codes, and headers.

---

## REST constraints

| Constraint | Meaning |
|---|---|
| **Client-Server** | The client and server are separate concerns. The server does not know about the UI; the client does not know about storage. |
| **Stateless** | Each request contains all information needed to process it. The server stores no session state between requests. Authentication tokens (JWT) travel with every request. |
| **Cacheable** | Responses must declare whether they can be cached. Caching reduces load and improves latency. |
| **Uniform Interface** | Resources are identified by URIs. Representations are manipulated through standard HTTP methods. Responses include links to related resources (HATEOAS). |
| **Layered System** | Clients cannot tell whether they are talking to the end server or an intermediary (gateway, cache, load balancer). |

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

---

## HTTP methods

| Method | Idempotent | Safe | Use |
|---|---|---|---|
| `GET` | ✅ | ✅ | Retrieve a resource or collection. Must not modify state. |
| `POST` | ❌ | ❌ | Create a new resource. The server assigns the ID. |
| `PUT` | ✅ | ❌ | Replace a resource completely. The client provides the full representation. |
| `PATCH` | ❌ | ❌ | Partial update — only the provided fields are changed. |
| `DELETE` | ✅ | ❌ | Remove a resource. |

**Idempotent** — calling the same request multiple times has the same effect as calling it once. `PUT /orders/42` with the same body is safe to retry; `POST /orders` would create duplicates.

**Safe** — the request does not change server state. `GET` and `HEAD` are safe; all others are not.

---

## HTTP status codes

Use the right code — clients and intermediaries rely on them.

### 2xx — Success

| Code | Name | When to use |
|---|---|---|
| `200 OK` | Success | `GET`, `PUT`, `PATCH`, `DELETE` completed successfully |
| `201 Created` | Created | `POST` created a new resource; include `Location: /orders/42` header |
| `204 No Content` | No content | Success with no response body (e.g., `DELETE`) |

### 4xx — Client error

| Code | Name | When to use |
|---|---|---|
| `400 Bad Request` | Bad request | Malformed JSON, missing required fields, invalid values |
| `401 Unauthorized` | Unauthenticated | No token provided, or token is invalid/expired |
| `403 Forbidden` | Forbidden | Token is valid but the user lacks permission |
| `404 Not Found` | Not found | The resource does not exist |
| `409 Conflict` | Conflict | Duplicate resource, optimistic lock failure |
| `422 Unprocessable Entity` | Validation error | Well-formed request, but business validation failed |

### 5xx — Server error

| Code | Name | When to use |
|---|---|---|
| `500 Internal Server Error` | Unexpected error | Unhandled exception — never expose stack traces |
| `503 Service Unavailable` | Unavailable | The service is down for maintenance or overloaded |

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

### Error response

Standardise error responses so clients can handle them generically:

```json
{
  "status": 422,
  "error": "Validation failed",
  "message": "Product 101 is out of stock",
  "path": "/orders",
  "timestamp": "2026-04-28T14:30:00Z"
}
```

Spring Boot's `@ControllerAdvice` + `@ExceptionHandler` is the standard way to produce consistent error responses.

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

The response should include pagination metadata:

```json
{
  "content": [...],
  "page": { "number": 2, "size": 20, "total": 150, "totalPages": 8 }
}
```

---

## Versioning

APIs evolve. When a breaking change is unavoidable, version the API so existing clients are not broken:

| Strategy | Example | Notes |
|---|---|---|
| **URI path** | `/v1/orders`, `/v2/orders` | Most visible; easiest to test in a browser |
| **Header** | `Accept: application/vnd.myapi.v2+json` | Cleaner URIs; harder to test manually |
| **Query param** | `/orders?version=2` | Avoid — version is not a filter |

URI path versioning is the most common choice for microservices. Major version increments (`v1` → `v2`) signal breaking changes; minor improvements are added without a version bump.

---

## Spring Boot quick reference

```java
@RestController
@RequestMapping("/orders")
public class OrderController {

    @GetMapping
    public List<OrderOut> listOrders() { ... }

    @GetMapping("/{id}")
    public OrderOut getOrder(@PathVariable Long id) { ... }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public OrderOut createOrder(@RequestBody @Valid OrderIn in) { ... }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteOrder(@PathVariable Long id) { ... }
}
```

---

[^1]: FIELDING, R. T. *Architectural Styles and the Design of Network-based Software Architectures*. Doctoral dissertation, UC Irvine, 2000. [Read online](https://ics.uci.edu/~fielding/pubs/dissertation/top.htm){:target="_blank"}
[^2]: [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110){:target="_blank"}
[^3]: [HTTP Status Codes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status){:target="_blank"} — MDN Web Docs
