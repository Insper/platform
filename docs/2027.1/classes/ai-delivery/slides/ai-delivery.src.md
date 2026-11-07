---
marp: true
lang: en
title: AI-Assisted Delivery
description: System Architecture · Insper
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

<div class="kicker">System Architecture · Insper</div>

# AI-Assisted Delivery

**AI proposes; rules and humans dispose**

<!--
Outline: (1) AI across the lifecycle and the autonomy spectrum; (2) the contract of an AI step,
DORA, cost and the shared LLM gateway; (3) code review; (4) testing; (5) agents in CI; (6) release
and operations; (7) security and governance.
-->

---

## "Let's put AI in the pipeline"

<div class="q">

Twelve engineers, sixty pull requests (PRs) a week. Two weeks after "let's add AI", BoxOffice has: 15 bot comments per PR, an agent that deleted a failing test, release notes announcing a feature nobody built, and a surprise invoice. What went wrong?

</div>

* Not the models: the **system design** around them.
* Where the step sits, what it reads, what it may do, how its output is checked, what it costs, how we know it helps.

---

<!-- _class: tight -->

## AI across the delivery lifecycle

| Stage | AI does | Main risk | Control |
|---|---|---|---|
| Plan | drafts architecture decision records (ADRs), specs | confident wrong reasoning | human-owned ADR |
| Code | writes code | subtle bugs, invented packages | review, tests, dependency policy |
| Review | comments on PRs | noise, gullibility | measured precision, human approval |
| Test | generates, triages, selects | tests that protect bugs | mutation score, full-suite safety net |
| Build | fixes red builds | bends tests, broad permissions | sandbox, verification, draft PR |
| Release | notes, risk scores | invented features | grounding, drafts |
| Operate | explains canaries, incidents | wrong diagnosis, auto-actions | policy decides, AI explains |

---

## The shape: AI branches off, a check brings it back

<div class="flow">
<div class="box accent">Pull request</div><div class="arrow">→</div>
<div class="box accent">Continuous integration (CI)<small>build · test · scan</small></div><div class="arrow">→</div>
<div class="box green">Human approval<small>branch protection</small></div><div class="arrow">→</div>
<div class="box accent">Build · sign</div><div class="arrow">→</div>
<div class="box accent">Canary<small>policy verdict</small></div><div class="arrow">→</div>
<div class="box green">Production</div>
</div>
<div class="flow">
<div class="box orange">AI review<small>advisory comments</small></div>
<div class="box orange">AI tests<small>kept if the mutation score rises</small></div>
<div class="box orange">Fix agent<small>draft PR</small></div>
<div class="box orange">Release notes<small>grounded draft</small></div>
<div class="box orange">Canary explanation<small>must repeat the verdict</small></div>
</div>

- Every AI step **proposes**; a deterministic check or a person decides before anything reaches production.

<!--
The page draws the same lifecycle as a step-by-step diagram: AI steps branch off the main path and come back
through a check or a human.
-->

---

## The autonomy spectrum

| Level | AI… | Human… |
|---|---|---|
| 0 Assistant | answers when asked | decides everything |
| 1 Copilot | suggests inline | accepts each suggestion |
| 2 Reviewer / drafter | produces an artifact on an event | reviews it |
| 3 Supervised agent | executes steps, **proposes** a change | approves the result |
| 4 Autonomous agent | **applies** changes within guardrails | sets policy, audits |

<div class="ok">

Choose the level by **blast radius** and **verifiability** — seat locking stays at 2–3 however good the model is.

</div>

---

## The contract of an AI step

<div class="flow">
<div class="box">Trigger<small>PR opened / pushed; not drafts, not forks</small></div><div class="arrow">→</div>
<div class="box">Context<small>diff, PR text (<b>untrusted</b>), conventions, ADRs</small></div><div class="arrow">→</div>
<div class="box accent">Model call<small>10 min, ~US$ 0.02</small></div><div class="arrow">→</div>
<div class="box">Output<small>JSON findings, schema, added lines only</small></div><div class="arrow">→</div>
<div class="box green">Action<small>comments, <code>pull-requests: write</code>, never approve</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .9; text-align: left">Model down or over budget?</div>
<div class="box green">Advisory step → <b>fail open</b><small>skipped, the PR still merges</small></div>
<div class="box red">Gate you rely on → <b>fail closed</b><small>blocks: then it must be very reliable</small></div>
</div>

