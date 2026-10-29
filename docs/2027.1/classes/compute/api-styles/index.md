Four different clients need the same information from BoxOffice — "which events are on sale, and how many seats are left?":

- the **web app**, rendering an event page that combines catalog data, the seat map and availability;
- the **mobile app**, on a congested 4G connection in a stadium queue, where every kilobyte and round trip counts;
- a **reseller partner** that integrates once and then expects the API never to break;
- the internal **`order` service**, which asks `inventory` to confirm holds thousands of times per second during on-sale.

One API style does not fit all four. This page compares the four families you will meet in practice — **REST, gRPC, GraphQL and asynchronous APIs** — on the *same* BoxOffice resource, and then covers what matters more than the style: designing the contract well and evolving it without breaking anyone.

---

## An API is a contract

An **API** (Application Programming Interface) is the contract between a **provider** (the service that implements it) and its **consumers** (the code that calls it): which operations exist, what they accept and what they return — and nothing about how they are implemented. A stable contract is what lets the `catalog` team rewrite its persistence layer without telling anybody, and what lets the mobile team ship without waiting for the backend.

Three consequences shape everything below:

- **Expose DTOs, not entities.** A DTO (Data Transfer Object) is a class whose only job is to cross the boundary. Returning the JPA entity ties the contract to the database schema and leaks internal fields.
- **The contract is a document, not just code.** OpenAPI (REST), `.proto` files (gRPC), the GraphQL schema and AsyncAPI (events) describe it in a machine-readable way, from which clients, servers, mocks and tests are generated.
- **Changing the contract is a negotiation.** Anything a consumer can observe — a field name, a status code, the order of a list — is part of it.

---

## One resource, four styles

The resource: an **event** with its **availability** (seats left per section). Here is how each style expresses "give me event `evt_42` with its availability".

=== "REST + OpenAPI"

    Resources are identified by URLs, operations by HTTP methods, results by status codes; the contract is an **OpenAPI** document.

    ```http
    GET /v1/events/evt_42?include=availability HTTP/1.1
    Accept: application/json
    ```

    ```yaml title="openapi.yaml (excerpt)"
    openapi: 3.1.0
    info: { title: BoxOffice Catalog API, version: 1.4.0 }
    paths:
      /v1/events/{eventId}:
        get:
          operationId: getEvent
          parameters:
            - { name: eventId, in: path, required: true, schema: { type: string } }
            - { name: include, in: query, schema: { type: string, enum: [availability] } }
          responses:
            "200":
              description: The event
              content:
                application/json:
                  schema: { $ref: "#/components/schemas/Event" }
            "404": { $ref: "#/components/responses/NotFound" }
    components:
      schemas:
        Event:
          type: object
          required: [id, title, startsAt, venue]
          properties:
            id: { type: string, example: evt_42 }
            title: { type: string, example: "Stadium Tour — São Paulo" }
            startsAt: { type: string, format: date-time }
            venue: { $ref: "#/components/schemas/VenueRef" }
            availability:
              type: array
              items:
                type: object
                properties:
                  section: { type: string, example: "PISTA" }
                  seatsLeft: { type: integer, example: 1180 }
                  priceCents: { type: integer, example: 45000 }
    ```

    Any HTTP client can call it — a browser, `curl`, a partner's script — and `GET` responses can be cached by browsers and CDNs.

