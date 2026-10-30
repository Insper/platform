
> *"Design a ticketing platform like Ticketmaster. A stadium show goes on sale at 10:00: two million fans, sixty thousand seats. Nobody may get the same seat twice."*

This is the flagship case of the course because it is **BoxOffice** itself, and because it packs into one problem the hardest ideas of the semester: a **spike** that is 100× the normal load and arrives in seconds, a **hot, strongly consistent** resource (the seats) that cannot be cached away, an **external dependency** (the payment provider) that is slow and occasionally down, and **adversarial traffic** (bots and scalpers). Most of the system is a boring read-heavy catalog; the interview is decided in the ten minutes after 10:00.

| | |
|---|---|
| **Difficulty** | :material-star::material-star::material-star: hard (senior favorite) |
| **Key concepts** | waiting room / virtual queue, admission control with Little's Law, seat holds with TTL, concurrency control (pessimistic, optimistic, conditional update), idempotency, order state machine, payment webhooks |
| **Palette components** | [`cdn`](../../../reference/components/edge/index.md#cdn), [`waf`](../../../reference/components/edge/index.md#waf), [`apigw`](../../../reference/components/edge/index.md#apigw), [`queue`](../../../reference/components/messaging/index.md#queue), [`app`](../../../reference/components/compute/index.md#app), [`sql`](../../../reference/components/storage/index.md#sql), [`cache`](../../../reference/components/storage/index.md#cache), [`scheduler`](../../../reference/components/compute/index.md#scheduler), [`kafka`](../../../reference/components/messaging/index.md#kafka), [`payment`](../../../reference/components/external/index.md#payment), [`notifications`](../../../reference/components/compute/index.md#notifications), [`email`](../../../reference/components/external/index.md#email) |
| **Playground scenario** | `flash-sale` |

!!! abstract "What this case trains"

    - **Estimate** the arrival rate of an on-sale and **derive** the admission rate of a waiting room with Little's Law.
    - **Design** seat holds that never double-book, and **compare** pessimistic locking, optimistic locking and conditional updates.
    - **Model** the checkout as a state machine that survives payment timeouts, retries and late webhooks.
    - **Identify** the bottlenecks of a flash sale (hot rows, connection pools, the payment provider, bots) and **defend** the trade-offs (fairness vs. throughput, user experience vs. consistency).

---

## 1. Clarify the requirements

Spend the first five minutes here (see the [interview framework](../../intro/interview-framework/index.md)). A ticketing system can mean "a box office for a theater with 300 seats" or "the Eras Tour on-sale": the answers below change the design completely.

### Functional requirements

1. Fans browse events and venues (catalog) and see the **seat map** with live availability.
2. A fan selects seats and gets a **hold**: the seats are reserved for them for a few minutes (e.g. 10 min) while they pay.
3. The fan **pays** through an external payment provider; on success the order is confirmed and the tickets are issued (e-mail + app).
4. Unpaid holds **expire** and the seats return to sale.
5. During high-demand on-sales, fans wait in a **waiting room** and are admitted in order.

### Non-functional requirements

| Quality | Target (state it, the interviewer will push on it) |
|---|---|
| **Correctness** | **Zero double booking.** A seat is sold at most once — strong consistency on the inventory. |
| **Scalability** | Absorb 2 M fans arriving within ~2 minutes without collapsing; normal days are ~100× quieter. |
| **Latency** | Hold a seat in p99 < 300 ms for admitted fans; catalog pages p99 < 200 ms. |
| **Availability** | 99.95% for browse and checkout; the waiting room must stay up even if the backend is saturated (it is the shock absorber). |
| **Fairness** | First-come-first-served (or a declared lottery), with per-account limits; bots must not win. |
| **Durability** | A confirmed order is never lost (payment taken ⇒ ticket exists). |

### Out of scope (say it explicitly)

Event creation by promoters, dynamic pricing, resale marketplace, physical ticket scanning at the gate, refunds. Mention them in one sentence and move on.

??? question "Questions to ask the interviewer"

    | Question | Why it matters |
    |---|---|
    | Reserved seats or general admission (GA)? | Reserved seats = many rows with low contention each; GA = **one hot counter**. Different concurrency designs. |
    | How big is the biggest on-sale? Do several happen at once? | Sizes the waiting room and tells whether to partition by event. |
    | Can a fan pick the exact seat, or do we assign "best available"? | "Best available" lets the server batch and avoid conflicts. |
    | How long is a hold? Max tickets per account? | Hold TTL and limits drive Little's Law and fairness. |
    | Do we own payments or use a provider (Stripe, Adyen, Mercado Pago…)? | External provider ⇒ webhooks, idempotency, reconciliation. |
    | Is the waiting room FIFO or a randomized lottery for early arrivals? | Fairness policy; FIFO rewards bots with fast networks. |

---

## 2. Back-of-the-envelope estimates

The numbers are what make this problem interesting: the **total** work is tiny (60 k seats fit in a few megabytes), but the **peak** is brutal. State the assumptions, then compute. The block below is the estimate as code — open the *Source* tab, change an assumption and redo it on paper.

```python exec="1" source="tabbed-right"
# BoxOffice flash sale: assumptions (illustrative, change them freely)
fans        = 2_000_000   # fans who show up for the on-sale
arrival_s   = 120         # most of them arrive within ~2 min of 10:00
seats       = 60_000
per_order   = 2           # tickets per order (average)
checkout_s  = 300         # time an admitted fan spends choosing + paying
active_cap  = 10_000      # shoppers the inventory + payment path can serve at once
conversion  = 0.6         # admitted fans who end up buying
poll_s      = 10          # waiting-room status refresh interval
page_kb     = 100         # waiting-room page + assets
psp_s       = 2.0         # payment provider latency

orders       = seats / per_order
join_rate    = fans / arrival_s                 # joins per second at the door
no_queue_rps = fans * 5 / 60                    # 5 requests/fan in the 1st minute, no queue
naive_poll   = fans / poll_s                    # status polls if all hit the origin
admit_rate   = active_cap / checkout_s          # Little's Law: L = λ·W  →  λ = L / W
admits       = orders / conversion
sellout_min  = admits / admit_rate / 60
order_rate   = admit_rate * conversion
pay_inflight = order_rate * psp_s               # Little's Law again
seat_map_rps = active_cap / 3                   # each shopper refreshes the map every 3 s
edge_gb      = fans * page_kb / 1e6
inventory_mb = seats * 100 / 1e6                # ~100 B per seat row

rows = [
    ("orders", orders, ""), ("join_rate", join_rate, "req/s"),
    ("no_queue_rps", no_queue_rps, "req/s"), ("naive_poll", naive_poll, "req/s"),
    ("admit_rate", admit_rate, "fans/s"), ("admits", admits, "fans"),
    ("sellout_min", sellout_min, "min"), ("order_rate", order_rate, "orders/s"),
    ("pay_inflight", pay_inflight, "calls"), ("seat_map_rps", seat_map_rps, "req/s"),
    ("edge_gb", edge_gb, "GB"), ("inventory_mb", inventory_mb, "MB"),
]
print("| quantity | value | unit |\n|---|---:|---|")
for name, value, unit in rows:
    v = f"{value:,.0f}" if abs(value) >= 100 else f"{value:,.2f}"
    print(f"| `{name}` | {v} | {unit} |")
```

What the numbers tell us — this paragraph is the part the interviewer is listening for:

- **Without a waiting room** the inventory would see ~170 k requests/s for a minute. A single PostgreSQL primary does a few thousand small write transactions per second; no amount of app servers fixes that, because the bottleneck is a handful of **hot rows**. ⇒ we need **admission control**.
- With 10 k concurrent shoppers and 5 minutes each, Little's Law gives an admission rate of **~33 fans/s (2 000/min)**, a sell-out in **~25 minutes** and only **~20 orders/s** — easy for one well-indexed database.
- The waiting room itself must take **~17 k joins/s** and, if everybody polls the origin, **200 k polls/s**. ⇒ serve the page from the **CDN** and make the status endpoint cheap (a signed token + a single counter read, cacheable for a second).
- About **40 payment calls are in flight** at any time (20/s × 2 s). ⇒ size the connection pool and bulkhead of the payment adapter for that, not for the 2 M fans.
- The entire inventory is **~6 MB**: storage is not a problem; **contention** is.

---

## 3. API

Keep it short and resource-oriented; the interesting fields are the **tokens** and the **idempotency key**.

```http
POST /v1/events/{eventId}/queue                      → 201 {queueToken, position, etaSeconds}
GET  /v1/queue/{queueToken}                          → 200 {status: WAITING|ADMITTED, position, accessToken?}

GET  /v1/events/{eventId}                            → 200 event, venue, price levels   (CDN, minutes)
GET  /v1/events/{eventId}/availability?section=A     → 200 {seatsBitmap, version}      (cache, 1 s)

POST /v1/events/{eventId}/holds                      → 201 {holdId, seats, expiresAt} | 409 SEAT_TAKEN
     Authorization: Bearer <accessToken>
     Idempotency-Key: 7f3c…
     {"seatIds": ["A-12-07", "A-12-08"]}
DELETE /v1/holds/{holdId}                            → 204

POST /v1/orders                                      → 202 {orderId, status: PENDING_PAYMENT, paymentUrl}
     Idempotency-Key: 9a41…
     {"holdId": "…"}
GET  /v1/orders/{orderId}                            → 200 {status: CONFIRMED|PENDING_PAYMENT|EXPIRED|FAILED}

POST /v1/webhooks/payments                           ← provider callback, signed (HMAC)
```

- The **`accessToken`** is what the waiting room hands out: a short-lived signed token (e.g. a JWT with `eventId`, `userId`, `exp` = 15 min). The gateway rejects hold/order calls without a valid one, so nobody can skip the queue by calling the API directly.
- **`Idempotency-Key`** on holds and orders: mobile networks retry, users double-click; the server stores the key with the response and replays it instead of creating a second hold or order.
- `POST /v1/orders` returns **202 Accepted**: payment is asynchronous; the client polls the order (or gets a push) until it is `CONFIRMED`.

---

## 4. Data model

The inventory is small, relational and needs transactions ⇒ **SQL** ([PostgreSQL](../../databases/transactions/index.md)), partitioned by `event_id` if there are many events. The catalog is read-mostly and can live in the same database behind a cache, or in a document store.

```sql
CREATE TABLE seat (
    event_id     BIGINT      NOT NULL,
    seat_id      TEXT        NOT NULL,             -- 'A-12-07' (section-row-number)
    section      TEXT        NOT NULL,
    price_cents  INT         NOT NULL,
    status       TEXT        NOT NULL DEFAULT 'AVAILABLE',  -- AVAILABLE | HELD | SOLD
    hold_id      UUID,
    held_until   TIMESTAMPTZ,
    version      INT         NOT NULL DEFAULT 0,
    PRIMARY KEY (event_id, seat_id)
);

CREATE TABLE hold (
    hold_id      UUID PRIMARY KEY,
    event_id     BIGINT      NOT NULL,
    user_id      BIGINT      NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    status       TEXT        NOT NULL               -- ACTIVE | CONVERTED | EXPIRED | RELEASED
);

CREATE TABLE ticket_order (
    order_id        UUID PRIMARY KEY,
    hold_id         UUID UNIQUE NOT NULL,           -- one order per hold
    user_id         BIGINT NOT NULL,
    total_cents     INT    NOT NULL,
    status          TEXT   NOT NULL,                -- PENDING_PAYMENT | CONFIRMED | FAILED | EXPIRED
    payment_ref     TEXT,                           -- provider's id
    idempotency_key TEXT UNIQUE NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE outbox (                               -- transactional outbox → Kafka
    id BIGSERIAL PRIMARY KEY, topic TEXT, payload JSONB, created_at TIMESTAMPTZ DEFAULT now()
);
```

| Data | Store | Why |
|---|---|---|
| Seats, holds, orders | SQL (`sql`) | Transactions, unique constraints, conditional updates. Tiny volume, high contention. |
| Waiting-room queue | Redis sorted set or a managed queue (`queue`) | Millions of entries, O(log n) position lookups, disposable after the sale. |
| Availability snapshot | Cache (`cache`), 1 s TTL | 3 k reads/s per hot event; slightly stale is fine — the hold is the real check. |
| Event pages, images | CDN (`cdn`) + object store | Static, identical for everybody. |
| Order events | Kafka (`kafka`) via outbox | Fan-out to notification, analytics, fraud — off the critical path. |

---

## 5. High-level design

Read the diagram as two paths. The **cheap path** (catalog, waiting page, availability) is served by the CDN and caches and never touches the hot rows. The **expensive path** (hold → order → payment) is protected by the waiting room, which lets in only what the database and the payment provider can take.

``` diagram-sim
flowchart LR
    fan([Fan / mobile]) --> cdn["CDN<br/>event pages, waiting page"]
    cdn --> waf["WAF<br/>bots, DDoS"]
    waf --> gw["API Gateway<br/>auth, rate limit,<br/>access token check"]
    gw --> wr["Waiting room"]
    wr --> q[("Queue<br/>Redis sorted set")]
    gw --> cat["catalog"]
    cat --> cache[("Cache<br/>availability 1 s")]
    gw --> inv["inventory<br/>holds"]
    inv --> sql[("PostgreSQL<br/>seat, hold, order")]
    gw --> ord["order"]
    ord --> sql
    ord --> pay["payment adapter"]
    pay --> psp[["Payment provider"]]
    psp -. webhook .-> pay
    sql -. outbox .-> kafka[["Kafka<br/>order events"]]
    kafka --> notif["notification"] --> email[["E-mail / push"]]
    kafka --> an["analytics"]
    sched["scheduler<br/>expire holds"] --> sql
```

The happy path of one fan, step by step:

``` diagram-sim
sequenceDiagram
    autonumber
    participant F as Fan
    participant W as Waiting room
    participant I as inventory
    participant O as order
    participant P as Payment provider
    participant N as notification
    F->>W: join (10:00:03)
    W-->>F: queueToken, position 48 210
    F->>W: poll status (every 10 s, cached)
    W-->>F: ADMITTED + accessToken (15 min)
    F->>I: POST /holds {A-12-07, A-12-08} + accessToken
    I->>I: conditional UPDATE (both seats or none)
    I-->>F: 201 holdId, expiresAt = now + 10 min
    F->>O: POST /orders {holdId} + Idempotency-Key
    O->>P: create payment (idempotency key = orderId)
    O-->>F: 202 PENDING_PAYMENT, paymentUrl
    P-->>O: webhook: payment succeeded
    O->>O: seats SOLD, order CONFIRMED, outbox row (one transaction)
    O-)N: OrderConfirmed (Kafka)
    N-->>F: e-mail + push with tickets
```

!!! example "In the BoxOffice code: where each box of this design lives"

    This case is BoxOffice, and the labs built most of its boxes. The labs build a simpler checkout than section 6.3 — payment is a synchronous call with a timeout and a circuit breaker, not a webhook state machine — but every other row is the real mechanism. Read the files in this order and you have read the design:

    | Component | Lab | File to read first |
    |---|---|---|
    | Edge: load balancing, rate limit per key | [Lab 3](../../../hands-on/3/index.md) | `infra/nginx/nginx.conf` |
    | API gateway: the token is checked once | [Lab 4](../../../hands-on/4/gateway/index.md) | `SecurityConfig.java` (gateway) |
    | Catalog read path: cache-aside, stampede lock | [Lab 5](../../../hands-on/5/cache-aside/index.md) | `EventCache.java` |
    | Seat holds without double booking | [Lab 6](../../../hands-on/6/holds/index.md) | `HoldService.java` |
    | Order event in the same transaction (outbox) | [Lab 7](../../../hands-on/7/outbox/index.md) | `Outbox.java`, `OutboxRelay.java` |
    | Waiting room | [Lab 7](../../../hands-on/7/waiting-room/index.md) | `WaitingRoom.java` |
    | Idempotent notification consumer, DLT | [Lab 7](../../../hands-on/7/consumer/index.md) | `NotificationService.java`, `KafkaConfig.java` |
    | SLOs and burn-rate alerts | [Lab 8](../../../hands-on/8/slo/index.md) | `slo-catalog.yaml` |
    | Payment: timeout, retry, circuit breaker, idempotency | [Lab 9](../../../hands-on/9/patterns/index.md) | `PaymentClient.java`, `PaymentService.java` |
    | Scale before 10:00 | [Lab 10](../../../hands-on/10/autoscaling/index.md) | `catalog-hpa.yaml` |
    | Canary and the performance gate | [Lab 11](../../../hands-on/11/canary/index.md) | `catalog-rollout.yaml`, `load/budget.js` |
    | Support assistant | [Lab 12](../../../hands-on/12/tools/index.md) | `agent.py`, `tools.py` |

---

## 6. Deep dives

The interviewer will pick one or two of these. Lead with the one that protects **correctness** (holds), then the one that protects **availability** (the waiting room).

### 6.1 Seat holds without double booking

Two fans click seat A-12-07 in the same millisecond. Exactly one must win. There are four classic ways to guarantee it ([transactions & isolation](../../databases/transactions/index.md)):

=== "Conditional update (recommended)"

    One statement, atomic per row, no explicit lock held across a round trip. Expired holds are reclaimed in the same statement (**lazy expiration**).

    ```sql
    BEGIN;
    UPDATE seat
       SET status = 'HELD', hold_id = $1, held_until = now() + interval '10 minutes',
           version = version + 1
     WHERE event_id = $2
       AND seat_id = ANY($3)
       AND (status = 'AVAILABLE' OR (status = 'HELD' AND held_until < now()));
    -- the app checks: rows updated == number of seats requested, otherwise ROLLBACK → 409
    INSERT INTO hold (hold_id, event_id, user_id, expires_at, status)
         VALUES ($1, $2, $4, now() + interval '10 minutes', 'ACTIVE');
    COMMIT;
    ```

=== "Pessimistic lock"

    Lock the rows, check, then update. Simple to reason about; the lock is held for the whole transaction, so keep it short and **always lock in the same order** (sort `seat_id`) to avoid deadlocks.

    ```sql
    BEGIN;
    SELECT seat_id, status, held_until FROM seat
     WHERE event_id = $1 AND seat_id = ANY($2)
     ORDER BY seat_id
       FOR UPDATE;            -- NOWAIT or SKIP LOCKED for "best available"
    -- app checks every row is free, then UPDATE ... ; COMMIT
    ```

=== "Optimistic lock"

    Read without locking, write only if the `version` did not change. No lock waits, but under heavy contention most attempts fail and retry — bad for the hottest seats.

    ```sql
    UPDATE seat SET status = 'HELD', hold_id = $1, version = version + 1
     WHERE event_id = $2 AND seat_id = $3 AND version = $4;   -- 0 rows → somebody won, retry
    ```

=== "Redis first, SQL as truth"

    `SET hold:{event}:{seat} <holdId> NX EX 600` in Redis gives a sub-millisecond, self-expiring hold; the order is still written in SQL with a `UNIQUE (event_id, seat_id)` on sold tickets as the final guard. Faster, but two stores must agree (what if Redis fails over and loses the key?). Use when the SQL path is measured to be the bottleneck — not by default.

    ```text
    SET hold:42:A-12-07 3f9a... NX EX 600   →  OK  (you got it)  |  nil (taken)
    ```

| Approach | Contention behavior | Pitfalls | Use when |
|---|---|---|---|
| Conditional `UPDATE … WHERE status='AVAILABLE'` | Losers fail fast (0 rows) | Must check the row count | Default for reserved seats |
| `SELECT … FOR UPDATE` | Losers **wait** for the lock | Deadlocks, long lock holds, pool exhaustion | Multi-step checks in one transaction |
| Optimistic (`version`) | Losers retry | Retry storms on hot rows | Low contention (normal days) |
| Redis `SET NX EX` | Fastest, TTL built in | Two sources of truth | Extreme rates, measured need |

**Expiration.** A hold must end even if the fan closes the browser. Combine (a) **lazy expiration** in the hold statement (an expired `HELD` seat counts as available), (b) a **scheduler** job that sweeps `hold` rows with `expires_at < now()` every few seconds and flips seats back to `AVAILABLE` so the seat map is accurate, and (c) **extending** the hold while a payment is in flight, so a fan who is paying does not lose the seat at second 601.

!!! warning "General admission: the one hot row"

    With GA tickets there are no seat rows, only `remaining = 60 000`. `UPDATE pool SET remaining = remaining - 2 WHERE remaining >= 2` is correct but **serializes every buyer on one row**. Fixes: split the pool into N **sub-counters** (shards) and pick one at random; or keep the counter in Redis (`DECRBY` in a Lua script) and write orders to SQL asynchronously; or **pre-allocate** the stock into the waiting room tokens (each admitted fan carries the right to buy up to 4).

### 6.2 The waiting room (virtual queue)

The waiting room is **load shedding with good manners**: instead of letting 2 M requests hit the inventory and fail randomly, it turns the burst into a **steady, measured flow** and tells each fan where they stand.

``` diagram-sim
flowchart LR
    j["Fans join<br/>~17 k/s"] --> rq[("Queue<br/>sorted by<br/>random or arrival")]
    rq --> d{"Admitter<br/>every second"}
    d -->|"admit λ = L / W<br/>≈ 33 fans/s"| tok["accessToken<br/>(signed, 15 min)"]
    tok --> shop["Shopping<br/>≤ 10 k at once"]
    shop -->|"buys or times out"| out([leaves])
    out -. frees a slot .-> d
```

Design points:

1. **Static page on the CDN.** The waiting page is HTML + JS cached at the edge; the only dynamic call is the status poll, answered from Redis (`ZRANK` for the position) or from a cached "now serving number" — the client compares it with its own number, so the origin answers one value for everybody.
2. **Admission rate from Little's Law.** The admitter lets in `λ = L / W` fans per second, where `L` is the number of shoppers the checkout path can serve (measured in the load test, e.g. 10 k) and `W` the time each spends (5 min). It is a **closed loop**: admit more when shoppers leave early, admit fewer when p99 of `POST /holds` rises or the payment provider slows down.
3. **Fairness.** Pure FIFO rewards whoever has the fastest connection — usually bots. A common policy: everyone who arrives **before** 10:00 gets a **random** position at 10:00 (a lottery), and late arrivals go to the back in FIFO order.
4. **Tokens, not sessions.** Admission produces a signed `accessToken` (event, user, expiry). The gateway verifies the signature locally — no shared session store on the hot path — and enforces "max 6 tickets per account".
5. **Bots.** The [WAF](../../edge/index.md) does bot scoring, rate limits per IP/ASN and challenges; requiring a logged-in, verified account to join is the strongest filter. Queue-it, Cloudflare Waiting Room and the AWS Virtual Waiting Room solution are real products built on these ideas.

!!! example "Why not just autoscale?"

    App servers scale in a minute or two; the **seat rows** do not scale at all — there is one row per seat and the best seats are wanted by everybody. The database primary, the connection pool and the payment provider's rate limit are fixed for the next 30 minutes. Autoscaling helps the cheap path (catalog, waiting room); the expensive path needs **admission control**.

### 6.3 Checkout and payment: a state machine, not a function call

A payment provider answers in seconds, times out, and sometimes calls you back **before** your HTTP request returns. Model the order as a state machine whose transitions are idempotent ([integrations](../../compute/integrations/index.md), [payment system case](../payment-system/index.md)).

``` diagram-sim
stateDiagram-v2
    [*] --> HELD: POST /holds
    HELD --> PENDING_PAYMENT: POST /orders (extend hold)
    HELD --> EXPIRED: TTL (10 min) elapses
    PENDING_PAYMENT --> CONFIRMED: webhook succeeded
    PENDING_PAYMENT --> FAILED: webhook failed / declined
    PENDING_PAYMENT --> CONFIRMED: reconciliation finds payment
    FAILED --> HELD: retry with another card (hold still valid)
    EXPIRED --> [*]
    CONFIRMED --> [*]
```

- **Idempotency key to the provider** = `orderId`. If the adapter times out and retries, the provider returns the same payment instead of charging twice.
- **Webhooks are the source of truth** for the outcome; they are signed (HMAC), may arrive twice or out of order, so the handler is `UPDATE ticket_order SET status='CONFIRMED' WHERE order_id=$1 AND status='PENDING_PAYMENT'` — a second delivery changes nothing.
- **Confirm in one transaction**: seats `HELD → SOLD`, order `CONFIRMED`, an `outbox` row. A relay publishes the outbox to Kafka; `notification` consumes it **idempotently** (dedupe by `orderId`) and sends the e-mail ([messaging patterns](../../messaging/patterns/index.md)).
- **Reconciliation.** A scheduler job lists `PENDING_PAYMENT` orders older than N minutes and asks the provider for their status. This fixes lost webhooks — and the nasty case "payment succeeded **after** the hold expired": either the seats are still free (confirm) or they were resold (refund automatically and apologize).
- **Resilience.** Timeout + circuit breaker + bulkhead around the provider ([reliability patterns](../../reliability/patterns/index.md)); if the breaker is open, **stop admitting** new fans instead of letting them hold seats they cannot pay for.

### 6.4 The read path: seat map and catalog

Fans hammer the seat map. Serving it from the `seat` table would put reads on the same hot rows as the holds.

- Keep a per-section **availability bitmap** (one bit per seat — 60 k seats = 7.5 kB) in the cache, rebuilt every second from the database or updated from hold/sold events. Clients poll it (or receive it via SSE) with a `version` number.
- Accept **staleness**: the map may show a seat as free that was taken 800 ms ago. The hold request is the real check; return `409 SEAT_TAKEN` with the fresh bitmap so the UI updates.
- **Pre-warm** the CDN and the cache before 10:00 (event page, images, bitmaps): a cold cache at the moment of the spike is a self-inflicted stampede ([caching failure modes](../../caching/failure-modes/index.md)).
- Offer **"best available"**: the server picks seats with `FOR UPDATE SKIP LOCKED`, so concurrent buyers never wait on each other's rows.

---

## 7. Bottlenecks, failure modes and trade-offs

| Where | What goes wrong at 10:00 | Mitigation | Trade-off |
|---|---|---|---|
| Inventory hot rows | Lock waits on the best sections; p99 explodes | Admission control; conditional updates; "best available" with `SKIP LOCKED`; GA counter sharding | Fans wait longer in the queue |
| DB connection pool | Requests wait for a connection, threads pile up | PgBouncer; small fixed pool sized by Little's Law; timeouts | Rejecting early (503) vs. waiting |
| Waiting-room status | 200 k polls/s on the origin | Static page on CDN; cached "now serving" number; poll interval with jitter | Position updates every 10 s, not real time |
| Payment provider | Slow (5 s) or down; its rate limit | Bulkhead + timeout + breaker; slow the admitter; extend holds while paying | Sale takes longer; some fans lose holds |
| Webhooks | Lost, duplicated, out of order | Idempotent handler; reconciliation job | Extra moving part (scheduler) |
| Mass expiry | 5 k holds expire at 10:10 together; seats flap | Jittered TTLs; release in batches; show "seats may come back" | Slightly unfair to late fans |
| Bots | Bots fill the queue and hold seats to resell | WAF bot scoring, verified accounts, per-account limits, lottery at open | Friction for real fans |
| Cold caches | Stampede on event page at 10:00:00 | Pre-warm, request coalescing, long TTL on static content | Must invalidate if the event changes |
| Single region | Region outage during the sale | Multi-AZ primary with synchronous standby; pause the sale (queue holds everyone) | Cross-region active-active inventory is much harder (consensus) |

The two trade-offs to **say out loud**: **consistency over availability for the inventory** (if the database is unreachable, stop selling; never sell from a stale replica), and **fairness and stability over raw speed** (a sale that takes 25 orderly minutes beats one that crashes at minute 2).

---

## 8. Try it in the playground

The `flash-sale` scenario replays the spike when the sale opens (our 10:00) on a design that starts **without** a waiting room: `users → lb → app → inventory-db`, with buyers calling the `payment provider` (quota 500 req/s). Its `load` profile already contains the spike — a scripted event multiplies the traffic by 20 at t = 60 s for 90 s.

!!! tip "Try it"

    1. Run it as drawn and look at the utilization of `app` and `inventory-db` and at the error rate. Raise the `app` replicas: the database and the payment quota saturate next — this is the "no waiting room" case of section 2: no amount of app servers fixes it.
    2. Follow the hints (or **Show a possible solution**): a CDN, a cache for the catalog reads, and an API Gateway that sends writes to a Message Queue — the waiting room — drained by `order` workers. Run again and compare p99, errors and the consumer lag (how long a buyer waits in line).
    3. Change the number of `order` workers: find the admission rate where the consumer lag stays under the 300 s goal without pushing the payment provider past its quota.
    4. Inject a latency degradation on the payment provider (⚡) or turn chaos to **medium**: what happens to the workers' in-flight requests (Little's Law) and to the line, and what should the admitter do?

