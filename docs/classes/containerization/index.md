
When a server cannot handle growing traffic, two strategies exist:

**Vertical scaling** (scale-up)
: Replace the server with a more powerful one — more CPU, RAM, faster disk. Simple, but bounded: there is a physical limit to how large a single machine can be, and upgrades require downtime.

**Horizontal scaling** (scale-out)
: Add more servers and distribute the load across them. Theoretically unbounded, but introduces a critical problem: **consistency across environments**.

``` mermaid
flowchart LR
    subgraph vs [Vertical Scaling]
        s1["Server\n4 CPU / 8 GB"]:::small -->|upgrade| s2["Server\n32 CPU / 128 GB"]:::big
    end
    subgraph hs [Horizontal Scaling]
        lb[Load Balancer] --> n1[Server 1]
        lb --> n2[Server 2]
        lb --> n3[Server 3]
    end
    classDef small fill:#ddd
    classDef big fill:#6c6,color:#fff
```

An application that works on a developer's laptop may fail in production because of different OS versions, library versions, or environment variables — the infamous *"it works on my machine"* problem. **Containerisation** solves this by packaging the application together with all its dependencies into a portable, self-contained unit that runs identically everywhere.

---

## Containers vs. Virtual Machines

Both containers and virtual machines (VMs) provide isolation, but at different levels of the stack:

``` mermaid
flowchart TB
    subgraph vm [Virtual Machines]
        direction TB
        hw_vm[Physical Hardware]:::infra
        hvm[Hypervisor]:::infra
        os1[Guest OS 1]:::customer
        os2[Guest OS 2]:::customer
        app1[App A]:::customer
        app2[App B]:::customer
        hw_vm --> hvm --> os1 & os2
        os1 --> app1
        os2 --> app2
    end
    subgraph ct [Containers]
        direction TB
        hw_ct[Physical Hardware]:::infra
        os_ct[Host OS + Kernel]:::infra
        engine[Container Engine]:::infra
        c1[Container A]:::customer
        c2[Container B]:::customer
        hw_ct --> os_ct --> engine --> c1 & c2
    end
    classDef infra fill:#a8e6cf,stroke:#333
    classDef customer fill:#ffd3b6,stroke:#333
```

:material-square:{ style="color:#a8e6cf" } Provider / shared layer &nbsp;&nbsp; :material-square:{ style="color:#ffd3b6" } Application layer

| Aspect | Docker Containers | Virtual Machines |
|---|---|---|
| **Isolation** | Process-level — share the host kernel | Full OS isolation — each VM has its own kernel |
| **Resource overhead** | Lightweight — no duplicate OS per container | Higher — each VM carries a complete OS |
| **Startup time** | Seconds | Minutes (full OS boot) |
| **Portability** | High — image bundles app and all dependencies | Lower — OS-specific configuration |
| **Security boundary** | Weaker (shared kernel) | Stronger (separate kernel) |
| **Typical use** | Microservices, CI/CD, horizontal scaling | Different guest OS, strong isolation requirements |

The key insight: containers share the host kernel, so they start in seconds and consume far less memory. VMs carry their own kernel — giving stronger isolation at the cost of higher overhead.

---

## The container lifecycle

``` mermaid
flowchart LR
    src[Source Code\n+ Dockerfile] -->|docker build| img[Image\n:tag]
    img -->|docker push| reg[(Registry\nDocker Hub / ECR)]
    reg -->|docker pull| deploy[Any Host]
    deploy -->|docker run| c1[Container 1]
    deploy -->|docker run| c2[Container 2]
    deploy -->|docker run| c3[Container 3]
```

A **Dockerfile** describes how to build the image. An **image** is the immutable artifact — it gets versioned, stored in a registry, and pulled onto any machine. A **container** is a running instance of an image — isolated, ephemeral, and disposable.

---

## Topics covered

<div class="grid cards" markdown>

-   :fontawesome-brands-docker:{ .lg .middle } **Docker**

    ---

    Core concepts of Docker: images, containers, the Docker Engine, Dockerfiles (including multi-stage builds), essential commands, networking, and volumes.

    [:octicons-arrow-right-24: Docker](docker/index.md)

-   :material-file-code:{ .lg .middle } **Docker Compose**

    ---

    Declarative multi-container orchestration with `compose.yaml`. Covers service definitions, networking, volumes, environment variables, health checks, and dependency ordering.

    [:octicons-arrow-right-24: Docker Compose](compose/index.md)

</div>

---

## Containerisation in the cloud

Cloud providers offer managed container services that add automatic scheduling, scaling, load balancing, and deep integration with other cloud services on top of the container model:

| Service | Provider | Model |
|---|---|---|
| **ECS / Fargate** | AWS | Managed containers — no cluster to operate |
| **EKS** | AWS | Managed Kubernetes |
| **Cloud Run** | Google | Serverless containers — scales to zero |
| **GKE** | Google | Managed Kubernetes |
| **AKS** | Azure | Managed Kubernetes |

=== ":fontawesome-brands-google: Google"

    :fontawesome-brands-youtube:{ .youtube } [Inside a Google data center](https://youtu.be/XZmGGAbHqa0){:target='_blank'}

    [![](https://img.youtube.com/vi/XZmGGAbHqa0/0.jpg){ width=100% }](https://youtu.be/XZmGGAbHqa0){:target='_blank'}

=== ":fontawesome-brands-aws: AWS"

    :fontawesome-brands-youtube:{ .youtube } [Inside Amazon's Massive Data Center](https://youtu.be/q6WlzHLxNKI){:target='_blank'}

    [![](https://img.youtube.com/vi/q6WlzHLxNKI/0.jpg){ width=100% }](https://youtu.be/q6WlzHLxNKI){:target='_blank'}

=== ":simple-tesla: Tesla"

    :fontawesome-brands-youtube:{ .youtube } [Inside Elon Musk's Colossus Supercomputer!](https://youtu.be/Tw696JVSxJQ){:target='_blank'}

    [![](https://img.youtube.com/vi/Tw696JVSxJQ/0.jpg){ width=100% }](https://youtu.be/Tw696JVSxJQ){:target='_blank'}

---

[^1]: [Docker Documentation](https://docs.docker.com/){:target="_blank"}
[^2]: [Docker vs. Virtual Machines: Differences You Should Know](https://cloudacademy.com/blog/docker-vs-virtual-machines-differences-you-should-know/){:target="_blank"}
[^3]: BURNS, B. et al. *Kubernetes: Up and Running*, 3rd ed. O'Reilly, 2022.
