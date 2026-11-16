---
marp: true
lang: en
title: Hands-on 14 — Payments in a Sandbox
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

<div class="kicker">System Architecture · Insper · Lab 14</div>

# Lab 14 — Payments in a Sandbox

**A real payment provider, no real money: Stripe's test mode behind lab 9's adapter — keys, webhooks, reconciliation**

<!--
Chapter 10, second lab: ties classes 3 (a retried buy can charge twice), 10 (the payment provider) and 12 (prove who calls)
together. Outline: (1) a sandbox and a test key; (2) the Psp adapter; (3) charge, repeat, decline; (4) signed webhooks,
once per event; (5) the lost answer; (6) reconciliation; (7) Pix with Mercado Pago.
-->

---

## The story so far

<div class="flow" style="font-size: 1.1em">
<div class="box muted">class 3 · lab 9<small>one key per order, against a fake provider</small></div><div class="arrow">→</div>
<div class="box accent">chapter 10 · lab 14<small>a real provider's sandbox: Stripe test mode</small></div><div class="arrow">→</div>
<div class="box">next · class 15<small>does it hold at 10:00?</small></div>
</div>

<div class="q">

Lab 9's client gives up after **1 s and 3 attempts**. On a slow provider day, **133 of 1,000** checkouts end UNKNOWN: charged, but nobody knows. Who tells us what happened?

</div>

- The provider does — later, maybe twice — if we verify it and listen.

<!--
The story of the course (2027.1 overview); the 133 come from the idempotent-retry simulator with lab 9's client and the slow provider.
-->

---

## What a real provider adds

<div class="matrix" style="--n: 2; font-size: 1.15em">
<div></div><div class="head">lab 9's fake (WireMock)</div><div class="head">Stripe sandbox</div>
<div class="row">access</div><div class="box muted">none</div><div class="box accent" style="flex-direction: column">a secret key<small>sk_test_…, in .env, never in Git</small></div>
<div class="row">money</div><div class="box muted">a decimal</div><div class="box accent" style="flex-direction: column">centavos<small>R$ 350.00 → amount=35000</small></div>
<div class="row">"no"</div><div class="box muted">never</div><div class="box orange" style="flex-direction: column">HTTP 402 card_error<small>a decline is an answer</small></div>
<div class="row">later</div><div class="box muted">nothing</div><div class="box green" style="flex-direction: column">webhooks<small>signed, at least once, any order</small></div>
</div>

- No money moves: `livemode: false`. The service refuses to start with a live key.

---

## 2 · One interface, two providers

<div class="flow" style="font-size: 1.15em; align-items: stretch">
<div class="box" style="flex: .7; display: flex; flex-direction: column; justify-content: center">order<small>sees AUTHORIZED / DECLINED</small></div>
<div class="arrow" style="align-self: center">→</div>
<div class="box accent" style="display: flex; flex-direction: column; justify-content: center">payment · Psp<small>boxoffice.psp.provider</small></div>
<div class="arrow" style="align-self: center">→</div>
<div class="group">
<div class="caption">implementations</div>
<div class="box muted">PspClient · fake<small>the default: chaos labs and CI need no key</small></div>
<div class="box green">StripePsp · stripe<small>POST /v1/payment_intents, confirm=true</small></div>
</div>
</div>

- `order` never learns which provider charged: the adapter of lab 9, now with a seam.
- Card numbers never touch BoxOffice: a test payment method (`pm_card_visa`) stands for what Stripe.js gives in a browser.

---

## 3 · Charge, repeat, decline

<div style="font-size: 1.1em">
<div class="flow">
<div class="arrow" style="flex: .5; text-align: left">key sandbox-1</div>
<div class="box">POST /payments</div><div class="arrow">→</div>
<div class="box accent">PaymentIntent<small>Idempotency-Key: sandbox-1</small></div><div class="arrow">→</div>
<div class="box green">201 AUTHORIZED<small>pi_…</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .5; text-align: left">sandbox-1 again</div>
<div class="box">POST /payments</div><div class="arrow">→</div>
<div class="box muted">found in payments<small>Stripe not called</small></div><div class="arrow">→</div>
<div class="box green">200 · the same pi_…<small>one payment in the Dashboard</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .5; text-align: left">key sandbox-2</div>
<div class="box">pm_card_visa_chargeDeclined</div><div class="arrow">→</div>
<div class="box orange">HTTP 402 card_error</div><div class="arrow">→</div>
<div class="box orange">201 DECLINED<small>not an exception: no retry, no breaker</small></div>
</div>
</div>

- End to end through `order`: `CONFIRMED` — or a `503` when Stripe beats the 1 s timeout; pay again.

---

## 4 · Webhooks: the provider tells you later

<div class="flow" style="font-size: 1.1em">
<div class="box accent">Stripe<small>payment_intent.succeeded</small></div><div class="arrow">→</div>
<div class="box">stripe-cli listen<small>no public address needed</small></div><div class="arrow">→</div>
<div class="box orange">signature?<small>HMAC of t.body · ≤ 5 min</small></div><div class="arrow">→</div>
<div class="box orange">seen before?<small>stripe_events, evt_… id</small></div><div class="arrow">→</div>
<div class="box green">apply · 200<small>update or create the payment</small></div>
</div>

<div class="matrix" style="--n: 3; font-size: 1.1em">
<div></div><div class="head">signed, new</div><div class="head">signed, again</div><div class="head">forged</div>
<div class="row">send-webhook.sh</div><div class="box green">applied 200</div><div class="box muted">duplicate 200</div><div class="box red">bad signature 400</div>
</div>

