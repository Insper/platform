---
marp: true
lang: en
title: Hands-on 12 — AI in CI/CD
description: Platforms, Microservices, DevOps and APIs · Insper
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

<div class="kicker">Platforms, Microservices, DevOps and APIs · Hands-on 12</div>

# Hands-on 12 — AI in CI/CD

**An AI reviewer on every pull request — a guide, not a gate**

<!--
Outline: (1) why code review; (2) architecture of the workflow; (3) secret + workflow file;
(4) the review script; (5) testing with a deliberate issue; (6) extensions and other AI-in-pipeline patterns.
-->

---

## Why start with code review?

<div class="q">

AI is not replacing engineers — it changes **which tasks** take their attention.
Where in the pipeline does an AI assistant pay off first?

</div>

* **Reviewers are scarce** and turnaround times are long.
* Many issues are **mechanical**: missing null checks, hardcoded secrets, REST convention violations.
* A model catches those **before** the human reviewer arrives — the human focuses on design.

<!--
Ask which review comments they write over and over. Those are the candidates for automation.
-->

---

## 1 · Architecture: the flow

When a developer opens a PR, a **GitHub Actions** job sends the diff to the **Claude API** and posts a structured review as a **PR comment**.

<div class="flow">
<div class="box">git push<small>open the PR</small></div><div class="arrow">→</div>
<div class="box">pull_request<small>opened · synchronize</small></div><div class="arrow">→</div>
<div class="box accent">job ai-review<small>GET /repos/.../pulls/{pr}/files</small></div><div class="arrow">→</div>
<div class="box orange">Claude API<small>claude-sonnet-4-6 · diff + system prompt</small></div><div class="arrow">→</div>
<div class="box green">PR comment<small>the review, in the timeline</small></div>
</div>

<div class="ok">

**Non-blocking**: the review never blocks the merge — it just shows up in the PR timeline.

</div>

---

## 2.1 · The API key secret

Repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

- Name: `ANTHROPIC_API_KEY`
- Value: your key from `console.anthropic.com`
- The runner injects it as an **environment variable** at runtime.
- `GITHUB_TOKEN` is **automatic** — created per run, scoped by the workflow's `permissions`.

<div class="warn">

**Never commit the API key** — not in `.github/workflows/*.yml`, not in any file. Only in GitHub Secrets.

</div>

---

## 2.2 · Workflow: trigger and permissions

`.github/workflows/ai-review.yml`

```yaml
name: AI Code Review

on:
  pull_request:
    types: [opened, synchronize]

permissions:
  pull-requests: write   # post the comment
  contents: read
```

<p class="small"><code>pull-requests: write</code> is what lets <code>GITHUB_TOKEN</code> comment on the PR.</p>

---

## 2.2 · Workflow: the job

```yaml
jobs:
  ai-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4         # fetch-depth: 0
      - uses: actions/setup-python@v5     # python-version: "3.12"
      - run: pip install anthropic PyGithub
      - name: Run AI review
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          REPO: ${{ github.repository }}
        run: python .github/scripts/ai_review.py
```

---

## 3 · The review script: system prompt

The **system prompt** in `.github/scripts/ai_review.py` is the main control surface for review quality.

<div class="cols">
<div>

### Focus on

1. Security (secrets, SQL injection, missing auth)
2. Error handling
3. REST conventions
4. Performance (N+1, sync calls that should be async)
5. Input validation

</div>
<div>

### Answer format

- `## Summary` — one paragraph
- `## Issues Found` — 🔴 Critical · 🟠 Warning · 🟡 Suggestion
- `## What looks good`
- Under **400 words**; trivial diffs → say so briefly

</div>
</div>

---

## 3 · Diff in, comment out

```python
diff = get_pr_diff(repo, pr_number)   # concatenates f.patch, stops after 3000 lines

client = anthropic.Anthropic()        # reads ANTHROPIC_API_KEY
message = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    system=SYSTEM_PROMPT,
    messages=[{"role": "user",
               "content": f"Please review this pull request diff:\n\n{diff}"}],
)
post_review_comment(repo, pr_number, message.content[0].text)
```

<p class="small"><code>post_review_comment</code> calls PyGithub's <code>pr.create_issue_comment(...)</code> with an "🤖 AI Code Review" header.</p>

---

## 3 · Design decisions

| Decision | Reason |
|---|---|
| Diff truncated at **3 000 lines** | caps API cost on huge PRs; important changes are usually near the top |
| `max_tokens=1024` | ~750 words — a concise review, no paying for verbosity |
| **Comment**, not review | PR reviews need an approval state; comments are always allowed by `pull-requests: write` |
| **Non-blocking** | no required status check → the merge is never blocked |

---

## 3 · The 3 000-line cut

A large PR, file by file, as `get_pr_diff` adds them:

<div class="flow">
<div class="box green">ProductMapper.java<small>+1800 · sent · 1 799 lines so far</small></div><div class="arrow">→</div>
<div class="box green">ProductService.java<small>+1400 · sent · 3 198 lines, past 3 000</small></div><div class="arrow">✂</div>
<div class="box red">application.yaml<small>+6 · never sent: its hardcoded password is never reviewed</small></div>
</div>

- The loop stops **before the next file** once more than 3 000 lines are in.
- Cheaper and faster, but the model cannot flag what it never saw: a **false negative**.

<!--
The page draws the same loop as a step-by-step diagram under the design decisions; the simulator's "large PR" plays it.
-->

