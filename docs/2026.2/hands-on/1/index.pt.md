!!! tip "Objetivo principal"

    O objetivo principal desta seção é implementar um microsserviço [CRUD (Create, Read, Update, Delete)](https://grokipedia.com/page/Create_read_update_and_delete){target="_blank"} simples, para fins de ilustração.

O microsserviço Account é responsável por gerenciar as contas de usuário — praticamente toda aplicação tem um sistema de contas de usuário. Esse microsserviço fornece os endpoints para criar, ler (listar todas ou buscar uma pelo id) e excluir contas; um endpoint de atualização não faz parte dele. Ele é construído com Spring Boot e segue a abordagem [Domain-Driven Design (DDD)](https://martinfowler.com/bliki/DomainDrivenDesign.html){target="_blank"}.

## Slides

<div class="slides-embed">
  <iframe src="slides/crud.pt.html" title="Slides: hands-on 1 — CRUD" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/crud.pt.html){:target="_blank"}

O microsserviço é dividido em dois módulos principais: `account` e `account-service`:

- o módulo `account` contém a definição da API e os objetos de transferência de dados (DTOs) do microsserviço Account;
- o módulo `account-service` contém a implementação do serviço, o repositório e as classes de entidade.

``` mermaid-sim
classDiagram
    namespace account {
        class AccountController {
            +create(AccountIn in): Void
            +findAll(): List<AccountOut>
            +delete(String id): Void
            +healthCheck(): Void
            +findById(String id): AccountOut
        }
        class AccountIn {
            -String name
            -String email
            -String password
        }
        class AccountOut {
            -String id
            -String name
            -String email
        }
    }
    namespace account-service {
        class AccountResource {
            +create(AccountIn in): Void
            +findAll(): List<AccountOut>
            +delete(String id): Void
            +healthCheck(): Void
            +findById(String id): AccountOut
        }
        class AccountService {
            +create(Account account): Account
            +findById(String id): Account
            +delete(String id): void
            +findAll(): List<Account>
        }
        class AccountRepository {
            +save(AccountModel model): AccountModel
            +findById(String id): Optional<AccountModel>
            +deleteById(String id): void
            +findAll(): List<AccountModel>
        }
        class Account {
            -String id
            -String name
            -String email
            -String password
            -String hashPassword
        }
        class AccountModel {
            -String id
            -String name
            -String email
            -String hashPassword
            +to(): Account
        }
    }
    <<Interface>> AccountController
    AccountController ..> AccountIn
    AccountController ..> AccountOut

    <<Interface>> AccountRepository
    AccountController <|-- AccountResource
    AccountResource *-- AccountService
    AccountService *-- AccountRepository
    AccountService ..> Account
    AccountService ..> AccountModel
    AccountRepository ..> AccountModel
```

!!! example "Vantagens do Java"

    Essa abordagem permite a separação de responsabilidades e a organização do código em módulos diferentes, o que facilita a manutenção e a escalabilidade da aplicação. Além disso, facilita a reutilização do microsserviço por outros microsserviços no futuro — desde que construídos em Java.

A construção do microsserviço Account segue a abordagem da Clean Architecture (arquitetura limpa), que promove o desacoplamento total das regras de negócio em relação às camadas de interface. O diagrama abaixo ilustra o fluxo de dados entre as camadas do microsserviço Account:

``` mermaid-sim
sequenceDiagram
    title Abordagem da arquitetura limpa 
    Actor Request
    participant Controller@{ "type": "boundary", "alias": "Controller<br>Resource" }
    participant Service@{ "type": "control" }
    participant Repository@{ "type" : "entity" }
    participant Database@{ "type" : "database" }
    Request ->>+ Controller: Rest API (JSON)
    Controller ->>+ Service: parser (AccountIn -> Account)
    Service ->>+ Repository: parser (Account -> AccountModel)
    Repository ->>+ Database: 
    Database ->>- Repository: 
    Repository ->>- Service: parser (Account <- AccountModel)
    Service ->>- Controller: parser (AccountOut <- Account)
    Controller ->>- Request: Rest API (JSON)
```



Para desenvolver o microsserviço Account, os passos são os seguintes:

<div class="grid cards" markdown>

-   :material-code-braces:{ .lg .middle } **[Controller](./controller/)**

    ---

    Crie a interface do microsserviço Account no módulo `account`, definindo os endpoints da API e os objetos de transferência de dados (DTOs);

    [Controller](./controller/){ .md-button }

-   :material-cog:{ .lg .middle } **[Serviço](./service/)**

    ---

    Implemente a camada de serviço no módulo `account-service`, criando as classes necessárias para tratar a lógica de negócio e a persistência dos dados;

    [Serviço](./service/){ .md-button }

-   :fontawesome-brands-docker:{ .lg .middle } **[Containerização](./containerization/)**

    ---

    Crie o Dockerfile do microsserviço Account e gere a imagem Docker do microsserviço;

    [Containerização](./containerization/){ .md-button }

-   :material-database:{ .lg .middle } **[Repositório](./repository/)**

    ---

    Implemente a camada de persistência do módulo `account-service`, criando as classes necessárias para tratar a persistência dos dados;

    [Repositório](./repository/){ .md-button }

</div>
