# REST vs GraphQL

Every microservice in this course publishes an API, and every front-end, partner and neighbouring service depends on it. REST and GraphQL are the two styles you will meet most often over HTTP. They ask for data in very different ways, and each choice has a cost: in round trips, in bytes, in database load, in caching and in how the API evolves.

This page compares them on the same need, a screen that shows a user, their orders and each order's items. It answers four questions:

- How does each style ask for data?
- What does one screen cost in round trips and bytes?
- What does it cost on the server?
- What happens to caching, errors and versioning?

For the wider picture, which also covers gRPC and asynchronous APIs, see the 2027.1 class [API styles](../2027.1/classes/compute/api-styles/index.md).

---

## Two ways to ask for data { #two-models }

**REST** (REpresentational State Transfer) is an architectural style, not a protocol[^2]. Roy Fielding described it in his 2000 dissertation[^4]. In practice, a REST API exposes **resources**, each with its own URL. Clients act on them with the HTTP **methods**, and each response carries a **representation** of the resource. The server decides the shape of that representation.

| Method | Meaning | Example | Safe | Idempotent |
|---|---|---|---|---|
| `GET` | read a resource | `GET /users/42` | yes | yes |
| `POST` | create (or run a command) | `POST /users/42/orders` | no | no |
| `PUT` | replace a resource | `PUT /users/42` | no | yes |
| `PATCH` | change part of a resource | `PATCH /users/42` | no | not necessarily |
| `DELETE` | remove a resource | `DELETE /orders/101` | no | yes |

**GraphQL** is a query language and runtime for APIs[^3]. Facebook built it in 2012 and released it in 2015. The server publishes a typed **schema** behind **one endpoint**, usually `POST /graphql`. The client sends a document that says which fields it wants, and the response has exactly that shape. There are three kinds of operations: `query` (read), `mutation` (write) and `subscription` (a stream of events). On the server, a **resolver** function fetches each field.

``` diagram
flowchart LR
    subgraph REST["REST: many resources, the server shapes each response"]
        direction TB
        a1([client]) -->|"GET /users/42"| r1[user resource]
        a1 -->|"GET /users/42/orders"| r2[orders resource]
        a1 -->|"GET /orders/101/items"| r3[items resource]
    end
    subgraph GQL["GraphQL: one endpoint, the client shapes the response"]
        direction TB
        b1([client]) -->|"POST /graphql<br/>query { user { orders { items } } }"| g[GraphQL server<br/>schema + resolvers]:::comp
        g --> s1[users]
        g --> s2[orders]
        g --> s3[items]
    end
```

This diagram replaces ByteByteGo's comparison chart, which is still a good one-page summary[^1].

---

## The same screen, both ways { #same-screen }

The *My orders* screen shows the user's name and avatar, then each order with its date and total, and the name and quantity of each item. With N orders:

=== "REST"

    ```http
    GET /users/42 HTTP/1.1
    Host: api.example.com

    HTTP/1.1 200 OK
    Content-Type: application/json

    {"id": 42, "name": "Ana", "avatarUrl": "/img/42.png", "email": "ana@example.com",
     "phone": "+55 11 5555-0000", "address": {"street": "...", "city": "São Paulo"},
     "createdAt": "2024-03-01T10:00:00Z", "preferences": {"...": "..."}}
    ```

    ```http
    GET /users/42/orders HTTP/1.1

    HTTP/1.1 200 OK

    [{"id": 101, "date": "2026-10-01", "total": 259.90, "status": "DELIVERED",
      "shippingAddress": {"...": "..."}, "payment": {"...": "..."}, "trackingCode": "..."},
     {"id": 102, "...": "..."}]
    ```

    ```http
    GET /orders/101/items HTTP/1.1
    GET /orders/102/items HTTP/1.1
    ...one request per order
    ```

    **2 + N requests.** The item requests need the order ids, which only arrive with the second response. Every response also carries fields the screen never shows (`email`, `address`, `payment`…).

=== "GraphQL"

    ```graphql
    query MyOrders {
      user(id: 42) {
        name
        avatarUrl
        orders(last: 10) {
          date
          total
          items { name quantity }
        }
      }
    }
    ```

    ```json
    {
      "data": {
        "user": {
          "name": "Ana",
          "avatarUrl": "/img/42.png",
          "orders": [
            { "date": "2026-10-01", "total": 259.9,
              "items": [ { "name": "T-shirt", "quantity": 2 } ] }
          ]
        }
      }
    }
    ```

    **One request**, and the response has exactly the fields of the query, in the same shape.

