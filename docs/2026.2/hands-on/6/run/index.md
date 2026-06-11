
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
