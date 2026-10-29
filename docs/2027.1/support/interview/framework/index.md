# The interview framework

A system-design interview is an open problem with a clock. Without a structure, it is easy to spend twenty minutes on the database schema and never reach the part the interviewer cared about. The framework below is a sequence of seven steps, each with a goal, a time box, phrases to say and a template you can sketch on the board. It is the same framework taught in [Class 1 · Interview framework](../../../classes/intro/interview-framework/index.md) and followed by every [case study](../../../classes/case-studies/ticketing/index.md); here it is written as a checklist you can rehearse.

Throughout the page, the running example is the question from the [landing page](../index.md): *"Design a ticketing site for a stadium show. Tickets go on sale Saturday at 10:00."* — BoxOffice's flash sale, with **2 million fans** for **60,000 seats**.

!!! note "Copy the templates"
    Each step ends with a template in a text block. Copy it to your notes or to the board and fill it in: after a few practice problems the headings become a habit, and you stop forgetting a whole category (durability, cost, failure) under pressure.

``` diagram
flowchart LR
    A[1. Clarify<br/>~5 min] --> B[2. Estimate<br/>~5 min]
    B --> C[3. API & data model<br/>~5 min]
    C --> D[4. High-level design<br/>~10 min]
    D --> E[5. Deep dives<br/>~12 min]
    E --> F[6. Bottlenecks & trade-offs<br/>~5 min]
    F --> G[7. Wrap-up<br/>~3 min]
    E -.new requirement or concern.-> A
```

## Timing

| Step | 45-minute interview | 60-minute interview | Output on the board |
|---|---|---|---|
| 1. Clarify the requirements | 5 min | 6–8 min | Short list of functional and non-functional requirements; out of scope |
| 2. Estimate | 5 min | 5–7 min | Peak QPS, read/write ratio, storage, the deciding number |
| 3. API and data model | 5 min | 6–8 min | 3–6 endpoints or events; core entities with keys |
| 4. High-level design | 10 min | 12–15 min | One diagram, one read and one write walked through |
| 5. Deep dives | 12 min | 15–18 min | One or two components in depth |
| 6. Bottlenecks and trade-offs | 5 min | 5–7 min | What breaks first, single points of failure, what you traded |
| 7. Wrap-up | 3 min | 3–5 min | Four-sentence summary and next steps |

!!! tip "The clock is yours to manage"
    Glance at the time at each transition. If you are at minute 20 and still in step 3, say so and compress: *"I'll keep the data model short so we have time for the hard part."* Interviewers rarely penalize a deliberate shortcut; they do penalize never reaching the deep dive. Five minutes before the end, wrap up even if the interviewer is still asking questions.

---

## 1. Clarify the requirements

**Goal.** Turn a one-line prompt into a problem with boundaries: who uses it, for what, at what scale, and what must never go wrong. Everything after this step is justified by something written here.

**What to say.**

- "Before I draw anything, I'd like to pin down the scope. Can I ask a few questions?"
- "I'll focus on these three features; I'll leave X and Y out unless you want them."
- "So the hardest requirement is… — does that match what you had in mind?"

**Questions to ask.**

- Users and features: who are the users? What are the 3–5 core actions? What is explicitly out of scope?
- Scale: how many users (daily active, peak concurrent)? How much data? Growth over the next years?
- Read/write shape: is it read-heavy or write-heavy? Are there spikes (a sale, a match, a launch)?
- Consistency: what must never be wrong (money, inventory, permissions)? What can be a few seconds stale?
- Latency and availability: how fast must the main action be (p99)? What availability is expected?
- Constraints: regions, regulation (personal data), budget, existing systems, team size.

```text
REQUIREMENTS
Functional (in scope):
  1. ...
  2. ...
  3. ...
Out of scope: ...
Non-functional:
  Scale:        DAU = ..., peak concurrent = ..., data = ...
  Latency:      p99 of <main action> < ... ms
  Availability: ... % (which paths?)
  Consistency:  strong for ..., eventual for ...
  Durability:   never lose ...
  Other:        security / privacy / cost / regions
The hard part (one sentence): ...
```

