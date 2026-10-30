Seat A-12 is held by Bruno. At 10:00:00.040 (real time) he gives up and releases it through `inventory-1`; twenty milliseconds later, at 10:00:00.060, Carla grabs it through `inventory-2`. Both updates replicate to the other nodes, and the store resolves the conflict with the most common rule there is — **last write wins** by timestamp. But `inventory-1`'s clock runs **50 ms ahead**: Bruno's release is stamped 10:00:00.090, Carla's hold 10:00:00.060. The release "wins", the seat shows as FREE, and Carla — who has already been charged — has no seat. No message was lost and no code had a bug: the system simply trusted two clocks that disagreed.

A distributed system has **no global clock**. Every machine has its own, they drift apart, and the network delay between them is variable and unknown — so "which happened first?" has no free answer. This page shows what physical clocks can and cannot do, and the tools that order events without trusting them: logical clocks, vector clocks, hybrid clocks, TrueTime, and plain single authorities.

---

## Two clocks in every machine { #two-clocks }

Every operating system offers two different clocks, and mixing them up is a classic bug:

| | Time-of-day (wall) clock | Monotonic clock |
|---|---|---|
| **Answers** | "What date and time is it?" | "How much time has passed?" |
| **Java** | `System.currentTimeMillis()`, `Instant.now()` | `System.nanoTime()` |
| **Linux** | `CLOCK_REALTIME` | `CLOCK_MONOTONIC` |
| **Can jump?** | **Yes** — NTP steps it, an admin changes it, leap seconds | Never goes backwards |
| **Comparable across machines?** | Roughly (within the sync error) | **No** — its zero is arbitrary per machine |
| **Use for** | Timestamps shown to people, dates, expiry *deadlines* stored in a database | Timeouts, durations, rate limiting, latency metrics |

```java title="Durations.java"
// Wrong: if NTP steps the wall clock during the call, the "duration" can be negative or huge
long start = System.currentTimeMillis();
callPaymentProvider();
long elapsedMs = System.currentTimeMillis() - start;

// Right: the monotonic clock only measures elapsed time, and never goes backwards
long t0 = System.nanoTime();
callPaymentProvider();
long elapsedNs = System.nanoTime() - t0;
```

---

## Physical clocks drift { #drift }

A computer's clock is a quartz oscillator, and quartz is imperfect: its frequency depends on temperature and on the crystal. Drift is measured in **ppm** (parts per million): 20 ppm means 20 µs gained or lost per second — about **1.7 seconds per day**. Google assumes a bound of 200 ppm for its servers[^1]. Left alone, two machines' clocks diverge without limit.

**NTP** (Network Time Protocol) corrects this by periodically asking time servers (organised in *strata*, stratum 0 being atomic or GPS clocks) and adjusting the local clock — gradually (*slewing*) for small offsets, by a jump (*stepping*) for large ones. Its accuracy is limited by the **network delay** it cannot measure exactly: NTP assumes the request and the response took equally long, so asymmetric delays become clock error.

```python exec="1" html="1"
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "xtick.color": "#888",
                     "ytick.color": "#888", "axes.edgecolor": "#888", "font.size": 10})

# Illustrative: three servers whose quartz clocks drift at different rates (ppm =
# microseconds per second). NTP polls every 64 s and corrects each clock to the
# reference, with a residual error of up to +/- 1 ms. One server loses NTP at t = 600 s.
rng = np.random.default_rng(42)
t = np.arange(0, 1200, 1.0)                     # seconds
fig, ax = plt.subplots(figsize=(8, 3.8))
for name, ppm, color, ntp_until in [("inventory-1 (+15 ppm)", 15, "#2f6fed", 1200),
                                    ("inventory-2 (-25 ppm)", -25, "#1e9e5a", 1200),
                                    ("inventory-3 (+40 ppm, NTP lost at 600 s)", 40, "#e5484d", 600)]:
    offset = rng.uniform(-1, 1)
    series = []
    for s in t:
        if s % 64 == 0 and s < ntp_until:
            offset = rng.uniform(-1, 1)            # ms of residual error after a sync
        else:
            offset += ppm / 1000                   # ppm * 1 s = ppm microseconds = ppm/1000 ms
        series.append(offset)
    ax.plot(t, series, color=color, lw=1.6, label=name)
ax.axhline(0, color="#888", lw=0.6)
ax.set_xlabel("time, s")
ax.set_ylabel("clock offset from true time, ms")
ax.grid(alpha=0.25)
ax.legend(frameon=False, loc="upper left")
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True, bbox_inches="tight")
print(buf.getvalue())
plt.close()
```

