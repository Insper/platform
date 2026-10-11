
A teammate is building the order service and needs to call your product service. What do they read? Your source code is in another repository, a wiki page goes stale after the first refactoring, and a Postman collection only shows the requests someone remembered to save. What they need is the **contract itself**, written in a format both people and tools understand, and generated from the code so that it cannot drift. That is what OpenAPI and Swagger UI provide.

**OpenAPI** is a language-agnostic specification for describing REST APIs[^2]. An OpenAPI document is a YAML or JSON file that describes every endpoint: the URL, HTTP method, parameters, request body, and all possible responses. **Swagger UI** is the most widely used tool to render that document as an interactive web interface where users can read and execute API calls directly in the browser[^3].

Together, OpenAPI + Swagger UI give you living documentation that is always in sync with the code.

!!! info "OpenAPI or Swagger?"
    *Swagger* was the original name of the specification. In 2016 it was donated to the OpenAPI Initiative (Linux Foundation) and renamed the **OpenAPI Specification**. Today "OpenAPI" names the **format** (versions 3.0, 3.1 and, since 2025, 3.2), and "Swagger" names a family of **tools** around it: Swagger UI, Swagger Editor, Swagger Codegen.

---

## Why document APIs?

| Without documentation | With OpenAPI |
|---|---|
| Consumers must read the source code | Consumers browse the Swagger UI |
| Integration errors discovered at runtime | Contract is explicit and testable upfront |
| Documentation drifts out of sync | Documentation is generated from the code |
| Manual Postman collections maintained separately | Swagger UI replaces Postman for exploration |

Because the document is machine-readable, it also feeds tools: client code generators, contract tests, mock servers, and API gateways that import routes from it.

---

## Anatomy of an OpenAPI document

Before generating a document, it helps to read one. This is the `GET /products/{id}` endpoint of the [Product API exercise](../../../exercises/product/index.md), described in OpenAPI 3.1:

```yaml title="openapi.yaml (excerpt)"
openapi: 3.1.0
info:                              # (1) metadata
  title: Product Service API
  version: 1.0.0
servers:                           # (2) where the API runs
  - url: http://localhost:8080
paths:                             # (3) one entry per path, one key per method
  /products/{id}:
    get:
      tags: [Products]
      summary: Find a product by ID
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200":
          description: Product found
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ProductOut" }
        "404":
          description: Product not found
components:                        # (4) reusable pieces
  schemas:
    ProductOut:
      type: object
      properties:
        id:    { type: string, format: uuid }
        name:  { type: string, example: Tomato }
        price: { type: number, example: 10.12 }
        unit:  { type: string, example: kg }
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer, bearerFormat: JWT }
```

| Section | What it holds |
|---|---|
| `info` | Title, version and description of the API (the version of the **API**, not of OpenAPI) |
| `servers` | Base URLs where the API can be reached |
| `paths` | Every endpoint: method, parameters (`in: path`, `query`, `header`, `cookie`), request body and responses per status code |
| `components.schemas` | Data models (the DTOs), referenced with `$ref` so they are defined once |
| `components.securitySchemes` | How clients authenticate (bearer token, API key, OAuth 2.0) |

You will rarely write this file by hand in this course: springdoc generates it from the Java code. Knowing its structure is what lets you read and review the generated document.

---

## Code-first or contract-first?

There are two ways to keep the code and the document together:

| | **Code-first** (this course) | **Contract-first** |
|---|---|---|
| Source of truth | The Java controllers and DTOs | The `openapi.yaml` file |
| Document is… | Generated from the code at startup (springdoc) | Written first, reviewed by consumers |
| Code is… | Written by hand | Interfaces and DTOs generated (e.g. `openapi-generator-maven-plugin`) |
| Good for | Small teams, fast iteration, one main consumer | Public APIs, many consumers, parallel front-end and back-end work |
| Risk | The API "just happens" — design is not reviewed before coding | Extra build step; generated code can feel rigid |

Code-first matches the hands-on: the `account` module *is* the contract, written in Java. Whatever you choose, review the generated document as a consumer would, before merging.

---

## Adding Swagger UI to a Spring Boot project

