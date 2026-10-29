!!! abstract "Neste lab"

    - Construa o **`auth`**: usuários, senhas com BCrypt, login que devolve um **JWT assinado com RS256** e um endpoint público **JWKS**.
    - Coloque o **Spring Cloud Gateway** atrás do edge: um único lugar para **roteamento**, **validação de token** e **autorização** (rotas abertas vs protegidas vs de administrador).
    - Propague a identidade do usuário para os serviços como headers confiáveis (`X-User-Id`).
    - **Meça** quanto custam o salto extra e a verificação do token, e quantos logins por segundo o `auth` aguenta.

Até agora qualquer um podia criar ou apagar eventos no catálogo. O BoxOffice precisa saber **quem** está chamando (autenticação) e **o que essa pessoa pode fazer** (autorização) — e não deve pedir a cada serviço que resolva esse problema de novo. A resposta padrão é um **API gateway**[^1]: a porta de entrada única da API, onde os tokens são validados uma vez e as requisições são roteadas para o serviço certo. Atrás dele, os serviços confiam na identidade que o gateway repassa.

Este lab constrói o capítulo 5 da [história da disciplina](../../index.md#story): a porta de entrada de que as [réplicas stateless](../../classes/compute/index.md#stateless-app-servers) precisam, onde o token é verificado uma vez para todos os serviços e nenhuma réplica guarda sessão. Ele implementa o [API gateway](../../classes/edge/api-gateway/index.md) da aula 4, o [mapa de serviços](../../classes/compute/services/index.md) da aula 5 e a [validação de token no gateway](../../classes/edge/identity/index.md#gateway-validation) da página de identidade.

## Antes de começar { #before-you-start }

| | |
|---|---|
| **Tempo** | 3–4 horas |
| **Você precisa de** | as ferramentas do lab 0; Docker com pelo menos **6 GB** (cinco JVMs a partir de agora); portas **80** e **8080** livres |
| **Diretório** | todo comando roda na raiz do seu repositório `boxoffice/` (Windows: dentro do WSL 2) |

``` { .bash .copy }
docker compose version        # Docker Compose v2.x (or newer)
java -version                 # 21 or newer
mvn -v                        # Apache Maven 3.9+
k6 version                    # k6 v1.0+
uv --version                  # uv (runs the Python helper scripts)
```

**Estado inicial** — o fim do lab 3:

``` { .tree title="boxoffice/ at the start of lab 4" }
boxoffice/
    docker-compose.yaml        # db, catalog-1..3, edge
    infra/nginx/nginx.conf     # edge -> catalog replicas
    load/  hello.js smoke.js load.js stress.js ratelimit.js
    results/ ...
    scripts/ ...
    services/catalog/          # with InstanceHeaderFilter
```

!!! tip "Recupere o atraso"

    Pulou ou quebrou o lab 3? Baixe [boxoffice-after-lab-3.zip](../3/boxoffice-after-lab-3.zip), descompacte e `cd boxoffice`. Este lab **adiciona** dois serviços (`services/auth`, `services/gateway`) e dois scripts do k6, e **substitui** o `docker-compose.yaml` e o `infra/nginx/nginx.conf`; todo arquivo aparece completo nas próximas páginas e está em [`code/`](code/docker-compose.yaml).

## Slides

<div class="slides-embed">
  <iframe src="slides/gateway.html" title="Slides: hands-on 4 — gateway e identidade" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/gateway.html){:target="_blank"}

