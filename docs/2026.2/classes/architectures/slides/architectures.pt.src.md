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
Objetivos: explicar cada princípio SOLID e achar uma violação; explicar a Regra de Dependência e situar uma classe
numa camada da Clean Architecture; projetar portas e adaptadores (de entrada e de saída); comparar camadas, Clean e
Hexagonal e justificar a estrutura extra; testar um caso de uso com um adaptador em memória; descrever o CQRS e seu custo.
Roteiro: (1) o problema central e o ponto de partida em camadas; (2) SOLID; (3) Clean Architecture; (4) Hexagonal;
(5) comparação lado a lado; (6) CQRS.
-->

---

## O account service daqui a um ano

<div class="q">

O mobile quer um endpoint, o time de banco quer um serviço gerenciado, a segurança quer contas criadas a partir de um evento Kafka e alguém precisa de testes que rodem em segundos. E se as regras ("um e-mail só pode ser cadastrado uma vez", "uma senha tem pelo menos 8 caracteres") estiverem emaranhadas com anotações do Spring, SQL e códigos de status HTTP?

</div>

* Cada um desses pedidos vira uma **reescrita**.
* A arquitetura decide **quais componentes podem conhecer quais outros**.
* Objetivo: **proteger a lógica de negócio das preocupações externas** — frameworks, bancos e protocolos mudam mais do que as regras de negócio.

---

## O problema central

- Sem uma regra, as dependências se acumulam nas duas direções: um `UserService` importa anotações JPA, um controller valida, um repositório retorna códigos de status HTTP.
- O resultado é uma **Big Ball of Mud** (grande bola de lama): sem testes isolados, sem trocar partes, sem trabalho em paralelo dos times.
- A solução é uma restrição: **as dependências fluem numa única direção**, para o núcleo estável — adaptadores e controllers apontam para o núcleo, o núcleo **nunca importa** o mundo externo (HTTP, banco, mensageria, CLI).

<div class="ok">

Uma **dependência** = uma referência em tempo de compilação (um `import`, o tipo de um campo, um `new B()`). Aponte-a do que muda sempre (frameworks, protocolos) para o que muda pouco (regras de negócio).

</div>

---

## O ponto de partida: arquitetura em camadas

<div class="cols">
<div>

### Em camadas (n-tier)

`AccountController` → `AccountService` → `JpaRepository` (Spring Data) → Postgres

Um bom primeiro passo, mas a **lógica de negócio depende da persistência**.

</div>
<div>

### Clean / Hexagonal

`AccountService` → «interface» `AccountRepository` ← `AccountJpaAdapter` → Postgres

O serviço é dono de uma interface **em termos de negócio**; **a persistência depende do negócio**.

</div>
</div>

<div class="ok">

Essa única mudança é o **Princípio da Inversão de Dependência** (o "D" do SOLID) aplicado na fronteira — o que as próximas três partes desenvolvem.

</div>

---

<div class="kicker">SOLID</div>

## SOLID — design no nível das classes

O `AccountService` cresce: validação, e-mail de boas-vindas, log de auditoria, descontos, importação em lote… 600 linhas, testes sem relação quebram, nenhum teste unitário sem banco e servidor SMTP. Um problema de **design de classes**.

| | Princípio | Criado por |
|---|---|---|
| **S** | Responsabilidade Única | Robert C. Martin |
| **O** | Aberto/Fechado | Bertrand Meyer, 1988 |
| **L** | Substituição de Liskov | Barbara Liskov, 1987; com Jeannette Wing, 1994 |
| **I** | Segregação de Interfaces | Robert C. Martin |
| **D** | Inversão de Dependência | Robert C. Martin |

<p class="small">Reunidos por Martin (artigo de 2000; livro de 2002); a sigla é de Michael Feathers, por volta de 2004. Nível de classe — os blocos que a Clean e a Hexagonal impõem no nível do sistema.</p>

