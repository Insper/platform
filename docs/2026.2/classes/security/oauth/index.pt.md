
A loja lança um aplicativo móvel e quer um botão **"Entrar com Google"**. O aplicativo nunca pode ver a senha do Google do usuário, o Google precisa saber qual aplicativo está pedindo acesso, e o usuário precisa poder dizer "este aplicativo pode ler meu endereço de e-mail, e nada mais". Ao mesmo tempo, um job noturno no `order-service` precisa chamar o `product-service` para conciliar o estoque — e não há usuário nenhum. Um endpoint de login caseiro não consegue expressar nada disso. O **OAuth 2.0**[^1] é o framework padrão para *autorização delegada*, e o **OpenID Connect**[^5] é a camada de identidade construída sobre ele.

---

## OAuth 2.0 em uma frase

O OAuth 2.0 permite que uma aplicação **cliente** obtenha um **access token limitado e revogável** para chamar uma API em nome de um usuário — ou em nome próprio — **sem jamais manipular a senha do usuário**. O usuário se autentica apenas no **Authorization Server** e *consente* com o acesso solicitado.

### Papéis

| Papel | Descrição | Na loja |
|---|---|---|
| **Resource Owner** | O usuário dono dos dados | Ada, uma cliente |
| **Client** | A aplicação que solicita o acesso | o frontend web da loja, o aplicativo móvel, um job noturno |
| **Authorization Server** | Autentica o usuário e emite tokens | Keycloak, Auth0, AWS Cognito — ou o nosso `auth-service` |
| **Resource Server** | API que guarda o recurso protegido e valida tokens | `order-service`, `account-service` (atrás do gateway) |

Há dois tipos de cliente, e a diferença entre eles determina a escolha do fluxo:

- **Cliente confidencial** — roda em um servidor e consegue manter um segredo (`client_secret`) seguro: um backend, um job batch.
- **Cliente público** — roda no dispositivo do usuário e não consegue manter um segredo: uma single-page app (qualquer um pode ler o JavaScript dela), um aplicativo móvel (qualquer um pode descompilá-lo).

### Tokens

| Token | Finalidade | Destinatário | Validade típica |
|---|---|---|---|
| **Access token** | autoriza chamadas à API; enviado como `Authorization: Bearer <token>`[^3] | o Resource Server | 5–60 minutos |
| **Refresh token** | obtém um novo access token sem um novo login | apenas o Authorization Server | de horas a semanas |
| **ID token** (OIDC) | informa ao *cliente* quem é o usuário | apenas o Client | minutos |

Um access token pode ser **autocontido** (um JWT que o resource server verifica sozinho) ou **opaco** (uma string de referência aleatória que o resource server precisa consultar no Authorization Server). O token do Hands-on 3 é um JWT, mas o gateway o trata como opaco: ele pede ao `auth-service` que o resolva.

### Escopos e claims

Um **escopo** (scope) é uma permissão nomeada que o cliente solicita e com a qual o usuário consente, como `openid`, `email` ou `orders:read`. Os escopos concedidos viajam na claim `scope` do access token. O Resource Server então combina **o que o cliente pode fazer** (escopos) com **quem é o usuário e o que ele pode fazer** (`sub`, papéis) e **qual objeto está sendo acessado** (propriedade).

!!! example "Verificando um escopo no Spring Security"
    O Spring Security transforma cada escopo de um JWT em uma authority com o prefixo `SCOPE_`, de modo que um endpoint pode exigi-lo de forma declarativa:

    ```java
    @GetMapping("/orders")
    @PreAuthorize("hasAuthority('SCOPE_orders:read')")
    public List<OrderOut> findMine(@AuthenticationPrincipal Jwt jwt) {
        return orderService.findByAccount(jwt.getSubject()); // ownership: only this user's orders
    }
    ```

---

## Tipos de grant

