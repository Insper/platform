
A principal função do microsserviço Gateway é rotear as requisições recebidas para o microsserviço adequado; por isso, ele é o ponto de entrada de todas as requisições. Sem ele, cada microsserviço teria de expor a sua própria porta e os seus endpoints para a internet, o que não é uma boa prática. O microsserviço Gateway atua como um proxy reverso e roteia as requisições recebidas para o microsserviço adequado. Além disso, ele também cuida da autenticação e da autorização das requisições recebidas.

``` mermaid-sim
flowchart LR
    subgraph api [Camada confiável]
        gateway e2@==> account
        gateway e4@==> others["outros"]
        account --> db@{ shape: cyl, label: "Banco de dados" }
        others --> db
    end
    internet e1@==>|requisição| gateway
    e1@{ animate: true }
    e2@{ animate: true }
    e4@{ animate: true }
```

Vantagens de usar um microsserviço Gateway:

- Ele oferece um único ponto de entrada para todas as requisições, o que facilita gerenciar e proteger a aplicação;
- Apenas uma porta precisa ser exposta para a internet, o que facilita proteger a aplicação;
- Ele pode cuidar de:
    - A autenticação e a autorização das requisições recebidas, o que facilita proteger a aplicação;
    - O balanceamento de carga das requisições recebidas, o que facilita escalar a aplicação;
    - O cache das requisições recebidas, o que ajuda a melhorar o desempenho da aplicação;
    - O log e o monitoramento das requisições recebidas, o que facilita depurar e investigar problemas da aplicação;
    - A limitação de taxa (rate limiting) das requisições recebidas, o que ajuda a proteger a aplicação de ataques DDoS;

As principais funcionalidades do microsserviço Gateway são:

- **Roteamento**: ele roteia as requisições recebidas para o microsserviço adequado.
- **Autenticação/Autorização**: ele cuida da autenticação e da autorização das requisições recebidas.


## Slides

<div class="slides-embed">
  <iframe src="slides/gateway.html" title="Slides: hands-on 2 — gateway" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/gateway.html){:target="_blank"}

## Gateway-Service

``` tree
api
    gateway-service/
        src/
            main/
                java/
                    store/
                        gateway/
                            GatewayServiceApplication.java
                            GatewayResource.java
                resources/
                    application.yaml
        pom.xml
        Dockerfile
    .env
    compose.yaml
```

!!! info "Código-fonte"

    === "pom.xml"

        ``` { .yaml .copy .select linenums="1" hl_lines="23-30" }
        --8<-- "docs/2026.2/hands-on/2/code/pom.xml"
        ```

    === "application.yaml"

        ``` { .yaml .copy .select linenums="1" hl_lines="5-32" }
        --8<-- "docs/2026.2/hands-on/2/code/application.yaml"
        ```

    === "GatewayServiceApplication.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "docs/2026.2/hands-on/2/code/GatewayServiceApplication.java"
        ```

    === "GatewayResource.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "docs/2026.2/hands-on/2/code/GatewayResource.java"
        ```

    === "Dockerfile"

        ``` { .dockerfile .copy .select linenums="1" }
        --8<-- "docs/2026.2/hands-on/2/code/Dockerfile"
        ```

Observe que o microsserviço Gateway é implementado com o Spring Cloud Gateway, uma biblioteca que oferece uma forma simples e eficaz de rotear as requisições recebidas para o microsserviço adequado. Ela também oferece muitos recursos, como autenticação, autorização, balanceamento de carga, cache, log, monitoramento e limitação de taxa (rate limiting).

Além disso, o microsserviço Gateway é implementado com WebFlux, um modelo de programação reativa que permite tratar um grande número de requisições concorrentes com um número pequeno de threads. Isso facilita escalar a aplicação e melhorar o seu desempenho.

Tudo o que o gateway lê fica sob `spring.cloud.gateway.server.webflux` — o prefixo do Spring Cloud Gateway 5 (Spring Cloud 2025.1); uma chave deixada diretamente sob `spring.cloud.gateway` é ignorada sem aviso:

| Chave | O que faz |
| --- | --- |
| `routes` | Cada rota tem um `id`, uma `uri` e um predicado `Path`: `/accounts/**` vai para `http://account:8080`, o nome do serviço do microsserviço account no Compose. |
| `globalcors` | Compartilhamento de recursos entre origens (CORS, *Cross-Origin Resource Sharing*) para todos os caminhos, configurado uma única vez. As origens permitidas vêm de `CORS_ALLOWED_ORIGINS`, com os front-ends locais como padrão; `allowCredentials: true` permite que o navegador envie cookies (o token do [hands-on 3](../3/index.md)) — por isso as origens são listadas e não `*`. |
| `default-filters` | Filtros aplicados a todas as rotas. `RemoveRequestHeader=id-account` descarta qualquer cabeçalho `id-account` enviado pelo cliente, para que só o gateway possa defini-lo (hands-on 3); `DedupeResponseHeader` remove os cabeçalhos de CORS duplicados quando um serviço também os define. |

A cada requisição, o gateway confere primeiro o próprio endpoint e depois as rotas **na ordem do arquivo**; o primeiro predicado `Path` que casa vence e o caminho inteiro segue para a `uri` da rota:

