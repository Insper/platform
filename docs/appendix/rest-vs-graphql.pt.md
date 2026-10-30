# REST vs GraphQL

Todo microsserviço deste curso publica uma API, e todo front-end, parceiro e serviço vizinho depende dela. REST e GraphQL são os dois estilos que você mais vai encontrar sobre HTTP. Eles pedem dados de formas muito diferentes, e cada escolha tem um custo: em idas e voltas, em bytes, em carga no banco, em cache e na forma como a API evolui.

Esta página compara os dois na mesma necessidade, uma tela que mostra um usuário, seus pedidos e os itens de cada pedido. Ela responde a quatro perguntas:

- Como cada estilo pede dados?
- Quanto uma tela custa em idas e voltas e em bytes?
- Quanto ela custa no servidor?
- O que acontece com cache, erros e versionamento?

Para o panorama mais amplo, que também cobre gRPC e APIs assíncronas, veja a aula de 2027.1 [Estilos de API](../2027.1/classes/compute/api-styles/index.md).

---

## Duas formas de pedir dados { #two-models }

**REST** (REpresentational State Transfer) é um estilo arquitetural, não um protocolo[^2]. Roy Fielding o descreveu em sua tese de 2000[^4]. Na prática, uma API REST expõe **recursos**, cada um com a sua URL. Os clientes agem sobre eles com os **métodos** HTTP, e cada resposta traz uma **representação** do recurso. Quem decide o formato dessa representação é o servidor.

| Método | Significado | Exemplo | Seguro | Idempotente |
|---|---|---|---|---|
| `GET` | ler um recurso | `GET /users/42` | sim | sim |
| `POST` | criar (ou executar um comando) | `POST /users/42/orders` | não | não |
| `PUT` | substituir um recurso | `PUT /users/42` | não | sim |
| `PATCH` | alterar parte de um recurso | `PATCH /users/42` | não | não necessariamente |
| `DELETE` | remover um recurso | `DELETE /orders/101` | não | sim |

**GraphQL** é uma linguagem de consulta e um runtime para APIs[^3]. O Facebook o criou em 2012 e o publicou em 2015. O servidor publica um **schema** tipado atrás de **um único endpoint**, normalmente `POST /graphql`. O cliente envia um documento dizendo quais campos quer, e a resposta vem exatamente nesse formato. Há três tipos de operação: `query` (leitura), `mutation` (escrita) e `subscription` (um fluxo de eventos). No servidor, uma função **resolver** busca cada campo.

``` diagram
flowchart LR
    subgraph REST["REST: vários recursos, o servidor define cada resposta"]
        direction TB
        a1([cliente]) -->|"GET /users/42"| r1[recurso usuário]
        a1 -->|"GET /users/42/orders"| r2[recurso pedidos]
        a1 -->|"GET /orders/101/items"| r3[recurso itens]
    end
    subgraph GQL["GraphQL: um endpoint, o cliente define a resposta"]
        direction TB
        b1([cliente]) -->|"POST /graphql<br/>query { user { orders { items } } }"| g[servidor GraphQL<br/>schema + resolvers]:::comp
        g --> s1[usuários]
        g --> s2[pedidos]
        g --> s3[itens]
    end
```

Este diagrama substitui o quadro comparativo da ByteByteGo, que continua sendo um bom resumo de uma página[^1].

---

## A mesma tela, dos dois jeitos { #same-screen }

A tela *Meus pedidos* mostra o nome e o avatar do usuário, depois cada pedido com data e total, e o nome e a quantidade de cada item. Com N pedidos:

