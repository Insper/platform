# 1. The Service and the LLM Gateway

This step creates the `assistant` service — Python 3.12 + FastAPI, managed with **uv** — and its
**LLM gateway**: the one module that knows which models exist, which one answers by default, what to
do when a provider fails, and how much each answer costs. All commands run from the **root of your
`boxoffice` repository** unless a `cd` says otherwise.

## Infrastructure: a local LLM and a vector-capable PostgreSQL

| Container | Image | Port | Role |
|---|---|---|---|
| `ollama` | `ollama/ollama:0.40.6` | 11434 | runs the local models: `qwen2.5:1.5b` (chat, with tool calling) and `nomic-embed-text` (embeddings, 768 dimensions) |
| `ollama-init` | `ollama/ollama:0.40.6` | — | one-shot: downloads both models (≈ 1.3 GB, once) |
| `db` and `db-replica` | `pgvector/pgvector:0.8.7-pg17-trixie` | 5432 / 5433 | the same PostgreSQL 17, now with the `vector` extension available |
| `assistant` | `services/assistant` | 8088 | the FastAPI service of this lab |

The new part of `docker-compose.yaml`:

``` yaml title="docker-compose.yaml (excerpt)"
  ollama:
    image: ollama/ollama:0.40.6
    ports:
      - "11434:11434"
    volumes:
      - ollama-models:/root/.ollama      # models survive restarts (about 1.3 GB)
    healthcheck:                         # ollama-init must wait for the server, not just the container
      test: ["CMD", "ollama", "list"]
      interval: 5s
      timeout: 5s
      retries: 12

  # one-shot: download the chat model and the embedding model, then exit
  ollama-init:
    image: ollama/ollama:0.40.6
    environment:
      OLLAMA_HOST: ollama:11434
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        ollama pull ${LOCAL_MODEL_TAG:-qwen2.5:1.5b} && ollama pull nomic-embed-text
    depends_on:
      ollama:
        condition: service_healthy
    restart: "no"
```

Get the complete file (lab 9's plus the pgvector image for `db`/`db-replica`, `ollama`, `ollama-init`
and `assistant`):

``` shell
curl -fsSL -o docker-compose.yaml https://insper.github.io/platform/2027.1/hands-on/12/code/docker-compose.yaml
```

??? example "docker-compose.yaml — the complete file at the end of this lab"

    ``` yaml title="docker-compose.yaml"
    --8<-- "docs/2027.1/hands-on/12/code/docker-compose.yaml"
    ```

!!! warning "Where should the model run? (read before pulling)"

    A language model is a lot of arithmetic; where it runs decides your latency.

    === "macOS (Apple Silicon)"

        Docker on macOS has **no GPU access**: in a container the model runs on the CPU and a short
        answer can take a minute. Run Ollama **natively** instead (it uses the GPU through Metal) and
        point the assistant at it:

        ``` shell
        brew install ollama && ollama serve &          # or the app from ollama.com
        ollama pull qwen2.5:1.5b && ollama pull nomic-embed-text
        export OLLAMA_URL=http://host.docker.internal:11434
        ```

        and skip the `ollama` and `ollama-init` containers below.

    === "Linux with an NVIDIA GPU"

        Install the NVIDIA Container Toolkit and add to the `ollama` service:
        `deploy: { resources: { reservations: { devices: [{ driver: nvidia, count: all, capabilities: [gpu] }] } } }`.

    === "CPU only (Windows/WSL, Linux)"

        Use the containers as they are. It works, slowly: in a test run on a busy 8-core laptop the
        first token took tens of seconds. Prefer short questions, and compare with the optional Claude
        route of this page.

Start the infrastructure (the `db` image changes, so `db` restarts once):

<!-- termynal -->

``` shell
> docker compose up -d db db-replica ollama ollama-init
> docker compose wait ollama-init
container "c8d93485…" exited with status code 0
> docker compose exec ollama ollama list
NAME                       ID              SIZE      MODIFIED
nomic-embed-text:latest    0a109f422b47    274 MB    7 seconds ago
qwen2.5:1.5b               65ec06548149    986 MB    29 seconds ago
```

`docker compose wait` blocks until the one-shot `ollama-init` has downloaded both models (a minute or
two the first time) and prints its exit code: 0. (`docker compose logs -f ollama-init` would not return
if the container has already exited.) You should see both models in the list (`ollama list` on your machine if Ollama runs natively). With
native Ollama (macOS), start only `docker compose up -d db db-replica`: an `ollama` container would
fail with `port is already allocated` on 11434, which the native server already uses.

## The project: uv

**uv** (from Astral) creates the virtual environment, resolves the dependencies and writes a lock
file with the exact version and hash of every package, so that your laptop, CI and the container
install the same bytes. The project was created with these commands (you can run them yourself in an
empty `services/assistant/`, or download the files below):

``` shell
mkdir -p services/assistant && cd services/assistant
uv init --app --name assistant --python 3.12 --no-readme --vcs none .
rm main.py
uv add "fastapi>=0.146" "uvicorn[standard]>=0.54" "litellm>=1.106" "psycopg[binary,pool]>=3.3" \
  "pgvector>=0.5" "numpy>=2.3" "httpx>=0.28" "pydantic>=2.14" "mcp>=1.20" \
  "opentelemetry-sdk>=1.45" "opentelemetry-exporter-otlp-proto-http>=1.45"
cd ../..
```

