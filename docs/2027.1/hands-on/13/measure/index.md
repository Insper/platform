Every lab of this course ends with a measurement, and this one matters more than most: AI tools are adopted on **feelings**. In a 2025 randomized controlled trial by METR, experienced open-source developers using AI tools took about **19 % longer** to complete their tasks — while believing they had been about **20 % faster**[^1]. One study does not settle the question for your team, but it settles one thing: **you must measure**. This part measures the reviewer of part 1 (and the other steps) over a week of real pull requests.

## 7.1 What to measure

| Metric | Definition | Source | Healthy direction |
|---|---|---|---|
| **Review precision** | 👍 ÷ (👍 + 👎) on AI comments | reactions on the review comments | high (≥ 70 % is a reasonable bar before a gate) |
| **Comments per PR** | AI comments posted ÷ PRs | review comments with the fingerprint marker | low and stable: noise is a cost |
| **Outdated comments** | AI comments whose line changed afterwards | `line == null` on the comment | a *weak* signal that the comment was addressed |
| **Cost per PR** | sum of `usd` in the sticky comment ÷ PRs | the hidden `ai-cost` lines | known and bounded |
| **CI minutes per PR** | sum of job durations of the PR's runs | Actions API | the AI jobs should be a small fraction |
| **Time to merge** | `mergedAt − createdAt` | PR API | should not get worse |
| **Recall on the golden set** | expected findings found ÷ expected | `eval_review.py` (part 6) | ≥ the threshold, per model |

Precision from reactions needs **people to react**. Agree on it in your team for this week: every AI comment gets a 👍 (useful: I changed something or learned something) or a 👎 (wrong, irrelevant or obvious). Unrated comments are reported separately.

## 7.2 The collector

``` { .python title=".github/ai/metrics.py" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/13/code/.github/ai/metrics.py"
```

Run it from the repository root (it only reads, with your `gh` login; it needs no model):

``` { .bash .copy }
mkdir -p results
uv run --no-project --python 3.12 python .github/ai/metrics.py --days 7 > results/lab13-metrics.md
cat results/lab13-metrics.md
```

You should see one row per PR of the period and the totals. The format, from a run with `--days 365` on a repository with two PRs and no AI comments yet:

```text
## AI reviewer, last 365 days (2 PRs)

| PR | Title | AI comments | 👍 | 👎 | Outdated | US$ | CI min | Hours to merge |
|---|---|---|---|---|---|---|---|---|
| #3 | docs: add git pull --recurse-submodules  | 0 | 0 | 0 | 0 | 0.0000 | 0.0 | 0.0 |
| #4 | feat: gitactions page | 0 | 0 | 0 | 0 | 0.0000 | 0.0 | 0.0 |

- Precision: no rated comments yet
- Comments per PR: 0.0 · rated: 0/0
- AI cost: US$ 0.00 total, US$ 0.000 per PR
- CI minutes: 0 total, 0.0 per PR
- Median time to merge: 0.0 h (2 merged)
```

With the free model, `US$` stays 0 — your cost is in the `CI min` column. Run it at the end of the week, and once in the middle to check that comments are being rated.

## 7.3 The week

You need **at least 10 PRs**. Work in pairs (or with your project team) and review each other's PRs as you normally would; the AI reviewer is one more voice. **Working alone?** Open the PRs yourself — small, real changes (a test, a rename, a log line, a README section, a fix from the reviewer's own comments) — rate each AI comment honestly before you read the next one, and say in your report that one person rated everything.

1. Days 1–2, **baseline**: `gh variable set AI_REVIEW_MAX_COMMENTS --body 0` (the job runs and costs nearly the same, but posts nothing) or `gh workflow disable ai-review.yaml`. Open 3–5 PRs.
2. Days 3–7, **with AI review**: `gh variable delete AI_REVIEW_MAX_COMMENTS` (or `gh workflow enable ai-review.yaml`). Open the remaining PRs. React to every AI comment with 👍 or 👎.
3. During the week, label two PRs with `ai-tests`, break CI once on purpose for the fix agent, and push one tag.
4. Run the eval of part 6 with **at least two models**. Free: the 7B model you already have and a 3B one (1.9 GB more):

    ``` { .bash .copy }
    OLLAMA_BASE_MODEL=qwen2.5-coder:3b OLLAMA_MODEL_NAME=qwen2.5-coder-3b-16k bash .github/ai/ollama-model.sh
    for m in qwen2.5-coder-16k qwen2.5-coder-3b-16k; do
      LLM_MODEL=$m uv run --no-project --python 3.12 --with-requirements .github/ai/requirements.txt \
        python .github/ai/eval_review.py .github/ai/evals 2>&1 | tail -n 6
    done
    ```

    With a Claude key (paid, a few cents in total), compare hosted models the same way:

    ``` { .bash .copy }
    for m in claude-opus-5-5 claude-sonnet-5-5 claude-haiku-4-5; do
      LLM_PROVIDER=anthropic LLM_MODEL=$m uv run --no-project --python 3.12 --with-requirements .github/ai/requirements.txt \
        python .github/ai/eval_review.py .github/ai/evals 2>&1 | tail -n 6
    done
    ```

    Each run ends with the recall line and the cost table; copy them into the models table below.

