**SOLID** é um acrônimo para cinco princípios de design orientado a objetos apresentados por Robert C. Martin[^1]. Eles foram formulados pela primeira vez em seu artigo de 2000, *Design Principles and Design Patterns*, e popularizados pelo livro *Clean Code* (2008). Esses princípios atuam no **nível de classes e módulos** — são os blocos de construção que a Clean Architecture e a Arquitetura Hexagonal impõem no nível do sistema.

| Letra | Princípio | Proposto por |
|---|---|---|
| **S** | Princípio da Responsabilidade Única (Single Responsibility) | Robert C. Martin |
| **O** | Princípio Aberto/Fechado (Open/Closed) | Bertrand Meyer, 1988[^2] |
| **L** | Princípio da Substituição de Liskov (Liskov Substitution) | Barbara Liskov, 1987[^3] |
| **I** | Princípio da Segregação de Interfaces (Interface Segregation) | Robert C. Martin |
| **D** | Princípio da Inversão de Dependência (Dependency Inversion) | Robert C. Martin |

``` mermaid
flowchart LR
    S["S — Responsabilidade Única\nUm motivo para mudar"] -->|compõe| arch
    O["O — Aberto / Fechado\nEstenda, não modifique"] -->|compõe| arch
    L["L — Substituição de Liskov\nSubtipos respeitam contratos"] -->|compõe| arch
    I["I — Segregação de Interfaces\nSem dependências forçadas"] -->|compõe| arch
    D["D — Inversão de Dependência\nDependa de abstrações"] -->|compõe| arch
    arch["Arquitetura\nClean / Hexagonal"]:::highlight
    classDef highlight fill:#fcc
```

---

## S — Princípio da Responsabilidade Única

> "Uma classe deve ter um, e apenas um, motivo para mudar." — Robert C. Martin

Uma classe *responde a* um único ator. Um ator é um grupo de usuários ou stakeholders que se importam com a mesma preocupação. Se uma classe atende a dois atores, as mudanças pedidas por um deles correm o risco de quebrar funcionalidades do outro.

!!! info "O que o SRP NÃO significa"
    O SRP não significa que uma classe deva fazer uma única coisa. Significa que uma classe deve ter um único *motivo para mudar* — um único dono. Uma classe de serviço pode orquestrar vários passos, mas, se todos esses passos atendem à mesma preocupação de negócio e ao mesmo stakeholder, a classe tem uma responsabilidade única.

=== ":x: Violação"

    ``` { .java .copy .select linenums="1" title="AccountService.java — too many concerns" }
    --8<-- "docs/2026.1/classes/architectures/solid/examples/SrpBadAccountService.java"
    ```

    Esta classe tem **quatro motivos para mudar**: uma regra de validação diferente, uma mudança no schema do banco de dados, um novo template de e-mail ou um formato de auditoria diferente — todos exigem modificar o mesmo arquivo.

=== ":white_check_mark: Aplicado"

    ``` { .java .copy .select linenums="1" title="AccountService.java — focused on orchestration" }
    --8<-- "docs/2026.1/classes/architectures/solid/examples/SrpGoodAccountService.java"
    ```

    Cada classe especialista muda apenas pelo seu próprio motivo. `AccountService` só muda quando o fluxo de criação de contas muda.

``` mermaid
flowchart LR
    subgraph bad ["❌ Antes — uma classe, muitas preocupações"]
        as["AccountService\n• validar\n• persistir\n• enviar e-mail\n• auditar"]
    end
    subgraph good ["✅ Depois — uma classe por preocupação"]
        direction TB
        as2["AccountService\n(orquestrar)"]
        r["AccountRepository\n(persistir)"]
        e["EmailService\n(notificar)"]
        a["AuditService\n(registrar)"]
        as2 --> r & e & a
    end
```

---

## O — Princípio Aberto/Fechado

> "Entidades de software devem ser abertas para extensão, mas fechadas para modificação." — Bertrand Meyer

Um módulo é *aberto* se pode ser estendido com novos comportamentos. É *fechado* se o seu código-fonte é estável — os consumidores e testes existentes não quebram quando um novo comportamento é adicionado. O mecanismo é a **abstração**: defina uma interface da qual os chamadores dependem e, depois, adicione novas implementações sem tocar nos chamadores.

