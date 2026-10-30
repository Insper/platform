
The BoxOffice team is arguing about the stadium on-sale. *"One PostgreSQL can't take that, we need a distributed database."* — *"Of course it can, Postgres is fast."* Both engineers are guessing. Neither has said how many requests per second the on-sale generates, how long one seat hold keeps the database busy, how full the database can run before latency explodes, or what happens to the fans' experience when one of the ten calls behind a page is slow.

This class gives you the tools to settle that argument in five minutes on a whiteboard: the **numbers** every engineer should carry in their head, the **formulas** that connect load, latency and capacity, and the **methods** to turn a fuzzy question ("will it hold?") into an order-of-magnitude answer that drives a design decision. These are the same tools that you will use to read load tests (lab 2 and [class 15](../performance/index.md)), size clusters (class 11), set SLOs (class 9) and pass the estimation step of a system-design interview.

!!! quote "The story so far"

    Chapter 2 of the [story of the course](../../index.md#story). [Class 1](../intro/index.md) wrote down what BoxOffice must do and how well: 2 million fans in the first minute, 60,000 seats, hold p99 < 300 ms. BoxOffice still runs on one service and one PostgreSQL. **This class** answers: can that database take the 10:00 on-sale — and how do we know before building anything?

!!! abstract "Learning objectives"

    By the end of this class you should be able to:

    - **Recall** the orders of magnitude of latency (memory, SSD, network in a data centre, across continents) and of common data sizes, and **use** powers of two and ten fluently.
    - **Estimate** requests per second (average and peak), storage, bandwidth and number of servers for a system from a few stated assumptions.
    - **Apply** Little's Law and the utilization law to size thread pools, connection pools and queues, and to validate a load test.
    - **Explain** why latency explodes near full utilization (the knee) and **choose** a safe operating utilization.
    - **Interpret** latency percentiles (p50, p99, p99.9), **compute** tail amplification under fan-out, and **propose** tail-tolerant techniques.
    - **Calculate** the availability of components in series and in parallel and the downtime allowed by a number of nines; **reason** about scalability limits with Amdahl's law and the Universal Scalability Law.

## Roadmap

1. **This overview** — why estimate, the five-step method, and one complete back-of-the-envelope capacity check for the on-sale.
2. [Numbers Every Engineer Should Know](numbers/index.md) — powers of two, latency numbers, sizes, and estimating requests per second, storage and bandwidth.
3. [Queueing, Little's Law and Scalability](queueing/index.md) — concurrency, utilization, the knee of the latency curve, Amdahl and the Universal Scalability Law.
4. [Percentiles and Tail Latency](percentiles/index.md) — why averages lie, how fan-out amplifies the tail, and how to fight it.
5. [Availability Math](availability-math/index.md) — nines, MTTF/MTTR, components in series and in parallel, correlated failures.
6. [Quiz](quiz.md) — check your understanding.

## Slides

<div class="slides-embed">
  <iframe src="slides/estimation.html" title="Slides: back-of-the-envelope estimation" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/estimation.html){:target="_blank"}

---

## Why estimate?

Architectural decisions differ by **orders of magnitude**, not by percentages. A design for 10 requests per second and one for 10,000 are different designs; 40 GB and 40 TB of data are different problems. You rarely need the exact number — you need to know **which side of a threshold** you are on:

| If the estimate says… | …the design decision is |
|---|---|
| 40 GB of orders per year | one PostgreSQL primary is fine for years — **don't shard** |
| 40 TB per year | plan partitioning or an object store from the start |
| 1,200 catalog reads/s, 99% repeated | **cache** them; the database only sees the misses |
| 100,000 hold attempts/s on 60,000 seats | the inventory cannot absorb it — **queue** fans in a waiting room |
| 8 Gbit/s of images | serve them from a **CDN**, not from the app servers |
| one synchronous dependency at 99.9% on every request | the service cannot promise more than 99.9% — **remove it from the critical path** or make it redundant |

Estimation is also how you **check** a design and a measurement. If your load test says one server handles 50,000 requests per second while each request takes 20 ms on a single thread, something is wrong with the test — and Little's Law will tell you so in one line.

## The method: five steps

Back-of-the-envelope estimation is a form of **Fermi estimation** (named after the physicist Enrico Fermi, famous for estimating quantities like "how many piano tuners are there in Chicago?" from a chain of reasonable guesses). The errors in a chain of rough guesses tend to partially cancel, and an answer within a factor of 2–3 is good enough to choose between designs that differ by 10× or more[^1].

1. **Name the decision.** What will the number decide? "Do we need to shard the orders table?" — not "how much data is there?".
2. **State the assumptions** out loud and write them down: users, actions per user, sizes, peak factor. Use round numbers.
3. **Compute with powers of ten.** One day ≈ 10⁵ seconds; 1 million per day ≈ 12 per second. Keep one significant digit.
4. **Sanity-check** against a number you know: "1,200 req/s — that is about what one well-tuned app server handles; OK, a few servers."
5. **Conclude**: state the implication for the design, and the assumption it is most sensitive to.

!!! tip "Rounding rules that keep you fast"

    - 1 day = 86,400 s ≈ **10⁵ s**; 1 month ≈ **2.5 × 10⁶ s**; 1 year ≈ **3 × 10⁷ s**.
    - 1 million requests per day ≈ **12 per second** on average.
    - 2¹⁰ ≈ 10³: KB, MB, GB, TB, PB are each ~1,000× the previous one.
    - Keep exponents, round mantissas: 2 M × 20 = 4 × 10⁷; 4 × 10⁷ / 10⁵ = **400**.

---

## A complete capacity check: can one database take the on-sale?

Let us settle the argument from the beginning of the page. Every step uses a tool from one of the subpages — follow the links when a step is not obvious yet.

!!! example "BoxOffice — the 10:00 on-sale on one inventory database"

    **Decision**: is a single PostgreSQL primary enough for the seat inventory during a stadium on-sale, or do we need something else?

    **Assumptions** (illustrative, to be validated with a load test in lab 2):

    - 2 M fans arrive within the first 60 s; 60 k seats; each successful fan holds 2 seats on average.
    - One seat-hold transaction keeps the database busy for **S = 5 ms** (a conditional `UPDATE` on a few rows, plus the commit).
    - The database can run about **c = 8** of these transactions in parallel productively (CPU cores and row-lock contention limit it).

    **1. Demand** ([numbers](numbers/index.md)): 2 M fans / 60 s ≈ **33,000 hold attempts per second**, if every fan clicks once — and they click more than once.

    **2. Capacity** ([queueing](queueing/index.md)): each "slot" completes 1 / 5 ms = 200 holds/s; 8 slots ≈ **1,600 holds/s** at 100% utilization. To keep latency sane we run at ≤ 70%: **≈ 1,100 holds/s**.

    **3. Verdict**: demand exceeds capacity by **~30×**. No tuning closes a 30× gap. Without a queue, requests pile up, latency explodes long before errors appear, and timeouts cause retries that make it worse.

    **4. Design**: a **waiting room** admits fans at ~1,000/s. With 60 k seats and ~2 seats per fan, at most ~30 k successful fans are needed; at 1,000 admissions per second they are served in about 30 s, while the queue tells the rest, in near real time, how far they are from the front — and, once seats run out, that the show is sold out.

    **5. Check the experience** ([percentiles](percentiles/index.md), [availability](availability-math/index.md)): an admitted fan's hold goes through gateway → inventory → database; at 70% utilization, with the 8 slots sharing one queue (M/M/c), the database's p99 is about 25 ms — a few multiples of 5 ms, far inside the 300 ms target (one slot alone at 70% would give 15 × 5 ms ≈ 75 ms, see the [queueing table](queueing/index.md)). And because the on-sale depends on all of them in series, each must be more available than the 99.95% promised for checkout.

    **Conclusion**: one PostgreSQL primary is enough **if** a waiting room shapes the demand; a "distributed database" would not remove the hot-row contention anyway, since everyone wants the same seats.

Notice that the most important number — **5 ms per hold** — is an assumption. Estimation tells you *which* number to measure first. Lab 2 measures it.

### See it in the playground

The `monolith` scenario is a single app server and a single SQL database. The `breakpoint` profile ramps the load up steadily until something breaks — the standard way to find the capacity of a system.

**Try it:** run the breakpoint profile and watch three curves at once: throughput, p99 latency and database utilization. Note the request rate at which **p99 starts to rise sharply** (the knee) and the rate at which **errors appear**. Then read the database's service time in the component panel and compute its capacity by hand (capacity = parallel slots / service time). How close is the knee to ~70–80% of that capacity?

<div class="sdp" data-scenario="monolith" data-mode="compact" data-profile="breakpoint" data-height="520"></div>

??? question "What should you have observed? (open after trying)"

    Throughput grows linearly with the offered load while latency stays flat; then, as the most-loaded component approaches saturation, **latency bends upward** (the knee) while throughput flattens. Past saturation, throughput stops growing at all, queues grow without bound, and timeouts turn into errors. Latency is the **early warning**; errors are the **late** one. That is why capacity is defined by the latency target ("the highest throughput at which p99 < 300 ms"), not by the point where the system crashes. The [queueing](queueing/index.md) page derives the shape of the curve.

---

## The toolbox at a glance

| Question | Tool | Formula / rule | Subpage |
|---|---|---|---|
| How many requests per second? | QPS estimate | DAU × actions / 86,400 × peak factor | [numbers](numbers/index.md) |
| How much data? | storage estimate | items × size × retention × replication | [numbers](numbers/index.md) |
| How much network? | bandwidth estimate | requests/s × response size | [numbers](numbers/index.md) |
| How many requests in flight? | Little's Law | L = λ × W | [queueing](queueing/index.md) |
| How busy is a resource? | utilization law | U = X × S | [queueing](queueing/index.md) |
| How slow near saturation? | M/M/1 | R = S / (1 − ρ) | [queueing](queueing/index.md) |
| Will more nodes help? | Amdahl, USL | C(N) = N / (1 + σ(N−1) + κN(N−1)) | [queueing](queueing/index.md) |
| How slow for the unlucky users? | percentiles | p99, p99.9; 1 − (1 − q)ᴺ under fan-out | [percentiles](percentiles/index.md) |
| How often is it down? | availability math | series ∏aᵢ; parallel 1 − ∏(1 − aᵢ) | [availability math](availability-math/index.md) |

## The estimation concept map { #concept-map }

Estimation adds no box to the palette — it puts **numbers** on every box. The map links each tool of this class (blue) to the **palette components** (green) whose capacity, latency or availability it computes:

``` diagram
flowchart LR
    qps["QPS, storage, bandwidth<br/>peak factor"]:::tech --> bytes["cdn · objstore"]:::comp
    qps --> sql["sql"]:::comp
    lat["latency numbers<br/>RAM, SSD, network"]:::tech --> cache["cache"]:::comp
    little["Little's Law,<br/>utilization law"]:::tech --> app["app · worker<br/>threads and pools"]:::comp
    little --> queue["queue<br/>waiting room"]:::comp
    knee["the knee,<br/>safe utilization"]:::tech --> sql
    knee --> app
    usl["Amdahl, USL<br/>serial fraction"]:::tech --> sql
    pct["percentiles,<br/>fan-out tail"]:::tech --> search["search shards"]:::comp
    avail["availability math<br/>series and parallel"]:::tech --> red["lb · healthcheck"]:::comp
    avail --> dep["payment · email"]:::comp
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

| Palette component | Question it answers | Concepts | Taught in | Scenarios |
|---|---|---|---|---|
| [`app`](../../reference/components/compute/index.md#app) · [`worker`](../../reference/components/compute/index.md#worker) | How many instances, threads and connections? | nodes = peak / (capacity × target utilization) + spares; L = λ × W | [Numbers](numbers/index.md), [Queueing](queueing/index.md) | `monolith`, `scale-out` |
| [`sql`](../../reference/components/storage/index.md#sql) | Can one primary take the load — and the data? | durable-write ceiling, U = X × S, the knee, serial fraction (hot rows), storage × retention × replication | [Queueing](queueing/index.md), [Numbers](numbers/index.md) | `monolith`, `flash-sale` |
| [`cache`](../../reference/components/storage/index.md#cache) | How much memory, and how many reads still reach the database? | RAM vs SSD vs network latency, the hot set, 80/20 | [Numbers](numbers/index.md) | `read-heavy-cache` |
| [`cdn`](../../reference/components/edge/index.md#cdn) · [`objstore`](../../reference/components/storage/index.md#objstore) | How many bits per second and how many terabytes? | bandwidth = QPS × size, bits vs bytes, files and logs dominate storage | [Numbers](numbers/index.md) | `cdn-static`, `video-streaming` |
| [`queue`](../../reference/components/messaging/index.md#queue) | How long is the line, and how fast does it drain? | W = L / λ, admission rate below capacity | [Queueing](queueing/index.md) | `flash-sale`, `async-queue` |
| [`search`](../../reference/components/compute/index.md#search) | Why is the user's p99 worse than every shard's? | percentiles from histograms, 1 − (1 − q)ᴺ, hedging, latency budgets | [Percentiles](percentiles/index.md) | `scale-out`, `search-autocomplete` |
| [`lb`](../../reference/components/edge/index.md#lb) · [`healthcheck`](../../reference/components/observability/index.md#healthcheck) | How available is a set of replicas, and how fast is a failure detected? | parallel 1 − ∏(1 − aᵢ), MTTR, detection + failover time | [Availability Math](availability-math/index.md) | `scale-out`, `multi-region` |
| [`payment`](../../reference/components/external/index.md#payment) · [`email`](../../reference/components/external/index.md#email) | What does a weak dependency cost the critical path? | series ∏ aᵢ, move it off the path, a second provider | [Availability Math](availability-math/index.md) | `payment-system`, `notification-system` |

!!! tip "In the interview"

    Spend **3–5 minutes** on estimates, right after clarifying requirements, and do them **out loud on the board**: assumptions in one column, results in another. Always finish each line with its consequence — "≈ 400 reads/s average, 1,200 at peak: one database could serve it, but a cache makes it trivial" — and move on. If the interviewer gives you numbers, use them; if not, propose round ones and ask "does that sound right?". Precision is not the goal; **orders of magnitude that drive decisions** are.

!!! success "Best practices"

    - **Keep the estimate in a versioned sheet next to the code** — assumptions in one column, results in another, each with a date; when a lab or production measures a number, replace the assumption and recompute. In BoxOffice: `results/lab2.md` ([Hands-on 2](../../hands-on/2/index.md#measure-it)).
    - **Measure first the number the conclusion is most sensitive to** — here, the 5 ms a hold keeps the database busy; a 2× error there doubles the number of machines.
    - **Size latency-sensitive tiers for ~60–70% utilization at peak, plus one spare (N+1)** — the knee and the loss of one node both need the headroom. In BoxOffice: the HPA of lab 10 scales `catalog` at 60% CPU.
    - **Write the formula next to every capacity setting** — `maximum-pool-size: 10  # 1,000 holds/s × 10 ms = 10`; the next engineer can recheck it when the load changes. In BoxOffice: `DB_POOL_SIZE` in lab 1's compose, varied in lab 2.
    - **Compare the estimate with reality after every big event** — predicted versus observed requests/s, p99 and utilization; the gap tells you which assumption to fix before the next on-sale.

!!! warning "Common pitfalls"

    - **Estimating the average and designing for it**: systems fail at the peak. Always apply a peak factor, and for event-driven businesses like BoxOffice, estimate the spike separately.
    - **False precision**: "1,157.4 req/s" signals you missed the point. Say "about 1,000".
    - **Forgetting replication and indexes** in storage estimates (×3 for replicas, often ×1.5–2 for indexes and overhead).
    - **Mixing bits and bytes**: network links are in bits per second (Gbit/s), storage in bytes (GB). 1 GB/s = 8 Gbit/s.
    - **Numbers without a conclusion**: an estimate that does not change the design was not needed.

---

## Related

- Hands-on: [2. Measure first](../../hands-on/2/index.md) — k6 smoke, load and stress tests on `catalog`; find the knee and check Little's Law.
- Exercise: [Estimation](../../exercises/estimation/index.md) — an estimation sheet for five systems.
- Class: [15. Performance engineering](../performance/index.md) — load testing and capacity planning with the same math.
- Reference: [Numbers cheat sheet](../../reference/numbers/index.md) and the [interview quick reference](../../support/interview/quick-reference/index.md).

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - Design decisions change by **orders of magnitude**; estimation tells you which side of a threshold you are on.
    - Five steps: **decision → assumptions → powers of ten → sanity check → conclusion**.
    - Capacity is roughly **parallel slots / service time**, and you run well **below** it (≈ 60–75%) because latency explodes near saturation.
    - The most important output of an estimate is often **which number to measure** next.
    - Percentiles and availability math tell you what the **users** experience, not just what the servers do.

## What breaks next { #what-breaks-next }

The verdict is a **30× gap**: ~33,000 hold attempts/s against ~1,100 that one database sustains at a sane utilization, and lab 2 shows that a single `catalog` instance leaves its latency target at a few hundred requests per second. A waiting room shapes the demand, but it, the app replicas in front of the database and a standby for the primary (one machine cannot promise 99.95%) all mean **more than one machine**. Between machines there is a network that loses, delays and duplicates messages: a fan whose "hold" times out and is retried may end up with two holds, or two charges. What changes when BoxOffice becomes machines that cooperate only by messages is [class 3 — Distributed Systems](../distributed/index.md).

---

[^1]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1. Byte Code LLC, 2020. Chapter 2 (back-of-the-envelope estimation).
