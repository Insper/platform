!!! abstract "In this lab"

    - Add **five AI steps** to the BoxOffice pipeline of [lab 11](../11/index.md): a pull-request reviewer, a test generator checked by mutation testing, an agent that proposes a fix when CI fails, release notes on every tag, and an explained canary verdict.
    - Run every step through **one small, provider-neutral client**: a **local model with Ollama** (free, the default), Claude through the official SDK, or any OpenAI-compatible endpoint through LiteLLM.
    - **Harden** the workflows: permissions, triggers, secrets, and a prompt-injection test that the reviewer must survive.
    - **Measure it**: review precision, cost per PR, CI minutes and time to merge over a week of pull requests.

Lab 11 gave BoxOffice a pipeline that builds, tests, scans, signs and rolls out each change behind a canary. Lab 12 put a language model *inside* the product. This lab puts language models **inside the pipeline** — and treats them with the same discipline as any other dependency: least privilege, budgets, validation of every output, and numbers that say whether they help.

The rule for the whole lab: **AI proposes, rules and humans dispose.** No step in this lab can merge, approve, deploy or roll back on its own. The model writes comments, patches and explanations; deterministic checks (tests, mutation score, policy thresholds) and people decide.

## Before you start { #before-you-start }

| | |
|---|---|
| **Time** | 6–8 hours for parts 0–6 (one part per sitting is fine), plus ~15 minutes a day for one week in part 7 |
| **You need** | the tools of lab 0; a **GitHub account** (the repository on GitHub, the `gh` CLI logged in); for the free model, **~6 GB of free RAM and ~5 GB of disk** (8 GB machines: see [Troubleshooting](#troubleshooting)) |
| **Directory** | every command runs from the root of your `boxoffice/` repository (Windows: inside WSL 2) |
| **Costs** | **zero** on the default path: the model runs on your machine (Ollama) or on the GitHub runner. What can cost money is listed in [What costs money](#costs) |

``` { .bash .copy }
git --version                 # git 2.40+
gh --version                  # gh 2.x
gh auth status                # "Logged in to github.com account <you>"
uv --version                  # uv 0.5+ (runs every Python script of this lab)
java -version                 # 21 or newer
mvn -v                        # Apache Maven 3.9+
docker info > /dev/null && echo "Docker is running"   # mvn verify starts Testcontainers (parts 2-3)
ollama --version              # installed in step 0.1
```

**Start state** — the end of lab 12: your `boxoffice` repository, **pushed to GitHub**, with

``` { .tree title="boxoffice/ at the start of lab 13" }
boxoffice/
    .github/workflows/ci.yaml   # lab 11: "name: CI", runs `mvn -B verify` for each service
    docker-compose.yaml  infra/  load/  scripts/  results/
    services/catalog/  services/inventory/  services/auth/  services/gateway/  ...
    k8s/ ...                    # lab 10-11 (only needed for the optional live canary, step 5.4)
```

This lab uses mostly `services/catalog` (a Spring Boot 4.1.1 service on port 8082, see [lab 0](../0/index.md#boxoffice-services-and-ports)) and the CI workflow of lab 11. The Kubernetes cluster and the LiteLLM proxy of lab 12 are **optional**.

!!! tip "Catch up"

    Skipped or broke lab 12? Download [boxoffice-after-lab-12.zip](../12/boxoffice-after-lab-12.zip), unzip it and `cd boxoffice`. Then put it on GitHub — the AI steps run in GitHub Actions:

    ``` { .bash .copy }
    git init -b main && git add -A && git commit -m "boxoffice after lab 12"
    gh repo create boxoffice --public --source . --push
    ```

    This lab **adds** `.github/ai/` (scripts, golden set, canary snapshots), `.github/actions/ollama/`, five `ai-*.yaml` workflows, `CONVENTIONS.md`, `docs/adr/0001-schema-per-service.md`, `Dockerfile.ai-tools`, `k8s/catalog/analysis-explained.yaml` and a unit test of `catalog`, and **replaces** `services/catalog/pom.xml`. All are shown in full on these pages and are all in [`boxoffice-after-lab-13.zip`](boxoffice-after-lab-13.zip). If your CI workflow is not named `CI`, change `workflows: [CI]` in `ai-fix.yaml` (part 3).

!!! info "Acronyms used in this lab"

    **PR** pull request · **CI** continuous integration · **LLM** large language model · **ADR** architecture decision record · **PIT** the mutation-testing tool for Java ([pitest.org](https://pitest.org){target="_blank"}) · **SHA** the hash that names a Git commit · **pp** percentage points (5 % → 10 % is +5 pp) · **SDK** software development kit.

## Slides

<div class="slides-embed">
  <iframe src="slides/ai-cicd.html" title="Slides: hands-on 13 — AI in CI/CD" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/ai-cicd.html){:target="_blank"}

!!! info "Theory connection"

    This lab pairs with the class [AI-Assisted Delivery](../../classes/ai-delivery/index.md). Read its [Code review](../../classes/ai-delivery/code-review/index.md) and [Security & governance](../../classes/ai-delivery/security-governance/index.md) pages before parts 1 and 6. It builds on the [Delivery](../../classes/cloud-native/delivery/index.md) page of the cloud-native class and on the [LLM gateway](../../classes/ai-systems/llm-gateway/index.md) of the AI systems class.

## What you will build

``` mermaid-sim
flowchart LR
    dev([Developer]) -->|"opens PR"| pr["Pull request"]
    pr --> rev["1 · AI review<br/>inline comments + cost"]
    pr -->|"label ai-tests"| gen["2 · AI tests<br/>PIT must improve"]
    pr --> ci["CI (lab 11)<br/>build · test · scan"]
    ci -->|"failure"| fix["3 · AI fix agent<br/>draft PR"]
    ci -->|"merge + tag"| rel["4 · AI release notes<br/>draft release"]
    rel --> canary["Canary (lab 11)"]
    canary --> expl["5 · Policy verdict<br/>+ AI explanation"]
    expl -->|"promote / rollback"| prod([Production])
    sec["6 · Hardening<br/>permissions · injection test"] -.-> rev
    sec -.-> fix
    meas["7 · Measure it<br/>precision · $/PR · minutes"] -.-> rev
```

Every AI step has the same shape — a **trigger**, **context gathering**, **one model call (or a bounded agent loop) with structured output**, **validation**, and an **action with the smallest possible permission**:

| Part | Trigger | Context | Output | Validated by | Action (permission) |
|---|---|---|---|---|---|
| [1. AI review](review/index.md) | `pull_request` | numbered diff, `CONVENTIONS.md`, ADRs | JSON findings | added lines only, thresholds, dedup | review comments (`pull-requests: write`) |
| [2. AI tests](tests/index.md) | label `ai-tests` | class, neighbours, existing tests | a test class | compiles, passes twice, **PIT score** rises | draft PR (separate job) |
| [3. Fix agent](fix-agent/index.md) | `workflow_run` failed | failed log, repository | a patch | `mvn verify`, no test removed, `src/` only | draft PR (separate job) |
| [4. Release notes](release-notes/index.md) | tag `v*` | commits, diffstat, migrations | JSON items with refs | every item cites a real commit | **draft** release (`contents: write`) |
| [5. Canary](canary/index.md) | analysis step | Prometheus numbers | explanation | must repeat the **policy** verdict | none: the policy decides |
| [6. Security](security/index.md) | — | — | — | golden set + injection cases | — |
| [7. Measure it](measure/index.md) | weekly | PR history | report | — | — |

## 0. Setup: one client, three ways to reach a model

All scripts live in `.github/ai/` of your repository and import one module, `llm.py`. It hides the provider behind a single function, `complete_json(system, user, schema)`, that returns **JSON validated against a schema** plus the **token usage and its cost**. The provider is chosen with environment variables — the same names locally and in GitHub Actions (as repository *variables*):

| Variable | Default | Meaning |
|---|---|---|
| `LLM_PROVIDER` | `ollama` | `ollama` (local, free), `anthropic` (Claude) or `openai` (any OpenAI-compatible endpoint, e.g. LiteLLM) |
| `LLM_MODEL` | `qwen2.5-coder-16k` on `ollama`, `claude-opus-5-5` on `anthropic` | the model id |
| `LLM_BASE_URL` | `http://localhost:11434/v1` on `ollama` | endpoint of `ollama` / `openai` |
| `LLM_API_KEY`, `ANTHROPIC_API_KEY` | — | **secrets**, only for the paid or remote paths |

### 0.1 Pick a model { #pick-a-model }

=== "Local model with Ollama (free, default)"

    1. Install [Ollama](https://ollama.com/download){target="_blank"} and start it:

        ``` { .bash .copy }
        # macOS
        brew install ollama && brew services start ollama
        # Linux and Windows (inside WSL 2)
        curl -fsSL https://ollama.com/install.sh | sh
        ```

        Check that the server answers: `curl -s http://localhost:11434/api/version` prints `{"version":"..."}`. On Linux without systemd (some WSL setups), start it by hand in another terminal with `ollama serve`.

    2. Get the model — **after** you saved the files of step 0.2 (the script is one of them):

        ``` { .bash .copy }
        bash .github/ai/ollama-model.sh
        ```

        It downloads `qwen2.5-coder:7b` (4.7 GB, once) and creates `qwen2.5-coder-16k`, the same model with a **16,384-token context window**. Ollama's default window is 4,096 tokens, and a longer prompt is cut **silently** — the reviewer would lose its instructions on a big diff. You should see, at the end:

        ```text
        success
        ready: LLM_PROVIDER=ollama LLM_MODEL=qwen2.5-coder-16k (context 16384 tokens)
        ```

    Nothing else to configure: `ollama` is the default provider. In GitHub Actions the workflows install Ollama **on the runner** with the composite action `.github/actions/ollama` (below) — free, but slow: a CPU-only runner needs minutes per call, where your laptop needs seconds. Expect lower review quality than a frontier model; part 6 measures *how much* lower.

=== "Claude (Anthropic API, paid)"

    1. Create an API key in the [Claude Console](https://platform.claude.com){target="_blank"} and set a **monthly spend limit** for its workspace (a few dollars is plenty for this lab).
    2. Locally: `export LLM_PROVIDER=anthropic` and `export ANTHROPIC_API_KEY=<the key you just created>` (never commit it; the lab 0 `.gitignore` already ignores `.env`).
    3. In GitHub: **Settings → Secrets and variables → Actions**, or with `gh`:

        ``` { .bash .copy }
        gh secret set ANTHROPIC_API_KEY          # paste the key when asked
        gh variable set LLM_PROVIDER --body anthropic
        gh variable set LLM_MODEL --body claude-opus-5-5   # or claude-sonnet-5-5 / claude-haiku-4-5: cheaper
        ```

    The client calls the Messages API through the official `anthropic` SDK with **structured outputs** (`output_config.format` with a JSON schema), **prompt caching** of the system prompt, and the server-side **refusal fallback** (a beta) on models that support it. Check the [models overview](https://platform.claude.com/docs/en/about-claude/models/overview){target="_blank"} for current model ids and prices.

=== "Any provider through LiteLLM (optional)"

    The LiteLLM proxy of [lab 12](../12/index.md) exposes an **OpenAI-compatible** endpoint in front of any provider. Locally: `export LLM_PROVIDER=openai LLM_BASE_URL=http://localhost:4000/v1 LLM_MODEL=<a model alias of your proxy>` and `export LLM_API_KEY=<your LiteLLM virtual key>`; `curl -s -H "Authorization: Bearer $LLM_API_KEY" $LLM_BASE_URL/models` lists the aliases.

    GitHub-hosted runners cannot reach `localhost` on your laptop: in CI this path needs a LiteLLM proxy reachable from the internet (or a self-hosted runner). Set the repository variables `LLM_PROVIDER=openai`, `LLM_BASE_URL`, `LLM_MODEL` and the secret `LLM_API_KEY` (a virtual key with its own budget).

!!! note "What about GitHub Models?"

    Earlier versions of this lab could use GitHub Models, a free inference API for Actions. GitHub retired it on 30 July 2026 ([GitHub docs](https://docs.github.com/en/github-models){target="_blank"}), so the free path is now Ollama.

### What costs money { #costs }

| Item | Cost |
|---|---|
| Ollama on your machine | free (electricity, ~5 GB of disk) |
| GitHub Actions minutes | **free for public repositories**; in a private repository they count against your plan's monthly minutes ([GitHub billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions){target="_blank"}) — the Ollama path uses several runner minutes per AI job |
| Claude API (`LLM_PROVIDER=anthropic`, and path A of part 3) | **paid** per token; protect it with a workspace spend limit. Each job prints its cost in US$ |
| A LiteLLM proxy on the internet | whatever its upstream provider charges |

!!! warning "Course policy for this lab"

    Use **your own** key or a local model, never a teammate's or a company's. Never paste secrets, real customer data or personal data into prompts. Any commit that contains AI-generated code carries the trailer `AI-assisted: <tool> (<model>)` and every AI-opened PR carries the label `ai-generated`.

### 0.2 The shared client

Save the files below at the paths in their titles (the folder `.github/ai/` is new). To avoid copying twenty files by hand, you can also take them from [`boxoffice-after-lab-13.zip`](boxoffice-after-lab-13.zip) — the state at the **end** of this lab — and copy only what you need:

``` { .bash .copy }
curl -fsSL -o /tmp/lab13.zip https://insper.github.io/platform/2027.1/hands-on/13/boxoffice-after-lab-13.zip
unzip -oq /tmp/lab13.zip -d /tmp/lab13      # outside your repository: nothing to clean up in git status
cp -R /tmp/lab13/boxoffice/.github/ai /tmp/lab13/boxoffice/.github/actions .github/
```

``` { .text title=".github/ai/requirements.txt" .copy }
--8<-- "docs/2027.1/hands-on/13/code/.github/ai/requirements.txt"
```

``` { .bash title=".github/ai/ollama-model.sh" .copy }
--8<-- "docs/2027.1/hands-on/13/code/.github/ai/ollama-model.sh"
```

``` { .yaml title=".github/actions/ollama/action.yml" .copy }
--8<-- "docs/2027.1/hands-on/13/code/.github/actions/ollama/action.yml"
```

``` { .python title=".github/ai/llm.py" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/13/code/.github/ai/llm.py"
```

What to notice in `llm.py`:

| Design decision | Why |
|---|---|
| **`system` is stable, `user` carries the run's data** | The system prompt (instructions + conventions) is identical on every run, so it can be **cached**: on Claude, cached input tokens are billed at a fraction of the normal price. The diff, logs and metrics change every run and go in `user`. |
| **Structured output + schema validation** | Claude constrains the answer to the JSON schema (`output_config.format`); the OpenAI-compatible path (Ollama, LiteLLM) uses JSON mode and validates with one repair attempt. Either way the caller gets a `dict` it can check, never free text it must parse. |
| **Every failure becomes an `LLMError`** | A refusal, a truncated answer (`max_tokens`), no API key, a model server that is down: each job decides explicitly what happens then (usually: *fail open*, skip the AI step and say so in the summary). |
| **`Usage` with prices** | Every job prints tokens and dollars in its summary. You cannot manage a cost you do not see. The prices are list prices when this lab was written — update `PRICES` from the provider's page. A local model shows `n/a`. |
| **No retries here** | The SDKs already retry `429` and `5xx` with backoff; a second retry layer would multiply calls during an outage (the retry storm of [Reliability](../../classes/reliability/index.md)). |

**Checkpoint.** Run the smoke test at the bottom of `llm.py` (the first `uv run` downloads the Python packages, ~10 s):

``` { .bash .copy }
uv run --no-project --python 3.12 --with-requirements .github/ai/requirements.txt python .github/ai/llm.py
```

You should see (the greeting varies; the first call also loads the model into memory, so it takes longer):

```text
provider=ollama model=qwen2.5-coder-16k
{"greeting": "Hello, BoxOffice team!"}
| Model | Calls | Input | Cache read | Cache write | Output | Time | Cost |
|---|---|---|---|---|---|---|---|
| `qwen2.5-coder-16k` | 1 | 81 | 0 | 0 | 15 | 1.9 s | n/a (local or unknown model) |
```

`LLM error: APIConnectionError: Connection error.` means Ollama is not running; `NotFoundError ... model 'qwen2.5-coder-16k' not found` means step 0.1 was skipped. See [Troubleshooting](#troubleshooting).

### 0.3 The context: conventions and decisions

The reviewer is only as good as what it knows about **your** system. A generic model knows Java; it does not know that `order` must never write to the `inventory` schema. Write that knowledge down once — for humans first — in `CONVENTIONS.md` at the root of the repository:

``` { .markdown title="CONVENTIONS.md" .copy }
--8<-- "docs/2027.1/hands-on/13/code/CONVENTIONS.md"
```

Architecture decision records (ADRs) in `docs/adr/` are also sent to the reviewer (the first 3,000 characters of each). An ADR is a short note of one decision: context, decision, consequences. Start with the one BoxOffice made in lab 1:

``` { .markdown title="docs/adr/0001-schema-per-service.md" .copy }
--8<-- "docs/2027.1/hands-on/13/code/docs/adr/0001-schema-per-service.md"
```

### 0.4 Repository settings { #repository-settings }

Once per repository, from the repository root:

``` { .bash .copy }
gh label create ai-generated --color 8250df --description "opened or written by an AI step"
gh label create ai-tests --color 0e8a16 --description "run the AI test generator on this PR"
# Workflow permissions: read-only by default, and allow Actions to open (draft) pull requests
gh api --method PUT "repos/{owner}/{repo}/actions/permissions/workflow" \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true
```

`{owner}/{repo}` is filled in by `gh` from the current repository. The last command is the same as **Settings → Actions → General → Workflow permissions**: *Read repository contents* and *Allow GitHub Actions to create and approve pull requests* (GitHub has one checkbox for both; no workflow of this lab ever approves). Check it with `gh api "repos/{owner}/{repo}/actions/permissions/workflow"`:

```json
{"default_workflow_permissions":"read","can_approve_pull_request_reviews":true}
```

## Parts

1. [AI pull-request review](review/index.md) — structured findings as inline comments, noise control, cost in the job summary.
2. [AI-generated tests, judged by mutation testing](tests/index.md) — keep a generated test only if PIT says it catches more bugs.
3. [An agent that fixes the failing build](fix-agent/index.md) — headless Claude Code or a 150-line agent loop; a draft PR for a human.
4. [AI release notes](release-notes/index.md) — grounded in commits, published as a draft.
5. [An explained canary verdict](canary/index.md) — the policy decides, the model explains.
6. [Security hardening](security/index.md) — triggers, permissions, secrets, prompt injection, and a golden-set eval.
7. [Measure it](measure/index.md) — precision, $/PR, CI minutes and time to merge over a week.
8. [Quiz](quiz.md).

## Troubleshooting

Each part has its own list for its specific errors; these are the ones that can appear anywhere.

| Symptom | Cause | Fix |
|---|---|---|
| `AI review skipped` / `LLM error: APIConnectionError: Connection error.` | Ollama is not running (or `LLM_BASE_URL` points elsewhere) | `curl -s http://localhost:11434/api/version`; start it (`brew services start ollama`, `sudo systemctl start ollama` or `ollama serve`) |
| `NotFoundError ... model 'qwen2.5-coder-16k' not found` | the 16k model was not created | `bash .github/ai/ollama-model.sh`; `ollama list` must show it |
| A local call takes minutes, or the machine swaps | not enough free RAM for a 7B model with a 16k window | close other programs; on an 8 GB machine use the 3B model: `OLLAMA_BASE_MODEL=qwen2.5-coder:3b bash .github/ai/ollama-model.sh` (same name, smaller model, lower quality) |
| `TypeError: Could not resolve authentication method` | `LLM_PROVIDER=anthropic` without `ANTHROPIC_API_KEY` | export the key, or `unset LLM_PROVIDER` to go back to Ollama |
| `uv: command not found` / `No interpreter found for Python 3.12` | uv missing (lab 0) | install uv (lab 0); `uv python install 3.12` |
| A workflow does not start at all | the file is not on the default branch yet (`workflow_run`, labels), or Actions are disabled | merge the workflows into `main` first; **Settings → Actions → General → Allow all actions** |
| `HTTP 403: Resource not accessible by integration` | the job lacks a permission, or the repository default is read-only and the workflow did not declare it | keep the `permissions:` blocks of the files on these pages; run step 0.4 |
| `GitHub Actions is not permitted to create or approve pull requests` | step 0.4 skipped | run the `gh api --method PUT ...` command of step 0.4 |
| A CI job with Ollama hits its timeout | CPU-only runner, large prompt (in a private repository the runner may also have less memory) | smaller diffs; the 3B model (add `env: { OLLAMA_BASE_MODEL: "qwen2.5-coder:3b" }` to the step that uses `./.github/actions/ollama`); or a paid provider for that job |

## Clean up

``` { .bash .copy }
# stop the AI workflows from running on every PR (re-enable with `gh workflow enable`)
for w in ai-review.yaml ai-tests.yaml ai-fix.yaml ai-release-notes.yaml ai-eval.yaml; do gh workflow disable "$w"; done
# delete the branches the bots opened (their PRs were merged or closed)
git ls-remote --heads origin 'ai-fix/*' 'ai-tests/*' | awk '{print $2}' | sed 's|refs/heads/||' \
  | xargs -r -n1 git push origin --delete
ollama stop qwen2.5-coder-16k          # frees the RAM now; `ollama rm qwen2.5-coder-16k qwen2.5-coder:7b` frees the disk
```

If you used Claude, **revoke the API key** in the Claude Console (or keep it with its spend limit) and `gh secret delete ANTHROPIC_API_KEY`. Keep the files: they are part of your repository and of the team project.

## Deliverable

- [ ] `.github/ai/` with `llm.py`, `diffutil.py`, `review.py`, `gen_tests.py`, `fix_agent.py`, `release_notes.py`, `canary_explain.py`, `eval_review.py`, `metrics.py`, `ollama-model.sh`, `requirements.txt`, the `evals/` golden set and the `canary/` snapshots.
- [ ] `CONVENTIONS.md` with at least five rules specific to **your** BoxOffice, and at least one ADR in `docs/adr/`.
- [ ] Workflows `ai-review.yaml`, `ai-tests.yaml`, `ai-fix.yaml`, `ai-release-notes.yaml` and `ai-eval.yaml`, each with an explicit `permissions:` block, passing `actionlint` (part 6).
- [ ] One PR where the reviewer posted inline comments, with the cost table in the job summary.
- [ ] One draft PR opened by the test generator with a **higher mutation score**, or the job summary explaining why the tests were rejected.
- [ ] One draft PR opened by the fix agent for a build you broke on purpose (or the local run of part 3), reviewed (approved or rejected) by you with a written reason.
- [ ] A draft release with AI notes for a `v*` tag.
- [ ] The three canary verdicts (healthy, regression, low traffic) of part 5.
- [ ] The injection PR of part 6 and an `ai-eval` run, with the eval table of your model.
- [ ] `results/lab13.md` with the measurement table of part 7 and your conclusion: keep, tune or remove each AI step?
- [ ] Tag the commit: `git tag lab13 && git push --tags`; [quiz](quiz.md) answered.

**Self-check before you submit:** `git status` is clean; `gh workflow list` shows the five AI workflows *active*; `gh run list --limit 20` shows at least one successful run of `AI review`, `AI tests`, `AI release notes` and `AI reviewer eval`; `git log -p | grep -c 'sk-ant-'` prints `0` (no Claude key was ever committed).

## End state

``` { .tree title="changed in lab 13" }
boxoffice/
    .github/ai/                       # new: llm.py, diffutil.py, review.py, gen_tests.py, fix_agent.py,
                                      #      release_notes.py, canary_explain.py, eval_review.py, metrics.py,
                                      #      ollama-model.sh, requirements.txt, evals/ (5 cases), canary/ (3 snapshots)
    .github/actions/ollama/action.yml # new: the free model on the runner
    .github/workflows/ai-review.yaml  ai-tests.yaml  ai-fix.yaml  ai-release-notes.yaml  ai-eval.yaml   # new
    CONVENTIONS.md                    # new
    docs/adr/0001-schema-per-service.md                                        # new
    Dockerfile.ai-tools               # new (optional live canary, step 5.4)
    k8s/catalog/analysis-explained.yaml                                        # new (optional, step 5.4)
    services/catalog/pom.xml          # replaced: lab 11 pom + PIT plugin
    services/catalog/src/test/java/boxoffice/catalog/CatalogServiceTest.java   # new
    results/lab13.md
```

This is the last lab: the same pipeline, conventions and measurements carry into the team project.

[Start with part 1: AI review](review/index.md){ .md-button .md-button--primary }