The **springdoc-openapi** library[^1] generates an OpenAPI document by reading your controllers and model classes at startup, then serves Swagger UI automatically.

=== "Maven"

    ```xml
    <dependency>
        <groupId>org.springdoc</groupId>
        <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>
        <version>3.0.0</version>
    </dependency>
    ```

=== "Gradle"

    ```groovy
    implementation 'org.springdoc:springdoc-openapi-starter-webmvc-ui:3.0.0'
    ```

!!! warning "Match the springdoc version to Spring Boot"
    springdoc **2.8.x** targets Spring Boot **3.x**; springdoc **3.0.x** targets Spring Boot **4.x**, which the hands-on uses (4.0.3). A mismatched version fails at startup with class-not-found errors. Check the compatibility table on the springdoc site before upgrading either one. For a reactive service (Spring WebFlux, like the gateway) the artifact is `springdoc-openapi-starter-webflux-ui`.

After adding the dependency, start the application and navigate to:

- **Swagger UI:** `http://localhost:8080/swagger-ui.html` (redirects to `/swagger-ui/index.html`)
- **OpenAPI JSON:** `http://localhost:8080/v3/api-docs`
- **OpenAPI YAML:** `http://localhost:8080/v3/api-docs.yaml`

No extra configuration is required for basic use.

!!! tip "Where to open it in our platform"
    In the platform's `compose.yaml` the business services publish no port to the host — the gateway does (`8080:8080`) — and the gateway routes paths such as `/accounts/**` — not `/swagger-ui/**` or `/v3/api-docs`. So a service's Swagger UI is reachable while you run the service on its own (from the IDE, on `localhost`), or if you publish its port in `compose.yaml` during development. That is a feature: the documentation stays inside the trusted network.

---

## Annotating your API

springdoc infers most information from the code — paths, methods, parameter types, DTO fields — but annotations let you add descriptions, examples, and the responses that are not obvious from the method signature[^4].

### Controller and operation

```java
@RestController
@RequestMapping("/products")
@Tag(name = "Products", description = "Manage the product catalogue")
public class ProductController {

    @GetMapping("/{id}")
    @Operation(
        summary = "Find a product by ID",
        description = "Returns a single product. Returns 404 if the product does not exist."
    )
    @ApiResponse(responseCode = "200", description = "Product found")
    @ApiResponse(responseCode = "404", description = "Product not found")
    public ProductOut findById(@PathVariable String id) { ... }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Create a new product")
    @ApiResponse(responseCode = "201", description = "Product created",
        headers = @Header(name = "Location", description = "URI of the new product"))
    @ApiResponse(responseCode = "422", description = "Validation failed")
    public ProductOut create(@RequestBody @Valid ProductIn in) { ... }
}
```

In the hands-on layout the mappings live on an interface (`AccountController`) implemented by a `@RestController` (`AccountResource`); springdoc picks up mappings and annotations declared on the interface, so the documentation can sit next to the contract.

### Request body (Record)

```java
@Schema(description = "Payload for creating or updating a product")
public record ProductIn(

    @Schema(description = "Product name", example = "Tomato")
    @NotBlank String name,

    @Schema(description = "Unit price", example = "10.12")
    @Positive BigDecimal price,

    @Schema(description = "Unit of sale", example = "kg")
    @NotBlank String unit
) {}
```

Bean Validation annotations are documented too: springdoc lists `@NotNull` / `@NotBlank` fields as `required`, and turns constraints such as `@Size`, `@Min` and `@Max` into schema limits — the document shows the rules the code enforces.

### Response body

```java
@Schema(description = "Product as returned by the API")
public record ProductOut(

    @Schema(description = "Unique product identifier (UUID)",
            example = "0195abfb-7074-73a9-9d26-b4b9fbaab0a8")
    String id,

    @Schema(description = "Product name", example = "Tomato")
    String name,

    @Schema(description = "Unit price", example = "10.12")
    BigDecimal price,

    @Schema(description = "Unit of sale", example = "kg")
    String unit
) {}
```

---

## API metadata

Configure the springdoc endpoints in `application.yml`, and the global metadata (title, version, contact) with a `@Bean`:

