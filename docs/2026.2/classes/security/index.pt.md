# Segurança: OAuth 2.0, OIDC e Zero Trust

No [Hands-on 3](../../hands-on/3/index.md) protegemos a loja com um esquema caseiro: o `auth-service` verifica a senha, assina um JSON Web Token (JWT) com um segredo HMAC e o devolve em um cookie; a cada requisição, o gateway pede ao `auth-service` que resolva o token e repassa o id de quem chamou no header `id-account`. Isso funciona para uma aplicação web com um formulário de login. Agora a loja quer **"Entrar com Google"**, um **aplicativo móvel**, um **job noturno** que chama o `order-service` sem nenhum usuário por trás e — um dia — uma biblioteca vulnerável permite que um atacante execute código dentro do pod do `product-service`. O esquema caseiro não tem resposta para nenhum desses casos.

O JWT é um formato de transporte — ele carrega claims como "esta é a conta 42". Ele não diz nada sobre como o usuário provou sua identidade, quem pode emitir tokens, como um aplicativo de terceiros obtém acesso sem ver a senha, ou por que um serviço deveria confiar em uma chamada vinda de outro. **OAuth 2.0** e **OpenID Connect** são os padrões que preenchem essas lacunas; **Zero Trust** é a arquitetura que deixa de confiar na própria rede: desconfie de tudo, verifique sempre.

!!! abstract "Objetivos de aprendizagem"

    Ao final desta aula, você deverá ser capaz de:

    - **Distinguir** autenticação de autorização e apontar qual componente da loja realiza cada uma.
    - **Explicar** os quatro papéis do OAuth 2.0 e **escolher** o grant adequado (Authorization Code + PKCE, Client Credentials, Device Code) para um dado cliente.
    - **Comparar** access tokens, refresh tokens e ID tokens, e explicar o que o OpenID Connect acrescenta ao OAuth 2.0.
    - **Configurar** um gateway para validar JWTs localmente com um JWKS e **compará-lo** com a validação remota (`/auth/solve`) usada no Hands-on 3.
    - **Aplicar** controles de Zero Trust — mTLS, NetworkPolicy, privilégio mínimo — ao tráfego entre serviços no Kubernetes.
    - **Escolher** uma abordagem de gestão de segredos e explicar por que um Secret do Kubernetes em base64 não é criptografia.

!!! warning "Pré-requisito"
    Esta aula se apoia nos conceitos de JWT do [Hands-on 3](../../hands-on/3/index.md). Antes de lê-la, certifique-se de que você domina a estrutura do JWT (header.payload.signature), as claims `sub`, `exp` e `iss` e a forma como o gateway valida tokens — veja [Hands-on 3 — JWT](../../hands-on/3/jwt/index.md) e [Hands-on 3 — Autorização](../../hands-on/3/authorization/index.md).

## Slides

<div class="slides-embed">
  <iframe src="slides/security.html" title="Slides: segurança — oauth2 e zero trust" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/security.html){:target="_blank"}

---

## Roteiro

1. **Visão geral** (esta página) — autenticação vs. autorização, o que o Hands-on 3 construiu, o que o JWT sozinho não resolve e o mapa das camadas de segurança da loja.
2. [OAuth 2.0 e OpenID Connect](oauth/index.md) — papéis, tokens e escopos, tipos de grant (Authorization Code + PKCE, Client Credentials), OIDC e o ID Token, e como o gateway valida tokens (JWKS vs. introspecção).
3. [Zero Trust, mTLS e segredos](zero-trust/index.md) — perímetro vs. Zero Trust, TLS mútuo e identidade de workload, NetworkPolicy do Kubernetes e gestão de segredos.

---

## Autenticação vs. autorização

Duas perguntas são feitas a cada requisição, e elas costumam ser confundidas:

| | **Autenticação** (authN) | **Autorização** (authZ) |
|---|---|---|
| Pergunta | *Quem é você?* | *O que você pode fazer?* |
| Entrada | uma **credencial**: senha, certificado, token | a identidade autenticada + uma **política** (papéis, escopos, propriedade) |
| Falha | `401 Unauthorized` (credencial ausente ou inválida) | `403 Forbidden` (identidade válida, ação não permitida) |
| Na loja | o `auth-service` verifica e-mail + senha em `POST /auth/login`; o gateway verifica o token em cada requisição | o `order-service` verifica se o pedido `123` pertence ao `id-account` que o solicitou |

Alguns termos usados ao longo da aula:

- **Principal** — a entidade autenticada: um usuário (`ada@store.com`) ou um workload (`order-service`).
- **Credencial** — o que um principal apresenta para provar sua identidade (uma senha, uma chave privada, um token).
- **Token** — uma string emitida após a autenticação, que o principal apresenta no lugar da credencial. Um **bearer token** dá acesso a *quem o possuir*, como dinheiro vivo: roube-o e você pode gastá-lo.
- **Claim** — uma afirmação dentro de um token, como `"sub": "42"` ou `"scope": "orders:read"`.

!!! warning "A autorização não é feita uma única vez no gateway"
    O gateway pode dizer "esta é a conta 42". Só o `order-service` sabe se o pedido `123` pertence à conta 42. Esquecer essa verificação — `GET /orders/123` devolve qualquer pedido a qualquer usuário logado — é **Broken Object Level Authorization**, o risco número um do OWASP API Security Top 10 (2023)[^1].

---

## O que o Hands-on 3 construiu

O fluxo abaixo é o que você implementou: o token é uma **referência** que só o `auth-service` consegue ler, e o gateway pergunta por ela a cada chamada.

``` mermaid-sim
sequenceDiagram
    autonumber
    actor B as Navegador
    participant GW as gateway-service
    participant AU as auth-service
    participant AC as account-service
    B->>GW: POST /auth/login {email, password}
    GW->>AU: encaminha (rota aberta)
    AU->>AU: verifica a senha, assina o JWT (segredo HMAC)
    AU-->>B: Set-Cookie: __store_jwt_token
    B->>GW: GET /accounts/me + cookie
    GW->>AU: POST /auth/solve {token}
    AU-->>GW: {idAccount}
    GW->>AC: GET /accounts/me + header id-account
    AC-->>B: 200 OK
```

É um design sólido para uma única aplicação, e ele tem três propriedades que vale nomear:

- **Assinatura simétrica (HMAC, por exemplo HS256)** — o mesmo segredo assina e verifica. Só o `auth-service` guarda a `JWT_SECRET_KEY`, então só ele pode validar tokens; é por isso que o gateway precisa chamá-lo.
- **Validação remota** — um salto de rede extra por requisição, mas o `auth-service` pode recusar um token imediatamente (por exemplo, após o logout).
- **Confiança na rede** — o `account-service` acredita em qualquer header `id-account`, porque só o gateway consegue alcançá-lo dentro da rede Docker.

## O que o JWT sozinho não resolve

