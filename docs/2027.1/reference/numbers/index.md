# Numbers to Know

A cheat sheet of the numbers behind every back-of-the-envelope estimate: sizes, latencies, throughput of common components, availability, costs and the handful of formulas that turn them into decisions. The goal is not precision — it is the **right order of magnitude, fast**, with the assumptions said out loud.

!!! warning "Read the labels"
    Three kinds of numbers live on this page. **Exact** values (powers of two, seconds in a day, nines of availability) are always true. **Classic** latency values come from well-known references[^1][^2] and are still good intuition. Everything marked **≈ illustrative** or **approximate (2026)** depends on hardware, workload, configuration and provider: use it to reason, then measure your own system (that is what [Hands-on 2](../../hands-on/2/index.md) is for) and check the providers' price calculators.

The theory behind these numbers is in [Estimation › Numbers](../../classes/estimation/numbers/index.md), [Queueing](../../classes/estimation/queueing/index.md), [Percentiles](../../classes/estimation/percentiles/index.md) and [Availability math](../../classes/estimation/availability-math/index.md). The [component catalog](../components/index.md) has key numbers per component, and the [playground](../../../playground/index.md) uses the same orders of magnitude in its defaults.

---

## Powers of two and units

| Power | Exact | ≈ Power of ten | Name | Example |
|---|---|---|---|---|
| 2^10 | 1,024 | 10^3 | KiB (kilo) | A short JSON response |
| 2^20 | 1,048,576 | 10^6 | MiB (mega) | A photo |
| 2^30 | 1,073,741,824 | 10^9 | GiB (giga) | A movie; RAM of a small VM |
| 2^40 | ≈ 1.1 × 10^12 | 10^12 | TiB (tera) | A large database |
| 2^50 | ≈ 1.1 × 10^15 | 10^15 | PiB (peta) | A big company's data lake |

- **Bits vs bytes**: networks are quoted in bits per second; 1 Gbps = 125 MB/s; 10 Gbps = 1.25 GB/s.
- **KB vs KiB**: storage vendors use powers of ten (1 KB = 1,000 B); operating systems often use powers of two (1 KiB = 1,024 B). For estimates, the 2.4% difference does not matter.
- **Shortcut**: thousand → million → billion → trillion is KB → MB → GB → TB. "1 million users × 1 KB each = 1 GB".

---

## Time

| Quantity | Exact | Rounded for estimates |
|---|---|---|
| Seconds in a minute | 60 | — |
| Seconds in an hour | 3,600 | ≈ 4 × 10^3 |
| Seconds in a day | 86,400 | **≈ 10^5** |
| Seconds in a month (30 days) | 2,592,000 | ≈ 2.5 × 10^6 |
| Seconds in a year | ≈ 31,557,600 | ≈ 3 × 10^7 (π × 10^7) |

### Requests per day → requests per second

| Per day | Average per second (÷ 86,400) | Rule of thumb (÷ 10^5) | Peak at 3× | Peak at 10× |
|---|---|---|---|---|
| 1 million | ≈ 11.6 | 10 | ≈ 35 | ≈ 116 |
| 10 million | ≈ 116 | 100 | ≈ 350 | ≈ 1,160 |
| 100 million | ≈ 1,157 | 1,000 | ≈ 3,500 | ≈ 11,600 |
| 1 billion | ≈ 11,574 | 10,000 | ≈ 35,000 | ≈ 116,000 |

!!! tip "In the interview"
    "One day is about 10^5 seconds, so 100 million requests a day is about 1,000 per second on average; I'll size for a peak of 3× unless the traffic is spiky — a flash sale is not 3×, it's 100× in one minute."

---

## Latency

### The classic table

The table popularized by Jeff Dean and Peter Norvig[^1][^2]. Hardware has changed (see the next table), but the **ratios** are what you need to remember: memory is about 1,000× faster than an SSD read, a round trip inside a data center is about 1,000× faster than a round trip across an ocean.

