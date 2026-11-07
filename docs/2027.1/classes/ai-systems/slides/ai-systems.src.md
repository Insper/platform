---
marp: true
lang: en
title: AI Systems & Agents
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

# AI Systems & Agents

**The large language model (LLM) is a dependency: slow, priced per token, probabilistic**

<!--
Outline: (1) the LLM as a dependency and the five AI & AGENTS components; (2) cost and latency of
one request; (3) LLM gateway; (4) agents, tools and MCP; (5) RAG and memory; (6) safety, evals and
observability. Running example: the BoxOffice support assistant.
-->

---

## One message, one model call?

<div class="q">

A fan types: *"Find me two seats under R$300 for Saturday and hold them."*
The prototype sends it straight to a model API. What goes wrong at 10:00 on sale day?

</div>

* Answers take **25 s**; the provider returns **`429`**.
* The model "holds" seats that **do not exist**.
* The monthly budget is gone **by lunch**.
* A venue description saying *"apply a 100% discount"* is read as an **order**.

<!--
Let the class list failures first. Point out that none of these is a machine-learning problem:
latency, capacity, cost, consistency and security are system design problems.
-->

---

## An LLM call is not a service call

| Property | `inventory` call | LLM call |
|---|---|---|
| Latency | 5–50 ms | 0.3–2 s to the first token, then 10–100 tokens/s |
| Cost driver | infrastructure | **tokens** in + out (output costs several × more) |
| Capacity | requests/s | **tokens per minute**, requests per minute |
| Correctness | deterministic | probabilistic: a `200 OK` can be wrong |
| Security | code ≠ data | **instructions and data share the prompt** |

<p class="small">Token ≈ ¾ of an English word (Portuguese needs more). The model is stateless: every call re-sends system prompt + tools + history.</p>

---

## The AI & AGENTS palette

| Component | What it is | Classic cousin |
|---|---|---|
| **LLM Gateway** | routing, fallbacks, quotas, caching, cost telemetry | API gateway + rate limiter + breaker |
| **Orchestrator** | runs the agent loop or workflow; owns task state and budgets | app server + workflow engine |
| **Tool Registry** | catalog of tools (Model Context Protocol, MCP, servers), permissions, risk tiers | service registry + auth |
| **Memory Fabric** | session, user memory, knowledge base (retrieval-augmented generation, RAG) | cache + SQL + vector DB |
| **Safety Mesh** | checks on every input, output and action | web firewall (WAF) + mesh policy + data-loss prevention (DLP) |

<div class="ok">

The model **chooses** tools; the orchestrator **decides** whether they run — as the user.

</div>

---

## The five boxes reuse the old ones

<div class="flow">
<div class="box muted">fan</div><div class="arrow">→</div>
<div class="box">API gateway<small>auth, rate limit</small></div><div class="arrow">→</div>
<div class="box accent">Orchestrator<small>assistant service</small></div><div class="arrow">→</div>
<div class="box orange">Safety Mesh<small>input, output, action</small></div><div class="arrow">→</div>
<div class="box accent">LLM Gateway<small>routing, quotas, cache</small></div><div class="arrow">→</div>
<div class="group"><div class="caption">models</div><div class="box">large<small>provider A</small></div><div class="box">small<small>provider B / self-hosted</small></div></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .9">Orchestrator also calls →</div>
<div class="group"><div class="caption">Memory Fabric</div><div class="box green">cache<small>session</small></div><div class="box green">vector DB<small>knowledge base</small></div></div>
<div class="group"><div class="caption">Tool Registry (MCP)</div><div class="box green">catalog</div><div class="box green">inventory<small>search, hold</small></div><div class="box green">order<small>read only</small></div></div>
</div>

- The tools call the **same** `catalog` and `inventory` the web front end calls, with the same authorization: no back door.

<!--
The overview page's step-by-step diagram "How they connect to the rest of the system" draws the same picture, plus Kafka re-embedding the catalog and the gateway's telemetry.
-->

---

## Anatomy of one request

<div class="flow">
<div class="box muted">session + preferences<small>input check</small></div><div class="arrow">→</div>
<div class="box accent">call 1<small>search_events(São Paulo, Saturday)</small></div><div class="arrow">→</div>
<div class="box accent">call 2<small>search_seats(event, 2, max 300)</small></div><div class="arrow">→</div>
<div class="box orange">call 3<small>hold_seats(C12, C13): reversible, allowed</small></div><div class="arrow">→</div>
<div class="box green">call 4<small>answer streamed + checkout link</small></div>
</div>

