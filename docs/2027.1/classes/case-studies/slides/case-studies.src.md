---
marp: true
lang: en
title: Case Studies
description: System Architecture · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>
<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">System Architecture · Insper</div>

# Case Studies

**Twelve interview problems, a handful of ideas**

<!--
Outline: (1) the interview framework and timing; (2) the twelve cases and the patterns that repeat;
(3) one idea from each case; (4) the BoxOffice flash sale in depth; (5) how to study with the
playground and the rubric.
-->

---

## "Design Ticketmaster." Go.

<div class="q">

Two million fans, sixty thousand seats, on sale at 10:00, 45 minutes on the clock.
What do you do in the **first five minutes**?

</div>

* Ask: reserved seats or general admission? Biggest on-sale? Hold time? Own payments?
* State targets with numbers: **zero double booking**, hold p99 < 300 ms, survive 2 M arrivals in 2 min.
* Say what is **out of scope**: resale, refunds, dynamic pricing.
* Only then estimate — and only then draw.

<!--
Let the class answer first. Most students start drawing boxes. The point: requirements change the
design completely (a 300-seat theater vs. the Eras Tour).
-->

---

## The framework, with a clock

| # | Step | Min | You produce |
|---|---|---:|---|
| 1 | Clarify requirements | 5 | functional, non-functional with numbers, out of scope |
| 2 | Estimate | 5 | queries per second (QPS), avg/peak, storage, bandwidth, memory → **a decision** |
| 3 | API and data model | 5–7 | few endpoints, entities, store per entity and why |
| 4 | High-level design | 10 | one diagram: read path and write path |
| 5 | Deep dives | 10–15 | two or three hard parts, alternatives, a choice |
| 6 | Bottlenecks and trade-offs | 5 | what breaks first, what you gave up |
| 7 | Wrap-up | 2–3 | summary, next steps, how to measure |

<p class="small">Every case page uses this numbering, plus: try it in the playground, follow-up questions, rubric.</p>

---

## Study with the playground

<div class="flow">
<div class="box accent">Predict<small>what breaks first?</small></div><div class="arrow">→</div>
<div class="box">Run<small>load / spike profile</small></div><div class="arrow">→</div>
<div class="box">Observe<small>utilization, p99, errors, backlog, cost</small></div><div class="arrow">→</div>
<div class="box orange">Change one thing<small>replicas, cache, queue, timeout</small></div><div class="arrow">→</div>
<div class="box green">Explain<small>with the numbers of section 2</small></div>
</div>

- Every case embeds its scenario: `ticketing`, `flash-sale`, `news-feed`, `distributed-cache`, …
- Profiles: `load` (steady), `spike` (10:00), `stress` / `breakpoint` (the knee), chaos (failures).
- Remove the cache, bypass the queue, kill a node: **see** why each component is there.

<div class="ok">

The simulator's numbers are illustrative; the **shapes** (knee, backlog, cascade) are real.

</div>

<!--
Moved next to the framework, in the page's order: the loop is how every case is studied. Change one
thing at a time, or you will not know which change moved the metric.
-->

---

## Numbers that make decisions

URL shortener: 100 M new links/month, 100 reads per link.

- Writes: 100 M / 2.6 M s ≈ **40/s** → a single database could take them.
- Reads: × 100 ≈ **4 000/s**, peak ~12 k/s → **design for reads**.
- 6 B links in 5 years × 500 B ≈ **3 TB** → partition by `code`.
- Hot set ≈ 20% of a day's reads × 500 B ≈ **33 GB** → fits in RAM → **cache**.
- 7 base62 characters = **3.5 trillion** codes → length is not the problem; **uniqueness** is.

<div class="ok">

Every estimate ends with **"so…"**. A number that changes nothing was not worth computing.

</div>

---

<!-- _class: tight -->

## The cases (1/2): warm-ups and medium

| Case | Level | The core idea |
|---|---|---|
| URL shortener | ★ | collision-free IDs (counter ranges + base62), cache hot links, 302 for analytics |
| Rate limiter | ★★ | token bucket / sliding window, atomic Lua in Redis, fail-open vs. closed |
| Distributed cache | ★★ | consistent hashing + virtual nodes, eviction, replication, hot keys |
| Search autocomplete | ★★ | top-k per prefix precomputed offline, served from memory, debounced |
| Notification system | ★★ | queue per channel, retries + dead-letter queue (DLQ), dedupe, preferences, provider failover |

