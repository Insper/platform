Now, with the controller implemented, we can move on to the service layer of the Account microservice. The service layer is responsible for the business logic of the microservice, and it interacts with the repository layer to handle the data persistence of the Account entity. The service layer is implemented in the `AccountService` class, which contains the methods for creating, deleting, finding, and updating accounts. The `AccountService` class uses the `AccountRepository` to handle the data persistence of the Account entity, and the `AccountParser` to handle the parsing of the input and output of the API endpoints.

From previous hands-on, we have already see that this microservice uses clean architecture, which means that the service layer is independent of the controller layer and the repository layer. This allows us to easily test the business logic of the service layer without having to worry about the details of the controller layer or the repository layer. The following diagram illustrates the architecture of the Account microservice, showing the relationships between the different layers and classes:

``` mermaid
sequenceDiagram
    title Clean architecture's approach 
    Actor Request
    Request ->>+ Controller: JSON
    Controller ->>+ Service: parser (AccountIn -> Account)
    Service ->>+ Repository: parser (Account -> AccountModel)
    Repository ->>+ Database: 
    Database ->>- Repository: 
    Repository ->>- Service: parser (Account <- AccountModel)
    Service ->>- Controller: parser (AccountOut <- Account)
    Controller ->>- Request: JSON
```

The relationships between the different layers is done though the use of different DTOs (Data Transfer Objects). Then, to translate between the different layers, we use parsers, which are responsible for converting the DTOs to the entities and vice versa.

- The `AccountParser` class is responsible for this translation, and it contains the methods for converting the `AccountIn` DTO to the `Account` entity, and the `Account` entity to the `AccountOut` DTO.

- Also `AccountModel` is the class that represents the database model of the Account entity, which is used by the `AccountRepository` to handle the data persistence of the Account entity. The `AccountModel` class contains the attributes of the Account entity and it is annotated with JPA annotations to define the mapping between the class and the database table.


## 1. The Object-Relational Mapping (ORM)

This project uses a Relational Database (PostgreSQL) to store the data of the Account entity. But, the Java programming language is an object-oriented programming language, which means that we need a way to map the relational data to the object-oriented data

