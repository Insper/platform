# 11. AI in CI/CD

!!! info "Goal"

    Add an AI-powered code review step to the platform's CI/CD pipeline. When a developer opens a pull request, a GitHub Actions workflow calls the Claude API to analyse the diff and posts a structured review comment — flagging security issues, missing tests, and architectural concerns automatically.

AI is not replacing engineers in software development — it is changing which tasks consume their attention. Code review is one of the highest-leverage places to introduce AI assistance: reviewers are scarce, turnaround times are long, and many issues (missing null checks, hardcoded secrets, REST endpoint convention violations) are mechanical enough for a model to catch reliably. This hands-on adds an automated AI reviewer to every pull request in the student project repository.

---

## 1. Architecture

The reviewer runs as a GitHub Actions job triggered on every pull request event. It fetches the diff, sends it to the Claude API, and posts the structured response as a PR comment before human reviewers arrive.

``` mermaid
sequenceDiagram
    autonumber
    actor Dev as Developer
    participant GH as GitHub
    participant GHA as GitHub Actions
    participant Claude as Claude API<br/>(claude-sonnet-4-6)
    participant PR as Pull Request

    Dev->>GH: git push + open PR
    GH->>+GHA: trigger: pull_request (opened, synchronize)
    GHA->>GH: GET /repos/.../pulls/{pr}/files (diff)
    GHA->>+Claude: POST /messages {diff, system_prompt}
    Claude-->>-GHA: review JSON {summary, issues[], suggestions[]}
    GHA->>-PR: POST comment with formatted review
```

The review runs as a non-blocking check — it never blocks the merge, but its output is visible in the PR timeline before human reviewers arrive.

---

## 2. Setup

### 2.1 API Key Secret

Add the Claude API key to the GitHub repository secrets:

