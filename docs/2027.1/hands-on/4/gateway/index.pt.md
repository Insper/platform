O gateway é a porta de entrada da API: toda requisição que passa pelo edge atravessa ele. Ele é construído com o **Spring Cloud Gateway**, que roda sobre Spring WebFlux e Netty — não bloqueante, então poucas threads fazem o proxy de milhares de requisições concorrentes — na porta **8080**.

| Responsabilidade | Como |
|---|---|
| **Roteamento** | `/auth/**` → `auth`; `/catalog/**` → `lb://catalog` |
| **Balanceamento de carga** entre instâncias dos serviços | Spring Cloud LoadBalancer entre `catalog-1..3`, pulando as que não estão saudáveis |
| **Autenticação** | valida o JWT: assinatura (JWKS), `exp`, `iss`, `aud` |
| **Autorização** (grossa) | aberta / qualquer token / scope `admin`, por caminho e método |
| **Propagação de identidade** | `X-User-Id`, `X-User-Email`, `X-User-Scope` para os serviços |
| **Timeouts e retries** | conexão 1 s, resposta 5 s; um retry para GETs idempotentes |

## 1. Projeto { #1-project }

Crie `services/gateway` (mesmo `Dockerfile` com `EXPOSE 8080`, mesmo `.dockerignore`).

??? example "`services/gateway/Dockerfile` e `.dockerignore` (iguais aos do `catalog`, só muda o `EXPOSE 8080`)"

    ``` { .dockerfile title="services/gateway/Dockerfile" .copy linenums="1" }
    --8<-- "docs/2027.1/hands-on/4/code/services/gateway/Dockerfile"
    ```

    ``` { .text title="services/gateway/.dockerignore" .copy }
    --8<-- "docs/2027.1/hands-on/4/code/services/gateway/.dockerignore"
    ```

``` { .xml title="services/gateway/pom.xml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/4/code/services/gateway/pom.xml"
```

``` { .java title="services/gateway/src/main/java/boxoffice/gateway/GatewayApplication.java" .copy }
--8<-- "docs/2027.1/hands-on/4/code/services/gateway/src/main/java/boxoffice/gateway/GatewayApplication.java"
```

## 2. Rotas e balanceamento de carga { #2-routes-and-load-balancing }

``` { .yaml title="services/gateway/src/main/resources/application.yaml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/4/code/services/gateway/src/main/resources/application.yaml"
```

- Uma **rota** = id + predicados (quando ela casa) + URI (para onde vai) + filtros.
- `uri: lb://catalog` pede ao Spring Cloud LoadBalancer uma instância do `catalog` a cada requisição (round robin). A lista de instâncias aqui é estática (`discovery.client.simple`); com o Kubernetes no lab 10, um `Service` assume esse papel.
- `configurations: health-check` faz o balanceador consultar o `/actuator/health` de cada instância a cada 5 s e pular as que não estão `UP` — um health check **ativo**, o que o Nginx open source não conseguia fazer no lab 3. Ele usa um `WebClient` para a sondagem, que no Spring Boot 4 fica em um starter próprio: é por isso que o pom tem `spring-boot-starter-webclient`. Até a primeira rodada de sondagens terminar (alguns segundos depois da inicialização), o balanceador não conhece nenhuma instância saudável e o gateway responde `503`.
- `Retry` reenvia uma vez um GET que falhou (para outra instância); nunca POSTs, que podem não ser idempotentes.

!!! note "Dois load balancers?"

    Sim, de propósito: o **edge** balanceia entre réplicas do *gateway* (acrescente `gateway-2` ao upstream do Nginx quando um gateway não bastar), e o **gateway** balanceia entre instâncias dos *serviços*. Isso espelha a nuvem: um load balancer L7 público na frente de uma frota de API gateways, que chamam os serviços por balanceamento de carga interno.

## 3. Segurança: quem pode chamar o quê { #3-security-who-may-call-what }

``` { .java title="services/gateway/src/main/java/boxoffice/gateway/SecurityConfig.java" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/4/code/services/gateway/src/main/java/boxoffice/gateway/SecurityConfig.java"
```

- As regras são avaliadas **em ordem**; a primeira que casa vence. `anyExchange().authenticated()` é o padrão seguro: uma rota nova acrescentada no mês que vem fica protegida, a menos que alguém a abra explicitamente.
- `oauth2ResourceServer().jwt()` transforma o gateway em um **resource server** OAuth 2.0: ele lê `Authorization: Bearer …`, valida o token com o decoder abaixo e mapeia a claim `scope` para authorities (`SCOPE_user`, `SCOPE_admin`).
- O decoder baixa o JWKS do `auth` **uma vez** e o guarda em cache; só busca de novo quando chega um token com um `kid` desconhecido. É por isso que a validação é local e barata.
- Um token ausente ou inválido recebe `401 Unauthorized` (com um header `WWW-Authenticate`); um token válido sem o scope necessário recebe `403 Forbidden`.

## 4. Headers de identidade { #4-identity-headers }

``` { .java title="services/gateway/src/main/java/boxoffice/gateway/UserHeadersFilter.java" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/4/code/services/gateway/src/main/java/boxoffice/gateway/UserHeadersFilter.java"
```

Um `GlobalFilter` roda em toda rota. Primeiro ele **remove** qualquer header `X-User-*` enviado pelo cliente e então, se a requisição traz um JWT validado, acrescenta a identidade tirada do token. Os serviços leem um header simples em vez de interpretar tokens — simples, mas só vale enquanto ninguém conseguir alcançar os serviços sem passar pelo gateway.

## 5. O novo edge { #5-the-new-edge }

Agora o edge encaminha tudo para o gateway; o roteamento por caminho foi um salto para dentro. Ele também esconde o `/actuator/` da internet.

``` { .nginx title="infra/nginx/nginx.conf" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/4/code/infra/nginx/nginx.conf"
```

## 6. Compose

``` { .yaml title="docker-compose.yaml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/4/code/docker-compose.yaml"
```

O gateway publica a porta 8080 só para que você possa medi-lo diretamente; em produção, só o edge ficaria exposto.

<!-- termynal -->
``` shell
> docker compose up --build -d
> curl -s localhost:8080/actuator/gateway/routes | jq -r '.[].route_id'
auth
catalog
> curl -s -o /dev/null -w "%{http_code}\n" localhost/catalog/events/1
200
> curl -s -o /dev/null -w "%{http_code}\n" localhost/actuator/health
404
```

!!! warning "Armadilhas"

    - **`401` em toda rota protegida logo depois da inicialização**: o gateway busca o JWKS sob demanda; se o `auth` estava fora do ar naquele momento, tente de novo — e confira o `AUTH_JWKS_URI`.
    - **`401` depois de reiniciar o `auth`**: os tokens antigos foram assinados com a chave antiga. Faça login de novo.
    - **Diferença de relógio**: `exp`/`iat` são comparados com o relógio do gateway; os contêineres compartilham o relógio do host, mas servidores em produção precisam de NTP (aula 3).
    - **CORS**: um front-end no navegador em outra origem precisa de CORS configurado no gateway (`spring.cloud.gateway.server.webflux.globalcors`) — desnecessário para o k6 ou o curl.

Volte à [visão geral do lab](../index.md#measure-it) para testar e medir.
