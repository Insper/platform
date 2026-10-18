A fan asks the assistant: *"Can I bring my camera to the show at Arena Paulista, and is there step-free access to sector C?"*

The answer exists — somewhere in 4,000 documents: venue rules (PDFs uploaded by each venue, in Portuguese, revised every season), the accessibility guide, the FAQ, the event's own description. The model has never seen them: they are private, and many changed after its training data was collected. Asked directly, it will produce a fluent, plausible and possibly wrong answer.

Three tempting fixes, and why they fall short:

| Approach | Idea | Problem for BoxOffice |
|---|---|---|
| **Stuff everything in the prompt** | put all venue documents in the context window | 4,000 documents do not fit; even the ones that fit cost tokens on every call and dilute attention[^6] |
| **Fine-tune the model** | train the model further on the documents | slow and expensive to update every season; does not reliably memorize facts; cannot cite a source; cannot delete one venue's rules |
| **Retrieval-augmented generation (RAG)** | at question time, **retrieve** the few relevant passages and put **only those** in the prompt | the subject of this page |
| *(and for live data)* **Tools** | query the service | prices and seat availability are not documents — see [Agents & Tools](../agents/index.md) |

RAG[^1] turns a knowledge problem into a **search problem** — and search is a system design problem you already know how to measure.

---

## The two pipelines

A RAG system is two pipelines that meet at an index: an **ingestion** pipeline (asynchronous, throughput-oriented) and a **query** pipeline (synchronous, latency-oriented).

``` mermaid-sim
flowchart LR
    subgraph Ingestion["Ingestion (async)"]
        src["venue PDFs, FAQ,<br/>event descriptions"] --> parse["parse + clean"]
        parse --> chunk["chunk + add context"]
        chunk --> embed["embed (batch)"]
    end
    embed --> index[("Vector DB +<br/>keyword index")]
    subgraph Query["Query (online)"]
        q["fan question"] --> rewrite["rewrite to a<br/>standalone query"]
        rewrite --> hybrid["hybrid search:<br/>vector + keyword"]
        hybrid --> rerank["rerank top 20 → 5"]
        rerank --> prompt["prompt with sources"]
        prompt --> llm["LLM answer<br/>with citations"]
    end
    index --> hybrid
```

---

## Ingestion

### Sources, parsing and freshness

Ingestion starts as an ordinary data pipeline: read documents from where they live (object store, CMS, the `catalog` database), extract clean text (PDF parsing is often the hardest part: tables, columns, headers repeated on every page), and attach **metadata** — `doc_id`, `venue_id`, language, version, effective date, access level. Metadata is what lets you filter (*only this venue*), cite (*Arena Paulista rules, §4*) and delete (*the 2026 rules are obsolete*).

The index must follow the sources. Rather than re-embedding everything nightly, propagate **changes**: the `catalog` service publishes an event when a description changes (outbox or change data capture, as in [Messaging](../../messaging/patterns/index.md)); an embedding worker consumes it and updates only the affected chunks. **Deletions** must propagate too — a removed rule that is still retrievable is a wrong answer waiting to happen.

### Chunking { #chunking }

Documents are split into **chunks**, the unit of retrieval. Chunk size is a precision/context trade-off: small chunks match questions precisely but lose surrounding context; large chunks keep context but dilute the match and cost more tokens in the prompt.

| Strategy | How | When |
|---|---|---|
| Fixed size + overlap | e.g. 400 tokens with 15% overlap | baseline; uniform text |
| **Structure-aware** (recursive) | split on headings, then paragraphs, then sentences, up to a max size | rules, FAQs, manuals — most BoxOffice documents |
| Semantic | split where the topic changes (embedding similarity between sentences drops) | long unstructured text |
| Whole document | one chunk per small document | FAQ entries, event descriptions |
| **Parent–child** | retrieve with small chunks, send their larger parent section to the model | precise matching **and** enough context |
| **Contextual chunks** | prepend the document title and section, or a one-sentence summary of where the chunk sits, before embedding[^2] | chunks that are ambiguous alone ("Item 4: not permitted.") |

