
To start the hands-on exercises, we need to set up our environment. This includes installing necessary tools, configuring our workspace, and ensuring we have access to the required resources.

To set up your development environment, check the appendix [Development Setup](../../../appendix/development-setup.md).

After that your environment should be ready to start the exercises. We should create a root repository, to made easy to access the other microservices repositories and also the documentation.

## Slides

<div class="slides-embed">
  <iframe src="slides/prerequisites.html" title="Slides: hands-on 0 — prerequisites" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/prerequisites.html){:target="_blank"}

## The toolchain

Every lab follows the same path: you write the code, track it with Git, build it with Maven, package it as a Docker image and run it as a container (later on Kubernetes). Each tool covers one step:

``` mermaid-sim
flowchart LR
    code["your code\n(Java, Spring Boot)"] e1@-->|"git commit"| git["Git\n(GitHub)"]
    git e2@-->|"mvn package"| jar["Maven\ntarget/*.jar"]
    jar e3@-->|"docker build"| img["Docker image"]
    img e4@-->|"docker compose up"| ctr["container"]
    ctr e5@-.->|"later"| k8s["Kubernetes"]
```

| Tool | Why you need it | Check |
|---|---|---|
| **Git** | version control: every lab lives in a repository; continuous integration (CI) starts from a `git push` | `git --version` |
| **Docker** | runs each service, database and broker in an isolated container | `docker run --rm hello-world` |
| **Java** | the language of the microservices (Spring Boot); the Java Development Kit (JDK) compiles and runs them | `java -version` |
| **Maven** | downloads dependencies, compiles, runs the tests, packages the jar | `mvn -v` |
| **uv** | runs the Python scripts of the later labs, with pinned versions | `uv --version` |

Most of the work happens on your machine; GitHub keeps the repositories and can publish the documentation:

``` mermaid-sim
flowchart LR
    subgraph laptop [Your machine]
        term["terminal\ngit · mvn · java · uv"]
        docker["Docker\nDesktop or Engine"]
        term e1@-->|"docker compose up"| docker
    end
    subgraph gh [GitHub]
        org["organization\nusername-studies"]
        pages["GitHub Pages\n(documentation)"]
        org e3@-.-> pages
    end
    term e2@==>|"git push"| org
```

Run the check in a **new** terminal (it sees the updated `PATH`) before the first lab. The appendix has the installation per operating system and the troubleshooting.

!!! warning "Maven and Java must agree"

    `mvn -v` must report the **same Java version** as `java -version`: Maven uses `JAVA_HOME`, which can point to a different JDK than the one on your `PATH`.

## Root Repository

The root repository will serve as the central point for accessing all other microservices repositories and the documentation. It will help in organizing the project structure and managing dependencies efficiently.

To better organize the projet, we propose to create a new organization in GitHub, called something like `<username>-studies`, and then create the root repository inside this organization, as well as the other microservices repositories. This way, we can easily manage access permissions and collaborate with other team members. Also, we can use the project management features of GitHub, such as issues and pull requests, to track progress and coordinate work across the different repositories.

!!! tip "Documentation Hosting"

    Additionally, we can use GitHub Pages to host the documentation for the project.

``` mermaid-sim
flowchart TB
    org["GitHub organization\nusername-studies"]
    org e1@--> platform["platform\n(root repository)"]
    org e2@--> account["account"]
    org e3@--> service["account-service"]
    org e4@--> more["gateway-service, ..."]
    platform e5@-.->|"submodule api/account"| account
    platform e6@-.->|"submodule api/account-service"| service
```

Each microservice is a repository of its own; from hands-on 1 on, `platform` links them as **Git submodules** under `api/` (`git submodule add <repository_url> api/account`).

Steps:

1. Create a new repository called `platform` inside the organization, and then clone it to your local machine. This repository will serve as the root repository for our project.

2. Inside this root repository, we can create a directory structure to organize our microservices and documentation. For example:

    ``` { .tree title="Root Directory Structure"}
    platform/
        api/
        docs/
            index.md
        web/
        docker/
        .gitignore
        README.md
    ```

!!! example "BONUS: MkDocs with Material"

    You can use [MkDocs with Material](https://squidfunk.github.io/mkdocs-material/){target="_blank"} for the documentation, and then host it using GitHub Pages. This will allow us to have a well-structured and visually appealing documentation site that is easily accessible to all team members.

    To set up mkdocs with material, you can copy the configuration from the template repository and customize it according to your project's needs.

    Copy into the root repository the following files from the template repository: [mkdocs.yml](./mkdocs.yml){download="mkdocs.yml"} and [requirements.txt](./requirements.txt){download="requirements.txt"}

    The resulting directory structure will look like this:

    ``` { .tree title="Root Directory Structure"}
    platform/
        api/
        docs/
            index.md
        web/
        docker/
        .gitignore
        README.md
        mkdocs.yml
        requirements.txt
    ```

    After setting up the mkdocs configuration, you can build and serve the documentation locally using the following commands:

    === ":simple-apple: Mac/:simple-linux: Linux"

        ``` bash
        python3 -m venv venv
        source venv/bin/activate
        python3 -m pip install --no-cache-dir -r requirements.txt --upgrade
        mkdocs build
        mkdocs serve
        ```

    === ":material-microsoft-windows: Windows"

        ``` bash
        python -m venv venv
        venv\Scripts\activate
        python -m pip install --no-cache-dir -r requirements.txt --upgrade
        mkdocs build
        mkdocs serve
        ```

    This will start a local development server, and you can access the documentation by navigating to [`http://127.0.0.1:8000`](http://127.0.0.1:8000){target="_blank"} in your web browser.


Now, with no more delay, you can start the hands-on exercises!