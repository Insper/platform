
> *"Design the payment system of a ticketing platform. Fans pay by card or Pix through an external payment provider; promoters get paid after the show. Nobody may be charged twice, and every cent must be accounted for."*

Payments are where "eventually consistent" stops being an acceptable answer. A fan charged twice calls the bank; a promoter paid twice is money you will never see again; a ticket issued without payment is a gift. Yet the system talks to an **external provider** over an unreliable network, which means timeouts with **unknown outcomes**, duplicated webhooks and money that arrives days later in a settlement file. The interview tests whether you can turn an at-least-once world into an **exactly-once effect**, and whether you know how money is recorded: a **double-entry ledger**, not a `balance` column.

This is BoxOffice's `payment` service — the adapter behind the order flow of the [ticketing case](../ticketing/index.md). That page models the order as a state machine (`HELD → PENDING_PAYMENT → CONFIRMED`) and uses webhooks and reconciliation; this page goes one level deeper into what happens **inside** `payment`: idempotency, the ledger, the provider integration and the daily reconciliation.

| | |
|---|---|
| **Difficulty** | :material-star::material-star::material-star: hard |
| **Key concepts** | idempotency keys, exactly-once effect over at-least-once delivery, payment state machine with an `UNKNOWN` state, double-entry ledger, PSP integration (hosted page, tokenization, 3-D Secure, signed webhooks), reconciliation with settlement files, transactional outbox, retries with backoff and DLQ |
| **Palette components** | [`apigw`](../../../reference/components/edge/index.md#apigw), [`app`](../../../reference/components/compute/index.md#app), [`sql`](../../../reference/components/storage/index.md#sql), [`kafka`](../../../reference/components/messaging/index.md#kafka), [`queue`](../../../reference/components/messaging/index.md#queue), [`worker`](../../../reference/components/compute/index.md#worker), [`scheduler`](../../../reference/components/compute/index.md#scheduler), [`payment`](../../../reference/components/external/index.md#payment), [`dwh`](../../../reference/components/storage/index.md#dwh) |
| **Playground scenario** | `payment-system` |

!!! abstract "What this case trains"

    - **Explain** why "exactly-once delivery" does not exist and **build** an exactly-once *effect* from retries plus idempotency.
    - **Design** an idempotency-key store that handles concurrent duplicates, replays and changed payloads.
    - **Record** money movements in a double-entry ledger and **verify** that every transaction balances.
    - **Integrate** with a payment service provider (PSP) while staying out of most of the PCI DSS scope, and **handle** timeouts whose outcome is unknown.
    - **Design** reconciliation between the ledger and the provider's settlement reports.

---

## 1. Clarify the requirements

Payments have more hidden requirements than any other case. Ask ([interview framework](../../intro/interview-framework/index.md)).

### Functional requirements

1. **Pay-in**: charge the fan for an order (card, Pix, wallet) through an external PSP; support 3-D Secure challenges.
2. **Refunds**: full or partial, e.g. when a show is cancelled.
3. **Ledger**: record every money movement (charge, PSP fee, platform fee, promoter payable, refund, payout).
4. **Payouts**: pay promoters their share after the event (batch, out of the request path).
5. **Reconciliation**: every day, match the provider's settlement report against the ledger and flag differences.
6. Notify the order service of outcomes (confirm, fail) so tickets are issued.

### Non-functional requirements

| Quality | Target |
|---|---|
| **Correctness** | **Never charge twice** for one order; never issue a ticket without a captured payment; the ledger always balances |
| **Durability** | A recorded payment or ledger entry is never lost (RPO = 0) |
| **Auditability** | Immutable history: corrections are new entries, never updates |
| **Availability** | 99.95% for checkout; when the PSP is down, fail fast and clearly |
| **Latency** | Checkout API p99 < 1 s excluding the provider and the 3-D Secure challenge |
| **Security / compliance** | Card numbers never touch our servers (PCI DSS scope minimized); secrets in a vault; webhooks authenticated |
| **Scale** | ~300 k payments/day, peaks of ~300 payments/s during several simultaneous on-sales |

### Out of scope (say it explicitly)

Building our own card processing (we are not an acquirer), fraud models (mention a fraud check hook), multi-currency FX, invoicing and taxes, chargeback disputes in detail.

??? question "Questions to ask the interviewer"

    | Question | Why it matters |
    |---|---|
    | Do we process cards ourselves or use a PSP (Stripe, Adyen, Mercado Pago, Pagar.me…)? | A PSP with a hosted page or tokenization keeps raw card data out of our systems. |
    | Authorize and capture together, or authorize now and capture later? | Two-step capture lets us release the money if the seat hold fails. |
    | Which payment methods? Pix / boleto are asynchronous | Asynchronous methods make webhooks the only way to learn the outcome. |
    | Who gets paid, when? Platform fee? | Defines ledger accounts (promoter payable, platform revenue) and payouts. |
    | One PSP or several (failover, cost routing)? | Multiple PSPs multiply integration and reconciliation work. |
    | What is the refund policy? Partial refunds? | Refunds are ledger transactions too; partial ones need amounts per line. |

---

## 2. Back-of-the-envelope estimates

```python exec="1" source="tabbed-right"
# BoxOffice payments: assumptions (illustrative)
orders_day     = 300_000      # paid orders per day
peak_tps       = 300          # payments/s when several on-sales open at 10:00
avg_order      = 230.0        # currency units per order (tickets + fees)
psp_s          = 2.0          # provider latency for one payment call
entries_per    = 4            # ledger lines per captured payment
entry_b        = 200          # one ledger line, bytes
idem_b         = 1_000        # one idempotency record (key, hash, response)
webhooks_per   = 2            # e.g. authorized + captured
dup_rate       = 0.001        # share of payments that would be duplicated without idempotency

avg_tps        = orders_day / 86_400
inflight_peak  = peak_tps * psp_s                 # Little's Law: L = λ·W
ledger_lines   = orders_day * entries_per
ledger_gb_year = ledger_lines * entry_b * 365 / 1e9
idem_mb_day    = orders_day * idem_b / 1e6
webhooks_day   = orders_day * webhooks_per
gmv_day_m      = orders_day * avg_order / 1e6     # millions per day
dup_charges    = orders_day * dup_rate

rows = [
    ("avg_tps", avg_tps, "payments/s"), ("inflight_peak", inflight_peak, "calls"),
    ("ledger_lines", ledger_lines, "lines/day"), ("ledger_gb_year", ledger_gb_year, "GB/year"),
    ("idem_mb_day", idem_mb_day, "MB/day"), ("webhooks_day", webhooks_day, "events/day"),
    ("gmv_day_m", gmv_day_m, "M/day"), ("dup_charges", dup_charges, "charges/day"),
]
print("| quantity | value | unit |\n|---|---:|---|")
for name, value, unit in rows:
    v = f"{value:,.0f}" if abs(value) >= 100 else f"{value:,.2f}"
    print(f"| `{name}` | {v} | {unit} |")
```

What the numbers tell us:

- On average only **~3.5 payments/s**; the peak of **300/s** is set by on-sales. With a 2 s provider, **~600 calls are in flight** at the peak (Little's Law). ⇒ size the adapter's connection pool and bulkhead for that, and remember the provider has its **own rate limit**.
- The ledger grows by **1.2 M lines/day, ~88 GB/year**: a single, well-indexed **PostgreSQL** with a standby holds years of it. Payments are a **correctness** problem, not a scale problem.
- Idempotency records take **~300 MB/day**; keep them for 24 h–7 days and they fit anywhere.
- Even a 0.1% duplicate rate would mean **~300 double charges per day** — 300 angry fans and chargebacks. That is the number that justifies idempotency everywhere.
- **~69 M currency units/day** flow through the system: reconciliation differences of a fraction of a percent are still real money.

---

## 3. API

```http
POST /v1/payments                                   → 201 {paymentId, status, nextAction?}
     Idempotency-Key: order-7f3c…                    (one key per order attempt)
     {"orderId": "7f3c…", "amount": 23000, "currency": "BRL",
      "method": "card", "paymentToken": "tok_1Q…", "returnUrl": "https://…"}
     status: REQUIRES_ACTION (3-D Secure) | PROCESSING | SUCCEEDED | FAILED

GET  /v1/payments/{paymentId}                       → 200 {status, amount, refundedAmount, events[]}
POST /v1/payments/{paymentId}/refunds               → 201 {refundId, status}
     Idempotency-Key: refund-…
     {"amount": 10000, "reason": "event_cancelled"}

POST /v1/webhooks/psp                               ← provider → us, HMAC-signed
     PSP-Signature: t=1767261600,v1=5257a8…
     {"id": "evt_9a…", "type": "payment.captured", "data": {"pspPaymentId": "pi_3N…", …}}
```

- The fan's card data goes **from the browser straight to the PSP** (hosted fields or a redirect); we receive only a **token** (`paymentToken`). That is what keeps our servers out of most of the PCI DSS scope.
- `nextAction` tells the client to run the **3-D Secure** challenge with the issuing bank; the result arrives later as a webhook.
- Every mutating call takes an **`Idempotency-Key`**; webhooks carry an **event id** that we deduplicate on.

---

## 4. Data model

```sql
CREATE TABLE payment (
    payment_id      UUID PRIMARY KEY,
    order_id        UUID        NOT NULL UNIQUE,      -- one payment per order attempt
    amount_cents    BIGINT      NOT NULL,
    currency        CHAR(3)     NOT NULL,
    status          TEXT        NOT NULL,             -- CREATED | REQUIRES_ACTION | PROCESSING
                                                      -- | UNKNOWN | SUCCEEDED | FAILED | REFUNDED
    psp             TEXT        NOT NULL,
    psp_payment_id  TEXT        UNIQUE,
    version         INT         NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_key (
    key             TEXT PRIMARY KEY,
    request_hash    TEXT        NOT NULL,             -- SHA-256 of method + path + body
    status          TEXT        NOT NULL,             -- IN_PROGRESS | DONE
    response_code   INT,
    response_body   JSONB,
    locked_until    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ledger_entry (                           -- append-only: no UPDATE, no DELETE
    entry_id        BIGSERIAL PRIMARY KEY,
    txn_id          UUID        NOT NULL,             -- groups the lines of one transaction
    account         TEXT        NOT NULL,             -- 'psp_receivable', 'promoter_payable:88', …
    amount_cents    BIGINT      NOT NULL,             -- debit > 0, credit < 0
    currency        CHAR(3)     NOT NULL,
    payment_id      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE processed_webhook (event_id TEXT PRIMARY KEY, received_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE outbox (id BIGSERIAL PRIMARY KEY, topic TEXT, payload JSONB, created_at TIMESTAMPTZ DEFAULT now());
```

| Data | Store | Why |
|---|---|---|
| Payments, idempotency keys, ledger, processed webhooks | SQL (`sql`), one database | ACID transactions across payment state, ledger lines and outbox; unique constraints are the last line of defense against duplicates |
| Outcome events (`PaymentSucceeded`, `PaymentFailed`) | Kafka (`kafka`) via outbox | The order and notification services react asynchronously, never by polling the payment DB |
| Retries to the PSP, refunds, payouts | Queue (`queue`) + workers (`worker`) | Backoff, rate limits toward the provider, dead-letter queue for manual review |
| Settlement files, ledger history | Data warehouse (`dwh`) | Reconciliation queries and finance reports, off the transactional database |

---

## 5. High-level design

``` mermaid-sim
flowchart LR
    fan([Fan browser]) -->|"card data"| psp[["PSP<br/>hosted fields, 3-D Secure"]]
    fan --> gw["API gateway"]
    gw --> ord["order"]
    ord --> pay["payment service"]
    pay --> db[("PostgreSQL<br/>payment, idempotency,<br/>ledger, outbox")]
    pay -->|"charge(token, key)"| psp
    psp -. "signed webhook" .-> wh["webhook handler"]
    wh --> db
    db -. outbox relay .-> k[["Kafka<br/>payment events"]]
    k --> ord
    k --> notif["notification"]
    q[["Retry queue + DLQ"]] --> wk["workers<br/>retries, refunds, payouts"]
    pay --> q
    wk --> psp
    sched["scheduler<br/>reconciliation"] --> rec["reconciliation job"]
    psp -. "settlement file (daily)" .-> rec
    rec --> dwh[("Data warehouse")]
    rec --> db
```

A card payment with 3-D Secure, end to end:

``` mermaid-sim
sequenceDiagram
    autonumber
    participant F as Fan
    participant O as order
    participant P as payment
    participant D as PostgreSQL
    participant S as PSP
    F->>S: card data (hosted fields) → token
    F->>O: POST /orders/{id}/pay {token}
    O->>P: POST /payments (Idempotency-Key = order attempt)
    P->>D: insert idempotency key IN_PROGRESS + payment CREATED
    P->>S: create payment (idempotency key = paymentId)
    S-->>P: requires_action (3-D Secure)
    P->>D: status REQUIRES_ACTION, key DONE + stored response
    P-->>F: nextAction: 3-D Secure challenge
    F->>S: completes challenge with the bank
    S-->>P: webhook payment.captured (signed)
    P->>D: one transaction: status SUCCEEDED + 4 ledger lines + outbox
    D-)O: PaymentSucceeded (via Kafka)
    O-->>F: order CONFIRMED, tickets issued
```

---

## 6. Deep dives

### 6.1 Exactly-once effect: idempotency keys

There is no exactly-once **delivery** over a network: a request whose response was lost may or may not have been executed. What we can build is an exactly-once **effect**: the client retries until it gets an answer (at-least-once), and the server makes the operation **idempotent** — executing it twice has the same effect as once ([delivery semantics](../../messaging/semantics/index.md)).

The server-side algorithm for `POST /v1/payments` with `Idempotency-Key: K`:

``` mermaid-sim
flowchart TD
    r["Request with key K"] --> ins{"INSERT key K<br/>IN_PROGRESS<br/>(unique)"}
    ins -->|"inserted"| run["Execute: create payment,<br/>call PSP"]
    run --> save["Store response,<br/>status DONE"]
    save --> ok["Return response"]
    ins -->|"conflict"| chk{"Same request_hash?"}
    chk -->|"no"| e422["422: key reused<br/>with different body"]
    chk -->|"yes, DONE"| replay["Replay stored response"]
    chk -->|"yes, IN_PROGRESS"| e409["409: still processing,<br/>retry later"]
```

| Situation | What the server does | Why |
|---|---|---|
| First request with K | Insert `IN_PROGRESS` (unique constraint wins the race), execute, store the response | The unique insert is the lock: two concurrent duplicates cannot both execute |
| Retry of a finished request | Return the **stored** response (same status code and body) | The client cannot tell a replay from the original — that is the point |
| Retry while the first is still running | `409 Conflict` (or wait briefly) | Never run the side effect twice in parallel |
| Same K, different body | `422` | A client bug; executing it would be silently wrong |
| Crash in the middle (`IN_PROGRESS` forever) | `locked_until` expires; a recovery path checks the PSP for the payment before retrying | The PSP call may have happened — never assume it did not |

The **same idea applies outward**: our call to the PSP carries **our** idempotency key (the `paymentId`), so if the adapter times out and retries, the provider returns the existing payment instead of charging again. Stripe-style APIs accept an `Idempotency-Key` header; with providers that do not, use a unique merchant reference and **look it up before** creating a new charge.

```text
# key choice matters
Idempotency-Key: order-7f3c-attempt-1   ✔ one key per (order, attempt): a retry of the same attempt is a no-op,
                                           a new card after a decline is a new attempt
Idempotency-Key: <random per HTTP call> ✘ every retry looks new → double charge
Idempotency-Key: user-42                ✘ blocks every future purchase of that user
```

### 6.2 The unknown outcome

The adapter calls the PSP and gets a **timeout**. Was the card charged? You do not know — and this is the single most important sentence of the interview.

``` mermaid-sim
stateDiagram-v2
    [*] --> CREATED
    CREATED --> PROCESSING: call PSP
    PROCESSING --> REQUIRES_ACTION: 3-D Secure
    REQUIRES_ACTION --> PROCESSING: challenge done
    PROCESSING --> SUCCEEDED: PSP ok / webhook captured
    PROCESSING --> FAILED: declined
    PROCESSING --> UNKNOWN: timeout / 5xx
    UNKNOWN --> SUCCEEDED: status query or webhook says captured
    UNKNOWN --> FAILED: status query says not found / failed
    SUCCEEDED --> REFUNDED: refund
    SUCCEEDED --> [*]
    FAILED --> [*]
```

- Never map a timeout to `FAILED`: if the charge went through, the fan pays for nothing; if you retry with a **new** key, they pay twice.
- Keep the payment in **`UNKNOWN`** and resolve it: retry **with the same idempotency key** (safe), query the PSP by your reference, or wait for the webhook. A scheduler job sweeps payments stuck in `UNKNOWN` for more than a few minutes.
- Meanwhile the order stays `PENDING_PAYMENT` and the seat hold is **extended** (see the [ticketing state machine](../ticketing/index.md)); the fan sees "confirming your payment…".
- Timeouts on the PSP call are **long enough** for the provider's normal p99 (seconds), wrapped in a circuit breaker and a bulkhead so a slow provider cannot exhaust the payment service ([reliability patterns](../../reliability/patterns/index.md)).

### 6.3 The double-entry ledger

A `balance` column that you `UPDATE` loses history, cannot explain itself to an auditor and breaks silently under concurrent updates. Accounting solved this centuries ago: **double-entry bookkeeping**. Every transaction is a set of lines, each moving money into (debit) or out of (credit) an account, and **the lines of every transaction sum to zero**. Balances are **derived** by summing lines; nothing is ever updated or deleted — a mistake is fixed by a new, reversing transaction.

A fan buys a 200.00 ticket plus a 30.00 service fee; the PSP keeps a 2.5% fee; the promoter is paid after the show:

```python exec="1" source="tabbed-right"
# Double-entry ledger for one BoxOffice ticket sale (amounts in cents; debit > 0, credit < 0)
from collections import defaultdict

transactions = {
    "T1 capture": [                       # fan pays 230.00 through the PSP
        ("psp_receivable",   +22_425),    # PSP owes us 230.00 minus its fee
        ("psp_fees",          +575),      # 2.5% of 230.00 is our expense
        ("promoter_payable", -20_000),    # we owe the promoter the ticket price
        ("platform_revenue", -3_000),     # the service fee is ours
    ],
    "T2 settlement": [                    # PSP pays out to our bank two days later
        ("bank",             +22_425),
        ("psp_receivable",   -22_425),
    ],
    "T3 payout": [                        # after the show we pay the promoter
        ("promoter_payable", +20_000),
        ("bank",             -20_000),
    ],
}

balances = defaultdict(int)
print("| transaction | lines | sum |\n|---|---:|---:|")
for name, lines in transactions.items():
    total = sum(amount for _, amount in lines)
    assert total == 0, f"{name} does not balance"
    for account, amount in lines:
        balances[account] += amount
    print(f"| {name} | {len(lines)} | {total} |")

print("\n| account | balance |\n|---|---:|")
for account, cents in sorted(balances.items()):
    print(f"| `{account}` | {cents / 100:,.2f} |")
print(f"\nSum of all balances: {sum(balances.values())}")
```

Read the result: after the three transactions the bank holds **24.25** — exactly the platform revenue (30.00) minus the PSP fee (5.75); the receivable from the PSP and the payable to the promoter are **zero**, as they should be once settled. If any of these balances is not what the business expects, the ledger tells you **which transaction** caused it.

Engineering rules for the ledger:

- **Append-only** at the database level (revoke `UPDATE`/`DELETE` for the application role). Refunds and corrections are new transactions.
- **Write all lines of a transaction in one database transaction**, together with the payment state change and the outbox row. Check the zero-sum invariant in code and with a periodic query (`SELECT txn_id FROM ledger_entry GROUP BY txn_id HAVING sum(amount_cents) <> 0` must return nothing).
- **Integer minor units** (cents) and an explicit currency — never floating point for money.
- Account **per counterparty** where needed (`promoter_payable:88`) so the payout job knows what each promoter is owed.

### 6.4 Webhooks, outbox and reconciliation

**Webhooks** are how asynchronous methods (Pix, 3-D Secure, bank transfers) report outcomes. The handler must:

1. **Verify the signature** (HMAC over timestamp + body with a shared secret) and reject old timestamps — otherwise anyone can POST "payment succeeded".
2. **Deduplicate** on the provider's event id (`INSERT INTO processed_webhook … ON CONFLICT DO NOTHING`): providers deliver at least once.
3. Apply the change as a **conditional transition** (`… WHERE status IN ('PROCESSING','UNKNOWN')`), so out-of-order events (a `failed` after a `captured`) cannot move the state backwards.
4. Return `2xx` quickly and do heavy work asynchronously; a slow handler makes the provider retry, multiplying load.

**Outbox.** The payment state, ledger lines and an `outbox` row are committed together; a relay publishes the outbox to Kafka. The order service never learns about a payment that was rolled back, and never misses one that was committed ([messaging patterns](../../messaging/patterns/index.md)).

**Reconciliation** is the safety net for everything above. Once a day the PSP publishes a **settlement report** (every captured payment, refund, fee and payout). A scheduled job loads it into the warehouse and matches it, line by line, against the ledger:

| Mismatch | Likely cause | Action |
|---|---|---|
| In PSP report, not in our ledger | Lost webhook; payment stuck in `UNKNOWN` | Create the missing transaction; confirm or refund the order |
| In our ledger, not in PSP report | Recorded success that never captured; timing (cut-off) | Re-check next day; then investigate and reverse |
| Amounts differ | Fees changed, partial capture, currency rounding | Adjusting transaction + alert finance |
| Duplicate charge in PSP report | Idempotency bug | Refund immediately; postmortem |

Retries toward the provider (refunds, payouts, status queries) run from a **queue with exponential backoff and jitter**; after N attempts the message goes to a **dead-letter queue** watched by humans. Money operations are never retried forever blindly.

!!! tip "In the interview"

    Say the three sentences that interviewers wait for: *"A timeout means unknown, not failed."* — *"Retries are safe because every call, ours and the PSP's, carries an idempotency key."* — *"Money is recorded as balanced, append-only ledger transactions, and a daily reconciliation against the provider catches whatever slipped through."*

---

## 7. Bottlenecks, failure modes and trade-offs

| Where | What goes wrong | Mitigation | Trade-off |
|---|---|---|---|
| PSP timeout | Outcome unknown; risk of double charge or unpaid ticket | `UNKNOWN` state, retry with same key, status query, webhook, reconciliation | Fan waits "confirming…" for seconds or minutes |
| PSP outage | All checkouts fail | Circuit breaker, clear error, pause admissions (ticketing), optional second PSP | A second PSP doubles integration and reconciliation |
| PSP rate limit at on-sale peak | 429s from the provider | Bulkhead + concurrency limit in the adapter; queue non-urgent calls (refunds, payouts) | Refunds slower during peaks |
| Duplicate webhooks / retries | Double ledger entries | Event-id dedupe, conditional transitions, unique `order_id` / `psp_payment_id` | Extra tables and lookups |
| Concurrent duplicates | Two requests with the same key run in parallel | Unique insert of the key as a lock; `409` for in-progress | Clients must handle 409 |
| Database primary failure | Payments cannot be recorded | Synchronous standby (RPO = 0); fail closed — never "record later" | Short unavailability during failover |
| Ledger drift | Balances do not match reality | Zero-sum invariant checks, daily reconciliation, append-only | Operational process for mismatches |
| Webhook spoofing | Fake "succeeded" events | HMAC signature, timestamp tolerance, allow-list, fetch status from PSP before confirming high-value orders | Small extra latency |

The trade-offs to **say out loud**: **consistency over availability** (if the payment database is down, stop taking payments rather than record them "later"), **latency over certainty at the edge** (answer the fan with "processing" and resolve asynchronously instead of holding the request until the truth is known), and **outsourcing card handling to the PSP** (less PCI scope and fraud work, in exchange for dependency and fees).

---

## 8. Try it in the playground

The `payment-system` scenario models the payment service, its database and an external payment provider with retries and idempotency.

!!! tip "Try it"

    1. Run with the **load** profile and note the p99 of the payment path and the number of in-flight calls to the provider.
    2. Turn chaos to **medium** to make the provider slow and flaky. Without timeouts/circuit breaker, watch in-flight calls pile up (Little's Law) and the service saturate.
    3. Add a queue + workers in front of the provider for non-urgent calls (refunds, retries) and observe how the checkout path stays responsive.
    4. Increase retries without backoff: does the provider's error rate get worse? This is the [retry storm](../../reliability/patterns/index.md) — and in payments, without idempotency keys, every retry could be a second charge.

<div class="sdp" data-scenario="payment-system" data-mode="full" data-height="640" data-profile="load"></div>

[Open the full playground](../../../../playground/index.md){ .md-button }

---

## 9. Follow-up questions an interviewer asks

??? question "Why not just use a database transaction that includes the PSP call?"

    A database transaction cannot include an HTTP call to another company: you cannot roll back a charge by rolling back your `BEGIN`. Distributed transactions (two-phase commit) are not offered by payment providers. The pattern is a **local transaction for our state** (payment, ledger, outbox), an **idempotent call** to the provider, and **compensation** (a refund) when a later step fails — a saga ([messaging patterns](../../messaging/patterns/index.md)).

??? question "The fan's payment succeeded, but the seat hold had already expired and the seat was resold. What now?"

    The webhook handler finds the order `EXPIRED`. Options, in order: if the seat (or an equivalent one) is still available, confirm the order; otherwise **refund automatically** (a new ledger transaction reversing T1 and a refund request to the PSP, both idempotent) and notify the fan. Reconciliation catches the case where even the webhook was lost. The design point: payment and inventory are separate systems, so the inconsistency window exists and must have a defined resolution.

??? question "How long do you keep idempotency keys?"

    Long enough to cover every realistic retry: client retries happen within minutes, queued retries within hours. 24 hours is common for public APIs; for internal payment-to-PSP calls, keep the mapping (our `paymentId` ↔ `psp_payment_id`) forever as part of the payment record. Expired keys are deleted by a scheduled job; they are small.

??? question "How do you pay promoters?"

    A scheduled **payout job** after the event computes each promoter's balance from the ledger (`promoter_payable:88`), creates a payout transaction (debit payable, credit bank) and sends the transfer request through the provider or bank with an idempotency key. Payouts are batched, rate limited and go through the same queue + DLQ path; failures leave the payable balance untouched, so nothing is lost.

??? question "Do we need event sourcing for payments?"

    The ledger already **is** an append-only log of financial facts, and the payment table records a state machine with its history (`events[]`). Full event sourcing of every aggregate is optional; what matters is immutability of money movements and the ability to explain every balance. Many payment systems combine a relational state table with an immutable ledger — simpler to query and audit.

??? question "How would you add a second payment provider?"

    Put an **adapter interface** in front of providers (create, query, refund, parse webhook, parse settlement file) and a **router** that chooses by method, cost or health. The hard parts are not the API calls: each provider has its own webhook semantics, settlement format and fee model, so reconciliation and the ledger must track **which provider** handled each payment. Failover only for new payments; a payment never moves between providers once started.

??? question "How do you test that nobody is ever charged twice?"

    Unit tests of the idempotency algorithm (replay, concurrent duplicates, changed body); integration tests against the provider's sandbox with injected timeouts after the request was accepted; chaos tests with Toxiproxy dropping responses between `payment` and the PSP stub ([Hands-on 9](../../../hands-on/9/index.md)); and a **production invariant**: a daily query proving there is at most one captured payment per order and that every ledger transaction sums to zero.

---

## 10. Self-assessment rubric

| Level | What the answer contains |
|---|---|
| **Junior** | Calls the PSP from the order service; stores a `paid` flag; maybe retries on error. Treats a timeout as a failure; no ledger. |
| **Mid** | Idempotency key on the API and to the PSP; webhooks verified and deduplicated; payment state machine; outbox to notify the order service; mentions reconciliation and the PCI benefit of tokenization. |
| **Senior** | Explains why exactly-once delivery is impossible and builds the exactly-once effect; designs the idempotency store for races, replays and changed bodies; the `UNKNOWN` state and its resolution paths; a double-entry ledger with invariants and corrections as new transactions; reconciliation workflow with mismatch types; bulkheads and rate limits toward the PSP during on-sales; payout batches; compensation (refund) as a saga step; explicit CP choice for the payment database. |

**Related:** [Integrations (webhooks, idempotency)](../../compute/integrations/index.md), [Messaging patterns (outbox, saga)](../../messaging/patterns/index.md), [Ticketing case](../ticketing/index.md), [Hands-on 7](../../../hands-on/7/index.md) (outbox), [Hands-on 9](../../../hands-on/9/index.md) (resilience between `order` and `payment`).

---

## How it connects { #how-it-connects }

Which classes does this case test? Each branch is a class whose ideas the design relies on (blue), with the palette components where they show up (green):

``` mermaid
flowchart LR
    CASE(["Payment system"]) --> DIS["Distributed<br/>exactly-once effect, unknown outcome"]:::tech
    CASE --> CMP["Compute<br/>PSP integration, webhooks, reconciliation"]:::tech
    CASE --> DB["Databases<br/>double-entry ledger, transactions"]:::tech
    CASE --> MSG["Messaging<br/>outbox, payment events"]:::tech
    CASE --> REL["Reliability<br/>backoff, retry storms, breakers"]:::tech
    CASE --> SEC["Network & Security<br/>PCI DSS scope, hosted fields"]:::tech
    DIS -.-> k1["sql<br/>(idempotency keys)"]:::comp
    CMP -.-> k2["payment · scheduler · dwh"]:::comp
    MSG -.-> k3["kafka · queue · worker"]:::comp
    SEC -.-> k4["apigw · app"]:::comp
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

**Classes it tests:** [Distributed — idempotency](../../distributed/index.md#idempotency) · [Distributed — transactions](../../distributed/transactions/index.md) · [Compute — integrations](../../compute/integrations/index.md) · [Databases — transactions](../../databases/transactions/index.md) · [Messaging — patterns](../../messaging/patterns/index.md) · [Reliability — patterns](../../reliability/patterns/index.md) · [Network & Security](../../network-security/index.md) · [Hands-on 7](../../../hands-on/7/index.md) and [Hands-on 9](../../../hands-on/9/index.md). **Palette components:** [`apigw`](../../../reference/components/edge/index.md#apigw) · [`app`](../../../reference/components/compute/index.md#app) · [`sql`](../../../reference/components/storage/index.md#sql) · [`kafka`](../../../reference/components/messaging/index.md#kafka) · [`queue`](../../../reference/components/messaging/index.md#queue) · [`worker`](../../../reference/components/compute/index.md#worker) · [`scheduler`](../../../reference/components/compute/index.md#scheduler) · [`payment`](../../../reference/components/external/index.md#payment) · [`dwh`](../../../reference/components/storage/index.md#dwh). **Scenarios:** `payment-system`, `retry-storm`.

---

## References

- XU, A.; LAM, S. *System Design Interview — An Insider's Guide*, vol. 2, ch. 11 "Payment System" and ch. 12 "Digital Wallet"[^1].
- Idempotency keys as designed at Stripe[^2].
- The PCI Data Security Standard and how tokenization reduces scope[^3].
- Accounting patterns for software (accounts, entries, transactions)[^4].
- KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2nd ed. — exactly-once semantics, idempotence and end-to-end correctness[^5].

[^1]: XU, A.; LAM, S. *System Design Interview — An Insider's Guide*, vol. 2. Byte Code LLC, 2022.
[^2]: LEACH, B. [Designing robust and predictable APIs with idempotency](https://stripe.com/blog/idempotency){target="_blank"}. Stripe Blog, 2017.
[^3]: PCI SECURITY STANDARDS COUNCIL. [PCI DSS v4.0](https://www.pcisecuritystandards.org/){target="_blank"}, 2022.
[^4]: FOWLER, M. *Analysis Patterns: Reusable Object Models*, ch. 6 "Inventory and Accounting". Addison-Wesley, 1996.
[^5]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2nd ed. O'Reilly.
