# External

**External** components are services you call but do not run: a third-party API, a payment provider, an email provider. They are often the slowest and least predictable part of a request, they have their own rate limits and outages, and you cannot scale or fix them. Designing around them is mostly about **containment**: timeouts so a slow provider cannot hold your threads, retries that are safe because they are idempotent, queues so the user does not wait for them, and reconciliation because their view of the world and yours will sometimes disagree.

In BoxOffice, `payment` is an adapter around an external payment provider, `notification` sends tickets through an email provider, and `catalog` imports event data from promoters' APIs.

| Component | One-liner | Playground id |
|---|---|---|
| [3rd Party API](#thirdparty) | Someone else's API: slow, rate-limited, sometimes down — contain it | `thirdparty` |
| [Payment](#payment) | A payment provider (card, Pix, wallets): idempotency, webhooks, reconciliation | `payment` |
| [Email](#email) | An email delivery provider: async, behind a queue, with deliverability rules | `email` |

``` diagram
flowchart LR
    O[order service] -->|timeout + circuit breaker + idempotency key| PAY[Payment provider]
    PAY -.webhook: payment confirmed.-> WH[webhook endpoint] --> O
    O -->|OrderConfirmed event| Q[(Queue)] --> N[notification workers] --> EM[Email provider]
    C[catalog importer] -->|rate-limited, cached| TP[Promoter API]
    R[nightly reconciliation job] --> PAY
    R --> DB[(Orders DB)]
```

---

## 3rd Party API { #thirdparty }

**What it is.** Any API run by another company that your system depends on: maps and geocoding, identity verification, shipping, promoters' event feeds, weather, LLM providers. You get a contract (documentation, an SLA if you are lucky, rate limits, a price per call) and nothing else: no access to their metrics, no control over their deploys.

**When to use.**

- Buy, don't build, when the capability is not your differentiator and the provider does it better (maps, fraud scoring, tax calculation).
- When there are regulatory or network effects you cannot replicate (card networks, identity checks).

**When not to (or watch out).**

- In a synchronous, user-facing path, every external call adds its latency **and** its availability: 99.9% × 99.5% (provider) ≈ 99.4% for the whole request. Prefer asynchronous calls, caching or precomputing.
- Vendor lock-in: wrap the provider behind your own interface (an adapter) so you can switch or add a second one.
- Data protection: what you send (personal data) leaves your control; check contracts and minimize fields.

**Key numbers.**

| Metric | Typical value | Note |
|---|---|---|
| Latency | ≈ 50–500 ms, with a long tail (seconds) | ≈ illustrative; the playground uses a median of ~150 ms with a wide spread |
| Published availability | often 99.9%–99.99% | Your effective availability includes the network path to it |
| Rate limits | tens to thousands of requests per second per account | Exceeding them returns 429 with Retry-After |
| Suggested timeout | a little above the provider's p99 | e.g. p99 800 ms ⇒ timeout ≈ 1 s (≈ illustrative) |

**Failure modes.**

- **Slow responses** exhaust your threads and cascade upstream (the classic `cascading-failure` scenario) → timeouts, circuit breaker, bulkhead (a separate pool per provider).
- **Outage** → fallback (cached data, a degraded feature, a second provider), queue the work for later.
- **Rate limiting (429)** → client-side rate limiting below the quota, backoff respecting Retry-After, batching, caching.
- **Breaking API changes** → pin versions, contract tests, monitor deprecation notices.
- **Retry storms** that make the provider's outage worse and get you banned → exponential backoff with jitter, retry budgets.

**In the playground.** `thirdparty` is an external **call** node with high latency variance (lognormal, median 150 ms with a large `sigma`), a provider `quota` (default 1,000 req/s; requests above it fail with 429), and random outages that are more frequent than those of internal nodes. Protect the edge that calls it with `timeoutMs`, `retries` with `backoff` `exp+jitter`, `circuitBreaker` and a `fallback`. Scenarios: [`cascading-failure`](../../../../playground/scenarios/index.md#cascading-failure), [`retry-storm`](../../../../playground/scenarios/index.md#retry-storm).

**Real products.**

=== "AWS"

    - Not a product category: you *call* third parties from your services. Useful AWS pieces around them: **Amazon API Gateway** / **AWS AppSync** to proxy and cache, **Amazon EventBridge API destinations** to call external HTTP APIs with rate limits and retries.

=== "GCP"

    - **Apigee** — API management that can proxy, cache and rate-limit outbound and inbound APIs.
    - **Application Integration / Integration Connectors** — managed connectors to common SaaS APIs.

=== "Azure"

    - **Azure API Management** — proxy, cache and policies in front of external APIs.
    - **Azure Logic Apps** — workflows with connectors to many SaaS APIs.

=== "Open source"

    - **Resilience4j** (Java) — timeouts, retries, circuit breakers and bulkheads around client calls (Hands-on 9).
    - **Toxiproxy** — simulates slow and failing dependencies in tests (Hands-on 9).
    - **WireMock** — stubs third-party HTTP APIs for tests.

!!! tip "In the interview"
    "Every third-party call gets a timeout just above its p99, a circuit breaker and its own thread pool, and sits behind an adapter interface; if the user doesn't need the answer right away, I move the call to a queue so the provider's bad day doesn't become ours."

**Learn more:** [Compute › Integrations](../../../classes/compute/integrations/index.md) · [Reliability › Patterns](../../../classes/reliability/patterns/index.md) · [Estimation › Availability math](../../../classes/estimation/availability-math/index.md) · [Hands-on 9](../../../hands-on/9/index.md)

---

## Payment { #payment }

**What it is.** A payment service provider (PSP) charges cards, wallets and instant payments on your behalf and moves the money to your account. You never store card numbers yourself: the provider gives the browser a hosted form or tokenizes the card, and your backend only sees a token. The usual flow has two halves: a **synchronous** request to create or confirm a payment (which may return "pending"), and an **asynchronous webhook** from the provider with the final status (succeeded, failed, refunded, disputed). In Brazil, **Pix** instant payments follow the same shape: you create a charge (a QR code), and the confirmation arrives as a notification.

**When to use.**

- Always, for real money: building your own card processing means PCI DSS scope, acquirer contracts and fraud handling.
- BoxOffice's `payment` service is an **adapter**: it hides the provider behind a small internal API (`authorize`, `capture`, `refund`, webhook handler), so the provider can be changed or a second one added.

**When not to (or watch out).**

- Never treat a timeout as a failure: the charge may have gone through. Retry only with the **same idempotency key**, or query the payment's status.
- Never trust the browser's redirect ("payment OK") as proof: confirm through the webhook (with signature verification) or a server-side status query.
- Never keep a database transaction or a seat lock open while waiting on the provider: hold the seat with an expiry (`hold_until`), call the provider, then confirm.
- Never put card data in your logs, events or analytics.

**Key numbers.**

| Metric | Typical value | Note |
|---|---|---|
| Authorization latency | ≈ 0.5–3 s, long tail | ≈ illustrative; 3-D Secure challenges add user time |
| Webhook delay | seconds, sometimes minutes; retried by the provider for hours or days | Webhooks can arrive late, twice or out of order |
| Fees | a percentage plus a fixed amount per transaction | Varies by country, method and contract — check the provider |
| Idempotency key retention | typically at least 24 hours on the provider side | e.g. Stripe documents 24 h; check yours |
| Seat hold while paying | ≈ 5–15 min | A product decision; BoxOffice uses 10 min |

**Failure modes.**

- **Double charge** — the client or your service retries after a timeout without an idempotency key → one idempotency key per payment attempt (e.g. derived from the order id), stored with the result.
- **Lost webhook** or webhook arriving before your order row exists → store webhooks first and process idempotently; a **reconciliation** job compares your orders with the provider's report daily (or hourly).
- **Provider outage at 10:00** → circuit breaker, a "payment pending" state with the seat hold extended, a second provider for critical events, clear messaging.
- **Inconsistent states** — paid at the provider but the order was cancelled locally (or the reverse) → a saga with compensations (refund, release seat) and reconciliation as the safety net.
- **Fraud and chargebacks** → the provider's fraud tools, velocity limits per user and card, 3-D Secure.

**In the playground.** `payment` is an external **call** node with high latency variance (median 400 ms), a provider `quota` (default 500 req/s) and random outages; the `payment-system` scenario shows retries without idempotency creating duplicate charges, and the `flash-sale` scenario shows it becoming the bottleneck when the sale opens. Use `timeoutMs`, `retries` with `exp+jitter`, `circuitBreaker` and a `fallback` ("payment pending") on the edge from `order`. Scenarios: [`payment-system`](../../../../playground/scenarios/index.md#payment-system), [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale), [`cascading-failure`](../../../../playground/scenarios/index.md#cascading-failure).

**Real products.**

=== "AWS"

    - Cloud providers are not payment processors. You call a PSP from your services; **AWS Payment Cryptography** exists for companies that build payment infrastructure themselves (HSM-style key operations), not for merchants like BoxOffice.

=== "GCP"

    - **Google Pay** is a wallet that works through your PSP, not a processor you integrate on its own. Google Cloud has no merchant payment-processing service.

=== "Azure"

    - Azure has no payment-processing service for merchants; you integrate a PSP from your services.

=== "Open source"

    - Payment processing itself is never self-hosted. Real providers: **Stripe**, **Adyen**, **PayPal / Braintree**, **Mercado Pago**, **PagSeguro (PagBank)**, and **Pix** through Brazilian PSPs and banks.
    - **Hyperswitch** (Juspay) — open-source payment orchestration that routes between several PSPs.
    - Provider sandboxes and CLIs (e.g. the **Stripe CLI** for forwarding test webhooks) for development.

!!! tip "In the interview"
    "Payment goes through an adapter with an idempotency key per attempt, a timeout and a circuit breaker; the final status comes from a signed webhook processed idempotently, the seat is held with an expiry rather than a lock, and a reconciliation job against the provider's report catches whatever slips through."

**Learn more:** [Compute › Integrations](../../../classes/compute/integrations/index.md) · [Case study: payment system](../../../classes/case-studies/payment-system/index.md) · [Messaging › Patterns](../../../classes/messaging/patterns/index.md) · [Hands-on 9](../../../hands-on/9/index.md)

---

## Email { #email }

**What it is.** An email delivery provider sends messages on your behalf through its reputation-managed infrastructure and reports back what happened (delivered, bounced, complained) through webhooks or events. Sending is easy; **deliverability** is the hard part: authenticating your domain (SPF, DKIM, DMARC), keeping bounce and complaint rates low, warming up new sending addresses, and respecting unsubscribes. Transactional email (tickets, receipts, password resets) and marketing email are usually kept on separate streams so a bad campaign doesn't hurt ticket delivery.

**When to use.**

- Transactional messages: BoxOffice sends the ticket and receipt after `OrderConfirmed`, password resets, event-change notices.
- Always asynchronously: the order is confirmed when it commits, not when the email leaves. A queue and `notification` workers send it.

**When not to (or watch out).**

- Never send email inside the purchase transaction or the request thread: the provider's latency and outages would become the user's.
- Don't run your own mail servers for production sending unless that is your business: IP reputation takes a long time to build.
- Provider sending limits and per-second rates apply: a flash sale that confirms 60,000 orders in 15 minutes is ~67 emails per second, which must fit the account's quota (request increases ahead of time).
- Email is not guaranteed or instant; for urgent notices combine channels (push, SMS) and show the ticket in the app.

**Key numbers.**

| Metric | Typical value | Note |
|---|---|---|
| API call to accept a message | ≈ 50–300 ms | ≈ illustrative; delivery to the inbox takes seconds to minutes |
| Sending quota | account-specific (per day and per second) | New accounts start low (sandbox) — plan increases before launch |
| Price | ≈ USD 0.10 per 1,000 emails (Amazon SES list price) | ≈ approximate (2026); others differ |
| Healthy bounce rate | ≈ < 2–5% | Providers may pause accounts above their thresholds |
| Healthy complaint rate | ≈ < 0.1% | Gmail and Yahoo bulk-sender rules ask to stay below 0.3% |

**Failure modes.**

- **Provider outage or throttling** → the queue absorbs it; workers retry with backoff; a second provider for critical transactional mail.
- **Duplicate emails** — at-least-once delivery from the queue → idempotent consumer keyed by (order id, template).
- **Landing in spam** → SPF/DKIM/DMARC, separate transactional and marketing streams, list hygiene.
- **Poison message** (invalid address, template error) blocks the queue → dead-letter queue after N attempts, alerts.
- **Silent loss** → track provider events (delivered/bounced) and expose "resend ticket" in the app.

**In the playground.** `email` is an external **call** node (median 250 ms) with a provider `quota` (default 100 sends/s) and occasional outages; put it behind a `queue` and `worker` nodes so its latency and failures turn into backlog instead of user-facing errors. Scenarios: [`notification-system`](../../../../playground/scenarios/index.md#notification-system), [`async-queue`](../../../../playground/scenarios/index.md#async-queue), [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale).

**Real products.**

=== "AWS"

    - **Amazon SES (Simple Email Service)** — transactional and bulk email with sending events (deliveries, bounces, complaints).

=== "GCP"

    - Google Cloud has no first-party email-sending service; partners such as **SendGrid** (Twilio) or **Mailgun** are used from GCP.

=== "Azure"

    - **Azure Communication Services Email** — managed email sending for applications.

=== "Open source"

    - **Postfix** — the classic mail transfer agent, if you really run your own.
    - **Mailpit** / **MailHog** — local SMTP servers that catch emails for development and tests (no real delivery).
    - Commercial providers commonly used: **SendGrid**, **Mailgun**, **Postmark**, **Resend**.

!!! tip "In the interview"
    "Email is never in the request path: OrderConfirmed goes to a queue, idempotent notification workers send through the provider within its rate limit, failures retry with backoff and end in a DLQ, and the ticket is also available in the app in case the email is late."

**Learn more:** [Compute › Integrations](../../../classes/compute/integrations/index.md) · [Case study: notification system](../../../classes/case-studies/notification-system/index.md) · [Messaging › Semantics](../../../classes/messaging/semantics/index.md) · [Compute › Notifications](../compute/index.md#notifications) · [Hands-on 7](../../../hands-on/7/index.md)
