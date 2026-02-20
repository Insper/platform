# Account Microservice

The Account microservice is responsible for managing user accounts, basically, almost every application has a user account system. This microservice provides the necessary endpoints to create, read, update, and delete accounts. The microservice is built using Spring Boot and follows the [Domain-Driven Design (DDD)](https://martinfowler.com/bliki/DomainDrivenDesign.html){target="_blank"} approach.

The microservice is divided into two main modules: `account` and `account-service`:

- the `account` module contains the API definition and the data transfer objects (DTOs) for the Account microservice;
- the `account-service` module contains the service implementation, repository, and entity classes.

``` mermaid
classDiagram
    namespace account {
        class AccountController {
            +create(AccountIn accountIn): AccountOut
            +delete(String id): void
            +findAll(): List<AccountOut>
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
            +create(AccountIn accountIn): AccountOut
            +delete(String id): void
            +findAll(): List<AccountOut>
            +findById(String id): AccountOut
        }
        class AccountService {
            +create(AccountIn accountIn): AccountOut
            +delete(String id): void
            +findAll(): List<AccountOut>
            +findById(String id): AccountOut
        }
        class AccountRepository {
            +create(AccountIn accountIn): AccountOut
            +delete(String id): void
            +findAll(): List<AccountOut>
            +findById(String id): AccountOut
        }
        class Account {
            -String id
            -String name
            -String email
            -String password
            -String sha256
        }
        class AccountModel {
            +create(AccountIn accountIn): AccountOut
            +delete(String id): void
            +findAll(): List<AccountOut>
            +findById(String id): AccountOut
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

This approach allows the separation of concerns and the organization of the codebase into different modules, making it easier to maintain and scale the application. Also, it creates a facility to reuse the microservice by other microservices in the future - builts in Java.

The construction of the Account microservice follows the Clean Architecture approach, which promotes the total decoupling of business rules from interface layers. The diagram below illustrates the flow of data among the layers of the Account microservice:

``` mermaid
sequenceDiagram
    title Clean architecture's approach 
    Actor Request
    Request ->>+ Controller: 
    Controller ->>+ Service: parser (AccountIn -> Account)
    Service ->>+ Repository: parser (Account -> AccountModel)
    Repository ->>+ Database: 
    Database ->>- Repository: 
    Repository ->>- Service: parser (Account <- AccountModel)
    Service ->>- Controller: parser (AccountOut <- Account)
    Controller ->>- Request: 
```



To start the development of the Account microservice, the steps are as follows:

1. Create the interface for the Account microservice in the `account` module, defining the API endpoints and the data transfer objects (DTOs);

    [Interface](./interface/)

2. Implement the service layer in the `account-service` module, creating the necessary classes to handle the business logic and the data persistence;

    [Implementation](./implementation/)

