Object-Relational Mapping (ORM) is a programming technique that allows developers to interact with a relational database using an object-oriented programming language. It provides a way to map database tables to classes and database records to objects, allowing developers to work with data in a more intuitive and natural way. In the context of the Account microservice, we will use an ORM framework to handle the data persistence for the Account entity, which will allow us to easily create, read, update, and delete accounts in the database.



Flyway is a database migration tool that allows us to manage and version our database schema changes. It provides a way to define and execute database migrations, which are scripts that modify the database schema, such as creating tables, adding columns, or changing data types. In the context of the Account microservice, we will use Flyway to manage our database migrations, ensuring that our database schema is always up-to-date and consistent across different environments.


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
        pom.xml
```

| Class | Description |
| --- | --- |
| `Account` | This class represents the Account entity, which is the main entity of the Account microservice. It contains the attributes of the Account entity, such as `id`, `name`, `email`, `password`, and `sha256`. |
| `AccountModel` | This class represents the Account model, which is responsible for the persistence logic of the Account microservice. It contains the methods for creating, deleting, finding, and updating accounts. |
| `AccountParser` | This class is responsible for parsing the input and output of the API endpoints, converting the `AccountIn` and `AccountOut` DTOs to the `Account` entity, and vice versa. |
| `AccountRepository` | This interface is responsible for the data persistence of the Account entity, using an Object-Relational Mapping (ORM) framework to interact with the database. |
| `AccountResource` | This class is responsible for the API endpoints of the Account microservice, implementing the `AccountController` interface defined in the `account` module, and using the `AccountService` to handle the business logic of the API endpoints. |
| `AccountService` | This class is responsible for the business logic of the Account microservice, using the `AccountRepository` to handle the data persistence of the Account entity, and the `AccountParser` to handle the parsing of the input and output of the API endpoints. |


!!! example "Source"

    === "pom.xml"

        ``` { .yaml .copy .select linenums="1" }
        --8<-- "docs/hands-on/1/service/code/pom.xml"
        ```

    === "Dockerfile"

        ``` { .dockerfile .copy .select linenums="1" }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma261.account-service/refs/heads/main/Dockerfile"
        ```

    === "application.yaml"

        ``` { .yaml .copy .select linenums="1" }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma261.account-service/refs/heads/main/src/main/resources/application.yaml"
        ```

    === "Account.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma261.account-service/refs/heads/main/src/main/java/store/account/Account.java"
        ```

    === "AccountApplication.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma261.account-service/refs/heads/main/src/main/java/store/account/AccountApplication.java"
        ```

    === "AccountModel.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma261.account-service/refs/heads/main/src/main/java/store/account/AccountModel.java"
        ```

    === "AccountParser.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma261.account-service/refs/heads/main/src/main/java/store/account/AccountParser.java"
        ```

    === "AccountRepository.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma261.account-service/refs/heads/main/src/main/java/store/account/AccountRepository.java"
        ```

    === "AccountResource.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma261.account-service/refs/heads/main/src/main/java/store/account/AccountResource.java"
        ```

    === "AccountService.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma261.account-service/refs/heads/main/src/main/java/store/account/AccountService.java"
        ```

    === "V2025.08.29.001__create_schema.sql"

        ``` { .sql .copy .select linenums="1" }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma261.account-service/refs/heads/main/src/main/resources/db/migration/V2025.08.29.001__create_schema.sql"
        ```

    === "V2025.08.29.002__create_table_account.sql"

        ``` { .sql .copy .select linenums="1" }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma261.account-service/refs/heads/main/src/main/resources/db/migration/V2025.08.29.002__create_table_account.sql"
        ```

    === "V2025.09.02.001__create_index_email.sql"

        ``` { .sql .copy .select linenums="1" }
        --8<-- "https://raw.githubusercontent.com/repo-classes/pma261.account-service/refs/heads/main/src/main/resources/db/migration/V2025.09.02.001__create_index_email.sql"
        ```


[^1]: [Criando Migrations com Flyway no seu projeto Java Spring & PostgreSQL](https://www.youtube.com/watch?v=LX5jaieOIAk){target="_blank"}
