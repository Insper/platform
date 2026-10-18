
It is 10:00 and BoxOffice opens the sale of a stadium show: two million fans, sixty thousand seats. Over the semester you built every piece needed to survive that morning — a CDN and a WAF at the edge, stateless services behind a load balancer, a cache, a database that never sells a seat twice, a queue, a payment integration, observability, a load test that found the knee. This class puts the pieces together **the way an interviewer asks for them**: a one-sentence prompt, a blank whiteboard and 45 minutes.

The twelve case studies below are the classic system-design interview problems. They are not twelve unrelated systems: they are **the same few ideas** — cache the hot reads, take slow work off the critical path, choose a partition key, make retries safe, protect the one resource that cannot scale — combined in different proportions. Studying them is how the vocabulary of the course becomes a reflex.

!!! abstract "Learning objectives"

    By the end of this class you should be able to:

    - **Apply** the interview framework of class 1 to an unseen problem within 45 minutes: clarify, estimate, API and data model, high-level design, deep dives, bottlenecks and wrap-up.
    - **Estimate** the load of a system from a few assumptions and **derive** design decisions from the numbers.
    - **Compose** palette components (edge, compute, storage, messaging, observability, AI) into a design and **justify** each one.
    - **Analyze** a design for bottlenecks and failure modes and **defend** its trade-offs out loud.
    - **Validate** a design under load in the System Design Playground and **explain** what the metrics show.
    - **Evaluate** your own answer against a junior / mid / senior rubric.

## Roadmap

1. **This overview** — how to study a case, how to use the playground, the cases at a glance and the patterns that repeat.
2. [URL shortener](url-shortener/index.md) — ID generation, base62, caching hot links, analytics off the critical path.
3. [Rate limiter](rate-limiter/index.md) — token bucket and sliding windows, atomic counters, fail-open vs. fail-closed.
4. [Distributed cache](distributed-cache/index.md) — consistent hashing, eviction, replication, hot keys.
5. [Search autocomplete](search-autocomplete/index.md) — trie with top-k, offline aggregation, serving from memory.
6. [Notification system](notification-system/index.md) — channels, queues, retries, deduplication, providers.
7. [News feed](news-feed/index.md) — fan-out on write vs. read, celebrities, timeline cache, ranking.
8. [Chat](chat/index.md) — WebSockets, routing between gateways, ordering, offline delivery, presence.
9. [Ride sharing](ride-sharing/index.md) — location ingestion, geospatial indexes, matching without double assignment.
10. [Video streaming](video-streaming/index.md) — uploads, transcoding pipeline, adaptive bitrate, CDN economics.
11. [Payment system](payment-system/index.md) — idempotency, double-entry ledger, PSP integration, reconciliation.
12. [Ticketing — the BoxOffice flash sale](ticketing/index.md) — the flagship: waiting room, seat holds, checkout.
13. [AI assistant](ai-assistant/index.md) — RAG, LLM gateway, agents with tools, guardrails and evals.
14. [Quiz](quiz.md) — check your understanding.

## Slides

<div class="slides-embed">
  <iframe src="slides/case-studies.html" title="Slides: case studies" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/case-studies.html){:target="_blank"}

---

## How to study a case

Every case page follows the **interview framework** of [class 1](../intro/interview-framework/index.md), section by section, so you can rehearse the order until it is automatic. The timing below is for a 45-minute interview; the case pages use the same numbering.

| # | Step | Minutes | What you produce | Typical mistake |
|---|---|---:|---|---|
| 1 | **Clarify the requirements** | 5 | Functional list, non-functional targets with numbers, out of scope | Designing before knowing whether it is 1 k or 1 M users |
| 2 | **Estimate** | 5 | QPS (average and peak), storage, bandwidth, memory — and one sentence on what they imply | Computing numbers and never using them |
| 3 | **API and data model** | 5–7 | A handful of endpoints, main entities, the store for each and why | Twenty endpoints, no idempotency, no pagination |
| 4 | **High-level design** | 10 | One diagram with the read path and the write path | Boxes without data flows; every component "because big systems have it" |
| 5 | **Deep dives** | 10–15 | Two or three hard parts solved with alternatives and a choice | Going deep on the easy part |
| 6 | **Bottlenecks, failure modes, trade-offs** | 5 | What breaks first, what happens when X dies, what you gave up | "It scales horizontally" with no evidence |
| 7 | **Wrap-up** | 2–3 | Summary, what you would do next, how you would measure it | Running out of time mid-sentence |

