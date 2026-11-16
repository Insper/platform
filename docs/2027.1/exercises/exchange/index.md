BoxOffice's next on-sale is an international tour, and fans abroad want the price of a seat in their own currency. The rate comes from a provider BoxOffice does not own, just like the payment provider of chapter 10: it publishes a few times a day, it can be slow or down, and some free providers refuse requests that come from a cloud address. In this **optional** exercise you take a ready exchange service, put it in a container, behind the gateway, and then prove with numbers what its cache costs the provider and what the fans see when the provider goes away.

!!! objectives "Learning objectives"

    After this exercise you will be able to:

    - **Containerize** a Python service managed by uv, with a lock file and a layer order that keeps rebuilds fast.
    - **Integrate** a new service into BoxOffice's Compose stack and behind the gateway's authentication.
    - **Isolate** a service's outbound traffic with Docker networks, and cut it to simulate a provider outage.
    - **Measure** how many calls a cache saves an external provider, and what a stale fallback gives the fans during an outage.

## Context

[Class 7](../../classes/caching/index.md) showed cache-aside and the stampede of an expired key; [class 10](../../classes/reliability/index.md) showed what a slow dependency does to its callers and how timeouts and fallbacks contain it. [Lab 4](../../hands-on/4/index.md) built the gateway, [lab 5](../../hands-on/5/index.md) the cache and [lab 9](../../hands-on/9/index.md) broke the payment provider on purpose. Here the provider is real: the **PTAX** of the Central Bank of Brazil (BCB, *Banco Central do Brasil*), wrapped by the [exchange service](service/index.md), which is given ready. **Your part is the container, the wiring and the measurements.**

``` diagram-sim
flowchart LR
    k6([k6]) -->|"GET /exchange/USD/EUR + token"| edge[edge]:::tech
    edge --> gateway[gateway]:::comp
    gateway -->|"exchange-net (internal)"| exchange[exchange]:::comp
    exchange -->|"egress · only on a miss"| ptax[(PTAX · BCB)]:::problem
```

The service answers every rate with the header `X-Cache`: `miss` when it called PTAX, `hit` when the rate came from memory and `stale` when PTAX failed and an expired rate was served. That header is what you count.

## Task

1. Copy the [exchange service](service/index.md) into `services/exchange/` and write its **Dockerfile**.
1. Add `exchange` to `compose.yaml` on two networks: an **internal** one shared with the gateway and an **egress** one to the internet.
1. Add the gateway route `/exchange/**`, behind authentication.
1. **E1, cache:** run the k6 script at 100 requests/s and count the calls that reached PTAX, with `CACHE_SECONDS` at 300 and at 30.
1. **E2, outage:** during a k6 run, cut the service's egress network for 2 minutes and measure what the fans received.
1. **E3, cold start in an outage:** restart the service while the egress is cut and explain the result.

## Requirements

