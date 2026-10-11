---
marp: true
lang: pt-BR
title: Hands-on 3 — Segurança
description: Plataformas, Microsserviços, DevOps e APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Plataformas, Microsserviços, DevOps e APIs · Hands-on 3</div>

# Hands-on 3 — Segurança

**Faça login uma vez, receba um JWT assinado e deixe o Gateway verificá-lo a cada requisição**

<!--
Roteiro: (1) autenticação × autorização; (2) o JWT e suas claims; (3) a interface auth e o auth-service;
(4) o cookie; (5) rotas abertas; (6) o AuthorizationFilter no gateway; (7) compose e testes.
-->

---

## Quem é você, e o que você pode fazer?

<div class="q">

As requisições para `/accounts` agora chegam da internet. **Cada serviço** deveria verificar a senha do usuário?

</div>

* **Autenticação**: verificar *quem* é o usuário → após o login, emitir um **JWT assinado**, válido por tempo limitado.
* **Autorização**: verificar *o que* o usuário pode acessar → o **Gateway** confere o JWT antes de rotear.
* Um **ponto único de entrada**: os serviços atrás dele nunca veem uma requisição não autenticada.

<!--
Deixe a turma responder primeiro: verificar credenciais em cada serviço multiplica a superfície de ataque e o código.
-->

---

## Três novos módulos

`internet → gateway → account / auth / others` · `auth → account` · tudo dentro da **camada confiável**

| Módulo | Papel |
|---|---|
| `auth` | biblioteca de interface: `AuthController` + DTOs `LoginIn`, `RegisterIn`, `TokenOut` |
| `auth-service` | implementação: `AuthResource`, `AuthService`, `JwtService`; delega as contas ao `account` via Feign |
| `gateway-service` | ponto único de entrada: `AuthorizationFilter` + `RouterValidator` |

<p class="small">Mesmo padrão de <code>account</code> / <code>account-service</code>: uma biblioteca instalada com <code>mvn clean install</code>, mais um serviço executável.</p>

---

## JSON Web Token

Três partes em Base64Url separadas por pontos: `header.payload.signature`

```
HMAC( base64UrlEncode(header) + "." + base64UrlEncode(payload), secret )
```

- **Header**: tipo do token e algoritmo de assinatura.
- **Payload**: as **claims** — declarações sobre o usuário.
- **Signature**: prova que o token foi emitido por quem tem o segredo e não foi alterado.
- **Stateless**: sem sessão no servidor, então escala horizontalmente.

<div class="warn">

Quem tem a **chave secreta** consegue forjar tokens: guarde-a em uma variável de ambiente, **nunca fixa no código**.

</div>

---

## As claims que esta plataforma usa

| Claim | Campo no JJWT | Conteúdo |
|---|---|---|
| `jti` | `id` | o identificador único da conta |
| `sub` | `subject` | o nome da conta |
| `iss` | `issuer` | a plataforma emissora (`Insper::PMA`) |
| `nbf` | `notBefore` | válido a partir deste instante |
| `exp` | `expiration` | expira neste instante |

<p class="small">Mais uma claim personalizada (privada): <code>email</code>. O payload é só codificado, não criptografado — qualquer um pode lê-lo.</p>

---

## O contrato `auth`

`@FeignClient(name="auth", url="http://auth:8080")` · nome do cookie `AUTH_COOKIE_TOKEN = "__store_jwt_token"`

| Método | Caminho | Faz |
|---|---|---|
| `POST` | `/auth/register` | `RegisterIn(name, email, password)` → cria a conta |
| `POST` | `/auth/login` | `LoginIn(email, password)` → define o cookie JWT |
| `GET` | `/auth/logout` | apaga o cookie |
| `GET` | `/auth/whoiam` | header `id-account` → `AccountOut` |
| `POST` | `/auth/solve` | `TokenOut(token)` → `{ "idAccount": … }` — **interno, só o Gateway** |
| `GET` | `/auth/health-check` | `200 OK` |

---

## `auth-service`

| Classe | Responsabilidade |
|---|---|
| `AuthApplication` | `@EnableFeignClients(basePackages = "store.account")` |
| `AuthResource` | implementa `AuthController`; grava o cookie no login/logout |
| `AuthService` | cadastra via `account`; no login, busca a conta e pede um token |
| `JwtService` | assina e interpreta JWTs com a biblioteca **JJWT** (chave HMAC) |

```yaml
store:
  jwt:
    secretKey: ${JWT_SECRET_KEY}
    duration: 86400000 # 24 hours in milliseconds
    httpOnly: ${JWT_HTTP_ONLY}
```

---

## `JwtService.generate`

```java
public String generate(AccountOut account, long duration) {
    Date now = new Date();
    return Jwts.builder()
        .id(account.id())
        .issuer("Insper::PMA")
        .claims(Map.of("email", account.email()))
        .signWith(getKey())  // Keys.hmacShaKeyFor(Base64-decoded secretKey)
        .subject(account.name())
        .notBefore(now)
        .expiration(new Date(now.getTime() + duration))
        .compact();
}
```

---

## `JwtService.getId`

```java
public String getId(String jwt) {
    JwtParser parser = Jwts.parser().verifyWith(getKey()).build();
    Claims claims = parser.parseSignedClaims(jwt).getPayload(); // checks the signature
    Date now = new Date();
    if (claims.getNotBefore().after(now))
        throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Token is not valid yet!");
    if (claims.getExpiration().before(now))
        throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Token is expired!");
    return claims.getId();
}
```

