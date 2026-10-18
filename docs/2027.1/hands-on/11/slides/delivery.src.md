---
marp: true
lang: en
title: Hands-on 11 — Delivery
description: System Architecture · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">System Architecture · Insper</div>

# Hands-on 11 — Delivery

**From `git push` to a canary that aborts by itself**

<!--
Outline: (1) why automate safety; (2) CI with Testcontainers; (3) supply chain: Trivy, SBOM,
provenance; (4) performance budget; (5) GitOps with Argo CD; (6) canary with Argo Rollouts;
(7) measure: lead time.
-->

---

## Ten changes a day, one flash sale

<div class="q">

Each change could break checkout: a slow query, a vulnerable library, a version that fails 30% of
the requests. Who reviews all of them by hand?

</div>

- Nobody can: the **pipeline** must answer "is this safe?" automatically.
- And when it is wrong, the **release** must limit the damage.
- Measure it: **lead time** and **change failure rate** (DORA).

---

## The pipeline

| Workflow | Job | Answers |
|---|---|---|
| `CI` | `test` (matrix) | does it work? (Testcontainers) |
| `CI` | `performance budget` | is it fast enough? (k6) |
| `CI` | `image` | what is inside, is it vulnerable, who built it? |
| `Deploy` | `promote` | which version should run? (a Git commit) |
| Argo CD + Rollouts | in the cluster | deploy it, carefully |

---

## Step 1 · Test against the real thing

```java
@SpringBootTest(webEnvironment = RANDOM_PORT)
@AutoConfigureTestRestTemplate
@Testcontainers
class CatalogApiTest {
    @Container @ServiceConnection
    static PostgreSQLContainer db = new PostgreSQLContainer("postgres:17");
    ...
}
```

- Real migrations, SQL, Redis, JSON errors — `Tests run: 3, Failures: 0`.
- `name: CI`, `permissions: contents: read`, one job per service, Maven cache.

---

## Step 2 · Supply chain

- **Build** with `load: true` → **Trivy** report (Security tab) → **gate**: fixable CRITICAL fails.
- **SBOM** (Syft, SPDX): every package and version in the image.
- **Push** to `ghcr.io/<you>/boxoffice-catalog:sha-<commit>`.
- **Attest** provenance + SBOM: signed (Sigstore), bound to the digest.

<div class="warn">

Every action pinned to a **commit SHA** (version in a comment): a tag can be moved by an attacker.

</div>

---

## Step 3 · Performance budget

```javascript
thresholds: {
  'http_req_duration{scenario:budget}': ['p(95)<300', 'p(99)<800'],
  'http_req_failed{scenario:budget}': ['rate<0.01'],
}
```

- Fixed environment (`.github/ci/compose.perf.yaml`), 20 s warm-up not measured.
- Normal run: p95 ≈ 7 ms. With `Thread.sleep(400)`: ✗ → the PR is red.
- Margin on purpose: a **noisy gate** gets ignored.

---

## Step 4 · GitOps

- CI never touches the cluster; **Deploy** commits the new tag to `k8s/overlays/gitops`.
- **Argo CD** (in the cluster) pulls Git and applies: `prune`, `selfHeal`.
- Rollback = `git revert`; audit = `git log`; drift → reverted in seconds.

<div class="ok">

The cluster credentials never leave the cluster.

</div>

---

## Step 5 · The canary

| Object | Role |
|---|---|
| `Rollout` (`workloadRef` → the Deployment) | 25% → 2 min → 50% → 2 min → 100% |
| `catalog-stable` / `catalog-canary` Services | point at each version's pods |
| `AnalysisTemplate` | every 30 s: canary error ratio < 1%, p99 < 500 ms |
| Prometheus | scrapes `/actuator/prometheus`, label `service` |

---

## A bad release, through Git

<div class="q">

`CHAOS_ERROR_RATE=0.3` committed to the overlay. What happens?

</div>

* Argo CD syncs → the Rollout starts a canary pod.
* Analysis: `[]` (no data yet), **0.068**, **0.285** → failed twice > `failureLimit: 1`.
* `RolloutAborted` → canary scaled down; stable keeps serving. Fix forward: `git revert`.

---

## What a canary cannot catch

- **Migrations** run once for both versions → expand/contract only.
- **Rare errors** need many canary requests → longer pauses at low traffic.
- **Side effects** of canary requests (payments, e-mails) are real.
- No traffic → no evidence: keep load during the analysis.

---

<!-- _class: tight -->

## Step 6 · Measure it

| # | Experiment | Record |
|---|---|---|
| A | pipeline stages | duration of each job |
| B | lead time | push → CI → deploy commit → synced → stable |
| C | performance gate | p95/p99/failed, normal vs regression |
| D | canary | sync → abort, error measurements, failed requests |

<p class="small">Lead time is dominated by tests, image build, Argo CD polling (≤ 3 min) and the canary pauses — a deliberate price for safety.</p>

---

## Takeaways

1. Test against **real dependencies** (Testcontainers); run CI on every PR and on `main`.
2. **Least privilege** per job; pin every action to a commit SHA.
3. Scan **before** publishing; SBOM + signed provenance answer "what" and "who".
4. A **performance budget** turns the SLO into a build check — with margin.
5. **GitOps**: Git is the source of truth; the cluster pulls.
6. **Canary + analysis** stops bad releases automatically. Next: [lab 13](../../13/index.md) adds AI to this pipeline.
