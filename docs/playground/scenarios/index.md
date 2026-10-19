# Scenario guide

Every scenario of the [System Design Playground](../index.md) is a small lab: a BoxOffice situation, an initial design that **fails** its goals for a reason, and one possible fix. Each section below says what the scenario teaches, what to try, what to watch, the goals, and questions to discuss in class. The embedded simulators are compact (run controls, metrics and parameters); use **Open in the playground** (↗) to edit the structure.

## How to work on a scenario

1. **Predict before you run.** Estimate utilization (ρ = λ / μ) and the queue behaviour from the numbers in the brief.
2. **Run the initial design** and read the Report: which goal fails, and what is the bottleneck?
3. **Change one thing at a time** and run again with the same seed — differences are then caused by your change, not by luck.
4. **Change the seed** at the end: a good design passes with any seed.
5. **Explain the numbers** with the formulas of the [manual](../index.md#how-the-model-works).

!!! tip "Exercise"

    The graded exercise *playground-design* asks you to solve three scenarios and submit the exported JSON plus a short rationale (the Report has a **Copy report (Markdown)** button).

## All scenarios

| Scenario | Lesson |
|---|---|
| [Monolith: find the breaking point](#monolith) | Every system has a breaking point, and the first component to saturate decides it |
| [Scale out behind a load balancer](#scale-out) | Horizontal scaling needs headroom for failures (N+1), and a load balancer only routes around a dead replica after it detects it |
| [Read-heavy catalog: add a cache](#read-heavy-cache) | A cache in front of the database cuts its read load to reads × (1 − hit ratio); a cold cache sends everything back to the database at once (stampede) |
| [Offload static content to a CDN](#cdn-static) | Static and cacheable content belongs at the edge |
| [Read replicas and replication lag](#db-replicas) | Read replicas multiply read capacity but not write capacity, and they serve slightly old data (replication lag) |
| [Partitions and the hot key](#sharding) | Partitioning scales with the number of partitions only while keys are spread evenly; a hot key concentrates the load on one partition |
| [A queue absorbs the spike](#async-queue) | A queue decouples the user from slow work |
| [Publish an event, let consumers react](#event-fanout) | With an event log each consumer group reads at its own pace |
| [Cascading failure: a slow dependency](#cascading-failure) | A slow dependency without timeouts exhausts the caller's threads (Little's Law) and takes down requests that never touch it |
| [Retry storm: when retries make it worse](#retry-storm) | Immediate retries multiply the load on a struggling service; when answers exceed the timeout, every attempt fails and the system stays down after the trigger is gone (metastable failure) |
| [Rate limiting protects the backend](#rate-limiter) | Rejecting excess traffic fast (429) protects the backend and the real users; letting it queue degrades everyone |
| [Surviving a region outage](#multi-region) | Surviving a region needs a full second stack and a way to move users |
| [Serverless burst: cold starts and limits](#serverless-burst) | Functions scale per request |
| [BoxOffice flash sale at 10:00](#flash-sale) | A flash sale is designed for the peak |
| [URL shortener (box.office/xyz)](#url-shortener) | A read-heavy key lookup |
| [News feed: fan-out on write vs on read](#news-feed) | Fan-out on write moves work from the read path (frequent) to the write path (rare) |
| [Chat for a live event](#chat) | Chat separates storing messages (partitioned, append-heavy) from delivering them (pub/sub to the connected servers) |
| [Ride-sharing: a write-heavy geo index](#ride-sharing) | Location updates are a write-heavy stream |
| [Video streaming: CDN + object store + transcoding](#video-streaming) | Video is bytes at the edge plus heavy batch work in the background |
| [Notification system](#notification-system) | Notifications are asynchronous by nature |
| [Payments: retries need idempotency](#payment-system) | A retry after a timeout may repeat an operation that already happened |
| [Search autocomplete](#search-autocomplete) | Autocomplete is a latency problem |
| [AI support assistant (RAG + tools)](#ai-assistant) | In an LLM application latency and cost scale with the number of model calls |
| [You can't fix what you don't measure](#observability-stack) | Observability changes outcomes |

## Monolith: find the breaking point { #monolith }

BoxOffice v1: one app server and one PostgreSQL. The breakpoint profile ramps the load until errors pass 5% or p99 explodes. Where does it break, and which component breaks first? Make it survive 2 000 req/s without spending more than 2 000 USD/month.

- **Lesson:** Every system has a breaking point, and the first component to saturate decides it. Scaling one tier moves the bottleneck to the next one.
- **Setup:** `monolith` · profile `breakpoint` · target 600 req/s · 90% reads · seed 7 · chaos `off`
- **Goals:** breaking point ≥ 2,000 req/s · cost/month < US$ 2,000
- **Try:** Press ▶ and read the Report: breaking point and bottleneck. Add a Load Balancer in front of the app and raise its replicas; run again.
- **Observe:** The knee (p99 doubles) comes well before the break. After scaling the app, the database becomes the bottleneck.
- **Related:** [What is system design](../../2027.1/classes/intro/index.md) · [Estimation](../../2027.1/classes/estimation/index.md)

<div class="sdp" data-scenario="monolith" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. Why does latency grow slowly at first and then explode near ρ = 1?
    2. With 6 replicas, which component breaks first, and at what rate? Check it with ρ = λ / μ.
    3. What would you do next if the target were 5 000 req/s?

## Scale out behind a load balancer { #scale-out }

The catalog gets 1 500 req/s. Two replicas are not enough, and at t = 80 s one replica crashes. The load balancer keeps sending it traffic until it notices (30 s without health checks). Meet the goals with headroom for one failure (N+1).

- **Lesson:** Horizontal scaling needs headroom for failures (N+1), and a load balancer only routes around a dead replica after it detects it.
- **Setup:** `scale-out` · profile `load` · target 1,500 req/s · 90% reads · seed 11 · chaos `off` · scripted events: t = 80 s — one catalog replica crashes
- **Goals:** error rate < 1% · p99 < 250 ms · cost/month < US$ 1,800
- **Try:** Raise the app replicas until ρ ≈ 0.6. Then add a Health Check connected to the Load Balancer.
- **Observe:** At t = 80 s one replica dies: errors last ~30 s without health checks and ~3 s with them. The survivors must absorb its share.
- **Related:** [Traffic & edge](../../2027.1/classes/edge/index.md) · [Reliability](../../2027.1/classes/reliability/index.md)

<div class="sdp" data-scenario="scale-out" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. How many replicas do you need so that losing one keeps ρ below 0.85?
    2. Why does a crashed replica keep receiving requests for a while?
    3. What does detection time do to availability (MTTR = detect + repair)?

## Read-heavy catalog: add a cache { #read-heavy-cache }

Fans browse events: 3 000 req/s, 95% reads. The app tier is fine; the database is not. At t = 100 s the cache (once you have one) is flushed: will the database survive the stampede of misses?

- **Lesson:** A cache in front of the database cuts its read load to reads × (1 − hit ratio); a cold cache sends everything back to the database at once (stampede).
- **Setup:** `read-heavy-cache` · profile `load` · target 3,000 req/s · 95% reads · seed 3 · chaos `off` · scripted events: t = 100 s — cache flushed (deploy / restart)
- **Goals:** p99 < 100 ms · error rate < 0.5% · cost/month < US$ 3,000
- **Try:** Insert a Cache between app and database. Run; then turn request coalescing on and compare what happens at t = 100 s.
- **Observe:** The database utilization drops with the hit ratio. At the flush, without coalescing, it saturates for several seconds.
- **Related:** [Caching](../../2027.1/classes/caching/index.md)

<div class="sdp" data-scenario="read-heavy-cache" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. With 95% reads and an 88% hit ratio, what is the database load at 3 000 req/s?
    2. Why does cache-aside lower the hit ratio when writes are frequent?
    3. Name two other ways to survive a stampede.

## Offload static content to a CDN { #cdn-static }

Event pages are full of posters, images and scripts: 3 000 req/s, 98% reads, served by the app from object storage. Users far from the region wait, and the app is saturated. Serve them from the edge.

- **Lesson:** Static and cacheable content belongs at the edge: the origin only sees misses and writes, and users get a nearby answer.
- **Setup:** `cdn-static` · profile `load` · target 3,000 req/s · 98% reads · seed 5 · chaos `off`
- **Goals:** p99 < 150 ms · error rate < 0.5%
- **Try:** Put a CDN after the DNS (dns → cdn → lb). Lower the app replicas and compare latency and cost.
- **Observe:** The app tier falls from saturated to ~35% with fewer replicas. The CDN egress becomes the largest cost line.
- **Related:** [Traffic & edge](../../2027.1/classes/edge/index.md)

<div class="sdp" data-scenario="cdn-static" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. What decides the hit ratio of a CDN (TTL, cache key, content)?
    2. Why is egress (USD/GB) often the largest line of a media site?
    3. How would you invalidate a poster that changed?

## Read replicas and replication lag { #db-replicas }

4 000 req/s with 10% writes overload the single PostgreSQL primary. Read replicas take reads but never writes, and they lag behind the primary. Keep the lag under 1 s.

- **Lesson:** Read replicas multiply read capacity but not write capacity, and they serve slightly old data (replication lag).
- **Setup:** `db-replicas` · profile `load` · target 4,000 req/s · 90% reads · seed 13 · chaos `off`
- **Goals:** p99 < 150 ms · error rate < 0.5% · replication lag < 1 s
- **Try:** Add 2 read replicas to the database. Then raise the write share in the toolbar to 30% and watch the primary.
- **Observe:** Reads spread over 1 + replicas; the primary keeps every write and its lag grows with the write load.
- **Related:** [Databases](../../2027.1/classes/databases/index.md)

<div class="sdp" data-scenario="db-replicas" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. Which reads can tolerate lag, and which must go to the primary (read-your-writes)?
    2. At what write share do replicas stop helping?
    3. What comes after replicas when writes are the limit?

## Partitions and the hot key { #sharding }

Ticket lookups and updates (50% writes) at 8 000 req/s on a key-value store with 2 partitions. At t = 60 s a celebrity posts a link to one show: one key gets a huge share of the traffic for a minute. More partitions fix the average — do they fix the hot key?

- **Lesson:** Partitioning scales with the number of partitions only while keys are spread evenly; a hot key concentrates the load on one partition.
- **Setup:** `sharding` · profile `load` · target 8,000 req/s · 50% reads · seed 17 · chaos `off` · scripted events: t = 60 s — celebrity effect: one hot key
- **Goals:** error rate < 0.5% · p99 < 100 ms
- **Try:** Raise the partitions to 8 and run. Then add a Cache in front of the NoSQL store for the hot reads.
- **Observe:** At t = 60 s the celebrity effect starts: with 8 partitions the busiest one still saturates; the cache absorbs the hot reads.
- **Related:** [Databases](../../2027.1/classes/databases/index.md) · [Caching](../../2027.1/classes/caching/index.md)

<div class="sdp" data-scenario="sharding" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. If the hottest key gets 45% of the traffic, what is the load on its partition with P = 8? With P = 64?
    2. Besides caching, how can you split a hot key (salting, replicas of the key)?
    3. Why is consistent hashing used to place keys?

## A queue absorbs the spike { #async-queue }

Each order generates a ticket PDF (50 ms of work). Today the order service waits for it. The spike profile multiplies the load by 5 for 30 s: the workers cannot keep up and orders fail. Let the user go and do the work later.

- **Lesson:** A queue decouples the user from slow work: the producer waits only for the broker; the backlog absorbs the spike and drains afterwards.
- **Setup:** `async-queue` · profile `spike` · target 150 req/s · 0% reads · seed 19 · chaos `off`
- **Goals:** error rate < 0.1% · p99 < 100 ms · consumer lag < 60 s
- **Try:** Replace the call app → worker by app → Message Queue → worker. Run the spike profile again.
- **Observe:** Errors disappear; the backlog grows during the 30 s spike and drains after it. Consumer lag = backlog ÷ drain rate.
- **Related:** [Messaging](../../2027.1/classes/messaging/index.md) · [Compute & services](../../2027.1/classes/compute/index.md)

<div class="sdp" data-scenario="async-queue" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. How long does the backlog take to drain with 4 workers? Compute it before running.
    2. What happens if the spike never ends (producers > consumers forever)?
    3. Why must the consumer be idempotent with at-least-once delivery?

## Publish an event, let consumers react { #event-fanout }

When an order is placed, BoxOffice notifies the buyer, updates analytics and re-indexes availability — today with three synchronous calls in a row. At t = 60 s analytics becomes 20× slower and orders slow down with it. Decouple the order service from its consumers.

- **Lesson:** With an event log each consumer group reads at its own pace: a slow consumer lags behind without slowing the producer or the others.
- **Setup:** `event-fanout` · profile `load` · target 400 req/s · 0% reads · seed 23 · chaos `off` · scripted events: t = 60 s — analytics is 20× slower
- **Goals:** p99 < 120 ms · error rate < 0.1% · consumer lag < 60 s
- **Try:** Publish to Kafka (app → kafka) and let notification, analytics and the indexer consume (kafka → each).
- **Observe:** When analytics slows down at t = 60 s, only its lag grows; order latency stays flat.
- **Related:** [Messaging](../../2027.1/classes/messaging/index.md)

<div class="sdp" data-scenario="event-fanout" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. What decides the maximum parallelism of a consumer group?
    2. What guarantees do you lose compared with synchronous calls (ordering, read-your-writes)?
    3. How do you publish the event and write the order atomically (outbox)?

## Cascading failure: a slow dependency { #cascading-failure }

Half of the catalog pages call an external recommendations API. At t = 60 s it becomes 20× slower (3 s). Without timeouts every request holds a thread while waiting; the thread pools run out and the whole catalog fails — although the app's CPU is almost idle (Little's Law: threads = λ × W).

- **Lesson:** A slow dependency without timeouts exhausts the caller's threads (Little's Law) and takes down requests that never touch it.
- **Setup:** `cascading-failure` · profile `load` · target 800 req/s · 90% reads · seed 29 · chaos `off` · scripted events: t = 60 s — recommendations API 20× slower
- **Goals:** error rate < 1% · p99 < 500 ms
- **Try:** Run as is and read the bottleneck in the Report. Then set a 300 ms timeout on app → recommendations, then add a fallback and a circuit breaker.
- **Observe:** Without a timeout the app shows threads exhausted with idle CPU. With the timeout only the recommendation calls fail; with the fallback nobody does.
- **Related:** [Reliability](../../2027.1/classes/reliability/index.md)

<div class="sdp" data-scenario="cascading-failure" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. With 800 req/s, half calling a 3 s dependency, how many threads are busy? (L = λ × W)
    2. Why does a timeout alone not reach zero errors here?
    3. What would a bulkhead change?

## Retry storm: when retries make it worse { #retry-storm }

The inventory service retries every failed query 3 times, immediately, with a 100 ms timeout. At t = 60 s the database restarts (8 s). When it comes back, it receives up to 4× the normal load, its queue fills, answers take longer than the timeout… and it never recovers, although the trigger is long gone (a metastable failure).

- **Lesson:** Immediate retries multiply the load on a struggling service; when answers exceed the timeout, every attempt fails and the system stays down after the trigger is gone (metastable failure).
- **Setup:** `retry-storm` · profile `load` · target 2,000 req/s · 90% reads · seed 31 · chaos `off` · scripted events: t = 60 s — database restarts
- **Goals:** error rate < 15% · p99 < 300 ms
- **Try:** Run and watch the edge app → db after the 8 s restart. Then enable the circuit breaker; try also 1 retry with exponential backoff + jitter.
- **Observe:** The edge rate jumps to ~4× and errors never recover. With the breaker the database drains its queue and the system recovers.
- **Related:** [Reliability](../../2027.1/classes/reliability/index.md)

<div class="sdp" data-scenario="retry-storm" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. With p = 0.9 failures per attempt and 3 retries, what is the load multiplier?
    2. Why does a longer timeout or a shorter queue also break the loop?
    3. What is a retry budget?

## Rate limiting protects the backend { #rate-limiter }

1 000 req/s of real fans — plus scraper bots sending twice that. The catalog melts down for everybody. Reject the excess fast at the gateway (429) instead of letting it queue behind the real users.

- **Lesson:** Rejecting excess traffic fast (429) protects the backend and the real users; letting it queue degrades everyone.
- **Setup:** `rate-limiter` · profile `load` · target 1,000 req/s · 90% reads · seed 37 · chaos `off`
- **Goals:** error rate < 1% · p99 < 200 ms
- **Try:** Set a rate limit on the API Gateway below the app capacity (e.g. 1 500 req/s). Alternatively, add a WAF in front.
- **Observe:** Bots are cut first (per-client token buckets), real users keep low latency and the app stays below saturation.
- **Related:** [Traffic & edge](../../2027.1/classes/edge/index.md)

<div class="sdp" data-scenario="rate-limiter" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. Token bucket vs. sliding window: which allows bursts?
    2. Where should the limit live in a system with many gateway replicas?
    3. Why is a 429 better for the client than a timeout?

## Surviving a region outage { #multi-region }

BoxOffice runs in one cloud region. At t = 60 s the whole region goes down. Build a second region and let DNS move users there. Failover time = detection + DNS TTL: check both.

- **Lesson:** Surviving a region needs a full second stack and a way to move users: DNS failover takes detection plus TTL.
- **Setup:** `multi-region` · profile `load` · target 1,000 req/s · 90% reads · seed 41 · chaos `off` · scripted events: t = 60 s — region sa-east-1 is down
- **Goals:** availability ≥ 95% · p99 < 80 ms
- **Try:** Draw a second VPC (another region) with LB, app and database; connect DNS to it, attach a Health Check to the DNS and lower its TTL.
- **Observe:** At t = 60 s the first region disappears. Errors last about (3 s + TTL) for the users routed there.
- **Related:** [Reliability](../../2027.1/classes/reliability/index.md) · [Traffic & edge](../../2027.1/classes/edge/index.md)

<div class="sdp" data-scenario="multi-region" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. Active-active or active-passive: which loses fewer requests here?
    2. What happens to data written in the lost region (RPO)?
    3. Why must each app call its own region's database?

## Serverless burst: cold starts and limits { #serverless-burst }

A presale code check runs as a function. The spike profile jumps from 200 to 2 000 req/s. New instances start cold (600 ms) and the account has a concurrency limit of 50. Instances needed = λ × W (Little's Law).

- **Lesson:** Functions scale per request: instances = λ × W, cold starts hit exactly when traffic jumps, and the concurrency limit throttles the rest.
- **Setup:** `serverless-burst` · profile `spike` · target 200 req/s · 90% reads · seed 43 · chaos `off`
- **Goals:** error rate < 0.5% · p99 < 300 ms · cost/month < US$ 5,000
- **Try:** Raise the concurrency limit, run the spike; then add provisioned instances and compare p99 and cost.
- **Observe:** Throttling (429) disappears with a higher limit; cold starts show up in p99 at the start of the spike until warm instances exist.
- **Related:** [Compute & services](../../2027.1/classes/compute/index.md)

<div class="sdp" data-scenario="serverless-burst" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. How many instances do 2 000 req/s × 40 ms need?
    2. Why do cold starts increase the number of instances needed?
    3. When is a container with autoscaling cheaper than functions?

## BoxOffice flash sale at 10:00 { #flash-sale }

A stadium show goes on sale at t = 60 s: traffic jumps 20× (to ~6 000 req/s) for 90 s. 80% of requests read the event page, 20% try to buy. The database holds the seats (no double booking!) and the payment provider accepts 500 req/s. Today everything collapses. Design for the peak: serve reads from the edge and caches, and put buyers in a waiting room (queue) drained at the speed the inventory and the payment provider can handle.

- **Lesson:** A flash sale is designed for the peak: reads are absorbed by the edge and caches, and buyers wait in a queue drained at the pace of the inventory and the payment provider.
- **Setup:** `flash-sale` · profile `load` · target 300 req/s · 80% reads · seed 2027 · chaos `off` · scripted events: t = 60 s — 10:00 — sales open
- **Goals:** p99 < 300 ms · error rate < 1% · consumer lag < 300 s
- **Try:** Follow the hints one at a time: CDN, catalog cache, then API Gateway routing writes to a waiting-room queue consumed by order workers.
- **Observe:** With the waiting room, errors vanish and p99 stays low; the consumer lag is how long a buyer waits in line.
- **Related:** [Case studies](../../2027.1/classes/case-studies/index.md) · [Messaging](../../2027.1/classes/messaging/index.md) · [Caching](../../2027.1/classes/caching/index.md)

<div class="sdp" data-scenario="flash-sale" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. How many seats can be sold per second if payment allows 500 req/s and each order takes one call?
    2. How do you avoid selling the same seat twice (holds, SELECT … FOR UPDATE)?
    3. How would you tell users their position in the line?

## URL shortener (box.office/xyz) { #url-shortener }

Every ticket e-mail carries a short link. 5 000 redirects/s, 99% reads, a few writes (new links). The classic interview problem: what is the read path, and what store fits a key → URL lookup?

- **Lesson:** A read-heavy key lookup: cache + key-value store, sized with simple arithmetic.
- **Setup:** `url-shortener` · profile `load` · target 5,000 req/s · 99% reads · seed 47 · chaos `off`
- **Goals:** p99 < 50 ms · error rate < 0.1% · cost/month < US$ 3,500
- **Try:** Replace the SQL database by Cache → NoSQL and size the app tier.
- **Observe:** p99 drops to a few tens of ms; most redirects never reach the store.
- **Related:** [Case studies](../../2027.1/classes/case-studies/index.md)

<div class="sdp" data-scenario="url-shortener" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. How many short codes fit in 7 base-62 characters?
    2. How do you generate unique codes without coordination?
    3. 301 or 302 redirect: which one lets you count clicks?

## News feed: fan-out on write vs on read { #news-feed }

The BoxOffice feed shows posts from the artists and venues a fan follows. Today the feed is assembled when it is read: a heavy query (40 ms) that merges hundreds of sources. 2 000 req/s, 95% reads. Precompute timelines when something is posted instead.

- **Lesson:** Fan-out on write moves work from the read path (frequent) to the write path (rare): a feed read becomes one key lookup.
- **Setup:** `news-feed` · profile `load` · target 2,000 req/s · 95% reads · seed 53 · chaos `off`
- **Goals:** p99 < 100 ms · error rate < 0.5% · consumer lag < 10 s
- **Try:** Route reads to a timeline cache over a NoSQL store, and writes to the posts database plus Kafka → fan-out workers → timelines.
- **Observe:** Reads become cheap; the fan-out lag shows how long a post takes to reach the timelines.
- **Related:** [Case studies](../../2027.1/classes/case-studies/index.md) · [Messaging](../../2027.1/classes/messaging/index.md)

<div class="sdp" data-scenario="news-feed" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. What breaks when an artist has 10 million followers?
    2. How does a hybrid approach treat celebrities?
    3. Which consistency does a feed really need?

## Chat for a live event { #chat }

During a show, fans chat in the event room: 2 000 req/s, half are new messages. Each message is stored in PostgreSQL and delivered synchronously before the sender gets an answer. Writes overload the database and the sender waits for every delivery.

- **Lesson:** Chat separates storing messages (partitioned, append-heavy) from delivering them (pub/sub to the connected servers).
- **Setup:** `chat` · profile `load` · target 2,000 req/s · 50% reads · seed 59 · chaos `off`
- **Goals:** p99 < 80 ms · error rate < 0.1% · consumer lag < 2 s
- **Try:** Store messages in a NoSQL store and publish them to Pub/Sub consumed by the delivery service.
- **Observe:** Write load spreads over partitions; senders no longer wait for delivery.
- **Related:** [Case studies](../../2027.1/classes/case-studies/index.md) · [Traffic & edge](../../2027.1/classes/edge/index.md)

<div class="sdp" data-scenario="chat" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. How does a message reach a user connected to another websocket server?
    2. How do you order messages in a room?
    3. What happens to messages for users who are offline?

## Ride-sharing: a write-heavy geo index { #ride-sharing }

After the show, BoxOffice partners' drivers send their position every 4 s: 20 000 req/s, 90% writes, while riders query nearby drivers. A relational database cannot absorb that write rate. Keep only the latest position per driver in a partitioned store and stream the history.

- **Lesson:** Location updates are a write-heavy stream: keep only the latest position in a partitioned store and send the history asynchronously.
- **Setup:** `ride-sharing` · profile `load` · target 20,000 req/s · 10% reads · seed 61 · chaos `off`
- **Goals:** p99 < 100 ms · error rate < 0.5% · cost/month < US$ 6,000
- **Try:** Replace SQL by a partitioned NoSQL geo index; sample positions into Kafka for analytics.
- **Observe:** The relational primary was saturated by writes; the partitioned store absorbs them with headroom.
- **Related:** [Case studies](../../2027.1/classes/case-studies/index.md) · [Databases](../../2027.1/classes/databases/index.md)

<div class="sdp" data-scenario="ride-sharing" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. How many writes/s do 1 million drivers sending every 4 s generate?
    2. How do you find drivers within 2 km (geohash, quadtree, H3)?
    3. What happens to the geo index when a stadium empties?

## Video streaming: CDN + object store + transcoding { #video-streaming }

Venues upload show teasers; fans watch them. 2 000 segment requests/s from viewers go through the app, and each upload is transcoded synchronously (20 s per video) while the uploader waits. Serve segments from the edge and transcode in the background.

- **Lesson:** Video is bytes at the edge plus heavy batch work in the background: CDN + object store for viewers, a queue + workers for transcoding.
- **Setup:** `video-streaming` · profile `load` · target 2,000 req/s · 99% reads · seed 67 · chaos `off`
- **Goals:** p99 < 150 ms · error rate < 0.5% · consumer lag < 120 s
- **Try:** Viewers → CDN → Object Store; uploads → API Gateway → app → queue → transcoders.
- **Observe:** The app tier almost disappears from the viewing path; the transcoding backlog drains at replicas × 1/20 s.
- **Related:** [Case studies](../../2027.1/classes/case-studies/index.md) · [Traffic & edge](../../2027.1/classes/edge/index.md)

<div class="sdp" data-scenario="video-streaming" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. Why are video segments ideal for caching?
    2. How many transcoders do 0.5 uploads/s of 20 s jobs need (Little)?
    3. Why produce several bitrates (adaptive streaming)?

## Notification system { #notification-system }

Every purchase sends a confirmation e-mail (50 req/s), and a scheduler sends 6 000 digest e-mails every 2 minutes — all at the same instant. The e-mail provider accepts 200 sends/s. Today buyers wait for the provider and fail whenever the digest burst arrives.

- **Lesson:** Notifications are asynchronous by nature: queue them, pace them to the provider quota, and never fire scheduled jobs all at once.
- **Setup:** `notification-system` · profile `load` · target 50 req/s · 0% reads · seed 71 · chaos `off`
- **Goals:** error rate < 0.5% · p99 < 150 ms · consumer lag < 120 s
- **Try:** Put a queue in front of the notification service and spread the scheduler's jobs over 60 s.
- **Observe:** Buyers no longer feel the digest burst; the provider quota sets the drain rate.
- **Related:** [Case studies](../../2027.1/classes/case-studies/index.md) · [Compute & services](../../2027.1/classes/compute/index.md)

<div class="sdp" data-scenario="notification-system" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. Why is a scheduled burst a self-inflicted spike?
    2. How would you give transactional e-mails priority over digests?
    3. How do you avoid sending the same e-mail twice?

## Payments: retries need idempotency { #payment-system }

Orders call the payment provider synchronously with a 1 s timeout and 2 immediate retries. At t = 60 s the provider becomes 4× slower: calls time out, and each retry after a timeout may charge the card AGAIN — the provider did receive the first attempt. Make payments safe and keep buyers fast.

- **Lesson:** A retry after a timeout may repeat an operation that already happened: payments need idempotency keys, and the buyer should not wait for the provider.
- **Setup:** `payment-system` · profile `load` · target 300 req/s · 50% reads · seed 73 · chaos `off` · scripted events: t = 60 s — payment provider 4× slower
- **Goals:** duplicate charges < 1 · error rate < 1% · p99 < 1,500 ms
- **Try:** Turn on the idempotency key on the payment edge; then move the call behind a queue and a payment worker.
- **Observe:** Duplicate charges drop to zero with the key; with the queue, buyer latency no longer depends on the provider.
- **Related:** [Case studies](../../2027.1/classes/case-studies/index.md) · [Compute & services](../../2027.1/classes/compute/index.md)

<div class="sdp" data-scenario="payment-system" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. Why can a timeout not tell "failed" from "succeeded slowly"?
    2. How does the provider use the idempotency key?
    3. How do webhooks and reconciliation close the loop?

## Search autocomplete { #search-autocomplete }

Every keystroke in the search box asks for suggestions: 10 000 req/s, all reads, and they must feel instant (< 50 ms). The search cluster cannot take it. Most prefixes are popular and repeat a lot.

- **Lesson:** Autocomplete is a latency problem: popular prefixes repeat, so a prefix cache answers most keystrokes.
- **Setup:** `search-autocomplete` · profile `load` · target 10,000 req/s · 100% reads · seed 79 · chaos `off`
- **Goals:** p99 < 50 ms · error rate < 0.1% · cost/month < US$ 5,000
- **Try:** Insert a Cache between the app and the search service; size the app tier. Lower the target RPS to simulate client debouncing.
- **Observe:** The search cluster load drops by the hit ratio and p99 meets the 50 ms budget.
- **Related:** [Case studies](../../2027.1/classes/case-studies/index.md) · [Caching](../../2027.1/classes/caching/index.md)

<div class="sdp" data-scenario="search-autocomplete" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. How many requests does debouncing at 100 ms save while typing "metallica"?
    2. Trie in memory vs. search engine: trade-offs?
    3. How often must the suggestions be rebuilt?

## AI support assistant (RAG + tools) { #ai-assistant }

The BoxOffice assistant answers questions about events and orders. Its agent loop takes 6 steps (6 LLM calls + tool calls) per question, the provider quota is 10 calls/s, and nothing checks for prompt injection. 2 questions/s already exceed the quota, take seconds, and cost a fortune.

- **Lesson:** In an LLM application latency and cost scale with the number of model calls: fewer agent steps, a semantic cache and quota-aware routing matter more than raw capacity; guardrails belong in the path.
- **Setup:** `ai-assistant` · profile `load` · target 2 req/s · 100% reads · seed 83 · chaos `off`
- **Goals:** error rate < 1% · p99 < 10,000 ms · cost/month < US$ 60,000 · unsafe answers < 0.1%
- **Try:** Reduce the agent steps, turn on the semantic cache and a fallback model, and put a Safety Mesh between the gateway and the assistant.
- **Observe:** Errors (429) vanish under the quota, cost falls with the calls per question and the unsafe-answer rate drops.
- **Related:** [AI systems](../../2027.1/classes/ai-systems/index.md)

<div class="sdp" data-scenario="ai-assistant" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. Cost per question = steps × tokens × price: compute it for 6 and for 3 steps.
    2. What does a semantic cache risk (stale or wrong answers)?
    3. Where should the guardrails run: input, output, or both?

## You can't fix what you don't measure { #observability-stack }

Utilization is hidden ("?") until a service is connected to Metrics. At t = 50 s one catalog replica dies; without health checks the load balancer notices only after 30 s, and without alerting nobody repairs it quickly. Wire the observability stack: metrics on every service, health checks, alerting, logs and tracing.

- **Lesson:** Observability changes outcomes: health checks shorten detection, alerting shortens repair, and metrics make utilization visible.
- **Setup:** `observability-stack` · profile `load` · target 600 req/s · 90% reads · seed 89 · chaos `off` · scripted events: t = 50 s — a catalog replica dies
- **Goals:** availability ≥ 99% · p99 < 200 ms · services measured ≥ 100%
- **Try:** Connect Metrics to the LB, app and database; add a Health Check on the LB, Alerting on Metrics, plus Logs and Tracing on the app.
- **Observe:** The "?" become numbers; the crash at t = 50 s costs seconds instead of half a minute; the Trace tab shows where a slow request spends its time.
- **Related:** [Observability](../../2027.1/classes/observability/index.md)

<div class="sdp" data-scenario="observability-stack" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. Availability = MTTF / (MTTF + MTTR): which part did each node improve?
    2. Which four golden signals would you put on the dashboard?
    3. Why alert on SLO burn rate instead of CPU?
