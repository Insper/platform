---
marp: true
lang: en
title: Hands-on 9 — Resilience & Chaos
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

<div class="kicker">System Architecture · Insper</div>

# Hands-on 9 — Resilience & Chaos

**One slow payment provider must not take down the checkout**

<!--
Outline: (1) the cascade; (2) payment, psp, Toxiproxy; (3) timeout; (4) retry + idempotency;
(5) circuit breaker; (6) bulkhead; (7) the five runs in the simulator; (8) game day; (9) measure.
-->

---

## Nothing is down. Everything is broken.

<div class="q">

10:00, flash sale. The payment provider answers in 3 s instead of 300 ms. Within a minute `order`
stops answering **everything** — even `GET /orders/{id}`. Why?

</div>

* 20 payments/s × 3 s = **60 threads** just waiting on `payment`.
* `order` has 50 → every request queues: a **cascading failure**.
* Little's Law: concurrency = rate × time held.

---

## The lab setup

<div class="flow">
<div class="box muted">k6<small>pay 20/s + browse 20/s</small></div><div class="arrow">→</div>
<div class="box accent">order<small>50 threads · Resilience4j</small></div><div class="arrow">:18085 →</div>
<div class="box orange">toxiproxy<small>proxy payment</small></div><div class="arrow">→</div>
<div class="box">payment<small>8085 · idempotent</small></div><div class="arrow">:18095 →</div>
<div class="box orange">toxiproxy<small>proxy psp</small></div><div class="arrow">→</div>
<div class="box">psp<small>WireMock</small></div>
</div>

- `payment`: adapter to the payment service provider (PSP), `POST /payments` idempotent by `Idempotency-Key`.
- `toxiproxy` (API on 8474): Transmission Control Protocol (TCP) proxies — latency, resets, outages, **two places to break**.
- New endpoint: `POST /orders/{id}/pay` → `CONFIRMED` + `OrderConfirmed` in the outbox.

---

## Toxics

| Toxic | Simulates |
|---|---|
| `latency` (+ `jitter`) | slow dependency |
| `timeout` (0) | black hole |
| `reset_peer` | connection reset |
| `bandwidth` | thin pipe |
| proxy `enabled: false` | dependency down |

```shell
curl -X POST localhost:8474/proxies/payment/toxics \
  -d '{"name":"slow","type":"latency","attributes":{"latency":3000}}'
```

<p class="small"><code>toxicity</code> 0–1: the probability per connection. <code>POST /reset</code> is the abort button.</p>

---

## 1 · Timeout

```java
factory.setConnectTimeout(Duration.ofMillis(500));
factory.setReadTimeout(Duration.ofSeconds(1)); // 0 = forever (the default!)
```

- A thread is held **at most 1 s**: 20/s × 1 s = 20 threads → the pool survives.
- Slow failure → **fast failure**; fast failures do not cascade.

<div class="warn">

Budgets shrink at each hop: edge 10 s > gateway 5 s > order→payment 1 s × attempts.

</div>

---

## 2 · Retry, backoff, jitter

```yaml
max-attempts: ${PAYMENT_RETRY_ATTEMPTS:3}
wait-duration: 200ms
enable-exponential-backoff: true      # 200 ms, 400 ms
enable-randomized-wait: true
randomized-wait-factor: 0.5           # ± 50% jitter
retry-exceptions: [ResourceAccessException, HttpServerErrorException, RestClientException]
ignore-exceptions: [HttpClientErrorException, CallNotPermittedException, BulkheadFullException]
```

- Per attempt *p* = 0.3 → three attempts fail with *p*³ = 2.7%. Measured: **0.5% → 0.1%** — the toxic hits only **new** connections.
- Costs: up to 3× load, more latency. **Only on idempotent calls.**

---

## Idempotency end to end

<div class="flow">
<div class="box accent">order<small>Idempotency-Key: order-&lt;id&gt;, same on every attempt</small></div><div class="arrow">→</div>
<div class="box green">payment<small>key UNIQUE · known key = first result (200)</small></div><div class="arrow">→</div>
<div class="box">provider<small>gets the same key</small></div>
</div>

<div class="ok">

A timeout does not mean the call failed — the response may have been lost. The key makes the retry harmless.

</div>

---

## 3 · Circuit breaker

<div class="flow">
<div class="box green">CLOSED<small>window of 20, min 10</small></div><div class="arrow">proxy disabled · 10 calls fail →</div>
<div class="box red">OPEN<small>CallNotPermitted · 503 in µs</small></div><div class="arrow">10 s →</div>
<div class="box orange">HALF_OPEN<small>3 probes</small></div><div class="arrow">proxy back →</div>
<div class="box green">CLOSED</div>
</div>

- Opens at ≥ 50% failed **or** ≥ 50% slower than 800 ms — no network, no retry, no waiting.
- Protects the caller's threads **and** gives the dependency room to recover.
- Time from re-enable to `CLOSED`: up to 10 s plus the probes — it depends on where the wait was.

<p class="small">Watch it: <code>/actuator/circuitbreakers</code>, <code>/actuator/circuitbreakerevents</code>.</p>

---

## 4 · Bulkhead

<div class="q">

