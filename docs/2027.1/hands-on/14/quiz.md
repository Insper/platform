Click **"Answer"** to reveal the correct answer and explanation.

---

## Charging a real provider

**Q1.** `order` retries a payment after a timeout. Which keys make sure the fan is charged at most once?

- A. A new random key on every attempt, so Stripe never confuses two attempts
- B. The same key on every attempt of an order (`order-<orderId>`): `payment`'s unique column and Stripe's `Idempotency-Key` both return the first result
- C. No key: Stripe detects duplicates by amount and card
- D. A key per day, so all of a fan's purchases of the day share it

??? success "Answer"
    **B — one key per order, end to end.**

    The idempotency key names *the request*, not the attempt. `payment` looks it up in its `payments` table, and Stripe stores the first result for that key and replays it for every retry. A new key per attempt (A) is the same as no key: every attempt that reached the provider is a new charge — in the simulator, 392 of 1,000 fans pay twice on a slow day.

---

**Q2.** Stripe answers HTTP 402 with `type: card_error` for a declined card. Why does `StripePsp` turn it into `DECLINED` instead of throwing an exception?

- A. Because exceptions are slow in Java
- B. Because a decline is a valid answer about the fan's card: retrying it, or opening `order`'s circuit breaker because of it, would be wrong
- C. Because Stripe requires it
- D. Because 402 means the request will succeed later

??? success "Answer"
    **B — a decline is an answer, not a failure.**

    The provider worked and said "no". Lab 9's retry, breaker and fallback exist for a provider that does not answer (timeouts, 5xx). Counting declines as failures would retry a card that will be declined again and could open the breaker on a day with many declines, blocking fans whose cards are fine.

---

**Q3.** Why does `StripePsp` send amounts as `movePointRight(2).longValueExact()`?

- A. Stripe's API takes amounts in the smallest unit of the currency (centavos), and `longValueExact` fails instead of silently rounding a fraction of a centavo
- B. To convert reais to dollars
- C. Because Stripe does not accept decimals in JSON
- D. To add a 1% fee

??? success "Answer"
    **A — integers in the smallest currency unit, never a silent rounding.**

    R$ 350.00 is `amount=35000`. A value like 350.005 cannot be charged; failing loudly is better than charging a centavo more or less than the order says.

---

## Webhooks and reconciliation

**Q4.** Why does `StripeWebhookController` read the request body as a `String` and check the `Stripe-Signature` before parsing it?

- A. Because Spring cannot parse JSON in a controller
- B. Because the signature is an HMAC of the exact raw bytes (`<t>.<body>`); parsing and serializing again could change them, and an unsigned or wrongly signed body must not be trusted at all
- C. Because Strings are faster than objects
- D. Because Stripe sends XML

??? success "Answer"
    **B — the signature covers the raw body.**

    Anyone who finds the URL could post "payment succeeded". The HMAC with the endpoint's secret proves the body came from Stripe, the 5-minute tolerance rejects a captured request replayed later, and the constant-time comparison does not leak how much of a guessed signature was right.

---

**Q5.** The same `payment_intent.succeeded` event arrives twice. What does `payment` do the second time?

- A. Charges again
- B. Answers 500 so that Stripe stops sending it
- C. The `INSERT … ON CONFLICT DO NOTHING` into `stripe_events` returns 0, so the event is acknowledged with 2xx and skipped
- D. Deletes the payment

??? success "Answer"
    **C — acknowledged and skipped.**

    Stripe delivers at least once: retries and duplicates are normal. Answering an error (B) would make Stripe retry *more*. The event id is the deduplication key, recorded in the same transaction that applies the event.

---

**Q6.** A webhook says a PaymentIntent succeeded, but `payment` has no row for it. What happened, and what does this lab do?

- A. Stripe made a mistake; ignore the event
- B. The charge went through but its answer never reached the database (a crash, or every attempt of `order` timed out): `payment` creates the row from the PaymentIntent's metadata (`order_id`, `idempotency_key`), so the next `pay` of that order finds it and confirms without a second charge
- C. The fan paid twice; refund at once
- D. The event is from another account

??? success "Answer"
    **B — the webhook heals the lost answer.**

    That is the UNKNOWN checkout of lab 9: charged, but nobody knows. Because the metadata carries the same idempotency key `order` uses, the healed row is exactly the one a retry looks for. What the webhook still cannot fix — a payment for an order already cancelled — is what the reconciliation reports.

---

**Q7.** With Pix (Mercado Pago), what changes in the flow compared with this lab's cards?

- A. Nothing: the first answer is "paid", as with cards
- B. The first answer is a pending charge with a QR code; the fan pays later in the bank's app and only the webhook confirms it, so `order` needs a "waiting for payment" state and the webhook becomes the main path
- C. Pix needs no idempotency key
- D. Pix payments cannot be reconciled

??? success "Answer"
    **B — "pending" becomes the normal case.**

    With cards, the webhook confirms what the synchronous answer already said. With Pix, the synchronous answer is only a QR code, and the money arrives when the fan pays. The `X-Idempotency-Key` of the Orders API and the `x-signature` check of the notifications play the same roles as in this lab.