---

## S — Responsabilidade Única

> "Uma classe deve ter um e apenas um motivo para mudar."

- Uma classe responde a **um ator** (um grupo de interessados com a mesma preocupação).
- Violação: o `AccountService` valida, persiste, envia o e-mail e audita — **quatro motivos para mudar** num arquivo.
- Aplicado: `AccountRepository` (persistir), `EmailService` (notificar), `AuditService` (registrar); o `AccountService` só **orquestra** e só muda quando o fluxo de criação de conta muda.

<div class="q">

O SRP **não** significa "fazer uma coisa só": um serviço pode orquestrar vários passos se todos servem à mesma preocupação e ao mesmo dono.

</div>

---

<!-- _class: tight -->

## O — Aberto/Fechado

> "Aberto para extensão, mas fechado para modificação." — Bertrand Meyer

```java
public class DiscountService {
    private final List<DiscountPolicy> policies;   // the extension point
    public double calculate(Account account) {
        return policies.stream()
            .filter(p -> p.appliesTo(account))
            .findFirst()
            .map(p -> p.calculate(account))
            .orElse(account.orderTotal() * 0.05);
    }
}
```

- Acrescentar a `PartnerDiscountPolicy` = **uma classe nova** com `@Component`; o Spring injeta todas as `DiscountPolicy` na lista.
- **Fechado contra quais mudanças?** Coloque a abstração no eixo **provável** de variação (novos tipos de cliente), não "por via das dúvidas".

---

## L — Substituição de Liskov

Subtipos precisam honrar o **contrato** do supertipo — o comportamento, não só as assinaturas.

<div class="cols">
<div>

### Violação

`Square extends Rectangle` sobrescreve os setters: `setWidth(5); setHeight(3);` → `area()` dá **9**, não 15.

Correção: `Rectangle` e `Square` implementam uma interface `Shape` com `area()`.

</div>
<div>

### Na loja: adaptadores de teste

`InMemoryAccountRepository` e `AccountJpaAdapter` implementam `AccountRepository`. Se o banco rejeita um e-mail duplicado e a versão em memória o sobrescreve, **os testes unitários passam e a produção falha**.

</div>
</div>

<div class="ok">

Um teste escrito para o supertipo precisa passar para todo subtipo: rode um mesmo **teste de contrato** nos dois adaptadores.

</div>

---

## I — Segregação de Interfaces

> "Clientes não devem ser forçados a depender de interfaces que não usam."

- Um `AccountRepository` gordo (find, save, delete, `findByRole`, `bulkImport`…) faz todo chamador depender dos métodos de administração e relatórios — e recompilar quando eles mudam.
- Divida pela necessidade do cliente: `AccountReader`, `AccountWriter`, `AccountAdmin` (que estende o reader).
- O `JpaAccountAdapter` implementa as três; o `AccountService` depende só de `AccountReader` e `AccountWriter`.

---

<!-- _class: tight -->

## D — Inversão de Dependência

> "Módulos de alto nível não devem depender de módulos de baixo nível. Ambos devem depender de abstrações."

```java
public interface AccountRepository {            // owned by the business code
    Optional<Account> findById(String id);
    Account save(Account account);
}
public class AccountService {                    // high-level: depends on the abstraction
    private final AccountRepository repository;
    public AccountService(AccountRepository repository) { this.repository = repository; }
}
@Repository
public class JpaAccountRepository implements AccountRepository { /* ... */ }
```

- Antes: `new MySqlAccountRepository()`. Depois: JPA em produção, `InMemoryAccountRepository` nos testes.
- **Quem é dono da interface** importa: declarada ao lado do `AccountService`, em termos de negócio — não espelhando o JPA no pacote de persistência.
- **Injeção de Dependência** (o Spring ligando os beans) é a *técnica*; **Inversão de Controle**, o framework chamando seu código; o DIP é o *princípio*: o tipo injetado é uma abstração do módulo de alto nível.