<div class="sdp" data-scenario="flash-sale" data-mode="full" data-height="640"></div>

[Open the full playground](../../../../playground/index.md){ .md-button }

---

## 9. Follow-up questions an interviewer asks

??? question "The payment provider goes down at 10:05. What happens?"

    The circuit breaker around the payment adapter opens after a few failures; `POST /orders` answers quickly with "payments are temporarily unavailable" instead of hanging. The **admitter pauses** (no point admitting fans who cannot pay), and the holds of fans already in checkout are **extended** for the outage window so nobody loses a seat through no fault of their own. When the breaker half-opens and probes succeed, admission resumes slowly. If the outage is long, a second provider (failover) is the business decision to discuss.

??? question "How do you stop scalpers' bots?"

    Layers: (1) require a logged-in, verified account (phone/card) **before** joining the queue; (2) WAF bot scoring, device fingerprinting and challenges at the edge; (3) a **lottery** for everyone who joins before the on-sale, which removes the advantage of millisecond-fast scripts; (4) per-account and per-payment-instrument limits enforced at hold and order time; (5) post-sale analysis to cancel suspicious orders. No single layer is enough; the goal is to make bots expensive, not impossible.

??? question "Why not keep the whole inventory in Redis?"

    You can — 60 k seats are tiny — and some platforms do hold seats in memory. The cost is a second source of truth: a Redis failover can lose the last writes (asynchronous replication), so a seat could be held twice. If you do it, keep a **durable guard** in SQL (a unique constraint on `(event_id, seat_id)` for sold tickets) so the worst case is a failed checkout, never a double sale. Start with SQL and conditional updates; they handle the ~20 orders/s that admission control lets through.

