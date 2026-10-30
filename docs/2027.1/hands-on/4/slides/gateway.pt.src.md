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

<div class="kicker">Arquitetura de Sistemas · Insper · Lab 4</div>

# Lab 4 — Gateway e identidade

**Um serviço `auth` que emite JWTs RS256 e um Spring Cloud Gateway que os valida uma única vez**

<!--
Roteiro: (1) autenticação vs autorização; (2) sessões vs JWT; (3) RS256 e JWKS; (4) serviço auth;
(5) rotas e LB do gateway; (6) regras de segurança; (7) headers de identidade; (8) medições: salto,
JWT, login.
-->

---

## Quem é você, e o que você pode fazer?

<div class="q">

Hoje qualquer um consegue apagar eventos do catálogo. Cada serviço deveria aprender a conferir senhas?

</div>

- **Autenticação** — quem está chamando.
- **Autorização** — o que essa pessoa pode fazer.
- Resolva **uma vez**, na porta de entrada: o API gateway.

---

## Sessões vs tokens

| | Id de sessão | JWT |
|---|---|---|
| O cliente guarda | id aleatório | claims assinadas |
| Verificação | busca em um armazenamento | verifica a assinatura localmente |
| Revogação | imediata | espera o `exp` |
| Escala com | o armazenamento de sessões | só CPU |

---

## RS256 e o JWKS

- O `auth` assina com uma chave **privada**; ninguém mais emite tokens.
- O gateway verifica com a chave **pública** de `/auth/.well-known/jwks.json`.
- Buscada uma vez, em cache; buscada de novo só para um `kid` desconhecido.

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

- Timeouts: conexão 1 s, resposta 5 s. Retry de GET uma vez.

---

## Quem pode chamar o quê

```java
.pathMatchers("/auth/register", "/auth/login", "/auth/.well-known/**").permitAll()
.pathMatchers(HttpMethod.GET, "/catalog/**").permitAll()
.pathMatchers("/catalog/**").hasAuthority("SCOPE_admin")
.anyExchange().authenticated()
```

- **Negar por padrão**: rotas novas ficam protegidas automaticamente.
- Sem token → `401`; scope errado → `403`.

---

## Headers de identidade

- Remova `X-User-*` vindos do cliente — **sempre**.
- Defina `X-User-Id`, `X-User-Email`, `X-User-Scope` a partir do JWT validado.
- Os serviços confiam neles **porque** só são alcançáveis pelo gateway.

<div class="q">

O que muda em uma rede zero trust?

</div>

---

## Dois load balancers, duas camadas

```text
fans ─► edge (Nginx) ─► gateway (×N) ─► lb://catalog ─► catalog-1..3
         balances gateways        balances service instances
```

- Como um load balancer L7 da nuvem → frota de gateways → LB interno dos serviços.

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
- Consequências: **reutilize tokens**, ponha rate limit no `/auth/login`, faça login **antes** das 10:00.

```bash
for r in 5 10 20 40; do k6 run -q -e RATE=$r --summary-export results/lab4/rate-$r.json load/login.js; done
```

---

## Pontos-chave

1. Autentique uma vez no **gateway**; autorize de forma fina onde os dados vivem.
2. **RS256 + JWKS**: só o `auth` assina, todos verificam localmente.
3. Valide `exp`, `iss`, `aud` — não só a assinatura.
4. **Negue por padrão**; remova headers de identidade vindos dos clientes.
5. O salto pelo gateway e a verificação do JWT são baratos; **o hash de senhas não é**.
