---
marp: true
lang: en
title: Containerization
description: Platforms, Microservices, DevOps and APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Platforms, Microservices, DevOps and APIs · Insper</div>

# Containerization

**Package the application with everything it needs — run it identically everywhere**

<!--
Objectives: explain what a container is (namespaces, cgroups, layered filesystem) and how it differs from a VM;
write a multi-stage, cache-friendly Dockerfile for a Spring Boot service; run, inspect and debug containers;
compose a service + PostgreSQL with compose.yaml, .env and health checks; diagnose localhost, lost data,
committed secrets and latest.
Outline: (1) overview: scaling, containers vs VMs, what a container really is, the lifecycle; (2) Docker;
(3) Docker Compose; (4) containerisation in the cloud.
-->

---

## Traffic is growing

<div class="q">

Your server can no longer handle the load. What are your options — and what new problem appears?

</div>

* **Vertical scaling** (scale-up) — a bigger machine: simple, but bounded, and upgrades mean downtime.
* **Horizontal scaling** (scale-out) — more servers behind a load balancer: theoretically unbounded…
* …but with ten servers, every one must be **identical**: OS, Java version, libraries, configuration.
* *"It works on my machine"* — a **container image** packages the app **with all its dependencies** and runs the same on the laptop, the CI server and every production node.

---

<!-- _class: tight -->

## Containers vs. virtual machines

<div class="cols">
<div>

**VM**: hardware → hypervisor → **guest OS** per VM → app

</div>
<div>

**Container**: hardware → host OS + **shared kernel** → container engine → app

</div>
</div>

| Aspect | Docker containers | Virtual machines |
|---|---|---|
| **Isolation** | process-level, share the host kernel | full OS, each VM has its own kernel |
| **Overhead** | lightweight, no OS per container | a complete OS per VM |
| **Startup** | seconds | minutes (full OS boot) |
| **Portability** | high: image bundles app + dependencies | lower: OS-specific configuration |
| **Security boundary** | weaker (shared kernel) | stronger (separate kernel) |
| **Typical use** | microservices, CI/CD, scaling out | different guest OS, strong isolation |

<div class="ok">

Combined, not opposed: the cloud rents you a VM (isolation between customers) and you run several containers on it.

</div>

---

<!-- _class: tight -->

## What a container really is

Not a small VM — an ordinary **Linux process** that the kernel shows a restricted view of the machine:

| Feature | What it does | What you observe |
|---|---|---|
| **Namespaces** | own view of PIDs, network, mounts, hostname, users | your app is PID 1, with its own IP and port 8080 |
| **cgroups** | limit and account CPU, memory, I/O | `--memory 512m` → the JVM is OOM-killed above it |
| **Layered filesystem** (OverlayFS) | read-only image layers + a thin writable layer | files written inside vanish when the container is removed |

```bash
docker run --rm alpine ps          # inside: ps is PID 1, nothing else is visible
docker run -d --name pg -e POSTGRES_PASSWORD=secret postgres:17
docker top pg                      # from the host: the postgres processes, with host PIDs
```

<p class="small">macOS/Windows: Docker Desktop runs a hidden Linux VM. Images follow the <strong>OCI</strong> standard: they also run on Podman, containerd and Kubernetes (which no longer talks to Docker since 1.24).</p>

---

## The container lifecycle

Source + `Dockerfile` → **docker build** → `Image:tag` → **docker push** → `Registry` → **docker pull** → **docker run** → containers 1, 2, 3

- **Dockerfile**: how to build the image.
- **Image**: the immutable artifact — versioned, stored in a registry, pulled onto any machine.
- **Container**: a running instance — isolated, ephemeral, disposable.

<div class="ok">

**In the store**: Hands-on 1 packages the account service (`mvn package` → Dockerfile → `docker compose up --build` next to PostgreSQL); Hands-on 4 has Jenkins build and push the image; Hands-on 5 has Kubernetes pull it and run several containers.

</div>

---

## Pitfalls of the container model

- **Treating a container like a server**: `docker exec` to install packages or edit files is lost on the next deploy — change the Dockerfile and rebuild.
- **Storing data in the container**: the writable layer disappears with it — persist databases in a **volume**.
- **Shipping `latest`**: it points to whatever was pushed last — deploy `myapp:1.4.2` or a Git commit SHA, so you can roll back.
- **Assuming a container is a security boundary**: all containers share the host kernel; untrusted code needs stronger isolation (VMs).

---

<div class="kicker">Docker</div>

## From a laptop setup to an artifact

