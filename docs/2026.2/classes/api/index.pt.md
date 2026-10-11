
A loja tem um front-end web, um aplicativo mobile e um serviço de pedidos, e os três precisam dos dados de produtos mantidos pelo serviço de produtos. Como cada um deles sabe qual URL chamar, o que enviar e o que recebe de volta? E o que acontece com eles quando o time de produtos reescrever o serviço no próximo semestre? A resposta para as duas perguntas é a **API**.

Uma **API** (Application Programming Interface) é um contrato que define como dois componentes de software se comunicam. Ela especifica quais operações estão disponíveis, quais entradas aceitam e quais saídas retornam — sem expor a implementação interna.

No contexto de microsserviços, as APIs são o principal mecanismo de integração: os serviços expõem APIs, os clientes as consomem, e os times evoluem cada lado de forma independente, desde que o contrato seja respeitado. Uma fronteira de API estável significa que a implementação por trás dela pode ser totalmente substituída sem impactar nenhum consumidor.

``` mermaid-sim
flowchart LR
    consumer["Cliente\n(mobile, navegador, serviço)"]
    api["API\n(contrato)"]:::highlighted
    impl["Implementação\n(linguagem, BD, framework)"]

    consumer -->|"requisição"| api
    api -->|"resposta"| consumer
    api -->|"esconde"| impl
    consumer -.-x|"não enxerga"| impl

    classDef highlighted fill:#fcc
```

!!! abstract "Objetivos de aprendizagem"

    Ao final desta aula, você deve ser capaz de:

    - **Explicar** por que um contrato de API estável permite que os times alterem e façam o deploy de serviços de forma independente.
    - **Comparar** APIs REST, gRPC, GraphQL, WebSocket e baseadas em mensagens, e **escolher** uma para uma dada interação.
    - **Projetar** um recurso REST com URIs, métodos HTTP, códigos de status, corpos de erro e paginação corretos.
    - **Distinguir** uma mudança incompatível (breaking change) de uma retrocompatível, e versionar uma API quando necessário.
    - **Documentar** um serviço Spring Boot com OpenAPI e Swagger UI, e **decidir** onde a documentação pode ser exposta.

## Roteiro

1. **Esta página** — o que é um contrato de API, por que ele importa, os principais estilos de API e quão RESTful uma API é.
2. [Design de APIs REST](rest/index.md) — recursos, métodos, idempotência, códigos de status, erros, paginação e versionamento.
3. [OpenAPI & Swagger](swagger/index.md) — descrever o contrato em um documento legível por máquina e servi-lo com o springdoc.

## Slides

<div class="slides-embed">
  <iframe src="slides/api.pt.html" title="Slides: APIs" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/api.pt.html){:target="_blank"}

---

## Por que APIs importam

| Sem uma API estável | Com um contrato de API estável |
|---|---|
| Toda mudança interna corre o risco de quebrar os consumidores | Os consumidores ficam isolados das mudanças de implementação |
| Os times precisam coordenar cada deploy | Os times fazem deploy de forma independente |
| Erros de integração aparecem em tempo de execução | O contrato pode ser testado antes da integração |
| A documentação se desatualiza e fica obsoleta | O contrato é a única fonte da verdade |

### O contrato na nossa plataforma

O hands-on torna o contrato concreto. No [Hands-on 1](../../hands-on/1/index.md), o microsserviço Account é dividido em dois módulos Maven:

| Módulo | Contém | Quem depende dele |
|---|---|---|
| `account` | o **contrato**: a interface `AccountController` (`POST /accounts`, `GET /accounts/{id}`…) e os DTOs `AccountIn` / `AccountOut` | a implementação **e** todos os clientes — o serviço de autenticação chama accounts por meio dele, como um cliente OpenFeign |
| `account-service` | a **implementação**: `AccountResource`, `AccountService`, o modelo JPA `AccountModel` e o repositório | ninguém — ele é privado do time de accounts |

