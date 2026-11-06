---
marp: true
lang: pt-BR
title: API
description: Plataformas, Microsserviços, DevOps e APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Plataformas, Microsserviços, DevOps e APIs · Insper</div>

# API

**Um contrato que deixa cada lado evoluir sozinho**

<!--
Objetivos: explicar por que um contrato estável deixa os times implantarem de forma independente; comparar REST,
gRPC, GraphQL, WebSocket e mensageria e escolher um; projetar um recurso REST (URIs, métodos, códigos de status,
erros, paginação); distinguir uma mudança incompatível de uma compatível e versionar quando preciso; documentar um
serviço Spring Boot com OpenAPI e Swagger UI e decidir onde a documentação pode ficar exposta.
Roteiro: (1) o contrato da API, estilos, Richardson; (2) design de APIs REST; (3) OpenAPI e Swagger.
-->

---

## Três clientes, um serviço de produtos

<div class="q">

O front-end web, o app mobile e o serviço de pedidos precisam dos dados de produtos. Como cada um sabe qual URL chamar, o que enviar e o que recebe de volta? E o que acontece com eles quando o time de produtos **reescrever** o serviço no próximo semestre?

</div>

* Uma **API** é um contrato: as **operações**, suas **entradas** e suas **saídas** — sem expor a implementação.
* Os clientes dependem do contrato e **não enxergam** a linguagem, o banco nem o framework por trás dele.
* Respeitado o contrato, a implementação pode ser **trocada por completo** sem afetar nenhum consumidor.

---

## Por que APIs importam

| Sem uma API estável | Com um contrato de API estável |
|---|---|
| toda mudança interna pode quebrar os consumidores | os consumidores ficam isolados das mudanças de implementação |
| os times coordenam cada deploy | os times fazem deploy de forma independente |
| erros de integração aparecem em tempo de execução | o contrato pode ser testado antes da integração |
| a documentação se desatualiza | o contrato é a fonte única da verdade |

<p class="small"><strong>Consumidor</strong> (cliente): o código que chama a API · <strong>Provedor</strong>: o serviço que a implementa · <strong>Endpoint</strong>: uma operação, método + caminho (<code>GET /accounts/{id}</code>) · <strong>DTO</strong>: uma classe que só carrega dados pela fronteira.</p>

---

## O contrato na nossa plataforma

| Módulo | Contém | Quem depende dele |
|---|---|---|
| `account` | o **contrato**: a interface `AccountController` (`POST /accounts`, `GET /accounts/{id}`…) e os DTOs `AccountIn` / `AccountOut` | a implementação **e** todo cliente — o auth chama as contas por ele, como cliente OpenFeign |
| `account-service` | a **implementação**: `AccountResource`, `AccountService`, `AccountModel` (JPA), o repositório | ninguém — é privado do time de contas |

<div class="ok">

O time de contas muda o banco, o modelo ou a lógica à vontade. Só uma mudança em `AccountController`, `AccountIn` ou `AccountOut` é visível para os outros — a mudança que precisa ser negociada e, se quebrar clientes, **versionada**.

</div>

---

## Tipos de APIs

| Estilo | Protocolo | Formato | Uso típico |
|---|---|---|---|
| **REST** | HTTP/1.1 ou HTTP/2 | JSON / XML | APIs web públicas e internas — a escolha dominante |
| **gRPC** | HTTP/2 | Protocol Buffers (binário) | chamadas internas de alto desempenho entre serviços |
| **GraphQL** | HTTP | JSON | consultas definidas pelo cliente; Backend for Frontend (BFF) |
| **WebSocket** | começa como `Upgrade` HTTP e vira full-duplex | qualquer | tempo real: chat, feeds ao vivo, colaboração |
| **Baseada em mensagens** | AMQP / protocolo do Kafka | JSON / Avro | integração assíncrona, orientada a eventos |

---

## "Me dê o produto 42", de três jeitos

<div class="cols3">
<div>

### REST

```http
GET /products/42 HTTP/1.1
Accept: application/json
```

A URL identifica o **recurso**; o método diz o que fazer. Qualquer cliente HTTP funciona.

</div>
<div>

### gRPC

```protobuf
service ProductService {
  rpc GetProduct (GetProductRequest)
    returns (Product);
}
```

