
> *"Design the search box suggestions of a large site: as the user types, show the 5–10 most likely completions of what they are typing, fast enough to feel instantaneous."*

Autocomplete (also called *typeahead* or *search-as-you-type*) looks like a small UI feature and is a very instructive system. Every **keystroke** is a request, so it is one of the highest-QPS endpoints of any site; the answer must arrive in well under 100 ms or it is useless (the user already typed the next letter); and the suggestions are **derived data** — computed offline from millions of past searches, then served from memory. The interview tests whether you separate the **serving path** (a read-only, in-memory index) from the **data path** (logs → aggregation → index build), and whether you know which data structure answers "top-k completions of a prefix" without scanning.

BoxOffice needs exactly this: fans type `col…` and expect *Coldplay*, *Coldplay São Paulo*, *Coala Festival*, mixing artists, venues and cities. When a tour is announced, searches for that artist jump within minutes — and yesterday's suggestions do not know it yet. That freshness problem is one of the deep dives below.

| | |
|---|---|
| **Difficulty** | :material-star::material-star: medium |
| **Key concepts** | trie with top-k cached per node, prefix hash table, finite-state transducers, offline aggregation with time decay, immutable index snapshots and atomic swap, trending overlay, sharding by prefix and skew, browser/CDN caching, client debouncing, blocklists |
| **Palette components** | [`client`](../../../reference/components/client/index.md#client), [`cdn`](../../../reference/components/edge/index.md#cdn), [`apigw`](../../../reference/components/edge/index.md#apigw), [`search`](../../../reference/components/compute/index.md#search), [`cache`](../../../reference/components/storage/index.md#cache), [`analytics`](../../../reference/components/compute/index.md#analytics), [`stream`](../../../reference/components/messaging/index.md#stream), [`dwh`](../../../reference/components/storage/index.md#dwh), [`worker`](../../../reference/components/compute/index.md#worker) |
| **Playground scenario** | `search-autocomplete` |

!!! abstract "What this case trains"

    - **Estimate** keystroke traffic and **show** how debouncing and caching cut it before it reaches the servers.
    - **Explain** how a trie with top-k cached in every node answers a prefix in O(length of the prefix), and **compare** it with a prefix hash table.
    - **Design** the data pipeline that turns search logs into an index: aggregation, time decay, snapshot build, atomic swap.
    - **Decide** between replicating the whole index and sharding it by prefix, accounting for skew.
    - **Handle** freshness (trending queries), filtering of offensive or blocked terms, and a latency budget of tens of milliseconds.

---

## 1. Clarify the requirements

([interview framework](../../intro/interview-framework/index.md))

### Functional requirements

1. As the user types, return up to **k = 8** suggestions that **start with** the typed prefix, ranked by popularity.
2. Suggestions can be **typed** entities (artist, venue, city, event) with an ID, so the UI can show an icon and jump straight to the page.
3. Suggestions reflect what people search: **popular** queries first, with **recent trends** surfacing within minutes.
4. Offensive, illegal or blocked terms **never** appear.
5. Results may depend on **locale** (pt-BR vs. en) and, optionally, on the user's city.

### Non-functional requirements

| Quality | Target |
|---|---|
| **Latency** | p99 < 100 ms as perceived by the user; < 10–20 ms inside our servers |
| **Throughput** | Tens of thousands of requests/s at peak (every keystroke is a request) |
| **Availability** | 99.9%; if autocomplete fails, the search box still works — it degrades gracefully |
| **Freshness** | Popularity updated daily; trending queries visible within ~15 minutes |
| **Consistency** | Not required: two users may see slightly different suggestions for a few minutes |

### Out of scope (say it explicitly)

The full search results page (ranking, inverted index — see the [search component](../../../reference/components/compute/index.md#search)), spelling correction beyond simple typo tolerance, voice search, ads in suggestions.

??? question "Questions to ask the interviewer"

    | Question | Why it matters |
    |---|---|
    | Prefix match only, or also matches in the middle of words ("paulo" → "Coldplay São Paulo")? | Prefix → trie/FST; infix → n-gram or inverted index, more memory. |
    | How many suggestions, and ranked by what? | Top-k per prefix is precomputed with a fixed k and a fixed score. |
    | How fresh must suggestions be? | Daily rebuild vs. a streaming "trending" layer. |
    | Personalized per user? | Personalized results cannot be cached at the CDN. |
    | Multiple languages and regions? | One index per locale/region, or a filter at serve time. |
    | Typo tolerance? | Fuzzy matching multiplies the work per keystroke. |

---

## 2. Back-of-the-envelope estimates

```python exec="1" source="tabbed-right"
# Search autocomplete: assumptions (illustrative)
dau             = 20_000_000
searches_per    = 5           # searches per user per day
chars_per_query = 12          # average characters typed
req_per_search  = 4           # requests actually sent after debouncing (not 12)
peak_factor     = 5           # tour announcement spikes
distinct_q      = 5_000_000   # distinct queries kept after a minimum-count filter
prefixes_per_q  = 6           # new trie nodes per query (prefixes are shared)
node_b          = 200         # node: children map + top-10 ids + overhead
log_b           = 100         # one logged search (query, ts, locale, city)
cdn_hit         = 0.5         # share of prefix requests answered by browser/CDN caches

naive_rps   = dau * searches_per * chars_per_query / 86_400
rps         = dau * searches_per * req_per_search / 86_400
peak_rps    = rps * peak_factor
origin_peak = peak_rps * (1 - cdn_hit)
trie_nodes  = distinct_q * prefixes_per_q
trie_gb     = trie_nodes * node_b / 1e9
logs_gb_day = dau * searches_per * log_b / 1e9

rows = [
    ("naive_rps", naive_rps, "req/s"), ("rps", rps, "req/s"),
    ("peak_rps", peak_rps, "req/s"), ("origin_peak", origin_peak, "req/s"),
    ("trie_nodes", trie_nodes, "nodes"), ("trie_gb", trie_gb, "GB"),
    ("logs_gb_day", logs_gb_day, "GB/day"),
]
print("| quantity | value | unit |\n|---|---:|---|")
for name, value, unit in rows:
    v = f"{value:,.0f}" if abs(value) >= 100 else f"{value:,.2f}"
    print(f"| `{name}` | {v} | {unit} |")
```

What the numbers tell us:

- One request per character would be **~14 k req/s** on average. **Debouncing** in the client (send only after the user pauses ~100–150 ms) cuts it to **~4.6 k req/s**; a tour announcement multiplies it by 5, to **~23 k req/s**. ⇒ the cheapest request is the one never sent.
- Short prefixes (`c`, `co`, `col`) are the same for everybody: if browser and CDN caches answer half of the requests, the origin sees **~12 k req/s** at peak.
- The whole index — **~30 M trie nodes, ~6 GB** — fits in the memory of one server. ⇒ the default is to **replicate the full index** on every serving node, not to shard it; sharding is a later step if the index grows (more locales, more entity types).
- Logs are **~10 GB/day** — modest. Aggregating them is a batch/stream job; it never touches the serving path.

!!! tip "In the interview"

    Split the problem out loud: *"There are two systems here. A serving system — read-only, in-memory, answering a prefix in a few milliseconds — and a data pipeline that rebuilds what it serves from the search logs. They only meet at the index snapshot."*

---

## 3. API

```http
GET /v1/autocomplete?q=col&limit=8&locale=pt-BR&city=sao-paulo
    → 200 Cache-Control: public, max-age=60
      {"prefix": "col",
       "suggestions": [
         {"text": "Coldplay", "type": "artist", "id": "a-118"},
         {"text": "Coldplay São Paulo", "type": "event", "id": "e-4410"},
         {"text": "Coldplay Rio", "type": "event", "id": "e-4411"}
       ]}

POST /v1/search/events      (batched, asynchronous; or simply the access logs)
    {"query": "coldplay sao paulo", "selected": "e-4410", "position": 2, "ts": 1767261600123}
```

- The response is **cacheable** for public, non-personalized prefixes (`Cache-Control: public, max-age=60`): browsers and the CDN answer repeated prefixes without reaching us ([DNS & CDN](../../edge/dns-cdn/index.md)).
- Normalize the prefix **before** caching and lookup (lowercase, trim, strip accents: `Colé` → `cole`) so equal prefixes share a cache key.
- Personalization (the user's own recent searches) is merged **in the client**, keeping the server response shareable.

---

## 4. Data model

```text
# Serving: an immutable in-memory index per locale, loaded from a snapshot file
trie node "col" → children {d, o, …}, top: [(98000, a-118 "Coldplay"), (41000, e-4410 …), …]

# Snapshot files in object storage, one per build
s3://…/autocomplete/pt-BR/2027-03-14T10:00Z/index.bin     (+ manifest with checksum)

# Trending overlay (cache, refreshed every minute by the stream job)
trending:pt-BR → [("coldplay 2027", 15400), ("metallica rio", 8200)]   TTL 30 min
```

```sql
-- Aggregated counts in the data warehouse, input of the index build
CREATE TABLE query_counts_daily (
    locale     TEXT,
    query      TEXT,          -- normalized
    day        DATE,
    searches   BIGINT,
    selections BIGINT,        -- suggestion clicked / result opened
    PRIMARY KEY (locale, query, day)
);
```

| Data | Store | Why |
|---|---|---|
| Serving index | In-memory trie/FST in the autocomplete service (`search`), loaded from a snapshot | Microsecond lookups; read-only, so no locks; ~6 GB fits in RAM |
| Snapshots | Object store | Versioned, immutable, easy to roll back |
| Search events | Event stream (`stream`) → data warehouse (`dwh`) | Append-only logs, aggregated in batch |
| Daily counts | Data warehouse (`dwh`) | Large scans and group-bys for the build |
| Trending overlay, hot prefixes | Cache (`cache`) | Small, frequently updated, shared by all serving nodes |

---

## 5. High-level design

``` diagram-sim
flowchart LR
    u([Browser / app]) --> cdn["CDN<br/>short prefixes, 60 s"]
    cdn --> gw["API gateway"]
    gw --> ac["Autocomplete service<br/>in-memory index (replicas)"]
    ac --> tr[("Cache<br/>trending overlay")]
    u -. search events .-> st[["Event stream<br/>search logs"]]
    st --> agg["Aggregation workers<br/>counts with decay"]
    agg --> dwh[("Data warehouse<br/>query counts")]
    st --> trend["Trending job<br/>last 15 min"]
    trend --> tr
    dwh --> build["Index builder<br/>(hourly / daily)"]
    build --> obj[("Object store<br/>index snapshots")]
    obj -. load + atomic swap .-> ac
```

One keystroke, from typing to suggestions:

``` diagram-sim
sequenceDiagram
    autonumber
    participant U as Browser
    participant C as CDN
    participant A as Autocomplete service
    participant T as Trending cache
    U->>U: user types "col", waits 120 ms (debounce)
    U->>C: GET /autocomplete?q=col
    alt cached prefix
        C-->>U: suggestions (from edge)
    else miss
        C->>A: GET /autocomplete?q=col
        A->>A: walk trie c → o → l, read top-8 (microseconds)
        A->>T: trending entries starting with "col" (local copy)
        A->>A: merge, filter blocklist, dedupe
        A-->>C: 200, max-age=60
        C-->>U: suggestions
    end
    U->>U: drop response if the prefix changed meanwhile
```

---

## 6. Deep dives

### 6.1 The data structure: trie with top-k per node

A **trie** stores strings character by character; every path from the root is a prefix. Finding the best completions of `col` naively means walking to the node `col` and then visiting its **whole subtree** to rank every query below it — far too slow for `c`, whose subtree is a large part of the index.

The fix is to **cache the top-k completions in every node** at build time. A lookup becomes: walk `len(prefix)` nodes, return the list stored there — no subtree walk ([specialized data stores](../../databases/specialized/index.md)):

```python exec="1" source="tabbed-right"
# A tiny trie that caches the top-k completions in every node
K = 3
counts = {                         # aggregated query counts (illustrative)
    "coldplay": 9_800, "coldplay sao paulo": 4_100, "coldplay rio": 2_900,
    "colombia festival": 600, "coala festival": 1_200, "concert tickets": 3_300,
    "maroon 5": 2_500, "madonna": 3_900, "maracana": 2_200, "marisa monte": 1_700,
    "metallica": 5_200, "metallica 2027": 1_100,
}

class Node:
    def __init__(self):
        self.children = {}
        self.top = []                # [(count, query)], best first, at most K

def insert(root, query, count):
    node = root
    for ch in query:
        node = node.children.setdefault(ch, Node())
        node.top = sorted(node.top + [(count, query)], reverse=True)[:K]

def suggest(root, prefix):
    node = root
    for ch in prefix:
        node = node.children.get(ch)
        if node is None:
            return []
    return [q for _, q in node.top]  # O(len(prefix)): no subtree walk at query time

root = Node()
for q, c in counts.items():
    insert(root, q, c)

print("| prefix | top_3 |\n|---|---|")
for p in ("c", "co", "col", "m", "ma", "mar", "x"):
    print(f"| `{p}` | {', '.join(suggest(root, p)) or '—'} |")
```

The price is memory (k entries per node, most of them repeated along a path) and **rebuild instead of update**: changing one count can change the top-k of every ancestor. That is why the index is built offline and served read-only.

=== "Trie with top-k per node"

    Lookup O(length of prefix); compact because prefixes are shared; natural for "starts with". Updates are expensive (ancestors' lists), so it is rebuilt as a snapshot. Store IDs or offsets in the lists, not full strings, to save memory.

=== "Prefix hash table"

    Precompute a map `prefix → top-k list` for every prefix (e.g. a Redis hash or a key-value store). O(1) lookup, trivial to shard by key and to serve from any KV store; uses more memory (no sharing between prefixes) and the same rebuild cost. A pragmatic choice when you would rather not run a custom in-memory service.

=== "FST / completion suggester"

    A **finite-state transducer** shares both prefixes and suffixes, so it is much smaller than a trie; Lucene's completion suggester (used by Elasticsearch and OpenSearch) builds one per index segment, with weights and optional fuzzy matching. The off-the-shelf answer for a team that already runs a search cluster.

| | Trie + top-k | Prefix hash table | FST (search engine) |
|---|---|---|---|
| Lookup | O(prefix length) | O(1) | O(prefix length) |
| Memory | Medium | Highest | **Lowest** |
| Sharding | By prefix range | By key (any KV store) | By index/shard of the engine |
| Build | Custom job | Custom job | Engine indexing |
| Typo tolerance | Custom | Hard | Built-in (fuzzy) |

### 6.2 The data pipeline: from logs to snapshots

``` diagram-sim
flowchart LR
    logs[["Search events<br/>stream"]] --> raw[("Raw logs<br/>object store")]
    raw --> agg["Daily aggregation<br/>count per normalized query"]
    agg --> decay["Score with time decay<br/>+ selections weight"]
    decay --> filt["Filter<br/>min count, blocklist"]
    filt --> build["Build index<br/>per locale"]
    build --> snap[("Snapshot vN<br/>+ checksum")]
    snap --> canary["Canary node<br/>sanity checks"]
    canary --> fleet["All nodes<br/>load + atomic swap"]
```

- **Normalize** queries (lowercase, accents, whitespace) and **aggregate** per day; keep only queries above a minimum count — this removes typos, one-off searches and most personal data (an e-mail typed into the search box should never become a suggestion).
- **Score with time decay**: `score = Σ count_day × 0.5^(age_days / half_life)`, e.g. a 7-day half-life, plus a weight for **selections** (a suggestion that people click is better than one they ignore).
- **Build** the index per locale into an immutable **snapshot** in object storage, with a checksum and a manifest. Serving nodes download it, build the in-memory structure **next to** the current one and switch a pointer — an **atomic swap**, with no lock on the read path and an instant **rollback** to the previous version if metrics drop.
- **Validate before shipping**: size within ±10% of the last build, top suggestions for a fixed set of prefixes present, no blocklisted term — on a canary node first ([asynchronous work](../../compute/async-work/index.md)).

### 6.3 Serving at scale: replicate, cache, debounce

- **Replicate first.** With ~6 GB per locale, every node holds the full index; adding nodes adds throughput linearly, and any node can answer any prefix — no routing, no hot shards.
- **Shard when it no longer fits**, by **prefix range** — but by traffic, not by alphabet: `s` and `c` get far more traffic than `x` and `q`, so split ranges like `ca–ce`, `cf–cz` until each shard has similar load. Alternatively shard by locale/region first, which is a natural split.
- **Caches at every layer**: the browser (`max-age=60` and an in-memory map of prefixes already seen in this session), the CDN for short public prefixes, a small LRU inside the service for the hottest prefixes ([caching patterns](../../caching/patterns/index.md)).
- **Client discipline**: debounce (~100–150 ms), start only after 1–2 characters, cancel in-flight requests when the prefix changes, and discard responses for stale prefixes (responses can arrive out of order).
- **Latency budget**: of a 100 ms p99 perceived by the user, the network round trip takes most; the service must answer in a few milliseconds — which an in-memory, read-only structure does easily, and a database query per keystroke does not.

### 6.4 Freshness, filtering and personalization

- **Trending overlay.** A daily index cannot know a tour announced an hour ago. A **stream job** counts queries over a sliding window (say 15 minutes) and flags those growing much faster than their baseline; the serving nodes merge this small list (hundreds of entries) with the static top-k at request time ([Kafka and streams](../../messaging/kafka/index.md)).
- **Filtering** happens twice: at build time (blocklist, minimum count) and at **serve time** (a small blocklist pushed to all nodes within minutes), because removing an offensive suggestion cannot wait for tomorrow's build.
- **Entities over strings.** For BoxOffice, suggestions that point to an artist, venue or event (with an ID) are more useful than raw query strings: build part of the index from the **catalog** (names and aliases, weighted by ticket sales) and merge it with the query-log index.
- **Personalization** (recent searches, the user's city) is merged in the client or with a small per-user list — so the shared, cacheable response stays the same for everybody.
- **Typo tolerance** (`coldpaly`) needs fuzzy matching — edit distance 1 on the FST, or n-gram indexes. It multiplies the work per keystroke, so apply it only after a few characters or when exact matches are few.

---

## 7. Bottlenecks, failure modes and trade-offs

| Where | What goes wrong | Mitigation | Trade-off |
|---|---|---|---|
| Keystroke volume | One request per character overloads the origin | Debounce, minimum prefix length, cancel stale requests | Suggestions appear ~100 ms later |
| Short prefixes | `a`, `c`, `s` are the hottest keys | Browser/CDN caching; precomputed responses in a local LRU | Up to 60 s staleness |
| Index too big for one node | More locales and entity types | Shard by locale, then by prefix range balanced by traffic | Routing layer, uneven shards |
| Bad build | Empty or corrupted index pushed to all nodes | Checksums, size checks, canary node, keep the previous snapshot for rollback | Slower rollout |
| Stale popularity | Tour announced, suggestions do not show it | Trending overlay from the stream (minutes) | Another job to operate |
| Offensive suggestions | Manipulated or offensive queries rise to the top | Blocklist at build and serve time, minimum count, rate-limit query logging per user | Some legitimate terms blocked |
| Out-of-order responses | `co` answer arrives after `col` answer | Client discards responses that do not match the current prefix | — |
| Service down | Search box without suggestions | Degrade silently; search still works | Worse experience, no outage |

The trade-offs to **say out loud**: **freshness vs. simplicity** (daily immutable snapshots plus a small trending overlay instead of a mutable index), **memory vs. latency** (top-k cached in every node), and **replication vs. sharding** (replicate while it fits in RAM; shard by traffic when it does not).

---

## 8. Try it in the playground

The `search-autocomplete` scenario puts a search service behind a cache, with a read-heavy, spiky keystroke workload.

!!! tip "Try it"

    1. Run with the **load** profile: note the cache hit ratio and the p99 of the search service.
    2. Remove the cache (or lower its hit ratio) and run again: how much more load reaches the search service? Does the p99 still fit a keystroke budget of a few tens of milliseconds?
    3. Switch to **spike** (a tour announcement): add replicas of the search service until p99 recovers — the index is replicated, so throughput grows with nodes.
    4. Turn chaos on to fail the search service: autocomplete should degrade (no suggestions), never break the page.

<div class="sdp" data-scenario="search-autocomplete" data-mode="full" data-height="640" data-profile="load"></div>

[Open the full playground](../../../../playground/index.md){ .md-button }

---

## 9. Follow-up questions an interviewer asks

??? question "Why not run `SELECT … WHERE query LIKE 'col%' ORDER BY count DESC LIMIT 8` on the database?"

    A B-tree index on `query` can find the range `col…` quickly, but it must then read **every** row in that range to sort by count — for `c` that is a large fraction of the table — at thousands of requests per second. Precomputing the top-k per prefix moves that sorting to the offline build, so the online path is a constant-time read. A database query per keystroke also puts a heavy, spiky load on a system that has better things to do.

??? question "A new artist explodes on social media. How fast can suggestions react?"

    The daily index reacts tomorrow; the **trending overlay** reacts in minutes: a stream job compares each query's count in the last 15 minutes with its baseline and publishes the fastest risers to a cache that every serving node merges at request time. Protect it from manipulation (count distinct users, not raw searches; minimum volume; blocklist).

??? question "How do you keep personal data out of suggestions?"

    Suggestions come only from queries typed by **many distinct users** (a k-anonymity-style threshold), after normalization; anything that looks like an e-mail, phone number or document number is dropped by the pipeline; raw logs have a short retention. Per-user history, if offered, stays per user and is merged on the client.

??? question "How do you support suggestions for 'paulo' matching 'Coldplay São Paulo'?"

    That is **infix** matching. Index each word (or each suffix of the phrase) as an additional entry pointing to the same suggestion, or use an n-gram/inverted index in a search engine. Memory grows (several entries per suggestion), so restrict it to entity names (artists, venues, cities) rather than all queries.

??? question "How do you roll out a new index without hurting latency?"

    Build it offline, distribute the snapshot, have each node load it into memory **beside** the current one (requires memory headroom for two copies), run checks, then swap an atomic reference. Readers never lock; the old copy is freed after in-flight requests finish. Roll out to a canary node first and compare click-through rate before going fleet-wide.

??? question "How would you measure if suggestions are good?"

    Online metrics: share of searches that use a suggestion, position of the clicked suggestion, keystrokes saved, searches with zero results after a suggestion. Offline: replay last week's queries against the new index and check that the query actually searched appears in the top-k for its prefixes. A/B test ranking changes.

---

## 10. Self-assessment rubric

| Level | What the answer contains |
|---|---|
| **Junior** | An endpoint that queries the database with `LIKE 'prefix%'` and sorts by count; maybe a cache. Misses the keystroke volume and the latency budget. |
| **Mid** | Trie (or prefix table) in memory with top-k per node; offline build from logs; caching and debouncing; replication of the index. |
| **Senior** | Separates serving and data pipelines explicitly; time-decayed scoring with selections; immutable snapshots with validation, canary and atomic swap; trending overlay from a stream; filtering at build and serve time; sharding by traffic-balanced prefix ranges only when needed; CDN/browser caching with normalized keys; personalization in the client; out-of-order responses; quality metrics. |

**Related:** [Specialized data stores](../../databases/specialized/index.md), [Caching patterns](../../caching/patterns/index.md), [DNS & CDN](../../edge/dns-cdn/index.md), [Kafka and streams](../../messaging/kafka/index.md), [Hands-on 5](../../../hands-on/5/index.md) (caching).

!!! success "Best practices"

    - **Debounce on the client and cancel stale requests** — about 100 ms of debounce removes most keystroke requests, and a cancelled request is one the server never serves.
    - **Build the index offline and swap it atomically** — the serving nodes only read; a bad build is rolled back by pointing to the previous version.
    - **Cache short prefixes at the CDN with a short TTL** — one- and two-letter prefixes are the same for everyone and the most requested.
    - **Filter suggestions through a blocklist before they are published** — an offensive or legally sensitive suggestion is an incident even if a million users typed it.
    - **Keep a latency budget per keystroke, e.g. p99 < 100 ms** — a suggestion that arrives after the next letter is useless.

---

## How it connects { #how-it-connects }

Which classes does this case test? Each branch is a class whose ideas the design relies on (blue), with the palette components where they show up (green):

``` diagram
flowchart LR
    CASE(["Search autocomplete"]) --> EST["Estimation<br/>keystrokes, debouncing"]:::tech
    CASE --> EDG["Edge<br/>CDN for short prefixes"]:::tech
    CASE --> CMP["Compute<br/>in-memory service, index builders"]:::tech
    CASE --> DB["Databases<br/>trie with top-k, snapshots"]:::tech
    CASE --> CAC["Caching<br/>trending overlay"]:::tech
    CASE --> MSG["Messaging<br/>search logs as a stream"]:::tech
    EDG -.-> k1["cdn · apigw"]:::comp
    CMP -.-> k2["search · worker"]:::comp
    DB -.-> k3["dwh · objstore"]:::comp
    CAC -.-> k4["cache"]:::comp
    MSG -.-> k5["stream"]:::comp
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

**Classes it tests:** [Edge — DNS & CDN](../../edge/dns-cdn/index.md) · [Compute — async work](../../compute/async-work/index.md) · [Databases — specialized](../../databases/specialized/index.md) · [Caching — patterns](../../caching/patterns/index.md) · [Messaging — Kafka](../../messaging/kafka/index.md) · [Estimation — numbers](../../estimation/numbers/index.md). **Palette components:** [`cdn`](../../../reference/components/edge/index.md#cdn) · [`apigw`](../../../reference/components/edge/index.md#apigw) · [`search`](../../../reference/components/compute/index.md#search) · [`cache`](../../../reference/components/storage/index.md#cache) · [`stream`](../../../reference/components/messaging/index.md#stream) · [`worker`](../../../reference/components/compute/index.md#worker) · [`dwh`](../../../reference/components/storage/index.md#dwh) · [`objstore`](../../../reference/components/storage/index.md#objstore). **Scenarios:** `search-autocomplete`.

---

## References

- XU, A. *System Design Interview — An Insider's Guide*, vol. 1, ch. 13 "Design a Search Autocomplete System"[^1].
- KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2nd ed., chapters on batch processing and derived data[^2].
- Elasticsearch completion suggester (FST-based)[^3].
- MANNING, C.; RAGHAVAN, P.; SCHÜTZE, H. *Introduction to Information Retrieval* — dictionaries, tolerant retrieval and wildcard queries[^4].

[^1]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1. Byte Code LLC, 2020.
[^2]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2nd ed. O'Reilly.
[^3]: [Completion suggester](https://www.elastic.co/guide/en/elasticsearch/reference/current/search-suggesters.html#completion-suggester){target="_blank"}. Elasticsearch Reference.
[^4]: MANNING, C.; RAGHAVAN, P.; SCHÜTZE, H. [Introduction to Information Retrieval](https://nlp.stanford.edu/IR-book/){target="_blank"}, ch. 3. Cambridge University Press, 2008.