=== "REST"

    ```http
    GET /users/42 HTTP/1.1
    Host: api.example.com

    HTTP/1.1 200 OK
    Content-Type: application/json

    {"id": 42, "name": "Ana", "avatarUrl": "/img/42.png", "email": "ana@example.com",
     "phone": "+55 11 5555-0000", "address": {"street": "...", "city": "São Paulo"},
     "createdAt": "2024-03-01T10:00:00Z", "preferences": {"...": "..."}}
    ```

    ```http
    GET /users/42/orders HTTP/1.1

    HTTP/1.1 200 OK

    [{"id": 101, "date": "2026-10-01", "total": 259.90, "status": "DELIVERED",
      "shippingAddress": {"...": "..."}, "payment": {"...": "..."}, "trackingCode": "..."},
     {"id": 102, "...": "..."}]
    ```

    ```http
    GET /orders/101/items HTTP/1.1
    GET /orders/102/items HTTP/1.1
    ...one request per order
    ```

    **2 + N requisições.** As requisições de itens precisam dos ids dos pedidos, que só chegam com a segunda resposta. Toda resposta também traz campos que a tela nunca mostra (`email`, `address`, `payment`…).

=== "GraphQL"

    ```graphql
    query MyOrders {
      user(id: 42) {
        name
        avatarUrl
        orders(last: 10) {
          date
          total
          items { name quantity }
        }
      }
    }
    ```

    ```json
    {
      "data": {
        "user": {
          "name": "Ana",
          "avatarUrl": "/img/42.png",
          "orders": [
            { "date": "2026-10-01", "total": 259.9,
              "items": [ { "name": "T-shirt", "quantity": 2 } ] }
          ]
        }
      }
    }
    ```

    **Uma requisição**, e a resposta tem exatamente os campos da query, no mesmo formato.

Passo a passo, o cliente REST paga uma ida e volta de rede por recurso:

``` diagram-sim
sequenceDiagram
    participant A as App
    participant API as API REST
    participant DB as Banco
    A->>API: GET /users/42
    API->>DB: SELECT usuário 42
    API-->>A: o usuário inteiro (a tela usa 2 campos)
    A->>API: GET /users/42/orders
    API->>DB: SELECT pedidos do usuário 42
    API-->>A: N pedidos inteiros
    loop uma vez por pedido
        A->>API: GET /orders/{id}/items
        API->>DB: SELECT itens do pedido {id}
        API-->>A: itens inteiros
    end
```

O cliente GraphQL paga uma ida e volta, mas no servidor cada resolver roda por conta própria:

``` diagram-sim
sequenceDiagram
    participant A as App
    participant G as Servidor GraphQL
    participant DB as Banco
    A->>G: POST /graphql (query MyOrders)
    G->>DB: resolver de user: SELECT usuário 42
    G->>DB: resolver de orders: SELECT pedidos do usuário 42
    loop resolver de items, uma vez por pedido
        G->>DB: SELECT itens do pedido {id}
    end
    G-->>A: exatamente os campos pedidos
```

