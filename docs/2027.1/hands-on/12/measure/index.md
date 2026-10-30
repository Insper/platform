# 5. Measure It

An LLM endpoint is the slowest and most expensive dependency BoxOffice has, and its latency has a shape
of its own: a long wait for the **first token** (the model reads the whole prompt), then a stream of
tokens at a roughly constant speed. Users judge the first part — an empty bubble — much more harshly
than the second. This step measures both, and the cost, under concurrency.

| # | Experiment | What you record |
|---|---|---|
| A | latency under concurrency 1, 2, 4 | TTFT p50/p95, total p50/p95, tokens/s, requests/min |
| B | retrieval quality | hit@5 and MRR (step 2) |
| C | answer quality | share of `grounded` answers over 10 questions |
| D | model choice (optional) | A and C again with a larger local model or the Claude route, plus US$ per request |

## Why not k6 this time?

k6 measures the time to the first **byte** (`http_req_waiting`). A streaming server sends its HTTP
headers as soon as the response starts — long before the first token — so that number says nothing
about what the fan sees. The script below speaks Server-Sent Events and stops the TTFT clock at the
first `event: token`:

``` python title="scripts/assistant_load.py"
--8<-- "docs/2027.1/hands-on/12/code/scripts/assistant_load.py"
```

## A. Latency under concurrency

``` shell
uv run scripts/assistant_load.py --concurrency 1 2 4 --requests 8
```

A test run with `qwen2.5:1.5b` in Docker, **on the CPU of a laptop that was also running other
stacks** (2 requests per level, to keep it short):

``` text
| concurrency | requests | errors | TTFT p50 | TTFT p95 | total p50 | total p95 | tokens/s | req/min | USD/request |
|---|---|---|---|---|---|---|---|---|---|
|           1 |        2 |      0 |     5.05 |    13.17 |    148.02 |    197.87 |       0.8 |    0.35 |   0.000000 |
|           2 |        2 |      0 |     3.37 |   127.23 |    126.89 |    213.07 |       2.8 |    0.56 |   0.000000 |
```

With **native Ollama on an Apple Silicon laptop** (GPU through Metal, the full stack running), a test
run with 8 requests per level, after one warm-up question (the first call loads the model: about 20 s):

``` text
| concurrency | requests | errors | TTFT p50 | TTFT p95 | total p50 | total p95 | tokens/s | req/min | USD/request |
|---|---|---|---|---|---|---|---|---|---|
|           1 |        8 |      0 |     0.19 |     0.32 |      3.52 |      4.53 |      64.0 |   19.27 |   0.000000 |
|           2 |        8 |      0 |     1.42 |     3.74 |      3.24 |      5.11 |      64.1 |   34.40 |   0.000000 |
|           4 |        8 |      0 |     4.64 |    10.62 |      8.30 |     11.15 |      64.0 |   24.65 |   0.000000 |
```

Tens of times faster, and with a different shape: each answer still decodes at about 64 tokens/s, but
the requests queue in front of the one model, so TTFT grows with concurrency and requests per minute stop
growing after 2.

Read it as a capacity problem, with the formulas of the
[AI systems class](../../../classes/ai-systems/index.md):

- **TTFT** grows with the prompt (≈ 760 tokens here: system + five retrieved events + question) and
  with the queue in front of the model: at concurrency 2, the second request waited for the first.
- **tokens/s** is the decode speed of the hardware. A CPU gives a few tokens per second; a laptop GPU
  (native Ollama on Apple Silicon) tens; a hosted frontier model, around a hundred.
- **Little's Law** applies as everywhere: requests in flight = arrival rate × time per request. With
  ~2 minutes per answer, *one* fan per minute already keeps two requests in flight. That is why LLM
  serving needs batching, GPUs and admission control — or a hosted API.

!!! tip "If your numbers are this slow"

    That is the lesson, not a bug — but you can do better on the same laptop: run Ollama natively
    (macOS), close other containers, ask short questions, and lower `RETRIEVE_K` (fewer context
    tokens, faster prefill; check that hit@k does not drop). On a CPU, measure `--concurrency 1 2
    --requests 2`, as the test run did: at concurrency 4 the requests queue behind one another past the
    gateway's 120 s timeout (`litellm.Timeout` in `docker compose logs assistant`, counted in `errors`).

## B. Retrieval quality

Record hit@5 and MRR from [step 2](../rag/index.md). Then lower `--k` to 1 and see which questions
fail.

## C. Answer quality

Ask the ten questions below (the five of `assistant_load.py` and five of your own about BoxOffice) with
`/assistant/chat`, and count `grounded: true`:

``` shell
curl -s -X POST localhost:8088/assistant/chat -H 'Content-Type: application/json' \
  -d '{"message":"Which plays are there in Curitiba?"}' | jq '{grounded, citations, answer}'
```

In the test run, `qwen2.5:1.5b` answered with correct facts from the context but **without citations**
in both questions tried, so both were `grounded: false` — the guard did its job, and the model is the
weak link. Over ten questions, another test run counted 1 of 10 grounded with `qwen2.5:1.5b` and 5 of 10
with `qwen2.5:3b`. Grounding rate is a property of the *model + prompt*; measure it before you trust any
assistant.

## D. Model choice (optional)

Repeat A and C with a larger local model (`docker compose exec ollama ollama pull qwen2.5:3b`, or
`ollama pull qwen2.5:3b` with native Ollama, then `LOCAL_MODEL_TAG=qwen2.5:3b docker compose up -d --wait assistant`) or with the Claude route (step 1, costs
money: the `USD/request` column shows how much). Compare TTFT, grounding rate and cost per answer.

## Results

Copy into `results/lab12.md` and fill in. Write down where Ollama ran (container CPU, native GPU…).

| Metric | Small local model | Larger local model or Claude |
|---|---|---|
| A · TTFT p50 / p95 at concurrency 1 (s) | | |
| A · TTFT p50 / p95 at concurrency 4 (s) | | |
| A · Total p50 / p95 at concurrency 1 (s) | | |
| A · Tokens/s (decode) | | |
| A · Requests per minute at concurrency 4 | | |
| B · hit@5 / MRR | | — |
| C · Grounded answers (out of 10) | | |
| D · US$ per request / per 1 000 requests | 0 | |

Below the table: for the BoxOffice flash sale (2 million fans, maybe 1% asking the assistant), which
setup would you run, how many requests in flight would it need (Little's Law), and what would it cost
per hour?

[Back to the overview](../index.md){ .md-button } [Quiz](../quiz.md){ .md-button .md-button--primary }