`mvn spring-boot:run` works because **your** laptop has the right JDK, Maven and variables. Docker turns the setup into a **file** (the Dockerfile) and the result into an **artifact** (the image).

| Concept | What it is |
|---|---|
| **Dockerfile** | the recipe; each `RUN` / `COPY` / `ADD` adds a read-only **layer** |
| **Image** | immutable snapshot, `name:tag` (`store/account:1.0`); no tag = `latest` |
| **Container** | running instance: shares the kernel, own filesystem, network, PIDs |
| **Registry** | stores images: Docker Hub (public); ECR, GHCR, GitLab (private) |

<p class="small">The <code>docker</code> CLI is only a client: it calls the daemon (<code>dockerd</code>), which pulls images and starts containers through containerd + runc. "Cannot connect to the Docker daemon" = nobody listening on the other side.</p>

---

## A Dockerfile

```dockerfile
# Base image — choose the smallest that fits
FROM eclipse-temurin:25-jre-alpine
WORKDIR /app
# Copy the built artifact from the host (run `mvn package` first)
COPY target/*.jar app.jar
# Documentation only
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

- The pattern of the store's services in Hands-on 1: Java 25 base, the Maven JAR, `java -jar`.
- `*.jar` matches `account-service-0.0.1-SNAPSHOT.jar` (not the `*.jar.original`); `COPY` renames it.

---

<!-- _class: tight -->

## The instructions you will use most

| Instruction | Purpose | Example |
|---|---|---|
| `FROM` | base image (always first) | `FROM eclipse-temurin:25-jre-alpine` |
| `WORKDIR` | set and create the working directory | `WORKDIR /app` |
| `COPY` | files from the build context into the image | `COPY target/*.jar app.jar` |
| `RUN` | command **at build time**, saved as a layer | `RUN apk add --no-cache curl` |
| `ENV` | variable for build and run time | `ENV SPRING_PROFILES_ACTIVE=prod` |
| `ARG` | build-time variable only | `ARG VERSION=1.0` |
| `EXPOSE` | documents the port (does **not** publish it) | `EXPOSE 8080` |
| `USER` | run as this user | `USER app` |
| `ENTRYPOINT` / `CMD` | what runs **when the container starts** | `ENTRYPOINT ["java", "-jar", "app.jar"]` |

<p class="small"><code>CMD</code> gives default arguments to <code>ENTRYPOINT</code> and is replaced by what you type after the image name. Exec form (brackets): the JVM is PID 1 and gets the <code>SIGTERM</code> of <code>docker stop</code> — graceful shutdown.</p>

---

## Multi-stage builds

```dockerfile
# Stage 1: build
FROM maven:3.9-eclipse-temurin-25 AS builder
WORKDIR /build
COPY pom.xml .
RUN mvn dependency:go-offline
COPY src ./src
RUN mvn package -DskipTests

# Stage 2: run — only the JRE, no Maven, no source
FROM eclipse-temurin:25-jre-alpine
WORKDIR /app
COPY --from=builder /build/target/*.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

<p class="small">The final image has only the JRE and the JAR — and the machine that builds it needs no Maven or JDK. A <code>.dockerignore</code> (<code>.git</code>, <code>.env</code>, IDE files) keeps the build context small and secrets out of layers.</p>

---

## Layer caching: order matters

An unchanged layer is **reused** from cache; a changed layer **rebuilds itself and every layer after it**.

<div class="cols">
<div>

### Poor order

`COPY src ./src` first → every commit busts the cache → all Maven dependencies download **again**.

</div>
<div>

### Good order

`COPY pom.xml .` → `RUN mvn dependency:go-offline` → `COPY src ./src` → `RUN mvn package` (only rebuilds the app)

</div>
</div>

<div class="ok">

Put what changes **rarely** (dependencies) before what changes **often** (source code). The multi-stage Dockerfile already does it.

</div>

---

<!-- _class: tight -->

## Essential commands

| Command | What it does |
|:-|:-|
| `docker build -t myapp:1.0 .` | build an image from the Dockerfile here |
| `docker run -d -p 8080:8080 --name myapp -e KEY=value <image>` | detached, port `host:container`, name, variable |
| `docker run --rm <image>` | remove the container when it exits |
| `docker ps -a` | list containers, including stopped ones |
| `docker logs -f <container>` | follow its stdout and stderr |
| `docker exec -it <container> sh` | shell inside a running container |
| `docker stop` / `docker rm <container>` | `SIGTERM` (`SIGKILL` after 10 s), then remove |
| `docker images` / `pull` / `push` / `tag` / `rmi` | manage images and registries |
| `docker system prune` | remove stopped containers, dangling images, unused networks |

---

## Debugging a container that does not start

The most common first problem: it exits right after `docker run`. Follow the evidence:

```bash
docker ps -a                    # STATUS shows "Exited (1) 3 seconds ago"
docker logs account             # the application's own error message
docker inspect -f '{{.State.ExitCode}} {{.State.OOMKilled}}' account   # 137 + true = killed for memory
docker run -it --rm --entrypoint sh store/account:1.0                 # open a shell in the image
```

---

## Networking

Each container has its own network namespace — its own IP and its own `localhost`.

- **User-defined `bridge`** (`docker network create`): containers reach each other **by name** (embedded DNS).
- **Default `bridge`** (no `--network`): IP addresses only · `host`: shares the host's stack · `none`.

```bash
docker network create store-net
docker run -d --name db --network store-net -e POSTGRES_PASSWORD=secret postgres:17
docker run --rm --network store-net postgres:17 pg_isready -h db
```

<div class="warn">

`EXPOSE 8080` is documentation: **publish** with `-p 8080:8080`. Inside a container, `localhost` is the container itself: use `jdbc:postgresql://db:5432/store`, not `localhost:5432`.

</div>

---

## Volumes

Containers are ephemeral: data written inside is lost when the container is removed.

```bash
# Named volume (managed by Docker)
docker run -v mydata:/var/lib/postgresql/data postgres:17

# Bind mount (maps a host directory)
docker run -v /host/path:/container/path myapp
```

- **Named volumes** in production: Docker manages the location.
- **Bind mounts** in development: local changes without rebuilding.

<div class="warn">

`postgres:18` moved its data to `/var/lib/postgresql/18/docker` (mount `/var/lib/postgresql`): `postgres:latest` changed silently — **pin the major version**.

</div>

---

## Good practices and common mistakes

<div class="cols">
<div>

### Good practices

- **Pin versions**: `eclipse-temurin:25-jre-alpine`, `postgres:17`
- **Small base images**: `-alpine`, `-jre`, distroless
- **One process** per container
- **Non-root user** (`USER`)
- **Configuration in env vars**: one image for every environment

</div>
<div>

### Common mistakes

- **Secrets in the image** (`COPY .env`, `ENV DB_PASSWORD=…`): every layer is readable
- **Stale JAR**: single-stage `docker build` copies whatever is in `target/`
- **Source before dependencies**: every commit downloads Maven again

</div>
</div>

---

<div class="kicker">Docker Compose</div>

## From a script to a file

The account service and its database with plain `docker`, in the right order:

```bash
docker network create store
docker volume create db-data
docker run -d --name db --network store \
  -e POSTGRES_DB=store -e POSTGRES_USER=store -e POSTGRES_PASSWORD=secret \
  -v db-data:/var/lib/postgresql/data postgres:17
docker build -t store/account ./account-service
docker run -d --name account --network store -p 8080:8080 \
  -e SPRING_DATASOURCE_URL=jdbc:postgresql://db:5432/store store/account
```

Add a gateway, auth, Redis and Kafka: an error-prone script nobody can review in a pull request. **Docker Compose** replaces it with one **declarative** `compose.yaml` and one command.

---

<!-- _class: tight -->

## Basic structure

```yaml
name: myapp

services:
  web:
    build: ./web
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
    volumes:
      - db-data:/var/lib/postgresql/data

volumes:
  db-data:
```

<p class="small">One network per project: each service is reachable by its <strong>service name as the hostname</strong> (<code>db</code>, <code>app</code>, <code>web</code>).</p>

---

## The vocabulary of a Compose file

| Key | Meaning |
|---|---|
| `name` | project name; prefixes containers, networks, volumes (`myapp-db-1`) |
| `services` | one entry per container; a template you can replicate |
| `image` / `build` | an existing image / build from a local Dockerfile |
| `ports` | publish `host:container` — only what must be reached from outside |
| `environment` | variables passed to the container |
| `depends_on` | start order between services |
| `volumes` | named volumes or bind mounts; top-level `volumes:` declares the named ones |

<p class="small">Compose v2 is <code>docker compose</code> (with a space); <code>docker-compose</code> v1 is unsupported since 2023 and <code>version:</code> is obsolete. Preferred name: <code>compose.yaml</code>.</p>

---

## Key commands

| Command | What it does |
|:-|:-|
| `docker compose up -d --build` | rebuild images and start everything in the background |
| `docker compose ps` | list running services |
| `docker compose logs -f app` | follow one service's logs |
| `docker compose exec app sh` | shell in a running service |
| `docker compose restart app` | restart one service |
| `docker compose down` / `down -v` | remove containers and networks / **and named volumes** |
| `docker compose config` | the final file with `${VARIABLES}` resolved — check it first |

---

## Service names, not `localhost`

Inside the project network, services talk on the **container port** by **service name**; `ports:` only matters for traffic from your machine.

| From | URL |
|---|---|
| the `app` container | `jdbc:postgresql://db:5432/myapp` |
| your laptop (IDE, `psql`, DBeaver) | `jdbc:postgresql://localhost:5432/myapp` (only with `ports: - 5432:5432`) |

<div class="warn">

The most common Compose bug: `localhost:5432` works from the IDE and fails inside Compose with *Connection refused*. Use `db` and pass the URL as an environment variable, so the same image works in both places.

</div>

<p class="small">In Hands-on 2 only the gateway publishes a port; the other services are reachable only inside the network.</p>

---

## Environment variables and `.env`

```yaml
environment:
  POSTGRES_DB: ${POSTGRES_DB:-myapp}
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set it in .env}
```

- `:-myapp` = **default** value; `:?` = **fail loudly** if missing (plain `${VAR}` only warns and substitutes an empty string).
- `.env` (next to `compose.yaml`) is read automatically for **interpolation**; shell variables win. It is **not** passed to the containers.
- `env_file: account.env` injects every `KEY=value` of a file **into a container**.

<div class="warn">

**Never commit `.env`**: `.gitignore` it, one per environment, and commit a `.env.example` with placeholders.

</div>

---

<!-- _class: tight -->

## Started is not ready

`depends_on` orders the **start**, but does not wait for the database to **finish initialising**.

```yaml
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
        condition: service_healthy
```

`compose up` starts db → `pg_isready` unhealthy, retry in 5 s → healthy → starts app → app connects on `db:5432`.

<p class="small">Without it, app may crash while PostgreSQL is still creating its files. <code>restart: on-failure</code> is a complementary safety net.</p>

---

## Named volumes vs. bind mounts

```yaml
services:
  db:
    volumes:
      - db-data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
```

| | Named volume | Bind mount |
|---|---|---|
| **Data location** | managed by Docker | a host path you choose |
| **Removed by `down -v`** | yes — data is deleted | no — the host folder stays |
| **Use case** | production data, databases | dev: hot reload, seed scripts |

<div class="warn">

Init scripts run **only when the data directory is empty**: after changing `init.sql`, `docker compose down -v` to re-initialise.

</div>

---

## Limits of Compose

Compose runs everything on **one host**: no spreading across machines, no rescheduling when a host dies, no rolling updates. Ideal for development, CI and small single-server deployments.

<div class="warn">

- **`depends_on` without a health check** → "random" startup failures.
- **`down -v` on a database you care about** → the volume and its data are gone.
- **Publishing every port** "just in case" → each one is a door; publish only the gateway.
- **Forgetting `--build`** → Compose reuses the old image and your change does not appear.

</div>

---

## Containerisation in the cloud

Many hosts — restarting crashed containers, spreading replicas, rolling out versions — is the job of an **orchestrator** such as Kubernetes (Hands-on 5). Managed services add scheduling, scaling and load balancing:

| Service | Provider | Model |
|---|---|---|
| **ECS / Fargate** | AWS | managed containers — no cluster to operate |
| **EKS** | AWS | managed Kubernetes |
| **Cloud Run** | Google | serverless containers — scales to zero |
| **GKE** | Google | managed Kubernetes |
| **AKS** | Azure | managed Kubernetes |

---

<!-- _class: tight -->

## Takeaways

1. Horizontal scaling needs **identical environments**; a container image packages the app with its dependencies and ends *"it works on my machine"*.
2. A container is an isolated **Linux process** (namespaces + cgroups + layered filesystem): shares the kernel, starts in seconds, isolates less than a VM.
3. **Dockerfile → image → registry → container**; **multi-stage** builds and dependencies **before** source give small images and fast rebuilds.
4. Publish with `-p host:container`; on a user-defined network, containers find each other **by name** — `localhost` is the container itself.
5. Containers are disposable: data in **volumes**, configuration in env vars, explicit image versions — never `latest`.
6. `compose.yaml` declares the stack; `.env` fills placeholders and is never committed; `healthcheck` + `service_healthy` waits until a dependency is **ready**.
7. Docker and Compose run on one host; orchestrators and managed cloud services run containers across many.
