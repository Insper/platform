---
marp: true
lang: pt-BR
title: Segurança — OAuth2 e Zero Trust
description: Plataformas, Microsserviços, DevOps e APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Plataformas, Microsserviços, DevOps e APIs · Insper</div>

# Segurança — OAuth2 e Zero Trust

**Delegue a identidade a um padrão, verifique cada requisição**

<!--
Roteiro: (1) do Hands-on 3 às lacunas de um esquema caseiro; (2) authN vs. authZ;
(3) papéis, tokens, escopos e grants do OAuth 2.0; (4) PKCE e Client Credentials; (5) OIDC;
(6) JWKS vs. introspecção no gateway; (7) Zero Trust, mTLS, NetworkPolicy; (8) segredos.
-->

---

## O Hands-on 3 funciona — até deixar de funcionar

<div class="q">

O `auth-service` assina um JWT HMAC em um cookie; o gateway chama `/auth/solve` e repassa o `id-account`.
Agora a loja quer **login com Google**, um **app móvel**, um **job noturno**… e um pod é **invadido**. O que quebra?

</div>

* O app teria de ver a **senha do Google** — não há como delegar.
* O job **não tem usuário** — o token de quem ele envia?
* O pod invadido envia `id-account: <anyone>` — a rede interna é **confiável**.

<!--
Deixe a turma responder primeiro. Cada item corresponde a uma parte da aula: OAuth, Client Credentials, Zero Trust.
-->

---

## Autenticação vs. autorização

| | **Autenticação** (authN) | **Autorização** (authZ) |
|---|---|---|
| Pergunta | *quem é você?* | *o que você pode fazer?* |
| Falha | `401 Unauthorized` | `403 Forbidden` |
| Na loja | login no `auth-service`; verificação do token no gateway | `order-service`: o pedido 123 pertence a este `id-account`? |

<div class="warn">

O gateway **autentica**; cada serviço ainda precisa **autorizar** os próprios objetos. Pular isso = Broken Object Level Authorization, nº 1 do OWASP API Top 10.

</div>

<p class="small">Bearer token: quem o possui pode usá-lo — como dinheiro vivo.</p>

---

## O que o JWT sozinho não resolve

| Problema | JWT caseiro | Resposta padrão |
|---|---|---|
| Login por terceiros (Google) | não delega | **Authorization Code + PKCE** |
| Entre serviços, sem usuário | reusa token de usuário | **Client Credentials** |
| Outros serviços verificam tokens | segredo HMAC copiado em todo lugar | chaves assimétricas + **JWKS** |
| Revogar antes de expirar | verificação remota a cada chamada | access curto + **refresh** token |
| Identidade padrão do usuário | claims improvisadas | **ID Token** do OIDC |
| Pod comprometido | rede interna confiável | **mTLS**, **NetworkPolicy** |

<p class="small">JWT é um <b>formato</b>. OAuth 2.0 e OIDC definem como tokens são obtidos, delegados e considerados confiáveis.</p>

---

## OAuth 2.0: papéis

| Papel | Na loja |
|---|---|
| **Resource Owner** — o usuário | Ada, uma cliente |
| **Client** — app que pede acesso | frontend web, app móvel, job noturno |
| **Authorization Server** — emite tokens | Keycloak, Auth0, Cognito (ou `auth-service`) |
| **Resource Server** — API, valida tokens | `order-service`, `account-service` |

- **Cliente confidencial**: roda em um servidor, consegue guardar um `client_secret`.
- **Cliente público**: SPA ou app móvel — não consegue guardar um segredo.

<div class="ok">

**Autorização delegada**: o cliente recebe um token limitado **sem jamais ver a senha**.

</div>

---

## Tokens e escopos

| Token | Vai para | Validade |
|---|---|---|
| **Access token** — `Authorization: Bearer …` | Resource Server | 5–60 min |
| **Refresh token** — obtém novos access tokens | só o Authorization Server | de horas a semanas |
| **ID token** (OIDC) — quem é o usuário | só o Client | minutos |

