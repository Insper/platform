
Click **"Answer"** to reveal the correct answer and explanation.

---

## Containers

**Q1.** A container is "an isolated process sharing the host kernel". Which Linux features provide, respectively, its **isolated view** of the system and its **resource limits**?

- A. Hypervisor and guest OS
- B. Namespaces and cgroups
- C. OverlayFS and iptables
- D. chroot and swap

??? success "Answer"
    **B — Namespaces and cgroups.**

    **Namespaces** give the process its own view of process IDs, network interfaces, mounts and hostname — that is why your app is PID 1 inside the container and has its own IP address. **cgroups** limit and account for CPU, memory and I/O (`docker run --memory 512m`). OverlayFS provides the layered filesystem, not isolation; a hypervisor and guest OS are what a **virtual machine** uses, which is exactly what containers avoid.

---

## Docker

**Q2.** What is the key difference between a Docker **image** and a **container**?

- A. An image runs in the foreground; a container runs in the background
- B. An image is an immutable snapshot; a container is a running instance of that image
- C. An image includes the host OS kernel; a container uses its own kernel
- D. An image is stored in the registry; a container is stored on the host filesystem

??? success "Answer"
    **B — Image = immutable snapshot; container = running instance.**

    An image is built once from a Dockerfile and stored as a read-only artifact. A container is a live process created from that image — it has its own writable layer on top of the image layers. Multiple containers can run from the same image simultaneously without interfering with each other.

---

**Q3.** What is the primary benefit of a **multi-stage Dockerfile** build?

- A. It runs all build stages in parallel, reducing total build time
- B. It allows multiple base images to be used simultaneously in one container
- C. The final image contains only runtime artifacts, not the build toolchain — producing a smaller and more secure image
- D. It enables the same image to run on multiple operating systems

??? success "Answer"
    **C — Smaller final image without the build toolchain.**

    In a Java project, the build stage needs Maven and JDK; the runtime only needs JRE and the compiled JAR. Multi-stage builds discard everything from intermediate stages — Maven, source code, test dependencies — leaving an image that is several times smaller (a JRE on Alpine instead of a full JDK plus Maven and its repository) and has a reduced attack surface.

---

**Q4.** To maximise Docker **layer caching**, where should `COPY src ./src` appear relative to dependency installation?

- A. Before — so the source is available when downloading dependencies
- B. After — a source change rebuilds only the `COPY src` layer and the ones after it, leaving the cached dependency layer intact
- C. It makes no difference; Docker caches all layers equally
- D. At the very beginning, before any other instruction

??? success "Answer"
    **B — After dependency installation.**

    Docker rebuilds all layers from the first changed layer onward. If `COPY src` comes before `RUN mvn dependency:go-offline`, every source code change forces a fresh dependency download. Placing the source copy after dependency installation means the slow dependency step is only re-run when `pom.xml` changes.

---

**Q5.** What is the difference between a **named volume** and a **bind mount**?

- A. A named volume is faster; a bind mount is more durable
- B. A named volume is managed by Docker and persists beyond container removal; a bind mount maps a specific host path into the container
- C. A bind mount requires the Docker daemon; a named volume does not
- D. They are identical — the terms are interchangeable

??? success "Answer"
    **B — Named volume = Docker-managed and persistent; bind mount = specific host path.**

    Named volumes are created and managed by Docker, survive `docker rm`, and do not depend on the host's directory layout. Bind mounts directly expose a host directory — useful in development for hot-reload (changes on the host immediately reflect in the container) but tied to the host's filesystem layout.

---

**Q6.** Which Docker network driver allows containers on the same network to reach each other by **service name**?

- A. `host` — containers share the host network stack
- B. `none` — containers are fully isolated
- C. `overlay` — used for Swarm mode multi-host networking
- D. A user-defined `bridge` network — containers attached to it resolve each other by name

??? success "Answer"
    **D — A user-defined `bridge` network.**

    On a user-defined bridge network (`docker network create …`), Docker's embedded DNS server resolves container names to their IP addresses. The *default* bridge network (used when you pass no `--network`) does **not** provide name resolution — containers there can only use IP addresses. Docker Compose creates a user-defined network for each project, which is how services reach each other by service name (`db`, `app`, `gateway`) without any hardcoded IP addresses.

---

**Q7.** A Dockerfile contains `EXPOSE 8080`, and you start the container with `docker run -d store/account:1.0`. Why does `http://localhost:8080` in your browser not answer?

- A. `EXPOSE` only works with Docker Compose
- B. `EXPOSE` is documentation; the port must be **published** with `-p 8080:8080` to be reachable from the host
- C. The application must listen on port 80 inside a container
- D. Containers can never be reached from the host's browser

??? success "Answer"
    **B — `EXPOSE` documents, `-p` publishes.**

    `EXPOSE` records which port the application listens on, but does not open anything on the host. `docker run -p 8080:8080` (format `host:container`) maps a host port to the container port; in Compose the same is done with `ports:`. Other containers on the same network can reach port 8080 without any publishing.

---

## Docker Compose

**Q8.** What does `depends_on` with `condition: service_healthy` do that plain `depends_on` does not?

