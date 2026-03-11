
The main functionality of Gateway Microservice is to route the incoming requests to the appropriate microservice, therefore, it is the entry point for all the incoming requests. In counterpart, each microservice have to expose their own port and endpoints to the internet, which is not a good practice. The Gateway Microservice will act as a reverse proxy and route the incoming requests to the appropriate microservice. Also, it will also handle the authentication and authorization of the incoming requests.

``` mermaid
flowchart LR
    subgraph api [Trusted Layer]
        direction TB
        gateway e2@==> account
        gateway e4@==> others
        account --> db@{ shape: cyl, label: "Database" }
        others --> db
    end
    internet e1@==>|request| gateway:::red
    e1@{ animate: true }
    e2@{ animate: true }
    e4@{ animate: true }
    classDef red fill:#fcc
```

Advantages of using a Gateway Microservice:

- It provides a single entry point for all the incoming requests, which makes it easier to manage and secure the application;
- Only a single port needs to be exposed to the internet, which makes it easier to secure the application;
- It can handle:
    - The authentication and authorization of the incoming requests, which makes it easier to secure the application;
    - The load balancing of the incoming requests, which makes it easier to scale the application;
    - The caching of the incoming requests, which makes it easier to improve the performance of the application;
    - The logging and monitoring of the incoming requests, which makes it easier to debug and troubleshoot the application;
    - The rate limiting of the incoming requests, which makes it easier to protect the application from DDoS attacks;

The key functionalities of Gateway Microservice are:

- **Routing**: it will route the incoming requests to the appropriate microservice.
- **Authentication/Authorization**: it will handle the authentication and the authorization of the incoming requests.


## Gateway-Service

``` tree
api
    gateway-service/
        src/
            main/
                java/
                    store/
                        gateway/
                            GatewayApplication.java
                            GatewayResource.java
                resources/
                    application.yaml
        pom.xml
        Dockerfile
    .env
    compose.yaml
```

!!! info "Source"

    === "pom.xml"

        ``` { .yaml .copy .select linenums="1" hl_lines="24-31" }
        --8<-- "docs/hands-on/2/code/pom.xml"
        ```

    === "application.yaml"

        ``` { .yaml .copy .select linenums="1" hl_lines="5-27" }
        --8<-- "docs/hands-on/2/code/application.yaml"
        ```

    === "GatewayApplication.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "docs/hands-on/2/code/GatewayApplication.java"
        ```

    === "GatewayResource.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "docs/hands-on/2/code/GatewayResource.java"
        ```

    === "Dockerfile"

        ``` { .dockerfile .copy .select linenums="1" }
        --8<-- "docs/hands-on/2/code/Dockerfile"
        ```

Note that the Gateway Microservice is implemented using Spring Cloud Gateway, which is a library that provides a simple and effective way to route the incoming requests to the appropriate microservice. It also provides a lot of features such as authentication, authorization, load balancing, caching, logging, monitoring, and rate limiting.

Also, the Gateway Microservice is implemented using WebFlux, which is a reactive programming model that allows to handle a large number of concurrent requests with a small number of threads. This makes it easier to scale the application and improve the performance of the application.

!!! warning "application.yaml"

    The `application.yaml` file is configured to route the incoming requests to the appropriate microservice, therefore, you need to make sure that the microservices are running and exposing their ports before starting the Gateway Microservice.

    Also, the `application.yaml` file is configured the CORs to allow the incoming requests from the internet, therefore, you need to make sure that the CORS configuration is correct before starting the Gateway Microservice.

After finishing the implementation of the Gateway Microservice, we can include it in the `compose.yaml` file and start it using Docker Compose. You can also test the Gateway Microservice by sending requests to the exposed port of the Gateway Microservice and checking if the requests are routed to the appropriate microservice.

``` { .dockerfile .copy .select linenums="1" title="compose.yaml" }
--8<-- "docs/hands-on/2/code/compose.yaml"
``` 

Note that the other microservices declared in the `compose.yaml` file do not have its ports exposed to the internet, therefore, they can only be accessed through the Gateway Microservice.

