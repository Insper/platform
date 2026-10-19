
*"Design a ticketing system like BoxOffice. You have 45 minutes."* The prompt is one sentence long on purpose. There is no single correct answer, no hidden test suite, and the interviewer will not tell you what to do next. What they evaluate is **how you get from a vague sentence to a defensible design**: the questions you ask, the numbers you estimate, the structure you impose, and how you reason about trade-offs when they push back[^1].

Without a method, 45 minutes disappear fast: 20 minutes on the database schema, then a panic to draw the rest. This page gives you a **seven-step framework** with a time budget, applies it end to end to BoxOffice, and lists what interviewers look for at each step. The same framework is useful outside interviews — it is the skeleton of a good design review or design document.

---

## What the interviewer is looking for

Interviewers usually score a few dimensions, with different names in different companies but similar content[^1][^2]:

| Signal | What it looks like in practice |
|---|---|
| **Problem navigation** | asks clarifying questions; scopes the problem; identifies what is hard about *this* problem |
| **Solution design** | a working high-level design that covers the requirements, built from appropriate components |
| **Technical depth** | can go deep on the critical parts: data model, consistency, scaling, failure handling |
| **Trade-off reasoning** | names alternatives, compares them with numbers, states what is given up |
| **Communication** | thinks aloud, drives the session, structures the board, adapts to feedback |

Expectations grow with seniority. A rough guide:

| Level | Expected |
|---|---|
| **Intern / junior** | a reasonable high-level design with guidance; knows the main components and what they do |
| **Mid-level** | drives the whole design; goes deep in one or two areas; spots the main bottleneck |
| **Senior and above** | drives *and* prioritizes: finds the hardest parts quickly, goes deep with numbers, anticipates failure modes, operations and cost, and discusses evolution |

---

## The framework at a glance

| # | Step | Time (45 min) | Output on the board |
|---|---|---|---|
| 1 | **Clarify requirements** | 0–5 min | functional list (3–5 items) + non-functional targets |
| 2 | **Estimate** | 5–10 min | requests/s (average and peak), storage, bandwidth — and what they imply |
| 3 | **API & data model** | 10–15 min | 4–6 endpoints; main entities with keys |
| 4 | **High-level design** | 15–25 min | box-and-arrow diagram covering every functional requirement |
| 5 | **Deep dives** | 25–37 min | detail of the 1–3 hardest parts |
| 6 | **Bottlenecks & trade-offs** | 37–42 min | what breaks first, how to fix it, what each choice costs |
| 7 | **Wrap-up** | 42–45 min | summary, open issues, how it evolves |

The times are a budget, not a law: if the interviewer wants to spend 15 minutes on one deep dive, follow them. But check the clock at each transition — running out of time before drawing a complete high-level design is the most common way to fail.

``` mermaid-sim
sequenceDiagram
    participant C as Candidate
    participant I as Interviewer
    I->>C: "Design BoxOffice"
    C->>I: 1. Clarifying questions (users, scale, consistency, scope)
    I-->>C: answers / "you decide"
    C->>C: 2. Estimate out loud
    C->>I: 3. Proposes API and data model
    C->>I: 4. Draws the high-level design
    I-->>C: "How do you avoid double booking?"
    C->>I: 5. Deep dive (with alternatives)
    I-->>C: "What if traffic grows 10×?"
    C->>I: 6. Bottlenecks and trade-offs
    C->>I: 7. Wrap-up: summary and next steps
```

Notice the arrows from the interviewer: deep dives and bottlenecks are often **steered** by their questions. Treat every question as a hint about what they want to evaluate, not as an attack.

---

## Step 1 — Clarify requirements (≈ 5 min)

**Goal**: turn the one-sentence prompt into a problem with boundaries. Ask, then **write the answers on the board**.

- *Users and scale*: how many users, daily active users, peak events?
- *Core features*: which 3–5 must I design? What is out of scope?
- *Read/write mix and access patterns*: read-heavy or write-heavy? Spiky?
- *Consistency*: what must never be wrong? What can be stale?
- *Latency and availability* expectations; any regulation (payments, personal data)?

!!! example "BoxOffice — step 1"

    **Functional** (in scope): browse/search events; view seat map; hold seats (10-min expiry); pay via external provider; receive ticket. *Out of scope*: resale, dynamic pricing, organizer tools beyond creating events.

    **Non-functional**: 20 M registered fans, 2 M daily active; big on-sales with **2 M fans for 60 k seats** in the first minute; **no double booking, ever**; catalog may be ~1 min stale; hold p99 < 300 ms; checkout available 99.95%.

    *"So the interesting part is the on-sale: a huge spike of contention on a small, strongly consistent inventory. I'll focus the design there, OK?"*

