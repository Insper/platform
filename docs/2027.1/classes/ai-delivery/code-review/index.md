A pull request to `order` changes the checkout so that it confirms the seat hold with one SQL statement instead of an HTTP call to `inventory` — "it is faster". The code compiles, the tests pass, and the reviewer, at 18:40 on a Friday, approves. Three weeks later, during an on-sale, `inventory` changes its hold table and checkout breaks. The rule that was violated — *one schema per service* — was written in a wiki page nobody opened. A reviewer that had read that page, every time, on every PR, would have caught it.

That is the promise of **AI code review**: a reviewer that reads every diff in minutes, never gets tired, and can be told the team's rules. This page is about turning the promise into a tool people actually trust.

---

## Why code review, and what it is for

Modern code review — a lightweight, tool-based review of each change before merging — is near-universal in industry. Studies at Microsoft and Google found that its main outcomes are not only finding defects but **knowledge transfer, shared code ownership and consistency**; at Google the median review latency was under a day, with most changes small[^1][^2]. Two consequences for AI review:

- An AI reviewer can take over part of the **defect-finding** and **consistency** work, but not the knowledge transfer: a human must still read the code to learn it.
- Review latency matters. The first human look often waits hours; an AI review in two minutes gives the author something to fix *before* the human arrives, so the human review is shorter.

---

## What AI review is good and bad at

| Good at (high precision when given context) | Bad at (low precision or blind) |
|---|---|
| Local bugs visible in the diff: null handling, off-by-one, wrong comparison, resource leaks | Bugs that need runtime knowledge: performance under load, race conditions across services |
| Security patterns: SQL by concatenation, secrets in code, missing authorization check, unsafe deserialization | Whether the feature is the **right** feature: product intent is not in the diff |
| Violations of **written** conventions and ADRs | Conventions nobody wrote down |
| Missing tests for risky logic; tests that assert nothing | Judging whether a test asserts the **correct** expected value (the oracle problem) |
| Explaining unfamiliar code to the human reviewer | Large refactors spanning hundreds of files (context limits, attention dilution) |
| Consistency: error formats, status codes, logging, naming | Architecture trade-offs that require weighing business context |

Two systematic weaknesses deserve names. **Gullibility**: the model reads text written by the author — PR description, code comments — and can be steered by it ("this was approved by security"); see [prompt injection](../security-governance/index.md). **Plausible noise**: a model asked to review will find *something*; without explicit permission to return nothing, it pads the review with style remarks and restatements.

---

## Anatomy of an AI reviewer

``` diagram-sim
sequenceDiagram
    autonumber
    participant GH as Git host
    participant R as Reviewer job
    participant Ctx as Context builder
    participant GW as LLM gateway
    participant Post as Poster
    GH->>R: PR opened / new push
    R->>Ctx: diff + PR metadata
    Ctx->>Ctx: number lines, filter files, budget tokens
    Ctx->>Ctx: add conventions, ADRs, owners, related code
    Ctx->>GW: system (stable, cached) + user (untrusted data)
    GW-->>R: JSON findings (schema-validated)
    R->>R: filter: changed lines, severity, confidence, dedup, cap
    R->>Post: findings to post
    Post->>GH: one review with inline comments
    Post->>GH: metrics: tokens, US$, kept vs dropped
```

The model is one box of eight. Most of the engineering — and most of the quality — is in the **context builder** and the **filter**.

---

## Context engineering

A model can only review against what it is given. **Context engineering** is deciding what goes into the limited, priced context window, and in which order.

| Context | Why | Cost / risk | BoxOffice |
|---|---|---|---|
| **The diff, with line numbers** | The subject of the review; numbered lines let the model cite exact lines | Grows with PR size; untrusted | `git diff base...head`, each new line as `L21 + …` |
| **Repository conventions** | Turns generic advice into *your* rules | Must be short and current; read on every run | `CONVENTIONS.md`: schema per service, timeouts, money as cents |
| **Architecture decisions (ADRs)** | The *why* behind rules; lets the model flag decisions being reversed | Long; summarise or retrieve the relevant ones | `0001-schema-per-service.md`, `0004-outbox-for-events.md` |
| **Surrounding code** | The full function or class around a hunk; the callers of a changed method | Token-expensive; retrieval needed in big repos | The whole `HoldService.java` when a hunk changes `expire()` |
| **Ownership and service map** | Which service owns which data and API | Small, high value | "`inventory` owns `inventory.*`; `order` owns `orders.*`" |
| **History** | Earlier review comments, related incidents | Can bias towards old issues | "Incident 2026-08: hold expiry off by 2 min" |
| **PR title and description** | Intent of the change | **Untrusted** — injection channel | Wrapped in `<untrusted_pr_description>` |

