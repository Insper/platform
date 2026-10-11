
O **OpenAPI** é uma especificação independente de linguagem para descrever APIs REST. Um documento OpenAPI é um arquivo YAML ou JSON que descreve cada endpoint: a URL, o método HTTP, os parâmetros, o corpo da requisição e todas as respostas possíveis. O **Swagger UI** é a ferramenta mais usada para renderizar esse documento como uma interface web interativa, na qual os usuários podem ler e executar chamadas à API diretamente no navegador.

Juntos, OpenAPI + Swagger UI oferecem uma documentação viva, sempre sincronizada com o código.

---

## Por que documentar APIs?

| Sem documentação | Com OpenAPI |
|---|---|
| Os consumidores precisam ler o código-fonte | Os consumidores navegam pelo Swagger UI |
| Erros de integração descobertos em tempo de execução | O contrato é explícito e testável de antemão |
| A documentação fica dessincronizada | A documentação é gerada a partir do código |
| Coleções do Postman mantidas manualmente à parte | O Swagger UI substitui o Postman na exploração |

---

## Adicionando o Swagger UI a um projeto Spring Boot

A biblioteca **springdoc-openapi** gera um documento OpenAPI lendo seus controllers e classes de modelo na inicialização e, em seguida, serve o Swagger UI automaticamente.

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

Depois de adicionar a dependência, inicie a aplicação e acesse:

- **Swagger UI:** `http://localhost:8080/swagger-ui.html`
- **OpenAPI JSON:** `http://localhost:8080/v3/api-docs`
- **OpenAPI YAML:** `http://localhost:8080/v3/api-docs.yaml`

Nenhuma configuração extra é necessária para o uso básico.

---

## Anotando sua API

O springdoc infere a maior parte das informações a partir do código, mas as anotações permitem acrescentar descrições, exemplos e a documentação das restrições.

### Controller e operação

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

### Corpo da requisição (Record)

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

### Corpo da resposta

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

## Metadados da API

Configure os metadados globais (título, versão, contato) no `application.yml` ou com um `@Bean`:

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

=== "Configuração em Java"

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

## Esquema de segurança

Para exibir o botão **Authorize** no Swagger UI e permitir o envio de tokens JWT nas requisições:

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

Depois de adicionar isso, o Swagger UI mostra um botão **Authorize**. Cole um JWT ali e todas as requisições seguintes incluirão `Authorization: Bearer <token>`.

---

## Desabilitando o Swagger em produção

Expor o Swagger UI em produção é um risco de segurança — ele documenta toda a sua superfície de ataque. Desabilite-o por ambiente:

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
