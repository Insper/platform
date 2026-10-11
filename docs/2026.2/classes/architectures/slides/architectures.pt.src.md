---
marp: true
lang: pt-BR
title: Arquiteturas
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

# Arquiteturas

**Proteja a lógica de negócio: as dependências apontam para o núcleo**

<!--
Roteiro: (1) a Big Ball of Mud; dependências em camadas vs. invertidas; (2) SOLID no nível das classes;
(3) Clean Architecture: camadas, a Regra de Dependência, o mapeamento do Hands-on 1; (4) Hexagonal: portas,
adaptadores, os adaptadores da loja, testes; (5) Clean vs. Hexagonal, quando não usar; (6) CQRS; (7) erros.
-->

---

## Quem conhece quem?

<div class="q">

Um `UserService` importa anotações JPA, um controller valida a entrada, um repositório retorna códigos de status HTTP. O que acontece quando você **troca o banco de dados**?

</div>

* Cada componente conhece todos os outros: uma **Big Ball of Mud** (grande bola de lama).
* Sem testes isolados, sem substituir partes, sem trabalho em paralelo entre times.
* As preocupações externas (BD, framework, protocolo) **mudam com mais frequência** que as regras de negócio — e arrastam as regras junto.

---

## Uma regra: inverta a seta

<div class="cols">
<div>

### Em camadas (n-tier)

`Controller` → `Service` → `JpaRepository` → Postgres

A **lógica de negócio depende da persistência**.

</div>
<div>

### Clean / Hexagonal

`Service` → «interface» `AccountRepository` ← `AccountJpaAdapter` → Postgres

A **persistência depende do negócio**.

</div>
</div>

<div class="ok">

**As dependências fluem em uma só direção**, rumo ao núcleo estável. O núcleo **nunca importa** o mundo externo (HTTP, BD, MQ, CLI).

</div>

<!--
Em tempo de execução, as chamadas continuam indo de service → BD; só a dependência de compilação se inverte. É isso que o D do SOLID faz.
-->

---

## SOLID — projeto no nível das classes

| | Princípio | Problema resolvido → mecanismo |
|---|---|---|
| **S** | Responsabilidade Única | uma classe, vários motivos para mudar → **uma preocupação por classe** |
| **O** | Aberto/Fechado | editar código para adicionar funções → **novas implementações de uma interface** |
| **L** | Substituição de Liskov | subtipos quebram contratos → **honre o comportamento, não só as assinaturas** |
| **I** | Segregação de Interfaces | interfaces gordas → **divida conforme a necessidade do cliente** |
| **D** | Inversão de Dependência | lógica acoplada à infraestrutura → **ambos dependem de uma abstração** |

<p class="small">Reunidos por Robert C. Martin (2000–2002); acrônimo de Michael Feathers; Aberto/Fechado de Bertrand Meyer (1988); Liskov de Barbara Liskov (1987).</p>

---

## S e O

<div class="cols">
<div>

### Responsabilidade Única

> Um, e apenas um, motivo para mudar.

Um `AccountService` que valida, persiste, envia e-mails e audita tem **quatro motivos para mudar**.

Divida: `AccountRepository`, `EmailService`, `AuditService`; o serviço só **orquestra**.

</div>
<div>

### Aberto/Fechado

> Aberto para extensão, fechado para modificação.

O `DiscountService` depende da interface `DiscountPolicy`.

Adicionar `PartnerDiscountPolicy` = **uma classe nova**; o `DiscountService` nunca é tocado.

</div>
</div>

---

## L e I

<div class="cols">
<div>

### Substituição de Liskov

`Square extends Rectangle` sobrescreve os setters:

`setWidth(5); setHeight(3);` → `area()` dá **9**, e não 15.

Correção: os dois implementam uma interface `Shape` com `area()`.

</div>
<div>

### Segregação de Interfaces

Um `AccountRepository` gordo obriga quem chama a depender de métodos de administração.

Divida em `AccountReader`, `AccountWriter`, `AccountAdmin`: o `AccountService` usa só os dois primeiros.

</div>
</div>