---

## SOLID é um guia, não um objetivo

| Princípio | Problema resolvido | Mecanismo |
|---|---|---|
| **SRP** | classes que mudam por vários motivos | uma preocupação por classe |
| **OCP** | editar código para acrescentar funcionalidades | novas implementações de uma interface |
| **LSP** | subtipos que quebram contratos | honrar o comportamento, não só as assinaturas |
| **ISP** | interfaces gordas | dividir pela necessidade do cliente |
| **DIP** | lógica acoplada à infraestrutura | ambos dependem de uma abstração |

<div class="warn">

**Excesso**: uma interface para cada classe (uma implementação, nenhum fake) · SRP até um método por classe · herança para reaproveitar código (prefira composição) · generalidade especulativa (**YAGNI**).

</div>

---

<div class="kicker">Clean Architecture</div>

## Clean Architecture

Robert C. Martin, 2012 — uma síntese de Hexagonal, Onion, Screaming Architecture, DCI e BCE.

| Camada | Também chamada | Responsabilidade |
|---|---|---|
| **Entities** (entidades) | Domínio | regras de negócio e dados de toda a empresa |
| **Use Cases** (casos de uso) | Aplicação | o que a aplicação *faz*; orquestram as Entities |
| **Interface Adapters** | Adaptadores | Controllers, Presenters, Gateways — convertem dados |
| **Frameworks & Drivers** | Infraestrutura | web, banco, UI, APIs externas — todo detalhe |

<div class="ok">

**A Regra de Dependência**: nada numa camada interna referencia uma camada externa. Os dados atravessam as fronteiras como objetos simples ou records — nada de `@Entity` ou `HttpServletRequest` num Use Case.

</div>

---

## Atravessando uma fronteira e onde fica cada classe

Como um Use Case salva uma conta sem referenciar o banco? **Inversão de Dependência**: ele declara o `AccountRepository` e a camada externa o implementa. Em tempo de execução a chamada vai **para fora**; no código-fonte a dependência aponta **para dentro**.

- Muda quando o **negócio** muda → **Entity ou Use Case**.
- Muda quando a **interface** muda (REST → gRPC, JSON → XML) → **Interface Adapter**.
- Muda quando uma **biblioteca** é atualizada (Spring Boot, dialeto do JPA) → **Frameworks & Drivers**.

<p class="small">Uma regra de negócio que precisa de uma anotação do framework? Leve a regra para uma classe interna e deixe a anotação no adaptador.</p>

---

<!-- _class: tight -->

## Na nossa arquitetura: Hands-on 1

| Classe do Hands-on 1 | Papel | Camada |
|---|---|---|
| `AccountController` (interface) + `AccountResource` | Interface | Interface Adapters |
| `AccountIn`, `AccountOut` | RecordIn / RecordOut: o contrato HTTP | Interface Adapters |
| `AccountParser` | Parser: `Record*` ↔ DTOs do caso de uso | fronteira Adapters ↔ Use Cases |
| `AccountService` | Service: a lógica do caso de uso | Use Cases |
| `Account` | DTO / objeto de domínio | Use Cases / Entities |
| `AccountRepository` (`CrudRepository` do Spring Data) | Repository | fronteira de persistência |
| `AccountModel` (`@Entity`) | Table, alcançada por um **Mapper** | fronteira de persistência |

<div class="warn">

**Um atalho pragmático**: o repositório estende uma interface do Spring Data, então o serviço depende de um tipo do framework — a rigor, uma violação. Uma troca justa para um serviço CRUD pequeno; a versão estrita dá ao serviço uma interface simples e só o adaptador conhece o JPA.

</div>

---

## `POST /accounts`, camada por camada