The synchronised servers stay within a couple of milliseconds of each other (a sawtooth: drift, correct, drift); the one that lost NTP silently walks away — 24 ms after ten minutes at 40 ppm, and over three seconds after a day. Nothing alerts by default. Typical orders of magnitude (illustrative, they depend heavily on the setup):

| Synchronisation | Typical accuracy | Notes |
|---|---|---|
| None (free-running quartz) | Seconds per day | Never acceptable for servers |
| NTP over the public internet | Milliseconds to tens of ms | Asymmetric routes add error |
| NTP inside a data centre / cloud time service | Sub-millisecond to ~1 ms | E.g. Amazon Time Sync Service, Google's internal NTP |
| PTP (Precision Time Protocol, IEEE 1588) with hardware timestamps | Microseconds | Needs NIC/switch support; offered on some cloud instances |
| GPS + atomic clocks per data centre (Google TrueTime) | ε of a few ms, **with a known bound** | See [TrueTime](#truetime) |

!!! info "Leap seconds and smearing"
    Every few years a **leap second** was added to UTC (Coordinated Universal Time), and naïve clocks either repeated a second or jumped — crashing software in 2012. Google, AWS and others now **smear** it: they slow their clocks slightly over ~24 hours so no second is repeated. In 2022 the General Conference on Weights and Measures decided to stop adding leap seconds by 2035[^2]. Lesson: even "what time is it" has operational edge cases.

---

## Why timestamps cannot order events { #lww }

The opening story, step by step. Each node stamps its write with its own wall clock; replication delivers both writes to both nodes; **last-write-wins** (LWW) keeps the higher timestamp:

``` diagram-sim
sequenceDiagram
    participant B as Bruno
    participant I1 as inventory-1 (clock +50 ms)
    participant I2 as inventory-2 (clock accurate)
    participant C as Carla
    B->>I1: release A-12 (real time .040)
    Note over I1: stamped .090
    C->>I2: hold A-12 (real time .060)
    Note over I2: stamped .060
    I1->>I2: replicate release @ .090
    I2->>I1: replicate hold @ .060
    Note over I1,I2: LWW: .090 > .060, the release wins<br/>Carla's hold is silently discarded
```

With clocks synchronised to within ε, two events less than ε apart **cannot be ordered** by their timestamps — and in an LWW store, the node with the **fastest** clock wins every conflict. Cassandra uses LWW per column by default, and so does any "`updated_at` wins" merge logic you write yourself. LWW is acceptable when losing one of two concurrent writes is harmless (a profile picture); it is dangerous for seats and money.

The way out is to stop asking clocks *when* something happened and ask instead **what could have influenced what**.

---

## Lamport clocks { #lamport }

Leslie Lamport's 1978 paper[^3] — one of the most cited in computer science — observed that what matters is the **happened-before** relation (→):

- if *a* and *b* happen in the same process and *a* comes first, then *a* → *b*;
- if *a* is the sending of a message and *b* its receipt, then *a* → *b*;
- if *a* → *b* and *b* → *c*, then *a* → *c* (transitivity).

If neither *a* → *b* nor *b* → *a*, the events are **concurrent** (*a* ∥ *b*): neither could have influenced the other.

A **Lamport clock** is a counter per process with three rules:

1. Before each local event, increment the counter.
2. When sending a message, attach the counter.
3. When receiving a message carrying *t*, set the counter to `max(local, t) + 1`.

``` diagram-sim
sequenceDiagram
    participant O as order
    participant K as Kafka consumer (inventory)
    participant N as notification
    Note over O: create order 981 (L=1)
    O->>K: OrderPaid (L=2)
    Note over K: receive: max(0, 2) + 1 = 3
    Note over N: unrelated local event (L=1)
    K->>N: TicketIssued (L=4)
    Note over N: receive: max(1, 4) + 1 = 5
```

The guarantee is one-directional: **if *a* → *b* then L(*a*) < L(*b*)**. The converse does not hold — L(*a*) < L(*b*) does **not** prove that *a* happened before *b*; they may be concurrent. Breaking ties by node id gives a **total order** consistent with causality, which is enough for many algorithms (Raft's *term* is a Lamport-style counter). What a Lamport clock cannot do is **detect** concurrency.

---

## Vector clocks { #vector-clocks }

A **vector clock** keeps **one counter per node**. Each node increments its own entry on a local event, attaches the whole vector to messages, and on receipt takes the element-wise maximum (then increments its own entry). Comparing two vectors answers the question Lamport clocks cannot:

- *V(a)* ≤ *V(b)* element-wise (and different) → *a* → *b*;
- *V(b)* ≤ *V(a)* → *b* → *a*;
- neither → **concurrent**: a real conflict that needs resolution.

Three replicas of Carla's cart (`[SP, LIS, NYC]` counters):

| Step | Replica | Operation | Vector | Relation |
|---|---|---|---|---|
| 1 | SP | add ticket for event 42 | `[1, 0, 0]` | — |
| 2 | LIS | receives step 1, adds parking pass | `[1, 1, 0]` | step 1 → step 2 |
| 3 | NYC | receives step 1, removes the ticket | `[1, 0, 1]` | step 1 → step 3 |
| 4 | compare | step 2 vs step 3 | `[1,1,0]` vs `[1,0,1]` | **concurrent**: neither ≤ the other |

The store keeps both versions (*siblings*) and asks the application to merge them — exactly what Amazon's Dynamo did for the shopping cart (merge by union, which is why deleted items occasionally came back)[^4]. Riak exposed the same model.

``` diagram-sim
sequenceDiagram
    participant SP as replica SP
    participant LIS as replica LIS
    participant NYC as replica NYC
    Note over SP: add ticket [1,0,0]
    SP->>LIS: replicate [1,0,0]
    SP->>NYC: replicate [1,0,0]
    Note over LIS: add parking [1,1,0]
    Note over NYC: remove ticket [1,0,1]
    LIS->>NYC: replicate [1,1,0]
    Note over NYC: [1,1,0] vs [1,0,1]: concurrent<br/>keep both, merge in the application
```

Both clocks side by side, on three BoxOffice services:

<div class="csim" data-sim="clocks"></div>

!!! tip "Try it"
    The scenario opens with two events selected: `i2` (inventory releases seat A-12, L=2, `[0,0,2]`) and `p1` (payment receives `OrderPlaced`, L=3, `[2,1,0]`). Lamport says 2 < 3, yet the vectors are incomparable — the events are **concurrent**, and nothing in the Lamport numbers could have told you. Now click `o1` and then `i3`: `[1,0,0]` ≤ `[2,2,3]`, so `o1` → `i3` through two messages, and the Lamport numbers agree (1 < 5), as they must. Click a single event to see its causal past (green rings) and future (blue). Finally, add a local event on order (`o3`, `[3,0,0]`) and compare it with `i3`: concurrent. Send a message from order to inventory and receive it: the receipt has `o3` in its past.

The cost is size: the vector grows with the number of nodes (or clients) that write. Practical systems use **version vectors** with one entry per *replica* (not per client) and prune old entries.

---

## Hybrid logical clocks { #hlc }

Logical clocks capture causality but have nothing to do with real time — you cannot ask "what was the state at 10:00:00?". Physical clocks are close to real time but do not capture causality. A **hybrid logical clock** (HLC, Kulkarni et al., 2014)[^5] combines both into one fixed-size timestamp `(l, c)`:

- `l` is the largest physical time the node has **seen** (its own clock or any message's);
- `c` is a logical counter that breaks ties when `l` does not advance.

```python title="hlc.py"
import time

class HLC:
    def __init__(self):
        self.l, self.c = 0, 0                 # (physical part in ms, logical counter)

    def now(self):                             # local event or send
        pt = int(time.time() * 1000)
        if pt > self.l:
            self.l, self.c = pt, 0
        else:
            self.c += 1                        # wall clock did not advance: count
        return (self.l, self.c)

    def update(self, ml, mc):                  # on receiving a message stamped (ml, mc)
        pt = int(time.time() * 1000)
        new_l = max(self.l, ml, pt)
        if new_l == self.l == ml:
            self.c = max(self.c, mc) + 1
        elif new_l == self.l:
            self.c += 1
        elif new_l == ml:
            self.c = mc + 1
        else:
            self.c = 0
        self.l = new_l
        return (self.l, self.c)
```

HLC timestamps respect causality (like Lamport clocks), stay within the clock-sync error of real time (so they can be used for "read as of 10:00:00" snapshots), and fit in 64 bits. **CockroachDB**, **YugabyteDB** and **MongoDB** (cluster time) use them. They still rely on a **bound** on clock skew: CockroachDB, for example, has a configured maximum offset (500 ms by default) and a node that detects it is further off than that shuts itself down rather than risk inconsistency[^6].

---

## TrueTime and Spanner { #truetime }

Google's **Spanner**[^1] took the opposite route: instead of avoiding physical time, make it **trustworthy**. Each data centre has GPS receivers and atomic clocks, and the **TrueTime** API does not return a time but an **interval**: `TT.now() = [earliest, latest]`, guaranteed to contain the true time, with an uncertainty ε that the paper reports as typically 1–7 ms.

To make transactions **externally consistent** (if T1 commits before T2 starts, T2's timestamp is larger), Spanner uses **commit wait**: it picks the commit timestamp *s* = `TT.now().latest` and then **waits until `TT.now().earliest > s`** before making the commit visible — i.e. until *s* is guaranteed to be in the past everywhere.

``` diagram-sim
sequenceDiagram
    participant C as client
    participant S as Spanner leader
    participant TT as TrueTime
    C->>S: commit T1
    S->>TT: now()
    TT-->>S: [10:00:00.100, 10:00:00.106]
    Note over S: s = .106 (latest), replicate via Paxos meanwhile
    S->>TT: now() until earliest > .106
    TT-->>S: [10:00:00.107, 10:00:00.113]
    S-->>C: committed at s = .106
    Note over C,S: any later transaction gets s' > .106
```

The cost of correctness is literally **waiting out the uncertainty** (on average ~2ε per commit, overlapped with the Paxos replication). Smaller ε means faster commits, which is why Google invests in clocks. AWS later published a similar open-source API, **ClockBound**, that returns error bounds on EC2 instances.

---

## Ordering in practice { #in-practice }

Most systems never implement vector clocks or TrueTime. They get order from simpler sources — and it is worth knowing what each one guarantees:

| Technique | What it orders | Guarantee | Typical use |
|---|---|---|---|
| **Single authority** (one DB primary, `now()` and sequences on it) | Everything that goes through it | Total order, one clock | Seat holds, order numbers, hold expiry |
| **Kafka partition offsets** | Messages within one partition | Total order per partition (per key) | All events of one BoxOffice event in one partition |
| **Lamport / Raft terms** | Causally related events | Causal → smaller number | Leader epochs, fencing tokens |
| **Vector / version vectors** | Versions of one item | Detects concurrency | Leaderless stores, sync/offline apps |
| **HLC** | All events in a cluster | Causal + close to real time | CockroachDB, YugabyteDB, MongoDB |
| **TrueTime** | All transactions globally | External consistency | Spanner |
| **Time-ordered IDs** (Snowflake, UUIDv7, ULID) | IDs by creation time, roughly | Sortable, unique; **not** causal across machines | Primary keys, log/event ids |

A **Snowflake ID** (Twitter, 2010) packs a 64-bit integer with a 41-bit millisecond timestamp, a 10-bit machine id and a 12-bit per-millisecond sequence — up to 4,096 ids per millisecond per machine, unique without coordination, and roughly sortable by time. **UUIDv7** (RFC 9562, 2024)[^7] standardises the same idea in a 128-bit UUID with a 48-bit Unix-millisecond prefix: B-tree indexes stay compact because new keys are appended at the end instead of scattered like random UUIDv4.

```java title="Snowflake.java"
// 64-bit id: 41 bits of ms since a custom epoch | 10 bits machine id | 12 bits sequence
final class Snowflake {
    private static final long EPOCH = 1735689600000L;   // 2025-01-01T00:00:00Z
    private final long machineId;                         // 0..1023, assigned per instance
    private long lastMs = -1, seq = 0;

    Snowflake(long machineId) { this.machineId = machineId; }

    synchronized long next() {
        long now = System.currentTimeMillis();
        if (now < lastMs) now = lastMs;                   // clock stepped back: do not go backwards
        if (now == lastMs) {
            seq = (seq + 1) & 0xFFF;                      // 4096 ids per ms
            if (seq == 0) while ((now = System.currentTimeMillis()) <= lastMs) { }  // wait next ms
        } else {
            seq = 0;
        }
        lastMs = now;
        return ((now - EPOCH) << 22) | (machineId << 12) | seq;
    }
}
```

??? question "Think first: two orders get Snowflake ids 7.31e17 and 7.29e17 from two different `order` replicas. Can you conclude which order was placed first?"

    Only approximately. The ids embed each machine's **wall clock**, so with clocks synchronised to within a few milliseconds, ids generated more than that apart are correctly ordered — but two orders a millisecond apart on different machines can come out in either order. Time-ordered ids are great for index locality and "roughly newest first" listings; they are **not** a source of causal or total order across machines. If the order matters (who got the last seat), let a single authority decide — the `inventory` primary's conditional `UPDATE`.

!!! example "BoxOffice: where time and order come from"
    - **Who got seat A-12** — decided by the single `inventory` primary for that event (conditional `UPDATE`); no timestamps compared at all.
    - **Hold expiry** — `expires_at = now() + interval '10 minutes'` computed **by PostgreSQL on the primary**, and the sweeper compares against the same database's `now()`: one clock, so skew between app servers is irrelevant.
    - **Event ordering** — every event about one show (`SeatHeld`, `SeatReleased`, `OrderPaid`) is published with Kafka key = `eventId`, so they land in **one partition** and every consumer sees them in the same order.
    - **Ids** — orders and tickets use **UUIDv7**: unique without coordination, index-friendly, roughly time-sortable — never used to decide *who was first*.
    - **Durations and timeouts** — measured with the monotonic clock (`System.nanoTime()`), never with wall-clock differences.
    - **Monitoring** — an alert on NTP offset per node (e.g. > 50 ms), because a machine that lost NTP is silent otherwise.

!!! example "In the BoxOffice code: who decides when a hold expires (lab 6)"

    [Hands-on 6 — Holds](../../../hands-on/6/holds/index.md) follows the single-authority rule where it matters most: who got the seat is decided by a conditional `UPDATE` on the primary, and the sweeper that frees expired holds compares `expires_at` with the **database's** `now()`, using `FOR UPDATE SKIP LOCKED` so that several `inventory` replicas can run it at once without freeing the same hold twice. Look closely at `expires_at`, though: it is computed **in Java**, with the clock of the `inventory` replica, and checked against the database's clock — the pitfall below, in miniature. On a laptop every container shares one clock, so nothing shows; in production the skew between a replica and the database (milliseconds with NTP, much more without) moves the end of every hold by that much. Computing it in SQL, `expires_at = now() + :ttl`, as the box above says, removes the second clock.

    ``` { .java title="services/inventory/src/main/java/boxoffice/inventory/HoldService.java (two clocks)" }
    --8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/java/boxoffice/inventory/HoldService.java:52:53,189:208"
    ```

!!! tip "In the interview"
    When a design compares timestamps from different machines ("the latest update wins", "sort the chat messages by `created_at`"), say it out loud: *"clocks drift, so timestamps from different servers can't order events less than the skew apart."* Then offer the fix that fits: a **single authority** (sequence or conditional write on one leader), a **per-key ordered log** (Kafka partition by key), a **logical/version counter** (optimistic concurrency with a `version` column), or an **HLC-based database** if you need global order. For "design a unique ID generator", Snowflake / UUIDv7 with their bit layouts is the expected answer (Alex Xu, vol. 1, ch. 7)[^8].

!!! success "Best practices"

    - **Store and exchange timestamps in UTC with an explicit offset** — `timestamptz` columns, ISO 8601 in APIs; local time repeats an hour every year where daylight saving time applies. In BoxOffice: `created_at TIMESTAMPTZ` in the `payments` table of lab 9.
    - **Partition events by the entity whose order matters** — one key, one partition, one order for every consumer. In BoxOffice: lab 7's relay publishes `order-events` with key = order id ([Hands-on 7 — Outbox](../../../hands-on/7/outbox/index.md)).
    - **Decide "who changed it last" with a version counter, not a timestamp** — `version = version + 1` on every write is immune to clock skew. In BoxOffice: `inventory.seats.version` (lab 6).
    - **Run chrony with several time sources and let it slew, not step, in production** — a slewed clock never jumps backwards under a running process.
    - **Use time-ordered ids (UUIDv7) for new primary keys** — inserts stay at the end of the B-tree index; random UUIDv4 keys scatter writes across it.

!!! warning "Pitfalls"
    - **Measuring durations with the wall clock** — negative or huge latencies when NTP steps the clock; use the monotonic clock.
    - **LWW on data where both writes matter** — silent data loss, biased towards the node with the fastest clock.
    - **Expiry computed on one machine and checked on another** — a 10-minute hold may expire early or late by the skew; compute and compare on the same clock (the database's).
    - **Assuming time-ordered ids are causally ordered** — Snowflake/UUIDv7 order is only as good as clock sync.
    - **Not monitoring clock offset** — a node that lost NTP drifts silently until something breaks.

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    DRIFT["clock drift<br/>NTP, PTP"] --> LWW["LWW loses writes"]
    LWW --> VV["version vectors, CRDTs<br/>→ Replication & Consistency"]
    HB["happened-before"] --> LAM["Lamport clocks"]
    LAM --> TERMS["Raft terms, fencing tokens<br/>→ Consensus"]
    HB --> VEC["vector clocks"] --> VV
    DRIFT --> HLC["hybrid logical clocks"]
    LAM --> HLC
    DRIFT --> TT["TrueTime<br/>commit wait"]
    HLC --> SNAP["consistent snapshots<br/>CockroachDB, YugabyteDB"]
    TT --> SNAP
    AUTH["single authority<br/>DB now(), Kafka offsets"] --> PRAC["practical ordering"]
    IDS["Snowflake, UUIDv7"] --> PRAC
```

**Palette components that provide order or time:** [`sql`](../../../reference/components/storage/index.md#sql) (sequences, `now()` on the primary) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (offsets per partition) · [`scheduler`](../../../reference/components/compute/index.md#scheduler) (wall-clock triggers — beware skew) · [`cache`](../../../reference/components/storage/index.md#cache) (TTL expiry). **Continues in:** [Messaging — Kafka](../../messaging/kafka/index.md) (ordering by key), [Case study: URL shortener](../../case-studies/url-shortener/index.md) (unique ids), [Observability](../../observability/index.md) (clock skew in traces).

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - There is **no global clock**: quartz clocks drift (ppm), NTP keeps them within ms of each other — not identical, and not if it stops.
    - Use the **monotonic** clock for durations and timeouts, the **wall** clock only for human-facing timestamps.
    - **Timestamps from different machines cannot order events** closer than the skew; **LWW** loses writes.
    - **Lamport clocks**: *a* → *b* ⇒ L(*a*) < L(*b*); **vector clocks** also detect concurrency; **HLC** gives causality close to real time in 64 bits; **TrueTime** bounds the uncertainty and waits it out.
    - In practice, get order from a **single authority**, a **partitioned log** keyed by entity, or a **version** column — and use Snowflake/UUIDv7 for unique, sortable ids, not for deciding who came first.

---

[^1]: CORBETT, J. C. et al. [Spanner: Google's Globally-Distributed Database](https://research.google/pubs/spanner-googles-globally-distributed-database-2/){target="_blank"}. OSDI, 2012.
[^2]: BIPM. [Resolution 4 of the 27th CGPM (2022): On the use and future development of UTC](https://www.bipm.org/en/cgpm-2022/resolution-4){target="_blank"}.
[^3]: LAMPORT, L. [Time, Clocks, and the Ordering of Events in a Distributed System](https://lamport.azurewebsites.net/pubs/time-clocks.pdf){target="_blank"}. Communications of the ACM, 1978.
[^4]: DECANDIA, G. et al. [Dynamo: Amazon's Highly Available Key-value Store](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf){target="_blank"}. SOSP, 2007.
[^5]: KULKARNI, S. et al. [Logical Physical Clocks and Consistent Snapshots in Globally Distributed Databases](https://cse.buffalo.edu/tech-reports/2014-04.pdf){target="_blank"}. OPODIS, 2014.
[^6]: COCKROACH LABS. [Living Without Atomic Clocks](https://www.cockroachlabs.com/blog/living-without-atomic-clocks/){target="_blank"}, 2016.
[^7]: IETF. [RFC 9562 — Universally Unique IDentifiers (UUIDs)](https://www.rfc-editor.org/rfc/rfc9562){target="_blank"}, 2024.
[^8]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1. Byte Code LLC, 2020. Chapter 7, "Design a unique ID generator in distributed systems".