The ten sections of each case page map onto these steps: requirements (1), estimates (2), API and data model (3), high-level design (4), deep dives (5), bottlenecks and trade-offs (6), and then three study aids — **Try it in the playground**, **Follow-up questions** and a **self-assessment rubric**.

!!! tip "A study method that works"

    1. **Attempt first.** Read only the prompt (the quote at the top of the page). Set a timer for 40 minutes and solve it on paper or on the [playground](../../../playground/index.md) canvas, out loud, as if an interviewer were there.
    2. **Compare section by section.** Open the page and compare your requirements, numbers, API, diagram and deep dives. Note what you missed, not what you got right.
    3. **Run the scenario.** Load the matching playground scenario, predict what will break, run it, and check your prediction (next section).
    4. **Answer the follow-ups** before opening them; they are the questions that decide between levels.
    5. **Grade yourself** with the rubric, then **repeat a week later** without looking. Spaced repetition beats rereading.
    6. **Practice in pairs** with the [mock interview script](../../support/interview/mock/index.md): one plays the interviewer, using the follow-ups as probes.

## How to use the playground with a case

Each case embeds the [System Design Playground](../../../playground/index.md) preloaded with its scenario. The playground is a simulator, not a benchmark: its numbers are illustrative, but the **shapes** (where the queue grows, when p99 bends, which component saturates first) are the ones you will see in real systems and in the labs.

``` mermaid-sim
flowchart LR
    p["Predict<br/>what breaks first?"] --> r["Run<br/>load / spike profile"]
    r --> o["Observe<br/>utilization, p99,<br/>errors, backlog, cost"]
    o --> c["Change one thing<br/>replicas, cache, queue,<br/>timeout, partition"]
    c --> e["Explain<br/>with the numbers<br/>of section 2"]
    e --> p
```

- **Predict before you run.** Write down which component you expect to saturate and at what load. Being wrong is the useful part.
- **Change one thing at a time.** Add a cache *or* replicas *or* a queue, never all three, so you know which change moved the metric.
- **Use the profiles**: `load` for steady state, `spike` for the BoxOffice 10:00 moment, `stress` and `breakpoint` to find the knee, `chaos` (or the chaos level) to kill or slow components and watch failure modes.
- **Connect it to the estimates.** If the page says the cache must absorb 95% of reads, look at the hit ratio; if Little's Law says 40 calls are in flight, look at the concurrency of the dependency.
- **Export your design** (JSON) when you like it: it is the format of the [playground exercise](../../exercises/playground-design/index.md).

## The cases at a glance

Suggested order: from the easy warm-ups to the flagship. The difficulty is the usual level at which the problem is asked; every case has a senior version.