=== "gRPC + Protocol Buffers"

    Operations are **remote procedure calls** declared in a `.proto` file; code for client and server is **generated**, and messages travel as compact binary over HTTP/2.

    ```protobuf title="inventory.proto"
    syntax = "proto3";
    package boxoffice.inventory.v1;

    import "google/protobuf/timestamp.proto";

    service InventoryService {
      rpc GetAvailability (GetAvailabilityRequest) returns (Availability);
      // server streaming: the seat map pushes changes while the fan looks at it
      rpc WatchAvailability (GetAvailabilityRequest) returns (stream AvailabilityChange);
    }

    message GetAvailabilityRequest {
      string event_id = 1;
    }

    message Availability {
      string event_id = 1;
      repeated Section sections = 2;
      google.protobuf.Timestamp as_of = 3;
    }

    message Section {
      string name = 1;
      int32 seats_left = 2;
      int64 price_cents = 3;
    }

    message AvailabilityChange {
      string section = 1;
      int32 seats_left = 2;
    }
    ```

    The numbers (`= 1`, `= 2`) are **field tags**: on the wire only the tag and the value travel, not the field name — which is why protobuf messages are compact, and why a tag must never be reused.

=== "GraphQL"

    One endpoint (`POST /graphql`) and a typed **schema**; the **client chooses the fields** it wants, possibly crossing several services in one request.

    ```graphql title="schema.graphql (excerpt)"
    type Query {
      event(id: ID!): Event
      events(city: String, first: Int = 20, after: String): EventConnection!
    }

    type Event {
      id: ID!
      title: String!
      startsAt: DateTime!
      venue: Venue!
      availability: [SectionAvailability!]!   # resolved by the inventory service
    }

    type SectionAvailability {
      section: String!
      seatsLeft: Int!
      priceCents: Int!
    }
    ```

    ```graphql title="the mobile app's query"
    query EventCard {
      event(id: "evt_42") {
        title
        startsAt
        availability { section seatsLeft }
      }
    }
    ```

    The mobile app gets exactly `title`, `startsAt` and two fields per section — no venue description, no images, no prices it does not display.

=== "Async (events + AsyncAPI)"

    No request at all: the provider **publishes** a fact when something changes, and interested consumers subscribe. The contract is the message schema and the channel, described in **AsyncAPI**.

    ```yaml title="asyncapi.yaml (excerpt)"
    asyncapi: 3.0.0
    info: { title: BoxOffice Inventory Events, version: 1.0.0 }
    channels:
      availabilityChanged:
        address: inventory.availability.v1
        messages:
          AvailabilityChanged:
            payload:
              type: object
              required: [eventId, section, seatsLeft, occurredAt]
              properties:
                eventId: { type: string, example: evt_42 }
                section: { type: string, example: PISTA }
                seatsLeft: { type: integer, example: 1179 }
                occurredAt: { type: string, format: date-time }
    operations:
      publishAvailabilityChanged:
        action: send
        channel: { $ref: "#/channels/availabilityChanged" }
    ```

    `search` and `analytics` consume this topic to keep their own copies up to date; nobody calls `inventory` to ask.

---

## REST in practice

REST (Representational State Transfer) was defined by Roy Fielding as an architectural style on top of HTTP semantics[^1][^2]. In practice "REST API" means **Richardson maturity level 2**: resources with their own URLs, correct HTTP methods and status codes[^3].

### Resources and methods for BoxOffice

| Method + path | Meaning | Safe | Idempotent | Success |
|---|---|---|---|---|
| `GET /v1/events?city=sao-paulo&cursor=…` | list events | yes | yes | `200` |
| `GET /v1/events/{id}` | one event | yes | yes | `200` |
| `POST /v1/events/{id}/holds` | hold seats for 10 min | no | **no** → needs an `Idempotency-Key` | `201` + `Location` |
| `DELETE /v1/holds/{holdId}` | release a hold | no | yes | `204` |
| `POST /v1/orders` | check out a hold | no | **no** → needs an `Idempotency-Key` | `202` (payment pending) or `201` |
| `GET /v1/orders/{id}` | order status | yes | yes | `200` |
| `PATCH /v1/fans/me` | update profile fields | no | not guaranteed | `200` |

