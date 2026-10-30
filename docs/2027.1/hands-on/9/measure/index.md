# 4. Measure It

One script drives every experiment of [step 2](../patterns/index.md) and the
[game day](../game-day/index.md). It runs two scenarios at the same time, because a cascading failure
is only visible when you also measure what **should not** be affected:

| Scenario | Rate | Request | Touches `payment`? |
|---|---|---|---|
| `pay` | `PAY_RATE` (default 20/s) | place an order, then `POST /orders/{id}/pay` | yes |
| `browse` | 20/s | `GET /orders/{id}` of orders created in `setup()` | **no** |

``` javascript title="load/pay-under-chaos.js"
--8<-- "docs/2027.1/hands-on/9/code/load/pay-under-chaos.js"
```

Read four lines of the summary after every run: `http_req_duration{name:pay}` and
`{name:browse}` (p95, p99), the `paid and confirmed` check (share of confirmed payments; the
`checks` total also counts the `order read` check of `browse`), `pay_fast_fail`, and
`http_req_failed{name:browse}`. Watch the circuit breaker while it runs:

``` shell
watch -n 1 "curl -s localhost:8084/actuator/circuitbreakers | jq '.circuitBreakers.payment'"
```

!!! example "Expected shape (illustrative)"

    Unprotected with +3 s: `pay` p95 grows to many seconds and **`browse` p95 grows with it** — the
    cascade. With a timeout: `pay` fails in about a second, `browse` is back to milliseconds. With the
    circuit breaker during an outage: `pay` answers `503` in milliseconds most of the time
    (`pay_fast_fail` close to 1) and calls to `payment` drop to a trickle of half-open probes. With the
    bulkhead under slow-but-successful calls: most payments get `503` (only 10 fit at a time), but `browse` stays fast.

    A test run on a busy laptop (the whole lab 9 stack, 45 s per run, `payment` + 3 s latency):

    | Configuration | `pay` p50 / p95 | `browse` p50 / p95 | `pay_fast_fail` |
    |---|---|---|---|
    | unprotected (`PAYMENT_RESILIENCE=false`, `PAYMENT_READ_TIMEOUT=0`) | 13.8 s / 17.1 s | **9.04 s / 13.17 s** | 0% |
    | all patterns (defaults) | 5 ms / 1.38 s | **6.5 ms / 805 ms** | 100% |

    Unprotected, `GET /orders/{id}` — which never calls `payment` — waited 9 s at the median: the
    cascade. With the patterns, the breaker opened within seconds and every payment failed fast with
    `503`, so `browse` went back to milliseconds (its p95 still shows the first seconds, before the
    breaker opened). Your absolute numbers will differ; the contrast between the two `browse` columns
    is what you must reproduce.

## Results

Copy into `results/lab9.md`. "Before" is the unprotected or disabled configuration of each row;
"After" is the one with the pattern.

| Experiment (toxic) | Metric | Before | After |
|---|---|---|---|
| Baseline (no toxic) | pay p95 (ms) / browse p95 (ms) | | — |
| Timeout (latency 3 s) | pay p95 (ms) | | |
| Timeout (latency 3 s) | browse p95 (ms) / browse errors (%) | | |
| Retry (reset_peer 30%) | payments confirmed (%) | | |
| Retry (reset_peer 30%) | pay p95 (ms) | | |
| Circuit breaker (proxy disabled) | pay p95 (ms) / `pay_fast_fail` (%) | | |
| Circuit breaker (proxy disabled) | time from re-enable to `CLOSED` (s) | — | |
| Bulkhead (latency 700 ms, 70 pay/s) | browse p95 (ms) | | |
| Bulkhead (latency 700 ms, 70 pay/s) | payments rejected (%) | | |
| Game day | time to detect / time to mitigate (min) | — | |

Below the table, one paragraph per pattern: the mechanism (with Little's Law where it applies), the
number that proves it, and the price you paid for it.

[Back to the overview](../index.md){ .md-button } [Quiz](../quiz.md){ .md-button .md-button--primary }
