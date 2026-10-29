# Practice Problems

50 system-design problems to practice for interviews, from warm-ups to senior-level questions. Each one has the prompt as an interviewer would say it, the questions you should ask first, the key concepts (with links to the class where each is taught and to the component catalog), the trap to watch for, the matching case study when there is one, a playground scenario to break your design under load, and hints that you open only after trying.

## How to use this page { #how-to-use }

1. **Pick one problem** at your level. Read only the prompt.
2. **Set a 45-minute timer** and solve it out loud (alone, or with a classmate as interviewer — see [mock interviews](../mock/index.md)), following the seven steps of the [framework](../framework/index.md): clarify, estimate, API and data model, high-level design, deep dives, bottlenecks and trade-offs, wrap-up.
3. **Draw it in the [playground](../../../../playground/index.md)**, run the suggested scenario with a spike or stress profile, and see which box turns red first. Fix it and run again.
4. **Compare** with the case study (or with the closest one) and with the hints. Write down one thing you missed.
5. Come back a week later and solve it again, faster.

| Level | What it means | Time to aim for |
|---|---|---|
| Warm-up | One core idea and a small design | 30–35 min |
| Medium | Two or three interacting components, at least one deep dive | 45 min |
| Hard | Contention, money, real time or media at scale | 45–60 min |
| Advanced | Distributed-systems internals and platforms | 60 min |

!!! example "Start with BoxOffice"
    The course's running example, the [BoxOffice flash sale](#flash-sale-ticketing) (2 million fans, 60,000 seats, on sale at 10:00), touches almost every topic: the edge absorbing a spike, a waiting room, a strongly consistent seat hold, an external payment provider, async notifications. Several problems below are pieces of it ([event catalog](#event-catalog), [seat map](#seat-map), [waiting room](#waiting-room), [refunds](#refunds), [AI assistant](#ai-assistant)); solving them one by one is a good way to prepare for the full problem.

!!! tip "Before you open the hints"
    Most hints start with a number. If your design has no numbers yet, go back to step 2 of the framework: the [quick reference](../quick-reference/index.md) and the [reference numbers](../../../reference/numbers/index.md) have everything you need to estimate.

## All problems at a glance { #at-a-glance }

