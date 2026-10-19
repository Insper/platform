BoxOffice has twelve engineers and merges about sixty pull requests a week. A PR waits, on average, most of a working day for its first human review; the on-sale of a stadium show is in three weeks. At the planning meeting someone says the obvious thing: *"Let's put AI in the pipeline."* Two weeks later the team has a bot that leaves fifteen comments on every PR (people stopped reading them on day three), an agent that "fixed" a red build by deleting the failing test, release notes announcing a refund feature nobody built, and an invoice nobody predicted.

None of that is a problem of the models. The same tools, designed well, cut review latency, find real bugs, write useful tests and shorten incidents. The difference is **system design**: where the AI step sits in the delivery lifecycle, what context it gets, what it is allowed to do, how its output is checked, what it costs, and how the team knows whether it helps. This class applies the course's toolbox — components, failure modes, numbers, trade-offs — to **AI inside the software delivery pipeline**.

!!! abstract "Learning objectives"

    By the end of this class you should be able to:

    - **Map** AI capabilities to each stage of the delivery lifecycle (plan, code, review, test, build, release, operate) and **place** a tool on the spectrum from assistant to autonomous agent.
    - **Design** an AI pull-request reviewer: context, structured output, noise control, advisory vs gate, and how to **measure** its precision.
    - **Evaluate** AI-generated tests with mutation testing and **explain** the oracle problem, flaky-test triage and test selection.
    - **Specify** an agent that runs headless in CI with least privilege, budgets, idempotency, verification and an audit trail.
    - **Separate** decision from explanation in release and operations: risk scoring, canary analysis, incident summaries, postmortems.
    - **Threat-model** AI in the pipeline (prompt injection, secret exfiltration, slopsquatting, supply chain) and **define** a governance policy, including evaluation of the AI tools themselves.
    - **Estimate** the token, runner and attention cost of an AI step and **predict** its effect on the DORA metrics.

## Roadmap

1. **This overview** — AI across the delivery lifecycle, the autonomy spectrum, the contract of an AI step, DORA metrics and cost.
2. [Code review](code-review/index.md) — what AI review is good and bad at, context engineering, structured findings, noise control, gates, precision, architecture conformance.
3. [Testing](testing/index.md) — generated tests and mutation testing, contract and property-based tests, load scripts from OpenAPI, flaky-test triage, test selection, synthetic data, the oracle problem.
4. [Agents in CI](agents-in-ci/index.md) — fix-the-build, dependency and migration agents; headless runs; sandboxing, permissions, budgets, idempotency and audit.
5. [Release & operate](release-operate/index.md) — release notes, change risk scoring, canary analysis, incident response, postmortems, ChatOps: *AI proposes, policies and humans dispose*.
6. [Security & governance](security-governance/index.md) — prompt injection in the pipeline, exfiltration, slopsquatting, SLSA, SBOM and signing, policy as code, licensing, privacy, cost governance and evaluation of AI tools.
7. [Quiz](quiz.md) — check your understanding.

## Slides

<div class="slides-embed">
  <iframe src="slides/ai-delivery.html" title="Slides: AI-assisted delivery" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/ai-delivery.html){:target="_blank"}

---

## Prerequisites from earlier classes

This class does not repeat two foundations; read them first if needed:

- [Cloud-native — Delivery](../cloud-native/delivery/index.md): CI, GitOps with Argo CD, deployment strategies, canary analysis with Argo Rollouts, and the DORA metrics. Every AI step here **plugs into** that pipeline.
- [AI systems & agents](../ai-systems/index.md): the LLM as a dependency (tokens, latency, cost), the [LLM gateway](../ai-systems/llm-gateway/index.md), the [agent loop](../ai-systems/agents/index.md), and [safety and evals](../ai-systems/safety-evals/index.md). Here the "users" of the model are not fans but **engineers and pipelines**.

---

## AI across the delivery lifecycle