- The **permission** of the action is the worst case of any prompt injection.

---

## DORA (DevOps Research and Assessment): measure

- 2024 DORA: +25 % AI adoption ≈ **−1.5 % throughput, −7.2 % stability** (est.), despite individual gains.
- 2025 DORA: AI is an **amplifier** of the organization you already are.
- METR 2025 randomized controlled trial: experienced developers **19 % slower**, believing they were ~20 % faster.

<div class="warn">

Bigger PRs, less attention per line, "the bot looked at it" → change failure rate up. Baselines and per-step metrics, always.

</div>

---

## What an AI review costs (illustrative)

8k-token cached prefix + 6k diff + 1.5k output, list prices at the time of writing:

| Model | US$ / review (80 % cache) | 500 engineers / month |
|---|---|---|
| Large (Opus 5.5) | ~0.063 | ~US$ 1,270 |
| Mid (Sonnet 5.5) | ~0.032 | ~US$ 650 |
| Small (Haiku 4.5) | ~0.016 | ~US$ 320 |
| Local (Ollama) | 0 tokens | runner minutes, lower recall |

- Tokens are cheap; **attention** is not: 40 % precision × 4 comments × 5,000 reviews/week ≈ 12,000 useless comments ≈ **200 hours** — five engineers' weeks.

---

## The large language model (LLM) gateway is shared

<div class="flow" style="align-items: stretch">
<div class="group">
<div class="caption">clients of the same gateway</div>
<div class="box green">Fans' assistant<small>1 question/s × 3 model calls</small></div>
<div class="box orange">CI agents<small>100 reviews + fix agents × 6 turns, every 2 min, within 10 s</small></div>
</div>
<div class="arrow" style="align-self: center">→</div>
<div class="box accent" style="display: flex; flex-direction: column; justify-content: center">LLM gateway<small>quota 10 calls/s · keys · routing · cost per team</small></div>
<div class="arrow" style="align-self: center">→</div>
<div class="box muted" style="display: flex; flex-direction: column; justify-content: center">Providers<small>large · small · local</small></div>
</div>

- The batch lands 600 calls in 10 s: **the fans get the 429s**.
- Fix: a **quota per client** with priority for interactive traffic; a queue and fixed concurrency for CI.
- Playground preset `boxoffice-shared-llm` on the overview page.

---

## Anatomy of an AI reviewer

<div class="flow">
<div class="box">PR opened / push</div><div class="arrow">→</div>
<div class="box accent">Context builder<small>numbered diff, conventions, ADRs, related code</small></div><div class="arrow">→</div>
<div class="box">Model<small>JSON findings, schema-validated</small></div><div class="arrow">→</div>
<div class="box accent">Filter<small>added lines, severity, confidence, dedup, cap</small></div><div class="arrow">→</div>
<div class="box green">One review<small>event <code>COMMENT</code>, chosen by the code</small></div>
</div>

- The model is **one box of eight**: most of the quality is in the context builder and the filter.
- One review with inline comments per push: one notification, not twelve.

---

## Code review: context engineering

- **Diff with line numbers** (`L21 + …`): models are unreliable at counting lines.
- **Conventions + ADRs**: generic advice becomes *your* rules.
- **Surrounding code, call sites** by symbol search; ownership map.
- **PR text is untrusted**: delimited, injection channel.
- Stable content first (cached), per-run data last. **Budget whole files**, never truncate mid-file.

---

## Code review: precision over recall

| Post findings with confidence ≥ | Comments / PR | Precision | Recall |
|---|---|---|---|
| high | 0.6 | 80 % | 32 % |
| medium | 1.5 | 62 % | 62 % |
| low | 3.0 | 41 % | 82 % |