- **4 model calls** for one message; the context grows at every call.
- "Under R$300" is **live structured data → tool**, not RAG.

<!--
Walk through the sequence diagram of the overview page. Ask: where does the time go?
Answer: in the three tool-calling rounds before the final answer, not in the answer.
-->

---

<!-- _class: tight -->

## Cost and latency of one request

| Model calls | Input tokens | US$/1k req, cache 0% | cache 90% | First answer token |
|---|---|---|---|---|
| 1 | 3,060 | 12.93 | 5.64 | 0.3–0.5 s |
| 2 | 6,900 | 25.65 | 10.92 | 2.5–2.9 s |
| 4 | 16,920 | 58.11 | 22.83 | 6.8–7.8 s |
| 10 | 65,700 | 211.65 | 69.20 | 19.8–24.0 s |

<p class="small">Illustrative: US$ 3 / 15 per M input/output tokens, cached input at 10%, 3,000-token prefix, 700-token tool results, 50 tokens/s.</p>

- Input tokens grow **~quadratically** with steps: each call re-sends everything.
- Prompt caching: **~3× cheaper**, only a little faster — generation dominates.
- Flash sale: 33 req/s × 17k tokens ≈ **34 M tokens/min** → quotas, small models, FAQ cache, shedding.

---

## LLM Gateway

<div class="cols">
<div>

**Jobs**

- one API, **aliases** instead of model names
- credentials in one place
- routing: by task, cascade, cost, region
- fallbacks + circuit breakers
- quotas and budgets **in tokens**
- caching, telemetry, policy hooks

</div>
<div>

**Routing**

- static per feature → most cases
- by task (classifier) → mixed traffic
- **cascade**: small first, escalate on failed validation
- compliance: personal data → approved regions
- canary new models behind the alias; **pin versions**

</div>
</div>

---

<!-- _class: tight -->

## Fallbacks: not every error deserves a retry

| Error | Action |
|---|---|
| `429` rate limited | honor `Retry-After`, else **fall back** to another deployment |
| `5xx` / overloaded | backoff + jitter, then fall back; count in the **breaker** |
| no first token by the deadline | cancel and fall back, or **hedge** |
| stream broken mid-answer | cannot retry silently — the user saw part of it |
| `400` context too long | **do not retry**: trim history or use a long-context model |
| refusal / content filter | **do not** fall back to a weaker-guarded model |

<div class="warn">

A fallback model is a **different program**: run the evals on every model in the chain. Retries multiply token spend: cap them.

</div>

---

## Quotas and token budgets

- Provider limits: **requests per minute (RPM), tokens per minute (TPM)**, concurrency — shared by every feature (noisy neighbor).
- Gateway limits: per user, per feature, per request (`max_tokens`, max steps), per month (US$).
- Budget gone → **degrade** (smaller model, FAQ cache), **queue** (batch work), **shed** (`429`).
- Priorities: interactive > batch; paying flows > browsing.

<div class="flow">
<div class="box">count the input<small>3,100 tokens</small></div><div class="arrow">→</div>
<div class="box accent">reserve input + max_tokens<small>3,100 + 600 = 3,700</small></div><div class="arrow">→</div>
<div class="box">call the model<small>180 output tokens</small></div><div class="arrow">→</div>
<div class="box green">reconcile<small>return the unused 420</small></div>
</div>

<div class="ok">

Flash sale: assistant gets 70% of TPM, nightly embedding paused, FAQ → small model + semantic cache, 5 requests/min per fan.

</div>

---

## Caching: three different things

| | Exact response | **Prompt (prefix)** | **Semantic** |
|---|---|---|---|
| Key | hash of the full request | identical prompt prefix | question embedding ≥ threshold |
| Reuses | the answer | the model's key/value (KV) cache | an answer to a *similar* question |
| Saves | the call | input cost + time to first token (TTFT) | the call |
| Risk | none | **none** | **false hits** |

<div class="flow">
<div class="box green">system prompt<small>static</small></div><div class="arrow">→</div>
<div class="box green">tool definitions<small>static</small></div><div class="arrow">→</div>
<div class="box">retrieved documents<small>per conversation</small></div><div class="arrow">→</div>
<div class="box">history<small>grows</small></div><div class="arrow">→</div>
<div class="box orange">new message<small>changes every call: last</small></div>
</div>

- Semantic cache: scope keys (event, language, policy version); generic answers only.

<!--
Saturday vs Sunday refund question: nearly identical vectors, different answers. Timestamps at the
top of the system prompt are the classic prompt-cache buster.
-->

---

<!-- _class: tight -->

