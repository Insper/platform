Click **"Answer"** to reveal the correct answer and explanation.

---

## Gateway and serving

**Q1.** Why does the assistant call models through a LiteLLM `Router` instead of calling the Ollama and Anthropic SDKs directly?

- A. LiteLLM makes models faster
- B. One place owns routing, fallback, timeouts, retries and cost accounting; the rest of the code calls a route name ("local", "claude") and does not change when a provider or model does
- C. The Anthropic API cannot be called from Python
- D. Ollama requires LiteLLM

??? success "Answer"
    **B — the LLM gateway.**

    Providers fail, change prices and get replaced. With a gateway, switching the default model, adding a fallback or a budget is configuration in one module. At larger scale, the same idea runs as a shared proxy for all AI services.

---

**Q2.** The assistant streams its answer. Why is k6's `http_req_waiting` (time to first byte) not the time to first token?

- A. k6 cannot read HTTP responses
- B. The server sends the HTTP status and headers when the response starts, before the model produces any token; TTFT must be measured at the first `event: token` of the stream
- C. Time to first byte is always larger than TTFT
- D. SSE responses have no first byte

??? success "Answer"
    **B — headers come first.**

    `StreamingResponse` starts the response immediately; the first token arrives seconds later. That is why `scripts/assistant_load.py` parses the Server-Sent Events, and why the service also records TTFT itself (`assistant_ttft_seconds`).

---

**Q3.** At concurrency 1, an answer takes 120 s. Fans send 1 question per minute. How many requests are in flight on average, and what does it mean?

- A. 0.5: the model is idle half of the time
- B. 2: Little's Law, L = λ·W = (1/60 per s) × 120 s; with one model instance serving one request at a time, requests queue and TTFT grows
- C. 120: one per second
- D. 1: always one request

??? success "Answer"
    **B — L = λW = 2.**

    LLM serving is a queueing problem like any other. Slow decode (CPU) makes W large, so even a tiny arrival rate saturates the server. The fixes are faster hardware, batching on the serving side, admission control (a queue with honest waiting times), or a hosted API.

---

## RAG

**Q4.** Why are documents embedded with the prefix `search_document:` and questions with `search_query:`?

- A. pgvector requires prefixes
- B. `nomic-embed-text` was trained with these task prefixes; using them puts documents and queries in the regions of the vector space where the model learned to match them, improving retrieval
- C. To make the vectors shorter
- D. To mark which rows are documents in the table

??? success "Answer"
    **B — follow the embedding model's training format.**

    Each embedding model has its own conventions (prefixes, maximum length, normalization). Ignoring them silently lowers retrieval quality — which is why retrieval must be measured (hit@k) and not assumed.

---

**Q5.** What does the HNSW index on `embedding vector_cosine_ops` trade?

- A. Exactness for speed: it finds the approximate nearest neighbours in roughly logarithmic time instead of comparing the query with every row, and may occasionally miss a true neighbour
- B. Disk for memory: it stores no vectors
- C. Consistency for availability
- D. Nothing: it is exact and faster

??? success "Answer"
    **A — approximate nearest neighbours.**

    An exact search is a full scan (fine for 300 rows, not for millions). HNSW navigates a layered graph; its parameters (`m`, `ef_construction`, and `hnsw.ef_search` at query time) tune recall against speed. The index must use the same operator class as the queries (`<=>` ↔ `vector_cosine_ops`).

---

**Q6.** The retrieval evaluation gives hit@5 = 1.00 but MRR = 0.94: one question's right answer was at rank 3. Which question, and why is it the hard one?

- A. "When is Play #7?", because 7 is a small number
- B. "the big festival night at the stadium in São Paulo": the right event (BoxOffice Fest — Stadium Night) competes with many generic festivals at the same stadium; vector search is weakest with exact names and dates, which is where hybrid (keyword + vector) search and rerankers help
- C. "Is there any festival in Recife?", because there are 9 right answers
- D. None; MRR is always below 1

??? success "Answer"
    **B — names and specifics.**

    Embeddings capture "a festival at a stadium in São Paulo" well, but not which one is *the* big one. Keyword search on the title, or a reranker that reads query and candidates together, fixes exactly this kind of miss.

