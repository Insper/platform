
> *"Design a notification system that sends push notifications, e-mails and SMS for many product teams: order confirmations, reminders and marketing campaigns. Users must be able to choose what they receive."*

The notification system is the classic **asynchronous fan-out to unreliable third parties** problem. Nothing here is computationally hard; what makes it interesting is that every interesting part sits **outside** your control: Apple's and Google's push gateways, e-mail and SMS providers with their own rate limits, phones that uninstall the app, inboxes that bounce. The interview checks whether you can build a pipeline that absorbs bursts, **never sends the same message twice** (or explains when it might), keeps urgent messages fast while a marketing blast is draining, and respects what the user asked for.

BoxOffice sends three very different kinds of notification, and they make the requirements concrete:

- **Transactional** — "your tickets for Saturday" seconds after the payment webhook ([ticketing case](../ticketing/index.md)). Low volume, must arrive fast, must not be lost.
- **Scheduled** — "doors open in 2 hours" to the 60 000 ticket holders of tonight's show. Known in advance, all at the same moment.
- **Campaign** — "presale for the stadium tour starts Friday at 10:00" to the **5 million followers** of an artist. Huge, not urgent, and dangerous: if everyone taps at once, the notification DDoSes your own app.

| | |
|---|---|
| **Difficulty** | :material-star::material-star: medium |
| **Key concepts** | queue per channel and per priority, workers, device-token registry, templates and preferences (opt-out, quiet hours, frequency caps), idempotency and deduplication, retries with backoff + jitter, DLQ, provider failover and circuit breakers, per-provider rate limits, scheduler and campaign batching, delivery tracking via webhooks |
| **Palette components** | [`scheduler`](../../../reference/components/compute/index.md#scheduler), [`queue`](../../../reference/components/messaging/index.md#queue), [`worker`](../../../reference/components/compute/index.md#worker), [`notifications`](../../../reference/components/compute/index.md#notifications), [`email`](../../../reference/components/external/index.md#email), [`thirdparty`](../../../reference/components/external/index.md#thirdparty), [`nosql`](../../../reference/components/storage/index.md#nosql), [`sql`](../../../reference/components/storage/index.md#sql), [`analytics`](../../../reference/components/compute/index.md#analytics) |
| **Playground scenario** | `notification-system` |

!!! abstract "What this case trains"

    - **Estimate** the burst of a bulk campaign and **show** that a third-party rate limit, not your servers, sets how long it takes.
    - **Design** a pipeline of queues and workers per channel and priority, so marketing never delays a password reset.
    - **Guarantee** at-most-once *effect* on the user where possible, using notification IDs, idempotent consumers and provider features — and **explain** where duplicates can still happen.
    - **Apply** retries with backoff and jitter, dead-letter queues, circuit breakers and provider failover to external integrations.
    - **Spread** scheduled and bulk sends over time to protect providers and your own backend.

---

## 1. Clarify the requirements

([interview framework](../../intro/interview-framework/index.md))

### Functional requirements

1. Internal services **trigger** notifications through one API (`order`, `inventory`, `auth`…), by user and type, with data for the template.
2. Channels: **push** (iOS via APNs, Android via FCM), **e-mail** and **SMS**.
3. **Scheduled** notifications (send at a time) and **campaigns** (send to an audience, e.g. all followers of an artist).
4. **Templates** per type, channel and language.
5. **User preferences**: opt-out per category and channel, quiet hours, unsubscribe link in every marketing e-mail.
6. **Tracking**: sent, delivered, opened, bounced, per notification and per campaign.

### Non-functional requirements

| Quality | Target |
|---|---|
| **Latency** | Transactional: handed to the provider in p99 < 5 s. Campaigns: minutes to an hour is fine. |
| **Reliability** | No accepted notification is silently lost (retry, then DLQ with an alert) |
| **Duplicates** | A user should not receive the same notification twice; rare duplicates are tolerated, systematic ones are bugs |
| **Scale** | ~12 M notifications/day, bursts of millions in one campaign |
| **Isolation** | A campaign must never delay transactional messages |
| **Compliance** | Respect opt-outs and unsubscribes immediately; transactional vs. marketing rules differ |

### Out of scope (say it explicitly)

Building our own push or e-mail infrastructure (we use providers), the content editor for marketing, A/B testing of copy, the in-app inbox UI (mentioned as a follow-up).

??? question "Questions to ask the interviewer"

    | Question | Why it matters |
    |---|---|
    | Which channels, and which are mandatory per type? | Fan-out per channel and different providers, costs and limits. |
    | How big is the biggest campaign? How fast must it go out? | Sizes queues and workers; a provider limit may make "fast" impossible. |
    | Transactional and marketing in the same system? | Separate priorities or queues so marketing never blocks transactional. |
    | Is a duplicate worse than a loss? | Order confirmation: a duplicate is fine, a loss is not. Marketing: the opposite. |
    | Do we need open/click tracking? | Webhooks, tracking pixels, link redirection, analytics store. |
    | Time zones and quiet hours? | The scheduler must defer messages per user. |

---

## 2. Back-of-the-envelope estimates

```python exec="1" source="tabbed-right"
# Notification system: assumptions (illustrative)
transactional_day = 2_000_000   # order confirmations, receipts, password resets
scheduled_day     = 3_000_000   # reminders ("doors open in 2 h")
campaign_users    = 5_000_000   # followers of one big artist: presale alert
channels_per_user = 1.5         # push for everyone, e-mail for half of them
email_share       = 0.5         # share of campaign users who also get an e-mail
window_min        = 30          # how long we spread the campaign over
tap_share         = 0.1         # users who open the app right after the notification
email_limit_s     = 1_000       # e-mail provider sending limit per second (illustrative)
record_b          = 500         # one notification log record
dedup_days        = 7           # how long we remember notification ids
dedup_b           = 60          # one dedup key in the cache

campaign_msgs   = campaign_users * channels_per_user
daily_msgs      = transactional_day + scheduled_day + campaign_msgs
avg_rate        = daily_msgs / 86_400
blast_rate_1m   = campaign_msgs / 60                        # if sent within one minute
spread_rate     = campaign_msgs / (window_min * 60)
taps_blast      = campaign_users * tap_share / 60           # app requests caused by the blast
taps_spread     = campaign_users * tap_share / (window_min * 60)
email_drain_min = campaign_users * email_share / email_limit_s / 60
log_gb_day      = daily_msgs * record_b / 1e9
dedup_gb        = daily_msgs * dedup_days * dedup_b / 1e9

rows = [
    ("campaign_msgs", campaign_msgs, "msgs"), ("daily_msgs", daily_msgs, "msgs/day"),
    ("avg_rate", avg_rate, "msgs/s"), ("blast_rate_1m", blast_rate_1m, "msgs/s"),
    ("spread_rate", spread_rate, "msgs/s"), ("taps_blast", taps_blast, "req/s"),
    ("taps_spread", taps_spread, "req/s"), ("email_drain_min", email_drain_min, "min"),
    ("log_gb_day", log_gb_day, "GB/day"), ("dedup_gb", dedup_gb, "GB"),
]
print("| quantity | value | unit |\n|---|---:|---|")
for name, value, unit in rows:
    v = f"{value:,.0f}" if abs(value) >= 100 else f"{value:,.2f}"
    print(f"| `{name}` | {v} | {unit} |")
```

What the numbers tell us:

- The **average is tiny** (~145 messages/s) and the **peak is huge**: one presale campaign is 7.5 M messages, **125 k/s** if fired in one minute. ⇒ a **queue** between the trigger and the senders, and workers that drain at a controlled rate. This is a burst-absorption problem, not a throughput problem.
- Blasting in one minute also makes ~**8 k app requests/s** from fans who tap the notification — on the same backend that is preparing the presale. Spreading over 30 minutes cuts that to **~280 req/s**. ⇒ **spread campaigns over a window**: the notification system must protect the rest of BoxOffice, not only itself.
- With an e-mail provider that accepts 1 000 messages/s, the 2.5 M e-mails take **~42 minutes** no matter how many workers we run. ⇒ the **provider's limit** decides the duration; we need per-provider rate limiting, and transactional e-mails need **reserved capacity** (a separate priority) or they wait 40 minutes behind the campaign.
- The notification log is **~6 GB/day** and the dedup keys for a week **~5 GB** — small. Storage is not the problem; ordering the work is.

---

## 3. API

```http
POST /v1/notifications                                   → 202 {notificationId, status: ACCEPTED}
     Idempotency-Key: order-81f3-confirmed
     {"userId": 42, "type": "order.confirmed", "priority": "transactional",
      "data": {"orderId": "81f3", "event": "Rock in Rio — Day 2", "seats": ["A-12-07", "A-12-08"]}}

POST /v1/campaigns                                       → 202 {campaignId, status: SCHEDULED}
     {"audience": {"followersOf": "artist:77"}, "type": "presale.alert",
      "sendAt": "2027-03-10T15:00:00Z", "spreadOver": "30m", "channels": ["push", "email"]}
POST /v1/campaigns/{campaignId}/cancel                   → 200 {sent, cancelled}

PUT  /v1/users/{userId}/preferences                      → 204
     {"marketing": {"push": true, "email": false}, "quietHours": {"from": "22:00", "to": "08:00"},
      "timezone": "America/Sao_Paulo", "locale": "pt-BR"}
POST   /v1/devices  {"userId": 42, "platform": "ios", "token": "…"}    → 201
DELETE /v1/devices/{token}                                              → 204

POST /v1/webhooks/{provider}                             ← delivered / bounced / complaint / opened (signed)
GET  /v1/notifications/{notificationId}                  → 200 {channel statuses, attempts}
```

- The trigger is **asynchronous**: `202 Accepted` means "durably queued", not "delivered". Producers never wait for Apple or the e-mail provider.
- The **`Idempotency-Key`** comes from the business event (`order-81f3-confirmed`), so a producer that retries — or an event consumed twice from Kafka — creates **one** notification.
- `priority` is set by type (configured centrally), not chosen freely by each team — otherwise everything becomes "transactional".

---

## 4. Data model

```sql
-- Preferences, templates, campaigns: small, relational, read-mostly (SQL)
CREATE TABLE preference (
    user_id     BIGINT, category TEXT, channel TEXT,       -- 'marketing' | 'reminders' | 'transactional'
    enabled     BOOLEAN NOT NULL,
    PRIMARY KEY (user_id, category, channel)
);
CREATE TABLE user_settings (
    user_id BIGINT PRIMARY KEY, timezone TEXT, locale TEXT,
    quiet_from TIME, quiet_to TIME, email TEXT, phone TEXT, email_suppressed BOOLEAN DEFAULT false
);
CREATE TABLE device (
    token TEXT PRIMARY KEY, user_id BIGINT NOT NULL, platform TEXT NOT NULL,   -- ios | android | web
    active BOOLEAN NOT NULL DEFAULT true, last_seen TIMESTAMPTZ
);
CREATE TABLE template (
    type TEXT, channel TEXT, locale TEXT, version INT,
    subject TEXT, body TEXT,                                -- e.g. Mustache/Handlebars source
    PRIMARY KEY (type, channel, locale, version)
);
CREATE TABLE campaign (
    campaign_id UUID PRIMARY KEY, audience JSONB, type TEXT, send_at TIMESTAMPTZ,
    spread_over INTERVAL, status TEXT, cursor TEXT          -- where the audience expansion stopped
);
```

```text
# Notification log (NoSQL, partition = user_id, clustering = created_at DESC): write-heavy, append-only
notification {notification_id, user_id, type, channel, status: ACCEPTED|SENT|DELIVERED|FAILED|SKIPPED,
              provider, provider_msg_id, attempts, created_at, sent_at, reason}

# Dedup keys (cache) — one per notification and channel
SET notif:order-81f3-confirmed:push 1 NX EX 604800     → OK (first time) | nil (already sent)

# Per-user frequency cap (cache)
INCR cap:42:marketing:2027-03-10  → 2      EXPIRE … 86400
```

| Data | Store | Why |
|---|---|---|
| Preferences, settings, devices, templates, campaigns | SQL (`sql`) + cache in workers | Small, relational, changed by users and admins; read on every send |
| Notification log / status | NoSQL (`nosql`), partitioned by user | Millions of appends per day, read by user ("what did we send to 42?") and by id |
| Dedup keys, frequency caps, provider rate limits | In-memory KV with TTL (cache) | Atomic `SET NX` / `INCR`, expire by themselves |
| Work in flight | Queues (`queue`) per channel × priority, plus retry and dead-letter queues | Absorb bursts, isolate channels and priorities |
| Delivery events | Analytics (`analytics`) / data warehouse | Campaign reports, bounce rates, provider comparison |

---

## 5. High-level design

``` mermaid-sim
flowchart LR
    ord["order / inventory /<br/>auth services"] --> api["Notification API<br/>validate, idempotency"]
    camp["Campaign service"] --> sch["Scheduler<br/>sendAt, spread, quiet hours"]
    sch --> api
    api --> route["Router<br/>preferences, templates,<br/>devices, caps"]
    route --> qt[["Queues: transactional<br/>push · email · sms"]]
    route --> qm[["Queues: bulk<br/>push · email · sms"]]
    qt --> wp["Push workers"]
    qm --> wp
    qt --> we["E-mail workers"]
    qm --> we
    qt --> ws["SMS workers"]
    wp --> apns[["APNs / FCM"]]
    we --> esp[["E-mail provider A / B"]]
    ws --> sms[["SMS provider"]]
    wp -. failed after retries .-> dlq[["DLQ"]]
    esp -. webhooks .-> trk["Tracking"]
    trk --> an[("Analytics")]
    route --> log[("Notification log")]
```

One order confirmation, end to end:

``` mermaid-sim
sequenceDiagram
    autonumber
    participant O as order (Kafka consumer)
    participant A as Notification API
    participant R as Router
    participant Q as Queue (transactional email)
    participant W as E-mail worker
    participant P as E-mail provider
    participant T as Tracking
    O->>A: POST /notifications (Idempotency-Key order-81f3-confirmed)
    A->>A: first time? store ACCEPTED
    A-->>O: 202
    A->>R: route(user 42, order.confirmed)
    R->>R: preferences ok, render pt-BR template
    R->>Q: enqueue email job
    Q->>W: job (attempt 1)
    W->>P: send (timeout 3 s)
    P--xW: 503 Service Unavailable
    W->>Q: re-enqueue with backoff 2 s ± jitter
    Q->>W: job (attempt 2)
    W->>P: send
    P-->>W: 202 accepted, provider id
    W->>W: status SENT
    P-->>T: webhook delivered
```

---

## 6. Deep dives

### 6.1 Channels, queues and priorities

Each channel has its own provider, failure modes and limits, so each gets its **own queue and worker pool** — a slow SMS provider must not stop push notifications (a [bulkhead](../../reliability/patterns/index.md)). Each channel also has (at least) two **priorities**: transactional and bulk.

=== "Push (APNs / FCM)"

    The device registers its **token** with our API after login. Workers send to Apple Push Notification service (iOS) or Firebase Cloud Messaging (Android, web). Payloads are small (a few kB). The providers tell you when a token is dead (APNs answers `410 Unregistered`, FCM `UNREGISTERED`): **deactivate the token**, or you keep paying for sends to uninstalled apps. Push is best-effort: delivery to a phone that is off is deferred or dropped by the platform.

=== "E-mail"

    Sent through an e-mail service provider (Amazon SES, SendGrid, Mailgun…). Deliverability depends on your **domain reputation**: SPF, DKIM and DMARC records, a **suppression list** for hard bounces and spam complaints (never send to them again), and a one-click **unsubscribe** header on marketing mail (RFC 8058). Throughput is limited by the provider's sending rate.

=== "SMS"

    The most expensive channel per message and the most regulated (sender IDs, opt-in rules per country). Use it only for what really needs it (one-time codes, critical changes such as "your event was cancelled"). Providers have per-second limits and delivery receipts arrive by webhook.

| Channel | Typical latency | Cost per message | Reliability signal | Main limit |
|---|---|---|---|---|
| Push | Seconds | ~Free | Provider accepted; device delivery not guaranteed | Token validity, payload size |
| E-mail | Seconds to minutes | Low | Delivered / bounced / complaint webhooks | Provider rate, domain reputation |
| SMS | Seconds | High | Delivery receipts (DLR) | Cost, carrier rules, provider rate |

**Priorities.** Two separate queues per channel (or one queue system with strict priority) and **separate worker pools or reserved capacity** for transactional. A campaign of 2.5 M e-mails then drains at the provider's limit *minus* the share reserved for transactional, and the order confirmation still leaves in seconds.

### 6.2 Delivering once: idempotency, retries, DLQ and failover

The pipeline is **at-least-once** end to end — queues redeliver when a worker crashes, workers retry when a provider times out ([delivery semantics](../../messaging/semantics/index.md)). To make the **effect** "once" for the user:

1. **Notification ID from the business event.** The API stores `Idempotency-Key → notificationId`; a second trigger for `order-81f3-confirmed` returns the existing notification.
2. **Idempotent workers.** Before calling the provider, a worker claims `notif:{id}:{channel}` with `SET NX`; a redelivered job finds the key and only checks the status.
3. **Provider-side guards where they exist.** APNs `apns-collapse-id` makes the device show only the latest notification with that ID; several e-mail and SMS APIs accept an idempotency key or a client reference.

```python
def handle(job):
    key = f"notif:{job.notification_id}:{job.channel}"
    if not cache.set(key, "sending", nx=True, ex=7 * 86_400):
        return ack(job)                                   # already handled: duplicate delivery
    try:
        provider_id = provider.send(job.payload, timeout=3, idempotency_key=job.notification_id)
        log.update(job.notification_id, job.channel, status="SENT", provider_id=provider_id)
        return ack(job)
    except (Timeout, ProviderUnavailable, RateLimited) as err:
        cache.delete(key)                                 # allow the retry to claim it again
        if job.attempt >= MAX_ATTEMPTS:
            return dead_letter(job, reason=str(err))      # alert + manual or automatic replay
        delay = min(300, 2 ** job.attempt) * random.uniform(0.5, 1.5)   # backoff + jitter
        return retry_later(job, delay)
    except InvalidRecipient:
        devices.deactivate(job.token)                     # permanent: do not retry
        log.update(job.notification_id, job.channel, status="FAILED", reason="invalid recipient")
        return ack(job)
```

!!! warning "Where duplicates can still happen"

    If the provider **accepted** the message but the response was lost (timeout), the worker cannot know whether it was sent. Retrying risks a duplicate; not retrying risks a loss. For transactional messages choose **retry** (a duplicate "your tickets" e-mail is harmless) and lean on provider idempotency keys and collapse IDs. Say this explicitly in the interview: "exactly-once delivery" to a third party does not exist; exactly-once *effect* is engineered with idempotency where the other side supports it.

**Failures by type.** Distinguish **transient** errors (timeouts, `429`, `5xx`: retry with exponential backoff and jitter), **permanent** errors (invalid token, hard bounce: do not retry, fix the data) and **poison messages** (a template that fails to render: straight to the DLQ). The **dead-letter queue** is monitored; a non-empty DLQ alerts someone and has a replay tool.

**Provider outage.** A circuit breaker per provider opens when errors pile up ([integrations](../../compute/integrations/index.md)). For e-mail and SMS, keep a **second provider** and fail over transactional traffic to it (bulk can simply wait). For push there is no alternative to APNs/FCM: queue and wait, and drop marketing pushes that become stale (a presale alert after the presale is noise).

### 6.3 Preferences, templates and limits

The router applies a fixed sequence of checks before anything is queued — cheap filters first:

``` mermaid-sim
flowchart LR
    t["Trigger<br/>user 42, presale.alert"] --> p{"Opted in for<br/>marketing push?"}
    p -->|no| skip1["SKIPPED (log)"]
    p -->|yes| c{"Frequency cap<br/>≤ 3 marketing/day?"}
    c -->|exceeded| skip2["SKIPPED (log)"]
    c -->|ok| qh{"Quiet hours<br/>in user's timezone?"}
    qh -->|yes| def["Defer to scheduler<br/>(08:00 local)"]
    qh -->|no| r["Render template<br/>(locale pt-BR)"]
    r --> d["Look up devices"]
    d --> q[["Queue push (bulk)"]]
```

- **Preferences are cached** in the router (they are read on every send and change rarely); an opt-out must still take effect within seconds, so invalidate on change.
- **Transactional bypasses** frequency caps and quiet hours (a ticket confirmation at 23:00 is expected); marketing never does. The category is fixed per type, centrally.
- **Templates** are versioned per type, channel and locale; render in the router (or the worker) with the data from the trigger, and fall back to a default locale. A rendering error is a poison message.
- **Frequency caps** (`INCR` with a daily TTL per user and category) protect users from five teams each sending "just one" push per day.
- **Provider rate limits** are enforced by the workers with a shared **token bucket** per provider and account ([rate limiter case](../rate-limiter/index.md)), so we slow down **before** the provider starts answering `429`.

### 6.4 Scheduled sends and campaigns

**Scheduled notifications** ("doors open in 2 h") are stored with a `send_at`; the [scheduler](../../compute/async-work/index.md) polls a time-bucketed index (`WHERE send_at <= now() AND status = 'PENDING'`, claimed with `FOR UPDATE SKIP LOCKED` so several scheduler instances do not double-send) or uses a delayed queue. 60 000 reminders at exactly 18:00 is itself a mini-campaign: spread them over a few minutes.

**Campaigns** are expanded in batches, never as one giant job:

``` mermaid-sim
sequenceDiagram
    autonumber
    participant C as Campaign service
    participant G as Followers (social graph)
    participant S as Scheduler
    participant R as Router
    C->>G: page of followers of artist:77 (cursor, 10 000)
    G-->>C: user ids + next cursor
    C->>C: save cursor (resumable)
    C->>S: batch with send times spread over 30 min (jittered)
    S->>R: due batches, at a controlled rate
    R->>R: preferences, caps, quiet hours, render
    Note over C,R: repeat until the cursor is exhausted (or the campaign is cancelled)
```

- **Resumable**: the cursor is saved after each page; if the campaign service restarts, it continues instead of starting over (and duplicates are stopped by dedup keys anyway).
- **Spread with jitter**: each batch gets send times distributed over the window, so the providers see a flat rate and BoxOffice sees ~280 taps/s instead of 8 000 (section 2). The same reasoning as the waiting room: turn a spike into a flow.
- **Kill switch**: `cancel` stops the expansion and makes workers drop jobs of that campaign — essential when the copy has a wrong date.
- **Time zones**: "at 10:00 local time" means one batch schedule per time zone.

**Tracking.** Providers report `delivered`, `bounced`, `complaint` (and for e-mail, opens via a tracking pixel and clicks via redirected links) through signed webhooks. The tracking service updates the notification log and streams events to the analytics store for campaign reports. Opens are approximate: some mail clients pre-fetch images (Apple Mail Privacy Protection, for example), inflating open rates.

---

## 7. Bottlenecks, failure modes and trade-offs

| Where | What goes wrong | Mitigation | Trade-off |
|---|---|---|---|
| Campaign burst | Millions of jobs flood queues and providers | Batched expansion; spread over a window; per-provider token bucket | Campaign takes tens of minutes |
| Priority inversion | Order confirmation waits behind a campaign | Separate queues/worker pools per priority; reserved provider capacity | Idle reserved capacity |
| Provider slow / down | Workers block; queue grows | Timeouts, circuit breaker, second provider for e-mail/SMS, drop stale marketing | Two providers to integrate and pay |
| Duplicates | Redelivery or retry after an unknown outcome | Idempotency key from the event, `SET NX` claim, provider idempotency/collapse IDs | Dedup state; rare duplicates remain |
| Poison messages | A broken template is retried forever | Classify errors; DLQ for non-retryable; alert on DLQ depth | Manual replay work |
| Dead tokens / bounces | Paying for undeliverable sends; reputation drops | Deactivate tokens on `410`/`UNREGISTERED`; suppression list | Must handle re-registration |
| Self-inflicted DDoS | Everyone taps the push at once | Spread sends; pre-warm caches of the target page | Later recipients learn later |
| Preferences cache stale | Opted-out user still notified | Invalidate on change; check at send time for marketing | One extra lookup |

The trade-offs to **say out loud**: **duplicates vs. losses** (for transactional, retry and accept rare duplicates), **speed vs. protection** (a campaign spread over 30 minutes is slower but safe for providers and for BoxOffice), and **isolation vs. utilization** (separate pools per channel and priority waste some capacity but make failures local).

---

## 8. Try it in the playground

The `notification-system` scenario has a scheduler and producers feeding a queue, workers per channel and external e-mail/push providers.

!!! tip "Try it"

    1. Run with the **spike** profile (a campaign) and watch the queue depth and the consumer lag: how long does the backlog take to drain?
    2. Add workers: does the drain time improve, or does the external provider become the limit? (That is the `email_drain_min` number of section 2.)
    3. Turn chaos to **medium** to slow down or fail the e-mail provider: do retries pile up? Where would a circuit breaker and a DLQ help?
    4. Compare the latency of the first and the last notification of the burst — that gap is what a transactional message would suffer without a separate priority queue.

<div class="sdp" data-scenario="notification-system" data-mode="full" data-height="640" data-profile="spike"></div>

[Open the full playground](../../../../playground/index.md){ .md-button }

---

## 9. Follow-up questions an interviewer asks

??? question "How do you make sure a user does not get the same notification twice?"

    Layers: an idempotency key derived from the business event at the API (one notification per event); a `SET NX` claim per notification and channel in the worker (one send per redelivered job); provider features (collapse IDs, idempotency keys) for the case where the provider accepted but we did not get the answer. And be honest: when the outcome of a send is unknown, you choose between a possible duplicate and a possible loss — for transactional messages, prefer the duplicate.

??? question "The e-mail provider is down for an hour. What happens?"

    The circuit breaker opens after a burst of failures, so workers stop hammering it. Transactional e-mail fails over to the secondary provider (pre-configured, with its own domain authentication). Bulk e-mail stays queued and resumes when the breaker half-opens and probes succeed; marketing messages whose content expired (a presale that already started) are dropped. Push and SMS are unaffected because they have their own queues and workers.

??? question "A user has a phone, a tablet and the web app. Who gets the push?"

    All active devices of the user, by default — the device registry has one row per token. Use a **collapse ID** so the same notification replaces itself instead of stacking, and when the user opens it on one device, send a silent update to clear it from the others (the same receipt idea as in the [chat case](../chat/index.md)). Tokens that the provider reports as dead are deactivated.

??? question "How do you send 'doors open in 2 hours' exactly on time for 60 000 people?"

    The event time is absolute, so `send_at = doors_open - 2 h` is the same instant for everyone; the scheduler starts the batch a few minutes earlier and spreads it (nobody notices 18:00 vs. 17:57). Use `FOR UPDATE SKIP LOCKED` (or a partitioned delayed queue) so multiple scheduler instances share the work without double-sending, and mark each row as `ENQUEUED` in the same transaction that claims it.

??? question "Marketing sent a campaign with the wrong date. Can you stop it?"

    Yes, if the system was built for it: campaigns expand in batches with a saved cursor, so `cancel` stops the expansion; workers check the campaign status (cached for seconds) before sending each job and drop jobs of cancelled campaigns. Messages already handed to providers cannot be recalled — which is another reason to spread campaigns over time instead of blasting them.

??? question "Do notifications need to be ordered?"

    Usually not globally, but some pairs matter: "payment received" should not arrive after "order cancelled". Avoid depending on order: make each notification self-contained (it states the current state, rendered at send time), use a per-user ordering key in the queue when it really matters, and collapse superseded notifications (a newer status replaces the older one).

??? question "How would you add an in-app notification inbox?"

    Store every notification for the in-app channel in the notification log (partitioned by user, newest first) with a `read` flag, expose `GET /v1/users/{id}/inbox?cursor=…`, and push "you have a new item" over the app's real-time connection when it is open. The inbox becomes just another channel with its own worker, which writes to the store instead of calling a provider.

---

## 10. Self-assessment rubric

| Level | What the answer contains |
|---|---|
| **Junior** | An API that calls the push or e-mail provider directly when a service asks; a table of notifications. No queue, no retries; the producer waits for the provider. |
| **Mid** | Asynchronous pipeline with queues and workers per channel; templates and preferences; retries with backoff; DLQ; device-token registry; mentions idempotency and rate limits of providers. |
| **Senior** | Estimates the campaign burst and identifies the provider limit as the bottleneck; separates priorities so transactional is never delayed; idempotency end to end with honest discussion of unknown outcomes; error classification (transient, permanent, poison); circuit breakers and provider failover; frequency caps and quiet hours; resumable batched campaigns spread over time to protect the backend; tracking via webhooks and suppression lists. |

**Related:** [Queues and pub/sub](../../messaging/queues-pubsub/index.md), [Delivery semantics](../../messaging/semantics/index.md), [Asynchronous work and schedulers](../../compute/async-work/index.md), [External integrations](../../compute/integrations/index.md), [Hands-on 7](../../../hands-on/7/index.md) (idempotent `notification` consumer and DLQ), [Ticketing case](../ticketing/index.md).

---

## How it connects { #how-it-connects }

Which classes does this case test? Each branch is a class whose ideas the design relies on (blue), with the palette components where they show up (green):

``` mermaid
flowchart LR
    CASE(["Notification system"]) --> EST["Estimation<br/>a provider limit sets campaign time"]:::tech
    CASE --> CMP["Compute<br/>scheduler, workers, provider adapters"]:::tech
    CASE --> MSG["Messaging<br/>queue per channel and priority, DLQ"]:::tech
    CASE --> DIS["Distributed<br/>dedup, at-most-once effect"]:::tech
    CASE --> REL["Reliability<br/>retries + jitter, bulkheads, failover"]:::tech
    CMP -.-> k1["scheduler · worker<br/>notifications"]:::comp
    MSG -.-> k2["queue"]:::comp
    REL -.-> k3["email · thirdparty"]:::comp
    DIS -.-> k4["nosql<br/>(notification log)"]:::comp
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

**Classes it tests:** [Compute — async work](../../compute/async-work/index.md) · [Compute — integrations](../../compute/integrations/index.md) · [Messaging — queues & pub/sub](../../messaging/queues-pubsub/index.md) · [Messaging — semantics](../../messaging/semantics/index.md) · [Reliability — patterns](../../reliability/patterns/index.md) · [Hands-on 7](../../../hands-on/7/index.md). **Palette components:** [`scheduler`](../../../reference/components/compute/index.md#scheduler) · [`queue`](../../../reference/components/messaging/index.md#queue) · [`worker`](../../../reference/components/compute/index.md#worker) · [`notifications`](../../../reference/components/compute/index.md#notifications) · [`email`](../../../reference/components/external/index.md#email) · [`thirdparty`](../../../reference/components/external/index.md#thirdparty) · [`nosql`](../../../reference/components/storage/index.md#nosql) · [`analytics`](../../../reference/components/compute/index.md#analytics). **Scenarios:** `notification-system`, `async-queue`.

---

## References

- XU, A. *System Design Interview — An Insider's Guide*, vol. 1, ch. 10 "Design a Notification System"[^1].
- Apple Push Notification service documentation (tokens, `apns-collapse-id`, error responses)[^2].
- Firebase Cloud Messaging documentation (message types, error codes)[^3].
- KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2nd ed., chapters on stream processing and exactly-once semantics[^4].
- One-click unsubscribe for marketing e-mail[^5].

[^1]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1. Byte Code LLC, 2020.
[^2]: APPLE. [Sending notification requests to APNs](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns){target="_blank"}. Apple Developer Documentation.
[^3]: GOOGLE. [Firebase Cloud Messaging](https://firebase.google.com/docs/cloud-messaging){target="_blank"}. Firebase Documentation.
[^4]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2nd ed. O'Reilly.
[^5]: LEVINE, J.; HERKULA, T. [RFC 8058 — Signaling One-Click Functionality for List Email Headers](https://www.rfc-editor.org/rfc/rfc8058){target="_blank"}. IETF, 2017.