!!! warning "Common mistakes"
    - Drawing in the first minute, then discovering the system is write-heavy.
    - Asking twenty questions and never committing: after 5 minutes, *state* assumptions and move on.
    - Forgetting the non-functional requirements — they are what make the design interesting.
    - Not writing the requirements down: you will need them in step 6 to justify the trade-offs.

!!! example "BoxOffice flash sale — step 1"
    - **Functional:** view the event page and seat map; hold one or more seats for a few minutes; pay; receive the ticket by email and in the app.
    - **Out of scope:** resale, venue management, recommendations.
    - **Non-functional:** 2 M fans arrive around 10:00 for 60 k seats; the site must stay up and fair (first come, first served, bots blocked); **a seat is never sold twice**; holding a seat should feel instant (p99 under ~500 ms after admission); the event page can be a few seconds stale.
    - **The hard part:** a huge spike of contention on a small, strongly consistent inventory — not the volume of data.

---

## 2. Estimate

**Goal.** Put orders of magnitude on the requirements so that each later choice has a number behind it. You are not computing a budget; you are finding the **one or two numbers that decide the design**.

**What to say.**

- "Let me do a quick back-of-the-envelope estimate; I'll round aggressively."
- "One day is about 10⁵ seconds, so 10 million requests a day is about 100 per second on average."
- "The number that matters here is… because it means we need…"

**Questions to ask yourself.**

- Average and **peak** requests per second (peak factor 2–10× for normal traffic; far more for a flash sale).
- Read/write ratio; how much each write weighs (bytes).
- Storage per day/year (and with replication ×3); bandwidth in and out.
- Concurrency with Little's Law: in-flight requests = rate × time.
- Which component's limit is closest to these numbers? (See the [numbers cheat sheet](../../../reference/numbers/index.md).)

```text
ESTIMATION (round to powers of 10)
Users:      DAU = ...            peak concurrent = ...
Requests:   per user per day = ...
            avg QPS = DAU x req/user / 1e5 = ...
            peak QPS = avg x peak factor (...) = ...
Read:write  = ... : ...          write QPS = ...
Storage:    item size = ... B    items/day = ...
            per year = ... (x3 replicas = ...)
Bandwidth:  peak QPS x response size = ... MB/s
Concurrency (Little): peak QPS x latency = ... in flight
Deciding number(s): ...  =>  implication: ...
```

!!! warning "Common mistakes"
    - Spending ten minutes on precise arithmetic. One significant digit is enough.
    - Estimating the average and designing for it: always size for the peak.
    - Numbers that never influence a decision. If an estimate doesn't change the design, skip it.
    - Forgetting to say the assumptions out loud, so the interviewer can't correct them.

!!! example "BoxOffice flash sale — step 2"
    - **Fans per seat:** 2,000,000 ÷ 60,000 ≈ **33**. Most fans will not get a ticket: fairness and a clear "sold out" matter.
    - **Read peak (≈ illustrative):** 2 M fans refreshing every ~10–20 s in the first minutes ⇒ on the order of **10⁵ requests per second**, almost all for the same event page and seat map.
    - **Write peak (≈ illustrative):** 60 k seats held over a few minutes ⇒ on the order of **10³ holds per second** — small, but every one of them competes for the same rows.
    - **Storage:** 60 k orders × ~1 KB ≈ 60 MB per show — irrelevant.
    - **Deciding numbers:** a 100,000 req/s read spike (⇒ CDN and cache) and ~1,000 contended writes/s on one event (⇒ a waiting room and atomic seat holds).

---

## 3. API and data model

**Goal.** Make the design concrete: the main operations the clients call (or the events services exchange) and the entities with their keys and access patterns. The access patterns choose the database; the operations that touch money or inventory get **idempotency keys**.

**What to say.**

- "These are the four calls the client needs; the one that matters is…"
- "This call changes inventory, so it takes an idempotency key — a retry must not hold a second seat."
- "The main access pattern is 'all seats of an event by section', so I'll key the table by event."

**Questions to ask yourself.**

