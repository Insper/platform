## GitHub Actions

GitHub Actions is a feature of GitHub that allows you to automate, customize, and execute your software development workflows right in your repository. With GitHub Actions, you can build, test, and deploy your code directly from GitHub, with world-class support for CI/CD.

In addition, GitHub Actions allows you to automate other aspects of your development workflow such as assigning code reviews, managing branches, and triaging issues.

### How it works

GitHub Actions workflows are **event-driven**: you define *what* should happen and *when* it should be triggered. The workflow file lives inside your repository at `.github/workflows/`, making it version-controlled alongside your code.

``` mermaid
flowchart LR
    event(["Event\ne.g. push to main"]):::gray
    workflow(["Workflow\n.github/workflows/*.yml"]):::blue
    jobs(["Jobs\nrun in parallel or sequence"]):::blue
    steps(["Steps\nshell commands or actions"]):::teal
    runner(["Runner\nGitHub-hosted VM\nor self-hosted"]):::green

    event --> workflow --> jobs --> steps
    steps -.->|"executes on"| runner

    classDef gray  fill:#F1EFE8,stroke:#888780,color:#2C2C2A
    classDef blue  fill:#E6F1FB,stroke:#185FA5,color:#042C53
    classDef teal  fill:#E1F5EE,stroke:#0F6E56,color:#04342C
    classDef green fill:#EAF3DE,stroke:#3B6D11,color:#173404
```

### Core concepts

| Concept | Description |
|:--------|:------------|
| **Workflow** | An automated process defined in a YAML file. A repository can have multiple workflows. |
| **Event** | A trigger that starts a workflow (e.g., `push`, `pull_request`, `schedule`, `workflow_dispatch`). |
| **Job** | A set of steps that execute on the same runner. Jobs run in parallel by default. |
| **Step** | An individual task — either a shell command (`run`) or a reusable action (`uses`). |
| **Action** | A reusable unit of automation published on the GitHub Marketplace (e.g., `actions/checkout`). |
| **Runner** | The virtual machine that executes the job (`ubuntu-latest`, `windows-latest`, `macos-latest`). |


---

### Example — CI pipeline for a Spring Boot microservice

The workflow below triggers on every push to `main` and on pull requests. It checks out the code, sets up Java, runs the tests, and builds the Docker image.

``` { .yaml title=".github/workflows/ci.yml" .copy .select linenums="1" }
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout source
        uses: actions/checkout@v4

      - name: Set up Java 21
        uses: actions/setup-java@v4
        with:
          java-version: '21'
          distribution: 'temurin'
          cache: maven

      - name: Run tests
        run: mvn test --no-transfer-progress

      - name: Build artifact
        run: mvn package -DskipTests --no-transfer-progress

      - name: Build Docker image
        run: docker build -t ${{ secrets.DOCKERHUB_USERNAME }}/account-service:${{ github.sha }} .

      - name: Push to Docker Hub
        run: |
          echo "${{ secrets.DOCKERHUB_TOKEN }}" | docker login -u "${{ secrets.DOCKERHUB_USERNAME }}" --password-stdin
          docker push ${{ secrets.DOCKERHUB_USERNAME }}/account-service:${{ github.sha }}
```

!!! info "Secrets"
    Sensitive values like `DOCKERHUB_TOKEN` are stored as **encrypted repository secrets** (Settings → Secrets and variables → Actions). They are never exposed in logs.

---

### Example — CD: deploy to Kubernetes after a successful CI run

This second workflow triggers only after the `CI` workflow passes on `main`, then updates the Kubernetes deployment using `kubectl`.

``` { .yaml title=".github/workflows/cd.yml" .copy .select linenums="1" }
name: CD

on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]

jobs:
  deploy:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: ubuntu-latest

    steps:
      - name: Configure kubectl
        uses: azure/setup-kubectl@v3

      - name: Write kubeconfig
        run: |
          mkdir -p $HOME/.kube
          echo "${{ secrets.KUBECONFIG }}" | base64 -d > $HOME/.kube/config

      - name: Rolling update
        run: |
          kubectl set image deployment/account-service \
            account-service=${{ secrets.DOCKERHUB_USERNAME }}/account-service:${{ github.sha }}
          kubectl rollout status deployment/account-service --timeout=120s
```

### GitHub Actions vs Jenkins

Both tools implement the same CI/CD concepts, but with different trade-offs:

| Aspect | GitHub Actions | Jenkins |
|:-------|:--------------|:--------|
| **Setup** | Zero — runs in GitHub's cloud | Requires a server (Docker, VM, or bare metal) |
| **Configuration** | YAML in `.github/workflows/` | Groovy `Jenkinsfile` |
| **Scaling** | Managed by GitHub | You manage the runner fleet |
| **Marketplace** | 20,000+ pre-built actions | Extensive plugin ecosystem |
| **Cost** | Free for public repos; minutes-based for private | Free and open source; you pay for infrastructure |
| **Self-hosted runners** | Supported | Native — Jenkins IS the server |
| **Best for** | New projects, open source, GitHub-centric teams | Enterprise environments, complex pipelines |