That last sentence matters: naming **what is hard about this problem** shows problem navigation and tells the interviewer where you will spend your deep-dive time.

## Step 2 — Estimate (≈ 5 min)

**Goal**: get orders of magnitude that **change decisions**. Round aggressively and say the conclusion, not just the arithmetic. [Class 2](../../estimation/index.md) teaches the method; here is how it sounds in the interview:

!!! example "BoxOffice — step 2"

    - *Normal day*: 2 M fans × 20 page views = 40 M reads/day ≈ 40 M / 10⁵ s ≈ **400 reads/s**, peak ×3 ≈ **1,200 reads/s**. Orders: 100 k/day ≈ **1 write/s**. Read-heavy: **cache the catalog**.
    - *On-sale*: 2 M fans in 60 s ≈ **33 k arrivals/s**, each polling a few times ≈ **100 k+ req/s** at the edge. Only 60 k seats ⇒ at most 60 k successful orders. *"The inventory cannot see 100 k req/s on the same rows — I need a waiting room that admits a few thousand per second."*
    - *Storage*: orders 100 k/day × 1 KB ≈ 100 MB/day ≈ **40 GB/year** — fits one PostgreSQL primary for years; **no sharding needed for orders**. Seat rows per event ≤ 100 k × 100 B ≈ 10 MB — tiny, but **hot**.

Two decisions came out of four lines of arithmetic: a cache for the catalog and a waiting room for the inventory. That is the purpose of estimating.

## Step 3 — API and data model (≈ 5 min)

**Goal**: make the functional requirements concrete. List the main endpoints (or messages) and the main entities with their keys. Don't write every field — just enough to reason about access patterns and consistency.

```http
GET  /events?q=&city=&date=           search and browse (cacheable)
GET  /events/{eventId}/seats          seat map with availability
POST /events/{eventId}/holds          { seatIds }        → { holdId, expiresAt }
POST /orders                          { holdId }         → { orderId, paymentUrl }
POST /payments/webhook                provider → BoxOffice: paid | declined
GET  /orders/{orderId}                status and tickets
```

| Entity | Key | Main fields | Store |
|---|---|---|---|
| `event` | `event_id` | name, venue, date, on-sale time | SQL (catalog), cached |
| `seat` | (`event_id`, `seat_id`) | section, row, price, **status** (free / held / sold), `hold_id`, `version` | SQL (inventory) |
| `hold` | `hold_id` | `fan_id`, `event_id`, seat list, `expires_at` | SQL (inventory) |
| `order` | `order_id` | `fan_id`, `hold_id`, amount, status, **idempotency key** | SQL (orders) |
| `ticket` | `ticket_id` | `order_id`, seat, QR code | SQL / Object Store (PDF) |

Mention the access pattern next to each entity: the seat map is read by `event_id`; holds update a few seats of one event; orders are read by `fan_id`. Those patterns drive indexes and, later, partition keys.

## Step 4 — High-level design (≈ 10 min)

**Goal**: a diagram that serves **every functional requirement** end to end. Start simple, then add what the estimates demand. Walk through one request at a time as you draw ("the fan opens the event page: CDN, gateway, catalog, cache…").

``` mermaid-sim
flowchart LR
    fan([Fan]) --> cdn["CDN<br/>static + images"]
    fan --> gw["API Gateway<br/>auth, rate limit"]
    gw --> catalog["catalog"]
    catalog --> cache[("Cache")]
    cache --> catdb[("Catalog SQL<br/>+ replicas")]
    gw --> wr["Waiting room"]
    wr --> inventory["inventory"]
    inventory --> invdb[("Inventory SQL<br/>primary")]
    inventory --> order["order"]
    order --> psp["Payment provider"]
    psp -->|webhook| order
    order --> stream["Event stream"]
    stream --> notification["notification"]
    stream --> search["search"]
```

!!! tip "Draw the happy path first"

    Draw the components needed by the main flow, label the arrows (sync call, async message, replication), and only then decorate (replicas, caches, monitoring). An interviewer cannot evaluate a deep dive into a design they have not seen completely.

## Step 5 — Deep dives (≈ 12 min)

