As we have seen in the previous hands-on, the microservices are implemented as Spring Boot applications. To run the microservices, we need to prepare the environment by installing the database to persist the data. For that, we will use a Docker Compose file to create a PostgreSQL container, as well as, a cluster to isolate the microservices from external access, creating a secure environment - trusted layer.

A Docker Compose file is a YAML file that defines how Docker containers should behave in production. The file contains the configuration for the database, the microservices, and the network configuration.

The bellow diagram illustrates the architecture of the system, that will be created using Docker Compose, where the microservices are isolated from the external access, creating a trusted layer. The microservices can only access the database, and the external access is blocked.

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

At diagram, the `account` microservice is the business logic layer that interacts with the database.

The directory structure of the project looks like something as follows:

``` tree
api/
    account/
    account-service/
        src/
        Dockerfile
    .env
    compose.yaml
```

The `compose.yaml` file contains the configuration for the database and the microservices, as well as, the network configuration. The `.env` file contains the environment variables for the database, such as the username, password, and database name. The `Dockerfile` file contains the configuration for the microservice, such as the base image, the dependencies, and the command to run the application.

The content of the files are as follows:

=== "compose.yaml"
    ``` { .yaml .copy .select linenums="1" }
    --8<-- "docs/hands-on/1/containerization/compose.yaml"
    ```

=== ".env"
    ``` { .sh .copy .select linenums="1" }
    --8<-- "docs/hands-on/1/containerization/.env"
    ```

=== "Dockerfile"
    ``` { .dockerfile .copy .select linenums="1" }
    --8<-- "docs/hands-on/1/containerization/code/Dockerfile"
    ```

To run the application, we need to execute the following command:

``` { bash }
docker compose up -d --build
```

Yet, to check if the application is running, we can execute the following command:

``` { bash }
docker compose ps -a
```

____

Done! In the next hands-on, we will connect to the database and execute some queries to check if the data is being persisted correctly.

