
Click **"Answer"** to reveal the correct answer and explanation.

---

## Docker

**Q1.** What is the key difference between a Docker **image** and a **container**?

- A. An image runs in the foreground; a container runs in the background
- B. An image is an immutable snapshot; a container is a running instance of that image
- C. An image includes the host OS kernel; a container uses its own kernel
- D. An image is stored in the registry; a container is stored on the host filesystem

??? success "Answer"
    **B — Image = immutable snapshot; container = running instance.**

    An image is built once from a Dockerfile and stored as a read-only artifact. A container is a live process created from that image — it has its own writable layer on top of the image layers. Multiple containers can run from the same image simultaneously without interfering with each other.

---

**Q2.** What is the primary benefit of a **multi-stage Dockerfile** build?

- A. It runs all build stages in parallel, reducing total build time
- B. It allows multiple base images to be used simultaneously in one container
- C. The final image contains only runtime artifacts, not the build toolchain — producing a smaller and more secure image
- D. It enables the same image to run on multiple operating systems

??? success "Answer"
    **C — Smaller final image without the build toolchain.**

    In a Java project, the build stage needs Maven and JDK; the runtime only needs JRE and the compiled JAR. Multi-stage builds discard everything from intermediate stages — Maven, source code, test dependencies — leaving an image that may be 10× smaller and has a reduced attack surface.

---

**Q3.** To maximise Docker **layer caching**, where should `COPY src ./src` appear relative to dependency installation?

- A. Before — so the source is available when downloading dependencies
- B. After — source changes bust only layers above the `COPY`, leaving the cached dependency layer intact
- C. It makes no difference; Docker caches all layers equally
- D. At the very beginning, before any other instruction

??? success "Answer"
    **B — After dependency installation.**

    Docker rebuilds all layers from the first changed layer onward. If `COPY src` comes before `RUN mvn dependency:go-offline`, every source code change forces a fresh dependency download. Placing the source copy after dependency installation means the slow dependency step is only re-run when `pom.xml` changes.

---

**Q4.** What is the difference between a **named volume** and a **bind mount**?

- A. A named volume is faster; a bind mount is more durable
- B. A named volume is managed by Docker and persists beyond container removal; a bind mount maps a specific host path into the container
- C. A bind mount requires the Docker daemon; a named volume does not
- D. They are identical — the terms are interchangeable

??? success "Answer"
    **B — Named volume = Docker-managed and persistent; bind mount = specific host path.**

    Named volumes are created and managed by Docker, survive `docker rm`, and work portably across hosts. Bind mounts directly expose a host directory — useful in development for hot-reload (changes on the host immediately reflect in the container) but tied to the host's filesystem layout.

---

**Q5.** Which Docker network driver allows containers on the same network to reach each other by **service name**?

- A. `host` — containers share the host network stack
- B. `none` — containers are fully isolated
- C. `overlay` — used for Swarm mode multi-host networking
- D. `bridge` (default) — containers on the same bridge network resolve each other by container name

??? success "Answer"
    **D — `bridge` (default).**

    Docker's default bridge network includes a built-in DNS server that resolves container names to their IP addresses. This is how services in Docker Compose reach each other by service name (`db`, `app`, `gateway`) without any hardcoded IP addresses.

---

## Docker Compose

**Q6.** What does `depends_on` with `condition: service_healthy` do that plain `depends_on` does not?

- A. It sets a timeout after which the dependent service starts regardless
- B. It delays the dependent service until the dependency passes its `healthcheck`, not just until the container process starts
- C. It causes Compose to restart the dependency if it becomes unhealthy after startup
- D. It runs the dependency in a separate isolated network

??? success "Answer"
    **B — Waits for healthcheck to pass, not just container start.**

    Plain `depends_on` only waits for the dependency container to be *running* (process started). The database process might be running but not yet ready to accept connections. `condition: service_healthy` waits until the `healthcheck` command inside the dependency returns exit code 0 — e.g., `pg_isready -U myapp`.

---

**Q7.** Why should credentials **never** be hard-coded in `compose.yaml`?

- A. Docker Compose does not support plain-text values in environment blocks
- B. Compose strips plain-text values during the build phase for security
- C. Credentials committed to version control are a security incident; `.env` files allow per-environment secrets outside the repository
- D. Hard-coded values prevent the service from reading them at runtime

??? success "Answer"
    **C — Credentials in VCS = security incident.**

    Once a secret is committed to a repository — even a private one — it can be retrieved from history even after deletion. `.env` files are added to `.gitignore` and never committed, allowing each environment (dev, staging, production) to have different secrets without them ever appearing in the codebase.

---

**Q8.** What does `docker compose down -v` do that `docker compose down` does not?

- A. It stops containers more forcefully using `SIGKILL` instead of `SIGTERM`
- B. It rebuilds all images before stopping
- C. It also removes named volumes, permanently deleting any persisted data
- D. It removes the project network but keeps the containers stopped

??? success "Answer"
    **C — Also removes named volumes.**

    `docker compose down` stops and removes containers and networks but leaves named volumes intact (the database data survives). Adding `-v` also removes named volumes — permanently deleting all persisted data. This is irreversible, so use it only when you genuinely want a clean slate.

---

**Q9.** Inside a Docker Compose network, how do services address each other?

- A. By the container's full image name and tag
- B. By the host machine's IP address and the mapped port
- C. By the service name defined in `compose.yaml` — Compose provides DNS resolution by service name
- D. By the container ID assigned at runtime

??? success "Answer"
    **C — By service name.**

    Compose automatically creates a network and configures DNS so that each service is reachable by its name in `compose.yaml`. A Spring Boot app configured with `DATABASE_HOST: db` will resolve `db` to the PostgreSQL container's IP without any manual configuration.

---

**Q10.** Which two mechanisms control **startup ordering** in Docker Compose? Select the most complete answer.

- A. `restart: always` retries until all dependencies are up; `priority` field sets integer startup order
- B. `depends_on` for basic ordering; `healthcheck` with `condition: service_healthy` for readiness-gated ordering
- C. `order:` field in `volumes:` block; `links:` for legacy dependency declaration
- D. Environment variable injection order; port mapping order in `ports:` block

??? success "Answer"
    **B — `depends_on` + `healthcheck` with `condition: service_healthy`.**

    `depends_on` guarantees that container B starts after container A is *running*. Adding `condition: service_healthy` guarantees that B waits until A passes its healthcheck and is actually *ready*. The combination is essential for databases, which take several seconds to initialise after the process starts.
