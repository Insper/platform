
Com a API de produtos pronta, o próximo passo é implementar a API de pedidos. Os pedidos estão vinculados a usuários autenticados e fazem referência a produtos existentes.

``` mermaid-sim
flowchart LR
    subgraph api [Camada confiável]
        gateway --> account
        gateway --> auth
        account --> db@{ shape: cyl, label: "Banco de dados" }
        auth --> account
        gateway e5@==> product
        gateway e6@==> order:::red
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
    click order "#order-api" "API de pedidos"
```

!!! warning "Atenção"

    **Para consumir a API, o usuário precisa estar autenticado.**


## API de pedidos { #order-api }

!!! info "POST /orders"

    Cria um novo pedido **para o usuário atual**.

    === "Requisição"

        ``` { .json .copy .select linenums='1' }
        {
            "items": [
                {
                    "idProduct": "0195abfb-7074-73a9-9d26-b4b9fbaab0a8",
                    "quantity": 2
                },
                {
                    "idProduct": "0195abfe-e416-7052-be3b-27cdaf12a984",
                    "quantity": 1
                }
            ]
        }
        ```

    === "Resposta"

        ``` { .json .copy .select linenums='1' }
        {
            "id": "0195ac33-73e5-7cb3-90ca-7b5e7e549569",
            "date": "2025-09-01T12:30:00",
            "items": [
                {
                    "id": "01961b9a-bca2-78c4-9be1-7092b261f217",
                    "product": {
                        "id": "0195abfb-7074-73a9-9d26-b4b9fbaab0a8"
                    },
                    "quantity": 2,
                    "total": 20.24
                },
                {
                    "id": "01961b9b-08fd-76a5-8508-cdb6cd5c27ab",
                    "product": {
                        "id": "0195abfe-e416-7052-be3b-27cdaf12a984"
                    },
                    "quantity": 10,
                    "total": 6.2
                }
            ],
            "total": 26.44
        }
        ```
        ```bash
        Response code: 201 (created)
        Response code: 400 (bad request), if the product does not exist.
        ```

!!! info "GET /orders"

    Obtém todos os pedidos **do usuário atual**.

    === "Resposta"

        ``` { .json .copy .select linenums='1' }
        [
            {
                "id": "0195ac33-73e5-7cb3-90ca-7b5e7e549569",
                "date": "2025-09-01T12:30:00",
                "total": 26.44
            },
            {
                "id": "0195ac33-cbbd-7a6e-a15b-b85402cf143f",
                "date": "2025-10-09T03:21:57",
                "total": 18.6
            }
            
        ]
        ```
        ```bash
        Response code: 200 (ok)
        ```

!!! info "GET /orders/{id}"

    Obtém os detalhes de um pedido pelo seu ID. **O pedido deve pertencer ao usuário atual**; caso contrário, retorne um `404`.

    Um parâmetro de query opcional, `currency`, permite que os totais sejam retornados em outra moeda. Quando omitido, os valores são retornados em USD (a moeda em que estão armazenados no banco de dados).

    !!! warning "Moeda de armazenamento"

        Todos os valores monetários são armazenados no banco de dados em **dólares americanos (USD)**. Quando o parâmetro `currency` for informado, o serviço deve chamar a API de câmbio (Exchange API) para converter os totais antes de retornar a resposta.

        !!! tip "Openfeign"

        Se você estiver usando Spring Boot, pode aproveitar o [OpenFeign](https://spring.io/projects/spring-cloud-openfeign){target="_blank"} para criar um cliente REST declarativo para a API de câmbio. Assim, você integra facilmente a lógica de conversão de moedas à sua API de pedidos, sem tratar manualmente as requisições e respostas HTTP.

    === "Resposta (USD, padrão)"

        ``` { .json .copy .select linenums='1' }
        {
            "id": "0195ac33-73e5-7cb3-90ca-7b5e7e549569",
            "date": "2025-09-01T12:30:00",
            "currency": "USD",
            "items": [
                {
                    "id": "01961b9a-bca2-78c4-9be1-7092b261f217",
                    "product": {
                        "id": "0195abfb-7074-73a9-9d26-b4b9fbaab0a8",
                    },
                    "quantity": 2,
                    "total": 20.24
                },
                {
                    "id": "01961b9b-08fd-76a5-8508-cdb6cd5c27ab",
                    "product": {
                        "id": "0195abfe-e416-7052-be3b-27cdaf12a984",
                    },
                    "quantity": 10,
                    "total": 6.2
                }
            ],
            "total": 26.44
        }
        ```
        ```bash
        Response code: 200 (ok)
        Response code: 404 (not found), if the order does not belong to the current user.
        ```

    === "Resposta (?currency=BRL)"

        ``` { .json .copy .select linenums='1' }
        {
            "id": "0195ac33-73e5-7cb3-90ca-7b5e7e549569",
            "date": "2025-09-01T12:30:00",
            "currency": "BRL",
            "items": [
                {
                    "id": "01961b9a-bca2-78c4-9be1-7092b261f217",
                    "product": {
                        "id": "0195abfb-7074-73a9-9d26-b4b9fbaab0a8",
                    },
                    "quantity": 2,
                    "total": 121.44
                },
                {
                    "id": "01961b9b-08fd-76a5-8508-cdb6cd5c27ab",
                    "product": {
                        "id": "0195abfe-e416-7052-be3b-27cdaf12a984",
                    },
                    "quantity": 10,
                    "total": 37.20
                }
            ],
            "total": 158.64
        }
        ```
        ```bash
        Response code: 200 (ok)
        Response code: 404 (not found), if the order does not belong to the current user.
        Response code: 422 (unprocessable entity), if the currency code is not supported.
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
