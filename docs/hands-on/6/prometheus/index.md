
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

Once the stack is running, access the Prometheus UI to query metrics directly:

[http://localhost:9090/](http://localhost:9090/){target="_blank" .md-button}
