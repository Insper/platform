
Running the account service and its database with plain `docker` commands already takes a handful of long command lines, and the order matters:

``` bash
docker network create store
docker volume create db-data
docker run -d --name db --network store \
  -e POSTGRES_DB=store -e POSTGRES_USER=store -e POSTGRES_PASSWORD=secret \
  -v db-data:/var/lib/postgresql/data postgres:17
docker build -t store/account ./account-service
docker run -d --name account --network store -p 8080:8080 \
  -e SPRING_DATASOURCE_URL=jdbc:postgresql://db:5432/store store/account
```

Add a gateway, an auth service, Redis and Kafka, and this becomes an error-prone script that every developer must keep in their head — and that nobody can review in a pull request. Docker Compose replaces it with a file.

**Docker Compose** is a tool for defining and running multi-container applications using a **declarative YAML file**[^1]. Instead of running multiple `docker run` commands with flags, you describe the entire application stack — services, networks, volumes, environment variables — in a single `compose.yaml`, and start everything with one command.

---

## Basic structure

``` { .yaml title="compose.yaml" }
name: myapp

services:
  web:
    build: ./web          # build from a local Dockerfile
    ports:
      - "80:80"
    depends_on:
      - app

  app:
    build: ./app
    environment:
      - SPRING_DATASOURCE_URL=jdbc:postgresql://db:5432/myapp
    depends_on:
      - db

  db:
    image: postgres:17
    environment:
      POSTGRES_DB: myapp
      POSTGRES_USER: myapp
      POSTGRES_PASSWORD: secret
    volumes:
      - db-data:/var/lib/postgresql/data

volumes:
  db-data:
```

All services share a default bridge network. Each service is reachable from other services using its **service name as the hostname** (`db`, `app`, `web`).

``` mermaid-sim
flowchart LR
    user[User] -->|HTTP :80| web[Web]
    subgraph myapp [172.18.0.0/16]
        web
        app[App]
        db[(Database :5432)]
    end
    web -->|API| app
    app -->|JDBC| db
```

The vocabulary of a Compose file[^2]:

| Key | Meaning |
|---|---|
| `name` | The **project** name; prefixes containers, networks and volumes (`myapp-db-1`, `myapp_db-data`) |
| `services` | One entry per container to run. Each service is a template: you can run several replicas of it |
| `image` | Use an existing image from a registry (`postgres:17`) |
| `build` | Build the image from a local Dockerfile (path to the build context) |
| `ports` | Publish `host:container` ports to your machine — only what you need to reach from outside |
| `environment` | Environment variables passed to the container |
| `depends_on` | Start order between services |
| `volumes` | Named volumes or bind mounts; top-level `volumes:` declares the named ones |

!!! info "`docker compose`, not `docker-compose`; and no `version:`"
    Compose v2 is a plugin of the Docker CLI: the command is `docker compose` (with a space). The old Python `docker-compose` (v1) is no longer supported since 2023. The top-level `version: "3.8"` key you see in older tutorials is obsolete — Compose ignores it and prints a warning. The preferred file name is `compose.yaml`; `docker-compose.yml` is still accepted.

---

## Key commands

| Command | Description |
|:-|:-|
| `docker compose up` | Create and start all services |
| `docker compose up -d` | Start in detached (background) mode |
| `docker compose up --build` | Rebuild images before starting |
| `docker compose down` | Stop and remove containers and networks |
| `docker compose down -v` | Also remove named volumes |
| `docker compose logs -f` | Follow logs from all services |
| `docker compose logs -f app` | Follow logs from a specific service |
| `docker compose ps` | List running services |
| `docker compose exec app sh` | Open a shell in a running service |
| `docker compose restart app` | Restart a single service |
| `docker compose config` | Print the final file, with all `${VARIABLES}` resolved — the first thing to check when a value looks wrong |

---

## Networking: service names, not `localhost`

