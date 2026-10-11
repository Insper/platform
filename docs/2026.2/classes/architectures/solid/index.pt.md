
No [Hands-on 1](../../../hands-on/1/index.md), o `AccountService` começa pequeno: criar, ler, apagar. Depois alguém adiciona validação de e-mail, um e-mail de boas-vindas, um log de auditoria, uma regra de desconto por tipo de cliente, uma importação em massa para administradores… Seis meses depois, a classe tem 600 linhas, cada mudança quebra um teste que não tem nada a ver com ela, e ninguém consegue fazer um teste unitário sem um banco de dados e um servidor SMTP. Nada disso ainda é um problema de *arquitetura* — é um problema de **projeto de classes**, e o SOLID é o vocabulário para tratá-lo.

**SOLID** é um acrônimo para cinco princípios de projeto orientado a objetos reunidos por Robert C. Martin[^1]. Ele os descreveu juntos pela primeira vez no artigo *Design Principles and Design Patterns*, de 2000, e no livro *Agile Software Development: Principles, Patterns, and Practices* (2002); o acrônimo em si foi sugerido por Michael Feathers por volta de 2004. Esses princípios atuam no **nível das classes e dos módulos** — são os blocos de construção que a Clean Architecture e a Arquitetura Hexagonal impõem no nível do sistema.

| Letra | Princípio | Proposto por |
|---|---|---|
| **S** | Princípio da Responsabilidade Única (*Single Responsibility*) | Robert C. Martin |
| **O** | Princípio Aberto/Fechado (*Open/Closed*) | Bertrand Meyer, 1988[^2] |
| **L** | Princípio da Substituição de Liskov (*Liskov Substitution*) | Barbara Liskov, 1987; formalizado com Jeannette Wing em 1994[^3] |
| **I** | Princípio da Segregação de Interfaces (*Interface Segregation*) | Robert C. Martin |
| **D** | Princípio da Inversão de Dependência (*Dependency Inversion*) | Robert C. Martin |

``` mermaid-sim
flowchart LR
    S["S — Responsabilidade Única\nUm motivo para mudar"] -->|compõe| arch
    O["O — Aberto / Fechado\nEstenda, não modifique"] -->|compõe| arch
    L["L — Substituição de Liskov\nSubtipos honram contratos"] -->|compõe| arch
    I["I — Segregação de Interfaces\nSem dependências forçadas"] -->|compõe| arch
    D["D — Inversão de Dependência\nDependa de abstrações"] -->|compõe| arch
    arch["Arquitetura\nClean / Hexagonal"]:::highlight
    classDef highlight fill:#fcc
```

---

## S — Princípio da Responsabilidade Única

> "Uma classe deve ter um, e apenas um, motivo para mudar." — Robert C. Martin

Uma classe *responde a* um ator[^4]. Um ator é um grupo de usuários ou de partes interessadas que se importam com a mesma preocupação. Se uma classe atende a dois atores, as mudanças pedidas por um correm o risco de quebrar funcionalidades do outro.

!!! info "O que o SRP NÃO significa"
    O SRP não significa que uma classe deve fazer só uma coisa. Significa que uma classe deve ter um único *motivo para mudar* — um dono. Uma classe de serviço pode orquestrar vários passos, mas, se todos esses passos atendem à mesma preocupação de negócio e à mesma parte interessada, a classe tem uma única responsabilidade.

=== ":x: Violação"

    ``` { .java .copy .select linenums="1" title="AccountService.java — too many concerns" }
    --8<-- "docs/2026.2/classes/architectures/solid/examples/SrpBadAccountService.java"
    ```

    Esta classe tem **quatro motivos para mudar**: uma regra de validação diferente, uma mudança no esquema do banco de dados, um novo template de e-mail ou um formato de auditoria diferente — todos exigem modificar o mesmo arquivo.

=== ":white_check_mark: Aplicado"

    ``` { .java .copy .select linenums="1" title="AccountService.java — focused on orchestration" }
    --8<-- "docs/2026.2/classes/architectures/solid/examples/SrpGoodAccountService.java"
    ```

    Cada classe especialista muda apenas pelo seu próprio motivo. O `AccountService` só muda quando o fluxo de criação de conta muda.

``` mermaid-sim
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

> "Entidades de software devem estar abertas para extensão, mas fechadas para modificação." — Bertrand Meyer

Um módulo é *aberto* se pode ser estendido com novo comportamento. É *fechado* se o seu código-fonte é estável — os consumidores e testes existentes não quebram quando um novo comportamento é adicionado. O mecanismo é a **abstração**: defina uma interface da qual quem chama depende e, depois, adicione novas implementações sem mexer em quem chama.

=== ":x: Violação"

    ``` { .java .copy .select linenums="1" title="DiscountService.java — modified for every new type" }
    --8<-- "docs/2026.2/classes/architectures/solid/examples/OcpBadDiscountService.java"
    ```

=== ":white_check_mark: Aplicado — interface"

    ``` { .java .copy .select linenums="1" title="DiscountPolicy.java — extension point" }
    --8<-- "docs/2026.2/classes/architectures/solid/examples/OcpGoodDiscountPolicy.java"
    ```

=== ":white_check_mark: Aplicado — serviço"

    ``` { .java .copy .select linenums="1" title="DiscountService.java — closed for modification" }
    --8<-- "docs/2026.2/classes/architectures/solid/examples/OcpGoodDiscountService.java"
    ```

``` mermaid-sim
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