<p class="small">É isso que o <code>/auth/solve</code> executa: um token válido vira um <code>idAccount</code>.</p>

---

<!-- _class: tight -->

## Login → cookie

1. `POST /auth/login` → `AuthService.login` → busca da conta → `JwtService.generate`.
2. O `AuthResource` responde com `Set-Cookie: __store_jwt_token=<jwt>`.
3. O navegador o guarda e o **envia automaticamente** em cada requisição seguinte.

| Atributo | Valor | Por quê |
|---|---|---|
| `HttpOnly` | `true` | o JavaScript não consegue lê-lo → mitiga **XSS** (ao contrário do `localStorage`) |
| `Secure` | `true` | enviado só por HTTPS |
| `SameSite` | `None` | enviado em requisições cross-site (frontends SPA) |
| `Path` | `/` | vale para todos os caminhos |

<div class="warn">

Os navegadores rejeitam `SameSite=None` sem `Secure`: em produção, frontend e API precisam usar **HTTPS**.

</div>

---

## Rotas abertas: `RouterValidator`

Sem rotas abertas, ninguém conseguiria fazer login.

```java
private List<String> openApiEndpoints = List.of(
    "POST /auth/register",
    "GET /auth/logout",
    "POST /auth/login");

public Predicate<ServerHttpRequest> isSecured = request ->
    openApiEndpoints.stream().noneMatch(/* method and path match, /** = prefix */);
```

<div class="ok">

**Protegido por padrão**: tudo o que não está na lista — inclusive todo `/accounts/**` — exige um cookie válido.

</div>

---

## O Gateway decide: `AuthorizationFilter`

Um `GlobalFilter`: **toda** requisição passa por ele antes do roteamento.

1. `isSecured`? **Não** → encaminha como está.
2. Cookie `__store_jwt_token` presente? **Não** → `401 Unauthorized`.
3. `POST http://auth:8080/auth/solve` com `{ "token": jwt }`.
4. Token inválido → `401`. Válido → adiciona headers e encaminha:

| Header | Valor |
|---|---|
| `id-account` | o UUID da conta, tirado do token |
| `Authorization` | `Bearer <jwt>` |

<!--
Enfatize: os serviços seguintes nunca interpretam JWTs; eles só leem o header id-account.
-->

---

## `AuthorizationFilter.filter`

```java
public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
    ServerHttpRequest request = exchange.getRequest();
    if (!routerValidator.isSecured.test(request)) {
        return chain.filter(exchange);
    }
    if (request.getCookies().containsKey(AUTH_COOKIE_TOKEN)) {
        String token = request.getCookies().getFirst(AUTH_COOKIE_TOKEN).getValue();
        if (null != token && token.length() > 0) {
            return requestAuthTokenSolve(exchange, chain, token.trim());
        }
    }
    throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
}
```

<p class="small">O Spring Cloud Gateway é <strong>reativo</strong> (WebFlux): o filtro devolve <code>Mono&lt;Void&gt;</code> e chama o auth com <code>WebClient</code>, não com <code>RestTemplate</code>.</p>

---

<!-- _class: tight -->

## Ligando tudo: rotas e Compose

<div class="cols">
<div>

```yaml
routes:
  - id: accounts
    uri: http://account:8080
    predicates:
      - Path=/accounts/**
  - id: auth
    uri: http://auth:8080
    predicates:
      - Path=/auth/**
```

</div>
<div>

- Cadeia: `db` → `account` → `auth` → `gateway`.
- **Só o `gateway` publica** a porta `8080`.
- O `auth` recebe `JWT_SECRET_KEY`, `JWT_HTTP_ONLY`.
- O `gateway` recebe `CORS_ALLOWED_ORIGINS`, `CORS_ALLOWED_CREDENTIALS`.

</div>
</div>

<div class="warn">

Nunca reutilize a chave de exemplo: gere uma com pelo menos 256 bits — `openssl rand -base64 32`.

</div>

---

## Teste

```bash
docker compose up -d --build

curl -X POST http://localhost:8080/auth/register -H "Content-Type: application/json" \
  -d '{"name": "Antonio do Estudo", "email": "acme@insper.edu.br", "password": "123@321"}'

curl -c cookies.txt -X POST http://localhost:8080/auth/login -H "Content-Type: application/json" \
  -d '{"email": "acme@insper.edu.br", "password": "123@321"}'

curl -b cookies.txt http://localhost:8080/accounts   # 200 — cookie sent
curl http://localhost:8080/accounts                  # 401 — no cookie
```

---

## Pontos-chave

1. A **autenticação** emite um JWT assinado; a **autorização** o confere a cada requisição.
2. Um JWT é `header.payload.signature`; a **chave secreta** é o que o torna confiável.
3. O `JwtService` assina com `jti`, `sub`, `iss`, `nbf`, `exp` — e valida a assinatura, `nbf` e `exp`.
4. O token viaja em um cookie `HttpOnly` e `Secure`: `__store_jwt_token`.
5. `RouterValidator`: só cadastro, login e logout são abertos — **protegido por padrão**.
6. O `AuthorizationFilter` resolve o token via `/auth/solve` e repassa o `id-account`.
7. Os serviços seguintes **nunca interpretam JWTs**: o Gateway faz isso uma única vez.
