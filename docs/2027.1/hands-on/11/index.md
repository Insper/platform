# 11. Delivery

!!! info "Goal"

    Turn `git push` into a safe, measured deployment. Add an integration test with **Testcontainers**
    and a **GitHub Actions** pipeline (`CI`) that tests every service, enforces a **k6 performance
    budget**, builds the image, **scans** it (Trivy), produces an **SBOM** and signed **provenance**,
    and publishes it to GHCR. Then deploy by **GitOps**: a `Deploy` workflow writes the new image tag to
    Git, **Argo CD** applies it to the cluster of lab 10, and **Argo Rollouts** releases it as a
    **canary** that aborts by itself when Prometheus shows errors.

The flash sale is next week and the team ships ten changes a day. Each of them could break checkout:
a slow query, a vulnerable library, a version that fails 30% of the requests. Nobody can review every
change by hand at that pace — the pipeline must answer *"is this change safe to give to 2 million
fans?"* automatically, and limit the damage when the answer was wrong. This lab is the hands-on side
of the [delivery page](../../classes/cloud-native/delivery/index.md) of the cloud-native class and
closes chapter 11 of the [story of the course](../../index.md#story) — rolling a bad release back
without a human: it implements
[continuous integration](../../classes/cloud-native/delivery/index.md#continuous-integration) with a
[performance budget](../../classes/performance/capacity-planning/index.md#performance-budgets),
[GitOps](../../classes/cloud-native/delivery/index.md#gitops) and a
[canary judged by metrics](../../classes/cloud-native/delivery/index.md#canary-with-automated-metrics-analysis).

## Slides

<div class="slides-embed">
  <iframe src="slides/delivery.html" title="Slides: delivery" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/delivery.html){:target="_blank"}

## Before you start

| | |
|---|---|
| Time | about 6 hours (two or three meetings); most of it is waiting for pipelines |
| Accounts | a **GitHub** account with your `boxoffice` repository (lab 0). GitHub Actions and GHCR are free for public repositories and include free minutes and storage for private ones; nothing in this lab needs a paid plan or a cloud account |
| Tools | Git, Docker, `kubectl`, `kind`, Helm and k6 (labs 0 and 10); **GitHub CLI** `gh` (`gh --version`, `gh auth login`); JDK 21 + Maven only to run the tests locally (optional) |
| Cluster | the kind cluster of lab 10 with Traefik and metrics-server (recreate it with [lab 10, step 1](../10/cluster/index.md) if needed); Docker with at least 8 GB |

Every command runs from the **root of your `boxoffice` repository**, in the state lab 10 left it:

``` text title="Start state (end of lab 10)"
boxoffice/
├── docker-compose.yaml     # the Compose stack of labs 1-9
├── k8s/                    # lab 10: kind.yaml, base/, overlays/local/
├── infra/  load/  scripts/
└── services/               # auth, catalog, gateway, inventory, notification, order, payment
```

!!! tip "Catch up"

    Skipped or broke lab 10? Download [boxoffice-after-lab-10.zip](../10/boxoffice-after-lab-10.zip),
    unzip it, `cd boxoffice`, push it to your GitHub repository, and continue from here.

Every file of this lab is shown in full on these pages and published under
`https://insper.github.io/platform/2027.1/hands-on/11/code/<path>`.

## Architecture

``` diagram-sim
flowchart LR
    dev[git push / PR] --> test["CI: test (matrix, Testcontainers)"]
    test --> perf["CI: performance budget (k6)"]
    perf --> img["CI: image -> Trivy -> SBOM -> push -> attest"]
    img --> ghcr[(ghcr.io)]
    img -->|CI succeeded on main| dep["Deploy: kustomize edit set image + commit"]
    dep --> repo[(k8s/overlays/gitops in Git)]
    argo[Argo CD] -->|pull| repo
    argo --> ro[Rollout catalog]
    ro -->|"25% -> 50% -> 100%"| pods[catalog pods]
    prom[Prometheus] -->|scrape| pods
    ro -->|AnalysisTemplate| prom
```

!!! example "BoxOffice components touched"

    | Palette component | In this lab |
    |---|---|
    | [App Server](../../reference/components/compute/index.md#app) | `catalog`, built, scanned, signed and released as a canary |
    | [Metrics](../../reference/components/observability/index.md#metrics) | an in-cluster Prometheus feeding the canary analysis |
    | [Ingress](../../reference/components/edge/index.md#ingress) | Traefik from lab 10, in front of stable and canary pods |

## What you will measure

| Question | Metric | Tool |
|---|---|---|
| Where does the pipeline spend its time? | duration of each job | GitHub Actions, `gh run view` |
| How long from `git push` to users? | lead time per stage | timestamps |
| Does the gate catch a performance regression? | budget p95/p99 before and after | k6 in CI |
| Does the canary stop a bad release, and how fast? | sync → abort time, canary error ratio | Argo Rollouts, Prometheus |

## Prerequisites

- Labs [8](../8/index.md) (SLOs, metrics) and [10](../10/index.md) (the cluster and `k8s/`) done.
- Read the [delivery page](../../classes/cloud-native/delivery/index.md) and
  [supply-chain security](../../classes/network-security/zero-trust/index.md); for budgets,
  [performance budgets](../../classes/performance/capacity-planning/index.md#performance-budgets).

## Steps

1. [Tests and CI](ci/index.md) — a Testcontainers integration test and the `CI` workflow.
2. [Image and supply chain](supply-chain/index.md) — build, Trivy report and gate, SBOM, push, signed attestations, Dependabot.
3. [Performance gate](performance-gate/index.md) — a k6 budget that fails the pull request; break it on purpose.
4. [GitOps with Argo CD](gitops/index.md) — Argo CD, the GitOps overlay, the `Deploy` workflow, drift and self-healing.
5. [Canary with Argo Rollouts](canary/index.md) — Rollout + AnalysisTemplate on Prometheus; a bad release aborts by itself.
6. [Measure it](measure/index.md) — stage durations, lead time, the gate and the canary in numbers.

## Measure it

The [Measure it](measure/index.md) step has the results table to keep in `results/lab11.md`.

## Troubleshooting { #troubleshooting }

| Symptom | Likely cause | Fix |
|---|---|---|
| `test` fails with `Could not find a valid Docker environment` (locally) | Docker not running | start Docker; on CI this never happens on `ubuntu-latest` |
| `image` fails with `denied: permission_denied` on push | the job lacks `packages: write`, or the package belongs to another repository | keep the `permissions` block; in the package settings, give your repository *Write* access |
| `image` fails with `repository name must be lowercase` | the owner has uppercase letters | the workflow lowercases `${GITHUB_REPOSITORY_OWNER,,}`: do not replace it by a literal |
| the Trivy gate fails | a CRITICAL vulnerability with a fix exists in the image | read the table in the log; update the base image (`eclipse-temurin:21-jre` gets patched regularly) or the library, then push |
| `Deploy` fails with `remote rejected … protected branch` | branch protection forbids the bot's push | allow GitHub Actions to bypass, or open a pull request instead (see step 4) |
| Argo CD shows `ComparisonError … authentication required` | the repository secret is missing or the token expired | recreate `boxoffice-repo` (step 4) |
| pods in `ImagePullBackOff` with `ghcr.io/...` | private package and no pull secret, or wrong owner in the image | create `ghcr-pull` (step 4) or make the package public; check `newName` |
| the Rollout stays `Paused`/`Progressing` and the analysis is `Inconclusive` | no traffic reaches the canary, or Prometheus has no data | keep k6 running; `kubectl -n monitoring port-forward svc/prometheus 9090` and query `http_server_requests_seconds_count` |

!!! success "Best practices in this lab"

    - **No image unless tests and the performance budget pass** — `needs: [test, performance]` in `.github/workflows/ci.yaml`; why: [continuous integration](../../classes/cloud-native/delivery/index.md#continuous-integration).
    - **Supply chain under control**: actions pinned by SHA, a Trivy gate on fixable critical CVEs, an SBOM and provenance attestations, weekly Dependabot updates — `ci.yaml`, `.github/dependabot.yml`; why: [containers — supply chain](../../classes/cloud-native/containers/index.md#supply-chain).
    - **Least privilege**: `contents: read` by default, write permissions only in the jobs that need them — `ci.yaml`, `deploy.yaml`; why: [GitOps — credentials](../../classes/cloud-native/delivery/index.md#gitops).
    - **CI never touches the cluster**: `Deploy` only commits a tag, Argo CD pulls it, one deploy at a time — `deploy.yaml`, `k8s/argocd/application.yaml`; why: [GitOps](../../classes/cloud-native/delivery/index.md#gitops).
    - **Releases judged by user-facing SLIs, with automatic abort** — error ratio and p99 of the canary in `k8s/overlays/gitops/catalog-analysis.yaml`; why: [canary with metrics analysis](../../classes/cloud-native/delivery/index.md#canary-with-automated-metrics-analysis).

## Clean up

``` shell
kubectl delete -f k8s/argocd/application.yaml    # Argo CD stops managing (resources stay)
kind delete cluster --name boxoffice             # frees all the memory of the cluster
```

Keep the workflows and the GitOps overlay: [lab 13](../13/index.md) adds AI steps to this pipeline.
Disable the workflows (*Actions → … → Disable workflow*) if you do not want CI minutes spent until
then.

## End state

``` text title="End state (what this lab added or changed)"
boxoffice/
├── .github/
│   ├── workflows/ci.yaml           # name: CI  — test matrix, performance budget, image + supply chain
│   ├── workflows/deploy.yaml       # name: Deploy — writes the image tag of the GitOps overlay
│   ├── ci/compose.perf.yaml        # the performance-budget environment
│   └── dependabot.yml
├── k8s/
│   ├── argocd/application.yaml
│   ├── monitoring/prometheus.yaml
│   └── overlays/gitops/            # kustomization, catalog-services, catalog-rollout, catalog-analysis
├── load/budget.js
└── services/catalog/
    ├── pom.xml                     # + micrometer-registry-prometheus, test dependencies
    └── src/
        ├── main/java/boxoffice/catalog/ChaosFilter.java
        └── test/java/boxoffice/catalog/CatalogApiTest.java
```

Commit and tag: `git add -A && git commit -m "lab 11: delivery" && git tag lab11 && git push --tags`.

## Checklist

- [ ] `CI` runs on every push and pull request: test matrix green, performance budget green, and on `main` the image job pushes `ghcr.io/<you>/boxoffice-catalog:sha-<commit>` with provenance and SBOM attestations
- [ ] the Trivy report is in **Security → Code scanning**; the gate blocks fixable CRITICAL vulnerabilities
- [ ] a pull request with the deliberate regression was blocked by the performance budget (screenshot)
- [ ] Argo CD deploys `k8s/overlays/gitops` from Git; a manual change was reverted by self-healing
- [ ] a good release rolled out through the canary steps; the bad release was aborted automatically (output of `kubectl argo rollouts get rollout catalog`)
- [ ] results table filled in `results/lab11.md`, with the answer to its question
- [ ] self-check: `gh attestation verify oci://ghcr.io/<you>/boxoffice-catalog:main --owner <you>` succeeds; pushed with the tag `lab11`

## Related

- Theory: [Cloud-native platforms](../../classes/cloud-native/index.md) ·
  [Delivery: CI/CD, GitOps, deployment strategies](../../classes/cloud-native/delivery/index.md) ·
  [Zero trust and supply chain](../../classes/network-security/zero-trust/index.md) ·
  [Performance budgets](../../classes/performance/capacity-planning/index.md#performance-budgets)
- Previous lab: [10. Kubernetes](../10/index.md) — the cluster and manifests deployed here.
- Project: [team project](../../exercises/project/index.md) — your pipeline is part of the milestone "K8s + CI/CD".

!!! tip "Next: lab 13 adds AI to this pipeline"

    [Lab 13](../13/index.md) builds directly on these workflows: an AI pull-request reviewer, test
    generation checked by mutation testing, an agent that proposes a fix when `CI` fails, AI release
    notes and an explained canary verdict — with the same discipline of permissions, budgets and
    measurements.

[Start: Tests and CI](ci/index.md){ .md-button .md-button--primary }
