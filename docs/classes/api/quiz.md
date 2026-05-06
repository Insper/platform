
Click **"Answer"** to reveal the correct answer and explanation.

---

## REST API Design

**Q1.** Which HTTP method is **idempotent but not safe**?

- A. `GET` — safe and idempotent
- B. `POST` — neither safe nor idempotent
- C. `PUT` — calling it multiple times with the same body produces the same result, but it modifies server state
- D. `DELETE` — safe because it only removes data

??? success "Answer"
    **C — `PUT`.**

    *Safe* means the request does not modify server state. *Idempotent* means calling it multiple times has the same effect as calling it once. `PUT /orders/42` with the same body is safe to retry — the result is the same order state regardless of how many times it is called. `POST /orders` would create a new order on each call (not idempotent).

---

**Q2.** A client receives `401 Unauthorized`. What does this specifically indicate?

- A. The user is authenticated but lacks the required role or permission
- B. No valid authentication token was provided, or the token is invalid or expired
- C. The requested resource does not exist on the server
- D. The server encountered an unexpected error processing the request

??? success "Answer"
    **B — No valid authentication token.**

    `401` means "you are not authenticated" — the server does not know who you are. `403 Forbidden` means "I know who you are, but you are not allowed to do this." Confusing the two is a common mistake: a missing JWT should return 401, not 403.

---

**Q3.** Which URI designs follow REST conventions?

- A. `POST /createOrder` and `GET /getOrderById?id=42`
- B. `GET /orders` and `GET /orders/42`
- C. `GET /order-list` and `DELETE /removeOrder/42`
- D. `POST /orders/create` and `PUT /orders/update/42`

??? success "Answer"
    **B — `GET /orders` and `GET /orders/42`.**

    REST URIs identify *resources* (nouns), not operations (verbs). Use plural nouns for collections (`/orders`), nest for hierarchy (`/orders/42`), and express the operation through the HTTP method (GET, POST, PUT, DELETE) — never in the path.

---

**Q4.** What is the correct HTTP status code when a `POST` **successfully creates** a new resource?

- A. `200 OK` — success is always 200
- B. `201 Created`, accompanied by a `Location` header pointing to the new resource's URI
- C. `202 Accepted` — creation is queued for asynchronous processing
- D. `204 No Content` — used when the server has nothing to return

??? success "Answer"
    **B — `201 Created` with `Location` header.**

    `200` is for successful reads and updates. `201` signals that a new resource was created and tells the client where to find it via `Location: /orders/42`. This allows the client to immediately navigate to or cache the new resource without a separate GET.

---

**Q5.** Why is **cursor-based pagination** preferred over offset pagination for large datasets?

- A. Cursors are smaller in size than page numbers, reducing request payload
- B. Offset pagination is not supported by the HTTP specification
- C. Offset pagination requires the database to skip rows, which is expensive at scale and causes drift when items are inserted or deleted; cursor pagination reads forward from a stable pointer
- D. Cursor pagination allows the client to jump to any page directly

??? success "Answer"
    **C — Offset is expensive and drift-prone; cursor reads from a stable pointer.**

    `OFFSET 10000 LIMIT 20` forces the database to count and skip 10,000 rows — slow on large tables. If a new item is inserted on page 3 while the client reads page 4, rows shift and the client sees duplicates or skips items. A cursor (e.g., `after=eyJpZCI6NDJ9`) encodes the last-seen record and reads forward from exactly that point, immune to insertions.

---

**Q6.** Which level of the **Richardson Maturity Model** describes correct use of HTTP verbs and status codes?

- A. Level 0 — Swamp of POX (single endpoint for all operations)
- B. Level 1 — Resources (separate URIs per resource)
- C. Level 2 — HTTP Verbs (correct methods + status codes)
- D. Level 3 — HATEOAS (responses include links to next actions)

??? success "Answer"
    **C — Level 2.**

    Level 2 adds semantic use of HTTP methods (`GET` to read, `POST` to create, `DELETE` to remove) and proper status codes (`201 Created`, `404 Not Found`, `409 Conflict`). Most production REST APIs operate at Level 2. Level 3 (HATEOAS) adds hypermedia links and is rare in practice.

---

## OpenAPI & Swagger

**Q7.** What does the **springdoc-openapi** library generate automatically at startup?

- A. A PDF export of all controller method signatures
- B. A Postman collection for manual API testing
- C. An OpenAPI document by introspecting controllers and model classes, and a Swagger UI served at `/swagger-ui.html`
- D. Unit test stubs for every endpoint declared in the codebase

??? success "Answer"
    **C — OpenAPI document + Swagger UI at `/swagger-ui.html`.**

    springdoc-openapi reads `@RestController`, `@GetMapping`, `@RequestBody`, `@Schema` and similar annotations at application startup, generates a standards-compliant OpenAPI 3 document at `/v3/api-docs`, and serves an interactive Swagger UI — all without any manual YAML authoring.

---

**Q8.** Where should Swagger UI be **disabled**, and why?

- A. In development — developers should use `curl` instead
- B. In staging — the staging environment must mirror production exactly
- C. In production — it exposes the full attack surface of the API to anyone who accesses it
- D. Only in microservices — monoliths can safely expose Swagger UI in production

??? success "Answer"
    **C — In production.**

    Swagger UI provides an interactive map of every endpoint, parameter, and security scheme. An attacker can use it to enumerate attack vectors without reading the source code. Disable it with `springdoc.swagger-ui.enabled: false` and `springdoc.api-docs.enabled: false` in `application-prod.yml`.

---

**Q9.** What is the purpose of `@Schema` on a Java record field in a springdoc-openapi project?

- A. It marks the field as required for JSON deserialization
- B. It maps the field name to a different JSON key in the serialised output
- C. It adds a human-readable description and example value that appears in the generated OpenAPI document and Swagger UI
- D. It instructs the validator to reject null values for that field

??? success "Answer"
    **C — Adds description and example to the OpenAPI document.**

    Without `@Schema`, springdoc only knows the field name and type. `@Schema(description = "Price in BRL", example = "299.90")` makes the generated documentation self-explanatory — consumers know what the field means and what a valid value looks like, without reading the source code.

---

**Q10.** To allow Swagger UI to send **authenticated requests** with a JWT Bearer token, what must be configured?

- A. Add `@Secured` to every controller method and include the token in the request body
- B. Enable Spring Security's basic auth fallback in `application.yaml`
- C. Add a `SecurityScheme` of type `HTTP`/`bearer` to the `OpenAPI` bean, then use the **Authorize** button in Swagger UI to supply the token
- D. Configure `springdoc.swagger-ui.oauth.client-id` with the JWT issuer URL

??? success "Answer"
    **C — `SecurityScheme` of type HTTP/bearer + Authorize button.**

    Adding the security scheme to the `OpenAPI` bean tells springdoc to render an **Authorize** button in Swagger UI. The user pastes a JWT there, and all subsequent requests include `Authorization: Bearer <token>`. Without this configuration, Swagger UI sends unauthenticated requests to all secured endpoints.
