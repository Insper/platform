
O BoxOffice lança o seu app mobile. Alguém propõe o projeto óbvio: uma tela de login no app, o app envia e-mail e senha para `POST /login`, guarda a senha no celular "para o usuário não precisar digitar de novo" e a envia em toda requisição. Em uma semana, o time de produto também quer **"Entrar com Google"**, um **checkout web**, um **job noturno de conciliação** em `order` que chama `inventory` sem nenhum usuário por trás, e um **assistente de IA** que age em nome do usuário. Um login caseiro não consegue expressar nada disso com segurança. Esta página trata dos padrões que conseguem: **sessões e tokens**, **JWT**, **OAuth 2.1** e **OpenID Connect**, e dos modelos de autorização que decidem *o que* um chamador autenticado pode fazer.

---

## Autenticação vs autorização { #authentication-vs-authorization }

Duas perguntas diferentes são feitas em toda requisição:

| | **Autenticação** (authN) | **Autorização** (authZ) |
|---|---|---|
| Pergunta | *Quem é você?* | *O que você pode fazer?* |
| Entrada | uma **credencial**: senha, passkey, certificado, token | a identidade + uma **política** (papéis, escopos, posse) |
| Falha | `401 Unauthorized` | `403 Forbidden` (ou `404` para esconder a existência) |
| No BoxOffice | o serviço `auth` (um provedor de identidade) autentica o usuário; o gateway valida o token | `order` verifica que o pedido 1042 pertence a quem chama; rotas de `admin` exigem o papel `organizer` |

Vocabulário usado abaixo: um **principal** é a entidade autenticada (um usuário ou um workload); uma **credencial** é o que ele apresenta para provar quem é; um **token** é o que ele recebe depois de se autenticar e apresenta no lugar da credencial; uma **claim** é uma afirmação dentro de um token (`"sub": "acc-42"`). Um **bearer token** funciona para *quem o tiver em mãos*, como dinheiro vivo.

---

## Sessões vs tokens { #sessions-vs-tokens }

Depois do login, o servidor precisa reconhecer o usuário na próxima requisição. Duas famílias de projeto:

``` diagram
flowchart LR
    subgraph s ["Sessão no servidor"]
        B1(["Navegador"]) -->|"Cookie: sid=9f2c…"| A1["app"]
        A1 -->|"GET session:9f2c"| R[("Redis")]
    end
    subgraph t ["Token autocontido (JWT)"]
        B2(["App"]) -->|"Authorization: Bearer eyJ…"| A2["gateway"]
        A2 -->|"verifica a assinatura localmente<br/>(chave pública em cache)"| A2
    end
```

| | **Sessão no servidor** (id opaco → store) | **Token autocontido** (JWT) |
|---|---|---|
| O que o cliente guarda | um id de sessão aleatório | um documento assinado com as claims |
| Validação | consulta em um store compartilhado (Redis) | verificação de assinatura com uma chave pública, sem consulta |
| Revogação (logout, roubo) | imediata: apagar a chave | difícil: válido até `exp`, a menos que se acrescente uma denylist ou introspecção |
| Escala horizontal | precisa de um store compartilhado e altamente disponível | sem estado; qualquer instância valida |
| Uso entre serviços | os serviços precisam chamar o store de sessões | qualquer serviço com a chave pública verifica |
| Tamanho por requisição | ~32 bytes | frequentemente 0,5–2 KB em todo cabeçalho de requisição |
| Melhor para | aplicações web clássicas, o padrão BFF | APIs, apps mobile, serviço a serviço |

Nenhum dos dois é "o moderno". Sistemas grandes combinam os dois: um **JWT de vida curta** (minutos) para APIs e um **refresh token ou sessão revogável** guardado no servidor. A latência de revogação passa a ser igual ao tempo de vida do access token — um número que você escolhe.

??? question "Pense antes: o celular de uma usuária é roubado às 14:00 e ela faz logout pela web às 14:05. Access tokens vivem 15 minutos e são validados localmente. Até quando o ladrão consegue chamar a API?"

    O refresh token é revogado às 14:05, então o ladrão não consegue *novos* access tokens. Mas o último access token emitido — digamos às 13:58 — continua válido até as **14:13**, porque o gateway o valida localmente e não tem como saber do "logout". A janela de exposição é de até um tempo de vida de access token depois da revogação. Tokens mais curtos a reduzem; introspecção ou uma denylist (pelo `jti`, o id do token) a fecham, ao custo de uma consulta.

