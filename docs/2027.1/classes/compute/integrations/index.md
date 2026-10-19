At 10:03 on sale day a fan clicks **Pay**. BoxOffice's `payment` service calls the payment provider, and the call times out after 5 seconds. Did the card get charged? The fan, seeing a spinner, clicks **Pay** again. Thirty seconds later the provider sends a notification that the *first* charge succeeded — and then another one for the second. Meanwhile, the e-mail provider is rate-limiting BoxOffice because 40 thousand confirmation e-mails were sent in 5 minutes, and a venue-map API used on the event page is down.

BoxOffice deliberately buys its **generic subdomains** ([services](../services/index.md#subdomains-where-to-invest)) — card processing, e-mail delivery, maps. That is the right call, and it turns each of them into a dependency you **do not control**: its latency, its availability, its limits, its API changes and, most importantly, the fact that **it decides some outcomes asynchronously**. This page covers the techniques that make such integrations safe: **idempotency keys, verified webhooks, retries that cannot duplicate, reconciliation, and a plan for provider outages**. The palette's EXTERNAL category — [3rd Party API, Payment, Email](../../../reference/components/external/index.md) — is what this page is about.

---

## What you do not control

| Property | Internal service | External provider |
|---|---|---|
| Latency | low, predictable, measured by you | higher, heavy tail, on the public internet |
| Availability | your SLO, your on-call | their SLA (credits, not your lost sales) |
| Limits | you set them | **rate limits and quotas** per API key |
| Changes | coordinated, contract-tested | versioned by them, deprecated on their calendar |
| Outcome of a call | known when the call returns | may be **decided later** (3-D Secure, bank review) |
| Failure visibility | your logs and traces | their status page, their error codes |
| Cost | infrastructure | often **per call** or per message |

Each row maps to a design rule:

- **Isolate the provider behind an adapter** (an anti-corruption layer, [services](../services/index.md#layered-clean-and-hexagonal)): the provider's model, status names and SDK stop at one class.
- **Every call has a timeout, and retries are safe** (idempotency keys) — sections below.
- **Protect yourself from the provider** with a circuit breaker and a bulkhead per provider ([reliability](../../reliability/index.md)), so a slow provider cannot exhaust your threads (the `cascading-failure` scenario).
- **Respect their limits**: throttle on your side, honor `429` and `Retry-After`.
- **Assume outcomes arrive asynchronously**: model states explicitly, accept webhooks, reconcile.
- **Observe each provider separately**: latency, error rate by error code, rate-limit hits, cost.

---

## Anatomy of a payment

Card payments are the hardest integration BoxOffice has, so we use them as the guide. The card number never touches BoxOffice: the app collects it with the provider's hosted fields and receives a **token**, which keeps BoxOffice out of most of the PCI DSS scope[^7]. The `payment` service then creates a payment with that token.

``` mermaid-sim
sequenceDiagram
    participant F as Fan (app)
    participant O as order
    participant P as payment
    participant X as Payment provider
    F->>X: card details in hosted fields → token tok_abc
    F->>O: POST /v1/orders {holdId, token} + Idempotency-Key k-1
    O->>P: charge order ord_9 (key ord_9)
    P->>X: create payment 450.00 BRL, token, Idempotency-Key ord_9
    X-->>P: status processing
    P-->>O: PENDING
    O-->>F: 202 Accepted — order ord_9 PENDING
    Note over X: bank authorizes (maybe after 3-D Secure)
    X->>P: webhook payment.succeeded (signed)
    P->>O: PaymentSucceeded ord_9
    O->>O: confirm hold → order CONFIRMED
    O-->>F: push: your tickets are being issued
```

Notice what is *not* in the picture: a synchronous "charge succeeded" answer on which checkout depends. The provider may answer `processing`, may ask the fan to authenticate with the bank (`requires_action`, 3-D Secure), or may simply time out. The definitive outcome often arrives later, by webhook. So BoxOffice models the payment as an explicit **state machine**:

``` mermaid-sim
stateDiagram-v2
    [*] --> CREATED
    CREATED --> PENDING : provider accepted the request
    CREATED --> UNKNOWN : timeout — outcome not known
    UNKNOWN --> PENDING : status query / webhook
    PENDING --> REQUIRES_ACTION : 3-D Secure needed
    REQUIRES_ACTION --> PENDING : fan authenticated
    PENDING --> SUCCEEDED : webhook payment.succeeded
    PENDING --> FAILED : webhook payment.failed
    SUCCEEDED --> REFUNDED : hold expired / event cancelled
```

The **UNKNOWN** state is the honest answer to "the call timed out": the request may or may not have reached the provider. Never treat a timeout as a failure (you would release the seats of a fan who *was* charged) nor as a success. Resolve it by querying the provider or waiting for the webhook — and make sure that retrying cannot charge twice.

---

## Idempotency keys { #idempotency-keys }

An operation is **idempotent** if doing it twice has the same effect as doing it once. `POST /payments` is not — unless both sides agree on an **idempotency key**: a unique identifier of one *logical* operation, sent with every attempt of that operation. The server remembers the keys it has processed and, on a repeat, returns the stored result instead of executing again[^1][^2].

BoxOffice needs keys in **both directions**:

- **Inbound** — fans and apps retry: a double click, a mobile app retrying on a flaky connection, the gateway retrying a `503`. BoxOffice's `POST /v1/orders` and `POST /v1/events/{id}/holds` require an `Idempotency-Key` header, generated by the client once per logical action (a UUID created when the fan presses *Pay*, reused on every retry of that press).
- **Outbound** — BoxOffice retries the provider. Every call that creates a charge or a refund carries a key **derived from BoxOffice's own id** (`ord_9`, or `ord_9:refund:1`), so a retry after a timeout reuses it and the provider returns the original payment instead of creating a second one.

``` mermaid-sim
sequenceDiagram
    participant P as payment
    participant X as Payment provider
    P->>X: create payment, Idempotency-Key ord_9
    Note over X: charge created (pay_77)
    X--xP: response lost (timeout)
    Note over P: state UNKNOWN → retry with the SAME key
    P->>X: create payment, Idempotency-Key ord_9
    X-->>P: pay_77 succeeded (stored result, no new charge)
```

### Implementing it on your own API

The provider does this for you on its side; on BoxOffice's side you implement it. The core is a table whose primary key makes "first one wins" a database guarantee:

```sql title="V7__idempotency_keys.sql"
CREATE TABLE idempotency_keys (
    client_id     text        NOT NULL,              -- keys are scoped per caller
    key           text        NOT NULL,
    request_hash  text        NOT NULL,              -- SHA-256 of method + path + body
    status        text        NOT NULL,              -- IN_PROGRESS | COMPLETED
    response_code int,
    response_body jsonb,
    locked_at     timestamptz NOT NULL DEFAULT now(),
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (client_id, key)
);
CREATE INDEX idempotency_keys_created_at ON idempotency_keys (created_at);  -- purge after 24 h
```

```java title="order: IdempotentExecutor.java"
@Component
class IdempotentExecutor {

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;

    IdempotentExecutor(JdbcTemplate jdbc, TransactionTemplate tx) {
        this.jdbc = jdbc;
        this.tx = tx;
    }

    StoredResponse execute(String clientId, String key, String requestHash,
                           Supplier<StoredResponse> operation) {
        // 1. Claim the key. The primary key guarantees that only one request wins.
        int claimed = jdbc.update("""
                INSERT INTO idempotency_keys (client_id, key, request_hash, status)
                VALUES (?, ?, ?, 'IN_PROGRESS')
                ON CONFLICT (client_id, key) DO NOTHING
                """, clientId, key, requestHash);

        if (claimed == 0) {                                   // 2. Seen before.
            Map<String, Object> row = jdbc.queryForMap("""
                    SELECT request_hash, status, response_code, response_body::text AS body
                      FROM idempotency_keys WHERE client_id = ? AND key = ?
                    """, clientId, key);
            if (!requestHash.equals(row.get("request_hash")))
                throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                        "Idempotency-Key reused with a different request");
            if ("IN_PROGRESS".equals(row.get("status")))
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "a request with this Idempotency-Key is still being processed");
            return new StoredResponse((Integer) row.get("response_code"), (String) row.get("body"));
        }

        // 3. First time: run the operation and store its response in ONE transaction.
        try {
            return tx.execute(status -> {
                StoredResponse response = operation.get();
                jdbc.update("""
                        UPDATE idempotency_keys
                           SET status = 'COMPLETED', response_code = ?, response_body = ?::jsonb
                         WHERE client_id = ? AND key = ?
                        """, response.code(), response.body(), clientId, key);
                return response;
            });
        } catch (RuntimeException e) {                        // nothing was committed:
            jdbc.update("DELETE FROM idempotency_keys WHERE client_id = ? AND key = ?",
                        clientId, key);                       // let the client retry
            throw e;
        }
    }
}
```

The decisions hidden in those lines are the ones an interviewer will probe:

| Case | Behavior | Why |
|---|---|---|
| Same key, same request, completed | return the **stored** response (same status code and body) | the client cannot tell a replay from the original |
| Same key, still in progress | `409 Conflict` — "try again shortly" | two concurrent attempts must not both run |
| Same key, **different** request | `422` | a client bug; executing it would be surprising |
| Operation failed before committing | delete the key | nothing happened; a retry should run again |
| Process crashed while `IN_PROGRESS` | after a timeout (`locked_at` older than, e.g., 1 min), allow a new attempt to take over | otherwise the key is stuck forever |
| Old keys | purge after 24 h (or the retry window you document) | storage; the IETF draft and providers use similar windows |

When the operation **also calls the provider**, step 3 is not purely local: the provider call cannot be rolled back with the transaction. That is why the outbound call carries its own idempotency key derived from the order id — if BoxOffice's transaction fails after the provider charged, the retry asks the provider again with the same key and gets the same payment back. For longer multi-step operations, Brandur Leach's "atomic phases and recovery points" design generalizes this[^3].

!!! warning "Keys must identify the *logical* operation"
    A key generated per HTTP attempt (a new UUID on each retry) protects nothing. A key derived from the *content* ("fan 42 buys seat C-14") blocks a fan who legitimately buys twice. Generate it when the user **decides** to act, and reuse it for every retry of that decision.

---

## Retries and unknown outcomes

Not all failures are equal. What you may do next depends on **whether the request could have had an effect**:

| What happened | Could it have taken effect? | What to do |
|---|---|---|
| Connection refused, DNS failure, TLS handshake failed | no — nothing was sent | retry (with backoff) |
| Timeout **after** sending the request | **unknown** | retry with the **same idempotency key**, or query the status first |
| `5xx` from the provider | unknown (possibly partial) | retry with the same key, with backoff and jitter |
| `429 Too Many Requests` | no | wait for `Retry-After`, then retry; throttle yourself |
| `400`, `401`, `402` card declined, `422` | no, and it will not succeed | do not retry; surface the error |

Retries follow the rules from [reliability](../../reliability/index.md): exponential backoff with full jitter, a small maximum number of attempts, at **one** layer only, and inside the caller's time budget. For a user-facing checkout that budget is short — a few seconds; after that, the payment becomes `UNKNOWN`/`PENDING` and the fan sees "we are confirming your payment", while a background job resolves it.

---

## Webhooks { #webhooks }

A **webhook** is an HTTP request that the provider sends to *your* URL when something happens on its side — `payment.succeeded`, `payment.failed`, `charge.refunded`, `email.bounced`. It is how asynchronous outcomes reach you without polling. Treat each delivery as an untrusted, possibly duplicated, possibly late message:

| Property of webhook delivery | Consequence for the receiver |
|---|---|
| Anyone on the internet can call your URL | **verify the signature** before trusting anything |
| A captured request can be sent again later | check the **timestamp** (reject old ones) |
| **At-least-once**: retried until you answer `2xx`, for hours or days | **deduplicate** by event id |
| No ordering guarantee | apply **monotonic state transitions**; ignore stale events |
| Your slow handler causes provider timeouts and retries | **acknowledge fast**, process asynchronously |
| Deliveries can be lost after the provider gives up | **reconcile** (next section) |

``` mermaid-sim
sequenceDiagram
    participant X as Payment provider
    participant H as Webhook receiver
    participant DB as inbox table
    participant Q as Queue
    participant W as payment worker
    X->>H: POST /webhooks/payments (signed)
    H->>H: verify signature + timestamp
    H->>DB: INSERT event (unique event id)
    H->>Q: enqueue event id
    H-->>X: 200 OK (within milliseconds)
    X->>H: same event again (retry)
    H->>DB: INSERT → duplicate, ignored
    H-->>X: 200 OK
    Q->>W: process event
    W->>W: PENDING → SUCCEEDED (conditional update)
```

### Verifying signatures

Providers sign each delivery with a secret shared only with you, usually an **HMAC-SHA256** over the raw body plus a timestamp and a message id. The *Standard Webhooks* specification, adopted by several providers, defines the headers `webhook-id`, `webhook-timestamp` and `webhook-signature`, and signs the string `id.timestamp.body`[^4]; other providers use the same idea with their own header names (Stripe's `Stripe-Signature`, for instance[^5]). A receiver in Python with FastAPI:

```python title="payment-webhooks/main.py"
import base64
import hashlib
import hmac
import json
import os
import time

from fastapi import FastAPI, Header, HTTPException, Request

from adapters import inbox, queue        # the service's own persistence and queue adapters

app = FastAPI()
SECRET = base64.b64decode(os.environ["WEBHOOK_SECRET"].removeprefix("whsec_"))
TOLERANCE_S = 300                        # reject deliveries older than 5 minutes


def verify(body: bytes, msg_id: str, timestamp: str, signatures: str) -> None:
    if abs(time.time() - int(timestamp)) > TOLERANCE_S:
        raise HTTPException(status_code=400, detail="timestamp outside tolerance")   # replay
    signed = f"{msg_id}.{timestamp}.".encode() + body
    expected = base64.b64encode(hmac.new(SECRET, signed, hashlib.sha256).digest()).decode()
    for candidate in signatures.split():                  # several during secret rotation
        version, _, value = candidate.partition(",")
        if version == "v1" and hmac.compare_digest(value, expected):                # constant time
            return
    raise HTTPException(status_code=401, detail="invalid signature")


@app.post("/webhooks/payments")
async def payment_webhook(
    request: Request,
    webhook_id: str = Header(...),
    webhook_timestamp: str = Header(...),
    webhook_signature: str = Header(...),
):
    body = await request.body()          # the RAW bytes: re-serialized JSON would not match
    verify(body, webhook_id, webhook_timestamp, webhook_signature)
    event = json.loads(body)
    if await inbox.insert_if_absent(event_id=webhook_id, payload=event):   # unique event id
        await queue.publish("payment.provider-events", {"eventId": webhook_id})
    return {"received": True}            # 2xx fast; a worker does the real processing
```

Details that matter: verify over the **raw bytes** (parsing and re-serializing JSON changes whitespace and key order); compare with a **constant-time** function (`hmac.compare_digest`) so the comparison time does not leak the signature; accept **several signatures** during secret rotation; keep the handler tiny so it always answers within the provider's timeout.

### Out of order and stale events

The worker applies each event as a **conditional state transition**, so a late or duplicated event cannot move a payment backwards:

```sql title="apply payment.succeeded"
UPDATE payments
   SET status = 'SUCCEEDED',
       provider_updated_at = :occurred_at
 WHERE provider_payment_id = :provider_payment_id
   AND status IN ('CREATED', 'UNKNOWN', 'PENDING', 'REQUIRES_ACTION');
-- 0 rows updated = already final (duplicate or stale event): acknowledge and ignore
```

Many teams also treat the webhook as a **notification only** ("something changed on `pay_77`") and fetch the current object from the provider's API before acting. It costs one call, but the state you act on is always the latest and authoritative one.

### Webhooks or polling?

| | Webhooks (push) | Polling (pull) |
|---|---|---|
| Latency of the outcome | seconds | the polling interval |
| Load | one request per event | requests even when nothing changed |
| Needs a public endpoint | yes (signature, TLS, availability) | no |
| Missed updates | possible — needs reconciliation | none, if the query is complete |
| Typical use | primary channel for outcomes | fallback for stuck items, reconciliation |

Use both: webhooks as the fast path, and a **sweeper** that polls the provider for payments still `UNKNOWN` or `PENDING` after, say, 10 minutes.

!!! info "When BoxOffice sends webhooks"
    Resellers subscribe to BoxOffice events (`order.confirmed`, `event.cancelled`). Now BoxOffice is the provider and must offer what it expects from others: signed deliveries with a unique id and timestamp, retries with exponential backoff for a documented period, a dead-letter store, a dashboard to replay deliveries, and the promise that delivery is at-least-once and unordered. A queue with one worker pool per subscriber keeps one slow reseller from delaying the rest.

---

## Reconciliation { #reconciliation }

Idempotency and webhooks make each interaction safe. They do not guarantee that, at the end of the day, BoxOffice's records **agree** with the provider's: a webhook may be lost after the provider's retries ran out, a support agent may refund a payment in the provider's dashboard, a bug may skip a state update, and the provider deducts fees and chargebacks you only learn about from reports.

**Reconciliation** is the periodic job that compares the two sides and resolves differences — standard practice in any system that moves money[^6].

``` mermaid-sim
flowchart LR
    report["Provider report<br/>or list API since T"] --> load["Load into<br/>provider_payments"]
    ours[("payments<br/>(BoxOffice)")] --> match{"Match by<br/>provider id"}
    load --> match
    match -->|"equal"| ok["Matched ✓"]
    match -->|"theirs SUCCEEDED,<br/>ours PENDING"| fix["Auto-fix:<br/>confirm or refund"]
    match -->|"only in one side,<br/>amount differs"| human["Exception queue<br/>(finance on-call)"]
```

```sql title="find mismatches for one day"
SELECT coalesce(p.id, r.reference)  AS payment,
       p.status                      AS ours,
       r.status                      AS theirs,
       p.amount_cents                AS our_amount,
       r.amount_cents                AS their_amount
  FROM payments p
  FULL OUTER JOIN provider_payments r
         ON r.provider_payment_id = p.provider_payment_id
 WHERE (p.created_at >= :day AND p.created_at < :day + interval '1 day'
        OR r.created_at >= :day AND r.created_at < :day + interval '1 day')
   AND (p.id IS NULL
        OR r.provider_payment_id IS NULL
        OR p.status <> r.status
        OR p.amount_cents <> r.amount_cents);
```

| Mismatch | Likely cause | Resolution |
|---|---|---|
| Provider `succeeded`, BoxOffice `PENDING` | lost webhook | confirm the order if the hold is still valid; otherwise **refund** automatically |
| Provider `refunded`, BoxOffice `SUCCEEDED` | refund made in the provider's dashboard | cancel the tickets, update the order |
| BoxOffice `SUCCEEDED`, provider has nothing | bug or test data in production | exception queue — investigate |
| Amounts differ | currency, fees, partial capture | exception queue; check the fee model |

Run it at two speeds: a **near-real-time sweeper** (every few minutes, for payments stuck in `UNKNOWN`/`PENDING`, by querying the provider's API) and a **daily reconciliation** against the provider's settlement report, which also checks fees and payouts against the bank. Larger systems record every money movement in a **double-entry ledger** so that the books always balance and every difference has an explanation.

---

## Provider outages { #provider-outages }

Providers fail like everything else — and their outage arrives on your busiest day, because your busiest day is their busiest day too. Decide in advance, per provider, what BoxOffice does:

| Strategy | How | Fits | Cost |
|---|---|---|---|
| **Fail fast, clearly** | circuit breaker opens; checkout answers "payments temporarily unavailable" in milliseconds | payments when nothing else is possible | lost sales during the outage — but no hung threads, no cascading failure |
| **Queue and retry later** | accept the work, deliver when the provider is back | e-mail, push, analytics exports | delayed delivery; backlog to drain (rate limits!) |
| **Fail over to a second provider** | route by provider health; same port, two adapters | e-mail (stateless sends); payments for large businesses | two integrations, two reconciliations, card tokens are often provider-specific |
| **Degrade the feature** | hide the optional part | venue maps, recommendations, fraud score (fall back to rules) | reduced experience |
| **Protect the user's state** | extend seat holds while the payment provider is down | BoxOffice checkout | seats unavailable to others for longer |

``` mermaid-sim
flowchart LR
    n["notification worker"] --> cb{"circuit breaker<br/>primary ESP"}
    cb -->|"closed"| p["Primary e-mail provider"]
    cb -->|"open"| s["Secondary e-mail provider"]
    p -.->|"429 / 5xx"| retry["retry queue<br/>(backoff)"]
    s -.->|"429 / 5xx"| retry
    retry --> n
```

The BoxOffice decisions:

- **Payment provider down** → the breaker opens after a burst of failures; new checkouts fail fast with a clear message, and **active holds are extended** by the outage duration so fans do not lose their seats while waiting. Payments already in flight stay `UNKNOWN` and are resolved by the sweeper when the provider returns. (A second payment provider is on the roadmap, behind the same `PaymentGateway` port.)
- **E-mail provider down or rate-limiting** → messages wait in the queue; the notification worker throttles to the provider's limit; after a sustained outage, traffic fails over to a secondary provider. Ticket links remain available in the app, so a late e-mail is an inconvenience, not a lost sale.
- **Venue-map API down** → the event page renders without the interactive map (cached image fallback).

!!! example "E-mail is an integration with its own rules"
    Sending e-mail reliably is more than an API call. Providers enforce **rate limits** per account; they report **bounces** (address does not exist) and **complaints** (marked as spam) by webhook, and BoxOffice must stop sending to those addresses (a **suppression list**) or the provider will suspend the account. Domain authentication with **SPF, DKIM and DMARC** decides whether messages reach the inbox at all. And **transactional** mail (tickets, password resets) should use a separate stream or subdomain from **marketing** mail, so that a bad campaign does not hurt ticket delivery.

### Try it in the playground

Open the `payment-system` scenario: checkout calls a payment service that calls an external provider, with retries and idempotency.

1. Raise the chaos level to **high** so the provider has outages and slow periods; watch checkout p99 and the error rate.
2. Set retries **without** backoff on the payment edge: the provider receives a retry storm and stays down longer. Switch to **exponential backoff with jitter**.
3. Add a **timeout** and a **circuit breaker** on the edge to the provider: checkout fails fast instead of piling up threads, and recovers when the provider does.

<div class="sdp" data-scenario="payment-system" data-mode="compact" data-height="520" data-chaos="medium"></div>

[:material-open-in-new: Open the full simulator](../../../../playground/index.md)

---

## Security of integrations

- **Secrets** (API keys, webhook secrets) live in a secret manager, never in the repository; rotate them, and use **restricted keys** with only the permissions a service needs ([network & security](../../network-security/index.md)).
- **Minimize PCI DSS scope**: tokenize with the provider's hosted fields or payment page so that card numbers never cross BoxOffice's network.
- **Egress control**: calls to providers leave through a NAT gateway with fixed IPs (some providers allowlist them); deny other outbound traffic.
- **Treat provider responses as input**: validate them; a compromised or buggy provider must not be able to inject data into your system unchecked.

---

## Trade-offs at a glance

| Decision | Option A | Option B |
|---|---|---|
| Confirming a payment | synchronous answer: simple UX, but checkout depends on the provider's latency and fails on timeouts | `202` + webhook: robust and honest about uncertainty, but needs states, push/poll in the UI and reconciliation |
| Learning outcomes | webhooks: fast, efficient, can be lost | polling: simple, complete, slow and wasteful |
| Provider redundancy | one provider: simpler, cheaper | two providers: survives outages, doubles integration and reconciliation work |
| Webhook processing | inline: simpler | inbox + queue: fast acks, retries under your control |

!!! tip "In the interview"

    The payment-system follow-ups are predictable — have the answers ready:

    - *"The call to the provider timed out. Was the customer charged?"* → **We don't know**: state `UNKNOWN`; retry with the **same idempotency key** or query the status; never charge twice, never assume failure.
    - *"The user double-clicked Pay."* → client-generated **Idempotency-Key** per logical action; the second request returns the first result.
    - *"How do you know the payment succeeded?"* → **signed webhook**, verified, deduplicated by event id, applied as a monotonic state transition; plus a sweeper that polls stuck payments.
    - *"What if the webhook never arrives?"* → **reconciliation** against the provider's API and settlement reports, at two speeds.
    - *"The provider is down."* → circuit breaker, fail fast, extend holds, queue what can wait; a second provider if the business justifies it.

!!! warning "Common pitfalls"

    - **No timeout** on provider calls: the provider's slow day becomes your outage (`cascading-failure`).
    - **Retrying writes without an idempotency key**: double charges, double refunds, duplicate e-mails.
    - **Treating a timeout as a failure** and releasing the seats of a fan who was charged.
    - **Trusting unsigned webhooks**, or verifying the signature over re-serialized JSON.
    - **Slow webhook handlers** doing all the work inline: provider timeouts, retries and duplicates.
    - **Assuming webhook order**: a late `processing` event overwriting `succeeded`.
    - **No reconciliation**: small disagreements accumulate silently until the accounting does not close.
    - **Leaking the provider's model** (status strings, ids, SDK types) throughout the code instead of one adapter.
    - **Ignoring rate limits and bounces**: the e-mail provider suspends the account on sale day.

---

## How it connects { #how-it-connects }

``` mermaid
flowchart LR
    ADP["one adapter per provider<br/>ports and adapters"] --> RES["timeouts, circuit breaker,<br/>bulkhead → Reliability"]
    IK["idempotency keys<br/>inbound and outbound"] --> RETRY["safe retries"]
    TO["a timeout means UNKNOWN"] --> SM["payment state machine"]
    RETRY --> SM
    SM --> WH["webhooks: signature,<br/>dedup by event id"]
    SM --> REC["reconciliation with<br/>the provider's records"]
    WH --> ASYNC["ack fast, process async<br/>→ Messaging"]
    OUT["provider outages"] --> STRAT["fail fast, queue, fail over,<br/>degrade, extend holds"]
    STRAT --> RES
    IK -.-> DIST["idempotency<br/>→ Distributed systems"]
```

**Palette components:** [`payment`](../../../reference/components/external/index.md#payment) (the provider behind the `payment` adapter) · [`email`](../../../reference/components/external/index.md#email) (rate limits, bounces, a secondary provider) · [`thirdparty`](../../../reference/components/external/index.md#thirdparty) (the venue-map API: degrade without it) · [`app`](../../../reference/components/compute/index.md#app) (the adapter service) · [`sql`](../../../reference/components/storage/index.md#sql) (idempotency keys under a unique constraint, payment states) · [`queue`](../../../reference/components/messaging/index.md#queue) (deliver later; process webhooks asynchronously) · [`scheduler`](../../../reference/components/compute/index.md#scheduler) (sweepers and reconciliation jobs) · [`serverless`](../../../reference/components/compute/index.md#serverless) (a cheap webhook receiver). **Scenarios:** `payment-system`, `cascading-failure`, `retry-storm`, `notification-system`. **Continues in:** [Reliability — circuit breaker](../../reliability/patterns/index.md#circuit-breaker), [Distributed — idempotency](../../distributed/index.md#idempotency), [Distributed — transactions](../../distributed/transactions/index.md), [Case study: payment system](../../case-studies/payment-system/index.md), [Hands-on 9](../../../hands-on/9/index.md).

## Key takeaways

- External providers add latency, limits, changes and **asynchronous outcomes** you do not control; isolate each one behind an **adapter** with timeouts, circuit breaker and bulkhead.
- **Idempotency keys** — inbound from clients, outbound to providers, derived from the logical operation — make retries safe; implement them with a unique key, stored responses, in-progress and mismatch handling.
- A timeout means **UNKNOWN**, not failed: model the payment as a state machine and resolve uncertainty by query, webhook or sweeper.
- **Webhooks**: verify the signature over raw bytes with a timestamp, deduplicate by event id, acknowledge fast, process asynchronously, apply monotonic transitions.
- **Reconcile** with the provider's records periodically; webhooks and retries are not enough on their own.
- Plan each **provider outage** in advance: fail fast, queue, fail over, degrade — and protect the user's state (extend holds).

---

[^1]: [The Idempotency-Key HTTP Header Field](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/){target="_blank"}. IETF HTTPAPI working group, Internet-Draft.
[^2]: Stripe. [Idempotent requests](https://docs.stripe.com/api/idempotent_requests){target="_blank"}. Stripe API reference.
[^3]: LEACH, B. [Implementing Stripe-like Idempotency Keys in Postgres](https://brandur.org/idempotency-keys){target="_blank"}. 2017.
[^4]: [Standard Webhooks specification](https://www.standardwebhooks.com/){target="_blank"}.
[^5]: Stripe. [Receive Stripe events in your webhook endpoint](https://docs.stripe.com/webhooks){target="_blank"} (signatures, retries, event ordering).
[^6]: XU, A.; LAM, S. *System Design Interview — An Insider's Guide, Volume 2*. ByteByteGo, 2022. Chapter "Payment System" (reconciliation, double-entry ledger, exactly-once with idempotency).
[^7]: PCI Security Standards Council. [PCI DSS](https://www.pcisecuritystandards.org/){target="_blank"} (scope reduction by tokenization and hosted payment pages).
