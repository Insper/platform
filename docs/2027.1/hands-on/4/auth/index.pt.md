O `auth` é dono dos usuários do BoxOffice. Ele faz três coisas: **cadastra** um usuário (guardando um hash BCrypt, nunca a senha), **faz login** (confere a senha e emite um token assinado) e **publica a chave pública** que permite a qualquer um verificar esses tokens. É um serviço Spring Boot comum na porta **8081**, com o seu próprio schema `auth`.

``` diagram
flowchart LR
    subgraph auth["auth :8081"]
        ctl[AuthController] --> svc[AuthService]
        svc --> repo[UserRepository] --> db[("schema auth<br/>users")]
        svc --> tok["TokenService<br/>par de chaves RSA"]
    end
    gw[gateway] -->|"GET /auth/.well-known/jwks.json<br/>(chave pública, em cache)"| ctl
```

## 1. Por que um token assinado? { #1-why-a-signed-token }

Depois do login, toda requisição precisa provar quem está chamando. Duas famílias de soluções:

| | Sessão no servidor | Token autocontido (JWT) |
|---|---|---|
| O que o cliente guarda | um id de sessão aleatório (cookie) | as próprias claims, assinadas: `sub`, `scope`, `exp`… |
| Como uma requisição é verificada | busca o id em um armazenamento de sessões (Redis, banco) | verifica a assinatura com a chave pública — **sem busca** |
| Revogação | apaga a sessão: imediata | difícil: o token vale até o `exp` (mantenha-o curto) |
| Escala com | o armazenamento de sessões | só CPU; cada nó verifica sozinho |

O BoxOffice usa JWTs assinados com **RS256** (RSA + SHA-256): o `auth` assina com uma **chave privada** que só ele conhece; o gateway verifica com a **chave pública**, publicada como um JWKS (JSON Web Key Set). O gateway consegue verificar tokens mas nunca consegue emitir um — ao contrário do HS256, em que o mesmo segredo compartilhado assina e verifica, e todo serviço que o tivesse poderia forjar tokens.

Um token tem a forma `header.payload.signature`, cada parte codificada em Base64URL:

``` { .json title="decoded payload of a BoxOffice token" }
{
  "iss": "boxoffice-auth",
  "aud": "boxoffice",
  "sub": "0b9d8a6e-4f3c-4c1e-9d52-1b0f3c2a7e11",
  "email": "ana@example.com",
  "name": "Ana",
  "scope": "user",
  "iat": 1795000000,
  "exp": 1795003600,
  "jti": "7c1f…"
}
```

!!! warning "Assinado não é criptografado"

    Qualquer um consegue decodificar o payload (experimente o `jwt.io` ou `base64 -d`). Nunca coloque em um JWT segredos ou dados pessoais que você não mostraria ao próprio usuário.

## 2. Projeto e configuração { #2-project-and-configuration }

Crie `services/auth` como o `catalog` (mesmo `Dockerfile` com `EXPOSE 8081`, mesmo `.dockerignore`).

??? example "`services/auth/Dockerfile` e `.dockerignore` (iguais aos do `catalog`, só muda o `EXPOSE 8081`)"

    ``` { .dockerfile title="services/auth/Dockerfile" .copy linenums="1" }
    --8<-- "docs/2027.1/hands-on/4/code/services/auth/Dockerfile"
    ```

    ``` { .text title="services/auth/.dockerignore" .copy }
    --8<-- "docs/2027.1/hands-on/4/code/services/auth/.dockerignore"
    ```

``` { .xml title="services/auth/pom.xml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/4/code/services/auth/pom.xml"
```

Repare no que **não** está lá: o starter completo do Spring Security. O `auth` só precisa do encoder BCrypt (`spring-security-crypto`) e de uma biblioteca de JWT (`nimbus-jose-jwt`, a mesma que o Spring Security usa dentro do gateway).

``` { .yaml title="services/auth/src/main/resources/application.yaml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/4/code/services/auth/src/main/resources/application.yaml"
```

``` { .sql title="services/auth/src/main/resources/db/migration/V1__create_users.sql" .copy }
--8<-- "docs/2027.1/hands-on/4/code/services/auth/src/main/resources/db/migration/V1__create_users.sql"
```

## 3. Usuários { #3-users }

=== "User.java"

    ``` { .java title="services/auth/src/main/java/boxoffice/auth/User.java" .copy linenums="1" }
    --8<-- "docs/2027.1/hands-on/4/code/services/auth/src/main/java/boxoffice/auth/User.java"
    ```

=== "Role.java"

    ``` { .java title="services/auth/src/main/java/boxoffice/auth/Role.java" .copy }
    --8<-- "docs/2027.1/hands-on/4/code/services/auth/src/main/java/boxoffice/auth/Role.java"
    ```

