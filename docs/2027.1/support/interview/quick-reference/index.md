# Quick reference

One page to review before an interview: the numbers, the formulas, one line and one trade-off for each component of the palette, the default moves for each shape of problem, and the phrases that help or hurt. Everything here is explained in the classes; follow the links when a line is not obvious to you anymore. For the full tables and sources, see the [numbers cheat sheet](../../../reference/numbers/index.md) and the [component catalog](../../../reference/components/index.md).

## Numbers to know

### Latency ladder

Classic values popularized by Jeff Dean and Peter Norvig, rounded; modern hardware is faster on some rows (NVMe SSDs, newer CPUs), but the **ratios** are what you reason with[^1].

| Operation | ≈ Time | Think of it as |
|---|---|---|
| L1 cache reference | 0.5–1 ns | free |
| Main memory reference | 100 ns | 200× L1 |
| Compress 1 KB (fast codec) | ≈ 3 µs | |
| Send 1 KB over a 1 Gbps network | 10 µs | |
| Random 4 KB read from SSD | ≈ 20–150 µs | NVMe at the low end |
| Read 1 MB sequentially from memory | ≈ 50–250 µs | |
| Round trip within the same datacenter | ≈ 0.5 ms | 500 µs |
| Read 1 MB sequentially from SSD | ≈ 1 ms | |
| Disk (HDD) seek | ≈ 10 ms | avoid on hot paths |
| Round trip between AZs of a region | ≈ 1–2 ms | ≈ illustrative |
| Round trip São Paulo ↔ US East | ≈ 100–150 ms | ≈ illustrative; light in fiber ≈ 200 km/ms |
| Round trip across the globe | ≈ 150–300 ms | |

Typical service-level numbers (≈ illustrative): Redis GET ≈ 0.2–1 ms over the network; indexed SQL query ≈ 1–10 ms; app server request ≈ 10–50 ms; LLM answer ≈ 1–10 s (time to first token 0.2–2 s).

### Rate conversions

| Per day | Per second (average) | Remember |
|---|---|---|
| 1 million | ≈ 12 | 1 day ≈ 86,400 s ≈ 10⁵ s |
| 10 million | ≈ 115 | |
| 100 million | ≈ 1,150 | |
| 1 billion | ≈ 11,500 | |

Peak = average × peak factor (2–5× for diurnal traffic; 10–100× or more for a flash sale or a viral event). A month ≈ 2.6 × 10⁶ s; a year ≈ 3.2 × 10⁷ s.

### Sizes

| Thing | ≈ Size |
|---|---|
| 2¹⁰ / 2²⁰ / 2³⁰ / 2⁴⁰ | ≈ 10³ (KB) / 10⁶ (MB) / 10⁹ (GB) / 10¹² (TB) |
| ASCII character / UTF-8 character | 1 B / 1–4 B |
| int64, timestamp | 8 B |
| UUID | 16 B binary, 36 B as text |
| A short post or order row with metadata | ≈ 0.3–1 KB |
| A compressed photo | ≈ 100 KB – 2 MB |
| 1 minute of 1080p video at ~5 Mbps | ≈ 40 MB |
| An embedding of 1,536 float32 | ≈ 6 KB |

### Availability (the nines)

| Availability | Downtime per year | per 30-day month | per day |
|---|---|---|---|
| 99% | ≈ 3.65 days | ≈ 7.2 h | ≈ 14.4 min |
| 99.9% | ≈ 8.76 h | ≈ 43.2 min | ≈ 1.44 min |
| 99.95% | ≈ 4.38 h | ≈ 21.6 min | ≈ 43 s |
| 99.99% | ≈ 52.6 min | ≈ 4.3 min | ≈ 8.6 s |
| 99.999% | ≈ 5.3 min | ≈ 26 s | ≈ 0.86 s |

## Formulas

