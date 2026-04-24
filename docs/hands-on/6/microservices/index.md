
Each microservice needs two changes: the required Maven dependencies in `pom.xml` and the actuator endpoint configuration in `application.yaml`.

## 1 Dependencies

Add the following dependencies to the `pom.xml` of **each microservice** (`gateway-service`, `auth-service`, and `account-service`):

``` { .xml .copy .select }
<!-- metrics collection -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>

<!-- export in prometheus format -->
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-registry-prometheus</artifactId>
    <scope>runtime</scope>
</dependency>
```

- `spring-boot-starter-actuator` enables production-ready management endpoints, including health checks and metrics.
- `micrometer-registry-prometheus` exports those metrics in the text format that Prometheus expects to scrape.

## 2 Configuration

Configure each service's `application.yaml` to expose the Prometheus endpoint under the service's own context path. This keeps all endpoints reachable through the single load balancer port without conflicts:

=== "gateway-service"

    ``` { .yaml .copy .select }
    management:
      endpoints:
        web:
          base-path: /gateway/actuator
          exposure:
            include: ['prometheus']

    spring:
      cloud:
        gateway:
          metrics:
            enabled: true
    ```

=== "auth-service"

    ``` { .yaml .copy .select }
    management:
      endpoints:
        web:
          base-path: /auth/actuator
          exposure:
            include: ['prometheus']
    ```

=== "account-service"

    ``` { .yaml .copy .select }
    management:
      endpoints:
        web:
          base-path: /accounts/actuator
          exposure:
            include: ['prometheus']
    ```

!!! info "Why different base paths?"

    Each microservice uses its own context prefix so the Prometheus endpoint becomes reachable as `/gateway/actuator/prometheus`, `/auth/actuator/prometheus`, and `/accounts/actuator/prometheus` — without port conflicts and without exposing internal ports directly.`