Um contrato `.proto`, código **gerado**, binário compacto. O navegador não chama direto.

</div>
<div>

### GraphQL

```graphql
query {
  product(id: "42") { name price }
}
```

Um único endpoint (`POST /graphql`); o **cliente escolhe os campos**.

</div>
</div>

<div class="ok">

**Como escolher**: REST para a API pública da loja (ferramentas universais, `GET`s cacheáveis); gRPC para chamadas internas frequentes; GraphQL para um front-end que compõe vários serviços; mensageria quando o produtor não deve esperar.

</div>

---

## Quão REST? O modelo de Richardson

| Nível | Característica | Exemplo |
|---|---|---|
| **0 — Pântano de POX** | um endpoint para todas as operações | `POST /service?op=getOrder` |
| **1 — Recursos** | URIs separadas por recurso | `GET /orders/42` |
| **2 — Verbos HTTP** | GET, POST, PUT, DELETE + códigos de status | `DELETE /orders/42` → `204` |
| **3 — Hipermídia** | respostas com links para as próximas ações | `"links": [{"rel": "cancel", "href": "/orders/42/cancel"}]` |

- **POX** = Plain Old XML: o HTTP como túnel para chamadas de procedimento remoto. **HATEOAS** = Hypermedia As The Engine Of Application State: o cliente descobre os próximos passos pelos links.
- A maioria das APIs em produção fica no **nível 2** — o foco deste curso; o nível 3 é raro (os `links` com `rel` e `href` da PayPal).

---

## Armadilhas comuns ao projetar uma API

- **Vazar a implementação**: devolver a entidade JPA expõe colunas como o hash da senha e amarra o contrato ao esquema — use DTOs (o `AccountOut` não tem senha).
- **APIs "tagarelas"**: uma tela que precisa de dez chamadas fica lenta pela rede — projete os recursos em torno do que os consumidores precisam.
- **Mudanças incompatíveis silenciosas**: renomear um campo JSON passa nos testes do provedor e quebra todos os consumidores — trate o contrato como público.
- **RPC disfarçado de REST**: verbos na URL (`/createOrder`) põem a API no nível 0–1 de Richardson.

---

<div class="kicker">Design de APIs REST</div>

## REST: recursos e representações

Você precisa publicar a **Product API** da loja; o front-end web e o serviço de pedidos vão chamá-la sem ler seu código. O REST (Roy Fielding, 2000) — um **estilo** arquitetural, não um protocolo — dá respostas comuns sobre o HTTP.

- Um **recurso** é qualquer coisa com nome: um produto, todos os produtos, os pedidos de um usuário — identificado por uma **URI** (`/products/0195abfb-...`).
- Uma **representação** é um retrato do seu estado, em geral JSON. O cliente nunca toca a linha no Postgres: **Representational State Transfer**.
- O `Content-Type` diz o formato do corpo; o `Accept` diz o que o cliente quer de volta.

---

<!-- _class: tight -->

## Restrições do REST

| Restrição | Significado |
|---|---|
| **Cliente-Servidor** | o servidor não conhece a interface; o cliente não conhece o armazenamento |
| **Sem estado** (Stateless) | cada requisição leva tudo; nenhuma sessão entre requisições — o JWT vai em toda chamada |
| **Cacheável** | as respostas declaram se podem ir para cache |
| **Interface uniforme** | URIs + métodos padrão + mensagens autodescritivas (`Content-Type`, status) + links (HATEOAS) |
| **Sistema em camadas** | o cliente não distingue o servidor final de um gateway, cache ou load balancer |
| **Código sob demanda** *(opcional)* | o servidor pode enviar código executável (JavaScript) |

<div class="ok">

**Sem estado** + **sistema em camadas** tornam a escala horizontal possível: nenhuma réplica guarda sessão, então o load balancer do Hands-on 7 manda cada requisição para qualquer instância do gateway.

</div>

---

## Recursos são substantivos

<div class="cols">
<div>

| ✅ Bom | ❌ Ruim |
|---|---|
| `GET /orders` | `GET /getOrders` |
| `POST /orders` | `POST /createOrder` |
| `GET /orders/42` | `GET /order?id=42` |
| `DELETE /orders/42` | `POST /deleteOrder/42` |

</div>
<div>

