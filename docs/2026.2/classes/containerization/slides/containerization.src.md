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
Outline: (1) scaling and "it works on my machine"; (2) containers vs VMs and what a container
really is; (3) Docker: Dockerfile, layers, commands, networks, volumes; (4) Docker Compose:
services, localhost pitfall, .env, health checks; (5) pitfalls and beyond one host.
-->

---

## Traffic is growing

<div class="q">

Your server can no longer handle the load. What are your options — and what new problem appears?

</div>

* **Vertical scaling** — a bigger machine: simple, but there is a physical limit and upgrades mean downtime.
* **Horizontal scaling** — more machines behind a load balancer: theoretically unbounded…
* …but now every server must be **identical**: OS, library versions, environment variables.
* *"It works on my machine"* — **containers** package the app **with all its dependencies**.

<!--
Let the class answer before revealing. The last bullet is the motivation for the whole class.
-->

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

| Aspect | Containers | Virtual machines |
|---|---|---|
| Isolation | process-level, shared kernel | full OS, own kernel |
| Overhead | lightweight | a complete OS per VM |
| Startup | seconds | minutes |
| Security boundary | weaker | stronger |
| Typical use | microservices, CI/CD, scaling out | different guest OS, strong isolation |

<p class="small">In the cloud they are combined: containers run <strong>inside</strong> the VMs you rent.</p>

---

## What a container really is

Not a small VM — an ordinary **Linux process** with a restricted view of the machine:

| Feature | Gives the process | You see |
|---|---|---|
| **Namespaces** | its own PIDs, network, mounts, hostname | the app is PID 1, own IP and ports |
| **cgroups** | CPU and memory limits | `--memory 512m` → OOM-killed above it |
| **OverlayFS** | read-only image layers + a writable layer | files written inside vanish with the container |

- Docker Desktop on macOS/Windows runs a hidden **Linux VM** for this.
- Images follow the **OCI** standard: they also run on Podman, containerd, Kubernetes.

---

## Core concepts

`Dockerfile` → **docker build** → `Image` → **docker push** → `Registry` → **docker pull** → **docker run** → `Container`

| Concept | What it is |
|---|---|
| **Dockerfile** | the recipe; each `RUN`/`COPY` adds a read-only **layer** |
| **Image** | immutable artifact, `name:tag` — versioned, pushed, shipped |
| **Container** | running instance of an image — isolated, ephemeral, disposable |
| **Registry** | stores images: Docker Hub (public), ECR, GHCR, GitLab (private) |

<p class="small">The <code>docker</code> CLI only talks to the daemon (<code>dockerd</code>), which starts containers through containerd/runc.</p>

---

## A Dockerfile

```dockerfile
FROM eclipse-temurin:25-jre-alpine      # smallest base that fits
WORKDIR /app
COPY target/*.jar app.jar               # Maven's JAR, renamed
EXPOSE 8080                             # documentation only
ENTRYPOINT ["java", "-jar", "app.jar"]  # exec form: JVM gets SIGTERM
```

