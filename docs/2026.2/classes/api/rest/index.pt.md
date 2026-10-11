
Seu time precisa publicar a Product API da loja: criar, listar, buscar e excluir produtos. Dois outros times (o front-end web e o serviço de pedidos) vão chamá-la sem nunca ler o seu código. Quais URLs devem existir? Qual método HTTP cria um produto? O que o cliente recebe quando o produto não existe, ou quando a requisição estoura o timeout e ele tenta de novo? O REST oferece um conjunto compartilhado de respostas, para que todas as APIs da plataforma se comportem da mesma forma.

**REST** (Representational State Transfer) é um estilo arquitetural — não um protocolo — definido por Roy Fielding em sua tese de doutorado de 2000[^1]. Uma API web que segue as restrições do REST é chamada de **API RESTful**. O REST usa o HTTP como protocolo de transferência e aproveita a semântica já existente dos métodos, códigos de status e cabeçalhos HTTP[^2].

---

## Recursos e representações

Duas palavras carregam a ideia toda:

- Um **recurso** é qualquer coisa que a API expõe e que tem um nome: um produto, a coleção de todos os produtos, os pedidos de um usuário. Cada recurso é identificado por uma **URI** (Uniform Resource Identifier), por exemplo `/products/0195abfb-7074-73a9-9d26-b4b9fbaab0a8`.
- Uma **representação** é um retrato do estado do recurso em algum formato — geralmente um documento JSON. O cliente nunca toca no recurso em si (uma linha no Postgres); ele lê e envia representações dele. É esse o "Representational State Transfer" (transferência de estado representacional) do nome.

```json title="A representation of one product (from the Product API exercise)"
{
  "id": "0195abfb-7074-73a9-9d26-b4b9fbaab0a8",
  "name": "Tomato",
  "price": 10.12,
  "unit": "kg"
}
```

O cabeçalho `Content-Type` diz em que formato o corpo está (`application/json`); o cabeçalho `Accept` diz quais formatos o cliente quer receber de volta.

---

## Restrições do REST

Fielding definiu o REST como um conjunto de restrições. Uma API que as respeita ganha as propriedades pelas quais a Web é conhecida: escalabilidade, evolução independente de cliente e servidor, e intermediários (caches, gateways) que funcionam sem conhecer a aplicação.

| Restrição | Significado |
|---|---|
| **Client-Server** | Cliente e servidor são responsabilidades separadas. O servidor não sabe nada da interface; o cliente não sabe nada do armazenamento. |
| **Stateless** (sem estado) | Cada requisição contém toda a informação necessária para processá-la. O servidor não guarda estado de sessão entre requisições. Os tokens de autenticação (JWT) viajam em toda requisição. |
| **Cacheable** (cacheável) | As respostas devem declarar se podem ser armazenadas em cache. O cache reduz a carga e melhora a latência. |
| **Uniform Interface** (interface uniforme) | Os recursos são identificados por URIs. As representações são manipuladas por meio dos métodos HTTP padrão. As mensagens são autodescritivas (`Content-Type`, código de status). As respostas incluem links para recursos relacionados (HATEOAS). |
| **Layered System** (sistema em camadas) | Os clientes não conseguem saber se estão falando com o servidor final ou com um intermediário (gateway, cache, balanceador de carga). |
| **Code on Demand** *(opcional)* | O servidor pode enviar código executável ao cliente (por exemplo, JavaScript). É a única restrição opcional. |

Na plataforma do curso, **Stateless** e **Layered System** são o que torna possível a escalabilidade horizontal: como nenhuma réplica guarda sessão, o balanceador de carga do [Hands-on 7](../../../hands-on/7/index.md) pode enviar cada requisição para qualquer instância do gateway, e o cliente não consegue distinguir o Nginx, o gateway e o serviço.

---

## Recursos e URIs

Um **recurso** é um substantivo — uma coisa que a API expõe. URIs identificam recursos, não ações.

| ✅ Bom (substantivo) | ❌ Ruim (verbo) |
|---|---|
| `GET /orders` | `GET /getOrders` |
| `POST /orders` | `POST /createOrder` |
| `GET /orders/42` | `GET /order?id=42` |
| `DELETE /orders/42` | `POST /deleteOrder/42` |