- Which calls are reads and which are writes? Which must be synchronous?
- What are the keys and the main query of each entity? Which needs transactions?
- Pagination (cursor-based), versioning, authentication on each call.

```text
API (REST; auth = bearer token)
GET  /events/{id}                       -> event page (cacheable)
GET  /events/{id}/seats?section=...     -> seat map (short TTL cache)
POST /holds         {eventId, seatIds}  Idempotency-Key: ...  -> holdId, expiresAt
POST /orders        {holdId, payment}   Idempotency-Key: ...  -> orderId, status
GET  /orders/{id}                       -> status (PENDING/CONFIRMED/FAILED)
Webhook: POST /payments/webhook (signed by the provider)

DATA MODEL
Entity      Key                 Main access pattern          Store / consistency
event       event_id            read by id                   SQL + cache, eventual OK
seat        (event_id, seat_id) by event + section; hold     SQL, strong (transactions)
order       order_id            by id; by user_id            SQL, strong
...
```

!!! warning "Common mistakes"
    - Designing twenty endpoints. Show the 3–6 that carry the core flows.
    - Choosing the database before writing the access patterns.
    - Forgetting idempotency on writes that may be retried (holds, orders, payments).
    - Offset pagination on large, changing lists (use cursors).

!!! example "BoxOffice flash sale — step 3"
    The four calls above are the whole purchase flow. `seat` rows live in PostgreSQL with a primary key `(event_id, seat_id)`, a `status` (`free`, `held`, `sold`), `hold_until` and `order_id`. `POST /holds` takes an idempotency key so a double click or a client retry returns the same hold. `order` stores the payment idempotency key sent to the provider. Event and venue data are read-mostly and will be cached.

---

## 4. High-level design

**Goal.** One diagram that satisfies every functional requirement end to end, with the data flow labeled. Keep it simple; you will improve it in the deep dives. Walk **one read and one write** through it out loud.

**What to say.**

- "Let me start simple and then evolve it: clients, edge, services, storage, async work."
- "Here is the path of a hold request…" (trace it through the boxes).
- "This box is a single point of failure for now; I'll come back to it in step 6."

**Questions to ask yourself.**

- Which requests stop at the edge (CDN, cache) and which reach the services?
- What is synchronous (user waits) and what goes behind a queue?
- Where is the source of truth of each entity?

```text
HIGH-LEVEL CHECKLIST
[ ] Clients -> DNS -> CDN (static, cacheable pages)
[ ] Edge: WAF / API gateway (auth, rate limit) -> load balancer
[ ] Stateless services (which ones? what does each own?)
[ ] Source of truth per entity (SQL / NoSQL / object store)
[ ] Caches (what, where, TTL)
[ ] Async: queue / event stream, consumers, what is eventual
[ ] External dependencies (payment, email, 3rd party)
[ ] One read and one write traced through the diagram
```

!!! warning "Common mistakes"
    - Twenty boxes with unlabeled arrows. Every arrow says what flows on it.
    - Naming products instead of roles ("Kafka" before you said why you need an event log).
    - Hiding state in "stateless" app servers (sessions in memory).
    - Polishing one box before the whole flow works.

!!! example "BoxOffice flash sale — step 4"
    Fans → DNS → **CDN** for the event page and assets → **WAF** (bots) → **API gateway** (JWT auth, per-user rate limit) → load balancer → stateless services: `catalog` (events, behind a **cache**), `inventory` (seats, in **PostgreSQL**), `order`, `payment` (adapter to the external provider), `notification` (email, behind a **queue**). The `order` service publishes `OrderConfirmed` to **Kafka** through an outbox; `notification`, `search` and `analytics` consume it. *Read path:* the seat map comes from a cache refreshed every second. *Write path:* `POST /holds` goes to `inventory`, which updates the seat rows atomically.

---

## 5. Deep dives

**Goal.** Show depth where the problem is hard. Pick one or two components (or let the interviewer pick), and go into algorithms, data layout, consistency, failure handling and numbers. This is where most of the evaluation happens.

**What to say.**

- "The hard part of this problem is…, so I'd like to go deep there. Does that sound good?"
- "There are three ways to do this: … I'd pick the second because…"
- "Let me check that with numbers: …"

