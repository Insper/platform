!!! abstract "In this lab"

    - Replace lab 9's fake payment provider with a **real one in a sandbox**: Stripe's test mode, where no money moves.
    - Keep the contract `order` sees: `payment` still answers `AUTHORIZED` or `DECLINED`, behind a `Psp` interface with two implementations — the fake (still the default) and Stripe.
    - Receive Stripe's **webhooks**, check their **signature**, process each event **once**, and let a webhook record the charge whose answer was lost.
    - **Reconcile** your payments against the provider, the source of truth.
    - See how the same design takes **Pix** with Mercado Pago.

Lab 9 taught `payment` to survive a provider that is slow or down — against a WireMock that answers whatever we script. A real payment service provider (PSP) adds what a fake cannot: an account and keys, amounts in centavos, declined cards that are answers and not failures, and a second channel — the provider calls *you* back, later, maybe twice, to say what really happened. This lab plugs BoxOffice into Stripe's sandbox and handles all of it, without spending a cent.

!!! quote "The story so far"

    Chapter 10 of the [story of the course](../../index.md#story), its second lab, which ties three threads together. [Class 3](../../classes/distributed/index.md) warned that between machines a message can be lost or duplicated: **a retried "buy" can charge twice**. [Lab 9](../9/index.md) answered with one idempotency key per order (`order-<orderId>`) against a fake provider, and showed the other face of a timeout: when lab 9's client gives up after **1 s and 3 attempts**, the charge may still have happened — on a slow provider day the [simulator below](#the-unknown-checkouts) leaves **133 of 1,000 checkouts UNKNOWN**. [Class 12](../../classes/network-security/index.md) adds that any endpoint the internet can reach must prove who is calling. **This lab** connects `payment` to a real provider's sandbox, turns the UNKNOWN into a known answer with signed webhooks and a reconciliation, and measures it: each checkout charged exactly once, and zero mismatches against the provider.

## Before you start { #before-you-start }

| | |
|---|---|
| **Time** | 3–4 hours |
| **You need** | the tools of lab 0; a free **Stripe account** (an e-mail is enough for the sandbox); `jq` and `openssl` (both come with macOS and most Linux distributions) |
| **Directory** | every command runs from the root of your `boxoffice/` repository |
| **Costs** | **zero**: the sandbox (test mode) moves no money, and the service refuses to start with a live key |

``` { .bash .copy }
docker compose version        # v2.x
jq --version                  # jq-1.6+
openssl version               # any
```

**Start state** — the end of lab 13 (lab 9 is the one this lab builds on: `payment`, `order`, Toxiproxy and the fake provider `psp`):

``` { .tree title="boxoffice/ at the start of lab 14" }
boxoffice/
    compose.yaml                     # psp (WireMock), toxiproxy, payment, order…
    services/payment/                # lab 9: PaymentController, PaymentService, PspClient, V1__create_payments.sql
    services/order/                  # lab 9: PaymentClient, Idempotency-Key "order-<orderId>"
```

!!! tip "Catch up"

    Skipped or broke a lab? Download [boxoffice-after-lab-13.zip](../13/boxoffice-after-lab-13.zip), unzip it and `cd boxoffice`. This lab **adds** `Psp.java`, `StripePsp.java`, `StripeSignature.java`, `StripeWebhookController.java`, `Reconciliation.java`, `V2__stripe_events.sql`, a unit test and `scripts/send-webhook.sh`, and **replaces** `compose.yaml` and, in `services/payment/`, `pom.xml`, `application.yaml`, `ChargeRequest.java`, `PaymentService.java` and `PspClient.java`. All are in full on this page and in [`boxoffice-after-lab-14.zip`](boxoffice-after-lab-14.zip).

## Slides

<div class="slides-embed">
  <iframe src="slides/payments.html" title="Slides: payments in a sandbox" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/payments.html){:target="_blank"}

## What you will build