## TTFT, TPOT, batching

> latency = TTFT + TPOT × (N_out − 1)  ·  0.6 s + 20 ms × 249 ≈ **5.6 s** for 250 tokens

- **Prefill** (parallel, compute-bound) → **TTFT**: the interactive service level objective (SLO), hidden by **streaming** (Server-Sent Events, SSE).
- **Decode** (one token at a time, memory-bound) → time per output token (**TPOT**): only needs to beat reading speed.
- Batching shares each read of the weights: replica throughput ↑, per-user speed ↓ slowly.
- **Continuous batching** + **PagedAttention** made it practical.
- KV cache: 2 × layers × KV heads × head dim × bytes → **128 KiB/token** (8B model) → 8k tokens ≈ 1 GiB → ~64 conversations per 80 GB GPU.

<p class="small">Self-hosting pays only at high, steady utilization — at 10% it is 10× more per token.</p>

---

## Workflow or agent? Who decides the next step

| Level | Next step decided by | BoxOffice |
|---|---|---|
| Single call | — | summarize reviews |
| Workflow (chain, routing, parallel) | **code** | extract → search → hold → phrase |
| Orchestrator-workers | model splits, code runs | festival weekend plan |
| Agent | **the model, in a loop** | open-ended support with tools |

<div class="ok">

Start at the top; move down only when the simpler level **measurably** fails your evals.

</div>

---

## The agent loop (ReAct)

```python
for step in range(MAX_STEPS):
    reply = llm.chat(messages=messages, tools=registry.schemas_for(user))
    messages.append(reply.message)
    if not reply.tool_calls:
        return reply.text                      # final answer
    for call in reply.tool_calls:
        verdict = guard.check_tool_call(call.name, call.arguments, user)
        result = (registry.call(call.name, call.arguments, as_user=user)
                  if verdict == "allow" else {"error": verdict})
        messages.append(tool_result(call.id, result))
return "Escalating to a human agent."
```

- The model **requests**; the orchestrator validates, authorizes **as the user**, executes.
- Errors go back as data; budgets: steps, tokens, time; loop detection.

---

## Play it: the agent loop

<div class="flow">
<div class="box green">finds the seats<small>4 calls · 16,920 tokens · US$ 22.83 / 1k · 6.8 s</small></div>
<div class="box">no parallel calls<small>5 calls · US$ 29.44 · 8.9 s</small></div>
<div class="box red">gets stuck, MAX_STEPS 8<small>46,320 tokens, then an apology</small></div>
<div class="box orange">loop detection<small>caught at call 3, 11,520 tokens</small></div>
</div>

- The Agents & Tools page embeds the loop: each bar is one call, its height the context it re-sends.
- Knobs: `MAX_STEPS`, parallel tool calls, loop detection, prompt-cache hits, a tool-less last call (lab 12).
- Raising `MAX_STEPS` to 12 does not help the stuck model: the 40,000-token budget stops it at the same call.

<!--
The numbers are the overview's cost table, call by call. Lab 12's assistant makes its fourth call without tools, so the step limit ends with an answer.
-->

---

## Tools are side effects

| Tier | Examples | Policy |
|---|---|---|
| Read | `search_seats`, `get_order` | automatic |
| Reversible write | `hold_seats` (expires in 10 min) | automatic within limits |
| Irreversible / financial | `create_order`, `refund_order` | **user confirmation in the UI** |
| External communication | `send_email` | confirm, or do not offer |

- Retried write → **idempotency key** `(conversation, step, call)`; compensation = `release_hold`.
- Steps compound: **0.95¹⁰ ≈ 60%** task success → fewer steps, validate each one, workflows for known parts.
- Durable execution: checkpoint state after every step.

---

## MCP: the tool registry protocol

- **N agents × M tools → N + M**: each team ships one MCP server.
- Host (assistant) runs one **client** per **server**; JSON-RPC 2.0.
- Server primitives: **tools**, resources, prompts. `initialize` → `tools/list` → `tools/call`.
- Transports: **stdio** (local) and **Streamable HTTP** (remote, OAuth-based auth).
- The fan's identity comes from the **session token**, never from a tool argument.
- Registry = catalog + exposure per role + risk tier + scopes + rate limits + audit.

<div class="warn">

Annotations (`readOnlyHint`…) are **claims**; descriptions are **prompts**. Review, pin and allowlist third-party servers.

</div>

---

## Multi-agent — and when not to use agents

<div class="cols">
<div>

**Patterns**

