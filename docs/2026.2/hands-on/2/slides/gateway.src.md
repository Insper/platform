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

`internet` → **gateway** → `account`, others → `database`

- The **gateway** is a reverse proxy: the single entry point for every request.
- `account` and the other services live in the **trusted layer**, unreachable from outside.
- **Only one port** is exposed to the internet.

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

<p class="small">Never return <code>System.getenv()</code>: it would publish every secret. <code>GatewayServiceApplication</code> is a plain <code>@SpringBootApplication</code>.</p>

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
curl http://localhost:8080/accounts/...   # routed to account:8080
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

## Takeaways

1. The gateway is the **single entry point**: one exposed port, everything else in the trusted layer.
2. Core jobs: **routing** and **authentication / authorization**.
3. Built with **Spring Cloud Gateway** on **WebFlux** (reactive, few threads).
4. Routes = `id` + `uri` + `Path` **predicate** in `application.yaml`.
5. **CORS** is configured once, at the gateway.
6. In `compose.yaml`, **only the gateway** publishes a port (`8080:8080`).