=== "UserRepository.java"

    ``` { .java title="services/auth/src/main/java/boxoffice/auth/UserRepository.java" .copy }
    --8<-- "docs/2027.1/hands-on/4/code/services/auth/src/main/java/boxoffice/auth/UserRepository.java"
    ```

=== "AuthApplication.java"

    ``` { .java title="services/auth/src/main/java/boxoffice/auth/AuthApplication.java" .copy }
    --8<-- "docs/2027.1/hands-on/4/code/services/auth/src/main/java/boxoffice/auth/AuthApplication.java"
    ```

Os records trocados com os clientes:

=== "RegisterIn"

    ``` { .java title="services/auth/src/main/java/boxoffice/auth/RegisterIn.java" .copy }
    --8<-- "docs/2027.1/hands-on/4/code/services/auth/src/main/java/boxoffice/auth/RegisterIn.java"
    ```

=== "LoginIn"

    ``` { .java title="services/auth/src/main/java/boxoffice/auth/LoginIn.java" .copy }
    --8<-- "docs/2027.1/hands-on/4/code/services/auth/src/main/java/boxoffice/auth/LoginIn.java"
    ```

=== "TokenOut"

    ``` { .java title="services/auth/src/main/java/boxoffice/auth/TokenOut.java" .copy }
    --8<-- "docs/2027.1/hands-on/4/code/services/auth/src/main/java/boxoffice/auth/TokenOut.java"
    ```

=== "UserOut"

    ``` { .java title="services/auth/src/main/java/boxoffice/auth/UserOut.java" .copy }
    --8<-- "docs/2027.1/hands-on/4/code/services/auth/src/main/java/boxoffice/auth/UserOut.java"
    ```

## 4. Assinando tokens e publicando a chave { #4-signing-tokens-and-publishing-the-key }

``` { .java title="services/auth/src/main/java/boxoffice/auth/TokenService.java" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/4/code/services/auth/src/main/java/boxoffice/auth/TokenService.java"
```

| Claim | Significado | Verificada pelo gateway |
|---|---|---|
| `iss` | quem emitiu (`boxoffice-auth`) | sim: precisa bater com `JWT_ISSUER` |
| `aud` | para quem é (`boxoffice`) | sim: um token de outra API é recusado |
| `sub` | o id do usuário | vira `X-User-Id` |
| `scope` | `user` ou `user admin` | vira as authorities `SCOPE_user`, `SCOPE_admin` |
| `exp` | expiração | sim (com uma pequena tolerância de diferença de relógio) |
| `kid` (header) | qual chave assinou | usado para escolher a chave certa no JWKS |

!!! warning "Uma chave nova a cada reinício"

    O `TokenService` gera o par de chaves RSA em memória quando o `auth` sobe. Reinicie o `auth` e todo token emitido antes é rejeitado (`kid` desconhecido), e duas réplicas do `auth` assinariam cada uma com uma chave diferente. Em produção, a chave privada fica em um **KMS ou gerenciador de segredos**, o JWKS lista a chave atual **e** a anterior durante uma rotação, e as chaves giram em um calendário. Num lab, um reinício que desloga todo mundo é uma vantagem: você vê por que a rotação exige cuidado.

## 5. Cadastro, login, me { #5-register-login-me }

``` { .java title="services/auth/src/main/java/boxoffice/auth/AuthService.java" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/4/code/services/auth/src/main/java/boxoffice/auth/AuthService.java"
```

``` { .java title="services/auth/src/main/java/boxoffice/auth/AuthController.java" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/4/code/services/auth/src/main/java/boxoffice/auth/AuthController.java"
```

Detalhes que importam:

- **BCrypt com custo 10** significa 2¹⁰ rodadas de expansão de chave: dezenas de milissegundos por hash. Rápido o bastante para um humano fazendo login, lento o bastante para tornar caro um ataque offline a uma tabela vazada. Isso também faz do `/auth/login` o endpoint que mais consome CPU no BoxOffice — você vai medir.
- **Mesmo erro** para "e-mail desconhecido" e "senha errada" (`401 invalid credentials`): mensagens diferentes deixariam um atacante descobrir quais e-mails têm conta.
- O `/auth/me` não lê o token: ele confia no `X-User-Id`, definido pelo gateway depois de validá-lo. O `auth` não é alcançável de fora a não ser pelo gateway.
- O administrador é criado uma vez, no `ApplicationReadyEvent`, a partir de `ADMIN_EMAIL`/`ADMIN_PASSWORD`. Troque a senha em qualquer ambiente compartilhado.

!!! tip "Na entrevista"

    "Autenticação no gateway, autorização perto dos dados": o gateway rejeita cedo e barato requisições anônimas ou malformadas; as regras finas ("esta reserva é *sua*?") ficam no serviço dono dos dados — o `inventory` confere o `user_id` em toda reserva no lab 6.

Próximo: [2. O gateway](../gateway/index.md).
