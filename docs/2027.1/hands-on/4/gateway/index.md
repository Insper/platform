The gateway is the API's front door: every request that passes the edge goes through it. It is built on **Spring Cloud Gateway**, which runs on Spring WebFlux and Netty — non-blocking, so a few threads proxy thousands of concurrent requests — on port **8080**.

| Responsibility | How |
|---|---|
| **Routing** | `/auth/**` → `auth`; `/catalog/**` → `lb://catalog` |
| **Load balancing** over service instances | Spring Cloud LoadBalancer over `catalog-1..3`, skipping unhealthy ones |
| **Authentication** | validates the JWT: signature (JWKS), `exp`, `iss`, `aud` |
| **Authorization** (coarse) | open / any token / scope `admin`, per path and method |
| **Identity propagation** | `X-User-Id`, `X-User-Email`, `X-User-Scope` for the services |
| **Timeouts and retries** | connect 1 s, response 5 s; one retry for idempotent GETs |

## 1. Project

Create `services/gateway` (same `Dockerfile` with `EXPOSE 8080`, same `.dockerignore`).

``` { .xml title="services/gateway/pom.xml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/4/code/services/gateway/pom.xml"
```

``` { .java title="services/gateway/src/main/java/boxoffice/gateway/GatewayApplication.java" .copy }
--8<-- "docs/2027.1/hands-on/4/code/services/gateway/src/main/java/boxoffice/gateway/GatewayApplication.java"
```

## 2. Routes and load balancing

``` { .yaml title="services/gateway/src/main/resources/application.yaml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/4/code/services/gateway/src/main/resources/application.yaml"
```

- A **route** = id + predicates (when it matches) + URI (where it goes) + filters.
- `uri: lb://catalog` asks Spring Cloud LoadBalancer for an instance of `catalog` on each request (round robin). The instance list here is static (`discovery.client.simple`); with Kubernetes in lab 10 a `Service` takes over this job.
- `configurations: health-check` makes the balancer poll each instance's `/actuator/health` every 5 s and skip those that are not `UP` — an **active** health check, the thing open-source Nginx could not do in lab 3. It uses a `WebClient` to probe, which in Spring Boot 4 lives in its own starter: that is why the pom has `spring-boot-starter-webclient`. Until the first round of probes completes (a few seconds after startup) the balancer knows no healthy instance and the gateway answers `503`.
- `Retry` re-sends a failed GET once (to another instance); never POSTs, which might not be idempotent.

!!! note "Two load balancers?"

    Yes, on purpose: the **edge** balances across *gateway* replicas (add `gateway-2` to the Nginx upstream when one gateway is not enough), and the **gateway** balances across *service* instances. That mirrors the cloud: a public L7 load balancer in front of a fleet of API gateways, which call services through internal load balancing.

## 3. Security: who may call what

``` { .java title="services/gateway/src/main/java/boxoffice/gateway/SecurityConfig.java" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/4/code/services/gateway/src/main/java/boxoffice/gateway/SecurityConfig.java"
```

- Rules are evaluated **in order**; the first match wins. `anyExchange().authenticated()` is the safe default: a new route added next month is protected unless someone opens it explicitly.
- `oauth2ResourceServer().jwt()` turns the gateway into an OAuth 2.0 **resource server**: it reads `Authorization: Bearer …`, validates the token with the decoder below and maps the `scope` claim to authorities (`SCOPE_user`, `SCOPE_admin`).
- The decoder downloads the JWKS from `auth` **once** and caches it; it refetches only when a token arrives with an unknown `kid`. That is why validation is local and cheap.
- A missing or invalid token gets `401 Unauthorized` (with a `WWW-Authenticate` header); a valid token without the needed scope gets `403 Forbidden`.

## 4. Identity headers

``` { .java title="services/gateway/src/main/java/boxoffice/gateway/UserHeadersFilter.java" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/4/code/services/gateway/src/main/java/boxoffice/gateway/UserHeadersFilter.java"
```

A `GlobalFilter` runs for every route. It first **strips** any `X-User-*` header sent by the client, then, if the request carries a validated JWT, adds the identity taken from the token. Services read a plain header instead of parsing tokens — simple, but it only holds as long as nobody can reach the services without crossing the gateway.

## 5. The new edge

The edge now forwards everything to the gateway; routing by path moved one hop in. It also hides `/actuator/` from the internet.

``` { .nginx title="infra/nginx/nginx.conf" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/4/code/infra/nginx/nginx.conf"
```

## 6. Compose

``` { .yaml title="docker-compose.yaml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/4/code/docker-compose.yaml"
```

The gateway publishes port 8080 only so that you can measure it directly; in production only the edge would be exposed.

<!-- termynal -->
``` shell
> docker compose up --build -d
> curl -s localhost:8080/actuator/gateway/routes | jq -r '.[].route_id'
auth
catalog
> curl -s -o /dev/null -w "%{http_code}\n" localhost/catalog/events/1
200
> curl -s -o /dev/null -w "%{http_code}\n" localhost/actuator/health
404
```

!!! warning "Pitfalls"

    - **`401` on every protected route right after startup**: the gateway fetches the JWKS lazily; if `auth` was down at that moment, retry — and check `AUTH_JWKS_URI`.
    - **`401` after restarting `auth`**: the old tokens were signed with the old key. Log in again.
    - **Clock skew**: `exp`/`iat` are compared with the gateway's clock; containers share the host clock, but servers in production need NTP (class 3).
    - **CORS**: a browser front end on another origin needs CORS configured at the gateway (`spring.cloud.gateway.server.webflux.globalcors`) — not needed for k6 or curl.

Back to the [lab overview](../index.md#measure-it) to try it and measure it.
