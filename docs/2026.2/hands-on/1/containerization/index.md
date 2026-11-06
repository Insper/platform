As we have seen in the previous hands-on, the microservices are implemented as Spring Boot applications. To run the microservices, we need to prepare the environment by installing the database to persist the data. For that, we will use a Docker Compose file to create a PostgreSQL container, as well as, a cluster to isolate the microservices from external access, creating a secure environment - trusted layer.

A Docker Compose file is a YAML file that defines how Docker containers should behave in production. The file contains the configuration for the database, the microservices, and the network configuration.

The bellow diagram illustrates the architecture of the system, that will be created using Docker Compose, where the microservices are isolated from the external access, creating a trusted layer. The microservices can only access the database, and the external access is blocked.

``` mermaid-sim
flowchart LR
    subgraph api [Trusted Layer]
        account e3@==> db@{ shape: cyl, label: "Database" }
    end
    internet e1@==>|request| account
    e1@{ animate: true }
    e3@{ animate: true }
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
    --8<-- "docs/2026.2/hands-on/1/containerization/code/compose.yaml"
    ```

=== ".env"
    ``` { .yaml .copy .select linenums="1" }
    --8<-- "docs/2026.2/hands-on/1/containerization/code/.env"
    ```

=== "Dockerfile"
    ``` { .dockerfile .download data-filename="Dockerfile" .copy .select linenums="1" }
    --8<-- "docs/2026.2/hands-on/1/containerization/code/Dockerfile"
    ```

In this configuration, we use the `postgres:17` image to create a PostgreSQL container, and we set the environment variables for the database using the `.env` file. Only `account` publishes a port (`8080`); the database has no `ports`, so it is reachable only from inside the Compose network — the trusted layer.

| Service | Port on the host | Reachable from |
|---|---|---|
| `account` | ✅ `8080` | your machine (`localhost:8080`) and the Compose network |
| `db` | ❌ none | only the Compose network, as `db:5432` |

From the jar to the running containers:

``` mermaid-sim
flowchart LR
    pkg["mvn clean package"] e1@--> jar["target/*.jar"]
    jar e2@-->|"COPY in the Dockerfile"| img["image store-account"]
    img e3@-->|"docker compose up"| acc["container account\n:8080 on the host"]
    pg["image postgres:17"] e4@-->|"docker compose up"| db["container db\nno published port"]
    acc e5@-->|"db:5432"| db
```

!!! warning "Common pitfalls"

    - The Dockerfile copies `target/*.jar`: run `mvn clean package` **before** `docker compose up --build`, or there is no jar to copy.
    - Inside Compose, services reach each other by **service name** (`db`, `account`), not `localhost`: inside a container, `localhost` is the container itself.

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

[Repository](../repository/){ .md-button .md-button }