**Questions to ask yourself.**

- Where is the contention, the fan-out, the hot key or the consistency boundary?
- What happens under the peak load, with a slow dependency, with a retry, with a crash mid-operation?
- How would you know it works (metrics, a load test)?

```text
DEEP-DIVE CHECKLIST (for the chosen component)
[ ] Why this is the hard part (number from step 2)
[ ] 2-3 options, with the trade-off of each
[ ] Chosen option: algorithm / data layout / keys
[ ] Consistency: what is atomic, what is eventual, how conflicts are prevented
[ ] Capacity: load vs capacity, utilization below the knee
[ ] Failure: slow dependency, crash midway, duplicate request, hot key
[ ] Observability: the metric / trace that proves it works
```

!!! warning "Common mistakes"
    - Going deep on the easy part (the frontend, the login page).
    - Listing options without choosing one.
    - A deep dive with no failure analysis: "what if this node dies?" is always coming.
    - Ignoring the interviewer's hint toward a specific component.

!!! example "BoxOffice flash sale — step 5"
    **Deep dive 1 — never sell a seat twice.** Options: (a) read the status in the app, then write — a race; (b) `SELECT … FOR UPDATE` in a transaction — correct, but holds row locks while the transaction is open; (c) one atomic conditional update: `UPDATE seat SET status='held', hold_until=now()+interval '10 min', order_id=? WHERE event_id=? AND seat_id=? AND status='free'` — 1 row updated means the fan got it, 0 means someone else did. Choose (c): short, lock held only for the statement, and the database enforces the invariant. An expiry job releases holds whose `hold_until` passed. Never keep a transaction open while calling the payment provider.

    **Deep dive 2 — survive 10:00.** A **virtual waiting room**: fans who arrive get a position (random among those present at 10:00, then arrival order), and the gateway admits them at the rate `inventory` sustains — say 2,000 per minute — issuing a signed, short-lived admission token required by `POST /holds`. Little's Law sizes it: 2,000 admitted/min with ~5 min in the purchase flow ⇒ ~10,000 fans inside at once. The queue turns a spike of 10⁵ req/s into a steady flow the database can handle; the cost is waiting time, shown honestly with the position in line.

---

## 6. Bottlenecks and trade-offs

**Goal.** Step back and stress the design: what breaks first at 10× the load, where the single points of failure are, what you traded and how you would observe and test it. This is where you show judgment.

**What to say.**

- "At ten times the load, the first thing to break is…, because…"
- "I chose X over Y because…; the cost is…; I'd revisit if…"
- "To be confident, I'd load-test with a spike profile and watch…"

**Questions to ask yourself.**

- Which component is closest to its limit (utilization near the knee)? Which is a single point of failure?
- What happens when each external dependency is slow or down?
- Which consistency did you relax, and what does the user see because of it?
- How much does it cost, roughly? What would you monitor (SLIs) and alert on?

```text
TRADE-OFF STATEMENT
We chose <X> over <Y>
because <requirement / number from steps 1-2>.
The cost is <latency / consistency / money / complexity>,
which is acceptable because <...>.
We would revisit it if <condition>.

BOTTLENECK SWEEP
First to break at 10x: ...      fix: ...
Single points of failure: ...   fix: ...
Slow/down dependency: ...       containment: timeout / breaker / queue / fallback
Observability: SLIs = ...       alert on: burn rate of ...
How we'd test it: load profile ... / chaos experiment ...
```

!!! warning "Common mistakes"
    - "It scales" without saying what, to how much, and at what cost.
    - Presenting a design with no weaknesses — every design has some; naming them is the signal.
    - Forgetting operations: deploys, monitoring, on-call, cost.
    - Getting defensive when the interviewer finds a flaw. Say "good point" and adapt.

