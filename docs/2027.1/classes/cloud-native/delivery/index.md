It is 09:40 on on-sale day. A bug in `inventory` lets a seat hold expire two minutes early, and the fix is a one-line change. In a team without a delivery pipeline, the fix waits: someone must build it, someone must copy the jar, someone must restart servers one by one, and nobody wants to do that twenty minutes before the biggest traffic peak of the year. In a team with a good pipeline, the fix is merged, built, scanned, rolled out to 5 % of the traffic, **checked automatically against the SLOs**, and promoted — or rolled back — without a human touching a server.

This page builds that pipeline in four layers: the infrastructure is **code**, every change is **integrated and tested continuously**, the cluster **pulls** its desired state from Git, and each release is **exposed gradually** and judged by metrics.

``` mermaid-sim
flowchart LR
    pr["Pull request<br/>inventory fix"] --> ci["CI: build · test · scan<br/>SBOM · sign · push image"]
    ci --> cfg["Config repo:<br/>image digest bumped"]
    cfg --> argo["Argo CD:<br/>sync cluster to Git"]
    argo --> canary["Canary 5 % → 25 % → 50 %"]
    canary --> an{"Metrics analysis<br/>error rate, p99"}
    an -->|"healthy"| full["100 % — promoted"]
    an -->|"degraded"| rb["Automatic rollback"]
```

---

## Infrastructure as code { #iac }

The BoxOffice production environment has a VPC, subnets, a Kubernetes cluster, a managed PostgreSQL, a managed Redis, a Kafka cluster, buckets, DNS records and IAM roles — a few hundred resources. Created by clicking in a console, they cannot be reviewed, reproduced or rebuilt after a disaster, and staging silently drifts away from production. **Infrastructure as code (IaC)** describes those resources in versioned files that a tool applies.

| Property | Why it matters for BoxOffice |
|---|---|
| **Declarative** | You write *what* should exist; the tool computes the create/update/delete plan |
| **Reviewable** | A change to the database instance size is a pull request with a diff and an approver |
| **Reproducible** | Staging and a load-test environment are the same modules with different variables — parity for [performance tests](../../performance/methodology/index.md) |
| **Recoverable** | After a region loss, the environment is re-created from code (data comes from backups — see [Disaster recovery](../../reliability/disaster-recovery/index.md)) |

**Terraform** (HashiCorp) is the most widely used IaC tool. In 2023 HashiCorp changed its license to the Business Source License; the community fork **OpenTofu**, hosted by the Linux Foundation, keeps the open-source MPL 2.0 license and the same language (HCL) and CLI workflow[^1]. The snippet below works in both:

```hcl title="infra/modules/data/main.tf"
variable "env"            { type = string }                 # "staging" | "prod"
variable "db_instance"    { type = string }                 # e.g. "db.r6g.large"
variable "private_subnets" { type = list(string) }

resource "aws_db_subnet_group" "boxoffice" {
  name       = "boxoffice-${var.env}"
  subnet_ids = var.private_subnets
}

resource "aws_db_instance" "inventory" {
  identifier                  = "boxoffice-inventory-${var.env}"
  engine                      = "postgres"
  engine_version              = "17"
  instance_class              = var.db_instance
  allocated_storage           = 100
  multi_az                    = var.env == "prod"           # standby in another AZ
  db_subnet_group_name        = aws_db_subnet_group.boxoffice.name
  username                    = "boxoffice"
  manage_master_user_password = true                        # password kept in Secrets Manager
  backup_retention_period     = 7
  deletion_protection         = var.env == "prod"
  tags = { project = "boxoffice", env = var.env, service = "inventory" }
}

resource "aws_s3_bucket" "tickets" {
  bucket = "boxoffice-tickets-${var.env}"
  tags   = { project = "boxoffice", env = var.env }
}

output "inventory_endpoint" { value = aws_db_instance.inventory.endpoint }
```

