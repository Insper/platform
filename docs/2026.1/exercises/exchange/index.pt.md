
O próximo passo é criar uma API que permita aos usuários converter valores entre moedas. A API deve usar um serviço de terceiros para obter as taxas de câmbio. Note que este microsserviço **deve** ser implementado em Python.

``` mermaid
flowchart LR
    subgraph api [Camada confiável]
        gateway --> account
        gateway --> auth
        account --> db@{ shape: cyl, label: "Banco de dados" }
        auth --> account
        gateway e1@==> exchange:::red
        gateway --> product
        gateway --> order
        product --> db
        order --> db
        order --> product
    end
    exchange e3@==> 3partyapi:::green@{label: "API de terceiros"}
    internet e2@==>|requisição| gateway
    e1@{ animate: true }
    e2@{ animate: true }
    e3@{ animate: true }
    classDef red fill:#fcc
    classDef green fill:#cfc
    click product "#product-api" "Product API"
```

!!! warning "Atenção"

    **Para consumir a API, o usuário deve estar autenticado.**


Usando FastAPI[^1] (ou outro framework) em Python :material-information-outline:{ title="Python é obrigatório!" }, crie uma API REST que permita aos usuários converter valores entre moedas. A API deve expor o seguinte endpoint:

!!! info "GET /exchanges/{from}/{to}"

    Obtém a taxa de câmbio atual de uma moeda para outra. Ex.: `GET /exchange/USD/EUR`.

    === "Resposta"

        ``` { .json .copy .select linenums='1' }
        {
            "sell": 0.82,
            "buy": 0.80,
            "date": "2021-09-01 14:23:42",
            "id-account": "0195ae95-5be7-7dd3-b35d-7a7d87c404fb"
        }
        ```
        ```bash
        Response code: 200 (ok)
        ```

A API deve depender de um serviço de terceiros para obter as taxas de câmbio. Você pode usar o plano gratuito de qualquer um dos seguintes, por exemplo:

- [AwesomeAPI](https://github.com/awesomeapibrasil/economy-api){target="_blank"};
- [ExchangeRate-API](https://www.exchangerate-api.com/){target="_blank"};
- [Open Exchange Rates](https://openexchangerates.org/){target="_blank"};
- [CurrencyLayer](https://currencylayer.com/){target="_blank"};
- qualquer outra API.

Ou, você pode fazer scraping dos dados de um site.

!!! tip "Dica"

    Você pode usar a biblioteca `requests` para fazer requisições HTTP à API de terceiros.


---

!!! danger "Entrega"

    Individualmente, cada aluno deve criar um repositório no GitHub, com a documentação em MkDocs dos exercícios realizados e também com o projeto e entregar o link via Blackboard. Na documentação publicada deve constar:

    - Nome do aluno e grupo;
    - Documentação das atividades realizadas;
    - Código fonte das atividades realizadas;
    - Documentação do projeto;
    - Código fonte do projeto;
    - Link para todos os repositórios utilizados;
    - Destaques para os bottlenecks implementados (ao menos 2 por indivíduo);
    - Apresentação do projeto;
    - Vídeo de apresentação do projeto (2-3 minutos);
    
    Um template de documentação pode ser encontrado em [Template de Documentação](https://hsandmann.github.io/documentation.template/){target="_blank"}.




[^1]: [FastAPI - First Steps](https://fastapi.tiangolo.com/tutorial/first-steps/){target="_blank"}.