??? question "The primary database fails in the middle of the sale."

    With a synchronous standby in another availability zone, failover takes seconds to a minute and loses no committed transactions (RPO = 0). During the failover, holds and orders fail; the waiting room keeps everybody in place (it does not depend on the inventory database), and the admitter pauses. Clients retry with the same idempotency keys, so no duplicate holds appear. Never fail over to an **asynchronous** replica for the inventory without accepting that recent holds may be lost.

??? question "Ten big on-sales start at 10:00 on the same day. Does the design change?"

    Partition by `event_id`: each event gets its own queue and admitter, and the inventory can be **sharded by event** (events never share seats, so there are no cross-shard transactions). The shared parts are the edge (CDN, WAF), the payment provider's global rate limit and notification capacity — allocate them per event (bulkheads) so one hot sale does not starve the others.

??? question "How do you test this before the real on-sale?"

    A load test that reproduces the **spike** (k6 with an arrival-rate executor ramping to the expected join rate in seconds), with realistic data (hot sections, 2 tickets per order) and the payment provider replaced by a stub with configurable latency ([performance engineering](../../performance/index.md)). Find the breaking point of the checkout path, then set the admission rate below it with margin. Add a chaos test: provider slow, database failover, cache flush — during the load test.

??? question "How would you show fans an accurate ETA in the queue?"

    ETA ≈ position / admission rate. Because the admission rate is adjusted dynamically, smooth it (moving average) and show a range ("about 20–30 minutes"). Also show when tickets are likely to be gone: if `remaining seats / tickets per order` is smaller than the number of fans ahead of you, tell the fan the truth early.

