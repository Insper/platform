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
Outline: (1) what an API contract is, in our platform; (2) API styles and the Richardson model;
(3) REST: resources, methods, idempotency keys, status codes, Problem Details, pagination, versioning;
(4) OpenAPI documents and Swagger UI with springdoc.
-->

---

## Replace everything behind it

<div class="q">

The team rewrites the product service: new language, new database, new framework.
Which clients break?

</div>

* **None** — as long as the **contract** is respected.
* An API defines the **operations**, their **inputs** and **outputs** — and hides the implementation.
* In the hands-on: module `account` = the contract (`AccountController` + `AccountIn`/`AccountOut`); `account-service` = the private implementation.
* Changing a **DTO** is changing the contract: never return the JPA model.

---

## Types of APIs

| Style | Protocol | Format | Typical use |
|---|---|---|---|
| **REST** | HTTP/1.1, HTTP/2 | JSON / XML | public and internal web APIs — the default |
| **gRPC** | HTTP/2 | Protocol Buffers | fast internal service-to-service calls |
| **GraphQL** | HTTP | JSON | client picks the fields; Backend for Frontend |
| **WebSocket** | HTTP `Upgrade`, then full-duplex | any | real time: chat, live feeds |
| **Message-based** | AMQP / Kafka | JSON / Avro | asynchronous, event-driven integration |

<p class="small">Same question, three shapes: <code>GET /products/42</code> · <code>rpc GetProduct(GetProductRequest)</code> · <code>query { product(id: "42") { name price } }</code></p>

---

## How RESTful? The Richardson model

| Level | Characteristic | Example |
|---|---|---|
| **0 — Swamp of POX** | one endpoint for everything | `POST /service?op=getOrder` |
| **1 — Resources** | one URI per resource | `GET /orders/42` |
| **2 — HTTP verbs** | right methods + status codes | `DELETE /orders/42` → `204` |
| **3 — Hypermedia** | responses link to next actions (HATEOAS) | `"rel": "cancel"` |

<div class="ok">

Most production APIs live at **level 2** — the focus of this course, documented with **OpenAPI / Swagger**.

</div>

---

<!-- _class: tight -->

## REST: resources, representations, constraints

A **resource** has a URI (`/products/42`); clients exchange **representations** of it (JSON).

| Constraint | Meaning |
|---|---|
| **Client-Server** | UI and storage are separate concerns |
| **Stateless** | each request carries everything — the JWT goes with every call |
| **Cacheable** | responses declare whether they can be cached |
| **Uniform Interface** | URIs + standard methods + self-descriptive messages |
| **Layered System** | the client cannot tell the server from a gateway or load balancer |
| **Code on Demand** | optional: the server may send code (JavaScript) |

<!--
Stateless + layered is what lets Nginx send each request to any gateway replica (hands-on 7).
-->

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
- Nest for ownership: `/users/7/orders`
- At most 2–3 levels of nesting
- Filters, sort, pages → **query** parameters

</div>
</div>

---

## HTTP methods

| Method | Idempotent | Safe | Use |
|---|---|---|---|
| `GET` | ✅ | ✅ | read a resource or collection |
| `POST` | ❌ | ❌ | create — the server assigns the ID |
| `PUT` | ✅ | ❌ | replace the whole resource |
| `PATCH` | ❌ | ❌ | partial update |
| `DELETE` | ✅ | ❌ | remove |

- **Safe**: does not change server state. **Idempotent**: repeating it has the same **effect** as calling once.
- A second `DELETE /products/42` returns `404` — still idempotent: the state is the same.

<!--
Ask: a client times out on POST /orders. Can it simply retry? Why is PUT different?
-->

---

## Retrying a `POST`: idempotency keys

<div class="q">

`POST /orders` times out. Was the order created? Retry and risk a duplicate, or give up and risk losing it?

</div>

* The client sends a unique **`Idempotency-Key`** (a UUID) per logical operation.
* The server stores processed keys with their result.
* A retry with the **same key** returns the stored result — **no duplicate**.
* Same mechanism as Stripe's payment API; retries and backoff → Resilience Patterns.

---

<!-- _class: tight -->

## Status codes: use the right one

<div class="cols3">
<div>

### 2xx — success

- `200 OK`
- `201 Created` + `Location`
- `202 Accepted` (async)
- `204 No Content`

</div>
<div>

### 4xx — client error

- `400` malformed request
- `401` no / invalid token
- `403` valid token, no permission
- `404` not found
- `409` conflict, duplicate
- `422` business rule failed
- `429` rate limited

</div>
<div>

### 5xx — server error

