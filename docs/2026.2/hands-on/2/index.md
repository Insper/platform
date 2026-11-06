
The main functionality of Gateway Microservice is to route the incoming requests to the appropriate microservice, therefore, it is the entry point for all the incoming requests. In counterpart, each microservice have to expose their own port and endpoints to the internet, which is not a good practice. The Gateway Microservice will act as a reverse proxy and route the incoming requests to the appropriate microservice. Also, it will also handle the authentication and authorization of the incoming requests.

``` mermaid-sim
flowchart LR
    subgraph api [Trusted Layer]
        gateway e2@==> account
        gateway e4@==> others
        account --> db@{ shape: cyl, label: "Database" }
        others --> db
    end
    internet e1@==>|request| gateway
    e1@{ animate: true }
    e2@{ animate: true }
    e4@{ animate: true }
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
| `globalcors` | Cross-Origin Resource Sharing (CORS) for every path, configured once. The allowed origins come from `CORS_ALLOWED_ORIGINS`, with the local front ends as default; `allowCredentials: true` lets the browser send cookies (the token of [hands-on 3](../3/index.md)) — which is why the origins are listed and not `*`. |
| `default-filters` | Filters applied to every route. `RemoveRequestHeader=id-account` drops any `id-account` header sent by the client, so only the gateway can set it (hands-on 3); `DedupeResponseHeader` removes the CORS headers duplicated when a service also sets them. |

For each request, the gateway first checks its own endpoint, then the routes **in the order of the file**; the first `Path` predicate that matches wins, and the whole path goes on to the route's `uri`:

``` mermaid-sim
flowchart TB
    req["request to localhost:8080"] e1@--> own{"GET /health-check?"}
    own e2@-->|"yes"| gr["GatewayResource\nanswers the hostname"]
    own e3@-->|"no"| r1{"insper-service\nPath=/insper/**"}
    r1 -->|"match"| insper["https://www.insper.edu.br\n+ the whole path"]
    r1 e4@-->|"no"| r2{"account-service\nPath=/accounts/**"}
    r2 e5@-->|"match"| acc["http://account:8080\n+ the whole path"]
    r2 -->|"no"| nf["404 Not Found"]
```

A predicate is a pattern, not a prefix: `/accounts/**` matches `/accounts` and anything under `/accounts/`, but not `/account` nor `/accountsX`. Once a route matches, the CORS check and the default filters run before the request leaves:

``` mermaid-sim
sequenceDiagram
    participant C as client
    participant G as gateway :8080
    participant A as account :8080
    C->>G: GET /accounts (Origin, id-account: 1)
    G->>G: routes in order: account-service matches
    G->>G: CORS: is the Origin allowed?
    G->>G: default filters: drop id-account
    G->>A: GET http://account:8080/accounts
    A-->>G: 200 OK (empty list)
    G-->>C: 200 OK + Access-Control-Allow-Origin
```

`GatewayResource` answers `GET /health-check` with the container's hostname, which shows which replica answered once there are several ([hands-on 7](../7/index.md)). It returns that single variable on purpose: answering with `System.getenv()` would publish every environment variable — passwords and secrets included.

!!! warning "application.yaml"

    The routes point to the Compose service names (`account`), so the target containers must be running in the same Compose network; otherwise the gateway answers `500 Internal Server Error` for that route.

    Also, a browser call from an origin that is not in `allowedOrigins` is blocked by CORS: set `CORS_ALLOWED_ORIGINS` for the front end you use.

After finishing the implementation of the Gateway Microservice, we can include it in the `compose.yaml` file and start it using Docker Compose. You can also test the Gateway Microservice by sending requests to the exposed port of the Gateway Microservice and checking if the requests are routed to the appropriate microservice.

``` { .yaml .copy .select linenums="1" title="compose.yaml" }
--8<-- "docs/2026.2/hands-on/2/code/compose.yaml"
``` 

Note that the other microservices declared in the `compose.yaml` file do not have its ports exposed to the internet, therefore, they can only be accessed through the Gateway Microservice.

| Service | hands-on 1 | hands-on 2 |
|---|---|---|
| `account` | ✅ `8080` published | ❌ no port: only through the gateway |
| `gateway` | — | ✅ `8080` published |
| `db` | ❌ no port | ❌ no port |

``` mermaid-sim
flowchart LR
    subgraph h1 [hands-on 1]
        c1["client"] e1@-->|":8080"| a1["account"]
        a1 --> d1[("db")]
    end
    subgraph h2 [hands-on 2]
        c2["client"] e2@-->|":8080"| g2["gateway"]
        g2 e3@--> a2["account\nno published port"]
        a2 --> d2[("db")]
    end
```

## Run and verify

Package each service with Maven first (the Dockerfile copies `target/*.jar`), then start the stack and call the gateway's port:

``` { bash }
docker compose up -d --build
curl http://localhost:8080/health-check
curl http://localhost:8080/accounts
```

You should see the gateway's hostname (the container id, so yours differs), then the answer of `account`, routed by the gateway (an empty list on an empty table):

``` { .text .no-copy }
{"hostname":"3f2a9c1d7b4e"}
[]
```

Calling `account` directly from the host must **fail**: it has no published port, and its name exists only inside the Compose network.

<div class="csim" data-sim="gateway-routes" data-script="verify"></div>

!!! tip "Try it"

    Before running Docker, the same gateway in the browser: its own endpoint and the 2 routes of `application.yaml`, in order. Play or → sends the requests of this section and a few more: `/health-check` answers in the gateway itself, `/accounts` goes to `http://account:8080/accounts`, `/insper` to https://www.insper.edu.br/insper (the whole path goes on), `/account` gets 404 (a predicate is a pattern, not a prefix), a forged `id-account` is dropped, an Origin from evil.example gets 403, and after `docker compose stop account` the same request gets 500. In **free** mode, type any path.

!!! warning "Common pitfalls"

    - **No jar**: `COPY target/*.jar` fails if the service was not packaged with Maven.
    - **Wrong host**: a route uses the Compose service name (`account`), not `localhost` — inside the gateway's container, `localhost` is the gateway itself.
    - **Leaking ports**: publishing a port of `account` lets clients bypass the gateway, and everything it checks.