Three practical rules:

1. **Order for caching.** Put stable content first (instructions, conventions, ADRs) and per-run content last (diff). Prompt caching is a prefix match: if the stable part is byte-identical, repeated reviews read it at a fraction of the price ([LLM gateway](../../ai-systems/llm-gateway/index.md)).
2. **Budget, do not truncate.** A 5,000-line PR does not fit — and should not be reviewed as one blob. Keep whole files by priority (production code before tests before config), list the skipped files in the review, or split: one call per file or per service (*map*), then one call to merge and deduplicate (*reduce*). Cutting a diff in the middle produces confident nonsense about code the model never saw.
3. **Write conventions for humans first.** If a rule is unclear to a new engineer it is unclear to the model. A rule that needs a paragraph of nuance is usually better as a deterministic check (below).

??? question "Think first: retrieval for a monorepo"

    BoxOffice becomes a monorepo of 40 services and 2 M lines. A PR changes the signature of `InventoryClient.confirmHold`. Which extra context would most improve the review, and how do you find it without sending the whole repository?

    The **call sites** of the changed method and the **contract** of the API it wraps. Find them deterministically — a code index (language server, `ctags`, a code-search service) or a simple `git grep confirmHold` — and add the 5–10 most relevant snippets. Embedding-based retrieval over the repository ([RAG](../../ai-systems/rag-memory/index.md)) helps for fuzzy questions ("where else do we compute seat prices?"), but for "who calls this method" a symbol index is exact and cheaper.

---

## Structured output, posted as review comments

Free text is for humans; the pipeline needs **data**. Ask for JSON that validates against a schema — with Claude, structured outputs constrain the response to the schema; with other providers, JSON mode plus validation and one repair attempt:

```json
{
  "summary": "Adds direct SQL access from order to the inventory schema.",
  "findings": [
    {
      "file": "services/order/src/main/java/boxoffice/order/OrderService.java",
      "line": 21,
      "severity": "blocker",
      "category": "architecture",
      "confidence": "high",
      "title": "order writes to the inventory schema",
      "explanation": "CONVENTIONS.md: a service reads and writes only its own schema. This UPDATE couples order to inventory's table layout and bypasses inventory's locking, so a hold can be confirmed after it expired.",
      "suggestion": "Call InventoryClient.confirmHold(holdId) and handle 409 Conflict."
    }
  ]
}
```

| Field | Used for |
|---|---|
| `file`, `line` | Inline placement; validated against the diff (comments on lines outside the diff are rejected by the Git host) |
| `severity` (`nit` … `blocker`) | Thresholds and ordering; gate decisions |
| `category` | Per-category precision; routing (security findings to the security champion) |
| `confidence` | Noise control; calibration over time |
| `title` | Deduplication fingerprint; the line people scan |
| `explanation`, `suggestion` | The comment body; a concrete fix makes a comment actionable |

On GitHub, all findings of one run go into **one review** (`POST /repos/{owner}/{repo}/pulls/{number}/reviews` with a `comments` array of `path`, `line`, `side`), so the author gets one notification, not twelve[^3]. A review **event** of `COMMENT` keeps the bot advisory; the code — not the model — chooses that event.

---

## Noise control

Every comment spends a developer's attention. A reviewer is judged by its **worst** comments: after a few useless ones, people stop reading — including the useful ones. The controls, in the order they act:

| Control | What it removes |
|---|---|
| Triggers and path filters | Drafts, docs-only PRs, generated files, lockfiles, vendored code |
| Prompt: "an empty list is a good review; no praise; no restating" | Padding |
| Only **changed lines** | Comments on code the author did not touch |
| Minimum **severity** | Style nits a formatter should handle |
| Minimum **confidence** | Speculation |
| **Deduplication** by fingerprint across pushes | The same comment reposted after every push |
| **Cap** per PR | Floods on big PRs — keep the most severe |
| One review per push + one sticky summary | Notification storms |

The thresholds trade **precision** (the fraction of posted comments that are useful) against **recall** (the fraction of real problems found). The table uses an illustrative labelled sample of 100 PRs — the model emitted 60 high-, 90 medium- and 150 low-confidence findings, of which 48, 45 and 30 were real problems, out of 150 real problems in total:

```python exec="1"
# Illustrative labelled sample: findings per confidence bucket and how many were real.
buckets = [("high", 60, 48), ("medium", 90, 45), ("low", 150, 30)]
REAL_PROBLEMS, PRS = 150, 100

print("| Post findings with confidence ≥ | Comments per PR | Precision | Recall |")
print("|---|---|---|---|")
posted = useful = 0
for name, emitted, real in buckets:
    posted += emitted
    useful += real
    print(f"| {name} | {posted / PRS:.1f} | {useful / posted:.0%} | {useful / REAL_PROBLEMS:.0%} |")
```