| Formula | Use it to… | Example |
|---|---|---|
| **Little's Law** L = λ × W | Size thread pools, connections, queues | 1,000 req/s × 0.2 s = 200 in flight |
| **Utilization** ρ = λ / μ | Check headroom; keep ρ below the knee (≈ 0.7–0.8) | 700 req/s on capacity 1,000 ⇒ 0.7 |
| **M/M/1 time in system** W = S / (1 − ρ) | See why latency explodes near saturation | S = 10 ms: ρ 0.5 ⇒ 20 ms; ρ 0.9 ⇒ 100 ms |
| **Servers needed** = peak QPS / (QPS per server × target ρ) | Capacity planning | 7,000 / (500 × 0.7) ≈ 20 servers |
| **Series availability** A = A₁ × A₂ × … | Synchronous chain of dependencies | 0.999³ ≈ 99.7% |
| **Parallel availability** A = 1 − (1 − A₁)(1 − A₂)… | Redundant replicas | two at 99% ⇒ 99.99% |
| **Cache: database load** = λ × (1 − h) | Value of the hit ratio | 10,000 req/s, h = 0.95 ⇒ 500 req/s |
| **Cache: average latency** ≈ h × t_cache + (1 − h) × t_db | Expected latency with a cache | 0.95 × 1 + 0.05 × 20 = 1.95 ms |
| **Fan-out tail** P(slow) = 1 − (1 − p)ⁿ | Why p99 matters with fan-out | p = 1%, n = 100 ⇒ 63% |
| **Quorum** R + W > N | Read sees the latest write | N = 3, W = 2, R = 2 |
| **Consensus fault tolerance** n = 2f + 1 | Nodes needed to survive f failures | 5 nodes tolerate 2 |
| **Amdahl** speedup = 1 / ((1 − p) + p / n) | Limit of parallelization | p = 0.9, n = 10 ⇒ 5.3× |
| **Error budget** = (1 − SLO) × window | How much unreliability you may spend | 99.9% over 28 days ⇒ 40 min |
| **Burn rate** = error rate / (1 − SLO) | Alert on fast budget consumption | 1.44% errors on 99.9% ⇒ 14.4 |

Classes: [Estimation › Numbers](../../../classes/estimation/numbers/index.md) · [Queueing](../../../classes/estimation/queueing/index.md) · [Percentiles](../../../classes/estimation/percentiles/index.md) · [Availability math](../../../classes/estimation/availability-math/index.md).

## Components in one line

The trade-off column is what turns a component name into an argument.

### Client

