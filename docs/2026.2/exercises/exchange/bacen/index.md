Some free exchange-rate APIs block requests that come from cloud providers: the service answers on your laptop and fails once it runs on AWS. The **PTAX** of the Central Bank of Brazil (BCB, *Banco Central do Brasil*) is a public API, with no key and no sign-up, that quotes every major currency in Brazilian reals (BRL). This page gives the whole exchange microservice, in Python with FastAPI, backed by PTAX: **your job is the container** and wiring it into the platform.

!!! objectives "Learning objectives"

    After this page you should be able to:

    - **Containerize** a Python service managed by uv, with a reproducible lock file.
    - **Integrate** a new microservice into the Compose stack and behind the gateway.
    - **Explain** how a cross rate (USD → EUR) comes out of quotes that are all in BRL.

!!! info "Optional"

    Using this service is an **option** of the [Exchange API](../index.md) exercise: you may still write your own service on any third-party API. If you take this one, say so in your repository's README.

## How it works

The gateway resolves who is calling and forwards the request with the `id-account` header. The service asks PTAX for the latest quote of each currency in BRL (the last 7 days, since weekends and holidays have no quote), keeps it in memory for 5 minutes and divides one by the other. Only one request per currency refreshes the cache at a time: the others wait for it instead of all calling the BCB together. When PTAX fails and an old rate is in memory, the service answers with it.

``` mermaid-sim
sequenceDiagram
    participant G as gateway
    participant E as exchange
    participant P as PTAX (BCB)
    G->>E: GET /exchange/USD/EUR + id-account
    E->>P: CotacaoMoedaPeriodo USD, last 7 days
    P-->>E: buy/sell in BRL, every bulletin
    E->>P: CotacaoMoedaPeriodo EUR, last 7 days
    P-->>E: buy/sell in BRL, every bulletin
    E->>E: cross rate through BRL, cache 5 min
    E-->>G: {"sell", "buy", "date", "id-account"}
```

PTAX only quotes against the real, so USD → EUR goes through BRL. With $c$ (buy) and $v$ (sell) the PTAX quotes in BRL:

$$
\text{buy} = \frac{c_\text{USD}}{v_\text{EUR}} \qquad\qquad \text{sell} = \frac{v_\text{USD}}{c_\text{EUR}}
$$

`buy` is what the market pays for 1 USD, in euros (it buys your dollars and sells you euros); `sell` is what it charges. BRL itself counts as 1, so `GET /exchange/USD/BRL` is the PTAX quote of the dollar.

## The project

```text
exchange/
├── pyproject.toml
├── uv.lock          # created by uv lock: commit it
└── main.py
```

=== "pyproject.toml"

    ``` { .toml .copy .select linenums="1" }
    --8<-- "docs/2026.2/exercises/exchange/bacen/code/pyproject.toml"
    ```

=== "main.py"

    ``` { .python .copy .select linenums="1" }
    --8<-- "docs/2026.2/exercises/exchange/bacen/code/main.py"
    ```

| Endpoint | Returns |
|---|---|
| `GET /exchange/{from}/{to}` | the rate from one currency to another (also answers on `/exchanges/...`, as the exercise statement spells it) |
| `GET /exchange/currencies` | the currencies PTAX quotes, besides BRL |
| `GET /health` | `{"status": "ok"}`, for the container health check |

Every rate response carries the header `X-Cache`: `miss` (PTAX was called), `hit` (rate from memory) or `stale` (PTAX failed and an expired rate was served). The settings come from environment variables, so the container changes them without a new image:

| Variable | Default | What it sets |
|---|---|---|
| `PTAX_URL` | the BCB address | base URL of the PTAX API |
| `PTAX_TIMEOUT` | `3` | seconds to wait for PTAX |
| `CACHE_SECONDS` | `300` | how long a rate is reused before asking PTAX again |
| `RETRY_SECONDS` | `30` | after a failed call, how long the old rate is served before trying again |

## Run it locally

In the `exchange/` folder:

``` { .bash .copy }
uv lock                                   # creates uv.lock from pyproject.toml
uv run uvicorn main:app --reload --port 8000
```

In another terminal:

``` { .bash .copy }
curl -H "id-account: 0195ae95-5be7-7dd3-b35d-7a7d87c404fb" localhost:8000/exchange/USD/EUR
```

You should see something like:

``` { .json }
{"sell":0.906885,"buy":0.9066,"date":"2026-11-13 13:03:27","id-account":"0195ae95-5be7-7dd3-b35d-7a7d87c404fb"}
```

The `date` is the PTAX bulletin used: on a weekend or before 10 a.m. (Brasília) it is the last business day. Without the header the service answers `422`; an unknown currency (`/exchange/XYZ/BRL`) answers `404`.

## Your task: the container

1. Write the `Dockerfile` of the service:
    - base image `python:3.12-slim`, with the `uv` binary copied from `ghcr.io/astral-sh/uv`[^1];
    - copy `pyproject.toml` and `uv.lock` **before** `main.py` and run `uv sync --frozen`, so a code change does not reinstall the dependencies;
    - start `uvicorn main:app` on `0.0.0.0:8000`.
1. Add the service `exchange` to the platform's `compose.yaml` (no port published: only the gateway reaches it).
1. Add the gateway route `Path=/exchange/**` → `http://exchange:8000`, behind authentication like the other business routes.
1. Check it through the gateway: log in, then `GET /exchange/USD/EUR` with the token returns the rate and your `id-account`.
1. In the cloud: from a pod of the cluster, `curl` the PTAX URL once to confirm the provider answers from AWS.

!!! warning "Limits of PTAX"

    - Quotes only exist on business days, between about 10 a.m. and 1 p.m. (Brasília); outside that window the service returns the last bulletin.
    - The cache lives in the process memory: a restarted container asks PTAX again, and if BCB does not answer and there is no cached rate the service answers `502`.
    - PTAX is a public service of the BCB: do not load test it. Keep the cache on; a load test against your gateway should cause only a handful of calls to PTAX (count the `X-Cache: miss`).

[^1]: [Using uv in Docker](https://docs.astral.sh/uv/guides/integration/docker/){target="_blank"}.
