
How long does it take to read a seat from memory? From an SSD? From a database in the same data centre? From a server in Virginia, while the fan is in São Paulo? The answers span **eight orders of magnitude** — from a nanosecond to a hundred milliseconds — and most architectural rules of thumb ("cache it", "batch it", "don't call across regions synchronously") are just consequences of that spread. This page collects the numbers worth memorizing and shows how to turn them, together with a few assumptions about users, into requests per second, storage and bandwidth.

---

## Powers of two (and ten)

Data sizes are powers of two; estimates are easier in powers of ten. Since 2¹⁰ = 1,024 ≈ 10³, you can switch freely for estimation purposes:

| Power of two | Exact value | ≈ Power of ten | Unit | Something that size |
|---|---|---|---|---|
| 2¹⁰ | 1,024 | 10³ (thousand) | 1 KB | a short JSON response; a seat record ×10 |
| 2²⁰ | 1,048,576 | 10⁶ (million) | 1 MB | an event poster (compressed photo) |
| 2³⁰ | ≈ 1.07 × 10⁹ | 10⁹ (billion) | 1 GB | a year of BoxOffice seat data (illustrative) |
| 2⁴⁰ | ≈ 1.10 × 10¹² | 10¹² (trillion) | 1 TB | a large single-node database |
| 2⁵⁰ | ≈ 1.13 × 10¹⁵ | 10¹⁵ (quadrillion) | 1 PB | a video platform's catalog |

Strictly, 2¹⁰ bytes is a **kibibyte** (KiB) and 10³ bytes a kilobyte (kB); the difference (2.4% at KB, 10% at TB) does not matter for back-of-the-envelope work.

!!! warning "Bits vs bytes"

    Network speeds are quoted in **bits** per second (a "10 Gbit/s" network interface), storage and payloads in **bytes**. Divide by 8: a 10 Gbit/s link carries at most **1.25 GB/s**. Mixing the two is the most common estimation error.

### Time

| Period | Seconds | Round to |
|---|---|---|
| 1 minute | 60 | — |
| 1 hour | 3,600 | 4 × 10³ |
| 1 day | 86,400 | **10⁵** |
| 1 month (30 days) | 2,592,000 | 2.5 × 10⁶ |
| 1 year | 31,536,000 | 3 × 10⁷ |

A handy conversion table, using 1 day ≈ 10⁵ s (the exact factor is 86,400, which makes the real rates about 15% higher):

| Per day | ≈ Per second (average) |
|---|---|
| 1 million | ~12 |
| 10 million | ~120 |
| 100 million | ~1,200 |
| 1 billion | ~12,000 |

---

## Latency numbers every engineer should know

In 2009, Jeff Dean (Google) popularized a list of "numbers everyone should know" — the cost of basic operations in a computer and a network[^1]. Hardware has changed since (SSDs replaced spinning disks on the hot path, networks got faster), but the **ratios** have stayed remarkably stable, because some limits — the speed of light, the physics of memory — do not improve. The table uses 2020s orders of magnitude, compiled from Dean's list, its later updates[^2] and Gregg's *Systems Performance*[^3]; your hardware may differ by 2–3×, which is fine for estimates.

| Operation | Latency (order of magnitude) | If 1 ns were 1 second… |
|---|---|---|
| L1 cache reference | ~1 ns | 1 s |
| Branch mispredict | ~3 ns | 3 s |
| L2 cache reference | ~4 ns | 4 s |
| Mutex lock/unlock (uncontended) | ~20 ns | 20 s |
| Main memory (RAM) reference | ~100 ns | 1.7 min |
| Compress 1 KB with a fast compressor | ~2 µs | 33 min |
| Read 1 MB sequentially from RAM | ~10–50 µs | 3–14 h |
| Random 4 KB read from an NVMe SSD | ~20–100 µs | 6–28 h |
| Round trip inside one data centre / availability zone | ~0.1–0.5 ms | 1–6 days |
| Read 1 MB sequentially from an NVMe SSD | ~0.2 ms | 2.3 days |
| Redis `GET` or primary-key SQL query, same zone (mostly network) | ~0.2–1 ms | 2–12 days |
| Round trip between availability zones of one region | ~1–2 ms | 12–23 days |
| Spinning disk (HDD) seek | ~5–10 ms | 2–4 months |
| Read 1 MB sequentially from an HDD | ~5 ms | 2 months |
| Round trip São Paulo ↔ US East (Virginia) | ~110–130 ms | ~4 years |
| Round trip across the Atlantic / Pacific | ~80–200 ms | 3–6 years |
| TCP + TLS handshake to a far server | 2–3 round trips | — |

