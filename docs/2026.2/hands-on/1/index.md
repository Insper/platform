!!! tip "Main Goal"

    The main goal of this section is to implement a simple [CRUD (Create, Read, Update, Delete)](https://grokipedia.com/page/Create_read_update_and_delete){target="_blank"} microservice for illustration purposes.

The Account microservice is responsible for managing user accounts, basically, almost every application has a user account system. This microservice provides the endpoints to create, read (list all, or find one by id), and delete accounts; an update endpoint is not part of it. The microservice is built using Spring Boot and follows the [Domain-Driven Design (DDD)](https://martinfowler.com/bliki/DomainDrivenDesign.html){target="_blank"} approach.

## Slides

<div class="slides-embed">
  <iframe src="slides/crud.html" title="Slides: hands-on 1 — crud" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/crud.html){:target="_blank"}

The microservice is divided into two main modules: `account` and `account-service`:

- the `account` module contains the API definition and the data transfer objects (DTOs) for the Account microservice;
- the `account-service` module contains the service implementation, repository, and entity classes.

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

!!! example "Java Advantages"

    This approach allows the separation of concerns and the organization of the codebase into different modules, making it easier to maintain and scale the application. Also, it creates a facility to reuse the microservice by other microservices in the future - builts in Java.

The construction of the Account microservice follows the Clean Architecture approach, which promotes the total decoupling of business rules from interface layers. The diagram below illustrates the flow of data among the layers of the Account microservice:

``` mermaid-sim
sequenceDiagram
    title Clean architecture's approach 
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



To develop of the Account microservice, the steps are as follows:

<div class="grid cards" markdown>

-   :material-code-braces:{ .lg .middle } **[Controller](./controller/)**

    ---

    Create the interface for the Account microservice in the `account` module, defining the API endpoints and the data transfer objects (DTOs);

    [Controller](./controller/){ .md-button }

-   :material-cog:{ .lg .middle } **[Service](./service/)**

    ---

    Implement the service layer in the `account-service` module, creating the necessary classes to handle the business logic and the data persistence;

    [Service](./service/){ .md-button }

-   :fontawesome-brands-docker:{ .lg .middle } **[Containerization](./containerization/)**

    ---

    Create the Dockerfile for the Account microservice, and build the Docker image for the microservice;

    [Containerization](./containerization/){ .md-button }

-   :material-database:{ .lg .middle } **[Repository](./repository/)**

    ---

    Implement the persistence layer for `account-service` module, creating the necessary classes to handle the data persistence;

    [Repository](./repository/){ .md-button }

</div>