!!! example "BoxOffice flash sale — step 6"
    - **First to break:** the payment provider at 10:00 (external quota, latency spikes) → timeout, circuit breaker, a `PENDING` order state with the seat hold extended; the waiting room admits fewer fans if the provider slows.
    - **Single points of failure:** the PostgreSQL primary → synchronous standby in another AZ with automatic failover; Redis → replicated, and the seat map can fall back to a slightly older copy.
    - **Trade-offs:** strong consistency only for seats and orders, eventual for everything else; the waiting room trades user patience for a system that stays up; the seat map may show a seat as free that is already held (the hold call is the authority).
    - **Proof:** a k6 spike test to the expected peak and a game day where the payment provider slows down; SLIs: hold success rate and p99, checkout availability; burn-rate alerts on checkout.

---

## 7. Wrap-up

**Goal.** Leave a clear picture: a short summary, the key trade-offs, and what you would do with more time. End on time.

**What to say.**

- "To summarize: …"
- "The two decisions I'd defend most are… and the main risk is…"
- "With more time I'd look at…"

```text
WRAP-UP (4 sentences + next steps)
1. The problem in one line and the hard part: ...
2. The design in one line (edge -> services -> storage -> async): ...
3. The key decisions and their trade-offs: ...
4. The main risk and how we contain it: ...
Next with more time: multi-region / cost / abuse & security / analytics / evolution
```

!!! warning "Common mistakes"
    - Running out of time with no summary.
    - Introducing new components in the last two minutes.
    - Repeating the whole walkthrough instead of the decisions.

!!! example "BoxOffice flash sale — step 7"
    "We built a ticketing flow for a stadium show where 2 million fans compete for 60,000 seats at 10:00. The CDN and caches absorb the read spike, a waiting room turns the crowd into a steady flow, and seat holds are atomic conditional updates in PostgreSQL, so a seat is never sold twice. Payment goes through an idempotent adapter with timeouts and a circuit breaker, and confirmation flows asynchronously through an outbox and Kafka to email and analytics. The main risk is the payment provider at peak; with more time I'd add a second provider, a second region for the read path and a bot-scoring model in the WAF."

### The final architecture

``` diagram
flowchart LR
    F[Fans: web & mobile] --> DNS --> CDN[CDN: event page, assets]
    CDN --> WAF[WAF + bot protection]
    WAF --> GW[API Gateway: JWT, rate limit, waiting room admission]
    GW --> WR[(Waiting room queue)]
    GW --> LB[Load Balancer]
    LB --> CAT[catalog]
    LB --> INV[inventory]
    LB --> ORD[order]
    CAT --> C[(Cache: events, seat map)]
    C --> DB[(PostgreSQL: seats, orders)]
    INV --> DB
    ORD --> DB
    ORD --> PAY[payment adapter] --> PSP[Payment provider]
    PSP -.webhook.-> PAY
    ORD -->|outbox| K[Kafka]
    K --> NOT[notification] --> EM[Email provider]
    K --> AN[analytics]
    K --> SR[search]
```

---

## Rehearse in the playground

Reading the framework is not the same as running it under pressure. The playground has a flash sale preloaded — a limited-stock product launch, BoxOffice's 10:00 on-sale in generic form: when the sale opens, traffic jumps 20× and the initial design (`users` → load balancer → `app` → `inventory-db`, plus the `payment provider`) fails in an instructive way.

!!! question "Try it"
    Run the scenario as loaded (the sale opens at t = 60 s) and watch which node turns red first. Then apply the moves from step 5 one at a time — serve the reads from a CDN and a cache in front of `inventory-db`, send the writes through an API gateway into a waiting-room queue drained by workers below the payment provider's quota (500 req/s), protect the payment edge with a timeout and a circuit breaker — and run again after each change. Say out loud, as in an interview, which number each change improved (p99, error rate, consumer lag, cost).

<div class="sdp" data-scenario="flash-sale" data-mode="compact" data-height="520"></div>

## Where to go next

- Practice the framework on the [practice problems](../problems/index.md), from warm-up to advanced.
- Run it with a classmate using the [mock interview protocol](../mock/index.md) and its rubric.
- Review the numbers and one-liners in the [quick reference](../quick-reference/index.md).
- Read the full worked solution in the [ticketing case study](../../../classes/case-studies/ticketing/index.md) and the framework's class page, [Class 1 · Interview framework](../../../classes/intro/interview-framework/index.md).