Compose creates one network per project and registers every service in Docker's embedded DNS[^3]. Inside that network, services talk to each other on their **container port** using the **service name**; the `ports:` mapping only matters for traffic coming from your machine.

| From | To the database | URL |
|---|---|---|
| The `app` container | `db` service | `jdbc:postgresql://db:5432/myapp` |
| Your laptop (IDE, `psql`, DBeaver) | published port | `jdbc:postgresql://localhost:5432/myapp` (only if `ports: - 5432:5432`) |

!!! warning "The most common Compose bug: `localhost`"
    A service configured with `localhost:5432` works when you run it from the IDE and fails as soon as it runs inside Compose, with *Connection refused*: inside a container, `localhost` is the container itself. Use the service name (`db`) and pass the URL through an environment variable, so the same image works in both places.

This is also how the store keeps services private: in [Hands-on 2](../../../hands-on/2/index.md) only the gateway publishes a port; the other services are reachable only from inside the Compose network.

---

## Environment variables

Hard-coding credentials inside `compose.yaml` is a security risk and prevents environment-specific configuration. Use `.env` files instead:

``` { .yaml title="compose.yaml" }
services:
  db:
    image: postgres:17
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-myapp}       # (1)!
      POSTGRES_USER: ${POSTGRES_USER:-myapp}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set it in .env}   # (2)!
    volumes:
      - ${VOLUME:-./data}/db:/var/lib/postgresql/data
    ports:
      - "5432:5432"                             # (3)!
```

