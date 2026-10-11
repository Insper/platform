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

<div class="kicker">Platforms, Microservices, DevOps and APIs · Hands-on 0</div>

# Hands-on 0 — Prerequisites

**Set up the tools and the root repository before the first microservice**

<!--
Outline: (1) the toolchain: Git, Docker, Java, Maven; (2) a GitHub organization; (3) the root
repository `platform`; (4) bonus: documentation with MkDocs Material on GitHub Pages.
-->

---

## Goal

- Install the **development environment** used in every hands-on.
- Create a **GitHub organization** to group the project's repositories.
- Create the **root repository** `platform`: the central point for the microservices and the documentation.
- (Bonus) publish the project's **documentation** with MkDocs Material and GitHub Pages.

<p class="small">Step-by-step installation per OS: appendix <strong>Development Setup</strong>.</p>

---

## The toolchain

| Tool | What for | macOS | Linux (Debian) |
|---|---|---|---|
| **Git** | version control | `brew install git` | `apt install git` |
| **Docker** | run apps in isolated containers | Docker Engine docs | Docker Engine docs |
| **Java** | backend language | `brew install openjdk` | `apt install openjdk-21` |
| **Maven** | dependencies and build | `brew install maven` | `apt install maven` |

<div class="ok">

Use an **LTS** JDK — OpenJDK **21** or **25**.

</div>

<!--
Ask who is on Windows: they need the extra environment-variable step on the next slide.
-->

---

## Windows: one extra step

Java and Maven are downloaded and **unzipped** by hand (OpenJDK from jdk.java.net, the Maven binary from maven.apache.org). Then:

- set `JAVA_HOME` to the JDK folder;
- set `MAVEN_HOME` to the Maven folder;
- add each one's `bin` directory to `PATH`.

<div class="warn">

Forgetting `PATH` is the classic error: the tools are installed, but the terminal does not find `java` or `mvn`.

</div>

---

## One organization for the project

Create a GitHub organization, e.g. `<username>-studies`, and put **every** repository of the course inside it.

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

1. Four tools for every hands-on: **Git, Docker, Java (LTS 21/25), Maven**.
2. On Windows, set `JAVA_HOME`, `MAVEN_HOME` and the `PATH`.
3. One **GitHub organization** groups the repositories, permissions and issues.
4. The **root repository** `platform` is the entry point: `api/`, `docs/`, `web/`, `docker/`.
5. Document as you build: **MkDocs Material** locally, **GitHub Pages** online.