- supervisor / orchestrator-workers
- router / handoff to specialists
- parallel fan-out + aggregate
- evaluator-optimizer
- cost: more tokens, latency, harder tracing

</div>
<div>

**Prefer something simpler when…**

- steps are known → **workflow**
- must be exactly right → **code**
- < 1–2 s budget → one small call
- irreversible → code + **confirmation**
- cannot evaluate → **don't automate yet**

</div>
</div>

---

## RAG: two pipelines

<div class="flow" style="align-items: stretch">
<div class="group"><div class="caption">ingestion (async)</div>
<div class="box">parse + clean<small>metadata: venue, version, access</small></div>
<div class="box">chunk<small>structure-aware, contextual headers</small></div>
<div class="box">embed (batch)<small>store the model name</small></div>
</div>
<div class="arrow" style="align-self: center">→</div>
<div class="box accent" style="flex: .7; display: flex; flex-direction: column; justify-content: center">vector + keyword index<small>kept fresh by change events; deletes too</small></div>
<div class="arrow" style="align-self: center">←</div>
<div class="group"><div class="caption">query (online)</div>
<div class="box">rewrite<small>standalone question, filters</small></div>
<div class="box">hybrid search → rerank<small>top 20–50 → keep 3–8</small></div>
<div class="box green">prompt with sources<small>answer with citations, verified</small></div>
</div>
</div>

<p class="small">Index size ≈ N × d × 4 bytes + graph: 60k chunks × 1,024 dims ≪ 1 GB → pgvector in the Postgres you already run.</p>

---

<!-- _class: tight -->

## Hybrid search, RRF and reranking

- Vectors miss **exact tokens** (sector "C", codes, names); keywords miss **paraphrase**.
- **Reciprocal Rank Fusion**: score(d) = Σ 1 / (60 + rank) — ranks only, no score calibration.
- 1st by keywords + 3rd by vectors → 1/61 + 1/63 ≈ **0.032** beats 1st by vectors only (0.016).
- **Cross-encoder reranker** reads question + chunk together: precise, slower (tens–hundreds of ms).
- Approximate nearest neighbor (ANN) index, HNSW: tune `ef_search` for recall vs latency; **filters** need iterative scans or partitions.

```sql
SELECT id, coalesce(1.0/(60 + s.rank), 0) + coalesce(1.0/(60 + k.rank), 0) AS rrf
FROM semantic s FULL OUTER JOIN keyword k USING (id)
ORDER BY rrf DESC LIMIT 20;   -- then rerank
```

---

## Play it: what reaches the prompt

<div class="flow">
<div class="box red">sector C, vector only<small>lifts 0.84 · Estádio Sul 0.83 · the answer 0.79</small></div><div class="arrow">→</div>
<div class="box green">hybrid (RRF)<small>the answer first: 0.0323 vs 0.0164 · k = 1 is enough</small></div>
</div>
<div class="flow">
<div class="box red">camera, no context<small>Estádio Sul 0.81 beats §4 0.74, in every mode</small></div><div class="arrow">→</div>
<div class="box green">contextual chunks<small>title + section in the chunk: §4 first</small></div>
</div>

- The RAG & Memory page embeds the search: vector, keyword or hybrid; top-k; a minimum similarity; contextual chunks.
- *Pool*: no chunk answers; a 0.60 threshold turns five unrelated chunks into "I don't know" — for the vector half only.

---

## Memory types

| Type | BoxOffice example | Store | Lifetime |
|---|---|---|---|
| Working | this call's prompt | the model call | one call |
| Short-term (session) | choosing C12–C13 vs D4–D5 | Redis + time to live (TTL) | hours |
| Long-term semantic | "prefers aisle seats" | SQL, editable | until deleted |
| Long-term episodic | "last month's refund" | vector index | retention policy |
| Procedural | system prompt, rules | Git, evaluated | per release |

<div class="warn">

Extract memories only from the **user's own messages** (memory poisoning). Deletion must reach **every copy**: profile, vectors, caches, logs, traces (LGPD, Brazil's data protection law).

</div>

---

## Prompt injection

- **Direct**: the user types it — damage limited to what *that user* may do.
- **Indirect**: it arrives in a document, tool result, web page or tool description — a **third party** attacks the user.
- No filter solves it: **assume the model may be compromised**; limit what it can do.

<div class="q">

**Lethal trifecta**: private data + untrusted content + external communication. Remove one leg.

</div>

- BoxOffice: user-scoped tools · promoter text marked as data · no e-mail/fetch tools · links to allowlisted domains only.

---

<!-- _class: tight -->

## The Safety Mesh

