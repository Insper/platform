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
