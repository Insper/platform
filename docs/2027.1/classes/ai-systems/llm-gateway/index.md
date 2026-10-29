Six months after the assistant launched, BoxOffice has five features that call models: the support assistant, a review summarizer, an event-description translator, a fraud-signal classifier and the nightly job that embeds the catalog. Each team picked its own provider, wrote its own retry loop and pasted an API key into its own configuration. Then three things happened in the same week: a provider had a two-hour outage and three features went down with it; the translator, stuck in a retry loop, burned a month of budget in one night; and nobody could answer the CFO's question, *"how much does the assistant cost per conversation?"*.

The fix is the same one the course applied to HTTP traffic in [Traffic & Edge](../../edge/api-gateway/index.md): put **one gateway** in front of every model, and move the cross-cutting concerns into it.

``` diagram-sim
flowchart LR
    subgraph Before["Before: every service talks to every provider"]
        a1["assistant"] --> p1["provider A"]
        a2["summarizer"] --> p1
        a2 --> p2["provider B"]
        a3["translator"] --> p2
        a4["embed job"] --> p3["self-hosted"]
    end
    subgraph After["After: one LLM gateway"]
        b1["assistant"] --> gw["LLM Gateway"]
        b2["summarizer"] --> gw
        b3["translator"] --> gw
        b4["embed job"] --> gw
        gw --> q1["provider A"]
        gw --> q2["provider B"]
        gw --> q3["self-hosted"]
    end
```

## What the gateway does

An **LLM gateway** is a reverse proxy specialized for model APIs. Clients send requests in one format to a **model alias** (`assistant-default`, not a vendor model name); the gateway decides which real deployment serves it, and records what happened.

| Responsibility | What it means | Classic equivalent |
|---|---|---|
| **Unified API** | one request/response format for every provider; clients do not import vendor SDKs | adapter / anti-corruption layer |
| **Credentials** | provider keys live only in the gateway (secret store); clients authenticate with their own service identity | API gateway + secrets management |
| **Routing** | alias → model and deployment, by feature, difficulty, cost, latency or data residency | L7 routing |
| **Fallbacks and retries** | on `429`, `5xx` or a slow first token, retry with backoff or move to the next deployment | retry + circuit breaker |
| **Quotas and budgets** | requests and **tokens** per minute per user, team and feature; currency budgets per month | rate limiter |
| **Caching** | exact-match and semantic response caches; prompt-cache-friendly requests | cache |
| **Observability** | one trace span per call with model, tokens, cost, TTFT; dashboards per feature | access log + metrics |
| **Policy hooks** | calls the [Safety Mesh](../safety-evals/index.md) before and after the model (redaction, filters) | WAF / filters |

The gateway is on the critical path of every AI feature, so it must itself be **stateless, horizontally scaled and highly available** — the quota counters and caches live in Redis, exactly like a rate-limiting API gateway ([Edge](../../edge/api-gateway/index.md)).

---

## Routing

The same prompt can be served by models that differ by an order of magnitude in price and speed. **Routing** chooses, per request, the cheapest deployment that is good enough.

| Strategy | How it decides | Good for | Watch out |
|---|---|---|---|
| **Static, per feature** | the alias maps to one model (`translator` → small model) | most features; simple and predictable | over-paying for easy requests |
| **By task** | a rule or a small classifier labels the request (FAQ, booking, complaint) and picks a model | assistants with mixed traffic | the classifier is one more model to evaluate |
| **Cascade** | try the small model first; escalate when its answer fails validation or a confidence check[^1] | high volume, mostly easy requests | worst-case latency = small + large |
| **Learned router** | a model trained on preference data predicts whether the small model suffices[^2] | very high volume | needs training data and monitoring |
| **Latency/cost aware** | send to the deployment with the lowest current TTFT or price | multi-provider, multi-region | oscillation; keep some stickiness |
| **Compliance** | personal data stays in deployments in an approved region, or self-hosted | LGPD, contractual constraints | fewer fallbacks available |

