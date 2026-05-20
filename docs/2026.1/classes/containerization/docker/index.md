
**Docker** is a platform for building, shipping, and running applications in containers. It standardises the packaging of an application and all its dependencies — runtime, libraries, environment variables, configuration — into a single portable unit that runs identically on any machine with the Docker Engine installed.

---

## Core concepts

``` mermaid
flowchart LR
  df[Dockerfile] -->|docker build| img[Image]
  img -->|docker run| c1[Container A]
  img -->|docker run| c2[Container B]
  img -->|docker push| reg[(Registry\nDocker Hub)]
  reg -->|docker pull| img2[Image on\nanother host]
```

**Dockerfile**
: A text file containing step-by-step instructions for building an image. Each instruction creates a new read-only layer.

**Image**
: An immutable snapshot built from a Dockerfile. Images are the artifact that gets versioned, pushed to a registry, and shipped.

**Container**
: A running instance of an image. Containers are isolated processes on the host OS — they share the kernel but have their own filesystem, network, and process namespace.

**Registry**
: A server that stores and distributes images. [Docker Hub](https://hub.docker.com){:target="_blank"} is the default public registry. Private registries (AWS ECR, GitHub Container Registry, GitLab Registry) are used for proprietary images.

---

## Dockerfile

A Dockerfile defines the environment the application runs in. Each instruction adds a layer to the image:

``` { .dockerfile title="Dockerfile" }
# Base image — choose the smallest that fits
FROM eclipse-temurin:21-jre-alpine

# Working directory inside the container
WORKDIR /app

# Copy the built artifact from the host
COPY target/app.jar app.jar

# Expose the port the application listens on (documentation only)
EXPOSE 8080

# Command to run when the container starts
ENTRYPOINT ["java", "-jar", "app.jar"]
```

### Multi-stage builds

Multi-stage builds separate the build environment from the runtime environment, producing a smaller final image:

``` { .dockerfile title="Dockerfile (multi-stage)" }
# Stage 1: build
FROM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /build
COPY pom.xml .
RUN mvn dependency:go-offline          # cache dependencies separately
COPY src ./src
RUN mvn package -DskipTests

# Stage 2: run — only the JRE, no Maven, no source
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=builder /build/target/app.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

The final image contains only the JRE and the compiled JAR — Maven and the source tree are discarded.

---

### Layer caching

Docker builds images layer by layer. If a layer has not changed since the last build, Docker reuses the cached version — skipping that step entirely. **Layer order matters**: place instructions that change infrequently (dependencies) before instructions that change often (source code).

``` mermaid
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
| `docker run -p 8080:8080 <image>` | Map host port 8080 → container port 8080 |
| `docker run --name myapp <image>` | Assign a name to the container |
| `docker ps` | List running containers |
| `docker ps -a` | List all containers (including stopped) |
| `docker stop <container>` | Gracefully stop a running container |
| `docker rm <container>` | Remove a stopped container |
| `docker exec -it <container> sh` | Open an interactive shell in a running container |
| `docker logs <container>` | Stream container logs |
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

---

## Networking

Each container gets its own network namespace. Docker provides several network drivers:

| Driver | Description |
|---|---|
| `bridge` (default) | Containers on the same bridge network can communicate by container name |
| `host` | Container shares the host's network stack (no isolation) |
| `none` | No network access |

When using Docker Compose, all services share a default bridge network automatically and can reach each other by their service name as the hostname.

---

## Volumes

Containers are ephemeral — data written inside a container is lost when the container is removed. **Volumes** persist data beyond the container lifecycle:

```bash
# Named volume (managed by Docker)
docker run -v mydata:/var/lib/postgresql/data postgres

# Bind mount (maps a host directory)
docker run -v /host/path:/container/path myapp
```

Named volumes are preferred in production because Docker manages their location. Bind mounts are useful during development to reflect local file changes without rebuilding the image.

---

[^1]: [Docker Documentation](https://docs.docker.com/){:target="_blank"}
[^2]: [Dockerfile Reference](https://docs.docker.com/reference/dockerfile/){:target="_blank"}
[^3]: [Docker Hub](https://hub.docker.com){:target="_blank"} — public image registry
