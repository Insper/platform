At 09:55 the BoxOffice team is staring at a dashboard. In five minutes a stadium show goes on sale: **2 million fans for 60 thousand seats**. How many requests per second will hit the catalog? How many seat holds per second will the database take? Does the seat map fit in memory? How many app servers do we need? The answers decide the architecture — and you can get them **before writing a single line of code**, with a sheet of paper and a few formulas. That is what this exercise trains.

!!! abstract "Learning objectives"

    After this exercise you will be able to:

    - **Estimate** daily active users, average and peak QPS, read/write ratio, storage, bandwidth and cache size from a short problem statement.
    - **Apply** Little's Law, peak factors and availability math (series/parallel) to size a system.
    - **State** assumptions explicitly, keep units straight and round to useful precision.
    - **Derive** design consequences from the numbers ("this forces a CDN", "one SQL primary is enough").
    - **Sanity-check** an estimate against a known reference number.

## Context

Back-of-the-envelope estimation is the second step of the [interview framework](../../classes/intro/interview-framework/index.md) and the first thing a reviewer looks for in a design doc[^1]. The goal is **the right order of magnitude**, not three significant digits: 12 k or 15 k requests per second leads to the same design; 1.2 k or 120 k does not.

The tools come from [Class 2 — Estimation](../../classes/estimation/index.md): powers of two and ten, the [latency and throughput numbers](../../reference/numbers/index.md)[^2], Little's Law, utilization, percentiles and availability math. In [Lab 2](../../hands-on/2/index.md) you will check some of these numbers against a real service.

### Formulas you will use

