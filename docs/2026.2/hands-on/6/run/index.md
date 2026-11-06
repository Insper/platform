
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

## Troubleshooting { #troubleshooting }

| Symptom | Cause | Fix |
|---|---|---|
| ❌ target **DOWN**, *server returned HTTP status 404* | `metrics_path` ≠ the service's `base-path` + `/prometheus` | make the two match exactly ([Microservices](../microservices/index.md)) |
| ❌ target **DOWN**, *no such host* or *connection refused* | the service is not running, or the target says `localhost` | start it; inside a container `localhost` is the container itself, so use the Docker hostnames (`gateway:8080`…) |
| ❌ `prometheus` does not start | `setup/prometheus/prometheus.yml` missing or invalid YAML | check the file and the `$SETUP` path in `.env` |
| ⚠️ dashboard panels empty | the `DS_PROMETHEUS` variable does not point to the datasource | create it as a constant with value `prometheus`, the `uid` in `datasources.yml` ([Grafana](../grafana/index.md)) |
| ✅ only `/…/actuator/prometheus` answers | `exposure.include: ['prometheus']` | expected: the other Actuator endpoints stay closed |

---

Done! The microservices are now fully observable. Navigate to Grafana, import a dashboard, and start monitoring request rates, JVM memory, response latencies, and error rates across the entire platform.
