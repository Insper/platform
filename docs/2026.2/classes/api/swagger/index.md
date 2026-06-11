
**OpenAPI** is a language-agnostic specification for describing REST APIs. An OpenAPI document is a YAML or JSON file that describes every endpoint: the URL, HTTP method, parameters, request body, and all possible responses. **Swagger UI** is the most widely used tool to render that document as an interactive web interface where users can read and execute API calls directly in the browser.

Together, OpenAPI + Swagger UI give you living documentation that is always in sync with the code.

---

## Why document APIs?

| Without documentation | With OpenAPI |
|---|---|
| Consumers must read the source code | Consumers browse the Swagger UI |
| Integration errors discovered at runtime | Contract is explicit and testable upfront |
| Documentation drifts out of sync | Documentation is generated from the code |
| Manual Postman collections maintained separately | Swagger UI replaces Postman for exploration |

---

## Adding Swagger UI to a Spring Boot project

The **springdoc-openapi** library generates an OpenAPI document by reading your controllers and model classes at startup, then serves Swagger UI automatically.

=== "Maven"

    ```xml
    <dependency>
        <groupId>org.springdoc</groupId>
        <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>
        <version>2.8.8</version>
    </dependency>
    ```

=== "Gradle"

    ```groovy
    implementation 'org.springdoc:springdoc-openapi-starter-webmvc-ui:2.8.8'
    ```

After adding the dependency, start the application and navigate to:

- **Swagger UI:** `http://localhost:8080/swagger-ui.html`
- **OpenAPI JSON:** `http://localhost:8080/v3/api-docs`
- **OpenAPI YAML:** `http://localhost:8080/v3/api-docs.yaml`

No extra configuration is required for basic use.

---

## Annotating your API

springdoc infers most information from the code, but annotations let you add descriptions, examples, and constraint documentation.

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
    public ProductOut findById(@PathVariable Long id) { ... }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Create a new product")
    @ApiResponse(responseCode = "201", description = "Product created",
        headers = @Header(name = "Location", description = "URI of the new product"))
    @ApiResponse(responseCode = "422", description = "Validation failed")
    public ProductOut create(@RequestBody @Valid ProductIn in) { ... }
}
```

### Request body (Record)

```java
@Schema(description = "Payload for creating or updating a product")
public record ProductIn(

    @Schema(description = "Product name", example = "Wireless Keyboard")
    @NotBlank String name,

    @Schema(description = "Price in BRL", example = "299.90")
    @Positive BigDecimal price,

    @Schema(description = "Available stock quantity", example = "100")
    @Min(0) Integer stock
) {}
```

### Response body

```java
@Schema(description = "Product as returned by the API")
public record ProductOut(

    @Schema(description = "Unique product identifier", example = "42")
    Long id,

    @Schema(description = "Product name", example = "Wireless Keyboard")
    String name,

    @Schema(description = "Price in BRL", example = "299.90")
    BigDecimal price,

    @Schema(description = "Available stock quantity", example = "100")
    Integer stock
) {}
```

---

## API metadata

Configure global metadata (title, version, contact) in `application.yml` or with a `@Bean`:

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

    info:
      title: Product Service API
      version: 1.0.0
      description: Manages the product catalogue for the platform
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

---

[^1]: [springdoc-openapi Documentation](https://springdoc.org/){:target="_blank"}
[^2]: [OpenAPI Specification 3.1](https://spec.openapis.org/oas/v3.1.0){:target="_blank"}
[^3]: [Swagger UI](https://swagger.io/tools/swagger-ui/){:target="_blank"}
[^4]: [Baeldung — Spring REST OpenAPI Documentation](https://www.baeldung.com/spring-rest-openapi-documentation){:target="_blank"}
