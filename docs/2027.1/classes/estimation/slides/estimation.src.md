---
marp: true
lang: en
title: Back-of-the-Envelope Estimation
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

# Back-of-the-Envelope Estimation

**Numbers, queues, percentiles and nines — the math behind every design decision**

<!--
Outline: (1) why estimate and the method; (2) numbers every engineer should know; (3) QPS, storage,
bandwidth; (4) Little's Law, utilization and the knee; (5) Amdahl and USL; (6) percentiles and
tail amplification; (7) availability math.
-->

---

## Can one PostgreSQL take the on-sale?

<div class="q">

*"No, we need a distributed database."* — *"Of course it can, Postgres is fast."*
What do you need to know to settle this in five minutes?

</div>

* Demand: how many hold attempts **per second** at 10:00?
* Cost of one hold: how long does it keep the database **busy**?
* Safe operating point: how **full** can the database run before latency explodes?
* Experience: what do the **unlucky** fans see, and how often is it **down**?

---

## Why estimate?

Decisions change by **orders of magnitude** — you need to know which side of a threshold you are on.

| If the estimate says… | …the decision is |
|---|---|
| 40 GB of orders per year | one primary is fine — **don't shard** |
| 1,200 reads/s, 99% repeated | **cache** them |
| 100 k hold attempts/s on 60 k seats | **queue** fans in a waiting room |
| 8 Gbit/s of images | serve from a **CDN** |
| one sync dependency at 99.9% | the service can't promise more — **take it off the path** |

---

## The method

1. **Name the decision** — "do we need to shard?", not "how much data?".
2. **State assumptions** out loud — round numbers.
3. **Powers of ten** — keep one significant digit.
4. **Sanity-check** against a number you know.
5. **Conclude** — the design implication, and the most sensitive assumption.

<div class="ok">

1 day ≈ **10⁵ s** · 1 M/day ≈ **12/s** · 1 year ≈ **3 × 10⁷ s** · 2¹⁰ ≈ **10³** · 1 GB/s = **8 Gbit/s**

</div>

---

<!-- _class: tight -->

## Latency numbers (2020s, orders of magnitude)

| Operation | Latency |
|---|---|
| L1 cache reference | ~1 ns |
| Main memory reference | ~100 ns |
| Random 4 KB read, NVMe SSD | ~20–100 µs |
| Round trip inside a zone | ~0.1–0.5 ms |
| Redis `GET` / primary-key query, same zone | ~0.2–1 ms |
| Round trip between zones | ~1–2 ms |
| HDD seek | ~5–10 ms |
| São Paulo ↔ US East round trip | ~110–130 ms |

<p class="small">Light in fibre: ~5 µs per km → ~1 ms of round trip per 100 km. Sources: Dean (2009), Scott, Gregg.</p>

---

## What the table teaches

- **RAM ≈ 1,000× faster than SSD** for random reads → caches.
- **Inside a data centre, the network costs more than the work** → batch round trips (`MGET`, pipelining).
- **Across regions, physics wins** → no sync cross-region calls on the critical path; serve from nearby.
- **Sequential beats random** → logs, Kafka, batch processing.

<div class="q">

Seat map with 60,000 seats: 60,000 queries ≈ **30 s**; one query ≈ **20–40 ms**; one cached blob ≈ **1–2 ms**. Same data, four orders of magnitude.

</div>

---

## Requests per second

> QPS = daily active users × actions / 86,400 · peak = QPS × peak factor

<div class="cols">
<div>

### Normal day

- 2 M fans × 20 pages = 4 × 10⁷/day
- ≈ **400 reads/s**, peak ×3 ≈ **1,200**
- writes ≈ 5/s → read/write ≈ **100:1**

</div>
<div>

### On-sale spike

- 2 M fans × 3 requests in 60 s
- ≈ **100,000 req/s** at the edge
- **~80×** the normal peak, for minutes

</div>
</div>

<div class="warn">

Size for the **peak** — and estimate **spikes separately**.

</div>

---

## Storage and bandwidth

> storage = items × size × retention × replication (× index overhead) · bandwidth = QPS × size

| BoxOffice data | Per year | Where |
|---|---|---|
| Orders: 100 k/day × 1 KB | ~37 GB | SQL — **no sharding needed** |
| Ticket PDFs: 200 k/day × 100 KB | ~7 TB | Object Store (or generate on demand) |
| Images at peak: 1,200 views/s × 1 MB | — | ~**10 Gbit/s** → **CDN** |

