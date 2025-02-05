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

<!-- ??? note "Account"


    ``` tree
    account
        src
            main
                java
                    store
                        account
                            AccountController.java
                            AccountIn.java
                            AccountOut.java
        pom.xml
    ```

    === "pom"

        ``` { .yaml title='pom.xml' .copy .select linenums="1" }
        --8<-- "https://raw.githubusercontent.com/hsandmann/spring/refs/heads/main/api/account/pom.xml"
        ```

    === "AccountController"

        ``` { .java title='AccountController.java' .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/hsandmann/spring/refs/heads/main/api/account/src/main/java/store/account/AccountController.java"
        ```

    === "AccountIn"

        ``` { .java title='AccountIn.java' .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/hsandmann/spring/refs/heads/main/api/account/src/main/java/store/account/AccountIn.java"
        ```

    === "AccountOut"

        ``` { .java title='AccountOut.java' .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/hsandmann/spring/refs/heads/main/api/account/src/main/java/store/account/AccountOut.java"
        ```

    <!-- termynal -->

    ``` { bash }
    > mvn clean install
    ```


??? note "Account-Service"

    ``` tree
    account-service
        src
            main
                java
                    store
                        account
                            AccountApplication.java
                            AccountResource.java
                            AccountService.java
                            AccountRepository.java
                            Account.java
                            AccountModel.java
                            AccountParser.java
                resources
                    application.yaml
        pom.xml
        Dockerfile
    ```

    === "pom"

        ``` { .yaml title='pom.xml' .copy .select linenums="1" }
        --8<-- "https://raw.githubusercontent.com/hsandmann/spring/refs/heads/main/api/account-service/pom.xml"
        ```

    === "application"

        ``` { .yaml title='application.yaml' .copy .select linenums="1" }
        --8<-- "https://raw.githubusercontent.com/hsandmann/spring/refs/heads/main/api/account-service/src/main/resources/application.yaml"
        ```

    === "AccountApplication"

        ``` { .java title='AccountApplication.java' .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/hsandmann/spring/refs/heads/main/api/account-service/src/main/java/store/account/AccountApplication.java"
        ```

    === "AccountResource"

        ``` { .java title='AccountResource.java' .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/hsandmann/spring/refs/heads/main/api/account-service/src/main/java/store/account/AccountResource.java"
        ```


    <!-- termynal -->

    ``` { bash }
    > mvn clean package spring-boot:run
    ```

## API

!!swagger-http http://127.0.0.1:8080/account/api-docs!! -->



<!-- ![type:video](https://odysee.com/$/embed/@RobBraxmanTech:6/fingerprint-vs-vpn) -->