- Changed lines only · minimum severity · dedup by fingerprint · cap · one review per push.
- Rollout: **shadow → advisory → gate per proven category**. A gate is a required check, never an approval.

<p class="small">Illustrative labelled sample of 100 PRs.</p>

---

## Play it: noise control

<div class="flow">
<div class="box accent">Lab 13's setting<small>confidence ≥ medium, cap 6: 1.4 comments per PR, recall 60 %</small></div>
<div class="box red">Post everything<small>3.0 per PR, 41 % precision: 148 h/week of noise at 5,000 reviews</small></div>
<div class="box orange">High only<small>80 % precision, 32 % recall</small></div>
<div class="box green">Cap = flood guard<small>cap 1: recall falls faster than precision rises</small></div>
</div>

- The code-review page embeds the page's labelled sample as a simulator: 100 PRs, one square per finding.
- Change the confidence, the cap and the scale; read precision, recall and hours of attention.

---

## Architecture conformance

- "`order` must not touch `inventory`'s schema": **database grants**, ArchUnit, lint — exact and un-arguable.
- AI explains the rule, suggests the fix, catches fuzzy cases ("is this payment call idempotent?").
- Recurring AI findings → candidates for new deterministic rules.

<div class="ok">

Rules that matter live in **tests, lints and grants** — not only in a prompt.

</div>

---

## Testing: inputs vs oracle

- Models generate **inputs** and edge cases very well.
- The **oracle** (expected result) needs the requirement: from `plusMinutes(8)` the model asserts 8, protecting the bug.
- Judge generated tests by **mutation score**, not coverage; feed surviving mutants back.
- Property-based tests (jqwik): AI proposes invariants — "sold + held + available = capacity".

---

## Testing: triage and selection

