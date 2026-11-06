---
marp: true
lang: en
title: Hands-on 6 — Observability
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

<div class="kicker">Platforms, Microservices, DevOps and APIs · Hands-on 6</div>

# Hands-on 6 — Observability

**Let every service expose its metrics, scrape them with Prometheus, see them in Grafana**

<!--
Outline: (1) why observability; (2) Actuator + Micrometer in each service; (3) Prometheus and Grafana
in Docker Compose; (4) scrape and datasource config; (5) dashboards; (6) run, verify, pitfalls.
-->

---

## A request is slow. Where?

<div class="q">

The platform has a load balancer, a gateway, `auth` and `account`, each in its own container.
A user reports that requests are slow. **How do you find out which service is the problem?**

</div>

* Without data from inside each service, you can only **guess**.
* You need **metrics over time**: request rates, latencies, error rates, JVM memory.
* And they must be collected **from every service, in one place**.

<!--
Let the class answer first. The point: in a distributed system, "look at the logs of the server"
no longer works — there are many servers.
-->

---

## The three pillars

| Pillar | What it is |
|---|---|
| **Logging** | structured records of events occurring within each service |
| **Monitoring** | continuous collection and visualization of metrics over time |
| **Tracing** | the end-to-end lifecycle of a single request across services |

<div class="ok">

This hands-on focuses on **monitoring**: Spring Boot **Actuator** → **Prometheus** → **Grafana**.

</div>

---

## Architecture

<div class="flow" style="align-items: stretch">
<div class="group">
<div class="caption">trusted layer · Actuator + Micrometer</div>
<div class="box">gateway<small>/gateway/actuator/prometheus</small></div>
<div class="box">auth<small>/auth/actuator/prometheus</small></div>
<div class="box">account<small>/accounts/actuator/prometheus</small></div>
</div>
<div class="arrow" style="align-self: center">← scrape<br>every 1s</div>
<div class="box accent" style="flex: .7; display: flex; flex-direction: column; justify-content: center">Prometheus :9090<small>pulls the metrics, stores time series</small></div>
<div class="arrow" style="align-self: center">← queries</div>
<div class="box green" style="flex: .6; display: flex; flex-direction: column; justify-content: center">Grafana :3000<small>draws dashboards</small></div>
</div>

<p class="small">The observability layer sits alongside the trusted layer; clients still enter through the load balancer on port 80.</p>

---

## The steps

1. **Microservices** — add the Actuator and Prometheus registry dependencies, expose the endpoint.
2. **Docker Compose** — add the `prometheus` and `grafana` services.
3. **Prometheus** — `prometheus.yml` with one scrape job per service.
4. **Grafana** — provision Prometheus as the datasource, import a dashboard.
5. **Run** — rebuild the stack and check that every target is `UP`.

---

## 1 · Dependencies (each service)

In the `pom.xml` of `gateway-service`, `auth-service` and `account-service`:

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-registry-prometheus</artifactId>
    <scope>runtime</scope>
</dependency>
```

<p class="small">Actuator: production-ready endpoints (health, metrics). Micrometer registry: exports them in the Prometheus text format.</p>

---

## 1 · Expose the endpoint

<div class="cols">
<div>

```yaml
# gateway-service application.yaml
management:
  endpoints:
    web:
      base-path: /gateway/actuator
      exposure:
        include: ['prometheus']
```

</div>
<div>

| Service | Endpoint |
|---|---|
| gateway | `/gateway/actuator/prometheus` |
| auth | `/auth/actuator/prometheus` |
| account | `/accounts/actuator/prometheus` |

</div>
</div>

- Each service uses **its own context prefix**: no conflicts, no internal ports exposed.
- The gateway also sets `spring.cloud.gateway.metrics.enabled: true`.

---

<!-- _class: tight -->

## 2 · Docker Compose

```yaml
  prometheus:
    image: prom/prometheus:latest
    ports:
      - 9090:9090
    volumes:
      - $SETUP/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml
  grafana:
    image: grafana/grafana-enterprise
    ports:
      - 3000:3000
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - $SETUP/grafana:/var/lib/grafana
      - $SETUP/grafana/provisioning/datasources:/etc/grafana/provisioning/datasources
```

- `.env`: `SETUP=./setup` — the folder with all external config (`setup/prometheus/`, `setup/grafana/`).
- Both share the **same Docker network** as the microservices, so Prometheus reaches them **by hostname**.

---

## 3 · Prometheus scrapes (pull)

`setup/prometheus/prometheus.yml` — one job per service:

```yaml
scrape_configs:
  - job_name: 'GatewayMetrics'
    metrics_path: '/gateway/actuator/prometheus'
    scrape_interval: 1s
    static_configs:
      - targets:
        - gateway:8080
        labels:
          application: 'Gateway Application'