The software delivery lifecycle is a sequence of stages, each with its own inputs, outputs and failure modes. AI can help at every stage — but what "help" means, and what can go wrong, differs a lot:

| Stage | What AI does | BoxOffice example | Main risk | Control |
|---|---|---|---|---|
| **Plan** | Drafts specs, ADRs, splits work, estimates impact | Draft ADR "Redis for seat holds vs PostgreSQL" from the discussion | Confident but wrong design reasoning | Human-owned ADR, review by the architect |
| **Code** | Completes code, writes features in the IDE or as an agent | Implements `GET /catalog/events?city=` with tests | Plausible code with subtle bugs; insecure patterns; invented packages | Review, tests, SAST, dependency policy |
| **Review** | Reviews PRs: bugs, security, conventions, architecture rules | Flags `order` writing to the `inventory` schema | Noise; false sense of safety; gullible to injected text | Precision measured, advisory first, human approval |
| **Test** | Generates tests, triages flaky ones, selects what to run | Unit tests for hold expiry; picks the 40 relevant tests of 4,000 | Tests that assert bugs; skipped relevant tests | Mutation score, safety net of full runs |
| **Build** | Explains failures, proposes fixes, upgrades dependencies | Fixes a compile error after a Spring Boot upgrade | Agent bends tests to pass; excessive permissions | Sandbox, no write token, verification, draft PRs |
| **Release** | Release notes, changelogs, change risk scores | Notes for `v1.8.0` with the new Flyway migration | Invented features; wrong risk estimate | Grounding in commits; risk only *routes* reviews |
| **Operate** | Explains canaries, summarises incidents, suggests runbooks, drafts postmortems | "The canary of `inventory` fails because p99 doubled after the pool change" | Wrong diagnosis followed under stress; autonomous rollbacks | Policy decides; humans act; AI explains |

``` mermaid-sim
flowchart LR
    plan["Plan<br/>AI drafts ADR"] --> code["Code<br/>assistant / agent"]
    code --> pr["Pull request"]
    pr --> review["AI review<br/>advisory comments"]
    pr --> tests["CI tests<br/>+ AI-generated tests<br/>judged by mutation score"]
    review --> human{"Human approval<br/>(branch protection)"}
    tests --> human
    tests -->|"red build"| agent["Fix agent<br/>draft PR"]
    agent --> human
    human --> build["Build · scan · SBOM · sign"]
    build --> release["Release notes<br/>grounded draft"]
    release --> canary["Canary<br/>policy verdict + AI explanation"]
    canary --> operate["Operate<br/>AI incident summary"]
    operate -->|"postmortem draft"| plan
```

Notice the shape: the AI steps **branch off** the main path and come back through a **deterministic check or a human** before anything changes in production. That is the pattern the rest of the class elaborates.

---

## The autonomy spectrum

"AI in the pipeline" covers tools of very different autonomy. A useful scale, borrowed from how the industry talks about driving automation, is *who decides the next action and who is accountable for it*:

| Level | Name | The AI… | A human… | BoxOffice example |
|---|---|---|---|---|
| 0 | **Assistant** | answers when asked | asks, reads, decides everything | "Explain this stack trace" in a chat |
| 1 | **Copilot** | suggests inline, in context | accepts or rejects each suggestion | IDE completion while writing `HoldService` |
| 2 | **Reviewer / drafter** | produces an artifact on an event (comment, test, notes) | reviews the artifact; nothing is applied automatically | The PR reviewer and the release-notes draft |
| 3 | **Supervised agent** | plans and executes several steps with tools, in a sandbox, and **proposes** a change | approves the result (draft PR, change request) | The fix-the-build agent opening a draft PR |
| 4 | **Autonomous agent** | executes and **applies** changes within guardrails, without per-change approval | sets policies and audits afterwards | Auto-merged dependency patch upgrades with green CI |

