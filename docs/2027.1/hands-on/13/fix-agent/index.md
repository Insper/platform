The reviewer of part 1 makes **one** model call and posts text. An **agent** is different: it runs a loop — read a file, edit, run the build, read the error, edit again — choosing its own next step until the task is done or a budget runs out (see [Agents & tools](../../../classes/ai-systems/agents/index.md)). That makes it far more capable, and far more dangerous: it executes commands, writes code and costs more with every step. This part builds an agent that reacts to a **failed CI run** by proposing a fix as a **draft pull request** — and spends most of its lines on keeping that agent in a box.

## 3.1 The flow and its trust boundaries

``` mermaid-sim
sequenceDiagram
    autonumber
    participant CI as CI workflow (lab 11)
    participant Fix as job "fix"<br/>contents: read, actions: read
    participant Agent as Agent<br/>(Claude Code or fix_agent.py)
    participant Open as job "open-pr"<br/>contents: write, pull-requests: write
    actor Human as Reviewer
    CI-->>Fix: workflow_run completed (failure)
    Fix->>Fix: dedupe: branch ai-fix/<sha> exists? stop
    Fix->>Fix: gh run view --log-failed | tail -300
    Fix->>Agent: log + repository (no GitHub token)
    Agent->>Agent: read · edit · mvn verify (≤ 25 turns, ≤ US$ 1.50)
    Agent-->>Fix: working-tree changes
    Fix->>Fix: verify: only src/, no test removed, mvn verify passes
    Fix->>Open: artifact ai-fix.patch (+ transcript)
    Open->>Open: apply patch, commit with AI trailer, push ai-fix/<sha>
    Open->>Human: draft PR, label ai-generated
    Human->>Human: review, run CI, merge or close
```

Three separations do the security work:

| Separation | What it prevents |
|---|---|
| **The agent never holds a GitHub token.** Only `ANTHROPIC_API_KEY` (or the LiteLLM key) is in its environment | A confused or injected agent cannot push, comment, approve or read other repositories |
| **Verification is not done by the agent.** A plain shell step re-runs `mvn verify`, rejects files outside `services/<name>/src/`, and rejects removed `@Test` or added `@Disabled` | "I fixed the build" is checked, not believed; the classic shortcut — deleting the failing test — is caught |
| **Only `open-pr` can write**, and it runs no model and no build: it applies a patch | Write access is held by ten lines of deterministic shell |

And a human merges. Nothing in this workflow can reach `main` without a review that branch protection requires.

## 3.2 Path A — Claude Code, headless (paid)

