---
marp: true
lang: en
title: Hands-on 0 — Prerequisites
description: Platforms, Microservices, DevOps and APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">Platforms, Microservices, DevOps and APIs · Hands-on 0</div>

# Hands-on 0 — Prerequisites

**Set up the tools and the root repository before the first microservice**

<!--
Outline: (1) the toolchain from the appendix Development Setup: Git, Docker, Java, Maven, uv;
(2) the check commands; (3) a GitHub organization; (4) the root repository `platform`;
(5) bonus: documentation with MkDocs Material on GitHub Pages.
-->

---

## Goal

- Set up the **development environment** used in every hands-on.
- Create a **GitHub organization** to group the project's repositories.
- Create the **root repository** `platform`: the central point for the microservices and the documentation.
- (Bonus) publish the project's **documentation** with MkDocs Material and GitHub Pages.

<p class="small">Step-by-step installation per OS: appendix <strong>Development Setup</strong>.</p>

---

<!-- _class: tight -->

## The toolchain: one path

<div class="flow">
<div class="box">your code<small>Java · Spring Boot</small></div><div class="arrow">commit →</div>
<div class="box accent">Git<small>GitHub</small></div><div class="arrow">mvn package →</div>
<div class="box accent">Maven<small>target/*.jar</small></div><div class="arrow">docker build →</div>
<div class="box orange">Docker image</div><div class="arrow">compose up →</div>
<div class="box green">container<small>later on Kubernetes</small></div>
</div>

| Tool | Why you need it |
|---|---|
| **Git** | version control: every lab lives in a repository; continuous integration (CI) starts from a `git push` |
| **Docker** | runs each service, database and broker in an isolated container |
| **Java** (JDK) | the language of the microservices (Spring Boot); the JDK compiles and runs them |
| **Maven** | downloads dependencies, compiles, runs the tests, packages the jar |
| **uv** | runs the Python scripts of the later labs, with pinned versions |

<!--
Four tools for the Java path, plus uv for the Python scripts of the later labs.
-->

---

<!-- _class: tight -->

## Installing, per OS

| Tool | Windows | macOS | Linux (Debian) |
|---|---|---|---|
| **Git** | Git for Windows (+ Git Bash) | `brew install git` | `apt install git` |
| **Docker** | Docker Desktop | Docker Desktop | Docker Engine (native) |
| **Java** | Temurin JDK 25 `.msi` | `brew install openjdk@25` | `apt install openjdk-25-jdk` |
| **Maven** | binary `.zip` + `PATH` | `brew install maven` | `apt install maven` |
| **uv** | PowerShell installer | `brew install uv` | `curl … install.sh \| sh` |

- Docker Desktop runs the engine in a small Linux VM; on Linux, add your user to the `docker` group.
- Prefer the project's **Maven Wrapper** (`./mvnw`) when it has one: everyone builds with the same version.
- Python in the course runs through **uv**, never `pip`.

---

## Java: an LTS JDK

- You need a **JDK** (compiler + runtime), not just a JRE.
- Use an **LTS**: **JDK 25** (September 2025); JDK 21 still works for the labs that pin it.
- Plain `brew install openjdk` installs the newest release — not necessarily an LTS.
- Windows: in the Temurin installer, keep **Add to PATH** and enable **`JAVA_HOME`** (off by default).
- Maven finds Java through `JAVA_HOME`: set it first, to the JDK folder (the one that contains `bin/`).
- Several JDKs side by side: **SDKMAN!** (macOS, Linux) switches versions and sets `JAVA_HOME`.

---

## Check your setup

Open a **new** terminal (it sees the updated `PATH`) and run:

```bash
git --version
docker run --rm hello-world
java -version
mvn -v
uv --version
```

<div class="warn">

`mvn -v` must report the **same Java version** as `java -version`: Maven uses `JAVA_HOME`, which can point to a different JDK than the one on your `PATH`.

</div>

<!--
Troubleshooting on the page: Docker daemon not running, docker.sock permission (docker group),
JAVA_HOME not defined correctly, an older JDK first on the PATH, command not found in an old terminal.
-->

---

## One organization for the project

Create a GitHub organization, e.g. `<username>-studies`, and put **every** repository of the course inside it.

<div class="group">
<div class="caption">GitHub organization · username-studies</div>
<div class="flow">
<div class="box accent">platform<small>root repository</small></div><div class="arrow">submodules in api/ →</div>
<div class="box">account</div><div class="box">account-service</div><div class="box muted">gateway-service, …</div>
</div>
</div>

- **Access permissions** managed in one place.
- **Issues and pull requests** to track progress across repositories.
- **GitHub Pages** to host the project's documentation.

---

## The root repository

Create `platform` inside the organization and clone it:

```text
platform/
    api/
    docs/
        index.md
    web/
    docker/
    .gitignore
    README.md
```

<p class="small">It organizes the project structure: the microservices go under <code>api/</code>, the documentation under <code>docs/</code>.</p>

---

## Bonus: documentation with MkDocs Material

Copy `mkdocs.yml` and `requirements.txt` from the template into the root, then:

```bash
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
python3 -m pip install --no-cache-dir -r requirements.txt --upgrade
mkdocs build
mkdocs serve
```

Open `http://127.0.0.1:8000` — and host the same site with **GitHub Pages**.

---

## Takeaways

1. One path: **code → Git → Maven build → Docker image → container**; plus **uv** for Python.
2. Docker Desktop on macOS and Windows; **Docker Engine** natively on Linux.
3. An **LTS JDK** (25, or 21 where a lab pins it); `mvn -v` and `java -version` must agree.
4. Run the **check** commands in a new terminal before the first lab.
5. One **GitHub organization** and the **root repository** `platform`: `api/`, `docs/`, `web/`, `docker/`.
6. Document as you build: **MkDocs Material** locally, **GitHub Pages** online.
