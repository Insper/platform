# Versionamento de APIs REST

Um microsserviço é implantado no seu próprio ritmo, mas os consumidores dele não: um app móvel que os usuários nunca atualizam, um parceiro que integrou uma vez, o serviço de outro time, com os seus próprios prazos. Quando a API precisa mudar de um jeito que os quebraria, o provedor precisa de uma forma de oferecer o contrato novo **ao lado** do antigo, e de uma forma de aposentar o antigo com ordem. Isso é versionamento de API.

Esta página responde:

- Quando uma mudança precisa de uma nova versão, e quando não precisa?
- Onde vai a versão: no caminho, num parâmetro de query, num header ou no media type?
- Como implementar no Spring, com o suporte nativo do Spring Boot 4 e do jeito clássico?
- Como depreciar e aposentar a versão antiga sem surpreender ninguém?

Ela complementa a seção [Evoluindo um contrato](../2027.1/classes/compute/api-styles/index.md#evolving-a-contract) da aula de 2027.1 sobre estilos de API. O GraphQL segue outro caminho, com um único schema que evolui por `@deprecated`: veja [REST vs GraphQL](rest-vs-graphql.md#versioning).

---

## Quando você precisa de uma nova versão? { #breaking-changes }

Só para **mudanças incompatíveis** (breaking changes): aquelas depois das quais um consumidor existente, sem alteração, para de funcionar. Todo o resto é uma mudança compatível e sai na versão atual.

| Mudança | Incompatível? | Por quê |
|---|---|---|
| adicionar um endpoint novo | não | ninguém o chama ainda |
| adicionar um campo numa resposta | não, para leitores tolerantes | os clientes ignoram campos que não conhecem |
| adicionar um campo de requisição ou parâmetro de query **opcional** | não | as requisições antigas continuam válidas |
| remover ou renomear um campo da resposta | **sim** | quem o lia recebe `null` ou falha |
| mudar o tipo, o formato ou a unidade de um campo (`price: 10.5` → `"10.50"`, reais → centavos) | **sim** | o valor é lido ou interpretado errado |
| tornar um campo da requisição **obrigatório**, ou endurecer a validação | **sim** | requisições antigas passam a receber `400` |
| devolver um valor novo de enum | muitas vezes | um cliente com um `switch` sobre os valores conhecidos quebra |
| mudar um código de status (`200` → `202`) ou o formato de erro | **sim** | a lógica do cliente depende deles |
| mudar a ordenação padrão ou o tamanho de página | sutilmente | clientes que dependiam disso mostram dados errados |
| remover um endpoint | **sim** | as chamadas recebem `404` |

Dois hábitos tornam a maioria das mudanças compatível e evitam a maioria das versões novas:

- **Leitor tolerante** (tolerant reader)[^7]: o consumidor lê só os campos de que precisa e ignora o resto. O mapeador JSON do Spring Boot ignora propriedades desconhecidas por padrão (o Jackson 3, usado pelo Spring Boot 4, tornou isso o padrão da biblioteca), então mantenha assim.
- **Expandir e contrair** (parallel change)[^8]: em vez de renomear `price`, adicione `priceCents` ao lado, migre os consumidores e só remova `price` quando ninguém mais o ler. Um campo também faz parte do contrato, e pode ser depreciado sozinho.

Quando uma mudança incompatível é inevitável, aumente a versão **major** (versionamento semântico[^9]: `MAJOR.MINOR.PATCH`). Mudanças compatíveis não precisam de uma versão que o cliente tenha de pedir.

---

## Quatro formas de levar a versão { #strategies }

| Estratégia | Requisição | Vantagens | Desvantagens |
|---|---|---|---|
| **Caminho da URI** | `GET /api/v2/orders/7` | visível em links, logs e no navegador; fácil de rotear no gateway ou no ingress; cacheável pela URL | o "mesmo" recurso ganha duas URLs; costuma versionar a API inteira de uma vez |
| **Parâmetro de query** | `GET /api/orders/7?version=2` | fácil de adicionar; pode ser opcional, com um padrão | fácil de esquecer; mistura-se com filtros; os caches precisam considerar a query string |
| **Header próprio** | `GET /api/orders/7` + `API-Version: 2` | URLs limpas e estáveis; pode ser definido uma vez no cliente | invisível nos links; caches e CDNs precisam de `Vary: API-Version`; mais difícil de testar à mão |
| **Media type** | `Accept: application/vnd.example+json;version=2` | versiona a *representação* por negociação de conteúdo, o mais fiel ao REST | o mais difícil de documentar, testar e rotear; os caches precisam de `Vary: Accept` |

Não existe um padrão. O **caminho da URI** é a escolha mais comum em APIs públicas, porque é o mais fácil de ver, rotear e depurar. Um header é comum em APIs internas cujos clientes são todos código. Seja qual for a escolha, use **uma única** estratégia em todos os seus serviços e documente-a na descrição OpenAPI.

---

## Versionamento no Spring { #spring }

### Spring Framework 7 e Spring Boot 4: suporte nativo { #spring-7 }

O Spring Framework 7.0 (novembro de 2025) e o Spring Boot 4.0 trouxeram versionamento de API nativo para o Spring MVC[^2]. Ele tem três partes:

1. **Resolver** a versão de cada requisição, com uma das quatro estratégias.
2. **Interpretar e validar** a versão. O parser padrão lê `MAJOR.MINOR.PATCH` e pula um `v` inicial, então `v2` é o mesmo que `2.0.0`. Uma versão que não é suportada recebe `400 Bad Request`.
3. **Mapear** a requisição para um método de controller com o novo atributo `version` de `@RequestMapping` (e de `@GetMapping`, `@PostMapping`…).

A configuração mais simples usa propriedades do Spring Boot[^3]:

```yaml title="application.yaml"
spring:
  mvc:
    apiversion:
      use:
        header: API-Version
      default: "1.0"
      supported: ["1.0", "2.0"]
```

O mesmo em Java, com `ApiVersionConfigurer`:

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

Por padrão, uma requisição sem versão recebe `400`. Configurar uma versão padrão torna a versão opcional: as requisições que não enviam nenhuma recebem a padrão.

Só os métodos que mudaram precisam de versão. Um mapeamento sem `version` atende a qualquer versão, mas qualquer método versionado que também atenda tem prioridade sobre ele. Uma versão **de base** (baseline) como `"2.0+"` atende à 2.0 e a toda versão suportada acima dela, então o método segue valendo na 2.1, na 2.2… até que um mais novo o substitua:

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

As outras estratégias só trocam o resolver:

| Estratégia | `ApiVersionConfigurer` | Propriedade do Spring Boot |
|---|---|---|
| caminho da URI | `usePathSegment(1)`: o índice do segmento em `/api/{version}/orders`, que os mapeamentos precisam declarar como variável de URI | `spring.mvc.apiversion.use.path-segment=1` |
| parâmetro de query | `useQueryParam("version")` | `spring.mvc.apiversion.use.query-parameter=version` |
| header | `useRequestHeader("API-Version")` | `spring.mvc.apiversion.use.header=API-Version` |
| media type | `useMediaTypeParameter(MediaType.parseMediaType("application/vnd.example+json"), "version")` | `spring.mvc.apiversion.use.media-type-parameter` (um mapa de media type para nome de parâmetro) |

Os clientes ganham o mesmo suporte. Um serviço que chama outro define a versão uma vez no seu `RestClient` (também no `WebClient` e nos clientes de interface HTTP):

```java
RestClient orders = RestClient.builder()
    .baseUrl("http://order:8080")
    .apiVersionInserter(ApiVersionInserter.useHeader("API-Version"))
    .defaultApiVersion("2.0")
    .build();
```

### Versões anteriores: mapeamentos comuns { #spring-classic }

Antes do Spring Framework 7 (Spring Boot 3.x e anteriores), não existe o atributo `version`. Cada estratégia é escrita com os atributos que o `@RequestMapping` sempre teve[^1]:

=== "Caminho da URI"

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

=== "Parâmetro de query"

    ```java
    @GetMapping(path = "/orders/{id}", params = "version=1")
    public OrderV1 getV1(@PathVariable Long id) { ... }

    @GetMapping(path = "/orders/{id}", params = "version=2")
    public OrderV2 getV2(@PathVariable Long id) { ... }
    ```

=== "Header próprio"

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

Funciona, mas você mesmo precisa tratar uma versão ausente ou desconhecida (dependendo da estratégia, termina num `400`, `404` ou `406`), e todo método versionado repete a condição. Nos dois estilos, mantenha a regra de negócio num único service e deixe só os controllers e os DTOs mudarem por versão.

Numa arquitetura de microsserviços, a versão também pode escolher um **deployment**: o gateway ou o ingress do Kubernetes manda `/api/v1/**` para os pods da release antiga e `/api/v2/**` para a nova. Cada versão então escala, e um dia é desligada, de forma independente.

---

## Depreciação e sunset { #deprecation-sunset }

Uma versão é aposentada em etapas, e o cliente deveria ficar sabendo de cada etapa **pela própria API**, não só por e-mail. Dois headers de resposta padronizados levam essa informação:

- **`Deprecation`** (RFC 9745, março de 2025)[^4]: este recurso está (ou estará) depreciado a partir desta data. Ele ainda funciona, mas você deveria migrar. O valor é uma data de structured field: `@` seguido dos segundos Unix. Rascunhos anteriores usavam `Deprecation: true`, e você ainda pode encontrá-lo.
- **`Sunset`** (RFC 8594, maio de 2019)[^5]: a partir desta data, espera-se que o recurso pare de responder. O valor é uma data HTTP. A RFC 9745 exige que o sunset não seja anterior à depreciação.
- Headers **`Link`** com `rel="deprecation"` e `rel="sunset"` apontam para a documentação para humanos: o guia de migração, a política de aposentadoria.

```http
HTTP/1.1 200 OK
Content-Type: application/json
Deprecation: @1795996800
Sunset: Mon, 31 May 2027 00:00:00 GMT
Link: <https://api.example.com/docs/migrate-to-v2>; rel="deprecation"; type="text/html"
```

Aqui `@1795996800` é 30 de novembro de 2026, 00:00 UTC. O ciclo de vida da v1, passo a passo:

``` diagram-sim
sequenceDiagram
    participant C as Cliente
    participant G as API gateway
    participant V1 as orders v1
    participant V2 as orders v2
    Note over V1: 1. v1 no ar
    C->>G: GET /api/v1/orders/7
    G->>V1: rota /api/v1/**
    V1-->>C: 200 OK
    Note over V2: 2. v2 lançada, v1 ainda atendida
    Note over V1: 3. v1 depreciada
    C->>G: GET /api/v1/orders/7
    G->>V1: rota /api/v1/**
    V1-->>C: 200 OK + headers Deprecation, Sunset e Link
    C->>G: GET /api/v2/orders/7 (o cliente migra)
    G->>V2: rota /api/v2/**
    V2-->>C: 200 OK
    Note over V1: 4. data do sunset: o tráfego da v1 deve estar perto de zero
    Note over G: 5. v1 removida
    C->>G: GET /api/v1/orders/7 (um cliente esquecido)
    G-->>C: 410 Gone + Link para o guia de migração
```

- **Meça antes de remover.** Conte as requisições por versão e por cliente, por exemplo com um rótulo `version` nas métricas de requisição. Remova a v1 quando o tráfego dela chegar a zero, ou quando os clientes restantes tiverem sido avisados pessoalmente, e não só porque o calendário mandou.
- **Responda com um erro claro depois da remoção.** `410 Gone` com um link para o guia de migração explica mais que um `404` seco. A RFC 8594 não define um código: depois do sunset, vale de um erro a um redirecionamento.
- **Publique uma política**, por exemplo "uma versão major é suportada por pelo menos 6 meses depois que a sucessora sai", para que os consumidores possam se planejar.

No Spring Framework 7, o `StandardApiVersionDeprecationHandler` escreve esses headers em toda requisição a uma versão depreciada[^2]:

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

Em versões anteriores, defina os mesmos headers você mesmo, nos controllers depreciados ou uma vez num filtro para todo o `/api/v1/**`:

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

## Pegando quebras antes da produção: testes de contrato { #contract-tests }

Como saber que uma mudança é compatível *antes* de implantá-la? Com **contratos orientados ao consumidor** (consumer-driven contracts), cada consumidor publica as interações de que depende, por exemplo "`order` chama `GET /api/v1/products/{id}` e lê `name` e `price`". O CI do provedor executa todos os contratos publicados contra o novo build e falha se algum quebrar. Uma mudança proibida aparece então como um build vermelho, e não como um incidente em produção, e os contratos ainda dizem exatamente quais consumidores ainda usam a v1. As ferramentas comuns são **Pact** e **Spring Cloud Contract**[^6].

---

## Pontos-chave { #key-takeaways }

!!! takeaways ""
    - Crie uma nova versão só para **mudanças incompatíveis**: remover ou renomear campos, mudar tipos ou significado, novas entradas obrigatórias, códigos de status diferentes. Mudanças aditivas saem na versão atual.
    - **Leitores tolerantes** e **expandir e contrair** mantêm a maioria das mudanças compatível, então a maioria delas não precisa de versão nova.
    - A versão pode ir no **caminho da URI**, num **parâmetro de query**, num **header próprio** ou no **media type**. O caminho é o mais visível e o mais fácil de rotear; escolha uma estratégia para todos os serviços.
    - O Spring Framework 7 / Spring Boot 4 tem versionamento nativo: `ApiVersionConfigurer` ou `spring.mvc.apiversion.*` para resolver a versão, e `@GetMapping(version = "2.0+")` para mapeá-la. Versões anteriores usam `params`, `headers`, `produces` ou caminhos separados.
    - Aposente uma versão em etapas: anuncie com os headers **`Deprecation`** (RFC 9745) e **`Sunset`** (RFC 8594) e um `Link` para o guia de migração, meça o tráfego por versão e remova quando o tráfego acabar.
    - **Testes de contrato orientados ao consumidor** (Pact, Spring Cloud Contract) pegam mudanças incompatíveis no CI.

---

[^1]: [Jacky](https://dev.to/jackynote), [Versioning RESTful APIs with Spring Boot: A Step-by-Step Guide in 5 minutes](https://dev.to/jackynote/versioning-restful-apis-with-spring-boot-a-step-by-step-guide-b3d).

[^2]: [Spring Framework: API Versioning](https://docs.spring.io/spring-framework/reference/web/webmvc-versioning.html){target="_blank"}, com a [configuração do MVC](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-config/api-version.html){target="_blank"} e o [atributo `version` dos mapeamentos](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-requestmapping.html#mvc-ann-requestmapping-version){target="_blank"}.

[^3]: [Spring Boot: API Versioning](https://docs.spring.io/spring-boot/reference/web/servlet.html#web.servlet.spring-mvc.api-versioning){target="_blank"}.

[^4]: [RFC 9745: The Deprecation HTTP Response Header Field](https://www.rfc-editor.org/rfc/rfc9745){target="_blank"}. IETF, 2025.

[^5]: [RFC 8594: The Sunset HTTP Header Field](https://www.rfc-editor.org/rfc/rfc8594){target="_blank"}. IETF, 2019.

[^6]: [Pact](https://docs.pact.io/){target="_blank"}; [Spring Cloud Contract](https://spring.io/projects/spring-cloud-contract){target="_blank"}.

[^7]: FOWLER, M., [Tolerant Reader](https://martinfowler.com/bliki/TolerantReader.html){target="_blank"}.

[^8]: SATO, D., [Parallel Change](https://martinfowler.com/bliki/ParallelChange.html){target="_blank"}.

[^9]: [Semantic Versioning 2.0.0](https://semver.org/){target="_blank"}.