| Quantity | Formula | Typical assumption |
|-|-|-|
| Seconds in a day | 86,400 ≈ 10⁵ s | round to 10⁵ for mental math |
| Average QPS | requests per day ÷ 86,400 | — |
| Peak QPS | average × peak factor | 2–3× for daily peaks; much higher for events |
| Storage | items per day × size × retention × replication | replication factor 3 for durable stores |
| Bandwidth | QPS × payload size | separate ingress (writes) and egress (reads) |
| Cache size | hot fraction × daily distinct items × item size | "80/20": 20% of the items get 80% of the reads |
| Concurrency (Little's Law) | L = λ × W | λ in req/s, W in seconds |
| Servers | peak QPS ÷ (capacity per server × target utilization) | target utilization 0.6–0.7 |
| Availability in series | A = A₁ × A₂ × … | every hop multiplies |
| Availability in parallel | A = 1 − (1 − Aᵢ)ⁿ | n independent replicas |

## Task

Fill in an **estimation sheet** for **five systems**:

1. **BoxOffice flash sale** — mandatory for everybody (facts below).
2. **Four systems** chosen from the [fact sheets](#fact-sheets) below (at least one read-heavy and one write-heavy).

For each system, estimate the quantities in the [template](#templates), show the arithmetic, and finish with **three design consequences** derived from your numbers.

### BoxOffice facts

- The on-sale of a stadium show starts at 10:00; **2 M fans** arrive in the first **10 minutes**; there are **60 k seats**, at most 4 per order.
- A fan who is browsing does, on average, one request every 3 seconds (catalog, seat map, availability polling).
- A **waiting room** admits fans to the purchase flow at a rate you must choose so that the sale lasts about **15 minutes**.
- A seat hold lasts 5 minutes; about 30% of holds expire without payment.
- An order record is about 1 KB; a ticket e-mail about 50 KB; the seat map of the venue is about 200 KB of JSON.
- Outside on-sales, BoxOffice serves 5 M daily active users browsing ~20 pages each.

### Fact sheets

All facts below are **illustrative assumptions** for the exercise — use them as given and add your own assumptions where needed.

| System | Facts |
|-|-|
| Real-time chat | 50 M DAU; 40 messages sent per user per day; 100 bytes per message; 25% of users online at peak; history kept 5 years |
| Ride-sharing dispatch | 2 M active drivers at peak sending a location every 4 s; 10 M rides per day; a location update is 100 bytes; trips kept 3 years |
| Social feed | 200 M DAU; 2 posts and 50 timeline reads per user per day; 30% of posts have a 500 KB image; a timeline page has 20 posts |
| Video platform | 500 k uploads per day, 5 min average, 4 resolutions totalling 1 GB per video; 1 B views per day of 4 min average at 2 Mbit/s |
| AI support assistant | 1 M conversations per day, 6 turns each; 1,500 input tokens (with RAG context) and 300 output tokens per turn; output at 50 tokens/s |
| Notification system | 100 M users; 5 notifications per user per day; 30% push, 60% e-mail, 10% SMS; bursts of 10× during campaigns |
| Search autocomplete | 100 M DAU; 6 searches per user per day; one request per typed character after the 2nd, average query of 10 characters |
| Metrics platform | 50 k hosts; 500 time series per host; one sample every 10 s; 16 bytes per sample; raw data kept 15 days, 1-minute rollups 1 year |

## Requirements

- [ ] **(mandatory)** Five complete sheets: BoxOffice + four fact sheets (at least one read-heavy and one write-heavy).
- [ ] **(mandatory)** Every number has a **unit** and every derived number shows its **formula** (no bare results).
- [ ] **(mandatory)** Assumptions are listed in a table, separated from the given facts.
- [ ] Average **and** peak QPS, split into reads and writes.
- [ ] Storage per year (with replication) and bandwidth (ingress and egress).
- [ ] Cache size for the hot set, and whether it fits in one node.
- [ ] Number of servers for the hottest path, using **Little's Law** for concurrency and a target utilization.
- [ ] Availability of the main request path (series/parallel) compared with a target SLO.
- [ ] One **sanity check** per system against a reference number (e.g. from the [numbers cheat sheet](../../reference/numbers/index.md)).
- [ ] **Three design consequences** per system, each pointing to a number in the sheet.
- [ ] *AI usage* section (see the [policy](../index.md#use-of-ai-tools)).

## Deliverables

- A page `estimation` in your documentation site with the five sheets (tag `ex1`).
- Optional: the spreadsheet or script you used (committed to the repository) — the page must still show the formulas.

## Step by step

1. **Read the facts and write down the question.** "How many seat holds per second at peak?" is a question; "estimate BoxOffice" is not.
2. **List assumptions before computing.** Write what you assume and why (e.g. "peak factor 3, from a typical daily curve").
3. **Compute averages, then peaks.** Requests per day ÷ 10⁵ gives the average QPS; multiply by the peak factor. For events (on-sales, campaigns) compute the peak **directly** from the event: users × request rate.
4. **Split reads and writes.** They hit different components (cache/CDN vs primary database).
5. **Size the data.** Items × size × retention × replication. Then the hot set for the cache.
6. **Size the compute.** Little's Law gives the in-flight requests; capacity per server and a target utilization give the number of servers.
7. **Check availability.** Multiply the availabilities along the main path; add replicas where the result is below the SLO.
8. **Sanity-check.** Compare with something you know (a number from class, a public engineering blog, the cheat sheet).
9. **Write the consequences.** Each consequence is a decision justified by a number.

### Worked example: URL shortener

**Facts (illustrative):** 100 M new short URLs per month; read/write ratio 100:1; records kept 5 years; 500 bytes per record.

| Quantity | Arithmetic | Result |
|-|-|-|
| Writes, average | 100 M ÷ (30 × 86,400 s) ≈ 100 M ÷ 2.6 M s | ≈ 40 writes/s |
| Writes, peak (×3) | 40 × 3 | ≈ 120 writes/s |
| Reads, average | 40 × 100 | ≈ 4,000 reads/s |
| Reads, peak (×3) | 4,000 × 3 | ≈ 12,000 reads/s |
| Records in 5 years | 100 M × 12 × 5 | 6 B records |
| Storage | 6 B × 500 B = 3 TB; × 3 replicas | ≈ 9 TB |
| Key length | 62⁷ ≈ 3.5 × 10¹² > 6 × 10⁹ | 7 base-62 characters |
| Egress bandwidth | 4,000 reads/s × 500 B | ≈ 2 MB/s |
| Cache (20% of a day's reads) | 4,000 × 86,400 ≈ 350 M reads/day; 20% × 500 B | ≈ 35 GB → one large node or a small cluster |
| Concurrency at peak | L = 12,000 req/s × 0.02 s | ≈ 240 requests in flight |
| App servers | 12,000 ÷ (1,000 req/s per instance × 0.7) | ≈ 18 instances (+2 for N+2) |
| Availability | LB 99.99% × app (2 replicas of 99.9%: 1 − 0.001² ≈ 99.9999%) × DB 99.95% | ≈ 99.94% |

**Sanity check:** 2 MB/s of egress is tiny — a single 1 Gbit/s NIC moves ~125 MB/s. The bottleneck is not bandwidth.

**Design consequences:**

1. 12 k reads/s vs 120 writes/s → **read-heavy**: a cache in front of the database (hit ratio above 90% removes most database reads).
2. 9 TB over 5 years → fits one SQL cluster, but a key-value store partitioned by short key keeps growth simple; no join is needed.
3. 99.94% < 99.99% target → the database is the weakest link: add a standby with automatic failover (or accept the SLO).

!!! example "BoxOffice — how to start"

    Start from the event, not from the day: 2 M fans in 10 minutes, one request every 3 s each. How many fans are browsing at the same time (Little's Law again: arrival rate × time spent)? That gives the catalog QPS. Then the waiting room: if the sale must last ~15 minutes for 60 k seats and an order has 2.5 seats on average, how many buyers per minute must be admitted? That number sizes the seat-hold path — and shows why the waiting room exists.

### A tiny helper (optional)

Writing the arithmetic as code keeps units honest. You may adapt this script; the page must still show the formulas.

```python title="estimate.py"
DAY = 86_400  # seconds


def qps(per_day: float, peak_factor: float = 3.0) -> tuple[float, float]:
    """Average and peak requests per second."""
    avg = per_day / DAY
    return avg, avg * peak_factor


def servers(peak_qps: float, per_server: float, target_util: float = 0.7, spare: int = 2) -> int:
    """Instances needed at the target utilization, plus spare capacity (N+spare)."""
    from math import ceil
    return ceil(peak_qps / (per_server * target_util)) + spare


def series(*avail: float) -> float:
    """Availability of components in series."""
    out = 1.0
    for a in avail:
        out *= a
    return out


def parallel(a: float, n: int) -> float:
    """Availability of n independent replicas."""
    return 1 - (1 - a) ** n


if __name__ == "__main__":
    writes = 100e6 / 30          # URL shortener: writes per day
    w_avg, w_peak = qps(writes)
    r_avg, r_peak = w_avg * 100, w_peak * 100
    print(f"writes {w_avg:,.0f}/s avg, {w_peak:,.0f}/s peak")
    print(f"reads  {r_avg:,.0f}/s avg, {r_peak:,.0f}/s peak")
    print(f"in flight at peak: {r_peak * 0.020:,.0f}")
    print(f"app servers: {servers(r_peak, 1_000)}")
    print(f"availability: {series(0.9999, parallel(0.999, 2), 0.9995):.4%}")
```

## Templates

Copy one sheet per system into your page.

=== "English"

    ~~~markdown
    ## System: <name>

    ### Given facts
    | Fact | Value |
    |-|-|
    | ... | ... |

    ### Assumptions
    | # | Assumption | Value | Why |
    |-|-|-|-|
    | A1 | Peak factor | 3× | daily curve with an evening peak |
    | A2 | Capacity per app instance | 1,000 req/s | measured in Lab 2 / cheat sheet |

    ### Estimates
    | Quantity | Formula | Result | Unit |
    |-|-|-|-|
    | Reads, average | | | req/s |
    | Reads, peak | | | req/s |
    | Writes, average | | | req/s |
    | Writes, peak | | | req/s |
    | Storage per year (with replication) | | | TB |
    | Ingress bandwidth | | | MB/s |
    | Egress bandwidth | | | MB/s |
    | Cache (hot set) | | | GB |
    | Concurrency at peak (L = λW) | | | requests |
    | Servers for the hottest path | | | instances |
    | Availability of the main path | | | % |

    ### Sanity check
    <compare one number with a known reference>

    ### Design consequences
    1. <decision> — because <number from the sheet>
    2. ...
    3. ...
    ~~~

=== "Português"

    ~~~markdown
    ## Sistema: <nome>

    ### Fatos dados
    | Fato | Valor |
    |-|-|
    | ... | ... |

    ### Premissas
    | # | Premissa | Valor | Por quê |
    |-|-|-|-|
    | P1 | Fator de pico | 3× | curva diária com pico à noite |
    | P2 | Capacidade por instância da aplicação | 1.000 req/s | medido no Lab 2 / cheat sheet |

    ### Estimativas
    | Grandeza | Fórmula | Resultado | Unidade |
    |-|-|-|-|
    | Leituras, média | | | req/s |
    | Leituras, pico | | | req/s |
    | Escritas, média | | | req/s |
    | Escritas, pico | | | req/s |
    | Armazenamento por ano (com replicação) | | | TB |
    | Banda de entrada | | | MB/s |
    | Banda de saída | | | MB/s |
    | Cache (conjunto quente) | | | GB |
    | Concorrência no pico (L = λW) | | | requisições |
    | Servidores no caminho mais quente | | | instâncias |
    | Disponibilidade do caminho principal | | | % |

    ### Verificação de sanidade
    <compare um número com uma referência conhecida>

    ### Consequências para o design
    1. <decisão> — porque <número da planilha>
    2. ...
    3. ...
    ~~~

## Rubric

Levels as defined in [How the exercises are graded](../index.md#how-the-exercises-are-graded).

| Criterion | I | D | C | B | A |
|-|-|-|-|-|-|
| Completeness **(mandatory)** | Not delivered | Fewer than five sheets or quantities missing | Five sheets, every quantity present | — | — |
| Assumptions | None | Mixed with facts, unjustified | Listed, separated from facts | Justified (source or reasoning) | Sensitivity noted: which assumption changes the design if wrong |
| Arithmetic and units **(mandatory)** | Bare numbers | Unit or order-of-magnitude errors | Correct orders of magnitude, units everywhere | Formulas shown and consistent rounding | Cross-checked two ways (e.g. per user and per second) |
| Use of the formulas | — | Little's Law or availability missing | Peak, Little's Law and availability applied | Applied to the right path (hottest, critical) | Explains the effect of utilization on latency (the knee) |
| Sanity checks | — | None | One per system | Meaningful reference with a source | Finds and fixes an own mistake through the check |
| Design consequences | — | Generic ("use a cache") | Three per system | Each tied to a number | Ranks them and names what would change at 10× |

## FAQ

??? question "How precise must the numbers be?"

    One significant digit is usually enough. Round aggressively (86,400 ≈ 10⁵) but say that you did. What matters is the order of magnitude and that a reader can follow the arithmetic.

??? question "Where do I get the capacity of one server?"

    Use the numbers from class and the [numbers cheat sheet](../../reference/numbers/index.md), or — better — what you measured in [Lab 2](../../hands-on/2/index.md). Always say which one you used.

??? question "Can I change the given facts?"

    No. Facts are the same for everybody so that sheets can be compared. Add assumptions for whatever the facts do not say.

??? question "What is a good peak factor?"

    For daily traffic, 2–3× the average is common. For events (an on-sale, a campaign, a goal in a final) compute the peak from the event itself instead of multiplying the daily average.

??? question "The AI gave me a full sheet in seconds. Can I use it?"

    You may use AI to check your arithmetic or to discuss assumptions, and you must declare it. But the oral check for this exercise is simple: you will be asked to redo one line of a sheet on the board with a changed fact. Practise doing it yourself.

??? question "Do I need to include BoxOffice's normal (non-sale) traffic?"

    Yes, briefly: it shows how different the on-sale peak is from a normal day — which is exactly why BoxOffice needs a waiting room and elastic capacity.

[^1]: Alex Xu, *System Design Interview — An Insider's Guide*, vol. 1, ch. 2 "Back-of-the-envelope estimation", 2020.
[^2]: Jeff Dean, "Numbers Everyone Should Know", in *Designs, Lessons and Advice from Building Large Distributed Systems*, LADIS 2009.