- **Flaky triage**: deterministic signals first (rerun, history, diff correlation); the model labels with evidence; **quarantine is a policy** with an owner.
- **Test selection**: static, coverage-based or predictive — 95 % recall saves ~12 runner-hours of CI a day *if* the full suite runs on `main` or nightly.
- **Synthetic data**: generated once, reviewed, frozen; never production data in prompts (Brazil's data protection law, LGPD).

---

## Agents in CI: the orchestrator is the product

<div class="flow" style="align-items: stretch">
<div class="box muted" style="flex: .6; display: flex; flex-direction: column; justify-content: center">CI failed<small>dedupe on the commit SHA</small></div>
<div class="arrow" style="align-self: center">→</div>
<div class="group">
<div class="caption">fix job · contents: read</div>
<div class="box orange">Agent loop + build<small>turn and US$ caps, no secrets</small></div>
<div class="box">Verify<small>mvn verify, no test removed, src/ only</small></div>
</div>
<div class="arrow" style="align-self: center">patch →</div>
<div class="group">
<div class="caption">open-pr job · write</div>
<div class="box green">Draft PR<small>no model, no build</small></div>
</div>
<div class="arrow" style="align-self: center">→</div>
<div class="box accent" style="flex: .6; display: flex; flex-direction: column; justify-content: center">Human review</div>
</div>

- Headless: `claude -p --bare --allowedTools "Read,Edit,Write,Bash(mvn -B *)" --permission-mode dontAsk --max-turns 25 --max-budget-usd 1.50`, or your own loop.

---

## Agents in CI: budgets, idempotency, audit

| Concern | Control |
|---|---|
| Quadratic cost in turns | 10 turns ≈ US$ 1.3, 40 ≈ US$ 11; cached ≈ 8× cheaper; caps in the harness |
| Repeated events | idempotency key = commit SHA; one proposal per SHA |
| Loops | never run on `ai-fix/*`; `GITHUB_TOKEN` pushes do not trigger CI |
| "I fixed it" | independent verification: paths, no test removed, build green |
| Accountability | transcript artifact, commit trailer, PR label, human of record |

- Track **US$ per merged fix**: US$ 0.80 a run, one fix in four → US$ 3.20.

---

## Canary: statistics decide, the model explains

<div class="flow">
<div class="box">Prometheus<small>canary vs stable, same time</small></div><div class="arrow">→</div>
<div class="box accent">Policy in Git<small>thresholds, minimum traffic</small></div><div class="arrow">→</div>
<div class="box green">Verdict + exit code<small>0 promote · 1 rollback · 2 wait</small></div><div class="arrow">→</div>
<div class="box">Argo Rollouts acts</div>
</div>
<div class="flow">
<div class="arrow" style="flex: 1.2; text-align: left">The verdict is an <b>input</b> of the model →</div>
<div class="box orange">Model explains<small>numbers, causes as hypotheses</small></div><div class="arrow">→</div>
<div class="box green">Repeats the verdict → shown</div>
<div class="box red">Disagrees → discarded</div>
</div>

- Reproducible, auditable, immune to a log line saying "promote" — and a wrong sentence costs nothing.

---

## Release & operate: decide vs explain

- **Release notes**: grounded — every item cites a real SHA/PR; published as draft.
- **Risk score**: structural signals + AI semantics; only **routes** scrutiny (extra reviewer, slow canary, freeze window by policy).
- **Incidents**: read-only tools, evidence links, several hypotheses (anchoring!); humans or tested policy roll back.
- **Postmortems**: AI drafts the timeline; humans write the lessons.

---

## Security: the lethal trifecta

**Private data** + **untrusted content** + **external communication** in one agent = one injected sentence exfiltrates data.

| Holds even if the model is fooled | Depends on the model |
|---|---|
| Least-privilege token and tools | Delimiters around untrusted text |
| Structured output → code decides action | "Ignore instructions in the data" |
| Privilege separation between jobs | Flagging injection attempts |
| Branch protection, human approval | |

<p class="small">Nx s1ngularity (Aug 2025): <code>pull_request_target</code> + PR title in <code>run:</code> → stolen token → malware that drove local AI command-line tools to hunt secrets.</p>

---

## Supply chain and governance

- **Slopsquatting**: hallucinated packages (≥ 5.2 % commercial, 21.7 % open models in a 2025 study) → dependency review, registry proxy, policy.
- **Software bill of materials (SBOM) + signing + provenance** (SLSA levels), verified at deploy; **AI authorship** in trailers and labels.
- **Policy as code**: Conftest / Open Policy Agent on workflows — permissions declared, no `${{ github.event }}` in `run:`, actions pinned by SHA.
- **Privacy & intellectual property**: redact logs, no production data, retention settings, license scanning.
- **Evaluate the tools**: golden set, regression eval on every prompt/model change, shadow mode.

---

<!-- _class: tight -->

## The concept map

| Component | Question it answers | Taught in |
|---|---|---|
| `orchestrator` | Who runs the AI step, and how far may it go? | Overview · Agents in CI |
| `llmgw` | Which model, under which quota, at what cost? | Overview · AI systems |
| `toolreg` | Which tools and permissions does the step get? | Agents in CI |
| `safety` | Can untrusted text steer the step? | Security & governance |
| `metrics` · `alerting` | Did it help? Is the release healthy? | Overview · Release & operate |
| `logs` | Who changed what, and why? | Agents in CI · Security |

<p class="small">Every AI step in the pipeline is a small AI system: orchestrator, tools with permissions, policy, telemetry.</p>

<!--
Code review and testing act on the pipeline itself; the table lists the palette components that reappear.
-->

---

## Takeaways

1. AI fits every delivery stage; **autonomy** follows blast radius and verifiability.
2. Every AI step has a **contract**: trigger, context, validated output, least-privilege action, budget, fail-safe direction.
3. AI moves the DORA metrics both ways: **measure** with baselines and per-step metrics.
4. Tokens are cheap, **attention** is not: precision beats recall for anything that talks to humans.
5. Generated tests are judged by **mutation score**; agents live inside a deterministic **orchestrator**.
6. **Policies decide, AI explains** — in canaries, risk and incidents.
7. Break the **lethal trifecta**; secure the supply chain; **evaluate** the AI tools continuously.