---

## JSON Web Token (JWT)

Um **JWT** (RFC 7519) é formado por três partes codificadas em Base64URL separadas por pontos: `header.payload.signature`. Decodificado, um access token do BoxOffice fica assim:

```text
header:  { "alg": "RS256", "typ": "at+jwt", "kid": "2026-10-a" }
payload: {
  "iss": "https://auth.boxoffice.com/realms/boxoffice",
  "sub": "acc-42",
  "aud": "boxoffice-api",
  "client_id": "boxoffice-mobile",
  "scope": "orders:read orders:write",
  "iat": 1792310400,
  "exp": 1792311300,
  "jti": "5b0e7c1a-6d1f-4c1e-9a43-0d6c2f6c9e10"
}
signature: RSASSA-PKCS1-v1_5( SHA-256( base64url(header) + "." + base64url(payload) ), private key )
```

O payload é **codificado, não criptografado** — qualquer um consegue lê-lo. Nunca coloque ali segredos ou dados pessoais que você não mostraria ao próprio usuário.

Com algoritmos **assimétricos** (RS256, ES256, EdDSA), o provedor de identidade assina com uma chave privada que nunca sai dele, e qualquer um verifica com a chave pública, publicada como um **JWKS** (JSON Web Key Set) no `jwks_uri` do provedor. Com HMAC **simétrico** (HS256), todo verificador tem o mesmo segredo e, portanto, também consegue **forjar** tokens — aceitável só quando emissor e verificador são o mesmo serviço.

### Checklist de validação { #validation-checklist }

A RFC 8725 (JWT Best Current Practices) é a referência[^1]. Um resource server precisa verificar:

| Verificação | Por quê |
|---|---|
| Assinatura com um **algoritmo de uma allow-list** (nunca `alg: none`, nunca deixar o cabeçalho do token escolher) | ataques de confusão de algoritmo forjam tokens |
| Chave escolhida pelo `kid` no **seu** JWKS, buscado de novo diante de um `kid` desconhecido | rotação de chaves sem indisponibilidade |
| `iss` igual ao seu provedor de identidade | tokens de outro emissor são rejeitados |
| `aud` contém **esta** API | um token emitido para outra API não pode ser reaproveitado aqui |
| `exp` e `nbf`, com uma pequena tolerância de relógio (≈ 30–60 s) | tokens expirados rejeitados |
| `typ` é `at+jwt` para access tokens (RFC 9068) | um ID token não pode ser usado como access token |
| **escopos / papéis** exigidos pelo endpoint | menor privilégio |

!!! example "No código do BoxOffice: o `auth` assina os tokens (lab 4)"

    No [Hands-on 4 — auth](../../../hands-on/4/auth/index.md), o BoxOffice ganha sua porta de entrada: o `auth` assina todo token com **RS256**, a chave privada nunca sai dele, e a chave pública é servida como JWKS em `/auth/.well-known/jwks.json`, para que o gateway verifique sem compartilhar um segredo que também permitiria forjar tokens. Compare as claims com a checklist: `iss`, `aud`, `sub`, `exp`, `jti` e o cabeçalho `kid` estão lá, e o papel vira uma claim `scope` (`user` ou `user admin`). Três atalhos, cada um com seu preço: `typ` é um `JWT` simples (ainda não há ID tokens com que confundi-lo); o par de chaves é gerado a cada inicialização, então reiniciar o `auth` rejeita todo token emitido antes (`kid` desconhecido) — o aviso do lab explica por que chaves reais vivem num KMS e giram com duas chaves no JWKS; e a validade é de 1 hora (`JWT_TTL`), sem refresh token, então um token roubado funciona por até uma hora, não 15 minutos.

    ``` { .java title="services/auth/src/main/java/boxoffice/auth/TokenService.java (signing a token)" }
    --8<-- "docs/2027.1/hands-on/4/code/services/auth/src/main/java/boxoffice/auth/TokenService.java:48:72"
    ```

---

## OAuth 2.1 { #oauth }

**OAuth** é um framework de **autorização delegada**: uma aplicação cliente obtém um **access token limitado e de vida curta** para chamar uma API em nome de um usuário — ou em nome próprio — **sem nunca manipular a senha do usuário**. O usuário se autentica apenas no authorization server[^2].

