The team upgrades Spring Boot across BoxOffice on a Monday morning. Fourteen services, fourteen red builds: a renamed configuration property here, a deprecated method there, a test that relied on an old default. Each fix is small and boring; together they take two engineers two days. An **agent** — a model that plans, uses tools, observes the result and tries again — can do most of this work while the engineers review. It can also, if badly designed, push to `main`, leak the deploy key, loop for an hour on a flaky test, or "fix" a red build by deleting the assertion. This page is about the design that gets the first outcome and makes the second impossible.

---

## What agents do in a pipeline

The [agent loop](../../ai-systems/agents/index.md) — the model chooses a tool, the harness runs it, the result goes back into the context, repeat — becomes, in CI, a loop over the repository and the build:

| Agentic workflow | Trigger | Verifiable by | Typical blast radius | Sensible autonomy |
|---|---|---|---|---|
| **Fix the failing build** | CI run failed | The build and tests pass; diff is small | One branch | Supervised: draft PR |
| **Dependency upgrade** | Renovate/Dependabot PR is red | Build, tests, canary | Many services | Supervised; auto-merge only patch versions with green CI |
| **Migration** (JUnit 4 → 5, `javax` → `jakarta`, Java 17 → 21) | Planned campaign | Build, tests, plus a codemod for the mechanical part | Whole codebase, in batches | Supervised, one PR per service |
| **Issue to PR** | Issue labelled or `@mention` | Tests written with the issue's acceptance criteria | One feature | Supervised; human review as usual |
| **Docs and config sync** | API or schema changed | Lint, link check, OpenAPI diff | Docs | Can be autonomous for docs-only changes |

