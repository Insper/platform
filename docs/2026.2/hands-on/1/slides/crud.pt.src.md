---
marp: true
lang: pt-BR
title: Hands-on 1 — CRUD
description: Plataformas, Microsserviços, DevOps e APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Plataformas, Microsserviços, DevOps e APIs · Hands-on 1</div>

# Hands-on 1 — CRUD

**Um microsserviço, quatro camadas, um banco de dados: o serviço Account**

<!--
Roteiro: (1) objetivo e os dois módulos; (2) arquitetura limpa e parsers; (3) controller (interface);
(4) esqueleto do serviço; (5) containerização; (6) repositório: JPA, Flyway; (7) executar, verificar, armadilhas.
-->

---

## O objetivo

<div class="q">

Quase toda aplicação tem **contas de usuário**. Qual é o menor serviço capaz de gerenciá-las?

</div>

* Uma API **CRUD**: **C**reate, **R**ead, **U**pdate, **D**elete (criar, ler, atualizar, excluir) contas.
* Construída com **Spring Boot**, seguindo **Domain-Driven Design** e **Clean Architecture**.
* Persistida no **PostgreSQL**, rodando no **Docker Compose**.
* É o modelo que todos os outros microsserviços da disciplina vão copiar.

---

## Dois módulos

<div class="cols">
<div>

### `account` — a interface

- Definição da API: `AccountController`
- DTOs: `AccountIn`, `AccountOut`
- Uma **biblioteca**, não um app executável
- Instalado com `mvn clean install`

</div>
<div>

### `account-service` — a implementação

- `AccountResource` implementa a API
- `AccountService`, `AccountRepository`
- Entidade `Account`, modelo `AccountModel`
- Um app Spring Boot que **roda**

</div>
</div>

<div class="ok">

Separar o contrato da implementação permite que **outros microsserviços Java reutilizem** o `account` para chamar este serviço.

</div>

---

## Arquitetura limpa: um objeto por camada

`Request → Controller/Resource → Service → Repository → Database`

| Camada | Objeto | Parser na ida |
|---|---|---|
| Controller / Resource | `AccountIn`, `AccountOut` (DTOs) | JSON → `AccountIn` |
| Service | `Account` (entidade) | `AccountIn → Account` |
| Repository | `AccountModel` (JPA) | `Account → AccountModel` |
| Banco de dados | tabela `accounts.accounts` | — |

<p class="small">Na volta: <code>AccountModel → Account → AccountOut</code>. <code>AccountParser</code> e <code>AccountModel</code> fazem as traduções.</p>

<!--
Enfatize que as regras de negócio nunca veem JSON nem anotações JPA: esse é o desacoplamento que a Clean Architecture pede.
-->

---

## Passo 1 — Controller: o contrato

```java
@FeignClient(name = "account", url = "http://account:8080")
public interface AccountController {
    @PostMapping("/accounts")
    ResponseEntity<Void> create(@RequestBody AccountIn in);
    @DeleteMapping("/accounts/{id}")
    ResponseEntity<Void> delete(@PathVariable String id);
    @GetMapping("/accounts/health-check")
    ResponseEntity<Void> healthCheck();
    @GetMapping("/accounts")
    ResponseEntity<List<AccountOut>> findAll();
    @GetMapping("/accounts/{id}")
    ResponseEntity<AccountOut> findById(@PathVariable String id);
}
```

<p class="small">Os DTOs são records com <code>@Builder</code> do Lombok: <code>AccountIn(name, email, password)</code> e <code>AccountOut(id, name, email)</code> — a senha nunca sai.</p>

---

## Configuração do projeto

| Spring Initializr | `account` | `account-service` |
|---|---|---|
| Project / Language | Maven / Java 25 | Maven / Java 25 |
| Spring Boot | 4.0.3 | 4.0.3 |
| Group / Package | `store` / `store.account` | `store` / `store.account` |
| Dependências | Lombok, OpenFeign | Spring Web, Lombok, OpenFeign |
| Mantém | só a interface + DTOs | `AccountApplication`, `application.yaml` |

Cada módulo é um repositório git próprio, adicionado como submódulo:

```bash
git submodule add <repository_url> api/account
git submodule add <repository_url> api/account-service
```

---

## Passo 2 — Service: fazer responder

`AccountResource` implementa `AccountController`; no início, só o `health-check` é de verdade.

```java
@RestController
public class AccountResource implements AccountController {
    @Override
    public ResponseEntity<Void> healthCheck() {
        return ResponseEntity.ok().build();
    }
    // create, delete, findAll, findById: filled in later
}
```

```bash
mvn clean package spring-boot:run
curl -X GET http://localhost:8080/accounts/health-check   # 200 OK
```

---

## Passo 3 — Containerização

<div class="cols">
<div>

```dockerfile
FROM eclipse-temurin:25
VOLUME /tmp
COPY target/*.jar /app.jar
ENTRYPOINT ["java", "-jar", "/app.jar"]
```

