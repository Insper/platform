
Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Princípios SOLID

**Q1.** `AccountService.createAccount` valida a entrada, executa um `INSERT` SQL, envia um e-mail de boas-vindas e grava um log de auditoria. Qual princípio ele viola mais diretamente, e por quê?

- A. Substituição de Liskov — ele não estende uma classe base
- B. Responsabilidade Única — ele tem vários motivos para mudar (regras de validação, esquema, template de e-mail, formato de auditoria), cada um pertencente a uma parte interessada diferente
- C. Segregação de Interfaces — ele tem métodos públicos demais
- D. Aberto/Fechado — ele é declarado como `public`

??? success "Resposta"
    **B — Responsabilidade Única.**

    O SRP trata de *motivos para mudar*, não da quantidade de métodos. Um novo template de e-mail, uma mudança de esquema e um novo formato de auditoria obrigam a editar a mesma classe. A correção mantém o `AccountService` como orquestrador e delega para `AccountRepository`, `EmailService` e `AuditService`.

---

**Q2.** `Square extends Rectangle` sobrescreve `setWidth` e `setHeight` para manter os dois lados iguais. Um teste faz `r.setWidth(5); r.setHeight(3); assert r.area() == 15;` e falha para um `Square`. Qual princípio é violado?

- A. Responsabilidade Única
- B. Aberto/Fechado
- C. Substituição de Liskov — o subtipo não honra o contrato de comportamento do supertipo
- D. Inversão de Dependência

??? success "Resposta"
    **C — Substituição de Liskov.**

    As assinaturas dos métodos batem, mas o comportamento não: um código escrito para `Rectangle` quebra quando recebe um `Square`. O LSP trata de comportamento, não de tipos. A correção é abandonar a herança e fazer os dois implementarem uma interface `Shape` com `area()`.

---

**Q3.** No Princípio da Inversão de Dependência, **quem deve ser dono** da interface `AccountRepository` usada pelo `AccountService`?

- A. O módulo JPA, já que ele implementa a interface
- B. O Spring, já que ele injeta a implementação
- C. O módulo de alto nível (o código de negócio/aplicação), expressa nos seus próprios termos; o código JPA de baixo nível a implementa
- D. Ninguém — o DIP proíbe interfaces

??? success "Resposta"
    **C — O módulo de alto nível.**

    Se a interface vive junto do código de persistência e espelha o JPA, o código de negócio continua dependendo da persistência. O DIP inverte a seta: o lado de negócio declara do que precisa, e a infraestrutura depende dessa declaração. A injeção de dependência do Spring apenas *conecta* a implementação em tempo de execução; ela, por si só, não inverte nenhuma dependência.

---

## Clean Architecture

**Q4.** A **Regra de Dependência** da Clean Architecture diz que as dependências do código-fonte devem sempre apontar em qual direção?

- A. Para fora — as camadas internas dependem das externas para utilitários do framework
- B. Nas duas direções — camadas internas e externas podem importar umas às outras livremente
- C. Para dentro — as camadas externas dependem das internas, e as camadas internas nunca referenciam nada de uma camada externa
- D. Para baixo — as camadas de nível mais alto dependem da infraestrutura de nível mais baixo

??? success "Resposta"
    **C — Sempre para dentro.**

    A camada de Entities não sabe nada sobre os Use Cases; os Use Cases não sabem nada sobre Controllers ou bancos de dados. Isso significa que trocar o framework web, mudar o ORM ou adicionar um novo mecanismo de entrega (REST → gRPC) exige mexer apenas nas camadas mais externas — as regras de negócio continuam intactas.

---

**Q5.** Qual camada contém as **regras de negócio específicas da aplicação**, que orquestram as Entities para cumprir um caso de uso?

- A. A camada de Entities (Domínio) — ela contém toda a lógica de negócio
- B. A camada de Interface Adapters — ela processa as requisições de entrada
- C. A camada de Use Cases (Aplicação) — ela define o que a aplicação faz e orquestra os objetos de domínio
- D. A camada de Frameworks & Drivers — ela coordena o framework web e o banco de dados

??? success "Resposta"
    **C — A camada de Use Cases (Aplicação).**

    A camada de Entities guarda as regras *de toda a empresa* (Money válido, invariantes de Order). A camada de Use Cases guarda as regras *específicas da aplicação*: "para fazer um pedido, valide o carrinho, reserve o estoque, cobre o cliente." Os casos de uso dependem de interfaces das entidades, nunca de frameworks.

---

**Q6.** Em quais camadas uma anotação `@Entity` do Spring **não** pode aparecer?

- A. Na camada de Interface Adapters — ela faz a ponte entre o framework e o caso de uso
- B. Na camada de Frameworks & Drivers — todo detalhe de infraestrutura mora aqui
- C. Nas camadas de Entities (Domínio) e de Use Cases (Aplicação) — elas precisam ser livres de framework
- D. Ela pode aparecer em qualquer lugar, desde que a lógica de negócio esteja no serviço