---

## Tools and agents

**Q7.** Why does `get_order_status` take the user's e-mail from the `X-User-Email` header instead of a tool argument?

- A. Tool arguments cannot contain e-mails
- B. Identity must come from the platform (the gateway validated the JWT), not from the model: a user could otherwise ask "show me the order of ana@example.com", or a prompt injection could make the model pass another e-mail
- C. To save tokens
- D. Because the order service has no e-mail field

??? success "Answer"
    **B — the model is not an authentication layer.**

    Anything the model produces can be influenced by the user or by injected text. Authorization decisions use facts the model cannot forge; the tool also answers "order not found" for orders of other users, so it does not even confirm they exist.

---

**Q8.** Why is the agent loop limited to `MAX_STEPS = 4`, with the last call made without tools?

- A. Ollama does not support more than four calls
- B. Each step is another LLM call (latency and cost add up), and a model can loop calling tools; the bound guarantees an answer in at most four calls
- C. To make the answer shorter
- D. Because there are only three tools

??? success "Answer"
    **B — bound the cost and the latency of every question.**

    Agents trade predictability for flexibility. A step limit (and a token or cost budget) turns an open-ended loop into one with a worst case you can plan capacity for.

---

**Q9.** Why does the assistant retrieve the top-k events **before** the first model call, instead of relying on the model to call `search_events`?

- A. Because `search_events` does not work
- B. The common questions need the catalog anyway, and small models call tools unreliably; retrieving first makes the answer possible in one call (lower latency and cost), and tools remain for what retrieval cannot know, such as live order status
- C. Because tools cannot run in parallel
- D. To avoid using pgvector

??? success "Answer"
    **B — RAG for knowledge, tools for live or private data.**

    Every tool round trip is a full extra LLM call. A deterministic retrieval step is cheaper and does not depend on the model deciding to use a tool.

---

## Safety and cost

**Q10.** The input guard blocks "ignore all previous instructions". Is the assistant now safe from prompt injection?

- A. Yes, the pattern covers all injections
- B. No: patterns miss paraphrases, other languages and injections hidden in documents or tool results; the real protection is architectural — read-only tools, identity from headers, output checks — so that a successful injection can do little harm
- C. Yes, if the pattern is case-insensitive
- D. No, and nothing can be done about it

??? success "Answer"
    **B — defense in depth; limit the blast radius.**

    Treat injection as inevitable and design so that a manipulated model has nothing dangerous to call and no data it should not see. Pattern filters are a cheap first layer and a measurable signal (`assistant_guardrail_blocks_total`).

---

**Q11.** An answer cites `[event:999]`, but event 999 was not in the context nor returned by a tool. What does the output guard do, and why?

- A. Nothing; citations are decorative
- B. Replaces the citation with `[unverified]` and marks the answer `grounded: false` (counted in a metric): the model invented a reference, so the claim next to it cannot be trusted
- C. Deletes the whole answer
- D. Calls `get_event(999)` to check

??? success "Answer"
    **B — cite only what you received.**

    The set of documents the model saw (`ctx.evidence`) is known exactly. Checking citations against it is cheap and catches a common hallucination; the grounding rate over many questions is a quality metric of the model + prompt.

---

**Q12.** A question uses about 1 000 input tokens and 100 output tokens. With `claude-opus-5-5` at US$ 4 per million input tokens and US$ 20 per million output tokens, what does it cost, and what do 20 000 questions on sale day cost?

- A. US$ 0.024 per question; US$ 480
- B. US$ 0.006 per question; US$ 120
- C. US$ 0.0006 per question; US$ 12
- D. US$ 0.06 per question; US$ 1 200

??? success "Answer"
    **B — 1 000 × 4/10⁶ + 100 × 20/10⁶ = 0.004 + 0.002 = US$ 0.006; × 20 000 = US$ 120.**

    Input tokens dominate here because of the retrieved context: fewer or shorter documents cut cost and TTFT together. This arithmetic is exactly what `assistant_llm_cost_usd_total` accumulates — with prices you must keep up to date.

[Back to the lab](index.md){ .md-button }