=== ":x: Violação"

    ``` { .java .copy .select linenums="1" title="DiscountService.java — modified for every new type" }
    --8<-- "docs/2026.1/classes/architectures/solid/examples/OcpBadDiscountService.java"
    ```

=== ":white_check_mark: Aplicado — interface"

    ``` { .java .copy .select linenums="1" title="DiscountPolicy.java — extension point" }
    --8<-- "docs/2026.1/classes/architectures/solid/examples/OcpGoodDiscountPolicy.java"
    ```

=== ":white_check_mark: Aplicado — serviço"

    ``` { .java .copy .select linenums="1" title="DiscountService.java — closed for modification" }
    --8<-- "docs/2026.1/classes/architectures/solid/examples/OcpGoodDiscountService.java"
    ```

``` mermaid
classDiagram
    class DiscountService {
        +calculate(account) double
    }
    class DiscountPolicy {
        <<interface>>
        +appliesTo(account) bool
        +calculate(account) double
    }
    class VipDiscountPolicy
    class EmployeeDiscountPolicy
    class PartnerDiscountPolicy

    DiscountService --> DiscountPolicy
    VipDiscountPolicy ..|> DiscountPolicy
    EmployeeDiscountPolicy ..|> DiscountPolicy
    PartnerDiscountPolicy ..|> DiscountPolicy
```

Adicionar `PartnerDiscountPolicy` exige criar uma única classe nova — `DiscountService` nunca é tocado.

---

## L — Princípio da Substituição de Liskov

> "Se S é um subtipo de T, então objetos do tipo T podem ser substituídos por objetos do tipo S sem alterar nenhuma das propriedades desejáveis do programa." — Barbara Liskov, 1987

Todo subtipo deve respeitar o **contrato** do supertipo — não apenas as assinaturas dos métodos, mas o **comportamento**. Um chamador que funciona corretamente com `T` deve funcionar corretamente com qualquer `S extends T`, sem modificações.

=== ":x: Violação — Square estende Rectangle"

    ``` { .java .copy .select linenums="1" title="Rectangle.java / Square.java — contract broken" }
    --8<-- "docs/2026.1/classes/architectures/solid/examples/LspBadSquare.java"
    ```

=== ":white_check_mark: Aplicado — interface comum"

    ``` { .java .copy .select linenums="1" title="Shape.java — subtypes honour the contract" }
    --8<-- "docs/2026.1/classes/architectures/solid/examples/LspGoodShape.java"
    ```

``` mermaid
classDiagram
    class Shape {
        <<interface>>
        +area() int
    }
    class Rectangle {
        -width int
        -height int
        +area() int
    }
    class Square {
        -side int
        +area() int
    }
    Rectangle ..|> Shape
    Square ..|> Shape
```

!!! tip "LSP e testes"
    Um teste prático: se substituir um subtipo faz falhar um teste escrito para o supertipo, o subtipo viola o LSP. É por isso que uma suíte de testes escrita contra uma interface (`Shape`) deve passar para todas as implementações.

---

## I — Princípio da Segregação de Interfaces

> "Clientes não devem ser forçados a depender de interfaces que não usam." — Robert C. Martin

Uma interface inchada obriga os clientes a declarar dependências de métodos que eles nunca chamam. Quando esses métodos mudam — por motivos que não têm relação com o cliente —, o cliente precisa ser recompilado e reimplantado. Interfaces menores e focadas minimizam o acoplamento.

=== ":x: Violação — interface inchada"

    ``` { .java .copy .select linenums="1" title="AccountRepository.java — fat interface" }
    --8<-- "docs/2026.1/classes/architectures/solid/examples/IspBadAccountRepository.java"
    ```

=== ":white_check_mark: Aplicado — segregada"

    ``` { .java .copy .select linenums="1" title="AccountReader / AccountWriter / AccountAdmin" }
    --8<-- "docs/2026.1/classes/architectures/solid/examples/IspGoodAccountRepository.java"
    ```

