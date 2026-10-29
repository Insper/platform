# 12. AI Assistant

!!! info "Goal"

    Add the BoxOffice support **assistant**: a Python 3.12 + FastAPI service, managed with **uv**, that
    answers fans' questions with an LLM behind a small **LLM gateway** (LiteLLM: routes, fallback,
    timeouts, costs); grounds its answers in the catalog with **RAG** on **pgvector**; looks up live
    data through a **tool registry** in the shape of MCP, inside a bounded **agent loop**; protects the
    model and the users with **guardrails**; exports **tokens, cost and time-to-first-token** to the
    Grafana of lab 8; and is load-tested where it hurts — the first token.

On sale day, support receives thousands of the same questions: *when is the show? how much? where is
my order?* An assistant can answer them in seconds, at 3 a.m., in Portuguese and English — if it does
not invent shows, leak data or cost more than the tickets. This lab builds one with the architecture
of the [AI systems class](../../classes/ai-systems/index.md), running **entirely on your machine**
with a local open model (Ollama), and optionally on Claude for comparison.
In the [story of the course](../../index.md#story), this lab builds chapter 13: it implements the
decisions of [the LLM gateway](../../classes/ai-systems/llm-gateway/index.md) (routes and a fallback),
[the agent loop](../../classes/ai-systems/agents/index.md#loop) and its [read-only tools](../../classes/ai-systems/agents/index.md#side-effects),
[retrieval with pgvector](../../classes/ai-systems/rag-memory/index.md#embeddings) and the
[safety mesh](../../classes/ai-systems/safety-evals/index.md#guardrail-code).

## Slides

<div class="slides-embed">
  <iframe src="slides/assistant.html" title="Slides: AI assistant" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/assistant.html){:target="_blank"}

## Before you start

| | |
|---|---|
| Time | about 6 hours, including model downloads and slow local inference |
| Tools | Docker with Compose v2; **uv** (`uv --version`, from [lab 0](../0/index.md)); `curl`, `jq`. Python is managed by uv: no `pip`, no manual virtual environments |
| Docker resources | at least 4 CPUs and **8 GB** free for this lab (≈ 1.5 GB of models); on macOS, plan to run Ollama natively (step 1) |
| Disk | ≈ 3 GB for the images and the models |
| Accounts and costs | **none required**: everything runs locally and free. Optional: an Anthropic API key for the Claude route (pay-as-you-go, ≈ US$ 0.006 per question with `claude-opus-5-5`) |

Every command runs from the **root of your `boxoffice` repository**, in the state lab 11 left it:

``` text title="Start state (end of lab 11)"
boxoffice/
├── docker-compose.yaml     # the Compose stack of labs 1-9 (catalog behind gateway, order, ...)
├── .github/  k8s/          # labs 10-11
├── infra/  load/  scripts/
└── services/               # auth, catalog, gateway, inventory, notification, order, payment
```

!!! tip "Catch up"

    Skipped or broke lab 11? Download [boxoffice-after-lab-11.zip](../11/boxoffice-after-lab-11.zip),
    unzip it, `cd boxoffice`, `sh scripts/get-otel-agent.sh`, and continue from here. This lab only
    needs the Compose stack (`gateway`, `catalog`, `order`, `db`, `otel-lgtm`), not the cluster.

Every file of this lab is shown in full on these pages and published under
`https://insper.github.io/platform/2027.1/hands-on/12/code/<path>`.

## Architecture

``` diagram-sim
flowchart LR
    fan[fan / chat UI] -->|"POST /assistant/chat/stream"| api[assistant: FastAPI]
    api --> gin{input guard}
    gin --> orch[agent loop]
    orch -->|"search_query: ..."| emb[embedding model]
    emb --> vdb[("pgvector: assistant.documents")]
    vdb -->|top-k events| orch
    orch -->|LiteLLM router| gw[LLM gateway]
    gw -->|local| ollama["Ollama: qwen2.5:1.5b"]
    gw -.->|"optional, fallback to local"| claude[Claude API]
    orch -->|tool calls| reg[tool registry]
    reg -->|GET /catalog/events| cat[gateway -> catalog]
    reg -->|"GET /orders/id + X-User-Email"| ord[order]
    orch --> gout{output guard}
    gout -->|SSE tokens + done| fan
    api -.->|OTLP metrics| lgtm[otel-lgtm]
```

!!! example "BoxOffice components touched"

    | Palette component | In this lab |
    |---|---|
    | [LLM Gateway](../../reference/components/ai/index.md#llmgw) | LiteLLM `Router`: routes, fallback, timeouts, cost accounting |
    | [Orchestrator](../../reference/components/ai/index.md#orchestrator) | the bounded agent loop of `agent.py` |
    | [Tool Registry](../../reference/components/ai/index.md#toolreg) | three read-only tools with JSON schemas (MCP-style) |
    | [Memory Fabric](../../reference/components/ai/index.md#memory) | RAG: embeddings of catalog events in pgvector |
    | [Vector DB](../../reference/components/storage/index.md#vectordb) | PostgreSQL 17 + pgvector, HNSW index |
    | [Safety Mesh](../../reference/components/ai/index.md#safety) | input and output guardrails, PII redaction |

## What you will measure

| Question | Metric | Tool |
|---|---|---|
| How long until the fan sees the first word? | TTFT p50/p95 under concurrency | `scripts/assistant_load.py` |
| How fast are tokens produced? | tokens/s, requests/min | same |
| Does retrieval find the right events? | hit@5, MRR | `scripts/eval_retrieval.py` |
| Are answers grounded? | share of `grounded: true` | the API, the guard metric |
| What does an answer cost? | tokens and US$ per request | the API, `assistant_llm_cost_usd_total` |

## Prerequisites

- Labs [1](../1/index.md) (catalog), [7](../7/index.md) (order) and [8](../8/index.md) (Grafana) done.
- Read the [AI systems class](../../classes/ai-systems/index.md):
  [LLM gateway](../../classes/ai-systems/llm-gateway/index.md),
  [agents](../../classes/ai-systems/agents/index.md),
  [RAG and memory](../../classes/ai-systems/rag-memory/index.md),
  [safety and evals](../../classes/ai-systems/safety-evals/index.md).

## Steps

1. [The service and the LLM gateway](service/index.md) — Ollama, pgvector, the uv project, LiteLLM routes and fallback, the optional Claude route.
2. [RAG with pgvector](rag/index.md) — embeddings, the HNSW index, ingestion of the catalog, retrieval evaluation.
3. [Tools and the agent loop](tools/index.md) — the tool registry, the bounded loop, streaming, the API.
4. [Guardrails and metrics](guardrails/index.md) — injection and PII on the way in, grounding on the way out; tokens, cost and TTFT in Grafana.
5. [Measure it](measure/index.md) — TTFT under load, retrieval and answer quality, model choice.

## Try it in the playground

**Try it:** run the `ai-assistant` scenario with the `load` profile. Raise the orchestrator's `steps`
from 1 to 4 and watch the latency and the cost per request multiply — every step is another LLM call.
Then enable the semantic cache of the LLM gateway and see which share of the traffic never reaches the
model.

<div class="sdp" data-scenario="ai-assistant" data-mode="compact" data-height="520"></div>

The full simulator is in the [playground](../../../playground/index.md).

## Measure it

The [Measure it](measure/index.md) step has the scripts and the results table to keep in
`results/lab12.md`.

## Troubleshooting { #troubleshooting }

| Symptom | Likely cause | Fix |
|---|---|---|
| answers take minutes | the model runs on a CPU (always the case in Docker on macOS) | run Ollama natively and set `OLLAMA_URL=http://host.docker.internal:11434`; close other stacks; ask shorter questions |
| `litellm.APIConnectionError … Connection refused` in the logs | Ollama is not running or `OLLAMA_URL` is wrong | `docker compose ps ollama` / `ollama list`; check the variable in `docker-compose.yaml` |
| `model "qwen2.5:1.5b" not found` | the model was not pulled | `docker compose up ollama-init` (or `ollama pull qwen2.5:1.5b` natively) |
| startup fails with `type "vector" does not exist` | `db` still runs the plain `postgres:17` image | `docker compose up -d db` after updating the compose file; `docker compose exec db psql -U boxoffice -c "\dx"` lists `vector` |
| `/assistant/ingest` returns `{"ingested":0}` | the catalog is not reachable at `http://gateway:8080` | `docker compose ps gateway catalog-1`; `docker compose exec assistant python -c "import urllib.request;print(urllib.request.urlopen('http://gateway:8080/catalog/events/1').status)"` |
| `uv sync --frozen` fails in the build | `uv.lock` does not match `pyproject.toml` | run `uv lock` in `services/assistant` (on your machine) and rebuild |
| no `assistant_*` metrics in Grafana | `OTEL_EXPORTER_OTLP_ENDPOINT` not set, or no question answered yet | check the variables of `assistant`; metrics are exported every 10 s |
| `Bind for 0.0.0.0:11434 failed: port is already allocated` | Ollama already runs natively on your machine, and `docker compose up -d` started the `ollama` container too | keep the native one: `docker compose stop ollama ollama-init`, and start services by name (`docker compose up -d assistant`) with `OLLAMA_URL` exported |
| `422 blocked` for a normal question | a false positive of the injection patterns | rephrase, and note it: false positives are part of the guardrail's measured quality |

!!! success "Best practices in this lab"

    - **Routes instead of model names, with a fallback** — `app/llm.py` asks for `local` or `claude`, and `claude` falls back to `local`; why: [LLM Gateway](../../classes/ai-systems/llm-gateway/index.md).
    - **A bounded loop that always ends with an answer** — `app/agent.py` stops at `MAX_STEPS` = 4 and makes the last call without tools; why: [the agent loop](../../classes/ai-systems/agents/index.md#loop).
    - **Read-only tools, identity from the platform** — `app/tools.py` takes the fan from `X-User-Email` and never writes; why: [tools are side effects](../../classes/ai-systems/agents/index.md#side-effects).
    - **Retrieval measured on its own** — `scripts/eval_retrieval.py` scores hit@k and MRR before any model answers; why: [RAG & Memory](../../classes/ai-systems/rag-memory/index.md#hybrid).
    - **Redact before the model, check citations after it, measure TTFT in seconds** — `app/guardrails.py` and `app/metrics.py`; why: [Safety, Evals & Observability](../../classes/ai-systems/safety-evals/index.md#guardrail-code).

## Clean up

``` shell
docker compose stop assistant ollama        # free the CPU/RAM of the model
docker compose down -v                      # or remove everything (including the downloaded models)
```

`docker compose down -v` also deletes the `ollama-models` volume: the next run downloads the models
again. Keep it if you continue to lab 13, which can use the same local model.

## End state

``` text title="End state (what this lab added or changed)"
boxoffice/
├── docker-compose.yaml     # db/db-replica -> pgvector image; + ollama, ollama-init, assistant
├── scripts/
│   ├── assistant_load.py   # TTFT load test (uv inline script)
│   └── eval_retrieval.py   # hit@k / MRR (uv inline script)
├── results/lab12.md
└── services/assistant/     # new: pyproject.toml, uv.lock, .python-version, Dockerfile, .dockerignore,
    └── app/                # __init__, config, llm, db, rag, tools, agent, guardrails, metrics, main
```

Commit and tag: `git add -A && git commit -m "lab 12: AI assistant" && git tag lab12`.

## Checklist

- [ ] `ollama`, `ollama-init` and `assistant` run in `docker-compose.yaml` (or Ollama natively, with `OLLAMA_URL`); `db` uses the pgvector image
- [ ] `services/assistant` is a uv project with `pyproject.toml` and `uv.lock` committed; the image builds with `uv sync --frozen`
- [ ] `/assistant/ingest` loaded at least 300 events; `scripts/eval_retrieval.py` reports hit@5 and MRR
- [ ] `/assistant/chat` and `/assistant/chat/stream` answer with citations checked by the output guard; an injection attempt returns `422`
- [ ] `get_order_status` only answers for the user in `X-User-Email`
- [ ] `assistant_*` metrics (tokens, cost, TTFT) visible in Grafana
- [ ] results table filled in `results/lab12.md`, including where the model ran
- [ ] self-check: `docker compose up -d --build assistant` from a clean clone, then `curl localhost:8088/assistant/health` returns `"status":"UP"`; pushed with the tag `lab12`

## Related

- Theory: [AI systems and agents](../../classes/ai-systems/index.md) ·
  [LLM gateway](../../classes/ai-systems/llm-gateway/index.md) ·
  [Agents and tools](../../classes/ai-systems/agents/index.md) ·
  [RAG and memory](../../classes/ai-systems/rag-memory/index.md) ·
  [Safety and evals](../../classes/ai-systems/safety-evals/index.md)
- Case study: [AI assistant](../../classes/case-studies/ai-assistant/index.md)
- Next lab: [13. AI in CI/CD](../13/index.md) uses language models inside the delivery pipeline of lab 11.

[Start: The service and the LLM gateway](service/index.md){ .md-button .md-button--primary }
