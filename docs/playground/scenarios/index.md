# Scenario guide

Every scenario of the [System Design Playground](../index.md) is a small lab: a realistic situation, an initial design that **fails** its goals for a reason, and one possible fix. Each section below says what the scenario teaches, what to try, what to watch, the goals, and questions to discuss in class. The embedded simulators are compact (run controls, metrics and parameters); use **Open in the playground** (↗) to edit the structure.

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
| [Flash sale: a limited-stock launch](#flash-sale) | A flash sale is designed for the peak |
| [URL shortener (sho.rt/xyz)](#url-shortener) | A read-heavy key lookup |
| [News feed: fan-out on write vs on read](#news-feed) | Fan-out on write moves work from the read path (frequent) to the write path (rare) |
| [Chat for a live event](#chat) | Chat separates storing messages (partitioned, append-heavy) from delivering them (pub/sub to the connected servers) |
| [Ride-sharing: a write-heavy geo index](#ride-sharing) | Location updates are a write-heavy stream |
| [Video streaming: CDN + object store + transcoding](#video-streaming) | Video is bytes at the edge plus heavy batch work in the background |
| [Notification system](#notification-system) | Notifications are asynchronous by nature |
| [Payments: retries need idempotency](#payment-system) | A retry after a timeout may repeat an operation that already happened |
| [Search autocomplete](#search-autocomplete) | Autocomplete is a latency problem |
| [AI support assistant (RAG + tools)](#ai-assistant) | In an LLM application latency and cost scale with the number of model calls |
| [You can't fix what you don't measure](#observability-stack) | Observability changes outcomes |
| [Microservices on Kubernetes: pods vs nodes](#microservices) | The HPA adds pods, only nodes add room; every synchronous hop adds to the user's wait |
| [Kubernetes: losing a node](#k8s-node-failure) | Plan N+1 for nodes too: a lost node takes several pods at once, and they come back only if there is room |
| [Database failover: RTO and RPO](#db-failover) | A failover costs the time without a primary (RTO) and the writes not yet replicated (RPO) |
| [BoxOffice: the 10:00 on-sale on one database](#boxoffice-onsale) | A waiting room keeps the database at ≈ 63% while 2 M fans arrive |
| [BoxOffice lab 2: the knee of the connection pool](#boxoffice-pool) | The knee of a service is often its connection pool: c ÷ S queries/s |
| [BoxOffice lab 3: the edge (Nginx), replicas and limit_req](#boxoffice-edge) | Replicas, passive health checks and a per-key rate limit at the edge |
| [BoxOffice lab 4: the login rush at the gateway](#boxoffice-gateway) | A login rush needs auth sized for the peak; the gateway validates JWTs alone |
| [BoxOffice lab 5: cache-aside on Redis](#boxoffice-cache) | Cache-aside on Redis, and the stampede after a restart |
| [BoxOffice lab 6: the replica that lies](#boxoffice-read-your-writes) | A lagging replica: stale reads, and the writes a failover loses |
| [BoxOffice lab 7: the outbox and Kafka](#boxoffice-outbox) | The outbox and Kafka decouple the order from the e-mail; partitions cap the consumers |
| [BoxOffice: how many PDF workers?](#boxoffice-tickets-pdf) | Workers behind a queue: busy = λ × S, and the backlog when they are too few |
| [BoxOffice lab 8: the database stops, does anybody know?](#boxoffice-observability) | Wire OpenTelemetry → LGTM (Loki, Grafana, Tempo, Mimir); an alert halves the outage |
| [BoxOffice lab 9: payment turns slow](#boxoffice-payment) | Timeout, retries, breaker and bulkhead around a slow payment service |
| [BoxOffice lab 10: the HPA arrives late](#boxoffice-hpa) | The HPA arrives late; scale before a known peak |
| [BoxOffice lab 11: a bad release, all at once or as a canary](#boxoffice-canary) | A canary shrinks the blast radius of a bad release |
| [BoxOffice lab 12: the seat assistant](#boxoffice-assistant) | Agent steps decide load, latency and cost; guardrails decide safety |
| [BoxOffice lab 13: build agents share the fans' LLM quota](#boxoffice-shared-llm) | Background agents must not starve the fans: queue them, cap their concurrency |
| [Ticketing: 2 M fans, 60 k seats](#ticketing) | Polls at the edge, joins in a waiting room, shoppers admitted at ≈ 33/s |
| [Distributed cache: memory or throughput?](#distributed-cache) | Size a cache by memory and by throughput; the hit ratio sizes the database |

## Monolith: find the breaking point { #monolith }

Version 1 of the app: one app server and one PostgreSQL. The breakpoint profile ramps the load until errors pass 5% or p99 explodes. Where does it break, and which component breaks first? Make it survive 2 000 req/s without spending more than 2 000 USD/month.

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

Users browse the catalog: 3 000 req/s, 95% reads. The app tier is fine; the database is not. At t = 100 s the cache (once you have one) is flushed: will the database survive the stampede of misses?

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

Product pages are full of images, styles and scripts: 3 000 req/s, 98% reads, served by the app from object storage. Users far from the region wait, and the app is saturated. Serve them from the edge.

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
    3. How would you invalidate an image that changed?

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

Stock lookups and updates (50% writes) at 8 000 req/s on a key-value store with 2 partitions. At t = 60 s a celebrity posts a link to one product: one key gets a huge share of the traffic for a minute. More partitions fix the average — do they fix the hot key?

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

Each order generates a PDF receipt (50 ms of work). Today the order service waits for it. The spike profile multiplies the load by 5 for 30 s: the workers cannot keep up and orders fail. Let the user go and do the work later.

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

When an order is placed, the app notifies the buyer, updates analytics and re-indexes availability — today with three synchronous calls in a row. At t = 60 s analytics becomes 20× slower and orders slow down with it. Decouple the order service from its consumers.

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

1 000 req/s of real users — plus scraper bots sending twice that. The catalog melts down for everybody. Reject the excess fast at the gateway (429) instead of letting it queue behind the real users.

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

The app runs in one cloud region. At t = 60 s the whole region goes down. Build a second region and let DNS move users there. Failover time = detection + DNS TTL: check both.

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

A discount-coupon check runs as a function. The spike profile jumps from 200 to 2 000 req/s. New instances start cold (600 ms) and the account has a concurrency limit of 50. Instances needed = λ × W (Little's Law).

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

## Flash sale: a limited-stock launch { #flash-sale }

A limited-stock product goes on sale at t = 60 s: traffic jumps 20× (to ~6 000 req/s) for 90 s. 80% of requests read the product page, 20% try to buy. The database holds the stock (no overselling!) and the payment provider accepts 500 req/s. Today everything collapses. Design for the peak: serve reads from the edge and caches, and put buyers in a waiting room (queue) drained at the speed the inventory and the payment provider can handle.

- **Lesson:** A flash sale is designed for the peak: reads are absorbed by the edge and caches, and buyers wait in a queue drained at the pace of the inventory and the payment provider.
- **Setup:** `flash-sale` · profile `load` · target 300 req/s · 80% reads · seed 2027 · chaos `off` · scripted events: t = 60 s — the sale opens
- **Goals:** p99 < 300 ms · error rate < 1% · consumer lag < 300 s
- **Try:** Follow the hints one at a time: CDN, catalog cache, then API Gateway routing writes to a waiting-room queue consumed by order workers.
- **Observe:** With the waiting room, errors vanish and p99 stays low; the consumer lag is how long a buyer waits in line.
- **Related:** [Case studies](../../2027.1/classes/case-studies/index.md) · [Messaging](../../2027.1/classes/messaging/index.md) · [Caching](../../2027.1/classes/caching/index.md)

<div class="sdp" data-scenario="flash-sale" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. How many items can be sold per second if payment allows 500 req/s and each order takes one call?
    2. How do you avoid selling more items than are in stock (reservations, SELECT … FOR UPDATE)?
    3. How would you tell users their position in the line?

## URL shortener (sho.rt/xyz) { #url-shortener }

Every order e-mail and shared post carries a short link. 5 000 redirects/s, 99% reads, a few writes (new links). The classic interview problem: what is the read path, and what store fits a key → URL lookup?

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

The feed shows posts from the accounts a user follows. Today the feed is assembled when it is read: a heavy query (40 ms) that merges hundreds of sources. 2 000 req/s, 95% reads. Precompute timelines when something is posted instead.

- **Lesson:** Fan-out on write moves work from the read path (frequent) to the write path (rare): a feed read becomes one key lookup.
- **Setup:** `news-feed` · profile `load` · target 2,000 req/s · 95% reads · seed 53 · chaos `off`
- **Goals:** p99 < 100 ms · error rate < 0.5% · consumer lag < 10 s
- **Try:** Route reads to a timeline cache over a NoSQL store, and writes to the posts database plus Kafka → fan-out workers → timelines.
- **Observe:** Reads become cheap; the fan-out lag shows how long a post takes to reach the timelines.
- **Related:** [Case studies](../../2027.1/classes/case-studies/index.md) · [Messaging](../../2027.1/classes/messaging/index.md)

<div class="sdp" data-scenario="news-feed" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. What breaks when an account has 10 million followers?
    2. How does a hybrid approach treat celebrities?
    3. Which consistency does a feed really need?

## Chat for a live event { #chat }

During a live event, users chat in its room: 2 000 req/s, half are new messages. Each message is stored in PostgreSQL and delivered synchronously before the sender gets an answer. Writes overload the database and the sender waits for every delivery.

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

Drivers send their position every 4 s: 20 000 req/s, 90% writes, while riders query nearby drivers. A relational database cannot absorb that write rate. Keep only the latest position per driver in a partitioned store and stream the history.

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

Creators upload videos; users watch them. 2 000 segment requests/s from viewers go through the app, and each upload is transcoded synchronously (20 s per video) while the uploader waits. Serve segments from the edge and transcode in the background.

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

The support assistant answers questions about products and orders. Its agent loop takes 6 steps (6 LLM calls + tool calls) per question, the provider quota is 10 calls/s, and nothing checks for prompt injection. 2 questions/s already exceed the quota, take seconds, and cost a fortune.

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

## Microservices on Kubernetes: pods vs nodes { #microservices }

The app was split into catalog, inventory, order and notify microservices, each with its own database, behind an API gateway, on a Kubernetes cluster of 2 nodes × 6 pods. At 2 000 req/s the catalog's HPA asks for more pods than the cluster can schedule: they stay Pending, and the catalog drowns. Buying is a synchronous chain (order → inventory, catalog, notify, its DB): every hop adds its latency to the buyer's wait.

- **Lesson:** The HPA adds pods, but only nodes add room: pods beyond nodes × pods per node stay Pending and serve nothing. In a chain of synchronous microservices every hop adds its latency to the user's wait, so work that the user does not need to wait for belongs behind a queue.
- **Setup:** `microservices` · profile `load` · target 2,000 req/s · 80% reads · seed 2031 · chaos `off`
- **Goals:** error rate < 1% · p99 < 200 ms · cost/month < US$ 8,500
- **Try:** Select the cluster frame: pods = nodes × pods per node. Add nodes or turn on the cluster autoscaler (a node takes ~90 s, so keep some headroom), raise the catalog's minimum replicas, and put a queue between order and notify.
- **Observe:** As drawn, errors ≈ 25% and p99 ≈ 3.8 s: the catalog's HPA wants ~14 pods, but the 2 × 6 cluster is full (6 catalog + 2 order + 2 inventory + 2 notify), so 9 pods stay Pending; and the buyer also waits for notify (120 ms median, σ 0.6). The possible solution — 3 nodes with the cluster autoscaler (max 6; it adds a 4th node at ~45 s, ready at ~135 s), catalog replicas and minimum 10, and order → queue *confirmations* → notify — passes with errors ≈ 0%, p99 ≈ 60 ms and ≈ 8 000 USD/month. Read the cost lines: the API gateway's per-request price, not the nodes, dominates the bill.
- **Related:** [Compute & services](../../2027.1/classes/compute/index.md) · [Cloud-native platforms](../../2027.1/classes/cloud-native/index.md)

<div class="sdp" data-scenario="microservices" data-mode="compact" data-height="480"></div>

??? question "Questions to discuss"

    1. The catalog receives the reads (80% of 2 000 req/s) plus one call per order (400 req/s), at 250 req/s per pod. How many pods does it need at ρ = 0.6, and do they fit in 2 nodes × 6 pods?
    2. Which calls of the buying chain must finish before the buyer gets an answer, and which can become events?
    3. The gateway charges 1 USD per million requests: how much is that per month at 2 000 req/s, and how would you cut it?

## Kubernetes: losing a node { #k8s-node-failure }

Catalog and pricing run 6 pods each on a cluster of 3 nodes × 4 pods: completely full. At t = 60 s a worker node dies and takes a third of the pods with it. Callers keep sending requests to the dead pods until they notice (30 s behind the load balancer, 40 s for the direct catalog → pricing call), and the lost pods have nowhere to be rescheduled. Survive the loss of any one node.

- **Lesson:** N+1 applies to nodes, not only to replicas: a lost node takes several pods at once, callers keep calling them until they notice, and Kubernetes can only reschedule them where there is room. A direct service-to-service call needs service discovery and a timeout to stop waiting for dead pods.
- **Setup:** `k8s-node-failure` · profile `load` · target 1,700 req/s · 90% reads · seed 2033 · chaos `off` · scripted events: t = 60 s — a worker node dies
- **Goals:** error rate < 1% · p99 < 150 ms · cost/month < US$ 2,000
- **Try:** Leave room in the cluster (more pods per node or one more node) and size the replicas so the survivors carry the load (ρ after losing a third below ~0.85). Put a timeout with retries on catalog → pricing, and connect a Service Registry to catalog and pricing.
- **Observe:** As drawn, the node takes 2 catalog + 2 pricing pods. Catalog → pricing calls keep going to the dead pricing pods for 40 s; each one hangs 10 s, the catalog's threads run out and the failure cascades (~90% errors in that window); after 40 s the lost pods are recreated but stay Pending (no room): ≈ 27% errors and p99 > 4 s over the run. The possible solution — 8 pods per node (3 × 8 = 24 slots: after losing a node, 16 slots for the 16 pods — N+1 for nodes), 8 replicas each, a Service Registry connected to catalog and pricing, and a 300 ms timeout + 2 retries on catalog → pricing — passes with errors ≈ 0.8% and p99 ≈ 43 ms: dead pods are dropped in 3 s, a call that lands on one gives up after 300 ms and is retried on a live pod, the surviving pods carry the load, and the 6 lost pods are all rescheduled after 40 s.
- **Related:** [Cloud-native platforms](../../2027.1/classes/cloud-native/index.md) · [Reliability](../../2027.1/classes/reliability/index.md)

<div class="sdp" data-scenario="k8s-node-failure" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. With 3 nodes × 4 pods and 12 pods, how many pods does one node failure take, and where can Kubernetes put them? And with 8 pods per node and 8 replicas each?
    2. Why does the direct catalog → pricing call hurt more than the load balancer → catalog edge? Use Little's Law with a 10 s hang.
    3. Why should the pods of one service be spread over different nodes and zones (topology spread constraints)?

## Database failover: RTO and RPO { #db-failover }

Flash-sale checkout: 1 500 req/s, half of them writes (orders), on a DB Cluster with one primary and one follower replicated asynchronously. At t = 90 s the primary dies. Until a follower is promoted (30 s) every write fails, and the writes still inside the replication lag are lost for good: orders paid and forgotten. Make the failover lose nothing and hurt little.

- **Lesson:** A failover has two costs: the time without a primary (RTO) and the writes not yet replicated (RPO). Synchronous or quorum replication makes the RPO zero at the price of a round trip per write; a fast failover and more shards shrink the RTO and the share of writes it hits — and every copy is paid.
- **Setup:** `db-failover` · profile `load` · target 1,500 req/s · 50% reads · seed 2035 · chaos `off` · scripted events: t = 90 s — the primary of orders-db dies
- **Goals:** lost writes < 1 · availability ≥ 99% · p99 (writes) < 100 ms
- **Try:** Switch the replication to sync or quorum, shorten the failover time and split the keys into shards. Then inject a latency degradation on the cluster (it slows one follower) and compare sync and quorum on the write p99.
- **Observe:** As drawn, ≈ 1 570 writes are lost when the primary dies, writes fail for 30 s (availability ≈ 90.6%), and after the promotion a single node carries reads and writes, so the write p99 reaches ≈ 375 ms. The possible solution — 2 shards, 2 followers each, quorum, failover 5 s — passes with 0 lost writes, availability ≈ 99.2% and a write p99 ≈ 34 ms; but the database bill goes from 900 to 2 700 USD/month (2 shards × 3 nodes × 450).
- **Related:** [Databases](../../2027.1/classes/databases/index.md) · [Reliability](../../2027.1/classes/reliability/index.md)

<div class="sdp" data-scenario="db-failover" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. Lost writes ≈ write rate × lag: estimate them from the inspector just before t = 90 s.
    2. With one follower slowed down, why does sync suffer and quorum with 2 followers not?
    3. RPO 0 and RTO 5 s triple the database bill: for which data is it worth it (orders, sessions, analytics)?

## BoxOffice, chapter by chapter { #boxoffice }

The scenarios below follow the system the 2027.1 course builds, with the names and numbers of the class pages and of the lab code: each one is a chapter of the [story](../../2027.1/index.md#story) or a lab, set up so that the problem appears at the load the page states.

## BoxOffice: the 10:00 on-sale on one database { #boxoffice-onsale }

At 10:00 two million fans try to hold seats in the first minute: ≈ 33 000 holds/s against an inventory database that does 1 600/s at 100% (5 ms per hold, 8 connections) and ≈ 1 100/s at a sane 70%. Eighty inventory replicas do not help: every hold ends in the same database. Keep holds under 300 ms and put the excess in a line instead of turning it into errors.

- **Lesson:** Estimate before you build: demand ÷ capacity of the one component every request must reach. A 20× gap is not closed by replicas in front of the database; a line (waiting room) turns the excess into waiting instead of errors.
- **Setup:** `boxoffice-onsale` · profile `load` · target 1,000 req/s · 0% reads · seed 2027 · chaos `off` · scripted events: t = 60 s — 10:00: the sale opens (2 M fans in 60 s)
- **Goals:** error rate < 1% · p99 < 300 ms
- **Try:** Run it and read the bottleneck (inventory-db, connections). Replace the synchronous path by gateway → Message Queue → inventory workers that admit ≈ 1 000 holds/s.
- **Observe:** As drawn, ≈ 91% of the requests fail during the sale and the database is the bottleneck by connections. With the waiting room every hold succeeds in ≈ 10 ms at p99 and the database stays at ≈ 1 000 holds/s, but the line grows by ≈ 32 000 fans per second: the consumer lag (tens of minutes) is the wait a fan sees. The simulator does not model the sell-out: most of those fans would be told "sold out" long before their turn.
- **Related:** [Estimation](../../2027.1/classes/estimation/index.md) · [What is system design](../../2027.1/classes/intro/index.md) · [Case study: ticketing](../../2027.1/classes/case-studies/ticketing/index.md)

<div class="sdp" data-scenario="boxoffice-onsale" data-mode="compact" data-height="460"></div>

??? question "Questions to discuss"

    1. Compute the capacity of the database with Little's Law (c / S) and the demand from 2 M fans in 60 s. How many databases would you need without a line?
    2. Why does the line not make the sale faster for anybody, yet makes it work?
    3. What should the waiting room tell a fan whose position is beyond the number of seats?

## BoxOffice lab 2: the knee of the connection pool { #boxoffice-pool }

Labs 1–2: one catalog (1 CPU) and its PostgreSQL, with the default pool of 10 connections. stress.js ramps up to 600 req/s: p99 is flat up to ≈ 300 req/s, 224 ms at 400 and 2 s at 500, while the CPU is far from full. Little's Law: 10 connections ÷ ≈ 20 ms per query ≈ 480 queries/s. Find the knee, then move it past 600 req/s.

- **Lesson:** The knee often comes from a pool, not from the CPU: with c connections and S seconds per query a pool serves at most c ÷ S queries/s (Little's Law). Measure the knee, explain it, then move it.
- **Setup:** `boxoffice-pool` · profile `breakpoint` · target 150 req/s · 100% reads · seed 2002 · chaos `off`
- **Goals:** breaking point ≥ 550 req/s · p99 < 500 ms
- **Try:** Press ▶ (profile breakpoint, like stress.js) and read the breaking point and the reason of the bottleneck. Raise the connections of catalog-db to 30 and run again with the same seed.
- **Observe:** As drawn, the run breaks at ≈ 530 req/s and the bottleneck is catalog-db by connections while the catalog CPU is below 70%. With 30 connections the ramp reaches 600 req/s without breaking (p99 ≈ 70 ms) and the catalog CPU becomes the next limit. The Playground holds the query time at about 20 ms, so it plays the case where the pool is the narrowest pipe. In the real lab the queries slow down as PostgreSQL's CPU fills (lab 3 saw `db` at ~670%), and the knee may barely move: step 6 of the lab tells which case you are in.
- **Related:** [Estimation](../../2027.1/classes/estimation/index.md) · [Performance engineering](../../2027.1/classes/performance/index.md) · [Lab 2](../../2027.1/hands-on/2/index.md)

<div class="sdp" data-scenario="boxoffice-pool" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. With 10 connections and ≈ 20 ms per query, what throughput does Little's Law allow? Compare it with the knee you measured.
    2. Why can raising the pool too much hurt the database instead of helping?
    3. Which metric in the lab shows the threads waiting for a connection?

## BoxOffice lab 3: the edge (Nginx), replicas and limit_req { #boxoffice-edge }

Lab 3: Nginx in front of the catalog. 400 req/s of fans, plus one greedy API key that sends twice that, on a single catalog replica (≈ 500 req/s). At t = 80 s a replica is stopped for 20 s (docker stop catalog-2). Keep p99 under 300 ms (the lab's capacity criterion) and errors under 1%.

- **Lesson:** Replicas behind a reverse proxy give capacity and survive a stopped replica only if the proxy detects it fast; a per-client rate limit keeps one greedy client from using the headroom kept for failures.
- **Setup:** `boxoffice-edge` · profile `load` · target 400 req/s · 95% reads · seed 2003 · chaos `off` · scripted events: t = 80 s — docker stop catalog-2 (20 s)
- **Goals:** error rate < 1% · p99 < 300 ms
- **Try:** Raise the catalog to 3 replicas and run: the stop at t = 80 s still hurts. Connect a Health Check to the edge, then set a rate limit on it.
- **Observe:** As drawn, ≈ 64% of the requests fail (one replica for 1 200 req/s). With 3 replicas, the health check and a 600 req/s limit, errors fall to ≈ 0.7% (only the 3 s needed to detect the stopped replica) and p99 to ≈ 33 ms; the limit cuts only the greedy key.
- **Related:** [Traffic & edge](../../2027.1/classes/edge/index.md) · [Lab 3](../../2027.1/hands-on/3/index.md)

<div class="sdp" data-scenario="boxoffice-edge" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. Without the rate limit, why do 3 replicas fail when one of them stops?
    2. Nginx counts limit_req per key: what changes if the limit is counted per edge replica instead?
    3. What does max_fails=3 fail_timeout=10s cost a fan whose request hit the stopped replica?

## BoxOffice lab 4: the login rush at the gateway { #boxoffice-gateway }

Lab 4: the gateway validates JSON Web Tokens (JWTs, signed with RS256) by itself, so only logins reach auth — and a login is expensive on purpose: BCrypt cost 10, ≈ 80 ms of CPU, so one auth replica does 10 logins/s at 80% CPU and collapses at 20/s. 200 req/s with 5% logins; at t = 60 s everybody logs in before the sale (3× for 30 s). The gateway waits 5 s and retries once.

- **Lesson:** Expensive work by design (password hashing) must be sized for the peak. A gateway that validates tokens by itself keeps auth out of every request, and retries after a timeout add load where it already hurts.
- **Setup:** `boxoffice-gateway` · profile `spike` · target 200 req/s · spike ×3 · 95% reads · seed 2004 · chaos `off`
- **Goals:** error rate < 1% · p99 < 500 ms
- **Try:** Run it and watch auth during the spike (t = 60–90 s). Raise its replicas until ρ stays below ≈ 0.7 at 30 logins/s.
- **Observe:** As drawn, auth goes above ρ = 2 during the rush, logins wait up to the 5 s timeout and ≈ 3.8% of all requests fail. With 4 auth replicas no request fails and p99 is ≈ 115 ms.
- **Related:** [Traffic & edge](../../2027.1/classes/edge/index.md) · [Compute & services](../../2027.1/classes/compute/index.md) · [Lab 4](../../2027.1/hands-on/4/index.md)

<div class="sdp" data-scenario="boxoffice-gateway" data-mode="compact" data-height="440"></div>

??? question "Questions to discuss"

    1. Why is it a bad idea to lower the BCrypt cost to survive the rush?
    2. What would happen if the gateway called auth to validate every token?
    3. Could the rush be spread instead (log in before 10:00, longer token TTL)? What does the 1 h JWT_TTL of the lab allow?

## BoxOffice lab 5: cache-aside on Redis { #boxoffice-cache }

Lab 5: event pages are read ~100× more than they change. 1 500 req/s (the top of the lab's sweep) through the edge and four catalog replicas: the replicas are fine, catalog-db is not. Add Redis with cache-aside (event TTL 60 s). At t = 100 s Redis restarts empty: does the database survive the stampede?

- **Lesson:** Cache-aside cuts the database load to the misses; an empty cache after a restart sends every read back at once, and a per-key lock (request coalescing) is what keeps that stampede from taking the database down.
- **Setup:** `boxoffice-cache` · profile `load` · target 1,500 req/s · 99% reads · seed 2005 · chaos `off` · scripted events: t = 100 s — Redis restarts empty
- **Goals:** p99 < 200 ms · error rate < 0.5%
- **Try:** Add a Cache between the catalog and the database, run, and watch t = 100 s. Then turn coalescing off and on and compare the seconds after the restart.
- **Observe:** As drawn, catalog-db is above capacity: ≈ 35% errors and p99 ≈ 2 s. With Redis (80% hits, coalescing on) the database takes ≈ 300 queries/s, nothing fails and p99 is ≈ 30 ms, also after the restart; without coalescing the restart brings errors back for several seconds.
- **Related:** [Caching](../../2027.1/classes/caching/index.md) · [Lab 5](../../2027.1/hands-on/5/index.md)

<div class="sdp" data-scenario="boxoffice-cache" data-mode="compact" data-height="440"></div>

??? question "Questions to discuss"

    1. How does the TTL (60 s) relate to the hit ratio and to the staleness a fan can see?
    2. Why does the lab add a 10% jitter to the TTL?
    3. Which data of BoxOffice must never be cached (think of holds)?

## BoxOffice lab 6: the replica that lies { #boxoffice-read-your-writes }

Lab 6: inventory writes holds to the primary and reads them back from a replica that applies the log 1 s late (REPLICA_DELAY=1s). 200 req/s, half holds and half "my holds" reads: a fan who has just held a seat does not see it. At t = 90 s the primary dies and the replica is promoted after 30 s: the holds still inside the lag are gone.

- **Lesson:** Asynchronous replicas lag: reads after a write may be stale, and a failover loses the writes inside the lag (≈ write rate × lag). Reading your writes from the primary fixes the first; synchronous replication fixes the second, and every write then waits for the replica.
- **Setup:** `boxoffice-read-your-writes` · profile `load` · target 200 req/s · 50% reads · seed 2006 · chaos `off` · scripted events: t = 90 s — the primary of inventory-db dies
- **Goals:** stale reads < 1% · lost writes < 1
- **Try:** Run it and read stale reads and lost writes in the Report. Set Reads from = primary; then switch the replication to sync and compare the write p99.
- **Observe:** As drawn, ≈ 20% of the reads are stale and ≈ 105 holds are lost when the primary dies (100 writes/s × 1 s). Primary reads with sync replication bring both to 0, but the write p99 goes from ≈ 35 ms to ≈ 1 s, and during the 30 s failover the reads fail too (availability ≈ 80% instead of 90%): consistency costs latency and availability.
- **Related:** [Databases](../../2027.1/classes/databases/index.md) · [Lab 6](../../2027.1/hands-on/6/index.md)

<div class="sdp" data-scenario="boxoffice-read-your-writes" data-mode="compact" data-height="440"></div>

??? question "Questions to discuss"

    1. Why does the apply delay (REPLICA_DELAY in the lab) make the problem visible, and what causes lag in production?
    2. Which reads of BoxOffice may be stale (event pages) and which may not (my holds, the seat I just paid)?
    3. Could you read from the primary only for a short time after each write? What does it cost?

## BoxOffice lab 7: the outbox and Kafka { #boxoffice-outbox }

Lab 7: today order calls notification synchronously, and notification sends each e-mail in 50 ms with 3 consumers: at most 60 e-mails/s. orders-load.js sends 50 orders/s; at t = 60 s a burst of 200/s lasts 30 s. The buyer waits for the e-mail and fails when it cannot be sent. Keep orders under 200 ms and let the e-mails catch up within a minute.

- **Lesson:** A synchronous call makes the buyer wait for (and fail with) the slowest consumer. With an outbox and Kafka the order answers after its own transaction; consumers drain at their own pace, and their parallelism is capped by the number of partitions.
- **Setup:** `boxoffice-outbox` · profile `spike` · target 50 req/s · spike ×4 · 0% reads · seed 2007 · chaos `off`
- **Goals:** error rate < 0.5% · p99 < 200 ms · consumer lag < 60 s
- **Try:** Replace order → notification by order → Kafka (6 partitions) → notification and run with 3 consumers; then try 6 and 12.
- **Observe:** As drawn, the burst overloads notification: ≈ 35% of the orders fail and p99 reaches ≈ 4 s. With Kafka and 6 consumers nothing fails, p99 is ≈ 40 ms and the e-mails catch up with ≈ 30 s of lag; with 3 consumers the lag passes 60 s, and 12 consumers lag exactly like 6.
- **Related:** [Messaging](../../2027.1/classes/messaging/index.md) · [Lab 7](../../2027.1/hands-on/7/index.md)

<div class="sdp" data-scenario="boxoffice-outbox" data-mode="compact" data-height="440"></div>

??? question "Questions to discuss"

    1. Why does the order write the event to an outbox table instead of publishing to Kafka inside its request?
    2. With at-least-once delivery, what keeps a fan from receiving the same e-mail twice?
    3. Inject a crash on notification (⚡): what happens to the backlog, and to the buyers?

## BoxOffice: how many PDF workers? { #boxoffice-tickets-pdf }

After the on-sale, 30 000 orders arrive in 3 minutes (≈ 167/s). Each ticket is rendered to a PDF in 0.4 s by a worker that takes jobs from a queue. With 20 workers (50 PDFs/s) the backlog reaches ≈ 21 000 jobs and drains in ≈ 7 minutes: fans wait for their tickets. Little's Law: busy workers = 167 × 0.4 ≈ 67. Deliver every ticket within a minute.

- **Lesson:** Workers behind a queue are sized with Little's Law: busy workers = λ × S, plus headroom. Too few workers do not fail requests; they turn into a backlog that the users feel as delay.
- **Setup:** `boxoffice-tickets-pdf` · profile `load` · target 167 req/s · 0% reads · seed 2008 · chaos `off`
- **Goals:** consumer lag < 60 s · p99 < 300 ms · error rate < 0.5%
- **Try:** Run it and watch the backlog of ticket-jobs and the consumer lag. Compute the workers for ρ ≈ 0.7 and set them.
- **Observe:** As drawn, the backlog passes 19 000 jobs and the lag ≈ 380 s, while orders stay fast (p99 ≈ 32 ms). With 95 workers the lag stays near 0, and the bill goes from ≈ 2 800 to ≈ 8 900 USD/month: an autoscaler on the lag would pay for them only during the burst.
- **Related:** [Compute & services](../../2027.1/classes/compute/index.md) · [Messaging](../../2027.1/classes/messaging/index.md)

<div class="sdp" data-scenario="boxoffice-tickets-pdf" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. How long does the backlog take to drain after the burst with 20 workers?
    2. What is an acceptable delay for a ticket PDF, and how does it change the number of workers?
    3. Why is the consumer lag a better autoscaling signal here than CPU?

## BoxOffice lab 8: the database stops, does anybody know? { #boxoffice-observability }

Lab 8: 200 req/s on the catalog (SLO 99.5% over 28 days). At t = 60 s the database is stopped; Redis still answers the hits, every miss fails. Nobody sees it: no service sends metrics (utilization shows "?"), there are no traces and no alert, so the repair takes 100 s. Wire the observability stack the lab installs (OpenTelemetry → LGTM) and let an alert shorten the repair.

- **Lesson:** You cannot repair what you do not see: metrics on every service, traces and logs show where it hurts, and an alert on the right signal shortens the repair — which is what changes availability.
- **Setup:** `boxoffice-observability` · profile `load` · target 200 req/s · 99% reads · seed 2012 · chaos `off` · scripted events: t = 60 s — docker compose stop db
- **Goals:** services measured ≥ 100% · tracing ≥ 1 · availability ≥ 90%
- **Try:** Run it with god mode off: the utilizations show "?". Add Metrics and connect it to every service, add Tracing and Logs to the catalog, and connect Alerting to Metrics.
- **Observe:** As drawn, the stopped database fails the misses (≈ 20% of the reads) for 100 s: availability ≈ 87%. With the stack and the alert the outage lasts 50 s and availability is ≈ 93.5%; still far from the 99.5% SLO, which is why the next chapter (reliability) is needed.
- **Related:** [Observability](../../2027.1/classes/observability/index.md) · [Lab 8](../../2027.1/hands-on/8/index.md)

<div class="sdp" data-scenario="boxoffice-observability" data-mode="compact" data-height="440"></div>

??? question "Questions to discuss"

    1. How much of the 28-day error budget of a 99.5% SLO does this outage burn?
    2. Why does the lab alert on the burn rate (14.4× and 6×) and not on "error rate > 1%"?
    3. Which signal would show the stopped database first: catalog errors, Redis misses or database connections?

## BoxOffice lab 9: payment turns slow { #boxoffice-payment }

Lab 9: pay-under-chaos.js sends 20 payments/s and 20 browse requests/s to order, which has 50 Tomcat threads. At t = 60 s Toxiproxy adds 3 s to every call to payment (the provider is slow, as at 10:02 in the story). Nothing is down, but 20 payments/s × 3 s = 60 calls in flight > 50 threads: browsing, which never touches the provider, dies too. Protect order the way the lab does.

- **Lesson:** A slow dependency is worse than a dead one: every waiting call holds a thread (Little's Law), and the pool runs out for requests that never touch it. Timeouts, a circuit breaker and a bulkhead confine the damage to the calls that need the dependency.
- **Setup:** `boxoffice-payment` · profile `load` · target 40 req/s · 50% reads · seed 2009 · chaos `off` · scripted events: t = 60 s — Toxiproxy: +3 s on every call to payment
- **Goals:** p99 < 1,500 ms · error rate < 25%
- **Try:** Run it and watch the threads of order during the incident. Configure the edge order → payment with the lab's values, one pattern at a time.
- **Observe:** As drawn, the 50 threads of order are full from t ≈ 60 s, browsing waits as long as paying and p99 reaches ≈ 24 s. With timeout, retries, breaker and bulkhead the breaker opens within seconds, payments fail fast (≈ 21% of the run), browsing stays fast and p99 is ≈ 0.8 s.
- **Related:** [Reliability](../../2027.1/classes/reliability/index.md) · [Lab 9](../../2027.1/hands-on/9/index.md)

<div class="sdp" data-scenario="boxoffice-payment" data-mode="compact" data-height="460"></div>

??? question "Questions to discuss"

    1. Compute the calls in flight with Little's Law before and during the incident.
    2. Why do 3 attempts with a 1 s timeout not make things worse here, and when would they (see retry-storm)?
    3. Instead of failing, the order could answer "payment pending, we will confirm by e-mail": what would that require?

## BoxOffice lab 10: the HPA arrives late { #boxoffice-hpa }

Lab 10: the catalog runs on kind (2 workers) with 2 pods and an HPA: min 2, max 8, target 60% CPU; a pod does ≈ 500 req/s and needs ≈ 40 s to become ready. 300 req/s before the sale; at t = 60 s catalog-hpa.js pushes 1 000 req/s. The HPA looks every 15 s, the new pods start 40 s later, and meanwhile 2 pods at 100% drop requests.

- **Lesson:** Reactive autoscaling arrives after the decision period plus the startup time; for a load that comes at a known time, scale ahead (a higher minimum or a schedule) and let the HPA handle the surprises.
- **Setup:** `boxoffice-hpa` · profile `load` · target 300 req/s · 99% reads · seed 2010 · chaos `off` · scripted events: t = 60 s — the sale ramp: 1 000 req/s
- **Goals:** error rate < 0.5% · p99 < 500 ms
- **Try:** Run it and watch the pods of catalog and the Events tab (scale decisions). Raise the HPA minimum to 4 and compare.
- **Observe:** As drawn, 2 pods are at 100% when the ramp arrives; the HPA adds pods from t = 75 s, they serve 40 s later, and p99 reaches ≈ 960 ms. With a minimum of 4 the catalog stays at ≈ 50% and p99 at ≈ 24 ms, at the same illustrative cost (the kind nodes are paid anyway).
- **Related:** [Cloud-native platforms](../../2027.1/classes/cloud-native/index.md) · [Lab 10](../../2027.1/hands-on/10/index.md)

<div class="sdp" data-scenario="boxoffice-hpa" data-mode="compact" data-height="460"></div>

??? question "Questions to discuss"

    1. Add the decision period and the startup time: how many seconds of overload does the ramp cause?
    2. What would a startup of 120 s (a heavy JVM image) do?
    3. When is a higher minimum wasteful, and what would you use instead?

## BoxOffice lab 11: a bad release, all at once or as a canary { #boxoffice-canary }

Lab 11: release v2 of the catalog has a bug: 30% of its answers fail. Today it replaces all 4 pods at once; Argo CD notices nothing and the analysis rolls it back after about a minute. 600 req/s; v2 goes live at t = 60 s. Ship it so that the same bug costs a fraction of the errors.

- **Lesson:** A canary does not prevent a bad release; it limits who sees it. Errors ≈ share of the new version × its error rate × time until the rollback, so a small first step and a fast automated analysis matter.
- **Setup:** `boxoffice-canary` · profile `load` · target 600 req/s · 95% reads · seed 2011 · chaos `off` · scripted events: t = 60 s — v2 goes live (30% errors) until the rollback
- **Goals:** error rate < 5% · p99 < 300 ms
- **Try:** Run it and read the errors after t = 60 s. Draw the canary: a node "catalog v1" with 3 pods next to v2 with 1 pod, both behind the ingress.
- **Observe:** As drawn, ≈ 30% of the requests fail for a minute (≈ 12% of the run). With 25% of the traffic on v2, ≈ 7.5% fail for the same minute (≈ 3% of the run). A first step of 5% would cut it again.
- **Related:** [Cloud-native platforms](../../2027.1/classes/cloud-native/index.md) · [Lab 11](../../2027.1/hands-on/11/index.md)

<div class="sdp" data-scenario="boxoffice-canary" data-mode="compact" data-height="440"></div>

??? question "Questions to discuss"

    1. How long does the analysis of the lab (every 30 s, failureLimit 1) take to abort the rollout?
    2. Why does the course freeze changes 30 minutes before an on-sale?
    3. What kind of bug would a canary at 25% not catch in 2 minutes?

## BoxOffice lab 12: the seat assistant { #boxoffice-assistant }

Lab 12: fans ask "two seats under R$ 300 on Saturday?". The assistant runs up to MAX_STEPS = 4 model calls per question, reads the catalog and the seat map through tools and retrieves 5 passages from pgvector. The local model answers one call in ≈ 3 s and takes ≈ 1 call/s; at 0.5 questions/s the agent loop already needs 2 calls/s, and nothing screens what fans type.

- **Lesson:** In an agent, model calls = questions × steps: steps decide latency, cost and whether the provider throttles you. Fewer steps, a semantic cache and a fallback model keep it up; guardrails in the path keep it safe.
- **Setup:** `boxoffice-assistant` · profile `load` · target 0.5 req/s · 100% reads · seed 2013 · chaos `off`
- **Goals:** error rate < 1% · p99 < 25,000 ms · unsafe answers < 0.1%
- **Try:** Run it and read the bottleneck (the model's quota). Lower the steps, turn on the semantic cache and the fallback model, and put a Safety Mesh in front of the assistant.
- **Observe:** As drawn, ≈ 97% of the questions fail on the quota, p99 is ≈ 27 s and 2% of the answers are unsafe. With 2 steps, 20% cache hits, the fallback and the guardrails, errors are ≈ 0.25%, p99 ≈ 20 s and unsafe answers ≈ 0.04%.
- **Related:** [AI systems](../../2027.1/classes/ai-systems/index.md) · [Lab 12](../../2027.1/hands-on/12/index.md)

<div class="sdp" data-scenario="boxoffice-assistant" data-mode="compact" data-height="460"></div>

??? question "Questions to discuss"

    1. How many model calls per second does 0.5 question/s need with 4 steps, and with 2?
    2. What does the fallback to a bigger hosted model cost, compared with the local model?
    3. Which tools may the assistant call, and why only read-only ones?

## BoxOffice lab 13: build agents share the fans' LLM quota { #boxoffice-shared-llm }

Lab 13 and class 14: the same LLM gateway (10 calls/s) serves the fans' assistant (1 question/s × 3 steps) and the continuous integration (CI) agents: a batch of 100 pull-request reviews and fix agents (6 turns each) starts every 2 minutes within 10 s: 600 model calls in 10 s. When the batch lands, fans get 429s. Keep the fans' errors under 1% without buying a bigger quota.

- **Lesson:** A shared LLM quota is shared infrastructure: a batch of background agents can starve the interactive users. Queue the work that can wait and cap its concurrency (or give it its own quota): a bulkhead for model calls.
- **Setup:** `boxoffice-shared-llm` · profile `load` · target 1 req/s · 100% reads · seed 2014 · chaos `off`
- **Goals:** error rate < 1% · consumer lag < 300 s
- **Try:** Run it and look at the errors when each CI batch starts (t = 0 and 120 s). Put a Message Queue between the scheduler and the CI agents and limit the agents' threads.
- **Observe:** As drawn, the fans get 429s while each batch runs: ≈ 3.8% of their questions fail. With the queue and 6 concurrent agents the fans see ≈ 0.02% errors, and the CI batch finishes within ≈ 160 s of lag.
- **Related:** [AI-assisted delivery](../../2027.1/classes/ai-delivery/index.md) · [Lab 13](../../2027.1/hands-on/13/index.md)

<div class="sdp" data-scenario="boxoffice-shared-llm" data-mode="compact" data-height="440"></div>

??? question "Questions to discuss"

    1. How many model calls per second does the batch need if it starts in 10 s? And spread over 2 minutes?
    2. Who should get priority when the quota is short, and how would the gateway enforce it?
    3. What do the lab's caps (25 turns, US$ 1.50 per fix agent) protect?

## More case studies { #more-case-studies }

Two case studies of the course that have no generic scenario above.

## Ticketing: 2 M fans, 60 k seats { #ticketing }

The case study: 2 million fans arrive in 120 s for 60 000 seats. Each fan joins (≈ 17 000 joins/s) and then polls its position every 10 s (≈ 200 000 polls/s); the payment provider takes 2 s. With no line, ≈ 200 000 req/s hit 40 sale servers and one inventory database. Keep the hold p99 under 300 ms.

- **Lesson:** A ticket sale is a line problem: answer the polls from the edge, put the joins in a waiting room and admit shoppers at the rate the inventory and the payment provider can take.
- **Setup:** `ticketing` · profile `load` · target 217,000 req/s · 92% reads · seed 2015 · chaos `off`
- **Goals:** error rate < 1% · p99 < 300 ms
- **Try:** Run it, then build the solution in two steps: a CDN for the polls (filter read to a status service) and a waiting room for the joins (filter write) drained by shopper workers.
- **Observe:** As drawn, ≈ 99% of the requests fail and the inventory database is the bottleneck. With the CDN (98% hits on 1 KB polls) and the waiting room, nothing fails and p99 is ≈ 40 ms; ≈ 33 shoppers/s reach the database and ≈ 70 payment calls are in flight. The cost tile extrapolates the peak to a whole month, so it is far above what a 2-minute sale costs.
- **Related:** [Case study: ticketing](../../2027.1/classes/case-studies/ticketing/index.md) · [Messaging](../../2027.1/classes/messaging/index.md) · [Traffic & edge](../../2027.1/classes/edge/index.md)

<div class="sdp" data-scenario="ticketing" data-mode="compact" data-height="480"></div>

??? question "Questions to discuss"

    1. Derive the admission rate from 10 000 active shoppers and 300 s per shopper.
    2. How long does the last of the 2 M fans wait, and what should the page tell those beyond the 60 000 seats?
    3. What stops bots from joining the line many times?

## Distributed cache: memory or throughput? { #distributed-cache }

The case study: 1 billion items of 1 KB, 2 million reads/s, 95% hits. 1.1 TB fits in 17 nodes of 64 GB — but one node serves 80 000 ops/s, so 17 nodes give 1.36 M ops/s. Behind the cache, the database takes the misses: 100 000 req/s at 95%, twice that at 90%. Serve 2 M reads/s with p99 under 10 ms.

- **Lesson:** A cache cluster is sized by the larger of memory and throughput, with headroom and copies; its hit ratio sizes the database behind it.
- **Setup:** `distributed-cache` · profile `load` · target 2,000,000 req/s · 100% reads · seed 2016 · chaos `off`
- **Goals:** error rate < 0.5% · p99 < 10 ms
- **Try:** Run it with 17 nodes (sized by memory), then raise the nodes. Finally lower the hit ratio to 0.90 and watch the database.
- **Observe:** As drawn, the cache runs at ρ ≈ 1.5: ≈ 32% errors and p99 ≈ 580 ms. With 50 nodes nothing fails, p99 is ≈ 5 ms and the database takes ≈ 100 000 req/s (the 5% misses).
- **Related:** [Case study: distributed cache](../../2027.1/classes/case-studies/distributed-cache/index.md) · [Caching](../../2027.1/classes/caching/index.md)

<div class="sdp" data-scenario="distributed-cache" data-mode="compact" data-height="420"></div>

??? question "Questions to discuss"

    1. How many nodes are needed by memory and by throughput, and why does the case end with 50?
    2. Losing 1 of 25 nodes adds ≈ 80 000 misses/s: can the database take them?
    3. Why does consistent hashing matter when a node is added or lost?