### What the table teaches

1. **Memory is ~1,000× faster than SSD, and SSD ~100× faster than HDD for random reads.** This is why caches (Redis keeps everything in RAM) and in-memory indexes exist.
2. **Inside a data centre, the network costs more than the work.** A Redis `GET` takes microseconds of CPU on the server; the round trip is what you wait for. A page that makes 50 sequential calls to Redis spends ~10–25 ms just on round trips — **batch** them (`MGET`, pipelining) or cache in process.
3. **Across regions, physics wins.** Light in optical fibre travels at about 200,000 km/s, i.e. **~5 µs per km**, so every 100 km adds about **1 ms of round trip** before any router or server touches the packet. São Paulo to Virginia is ~7,500 km in a straight line, so the theoretical minimum round trip is ~75 ms; real routes give ~110–130 ms. No technology removes this: **avoid synchronous cross-region calls on the critical path** and serve users from nearby (CDN, regional deployments).
4. **Sequential beats random.** Reading 1 MB sequentially from an SSD costs about as much as a few random 4 KB reads. Log-structured storage, Kafka's append-only log and batch processing all exploit this.
5. **Round trips add up; bandwidth rarely limits small requests.** For a 2 KB API response, latency is dominated by round trips (connection setup, TLS, the request itself), not by transfer time. Reusing connections (keep-alive, HTTP/2) matters more than a fatter pipe.

!!! example "BoxOffice — the seat map, three ways"

    The seat map of a stadium event needs ~60,000 seat states.

    - **60,000 individual queries** from the app to PostgreSQL in the same zone: 60,000 × ~0.5 ms ≈ **30 s**. Unusable.
    - **One query** returning 60,000 rows of ~50 bytes (3 MB): one round trip + ~10–30 ms of database work + ~3 ms to transfer over a 10 Gbit/s link ≈ **20–40 ms**.
    - **One cached, compressed blob** in Redis (~300 KB after compression), refreshed every second: one round trip + a fraction of a millisecond of transfer ≈ **1–2 ms**.

    Same data, four orders of magnitude apart — decided entirely by the number of round trips and where the data lives.

---

## Throughput rules of thumb

Latency tells you how long *one* operation takes; capacity planning also needs how many operations *per second* a component can sustain. These vary much more with hardware, configuration and workload than latencies do, so treat the table as **illustrative starting assumptions** that you must replace with measurements (that is what lab 2 is for):

| Component | Order of magnitude (simple operations, one node) | What limits it |
|---|---|---|
| App server (JVM, simple JSON endpoint) | 10³–10⁴ requests/s | CPU per request, threads, downstream calls |
| Nginx serving cached/static content | 10⁴–10⁵ requests/s | CPU, network |
| Relational database, primary-key reads | 10⁴–10⁵ queries/s | CPU, buffer cache hit ratio |
| Relational database, durable write transactions | 10³–10⁴ commits/s | log flush (fsync), locks |
| Redis, simple `GET`/`SET` | ~10⁵ operations/s per instance | single-threaded command loop, network |
| Kafka, one partition | ~10 MB/s order of magnitude | disk, network, replication |
| 10 Gbit/s network interface | 1.25 GB/s | the wire |

The pattern to remember: **reads are cheaper than durable writes**, **memory is cheaper than disk**, and **anything that must flush to disk or cross the network to commit** (durable writes, replication, consensus) has a lower ceiling.

