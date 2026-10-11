
In [Hands-on 1](../../../hands-on/1/index.md) you run the account service with `mvn spring-boot:run`. That works because your laptop has the right JDK, Maven and environment variables. To run the same service on a colleague's machine, a CI server or a cloud VM, you would have to reproduce that whole setup by hand — and keep it in sync forever. Docker turns the setup into a file (the Dockerfile) and the result into an artifact (the image) that runs the same way everywhere.

**Docker** is a platform for building, shipping, and running applications in containers[^1]. It standardises the packaging of an application and all its dependencies — runtime, libraries, environment variables, configuration — into a single portable unit that runs identically on any machine with the Docker Engine installed.

---

## Core concepts

``` mermaid-sim
flowchart LR
  df[Dockerfile] -->|docker build| img[Image]
  img -->|docker run| c1[Container A]
  img -->|docker run| c2[Container B]
  img -->|docker push| reg[(Registry\nDocker Hub)]
  reg -->|docker pull| img2[Image on\nanother host]
```

**Dockerfile**
: A text file containing step-by-step instructions for building an image. Each instruction that changes the filesystem (`RUN`, `COPY`, `ADD`) creates a new read-only layer.

**Image**
: An immutable snapshot built from a Dockerfile. Images are the artifact that gets versioned, pushed to a registry, and shipped. An image is identified by a name and a **tag** (`eclipse-temurin:25-jre-alpine`, `store/account:1.0`); when you omit the tag, Docker assumes `latest`.