Adicionar `PartnerDiscountPolicy` exige criar uma única classe nova — o `DiscountService` nunca é tocado. No Spring, basta anotar cada política com `@Component`: o container injeta todos os beans `DiscountPolicy` no parâmetro `List<DiscountPolicy>` do construtor.

!!! warning "Fechado contra quais mudanças?"
    Nenhuma classe é fechada contra todas as mudanças. O OCP pede que você antecipe o eixo **provável** de variação (aqui: novos tipos de cliente) e coloque a abstração ali. Adicionar pontos de extensão "por via das dúvidas" produz interfaces com uma única implementação para sempre.

---

## L — Princípio da Substituição de Liskov

> "Se S é um subtipo de T, então objetos do tipo T podem ser substituídos por objetos do tipo S sem alterar nenhuma das propriedades desejáveis do programa." — a paráfrase usual de Barbara Liskov (1987) e de Liskov & Wing (1994)

Todo subtipo precisa honrar o **contrato** do supertipo — não apenas as assinaturas dos métodos, mas o **comportamento**. Um código que funciona corretamente com `T` precisa funcionar corretamente com qualquer `S extends T`, sem modificações.

=== ":x: Violação — Square extends Rectangle"

    ``` { .java .copy .select linenums="1" title="Rectangle.java / Square.java — contract broken" }
    --8<-- "docs/2026.2/classes/architectures/solid/examples/LspBadSquare.java"
    ```

=== ":white_check_mark: Aplicado — interface comum"

    ``` { .java .copy .select linenums="1" title="Shape.java — subtypes honour the contract" }
    --8<-- "docs/2026.2/classes/architectures/solid/examples/LspGoodShape.java"
    ```

``` mermaid-sim
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
    Um teste prático: se substituir por um subtipo faz falhar um teste escrito para o supertipo, o subtipo viola o LSP. É por isso que uma suíte de testes escrita contra uma interface (`Shape`) precisa passar para todas as implementações.

!!! example "LSP na loja: adaptadores de teste"
    O `InMemoryAccountRepository` (usado nos testes unitários) e o `AccountJpaAdapter` (usado em produção) implementam `AccountRepository`. Se o banco de dados rejeita um e-mail duplicado por meio de uma restrição `UNIQUE`, mas a versão em memória o sobrescreve silenciosamente, os dois **não** são substituíveis: os testes unitários passam e a produção falha. Mantenha idêntico em todas as implementações o comportamento que a porta promete — não só as assinaturas dos métodos —, de preferência rodando um único *teste de contrato* compartilhado contra as duas.

---

## I — Princípio da Segregação de Interfaces

> "Clientes não devem ser forçados a depender de interfaces que não usam." — Robert C. Martin

Uma interface "gorda" obriga os clientes a declarar dependências de métodos que nunca chamam. Quando esses métodos mudam — por motivos que nada têm a ver com o cliente —, o cliente precisa ser recompilado e implantado de novo. Interfaces menores e focadas minimizam o acoplamento.

=== ":x: Violação — interface gorda"

    ``` { .java .copy .select linenums="1" title="AccountRepository.java — fat interface" }
    --8<-- "docs/2026.2/classes/architectures/solid/examples/IspBadAccountRepository.java"
    ```

=== ":white_check_mark: Aplicado — segregada"

    ``` { .java .copy .select linenums="1" title="AccountReader / AccountWriter / AccountAdmin" }
    --8<-- "docs/2026.2/classes/architectures/solid/examples/IspGoodAccountRepository.java"
    ```

``` mermaid-sim
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

O `AccountService` depende apenas de `AccountReader` e `AccountWriter`. Mudanças nos métodos de administração ou de relatórios nunca o afetam.

---

## D — Princípio da Inversão de Dependência

> "Módulos de alto nível não devem depender de módulos de baixo nível. Ambos devem depender de abstrações. Abstrações não devem depender de detalhes. Detalhes devem depender de abstrações." — Robert C. Martin

Sem o DIP, a lógica de negócio de alto nível (os casos de uso) conhece e instancia a infraestrutura de baixo nível (bancos de dados, clientes HTTP). Uma mudança no banco de dados força a reescrita da lógica de negócio. O DIP inverte isso: o módulo de alto nível declara uma interface (a abstração) e o módulo de baixo nível a implementa. Ambos dependem da interface — a seta de dependência aponta para a regra de negócio, não para a infraestrutura.