Posting everything finds the most problems and is ignored by everybody (3 comments per PR, 4 out of 10 useful). Posting only high confidence is trusted and misses two thirds of the problems. Most teams start at **high + medium for severities ≥ minor**, measure, and move per category: secrets and SQL injection can stay at medium; style never gets posted.

!!! example "In the BoxOffice code: the reviewer's filter (lab 13)"

    [Hands-on 13 — The reviewer](../../../hands-on/13/review/index.md) builds the anatomy above in one script. The PR title, description and diff go to the model wrapped as **untrusted** data; the model answers JSON against a schema; and the code — not the model — keeps only findings on **added** lines, at severity ≥ `minor`, not low confidence, at most 6 per PR, the most severe first. A fingerprint of each finding stops it from being posted again on the next push, and an error of the model ends the job with exit code 0: **fail open**, because an advisory step must never block merges. A test run with the local model posted one finding, the SQL injection planted in `EventSearch.java`; with Claude, one review of the lab's golden set cost about US$ 0.012.

    ``` { .python title=".github/ai/review.py (the review and the fail-open)" }
    --8<-- "docs/2027.1/hands-on/13/code/.github/ai/review.py:103:130,207:211"
    ```

---

## Advisory or gate?

| | Advisory | Gate (required check) |
|---|---|---|
| Effect | Comments; humans decide | Merge blocked until the finding is fixed or overridden |
| Cost of a false positive | A minute of reading | A blocked PR, an override, frustration — and pressure to disable the bot |
| Cost of a false negative | Same as today | False sense of safety if humans relax |
| Needs | Nothing special | **Measured high precision** in that category; an override path; fail-closed reliability |
| Good for | Everything, at first | Narrow, high-precision categories: hardcoded secrets, SQL by concatenation, forbidden cross-schema access |

A safe rollout: **shadow** (findings logged, not posted; compare with what humans found) → **advisory** for volunteer teams → **gate per category** once precision is proven. Even as a gate, an AI check is a *required status check* — never an approval. Approval stays human, enforced by branch protection.

---

## Measuring the reviewer

You cannot tune what you do not measure, and "the team likes it" is not a measurement.

| Metric | How | Notes |
|---|---|---|
| **Precision** | Accepted ÷ (accepted + dismissed) comments; reactions or a resolve-with-reason button | Needs people to rate; sample if necessary |
| **Recall** | Found ÷ planted, on a **golden set** of PRs with known problems | Run on every prompt or model change, in CI |
| **Escaped defects** | Bugs found later in code the bot reviewed | Slow, but the metric the business cares about |
| **Noise** | Comments per PR; % of PRs with zero comments | Zero is often the right answer |
| **Cost and latency** | US$ and minutes per review | From the job's token usage |
| **Behavioral** | Time to first review, review rounds, time to merge | Needs a baseline period |

An LLM can also *judge* comments ("was this comment correct?"), which is cheaper than human labels — but [LLM-as-judge](../../ai-systems/safety-evals/index.md) has biases (it tends to agree with confident text, and with itself). Use it to triage, and calibrate it against a human-labelled sample.

---

## Architecture conformance

The opening story — `order` writing to the `inventory` schema — is an **architecture rule**. Such rules are the most valuable thing an automated reviewer can check, because humans forget them and violations are expensive later. But many of them do not need a model at all.

