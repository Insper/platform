
A principal função do microsserviço Gateway é rotear as requisições recebidas para o microsserviço adequado; por isso, ele é o ponto de entrada de todas as requisições. Sem ele, cada microsserviço teria de expor a sua própria porta e os seus endpoints para a internet, o que não é uma boa prática. O microsserviço Gateway atua como um proxy reverso e roteia as requisições recebidas para o microsserviço adequado. Além disso, ele também cuida da autenticação e da autorização das requisições recebidas.

``` mermaid-sim
flowchart LR
    subgraph api [Camada confiável]
        gateway e2@==> account
        gateway e4@==> others["outros"]
        account --> db@{ shape: cyl, label: "Banco de dados" }
        others --> db
    end
    internet e1@==>|requisição| gateway:::red
    e1@{ animate: true }
    e2@{ animate: true }
    e4@{ animate: true }
    classDef red fill:#fcc
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
  <iframe src="slides/gateway.pt.html" title="Slides: hands-on 2 — gateway" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/gateway.pt.html){:target="_blank"}

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
| `globalcors` | CORS para todos os caminhos, configurado uma única vez. As origens permitidas vêm de `CORS_ALLOWED_ORIGINS`, com os front-ends locais como padrão; `allowCredentials: true` permite que o navegador envie cookies (o token do [hands-on 3](../3/index.md)) — por isso as origens são listadas, e não `*`. |
| `default-filters` | Filtros aplicados a todas as rotas. `RemoveRequestHeader=id-account` descarta qualquer cabeçalho `id-account` enviado pelo cliente, para que só o gateway possa defini-lo (hands-on 3); `DedupeResponseHeader` remove os cabeçalhos de CORS duplicados quando um serviço também os define. |

O `GatewayResource` responde `GET /health-check` com o hostname do container, o que mostra qual réplica respondeu quando houver várias ([hands-on 7](../7/index.md)). Ele devolve só essa variável de propósito: responder com `System.getenv()` publicaria todas as variáveis de ambiente — senhas e segredos incluídos.

!!! warning "application.yaml"

    As rotas apontam para os nomes dos serviços no Compose (`account`); por isso, os containers de destino precisam estar rodando na mesma rede do Compose — caso contrário, o gateway responde com erro para aquela rota.

    Além disso, uma chamada do navegador vinda de uma origem que não está em `allowedOrigins` é bloqueada pelo CORS: defina `CORS_ALLOWED_ORIGINS` para o front-end que você usa.

Depois de terminar a implementação do microsserviço Gateway, podemos incluí-lo no arquivo `compose.yaml` e iniciá-lo com o Docker Compose. Você também pode testar o microsserviço Gateway enviando requisições para a porta exposta por ele e verificando se as requisições são roteadas para o microsserviço adequado.

``` { .yaml .copy .select linenums="1" title="compose.yaml" }
--8<-- "docs/2026.2/hands-on/2/code/compose.yaml"
``` 

Observe que os outros microsserviços declarados no arquivo `compose.yaml` não têm as suas portas expostas para a internet; portanto, eles só podem ser acessados por meio do microsserviço Gateway.
