---
marp: true
lang: pt-BR
title: Lab 4 — Gateway e identidade
description: Arquitetura de Sistemas · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">Arquitetura de Sistemas · Insper · Lab 4</div>

# Lab 4 — Gateway e identidade

**Um serviço `auth` que assina JSON Web Tokens (JWTs) e um Spring Cloud Gateway que os valida uma única vez**

<!--
Roteiro: (1) autenticação vs autorização; (2) sessões vs JWT; (3) RS256 e JWKS; (4) serviço auth;
(5) rotas e LB do gateway; (6) regras de segurança; (7) headers de identidade; (8) medições: salto,
JWT, login.
-->

---

## Quem é você e o que você pode fazer?

<div class="q">

Hoje qualquer um consegue apagar eventos do catálogo. Cada serviço deveria aprender a conferir senhas?

</div>

- **Autenticação** — quem está chamando.
- **Autorização** — o que essa pessoa pode fazer.
- Resolva **uma vez**, na porta de entrada: o gateway da interface de programação de aplicações (API, *application programming interface*).

---

## O que você vai construir

<div class="flow">
<div class="box muted" style="flex: .6">fãs · k6</div><div class="arrow">:80 →</div>
<div class="box">edge<small>Nginx · rate limit · /actuator → 404</small></div><div class="arrow">→</div>
<div class="box accent">gateway :8080<small>JWT, regras, rotas, lb://catalog</small></div><div class="arrow">→</div>
<div class="group">
<div class="caption">serviços</div>
<div class="box orange">auth :8081<small>usuários, BCrypt, assina tokens</small></div>
<div class="box green">catalog-1..3 :8082<small>confiam nos X-User-* do gateway</small></div>
</div>
</div>

- Dois load balancers: o **edge** distribui entre gateways, o **gateway** entre instâncias dos serviços.
- Só o edge é público; a porta 8080 está publicada só para as medições.

<!--
Como na nuvem: um load balancer público de camada 7 → uma frota de API gateways → balanceamento interno dos serviços.
A página desenha a mesma topologia em "O que você vai construir".
-->

---

## Sessões vs tokens

| | Id de sessão | JWT |
|---|---|---|
| O cliente guarda | id aleatório | claims assinadas |
| Verificação | busca em um armazenamento | verifica a assinatura localmente |
| Revogação | imediata | espera o `exp` |
| Escala com | o armazenamento de sessões | só unidade central de processamento (CPU, *central processing unit*) |

---

## RS256 e o JSON Web Key Set (JWKS)

<div class="flow">
<div class="box orange">auth<small>chave privada · assina</small></div><div class="arrow">token →</div>
<div class="box">cliente<small>manda o Bearer em toda requisição</small></div><div class="arrow">→</div>
<div class="box accent">gateway<small>chave pública · verifica localmente</small></div>
<div class="arrow">← uma vez</div>
<div class="box muted">/auth/.well-known/jwks.json<small>baixado de novo só para um kid desconhecido</small></div>
</div>

- RS256 = uma assinatura Rivest–Shamir–Adleman (RSA) sobre SHA-256: só o `auth` **emite**; qualquer um **verifica**.
- Com HS256, um código de autenticação de mensagem baseado em hash (HMAC, *hash-based message authentication code*), um segredo assina e verifica: quem o tem pode forjar tokens.

<div class="warn">

Assinado ≠ criptografado: qualquer um lê o payload.

</div>

---

## O token

```json
{ "iss": "boxoffice-auth", "aud": "boxoffice",
  "sub": "0b9d8a6e-…", "email": "ana@example.com",
  "scope": "user", "iat": 1795000000, "exp": 1795003600 }
```

- O gateway verifica assinatura, `exp`, `iss`, `aud`.
- `scope` → authorities `SCOPE_user`, `SCOPE_admin`.

---

## O serviço `auth`