Um **grant** (ou *fluxo*) é o procedimento que um cliente segue para obter um token. Escolher o grant é a primeira decisão de design.

| Grant | Caso de uso | Situação |
|---|---|---|
| **Authorization Code + PKCE** | aplicações web, SPA e móveis em que um usuário faz login | padrão recomendado para todo cliente voltado ao usuário |
| **Client Credentials** | entre serviços, sem usuário envolvido | recomendado para comunicação máquina a máquina |
| **Device Authorization**[^4] | dispositivos sem navegador ou teclado (smart TV, CLI) | recomendado para esse nicho |
| **Refresh Token** | troca um refresh token por um novo access token | usado junto com os fluxos acima |
| **Implicit** | SPAs antigas: token devolvido diretamente na URL | **descontinuado** — tokens vazam pela URL e pelo histórico |
| **Resource Owner Password (ROPC)** | legado: o cliente coleta a senha | **não deve ser usado**[^2] |

``` mermaid-sim
flowchart TD
    q1{"Há um usuário<br>envolvido?"} -->|não| cc["Client Credentials"]
    q1 -->|sim| q2{"O dispositivo<br>tem navegador?"}
    q2 -->|sim| pkce["Authorization Code + PKCE"]
    q2 -->|não| dev["Device Authorization"]
```

!!! danger "Nunca use ROPC"
    O Resource Owner Password Credentials exige que o cliente colete diretamente o usuário e a senha. Isso anula o propósito do OAuth 2.0 (autorização delegada sem compartilhar credenciais), não suporta login com múltiplos fatores e ensina os usuários a digitar senhas em qualquer aplicativo. O OAuth 2.0 Security Best Current Practice (RFC 9700) diz que ele **não deve** ser usado, e o rascunho do OAuth 2.1 o remove junto com o grant Implicit[^2].

### Authorization Code + PKCE { #authorization-code-pkce }

O usuário faz login no Authorization Server, nunca no aplicativo. O aplicativo recebe um **authorization code** de vida curta e uso único por meio de um redirecionamento do navegador e o troca por tokens em uma chamada direta pelo back-channel. O **PKCE** (Proof Key for Code Exchange, pronuncia-se "pixy")[^6] vincula o código ao aplicativo que iniciou o fluxo:

1. O aplicativo cria um **`code_verifier`** aleatório (de 43 a 128 caracteres) e o mantém em memória.
2. Ele envia apenas o hash, **`code_challenge = BASE64URL(SHA-256(code_verifier))`**, na requisição de autorização.
3. Ao trocar o código, ele envia o `code_verifier` original; o servidor calcula o hash e compara.

Um atacante que intercepte o redirecionamento (um aplicativo malicioso registrado para o mesmo esquema de URL, um log vazado) obtém o código, mas não o verifier, então o código é inútil.

``` mermaid-sim
sequenceDiagram
    autonumber
    actor User as Usuário
    participant App as App cliente
    participant Auth as Authorization Server (Keycloak)
    participant API as Resource Server (order-service)

    User->>App: clica em "Login"
    App->>App: gera state, code_verifier, code_challenge (S256)
    App->>Auth: redireciona para /authorize?response_type=code&client_id&code_challenge&state
    Auth->>User: formulário de login (e consentimento)
    User->>Auth: credenciais (+ MFA)
    Auth->>App: redireciona para o callback ?code=AUTH_CODE&state
    App->>App: confere se o state bate
    App->>Auth: POST /token {code, code_verifier}
    Auth->>App: {access_token, refresh_token, id_token}
    App->>API: GET /orders  Authorization: Bearer access_token
    API->>API: verifica a assinatura com o JWKS em cache, checa exp, iss, aud, scope
    API->>App: 200 OK dados do pedido
```

O parâmetro `state` é um valor aleatório que o aplicativo confere na volta; ele impede que um atacante injete o *próprio* código na sessão da vítima (um ataque CSRF no callback).