!!! example "Why context matters"

    The chunk *"Professional cameras with detachable lenses are not permitted."* is useless without knowing **which venue** it belongs to. Embedded as *"Arena Paulista — Visitor rules 2027 — §4 Prohibited items: Professional cameras with detachable lenses are not permitted."*, it is retrievable by venue name and citable.

### Embeddings { #embeddings }

An **embedding model** maps a text to a vector of a few hundred to a few thousand numbers, trained so that texts with similar meaning have vectors that point in similar directions. Similarity is usually measured by **cosine similarity** (or the inner product of normalized vectors):

$$
\cos(\vec{a}, \vec{b}) = \frac{\vec{a} \cdot \vec{b}}{\lVert\vec{a}\rVert \, \lVert\vec{b}\rVert}
$$

Practical rules:

- **Same model for documents and queries** — vectors from different models live in different spaces and cannot be compared.
- **Multilingual model** for BoxOffice: fans ask in Portuguese, English and Spanish; some venue documents are only in Portuguese.
- **Store the model name with each vector** (`embed_model`). Changing the embedding model means **re-embedding the whole corpus** — run it like a blue/green deployment: build the new index alongside, switch reads, then drop the old one.
- **Embedding is cheap compared to generation** (one forward pass, no decoding), and the ingestion side can use batch APIs; the query side embeds one short question per request (a few milliseconds to tens of milliseconds).

How much memory does the index need? Raw vectors are $N \times d \times$ bytes per value; an HNSW graph adds neighbor links per vector:

```python exec="true" html="1" source="tabbed-right"
# Memory needed by a vector index: raw vectors + HNSW graph links.
# HNSW keeps ~2*m neighbor ids per vector on the base layer (m = 16 here);
# real overhead varies by implementation: treat as an estimate.
M, ID_BYTES = 16, 8


def size_gb(n, dims, bytes_per_value):
    vectors = n * dims * bytes_per_value
    graph = n * 2 * M * ID_BYTES
    return (vectors + graph) / 1e9


head = ["Chunks", "384 dims, float32", "1024 dims, float32", "1024 dims, float16",
        "3072 dims, float32"]
print("<table><thead><tr>" + "".join(f"<th>{h}</th>" for h in head) + "</tr></thead><tbody>")
for n in (100_000, 1_000_000, 10_000_000, 100_000_000):
    cells = [f"{n:,}"] + [f"{size_gb(n, d, b):,.1f} GB"
                          for d, b in ((384, 4), (1024, 4), (1024, 2), (3072, 4))]
    print("<tr>" + "".join(f'<td style="text-align:right">{c}</td>' for c in cells) + "</tr>")
print("</tbody></table>")
```

BoxOffice's 4,000 documents become ~60,000 chunks: well under 1 GB, comfortably inside the PostgreSQL the team already runs. Ten million chunks of 1,024 dimensions (~44 GB) is where dedicated vector databases, quantization (half-precision or binary vectors) and sharding start to pay off.

---

## Vector search

Finding the exact nearest neighbors means comparing the query with **every** vector — fine for 60,000 chunks, too slow for 100 million. **Approximate nearest neighbor (ANN)** indexes trade a little recall for orders of magnitude of speed (see [Databases — specialized](../../databases/specialized/index.md)):

| Index | Idea | Strengths | Weaknesses |
|---|---|---|---|
| **HNSW**[^3] | multi-layer proximity graph; greedy search from a coarse layer down | high recall, low latency, incremental inserts | memory-hungry; slow to build |
| **IVF** (inverted file) | cluster vectors; search only the closest clusters | smaller, fast to build | needs training; recall drops for data far from centroids |
| Quantization (PQ, binary) | compress vectors | 4–32× less memory | lower precision; usually re-scored with full vectors |

The knob is the **recall/latency trade-off**: HNSW's `ef_search` (candidates explored per query) and IVF's `probes` raise recall at the cost of latency. Measure **recall@k against exact search** on a sample of real queries, as you would measure a cache's hit ratio.