---

## 10. Self-assessment rubric

| Level | What the answer contains |
|---|---|
| **Junior** | Catalog + inventory + orders on an app server and a SQL database; a lock or transaction so two people cannot buy the same seat; mentions caching for the catalog. Misses the spike or tries to solve it with "more servers". |
| **Mid** | All of the above plus holds with TTL and expiration, idempotent order creation, asynchronous payment with webhooks, outbox to notifications; estimates the peak and recognizes the hot-row problem; proposes a waiting room. |
| **Senior** | Derives the admission rate with Little's Law and closes the loop on p99 and provider health; compares concurrency-control options with their contention behavior; designs the order state machine with reconciliation and the "paid after expiry" case; discusses fairness (lottery vs. FIFO), bots, GA counter sharding, failover semantics (RPO = 0 for inventory), multi-event isolation, and how to load-test it. States the CP choice for the inventory explicitly. |

**Related:** [Hands-on 6](../../../hands-on/6/index.md) (seat holds and transactions), [Hands-on 7](../../../hands-on/7/index.md) (outbox and waiting-room queue), [Hands-on 9](../../../hands-on/9/index.md) (resilience around payment), [team project](../../../exercises/project/index.md).

!!! success "Best practices"

    - **Make "one seat, one buyer" a database fact** — a conditional `UPDATE ... WHERE status = 'AVAILABLE'` or a lock, never a check in code followed by a write. In BoxOffice: [`HoldService.java`](../../../hands-on/6/holds/index.md) compares three strategies.
    - **Expire holds with a job, not when someone reads them** — seats must return to sale even if nobody looks; lab 6 frees expired holds every 5 s with `FOR UPDATE SKIP LOCKED`, so several replicas can run it.
    - **Set the admission rate from the measured knee, with margin** — admit below the throughput where p99 starts to climb, and lower it when the provider slows down.
    - **Rehearse the on-sale before the on-sale** — a spike load test with the provider stubbed and a game day with faults ([lab 9](../../../hands-on/9/index.md), [lab 11](../../../hands-on/11/performance-gate/index.md)).
    - **Cache the seat map for about a second, never the hold decision** — reads stay cheap; every decision goes to the source of truth.