??? example "Calculando um par PKCE à mão"
    ```bash
    # 64 random URL-safe characters
    verifier=$(openssl rand -base64 48 | tr -d '=+/\n' | cut -c1-64)
    # BASE64URL(SHA-256(verifier)), without '=' padding
    challenge=$(printf '%s' "$verifier" | openssl dgst -sha256 -binary \
                | openssl base64 | tr '+/' '-_' | tr -d '=')
    echo "verifier=$verifier"; echo "challenge=$challenge"
    ```

### Client Credentials { #client-credentials }

Quando não há usuário envolvido, o cliente se autentica **como ele mesmo**, com as próprias credenciais, e recebe um token que representa o *serviço*, e não uma pessoa.

``` mermaid-sim
sequenceDiagram
    autonumber
    participant Job as order-service (job noturno)
    participant Auth as Authorization Server (Keycloak)
    participant P as product-service
    Job->>Auth: POST /token grant_type=client_credentials, client_id, client_secret
    Auth-->>Job: access_token (sub=order-service, scope=stock:read)
    Job->>P: GET /products/stock  Bearer access_token
    P->>P: verifica o token, checa o escopo stock:read
    P-->>Job: 200 OK
```

```bash
curl -s -X POST http://keycloak:8080/realms/store/protocol/openid-connect/token \
  -d grant_type=client_credentials \
  -d client_id=order-service \
  -d client_secret="$ORDER_SERVICE_SECRET" \
  -d scope=stock:read
```

!!! tip "Não reaproveite o token de um usuário em tarefas em segundo plano"
    Um job que pega emprestado o token de "algum usuário" quebra a trilha de auditoria (quem fez isso?), para de funcionar quando esse token expira e normalmente tem muito mais permissões do que precisa. Dê a cada serviço o seu próprio cliente e apenas os escopos de que ele precisa.

### Ciclo de vida do token { #token-lifecycle }

``` mermaid-sim
stateDiagram-v2
    state "Ativo" as Active
    state "Expirado" as Expired
    state "Revogado" as Revoked
    [*] --> Active : emitido por POST /token
    Active --> Expired : exp atingido
    Active --> Revoked : logout / ação do administrador
    Expired --> Active : cliente apresenta o refresh_token e recebe um novo access token
    Expired --> [*] : refresh token também expirou, usuário faz login de novo
    Revoked --> [*]
```

O **access token** tem vida curta (tipicamente de 5 a 60 minutos) e é enviado em toda requisição à API. O **refresh token** tem vida longa (de horas a semanas), é guardado com segurança pelo cliente e enviado **apenas** ao Authorization Server para obter novos access tokens sem pedir login ao usuário novamente. Para clientes públicos, o servidor deve usar **rotação de refresh tokens**: cada uso devolve um novo refresh token e invalida o anterior, de modo que um refresh token roubado é detectado no momento em que o ladrão e o aplicativo legítimo tentam usá-lo[^2].

Por que access tokens curtos? Um JWT autocontido não pode ser "desemitido": um resource server que o valida localmente vai aceitá-lo até o `exp`. Manter o `exp` curto limita o estrago de um token roubado, enquanto a revogação é aplicada no ponto em que o refresh token é trocado.

---

## OpenID Connect (OIDC) { #openid-connect-oidc }

O OAuth 2.0 cuida da autorização ("este cliente pode acessar este recurso?"). Ele deliberadamente não diz *quem é o usuário* — um access token é destinado à API, e não para ser lido pelo cliente. O OpenID Connect acrescenta a autenticação ("quem é este usuário?") ao definir um **ID Token** — um JWT com claims de usuário padronizadas, endereçado ao cliente[^5].

O OIDC estende o OAuth 2.0 com três acréscimos:

- O escopo `openid` na requisição de autorização
- **ID Token** — um JWT contendo claims de identidade do usuário (`sub`, `name`, `email`, `iss`, `aud`)
- **Endpoint UserInfo** — `GET /userinfo` devolve claims adicionais de perfil sob demanda