``` diagram-sim
flowchart LR
    order["order<br/>key order-&lt;id&gt;"]:::comp -->|"POST /payments<br/>(via Toxiproxy)"| payment["payment<br/>Psp: fake | stripe"]:::comp
    payment -->|"POST /v1/payment_intents<br/>Idempotency-Key, confirm=true"| stripe["Stripe sandbox"]:::tech
    stripe -->|"payment_intent.succeeded<br/>(later, maybe twice)"| cli["stripe-cli<br/>listen --forward-to"]:::tech
    cli -->|"POST /webhooks/stripe<br/>Stripe-Signature"| payment
    payment -->|"GET /payments/reconcile<br/>retrieve each PaymentIntent"| stripe
```

| Step | What changes | You should see |
|---|---|---|
| 1. A sandbox | a Stripe account, a test key in `.env` | `GET /v1/balance` answers with `"livemode": false` |
| 2. The adapter | `Psp` + `StripePsp`, the fake still the default | `payment` builds; 5 tests pass |
| 3. Charge | `PSP_PROVIDER=stripe` | `AUTHORIZED` with a `pi_…` reference; the same key, the same payment; a declined card is `DECLINED` |
| 4. Webhooks | signature, one event once, `stripe-cli` | `webhook evt_… → AUTHORIZED`; a replay is a `duplicate`; a forged one is `400` |
| 5. The lost answer | a charge `payment` never stored | the webhook stores it; paying again confirms the order with no second charge |
| 6. Reconcile | ours vs Stripe's | `{"checked": N, "mismatches": []}` — then one mismatch, found |

## 1. A Stripe sandbox