| Papel | Descrição | No BoxOffice |
|---|---|---|
| **Resource owner** | o usuário dono dos dados | Ana, uma fã |
| **Client** | a aplicação que pede acesso | app mobile, checkout web (BFF), job de conciliação, assistente de IA |
| **Authorization server** (AS) | autentica o usuário, pede consentimento, emite tokens | o serviço `auth` (Keycloak no curso; Auth0, Cognito, Entra ID na indústria) |
| **Resource server** (RS) | API que valida tokens e serve dados | gateway + `order`, `inventory`, … |

Clientes são **confidenciais** (rodam em um servidor, conseguem guardar um segredo: o BFF, um job em lote) ou **públicos** (rodam no dispositivo do usuário, não conseguem guardar segredo: o app mobile, uma single-page app — qualquer um pode descompilá-los ou lê-los).

### O que o OAuth 2.1 muda { #what-oauth-21-changes }

O OAuth 2.0 (RFC 6749, 2012) acumulou uma década de lições de segurança em documentos separados. O **OAuth 2.1** — um draft do IETF que os consolida, junto com a Security Best Current Practice (RFC 9700) — é o que sistemas novos devem seguir[^3][^4]:

| O OAuth 2.0 permitia | O OAuth 2.1 exige |
|---|---|
| Authorization Code com ou sem PKCE | **PKCE para todo cliente** que usa o authorization code, inclusive os confidenciais |
| Grant **Implicit** (token no fragmento da URL) | removido — tokens vazavam por histórico, referrers, logs |
| **Resource Owner Password Credentials** (o app coleta a senha) | removido — anula a delegação, impede MFA, ensina usuários a digitar senhas em qualquer lugar |
| redirect URIs comparadas por prefixo ou padrão | **comparação exata de strings** das redirect URIs |
| bearer tokens em query strings | **nunca** na URL; só no cabeçalho ou no corpo |
| refresh tokens de vida longa para clientes públicos | refresh tokens **vinculados ao remetente ou rotacionados** a cada uso |

### Escolhendo o grant { #choosing-the-grant }

``` diagram-sim
flowchart TD
    q1{"Há um usuário<br/>envolvido?"} -->|não| cc["Client Credentials<br/>(job de conciliação)"]
    q1 -->|sim| q2{"O dispositivo consegue<br/>abrir um navegador?"}
    q2 -->|sim| pkce["Authorization Code + PKCE<br/>(app mobile, BFF web)"]
    q2 -->|não| dev["Device Authorization<br/>(smart TV, CLI)"]
    pkce --> q3{"Um serviço precisa chamar outro<br/>em nome do usuário?"}
    q3 -->|sim| tx["Token Exchange<br/>(assistant → order)"]
```

---

## Authorization Code + PKCE para o app mobile { #authorization-code-pkce-for-the-mobile-app }

O app nunca vê a senha. Ele abre o **navegador do sistema** (não uma WebView embutida, onde o app poderia ler as teclas digitadas — RFC 8252[^5]) no authorization server, o usuário faz login lá (com MFA ou uma passkey), e o app recebe um **authorization code** de vida curta e uso único por meio de um redirecionamento. Depois o app troca o código por tokens em uma requisição direta, pelo back-channel.

O **PKCE** (Proof Key for Code Exchange, pronuncia-se "pixy", RFC 7636[^6]) amarra o código à instância do app que iniciou o fluxo:

1. O app gera um **`code_verifier`** aleatório (43–128 caracteres) e o mantém em memória.
2. Ele envia só **`code_challenge = BASE64URL(SHA-256(code_verifier))`** na requisição de autorização.
3. Na troca pelo token, envia o `code_verifier` original; o servidor calcula o hash e compara.

Um app malicioso que registrou o mesmo esquema de redirecionamento e intercepta o código não tem o verifier, então o código é inútil.

