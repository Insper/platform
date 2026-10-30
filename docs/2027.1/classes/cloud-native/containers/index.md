The `inventory` service works on Ana's laptop with Java 21.0.4 and fails on Bruno's with Java 17; the staging server has a different time zone; production has an older `libc`. Every environment is a slightly different machine, and every difference is a bug waiting for a deploy. A **container** packages the application *together with everything it needs to run* — runtime, libraries, configuration defaults — into one immutable artifact that behaves the same on a laptop, in CI and in a Kubernetes cluster.

---

## Containers are processes, not small VMs

A **virtual machine (VM)** emulates hardware: each VM boots its own kernel on top of a hypervisor. A **container** is an ordinary Linux process that the kernel *isolates* and *limits*. All containers on a host share the host's kernel.

``` diagram
flowchart TB
    subgraph VMs["Virtual machines"]
        direction TB
        hw1["Hardware"] --> hv["Hypervisor"]
        hv --> g1["Guest OS kernel"] --> a1["catalog"]
        hv --> g2["Guest OS kernel"] --> a2["inventory"]
    end
    subgraph CT["Containers"]
        direction TB
        hw2["Hardware"] --> k["Host OS kernel<br/>namespaces + cgroups"]
        k --> c1["catalog<br/>(process)"]
        k --> c2["inventory<br/>(process)"]
    end
```

Two kernel features do the work[^4]:

| Feature | What it does | Example |
|---|---|---|
| **Namespaces** | Give the process its own *view* of the system: process IDs (`pid`), network interfaces (`net`), mount points (`mnt`), hostname (`uts`), users (`user`), IPC | Inside the container, `catalog` is PID 1 and sees only its own files and its own `eth0` |
| **Control groups (cgroups v2)** | *Limit and account* the resources the process can use: CPU time, memory, I/O, number of processes | `inventory` may use at most 1 CPU and 1 GiB; above 1 GiB the kernel kills it (`OOMKilled`) |

| | Virtual machine | Container |
|---|---|---|
| Isolation boundary | Hardware (hypervisor) — strong | Kernel (namespaces) — weaker; one kernel bug affects all |
| Start time | Tens of seconds to minutes (boot an OS) | Milliseconds to seconds (start a process) |
| Size | Gigabytes (a full OS) | Megabytes to a few hundred MB |
| Density per host | Tens | Hundreds |
| Typical use | Multi-tenant isolation, different kernels/OSes | Packaging and running services |

Because the isolation is weaker, cloud providers that run *other customers'* containers on shared hosts wrap them in lightweight VMs (AWS Firecracker under Lambda and Fargate, gVisor under Google Cloud Run). For your own services on your own nodes, plain containers are the norm.

!!! warning "The JVM must know it is in a container"

    A JVM that sizes its heap from the *host's* memory (64 GB) inside a container limited to 1 GiB will be killed by the kernel the first time it grows. Modern JVMs (Java 10+) read the cgroup limits; size the heap as a percentage of the container limit with `-XX:MaxRAMPercentage=75` and leave room for metaspace, thread stacks and direct buffers.

---

## What an image is

An **image** is a read-only template from which containers are started. The **Open Container Initiative (OCI)** standardizes its format, so an image built with Docker runs on containerd, CRI-O or Podman[^1]. An OCI image is:

- a list of **layers** — compressed tar archives, each holding the file-system changes of one build step;
- a **config** — environment variables, the default command, the user, exposed ports;
- a **manifest** that lists the config and the layers by their **digests** (SHA-256 hashes of the content).

``` diagram
flowchart LR
    m["Manifest<br/>sha256:9f2c…"] --> cfg["Config<br/>ENTRYPOINT, USER, ENV"]
    m --> l1["Layer 1: base OS files<br/>(distroless / Alpine)"]
    m --> l2["Layer 2: Java runtime"]
    m --> l3["Layer 3: dependencies (jars)"]
    m --> l4["Layer 4: application classes"]
```

Layers are **content-addressed and shared**: ten BoxOffice services built on the same base image store and download the base layers once. When a container starts, the runtime stacks the read-only layers with an overlay file system and adds a thin writable layer on top — which disappears with the container. That is why state must live in volumes or backing services.

### Tags move, digests do not

