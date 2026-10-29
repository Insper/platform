!!! abstract "In this lab"

    - Install and check the toolchain used in **every** lab: Docker + Compose, JDK 21, Maven, uv + Python 3.12, k6, kubectl, kind or minikube, Git.
    - Create **your BoxOffice repository** with the layout that the next twelve labs fill in.
    - Learn the **service names, ports, environment variables and conventions** that every lab shares.
    - **Measure** your machine for the first time: how many requests per second can it serve, and with what latency?

During the semester you will build **BoxOffice**, a ticketing platform for concerts, games and festivals. It starts as one small service on your laptop and grows, lab after lab, into a system with an edge proxy, an API gateway, a cache, a replicated database, an event stream, observability, Kubernetes and an AI assistant. Each lab adds one component of the [System Design Playground](../../../playground/index.md) palette, and **each lab ends with a measurement**: system design is about trade-offs, and a trade-off is only real when you can put a number on it.

This first lab is short but important: a broken environment costs hours later, in the middle of a load test.

## Before you start { #before-you-start }

| | |
|---|---|
| **Time** | 1–2 hours (most of it is downloads) |
| **You need** | a computer with **8 GB of RAM or more** (16 GB is comfortable from lab 4 on), ~20 GB of free disk, administrator rights, internet access |
| **Operating system** | macOS, Linux, or Windows 10/11 with **WSL 2** (every command of the course runs in a Linux shell) |
| **Start state** | nothing: this lab creates the `boxoffice/` repository from an empty folder |

!!! info "First lab"

    There is nothing to catch up on: every later lab starts from the state at the end of the previous one, and each lab page offers a ready-made `boxoffice-after-lab-<n>.zip` if you skip or break a lab.

## Slides

<div class="slides-embed">
  <iframe src="slides/environment.html" title="Slides: hands-on 0 — environment" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/environment.html){:target="_blank"}

## Where we are going

The diagram shows BoxOffice at the end of the semester. Do not worry about the details: every box has its own lab, and the number in each label says which one.

``` diagram
flowchart LR
    user([Fan / k6]) --> edge["edge<br/>Nginx · lab 3"]
    edge --> gw["gateway<br/>lab 4"]
    gw --> auth["auth<br/>lab 4"]
    gw --> catalog["catalog ×3<br/>lab 1"]
    gw --> inventory["inventory<br/>lab 6"]
    gw --> order["order<br/>lab 7"]
    gw --> assistant["assistant<br/>lab 12"]
    catalog --> redis[("redis<br/>lab 5")]
    catalog --> db[("db<br/>PostgreSQL")]
    inventory --> pgb["pgbouncer<br/>lab 6"] --> db
    inventory --> replica[("db-replica<br/>lab 6")]
    order --> kafka[["kafka<br/>lab 7"]]
    kafka --> notification["notification<br/>lab 7"]
    order --> payment["payment<br/>lab 9"]
```