### Claims do ID Token

| Claim | Significado |
|---|---|
| `sub` | Subject — identificador único e estável do usuário neste provedor |
| `iss` | Issuer — URL do authorization server |
| `aud` | Audience — deve conter o `client_id` do cliente |
| `exp` / `iat` | Timestamps de expiração / de emissão |
| `name`, `email` | Claims padrão de perfil do usuário (solicitadas com os escopos `profile` e `email`) |
| `nonce` | Valor enviado pelo cliente na requisição e devolvido — impede a reutilização de um ID token antigo |

O cliente **deve validar** o ID token antes de confiar nele: assinatura, `iss`, `aud` igual ao seu próprio `client_id`, `exp` e `nonce`.

### Camadas do OAuth 2.0 e do OIDC

``` mermaid-sim
flowchart TB
    subgraph oidc ["Camada OIDC (identidade)"]
        id["ID Token<br>(quem é o usuário?)"]
        ui["Endpoint UserInfo"]
    end
    subgraph oauth ["Camada OAuth 2.0 (autorização)"]
        at["Access Token<br>(o que o cliente pode fazer?)"]
        rt["Refresh Token"]
    end
    app["App cliente"] --> id
    app --> at
    at -->|"enviado ao"| api["Resource Server"]
```

O Authorization Server expõe um **documento de descoberta** em `GET /.well-known/openid-configuration`, que devolve todas as URLs de endpoints (`authorization_endpoint`, `token_endpoint`, `userinfo_endpoint`), os escopos suportados e o `jwks_uri`. Clientes e resource servers conseguem se configurar a partir apenas da URL do issuer, sem configuração fixa no código.

### Provedores OIDC comuns

| Provedor | Caso de uso |
|---|---|
| **Keycloak** | Auto-hospedado, open source, completo — ideal para serviços internos e para o curso |
| **Auth0** | Nuvem gerenciada, integração rápida |
| **AWS Cognito** | Integração nativa com a AWS |
| **Google / GitHub** | Login social para aplicações públicas |

!!! warning "Não chame APIs com o ID token"
    O destinatário (audience) do ID token é o *cliente*, não a sua API. Resource servers devem aceitar apenas **access tokens** e devem rejeitar tokens cujo `aud` não seja o deles — caso contrário, um token emitido para outro aplicativo pode ser reutilizado contra o seu.

---

## Validando tokens no gateway

Em vez de cada microsserviço implementar a validação, o gateway é o primeiro **ponto de aplicação** (enforcement point): ele rejeita requisições sem um token válido e repassa uma identidade confiável adiante. Há duas formas de validar.

### Validação local com JWKS { #local-validation-with-jwks }

Com assinaturas **assimétricas** (RS256, ES256), o Authorization Server assina com uma **chave privada** que nunca sai dele, e qualquer um pode verificar com a **chave pública** correspondente. As chaves públicas são publicadas como um **JSON Web Key Set (JWKS)**[^7] — um documento JSON em que cada chave tem um `kid` (key id); o header de todo JWT indica o `kid` que o assinou.

1. O Authorization Server publica suas chaves públicas em seu `jwks_uri` (no Keycloak: `/realms/<realm>/protocol/openid-connect/certs`).
2. O gateway busca o JWKS e o mantém em **cache**.
3. Cada requisição recebida carrega `Authorization: Bearer <token>`.
4. O gateway escolhe a chave pelo `kid` e verifica a assinatura **localmente** — sem chamar o Authorization Server.
5. Diante de um `kid` desconhecido (o servidor rotacionou suas chaves): busca o JWKS de novo uma vez e tenta outra vez.

