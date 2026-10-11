
Um colega está construindo o serviço de pedidos e precisa chamar o seu serviço de produtos. O que ele lê? O seu código-fonte está em outro repositório, uma página de wiki fica desatualizada depois da primeira refatoração, e uma coleção do Postman só mostra as requisições que alguém lembrou de salvar. O que ele precisa é do **próprio contrato**, escrito em um formato que pessoas e ferramentas entendem, e gerado a partir do código para que não possa divergir dele. É isso que o OpenAPI e o Swagger UI oferecem.

**OpenAPI** é uma especificação, independente de linguagem, para descrever APIs REST[^2]. Um documento OpenAPI é um arquivo YAML ou JSON que descreve cada endpoint: a URL, o método HTTP, os parâmetros, o corpo da requisição e todas as respostas possíveis. O **Swagger UI** é a ferramenta mais usada para renderizar esse documento como uma interface web interativa, na qual os usuários podem ler e executar chamadas à API diretamente no navegador[^3].

Juntos, OpenAPI + Swagger UI oferecem uma documentação viva, sempre sincronizada com o código.

!!! info "OpenAPI ou Swagger?"
    *Swagger* era o nome original da especificação. Em 2016 ela foi doada à OpenAPI Initiative (Linux Foundation) e renomeada para **OpenAPI Specification**. Hoje, "OpenAPI" nomeia o **formato** (versões 3.0, 3.1 e, desde 2025, 3.2), e "Swagger" nomeia uma família de **ferramentas** em torno dele: Swagger UI, Swagger Editor, Swagger Codegen.

---

## Por que documentar APIs?

| Sem documentação | Com OpenAPI |
|---|---|
| Os consumidores precisam ler o código-fonte | Os consumidores navegam pelo Swagger UI |
| Erros de integração descobertos em tempo de execução | O contrato é explícito e testável desde o início |
| A documentação fica dessincronizada | A documentação é gerada a partir do código |
| Coleções do Postman mantidas manualmente à parte | O Swagger UI substitui o Postman para exploração |

Como o documento é legível por máquina, ele também alimenta ferramentas: geradores de código de cliente, testes de contrato, servidores mock e gateways de API que importam rotas a partir dele.

---

## Anatomia de um documento OpenAPI

Antes de gerar um documento, ajuda ler um. Este é o endpoint `GET /products/{id}` do [exercício Product API](../../../exercises/product/index.md), descrito em OpenAPI 3.1:

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

| Seção | O que contém |
|---|---|
| `info` | Título, versão e descrição da API (a versão da **API**, não do OpenAPI) |
| `servers` | URLs base onde a API pode ser acessada |
| `paths` | Cada endpoint: método, parâmetros (`in: path`, `query`, `header`, `cookie`), corpo da requisição e respostas por código de status |
| `components.schemas` | Modelos de dados (os DTOs), referenciados com `$ref` para serem definidos uma única vez |
| `components.securitySchemes` | Como os clientes se autenticam (bearer token, API key, OAuth 2.0) |

Neste curso, você raramente vai escrever esse arquivo à mão: o springdoc o gera a partir do código Java. Conhecer a estrutura dele é o que permite ler e revisar o documento gerado.

---

## Code-first ou contract-first?

Há duas formas de manter o código e o documento juntos:

| | **Code-first** (este curso) | **Contract-first** |
|---|---|---|
| Fonte da verdade | Os controllers e DTOs em Java | O arquivo `openapi.yaml` |
| O documento é… | Gerado a partir do código na inicialização (springdoc) | Escrito primeiro, revisado pelos consumidores |
| O código é… | Escrito à mão | Interfaces e DTOs gerados (por exemplo, `openapi-generator-maven-plugin`) |
| Bom para | Times pequenos, iteração rápida, um consumidor principal | APIs públicas, muitos consumidores, trabalho em paralelo de front-end e back-end |
| Risco | A API "simplesmente acontece" — o design não é revisado antes de codificar | Etapa extra no build; o código gerado pode parecer rígido |

Code-first corresponde ao hands-on: o módulo `account` *é* o contrato, escrito em Java. Seja qual for a escolha, revise o documento gerado como um consumidor faria, antes do merge.

---

## Adicionando o Swagger UI a um projeto Spring Boot

A biblioteca **springdoc-openapi**[^1] gera um documento OpenAPI lendo os seus controllers e classes de modelo na inicialização e, em seguida, serve o Swagger UI automaticamente.

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

!!! warning "Use a versão do springdoc compatível com o Spring Boot"
    O springdoc **2.8.x** é para o Spring Boot **3.x**; o springdoc **3.0.x** é para o Spring Boot **4.x**, que o hands-on usa (4.0.3). Uma versão incompatível falha na inicialização com erros de classe não encontrada. Consulte a tabela de compatibilidade no site do springdoc antes de atualizar qualquer um dos dois. Para um serviço reativo (Spring WebFlux, como o gateway), o artefato é `springdoc-openapi-starter-webflux-ui`.

Depois de adicionar a dependência, inicie a aplicação e acesse:

