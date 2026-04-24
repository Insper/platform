!!! tip "Main Goal"

    The main goal of this hands-on is to add **observability** to the microservices stack using [Prometheus](https://prometheus.io){target="_blank"} for metrics collection and [Grafana](https://grafana.com){target="_blank"} for visualization, enabling real-time monitoring of the entire platform.

Observability is a critical property of distributed systems. Without it, understanding system behavior, diagnosing failures, and measuring performance across multiple services becomes nearly impossible. The three pillars of observability are:

- **Logging**: Structured records of events occurring within each service.
- **Monitoring**: Continuous collection and visualization of system and application metrics over time.
- **Tracing**: Tracking the end-to-end lifecycle of a single request as it flows through multiple services.

In this hands-on, we will focus on **monitoring**, wiring together [Spring Boot Actuator](https://docs.spring.io/spring-boot/docs/current/reference/html/actuator.html){target="_blank"}, Prometheus, and Grafana.

The resulting architecture adds a dedicated observability layer alongside the existing microservices:

``` mermaid
flowchart LR
    subgraph obs [Observability Layer]
        prometheus@{ shape: cyl, label: "Prometheus\n:9090" }
        grafana[Grafana\n:3000]
        prometheus --> grafana
    end
    subgraph api [Trusted Layer]
        loadbalancer --> gateway
        gateway --> auth
        gateway --> account
    end
    prometheus e1@-.->|scrape /actuator/prometheus| gateway
    prometheus e2@-.->|scrape /actuator/prometheus| auth
    prometheus e3@-.->|scrape /actuator/prometheus| account
    internet e0@==>|:80| loadbalancer
    e0@{ animate: true }
    e1@{ animate: true }
    e2@{ animate: true }
    e3@{ animate: true }
```

The setup requires changes across three areas:

<div class="grid cards" markdown>

-   __1. Microservices__

    ---

    Add Actuator and Prometheus registry dependencies to each Spring Boot service and expose the metrics endpoint.

-   __2. Prometheus__

    ---

    Deploy Prometheus via Docker Compose and configure it to scrape metrics from each microservice.

-   __3. Grafana__

    ---

    Deploy Grafana via Docker Compose, connect it to Prometheus, and explore pre-built dashboards.

</div>

---

## 1. Microservices

Each microservice needs two changes: the required Maven dependencies in `pom.xml` and the actuator endpoint configuration in `application.yaml`.

### 1.1 Dependencies

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

### 1.2 Configuration

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

    The gateway routes all traffic through a single external port (`:80`). Each microservice uses its own context prefix so the Prometheus endpoint becomes reachable as `/gateway/actuator/prometheus`, `/auth/actuator/prometheus`, and `/accounts/actuator/prometheus` — without port conflicts and without exposing internal ports directly.`

1. The `RouterValidator` already handles `/**` wildcards via the `deep` branch in the `noneMatch` predicate, so this single entry opens all actuator sub-paths.

---

## 2. Docker Compose

Two new services — `prometheus` and `grafana` — must be added to `compose.yaml`. Both services share the same private Docker network as the microservices, so Prometheus can reach them by hostname.

``` { .yaml .copy .select title="compose.yaml" linenums="1" }
  prometheus:
    image: prom/prometheus:latest
    hostname: prometheus
    ports:
      - 9090:9090
    volumes:
      - $SETUP/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana-enterprise
    hostname: grafana
    ports:
      - 3000:3000
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - $SETUP/grafana:/var/lib/grafana
      - $SETUP/grafana/provisioning/datasources:/etc/grafana/provisioning/datasources
    restart: always
```

The `$SETUP` variable points to the directory containing all external configuration files. Define it in the `.env` file at the root of the project:

``` { .bash .copy .select }
SETUP=./setup
```

The resulting project structure looks like this:

``` { .tree }
api/
    setup/
        prometheus/
            prometheus.yml
        grafana/
            provisioning/
                datasources/
                    datasources.yml
    account-service/
    auth-service/
    gateway-service/
    compose.yaml
    .env
```

---

## 3. Prometheus

[Prometheus](https://prometheus.io){target="_blank"} works by **pulling** (`scraping`) metrics from each service endpoint at a configured interval and storing the time-series data locally.

Create the file `setup/prometheus/prometheus.yml`:

``` { .yaml .copy .select linenums="1" }
scrape_configs:

  - job_name: 'GatewayMetrics'
    metrics_path: '/gateway/actuator/prometheus'
    scrape_interval: 1s
    static_configs:
      - targets:
        - gateway:8080
        labels:
          application: 'Gateway Application'

  - job_name: 'AuthMetrics'
    metrics_path: '/auth/actuator/prometheus'
    scrape_interval: 1s
    static_configs:
      - targets:
        - auth:8080
        labels:
          application: 'Auth Application'

  - job_name: 'AccountMetrics'
    metrics_path: '/accounts/actuator/prometheus'
    scrape_interval: 1s
    static_configs:
      - targets:
        - account:8080
        labels:
          application: 'Account Application'
```

Key points:

| Field | Description |
|---|---|
| `job_name` | Logical name for the scrape job; appears as a label in all collected metrics. |
| `metrics_path` | Must match the `base-path` defined in each service's `application.yaml`. |
| `targets` | Uses Docker service hostnames (`gateway`, `auth`, `account`) and the internal port `8080`. |
| `scrape_interval` | How often Prometheus pulls fresh metrics from each target. |

Once the stack is running, access the Prometheus UI to query metrics directly:

[http://localhost:9090/](http://localhost:9090/){target="_blank" .md-button}

---

## 4. Grafana

[Grafana](https://grafana.com){target="_blank"} connects to Prometheus as a datasource and provides rich, interactive dashboards for visualizing the collected metrics.

Create the datasource provisioning file at `setup/grafana/provisioning/datasources/datasources.yml`:

``` { .yaml .copy .select linenums="1" }
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
```

Grafana loads this file automatically on startup, connecting it to the Prometheus instance on the internal Docker network — no manual UI configuration needed.

Once the stack is running, open Grafana in the browser:

[http://localhost:3000/](http://localhost:3000/){target="_blank" .md-button}

Login with the default credentials:

| Field    | Value   |
|----------|---------|
| Username | `admin` |
| Password | `admin` |

!!! tip "Dashboard Marketplace"

    Grafana provides a large library of pre-built dashboards for common stacks. For Spring Boot and Micrometer metrics, a solid starting point is the **JVM (Micrometer)** dashboard (ID `4701`).

    To import it: go to **Dashboards → Import**, enter ID `4701`, and select the Prometheus datasource.

    Browse the full library at [grafana.com/grafana/dashboards](https://grafana.com/grafana/dashboards/){target="_blank"}.

---

## 5. Run

Rebuild and start the full stack:

``` { .bash .copy .select }
docker compose up -d --build
```

Verify that all services — including `prometheus` and `grafana` — are running:

``` { .bash .copy .select }
docker compose ps -a
```

Expected output should show all containers with status `running`. If `prometheus` fails to start, double-check that `setup/prometheus/prometheus.yml` exists and is correctly formatted.

To confirm metrics are being scraped, open the Prometheus UI, navigate to **Status → Targets**, and verify that `gateway`, `auth`, and `account` all show state `UP`.

---

Done! The microservices are now fully observable. Navigate to Grafana, import a dashboard, and start monitoring request rates, JVM memory, response latencies, and error rates across the entire platform.