- **Escopo**: permissão com a qual o usuário consente — `openid`, `email`, `orders:read`.
- O Spring transforma escopos em authorities: `hasAuthority('SCOPE_orders:read')`.
- Access tokens curtos limitam o estrago de um roubo; **rotacione** os refresh tokens.

---

## Tipos de grant

| Grant | Caso de uso | Situação |
|---|---|---|
| **Authorization Code + PKCE** | qualquer app em que um usuário faz login | padrão |
| **Client Credentials** | entre serviços, sem usuário | padrão para M2M |
| **Device Authorization** | smart TV, CLI | nicho |
| **Implicit** | SPAs antigas, token na URL | descontinuado |
| **Password (ROPC)** | o cliente coleta a senha | **não deve ser usado** |

<p class="small">Escolha: há usuário? não → Client Credentials · tem navegador? sim → Code + PKCE · não → Device.</p>

<div class="warn">

**Nunca ROPC**: anula a delegação e impede MFA — a RFC 9700 o proíbe; o rascunho do OAuth 2.1 o remove.

</div>

---

<!-- _class: tight -->

## Authorization Code + PKCE

1. O app cria `state`, um `code_verifier` aleatório e `code_challenge = BASE64URL(SHA-256(verifier))`.
2. Redireciona → `/authorize?response_type=code&client_id&code_challenge&state`.
3. O usuário faz login **no Authorization Server** (Keycloak), nunca no app.
4. Volta com `?code=AUTH_CODE&state` — o app confere o `state`.
5. App → `POST /token {code, code_verifier}` → `access_token`, `refresh_token`, `id_token`.
6. App → `GET /orders` com `Bearer access_token`; a API o verifica com o JWKS em cache.

<div class="ok">

Um código interceptado é **inútil** sem o verifier, que nunca saiu do app.

</div>

<!--
Destaque o passo 5: o servidor calcula o hash do verifier e o compara com o challenge do passo 2.
-->

---

## Client Credentials: um serviço como ele mesmo

```bash
curl -X POST http://keycloak:8080/realms/store/protocol/openid-connect/token \
  -d grant_type=client_credentials \
  -d client_id=order-service \
  -d client_secret="$ORDER_SERVICE_SECRET" \
  -d scope=stock:read
```

- O token diz `sub=order-service`, `scope=stock:read` — não é uma pessoa.
- O `product-service` o verifica e checa o escopo.
- **Nunca pegue emprestado o token de um usuário** para tarefas em segundo plano: sem trilha de auditoria, permissões demais.

---

## OpenID Connect

OAuth 2.0: *este cliente pode acessar este recurso?* O OIDC acrescenta: **quem é este usuário?**

- o **escopo** `openid`; o **ID Token** (um JWT para o cliente); **UserInfo** — `GET /userinfo`.

| Claim | Significado |
|---|---|
| `sub` / `iss` | id estável do usuário · URL do issuer |
| `aud` | deve conter o `client_id` do cliente |
| `exp` / `iat` | expiração / emissão |
| `nonce` | devolvido de volta — impede reusar um ID token antigo |

<p class="small">Descoberta: <code>GET /.well-known/openid-configuration</code> → endpoints e <code>jwks_uri</code>. APIs aceitam <b>access</b> tokens, nunca ID tokens.</p>

---

<!-- _class: tight -->

## Validando no gateway

| | Local (JWKS) | Remota (`/auth/solve`, introspecção) |
|---|---|---|
| Latência | nenhum salto extra | uma chamada por requisição |
| Auth Server fora do ar | continua funcionando | toda requisição falha |
| Revogação | só no `exp` | imediata |
| Chaves | só a chave pública (RS256/ES256) | o segredo fica no Auth Server |

```yaml
spring.security.oauth2.resourceserver.jwt:
  issuer-uri: http://keycloak:8080/realms/store   # discovers jwks_uri, checks iss
  audiences: store-api                            # Spring Boot 3.1+: checks aud
```

<p class="small">Verifique a assinatura (alg de uma allow-list, nunca <code>none</code>), <code>exp</code>, <code>iss</code>, <code>aud</code>, escopos. Repasse o <code>id-account</code> — aceite-o <b>só vindo do gateway</b>.</p>