- Substantivos no **plural**: `/orders`, `/products`
- **Minúsculas com hífens**: `/order-items`
- Aninhe para expressar posse: `/users/7/orders`, no máximo 2–3 níveis
- Filtros, ordenação, páginas → parâmetros de **query**

</div>
</div>

<div class="ok">

**Ações que não são CRUD** (cancelar um pedido): uma mudança de estado, `PATCH /orders/42` com `{"status": "CANCELLED"}`, ou um sub-recurso, `POST /orders/42/cancellation`. O verbo fica fora do caminho.

</div>

---

## Métodos HTTP

| Método | Idempotente | Seguro | Uso |
|---|---|---|---|
| `GET` | ✅ | ✅ | buscar um recurso ou coleção; não pode alterar o estado |
| `POST` | ❌ | ❌ | criar — o servidor atribui o ID |
| `PUT` | ✅ | ❌ | substituir por completo — o cliente envia a representação inteira |
| `PATCH` | ❌ | ❌ | atualização parcial (`{"op": "increment"}` muda a cada chamada) |
| `DELETE` | ✅ | ❌ | remover |

- **Seguro**: não altera o estado do servidor (`GET`, `HEAD`, `OPTIONS`) — caches e crawlers podem chamá-los à vontade.
- **Idempotente**: o mesmo **efeito no servidor** uma ou várias vezes. `DELETE /products/42` → `204` e depois `404`: continua idempotente — trate um `404` num `DELETE` repetido como sucesso.

---

## Repetindo um `POST`: chaves de idempotência

<div class="q">

`POST /orders` e a resposta nunca chega. O pedido foi criado? Repetir pode criar um **duplicado**; não repetir pode **perdê-lo**.

</div>

1. O cliente gera uma **`Idempotency-Key`** única (um UUID) por operação *lógica*.
2. O servidor cria o pedido 42 e guarda `k1 → 42`; o `201` se perde.
3. Timeout: o cliente repete com a **mesma chave**.
4. O servidor vê que `k1` já foi processada → `201 Created`, pedido 42, **sem duplicado**.

<p class="small">As chaves ficam guardadas com o resultado (uma tabela com restrição de unicidade ou o Redis com expiração) — o mecanismo da Stripe. Retries e backoff: Padrões de resiliência.</p>

---

<!-- _class: tight -->

## Códigos de status: use o certo

**4xx**: o cliente errou (não repita sem mudar) · **5xx**: o servidor falhou (repetir pode dar certo)

<div class="cols3">
<div>

### 2xx

- `200 OK`
- `201 Created` + `Location`
- `202 Accepted` (na fila, assíncrono)
- `204 No Content`

</div>
<div>

### 4xx

- `400` malformada, campos faltando
- `401` sem token, inválido ou expirado
- `403` token válido, sem permissão
- `404` não encontrado
- `409` conflito, duplicado
- `422` validação de negócio falhou
- `429` limite de taxa + `Retry-After`

</div>
<div>

### 5xx

- `500` não tratado — **sem stack traces**
- `502` resposta inválida atrás do gateway
- `503` fora do ar ou sobrecarregado
- `504` sem resposta atrás do gateway

</div>
</div>

<div class="warn">

`401` = "quem é você?"; `403` = "sei quem você é e a resposta é não". `502`/`504`: "o gateway está bem, o serviço atrás dele não".

</div>

<!--
Exercício Order API: 201 ao criar, 400 quando um item aponta para um produto inexistente, 404 (e não 403) para o
pedido de outra pessoa — não revela que o pedido existe.
-->

---

<!-- _class: tight -->

## Requisição e resposta

<div class="cols">
<div>

```http
POST /orders HTTP/1.1
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...

{
  "customerId": 7,
  "items": [
    { "productId": 101, "quantity": 2 }
  ]
}
```

</div>
<div>

```http
HTTP/1.1 201 Created
Content-Type: application/json
Location: /orders/42

{
  "id": 42,
  "customerId": 7,
  "status": "PENDING",
  "total": { "amount": 59.90, "currency": "BRL" },
  "createdAt": "2026-04-28T14:30:00Z"
}
```

</div>
</div>

<div class="ok">

