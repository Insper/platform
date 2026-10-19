
> *"Design a URL shortener like bit.ly or TinyURL: users submit a long URL and get a short one; anybody who opens the short URL is redirected to the original."*

The URL shortener is the "hello world" of system design interviews, and it is usually the **first** problem you get as a junior or the **warm-up** in a senior loop. It looks trivial — a key-value lookup — and that is exactly the trap: the interviewer wants to see whether you **drive** the conversation (requirements, numbers, API, data, design, deep dives) instead of jumping to "use a hash". It exercises three ideas you will reuse in almost every other case: **unique ID generation**, **read-heavy caching**, and **taking side work (analytics) off the critical path**.

BoxOffice uses one too: the SMS that says "your tickets for Saturday" carries a short link such as `https://bx.example/aB3x9Kq`, because an SMS has 160 characters and a signed ticket URL has 300.

| | |
|---|---|
| **Difficulty** | :material-star: easy (warm-up, junior favorite) |
| **Key concepts** | base62 encoding, unique ID generation (counter ranges, Snowflake, key generation service) vs. hashing, collisions, 301 vs. 302, cache-aside for hot links, asynchronous click analytics |
| **Palette components** | [`dns`](../../../reference/components/edge/index.md#dns), [`lb`](../../../reference/components/edge/index.md#lb), [`app`](../../../reference/components/compute/index.md#app), [`cache`](../../../reference/components/storage/index.md#cache), [`nosql`](../../../reference/components/storage/index.md#nosql), [`kafka`](../../../reference/components/messaging/index.md#kafka), [`analytics`](../../../reference/components/compute/index.md#analytics) |
| **Playground scenario** | `url-shortener` |

!!! abstract "What this case trains"

    - **Run** the full interview framework on a small problem, inside 35–45 minutes.
    - **Estimate** read/write rates, storage over five years and the size of the hot set.
    - **Compare** ID-generation strategies (hash, counter + base62, key generation service, Snowflake) on collisions, coordination and predictability.
    - **Design** a redirect path that serves most requests from a cache and **justify** 301 vs. 302.
    - **Move** click analytics off the critical path with an event stream.

---

## 1. Clarify the requirements

Even for a "simple" problem, spend 3–5 minutes here ([interview framework](../../intro/interview-framework/index.md)). The requirements decide whether codes may be predictable, whether analytics must be exact, and whether the same long URL always gets the same code.

### Functional requirements

1. **Shorten**: given a long URL, return a short URL with a unique code (e.g. 7 characters).
2. **Redirect**: `GET /{code}` sends the browser to the long URL.
3. **Custom alias** (optional): the user chooses the code (`/boxoffice-rock-in-rio`).
4. **Expiration** (optional): links can expire at a given date.
5. **Click statistics**: number of clicks per link, per day, per country.

### Non-functional requirements

| Quality | Target |
|---|---|
| **Latency** | Redirect p99 < 100 ms (it sits in front of every click) |
| **Availability** | 99.99% for redirects — a broken short link breaks the campaign, the SMS, the printed QR code |
| **Scale** | 100 M new links per month; read-heavy (100:1) |
| **Durability** | A created link works for years (until it expires) |
| **Security** | Codes should not be trivially guessable (no enumeration of private links); block malicious destinations |
| **Analytics** | Eventually consistent; minutes of delay are fine; small loss is acceptable |

### Out of scope (say it explicitly)

User accounts and link editing UI, billing, QR-code rendering, A/B testing of destinations. They are features on top of the same core.

??? question "Questions to ask the interviewer"

    | Question | Why it matters |
    |---|---|
    | How many new links per month? Read:write ratio? | Sizes everything: QPS, storage, cache. |
    | How short must the code be? Which characters? | 7 characters of base62 give 3.5 trillion codes; base64 adds `+` and `/` (unsafe in URLs). |
    | Same long URL twice → same code, or a new one? | Deterministic (hash) vs. unique per request (counter). Per-user stats usually need distinct codes. |
    | Must codes be unpredictable? | Sequential counters leak volume and allow enumeration. |
    | Do analytics need to be exact? Real time? | Exact + real time is expensive; approximate + delayed is cheap. |
    | Do links expire? Can they be deleted? | Cleanup jobs, cache invalidation, code reuse (usually: never reuse). |

---

## 2. Back-of-the-envelope estimates

State the assumptions, then compute. All numbers are illustrative — open the *Source* tab, change one and recompute.

```python exec="1" source="tabbed-right"
# URL shortener: assumptions (illustrative)
new_per_month = 100_000_000   # new short links per month
read_write    = 100           # redirects per created link
peak_factor   = 3             # peak / average traffic
years         = 5             # retention
record_b      = 500           # code + long URL + metadata, bytes
hot_fraction  = 0.2           # share of a day's redirects worth caching (80/20 rule)
click_b       = 200           # one click event (code, time, country, referrer)

write_qps  = new_per_month / (30 * 86_400)
read_qps   = write_qps * read_write
peak_read  = read_qps * peak_factor
records    = new_per_month * 12 * years
storage_tb = records * record_b / 1e12
codes_7    = 62 ** 7
used_pct   = records / codes_7 * 100
cache_gb   = read_qps * 86_400 * hot_fraction * record_b / 1e9
clicks_gb  = read_qps * 86_400 * click_b / 1e9

rows = [
    ("write_qps", write_qps, "req/s"), ("read_qps", read_qps, "req/s"),
    ("peak_read", peak_read, "req/s"), ("records", records, "links"),
    ("storage_tb", storage_tb, "TB"), ("codes_7", codes_7, "codes"),
    ("used_pct", used_pct, "%"), ("cache_gb", cache_gb, "GB"),
    ("clicks_gb", clicks_gb, "GB/day"),
]
print("| quantity | value | unit |\n|---|---:|---|")
for name, value, unit in rows:
    v = f"{value:,.0f}" if abs(value) >= 100 else f"{value:,.2f}"
    print(f"| `{name}` | {v} | {unit} |")
```

What the numbers tell us:

- **~40 writes/s** and **~4 k redirects/s** (peak ~12 k/s): a single database could take the writes; the reads are what we design for. ⇒ **cache** in front of the store, **stateless** app servers behind a load balancer.
- **6 billion links, ~3 TB in 5 years**: too much for comfort on one node with replicas and indexes, trivial for a partitioned key-value store. The access pattern is a **single-key lookup**, so a KV store (DynamoDB, Cassandra) or a sharded SQL table both work.
- **7 base62 characters = 3.5 trillion codes**; we use 0.17% of them in 5 years. Short codes are not the scarce resource — **uniqueness without coordination** is the design problem.
- The hot set is **~33 GB**: it fits in the RAM of one or two cache nodes. With a Zipf-like popularity (a few links get most clicks), the hit ratio will be high.
- Click events are **~67 GB/day** — more than the links themselves. ⇒ they go to a stream and an analytics store, never to the main table.

!!! tip "In the interview"

    Say the conclusion, not only the number: *"4 k reads per second against 40 writes, and the hot set fits in memory — so this is a caching problem with an ID-generation problem attached."*

---

## 3. API

```http
POST /v1/urls                          → 201 {code, shortUrl, expiresAt}
     {"longUrl": "https://boxoffice.example/events/42?utm_source=sms",
      "customAlias": null, "expiresAt": "2027-12-31T23:59:59Z"}
     (409 ALIAS_TAKEN, 422 INVALID_URL, 429 TOO_MANY_REQUESTS)

GET  /{code}                           → 302 Found, Location: <longUrl>
                                         (404 not found, 410 Gone when expired)

GET  /v1/urls/{code}/stats?from=…&to=… → 200 {clicks, byDay[], byCountry[]}
DELETE /v1/urls/{code}                 → 204   (owner only)
```

- Creation is authenticated (API key or user token) and **rate limited** per client — a shortener is a favorite tool of spammers.
- The redirect is public and does **one thing**: look up and answer. Everything else (counting, geo lookup, bot detection) happens asynchronously.

---

## 4. Data model

The core access pattern is `code → longUrl`, a point lookup by primary key, at thousands per second, over billions of rows. No joins, no range scans.

```sql
-- Logical model (a KV/wide-column table, or a sharded SQL table)
CREATE TABLE short_url (
    code        VARCHAR(16) PRIMARY KEY,   -- partition key
    long_url    TEXT        NOT NULL,
    owner_id    BIGINT,
    created_at  TIMESTAMP   NOT NULL,
    expires_at  TIMESTAMP
);

-- Only for the counter-based generator: one row per range allocation
CREATE TABLE id_range (
    name        VARCHAR(32) PRIMARY KEY,   -- 'short_url'
    next_start  BIGINT      NOT NULL
);
```

| Data | Store | Why |
|---|---|---|
| `code → long_url` | NoSQL key-value / wide-column (`nosql`), partitioned by `code` | Point lookups, horizontal scale, no joins; 3 TB spread over nodes |
| Hot codes | Cache (`cache`), cache-aside, TTL hours | ~33 GB hot set; most redirects never touch the database |
| ID ranges | Small SQL table or a coordination service (etcd, ZooKeeper) | A few writes per minute; needs atomic increments |
| Click events | Kafka (`kafka`) → analytics store / data warehouse | High volume, append-only, read in aggregate |

!!! example "Why not one PostgreSQL?"

    For BoxOffice's own SMS links (thousands per day) one PostgreSQL table with a B-tree on `code` is perfect. For 100 M links per month the answer is still "SQL works", as long as you shard by `code` — the point of the interview is to show you know **when** a single node stops being enough and **what** you would partition by.

---

## 5. High-level design

``` mermaid-sim
flowchart LR
    u([Browser / app]) --> dns["DNS"]
    dns --> lb["Load balancer"]
    lb --> app["Shortener app<br/>(stateless, N replicas)"]
    app --> cache[("Cache<br/>hot codes")]
    app --> db[("NoSQL<br/>code → long_url")]
    app --> ids["ID allocator<br/>(ranges)"]
    app -. click event .-> k[["Kafka<br/>clicks"]]
    k --> agg["Analytics workers<br/>aggregate"]
    agg --> dwh[("Analytics store")]
```

The **write path** asks the ID allocator for a code (from a range already leased in memory — no network call most of the time), stores the row, and returns the short URL. The **read path** is shown below; notice that the click event is fired after the response and never waits.

``` mermaid-sim
sequenceDiagram
    autonumber
    participant B as Browser
    participant A as Shortener app
    participant C as Cache
    participant D as NoSQL
    participant K as Kafka
    B->>A: GET /aB3x9Kq
    A->>C: GET url:aB3x9Kq
    alt cache hit (most requests)
        C-->>A: long_url
    else cache miss
        C-->>A: nil
        A->>D: get(code = aB3x9Kq)
        D-->>A: long_url, expires_at
        A->>C: SET url:aB3x9Kq long_url EX 86400
    end
    A-->>B: 302 Location: long_url
    A-)K: click {code, ts, ip, user-agent}
```

---

## 6. Deep dives

### 6.1 Generating the code

This is the deep dive every interviewer expects. Four families, each with a different trade-off:

=== "Hash + truncate"

    `base62(sha256(longUrl))[:7]`. Deterministic: the same URL gives the same code, so duplicates are free. But 7 characters keep only ~42 bits of the hash, so **collisions** happen and must be detected: insert with a conditional put (`IF NOT EXISTS`); on conflict, rehash `longUrl + salt` and try again. Two users shortening the same URL share a code — and share statistics.

=== "Counter + base62"

    A unique integer, encoded in base62. No collisions by construction. The problem is the **counter**: a single sequence is a bottleneck and a single point of failure. Fix it with **range allocation**: each app server leases a block (e.g. 10 000 ids) with one atomic update and hands them out from memory. A crash wastes at most one block — harmless with 3.5 trillion codes.

    ```sql
    UPDATE id_range SET next_start = next_start + 10000
     WHERE name = 'short_url'
    RETURNING next_start - 10000 AS block_start;
    ```

=== "Key generation service (KGS)"

    A separate service pre-generates random unused codes into a table and hands batches to app servers, marking them used. Unpredictable codes, no collisions on the request path. Costs: one more stateful service to replicate, and careful handling so two servers never get the same batch (move keys from `unused` to `used` atomically).

=== "Snowflake-style IDs"

    64-bit IDs built from `timestamp | machine id | sequence` ([Twitter Snowflake](https://github.com/twitter-archive/snowflake){target="_blank"}): generated locally, roughly time-ordered, no coordination except assigning machine IDs. In base62 a 64-bit ID needs up to **11 characters** — longer than 7. Good for internal IDs, less good when shortness is the product.

| Strategy | Collisions | Coordination | Predictable? | Code length | Same URL → same code |
|---|---|---|---|---|---|
| Hash + truncate | Yes, must retry | None (but a conditional write) | No | 7 | Yes |
| Counter + base62 (ranges) | No | One atomic update per block | **Yes** (sequential) | 7 | No |
| KGS | No | KGS service | No | 7 | No |
| Snowflake | No | Machine IDs only | Partially (time-ordered) | ~11 | No |

The base62 encoding itself is a few lines:

```python
ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

def base62(n: int) -> str:
    s = ""
    while n > 0:
        n, r = divmod(n, 62)
        s = ALPHABET[r] + s
    return s or "0"

# 62**7 = 3_521_614_606_208 codes; base62(3_521_614_606_207) == "ZZZZZZZ"
```

!!! warning "Sequential codes leak information"

    With a plain counter, `aB3x9Kq` is followed by `aB3x9Kr`: anyone can enumerate links (including private ones) and estimate your volume. Keep the counter but **scramble** it with a bijection before encoding — e.g. multiply by a large constant coprime with 62 (odd and not a multiple of 31) modulo 62^7, or a small Feistel cipher — so consecutive ids give unrelated codes, still without collisions.

**Recommendation for the interview:** counter with range allocation + scrambling for generated codes; a conditional insert (`IF NOT EXISTS`) for custom aliases. Mention hashing and why you did not choose it (collisions, shared stats).

### 6.2 The redirect: 301 or 302, and caching

| | 301 Moved Permanently | 302 Found (or 307) |
|---|---|---|
| Browser caches it? | Yes, potentially forever | No (unless `Cache-Control` says so) |
| Load on our servers | Lower: repeat clicks never reach us | Every click reaches us |
| Analytics | Undercounts repeat visits | Complete |
| Changing/expiring the link later | Hard: browsers keep the old answer | Easy |

Most commercial shorteners answer **302** (or 301 with a short `Cache-Control: max-age`) because analytics and the ability to disable a malicious link are part of the product. Whatever you choose, **say why** ([HTTP semantics](../../edge/protocols/index.md)).

Caching the lookup ([cache-aside](../../caching/patterns/index.md)):

- **Cache-aside** with a TTL of hours: the mapping almost never changes, so staleness is not a problem; on delete or expiration, delete the key explicitly.
- **Negative caching**: cache "not found" for a short time (`url:zzzzzzz → ∅`, 60 s), otherwise a bot scanning random codes goes straight to the database.
- **Zipf popularity**: a viral link can receive thousands of clicks per second — a **hot key** on one cache shard. Mitigate with a small in-process cache (L1, a few seconds) on each app server in front of the shared cache.
- **Expiration**: check `expires_at` on every read (cached together with the URL) and answer `410 Gone`; a background job deletes expired rows later.

### 6.3 Click analytics off the critical path

Counting clicks synchronously (`UPDATE stats SET clicks = clicks + 1`) would turn every read into a write on a hot row. Instead:

``` mermaid-sim
flowchart LR
    app["Shortener app"] -->|"fire-and-forget<br/>click event"| k[["Kafka topic clicks<br/>partitioned by code"]]
    k --> s["Stream aggregation<br/>1-min windows"]
    s --> olap[("Analytics store<br/>clicks per code/day/country")]
    k --> lake[("Object store<br/>raw events")]
    olap --> api["GET /stats"]
```

- The app produces the event **after** answering (or buffers it in memory and sends batches): the redirect does not depend on Kafka being healthy. If Kafka is down, drop or buffer — analytics may lose a few events; redirects must not fail ([messaging semantics](../../messaging/semantics/index.md)).
- A stream job aggregates per code per minute and writes counters to an analytics store; raw events land in object storage for later analysis.
- **Unique visitors** need a distinct count: use HyperLogLog (≈1–2% error, a few kB per counter) instead of storing every visitor ID.

---

## 7. Bottlenecks, failure modes and trade-offs

| Where | What goes wrong | Mitigation | Trade-off |
|---|---|---|---|
| Database reads | Every redirect hits the store; p99 grows with load | Cache-aside + L1 in-process cache; read replicas | Staleness after delete (bounded by TTL) |
| Viral link | One hot key saturates one cache shard | L1 cache with seconds of TTL; replicate the hot key | More memory, slightly staler data |
| ID allocator | Single counter = bottleneck and SPOF | Range leasing; allocator replicated (SQL with failover) | Gaps in the sequence after crashes (harmless) |
| Code scanning | Bots try random codes → misses hit the DB | Negative caching; rate limit per IP; non-sequential codes | Little memory for negative entries |
| Malicious destinations | Shortener used to hide phishing | Check URLs against a reputation list at creation and asynchronously later; disable link (302 makes this effective) | Creation latency; false positives |
| Analytics pipeline | Kafka slow or down | Fire-and-forget with a bounded buffer; drop on overflow | Some clicks lost (acceptable by requirement) |
| Region outage | Redirects fail everywhere | Multi-region read path: replicated KV, GeoDNS, cache per region | Writes need a home region or conflict-free IDs (ranges per region) |

The trade-offs to **say out loud**: **availability and latency over strict consistency** for the redirect path (a link deleted a few seconds ago may still redirect from the cache), **302 over 301** because analytics and control matter, and **counter ranges over hashing** because uniqueness without collision retries is simpler to reason about.

---

## 8. Try it in the playground

The `url-shortener` scenario has the read path of this page: load balancer, app replicas, a cache in front of the store, and an event stream for clicks.

!!! tip "Try it"

    1. Run with the **load** profile and note the cache hit ratio, the database utilization and the redirect p99.
    2. Remove the cache (or set its hit ratio low) and run again: how many times higher is the database load? Does p99 still meet the 100 ms target?
    3. Switch to the **stress** profile and add app replicas until the bottleneck moves: is it the app tier, the cache, or the store?
    4. Turn chaos on and kill the stream/analytics consumer: do redirects keep working? (They should — that is the point of section 6.3.)

<div class="sdp" data-scenario="url-shortener" data-mode="full" data-height="640" data-profile="load"></div>

[Open the full playground](../../../../playground/index.md){ .md-button }

---

## 9. Follow-up questions an interviewer asks

??? question "How do you support custom aliases without clashing with generated codes?"

    Use a **conditional insert** (`INSERT … IF NOT EXISTS` or a unique constraint) and answer `409` when the alias is taken. To avoid a generated code ever colliding with an alias, put them in different spaces: generated codes have exactly 7 characters from base62, aliases must be longer or contain a `-`; or reserve aliases in the same table so the generator's conditional insert would fail and fetch the next id.

??? question "The same user shortens the same URL twice. Same code?"

    It depends on the requirement you clarified. With a counter, you get two codes (and two sets of statistics), which is what campaign tools want. If deduplication is required, keep a secondary index `hash(longUrl, owner) → code` and check it before allocating — one extra lookup on the (rare) write path.

??? question "How would you go multi-region?"

    Redirects are reads: replicate the KV store to every region (asynchronous replication is fine), keep a cache per region, and route users with GeoDNS/anycast to the nearest one. For writes, give each region its **own id ranges** (or a region bit in the id) so codes never collide without cross-region coordination. A link created in São Paulo may take a second to work in Frankfurt — acceptable if you say it.

??? question "How do you count unique clicks per link?"

    Exact unique counts need the set of visitor IDs — huge for popular links. Use **HyperLogLog** per link per day (Redis `PFADD`/`PFCOUNT`, or the analytics store's approximate distinct function): ~1% error with a few kilobytes per counter, and HLLs can be merged across days.

??? question "How do you clean up expired links? Can codes be reused?"

    Read-time check (answer `410` if `expires_at < now`) makes expiration exact; a background job deletes expired rows in batches (or the store's native TTL does it). **Do not reuse codes**: old copies of the short URL are printed, cached in browsers (301) and in other people's messages — reusing them would send users to an unrelated page. With 3.5 trillion codes there is no need.

??? question "What if someone uses your shortener for phishing?"

    Check the destination against reputation lists at creation, rate limit and require authentication for creation, rescan popular links asynchronously, and keep a "disabled" flag that the redirect respects. This is one more reason to prefer 302: you can still stop sending people to a link after it turns malicious.

??? question "Why not just use the database auto-increment column?"

    It works at small scale and is a perfectly good answer for BoxOffice's internal links. At 100 M links per month with a sharded store there is no single auto-increment, and the primary becomes a write bottleneck and SPOF. Range leasing keeps the same idea (a counter) while touching the shared counter once per 10 000 ids.

---

## 10. Self-assessment rubric

| Level | What the answer contains |
|---|---|
| **Junior** | API with create and redirect; a table `code → url`; some way to generate codes (often a hash) without handling collisions; "add a cache". |
| **Mid** | Requirements and estimates driving the design (read-heavy, hot set fits in memory); base62 with a collision-free generator (counter ranges or KGS); cache-aside with TTL; 301 vs. 302 discussed; analytics asynchronous. |
| **Senior** | Compares the four generators on collisions, coordination and predictability, and scrambles sequential ids; negative caching and hot-key mitigation; data partitioning by code; multi-region with per-region id ranges; abuse handling; explicit consistency choice for the redirect path; knows when a single PostgreSQL is still the right answer. |

**Related:** [Caching](../../caching/index.md), [Hands-on 5](../../../hands-on/5/index.md) (cache-aside and hit ratio), [Messaging](../../messaging/index.md), [interview practice problems](../../../support/interview/problems/index.md).

---

## How it connects { #how-it-connects }

Which classes does this case test? Each branch is a class whose ideas the design relies on (blue), with the palette components where they show up (green):

``` mermaid
flowchart LR
    CASE(["URL shortener"]) --> EST["Estimation<br/>reads ≫ writes, hot set"]:::tech
    CASE --> DIS["Distributed<br/>unique IDs: ranges, Snowflake"]:::tech
    CASE --> EDG["Edge<br/>DNS, LB, 301 vs 302"]:::tech
    CASE --> DB["Databases<br/>key-value: code → long URL"]:::tech
    CASE --> CAC["Caching<br/>cache-aside for hot codes"]:::tech
    CASE --> MSG["Messaging<br/>clicks as events"]:::tech
    EDG -.-> k1["dns · lb · app"]:::comp
    DB -.-> k2["nosql"]:::comp
    CAC -.-> k3["cache"]:::comp
    MSG -.-> k4["kafka · analytics"]:::comp
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

**Classes it tests:** [Estimation — numbers](../../estimation/numbers/index.md) · [Distributed — time & clocks](../../distributed/time-clocks/index.md) (unique IDs) · [Edge — protocols](../../edge/protocols/index.md) (redirects) · [Databases — models](../../databases/models/index.md) · [Caching — patterns](../../caching/patterns/index.md) · [Messaging — semantics](../../messaging/semantics/index.md). **Palette components:** [`dns`](../../../reference/components/edge/index.md#dns) · [`lb`](../../../reference/components/edge/index.md#lb) · [`app`](../../../reference/components/compute/index.md#app) · [`cache`](../../../reference/components/storage/index.md#cache) · [`nosql`](../../../reference/components/storage/index.md#nosql) · [`kafka`](../../../reference/components/messaging/index.md#kafka) · [`analytics`](../../../reference/components/compute/index.md#analytics) · [`dwh`](../../../reference/components/storage/index.md#dwh). **Scenarios:** `url-shortener`, `read-heavy-cache`.

---

## References

- XU, A. *System Design Interview — An Insider's Guide*, vol. 1, ch. 7 "Design a Unique ID Generator in Distributed Systems" and ch. 8 "Design a URL Shortener"[^1].
- Twitter's Snowflake announcement and code[^2].
- HTTP redirect semantics (301, 302, 307, 308)[^3].
- KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2nd ed., chapters on partitioning and stream processing[^4].

[^1]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1. Byte Code LLC, 2020.
[^2]: KING, R. [Announcing Snowflake](https://blog.x.com/engineering/en_us/a/2010/announcing-snowflake){target="_blank"}. Twitter Engineering Blog, 2010.
[^3]: FIELDING, R.; NOTTINGHAM, M.; RESCHKE, J. [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110){target="_blank"}, section 15.4. IETF, 2022.
[^4]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2nd ed. O'Reilly.
