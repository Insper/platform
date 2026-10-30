This page gets your machine ready for the labs. Every microservice in the course follows the same path — you write Java code, track it with Git, build it with Maven, package it as a Docker image and run it as a container (later on Kubernetes) — so you need four tools, plus uv for the Python scripts of the later labs. Install them once, then run the [check](#check) at the end.

``` diagram
flowchart LR
    code["your code<br/>src/, pom.xml"] -->|"git commit, git push"| git["Git<br/>history on GitHub"]:::comp
    code -->|"mvn package<br/>(compiles with the JDK)"| jar["target/app.jar"]:::tech
    jar -->|"docker build"| img["Docker image"]:::comp
    img -->|"docker run"| ctr(["container"])
```

| Tool | Why you need it |
|:-----|:----------------|
| **[Git](#git)** | Version control: every lab and project lives in a Git repository, and CI starts from a `git push`. |
| **[Docker](#docker)** | Runs each service, database and broker in an isolated container, the same way on every machine. |
| **[Java](#java)** (JDK) | The language of the course's microservices (Spring Boot); the JDK compiles and runs them. |
| **[Maven](#maven)** | Builds the Java projects: downloads the dependencies, compiles, runs the tests, packages the jar. |
| **[uv](#uv)** | Runs the Python scripts and tools of the later labs, with the exact versions pinned. |

## Git { #git }

Git is a distributed version control system: it records every change to your code and lets a team work on the same repository.

=== ":material-microsoft-windows: Windows"

    Download and install **Git for Windows** from [git-scm.com](https://git-scm.com/install/windows){:target="_blank"}. It also brings *Git Bash*, a Unix-like terminal.

=== ":simple-apple: macOS"

    Install Git using Homebrew with the command:

    ```bash
    brew install git
    ```

    (Without Homebrew, `xcode-select --install` installs Apple's Git with the command-line tools.)

=== ":simple-linux: Linux"

    Install Git using your package manager, e.g., for Debian-based systems:

    ```bash
    sudo apt update
    sudo apt install git
    ```

## Docker { #docker }

Docker runs applications in **containers**: lightweight, isolated processes that carry everything they need, so a service behaves the same on your laptop, on a colleague's and in the cloud. There are two products:

- **Docker Desktop**, for macOS and Windows: an app that runs the Docker Engine inside a small Linux VM and adds a UI. It is free for personal use, education and small businesses; larger companies need a paid subscription[^desktop-license].
- **Docker Engine**, for Linux: the engine itself, installed natively, with no VM.

=== ":material-microsoft-windows: Windows"

    Docker on Windows runs Linux containers through **WSL 2** (Windows Subsystem for Linux), a real Linux kernel managed by Windows.

    1. Install WSL 2 from an administrator PowerShell, then restart:

        ```powershell
        wsl --install
        ```

    2. Install [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/){:target="_blank"} and keep the **WSL 2 backend** (the default). It needs Windows 10 22H2 or Windows 11 23H2 or newer, and WSL 2.1.5 or newer[^desktop-windows].

    Tip: clone your repositories **inside** the WSL file system (e.g. `~/code` in Ubuntu), not under `C:\`; file access and bind mounts are much faster there.

=== ":simple-apple: macOS"

    Install [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/){:target="_blank"} (pick Apple silicon or Intel), or with Homebrew:

    ```bash
    brew install --cask docker-desktop
    ```

    Open Docker Desktop once, so it starts the engine.

=== ":simple-linux: Linux"

    Install **Docker Engine** following the page for your distribution: [Install Docker Engine](https://docs.docker.com/engine/install/){:target="_blank"}. Then, to run `docker` without `sudo`, add your user to the `docker` group and open a new session[^postinstall]:

    ```bash
    sudo usermod -aG docker $USER
    newgrp docker
    ```

    The `docker` group grants root-level privileges: do this only on your own machine.

## Java { #java }

Java is the language of the course's microservices. You need a **JDK** (Java Development Kit: the compiler `javac` plus the runtime), not just a JRE.

Use a **Long-Term Support** (LTS)[^lts] version: **JDK 25** (September 2025) is the current LTS, and JDK 21 (September 2023), the previous one, still works for the labs that pin it. Releases between LTS versions, such as JDK 27 (September 2026), get updates only until the next release, six months later[^jdk-releases].

=== ":material-microsoft-windows: Windows"

    Download the **Eclipse Temurin** JDK 25 `.msi` installer from [adoptium.net](https://adoptium.net/temurin/releases/){:target="_blank"}. In the *Custom Setup* screen, keep **Add to PATH** and also enable the option that sets **`JAVA_HOME`**, which is off by default[^temurin-windows].

    With a `.zip` instead, unzip it, set the `JAVA_HOME` environment variable to the JDK folder, and add `%JAVA_HOME%\bin` to your `PATH`.

=== ":simple-apple: macOS"

    Install JDK 25 with Homebrew and link it where macOS looks for JDKs:

    ```bash
    brew install openjdk@25
    sudo ln -sfn $(brew --prefix)/opt/openjdk@25/libexec/openjdk.jdk /Library/Java/JavaVirtualMachines/openjdk-25.jdk
    ```

    (Plain `brew install openjdk` installs the newest release, which is not necessarily an LTS.)

=== ":simple-linux: Linux"

    Install the JDK with your package manager; on Ubuntu 22.04 or newer:

    ```bash
    sudo apt update
    sudo apt install openjdk-25-jdk
    ```

??? tip "Several JDKs side by side: SDKMAN! (macOS, Linux, WSL)"
    [SDKMAN!](https://sdkman.io/){:target="_blank"} installs and switches between JDK versions (and Maven) per user, with no `sudo`:

    ```bash
    curl -s "https://get.sdkman.io" | bash
    # open a new terminal, then:
    sdk list java                   # available versions and their identifiers
    sdk install java <identifier>   # e.g. the newest 25.x line ending in -tem (Temurin)
    sdk install maven
    ```

    `sdk use java <identifier>` switches the current terminal; `sdk default java <identifier>` changes the default. It also sets `JAVA_HOME` for you.

## Maven { #maven }

Maven is the build tool of the Java projects: it reads `pom.xml`, downloads the dependencies, compiles, runs the tests and packages the jar. Use Maven 3.9 or newer.

=== ":material-microsoft-windows: Windows"

    Download the binary `.zip` from [maven.apache.org](https://maven.apache.org/download.cgi){:target="_blank"} and unzip it, e.g. to `C:\tools\maven`.

    Add its `bin` folder to your `PATH`. Maven finds Java through `JAVA_HOME`, so set that first (see [Java](#java)).

=== ":simple-apple: macOS"

    Install Maven using Homebrew with the command:

    ```bash
    brew install maven
    ```

=== ":simple-linux: Linux"

    Install Maven using your package manager, e.g., for Debian-based systems:

    ```bash
    sudo apt update
    sudo apt install maven
    ```

!!! info "The Maven Wrapper"
    Many projects (all the ones generated by Spring Initializr) ship a **Maven Wrapper**: `./mvnw` (or `mvnw.cmd` on Windows) downloads the Maven version the project expects and runs it. With a wrapper, `./mvnw package` works even without a global Maven, and everyone builds with the same version.

## Python with uv { #uv }

Later labs use Python scripts (load generators, data tools). The course manages Python with **[uv](https://docs.astral.sh/uv/){:target="_blank"}**, never with `pip`: uv installs the right Python version, creates the virtual environment and installs exactly the versions pinned in `uv.lock`.

=== ":material-microsoft-windows: Windows"

    ```powershell
    powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
    ```

=== ":simple-apple: macOS"

    ```bash
    brew install uv
    ```

=== ":simple-linux: Linux"

    ```bash
    curl -LsSf https://astral.sh/uv/install.sh | sh
    ```

In a project with a `pyproject.toml`, `uv sync` prepares everything and `uv run <command>` runs inside the environment, with no activation step.

## Check your setup { #check }

Open a **new** terminal (so it sees the updated `PATH`) and run each command. The version numbers will differ; what matters is the shape of the answer.

```bash
git --version
docker run --rm hello-world
java -version
mvn -v
uv --version
```

You should see something like:

```text
git version 2.5x.x

Hello from Docker!
This message shows that your installation appears to be working correctly.
(...)

openjdk version "25.0.x" 2025-xx-xx LTS
OpenJDK Runtime Environment Temurin-25.0.x (...)

Apache Maven 3.9.x (...)
Java version: 25.0.x, vendor: Eclipse Adoptium, runtime: (...)

uv 0.x.y (...)
```

Check that `mvn -v` reports the **same Java version** as `java -version`: Maven uses `JAVA_HOME`, which can point to a different JDK than the one on your `PATH`.

??? warning "Troubleshooting"
    - **`failed to connect to the docker API … check if the daemon is running`** (or `Cannot connect to the Docker daemon`): Docker Desktop is not running (open it), or on Linux the service is stopped (`sudo systemctl start docker`).
    - **`permission denied … /var/run/docker.sock`** (Linux): your user is not in the `docker` group yet, or the session predates it; log out and in again.
    - **`The JAVA_HOME environment variable is not defined correctly`** (from `mvn`): set `JAVA_HOME` to the JDK folder — the folder that contains `bin/`, not `bin/` itself.
    - **`java -version` shows an old version**: an older JDK comes first on your `PATH`; fix the order, or switch with SDKMAN!.
    - **Command not found right after installing**: open a new terminal; the old one still has the old `PATH`.

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - The course's toolchain follows one path: **code → Git → Maven build → Docker image → container**.
    - On Windows, Docker runs through **WSL 2**; on macOS, through **Docker Desktop**; on Linux, **Docker Engine** runs natively.
    - Install a **JDK**, an **LTS** version: JDK 25 (or 21 for labs that pin it). **SDKMAN!** helps when you need several.
    - Prefer the project's **Maven Wrapper** (`./mvnw`) when it has one; make sure `mvn -v` and `java -version` agree.
    - Python in the course runs through **uv**, never `pip`.
    - Run the **check** commands in a new terminal before the first lab.

[^desktop-license]: [Docker Desktop license agreement](https://docs.docker.com/subscription/desktop-license/){:target="_blank"}: free for personal use, education, non-commercial open source and small businesses (fewer than 250 employees and less than US$ 10 million in annual revenue).
[^desktop-windows]: [Install Docker Desktop on Windows](https://docs.docker.com/desktop/setup/install/windows-install/){:target="_blank"} and [Install WSL](https://learn.microsoft.com/en-us/windows/wsl/install){:target="_blank"}.
[^postinstall]: [Linux post-installation steps for Docker Engine](https://docs.docker.com/engine/install/linux-postinstall/){:target="_blank"}.
[^lts]: [Long-term support](https://en.wikipedia.org/wiki/Long-term_support){:target="_blank"}, Wikipedia.
[^jdk-releases]: [Oracle Java SE Support Roadmap](https://www.oracle.com/java/technologies/java-se-support-roadmap.html){:target="_blank"}; release dates summarized at [endoflife.date](https://endoflife.date/oracle-jdk){:target="_blank"}.
[^temurin-windows]: [Eclipse Temurin: installation on Windows](https://adoptium.net/installation/windows){:target="_blank"}.
