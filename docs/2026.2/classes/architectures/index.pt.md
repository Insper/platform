
Abra o `account-service` do [Hands-on 1](../../hands-on/1/index.md) daqui a um ano. O time de produto quer um endpoint para o app mobile, o time de banco de dados quer migrar do Postgres para um serviço gerenciado, o time de segurança quer que as contas sejam criadas a partir de um evento Kafka, e alguém precisa escrever testes que rodem em segundos. Se as regras de negócio ("um e-mail só pode ser cadastrado uma vez", "uma senha tem pelo menos 8 caracteres") estiverem emaranhadas com anotações do Spring, SQL e códigos de status HTTP, cada um desses pedidos vira uma reescrita.

A arquitetura de software define como os componentes de um sistema são organizados, como se comunicam e — mais importante — quais componentes **podem conhecer quais outros**. As arquiteturas vistas aqui compartilham o mesmo objetivo fundamental: **proteger a lógica de negócio de preocupações externas**, como frameworks, bancos de dados e mecanismos de entrega. Essa separação importa porque as preocupações externas mudam com mais frequência do que as regras de negócio. Uma migração de banco de dados, uma atualização de framework ou um novo protocolo de API não deveriam exigir reescrever a lógica central.

!!! abstract "Objetivos de aprendizagem"

    Ao final desta aula, você deve ser capaz de:

    - **Explicar** cada princípio SOLID e **identificar** uma violação dele em código Java.
    - **Explicar** a Regra de Dependência e **posicionar** uma classe de um serviço Spring Boot na camada certa da Clean Architecture.
    - **Projetar** um serviço com portas e adaptadores, distinguindo portas de entrada (*driving*) de portas de saída (*driven*).
    - **Comparar** as arquiteturas em camadas, Clean e Hexagonal, e **justificar** quando a estrutura extra compensa.
    - **Escrever** um teste unitário para um caso de uso, substituindo o adaptador de banco de dados por um em memória.
    - **Descrever** o CQRS e o seu custo (consistência eventual), e decidir quando ele vale a pena.

## Slides

<div class="slides-embed">
  <iframe src="slides/architectures.html" title="Slides: arquiteturas" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/architectures.html){:target="_blank"}

---

## Roteiro

Leia as páginas nesta ordem — cada uma se apoia na anterior:

<div class="grid cards" markdown>

-   :material-check-decagram:{ .lg .middle } **1. Princípios SOLID**

    ---

    Cinco regras de projeto no nível das classes — Responsabilidade Única, Aberto/Fechado, Substituição de Liskov, Segregação de Interfaces, Inversão de Dependência — que tornam o código manutenível e testável. A base em que as duas arquiteturas abaixo se apoiam.

    [:octicons-arrow-right-24: Princípios SOLID](solid/index.md)

-   :material-layers:{ .lg .middle } **2. Clean Architecture**

    ---

    Organiza o código em camadas concêntricas com uma **Regra de Dependência** explícita: nada em uma camada interna pode referenciar algo de uma camada externa. Proposta por Robert C. Martin como uma síntese de ideias anteriores, incluindo a Hexagonal e a Onion.

    [:octicons-arrow-right-24: Clean Architecture](clean/index.md)

-   :material-hexagon-outline:{ .lg .middle } **3. Arquitetura Hexagonal**

    ---

    Coloca o núcleo da aplicação no centro e o expõe por meio de **portas** (interfaces). Os sistemas externos se conectam por **adaptadores**. Também chamada de *Ports & Adapters*, foi apresentada por Alistair Cockburn em 2005.

    [:octicons-arrow-right-24: Arquitetura Hexagonal](hexagonal/index.md)

</div>

Esta página de visão geral termina com uma comparação entre as duas arquiteturas e com o **CQRS**, um padrão que separa os lados de escrita e de leitura de um serviço.

---

## O problema central

Sem uma regra arquitetural explícita, as dependências se acumulam nas duas direções. Um `UserService` acaba importando anotações JPA; um controller contém lógica de validação; um método de repositório retorna códigos de status HTTP. O resultado é uma **Big Ball of Mud**[^3] (grande bola de lama) — um sistema em que cada componente conhece todos os outros, o que torna impossíveis os testes isolados, a substituição de partes e o trabalho em paralelo dos times.

As arquiteturas desta aula resolvem isso com uma única restrição: **as dependências fluem em uma só direção**, apontando para o núcleo estável.

``` mermaid-sim
flowchart LR
  External["Mundo externo<br>(HTTP, BD, MQ, CLI)"]
  Core["Núcleo da aplicação<br>(regras de negócio)"]
  External -->|adaptadores / controllers| Core
  Core -.->|nunca importa| External
```