<p class="small">Bits vs bytes: a 10 Gbit/s link carries 1.25 GB/s.</p>

---

## Little's Law

> **L = λ × W** — in flight = arrival rate × time in the system

| Form | Question | BoxOffice |
|---|---|---|
| L = λW | how many in flight? | 1,000 holds/s × 40 ms = **40** in flight |
| W = L/λ | how long is the wait? | 2 M in line ÷ 1,000/s = **33 min** |
| λ = L/W | what throughput? | 8 connections ÷ 5 ms = **1,600 holds/s** |

<p class="small">Holds for any stable system, any distribution, any number of servers.</p>

---

## Little's Law at work

- **Cascading failure**: 100 payments/s × 0.3 s = **30** threads waiting. Provider slows to 3 s → **300** threads → a 200-thread pool is exhausted, *every* route fails.
- **Load-test lie detector**: closed loop, N = X × (R + Z). 100 VUs, R = 50 ms → max **2,000 req/s**; if R grows to 500 ms → **200 req/s**. The test backs off exactly when the system struggles.

<div class="ok">

Pools: size them with L = λW **plus headroom** — a pool of 500 DB connections adds no capacity, only contention.

</div>

---

## Utilization and capacity

> **U = X × S** · capacity **X_max = c / S** (c parallel servers, S service time)

- 1,000 holds/s × 5 ms = 5 busy cores → **62.5%** of 8.
- The resource with the highest utilization is the **bottleneck**: it caps the whole system.

<div class="q">

Why not run it at 95%?

</div>

---

## The knee: R = S / (1 − ρ)

| Utilization ρ | Mean R | p99 (M/M/1 ≈ 4.6 R) | S = 5 ms |
|---|---|---|---|
| 50% | 2 S | 9 S | 10 ms |
| 70% | 3.3 S | 15 S | 17 ms |
| 80% | 5 S | 23 S | 25 ms |
| 90% | 10 S | 46 S | 50 ms (p99 230 ms) |
| 95% | 20 S | 92 S | 100 ms (p99 460 ms) |
| 99% | 100 S | 460 S | 500 ms (p99 2.3 s) |

<p class="small">Random arrivals queue up in bursts; near saturation there are no quiet moments to catch up. The tail explodes first.</p>

---

## Where to operate

| Component | Target at peak | Why |
|---|---|---|
| Latency-sensitive (API, DB primary) | **~50–70%** | left of the knee; survive losing a replica |
| Batch / async workers | 80–90%+ | throughput and cost matter, not per-job latency |

- **Headroom is failover**: 4 replicas at 60% → lose one → 80%. At 80% → lose one → **107%**.
- **Pooling** (one queue, many servers) pushes the knee right.
- **Less variability** (steady admission, no slow outliers) means less queueing — Kingman.

---

## When more nodes stop helping

> Amdahl: speedup ≤ **1/σ** · USL: C(N) = N / (1 + σ(N−1) + κN(N−1))

- **σ (contention)**: serial work — one primary, a global lock. 5% serial → never more than **20×**.
- **κ (coherency)**: nodes talking to each other — distributed locks, cache coherence. Throughput **peaks** at N* = √((1−σ)/κ), then **falls**.

<div class="ok">

Shared-nothing scales: BoxOffice partitions inventory **by event**, so holds for different events never contend.

</div>

---

## Why averages lie

- Latency distributions have a **long tail**: cache misses, GC pauses, locks, retries.
- Example: mean **55 ms**, p50 **40 ms**, p99 **~500 ms**, p99.9 **~1.1 s**.
- Use **p50** (typical), **p99** / **p99.9** (the unlucky — often your best customers).
- A visit with 50 requests hits ≥ 1 above the p99 with probability 1 − 0.99⁵⁰ ≈ **39%**.

<div class="warn">

**Never average percentiles** across servers or time — merge the **histograms**.

</div>

---

## Fan-out amplifies the tail

> P(user request slow) = **1 − (1 − q)ᴺ**

| Fan-out N | q = 1% (backend p99) | q = 0.1% (p99.9) |
|---|---|---|
| 1 | 1% | 0.1% |
| 20 | 18% | 2% |
| 100 | **63%** | 9.5% |

<p class="small">"The Tail at Scale": with fan-out, the backend's tail becomes the user's common case (its median from ~70 calls). BoxOffice search queries 20 shards in parallel: 18 % of searches see a shard's p99.</p>

---

## Taming the tail