- A. It sets a timeout after which the dependent service starts regardless
- B. It delays the dependent service until the dependency passes its `healthcheck`, not just until the container process starts
- C. It causes Compose to restart the dependency if it becomes unhealthy after startup
- D. It runs the dependency in a separate isolated network

??? success "Answer"
    **B — Waits for healthcheck to pass, not just container start.**

    Plain `depends_on` only waits for the dependency container to be *running* (process started). The database process might be running but not yet ready to accept connections. `condition: service_healthy` waits until the `healthcheck` command inside the dependency returns exit code 0 — e.g., `pg_isready -U myapp`.

---

**Q9.** Why should credentials **never** be hard-coded in `compose.yaml`?

- A. Docker Compose does not support plain-text values in environment blocks
- B. Compose strips plain-text values during the build phase for security
- C. Credentials committed to version control are a security incident; `.env` files allow per-environment secrets outside the repository
- D. Hard-coded values prevent the service from reading them at runtime

??? success "Answer"
    **C — Credentials in VCS = security incident.**

    Once a secret is committed to a repository — even a private one — it can be retrieved from history even after deletion. `.env` files are added to `.gitignore` and never committed, allowing each environment (dev, staging, production) to have different secrets without them ever appearing in the codebase.

---

**Q10.** What does `docker compose down -v` do that `docker compose down` does not?

- A. It stops containers more forcefully using `SIGKILL` instead of `SIGTERM`
- B. It rebuilds all images before stopping
- C. It also removes named volumes, permanently deleting any persisted data
- D. It removes the project network but keeps the containers stopped

??? success "Answer"
    **C — Also removes named volumes.**

    `docker compose down` stops and removes containers and networks but leaves named volumes intact (the database data survives). Adding `-v` also removes named volumes — permanently deleting all persisted data. This is irreversible, so use it only when you genuinely want a clean slate.

---

**Q11.** Inside a Docker Compose network, how do services address each other?

- A. By the container's full image name and tag
- B. By the host machine's IP address and the mapped port
- C. By the service name defined in `compose.yaml` — Compose provides DNS resolution by service name
- D. By the container ID assigned at runtime

??? success "Answer"
    **C — By service name.**

    Compose automatically creates a network and configures DNS so that each service is reachable by its name in `compose.yaml`. A Spring Boot app configured with `SPRING_DATASOURCE_URL: jdbc:postgresql://db:5432/store` will resolve `db` to the PostgreSQL container's IP without any manual configuration.

---

**Q12.** Which two mechanisms control **startup ordering** in Docker Compose? Select the most complete answer.

- A. `restart: always` retries until all dependencies are up; `priority` field sets integer startup order
- B. `depends_on` for basic ordering; `healthcheck` with `condition: service_healthy` for readiness-gated ordering
- C. `order:` field in `volumes:` block; `links:` for legacy dependency declaration
- D. Environment variable injection order; port mapping order in `ports:` block

??? success "Answer"
    **B — `depends_on` + `healthcheck` with `condition: service_healthy`.**

    `depends_on` guarantees that container B starts after container A is *running*. Adding `condition: service_healthy` guarantees that B waits until A passes its healthcheck and is actually *ready*. The combination is essential for databases, which take several seconds to initialise after the process starts.

---

**Q13.** The account service works when started from the IDE with `spring.datasource.url=jdbc:postgresql://localhost:5432/store`. Packaged as a container in the same `compose.yaml` as the `db` service, it fails with *Connection refused*. What is the fix?

- A. Publish port 5432 of `db` with `ports: - 5432:5432`
- B. Use `network_mode: host` for every service
- C. Point the URL to the service name: `jdbc:postgresql://db:5432/store`, passed as an environment variable
- D. Add `depends_on: - db` to the account service

??? success "Answer"
    **C — Use the service name.**

    Inside a container, `localhost` is the container itself — there is no PostgreSQL there. Compose's DNS resolves the service name `db` to the database container, which listens on its container port 5432. Publishing the port (A) only helps clients on the host; `depends_on` (D) orders the start but does not change the address. Passing the URL through an environment variable (e.g. `SPRING_DATASOURCE_URL`) keeps the same image working in the IDE, in Compose and in Kubernetes.

---

**Q14.** A project has a `.env` file with `DB_PASSWORD=devpass` next to `compose.yaml`. Which statement is correct?

- A. Every variable in `.env` is automatically injected into every container
- B. `.env` is used to fill `${DB_PASSWORD}` placeholders in `compose.yaml`; to inject a whole file into a container you use `env_file:`
- C. `.env` is ignored unless you pass `--env-file .env` to `docker compose up`
- D. Values in `.env` always override variables exported in your shell

??? success "Answer"
    **B — `.env` is for interpolation; `env_file:` injects into a container.**

    Compose reads `.env` from the project directory automatically and uses it to substitute `${...}` in `compose.yaml` — a container only receives a value if the file maps it, for example `POSTGRES_PASSWORD: ${DB_PASSWORD}`. To pass every `KEY=value` of a file to a container, use `env_file:` on the service. Variables already set in the shell take precedence over `.env` (D is false).
