The first AI step is the one with the best cost/benefit ratio: a reviewer that reads every pull request **before** a human does, and leaves a few precise, inline comments — or nothing. Human reviewers are scarce and slow (a PR often waits hours for the first look); a model is fast, cheap per PR and never bored by the hundredth null check. It is also often wrong, verbose and gullible. This part builds a reviewer that is useful *despite* those weaknesses.

## 1.1 How it works

``` diagram-sim
sequenceDiagram
    autonumber
    actor Dev as Developer
    participant GH as GitHub
    participant Job as ai-review job
    participant LLM as Model (Claude / LiteLLM / Ollama)
    Dev->>GH: push to a PR branch
    GH->>Job: pull_request (synchronize)
    Job->>Job: git diff base...head, number new-side lines
    Job->>Job: load CONVENTIONS.md + ADRs (cached system prompt)
    Job->>LLM: system + untrusted PR title, body, diff
    LLM-->>Job: JSON {summary, findings[]}
    Job->>Job: keep added lines, ≥ minor, not low confidence, not posted before, max 6
    Job->>GH: one review with inline comments (event COMMENT)
    Job->>GH: update the sticky summary comment (cost per run)
    Job->>GH: job summary: tokens, US$, kept and dropped findings
```

Four ideas carry the design; the [Code review](../../../classes/ai-delivery/code-review/index.md) page of the class explains them in depth:

1. **Context engineering.** The model receives the diff *and* what a senior BoxOffice engineer knows: the conventions and the ADRs. Without them it can only give generic advice.
2. **Structured output.** The answer is JSON with `file`, `line`, `severity`, `category`, `confidence`, `title`, `explanation`, `suggestion` — so code can filter it, deduplicate it and post it exactly where it belongs.
3. **Noise control.** Every comment costs a developer's attention. Comments outside the changed lines, below `minor`, with low confidence, already posted, or over the limit are **dropped** (and listed in the job summary, so you can tune the thresholds).
4. **Advisory, not a gate.** The bot posts `event: COMMENT` — never `APPROVE` or `REQUEST_CHANGES`. An optional gate mode exists, but you turn it on only after measuring precision in part 7.

## 1.2 The diff helpers

Models are bad at counting lines. Rather than asking the model to compute line numbers from the `@@ -16,4 +16,9 @@` headers, `diffutil.py` prints **every new-side line with its number** (`L21 + ...`) and later checks that each finding points to a line the PR actually **added**. GitHub rejects a review comment on a line that is not part of the diff, so this check also prevents a failed API call.

``` { .python title=".github/ai/diffutil.py" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/13/code/.github/ai/diffutil.py"
```

This is what the model sees for a small PR — note that removed lines have no number and only `+` lines can receive a comment:

```text
### services/catalog/src/main/java/boxoffice/catalog/EventRepository.java
@@ -16,4 +16,9 @@ public class EventRepository {
L16         public List<Event> findAll() {
L17             return jdbc.query("select id, name, starts_at from catalog.event", Event.MAPPER);
L18         }
L19   +
L20   +     public List<Event> search(String text) {
L21   +         return jdbc.query("select id, name, starts_at from catalog.event where name ilike '%"
L22   +                 + text + "%'", Event.MAPPER);
L23   +     }
L24     }
```

## 1.3 The reviewer

``` { .python title=".github/ai/review.py" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/13/code/.github/ai/review.py"
```

Read it with these questions in mind:

| Where | What it does | Why |
|---|---|---|
| `INSTRUCTIONS` | Says what to look for, what **not** to comment on, and that an empty list is a good review | Without "no praise, no nits" a model fills the page; the empty-list permission is the single best noise reducer |
| `<untrusted_…>` tags | Wraps title, description and diff | Marks author-written text as **data**, and tells the model to report text addressed to it as a possible prompt injection (part 6) |
| `review()` filters | Added lines · minimum severity · no low confidence · max comments | Precision over recall: one ignored comment teaches people to ignore the bot |
| `fingerprint()` | Hash of file + category + normalised title, hidden in the comment | The next push does not repost the same finding |
| `post()` | One review with all inline comments + one **sticky** summary comment, edited in place | One notification per push instead of ten; the sticky comment keeps the cost of every run for part 7 |
| `except LLMError` | Writes the error to the summary and exits 0 | **Fail open**: an outage of the model provider must not block every merge |
| `GATE` | Exits 1 on a high-confidence blocker if `AI_REVIEW_GATE=true` | The gate exists, but is off by default |

## 1.4 The workflow

``` { .yaml title=".github/workflows/ai-review.yaml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/13/code/.github/workflows/ai-review.yaml"
```