!!! info "Theory connection"

    In the [story of the course](../../index.md#story), this lab opens chapter 1: before any design, a number — how many requests per second *your* machine serves, the first of the [measurable requirements](../../classes/intro/requirements/index.md) every later lab checks.

    This lab pairs with class 1, [What is system design](../../classes/intro/index.md): the scaling journey of BoxOffice from one server to millions of users is exactly the path the labs follow. The "Measure it" step at the end connects with class 2, [Estimation](../../classes/estimation/index.md).

## BoxOffice services and ports { #boxoffice-services-and-ports }

Every lab — and every team project — uses the names below. **Do not rename them**: the configuration files, the k6 scripts and the next labs assume them. A service listens on the **same port inside its container and on your machine**, so `http://catalog:8082` (from another container) and `http://localhost:8082` (from your terminal) reach the same service.

**Application services** (one folder each under `services/`):

| Compose service | Lab | Stack | Port | Public route prefix | DB schema | Role |
|---|---|---|---|---|---|---|
| `edge` | 3 | Nginx 1.30 | **80** | — | — | reverse proxy, load balancer, rate limiting: the only public entry from lab 3 on |
| `gateway` | 4 | Spring Cloud Gateway | **8080** | all of them | — | routing, JWT validation, identity headers |
| `auth` | 4 | Spring Boot | **8081** | `/auth/**` | `auth` | users, login, issues JWTs (RS256) and publishes the JWKS |
| `catalog` | 1 | Spring Boot | **8082** | `/catalog/**` | `catalog` | events and venues (read-heavy). Runs as `catalog-1`, `catalog-2`, `catalog-3` from lab 3 on |
| `inventory` | 6 | Spring Boot | **8083** | `/inventory/**` | `inventory` | seats and holds (strongly consistent) |
| `order` | 7 | Spring Boot | **8084** | `/orders/**` | `orders` | orders, transactional outbox |
| `payment` | 9 | Spring Boot | **8085** | `/payments/**` | `payment` | adapter to the external payment provider |
| `notification` | 7 | Spring Boot | **8086** | `/notifications/**` | `notification` | e-mail/push, idempotent consumer |
| `search` | — | (optional) | **8087** | `/search/**` | — | reserved for the project |
| `assistant` | 12 | Python 3.12 + FastAPI | **8088** | `/assistant/**` | `assistant` | AI support assistant (RAG + tools) |

**Infrastructure** (official images, configuration under `infra/`):

| Compose service | Lab | Image | Port(s) on your machine | Notes |
|---|---|---|---|---|
| `db` | 1 | `postgres:17` | **5432** | database `boxoffice`, user `boxoffice`, password `boxoffice`; **one schema per service** |
| `db-replica` | 6 | `postgres:17` | **5433** | streaming replica of `db`, read-only |
| `pgbouncer` | 6 | `edoburu/pgbouncer:v1.26.0-p0` | **6432** | connection pooler in front of `db` |
| `redis` | 5 | `redis:8-alpine` | **6379** | cache (`maxmemory` + LRU) |
| `kafka` | 7 | Apache Kafka (KRaft) | **9092** | event stream |
| `otel-lgtm` | 8 | `grafana/otel-lgtm` | **3000** (Grafana), **4317**/**4318** (OTLP gRPC/HTTP) | metrics, logs, traces |
| `toxiproxy` | 9 | `ghcr.io/shopify/toxiproxy` | **8474** (API) | latency and fault injection |
| `ollama` | 12 | `ollama/ollama` | **11434** | local LLM |
| k6 web dashboard | 2 | — | **5665** | `K6_WEB_DASHBOARD=true k6 run …` |
| hello (lab 0 only) | 0 | `nginx:1.30-alpine` | **8888** | target of the baseline measurement |

**Conventions** shared by all services:

| Topic | Convention |
|---|---|
| Java | JDK **21**, Spring Boot **4.1.x** (Spring Framework 7, Jackson 3), Spring Cloud **2025.1.x**, Maven, no Lombok (Java `record`s for DTOs) |
| Python | Python 3.12 managed by **uv** (`uv init`, `uv add <pkg>`, `uv run <cmd>`, `uvx <tool>`); never `pip`/`venv`. Dockerfiles copy uv with `COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/` and run `uv sync --frozen` |
| Packages | `boxoffice.<service>` (e.g. `boxoffice.catalog`); Maven `groupId` `boxoffice`, `artifactId` = service name |
| HTTP paths | each service serves **only** under its prefix (`catalog` → `/catalog/...`), so the edge and the gateway route without rewriting paths |
| Database | one PostgreSQL instance (`db`), one **schema per service**, owned by that service's Flyway migrations (`src/main/resources/db/migration`); no cross-schema joins |
| Health | Spring Boot Actuator: `/actuator/health`, `/actuator/health/liveness`, `/actuator/health/readiness`, `/actuator/metrics` |
| Errors | RFC 9457 `application/problem+json` (`spring.mvc.problemdetails.enabled: true`) |
| Compose file | `docker-compose.yaml` at the repository root, project name `boxoffice` |
| Load scripts | `load/*.js` (k6), base URL from `BASE_URL`; results saved under `results/` |

**Environment variables** (the same name everywhere; defaults in parentheses):

| Variable | Used by | Meaning |
|---|---|---|
| `DB_HOST` (`db`), `DB_PORT` (`5432`), `DB_NAME` (`boxoffice`), `DB_USER` (`boxoffice`), `DB_PASSWORD` (`boxoffice`) | every service with a database | PostgreSQL connection |
| `DB_REPLICA_HOST` (`db-replica`), `DB_REPLICA_PORT` (`5432`) | `inventory` (lab 6) | read replica |
| `REDIS_HOST` (`redis`), `REDIS_PORT` (`6379`) | `catalog` (lab 5) | cache |
| `AUTH_JWKS_URI` (`http://auth:8081/auth/.well-known/jwks.json`) | `gateway` | public keys used to validate JWTs |
| `JWT_ISSUER` (`boxoffice-auth`), `JWT_TTL` (`PT1H`) | `auth`, `gateway` | token issuer and lifetime |
| `ADMIN_EMAIL` (`admin@boxoffice.dev`), `ADMIN_PASSWORD` (`boxoffice-admin`) | `auth` | administrator created at startup |
| `CATALOG_URL`, `INVENTORY_URL`, `ORDER_URL`, `PAYMENT_URL` (`http://<service>:<port>`) | service-to-service calls | base URL of another service |
| `KAFKA_BOOTSTRAP_SERVERS` (`kafka:9092`) | labs 7+ | Kafka brokers |
| `OTEL_EXPORTER_OTLP_ENDPOINT` (`http://otel-lgtm:4318`) | labs 8+ | telemetry export |
| `BASE_URL` | k6 scripts | `http://localhost:8082` in labs 1–2, `http://localhost` (the edge) from lab 3 on |

**Headers** that cross service boundaries:

| Header | Set by | Meaning |
|---|---|---|
| `Authorization: Bearer <jwt>` | client | identity, validated by the `gateway` |
| `X-User-Id`, `X-User-Email`, `X-User-Scope` | `gateway` (removed if a client sends them) | authenticated user, trusted by the services |
| `X-Request-Id` | `edge` | correlation id, logged by every hop |
| `X-Instance` | `catalog` | which replica answered (lab 3) |
| `X-Cache: HIT` / `MISS` | `catalog` | cache outcome (lab 5) |

!!! warning "Ports already in use?"

    If something on your machine already uses port 80, 5432 or 6379 (a local PostgreSQL, for instance), stop it, or change **only the host side** of the mapping in `docker-compose.yaml` (`"15432:5432"`). Never change the port inside the container: the other services rely on it.

## 1. Install the tools

The table lists what each tool is for; the tabs below show how to install them on each system. k6 is a single binary[^1]; Docker Compose comes with Docker Desktop or as a plugin of Docker Engine[^2].

| Tool | Version | Used in | Why |
|---|---|---|---|
| **Git** | any recent | all labs | version control, delivery of every lab |
| **Docker** + **Compose v2** | Docker 27+ | all labs | every service and database runs in a container |
| **JDK** | **21** (LTS) | labs 1–11 | Spring Boot services |
| **Maven** | 3.9+ | labs 1–11 | build and dependencies |
| **uv** | recent | labs 2, 12 | installs Python 3.12 and runs every Python script and project (no `pip`, no `venv`) |
| **Python** | **3.12** (via uv) | labs 2, 12 | result scripts, the AI assistant |
| **k6** | 1.0+ | labs 0–12 | load tests (JavaScript scripts) |
| **kubectl** + **kind** *or* **minikube** | recent | labs 10–11 | local Kubernetes |
| **jq**, **curl** | any | all labs | calling and reading the APIs from the terminal |

=== ":simple-apple: macOS"

    Install [Homebrew](https://brew.sh){target="_blank"} first, then:

    ``` { .bash .copy }
    brew install --cask docker          # Docker Desktop (or OrbStack: brew install --cask orbstack)
    brew install --cask temurin@21      # Eclipse Temurin JDK 21
    brew install maven uv k6 kubectl kind jq git
    uv python install 3.12              # Python is managed by uv, not by Homebrew or pip
    ```

    Open Docker Desktop once so it starts the engine, and give it **at least 4 CPUs and 8 GB of memory** (*Settings → Resources*).

=== ":simple-linux: Linux (Ubuntu 24.04)"

    ``` { .bash .copy }
    # Docker Engine + Compose plugin (official convenience script) and run docker without sudo
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker "$USER" && newgrp docker

    # JDK 21, Maven, tools
    sudo apt-get update
    sudo apt-get install -y openjdk-21-jdk maven git jq curl

    # uv (Python package and project manager) and Python 3.12
    curl -LsSf https://astral.sh/uv/install.sh | sh
    uv python install 3.12

    # k6 (official APT repository)
    sudo gpg -k
    sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
      --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
    echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
      | sudo tee /etc/apt/sources.list.d/k6.list
    sudo apt-get update && sudo apt-get install -y k6

    # kubectl and minikube
    sudo snap install kubectl --classic
    curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64
    sudo install minikube-linux-amd64 /usr/local/bin/minikube && rm minikube-linux-amd64
    ```

=== ":material-microsoft-windows: Windows"

    Use **WSL 2** with Ubuntu: the labs use Bash scripts, and file sharing between Windows and containers is slow and fragile.

    ``` { .powershell .copy }
    wsl --install -d Ubuntu-24.04
    ```

    1. Install [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/){target="_blank"} and enable *Settings → Resources → WSL integration* for Ubuntu.
    2. Open the **Ubuntu** terminal and follow the **Linux** tab (skip the Docker Engine lines: Docker Desktop provides it).
    3. Keep your repository **inside the WSL file system** (`~/boxoffice`), not under `/mnt/c/...`.

!!! tip "No k6 installed? Run it in a container"

    k6 is a single binary, but if you cannot install it, the official image works with the same scripts. From the repository root:

    ``` { .bash .copy }
    docker run --rm -i -v "$PWD":/w -w /w -e BASE_URL=http://host.docker.internal:8888 grafana/k6 run load/hello.js
    ```

    Inside a container, `localhost` is the container itself; `host.docker.internal` reaches your machine (on Linux add `--add-host=host.docker.internal:host-gateway`).

## 2. Check your environment

Save the script below as `scripts/check-env.sh` in your repository (next step) and run it. Every line must say `ok`.

``` { .bash title="scripts/check-env.sh" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/0/code/scripts/check-env.sh"
```

<!-- termynal -->
``` shell
> bash scripts/check-env.sh
Tools
  ok    git       git version 2.47.1
  ok    docker    Docker version 28.4.0, build d8eb465
  ok    compose   Docker Compose version v2.39.2
  ok    java      openjdk version "21.0.8" 2025-07-15 LTS
  ok    maven     Apache Maven 3.9.11
  ok    uv        uv 0.9.2
  ok    k6        k6 v1.3.0 (go1.25.1, linux/amd64)
  ok    kubectl   Client Version: v1.34.1
  ok    jq        jq-1.7.1
  ok    curl      curl 8.5.0 (x86_64-pc-linux-gnu)
Kubernetes (lab 10): kind OR minikube is enough
  ok    minikube  v1.37.0
Checks
  ok    JDK 21 (21 or newer)
  ok    Python 3.12.12 (via uv)
  ok    Docker daemon: 8 CPUs, 16651931648 bytes of memory

All set.
```

Your version numbers will differ; what matters is that nothing says `MISS` or `FAIL`.

!!! warning "Common failures"

    - `FAIL maven … JAVA_HOME environment variable is not defined correctly`: point `JAVA_HOME` to the JDK 21 folder (`export JAVA_HOME=$(/usr/libexec/java_home -v 21)` on macOS; `/usr/lib/jvm/java-21-openjdk-amd64` on Ubuntu) and add it to your `~/.zshrc` or `~/.bashrc`.
    - `MISS Docker daemon is not running`: start Docker Desktop (macOS/Windows) or `sudo systemctl start docker` (Linux).
    - `permission denied … docker.sock` on Linux: you skipped `usermod -aG docker`; log out and in again.
    - `MISS Python 3.12 or newer`: run `uv python install 3.12`. Never `pip install` into the system Python: every Python step of the course goes through `uv` (`uv run`, `uv add`, `uvx`).

## 3. Create your repository

All your lab work lives in **one repository**, called `boxoffice`, created by you on GitHub (private; you will add your project teammates later). The course repository has the reference skeleton and is where updates to the lab code are published; your repository is where *your* code and *your* measurements live.

``` { .bash .copy }
mkdir boxoffice && cd boxoffice
git init -b main
mkdir -p services infra load results scripts
```

At the end of the semester it will look like this — each folder appears in the lab shown in the comment:

``` { .tree title="boxoffice/" }
boxoffice/
    docker-compose.yaml        # lab 1, grows in every lab
    .gitignore
    README.md                  # how to run your BoxOffice
    services/
        catalog/               # lab 1  (Spring Boot, port 8082)
        auth/                  # lab 4  (Spring Boot, port 8081)
        gateway/               # lab 4  (Spring Cloud Gateway, port 8080)
        inventory/             # lab 6  (Spring Boot, port 8083)
        order/                 # lab 7
        notification/          # lab 7
        payment/               # lab 9
        assistant/             # lab 12 (FastAPI)
    infra/
        nginx/nginx.conf       # lab 3  (edge)
        postgres/              # lab 6  (replication)
        pgbouncer/             # lab 6
    load/                      # k6 scripts, from lab 0
        hello.js
    results/                   # your measurements: lab0.md, lab1.md, ...
    scripts/
        check-env.sh
    k8s/                       # lab 10
    .github/workflows/         # lab 11
```

Add a `.gitignore` at the root:

``` { .bash title=".gitignore" .copy }
--8<-- "docs/2027.1/hands-on/0/code/.gitignore"
```

Then create the repository on GitHub, push, and keep committing at the end of every lab:

``` { .bash .copy }
git add . && git commit -m "lab 0: environment"
git remote add origin git@github.com:<your-user>/boxoffice.git
git push -u origin main
```

!!! tip "One commit (or tag) per lab"

    Tag the end of each lab (`git tag lab0 && git push --tags`). When a later lab breaks something, `git diff lab4 lab5` shows exactly what changed — the same discipline you will use for deployments in lab 11.

## 4. Measure it: your machine's baseline { #measure-it }

Every lab ends with a measurement, and this one sets the reference: **how much can your laptop serve when the server does almost nothing?** The target is a stock Nginx returning a small static page; any number you get later for BoxOffice will be *lower*, and the difference is the cost of your code, your database and your network hops.

Save the script as `load/hello.js`:

``` { .javascript title="load/hello.js" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/0/code/load/hello.js"
```

Start the target, run k6 with 1, 10 and 50 virtual users (VUs), then stop the target:

``` { .bash .copy }
docker run -d --rm --name hello -p 8888:80 nginx:1.30-alpine
k6 run -e VUS=1  load/hello.js
k6 run -e VUS=10 load/hello.js
k6 run -e VUS=50 load/hello.js
docker stop hello
```

<!-- termynal -->
``` shell
> k6 run -e VUS=10 load/hello.js
  █ THRESHOLDS

    http_req_failed
    ✓ 'rate<0.01' rate=0.00%

  █ TOTAL RESULTS

    checks_succeeded...: 100.00% 249184 out of 249184
    HTTP
    http_req_duration..............: avg=163.61µs med=119.66µs p(95)=405.54µs p(99)=824.01µs max=13.26ms
    http_req_failed................: 0.00%  0 out of 249184
    http_reqs......................: 249184 49808.803836/s
    EXECUTION
    vus............................: 10     min=10          max=10
```

Read the summary like this:

- `http_reqs … /s` is the **throughput** (requests per second, RPS).
- `http_req_duration` gives the **latency** distribution: `med` is the median (p50), `p(95)`/`p(99)` are the 95th/99th percentiles — 1 request in 100 is slower than p99.
- `vus` is the **concurrency**: each virtual user sends a request, waits for the answer, and sends the next one (a *closed* workload model).

Record the results in `results/lab0.md`:

``` { .markdown title="results/lab0.md" .copy }
# Lab 0 — baseline

Machine: <CPU model>, <cores> cores, <RAM> GB; Docker resources: <CPUs> CPUs, <GB> GB

| VUs | Throughput (req/s) | p50 (ms) | p95 (ms) | p99 (ms) | Errors |
|----:|-------------------:|---------:|---------:|---------:|-------:|
|   1 |                    |          |          |          |        |
|  10 |                    |          |          |          |        |
|  50 |                    |          |          |          |        |

Little's Law check (VUs ≈ throughput × average latency):
- 10 VUs: ____ req/s × ____ s = ____
```

??? question "Think first: what happens between 10 and 50 VUs?"

    With 1 VU, the latency is pure service time and the throughput is `1 / latency`. Adding VUs raises the throughput **while** there are idle CPU cores. Once the cores are busy, more VUs only add **waiting**: throughput stays flat and latency grows in proportion — Little's Law, `L = λ × W`, with `L` = VUs, `λ` = throughput and `W` = latency. You will see that knee again, with real services, in [lab 2](../2/index.md).

!!! warning "k6 competes with the server"

    k6 and the server share the same CPU cores, so above a few tens of thousands of requests per second you measure k6 as much as Nginx. That is fine for a baseline; in lab 2 the target will be much slower than k6, and the problem disappears.

## 5. First look at the playground

The [System Design Playground](../../../playground/index.md) simulates the same components you will build, under load, in seconds. Every lab embeds the scenario it is about to measure for real, so you can form a hypothesis *before* running k6.

**Try it:** press **Run** on the `monolith` scenario below (one app server, one SQL database). Raise the load until p99 jumps. Which component saturates first? Write down the answer — you will check it against your own `catalog` service in lab 2.

<div class="sdp" data-scenario="monolith" data-mode="compact" data-height="460"></div>

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Bind for 0.0.0.0:8888 failed: port is already allocated` | another program (or an old `hello`) uses port 8888 | `docker rm -f hello`, or use another port: `-p 8899:80` and `k6 run -e BASE_URL=http://localhost:8899 load/hello.js` |
| `k6: command not found` | k6 not installed or not in `PATH` | install it (step 1) or use the container command in the "No k6 installed?" tip |
| `permission denied while trying to connect to the Docker daemon socket` | Linux user not in the `docker` group | `sudo usermod -aG docker "$USER"`, then log out and in |
| `Cannot connect to the Docker daemon` | Docker Desktop not started | start Docker Desktop and wait for "Engine running" |
| `FAIL maven … JAVA_HOME` | `JAVA_HOME` points to nothing or to an old JDK | set `JAVA_HOME` to the JDK 21 folder (see "Common failures") |
| everything is very slow on Windows | the repository lives under `/mnt/c/...` | move it to `~/boxoffice` inside WSL |
| `check-env.sh: line 1: #!/usr/bin/env: No such file` on WSL | the file was saved with Windows line endings | `sed -i 's/\r$//' scripts/check-env.sh` (and configure your editor to use LF) |

!!! success "Best practices in this lab"

    - **Check the toolchain with a script, not from memory** — `scripts/check-env.sh` prints every tool and version, so a broken environment is found in seconds, not in the middle of a load test. Why it matters: every measurement of the course assumes the same setup ([How to study system design](../../classes/intro/index.md)).
    - **Keep secrets and bulky outputs out of Git** — `.gitignore` excludes `.env` and the k6 HTML reports, and keeps the JSON summaries and the tables in `results/*.md`. Security is a quality attribute from day one ([Requirements](../../classes/intro/requirements/index.md)).
    - **Measure a baseline before changing anything** — `load/hello.js` tells you what *your* machine serves, the reference for every later number ([Estimation](../../classes/estimation/index.md)).
    - **Write each measurement down with its setup** — `results/lab0.md` records machine, rate and latency; a number without its setup cannot be compared ([Making requirements measurable](../../classes/intro/requirements/index.md)).

## Clean up

``` { .bash .copy }
docker rm -f hello 2>/dev/null || true     # the baseline target, if still running
docker image prune -f                      # optional: remove dangling images
```

Keep everything in `boxoffice/`: lab 1 starts from it.

## Deliverable

- [ ] `bash scripts/check-env.sh` prints `All set.` (paste the output in `results/lab0.md`).
- [ ] Your `boxoffice` repository exists on GitHub with the folder layout, `.gitignore`, `scripts/check-env.sh` and `load/hello.js`, tagged `lab0`.
- [ ] `results/lab0.md` has the baseline table filled in (1, 10 and 50 VUs) and the Little's Law check.
- [ ] You ran the `monolith` scenario in the playground and wrote down which component saturates first.
- [ ] [Quiz](quiz.md) answered.

## End state

At the end of this lab your repository contains (the lab's [`code/`](code/scripts/check-env.sh) overlay plus your results):

``` { .tree title="boxoffice/ after lab 0" }
boxoffice/
    .gitignore
    load/
        hello.js
    results/
        lab0.md
    scripts/
        check-env.sh
```

Next: [Lab 1 — First service](../1/index.md).

[^1]: Grafana k6 documentation, [Running k6](https://grafana.com/docs/k6/latest/get-started/running-k6/){target="_blank"} and [Install k6](https://grafana.com/docs/k6/latest/set-up/install-k6/){target="_blank"}.
[^2]: Docker documentation, [Docker Compose](https://docs.docker.com/compose/){target="_blank"}.