Convenções para todos os serviços: campos em **camelCase**, datas em **ISO 8601** com fuso horário, dinheiro com **moeda** explícita, ids como strings opacas (o curso usa UUIDs).

</div>

---

<!-- _class: tight -->

## Erros com formato padrão: Problem Details

RFC 9457, media type `application/problem+json`:

<div class="cols">
<div>

```json
{
  "type": "https://store.example.com/problems/out-of-stock",
  "title": "Product out of stock",
  "status": 422,
  "detail": "Product 101 is out of stock",
  "instance": "/orders"
}
```

</div>
<div>

| Campo | Significado |
|---|---|
| `type` | URI do *tipo* de problema |
| `title` | resumo curto do tipo |
| `status` | o status HTTP, repetido |
| `detail` | *esta* ocorrência |
| `instance` | URI desta ocorrência |

</div>
</div>

- No Spring: `@RestControllerAdvice` + `@ExceptionHandler` devolvendo um `ProblemDetail`; `spring.mvc.problemdetails.enabled: true` para os erros do próprio framework (um `@Valid` que falhou).

<div class="warn">

**Nunca vaze detalhes internos**: um stack trace ou uma mensagem SQL contam a um atacante seu framework, versões e tabelas. Registre os detalhes com um trace id; devolva uma mensagem genérica.

</div>

---

## Paginação e filtragem

Nunca devolva coleções sem limite: `GET /orders?page=2&size=20&sort=createdAt,desc` · `GET /orders?status=PENDING`

| Padrão | Parâmetros | Observações |
|---|---|---|
| **Offset** | `?page=2&size=20` | `OFFSET 40 LIMIT 20` ainda lê 40 linhas; uma inserção faz um item aparecer duas vezes |
| **Cursor** | `?after=eyJpZCI6NDJ9` | `WHERE id > :last ORDER BY id LIMIT 20`: usa o índice, sem deslocamento de página |
| **Filtragem** | `?status=PENDING` | sempre no servidor, nunca no cliente |
| **Ordenação** | `?sort=name,asc&sort=createdAt,desc` | vários campos são permitidos |

<p class="small">O <code>Pageable</code> do Spring Data lê page, size e sort (as páginas começam em <strong>0</strong>: <code>page=2</code> é a terceira); o <code>PagedModel</code> devolve <code>content</code> + os metadados de <code>page</code> (size, number, totalElements, totalPages).</p>

---

## Quebra ou não quebra?

Um cliente existente, **sem mudanças**, deixaria de funcionar?

| Compatível (sem nova versão) | Incompatível (nova versão) |
|---|---|
| acrescentar um endpoint | remover ou renomear um endpoint |
| acrescentar um campo **opcional** na requisição | acrescentar um campo **obrigatório** na requisição |
| acrescentar um campo na resposta | remover ou renomear um campo da resposta |
| aceitar um novo valor de entrada | mudar o tipo ou o significado (`price` em centavos em vez de reais) |
| | mudar um código de status de que os clientes dependem |

<div class="ok">

Mudanças compatíveis contam com **leitores tolerantes**: os clientes ignoram campos desconhecidos (o padrão do Jackson — não desligue isso nos clientes).

</div>

---

## Versionamento

| Estratégia | Exemplo | Observações |
|---|---|---|
| **Caminho da URI** | `/v1/orders`, `/v2/orders` | a mais comum em microsserviços; fácil de testar no navegador |
| **Header** | `Accept: application/vnd.myapi.v2+json` | URIs mais limpas; mais difícil de testar à mão |
| **Parâmetro de query** | `/orders?version=2` | evite — versão não é filtro |

- Incrementos major (`v1` → `v2`) sinalizam mudanças incompatíveis; rode as duas lado a lado, anuncie uma data de descontinuação e remova a `v1` quando o tráfego dela acabar (header `Sunset`, RFC 8594).

<div class="warn">

**Armadilhas**: uma versão por mudança (os clientes não acompanham) · quebrar "só para um cliente interno" (raramente se conhece todo cliente) · o módulo `account` compartilhado: uma mudança no `AccountOut` reconstrói todos os serviços dependentes — trate-o como um contrato publicado.

</div>

---

<!-- _class: tight -->

## Referência rápida em Spring Boot