<p class="small">Scenarios: <code>url-shortener</code>, <code>rate-limiter</code>, <code>distributed-cache</code>, <code>read-heavy-cache</code> / <code>sharding</code>, <code>search-autocomplete</code>, <code>notification-system</code>.</p>

---

<!-- _class: tight -->

## The cases (2/2): hard

| Case | Level | The core idea |
|---|---|---|
| News feed | ★★★ | fan-out on write vs. read; hybrid for celebrities; timeline of IDs |
| Chat | ★★★ | stateful WebSocket gateways, per-conversation sequence, dedupe |
| Ride sharing | ★★★ | latest positions in a geo index; one driver, one ride |
| Video streaming | ★★★ | bytes never touch your servers; transcoding directed acyclic graph (DAG); adaptive bitrate (ABR) + content delivery network (CDN) |
| Payment system | ★★★ | idempotency keys, double-entry ledger, reconciliation |
| Ticketing (BoxOffice) | ★★★ | waiting room + Little's Law; seat holds without double booking |
| AI assistant | ★★★ | retrieval-augmented generation (RAG), large language model (LLM) gateway, tools with permissions, guardrails, evals |

<p class="small">Scenarios: <code>news-feed</code>, <code>chat</code>, <code>ride-sharing</code>, <code>video-streaming</code>, <code>payment-system</code>, <code>ticketing</code> / <code>flash-sale</code>, <code>ai-assistant</code>.</p>

---

<!-- _class: tight -->

## Patterns that repeat

| Pattern | Where it shows up |
|---|---|
| **Cache the hot reads** | shortener, feed, autocomplete, video, catalog |
| **Slow work off the critical path** (queue + workers) | clicks, notifications, fan-out, transcoding, outbox |
| **Make retries safe** (idempotency, dedupe, conditional writes) | payments, seats, chat, notifications, ride requests |
| **Choose the partition key** | conversation, city, event, user, key ring |
| **Protect what cannot scale** (admission, rate limits, bulkheads) | waiting room, rate limiter, payment provider, LLM quotas |
| **Precompute vs. compute on read** | feed fan-out, top-k, renditions |
| **Strong consistency only where it matters** | seats, money, driver assignment — not feeds or counters |

---

## Rate limiter: atomic or wrong

- Naive `GET` → check → `SET` from 20 gateways: both read 9, both allow → **11 > 10**.
- Fix: one **Lua script** per request, atomic on the shard that owns the key; server clock (`TIME`); time to live (TTL) on every key.
- **Fixed window** lets 2× through at the boundary; **token bucket** or **sliding-window counter** in production.
- Counters for 1 M clients ≈ **200 MB**; a sliding *log* would need ~30 GB.

<div class="warn">

Per-client limits do not stop **a million legitimate fans** at 10:00. That needs load shedding, concurrency limits — and a waiting room.

</div>

---

## Distributed cache: memory or throughput?

<div class="flow">
<div class="box">1.1 TB of data<small>÷ 64 GB per node</small></div><div class="arrow">→</div>
<div class="box">17 nodes<small>by memory</small></div>
<div class="arrow">vs.</div>
<div class="box">2 M ops/s<small>÷ 80 k per node</small></div><div class="arrow">→</div>
<div class="box orange">25 nodes<small>by throughput</small></div><div class="arrow">→</div>
<div class="box green">50 nodes<small>25 primaries + 1 replica each</small></div>
</div>

- Size by **both** and take the larger. `hash % N` moves almost every key when N changes; **consistent hashing** moves ~1/N.
- Each point of hit ratio is **20 k database req/s**: 95% → 100 k req/s, 90% → 200 k req/s.
- Asynchronous replication can lose an **acknowledged** write at failover: a cache, not the source of truth.

<p class="small">Scenario: <code>distributed-cache</code> (17 nodes saturate before memory runs out).</p>

---

## Search autocomplete: the cheapest request is never sent