| Rule | Deterministic check (preferred) | Where AI adds value |
|---|---|---|
| "`order` must not access the `inventory` schema" | SQL lint: grep for `inventory.` in `services/order/**`; separate DB users per service with grants (the database refuses) | Explaining *why*, suggesting the API call instead |
| "Controllers must not call repositories directly" | [ArchUnit](https://www.archunit.org){target="_blank"} test in the build | — |
| "Every outbound HTTP client has timeouts" | Custom lint, or a shared client library that requires them | Spotting a new hand-rolled client that bypasses the library |
| "Events go through the outbox" | ArchUnit: no `KafkaTemplate` usage outside the outbox relay | Recognising a disguised direct publish |
| "Prefer idempotent operations for payment" | Hard to express statically | Good fit: fuzzy, semantic, context-dependent |

```java title="services/order/src/test/java/boxoffice/order/ArchitectureTest.java"
@AnalyzeClasses(packages = "boxoffice.order")
class ArchitectureTest {

    @ArchTest
    static final ArchRule no_direct_kafka_outside_outbox =
        noClasses().that().resideOutsideOfPackage("..outbox..")
            .should().dependOnClassesThat().haveSimpleName("KafkaTemplate")
            .because("ADR-0004: events are published through the transactional outbox");
}
```

The best design combines both: deterministic rules **block**, because they are exact; the AI reviewer **explains** and catches what the rules cannot express, and its recurring findings become candidates for new deterministic rules. Defense in depth again — and the database user of `order` without grants on `inventory.*` is the last layer that does not depend on any reviewer.

!!! example "BoxOffice: the reviewer catches the shortcut"

    The `UPDATE inventory.hold` in `OrderService` — the finding of the JSON above — is case `02-cross-schema` of the reviewer's [golden set in hands-on 13](../../../hands-on/13/security/index.md). With `CONVENTIONS.md` in its context, the reviewer found it in the runs the lab shows, with the local model and with Claude; but a later run of the small local model missed it. A reviewer is a probability, so the team adds the deterministic check: a separate PostgreSQL role per service, so the same mistake fails in the integration tests even if every reviewer misses it.

---

!!! tip "In the interview"

    When asked to design an AI code reviewer, say early that **precision beats recall** for anything that talks to humans, and show how you will *measure* it (golden set for recall, accepted/rated for precision). Describe the context (diff + conventions + ADRs + related code by symbol search), structured findings, the filter (changed lines, severity, confidence, dedup, cap) and the rollout (shadow → advisory → gate per category). Mention that architecture rules should be **deterministic checks first**, with AI as the explainer.

!!! success "Best practices"

    - **Start in shadow mode** — log the findings for two weeks and compare them with the human reviews before posting anything.
    - **Version the reviewer's context with the code** — `CONVENTIONS.md` and the ADRs live in the repository and change by pull request; the [reviewer of lab 13](../../../hands-on/13/review/index.md) loads them as its stable, cacheable prefix.
    - **Collect a reaction on every comment** — a 👍/👎 per finding gives precision per category at no cost; every comment of lab 13 asks for one.
    - **Cap the comments per PR and post the most severe first** — lab 13 posts at most 6 (`AI_REVIEW_MAX_COMMENTS`).
    - **Deduplicate findings across pushes** — the same problem must not be posted again on every push; lab 13 keeps a fingerprint of each finding in the comment.

!!! warning "Common pitfalls"

    - **No permission to stay silent**: the model invents work. Say explicitly that an empty review is good.
    - **Reviewing the whole repository instead of the change**: expensive and off-topic.
    - **Treating the bot's silence as approval**: humans relax, escaped defects rise.
    - **Gating before measuring**: one week of false blocks and the team disables the bot.
    - **Rules only in the prompt**: a rule that matters must also exist as a test, a lint or a database grant.

---

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    PR["pull request event"] --> CTX["context: diff, conventions,<br/>ADRs, symbol search"]
    CTX --> RET["retrieval<br/>→ AI systems RAG & Memory"]
    CTX --> LLM["model call<br/>→ LLM gateway, prefix cache"]
    LLM --> OUT["structured findings<br/>(JSON schema)"]
    OUT --> NOISE["noise control: changed lines,<br/>confidence, dedup, cap"]
    NOISE --> GATE{"advisory<br/>or gate?"}
    GATE --> PREC["precision + golden set<br/>→ AI systems safety & evals"]
    ARCH["architecture rules:<br/>deterministic checks first"] --> OUT
    PR --> INJ["PR text is untrusted<br/>→ Security & governance"]
```

**Palette components:** [`orchestrator`](../../../reference/components/ai/index.md#orchestrator) (the reviewer job around the model) · [`llmgw`](../../../reference/components/ai/index.md#llmgw) (routing, quotas, cached prefix of conventions and ADRs) · [`memory`](../../../reference/components/ai/index.md#memory) (the context assembled for each diff) · [`safety`](../../../reference/components/ai/index.md#safety) (untrusted PR text, validated output) · [`metrics`](../../../reference/components/observability/index.md#metrics) (precision and comments per PR). **Scenarios:** none specific. **Continues in:** [AI systems — RAG & Memory](../../ai-systems/rag-memory/index.md), [AI systems — LLM Gateway](../../ai-systems/llm-gateway/index.md), [AI systems — safety & evals](../../ai-systems/safety-evals/index.md), [Security & governance](../security-governance/index.md), [Hands-on 13 — the reviewer](../../../hands-on/13/review/index.md).

---

[^1]: BACCHELLI, A.; BIRD, C. *Expectations, outcomes, and challenges of modern code review*. ICSE 2013.
[^2]: SADOWSKI, C. et al. *Modern code review: a case study at Google*. ICSE-SEIP 2018.
[^3]: GitHub Docs. [REST API endpoints for pull request reviews](https://docs.github.com/en/rest/pulls/reviews){target="_blank"}.
