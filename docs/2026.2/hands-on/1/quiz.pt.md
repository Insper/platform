Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Microsserviço CRUD

**Q1.** Qual **módulo** Maven contém a interface da API (definição do controller e DTOs) — e não a implementação?

- A. `account-service` — ele contém todo o código do microsserviço
- B. `account` — ele define a interface e os DTOs, dos quais outros serviços podem depender sem depender da implementação
- C. `gateway-service` — o gateway é dono de todos os contratos de API
- D. Não há separação; interface e implementação ficam no mesmo módulo

??? success "Resposta"
    **B — módulo `account`.**

    O módulo `account` define a interface `AccountController` e os DTOs `AccountIn`/`AccountOut` (records). Outros serviços (p. ex., o serviço de autenticação que chama o serviço de contas) dependem apenas desse módulo de interface — nunca do `account-service`, que contém a implementação Spring Boot, as entidades JPA e a lógica de negócio.

---

**Q2.** Segundo a Clean Architecture, qual camada deve conter a anotação `@Entity` do Spring?

- A. Camada de domínio (Entities) — as entidades representam o modelo de negócio central, então a anotação pertence a ela
- B. Camada de casos de uso (Application) — o serviço precisa persistir dados
- C. Camada Frameworks & Drivers / Interface Adapters — anotações de ORM são detalhe de infraestrutura e não devem vazar para as camadas de domínio ou de casos de uso
- D. Qualquer camada — as anotações do Spring são neutras em relação ao framework

??? success "Resposta"
    **C — Camada Frameworks & Drivers / Interface Adapters.**

    `@Entity` é uma anotação JPA — pertence à infraestrutura de persistência, não ao domínio. O objeto de domínio `Account` é uma classe Java simples. Uma classe separada, `AccountModel` (ou `AccountTable`), na camada de adaptadores, carrega a anotação `@Entity`. Um `Mapper` converte entre as duas na fronteira de persistência.

---

**Q3.** Qual código de status HTTP um `POST` bem-sucedido que cria uma nova conta retorna, e qual cabeçalho deve acompanhá-lo?

- A. `200 OK` sem cabeçalhos adicionais
- B. `201 Created` com um cabeçalho `Location` apontando para a URI do novo recurso
- C. `204 No Content` — a criação deu certo e não há nada a retornar
- D. `202 Accepted` — a criação é enfileirada de forma assíncrona

??? success "Resposta"
    **B — `201 Created` com o cabeçalho `Location`.**

    `201` sinaliza que um novo recurso foi criado. O cabeçalho `Location: /accounts/42` diz ao cliente exatamente onde encontrar a nova conta. Isso permite que o cliente coloque o recurso em cache ou navegue até ele imediatamente, sem fazer uma requisição GET separada.

---

**Q4.** Qual é o papel do `AccountService` em relação ao `AccountRepository` nesta arquitetura?

- A. Eles são intercambiáveis — qualquer um pode ser usado para persistir dados
- B. `AccountService` trata o HTTP; `AccountRepository` trata a lógica de negócio
- C. `AccountService` implementa a lógica de negócio (validação, orquestração); `AccountRepository` é a abstração de persistência — uma interface Java que esconde os detalhes do banco de dados
- D. `AccountService` chama APIs externas; `AccountRepository` trata o estado interno

??? success "Resposta"
    **C — Service = lógica de negócio; Repository = abstração de persistência.**

    O `AccountService` decide *o que* fazer (validar a senha e o email, gerar o hash da senha). O `AccountRepository` sabe *como persistir*. O Service depende da *interface* do Repository — nunca da implementação JPA —, o que o torna testável com um repositório em memória.

---

**Q5.** No diagrama de sequência, o que o **Parser** faz entre as camadas Controller e Service?

- A. Valida os cabeçalhos da requisição HTTP antes de encaminhá-la ao serviço
- B. Criptografa os dados da conta antes de armazená-los
- C. Converte o DTO HTTP (`AccountIn`) no objeto de domínio `Account`, mantendo a fronteira entre as camadas de adaptadores e de casos de uso
- D. Registra a requisição recebida em log para fins de auditoria

??? success "Resposta"
    **C — Converte `AccountIn` → `Account` de domínio.**

    O Parser garante a fronteira entre camadas: o Controller conhece o `AccountIn` (contrato HTTP); o Service conhece o `Account` (objeto de domínio). O Parser é a única classe que conhece os dois, e ele vive na fronteira. Assim, mudar os nomes dos campos do JSON nunca exige mexer na lógica do serviço.

---

**Q6.** Por que o diagrama de sequência mostra uma segunda conversão (Mapper) entre as camadas Service e Repository?

- A. Porque o serviço sempre retorna dados no formato JSON
- B. Porque o objeto de domínio `Account` precisa ser convertido em um `AccountModel` (`@Entity`) para ser persistido — mantendo as anotações de ORM fora da camada de domínio
- C. Porque o Spring Data exige que todos os objetos implementem `Serializable`
- D. Não há segunda conversão — o serviço chama diretamente o repositório JPA