| Id | Component | One line | Trade-off to mention |
|---|---|---|---|
| `client` | [Client](../../../reference/components/client/index.md#client) | Browser or program that sends requests | Retries and timeouts in the client shape your load; never trust client input |
| `mobile` | [Mobile](../../../reference/components/client/index.md#mobile) | App on flaky networks, offline, slow to update | Old app versions live for months: version the API, keep it backward compatible |

### Traffic & Edge

| Id | Component | One line | Trade-off to mention |
|---|---|---|---|
| `dns` | [DNS](../../../reference/components/edge/index.md#dns) | Names to IPs; geo, weighted and failover routing | Cached answers: low TTL = agility but more queries; never fast failover |
| `cdn` | [CDN](../../../reference/components/edge/index.md#cdn) | Caches content near users | Huge offload vs staleness; only for shareable, cacheable content |
| `lb` | [Load Balancer](../../../reference/components/edge/index.md#lb) | Spreads requests over healthy replicas | L7 features vs L4 speed; must itself be redundant |
| `waf` | [WAF](../../../reference/components/edge/index.md#waf) | Filters malicious traffic and bots | Blocks attacks vs false positives on real fans |
| `apigw` | [API Gateway](../../../reference/components/edge/index.md#apigw) | Auth, rate limiting, routing at the front door | Central policy vs an extra hop and a shared dependency |
| `ingress` | [Ingress](../../../reference/components/edge/index.md#ingress) | Routes external HTTP into Kubernetes | Simple config vs fewer features than a full gateway (Gateway API) |

### Compute

| Id | Component | One line | Trade-off to mention |
|---|---|---|---|
| `app` | [App Server](../../../reference/components/compute/index.md#app) | Stateless replicas running business logic | Horizontal scale requires state elsewhere |
| `worker` | [Worker](../../../reference/components/compute/index.md#worker) | Drains queues in the background | Fast responses vs eventual completion and retries to handle |
| `serverless` | [Serverless](../../../reference/components/compute/index.md#serverless) | Functions scaled per request | No servers, scale to zero vs cold starts, limits, DB connection storms |
| `auth` | [Auth Service](../../../reference/components/compute/index.md#auth) | Authenticates users, issues tokens | Stateless JWT validation vs hard revocation |
| `search` | [Search](../../../reference/components/compute/index.md#search) | Full-text search on an inverted index | Rich queries vs an eventually consistent copy of the data |
| `scheduler` | [Scheduler](../../../reference/components/compute/index.md#scheduler) | Runs jobs on a schedule | Must run once: leader election or locks, idempotent jobs |
| `notifications` | [Notifications](../../../reference/components/compute/index.md#notifications) | Email/push/SMS through providers, async | Reliability via queues and retries vs duplicates (dedupe) |
| `analytics` | [Analytics](../../../reference/components/compute/index.md#analytics) | Collects and aggregates events | Off the request path; freshness vs cost |

### Storage

| Id | Component | One line | Trade-off to mention |
|---|---|---|---|
| `sql` | [SQL Database](../../../reference/components/storage/index.md#sql) | Relational data with transactions | Strong consistency and joins vs harder horizontal write scaling |
| `nosql` | [NoSQL DB](../../../reference/components/storage/index.md#nosql) | Partitioned key-value/document/wide-column | Scale and availability vs query flexibility; design around access patterns |
| `cache` | [Cache](../../../reference/components/storage/index.md#cache) | In-memory hot data | Latency and DB offload vs staleness, invalidation, stampedes |
| `objstore` | [Object Store](../../../reference/components/storage/index.md#objstore) | Cheap, durable files and media | Very durable and cheap vs higher latency, no in-place updates |
| `dwh` | [Data Warehouse](../../../reference/components/storage/index.md#dwh) | Columnar analytics over history | Fast scans and aggregates vs not for transactions; data is minutes–hours behind |
| `vectordb` | [Vector DB](../../../reference/components/storage/index.md#vectordb) | Nearest-neighbor search on embeddings | Semantic recall vs approximate results and index memory |

### Messaging

| Id | Component | One line | Trade-off to mention |
|---|---|---|---|
| `queue` | [Message Queue](../../../reference/components/messaging/index.md#queue) | Each message to one consumer | Absorbs spikes vs async latency and at-least-once duplicates |
| `pubsub` | [Pub/Sub](../../../reference/components/messaging/index.md#pubsub) | Each message to every subscriber | Decoupled fan-out vs no replay (usually) and harder tracing |
| `stream` | [Event Stream](../../../reference/components/messaging/index.md#stream) | Ordered, retained, partitioned log | Replay and ordering per key vs partition planning and consumer lag |
| `kafka` | [Kafka](../../../reference/components/messaging/index.md#kafka) | The reference event-streaming platform | Throughput and retention vs operational weight; parallelism ≤ partitions |

### Observability

| Id | Component | One line | Trade-off to mention |
|---|---|---|---|
| `metrics` | [Metrics](../../../reference/components/observability/index.md#metrics) | Time series: RED, USE, SLIs | Cheap aggregates vs cardinality limits; no per-request detail |
| `logs` | [Logs](../../../reference/components/observability/index.md#logs) | Structured event records | Detail vs volume and cost; never log secrets |
| `tracing` | [Tracing](../../../reference/components/observability/index.md#tracing) | One request across services | Finds where time goes vs sampling may miss rare cases |
| `alerting` | [Alerting](../../../reference/components/observability/index.md#alerting) | Pages humans on symptoms | Fast detection vs alert fatigue; page on SLO burn |
| `healthcheck` | [Health Check](../../../reference/components/observability/index.md#healthcheck) | Liveness/readiness probes | Fast removal of bad replicas vs restart storms if liveness checks dependencies |

### Network

| Id | Component | One line | Trade-off to mention |
|---|---|---|---|
| `vpc` | [VPC](../../../reference/components/network/index.md#vpc) | Private network in a region | Isolation by default; plan non-overlapping ranges |
| `subnet` | [Subnet](../../../reference/components/network/index.md#subnet) | Public or private slice in one AZ | Spread across AZs for availability vs cross-AZ traffic cost |
| `nat` | [NAT Gateway](../../../reference/components/network/index.md#nat) | Outbound internet for private services | Keeps services private vs per-GB cost and port limits |
| `vpn` | [VPN](../../../reference/components/network/index.md#vpn) | Encrypted tunnel between networks | Private connectivity vs internet latency and limited bandwidth |
| `mesh` | [Service Mesh](../../../reference/components/network/index.md#mesh) | mTLS, retries, telemetry between services | Uniform policy without code vs latency per hop and a platform to run |

### AI & Agents

| Id | Component | One line | Trade-off to mention |
|---|---|---|---|
| `llmgw` | [LLM Gateway](../../../reference/components/ai/index.md#llmgw) | One door to model providers | Fallbacks, budgets, caching vs another hop; semantic cache can be wrong |
| `orchestrator` | [Orchestrator](../../../reference/components/ai/index.md#orchestrator) | Runs the agent loop | Flexibility vs latency and cost × number of steps |
| `toolreg` | [Tool Registry](../../../reference/components/ai/index.md#toolreg) | Tools the model may call (MCP) | Reuse and governance vs prompt bloat; authorize inside tools |
| `memory` | [Memory Fabric](../../../reference/components/ai/index.md#memory) | Retrieval (RAG) and memory | Grounded answers vs retrieval misses and stale indexes |
| `safety` | [Safety Mesh](../../../reference/components/ai/index.md#safety) | Guardrails on inputs, outputs, actions | Risk reduction vs latency and false positives; not a security boundary alone |

### External

| Id | Component | One line | Trade-off to mention |
|---|---|---|---|
| `thirdparty` | [3rd Party API](../../../reference/components/external/index.md#thirdparty) | Someone else's API | Buy vs build; contain it with timeouts, breakers, queues |
| `payment` | [Payment](../../../reference/components/external/index.md#payment) | Payment provider | Idempotency keys, webhooks and reconciliation; timeout ≠ failure |
| `email` | [Email](../../../reference/components/external/index.md#email) | Email delivery provider | Always async behind a queue; deliverability rules and quotas |

## Default moves

| If the problem is… | The standard move | Watch out for |
|---|---|---|
| Read-heavy (catalog, feed, redirects) | CDN + cache-aside + read replicas | Staleness, invalidation, stampede |
| Write-heavy (locations, clicks, metrics) | Partition by key, queue/stream, LSM/NoSQL, batch | Hot keys, ordering, consumer lag |
| Spiky (flash sale, launch) | Queue / waiting room + autoscaling + load shedding | Autoscaling is too slow for a cliff: pre-scale |
| Slow work in a request | 202 Accepted + queue + workers | Status endpoint, retries, DLQ |
| Money or inventory | Strong consistency, transactions, idempotency keys, reconciliation | Never treat a timeout as a failure |
| Global users | CDN, GeoDNS, multi-region reads | Cross-region writes: latency vs consistency |
| One celebrity / hot key | Split or replicate the key, cache it, pull for celebrities | Fan-out on write for millions of followers |
| Real time to clients | WebSockets/SSE + pub/sub between servers | Connection state, reconnection storms |
| Search / autocomplete | Inverted index or trie, fed asynchronously, cached | Index lag, ranking |
| Slow or flaky dependency | Timeout + retry with backoff and jitter + circuit breaker + bulkhead + fallback | Retry storms, non-idempotent retries |
| Unknown bottleneck | Measure: RED/USE, traces, load test to the knee | Optimizing without data |
| LLM feature | Gateway + RAG + few agent steps + guardrails + semantic cache | Cost per request, prompt injection |

## Consistency and CAP in one table

| Data | Choice | Why |
|---|---|---|
| Seat hold, balance, order status | Strong (CP), transactions | An invariant users and money depend on |
| Event description, prices on the page | Eventual, cached seconds–minutes | Staleness is harmless; reads dominate |
| View counts, likes | Eventual, approximate counters | Exactness is not worth the coordination |
| Shopping cart (Dynamo classic) | Available (AP), merge on conflict | Better to accept the item and reconcile |
| User's own profile after editing | Read-your-writes | They must see their own change |
| Chat messages in a conversation | Ordered per conversation | Global order is unnecessary |

CAP: during a **partition**, choose consistency or availability. PACELC: **else**, choose latency or consistency. Most systems choose per data item, not once. [Class 3 · CAP & PACELC](../../../classes/distributed/cap-pacelc/index.md)

## SQL or NoSQL?

| Choose SQL when… | Choose NoSQL when… |
|---|---|
| You need multi-row transactions and constraints | Access is by key and must scale writes horizontally |
| Queries are varied or ad hoc; joins matter | The schema varies per item or rows are very wide |
| Data fits a few nodes (vertical scale + replicas goes far) | Data or write volume exceeds one primary |
| Correctness beats raw throughput (orders, seats) | Availability across regions beats strong consistency |
| You are not sure yet (the safer default) | You know the access patterns well and they are few |

NewSQL (Spanner, CockroachDB) offers SQL and transactions with horizontal scale, at a cost in latency and money. [Class 6 · Data models](../../../classes/databases/models/index.md)

## Sync vs async, push vs pull

| | Synchronous call | Asynchronous (queue / event) |
|---|---|---|
| User waits for | the result | an acknowledgement |
| Coupling | caller fails when callee fails | callee can be down; work waits |
| Latency | sum of the chain | fast response, eventual completion |
| Use for | reads, decisions needed now (hold a seat) | emails, reports, fan-out, slow or spiky work |

| | Push (fan-out on write) | Pull (fan-out on read) |
|---|---|---|
| Work happens | when the item is created | when the reader asks |
| Good for | many readers, few writers per item; fast reads | celebrities with millions of followers; rarely read items |
| Cost | write amplification | slower, heavier reads |
| Usual answer | hybrid: push for most, pull for celebrities | |

## Phrases that score and phrases that hurt

| Phrases that score | Phrases that hurt |
|---|---|
| "Before I draw, can I ask about scale and what must never be wrong?" | (Silence, then twenty boxes) |
| "I'll assume 10 M DAU; that's about 2,000 req/s on average, 7,000 at peak." | "It needs to handle a lot of traffic." |
| "I chose X over Y because…; the cost is…; I'd revisit if…" | "X is the best." / "It scales." |
| "The hard part here is…, so I'd like to go deep there." | Going deep on the login page |
| "What happens if this call times out? It must be idempotent." | "We just retry." |
| "This is a single point of failure; I'd add…" | "It won't fail." |
| "I'd measure p99 and the error rate, and load-test to the knee." | "It should be fast enough." |
| "Good point — let me revisit that." | Defending a flaw the interviewer found |

[^1]: Jeff Dean, "Numbers Everyone Should Know" (talks, 2009–2010); the commonly cited table is at <https://gist.github.com/jboner/2841832>. Network round trips between regions depend on routes: measure for your providers.