**Object-Relational Mapping (ORM)** is a programming technique that allows developers to interact with a relational database using an object-oriented programming language. It provides a way to map database tables to classes and database records to objects, allowing developers to work with data in a more intuitive and natural way. In the context of the Account microservice, we will use an ORM framework, [JPA](https://jakarta.ee/specifications/persistence/){:target="_blank"}, to handle the data persistence for the Account entity, which will allow us to easily create, read, update, and delete accounts in the database.

Here, we can see the code that solves the data persistence concerns of the Account microservice, including the `AccountModel` class, which represents the database model of the Account entity, and the `AccountRepository` interface, which is responsible for the data persistence of the Account entity using JPA.


## 2. Database Migrations

Once we have the ORM set up, we need to manage our database schema changes. As our application evolves, we may need to add new tables, modify existing tables, or change the data types of columns. To manage these changes, we will use a database migration tool called [Flyway](https://flywaydb.org/){:target="_blank"}[^1].

Flyway is a database migration tool that allows us to manage and version our database schema changes. It provides a way to define and execute database migrations, which are scripts that modify the database schema, such as creating tables, adding columns, or changing data types. In the context of the Account microservice, we will use Flyway to manage our database migrations, ensuring that our database schema is always up-to-date and consistent across different environments.

In the code, we have a `db/migration` directory, which contains the migration scripts for the Account microservice. Each migration script is named in a specific format, starting with a version number (e.g., `V2026.02.27.001`) followed by a description of the migration (e.g., `create_schema`). These migration scripts will be executed in order by Flyway to ensure that our database schema is always up-to-date.

## 3. Code

Let's go code the implementation of the Account microservice, which consists of a lot of classes. The resulting directory structure will look like this:

``` tree
api/
    account/
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
                    db/
                        migration/
                            V2026.02.27.001__create_schema.sql
                            V2026.02.27.002__create_table_account.sql
                            V2026.02.27.003__create_index_email.sql
                    application.yaml
        pom.xml
    compose.yaml
```

Where, respecting the clean architecture, we have the following classes:


| Class | Description |
| --- | --- |
| `Account` | This class represents the Account entity, which is the main entity of the Account microservice. It contains the attributes of the Account entity, such as `id`, `name`, `email`, `password`, and `sha256`. |
| `AccountModel` | This class represents the Account model, which is responsible for the persistence logic of the Account microservice. It contains the methods for creating, deleting, finding, and updating accounts. |
| `AccountParser` | This class is responsible for parsing the input and output of the API endpoints, converting the `AccountIn` and `AccountOut` DTOs to the `Account` entity, and vice versa. |
| `AccountRepository` | This interface is responsible for the data persistence of the Account entity, using an Object-Relational Mapping (ORM) framework to interact with the database. |
| `AccountResource` | This class is responsible for the API endpoints of the Account microservice, implementing the `AccountController` interface defined in the `account` module, and using the `AccountService` to handle the business logic of the API endpoints. |
| `AccountService` | This class is responsible for the business logic of the Account microservice, using the `AccountRepository` to handle the data persistence of the Account entity, and the `AccountParser` to handle the parsing of the input and output of the API endpoints. |




!!! example "Source"

    === "compose.yaml"

        ``` { .yaml .copy .select linenums="1" hl_lines="20-25" }
        --8<-- "docs/hands-on/1/repository/code/compose.yaml"
        ```

    === "pom.xml"

        ``` { .yaml .copy .select linenums="1" hl_lines="46-50 52-60" }
        --8<-- "docs/hands-on/1/repository/code/pom.xml"
        ```

    === "application.yaml"

        ``` { .yaml .copy .select linenums="1" hl_lines="9-11 13-26" }
        --8<-- "docs/hands-on/1/repository/code/application.yaml"
        ```

    === "Account.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "docs/hands-on/1/repository/code/Account.java"
        ```

    === "AccountModel.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "docs/hands-on/1/repository/code/AccountModel.java"
        ```

    === "AccountParser.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "docs/hands-on/1/repository/code/AccountParser.java"
        ```

    === "AccountRepository.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "docs/hands-on/1/repository/code/AccountRepository.java"
        ```

    === "AccountResource.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "docs/hands-on/1/repository/code/AccountResource.java"
        ```

    === "AccountService.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "docs/hands-on/1/repository/code/AccountService.java"
        ```

    === "V2026.02.27.001__create_schema.sql"

        ``` { .sql .copy .select linenums="1" }
        --8<-- "docs/hands-on/1/repository/code/V2026.02.27.001__create_schema.sql"
        ```

    === "V2026.02.27.002__create_table_account.sql"

        ``` { .sql .copy .select linenums="1" }
        --8<-- "docs/hands-on/1/repository/code/V2026.02.27.002__create_table_account.sql"
        ```

    === "V2026.02.27.003__create_index_email.sql"

        ``` { .sql .copy .select linenums="1" }
        --8<-- "docs/hands-on/1/repository/code/V2026.02.27.003__create_index_email.sql"
        ```

4. Running the Microservice

To run the Account microservice, we can use the `docker-compose` command to start the microservice and its dependencies (e.g., the PostgreSQL database). Make sure you are in the root directory of the project, where the `compose.yaml` file is located, and run the following command:

``` { bash }
docker compose up --build
```

Note that the `--build` flag is used to build the Docker images before starting the containers, which is necessary if you have made changes to the code or the Dockerfile.

Also, we can monitoring the logs of the microservice to see if it is running correctly. See there that the Flyway migrations are being executed, and that the microservice is starting up without any errors. You should see logs indicating that the microservice is up and running, and that it is connected to the database. In additional, you can also check the database to see if the migrations have been executed correctly, and that the tables have been created as expected.

1. Going inside the container:

    ``` { bash title="Entering the container" }
    docker exec -it account-service bash
    ```

2. Going inside the PostgreSQL database:

    ``` { bash title="Entering the PostgreSQL database" }
    psql -U store -d store
    ```

3. Verifying the migrations:

    ``` { bash title="List the schemas" }
    \dn
    ```

    ``` { bash title="List the tables" }
    \dt *.*
    ```


Yet, if you want to monitor the logs of the microservice without going inside the container, you can use the `docker logs` command to view the logs of the container. This will allow you to see the logs in real-time, and you can use it to monitor the startup process of the microservice, as well as any errors or issues that may arise.

``` { bash title="Monitoring the logs" }
docker logs -f account-service
```

---

Done!


[^1]: [Criando Migrations com Flyway no seu projeto Java Spring & PostgreSQL](https://www.youtube.com/watch?v=LX5jaieOIAk){target="_blank"}
