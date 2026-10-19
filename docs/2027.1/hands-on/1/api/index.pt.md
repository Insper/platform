O primeiro passo desenha o **contrato** do `catalog`: quais recursos ele expõe, quais requisições aceita e o que responde. Em uma entrevista, este é o passo 3 do framework (*API e modelo de dados*); em um time de verdade, é aquilo contra o que os outros times programam, então merece cuidado antes de existir qualquer SQL.

## 1. Crie o projeto

Crie a pasta `services/catalog` no seu repositório com a estrutura padrão do Maven:

``` { .bash .copy }
mkdir -p services/catalog/src/main/java/boxoffice/catalog
mkdir -p services/catalog/src/main/resources/db/migration
```

Depois acrescente o `pom.xml`:

``` { .xml title="services/catalog/pom.xml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/1/code/services/catalog/pom.xml"
```

| Dependência | Por quê |
|---|---|
| `spring-boot-starter-webmvc` | Spring MVC + Tomcat embutido: uma thread por requisição em andamento (você vai contá-las no lab 2) |
| `spring-boot-starter-validation` | anotações de Bean Validation em records e parâmetros |
| `spring-boot-starter-data-jpa` | JPA/Hibernate, repositórios, transações, o pool de conexões HikariCP |
| `spring-boot-starter-actuator` | `/actuator/health` (usado pelo Compose, pelo Nginx e pelo Kubernetes) e `/actuator/metrics` |
| `spring-boot-starter-flyway` + `flyway-database-postgresql` | migrations versionadas do schema (no Spring Boot 4 cada tecnologia tem o seu starter e módulo de auto-configuração; só o `flyway-core` não é mais detectado) |
| `postgresql` | driver JDBC |
| `springdoc-openapi-starter-webmvc-ui` (3.x) | gera o documento OpenAPI a partir dos controllers, mais o Swagger UI (o springdoc 3 é a linha do Spring Boot 4) |