``` diagram-sim
sequenceDiagram
    autonumber
    actor Ana
    participant App as App BoxOffice
    participant Br as Navegador do sistema
    participant AS as auth (Keycloak)
    participant GW as API gateway
    participant O as order
    Ana->>App: toca em "Entrar"
    App->>App: cria state, nonce, code_verifier, code_challenge (S256)
    App->>Br: abre /authorize?response_type=code&client_id=boxoffice-mobile&scope=openid orders:write&code_challenge&state&nonce
    Br->>AS: GET /authorize
    AS->>Ana: página de login (senha + MFA, ou passkey)
    Ana->>AS: credenciais
    AS-->>Br: 302 https://app.boxoffice.com/cb?code=XYZ&state
    Br-->>App: redirecionamento entregue ao app (link HTTPS reivindicado)
    App->>App: confere o state
    App->>AS: POST /token {code, code_verifier, redirect_uri}
    AS->>AS: SHA-256(code_verifier) == code_challenge?
    AS-->>App: access_token (15 min) + refresh_token (rotativo) + id_token
    App->>GW: POST /orders  Authorization: Bearer access_token
    GW->>GW: verifica assinatura (JWKS em cache), iss, aud, exp, escopo
    GW->>O: POST /orders + X-Account-Id: acc-42
    O-->>App: 201 Created
```

O parâmetro `state` impede que um atacante injete o código *dele* na sessão da Ana (CSRF no callback); o `nonce` volta dentro do ID token e impede o reaproveitamento de um ID token antigo.

??? example "Calculando um par PKCE à mão"

    ```bash
    # 64 random URL-safe characters
    verifier=$(openssl rand -base64 48 | tr -d '=+/\n' | cut -c1-64)
    # BASE64URL(SHA-256(verifier)), without '=' padding
    challenge=$(printf '%s' "$verifier" | openssl dgst -sha256 -binary \
                | openssl base64 | tr '+/' '-_' | tr -d '=')
    echo "verifier=$verifier"; echo "challenge=$challenge"
    ```

**Onde o app mobile guarda os tokens.** O access token fica em memória; o refresh token, no armazenamento seguro da plataforma (Keychain no iOS, armazenamento apoiado no Keystore no Android). O authorization server **rotaciona** o refresh token a cada uso: se uma cópia roubada e o app legítimo tentarem usar o mesmo, o servidor detecta o reuso e revoga a família inteira.

---

## OpenID Connect: quem é o usuário? { #openid-connect-who-is-the-user }

O OAuth responde "este cliente pode chamar esta API?". De propósito, ele não diz ao *cliente* quem é o usuário — o access token é endereçado à API. O **OpenID Connect** (OIDC) acrescenta uma camada de identidade sobre o OAuth[^7]:

- o **escopo `openid`** na requisição de autorização;
- o **ID token** — um JWT endereçado **ao cliente** (`aud` = o seu `client_id`) com `sub`, `iss`, `exp`, `nonce`, `auth_time` e, com os escopos `profile`/`email`, nome e e-mail;
- o endpoint **UserInfo**, para mais claims de perfil;
- **discovery** em `/.well-known/openid-configuration`, que lista os endpoints e o `jwks_uri`, para que clientes e resource servers se configurem só a partir da URL do emissor.

| Token | Audiência | Propósito | Tempo de vida típico |
|---|---|---|---|
| **ID token** | o cliente | "quem fez login foi `acc-42`, às 14:02, com MFA" | minutos, usado uma vez no login |
| **Access token** | a API (resource server) | "este cliente pode `orders:write` para `acc-42`" | 5–60 minutos |
| **Refresh token** | só o authorization server | obter novos access tokens sem novo login | de horas a semanas, rotacionado |

### Checkout web: OIDC por meio de um Backend-for-Frontend { #web-checkout-oidc-through-a-backend-for-frontend }

Para o navegador, a recomendação atual é **não deixar token nenhum no JavaScript**. Um **BFF** (Backend for Frontend) é um cliente confidencial no servidor: ele roda o fluxo OIDC, guarda os tokens e dá ao navegador só um cookie de sessão `HttpOnly`, `Secure`, `SameSite`[^8].