`uv add` edits `pyproject.toml` and writes `uv.lock` (≈ 3 000 lines: commit it, never edit it by hand;
download it from `https://insper.github.io/platform/2027.1/hands-on/12/code/services/assistant/uv.lock`
if you prefer the exact versions of this handout). uv does not write the `Dockerfile` and the
`.dockerignore`: create them from the tabs below. If you skip `uv init`, also download `pyproject.toml`
from the same address and create `.python-version` from its tab (the site does not serve files whose
names start with a dot).

=== "pyproject.toml"

    ``` toml title="services/assistant/pyproject.toml"
    --8<-- "docs/2027.1/hands-on/12/code/services/assistant/pyproject.toml"
    ```

=== ".python-version"

    ``` text title="services/assistant/.python-version"
    --8<-- "docs/2027.1/hands-on/12/code/services/assistant/.python-version"
    ```

=== "Dockerfile"

    ``` dockerfile title="services/assistant/Dockerfile"
    --8<-- "docs/2027.1/hands-on/12/code/services/assistant/Dockerfile"
    ```

=== ".dockerignore"

    ``` text title="services/assistant/.dockerignore"
    --8<-- "docs/2027.1/hands-on/12/code/services/assistant/.dockerignore"
    ```

`uv sync --frozen` fails if `uv.lock` does not match `pyproject.toml` — the build never resolves
versions on its own. (`mcp` is listed because LiteLLM imports it when a request carries tools.)

Running Python locally (step 4 does) writes `__pycache__/` folders next to the code; add two lines to
the root `.gitignore` so that `git add -A` leaves them, and any `.venv/`, out:

``` text title=".gitignore"
--8<-- "docs/2027.1/hands-on/12/code/.gitignore"
```

## Configuration and the gateway

=== "app/config.py"

    ``` python title="services/assistant/app/config.py"
    --8<-- "docs/2027.1/hands-on/12/code/services/assistant/app/config.py"
    ```

=== "app/llm.py"

    ``` python title="services/assistant/app/llm.py"
    --8<-- "docs/2027.1/hands-on/12/code/services/assistant/app/llm.py"
    ```

=== "app/__init__.py"

    ``` python title="services/assistant/app/__init__.py"
    --8<-- "docs/2027.1/hands-on/12/code/services/assistant/app/__init__.py"
    ```

LiteLLM gives every provider the same OpenAI-style interface, and its `Router` is the gateway of the
[LLM gateway class](../../../classes/ai-systems/llm-gateway/index.md):

| Concern | Here |
|---|---|
| **Routing** | two *routes*: `local` (Ollama) always, `claude` only when `ANTHROPIC_API_KEY` is set; `ASSISTANT_ROUTE` or the request's `route` field chooses |
| **Fallback** | `claude` → `local` when the provider fails (outage, rate limit, no credit) |
| **Timeouts and retries** | 120 s per call, 1 retry — an LLM call is the slowest dependency BoxOffice has |
| **Cost** | `app/metrics.py` (step 4) multiplies the tokens of each answer by the provider's price |

!!! info "Why an in-process SDK and not the LiteLLM proxy?"

    LiteLLM also runs as a separate **proxy** (an OpenAI-compatible HTTP server with keys, budgets and
    a UI) shared by many services. One service does not need it: the in-process `Router` has the same
    routing logic without another container. With several AI services, the proxy becomes the shared
    gateway — the same move as from per-service resilience (lab 9) to a service mesh.

## The optional Claude route (costs money)

The lab works end to end with the local model. To compare with a frontier model, create an API key at
[console.anthropic.com](https://console.anthropic.com) (pay-as-you-go: you are charged per token —
the default `anthropic/claude-opus-5-5` costs US$ 4 per million input tokens and US$ 20 per million
output tokens; one question of this lab uses about 1 000 input and 100 output tokens, ≈ US$ 0.006) and
export it **before** starting the assistant:

``` shell
export ANTHROPIC_API_KEY=sk-ant-...       # never commit it; docker-compose.yaml reads it from the shell
```

With the key, the default route becomes `claude`; send `"route": "local"` in a request to compare. Without it, nothing
calls the paid API.

## Start it

Steps 2 and 3 explain the remaining files of `app/`; download them all now so the service starts:

``` shell
mkdir -p services/assistant/app
for f in __init__ config llm db rag tools guardrails agent metrics main; do
  curl -fsSL -o services/assistant/app/$f.py \
    https://insper.github.io/platform/2027.1/hands-on/12/code/services/assistant/app/$f.py
done
docker compose up -d --wait gateway order otel-lgtm      # what the assistant calls, with their dependencies
docker compose up -d --build --wait assistant
curl -s localhost:8088/assistant/health
```

You should see `{"status":"UP","documents":0,"route":"local"}` (`"route":"claude"` if you exported a
key). `documents` is 0: the knowledge base is empty until step 2. Start the services by name, as above:
a bare `docker compose up -d` also starts the `ollama` container, which fails next to a native Ollama.

!!! warning "Route `claude` without meaning to?"

    Then `ANTHROPIC_API_KEY` is already set in your shell (other tools use the same variable), and every
    question goes to the paid API. `unset ANTHROPIC_API_KEY` and run `docker compose up -d --wait assistant`
    again: the health check must show `"route":"local"`.

[Next: RAG with pgvector](../rag/index.md){ .md-button .md-button--primary }