``` mermaid-sim
sequenceDiagram
    participant C as Cliente
    participant GW as API Gateway
    participant Auth as Auth Server
    participant SVC as order-service

    GW->>Auth: GET jwks_uri (na inicialização, depois em cache)
    Auth-->>GW: {keys: [{kid, kty, n, e}]}
    C->>GW: GET /orders  Bearer token
    GW->>GW: verifica a assinatura com a chave em cache, checa exp, iss, aud
    alt token inválido
        GW-->>C: 401 Unauthorized
    else token válido
        GW->>SVC: GET /orders + header id-account
        SVC-->>GW: 200 OK
        GW-->>C: 200 OK
    end
```

Com o Spring Security (inclusive no Spring Cloud Gateway reativo), a validação local é apenas configuração:

=== "application.yml (issuer)"
    ```yaml
    spring:
      security:
        oauth2:
          resourceserver:
            jwt:
              # discovers jwks_uri and also validates the iss claim
              issuer-uri: http://keycloak:8080/realms/store
              # Spring Boot 3.1+: also reject tokens whose aud is not this API
              audiences: store-api
    ```

=== "application.yml (apenas JWKS)"
    ```yaml
    spring:
      security:
        oauth2:
          resourceserver:
            jwt:
              jwk-set-uri: http://keycloak:8080/realms/store/protocol/openid-connect/certs
    ```

Seja qual for a biblioteca, uma validação correta verifica[^8]:

- a **assinatura**, com um algoritmo de uma allow-list explícita — nunca `alg: none`, e nunca deixe o header do token escolher o algoritmo;
- **`exp`** e **`nbf`** (com uma pequena tolerância de relógio);
- **`iss`** — o token vem do *seu* Authorization Server;
- **`aud`** — o token foi emitido *para esta API*;
- os **escopos / papéis** exigidos pelo endpoint.

### Validação remota (introspecção)

A alternativa é perguntar ao Authorization Server a cada requisição: "este token é válido, e de quem ele é?". O OAuth padroniza isso como **token introspection** (RFC 7662)[^9]. A chamada `POST /auth/solve` em [Hands-on 3 — Autorização](../../../hands-on/3/authorization/index.md) é exatamente esse padrão, com um endpoint próprio.

| | Local (JWKS) | Remota (introspecção, `/auth/solve`) |
|---|---|---|
| Latência | nenhum salto extra | uma chamada de rede por requisição (cacheável) |
| Disponibilidade | funciona enquanto o Auth Server está fora do ar | Auth Server fora do ar = toda requisição falha |
| Revogação | efetiva apenas no `exp` | imediata |
| Gestão de chaves | apenas chaves públicas; a chave privada fica em um só lugar | qualquer tipo de chave; o segredo fica no Auth Server |
| Tipo de token | JWT | JWT ou opaco |

Sistemas grandes costumam combinar as duas: JWTs de vida curta validados localmente na maioria das chamadas, introspecção para operações sensíveis.

!!! tip "Repasse o contexto do usuário adiante"
    Após a validação, o gateway repassa a identidade como um header — `id-account: <sub>` no Hands-on 3 —, de modo que os serviços seguintes não precisam interpretar tokens. Esses serviços só devem aceitar esse header **vindo do gateway**: remova-o das requisições externas recebidas e garanta que os serviços não sejam alcançáveis de fora (veja [Zero Trust](../zero-trust/index.md)). Alguns times repassam o token original (*token relay*), para que cada serviço possa verificá-lo de novo.

---

## Onde o navegador guarda o token

| Armazenamento | Legível por JavaScript? | Principal risco | Mitigação |
|---|---|---|---|
| `localStorage` / `sessionStorage` | sim | qualquer script XSS rouba o token | evite para tokens |
| Cookie `HttpOnly` (Hands-on 3) | não | CSRF — o navegador envia o cookie automaticamente | `SameSite`, `Secure`, tokens CSRF |
| Sessão no servidor (*Backend for Frontend*) | nenhum token no navegador | roubo de sessão | o BFF guarda os tokens; o navegador guarda apenas um cookie de sessão |