O `.env` guarda `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `VOLUME_DB`.

</div>
<div>

```yaml
services:
  db:
    image: postgres:17
    volumes:
      - ${VOLUME_DB}:/var/lib/postgresql/data
    environment:
      POSTGRES_USER: ${DB_USER:-store}
  account:
    build:
      context: ./account-service
    depends_on:
      - db
```

</div>
</div>

<p class="small"><code>docker compose up -d --build</code> · <code>docker compose ps -a</code> — os serviços vivem em uma <strong>camada confiável</strong>.</p>

---

## Passo 4 — Repository: ORM com JPA

<div class="cols">
<div>

```java
@Entity
@Table(name = "accounts")
public class AccountModel {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;
    private String name;
    private String email;
    @Column(name = "password_sha256")
    private String passwordSha256;
}
```

</div>
<div>

```java
public interface AccountRepository
    extends CrudRepository<AccountModel, String> {
}
```

- O **ORM** mapeia tabelas → classes, linhas → objetos.
- O `CrudRepository` dá `save`, `findById`, `findAll`, `deleteById` de graça.

</div>
</div>

---

## A regra de negócio vive no `AccountService`

```java
public Account create(Account account) {
    if (account.password() == null || account.password().trim().length() == 0) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Password is empty");
    }
    account.passwordSha256(calcHash(account.password()));
    return accountRepository.save(new AccountModel(account)).to();
}
```

- Só o **hash SHA-256** (Base64) é armazenado, nunca a senha em texto puro.
- `AccountModel(account)` e `.to()` são os parsers entre entidade e modelo.

---

## Os endpoints prontos

| Método | Caminho | Resposta |
|---|---|---|
| `POST` | `/accounts` | `201 Created` + `Location: /accounts/{id}` |
| `GET` | `/accounts` | `200 OK` + lista de `AccountOut` |
| `GET` | `/accounts/{id}` | `200 OK` ou `404 Not Found` |
| `DELETE` | `/accounts/{id}` | `204 No Content` |
| `GET` | `/accounts/health-check` | `200 OK` |

<p class="small"><code>create</code> monta o cabeçalho <code>Location</code> com <code>ServletUriComponentsBuilder.fromCurrentRequest().path("/{id}")</code>.</p>

---

<!-- _class: tight -->

## Migrações de banco de dados com Flyway

O esquema é **versionado**: scripts em `resources/db/migration`, executados em ordem na inicialização.

| Script | Mudança |
|---|---|
| `V2026.03.04.001__create_schema.sql` | `CREATE SCHEMA IF NOT EXISTS accounts` |
| `V2026.03.04.002__create_table.sql` | tabela `accounts.accounts (id, name, email UNIQUE)` |
| `V2026.03.06.001__create_field_pass_sha256.sql` | `ADD COLUMN password_sha256` |

```yaml
spring:
  datasource:
    url: jdbc:postgresql://${DATABASE_HOST}:${DATABASE_PORT}/${DATABASE_DB}
  flyway:
    baseline-on-migrate: true
    schemas: accounts
  jpa.properties.hibernate.default_schema: accounts
```

<!--
Formato do nome: V<versão>__<descrição>.sql. Uma mudança nova é um script novo, nunca a edição de um já aplicado.
-->

---

## Executar e verificar

O `compose.yaml` passa `DATABASE_HOST: db`, `DATABASE_PORT: 5432`, `DATABASE_DB`, `DATABASE_USERNAME`, `DATABASE_PASSWORD` ao `account`.

```bash
docker compose up --build          # build images and start db + account
docker compose ps -a               # container names and status
docker logs -f <account container> # look for the Flyway migrations
```

Dentro do PostgreSQL (`psql -U store -d store`):

- `\dn` lista os esquemas — `accounts` precisa estar lá.
- `\dt *.*` lista as tabelas — `accounts.accounts` precisa estar lá.

---

## Armadilhas comuns

<div class="warn">

`account-service` depende de `account`: rode **`mvn clean install`** no `account` primeiro, senão o build não o encontra.

</div>

- O Dockerfile copia `target/*.jar`: **empacote antes** do `docker compose up --build`.
- Dentro do Compose, os serviços se falam pelo **hostname** (`db`, `account`), não por `localhost`.
- Uma migração já aplicada é história: mude o esquema com um **novo** script `V…__…sql`.
- Mantenha a senha fora do `AccountOut` — o DTO de saída é a face pública do serviço.

---

## Pontos-chave

1. Um microsserviço = um **módulo de interface** (`account`) + uma **implementação** (`account-service`).
2. **Clean Architecture**: DTO → entidade → modelo, com parsers entre as camadas.
3. `@FeignClient` na interface torna o contrato **reutilizável** por outros serviços.
4. O **JPA** mapeia `AccountModel` para uma tabela; o `CrudRepository` dá o CRUD de graça.
5. O **Flyway** versiona o esquema com scripts `V…__…sql` ordenados.
6. O **Docker Compose** roda o serviço e o PostgreSQL juntos, ligados por variáveis de ambiente.
7. Armazene um **hash**, nunca a senha — e nunca a retorne.
