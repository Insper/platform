Click **"Answer"** to reveal the correct answer and explanation.

---

## Observability

**Q1.** What are the **three pillars of observability** covered in this course?

- A. Deployment, Scaling, Recovery
- B. Metrics, Dashboards, Notifications
- C. Logging, Monitoring (metrics), and Tracing
- D. CPU, Memory, and Network utilisation

??? success "Answer"
    **C — Logging, Monitoring (metrics), Tracing.**

    Logs record discrete events ("Request received for account 42"). Metrics track aggregated numerical values over time (requests/sec, P99 latency). Traces follow a single request across multiple services. Together they answer: *what happened?* (logs), *how much / how fast?* (metrics), *where did it go?* (traces).

---

**Q2.** What does **Prometheus** do in this observability stack?

- A. It renders dashboards and visualises metrics collected by Grafana
- B. It injects distributed trace IDs into each microservice request
- C. It periodically scrapes each service's `/actuator/prometheus` endpoint and stores the collected time-series metrics
- D. It aggregates structured log lines from each container into a searchable index

??? success "Answer"
    **C — Scrapes metrics endpoints and stores time-series data.**

    Prometheus uses a *pull* model: at each scrape interval (e.g., every 1 second), it sends an HTTP GET to each configured target (`gateway:8080/gateway/actuator/prometheus`) and stores the returned metrics as time-series. This is the opposite of a push model where services send metrics to the collector.

---

**Q3.** Why does each microservice use a **different `base-path`** for its actuator endpoint?

- A. Spring Boot requires unique actuator paths when multiple services share the same JVM
- B. All services route through the same gateway port; unique prefixes prevent URL path conflicts when Prometheus scrapes each service through the gateway
- C. Prometheus cannot scrape two services at the same path simultaneously
- D. Different paths allow role-based access control per service actuator endpoint

??? success "Answer"
    **B — Prevent URL conflicts when scraping through the gateway.**

    Without unique prefixes, Prometheus would GET `/actuator/prometheus` on `gateway:8080` and get the gateway's metrics. But the gateway also routes `/actuator/prometheus` to account — they clash. With `base-path: /gateway/actuator` and `base-path: /accounts/actuator`, Prometheus can scrape each service at a distinct path through the same port 80.

---

**Q4.** What does **Grafana** add on top of Prometheus?

- A. It replaces Prometheus as the metrics collector for lower latency
- B. It stores metrics in a relational database for SQL-based querying
- C. It provides interactive dashboards, a PromQL query UI, and alerting rules on top of the metrics stored in Prometheus
- D. It automatically generates SLO compliance reports

??? success "Answer"
    **C — Dashboards, PromQL UI, and alerting.**

    Prometheus stores and queries metrics. Grafana visualises them: time-series graphs, gauges, heatmaps, and tables. It connects to Prometheus as a datasource and lets you build dashboards with PromQL queries. Grafana also supports alerting rules that fire when metrics cross thresholds.

---

**Q5.** Which two dependencies must be added to each Spring Boot microservice to export Prometheus metrics?

- A. `spring-boot-starter-web` and `grafana-spring-boot-starter`
- B. `spring-boot-starter-actuator` and `micrometer-registry-prometheus`
- C. `spring-boot-starter-data-jpa` and `prometheus-client`
- D. `spring-cloud-starter-sleuth` and `micrometer-tracing`

??? success "Answer"
    **B — `spring-boot-starter-actuator` + `micrometer-registry-prometheus`.**

    Actuator enables management endpoints including `/actuator/health`, `/actuator/info`, and — with the right configuration — `/actuator/prometheus`. Micrometer is Spring Boot's metrics abstraction layer; the `micrometer-registry-prometheus` dependency tells Micrometer to export metrics in Prometheus' text format.

---