1. `:-myapp` is the **default value** if `POSTGRES_DB` is not set in the environment or `.env` file. See [Compose interpolation docs](https://docs.docker.com/reference/compose-file/interpolation/){target='_blank'}.
2. `:?` makes Compose **fail loudly** with that message if the variable is missing or empty. A plain `${POSTGRES_PASSWORD}` without a default would only print a warning and substitute an empty string.
3. In production, remove this port mapping so the database is only reachable inside the Compose network.

``` { .env title=".env" }
POSTGRES_DB=myapp_prod
POSTGRES_USER=myapp
POSTGRES_PASSWORD=S3cr3t!
VOLUME=/data/myapp
```

When you run `docker compose up`, Compose automatically reads `.env` from the project directory (the folder of `compose.yaml`). Variables already set in your shell take precedence over the values in `.env`.

!!! info "`.env` versus `env_file:`"
    The `.env` file is used for **interpolation**: it fills the `${...}` placeholders in `compose.yaml` and is **not** passed to the containers by itself. To inject every variable of a file into a container, use `env_file:` in the service:

    ``` yaml
    services:
      account:
        env_file: account.env   # every KEY=value becomes an environment variable of the container
    ```

!!! warning "Never commit `.env` to version control"
    Add `.env` to `.gitignore`. Each environment (development, staging, production) should have its own `.env` file, kept outside the repository. Committing credentials — even to a private repo — is a security incident waiting to happen. Commit a `.env.example` with placeholder values instead, so others know which variables to set.

---

## Health checks and dependency ordering

`depends_on` ensures a service starts after its dependencies, but does not wait for the dependency to be *ready* (e.g., the database to finish initialising). Use `healthcheck` for that:

``` { .yaml title="compose.yaml" }
services:
  db:
    image: postgres:17
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U myapp"]
      interval: 5s
      timeout: 5s
      retries: 5

  app:
    build: ./app
    depends_on:
      db:
        condition: service_healthy    # wait until db passes healthcheck
```

``` mermaid-sim
sequenceDiagram
    participant C as docker compose up
    participant DB as db
    participant A as app
    C->>DB: start container
    DB-->>C: running (still initialising)
    C->>DB: healthcheck: pg_isready
    DB-->>C: unhealthy, retry in 5 s
    C->>DB: healthcheck: pg_isready
    DB-->>C: healthy
    C->>A: start container
    A->>DB: connect on db:5432
```

Without `condition: service_healthy`, `app` would start right after `db` is *running* and could crash with a connection error while PostgreSQL is still creating its files. Adding `restart: on-failure` (or `unless-stopped`) to a service is a complementary safety net: if it crashes anyway, Docker starts it again.

---

## Named volumes vs. bind mounts

``` { .yaml title="compose.yaml" }
volumes:
  db-data:        # Docker-managed named volume — data persists across `down`

services:
  db:
    volumes:
      - db-data:/var/lib/postgresql/data     # named volume (production)
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql  # bind mount (seed data)
```

| | Named volume | Bind mount |
|---|---|---|
| **Data location** | Managed by Docker | Host path you specify |
| **Persistence** | Survives `docker compose down` | Survives (it's your host path) |
| **Removed by `down -v`** | Yes — data is deleted | No — the host folder stays |
| **Use case** | Production data, databases | Dev: hot-reload source, seed scripts |

!!! note "Init scripts run only once"
    The PostgreSQL image runs the scripts in `/docker-entrypoint-initdb.d/` **only when the data directory is empty**. If you change `init.sql` but the volume already holds data, nothing happens — remove the volume (`docker compose down -v`) to re-initialise.

---

## Full example

``` { .yaml title="compose.yaml" }
--8<-- "docs/2026.2/classes/containerization/compose-example.yaml"
```

Try it:

``` shell
docker compose up -d --build  # (1)!
```

1. `-d` runs the containers in detached mode.<br>`--build` forces a rebuild of images before starting.

Access the web service at [http://localhost:80](http://localhost:80){:target="_blank"} and verify all containers are running with `docker compose ps`.

---

## Limits of Compose

Compose runs everything on **one host**. It does not spread containers across machines, does not reschedule them when a host dies, and does not perform rolling updates. It is ideal for development, CI and small single-server deployments; for a cluster, the same images are run by an orchestrator such as Kubernetes ([Hands-on 5](../../../hands-on/5/index.md)).

!!! warning "Common mistakes"
    - **`depends_on` without a health check**, then debugging "random" startup failures.
    - **`docker compose down -v` on a database you care about** — the named volume, and all its data, is gone.
    - **Publishing every port** (`5432:5432`, `6379:6379`) "just in case": each published port is a door into the stack. Publish only the entry point (the gateway).
    - **Forgetting `--build`**: `docker compose up` reuses the image it built last time, so your code change does not appear.

---

## Connections

- [Hands-on 1 — Containerization](../../../hands-on/1/containerization/index.md) — the first Compose file of the store: account service and PostgreSQL.
- [Hands-on 2](../../../hands-on/2/index.md) — the gateway as the only published entry point.
- [Hands-on 7](../../../hands-on/7/index.md), [Hands-on 8](../../../hands-on/8/index.md), [Hands-on 9](../../../hands-on/9/index.md) — adding Nginx, Redis and Kafka to the same Compose stack.
- [Hands-on 5](../../../hands-on/5/index.md) — from Compose to Kubernetes.

## Key takeaways

- `compose.yaml` declares the whole stack — services, networks, volumes, variables — and `docker compose up -d --build` starts it.
- Services reach each other by **service name** on the container port; `localhost` inside a container is the container itself.
- `.env` fills `${...}` placeholders (use `:-` for defaults, `:?` for required values) and must never be committed; `env_file:` injects variables into a container.
- `depends_on` orders the start; add a `healthcheck` and `condition: service_healthy` to wait until a dependency is **ready**.
- Named volumes survive `down` but not `down -v`; Compose is single-host — clusters need an orchestrator.

---

[^1]: [Docker Compose Documentation](https://docs.docker.com/compose/){:target="_blank"}
[^2]: [Compose File Reference](https://docs.docker.com/reference/compose-file/){:target="_blank"}
[^3]: [Docker Networking](https://docs.docker.com/engine/network/){:target="_blank"}
