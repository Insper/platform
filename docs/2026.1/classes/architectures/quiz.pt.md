
Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Clean Architecture

**Q1.** A **Regra de Dependência** da Clean Architecture diz que as dependências de código-fonte devem sempre apontar em qual direção?

- A. Para fora — as camadas internas dependem das externas para usar utilitários do framework
- B. Nas duas direções — camadas internas e externas podem importar umas às outras livremente
- C. Para dentro — as camadas externas dependem das internas, e as camadas internas nunca referenciam nada de uma camada externa
- D. Para baixo — as camadas de nível mais alto dependem da infraestrutura de nível mais baixo

??? success "Resposta"
    **C — Sempre para dentro.**

    A camada de Entities não sabe nada sobre os Use Cases; os Use Cases não sabem nada sobre controllers ou bancos de dados. Isso significa que trocar o framework web, mudar o ORM ou adicionar um novo mecanismo de entrega (REST → gRPC) exige mexer apenas nas camadas mais externas — as regras de negócio permanecem intocadas.

---

**Q2.** Qual camada contém as **regras de negócio específicas da aplicação**, que orquestram as Entities para realizar um caso de uso?

- A. Camada de Entities (Domínio) — ela contém toda a lógica de negócio
- B. Camada de Interface Adapters — ela processa as requisições recebidas
- C. Camada de Use Cases (Aplicação) — ela define o que a aplicação faz e orquestra os objetos de domínio
- D. Camada de Frameworks & Drivers — ela coordena o framework web e o banco de dados

??? success "Resposta"
    **C — Camada de Use Cases (Aplicação).**

    A camada de Entities guarda as regras *corporativas* (um Money válido, as invariantes de um Order). A camada de Use Cases guarda as regras *específicas da aplicação*: "para fazer um pedido, valide o carrinho, reserve o estoque, cobre o cliente". Os casos de uso dependem das interfaces das entidades, nunca de frameworks.

---

**Q3.** Em quais camadas a anotação `@Entity` do Spring **não** deve aparecer?

- A. Camada de Interface Adapters — ela faz a ponte entre o framework e o caso de uso
- B. Camada de Frameworks & Drivers — todo detalhe de infraestrutura fica aqui
- C. Camada de Entities (Domínio) e camada de Use Cases (Aplicação) — elas devem ser livres de framework
- D. Ela pode aparecer em qualquer lugar, desde que a lógica de negócio esteja no service

??? success "Resposta"
    **C — As camadas de Domínio e de Use Cases devem ser livres de framework.**

    `@Entity` é uma anotação JPA — uma preocupação de Frameworks & Drivers. Se ela aparece em uma classe de domínio ou em um caso de uso, essa camada passa a depender do framework de persistência, violando a Regra de Dependência. Os objetos de domínio devem ser classes Java simples, sem imports de framework. O `@Entity` pertence a uma classe separada de modelo de persistência, na camada de Adapters.

---

**Q4.** Qual é o papel do **Parser** na Clean Architecture com Spring Boot usada na disciplina?

- A. Ele valida o JSON recebido contra um schema antes de repassá-lo ao controller
- B. Ele traduz entre os tipos HTTP `RecordIn`/`RecordOut` e os DTOs dos Use Cases, mantendo os dois lados da fronteira limpos
- C. Ele converte os resultados de consultas ao banco de dados em respostas HTTP
- D. Ele criptografa campos sensíveis antes que eles saiam do serviço

??? success "Resposta"
    **B — Traduz entre os tipos da fronteira dos adapters e os tipos dos casos de uso.**

    O Parser fica na fronteira entre a camada de Interface Adapters e a camada de Use Cases. Ele converte `AccountIn` (contrato HTTP) em `Account` (objeto de domínio) na entrada, e `Account` de volta em `AccountOut` na saída. Nem o controller nem o service precisam conhecer a representação do outro.

---

**Q5.** Uma classe `Service` chama `accountRepository.findById()`, em que `accountRepository` é um **`JpaRepository` do Spring Data** — e não uma interface definida pelo domínio. Qual erro de Clean Architecture isso ilustra?

- A. Modelo de domínio anêmico — toda a lógica está na camada de serviço
- B. Controller inchado — o service está fazendo trabalho demais
- C. Vazamento de tipos de framework para dentro — o Use Case agora depende de um tipo de Frameworks & Drivers
- D. Persistência substituível — o service está usando corretamente uma abstração

??? success "Resposta"
    **C — Vazamento de tipos de framework para dentro.**

    `JpaRepository` é um tipo do Spring Data, de Frameworks & Drivers. Se o `Service` (camada de Use Cases) o importa diretamente, a camada de Use Cases passa a depender da camada mais externa — uma violação direta da Regra de Dependência. A abordagem correta: declarar uma interface `AccountRepository` na camada de domínio e deixar o adapter JPA implementá-la.

---

## Arquitetura Hexagonal