1. O `AccountController` (adaptador) recebe o JSON → `service.create(AccountIn)`.
2. O `AccountService` (caso de uso) → `repository.findByEmail` — **regra da aplicação**: o e-mail é único.
3. `Account.of(in)` (entidade) — **invariantes do domínio**: o e-mail tem @, a senha tem ≥ 8 caracteres, gera o hash.
4. `repository.save(account)` → a porta é implementada pelo `AccountJpaAdapter`.
5. O adaptador → `AccountMapper.toTable` → `INSERT` no Postgres.
6. `AccountOut` → `201 Created`.

<div class="ok">

Nenhuma regra sabe que o Postgres existe. Ganho: casos de uso testados com JUnit puro, REST ou persistência trocados sem tocá-los, times construindo adaptadores em paralelo sobre portas combinadas.

</div>

---

## Clean Architecture: erros comuns

- **Tipos do framework vazando para dentro**: `@Entity`, `@Column`, `@JsonProperty` ou `HttpServletRequest` num Use Case ou Entity.
- **Controllers gordos**: `if`s, vários serviços, fluxos — controllers traduzem e delegam, nada mais.
- **Modelo de domínio anêmico**: entidades como sacos de dados com toda a lógica no serviço; leve os invariantes para a Entity, como faz o `Account.of(...)`.
- **Mapear tudo em todo lugar**: um modelo por camada num serviço CRUD sem regras reais é puro overhead; mantenha a separação estrita onde estão as regras.

---

<div class="kicker">Arquitetura Hexagonal</div>

## Hexagonal: dentro e fora

O auth service é **chamado** pelo gateway (em breve por um consumidor Kafka, uma CLI, seus testes) e **chama** o account via Feign, uma biblioteca JWT, o Redis. Para as regras de login, tudo isso é **o mundo externo**.

Alistair Cockburn, 2005 — **Ports & Adapters**. Sem em cima nem embaixo: só **dentro** e **fora**.

| Porta | Direção | Implementada por | Exemplo |
|---|---|---|---|
| **Primária / de entrada** (*driving*) | fora → aplicação | a própria aplicação | `AuthService`, chamada pelo controller REST |
| **Secundária / de saída** (*driven*) | aplicação → fora | um adaptador externo | `AccountRepository`, implementada pelo JPA |

<div class="ok">

Os dois tipos **pertencem ao núcleo**; o adaptador se conecta de fora — **o núcleo nunca importa o adaptador**.

</div>

---

## Portas e adaptadores no código

<div class="cols">
<div>

```java
// primary port, in the core
public interface AuthService {
    TokenOut login(String email,
                   String password);
    void logout(String token);
}
// secondary port, in the core
public interface AccountRepository {
    Optional<Account> findByEmail(String email);
    Account save(Account account);
}
```

</div>
<div>

- O `AuthServiceImpl` implementa a porta primária e depende só de portas secundárias.
- **Adaptadores de entrada**: `AuthController` (`POST /auth/login`), uma CLI, um `@KafkaListener`, a suíte de testes.
- **Adaptadores de saída**: `AccountJpaAdapter` (mapeia `AccountTable` ↔ `Account`), Feign, Redis, um produtor Kafka, `InMemoryAccountRepository`.

</div>
</div>

---

## Uma requisição atravessando o hexágono

1. Gateway → `AuthController` (adaptador de entrada): `POST /auth/login {email, password}`.
2. → `login(email, password)` pela **porta `AuthService`** → `AuthServiceImpl` (núcleo).
3. → `findByEmail(email)` pela **porta `AccountRepository`** → `AccountJpaAdapter` → Postgres.
4. `Account` (mapeada de `AccountTable`) → `matchesPassword`, gera o JWT.
5. `TokenOut` → `200 OK` + token.

<div class="ok">

Troque o gateway por um teste e o adaptador JPA pelo `InMemoryAccountRepository`: o núcleo roda exatamente o mesmo código — é esse o objetivo.

</div>

---

<!-- _class: tight -->

## Os serviços da loja como hexágonos