<div class="flow">
<div class="box">one request per keystroke<small>~14 k req/s</small></div><div class="arrow">→</div>
<div class="box accent">debounce 100–150 ms<small>~4.6 k req/s</small></div><div class="arrow">→</div>
<div class="box">tour announcement ×5<small>~23 k req/s</small></div><div class="arrow">→</div>
<div class="box green">browser + CDN answer half<small>~12 k req/s at the origin</small></div>
</div>

- A **trie with the top-k cached in every node**: typing `col` walks three nodes and returns a list — no subtree walk.
- The whole index (~30 M nodes, ~6 GB) fits in one server's memory → **replicate** it, do not shard it.
- Built **offline** from the logs into immutable snapshots, loaded with an atomic swap; trending is a small overlay.

---

## Notifications: absorb the burst, respect the provider

<div class="flow">
<div class="box red">presale campaign<small>7.5 M messages</small></div><div class="arrow">→</div>
<div class="box accent">queue per channel<small>transactional ≠ bulk</small></div><div class="arrow">→</div>
<div class="box">workers at a controlled rate<small>spread over 30 min</small></div><div class="arrow">→</div>
<div class="box orange">e-mail provider<small>1,000/s → 2.5 M take ~42 min</small></div>
</div>

- Fired in one minute: **125 k/s** sends and ~8 k app requests/s from fans who tap; spread over 30 min: **~280 req/s**.
- The **provider's limit** decides the duration, not the worker count; transactional e-mails need **reserved capacity**.
- Idempotency key per notification, retries with backoff + jitter, a dead-letter queue (DLQ) after the last attempt.

---

## News feed: who pays for the fan-out?

- **Push** (fan-out on write): reads are one cache lookup; a post costs *followers* inserts.
- **Pull** (fan-out on read): writes are free; every feed open does hundreds of queries.
- Followers are heavy-tailed: ~0.3% of authors (≥ 100 k followers) cause **~84%** of push writes (simulated).
- **Hybrid**: push for ordinary authors, **pull celebrities** at read time and merge.
- Timelines hold **IDs**, trimmed, for **active** users; hydrate posts on read; paginate with **cursors**.

<!--
The 84% comes from the simulation on the news-feed page (synthetic heavy-tailed distribution). The
point is the shape, not the exact number.
-->

---

## News feed: the queue behind a celebrity

<div class="flow">
<div class="box">230 posts/s × 200<small>46 k inserts/s</small></div><div class="arrow">+</div>
<div class="box red">one post by a 50 M account<small>50 M inserts, push</small></div><div class="arrow">→</div>
<div class="box">FIFO queue, 20 workers<small>100 k inserts/s</small></div><div class="arrow">→</div>
<div class="box red">ordinary posts 500 s late<small>backlog clears after 926 s</small></div>
</div>

<div class="matrix" style="--n: 3">
<div></div><div class="head">push</div><div class="head">hybrid (≥ 100 k pulled)</div><div class="head">pull</div>
<div class="row">celebrity post</div><div class="box red">50 M inserts</div><div class="box green">0 inserts</div><div class="box green">0 inserts</div>
<div class="row">steady inserts/s</div><div class="box orange">46,000</div><div class="box green">7,406</div><div class="box green">0</div>
<div class="row">reads per feed open</div><div class="box green">1</div><div class="box orange">10 (1 + 9 celebrities)</div><div class="box red">200 → 7 M reads/s</div>
</div>

<p class="small">Simulator <b>feed-fanout</b> on the news-feed page (section 6.1): pick the strategy, the threshold and the workers.</p>

<!--
The numbers come from the simulator's model, which uses the page's estimates. With 10 workers the same
post makes ordinary posts 1,000 s late and the backlog needs 12,500 s (3.5 h).
-->

---

## Chat: stateful edge, stateless core

<div class="flow">
<div class="box muted">Alice's phone</div><div class="arrow">→</div>
<div class="box">L4 load balancer<small>long-lived TCP</small></div><div class="arrow">→</div>
<div class="box accent">gateway gw-031<small>holds the socket</small></div><div class="arrow">→</div>
<div class="box accent">chat service<small>seq 88, store, ack</small></div><div class="arrow">→</div>
<div class="box">pub/sub<small>channel gw-117</small></div><div class="arrow">→</div>
<div class="box muted">Bob on gw-117</div>
</div>