O Hands-on 3 escolheu o cookie `HttpOnly`: veja as flags do cookie em [Hands-on 3 — Rotas abertas](../../../hands-on/3/open-routes/index.md).

---

## Armadilhas

!!! warning "Erros comuns com OAuth 2.0 e JWT"
    - **Usar ROPC ou Implicit** em código novo — use Authorization Code + PKCE.
    - **Pular a verificação do `aud`** — um token válido para outra API é aceito pela sua.
    - **Access tokens de vida longa** — um bearer token roubado vale até o `exp`; mantenha-os curtos e use refresh tokens.
    - **Compartilhar um segredo HMAC entre muitos serviços** — todo serviço que consegue verificar também consegue *forjar* tokens; use chaves assimétricas e um JWKS.
    - **Tokens em URLs ou logs** — query strings acabam em logs de proxy e no histórico do navegador; envie tokens em headers ou cookies e mascare-os nos logs.
    - **Chamar a API com o ID token** — ID tokens são para o cliente; APIs aceitam access tokens.

---

## Pontos-chave

- O OAuth 2.0 é **autorização delegada**: o cliente recebe um token limitado e de vida curta e nunca vê a senha do usuário.
- Escolha o grant pelo tipo de cliente: **Authorization Code + PKCE** para tudo que tem usuário, **Client Credentials** para serviços, **nunca ROPC ou Implicit**.
- **Access tokens** vão para as APIs e duram minutos; **refresh tokens** vão apenas para o Authorization Server; o **ID token** (OIDC) informa ao cliente quem é o usuário.
- Com chaves assimétricas e um **JWKS**, o gateway valida tokens **localmente**; a introspecção (como `/auth/solve`) troca um salto de rede por revogação imediata.
- Validar é mais do que checar a assinatura: verifique `exp`, `iss`, `aud` e escopos — e depois cada serviço ainda verifica a **propriedade** dos dados.

[^1]: HARDT, D. (ed.). [RFC 6749 — The OAuth 2.0 Authorization Framework](https://datatracker.ietf.org/doc/html/rfc6749){target="_blank"}. IETF, 2012.
[^2]: LODDERSTEDT, T. et al. [RFC 9700 — Best Current Practice for OAuth 2.0 Security](https://datatracker.ietf.org/doc/html/rfc9700){target="_blank"}. IETF, 2025. Veja também o [rascunho do OAuth 2.1](https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/){target="_blank"}.
[^3]: JONES, M.; HARDT, D. [RFC 6750 — The OAuth 2.0 Authorization Framework: Bearer Token Usage](https://datatracker.ietf.org/doc/html/rfc6750){target="_blank"}. IETF, 2012.
[^4]: DENNISS, W. et al. [RFC 8628 — OAuth 2.0 Device Authorization Grant](https://datatracker.ietf.org/doc/html/rfc8628){target="_blank"}. IETF, 2019.
[^5]: SAKIMURA, N. et al. [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html){target="_blank"}. OpenID Foundation.
[^6]: SAKIMURA, N.; BRADLEY, J.; AGARWAL, N. [RFC 7636 — Proof Key for Code Exchange by OAuth Public Clients](https://datatracker.ietf.org/doc/html/rfc7636){target="_blank"}. IETF, 2015.
[^7]: JONES, M. [RFC 7517 — JSON Web Key (JWK)](https://datatracker.ietf.org/doc/html/rfc7517){target="_blank"}. IETF, 2015.
[^8]: SHEFFER, Y.; HARDT, D.; JONES, M. [RFC 8725 — JSON Web Token Best Current Practices](https://datatracker.ietf.org/doc/html/rfc8725){target="_blank"}. IETF, 2020.
[^9]: RICHER, J. (ed.). [RFC 7662 — OAuth 2.0 Token Introspection](https://datatracker.ietf.org/doc/html/rfc7662){target="_blank"}. IETF, 2015.