| Ator externo | Tipo | Adaptador na loja |
|---|---|---|
| gateway chamando `POST /auth/login` | entrada | `AuthResource` / `AuthController` (REST) |
| tópico Kafka `accounts` | entrada | um consumidor `@KafkaListener` |
| teste JUnit | entrada | a própria classe de teste |
| `account-service` | saída | cliente Feign (`AccountController` no Hands-on 3) |
| Postgres | saída | `AccountJpaAdapter` |
| Redis (cache, tokens revogados) | saída | um adaptador Redis |
| Kafka (publicando `AccountCreated`) | saída | um adaptador `KafkaTemplate` |

<div class="q">

**O Hands-on 3 sob esta ótica**: o `AuthService` chama a interface Feign `AccountController`, definida pelo módulo `account` — uma porta moldada pelo serviço remoto. A versão estrita declara uma porta pequena no núcleo do auth (`AccountLookup.findByEmail`), com o Feign como um adaptador por trás dela.

</div>

---

<!-- _class: tight -->

## Teste o núcleo sem infraestrutura

```java
class AuthServiceTest {
    private final InMemoryAccountRepository accounts = new InMemoryAccountRepository();
    private final InMemoryTokenRepository   tokens   = new InMemoryTokenRepository();
    private final JwtService                jwt      = new JwtService("test-secret");
    private final AuthService               service  =
        new AuthServiceImpl(accounts, tokens, jwt);

    @Test
    void loginFails_whenPasswordIsWrong() {
        accounts.save(Account.of(new RegisterIn("Ada", "ada@example.com", "securepass")));

        assertThatThrownBy(() -> service.login("ada@example.com", "wrongpassword"))
            .isInstanceOf(InvalidCredentialsException.class);
    }
}
```

Sem `@SpringBootTest`, sem H2, sem porta 8080 — o teste aciona a porta primária e roda em **milissegundos**.

---

## Hexagonal: erros comuns

- **Portas definidas pelo adaptador**: um `AccountRepository` que espelha os nomes do `JpaRepository` — nomeie as portas em termos do **domínio**.
- **O núcleo importando o adaptador**: qualquer `import com.example.adapter.*` no domínio; a injeção de dependência resolve o adaptador em tempo de execução.
- **Granularidade errada das portas**: uma porta *por método* (`SaveAccountPort`, `FindAccountByEmailPort`…) explode; agrupe por coesão. Uma interface por **caso de uso** no lado de entrada é um estilo legítimo — escolha uma convenção por serviço.
- **Vazando objetos de domínio pelo adaptador de entrada**: devolver o `Account` (com o `passwordHash`) no controller acopla o HTTP ao domínio e vaza um segredo — devolva `TokenOut`, `AccountOut`.

---

<div class="kicker">Comparação</div>

<!-- _class: tight -->

## Lado a lado

| Aspecto | Em camadas (n-tier) | Clean | Hexagonal |
|---|---|---|---|
| **Abstração central** | camadas horizontais | camadas concêntricas + Regra de Dependência | hexágono + portas e adaptadores |
| **Direção das dependências** | de cima para baixo, rumo ao banco | sempre para dentro | sempre para o núcleo |
| **Vocabulário** | Controller · Service · Repository | Entities · Use Cases · Interface Adapters · Frameworks & Drivers | Domínio · Serviços de aplicação · Portas · Adaptadores |
| **Testes** | em geral precisa de um banco (ou de mocks de tipos do framework) | camadas internas isoladas | núcleo testado trocando os adaptadores |
| **Flexibilidade** | trocar o banco mexe nos serviços | framework e banco podem ser trocados | qualquer sistema externo pode ser trocado |
| **Relação** | o ponto de partida usual | parte da Hexagonal e da Onion, nomeando as camadas internas | a ideia original de fronteira |

<div class="ok">