### Convenções de URI

- Use **substantivos no plural** para coleções: `/orders`, `/products`, `/users`
- Use **minúsculas com hífens**: `/order-items`, e não `/orderItems`
- Aninhe para expressar posse: `/users/7/orders` — pedidos que pertencem ao usuário 7
- Limite o aninhamento a 2–3 níveis; evite `/users/7/orders/42/items/3/reviews`
- Use **parâmetros de consulta** (query parameters) para o que não é identidade: filtragem, ordenação, paginação (`/orders?status=PENDING`)

!!! tip "Ações que não são CRUD"
    Algumas operações não se encaixam bem em criar/ler/atualizar/excluir — cancelar um pedido, por exemplo. Duas opções comuns: modelar a ação como uma mudança de estado (`PATCH /orders/42` com `{"status": "CANCELLED"}`) ou como um sub-recurso (`POST /orders/42/cancellation`). As duas mantêm o verbo fora do caminho.

---

## Métodos HTTP

| Método | Idempotente | Seguro | Uso |
|---|---|---|---|
| `GET` | ✅ | ✅ | Obter um recurso ou uma coleção. Não pode modificar o estado. |
| `POST` | ❌ | ❌ | Criar um novo recurso. O servidor atribui o ID. |
| `PUT` | ✅ | ❌ | Substituir um recurso por completo. O cliente fornece a representação inteira. |
| `PATCH` | ❌ | ❌ | Atualização parcial — apenas os campos enviados são alterados. |
| `DELETE` | ✅ | ❌ | Remover um recurso. |

**Seguro** (safe) — a requisição não altera o estado do servidor. `GET`, `HEAD` e `OPTIONS` são seguros; `POST`, `PUT`, `PATCH` e `DELETE` não são. Por serem seguros, caches e crawlers podem chamá-los livremente.

**Idempotente** — enviar a mesma requisição várias vezes tem o mesmo *efeito no servidor* que enviá-la uma vez. `PUT /orders/42` com o mesmo corpo pode ser repetido livremente; `POST /orders` criaria duplicatas. `PATCH` não tem idempotência garantida: `{"op": "increment", "field": "quantity"}` muda o resultado a cada chamada.

!!! warning "Idempotência diz respeito ao estado, não à resposta"
    `DELETE /products/42` retorna `204 No Content` na primeira vez e `404 Not Found` na segunda. Ainda assim é idempotente: depois de uma chamada ou de dez, o produto 42 não existe. Por isso, os clientes devem tratar um `404` em um `DELETE` repetido como sucesso.

### Tornando o `POST` seguro para repetir: chaves de idempotência

Redes perdem mensagens. Se o cliente envia `POST /orders` e a resposta nunca chega, ele não tem como saber se o pedido foi criado (veja [Sistemas Distribuídos](../../distributed_systems/index.md)). Repetir pode criar um **pedido duplicado**; não repetir pode perdê-lo.

A solução padrão é uma **chave de idempotência** (idempotency key): o cliente gera um id único (um UUID) por operação *lógica* e o envia em um cabeçalho; o servidor lembra quais chaves já processou e, em uma repetição, devolve o resultado armazenado em vez de executar de novo[^4][^5].

``` mermaid-sim
sequenceDiagram
    participant C as Cliente
    participant O as Serviço de Pedidos
    C->>O: POST /orders, Idempotency-Key k1
    O->>O: cria o pedido 42, guarda k1 → 42
    O--xC: 201 Created (resposta perdida)
    Note over C: timeout, retry com a MESMA chave
    C->>O: POST /orders, Idempotency-Key k1
    O->>O: k1 já processada
    O-->>C: 201 Created, pedido 42 (sem duplicata)
```

O servidor armazena a chave junto com o resultado (por exemplo, em uma tabela com restrição de unicidade na chave, ou no Redis com expiração). Provedores de pagamento como a Stripe usam exatamente esse mecanismo. Retries, timeouts e backoff são tratados em [Padrões de Resiliência](../../reliability/patterns/index.md).

---