1. Create an account at [dashboard.stripe.com/register](https://dashboard.stripe.com/register){target="_blank"}. You do not need to activate payments: a sandbox (Stripe's test environment) is available at once.
2. In the Dashboard, open **Developers → API keys** of your sandbox and copy the **secret key**: it starts with `sk_test_`.
3. Put it in `.env`, at the root of the repository — Compose reads it, and lab 0's `.gitignore` keeps it out of Git:

``` { .bash .copy title=".env" }
PSP_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_test_...
```

``` { .bash .copy }
git check-ignore .env                  # prints ".env": it will never be committed
curl -s https://api.stripe.com/v1/balance -u "$(grep '^STRIPE_SECRET_KEY=' .env | cut -d= -f2-):" | jq '{object, livemode}'
```

You should see `{"object": "balance", "livemode": false}`. `livemode: false` is the sandbox: nothing you do here charges a real card.

!!! danger "A secret key is a password to your money"

    Never paste it in code, a commit, a screenshot or a chat. If it leaks, roll it in the Dashboard (**Developers → API keys → Roll key**). `StripePsp` refuses any key that does not start with `sk_test_`: in this course, a live key is a bug.

## 2. The adapter: one interface, two providers

`order` must not know which provider is behind `payment` — that is the point of the adapter of [lab 9](../9/payment/index.md). The new `Psp` interface has two implementations, chosen by `boxoffice.psp.provider`: lab 9's `PspClient` (still the default, so the chaos experiments and CI keep working without keys) and `StripePsp`.

=== "Psp.java"

    ``` { .java .copy linenums="1" title="services/payment/src/main/java/boxoffice/payment/Psp.java" }
    --8<-- "docs/2027.1/hands-on/14/code/services/payment/src/main/java/boxoffice/payment/Psp.java"
    ```

=== "StripePsp.java"

    ``` { .java .copy linenums="1" title="services/payment/src/main/java/boxoffice/payment/StripePsp.java" }
    --8<-- "docs/2027.1/hands-on/14/code/services/payment/src/main/java/boxoffice/payment/StripePsp.java"
    ```

=== "PspClient.java"

    ``` { .java .copy linenums="1" title="services/payment/src/main/java/boxoffice/payment/PspClient.java" }
    --8<-- "docs/2027.1/hands-on/14/code/services/payment/src/main/java/boxoffice/payment/PspClient.java"
    ```

=== "ChargeRequest.java"

    ``` { .java .copy linenums="1" title="services/payment/src/main/java/boxoffice/payment/ChargeRequest.java" }
    --8<-- "docs/2027.1/hands-on/14/code/services/payment/src/main/java/boxoffice/payment/ChargeRequest.java"
    ```

=== "application.yaml"

    ``` { .yaml .copy linenums="1" title="services/payment/src/main/resources/application.yaml" }
    --8<-- "docs/2027.1/hands-on/14/code/services/payment/src/main/resources/application.yaml"
    ```

=== "pom.xml"

    ``` { .xml .copy linenums="1" title="services/payment/pom.xml" }
    --8<-- "docs/2027.1/hands-on/14/code/services/payment/pom.xml"
    ```

What `StripePsp` does, and why:

- **One PaymentIntent per order, confirmed on the server.** `confirm=true` charges at once with the test payment method (`pm_card_visa` by default — in a real checkout, Stripe.js in the browser turns the card into such an id, so card numbers never touch BoxOffice). `allow_redirects=never`: there is no browser to send to a bank page.
- **Amounts in centavos.** R$ 350.00 is `amount=35000`; `movePointRight(2).longValueExact()` fails loudly on a fraction of a centavo instead of rounding money.
- **The same `Idempotency-Key` as `payment`'s own table** (`order-<orderId>` from `order`). Stripe stores the result of the first request with a key and replays it for every retry with the same key, so a retry after a crash between "Stripe charged" and "we saved it" cannot charge twice.
- **A declined card is an answer.** Stripe returns HTTP 402 with `type: card_error` and the PaymentIntent; `payment` records `DECLINED`. Anything else (401, 5xx, a timeout) is an exception: lab 9's retry, breaker and fallback in `order` handle it.
- **Metadata** `order_id` and `idempotency_key` travel with the PaymentIntent: the webhook of step 4 uses them to find — or create — the payment.

`PaymentService` now asks the `Psp` interface instead of `PspClient`; its full code is in step 4. Rebuild `payment` and run its tests:

``` { .bash .copy }
docker compose build payment                                   # the Dockerfile runs mvn package -DskipTests
docker run --rm -v "$PWD/services/payment":/src -w /src maven:3.9-eclipse-temurin-21 mvn -B -q test
```

You should see `Tests run: 5, Failures: 0` for `StripeSignatureTest` (step 4).

## 3. Charge in the sandbox

`compose.yaml` passes the new variables to `payment` (and adds `stripe-cli`, used in step 4):

``` { .yaml .copy linenums="1" title="compose.yaml" }
--8<-- "docs/2027.1/hands-on/14/code/compose.yaml"
```

Start `payment` with the Stripe provider (`.env` sets `PSP_PROVIDER=stripe`) and charge it directly, as in lab 9:

``` { .bash .copy }
docker compose up -d --build --wait payment
curl -s -w '\n%{http_code}\n' -X POST localhost:8085/payments -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: sandbox-1' -d '{"orderId":"5b0c2f9e-7d0a-4f43-9a55-1c1c2c8f8e10","amount":350.00}'
```

You should see `201` and `"status":"AUTHORIZED","providerRef":"pi_…"`. In the Dashboard (**Payments**), a R$ 350.00 payment shows the metadata `order_id` and `idempotency_key`. Then:

- **The same request again**: `200`, the same `id` and `providerRef` — and still one payment in the Dashboard.
- **A declined card**, with a new key: add `"paymentMethod":"pm_card_visa_chargeDeclined"` to the body and use `Idempotency-Key: sandbox-2`. You should see `201` with `"status":"DECLINED"`; `pm_card_visa_chargeDeclinedInsufficientFunds` declines too, for another reason (both are Stripe test payment methods).
- **End to end**, through `order` and Toxiproxy, as in lab 9:

``` { .bash .copy }
ID=$(curl -s -X POST localhost:8084/orders -H 'Content-Type: application/json' \
  -d '{"showId":"show-9","holdId":"hold-sandbox-1","customerEmail":"bia@example.com","amount":350.00}' | jq -r .id)
curl -s -X POST localhost:8084/orders/$ID/pay | jq '{id, status}'
```

You should see `"status":"CONFIRMED"`. If the first `pay` answers `503`, Stripe took longer than `order`'s 1 s read timeout: `payment` still finished and saved the charge, so calling `pay` again confirms the order with the same PaymentIntent — the lost answer of step 5, by accident.

## 4. Webhooks: the provider tells you later

A synchronous answer can be lost; Stripe also **calls you back** with an event for every change of a PaymentIntent. In the sandbox, events are retried three times within a few hours if your endpoint does not answer `2xx`; the same event can arrive **more than once**, and events can arrive **out of order**. So the endpoint must: prove the call comes from Stripe, process each event once, answer quickly.

=== "StripeWebhookController.java"

    ``` { .java .copy linenums="1" title="services/payment/src/main/java/boxoffice/payment/StripeWebhookController.java" }
    --8<-- "docs/2027.1/hands-on/14/code/services/payment/src/main/java/boxoffice/payment/StripeWebhookController.java"
    ```

=== "StripeSignature.java"

    ``` { .java .copy linenums="1" title="services/payment/src/main/java/boxoffice/payment/StripeSignature.java" }
    --8<-- "docs/2027.1/hands-on/14/code/services/payment/src/main/java/boxoffice/payment/StripeSignature.java"
    ```

=== "PaymentService.java"

    ``` { .java .copy linenums="1" title="services/payment/src/main/java/boxoffice/payment/PaymentService.java" }
    --8<-- "docs/2027.1/hands-on/14/code/services/payment/src/main/java/boxoffice/payment/PaymentService.java"
    ```

=== "V2__stripe_events.sql"

    ``` { .sql .copy linenums="1" title="services/payment/src/main/resources/db/migration/V2__stripe_events.sql" }
    --8<-- "docs/2027.1/hands-on/14/code/services/payment/src/main/resources/db/migration/V2__stripe_events.sql"
    ```

=== "StripeSignatureTest.java"

    ``` { .java .copy linenums="1" title="services/payment/src/test/java/boxoffice/payment/StripeSignatureTest.java" }
    --8<-- "docs/2027.1/hands-on/14/code/services/payment/src/test/java/boxoffice/payment/StripeSignatureTest.java"
    ```

- **The signature.** `Stripe-Signature: t=<unix time>,v1=<hex>` where `v1` is the HMAC-SHA256 (a hash-based message authentication code: a SHA-256 hash keyed with the endpoint's secret) of `<t>.<raw body>`. The controller reads the body as a `String` — parsing first and serializing again would change the bytes — compares in constant time and rejects a timestamp older than 5 minutes, so a captured request cannot be replayed later.
- **Once per event.** `stripe_events` has the event id as primary key; `INSERT … ON CONFLICT DO NOTHING` returns 0 for a repeat, and the repeat is acknowledged and skipped.
- **The webhook heals.** If no payment has that PaymentIntent — the charge went through but its answer never reached the database — the metadata recreates it, with the same idempotency key. The next `pay` of that order finds it.

**Forward the sandbox's events to `payment`.** The Stripe command-line interface (CLI) opens a connection to Stripe and forwards events to a local URL — no public address needed. Get its signing secret (it does not change between runs), put it in `.env`, restart `payment` and start the forwarder:

``` { .bash .copy }
docker compose run --rm --no-deps stripe-cli listen --print-secret     # prints whsec_…
echo "STRIPE_WEBHOOK_SECRET=whsec_..." >> .env                         # paste the value it printed
docker compose up -d --wait payment
docker compose --profile stripe up -d stripe-cli
docker compose logs stripe-cli | grep -i ready
```

You should see `Ready! … Your webhook signing secret is whsec_…` (the same value). Pay another order (step 3) and follow the logs:

``` { .bash .copy }
docker compose logs -f payment | grep webhook
```

You should see `webhook evt_… payment_intent.succeeded pi_… → AUTHORIZED`, a moment after the `pay` answered: the event confirms what the synchronous answer said.

**A replay and a forgery.** `scripts/send-webhook.sh` signs an event the way Stripe does, with the secret from `.env`:

``` { .bash .copy linenums="1" title="scripts/send-webhook.sh" }
--8<-- "docs/2027.1/hands-on/14/code/scripts/send-webhook.sh"
```

``` { .bash .copy }
cat > /tmp/evt.json <<EOF
{"id":"evt_sandbox_1","type":"payment_intent.succeeded","data":{"object":{"id":"pi_sandbox_1","status":"succeeded","amount":35000,"metadata":{"order_id":"5b0c2f9e-7d0a-4f43-9a55-1c1c2c8f8e11","idempotency_key":"sandbox-replay"}}}}
EOF
bash scripts/send-webhook.sh /tmp/evt.json                 # applied 200
bash scripts/send-webhook.sh /tmp/evt.json                 # duplicate 200
bash scripts/send-webhook.sh /tmp/evt.json whsec_wrong     # bad signature 400
```

The first call stores a payment that `payment` never charged — exactly what step 5 needs from a real event. The second is skipped, the third rejected (and logged as `webhook rejected`).

## 5. The lost answer: charged, but nobody knows { #the-unknown-checkouts }

The worst case of lab 9: Stripe charged, and `payment` crashed before saving — or `order` timed out on all its attempts. For the fan, the checkout is UNKNOWN; for the provider, the money moved. Reproduce it: create an order, then send Stripe exactly the request `payment` sends, **by hand**, as if `payment` had died right after:

``` { .bash .copy }
ID=$(curl -s -X POST localhost:8084/orders -H 'Content-Type: application/json' \
  -d '{"showId":"show-9","holdId":"hold-sandbox-2","customerEmail":"bia@example.com","amount":350.00}' | jq -r .id)
KEY=$(grep '^STRIPE_SECRET_KEY=' .env | cut -d= -f2-)
curl -s https://api.stripe.com/v1/payment_intents -u "$KEY:" -H "Idempotency-Key: order-$ID" \
  -d amount=35000 -d currency=brl -d payment_method=pm_card_visa -d confirm=true \
  -d "automatic_payment_methods[enabled]=true" -d "automatic_payment_methods[allow_redirects]=never" \
  -d "metadata[order_id]=$ID" -d "metadata[idempotency_key]=order-$ID" | jq '{id, status}'
```

You should see `"status": "succeeded"`: the fan was charged and BoxOffice has no record. Then:

1. `docker compose logs payment | grep webhook | tail -1` — the event arrived and `payment` **created** the payment from its metadata.
2. `curl -s -X POST localhost:8084/orders/$ID/pay | jq '{id, status}'` — the fan (or a retry) pays again: `CONFIRMED`. `payment` found the payment by the key `order-<id>` and did not call Stripe; had it called, Stripe would have replayed the same PaymentIntent for that key.
3. In the Dashboard, search the order id in the metadata: **one** payment.

The simulator shows the scale of the problem with lab 9's client and a slow provider:

<div class="csim" data-sim="idempotent-retry" data-key="order" data-provider="slow"></div>

!!! tip "Try it"

    With lab 9's client (1 s read timeout, 3 attempts) against a slow provider, 40.2% of the calls time out. One key per order (lab 9's `order-<orderId>`) keeps 1,000 charges for 1,000 fans — 0 duplicates — but 133 checkouts end UNKNOWN, each charged once: those are what this lab's webhook and reconciliation resolve. Switch the key to "none": 392 fans pay twice or more.

<div class="sdp" data-scenario="boxoffice-payment" data-mode="compact" data-height="460"></div>

## 6. Reconcile: the provider is the source of truth

Webhooks can be missed (an endpoint down for more than a few hours, a bug that answered `200` and did nothing). A periodic **reconciliation** compares every recent payment with the provider's PaymentIntent:

``` { .java .copy linenums="1" title="services/payment/src/main/java/boxoffice/payment/Reconciliation.java" }
--8<-- "docs/2027.1/hands-on/14/code/services/payment/src/main/java/boxoffice/payment/Reconciliation.java"
```

``` { .bash .copy }
curl -s 'localhost:8085/payments/reconcile?window=PT2H' | jq
```

You should see `checked` counting your Stripe payments of the last two hours (lab 9's fake `ch_…` references are skipped) and **one** mismatch: `{"providerRef": "pi_sandbox_1", "ours": "AUTHORIZED", "stripe": "missing"}` — the event you signed yourself in step 4 recorded a payment Stripe never made. That is the worst kind of mismatch (a ticket sold for nothing), and the reason reconciliation exists. Remove it, then break a real one on purpose and find it:

``` { .bash .copy }
docker compose exec db psql -U boxoffice -d boxoffice -c "DELETE FROM payment.payments WHERE provider_ref = 'pi_sandbox_1'"
curl -s 'localhost:8085/payments/reconcile?window=PT2H' | jq '.mismatches'        # []
docker compose exec db psql -U boxoffice -d boxoffice -c \
  "UPDATE payment.payments SET status = 'DECLINED' WHERE id = (SELECT id FROM payment.payments WHERE status = 'AUTHORIZED' AND provider_ref LIKE 'pi_%' LIMIT 1)"
curl -s 'localhost:8085/payments/reconcile?window=PT2H' | jq '.mismatches'
```

You should see one mismatch: `"ours": "DECLINED", "stripe": "succeeded"` — a fan who paid and whose order BoxOffice would have cancelled. In production this report runs on a schedule and every mismatch becomes an alert or an automatic fix (confirm the order, or refund).

!!! info "Costs and limits of the sandbox"

    The sandbox has rate limits lower than live mode and keeps test data until you delete it (**Developers → … → Delete all test data**). `GET /payments/reconcile` makes one Stripe call per payment: fine for a lab, a job with pagination (`GET /v1/payment_intents?created[gte]=…`) for real volumes.

## 7. Pix with Mercado Pago

The `Psp` interface is the seam for any provider. Mercado Pago is the common choice in Brazil for **Pix**, and Pix changes one thing in the flow: the answer to "charge" is **not** "paid" — it is a QR code. The fan pays later, in the bank's app, and only the **webhook** says the money arrived. What is a safety net with Stripe's cards becomes the main path.

| | Stripe (this lab) | Mercado Pago, Pix |
|---|---|---|
| Sandbox | test mode keys `sk_test_…` | test credentials (test access token) from the developer panel |
| Create | `POST /v1/payment_intents`, `confirm=true` | `POST /v1/orders` (Orders API), the Pix payment method in `transactions.payments` |
| Idempotency | `Idempotency-Key` header | `X-Idempotency-Key` header (required) |
| First answer | `succeeded`, or a 402 decline | pending, with a QR code (`qr_code`, `qr_code_base64`) to show the fan |
| Confirmation | webhook `payment_intent.succeeded`, `Stripe-Signature` | notification with an `x-signature` header (`ts=…,v1=…`), verified with the secret of **Configuração de Webhooks** (the official software development kit, SDK, implements the HMAC check) |
| Test outcomes | test payment methods (`pm_card_visa…`) | test cards whose holder name picks the result (`APRO` approved, `OTHE` error, `CONT` pending, `FUND` insufficient funds), taxpayer number (CPF) `12345678909` |

A `MercadoPagoPsp` would return `Charge(id, false)` with a new state — "pending" — that `order` must show as "waiting for payment", and the webhook would move the payment to `AUTHORIZED`. Check the current [Mercado Pago developer documentation](https://www.mercadopago.com.br/developers/pt/docs){target="_blank"} before writing it: the field names of the Orders API differ from the older Payments API.

!!! success "Best practices in this lab"

    - **Keep the provider behind an interface** — `Psp` with `PspClient` and `StripePsp`; `order` never learns which one charged ([Compute — external integrations](../../classes/compute/integrations/index.md)).
    - **One idempotency key per order, end to end** — `order-<orderId>` from `order`, the unique column of `payments` and Stripe's `Idempotency-Key` are the same value, so no retry anywhere charges twice ([Distributed Systems](../../classes/distributed/index.md)).
    - **Treat a decline as an answer, not a failure** — `StripePsp` maps the 402 to `DECLINED`; only real failures reach lab 9's retry and breaker ([Reliability patterns](../../classes/reliability/patterns/index.md)).
    - **Verify every webhook, process each event once** — `StripeSignature` (HMAC, constant time, 5-minute tolerance) and the `stripe_events` table ([Network & Security](../../classes/network-security/index.md)).
    - **Reconcile against the source of truth** — `Reconciliation` finds what webhooks missed; money needs a second check, not trust ([Observability](../../classes/observability/index.md)).
    - **Secrets from the environment, test keys only** — `.env` ignored by Git, `sk_test_` enforced at startup.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `payment` exits: `STRIPE_SECRET_KEY must be a test key (sk_test_…)` | `PSP_PROVIDER=stripe` with an empty or live key | put the `sk_test_…` key in `.env`, or remove `PSP_PROVIDER` to go back to the fake |
| `500` and `Stripe answered 401: Invalid API Key provided` in the logs | the key was copied wrong, or rolled | copy it again from **Developers → API keys** |
| `Stripe answered 400` mentioning the currency | your account's country does not accept BRL charges | add `STRIPE_CURRENCY=usd` to `.env` and restart `payment` |
| `Stripe answered 400` about idempotency | the same `Idempotency-Key` sent with different parameters (another amount or card) | use a new key for a new request; a key means "this exact request" |
| webhooks answer `400 bad signature` | `STRIPE_WEBHOOK_SECRET` differs from what `listen --print-secret` prints, or `payment` was not restarted after editing `.env` | fix `.env`, then `docker compose up -d --wait payment` |
| no `webhook` line in the logs | `stripe-cli` is not running (it has a profile) | `docker compose --profile stripe up -d stripe-cli`; check `docker compose logs stripe-cli` |
| the first `pay` answers `503` | Stripe answered after `order`'s 1 s read timeout | call `pay` again: the charge was saved, the same key returns it |

## Clean up

``` { .bash .copy }
docker compose --profile stripe stop stripe-cli
sed -i.bak '/^PSP_PROVIDER=/d' .env && rm .env.bak       # back to lab 9's fake provider
docker compose up -d --wait payment
```

Keep the key in `.env` (it stays out of Git) or delete it; in the Dashboard you can delete all test data.

## Deliverable

- [ ] `payment` charges the sandbox: one `AUTHORIZED`, the same payment for a repeated key, one `DECLINED` (paste the three answers in `results/lab14.md`).
- [ ] `StripeSignatureTest` passes (5 tests); a forged webhook gets `400`, a replayed one is a `duplicate`.
- [ ] The lost answer of step 5: the webhook created the payment and `pay` confirmed the order — one payment in the Dashboard.
- [ ] `GET /payments/reconcile`: the `missing` payment of step 4, no mismatch after removing it, then the one you made (paste the three).
- [ ] In `results/lab14.md`, three sentences: what a `MercadoPagoPsp` for Pix changes in `order`.
- [ ] [Quiz](quiz.md) answered.

## End state

``` { .tree title="boxoffice/ after lab 14 (changes only)" }
boxoffice/
    .env                                   # not in Git: PSP_PROVIDER, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
    compose.yaml                           # payment's Stripe variables, stripe-cli (profile stripe)
    scripts/send-webhook.sh
    services/payment/
        pom.xml                            # + spring-boot-starter-test
        src/main/java/boxoffice/payment/
            Psp.java  PspClient.java  StripePsp.java  StripeSignature.java
            StripeWebhookController.java  Reconciliation.java
            ChargeRequest.java  PaymentService.java
        src/main/resources/application.yaml
        src/main/resources/db/migration/V2__stripe_events.sql
        src/test/java/boxoffice/payment/StripeSignatureTest.java
```

## What breaks next { #what-breaks-next }

Every checkout is now charged once and every charge is known — but knowing is not fixing. The reconciliation's mismatch is a fan who paid for an order BoxOffice cancelled: that needs a **refund** (`POST /v1/refunds`) or a late confirmation, decided by a job, not by hand. Cards that ask for 3-D Secure need the fan's browser (Stripe.js), which means a front end and a `requires_action` state the server alone cannot finish. Pix makes "pending" the normal case, so `order` must learn a third state. And real money means live keys, a verified business and the card-data rules of the Payment Card Industry Data Security Standard (PCI DSS) — kept small precisely because card numbers never touch BoxOffice. Whether all of this still holds at 10:00, with 2 million fans, is the question of [class 15 — Performance Engineering](../../classes/performance/index.md) and of your [project](../../exercises/project/index.md).
