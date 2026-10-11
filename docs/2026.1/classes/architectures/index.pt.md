A arquitetura de software define como os componentes de um sistema são organizados, como eles se comunicam e — o mais importante — quais componentes **podem conhecer quais outros**. As duas arquiteturas abordadas aqui compartilham o mesmo objetivo fundamental: **proteger a lógica de negócio de preocupações externas**, como frameworks, bancos de dados e mecanismos de entrega.

Essa separação importa porque as preocupações externas mudam com mais frequência do que as regras de negócio. Uma migração de banco de dados, a atualização de um framework ou um novo protocolo de API não deveriam exigir a reescrita da lógica central.

---

## O problema central

Sem uma regra arquitetural explícita, as dependências se acumulam nas duas direções. Um `UserService` acaba importando anotações JPA; um controller contém lógica de validação; um método de repositório retorna códigos de status HTTP. O resultado é uma **Big Ball of Mud** (grande bola de lama) — um sistema em que cada componente conhece todos os outros, o que torna impossíveis os testes isolados, a substituição de partes e o trabalho paralelo entre equipes.

As duas arquiteturas resolvem isso com uma única restrição: **as dependências fluem em uma única direção**, apontando para o núcleo estável.

``` mermaid
flowchart LR
  External["Mundo externo\n(HTTP, BD, MQ, CLI)"]
  Core["Núcleo da aplicação\n(Regras de negócio)"]
  External -->|adapters / controllers| Core
  Core -.->|nunca importa| External
```

---

## Tópicos abordados

<div class="grid cards" markdown>

-   :material-check-decagram:{ .lg .middle } **Princípios SOLID**

    ---

    Cinco regras de design no nível de classe — Responsabilidade Única, Aberto/Fechado, Substituição de Liskov, Segregação de Interfaces e Inversão de Dependência — que tornam o código manutenível e testável. A base sobre a qual as duas arquiteturas abaixo se apoiam.

    [:octicons-arrow-right-24: Princípios SOLID](solid/index.md)

-   :material-layers:{ .lg .middle } **Clean Architecture**

    ---

    Organiza o código em camadas concêntricas com uma **Regra de Dependência** explícita: nada em uma camada interna pode referenciar algo de uma camada externa. Proposta por Robert C. Martin como uma síntese das arquiteturas Hexagonal, Onion e BCE.

    [:octicons-arrow-right-24: Clean Architecture](clean/index.md)

-   :material-hexagon-outline:{ .lg .middle } **Arquitetura Hexagonal**

    ---

    Coloca o núcleo da aplicação no centro e o expõe por meio de **ports** (interfaces). Os sistemas externos se conectam por meio de **adapters**. Também chamada de *Ports & Adapters*, foi apresentada por Alistair Cockburn em 2005.

    [:octicons-arrow-right-24: Arquitetura Hexagonal](hexagonal/index.md)

</div>

---

## Comparação lado a lado

| Aspecto | Clean Architecture | Arquitetura Hexagonal |
|---|---|---|
| Abstração central | Camadas concêntricas + Regra de Dependência | Hexágono + Ports & Adapters |
| Direção das dependências | Sempre para dentro | Sempre em direção ao núcleo |
| Vocabulário | Entities · Use Cases · Adapters · Frameworks | Domínio · Serviços de aplicação · Ports · Adapters |
| Estratégia de testes | Camadas internas testáveis isoladamente | Núcleo testável substituindo os adapters |
| Flexibilidade | Framework e BD podem ser trocados | Qualquer sistema externo pode ser trocado |
| Relação | Incorpora as ideias da Hexagonal | A Clean Architecture é um superconjunto |

!!! tip "Qual usar?"
    As duas arquiteturas são complementares e costumam ser usadas juntas. Pense na **Hexagonal** como a definição de *como* funciona a fronteira da aplicação (ports & adapters), e na **Clean Architecture** como a definição do *que* fica dentro dessas fronteiras (camadas com políticas de dependência explícitas). A maioria dos microsserviços modernos combina as duas.

---

[^1]: MARTIN, R. C. *Clean Architecture: A Craftsman's Guide to Software Structure and Design*. Prentice Hall, 2017. [:fontawesome-brands-amazon:](https://www.amazon.com.br/Clean-Architecture-Craftsmans-Software-Structure/dp/B075LRM681/){:target='_blank'}

[^2]: COCKBURN, A. [Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/){:target="_blank"}, 2005.