| Operation | Classic value | Notes |
|---|---|---|
| L1 cache reference | 0.5 ns | |
| Branch mispredict | 5 ns | |
| L2 cache reference | 7 ns | |
| Mutex lock/unlock | 25 ns | |
| Main memory reference | 100 ns | |
| Compress 1 KB with a fast compressor | 3 µs | |
| Send 1 KB over a 1 Gbps network | 10 µs | |
| Read 4 KB randomly from an SSD | 150 µs | |
| Read 1 MB sequentially from memory | 250 µs | |
| Round trip within the same data center | 500 µs | |
| Read 1 MB sequentially from an SSD | 1 ms | |
| Disk (HDD) seek | 10 ms | |
| Read 1 MB sequentially from an HDD | 20 ms | |
| Send a packet California → Netherlands → California | 150 ms | |

### 2020s approximations

Approximate (2026), for typical cloud hardware[^3]. Measure your own environment before trusting any of these to more than a factor of 2–3.

| Operation | ≈ Value | Notes |
|---|---|---|
| Main memory reference | ≈ 100 ns | Has barely changed in 15 years |
| Read 1 MB sequentially from memory | ≈ 10–50 µs | Tens of GB/s of memory bandwidth |
| NVMe SSD random 4 KB read | ≈ 10–100 µs | Cloud network-attached volumes: ≈ 0.5–2 ms |
| Read 1 MB sequentially from NVMe | ≈ 0.1–0.3 ms | ≈ 3–7 GB/s |
| Round trip inside an availability zone | ≈ 0.1–0.5 ms | |
| Round trip between AZs of one region | ≈ 1–2 ms | |
| Redis `GET` over the network (same AZ) | ≈ 0.2–1 ms | Mostly network; Redis itself is microseconds |
| Indexed lookup in PostgreSQL (row in memory) | ≈ 1–5 ms end to end | Network + parsing + execution |
| Light travels 1,000 km in fiber | ≈ 5 ms one way | ≈ 200,000 km/s in glass |
| Round trip São Paulo ↔ US East (Virginia) | ≈ 110–130 ms | Physics: ≈ 7,500 km each way |
| Round trip São Paulo ↔ Western Europe | ≈ 180–220 ms | |
| TLS handshake (new connection) | 1–2 extra round trips | Why connection reuse and edge termination matter |
| LLM time to first token (hosted model) | ≈ 0.2–2 s | ≈ illustrative; then ≈ 30–150 tokens/s |

!!! example "Why BoxOffice puts a CDN in São Paulo"
    A fan in São Paulo loading the event page from an origin in Virginia pays ≈ 120 ms per round trip; a TLS connection plus the request costs 2–3 round trips ≈ 300 ms before the first byte. From a CDN edge in São Paulo the same round trips cost ≈ 5–20 ms each.

---

## Throughput of common components

!!! warning "Order of magnitude, illustrative, depends on hardware and workload"
    These are rough per-instance figures for **simple** operations on a reasonably sized machine. Payload size, query complexity, durability settings (fsync), TLS, connection count and the client itself move them by 10× in either direction. Use them to know whether you need 1 box or 100, never as a promise. Values from vendors' documented limits are marked *documented*.

