# 6. Measure It

Delivery is measured by how fast a change reaches users and how safely. The four **DORA metrics** —
deployment frequency, **lead time for changes**, change failure rate and time to restore — are the
industry vocabulary; this step measures the two you can observe in a lab, plus the cost of each
stage of your pipeline.

| # | Experiment | What you record |
|---|---|---|
| A | pipeline stages | duration of each job of `CI` and of `Deploy` |
| B | lead time | commit pushed → new version serving in the cluster |
| C | performance gate | budget numbers before and after the deliberate regression |
| D | canary | time from sync to abort; error ratio measured on the canary; requests that failed |

## A. Pipeline stages

Open the last green `CI` run on `main` (**Actions → CI**): the summary shows each job's duration.
Do the same for `Deploy`. Or, with the GitHub CLI:

``` shell
gh run list --workflow CI --limit 5
gh run view <run-id> --json jobs --jq '.jobs[] | "\(.name)\t\(.startedAt)\t\(.completedAt)"'
```

## B. Lead time

Make a visible change (for example a new comment line in `ChaosFilter.java`), note the time, push,
and record when each stage finishes:

``` shell
date +%T && git commit -am "lead time probe" && git pull --rebase && git push
kubectl argo rollouts -n boxoffice get rollout catalog --watch    # note the time it is Healthy again
```

| Stage | Time | Since push |
|---|---|---|
| push | | 0 |
| `CI` green | | |
| `Deploy` commit pushed | | |
| Argo CD synced (UI or `kubectl -n argocd get application boxoffice`) | | |
| Rollout `Healthy`, new version stable | | |

The biggest slices are usually the tests (Testcontainers images, Maven), the image build and the
canary pauses — the pauses are a deliberate price for safety.

## C. Performance gate

Record the budget lines (p95, p99, failed) of the last green run and of the run with the deliberate
`Thread.sleep(400)` of [step 3](../performance-gate/index.md).

## D. Canary

From the bad release of [step 5](../canary/index.md): the time Argo CD synced, the time the rollout
was `Degraded`, the `error-rate` measurements (`kubectl -n boxoffice get analysisrun -o yaml`), and the
share of failed requests k6 saw meanwhile.

!!! example "Expected shape (illustrative)"

    On GitHub's free runners, the test matrix and the image job take a few minutes each; the
    performance budget about two; `Deploy` well under a minute. Lead time is dominated by CI plus the
    up to 3-minute Argo CD polling plus the canary pauses (4 minutes here): roughly 10–20 minutes from
    push to fully rolled out. The bad canary aborts about one to two analysis intervals after the
    canary pod gets traffic.

## Results

Copy into `results/lab11.md` and fill in.

| Metric | Value |
|---|---|
| A · `test` matrix (slowest job) / `performance budget` / `image (catalog)` / `Deploy` (min:s) | |
| B · Lead time: push → `CI` green → deploy commit → synced → stable (min:s each) | |
| C · Budget p95 / p99 / failed — normal run | |
| C · Budget p95 / p99 / failed — with the regression (did the PR turn red?) | |
| D · Sync → `Degraded` (s); `error-rate` measurements | |
| D · Requests that failed during the bad canary (% of k6 requests) | |

Below the table: which stage would you optimize first to shorten the lead time, and what would it
cost in safety?

[Back to the overview](../index.md){ .md-button } [Quiz](../quiz.md){ .md-button .md-button--primary }