**Q6.** Na Arquitetura Hexagonal, quem **define** a interface do port secundário (driven)?

- A. A tecnologia externa que o implementa (por exemplo, o provedor JPA)
- B. O adapter que faz a ponte entre a tecnologia e a aplicação
- C. O núcleo da aplicação — os dois tipos de port pertencem ao núcleo e são definidos por ele, não pela tecnologia externa
- D. O contêiner de injeção de dependência do framework, em tempo de execução

??? success "Resposta"
    **C — O núcleo da aplicação é dono de todas as definições de ports.**

    Essa é a inversão de controle fundamental. A interface `AccountRepository` é declarada dentro do núcleo da aplicação, em termos de domínio (`findByEmail`, `save`). O adapter JPA implementa essa interface e fica na camada externa. O núcleo nunca importa o adapter.

---

**Q7.** O que diferencia um **adapter driving (primário)** de um **adapter driven (secundário)**?

- A. Adapters driving ficam dentro do hexágono; adapters driven ficam fora dele
- B. Um adapter driving inicia a interação com o núcleo (por exemplo, um controller REST chama o port primário); um adapter driven implementa o que o núcleo precisa do mundo externo (por exemplo, o adapter JPA implementa o port de repositório)
- C. Adapters driven são testados automaticamente; adapters driving exigem testes manuais
- D. Adapters driving tratam escritas; adapters driven tratam leituras

??? success "Resposta"
    **B — O driving inicia; o driven implementa.**

    Um adapter driving é algo que *chama* a aplicação: controller REST, CLI, consumidor de mensagens, teste. Um adapter driven é algo que a aplicação *chama*: banco de dados, serviço de e-mail, API externa. Os dois ficam fora do hexágono e se conectam por meio de seus respectivos ports.

---

**Q8.** Qual é o principal **benefício para os testes** da Arquitetura Hexagonal?

- A. Todos os adapters podem ser testados sem um núcleo da aplicação em execução
- B. O framework cuida de toda a preparação dos testes por meio de anotações como `@SpringBootTest`
- C. O núcleo da aplicação pode ser totalmente testado com testes unitários simples, substituindo os adapters driven por stubs em memória — sem contexto Spring, sem banco de dados, sem servidor em execução
- D. Os testes de integração rodam 10× mais rápido porque o hexágono compila para bytecode de forma mais eficiente

??? success "Resposta"
    **C — Núcleo testável com testes unitários simples e stubs em memória.**

    `AuthServiceImpl` recebe uma interface `AccountRepository`. No teste, substitua-a por `InMemoryAccountRepository` (um `HashMap`). O teste roda em milissegundos, sem infraestrutura. Essa é a propriedade arquitetural que torna o TDD viável na prática — a regra de negócio é testada diretamente, e não através do HTTP e de um banco de dados real.

---

**Q9.** Uma equipe define `AccountRepository` com métodos que espelham o `JpaRepository` do Spring Data. O que há de errado nisso?

- A. Nada — espelhar os métodos JPA é a forma correta de definir um port secundário
- B. O adapter (JPA) está moldando o port, em vez de o núcleo defini-lo em termos de domínio — a interface deve expressar a intenção do domínio, não a mecânica de persistência
- C. A interface tem métodos de menos — os ports devem expor todas as operações possíveis de banco de dados
- D. O port deveria estender `JpaRepository` diretamente para evitar duplicação

??? success "Resposta"
    **B — O adapter está moldando o port.**

    Se `AccountRepository` tem `findAll()`, `saveAll()`, `deleteById(Long id)` — esses são conceitos de JPA. Um port orientado pelo domínio expressaria conceitos do domínio: `findByEmail(String email)`, `save(Account account)`. Quando o port espelha o adapter, você acabou fazendo, sem querer, o domínio depender do vocabulário da infraestrutura, e não o contrário.

---

**Q10.** Como a **Clean Architecture** e a **Arquitetura Hexagonal** se relacionam?

- A. São abordagens concorrentes — um sistema precisa escolher uma ou outra
- B. A Arquitetura Hexagonal é um subconjunto mais simples; a Clean Architecture é sempre preferida em produção
- C. São complementares — a Hexagonal define *como* funciona a fronteira da aplicação (ports & adapters); a Clean Architecture define o *que* fica dentro dessas fronteiras (camadas com políticas de dependência explícitas)
- D. A Clean Architecture é o modelo mais antigo; a Arquitetura Hexagonal a substituiu completamente

??? success "Resposta"
    **C — Complementares, frequentemente usadas juntas.**

    A Arquitetura Hexagonal dá a você o *lado de fora* do hexágono — ports e adapters na fronteira. A Clean Architecture dá a você o *lado de dentro* — camadas explícitas (Entities, Use Cases) com uma Regra de Dependência. A maioria dos microsserviços modernos em Spring Boot combina as duas: hexagonal na fronteira, camadas da Clean Architecture internamente.
