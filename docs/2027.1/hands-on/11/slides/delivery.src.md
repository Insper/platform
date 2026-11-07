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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

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
- Measure it: **lead time** and **change failure rate** (DORA: DevOps Research and Assessment).

---

## The pipeline

<div class="flow">
<div class="group">
<div class="caption">CI: continuous integration, on every push and pull request</div>
<div class="box accent">test (matrix)<small>does it work? Testcontainers</small></div>
<div class="box accent">performance budget<small>is it fast enough? k6</small></div>
<div class="box accent">image<small>what is inside, is it vulnerable, who built it?</small></div>
</div>
<div class="arrow">on main →</div>
<div class="box orange" style="flex: .6">Deploy<small>which version should run? a Git commit</small></div>
<div class="arrow">pull →</div>
<div class="group">
<div class="caption">in the cluster</div>
<div class="box green">Argo CD<small>applies the overlay</small></div>
<div class="box green">Argo Rollouts<small>deploys it, carefully</small></div>
</div>
</div>

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

<div class="flow">
<div class="box">build<small>load: true, not pushed yet</small></div><div class="arrow">→</div>
<div class="box orange">Trivy<small>report in Security; gate: fixable CRITICAL fails</small></div><div class="arrow">→</div>
<div class="box accent">SBOM<small>Syft, SPDX: every package and version</small></div><div class="arrow">→</div>
<div class="box accent">push<small>ghcr.io/…/boxoffice-catalog:sha-…</small></div><div class="arrow">→</div>
<div class="box green">attest<small>provenance + SBOM, signed, bound to the digest</small></div>
</div>

- **Scan before publishing**: a vulnerable image never reaches the registry.
- The software bill of materials (**SBOM**) answers "what is inside"; signed provenance answers "who built it, from which commit".

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
- Normal run: p95 ≈ 7 ms. With `Thread.sleep(400)`: ✗ → the pull request (PR) is red.
- Margin on purpose: a **noisy gate** gets ignored.

---

## Step 4 · GitOps

<div class="flow">
<div class="box accent">CI<small>image sha-…</small></div><div class="arrow">→</div>
<div class="box orange">Deploy<small>commits the tag to k8s/overlays/gitops</small></div><div class="arrow">→</div>
<div class="box">Git<small>the desired state</small></div><div class="arrow">← polls every 3 min ←</div>
<div class="box green">Argo CD<small>inside the cluster: apply, prune, self-heal</small></div>
</div>

- CI never touches the cluster: it only writes to Git.
- Rollback = `git revert`; audit = `git log`; drift → reverted in seconds.

<div class="ok">

The cluster credentials never leave the cluster.

</div>

---

## Step 5 · The canary

<div class="flow">
<div class="box orange">setWeight 25<small>1 canary pod + 2 stable: about a third</small></div><div class="arrow">pause 2 min →</div>
<div class="box orange">setWeight 50<small>1 canary + 1 stable</small></div><div class="arrow">pause 2 min →</div>
<div class="box green">the canary becomes stable</div>
</div>
<div class="flow">
<div class="box accent">AnalysisRun, every 30 s from the first step<small>canary error ratio &lt; 1% and p99 &lt; 500 ms · failureLimit: 1 · empty result = pass</small></div>
</div>

- No traffic router: the `Rollout` reaches a weight by **replica counts** (`workloadRef` → the Deployment).
- `catalog-stable` / `catalog-canary` Services point at each version; Prometheus labels every series with `service`.

---

## A bad release, through Git

<div class="q">

`CHAOS_ERROR_RATE=0.3` committed to the overlay. What happens?

</div>

* Argo CD syncs → the Rollout starts a canary pod.
* Analysis: `[]` (no data yet), **0.068**, **0.285** → failed twice > `failureLimit: 1`.
* `RolloutAborted` → canary scaled down; stable keeps serving. Fix forward: `git revert`.

---

## Without a cluster: replay the analysis

<div class="flow">
<div class="box">t = 0 s<small>[] · no 500 series yet</small></div><div class="arrow">→</div>
<div class="box red">t = 30 s<small>0.258 ✖ (1)</small></div><div class="arrow">→</div>
<div class="box red">t = 60 s<small>0.284 ✖ (2) &gt; failureLimit 1</small></div><div class="arrow">→</div>
<div class="box orange">RolloutAborted<small>about 120 failed requests, 10% of that minute</small></div>
</div>

- The simulator on the canary step: a good release → every result `[]` → stable at **240 s**.
- **0 req/s** with 0.3 → every result `[]` → the bad release is **promoted**: no traffic, no evidence.
- `Thread.sleep(400)` → p99 0.409 s passes the canary; only the step 3 gate stops it.
- Playground `boxoffice-canary`: the same bug as a canary costs a quarter of the errors.

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
4. A **performance budget** turns the service level objective (SLO) into a build check — with margin.
5. **GitOps**: Git is the source of truth; the cluster pulls.
6. **Canary + analysis** stops bad releases automatically. Next: [lab 13](../../13/index.md) adds AI to this pipeline.