Calls succeed in 700 ms — below the timeout and the slow-call threshold. At 70/s, `GET /orders/{id}` slows down anyway. Why, and what fixes it?

</div>

* 70/s × 0.7 s ≈ **49** of 50 threads wait on `payment`.
* Bulkhead `max-concurrent-calls: 10`, `max-wait-duration: 0` → the 11th call gets `503` now.

<div class="flow">
<div class="box">order<small>50 threads</small></div><div class="arrow">→</div>
<div class="box orange">bulkhead: 10<small>wait 700 ms on payment</small></div><div class="arrow">+</div>
<div class="box green">the other 40<small>GET /orders/{id} in ms</small></div><div class="arrow">+</div>
<div class="box red">the rest<small>503 at once (~85%)</small></div>
</div>

---

## How the annotations stack

```java
@Retry(name = "payment", fallbackMethod = "unavailable")
@CircuitBreaker(name = "payment")
@Bulkhead(name = "payment")
public PaymentResponse charge(UUID orderId, BigDecimal amount) { ... }
```

<div class="flow">
<div class="box accent">Retry<small>3 attempts</small></div><div class="arrow">→</div>
<div class="box accent">CircuitBreaker<small>open: fail fast</small></div><div class="arrow">→</div>
<div class="box accent">Bulkhead<small>full: fail fast</small></div><div class="arrow">→</div>
<div class="box">call</div><div class="arrow">any refusal →</div>
<div class="box red">fallback: 503</div>
</div>

- Retry **ignores** `CallNotPermittedException` and `BulkheadFullException`; the breaker ignores `BulkheadFullException`.

---

## Never wait inside a transaction

- `pay()` calls `payment` with **no** transaction open.
- Then a short transaction: `UPDATE … WHERE status = 'PENDING_PAYMENT'` + outbox event.
- Waiting 3 s inside a transaction moves the exhaustion to the **connection pool** (≈ 10).

---

## Simulator: the five runs, without the stack

<div class="flow">
<div class="box red">timeout, before<small>browse med 4.75 s · 65 iterations dropped</small></div><div class="arrow">→</div>
<div class="box green">after (1 s)<small>pay fails in 1.01 s · browse p95 8 ms</small></div>
</div>
<div class="flow">
<div class="box">retry<small>0.3% → 0.0% failed</small></div>
<div class="box">breaker<small>opens 0.3 s · closes 61.1 s</small></div>
<div class="box">bulkhead<small>58% fail fast, browse p95 759 ms → 81% rejected, 8 ms</small></div>
</div>

- The patterns page's **pay-under-chaos** simulator: pick a step, before or after its pattern, and read k6's summary.
- The model's numbers are not yours — compare the **shape** with your own runs.

---

<!-- _class: tight -->

## Measure it

| Experiment | Toxic | Before → after |
|---|---|---|
| Timeout | latency 3 s | `pay` p95, **`browse` p95** |
| Retry | reset_peer 30% | confirmed % |
| Circuit breaker | proxy disabled | `pay` p95, `pay_fast_fail` |
| Bulkhead | latency 700 ms, 70 pay/s | `browse` p95, rejected % |

<div class="ok">

A test run (45 s, payment + 3 s): `browse` p50 **9.04 s** unprotected, **6.5 ms** with every pattern — reproduce the contrast, not the numbers.

</div>

<p class="small">k6 <code>load/pay-under-chaos.js</code>: <code>pay</code> (uses payment) and <code>browse</code> (does not) at the same time — the second one reveals the cascade.</p>

---

## 5 · Game day

<div class="flow">
<div class="box orange">game master<small>injects, hidden</small></div><div class="arrow">→</div>
<div class="box red">alert fires</div><div class="arrow">→</div>
<div class="box accent">operators<small>dashboard → trace → logs</small></div><div class="arrow">→</div>
<div class="box green">mitigate first</div><div class="arrow">→</div>
<div class="box">scribe<small>detect / mitigate times</small></div>
</div>

- **Before**: steady state, hypotheses, blast radius, abort = `POST /reset`; the burn-rate rules for `order`.
- **After**: blameless review — time to detect, time to mitigate, action items. Rotate roles.

<div class="warn">

No hypothesis, no experiment. A refuted hypothesis is the valuable result.

</div>

---

## Try it in the playground

- `boxoffice-payment`: this lab — at t = 60 s payment gets +3 s; add timeout, retries, breaker and a bulkhead of 0.2.
- `cascading-failure`: raise the 3rd-party latency, watch utilization hit 100%; add timeout + breaker.
- `retry-storm`: retries without backoff amplify an outage; add `exp+jitter`.

<div class="ok">

The simulator shows the shape; k6 + Toxiproxy give you your own numbers.

</div>

---

## Takeaways

1. A slow dependency is worse than a dead one: it **exhausts threads** (Little's Law).
2. **Timeouts** everywhere, shorter at each inner hop.
3. **Retries** with backoff + jitter, only on transient errors, only with **idempotency keys**.
4. **Circuit breakers** fail fast and let dependencies recover; **bulkheads** cap concurrency per dependency.
5. Never hold a database transaction across a remote call.
6. Practice failure: **game days** with hypotheses and blameless reviews.