---

## How it connects { #how-it-connects }

Which classes does this case test? Each branch is a class whose ideas the design relies on (blue), with the palette components where they show up (green):

``` diagram
flowchart LR
    CASE(["Ticketing (BoxOffice)"]) --> PERF["Performance<br/>Little's Law admission, spike test"]:::tech
    CASE --> EDG["Edge<br/>CDN, WAF, waiting room"]:::tech
    CASE --> DB["Databases<br/>seat holds: locks, conditional updates"]:::tech
    CASE --> CAC["Caching<br/>availability cached for 1 s"]:::tech
    CASE --> CMP["Compute<br/>checkout state machine, payment adapter"]:::tech
    CASE --> MSG["Messaging<br/>outbox, order events"]:::tech
    CASE --> REL["Reliability<br/>timeouts, retries, admission control"]:::tech
    EDG -.-> k1["cdn · waf · apigw · queue"]:::comp
    DB -.-> k2["sql · scheduler"]:::comp
    CAC -.-> k3["cache"]:::comp
    CMP -.-> k4["payment"]:::comp
    MSG -.-> k5["kafka · notifications · analytics"]:::comp
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

**Classes it tests:** [Edge](../../edge/index.md) (WAF, bots, waiting room) · [Databases — transactions](../../databases/transactions/index.md) · [Caching — failure modes](../../caching/failure-modes/index.md) · [Compute — integrations](../../compute/integrations/index.md) · [Messaging — patterns](../../messaging/patterns/index.md) · [Reliability — patterns](../../reliability/patterns/index.md) · [Performance — capacity planning](../../performance/capacity-planning/index.md) · [Hands-on 6](../../../hands-on/6/index.md), [7](../../../hands-on/7/index.md) and [9](../../../hands-on/9/index.md). **Palette components:** [`cdn`](../../../reference/components/edge/index.md#cdn) · [`waf`](../../../reference/components/edge/index.md#waf) · [`apigw`](../../../reference/components/edge/index.md#apigw) · [`queue`](../../../reference/components/messaging/index.md#queue) · [`sql`](../../../reference/components/storage/index.md#sql) · [`cache`](../../../reference/components/storage/index.md#cache) · [`kafka`](../../../reference/components/messaging/index.md#kafka) · [`scheduler`](../../../reference/components/compute/index.md#scheduler) · [`payment`](../../../reference/components/external/index.md#payment) · [`notifications`](../../../reference/components/compute/index.md#notifications) · [`analytics`](../../../reference/components/compute/index.md#analytics). **Scenarios:** `flash-sale`.

---

## References

- XU, A.; LAM, S. *System Design Interview — An Insider's Guide*, vol. 2, ch. 7 "Hotel Reservation System" (holds, concurrency, idempotency)[^1].
- KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2nd ed., chapter on transactions (lost updates, write skew, `SELECT … FOR UPDATE`)[^2].
- Idempotent APIs and keys as used by payment providers[^3].
- Load shedding and overload handling[^4].

[^1]: XU, A.; LAM, S. *System Design Interview — An Insider's Guide*, vol. 2. Byte Code LLC, 2022.
[^2]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2nd ed. O'Reilly.
[^3]: LEACH, B. [Designing robust and predictable APIs with idempotency](https://stripe.com/blog/idempotency){target="_blank"}. Stripe Blog, 2017.
[^4]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/books/){target="_blank"}, ch. 21 "Handling Overload" and ch. 22 "Addressing Cascading Failures". O'Reilly, 2016.