??? success "Resposta"
    **C — As camadas de Domínio e de Use Cases precisam ser livres de framework.**

    `@Entity` é uma anotação do JPA — uma preocupação de Frameworks & Drivers. Se ela aparece em uma classe de domínio ou em um caso de uso, essa camada passa a depender do framework de persistência, violando a Regra de Dependência. Os objetos de domínio devem ser classes Java simples, sem imports de framework. O `@Entity` pertence a uma classe separada de modelo de persistência (`AccountTable`, ou `AccountModel` no Hands-on 1) nas camadas externas, ao lado do adaptador que a usa.

---

**Q7.** Qual é o papel do **Parser** na Clean Architecture com Spring Boot do curso?

- A. Ele valida o JSON de entrada contra um esquema antes de repassá-lo ao controller
- B. Ele traduz entre os tipos HTTP `RecordIn`/`RecordOut` e os DTOs do Use Case, mantendo limpos os dois lados da fronteira
- C. Ele converte os resultados de consultas ao banco de dados em respostas HTTP
- D. Ele criptografa os campos sensíveis antes que saiam do serviço

??? success "Resposta"
    **B — Traduz entre os tipos da fronteira dos adaptadores e os tipos do caso de uso.**

    O Parser fica na fronteira entre a camada de Interface Adapters e a camada de Use Cases. No Hands-on 1, o `AccountParser` converte `AccountIn` (o contrato HTTP) em `Account` (o objeto do caso de uso) na entrada, e `Account` de volta em `AccountOut` na saída. Nem o controller nem o serviço precisam conhecer a representação do outro.

---

**Q8.** Uma classe `Service` chama `accountRepository.findById()`, em que `accountRepository` é um **`JpaRepository` do Spring Data** — e não uma interface definida pelo domínio. Que erro de Clean Architecture isso ilustra?

- A. Modelo de domínio anêmico — toda a lógica está na camada de serviço
- B. Controller gordo — o serviço está fazendo trabalho demais
- C. Tipos do framework vazando para dentro — o Use Case agora depende de um tipo de Frameworks & Drivers
- D. Persistência substituível — o serviço está usando corretamente uma abstração

??? success "Resposta"
    **C — Tipos do framework vazando para dentro.**

    `JpaRepository` é um tipo do Spring Data / de Frameworks & Drivers. Se o `Service` (camada de Use Cases) o importa diretamente, a camada de Use Cases passa a depender da camada mais externa — uma violação direta da Regra de Dependência. A abordagem estrita: declare uma interface `AccountRepository` na camada de domínio e deixe o adaptador JPA implementá-la. (O Hands-on 1 toma esse atalho de propósito, para manter simples um pequeno serviço CRUD — é uma troca consciente, não um acidente.)

---

## Arquitetura Hexagonal

**Q9.** Na Arquitetura Hexagonal, quem **define** a interface da porta secundária (de saída)?

- A. A tecnologia externa que a implementa (por exemplo, o provedor JPA)
- B. O adaptador que faz a ponte entre a tecnologia e a aplicação
- C. O núcleo da aplicação — os dois tipos de porta pertencem ao núcleo e são definidos por ele, não pela tecnologia externa
- D. O container de injeção de dependência do framework, em tempo de execução

??? success "Resposta"
    **C — O núcleo da aplicação é dono de todas as definições de porta.**

    Essa é a inversão de controle fundamental. A interface `AccountRepository` é declarada dentro do núcleo da aplicação, em termos do domínio (`findByEmail`, `save`). O adaptador JPA implementa essa interface e vive na camada externa. O núcleo nunca importa o adaptador.

---

**Q10.** O que distingue um **adaptador de entrada (primário)** de um **adaptador de saída (secundário)**?

- A. Os adaptadores de entrada vivem dentro do hexágono; os de saída vivem fora dele
- B. Um adaptador de entrada inicia a interação com o núcleo (por exemplo, o controller REST chama a porta primária); um adaptador de saída implementa aquilo de que o núcleo precisa do mundo externo (por exemplo, o adaptador JPA implementa a porta de repositório)
- C. Os adaptadores de saída são testados automaticamente; os de entrada exigem testes manuais
- D. Os adaptadores de entrada cuidam das escritas; os de saída cuidam das leituras

??? success "Resposta"
    **B — O de entrada inicia; o de saída implementa.**

    Um adaptador de entrada é algo que *chama* a aplicação: controller REST, CLI, consumidor de mensagens, teste. Um adaptador de saída é algo que a aplicação *chama*: banco de dados, serviço de e-mail, API externa. Os dois vivem fora do hexágono e se conectam pelas respectivas portas.

---

**Q11.** Qual é o principal **benefício para os testes** da Arquitetura Hexagonal?

- A. Todos os adaptadores podem ser testados sem um núcleo da aplicação em execução
- B. O framework cuida de toda a preparação dos testes por meio de anotações como `@SpringBootTest`
- C. O núcleo da aplicação pode ser totalmente testado com testes unitários simples, substituindo os adaptadores de saída por stubs em memória — sem contexto do Spring, sem banco de dados, sem servidor rodando
- D. Os testes de integração rodam 10× mais rápido porque o hexágono compila para bytecode de forma mais eficiente

