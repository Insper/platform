# 9. Resilience & Chaos

!!! info "Goal"

    Make the checkout survive a bad day at the payment provider. Build the `payment` adapter and a fake
    external provider, put **Toxiproxy** between the services, watch a slow dependency take down all of
    `order` (a **cascading failure**), and fix it with **Resilience4j** — timeout, retry with backoff
    and jitter, circuit breaker, bulkhead — measuring after each pattern. End with a **game day**: a
    rehearsed incident with hidden failures and a blameless review.

At 10:00 the flash sale opens and the payment provider, under the load of every ticketing site in the
country, starts answering in three seconds instead of three hundred milliseconds. Nothing is "down".
Yet within a minute `order` stops answering *everything* — even `GET /orders/{id}`, which never talks
to the provider — because every one of its threads is waiting on `payment`. This lab reproduces that
failure on your laptop and applies the patterns of the
[reliability class](../../classes/reliability/index.md), with a number for each.

This lab builds chapter 10 of the [story of the course](../../index.md#story): the
[cascading failure](../../classes/reliability/index.md#cascading-failures) and its defences —
[timeout](../../classes/reliability/patterns/index.md#timeout),
[retry with jitter](../../classes/reliability/patterns/index.md#retry-with-backoff-and-jitter),
[circuit breaker](../../classes/reliability/patterns/index.md#circuit-breaker) and
[bulkhead](../../classes/reliability/patterns/index.md#bulkhead) — then a
[game day](../../classes/reliability/chaos/index.md#game-days). It comes right after lab 8 on purpose:
chaos needs observability first, so every experiment is watched on the lab 8 dashboard and paged by
its burn-rate alert.

## Slides

<div class="slides-embed">
  <iframe src="slides/resilience.html" title="Slides: resilience and chaos" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/resilience.html){:target="_blank"}

## Before you start

| | |
|---|---|
| Time | about 4 hours, plus 1 hour for the game day |
| Tools | the lab 8 ones: Docker with Compose v2, k6, `curl`, `jq`, a browser for Grafana; `watch` (macOS: `brew install watch`) |
| Docker resources | at least 4 CPUs and **8 GB** (three more containers: `payment`, `psp`, `toxiproxy`) |
| Ports | free on your machine: 8085, 8474 (plus the lab 8 ones) |

Every command runs from the **root of your `boxoffice` repository**, in the state lab 8 left it:

``` text title="Start state (end of lab 8)"
boxoffice/
├── docker-compose.yaml     # labs 1-8: ... kafka, order, notification, otel-lgtm (+ x-otel anchor)
├── infra/                  # nginx/, postgres/, pgbouncer/, grafana/, otel/
├── load/  scripts/
└── services/
    ├── auth/  catalog/  gateway/  inventory/  notification/
    └── order/              # outbox with traceparent (lab 8)
```

!!! tip "Catch up"

    Skipped or broke lab 8? Download [boxoffice-after-lab-8.zip](../8/boxoffice-after-lab-8.zip),
    unzip it, `cd boxoffice`, run `sh scripts/get-otel-agent.sh`, and continue from here.

Every file of this lab is shown in full on these pages and published under
`https://insper.github.io/platform/2027.1/hands-on/9/code/<path>`.

## Architecture

``` diagram-sim
flowchart LR
    k6[k6: pay + browse] --> order["order (Resilience4j)"]
    order -->|"timeout · retry · breaker · bulkhead"| tp1["toxiproxy: payment"]
    tp1 --> payment[payment]
    payment -->|"timeouts, Idempotency-Key"| tp2["toxiproxy: psp"]
    tp2 --> psp["psp (WireMock)"]
    gm[game master] -.->|"latency, reset, outage"| tp1
    gm -.-> tp2
    order -.->|OTLP| lgtm[otel-lgtm]
    payment -.->|OTLP| lgtm
```

!!! example "BoxOffice components touched"

    | Palette component | In this lab |
    |---|---|
    | [Payment](../../reference/components/external/index.md#payment) | `psp`, a WireMock fake of an external provider |
    | [3rd Party API](../../reference/components/external/index.md#thirdparty) | the provider behind an adapter, with timeouts and idempotency keys |
    | [App Server](../../reference/components/compute/index.md#app) | `order` and `payment`, protected by Resilience4j |
    | [Alerting](../../reference/components/observability/index.md#alerting) | the burn-rate alert of lab 8, used to detect the game-day failures |

## What you will measure

| Question | Metric | Tool |
|---|---|---|
| Does a slow dependency hurt endpoints that do not use it? | `browse` p95 and errors while `payment` is slow | k6 |
| How much does each pattern help, and what does it cost? | `pay` p95, confirmed %, fast-fail % | k6 |
| How fast does the breaker open and recover? | state transitions over time | `/actuator/circuitbreakers` |
| How fast does the team detect and mitigate? | time to detect, time to mitigate | game-day timeline |

## Prerequisites

- Labs [7](../7/index.md) (the `order` service) and [8](../8/index.md) (dashboards and alerts) done.
- Read the [reliability class](../../classes/reliability/index.md):
  [resilience patterns](../../classes/reliability/patterns/index.md) and
  [chaos engineering](../../classes/reliability/chaos/index.md).

## Steps

1. [Payment, provider and Toxiproxy](payment/index.md) — the idempotent `payment` adapter, a WireMock provider, Toxiproxy proxies and your first toxic.
2. [Resilience patterns](patterns/index.md) — reproduce the cascade, then add timeout, retry, circuit breaker and bulkhead one at a time.
3. [Game day](game-day/index.md) — roles, hypotheses, hidden failures, timeline and a blameless review.
4. [Measure it](measure/index.md) — the k6 script with a `pay` and a `browse` scenario, and the results table.

## Try it in the playground

**Try it:** in `cascading-failure`, run the `load` profile and raise the latency of the 3rd-party
node: watch the app server's utilization reach 100% and its errors spread to every request. Then set
a timeout and enable the circuit breaker on the edge to the 3rd party, and run again. In
`retry-storm`, compare `retries: 3` with and without `exp+jitter` backoff during an outage.

<div class="sdp" data-scenario="cascading-failure" data-mode="compact" data-height="520"></div>

<div class="sdp" data-scenario="retry-storm" data-mode="compact" data-height="460" data-profile="chaos"></div>

The full simulator is in the [playground](../../../playground/index.md).

## Measure it

The [Measure it](measure/index.md) step has the k6 script, the commands and the results table to keep
in `results/lab9.md`; the game-day reviews go to `results/lab9-gameday.md`.

## Troubleshooting { #troubleshooting }

| Symptom | Likely cause | Fix |
|---|---|---|
| `curl localhost:8474/proxies` fails | `toxiproxy` not running, or `infra/toxiproxy/toxiproxy.json` missing | `docker compose ps toxiproxy`; `docker compose logs toxiproxy` |
| every payment fails with `I/O error … Connection refused` | the `payment` proxy was left disabled by an experiment | `curl -s -X POST localhost:8474/reset` (removes toxics, re-enables proxies) |
| `pay` returns `503` even with no toxic | the circuit breaker is still `OPEN` from the last experiment, or the first call was cold | wait 10 s (`wait-duration-in-open-state`) and retry; check `/actuator/circuitbreakers` |
| `psp` answers `404` | the WireMock stub was not mounted | the file must be `infra/psp/mappings/charge.json`; `docker compose restart psp` |
| `PAYMENT_*` variables seem ignored | they only reach the container through `docker-compose.yaml` and a recreate | `PAYMENT_BULKHEAD=10 docker compose up -d order` (not `restart`) |
| results vary a lot between runs | the laptop runs k6 and 20 containers | close other apps, run each experiment twice, compare **ratios** |

!!! success "Best practices in this lab"

    - **A timeout on every outbound call, shorter than the caller's** — `PaymentClient.java` (500 ms connect, 1 s read). Why: [Timeout](../../classes/reliability/patterns/index.md#timeout).
    - **Retries only with an idempotency key, with exponential backoff and jitter** — `PaymentClient.java` sends `Idempotency-Key: order-<id>`; `application.yaml` allows 3 attempts, 200 ms ± 50%. Why: [Retry with backoff and jitter](../../classes/reliability/patterns/index.md#retry-with-backoff-and-jitter).
    - **A bulkhead smaller than the thread pool, and fail fast when it is full** — `application.yaml`: 10 of the 50 threads, `max-wait-duration: 0`. Why: [Bulkhead](../../classes/reliability/patterns/index.md#bulkhead).
    - **No database transaction open while waiting on a remote call** — `OrderService.java` calls `payment` first and updates the status in a short transaction. Why: [Cascading failures](../../classes/reliability/index.md#cascading-failures) (the wait would exhaust the connection pool instead).
    - **Chaos as code, with a one-command abort** — `scripts/game-day.sh` and `infra/toxiproxy/toxiproxy.json`; `reset` removes every toxic. Why: [Game days](../../classes/reliability/chaos/index.md#game-days).

## Clean up

``` shell
curl -s -X POST localhost:8474/reset    # no toxic left behind
docker compose stop                     # keep the stack for lab 10's images
docker compose down -v                  # or remove everything
```

## End state

``` text title="End state (what this lab added or changed)"
boxoffice/
├── docker-compose.yaml     # + psp, toxiproxy, payment; order -> toxiproxy:18085 + PAYMENT_* knobs
├── infra/
│   ├── grafana/alerting/slo-order.yaml   # the lab 8 burn-rate alerts, for order (game day)
│   ├── psp/mappings/charge.json
│   └── toxiproxy/toxiproxy.json
├── load/pay-under-chaos.js
├── scripts/game-day.sh
├── results/lab9.md, lab9-gameday.md
└── services/
    ├── order/              # pom (+ resilience4j, aspectj), application.yaml, OrderService,
    │                       # OrderController (+ /pay), payment/ package
    └── payment/            # new: idempotent adapter to the provider (+ Dockerfile, .dockerignore)
```

Commit and tag: `git add -A && git commit -m "lab 9: resilience" && git tag lab9`.

## Checklist

- [ ] `payment`, `psp` and `toxiproxy` run in `docker-compose.yaml`; `order` and `payment` reach their dependencies through Toxiproxy
- [ ] `POST /payments` is idempotent by `Idempotency-Key`, and the key is forwarded to the provider
- [ ] `POST /orders/{id}/pay` confirms the order (status `CONFIRMED` + `OrderConfirmed` in the outbox) and is protected by timeout, retry, circuit breaker and bulkhead
- [ ] the unprotected run shows the cascade (`browse` degraded); each pattern's run shows its effect, in numbers
- [ ] one game day with at least three hidden experiments, a timeline and a blameless review per round
- [ ] results table filled in `results/lab9.md` and explained
- [ ] self-check: `curl -s -X POST localhost:8474/reset`, then `PAYMENT_RESILIENCE=true docker compose up -d --wait order` and one `pay` call returns `CONFIRMED`; pushed with the tag `lab9`

## Related

- Theory: [Reliability](../../classes/reliability/index.md) ·
  [SLOs and error budgets](../../classes/observability/slo/index.md) ·
  [Resilience patterns](../../classes/reliability/patterns/index.md) ·
  [Chaos engineering](../../classes/reliability/chaos/index.md) ·
  [External integrations](../../classes/compute/integrations/index.md)
- Case study: [Payment system](../../classes/case-studies/payment-system/index.md)
- Project: [Chaos game day](../../exercises/project/game-day/index.md)
- Next lab: [10. Kubernetes](../10/index.md) adds self-healing and autoscaling.

[Start: Payment, provider and Toxiproxy](payment/index.md){ .md-button .md-button--primary }
