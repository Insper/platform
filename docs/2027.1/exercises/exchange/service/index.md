The exchange service of [exercise 8](../index.md), ready to run: Python with FastAPI, backed by the **PTAX** of the Central Bank of Brazil (BCB, *Banco Central do Brasil*). PTAX is a public API, with no key and no sign-up, that quotes every major currency in Brazilian reals (BRL). Some free exchange-rate APIs block requests that come from cloud providers; PTAX is the default here because it does not need an account, but it is still a provider you do not own, and the exercise is about living with that.

!!! objectives "Learning objectives"

    After this page you should be able to:

    - **Read** a small service that calls an external provider through a cache, a timeout and a stale fallback.
    - **Explain** how a cross rate (USD → EUR) comes out of quotes that are all in BRL.
    - **Run** the service with uv and read the `X-Cache` header of each answer.

## How it works

The service asks PTAX for the latest quote of each currency in BRL (the last 7 days, since weekends and holidays have no quote), keeps it in memory for `CACHE_SECONDS` and divides one by the other. Only one request per currency refreshes the cache at a time; the others wait for it instead of all calling the BCB together. When PTAX fails and an old rate is in memory, the service answers with it and tries again only after `RETRY_SECONDS`.

``` diagram-sim
sequenceDiagram
    participant G as gateway
    participant E as exchange
    participant P as PTAX (BCB)
    G->>E: GET /exchange/USD/EUR
    E->>P: CotacaoMoedaPeriodo USD, last 7 days
    P-->>E: buy/sell in BRL, every bulletin
    E->>P: CotacaoMoedaPeriodo EUR, last 7 days
    P-->>E: buy/sell in BRL, every bulletin
    E->>E: cross rate through BRL, keep both quotes
    E-->>G: 200 rate, X-Cache miss
    G->>E: GET /exchange/USD/EUR (within CACHE_SECONDS)
    E-->>G: 200 rate, X-Cache hit (PTAX not called)
```

PTAX only quotes against the real, so USD → EUR goes through BRL. With $c$ (buy) and $v$ (sell) the PTAX quotes in BRL:

$$
\text{buy} = \frac{c_\text{USD}}{v_\text{EUR}} \qquad\qquad \text{sell} = \frac{v_\text{USD}}{c_\text{EUR}}
$$

`buy` is what the market pays for 1 USD, in euros (it buys your dollars and sells you euros); `sell` is what it charges. BRL itself counts as 1, so `GET /exchange/USD/BRL` is the PTAX quote of the dollar.

| Piece | What it protects |
|---|---|
| Cache of `CACHE_SECONDS` (300) per currency | PTAX publishes a few bulletins a day: thousands of fans asking the rate cost a handful of calls |
| One refresh per currency at a time (`asyncio.Lock`) | A cold or expired cache under load does not become a burst of identical calls to the provider |
| Timeout of `PTAX_TIMEOUT` (3 s) | A slow provider cannot hold a request for longer than a fan would wait |
| Stale rate for `RETRY_SECONDS` (30) after a failure | The provider is down or blocking us: an old rate beats an error, and we do not retry on every request |
| `X-Cache: miss / hit / stale` | You can count, from outside, how often the provider was called and how often it failed |

## The project

In the BoxOffice repository the service lives in `services/exchange/`:

```text
services/exchange/
├── pyproject.toml
├── uv.lock          # created by uv lock: commit it
├── main.py
└── Dockerfile       # your part (exercise 8, step 2)
```

=== "pyproject.toml"

    ``` { .toml .copy .select linenums="1" }
    --8<-- "docs/2027.1/exercises/exchange/service/code/pyproject.toml"
    ```

=== "main.py"

    ``` { .python .copy .select linenums="1" }
    --8<-- "docs/2027.1/exercises/exchange/service/code/main.py"
    ```

| Endpoint | Returns |
|---|---|
| `GET /exchange/{from}/{to}` | the rate from one currency to another, with the header `X-Cache` |
| `GET /exchange/currencies` | the currencies PTAX quotes, besides BRL |
| `GET /health` | `{"status": "ok"}`, for the container health check |

The settings come from environment variables, so Compose or Kubernetes changes them without a new image:

| Variable | Default | What it sets |
|---|---|---|
| `PTAX_URL` | the BCB address | base URL of the PTAX API |
| `PTAX_TIMEOUT` | `3` | seconds to wait for PTAX |
| `CACHE_SECONDS` | `300` | how long a rate is reused before asking PTAX again |
| `RETRY_SECONDS` | `30` | after a failed call, how long the old rate is served before trying again |

## Run it locally

In `services/exchange/`:

``` { .bash .copy }
uv lock                                   # creates uv.lock from pyproject.toml
uv run uvicorn main:app --reload --port 8000
```

In another terminal, twice:

``` { .bash .copy }
curl -i localhost:8000/exchange/USD/EUR
```

You should see `x-cache: miss` on the first answer and `x-cache: hit` on the second, with the same body:

``` { .json }
{"from":"USD","to":"EUR","sell":0.906885,"buy":0.9066,"date":"2026-11-13 13:03:27"}
```

The `date` is the PTAX bulletin used: on a weekend or before 10 a.m. (Brasília) it is the last business day. An unknown currency (`/exchange/XYZ/BRL`) answers `404`; PTAX unreachable with nothing in memory answers `502`.

!!! warning "PTAX is not yours to load test"

    - Quotes only exist on business days, between about 10 a.m. and 1 p.m. (Brasília); outside that window the service returns the last bulletin.
    - PTAX is a public service of the BCB, shared by every student of the class. **Never run a load test with the cache off** (`CACHE_SECONDS=0`): a k6 run at 100 requests/s would send the BCB 200 calls per second, and a provider that sees that from one address blocks it. With the cache on, the whole run of exercise 8 costs a handful of calls.
