Click **"Answer"** to reveal the correct answer and explanation.

---

## Continuous integration

**Q1.** Why does `CatalogApiTest` use Testcontainers instead of an in-memory database such as H2?

- A. Testcontainers is faster than H2
- B. The test runs the real PostgreSQL 17 (and Redis): Flyway migrations, SQL dialect, constraints and the cache behave exactly as in production, so a passing test means something about production
- C. H2 cannot be used with Spring Boot 4
- D. GitHub Actions forbids in-memory databases

??? success "Answer"
    **B — test against the real dependency.**

    An in-memory substitute accepts SQL that PostgreSQL rejects (and the reverse), ignores PostgreSQL-specific features such as `ON CONFLICT` or partial indexes, and never runs the real migrations. Testcontainers starts the real image in Docker for the duration of the test; the price is a few seconds per test class.

---

**Q2.** The workflow has `permissions: contents: read` at the top, and the `image` job adds `packages: write`, `id-token: write`, `attestations: write` and `security-events: write`. Why not give `write-all` to the whole workflow?

- A. `write-all` is not valid YAML
- B. Least privilege: a compromised step (for example, a malicious dependency in a test) can only do what its job's token allows; the test jobs cannot push images or rewrite the repository
- C. It makes the workflow faster
- D. GitHub charges for write permissions

??? success "Answer"
    **B — limit the blast radius of every job.**

    The `GITHUB_TOKEN` is injected into every job. Jobs that run third-party code (Maven plugins, test dependencies) get read-only access; only the job that must publish gets the permissions to do it, and only for its duration.

---

**Q3.** Why is every action pinned to a commit SHA (`aquasecurity/trivy-action@ed142fd…`, `actions/checkout@3d3c42e…`) instead of a tag?

- A. Tags are not supported for third-party actions
- B. A tag can be moved by whoever controls the action's repository; a full SHA always refers to the same code, so a hijacked tag cannot inject code into your pipeline
- C. SHAs make the workflow run faster
- D. Dependabot only works with SHAs

??? success "Answer"
    **B — immutable references for code that runs with your token.**

    Tag hijacking has been used in real supply-chain attacks against CI systems. Pinning to a SHA (with the version in a comment) makes the reference immutable; Dependabot then proposes updates as reviewable pull requests.

---

## Supply chain

**Q4.** The `image` job builds with `load: true`, scans, and only then pushes. What is the advantage over pushing first and scanning the registry image?

- A. Scanning local images is more accurate
- B. A vulnerable image is never published: if the gate fails, nothing reaches the registry where a cluster could pull it
- C. It saves registry storage costs only
- D. Trivy cannot scan registry images

??? success "Answer"
    **B — gate before publish.**

    Anything in the registry can be deployed by someone (or something, like Argo CD with a moving tag). Failing before the push keeps the registry clean; the push itself is cheap because the layers are already in the build cache.

---

**Q5.** Why does the Trivy gate fail only on `CRITICAL` vulnerabilities **with a fix** (`ignore-unfixed`), while the full report lists everything?

- A. Trivy cannot detect unfixed vulnerabilities
- B. A gate must be actionable: blocking every change for vulnerabilities nobody can fix today makes the gate permanently red, and teams learn to bypass it; the report keeps the rest visible for prioritization
- C. HIGH vulnerabilities are never exploitable
- D. GitHub limits SARIF uploads to critical findings

??? success "Answer"
    **B — gates that are always red get ignored.**

    The gate stops what you can and must fix now (a patched version exists). Everything else goes to the Security tab, where it can be triaged, accepted with an expiry, or fixed when a patch appears.

---

**Q6.** What does the build-provenance attestation let you verify with `gh attestation verify`?

- A. That the image has no vulnerabilities
- B. That this exact image digest was built by your repository's workflow, from a specific commit, on GitHub's runners — and has not been modified since
- C. That the SBOM is complete
- D. That the image was scanned by Trivy