``` mermaid-sim
flowchart TB
    req["requisição para localhost:8080"] e1@--> own{"GET /health-check?"}
    own e2@-->|"sim"| gr["GatewayResource\nresponde o hostname"]
    own e3@-->|"não"| r1{"insper-service\nPath=/insper/**"}
    r1 -->|"casa"| insper["https://www.insper.edu.br\n+ o caminho inteiro"]
    r1 e4@-->|"não"| r2{"account-service\nPath=/accounts/**"}
    r2 e5@-->|"casa"| acc["http://account:8080\n+ o caminho inteiro"]
    r2 -->|"não"| nf["404 Not Found"]
```

Um predicado é um padrão, não um prefixo: `/accounts/**` casa com `/accounts` e com tudo sob `/accounts/`, mas não com `/account` nem com `/accountsX`. Depois que uma rota casa, a verificação de CORS e os filtros padrão rodam antes de a requisição sair:

``` mermaid-sim
sequenceDiagram
    participant C as cliente
    participant G as gateway :8080
    participant A as account :8080
    C->>G: GET /accounts (Origin, id-account: 1)
    G->>G: rotas em ordem: account-service casa
    G->>G: CORS: a Origin é permitida?
    G->>G: filtros padrão: descarta id-account
    G->>A: GET http://account:8080/accounts
    A-->>G: 200 OK (lista vazia)
    G-->>C: 200 OK + Access-Control-Allow-Origin
```

O `GatewayResource` responde `GET /health-check` com o hostname do container, o que mostra qual réplica respondeu quando houver várias ([hands-on 7](../7/index.md)). Ele devolve só essa variável de propósito: responder com `System.getenv()` publicaria todas as variáveis de ambiente — senhas e segredos incluídos.

!!! warning "application.yaml"

    As rotas apontam para os nomes dos serviços no Compose (`account`); por isso, os containers de destino precisam estar rodando na mesma rede do Compose — caso contrário, o gateway responde `500 Internal Server Error` para aquela rota.

    Além disso, uma chamada do navegador vinda de uma origem que não está em `allowedOrigins` é bloqueada pelo CORS: defina `CORS_ALLOWED_ORIGINS` para o front-end que você usa.

Depois de terminar a implementação do microsserviço Gateway, podemos incluí-lo no arquivo `compose.yaml` e iniciá-lo com o Docker Compose. Você também pode testar o microsserviço Gateway enviando requisições para a porta exposta por ele e verificando se as requisições são roteadas para o microsserviço adequado.

``` { .yaml .copy .select linenums="1" title="compose.yaml" }
--8<-- "docs/2026.2/hands-on/2/code/compose.yaml"
``` 

Observe que os outros microsserviços declarados no arquivo `compose.yaml` não têm as suas portas expostas para a internet; portanto, eles só podem ser acessados por meio do microsserviço Gateway.

| Serviço | hands-on 1 | hands-on 2 |
|---|---|---|
| `account` | ✅ `8080` publicada | ❌ sem porta: só pelo gateway |
| `gateway` | — | ✅ `8080` publicada |
| `db` | ❌ sem porta | ❌ sem porta |

``` mermaid-sim
flowchart LR
    subgraph h1 [hands-on 1]
        c1["cliente"] e1@-->|":8080"| a1["account"]
        a1 --> d1[("db")]
    end
    subgraph h2 [hands-on 2]
        c2["cliente"] e2@-->|":8080"| g2["gateway"]
        g2 e3@--> a2["account\nsem porta publicada"]
        a2 --> d2[("db")]
    end
```

## Executar e verificar

Empacote cada serviço com o Maven antes (o Dockerfile copia `target/*.jar`), suba a pilha e chame a porta do gateway:

``` { bash }
docker compose up -d --build
curl http://localhost:8080/health-check
curl http://localhost:8080/accounts
```

Você deve ver o hostname do gateway (o id do container, então o seu é outro) e depois a resposta do `account`, roteada pelo gateway (uma lista vazia numa tabela vazia):

``` { .text .no-copy }
{"hostname":"3f2a9c1d7b4e"}
[]
```

Chamar o `account` direto do host precisa **falhar**: ele não tem porta publicada e o nome dele só existe dentro da rede do Compose.

<div class="csim" data-sim="gateway-routes" data-script="verify"></div>

!!! tip "Experimente"

    Antes de rodar o Docker, o mesmo gateway no navegador: o endpoint próprio e as 2 rotas do `application.yaml`, em ordem. Play ou → envia as requisições desta seção e mais algumas: `/health-check` responde no próprio gateway, `/accounts` vai para `http://account:8080/accounts`, `/insper` para https://www.insper.edu.br/insper (o caminho inteiro segue), `/account` recebe 404 (um predicado é um padrão, não um prefixo), um `id-account` forjado é descartado, uma Origin de evil.example recebe 403 e, depois de `docker compose stop account`, a mesma requisição recebe 500. No modo **livre**, digite qualquer caminho.

!!! warning "Armadilhas comuns"

    - **Sem jar**: o `COPY target/*.jar` falha se o serviço não foi empacotado com o Maven.
    - **Host errado**: uma rota usa o nome do serviço no Compose (`account`), não `localhost` — dentro do container do gateway, `localhost` é o próprio gateway.
    - **Portas vazando**: publicar uma porta do `account` deixa os clientes contornarem o gateway e tudo o que ele confere.
