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

-   :material-server-network:{ .lg .middle } **[Microservices](./microservices/)**

    ---

    Add Actuator and Prometheus registry dependencies to each Spring Boot service and expose the metrics endpoint.

    [Microservices](./microservices/){ .md-button }

-   :material-file-code:{ .lg .middle } **[Docker Compose](./docker/)**

    ---

    Add Prometheus and Grafana services to the `docker compose.yaml` file, ensuring they are on the same network as the microservices.

    [Docker Compose](./docker/){ .md-button }

-   :material-chart-timeline-variant:{ .lg .middle } **[Prometheus](./prometheus/)**

    ---

    Deploy Prometheus via Docker Compose and configure it to scrape metrics from each microservice.

    [Prometheus](./prometheus/){ .md-button }

-   :material-chart-areaspline:{ .lg .middle } **[Grafana](./grafana/)**

    ---

    Deploy Grafana via Docker Compose, connect it to Prometheus, and explore pre-built dashboards.

    [Grafana](./grafana/){ .md-button }

-   :material-play-circle:{ .lg .middle } **[Run](./run/)**

    ---

    Rebuild and start the full stack using Docker Compose, then verify that all services are running and metrics are being scraped.

    [Run](./run/){ .md-button }

</div>