```

<p class="small">Same for <code>AuthMetrics</code> (<code>auth:8080</code>) and <code>AccountMetrics</code> (<code>account:8080</code>).</p>

---

## The fields that matter

| Field | Meaning |
|---|---|
| `job_name` | logical name; becomes a label on every metric |
| `metrics_path` | **must match** the `base-path` in the service's `application.yaml` |
| `targets` | Docker hostnames (`gateway`, `auth`, `account`) and internal port `8080` |
| `scrape_interval` | how often Prometheus pulls fresh metrics |

<div class="ok">

Prometheus **pulls**: the services do not know Prometheus exists — they only expose an endpoint.

</div>

---

## From a counter to requests per second

<div class="flow">
<div class="box">service<small>counts every request: http_server_requests_seconds_count</small></div><div class="arrow">scrape →</div>
<div class="box accent">samples<small>1s apart: 1180, 1191, 1202…</small></div><div class="arrow">rate([1m]) →</div>
<div class="box green">11 req/s<small>the counter's increase ÷ the window's seconds</small></div>
</div>

- `up` = 1 when the last scrape answered, 0 otherwise: the same as **Status → Targets**.
- `rate()` needs **two samples** in the window: keep it ≥ 4 × `scrape_interval`.
- The scrapes count too: an idle service shows **1 req/s**, Prometheus itself.

<!--
The Prometheus page has the queries (up, the counter, rate, sum by job) and the simulator.
-->

---

## 4 · Grafana datasource

`setup/grafana/provisioning/datasources/datasources.yml`:

```yaml
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    uid: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
```

Loaded **automatically on startup** — no manual UI setup. Open `http://localhost:3000`, login `admin` / `admin`.

---

## 4 · Dashboards

- Import a pre-built one: **Dashboards → Import**, ID `4701` (**JVM (Micrometer)**) or `12900` (**SpringBoot APM**).
- Select the provisioned Prometheus datasource.
- If panels stay empty: **Dashboard → Edit → Settings → Variables**, create `DS_PROMETHEUS`, type `Constant`, value `prometheus` (the `uid` in `datasources.yml`).
- Then watch request rates, JVM memory, response latencies and error rates.

<p class="small">More dashboards at grafana.com/grafana/dashboards.</p>

---

## 5 · Run and verify

```bash
docker compose up -d --build
docker compose ps -a
```

- Every container, including `prometheus` and `grafana`, should be `running`.
- Prometheus UI `http://localhost:9090` → **Status → Targets**: `gateway`, `auth` and `account` all `UP`.
- Grafana: import a dashboard and see the panels populate.

<!--
Show the Targets page live: it is the quickest way to see whether the scrape config is right.
-->

---

## Common pitfalls

<div class="flow">
<div class="box">metrics_path<small>/actuator/prometheus</small></div><div class="arrow">≠</div>
<div class="box">base-path + /prometheus<small>/accounts/actuator/prometheus</small></div><div class="arrow">→</div>
<div class="box red">404 Not Found<small>the target shows DOWN</small></div>
</div>

- `prometheus` does not start → check that `setup/prometheus/prometheus.yml` exists and is valid YAML.
- Targets must use the **Docker hostnames**, not `localhost` (inside a container, that is the container itself).
- Dashboard empty → the `DS_PROMETHEUS` variable does not point to the `prometheus` datasource.
- Only `prometheus` is in `exposure.include`: other Actuator endpoints stay closed.

---

## Without Docker: the simulator

<div class="flow">
<div class="box accent">0 req/s → rate 1<small>the scrapes are requests</small></div>
<div class="box green">10 req/s → 11<small>gateway, auth and account</small></div>
<div class="box orange">15s and [5s]<small>fewer than two samples: empty</small></div>
<div class="box red">stop account<small>up = 0; a wrong path: 404</small></div>
</div>

- The Prometheus page embeds the lab's three jobs: same paths, same 1s interval.
- Move the traffic, the interval and the window; stop a service or break its `metrics_path`.

<!--
The simulator sits in "Query the metrics", on the Prometheus page.
-->

---

## Takeaways

1. Observability has three pillars: **logging**, **monitoring**, **tracing** — this hands-on does monitoring.
2. **Actuator + Micrometer** turn each Spring Boot service into a metrics endpoint.
3. Each service exposes `/<context>/actuator/prometheus` under **its own prefix**.
4. **Prometheus pulls** metrics on a schedule (`scrape_interval`), one job per service.
5. **Grafana** reads Prometheus through a **provisioned datasource** and pre-built dashboards.
6. Verify with **Status → Targets**: every service must be `UP`.
