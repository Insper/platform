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

**Um contrato que permite que cada lado evolua por conta própria**

<!--
Roteiro: (1) o que é um contrato de API, na nossa plataforma; (2) estilos de API e o modelo de Richardson;
(3) REST: recursos, métodos, chaves de idempotência, códigos de status, Problem Details, paginação, versionamento;
(4) documentos OpenAPI e Swagger UI com springdoc.
-->

---

## Troque tudo o que está por trás

<div class="q">

O time reescreve o serviço de produtos: nova linguagem, novo banco de dados, novo framework.
Quais clientes quebram?

</div>

* **Nenhum** — desde que o **contrato** seja respeitado.
* Uma API define as **operações**, suas **entradas** e **saídas** — e esconde a implementação.
* No hands-on: módulo `account` = o contrato (`AccountController` + `AccountIn`/`AccountOut`); `account-service` = a implementação privada.
* Mudar um **DTO** é mudar o contrato: nunca retorne o modelo JPA.

---

## Tipos de APIs

| Estilo | Protocolo | Formato | Uso típico |
|---|---|---|---|
| **REST** | HTTP/1.1, HTTP/2 | JSON / XML | APIs web públicas e internas — o padrão |
| **gRPC** | HTTP/2 | Protocol Buffers | chamadas internas rápidas entre serviços |
| **GraphQL** | HTTP | JSON | o cliente escolhe os campos; Backend for Frontend |
| **WebSocket** | `Upgrade` HTTP, depois full-duplex | qualquer | tempo real: chat, feeds ao vivo |
| **Mensagens** | AMQP / Kafka | JSON / Avro | integração assíncrona, orientada a eventos |

<p class="small">Mesma pergunta, três formas: <code>GET /products/42</code> · <code>rpc GetProduct(GetProductRequest)</code> · <code>query { product(id: "42") { name price } }</code></p>

---

## Quão RESTful? O modelo de Richardson

| Nível | Característica | Exemplo |
|---|---|---|
| **0 — Swamp of POX** | um endpoint para tudo | `POST /service?op=getOrder` |
| **1 — Recursos** | uma URI por recurso | `GET /orders/42` |
| **2 — Verbos HTTP** | métodos certos + códigos de status | `DELETE /orders/42` → `204` |
| **3 — Hipermídia** | respostas com links para as próximas ações (HATEOAS) | `"rel": "cancel"` |

<div class="ok">

A maioria das APIs em produção está no **nível 2** — o foco deste curso, documentado com **OpenAPI / Swagger**.

</div>

---

<!-- _class: tight -->

## REST: recursos, representações, restrições

Um **recurso** tem uma URI (`/products/42`); os clientes trocam **representações** dele (JSON).

| Restrição | Significado |
|---|---|
| **Client-Server** | interface e armazenamento são responsabilidades separadas |
| **Stateless** | cada requisição leva tudo — o JWT vai em toda chamada |
| **Cacheable** | as respostas declaram se podem ir para o cache |
| **Uniform Interface** | URIs + métodos padrão + mensagens autodescritivas |
| **Layered System** | o cliente não distingue o servidor de um gateway ou balanceador de carga |
| **Code on Demand** | opcional: o servidor pode enviar código (JavaScript) |

<!--
Stateless + camadas é o que permite ao Nginx mandar cada requisição para qualquer réplica do gateway (hands-on 7).
-->

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
- Aninhe para indicar posse: `/users/7/orders`
- No máximo 2–3 níveis de aninhamento
- Filtros, ordenação, páginas → parâmetros de **query**

</div>
</div>

---

## Métodos HTTP

| Método | Idempotente | Seguro | Uso |
|---|---|---|---|
| `GET` | ✅ | ✅ | ler um recurso ou uma coleção |
| `POST` | ❌ | ❌ | criar — o servidor atribui o ID |
| `PUT` | ✅ | ❌ | substituir o recurso inteiro |
| `PATCH` | ❌ | ❌ | atualização parcial |
| `DELETE` | ✅ | ❌ | remover |

- **Seguro**: não muda o estado do servidor. **Idempotente**: repetir tem o mesmo **efeito** que chamar uma vez.
- Um segundo `DELETE /products/42` retorna `404` — ainda idempotente: o estado é o mesmo.

<!--
Pergunte: um cliente tem timeout em POST /orders. Ele pode simplesmente repetir? Por que o PUT é diferente?
-->

---

## Repetindo um `POST`: chaves de idempotência

<div class="q">

`POST /orders` deu timeout. O pedido foi criado? Repetir e arriscar uma duplicata, ou desistir e arriscar perdê-lo?

</div>

* O cliente envia uma **`Idempotency-Key`** única (um UUID) por operação lógica.
* O servidor armazena as chaves processadas junto com o resultado.
* Uma repetição com a **mesma chave** devolve o resultado armazenado — **sem duplicata**.
* É o mesmo mecanismo da API de pagamentos da Stripe; retries e backoff → Padrões de Resiliência.

---

<!-- _class: tight -->

## Códigos de status: use o certo

<div class="cols3">
<div>

### 2xx — sucesso

- `200 OK`
- `201 Created` + `Location`
- `202 Accepted` (assíncrono)
- `204 No Content`

</div>
<div>

### 4xx — erro do cliente

- `400` requisição malformada
- `401` sem token / token inválido
- `403` token válido, sem permissão
- `404` não encontrado
- `409` conflito, duplicata
- `422` regra de negócio violada
- `429` limite de taxa excedido