``` diagram-sim
sequenceDiagram
    autonumber
    actor Ana
    participant Br as Navegador (SPA do checkout)
    participant BFF as BFF web (cliente confidencial)
    participant AS as auth (provedor OIDC)
    participant GW as API gateway
    Ana->>Br: clica em "Entrar"
    Br->>BFF: GET /login
    BFF-->>Br: 302 para o AS /authorize (code + PKCE, escopo openid, nonce)
    Br->>AS: login (passkey)
    AS-->>Br: 302 para o BFF /callback?code&state
    Br->>BFF: GET /callback?code&state
    BFF->>AS: POST /token {code, code_verifier, segredo do cliente ou private_key_jwt}
    AS-->>BFF: id_token + access_token + refresh_token
    BFF->>BFF: valida o id_token (assinatura, iss, aud, exp, nonce), guarda os tokens no servidor
    BFF-->>Br: Set-Cookie: session=… HttpOnly Secure SameSite=Lax
    Br->>BFF: GET /api/orders (cookie)
    BFF->>GW: GET /orders  Bearer access_token
    GW-->>BFF: 200 pedidos
    BFF-->>Br: 200 pedidos
```

| Onde o navegador guarda credenciais | Legível por JS? | Principal risco |
|---|---|---|
| `localStorage` / `sessionStorage` | sim | qualquer XSS (cross-site scripting) rouba o token |
| cookie `HttpOnly` com o token | não | CSRF (cross-site request forgery); mitigado por `SameSite` + tokens CSRF |
| cookie de sessão do BFF, tokens no servidor | nenhum token no navegador | roubo de sessão; o BFF é um componente a mais para escalar |

---

## Máquinas e delegação { #delegation }

### Client Credentials: o job de conciliação { #client-credentials-the-reconciliation-job }

Quando não há usuário envolvido, o cliente se autentica **como ele mesmo** e recebe um token que representa o *serviço*. O job de conciliação de `order` pede exatamente o escopo de que precisa:

```bash
curl -s -X POST https://auth.boxoffice.com/realms/boxoffice/protocol/openid-connect/token \
  -d grant_type=client_credentials \
  -d client_id=order-reconciler \
  -d client_secret="$ORDER_RECONCILER_SECRET" \
  -d scope=inventory:read
```

Melhor que um client secret: autenticar o cliente com um **JWT assinado** (`private_key_jwt`) ou com a sua **identidade de workload** (certificado mTLS ou o token da service account do Kubernetes) — nenhum segredo compartilhado para vazar ([Zero Trust](../../network-security/zero-trust/index.md)).

### Token Exchange: o assistente agindo pelo usuário { #token-exchange-the-assistant-acting-for-the-user }

O `assistant` de IA precisa chamar `order` *em nome da Ana*, com menos poder que o próprio token da Ana. O **Token Exchange** (RFC 8693) permite que um serviço troque o token que recebeu por um novo, com outra audiência e escopo mais estreito (`aud=order`, `scope=orders:read`), mantendo `sub=acc-42` e registrando o ator (`act: assistant`). O log de auditoria então mostra "assistant, agindo por acc-42, leu o pedido 1042".

### Tokens vinculados ao remetente { #sender-constrained-tokens }

Um bearer token funciona para quem o roubar. Tokens **vinculados ao remetente** (*sender-constrained*) ficam amarrados a uma chave que o cliente legítimo possui: com **DPoP** (RFC 9449), o cliente assina uma pequena prova a cada requisição com uma chave privada no dispositivo; com **tokens vinculados a mTLS** (RFC 8705), o token fica amarrado ao certificado do cliente. Um token roubado sozinho fica inútil. APIs de nível financeiro os exigem; no BoxOffice, valem a pena nos endpoints de pagamento.

### Passkeys

**Passkeys** (WebAuthn/FIDO2) substituem senhas por um par de chaves por site, guardado no dispositivo e desbloqueado por biometria. A chave privada nunca sai do dispositivo e a assinatura fica amarrada à origem do site, então elas resistem a phishing. Elas mudam *como o usuário se autentica no authorization server*; os fluxos OAuth/OIDC depois disso continuam iguais.

---

## Validando tokens no gateway { #gateway-validation }

O gateway é o primeiro **ponto de aplicação** (*enforcement point*): ele rejeita requisições sem token válido e repassa uma identidade confiável para dentro (veja [Borda — API gateway](../api-gateway/index.md)).

| | **Validação local (JWKS)** | **Validação remota (introspecção, RFC 7662)** |
|---|---|---|
| Salto extra | nenhum — assinatura verificada com uma chave pública em cache | uma chamada ao AS por requisição (cacheável por segundos) |
| Indisponibilidade do AS | as requisições continuam funcionando | toda requisição falha (ou usa o cache) |
| Revogação | efetiva só em `exp` | imediata |
| Tipo de token | JWT | JWT ou opaco |
| Uso típico | a maior parte do tráfego de API | operações sensíveis, tokens opacos |