## Códigos de status HTTP

Use o código certo — clientes e intermediários dependem deles[^3]. O primeiro dígito indica a classe: **2xx** sucesso, **3xx** redirecionamento, **4xx** o cliente fez algo errado (não repita sem alterar), **5xx** o servidor falhou (uma nova tentativa pode dar certo).

### 2xx — Sucesso

| Código | Nome | Quando usar |
|---|---|---|
| `200 OK` | Sucesso | `GET`, `PUT`, `PATCH`, `DELETE` concluídos com sucesso |
| `201 Created` | Criado | `POST` criou um novo recurso; inclua o cabeçalho `Location: /orders/42` |
| `202 Accepted` | Aceito | A requisição foi enfileirada para processamento assíncrono; o resultado ainda não está pronto |
| `204 No Content` | Sem conteúdo | Sucesso sem corpo de resposta (por exemplo, `DELETE`) |

### 4xx — Erro do cliente

| Código | Nome | Quando usar |
|---|---|---|
| `400 Bad Request` | Requisição inválida | JSON malformado, campos obrigatórios ausentes, valores inválidos |
| `401 Unauthorized` | Não autenticado | Nenhum token enviado, ou o token é inválido/expirou |
| `403 Forbidden` | Proibido | O token é válido, mas o usuário não tem permissão |
| `404 Not Found` | Não encontrado | O recurso não existe (ou quem chama não deve saber que ele existe) |
| `409 Conflict` | Conflito | Recurso duplicado, falha de lock otimista |
| `422 Unprocessable Content` | Erro de validação | Requisição bem formada, mas a validação de negócio falhou (chamado "Unprocessable Entity" antes da RFC 9110) |
| `429 Too Many Requests` | Limite de taxa excedido | O cliente excedeu seu limite de requisições; envie `Retry-After` |

### 5xx — Erro do servidor

| Código | Nome | Quando usar |
|---|---|---|
| `500 Internal Server Error` | Erro inesperado | Exceção não tratada — nunca exponha stack traces |
| `502 Bad Gateway` | Gateway inválido | Um gateway ou proxy recebeu uma resposta inválida do serviço por trás dele |
| `503 Service Unavailable` | Indisponível | O serviço está fora do ar para manutenção ou sobrecarregado |
| `504 Gateway Timeout` | Timeout do gateway | Um gateway ou proxy não recebeu a tempo uma resposta do serviço por trás dele |

Em uma plataforma de microsserviços, os códigos de gateway importam: um `502` ou `504` devolvido ao navegador geralmente significa "o gateway está bem, o serviço por trás dele não" — a primeira pista na hora de depurar.

!!! example "Códigos de status no exercício Order API"
    A [Order API](../../../exercises/order/index.md) pede `201` quando um pedido é criado, `400` quando um item referencia um produto que não existe, e `404` quando um usuário pede um pedido que pertence a outra pessoa. Retornar `404` em vez de `403` nesse caso é proposital: assim não se revela que o pedido existe.

---

## Formato de requisição e resposta

### Requisição

```http
POST /orders HTTP/1.1
Host: api.example.com
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...

{
  "customerId": 7,
  "items": [
    { "productId": 101, "quantity": 2 }
  ]
}
```

### Resposta

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

Convenções que vale manter em todos os serviços: nomes de campos em **camelCase**, datas em **ISO 8601** com fuso horário (`2026-04-28T14:30:00Z`), valores monetários com moeda explícita e ids como strings opacas (o curso usa UUIDs).

### Resposta de erro

Padronize as respostas de erro para que os clientes possam tratá-las de forma genérica. O padrão da IETF para isso é o **Problem Details for HTTP APIs** (RFC 9457[^6]), servido com o media type `application/problem+json`:

```json
{
  "type": "https://store.example.com/problems/out-of-stock",
  "title": "Product out of stock",
  "status": 422,
  "detail": "Product 101 is out of stock",
  "instance": "/orders"
}
```