??? success "Resposta"
    **B — `Account` → `AccountModel` (`@Entity`) na fronteira de persistência.**

    A classe de domínio `Account` não tem anotações JPA. O adaptador de persistência a converte em `AccountModel` (que tem `@Entity`, `@Column` etc.) antes de persistir, e de volta em `Account` depois de ler. Isso mantém a camada de domínio livre de preocupações de infraestrutura — o padrão é chamado de *Repository Adapter* ou *Anti-Corruption Layer* (camada anticorrupção).

---

**Q7.** Qual é o propósito de o `account` ser um **módulo Maven separado** do `account-service`?

- A. Acelerar a compilação, paralelizando as tarefas de build
- B. Outros serviços podem declarar uma dependência da interface (`account`) sem trazer a aplicação Spring Boot completa (`account-service`) e as suas dependências transitivas
- C. O Maven exige que interfaces e implementações fiquem em módulos separados
- D. Permitir que a interface seja escrita em outra linguagem de programação

??? success "Resposta"
    **B — Módulo de interface sem dependências do Spring Boot.**

    O módulo `account` é uma biblioteca enxuta: apenas a interface `AccountController` e os records `AccountIn` e `AccountOut`. O serviço de autenticação declara `<dependency>account</dependency>` para usar o cliente Feign gerado a partir dessa interface. Ele NÃO traz o Spring Data JPA, o driver do PostgreSQL nem nenhuma das dependências pesadas da implementação.

---

**Q8.** Um desenvolvedor adiciona `@Column(name = "user_email")` diretamente na classe de domínio `Account`. Qual princípio da Clean Architecture isso viola?

- A. Princípio da Responsabilidade Única — a classe agora tem duas responsabilidades
- B. A Regra de Dependência — a camada de domínio passa a depender de uma anotação de Frameworks & Drivers (JPA), apontando para fora em vez de para dentro
- C. Princípio Aberto/Fechado — a classe deixa de estar aberta para extensão
- D. Isso é aceitável — anotações JPA são metadados transparentes

??? success "Resposta"
    **B — Violação da Regra de Dependência.**

    A camada de domínio não deve saber nada sobre frameworks de persistência. Adicionar `@Column` a `Account` faz a classe de domínio conhecer o JPA — a dependência passa a apontar para fora (domínio → framework). Se o JPA for substituído ou o mapeamento da coluna mudar, a classe de domínio também precisa mudar, acoplando a lógica de domínio a decisões de infraestrutura.

---

**Q9.** A interface `AccountController` é declarada no módulo `account`. A sua implementação, `AccountResource`, fica no `account-service`. Qual princípio de projeto isso exemplifica?

- A. Factory Method — `AccountController` cria instâncias de `AccountResource`
- B. Observer — `AccountController` observa mudanças em `AccountResource`
- C. Segregação de Interfaces combinada com Inversão de Dependência — quem chama depende da interface; a implementação fica em um módulo separado
- D. Singleton — existe apenas uma instância de `AccountController` por JVM

??? success "Resposta"
    **C — Segregação de Interfaces + Inversão de Dependência.**

    Quem chama depende da interface `AccountController` (a abstração), não de `AccountResource` (a implementação). O Princípio da Inversão de Dependência diz que módulos de alto nível devem depender de abstrações, não de implementações concretas. Separá-los em módulos Maven diferentes garante isso no nível do build.

---

**Q10.** Depois de adicionar a imagem Docker do `account-service` ao `compose.yaml`, quais variáveis de ambiente são usadas para configurar a conexão com o banco de dados em vez de valores fixos no código?

- A. `SPRING_DATASOURCE_URL` e `SPRING_DATASOURCE_PASSWORD` fixas no compose.yaml
- B. `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_DB`, `DATABASE_USERNAME`, `DATABASE_PASSWORD` passadas como variáveis de ambiente — resolvidas a partir do `.env` em tempo de execução
- C. A conexão com o banco de dados é detectada automaticamente a partir da rede dos containers
- D. Apenas `POSTGRES_URL` — o Spring Boot monta a URL JDBC completa automaticamente

??? success "Resposta"
    **B — `DATABASE_HOST`, `DATABASE_PORT` etc. a partir do `.env`.**

    O compose.yaml passa as partes da conexão como variáveis de ambiente: `DATABASE_HOST: db` e `DATABASE_PORT: 5432`, além do banco, do usuário e da senha vindos do `.env`. O `application.yaml` as lê como `${DATABASE_HOST}`, `${DATABASE_PORT}`, `${DATABASE_DB}`, … para montar a URL JDBC — sem valores padrão, então o serviço falha na inicialização se faltar alguma. O arquivo `.env` mantém as credenciais fora do `compose.yaml` e fora do repositório.

---
