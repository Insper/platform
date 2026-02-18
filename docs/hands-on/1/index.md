## Account Microservice

The Account microservice is responsible for managing user accounts, basically, almost every application has a user account system. This microservice provides the necessary endpoints to create, read, update, and delete accounts. The microservice is built using Spring Boot and follows the Domain-Driven Design (DDD) approach.

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

Previously to build the Account microservice, it is necessary to prepare the environment by installing the database to persist the data. For that, we will use a Docker Compose file to create a PostgreSQL container, as well as, a cluster to isolate the microservices from external access, creating a secure environment - trusted layer. A Docker Compose file is a YAML file that defines how Docker containers should behave in production. The file contains the configuration for the database, the microservices, and the network configuration.

``` mermaid
flowchart LR
    subgraph api [Trusted Layer]
        direction TB
        account e3@==> db@{ shape: cyl, label: "Database" }
    end
    internet e1@==>|request| account:::red
    e1@{ animate: true }
    e3@{ animate: true }
    classDef red fill:#fcc
```

## Docker Compose

``` tree
api/
    account/
    account-service/
    .env
    compose.yaml
```

=== "compose.yaml"
    ``` { .yaml .copy .select linenums="1" }
    --8<-- "https://raw.githubusercontent.com/repo-classes/pma.25.2/refs/heads/main/api/compose.yaml"
    ```

=== ".env"
    ``` { .sh .copy .select linenums="1" }
    --8<-- "https://raw.githubusercontent.com/repo-classes/pma.25.2/refs/heads/main/api/.env"
    ```

<!-- termynal -->

``` { bash }
> docker compose up -d --build

[+] Running 2/2
 ✔ Network store_default  Created            0.1s 
 ✔ Container store-db-1   Started            0.2s 
```


## Account


``` tree
api/
    account/
        src/
            main/
                java/
                    store/
                        account/
                            AccountController.java
                            AccountIn.java
                            AccountOut.java
        pom.xml
```

??? info "Source"

    === "pom.xml"

        ``` { .yaml .copy .select linenums="1" }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.account/refs/heads/main/pom.xml"
        ```

    === "AccountController"

        ``` { .java title='AccountController.java' .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.account/refs/heads/main/src/main/java/store/account/AccountController.java"
        ```

    === "AccountIn"

        ``` { .java title='AccountIn.java' .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.account/refs/heads/main/src/main/java/store/account/AccountIn.java"
        ```

    === "AccountOut"

        ``` { .java title='AccountOut.java' .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.account/refs/heads/main/src/main/java/store/account/AccountOut.java"
        ```


    <!-- termynal -->

    ``` { bash }
    > mvn clean install
    ```

## Account-Service

``` tree
api/
    account-service/
        src/
            main/
                java/
                    store/
                        account/
                            Account.java
                            AccountApplication.java
                            AccountModel.java
                            AccountParser.java
                            AccountRepository.java
                            AccountResource.java
                            AccountService.java
                resources/
                    application.yaml
                    db/
                        migration/
                            V2025.08.29.001__create_schema.sql
                            V2025.08.29.002__create_table_account.sql
                            V2025.09.02.001__create_index_email.sql
        pom.xml
        Dockerfile
```

??? info "Source"

    === "pom.xml"

        ``` { .yaml .copy .select linenums="1" }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.account-service/refs/heads/main/pom.xml"
        ```

    === "Dockerfile"

        ``` { .dockerfile .copy .select linenums="1" }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.account-service/refs/heads/main/Dockerfile"
        ```

    === "application.yaml"

        ``` { .yaml .copy .select linenums="1" }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.account-service/refs/heads/main/src/main/resources/application.yaml"
        ```

    === "Account.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.account-service/refs/heads/main/src/main/java/store/account/Account.java"
        ```

    === "AccountApplication.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.account-service/refs/heads/main/src/main/java/store/account/AccountApplication.java"
        ```

    === "AccountModel.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.account-service/refs/heads/main/src/main/java/store/account/AccountModel.java"
        ```

    === "AccountParser.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.account-service/refs/heads/main/src/main/java/store/account/AccountParser.java"
        ```

    === "AccountRepository.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.account-service/refs/heads/main/src/main/java/store/account/AccountRepository.java"
        ```

    === "AccountResource.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.account-service/refs/heads/main/src/main/java/store/account/AccountResource.java"
        ```

    === "AccountService.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.account-service/refs/heads/main/src/main/java/store/account/AccountService.java"
        ```

    === "V2025.08.29.001__create_schema.sql"

        ``` { .sql .copy .select linenums="1" }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.account-service/refs/heads/main/src/main/resources/db/migration/V2025.08.29.001__create_schema.sql"
        ```

    === "V2025.08.29.002__create_table_account.sql"

        ``` { .sql .copy .select linenums="1" }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.account-service/refs/heads/main/src/main/resources/db/migration/V2025.08.29.002__create_table_account.sql"
        ```

    === "V2025.09.02.001__create_index_email.sql"

        ``` { .sql .copy .select linenums="1" }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma252.account-service/refs/heads/main/src/main/resources/db/migration/V2025.09.02.001__create_index_email.sql"
        ```


<!-- termynal -->

``` { bash }
> mvn clean package spring-boot:run
```
<!--
## API

!!swagger-http http://127.0.0.1:8080/account/api-docs!! -->



<!-- ![type:video](https://odysee.com/$/embed/@RobBraxmanTech:6/fingerprint-vs-vpn) -->

[^1]: [Criando Migrations com Flyway no seu projeto Java Spring & PostgreSQL](https://www.youtube.com/watch?v=LX5jaieOIAk){target="_blank"}