=== ":x: Violação — instanciação direta"

    ``` { .java .copy .select linenums="1" title="AccountService.java — tightly coupled to MySql" }
    --8<-- "docs/2026.2/classes/architectures/solid/examples/DipBadAccountService.java"
    ```

=== ":white_check_mark: Aplicado — depende de abstração"

    ``` { .java .copy .select linenums="1" title="AccountService.java + AccountRepository + JpaAccountRepository" }
    --8<-- "docs/2026.2/classes/architectures/solid/examples/DipGoodAccountService.java"
    ```

``` mermaid-sim
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

Repare em **quem é dono da interface**: `AccountRepository` é declarada ao lado do `AccountService` (o módulo de alto nível), em termos de negócio, e a classe JPA a implementa. Se a interface ficasse no pacote de persistência e espelhasse o JPA, a dependência não estaria de fato invertida.

O DIP (um princípio de projeto) é frequentemente confundido com dois mecanismos relacionados:

- **Injeção de Dependência** (*Dependency Injection*) — uma técnica: os objetos recebem as suas dependências (normalmente pelo construtor) em vez de criá-las com `new`. O container do Spring faz isso para todo `@Service`, `@Repository` e `@Component`.
- **Inversão de Controle** (*Inversion of Control*) — a ideia geral de que um framework chama o seu código (e o conecta), em vez de o seu código chamar o framework.

A Injeção de Dependência é a forma como o DIP costuma ser *implementado* no Spring, mas injetar uma classe concreta ainda acopla você a ela; o DIP exige que o tipo injetado seja uma abstração que pertence ao módulo de alto nível.

O DIP é o princípio que torna possíveis a **Clean Architecture** e a **Arquitetura Hexagonal**: ao inverter as dependências em cada fronteira entre camadas, cada camada pode ser desenvolvida, testada e substituída de forma independente.

---

## Resumo

| Princípio | Problema resolvido | Mecanismo |
|---|---|---|
| **SRP** | Classes que mudam por vários motivos quebram quem não tem nada a ver com a mudança | Uma preocupação por classe |
| **OCP** | Modificar código existente para adicionar funcionalidades quebra o comportamento existente | Estender por meio de novas implementações de uma interface |
| **LSP** | Subtipos que quebram os contratos do supertipo causam bugs sutis em tempo de execução | Honrar contratos de comportamento, não só assinaturas de métodos |
| **ISP** | Interfaces gordas obrigam quem chama a depender de métodos que não usa | Dividir as interfaces de acordo com a necessidade do cliente |
| **DIP** | Lógica de alto nível acoplada à infraestrutura de baixo nível | Ambos dependem de uma abstração; os detalhes dependem das políticas |

!!! warning "SOLID é um guia, não um objetivo"
    - **Uma interface para cada classe.** Uma interface com exatamente uma implementação e nenhum dublê de teste só acrescenta um arquivo e mais nada. Introduza a abstração quando surgir uma segunda implementação (ou um fake de teste).
    - **SRP levado a um método por classe.** Dividir demais espalha um conceito de negócio por dez arquivos; divida pelo *motivo para mudar*, não pela quantidade de linhas.
    - **Herança para reaproveitar código.** A maioria das violações do LSP vem de `extends` usado para compartilhar código; prefira composição e interfaces pequenas.
    - **Generalidade especulativa.** Princípios aplicados a requisitos futuros imaginários produzem uma complexidade que você paga hoje (YAGNI — *You Aren't Gonna Need It*, "você não vai precisar disso").

---

## Pontos-chave

- O SOLID trata de **gerenciar mudanças**: cada princípio limita o quanto uma mudança em um lugar se propaga pelo código.
- **SRP**: um motivo para mudar (um ator) por classe. **OCP**: adicione comportamento adicionando classes atrás de uma interface.
- **LSP**: subtipos e implementações precisam manter o **comportamento** do contrato — incluindo dublês de teste e adaptadores.
- **ISP**: dê a cada cliente uma interface pequena, só com o que ele usa. **DIP**: o código de negócio é dono das interfaces; a infraestrutura as implementa.
- **DIP + injeção de dependência** é a ponte para a [Clean Architecture](../clean/index.md) e a [Arquitetura Hexagonal](../hexagonal/index.md), em que as mesmas ideias são aplicadas ao serviço inteiro.

---

[^1]: MARTIN, R. C. *Agile Software Development: Principles, Patterns, and Practices*. Pearson, 2002.
[^2]: MEYER, B. *Object-Oriented Software Construction*, 1st ed. Prentice Hall, 1988.
[^3]: LISKOV, B.; WING, J. [A Behavioral Notion of Subtyping](https://dl.acm.org/doi/10.1145/197320.197383){target="_blank"}. ACM TOPLAS, 1994.
[^4]: MARTIN, R. C. [The Single Responsibility Principle](https://blog.cleancoder.com/uncle-bob/2014/05/08/SingleReponsibilityPrinciple.html){target="_blank"}. The Clean Code Blog, 2014.