| Line | Why |
|---|---|
| `permissions:` | `contents: read` to check out, `pull-requests: write` to comment. Nothing else: no `actions`, no `packages`, no `id-token` |
| `concurrency` with `cancel-in-progress` | Three quick pushes → one review of the last one, not three reviews and three bills |
| `if: !draft && head.repo == repository` | Drafts are not ready; fork PRs on `pull_request` get no secrets anyway (part 6) |
| `timeout-minutes` from an expression | A local model on a CPU runner gets 25 minutes; a hosted model 10. A hung call cannot burn an hour |
| `persist-credentials: false` | The token is not left in `.git/config` for later steps to find |
| Actions pinned to a commit SHA | A moved tag cannot swap the code you run (part 6) |
| `uses: ./.github/actions/ollama` | Only when `LLM_PROVIDER` is `ollama` (or unset): installs the free model on the runner |
| `vars.*` with defaults | Switch provider, model or thresholds with a repository variable, no code change |
| PR title and body read from the event file | Never `${{ github.event.pull_request.title }}` inside `run:` — that is a shell injection (part 6) |

Commit everything of part 0 and this workflow **on `main`** and push — a `pull_request` workflow runs from the merge of your PR into `main`, so it must be there first:

``` { .bash .copy }
git switch main
git add .github/ai .github/actions .github/workflows/ai-review.yaml CONVENTIONS.md docs/adr
git commit -m "ci(ai): AI pull-request reviewer (lab 13)"
git push
```

## 1.5 Try it: locally first, then on a pull request

Create a branch with a **deliberate** problem — a search that builds SQL by concatenating user input (a SQL injection, forbidden by `CONVENTIONS.md`). It compiles and its tests pass, so only a review can catch it:

``` { .bash .copy }
git switch -c try-ai-review
```

``` { .java title="services/catalog/src/main/java/boxoffice/catalog/EventSearch.java" .copy }
package boxoffice.catalog;

import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Search events by title. Lab 13: this file has a DELIBERATE bug for the AI reviewer. */
@Repository
public class EventSearch {

    private final JdbcClient jdbc;

    public EventSearch(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public List<String> titlesLike(String text) {
        return jdbc.sql("select title from catalog.events where title ilike '%" + text + "%'")
                .query(String.class)
                .list();
    }
}
```

Commit it and run the reviewer **on your machine** against the branch's diff, without posting anything (`--dry-run`). The report goes to the terminal:

``` { .bash .copy }
git add services/catalog/src/main/java/boxoffice/catalog/EventSearch.java
git commit -m "catalog: search events by title"
git diff main...try-ai-review > /tmp/pr.diff
uv run --no-project --python 3.12 --with-requirements .github/ai/requirements.txt \
  python .github/ai/review.py --diff /tmp/pr.diff --title "catalog: search events by title" --dry-run
```

You should see something like this (a run with the local `qwen2.5-coder-16k` on a laptop; the wording, the line and the time vary from run to run):

```text
### AI review

The pull request introduces a SQL query that is vulnerable to SQL injection.

| Model | Calls | Input | Cache read | Cache write | Output | Time | Cost |
|---|---|---|---|---|---|---|---|
| `qwen2.5-coder-16k` | 1 | 1,479 | 0 | 0 | 179 | 10.7 s | n/a (local or unknown model) |


Findings: 1 kept, 1 new, 0 dropped.

| Severity | Confidence | Where | Title |
|---|---|---|---|
| blocker | high | `services/catalog/src/main/java/boxoffice/catalog/EventSearch.java:18` | SQL Injection Vulnerability |
```

What matters: **one** finding, on an **added** line of `EventSearch.java`, category `security`, severity `major` or `blocker`. With Claude the cost column shows US$ instead of `n/a`.

Now the real thing — push the branch and open the PR:

``` { .bash .copy }
git push -u origin try-ai-review
gh pr create --fill --base main
gh pr checks --watch              # waits for "AI review" (5-15 min on the free runner model)
```

## 1.6 What you should see

On the PR, when the `AI review` check finishes (about a minute with Claude; 5–15 minutes with the free model on the runner, most of it installing Ollama and downloading the model): **one review** with inline comments on the exact lines, and **one sticky comment** `AI review summary` with the cost of each run. An inline comment looks like this (the text the local model wrote for the run above):

