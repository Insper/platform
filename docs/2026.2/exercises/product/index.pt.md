
Construa uma API RESTful para uma loja online. A API é organizada em torno de dois recursos principais: `product` e `order`.


``` mermaid-sim
flowchart LR
    subgraph api [Camada confiável]
        gateway --> account
        gateway --> auth
        account --> db@{ shape: cyl, label: "Banco de dados" }
        auth --> account
        gateway e5@==> product:::red
        gateway e6@==> order
        product e2@==> db
        order e3@==> db
        order e4@==> product
    end
    internet e1@==>|requisição| gateway
    e1@{ animate: true }
    e2@{ animate: true }
    e3@{ animate: true }
    e4@{ animate: true }
    e5@{ animate: true }
    e6@{ animate: true }
    classDef red fill:#fcc
    click product "#product-api" "API de produtos"
```

!!! warning "Atenção"

    **Para consumir a API, o usuário precisa estar autenticado.**

## API de produtos { #product-api }

A API de produtos deve expor os seguintes endpoints:

!!! info "POST /products"

    Cria um novo produto.

    === "Requisição"

        ``` { .json .copy .select linenums='1' }
        {
            "name": "Tomato",
            "price": 10.12,
            "unit": "kg"
        }
        ```

    === "Resposta"

        ``` { .json .copy .select linenums='1' }
        {
            "id": "0195abfb-7074-73a9-9d26-b4b9fbaab0a8",
            "name": "Tomato",
            "price": 10.12,
            "unit": "kg"
        }
        ```
        ```bash
        Response code: 201 (created)
        ```

!!! info "GET /products"

    Obtém todos os produtos.

    === "Resposta"

        ``` { .json .copy .select linenums='1' }
        [
            {
                "id": "0195abfb-7074-73a9-9d26-b4b9fbaab0a8",
                "name": "Tomato",
                "price": 10.12,
                "unit": "kg"
            },
            {
                "id": "0195abfe-e416-7052-be3b-27cdaf12a984",
                "name": "Cheese",
                "price": 0.62,
                "unit": "slice"
            }
        ]
        ```
        ```bash
        Response code: 200 (ok)
        ```

!!! info "GET /products/{id}"

    Obtém um produto pelo seu ID.

    === "Resposta"

        ``` { .json .copy .select linenums='1' }
        {
            "id": "0195abfb-7074-73a9-9d26-b4b9fbaab0a8",
            "name": "Tomato",
            "price": 10.12,
            "unit": "kg"
        }
        ```
        ```bash
        Response code: 200 (ok)
        ```

!!! info "DELETE /products/{id}"

    Exclui um produto pelo seu ID.

    ```bash
    Response code: 204 (no content)
    ```

## Adicionais

Funcionalidades adicionais são bem-vindas, como:

- Busca de produtos por nome (com "like");
- Autorização por papel (admin, user):
    * Admin pode criar, atualizar e excluir produtos;
    * User pode apenas criar pedidos;
- Validação das entradas;
- Tratamento de erros.

## Desejável

- Observabilidade (métricas, logs), veja [Prometheus](https://prometheus.io/){target="_blank"} e [Grafana](https://grafana.com/){target="_blank"};
- Banco de dados em memória (sugestão: microsserviço de produtos), veja [Redis](https://redis.io/){target="_blank"};
- Documentação Swagger, veja [SpringDoc](https://springdoc.org/){target="_blank"}.