---

## Typical sizes

| Item | Size | Note |
|---|---|---|
| Boolean / byte | 1 B | — |
| Integer / timestamp | 4–8 B | `bigint`, epoch millis |
| UUID | 16 B (36 B as text) | store binary when you can |
| Short string (name, e-mail) | 20–100 B | UTF-8 |
| BoxOffice seat row | ~100 B | ids, status, price, hold id, version |
| BoxOffice order | ~1 KB | with items and payment reference |
| BoxOffice event (description, metadata) | ~2–5 KB | — |
| JSON API response (a page of results) | 2–50 KB | before compression |
| Ticket PDF | ~100 KB | — |
| Compressed photo (poster) | 200 KB – 2 MB | multiple resolutions |
| 1 minute of HD video | 50–100 MB | depends on bitrate |
| One embedding vector (1,024 dims × 4 B) | ~4 KB | relevant for vector DBs (class 13) |

Two multipliers are easy to forget: **replication** (a database usually keeps 3 copies; object stores replicate internally) and **indexes and overhead** (often 1.5–2× the raw data in a relational database).

---

## Estimating requests per second (QPS)

**QPS** (*queries per second*, used loosely for requests per second) is the starting point of every capacity estimate:

$$
\text{QPS}_{avg} = \frac{\text{daily active users} \times \text{actions per user per day}}{86{,}400}
\qquad
\text{QPS}_{peak} = \text{QPS}_{avg} \times \text{peak factor}
$$

- **Peak factor**: traffic is not flat over the day. For consumer products the busiest hour is typically **2–3×** the daily average; that is the number you size for. For event-driven businesses, the peak is a **spike** that has nothing to do with the daily average — estimate it separately.
- **Read/write ratio**: split the actions into reads and writes. Reads can be cached and replicated; writes go to a primary. A product at 100:1 and one at 1:1 are different designs.

!!! example "BoxOffice — requests per second (assumptions in italics)"

    **Normal day**

    - *20 M registered fans, 2 M daily active; each views ~20 pages (events, seat maps, searches).*
    - Reads: 2 M × 20 = 4 × 10⁷ per day → 4 × 10⁷ / 10⁵ ≈ **400 reads/s** average.
    - *Peak hour ≈ 3× average* → **~1,200 reads/s**.
    - Writes: *100 k orders/day*, each ~5 writes (hold, order, payment, tickets, outbox) → 5 × 10⁵ / 10⁵ ≈ **5 writes/s** average, ~15 at peak.
    - Read/write ratio ≈ **100:1** → cache and replicate reads; a single primary handles writes easily.

    **On-sale spike**

    - *2 M fans arrive in the first 60 s; each sends ~3 requests in that minute (page, refresh, hold attempt).*
    - 2 × 10⁶ × 3 / 60 ≈ **100,000 requests/s** at the edge — **~80× the normal peak**, for a few minutes.
    - Only 60 k seats exist: at most ~30 k fans can succeed (2 seats each). Almost all of the spike must be absorbed **before** it reaches the inventory: CDN for static content, cache for the event page, waiting room for holds.

---

## Estimating storage

$$
\text{storage} = \text{items per day} \times \text{size per item} \times \text{retention (days)} \times \text{replication factor} \;(\times \text{index overhead})
$$