```text
🛑 SQL Injection Vulnerability · `blocker` · security · confidence high

The SQL query uses string concatenation to include user input (`text`) in the query, which makes
it vulnerable to SQL injection attacks.

Suggestion: Use parameterized queries to prevent SQL injection. Replace the line with:
`return jdbc.sql("select title from catalog.events where title ilike ?") .bind(0, text) .query(String.class) .list();`

AI review: react 👍 if useful, 👎 if not. Advisory only.
```

Right problem, right line — and a suggestion that **does not compile**: `JdbcClient` has no `bind` method (it is `.param(...)`), and the `%` wildcards are gone. A reviewer's suggestion is a hint for a human, never a patch to apply blindly.

Check it from the terminal too: `gh pr view --comments` shows the sticky comment, and `gh api "repos/{owner}/{repo}/pulls/$(gh pr view --json number -q .number)/comments" --jq '.[].path'` lists the files that received inline comments.

In the **job summary** (Actions → the run → Summary), the same report as your local run: the findings table, the dropped findings and the cost table. With the local model the cost column says `n/a`: you pay in runner minutes instead. For comparison, one run of the five-case golden set of part 6 with `claude-opus-5-5` while this lab was written cost about **US$ 0.012 per review**, with most of the system prompt served from the cache after the first call — your numbers will differ with the size of your diffs and conventions:

| Model | Calls | Input | Cache read | Cache write | Output | Time | Cost |
|---|---|---|---|---|---|---|---|
| `claude-opus-5-5` | 5 | 1,909 | 6,444 | 1,611 | 2,067 | 35.0 s | US$ 0.0583 |

Push a second commit that does not touch the problem:

``` { .bash .copy }
git commit --allow-empty -m "chore: run the reviewer again" && git push
```

The reviewer runs again, finds the same issue, recognises the fingerprint and posts **nothing new** — only the sticky comment gains a cost line (`Runs on this PR: 2`). A small local model may word the title differently on each run; then the fingerprint changes and the comment is posted twice — one more reason to measure noise in part 7.

Keep this PR open: part 7 counts it. Do not merge `EventSearch.java` — close the PR when you finish the lab.

## 1.7 Tune it

Change one knob at a time, on the same PR, and compare the job summaries:

| Knob | Where | Effect to observe |
|---|---|---|
| `AI_REVIEW_MIN_SEVERITY` (`minor`) | repository variable | `major` → fewer, more important comments |
| `AI_REVIEW_MAX_COMMENTS` (`6`) | repository variable | Hard cap on noise per push |
| `AI_REVIEW_MAX_DIFF_LINES` (`1500`) | repository variable | Big PRs: files over the budget are listed as *not reviewed* — honest, not silently truncated |
| `LLM_MODEL` | repository variable | Quality vs cost: compare in part 7 |
| `CONVENTIONS.md` | repository | Add a rule, open a PR that breaks it, see it cited |
| `AI_REVIEW_GATE=true` | repository variable | The job fails on a high-confidence blocker. Make it a required check **only** after part 7 shows high precision |

!!! warning "Common pitfalls"

    - **Reviewing everything, including generated files and lockfiles**: tokens and noise for nothing. `diffutil.SKIP` and `paths-ignore` exist for that.
    - **Posting each finding as a separate issue comment**: ten notifications per push. One review with inline comments, one sticky summary.
    - **Treating silence as approval**: "the bot found nothing" means *the bot found nothing*. Human review stays required by branch protection.
    - **Putting the conventions in the workflow file**: they belong in the repository, versioned, reviewed, and read by humans too.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No `AI review` check on the PR | the PR is a draft, comes from a fork, or changes only `*.md`/`docs/**` (`paths-ignore`); or the workflow is not on `main` | `gh pr ready`; push the branch to your repository, not a fork; commit the workflow on `main` first (step 1.4) |
| Job summary says `AI review skipped` | the model call failed (no key, Ollama not up, timeout) — the job **fails open** on purpose | read the error line; check the variables with `gh variable list` and the secrets with `gh secret list` |
| `HTTP 422 ... pull_request_review_thread.line ... could not be resolved` | the PR changed while the job ran, so the line is no longer in the diff | re-run the job (`gh run rerun <id>`), or push again |
| All findings dropped as `not an added line` | the model returned line numbers that are not `+` lines (small models do this more) | normal noise control; if it happens on every PR, try a bigger model and compare in part 7 |
| The same comment is posted on every push | the model words the title differently, so the fingerprint changes | raise the model quality, or tune the fingerprint to use `file + line + category` |
| Local run: `fatal: ambiguous argument 'main...try-ai-review'` | your default branch has another name, or the branch has no commit | `git branch` to see the names; commit `EventSearch.java` first |

[Next: part 2 — AI tests](../tests/index.md){ .md-button .md-button--primary }