??? success "Answer"
    **B — who built it, from what, and that it was not tampered with.**

    The attestation is a signed statement (Sigstore, keyless, using the job's OIDC identity) bound to the image digest. A cluster admission policy can refuse images without valid provenance from your repository — the "S" of SLSA.

---

## Performance gate

**Q7.** The budget test has a 20 s `warmup` scenario that is not covered by the thresholds. Why?

- A. To save CI minutes
- B. A JVM that just started is slower (JIT compilation, empty pools and cache): measuring it would make the gate fail on noise instead of on regressions
- C. k6 needs time to start its virtual users
- D. Thresholds cannot apply to the whole test

??? success "Answer"
    **B — measure the steady state you promised.**

    Cold-start latency is real and matters for autoscaling (lab 10), but the budget compares versions of the code: it must measure each one in the same warm state.

---

**Q8.** The budget is p95 < 300 ms, and the normal run measures p95 ≈ 7 ms. Isn't such a loose threshold useless?

- A. Yes, it should be 8 ms
- B. No: shared CI runners are noisy, so a tight threshold would fail randomly; the gate is there to catch large regressions (the deliberate 400 ms sleep, an N+1 query), while the trend of the numbers over many runs reveals small ones
- C. Yes, thresholds should always equal the measured value
- D. No, because k6 rounds latencies

??? success "Answer"
    **B — a gate must have a low false-positive rate.**

    A gate that fails at random trains people to click "re-run" until green — and then it catches nothing. Keep a margin, track the numbers, tighten deliberately.

---

## GitOps and canary

**Q9.** In this lab, CI never runs `kubectl apply` against the cluster. How does a new version get deployed?

- A. Argo CD polls GHCR for new images
- B. The `Deploy` workflow commits the new image tag to `k8s/overlays/gitops`; Argo CD, running inside the cluster, sees the commit and applies the overlay
- C. Kubernetes pulls the `main` tag every minute
- D. The developer runs `kubectl apply` after CI

??? success "Answer"
    **B — pull-based GitOps.**

    The cluster credentials never leave the cluster; Git holds the complete, audited history of what was deployed; rollback is `git revert`; and drift is detected and, with `selfHeal`, undone automatically.

---

**Q10.** Someone runs `kubectl -n boxoffice scale deployment redis --replicas=0`. What happens with `selfHeal: true`?

- A. Redis stays at 0 replicas until the next deploy
- B. Argo CD detects that the cluster differs from Git (`OutOfSync`) and restores 1 replica within seconds
- C. Argo CD deletes the Redis Deployment
- D. The HPA scales Redis back up

??? success "Answer"
    **B — Git is the source of truth.**

    Manual changes are reverted; to change the cluster you change Git. That is also why the HPA's replica count must not be in the Rollout's spec: otherwise Argo CD and the HPA would fight over it.

---

**Q11.** The bad release (30% errors) was aborted with the measurements `[]`, `0.068`, `0.285` and `failureLimit: 1`. Why did the first, empty measurement not fail the analysis?

- A. Argo Rollouts ignores the first measurement
- B. The success condition `len(result) == 0 || isNaN(result[0]) || result[0] < 0.01` treats "no canary traffic yet" as a success; the abort came with the second failure (0.068 and 0.285 > 1%), exceeding `failureLimit: 1`
- C. Prometheus was down
- D. The canary had no pods

??? success "Answer"
    **B — handle "no data" explicitly.**

    Right after a canary starts, the query has no samples. Without the `len`/`isNaN` guard, the analysis would fail (or error) immediately on every release. The trade-off: with no traffic, a canary is promoted without evidence — keep load on the service, or lengthen the pauses.

---

**Q12.** During a canary, both the old and the new version of `catalog` run against the same database. Which schema change is safe to ship in the new version?

- A. Renaming a column the old version reads
- B. Dropping a column the new version no longer uses
- C. Adding a new nullable column (expand), with the new code tolerating its absence
- D. Changing a column's type in place

??? success "Answer"
    **C — expand/contract.**

    Migrations run once, for both versions, and the old version keeps running during the canary — and after an abort. Only backward-compatible changes are safe; the "contract" (drop, rename) happens in a later release, when no running version depends on the old shape.

[Back to the lab](index.md){ .md-button }