**Filters complicate ANN.** *"Rules for venue X"* is a metadata filter applied to an approximate search: if the index returns the 40 nearest chunks and only 2 belong to venue X, the result has 2 rows instead of 40. Remedies: filter-aware indexes, partitioning by the filter key, or iterative scans that keep searching until enough rows pass (pgvector supports this from version 0.8 with `hnsw.iterative_scan`).

=== "PostgreSQL + pgvector"

    The `vector` type, distance operators (`<->` L2, `<=>` cosine distance, `<#>` negative inner product) and HNSW/IVFFlat indexes inside the database you already operate: transactions, joins with metadata, backups and access control for free. HNSW on `vector` supports up to 2,000 dimensions (`halfvec`, up to 4,000). Good up to millions of vectors per node. Used in [Hands-on 12](../../../hands-on/12/index.md).

=== "Dedicated vector databases"

    Qdrant, Milvus, Weaviate, Pinecone (managed), among others: built-in sharding and replication, quantization, filtered search and hybrid search at hundreds of millions of vectors. One more system to operate and keep consistent with the source of truth.

=== "Search engines with vectors"

    OpenSearch, Elasticsearch, Vespa: mature keyword search (BM25), aggregations and vectors in the same engine — a natural fit when you already run one for the catalog [Search](../../databases/specialized/index.md).

---

## The query pipeline

### 1. Rewrite the question

*"And what about sector C?"* means nothing alone. Before searching, a cheap model call (or the agent itself) rewrites the turn into a **standalone query** using the conversation — *"step-free access to sector C at Arena Paulista"* — and extracts filters (`venue_id`). Some systems also generate several query variants or a hypothetical answer to search with.

### 2. Hybrid search { #hybrid }

Dense vectors capture meaning, but they are weak with **exact tokens**: sector "C", gate numbers, event codes, artist names, acronyms such as *PCD* (*pessoa com deficiência*, person with disability). Keyword search with BM25[^4] is the opposite: exact, but blind to paraphrase ("step-free" vs "wheelchair accessible"). **Hybrid search** runs both and fuses the rankings. The standard fusion is **Reciprocal Rank Fusion (RRF)**[^5], which needs only ranks, not comparable scores:

$$
\text{RRF}(d) = \sum_{r \in \text{rankings}} \frac{1}{k + \text{rank}_r(d)}, \qquad k = 60
$$

A chunk ranked 1st by keywords and 3rd by vectors scores $1/61 + 1/63 ≈ 0.0323$; one ranked 1st by vectors only scores $1/61 ≈ 0.0164$. Agreement between the two retrievers wins.

### 3. Rerank

The first stage is fast but rough: each chunk was embedded **without seeing the question**. A **reranker** (a cross-encoder) reads the question and each candidate **together** and outputs a relevance score[^7] — much more accurate, much slower (one model pass per pair). So it runs only on the top 20–50 candidates and keeps the best 3–8. Typical cost: tens to a couple hundred milliseconds.

### 4. Assemble the context and cite

Put the selected chunks in the prompt with their IDs and titles, best first (models use the beginning and the end of a long context better than the middle[^6]), within a token budget. Instruct the model to answer **only from the sources**, to cite them as `[doc_id]`, and to say *"I don't know"* when the sources do not answer. Then **verify**: every cited ID must be one of the chunks provided (a cheap, deterministic check in the [Safety Mesh](../safety-evals/index.md)).

### The schema and the query in PostgreSQL

``` sql title="kb_schema.sql"
CREATE EXTENSION IF NOT EXISTS vector;

-- Knowledge base: venue rules, FAQ, accessibility guides (one row per chunk)
CREATE TABLE kb_chunk (
    id          bigserial PRIMARY KEY,
    doc_id      text         NOT NULL,     -- source document, for citations and deletes
    venue_id    text,                      -- NULL = applies to every venue
    title       text         NOT NULL,     -- "Arena Paulista — Visitor rules 2027 — §4"
    content     text         NOT NULL,
    embedding   vector(1024) NOT NULL,     -- dimension of the embedding model
    embed_model text         NOT NULL,     -- which model produced the vector
    tsv         tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', content)) STORED,
    updated_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX kb_chunk_embedding ON kb_chunk USING hnsw (embedding vector_cosine_ops);
CREATE INDEX kb_chunk_tsv       ON kb_chunk USING gin (tsv);
CREATE INDEX kb_chunk_venue     ON kb_chunk (venue_id);
```