??? success "Resposta"
    **C — Núcleo testável com testes unitários simples e stubs em memória.**

    O `AuthServiceImpl` recebe uma interface `AccountRepository`. Em um teste, substitua-a por `InMemoryAccountRepository` (um `HashMap`). O teste roda em milissegundos, sem infraestrutura. Essa é a propriedade arquitetural que torna o TDD viável na prática — a regra de negócio é testada diretamente, e não através do HTTP e de um banco de dados real.

---

**Q12.** Um time define `AccountRepository` com métodos que espelham o `JpaRepository` do Spring Data. O que há de errado nisso?

- A. Nada — espelhar os métodos do JPA é a forma correta de definir uma porta secundária
- B. O adaptador (JPA) está moldando a porta, em vez de o núcleo defini-la em termos do domínio — a interface deveria expressar a intenção do domínio, não a mecânica da persistência
- C. A interface tem métodos de menos — as portas deveriam expor todas as operações possíveis de banco de dados
- D. A porta deveria estender `JpaRepository` diretamente para evitar duplicação

??? success "Resposta"
    **B — O adaptador está moldando a porta.**

    Se `AccountRepository` tem `saveAll()`, `deleteById(Long id)`, `flush()`, `findAll(Pageable)` — esses são conceitos do Spring Data. Uma porta orientada ao domínio expressaria conceitos do domínio: `findByEmail(String email)`, `save(Account account)`. Quando a porta espelha o adaptador, você acidentalmente fez o domínio depender do vocabulário da infraestrutura, e não o contrário.

---

**Q13.** Como a **Clean Architecture** e a **Arquitetura Hexagonal** se relacionam?

- A. São abordagens concorrentes — um sistema precisa escolher uma ou outra
- B. A Arquitetura Hexagonal é um subconjunto mais simples; a Clean Architecture é sempre preferida em produção
- C. São complementares — a Hexagonal define *como* funciona a fronteira da aplicação (portas e adaptadores); a Clean Architecture define *o que* vai dentro dessas fronteiras (camadas com políticas de dependência explícitas)
- D. A Clean Architecture é o modelo mais antigo; a Arquitetura Hexagonal a substituiu por completo

??? success "Resposta"
    **C — Complementares, muitas vezes usadas juntas.**

    A Arquitetura Hexagonal dá o *lado de fora* do hexágono — portas e adaptadores na fronteira. A Clean Architecture dá o *lado de dentro* — camadas explícitas (Entities, Use Cases) com uma Regra de Dependência. A maioria dos microsserviços Spring Boot modernos combina as duas: hexagonal na fronteira, camadas da Clean Architecture por dentro.

---

## Arquitetura em camadas e CQRS

**Q14.** Em um serviço clássico em camadas (controller → service → repositório Spring Data → banco de dados), para que lado aponta a dependência de código-fonte entre a lógica de negócio e a persistência, e o que muda na Clean/Hexagonal?

- A. A persistência depende da lógica de negócio nas duas
- B. Em camadas, o serviço depende da tecnologia de persistência; na Clean/Hexagonal, o serviço é dono de uma interface e o adaptador de persistência depende dela
- C. Não há dependência em nenhuma das duas
- D. Na Clean/Hexagonal, o serviço importa diretamente o adaptador JPA

??? success "Resposta"
    **B — A seta se inverte na fronteira de persistência.**

    Em tempo de execução, as chamadas continuam indo de service → banco de dados nas duas. O que muda é a dependência em tempo de compilação: com a Inversão de Dependência, o `AccountService` depende da sua própria interface `AccountRepository`, e o `AccountJpaAdapter` a implementa. Agora a persistência depende do código de negócio, e não o contrário.

---

**Q15.** Um time aplica CQRS ao catálogo de produtos: as escritas vão para o Postgres, e as leituras vêm de um modelo de leitura desnormalizado, atualizado por eventos. Logo depois de editar um produto, um usuário vê o nome antigo na lista. Por quê, e isso é um bug?

- A. Um bug no Postgres — as escritas deveriam ficar visíveis imediatamente em todo lugar
- B. Comportamento esperado: o modelo de leitura é **eventualmente consistente** e fica atrás do lado de escrita até a projeção ser atualizada; a UI precisa tolerar isso
- C. O CQRS exige Event Sourcing, que não foi usado
- D. O modelo de leitura deveria ser atualizado na mesma transação de banco de dados que a escrita

??? success "Resposta"
    **B — Consistência eventual do modelo de leitura.**

    Separar o lado de leitura traz escalabilidade independente e armazenamento otimizado para consultas, ao preço de um atraso entre um comando e a sua visibilidade nas consultas. O CQRS não exige Event Sourcing (C está errada); atualizar os dois em uma única transação (D) eliminaria justamente a separação que motivou o CQRS. Mitigações típicas: mostrar ao usuário os dados que ele acabou de gravar a partir da resposta do comando, ou consultar periodicamente até a projeção ser atualizada.
