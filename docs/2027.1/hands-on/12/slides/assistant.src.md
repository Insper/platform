---
marp: true
lang: en
title: Hands-on 12 — AI Assistant
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

# Hands-on 12 — AI Assistant

**Gateway, retrieval-augmented generation (RAG), tools, guardrails — and the cost of the first token**

<!--
Outline: (1) the problem; (2) architecture; (3) uv + Ollama + pgvector; (4) the gateway;
(5) RAG and its evaluation; (6) tools and the agent loop; (7) guardrails; (8) metrics and TTFT.
-->

---

## Thousands of the same questions

<div class="q">

On sale day: *when is the show? how much? where is my order?* An assistant could answer at 3 a.m. —
what must it **not** do?

</div>

- Invent shows, dates or prices.
- Show one fan's order to another.
- Leak CPFs (taxpayer numbers) and card numbers to a third-party provider.
- Cost more than the tickets, or take a minute to start answering.

---

## Architecture

<div class="flow">
<div class="box muted">fan<small>POST /assistant/chat</small></div><div class="arrow">→</div>
<div class="box orange">input guard<small>length, injection, personal data (PII)</small></div><div class="arrow">→</div>
<div class="box green">retrieval<small>pgvector, top 5</small></div><div class="arrow">→</div>
<div class="box accent">agent loop<small>≤ 4 model calls</small></div><div class="arrow">→</div>
<div class="box orange">output guard<small>citations</small></div><div class="arrow">→</div>
<div class="box muted">answer<small>SSE tokens + done</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: 1.2">the loop calls →</div>
<div class="box accent">large language model (LLM) gateway<small>LiteLLM: local qwen2.5:1.5b, optional claude</small></div>
<div class="box green">read-only tools<small>search_events, get_event, get_order_status</small></div>
<div class="box">metrics<small>OpenTelemetry Protocol (OTLP) → otel-lgtm</small></div>
</div>

- **FastAPI** service `assistant` (port 8088), managed with **uv** (`pyproject.toml` + `uv.lock`); embeddings by `nomic-embed-text` (768 d).

---

## Step 1 · uv and the runtime

```shell
uv init --app --name assistant --python 3.12 --no-readme --vcs none .
uv add fastapi "uvicorn[standard]" litellm "psycopg[binary,pool]" pgvector numpy httpx pydantic mcp ...
```

```dockerfile
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
RUN uv sync --frozen --no-dev --no-install-project
```

<div class="warn">

Docker on macOS has **no GPU**: run Ollama natively, `OLLAMA_URL=http://host.docker.internal:11434`.

</div>

---

## The gateway

| Concern | Here |
|---|---|
| routing | `local` always; `claude` when `ANTHROPIC_API_KEY` is set |
| fallback | `claude` → `local` on provider errors |
| timeouts, retries | 120 s, 1 retry |
| cost | tokens × price table → `assistant_llm_cost_usd_total` |

<div class="flow">
<div class="box">route claude<small>with ANTHROPIC_API_KEY</small></div><div class="arrow">→</div>
<div class="box accent">claude-opus-5-5<small>US$ 4 / 20 per M tokens</small></div><div class="arrow">outage, quota →</div>
<div class="box green">local qwen2.5:1.5b<small>US$ 0, always there</small></div>
</div>

<p class="small">One service: in-process SDK. Many AI services: the LiteLLM proxy as a shared gateway.</p>

---

## Step 2 · RAG with pgvector

```sql
embedding vector(768) NOT NULL
CREATE INDEX ... USING hnsw (embedding vector_cosine_ops);
SELECT id, 1 - (embedding <=> $q) AS score FROM assistant.documents
ORDER BY embedding <=> $q LIMIT 5;
```

