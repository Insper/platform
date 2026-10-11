---
marp: true
lang: en
title: Hands-on 11 — AI in CI/CD
description: Platforms, Microservices, DevOps and APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Platforms, Microservices, DevOps and APIs · Hands-on 11</div>

# Hands-on 11 — AI in CI/CD

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

## The goal and the flow

When a developer opens a PR, a **GitHub Actions** job sends the diff to the **Claude API** and posts a structured review as a **PR comment**.

1. Developer pushes and opens a PR.
2. GitHub triggers the workflow on `pull_request` (`opened`, `synchronize`).
3. The job fetches the diff: `GET /repos/.../pulls/{pr}/files`.
4. It calls Claude (`claude-sonnet-4-6`) with the diff and a **system prompt**.
5. It posts the review as a comment on the PR.

<div class="ok">

**Non-blocking**: the review never blocks the merge — it just shows up in the PR timeline.

</div>

---

## Step 1 — The API key secret

Repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

- Name: `ANTHROPIC_API_KEY`
- Value: your key from `console.anthropic.com`
- The runner injects it as an **environment variable** at runtime.
- `GITHUB_TOKEN` is **automatic** — created per run, scoped by the workflow's `permissions`.

<div class="warn">

**Never commit the API key** — not in `.github/workflows/*.yml`, not in any file. Only in GitHub Secrets.

</div>

---

## Step 2 — Workflow: trigger and permissions

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

## Step 2 — Workflow: the job

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

## Step 3 — The system prompt

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

## Step 3 — Diff in, comment out

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

## Design decisions

| Decision | Reason |
|---|---|
| Diff truncated at **3 000 lines** | caps API cost on huge PRs; important changes are usually near the top |
| `max_tokens=1024` | ~750 words — a concise review, no paying for verbosity |
| **Comment**, not review | PR reviews need an approval state; comments are always allowed by `pull-requests: write` |
| **Non-blocking** | no required status check → the merge is never blocked |

---

## Step 4 — Test it with a deliberate issue

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

## What you should see

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

---

## Extending the reviewer

| Extension | How |
|---|---|
| Review only code | `paths:` filter — `**/*.java`, `**/*.yaml`, `**/*.yml`, `**/pom.xml`, `**/Dockerfile` |
| Summary in the PR description | `repo.get_pull(pr_number).edit(body=summary)` |
| Structured output | ask for **JSON only**: `summary`, `critical_issues`, `warnings`, `suggestions`, `score` → render as a table |
| Block on 🔴 Critical | GitHub **Checks API**, `checks: write`, a check run instead of a comment |
| Codebase-specific issues | add them (Feign clients, Spring Boot anti-patterns) to the `Focus on:` list |

---

## A guide, not a gate

<div class="warn">

Blocking merges on AI output means trusting its mistakes: it can **flag safe code** or **miss real issues**.

</div>

- Start with **comments only**.
- Move to blocking only after the team has **validated the model's accuracy** on its own codebase.
- **Never** put the API key in a committed file.
- Keep the diff and the answer **bounded** (3 000 lines, `max_tokens`) — every PR is an API call that costs money.

---

## The same shape, other tasks

**CI/CD trigger → gather context → LLM call with a task-specific prompt → act on the result**

| Pattern | What AI does | When |
|---|---|---|
| PR code review | reviews diff, flags issues | every PR — this hands-on |
| Test generation | writes unit tests for changed functions | coverage drops below threshold |
| Changelog generation | `CHANGELOG.md` from PR titles/commits | before every release |
| Anomaly detection in logs | spots unusual patterns | after a deployment |
| Incident runbook lookup | suggests diagnostic steps from alert text | on-call automation |
| Documentation sync | detects code changes with outdated docs | API signatures change |

---

## Takeaways

1. Code review is a high-leverage first use of AI: scarce reviewers, many **mechanical** issues.
2. Flow: `pull_request` event → fetch diff → **Claude API** with a system prompt → **PR comment**.
3. `ANTHROPIC_API_KEY` lives in **GitHub Secrets**; `GITHUB_TOKEN` is automatic, scoped by `permissions`.
4. The **system prompt** is the main control surface — tune its `Focus on:` list to your codebase.
5. Bound the cost: truncate the diff (**3 000 lines**) and cap `max_tokens` (**1024**).
6. Keep it **non-blocking** until the model's accuracy is validated — a guide, not a gate.
7. The same trigger → context → LLM → action shape fits tests, changelogs, logs and docs.