- **Swagger UI:** `http://localhost:8080/swagger-ui.html` (redireciona para `/swagger-ui/index.html`)
- **OpenAPI JSON:** `http://localhost:8080/v3/api-docs`
- **OpenAPI YAML:** `http://localhost:8080/v3/api-docs.yaml`

Nenhuma configuração extra é necessária para o uso básico.

!!! tip "Onde abri-lo na nossa plataforma"
    No `compose.yaml` da plataforma, os serviços de negócio não publicam nenhuma porta no host — quem publica é o gateway (`8080:8080`) — e o gateway roteia caminhos como `/accounts/**`, e não `/swagger-ui/**` ou `/v3/api-docs`. Assim, o Swagger UI de um serviço fica acessível quando você roda o serviço sozinho (pela IDE, em `localhost`), ou se você publicar a porta dele no `compose.yaml` durante o desenvolvimento. Isso é uma vantagem: a documentação fica dentro da rede confiável.

---

## Anotando a sua API

O springdoc infere a maior parte das informações a partir do código — caminhos, métodos, tipos de parâmetros, campos dos DTOs —, mas as anotações permitem adicionar descrições, exemplos e as respostas que não são óbvias pela assinatura do método[^4].

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

Na organização do hands-on, os mapeamentos ficam em uma interface (`AccountController`) implementada por um `@RestController` (`AccountResource`); o springdoc reconhece os mapeamentos e as anotações declarados na interface, de modo que a documentação pode ficar junto do contrato.

### Corpo da requisição (Record)

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

As anotações de Bean Validation também são documentadas: o springdoc lista os campos com `@NotNull` / `@NotBlank` como `required` e transforma restrições como `@Size`, `@Min` e `@Max` em limites do schema — o documento mostra as regras que o código impõe.

### Corpo da resposta

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

## Metadados da API

Configure os endpoints do springdoc no `application.yml`, e os metadados globais (título, versão, contato) com um `@Bean`:

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

Para mostrar o botão **Authorize** no Swagger UI e permitir o envio de tokens JWT nas requisições:

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

Depois disso, o Swagger UI mostra um botão **Authorize**. Cole um JWT nele, e todas as requisições seguintes vão incluir `Authorization: Bearer <token>`.

!!! note "Na plataforma do curso"
    No [Hands-on 3](../../../hands-on/3/index.md), o **gateway** valida o JWT (lido de um cookie) e repassa a identidade de quem chama para os serviços no cabeçalho `id-account`. Portanto, um serviço de negócio não valida tokens por conta própria: quando você o testa diretamente no Swagger UI dele, preencha o campo do cabeçalho `id-account` que o springdoc gera a partir do parâmetro `@RequestHeader`. O esquema bearer acima é o que você precisa quando o próprio serviço valida `Authorization: Bearer`.

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

Ative o perfil com `SPRING_PROFILES_ACTIVE=prod` (uma variável de ambiente no `compose.yaml` ou no deployment do Kubernetes). Se a API for pública de propósito, publique o documento gerado em um site de documentação em vez de servi-lo a partir do serviço em execução.

!!! warning "Armadilhas comuns"
    - **Documentação que mente**: `@ApiResponse(responseCode = "404")` em um método cujo código, na verdade, retorna `500` para um produto inexistente. As anotações não são conferidas com o comportamento — teste os códigos de status.
    - **Entidades no documento**: se o controller retorna o modelo JPA, o documento (e a resposta) mostra campos internos. Documente DTOs.
    - **Sem exemplos**: um schema só com tipos (`string`, `number`) obriga os consumidores a adivinhar. Adicione `example` ao `@Schema`.
    - **Swagger UI ligado** em produção (veja acima).

---

## Pontos-chave

- Um documento OpenAPI é o **contrato legível por máquina**: `info`, `servers`, `paths`, `components` (schemas e esquemas de segurança).
- **Code-first** (springdoc, este curso) gera o documento a partir do código; **contract-first** escreve o YAML primeiro e gera o código.
- O springdoc serve `/v3/api-docs` e `/swagger-ui.html`; escolha a versão compatível com o Spring Boot (3.0.x para o Boot 4).
- `@Tag`, `@Operation`, `@ApiResponse` e `@Schema(description, example)` tornam o documento gerado útil para as pessoas.
- Mantenha o Swagger UI **desligado em produção** e teste se os códigos de status documentados são os reais.

## Conexões

- As convenções que estão sendo documentadas: [Design de APIs REST](../rest/index.md).
- Exercícios que pedem documentação Swagger: [Product API](../../../exercises/product/index.md), [Order API](../../../exercises/order/index.md).
- Tokens e o gateway: [Hands-on 3 — Segurança](../../../hands-on/3/index.md), [Segurança](../../security/index.md).

---

[^1]: [springdoc-openapi Documentation](https://springdoc.org/){:target="_blank"}
[^2]: [OpenAPI Specification 3.1](https://spec.openapis.org/oas/v3.1.0){:target="_blank"}
[^3]: [Swagger UI](https://swagger.io/tools/swagger-ui/){:target="_blank"}
[^4]: [Baeldung — Spring REST OpenAPI Documentation](https://www.baeldung.com/spring-rest-openapi-documentation){:target="_blank"}
