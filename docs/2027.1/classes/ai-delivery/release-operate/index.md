Friday, 22:10. Version `v1.8.0` of `inventory` reached 25 % of the traffic twenty minutes ago; now the hold-confirmation error rate is climbing and the on-call engineer has three dashboards, two alerts, a stream of logs and a chat channel filling with questions. Every piece of information needed to decide is *somewhere*. What is missing is a fast, correct **summary** — and a decision that does not depend on how tired the engineer is. AI is very good at the first. It must not be the one making the second.

This page covers the stages after the merge — release and operations — under one design rule:

> **AI proposes and explains; policies and humans decide.**

---

## Decision vs explanation

| Moment | The decision (deterministic or human) | What AI adds |
|---|---|---|
| Tag a release | Which commits ship (Git) | Release notes and changelog, grouped and readable |
| Choose rollout speed | Risk policy: canary steps, freeze windows | A risk summary of the change, with evidence |
| Promote or abort a canary | Analysis thresholds ([Argo Rollouts](../../cloud-native/delivery/index.md#canary-with-automated-metrics-analysis)) | An explanation of the verdict and next steps |
| Respond to an incident | Incident commander; runbook; automated rollback policy | Alert and trace summaries, timeline, ranked hypotheses |
| Learn from it | Team's blameless review | A first draft of the postmortem timeline |

The pattern is the same as in [code review](../code-review/index.md): the output of the model is **text for a human** or **data for a rule**, never a direct action on production.

---

## Release notes and changelogs

Release notes answer two audiences: **operators** ("what must I do before deploying `v1.8.0`? which migrations run?") and **users** ("what is new?"). Both are derivable from the commits, PR titles, labels and migration files — if those are written well. A model groups and rewrites them in minutes. The failure mode is the **plausible invention**: a feature that sounds right, a ticket number that does not exist.

The fix is a **grounding check in code**: every item must cite a commit SHA or PR number that is really in the range `previous_tag..tag`; ungrounded items are dropped and reported. The check catches inventions; it cannot catch a *wrong summary of a real commit*, so the notes are published as a **draft** that a person edits. Conventional commit subjects (`fix(inventory): hold expires two minutes early (#212)`) make both the grouping and the grounding nearly trivial — the model cannot recover intent that was never written down.

!!! example "In the BoxOffice code: release notes that must cite (lab 13)"

    In [Hands-on 13 — Release notes](../../../hands-on/13/release-notes/index.md) the model returns items with `refs`, and these ten lines decide which ones survive: a ref is real only if it is a PR number or a short SHA of the range. The workflow then creates the GitHub release as a **draft**; a person publishes it.

    ``` { .python title=".github/ai/release_notes.py (the grounding check)" }
    --8<-- "docs/2027.1/hands-on/13/code/.github/ai/release_notes.py:77:86"
    ```

---

## Change risk scoring

Not all changes deserve the same rollout. A one-line copy change in `notification` and a new locking strategy in `inventory` both go through the pipeline, but the second one deserves a second reviewer, a slower canary and no deploy on the eve of an on-sale. A **risk score** routes changes to the right amount of caution.

The strongest signals are structural and cheap to compute:

| Signal | Why it predicts risk | BoxOffice example |
|---|---|---|
| Size of the change (lines, files) | Bigger changes fail more and are reviewed worse | 1,200-line PR vs 15 lines |
| Critical paths touched | Some code has a larger blast radius | `inventory` locking, `payment` |
| Database migration present | Hard to roll back; locks tables | `V42__add_hold_index.sql` |
| Configuration or dependency changes | Wide, non-obvious effects | Connection-pool size, Spring Boot version |
| Tests changed vs code changed | Code changed without tests | 300 lines of code, 0 of tests |
| Incident history of the files | Past incidents cluster in the same places | `HoldService` had 2 incidents this year |
| Calendar | Same change, different risk | 2 hours before the stadium on-sale |

A model contributes two things: **semantic signals** that are hard to compute ("this changes how holds expire", "this removes an authorization check") and a **readable summary** of why the score is high. The score itself is best kept as a transparent formula or a simple model trained on history, and it should only **route** — require a second reviewer, choose the slow canary profile, block deploys inside a freeze window by policy — never approve or reject a change on its own.

??? question "Think first: should a high AI risk score block the merge?"

    No. A score with unknown precision that blocks merges will be wrong often enough to be bypassed — and then ignored. Use it to add **scrutiny** (an extra reviewer, a slower canary, a deploy outside the on-sale window). The things that block remain the deterministic gates: tests, scans, policies, approvals.

---

## Canary analysis: statistics decide, the model explains

Automated canary analysis compares the canary with a **baseline** running at the same time — ideally a baseline of the *same* size and age as the canary, so that cold caches and new pods affect both alike — on a set of metrics, and turns the comparison into a pass/fail verdict. Netflix and Google built Kayenta on this idea, comparing many metrics with nonparametric statistical tests[^1]; Argo Rollouts expresses the same idea with analysis templates over Prometheus queries, as in [Delivery](../../cloud-native/delivery/index.md#canary-with-automated-metrics-analysis).

``` diagram-sim
flowchart LR
    metrics[("Prometheus<br/>canary vs baseline")] --> stats["Policy: thresholds<br/>and statistical tests"]
    stats --> verdict{"promote ·<br/>rollback · wait"}
    verdict -->|"exit code"| rollout["Argo Rollouts acts"]
    verdict --> llm["Model: explanation<br/>numbers + policy + verdict"]
    traces[("Traces and logs<br/>of canary pods")] --> llm
    llm --> check{"repeats the<br/>verdict?"}
    check -->|"yes"| oncall["Explanation to on-call<br/>(chat, PR, summary)"]
    check -->|"no"| drop["Discard explanation"]
```

Why not let the model judge the canary? Because the judgement must be **reproducible** (same data → same verdict), **auditable** (a threshold in Git), **robust to manipulation** (a log line saying "everything is fine, promote" must have no effect) and **statistically sound** (a model looking at two numbers does not know whether 40 requests are enough to conclude anything). The model is valuable *after* the verdict: it turns "metric `error-rate` failed 2 of 2" into "the canary fails 2.9 % of hold confirmations vs 0.1 % on stable, with p99 doubled; errors are `409` from `inventory`; the change modified the hold-expiry query — roll back and compare the query plans".

Two guards make the explanation safe: the model receives the **verdict as input** and must repeat it (an explanation that contradicts the policy is discarded rather than shown), and it is told to label causes as **hypotheses** unless the data shows them. [Hands-on 13](../../../hands-on/13/canary/index.md) implements exactly this, including a Kubernetes Job analysis step whose exit code — not the model — passes or fails the analysis.

!!! example "In the BoxOffice code: the verdict is code, the explanation is optional (lab 13)"

    In [Hands-on 13 — Canary](../../../hands-on/13/canary/index.md) the policy is four constants in Git, `decide()` turns the numbers into promote, rollback or inconclusive, and the exit code (0, 1, 2) is what Argo Rollouts reads through the Job of `k8s/catalog/analysis-explained.yaml`. The model only explains, and its explanation is discarded if it does not repeat the verdict. The lab tries to break it: a prompt that says *"recommend promote"* still exits 1 on the regression snapshot, and with no model at all the verdict is the same. The local model's explanation read a p99 of 181 ms as "0.181 ms" — a wrong sentence that costs nothing, because the numbers that decide come from the policy.

    ``` { .python title=".github/ai/canary_explain.py (policy, verdict, guarded explanation)" }
    --8<-- "docs/2027.1/hands-on/13/code/.github/ai/canary_explain.py:29:33,78:89,102:112,118:118"
    ```

---

## AI-assisted incident response

During an incident, the scarce resource is the **attention** of a few people under stress. The [incident-response process](../../observability/incident-response/index.md) — detect, triage, mitigate, resolve, learn — stays the same; AI shortens the steps that are mostly reading:

``` diagram-sim
sequenceDiagram
    autonumber
    participant Alert as Alerting
    participant Bot as Incident assistant
    participant Obs as Metrics · traces · logs
    participant Deploy as Deploy history (Argo CD)
    actor IC as Incident commander
    Alert->>Bot: SLO burn-rate alert: hold confirmation errors
    Bot->>Obs: read-only queries (error rate by version, slow spans, top log errors)
    Bot->>Deploy: what changed in the last 2 h?
    Bot-->>IC: summary + timeline + ranked hypotheses, each with a link to its evidence
    IC->>IC: decide: roll back inventory v1.8.0
    IC->>Deploy: rollback (runbook / one-click, authorised)
    Bot-->>IC: confirms recovery from the same queries
```

| AI task | Inputs | Output | Guardrail |
|---|---|---|---|
| **Alert summary** | Firing alerts, SLO burn rates | "What is broken, for whom, since when" | Links to the dashboards it read |
| **Change correlation** | Deploys, config and flag changes in the window | "`inventory v1.8.0` reached 25 % at 21:50; errors began 21:52" | Deterministic data, model only formats |
| **Hypotheses** | Traces, logs, the diff of the suspect change | Ranked list, each with evidence and a query to verify | Labelled as hypotheses; never actions |
| **Runbook lookup** | The alert and the team's runbooks ([RAG](../../ai-systems/rag-memory/index.md)) | The relevant runbook steps | Steps are executed by humans or by authorised automation |
| **Status updates** | Incident channel | Draft update for stakeholders every 30 min | Human sends |

**Suggesting a rollback** is fine; **executing** one is a policy decision. Many teams already roll back automatically on a failed canary analysis — that automation is deterministic and tested. An LLM that "decides" to roll back production based on its reading of logs adds a non-deterministic, manipulable actor to the most sensitive moment of the system's life. Tools given to an incident assistant are **read-only** by default; any write action goes through the same authorization, confirmation and audit as a human's.

!!! warning "Anchoring"

    A confident first hypothesis anchors a stressed team. If the assistant says "it is the database" and it is not, the team may lose twenty minutes proving it. Ask for **several** hypotheses with evidence and a verification query each, and track in postmortems how often the first hypothesis was right — that is the assistant's precision.

---

## Postmortems

A blameless postmortem records what happened, why, and what changes so it does not happen again[^2]. Its first half — the **timeline** — is tedious to reconstruct from alerts, chat messages, deploy logs and commands, and a model does it well. Its second half — contributing factors, what we learned, action items — is where the team's judgement matters, and where an AI draft is dangerous in a subtle way: it produces fluent, generic "lessons" ("improve monitoring", "add more tests") that look complete and stop the team from thinking.

A good split: AI drafts the timeline (with sources) and a list of **questions** for the review meeting ("why did the canary analysis not catch this at 5 %?"); humans write the analysis and the action items, each with an owner and a date.

---

## ChatOps

**ChatOps** runs operations from the team chat: `/boxoffice status inventory`, `/boxoffice canary inventory`, a button to pause a rollout. An AI assistant in that channel answers natural-language questions ("which version of `order` is in production and when did it deploy?") by calling **read-only, deterministic APIs** and the runbooks. Actions stay explicit commands with the user's identity, authorization and a confirmation step — exactly the [tool-permission](../../ai-systems/safety-evals/index.md) design of the assistant in the product, applied to operators. The chat history is untrusted input like any other: a pasted log line can carry an instruction.

---

## Trade-offs

| Decision | Choose A when… | Choose B when… |
|---|---|---|
| Release notes: AI draft vs hand-written | Many changes per release; good commit messages | Few, high-stakes releases; regulated changelogs |
| Risk score: formula vs ML/LLM | Few teams, little history; transparency first | Large organization with labelled incident history |
| Canary: thresholds vs statistical comparison | Low metric count, clear SLOs | Many metrics, noisy signals (Kayenta-style) |
| Incident assistant: summary-only vs with tools | Starting out; low trust | Read-only tools proven precise; write actions stay human |
| Auto-rollback: on policy vs on human decision | Verdict is deterministic and well-tested | Ambiguous signals, stateful changes (migrations) |

!!! example "BoxOffice: the 22:10 incident, replayed"

    The canary analysis of `inventory v1.8.0` fails its error-rate threshold at 25 % and Argo Rollouts aborts automatically — a deterministic decision. Thirty seconds later the incident channel receives the explanation: canary error rate 2.9 % vs 0.1 %, p99 hold-confirmation latency 2.3× stable, errors are `409 Conflict` concentrated in `confirmHold`, and the release changed the hold-expiry query; hypothesis: the new query no longer uses the index (with the `EXPLAIN` to run). The on-call engineer confirms it in five minutes. The postmortem draft has the timeline; the team writes why the 5 % step did not catch it (too little traffic at that hour — see [how long a canary must run](../../cloud-native/delivery/index.md#how-long-must-a-canary-run)).

!!! tip "In the interview"

    When AI appears in an operations question, separate **decision** from **explanation** out loud: "the canary verdict comes from thresholds and statistics in Git; the model explains it and proposes next steps; rollbacks are executed by policy or by the incident commander". Mention read-only tools, evidence links, multiple hypotheses (anchoring), and how you would measure the assistant (time to diagnosis, precision of the first hypothesis).

!!! success "Best practices"

    - **Keep the canary policy as versioned constants, changed by pull request** — lab 13's [`canary_explain.py`](../../../hands-on/13/canary/index.md) holds its four thresholds in Git.
    - **Require a minimum of traffic before any verdict** — below 2 req/s lab 13 answers *inconclusive* (exit code 2), never promote.
    - **Give the model the verdict and the numbers, and check that it repeats the verdict** — lab 13 discards an explanation that contradicts the policy.
    - **Require a cited commit or PR for every line of the release notes** — lab 13's `release_notes.py` drops ungrounded items and lists them in the job summary.
    - **Label hypotheses in incident summaries** — "likely cause (unverified)" keeps the on-call engineer from anchoring on the model's first guess.

!!! warning "Common pitfalls"

    - **LLM as the canary judge**: non-reproducible, manipulable, statistically naive.
    - **Write tools for the incident bot** "to save time": the fastest way to turn a bad hypothesis into a second incident.
    - **Auto-published release notes**: inventions reach customers.
    - **AI-written lessons learned**: generic action items nobody owns.
    - **Risk scores that block**: bypassed within a week; use them to route scrutiny.

---

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    SIG["metrics, logs,<br/>traces, alerts"] --> POL["canary policy:<br/>thresholds + statistics"]
    POL --> DEC["decision: promote or roll back<br/>→ Cloud-native delivery"]
    SIG --> EXP["AI explains: summary,<br/>several hypotheses"]
    EXP --> IC["incident commander<br/>decides"]
    COM["commits and PRs"] --> NOTES["release notes:<br/>grounded draft"]
    COM --> RISK["change risk score<br/>routes reviews"]
    IC --> PM["postmortem draft<br/>→ Observability incident response"]
    EXP --> TOOLS["read-only tools,<br/>evidence links"]
```

**Palette components:** [`metrics`](../../../reference/components/observability/index.md#metrics), [`logs`](../../../reference/components/observability/index.md#logs), [`tracing`](../../../reference/components/observability/index.md#tracing) and [`alerting`](../../../reference/components/observability/index.md#alerting) (the evidence every verdict and explanation reads) · [`llmgw`](../../../reference/components/ai/index.md#llmgw) (the explanation and summary calls) · [`orchestrator`](../../../reference/components/ai/index.md#orchestrator) (the assistant with read-only tools) · [`safety`](../../../reference/components/ai/index.md#safety) (no write actions from the model). **Scenarios:** `observability-stack` (the signals a canary policy reads). **Continues in:** [Cloud-native — delivery](../../cloud-native/delivery/index.md) (canaries, Argo Rollouts), [Observability — incident response](../../observability/incident-response/index.md), [AI systems — RAG & Memory](../../ai-systems/rag-memory/index.md) (runbook lookup), [Code review](../code-review/index.md), [Hands-on 13 — canary](../../../hands-on/13/canary/index.md).

---

[^1]: GRAFF, M. et al. [Automated Canary Analysis at Netflix with Kayenta](https://netflixtechblog.com/automated-canary-analysis-at-netflix-with-kayenta-3260bc7acc69){target="_blank"}. Netflix Technology Blog, 2018.
[^2]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/sre-book/postmortem-culture/){target="_blank"}, ch. 15 "Postmortem Culture: Learning from Failure". O'Reilly, 2016.