`boxoffice/inventory:1.8.3` is a **tag**: a human-friendly pointer that anyone with push rights can move to another image. `boxoffice/inventory@sha256:9f2c…` is a **digest**: it identifies exactly one content. Production deployments should reference digests (or immutable tags enforced by the registry) so that "the image we tested" is provably "the image we run".

---

## A production Dockerfile for a BoxOffice service

The `catalog` service is a Spring Boot 4 application on Java 21. A naive Dockerfile copies the source and runs Maven inside the final image — producing a large image that contains the compiler, the Maven cache and the source code. A **multi-stage build** compiles in one stage and copies only the result into a minimal runtime stage[^2]:

```dockerfile title="catalog/Dockerfile"
# ---- build stage: JDK + Maven, discarded at the end ----
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
# 1. dependencies first: this layer is cached until pom.xml changes
COPY pom.xml .
RUN mvn -q dependency:go-offline
# 2. then the source code, which changes on every commit
COPY src ./src
RUN mvn -q package -DskipTests \
 && java -Djarmode=tools -jar target/catalog.jar extract --layers --launcher --destination target/extracted

# ---- runtime stage: only a JRE, no shell, non-root ----
FROM gcr.io/distroless/java21-debian12:nonroot
WORKDIR /app
# Spring Boot layers: rarely-changing first, application classes last
COPY --from=build /src/target/extracted/dependencies/ ./
COPY --from=build /src/target/extracted/spring-boot-loader/ ./
COPY --from=build /src/target/extracted/snapshot-dependencies/ ./
COPY --from=build /src/target/extracted/application/ ./
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"
EXPOSE 8080
USER nonroot
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

Each line has a reason:

| Choice | Effect |
|---|---|
| Copy `pom.xml` and resolve dependencies **before** copying `src` | A code change rebuilds only the last layers; CI builds drop from minutes to seconds |
| Spring Boot **layered jar** extraction | The ~60 MB of dependencies become a layer that changes rarely[^3]; a deploy pushes only the few-hundred-KB application layer |
| **Distroless** base image | No shell, no package manager: smaller attack surface and fewer CVEs to patch (Alpine or `eclipse-temurin:21-jre` are common alternatives) |
| `USER nonroot` | A compromised process is not root inside the container |
| `MaxRAMPercentage=75` | Heap follows the container memory limit |
| `ExitOnOutOfMemoryError` | A JVM in a bad state dies fast and is replaced, instead of limping |
| Exec-form `ENTRYPOINT` (JSON array) | Java runs as PID 1 and receives `SIGTERM` directly, so graceful shutdown works |

Add a `.dockerignore` (with `target/`, `.git/`, `*.log`, `.env`) so the build context sent to the builder stays small and secrets do not leak into layers.

```bash
docker build -t boxoffice/catalog:1.4.0 catalog/
docker image ls boxoffice/catalog            # check the size
docker run --rm -p 8080:8080 --memory=512m --cpus=1 \
  -e SPRING_DATASOURCE_URL=jdbc:postgresql://db:5432/catalog boxoffice/catalog:1.4.0
```

!!! example "BoxOffice: what multi-stage bought us"

    With the naive single-stage image (JDK + Maven + sources) the team measured an image of roughly 800 MB; the multi-stage distroless image was under 250 MB, and a typical code change pushed a single small layer. Your numbers will differ — measure them with `docker image ls` and `docker history` — but the order of magnitude is typical. Smaller images matter for **scaling speed**: when the HPA adds 20 pods during the flash sale, each new node must pull the image before the pod can start.

!!! example "In the BoxOffice code: the `catalog` image (lab 1)"

    [Hands-on 1 — Container](../../../hands-on/1/container/index.md) writes a simpler version of the Dockerfile above, with the same two stages, a non-root user and `MaxRAMPercentage=75`. Two choices differ on purpose. Dependencies are cached with a BuildKit cache mount (`--mount=type=cache`) instead of a separate `dependency:go-offline` layer: shorter to write, but it only helps on the machine that keeps the cache. And the runtime image is `eclipse-temurin:21-jre`, not distroless, because the Compose health check runs `wget` inside the container — a distroless image has no shell and no tools. The price is a bigger image with more packages to scan, and a single fat jar that is pushed again on every change.

    ``` { .dockerfile title="services/catalog/Dockerfile (lab 1)" }
    --8<-- "docs/2027.1/hands-on/1/code/services/catalog/Dockerfile"
    ```

### Graceful shutdown: the other half of disposability { #graceful-shutdown-the-other-half-of-disposability }

When Kubernetes replaces a pod it sends `SIGTERM`, waits `terminationGracePeriodSeconds` (30 s by default), then sends `SIGKILL`. A service that dies instantly drops every in-flight request — including someone's payment. Spring Boot handles it with two properties:

```yaml title="catalog/src/main/resources/application.yaml"
server:
  shutdown: graceful            # stop accepting, finish in-flight requests
