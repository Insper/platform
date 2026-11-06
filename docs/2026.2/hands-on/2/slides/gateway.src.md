---
marp: true
lang: en
title: Hands-on 2 — Gateway
description: Platforms, Microservices, DevOps and APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">Platforms, Microservices, DevOps and APIs · Hands-on 2</div>

# Hands-on 2 — Gateway

**One entry point in front of every microservice**

<!--
Outline: (1) why a gateway; (2) the gateway-service project; (3) pom.xml, routes and CORS in
application.yaml; (4) Dockerfile and compose.yaml; (5) run, verify, pitfalls.
-->

---

## Why a gateway?

<div class="q">

Each microservice exposes **its own port and endpoints** to the internet. What is wrong with that?

</div>

* Many doors to **secure** and to keep track of.
* Clients must know **where every service lives**.
* Auth, CORS, logging… **repeated** in every service.

<!--
Let the class answer. The gateway is a reverse proxy: one port open, everything else in the trusted layer.
-->

---

## The architecture

<div class="flow" style="align-items: stretch">
<div class="box muted" style="flex: .55; display: flex; flex-direction: column; justify-content: center">internet<small>client</small></div>
<div class="arrow" style="align-self: center">:8080 →</div>
<div class="group" style="flex: 4">
<div class="caption">trusted layer · Compose network</div>
<div class="flow">
<div class="box accent">gateway<small>the only published port</small></div><div class="arrow">→</div>
<div class="box">account<small>no port</small></div><div class="box muted">others</div><div class="arrow">→</div>
<div class="box green">database</div>
</div>
</div>
</div>

- The **gateway** is a reverse proxy: the single entry point for every request.
- `account` and the other services live in the **trusted layer**, unreachable from outside.

<div class="ok">

Key functionalities: **routing** to the right microservice, and **authentication / authorization** (next hands-on).

</div>

---

## What else it can handle

| Concern | Benefit |
|---|---|
| Authentication / authorization | secure the application in one place |
| Load balancing | scale the application |
| Caching | improve performance |
| Logging and monitoring | debug and troubleshoot |
| Rate limiting | protect against DDoS attacks |

<p class="small">All of them are features of Spring Cloud Gateway, the library used in this hands-on.</p>

---

## The gateway-service project

```text
api/
    gateway-service/
        src/main/java/store/gateway/
            GatewayServiceApplication.java
            GatewayResource.java
        src/main/resources/application.yaml
        pom.xml
        Dockerfile
    .env
    compose.yaml
```

---

## pom.xml: the dependencies