| Case | Difficulty | Key concepts | Palette components | Scenario |
|---|---|---|---|---|
| [URL shortener](url-shortener/index.md) | :material-star: | base62, ID generation vs. hashing, 301/302, cache-aside, async analytics | `lb` `app` `cache` `nosql` `kafka` `analytics` | `url-shortener` |
| [Rate limiter](rate-limiter/index.md) | :material-star::material-star: | token bucket, sliding window, Lua atomicity, 429, fail-open/closed | `apigw` `lb` `waf` `cache` `metrics` | `rate-limiter` |
| [Distributed cache](distributed-cache/index.md) | :material-star::material-star: | consistent hashing, virtual nodes, eviction (LRU/LFU/W-TinyLFU), replication, hot keys | `cache` `app` `nosql` `metrics` | `read-heavy-cache`, `sharding` |
| [Search autocomplete](search-autocomplete/index.md) | :material-star::material-star: | trie + top-k, offline aggregation, immutable snapshots, prefix sharding, debouncing | `cdn` `search` `cache` `stream` `dwh` `worker` | `search-autocomplete` |
| [Notification system](notification-system/index.md) | :material-star::material-star: | queue per channel, retries + DLQ, dedup, preferences, provider failover, scheduled campaigns | `scheduler` `queue` `worker` `notifications` `email` `thirdparty` | `notification-system` |
| [News feed](news-feed/index.md) | :material-star::material-star::material-star: | fan-out on write vs. read, celebrities, timeline cache, hydration, ranking, cursors | `app` `cache` `nosql` `kafka` `worker` `objstore` `cdn` | `news-feed` |
| [Chat](chat/index.md) | :material-star::material-star::material-star: | WebSocket gateways, session registry, pub/sub, per-conversation sequence, receipts, presence | `lb` `app` `pubsub` `nosql` `cache` `notifications` | `chat` |
| [Ride sharing](ride-sharing/index.md) | :material-star::material-star::material-star: | write-heavy locations, geohash/quadtree/H3, matching with locks, trip state machine | `mobile` `apigw` `stream` `cache` `sql` `payment` | `ride-sharing` |
| [Video streaming](video-streaming/index.md) | :material-star::material-star::material-star: | pre-signed uploads, transcoding DAG, ABR (HLS/DASH), CDN + shield, egress cost | `cdn` `objstore` `queue` `worker` `sql` `analytics` | `video-streaming` |
| [Payment system](payment-system/index.md) | :material-star::material-star::material-star: | idempotency keys, double-entry ledger, PSP webhooks, reconciliation, outbox | `apigw` `app` `sql` `kafka` `scheduler` `payment` `dwh` | `payment-system` |
| [Ticketing (BoxOffice)](ticketing/index.md) | :material-star::material-star::material-star: | waiting room, Little's Law admission, seat holds with TTL, concurrency control, checkout state machine | `cdn` `waf` `apigw` `queue` `sql` `cache` `kafka` `payment` | `flash-sale` |
| [AI assistant](ai-assistant/index.md) | :material-star::material-star::material-star: | RAG, LLM gateway, agent loop with tools (MCP), guardrails, evals, token cost | `llmgw` `orchestrator` `toolreg` `memory` `safety` `vectordb` | `ai-assistant` |

The component ids are the ones of the playground palette; each is described in the [component catalog](../../reference/components/index.md).

## Patterns that repeat

After a few cases you will notice that the deep dives are drawn from a short list. Recognizing the pattern in a new problem is most of the work.

| Pattern | The problem it solves | Where it appears |
|---|---|---|
| **Cache the hot reads** (cache-aside, CDN, L1 in-process) | Read-heavy traffic with a skewed popularity | URL shortener, news feed, autocomplete, video, ticketing catalog |
| **Take slow work off the critical path** (queue/stream + workers) | Spikes and slow side effects (analytics, e-mail, transcoding) | URL shortener clicks, notifications, news-feed fan-out, video, payments outbox |
| **Make retries safe** (idempotency keys, dedupe, conditional writes) | Networks and clients retry; providers call back twice | Payments, ticketing, chat, notifications, ride requests |
| **Choose the partition key** (by user, conversation, city, event, code) | One node cannot hold the data or the traffic | Chat (conversation), ride sharing (city), ticketing (event), cache (key ring) |
| **Protect what cannot scale** (admission control, rate limits, bulkheads) | A hot row, a primary, a provider's limit | Ticketing waiting room, rate limiter, payments, AI assistant quotas |
| **Precompute vs. compute on read** | Latency of reads vs. cost of writes | News feed fan-out, autocomplete top-k, video renditions |
| **Stateful edges, stateless core** | Long-lived connections | Chat gateways, ride-sharing driver connections, live streams |
| **Strong consistency only where it matters** | Correctness vs. availability and cost | Seats, payments and driver assignment strong; feeds, counters, positions eventual |

!!! example "BoxOffice everywhere"

    Every case page has a BoxOffice connection: short links in ticket SMS (URL shortener), "5 holds per minute" (rate limiter), the "Following" tab when an artist announces a tour (news feed), fan groups during a festival (chat), 60 000 fans leaving the stadium (ride sharing), trailers on event pages (video), "doors open in 2 h" (notifications), the payment adapter (payments), search-as-you-type for artists (autocomplete), the support assistant (AI) and, of course, the flash sale itself (ticketing).

!!! warning "Common pitfalls in design interviews"

    - **Jumping to the solution** ("we use Kafka and Cassandra") before requirements and numbers.
    - **Numbers that change nothing.** Every estimate should end in a decision: "so the hot set fits in memory", "so we need a queue".
    - **Ignoring the write path** or the failure path — the interviewer will ask "what happens when X is down?".
    - **Over-engineering**: microservices, multi-region and five databases for a system with 100 requests per second. Saying "a single PostgreSQL is enough here, and this is when it stops being enough" is a senior answer.
    - **Monologue.** Check in with the interviewer at the end of each step; they often steer you toward the deep dive they care about.