```java
@RestController
@RequestMapping("/products")
public class ProductResource {
    @GetMapping("/{id}")
    public ResponseEntity<ProductOut> findById(@PathVariable String id) {
        return ResponseEntity.ok(productService.findById(id));            // 200, or 404 via the advice
    }
    @PostMapping
    public ResponseEntity<ProductOut> create(@RequestBody @Valid ProductIn in) {
        ProductOut created = productService.create(in);
        return ResponseEntity
            .created(URI.create("/products/" + created.id()))             // 201 + Location
            .body(created);
    }
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable String id) {
        productService.delete(id);
        return ResponseEntity.noContent().build();                        // 204
    }
}
```

<p class="small"><code>@ResponseStatus(CREATED)</code> também devolve 201, mas não define o <code>Location</code>. O <code>@Valid</code> roda a Bean Validation (<code>@NotBlank</code>, <code>@Positive</code>) → <code>400</code>.</p>

---

<div class="kicker">OpenAPI e Swagger</div>

## O contrato, por escrito

Um colega que constrói o serviço de pedidos precisa chamar seu serviço de produtos. Seu código está em outro repositório, uma wiki fica desatualizada, uma coleção do Postman mostra só o que alguém salvou. Ele precisa do **próprio contrato**, legível por pessoas e ferramentas, gerado a partir do código.

- **OpenAPI**: uma descrição em YAML/JSON, independente de linguagem, de cada endpoint — URL, método, parâmetros, corpo, respostas.
- **Swagger UI**: a mostra como uma página interativa onde você lê e **executa** as chamadas.
- *Swagger* era o nome original da especificação, doada à OpenAPI Initiative em 2016. Hoje OpenAPI é o **formato** (3.0, 3.1 e 3.2, desde 2025) e Swagger são as **ferramentas** (UI, Editor, Codegen).

<p class="small">Por ser legível por máquina, também alimenta geradores de clientes, testes de contrato, servidores mock e gateways que importam rotas.</p>

---

<!-- _class: tight -->

## Anatomia de um documento OpenAPI

O `GET /products/{id}` do exercício Product API, em OpenAPI 3.1:

```yaml
openapi: 3.1.0
info: { title: Product Service API, version: 1.0.0 }
servers:
  - url: http://localhost:8080
paths:
  /products/{id}:
    get:
      summary: Find a product by ID
      parameters:
        - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
      responses:
        "200":
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ProductOut" }
        "404": { description: Product not found }
components:
  schemas: { ProductOut: { type: object } }
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer, bearerFormat: JWT }
```

---

## As seções do documento

| Seção | O que guarda |
|---|---|
| `info` | título, versão e descrição da **API** (não do OpenAPI) |
| `servers` | URLs base onde a API pode ser alcançada |
| `paths` | cada endpoint: método, parâmetros (`in: path`, `query`, `header`, `cookie`), corpo da requisição, respostas por código de status |
| `components.schemas` | modelos de dados (os DTOs), referenciados com `$ref` para serem definidos uma vez |
| `components.securitySchemes` | como os clientes se autenticam (bearer token, API key, OAuth 2.0) |

<div class="ok">

Você raramente vai escrever este arquivo à mão neste curso — o springdoc o gera a partir do código Java —, mas conhecer a estrutura é o que permite **ler e revisar** o documento gerado.

</div>

---

## Code-first ou contract-first?

| | **Code-first** (este curso) | **Contract-first** |
|---|---|---|
| Fonte da verdade | os controllers e DTOs em Java | o `openapi.yaml` |
| Documento | gerado na inicialização (springdoc) | escrito antes, revisado pelos consumidores |
| Código | escrito à mão | gerado (`openapi-generator-maven-plugin`) |
| Bom para | times pequenos, iteração rápida | APIs públicas, muitos consumidores, front-end em paralelo |
| Risco | a API "simplesmente acontece", sem revisão do design | um passo a mais no build, código gerado rígido |

<div class="ok">

O code-first combina com o hands-on: o módulo `account` *é* o contrato, em Java. Em qualquer caso, revise o documento gerado como um consumidor faria antes do merge.

</div>

---

## springdoc num serviço Spring Boot