| Campo | Significado |
|---|---|
| `type` | Uma URI que identifica o *tipo* de problema (padrão `about:blank`) |
| `title` | Um resumo curto e legível do tipo de problema |
| `status` | O código de status HTTP, repetido por conveniência |
| `detail` | Uma explicação específica *desta* ocorrência |
| `instance` | Uma URI que identifica esta ocorrência (muitas vezes o caminho da requisição) |

No Spring Boot, `@ControllerAdvice` / `@RestControllerAdvice` + `@ExceptionHandler` é a forma padrão de produzir respostas de erro consistentes, e a classe `ProblemDetail` do Spring produz o formato da RFC 9457:

```java
@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(ProductNotFoundException.class)
    public ProblemDetail handleNotFound(ProductNotFoundException e) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
            HttpStatus.NOT_FOUND, e.getMessage());
        problem.setTitle("Product not found");
        return problem; // serialised as application/problem+json
    }
}
```

Definir `spring.mvc.problemdetails.enabled: true` faz com que os próprios erros do Spring MVC (por exemplo, um `@Valid` que falhou) usem o mesmo formato.

!!! danger "Nunca vaze detalhes internos nos erros"
    Um stack trace ou uma mensagem de SQL em uma resposta `500` revela a um atacante o seu framework, as versões e os nomes das tabelas. Registre os detalhes no log do servidor (com um trace id, veja [Observabilidade](../../observability/index.md)) e retorne uma mensagem genérica.

---

## Paginação e filtragem

Coleções nunca devem retornar resultados ilimitados. Use parâmetros de consulta para paginação e filtragem:

``` http
GET /orders?page=2&size=20&sort=createdAt,desc
GET /orders?status=PENDING&customerId=7
```

| Padrão | Parâmetros | Observações |
|---|---|---|
| **Paginação por offset** | `?page=2&size=20` | Simples; cara em grandes volumes de dados (o BD precisa pular linhas) |
| **Paginação por cursor** | `?after=eyJpZCI6NDJ9` | Eficiente para tabelas grandes; o cursor opaco evita o deslocamento de páginas |
| **Filtragem** | `?status=PENDING` | Sempre filtre no servidor — nunca retorne todos os registros para filtrar no cliente |
| **Ordenação** | `?sort=field,direction` | Vários campos de ordenação: `?sort=name,asc&sort=createdAt,desc` |

A paginação por offset pede ao banco de dados `OFFSET 40 LIMIT 20`: o banco ainda lê e descarta as primeiras 40 linhas e, se uma linha for inserida nesse meio-tempo, o cliente vê um item duas vezes. Um cursor codifica "o último item que eu vi" (por exemplo, o id dele) e a consulta passa a ser `WHERE id > :last ORDER BY id LIMIT 20`, que usa o índice e não é afetada por inserções.

A resposta deve incluir metadados de paginação. O `Pageable` do Spring Data lê `page`, `size` e `sort` automaticamente (as páginas começam em **0**, então `page=2` é a terceira página), e o seu `PagedModel` é serializado assim:

```json
{
  "content": [...],
  "page": { "size": 20, "number": 2, "totalElements": 150, "totalPages": 8 }
}
```

---

## Versionamento { #versioning }

APIs evoluem. A primeira pergunta é se uma mudança é **incompatível** (breaking) — se um cliente existente, sem alterações, deixaria de funcionar:

| Retrocompatível (sem nova versão) | Incompatível (exige nova versão) |
|---|---|
| Adicionar um novo endpoint | Remover ou renomear um endpoint |
| Adicionar um campo **opcional** a uma requisição | Adicionar um campo **obrigatório** a uma requisição |
| Adicionar um campo a uma resposta | Remover ou renomear um campo da resposta |
| Aceitar um novo valor em uma entrada | Mudar o tipo ou o significado de um campo (`price` em centavos em vez de reais) |
|  | Mudar um código de status do qual os clientes dependem |

As mudanças compatíveis contam com clientes que sejam **leitores tolerantes** (tolerant readers): eles ignoram os campos que não conhecem. (O Jackson, no Spring Boot, ignora propriedades desconhecidas por padrão; não desligue isso nos clientes.)

Quando uma mudança incompatível é inevitável, versione a API para que os clientes existentes não quebrem:

| Estratégia | Exemplo | Observações |
|---|---|---|
| **Caminho da URI** | `/v1/orders`, `/v2/orders` | A mais visível; a mais fácil de testar no navegador |
| **Cabeçalho** | `Accept: application/vnd.myapi.v2+json` | URIs mais limpas; mais difícil de testar manualmente |
| **Parâmetro de consulta** | `/orders?version=2` | Evite — versão não é um filtro |

Versionar pelo caminho da URI é a escolha mais comum em microsserviços. Incrementos de versão major (`v1` → `v2`) sinalizam mudanças incompatíveis; melhorias menores são adicionadas sem mudar a versão. Mantenha as duas versões rodando lado a lado, anuncie uma data de descontinuação e remova a `v1` apenas quando o tráfego dela tiver acabado — o cabeçalho `Sunset` (RFC 8594) informa aos clientes quando um endpoint vai desaparecer.

!!! warning "Armadilhas de versionamento"
    - Incrementar a versão a cada mudança: os clientes não conseguem acompanhar. Prefira mudanças compatíveis.
    - Quebrar um contrato "só para um cliente interno": em uma plataforma de microsserviços, raramente você conhece todos os clientes.
    - Compartilhar o módulo de interface `account` entre serviços (como no hands-on) significa que uma mudança em `AccountOut` obriga todos os serviços dependentes a refazer o build — trate esse módulo como um contrato publicado.

---

## Referência rápida em Spring Boot

A Product API do [exercício](../../../exercises/product/index.md), com os códigos de status escolhidos acima:

```java
@RestController
@RequestMapping("/products")
public class ProductResource {

    @Autowired
    private ProductService productService;

    @GetMapping
    public ResponseEntity<List<ProductOut>> findAll() {
        return ResponseEntity.ok(productService.findAll());               // 200
    }

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

`@ResponseStatus(HttpStatus.CREATED)` em um método também retorna `201`, mas não consegue definir o cabeçalho `Location`; `ResponseEntity.created(uri)` define os dois. `@Valid` dispara a Bean Validation no DTO (`@NotBlank`, `@Positive`…) e transforma uma violação em `400 Bad Request`.

---

## Pontos-chave

- URIs nomeiam **recursos** (substantivos no plural); o **método HTTP** diz o que fazer; os clientes trocam **representações** (JSON).
- `GET` é seguro; `GET`, `PUT` e `DELETE` são idempotentes; `POST` não é nem um nem outro — torne-o seguro para repetir com uma **chave de idempotência**.
- Retorne o código de status exato (`201` + `Location`, `204`, `401` vs `403`, `422`, `502`/`504`) e os erros como **Problem Details**.
- Pagine toda coleção; prefira cursores para tabelas grandes ou que mudam rápido.
- Adicione, não remova: mudanças compatíveis não precisam de versão; as incompatíveis precisam de `/v2/` e de um período de descontinuação.

## Conexões

- Implemente estas convenções: [Hands-on 1 — CRUD](../../../hands-on/1/index.md), [Product API](../../../exercises/product/index.md), [Order API](../../../exercises/order/index.md).
- `401` e `403` na prática: [Hands-on 3 — Segurança](../../../hands-on/3/index.md) e [Segurança](../../security/index.md).
- Retries e `429`/`503`: [Padrões de Resiliência](../../reliability/patterns/index.md).
- Documente o contrato: [OpenAPI & Swagger](../swagger/index.md).

---

[^1]: FIELDING, R. T. *Architectural Styles and the Design of Network-based Software Architectures*. Tese de doutorado, UC Irvine, 2000. [Leia online](https://ics.uci.edu/~fielding/pubs/dissertation/top.htm){:target="_blank"}
[^2]: [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110){:target="_blank"}
[^3]: [HTTP Status Codes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status){:target="_blank"} — MDN Web Docs
[^4]: [The Idempotency-Key HTTP Header Field](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/){:target="_blank"} — rascunho do grupo de trabalho HTTPAPI da IETF.
[^5]: [Idempotent requests](https://docs.stripe.com/api/idempotent_requests){:target="_blank"} — referência da API da Stripe.
[^6]: [RFC 9457 — Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457){:target="_blank"}