**Safe** means the request does not change server state (caches and crawlers may call it freely). **Idempotent** means doing it twice has the same *effect* as doing it once, so it is safe to retry. `POST` is neither — which is why every `POST` that creates money-related state in BoxOffice requires an **idempotency key** ([integrations](../integrations/index.md#idempotency-keys)).

### Status codes that carry meaning

| Code | BoxOffice meaning | Client should… |
|---|---|---|
| `200 OK` / `201 Created` | done / created (with `Location`) | proceed |
| `202 Accepted` | order received, payment still being processed | poll `GET /orders/{id}` or wait for a push |
| `400 Bad Request` / `422 Unprocessable Content` | malformed / semantically invalid (7 seats, max is 6) | fix the request — never retry |
| `401` / `403` | not authenticated / not allowed | log in / give up |
| `404 Not Found` | no such event | give up |
| `409 Conflict` | seat already held by someone else | pick other seats |
| `429 Too Many Requests` | rate limited (bots at on-sale) | wait `Retry-After`, then retry |
| `503 Service Unavailable` | overloaded or dependency down | retry with backoff + jitter |

Errors deserve a **uniform body**. RFC 9457 *Problem Details for HTTP APIs* defines one (`application/problem+json`) that Spring Boot (3 and later) supports out of the box via `ProblemDetail`[^4]:

```json title="409 Conflict — application/problem+json"
{
  "type": "/problems/seat-unavailable",
  "title": "Seat unavailable",
  "status": 409,
  "detail": "Seat C-14 is held by another fan.",
  "instance": "/v1/events/evt_42/holds",
  "unavailableSeats": ["C-14"]
}
```

### Pagination: offset vs cursor

| | Offset (`?page=3&size=20`) | Cursor / keyset (`?after=eyJpZCI6...&limit=20`) |
|---|---|---|
| Query | `ORDER BY starts_at LIMIT 20 OFFSET 40` | `WHERE (starts_at, id) > (:t, :id) ORDER BY starts_at, id LIMIT 20` |
| Deep pages | slow: the DB still walks the skipped rows | fast: an index seek |
| Inserts during paging | rows shift → duplicates or gaps | stable |
| Jump to page 37 | yes | no (next/previous only) |
| Use for | small admin tables | feeds, catalogs, anything large or live |

The cursor is an opaque string (often base64 of the last row's sort key) that the client sends back unchanged.

### Caching and long-running operations

- **Conditional requests**: `catalog` returns `ETag: "v17"` and `Cache-Control: public, max-age=30`; a client that repeats the request with `If-None-Match: "v17"` gets `304 Not Modified` with no body. The CDN ([edge](../../edge/dns-cdn/index.md#cache-control)) does the same at scale — another reason to keep reads as cacheable `GET`s.
- **Long-running operations**: never hold a connection for 30 s. Answer `202 Accepted` with a `Location: /v1/orders/ord_9` status resource, and let the client poll it or receive a push. Checkout uses exactly this while the payment provider decides.

### The contract in code

With **springdoc-openapi**, the OpenAPI document is generated from the annotated controller (*code-first*); alternatively the YAML is written first and the controller interface is generated from it (*contract-first*, e.g. with `openapi-generator`). Contract-first fits APIs consumed by partners; code-first is faster for internal ones.

```java title="catalog: EventController.java"
@RestController
@RequestMapping("/v1/events")
@Tag(name = "Events")
class EventController {

    private final EventQueries queries;

    EventController(EventQueries queries) { this.queries = queries; }

    @GetMapping("/{eventId}")
    @Operation(summary = "Get one event, optionally with seat availability")
    ResponseEntity<EventDto> get(@PathVariable String eventId,
                                 @RequestParam(required = false) Include include) {
        EventDto event = queries.find(eventId, include == Include.AVAILABILITY)
                .orElseThrow(() -> new ErrorResponseException(HttpStatus.NOT_FOUND));
        return ResponseEntity.ok()
                .eTag(event.version())
                .cacheControl(CacheControl.maxAge(Duration.ofSeconds(30)).cachePublic())
                .body(event);
    }
}
```

[Hands-on 1](../../../hands-on/1/index.md) builds a simpler version of this controller (box below).

!!! example "In the BoxOffice code: the `catalog` contract (lab 1)"

    [Hands-on 1 — API](../../../hands-on/1/api/index.md) is code-first: springdoc reads the controller and publishes the OpenAPI document under the service's own prefix, `/catalog/openapi` (Swagger UI at `/swagger-ui.html`), so the document travels through the edge and the gateway with the API it describes. `POST` answers `201` with a `Location`, and every error is `application/problem+json`. Compare it with the ideal above: there is no `/v1` yet (add it before an external consumer depends on these paths), pagination is offset (`page`, `size` ≤ 50) over 200,000 seeded events, cheap for the first pages and slow for deep ones, and there is no `ETag`: the lab makes reads cheap with Redis instead ([lab 5](../../../hands-on/5/cache-aside/index.md)).

    ``` { .java title="services/catalog/src/main/java/boxoffice/catalog/EventController.java (the contract, code-first)" }
    --8<-- "docs/2027.1/hands-on/1/code/services/catalog/src/main/java/boxoffice/catalog/EventController.java:20:47"
    ```

---

## gRPC in practice

gRPC is an RPC framework from Google built on **HTTP/2** and **Protocol Buffers**[^5]. What you get:

- **Generated, typed clients** in a dozen languages from one `.proto` — calling `inventory.getAvailability(req)` looks like a local method call.
- **Compact binary messages** and cheap parsing: protobuf payloads are typically several times smaller than the equivalent JSON, which matters for chatty internal traffic.
- **Multiplexing**: many concurrent calls over one HTTP/2 connection.
- **Streaming**: unary, server streaming (`WatchAvailability` above), client streaming and bidirectional.
- **Deadlines** that propagate: the caller says "I need an answer within 300 ms", and every hop knows how much time is left.

And what it costs:

- **Browsers cannot call it directly**: you need gRPC-Web or Connect through a proxy, or a REST/GraphQL facade at the edge.
- **Load balancing is subtle**: one long-lived HTTP/2 connection carries all calls, so an L4 load balancer pins all traffic of a client to one server. Use an L7 proxy (Envoy, a service mesh) or client-side load balancing ([edge](../../edge/load-balancing/index.md#l4-l7)).
- **Harder to debug by hand**: binary on the wire; use `grpcurl` and server reflection.

**Typical use**: high-volume, internal, service-to-service calls — `order` → `inventory` during on-sale — where both sides are yours.

---

## GraphQL in practice

GraphQL is a query language and runtime for APIs[^6]. The client sends a query describing the shape of the data it wants; the server's **resolvers** fetch each field, possibly from different services.

- **No over-fetching or under-fetching**: one round trip returns exactly what a screen needs — attractive for mobile.
- **A typed schema** with introspection: great tooling and self-documentation.
- **Evolution without versions**: add fields freely, mark old ones `@deprecated`, remove them when usage drops to zero.

The problems to plan for:

- **The N+1 problem**: listing 20 events, each with `availability`, naively triggers 1 + 20 calls to `inventory`. Batch them with a **DataLoader** (collect the 20 ids, make one call).
- **Caching is harder**: queries usually go as `POST` to one URL, so HTTP caches and CDNs do not help by default. **Persisted queries** (the client sends a hash of a pre-registered query, possibly with `GET`) restore cacheability and block arbitrary queries.
- **Abusive queries**: a deeply nested query can be very expensive. Limit depth and compute a **query cost** budget per client.
- **Authorization per field**, not per endpoint.

**Typical use**: a **BFF** (Backend for Frontend) — one GraphQL layer per front-end that composes `catalog`, `inventory` and `search` for the screens. Large organizations use **federation** to let each team own part of one graph.

---

## Asynchronous APIs

Not every interaction is a question that needs an immediate answer. Asynchronous styles remove the caller's wait:

| Style | Direction | BoxOffice use | Covered in |
|---|---|---|---|
| **Events on a broker** (Kafka, Pub/Sub) | provider publishes, many consumers | `OrderConfirmed` → notification, analytics, search | [messaging](../../messaging/index.md) |
| **Commands on a queue** | one producer, one of N workers | "render ticket PDF for order 9" | [async work](../async-work/index.md) |
| **Webhooks** | provider calls *your* URL when something happens | the payment provider tells `payment` a charge succeeded | [integrations](../integrations/index.md#webhooks) |
| **WebSocket / SSE** | server pushes to a connected client | live seat map, "your place in the queue: 18,204" | [edge — protocols](../../edge/protocols/index.md#real-time) |

The contract still matters: event schemas need the same discipline as REST payloads — documented (AsyncAPI), versioned and evolved compatibly (schema registry, [messaging](../../messaging/index.md)).

---

## Choosing a style

| | REST | gRPC | GraphQL | Async (events/queues) |
|---|---|---|---|---|
| Transport | HTTP/1.1, 2, 3 | HTTP/2 | HTTP | broker protocol (Kafka, AMQP), HTTP for webhooks |
| Payload | JSON (text) | protobuf (binary) | JSON | JSON, Avro, protobuf |
| Contract | OpenAPI (optional!) | `.proto` (mandatory) | schema (mandatory) | AsyncAPI, schema registry |
| Browser-native | yes | no (gRPC-Web/Connect) | yes | WebSocket/SSE for push |
| HTTP caching | excellent (`GET`, ETag, CDN) | none | hard (persisted queries) | not applicable |
| Streaming | SSE, chunked | built in (4 kinds) | subscriptions | inherent |
| Coupling | request/response, temporal | request/response, temporal, codegen | request/response, temporal | **none in time**: consumers can be down |
| Best for | public & partner APIs, CRUD, cacheable reads | internal high-QPS calls, polyglot services, streaming | front-ends composing many services (BFF) | side effects, fan-out, work that can wait |

``` diagram
flowchart TD
    q1{"Does the caller need<br/>the result to continue?"} -->|no| async["Async: event or queue<br/>(or a webhook to a partner)"]
    q1 -->|yes| q2{"Who is the consumer?"}
    q2 -->|"browser, partner,<br/>public"| q3{"Does one screen need data<br/>from many services?"}
    q3 -->|yes| gql["GraphQL BFF<br/>(REST underneath)"]
    q3 -->|no| rest["REST + OpenAPI"]
    q2 -->|"internal service,<br/>high volume or streaming"| grpc["gRPC"]
    q2 -->|"internal service,<br/>moderate volume"| rest
```

Real systems mix them. BoxOffice: **REST** at the public edge and for partners, a **GraphQL BFF** for the web and mobile apps, **gRPC** between `order` and `inventory`, **events** for everything that happens *because* an order was confirmed, and **webhooks** in from the payment provider.

---

## Evolving a contract

APIs change. The first question for every change is whether it is **breaking** — whether an existing, unchanged consumer would stop working:

| Compatible (no new version) | Breaking (needs a new version or a migration) |
|---|---|
| add an endpoint, RPC or query field | remove or rename an endpoint, RPC or field |
| add an **optional** request field | add a **required** request field |
| add a response field | remove a response field, or change its type or meaning (`price` in cents instead of reais) |
| accept a new enum value *in input* | return a new enum value consumers cannot handle |
| add a new event type | change the meaning of an existing event |

Compatible changes rely on consumers being **tolerant readers**: they ignore fields they do not know (Jackson does by default in Spring Boot — keep it so). Each style has its own rules:

- **REST/JSON**: tolerant readers + optional fields; breaking changes go to a new major version.
- **Protobuf**: never change or reuse a field tag; when you delete a field, mark its tag `reserved` so nobody reuses it; adding fields is always safe.
- **GraphQL**: no versions — add fields, deprecate with `@deprecated(reason: …)`, remove when usage telemetry says nobody asks for them.
- **Events**: the schema registry checks compatibility on every new version; old events stay in the log forever, so consumers must read every version that was ever written.

When a breaking change is unavoidable, version and migrate:

| Strategy | Example | Notes |
|---|---|---|
| URI path | `/v1/orders` → `/v2/orders` | most visible; easiest to route and test — the common choice |
| Header / media type | `Accept: application/vnd.boxoffice.v2+json` | cleaner URLs; harder to test by hand |
| Package (gRPC) | `boxoffice.inventory.v1` → `.v2` | both services can run side by side |

Then **expand and contract** (parallel change): ship v2 next to v1, migrate consumers, watch v1 traffic fall to zero, announce the date with the `Sunset` header (RFC 8594)[^7], and only then remove v1.

!!! info "Consumer-driven contract tests"
    How do you know a change is compatible before deploying it? Each consumer publishes the interactions it relies on ("`order` calls `GET /v1/holds/{id}` and reads `status` and `expiresAt`"); the provider's CI replays them against the new version and fails the build if any breaks. Tools: **Pact**, **Spring Cloud Contract**. This turns "did we break someone?" from a production incident into a red build.

!!! tip "In the interview"

    The API step of the interview framework takes 3–5 minutes: list the **few endpoints that matter**, with method, path, key parameters and response — not the whole CRUD. For BoxOffice:

    - `GET /v1/events/{id}/availability` → sections and seats left (cacheable for a few seconds)
    - `POST /v1/events/{id}/holds` `{seats}` + `Idempotency-Key` → `201 {holdId, expiresAt}` or `409`
    - `POST /v1/orders` `{holdId, paymentToken}` + `Idempotency-Key` → `202 {orderId, status: PENDING}`
    - `GET /v1/orders/{id}` → status

    Mention **pagination** (cursor), **idempotency** for writes, **rate limits**, and say *why* you picked the style ("REST at the edge for cacheability and partners; gRPC internally between order and inventory"). Interviewers notice when you know which calls are retried and which must not duplicate.

!!! success "Best practices"

    - **Publish the contract from the build and fail CI on breaking changes** — generate the OpenAPI document on every build and diff it against the last release (oasdiff, openapi-diff): a removed field breaks the pipeline, not a consumer. In BoxOffice: springdoc publishes it at `/catalog/openapi` ([lab 1](../../../hands-on/1/api/index.md), box above).
    - **Bound every collection** — a default and a maximum page size, rejected with `400` above the maximum. In BoxOffice: `size` ≤ 50 on `GET /catalog/events` (lab 1).
    - **Return one error shape everywhere** — RFC 9457 Problem Details with a stable `type` URI that clients can switch on, never a free-text message they must parse. In BoxOffice: `spring.mvc.problemdetails.enabled: true` in every service.
    - **Prefer opaque, non-sequential ids for private resources** — a sequential id leaks volume and invites enumeration of other users' objects. In BoxOffice: holds use UUIDs ([lab 6](../../../hands-on/6/holds/index.md)); public events keep database ids.
    - **Deprecate with a date and a metric** — announce it with the `Sunset` header (RFC 8594), count calls per version, and remove the old version when its traffic reaches zero, not when the calendar says so.

!!! warning "Common pitfalls"

    - **Leaking the implementation**: returning entities, database ids or internal enum names that you will never be able to change.
    - **Chatty APIs**: a screen that needs 12 sequential calls is slow on mobile; aggregate in a BFF or design coarser resources.
    - **Verbs in URLs** (`/createOrder`, `/getEvents`): RPC disguised as REST; use methods on resources.
    - **`200 OK` with `{"error": ...}`**: breaks retries, monitoring and caches — use the status code.
    - **Non-idempotent writes without keys**: a timeout plus a retry equals a double charge.
    - **Silent breaking changes**: renaming a field passes the provider's tests and breaks every consumer — use contract tests.
    - **gRPC behind an L4 load balancer**: all calls stick to one replica.

---

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    CON["API = contract<br/>OpenAPI, proto, schema"] --> REST["REST<br/>public, cacheable"]
    CON --> GRPC["gRPC<br/>internal, high volume"]
    CON --> GQL["GraphQL BFF<br/>one screen, many services"]
    CON --> ASYNC["async: events, queues,<br/>webhooks → Messaging"]
    REST --> HTTP["status codes, cursor pagination,<br/>Cache-Control → CDN"]
    REST --> IDEM["idempotency keys<br/>→ Integrations"]
    GRPC --> H2["HTTP/2, streaming, deadlines<br/>→ Edge protocols"]
    CON --> EVO["compatible evolution,<br/>contract tests"]
    EVO --> VER["breaking change: new version,<br/>expand and contract"]
    ASYNC --> SCH["event schemas evolve too<br/>→ Messaging semantics"]
```

**Palette components:** [`app`](../../../reference/components/compute/index.md#app) (every service publishes a contract) · [`client`](../../../reference/components/client/index.md#client) · [`mobile`](../../../reference/components/client/index.md#mobile) (consumers of the REST API and the GraphQL BFF) · [`cdn`](../../../reference/components/edge/index.md#cdn) (caches the cacheable `GET`s) · [`queue`](../../../reference/components/messaging/index.md#queue) (commands) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (events such as `OrderConfirmed`) · [`payment`](../../../reference/components/external/index.md#payment) (calls BoxOffice back by webhook). **Scenarios:** `event-fanout`, `payment-system`, `chat` (server push). **Continues in:** [Edge — protocols](../../edge/protocols/index.md), [Edge — API gateway](../../edge/api-gateway/index.md), [Messaging — schema evolution](../../messaging/semantics/index.md#schema-evolution), [Integrations — idempotency keys](../integrations/index.md#idempotency-keys), [Hands-on 1](../../../hands-on/1/index.md).

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - An API is a **contract**; describe it in a machine-readable form (OpenAPI, `.proto`, GraphQL schema, AsyncAPI) and expose DTOs, not entities.
    - **REST** for public and cacheable APIs, **gRPC** for internal high-volume calls, **GraphQL** for front-ends composing many services, **async** when the caller does not need to wait — real systems mix them.
    - Design REST with correct methods and status codes, **Problem Details** errors, **cursor pagination**, caching headers, `202` for long operations and **idempotency keys** for unsafe writes.
    - Evolve compatibly (tolerant readers, optional fields, never reuse protobuf tags, `@deprecated`); version only for breaking changes, then expand and contract; catch breaks with **contract tests**.

---

[^1]: [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110){target="_blank"}. IETF, 2022.
[^2]: FIELDING, R. T. *Architectural Styles and the Design of Network-based Software Architectures*. Doctoral dissertation, UC Irvine, 2000.
[^3]: FOWLER, M. [Richardson Maturity Model](https://martinfowler.com/articles/richardsonMaturityModel.html){target="_blank"}. martinfowler.com, 2010.
[^4]: [RFC 9457 — Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457){target="_blank"}. IETF, 2023.
[^5]: [gRPC — Core concepts, architecture and lifecycle](https://grpc.io/docs/what-is-grpc/core-concepts/){target="_blank"}; [Protocol Buffers — Language guide (proto 3)](https://protobuf.dev/programming-guides/proto3/){target="_blank"}.
[^6]: [GraphQL Specification](https://spec.graphql.org/){target="_blank"}; [OpenAPI Specification](https://spec.openapis.org/oas/latest.html){target="_blank"}; [AsyncAPI Specification](https://www.asyncapi.com/docs/reference/specification/latest){target="_blank"}.
[^7]: [RFC 8594 — The Sunset HTTP Header Field](https://www.rfc-editor.org/rfc/rfc8594){target="_blank"}. IETF, 2019.