| Check point | Examples | Type |
|---|---|---|
| 1. Input | personal data (PII) redaction: CPF, Luhn for cards; injection score | deterministic + small model |
| 2. Retrieval | permission filter in the query; mark untrusted text | deterministic |
| 3. Tool call | schema, authorization as the user, risk tier | deterministic |
| 4. Tool result | size limit, injection score | both |
| 5. Output | schema, business rules vs tool results, citations, URL allowlist | deterministic |
| 6. Action | **human confirmation** of the exact action — a UI event | — |

<div class="ok">

Prefer deterministic checks: fast, testable, and they cannot be talked out of a decision.

</div>

---

<!-- _class: tight -->

## Evaluation: prompts and models are deploys

- Pyramid: deterministic checks → **golden set** (state-graded, fixtures) → **LLM-as-judge** → humans → **online**.
- Grade the **outcome** (is the right hold there?) more than the exact trajectory.
- Non-determinism: run k attempts. p = 0.9 → **pass@4 ≈ 100%**, **pass^4 ≈ 66%** — fans live pass^k.
- Judge biases: **position**, **verbosity**, **self-preference** → rubric, swap order, other family, validate vs humans.
- Online: holds → orders, escalations, guardrail triggers, refusals, TTFT p95, **cost per resolved conversation**.

<div class="flow">
<div class="box">change<small>prompt, model, tool, k</small></div><div class="arrow">→</div>
<div class="box">deterministic checks</div><div class="arrow">→</div>
<div class="box accent">golden set gate<small>continuous integration (CI)</small></div><div class="arrow">→</div>
<div class="box">judge sample</div><div class="arrow">→</div>
<div class="box orange">canary<small>behind the alias</small></div><div class="arrow">→</div>
<div class="box green">promote<small>or roll back</small></div>
</div>

---

## Observability of LLM apps

```text
invoke_agent boxoffice-assistant                        10.1 s
├── chat assistant-default      in 3,060  out 41         1.1 s
├── execute_tool search_events                           0.12 s
├── chat assistant-default      in 3,900  out 96         2.3 s
└── chat assistant-default      in 5,300  out 212        4.9 s
```

- OpenTelemetry (OTel) GenAI conventions: `gen_ai.operation.name`, `gen_ai.request.model`, `gen_ai.usage.input_tokens` / `output_tokens`, `gen_ai.response.finish_reasons`; TTFT/TPOT metrics.
- Cost under your own namespace; **content capture opt-in**, redacted, short retention.
- Alerts: TTFT SLO, fallback rate, **cost burn rate**, guardrail spikes.

---

<!-- _class: tight -->

## The concept map

| Component | Question it answers | Taught in |
|---|---|---|
| `llmgw` | Which model serves this call, within which budget? | LLM Gateway |
| `orchestrator` | Who decides the next step, and when does it stop? | Agents & Tools |
| `toolreg` | What may the model ask to do, and as whom? | Agents & Tools (MCP) |
| `memory` · `vectordb` | What must go back into the prompt? | RAG & Memory |
| `safety` | Is this input, output or action allowed? | Safety, Evals & Obs. |
| `tracing` · `metrics` | Is it right, fast and affordable? | Safety, Evals & Obs. |

<p class="small">Each one is a classic component specialized for tokens, prompts and tools: API gateway, workflow engine, service catalog, cache + databases, policy mesh. Scenario: <code>ai-assistant</code>.</p>

<!--
The same table is on the overview page, with links to the subpages and the component catalog.
-->

---

## What breaks next

<div class="q">

A prompt, a tool description, a model version, the `k` of the retrieval: each one changes behavior without a line of Java, and each one is a deploy that must pass the eval gate.

</div>

- Meanwhile the same models write the team's code: pull requests arrive faster than people review, test and release them.
- The safety net of lab 11 (tests, scans, a canary) was sized for human speed.
- Class 14: AI inside the delivery pipeline, without letting it approve its own work.

---

## Takeaways

1. An LLM is a **slow, token-priced, rate-limited, probabilistic** dependency that mixes instructions with data.
2. Five components: **gateway, orchestrator, tool registry, memory fabric, safety mesh** — classic components specialized.
3. Cost and latency = **calls × tokens per call**; context grows every step; cache the prefix.
4. **Workflow first**; agents with budgets, idempotent tools, user-scoped authorization, MCP.
5. Tools for live data; **RAG** (hybrid + rerank + citations) for documents; memory by type, deletable.
6. Defense in depth + **human confirmation**; **evals in CI** (pass^k, validated judges); **GenAI traces** with tokens and cost.