<p class="small">Teste do LSP: um teste escrito para o supertipo precisa passar para todo subtipo — inclusive <code>InMemoryAccountRepository</code> vs. o adaptador JPA (mesmo comportamento com e-mail duplicado).</p>

---

## D — Inversão de Dependência

```java
public interface AccountRepository {           // the abstraction
    Optional<Account> findById(String id);
    Account save(Account account);
}
public class AccountService {                   // high-level: depends on it
    private final AccountRepository repository;
    public AccountService(AccountRepository repository) { ... }
}
@Repository
public class JpaAccountRepository implements AccountRepository { ... }
```

Antes: `new MySqlAccountRepository()`. Agora o JPA, ou o `InMemoryAccountRepository` nos testes, se encaixam.

<p class="small">A DI (o Spring injetando beans) é o <i>mecanismo</i>; o DIP é o <i>princípio</i>: o tipo injetado é uma abstração <b>que pertence ao código de negócio</b>.</p>

<!--
O DIP é o que torna possíveis a Clean e a Hexagonal: inverta a dependência em cada fronteira.
-->

---

## Clean Architecture

Robert C. Martin, 2012 — uma síntese da Hexagonal, da Onion, do BCE e de outras.

| Camada | Também chamada de | Responsabilidade |
|---|---|---|
| **Entities** | Domínio | regras de negócio de toda a empresa |
| **Use Cases** | Aplicação | o que a aplicação *faz*; orquestra as Entities |
| **Interface Adapters** | Adaptadores | Controllers, Presenters, Gateways — convertem dados |
| **Frameworks & Drivers** | Infraestrutura | web, BD, UI, APIs externas — todo detalhe |

<div class="ok">

**A Regra de Dependência**: nada em uma camada interna referencia uma camada externa. Nada de `@Entity` ou `HttpServletRequest` dentro de um Use Case.

</div>

---

## A que camada uma classe pertence?

- Muda quando o **negócio** muda → **Entity ou Use Case**.
- Muda quando a **interface** muda (REST → gRPC, JSON → XML) → **Interface Adapter**.
- Muda quando uma **biblioteca** é atualizada (Spring Boot, dialeto JPA) → **Frameworks & Drivers**.

Hands-on 1: `AccountResource` + `AccountIn/Out` (adaptadores) → **`AccountParser`** → `AccountService` (caso de uso) → `AccountRepository` → `AccountModel` (`@Entity`)

<p class="small">Atalho: o repositório do Hands-on 1 é uma interface do Spring Data — um tipo do framework no caso de uso. Tudo bem para um CRUD pequeno; a versão estrita adiciona porta + adaptador + <b>Mapper</b>.</p>

---

## `POST /accounts`, camada por camada

1. `AccountController` (adaptador) recebe o JSON → `service.create(AccountIn)`.
2. `AccountService` (caso de uso) → `repository.findByEmail` — **regra da aplicação**: e-mail único.
3. `Account.of(in)` (entidade) — **invariantes do domínio**: e-mail válido, senha ≥ 8 caracteres, gera o hash.
4. `repository.save(account)` → a porta é implementada por `AccountJpaAdapter`.
5. Adaptador → `AccountMapper.toTable` → `INSERT` JPA no Postgres.
6. `AccountOut` → `201 Created`.

<div class="ok">

Em tempo de execução, as chamadas vão **para fora**; as dependências do código apontam **para dentro**. Nenhuma regra sabe que o Postgres existe.

</div>

---

## Hexagonal: portas e adaptadores

Alistair Cockburn, 2005. Uma **porta** é uma interface **que pertence ao núcleo**; um **adaptador** se encaixa nela pelo lado de fora.

| Porta | Direção | Implementada por | Exemplo |
|---|---|---|---|
| **Primária / entrada** | fora → app | a aplicação | `AuthService`, chamada pelo controller REST |
| **Secundária / saída** | app → fora | um adaptador externo | `AccountRepository`, implementada pelo JPA |

- Adaptadores de entrada: controller REST, `@KafkaListener`, CLI, a **suíte de testes**.
- Adaptadores de saída: JPA (Postgres), Feign (`account-service`), Redis, produtor Kafka, fakes em memória.