[Claude Code](https://code.claude.com/docs/en/headless){target="_blank"} can run non-interactively with `claude -p`. The flags used here, from its CLI reference:

| Flag | Role in this lab |
|---|---|
| `--bare` | Skip auto-discovery of hooks, skills, plugins, MCP servers and `CLAUDE.md` from the repository — the agent loads **only** what the command line gives it, the same on every runner |
| `--allowedTools "Read,Edit,Write,Bash(mvn -B *)"` | Tools that run without asking; the shell is limited to commands starting with `mvn -B` |
| `--permission-mode dontAsk` | Anything not allowed is **denied**, not prompted (nobody can answer a prompt in CI) |
| `--max-turns 25` | Cap on agentic turns |
| `--max-budget-usd 1.50` | Stops the run when the estimated spend reaches the cap (a client-side estimate — leave headroom) |
| `--output-format stream-json --verbose` | One JSON event per line: the full transcript, kept as the **audit log**; the last line is the result with `total_cost_usd` |
| `--model` | The model, from the `LLM_MODEL` variable |

The failed log arrives on **stdin**, so the agent does not need permission to read files outside the repository.

Path A runs only when the repository variable `LLM_PROVIDER` is `anthropic`, and it needs the secret `ANTHROPIC_API_KEY`: **every run is billed**, capped at US$ 1.50 by `--max-budget-usd`. The workflow installs a **pinned** Claude Code version (`@anthropic-ai/claude-code@2.1.302`); update it on purpose, like any other dependency. Without a key, skip to path B — it is the default.

!!! info "The Claude Code GitHub Action"

    Anthropic also publishes [`anthropics/claude-code-action@v1`](https://github.com/anthropics/claude-code-action){target="_blank"}, which wraps the same engine for GitHub: `@claude` mentions in PRs and issues, or automation with a `prompt` input, and CLI flags through `claude_args` (for example `--max-turns 5 --model ...`). It is the quickest way to get an on-demand assistant on PRs. This lab calls the CLI directly because we want the **patch-artifact split** above, where the job running the agent has no write token; check the action's [security documentation](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md){target="_blank"} if you use it for writes.

## 3.3 Path B — a provider-neutral agent in under 200 lines (free with Ollama)

To see that an agent is "just a loop", `fix_agent.py` implements one over any OpenAI-compatible endpoint with tool calling (LiteLLM, or Ollama with a model that supports tools). It has five tools — `list_files`, `read_file`, `write_file`, `run_build`, `finish` — and **no shell**.

``` { .python title=".github/ai/fix_agent.py" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/13/code/.github/ai/fix_agent.py"
```

| Guard | Where |
|---|---|
| Paths resolved and kept inside the repository; `.git/` and `.github/` unreachable | `safe()` |
| Writes only under `services/<name>/src/` | `safe(..., write=True)` |
| The build runs with an environment **without** `KEY`, `TOKEN`, `SECRET` variables | `run_build()` |
| Tool errors go back to the model as text, never crash the loop | `call_tool()` + `except` |
| Budget: steps, tokens and dollars | `MAX_STEPS`, `MAX_TOKENS`, `MAX_USD` |
| Every tool call appended to `agent-audit.jsonl` (outside the repository) | `AUDIT` |
| A tool call written as JSON **text** (small local models do this) is accepted as a call, never executed as code | `text_tool_call()` |
| `run_build("catalog")` is read as `services/catalog`; a missing `pom.xml` is an error message, not a crash | `run_build()` |

## 3.4 The workflow

``` { .yaml title=".github/workflows/ai-fix.yaml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/13/code/.github/workflows/ai-fix.yaml"
```

| Detail | Why |
|---|---|
| `on: workflow_run` | Runs **after** CI finishes, with the workflow definition from the default branch |
| `head_repository.full_name == github.repository` | `workflow_run` runs with this repository's secrets even when the CI run came from a fork; checking out and building fork code here would be a *pwn request* (part 6) |
| `!startsWith(head_branch, 'ai-fix/')` | The agent's own branches never trigger another agent: no loops |
| `concurrency` on the head SHA + branch `ai-fix/<sha8>` check | **Idempotent**: one proposal per failing commit, even if the run is re-run |
| `if-no-files-found: ignore` + `always()` | The transcript is uploaded even when the agent fails — that is when you need it |
| `--trailer "AI-assisted: ..."` | The commit says it was AI-generated, and with which model |
| `vars.LLM_PROVIDER == 'anthropic'` → path A, otherwise path B | One variable switches the agent; with no variable set, path B runs with Ollama **on the runner** (free, but a CPU runner needs many minutes for 20 steps — the local run of 3.5 is much faster) |

!!! warning "Two GitHub settings to know"

    1. The `GITHUB_TOKEN` may create pull requests only if **Allow GitHub Actions to create and approve pull requests** is enabled — step 0.4 of the [setup](../index.md#repository-settings) did it. This lab never approves.
    2. Events caused by the `GITHUB_TOKEN` (the push of `ai-fix/...`, the PR it opens) **do not trigger other workflows**, so CI does not run on the draft PR by itself. That is a GitHub safeguard against loops. To run CI on it, push an empty commit from your machine: `gh pr checkout <number of the draft PR>`, then `git commit --allow-empty -m "ci: run CI on the AI fix" && git push` (or use a GitHub App token if your team automates this).

## 3.5 Break the build on purpose

Commit the agent and its workflow on `main` first (`workflow_run` workflows run only from the default branch):

``` { .bash .copy }
git switch main && git pull
git add .github/ai/fix_agent.py .github/workflows/ai-fix.yaml
git commit -m "ci(ai): fix agent for failed CI runs (lab 13)"
git push
```

Now a **realistic** bug that a unit test catches: in `deleteEvent` of `CatalogService`, someone "simplifies" the existence check and drops the `!`:

``` { .bash .copy }
git switch -c break-catalog
```

``` { .diff title="services/catalog/src/main/java/boxoffice/catalog/CatalogService.java" }
     public void deleteEvent(Long id) {
-        if (!events.existsById(id)) {
+        if (events.existsById(id)) {
             throw notFound("event", id);
         }
```

``` { .bash .copy }
git commit -am "catalog: simplify deleteEvent"
```

**Locally first** (free, and minutes instead of tens of minutes). Reproduce what CI will see, give the log to the agent, and look at what it changed. Docker must be running: `mvn verify` — yours, the agent's `run_build` and the verification step in CI — also runs the Testcontainers test `CatalogApiTest` of lab 11:

``` { .bash .copy }
mvn -B -f services/catalog/pom.xml verify > /tmp/ci-full.log 2>&1; tail -n 300 /tmp/ci-full.log > /tmp/ci-failure.log
grep -E "Tests run: .*(Failures: [1-9]|Errors: [1-9])|BUILD" /tmp/ci-failure.log | head -n 3
AGENT_AUDIT=/tmp/agent-audit.jsonl uv run --no-project --python 3.12 \
  --with-requirements .github/ai/requirements.txt python .github/ai/fix_agent.py /tmp/ci-failure.log
git diff                                   # the agent's change, if any
jq -c '{step, tool, args}' /tmp/agent-audit.jsonl   # what it did, step by step (or: cat the file)
```

The `grep` must show the failure CI will see (Maven 3.9 prints `[INFO] BUILD FAILURE`):

```text
[ERROR] Tests run: 3, Failures: 1, Errors: 1, Skipped: 0, Time elapsed: 0.618 s <<< FAILURE! -- in boxoffice.catalog.CatalogServiceTest
[ERROR] Tests run: 6, Failures: 1, Errors: 1, Skipped: 0
[ERROR] BUILD FAILURE
```

The agent prints one JSON line at the end: `fixed`, its `explanation`, the tokens, the steps and the time. A run with the local `qwen2.5-coder-16k` while this lab was written:

```text
{"fixed": false, "explanation": "```json\n{\"name\": \"write_file\", ... (abridged)", "model": "qwen2.5-coder-16k", "calls": 20, "in": 165075, "cache_read": 0, "cache_write": 0, "out": 5596, "seconds": 517.1, "usd": 0.0, "steps": 20}
```

Read the audit log next to `git diff`: the free 7B model **never opened `CatalogService.java`**. It rewrote the *test* six times — adding, among others, a test that expects a `404` when the event **exists**, which encodes the bug as the specification (the oracle problem of part 2) — then broke compilation with a duplicated method and ran out of its 20 steps after 8½ minutes and 165,075 input tokens, ending with `"fixed": false`. Nothing dangerous happened: every write stayed under `services/catalog/src/`, and in CI the independent `mvn verify` of the verification step fails on this patch, so no PR is opened. That is the whole point of the guards — they make a bad agent harmless, not good. Run it once more with a stronger model if you have one, and compare.

```text
$ jq -c '{step, tool, args}' /tmp/agent-audit.jsonl
{"step":1,"tool":"read_file","args":{"path":"services/catalog/src/test/java/boxoffice/catalog/CatalogServiceTest.java"}}
{"step":2,"tool":"write_file","args":{"path":"services/catalog/src/test/java/boxoffice/catalog/CatalogServiceTest.java","content":"<2431 chars>"}}
{"step":3,"tool":"run_build","args":{"service":"catalog"}}
...
{"step":18,"tool":"run_build","args":{"service":"catalog"}}
{"step":19,"tool":"read_file","args":{"path":"services/catalog/src/test/java/boxoffice/catalog/CatalogServiceTest.java"}}
```

Whatever it did, **verify like the workflow does**: `git diff --stat` must list only files under `services/catalog/src/`, no `@Test` may disappear, and `mvn -B -f services/catalog/pom.xml verify` must pass. Then undo the agent's change (`git checkout -- services`) — the CI run below should start from the broken commit.

**Then in CI:**

1. Push the branch and open a PR: `git push -u origin break-catalog && gh pr create --fill --base main`.
2. CI fails (`gh pr checks` shows `CI` red). Within a minute the `AI fix` workflow starts: `gh run list --workflow ai-fix.yaml --limit 1`. With the free model on the runner, give it up to 45 minutes.
3. Open its summary and download the `ai-fix` artifact: `gh run download <run id> -n ai-fix -D /tmp/ai-fix`. It holds `agent-audit.jsonl` (path B) or `agent-transcript.jsonl` (path A), and `ai-fix.patch` if the change passed verification.
4. If verification passed, a draft PR `AI fix proposal for break-catalog (<sha>)` appears: `gh pr list --label ai-generated`. Read it and answer in `results/lab13.md`:
    - Did the agent fix the **code** or bend the **test**? (The guard catches deleted tests, not a weakened assertion — did it try?)
    - How many steps (or turns) and how many dollars or minutes did it take? Compare with how long *you* needed.
    - Would you merge it? Approve or close the PR with a written reason (`gh pr review --approve -b "..."` or `gh pr close -c "..."`).
5. Repeat with a failure the agent **cannot** fix from the repository alone — for example a test that needs a database that the CI job does not start. A good agent stops and explains (`"fixed": false`); a bad one edits random files. Your verification step is what keeps the second case harmless.

When you finish, close the `break-catalog` PR without merging (`gh pr close break-catalog --delete-branch`).

!!! tip "Where agents in CI pay off"

    Mechanical failures with a clear signal in the log: compilation errors after a dependency upgrade, a renamed method, a broken import, a formatting check, a test that fails because an expected message changed. They pay off less on flaky tests and infrastructure problems — classify those first (the class page on [testing](../../../classes/ai-delivery/testing/index.md) covers flaky-test triage).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `AI fix` never starts after CI fails | the workflow is not on the default branch, or your CI workflow is not named `CI` | merge `ai-fix.yaml` into `main`; `gh workflow list` shows the CI name — use it in `workflows: [...]` |
| The run is **skipped** | CI was not a failure, the branch starts with `ai-fix/` or `ai-tests/`, or the CI run came from a fork | expected: those are the guards |
| `fixed: false`, `explanation: stopped by budget after N steps` | the model wandered (common with small models) | read `agent-audit.jsonl`; raise `AGENT_MAX_STEPS` locally, or try a stronger model |
| `ERROR: ... only files under services/<name>/src/ may be written` in the audit | the agent tried to edit `pom.xml`, a workflow or another protected file | expected: the guard worked |
| `the agent changed files outside services/<name>/src/` in the verify step | path A wrote outside `src/` | the patch is rejected on purpose; read the transcript |
| `openai.BadRequestError ... does not support tools` | the Ollama model has no tool calling | use `qwen2.5-coder-16k` (built from `qwen2.5-coder:7b`, which supports tools) |
| Local run: `agent-audit.jsonl` appears in `git status` | `AGENT_AUDIT` not set, so the log went to the repository root | set `AGENT_AUDIT=/tmp/agent-audit.jsonl` as in the command above; delete the stray file |

[Next: part 4 — release notes](../release-notes/index.md){ .md-button .md-button--primary }