---

## The case-studies concept map { #concept-map }

The twelve cases are combinations of the same patterns. The map groups the cases by the **pattern** they share (blue), the classes that teach it, and the **palette components** that implement it (green); the matrix below says which classes each case tests — ● a deep dive is built on it, ○ it is part of the design, — not central. Each case page ends with its own *How it connects* diagram.

``` mermaid
flowchart LR
    g1["URL shortener · news feed<br/>autocomplete · video"] --> p1["cache the hot reads<br/>(Caching, Edge)"]:::tech
    g2["notifications · video<br/>news feed · payments"] --> p2["slow work off the critical path<br/>(Messaging, Compute)"]:::tech
    g3["payments · ticketing<br/>chat · ride sharing"] --> p3["safe retries, strong consistency<br/>where it matters (Distributed, Databases)"]:::tech
    g4["chat · ride sharing<br/>ticketing · distributed cache"] --> p4["choose the partition key<br/>(Databases)"]:::tech
    g5["ticketing · rate limiter<br/>AI assistant"] --> p5["protect what cannot scale<br/>(Edge, Reliability)"]:::tech
    p1 --> k1["cache · cdn"]:::comp
    p2 --> k2["queue · kafka · worker"]:::comp
    p3 --> k3["sql · payment"]:::comp
    p4 --> k4["nosql · stream · cache"]:::comp
    p5 --> k5["waf · apigw · queue · llmgw"]:::comp
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

| Case | [Distributed](../distributed/index.md) | [Edge](../edge/index.md) | [Compute](../compute/index.md) | [Databases](../databases/index.md) | [Caching](../caching/index.md) | [Messaging](../messaging/index.md) | [Reliability](../reliability/index.md) | Also tests |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| [URL shortener](url-shortener/index.md) | ○ | ○ | ○ | ● | ● | ○ | — | Estimation (storage over 5 years) |
| [Rate limiter](rate-limiter/index.md) | — | ● | — | — | ● | — | ● | Performance (load test of the limiter) |
| [Distributed cache](distributed-cache/index.md) | ○ | — | — | ● | ● | — | ○ | Estimation (memory and ops/s) |
| [Search autocomplete](search-autocomplete/index.md) | — | ○ | ● | ● | ● | ○ | — | Estimation (keystroke traffic) |
| [Notification system](notification-system/index.md) | ○ | — | ● | ○ | — | ● | ● | — |
| [News feed](news-feed/index.md) | ○ | ○ | ○ | ● | ● | ● | ○ | — |
| [Chat](chat/index.md) | ● | ● | ○ | ● | ○ | ● | ○ | — |
| [Ride sharing](ride-sharing/index.md) | ● | ○ | ○ | ● | ● | ● | ○ | — |
| [Video streaming](video-streaming/index.md) | — | ● | ● | ● | — | ○ | — | Cloud-native (FinOps: egress cost) |
| [Payment system](payment-system/index.md) | ● | ○ | ● | ● | — | ● | ● | Network & Security (PCI DSS scope) |
| [Ticketing (BoxOffice)](ticketing/index.md) | ○ | ● | ○ | ● | ○ | ● | ● | Performance (Little's Law admission, spike test) |
| [AI assistant](ai-assistant/index.md) | — | ○ | — | ○ | ○ | — | ○ | **AI systems ●** (gateway, agents, RAG, safety) |

---

## Related

[Class 1 — interview framework](../intro/interview-framework/index.md) · [Class 2 — estimation](../estimation/index.md) · [Interview preparation](../../support/interview/index.md) and its [practice problems](../../support/interview/problems/index.md) · [Design doc exercise](../../exercises/design-doc/index.md) · [Team project](../../exercises/project/index.md) · [Playground](../../../playground/index.md).

## References

The case pages cite their own sources; the books below cover most of them[^1][^2][^3].

[^1]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1. Byte Code LLC, 2020; XU, A.; LAM, S., vol. 2, 2022.
[^2]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2nd ed. O'Reilly.
[^3]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/books/){target="_blank"}. O'Reilly, 2016.