**Goal**: show technical depth on the **1–3 hardest parts**. Choose them yourself (the ones you named in step 1), or follow the interviewer. For each one: state the problem, present **two or three alternatives**, compare them, choose.

!!! example "BoxOffice — deep dive 1: never sell a seat twice"

    *Problem*: thousands of fans try to hold the same seats concurrently.

    | Option | How | Trade-off |
    |---|---|---|
    | Pessimistic lock | `SELECT … FOR UPDATE` on the seat rows inside a transaction | simple and correct; locks queue under contention |
    | **Conditional update** (optimistic) | one atomic `UPDATE … WHERE status = 'FREE'`; check the row count | no long locks; a loser just retries other seats |
    | Distributed lock (Redis) | lock per seat in Redis, then write to SQL | extra component, and two systems must agree — avoid when the DB can do it |

    *Choice*: conditional update in the inventory database — the database is the single source of truth, and the check-and-set is one atomic statement:

    ```sql
    UPDATE seat
       SET status = 'HELD', hold_id = :holdId, version = version + 1
     WHERE event_id = :eventId
       AND seat_id IN (:seatIds)
       AND status = 'FREE';
    -- rows updated = number requested → hold created; otherwise roll back and answer 409
    ```

    Expired holds are released by a scheduled job (`status = 'HELD' AND expires_at < now()`), or lazily at read time.

!!! example "BoxOffice — deep dive 2: the 10:00 spike"

    The waiting room admits fans at the rate the inventory sustains. If one hold takes 5 ms of database time on a hot event and the database runs ~8 of them in parallel productively, the inventory completes about 8 / 0.005 = **1,600 holds/s** at full utilization — say **~1,000/s** to keep latency low (class 2 explains why). With ~2 seats per fan, 60 k seats need ~30 k successful fans: about **30 s** of admissions. The other ~2 M fans wait in line, and the waiting room tells them as early as possible that the show is sold out. The catalog page for the event is pre-warmed in the cache and the CDN *before* 10:00 to avoid a cold-cache stampede.

!!! example "BoxOffice — deep dive 3: paying exactly once"

    The fan clicks "pay" twice, or the network drops the response and the client retries. Each `POST /orders` carries an **idempotency key**; the order service stores it with a unique constraint and returns the existing order for a repeated key. The payment provider's webhook may also arrive twice — the handler is idempotent by provider transaction id.

## Step 6 — Bottlenecks and trade-offs (≈ 5 min)

**Goal**: critique your own design before the interviewer does. Go through the diagram and ask, for each component: *what breaks first? what is the single point of failure? what happens if it is slow?*

| Concern | Mitigation | Cost of the mitigation |
|---|---|---|
| Hot event = hot rows in one database | waiting room; seats of one event on one partition (sharding by `event_id` across events) | queueing delay for fans |
| Payment provider slow or down | timeout + circuit breaker; hold extended while payment is pending | complexity; seats locked longer |
| Catalog cache stampede at 10:00 | pre-warm; request coalescing | more moving parts |
| Inventory primary failure | synchronous standby + automatic failover | write latency; a few seconds of unavailability |
| Bots | WAF, rate limit per fan/card, CAPTCHA at queue entry | friction for real fans |

Then name the main trade-offs **explicitly**: *"I chose strong consistency for seats over availability: if the inventory primary is unreachable, holds fail rather than risk a double sale. The catalog is the opposite: I accept 60 s staleness for speed."*

## Step 7 — Wrap-up (≈ 3 min)

**Goal**: leave a clear final picture. In three or four sentences: what you designed, how it meets the key requirements, what you would do next with more time (monitoring and SLO alerts, multi-region, the AI assistant…), and any open questions. Do not introduce new components now.

---

## How to communicate

The structure above is necessary but not sufficient. These habits make the difference[^3]:

- **Think out loud.** Silence is the worst signal; say what you are considering and why, even when unsure.
- **Go broad, then deep.** A complete simple design beats a perfect half design.
- **State assumptions explicitly.** "I'll assume 2 M daily fans; tell me if that's off."
- **Use the board as your memory.** Requirements in one corner, numbers in another, diagram in the middle — refer back to them.
- **Welcome pushback.** "Good point — if the provider is down for an hour, holds expire; let me revisit that." Changing your mind with a reason is a strong signal.
- **Drive.** Announce transitions: "I have the high-level design; I'd like to deep-dive into the double-booking problem, then the spike."
- **Quantify trade-offs.** "This adds ~1 ms per request but cuts database load by 10×."