Moving up the scale buys throughput and costs control. The right level depends on the **blast radius** of a mistake and on how **verifiable** the output is: a typo fix in docs can be level 4; a change to seat locking in `inventory` stays at level 2–3 no matter how good the model is. Accountability never moves to the tool: the engineer who merges an AI-written change owns it.

??? question "Think first: which level for each?"

    (a) Bumping `jackson-databind` from 2.18.1 to 2.18.2 in all services; (b) rewriting the `SELECT … FOR UPDATE` in `inventory`; (c) translating the error messages of `notification` to Spanish.

    (a) Level 4 is reasonable *if* CI is trustworthy: patch release, automated tests, canary — this is what Dependabot/Renovate auto-merge already does without AI. (b) Level 2 at most: concurrency bugs are hard to test, the blast radius is "double booking at 10:00". (c) Level 3: an agent can do it and open a PR, but a native speaker reviews it — correctness is not machine-verifiable.

---

## The contract of an AI step

Every AI step in a pipeline — review, test generation, fix agent, notes, canary explanation — can be designed with the same five-part contract. Writing it down for each step is the fastest way to find what is missing:

| Part | Question | Reviewer example |
|---|---|---|
| **Trigger** | Which event starts it, and which must *not*? | `pull_request` opened/synchronize; not drafts, not forks |
| **Context** | What does it read, and which of it is untrusted? | Diff (untrusted), PR text (untrusted), `CONVENTIONS.md`, ADRs |
| **Output** | What shape, and how is it validated? | JSON findings against a schema; only added lines; thresholds |
| **Action** | What does it change, with which permission? | Inline comments, `pull-requests: write`; never approves |
| **Budget & fallback** | Max time, tokens, dollars? What if the model is down or wrong? | 10 min, ~US$ 0.02; fail open (no comments) |

Two properties follow from the contract. **Least privilege**: the permission of the action is the most the step can ever do, whatever the model says. **Fail-safe direction**: decide in advance whether an AI outage blocks the pipeline (fail closed) or skips the step (fail open). Advisory steps fail open; a security gate that you rely on must fail closed — and then it must be very reliable.

---

## What happens to the DORA metrics

