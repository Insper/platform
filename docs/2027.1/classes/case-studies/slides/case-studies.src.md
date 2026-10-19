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
| 2 | Estimate | 5 | QPS avg/peak, storage, bandwidth, memory → **a decision** |
| 3 | API and data model | 5–7 | few endpoints, entities, store per entity and why |
| 4 | High-level design | 10 | one diagram: read path and write path |
| 5 | Deep dives | 10–15 | two or three hard parts, alternatives, a choice |
| 6 | Bottlenecks and trade-offs | 5 | what breaks first, what you gave up |
| 7 | Wrap-up | 2–3 | summary, next steps, how to measure |

<p class="small">Every case page uses this numbering, plus: try it in the playground, follow-up questions, rubric.</p>

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
| Notification system | ★★ | queue per channel, retries + DLQ, dedupe, preferences, provider failover |

<p class="small">Scenarios: <code>url-shortener</code>, <code>rate-limiter</code>, <code>read-heavy-cache</code> / <code>sharding</code>, <code>search-autocomplete</code>, <code>notification-system</code>.</p>

---

<!-- _class: tight -->

## The cases (2/2): hard

| Case | Level | The core idea |
|---|---|---|
| News feed | ★★★ | fan-out on write vs. read; hybrid for celebrities; timeline of IDs |
| Chat | ★★★ | stateful WebSocket gateways, per-conversation sequence, dedupe |
| Ride sharing | ★★★ | latest positions in a geo index; one driver, one ride |
| Video streaming | ★★★ | bytes never touch your servers; transcoding DAG; ABR + CDN |
| Payment system | ★★★ | idempotency keys, double-entry ledger, reconciliation |
| Ticketing (BoxOffice) | ★★★ | waiting room + Little's Law; seat holds without double booking |
| AI assistant | ★★★ | RAG, LLM gateway, tools with permissions, guardrails, evals |

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
- Fix: one **Lua script** per request, atomic on the shard that owns the key; server clock (`TIME`); TTL on every key.
- **Fixed window** lets 2× through at the boundary; **token bucket** or **sliding-window counter** in production.
- Counters for 1 M clients ≈ **200 MB**; a sliding *log* would need ~30 GB.

<div class="warn">

Per-client limits do not stop **a million legitimate fans** at 10:00. That needs load shedding, concurrency limits — and a waiting room.

</div>

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

## Chat: stateful edge, stateless core

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
- Store key + request hash + response; replay the response on retry; send the key to the PSP too.
- A timeout means **UNKNOWN**, not failed: ask the provider, never charge again blindly.
- **Double-entry ledger**: append-only entries that sum to zero; balances are derived.
- **Webhooks** are signed, late, duplicated → idempotent handlers.
- **Reconciliation** against the provider's settlement files catches everything else.

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
- **Agent loop** with a **tool registry** (MCP): look up an order, start a refund.
- Authorization **outside the model**; side effects need the fan's **confirmation**.
- **Safety mesh**: direct and *indirect* prompt injection, PII, output validation.
- **Evals** offline (test sets) and online (feedback, escalation rate); stream tokens (TTFT).

---

## Study with the playground

**Predict** → **Run** → **Observe** → **Change one thing** → **Explain** with the numbers.

- Every case embeds its scenario: `flash-sale`, `news-feed`, `chat`, `ride-sharing`, …
- Profiles: `load` (steady), `spike` (10:00), `stress` / `breakpoint` (the knee), chaos (failures).
- Look at utilization, p99, errors, queue backlog, cache hit ratio — and cost.
- Remove the cache, bypass the queue, kill a node: **see** why each component is there.

<div class="ok">

The simulator's numbers are illustrative; the **shapes** (knee, backlog, cascade) are real.

</div>

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
