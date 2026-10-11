
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
                            GatewayApplication.java
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

        ``` { .yaml .copy .select linenums="1" hl_lines="24-31" }
        --8<-- "docs/2026.2/hands-on/2/code/pom.xml"
        ```

    === "application.yaml"

        ``` { .yaml .copy .select linenums="1" hl_lines="5-27" }
        --8<-- "docs/2026.2/hands-on/2/code/application.yaml"
        ```

    === "GatewayApplication.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "docs/2026.2/hands-on/2/code/GatewayApplication.java"
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

!!! warning "application.yaml"

    O arquivo `application.yaml` está configurado para rotear as requisições recebidas para o microsserviço adequado; portanto, você precisa garantir que os microsserviços estejam rodando e expondo as suas portas antes de iniciar o microsserviço Gateway.

    Além disso, o arquivo `application.yaml` configura o CORS para permitir as requisições vindas da internet; portanto, você precisa garantir que a configuração de CORS esteja correta antes de iniciar o microsserviço Gateway.

Depois de terminar a implementação do microsserviço Gateway, podemos incluí-lo no arquivo `compose.yaml` e iniciá-lo com o Docker Compose. Você também pode testar o microsserviço Gateway enviando requisições para a porta exposta por ele e verificando se as requisições são roteadas para o microsserviço adequado.

``` { .dockerfile .copy .select linenums="1" title="compose.yaml" }
--8<-- "docs/2026.2/hands-on/2/code/compose.yaml"
``` 

Observe que os outros microsserviços declarados no arquivo `compose.yaml` não têm as suas portas expostas para a internet; portanto, eles só podem ser acessados por meio do microsserviço Gateway.