## 7.4 Results template

Copy into `results/lab13.md` and fill in:

```markdown
## Lab 13 — AI in CI/CD

### Reviewer over one week
| | Baseline (no AI comments) | With AI review |
|---|---|---|
| PRs | | |
| AI comments posted / per PR | — | |
| Rated 👍 / 👎 / unrated | — | |
| Precision 👍/(👍+👎) | — | |
| Outdated (line changed afterwards) | — | |
| Median time to merge (h) | | |
| CI minutes per PR | | |
| AI US$ per PR | | |

### Models on the golden set (part 6)
| Model | Recall | Extra findings | Injections flagged | US$ for 5 cases | Seconds |
|---|---|---|---|---|---|
| | | | | | |

### Other steps
| Step | Runs | Accepted / useful | US$ total | Notes |
|---|---|---|---|---|
| AI tests (PIT gain) | | | | |
| Fix agent (draft PRs merged) | | | | |
| Release notes (items dropped as ungrounded) | | | | |
| Canary explanation (consistent with policy) | | | | |

### Decision
For each step: keep, tune (which knob?), or remove — and why, with the numbers above.
```

## 7.5 Reading the numbers

- **Precision below ~50 %** — the reviewer is noise; people will learn to ignore it, including when it is right. Raise `AI_REVIEW_MIN_SEVERITY`, lower `AI_REVIEW_MAX_COMMENTS`, add the false positives to `CONVENTIONS.md` ("we use `double` for coordinates on purpose") and to the golden set.
- **High precision, few comments** — a candidate for gate mode on `blocker` + `high` confidence, as a *required* check. Still not an approval.
- **Cost per PR** — multiply by your team's PRs per month. At, say, US$ 0.02 per review and 400 PRs a month, the reviewer costs about US$ 8: less than ten minutes of an engineer's time. The **attention** cost of bad comments is usually bigger than the token cost.
- **Time to merge** — with ten PRs, the noise is larger than any effect. Report it, do not over-interpret it. The class page on [AI-assisted delivery](../../../classes/ai-delivery/index.md) discusses how DORA-style metrics should be read when AI enters the pipeline.
- **The free model** — if its recall on the golden set is much lower, its cost advantage is not real: a missed SQL injection is not cheaper. The local 7B model scored 50 % recall and was fooled by both injection cases while this lab was written (part 6).
- **Seconds and minutes** depend on your hardware: a laptop with a GPU or Apple silicon answers in seconds, a CPU-only runner in minutes. Compare times between your own runs, not with the numbers on these pages; the counts (findings, recall, mutants) are what should be comparable.

!!! tip "In the interview"

    *"How would you know whether AI code review is worth it?"* — Define precision (accepted ÷ rated comments) and recall on a golden set, track cost per PR and time to merge, run a baseline period, and decide per step with numbers. Mention that perceived productivity and measured productivity can disagree, so self-reports are not enough.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `no git remotes found` / `none of the git remotes ... point to a known GitHub host` | not run from your repository, or no GitHub remote | `cd` to the repository root; `gh repo set-default` |
| `0 PRs` | no PR created in the period (`--days`) | widen it: `--days 14` |
| `HTTP 403: API rate limit exceeded` | many PRs × many runs, each one an API call | wait an hour, or run with a smaller `--days` |
| `Precision: no rated comments yet` | nobody reacted with 👍/👎 | rate the comments (the reactions are on each inline comment) and run again |
| `CI min` much higher than expected | the Ollama path installs and downloads the model in every AI job | expected on the free path; compare it with a hosted model in your decision |

[Back to the lab overview](../index.md){ .md-button } [Take the quiz](../quiz.md){ .md-button .md-button--primary }

[^1]: BECKER, J. et al. [Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/){target="_blank"}. METR, July 2025.