| Problema | JWT caseiro (Hands-on 3) | Resposta padrão | Onde |
|---|---|---|---|
| Login por terceiros ("Entrar com Google") | ✗ não há como delegar | fluxo Authorization Code + PKCE | [OAuth](oauth/index.md#authorization-code-pkce) |
| Chamadas entre serviços sem usuário | ✗ não há padrão; os serviços reaproveitam o token de um usuário ou uma senha compartilhada | grant Client Credentials | [OAuth](oauth/index.md#client-credentials) |
| Permitir que outros serviços verifiquem tokens por conta própria | ✗ o segredo HMAC teria de ser copiado para todos os serviços | chaves assimétricas publicadas como JWKS | [OAuth](oauth/index.md#local-validation-with-jwks) |
| Revogar um token antes de ele expirar | só com uma verificação remota a cada chamada | access tokens de vida curta + refresh tokens; introspecção | [OAuth](oauth/index.md#token-lifecycle) |
| Identidade de usuário padronizada para o aplicativo cliente | ✗ claims improvisadas | ID Token do OIDC + endpoint UserInfo | [OAuth](oauth/index.md#openid-connect-oidc) |
| Um pod comprometido chamando outros serviços | ✗ a rede interna é confiável | mTLS, NetworkPolicy, políticas de autorização | [Zero Trust](zero-trust/index.md) |

---

## As camadas de segurança da loja

Nenhum controle isolado protege um sistema. A **defesa em profundidade** empilha camadas independentes, de modo que um atacante que vença uma ainda enfrente a próxima. O diagrama acompanha uma requisição desde a Internet até os dados:

``` mermaid-sim
flowchart LR
    U(["Cliente"]) -->|"HTTPS (TLS)"| GW["Gateway<br>valida o token"]
    IdP["Provedor de identidade<br>(auth-service / Keycloak)"] -->|"emite tokens"| U
    GW -->|"header de identidade<br>(mTLS interno)"| SVC["order-service<br>verifica a propriedade"]
    SVC -->|"permitido pela<br>NetworkPolicy"| PS["product-service"]
    SVC -->|"credencial de BD<br>de vida curta"| DB[("Postgres")]
```

| Camada | Ameaça | Controle | Onde no curso |
|---|---|---|---|
| Borda | interceptação, abuso | TLS, rate limiting | [Hands-on 2 — Gateway](../../hands-on/2/index.md), [Hands-on 7 — Nginx](../../hands-on/7/index.md) |
| Identidade | credenciais roubadas ou forjadas | OAuth 2.0 / OIDC, tokens de vida curta | [OAuth 2.0 e OIDC](oauth/index.md), [Hands-on 3](../../hands-on/3/index.md) |
| Requisição | usuário lê dados de outra pessoa | autorização em cada serviço (propriedade, papéis, escopos) | esta página |
| Entre serviços | movimento lateral a partir de um pod comprometido | mTLS, NetworkPolicy, políticas de autorização | [Zero Trust](zero-trust/index.md), [Hands-on 5](../../hands-on/5/index.md) |
| Dados | senhas e chaves vazadas | gerenciador de segredos, criptografia em repouso | [Zero Trust — Segredos](zero-trust/index.md#secrets-management) |

!!! warning "Erros comuns"
    - **Segurança só no gateway.** Se algum serviço for alcançável sem passar pelo gateway (um `NodePort`, uma porta de debug, um Ingress mal configurado), qualquer um pode enviar `id-account: <any id>` e se passar por qualquer usuário.
    - **Criar sua própria criptografia ou protocolo.** Hash, assinatura e fluxos de token são sutis; use uma biblioteca consolidada (JJWT, Spring Security) e um fluxo padrão.
    - **Bearer tokens de vida longa.** O Hands-on 3 emite tokens de 24 horas; um token roubado vale por um dia. Access tokens curtos com refresh tokens reduzem essa janela.

---

## Pontos-chave

- A **autenticação** responde *quem*, a **autorização** responde *o quê*; o gateway autentica, mas cada serviço ainda precisa autorizar o acesso aos seus próprios objetos.
- Um JWT é só um **formato**. O OAuth 2.0 define **como os tokens são obtidos e delegados**; o OIDC acrescenta uma **identidade** padronizada (ID Token).
- O Hands-on 3 usa uma chave **simétrica** e validação **remota**; implantações padrão usam chaves **assimétricas** e um **JWKS**, para que qualquer serviço valide localmente.
- O **Zero Trust** elimina a suposição de que a rede interna é segura: toda chamada carrega uma identidade verificável e é checada contra uma política.
- Segurança é feita em **camadas**: TLS na borda, tokens para usuários, mTLS e NetworkPolicy entre serviços, um gerenciador de segredos para as credenciais.

[^1]: OWASP. [API1:2023 — Broken Object Level Authorization](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/){target="_blank"}. OWASP API Security Top 10, 2023.