| # | Problem | Difficulty | Theme | Case study | Scenario |
|---|---|---|---|---|---|
| 1 | [URL shortener](#url-shortener) | Warm-up | Read-heavy & caching | [URL shortener](../../../classes/case-studies/url-shortener/index.md) | [`url-shortener`](../../../../playground/scenarios/index.md#url-shortener) |
| 2 | [Pastebin](#pastebin) | Warm-up | Read-heavy & caching | — | [`cdn-static`](../../../../playground/scenarios/index.md#cdn-static) |
| 3 | [Game leaderboard](#leaderboard) | Warm-up | Read-heavy & caching | — | [`read-heavy-cache`](../../../../playground/scenarios/index.md#read-heavy-cache) |
| 4 | [BoxOffice event catalog](#event-catalog) | Warm-up | Read-heavy & caching | [Ticketing (BoxOffice flash sale)](../../../classes/case-studies/ticketing/index.md) | [`cdn-static`](../../../../playground/scenarios/index.md#cdn-static) |
| 5 | [Distributed rate limiter](#rate-limiter) | Warm-up | Infrastructure & platform | [Rate limiter](../../../classes/case-studies/rate-limiter/index.md) | [`rate-limiter`](../../../../playground/scenarios/index.md#rate-limiter) |
| 6 | [Unique ID generator](#unique-id-generator) | Warm-up | Infrastructure & platform | — | [`scale-out`](../../../../playground/scenarios/index.md#scale-out) |
| 7 | [Feature flag service](#feature-flags) | Warm-up | Infrastructure & platform | — | [`read-heavy-cache`](../../../../playground/scenarios/index.md#read-heavy-cache) |
| 8 | [Likes counter](#likes-counter) | Warm-up | Write-heavy & data pipelines | — | [`sharding`](../../../../playground/scenarios/index.md#sharding) |
| 9 | [Notification system](#notification-system) | Warm-up | Async & workflows | [Notification system](../../../classes/case-studies/notification-system/index.md) | [`notification-system`](../../../../playground/scenarios/index.md#notification-system) |
| 10 | [Webhook delivery service](#webhook-delivery) | Warm-up | Async & workflows | — | [`async-queue`](../../../../playground/scenarios/index.md#async-queue) |
| 11 | [News feed](#news-feed) | Medium | Read-heavy & caching | [News feed](../../../classes/case-studies/news-feed/index.md) | [`news-feed`](../../../../playground/scenarios/index.md#news-feed) |
| 12 | [Photo sharing (Instagram-like)](#photo-sharing) | Medium | Read-heavy & caching | — | [`cdn-static`](../../../../playground/scenarios/index.md#cdn-static) |
| 13 | [Search autocomplete](#search-autocomplete) | Medium | Read-heavy & caching | [Search autocomplete](../../../classes/case-studies/search-autocomplete/index.md) | [`search-autocomplete`](../../../../playground/scenarios/index.md#search-autocomplete) |
| 14 | [Distributed cache](#distributed-cache) | Medium | Read-heavy & caching | [Distributed cache](../../../classes/case-studies/distributed-cache/index.md) | [`read-heavy-cache`](../../../../playground/scenarios/index.md#read-heavy-cache) |
| 15 | [BoxOffice seat map](#seat-map) | Medium | Read-heavy & caching | [Ticketing (BoxOffice flash sale)](../../../classes/case-studies/ticketing/index.md) | [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale) |
| 16 | [Video view counter](#view-counter) | Medium | Write-heavy & data pipelines | — | [`event-fanout`](../../../../playground/scenarios/index.md#event-fanout) |
| 17 | [Top-K trending events](#top-k-trending) | Medium | Write-heavy & data pipelines | — | [`event-fanout`](../../../../playground/scenarios/index.md#event-fanout) |
| 18 | [Ad click aggregation](#ad-click-aggregation) | Medium | Write-heavy & data pipelines | — | [`event-fanout`](../../../../playground/scenarios/index.md#event-fanout) |
| 19 | [Centralized logging pipeline](#logging-pipeline) | Medium | Write-heavy & data pipelines | — | [`observability-stack`](../../../../playground/scenarios/index.md#observability-stack) |
| 20 | [Metrics and monitoring system](#metrics-monitoring) | Medium | Write-heavy & data pipelines | — | [`observability-stack`](../../../../playground/scenarios/index.md#observability-stack) |
| 21 | [Chat (WhatsApp / Slack)](#chat) | Medium | Real-time & geo | [Chat](../../../classes/case-studies/chat/index.md) | [`chat`](../../../../playground/scenarios/index.md#chat) |
| 22 | [Live comments and reactions](#live-comments) | Medium | Real-time & geo | — | [`chat`](../../../../playground/scenarios/index.md#chat) |
| 23 | [Proximity service (Yelp-like)](#proximity-service) | Medium | Real-time & geo | — | [`ride-sharing`](../../../../playground/scenarios/index.md#ride-sharing) |
| 24 | [Distributed job scheduler](#job-scheduler) | Medium | Async & workflows | — | [`notification-system`](../../../../playground/scenarios/index.md#notification-system) |
| 25 | [Web crawler](#web-crawler) | Medium | Async & workflows | — | [`async-queue`](../../../../playground/scenarios/index.md#async-queue) |
| 26 | [BoxOffice refunds after a cancellation](#refunds) | Medium | Async & workflows | [Payment system](../../../classes/case-studies/payment-system/index.md) | [`payment-system`](../../../../playground/scenarios/index.md#payment-system) |
| 27 | [API gateway](#api-gateway) | Medium | Infrastructure & platform | [Rate limiter](../../../classes/case-studies/rate-limiter/index.md) | [`rate-limiter`](../../../../playground/scenarios/index.md#rate-limiter) |
| 28 | [Content delivery network](#cdn) | Medium | Infrastructure & platform | — | [`cdn-static`](../../../../playground/scenarios/index.md#cdn-static) |
| 29 | [BoxOffice flash sale (ticketing)](#flash-sale-ticketing) | Hard | Money & consistency | [Ticketing (BoxOffice flash sale)](../../../classes/case-studies/ticketing/index.md) | [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale) |
| 30 | [Payment system](#payment-system) | Hard | Money & consistency | [Payment system](../../../classes/case-studies/payment-system/index.md) | [`payment-system`](../../../../playground/scenarios/index.md#payment-system) |
| 31 | [BoxOffice virtual waiting room](#waiting-room) | Hard | Money & consistency | [Ticketing (BoxOffice flash sale)](../../../classes/case-studies/ticketing/index.md) | [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale) |
| 32 | [Hotel booking](#hotel-booking) | Hard | Money & consistency | — | [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale) |
| 33 | [E-commerce checkout](#checkout) | Hard | Money & consistency | [Payment system](../../../classes/case-studies/payment-system/index.md) | [`payment-system`](../../../../playground/scenarios/index.md#payment-system) |
| 34 | [Digital wallet](#digital-wallet) | Hard | Money & consistency | [Payment system](../../../classes/case-studies/payment-system/index.md) | [`payment-system`](../../../../playground/scenarios/index.md#payment-system) |
| 35 | [Ride sharing (Uber / 99)](#ride-sharing) | Hard | Real-time & geo | [Ride sharing](../../../classes/case-studies/ride-sharing/index.md) | [`ride-sharing`](../../../../playground/scenarios/index.md#ride-sharing) |
| 36 | [Food delivery](#food-delivery) | Hard | Real-time & geo | — | [`ride-sharing`](../../../../playground/scenarios/index.md#ride-sharing) |
| 37 | [Multiplayer game backend](#multiplayer-game) | Hard | Real-time & geo | — | [`chat`](../../../../playground/scenarios/index.md#chat) |
| 38 | [Video streaming (YouTube / Netflix)](#video-streaming) | Hard | Search & media | [Video streaming](../../../classes/case-studies/video-streaming/index.md) | [`video-streaming`](../../../../playground/scenarios/index.md#video-streaming) |
| 39 | [File sync (Dropbox / Google Drive)](#file-sync) | Hard | Search & media | — | [`cdn-static`](../../../../playground/scenarios/index.md#cdn-static) |
| 40 | [Post search (Twitter-like)](#tweet-search) | Hard | Search & media | [Search autocomplete](../../../classes/case-studies/search-autocomplete/index.md) | [`search-autocomplete`](../../../../playground/scenarios/index.md#search-autocomplete) |
| 41 | [BoxOffice AI support assistant](#ai-assistant) | Hard | AI systems | [AI assistant](../../../classes/case-studies/ai-assistant/index.md) | [`ai-assistant`](../../../../playground/scenarios/index.md#ai-assistant) |
| 42 | [Documentation chatbot with RAG](#rag-chatbot) | Hard | AI systems | [AI assistant](../../../classes/case-studies/ai-assistant/index.md) | [`ai-assistant`](../../../../playground/scenarios/index.md#ai-assistant) |
| 43 | [Semantic event search](#semantic-search) | Hard | AI systems | [Search autocomplete](../../../classes/case-studies/search-autocomplete/index.md) | [`search-autocomplete`](../../../../playground/scenarios/index.md#search-autocomplete) |
| 44 | [Distributed key-value store](#key-value-store) | Advanced | Distributed foundations | — | [`sharding`](../../../../playground/scenarios/index.md#sharding) |
| 45 | [Distributed lock service](#distributed-lock) | Advanced | Distributed foundations | — | [`db-replicas`](../../../../playground/scenarios/index.md#db-replicas) |
| 46 | [Collaborative document editing](#collaborative-editing) | Advanced | Distributed foundations | — | [`chat`](../../../../playground/scenarios/index.md#chat) |
| 47 | [Stock exchange matching engine](#matching-engine) | Advanced | Distributed foundations | — | [`event-fanout`](../../../../playground/scenarios/index.md#event-fanout) |
| 48 | [Multi-region BoxOffice](#multi-region-boxoffice) | Advanced | Distributed foundations | [Ticketing (BoxOffice flash sale)](../../../classes/case-studies/ticketing/index.md) | [`multi-region`](../../../../playground/scenarios/index.md#multi-region) |
| 49 | [Agent platform with tools](#agent-platform) | Advanced | AI systems | [AI assistant](../../../classes/case-studies/ai-assistant/index.md) | [`ai-assistant`](../../../../playground/scenarios/index.md#ai-assistant) |
| 50 | [Model-serving gateway](#llm-serving-gateway) | Advanced | AI systems | [AI assistant](../../../classes/case-studies/ai-assistant/index.md) | [`ai-assistant`](../../../../playground/scenarios/index.md#ai-assistant) |

---

## Warm-up { #warm-up }

One core idea and a small design. Good first problems for interns and new grads: aim to finish all seven framework steps in 30–35 minutes.

### Read-heavy & caching

#### 1. URL shortener { #url-shortener }

Design a service like bit.ly. Users submit a long URL and get a short one (`https://bx.to/aZ3k9Q`); anyone opening the short link is redirected to the original. Assume 100 million new links per month and a read:write ratio of 100:1, so about 4 billion redirects per month, and links that live for years. Redirects must feel instant (p99 under 50 ms at the edge).

**Clarify first.**

- Custom aliases? Expiration? Can a link be edited or deleted?
- Do we need click analytics, and how fresh must they be?
- Is the same long URL always mapped to the same short code?

**Key concepts.**

- [Back-of-the-envelope numbers](../../../classes/estimation/numbers/index.md)
- [Caching patterns and hit-ratio math](../../../classes/caching/patterns/index.md)
- [Partitioning and hot keys](../../../classes/databases/partitioning/index.md)
- [DNS and CDN](../../../classes/edge/dns-cdn/index.md)
- Catalog: [CDN](../../../reference/components/edge/index.md#cdn) · [Cache](../../../reference/components/storage/index.md#cache) · [NoSQL DB](../../../reference/components/storage/index.md#nosql) · [Kafka](../../../reference/components/messaging/index.md#kafka)

**Watch for.** Generating codes by hashing the URL and truncating it produces collisions; a counter or pre-generated key ranges avoid them. And 301 (permanent) redirects are cached by browsers, which hides clicks from your analytics; 302 does not.

**Practice.** Case study: [URL shortener](../../../classes/case-studies/url-shortener/index.md) · Playground scenario: [`url-shortener`](../../../../playground/scenarios/index.md#url-shortener) (the classic problem)

??? tip "Hints"

    - Estimate: ~40 writes/s and ~1,500 reads/s on average; 7 base-62 characters give 62⁷ ≈ 3.5 × 10¹² codes.
    - Key generation: a distributed counter (or ranges handed out to each server) encoded in base 62.
    - Store `code → long URL` in a key-value store; cache hot codes (Zipf: a few links get most clicks).
    - Click analytics asynchronously: publish an event per redirect and aggregate it off the request path.

#### 2. Pastebin { #pastebin }

Design a service where users paste a block of text (up to 1 MB) and get a link to share it. Pastes can be public or unlisted and may expire. Assume 1 million new pastes per day, 10 reads per paste on average, and that a few pastes go viral (shared on social media) and get millions of reads.

**Clarify first.**

- Maximum size and average size of a paste?
- How long are pastes kept by default? Do expired pastes have to disappear immediately?
- Syntax highlighting on the server or in the browser?

**Key concepts.**

- [Back-of-the-envelope numbers](../../../classes/estimation/numbers/index.md)
- [Search engines, object storage, warehouses and vectors](../../../classes/databases/specialized/index.md)
- [Caching patterns and hit-ratio math](../../../classes/caching/patterns/index.md)
- [DNS and CDN](../../../classes/edge/dns-cdn/index.md)
- Catalog: [Object Store](../../../reference/components/storage/index.md#objstore) · [SQL Database](../../../reference/components/storage/index.md#sql) · [CDN](../../../reference/components/edge/index.md#cdn) · [Cache](../../../reference/components/storage/index.md#cache)

**Watch for.** Putting 1 MB blobs in the relational database bloats it and its backups; keep metadata in the database and the content in an object store, served through the CDN.

**Practice.** Case study: no case study yet — compare with [URL shortener](../../../classes/case-studies/url-shortener/index.md) · Playground scenario: [`cdn-static`](../../../../playground/scenarios/index.md#cdn-static) (CDN offloading static and media traffic)

??? tip "Hints"

    - Storage: 1 M/day × ~10 KB average ≈ 10 GB/day ≈ 3.6 TB/year: an object store, not a database.
    - Reuse the URL shortener's key generation for paste ids.
    - Viral pastes: immutable content means long CDN TTLs and a very high hit ratio.
    - Expiration: a TTL field plus lifecycle rules in the object store; a lazy check on read.

#### 3. Game leaderboard { #leaderboard }

Design the leaderboard of a mobile game with 20 million monthly players. Every match updates the player's score; the app shows the top 100 and the player's own rank ("you are #1,234,567"). Peak of 50,000 score updates per second during evening hours. The leaderboard resets every month.

**Clarify first.**

- Real-time ranks, or is a delay of a few seconds acceptable?
- Global ranking only, or also per country and among friends?
- How are ties broken?

**Key concepts.**

- [Redis data structures and cluster](../../../classes/caching/redis/index.md)
- [Partitioning and hot keys](../../../classes/databases/partitioning/index.md)
- [Back-of-the-envelope numbers](../../../classes/estimation/numbers/index.md)
- Catalog: [Cache](../../../reference/components/storage/index.md#cache) · [SQL Database](../../../reference/components/storage/index.md#sql) · [Message Queue](../../../reference/components/messaging/index.md#queue)

**Watch for.** `SELECT COUNT(*) WHERE score > ?` on every request does not scale to 20 million rows at that rate; a sorted set gives rank in O(log n).

**Practice.** Case study: no case study yet — compare with [Distributed cache](../../../classes/case-studies/distributed-cache/index.md) · Playground scenario: [`read-heavy-cache`](../../../../playground/scenarios/index.md#read-heavy-cache) (cache-aside in front of SQL)

??? tip "Hints"

    - Redis sorted set: `ZINCRBY` on update, `ZREVRANGE` for the top 100, `ZREVRANK` for my rank.
    - 20 M members × ~100 bytes ≈ 2 GB: fits in memory on one node; replicate for availability.
    - Persist scores in a database too (source of truth); rebuild the set from it after a loss.
    - Beyond one node: shard by score range or keep an approximate rank for the long tail.

#### 4. BoxOffice event catalog { #event-catalog }

Design BoxOffice's event catalog: pages for concerts, games and festivals with description, venue, dates, prices and images. 50,000 active events, 5 million page views per day on a normal day, and up to 200 times that on the morning of a big on-sale. Promoters edit events a few times a day.

**Clarify first.**

- How fresh must a price change be on the page?
- Are pages personalized (logged-in user, recommendations) or the same for everyone?
- Which parts change during an on-sale (availability) and which do not?

**Key concepts.**

- [DNS and CDN](../../../classes/edge/dns-cdn/index.md)
- [Caching patterns and hit-ratio math](../../../classes/caching/patterns/index.md)
- [Cache invalidation and TTL](../../../classes/caching/invalidation/index.md)
- [Replication and replication lag](../../../classes/databases/replication/index.md)
- Catalog: [CDN](../../../reference/components/edge/index.md#cdn) · [Cache](../../../reference/components/storage/index.md#cache) · [SQL Database](../../../reference/components/storage/index.md#sql) · [Object Store](../../../reference/components/storage/index.md#objstore)

**Watch for.** Mixing per-user data (cart, "you have tickets") into the cached page kills the hit ratio or, worse, shows one user's data to another; keep the page public and load personal bits separately.

**Practice.** Case study: [Ticketing (BoxOffice flash sale)](../../../classes/case-studies/ticketing/index.md) · Playground scenario: [`cdn-static`](../../../../playground/scenarios/index.md#cdn-static) (CDN offloading static and media traffic)

??? tip "Hints"

    - 5 M views/day ≈ 60/s average; the on-sale peak can reach 10⁴–10⁵/s, almost all on the same few pages.
    - Static parts through the CDN with a short TTL (seconds) plus purge on edit; images with versioned URLs.
    - Cache-aside in Redis for the API; read replicas for the database.
    - Availability ("few seats left") comes from a separate, short-lived endpoint, never baked into the page.

### Infrastructure & platform

#### 5. Distributed rate limiter { #rate-limiter }

Design the rate limiter of BoxOffice's API gateway. Each user may make at most 10 requests per second to the purchase API (bursts of 20 allowed), and each API key of a partner at most 1,000 per minute. The gateway runs as 30 replicas behind a load balancer and handles 200,000 requests per second at peak.

**Clarify first.**

- Is a slightly inaccurate limit acceptable (a few extra requests) in exchange for latency?
- What happens when the limiter's store is unavailable: allow or block?
- Do limits vary per endpoint, per plan or per user tier?

**Key concepts.**

- [API gateway and rate-limiting algorithms](../../../classes/edge/api-gateway/index.md)
- [Redis data structures and cluster](../../../classes/caching/redis/index.md)
- [Timeouts, retries, circuit breakers and load shedding](../../../classes/reliability/patterns/index.md)
- Catalog: [API Gateway](../../../reference/components/edge/index.md#apigw) · [Cache](../../../reference/components/storage/index.md#cache) · [Load Balancer](../../../reference/components/edge/index.md#lb)

**Watch for.** Counting in each replica's memory lets a user get 30 × the limit; the counter must be shared (Redis) or the limit divided per replica. A fixed window allows 2× the limit at window boundaries.

**Practice.** Case study: [Rate limiter](../../../classes/case-studies/rate-limiter/index.md) · Playground scenario: [`rate-limiter`](../../../../playground/scenarios/index.md#rate-limiter) (gateway rate limiting)

??? tip "Hints"

    - Token bucket (rate 10/s, capacity 20) per user, stored in Redis and updated atomically with a Lua script.
    - Respond 429 with `Retry-After`; return the remaining quota in headers.
    - Fail open for the general API (availability), fail closed for abuse-sensitive endpoints.
    - To cut Redis round trips: local token caches with periodic sync, accepting small overshoot.

#### 6. Unique ID generator { #unique-id-generator }

BoxOffice needs unique 64-bit ids for orders, tickets and events, generated by 200 service instances in 3 regions, up to 100,000 ids per second in total. Ids should be roughly sortable by creation time, and generating one must not require a network call to a central service on every request.

**Clarify first.**

- Must ids be strictly increasing, or is rough time order enough?
- Is it a problem if ids reveal the creation time or the volume of orders?
- Can we use 128 bits (UUID) instead of 64?

**Key concepts.**

- [Time and clocks](../../../classes/distributed/time-clocks/index.md)
- [Consensus and quorums](../../../classes/distributed/consensus/index.md)
- [Data models, SQL vs NoSQL and indexes](../../../classes/databases/models/index.md)
- Catalog: [App Server](../../../reference/components/compute/index.md#app) · [SQL Database](../../../reference/components/storage/index.md#sql)

**Watch for.** A single auto-increment database is a bottleneck and a single point of failure; random UUIDv4 keys fragment B-tree indexes. Clocks can go backwards: a Snowflake-style generator must handle it.

**Practice.** Case study: no case study yet — compare with [URL shortener](../../../classes/case-studies/url-shortener/index.md) · Playground scenario: [`scale-out`](../../../../playground/scenarios/index.md#scale-out) (load balancer and replicas)

??? tip "Hints"

    - Snowflake layout: 41 bits of milliseconds + 10 bits of machine id + 12 bits of sequence ≈ 4,096 ids/ms per machine.
    - Assign machine ids at startup (from a coordination service or configuration), never at random.
    - If the clock moves backwards, wait or refuse until it catches up.
    - Alternatives: UUIDv7 (time-ordered, 128 bits) or database ranges handed out in blocks.

#### 7. Feature flag service { #feature-flags }

Design a feature flag service for BoxOffice's 40 services: engineers turn features on or off and roll them out to a percentage of users or to specific segments ("5% of users in Brazil"). Every request may evaluate several flags, so evaluation must add essentially no latency, and a change must reach all services within 10 seconds.

**Clarify first.**

- How many flags and rules, roughly? Do rules depend on user attributes?
- What should a service do if it cannot reach the flag service at startup?
- Do we need an audit log of who changed what?

**Key concepts.**

- [Canary releases and feature flags](../../../classes/cloud-native/delivery/index.md)
- [Caching patterns and hit-ratio math](../../../classes/caching/patterns/index.md)
- [Queues vs pub/sub vs event logs](../../../classes/messaging/queues-pubsub/index.md)
- Catalog: [App Server](../../../reference/components/compute/index.md#app) · [SQL Database](../../../reference/components/storage/index.md#sql) · [Pub/Sub](../../../reference/components/messaging/index.md#pubsub) · [Cache](../../../reference/components/storage/index.md#cache)

**Watch for.** Calling the flag service over the network on every evaluation puts it on every request's critical path; evaluate locally from a cached rule set. Percentage rollouts must be sticky (hash of user id), not random per request.

**Practice.** Case study: no case study yet — compare with [Distributed cache](../../../classes/case-studies/distributed-cache/index.md) · Playground scenario: [`read-heavy-cache`](../../../../playground/scenarios/index.md#read-heavy-cache) (cache-aside in front of SQL)

??? tip "Hints"

    - SDK in each service keeps the full rule set in memory and evaluates flags locally in microseconds.
    - Changes stored in a database and pushed via pub/sub or streaming (SSE), with polling as a fallback.
    - Sticky percentages: `hash(flag, user_id) mod 100 < rollout%`.
    - Safe defaults compiled into the code; an audit log and a kill switch for each flag.

### Write-heavy & data pipelines

#### 8. Likes counter { #likes-counter }

Design the "interested" counter shown on every BoxOffice event (like a social-media like counter). Users can mark and unmark interest; the page shows the total. Most events get a few clicks per minute, but when a big artist announces a tour, a single event receives 20,000 clicks per second for several minutes.

**Clarify first.**

- Must the displayed count be exact and immediate, or can it lag a few seconds?
- Can a user count twice? Do we need to know who is interested?
- Is the count used for anything critical (ranking, billing)?

**Key concepts.**

- [Partitioning and hot keys](../../../classes/databases/partitioning/index.md)
- [Hot keys and cache stampedes](../../../classes/caching/failure-modes/index.md)
- [Delivery semantics and idempotent consumers](../../../classes/messaging/semantics/index.md)
- Catalog: [Cache](../../../reference/components/storage/index.md#cache) · [NoSQL DB](../../../reference/components/storage/index.md#nosql) · [Message Queue](../../../reference/components/messaging/index.md#queue) · [Worker](../../../reference/components/compute/index.md#worker)

**Watch for.** One row `UPDATE events SET interested = interested + 1` becomes a hot row: every click fights for the same lock. Spread the writes and aggregate.

**Practice.** Case study: no case study yet — compare with [News feed](../../../classes/case-studies/news-feed/index.md) · Playground scenario: [`sharding`](../../../../playground/scenarios/index.md#sharding) (partitions and hot keys)

??? tip "Hints"

    - Store who is interested as (user, event) rows with a unique key: idempotent and auditable.
    - Sharded counters: N sub-counters per hot event (random suffix), summed on read or periodically.
    - Or buffer clicks in a queue and let workers apply batched increments every second.
    - Show an approximate, cached count; exactness can catch up.

### Async & workflows

#### 9. Notification system { #notification-system }

Design BoxOffice's notification system: order confirmations by email, push notifications ("doors open in 1 hour") and SMS for critical changes ("show cancelled"). Normal load is 50 notifications per second; when a show is cancelled, 60,000 fans must be notified within 10 minutes. Users can choose channels and opt out of marketing.

**Clarify first.**

- Which messages are transactional and which are marketing?
- Is at-least-once acceptable (a rare duplicate) or must we never send twice?
- Are there scheduled notifications (reminders) as well as event-triggered ones?

**Key concepts.**

- [Queues vs pub/sub vs event logs](../../../classes/messaging/queues-pubsub/index.md)
- [Delivery semantics and idempotent consumers](../../../classes/messaging/semantics/index.md)
- [Webhooks, idempotency keys and reconciliation](../../../classes/compute/integrations/index.md)
- [Workers, schedulers and leader election](../../../classes/compute/async-work/index.md)
- Catalog: [Notifications](../../../reference/components/compute/index.md#notifications) · [Message Queue](../../../reference/components/messaging/index.md#queue) · [Worker](../../../reference/components/compute/index.md#worker) · [Scheduler](../../../reference/components/compute/index.md#scheduler) · [Email](../../../reference/components/external/index.md#email)

**Watch for.** Calling the email provider synchronously from the order service couples the purchase to the provider's latency and outages. And every provider has a rate limit: 60,000 messages in 10 minutes is 100/s, which must fit it.

**Practice.** Case study: [Notification system](../../../classes/case-studies/notification-system/index.md) · Playground scenario: [`notification-system`](../../../../playground/scenarios/index.md#notification-system) (scheduler, queue and providers)

??? tip "Hints"

    - Events (OrderConfirmed, ShowCancelled) → notification service → one queue per channel → workers per channel.
    - Preferences and templates looked up before enqueueing; per-user rate limits for marketing.
    - Idempotency key (event id + channel) so retries do not send twice; DLQ after N failures.
    - Priority queues so a marketing blast never delays a cancellation notice.

#### 10. Webhook delivery service { #webhook-delivery }

BoxOffice partners (promoters, venues) want to be notified by HTTP callbacks when something happens: a ticket is sold, an event changes, a refund is issued. 2,000 partners, 500 events per second at peak. Some partner endpoints are slow or down for hours; one bad partner must not delay the others.

**Clarify first.**

- Delivery guarantee: at-least-once with retries for how long?
- Does order matter per partner (for example, "sold" before "refunded")?
- How do partners verify that a call really comes from BoxOffice?

**Key concepts.**

- [Webhooks, idempotency keys and reconciliation](../../../classes/compute/integrations/index.md)
- [Delivery semantics and idempotent consumers](../../../classes/messaging/semantics/index.md)
- [Timeouts, retries, circuit breakers and load shedding](../../../classes/reliability/patterns/index.md)
- [Queues vs pub/sub vs event logs](../../../classes/messaging/queues-pubsub/index.md)
- Catalog: [Message Queue](../../../reference/components/messaging/index.md#queue) · [Worker](../../../reference/components/compute/index.md#worker) · [3rd Party API](../../../reference/components/external/index.md#thirdparty) · [NAT Gateway](../../../reference/components/network/index.md#nat)

**Watch for.** One shared queue and worker pool means a partner that takes 30 s to time out blocks everyone (head-of-line blocking). Isolate per partner and back off.

**Practice.** Case study: no case study yet — compare with [Notification system](../../../classes/case-studies/notification-system/index.md) · Playground scenario: [`async-queue`](../../../../playground/scenarios/index.md#async-queue) (queue and workers absorbing a spike)

??? tip "Hints"

    - Persist each event, then deliver from a queue partitioned by partner (keeps per-partner order).
    - Short timeouts, exponential backoff with jitter for up to ~24–72 h, then DLQ and a dashboard for partners.
    - Sign payloads (HMAC with a per-partner secret) and include an event id so partners can deduplicate.
    - Per-partner concurrency limits and circuit breakers so a dead endpoint costs almost nothing.

---

## Medium { #medium }

Two or three components that interact, a real scale number and at least one deep dive. The typical 45-minute interview.

### Read-heavy & caching

#### 11. News feed { #news-feed }

Design the home feed of a social network: users follow others and see their posts, newest first. 300 million daily active users, each opening the feed about 10 times a day; 50 million new posts per day. Most users follow a few hundred accounts, but some celebrities have 50 million followers. Loading the first page should take under 200 ms.

**Clarify first.**

- Chronological or ranked feed?
- Text only, or images and video?
- How fresh must the feed be after someone posts?

**Key concepts.**

- [Back-of-the-envelope numbers](../../../classes/estimation/numbers/index.md)
- [Caching patterns and hit-ratio math](../../../classes/caching/patterns/index.md)
- [Queues vs pub/sub vs event logs](../../../classes/messaging/queues-pubsub/index.md)
- [Partitioning and hot keys](../../../classes/databases/partitioning/index.md)
- Catalog: [Cache](../../../reference/components/storage/index.md#cache) · [NoSQL DB](../../../reference/components/storage/index.md#nosql) · [Kafka](../../../reference/components/messaging/index.md#kafka) · [Worker](../../../reference/components/compute/index.md#worker) · [CDN](../../../reference/components/edge/index.md#cdn)

**Watch for.** Pure fan-out on write breaks on celebrities (one post = 50 M timeline writes); pure fan-out on read makes every feed open query hundreds of accounts. The answer is a hybrid.

**Practice.** Case study: [News feed](../../../classes/case-studies/news-feed/index.md) · Playground scenario: [`news-feed`](../../../../playground/scenarios/index.md#news-feed) (fan-out on write vs read)

??? tip "Hints"

    - Reads: 300 M × 10 ÷ 10⁵ s ≈ 35,000 feed loads/s on average; writes ≈ 600 posts/s.
    - Fan-out on write into per-user timelines (lists of post ids in Redis) for normal accounts.
    - Celebrity posts merged at read time; inactive users' timelines rebuilt on demand.
    - Cursor-based pagination; media served from object storage through the CDN.

#### 12. Photo sharing (Instagram-like) { #photo-sharing }

Design the upload and viewing of photos for an Instagram-like app: 500 million daily users, 100 million photo uploads per day (average 2 MB original), each photo shown in 3 sizes. Viewing must be fast worldwide; uploads may take a few seconds to become visible.

**Clarify first.**

- Do we keep the originals forever?
- Is the feed in scope, or only upload, storage and viewing?
- Private accounts: who may view a photo URL?

**Key concepts.**

- [Back-of-the-envelope numbers](../../../classes/estimation/numbers/index.md)
- [Search engines, object storage, warehouses and vectors](../../../classes/databases/specialized/index.md)
- [DNS and CDN](../../../classes/edge/dns-cdn/index.md)
- [Workers, schedulers and leader election](../../../classes/compute/async-work/index.md)
- Catalog: [Object Store](../../../reference/components/storage/index.md#objstore) · [CDN](../../../reference/components/edge/index.md#cdn) · [Message Queue](../../../reference/components/messaging/index.md#queue) · [Worker](../../../reference/components/compute/index.md#worker) · [NoSQL DB](../../../reference/components/storage/index.md#nosql)

**Watch for.** Uploading through your app servers wastes their bandwidth; let clients upload directly to the object store with a pre-signed URL. Storage dominates the cost: estimate it.

**Practice.** Case study: no case study yet — compare with [Video streaming](../../../classes/case-studies/video-streaming/index.md) · Playground scenario: [`cdn-static`](../../../../playground/scenarios/index.md#cdn-static) (CDN offloading static and media traffic)

??? tip "Hints"

    - Storage: 100 M × ~3 MB (original + sizes) ≈ 300 TB/day ≈ 100 PB/year: tiered storage matters.
    - Pre-signed upload → object-created event → resize workers → metadata row → visible.
    - Serve through the CDN with immutable, versioned URLs; signed URLs for private content.
    - Metadata in a partitioned store keyed by user id; counters (likes) handled separately.

#### 13. Search autocomplete { #search-autocomplete }

Design the autocomplete of BoxOffice's search box: as the fan types "tay", suggest the 10 best completions (artists, events, venues) within 100 ms. 10 million searches per day, roughly 6 keystrokes each, so about 60 million suggestion requests per day; suggestions should reflect trending events within an hour.

**Clarify first.**

- Personalized suggestions or the same for everyone?
- Typo tolerance? Multiple languages?
- How is "best" defined: popularity, recency, sales?

**Key concepts.**

- [Search engines, object storage, warehouses and vectors](../../../classes/databases/specialized/index.md)
- [Caching patterns and hit-ratio math](../../../classes/caching/patterns/index.md)
- [Kafka partitions, consumer groups and retention](../../../classes/messaging/kafka/index.md)
- [Back-of-the-envelope numbers](../../../classes/estimation/numbers/index.md)
- Catalog: [Search](../../../reference/components/compute/index.md#search) · [Cache](../../../reference/components/storage/index.md#cache) · [CDN](../../../reference/components/edge/index.md#cdn) · [Kafka](../../../reference/components/messaging/index.md#kafka) · [Worker](../../../reference/components/compute/index.md#worker)

**Watch for.** Querying the main database with `LIKE 'tay%'` per keystroke melts it; precompute the top completions per prefix. And debounce on the client: not every keystroke needs a request.

**Practice.** Case study: [Search autocomplete](../../../classes/case-studies/search-autocomplete/index.md) · Playground scenario: [`search-autocomplete`](../../../../playground/scenarios/index.md#search-autocomplete) (search service and cache)

??? tip "Hints"

    - 60 M/day ≈ 700 req/s average, a few thousand at peak; responses are tiny and highly cacheable.
    - A trie or prefix map with the top 10 per prefix, rebuilt from search logs and sales every few minutes.
    - Cache short prefixes aggressively (CDN, browser); they repeat the most.
    - Pipeline: query logs → Kafka → aggregation job → new prefix index → atomic swap.

#### 14. Distributed cache { #distributed-cache }

Design a distributed in-memory cache (like a simplified Redis Cluster or Memcached fleet) for BoxOffice: 2 TB of data, 1 million operations per second, sub-millisecond latency inside the data center. Nodes fail and are added; the cache must keep working with only a small drop in hit ratio when that happens.

**Clarify first.**

- Pure cache (data can be lost) or also a primary store?
- Value sizes? Read/write ratio?
- Do clients route to nodes directly, or through a proxy?

**Key concepts.**

- [Load balancing and consistent hashing](../../../classes/edge/load-balancing/index.md)
- [Redis data structures and cluster](../../../classes/caching/redis/index.md)
- [Hot keys and cache stampedes](../../../classes/caching/failure-modes/index.md)
- [Replication and replication lag](../../../classes/databases/replication/index.md)
- Catalog: [Cache](../../../reference/components/storage/index.md#cache) · [App Server](../../../reference/components/compute/index.md#app)

**Watch for.** `hash(key) mod N` remaps almost every key when N changes: a global cold cache and a stampede on the database. Use consistent hashing (or fixed hash slots) and protect hot keys.

**Practice.** Case study: [Distributed cache](../../../classes/case-studies/distributed-cache/index.md) · Playground scenario: [`read-heavy-cache`](../../../../playground/scenarios/index.md#read-heavy-cache) (cache-aside in front of SQL)

??? tip "Hints"

    - 2 TB ÷ 64 GB per node ≈ 32 nodes (plus replicas); 1 M ops/s ÷ ~100 k ops/s per node ≈ 10 nodes: memory decides.
    - Consistent hashing with virtual nodes, or 16,384 hash slots as in Redis Cluster.
    - Replica per shard for failover; eviction with LRU/LFU; TTLs on everything.
    - Hot keys: client-side near cache, key replication, or request coalescing.

#### 15. BoxOffice seat map { #seat-map }

During an on-sale, fans look at the stadium's seat map (60,000 seats, colored free/held/sold) and pick seats. 200,000 fans are in the purchase flow at once, refreshing the map every few seconds, while about 1,000 seats per second change state. Design how the seat map is served and kept reasonably fresh.

**Clarify first.**

- How stale may the map be: 1 s, 5 s?
- Do fans pick exact seats, or the best available in a section?
- Mobile and web? Do we push updates or let clients poll?

**Key concepts.**

- [Caching patterns and hit-ratio math](../../../classes/caching/patterns/index.md)
- [Consistency models](../../../classes/distributed/consistency/index.md)
- [WebSockets, SSE and gRPC](../../../classes/edge/protocols/index.md)
- [Transactions, isolation and locking](../../../classes/databases/transactions/index.md)
- Catalog: [Cache](../../../reference/components/storage/index.md#cache) · [CDN](../../../reference/components/edge/index.md#cdn) · [SQL Database](../../../reference/components/storage/index.md#sql) · [Pub/Sub](../../../reference/components/messaging/index.md#pubsub)

**Watch for.** Querying 60,000 seat rows for each of 200,000 fans every few seconds is ~10⁹ rows per second. The map is a cached, compact snapshot (a bitmap); the hold itself is checked against the database, so a stale map can only cause a polite "seat just taken".

**Practice.** Case study: [Ticketing (BoxOffice flash sale)](../../../classes/case-studies/ticketing/index.md) · Playground scenario: [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale) (limited-stock flash sale)

??? tip "Hints"

    - A bitmap of 60,000 seats × 2 bits ≈ 15 KB: one cacheable object per event, rebuilt every second.
    - Serve it from Redis or the CDN with a 1 s TTL; or push deltas over SSE/WebSockets to clients.
    - Offer "best available in section" to reduce contention on the most popular seats.
    - The authoritative check is the conditional update at hold time.

### Write-heavy & data pipelines

#### 16. Video view counter { #view-counter }

Design the view counter of a video platform: 1 billion views per day across 500 million videos, some videos getting 100,000 views per minute right after release. Creators see counts update within a minute; counts must not be inflated by bots or by the same user replaying the first seconds.

**Clarify first.**

- What counts as a view (watched 30 s? any start)?
- Is the count used for payouts (must be exact and auditable)?
- Do we need per-day/per-country breakdowns?

**Key concepts.**

- [Kafka partitions, consumer groups and retention](../../../classes/messaging/kafka/index.md)
- [Partitioning and hot keys](../../../classes/databases/partitioning/index.md)
- [Delivery semantics and idempotent consumers](../../../classes/messaging/semantics/index.md)
- [Search engines, object storage, warehouses and vectors](../../../classes/databases/specialized/index.md)
- Catalog: [Kafka](../../../reference/components/messaging/index.md#kafka) · [Worker](../../../reference/components/compute/index.md#worker) · [NoSQL DB](../../../reference/components/storage/index.md#nosql) · [Data Warehouse](../../../reference/components/storage/index.md#dwh) · [Cache](../../../reference/components/storage/index.md#cache)

**Watch for.** Incrementing a database row per view (≈ 12,000 writes/s, concentrated on hot videos) creates hot rows; and "exactly once" counting needs deduplication by event id, not hope.

**Practice.** Case study: no case study yet — compare with [Video streaming](../../../classes/case-studies/video-streaming/index.md) · Playground scenario: [`event-fanout`](../../../../playground/scenarios/index.md#event-fanout) (event stream with several consumers)

??? tip "Hints"

    - View events → Kafka (keyed by video id) → stream aggregation in 1-minute windows → counter store.
    - Deduplicate by (user/session, video, time bucket); filter bots before counting.
    - Displayed count = stored total + recent window, cached; exact numbers recomputed in batch for payouts.
    - Lambda/kappa idea: fast approximate stream path, slow exact batch path.

#### 17. Top-K trending events { #top-k-trending }

BoxOffice wants a "trending now" list: the 50 most viewed and most purchased events in the last hour, per country, updated every minute. The input is a stream of 50,000 page-view and purchase events per second.

**Clarify first.**

- Exact counts or approximate top-K acceptable?
- Sliding window of exactly one hour or hourly buckets?
- How are views and purchases weighted?

**Key concepts.**

- [Kafka partitions, consumer groups and retention](../../../classes/messaging/kafka/index.md)
- [Partitioning and hot keys](../../../classes/databases/partitioning/index.md)
- [Caching patterns and hit-ratio math](../../../classes/caching/patterns/index.md)
- Catalog: [Kafka](../../../reference/components/messaging/index.md#kafka) · [Worker](../../../reference/components/compute/index.md#worker) · [Cache](../../../reference/components/storage/index.md#cache) · [Analytics](../../../reference/components/compute/index.md#analytics)

**Watch for.** Keeping an exact counter for every (event, country, minute) in a database works at small scale but explodes in writes; heavy hitters can be found with bounded memory (Count-Min Sketch + heap).

**Practice.** Case study: no case study yet — compare with [Search autocomplete](../../../classes/case-studies/search-autocomplete/index.md) · Playground scenario: [`event-fanout`](../../../../playground/scenarios/index.md#event-fanout) (event stream with several consumers)

??? tip "Hints"

    - Partition the stream by event id; each consumer keeps per-minute counts in memory.
    - Every minute, each partition emits its local top-K; a merger computes the global top-K per country.
    - Sliding hour = sum of the last 60 one-minute buckets.
    - Serve the result from a cache; it is tiny and read by everyone.

#### 18. Ad click aggregation { #ad-click-aggregation }

Design the system that counts clicks on ads for billing advertisers: 10 billion clicks per day, peak 500,000 per second. Advertisers see per-minute dashboards with a delay of a few minutes, and invoices at the end of the month must be exact: no click counted twice, none lost.

**Clarify first.**

- How late can click events arrive (mobile offline)?
- Do we filter fraudulent clicks before billing?
- Which dimensions do advertisers filter by?

**Key concepts.**

- [Kafka partitions, consumer groups and retention](../../../classes/messaging/kafka/index.md)
- [Delivery semantics and idempotent consumers](../../../classes/messaging/semantics/index.md)
- [Search engines, object storage, warehouses and vectors](../../../classes/databases/specialized/index.md)
- [Time and clocks](../../../classes/distributed/time-clocks/index.md)
- Catalog: [Kafka](../../../reference/components/messaging/index.md#kafka) · [Worker](../../../reference/components/compute/index.md#worker) · [Data Warehouse](../../../reference/components/storage/index.md#dwh) · [Object Store](../../../reference/components/storage/index.md#objstore) · [Analytics](../../../reference/components/compute/index.md#analytics)

**Watch for.** Event time is not processing time: late events must land in the right minute (watermarks). And billing needs replayable raw data: keep the raw clicks, never only the aggregates.

**Practice.** Case study: no case study yet — compare with [News feed](../../../classes/case-studies/news-feed/index.md) · Playground scenario: [`event-fanout`](../../../../playground/scenarios/index.md#event-fanout) (event stream with several consumers)

??? tip "Hints"

    - Clicks → Kafka (raw, retained) → stream job with event-time windows → OLAP store for dashboards.
    - Deduplicate by click id within a window; idempotent writes of aggregates (upsert by window key).
    - Raw clicks archived in object storage; nightly batch recomputes exact totals for invoices.
    - Reconcile stream vs batch numbers and alert on drift.

#### 19. Centralized logging pipeline { #logging-pipeline }

Design centralized logging for BoxOffice: 300 service instances producing 2 TB of logs per day (10× during an on-sale), searchable within 30 seconds by trace id, order id or error message, kept 14 days hot and 1 year archived. Logging must never slow down or crash the services.

**Clarify first.**

- Structured logs (JSON) already, or free text?
- Which fields must be searchable, and is full-text search needed?
- Any personal data in logs that must be masked?

**Key concepts.**

- [Metrics, logs and traces](../../../classes/observability/signals/index.md)
- [OpenTelemetry](../../../classes/observability/opentelemetry/index.md)
- [Kafka partitions, consumer groups and retention](../../../classes/messaging/kafka/index.md)
- [Search engines, object storage, warehouses and vectors](../../../classes/databases/specialized/index.md)
- Catalog: [Logs](../../../reference/components/observability/index.md#logs) · [Kafka](../../../reference/components/messaging/index.md#kafka) · [Object Store](../../../reference/components/storage/index.md#objstore) · [Worker](../../../reference/components/compute/index.md#worker)

**Watch for.** Indexing every field of every line is the most expensive way to do it; and if the pipeline backs up, agents must buffer and drop debug logs, not block the application.

**Practice.** Case study: no case study yet — compare with [Notification system](../../../classes/case-studies/notification-system/index.md) · Playground scenario: [`observability-stack`](../../../../playground/scenarios/index.md#observability-stack) (metrics, logs, traces, alerts)

??? tip "Hints"

    - Apps log to stdout; node agents (OpenTelemetry Collector, Fluent Bit) ship to Kafka as a buffer.
    - Indexers consume from Kafka; index only labels/key fields (Loki-style) or full text (OpenSearch) where needed.
    - Hot tier for 14 days, then compressed objects in object storage with lifecycle rules.
    - Sample successful request logs, keep all errors; redact sensitive fields at the source.

#### 20. Metrics and monitoring system { #metrics-monitoring }

Design a metrics platform (like a simplified Prometheus + Grafana as a service) for 5,000 servers, each exposing 1,000 time series scraped every 15 s. Dashboards must load in under 2 s for the last 24 hours, alerts must evaluate every 30 s, and data is kept for 1 year at reduced resolution.

**Clarify first.**

- Pull (scrape) or push?
- How many distinct label combinations (cardinality)?
- Does the monitoring system need to be more available than what it monitors?

**Key concepts.**

- [Metrics, logs and traces](../../../classes/observability/signals/index.md)
- [SLO-based alerting](../../../classes/observability/alerting/index.md)
- [Partitioning and hot keys](../../../classes/databases/partitioning/index.md)
- [Back-of-the-envelope numbers](../../../classes/estimation/numbers/index.md)
- Catalog: [Metrics](../../../reference/components/observability/index.md#metrics) · [Alerting](../../../reference/components/observability/index.md#alerting) · [Object Store](../../../reference/components/storage/index.md#objstore) · [NoSQL DB](../../../reference/components/storage/index.md#nosql)

**Watch for.** 5,000 × 1,000 = 5 million active series, ≈ 333,000 samples per second: a general-purpose database is the wrong store. And a monitoring system that dies with the cluster it watches is useless during the outage.

**Practice.** Case study: no case study yet — compare with [Distributed cache](../../../classes/case-studies/distributed-cache/index.md) · Playground scenario: [`observability-stack`](../../../../playground/scenarios/index.md#observability-stack) (metrics, logs, traces, alerts)

??? tip "Hints"

    - Time-series database with compression (≈ 1–2 bytes per sample), sharded by series hash.
    - Recent data in memory/SSD; older blocks compacted and downsampled into object storage.
    - Alert rules evaluated close to the data; Alertmanager-style grouping and routing.
    - Cardinality limits per tenant; run the monitoring stack outside the monitored failure domain.

### Real-time & geo

#### 21. Chat (WhatsApp / Slack) { #chat }

Design a chat service with one-to-one and group conversations (up to 500 members), online presence and delivery/read receipts. 50 million daily users, 40 messages per user per day, and messages delivered within a second to online users; offline users receive them when they reconnect.

**Clarify first.**

- Message history kept forever and synced across devices?
- End-to-end encryption?
- Media messages in scope?

**Key concepts.**

- [WebSockets, SSE and gRPC](../../../classes/edge/protocols/index.md)
- [Queues vs pub/sub vs event logs](../../../classes/messaging/queues-pubsub/index.md)
- [Partitioning and hot keys](../../../classes/databases/partitioning/index.md)
- [Time and clocks](../../../classes/distributed/time-clocks/index.md)
- Catalog: [Load Balancer](../../../reference/components/edge/index.md#lb) · [App Server](../../../reference/components/compute/index.md#app) · [Pub/Sub](../../../reference/components/messaging/index.md#pubsub) · [NoSQL DB](../../../reference/components/storage/index.md#nosql) · [Notifications](../../../reference/components/compute/index.md#notifications)

**Watch for.** Global ordering of all messages is unnecessary and unscalable; order per conversation (a sequence number per conversation id) is what users see. And a WebSocket server must know which server each recipient is connected to.

**Practice.** Case study: [Chat](../../../classes/case-studies/chat/index.md) · Playground scenario: [`chat`](../../../../playground/scenarios/index.md#chat) (websockets and pub/sub)

??? tip "Hints"

    - 2 × 10⁹ messages/day ≈ 23,000/s average; millions of concurrent WebSocket connections across gateway servers.
    - Connection registry (user → gateway server) in a fast store; pub/sub between gateway servers.
    - Store messages partitioned by conversation id (wide-column store), with a per-conversation sequence.
    - Offline: store-and-forward plus push notifications; receipts are just more small messages.

#### 22. Live comments and reactions { #live-comments }

During BoxOffice's livestream of a festival, 1 million viewers watch at once and post comments and emoji reactions. At peak, 20,000 comments per second. Every viewer should see a lively stream of recent comments and the aggregated reaction counts, with a delay of at most 2 seconds.

**Clarify first.**

- Must every viewer see every comment, or a sample is fine?
- Moderation before or after display?
- Are comments kept after the stream ends?

**Key concepts.**

- [WebSockets, SSE and gRPC](../../../classes/edge/protocols/index.md)
- [Queues vs pub/sub vs event logs](../../../classes/messaging/queues-pubsub/index.md)
- [Timeouts, retries, circuit breakers and load shedding](../../../classes/reliability/patterns/index.md)
- Catalog: [Pub/Sub](../../../reference/components/messaging/index.md#pubsub) · [Load Balancer](../../../reference/components/edge/index.md#lb) · [App Server](../../../reference/components/compute/index.md#app) · [Cache](../../../reference/components/storage/index.md#cache) · [Kafka](../../../reference/components/messaging/index.md#kafka)

**Watch for.** Broadcasting 20,000 comments/s to 1 M viewers is 2 × 10¹⁰ messages/s; nobody can read that. Sample or rate-limit what each viewer receives, and aggregate reactions into counts.

**Practice.** Case study: no case study yet — compare with [Chat](../../../classes/case-studies/chat/index.md) · Playground scenario: [`chat`](../../../../playground/scenarios/index.md#chat) (websockets and pub/sub)

??? tip "Hints"

    - Viewers hold SSE/WebSocket connections to edge servers subscribed to the stream's channel.
    - Each edge server receives a down-sampled feed (e.g. 20 comments/s) and fans it out locally.
    - Reactions aggregated per second per server, then globally; broadcast only the counts.
    - Write all comments to Kafka for moderation, replay and storage, off the broadcast path.

#### 23. Proximity service (Yelp-like) { #proximity-service }

Design "what's near me": given a fan's location, list bars, restaurants and parking within 2 km of a venue, sorted by distance and rating. 200 million places worldwide, 20,000 searches per second at peak; places are added or edited a few thousand times per day.

**Clarify first.**

- Fixed radius or "nearest N"? Filters (open now, category)?
- How quickly must a new place appear in results?
- Global or a few countries?

**Key concepts.**

- [Search engines, object storage, warehouses and vectors](../../../classes/databases/specialized/index.md)
- [Partitioning and hot keys](../../../classes/databases/partitioning/index.md)
- [Replication and replication lag](../../../classes/databases/replication/index.md)
- [Caching patterns and hit-ratio math](../../../classes/caching/patterns/index.md)
- Catalog: [Search](../../../reference/components/compute/index.md#search) · [SQL Database](../../../reference/components/storage/index.md#sql) · [Cache](../../../reference/components/storage/index.md#cache) · [App Server](../../../reference/components/compute/index.md#app)

**Watch for.** `WHERE lat BETWEEN … AND lng BETWEEN …` with two separate indexes scans huge stripes; use a geospatial index (geohash, quadtree, S2/H3 cells). The data is read-mostly: replicas and caches, not sharding, come first.

**Practice.** Case study: no case study yet — compare with [Ride sharing](../../../classes/case-studies/ride-sharing/index.md) · Playground scenario: [`ride-sharing`](../../../../playground/scenarios/index.md#ride-sharing) (geo index and location updates)

??? tip "Hints"

    - 200 M places × ~1 KB ≈ 200 GB: fits on a few machines; replicate for read throughput.
    - Geohash prefix (or H3 cell) index: query the cell and its neighbors, then filter by exact distance.
    - Cache results per (cell, filters) for popular areas around venues.
    - Place edits flow to the search index asynchronously; minutes of delay are fine.

### Async & workflows

#### 24. Distributed job scheduler { #job-scheduler }

Design a scheduler that runs BoxOffice's jobs: "release unpaid seat holds every minute", "send reminders 24 h before each show", nightly reports and reconciliation. 1 million scheduled jobs per day, some recurring (cron) and some one-off at a given time; each job must run once, on time (within seconds), even if scheduler machines fail.

**Clarify first.**

- What happens if a job runs twice? Can jobs be made idempotent?
- Maximum job duration? Retries on failure?
- Do jobs have priorities or dependencies?

**Key concepts.**

- [Workers, schedulers and leader election](../../../classes/compute/async-work/index.md)
- [Consensus and quorums](../../../classes/distributed/consensus/index.md)
- [Delivery semantics and idempotent consumers](../../../classes/messaging/semantics/index.md)
- [Queues vs pub/sub vs event logs](../../../classes/messaging/queues-pubsub/index.md)
- Catalog: [Scheduler](../../../reference/components/compute/index.md#scheduler) · [Message Queue](../../../reference/components/messaging/index.md#queue) · [Worker](../../../reference/components/compute/index.md#worker) · [SQL Database](../../../reference/components/storage/index.md#sql)

**Watch for.** Running cron on every replica fires each job N times; one scheduler machine is a single point of failure. You need leader election or row-level claiming, plus idempotent jobs because "exactly once" will sometimes become "at least once".

**Practice.** Case study: no case study yet — compare with [Notification system](../../../classes/case-studies/notification-system/index.md) · Playground scenario: [`notification-system`](../../../../playground/scenarios/index.md#notification-system) (scheduler, queue and providers)

??? tip "Hints"

    - Jobs table indexed by `next_run_at`; pollers claim due jobs with `SELECT … FOR UPDATE SKIP LOCKED` or a lease.
    - Claimed jobs go to a queue; workers execute and record the result; leases expire if a worker dies.
    - Recurring jobs compute their next run after each execution.
    - Shard the jobs table by time bucket or id when one database is not enough.

#### 25. Web crawler { #web-crawler }

Design a crawler that fetches 1 billion web pages per month to build a search index, revisiting popular pages more often. It must be polite (respect robots.txt and never hammer one site), avoid duplicate pages and avoid traps (infinite calendars, session ids in URLs).

**Clarify first.**

- HTML only, or also images and PDFs?
- How fresh must popular pages be?
- Do we need to render JavaScript?

**Key concepts.**

- [Queues vs pub/sub vs event logs](../../../classes/messaging/queues-pubsub/index.md)
- [Workers, schedulers and leader election](../../../classes/compute/async-work/index.md)
- [Back-of-the-envelope numbers](../../../classes/estimation/numbers/index.md)
- [Partitioning and hot keys](../../../classes/databases/partitioning/index.md)
- Catalog: [Message Queue](../../../reference/components/messaging/index.md#queue) · [Worker](../../../reference/components/compute/index.md#worker) · [Object Store](../../../reference/components/storage/index.md#objstore) · [NoSQL DB](../../../reference/components/storage/index.md#nosql) · [3rd Party API](../../../reference/components/external/index.md#thirdparty)

**Watch for.** A single FIFO frontier lets a big site monopolize the crawlers and breaks politeness; partition the frontier by host. And without URL normalization and a seen-set, the crawler loops forever.

**Practice.** Case study: no case study yet — compare with [Notification system](../../../classes/case-studies/notification-system/index.md) · Playground scenario: [`async-queue`](../../../../playground/scenarios/index.md#async-queue) (queue and workers absorbing a spike)

??? tip "Hints"

    - 10⁹ pages/month ≈ 400 pages/s; at ~100 KB each ≈ 100 TB/month of raw content in object storage.
    - URL frontier: priority queues by importance, then per-host queues with a delay between requests.
    - Seen URLs in a Bloom filter or key-value store; content hash (e.g. SimHash) for near-duplicates.
    - DNS cache, robots.txt cache per host, depth/URL-length limits against traps.

#### 26. BoxOffice refunds after a cancellation { #refunds }

A stadium show with 60,000 sold tickets is cancelled. BoxOffice must refund every order (card or Pix) through the payment provider, release the tickets, notify fans and report progress to the promoter. The provider accepts at most 100 refund requests per second. Design the refund process.

**Clarify first.**

- Full refunds only, or fees kept? Partial refunds for multi-ticket orders?
- Deadline for all refunds?
- How do we handle orders whose payment method can no longer be refunded?

**Key concepts.**

- [Webhooks, idempotency keys and reconciliation](../../../classes/compute/integrations/index.md)
- [Outbox, sagas, CQRS and event sourcing](../../../classes/messaging/patterns/index.md)
- [Delivery semantics and idempotent consumers](../../../classes/messaging/semantics/index.md)
- [Timeouts, retries, circuit breakers and load shedding](../../../classes/reliability/patterns/index.md)
- Catalog: [Message Queue](../../../reference/components/messaging/index.md#queue) · [Worker](../../../reference/components/compute/index.md#worker) · [Payment](../../../reference/components/external/index.md#payment) · [SQL Database](../../../reference/components/storage/index.md#sql) · [Notifications](../../../reference/components/compute/index.md#notifications)

**Watch for.** A loop that calls the provider for 60,000 orders inside one transaction or request will time out halfway and, if restarted, refund some orders twice. Each refund needs an idempotency key and its own tracked state.

**Practice.** Case study: [Payment system](../../../classes/case-studies/payment-system/index.md) · Playground scenario: [`payment-system`](../../../../playground/scenarios/index.md#payment-system) (idempotency and an external provider)

??? tip "Hints"

    - One refund job per order in a table (state: pending → requested → confirmed/failed), enqueued.
    - Workers rate-limited to ~90/s (below the quota): 60,000 refunds ≈ 11 minutes.
    - Idempotency key = refund id; confirmation via provider webhook; retries with backoff; DLQ for manual handling.
    - Progress = counts by state; notifications sent on confirmation, not on request.

### Infrastructure & platform

#### 27. API gateway { #api-gateway }

Design the API gateway in front of BoxOffice's 40 microservices: routing by path and version, authentication (JWT), rate limiting, request logging and canary releases. 200,000 requests per second at peak; the gateway may add at most 5 ms at p99.

**Clarify first.**

- Which concerns belong to the gateway and which to the services?
- Is configuration changed often, by many teams?
- One gateway for all clients, or one per client type (BFF)?

**Key concepts.**

- [API gateway and rate-limiting algorithms](../../../classes/edge/api-gateway/index.md)
- [OAuth 2 / OIDC and JWT](../../../classes/edge/identity/index.md)
- [Load balancing and consistent hashing](../../../classes/edge/load-balancing/index.md)
- [Canary releases and feature flags](../../../classes/cloud-native/delivery/index.md)
- Catalog: [API Gateway](../../../reference/components/edge/index.md#apigw) · [Load Balancer](../../../reference/components/edge/index.md#lb) · [Auth Service](../../../reference/components/compute/index.md#auth) · [Cache](../../../reference/components/storage/index.md#cache) · [Logs](../../../reference/components/observability/index.md#logs)

**Watch for.** Calling the auth service on every request to validate tokens doubles the traffic and adds latency; verify JWT signatures locally with cached keys. And business logic in the gateway turns it into a shared monolith.

**Practice.** Case study: [Rate limiter](../../../classes/case-studies/rate-limiter/index.md) · Playground scenario: [`rate-limiter`](../../../../playground/scenarios/index.md#rate-limiter) (gateway rate limiting)

??? tip "Hints"

    - Stateless gateway replicas behind an L4 load balancer; scale horizontally on CPU.
    - Routing table and policies loaded in memory, updated by pushing config (no restart).
    - JWT validation with cached signing keys (JWKS); rate limits in Redis.
    - Weighted routes for canaries; access logs and traces emitted asynchronously.

#### 28. Content delivery network { #cdn }

Design a CDN for BoxOffice's images, scripts and event pages: 100 points of presence worldwide, 10 Tbps of peak egress, a 95% hit ratio target, and purges of a changed event page that take effect worldwide within 10 seconds.

**Clarify first.**

- Which content is cacheable and for how long?
- Do we need edge compute (personalization, A/B tests)?
- How do users reach the nearest point of presence?

**Key concepts.**

- [DNS and CDN](../../../classes/edge/dns-cdn/index.md)
- [Caching patterns and hit-ratio math](../../../classes/caching/patterns/index.md)
- [Hot keys and cache stampedes](../../../classes/caching/failure-modes/index.md)
- [Cache invalidation and TTL](../../../classes/caching/invalidation/index.md)
- Catalog: [DNS](../../../reference/components/edge/index.md#dns) · [CDN](../../../reference/components/edge/index.md#cdn) · [Object Store](../../../reference/components/storage/index.md#objstore) · [Load Balancer](../../../reference/components/edge/index.md#lb)

**Watch for.** If every edge misses to the origin at the same time (after a purge or for a new viral object), the origin melts; use a mid-tier (origin shield) and request coalescing.

**Practice.** Case study: no case study yet — compare with [Video streaming](../../../classes/case-studies/video-streaming/index.md) · Playground scenario: [`cdn-static`](../../../../playground/scenarios/index.md#cdn-static) (CDN offloading static and media traffic)

??? tip "Hints"

    - Routing: anycast IPs or GeoDNS to the nearest healthy point of presence.
    - Two-tier cache: edges → regional shield → origin; consistent hashing of objects within a site.
    - Cache key design (path + normalized query), `Cache-Control` and versioned assets.
    - Purge: a pub/sub fan-out to all edges, plus short TTLs for dynamic pages.

---

## Hard { #hard }

Contention, money, real time or media at scale: the naive design fails, and the deep dive is where the interview is decided.

### Money & consistency

#### 29. BoxOffice flash sale (ticketing) { #flash-sale-ticketing }

The course's running example. A stadium show goes on sale Saturday at 10:00: 2 million fans for 60,000 seats. Fans pick seats, hold them for 10 minutes while paying through an external provider, and receive the ticket by email. No seat may ever be sold twice, the site must stay up, the process should feel fair, and bots must not take the tickets.

**Clarify first.**

- Seat selection or "best available"? Ticket limit per fan?
- Is a virtual waiting room acceptable to the business?
- How long is the hold, and what happens when payment fails?

**Key concepts.**

- [Transactions, isolation and locking](../../../classes/databases/transactions/index.md)
- [Queues vs pub/sub vs event logs](../../../classes/messaging/queues-pubsub/index.md)
- [DNS and CDN](../../../classes/edge/dns-cdn/index.md)
- [Webhooks, idempotency keys and reconciliation](../../../classes/compute/integrations/index.md)
- [Timeouts, retries, circuit breakers and load shedding](../../../classes/reliability/patterns/index.md)
- Catalog: [CDN](../../../reference/components/edge/index.md#cdn) · [WAF](../../../reference/components/edge/index.md#waf) · [API Gateway](../../../reference/components/edge/index.md#apigw) · [Message Queue](../../../reference/components/messaging/index.md#queue) · [SQL Database](../../../reference/components/storage/index.md#sql) · [Payment](../../../reference/components/external/index.md#payment)

**Watch for.** Treating it as a scale problem only ("add servers") misses the point: the hard parts are contention on 60,000 rows, a correct hold, and an external payment provider that becomes the bottleneck at 10:00.

**Practice.** Case study: [Ticketing (BoxOffice flash sale)](../../../classes/case-studies/ticketing/index.md) · Playground scenario: [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale) (limited-stock flash sale)

??? tip "Hints"

    - Edge absorbs reads (CDN for pages, cached seat map); WAF and per-user rate limits for bots.
    - Waiting room: admit fans at the rate inventory and payment can sustain, with signed admission tokens.
    - Hold = one atomic conditional update with `hold_until`; an expiry job releases unpaid holds.
    - Payment with idempotency key, timeout and circuit breaker; confirmation by webhook; outbox → Kafka → email.

#### 30. Payment system { #payment-system }

Design BoxOffice's payment service: it charges fans through two external payment providers (cards and Pix), handles refunds, records every movement in a ledger and reconciles daily with the providers. 1,000 payments per second at peak; never charge twice, never lose a confirmed payment.

**Clarify first.**

- Do we store card data (PCI scope) or only provider tokens?
- Synchronous confirmation required, or can an order be "payment pending"?
- Multiple currencies?

**Key concepts.**

- [Webhooks, idempotency keys and reconciliation](../../../classes/compute/integrations/index.md)
- [Transactions, isolation and locking](../../../classes/databases/transactions/index.md)
- [Outbox, sagas, CQRS and event sourcing](../../../classes/messaging/patterns/index.md)
- [Timeouts, retries, circuit breakers and load shedding](../../../classes/reliability/patterns/index.md)
- Catalog: [Payment](../../../reference/components/external/index.md#payment) · [SQL Database](../../../reference/components/storage/index.md#sql) · [Message Queue](../../../reference/components/messaging/index.md#queue) · [Worker](../../../reference/components/compute/index.md#worker) · [NAT Gateway](../../../reference/components/network/index.md#nat)

**Watch for.** A timeout from the provider is not a failure: the charge may have succeeded. Retrying without an idempotency key, or trusting the browser's redirect instead of a signed webhook, creates double charges and phantom payments.

**Practice.** Case study: [Payment system](../../../classes/case-studies/payment-system/index.md) · Playground scenario: [`payment-system`](../../../../playground/scenarios/index.md#payment-system) (idempotency and an external provider)

??? tip "Hints"

    - Payment state machine (created → pending → succeeded/failed → refunded) in a relational database.
    - Idempotency key per attempt, stored with the result; provider adapter with timeout, retries and circuit breaker.
    - Double-entry ledger: append-only rows, every movement balanced.
    - Webhooks stored first, processed idempotently; daily reconciliation against provider reports.

#### 31. BoxOffice virtual waiting room { #waiting-room }

Design only the waiting room for BoxOffice's biggest on-sales: up to 3 million fans arrive between 09:55 and 10:05; the purchase flow can admit 2,000 fans per minute. Fans see their position and estimated wait, keep their place if they reload, and cannot skip the line by opening many tabs or using bots.

**Clarify first.**

- Fans who arrive before 10:00: random order or first come, first served?
- What if the event sells out while people are waiting?
- Must the waiting room work even if the rest of the platform is degraded?

**Key concepts.**

- [Queues vs pub/sub vs event logs](../../../classes/messaging/queues-pubsub/index.md)
- [API gateway and rate-limiting algorithms](../../../classes/edge/api-gateway/index.md)
- [Little's Law and queueing](../../../classes/estimation/queueing/index.md)
- [OAuth 2 / OIDC and JWT](../../../classes/edge/identity/index.md)
- Catalog: [CDN](../../../reference/components/edge/index.md#cdn) · [WAF](../../../reference/components/edge/index.md#waf) · [API Gateway](../../../reference/components/edge/index.md#apigw) · [Cache](../../../reference/components/storage/index.md#cache) · [Message Queue](../../../reference/components/messaging/index.md#queue)

**Watch for.** If the waiting room itself depends on the backend it protects, it falls over with it. Keep it at the edge (CDN, gateway, a small fast store) and make admission tokens verifiable without a database call.

**Practice.** Case study: [Ticketing (BoxOffice flash sale)](../../../classes/case-studies/ticketing/index.md) · Playground scenario: [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale) (limited-stock flash sale)

??? tip "Hints"

    - Little's Law: 3 M fans ÷ 2,000/min ≈ 25 hours of queue — tell the business; sell-out comes much earlier.
    - At arrival: a signed token with a queue number (random for early arrivals); position = number − admitted counter.
    - A static page from the CDN polls a tiny endpoint every 20–30 s for the admitted counter.
    - Admission = signed, short-lived token checked by the gateway; one per account, with bot checks.

#### 32. Hotel booking { #hotel-booking }

Design a hotel reservation system (like Booking.com) for 1 million hotels: users search availability for date ranges, reserve rooms and pay. 5,000 searches per second, 200 reservations per second at peak. Hotels allow up to 10% overbooking for some room types; double booking beyond that must never happen.

**Clarify first.**

- Do we reserve a specific room or a room type?
- Pay at booking or at the hotel? Cancellation policy?
- Do prices change per day and per demand?

**Key concepts.**

- [Transactions, isolation and locking](../../../classes/databases/transactions/index.md)
- [Data models, SQL vs NoSQL and indexes](../../../classes/databases/models/index.md)
- [Caching patterns and hit-ratio math](../../../classes/caching/patterns/index.md)
- [Partitioning and hot keys](../../../classes/databases/partitioning/index.md)
- Catalog: [Search](../../../reference/components/compute/index.md#search) · [Cache](../../../reference/components/storage/index.md#cache) · [SQL Database](../../../reference/components/storage/index.md#sql) · [Payment](../../../reference/components/external/index.md#payment)

**Watch for.** Availability must be modeled per (hotel, room type, date): a 3-night reservation updates 3 rows in one transaction. Searches can be served from a stale cache; the reservation itself cannot.

**Practice.** Case study: no case study yet — compare with [Ticketing (BoxOffice flash sale)](../../../classes/case-studies/ticketing/index.md) · Playground scenario: [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale) (limited-stock flash sale)

??? tip "Hints"

    - Table `inventory(hotel, room_type, date, total, reserved)`; reserve with `UPDATE … SET reserved = reserved + 1 WHERE reserved < total * 1.1` per date, in one transaction.
    - Idempotency key on the reservation request (users double-click).
    - Search: a denormalized availability index, refreshed asynchronously, cached per city/date.
    - Shard by hotel id; one hotel's inventory lives in one shard, so transactions stay local.

#### 33. E-commerce checkout { #checkout }

Design the checkout of an online store during Black Friday: 5,000 orders per second at peak, each reserving stock in an inventory service, charging through a payment provider, creating the order and triggering shipping. If payment fails, stock must be released; if stock runs out, nobody should be charged.

**Clarify first.**

- Do inventory, payment and orders belong to different services and databases?
- Reserve stock at add-to-cart or at checkout?
- Is overselling by a tiny margin acceptable for some items?

**Key concepts.**

- [Outbox, sagas, CQRS and event sourcing](../../../classes/messaging/patterns/index.md)
- [Transactions, isolation and locking](../../../classes/databases/transactions/index.md)
- [Delivery semantics and idempotent consumers](../../../classes/messaging/semantics/index.md)
- [Webhooks, idempotency keys and reconciliation](../../../classes/compute/integrations/index.md)
- Catalog: [App Server](../../../reference/components/compute/index.md#app) · [SQL Database](../../../reference/components/storage/index.md#sql) · [Kafka](../../../reference/components/messaging/index.md#kafka) · [Payment](../../../reference/components/external/index.md#payment) · [Message Queue](../../../reference/components/messaging/index.md#queue)

**Watch for.** A distributed transaction (two-phase commit) across services and an external provider is not available or not viable; you need a saga with compensations, and each step must be idempotent because messages are delivered at least once.

**Practice.** Case study: [Payment system](../../../classes/case-studies/payment-system/index.md) · Playground scenario: [`payment-system`](../../../../playground/scenarios/index.md#payment-system) (idempotency and an external provider)

??? tip "Hints"

    - Orchestrated saga: reserve stock → charge → confirm order → ship; compensations: release stock, refund.
    - Each service writes its state change and its event atomically (transactional outbox).
    - Stock reservation with expiry, so abandoned checkouts free the items automatically.
    - Hot items: per-item counters with conditional decrements; queue requests for the hottest SKUs.

#### 34. Digital wallet { #digital-wallet }

BoxOffice launches a wallet: fans hold a balance (credits from refunds, gift cards), pay for tickets with it and transfer credits to friends. 10 million wallets, 5,000 transactions per second at peak. Balances must never go negative or drift, and every movement must be auditable for years.

**Clarify first.**

- Transfers between users in different shards or regions?
- Is the wallet regulated (e-money rules, KYC)?
- Read-your-writes for the balance shown after a payment?

**Key concepts.**

- [Transactions, isolation and locking](../../../classes/databases/transactions/index.md)
- [Outbox, sagas, CQRS and event sourcing](../../../classes/messaging/patterns/index.md)
- [Consistency models](../../../classes/distributed/consistency/index.md)
- [Partitioning and hot keys](../../../classes/databases/partitioning/index.md)
- Catalog: [SQL Database](../../../reference/components/storage/index.md#sql) · [Kafka](../../../reference/components/messaging/index.md#kafka) · [Worker](../../../reference/components/compute/index.md#worker) · [App Server](../../../reference/components/compute/index.md#app)

**Watch for.** Storing only a mutable `balance` column loses the history and makes bugs unrecoverable; an append-only ledger with the balance as a derived (and checked) value is the standard. A transfer between two shards cannot be one local transaction.

**Practice.** Case study: [Payment system](../../../classes/case-studies/payment-system/index.md) · Playground scenario: [`payment-system`](../../../../playground/scenarios/index.md#payment-system) (idempotency and an external provider)

??? tip "Hints"

    - Double-entry ledger entries (debit + credit) written in one transaction when both wallets share a shard.
    - Cross-shard transfers: a saga via a transfer record (pending → debited → credited) with idempotent steps.
    - Balance check with `SELECT … FOR UPDATE` or a conditional update; optimistic locking on a version.
    - Event sourcing view: the balance is a fold of the entries; periodic reconciliation jobs verify it.

### Real-time & geo

#### 35. Ride sharing (Uber / 99) { #ride-sharing }

Design a ride-hailing service: riders request a ride and are matched with a nearby driver within seconds; both see each other's location live. 1 million active drivers sending their location every 4 seconds, 100,000 ride requests per minute at peak, in hundreds of cities.

**Clarify first.**

- Matching goal: nearest driver, fastest ETA, or global optimization?
- Is surge pricing in scope? Payments?
- How long are location histories kept?

**Key concepts.**

- [Search engines, object storage, warehouses and vectors](../../../classes/databases/specialized/index.md)
- [Partitioning and hot keys](../../../classes/databases/partitioning/index.md)
- [Transactions, isolation and locking](../../../classes/databases/transactions/index.md)
- [WebSockets, SSE and gRPC](../../../classes/edge/protocols/index.md)
- Catalog: [Mobile](../../../reference/components/client/index.md#mobile) · [Load Balancer](../../../reference/components/edge/index.md#lb) · [Cache](../../../reference/components/storage/index.md#cache) · [Kafka](../../../reference/components/messaging/index.md#kafka) · [SQL Database](../../../reference/components/storage/index.md#sql)

**Watch for.** Writing 250,000 location updates per second into a relational database with a geo index is the bottleneck; keep current locations in memory (geo index per city/cell) and stream the history. And one driver must never be assigned to two riders.

**Practice.** Case study: [Ride sharing](../../../classes/case-studies/ride-sharing/index.md) · Playground scenario: [`ride-sharing`](../../../../playground/scenarios/index.md#ride-sharing) (geo index and location updates)

??? tip "Hints"

    - 1 M drivers ÷ 4 s = 250,000 updates/s: in-memory geo index (geohash/H3 cells), partitioned by city.
    - Matching: query cells around the rider, rank by ETA, offer to one driver at a time with a timeout.
    - Assignment with a conditional update or lock on the driver's state (available → assigned).
    - Live location over WebSockets; history to Kafka → storage for trips, billing and analytics.

#### 36. Food delivery { #food-delivery }

Design a food delivery platform (like iFood): customers browse nearby restaurants, order, and track the courier live. 300,000 restaurants, 2 million orders per day with a strong peak at lunch and dinner (5× the average), restaurants accepting orders on tablets, and couriers assigned to orders as they become ready.

**Clarify first.**

- Is the menu and price data managed by restaurants in real time?
- Do we batch several orders per courier?
- What must work if the restaurant's tablet is offline?

**Key concepts.**

- [Outbox, sagas, CQRS and event sourcing](../../../classes/messaging/patterns/index.md)
- [Search engines, object storage, warehouses and vectors](../../../classes/databases/specialized/index.md)
- [WebSockets, SSE and gRPC](../../../classes/edge/protocols/index.md)
- [Serverless and autoscaling](../../../classes/compute/serverless-autoscaling/index.md)
- Catalog: [Mobile](../../../reference/components/client/index.md#mobile) · [Search](../../../reference/components/compute/index.md#search) · [Kafka](../../../reference/components/messaging/index.md#kafka) · [SQL Database](../../../reference/components/storage/index.md#sql) · [Notifications](../../../reference/components/compute/index.md#notifications)

**Watch for.** An order is a long-running workflow with several actors (customer, restaurant, courier, payment); modeling it as one synchronous request chain fails at the first slow participant. Use a state machine driven by events.

**Practice.** Case study: no case study yet — compare with [Ride sharing](../../../classes/case-studies/ride-sharing/index.md) · Playground scenario: [`ride-sharing`](../../../../playground/scenarios/index.md#ride-sharing) (geo index and location updates)

??? tip "Hints"

    - 2 M/day ≈ 23 orders/s average, ~120/s at peak: the order rate is modest; location updates and browsing dominate.
    - Order state machine (placed → accepted → ready → picked up → delivered) persisted, with events to all parties.
    - Restaurant search by geo cell, cached per area and meal time.
    - Courier dispatch reuses the ride-sharing geo index; push notifications to restaurants and couriers.

#### 37. Multiplayer game backend { #multiplayer-game }

Design the backend of an online multiplayer game: matchmaking puts 10 players of similar skill into a match within 30 seconds; matches last 20 minutes with game state updated 30 times per second; 2 million concurrent players at peak across 4 regions.

**Clarify first.**

- Authoritative server or peer-to-peer?
- Latency target per player (e.g. under 80 ms round trip)?
- What is persisted: match results, inventory, rankings?

**Key concepts.**

- [WebSockets, SSE and gRPC](../../../classes/edge/protocols/index.md)
- [Stateless services and service boundaries](../../../classes/compute/services/index.md)
- [Kubernetes and autoscaling](../../../classes/cloud-native/kubernetes/index.md)
- [Multi-region and disaster recovery](../../../classes/reliability/disaster-recovery/index.md)
- Catalog: [Load Balancer](../../../reference/components/edge/index.md#lb) · [App Server](../../../reference/components/compute/index.md#app) · [Cache](../../../reference/components/storage/index.md#cache) · [SQL Database](../../../reference/components/storage/index.md#sql) · [Message Queue](../../../reference/components/messaging/index.md#queue)

**Watch for.** Game state at 30 updates/s does not go through a database or a stateless web tier; it lives in memory on one dedicated game server per match, close to the players. Only results are persisted.

**Practice.** Case study: no case study yet — compare with [Chat](../../../classes/case-studies/chat/index.md) · Playground scenario: [`chat`](../../../../playground/scenarios/index.md#chat) (websockets and pub/sub)

??? tip "Hints"

    - 2 M players ÷ 10 = 200,000 matches; ~50 matches per game server ≈ 4,000 servers, autoscaled per region.
    - Matchmaking: a queue per region and skill bucket; widen the skill range as the wait grows.
    - Allocator assigns a game server (e.g. Agones on Kubernetes) and returns its address to the players.
    - UDP for state; results, rankings and inventory written through a normal service to the database.

### Search & media

#### 38. Video streaming (YouTube / Netflix) { #video-streaming }

Design a video platform: creators upload videos (average 500 MB), viewers watch them on any device with adaptive quality. 500,000 uploads per day, 100 million views per day, and smooth playback start under 2 seconds worldwide.

**Clarify first.**

- Live streaming or on-demand only?
- How many resolutions and codecs?
- Do we need DRM or private videos?

**Key concepts.**

- [Search engines, object storage, warehouses and vectors](../../../classes/databases/specialized/index.md)
- [DNS and CDN](../../../classes/edge/dns-cdn/index.md)
- [Workers, schedulers and leader election](../../../classes/compute/async-work/index.md)
- [Back-of-the-envelope numbers](../../../classes/estimation/numbers/index.md)
- Catalog: [Object Store](../../../reference/components/storage/index.md#objstore) · [CDN](../../../reference/components/edge/index.md#cdn) · [Message Queue](../../../reference/components/messaging/index.md#queue) · [Worker](../../../reference/components/compute/index.md#worker) · [NoSQL DB](../../../reference/components/storage/index.md#nosql)

**Watch for.** Bandwidth, not requests per second, dominates: serving video from your own servers is impossible at this scale; the CDN serves the segments. Transcoding is slow, parallelizable batch work, never in the upload request.

**Practice.** Case study: [Video streaming](../../../classes/case-studies/video-streaming/index.md) · Playground scenario: [`video-streaming`](../../../../playground/scenarios/index.md#video-streaming) (object store, CDN and transcoding)

??? tip "Hints"

    - Upload: resumable, pre-signed upload to the object store; an event triggers the pipeline.
    - Split into chunks, transcode in parallel into a bitrate ladder, package as HLS/DASH segments.
    - Egress estimate: 100 M views × ~300 MB watched ≈ 30 PB/day: the CDN serves almost all of it.
    - Metadata and view counts in separate stores; popular videos pre-warmed on the CDN.

#### 39. File sync (Dropbox / Google Drive) { #file-sync }

Design a file storage and sync service: users keep folders in sync across laptop, phone and web; files up to 10 GB; 50 million users with 10 GB each on average. Edits on one device should appear on the others within seconds, and offline edits must be merged or flagged as conflicts.

**Clarify first.**

- Sharing and permissions in scope?
- Version history: how many versions, for how long?
- Is deduplication across users acceptable (privacy)?

**Key concepts.**

- [Search engines, object storage, warehouses and vectors](../../../classes/databases/specialized/index.md)
- [Consistency models](../../../classes/distributed/consistency/index.md)
- [Time and clocks](../../../classes/distributed/time-clocks/index.md)
- [Queues vs pub/sub vs event logs](../../../classes/messaging/queues-pubsub/index.md)
- Catalog: [Object Store](../../../reference/components/storage/index.md#objstore) · [SQL Database](../../../reference/components/storage/index.md#sql) · [Pub/Sub](../../../reference/components/messaging/index.md#pubsub) · [CDN](../../../reference/components/edge/index.md#cdn) · [App Server](../../../reference/components/compute/index.md#app)

**Watch for.** Re-uploading a whole 2 GB file for a one-line change wastes bandwidth; split files into content-addressed blocks and upload only changed blocks. Metadata (the file tree) needs strong consistency; blocks are immutable.

**Practice.** Case study: no case study yet — compare with [Video streaming](../../../classes/case-studies/video-streaming/index.md) · Playground scenario: [`cdn-static`](../../../../playground/scenarios/index.md#cdn-static) (CDN offloading static and media traffic)

??? tip "Hints"

    - Storage: 50 M × 10 GB = 500 PB before deduplication: object storage with tiering.
    - Files = list of block hashes (e.g. 4 MB blocks); upload only blocks the server does not have.
    - Metadata service (relational, per-user journal with a cursor) is the source of truth.
    - Clients long-poll or subscribe for changes, then pull the journal from their cursor; conflicts become "conflicted copy" files.

#### 40. Post search (Twitter-like) { #tweet-search }

Design full-text search over a social network's posts: 500 million new posts per day must be searchable within 10 seconds of posting; 20,000 search queries per second; results ranked by relevance and recency. The archive holds 5 years of posts.

**Clarify first.**

- Is recency more important than relevance (real-time search)?
- Filters: user, language, date range, media?
- Do deleted posts have to disappear from results immediately?

**Key concepts.**

- [Search engines, object storage, warehouses and vectors](../../../classes/databases/specialized/index.md)
- [Partitioning and hot keys](../../../classes/databases/partitioning/index.md)
- [Kafka partitions, consumer groups and retention](../../../classes/messaging/kafka/index.md)
- [Percentiles and tail latency](../../../classes/estimation/percentiles/index.md)
- Catalog: [Search](../../../reference/components/compute/index.md#search) · [Kafka](../../../reference/components/messaging/index.md#kafka) · [Worker](../../../reference/components/compute/index.md#worker) · [Cache](../../../reference/components/storage/index.md#cache) · [Object Store](../../../reference/components/storage/index.md#objstore)

**Watch for.** Querying every shard of a huge index for every search makes the tail latency of the slowest shard the latency of every query; partition by time (recent index small and hot, archive cold) and use replicas to hedge.

**Practice.** Case study: [Search autocomplete](../../../classes/case-studies/search-autocomplete/index.md) · Playground scenario: [`search-autocomplete`](../../../../playground/scenarios/index.md#search-autocomplete) (search service and cache)

??? tip "Hints"

    - Ingest: posts → Kafka → indexers building an inverted index; ≈ 6,000 posts/s to index.
    - Time-partitioned indexes: a real-time in-memory index for the last days, larger on-disk indexes for older periods.
    - Scatter-gather across shards with per-shard top-K and a merge; fan-out tail amplification is the latency risk.
    - Deletes as tombstones filtered at query time; cache popular queries for a few seconds.

### AI systems

#### 41. BoxOffice AI support assistant { #ai-assistant }

Design BoxOffice's AI assistant: fans ask questions in natural language ("can I get a refund for Saturday?", "move my tickets to Sunday"); it answers from policies and event data and can act on the fan's own orders. 5,000 conversations per minute at peak before big shows; answers should start streaming within 2 seconds, cost under a few cents per conversation, and the assistant must never act on someone else's order.

**Clarify first.**

- Which actions are allowed (read only, refunds, exchanges)? With confirmation?
- Hand-off to a human agent?
- Which languages, and which data may be sent to a model provider?

**Key concepts.**

- [LLM gateway: routing, fallbacks, caching](../../../classes/ai-systems/llm-gateway/index.md)
- [Agents and tool use](../../../classes/ai-systems/agents/index.md)
- [RAG and memory](../../../classes/ai-systems/rag-memory/index.md)
- [Guardrails and evaluations](../../../classes/ai-systems/safety-evals/index.md)
- Catalog: [LLM Gateway](../../../reference/components/ai/index.md#llmgw) · [Orchestrator](../../../reference/components/ai/index.md#orchestrator) · [Tool Registry](../../../reference/components/ai/index.md#toolreg) · [Memory Fabric](../../../reference/components/ai/index.md#memory) · [Safety Mesh](../../../reference/components/ai/index.md#safety) · [Vector DB](../../../reference/components/storage/index.md#vectordb)

**Watch for.** Letting the model decide what the user is allowed to do is the classic mistake: authorization lives in the tools, with the user's identity. And each agent step is a full model call: latency and cost multiply with the number of steps.

**Practice.** Case study: [AI assistant](../../../classes/case-studies/ai-assistant/index.md) · Playground scenario: [`ai-assistant`](../../../../playground/scenarios/index.md#ai-assistant) (LLM gateway, agent, tools, RAG, safety)

??? tip "Hints"

    - Router: FAQ-like questions answered by RAG (one model call); only action requests go to the agent loop.
    - RAG over policies and event pages in a vector store, filtered by event and language, with citations.
    - Tools (`get_my_orders`, `request_refund`) behind MCP servers that enforce the fan's identity and limits; confirmation before side effects.
    - LLM gateway for routing, fallbacks, semantic cache and per-conversation cost; guardrails in and out; traces per step.

#### 42. Documentation chatbot with RAG { #rag-chatbot }

Design a chatbot that answers employees' questions from a company's internal documentation: 2 million documents (wikis, PDFs, tickets) that change daily, 10,000 employees, 50 questions per second at peak. Answers must cite sources, and an employee must never see content from documents they are not allowed to read.

**Clarify first.**

- How fresh must the index be after a document changes?
- Where do permissions come from, and how often do they change?
- Is a hosted model acceptable for this data, or must it be self-hosted?

**Key concepts.**

- [RAG and memory](../../../classes/ai-systems/rag-memory/index.md)
- [LLM gateway: routing, fallbacks, caching](../../../classes/ai-systems/llm-gateway/index.md)
- [Guardrails and evaluations](../../../classes/ai-systems/safety-evals/index.md)
- [Search engines, object storage, warehouses and vectors](../../../classes/databases/specialized/index.md)
- Catalog: [Memory Fabric](../../../reference/components/ai/index.md#memory) · [Vector DB](../../../reference/components/storage/index.md#vectordb) · [LLM Gateway](../../../reference/components/ai/index.md#llmgw) · [Safety Mesh](../../../reference/components/ai/index.md#safety) · [Worker](../../../reference/components/compute/index.md#worker)

**Watch for.** Indexing all chunks in one shared collection and filtering permissions after retrieval leaks data (and returns empty answers); apply the permission filter inside the vector query. Retrieval quality must be evaluated on its own.

**Practice.** Case study: [AI assistant](../../../classes/case-studies/ai-assistant/index.md) · Playground scenario: [`ai-assistant`](../../../../playground/scenarios/index.md#ai-assistant) (LLM gateway, agent, tools, RAG, safety)

??? tip "Hints"

    - Ingestion pipeline: change events → parse → chunk → embed → upsert with ACL metadata; re-embed on change.
    - Hybrid retrieval (keyword + vector), permission filter, rerank, top 5 chunks into the prompt with citations.
    - Storage: e.g. 20 M chunks × 1,536 dims × 4 B ≈ 120 GB of vectors before index overhead.
    - Evaluation set of real questions; measure retrieval recall and answer faithfulness in CI.

#### 43. Semantic event search { #semantic-search }

BoxOffice wants search by meaning: "chill jazz night in São Paulo next weekend" should find relevant events even when no keyword matches. 50,000 active events, 2,000 queries per second at peak, results within 200 ms, combining meaning with hard filters (city, date, price, availability).

**Clarify first.**

- Which fields describe an event (title, description, artist, genre)?
- Do we parse dates and places from the query, or rely on filters?
- Personalized ranking?

**Key concepts.**

- [Search engines, object storage, warehouses and vectors](../../../classes/databases/specialized/index.md)
- [RAG and memory](../../../classes/ai-systems/rag-memory/index.md)
- [Caching patterns and hit-ratio math](../../../classes/caching/patterns/index.md)
- [LLM gateway: routing, fallbacks, caching](../../../classes/ai-systems/llm-gateway/index.md)
- Catalog: [Search](../../../reference/components/compute/index.md#search) · [Vector DB](../../../reference/components/storage/index.md#vectordb) · [Cache](../../../reference/components/storage/index.md#cache) · [LLM Gateway](../../../reference/components/ai/index.md#llmgw)

**Watch for.** Pure vector search ignores hard constraints (it happily returns a jazz night in another city) and is weak on exact names; combine it with keyword search and structured filters. Embedding every query with a large hosted model can blow the latency budget.

**Practice.** Case study: [Search autocomplete](../../../classes/case-studies/search-autocomplete/index.md) · Playground scenario: [`search-autocomplete`](../../../../playground/scenarios/index.md#search-autocomplete) (search service and cache)

??? tip "Hints"

    - 50,000 events × 768 dims × 4 B ≈ 150 MB: the whole index fits in memory on every search node.
    - Hybrid: BM25 + vector similarity with filters (city, date range) applied in the query; fuse the scores.
    - A small, fast embedding model for queries; cache embeddings of frequent queries.
    - Optional LLM step to extract structured filters from the query, with a strict schema and a fallback.

---

## Advanced { #advanced }

Distributed-systems internals and platforms: consensus, replication, ordering, multi-region, AI platforms. Senior-level depth; great practice after the course.

### Distributed foundations

#### 44. Distributed key-value store { #key-value-store }

Design a distributed key-value store (like Dynamo or Cassandra): `put(key, value)` and `get(key)`, 100 TB of data, 1 million operations per second, always writable even during network partitions, with tunable consistency per request. Nodes are added and fail routinely.

**Clarify first.**

- Value sizes? Read/write ratio?
- Which consistency must the default be: eventual or read-your-writes?
- Multi-datacenter replication?

**Key concepts.**

- [Partitioning and hot keys](../../../classes/databases/partitioning/index.md)
- [Consensus and quorums](../../../classes/distributed/consensus/index.md)
- [CAP and PACELC](../../../classes/distributed/cap-pacelc/index.md)
- [Time and clocks](../../../classes/distributed/time-clocks/index.md)
- [Data models, SQL vs NoSQL and indexes](../../../classes/databases/models/index.md)
- Catalog: [NoSQL DB](../../../reference/components/storage/index.md#nosql) · [Load Balancer](../../../reference/components/edge/index.md#lb)

**Watch for.** "Always writable" means concurrent writes to the same key on both sides of a partition: you must say how conflicts are detected and resolved (last-write-wins loses data; version vectors keep siblings).

**Practice.** Case study: no case study yet — compare with [Distributed cache](../../../classes/case-studies/distributed-cache/index.md) · Playground scenario: [`sharding`](../../../../playground/scenarios/index.md#sharding) (partitions and hot keys)

??? tip "Hints"

    - Consistent hashing with virtual nodes; N = 3 replicas on the next distinct nodes of the ring.
    - Tunable quorums: W and R per request; R + W > N for read-your-writes, W = 1 for availability.
    - Gossip for membership and failure detection; hinted handoff for temporary failures; Merkle-tree anti-entropy.
    - LSM-tree storage engine per node (write-heavy friendly).

#### 45. Distributed lock service { #distributed-lock }

Design a lock and leader-election service (like Chubby, ZooKeeper or etcd) for BoxOffice's internal jobs: clients acquire named locks with leases, a few thousand lock operations per second, and the service must stay correct (never two holders) even when nodes crash or the network partitions.

**Clarify first.**

- Is the lock for efficiency (avoid duplicate work) or for correctness (protect data)?
- Lease duration? What happens if a holder pauses (GC) past its lease?
- Strongly consistent reads of lock state needed?

**Key concepts.**

- [Consensus and quorums](../../../classes/distributed/consensus/index.md)
- [Time and clocks](../../../classes/distributed/time-clocks/index.md)
- [Workers, schedulers and leader election](../../../classes/compute/async-work/index.md)
- [CAP and PACELC](../../../classes/distributed/cap-pacelc/index.md)
- Catalog: [Scheduler](../../../reference/components/compute/index.md#scheduler) · [Worker](../../../reference/components/compute/index.md#worker) · [SQL Database](../../../reference/components/storage/index.md#sql)

**Watch for.** A lock with a timeout is not enough for correctness: a client paused by GC can wake up after its lease expired and still write. The protected resource must check a fencing token (a number that increases with each grant).

**Practice.** Case study: no case study yet — compare with [Distributed cache](../../../classes/case-studies/distributed-cache/index.md) · Playground scenario: [`db-replicas`](../../../../playground/scenarios/index.md#db-replicas) (primary and read replicas)

??? tip "Hints"

    - A 3- or 5-node replicated state machine using Raft; writes need a majority, so it is CP.
    - Locks as keys with leases renewed by heartbeats; clients watch keys to learn about releases.
    - Every grant returns a monotonically increasing fencing token; storage rejects older tokens.
    - Keep it small: coordination only, never a general data store; clients cache and back off.

#### 46. Collaborative document editing { #collaborative-editing }

Design real-time collaborative editing (like Google Docs): up to 100 people edit the same document at once, each keystroke appears to others within 200 ms, edits made offline merge when the user reconnects, and the full history is kept. 10 million documents, 1 million concurrently open.

**Clarify first.**

- Rich text or plain text? Comments and suggestions?
- Must all users converge to exactly the same document?
- How long is offline editing supported?

**Key concepts.**

- [Consistency models](../../../classes/distributed/consistency/index.md)
- [Time and clocks](../../../classes/distributed/time-clocks/index.md)
- [WebSockets, SSE and gRPC](../../../classes/edge/protocols/index.md)
- [Outbox, sagas, CQRS and event sourcing](../../../classes/messaging/patterns/index.md)
- Catalog: [Load Balancer](../../../reference/components/edge/index.md#lb) · [App Server](../../../reference/components/compute/index.md#app) · [Pub/Sub](../../../reference/components/messaging/index.md#pubsub) · [NoSQL DB](../../../reference/components/storage/index.md#nosql) · [Object Store](../../../reference/components/storage/index.md#objstore)

**Watch for.** Last-write-wins on the whole document loses everyone else's edits; locking paragraphs kills the real-time feel. Concurrent edits need operational transformation (OT) or CRDTs, which guarantee convergence.

**Practice.** Case study: no case study yet — compare with [Chat](../../../classes/case-studies/chat/index.md) · Playground scenario: [`chat`](../../../../playground/scenarios/index.md#chat) (websockets and pub/sub)

??? tip "Hints"

    - All editors of one document connect (WebSocket) to the same session server, chosen by consistent hashing on the document id.
    - OT with a central sequencer per document, or CRDTs (which also make offline merging natural).
    - Persist the operation log (event sourcing) plus periodic snapshots; history = replay.
    - Presence and cursors as ephemeral pub/sub messages, never persisted.

#### 47. Stock exchange matching engine { #matching-engine }

Design the core of an exchange: traders submit buy and sell orders for 5,000 symbols; the engine matches them by price-time priority and publishes trades and order-book updates. 1 million orders per second at peak, matching latency in microseconds, strict fairness (same input order ⇒ same result) and no lost order after acknowledgement.

**Clarify first.**

- Order types (limit, market, cancel)?
- Latency target for acknowledgement vs for market data?
- Recovery time objective if the primary engine fails?

**Key concepts.**

- [Outbox, sagas, CQRS and event sourcing](../../../classes/messaging/patterns/index.md)
- [Consensus and quorums](../../../classes/distributed/consensus/index.md)
- [Kafka partitions, consumer groups and retention](../../../classes/messaging/kafka/index.md)
- [Percentiles and tail latency](../../../classes/estimation/percentiles/index.md)
- Catalog: [App Server](../../../reference/components/compute/index.md#app) · [Event Stream](../../../reference/components/messaging/index.md#stream) · [Kafka](../../../reference/components/messaging/index.md#kafka) · [SQL Database](../../../reference/components/storage/index.md#sql)

**Watch for.** A database transaction per order cannot reach microseconds. The standard design is a single-threaded, in-memory engine per symbol fed by a sequenced, durable input log: determinism gives both fairness and recovery (replay the log).

**Practice.** Case study: no case study yet — compare with [Payment system](../../../classes/case-studies/payment-system/index.md) · Playground scenario: [`event-fanout`](../../../../playground/scenarios/index.md#event-fanout) (event stream with several consumers)

??? tip "Hints"

    - Gateway validates and risk-checks orders, then a sequencer assigns a global sequence number per symbol.
    - Input log replicated before acknowledgement; engines consume it and keep order books in memory.
    - Partition symbols across engines; a hot symbol gets its own engine.
    - Output events (trades, book updates) to a stream for market data, clearing and storage; hot standby replays the same log.

#### 48. Multi-region BoxOffice { #multi-region-boxoffice }

BoxOffice expands to Europe and North America and promises 99.99% availability for ticket purchases, surviving the loss of a whole cloud region. Fans should be served from a nearby region, but a seat must still never be sold twice across regions. Design the multi-region architecture.

**Clarify first.**

- Are events tied to a home region (the venue's country)?
- RPO and RTO targets for orders?
- Data residency rules (personal data must stay in a region)?

**Key concepts.**

- [Multi-region and disaster recovery](../../../classes/reliability/disaster-recovery/index.md)
- [CAP and PACELC](../../../classes/distributed/cap-pacelc/index.md)
- [Availability math](../../../classes/estimation/availability-math/index.md)
- [Replication and replication lag](../../../classes/databases/replication/index.md)
- [DNS and CDN](../../../classes/edge/dns-cdn/index.md)
- Catalog: [DNS](../../../reference/components/edge/index.md#dns) · [CDN](../../../reference/components/edge/index.md#cdn) · [SQL Database](../../../reference/components/storage/index.md#sql) · [Kafka](../../../reference/components/messaging/index.md#kafka) · [Health Check](../../../reference/components/observability/index.md#healthcheck)

**Watch for.** Active-active writes to the same seats in two regions require either cross-region consensus (adds ~100 ms per write) or a single owner per event. And 99.99% is ~53 minutes per year: failover must be automatic and rehearsed.

**Practice.** Case study: [Ticketing (BoxOffice flash sale)](../../../classes/case-studies/ticketing/index.md) · Playground scenario: [`multi-region`](../../../../playground/scenarios/index.md#multi-region) (DNS failover between regions)

??? tip "Hints"

    - Home region per event for inventory and orders (single writer); other regions route purchases to it.
    - Read paths (catalog, search, pages) active-active from every region with async replication.
    - Standby replica of each home region elsewhere; promote on region failure (RPO of seconds), DNS/anycast failover.
    - Or a globally consistent database (Spanner-like) and accept higher write latency; game days to prove RTO.

### AI systems

#### 49. Agent platform with tools { #agent-platform }

Design an internal platform where BoxOffice teams build AI agents (support, promoter onboarding, fraud review). Agents call tools exposed by 30 services, run tasks that take from seconds to hours, and must be observable, budgeted and safe. 200 agents, 1 million tool calls per day.

**Clarify first.**

- Who authors agents: engineers in code, or configuration by non-engineers?
- Which tools have side effects, and who approves their use?
- Do long tasks need human approval steps?

**Key concepts.**

- [Agents and tool use](../../../classes/ai-systems/agents/index.md)
- [LLM gateway: routing, fallbacks, caching](../../../classes/ai-systems/llm-gateway/index.md)
- [Guardrails and evaluations](../../../classes/ai-systems/safety-evals/index.md)
- [OAuth 2 / OIDC and JWT](../../../classes/edge/identity/index.md)
- [OpenTelemetry](../../../classes/observability/opentelemetry/index.md)
- Catalog: [Orchestrator](../../../reference/components/ai/index.md#orchestrator) · [Tool Registry](../../../reference/components/ai/index.md#toolreg) · [LLM Gateway](../../../reference/components/ai/index.md#llmgw) · [Safety Mesh](../../../reference/components/ai/index.md#safety) · [Memory Fabric](../../../reference/components/ai/index.md#memory) · [Tracing](../../../reference/components/observability/index.md#tracing)

**Watch for.** Agents running for hours inside a request handler lose their progress on any crash and repeat side effects; long tasks need durable execution (checkpointed state) and idempotent tool calls. Tools must act with the end user's or the agent's own scoped identity, never a shared admin key.

**Practice.** Case study: [AI assistant](../../../classes/case-studies/ai-assistant/index.md) · Playground scenario: [`ai-assistant`](../../../../playground/scenarios/index.md#ai-assistant) (LLM gateway, agent, tools, RAG, safety)

??? tip "Hints"

    - Tool registry (MCP servers per service) with schemas, owners, scopes and an approval workflow per tool.
    - Durable orchestrator (workflow engine) checkpointing each step; human-in-the-loop steps as waits.
    - All model calls through the LLM gateway with per-agent budgets; guardrails before and after the model and before side effects.
    - One trace per agent run (model calls, tool calls, tokens, cost); evaluation sets per agent in CI.

#### 50. Model-serving gateway { #llm-serving-gateway }

Design the gateway through which all of BoxOffice's services call language models: three hosted providers plus self-hosted open models on a GPU pool. 300 requests per second at peak, mixed short and long prompts; goals: p95 time to first token under 1 s, a monthly cost budget per team, and no outage when one provider fails.

**Clarify first.**

- Which data may leave the company (hosted providers vs self-hosted)?
- Are prompts and responses logged? Retention?
- Streaming required for all clients?

**Key concepts.**

- [LLM gateway: routing, fallbacks, caching](../../../classes/ai-systems/llm-gateway/index.md)
- [Little's Law and queueing](../../../classes/estimation/queueing/index.md)
- [Timeouts, retries, circuit breakers and load shedding](../../../classes/reliability/patterns/index.md)
- [Cost estimation (FinOps)](../../../classes/cloud-native/finops/index.md)
- [Capacity planning](../../../classes/performance/capacity-planning/index.md)
- Catalog: [LLM Gateway](../../../reference/components/ai/index.md#llmgw) · [API Gateway](../../../reference/components/edge/index.md#apigw) · [Cache](../../../reference/components/storage/index.md#cache) · [Metrics](../../../reference/components/observability/index.md#metrics) · [3rd Party API](../../../reference/components/external/index.md#thirdparty)

**Watch for.** Capacity is measured in tokens, not requests: one long prompt can cost as much as a hundred short ones. Rate limits and budgets per team must count tokens, and the self-hosted GPU pool saturates on concurrent tokens being generated, not on requests per second.

**Practice.** Case study: [AI assistant](../../../classes/case-studies/ai-assistant/index.md) · Playground scenario: [`ai-assistant`](../../../../playground/scenarios/index.md#ai-assistant) (LLM gateway, agent, tools, RAG, safety)

??? tip "Hints"

    - OpenAI-compatible API in front; routing policy per request (model class, data sensitivity, cost).
    - Fallback chain across providers with per-provider circuit breakers and token-aware rate limiting.
    - Exact and semantic caches for repeated prompts; prompt caching where providers support it.
    - Per-team budgets and token metrics; GPU pool autoscaled on queue depth and tokens/s (Little's Law in tokens).

---

## Where to go next { #next }

- Practice with a partner using the [mock interview protocol](../mock/index.md) and its rubric.
- Review the [quick reference](../quick-reference/index.md) the night before.
- Read the full [case studies](../../../classes/case-studies/index.md): each follows the same framework, with estimates, diagrams, deep dives and the follow-up questions interviewers ask.
- Look up any component in the [component catalog](../../../reference/components/index.md).