- `RUN` executes at **build** time; `ENTRYPOINT`/`CMD` at **start** time (`CMD` = default arguments).
- A `.dockerignore` keeps `.git`, `.env` and IDE files out of the build context.

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
# Stage 2: run — only the JRE
FROM eclipse-temurin:25-jre-alpine
WORKDIR /app
COPY --from=builder /build/target/*.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

The final image has **only the JRE and the JAR** — Maven and the sources are discarded.

---

## Layer caching: order matters

An unchanged layer is **reused** from cache; a changed layer **rebuilds itself and every layer after it**.

<div class="cols">
<div>

### Poor order

`COPY src` first → every commit busts the cache → dependencies download **again**.

</div>
<div>

### Good order

`COPY pom.xml` → `RUN mvn dependency:go-offline` → `COPY src` → `RUN mvn package`

</div>
</div>

<div class="ok">

Put what changes **rarely** (dependencies) before what changes **often** (source code).

</div>

---

## Essential commands

| Command | What it does |
|:-|:-|
| `docker build -t myapp:1.0 .` | build an image from the local Dockerfile |
| `docker run -d -p 8080:8080 <image>` | start detached, publish host 8080 → container 8080 |
| `docker ps -a` | list containers, including stopped ones |
| `docker logs -f <container>` | follow the logs |
| `docker exec -it <container> sh` | open a shell inside a running container |
| `docker stop` / `docker rm <container>` | SIGTERM (SIGKILL after 10 s), then remove |
| `docker push` / `docker pull <image>` | send to / fetch from a registry |

<p class="small">Container exits at once? <code>docker ps -a</code> → <code>docker logs</code> → <code>docker inspect</code> (exit code 137 = killed, often for memory).</p>

---

## Networks and volumes

<div class="cols">
<div>

### Networks

- **User-defined** `bridge`: containers reach each other **by name**
- default `bridge`: IP addresses only
- `host`: shares the host's network stack
- `EXPOSE` documents; **`-p`** publishes

</div>
<div>

### Volumes

Containers are **ephemeral** — data inside is lost on removal.

- **Named volume** `mydata:/var/lib/postgresql/data` — Docker manages it.
- **Bind mount** `./init.sql:/docker-…/init.sql` — dev, seed scripts.

</div>
</div>

<p class="small"><code>postgres:18</code> moved its data to <code>/var/lib/postgresql/18/docker</code>: pin major versions.</p>

---

<!-- _class: tight -->

## Docker Compose

The whole stack in **one declarative file**, started with `docker compose up -d --build`.

```yaml
services:
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

<p class="small">Compose creates a network per project: the <strong>service name is the hostname</strong> — note <code>db:5432</code>.</p>

---

## Compose: commands and the `localhost` trap

| Command | What it does |
|:-|:-|
| `docker compose up -d --build` | rebuild images and start everything |
| `docker compose ps` / `logs -f app` | status / follow one service's logs |
| `docker compose config` | print the file with `${VARS}` resolved |
| `docker compose down` / `down -v` | remove containers and networks / **and volumes** |

<div class="warn">

Inside a container, **`localhost` is the container itself**. `localhost:5432` works from the IDE and fails in Compose — use `db:5432`, passed as an environment variable.

</div>

---

## Configuration with `.env`

```yaml
environment:
  POSTGRES_DB: ${POSTGRES_DB:-myapp}             # default if unset
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set it} # required: fail loudly
```

- `.env` (next to `compose.yaml`) fills the `${...}` placeholders; shell variables win.
- `env_file: account.env` injects a whole file **into a container**.
- Publish only the entry point; keep `5432` inside the Compose network in production.

<div class="warn">

**Never commit `.env`** — `.gitignore` it and commit a `.env.example` instead.

</div>

---

## Started is not ready

`depends_on` orders the **start**, but does not wait for the database to **finish initialising**.

```yaml
db:
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U myapp"]
    interval: 5s
    retries: 5
app:
  depends_on:
    db:
      condition: service_healthy
```

<!--
Ask: what happens to the app if it connects while Postgres is still initialising?
-->

---

## Pitfalls — and beyond one host

<div class="warn">

- Shipping **`latest`** — deploy `myapp:1.4.2` or a commit SHA, so you can roll back.
- **Secrets in the image** (`COPY .env`, `ENV PASSWORD=…`) — every layer is readable.
- Editing a running container — lost on the next deploy; change the Dockerfile.
- Forgetting `--build` — Compose reuses the old image.

</div>

Compose runs on **one host**. Many hosts, self-healing, rolling updates → **Kubernetes** (Hands-on 5) or managed services: ECS/Fargate, Cloud Run, EKS, GKE, AKS.

---

## Takeaways

1. Horizontal scaling needs **identical environments**; containers end *"it works on my machine"*.
2. A container is a **Linux process** (namespaces + cgroups + layers): fast and light, weaker isolation than a VM.
3. **Dockerfile → image → registry → container**; multi-stage builds and **layer order** give small images and fast rebuilds.
4. Publish with `-p`; on a user-defined network containers find each other **by name** — never `localhost`.
5. Containers are ephemeral: persist data in **volumes**; pin image versions.
6. **Compose** describes the stack; `.env` fills placeholders and is never committed.
7. Use **health checks** so dependencies are ready; beyond one host, use an orchestrator.
