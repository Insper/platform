# Tools

The tools of the trade, grouped by job. For each one: what it is in one line, when to reach for it, the lab where we use it in this course, and its official site. The course stack is deliberately small: **Docker Compose** to run everything locally, **k6** to load-test, **OpenTelemetry + `grafana/otel-lgtm`** to observe, **Toxiproxy** to inject faults, **kind or minikube** for Kubernetes, **GitHub Actions** and **Argo CD** to deliver, and **LiteLLM + Ollama + pgvector** for the AI service. The alternatives are listed so you recognize them in job descriptions and engineering blogs.

!!! note "About the links"
    Links go to each project's official site or official repository. Tools change fast: check the current documentation before copying a command from a blog post, and pin versions in your `docker-compose.yaml` and CI files.

## Which tool for which job

| Job | In this course | Common alternatives | Lab |
|---|---|---|---|
| Run the whole system locally | Docker + Docker Compose | Podman, Tilt | [Hands-on 0](../../hands-on/0/index.md) |
| Load test an HTTP API | k6 | Gatling, Locust, JMeter, wrk2, vegeta | [Hands-on 2](../../hands-on/2/index.md) |
| Inject latency and failures | Toxiproxy | Chaos Mesh, LitmusChaos, AWS FIS, Gremlin, Pumba | [Hands-on 9](../../hands-on/9/index.md) |
| Metrics, logs and traces | OpenTelemetry + `grafana/otel-lgtm` | Prometheus + Grafana + Loki + Tempo, Jaeger, commercial APM | [Hands-on 8](../../hands-on/8/index.md) |
| Find where the CPU goes | async-profiler (Java) | Pyroscope, `perf` | [Class 15](../../classes/performance/bottlenecks/index.md) |
| Explain a slow query | `EXPLAIN (ANALYZE, BUFFERS)` + explain.dalibo.com | pgAdmin, pganalyze | [Hands-on 6](../../hands-on/6/index.md) |
| Local Kubernetes | kind or minikube | k3d, Docker Desktop Kubernetes | [Hands-on 10](../../hands-on/10/index.md) |
| CI pipeline | GitHub Actions | GitLab CI, Jenkins | [Hands-on 11](../../hands-on/11/index.md) |
| GitOps and progressive delivery | Argo CD (+ Argo Rollouts) | Flux, Flagger | [Hands-on 11](../../hands-on/11/index.md) |
| Infrastructure as code | Terraform / OpenTofu | Pulumi, Crossplane, cloud-native templates | [Class 11](../../classes/cloud-native/index.md) |
| Scan images and produce an SBOM | Trivy + Syft | Grype, Docker Scout | [Hands-on 11](../../hands-on/11/index.md) |
| Draw an architecture | Excalidraw, Mermaid | diagrams.net, PlantUML, Structurizr | every class |
| Call LLMs through one gateway | LiteLLM (+ Ollama locally) | Envoy AI Gateway, cloud gateways | [Hands-on 12](../../hands-on/12/index.md) |
| Test prompts and guardrails | promptfoo | custom eval scripts | [Hands-on 12](../../hands-on/12/index.md) |

## Load testing