!!! example "BoxOffice — storage for 5 years"

    | Data | Volume | Size each | Per year | 5 years, ×3 replicas | Store |
    |---|---|---|---|---|---|
    | Orders | 100 k/day | 1 KB | 100 MB/day × 365 ≈ **37 GB** | ≈ 550 GB | SQL |
    | Seats | *20 k events/year × 5 k seats* = 10⁸ rows | 100 B | **10 GB** | ≈ 150 GB | SQL (hot only during on-sale) |
    | Ticket PDFs | 200 k tickets/day | 100 KB | 20 GB/day ≈ **7 TB** | object store (replicated internally) ≈ 35 TB | Object Store |
    | Event images | 20 k events × 5 images | 1 MB | **100 GB** | ≈ 0.5 TB | Object Store + CDN |
    | Access logs | 10⁸ requests/day | 500 B | 50 GB/day ≈ **18 TB** | keep 30 days hot ≈ 1.5 TB | log platform / object store |

    **Conclusions**: the transactional data (orders, seats) is **well under a terabyte** even after 5 years with replicas — a single PostgreSQL primary with replicas fits; sharding is not a day-one requirement. The **bulky** data is files and logs, which belong in an object store (cheap, durable, effectively unlimited) — and you might decide to generate ticket PDFs on demand instead of storing 35 TB of them.

---

## Estimating bandwidth

$$
\text{bandwidth} = \text{requests per second} \times \text{bytes per response}
$$

!!! example "BoxOffice — bandwidth at the normal peak"

    - API responses: 1,200 req/s × 20 KB ≈ 24 MB/s ≈ **0.2 Gbit/s** — trivial for the origin.
    - Images: each page view loads ~1 MB of images → 1,200 × 1 MB ≈ 1.2 GB/s ≈ **10 Gbit/s** — saturates a 10 Gbit/s link and costs a lot in egress. Serve images from a **CDN**: with a 95% edge hit ratio, the origin sends only ~0.5 Gbit/s.
    - On-sale spike: 100 k req/s × 5 KB (a lightweight waiting-room page) ≈ 500 MB/s ≈ **4 Gbit/s** — must be served from the edge (CDN or edge compute), not from the app servers.

---

## Estimating servers and memory

Once you know the peak load and the per-node capacity, the number of nodes follows — with **headroom** and **redundancy**:

$$
\text{nodes} = \left\lceil \frac{\text{peak QPS}}{\text{capacity per node} \times \text{target utilization}} \right\rceil + \text{spares}
$$

- **Target utilization** of 60–75% for latency-sensitive services — the [queueing](../queueing/index.md) page explains why running closer to 100% destroys p99.
- **Spares** (N+1, N+2): if one node fails or is being deployed, the others must absorb its load without crossing the knee.

For **cache memory**, a common rule of thumb is the 80/20 rule: a small fraction of the items receives most of the traffic, so caching the **hot set** — often ~20% of the items, sometimes far less — captures most of the reads.

!!! example "BoxOffice — catalog servers and cache"

    - *One catalog instance handles ~1,000 req/s at 100% CPU (to be measured).* Peak 1,200 req/s at 60% target → 1,200 / 600 = 2 → **2 + 1 spare = 3 instances**.
    - Hot set: *the ~2,000 events on sale this month × 5 KB* (event JSON) + seat-map summaries (~300 KB each) ≈ 10 MB + 600 MB ≈ **~0.6 GB** — fits in a small Redis instance with a replica.

??? question "Think first: estimate a URL shortener"

    100 M new short URLs per month; reads are 100× writes; each record ~500 B; keep for 5 years.

    **Answer sketch**

    - Writes: 10⁸ / (2.5 × 10⁶ s) ≈ **40 writes/s**; reads ≈ **4,000 reads/s** (peak ×2–3 → ~10 k/s).
    - Storage: 10⁸ × 12 × 5 = 6 × 10⁹ records × 500 B = **3 TB** (≈ 9 TB with 3 replicas).
    - Implications: reads dominate and are highly cacheable (popular links) → cache; 3 TB is large for one node's working set, so plan partitioning or a key-value store; key space: 6 × 10⁹ URLs need ≥ 6 characters in base 62 (62⁶ ≈ 5.7 × 10¹⁰). The [case study](../../case-studies/url-shortener/index.md) develops it.

!!! tip "In the interview"

    Carry a small "numbers card" in your head: **1 day ≈ 10⁵ s; 1 M/day ≈ 12/s; RAM ~100 ns; SSD ~100 µs; same-zone round trip ~0.5 ms; cross-continent ~100+ ms; 1 Gbit/s ≈ 125 MB/s**. Write assumptions before results, round everything to one significant digit, and finish every line with its consequence. If you are unsure of a number, say so and give a range: "a primary-key lookup is around a millisecond including the network — let's say 1 ms."