Como o serviço de autenticação ([Hands-on 3](../../hands-on/3/index.md)) depende apenas do módulo `account`, o time de accounts pode mudar livremente o banco de dados, o modelo ou a lógica do serviço. Apenas uma mudança em `AccountController`, `AccountIn` ou `AccountOut` é visível para os outros — e é exatamente essa a mudança que precisa ser negociada e, se quebrar clientes, versionada (veja [Versionamento](rest/index.md#versioning)).

!!! info "Termos usados nesta aula"

    - **Consumidor** (ou cliente): o código que chama a API — um navegador, um aplicativo mobile ou outro serviço.
    - **Provedor**: o serviço que implementa a API.
    - **Endpoint**: uma operação da API, identificada por um método HTTP e um caminho, como `GET /accounts/{id}`.
    - **DTO** (Data Transfer Object): uma classe cuja única função é transportar dados através da fronteira da API — `AccountIn`, `AccountOut`. Ela é deliberadamente diferente da entidade do banco de dados.

---

## Tipos de APIs

| Estilo | Protocolo | Formato | Uso típico |
|---|---|---|---|
| **REST** | HTTP/1.1 ou HTTP/2 | JSON / XML | APIs web públicas e internas — a escolha dominante |
| **gRPC** | HTTP/2 | Protocol Buffers (binário) | Chamadas internas de alto desempenho entre serviços |
| **GraphQL** | HTTP | JSON | Consultas flexíveis guiadas pelo cliente; padrão Backend for Frontend (BFF) |
| **WebSocket** | Protocolo WebSocket (começa como um `Upgrade` HTTP, depois full-duplex sobre TCP) | Qualquer | Comunicação bidirecional em tempo real — chat, feeds ao vivo, colaboração |
| **Baseado em mensagens** | AMQP / protocolo do Kafka | JSON / Avro | Integração assíncrona orientada a eventos entre serviços |

A mesma operação — "me dê o produto 42" — fica bem diferente em cada um dos três estilos de requisição/resposta:

=== "REST"

    ```http
    GET /products/42 HTTP/1.1
    Accept: application/json
    ```

    A **URL identifica o recurso** e o **método HTTP diz o que fazer**. Qualquer cliente HTTP (navegador, `curl`, Postman) consegue chamá-la.

=== "gRPC"

    ```protobuf
    service ProductService {
      rpc GetProduct (GetProductRequest) returns (Product);
    }
    message GetProductRequest { string id = 1; }
    message Product { string id = 1; string name = 2; double price = 3; }
    ```

    O contrato é um arquivo `.proto`; o código é **gerado** para cliente e servidor, e as mensagens trafegam em binário compacto. Chamá-la exige um cliente gRPC — um navegador não consegue chamá-la diretamente.

=== "GraphQL"

    ```graphql
    query {
      product(id: "42") { name price }
    }
    ```

    Um único endpoint (geralmente `POST /graphql`); o **cliente escolhe os campos** que quer, o que evita trazer dados demais (over-fetching) em telas mobile.

**Como escolher.** Para a API pública da loja (navegadores, aplicativos mobile, parceiros), **REST** é o padrão: ferramentas universais, `GET`s cacheáveis, fácil de depurar. **gRPC** compensa em chamadas internas frequentes, em que a latência e o tamanho do payload importam. **GraphQL** se encaixa em um front-end que compõe dados de muitos serviços. **Mensageria** é a escolha quando o produtor não deve esperar pelo consumidor — tema de [Arquitetura Orientada a Eventos](../event_driven/index.md).

### Maturidade REST (Modelo de Richardson)[^3]

Nem todas as APIs HTTP são igualmente RESTful. Leonard Richardson definiu um modelo de maturidade com quatro níveis:

| Nível | Característica | Exemplo |
|---|---|---|
| **0 — Swamp of POX** | Um único endpoint para todas as operações | `POST /service?op=getOrder` |
| **1 — Recursos** | URIs separadas por recurso | `GET /orders/42` |
| **2 — Verbos HTTP** | Uso correto de GET, POST, PUT, DELETE + códigos de status | `DELETE /orders/42` → `204` |
| **3 — Hipermídia (HATEOAS)** | As respostas incluem links para as próximas ações possíveis | `"links": [{"rel": "cancel", "href": "/orders/42/cancel"}]` |

*POX* significa "Plain Old XML": a requisição HTTP é só um túnel para uma chamada de procedimento remoto. *HATEOAS* significa "Hypermedia As The Engine Of Application State": o cliente descobre o que pode fazer em seguida a partir dos links na resposta, como uma pessoa faz ao navegar em um site.

A maioria das APIs REST em produção opera no nível 2. O nível 3 é raro na prática, tanto em microsserviços internos quanto em APIs públicas; a API REST do PayPal é um exemplo conhecido que retorna `links` com `rel` e `href` nas respostas.

Este curso foca em **REST nível 2** e na documentação de APIs com **OpenAPI / Swagger**.

!!! warning "Armadilhas comuns ao projetar uma API"

    - **Vazar a implementação**: retornar a entidade JPA diretamente expõe colunas como o hash da senha e amarra o contrato ao esquema do banco de dados. Use DTOs (`AccountOut` não tem senha).
    - **APIs "tagarelas" (chatty)**: uma tela que precisa de dez chamadas para ser renderizada fica lenta através da rede; projete os recursos em torno do que os consumidores precisam.
    - **Mudanças incompatíveis silenciosas**: renomear um campo JSON é invisível para os testes do próprio provedor, mas quebra todos os consumidores. Trate o contrato como público — veja [Versionamento](rest/index.md#versioning).
    - **RPC disfarçado de REST**: verbos na URL (`/createOrder`) colocam a API no nível 0–1 de Richardson.

---

## Tópicos abordados

<div class="grid cards" markdown>

-   :material-api:{ .lg .middle } **Design de APIs REST**

    ---

    Métodos HTTP, códigos de status, convenções de URL, estrutura de requisição e resposta, versionamento e os princípios de design que tornam as APIs previsíveis e fáceis de consumir.

    [:octicons-arrow-right-24: Design de APIs REST](rest/index.md)

-   :material-file-document-outline:{ .lg .middle } **OpenAPI & Swagger**

    ---

    Documentação de APIs com a especificação OpenAPI. Integração do Swagger UI a um serviço Spring Boot para que a documentação da API esteja sempre sincronizada com o código.

    [:octicons-arrow-right-24: OpenAPI & Swagger](swagger/index.md)

</div>

---

## Pontos-chave

- Uma API é um **contrato**: os consumidores dependem dele, nunca da implementação por trás dele.
- No hands-on, o contrato é um módulo separado (`account`: interface + DTOs) da implementação (`account-service`).
- REST sobre HTTP é o padrão para APIs web; gRPC, GraphQL, WebSocket e mensageria resolvem necessidades específicas.
- A maioria das APIs está no **nível 2** de Richardson: recursos + métodos HTTP + códigos de status. REST foi definido por Roy Fielding[^2] sobre a semântica do HTTP[^1].
- Nunca exponha entidades; mudar um DTO é mudar o contrato.

## Conexões

- Construa o contrato e sua implementação: [Hands-on 1 — CRUD](../../hands-on/1/index.md).
- Encaminhe clientes externos para as APIs: [Hands-on 2 — Gateway](../../hands-on/2/index.md).
- Projete suas próprias APIs: exercícios [Product API](../../exercises/product/index.md) e [Order API](../../exercises/order/index.md).
- APIs assíncronas: [Arquitetura Orientada a Eventos](../event_driven/index.md). Como os serviços se encaixam: [Microsserviços](../microservices/index.md).

---

[^1]: [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110){:target="_blank"}
[^2]: FIELDING, R. T. *Architectural Styles and the Design of Network-based Software Architectures*. Tese de doutorado, UC Irvine, 2000. (Definição original de REST.)
[^3]: FOWLER, M. [Richardson Maturity Model](https://martinfowler.com/articles/richardsonMaturityModel.html){:target="_blank"}. martinfowler.com, 2010.