---

## 4 · Test it with a deliberate issue

```bash
git checkout -b feature/add-order-endpoint
# make a change with a deliberate issue,
# e.g. hardcode a JWT secret in application.yaml
git add .
git commit -m "add order endpoint"
git push origin feature/add-order-endpoint
```

- Open the PR on GitHub → within **~30 s** the `AI Code Review` workflow fires.
- The review appears as a comment from the **Actions bot**.

---

## 4 · What you should see

```text
## 🤖 AI Code Review

## Summary
This PR adds an order creation endpoint. ... a critical security issue ...

## Issues Found
🔴 Critical — `application.yaml` contains a hardcoded JWT secret
(`jwt.secret: mysecretkey123`). Secrets must be injected via env vars ...
🟡 Suggestion — `POST /orders` returns `200 OK`; resource creation is
`201 Created` with a `Location` header.

## What looks good
Input validation via `@Valid` is correctly applied to the request body.
```

<p class="small">Calibrate the prompt: if the model misses issues specific to your codebase (Feign clients, Spring Boot anti-patterns), add them to the <code>Focus on:</code> list.</p>

---

## 5 · Extending the reviewer

| Extension | How |
|---|---|
| Review only code | `paths:` filter — `**/*.java`, `**/*.yaml`, `**/*.yml`, `**/pom.xml`, `**/Dockerfile` |
| Summary in the PR description | `repo.get_pull(pr_number).edit(body=summary)` |
| Structured output | ask for **JSON only**: `summary`, `critical_issues`, `warnings`, `suggestions`, `score` → render as a table |
| Block on 🔴 Critical | GitHub **Checks API**, `checks: write`, a check run instead of a comment |

---

## 5 · A guide, not a gate

<div class="warn">

Blocking merges on AI output means trusting its mistakes: it can **flag safe code** or **miss real issues**.

</div>

- Start with **comments only**.
- Move to blocking only after the team has **validated the model's accuracy** on its own codebase.
- **Never** put the API key in a committed file.
- Keep the diff and the answer **bounded** (3 000 lines, `max_tokens`) — every PR is an API call that costs money.

---

## 5 · What the gate changes

<div class="matrix" style="--n: 2">
<div></div><div class="head">comment (this hands-on)</div><div class="head">required check (5.4)</div>
<div class="row">real 🔴 found</div><div class="box orange">merge allowed: someone must read it</div><div class="box green">blocked until the fix</div>
<div class="row">false positive</div><div class="box green">a comment to ignore</div><div class="box red">a safe PR is blocked</div>
<div class="row">false negative</div><div class="box red">merged unnoticed</div><div class="box red">merged unnoticed: the check passes</div>
<div class="row">the job fails</div><div class="box green">merge allowed, a red ✗</div><div class="box red">nobody merges until it passes</div>
<div class="row">paths filter skips it</div><div class="box green">no check, merge allowed</div><div class="box red">check stuck: “Expected — Waiting for status”</div>
</div>

<!--
False positive: a fake secret in a test resource. False negative: the issue sits after the 3 000-line cut. The job fails: no ANTHROPIC_API_KEY secret, or the API stays overloaded (529). The page has the same table with markers.
-->

---

<!-- _class: tight -->

## 6 · The same shape, other tasks

**CI/CD trigger → gather context → LLM call with a task-specific prompt → act on the result**

| Pattern | What AI does | When |
|---|---|---|
| PR code review | reviews diff, flags issues | every PR — this hands-on |
| Test generation | writes unit tests for changed functions | coverage drops below threshold |
| Commit message enforcement | rewrites or validates commit messages | large teams, inconsistent commit hygiene |
| Changelog generation | `CHANGELOG.md` from PR titles/commits | before every release |
| Anomaly detection in logs | spots unusual patterns | after a deployment |
| Incident runbook lookup | suggests diagnostic steps from alert text | on-call automation |
| Documentation sync | detects code changes with outdated docs | API signatures change |

---

## Without a repository: the simulator

<div class="flow">
<div class="box accent">4 · 5.1<small>1 🔴 + 1 🟡, merge allowed · edited runs nothing · paths skips the README</small></div>
<div class="box orange">5.4 gate<small>blocked, fixed, false positive, false negative, waiting forever</small></div>
<div class="box red">failures<small>no secret: exit code 1 · 529 retried · 529 that persists</small></div>
</div>

- The page embeds the lab's workflow and script: same triggers, same steps, same 3 000-line cut.
- Play replays a section; open a PR, push, edit or re-run at any time.
- Switch the mode to **required check** to see what a gate changes.

<!--
Embedded twice: at the end of section 4 (opening on 4 · 5.1) and under the 5.4 table (opening on 5.4 gate).
-->

---

## Takeaways

1. Code review is a high-leverage first use of AI: scarce reviewers, many **mechanical** issues.
2. Flow: `pull_request` event → fetch diff → **Claude API** with a system prompt → **PR comment**.
3. `ANTHROPIC_API_KEY` lives in **GitHub Secrets**; `GITHUB_TOKEN` is automatic, scoped by `permissions`.
4. The **system prompt** is the main control surface — tune its `Focus on:` list to your codebase.
5. Bound the cost: truncate the diff (**3 000 lines**) and cap `max_tokens` (**1024**).
6. Keep it **non-blocking** until the model's accuracy is validated — a guide, not a gate.
7. The same trigger → context → LLM → action shape fits tests, changelogs, logs and docs.
