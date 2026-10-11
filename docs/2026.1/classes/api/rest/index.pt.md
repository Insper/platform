
**REST** (Representational State Transfer) é um estilo arquitetural — não um protocolo — definido por Roy Fielding em sua tese de doutorado de 2000[^1]. Uma API web que segue as restrições do REST é chamada de **API RESTful**. O REST usa o HTTP como protocolo de transferência e aproveita a semântica já existente dos métodos HTTP, dos códigos de status e dos cabeçalhos.

---

## Restrições do REST

| Restrição | Significado |
|---|---|
| **Cliente-servidor** | Cliente e servidor são responsabilidades separadas. O servidor não conhece a interface de usuário; o cliente não conhece o armazenamento. |
| **Sem estado (stateless)** | Cada requisição contém todas as informações necessárias para processá-la. O servidor não guarda estado de sessão entre requisições. Tokens de autenticação (JWT) acompanham cada requisição. |
| **Cacheável** | As respostas precisam declarar se podem ser armazenadas em cache. O cache reduz a carga e melhora a latência. |
| **Interface uniforme** | Os recursos são identificados por URIs. As representações são manipuladas por meio dos métodos HTTP padrão. As respostas incluem links para recursos relacionados (HATEOAS). |
| **Sistema em camadas** | Os clientes não conseguem saber se estão falando com o servidor final ou com um intermediário (gateway, cache, balanceador de carga). |

---

## Recursos e URIs

Um **recurso** é um substantivo — algo que a API expõe. URIs identificam recursos, não ações.

| ✅ Bom (substantivo) | ❌ Ruim (verbo) |
|---|---|
| `GET /orders` | `GET /getOrders` |
| `POST /orders` | `POST /createOrder` |
| `GET /orders/42` | `GET /order?id=42` |
| `DELETE /orders/42` | `POST /deleteOrder/42` |

### Convenções de URI

- Use **substantivos no plural** para coleções: `/orders`, `/products`, `/users`
- Use **letras minúsculas com hífens**: `/order-items`, e não `/orderItems`
- Aninhe para expressar posse: `/users/7/orders` — pedidos que pertencem ao usuário 7
- Limite a profundidade do aninhamento a 2–3 níveis; evite `/users/7/orders/42/items/3/reviews`

---

## Métodos HTTP

| Método | Idempotente | Seguro | Uso |
|---|---|---|---|
| `GET` | ✅ | ✅ | Obter um recurso ou uma coleção. Não pode modificar o estado. |
| `POST` | ❌ | ❌ | Criar um novo recurso. O servidor atribui o ID. |
| `PUT` | ✅ | ❌ | Substituir um recurso por completo. O cliente fornece a representação completa. |
| `PATCH` | ❌ | ❌ | Atualização parcial — apenas os campos fornecidos são alterados. |
| `DELETE` | ✅ | ❌ | Remover um recurso. |

**Idempotente** — executar a mesma requisição várias vezes tem o mesmo efeito que executá-la uma vez. `PUT /orders/42` com o mesmo corpo pode ser repetido com segurança; `POST /orders` criaria duplicatas.

**Seguro** — a requisição não altera o estado do servidor. `GET` e `HEAD` são seguros; todos os outros não são.

---

## Códigos de status HTTP

Use o código certo — clientes e intermediários dependem deles.

### 2xx — Sucesso

| Código | Nome | Quando usar |
|---|---|---|
| `200 OK` | Sucesso | `GET`, `PUT`, `PATCH`, `DELETE` concluídos com sucesso |
| `201 Created` | Criado | `POST` criou um novo recurso; inclua o cabeçalho `Location: /orders/42` |
| `204 No Content` | Sem conteúdo | Sucesso sem corpo de resposta (por exemplo, `DELETE`) |

### 4xx — Erro do cliente