Com Spring Security (também no Spring Cloud Gateway), a validação local é configuração:

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: https://auth.boxoffice.com/realms/boxoffice  # discovers jwks_uri, checks iss
          audiences: boxoffice-api                                 # rejects tokens for other APIs
```

!!! warning "Remova cabeçalhos de identidade na borda"
    Se o gateway repassa `X-Account-Id: acc-42` aos serviços, ele precisa **remover** qualquer `X-Account-Id` enviado pelo cliente, e os serviços devem ser inalcançáveis a não ser pelo gateway (ou devem verificar o token por conta própria). Caso contrário, qualquer um que alcance um serviço diretamente pode se passar por qualquer usuário.

!!! example "No código do BoxOffice: o gateway confere o token uma vez (lab 4)"

    O [Hands-on 4 — gateway](../../../hands-on/4/gateway/index.md) usa **validação local**: o decoder busca o JWKS do `auth` e então confere a assinatura, `exp`/`nbf`, `iss` e `aud` de cada requisição sem chamar o `auth`. Essa é a razão da escolha: um login é caro de propósito (BCrypt; o lab mede algo como 10–20 logins/s por CPU), então acontece uma vez por sessão, enquanto os 2 milhões de requisições da abertura de vendas custam só uma verificação de assinatura no gateway — a introspecção poria o `auth` no caminho de cada uma delas. O preço é a revogação só no `exp`. O `UserHeadersFilter` implementa o aviso acima: remove qualquer cabeçalho `X-User-*` enviado pelo cliente e então define a identidade tirada do token validado. A outra metade do aviso vale só pela implantação: as réplicas do `catalog` não publicam porta, então, de fora, o gateway é o único caminho — mas qualquer contêiner na mesma rede ainda pode enviar um `X-User-Id` forjado, a brecha que o [Zero Trust](../../network-security/zero-trust/index.md) fecha.

    ``` { .java title="services/gateway/src/main/java/boxoffice/gateway/SecurityConfig.java (the JWT decoder)" }
    --8<-- "docs/2027.1/hands-on/4/code/services/gateway/src/main/java/boxoffice/gateway/SecurityConfig.java:42:52"
    ```

    ``` { .java title="services/gateway/src/main/java/boxoffice/gateway/UserHeadersFilter.java (strip, then set)" }
    --8<-- "docs/2027.1/hands-on/4/code/services/gateway/src/main/java/boxoffice/gateway/UserHeadersFilter.java:21:44"
    ```

---

## Modelos de autorização { #authorization-models }

A autenticação produziu uma identidade. Agora: *esta* identidade pode fazer *esta* ação sobre *este* objeto?

| Modelo | Decide por | Exemplo no BoxOffice | Bom para | Fraco em |
|---|---|---|---|---|
| **RBAC** (baseado em papéis) | os papéis do usuário | `organizer` pode criar eventos; `support` pode ler qualquer pedido | permissões amplas e estáveis | regras por objeto ("só os eventos *dele*") |
| **ABAC** (baseado em atributos) | atributos do usuário, do recurso, do contexto | estornos permitidos se `order.eventDate > now + 48h` e `user.country == order.country` | regras ricas e contextuais | difícil auditar "quem consegue acessar X?" |
| **ReBAC** (baseado em relacionamentos) | um grafo de relacionamentos | Ana pode ver o pedido 1042 porque é *dona* dele; Bruno, porque Ana *compartilhou* o ingresso com ele | compartilhamento, organizações, hierarquias | precisa de um store de relacionamentos (Google Zanzibar, OpenFGA, SpiceDB) |

**Escopos OAuth** não são substitutos: um escopo limita o que o *cliente* pode fazer (`orders:read`), não quais *objetos* o usuário pode tocar. A verificação de posse — a correção do OWASP **API1: BOLA** — sempre roda no serviço que é dono dos dados[^9]:

=== "No código (serviço order)"

    ```java
    @GetMapping("/orders/{id}")
    @PreAuthorize("hasAuthority('SCOPE_orders:read')")
    public OrderOut get(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        Order order = repository.findById(id)
            .filter(o -> o.getAccountId().equals(jwt.getSubject()))  // ownership (BOLA)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        return OrderOut.from(order);                                 // explicit DTO (BOPLA)
    }
    ```

=== "Política como código (OPA / Rego)"

    ```rego
    package boxoffice.orders

    import rego.v1

    default allow := false

    # owners can read their own orders
    allow if {
        input.action == "read"
        input.resource.owner_id == input.user.sub
    }

    # support staff can read any order, never modify it
    allow if {
        input.action == "read"
        "support" in input.user.roles
    }
    ```

=== "Política como código (Cedar)"

    ```cedar
    permit (
      principal,
      action == Action::"ReadOrder",
      resource
    )
    when { resource.owner == principal };

    permit (
      principal in Role::"support",
      action == Action::"ReadOrder",
      resource
    );
    ```

Motores de política (OPA, Cedar, OpenFGA) tiram as regras do código e as colocam em um artefato revisável e testável, compartilhado por vários serviços. O serviço continua fazendo a pergunta para cada objeto.

!!! tip "Na entrevista"
    Sempre que o projeto tiver usuários, diga de uma vez: "os usuários fazem login por um **provedor OIDC**; o app mobile usa **Authorization Code com PKCE**; o gateway valida localmente **access tokens JWT de vida curta** contra o JWKS do provedor; os refresh tokens são rotacionados; chamadas entre serviços usam **client credentials** ou a identidade do mesh; e todo serviço verifica a **posse do objeto**." Se perguntarem sobre logout ou revogação, explique o trade-off entre validação local e introspecção — e a janela de exposição igual ao tempo de vida do token.

!!! success "Boas práticas"

    - **Emita access tokens que vivam 5–15 minutos, com refresh tokens rotativos** — a latência de revogação é igual à validade do token. No BoxOffice: o lab 4 emite tokens de 1 hora sem refresh token, um atalho nomeado no quadro do `auth`, acima.
    - **Valide tokens localmente contra um JWKS em cache, buscando-o de novo quando chega um `kid` desconhecido** — nenhuma chamada ao provedor de identidade por requisição, e a rotação de chaves não exige indisponibilidade. No BoxOffice: o `NimbusReactiveJwtDecoder` do gateway ([quadro do gateway](#gateway-validation)).
    - **Gire as chaves de assinatura com agenda e publique a chave antiga e a nova no JWKS durante a sobreposição** — tokens assinados antes da rotação continuam válidos até expirar. (O lab 4, em vez disso, cria uma chave nova a cada inicialização, e todo token morre com ela.)
    - **Remova no gateway os cabeçalhos de identidade enviados pelo cliente antes de acrescentar os seus** — no BoxOffice: o `UserHeadersFilter` remove `X-User-*` primeiro ([quadro do gateway](#gateway-validation)).
    - **Faça hash das senhas com uma função lenta e ajustável e limite a taxa de login** — BCrypt com custo ≥ 10 ou Argon2id; no [lab 4](../../../hands-on/4/auth/index.md), BCrypt com custo 10 limita o `auth` a algo como 10–20 logins/s por CPU, então os logins precisam acontecer antes das 10:00, não às 10:00.

!!! warning "Armadilhas comuns"
    - **Grants Implicit ou de senha (ROPC)** em código novo — removidos no OAuth 2.1; use Authorization Code + PKCE.
    - **Pular o `aud`** — um token emitido para outra API é aceito pela sua.
    - **Access tokens de vida longa** (24 h) — um bearer token roubado vira uma chave-mestra por 24 horas.
    - **Tokens no `localStorage`** ou em URLs e logs — XSS e vazamentos por log.
    - **Chamar APIs com o ID token** — ele é para o cliente; APIs aceitam só access tokens.
    - **Autorização só no gateway** — BOLA: `GET /orders/{id}` devolve qualquer pedido a qualquer usuário logado.
    - **Compartilhar um segredo HMAC entre serviços** — todo verificador consegue forjar tokens.

---

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    AS["auth: provedor OIDC<br/>(servidor de autorização)"] --> PKCE["Authorization Code + PKCE<br/>app mobile, BFF web"]
    AS --> CC["Client Credentials<br/>job de reconciliação"]
    AS --> TX["Token Exchange<br/>assistant → order"]
    PKCE --> JWT["access token JWT de vida curta<br/>+ refresh token rotativo"]
    PKCE --> SESS["cookie de sessão do BFF<br/>store compartilhado → Caching"]
    JWT --> GW["gateway valida via JWKS<br/>iss, aud, exp → Borda"]
    GW --> SVC["cada serviço verifica a posse<br/>RBAC / ABAC / ReBAC"]
    SVC --> BOLA["corrige OWASP API1 (BOLA)"]
    CC --> WI["identidade de workload<br/>→ Zero Trust"]
    TX --> AI["agentes agindo pelo usuário<br/>→ Sistemas de IA"]
```