Uma **dependência**, aqui, significa uma referência em tempo de compilação: a classe `A` depende de `B` se o código-fonte de `A` menciona `B` (um `import`, o tipo de um campo, um `new B()`). Se `B` muda, `A` pode ter que mudar também — então as dependências devem apontar do que muda com frequência (frameworks, protocolos) para o que muda raramente (regras de negócio).

### O ponto de partida: arquitetura em camadas

A maioria dos serviços Spring Boot — incluindo os do hands-on — começa com a clássica **arquitetura em camadas (n-tier)**: controller → service → repository → banco de dados. É um bom primeiro passo, porque separa o tratamento do HTTP da lógica de negócio. Mas veja para onde apontam as setas:

``` mermaid-sim
flowchart LR
  subgraph layered ["Em camadas: o negócio depende da persistência"]
    direction LR
    c1["AccountController"] --> s1["AccountService"]
    s1 --> r1["JpaRepository<br>(Spring Data)"]
    r1 --> db1[("Postgres")]
  end
  subgraph clean ["Clean / Hexagonal: a persistência depende do negócio"]
    direction LR
    c2["AccountController"] --> s2["AccountService"]
    s2 --> p2["«interface»<br>AccountRepository"]
    a2["AccountJpaAdapter"] -->|implementa| p2
    a2 --> db2[("Postgres")]
  end
```

Na versão em camadas, o serviço — a lógica de negócio — depende da tecnologia de persistência. Na versão Clean/Hexagonal, o serviço é dono de uma interface expressa em termos de negócio, e o código de persistência depende dela. Essa única mudança é o **Princípio da Inversão de Dependência** (o "D" do SOLID) aplicado na fronteira, e é isso que as próximas três páginas desenvolvem.

---

## Comparação lado a lado

| Aspecto | Em camadas (n-tier) | Clean Architecture | Arquitetura Hexagonal |
|---|---|---|---|
| Abstração central | camadas horizontais | camadas concêntricas + Regra de Dependência | hexágono + portas e adaptadores |
| Direção das dependências | de cima para baixo, rumo ao banco de dados | sempre para dentro | sempre rumo ao núcleo |
| Vocabulário | Controller · Service · Repository | Entities · Use Cases · Interface Adapters · Frameworks & Drivers | Domain · Application Services · Ports · Adapters |
| Estratégia de testes | em geral precisa de um banco de dados (ou de mocks de tipos do framework) | camadas internas testáveis isoladamente | núcleo testável substituindo os adaptadores |
| Flexibilidade | trocar o BD mexe nos serviços | framework e BD podem ser trocados | qualquer sistema externo pode ser trocado |
| Relação | o ponto de partida habitual | parte explicitamente da Hexagonal e da Onion, nomeando as camadas internas[^1] | a ideia original de fronteira[^2] |

!!! tip "Qual usar?"
    As duas arquiteturas são complementares e costumam ser usadas juntas. Pense na **Hexagonal** como a definição de *como* funciona a fronteira da aplicação (portas e adaptadores), e na **Clean Architecture** como a definição do *que* vai dentro dessas fronteiras (camadas com políticas de dependência explícitas). A maioria dos microsserviços modernos combina as duas.

!!! warning "Não exagere na arquitetura de um serviço CRUD"
    Portas, adaptadores e mappers têm um custo: mais classes, mais conversões, mais indireção para ler. Um serviço que só armazena e devolve registros, sem regras de negócio reais (uma tabela de consulta, um catálogo simples), pode continuar em camadas. A estrutura extra compensa quando as **regras de negócio são ricas**, o serviço **vive por muito tempo** ou você precisa **trocar ou adicionar** mecanismos de entrega e armazenamentos de dados. Os microsserviços ajudam aqui: cada serviço pode escolher o nível de estrutura de que precisa.

---

## CQRS — Command Query Responsibility Segregation

Pense no catálogo de produtos da loja: milhares de requisições `GET /products?category=...` por segundo, alguns `PUT /products/{id}` por hora. Um único modelo precisa ser normalizado para escritas seguras *e* desnormalizado para buscas rápidas — e não atende bem a nenhum dos dois. O CQRS separa o **lado de escrita** (comandos que alteram o estado) do **lado de leitura** (consultas que retornam visões), permitindo que cada um seja modelado, armazenado e escalado de forma independente. A ideia estende a *Command-Query Separation* de Bertrand Meyer (um método ou altera o estado ou retorna dados, nunca os dois) de métodos para modelos inteiros; Greg Young deu o nome por volta de 2010[^4].

