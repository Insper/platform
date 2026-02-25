
## 2. Docker Compose

Previously work on the Account microservice, it is necessary to prepare the environment by installing the database to persist the data. For that, we will use a Docker Compose file to create a PostgreSQL container, as well as, a cluster to isolate the microservices from external access, creating a secure environment - trusted layer. A Docker Compose file is a YAML file that defines how Docker containers should behave in production. The file contains the configuration for the database, the microservices, and the network configuration.

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

``` tree
api/
    account/
    account-service/
    .env
    compose.yaml
```

=== "compose.yaml"
    ``` { .yaml .copy .select linenums="1" }
    --8<-- "https://raw.githubusercontent.com/repo-classes/pma.26.1/refs/heads/main/api/compose.yaml"
    ```

=== ".env"
    ``` { .sh .copy .select linenums="1" }
    --8<-- "https://raw.githubusercontent.com/repo-classes/pma.26.1/refs/heads/main/api/.env"
    ```

<!-- termynal -->

``` { bash }
> docker compose up -d --build

[+] Running 2/2
 ✔ Network store_default  Created            0.1s 
 ✔ Container store-db-1   Started            0.2s 
```