!!! tip "In the interview"

    Memorize the seven steps and their time budget, and **say them out loud at the start**: "I'll clarify requirements, do some quick estimates, sketch the API and data, draw a high-level design, then deep-dive into the hardest parts and discuss bottlenecks." The interviewer immediately knows you have a plan — and you have a checklist to fall back on when nerves hit.

### Practising with the playground

The [playground](../../../../playground/index.md) is a good sparring partner for steps 4–6. After designing a problem on paper, rebuild your high-level design from the palette, run the load profile that matches your estimates (`spike` for an on-sale, `soak` for a steady service), and look for the first saturated component. If it is not the one you named in step 6, find out why. The [practice problems](../../../support/interview/problems/index.md) and [mock interview guide](../../../support/interview/mock/index.md) are organized to be used in pairs: one candidate, one interviewer, then swap.

!!! warning "Common pitfalls"

    - **Jumping into the design** without clarifying — solving a problem the interviewer did not ask.
    - **Estimating for the sake of it** — numbers that lead to no decision waste minutes.
    - **Going deep too early** — 20 minutes on the schema, no time for the architecture.
    - **Buzzword architecture** — naming technologies without saying what problem each solves.
    - **One option only** — a deep dive with no alternatives shows no trade-off reasoning.
    - **Defending every decision to the end** — treating hints as attacks.
    - **Ignoring failures** — a design that only works when every component is up.

---

## How it connects { #how-it-connects }

``` mermaid
flowchart LR
    S1["1. Clarify<br/>→ Requirements"] --> S2["2. Estimate<br/>→ Estimation"]
    S2 --> S3["3. API & data model<br/>→ Compute, Databases"]
    S3 --> S4["4. High-level design<br/>palette components"]
    S4 --> S5["5. Deep dives"]
    S5 --> S6["6. Bottlenecks<br/>& trade-offs"]
    S6 --> S7["7. Wrap-up"]
    S5 --> D1["no double booking<br/>sql conditional update"]
    S5 --> D2["the 10:00 spike<br/>waiting-room queue"]
    S5 --> D3["pay exactly once<br/>idempotency key, webhook"]
    S6 --> PG["rehearse in the playground<br/>→ Case studies"]
```

**Palette components** of the BoxOffice high-level design: [`cdn`](../../../reference/components/edge/index.md#cdn) (static files and images) · [`apigw`](../../../reference/components/edge/index.md#apigw) (auth, rate limit) · [`app`](../../../reference/components/compute/index.md#app) (`catalog`, `inventory`, `order`) · [`cache`](../../../reference/components/storage/index.md#cache) (catalog) · [`sql`](../../../reference/components/storage/index.md#sql) (inventory primary, catalog replicas) · [`queue`](../../../reference/components/messaging/index.md#queue) (waiting room) · [`payment`](../../../reference/components/external/index.md#payment) (provider and webhook) · [`stream`](../../../reference/components/messaging/index.md#stream) (events to `notification` and `search`) · [`waf`](../../../reference/components/edge/index.md#waf) (bots). **Scenarios:** `flash-sale`, `payment-system`, `url-shortener` (a first practice problem). **Continues in:** [Case studies](../../case-studies/index.md), [Ticketing — the BoxOffice flash sale](../../case-studies/ticketing/index.md), [Databases — the double-booking bug](../../databases/transactions/index.md#double-booking), [Compute — idempotency keys](../../compute/integrations/index.md#idempotency-keys), [Interview prep — framework](../../../support/interview/framework/index.md).

## Key takeaways

- The system-design interview evaluates **process**: navigation, design, depth, trade-offs and communication.
- Use seven steps with a time budget: **clarify → estimate → API & data model → high-level design → deep dives → bottlenecks & trade-offs → wrap-up**.
- Clarifying should end with **what is hard about this problem** — that is where your deep dives go.
- Estimates exist to **change decisions** (cache? shard? queue?).
- Deep dives compare **alternatives** and choose; the wrap-up summarizes and points to next steps.

---

[^1]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1. Byte Code LLC, 2020. Chapter 3 (a framework for system design interviews).
[^2]: XU, A.; LAM, S. *System Design Interview — An Insider's Guide*, vol. 2. Byte Code LLC, 2022.
[^3]: McDOWELL, G. L. *Cracking the Coding Interview*, 6th ed. CareerCup, 2015. Chapter 9 (system design and scalability).