- `500` unhandled — **no stack traces**
- `502` bad answer behind the gateway
- `503` down or overloaded
- `504` no answer behind the gateway

</div>
</div>

<div class="warn">

`401` means "who are you?"; `403` means "I know who you are, and the answer is no".

</div>

---

## Request and response

<div class="cols">
<div>

```http
POST /products HTTP/1.1
Content-Type: application/json

{
  "name": "Tomato",
  "price": 10.12,
  "unit": "kg"
}
```

</div>
<div>

```http
HTTP/1.1 201 Created
Location: /products/0195abfb-...

{
  "id": "0195abfb-...",
  "name": "Tomato",
  "price": 10.12,
  "unit": "kg"
}
```

</div>
</div>

<p class="small">Spring: <code>ResponseEntity.created(uri).body(out)</code> sets both <code>201</code> and <code>Location</code>; <code>@ResponseStatus(CREATED)</code> cannot set the header.</p>

---

## Errors with a standard shape: Problem Details

RFC 9457, media type `application/problem+json`:

```json
{
  "type": "https://store.example.com/problems/out-of-stock",
  "title": "Product out of stock",
  "status": 422,
  "detail": "Product 101 is out of stock",
  "instance": "/orders"
}
```

<p class="small">In Spring Boot: <code>@RestControllerAdvice</code> + <code>@ExceptionHandler</code> returning a <code>ProblemDetail</code>; <code>spring.mvc.problemdetails.enabled: true</code> for the framework's own errors.</p>

---

## Pagination and versioning

<div class="cols">
<div>

### Never return unbounded collections

- Offset: `?page=2&size=20` — simple, slow on large tables
- Cursor: `?after=eyJpZCI6NDJ9` — uses the index, no page drift
- Filter on the **server**: `?status=PENDING`
- Spring Data pages are **0-based**

</div>
<div>

### Version on breaking changes

- **URI path**: `/v1/orders` — most common, easy to test
- **Header**: `Accept: application/vnd.myapi.v2+json`
- **Query param**: `?version=2` — avoid, it is not a filter
- Run `v1` and `v2` side by side, then retire `v1`

</div>
</div>

---

## Breaking or not?

| Backward compatible | Breaking → new version |
|---|---|
| add an endpoint | remove or rename an endpoint |
| add an **optional** request field | add a **required** request field |
| add a response field | remove or rename a response field |
| accept a new input value | change a type or meaning (cents vs. reais) |

<div class="ok">

Clients are **tolerant readers**: they ignore fields they do not know. Prefer compatible changes; version only when you must.

</div>

---

<!-- _class: tight -->

## OpenAPI: the contract as a document

```yaml
openapi: 3.1.0
info: { title: Product Service API, version: 1.0.0 }
paths:
  /products/{id}:
    get:
      summary: Find a product by ID
      responses:
        "200":
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ProductOut" }
        "404": { description: Product not found }
components:
  schemas: { ProductOut: { type: object } }
```

- **Code-first** (this course): springdoc generates it from the Java code. **Contract-first**: write the YAML, generate code.
- *Swagger* = the old name of the spec; today the tools (Swagger UI, Editor).

---

<!-- _class: tight -->

## springdoc and Swagger UI

- Dependency `org.springdoc:springdoc-openapi-starter-webmvc-ui` — **3.0.x for Spring Boot 4**, 2.8.x for Boot 3.
- `/swagger-ui.html` (interactive) · `/v3/api-docs` (JSON) · `/v3/api-docs.yaml`
- Describe with `@Tag`, `@Operation`, `@ApiResponse`, and `@Schema(description, example)` on the DTO records.
- JWT: a `bearerAuth` security scheme in the `OpenAPI` bean → **Authorize** button.
- In our platform the gateway resolves the JWT; test a service directly with the `id-account` header.

```yaml
# application-prod.yml
springdoc:
  api-docs: { enabled: false }
  swagger-ui: { enabled: false }
```

<div class="warn">

Swagger UI in production **documents your entire attack surface**.

</div>

---

## Takeaways

1. An API is a **contract**: consumers depend on it, never on the implementation (`account` vs `account-service`).
2. Most APIs live at Richardson **level 2**: resources + HTTP verbs + status codes.
3. Know what is **safe** (`GET`) and **idempotent** (`GET`, `PUT`, `DELETE`); make `POST` retry-safe with an **idempotency key**.
4. Return the **right status code** and errors as **Problem Details**.
5. Paginate collections; prefer **compatible changes**, version breaking ones with **`/v2/`**.
6. An **OpenAPI** document describes the contract; **springdoc** generates it and Swagger UI from the code — keep it off in production.
