# Versioning REST APIs

A microservice is deployed on its own schedule, but its consumers are not: a mobile app that users never update, a partner that integrated once, another team's service that has its own deadlines. When the API has to change in a way that would break them, the provider needs a way to offer the new contract **next to** the old one, and a way to retire the old one in an orderly fashion. That is API versioning.

This page answers:

- When does a change need a new version, and when does it not?
- Where does the version go: path, query parameter, header or media type?
- How do you implement it in Spring, with the built-in support of Spring Boot 4 and the classic way?
- How do you deprecate and retire the old version without surprising anyone?

It complements the section [Evolving a contract](../2027.1/classes/compute/api-styles/index.md#evolving-a-contract) of the 2027.1 class on API styles. GraphQL takes a different path, with one schema that evolves through `@deprecated`: see [REST vs GraphQL](rest-vs-graphql.md#versioning).

---

## When do you need a new version? { #breaking-changes }

Only for **breaking changes**: those after which an existing, unchanged consumer stops working. Everything else is a compatible change and ships in the current version.

| Change | Breaking? | Why |
|---|---|---|
| add a new endpoint | no | nobody calls it yet |
| add a field to a response | no, for tolerant readers | clients ignore fields they do not know |
| add an **optional** request field or query parameter | no | old requests stay valid |
| remove or rename a response field | **yes** | clients that read it get `null` or fail |
| change a field's type, format or unit (`price: 10.5` → `"10.50"`, reais → cents) | **yes** | the value is parsed or interpreted wrongly |
| make a request field **required**, or tighten validation | **yes** | old requests start getting `400` |
| return a new enum value | often | a client with a `switch` over the known values breaks |
| change a status code (`200` → `202`) or the error format | **yes** | client logic depends on them |
| change the default sort order or page size | subtly | clients that relied on it show wrong data |
| remove an endpoint | **yes** | calls get `404` |

Two habits make most changes compatible, and so avoid most new versions:

- **Tolerant reader**[^7]: a consumer reads only the fields it needs and ignores the rest. Spring Boot's JSON mapper ignores unknown properties by default (Jackson 3, used by Spring Boot 4, made it the library default), so keep it that way.
- **Expand and contract** (parallel change)[^8]: instead of renaming `price`, add `priceCents` next to it, migrate consumers, and remove `price` only when nobody reads it anymore. A field is also part of the contract, and it can be deprecated on its own.

When a breaking change is unavoidable, increase the **major** version (semantic versioning[^9]: `MAJOR.MINOR.PATCH`). Compatible changes do not need a version the client has to ask for.

---

## Four ways to carry the version { #strategies }

| Strategy | Request | Advantages | Drawbacks |
|---|---|---|---|
| **URI path** | `GET /api/v2/orders/7` | visible in links, logs and the browser; easy to route at the gateway or ingress; cacheable by URL | the "same" resource gets two URLs; usually versions the whole API at once |
| **Query parameter** | `GET /api/orders/7?version=2` | easy to add; can be optional with a default | easy to forget; mixes with filters; caches must keep the query string |
| **Custom header** | `GET /api/orders/7` + `API-Version: 2` | clean, stable URLs; can be set once in the client | invisible in links; caches and CDNs need `Vary: API-Version`; harder to test by hand |
| **Media type** | `Accept: application/vnd.example+json;version=2` | versions the *representation* through content negotiation, the most faithful to REST | the hardest to document, test and route; caches need `Vary: Accept` |

There is no standard way. The **URI path** is the most common choice for public APIs because it is the easiest to see, route and debug. A header is common for internal APIs whose clients are all code. Whatever you choose, use **one** strategy across all your services, and document it in the OpenAPI description.

---

## Versioning in Spring { #spring }

### Spring Framework 7 and Spring Boot 4: built-in support { #spring-7 }

Spring Framework 7.0 (November 2025) and Spring Boot 4.0 added first-class API versioning to Spring MVC[^2]. It has three parts:

1. **Resolve** the version from each request, with one of the four strategies.
2. **Parse and validate** it. The default parser reads `MAJOR.MINOR.PATCH` and skips a leading `v`, so `v2` is the same as `2.0.0`. A version that is not supported gets `400 Bad Request`.
3. **Map** the request to a controller method with the new `version` attribute of `@RequestMapping` (and of `@GetMapping`, `@PostMapping`…).

The simplest setup uses Spring Boot properties[^3]:

```yaml title="application.yaml"
spring:
  mvc:
    apiversion:
      use:
        header: API-Version
      default: "1.0"
      supported: ["1.0", "2.0"]
```

The same in Java, with `ApiVersionConfigurer`:

```java
@Configuration
public class ApiVersionConfig implements WebMvcConfigurer {

    @Override
    public void configureApiVersioning(ApiVersionConfigurer configurer) {
        configurer.useRequestHeader("API-Version")
                  .addSupportedVersions("1.0", "2.0")
                  .setDefaultVersion("1.0");
    }
}
```

By default, a request without a version gets `400`. Configuring a default version makes the version optional: requests that send none get the default.

Only the methods that changed need a version. A mapping without `version` matches any version, but any versioned method that matches takes priority over it. A **baseline** version such as `"2.0+"` matches 2.0 and every supported version above it, so the method carries on into 2.1, 2.2… until a newer one replaces it:

```java
@RestController
@RequestMapping("/orders")
public class OrderController {

    @GetMapping(path = "/{id}", version = "1.0")
    public OrderV1 getV1(@PathVariable Long id) {
        return OrderV1.from(service.find(id));    // price in reais, as a decimal
    }

    @GetMapping(path = "/{id}", version = "2.0+")
    public OrderV2 getV2(@PathVariable Long id) {
        return OrderV2.from(service.find(id));    // priceCents + currency
    }

    @PostMapping                                  // unchanged: serves every version
    public ResponseEntity<Void> create(@RequestBody NewOrder order) {
        return ResponseEntity.created(service.create(order)).build();
    }
}
```

The other strategies only change the resolver:

| Strategy | `ApiVersionConfigurer` | Spring Boot property |
|---|---|---|
| URI path | `usePathSegment(1)`: the segment index in `/api/{version}/orders`, which the mappings must declare as a URI variable | `spring.mvc.apiversion.use.path-segment=1` |
| query parameter | `useQueryParam("version")` | `spring.mvc.apiversion.use.query-parameter=version` |
| header | `useRequestHeader("API-Version")` | `spring.mvc.apiversion.use.header=API-Version` |
| media type | `useMediaTypeParameter(MediaType.parseMediaType("application/vnd.example+json"), "version")` | `spring.mvc.apiversion.use.media-type-parameter` (a map from media type to parameter name) |

Clients get the same support. A service that calls another one sets the version once on its `RestClient` (also on `WebClient` and HTTP interface clients):

```java
RestClient orders = RestClient.builder()
    .baseUrl("http://order:8080")
    .apiVersionInserter(ApiVersionInserter.useHeader("API-Version"))
    .defaultApiVersion("2.0")
    .build();
```

### Older versions: plain request mappings { #spring-classic }

Before Spring Framework 7 (Spring Boot 3.x and older), there is no `version` attribute. Each strategy is written with the attributes `@RequestMapping` always had[^1]:

=== "URI path"

    ```java
    @RestController
    @RequestMapping("/api/v1/orders")
    public class OrderControllerV1 {

        @GetMapping("/{id}")
        public OrderV1 get(@PathVariable Long id) { ... }
    }

    @RestController
    @RequestMapping("/api/v2/orders")
    public class OrderControllerV2 {

        @GetMapping("/{id}")
        public OrderV2 get(@PathVariable Long id) { ... }
    }
    ```

=== "Query parameter"

    ```java
    @GetMapping(path = "/orders/{id}", params = "version=1")
    public OrderV1 getV1(@PathVariable Long id) { ... }

    @GetMapping(path = "/orders/{id}", params = "version=2")
    public OrderV2 getV2(@PathVariable Long id) { ... }
    ```

=== "Custom header"

    ```java
    @GetMapping(path = "/orders/{id}", headers = "API-Version=1")
    public OrderV1 getV1(@PathVariable Long id) { ... }

    @GetMapping(path = "/orders/{id}", headers = "API-Version=2")
    public OrderV2 getV2(@PathVariable Long id) { ... }
    ```

=== "Media type"

    ```java
    @GetMapping(path = "/orders/{id}", produces = "application/vnd.example.v1+json")
    public OrderV1 getV1(@PathVariable Long id) { ... }

    @GetMapping(path = "/orders/{id}", produces = "application/vnd.example.v2+json")
    public OrderV2 getV2(@PathVariable Long id) { ... }
    ```

This works, but you have to handle a missing or unknown version yourself (depending on the strategy, it ends in a `400`, `404` or `406`), and every versioned method repeats the condition. In both styles, keep the business logic in one service and let only the controllers and DTOs differ per version.

In a microservice architecture, the version can also select a **deployment**: the gateway or the Kubernetes ingress sends `/api/v1/**` to the pods of the old release and `/api/v2/**` to the new one. Each version then scales, and is eventually switched off, independently.

---

## Deprecation and sunset { #deprecation-sunset }

A version is retired in stages, and the client should learn about each stage **from the API itself**, not only from an e-mail. Two standard response headers carry that information:

- **`Deprecation`** (RFC 9745, March 2025)[^4]: this resource is (or will be) deprecated from this date. It still works, but you should migrate. The value is a structured-field date: `@` followed by Unix seconds. Earlier drafts used `Deprecation: true`, and you may still meet it.
- **`Sunset`** (RFC 8594, May 2019)[^5]: from this date the resource is expected to stop responding. The value is an HTTP date. RFC 9745 requires the sunset to be no earlier than the deprecation.
- **`Link`** headers with `rel="deprecation"` and `rel="sunset"` point to the human documentation: the migration guide, the retirement policy.

```http
HTTP/1.1 200 OK
Content-Type: application/json
Deprecation: @1795996800
Sunset: Mon, 31 May 2027 00:00:00 GMT
Link: <https://api.example.com/docs/migrate-to-v2>; rel="deprecation"; type="text/html"
```

Here `@1795996800` is 30 November 2026, 00:00 UTC. The lifecycle of v1, step by step:

``` diagram-sim
sequenceDiagram
    participant C as Client
    participant G as API gateway
    participant V1 as orders v1
    participant V2 as orders v2
    Note over V1: 1. v1 live
    C->>G: GET /api/v1/orders/7
    G->>V1: route /api/v1/**
    V1-->>C: 200 OK
    Note over V2: 2. v2 released, v1 still served
    Note over V1: 3. v1 deprecated
    C->>G: GET /api/v1/orders/7
    G->>V1: route /api/v1/**
    V1-->>C: 200 OK + Deprecation, Sunset and Link headers
    C->>G: GET /api/v2/orders/7 (the client migrates)
    G->>V2: route /api/v2/**
    V2-->>C: 200 OK
    Note over V1: 4. sunset date: v1 traffic should be near zero
    Note over G: 5. v1 removed
    C->>G: GET /api/v1/orders/7 (a forgotten client)
    G-->>C: 410 Gone + Link to the migration guide
```

- **Measure before you remove.** Count requests per version and per client, for example with a `version` label on the request metrics. Remove v1 when its traffic reaches zero, or when the remaining clients have been warned in person, not just because the calendar says so.
- **Answer with a clear error after removal.** `410 Gone` with a link to the migration guide explains more than a bare `404`. RFC 8594 does not prescribe a code: after the sunset, anything from an error to a redirect is allowed.
- **Publish a policy**, for example "a major version is supported for at least 6 months after its successor ships", so that consumers can plan.

In Spring Framework 7, `StandardApiVersionDeprecationHandler` writes these headers for every request to a deprecated version[^2]:

```java
@Override
public void configureApiVersioning(ApiVersionConfigurer configurer) {
    StandardApiVersionDeprecationHandler deprecation = new StandardApiVersionDeprecationHandler();
    deprecation.configureVersion("1.0")
        .setDeprecationDate(ZonedDateTime.parse("2026-11-30T00:00:00Z"))
        .setDeprecationLink(URI.create("https://api.example.com/docs/migrate-to-v2"))
        .setSunsetDate(ZonedDateTime.parse("2027-05-31T00:00:00Z"));

    configurer.useRequestHeader("API-Version")
              .addSupportedVersions("1.0", "2.0")
              .setDefaultVersion("1.0")
              .setDeprecationHandler(deprecation);
}
```

On older versions, set the same headers yourself, in the deprecated controllers or once in a filter for the whole `/api/v1/**`:

```java
@GetMapping("/{id}")
public ResponseEntity<OrderV1> get(@PathVariable Long id) {
    return ResponseEntity.ok()
        .header("Deprecation", "@1795996800")
        .header("Sunset", "Mon, 31 May 2027 00:00:00 GMT")
        .header(HttpHeaders.LINK, "<https://api.example.com/docs/migrate-to-v2>; rel=\"deprecation\"; type=\"text/html\"")
        .body(OrderV1.from(service.find(id)));
}
```

---

## Catching breaks before production: contract tests { #contract-tests }

How do you know a change is compatible *before* deploying it? With **consumer-driven contracts**, each consumer publishes the interactions it relies on, for example "`order` calls `GET /api/v1/products/{id}` and reads `name` and `price`". The provider's CI replays every published contract against the new build and fails if any of them breaks. A forbidden change then shows up as a red build, not as a production incident, and the contracts also tell you exactly which consumers still use v1. The common tools are **Pact** and **Spring Cloud Contract**[^6].

---

## Key takeaways { #key-takeaways }

!!! takeaways ""
    - Create a new version only for **breaking changes**: removing or renaming fields, changing types or meaning, new required inputs, different status codes. Additive changes ship in the current version.
    - **Tolerant readers** and **expand and contract** keep most changes compatible, so most changes need no new version.
    - The version can go in the **URI path**, a **query parameter**, a **custom header** or the **media type**. The path is the most visible and the easiest to route; choose one strategy for all services.
    - Spring Framework 7 / Spring Boot 4 has built-in versioning: `ApiVersionConfigurer` or `spring.mvc.apiversion.*` to resolve the version, and `@GetMapping(version = "2.0+")` to map it. Older versions use `params`, `headers`, `produces` or separate paths.
    - Retire a version in stages: announce it with the **`Deprecation`** (RFC 9745) and **`Sunset`** (RFC 8594) headers and a `Link` to the migration guide, measure traffic per version, and remove it when the traffic is gone.
    - **Consumer-driven contract tests** (Pact, Spring Cloud Contract) catch breaking changes in CI.

---

[^1]: [Jacky](https://dev.to/jackynote), [Versioning RESTful APIs with Spring Boot: A Step-by-Step Guide in 5 minutes](https://dev.to/jackynote/versioning-restful-apis-with-spring-boot-a-step-by-step-guide-b3d).

[^2]: [Spring Framework: API Versioning](https://docs.spring.io/spring-framework/reference/web/webmvc-versioning.html){target="_blank"}, with the [MVC configuration](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-config/api-version.html){target="_blank"} and the [`version` attribute of request mappings](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-requestmapping.html#mvc-ann-requestmapping-version){target="_blank"}.

[^3]: [Spring Boot: API Versioning](https://docs.spring.io/spring-boot/reference/web/servlet.html#web.servlet.spring-mvc.api-versioning){target="_blank"}.

[^4]: [RFC 9745: The Deprecation HTTP Response Header Field](https://www.rfc-editor.org/rfc/rfc9745){target="_blank"}. IETF, 2025.

[^5]: [RFC 8594: The Sunset HTTP Header Field](https://www.rfc-editor.org/rfc/rfc8594){target="_blank"}. IETF, 2019.

[^6]: [Pact](https://docs.pact.io/){target="_blank"}; [Spring Cloud Contract](https://spring.io/projects/spring-cloud-contract){target="_blank"}.

[^7]: FOWLER, M., [Tolerant Reader](https://martinfowler.com/bliki/TolerantReader.html){target="_blank"}.

[^8]: SATO, D., [Parallel Change](https://martinfowler.com/bliki/ParallelChange.html){target="_blank"}.

[^9]: [Semantic Versioning 2.0.0](https://semver.org/){target="_blank"}.