!!! warning "Common pitfalls"

    - **Treating latency numbers as exact**: they are orders of magnitude; your hardware and your cloud will differ.
    - **Forgetting round trips**: 100 sequential calls at 0.5 ms are 50 ms, even if each call does almost nothing.
    - **Sizing for the daily average** instead of the peak — or forgetting the spike altogether.
    - **Ignoring replication, indexes and retention** in storage.
    - **Bits vs bytes**, and **86,400 vs 10⁵** when precision matters (e.g. SLA calculations — use the exact value there).

---

## How it connects { #how-it-connects }

``` mermaid
flowchart LR
    P2["powers of two and ten<br/>1 day ≈ 10⁵ s"] --> QPS["QPS: average and peak<br/>the spike estimated apart"]
    LAT["latency numbers<br/>RAM, SSD, network"] --> CACHE["cache the hot set<br/>→ Caching"]
    LAT --> RT["count round trips<br/>→ Edge protocols"]
    QPS --> NODES["nodes = peak / capacity × U<br/>+ spares → Compute"]
    QPS --> BW["bandwidth = QPS × size<br/>→ CDN"]
    SIZES["typical sizes"] --> STO["storage × retention<br/>× replication"]
    STO --> SHARD["shard or not?<br/>→ Databases"]
    STO --> OBJ["bulky files and logs<br/>→ object store"]
    NODES --> KNEE["target utilization<br/>→ Queueing"]
```

**Palette components:** [`app`](../../../reference/components/compute/index.md#app) (instances = peak / capacity per node, plus spares) · [`sql`](../../../reference/components/storage/index.md#sql) (orders and seats stay under a terabyte; the durable-write ceiling) · [`cache`](../../../reference/components/storage/index.md#cache) (the hot set, ~0.6 GB for the catalog) · [`cdn`](../../../reference/components/edge/index.md#cdn) (image bandwidth off the origin) · [`objstore`](../../../reference/components/storage/index.md#objstore) (ticket PDFs, images, logs) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (~10 MB/s per partition) · [`vectordb`](../../../reference/components/storage/index.md#vectordb) (~4 KB per embedding). **Scenarios:** `monolith`, `read-heavy-cache`, `cdn-static`, `url-shortener`. **Continues in:** [Queueing](../queueing/index.md), [Edge — DNS & CDN](../../edge/dns-cdn/index.md), [Caching](../../caching/index.md), [Databases — partitioning](../../databases/partitioning/index.md), [Case study: URL shortener](../../case-studies/url-shortener/index.md), [Exercise: estimation](../../../exercises/estimation/index.md).

## Key takeaways

- 2¹⁰ ≈ 10³; 1 day ≈ 10⁵ s; 1 M per day ≈ 12 per second.
- Latencies span eight orders of magnitude: **RAM ~100 ns, SSD ~100 µs, same-zone network ~0.5 ms, cross-continent ~100 ms**; most design rules follow from these ratios.
- QPS = users × actions / 86,400 × peak factor; **estimate spikes separately**.
- Storage = items × size × retention × replication (× overhead); bandwidth = QPS × size.
- Nodes = peak / (capacity × target utilization) + spares; cache the **hot set**.

---

[^1]: DEAN, J. *Designs, Lessons and Advice from Building Large Distributed Systems*. Keynote, LADIS workshop, 2009 ("numbers everyone should know").
[^2]: SCOTT, C. [Latency numbers every programmer should know (interactive)](https://colin-scott.github.io/personal_website/research/interactive_latency.html){target="_blank"}, University of California, Berkeley.
[^3]: GREGG, B. *Systems Performance: Enterprise and the Cloud*, 2nd ed. Addison-Wesley, 2020. Chapter 2 (methodologies: latency scale and known numbers).