Complementares: a **Hexagonal** define *como* a fronteira funciona; a **Clean** define *o que* vai dentro dela. A maioria dos microsserviços modernos combina as duas.

</div>

---

## Não exagere na arquitetura de um serviço CRUD

Portas, adaptadores e mappers custam **mais classes, mais conversões, mais indireção** para ler.

- Um serviço que só guarda e devolve registros (uma tabela de referência, um catálogo simples) pode **continuar em camadas**.
- A estrutura compensa quando as **regras de negócio são ricas**, o serviço **vive muito** ou você precisa **trocar ou acrescentar** mecanismos de entrega e armazenamentos.

<div class="ok">

Os microsserviços ajudam: cada serviço escolhe o nível de estrutura de que precisa.

</div>

---

<div class="kicker">CQRS</div>

## CQRS — Command Query Responsibility Segregation

O catálogo: milhares de `GET /products?category=...` por segundo, alguns `PUT /products/{id}` por hora. Um único modelo precisa ser normalizado para escritas seguras **e** desnormalizado para buscas rápidas — e não atende bem a nenhum dos dois.

- Separe o **lado de escrita** (comandos alteram o estado) do **lado de leitura** (consultas devolvem visões): modelados, armazenados e escalados de forma independente.
- Estende a *Command-Query Separation* de Bertrand Meyer (um método altera o estado ou devolve dados, nunca os dois) de métodos para modelos inteiros; nomeado por Greg Young por volta de 2010.
- Forma mais pesada: `POST /orders` → command handler → event store (anexa `OrderCreated`) → event bus → projetor → modelo de leitura ← `GET /orders`.

---

<!-- _class: tight -->

## CQRS: os dois lados e seus graus

| Aspecto | Lado de comando | Lado de consulta |
|---|---|---|
| **Responsabilidade** | valida e aplica alterações | serve visões desnormalizadas, otimizadas para consulta |
| **Consistência** | forte (sucesso ou falha atômicos) | **eventual** (o modelo de leitura fica para trás) |
| **Escalabilidade** | vazão de escrita | vazão de leitura, de forma independente |
| **Armazenamento** | normalizado ou log de eventos | tabelas ou documentos desnormalizados, já combinados |

- Mais leve: dois conjuntos de classes sobre o **mesmo banco**. Intermediário: um **armazenamento de leitura separado** (Redis, um índice de busca) alimentado por eventos. Mais pesado: um **event store**.
- Muitas vezes combinado com **Event Sourcing** (comandos anexam eventos imutáveis; o modelo de leitura é reconstruído pela reprodução) — mas o CQRS não o exige. Veja a aula de Event-Driven e o Hands-on 10.

<div class="warn">

**Ler as próprias escritas**: o usuário salva um produto e a lista ainda mostra o nome antigo — a interface precisa tolerar ou esconder o atraso. **Aplicar em tudo**: Fowler alerta que o CQRS serve só para *algumas* partes de um sistema — use-o na parte quente, dominada por leituras.

</div>

---

## Pontos-chave

1. Arquitetura trata de **quem pode depender de quem**: dos detalhes voláteis (frameworks, bancos, protocolos) para as regras de negócio estáveis.
2. A clássica arquitetura **em camadas** faz a lógica de negócio depender da persistência; a **Inversão de Dependência** na fronteira inverte essa seta.
3. O **SOLID** atua no nível das classes; a **Clean** (camadas + Regra de Dependência) e a **Hexagonal** (portas + adaptadores) aplicam a mesma ideia ao serviço inteiro e normalmente são combinadas.
4. As portas **pertencem ao núcleo** e têm nomes do domínio; trocar adaptadores testa o núcleo em **milissegundos**.
5. O ganho é **testabilidade e substituibilidade**; o custo é mais classes e mapeamentos — ajuste a estrutura à complexidade do serviço.
6. O **CQRS** separa escritas de leituras, ao preço da **consistência eventual**; ele não exige Event Sourcing.