| Tool | What it is | Reach for it when | In the course | Site |
|---|---|---|---|---|
| **k6** | Load-testing tool scripted in JavaScript, with thresholds that fail a run (great for CI) | You want readable scripts, smoke/load/stress/spike/soak profiles and pass/fail thresholds | [Hands-on 2](../../hands-on/2/index.md), every "Measure it" step, CI gate in [Hands-on 11](../../hands-on/11/index.md) | [k6.io](https://k6.io) |
| **Gatling** | Load-testing tool with scenarios in Java, Kotlin or Scala and detailed HTML reports | Your team lives on the JVM and wants code-first scenarios | Alternative to k6 | [gatling.io](https://gatling.io) |
| **Locust** | Load testing with user behavior written in Python | You prefer Python, or need custom protocols | Alternative to k6 | [locust.io](https://locust.io) |
| **Apache JMeter** | Veteran GUI-based load-testing tool, many protocols | You inherit existing JMeter plans or need its protocol plugins | Recognize it | [jmeter.apache.org](https://jmeter.apache.org) |
| **wrk2** | Tiny HTTP benchmarking tool with a constant request rate, corrected for coordinated omission | You need a quick, honest latency distribution at a fixed rate | [Class 15](../../classes/performance/load-testing/index.md) (coordinated omission) | [github.com/giltene/wrk2](https://github.com/giltene/wrk2) |
| **vegeta** | HTTP load tool with a constant attack rate, usable as a CLI or Go library | Open-model (fixed-rate) tests from the command line | Alternative for quick tests | [github.com/tsenart/vegeta](https://github.com/tsenart/vegeta) |
| **oha** / **hey** | Minimal command-line HTTP load generators | A ten-second sanity check, not a test campaign | Quick checks | [oha](https://github.com/hatoo/oha) · [hey](https://github.com/rakyll/hey) |

!!! tip "Open vs closed workload"
    Most tools default to a **closed** model (N virtual users, each waiting for its response before sending the next). Real internet traffic is closer to an **open** model (requests arrive at a rate, whether or not the server keeps up). k6's `constant-arrival-rate` and `ramping-arrival-rate` executors, wrk2 and vegeta generate open load; use them when you want to see queues build up. See [Class 15 · Load testing](../../classes/performance/load-testing/index.md).

## Chaos and fault injection

| Tool | What it is | Reach for it when | In the course | Site |
|---|---|---|---|---|
| **Toxiproxy** | TCP proxy that adds latency, bandwidth limits, timeouts and connection drops, controlled by an API | Testing timeouts, retries and circuit breakers between two services, locally or in CI | [Hands-on 9](../../hands-on/9/index.md) | [github.com/Shopify/toxiproxy](https://github.com/Shopify/toxiproxy) |
| **Chaos Mesh** | Kubernetes-native chaos (pod kill, network delay, stress, time skew) defined as custom resources | Chaos experiments inside a Kubernetes cluster | Optional in [Hands-on 10](../../hands-on/10/index.md) | [chaos-mesh.org](https://chaos-mesh.org) |
| **LitmusChaos** | Kubernetes chaos engineering platform with a hub of ready experiments | Scheduled, repeatable chaos workflows on Kubernetes | Recognize it | [litmuschaos.io](https://litmuschaos.io) |
| **AWS Fault Injection Service (FIS)** | Managed fault injection for AWS resources (stop instances, throttle APIs, AZ disruptions) | Game days on AWS infrastructure | Recognize it | [aws.amazon.com/fis](https://aws.amazon.com/fis/) |
| **Gremlin** | Commercial chaos engineering platform | Organizations that want a managed, audited chaos practice | Recognize it | [gremlin.com](https://www.gremlin.com) |
| **Pumba** | Chaos for Docker containers (kill, pause, network emulation with `tc`) | Breaking containers in a Compose environment | Optional in the [game day](../../exercises/project/game-day/index.md) | [github.com/alexei-led/pumba](https://github.com/alexei-led/pumba) |

## Observability

| Tool | What it is | Reach for it when | In the course | Site |
|---|---|---|---|---|
| **OpenTelemetry** | Vendor-neutral APIs, SDKs, auto-instrumentation agents and the Collector for metrics, logs and traces | Always: instrument once, send anywhere | [Hands-on 8](../../hands-on/8/index.md) | [opentelemetry.io](https://opentelemetry.io) |
| **`grafana/otel-lgtm`** | One Docker image with an OpenTelemetry Collector, Prometheus/Mimir, Loki, Tempo, Pyroscope and Grafana | A complete local observability stack in one container | [Hands-on 8](../../hands-on/8/index.md) | [github.com/grafana/docker-otel-lgtm](https://github.com/grafana/docker-otel-lgtm) |
| **Prometheus** | Pull-based metrics database with PromQL and alerting rules | Metrics and alerts, especially on Kubernetes | [Hands-on 8](../../hands-on/8/index.md), [Hands-on 10](../../hands-on/10/index.md) | [prometheus.io](https://prometheus.io) |
| **Grafana** | Dashboards and alerting over many data sources | RED/USE dashboards, SLO panels | [Hands-on 8](../../hands-on/8/index.md) | [grafana.com](https://grafana.com) |
| **Grafana Loki** | Log aggregation indexed by labels | Cheap, searchable logs next to your metrics | [Hands-on 8](../../hands-on/8/index.md) | [grafana.com/oss/loki](https://grafana.com/oss/loki/) |
| **Grafana Tempo** | Trace storage on object storage | Storing traces cheaply, linked from metrics and logs | [Hands-on 8](../../hands-on/8/index.md) | [grafana.com/oss/tempo](https://grafana.com/oss/tempo/) |
| **Jaeger** | Distributed tracing back end and UI (CNCF) | A standalone tracing UI | Alternative to Tempo | [jaegertracing.io](https://www.jaegertracing.io) |
| **Grafana Pyroscope** | Continuous profiling | Seeing flame graphs over time in production | Optional | [grafana.com/oss/pyroscope](https://grafana.com/oss/pyroscope/) |
| **async-profiler** | Low-overhead sampling profiler for the JVM that produces flame graphs | Finding where a Java service spends CPU or allocates memory | [Class 15](../../classes/performance/bottlenecks/index.md) | [github.com/async-profiler/async-profiler](https://github.com/async-profiler/async-profiler) |

## Infrastructure as code and configuration

| Tool | What it is | Reach for it when | In the course | Site |
|---|---|---|---|---|
| **Terraform** | Declarative infrastructure as code with providers for every cloud (HCL language) | Creating cloud resources reproducibly, with plans and reviews | [Class 11](../../classes/cloud-native/index.md) | [terraform.io](https://www.terraform.io) |
| **OpenTofu** | Open-source fork of Terraform (Linux Foundation), compatible with its language | Same as Terraform, with an open-source license | [Class 11](../../classes/cloud-native/index.md) | [opentofu.org](https://opentofu.org) |
| **Pulumi** | Infrastructure as code in general-purpose languages (TypeScript, Python, Go, Java…) | Your team prefers real programming languages to HCL | Recognize it | [pulumi.com](https://www.pulumi.com) |
| **Ansible** | Agentless configuration management over SSH with YAML playbooks | Configuring virtual machines and their software | Recognize it | [ansible.com](https://www.ansible.com) |
| **Helm** | Package manager for Kubernetes (charts with templates and values) | Installing third-party software on Kubernetes, packaging your own | Optional in [Hands-on 10](../../hands-on/10/index.md) | [helm.sh](https://helm.sh) |
| **Kustomize** | Template-free customization of Kubernetes YAML with overlays (built into `kubectl`) | One base manifest, small differences per environment | [Hands-on 10](../../hands-on/10/index.md), [Hands-on 11](../../hands-on/11/index.md) | [kustomize.io](https://kustomize.io) |
| **Crossplane** | Manages cloud resources as Kubernetes custom resources | Platform teams building self-service APIs on Kubernetes | Recognize it | [crossplane.io](https://www.crossplane.io) |

## CI/CD and GitOps

| Tool | What it is | Reach for it when | In the course | Site |
|---|---|---|---|---|
| **GitHub Actions** | CI/CD workflows defined in YAML in the repository | Build, test, scan, build images and run k6 gates on every push | [Hands-on 11](../../hands-on/11/index.md) | [github.com/features/actions](https://github.com/features/actions) |
| **Argo CD** | GitOps controller: keeps a Kubernetes cluster in sync with manifests in Git | Deployments that are reviewed as pull requests and self-heal from drift | [Hands-on 11](../../hands-on/11/index.md) | [argo-cd.readthedocs.io](https://argo-cd.readthedocs.io) |
| **Argo Rollouts** | Progressive delivery for Kubernetes: canary and blue/green with automated analysis | Canary releases that roll back on bad metrics | [Hands-on 11](../../hands-on/11/index.md) | [argoproj.github.io](https://argoproj.github.io) |
| **Flux** | GitOps toolkit for Kubernetes (CNCF) | Alternative to Argo CD | Recognize it | [fluxcd.io](https://fluxcd.io) |

## Containers and local clusters

| Tool | What it is | Reach for it when | In the course | Site |
|---|---|---|---|---|
| **Docker** | Builds and runs OCI container images | Packaging every service | [Hands-on 0](../../hands-on/0/index.md), [Hands-on 1](../../hands-on/1/index.md) | [docker.com](https://www.docker.com) |
| **Docker Compose** | Runs multi-container applications from one YAML file | The whole BoxOffice stack on a laptop | Every lab | [docs.docker.com/compose](https://docs.docker.com/compose/) |
| **Podman** | Daemonless, rootless container engine compatible with the Docker CLI | Environments where Docker Desktop is not an option | Alternative | [podman.io](https://podman.io) |
| **kind** | Kubernetes clusters running in Docker containers | Fast, disposable clusters locally and in CI | [Hands-on 10](../../hands-on/10/index.md) | [kind.sigs.k8s.io](https://kind.sigs.k8s.io) |
| **minikube** | Local single- or multi-node Kubernetes with add-ons (ingress, metrics-server) | Learning Kubernetes with batteries included | [Hands-on 10](../../hands-on/10/index.md) | [minikube.sigs.k8s.io](https://minikube.sigs.k8s.io) |
| **k3d** | Runs the lightweight k3s distribution in Docker | Very light local clusters | Alternative | [k3d.io](https://k3d.io) |
| **kubectl** | The Kubernetes command-line client | Everything on a cluster | [Hands-on 10](../../hands-on/10/index.md) | [kubernetes.io/docs/reference/kubectl](https://kubernetes.io/docs/reference/kubectl/) |
| **k9s** | Terminal UI for Kubernetes | Watching pods, logs and events while a load test runs | Optional | [k9scli.io](https://k9scli.io) |

## Diagramming

| Tool | What it is | Reach for it when | In the course | Site |
|---|---|---|---|---|
| **Excalidraw** | Hand-drawn style whiteboard in the browser, with collaboration | Interviews, mock interviews, quick sketches | [Mock interviews](../../support/interview/mock/index.md) | [excalidraw.com](https://excalidraw.com) |
| **Mermaid** | Diagrams as text (flowchart, sequence, state) rendered in Markdown | Diagrams that live in the repository next to the code — like the ones on this site | Every class | [mermaid.js.org](https://mermaid.js.org) |
| **diagrams.net (draw.io)** | Free diagram editor with cloud icon sets | Detailed architecture diagrams with official cloud icons | Project design doc | [drawio.com](https://www.drawio.com) |
| **PlantUML** | Diagrams as text, strong on UML and C4 | Teams that already use UML | Recognize it | [plantuml.com](https://plantuml.com) |
| **Structurizr** / **C4 model** | The C4 model (context, containers, components, code) and a tool to keep diagrams as code | Design docs with several consistent levels of zoom | [Design doc](../../exercises/design-doc/index.md) | [c4model.com](https://c4model.com) · [structurizr.com](https://structurizr.com) |
| **System Design Playground** | The course simulator: design with the palette and run it under load | Testing whether a design survives, not just drawing it | [Playground](../../../playground/index.md) | — |

## Databases and caching

| Tool | What it is | Reach for it when | In the course | Site |
|---|---|---|---|---|
| **psql** | PostgreSQL's interactive terminal | Running queries, `EXPLAIN`, inspecting locks | [Hands-on 1](../../hands-on/1/index.md), [Hands-on 6](../../hands-on/6/index.md) | [postgresql.org](https://www.postgresql.org) |
| **pgbench** | PostgreSQL's built-in benchmarking tool | Measuring the database alone, without the application | [Hands-on 6](../../hands-on/6/index.md) | [postgresql.org/docs/current/pgbench.html](https://www.postgresql.org/docs/current/pgbench.html) |
| **explain.dalibo.com** | Visualizer for PostgreSQL execution plans | Reading a long `EXPLAIN (ANALYZE)` output | [Hands-on 6](../../hands-on/6/index.md) | [explain.dalibo.com](https://explain.dalibo.com) |
| **PgBouncer** | Lightweight connection pooler for PostgreSQL | Many app replicas, limited database connections | [Hands-on 6](../../hands-on/6/index.md) | [pgbouncer.org](https://www.pgbouncer.org) |
| **redis-cli** / **redis-benchmark** | Redis's command-line client and benchmark | Inspecting keys and TTLs, `MONITOR`, measuring Redis alone | [Hands-on 5](../../hands-on/5/index.md) | [redis.io](https://redis.io) |
| **kcat** | Command-line Kafka producer and consumer (formerly kafkacat) | Peeking at topics, producing test events | [Hands-on 7](../../hands-on/7/index.md) | [github.com/edenhill/kcat](https://github.com/edenhill/kcat) |

## Security and supply chain

| Tool | What it is | Reach for it when | In the course | Site |
|---|---|---|---|---|
| **Trivy** | Scanner for vulnerabilities and misconfigurations in images, file systems and IaC | Failing the CI build on critical CVEs | [Hands-on 11](../../hands-on/11/index.md) | [github.com/aquasecurity/trivy](https://github.com/aquasecurity/trivy) |
| **Syft** | Generates a software bill of materials (SBOM) from images and directories | Knowing exactly what ships in each image | [Hands-on 11](../../hands-on/11/index.md) | [github.com/anchore/syft](https://github.com/anchore/syft) |
| **Grype** | Vulnerability scanner that works on images and SBOMs | Scanning an SBOM produced by Syft | Alternative to Trivy | [github.com/anchore/grype](https://github.com/anchore/grype) |
| **cosign** (Sigstore) | Signs and verifies container images and attestations | Proving an image came from your pipeline | [Hands-on 11](../../hands-on/11/index.md) | [github.com/sigstore/cosign](https://github.com/sigstore/cosign) |
| **OWASP ZAP** | Dynamic application security scanner (proxy and automated scans) | Checking a running API for common vulnerabilities | Optional in [Hands-on 4](../../hands-on/4/index.md) | [zaproxy.org](https://www.zaproxy.org) |
| **Keycloak** | Open-source identity provider (OIDC, OAuth 2) | A real authorization server for local development | [Hands-on 4](../../hands-on/4/index.md) | [keycloak.org](https://www.keycloak.org) |

## API tools

| Tool | What it is | Reach for it when | In the course | Site |
|---|---|---|---|---|
| **curl** | The universal command-line HTTP client | Any quick request, in scripts and docs | Every lab | [curl.se](https://curl.se) |
| **HTTPie** | Friendlier command-line HTTP client with JSON support | Exploring an API by hand | Optional | [httpie.io](https://httpie.io) |
| **Bruno** | Open-source API client whose collections are plain files in Git | Sharing API requests with the team through the repository | Optional | [usebruno.com](https://www.usebruno.com) |
| **Postman** | Popular API platform for requests, collections and tests | Teams that already use it | Recognize it | [postman.com](https://www.postman.com) |
| **grpcurl** | curl for gRPC servers | Calling gRPC services by hand | [Class 5](../../classes/compute/api-styles/index.md) | [github.com/fullstorydev/grpcurl](https://github.com/fullstorydev/grpcurl) |

## AI systems

| Tool | What it is | Reach for it when | In the course | Site |
|---|---|---|---|---|
| **LiteLLM** | LLM gateway/proxy with an OpenAI-compatible API, budgets, fallbacks and cost tracking | One front door to local and hosted models | [Hands-on 12](../../hands-on/12/index.md) | [github.com/BerriAI/litellm](https://github.com/BerriAI/litellm) |
| **Ollama** | Runs open-weight models locally behind an HTTP API | Developing without API keys or costs | [Hands-on 12](../../hands-on/12/index.md) | [ollama.com](https://ollama.com) |
| **pgvector** | Vector type and similarity indexes (HNSW, IVFFlat) for PostgreSQL | RAG without adding a new database | [Hands-on 12](../../hands-on/12/index.md) | [github.com/pgvector/pgvector](https://github.com/pgvector/pgvector) |
| **Model Context Protocol** + **MCP Inspector** | Open protocol for exposing tools to models, and a tool to test MCP servers | Building and debugging the assistant's tools | [Hands-on 12](../../hands-on/12/index.md) | [modelcontextprotocol.io](https://modelcontextprotocol.io) · [inspector](https://github.com/modelcontextprotocol/inspector) |
| **promptfoo** | Tests and red-teaming for prompts, RAG and guardrails, runnable in CI | Catching regressions in answers and injection defenses | [Hands-on 12](../../hands-on/12/index.md) | [promptfoo.dev](https://www.promptfoo.dev) |

!!! tip "Learn the job, not just the tool"
    Interviewers rarely care whether you used k6 or Gatling. They care whether you know **what** to measure (percentiles at a target rate, the knee, the bottleneck) and **why**. Learn one tool per job well, and be able to say what its alternatives do differently.