``` sql title="hybrid_search.sql"
-- $1 = query embedding, $2 = query text, $3 = venue id
WITH q AS (  -- the words of the question, joined with OR
    SELECT to_tsquery('portuguese', array_to_string(
               tsvector_to_array(to_tsvector('portuguese', $2)), ' | ')) AS query
),
semantic AS (
    SELECT id, row_number() OVER (ORDER BY dist) AS rank
    FROM (SELECT id, embedding <=> $1 AS dist          -- cosine distance (HNSW index)
          FROM kb_chunk
          WHERE venue_id = $3 OR venue_id IS NULL
          ORDER BY dist
          LIMIT 40) AS nearest
),
keyword AS (
    SELECT id, row_number() OVER (ORDER BY score DESC) AS rank
    FROM (SELECT id, ts_rank_cd(tsv, q.query) AS score -- full-text match (GIN index)
          FROM kb_chunk, q
          WHERE tsv @@ q.query AND (venue_id = $3 OR venue_id IS NULL)
          ORDER BY score DESC
          LIMIT 40) AS matches
)
SELECT c.id, c.doc_id, c.title, c.content,
       coalesce(1.0 / (60 + s.rank), 0) + coalesce(1.0 / (60 + k.rank), 0) AS rrf
FROM semantic s
FULL OUTER JOIN keyword k USING (id)
JOIN kb_chunk c USING (id)
ORDER BY rrf DESC
LIMIT 20;  -- candidates for the reranker, which keeps the best 5
```

PostgreSQL's `ts_rank_cd` is not exactly BM25, but for fusion only the **rank order** matters; engines such as OpenSearch provide BM25 natively.

### Latency budget of one retrieval

| Stage | Typical latency |
|---|---|
| Rewrite query (small model) | 200–500 ms |
| Embed query | 5–50 ms |
| Vector + keyword search (in parallel) | 5–30 ms |
| Rerank 20–40 candidates | 30–200 ms |
| Extra prompt tokens (5 chunks × ~400 tokens) | +2,000 input tokens per model call → cost, and TTFT if not cached |

Retrieval itself is cheap; the **extra tokens it adds to every model call** are what you pay for. Retrieve fewer, better chunks.

### Measuring retrieval