- 15 M concurrent sockets ≈ **300 gateways** that only hold connections and route frames.
- **Session registry** (user/device → gateway) + **pub/sub** channel per gateway.
- Order: **sequence number per conversation** from a single owner — never phone timestamps.
- Exactly-once **display** = at-least-once delivery + `clientMsgId` dedupe.
- Offline: store first, push notification, `sync` from the device's last `seq`.
- Presence from the connection; publish **changes** only, to subscribers only.

---

## Ride sharing: two consistency levels

<div class="cols">
<div>

**Eventual: positions**

- 1 M drivers every 4 s = **250 k writes/s**.
- Only the **latest** matters: ~100 MB in an in-memory geo index (geohash / H3).
- Search the cell **and its neighbors**; expand the ring.

</div>
<div>

**Strong: assignment**

- Lock the driver before the offer: `SET … NX PX 15000`.
- Accept = conditional update `WHERE status = 'MATCHING'`.
- Partial unique index: **one active ride per driver**.

</div>
</div>

<p class="small">BoxOffice tie-in: 60 000 fans leave the stadium at once — a predictable hot cell.</p>

---

## Video: follow the bytes

- Viewers pull ~**34 PB/day**, ~**9 Tbit/s** at peak (illustrative) → the **CDN** serves the bytes.
- Uploads go **straight to object storage** (pre-signed, multipart, resumable).
- Transcoding = **DAG of idempotent tasks** on a queue; publish low resolutions first.
- **Adaptive bitrate**: ladder of renditions, ~4 s segments, the player picks each next segment.
- Origin shield + request collapsing for viral videos; pre-position the head, pull the long tail.

<div class="ok">

"My servers handle metadata, orchestration and signatures — never video bytes."

</div>

---

## Payments: exactly-once is a design, not a feature

- Networks only give **at-least-once**; the exactly-once *effect* comes from **idempotency keys**.
- Store key + request hash + response; replay the response on retry; send the key to the payment service provider (PSP) too.
- A timeout means **UNKNOWN**, not failed: ask the provider, never charge again blindly.
- **Double-entry ledger**: append-only entries that sum to zero; balances are derived.
- **Webhooks** are signed, late, duplicated → idempotent handlers.
- **Reconciliation** against the provider's settlement files catches everything else.

---

## The unknown outcome

<div class="flow">
<div class="box">CREATED</div><div class="arrow">call PSP →</div>
<div class="box accent">PROCESSING</div><div class="arrow">→</div>
<div class="group"><div class="caption">the provider answers</div>
<div class="box green">SUCCEEDED<small>ok or webhook captured</small></div>
<div class="box red">FAILED<small>declined</small></div>
<div class="box orange">UNKNOWN<small>timeout / 5xx</small></div>
</div>
<div class="arrow">UNKNOWN →</div>
<div class="box accent">ask the provider<small>status query or webhook, then decide</small></div>
</div>

<div class="warn">

A timeout is **not** a failure: the charge may have happened. Charging again blindly is how fans pay twice.

</div>

---

## Flagship: the BoxOffice flash sale

| Quantity | Value | So… |
|---|---:|---|
| Requests without a waiting room | ~167 k/s | hot seat rows cannot take it → **admission control** |
| Waiting-room joins | ~17 k/s | static page on the **CDN**, cheap status |
| Admission rate (10 k shoppers, 5 min) | ~33 fans/s | Little's Law: λ = L / W |
| Orders | ~20/s | one well-indexed SQL primary is enough |
| Payment calls in flight (2 s) | ~40 | size the bulkhead for 40, not 2 M |
| Whole inventory | ~6 MB | storage is not the problem; **contention** is |

---

## The flash sale as a funnel

<div class="flow">
<div class="box red">2 M fans<small>in 120 s</small></div><div class="arrow">→</div>
<div class="box green">CDN<small>waiting page, polls cached 1 s</small></div><div class="arrow">→</div>
<div class="box accent">waiting room<small>~17 k joins/s</small></div><div class="arrow">→ 33/s →</div>
<div class="box">shoppers<small>≤ 10 k at once</small></div><div class="arrow">→</div>
<div class="box">holds + orders<small>~20 orders/s</small></div><div class="arrow">→</div>
<div class="box orange">payment provider<small>~40 calls in flight</small></div>
</div>