``` diagram-sim
flowchart TD
    req["request: alias assistant-default"] --> pii{"contains personal data?"}
    pii -- yes --> region["only approved-region deployments"]
    pii -- no --> all["all deployments"]
    region --> task{"task class"}
    all --> task
    task -- "FAQ / small talk" --> small["small model"]
    task -- "booking with tools" --> large["large model"]
    small --> check{"answer valid?"}
    check -- no --> large
    check -- yes --> done(["respond"])
    large --> done
```

**Aliases decouple applications from model names.** When a new model version appears, the platform team points `assistant-default` at it for 5% of traffic (a **canary**, as in [Cloud-native delivery](../../cloud-native/delivery/index.md)), compares online metrics and offline evals, then rolls forward or back — with no change in the assistant's code. **Pin model versions** behind the alias: a provider silently updating "latest" is an untested deploy.

---

## Fallbacks and retries

A model call has **no side effects**: retrying it is always *safe* (tool calls are a different story — see [Agents & Tools](../agents/index.md#side-effects)). But not every error deserves a retry, and some deserve a different model.

| Error | Meaning | Gateway action |
|---|---|---|
| `429` rate limited | your quota at that deployment is exhausted | honor `Retry-After` if short; otherwise **fall back** to another deployment |
| `5xx`, "overloaded" | provider-side failure | retry with exponential backoff + jitter, then fall back; count it in the **circuit breaker** |
| No first token within the TTFT deadline | queueing or an overloaded region | cancel and fall back (or **hedge**: send a second request after the p95 TTFT and keep the first to answer) |
| Stream breaks after tokens were sent | connection lost mid-answer | cannot retry transparently — the user already saw part of it; retry the whole answer and tell the client to replace it |
| `400` context too long | the prompt does not fit | do **not** retry the same deployment; trim history, or route to a long-context model |
| Refusal / content filter | the model or provider declined | do **not** fall back to a "less strict" model; return the policy answer |
| Invalid JSON / schema | output did not match the requested format | one repair attempt with the validation error, then fail; prefer constrained decoding (structured outputs) |

A simplified, provider-agnostic sketch of the fallback chain, combining the retry and circuit-breaker patterns of [Reliability](../../reliability/patterns/index.md):

``` python title="router.py"
import random
import time

CHAIN = {  # model alias -> ordered list of deployments
    "assistant-default": ["large@provider-a", "large@provider-b", "medium@self-hosted"],
    "assistant-cheap": ["small@self-hosted", "small@provider-a"],
}
RETRYABLE = {429, 500, 502, 503, 504}


def complete(alias, request, clients, breakers, ttft_deadline_s=3.0):
    """clients and breakers are this sketch's own interfaces, not a real SDK."""
    last_error = None
    for deployment in CHAIN[alias]:
        if breakers[deployment].is_open():
            continue  # known to be failing: skip it without waiting
        for attempt in range(2):
            try:
                reply = clients[deployment].chat(request, first_token_timeout=ttft_deadline_s)
                breakers[deployment].record_success()
                return reply
            except ProviderError as error:
                breakers[deployment].record_failure()
                last_error = error
                if error.status not in RETRYABLE:
                    raise  # 400, context too long, refusal: another try will not help
                if error.status == 429 and not error.retry_after:
                    break  # quota gone here: go straight to the next deployment
                wait = error.retry_after or 0.2 * 2**attempt
                time.sleep(wait + random.uniform(0, wait))  # backoff with jitter
    raise AllDeploymentsFailed(alias) from last_error
```

Two traps specific to models:

- **A fallback model is a different program.** Prompts tuned for one model, its tool-calling format and its refusal style may not transfer. Run the [eval suite](../safety-evals/index.md#evaluation) against every model in the chain, not only the primary — otherwise the fallback silently lowers quality exactly during an incident.
- **Retries multiply token spend.** The [retry storm](../../reliability/patterns/index.md) of the reliability class now has a price tag: cap attempts, use a retry budget (e.g. retries ≤ 10% of calls), and count retried tokens against the caller's quota.

!!! example "In the BoxOffice code: the gateway of the assistant (lab 12)"

    [Hands-on 12 — The service and the LLM gateway](../../../hands-on/12/service/index.md) uses LiteLLM's in-process `Router` as the gateway. The assistant asks for a **route** (an alias), never a model name: `local`, a small open model on Ollama, always exists; `claude` exists only when an API key does. The fallback `claude → local` keeps the assistant answering when the provider fails or the quota runs out — and it is the first trap above in practice: the fallback is a much smaller model, so the evaluations must run against it too. One retry and a 120 s timeout, because an LLM call is the slowest dependency BoxOffice has. One service does not need the separate LiteLLM proxy; with several AI services, the proxy becomes the shared gateway of this page. The lab estimates one question at about 1,000 input and 100 output tokens, ≈ US$ 0.006 on the Claude route.

    ``` { .python title="services/assistant/app/llm.py" }
    --8<-- "docs/2027.1/hands-on/12/code/services/assistant/app/llm.py"
    ```

!!! tip "Try it"

    Load the AI assistant scenario with the **spike** profile and chaos set to **medium**. Watch the LLM Gateway when the provider throttles and fails: without a fallback, most questions end in errors. Select the LLM Gateway and turn on **Fallback model**: the error rate falls by half or more, but the cost per month more than doubles and p99 grows by several seconds — the fallback answers what the quota rejected, slower. Compare the token rate the gateway reports with the provider's limit. Open it in the [full playground](../../../../playground/index.md) to combine the fallback with fewer agent steps and a semantic cache.

<div class="sdp" data-scenario="ai-assistant" data-mode="compact" data-height="520" data-profile="spike" data-chaos="medium"></div>

---

## Quotas and token budgets { #quotas }

Provider limits are expressed in **requests per minute (RPM)**, **tokens per minute (TPM)** — sometimes input and output separately — and concurrent requests, per account and per region. A single feature with a bug can exhaust the account's TPM and take every other feature down with it: the **noisy neighbor** problem, now with an invoice. OWASP lists it as *unbounded consumption*[^3]; some call it *denial of wallet*.

The gateway enforces its own, finer limits:

| Scope | Example limit (BoxOffice) | Why |
|---|---|---|
| Per user | 20 requests and 60,000 tokens per hour | stop abuse and runaway loops from one account |
| Per feature | assistant ≤ 60% of the account TPM; nightly jobs ≤ 20% | protect interactive traffic from batch jobs |
| Per request | `max_tokens` ≤ 600 output tokens; ≤ 8 model calls per task | bound the worst case of a single request |
| Per month | US$ budget per feature with alerts at 50/80/100% | finance can plan; no surprises |

**Counting tokens before you know them.** A token bucket counts tokens instead of requests, but output tokens are only known *after* the call. The usual approach is **reserve, then reconcile**: before the call, count the input tokens with the model's tokenizer and reserve `input + max_tokens` from the bucket; after the call, return the unused part. Keep the counters in Redis with atomic scripts, as in the rate-limiter design of [Edge](../../edge/api-gateway/index.md).

**What happens when a budget runs out** is a product decision, decided in advance:

1. **Degrade**: route to a smaller model or answer from the cache/FAQ.
2. **Queue**: background work (summaries, embeddings) waits for the next window — the [async queue](../../messaging/queues-pubsub/index.md) pattern.
3. **Shed**: return `429` with `Retry-After` and a friendly message; interactive traffic has **priority** over batch, and paying flows over browsing.

!!! example "BoxOffice at 10:00"

    The flash sale makes the assistant's traffic 50× normal for 15 minutes. The gateway reserves 70% of the account's TPM for the `assistant` alias with priority *interactive*, pauses the nightly embedding job (priority *batch*), routes questions classified as FAQ to the small model and the semantic cache, and caps each fan at 5 assistant requests per minute. When the reserved TPM is 90% used, new conversations get a link to the static FAQ page instead of a model answer: the sale goes on; the assistant degrades.

---

## Caching: three different things { #caching }

"Cache the LLM" means three different mechanisms with very different risks.

| | Exact-match response cache | **Prompt caching** (prefix cache) | **Semantic cache** |
|---|---|---|---|
| Key | hash of the full request (model, prompt, parameters) | the longest **identical prefix** of the prompt | **embedding** of the user question; hit if similarity ≥ threshold |
| What is reused | the final answer | the model's internal state for the prefix (the KV cache) | a stored answer to a *similar* question |
| Where it lives | gateway (Redis) | inside the model server / provider | gateway (Redis or a vector index) |
| Saves | the whole call | input-token cost (cached tokens billed at a discount) and TTFT | the whole call |
| Correctness risk | none (same input) | **none** — the answer is computed normally | **false hits**: a similar question that needs a different answer |
| Hit ratio in a chat | low (questions rarely repeat byte-for-byte) | high (system prompt + tools + history repeat on every call) | medium for FAQ-like traffic; ~0 for personal, tool-using requests |

### Prompt caching

Processing the input (the *prefill*, below) produces internal key/value tensors for every token. When the next request starts with the **same tokens**, the server can reuse them instead of recomputing. Most major providers and open-source servers (e.g. vLLM's automatic prefix caching) support this; providers bill cached input tokens at a fraction of the normal price, require a minimum prefix length, and keep entries for minutes of inactivity. Details — automatic or explicit cache markers, discount, lifetime — differ by provider: read their documentation.

Because the match is on an **exact prefix**, the order of the prompt matters:

``` diagram
flowchart LR
    s["1. system prompt<br/>(static)"] --> t["2. tool definitions<br/>(static)"] --> k["3. retrieved documents<br/>(per conversation)"] --> h["4. conversation history<br/>(grows)"] --> u["5. new user message<br/>(changes every call)"]
```

!!! warning "Cache busters"

    A timestamp, a request ID or the user's name at the **top** of the system prompt changes the prefix on every call and silently drops the hit ratio to zero. So does re-ordering tool definitions or re-serializing JSON with unstable key order. Put everything that varies **at the end**, and monitor the cached-token ratio per feature.

### Semantic caching

A semantic cache embeds the user question (see [RAG & Memory](../rag-memory/index.md#embeddings)) and looks for a previous question whose embedding is close enough. "What time do the gates open at Arena Paulista?" and "when do doors open at Arena Paulista?" should hit. The danger is the reverse case: *"can I get a refund for the Saturday show?"* and *"can I get a refund for the Sunday show?"* are almost identical as vectors and may need different answers.

Rules that keep a semantic cache safe:

- **Scope the key**: tenant, language, event or venue ID, and policy version are part of the key, not only the vector.
- **Only for generic answers**: never cache answers that used tools, personal data or the user's permissions.
- **Tune the threshold with data**: label a sample of (question, cached question) pairs as same/different and pick the similarity threshold for the precision you need; a hit ratio gained with wrong answers is a bug.
- **Short TTL and invalidation** when the source document changes (the same problem as in [Caching](../../caching/invalidation/index.md)).

---

## Inference performance: TTFT, TPOT and throughput

Generating an answer has two phases with opposite profiles:

- **Prefill** — the model processes all input tokens **in parallel**. It is compute-bound and ends when the first output token appears: it sets the **time to first token (TTFT)**. TTFT grows with the uncached prompt length and with queueing at the server.
- **Decode** — the model generates output tokens **one at a time**, each step reading all the model weights from GPU memory. It is memory-bandwidth-bound and sets the **time per output token (TPOT)**, also called inter-token latency (ITL).

$$
\text{latency}_{\text{e2e}} = \text{TTFT} + \text{TPOT} \times (N_{out} - 1)
\qquad
\text{speed per user} = \frac{1}{\text{TPOT}}\ \text{tokens/s}
$$

With TTFT = 0.6 s and TPOT = 20 ms (50 tokens/s), a 250-token answer takes 0.6 + 0.02 × 249 ≈ **5.6 s**; a 1,000-token answer, **~20.6 s**. Answer length is a latency decision.

```python exec="true" html="1" source="tabbed-right"
import matplotlib.pyplot as plt
from io import StringIO

# Left: end-to-end latency = TTFT + TPOT x (output tokens - 1)
models = {"large model (TTFT 0.6 s, 50 tok/s)": (0.6, 0.020),
          "small model (TTFT 0.2 s, 150 tok/s)": (0.2, 1 / 150)}
tokens = list(range(1, 1001, 10))

# Right: one self-hosted replica decoding a batch of b sequences per step.
# Step time = fixed weight read + a small per-sequence cost (illustrative).
W_READ_MS, PER_SEQ_MS = 12.0, 0.15
batch = list(range(1, 257))
per_stream = [1000 / (W_READ_MS + PER_SEQ_MS * b) for b in batch]
aggregate = [b * s for b, s in zip(batch, per_stream)]

fig, ax = plt.subplots(1, 2, figsize=(11, 4))
for label, (ttft, tpot) in models.items():
    ax[0].plot(tokens, [ttft + tpot * (n - 1) for n in tokens], label=label)
ax[0].set_xlabel("output tokens")
ax[0].set_ylabel("end-to-end latency (s)")
ax[0].set_title("Latency grows with the answer length")
ax[0].legend()
ax[0].grid(alpha=.3)

ax[1].plot(batch, aggregate, color="tab:green", label="replica throughput (tok/s)")
ax[1].set_xlabel("concurrent sequences in the batch")
ax[1].set_ylabel("replica throughput (tokens/s)", color="tab:green")
twin = ax[1].twinx()
twin.plot(batch, per_stream, color="tab:red", label="per-user speed (tok/s)")
twin.set_ylabel("per-user speed (tokens/s)", color="tab:red")
ax[1].axvline(64, ls="--", color="gray")
ax[1].text(66, max(aggregate) * 0.1, "KV-cache full\n(8k-token contexts)", color="gray")
ax[1].set_title("Batching: throughput vs per-user speed")
ax[1].grid(alpha=.3)
plt.tight_layout()

buffer = StringIO()
plt.savefig(buffer, format="svg", transparent=True)
print(buffer.getvalue())
plt.close()
```

### Streaming

Since the answer arrives token by token, the gateway **streams** it to the client — usually with Server-Sent Events (SSE) over HTTP, as seen in [Protocols](../../edge/protocols/index.md). The fan starts reading after the TTFT instead of after the full latency, which is why **TTFT is the interactive SLO** (e.g. p95 TTFT < 1.5 s) and **TPOT only needs to beat reading speed** (people read roughly 4–8 words per second, so ~15–20 tokens/s already feels fluent).

Streaming has architectural consequences:

- **Long-lived connections.** By Little's law, 33 requests/s × 12 s per streamed answer ≈ **400 open connections** per instance pool. Use asynchronous servers (FastAPI/uvicorn, Netty), and raise idle timeouts on load balancers and proxies that would cut a slow stream.
- **Tool calls and JSON cannot be acted on until complete.** Only the final natural-language answer benefits from streaming.
- **Output guardrails and streaming conflict.** Checking the whole answer before showing it removes the TTFT benefit; checking chunk by chunk may show a problematic sentence before it is caught. Common compromise: stream, check in windows of a few sentences, and retract if needed — and never stream content of high-risk actions before validation.

### Batching and the KV cache

If you self-host a model (or just want to understand provider limits), one number explains most behavior: **decode is limited by memory bandwidth, not by compute**. Every decode step reads all the weights. An 8-billion-parameter model in 16-bit precision is ~16 GB; a GPU with ~3 TB/s of memory bandwidth needs at least ~5 ms to read it — so a single sequence cannot exceed ~200 tokens/s however powerful the GPU.

**Batching** amortizes that read: one pass over the weights advances *b* sequences at once. Replica throughput grows almost linearly with *b* while each user's speed degrades slowly (right plot above). Two techniques made this practical:

- **Continuous (in-flight) batching**[^4]: instead of waiting for a whole batch to finish, the server adds and removes sequences at **every token step**, so a short answer does not wait for a long one.
- **PagedAttention**[^5]: the KV cache of each sequence is stored in fixed-size pages, like virtual memory, eliminating fragmentation and allowing prefix sharing across requests (which is how self-hosted **prompt caching** works).

The limit is **memory for the KV cache**, the key/value tensors kept for every token of every active sequence:

$$
\text{KV bytes per token} = 2 \times \text{layers} \times \text{KV heads} \times \text{head dim} \times \text{bytes per value}
$$

For a Llama-3-8B-class model (32 layers, 8 KV heads, head dimension 128, 16-bit values): 2 × 32 × 8 × 128 × 2 = **128 KiB per token**. An 8,000-token conversation needs **~1 GiB**. On an 80 GB GPU with ~16 GB of weights, ~64 GB remain: **~64 concurrent 8k-token conversations**, or ~512 of 1k tokens. Concurrency is bounded by context length × users, which is why long prompts are expensive even when they are cheap per token.

Other serving techniques you will see in 2026 (all trade something for throughput or latency):

| Technique | Idea | Trade-off |
|---|---|---|
| Quantization (8-bit, 4-bit weights) | fewer bytes per weight → less memory, faster decode | some quality loss; must be evaluated |
| Speculative decoding[^6] | a small draft model proposes several tokens; the large model verifies them in one step | extra compute; gain depends on how often the draft is right |
| Chunked prefill | split long prefills so they do not stall ongoing decodes | slightly higher TTFT for long prompts |
| Prefill/decode disaggregation[^7] | run the two phases on different GPU pools | KV cache must move between pools; more moving parts |

### Self-hosted or API?

| Criterion | Provider API | Self-hosted (vLLM, SGLang, Ollama for dev) |
|---|---|---|
| Cost model | per token; zero when idle | per GPU-hour; paid when idle |
| Best when | traffic is spiky or small; best-quality models needed | traffic is high and steady; smaller open-weight models suffice |
| Latency control | limited (shared infrastructure, rate limits) | full (batch size, hardware, region) |
| Data control | contractual (retention, region) | full |
| Operations | none | GPUs, drivers, autoscaling, model updates, on-call |

A back-of-the-envelope check: a GPU that costs US$ *c* per hour and sustains *T* output tokens/s at your batch size costs $c / (3600 \cdot T \cdot u)$ per token at utilization *u*. At 10% utilization it is **10× more expensive per token** than at 100%. Self-hosting wins only with steady load — or when data cannot leave your network. For offline work (embedding the catalog, running evals), many providers also offer **batch APIs**: asynchronous, results within hours, at a discount.

---

## Observability at the gateway

Because every call passes through it, the gateway is the natural place to emit the LLM telemetry described in [Safety, Evals & Observability](../safety-evals/index.md#observability): one span per call with model, tokens (input, cached, output), cost, TTFT and finish reason, plus metrics aggregated per alias, feature and user tier. The dashboards answer the CFO's question directly: **US$ per conversation**, by feature, per day.

## Products

The gateway is a pattern, not a product. Examples, to explore — check each product's current documentation for capabilities:

=== "Open source"

    - **LiteLLM**: unified API, routing, fallbacks, budgets, spend tracking, as a proxy server or as an in-process SDK — its SDK `Router` is the gateway of [Hands-on 12](../../../hands-on/12/service/index.md).
    - **Envoy AI Gateway**: LLM traffic management built on Envoy Gateway.
    - Serving engines behind the gateway: **vLLM**, **SGLang**, **Ollama** (local development).

=== "Managed / cloud"

    - Cloud model platforms with routing and cross-region capacity: **Amazon Bedrock**, **Google Vertex AI**, **Azure AI Foundry**.
    - API-management products with LLM policies (token limits, semantic caching): **Azure API Management**, **Kong AI Gateway**, **Cloudflare AI Gateway**.

!!! tip "In the interview"

    Put an LLM gateway between every service and the models, and name four of its jobs: **routing by alias, fallbacks with circuit breakers, token quotas with priorities, and cost/latency telemetry**. Separate **TTFT** (interactive SLO, streamed) from **TPOT** (speed) in your latency estimate, and distinguish **prompt caching** (safe, cuts input cost and TTFT) from **semantic caching** (risky, only for generic answers). If the interviewer asks about self-hosting, answer with the KV-cache memory and utilization arguments.

!!! success "Best practices"

    - **Set a TTFT deadline per alias and fail over on it** — for a fan staring at an empty bubble, a provider that queues is as bad as one that is down; for example 3 s at p95 for the interactive alias.
    - **Reserve tokens with priorities, not only limits** — interactive traffic keeps ~70% of the account's TPM at 10:00 and batch jobs pause first ([quotas](#quotas)).
    - **Run the eval suite on every model of the fallback chain** — in BoxOffice the fallback of `claude` is a 1.5-billion-parameter local model ([lab 12 — `llm.py`](../../../hands-on/12/service/index.md)): it must pass the same golden set, or the fallback is a silent quality drop during an incident.
    - **Alert on the cached-token ratio per feature** — cached input is billed at a fraction of the price (10% in the [overview's example](../index.md#numbers)); a prompt edit that moves a variable to the top multiplies the input cost overnight.
    - **Attribute cost per feature and per user tier at the gateway** — "US$ per conversation" should be a dashboard panel, not an investigation. In BoxOffice: `metrics.price()` turns the tokens of every answer into dollars ([lab 12 — Guardrails and metrics](../../../hands-on/12/guardrails/index.md)).

!!! warning "Common pitfalls"

    - **Model names hard-coded in services** — every model change is a multi-team deploy. Use aliases.
    - **Unpinned "latest" models** — quality changes without a deploy, and nobody knows why the evals dropped.
    - **Retrying `400`s and refusals**, or falling back to a weaker-guarded model on a refusal.
    - **Rate limiting by requests only** — one 100k-token request costs as much as a thousand small ones.
    - **Variable data at the top of the prompt** — the prompt cache never hits.
    - **A semantic cache keyed only by the vector** — leaks answers across events, users or tenants.
    - **Proxy idle timeouts shorter than the longest stream** — answers cut in the middle under load.

---

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    SVC["assistant, summarizer,<br/>translator, embed job"] --> GW["LLM gateway<br/>routing by alias"]
    GW --> FB["fallbacks + circuit breaker<br/>→ Reliability"]
    GW --> Q["token quotas, priorities<br/>→ API gateway rate limiting"]
    GW --> PC["prompt caching<br/>(stable prefix)"]
    GW --> SC["semantic caching<br/>→ Caching invalidation"]
    GW --> ST["streaming over SSE, TTFT<br/>→ Edge protocols"]
    GW --> CAN["canary by alias<br/>→ Cloud-native delivery"]
    GW --> OBS["tokens, cost, TTFT<br/>→ Safety, Evals & Observability"]
    Q --> BG["background work waits<br/>→ Messaging queues"]
```

**Palette components:** [`llmgw`](../../../reference/components/ai/index.md#llmgw) · [`apigw`](../../../reference/components/edge/index.md#apigw) (its classic cousin) · [`thirdparty`](../../../reference/components/external/index.md#thirdparty) (the model providers behind it) · [`cache`](../../../reference/components/storage/index.md#cache) (semantic cache) · [`queue`](../../../reference/components/messaging/index.md#queue) (background work waiting for quota) · [`metrics`](../../../reference/components/observability/index.md#metrics) and [`tracing`](../../../reference/components/observability/index.md#tracing) (tokens, cost, TTFT). **Scenarios:** `ai-assistant`, `cascading-failure` (a slow provider without a breaker), `rate-limiter` (quotas as rate limits). **Continues in:** [Edge — API gateway](../../edge/api-gateway/index.md), [Reliability — patterns](../../reliability/patterns/index.md), [Caching — invalidation](../../caching/invalidation/index.md), [Edge — protocols](../../edge/protocols/index.md), [Agents & Tools](../agents/index.md).

---

[^1]: CHEN, L.; ZAHARIA, M.; ZOU, J. [FrugalGPT: How to Use Large Language Models While Reducing Cost and Improving Performance](https://arxiv.org/abs/2305.05176){target="_blank"}. arXiv, 2023.
[^2]: ONG, I. et al. [RouteLLM: Learning to Route LLMs with Preference Data](https://arxiv.org/abs/2406.18665){target="_blank"}. arXiv, 2024.
[^3]: OWASP. [Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/){target="_blank"}. LLM10: Unbounded Consumption.
[^4]: YU, G.-I. et al. Orca: A Distributed Serving System for Transformer-Based Generative Models. OSDI, 2022.
[^5]: KWON, W. et al. [Efficient Memory Management for Large Language Model Serving with PagedAttention](https://arxiv.org/abs/2309.06180){target="_blank"}. SOSP, 2023.
[^6]: LEVIATHAN, Y.; KALMAN, M.; MATIAS, Y. [Fast Inference from Transformers via Speculative Decoding](https://arxiv.org/abs/2211.17192){target="_blank"}. ICML, 2023.
[^7]: ZHONG, Y. et al. [DistServe: Disaggregating Prefill and Decoding for Goodput-optimized Large Language Model Serving](https://arxiv.org/abs/2401.09670){target="_blank"}. OSDI, 2024.