- Dependência `org.springdoc:springdoc-openapi-starter-webmvc-ui` — **3.0.x para o Spring Boot 4** (o hands-on usa a 4.0.3), 2.8.x para o Boot 3; uma combinação errada falha na inicialização. WebFlux (o gateway): `springdoc-openapi-starter-webflux-ui`.
- Depois: `/swagger-ui.html` (interativo) · `/v3/api-docs` (JSON) · `/v3/api-docs.yaml`.

<div class="q">

**Onde abri-lo na nossa plataforma**: só o gateway publica uma porta (`8080:8080`) e ele roteia `/accounts/**`, não `/swagger-ui/**`. Abra o Swagger UI de um serviço rodando-o sozinho (IDE, `localhost`) ou publicando a porta dele durante o desenvolvimento — a documentação fica dentro da rede confiável.

</div>

---

<!-- _class: tight -->

## Anotando a API

```java
@Tag(name = "Products", description = "Manage the product catalogue")
public class ProductController {
    @GetMapping("/{id}")
    @Operation(summary = "Find a product by ID")
    @ApiResponse(responseCode = "200", description = "Product found")
    @ApiResponse(responseCode = "404", description = "Product not found")
    public ProductOut findById(@PathVariable String id) { ... }
}

public record ProductIn(
    @Schema(description = "Product name", example = "Tomato") @NotBlank String name,
    @Schema(description = "Unit price", example = "10.12") @Positive BigDecimal price,
    @Schema(description = "Unit of sale", example = "kg") @NotBlank String unit) {}
```

- O springdoc infere caminhos, métodos, tipos e campos dos DTOs; as anotações acrescentam descrições, exemplos e respostas que não são óbvias.
- Mapeamentos e anotações na interface (`AccountController`) são lidos: a documentação fica ao lado do contrato.
- A Bean Validation é documentada: `@NotBlank` → `required`; `@Size`, `@Min`, `@Max` → limites no schema.

---

## Metadados e esquema de segurança

- Caminhos no `application.yml` (`springdoc.api-docs.path`, `springdoc.swagger-ui.path`); título, versão e contato num **`@Bean`** `OpenAPI`.
- Um esquema de segurança `bearerAuth` (`HTTP`, `bearer`, `JWT`) no mesmo bean → um botão **Authorize**: cole um JWT e toda chamada envia `Authorization: Bearer <token>`.

<div class="ok">

**Na nossa plataforma**, o gateway valida o JWT (de um cookie) e repassa o `id-account`. Para testar um serviço de negócio diretamente, preencha o campo do header `id-account` que o springdoc gera a partir do parâmetro `@RequestHeader`; o esquema bearer serve para serviços que validam tokens eles mesmos.

</div>

---

## Swagger desligado em produção

```yaml
# application-prod.yml
springdoc:
  api-docs:
    enabled: false
  swagger-ui:
    enabled: false
```

Ative com `SPRING_PROFILES_ACTIVE=prod` (no `compose.yaml` ou no deployment do Kubernetes). A API é pública de propósito? Publique o documento gerado num site de documentação.

<div class="warn">

- O Swagger UI em produção **documenta toda a sua superfície de ataque**.
- **Documentação que mente**: `@ApiResponse(responseCode = "404")` num método que devolve `500` — teste os códigos de status.
- **Entidades no documento**: documente DTOs. **Sem exemplos**: acrescente `example` ao `@Schema`.

</div>

---

## Pontos-chave

1. Uma API é um **contrato**: os consumidores dependem dele, nunca da implementação (`account` vs. `account-service`); nunca exponha entidades — mudar um DTO é mudar o contrato.
2. REST sobre HTTP é o padrão; gRPC, GraphQL, WebSocket e mensageria resolvem necessidades específicas. A maioria das APIs fica no **nível 2** de Richardson.
3. URIs nomeiam **recursos**; `GET` é seguro; `GET`, `PUT` e `DELETE` são idempotentes; torne o `POST` seguro para repetir com uma **chave de idempotência**.
4. Devolva o **código de status** preciso e os erros como **Problem Details**; pagine toda coleção (cursores para tabelas grandes).
5. Acrescente, não remova: mudanças compatíveis dispensam versão; as incompatíveis exigem **`/v2/`** e um período de descontinuação.
6. O **OpenAPI** é o contrato legível por máquina; o springdoc o gera (code-first); mantenha o Swagger UI **desligado em produção** e teste os códigos de status documentados.