---

## Zero Trust

<div class="cols">
<div>

### Modelo de perímetro

Firewall do lado de fora; **tudo o que está dentro é confiável**.

Um pod comprometido → **movimento lateral** para todo lado.

</div>
<div>

### Zero Trust (NIST SP 800-207)

**Toda requisição** → ponto de aplicação (gateway, sidecar) → decisão de política → permite com **privilégio mínimo** ou nega.

</div>
</div>

| Princípio | Mecanismo |
|---|---|
| Verificar a identidade explicitamente | tokens OIDC, mTLS, SPIFFE |
| Privilégio mínimo · presumir a violação | escopos, RBAC, NetworkPolicy |
| Validação contínua | TTLs curtos, nova autenticação, monitoramento |

---

<!-- _class: tight -->

## Identidade de serviço: mTLS + política

- **TLS**: só o servidor mostra um certificado. **mTLS**: **os dois** mostram → criptografia + identidade mútua.
- **SPIFFE/SPIRE** emitem **SVIDs** de vida curta: `spiffe://cluster.local/ns/store/sa/order-service`.
- **Service meshes** (Istio, Linkerd): sidecars fazem o mTLS — sem mudar o código.

```yaml
kind: AuthorizationPolicy            # Istio: mTLS says who, the policy says whether
spec:
  selector: { matchLabels: { app: product-service } }
  action: ALLOW
  rules:
    - from: [{ source: { principals: ["cluster.local/ns/store/sa/order-service"] } }]
      to:   [{ operation: { methods: ["GET"], paths: ["/products/*"] } }]
```

---

## NetworkPolicy: negar por padrão, depois permitir

```yaml
kind: NetworkPolicy
metadata: { name: order-service-ingress, namespace: store }
spec:
  podSelector: { matchLabels: { app: order-service } }
  policyTypes: [Ingress]
  ingress:
    - from: [{ podSelector: { matchLabels: { app: gateway-service } } }]
      ports: [{ port: 8080 }]
```

- Comece com `podSelector: {}` + nenhuma regra = **nega toda entrada**.
- Só o `gateway-service` alcança `order-service:8080`; todo o resto é descartado.

<div class="warn">

Aplicada pelo **CNI**: Calico/Cilium sim, minikube padrão **não**: inicie-o com `--cni=calico`.

</div>

---

## Gestão de segredos

<div class="warn">

Um Secret do Kubernetes é **base64, não criptografia**: `echo c3RvcmU= | base64 -d` → `store` (a senha do Postgres do Hands-on 5).

</div>

| Abordagem | Prós | Contras |
|---|---|---|
| **Kubernetes Secrets** | simples, nativo | exige criptografia em repouso + RBAC; fora do Git |
| **Gerenciadores em nuvem** | gerenciado, rotação, auditoria | uma só nuvem; latência extra |
| **HashiCorp Vault** | segredos dinâmicos, qualquer nuvem | custo operacional |

<p class="small"><b>Segredos dinâmicos</b> do Vault: um usuário de BD único por lease, removido ao expirar. O <b>Agent Injector</b> o grava em <code>/vault/secrets/db</code> (<code>vault.hashicorp.com/agent-inject: "true"</code>).</p>

---

## Pontos-chave

1. **AuthN** = quem, **authZ** = o quê; o gateway autentica, cada serviço autoriza seus objetos.
2. JWT é um **formato**; OAuth 2.0 + OIDC definem como tokens são **obtidos, delegados e confiáveis**.
3. **Code + PKCE** para usuários, **Client Credentials** para serviços — **nunca ROPC ou Implicit**.
4. **Access tokens** curtos para as APIs, **refresh tokens** para o Auth Server, **ID token** para o cliente.
5. **JWKS** = validação local, sem salto; **introspecção** (`/auth/solve`) = revogação imediata.
6. **Zero Trust**: verifique cada chamada — identidade mTLS, política de autorização, NetworkPolicy deny-all.
7. Segredos: base64 não é criptografia — criptografia em repouso, RBAC e credenciais de **vida curta**.
