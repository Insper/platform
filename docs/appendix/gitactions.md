GitHub Actions[^actions] is GitHub's built-in automation: a YAML file in your repository says *when* something should run (a push, a pull request, a schedule) and *what* runs (build, test, publish an image, deploy). In this course it is the shortest path from a commit to a running microservice: every push builds the Maven project, runs the tests, builds the Docker image and, on `main`, rolls it out to Kubernetes.

This page answers three questions: how a workflow is put together, **what decides how long a pipeline takes**, and **what runs when a job fails**. It closes with the security basics (secrets, `GITHUB_TOKEN`, pinning) and a comparison with Jenkins.

## How it works { #how-it-works }

Workflows are **event-driven**. The workflow file lives in `.github/workflows/`, so it is versioned with your code and reviewed in the same pull requests.

``` diagram
flowchart LR
    event(["Event<br/>e.g. push to main"]) --> workflow["Workflow<br/>.github/workflows/*.yml"]:::comp
    workflow --> jobs["Jobs<br/>parallel by default,<br/>ordered by needs"]:::comp
    jobs --> steps["Steps<br/>run: a shell command<br/>uses: an action"]:::tech
    steps -.->|"each job executes on"| runner["Runner<br/>a fresh GitHub-hosted VM<br/>or your own machine"]
```

| Concept | Description |
|:--------|:------------|
| **Workflow** | An automated process defined in a YAML file. A repository can have many workflows. |
| **Event** | What starts a workflow: `push`, `pull_request`, `schedule`, `workflow_dispatch` (a button), `workflow_run` (another workflow finished)… |
| **Job** | A set of steps that run on the **same runner**. Jobs run **in parallel** unless `needs` orders them. |
| **Step** | One task: a shell command (`run`) or a reusable action (`uses`). The steps of a job share the runner's file system. |
| **Action** | A reusable unit of automation, usually from the GitHub Marketplace (e.g. `actions/checkout`). |
| **Runner** | The machine that executes a job (`ubuntu-latest`, `windows-latest`, `macos-latest`, or your own). A GitHub-hosted runner is a fresh VM for every job. |

## A first workflow: CI for a Spring Boot microservice { #first-workflow }

The workflow below runs on every push to `main` and on every pull request. One job checks out the code, sets up Java, runs the tests, packages the jar, and builds and pushes the Docker image.

``` { .yaml title=".github/workflows/ci.yml" .copy .select linenums="1" }
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout source
        uses: actions/checkout@v7

      - name: Set up Java 25
        uses: actions/setup-java@v6
        with:
          java-version: '25'
          distribution: 'temurin'
          cache: maven

      - name: Run tests
        run: mvn test --no-transfer-progress

      - name: Build artifact
        run: mvn package -DskipTests --no-transfer-progress

      - name: Build Docker image
        run: docker build -t ${{ secrets.DOCKERHUB_USERNAME }}/account-service:${{ github.sha }} .

      - name: Push to Docker Hub
        if: github.event_name == 'push'
        run: |
          echo "${{ secrets.DOCKERHUB_TOKEN }}" | docker login -u "${{ secrets.DOCKERHUB_USERNAME }}" --password-stdin
          docker push ${{ secrets.DOCKERHUB_USERNAME }}/account-service:${{ github.sha }}
```