!!! tip "Prefere um gerador?"

    O [start.spring.io](https://start.spring.io){target="_blank"} produz o mesmo esqueleto (Maven, Java 21, as dependências acima). Escolha o Spring Boot **4.1.x** e ajuste o group para `boxoffice`. Os labs foram escritos e testados com Spring Boot 4.1.1 e Spring Cloud 2025.1.3; uma versão de correção 4.1.x mais nova funciona do mesmo jeito.

O ponto de entrada é a linha de sempre:

``` { .java title="services/catalog/src/main/java/boxoffice/catalog/CatalogApplication.java" .copy }
--8<-- "docs/2027.1/hands-on/1/code/services/catalog/src/main/java/boxoffice/catalog/CatalogApplication.java"
```

## 2. Desenhe os recursos

Dois **recursos**, cada um um substantivo com uma URL de coleção e uma URL de item, todos sob o prefixo do serviço `/catalog` (veja as [convenções do lab 0](../../0/index.md#boxoffice-services-and-ports)):

``` mermaid
classDiagram
    class Venue {
        Long id
        String name
        String city
        int capacity
    }
    class Event {
        Long id
        String title
        Category category
        OffsetDateTime startsAt
        BigDecimal priceFrom
    }
    class Category {
        <<enumeration>>
        CONCERT
        SPORTS
        FESTIVAL
        THEATER
    }
    Event "*" --> "1" Venue : acontece em
    Event --> Category
```

| Decisão | Escolha | Por quê |
|---|---|---|
| Identificadores | `BIGINT` gerado pelo banco | simples, compacto, fácil de sortear no k6 (`1..200000`) |
| Coleções | **paginadas** (`page`, `size` ≤ 50) | um `GET /events` sem limite sobre 200.000 linhas seria uma queda autoinfligida |
| Listagem padrão | **próximos** eventos, os mais próximos primeiro | é o que a página inicial mostra; eventos passados não estão à venda |
| Dinheiro | `BigDecimal` / `NUMERIC(10,2)` | nunca `double` para preços |
| Tempo | `OffsetDateTime` / `TIMESTAMPTZ`, ISO-8601 no JSON | eventos acontecem em fusos horários diferentes |
| Erros | RFC 9457 `application/problem+json` | um formato de erro legível por máquina para todo serviço |
| Criação | `201 Created` + `Location: /catalog/events/{id}` | o cliente descobre onde o novo recurso vive |

## 3. Records de requisição e resposta

A API nunca devolve entidades JPA. **Records** são imutáveis, não têm anotações de persistência e deixam o formato do JSON explícito — quando a tabela muda, a API não muda por acidente.

=== "EventIn"

    ``` { .java title="services/catalog/src/main/java/boxoffice/catalog/EventIn.java" .copy }
    --8<-- "docs/2027.1/hands-on/1/code/services/catalog/src/main/java/boxoffice/catalog/EventIn.java"
    ```

=== "EventOut"

    ``` { .java title="services/catalog/src/main/java/boxoffice/catalog/EventOut.java" .copy }
    --8<-- "docs/2027.1/hands-on/1/code/services/catalog/src/main/java/boxoffice/catalog/EventOut.java"
    ```

=== "VenueIn"

    ``` { .java title="services/catalog/src/main/java/boxoffice/catalog/VenueIn.java" .copy }
    --8<-- "docs/2027.1/hands-on/1/code/services/catalog/src/main/java/boxoffice/catalog/VenueIn.java"
    ```

=== "VenueOut"

    ``` { .java title="services/catalog/src/main/java/boxoffice/catalog/VenueOut.java" .copy }
    --8<-- "docs/2027.1/hands-on/1/code/services/catalog/src/main/java/boxoffice/catalog/VenueOut.java"
    ```

=== "PageOut"

    ``` { .java title="services/catalog/src/main/java/boxoffice/catalog/PageOut.java" .copy }
    --8<-- "docs/2027.1/hands-on/1/code/services/catalog/src/main/java/boxoffice/catalog/PageOut.java"
    ```

=== "Category"

    ``` { .java title="services/catalog/src/main/java/boxoffice/catalog/Category.java" .copy }
    --8<-- "docs/2027.1/hands-on/1/code/services/catalog/src/main/java/boxoffice/catalog/Category.java"
    ```

Todos ficam em `src/main/java/boxoffice/catalog/`. As fábricas estáticas `EventOut.of(Event)` e `VenueOut.of(Venue)` são o único lugar em que uma entidade vira DTO.

## 4. Controllers

Controllers só traduzem HTTP em chamadas de método: validam a entrada, chamam o serviço e escolhem o código de status. Nada de SQL, nada de regra de negócio.

``` { .java title="services/catalog/src/main/java/boxoffice/catalog/EventController.java" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/1/code/services/catalog/src/main/java/boxoffice/catalog/EventController.java"
```

``` { .java title="services/catalog/src/main/java/boxoffice/catalog/VenueController.java" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/1/code/services/catalog/src/main/java/boxoffice/catalog/VenueController.java"
```

Como a validação funciona aqui:

- `@Valid @RequestBody EventIn in` verifica as anotações do record (`@NotBlank`, `@NotNull`, `@PositiveOrZero`) e responde **400** antes de o método rodar.
- `@Min(0)` / `@Max(50)` em `page` e `size` usam a **validação de métodos** embutida no Spring (Spring Framework 6.1+): `?size=5000` é rejeitado com **400** em vez de carregar 5.000 linhas.
- Com `spring.mvc.problemdetails.enabled: true` (próximo passo), os dois casos voltam como `application/problem+json`.

!!! example "O que um cliente vê"

    ``` { .http }
    GET /catalog/events?size=500 HTTP/1.1

    HTTP/1.1 400 Bad Request
    Content-Type: application/problem+json

    {"detail":"Validation failure","instance":"/catalog/events",
     "status":400,"title":"Bad Request"}
    ```

!!! tip "Na entrevista"

    Ao esboçar a API, diga três coisas em voz alta: os **recursos e verbos** (`GET /events?city=&page=`), a **estratégia de paginação** (offset agora; *keyset* — `WHERE starts_at > :last` — quando os usuários rolam fundo, porque `OFFSET 100000` ainda lê 100.000 linhas) e o **modelo de erros**. Entrevistadores prestam atenção em se você limita toda coleção.

!!! warning "Armadilhas"

    - **Devolver a entidade**: um `venue` lazy serializado fora de uma transação lança `LazyInitializationException` ou, pior, uma coluna nova vaza para os clientes (um hash de senha, um preço de custo).
    - **Listas sem limite**: todo endpoint de coleção precisa de um tamanho máximo de página.
    - **`200` para tudo**: códigos de status fazem parte do contrato; proxies, caches e checks do k6 dependem deles.

Os controllers dependem do `CatalogService`, que você escreve no próximo passo junto com as entidades e o banco: [2. Persistência](../persistence/index.md).
