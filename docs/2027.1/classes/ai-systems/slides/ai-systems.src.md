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

<div class="kicker">System Architecture · Insper</div>

# AI Systems & Agents

**The LLM is a dependency: slow, priced per token, probabilistic**

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
| **Tool Registry** | catalog of tools (MCP servers), permissions, risk tiers | service registry + auth |
| **Memory Fabric** | session, user memory, knowledge base (RAG) | cache + SQL + vector DB |
| **Safety Mesh** | checks on every input, output and action | WAF + mesh policy + DLP |

<div class="ok">

The model **chooses** tools; the orchestrator **decides** whether they run — as the user.

</div>

---

## Anatomy of one request

1. Load session + preferences (Memory Fabric); input check (Safety Mesh).
2. Call 1 → `search_events(São Paulo, Saturday)`.
3. Call 2 → `search_seats(event, 2, max 300)`.
4. Call 3 → `hold_seats(event, [C12, C13])` → **reversible**: allowed.
5. Call 4 → answer **streamed** with a checkout link; payment stays with the fan.

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

- Provider limits: **RPM, TPM**, concurrency — shared by every feature (noisy neighbor).
- Gateway limits: per user, per feature, per request (`max_tokens`, max steps), per month (US$).
- Counting unknown output: **reserve** `input + max_tokens`, then **reconcile** with real usage.
- Budget gone → **degrade** (smaller model, FAQ cache), **queue** (batch work), **shed** (`429`).
- Priorities: interactive > batch; paying flows > browsing.

<div class="ok">

Flash sale: assistant gets 70% of TPM, nightly embedding paused, FAQ → small model + semantic cache, 5 requests/min per fan.

</div>

---

## Caching: three different things

| | Exact response | **Prompt (prefix)** | **Semantic** |
|---|---|---|---|
| Key | hash of the full request | identical prompt prefix | question embedding ≥ threshold |
| Reuses | the answer | the model's computation (KV) | an answer to a *similar* question |
| Saves | the call | input cost + TTFT | the call |
| Risk | none | **none** | **false hits** |

- Prompt order: system → tools → documents → history → **new message last**.
- Semantic cache: scope keys (event, language, policy version); generic answers only.

<!--
Saturday vs Sunday refund question: nearly identical vectors, different answers. Timestamps at the
top of the system prompt are the classic prompt-cache buster.
-->

---

<!-- _class: tight -->

## TTFT, TPOT, batching

> latency = TTFT + TPOT × (N_out − 1)  ·  0.6 s + 20 ms × 249 ≈ **5.6 s** for 250 tokens

- **Prefill** (parallel, compute-bound) → **TTFT**: the interactive SLO, hidden by **streaming** (SSE).
- **Decode** (one token at a time, memory-bound) → **TPOT**: only needs to beat reading speed.
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

<div class="cols">
<div>

**Ingestion (async)**

- parse + clean; metadata (venue, version, access)
- **chunk**: structure-aware, parent–child, contextual headers
- **embed** (same model for queries), store model name
- keep fresh with **change events**; propagate deletes

</div>
<div>

**Query (online)**

- rewrite to a standalone question; extract filters
- **hybrid search**: vectors + keywords
- **rerank** top 20–50 → keep 3–8
- prompt with sources, best first
- answer **with citations**; verify them

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
- ANN (HNSW): tune `ef_search` for recall vs latency; **filters** need iterative scans or partitions.

```sql
SELECT id, coalesce(1.0/(60 + s.rank), 0) + coalesce(1.0/(60 + k.rank), 0) AS rrf
FROM semantic s FULL OUTER JOIN keyword k USING (id)
ORDER BY rrf DESC LIMIT 20;   -- then rerank
```

---

## Memory types

| Type | BoxOffice example | Store | Lifetime |
|---|---|---|---|
| Working | this call's prompt | the model call | one call |
| Short-term (session) | choosing C12–C13 vs D4–D5 | Redis + TTL | hours |
| Long-term semantic | "prefers aisle seats" | SQL, editable | until deleted |
| Long-term episodic | "last month's refund" | vector index | retention policy |
| Procedural | system prompt, rules | Git, evaluated | per release |

<div class="warn">

Extract memories only from the **user's own messages** (memory poisoning). Deletion must reach **every copy**: profile, vectors, caches, logs, traces (LGPD).

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
| 1. Input | PII redaction (CPF, Luhn for cards), injection score | deterministic + small model |
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
- CI gate on every prompt/model/tool change; **canary** behind the gateway alias.
- Online: holds → orders, escalations, guardrail triggers, refusals, TTFT p95, **cost per resolved conversation**.

---

## Observability of LLM apps

```text
invoke_agent boxoffice-assistant                        10.1 s
├── chat assistant-default      in 3,060  out 41         1.1 s
├── execute_tool search_events                           0.12 s
├── chat assistant-default      in 3,900  out 96         2.3 s
└── chat assistant-default      in 5,300  out 212        4.9 s
```

- OTel GenAI conventions: `gen_ai.operation.name`, `gen_ai.request.model`, `gen_ai.usage.input_tokens` / `output_tokens`, `gen_ai.response.finish_reasons`; TTFT/TPOT metrics.
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

## Takeaways

1. An LLM is a **slow, token-priced, rate-limited, probabilistic** dependency that mixes instructions with data.
2. Five components: **gateway, orchestrator, tool registry, memory fabric, safety mesh** — classic components specialized.
3. Cost and latency = **calls × tokens per call**; context grows every step; cache the prefix.
4. **Workflow first**; agents with budgets, idempotent tools, user-scoped authorization, MCP.
5. Tools for live data; **RAG** (hybrid + rerank + citations) for documents; memory by type, deletable.
6. Defense in depth + **human confirmation**; **evals in CI** (pass^k, validated judges); **GenAI traces** with tokens and cost.