- `permissions: contents: read` gives the job's `GITHUB_TOKEN` only what it needs (see [Secrets and `GITHUB_TOKEN`](#secrets-and-github-token)).
- `cache: maven` restores `~/.m2/repository` from earlier runs (see [Caching](#caching)).
- The image is tagged with the commit SHA (`github.sha`), so every image points back to the exact code that built it.
- The push step runs only on `push` events: a pull request builds and tests, but publishes nothing.

## Jobs, `needs` and the critical path { #needs }

One job is easy to read but slow: every step waits for the previous one. Splitting the work into **jobs** lets independent work run on separate runners at the same time, and `needs` declares the order where it matters. The jobs form a **DAG** (directed acyclic graph):

``` { .yaml title=".github/workflows/ci.yml (jobs only)" .copy .select linenums="1" }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: mvn -B compile

  unit-tests:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: mvn -B test

  lint:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: mvn -B checkstyle:check

  integration-tests:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: mvn -B verify -P integration-tests   # a profile that runs the *IT classes

  image:
    needs: [unit-tests, lint, integration-tests]
    runs-on: ubuntu-latest
    steps:
      - run: docker build -t account-service:${{ github.sha }} .

  deploy:
    needs: image
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - run: echo "deploy account-service:${{ github.sha }}"
```

The checkout and setup steps are left out to show the shape. Two rules decide everything that follows[^syntax]:

- A job **starts when every job in its `needs` has finished successfully**. Jobs with no `needs` start at once, each on its own runner.
- When a needed job **fails or is skipped**, every job that needs it, directly or further down the chain, is **skipped**, unless it has a condition such as `if: always()` or `if: failure()`. Jobs that do not need the failed one keep running.

<div class="csim" data-sim="pipeline" data-cache="off" data-matrix="1" data-fail="none"></div>

!!! tip "Try it"
    Press play with the defaults: the run takes **14 min** of wall-clock time but **18 runner minutes**, because the three middle jobs run side by side. The outlined bars are the critical path, build → integration tests → image → deploy. Now run the unit tests on **3** Java versions: still 14 min, but **24 runner minutes** — a matrix costs minutes, not time, as long as runners are free. Turn on **cache dependencies**: the build is on the critical path, so the run drops to **11 min** (and **21 runner minutes**). Finally, fail the **unit tests**: lint and integration tests still run to the end, image and deploy are skipped, and the run stops at **8 min** after **18 runner minutes**.

What the simulator shows:

- **Wall-clock time is the longest path through the DAG** (the critical path), not the sum of the jobs. To make a pipeline faster, shorten a job *on* that path, or split it: speeding up lint here changes nothing.
- **Runner minutes are the sum of every job.** That is what a private repository pays for: GitHub bills each job rounded up to the whole minute[^billing]. Parallel jobs trade minutes for time.
- Real runs also spend time **queuing for a runner** and **setting up** each job (a fresh VM, checkout, Java). Many tiny jobs pay that overhead many times.
- Each job starts on a **clean machine**: files do not travel between jobs. Pass build outputs with the artifact actions (`actions/upload-artifact` / `actions/download-artifact`), or rebuild them.

## Matrix { #matrix }

A **matrix** runs the same job once per combination of values, in parallel. A typical use is testing on several Java versions or operating systems:

``` { .yaml title="unit tests on three Java versions" .copy .select linenums="1" }
  unit-tests:
    needs: build
    runs-on: ubuntu-latest
    strategy:
      fail-fast: true
      matrix:
        java: ['17', '21', '25']
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-java@v6
        with:
          java-version: ${{ matrix.java }}
          distribution: 'temurin'
          cache: maven
      - run: mvn -B test
```

- Each combination is a separate job, with its own runner and its own minutes; a job that `needs: unit-tests` waits for **all** of them.
- `fail-fast` defaults to `true`: when one combination fails, GitHub cancels the ones still in progress or queued. Set it to `false` to see every failure.
- `max-parallel` caps how many combinations run at once; a matrix generates at most 256 jobs per run[^syntax].

## Caching { #caching }

Every job starts on a fresh VM, so without a cache Maven downloads all the dependencies on every run. A cache saves a directory under a **key** and restores it in later runs:

- `actions/setup-java` with `cache: maven` caches `~/.m2/repository`, keyed on a hash of your `pom.xml` files: change a dependency and the key changes.
- For anything else, `actions/cache` takes a `path` and a `key` you build yourself, e.g. with `${{ hashFiles('**/package-lock.json') }}`.
- A cache is a speed-up, never a source of truth: the build must still work on a cache miss.

## Secrets and `GITHUB_TOKEN` { #secrets-and-github-token }

Two different credentials reach a workflow:

| | **Secrets** | **`GITHUB_TOKEN`** |
|:--|:--|:--|
| What | Values you store: `DOCKERHUB_TOKEN`, `KUBECONFIG`, API keys | A token GitHub creates automatically for each job |
| Where | Settings → Secrets and variables → Actions (repository, environment or organization) | Nothing to configure: `${{ secrets.GITHUB_TOKEN }}` or `${{ github.token }}` |
| Reaches | Other systems (Docker Hub, the cluster, a cloud) | This repository only: checkout, PR comments, releases, GitHub Packages |
| Lifetime | Until you rotate it | Expires when the job finishes |
| Scope | Whoever can change a workflow can use it | The `permissions:` key, per workflow or per job |

- Secrets are **redacted** from the logs, and they are **not passed** to workflows triggered from a fork (`GITHUB_TOKEN` is the exception)[^secrets]. Still, anyone with write access can write a workflow that uses them: treat write access as secret access.
- Declare `permissions:` explicitly and grant the **least** you need: once you list one permission, every permission you do not list is set to `none`[^syntax]. Raise it only in the job that needs it:

``` { .yaml title="least privilege" .copy .select linenums="1" }
permissions:
  contents: read        # default for every job of the workflow

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write   # only this job can create a release
      packages: write   # and push to GitHub Packages
```

## Pinning actions by SHA { #pinning }

`uses: actions/checkout@v7` points to a **tag**, and a tag can be moved: if the action's repository is compromised, the next run executes whatever `v7` points to now, with your secrets within reach. GitHub's security guide recommends pinning actions to a **full-length commit SHA**, which cannot change[^secure]:

``` { .yaml title="pinned to a commit" .copy .select linenums="1" }
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

- Keep the version in a comment, so a person (or Dependabot, with the `github-actions` ecosystem) can tell what it is and bump it.
- Check that the SHA comes from the action's own repository, not from a fork: `git ls-remote --tags https://github.com/actions/checkout`.
- The same guide also describes **workflow dependency lockfiles**, which record the exact commit of every action (including the actions an action uses) and supersede SHA pinning for repositories that adopt them[^secure].

## CD: deploy to Kubernetes after a successful CI run { #cd }

This second workflow starts when the `CI` workflow completes on `main`, and deploys only if CI succeeded.

``` { .yaml title=".github/workflows/cd.yml" .copy .select linenums="1" }
name: CD

on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]

permissions:
  contents: read

jobs:
  deploy:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: ubuntu-latest

    steps:
      - name: Configure kubectl
        uses: azure/setup-kubectl@v5

      - name: Write kubeconfig
        run: |
          mkdir -p $HOME/.kube
          echo "${{ secrets.KUBECONFIG }}" | base64 -d > $HOME/.kube/config

      - name: Rolling update
        run: |
          kubectl set image deployment/account-service \
            account-service=${{ secrets.DOCKERHUB_USERNAME }}/account-service:${{ github.event.workflow_run.head_sha }}
          kubectl rollout status deployment/account-service --timeout=120s
```

!!! warning "Which commit?"
    In a workflow started by `workflow_run`, `github.sha` is the **last commit on the default branch**, not necessarily the commit CI built[^events]. When two pushes land close together, it can name an image that does not exist yet. Use `github.event.workflow_run.head_sha`, the commit of the CI run that triggered this one.

## GitHub Actions vs Jenkins { #vs-jenkins }

Both tools implement the same CI/CD concepts, with different trade-offs:

| Aspect | GitHub Actions | Jenkins |
|:-------|:--------------|:--------|
| **Setup** | Zero — runs in GitHub's cloud | Requires a server (Docker, VM, or bare metal) |
| **Configuration** | YAML in `.github/workflows/` | Groovy `Jenkinsfile` |
| **Scaling** | Managed by GitHub | You manage the agent fleet |
| **Reuse** | Actions from the GitHub Marketplace | Plugins from the Jenkins update center |
| **Cost** | Free for standard runners in public repos; private repos get a monthly allowance, then pay per minute[^billing] | Free and open source; you pay for the infrastructure |
| **Self-hosted runners** | Supported | Native — Jenkins *is* the server |
| **Best for** | New projects, open source, GitHub-centric teams | On-premise environments, complex pipelines, code on several hosts |

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - A workflow is **event → jobs → steps**, versioned in `.github/workflows/`; each job runs on a **fresh runner**.
    - Jobs run **in parallel** unless `needs` orders them. The **wall-clock time is the critical path** of that DAG and the **runner minutes are the sum** of all jobs: speed up the path, not the side jobs.
    - When a job fails, the jobs that **need** it are **skipped**, while independent jobs still run; `if: always()` or `if: failure()` changes that on purpose.
    - A **matrix** multiplies jobs (and minutes), not time; a **cache** removes repeated downloads, and pays the most on the critical path.
    - **Secrets** reach other systems; **`GITHUB_TOKEN`** reaches this repository and is scoped by `permissions:` — grant the least. **Pin** actions to a commit SHA.

[^actions]: [GitHub Actions documentation](https://docs.github.com/en/actions){:target="_blank"}.
[^syntax]: [Workflow syntax for GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax){:target="_blank"}: `needs`, `strategy.fail-fast`, `max-parallel`, `permissions`.
[^billing]: [GitHub Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing){:target="_blank"} and [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions){:target="_blank"}.
[^secrets]: [Using secrets in GitHub Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets){:target="_blank"}.
[^secure]: [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use){:target="_blank"}.
[^events]: [Events that trigger workflows: `workflow_run`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run){:target="_blank"}.