| Código | Nome | Quando usar |
|---|---|---|
| `400 Bad Request` | Requisição inválida | JSON malformado, campos obrigatórios ausentes, valores inválidos |
| `401 Unauthorized` | Não autenticado | Nenhum token fornecido, ou token inválido/expirado |
| `403 Forbidden` | Proibido | O token é válido, mas o usuário não tem permissão |
| `404 Not Found` | Não encontrado | O recurso não existe |
| `409 Conflict` | Conflito | Recurso duplicado, falha de lock otimista |
| `422 Unprocessable Entity` | Erro de validação | Requisição bem formada, mas a validação de negócio falhou |

### 5xx — Erro do servidor

| Código | Nome | Quando usar |
|---|---|---|
| `500 Internal Server Error` | Erro inesperado | Exceção não tratada — nunca exponha stack traces |
| `503 Service Unavailable` | Indisponível | O serviço está fora do ar para manutenção ou sobrecarregado |

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

### Resposta de erro

Padronize as respostas de erro para que os clientes possam tratá-las de forma genérica:

```json
{
  "status": 422,
  "error": "Validation failed",
  "message": "Product 101 is out of stock",
  "path": "/orders",
  "timestamp": "2026-04-28T14:30:00Z"
}
```

O `@ControllerAdvice` + `@ExceptionHandler` do Spring Boot é a forma padrão de produzir respostas de erro consistentes.

---

## Paginação e filtragem

Coleções nunca devem retornar resultados ilimitados. Use parâmetros de consulta (query parameters) para paginação e filtragem:

``` http
GET /orders?page=2&size=20&sort=createdAt,desc
GET /orders?status=PENDING&customerId=7
```

| Padrão | Parâmetros | Observações |
|---|---|---|
| **Paginação por offset** | `?page=2&size=20` | Simples; custosa em grandes volumes de dados (o BD precisa pular linhas) |
| **Paginação por cursor** | `?after=eyJpZCI6NDJ9` | Eficiente para tabelas grandes; o cursor opaco evita o deslocamento de páginas |
| **Filtragem** | `?status=PENDING` | Sempre filtre no servidor — nunca retorne todos os registros para filtrar no cliente |
| **Ordenação** | `?sort=field,direction` | Vários campos de ordenação: `?sort=name,asc&sort=createdAt,desc` |

A resposta deve incluir metadados de paginação:

```json
{
  "content": [...],
  "page": { "number": 2, "size": 20, "total": 150, "totalPages": 8 }
}
```

---

## Versionamento

APIs evoluem. Quando uma mudança incompatível (breaking change) é inevitável, versione a API para que os clientes existentes não quebrem:

| Estratégia | Exemplo | Observações |
|---|---|---|
| **Caminho da URI** | `/v1/orders`, `/v2/orders` | A mais visível; a mais fácil de testar no navegador |
| **Cabeçalho** | `Accept: application/vnd.myapi.v2+json` | URIs mais limpas; mais difícil de testar manualmente |
| **Parâmetro de consulta** | `/orders?version=2` | Evite — versão não é um filtro |

O versionamento pelo caminho da URI é a escolha mais comum em microsserviços. Incrementos de versão principal (`v1` → `v2`) sinalizam mudanças incompatíveis; melhorias menores são adicionadas sem mudar a versão.

---

## Referência rápida em Spring Boot

```java
@RestController
@RequestMapping("/orders")
public class OrderController {

    @GetMapping
    public List<OrderOut> listOrders() { ... }

    @GetMapping("/{id}")
    public OrderOut getOrder(@PathVariable Long id) { ... }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public OrderOut createOrder(@RequestBody @Valid OrderIn in) { ... }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteOrder(@PathVariable Long id) { ... }
}
```

---

[^1]: FIELDING, R. T. *Architectural Styles and the Design of Network-based Software Architectures*. Tese de doutorado, UC Irvine, 2000. [Leia online](https://ics.uci.edu/~fielding/pubs/dissertation/top.htm){:target="_blank"}
[^2]: [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110){:target="_blank"}
[^3]: [HTTP Status Codes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status){:target="_blank"} — MDN Web Docs
