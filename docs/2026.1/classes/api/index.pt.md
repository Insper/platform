
Uma **API** (Application Programming Interface, ou interface de programação de aplicações) é um contrato que define como dois componentes de software se comunicam. Ela especifica quais operações estão disponíveis, quais entradas aceitam e quais saídas retornam — sem expor a implementação interna.

No contexto de microsserviços, as APIs são o principal mecanismo de integração: os serviços expõem APIs, os clientes as consomem, e os times evoluem cada lado de forma independente, desde que o contrato seja respeitado. Uma fronteira de API estável significa que a implementação por trás dela pode ser completamente substituída sem impactar nenhum consumidor.

``` mermaid
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

---

## Por que as APIs importam

| Sem uma API estável | Com um contrato de API estável |
|---|---|
| Toda mudança interna corre o risco de quebrar os consumidores | Os consumidores ficam isolados das mudanças de implementação |
| Os times precisam coordenar cada deploy | Os times fazem deploy de forma independente |
| Erros de integração aparecem em tempo de execução | O contrato pode ser testado antes da integração |
| A documentação se desatualiza | O contrato é a única fonte da verdade |

---

## Tipos de APIs

| Estilo | Protocolo | Formato | Uso típico |
|---|---|---|---|
| **REST** | HTTP/1.1 ou HTTP/2 | JSON / XML | APIs web públicas e internas — a escolha dominante |
| **gRPC** | HTTP/2 | Protocol Buffers (binário) | Chamadas internas de alto desempenho entre serviços |
| **GraphQL** | HTTP | JSON | Consultas flexíveis guiadas pelo cliente; padrão Backend for Frontend (BFF) |
| **WebSocket** | TCP (full-duplex) | Qualquer | Comunicação bidirecional em tempo real — chat, feeds ao vivo, colaboração |
| **Baseado em mensagens** | AMQP / Kafka | JSON / Avro | Integração assíncrona orientada a eventos entre serviços |

### Maturidade REST (modelo de Richardson)[^3]

Nem todas as APIs HTTP são igualmente RESTful. Leonard Richardson definiu um modelo de maturidade com quatro níveis:

| Nível | Característica | Exemplo |
|---|---|---|
| **0 — Swamp of POX** | Um único endpoint para todas as operações | `POST /service?op=getOrder` |
| **1 — Recursos** | URIs separadas por recurso | `GET /orders/42` |
| **2 — Verbos HTTP** | Uso correto de GET, POST, PUT, DELETE + códigos de status | `DELETE /orders/42` → `204` |
| **3 — Hipermídia (HATEOAS)** | As respostas incluem links para as próximas ações possíveis | `"links": [{"rel": "cancel", "href": "/orders/42/cancel"}]` |

A maioria das APIs REST de produção opera no nível 2. O nível 3 é raro em microsserviços, mas comum em APIs públicas.

Este curso se concentra no **REST de nível 2** e na documentação de APIs com **OpenAPI / Swagger**.

---

## Tópicos abordados

<div class="grid cards" markdown>

-   :material-api:{ .lg .middle } **Design de APIs REST**

    ---

    Métodos HTTP, códigos de status, convenções de URL, estrutura de requisição e resposta, versionamento e os princípios de design que tornam as APIs previsíveis e fáceis de consumir.

    [:octicons-arrow-right-24: Design de APIs REST](rest/index.md)

-   :material-file-document-outline:{ .lg .middle } **OpenAPI e Swagger**

    ---

    Documentação de APIs com a especificação OpenAPI. Integração do Swagger UI a um serviço Spring Boot para que a documentação da API esteja sempre sincronizada com o código.

    [:octicons-arrow-right-24: OpenAPI e Swagger](swagger/index.md)

</div>

---

[^1]: [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110){:target="_blank"}
[^2]: FIELDING, R. T. *Architectural Styles and the Design of Network-based Software Architectures*. Tese de doutorado, UC Irvine, 2000. (Definição original do REST.)
[^3]: FOWLER, M. [Richardson Maturity Model](https://martinfowler.com/articles/richardsonMaturityModel.html){:target="_blank"}. martinfowler.com, 2010.