- **Hedged requests**: second copy after the p95 delay → ~5% extra load, much shorter tail (idempotent reads only).
- **Partial results** after a deadline; **less fan-out**; precomputed aggregates.
- **Async** everything that need not finish before the response; **headroom**.
- **Latency budget** — checkout p99 1.5 s: edge 50 · order 50 · inventory 100 · payment **1,000** · write 50 · slack 250 ms.

<div class="warn">

**Coordinated omission**: a load generator that waits for slow responses stops sending — and the tail vanishes from the results.

</div>

---

## Availability and the nines

> A = MTTF / (MTTF + MTTR) — 720 h / 2 h → 99.72%; auto-recover in 2 min → **99.995%**

| A | per year | per 30.44 days | per 28 days |
|---|---|---|---|
| 99.9% | 8.77 h | 43.8 min | 40.3 min |
| 99.95% | 4.38 h | 21.9 min | 20.2 min |
| 99.99% | 52.6 min | 4.38 min | 4.03 min |
| 99.999% | 5.26 min | 26.3 s | 24.2 s |

<p class="small">Each nine = 10× less downtime. Always state the window. 99.9% of 2,000 req/s = 2 failures every second.</p>

---

## Series and parallel

- **Series** (all needed): **∏ aᵢ** — worse than the weakest link. 0.999⁵ ≈ 99.5%.
- **Parallel** (any one is enough): **1 − ∏(1 − aᵢ)** — two at 99% → 99.99%.
- **Quorum** 2-of-3 at 99%: a³ + 3a²(1 − a) ≈ **99.97%**.

| BoxOffice checkout | Availability |
|---|---|
| naive: 6 sync deps incl. e-mail at 99.5% | **99.19%** (~5.8 h/month) |
| e-mail async | 99.69% |
| + second payment provider | 99.79% |
| + internal links at 99.99% | **99.95%** |

---

## Independence is an assumption

- 3 replicas at 99.5% → "99.99999%"… until **one bad release** hits all three in 2 minutes.
- Correlated failures: same **zone**, same **release**, same **config**, a shared **dependency** (DNS, certificate).
- Redundancy needs **failover that works**: detection + switch time × failures per year.

<div class="ok">

Rule of the extra nine: each critical dependency ~**one nine better** than the service. Turn hard dependencies into **soft** ones (cache, fallback, async).

</div>

---

## The on-sale, settled

- **Demand**: 2 M fans / 60 s ≈ **33 k holds/s** (more with re-clicks).
- **Capacity**: 8 slots / 5 ms = 1,600/s; at ≤ 70% → **~1,100/s**.
- **Verdict**: a **30× gap** — no tuning closes it.
- **Design**: a **waiting room** admitting ~1,000/s; ~30 k winning fans served in ~30 s.

<div class="ok">

One PostgreSQL primary is enough **if** demand is shaped. The key number — **5 ms per hold** — is an assumption: lab 2 measures it.

</div>

---

<!-- _class: tight -->

## The estimation concept map

| Component | Question it answers | Key concepts |
|---|---|---|
| `app` `worker` | how many instances, threads, connections? | peak / (capacity × U) + spares, L = λW |
| `sql` | can one primary take it? | U = X × S, the knee, serial fraction (hot rows) |
| `cache` | how much memory? how many misses? | latency numbers, the hot set |
| `cdn` `objstore` | how many Gbit/s and TB? | bandwidth = QPS × size, retention × replication |
| `queue` | how long is the line? | W = L / λ, admission rate |
| `search` (shards) | why is the user's p99 worse? | 1 − (1 − q)ᴺ, hedging, latency budgets |
| `lb` `healthcheck` `payment` | how available is the path? | series ∏aᵢ, parallel 1 − ∏(1 − aᵢ), MTTR |

<p class="small">Estimation adds no box to the palette — it puts a <b>number</b> on every box, and tells you which number to measure first.</p>

---

## Takeaways

1. Estimate to pick a **side of a threshold**: decision → assumptions → powers of ten → check → conclusion.
2. RAM ~100 ns, SSD ~100 µs, zone ~0.5 ms, continent ~100+ ms; 1 day ≈ 10⁵ s.
3. **Little's Law** L = λW and **U = X·S** size pools, fleets and queues.
4. Latency ~ **S/(1 − ρ)**: run latency-critical parts at ~50–70%.
5. Amdahl and **USL**: coordination caps scaling; partition to share nothing.
6. Use **percentiles**; fan-out turns rare slowness into common slowness.
7. Series **multiply**, parallel **1 − ∏(1 − a)**; failures are often **correlated**.