``` mermaid
classDiagram
    class AccountReader {
        <<interface>>
        +findById(id)
        +findByEmail(email)
        +findAll()
    }
    class AccountWriter {
        <<interface>>
        +save(account)
        +delete(id)
    }
    class AccountAdmin {
        <<interface>>
        +findByRole(role)
        +bulkImport(accounts)
    }
    AccountAdmin --|> AccountReader
    class JpaAccountAdapter
    JpaAccountAdapter ..|> AccountReader
    JpaAccountAdapter ..|> AccountWriter
    JpaAccountAdapter ..|> AccountAdmin

    class AccountService {
        -reader AccountReader
        -writer AccountWriter
    }
    AccountService --> AccountReader
    AccountService --> AccountWriter
```

`AccountService` depende apenas de `AccountReader` e `AccountWriter`. Mudanças nos métodos de administração ou de relatórios nunca o afetam.

---

## D — Princípio da Inversão de Dependência

> "Módulos de alto nível não devem depender de módulos de baixo nível. Ambos devem depender de abstrações. Abstrações não devem depender de detalhes. Detalhes devem depender de abstrações." — Robert C. Martin

Sem o DIP, a lógica de negócio de alto nível (casos de uso) conhece e instancia a infraestrutura de baixo nível (bancos de dados, clientes HTTP). Uma mudança no banco de dados obriga a reescrever a lógica de negócio. O DIP inverte isso: o módulo de alto nível declara uma interface (a abstração), e o módulo de baixo nível a implementa. Ambos dependem da interface — a seta da dependência aponta para a regra de negócio, não para a infraestrutura.

=== ":x: Violação — instanciação direta"

    ``` { .java .copy .select linenums="1" title="AccountService.java — tightly coupled to MySql" }
    --8<-- "docs/2026.1/classes/architectures/solid/examples/DipBadAccountService.java"
    ```

=== ":white_check_mark: Aplicado — depende de abstração"

    ``` { .java .copy .select linenums="1" title="AccountService.java + AccountRepository + JpaAccountRepository" }
    --8<-- "docs/2026.1/classes/architectures/solid/examples/DipGoodAccountService.java"
    ```

``` mermaid
flowchart LR
    subgraph bad ["❌ Antes"]
        as_bad["AccountService"] -->|new| mysql["MySqlAccountRepository"]
    end
    subgraph good ["✅ Depois"]
        as_good["AccountService"] -->|depende de| iface["«interface»\nAccountRepository"]
        jpa["JpaAccountRepository"] -->|implementa| iface
        memory["InMemoryAccountRepository\n(teste)"] -->|implementa| iface
    end
```

O DIP é o princípio que torna possíveis a **Clean Architecture** e a **Arquitetura Hexagonal**: ao inverter as dependências em cada fronteira entre camadas, cada camada pode ser desenvolvida, testada e substituída de forma independente.

---

## Resumo

| Princípio | Problema resolvido | Mecanismo |
|---|---|---|
| **SRP** | Classes que mudam por vários motivos quebram chamadores não relacionados | Uma preocupação por classe |
| **OCP** | Modificar código existente para adicionar funcionalidades quebra o comportamento existente | Estender por meio de novas implementações de uma interface |
| **LSP** | Subtipos que quebram os contratos do supertipo causam bugs sutis em tempo de execução | Respeitar os contratos comportamentais, não só as assinaturas dos métodos |
| **ISP** | Interfaces inchadas obrigam os chamadores a depender de métodos que não usam | Dividir as interfaces conforme a necessidade de cada cliente |
| **DIP** | Lógica de alto nível acoplada à infraestrutura de baixo nível | Ambos dependem de uma abstração; os detalhes dependem das políticas |

---

[^1]: MARTIN, R. C. *Agile Software Development: Principles, Patterns, and Practices*. Pearson, 2002.
[^2]: MEYER, B. *Object-Oriented Software Construction*, 1st ed. Prentice Hall, 1988.
[^3]: LISKOV, B.; WING, J. [A Behavioral Notion of Subtyping](https://dl.acm.org/doi/10.1145/197320.197383){target="_blank"}. ACM TOPLAS, 1994.
[^4]: MARTIN, R. C. [The Single Responsibility Principle](https://blog.cleancoder.com/uncle-bob/2014/05/08/SingleReponsibilityPrinciple.html){target="_blank"}. The Clean Code Blog, 2014.
