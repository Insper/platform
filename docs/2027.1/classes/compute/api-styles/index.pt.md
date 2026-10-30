Quatro clientes diferentes precisam da mesma informação do BoxOffice — "quais eventos estão à venda e quantos lugares ainda restam?":

- o **app web**, que renderiza a página de um evento combinando dados do catálogo, o mapa de assentos e a disponibilidade;
- o **app mobile**, numa conexão 4G congestionada na fila do estádio, onde cada kilobyte e cada ida e volta contam;
- um **parceiro revendedor**, que integra uma vez e depois espera que a API nunca quebre;
- o **serviço `order`** interno, que pede ao `inventory` para confirmar holds milhares de vezes por segundo durante a abertura das vendas.

Um único estilo de API não serve aos quatro. Esta página compara as quatro famílias que você vai encontrar na prática — **REST, gRPC, GraphQL e APIs assíncronas** — sobre o *mesmo* recurso do BoxOffice e, depois, trata do que importa mais do que o estilo: projetar bem o contrato e evoluí-lo sem quebrar ninguém.

---

## Uma API é um contrato { #an-api-is-a-contract }

Uma **API** (Application Programming Interface) é o contrato entre um **provedor** (o serviço que a implementa) e seus **consumidores** (o código que a chama): quais operações existem, o que elas aceitam e o que devolvem — e nada sobre como são implementadas. Um contrato estável é o que permite ao time do `catalog` reescrever sua camada de persistência sem avisar ninguém, e o que permite ao time mobile publicar sem esperar o backend.

Três consequências orientam tudo o que vem a seguir:

- **Exponha DTOs, não entidades.** Um DTO (Data Transfer Object) é uma classe cuja única função é atravessar a fronteira. Devolver a entidade JPA amarra o contrato ao schema do banco e vaza campos internos.
- **O contrato é um documento, não só código.** OpenAPI (REST), arquivos `.proto` (gRPC), o schema GraphQL e AsyncAPI (eventos) o descrevem de forma legível por máquina, e a partir deles se geram clientes, servidores, mocks e testes.
- **Mudar o contrato é uma negociação.** Tudo o que um consumidor consegue observar — o nome de um campo, um status code, a ordem de uma lista — faz parte dele.

---

## Um recurso, quatro estilos { #one-resource-four-styles }

O recurso: um **evento** com sua **disponibilidade** (lugares restantes por setor). Veja como cada estilo expressa "me dê o evento `evt_42` com a disponibilidade".

=== "REST + OpenAPI"

    Recursos são identificados por URLs, operações por métodos HTTP, resultados por status codes; o contrato é um documento **OpenAPI**.

    ```http
    GET /v1/events/evt_42?include=availability HTTP/1.1
    Accept: application/json
    ```

    ```yaml title="openapi.yaml (excerpt)"
    openapi: 3.1.0
    info: { title: BoxOffice Catalog API, version: 1.4.0 }
    paths:
      /v1/events/{eventId}:
        get:
          operationId: getEvent
          parameters:
            - { name: eventId, in: path, required: true, schema: { type: string } }
            - { name: include, in: query, schema: { type: string, enum: [availability] } }
          responses:
            "200":
              description: The event
              content:
                application/json:
                  schema: { $ref: "#/components/schemas/Event" }
            "404": { $ref: "#/components/responses/NotFound" }
    components:
      schemas:
        Event:
          type: object
          required: [id, title, startsAt, venue]
          properties:
            id: { type: string, example: evt_42 }
            title: { type: string, example: "Stadium Tour — São Paulo" }
            startsAt: { type: string, format: date-time }
            venue: { $ref: "#/components/schemas/VenueRef" }
            availability:
              type: array
              items:
                type: object
                properties:
                  section: { type: string, example: "PISTA" }
                  seatsLeft: { type: integer, example: 1180 }
                  priceCents: { type: integer, example: 45000 }
    ```

    Qualquer cliente HTTP consegue chamá-la — um navegador, o `curl`, o script de um parceiro — e as respostas de `GET` podem ser cacheadas por navegadores e CDNs.

