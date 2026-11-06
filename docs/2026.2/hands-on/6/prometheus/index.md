
[Prometheus](https://prometheus.io){target="_blank"} works by **pulling** (`scraping`) metrics from each service endpoint at a configured interval and storing the time-series data locally.

Create the file `setup/prometheus/prometheus.yml`:

``` { .yaml .copy .select linenums="1" title="prometheus.yml" }
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

Prometheus **pulls**: the services do not know Prometheus exists, they only expose an endpoint. Every `scrape_interval`, Prometheus sends a `GET` to each target, reads the current value of every metric and stores it as a sample with a timestamp; Grafana then asks Prometheus, never the services:

``` mermaid-sim
sequenceDiagram
    participant P as Prometheus
    participant G as gateway:8080
    participant A as auth:8080
    participant C as account:8080
    participant Gr as Grafana
    loop every scrape_interval, 1s here
        P->>G: GET /gateway/actuator/prometheus
        G-->>P: http_server_requests_seconds_count 1234
        P->>A: GET /auth/actuator/prometheus
        A-->>P: http_server_requests_seconds_count 987
        P->>C: GET /accounts/actuator/prometheus
        C-->>P: http_server_requests_seconds_count 1010
    end
    Gr->>P: query, rate over the last minute
    P-->>Gr: requests per second, one series per job
```

Once the stack is running, access the Prometheus UI to query metrics directly:

[http://localhost:9090/](http://localhost:9090/){target="_blank" .md-button}

## Query the metrics { #promql }

Type these in the **Query** tab, written in the Prometheus Query Language (PromQL):

| Query | What it shows |
|---|---|
| `up` | `1` for every target the last scrape reached, `0` for the others — the same as **Status → Targets** |
| `http_server_requests_seconds_count` | the **counter** of requests each service has served since it started (one series per `uri`, `method` and `status`) |
| `rate(http_server_requests_seconds_count[1m])` | how fast the counter grew over the last minute: **requests per second** |
| `sum by (job) (rate(http_server_requests_seconds_count[1m]))` | the same, added up per job: one line per service, as a Grafana panel draws it |

A counter only goes up (and back to `0` when the service restarts); `rate()` turns it into something you can read. It needs **at least two samples** inside the window, so the window must be several times the `scrape_interval` — a common rule is 4 ×: with the lab's `1s`, `[5s]` already works; with the Prometheus default of `1m`, `[1m]` is empty. The scrapes are requests too: each one adds 1 to the counter of the service it reads.

<div class="csim" data-sim="prom-scrape"></div>

!!! tip "Try it"

    Press play. At 0 req/s the rate is 1, not 0: each scrape is a request to `/…/actuator/prometheus`, one per second. At 10 req/s of secured requests, every job shows 11; a login (`POST /auth/login`) never reaches account, which stays at 1. Set `scrape_interval` to 15s and the window to `[5s]`: fewer than two samples, so `rate()` is empty; `[1m]` works again. Stop account: at the next scrape it gets `up = 0` and its line fades out of the 1-minute window; a wrong `metrics_path` makes the target answer 404.