- Each stage passes **less** than it receives: the burst is turned into a measured flow before it reaches the hot seat rows.
- The admission rate comes from Little's Law (λ = L / W = 10,000 / 300 s); the provider's bulkhead from the same law (20/s × 2 s).
- Scenario `ticketing`: the same numbers in the playground; compare the requests that reach the inventory database before and after.

---

## Seat holds without double booking

```sql
UPDATE seat
   SET status = 'HELD', hold_id = $1, held_until = now() + interval '10 minutes'
 WHERE event_id = $2 AND seat_id = ANY($3)
   AND (status = 'AVAILABLE' OR (status = 'HELD' AND held_until < now()));
-- rows updated == seats requested, otherwise ROLLBACK → 409
```

- Losers fail fast (0 rows) — no lock waits, expired holds reclaimed lazily.
- Order = **state machine**: HELD → PENDING_PAYMENT → CONFIRMED, idempotent transitions, outbox → Kafka.
- General admission = one hot counter → shard it, or move it to Redis with a durable guard.

---

## AI assistant: an LLM is one component

- **RAG**: chunk → embed → vector DB; hybrid search + rerank; answers with citations.
- **LLM gateway**: route small vs. large model, fallbacks, quotas, cache, cost per conversation.
- **Agent loop** with a **tool registry** (Model Context Protocol, MCP): look up an order, start a refund.
- Authorization **outside the model**; side effects need the fan's **confirmation**.
- **Safety mesh**: direct and *indirect* prompt injection, PII, output validation.
- **Evals** offline (test sets) and online (feedback, escalation rate); stream tokens (time to first token, TTFT).

---

<!-- _class: tight -->

## What separates the levels

| Level | Typical answer |
|---|---|
| **Junior** | Reasonable boxes and tables; caching mentioned; misses the hard part or solves it with "more servers" |
| **Mid** | Requirements and estimates drive the design; queues, caches, idempotency in the right places; names the hard part |
| **Senior** | Quantifies; compares alternatives with their failure behavior; designs for failure (timeouts, reconciliation, failover); states consistency choices explicitly; knows when a single PostgreSQL is still the right answer |

<p class="small">Each case ends with its own rubric — grade yourself, then repeat a week later without looking.</p>

---

## Pitfalls

<div class="warn">

- Jumping to technologies before requirements and numbers.
- Estimates that never turn into a decision.
- Only the happy path: no "what happens when X is down?".
- Over-engineering: five databases and three regions for 100 req/s.
- A 40-minute monologue — check in after every step.

</div>

<!--
Ask students which pitfall they recognize in their own design docs. Most will say the first two.
-->

---

<!-- _class: tight -->

## The concept map

| Pattern | Cases | Classes | Components |
|---|---|---|---|
| Cache the hot reads | URL shortener, news feed, autocomplete, video | Caching, Edge | `cache` `cdn` |
| Slow work off the critical path | notifications, video, news feed, payments | Messaging, Compute | `queue` `kafka` `worker` |
| Safe retries, strong consistency where it matters | payments, ticketing, chat, ride sharing | Distributed, Databases | `sql` `payment` |
| Choose the partition key | chat, ride sharing, ticketing, distributed cache | Databases | `nosql` `stream` `cache` |
| Protect what cannot scale | ticketing, rate limiter, AI assistant | Edge, Reliability | `waf` `apigw` `queue` `llmgw` |

<p class="small">Each case page ends with a "How it connects" diagram: the classes it tests and the palette components it uses.</p>

---

## Takeaways

1. Use the **framework** and its clock: clarify, estimate, API/data, design, deep dives, trade-offs, wrap-up.
2. Every number must end in a **decision**.
3. Twelve problems, **a handful of patterns**: cache, async, idempotency, partition key, admission control.
4. Strong consistency **only where it matters**: seats, money, assignments.
5. Design the **failure path** as carefully as the happy path.
6. Practice: attempt first, compare, run the scenario, answer the follow-ups, grade yourself, repeat.