``` mermaid-sim
flowchart LR
    client(["Cliente"])

    subgraph write ["Lado de escrita (Command)"]
        cmd["Command Handler"]
        store["Event Store<br>(append-only)"]
        bus["Barramento de eventos<br>(Kafka / em processo)"]
    end

    subgraph read ["Lado de leitura (Query)"]
        proj["Projetor<br>(constrói os modelos de leitura)"]
        view[("Modelo de leitura<br>(otimizado para consultas)")]
    end

    client -->|"POST /orders (Command)"| cmd
    cmd -->|"anexa OrderCreated"| store
    store --> bus
    bus -->|"projeta"| proj
    proj --> view
    client -->|"GET /orders (Query)"| view
```

| Aspecto | Lado de comando | Lado de consulta |
|---|---|---|
| Responsabilidade | Valida e aplica as alterações | Serve visões desnormalizadas, otimizadas para consulta |
| Consistência | Forte (a escrita tem sucesso ou falha de forma atômica) | Eventual (o modelo de leitura fica atrás dos comandos) |
| Escalabilidade | Escala para a vazão de escrita | Escala de forma independente para a vazão de leitura |
| Armazenamento | Normalizado ou log de eventos | Tabelas ou documentos desnormalizados, com junções prontas |

O CQRS tem graus. A forma mais leve são dois conjuntos de classes sobre o **mesmo banco de dados** (os comandos passam pelo modelo de domínio; as consultas leem direto para DTOs). O passo seguinte é um **armazenamento de leitura separado** — por exemplo, Postgres para escritas e Redis ou um índice de busca para leituras — mantido em sincronia por eventos. O diagrama acima mostra a forma mais pesada, com um event store.

!!! tip "CQRS e Event Sourcing"
    O CQRS costuma ser combinado com **Event Sourcing**: em vez de atualizar uma linha no banco de dados, os comandos anexam eventos imutáveis a um event store. O modelo de leitura é reconstruído reproduzindo esses eventos por meio de um projetor. Essa combinação é poderosa, mas complexa — adote-a quando auditabilidade, consultas temporais ou uma assimetria muito grande entre leitura e escrita justificarem o custo. Os dois padrões são abordados na aula de [Arquitetura orientada a eventos](../event_driven/index.md) e implementados com Kafka no [Hands-on 9](../../hands-on/9/index.md).

!!! warning "Armadilhas do CQRS"
    - **Ler as próprias escritas** (*read-your-own-writes*): o usuário salva um produto e a lista ainda mostra o nome antigo, porque a projeção ainda não foi atualizada. A UI precisa tolerar ou esconder esse atraso.
    - **Aplicar em todo lugar**: Martin Fowler alerta que o CQRS se encaixa apenas em *algumas* partes de um sistema e adiciona uma complexidade arriscada nas demais[^5]. Use-o na parte quente e com muitas leituras (o catálogo), não em todos os serviços.

---

## Pontos-chave

- Arquitetura trata de **quem pode depender de quem**: as dependências devem apontar dos detalhes voláteis (frameworks, bancos de dados, protocolos) para as regras de negócio estáveis.
- A clássica arquitetura **em camadas** faz a lógica de negócio depender da persistência; a **Inversão de Dependência** na fronteira inverte essa seta.
- O **SOLID** atua no nível das classes; a **Clean** (camadas + Regra de Dependência) e a **Hexagonal** (portas + adaptadores) aplicam a mesma ideia ao serviço inteiro, e normalmente são combinadas.
- O ganho é **testabilidade e substituibilidade**; o custo é mais classes e mapeamentos — ajuste a estrutura à complexidade do serviço.
- O **CQRS** separa escritas de leituras para que cada uma possa ser otimizada, ao preço da **consistência eventual**; ele não exige Event Sourcing.

[^1]: MARTIN, R. C. *Clean Architecture: A Craftsman's Guide to Software Structure and Design*. Prentice Hall, 2017. [:fontawesome-brands-amazon:](https://www.amazon.com.br/Clean-Architecture-Craftsmans-Software-Structure/dp/B075LRM681/){:target='_blank'}

[^2]: COCKBURN, A. [Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/){:target="_blank"}, 2005.

[^3]: FOOTE, B.; YODER, J. [Big Ball of Mud](http://www.laputan.org/mud/){:target="_blank"}. PLoP '97, 1997.

[^4]: YOUNG, G. [CQRS Documents](https://cqrs.files.wordpress.com/2010/11/cqrs_documents.pdf){:target="_blank"}, 2010.

[^5]: FOWLER, M. [CQRS](https://martinfowler.com/bliki/CQRS.html){:target="_blank"}, 2011.