**Componentes da paleta:** [`auth`](../../../reference/components/compute/index.md#auth) · [`apigw`](../../../reference/components/edge/index.md#apigw) (o primeiro ponto de aplicação) · [`client`](../../../reference/components/client/index.md#client) · [`mobile`](../../../reference/components/client/index.md#mobile) · [`cache`](../../../reference/components/storage/index.md#cache) (sessões no servidor) · [`orchestrator`](../../../reference/components/ai/index.md#orchestrator) (o assistente agindo em nome do usuário). **Cenários:** `rate-limiter`, `flash-sale`, `ai-assistant`. **Continua em:** [Borda — API gateway](../api-gateway/index.md), [Zero Trust](../../network-security/zero-trust/index.md#workload-identity), [Caching — Redis](../../caching/redis/index.md), [Sistemas de IA — agentes](../../ai-systems/agents/index.md), [Hands-on 4 — Gateway e identidade](../../../hands-on/4/index.md).

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - **AuthN** (quem) ≠ **authZ** (o quê). O gateway autentica; cada serviço ainda autoriza o acesso aos seus próprios objetos.
    - **Sessões** revogam na hora, mas precisam de um store compartilhado; **JWTs** escalam sem estado, mas continuam válidos até `exp`. Combine access tokens curtos com refresh tokens revogáveis.
    - Valide JWTs direito: algoritmo de uma allow-list, `kid` do seu JWKS, `iss`, `aud`, `exp`, `typ`, escopos.
    - **OAuth 2.1**: Authorization Code + **PKCE** para todo cliente com usuário (navegador do sistema no mobile, BFF na web), **Client Credentials** para jobs, **Token Exchange** para delegação; nada de Implicit nem ROPC.
    - **OIDC** acrescenta o ID token, o UserInfo e o discovery. Escolha RBAC, ABAC ou ReBAC para autorização, e sempre verifique a posse (BOLA).

---

[^1]: SHEFFER, Y.; HARDT, D.; JONES, M. [RFC 8725 — JSON Web Token Best Current Practices](https://datatracker.ietf.org/doc/html/rfc8725){target="_blank"}. IETF, 2020. Veja também a [RFC 9068 — JWT Profile for OAuth 2.0 Access Tokens](https://datatracker.ietf.org/doc/html/rfc9068){target="_blank"}.
[^2]: HARDT, D. (ed.). [RFC 6749 — The OAuth 2.0 Authorization Framework](https://datatracker.ietf.org/doc/html/rfc6749){target="_blank"}. IETF, 2012.
[^3]: HARDT, D.; PARECKI, A.; LODDERSTEDT, T. [The OAuth 2.1 Authorization Framework](https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/){target="_blank"}. IETF Internet-Draft.
[^4]: LODDERSTEDT, T. et al. [RFC 9700 — Best Current Practice for OAuth 2.0 Security](https://datatracker.ietf.org/doc/html/rfc9700){target="_blank"}. IETF, 2025.
[^5]: DENNISS, W.; BRADLEY, J. [RFC 8252 — OAuth 2.0 for Native Apps](https://datatracker.ietf.org/doc/html/rfc8252){target="_blank"}. IETF, 2017.
[^6]: SAKIMURA, N.; BRADLEY, J.; AGARWAL, N. [RFC 7636 — Proof Key for Code Exchange by OAuth Public Clients](https://datatracker.ietf.org/doc/html/rfc7636){target="_blank"}. IETF, 2015.
[^7]: SAKIMURA, N. et al. [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html){target="_blank"}. OpenID Foundation.
[^8]: PARECKI, A.; DE RYCK, P. [OAuth 2.0 for Browser-Based Applications](https://datatracker.ietf.org/doc/draft-ietf-oauth-browser-based-apps/){target="_blank"}. IETF Internet-Draft.
[^9]: OWASP. [API1:2023 — Broken Object Level Authorization](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/){target="_blank"}.