- `POST /auth/register` — BCrypt (custo 10), nunca a senha.
- `POST /auth/login` — o mesmo `401` para usuário desconhecido e senha errada.
- `GET /auth/me` — confia no `X-User-Id` vindo do gateway.
- Admin criado na inicialização a partir de `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
- Novo par de chaves RSA a cada inicialização: os tokens antigos morrem (veja *Uma chave nova*, adiante).

---

## Rotas do gateway

```yaml
routes:
  - id: auth
    uri: http://auth:8081
    predicates: [ Path=/auth/** ]
  - id: catalog
    uri: lb://catalog          # catalog-1..3, health-checked
    predicates: [ Path=/catalog/** ]
```

- Timeouts: conexão 1 s, resposta 5 s. Um GET que falhou é repetido uma vez, em outra instância.
- Health check: sonda o `/actuator/health/readiness` de cada uma a cada 5 s e pula as que não estão `UP`.

---

## Quem pode chamar o quê

```java
.pathMatchers("/auth/register", "/auth/login", "/auth/.well-known/**").permitAll()
.pathMatchers(HttpMethod.GET, "/catalog/**").permitAll()
.pathMatchers("/catalog/**").hasAuthority("SCOPE_admin")
.anyExchange().authenticated()
```

<div class="flow">
<div class="box">mandou token?<small>validado antes, mesmo numa rota aberta</small></div><div class="arrow">→</div>
<div class="box accent">primeira regra que casa<small>em ordem</small></div><div class="arrow">→</div>
<div class="box green">permitida → roteia</div>
<div class="box red">sem token ou token ruim<small>401</small></div>
<div class="box orange">válido, scope errado<small>403</small></div>
</div>

- **Negar por padrão**: rotas novas ficam protegidas automaticamente.

---

## Headers de identidade

<div class="flow">
<div class="box red">cliente<small>Bearer (Ana) + X-User-Id: admin</small></div><div class="arrow">→</div>
<div class="box accent">gateway<small>remove X-User-* · valida · sub = Ana</small></div><div class="arrow">→</div>
<div class="box green">auth<small>X-User-Id: Ana</small></div>
</div>

- Remova `X-User-*` vindos do cliente — **sempre**; depois defina-os a partir do JWT validado.
- Os serviços confiam neles **porque** só são alcançáveis pelo gateway.

<div class="q">

O que muda em uma rede zero trust?

</div>

---

## Teste de ponta a ponta

| Requisição | Resposta | Quem respondeu |
|---|---|---|
| `POST /auth/register` | `201` | auth |
| `POST /auth/login` | `200` + token | auth |
| `GET /auth/me` com o token | `200` Ana | auth (pelo gateway) |
| `GET /auth/me` sem token | `401` | **gateway** |
| `DELETE /catalog/events/2` como Ana | `403` | **gateway** |
| `PUT /catalog/events/2` como admin | `200` | uma réplica do catalog |

- As recusas nunca chegam a um serviço: custam microssegundos ao gateway.

---

## Uma chave nova a cada reinício

<div class="flow">
<div class="box">reinicia o auth<small>novo par de chaves, kid B</small></div><div class="arrow">→</div>
<div class="box orange">token antigo (kid A)<small>200: o gateway ainda tem o kid A em cache</small></div><div class="arrow">→</div>
<div class="box accent">primeiro token com kid B<small>kid desconhecido → baixa o JWKS</small></div><div class="arrow">→</div>
<div class="box red">token antigo (kid A)<small>401: não está mais no JWKS</small></div>
</div>

- O gateway guarda o JWKS em cache e só o baixa de novo para um **kid desconhecido**.
- Produção: a chave fica num serviço de gerenciamento de chaves (KMS, *key management service*); o JWKS lista a atual **e** a anterior.
- Tokens expirados: o gateway tolera **60 s** de diferença de relógio além do `exp`.

---

## Meça

| Caminho | O que acrescenta |
|---|---|
| só o catalog | linha de base |
| gateway → catalog | + o salto pelo gateway |
| edge → gateway → catalog | + o salto pelo edge |
| o mesmo, com um token | + validação do JWT |

```bash
# k6 inside the compose network: catalog replicas publish no port
docker run --rm -i --network boxoffice_default -v "$PWD":/w -w /w \
  grafana/k6 run -e RATE=50 load/gateway.js
```

---

## O login é lento de propósito

- BCrypt custo 10 → dezenas de ms de CPU por verificação.
- `auth` com 1 CPU: cerca de 10–20 logins/s.
- Medido: 10 logins/s mantiveram o p99 < 200 ms (~80% de CPU); 20 logins/s → `504` no timeout de 5 s.
- Consequências: **reutilize tokens**, ponha rate limit no `/auth/login`, faça login **antes** das 10:00.

```bash
for r in 5 10 20 40; do k6 run -q -e RATE=$r --summary-export results/lab4/rate-$r.json load/login.js; done
```

---

## Sem Docker: o simulador

<div class="flow">
<div class="box accent">Teste de ponta a ponta<small>201, 200, 200, 401, 403 · um download do JWKS</small></div>
<div class="box orange">Casos de falha<small>header forjado, payload editado, chave nova, 60 s de tolerância</small></div>
<div class="box green">Borda e réplicas<small>/actuator 404, um GET repetido, 41 passam e 9 recebem 429</small></div>
</div>

- A visão geral embute a pilha do lab 4 como simulador: mesmas requisições, mesmas respostas.
- O caminho acende até onde cada requisição chegou; a caixa que respondeu mostra o status.

<!--
O simulador fica logo depois dos casos de falha em "Teste de ponta a ponta".
-->

---

## Pontos-chave

1. Autentique uma vez no **gateway**; autorize de forma fina onde os dados vivem.
2. **RS256 + JWKS**: só o `auth` assina, todos verificam localmente.
3. Valide `exp`, `iss`, `aud` — não só a assinatura.
4. **Negue por padrão**; remova headers de identidade vindos dos clientes.
5. O salto pelo gateway e a verificação do JWT são baratos; **o hash de senhas não é**.
