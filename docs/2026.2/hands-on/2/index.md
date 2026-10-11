
The main functionality of Gateway Microservice is to route the incoming requests to the appropriate microservice, therefore, it is the entry point for all the incoming requests. In counterpart, each microservice have to expose their own port and endpoints to the internet, which is not a good practice. The Gateway Microservice will act as a reverse proxy and route the incoming requests to the appropriate microservice. Also, it will also handle the authentication and authorization of the incoming requests.

``` mermaid-sim
flowchart LR
    subgraph api [Trusted Layer]
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


## Slides

<div class="slides-embed">
  <iframe src="slides/gateway.html" title="Slides: hands-on 2 — gateway" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/gateway.html){:target="_blank"}

## Gateway-Service

``` tree
api
    gateway-service/
        src/
            main/
                java/
                    store/
                        gateway/
                            GatewayServiceApplication.java
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

        ``` { .yaml .copy .select linenums="1" hl_lines="23-30" }
        --8<-- "docs/2026.2/hands-on/2/code/pom.xml"
        ```

    === "application.yaml"

        ``` { .yaml .copy .select linenums="1" hl_lines="5-32" }
        --8<-- "docs/2026.2/hands-on/2/code/application.yaml"
        ```

    === "GatewayServiceApplication.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "docs/2026.2/hands-on/2/code/GatewayServiceApplication.java"
        ```

    === "GatewayResource.java"

        ``` { .java .copy .select linenums='1' }
        --8<-- "docs/2026.2/hands-on/2/code/GatewayResource.java"
        ```

    === "Dockerfile"

        ``` { .dockerfile .copy .select linenums="1" }
        --8<-- "docs/2026.2/hands-on/2/code/Dockerfile"
        ```

Note that the Gateway Microservice is implemented using Spring Cloud Gateway, which is a library that provides a simple and effective way to route the incoming requests to the appropriate microservice. It also provides a lot of features such as authentication, authorization, load balancing, caching, logging, monitoring, and rate limiting.

Also, the Gateway Microservice is implemented using WebFlux, which is a reactive programming model that allows to handle a large number of concurrent requests with a small number of threads. This makes it easier to scale the application and improve the performance of the application.

Everything the gateway reads lives under `spring.cloud.gateway.server.webflux` — the prefix of Spring Cloud Gateway 5 (Spring Cloud 2025.1); a key left directly under `spring.cloud.gateway` is silently ignored:

| Key | What it does |
| --- | --- |
| `routes` | Each route has an `id`, a `uri` and a `Path` predicate: `/accounts/**` goes to `http://account:8080`, the Compose service name of the account microservice. |
| `globalcors` | CORS for every path, configured once. The allowed origins come from `CORS_ALLOWED_ORIGINS`, with the local front ends as default; `allowCredentials: true` lets the browser send cookies (the token of [hands-on 3](../3/index.md)) — which is why the origins are listed and not `*`. |
| `default-filters` | Filters applied to every route. `RemoveRequestHeader=id-account` drops any `id-account` header sent by the client, so only the gateway can set it (hands-on 3); `DedupeResponseHeader` removes the CORS headers duplicated when a service also sets them. |

`GatewayResource` answers `GET /health-check` with the container's hostname, which shows which replica answered once there are several ([hands-on 7](../7/index.md)). It returns that single variable on purpose: answering with `System.getenv()` would publish every environment variable — passwords and secrets included.

!!! warning "application.yaml"

    The routes point to the Compose service names (`account`), so the target containers must be running in the same Compose network; otherwise the gateway answers with an error for that route.

    Also, a browser call from an origin that is not in `allowedOrigins` is blocked by CORS: set `CORS_ALLOWED_ORIGINS` for the front end you use.

After finishing the implementation of the Gateway Microservice, we can include it in the `compose.yaml` file and start it using Docker Compose. You can also test the Gateway Microservice by sending requests to the exposed port of the Gateway Microservice and checking if the requests are routed to the appropriate microservice.

``` { .yaml .copy .select linenums="1" title="compose.yaml" }
--8<-- "docs/2026.2/hands-on/2/code/compose.yaml"
``` 

Note that the other microservices declared in the `compose.yaml` file do not have its ports exposed to the internet, therefore, they can only be accessed through the Gateway Microservice.