Every row ends in the same place: a **proposal** (a branch, a draft PR) that deterministic checks and a human approve. That is level 3 of the [autonomy spectrum](../index.md#the-autonomy-spectrum). Level 4 — applying changes without per-change approval — is reserved for changes that are both low-risk and fully verifiable, and rarely needs a model at all.

---

## Anatomy of a fix-the-build agent

``` diagram-sim
sequenceDiagram
    autonumber
    participant CI as CI run
    participant Orch as Workflow (deterministic)
    participant Agent as Agent loop (sandbox)
    participant Model as Model
    participant Repo as Git host
    CI-->>Orch: run failed (event)
    Orch->>Orch: dedupe by commit SHA, check branch is not ai-fix/*
    Orch->>Agent: failed log + checkout (no write token)
    loop at most N turns, M dollars
        Agent->>Model: context + tool results
        Model-->>Agent: tool call (read / edit / run build)
        Agent->>Agent: execute allow-listed tool, log it
    end
    Agent-->>Orch: working-tree diff + transcript
    Orch->>Orch: verify: paths allowed, no test removed, build green
    Orch->>Repo: separate job with write token: branch + draft PR
    Repo-->>Orch: human reviews, CI runs, merge or close
```

Read it as two programs. The **agent** is non-deterministic and untrusted: it may be wrong, confused or manipulated by text in the log. The **orchestrator** around it — triggers, dedupe, verification, the PR job — is ordinary deterministic code, reviewed like any other. All the safety lives in the orchestrator.

---

## Running agents headless

Agents in CI run **headless**: no terminal, no human to answer "may I run this command?". Every decision a person would make interactively must be made **in advance**, as configuration.

=== "Claude Code (CLI)"

    `claude -p "<task>"` runs Claude Code non-interactively. Relevant flags from its [CLI reference](https://code.claude.com/docs/en/cli-reference){target="_blank"}:

    ```bash
    gh run view "$RUN_ID" --log-failed | tail -n 300 | \
    claude --bare -p "The CI build failed; the log is on stdin. Fix the root cause with the smallest change. Never delete or weaken a test." \
      --allowedTools "Read,Edit,Write,Bash(mvn -B *)" \
      --permission-mode dontAsk \
      --max-turns 25 --max-budget-usd 1.50 \
      --output-format stream-json --verbose > transcript.jsonl
    ```

    `--bare` skips auto-discovery of hooks, plugins, MCP servers and `CLAUDE.md` (the same behaviour on every machine, and nothing loaded from the repository you did not choose); `--allowedTools` uses permission-rule syntax (`Bash(mvn -B *)` allows only commands starting with `mvn -B`); `dontAsk` denies everything else; `--max-turns` and `--max-budget-usd` bound the loop; `stream-json` produces a transcript for the audit log, whose last line reports the cost.

=== "Claude Code GitHub Action"

    [`anthropics/claude-code-action@v1`](https://github.com/anthropics/claude-code-action){target="_blank"} runs the same engine inside GitHub Actions. Without a `prompt` it answers `@claude` mentions in PRs and issues (only from users with write access, by default); with a `prompt` it runs in automation mode on any event. CLI flags go in `claude_args`. The interactive setup from the [documentation](https://code.claude.com/docs/en/github-actions){target="_blank"}:

    ```yaml
    name: Claude Code
    on:
      issue_comment:
        types: [created]
      pull_request_review_comment:
        types: [created]
    jobs:
      claude:
        if: contains(github.event.comment.body, '@claude')
        runs-on: ubuntu-latest
        permissions:
          contents: write
          pull-requests: write
          issues: write
          id-token: write
          actions: read
        steps:
          - uses: actions/checkout@v6
            with:
              fetch-depth: 1
          - uses: anthropics/claude-code-action@v1
            with:
              anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    ```

    Note the permissions: this job can write code, PRs and issues — appropriate for an on-demand assistant that humans invoke, which pushes commits a human then reviews. For an *unattended* agent reacting to failures, prefer a job without write access that produces a patch, and a separate job that opens the PR (next section). Check the action's security documentation and current inputs before use.

=== "Generic loop (any provider)"

    An agent is a loop you can write yourself over any API with tool calling — including OpenAI-compatible endpoints via LiteLLM or a local model with Ollama. The core, without error handling:

    ```python
    for step in range(MAX_STEPS):
        reply = client.chat.completions.create(model=MODEL, messages=messages, tools=TOOLS)
        msg = reply.choices[0].message
        messages.append(msg.model_dump(exclude_none=True))
        if not msg.tool_calls:
            break
        for call in msg.tool_calls:
            result = run_allow_listed(call.function.name, json.loads(call.function.arguments))
            audit(step, call, result)
            messages.append({"role": "tool", "tool_call_id": call.id, "content": result})
    ```

    Writing it yourself makes the **tool surface** explicit: here the agent has `read_file`, `write_file` (only under `src/`), `run_build` and `finish` — and no shell at all. [Hands-on 13](../../../hands-on/13/fix-agent/index.md) has the complete version with budgets and an audit log.

---

## Sandboxing

The agent executes the build, and the build executes **the repository's code**: tests, Maven plugins, scripts. Assume that code — or text the agent reads — may be hostile, and contain it in layers:

| Layer | Control | Protects against |
|---|---|---|
| **Ephemeral environment** | Fresh hosted runner or container per run, destroyed after | Persistence between runs; poisoned caches (be careful with shared build caches) |
| **Tool allow-list** | Read/edit files, run *the build*; no general shell, no `curl`, no `git push` | The agent doing anything you did not foresee |
| **Filesystem scope** | Writes only under `services/*/src/`; `.github/`, `.git/` unreachable | Editing CI to remove checks; tampering with history |
| **Environment scrubbing** | Build and tests run without `*KEY*`, `*TOKEN*`, `*SECRET*` variables | A malicious test reading the environment |
| **Network egress** | Only the package registry and the model endpoint (proxy or firewall on self-hosted runners) | Exfiltration to arbitrary hosts |
| **Resource limits** | Job timeout, CPU/memory limits | Runaway loops and builds |

No single layer is perfect. A tool allow-list of `Bash(mvn *)` still runs whatever the project's Maven plugins do; environment scrubbing does not protect the model API key held by the agent process itself. That is why the key has a **spend limit**, the job has **no write token**, and the output is **verified** outside the agent.

---

## Permissions: the token is the blast radius

Whatever the model decides, it can never do more than its credentials allow. Design the credentials first:

- **Least-privilege `GITHUB_TOKEN`**: declare `permissions:` in every workflow; the job that runs the agent gets `contents: read` (and `actions: read` to fetch logs).
- **Split jobs by privilege**: the agent job produces a patch artifact; a small job with `contents: write` and `pull-requests: write` applies it and opens a **draft PR**. The job with write access runs no model and no untrusted code.
- **No secrets in the agent's context**: never paste secrets into prompts or tool results; keep deploy keys, cloud credentials and registry tokens out of the job entirely.
- **Read-only by default**: an agent that only diagnoses (explains the failure as a comment) needs no write access at all — start there.
- **Branch protection and rulesets**: `main` requires PRs, CI and a human approval; bots cannot bypass; changes to `.github/workflows/` require a code owner.
- **Human approval is structural**, not a prompt instruction: the agent *cannot* merge because its token cannot.

!!! example "In the BoxOffice code: two jobs, two privileges (lab 13)"

    [Hands-on 13 — The fix agent](../../../hands-on/13/fix-agent/index.md) splits the workflow exactly this way. The `fix` job runs the model **and** the untrusted build with `contents: read` and `actions: read` (to fetch the failed log), and it runs only for failed CI runs of this repository's own branches, never for its own `ai-fix/` branches. The `open-pr` job has `contents: write` and `pull-requests: write`, runs no model and no build, and only applies the patch as a **draft** PR — after an independent step re-ran `mvn verify` and rejected deleted `@Test`s and files outside `services/<name>/src/`.

    ``` { .yaml title=".github/workflows/ai-fix.yaml (the two jobs)" }
    --8<-- "docs/2027.1/hands-on/13/code/.github/workflows/ai-fix.yaml:15:29,119:126"
    ```

---

## Budgets: turns, tokens, dollars, minutes

Each agent turn re-sends the whole context — instructions, tool definitions, the log, every file read, every tool result so far. Context grows with every step, so **total input tokens grow roughly quadratically** with the number of steps ([AI systems — the numbers](../../ai-systems/index.md#numbers)). Prompt caching reads the repeated prefix at a fraction of the price, which changes the slope dramatically. Illustrative assumptions: a 20,000-token starting context (instructions, tool definitions, log), 2,500 tokens added per step (tool result plus the model's output), 400 output tokens per step, list prices of a large model at the time of writing (US$ 4 input, US$ 20 output, US$ 0.20 cached read per million tokens):

```python exec="1" html="1"
import matplotlib.pyplot as plt
from io import StringIO

P_IN, P_OUT, P_READ, WRITE = 4.00, 20.00, 0.20, 1.25   # US$ per 1M tokens (illustrative)
START, GROWTH, OUT = 20_000, 2_500, 400               # tokens


def run_cost(steps, cached):
    total, context = 0.0, START
    for i in range(steps):
        new = START if i == 0 else GROWTH
        old = context - new
        if cached:
            total += (old * P_READ + new * P_IN * WRITE) / 1e6
        else:
            total += context * P_IN / 1e6
        total += OUT * P_OUT / 1e6
        context += GROWTH
    return total


steps = list(range(1, 41))
no_cache = [run_cost(s, False) for s in steps]
cache = [run_cost(s, True) for s in steps]

fig, ax = plt.subplots(figsize=(8, 3.6))
ax.plot(steps, no_cache, color="#d1495b", linewidth=2, label="no prompt cache")
ax.plot(steps, cache, color="#2e86ab", linewidth=2, label="prefix cached")
for s in (10, 25, 40):
    ax.annotate(f"US$ {no_cache[s - 1]:.2f}", (s, no_cache[s - 1]), textcoords="offset points",
                xytext=(-10, 8), fontsize=8, color="#d1495b")
    ax.annotate(f"US$ {cache[s - 1]:.2f}", (s, cache[s - 1]), textcoords="offset points",
                xytext=(-10, -14), fontsize=8, color="#2e86ab")
ax.set_xlabel("Agent turns")
ax.set_ylabel("US$ per run")
ax.set_title("Cost of one agent run vs number of turns (illustrative)")
ax.grid(True, alpha=0.3)
ax.legend()
for spine in ax.spines.values():
    spine.set_alpha(0.3)
ax.set_facecolor("none")
ax.tick_params(colors="gray")
ax.xaxis.label.set_color("gray")
ax.yaxis.label.set_color("gray")
ax.title.set_color("gray")
fig.tight_layout()
buffer = StringIO()
fig.savefig(buffer, format="svg", transparent=True)
print(buffer.getvalue())
plt.close(fig)
```

Without caching, 40 turns cost more than eight times what 10 turns cost (about US$ 11 vs US$ 1.3); with caching, the curve is nearly linear and about eight times cheaper at 40 turns. Either way, the budget must be **enforced by the harness**, not requested in the prompt:

| Budget | Typical value for fix-the-build | Enforced by |
|---|---|---|
| Turns | 20–30 | `--max-turns`, or the loop bound |
| Dollars | US$ 1–2 per run | `--max-budget-usd`, or a token counter in the loop; **workspace spend limit** at the provider |
| Wall time | 20–30 min | `timeout-minutes` on the job |
| Runs per commit | 1 | Dedupe on the commit SHA |
| Runs per day per repository | e.g. 20 | Quota in the LLM gateway |

The ratio that matters is **dollars per merged fix**, not per run: an agent that costs US$ 0.80 per run but produces a mergeable fix one time in four costs US$ 3.20 per useful fix — compare that with the engineer-time it saves.

!!! example "In the BoxOffice code: the budgets and the write area of the fix agent (lab 13)"

    The agent of [hands-on 13](../../../hands-on/13/fix-agent/index.md) stops at 20 steps, 400,000 tokens or US$ 1.50, whichever comes first; it may read files of the repository but write only under `src/`, never `.git/` or `.github/`, and every tool call goes to an audit log. A run with the local `qwen2.5-coder-16k` shows why the budget is not optional: the model never opened `CatalogService.java`, rewrote the *test* six times, and stopped after its 20 steps, 8½ minutes and 165,075 input tokens with `"fixed": false`. Nothing dangerous happened — every write stayed under `services/catalog/src/`, and the independent `mvn verify` failed, so no PR was opened. The guards make a bad agent harmless, not good.

    ``` { .python title=".github/ai/fix_agent.py (budgets, write area, budget stop)" }
    --8<-- "docs/2027.1/hands-on/13/code/.github/ai/fix_agent.py:23:27,70:76,178:182"
    ```

---

## Idempotency, retries and loops

Agents are triggered by events, and events repeat: a CI run is re-run, two pushes arrive in a minute, the agent's own branch fails CI. The messaging patterns of the course apply directly ([Messaging — delivery semantics](../../messaging/semantics/index.md)):

- **Idempotency key**: the failing commit SHA. One proposal per SHA (branch `ai-fix/<sha8>`, `concurrency` group on the SHA). Re-runs find the branch and stop.
- **No self-triggering**: never run the agent on its own branches (`ai-fix/*`), and remember that pushes with the `GITHUB_TOKEN` do not trigger new workflow runs on GitHub — a built-in loop breaker.
- **Retries are for transport, not for the task**: SDKs retry `429`/`5xx` with backoff. Re-running a *failed agent* is a new attempt with a new cost — make it a human decision, or at most one automatic retry with a different strategy.
- **Fail open for advisory agents**: if the agent fails, the original red build is still there; nothing is worse than before.

---

## Audit: who changed what, and why

An agent's change must be explainable months later. Keep:

| Record | Where |
|---|---|
| The full transcript (prompts, tool calls, results) | CI artifact with a retention period |
| Model id, prompt version, harness version | In the transcript and in the PR body |
| Cost and turns | Job summary; aggregated in the LLM gateway |
| That the commit is AI-generated | Commit trailer (`AI-assisted: ai-fix (claude-opus-5-5)`), PR label `ai-generated` |
| Who approved it | The PR review — the human of record |

This is the same discipline as for any production change, and it feeds the [supply-chain provenance](../security-governance/index.md) of the software: you can answer "which code in `inventory` was written by an agent, approved by whom?".

---

## Dependency and migration agents

**Dependency upgrades** are the most common agentic workflow in practice. Bots such as Renovate or Dependabot open the upgrade PR deterministically; the agent's job starts when that PR is **red**: read the changelog and the failure, adapt the code, keep the change minimal. Group related updates (all Spring artifacts together), let patch-level updates with green CI auto-merge without AI, and send major versions to an agent that proposes and a human that approves.

**Migrations** — JUnit 4 → 5, `javax.*` → `jakarta.*`, Java 17 → 21 — mix a large mechanical part with a long tail of special cases. Use deterministic **codemods** for the mechanical part (OpenRewrite recipes for Java are the standard tool) and the agent for the leftovers the recipe cannot handle. Split the campaign into **one PR per service**, small enough to review, behind the normal CI and canary. Large-scale changes at Google followed the same principle long before LLMs: automate the change, shard it into independently reviewable pieces, and let the owners review each piece[^1].

!!! example "BoxOffice: the Spring Boot upgrade, again"

    Renovate opens one grouped PR per service. Six are green and merge after review. For the eight red ones, the fix agent runs once per failing commit, with `mvn` as its only shell command, a US$ 1.50 cap and 25 turns. It proposes six fixes as draft PRs (renamed properties, a changed default in a test slice); for the other two it stops and explains (a removed API that needs a design decision). Two engineers review eight PRs in a morning instead of fixing fourteen services in two days — and the two hard cases get their full attention.

---

!!! tip "In the interview"

    For "design an agent that fixes broken builds", draw the **orchestrator** around the agent, not just the loop: trigger and dedupe, sandbox and tool allow-list, budgets enforced by the harness, verification outside the agent, a separate privileged step that opens a **draft** PR, and the audit trail. Quantify cost per run (quadratic in turns, mitigated by caching) and per *merged* fix. Say which failures it should *not* touch (flaky tests, infrastructure, security findings) and how the system detects them.

!!! success "Best practices"

    - **Use the failing commit SHA as the idempotency key** — one proposal per SHA: lab 13's [`ai-fix.yaml`](../../../hands-on/13/fix-agent/index.md) uses a `concurrency` group on the SHA and the branch `ai-fix/<sha8>`.
    - **Keep the transcript and the audit log as CI artifacts** — the run can be explained later; lab 13 uploads `agent-transcript.jsonl` and `agent-audit.jsonl`.
    - **Scrub secrets from the build the agent runs** — lab 13 runs `mvn verify` without the `*KEY*`, `*TOKEN*` and `*SECRET*` variables.
    - **Track dollars per merged fix, not per run** — one useful fix in four runs at US$ 0.80 is US$ 3.20 per fix; compare it with the engineer time it saves.
    - **Open drafts, never ready-for-review PRs** — a draft cannot be merged by accident and says that a person must take ownership; lab 13 opens `gh pr create --draft`.

!!! warning "Common pitfalls"

    - **One job with the agent and a write token**: every prompt injection becomes a push.
    - **Budgets in the prompt** ("please stop after 10 steps") instead of in the harness.
    - **Trusting the agent's "fixed it"**: verify independently; check that no test was removed or weakened.
    - **Agents triggering agents**: a fix branch fails CI, which triggers the fix agent, which…
    - **Running agents on fork code with secrets** (`pull_request_target`, `workflow_run`): see [Security & governance](../security-governance/index.md).

---

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    TRIG["red build event<br/>trigger + dedupe"] --> HARN["harness = orchestrator"]
    HARN --> SB["sandbox, tool allow-list,<br/>no write token"]
    HARN --> BUD["budgets: turns, tokens,<br/>dollars, minutes"]
    HARN --> LOOP["agent loop<br/>→ AI systems agents"]
    LOOP --> VER["verification<br/>outside the agent"]
    VER --> PRIV["separate privileged step<br/>opens a draft PR"]
    PRIV --> HUM["human review"]
    HARN --> IDEM["idempotency, retries, loops<br/>→ Messaging semantics"]
    HARN --> AUD["audit trail:<br/>who changed what, and why"]
```

**Palette components:** [`orchestrator`](../../../reference/components/ai/index.md#orchestrator) (the harness that enforces budgets and permissions) · [`toolreg`](../../../reference/components/ai/index.md#toolreg) (the allow-list of tools the agent may call) · [`llmgw`](../../../reference/components/ai/index.md#llmgw) (quotas and cost per run) · [`safety`](../../../reference/components/ai/index.md#safety) (no secrets or write tokens in the agent's reach) · [`logs`](../../../reference/components/observability/index.md#logs) (the audit trail) · [`metrics`](../../../reference/components/observability/index.md#metrics) (merged fixes per proposal, cost per merged fix). **Scenarios:** `ai-assistant` with the `spike` profile (hundreds of agents at once compete with user traffic at the gateway). **Continues in:** [AI systems — agents](../../ai-systems/agents/index.md), [Messaging — semantics](../../messaging/semantics/index.md) (at-least-once runs, idempotent effects), [Security & governance](../security-governance/index.md), [Cloud-native — delivery](../../cloud-native/delivery/index.md), [Hands-on 13 — fix agent](../../../hands-on/13/fix-agent/index.md).

---

[^1]: WINTERS, T.; MANSHRECK, T.; WRIGHT, H. *Software Engineering at Google*, ch. 22 "Large-Scale Changes". O'Reilly, 2020.