**Container**
: A running instance of an image. Containers are isolated processes on the host OS — they share the kernel but have their own filesystem, network, and process namespace (see [What a container really is](../index.md#what-a-container-really-is)).

**Registry**
: A server that stores and distributes images. [Docker Hub](https://hub.docker.com){:target="_blank"}[^3] is the default public registry. Private registries (AWS ECR, GitHub Container Registry, GitLab Registry) are used for proprietary images.

---

## How Docker works: client, daemon, registry

The `docker` command you type is only a **client**. It sends each request to the **Docker daemon** (`dockerd`), a background service that builds images, pulls them from registries and asks the container runtime (`containerd`, which uses `runc`) to start the actual processes.

``` mermaid-sim
flowchart LR
    cli["docker CLI"] -->|REST API| daemon["dockerd daemon"]
    daemon -->|pull image| reg[(Registry)]
    daemon -->|create container| rt["containerd + runc"]
    rt -->|start process| proc["container process"]
```

This is why `docker ps` fails with *"Cannot connect to the Docker daemon"* when Docker Desktop is not running: the client is fine, but nobody is listening on the other side.

---

## Dockerfile

A Dockerfile defines the environment the application runs in. Each instruction adds a layer to the image[^2]:

``` { .dockerfile title="Dockerfile" }
# Base image — choose the smallest that fits
FROM eclipse-temurin:25-jre-alpine

# Working directory inside the container
WORKDIR /app

# Copy the built artifact from the host (run `mvn package` first)
COPY target/*.jar app.jar

# Expose the port the application listens on (documentation only)
EXPOSE 8080

# Command to run when the container starts
ENTRYPOINT ["java", "-jar", "app.jar"]
```

The Dockerfile used for the store's services in [Hands-on 1](../../../hands-on/1/containerization/index.md) follows the same pattern: a Java 25 base image, the JAR built by Maven, and `java -jar` as entry point.

The instructions you will use most often:

| Instruction | Purpose | Example |
|---|---|---|
| `FROM` | Base image to start from (always first) | `FROM eclipse-temurin:25-jre-alpine` |
| `WORKDIR` | Set (and create) the working directory | `WORKDIR /app` |
| `COPY` | Copy files from the build context into the image | `COPY target/*.jar app.jar` |
| `RUN` | Execute a command **at build time** and save the result as a layer | `RUN apk add --no-cache curl` |
| `ENV` | Set an environment variable for build and run time | `ENV SPRING_PROFILES_ACTIVE=prod` |
| `ARG` | Build-time variable (not available when the container runs) | `ARG VERSION=1.0` |
| `EXPOSE` | Document the port the app listens on (does **not** publish it) | `EXPOSE 8080` |
| `USER` | Run the following instructions and the container as this user | `USER app` |
| `ENTRYPOINT` / `CMD` | What runs **when the container starts** | `ENTRYPOINT ["java", "-jar", "app.jar"]` |

!!! info "`RUN` vs `CMD` vs `ENTRYPOINT`"
    `RUN` executes while the image is **built** (installing packages, compiling). `ENTRYPOINT` and `CMD` define what executes when a container **starts**. When both are present, `CMD` supplies default *arguments* to `ENTRYPOINT`, and anything you type after the image name in `docker run <image> …` replaces `CMD`. Prefer the exec form with brackets (`["java", "-jar", "app.jar"]`): the JVM becomes PID 1 and receives the `SIGTERM` sent by `docker stop`, so Spring Boot can shut down gracefully.

### `.dockerignore`

`docker build .` sends the whole directory (the **build context**) to the daemon. A `.dockerignore` file keeps out what the image does not need — making builds faster and preventing secrets from ending up in a layer:

``` { .text title=".dockerignore" }
.git
.idea
*.iml
.env
target/*
!target/*.jar
```

### Multi-stage builds

Multi-stage builds separate the build environment from the runtime environment, producing a smaller final image. They also remove the need to have Maven and a JDK installed on the machine that builds the image:

``` { .dockerfile title="Dockerfile (multi-stage)" }
# Stage 1: build
FROM maven:3.9-eclipse-temurin-25 AS builder
WORKDIR /build
COPY pom.xml .
RUN mvn dependency:go-offline          # cache dependencies separately
COPY src ./src
RUN mvn package -DskipTests

# Stage 2: run — only the JRE, no Maven, no source
FROM eclipse-temurin:25-jre-alpine
WORKDIR /app
COPY --from=builder /build/target/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

The final image contains only the JRE and the compiled JAR — Maven and the source tree are discarded.

!!! note "Why `*.jar` and not `app.jar`?"
    Maven names the artifact `<artifactId>-<version>.jar` (for example `account-service-0.0.1-SNAPSHOT.jar`), not `app.jar`. The wildcard matches it — Spring Boot keeps the original thin JAR as `*.jar.original`, which the pattern does not match — and the `COPY` renames it to `app.jar` inside the image.

---

### Layer caching

Docker builds images layer by layer. If a layer has not changed since the last build, Docker reuses the cached version — skipping that step entirely. Once a layer changes, **that layer and every layer after it** are rebuilt. **Layer order matters**: place instructions that change infrequently (dependencies) before instructions that change often (source code).

``` mermaid-sim
flowchart LR
    subgraph bad [Poor order — cache busted on every code change]
        direction TB
        b1["COPY src ./src\n(changes every commit)"]:::changed --> b2["RUN mvn package"]:::changed --> b3["RUN mvn dependency:go-offline"]:::changed
    end
    subgraph good [Good order — dependencies cached separately]
        direction TB
        g1["COPY pom.xml ."]:::cached --> g2["RUN mvn dependency:go-offline"]:::cached --> g3["COPY src ./src\n(changes every commit)"]:::changed --> g4["RUN mvn package\n(only rebuilds app)"]:::changed
    end
    classDef cached fill:#6c6,color:#fff
    classDef changed fill:#f66,color:#fff
```

The multi-stage Dockerfile above already exploits this: `RUN mvn dependency:go-offline` runs only when `pom.xml` changes, not on every code change.

---

## Essential commands

### Managing containers

| Command | Description |
|:-|:-|
| `docker run <image>` | Create and start a container from an image |
| `docker run -d <image>` | Run in detached (background) mode |
| `docker run -p 8080:8080 <image>` | Publish a port: host port 8080 → container port 8080 (`host:container`) |
| `docker run --name myapp <image>` | Assign a name to the container |
| `docker run -e KEY=value <image>` | Set an environment variable |
| `docker run --rm <image>` | Remove the container automatically when it exits |
| `docker ps` | List running containers |
| `docker ps -a` | List all containers (including stopped) |
| `docker stop <container>` | Gracefully stop a running container (`SIGTERM`, then `SIGKILL` after 10 s) |
| `docker rm <container>` | Remove a stopped container |
| `docker exec -it <container> sh` | Open an interactive shell in a running container |
| `docker logs <container>` | Print the container's logs (its stdout and stderr) |
| `docker logs -f <container>` | Follow logs in real time |
| `docker inspect <container>` | Full JSON metadata for a container |

### Managing images

| Command | Description |
|:-|:-|
| `docker build -t myapp:1.0 .` | Build an image from the Dockerfile in the current directory |
| `docker images` | List local images |
| `docker pull <image>` | Download an image from the registry |
| `docker push <image>` | Push an image to the registry |
| `docker rmi <image>` | Remove a local image |
| `docker tag <image> <new-tag>` | Tag an image with a new name |

### Housekeeping

| Command | Description |
|:-|:-|
| `docker system prune` | Remove stopped containers, dangling images, unused networks |
| `docker volume ls` | List volumes |
| `docker network ls` | List networks |

!!! example "Debugging a container that does not start"
    A container that exits right after `docker run` is the most common first problem. Follow the evidence:

    ``` bash
    docker ps -a                    # STATUS shows "Exited (1) 3 seconds ago"
    docker logs account             # the application's own error message (e.g. cannot reach the database)
    docker inspect -f '{{.State.ExitCode}} {{.State.OOMKilled}}' account   # 137 + true = killed for memory
    docker run -it --rm --entrypoint sh store/account:1.0                 # open a shell in the image to look around
    ```

---

## Networking

Each container gets its own network namespace — its own IP address and its own `localhost`. Docker provides several network drivers[^4]:

| Driver | Description |
|---|---|
| `bridge` | A private virtual network on the host. On a **user-defined** bridge network (`docker network create …`), containers reach each other **by name** through Docker's embedded DNS. On the **default** bridge (used when you pass no `--network`), they can only use IP addresses |
| `host` | Container shares the host's network stack (no isolation) |
| `none` | No network access |

``` bash
docker network create store-net
docker run -d --name db --network store-net -e POSTGRES_PASSWORD=secret postgres:17
docker run --rm --network store-net postgres:17 pg_isready -h db   # "db" resolves to the database container
```

When using Docker Compose, all services are attached to a user-defined network that Compose creates automatically, so they can reach each other by their service name as the hostname ([Docker Compose](../compose/index.md)).

!!! warning "`EXPOSE` does not publish a port, and `localhost` is not the host"
    - `EXPOSE 8080` is documentation. To reach the container from your browser you must **publish** the port with `-p 8080:8080`.
    - Inside a container, `localhost` is the container itself. A Spring Boot app configured with `jdbc:postgresql://localhost:5432/store` will not find a database running in another container — use the container (or service) name: `jdbc:postgresql://db:5432/store`.

---

## Volumes

Containers are ephemeral — data written inside a container is lost when the container is removed. **Volumes** persist data beyond the container lifecycle:

```bash
# Named volume (managed by Docker)
docker run -v mydata:/var/lib/postgresql/data postgres:17

# Bind mount (maps a host directory)
docker run -v /host/path:/container/path myapp
```

Named volumes are preferred in production because Docker manages their location. Bind mounts are useful during development to reflect local file changes without rebuilding the image.

!!! warning "PostgreSQL 18 changed the data path"
    Up to `postgres:17`, the official image keeps its data in `/var/lib/postgresql/data`. From `postgres:18` on, the data lives in a version-specific directory (`/var/lib/postgresql/18/docker`) and the volume should be mounted at `/var/lib/postgresql`. An image tagged `postgres` or `postgres:latest` therefore changed behaviour silently when 18 became `latest` — one more reason to **pin the major version** of the images you depend on.

---

## Good practices and pitfalls

!!! tip "Good practices"
    - **Pin versions**: `eclipse-temurin:25-jre-alpine`, `postgres:17` — never an implicit `latest` for something you deploy.
    - **Small base images** (`-alpine`, `-jre`, distroless): faster pulls, smaller attack surface.
    - **One process per container**: the service, not the service *and* its database.
    - **Run as a non-root user** (`USER`), so a compromised app does not run as root inside the container.
    - **Configuration through environment variables**, so the same image runs in every environment.

!!! warning "Common mistakes"
    - **Secrets in the image** (`COPY .env`, `ENV DB_PASSWORD=…`): anyone who pulls the image can read every layer. Pass secrets at run time.
    - **Building the JAR outside and forgetting to rebuild it**: with a single-stage Dockerfile, `docker build` copies whatever is in `target/` — run `mvn package` first, or use a multi-stage build.
    - **Source copied before dependencies**: every commit downloads all Maven dependencies again (see [Layer caching](#layer-caching)).

---

## Connections

- [Hands-on 1 — Containerization](../../../hands-on/1/containerization/index.md) — the account service's Dockerfile and its Compose file.
- [Docker Compose](../compose/index.md) — running several containers together.
- [Hands-on 4](../../../hands-on/4/index.md) — Jenkins builds and pushes images in a pipeline.
- [Hands-on 5](../../../hands-on/5/index.md) — Kubernetes runs these images across a cluster.

## Key takeaways

- The `docker` CLI talks to a daemon that builds images, pulls them from registries and starts containers through containerd/runc.
- A Dockerfile is a recipe; each filesystem-changing instruction is a cached layer — put dependencies **before** source code.
- **Multi-stage builds** keep Maven and the sources out of the final image; `ENTRYPOINT` in exec form lets the JVM shut down gracefully.
- Publish ports with `-p host:container`; containers on a **user-defined** network find each other by name, and `localhost` means the container itself.
- Containers are disposable: keep data in **volumes**, configuration in environment variables, and pin image versions.

---

[^1]: [Docker Documentation](https://docs.docker.com/){:target="_blank"}
[^2]: [Dockerfile Reference](https://docs.docker.com/reference/dockerfile/){:target="_blank"}
[^3]: [Docker Hub](https://hub.docker.com){:target="_blank"} — public image registry
[^4]: [Docker Networking — Bridge network driver](https://docs.docker.com/engine/network/drivers/bridge/){:target="_blank"}
