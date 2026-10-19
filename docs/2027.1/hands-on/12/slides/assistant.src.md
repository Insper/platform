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

<div class="kicker">System Architecture · Insper</div>

# Hands-on 12 — AI Assistant

**Gateway, RAG, tools, guardrails — and the cost of the first token**

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
- Leak CPFs and card numbers to a third-party provider.
- Cost more than the tickets, or take a minute to start answering.

---

## Architecture

- **FastAPI** service `assistant` (port 8088), managed with **uv** (`pyproject.toml` + `uv.lock`).
- **LLM gateway**: LiteLLM `Router` — route `local` (Ollama `qwen2.5:1.5b`), optional `claude` with fallback.
- **Memory**: catalog events embedded (`nomic-embed-text`, 768 d) in **pgvector**.
- **Tools**: `search_events`, `get_event`, `get_order_status` — read-only, JSON schemas.
- **Safety**: input guard (length, injection, PII) + output guard (citations).
- **Metrics**: OTLP → otel-lgtm: tokens, US$, TTFT.

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
- **HNSW**: approximate nearest neighbours — speed for a little recall.

---

## Evaluate retrieval, not vibes

- The seed is a formula → the right answers are **known**.
- 11 questions: hit@5 = **1.00**, MRR = **0.94**.
- The miss: "the big festival night at the stadium" → rank 3.

<div class="ok">

Names and dates are where vector search is weakest: **hybrid search** + **reranker**.

</div>

---

## Step 3 · Tools, MCP-style

- Name + description + **JSON schema** (pydantic) + handler → what an MCP server exposes.
- **Read-only**: a manipulated model can, at worst, read.
- **Identity from `X-User-Email`** (the gateway), never from the model.
- "Not yours" = "not found": do not reveal that an order exists.
- Errors are **data** for the model; every call is a metric.

---

## The agent loop

1. **Retrieve first**: top-k events in the prompt — most questions need no tool.
2. Up to **4** model calls; the last one without tools.
3. **Stream** every step; rebuild the message to see tool calls.
4. Tool results go back as `role: tool` — data, not instructions.
5. Account: tokens, US$, TTFT, duration.

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

## Metrics in Grafana

- `assistant_llm_tokens_total{model,type}` · `assistant_llm_cost_usd_total{model}`
- `assistant_ttft_seconds_bucket` · `assistant_duration_seconds_bucket`
- `assistant_tool_calls_total{tool,outcome}` · `assistant_guardrail_blocks_total{kind}`

<p class="small">Seconds-sized histogram buckets via an OTel View — the default buckets assume milliseconds.</p>

---

<!-- _class: tight -->

## Step 5 · Measure the first token

| concurrency | TTFT p50 | total p50 | tokens/s | req/min |
|---|---|---|---|---|
| 1 | 5.05 s | 148 s | 0.8 | 0.35 |
| 2 | 3.37 s | 127 s | 2.8 | 0.56 |

<p class="small">qwen2.5:1.5b on a busy laptop CPU, in Docker. k6's time-to-first-byte is not TTFT: the script reads the SSE stream.</p>

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