- [ ] **(mandatory)** `services/exchange/Dockerfile` builds an image that starts with `docker compose up` and answers `GET /health`; dependencies installed by `uv sync --frozen` from the committed `uv.lock`.
- [ ] **(mandatory)** `exchange` publishes **no port** and is reachable only through the gateway; `GET /exchange/USD/EUR` without a token answers `401` and with a token answers `200`.
- [ ] **(mandatory)** E1 and E2 results come from your runs: k6 summary with the `exchange_cache` counts by result, `http_req_failed` and the latency percentiles.
- [ ] Image layers ordered so that a change to `main.py` does not reinstall the dependencies (show the second build's output).
- [ ] Container health check on `/health`, and the image runs as a non-root user.
- [ ] E1: the number of `miss` predicted before the run (currencies × windows of `CACHE_SECONDS`) and compared with the measured one, for both settings.
- [ ] E2: errors and the `stale` count during the cut, latency p95/p99 before, during and after, and the moment PTAX was called again after the reconnection.
- [ ] E3: what the fans receive after the restart, why, and one change that would fix it (with its trade-off).
- [ ] *AI usage* section (see the [policy](../index.md#use-of-ai-tools)).

## Deliverables

In your repository (tag `ex8`): `services/exchange/` with the Dockerfile and `uv.lock`, the `compose.yaml` and gateway changes, `load/exchange.js`, the k6 outputs; an `exchange` page on your documentation site following the [template](#templates).

## Step by step

### 1. The service

Create `services/exchange/` with `pyproject.toml` and `main.py` from the [service page](service/index.md), then, in that folder:

``` { .bash .copy }
uv lock
uv run uvicorn main:app --port 8000
```

You should see `x-cache: miss` and then `x-cache: hit` with `curl -i localhost:8000/exchange/USD/EUR` twice. Stop it (++ctrl+c++).

### 2. The Dockerfile

Write `services/exchange/Dockerfile`. What it must do:

- start from `python:3.12-slim` and copy the `uv` binary from `ghcr.io/astral-sh/uv`[^1];
- copy `pyproject.toml` and `uv.lock` **before** `main.py` and run `uv sync --frozen --no-dev`, so that a change to the code reuses the dependency layer;
- run as a non-root user and start `uvicorn main:app` on `0.0.0.0:8000`.

From the repository root:

``` { .bash .copy }
docker build -t boxoffice-exchange services/exchange
docker run --rm -p 8000:8000 boxoffice-exchange
```

You should see `Uvicorn running on http://0.0.0.0:8000`, and the same `miss`/`hit` pair as in step 1. Change a comment in `main.py` and build again: the `uv sync` step must say `CACHED`.

### 3. Compose: two networks

The internet egress goes on its own network so that you can cut it without cutting the gateway. A Compose network with `internal: true` has no route outside the host: the gateway reaches `exchange` through it, and PTAX is reachable only through `egress`.

```yaml title="compose.yaml (excerpt)"
services:
  gateway:
    # ...everything the gateway already has, plus:
    networks: [default, exchange-net]
    environment:
      EXCHANGE_URL: http://exchange:8000

  exchange:
    build: ./services/exchange
    networks: [exchange-net, egress]
    environment:
      CACHE_SECONDS: ${EXCHANGE_CACHE_SECONDS:-300}
      RETRY_SECONDS: 30
      PTAX_TIMEOUT: 3
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 256M

networks:
  exchange-net:
    internal: true
  egress: {}
```

``` { .bash .copy }
docker compose up -d --build exchange gateway
docker compose ps exchange
```

You should see `exchange` as `running` (and `healthy` once your health check passes), with no port in the `PORTS` column.

### 4. The gateway route

Add the route to `services/gateway/src/main/resources/application.yaml`, next to the others:

```yaml title="application.yaml (excerpt)"
            - id: exchange
              uri: ${EXCHANGE_URL:http://exchange:8000}
              predicates:
                - Path=/exchange/**
```

`SecurityConfig` needs no change: a path that no rule opens falls into `anyExchange().authenticated()`. Rebuild the gateway and check both sides:

``` { .bash .copy }
docker compose up -d --build gateway
curl -s -o /dev/null -w "%{http_code}\n" localhost/exchange/USD/EUR        # no token
TOKEN=$(curl -s localhost/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"<your fan>","password":"<password>"}' | jq -r .accessToken)
curl -i localhost/exchange/USD/EUR -H "Authorization: Bearer $TOKEN"
```

You should see `401` for the first request and `200` with `x-cache` for the second.

### 5. E1: what the cache saves the provider

Save the script as `load/exchange.js`. It logs in once, asks five currency pairs at random and counts the answers by their `X-Cache`:

``` { .javascript .copy .select linenums="1" title="load/exchange.js" }
--8<-- "docs/2027.1/exercises/exchange/code/load/exchange.js"
```

The pairs use four currencies besides BRL (USD, EUR, GBP, JPY), so a run of $T$ seconds should call PTAX about $4 \times \lceil T / \text{CACHE\_SECONDS} \rceil$ times (the `miss` count can be a little lower: one request may refresh both of its currencies). Write the prediction down, then measure, from the repository root:

``` { .bash .copy }
docker compose restart exchange                     # start from an empty cache
docker run --rm -i --network boxoffice_default -v "$PWD":/w -w /w \
  grafana/k6 run -e RATE=100 -e DURATION=2m load/exchange.js
EXCHANGE_CACHE_SECONDS=30 docker compose up -d exchange
docker run --rm -i --network boxoffice_default -v "$PWD":/w -w /w \
  grafana/k6 run -e RATE=100 -e DURATION=2m load/exchange.js
```

You should see, in the thresholds part of the summary, one line per result (`exchange_cache{result:hit}`, `…miss`, `…stale`, `…none`) with its count: about 12,000 answers and only a few `miss`. Report both runs and the latency percentiles; explain the slowest requests (look at what a `miss` waits for).

!!! danger "Do not turn the cache off"

    `CACHE_SECONDS=0` would send PTAX two calls per request: 200 calls per second from your address to a public service the whole class shares. Estimate that number in your report instead of measuring it.

### 6. E2: the provider goes away

Run k6 for 4 minutes with `CACHE_SECONDS=30` (so that rates expire during the outage) and, in another terminal, cut the egress at about 1 minute and restore it at about 3:

``` { .bash .copy }
EXCHANGE_CACHE_SECONDS=30 docker compose up -d exchange
docker run --rm -i --network boxoffice_default -v "$PWD":/w -w /w \
  grafana/k6 run -e RATE=100 -e DURATION=4m load/exchange.js
```

``` { .bash .copy }
sleep 60;  docker network disconnect boxoffice_egress "$(docker compose ps -q exchange)"; date
sleep 120; docker network connect boxoffice_egress "$(docker compose ps -q exchange)"; date
```

You should see `stale` answers during the cut and no rise of `http_req_failed`. To place each phase in time, add `--out csv=results/e2.csv` to k6 and plot the `exchange_cache` points by result and the latency per 10 s window. Mark the two `date` lines on the chart.

### 7. E3: a cold start during the outage

With the egress cut, restart the service and ask a rate:

``` { .bash .copy }
docker network disconnect boxoffice_egress "$(docker compose ps -q exchange)"
docker compose restart exchange
curl -i localhost/exchange/USD/EUR -H "Authorization: Bearer $TOKEN"
docker network connect boxoffice_egress "$(docker compose ps -q exchange)"
```

You should see a `502`: the cache lived in the memory of the process that just died. Look at the gateway logs as well: its `Retry` filter repeats a failed `GET` once. Explain what the fans would see during a real outage that coincides with a deploy, and propose a fix (the Redis of lab 5, the last rate written to disk, a second provider…) with what it costs.

### 8. In the cloud (optional, counts for A)

From a pod of your cluster (lab 10) or an EC2 instance, `curl` the PTAX URL and one of the free providers of your choice once, and report whether each answers from a cloud address.

## Templates

=== "English"

    ~~~markdown
    # Exercise 8 — Exchange service

    **Student:** <name> (<github-user>) · **Tag:** ex8 · **Date:** <yyyy-mm-dd>

    ## Summary
    ## Requirements checklist
    ## Setup
    Machine, Docker and k6 versions, how to reproduce.

    ## The container
    Dockerfile (with the reason of each layer), second build output, image size.

    ## Wiring
    compose.yaml excerpt, gateway route, the 401/200 check.

    ## E1 — calls saved
    | CACHE_SECONDS | requests | miss predicted | miss measured | p50 | p95 | p99 |

    ## E2 — outage
    Chart of answers by result and latency over time; errors during the cut.

    ## E3 — cold start
    What happened, why, the fix and its trade-off.

    ## AI usage
    ~~~

=== "Português"

    ~~~markdown
    # Exercício 8 — Serviço de câmbio

    **Aluno(a):** <nome> (<usuário-github>) · **Tag:** ex8 · **Data:** <aaaa-mm-dd>

    ## Resumo
    ## Checklist de requisitos
    ## Ambiente
    Máquina, versões do Docker e do k6, como reproduzir.

    ## O contêiner
    Dockerfile (com o motivo de cada camada), saída do segundo build, tamanho da imagem.

    ## Integração
    Trecho do compose.yaml, rota do gateway, o teste 401/200.

    ## E1 — chamadas economizadas
    | CACHE_SECONDS | requisições | miss previstos | miss medidos | p50 | p95 | p99 |

    ## E2 — queda
    Gráfico das respostas por resultado e da latência no tempo; erros durante o corte.

    ## E3 — partida a frio
    O que aconteceu, por quê, a correção e o seu custo.

    ## Uso de IA
    ~~~

## Rubric

Levels as defined in [How the exercises are graded](../index.md#how-the-exercises-are-graded).

| Criterion | I | D | C | B | A |
|-|-|-|-|-|-|
| Container **(mandatory)** | Does not build | Builds, but no lock or `pip install` | `uv sync --frozen`, layers in order, health check, non-root | Each line justified; second build shows the cached layer | Image size reduced and measured (e.g. multi-stage, `--no-cache`, `.dockerignore`) |
| Wiring **(mandatory)** | Not reachable | Port published or route open without a token | No port, two networks, 401 without token and 200 with | Explains why the internal network has no egress | Same isolation shown on Kubernetes (NetworkPolicy) |
| E1 **(mandatory)** | No data | Screenshots only | Both settings measured, counts reported | Prediction within the measured value or the difference explained | Slowest requests tied to the misses with evidence |
| E2 | — | Not done | Cut and restore done, errors and stale counted | Chart over time with the phases marked | Compares with `RETRY_SECONDS` at another value, or a slow (not dead) provider |
| E3 and communication | — | Missing | Result explained | Fix proposed with its trade-off | Fix implemented and E3 repeated without the `502` |

## FAQ

??? question "The first call answers `502`."

    PTAX did not answer within `PTAX_TIMEOUT`: check the egress network (`docker network inspect boxoffice_egress`) and `curl` the PTAX URL from your machine. The BCB has short maintenance windows; try again in a few minutes.

??? question "`docker network disconnect` says the network does not exist."

    Compose prefixes networks with the project name, which is the folder name. Run `docker network ls | grep egress` and use the name it prints.

??? question "The rates did not change all afternoon."

    PTAX publishes its bulletins between about 10 a.m. and 1 p.m. (Brasília) on business days. After the last bulletin the rate is the same until the next morning; the `date` field says which bulletin you got.

??? question "Every answer in k6 is `none`."

    The requests are failing before they reach the service: look at the status codes (`401`: the login in `setup` failed; `404`: the gateway route is missing).

??? question "Can I use another provider instead of PTAX?"

    Yes: change the PTAX call in `_refresh` and keep the cache, the lock, the timeout and the header. Say which provider you used and check its terms of use for automated requests.

[^1]: [Using uv in Docker](https://docs.astral.sh/uv/guides/integration/docker/){target="_blank"}.