spring:
  lifecycle:
    timeout-per-shutdown-phase: 20s
```

---

## Registries and the supply chain { #supply-chain }

Images are stored in a **registry** (Docker Hub, GitHub Container Registry, Amazon ECR, Google Artifact Registry, Harbor). Because an image is everything that will run in production, the path from source to registry — the **software supply chain** — is an attack target. The minimum hygiene for BoxOffice's pipeline[^5]:

| Practice | Tool examples | Protects against |
|---|---|---|
| **Scan** images for known vulnerabilities (CVEs) and fail on critical ones | Trivy, Grype, registry scanning | Shipping a base image with a known exploit |
| Generate an **SBOM** (Software Bill of Materials: the list of every package in the image) | Syft, `docker buildx --sbom`, CycloneDX, SPDX | Not knowing whether you are affected by the next Log4Shell |
| **Sign** images and verify the signature at deploy time | Sigstore Cosign, Kyverno / admission policies | A tampered image pushed to your registry |
| Record **provenance** (who built what, from which commit) | SLSA provenance attestations, GitHub artifact attestations | An image built outside the pipeline |
| Pin base images and dependencies; rebuild regularly | Renovate, Dependabot | Silent drift and stale patches |

The [Network & security class](../../network-security/zero-trust/index.md) discusses supply-chain security in depth; the [Delivery](../delivery/index.md) page wires these steps into the CI pipeline.

---

## Docker Compose: the whole system on one machine

Compose describes a multi-container application in one YAML file. For BoxOffice it is the **local development and test environment**, not the production platform:

```yaml title="compose.yaml (excerpt)"
services:
  catalog:
    build: ./catalog
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://db:5432/boxoffice
      SPRING_DATA_REDIS_HOST: redis
    depends_on:
      db: { condition: service_healthy }
    deploy:
      resources:
        limits: { cpus: "1.0", memory: 512M }
  db:
    image: postgres:17
    environment:
      POSTGRES_DB: boxoffice
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      retries: 10
    volumes: [ "pgdata:/var/lib/postgresql/data" ]
  redis:
    image: redis:8-alpine
volumes:
  pgdata: {}