O `loop` do segundo diagrama é o [problema N+1](#n-plus-1). Ele não desapareceu: saiu da rede e foi para o banco.

---

## Over-fetching e under-fetching { #over-under-fetching }

- **Over-fetching** (buscar demais): a resposta traz mais do que o cliente precisa. `GET /users/42` devolve o usuário inteiro mesmo quando a tela só mostra o nome. Numa rede móvel, esses bytes custam tempo e bateria.
- **Under-fetching** (buscar de menos): uma resposta não basta, e o cliente faz mais requisições. Aqui, uma requisição a mais por pedido.

O GraphQL elimina os dois por construção: o cliente pede exatamente os campos de que precisa, atravessando objetos relacionados, numa só requisição.

As APIs REST têm as suas próprias soluções, cada uma com um custo:

| Solução | Exemplo | Custo |
|---|---|---|
| campos esparsos (sparse fieldsets) | `GET /users/42?fields=name,avatarUrl` (JSON:API[^5]) | todo endpoint precisa suportar |
| embutir / expandir | `GET /users/42/orders?expand=items` | o servidor precisa suportar cada combinação |
| um endpoint composto | `GET /screens/my-orders` | um endpoint por tela, acoplado à interface |
| um BFF (Backend for Frontend) | uma camada de API por front-end, que chama os serviços | mais um serviço para operar |

Um servidor GraphQL muitas vezes é exatamente esse BFF: uma camada na frente de serviços REST ou gRPC que os compõe para as telas.

---

## O problema N+1 e o DataLoader { #n-plus-1 }

Um servidor GraphQL resolve uma query campo a campo. O resolver de `orders` devolve N pedidos. Depois, o resolver de `items` roda **uma vez por pedido**, e cada chamada faz a sua própria consulta. São 1 consulta para o usuário, 1 para os pedidos e N para os itens: **N + 2 consultas para uma requisição**. O nome "N+1" vem da parte 1 + N. O cliente vê uma ida e volta rápida, enquanto o banco recebe uma rajada de consultas pequenas.

Um **DataLoader**[^6] resolve isso agrupando as consultas. Durante uma etapa da execução, cada resolver só *registra* a chave de que precisa (`load(101)`, `load(102)`, …). No fim da etapa, o loader chama uma função de lote uma única vez com todas as chaves. Essa função faz uma consulta (`WHERE order_id IN (101, 102, …)`), e o loader entrega a cada resolver a sua parte. Ele também guarda cada chave em cache pelo resto da requisição.

No Spring for GraphQL, `@BatchMapping` registra um DataLoader para você[^7]:

=== "N+1: uma chamada por pedido"

    ```java
    @Controller
    public class OrderController {

        @SchemaMapping(typeName = "Order", field = "items")
        public List<Item> items(Order order) {
            return itemRepository.findByOrderId(order.id());   // runs N times
        }
    }
    ```

=== "Em lote: uma chamada para todos os pedidos"

    ```java
    @Controller
    public class OrderController {

        @BatchMapping
        public Map<Order, List<Item>> items(List<Order> orders) {
            List<Long> ids = orders.stream().map(Order::id).toList();
            Map<Long, List<Item>> byOrder = itemRepository.findByOrderIdIn(ids).stream()
                .collect(Collectors.groupingBy(Item::orderId));   // runs once
            return orders.stream().collect(Collectors.toMap(
                o -> o, o -> byOrder.getOrDefault(o.id(), List.of())));
        }
    }
    ```

O REST tem o mesmo problema, só que no cliente: o laço de `GET /orders/{id}/items` é um N+1 pela rede, e cada passo custa uma ida e volta inteira.

O simulador põe números nos dois estilos. A tela precisa de um usuário, N pedidos e 3 itens por pedido. Os custos são ilustrativos: 4 ms de trabalho da aplicação por requisição e 5 ms por consulta ao banco. Mexa nos controles para ver para onde vai o tempo.

<div class="csim" data-sim="api-fetch" data-n="10" data-rtt="100" data-mode="seq" data-loader="off"></div>

!!! tip "Experimente"
    Comece com N = 10 pedidos e RTT = 100 ms. O REST sequencial faz 12 idas e voltas e leva 1.308 ms. Ele baixa 21,6 kB, e 88% do conteúdo são campos que a tela nunca mostra. Mude o REST para **paralelo**: o usuário e os pedidos vão juntos, depois todas as requisições de itens juntas. São duas ondas, 218 ms. O GraphQL faz uma ida e volta, baixa 2,5 kB e leva 164 ms, mas os resolvers fizeram 12 consultas ao banco em fila. Ligue o **DataLoader**: 3 consultas, 119 ms. Agora desligue de novo e arraste N até 50: o GraphQL leva 364 ms, mais que o REST paralelo com 218 ms. Um servidor GraphQL ingênuo pode perder no banco o tempo que ganhou na rede.

---

## Cache { #caching }

**O REST ganha o cache HTTP de graça.** Um `GET` tem uma URL, e a URL é a chave do cache. Navegadores, CDNs e proxies reversos já entendem `Cache-Control`. Com `ETag` e `If-None-Match`, o cliente revalida de forma barata e recebe um `304 Not Modified` sem corpo:

```http
GET /products/7 HTTP/1.1
If-None-Match: "v12"

HTTP/1.1 304 Not Modified
Cache-Control: max-age=60
ETag: "v12"
```

**O GraphQL não ganha, por padrão.** As queries costumam ir por `POST` para a mesma URL `/graphql`, e os caches HTTP não guardam respostas de `POST`. Como cada query é diferente, não há uma URL para usar como chave. As respostas de costume:

- **`GET` para queries.** A especificação GraphQL over HTTP permite que servidores aceitem queries (nunca mutations) por `GET`, com a query na URL[^8]. Só que queries longas geram URLs longas.
- **Persisted queries** (queries registradas). O cliente registra cada query antes, no build ou no primeiro uso, e depois envia só o hash dela. A requisição fica curta, pode ser um `GET` cacheável, e um servidor que aceita *apenas* queries registradas também bloqueia queries arbitrárias e caras. As "automatic persisted queries" da Apollo são um protocolo muito usado[^9]:

    ```http
    GET /graphql?operationName=MyOrders&variables={"id":42}&extensions={"persistedQuery":{"version":1,"sha256Hash":"ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}} HTTP/1.1
    ```

- **Caches normalizados no cliente**, como Apollo Client e Relay. Eles guardam cada objeto de uma resposta por tipo e id, e uma query posterior que pede `User:42` o lê da memória.

---

## Erros { #errors }

**O REST usa o código de status HTTP.** `404` quer dizer que o recurso não existe, `400` uma requisição inválida, `409` um conflito, `503` que o serviço está indisponível. Proxies, gateways, retries e dashboards leem o status sem abrir o corpo. A RFC 9457 (Problem Details) dá ao corpo um formato padrão[^10]:

```http
HTTP/1.1 404 Not Found
Content-Type: application/problem+json

{"type": "https://api.example.com/problems/order-not-found",
 "title": "Order not found", "status": 404, "detail": "Order 999 does not exist"}
```

**O GraphQL informa os erros no corpo.** A resposta traz uma lista `errors` ao lado de `data`, e uma query pode dar certo em parte: o usuário e os pedidos voltam, e os itens de um pedido falham. Na prática, a maioria dos servidores responde `200 OK` sempre que conseguiu executar a query:

```json
{
  "data": { "user": { "name": "Ana", "orders": [ { "date": "2026-10-01", "items": null } ] } },
  "errors": [
    { "message": "inventory service unavailable",
      "path": ["user", "orders", 0, "items"],
      "extensions": { "classification": "INTERNAL_ERROR" } }
  ]
}
```

A especificação GraphQL over HTTP, ainda um rascunho de trabalho, pede um status 4xx ou 5xx quando não há `data` nenhum, por exemplo depois de um erro de sintaxe[^8]. Mesmo assim, um `200` pode esconder uma falha parcial. Um alerta de taxa de erro que só conta respostas 5xx não vê os erros do GraphQL, então conte também as entradas de `errors`.

---

## Versionamento { #versioning }

O **REST** costuma pôr mudanças incompatíveis numa nova versão: `/v1/orders` → `/v2/orders`, um header ou um media type. Os clientes antigos continuam na v1 até ela ser aposentada. O assunto tem página própria: [Versionamento de APIs REST](versioning-rest-apis.md).

O **GraphQL** costuma não ter versões. Cada cliente nomeia os campos que lê, então o schema pode crescer sem quebrar ninguém: adicionar um campo ou um tipo é sempre seguro. Para substituir um campo, adicione o novo e marque o antigo com `@deprecated`. Depois acompanhe as métricas de uso dos campos e remova o antigo quando ninguém mais pedir por ele:

```graphql
type Order {
  id: ID!
  total: Float @deprecated(reason: "Use totalAmount, which carries the currency.")
  totalAmount: Money!
}

type Money {
  amount: String!
  currency: String!
}
```

Ferramentas e IDEs avisam sobre campos obsoletos, e a introspecção os lista. Isso funciona porque o servidor vê exatamente qual cliente lê qual campo. Um servidor REST só vê que alguém chamou `GET /orders`.

---

## Quando usar cada um { #when-to-use }

| | REST | GraphQL |
|---|---|---|
| Modelo | recursos e métodos HTTP | schema tipado atrás de um endpoint |
| Formato da resposta | decidido pelo servidor | decidido pelo cliente |
| Idas e voltas por tela | muitas vezes várias | uma |
| Over-fetching | comum, resolvido endpoint a endpoint | nenhum, por construção |
| Custo no servidor | previsível, por endpoint | depende da query: N+1, queries profundas |
| Cache HTTP | nativo (`GET`, `ETag`, CDN) | precisa de persisted queries ou cache no cliente |
| Erros | códigos de status HTTP | `errors` no corpo, dados parciais |
| Evolução | versões para mudanças incompatíveis | adicionar campos, `@deprecated`, remover depois |
| Contrato | OpenAPI (opcional) | schema com introspecção (obrigatório) |

- **Escolha REST** para APIs públicas e de parceiros, serviços CRUD, leituras cacheáveis e downloads de arquivos, e para chamadas entre serviços. É simples, toda ferramenta entende, e códigos de status e caches funcionam sem esforço extra.
- **Escolha GraphQL** quando muitas telas diferentes compõem dados de vários serviços, principalmente em redes móveis. Ele costuma ficar como um BFF na frente de serviços REST ou gRPC. Planeje DataLoaders, limites de profundidade e de custo das queries, autorização por campo e persisted queries desde o primeiro dia.
- **gRPC** é a terceira opção, para chamadas internas entre serviços: protobuf binário sobre HTTP/2, um contrato `.proto` obrigatório e streaming, mas o navegador não consegue chamá-lo diretamente.

A maioria dos sistemas reais mistura os três: REST na borda pública, GraphQL para os front-ends, gRPC ou eventos por dentro.

---

## Pontos-chave { #key-takeaways }

!!! takeaways ""
    - O REST expõe **recursos** manipulados com métodos HTTP, e o servidor define cada resposta. O GraphQL expõe um **schema tipado** atrás de um endpoint, e o cliente define a resposta.
    - O REST tende a fazer **over-fetching** (representações inteiras) e **under-fetching** (uma requisição por recurso relacionado). O GraphQL busca exatamente os campos de uma tela numa só ida e volta.
    - O N+1 não desaparece com GraphQL: ele vai para o servidor, onde os resolvers fazem uma consulta por objeto pai. Agrupe-as com um **DataLoader** (`@BatchMapping` no Spring).
    - O REST ganha **cache HTTP** de graça. O GraphQL precisa de queries por `GET`, **persisted queries** ou caches no cliente.
    - O REST informa erros no **código de status**. O GraphQL devolve `errors` no corpo, muitas vezes com `200` e dados parciais, então monitore os dois.
    - O REST **versiona** mudanças incompatíveis. O GraphQL evolui um único schema com `@deprecated` e métricas de uso dos campos.

---

[^1]: XU, A., [System Design 101](https://github.com/ByteByteGoHq/system-design-101). Veja [SOAP vs REST vs GraphQL vs RPC](https://bytebytego.com/guides/soap-vs-rest-vs-graphql-vs-rpc/){target="_blank"}.

[^2]: :fontawesome-brands-wikipedia-w:{ .wikipedia } [REST](https://en.wikipedia.org/wiki/REST).

[^3]: :fontawesome-brands-wikipedia-w:{ .wikipedia } [GraphQL](https://en.wikipedia.org/wiki/GraphQL). A linguagem é definida pela [GraphQL Specification](https://spec.graphql.org/){target="_blank"}.

[^4]: FIELDING, R. T., [Architectural Styles and the Design of Network-based Software Architectures, chapter 5: Representational State Transfer (REST)](https://ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm){target="_blank"}. Tese de doutorado, University of California, Irvine, 2000.

[^5]: [JSON:API: Sparse Fieldsets](https://jsonapi.org/format/#fetching-sparse-fieldsets){target="_blank"}.

[^6]: [graphql/dataloader](https://github.com/graphql/dataloader){target="_blank"}, a implementação de referência (JavaScript). Em Java há a [java-dataloader](https://github.com/graphql-java/java-dataloader){target="_blank"}, que o Spring for GraphQL usa.

[^7]: [Spring for GraphQL: `@BatchMapping`](https://docs.spring.io/spring-graphql/reference/controllers.html#controllers.batch-mapping){target="_blank"}.

[^8]: [GraphQL over HTTP](https://http-spec.graphql.org/draft/){target="_blank"}, rascunho de trabalho da GraphQL Foundation.

[^9]: [Apollo Server: Automatic Persisted Queries](https://www.apollographql.com/docs/apollo-server/performance/apq){target="_blank"}.

[^10]: [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457){target="_blank"}. IETF, 2023.