Spring Boot `4.1.1`, Java `25`, Spring Cloud `2025.1.3` (imported via `spring-cloud-dependencies`).

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-webflux</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-gateway-server-webflux</artifactId>
</dependency>
```

<p class="small"><strong>WebFlux</strong> is reactive: a large number of concurrent requests with a small number of threads.</p>

---

## application.yaml: routes

Under `spring.cloud.gateway.server.webflux`:

```yaml
routes:
  - id: insper-service
    uri: https://www.insper.edu.br
    predicates:
      - Path=/insper/**

  - id: account-service
    uri: http://account:8080   # Compose service name
    predicates:
      - Path=/accounts/**
```

A request matching the `Path` **predicate** is forwarded to the route's `uri`.

---

## Which route answers a path?

<div class="flow"><div class="box" style="flex: .7">/health-check</div><div class="arrow">→</div><div class="box green">GatewayResource<small>own endpoint, checked first</small></div></div>
<div class="flow"><div class="box" style="flex: .7">/insper/…</div><div class="arrow">→</div><div class="box accent">insper-service<small>https://www.insper.edu.br/insper/…</small></div></div>
<div class="flow"><div class="box" style="flex: .7">/accounts · /accounts/…</div><div class="arrow">→</div><div class="box accent">account-service<small>http://account:8080/accounts/…</small></div></div>
<div class="flow"><div class="box" style="flex: .7">/account · /products</div><div class="arrow">→</div><div class="box red">no route<small>404 Not Found</small></div></div>

- Own endpoint first, then the routes **in file order**: the first match wins and the **whole path** goes on.
- A predicate is a pattern, not a prefix: `/accounts/**` does not match `/account`.

---

<!-- _class: tight -->

## application.yaml: CORS and default filters

```yaml
default-filters:
  - RemoveRequestHeader=id-account
  - DedupeResponseHeader=Access-Control-Allow-Credentials Access-Control-Allow-Origin
globalcors:
  corsConfigurations:
    '[/**]':
      allowedOrigins: ${CORS_ALLOWED_ORIGINS:http://localhost,http://localhost:3000,http://localhost:8080}
      allowedHeaders: "*"
      allowedMethods: "*"
      allowCredentials: true
```

- CORS is configured **once, at the gateway**, for every path; `CORS_ALLOWED_ORIGINS` overrides the local defaults.
- `RemoveRequestHeader=id-account`: a client can never forge the header the gateway sets in hands-on 3.

<div class="warn">

`allowCredentials: true` (cookies) forbids `*` as origin — and every key must sit under `spring.cloud.gateway.server.webflux`, or Gateway 5 ignores it.

</div>

---

## The gateway's own endpoints

```java
@RestController
public class GatewayResource {

    @GetMapping("/health-check")
    public ResponseEntity<Map<String, String>> healthCheck() {
        // only the hostname: which replica answered
        return ResponseEntity.ok(Map.of(
            "hostname", System.getenv().getOrDefault("HOSTNAME", "unknown")
        ));
    }
}
```

<p class="small">The hostname shows which replica answered once there are several (hands-on 7). Never return <code>System.getenv()</code>: it would publish every secret. <code>GatewayServiceApplication</code> is a plain <code>@SpringBootApplication</code>.</p>

---

## Dockerfile and compose.yaml

<div class="cols">
<div>

```dockerfile
FROM eclipse-temurin:25
VOLUME /tmp
COPY target/*.jar /app.jar
ENTRYPOINT ["java", "-jar", "/app.jar"]
```

</div>
<div>

```yaml
account:
  build:
    context: ./account-service
  deploy:
    replicas: 1

gateway:
  build:
    context: ./gateway-service
  ports:
    - 8080:8080
  deploy:
    replicas: 1
```

</div>
</div>

<div class="ok">

Only the gateway publishes a port. `account` is reachable **only through the gateway**.

</div>

---

## Run and verify

```bash
docker compose up -d --build
curl http://localhost:8080/health-check   # {"hostname":"..."}
curl http://localhost:8080/accounts      # routed to account:8080
```

- Send requests to the **gateway's port** and check they reach the right microservice.
- Calling `account` directly from the host must **fail**: it has no published port.

<p class="small">The Dockerfile copies <code>target/*.jar</code>: package the service with Maven before building the image.</p>

---

## Common pitfalls

- **Services not running**: the route `http://account:8080` needs the `account` container up and on the same Compose network.
- **Wrong host**: the route uses the Compose service name (`account`), not `localhost`.
- **No jar**: `COPY target/*.jar` fails if the project was not packaged.
- **CORS**: a browser call fails if the origin is not in `allowedOrigins`.
- **Leaking ports**: publishing `account`'s port bypasses the gateway.

---

## Without Docker: the simulator

<div class="flow">
<div class="box green">/health-check<small>200 · GatewayResource</small></div>
<div class="box accent">/accounts<small>200 · account:8080</small></div>
<div class="box red">/account<small>404 · no route</small></div>
<div class="box red">evil.example<small>403 · CORS</small></div>
<div class="box orange">account stopped<small>500</small></div>
</div>

- The page embeds the lab's gateway as a simulator: its own endpoint, the two routes, the filters and the origins of `application.yaml`.
- Play replays **Run and verify**; type any path and see which row of the route table answers.
- Stop the `account` container, or call it directly from the host: the route fails, the direct call cannot even resolve `account`.

<!--
The simulator sits in the Run and verify section of the page.
-->

---

## Takeaways

1. The gateway is the **single entry point**: one exposed port, everything else in the trusted layer.
2. Core jobs: **routing** and **authentication / authorization**.
3. Built with **Spring Cloud Gateway** on **WebFlux** (reactive, few threads).
4. Routes = `id` + `uri` + `Path` **predicate** in `application.yaml`.
5. **CORS** is configured once, at the gateway.
6. In `compose.yaml`, **only the gateway** publishes a port (`8080:8080`).
