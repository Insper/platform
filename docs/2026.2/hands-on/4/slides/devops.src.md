---
marp: true
lang: en
title: Hands-on 4 — DevOps
description: Platforms, Microservices, DevOps and APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Platforms, Microservices, DevOps and APIs · Hands-on 4</div>

# Hands-on 4 — DevOps

**Automate build, package and push with Jenkins pipelines as code**

<!--
Outline: (1) CI and CD; (2) Jenkins in a container; (3) unlock, executors, credentials;
(4) Jenkinsfile: build-only and build-package-push; (5) pitfalls.
-->

---

## CI and CD

- **Continuous Integration (CI)** — merge often; every merge triggers an automated **build and test**.
- **Continuous Delivery (CD)** — every change that passes CI is **packaged** and ready to deploy.

`git push` → CI server (**Jenkins**) → Build → Test → Package Docker image → Push to registry → Deploy

<div class="ok">

Goal: a **shorter** development lifecycle — the machine does the repetitive steps, the same way every time.

</div>

---

## Jenkins and Pipeline as Code

- Open-source **automation server**, extended by a rich plugin ecosystem.
- **Pipeline as Code**: the pipeline lives in a `Jenkinsfile`, committed **next to the code**.
- Jenkins checks it out on every build — the pipeline **evolves with the code**.

| Syntax | Description |
|---|---|
| **Declarative** | structured, opinionated DSL — recommended (used here) |
| **Scripted** | full Groovy — maximum flexibility, steeper learning curve |

---

## Step 1 — Jenkins in a container

`jenkins/compose.yaml` builds a custom image on top of `jenkins/jenkins:jdk25`:

```yaml
services:
  jenkins:
    container_name: jenkins
    build:
      dockerfile_inline: |
        FROM jenkins/jenkins:jdk25
        # + maven, docker-ce, kubectl, AWS CLI
        RUN usermod -aG docker jenkins
    ports:
      - 9080:8080
    volumes:
      - ${CONFIG:-./config}/jenkins:/var/jenkins_home
      - /var/run/docker.sock:/var/run/docker.sock
```

---

## What the image carries

| Tool | Purpose |
|---|---|
| Maven | build Java projects |
| Docker CE | build and push images from pipelines |
| kubectl | deploy to Kubernetes clusters |
| AWS CLI | ECR, ECS, EKS … |

```bash
docker compose up -d --build     # then open http://localhost:9080/
```

<div class="warn">

Mounting `/var/run/docker.sock` gives the container **full control of the host Docker daemon**. OK locally; harden it (rootless Docker, dedicated build daemon) when shared.

</div>

---

## Step 2 — Unlock and configure

On first start Jenkins asks for a random **initial admin password**:

```bash
docker logs jenkins 2>&1 | grep -A 3 "initialAdminPassword"
docker exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```

1. Enter the password → **Install suggested plugins** → create an admin user.
2. **Manage Jenkins → Nodes → Built-In Node → Configure**: executors **2 → 10**.

<p class="small">An executor is a slot that runs one job. More executors → several microservices built in parallel. On Windows, open the terminal as Administrator.</p>

---

## Step 3 — Credentials

**Manage Jenkins → Credentials → System → Global credentials → Add Credentials**

| Field | Value |
|---|---|
| Kind | Username with password |
| Username | your Docker Hub username |
| Password | a Docker Hub **access token** |
| ID | `dockerhub-credential` |

<div class="ok">

Use a token with **Read & Write** scope, not your password: a leaked token is revoked without touching the account.

</div>

---

## Step 4 — The `account` job: build only

```groovy
pipeline {
    agent any
    stages {
        stage('Build') {
            steps {
                sh 'mvn -B -DskipTests clean install'
            }
        }
    }
}
```

- `-B` = **batch mode**: no interactive prompts, required in CI.
- **New Item → Pipeline → Pipeline script from SCM**: Jenkins clones the repo and reads the `Jenkinsfile`.

---

## Step 5 — `account-service`: the pipeline

```groovy
environment {
    SERVICE = 'account'
    NAME    = "humbertosandmann/${env.SERVICE}"
}
```

1. **Dependencies** — `build job: 'account', wait: true`: rebuild the upstream module first.
2. **Build** — `mvn -B -DskipTests clean package`: the runnable jar.
3. **Build & Push Image** — multi-platform image to Docker Hub.

<p class="small"><code>NAME</code> is the Docker Hub repository; replace the user with yours.</p>

---

<!-- _class: tight -->

## Build & Push Image

```groovy
withCredentials([usernamePassword(
    credentialsId: 'dockerhub-credential',
    usernameVariable: 'USERNAME', passwordVariable: 'TOKEN')]) {
  sh 'echo $TOKEN | docker login -u $USERNAME --password-stdin'
  sh "docker buildx create --use --platform=linux/arm64,linux/amd64 ..."
  sh "docker buildx build --platform=linux/arm64,linux/amd64 --push \
        --tag ${env.NAME}:latest --tag ${env.NAME}:${env.BUILD_ID} -f Dockerfile ."
  sh "docker buildx rm --force multi-platform-builder-${env.SERVICE}"
}
```

- `withCredentials` injects the token; values are **masked** in the logs. Single quotes: the **shell** expands `$TOKEN`, not Groovy.
- `buildx` builds for `linux/arm64` (Apple Silicon, Graviton) **and** `linux/amd64`.
- Two tags: `:latest` (stable reference) + `:<BUILD_ID>` (traceable to a build).

---

## Common pitfalls

- **Credential ID mismatch**: `credentialsId` must be exactly `dockerhub-credential`.
- **Hard-coded repository**: `NAME` must point to **your** Docker Hub user.
- **Upstream job missing**: `build job: 'account'` fails if the `account` job does not exist.
- **Tests skipped**: `-DskipTests` everywhere — add a `Test` stage with `mvn test` to enforce them.
- **Too few executors**: `account-service` holds a slot while it waits for `account`; with several services, the default 2 slots run out.

<!--
The executors point: account-service occupies a slot while it waits for account.
-->

---

## Takeaways

1. **CI** builds and tests every merge; **CD** keeps every passing change ready to deploy.
2. **Pipeline as Code**: the `Jenkinsfile` lives in the repo, declarative syntax.
3. Jenkins runs in Docker with Maven, Docker, kubectl and AWS CLI; port **9080**.
4. Secrets go in the **credential store** (`dockerhub-credential`), injected with `withCredentials`.
5. `account-service`: **Dependencies → Build → Build & Push Image**.
6. `docker buildx` gives **multi-platform** images, tagged `latest` and `BUILD_ID`.
7. The Docker socket mount is **convenient locally, risky when shared**.