<p class="small">O formato de hexágono é arbitrário: vários pontos de entrada/saída equivalentes, sem nenhum lado privilegiado.</p>

---

## Teste o núcleo sem infraestrutura

```java
class AuthServiceTest {
    InMemoryAccountRepository accounts = new InMemoryAccountRepository();
    AuthService service = new AuthServiceImpl(accounts, tokens, jwt); // tokens: in-memory too

    @Test
    void loginFails_whenPasswordIsWrong() {
        accounts.save(Account.of(new RegisterIn("Ada", "ada@example.com", "securepass")));
        assertThatThrownBy(() -> service.login("ada@example.com", "wrongpassword"))
            .isInstanceOf(InvalidCredentialsException.class);
    }
}
```

Sem `@SpringBootTest`, sem H2, sem porta 8080 — roda em **milissegundos**.

---

## Clean × Hexagonal

| Aspecto | Clean | Hexagonal |
|---|---|---|
| Abstração central | camadas concêntricas + Regra de Dependência | hexágono + portas e adaptadores |
| Direção das dependências | sempre para dentro | sempre rumo ao núcleo |
| Vocabulário | Entities · Use Cases · Adapters · Frameworks | Domain · App Services · Ports · Adapters |
| Testes | camadas internas isoladas | substituir os adaptadores |

<div class="ok">

Complementares: a **Hexagonal** define *como* funciona a fronteira; a **Clean** define *o que* vai dentro dela. A maioria dos microsserviços modernos combina as duas.

</div>

<p class="small">Não exagere na arquitetura de um CRUD: portas e mappers compensam com regras ricas, vida longa ou E/S substituível.</p>

---

## CQRS

A maioria das aplicações lê muito mais do que escreve: separe **comandos** de **consultas**.

- Mais leve: dois conjuntos de classes sobre o **mesmo BD**.
- Intermediário: um **armazenamento de leitura separado** (Redis, índice de busca) alimentado por eventos.
- Mais pesado: `POST /orders` → Event Store → Kafka → Projetor → **Modelo de leitura** ← `GET /orders`.

| | Lado de comando | Lado de consulta |
|---|---|---|
| Consistência | forte | **eventual** (o modelo de leitura atrasa) |
| Escalabilidade | vazão de escrita | vazão de leitura, de forma independente |
| Armazenamento | normalizado ou log de eventos | desnormalizado, com junções prontas |

<p class="small">Armadilha: ler as próprias escritas. Event Sourcing é opcional — veja a aula de Eventos e o Hands-on 9.</p>

---

## Erros comuns

<div class="warn">

- **Tipos do framework vazando para dentro**: `@Entity`, `@JsonProperty`, `HttpServletRequest` em um Use Case.
- **Controllers gordos**: `if`s e orquestração — controllers traduzem e delegam.
- **Modelo de domínio anêmico**: entidades como sacos de dados; leve as invariantes para a Entity.
- **Portas moldadas pelo adaptador**: espelhar os nomes do `JpaRepository` em vez de conceitos do domínio.
- **O núcleo importando o adaptador**: `import com.example.adapter.*` no domínio.
- **Uma porta por método**: `SaveAccountPort`, `FindAccountPort`… → explosão de interfaces.

</div>

---

## Pontos-chave

1. Sem uma regra, você tem uma **Big Ball of Mud**; a solução é **uma única direção de dependência**, rumo ao núcleo — inverta a seta das camadas.
2. O **SOLID** é a base no nível das classes; o **DIP** é o que torna as arquiteturas possíveis.
3. **Clean**: Entities → Use Cases → Adapters → Frameworks; a **Regra de Dependência** aponta para dentro.
4. **Hexagonal**: o núcleo é dono das **portas**; os **adaptadores** se encaixam pelo lado de fora.
5. Troque os adaptadores para testar o núcleo em **milissegundos**, sem Spring nem banco de dados.
6. Clean e Hexagonal são **complementares** — a maioria dos microsserviços usa as duas.
7. O **CQRS** separa escritas de leituras, ao preço da **consistência eventual** — use-o onde as leituras predominam.
