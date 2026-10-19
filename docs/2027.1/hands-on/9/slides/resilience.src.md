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

<div class="kicker">System Architecture · Insper</div>

# Hands-on 9 — Resilience & Chaos

**One slow payment provider must not take down the checkout**

<!--
Outline: (1) the cascade; (2) payment, psp, Toxiproxy; (3) timeout; (4) retry + idempotency;
(5) circuit breaker; (6) bulkhead; (7) game day; (8) measure.
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

| Container | Role |
|---|---|
| `payment` (8085) | adapter: idempotent `POST /payments`, timeouts to the provider |
| `psp` (WireMock) | fake external provider: `POST /v1/charges` → `approved` |
| `toxiproxy` (8474) | TCP proxies `payment` (18085) and `psp` (18095): latency, resets, outages |

- `order` → `toxiproxy:18085` → `payment` → `toxiproxy:18095` → `psp`.
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
max-attempts: 3
wait-duration: 200ms
enable-exponential-backoff: true      # 200 ms, 400 ms
enable-randomized-wait: true
randomized-wait-factor: 0.5           # ± 50% jitter
retry-exceptions: [ResourceAccessException, HttpServerErrorException]
```

- Transient error with *p* = 0.3 → three attempts fail with *p*³ = 2.7%.
- Costs: up to 3× load, more latency. **Only on idempotent calls.**

---

## Idempotency end to end

- `order` sends `Idempotency-Key: order-<id>` on every attempt.
- `payment` stores it `UNIQUE`; a known key returns the first result (`200`).
- `payment` forwards it to the provider.

<div class="ok">

A timeout does not mean the call failed — the response may have been lost. The key makes the retry harmless.

</div>

---

## 3 · Circuit breaker

- **Closed**: calls flow; failures and slow calls are counted (window of 20, min 10).
- **Open** (≥ 50% failed or slow): fail **immediately** for 10 s — no network, no retry.
- **Half-open**: 3 trial calls decide → closed or open again.
- Protects the caller's threads **and** gives the dependency room to recover.

<p class="small">Watch it: <code>/actuator/circuitbreakers</code>, <code>/actuator/circuitbreakerevents</code>.</p>

---

## 4 · Bulkhead

<div class="q">

Calls succeed in 700 ms — below the timeout and the slow-call threshold. At 70/s, `GET /orders/{id}` slows down anyway. Why, and what fixes it?

</div>

* 70/s × 0.7 s ≈ **49** of 50 threads wait on `payment`.
* Bulkhead `max-concurrent-calls: 10`, `max-wait-duration: 0` → the 11th call gets `503` now.
* The other 40 threads keep serving everything else.

---

## How the annotations stack

```java
@Retry(name = "payment", fallbackMethod = "unavailable")
@CircuitBreaker(name = "payment")
@Bulkhead(name = "payment")
public PaymentResponse charge(UUID orderId, BigDecimal amount) { ... }
```

- Default order: **Retry ( CircuitBreaker ( Bulkhead ( call ) ) )**.
- Fallback on the **outermost** layer → runs after retries, when open, when full.
- Retry **ignores** `CallNotPermittedException` and `BulkheadFullException`: fail fast.
- The breaker ignores `BulkheadFullException`: our refusal is not the dependency's fault.

---

## Never wait inside a transaction

- `pay()` calls `payment` with **no** transaction open.
- Then a short transaction: `UPDATE … WHERE status = 'PENDING_PAYMENT'` + outbox event.
- Waiting 3 s inside a transaction moves the exhaustion to the **connection pool** (≈ 10).

---

<!-- _class: tight -->

## Measure it

| Experiment | Toxic | Before → after |
|---|---|---|
| Timeout | latency 3 s | `pay` p95, **`browse` p95** |
| Retry | reset_peer 30% | confirmed % |
| Circuit breaker | proxy disabled | `pay` p95, `pay_fast_fail` |
| Bulkhead | latency 700 ms, 70 pay/s | `browse` p95, rejected % |

<p class="small">k6 <code>load/pay-under-chaos.js</code>: <code>pay</code> (uses payment) and <code>browse</code> (does not) at the same time — the second one reveals the cascade.</p>

---

## 5 · Game day

- **Roles**: game master (injects, hidden), operators (detect, mitigate), scribe (timeline).
- **Before**: steady state, hypotheses, blast radius, abort = `POST /reset`.
- **During**: alert → dashboard → trace → logs; mitigate first.
- **After**: blameless review — time to detect, time to mitigate, action items.

<div class="warn">

No hypothesis, no experiment. A refuted hypothesis is the valuable result.

</div>

---

## Try it in the playground

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
5. Never hold a DB transaction across a remote call.
6. Practice failure: **game days** with hypotheses and blameless reviews.