The DORA metrics — deployment frequency, lead time for changes, change failure rate and time to restore — are defined in [Delivery](../cloud-native/delivery/index.md#measuring-delivery-the-dora-metrics). AI changes the inputs to all four, not always in the expected direction:

- **Lead time** can fall (faster first review, faster fixes of red builds) — or rise, if PRs get bigger because code is cheap to generate and slow to review.
- **Deployment frequency** follows lead time, but only if batches stay small.
- **Change failure rate** can rise if review attention drops ("the bot looked at it") or generated code is merged without understanding; it can fall if AI review and tests catch real defects.
- **Time to restore** can fall with good incident summaries and faster diagnosis; it can rise if a confident wrong explanation sends the on-call engineer down the wrong path.

The research so far is a warning against assuming the good direction. The 2024 DORA report estimated that a 25 % increase in AI adoption was associated with a **1.5 % decrease in delivery throughput** and a **7.2 % decrease in delivery stability**, even as individuals reported higher productivity and better code and documentation quality[^1]; its authors point to larger batch sizes and weaker fundamentals as plausible causes. The 2025 DORA research describes AI as an **amplifier** of whatever the organization already is — strong platforms, small batches and good tests get stronger; weak ones get weaker[^2]. And in a 2025 randomized controlled trial, experienced open-source developers took **19 % longer** with AI tools while believing they were about 20 % faster[^3].

The engineering response is not to avoid AI but to **measure it like any other change** — with a baseline period and per-step metrics:

| Step | Leading metric | Business metric it should move |
|---|---|---|
| AI review | precision (accepted ÷ rated comments), comments per PR | time to first review, escaped defects |
| AI tests | mutation-score gain, tests kept after review | change failure rate |
| Fix agent | proposals merged ÷ proposals, turns and US$ per proposal | time a build stays red |
| Release notes | items edited or dropped by humans | time to write notes; incident diagnosis time |
| Canary explanation | explanations consistent with policy; on-call feedback | time to restore |

---

## The numbers: what an AI step costs

An AI step has three costs: **tokens** (the provider's bill), **runner minutes** (CI time), and **attention** (every comment or proposal a human must read). The first two are easy to estimate; the third is usually the largest.

The table estimates the token cost of **one review** of a typical PR and the monthly bill for BoxOffice (12 engineers, ~250 reviews per month, counting re-reviews after pushes) and for a 500-engineer organization (~20,000 reviews per month). Assumptions, all illustrative: an 8,000-token stable prefix (instructions, conventions, ADRs), 6,000 tokens of diff and PR text, 1,500 output tokens (findings plus reasoning). Prices are the providers' list prices per million tokens when this page was written — check current pricing before using them.

```python exec="1"
# Token cost of one AI review and per month. Every number is an illustrative assumption.
MODELS = {                      # US$ per 1M tokens: input, output, cached read
    "Large model (Claude Opus 5.5)": (4.00, 20.00, 0.20),
    "Mid model (Claude Sonnet 5.5)": (2.00, 10.00, 0.20),
    "Small model (Claude Haiku 4.5)": (1.00, 5.00, 0.10),
    "Local model (Ollama on the runner)": (0.0, 0.0, 0.0),
}
PREFIX, DIFF, OUT = 8_000, 6_000, 1_500   # tokens per review
WRITE = 1.25                               # cache write premium
SMALL_TEAM, BIG_ORG = 250, 20_000          # reviews per month


def review_cost(p_in, p_out, p_read, hit):
    cached = PREFIX * hit
    written = PREFIX * (1 - hit)           # a miss writes the prefix to the cache
    return (cached * p_read + written * p_in * WRITE + DIFF * p_in + OUT * p_out) / 1e6


print("| Model | US$ / review (cold cache) | US$ / review (80 % prefix hits) "
      "| US$ / month, 12 engineers | US$ / month, 500 engineers |")
print("|---|---|---|---|---|")
for name, (p_in, p_out, p_read) in MODELS.items():
    cold = review_cost(p_in, p_out, p_read, 0.0)
    warm = review_cost(p_in, p_out, p_read, 0.8)
    print(f"| {name} | {cold:.4f} | {warm:.4f} | {warm * SMALL_TEAM:,.2f} | {warm * BIG_ORG:,.0f} |")
```

What the numbers say:

- **Tokens are cheap relative to people.** Even with the largest model, a review costs cents; the 500-engineer organization pays in a month roughly what a few engineer-days cost. The expensive failure is not the bill, it is **noise**: a reviewer with 40 % precision that posts four comments on each of ~5,000 reviews a week produces about 12,000 useless comments a week — at one minute each, 200 hours — five engineers' full 40-hour weeks spent reading them.
- **Output tokens are about half the bill** for the large model, although they are a tenth of the tokens: each output token costs 5× an input token. Asking for "no praise, no restating the code" is also a cost optimization.
- **Caching the stable prefix** helps more as the prefix grows (big conventions files, many ADRs) — but only if the prefix is byte-identical across runs.
- **Local models** remove the token bill but not the cost: a CPU runner generating a few tokens per second makes the job minutes long, and lower recall means missed defects. Compare them on a golden set before choosing.
- **Runner minutes**: a review job of ~1.5 minutes on a hosted Linux runner costs on the order of one US cent at typical per-minute prices (check your CI provider) — comparable to the tokens. An agent that runs the full build three times costs far more in minutes than in tokens.

Agents behave differently: each step re-sends the growing context, so the cost grows roughly **quadratically** with the number of steps ([AI systems — the numbers](../ai-systems/index.md#numbers)). The [Agents in CI](agents-in-ci/index.md) page computes it for a fix-the-build agent.

---

## The LLM gateway is shared infrastructure

CI bots are clients of the model like the BoxOffice assistant is. At the scale of an organization they should go through the same [LLM gateway](../ai-systems/llm-gateway/index.md): one place for keys, **per-repository quotas and budgets**, model routing ("small model for release notes, large model for security review"), fallbacks when a provider is down, and cost attribution per team. Without it, every repository holds its own API key, and a runaway agent loop in one repository can exhaust the organization's rate limit during the on-sale.

Try it: open the scenario below with the `spike` profile. Imagine the spike is not fans but **a mass dependency upgrade** that triggers 300 PR reviews and 300 fix agents at once. Watch the LLM gateway's queue and error rate, then lower the per-client quota and run again: the bots slow down, the assistant's fans do not.

<div class="sdp" data-scenario="ai-assistant" data-mode="compact" data-profile="spike" data-height="520"></div>

[Open the full playground](../../../playground/index.md) to change the components yourself. The gateway component is described in the [component catalog](../../reference/components/ai/index.md#llmgw).

!!! tip "In the interview"

    *"How would you add AI code review to a 500-engineer monorepo?"* A strong answer follows the system-design framework instead of naming a tool:

    1. **Requirements**: what problems (review latency, missed classes of bugs, architecture drift)? Advisory or gating? Which languages and directories? Data that may not leave the company?
    2. **Estimates**: PRs per day (~500 engineers × ~1 PR/day ≈ 500, ×2 with re-reviews), tokens per review, cost per month (cents per review → a few thousand dollars per month at most), latency budget (comments before the human reviewer arrives, < 5 min).
    3. **Design**: trigger on PR events with path filters and `CODEOWNERS`-aware routing; context = diff + **per-directory conventions** + ADRs + ownership; structured findings; noise control (thresholds, dedup, only changed lines, cap per PR); one review per push; LLM gateway with per-team quotas; fail open.
    4. **Rollout**: shadow mode (findings logged, not posted) on a golden set and real PRs → advisory for volunteer teams → measure precision per category → gate only high-precision categories (for example secrets, SQL injection, cross-boundary calls), as a required check, never an approval.
    5. **Risks**: prompt injection from PR text, secrets in prompts, fork PRs and `pull_request_target`, model regressions — a golden-set eval in CI for every prompt or model change, and cost dashboards.

!!! warning "Common pitfalls"

    - **Adding AI to a weak pipeline**: without fast CI, good tests and small PRs, AI amplifies the weakness (the DORA warning). Fix the fundamentals first.
    - **Measuring adoption instead of outcomes**: "80 % of PRs got an AI review" says nothing; precision, escaped defects and lead time do.
    - **Letting the model decide**: approvals, merges, rollbacks and promotions belong to policies and people. The model proposes and explains.
    - **Ignoring the attention cost**: every low-value comment trains people to ignore the high-value ones.
    - **Granting broad permissions "to make it work"**: the permission of the action is the worst case of every prompt injection.

---

## The AI-assisted delivery concept map { #concept-map }

Every AI step in the pipeline is a small AI system: an orchestrator around a model, tools with permissions, a policy layer, and telemetry that says whether it helps. The map links the **palette components** (green) that reappear here to the **concepts** of this class (blue):

``` mermaid
flowchart LR
    ev["PR or pipeline event"] --> orch["orchestrator<br/>(reviewer, fix agent)"]:::comp
    orch --> llmgw["llmgw"]:::comp
    orch --> toolreg["toolreg<br/>tool allow-list"]:::comp
    orch --> safety["safety"]:::comp
    orch --> logs["logs<br/>audit trail"]:::comp
    obs["metrics · alerting"]:::comp
    orch -.- c1["autonomy levels,<br/>contract of an AI step"]:::tech
    llmgw -.- c2["per-repository quotas,<br/>routing, cost attribution"]:::tech
    toolreg -.- c3["least privilege, sandbox,<br/>draft PRs"]:::tech
    safety -.- c4["injection in PR text,<br/>slopsquatting, policy as code"]:::tech
    obs -.- c5["canary verdict by policy,<br/>AI explains"]:::tech
    obs -.- c6["DORA, reviewer precision,<br/>mutation score"]:::tech
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

| Palette component | Question it answers | Concepts | Taught in | Scenarios |
|---|---|---|---|---|
| [`orchestrator`](../../reference/components/ai/index.md#orchestrator) | Who runs the AI step, and *how far may it go*? | autonomy spectrum, the five-part contract, headless runs, budgets, idempotency, verification outside the agent | this overview · [Agents in CI](agents-in-ci/index.md) | — |
| [`llmgw`](../../reference/components/ai/index.md#llmgw) | *Which model*, under which quota, at what cost? | shared gateway, per-repository quotas, routing by task, fallbacks, prefix caching, cost attribution | this overview · [AI systems — LLM Gateway](../ai-systems/llm-gateway/index.md) | `ai-assistant` (spike profile) |
| [`toolreg`](../../reference/components/ai/index.md#toolreg) | Which tools and *permissions* does the step get? | least privilege, sandbox, tool allow-list, token scopes, privileged step that opens a draft PR | [Agents in CI](agents-in-ci/index.md) | — |
| [`safety`](../../reference/components/ai/index.md#safety) | Can *untrusted text* steer the step? | prompt injection in PRs, the lethal trifecta, exfiltration, slopsquatting, policy as code | [Security & governance](security-governance/index.md) | — |
| [`metrics`](../../reference/components/observability/index.md#metrics) · [`alerting`](../../reference/components/observability/index.md#alerting) | Did the change *make things better*, and is the release healthy? | DORA metrics, reviewer precision, mutation score, canary analysis by policy, AI incident summaries | this overview · [Release & operate](release-operate/index.md) | `observability-stack` |
| [`logs`](../../reference/components/observability/index.md#logs) | *Who changed what*, and why? | audit trail, provenance (SLSA), SBOM, signing | [Agents in CI](agents-in-ci/index.md) · [Security & governance](security-governance/index.md) | — |
| *(the CI pipeline itself)* | Is the code *correct* and faithful to the architecture? | AI review, context engineering, noise control, generated tests judged by mutation testing, test selection | [Code review](code-review/index.md) · [Testing](testing/index.md) | — |

---

## Related

- [Hands-on 13 — AI in CI/CD](../../hands-on/13/index.md): build the reviewer, the test generator with PIT, the fix agent, release notes, the explained canary, the hardening and the measurement.
- [Hands-on 11 — Delivery](../../hands-on/11/index.md) and [Hands-on 12 — AI assistant](../../hands-on/12/index.md): the pipeline and the LLM gateway this class builds on.
- [Project](../../exercises/project/index.md): the K8s + CI/CD milestone may include one AI step, measured.
- [Interview preparation](../../support/interview/index.md): the question above is a common "design a developer tool" prompt.

## Key takeaways

- AI fits every stage of delivery, but **what it may do** depends on the blast radius and the verifiability of its output: assistant → copilot → reviewer → supervised agent → autonomous agent.
- Design each AI step with the **contract**: trigger, context (trusted vs untrusted), validated output, least-privilege action, budget and fail-safe direction.
- AI changes the **DORA** inputs in both directions; research so far shows perceived and measured productivity can disagree — **measure** with baselines and per-step metrics.
- Tokens are cheap; **attention** and **wrong decisions** are expensive. Precision beats recall for anything that talks to humans.
- **AI proposes; rules and humans dispose.**

---

[^1]: DORA / Google Cloud. [Accelerate State of DevOps Report 2024](https://dora.dev/research/2024/dora-report/){target="_blank"}.
[^2]: DORA / Google Cloud. [State of AI-assisted Software Development 2025](https://dora.dev/research/2025/dora-report/){target="_blank"}.
[^3]: BECKER, J. et al. [Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/){target="_blank"}. METR, July 2025.