Step by step, the REST client pays one network round trip per resource:

``` diagram-sim
sequenceDiagram
    participant A as App
    participant API as REST API
    participant DB as Database
    A->>API: GET /users/42
    API->>DB: SELECT user 42
    API-->>A: the whole user (the screen uses 2 fields)
    A->>API: GET /users/42/orders
    API->>DB: SELECT orders of user 42
    API-->>A: N whole orders
    loop once per order
        A->>API: GET /orders/{id}/items
        API->>DB: SELECT items of order {id}
        API-->>A: whole items
    end
```

The GraphQL client pays one round trip, but on the server each resolver runs on its own:

``` diagram-sim
sequenceDiagram
    participant A as App
    participant G as GraphQL server
    participant DB as Database
    A->>G: POST /graphql (query MyOrders)
    G->>DB: user resolver: SELECT user 42
    G->>DB: orders resolver: SELECT orders of user 42
    loop items resolver, once per order
        G->>DB: SELECT items of order {id}
    end
    G-->>A: exactly the requested fields
```

The `loop` in the second diagram is the [N+1 problem](#n-plus-1). It did not disappear: it moved from the network to the database.

---

## Over-fetching and under-fetching { #over-under-fetching }

- **Over-fetching**: the response carries more than the client needs. `GET /users/42` returns the whole user even when the screen only shows the name. On a mobile network, those bytes cost time and battery.
- **Under-fetching**: one response is not enough, so the client makes more requests. Here that means one extra request per order.

GraphQL removes both by design: the client asks for exactly the fields it needs, across related objects, in one request.

REST APIs have their own fixes, each with a cost:

| Fix | Example | Cost |
|---|---|---|
| sparse fieldsets | `GET /users/42?fields=name,avatarUrl` (JSON:API[^5]) | every endpoint must support it |
| embedding / expansion | `GET /users/42/orders?expand=items` | the server must support each combination |
| a composite endpoint | `GET /screens/my-orders` | one endpoint per screen, coupled to the UI |
| a BFF (Backend for Frontend) | one API layer per front-end that calls the services | one more service to run |

A GraphQL server is often exactly that BFF: a layer in front of REST or gRPC services that composes them for the screens.

---

## The N+1 problem and DataLoader { #n-plus-1 }

A GraphQL server resolves a query field by field. The `orders` resolver returns N orders. Then the `items` resolver runs **once per order**, and each call makes its own query. That gives 1 query for the user, 1 for the orders and N for the items: **N + 2 queries for one request**. The name "N+1" comes from the 1 + N part. The client sees one fast round trip while the database receives a burst of small queries.

A **DataLoader**[^6] fixes it with batching. During one execution step, each resolver only *registers* the key it needs (`load(101)`, `load(102)`, …). At the end of the step, the loader calls a batch function once with all the keys. That function runs one query (`WHERE order_id IN (101, 102, …)`), and the loader hands each resolver its part. It also caches each key for the rest of the request.

In Spring for GraphQL, `@BatchMapping` registers a DataLoader for you[^7]:

=== "N+1: one call per order"

    ```java
    @Controller
    public class OrderController {

        @SchemaMapping(typeName = "Order", field = "items")
        public List<Item> items(Order order) {
            return itemRepository.findByOrderId(order.id());   // runs N times
        }
    }
    ```

=== "Batched: one call for all orders"

    ```java
    @Controller
    public class OrderController {

        @BatchMapping
        public Map<Order, List<Item>> items(List<Order> orders) {
            List<Long> ids = orders.stream().map(Order::id).toList();
            Map<Long, List<Item>> byOrder = itemRepository.findByOrderIdIn(ids).stream()
                .collect(Collectors.groupingBy(Item::orderId));   // runs once
            return orders.stream().collect(Collectors.toMap(
                o -> o, o -> byOrder.getOrDefault(o.id(), List.of())));
        }
    }
    ```

REST has the same problem, on the client: the loop of `GET /orders/{id}/items` is an N+1 across the network, and each step costs a full round trip.

The simulator puts numbers on both styles. The screen needs a user, N orders and 3 items per order. The costs are illustrative: 4 ms of application work per request and 5 ms per database query. Move the sliders to see where the time goes.

<div class="csim" data-sim="api-fetch" data-n="10" data-rtt="100" data-mode="seq" data-loader="off"></div>

!!! tip "Try it"
    Start with N = 10 orders and RTT = 100 ms. Sequential REST makes 12 round trips and takes 1,308 ms. It downloads 21.6 kB, and 88% of the payload is fields the screen never shows. Switch REST to **parallel**: the user and the orders go together, then all the item requests together. That is two waves, 218 ms. GraphQL makes one round trip, downloads 2.5 kB and takes 164 ms, but its resolvers ran 12 DB queries in a row. Turn the **DataLoader** on: 3 queries, 119 ms. Now turn it off again and drag N to 50: GraphQL takes 364 ms, slower than parallel REST at 218 ms. A naive GraphQL server can lose on the database the time it saved on the network.

---

## Caching { #caching }

**REST gets HTTP caching for free.** A `GET` has a URL, and the URL is the cache key. Browsers, CDNs and reverse proxies already understand `Cache-Control`. With `ETag` and `If-None-Match`, a client revalidates cheaply and gets a `304 Not Modified` with no body:

```http
GET /products/7 HTTP/1.1
If-None-Match: "v12"

HTTP/1.1 304 Not Modified
Cache-Control: max-age=60
ETag: "v12"
```

**GraphQL does not, by default.** Queries usually go as `POST` to the same `/graphql` URL, and HTTP caches do not store `POST` responses. Since every query differs, there is no URL to use as a key. The usual answers:

- **`GET` for queries.** The GraphQL over HTTP specification lets servers accept queries (never mutations) by `GET`, with the query in the URL[^8]. Long queries make long URLs, though.
- **Persisted queries.** The client registers each query ahead of time, at build time or on first use, and then sends only its hash. The request is short, it can be a cacheable `GET`, and a server that accepts *only* registered queries also blocks arbitrary, expensive queries. Apollo's "automatic persisted queries" are one widely used protocol[^9]:

    ```http
    GET /graphql?operationName=MyOrders&variables={"id":42}&extensions={"persistedQuery":{"version":1,"sha256Hash":"ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}} HTTP/1.1
    ```

- **Client-side normalized caches**, such as Apollo Client and Relay. They store each object of a response by type and id, so a later query that asks for `User:42` reads it from memory.

---

## Errors { #errors }

**REST uses the HTTP status code.** `404` means the resource does not exist, `400` a bad request, `409` a conflict, `503` that the service is unavailable. Proxies, gateways, retries and dashboards all read it without parsing the body. RFC 9457 (Problem Details) gives the body a standard shape[^10]:

```http
HTTP/1.1 404 Not Found
Content-Type: application/problem+json

{"type": "https://api.example.com/problems/order-not-found",
 "title": "Order not found", "status": 404, "detail": "Order 999 does not exist"}
```

**GraphQL reports errors in the body.** The response has an `errors` list next to `data`, and one query can partly succeed: the user and the orders come back, and one order's items fail. In practice, most servers answer `200 OK` whenever they could execute the query:

```json
{
  "data": { "user": { "name": "Ana", "orders": [ { "date": "2026-10-01", "items": null } ] } },
  "errors": [
    { "message": "inventory service unavailable",
      "path": ["user", "orders", 0, "items"],
      "extensions": { "classification": "INTERNAL_ERROR" } }
  ]
}
```

The GraphQL over HTTP specification, still a working draft, asks for a 4xx or 5xx status when there is no `data` at all, for example after a syntax error[^8]. Even so, a `200` can hide a partial failure. An error-rate alert that only counts 5xx responses misses GraphQL errors, so count the `errors` entries too.

---

## Versioning { #versioning }

**REST** usually puts breaking changes in a new version: `/v1/orders` → `/v2/orders`, a header or a media type. Old clients keep using v1 until it is retired. The whole topic has its own page: [Versioning REST APIs](versioning-rest-apis.md).

**GraphQL** usually has no versions. Each client names the fields it reads, so the schema can grow without breaking anyone: adding a field or a type is always safe. To replace a field, add the new one and mark the old one `@deprecated`. Then watch the field-usage metrics, and remove the old field when nobody asks for it anymore:

```graphql
type Order {
  id: ID!
  total: Float @deprecated(reason: "Use totalAmount, which carries the currency.")
  totalAmount: Money!
}

type Money {
  amount: String!
  currency: String!
}
```

Tools and IDEs warn about deprecated fields, and introspection lists them. This works because the server sees exactly which client reads which field. A REST server only sees that someone called `GET /orders`.

---

## When to use each { #when-to-use }

| | REST | GraphQL |
|---|---|---|
| Model | resources and HTTP methods | typed schema behind one endpoint |
| Response shape | decided by the server | decided by the client |
| Round trips per screen | often several | one |
| Over-fetching | common, fixed endpoint by endpoint | none by design |
| Server cost | predictable, per endpoint | depends on the query: N+1, deep queries |
| HTTP caching | built in (`GET`, `ETag`, CDN) | needs persisted queries or a client cache |
| Errors | HTTP status codes | `errors` in the body, partial data |
| Evolution | versions for breaking changes | add fields, `@deprecated`, remove later |
| Contract | OpenAPI (optional) | schema with introspection (mandatory) |

- **Choose REST** for public and partner APIs, CRUD services, cacheable reads and file downloads, and for calls between services. It is simple, every tool understands it, and status codes and caches work with no extra effort.
- **Choose GraphQL** when many different screens compose data from several services, especially on mobile networks. It usually sits as a BFF in front of REST or gRPC services. Plan for DataLoaders, query depth and cost limits, per-field authorization and persisted queries from day one.
- **gRPC** is the third option, for internal service-to-service calls: binary protobuf over HTTP/2, a mandatory `.proto` contract and streaming, but browsers cannot call it directly.

Most real systems mix them: REST at the public edge, GraphQL for the front-ends, gRPC or events inside.

---

## Key takeaways { #key-takeaways }

!!! takeaways ""
    - REST exposes **resources** acted on with HTTP methods, and the server shapes each response. GraphQL exposes a **typed schema** behind one endpoint, and the client shapes the response.
    - REST tends to **over-fetch** (whole representations) and **under-fetch** (one request per related resource). GraphQL fetches exactly the fields of one screen in one round trip.
    - The N+1 does not disappear with GraphQL: it moves to the server, where resolvers run one query per parent object. Batch them with a **DataLoader** (`@BatchMapping` in Spring).
    - REST gets **HTTP caching** for free. GraphQL needs `GET` queries, **persisted queries** or client-side caches.
    - REST reports errors in the **status code**. GraphQL returns `errors` in the body, often with a `200` and partial data, so monitor both.
    - REST **versions** breaking changes. GraphQL evolves one schema with `@deprecated` and field-usage metrics.

---

[^1]: XU, A., [System Design 101](https://github.com/ByteByteGoHq/system-design-101). See [SOAP vs REST vs GraphQL vs RPC](https://bytebytego.com/guides/soap-vs-rest-vs-graphql-vs-rpc/){target="_blank"}.

[^2]: :fontawesome-brands-wikipedia-w:{ .wikipedia } [REST](https://en.wikipedia.org/wiki/REST).

[^3]: :fontawesome-brands-wikipedia-w:{ .wikipedia } [GraphQL](https://en.wikipedia.org/wiki/GraphQL). The language is defined by the [GraphQL Specification](https://spec.graphql.org/){target="_blank"}.

[^4]: FIELDING, R. T., [Architectural Styles and the Design of Network-based Software Architectures, chapter 5: Representational State Transfer (REST)](https://ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm){target="_blank"}. PhD dissertation, University of California, Irvine, 2000.

[^5]: [JSON:API: Sparse Fieldsets](https://jsonapi.org/format/#fetching-sparse-fieldsets){target="_blank"}.

[^6]: [graphql/dataloader](https://github.com/graphql/dataloader){target="_blank"}, the reference implementation (JavaScript). Java has [java-dataloader](https://github.com/graphql-java/java-dataloader){target="_blank"}, which Spring for GraphQL uses.

[^7]: [Spring for GraphQL: `@BatchMapping`](https://docs.spring.io/spring-graphql/reference/controllers.html#controllers.batch-mapping){target="_blank"}.

[^8]: [GraphQL over HTTP](https://http-spec.graphql.org/draft/){target="_blank"}, working draft of the GraphQL Foundation.

[^9]: [Apollo Server: Automatic Persisted Queries](https://www.apollographql.com/docs/apollo-server/performance/apq){target="_blank"}.

[^10]: [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457){target="_blank"}. IETF, 2023.