=== "gRPC + Protocol Buffers"

    As operações são **chamadas de procedimento remoto** declaradas num arquivo `.proto`; o código de cliente e servidor é **gerado**, e as mensagens trafegam em binário compacto sobre HTTP/2.

    ```protobuf title="inventory.proto"
    syntax = "proto3";
    package boxoffice.inventory.v1;

    import "google/protobuf/timestamp.proto";

    service InventoryService {
      rpc GetAvailability (GetAvailabilityRequest) returns (Availability);
      // server streaming: the seat map pushes changes while the fan looks at it
      rpc WatchAvailability (GetAvailabilityRequest) returns (stream AvailabilityChange);
    }

    message GetAvailabilityRequest {
      string event_id = 1;
    }

    message Availability {
      string event_id = 1;
      repeated Section sections = 2;
      google.protobuf.Timestamp as_of = 3;
    }

    message Section {
      string name = 1;
      int32 seats_left = 2;
      int64 price_cents = 3;
    }

    message AvailabilityChange {
      string section = 1;
      int32 seats_left = 2;
    }
    ```

    Os números (`= 1`, `= 2`) são **field tags**: na rede trafegam apenas a tag e o valor, não o nome do campo — por isso as mensagens protobuf são compactas, e por isso uma tag nunca pode ser reutilizada.

=== "GraphQL"

    Um único endpoint (`POST /graphql`) e um **schema** tipado; o **cliente escolhe os campos** que quer, possivelmente atravessando vários serviços numa só requisição.

    ```graphql title="schema.graphql (excerpt)"
    type Query {
      event(id: ID!): Event
      events(city: String, first: Int = 20, after: String): EventConnection!
    }

    type Event {
      id: ID!
      title: String!
      startsAt: DateTime!
      venue: Venue!
      availability: [SectionAvailability!]!   # resolved by the inventory service
    }

    type SectionAvailability {
      section: String!
      seatsLeft: Int!
      priceCents: Int!
    }
    ```

    ```graphql title="the mobile app's query"
    query EventCard {
      event(id: "evt_42") {
        title
        startsAt
        availability { section seatsLeft }
      }
    }
    ```

    O app mobile recebe exatamente `title`, `startsAt` e dois campos por setor — sem a descrição do local, sem imagens, sem preços que ele não exibe.

=== "Assíncrono (eventos + AsyncAPI)"

    Nenhuma requisição: o provedor **publica** um fato quando algo muda, e os consumidores interessados assinam. O contrato é o schema da mensagem e o canal, descritos em **AsyncAPI**.

    ```yaml title="asyncapi.yaml (excerpt)"
    asyncapi: 3.0.0
    info: { title: BoxOffice Inventory Events, version: 1.0.0 }
    channels:
      availabilityChanged:
        address: inventory.availability.v1
        messages:
          AvailabilityChanged:
            payload:
              type: object
              required: [eventId, section, seatsLeft, occurredAt]
              properties:
                eventId: { type: string, example: evt_42 }
                section: { type: string, example: PISTA }
                seatsLeft: { type: integer, example: 1179 }
                occurredAt: { type: string, format: date-time }
    operations:
      publishAvailabilityChanged:
        action: send
        channel: { $ref: "#/channels/availabilityChanged" }
    ```

    `search` e `analytics` consomem este tópico para manter suas próprias cópias atualizadas; ninguém chama o `inventory` para perguntar.

---

## REST na prática { #rest-in-practice }

REST (Representational State Transfer) foi definido por Roy Fielding como um estilo arquitetural sobre a semântica do HTTP[^1][^2]. Na prática, "API REST" significa o **nível 2 de maturidade de Richardson**: recursos com URLs próprias, métodos HTTP e status codes corretos[^3].

### Recursos e métodos do BoxOffice { #resources-and-methods-for-boxoffice }