Evaluate the two halves separately (more in [Safety, Evals & Observability](../safety-evals/index.md#evaluation)):

- **Retrieval**: for a set of questions with known relevant chunks, **recall@k** (did the right chunk make the top *k*?), precision@k, and **MRR** (mean reciprocal rank: how high the first relevant chunk appears).
- **Generation**: **faithfulness/groundedness** (is every claim supported by the retrieved sources?) and answer relevance; frameworks such as RAGAS[^8] automate these with model-based judges.

If the answer is wrong, these metrics tell you *where*: retrieval missed the document (fix chunking, hybrid, filters) or the model ignored it (fix the prompt, the order, the model).

### Variants you will meet

| Variant | Idea | Use when |
|---|---|---|
| **Agentic RAG** | retrieval is a tool; the agent decides when and what to search, possibly several times | multi-hop questions ("compare the bag rules of the two venues") |
| **GraphRAG** | build a knowledge graph of entities and relations; retrieve subgraphs or community summaries | questions about relationships across many documents |
| **Multimodal RAG** | index images and tables (venue maps, seat charts) with multimodal embeddings | knowledge that lives in pictures |
| **Long context + RAG** | retrieve whole documents instead of chunks, relying on large windows | few, long, coherent documents; cost and latency allow it |

---

## Memory { #memory }

RAG answers *"what does the world know?"*. **Memory** answers *"what does the assistant know about this conversation and this fan?"*. Both end up as tokens in the prompt, but they have different lifetimes, owners and risks. A useful vocabulary comes from cognitive architectures for language agents[^9]:

| Memory type | What it holds | BoxOffice example | Where it lives | Lifetime |
|---|---|---|---|---|
| **Working** | the current context window | this call's prompt | the model call | one call |
| **Short-term (session)** | the conversation so far, task state, pending holds | "the fan is choosing between C12–C13 and D4–D5" | Redis, keyed by conversation, with TTL | minutes to hours |
| **Long-term — semantic** | stable facts and preferences about the user | "prefers aisle seats", "home city: Campinas" | SQL (profile table), editable by the fan | until changed or deleted |
| **Long-term — episodic** | past interactions, retrievable by similarity | "last month the fan's transfer failed; it was refunded" | vector index over summaries of past conversations | retention policy |
| **Procedural** | how the assistant behaves: instructions, tool usage rules, examples | the system prompt, refund rules | Git, versioned and evaluated like code | per release |

``` mermaid-sim
flowchart LR
    orch["Orchestrator"] -->|"1. load session"| redis[("Cache<br/>session, TTL 2 h")]
    orch -->|"2. load profile"| sql[("SQL<br/>preferences")]
    orch -->|"3. recall episodes"| epi[("Vector DB<br/>past conversations")]
    orch -->|"4. retrieve knowledge"| kb[("Vector DB<br/>knowledge base")]
    orch -->|"5. after the turn: append"| redis
    orch -.->|"6. async: extract memories"| worker["memory worker"]
    worker -.-> sql
    worker -.-> epi
```

### Writing memories

Reading memory is retrieval; **writing** it is where the risks are:

- **Explicit** memories ("remember that I use a wheelchair") are reliable but rare. **Implicit** extraction — a worker asks a model to extract facts from finished conversations — is convenient and error-prone: a joke becomes a "fact", a wrong inference persists forever.
- **Memory poisoning**: content injected into a conversation (or a document) can be saved as a fact and influence every future session. Extract only from the **user's own messages**, never from tool results or retrieved documents, and keep the source of each memory.
- **Short-term memory overflows** the context in long sessions: keep the last turns verbatim and **compact** older ones into a running summary.
- **Consistency**: memories written asynchronously are not visible in the next turn — read-your-writes again ([Distributed consistency](../../distributed/consistency/index.md)). Write the session synchronously; extract long-term memories asynchronously.

### Privacy is a design constraint

Memory makes the assistant a store of personal data. Under the LGPD, health information such as a disability is **sensitive personal data**, requiring specific consent. The design implications are concrete:

- Show the fan what is remembered, and let them **edit and delete** it.
- **Deletion must reach every copy**: the profile row, the episodic vectors, the session cache, the semantic cache, the logs and traces that captured prompts. Design the `doc_id`/`user_id` keys so a delete is one query per store, not an archaeology project.
- Apply **retention** (TTL) by default; keep memories per tenant and per user, and filter retrieval by them — never search one user's episodes for another.

!!! example "BoxOffice: one turn, all memories"

    For *"two seats under R$300 for Saturday"*, the orchestrator loads the session (empty: new conversation), the profile (home city São Paulo, prefers aisle seats, needs step-free access — stored with consent), no relevant episodes, and no knowledge-base chunks (it is a structured query, handled by tools). The final prompt mentions *"prefers aisle seats; requires step-free access"*, so the model asks `search_seats` for aisle seats in accessible sectors. When the fan later asks *"can I bring my camera?"*, the same orchestrator retrieves two chunks of the venue rules and cites them.

!!! tip "In the interview"

    Draw the **two pipelines** (ingestion async, query online) and name the stages: chunk, embed, index; rewrite, **hybrid search with RRF**, **rerank**, cite. Estimate the index size ($N \times d \times 4$ bytes) and say where it lives (pgvector until tens of millions of vectors). Say explicitly that **live structured data goes through tools, not RAG**, that the index is kept fresh with **change events**, and that memory has **types with different stores and lifetimes** — plus deletion for privacy.

!!! warning "Common pitfalls"

    - **Vector-only search** — misses sector codes, names and acronyms; add keyword search.
    - **Chunks without context** — "Item 4: not permitted" matches nothing useful; prepend titles and sections.
    - **Mixing embedding models** in one index, or changing the model without re-embedding.
    - **Stale or zombie chunks** — updates and deletes in the source never reach the index.
    - **Retrieval without access control** — the index returns a document the user may not see; filter by tenant/permissions **in the query**, not after generation.
    - **Too many chunks** — 20 chunks "just in case" cost tokens on every call and bury the answer in the middle.
    - **Saving tool outputs or documents as user memories** — the door to memory poisoning.

---

## How it connects { #how-it-connects }

``` mermaid
flowchart LR
    SRC["venue PDFs, FAQ,<br/>event descriptions"] --> ING["ingestion: parse,<br/>chunk, embed (batch)"]
    CDC["change events<br/>→ Messaging outbox / CDC"] --> ING
    ING --> IDX["vector + keyword index<br/>→ Databases specialized"]
    Q["fan question"] --> HY["rewrite, hybrid search,<br/>RRF, rerank"]
    IDX --> HY
    HY --> P["prompt with citations"]
    MEM["memory types: session,<br/>profile, episodic"] --> P
    MEM --> RYW["read-your-writes<br/>→ Distributed consistency"]
    MEM --> DEL["deletion reaches<br/>every copy (LGPD)"]
    P --> GUARD["retrieved text is untrusted<br/>→ Safety mesh"]
```

**Palette components:** [`memory`](../../../reference/components/ai/index.md#memory) (the whole fabric) · [`vectordb`](../../../reference/components/storage/index.md#vectordb) (knowledge base and episodic memories) · [`cache`](../../../reference/components/storage/index.md#cache) (session memory with a TTL) · [`sql`](../../../reference/components/storage/index.md#sql) (profile and preferences; pgvector lives here too) · [`objstore`](../../../reference/components/storage/index.md#objstore) (the source documents) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (change events that keep the index fresh) · [`worker`](../../../reference/components/compute/index.md#worker) (ingestion and memory extraction off the request path). **Scenarios:** `ai-assistant`. **Continues in:** [Databases — specialized](../../databases/specialized/index.md) (vector search), [Messaging — patterns](../../messaging/patterns/index.md) (outbox, CDC), [Distributed — consistency](../../distributed/consistency/index.md), [Agents & Tools](../agents/index.md) (live data goes through tools, not RAG), [Safety, Evals & Observability](../safety-evals/index.md).

---

[^1]: LEWIS, P. et al. [Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks](https://arxiv.org/abs/2005.11401){target="_blank"}. NeurIPS, 2020.
[^2]: ANTHROPIC. [Introducing Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval){target="_blank"}. 2024.
[^3]: MALKOV, Y.; YASHUNIN, D. [Efficient and robust approximate nearest neighbor search using Hierarchical Navigable Small World graphs](https://arxiv.org/abs/1603.09320){target="_blank"}. IEEE TPAMI, 2018.
[^4]: ROBERTSON, S.; ZARAGOZA, H. The Probabilistic Relevance Framework: BM25 and Beyond. *Foundations and Trends in Information Retrieval*, 2009.
[^5]: CORMACK, G.; CLARKE, C.; BÜTTCHER, S. Reciprocal Rank Fusion outperforms Condorcet and individual rank learning methods. SIGIR, 2009.
[^6]: LIU, N. F. et al. [Lost in the Middle: How Language Models Use Long Contexts](https://arxiv.org/abs/2307.03172){target="_blank"}. TACL, 2024.
[^7]: NOGUEIRA, R.; CHO, K. [Passage Re-ranking with BERT](https://arxiv.org/abs/1901.04085){target="_blank"}. arXiv, 2019.
[^8]: ES, S. et al. [RAGAS: Automated Evaluation of Retrieval Augmented Generation](https://arxiv.org/abs/2309.15217){target="_blank"}. EACL (demo), 2024.
[^9]: SUMERS, T. et al. [Cognitive Architectures for Language Agents](https://arxiv.org/abs/2309.02427){target="_blank"}. TMLR, 2024.
