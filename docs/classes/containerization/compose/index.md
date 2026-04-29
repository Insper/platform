
**Docker Compose** is a tool for defining and running multi-container applications using a **declarative YAML file**. Instead of running multiple `docker run` commands with flags, you describe the entire application stack — services, networks, volumes, environment variables — in a single `compose.yaml`, and start everything with one command.

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
    image: postgres:16-alpine
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

``` mermaid
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

---

## Environment variables

Hard-coding credentials inside `compose.yaml` is a security risk and prevents environment-specific configuration. Use `.env` files instead:

``` { .yaml title="compose.yaml" }
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-myapp}       # (1)!
      POSTGRES_USER: ${POSTGRES_USER:-myapp}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}   # (2)!
    volumes:
      - ${VOLUME:-./data}/db:/var/lib/postgresql/data
    ports:
      - "5432:5432"                             # (3)!
```

1. `:-myapp` is the **default value** if `POSTGRES_DB` is not set in the environment or `.env` file. See [Compose interpolation docs](https://docs.docker.com/reference/compose-file/interpolation/){target='_blank'}.
2. No default — Compose will fail loudly if this variable is missing, preventing silent misconfiguration.
3. In production, remove this port mapping so the database is only reachable inside the Compose network.

``` { .env title=".env" }
POSTGRES_DB=myapp_prod
POSTGRES_USER=myapp
POSTGRES_PASSWORD=S3cr3t!
VOLUME=/data/myapp
```

When you run `docker compose up`, Compose automatically reads `.env` from the same directory as `compose.yaml`.

!!! warning "Never commit `.env` to version control"
    Add `.env` to `.gitignore`. Each environment (development, staging, production) should have its own `.env` file, kept outside the repository. Committing credentials — even to a private repo — is a security incident waiting to happen.

---

## Health checks and dependency ordering

`depends_on` ensures a service starts after its dependencies, but does not wait for the dependency to be *ready* (e.g., the database to finish initialising). Use `healthcheck` for that:

``` { .yaml title="compose.yaml" }
services:
  db:
    image: postgres:16-alpine
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
| **Use case** | Production data, databases | Dev: hot-reload source, seed scripts |

---

## Full example

``` { .yaml title="compose.yaml" }
--8<-- "docs/classes/containerization/compose-example.yaml"
```

Try it:

``` shell
docker compose up -d --build  # (1)!
```

1. `-d` runs the containers in detached mode.<br>`--build` forces a rebuild of images before starting.

Access the web service at [http://localhost:80](http://localhost:80){:target="_blank"} and verify all containers are running with `docker compose ps`.

---

[^1]: [Docker Compose Documentation](https://docs.docker.com/compose/){:target="_blank"}
[^2]: [Compose File Reference](https://docs.docker.com/reference/compose-file/){:target="_blank"}
[^3]: [Docker Networking](https://docs.docker.com/engine/network/){:target="_blank"}