!!! info "Conexão com a teoria"

    - Aula 4, [API gateway](../../classes/edge/api-gateway/index.md): roteamento, autenticação na borda, rate limiting, BFF.
    - Aula 4, [Identidade](../../classes/edge/identity/index.md): OAuth 2.1/OIDC, JWT, sessões; [Zero trust](../../classes/network-security/zero-trust/index.md): por que "confiar nos headers do gateway" só é aceitável dentro de uma rede protegida.
    - Catálogo de componentes: [API Gateway](../../reference/components/edge/index.md#apigw), [Auth Service](../../reference/components/compute/index.md#auth).

## O que você vai construir { #what-you-will-build }

``` diagram-sim
sequenceDiagram
    autonumber
    actor Fan as Fã
    participant E as edge :80
    participant G as gateway :8080
    participant A as auth :8081
    participant C as catalog-1..3 :8082
    Fan->>E: POST /auth/login {email, password}
    E->>G: encaminha
    G->>A: rota /auth/** (aberta)
    A->>A: confere o BCrypt, assina o JWT com a chave privada
    A-->>Fan: 200 {accessToken: "eyJ..."}
    Fan->>E: POST /catalog/events + Authorization: Bearer eyJ...
    E->>G: encaminha
    G->>A: GET /auth/.well-known/jwks.json (só na primeira vez, depois em cache)
    G->>G: verifica assinatura, exp, iss, aud — scope "admin"?
    G->>C: rota lb://catalog + X-User-Id, X-User-Scope
    C-->>Fan: 201 Created
```

Os tokens são JWTs[^2]: JSON assinado que qualquer um com a chave pública consegue verificar sem chamar o `auth`.

| Rota | Quem pode chamar | Imposto por |
|---|---|---|
| `POST /auth/register`, `POST /auth/login`, `GET /auth/.well-known/jwks.json` | qualquer um | gateway: `permitAll` |
| `GET /catalog/**` | qualquer um | gateway: `permitAll` |
| `POST`/`PUT`/`DELETE /catalog/**` | tokens com scope `admin` | gateway: `hasAuthority("SCOPE_admin")` |
| `GET /auth/me` e **toda outra rota** (inclusive as futuras) | qualquer token válido | gateway: `anyExchange().authenticated()` |

A topologia depois deste lab: **edge** (Nginx: terminação TLS em produção, rate limiting, balanceamento de carga entre réplicas do gateway) → **gateway** (identidade, roteamento, balanceamento de carga entre instâncias dos serviços) → **serviços**.

## Passos { #steps }

<div class="grid cards" markdown>

-   :material-account-key:{ .lg .middle } **[1. O serviço `auth`](auth/index.md)**

    ---

    Tabela de usuários, BCrypt, login, assinatura de JWT com um par de chaves RSA, o documento JWKS.

-   :material-gate:{ .lg .middle } **[2. O gateway](gateway/index.md)**

    ---

    Rotas do Spring Cloud Gateway, balanceamento de carga no cliente entre `catalog-1..3`, validação de JWT, headers de identidade, o novo edge e o Compose.

</div>

## 3. Teste de ponta a ponta { #3-try-it-end-to-end }

Com os dois passos feitos, reconstrua e suba tudo:

``` { .bash .copy }
docker compose up --build -d
docker compose ps        # db, catalog-1..3, auth, gateway healthy; edge running
```

<!-- termynal -->
``` shell
> curl -s -X POST localhost/auth/register -H 'Content-Type: application/json' -d '{"name":"Ana","email":"ana@example.com","password":"secret-123"}'
{"id":"0b9d8a6e-…","name":"Ana","email":"ana@example.com","role":"USER"}
> TOKEN=$(curl -s -X POST localhost/auth/login -H 'Content-Type: application/json' -d '{"email":"ana@example.com","password":"secret-123"}' | jq -r .accessToken)
> curl -s localhost/auth/me -H "Authorization: Bearer $TOKEN"
{"id":"0b9d8a6e-…","name":"Ana","email":"ana@example.com","role":"USER"}
> curl -s -o /dev/null -w "%{http_code}\n" localhost/auth/me
401
> curl -s -o /dev/null -w "%{http_code}\n" -X DELETE localhost/catalog/events/2 -H "Authorization: Bearer $TOKEN"
403
```

Agora como administrador (criado na inicialização a partir de `ADMIN_EMAIL`/`ADMIN_PASSWORD`):

``` { .bash .copy }
ADMIN=$(curl -s -X POST localhost/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@boxoffice.dev","password":"boxoffice-admin"}' | jq -r .accessToken)

curl -s -X PUT localhost/catalog/events/2 -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"title":"Match #2 (rescheduled)","category":"SPORTS","venueId":15,"startsAt":"2027-03-02T21:00:00-03:00","priceFrom":100}' | jq .title

# look inside the token: header and claims are only Base64URL, NOT encrypted
echo "$ADMIN" | cut -d. -f2 | tr '_-' '/+' | base64 -d 2>/dev/null; echo
```

??? question "Pense primeiro: um cliente envia ele mesmo `X-User-Id: <o id do admin>`. O que acontece?"

    Nada de útil para o atacante: o `UserHeadersFilter` do gateway **remove** qualquer header `X-User-*` vindo de fora antes de definir os seus a partir do token validado. Sem essa linha, qualquer cliente poderia se passar por qualquer usuário, porque os serviços confiam cegamente nesses headers. Essa confiança só é aceitável porque os serviços não são alcançáveis a não ser pelo gateway — redes zero trust (aula 12) vão além e autenticam cada salto (mTLS, ou revalidando o JWT em cada serviço).

Teste também os outros casos de falha: um token expirado (suba o `auth` com `JWT_TTL=PT30S` e espere um minuto), um token com um caractere alterado (a verificação da assinatura falha) e reiniciar o `auth` (novo par de chaves: os tokens antigos são rejeitados porque o `kid` deles não existe mais no JWKS — veja o aviso no [passo 1](auth/index.md)).

## Meça: o preço de uma porta de entrada { #measure-it }

Cada salto e cada verificação custam algo. Meça três tipos de requisição na mesma taxa — rota aberta pelo edge, rota protegida (validação de JWT) pelo edge e a rota aberta direto na porta do gateway — e também a vazão do próprio `auth`.

``` { .javascript title="load/gateway.js" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/4/code/load/gateway.js"
```

``` { .javascript title="load/login.js" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/4/code/load/login.js"
```

``` { .bash .copy }
k6 run -e RATE=50 load/gateway.js        # 3 scenarios × 50 req/s
mkdir -p results/lab4
for r in 5 10 20 40; do k6 run -q -e RATE=$r --summary-export results/lab4/login-$r.json load/login.js; done
uv run scripts/summarize.py results/lab4/login-*.json
```

Registre em `results/lab4.md`:

``` { .markdown title="results/lab4.md" .copy }
# Lab 4 — gateway and identity

## Hops (50 req/s each, 1 min)
| Path | p50 (ms) | p95 (ms) | p99 (ms) |
|---|---:|---:|---:|
| edge → catalog (lab 3, same rate) | | | |
| gateway → catalog (direct) | | | |
| edge → gateway → catalog (open) | | | |
| edge → gateway → auth, JWT validated (protected) | | | |

Cost of the gateway hop ≈ ____ ms at p50; cost of JWT validation ≈ ____ ms.

## Login capacity
<table from summarize.py: rate, p50, p99, errors>
- Max logins/s with p99 < 1 s: ____ ; CPU of auth at that rate (docker stats): ____ %
- One BCrypt check (cost 10) takes about ____ ms on my machine.

## Questions
- Why does the gateway validate tokens locally instead of calling auth on every request?
- What would happen to the flash sale if every request called /auth/login?
```

Como ler:

- O **salto pelo gateway** acrescenta de uma fração de milissegundo a alguns milissegundos no p50 (um salto de rede extra e um proxy não bloqueante). Verificar a assinatura com RS256 custa microssegundos de CPU: a validação do JWT é barata **porque é local** — o gateway buscou a chave pública uma vez e nunca chama o `auth` a cada requisição.
- **O login é caro de propósito.** O BCrypt com custo 10 queima dezenas de milissegundos de CPU por tentativa, então o `auth` com 1 CPU chega no máximo a **dez a vinte logins por segundo** (numa execução de teste deste lab, 10 logins/s já levaram o p99 para a casa dos segundos). É exatamente isso que torna lento adivinhar senhas — e por isso os clientes precisam **reutilizar tokens** em vez de fazer login a cada requisição. Numa venda relâmpago, os logins devem acontecer *antes* das 10:00.

!!! note "Se os seus números forem diferentes"

    Num notebook, o gateway (1 CPU) divide a máquina com outras cinco JVMs e o PostgreSQL, então o salto pode custar mais do que em produção — numa execução deste lab em uma máquina ocupada, o p50 chegou a centenas de milissegundos a 150 req/s. Compare custos **relativos** na mesma máquina e na mesma execução: direto no gateway vs pelo edge vs com JWT. Para logins, o teto escala com a CPU: um núcleo dá cerca de 10–20 verificações BCrypt por segundo.

## Solução de problemas { #troubleshooting }

| Sintoma | Causa | Correção |
|---|---|---|
| `503` em `/catalog/**` por alguns segundos depois que o gateway sobe; log `No servers available for service: catalog` | os health checks do load balancer ainda não rodaram | espere ~10 s; se persistir, confira `docker compose ps` (réplicas do catalog saudáveis?) e se o pom do gateway tem `spring-boot-starter-webclient` |
| `401` em toda rota protegida | sem header `Authorization: Bearer …`, token expirado, ou o `auth` reiniciou (chave nova) | faça login de novo: `export TOKEN=$(curl -s -X POST localhost/auth/login -H 'Content-Type: application/json' -d '{"email":"ana@example.com","password":"secret-123"}' \| jq -r .accessToken)` |
| `403` como admin | você usou o token do usuário, ou o admin não foi criado | `docker compose logs auth \| grep administrator`; faça login com `admin@boxoffice.dev` / `boxoffice-admin` |
| `409 e-mail already registered` | você rodou o comando de cadastro duas vezes | tudo bem: só faça login |
| `Bind for 0.0.0.0:8080 failed` | outro programa usa a 8080 | mude só o lado do host: `"18080:8080"` |
| o gateway registra `Unable to resolve the Configuration with the provided Issuer` ou erros de JWKS | `AUTH_JWKS_URI`/`JWT_ISSUER` diferem entre `auth` e `gateway` | use o `docker-compose.yaml` deste lab sem alterações |
| contêineres reiniciam ou são mortos (`exit 137`) | o Docker está sem memória | dê ≥ 6 GB ao Docker (Docker Desktop → Settings → Resources) |

!!! success "Boas práticas neste lab"

    - **Valide toda claim do token, em um só lugar** — assinatura contra o JWKS do `auth`, mais `exp`, `iss` e `aud`, no `SecurityConfig.java`; veja [Identidade — validando tokens no gateway](../../classes/edge/identity/index.md#gateway-validation).
    - **Negue por padrão** — `.anyExchange().authenticated()` no `SecurityConfig.java` protege toda rota que ninguém listou ainda, inclusive as futuras; veja [API gateway](../../classes/edge/api-gateway/index.md).
    - **Nunca confie em headers de identidade vindos do cliente** — o `UserHeadersFilter.java` remove `X-User-*` antes de defini-los a partir do token; veja [Zero Trust](../../classes/network-security/zero-trust/index.md).
    - **Ponha um timeout em cada salto e só repita requisições idempotentes** — `connect-timeout: 1000`, `response-timeout: 5s` e um único retry de `GET` no `application.yaml` do gateway; veja [Confiabilidade — retry com backoff e jitter](../../classes/reliability/patterns/index.md#retry-with-backoff-and-jitter).
    - **Faça o hash das senhas com uma função lenta e com salt** — BCrypt com custo 10 no `AuthService.java`, medido em 10–20 logins/s por núcleo, e é por isso que os clientes reutilizam tokens; veja [Servidores de aplicação stateless](../../classes/compute/index.md#stateless-app-servers).

## Limpeza { #clean-up }

``` { .bash .copy }
docker compose down          # keeps the database (users and events)
# docker compose down -v     # resets everything: users are created again from scratch
```

Guarde tudo: o lab 5 adiciona o Redis a esta stack.

## Entrega { #deliverable }

- [ ] `services/auth` e `services/gateway` rodando; o novo `infra/nginx/nginx.conf` manda tudo para o gateway.
- [ ] A sessão de curl acima reproduzida: `201`, `200`, `401`, `403` e uma atualização como admin que funciona.
- [ ] O teste de falsificação: enviar `X-User-Id` você mesmo não tem efeito (mostre a evidência).
- [ ] `results/lab4.md` com a tabela de saltos, a capacidade de login e as duas respostas.
- [ ] Repositório com a tag `lab4`; [quiz](quiz.md) respondido.

## Estado final { #end-state }

``` { .tree title="changed in lab 4" }
boxoffice/
    docker-compose.yaml        # replaced: + auth (8081), + gateway (8080); edge -> gateway
    infra/nginx/nginx.conf     # replaced: everything goes to the gateway, /actuator hidden
    load/gateway.js  load/login.js           # new
    services/auth/             # new: users, BCrypt, RS256 JWT, JWKS
    services/gateway/          # new: routes, lb://catalog, JWT validation, identity headers
    results/lab4.md  results/lab4/
```

Próximo: [Lab 5 — Caching](../5/index.md).

[^1]: Referência do Spring Cloud Gateway, [Server WebFlux](https://docs.spring.io/spring-cloud-gateway/reference/spring-cloud-gateway-server-webflux.html){target="_blank"}; referência do Spring Security, [OAuth 2.0 Resource Server — JWT](https://docs.spring.io/spring-security/reference/reactive/oauth2/resource-server/jwt.html){target="_blank"}.
[^2]: IETF, [RFC 7519 — JSON Web Token](https://www.rfc-editor.org/rfc/rfc7519){target="_blank"} e [RFC 7517 — JSON Web Key](https://www.rfc-editor.org/rfc/rfc7517){target="_blank"}.