- One sentence per event: what, where, when, how much.
- `search_document:` / `search_query:` prefixes (the model's training format).
- **HNSW** (Hierarchical Navigable Small World): approximate nearest neighbours — speed for a little recall.

---

## Evaluate retrieval, not vibes

- The seed is a formula → the right answers are **known**.
- 11 questions: hit@5 = **1.00**, mean reciprocal rank (MRR) = **0.94**.
- The miss: "the big festival night at the stadium" → rank 3.

<div class="ok">

Names and dates are where vector search is weakest: **hybrid search** + **reranker**.

</div>

---

## Step 3 · Tools in the shape of MCP (Model Context Protocol)

- Name + description + **JSON schema** (pydantic) + handler → what an MCP server exposes.
- **Read-only**: a manipulated model can, at worst, read.
- **Identity from `X-User-Email`** (the gateway), never from the model.
- "Not yours" = "not found": do not reveal that an order exists.
- Errors are **data** for the model; every call is a metric.

---

## The agent loop

<div class="flow">
<div class="box green">retrieve first<small>top-5 events in the prompt</small></div><div class="arrow">→</div>
<div class="box accent">call 1 … 3<small>tools offered; results back as role: tool</small></div><div class="arrow">→</div>
<div class="box orange">call 4<small>no tools: it must answer</small></div><div class="arrow">→</div>
<div class="box">account<small>tokens, US$, time to first token (TTFT)</small></div>
</div>

- Most questions need **no tool**: the context is already there. Tools are for live and private data.
- **Stream** every step; `stream_chunk_builder` rebuilds the message to see tool calls.
- The 1.5 B model called `get_order_status` in **6 of 9** tries: unreliable tool calling is why `run()` retrieves first.

---

## The first answer: right facts, no citation

<div class="flow">
<div class="box green">retrieved<small>event:50 · 2027-03-04 · R$ 300.00</small></div><div class="arrow">→</div>
<div class="box">the model answers<small>right date and price, no [event:50]</small></div><div class="arrow">→</div>
<div class="box orange">output guard<small>no citation → grounded: false</small></div>
</div>

- The test run: **760** prompt tokens, **45** completion tokens, US$ 0, **56 s** to the first token on a contended laptop CPU.
- An invented `[event:999]` becomes `[unverified]`; only citations of documents the model received count.
- Over 10 questions: **1** grounded with `qwen2.5:1.5b`, **5** with `qwen2.5:3b` — grounding is a property of model + prompt.

---

## Step 4 · Guardrails

| Check | Catches | Misses |
|---|---|---|
| length | cost attacks | — |
| injection patterns | "ignore previous instructions" | paraphrases, injected documents |
| PII redaction | CPF, cards, e-mails → `[CPF]`... | names, addresses |
| citation check | invented or missing citations | wrong claim next to a valid citation |

<div class="warn">

Patterns are a first layer. The real defense is **architecture**: read-only tools, identity the model cannot forge.

</div>

---

## Without Ollama: the simulator

<div class="flow">
<div class="box orange">3 · Ask<small>no citation → grounded: false; [event:999] → [unverified]</small></div>
<div class="box green">3 · My order<small>ana's header: PENDING_PAYMENT; bob's: order not found</small></div>
<div class="box red">4 · Guardrails<small>injection → 422, no model call; CPF → [CPF]</small></div>
<div class="box accent">MAX_STEPS<small>4 calls, the last one without tools</small></div>
</div>

- The Tools page replays this lab's runs on its code paths: the guards' regexes, `get_order_status`, the citation check.
- **Free** mode: pick the question, the `X-User-Email` header, what the model does and `MAX_STEPS`.
- Order answers come back `grounded: false` too: the check knows only catalog citations — a false alarm worth knowing.

<!--
The model's replies are the ones quoted on the pages, or a labelled alternative. The overview also embeds the playground preset boxoffice-assistant: calls to the model = questions × steps.
-->

---

## Metrics in Grafana

- `assistant_llm_tokens_total{model,type}` · `assistant_llm_cost_usd_total{model}`
- `assistant_ttft_seconds_bucket` · `assistant_duration_seconds_bucket`
- `assistant_tool_calls_total{tool,outcome}` · `assistant_guardrail_blocks_total{kind}`

<p class="small">Seconds-sized histogram buckets via an OpenTelemetry (OTel) View — the default buckets assume milliseconds.</p>

---

<!-- _class: tight -->

## Step 5 · Measure the first token

| where | concurrency | TTFT p50 | total p50 | tokens/s | req/min |
|---|---|---|---|---|---|
| Docker, laptop CPU | 1 | 5.05 s | 148 s | 0.8 | 0.35 |
| Docker, laptop CPU | 2 | 3.37 s | 127 s | 2.8 | 0.56 |
| native Ollama, Apple GPU | 1 | 0.19 s | 3.52 s | 64.0 | 19.27 |
| native Ollama, Apple GPU | 2 | 1.42 s | 3.24 s | 64.1 | 34.40 |
| native Ollama, Apple GPU | 4 | 4.64 s | 8.30 s | 64.0 | 24.65 |

- Tens of times faster on the GPU — and the same shape: one model, requests **queue**, TTFT grows with concurrency, req/min stop growing after 2.

<p class="small">k6's time to first byte is not TTFT: the script reads the Server-Sent Events (SSE) stream and stops at the first token.</p>

---

## Little's Law, again

<div class="q">

120 s per answer, 1 question per minute. How many requests in flight?

</div>

* L = λW = (1/60 s) × 120 s = **2** → the second fan waits for the first.
* Fixes: GPU, batching, admission control, smaller prompts — or a hosted API.
* Cost of 20 000 questions on Claude Opus 5.5: 20 000 × US$ 0.006 = **US$ 120**.

---

## Takeaways

1. An **LLM gateway** isolates the code from models, providers, prices and failures.
2. **RAG** grounds answers in your data — and retrieval must be **evaluated** (hit@k, MRR).
3. **Tools** for live and private data: read-only, schema-validated, identity from the platform.
4. **Bounded** agent loops: every step is latency and money.
5. **Guardrails** in and out, plus an architecture that limits what a manipulated model can do.
6. Measure **TTFT**, tokens/s and US$ per answer — Little's Law still rules.