| Component | ≈ Throughput per instance | Notes |
|---|---|---|
| Nginx / Envoy (proxy, small responses) | 10^4 – 10^5 req/s | CPU and TLS bound |
| App server (CRUD with one DB call) | 10^2 – 10^4 req/s | Usually limited by the DB or by threads × latency (Little's Law) |
| PostgreSQL / MySQL, simple indexed reads | 10^4 – 10^5 queries/s | Large instance, data in memory |
| PostgreSQL / MySQL, write transactions | 10^3 – 10^4 tx/s | fsync and contention bound; one hot row: far fewer |
| Redis (single instance) | ≈ 10^5 ops/s; up to ≈ 10^6 with pipelining | Single-threaded command loop; cluster to scale |
| Memcached | 10^5 – 10^6 ops/s | Multi-threaded |
| Kafka broker | ≈ 10^5 – 10^6 small msgs/s; hundreds of MB/s | Batching and compression matter |
| RabbitMQ node | 10^4 – 10^5 msgs/s | Lower with persistence and confirms |
| Cassandra / ScyllaDB node | 10^4 – 10^5 writes/s | Scales roughly linearly with nodes |
| Elasticsearch / OpenSearch node | 10^2 – 10^4 queries/s | Depends heavily on the query |
| WebSocket server | 10^4 – 10^5+ open connections | Memory bound; mostly idle connections |
| Amazon DynamoDB partition | 3,000 read units / 1,000 write units per s | *documented* per-partition limit |
| Amazon S3 prefix | 3,500 writes / 5,500 reads per s | *documented* per prefix; add prefixes to scale |
| AWS Lambda | 1,000 concurrent executions per region | *documented* default account quota (can be raised) |
| Network link | 1 Gbps = 125 MB/s; 10 Gbps = 1.25 GB/s | Exact conversions |

---

## Storage sizes

| Item | ≈ Size | Notes |
|---|---|---|
| ASCII character | 1 B | UTF-8: 1–4 B per character |
| Integer (int32 / int64) | 4 B / 8 B | |
| UUID | 16 B binary, 36 B as text | Store binary when you can |
| Timestamp | 8 B | PostgreSQL `timestamptz` |
| A BoxOffice seat row (ids, status, hold) | ≈ 100 B | Plus index overhead |
| A user or order row | ≈ 0.5–1 KB | With a few text fields |
| A short post (280 characters + metadata) | ≈ 0.5–1 KB | |
| Structured log line | ≈ 200 B – 2 KB | |
| Embedding vector, 1,536 dims, float32 | ≈ 6 KB | dims × 4 B |
| Thumbnail | ≈ 10–50 KB | |
| Photo (JPEG / WebP) | ≈ 0.2–3 MB | |
| Web page (HTML + JSON, no images) | ≈ 50–200 KB | |
| 1 minute of video at 1 Mbps (≈ 480p) | 7.5 MB | 1 Mbps × 60 s ÷ 8 |
| 1 minute of video at 5 Mbps (≈ 1080p) | ≈ 38 MB | |
| 1 minute of video at 20 Mbps (≈ 4K) | ≈ 150 MB | |
| 1 minute of audio at 128 kbps | ≈ 1 MB | |

**Storage per year** = writes per day × size × 365 × replication factor (often 3) × growth margin. Example: 1 million orders a day × 1 KB × 365 × 3 ≈ 1.1 TB per year.

---

## Availability

| Availability | Downtime per year | per month (30.4 days) | per week | per day |
|---|---|---|---|---|
| 99% ("two nines") | 3.65 days | 7.31 hours | 1.68 hours | 14.4 min |
| 99.5% | 1.83 days | 3.65 hours | 50.4 min | 7.2 min |
| 99.9% ("three nines") | 8.77 hours | 43.8 min | 10.1 min | 1.44 min |
| 99.95% | 4.38 hours | 21.9 min | 5.04 min | 43.2 s |
| 99.99% ("four nines") | 52.6 min | 4.38 min | 1.01 min | 8.64 s |
| 99.999% ("five nines") | 5.26 min | 26.3 s | 6.05 s | 0.86 s |

Year = 365.25 days. An SLO over a 28-day window allows 0.1% × 40,320 min ≈ 40.3 min at 99.9%[^4].

**Combining components**

- **In series** (all must work): $A = A_1 \times A_2 \times \dots \times A_n$. Three services at 99.9% ⇒ ≈ 99.7%.
- **In parallel** (any one is enough): $A = 1 - (1 - A_1)(1 - A_2)\cdots$. Two replicas at 99% ⇒ 99.99% (if failures are independent — they often are not).
- **Expected availability from failure rates**: $A = \dfrac{MTTF}{MTTF + MTTR}$. Halving the time to repair is as good as doubling the time between failures.

---

## Formulas

| Formula | Meaning | Example |
|---|---|---|
| $L = \lambda W$ (Little's Law) | Items in the system = arrival rate × time in the system | 1,000 req/s × 0.2 s = 200 requests in flight ⇒ ≈ 200 threads/connections |
| $\rho = \lambda / \mu$ | Utilization = arrival rate ÷ service capacity | 800 req/s on a capacity of 1,000 ⇒ ρ = 0.8 |
| $W = \dfrac{S}{1 - \rho}$ (M/M/1) | Time in system grows without bound as ρ → 1 | S = 10 ms: ρ 0.5 ⇒ 20 ms; 0.9 ⇒ 100 ms; 0.99 ⇒ 1 s |
| Servers $= \lceil \lambda_{peak} / (\mu_{1} \cdot \rho_{target}) \rceil$ | Capacity with headroom | 7,000 req/s ÷ (1,000 × 0.7) ⇒ 10 servers (+1 for failures) |
| DB load $= \lambda (1 - h)$ | Cache misses reach the database | 10,000 req/s, h = 0.95 ⇒ 500 req/s |
| $\bar{t} = h\,t_{cache} + (1-h)\,t_{db}$ | Average latency with a cache | 0.95 × 1 ms + 0.05 × 20 ms = 1.95 ms |
| $P(\text{slow}) = 1 - (1 - p)^n$ | Fan-out tail amplification | p = 1%, n = 100 calls ⇒ 63% of requests hit a slow call |
| $R + W > N$ | Quorum reads see the latest write | N = 3, W = 2, R = 2 |
| $2f + 1$ nodes | Consensus tolerates f failures | 3 nodes tolerate 1; 5 tolerate 2 |
| Speedup $= \dfrac{1}{(1-p) + p/n}$ (Amdahl) | Parallel speedup is limited by the serial part | p = 0.9, n = 10 ⇒ ≈ 5.3×; n → ∞ ⇒ 10× |
| Error budget $= (1 - SLO) \times$ window | Unreliability you may spend | 99.9% over a rolling 28 days ⇒ 40.3 min |
| Bandwidth $= \lambda \times$ size | Bytes per second on the wire | 1,000 req/s × 100 KB = 100 MB/s = 800 Mbps |

The queueing and percentile formulas are derived (and plotted) in [Estimation › Queueing](../../classes/estimation/queueing/index.md) and [Percentiles](../../classes/estimation/percentiles/index.md).

---

## Cloud costs (illustrative)

!!! warning "Approximate, 2026, check the providers' calculators"
    Typical on-demand list prices in a US region, rounded, to compare **orders of magnitude** between design options. Real prices vary by provider, region (São Paulo is usually more expensive than US East), instance family, commitments and discounts, and they change. Use the official calculators (AWS Pricing Calculator, Google Cloud Pricing Calculator, Azure Pricing Calculator) for anything that matters.

| Item | ≈ Price | ≈ Per month |
|---|---|---|
| General-purpose VM | USD 0.04–0.05 per vCPU-hour (with ≈ 4 GB RAM per vCPU) | ≈ USD 30–35 per vCPU |
| Managed PostgreSQL, 2 vCPU / 8 GB, single AZ | USD 0.15–0.40 per hour | ≈ USD 110–300; ≈ 2× for multi-AZ |
| Managed Redis node, ≈ 6–13 GB | USD 0.15–0.35 per hour | ≈ USD 110–250 |
| Managed load balancer | ≈ USD 0.02–0.03 per hour + usage units | ≈ USD 20–40 + traffic |
| Object storage (standard tier) | ≈ USD 0.02–0.026 per GB-month | 1 TB ≈ USD 20–26 |
| Data egress to the internet | ≈ USD 0.05–0.12 per GB | 10 TB ≈ USD 500–1,200 |
| CDN delivery | ≈ USD 0.02–0.09 per GB | Falls with volume |
| Cross-AZ traffic | ≈ USD 0.01 per GB each way | Chatty services add up |
| NAT gateway | ≈ USD 0.045 per hour + ≈ USD 0.045 per GB | ≈ USD 33 + traffic |
| Serverless functions | ≈ USD 0.20 per million invocations + ≈ USD 0.0000167 per GB-second | 10 M calls × 100 ms × 512 MB ≈ USD 10 |
| Transactional email | ≈ USD 0.10 per 1,000 emails | 1 M emails ≈ USD 100 |
| LLM, small/fast models | ≈ USD 0.05–1 per million input tokens | Output tokens cost several times more |
| LLM, frontier models | ≈ USD 1–15 per million input tokens; ≈ USD 5–75 per million output tokens | Prompt caching and batch APIs cut this |

**Cost of an LLM request** ≈ input tokens × input price + output tokens × output price. 2,000 input + 300 output tokens on a model at USD 3 / USD 15 per million ≈ USD 0.006 + 0.0045 ≈ **USD 0.01 per request** — 1 million requests ≈ USD 10,000. That is why the [LLM gateway](../components/ai/index.md#llmgw) caches and routes to smaller models. More in [Cloud-native › FinOps](../../classes/cloud-native/finops/index.md).

---

## Worked example: the BoxOffice flash sale

A stadium show goes on sale at 10:00: **2 million fans, 60,000 seats**. Assumptions are said out loud and rounded; each one could be challenged by the interviewer.

| Step | Assumption | Estimate |
|---|---|---|
| Fans per seat | 2 M ÷ 60 k | ≈ 33 — most fans will not get a ticket |
| Orders | 2 seats per order on average | ≈ 30,000 orders |
| Read peak | 2 M fans refresh the event page every ≈ 15 s in the first minutes | 2 × 10^6 ÷ 15 ≈ **130,000 req/s** |
| Origin load behind a CDN | hit ratio 99% (page cached for a few seconds) | ≈ 1,300 req/s at the origin |
| Edge bandwidth | ≈ 100 KB per page view | 130,000 × 100 KB ≈ 13 GB/s ≈ 100 Gbps — a CDN job, never the origin's |
| Seat writes without a waiting room | everyone tries in the first 1–2 minutes | 60 k holds + retries in ≈ 100 s ⇒ **≈ 10^3 writes/s on the same rows** — contention |
| Waiting room admission | admit 2,000 fans per minute into checkout | ≈ 33 fans/s; at ≈ 50% conversion ≈ 1,000 orders/min ⇒ sold out in ≈ 30 min |
| Seat writes with the waiting room | 60 k holds + 60 k confirmations over ≈ 30 min | ≈ 70 writes/s — easy for one PostgreSQL primary |
| Fans inside checkout (Little's Law) | 33 fans/s × ≈ 5 min per session | ≈ 10,000 concurrent sessions; seat holds expire after 10 min |
| Payment concurrency (Little's Law) | ≈ 17 orders/s × p99 of 3 s | ≈ 50 calls in flight ⇒ a pool of ≈ 100 with headroom |
| Emails | 30 k tickets over 30 min | ≈ 17 emails/s — behind a queue, within the provider's quota |
| Storage | 30 k orders × 1 KB | ≈ 30 MB — storage is not the problem |
| CDN cost | ≈ 5 MB per fan (first load + 40 refreshes) × 2 M | ≈ 10 TB ≈ USD 200–900 (approximate, 2026) |

The estimate points straight at the design: the read spike belongs to the **CDN**, the contention belongs to a **waiting room** that turns the crowd into a steady flow, the seat itself must be a **strongly consistent** row with an atomic hold, and payment and email are **bounded, asynchronous** dependencies. The full design is in the [ticketing case study](../../classes/case-studies/ticketing/index.md); try the numbers in the [`flash-sale`](../../../playground/scenarios/index.md#flash-sale) scenario of the [playground](../../../playground/index.md).

[^1]: Jonas Bonér, "Latency Numbers Every Programmer Should Know" (compilation of values by Jeff Dean and Peter Norvig), [gist.github.com/jboner/2841832](https://gist.github.com/jboner/2841832).
[^2]: Jeff Dean, "Designs, Lessons and Advice from Building Large Distributed Systems", keynote at LADIS 2009; Peter Norvig, "Teach Yourself Programming in Ten Years", [norvig.com/21-days.html](https://norvig.com/21-days.html).
[^3]: Colin Scott, "Latency Numbers Every Programmer Should Know" (interactive, extrapolated by year), [colin-scott.github.io](https://colin-scott.github.io/personal_website/research/interactive_latency.html); cloud providers' documentation for network and storage figures.
[^4]: Betsy Beyer et al. (eds.), *Site Reliability Engineering*, O'Reilly, 2016 — Appendix A, "Availability Table", [sre.google/books](https://sre.google/books/).