```hcl title="infra/envs/prod/main.tf"
terraform {
  backend "s3" {                                  # shared, locked state
    bucket       = "boxoffice-tfstate"
    key          = "prod/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
  }
}

module "data" {
  source          = "../../modules/data"
  env             = "prod"
  db_instance     = "db.r6g.large"
  private_subnets = module.network.private_subnet_ids
}
```

```bash
tofu init          # download providers, configure the state backend
tofu plan          # show what would change — reviewed in the pull request
tofu apply         # apply exactly the reviewed plan
```

The tool keeps a **state file** mapping each resource in the code to a real resource ID. It must be **remote and locked** (two engineers applying at once corrupt it) and is sensitive (it may contain secrets). When someone changes a resource by hand, the next `plan` shows **drift** — a scheduled `plan` in CI that alerts on drift keeps the console honest.

| Tool | Style | Notes |
|---|---|---|
| **Terraform / OpenTofu** | Declarative HCL, any provider | The common default; huge provider ecosystem |
| **Pulumi** | General-purpose languages (TypeScript, Python, Go, Java) | Loops and abstractions in a real language; same plan/apply model |
| **AWS CloudFormation / CDK, Azure Bicep, GCP Infrastructure Manager** | Provider-native | No state file to manage; one cloud only |
| **Crossplane** | Kubernetes custom resources reconciled by controllers | Infrastructure managed by the same GitOps loop as the applications |

---

## Continuous integration

**Continuous integration (CI)** means every change is merged to the main branch frequently and verified automatically by building and testing it. **Continuous delivery (CD)** means every verified change is *releasable* at any time; **continuous deployment** goes one step further and releases every change automatically[^2].

BoxOffice's CI runs on GitHub Actions. On a pull request it builds and tests; on `main` it also publishes a signed image and proposes the new version to the configuration repository:

```yaml title=".github/workflows/inventory.yaml"
name: inventory
on:
  pull_request: { paths: [ "inventory/**" ] }
  push:         { branches: [ main ], paths: [ "inventory/**" ] }

permissions:
  contents: read
  packages: write        # push to GitHub Container Registry
  id-token: write        # keyless signing with Sigstore
  attestations: write

jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      digest: ${{ steps.push.outputs.digest }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: "21", cache: maven }
      - name: Unit and integration tests (Testcontainers)
        run: mvn -B -f inventory/pom.xml verify
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with: { registry: ghcr.io, username: "${{ github.actor }}", password: "${{ secrets.GITHUB_TOKEN }}" }
      - name: Build and push image
        id: push
        uses: docker/build-push-action@v6
        with:
          context: inventory
          push: ${{ github.ref == 'refs/heads/main' }}
          tags: ghcr.io/boxoffice/inventory:${{ github.sha }}
          sbom: true                      # SBOM attached to the image
          provenance: mode=max            # SLSA provenance
      - name: Scan for critical vulnerabilities
        uses: aquasecurity/trivy-action@0.28.0
        with:
          image-ref: ghcr.io/boxoffice/inventory:${{ github.sha }}
          severity: CRITICAL
          exit-code: "1"
      - name: Sign image (keyless)
        if: github.ref == 'refs/heads/main'
        run: cosign sign --yes ghcr.io/boxoffice/inventory@${{ steps.push.outputs.digest }}

  propose-release:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - name: Bump the image digest in the config repo (staging overlay)
        run: |
          git clone https://x-access-token:${{ secrets.CONFIG_REPO_TOKEN }}@github.com/<your-org>/boxoffice-config.git
          cd boxoffice-config/apps/inventory/overlays/staging
          kustomize edit set image inventory=ghcr.io/boxoffice/inventory@${{ needs.build.outputs.digest }}
          git commit -am "inventory: ${{ github.sha }}" && git push
```