1. Go to repository → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `ANTHROPIC_API_KEY`
4. Value: your API key from [console.anthropic.com](https://console.anthropic.com){target="_blank"}

!!! danger "Never commit the API key"

    The key must live in GitHub Secrets, never in `.github/workflows/*.yml` or any committed file. The Actions runner injects it as an environment variable at runtime.

### 2.2 Workflow File

Create `.github/workflows/ai-review.yml`:

``` { .yaml .copy }
name: AI Code Review

on:
  pull_request:
    types: [opened, synchronize]

permissions:
  pull-requests: write
  contents: read

jobs:
  ai-review:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install dependencies
        run: pip install anthropic PyGithub

      - name: Run AI review
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          REPO: ${{ github.repository }}
        run: python .github/scripts/ai_review.py
```

!!! tip "GITHUB_TOKEN is automatic"

    The `GITHUB_TOKEN` secret is injected automatically by GitHub Actions for every workflow run, scoped to the repository and the workflow's declared permissions. It has write access to pull-requests because we declared `permissions: pull-requests: write`. You do not create this secret manually.

---

## 3. The Review Script

Create `.github/scripts/ai_review.py`. The script fetches the PR diff, sends it to the Claude API, and posts the response as a PR comment.

``` { .python .copy linenums="1" }
import os
import anthropic
from github import Github

SYSTEM_PROMPT = """You are an expert code reviewer for a microservices platform course.
Analyse the git diff provided and produce a structured review.

Focus on:
1. Security issues (hardcoded secrets, SQL injection, missing auth)
2. Missing or inadequate error handling
3. REST API convention violations (wrong HTTP methods, missing status codes)
4. Obvious performance problems (N+1 queries, synchronous calls that should be async)
5. Missing input validation

Format your response as markdown with these sections:
## Summary
One paragraph overall assessment.

## Issues Found
Use severity labels: 🔴 Critical | 🟠 Warning | 🟡 Suggestion

## What looks good
Briefly note correct patterns you observed.

Keep the review concise (under 400 words). If the diff is trivial (docs, config only), say so briefly.
"""

def get_pr_diff(repo, pr_number: int) -> str:
    pr = repo.get_pull(pr_number)
    files = pr.get_files()
    diff_parts = []
    total_lines = 0
    for f in files:
        if total_lines > 3000:
            diff_parts.append("... (diff truncated — too large for single review)")
            break
        if f.patch:
            diff_parts.append(f"### {f.filename}\n```diff\n{f.patch}\n```")
            total_lines += f.patch.count('\n')
    return "\n\n".join(diff_parts) if diff_parts else "No code changes detected."

def post_review_comment(repo, pr_number: int, body: str) -> None:
    pr = repo.get_pull(pr_number)
    pr.create_issue_comment(
        f"## 🤖 AI Code Review\n\n{body}\n\n---\n"
        "*Powered by Claude · Non-blocking · For guidance only*"
    )

def main():
    gh = Github(os.environ["GITHUB_TOKEN"])
    repo = gh.get_repo(os.environ["REPO"])
    pr_number = int(os.environ["PR_NUMBER"])

    diff = get_pr_diff(repo, pr_number)

    client = anthropic.Anthropic()
    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[
            {"role": "user", "content": f"Please review this pull request diff:\n\n{diff}"}
        ]
    )

    review_text = message.content[0].text
    post_review_comment(repo, pr_number, review_text)
    print(f"Review posted to PR #{pr_number}")

if __name__ == "__main__":
    main()
```

Key design decisions in this script:

| Decision | Reason |
|---|---|
| **Diff truncated at 3 000 lines** | Prevents excessive API cost on very large PRs; the most important changes are usually near the top |
| **`max_tokens=1024`** | ~750 words — enough for a concise review without paying for verbosity |
| **Comment, not review** | PR reviews require approval state; issue comments are simpler and always allowed by `pull-requests: write` |
| **Non-blocking** | The workflow posts a comment but does not set a required status check, so the merge is never blocked |

---

## 4. Testing the Review

### 4.1 Create a Test PR

``` termynal
$ git checkout -b feature/add-order-endpoint
$ # make a change with a deliberate issue:
$ # e.g., hardcode a JWT secret in application.yaml
$ git add .
$ git commit -m "add order endpoint"
$ git push origin feature/add-order-endpoint
```

Open a pull request on GitHub. Within ~30 seconds the `AI Code Review` workflow fires.

### 4.2 What You Should See

The review appears as a PR comment from the Actions bot, structured like:

```
## 🤖 AI Code Review

## Summary
This PR adds an order creation endpoint. The logic is mostly correct,
but there is a critical security issue that must be resolved before merging.

## Issues Found
🔴 Critical — `application.yaml` contains a hardcoded JWT secret
(`jwt.secret: mysecretkey123`). Secrets must be injected via environment
variables or a secrets manager, never committed to source control.

🟡 Suggestion — `POST /orders` returns `200 OK` on success. REST convention
for resource creation is `201 Created` with a `Location` header pointing
to the new resource.

## What looks good
Input validation via `@Valid` is correctly applied to the request body.
The service layer is cleanly separated from the controller.
```

!!! tip "Calibrate the prompt"

    The system prompt in `ai_review.py` is the primary control surface for review quality. If the model misses issues specific to your codebase (e.g., Feign client patterns, Spring Boot anti-patterns), add them to the `Focus on:` list.

---

## 5. Extending the Reviewer

### 5.1 Target Only Java/YAML Files

Add a path filter so trivial changes (docs, images) don't trigger a review:

``` { .yaml .copy }
on:
  pull_request:
    types: [opened, synchronize]
    paths:
      - "**/*.java"
      - "**/*.yaml"
      - "**/*.yml"
      - "**/pom.xml"
      - "**/Dockerfile"
```

### 5.2 Add a Review Summary to the PR Description

Instead of (or in addition to) a comment, update the PR description with a brief AI summary:

``` { .python .copy }
repo.get_pull(pr_number).edit(body=summary)
```

### 5.3 Structured Output with JSON

Force the model to return a structured object by asking for JSON and parsing it:

``` { .python .copy }
SYSTEM_PROMPT_JSON = """... same instructions ...
Respond ONLY with valid JSON matching this schema:
{
  "summary": "string",
  "critical_issues": ["string"],
  "warnings": ["string"],
  "suggestions": ["string"],
  "score": 1-10
}"""
```

Then render the JSON as a formatted Markdown table in the PR comment.

### 5.4 Block Merge on Critical Issues

Parse the review for 🔴 Critical items and use the GitHub Checks API to block the merge until critical issues are resolved. This requires `checks: write` permission and creating a check run instead of a comment.

!!! warning "Use AI review as a guide, not a gate"

    Blocking merges on AI output can create false negatives (model flags safe code) or false positives (model misses real issues). Start with comments-only. Graduate to blocking only if the team validates the model's accuracy on your specific codebase first.

---

## 6. Other AI-in-Pipeline Patterns

Industry patterns that follow the same structure — trigger on a CI/CD event, call an LLM, act on the result:

| Pattern | What AI does | When to use |
|---|---|---|
| **PR code review** | Reviews diff, flags issues | Every PR — this hands-on |
| **Test generation** | Writes unit tests for changed functions | When coverage drops below threshold |
| **Commit message enforcement** | Rewrites or validates commit messages | Large teams with inconsistent commit hygiene |
| **Changelog generation** | Generates CHANGELOG.md from PR titles/commits | Before every release |
| **Anomaly detection in logs** | Detects unusual patterns post-deploy | After deployment completes |
| **Incident runbook lookup** | Given alert text, suggests diagnostic steps | On-call automation |
| **Documentation sync** | Detects code changes with outdated docs | When API signatures change |

All of these share the same architecture as this hands-on: a CI/CD trigger, a context-gathering step, an LLM call with a task-specific system prompt, and an action on the result.

---

## 7. Checklist

- [ ] `ANTHROPIC_API_KEY` secret added to GitHub repository settings
- [ ] `.github/workflows/ai-review.yml` created and committed
- [ ] `.github/scripts/ai_review.py` created and committed
- [ ] Test PR opened and AI review comment appears within 60 seconds
- [ ] Review is non-blocking (does not prevent merge)
- [ ] System prompt customised with platform-specific microservice patterns

[Next: Quiz](quiz.md){ .md-button .md-button--primary }