</div>
<div>

### 5xx — erro do servidor

- `500` não tratado — **sem stack traces**
- `502` resposta inválida atrás do gateway
- `503` fora do ar ou sobrecarregado
- `504` sem resposta atrás do gateway

</div>
</div>

<div class="warn">

`401` significa "quem é você?"; `403` significa "eu sei quem você é, e a resposta é não".

</div>

---

## Requisição e resposta

<div class="cols">
<div>

```http
POST /products HTTP/1.1
Content-Type: application/json

{
  "name": "Tomato",
  "price": 10.12,
  "unit": "kg"
}
```

</div>
<div>

```http
HTTP/1.1 201 Created
Location: /products/0195abfb-...

{
  "id": "0195abfb-...",
  "name": "Tomato",
  "price": 10.12,
  "unit": "kg"
}
```

</div>
</div>

<p class="small">Spring: <code>ResponseEntity.created(uri).body(out)</code> define tanto o <code>201</code> quanto o <code>Location</code>; <code>@ResponseStatus(CREATED)</code> não consegue definir o cabeçalho.</p>

---

## Erros com formato padrão: Problem Details

RFC 9457, media type `application/problem+json`:

```json
{
  "type": "https://store.example.com/problems/out-of-stock",
  "title": "Product out of stock",
  "status": 422,
  "detail": "Product 101 is out of stock",
  "instance": "/orders"
}
```

<p class="small">No Spring Boot: <code>@RestControllerAdvice</code> + <code>@ExceptionHandler</code> retornando um <code>ProblemDetail</code>; <code>spring.mvc.problemdetails.enabled: true</code> para os erros do próprio framework.</p>

---

## Paginação e versionamento

<div class="cols">
<div>

### Nunca retorne coleções ilimitadas

- Offset: `?page=2&size=20` — simples, lento em tabelas grandes
- Cursor: `?after=eyJpZCI6NDJ9` — usa o índice, sem deslocar páginas
- Filtre no **servidor**: `?status=PENDING`
- No Spring Data, as páginas começam em **0**

</div>
<div>

### Versione nas mudanças incompatíveis

- **Caminho da URI**: `/v1/orders` — o mais comum, fácil de testar
- **Cabeçalho**: `Accept: application/vnd.myapi.v2+json`
- **Query param**: `?version=2` — evite, não é um filtro
- Rode `v1` e `v2` lado a lado, depois aposente a `v1`

</div>
</div>

---

## Incompatível ou não?

| Retrocompatível | Incompatível → nova versão |
|---|---|
| adicionar um endpoint | remover ou renomear um endpoint |
| adicionar um campo **opcional** na requisição | adicionar um campo **obrigatório** na requisição |
| adicionar um campo na resposta | remover ou renomear um campo da resposta |
| aceitar um novo valor de entrada | mudar tipo ou significado (centavos vs. reais) |

<div class="ok">

Os clientes são **leitores tolerantes**: ignoram campos que não conhecem. Prefira mudanças compatíveis; versione só quando for preciso.

</div>

---

<!-- _class: tight -->

## OpenAPI: o contrato como documento

```yaml
openapi: 3.1.0
info: { title: Product Service API, version: 1.0.0 }
paths:
  /products/{id}:
    get:
      summary: Find a product by ID
      responses:
        "200":
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ProductOut" }
        "404": { description: Product not found }
components:
  schemas: { ProductOut: { type: object } }
```

- **Code-first** (este curso): o springdoc o gera a partir do código Java. **Contract-first**: escreva o YAML, gere o código.
- *Swagger* = o nome antigo da especificação; hoje, as ferramentas (Swagger UI, Editor).

---

<!-- _class: tight -->

## springdoc e Swagger UI

- Dependência `org.springdoc:springdoc-openapi-starter-webmvc-ui` — **3.0.x para o Spring Boot 4**, 2.8.x para o Boot 3.
- `/swagger-ui.html` (interativo) · `/v3/api-docs` (JSON) · `/v3/api-docs.yaml`
- Descreva com `@Tag`, `@Operation`, `@ApiResponse` e `@Schema(description, example)` nos records de DTO.
- JWT: um esquema de segurança `bearerAuth` no bean `OpenAPI` → botão **Authorize**.
- Na nossa plataforma, o gateway resolve o JWT; teste um serviço diretamente com o cabeçalho `id-account`.

```yaml
# application-prod.yml
springdoc:
  api-docs: { enabled: false }
  swagger-ui: { enabled: false }
```

<div class="warn">

Swagger UI em produção **documenta toda a sua superfície de ataque**.

</div>

---

## Pontos-chave

1. Uma API é um **contrato**: os consumidores dependem dele, nunca da implementação (`account` vs `account-service`).
2. A maioria das APIs está no **nível 2** de Richardson: recursos + verbos HTTP + códigos de status.
3. Saiba o que é **seguro** (`GET`) e **idempotente** (`GET`, `PUT`, `DELETE`); torne o `POST` seguro para repetir com uma **chave de idempotência**.
4. Retorne o **código de status certo** e os erros como **Problem Details**.
5. Pagine as coleções; prefira **mudanças compatíveis** e versione as incompatíveis com **`/v2/`**.
6. Um documento **OpenAPI** descreve o contrato; o **springdoc** gera o documento e o Swagger UI a partir do código — desligue-o em produção.
