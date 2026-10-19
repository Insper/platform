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

<div class="kicker">System Architecture · Insper</div>

# AI-Assisted Delivery

**AI proposes; rules and humans dispose**

<!--
Outline: (1) AI across the lifecycle and the autonomy spectrum; (2) the contract of an AI step,
DORA and cost; (3) code review; (4) testing; (5) agents in CI; (6) release and operations;
(7) security and governance.
-->

---

## "Let's put AI in the pipeline"

<div class="q">

Two weeks later BoxOffice has: 15 bot comments per PR, an agent that deleted a failing test, release notes announcing a feature nobody built, and a surprise invoice. What went wrong?

</div>

* Not the models: the **system design** around them.
* Where the step sits, what it reads, what it may do, how its output is checked, what it costs, how we know it helps.

---

<!-- _class: tight -->

## AI across the delivery lifecycle

| Stage | AI does | Main risk | Control |
|---|---|---|---|
| Plan | drafts ADRs, specs | confident wrong reasoning | human-owned ADR |
| Code | writes code | subtle bugs, invented packages | review, tests, dependency policy |
| Review | comments on PRs | noise, gullibility | measured precision, human approval |
| Test | generates, triages, selects | tests that protect bugs | mutation score, full-suite safety net |
| Build | fixes red builds | bends tests, broad permissions | sandbox, verification, draft PR |
| Release | notes, risk scores | invented features | grounding, drafts |
| Operate | explains canaries, incidents | wrong diagnosis, auto-actions | policy decides, AI explains |

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

| Part | Reviewer example |
|---|---|
| **Trigger** | PR opened/synchronize; not drafts, not forks |
| **Context** | diff, PR text (**untrusted**), conventions, ADRs |
| **Output** | JSON findings, schema-validated, added lines only |
| **Action** | inline comments, `pull-requests: write`, never approve |
| **Budget & fallback** | 10 min, ~US$ 0.02, fail open |

- The **permission** of the action is the worst case of any prompt injection.

---

## DORA: measure, do not assume

- 2024 DORA: +25 % AI adoption ≈ **−1.5 % throughput, −7.2 % stability** (est.), despite individual gains.
- 2025 DORA: AI is an **amplifier** of the organization you already are.
- METR 2025 RCT: experienced developers **19 % slower**, believing they were ~20 % faster.

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

- Tokens are cheap; **attention** is not: 40 % precision × 4 comments × 5,000 reviews/week = weeks of engineers reading noise.

---

## Code review: context engineering

- **Diff with line numbers** (`L21 + …`): models cannot count lines.
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
- **Test selection**: static, coverage-based or predictive — 95 % recall saves hours of CI per day *if* the full suite runs on `main` or nightly.
- **Synthetic data**: generated once, reviewed, frozen; never production data in prompts (LGPD).

---

## Agents in CI: the orchestrator is the product

- Fix the build · dependency upgrades · migrations (codemod first, agent for the long tail) · issue → PR.
- Headless: `claude -p` with `--bare`, `--allowedTools "Read,Edit,Bash(mvn -B *)"`, `--permission-mode dontAsk`, `--max-turns`, `--max-budget-usd`; or `claude-code-action@v1`; or your own loop.
- Agent job: read-only token, no secrets but a spend-limited key → **patch** → verified → separate job opens a **draft PR**.

---

## Agents in CI: budgets, idempotency, audit

| Concern | Control |
|---|---|
| Quadratic cost in turns | prompt caching; turn and US$ caps in the harness |
| Repeated events | idempotency key = commit SHA; one proposal per SHA |
| Loops | never run on `ai-fix/*`; `GITHUB_TOKEN` pushes do not trigger CI |
| "I fixed it" | independent verification: paths, no test removed, build green |
| Accountability | transcript artifact, commit trailer, PR label, human of record |

---

## Release & operate: decide vs explain

- **Release notes**: grounded — every item cites a real SHA/PR; published as draft.
- **Risk score**: structural signals + AI semantics; only **routes** scrutiny (extra reviewer, slow canary).
- **Canary**: thresholds and statistics decide; the model **repeats** the verdict and explains, or is discarded.
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

<p class="small">Nx s1ngularity (Aug 2025): <code>pull_request_target</code> + PR title in <code>run:</code> → stolen token → malware that drove local AI CLIs to hunt secrets.</p>

---

## Supply chain and governance

- **Slopsquatting**: hallucinated packages (≥ 5.2 % commercial, 21.7 % open models in a 2025 study) → dependency review, registry proxy, policy.
- **SBOM + signing + provenance** (SLSA), verified at deploy; **AI authorship** in trailers and labels.
- **Policy as code**: Conftest/OPA on workflows — permissions declared, no `${{ github.event }}` in `run:`, actions pinned by SHA.
- **Privacy & IP**: redact logs, no production data, retention settings, license scanning.
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
2. Every AI step has a **contract**: trigger, context, validated output, least-privilege action, budget.
3. **Precision beats recall** for anything that talks to humans; measure it.
4. Generated tests are judged by **mutation score**; the oracle stays human.
5. Agents live inside a deterministic **orchestrator**: no write token, budgets, verification, drafts, audit.
6. **Policies decide, AI explains** — in canaries, risk and incidents.
7. Break the **lethal trifecta**; secure the supply chain; **evaluate** the AI tools continuously.
