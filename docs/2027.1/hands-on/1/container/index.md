The last step packages `catalog` as an **image** and runs it next to PostgreSQL with **Docker Compose**. From now on, "running BoxOffice" always means one command: `docker compose up`.

``` diagram
flowchart LR
    term(["your terminal<br/>curl · k6"]) -->|localhost:8082| catalog
    subgraph compose["docker compose project: boxoffice"]
        catalog["catalog<br/>eclipse-temurin:21-jre<br/>1 CPU · 768 MB"] -->|db:5432| db[("db<br/>postgres:17")]
        db --- vol[("volume db-data")]
    end
```

## 1. Dockerfile

A **multi-stage** build: the first stage has the JDK and Maven and compiles the jar; the second has only a JRE and the jar. The final image is smaller, has no compiler and does not need Maven on the machine that builds it.

``` { .dockerfile title="services/catalog/Dockerfile" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/1/code/services/catalog/Dockerfile"
```

``` { .text title="services/catalog/.dockerignore" .copy }
--8<-- "docs/2027.1/hands-on/1/code/services/catalog/.dockerignore"
```

| Line | Why |
|---|---|
| `--mount=type=cache,target=/root/.m2` | BuildKit keeps the Maven repository between builds: the first build downloads the dependencies (a few minutes), the next ones take seconds |
| `useradd` + `USER app` | the process does not run as root inside the container |
| `-XX:MaxRAMPercentage=75` | the JVM sizes its heap from the **container** memory limit, not from your laptop's RAM |
| `.dockerignore` | a local `target/` folder is never sent to the build |

## 2. docker-compose.yaml

Create it at the **root** of the repository:

``` { .yaml title="docker-compose.yaml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/1/code/docker-compose.yaml"
```

| Setting | Why |
|---|---|
| `name: boxoffice` | fixed project name: containers are `boxoffice-db-1`, `boxoffice-catalog-1`, … on every machine |
| `db.healthcheck` + `depends_on: condition: service_healthy` | `catalog` starts only when PostgreSQL accepts connections; otherwise Flyway fails at startup |
| `volumes: db-data` | the data survives `docker compose down`; `down -v` erases it |
| `deploy.resources.limits` | **1 CPU and 768 MB** per `catalog`: a fixed, small "server", so that measurements are comparable and scaling out in lab 3 is visible |
| `catalog.healthcheck` | Compose marks the container `healthy` only when `/actuator/health/readiness` answers (the JRE image has `wget`, not `curl`) |

## 3. Run it

``` { .bash .copy }
docker compose up --build -d
docker compose ps
docker compose logs -f catalog
```

<!-- termynal -->
``` shell
> docker compose up --build -d
 Image boxoffice-catalog Built
 Container boxoffice-db-1 Healthy
 Container boxoffice-catalog-1 Started
> docker compose logs catalog | grep -E "Migrating|Successfully|Started"
Migrating schema "catalog" to version "1 - create catalog"
Migrating schema "catalog" to version "2 - seed catalog"
Successfully applied 2 migrations to schema "catalog", now at version v2 (execution time 00:01.204s)
Started CatalogApplication in 10.4 seconds (process running for 11.178)
```

Now call the API:

<!-- termynal -->
``` shell
> curl -s localhost:8082/catalog/events/1 | jq
{
  "id": 1,
  "title": "BoxOffice Fest — Stadium Night",
  "category": "FESTIVAL",
  "startsAt": "2027-06-12T23:00:00Z",
  "priceFrom": 250.00,
  "venue": { "id": 1, "name": "Stadium São Paulo", "city": "São Paulo", "capacity": 60000 }
}
> curl -s "localhost:8082/catalog/events?city=Recife&size=2" | jq -c '{page, totalItems, first: .items[0].title}'
{"page":0,"totalItems":20000,"first":"Concert #12"}
> curl -s localhost:8082/catalog/events/999999
{"detail":"event 999999 not found","instance":"/catalog/events/999999","status":404,"title":"Not Found"}
```

Create a venue and an event, then break the rules on purpose:

``` { .bash .copy }
# 201 Created + Location header
curl -i -X POST localhost:8082/catalog/venues -H 'Content-Type: application/json' \
  -d '{"name":"Arena Insper","city":"São Paulo","capacity":800}'

curl -i -X POST localhost:8082/catalog/events -H 'Content-Type: application/json' \
  -d '{"title":"Systems Rock","category":"CONCERT","venueId":51,"startsAt":"2027-09-01T21:00:00-03:00","priceFrom":120}'

# 400: missing title and negative price
curl -s -X POST localhost:8082/catalog/events -H 'Content-Type: application/json' \
  -d '{"category":"CONCERT","venueId":1,"startsAt":"2027-09-01T21:00:00-03:00","priceFrom":-1}' | jq

# 400: page size above the maximum
curl -s "localhost:8082/catalog/events?size=500" | jq
```

## 4. Look inside

``` { .bash .copy }
# the tables and the Flyway history, from inside the db container
docker compose exec db psql -U boxoffice -c '\dt catalog.*'
docker compose exec db psql -U boxoffice -c 'SELECT version, description, success FROM catalog.flyway_schema_history'

# how the listing query runs (lab 6 comes back to this)
docker compose exec db psql -U boxoffice -c "EXPLAIN ANALYZE SELECT e.* FROM catalog.events e JOIN catalog.venues v ON v.id = e.venue_id WHERE v.city = 'Recife' AND e.starts_at >= now() ORDER BY e.starts_at LIMIT 20"

# health, metrics and the OpenAPI document
curl -s localhost:8082/actuator/health | jq
curl -s localhost:8082/actuator/metrics/hikaricp.connections.max | jq '.measurements[0].value'
curl -s localhost:8082/catalog/openapi | jq '.paths | keys'
```

Open [http://localhost:8082/swagger-ui.html](http://localhost:8082/swagger-ui.html){target="_blank"} for interactive documentation generated from your controllers — the same OpenAPI document can generate clients in other languages.

## 5. Everyday commands

| Command | Effect |
|---|---|
| `docker compose up --build -d` | rebuild what changed and start everything in the background |
| `docker compose logs -f catalog` | follow one service's logs |
| `docker compose restart catalog` | restart without rebuilding |
| `docker compose down` | stop and remove containers (data kept in `db-data`) |
| `docker compose down -v` | …and erase the database volume (Flyway seeds again on the next start) |
| `docker stats` | live CPU and memory per container — keep it open during load tests |

!!! warning "Pitfalls"

    - **Port 5432 already allocated**: a local PostgreSQL is running; stop it or map `"15432:5432"`.
    - **`Connection refused` from catalog to `localhost:5432`**: inside a container, the database is `db`, not `localhost` — check `DB_HOST`.
    - **Changed a migration that already ran** → `Validate failed: Migrations have failed validation`. Restore the file and add a new version, or (on your laptop only) `docker compose down -v`.
    - **Apple Silicon / ARM**: all images used in the labs are multi-architecture; do not add `platform: linux/amd64`.

Back to the [lab overview](../index.md#measure-it) to measure it.