=== "application.yml"

    ```yaml
    springdoc:
      api-docs:
        path: /v3/api-docs
      swagger-ui:
        path: /swagger-ui.html
        operationsSorter: method

    spring:
      application:
        name: product-service
    ```

=== "Java config"

    ```java
    @Configuration
    public class OpenApiConfig {

        @Bean
        public OpenAPI productServiceOpenAPI() {
            return new OpenAPI()
                .info(new Info()
                    .title("Product Service API")
                    .version("1.0.0")
                    .description("Manages the product catalogue for the platform")
                    .contact(new Contact()
                        .name("Platform Team")
                        .email("platform@example.com")));
        }
    }
    ```

---

## Security scheme

To show the **Authorize** button in Swagger UI and enable sending JWT tokens with requests:

```java
@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI openAPI() {
        return new OpenAPI()
            .addSecurityItem(new SecurityRequirement().addList("bearerAuth"))
            .components(new Components()
                .addSecuritySchemes("bearerAuth",
                    new SecurityScheme()
                        .name("bearerAuth")
                        .type(SecurityScheme.Type.HTTP)
                        .scheme("bearer")
                        .bearerFormat("JWT")));
    }
}
```

After adding this, Swagger UI shows an **Authorize** button. Paste a JWT there and all subsequent requests will include `Authorization: Bearer <token>`.

!!! note "In the course's platform"
    In [Hands-on 3](../../../hands-on/3/index.md) the **gateway** validates the JWT (read from a cookie) and forwards the caller's identity to the services in the `id-account` header. A business service therefore does not validate tokens itself: when you test it directly in its Swagger UI, fill the `id-account` header field that springdoc generates from the `@RequestHeader` parameter. The bearer scheme above is what you need when the service itself validates `Authorization: Bearer`.

---

## Disabling Swagger in production

Exposing Swagger UI in production is a security risk — it documents your entire attack surface. Disable it per environment:

```yaml title="application-prod.yml"
springdoc:
  api-docs:
    enabled: false
  swagger-ui:
    enabled: false
```

Activate the profile with `SPRING_PROFILES_ACTIVE=prod` (an environment variable in `compose.yaml` or in the Kubernetes deployment). If the API is public on purpose, publish the generated document on a documentation site instead of serving it from the running service.

!!! warning "Common pitfalls"
    - **Documentation that lies**: `@ApiResponse(responseCode = "404")` on a method whose code actually returns `500` for a missing product. Annotations are not checked against behaviour — test the status codes.
    - **Entities in the document**: if the controller returns the JPA model, the document (and the response) shows internal fields. Document DTOs.
    - **No examples**: a schema with only types (`string`, `number`) forces consumers to guess. Add `example` to `@Schema`.
    - **Swagger UI left on** in production (see above).

---

## Key takeaways

- An OpenAPI document is the **machine-readable contract**: `info`, `servers`, `paths`, `components` (schemas and security schemes).
- **Code-first** (springdoc, this course) generates the document from the code; **contract-first** writes the YAML first and generates code.
- springdoc serves `/v3/api-docs` and `/swagger-ui.html`; choose the version that matches Spring Boot (3.0.x for Boot 4).
- `@Tag`, `@Operation`, `@ApiResponse` and `@Schema(description, example)` make the generated document useful to people.
- Keep Swagger UI **off in production** and test that the documented status codes are the real ones.

## Connections

- The conventions being documented: [REST API Design](../rest/index.md).
- Exercises that ask for Swagger documentation: [Product API](../../../exercises/product/index.md), [Order API](../../../exercises/order/index.md).
- Tokens and the gateway: [Hands-on 3 — Security](../../../hands-on/3/index.md), [Security](../../security/index.md).

---

[^1]: [springdoc-openapi Documentation](https://springdoc.org/){:target="_blank"}
[^2]: [OpenAPI Specification 3.1](https://spec.openapis.org/oas/v3.1.0){:target="_blank"}
[^3]: [Swagger UI](https://swagger.io/tools/swagger-ui/){:target="_blank"}
[^4]: [Baeldung — Spring REST OpenAPI Documentation](https://www.baeldung.com/spring-rest-openapi-documentation){:target="_blank"}