- HMAC: hash-based message authentication code, keyed with `whsec_…`. A sandbox event is retried three times within a few hours, may come twice and out of order.

---

## 5 · The lost answer

<div class="flow" style="font-size: 1.1em">
<div class="box">order created</div><div class="arrow">→</div>
<div class="box orange">Stripe charges<small>key order-&lt;id&gt; · metadata</small></div><div class="arrow">→</div>
<div class="box red">payment dies<small>no row: UNKNOWN</small></div><div class="arrow">→</div>
<div class="box green">webhook<small>creates the row from the metadata</small></div><div class="arrow">→</div>
<div class="box green">pay again<small>CONFIRMED · one charge</small></div>
</div>

- The healed row carries the same idempotency key `order` sends: exactly what the retry looks for.
- Had `payment` called Stripe again, the key would have replayed the same PaymentIntent.

<div class="ok">

One key per order, end to end: `order`, the `payments` table and Stripe's `Idempotency-Key` are the same value.

</div>

---

## Simulator: the UNKNOWN checkouts

<div class="matrix" style="--n: 2; font-size: 1.2em">
<div></div><div class="head">no key</div><div class="head">one key per order</div>
<div class="row">charges for 1,000 fans</div><div class="box red">392 fans pay twice or more</div><div class="box green">1,000 · 0 duplicates</div>
<div class="row">checkouts UNKNOWN</div><div class="box muted">—</div><div class="box orange">133 · each charged once</div>
</div>

- Lab 9's client (1 s, 3 attempts) against a slow provider: 40.2% of the calls time out.
- The key removes the duplicates; the webhook and the reconciliation resolve the UNKNOWN.

<p class="small">Page section 5 · simulator <code>idempotent-retry</code>, key "order", slow provider.</p>

---

## 6 · Reconcile: the provider is the source of truth

<div class="flow" style="font-size: 1.1em">
<div class="box">our payments<small>last 2 hours, pi_… only</small></div><div class="arrow">→</div>
<div class="box accent">retrieve each PaymentIntent</div><div class="arrow">→</div>
<div class="box orange">compare<small>succeeded ↔ AUTHORIZED</small></div><div class="arrow">→</div>
<div class="box green">mismatches</div>
</div>

<div class="matrix" style="--n: 3; font-size: 1.05em">
<div></div><div class="head">the signed replay (step 4)</div><div class="head">after removing it</div><div class="head">one row set to DECLINED</div>
<div class="row">report</div><div class="box red" style="flex-direction: column">ours AUTHORIZED<small>stripe: missing</small></div><div class="box green">[]</div><div class="box orange" style="flex-direction: column">ours DECLINED<small>stripe: succeeded</small></div>
</div>

- Webhooks can be missed; money needs a second check. In production: a schedule, an alert, a fix.

---

## 7 · Pix with Mercado Pago

<div class="flow" style="font-size: 1.1em">
<div class="box">MercadoPagoPsp</div><div class="arrow">→</div>
<div class="box accent">POST /v1/orders<small>X-Idempotency-Key (required)</small></div><div class="arrow">→</div>
<div class="box orange">pending + QR code<small>qr_code, qr_code_base64</small></div><div class="arrow">→</div>
<div class="box muted">the fan pays<small>in the bank's app</small></div><div class="arrow">→</div>
<div class="box green">webhook · x-signature<small>the only "paid"</small></div>
</div>

- With cards the webhook is a safety net; with Pix it is the **main path**.
- `order` needs a third state, "waiting for payment". Test outcomes: holder name `APRO`, `OTHE`, `CONT`, `FUND`.

<p class="small">Check the current Mercado Pago docs: the Orders API names differ from the older Payments API.</p>

---

## Pitfalls

| Symptom | Cause |
|---|---|
| `payment` exits: must be a test key | empty or live key with `PSP_PROVIDER=stripe` |
| `Stripe answered 401` | key copied wrong or rolled |
| `400` about the currency | the account's country does not accept BRL: `STRIPE_CURRENCY=usd` |
| `400` about idempotency | a key reused with other parameters |
| webhooks `400 bad signature` | `STRIPE_WEBHOOK_SECRET` ≠ `listen --print-secret`, or `payment` not restarted |
| first `pay` → `503` | Stripe beat `order`'s 1 s timeout: pay again |

---

## What breaks next

<div class="flow" style="font-size: 1.15em">
<div class="box green">lab 14<small>each checkout charged once, every charge known</small></div><div class="arrow">→</div>
<div class="box orange">knowing is not fixing<small>refunds, 3-D Secure, Pix pending, live keys and PCI DSS</small></div><div class="arrow">→</div>
<div class="box accent">class 15 · project<small>does it all hold at 10:00, with 2 M fans?</small></div>
</div>

- PCI DSS (Payment Card Industry Data Security Standard) stays small because card numbers never touch BoxOffice.

---

## Takeaways

1. A **sandbox** is a real provider without real money; a live key is a bug.
2. Keep the provider behind an **interface**; `order` sees only `AUTHORIZED` / `DECLINED`.
3. **One idempotency key per order**, end to end: no retry anywhere charges twice.
4. A **decline is an answer**, not a failure for the retry and the breaker.
5. **Webhooks**: verify the signature on the raw body, process each event once, answer fast.
6. **Reconcile** against the provider: what webhooks miss, a second check finds.