```

Services find each other by **service name** (`db`, `redis`) through Compose's internal DNS — never `localhost`, which inside a container means the container itself. Compose has no multi-host scheduling, no self-healing across machines and no rolling updates; when you need those, you need an orchestrator — the subject of the [next page](../kubernetes/index.md).

---

## Trade-offs

| Decision | Option A | Option B | Rule of thumb |
|---|---|---|---|
| Base image | Distroless / minimal | Full OS image (Debian, Ubuntu) | Minimal in production; full image only when you need debugging tools inside (use ephemeral debug containers instead) |
| Build | Dockerfile | Buildpacks (`spring-boot:build-image`), Jib | Buildpacks/Jib give good layering without a Dockerfile; a Dockerfile gives full control |
| Java startup | JIT JVM | GraalVM native image / CRaC | Native images start in milliseconds and use less memory (good for FaaS and fast scale-out), at the cost of longer builds and reflection configuration |
| Reference | Tag | Digest | Digests (or immutable tags) in production |

!!! tip "In the interview"

    Containers come up when you talk about **deployment and scaling speed**. Two crisp points are enough: "Services are packaged as immutable OCI images, promoted by digest from staging to production" and "new replicas start in seconds because images are small and layered — pull time matters when we scale out for the spike". If pressed on isolation, mention that containers share the kernel and that multi-tenant platforms add micro-VMs (Firecracker, gVisor).

!!! success "Best practices"

    - **Order the Dockerfile from what changes least to what changes most, and cache dependency downloads** — a code change then rebuilds in seconds instead of minutes. In BoxOffice: the BuildKit cache mount in [lab 1's Dockerfile](../../../hands-on/1/container/index.md).
    - **Size the heap as a share of the container limit, with about 25% left for the rest of the JVM** — metaspace, thread stacks and buffers live outside the heap. In BoxOffice: `MaxRAMPercentage=75` under a 768 MB limit ([lab 1](../../../hands-on/1/container/index.md)).
    - **Expose separate liveness and readiness endpoints from the image** — the same endpoints serve Compose's health check and Kubernetes' probes. In BoxOffice: `/actuator/health/readiness` in [lab 1](../../../hands-on/1/container/index.md) and [lab 10](../../../hands-on/10/deploy/index.md).
    - **Finish in-flight requests on `SIGTERM` within less than the grace period** — 20 s of shutdown phase against Kubernetes' 30 s leaves margin before `SIGKILL`. In BoxOffice: `SERVER_SHUTDOWN=graceful` in [lab 10](../../../hands-on/10/deploy/index.md).
    - **Let a bot propose base-image and library updates every week, and scan every image in CI** — patches arrive as small reviewed pull requests, and a critical CVE with a fix blocks the push. In BoxOffice: `dependabot.yml` and the Trivy gate of [lab 11 — supply chain](../../../hands-on/11/supply-chain/index.md).

!!! warning "Pitfalls"

    - **`latest` in production**: you do not know what is running, and rollback is ambiguous.
    - **Secrets baked into layers**: a `COPY .env` or `ARG PASSWORD` stays in the image history forever — even if a later layer deletes the file.
    - **Running as root** and with a full shell: one RCE becomes a foothold.
    - **No memory limit, or a heap larger than the limit**: random `OOMKilled` restarts under load.
    - **Shell-form `ENTRYPOINT`** (`ENTRYPOINT java -jar app.jar`): `sh` becomes PID 1, swallows `SIGTERM`, and every deploy kills requests mid-flight.
    - **Writing state to the container file system**: it is gone at the next restart.

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    NS["namespaces + cgroups"] --> CT["container =<br/>isolated process"]
    IMG["OCI image: layers,<br/>config, manifest"] --> CT
    IMG --> DIG["digest, not tag:<br/>build once, promote"]
    DIG --> DEL["CI and GitOps<br/>→ Delivery"]
    IMG --> SC["scan, SBOM, sign<br/>→ Network & security"]
    CT --> MEM["memory limit → OOMKilled<br/>JVM MaxRAMPercentage"]
    CT --> SIG["SIGTERM, graceful shutdown<br/>→ safe rolling updates"]
    MEM --> K8S["pods, probes, limits<br/>→ Kubernetes"]
    SIG --> K8S
    CMP["Docker Compose:<br/>local environment"] --> CT
    CT --> VM["Firecracker, gVisor<br/>under FaaS → Compute"]
```

**Palette components:** [`app`](../../../reference/components/compute/index.md#app) (every BoxOffice service is an image) · [`worker`](../../../reference/components/compute/index.md#worker) · [`serverless`](../../../reference/components/compute/index.md#serverless) (containers wrapped in micro-VMs). **Scenarios:** `scale-out` (small images start replicas fast), `serverless-burst` (cold starts). **Continues in:** [Kubernetes](../kubernetes/index.md), [Delivery](../delivery/index.md), [Network & security — supply-chain security](../../network-security/zero-trust/index.md#supply-chain-security), [Compute — serverless and autoscaling](../../compute/serverless-autoscaling/index.md), [Hands-on 1 — container](../../../hands-on/1/container/index.md).

---

[^1]: Open Container Initiative. [OCI Image Format Specification](https://github.com/opencontainers/image-spec){target="_blank"}.
[^2]: Docker. [Multi-stage builds](https://docs.docker.com/build/building/multi-stage/){target="_blank"} and [Dockerfile best practices](https://docs.docker.com/build/building/best-practices/){target="_blank"}.
[^3]: Spring Boot reference. [Efficient container images](https://docs.spring.io/spring-boot/reference/packaging/container-images/efficient-images.html){target="_blank"}.
[^4]: KERRISK, M. [Namespaces in operation](https://lwn.net/Articles/531114/){target="_blank"}. LWN.net, 2013.
[^5]: OpenSSF. [SLSA — Supply-chain Levels for Software Artifacts](https://slsa.dev/){target="_blank"}.