| Método + caminho | Significado | Seguro | Idempotente | Sucesso |
|---|---|---|---|---|
| `GET /v1/events?city=sao-paulo&cursor=…` | listar eventos | sim | sim | `200` |
| `GET /v1/events/{id}` | um evento | sim | sim | `200` |
| `POST /v1/events/{id}/holds` | reservar lugares por 10 min | não | **não** → precisa de uma `Idempotency-Key` | `201` + `Location` |
| `DELETE /v1/holds/{holdId}` | liberar um hold | não | sim | `204` |
| `POST /v1/orders` | fechar a compra de um hold | não | **não** → precisa de uma `Idempotency-Key` | `202` (pagamento pendente) ou `201` |
| `GET /v1/orders/{id}` | status do pedido | sim | sim | `200` |
| `PATCH /v1/fans/me` | atualizar campos do perfil | não | não garantido | `200` |

**Seguro** significa que a requisição não altera o estado do servidor (caches e crawlers podem chamá-la à vontade). **Idempotente** significa que executá-la duas vezes tem o mesmo *efeito* que executá-la uma vez, então é seguro repeti-la. `POST` não é nenhum dos dois — e é por isso que todo `POST` que cria estado envolvendo dinheiro no BoxOffice exige uma **chave de idempotência** ([integrações](../integrations/index.md#idempotency-keys)).

### Status codes que carregam significado { #status-codes-that-carry-meaning }

| Código | Significado no BoxOffice | O cliente deve… |
|---|---|---|
| `200 OK` / `201 Created` | feito / criado (com `Location`) | seguir em frente |
| `202 Accepted` | pedido recebido, pagamento ainda em processamento | consultar `GET /orders/{id}` ou esperar um push |
| `400 Bad Request` / `422 Unprocessable Content` | malformada / semanticamente inválida (7 lugares, o máximo é 6) | corrigir a requisição — nunca repetir |
| `401` / `403` | não autenticado / não autorizado | fazer login / desistir |
| `404 Not Found` | evento inexistente | desistir |
| `409 Conflict` | lugar já reservado por outra pessoa | escolher outros lugares |
| `429 Too Many Requests` | rate limit atingido (bots na abertura das vendas) | esperar o `Retry-After` e então repetir |
| `503 Service Unavailable` | sobrecarregado ou dependência fora do ar | repetir com backoff + jitter |

Erros merecem um **corpo uniforme**. A RFC 9457, *Problem Details for HTTP APIs*, define um (`application/problem+json`) que o Spring Boot (3 em diante) suporta nativamente via `ProblemDetail`[^4]:

```json title="409 Conflict — application/problem+json"
{
  "type": "/problems/seat-unavailable",
  "title": "Seat unavailable",
  "status": 409,
  "detail": "Seat C-14 is held by another fan.",
  "instance": "/v1/events/evt_42/holds",
  "unavailableSeats": ["C-14"]
}
```

### Paginação: offset vs cursor { #pagination-offset-vs-cursor }

| | Offset (`?page=3&size=20`) | Cursor / keyset (`?after=eyJpZCI6...&limit=20`) |
|---|---|---|
| Consulta | `ORDER BY starts_at LIMIT 20 OFFSET 40` | `WHERE (starts_at, id) > (:t, :id) ORDER BY starts_at, id LIMIT 20` |
| Páginas profundas | lento: o banco ainda percorre as linhas puladas | rápido: um index seek |
| Inserções durante a paginação | as linhas se deslocam → duplicatas ou buracos | estável |
| Pular para a página 37 | sim | não (só próxima/anterior) |
| Use para | tabelas administrativas pequenas | feeds, catálogos, qualquer coisa grande ou viva |

O cursor é uma string opaca (muitas vezes o base64 da chave de ordenação da última linha) que o cliente devolve sem alterar.

### Cache e operações longas { #caching-and-long-running-operations }

- **Requisições condicionais**: o `catalog` devolve `ETag: "v17"` e `Cache-Control: public, max-age=30`; um cliente que repete a requisição com `If-None-Match: "v17"` recebe `304 Not Modified` sem corpo. A CDN ([edge](../../edge/dns-cdn/index.md#cache-control)) faz o mesmo em escala — mais um motivo para manter as leituras como `GET`s cacheáveis.
- **Operações longas**: nunca segure uma conexão por 30 s. Responda `202 Accepted` com um recurso de status em `Location: /v1/orders/ord_9`, e deixe o cliente consultá-lo ou receber um push. O checkout usa exatamente isso enquanto o provedor de pagamentos decide.

### O contrato no código { #the-contract-in-code }

Com o **springdoc-openapi**, o documento OpenAPI é gerado a partir do controller anotado (*code-first*); alternativamente, o YAML é escrito primeiro e a interface do controller é gerada a partir dele (*contract-first*, por exemplo com o `openapi-generator`). Contract-first combina com APIs consumidas por parceiros; code-first é mais rápido para as internas.

```java title="catalog: EventController.java"
@RestController
@RequestMapping("/v1/events")
@Tag(name = "Events")
class EventController {

    private final EventQueries queries;

    EventController(EventQueries queries) { this.queries = queries; }

    @GetMapping("/{eventId}")
    @Operation(summary = "Get one event, optionally with seat availability")
    ResponseEntity<EventDto> get(@PathVariable String eventId,
                                 @RequestParam(required = false) Include include) {
        EventDto event = queries.find(eventId, include == Include.AVAILABILITY)
                .orElseThrow(() -> new ErrorResponseException(HttpStatus.NOT_FOUND));
        return ResponseEntity.ok()
                .eTag(event.version())
                .cacheControl(CacheControl.maxAge(Duration.ofSeconds(30)).cachePublic())
                .body(event);
    }
}
```

O [hands-on 1](../../../hands-on/1/index.md) constrói uma versão mais simples deste controller (quadro abaixo).

!!! example "No código do BoxOffice: o contrato do `catalog` (lab 1)"

    O [Hands-on 1 — API](../../../hands-on/1/api/index.md) é code-first: o springdoc lê o controller e publica o documento OpenAPI sob o prefixo do próprio serviço, `/catalog/openapi` (Swagger UI em `/swagger-ui.html`), para que o documento passe pela borda e pelo gateway junto com a API que descreve. O `POST` responde `201` com um `Location`, e todo erro é `application/problem+json`. Compare com o ideal acima: ainda não há `/v1` (acrescente antes que um consumidor externo dependa desses caminhos), a paginação é por offset (`page`, `size` ≤ 50) sobre 200.000 eventos semeados, barata nas primeiras páginas e lenta nas profundas, e não há `ETag`: o lab barateia as leituras com o Redis ([lab 5](../../../hands-on/5/cache-aside/index.md)).

    ``` { .java title="services/catalog/src/main/java/boxoffice/catalog/EventController.java (the contract, code-first)" }
    --8<-- "docs/2027.1/hands-on/1/code/services/catalog/src/main/java/boxoffice/catalog/EventController.java:20:47"
    ```

---

## gRPC na prática { #grpc-in-practice }

gRPC é um framework de RPC criado pelo Google, construído sobre **HTTP/2** e **Protocol Buffers**[^5]. O que você ganha:

- **Clientes gerados e tipados** em uma dúzia de linguagens a partir de um único `.proto` — chamar `inventory.getAvailability(req)` parece uma chamada de método local.
- **Mensagens binárias compactas** e parsing barato: payloads protobuf costumam ser várias vezes menores que o JSON equivalente, o que importa para tráfego interno intenso.
- **Multiplexação**: muitas chamadas concorrentes sobre uma única conexão HTTP/2.
- **Streaming**: unário, server streaming (o `WatchAvailability` acima), client streaming e bidirecional.
- **Deadlines** que se propagam: quem chama diz "preciso de uma resposta em até 300 ms", e cada salto sabe quanto tempo resta.

E o que custa:

- **Navegadores não conseguem chamá-lo diretamente**: você precisa de gRPC-Web ou Connect através de um proxy, ou de uma fachada REST/GraphQL na borda.
- **O balanceamento de carga é sutil**: uma única conexão HTTP/2 de longa duração carrega todas as chamadas, então um load balancer L4 prende todo o tráfego de um cliente a um único servidor. Use um proxy L7 (Envoy, um service mesh) ou balanceamento no cliente ([edge](../../edge/load-balancing/index.md#l4-l7)).
- **Mais difícil de depurar à mão**: binário na rede; use `grpcurl` e server reflection.

**Uso típico**: chamadas internas, de alto volume, entre serviços — `order` → `inventory` durante a abertura das vendas — em que os dois lados são seus.

---

## GraphQL na prática { #graphql-in-practice }

GraphQL é uma linguagem de consulta e um runtime para APIs[^6]. O cliente envia uma query descrevendo o formato dos dados que quer; os **resolvers** do servidor buscam cada campo, possivelmente em serviços diferentes.

- **Sem over-fetching nem under-fetching**: uma única ida e volta devolve exatamente o que uma tela precisa — atraente para mobile.
- **Um schema tipado** com introspecção: ótimo ferramental e autodocumentação.
- **Evolução sem versões**: adicione campos livremente, marque os antigos com `@deprecated` e remova-os quando o uso chegar a zero.

Os problemas para os quais é preciso se planejar:

- **O problema N+1**: listar 20 eventos, cada um com `availability`, dispara ingenuamente 1 + 20 chamadas ao `inventory`. Agrupe-as com um **DataLoader** (junte os 20 ids e faça uma só chamada).
- **Cache é mais difícil**: as queries costumam ir como `POST` para uma única URL, então caches HTTP e CDNs não ajudam por padrão. **Persisted queries** (o cliente envia o hash de uma query pré-registrada, possivelmente com `GET`) recuperam a cacheabilidade e bloqueiam queries arbitrárias.
- **Queries abusivas**: uma query profundamente aninhada pode ser muito cara. Limite a profundidade e calcule um orçamento de **custo de query** por cliente.
- **Autorização por campo**, não por endpoint.

**Uso típico**: um **BFF** (Backend for Frontend) — uma camada GraphQL por front-end, que compõe `catalog`, `inventory` e `search` para as telas. Organizações grandes usam **federation** para que cada time seja dono de uma parte de um único grafo.

---

## APIs assíncronas { #asynchronous-apis }

Nem toda interação é uma pergunta que precisa de resposta imediata. Os estilos assíncronos eliminam a espera de quem chama:

| Estilo | Direção | Uso no BoxOffice | Visto em |
|---|---|---|---|
| **Eventos num broker** (Kafka, Pub/Sub) | o provedor publica, muitos consumidores | `OrderConfirmed` → notification, analytics, search | [mensageria](../../messaging/index.md) |
| **Comandos numa fila** | um produtor, um entre N workers | "gerar o PDF do ingresso do pedido 9" | [trabalho assíncrono](../async-work/index.md) |
| **Webhooks** | o provedor chama a *sua* URL quando algo acontece | o provedor de pagamentos avisa o `payment` que uma cobrança foi aprovada | [integrações](../integrations/index.md#webhooks) |
| **WebSocket / SSE** | o servidor envia para um cliente conectado | mapa de assentos ao vivo, "sua posição na fila: 18.204" | [edge — protocolos](../../edge/protocols/index.md#real-time) |

O contrato continua importando: schemas de eventos precisam da mesma disciplina que payloads REST — documentados (AsyncAPI), versionados e evoluídos de forma compatível (schema registry, [mensageria](../../messaging/index.md)).

---

## Escolhendo um estilo { #choosing-a-style }

| | REST | gRPC | GraphQL | Assíncrono (eventos/filas) |
|---|---|---|---|---|
| Transporte | HTTP/1.1, 2, 3 | HTTP/2 | HTTP | protocolo do broker (Kafka, AMQP), HTTP para webhooks |
| Payload | JSON (texto) | protobuf (binário) | JSON | JSON, Avro, protobuf |
| Contrato | OpenAPI (opcional!) | `.proto` (obrigatório) | schema (obrigatório) | AsyncAPI, schema registry |
| Nativo no navegador | sim | não (gRPC-Web/Connect) | sim | WebSocket/SSE para push |
| Cache HTTP | excelente (`GET`, ETag, CDN) | nenhum | difícil (persisted queries) | não se aplica |
| Streaming | SSE, chunked | embutido (4 tipos) | subscriptions | inerente |
| Acoplamento | requisição/resposta, temporal | requisição/resposta, temporal, geração de código | requisição/resposta, temporal | **nenhum no tempo**: consumidores podem estar fora do ar |
| Melhor para | APIs públicas e de parceiros, CRUD, leituras cacheáveis | chamadas internas de alto QPS, serviços poliglotas, streaming | front-ends que compõem muitos serviços (BFF) | efeitos colaterais, fan-out, trabalho que pode esperar |

``` diagram
flowchart TD
    q1{"Quem chama precisa<br/>do resultado para continuar?"} -->|não| async["Assíncrono: evento ou fila<br/>(ou um webhook para um parceiro)"]
    q1 -->|sim| q2{"Quem é o consumidor?"}
    q2 -->|"navegador, parceiro,<br/>público"| q3{"Uma tela precisa de dados<br/>de muitos serviços?"}
    q3 -->|sim| gql["BFF GraphQL<br/>(REST por baixo)"]
    q3 -->|não| rest["REST + OpenAPI"]
    q2 -->|"serviço interno,<br/>alto volume ou streaming"| grpc["gRPC"]
    q2 -->|"serviço interno,<br/>volume moderado"| rest
```

Sistemas reais misturam todos eles. No BoxOffice: **REST** na borda pública e para parceiros, um **BFF GraphQL** para os apps web e mobile, **gRPC** entre `order` e `inventory`, **eventos** para tudo o que acontece *porque* um pedido foi confirmado, e **webhooks** chegando do provedor de pagamentos.

---

## Evoluindo um contrato { #evolving-a-contract }

APIs mudam. A primeira pergunta diante de qualquer mudança é se ela é **incompatível** (*breaking*) — se um consumidor existente, sem alteração, deixaria de funcionar:

| Compatível (sem nova versão) | Incompatível (exige nova versão ou migração) |
|---|---|
| adicionar um endpoint, RPC ou campo de query | remover ou renomear um endpoint, RPC ou campo |
| adicionar um campo **opcional** na requisição | adicionar um campo **obrigatório** na requisição |
| adicionar um campo na resposta | remover um campo da resposta, ou mudar seu tipo ou significado (`price` em centavos em vez de reais) |
| aceitar um novo valor de enum *na entrada* | devolver um novo valor de enum que os consumidores não sabem tratar |
| adicionar um novo tipo de evento | mudar o significado de um evento existente |

Mudanças compatíveis dependem de consumidores **leitores tolerantes** (*tolerant readers*): eles ignoram campos que não conhecem (o Jackson faz isso por padrão no Spring Boot — mantenha assim). Cada estilo tem suas próprias regras:

- **REST/JSON**: leitores tolerantes + campos opcionais; mudanças incompatíveis vão para uma nova versão major.
- **Protobuf**: nunca altere nem reutilize uma field tag; ao apagar um campo, marque sua tag como `reserved` para ninguém reutilizá-la; adicionar campos é sempre seguro.
- **GraphQL**: sem versões — adicione campos, deprecie com `@deprecated(reason: …)` e remova quando a telemetria de uso mostrar que ninguém mais os pede.
- **Eventos**: o schema registry verifica a compatibilidade a cada nova versão; eventos antigos ficam no log para sempre, então os consumidores precisam ler todas as versões que já foram escritas.

Quando uma mudança incompatível é inevitável, versione e migre:

| Estratégia | Exemplo | Observações |
|---|---|---|
| Caminho da URI | `/v1/orders` → `/v2/orders` | a mais visível; mais fácil de rotear e testar — a escolha comum |
| Header / media type | `Accept: application/vnd.boxoffice.v2+json` | URLs mais limpas; mais difícil de testar à mão |
| Pacote (gRPC) | `boxoffice.inventory.v1` → `.v2` | as duas versões do serviço podem rodar lado a lado |

Depois, **expanda e contraia** (*parallel change*): publique a v2 ao lado da v1, migre os consumidores, acompanhe o tráfego da v1 cair a zero, anuncie a data com o header `Sunset` (RFC 8594)[^7] e só então remova a v1.

!!! info "Testes de contrato orientados ao consumidor"
    Como saber que uma mudança é compatível antes do deploy? Cada consumidor publica as interações de que depende ("o `order` chama `GET /v1/holds/{id}` e lê `status` e `expiresAt`"); o CI do provedor as executa contra a nova versão e quebra o build se alguma falhar. Ferramentas: **Pact**, **Spring Cloud Contract**. Isso transforma "será que quebramos alguém?" de um incidente em produção num build vermelho.

!!! tip "Na entrevista"

    A etapa de API do framework de entrevista leva de 3 a 5 minutos: liste os **poucos endpoints que importam**, com método, caminho, parâmetros principais e resposta — não o CRUD inteiro. Para o BoxOffice:

    - `GET /v1/events/{id}/availability` → setores e lugares restantes (cacheável por alguns segundos)
    - `POST /v1/events/{id}/holds` `{seats}` + `Idempotency-Key` → `201 {holdId, expiresAt}` ou `409`
    - `POST /v1/orders` `{holdId, paymentToken}` + `Idempotency-Key` → `202 {orderId, status: PENDING}`
    - `GET /v1/orders/{id}` → status

    Mencione **paginação** (cursor), **idempotência** nas escritas, **rate limits**, e diga *por que* escolheu o estilo ("REST na borda pela cacheabilidade e pelos parceiros; gRPC internamente entre order e inventory"). Entrevistadores percebem quando você sabe quais chamadas são repetidas e quais não podem duplicar.

!!! success "Boas práticas"

    - **Publique o contrato a partir do build e faça o CI falhar em mudanças incompatíveis** — gere o documento OpenAPI em todo build e compare com a última versão publicada (oasdiff, openapi-diff): um campo removido quebra o pipeline, não um consumidor. Na BoxOffice: o springdoc publica o documento em `/catalog/openapi` ([lab 1](../../../hands-on/1/api/index.md), quadro acima).
    - **Limite toda coleção** — um tamanho de página padrão e um máximo, recusado com `400` acima do máximo. Na BoxOffice: `size` ≤ 50 no `GET /catalog/events` (lab 1).
    - **Devolva um único formato de erro em todo lugar** — Problem Details da RFC 9457, com uma URI `type` estável na qual os clientes possam decidir, nunca uma mensagem de texto livre que eles precisem interpretar. Na BoxOffice: `spring.mvc.problemdetails.enabled: true` em todo serviço.
    - **Prefira ids opacos e não sequenciais para recursos privados** — um id sequencial revela volume e convida à enumeração dos objetos de outros usuários. Na BoxOffice: as reservas usam UUIDs ([lab 6](../../../hands-on/6/holds/index.md)); os eventos públicos mantêm os ids do banco.
    - **Descontinue com uma data e uma métrica** — anuncie com o cabeçalho `Sunset` (RFC 8594), conte as chamadas por versão e remova a versão antiga quando o tráfego dela chegar a zero, não quando o calendário mandar.

!!! warning "Armadilhas comuns"

    - **Vazar a implementação**: devolver entidades, ids do banco ou nomes internos de enums que você nunca mais vai conseguir mudar.
    - **APIs tagarelas** (*chatty*): uma tela que precisa de 12 chamadas sequenciais fica lenta no mobile; agregue num BFF ou projete recursos mais grossos.
    - **Verbos nas URLs** (`/createOrder`, `/getEvents`): RPC disfarçado de REST; use métodos sobre recursos.
    - **`200 OK` com `{"error": ...}`**: quebra retries, monitoramento e caches — use o status code.
    - **Escritas não idempotentes sem chaves**: um timeout mais um retry é igual a uma cobrança em dobro.
    - **Mudanças incompatíveis silenciosas**: renomear um campo passa nos testes do provedor e quebra todos os consumidores — use testes de contrato.
    - **gRPC atrás de um load balancer L4**: todas as chamadas grudam numa única réplica.

---

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    CON["API = contrato<br/>OpenAPI, proto, schema"] --> REST["REST<br/>público, cacheável"]
    CON --> GRPC["gRPC<br/>interno, alto volume"]
    CON --> GQL["BFF GraphQL<br/>uma tela, muitos serviços"]
    CON --> ASYNC["assíncrono: eventos, filas,<br/>webhooks → Mensageria"]
    REST --> HTTP["status codes, paginação por cursor,<br/>Cache-Control → CDN"]
    REST --> IDEM["idempotency keys<br/>→ Integrações"]
    GRPC --> H2["HTTP/2, streaming, deadlines<br/>→ Protocolos da borda"]
    CON --> EVO["evolução compatível,<br/>testes de contrato"]
    EVO --> VER["mudança incompatível: nova versão,<br/>expandir e contrair"]
    ASYNC --> SCH["schemas de eventos também evoluem<br/>→ Semântica de mensageria"]
```

**Componentes da paleta:** [`app`](../../../reference/components/compute/index.md#app) (todo serviço publica um contrato) · [`client`](../../../reference/components/client/index.md#client) · [`mobile`](../../../reference/components/client/index.md#mobile) (consumidores da API REST e do BFF GraphQL) · [`cdn`](../../../reference/components/edge/index.md#cdn) (cacheia os `GET`s cacheáveis) · [`queue`](../../../reference/components/messaging/index.md#queue) (comandos) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (eventos como `OrderConfirmed`) · [`payment`](../../../reference/components/external/index.md#payment) (chama a BoxOffice de volta por webhook). **Cenários:** `event-fanout`, `payment-system`, `chat` (push do servidor). **Continua em:** [Borda — protocolos](../../edge/protocols/index.md), [Borda — API gateway](../../edge/api-gateway/index.md), [Mensageria — evolução de schema](../../messaging/semantics/index.md#schema-evolution), [Integrações — idempotency keys](../integrations/index.md#idempotency-keys), [Hands-on 1](../../../hands-on/1/index.md).

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - Uma API é um **contrato**; descreva-o de forma legível por máquina (OpenAPI, `.proto`, schema GraphQL, AsyncAPI) e exponha DTOs, não entidades.
    - **REST** para APIs públicas e cacheáveis, **gRPC** para chamadas internas de alto volume, **GraphQL** para front-ends que compõem muitos serviços, **assíncrono** quando quem chama não precisa esperar — sistemas reais misturam todos.
    - Projete REST com métodos e status codes corretos, erros em **Problem Details**, **paginação por cursor**, headers de cache, `202` para operações longas e **chaves de idempotência** para escritas não seguras.
    - Evolua de forma compatível (leitores tolerantes, campos opcionais, nunca reutilizar tags protobuf, `@deprecated`); versione só para mudanças incompatíveis, depois expanda e contraia; pegue as quebras com **testes de contrato**.

---

[^1]: [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110){target="_blank"}. IETF, 2022.
[^2]: FIELDING, R. T. *Architectural Styles and the Design of Network-based Software Architectures*. Tese de doutorado, UC Irvine, 2000.
[^3]: FOWLER, M. [Richardson Maturity Model](https://martinfowler.com/articles/richardsonMaturityModel.html){target="_blank"}. martinfowler.com, 2010.
[^4]: [RFC 9457 — Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457){target="_blank"}. IETF, 2023.
[^5]: [gRPC — Core concepts, architecture and lifecycle](https://grpc.io/docs/what-is-grpc/core-concepts/){target="_blank"}; [Protocol Buffers — Language guide (proto 3)](https://protobuf.dev/programming-guides/proto3/){target="_blank"}.
[^6]: [GraphQL Specification](https://spec.graphql.org/){target="_blank"}; [OpenAPI Specification](https://spec.openapis.org/oas/latest.html){target="_blank"}; [AsyncAPI Specification](https://www.asyncapi.com/docs/reference/specification/latest){target="_blank"}.
[^7]: [RFC 8594 — The Sunset HTTP Header Field](https://www.rfc-editor.org/rfc/rfc8594){target="_blank"}. IETF, 2019.