Notice what the pipeline does **not** do: it never runs `kubectl apply` against production and holds no cluster credentials. It only writes to Git. The cluster pulls. [Hands-on 11](../../../hands-on/11/index.md) builds this workflow step by step and adds a **k6 performance budget gate** (see [Capacity planning — performance budgets](../../performance/capacity-planning/index.md#performance-budgets)).

!!! tip "Keep CI fast"

    A pipeline that takes 40 minutes is a pipeline people bypass. Cache dependencies (`cache: maven`), run unit tests before slow integration tests, build images with layer caching, and run independent jobs in parallel. The DORA research associates short lead times with *better* stability, not worse[^3].

---

## GitOps with Argo CD { #gitops }

**GitOps** applies the Kubernetes control loop to delivery itself. The OpenGitOps principles are: the desired state is **declarative**, **versioned and immutable** (in Git), **pulled automatically** by an agent in the cluster, and **continuously reconciled**[^4].

``` mermaid-sim
sequenceDiagram
    participant Dev as Engineer
    participant Git as Config repo (Git)
    participant Argo as Argo CD (in the cluster)
    participant K8s as Kubernetes API
    Dev->>Git: PR "inventory → sha256:ab12…" (reviewed, merged)
    Argo->>Git: poll / webhook: new commit
    Argo->>K8s: diff desired vs live → apply
    K8s-->>Argo: resources healthy
    Note over Argo,K8s: someone runs kubectl edit by hand…
    Argo->>K8s: drift detected → reverted to Git (self-heal)
```

```yaml title="config/argocd/inventory-prod.yaml"
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: inventory-prod
  namespace: argocd
spec:
  project: boxoffice
  source:
    repoURL: https://github.com/<your-org>/boxoffice-config.git
    targetRevision: main
    path: apps/inventory/overlays/prod
  destination:
    server: https://kubernetes.default.svc
    namespace: boxoffice
  syncPolicy:
    automated:
      prune: true        # delete resources removed from Git
      selfHeal: true     # revert manual changes
    syncOptions: [ CreateNamespace=true ]
```

| | Push-based CD (CI runs `kubectl apply`) | **Pull-based GitOps** (Argo CD, Flux) |
|---|---|---|
| Credentials | CI holds cluster-admin credentials — a juicy target | Only the in-cluster agent can change the cluster |
| Drift | Undetected until the next deploy | Detected and optionally reverted continuously |
| Audit trail | Spread across CI logs | `git log` of the config repo |
| Rollback | Re-run an old pipeline | `git revert` |
| Multi-cluster | One pipeline step per cluster | Each cluster pulls its own path |

**Promotion** between environments becomes a pull request that copies the digest from `overlays/staging` to `overlays/prod` — reviewed, auditable and trivially reversible.

---

## Deployment strategies { #deployment-strategies }

Deploying (putting new code on servers) and **releasing** (exposing it to users) are different steps. The strategies below differ in how they separate them:

| Strategy | How | Downtime | Extra capacity | Rollback | Blast radius |
|---|---|---|---|---|---|
| **Recreate** | Stop all old, start all new | Yes | None | Redeploy old (slow) | 100 % |
| **Rolling update** | Replace pods a few at a time (`maxSurge`, `maxUnavailable`) | No | Small (surge) | Roll forward/back gradually | Grows with the rollout |
| **Blue/green** | Run the full new version beside the old; switch the router at once | No | 2× during switch | Switch back — seconds | 100 % at the switch, but instant undo |
| **Canary** | Send a small % of traffic to the new version, increase while metrics stay healthy | No | Small | Set weight to 0 — seconds | 1–5 % at first |
| **Shadow (mirroring)** | Copy live traffic to the new version; discard its responses | No | Up to 2× | Nothing to roll back | 0 % (beware side effects: payments!) |
| **Feature flags** | Deploy code dark; enable per user/segment at runtime | No | None | Flip the flag | Chosen segment |

Rolling updates are the Kubernetes default and are enough for most changes. For risky changes on the purchase path — `inventory`, `order`, `payment` — BoxOffice uses **canaries**, and for product features **feature flags** (with a vendor-neutral API such as OpenFeature), which decouple *deploy* from *release* entirely: the code ships on Tuesday, the feature turns on for 1 % of fans on Thursday.

!!! warning "The database does not roll back"

    Two versions of `order` run side by side during any rolling update or canary, so every schema change must be **backward compatible**. Use **expand/contract** (parallel change): (1) *expand* — add the new column, nullable; (2) deploy code that writes both and reads the new one with a fallback; (3) backfill; (4) *contract* — drop the old column in a later release. Never rename or drop a column in the same release that stops using it.

---

## Canary with automated metrics analysis { #canary-with-automated-metrics-analysis }

A canary is only as good as the decision to promote it. Looking at a dashboard and "feeling fine" is not a decision. **Argo Rollouts** replaces a Deployment with a `Rollout` that shifts traffic in steps and runs an **analysis** at each step, querying the metrics backend and aborting automatically when the canary is worse than its thresholds[^5].

```yaml title="config/apps/inventory/base/rollout.yaml"
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata: { name: inventory }
spec:
  replicas: 10
  selector: { matchLabels: { app: inventory } }
  template:
    metadata: { labels: { app: inventory } }
    spec:
      containers:
        - name: inventory
          image: ghcr.io/boxoffice/inventory@sha256:ab12c3d4e5f6
  strategy:
    canary:
      canaryService: inventory-canary
      stableService: inventory-stable
      trafficRouting:
        plugins:
          argoproj-labs/gatewayAPI: { httpRoute: inventory, namespace: boxoffice }
      analysis:                                  # runs in the background from step 1
        templates: [ { templateName: inventory-slo } ]
        startingStep: 1
      steps:
        - setWeight: 5
        - pause: { duration: 10m }
        - setWeight: 25
        - pause: { duration: 10m }
        - setWeight: 50
        - pause: { duration: 10m }
```

```yaml title="config/apps/inventory/base/analysis.yaml"
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata: { name: inventory-slo }
spec:
  metrics:
    - name: error-rate
      interval: 1m
      failureLimit: 2                       # two bad minutes → abort and roll back
      successCondition: result[0] < 0.005   # < 0.5 % of requests fail
      provider:
        prometheus:
          address: http://prometheus.monitoring:9090
          query: |
            sum(rate(http_server_requests_seconds_count{service="inventory-canary",status=~"5.."}[2m]))
            /
            sum(rate(http_server_requests_seconds_count{service="inventory-canary"}[2m]))
    - name: p99-latency
      interval: 1m
      failureLimit: 2
      successCondition: result[0] < 0.300   # p99 below 300 ms (the hold SLO)
      provider:
        prometheus:
          address: http://prometheus.monitoring:9090
          query: |
            histogram_quantile(0.99, sum by (le) (
              rate(http_server_requests_seconds_bucket{service="inventory-canary"}[2m])))
```

### How long must a canary run? { #how-long-must-a-canary-run }

A canary at 5 % sees few requests, and rare errors need many requests to become visible. Before choosing pause durations, estimate how many canary requests you need to tell a real regression from noise. The table uses the standard normal-approximation sample size for comparing two proportions (one-sided α = 5 %, power 80 %), with an illustrative baseline error rate of 0.1 % and 400 requests per second reaching `inventory`:

```python exec="1"
from math import sqrt, ceil

Z_ALPHA, Z_BETA = 1.645, 0.842     # one-sided 5 % significance, 80 % power
BASELINE = 0.001                   # 0.1 % of requests fail today (assumption)
TOTAL_RPS = 400                    # requests/s reaching inventory (assumption)

def needed(p0, p1):
    pbar = (p0 + p1) / 2
    num = Z_ALPHA * sqrt(2 * pbar * (1 - pbar)) + Z_BETA * sqrt(p0 * (1 - p0) + p1 * (1 - p1))
    return ceil((num / (p1 - p0)) ** 2)

print("| Regression to detect | Canary requests needed | Time at 5 % weight | Time at 25 % weight |")
print("|---|---|---|---|")
for p1 in (0.010, 0.005, 0.002):
    n = needed(BASELINE, p1)
    t5 = n / (TOTAL_RPS * 0.05) / 60
    t25 = n / (TOTAL_RPS * 0.25) / 60
    print(f"| {BASELINE:.1%} → {p1:.1%} errors | {n:,} | {t5:.1f} min | {t25:.1f} min |")
```

Large regressions show up in a minute or two; a doubling of a small error rate needs a quarter of an hour at 5 %. That is why canary steps are measured in **minutes, not seconds**, why the analysis compares the canary with the **stable baseline** running at the same time (same traffic, same hour), and why low-traffic services are better served by longer pauses or synthetic traffic. Google's SRE workbook discusses these trade-offs in its chapter on canarying releases[^6].

!!! example "BoxOffice: no canaries during the on-sale"

    Even with automated analysis, BoxOffice declares a **change freeze** on the purchase path from 30 minutes before an on-sale until it ends: the traffic is too unusual for the baseline to mean anything, and the cost of a bad rollout is highest. The 09:40 fix from the introduction is therefore deployed through an *expedited* canary (5 % → 100 % with a 5-minute analysis) at 09:42 — or it waits. Writing that rule down in advance is part of delivery engineering.

---

## Measuring delivery: the DORA metrics { #measuring-delivery-the-dora-metrics }

The DORA research program (DevOps Research and Assessment) found four metrics that predict software-delivery performance and that move together in high-performing teams[^3]:

| Metric | Question | Throughput or stability |
|---|---|---|
| **Deployment frequency** | How often do we deploy to production? | Throughput |
| **Lead time for changes** | How long from commit to running in production? | Throughput |
| **Change failure rate** | What fraction of deployments cause a failure needing remediation? | Stability |
| **Time to restore service** | How long to recover from such a failure? | Stability |

The key finding — speed and stability are **not** a trade-off — is the argument for everything on this page: small, frequent, automatically verified changes are both faster and safer than large, rare, manual ones.

---

## AI in the pipeline

Pipelines increasingly include AI steps: automated pull-request review, generated tests, agents that propose fixes for failing builds, AI-assisted canary analysis, release notes and incident summaries — and the security and governance questions they raise. These are covered in their own class: **[AI-Assisted Delivery](../../ai-delivery/index.md)**. The foundations on this page — reproducible builds, GitOps, metric-gated rollouts — are what make those AI steps safe to adopt.

---

## Trade-offs

| Decision | Choose A when… | Choose B when… |
|---|---|---|
| Rolling vs canary | Low-risk change, good tests, fast rollback | Critical path, hard-to-test behaviour under real traffic |
| Blue/green vs canary | You need an instant all-or-nothing switch (e.g. a protocol change) and can afford 2× capacity briefly | You want to limit blast radius and judge with metrics |
| Feature flag vs canary | Exposing *product* behaviour to chosen users | Validating a *new build* as a whole |
| Monorepo pipeline vs per-service | Shared tooling, atomic cross-service changes | Independent teams and release cadences |

!!! tip "In the interview"

    When the interviewer asks "how do you roll this out safely?", answer in layers: **immutable images built once**, **GitOps** so production equals Git, **canary** on the critical path with **automatic rollback on SLO metrics** (error rate and p99 compared with the baseline), **feature flags** for product changes, and **expand/contract** migrations so two versions can run side by side. Mention that canary duration depends on traffic volume — it shows you understand the statistics, not just the tool.

!!! warning "Pitfalls"

    - **Building a different artifact per environment**: what you tested is not what you ship. Build once, promote by digest.
    - **Canary without automated analysis**: a human looking at graphs promotes everything.
    - **Canary judged on CPU**: judge on user-facing SLIs (errors, latency), compared with the stable baseline.
    - **Shadowing a service with side effects**: mirrored `POST /payments` charge real cards twice.
    - **IaC state on a laptop**: lost, unlocked or full of secrets.
    - **Long-lived feature flags**: every flag is a branch in the code; remove flags after the rollout.

## How it connects { #how-it-connects }

``` mermaid
flowchart LR
    IAC["IaC: Terraform / OpenTofu<br/>plan, apply, remote state"] --> INFRA["VPC, cluster,<br/>managed data services"]
    INFRA --> DR["re-create after a region loss<br/>→ Disaster recovery"]
    CI["CI: build, test, scan,<br/>SBOM, sign"] --> IMG["image by digest"]
    IMG --> GIT["config repo:<br/>desired state in Git"]
    GIT --> ARGO["Argo CD pulls,<br/>reconciles drift"]
    ARGO --> STRAT["rolling, blue/green,<br/>canary, feature flags"]
    STRAT --> EXP["expand/contract:<br/>backward-compatible schema"]
    STRAT --> AN["canary analysis: error rate,<br/>p99 vs stable baseline"]
    AN --> SLO["SLIs and SLOs<br/>→ Reliability, Observability"]
    AN --> N["sample size:<br/>minutes, not seconds"]
    STRAT --> DORA["DORA metrics"]
    CI --> AI["AI steps in the pipeline<br/>→ AI-assisted delivery"]
```

**Palette components:** [`vpc`](../../../reference/components/network/index.md#vpc) (created by IaC) · [`sql`](../../../reference/components/storage/index.md#sql) · [`cache`](../../../reference/components/storage/index.md#cache) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (managed, declared in Terraform) · [`ingress`](../../../reference/components/edge/index.md#ingress) (Gateway API splits canary traffic) · [`metrics`](../../../reference/components/observability/index.md#metrics) (queried by the canary analysis) · [`app`](../../../reference/components/compute/index.md#app) (`inventory`, `order`, `payment` on canaries). **Scenarios:** — delivery happens outside the simulator; the metrics a canary is judged on are the ones of `observability-stack`. **Continues in:** [Reliability — SLOs](../../reliability/slo/index.md), [Reliability — disaster recovery](../../reliability/disaster-recovery/index.md), [Performance — budgets in CI](../../performance/capacity-planning/index.md#performance-budgets), [AI-assisted delivery](../../ai-delivery/index.md), [Hands-on 13 — canary](../../../hands-on/13/canary/index.md), [Project milestones](../../../exercises/project/milestones/index.md).

---

[^1]: OpenTofu. [OpenTofu documentation](https://opentofu.org/docs/){target="_blank"}; HashiCorp. [Terraform language documentation](https://developer.hashicorp.com/terraform/language){target="_blank"}.
[^2]: HUMBLE, J.; FARLEY, D. *Continuous Delivery: Reliable Software Releases through Build, Test, and Deployment Automation*. Addison-Wesley, 2010.
[^3]: FORSGREN, N.; HUMBLE, J.; KIM, G. *Accelerate: The Science of Lean Software and DevOps*. IT Revolution, 2018; [DORA research](https://dora.dev/){target="_blank"}.
[^4]: OpenGitOps. [GitOps Principles v1.0](https://opengitops.dev/){target="_blank"}; Argo CD. [Documentation](https://argo-cd.readthedocs.io/){target="_blank"}.
[^5]: Argo Rollouts. [Canary strategy and analysis](https://argo-rollouts.readthedocs.io/){target="_blank"}.
[^6]: BEYER, B. et al. (eds.). [The Site Reliability Workbook](https://sre.google/workbook/canarying-releases/){target="_blank"}, ch. 16 "Canarying Releases". O'Reilly, 2018.
