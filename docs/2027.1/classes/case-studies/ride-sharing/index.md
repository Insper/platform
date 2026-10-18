
> *"Design a ride-hailing service like Uber or 99: a rider requests a ride, the system finds a nearby driver, and both see each other on the map until the trip ends."*

Ride sharing is the classic **geospatial, write-heavy, real-time** problem. Hundreds of thousands of phones report their position every few seconds; most of those writes are useless a few seconds later, and the only query that matters — *which available drivers are near this point?* — must answer in milliseconds. On top of that sits a small but strict consistency problem: **one driver, one ride**. The interview tests whether you can pick a spatial index, keep the hot data in memory, partition the world sensibly, and protect the one place where correctness is not negotiable.

BoxOffice meets the same problems twice. Its "events near me" search uses the same geo index ideas, and every stadium show ends with **60 000 fans leaving at once** — a ride-hailing app sees a single map cell go from a handful of requests to thousands in minutes. That hot cell is one of the follow-ups below.

| | |
|---|---|
| **Difficulty** | :material-star::material-star::material-star: hard |
| **Key concepts** | write-heavy location ingestion, latest-position store, geohash vs. quadtree vs. H3, neighbor-cell search, matching/dispatch with a per-driver lock and offer timeout, trip state machine, partitioning by city, surge pricing per cell |
| **Palette components** | [`mobile`](../../../reference/components/client/index.md#mobile), [`apigw`](../../../reference/components/edge/index.md#apigw), [`app`](../../../reference/components/compute/index.md#app), [`stream`](../../../reference/components/messaging/index.md#stream), [`cache`](../../../reference/components/storage/index.md#cache), [`sql`](../../../reference/components/storage/index.md#sql), [`nosql`](../../../reference/components/storage/index.md#nosql), [`notifications`](../../../reference/components/compute/index.md#notifications), [`payment`](../../../reference/components/external/index.md#payment) |
| **Playground scenario** | `ride-sharing` |

!!! abstract "What this case trains"

    - **Estimate** the location-update rate and **show** why only the latest position belongs on the hot path.
    - **Compare** geohash, quadtree and H3 for "nearby" queries, including the cell-border problem.
    - **Design** matching so that a driver is never assigned to two rides, with offers that time out.
    - **Model** the trip as a state machine and **partition** the system by geography.
    - **Identify** hot spots (stadium exits, airports) and failure modes (phones going offline mid-trip, a region down).

---

## 1. Clarify the requirements

([interview framework](../../intro/interview-framework/index.md))

### Functional requirements

1. Drivers go **online/offline** and, while online, send their **location** every few seconds.
2. A rider sees **nearby drivers** on the map and an **ETA** and **price estimate**.
3. A rider **requests** a ride; the system **matches** a driver, who accepts or declines within a few seconds.
4. During the trip, both apps show **live location**; the trip ends with **payment** and a rating.
5. Trip **history** for riders, drivers and support.

### Non-functional requirements

| Quality | Target |
|---|---|
| **Latency** | Nearby-drivers query p99 < 100 ms; match found in a few seconds |
| **Correctness** | A driver is never assigned two rides at the same time; a rider is never charged twice |
| **Scale** | ~1 M drivers online at peak worldwide, location every 4 s; ~20 M trips/day |
| **Freshness** | Positions on the map at most a few seconds old |
| **Availability** | 99.99% for requesting and matching; a city must keep working if another region fails |
| **Durability** | Trips and payments are never lost; raw location history may be sampled |

### Out of scope (say it explicitly)

Routing/maps engine (we call one), driver onboarding and documents, fraud detection, shared rides (pooling) — mention pooling as an extension.

??? question "Questions to ask the interviewer"

    | Question | Why it matters |
    |---|---|
    | How many drivers online, how often do they report? | Sizes the write path: 1 M every 4 s is 250 k writes/s. |
    | One city or global? | Partitioning by city/region keeps every query local. |
    | Does the driver accept, or is the ride assigned? | Offers with timeouts need a lock per driver. |
    | How precise must "nearby" be? Straight line or road ETA? | Spatial index for candidates, routing engine for ranking. |
    | Must we keep every GPS point? | Hot path keeps only the latest; history goes to cheap storage, maybe sampled. |
    | Surge pricing? Scheduled rides? Pooling? | Each adds a component; agree on what is in the 45 minutes. |

---

## 2. Back-of-the-envelope estimates

```python exec="1" source="tabbed-right"
# Ride sharing: assumptions (illustrative)
drivers_online = 1_000_000     # at peak, worldwide
update_s       = 4             # driver location interval
loc_b          = 100           # driver id, lat, lon, heading, speed, ts
trips_day      = 20_000_000
peak_factor    = 3
trip_min       = 20            # average trip duration
rider_poll_s   = 2             # rider app refreshes driver position during the trip
cities         = 500

loc_writes     = drivers_online / update_s
ingest_mb_s    = loc_writes * loc_b / 1e6
history_tb_day = loc_writes * 86_400 * loc_b / 1e12
latest_mb      = drivers_online * loc_b / 1e6
trip_rps       = trips_day / 86_400
peak_trip_rps  = trip_rps * peak_factor
active_trips   = trip_rps * trip_min * 60             # Little's Law: L = λ·W
trip_push_rps  = active_trips / rider_poll_s
writes_city    = loc_writes / cities                   # average; big cities are 10-50x this

rows = [
    ("loc_writes", loc_writes, "writes/s"), ("ingest_mb_s", ingest_mb_s, "MB/s"),
    ("history_tb_day", history_tb_day, "TB/day"), ("latest_mb", latest_mb, "MB"),
    ("trip_rps", trip_rps, "req/s"), ("peak_trip_rps", peak_trip_rps, "req/s"),
    ("active_trips", active_trips, "trips"), ("trip_push_rps", trip_push_rps, "msgs/s"),
    ("writes_city", writes_city, "writes/s"),
]
print("| quantity | value | unit |\n|---|---:|---|")
for name, value, unit in rows:
    v = f"{value:,.0f}" if abs(value) >= 100 else f"{value:,.2f}"
    print(f"| `{name}` | {v} | {unit} |")
```

What the numbers tell us:

- **250 k location writes/s** — far beyond what a relational primary should absorb as row updates. But the **latest** position of every driver is only **~100 MB**: it fits in memory many times over. ⇒ keep the latest position in an in-memory geo index; stream the raw points to cheap storage.
- Raw history is **~2 TB/day** if kept in full ⇒ object storage / data lake, compressed and possibly sampled, never on the hot path.
- Ride requests are only **~230/s (~700/s at peak)** — the matching path is low volume but must be **correct**.
- Little's Law gives **~280 k trips in progress** at any time, each pushing the driver's position to the rider: **~140 k messages/s** of real-time fan-out (persistent connections, as in the [chat case](../chat/index.md)).
- Divided by city the write rate is small (**~500 writes/s on average**, a few tens of thousands in the largest metros). ⇒ **partition by city/region**: every query is local to one shard.

---

## 3. API

```http
# Driver app (in practice over a persistent connection: WebSocket / gRPC stream / MQTT)
PUT  /v1/drivers/me/status        {"status": "AVAILABLE|OFFLINE"}                 → 204
PUT  /v1/drivers/me/location      {"lat": -23.5475, "lon": -46.6361, "heading": 90,
                                   "speed": 8.3, "ts": 1767261600123}             → 204
POST /v1/offers/{offerId}/accept                                                  → 200 {rideId}
POST /v1/offers/{offerId}/decline                                                 → 204

# Rider app
GET  /v1/drivers/nearby?lat=…&lon=…&radius=2000                                   → 200 [{driverId, lat, lon, etaS}]
POST /v1/rides  {"pickup": {...}, "dropoff": {...}, "product": "economy"}
     Idempotency-Key: 5b1e…                                                       → 202 {rideId, status: MATCHING, fareEstimate}
GET  /v1/rides/{rideId}                                                           → 200 {status, driver, driverLocation, etaS}
POST /v1/rides/{rideId}/cancel                                                    → 200 {cancellationFee}
```

- Location updates are **fire-and-forget**: if one is lost, the next arrives in 4 s. No retries, no acknowledgments per point.
- Ride creation is **idempotent** (`Idempotency-Key`): a rider tapping twice on a slow network must not get two cars.

---

## 4. Data model

```text
# Latest positions, one geo set per city (Redis GEO = sorted set of geohash-encoded scores)
GEOADD drivers:sao-paulo -46.6361 -23.5475 driver:42
GEOSEARCH drivers:sao-paulo FROMLONLAT -46.6361 -23.5475 BYRADIUS 2 km ASC COUNT 20

# Driver state (hash), with TTL refreshed by each update: no update for 30 s → stale
driver:42 → { status: AVAILABLE, city: sao-paulo, lat, lon, ts, rideId: null }
```

```sql
CREATE TABLE ride (
    ride_id        UUID PRIMARY KEY,
    city           TEXT        NOT NULL,
    rider_id       BIGINT      NOT NULL,
    driver_id      BIGINT,
    status         TEXT        NOT NULL,   -- MATCHING | ACCEPTED | ARRIVING | IN_PROGRESS | COMPLETED | CANCELLED
    pickup         POINT       NOT NULL,
    dropoff        POINT       NOT NULL,
    fare_cents     INT,
    surge          NUMERIC(3,2),
    idempotency_key TEXT UNIQUE NOT NULL,
    requested_at   TIMESTAMPTZ NOT NULL,
    completed_at   TIMESTAMPTZ
);

-- At most one active ride per driver: the database enforces it
CREATE UNIQUE INDEX one_active_ride_per_driver ON ride (driver_id)
    WHERE status IN ('ACCEPTED', 'ARRIVING', 'IN_PROGRESS');
```

| Data | Store | Why |
|---|---|---|
| Latest driver positions | In-memory geo index (`cache`, e.g. Redis GEO), sharded by city | 250 k writes/s, sub-ms radius queries, only the last value matters |
| Location stream | Event stream (`stream`/Kafka), partitioned by city | Feeds the geo index, ETA models, surge and the history |
| Location history | Object store / data lake (via the stream) | Cheap, append-only, for disputes and analytics |
| Rides, payments | SQL (`sql`), partitioned by city | Transactions, unique constraints, state machine |
| Driver/rider profiles | SQL or NoSQL (`nosql`) | Read-mostly, cached |

---

## 5. High-level design

``` mermaid-sim
flowchart LR
    d([Driver app]) --> gw["Gateway<br/>persistent connections"]
    r([Rider app]) --> gw
    gw --> loc["Location service"]
    loc --> st[["Location stream<br/>partitioned by city"]]
    st --> geo[("Geo index<br/>latest positions")]
    st --> hist[("History<br/>object store")]
    st --> surge["Surge pricing<br/>supply/demand per cell"]
    gw --> ride["Ride service"]
    ride --> match["Matching / dispatch"]
    match --> geo
    match --> eta["ETA / routing"]
    match -. offer .-> gw
    ride --> db[("Rides DB<br/>SQL")]
    ride --> pay[["Payment provider"]]
    ride --> notif["Notifications"]
```

A ride request, from tap to accepted offer:

``` mermaid-sim
sequenceDiagram
    autonumber
    participant R as Rider app
    participant S as Ride service
    participant M as Matching
    participant G as Geo index
    participant L as Driver lock
    participant D as Driver app
    R->>S: POST /rides (Idempotency-Key)
    S-->>R: 202 MATCHING
    S->>M: match(ride, pickup)
    M->>G: GEOSEARCH 2 km, AVAILABLE, 20 nearest
    G-->>M: candidates
    M->>M: rank by road ETA
    M->>L: lock driver 42 for ride (NX, 15 s)
    L-->>M: OK
    M->>D: offer (expires in 15 s)
    D-->>M: accept
    M->>S: assign driver 42 (conditional update)
    S-->>R: driver 42, ETA 4 min
```

---

## 6. Deep dives

### 6.1 Ingesting locations: keep only what matters

- **The latest position is the product; the trail is analytics.** The location service validates the point (plausible speed, not in the ocean), writes the latest value to the geo index and appends it to the stream. Nothing on the hot path reads history.
- **Batch and coalesce.** The gateway can coalesce updates per driver (if two arrive in the same 100 ms window, keep the newest) and write to the geo index in pipelined batches.
- **Adaptive frequency.** An available driver standing still does not need to report every 4 s; a driver approaching a pickup needs more. The app adapts the interval to speed and state — fewer writes, better freshness where it matters.
- **Staleness.** Each driver state has a TTL refreshed by updates; a phone that goes silent for 30 s drops out of the candidate set automatically, without a cleanup job.
- **Partition by city.** The stream topic, the geo index and the rides database are all partitioned by city (or region), so a query in São Paulo never touches Lisbon's shards ([partitioning](../../databases/partitioning/index.md)).

### 6.2 The spatial index: geohash, quadtree or H3

A B-tree on `(lat, lon)` cannot answer "within 2 km" efficiently: it orders by one dimension at a time. Spatial indexes map 2-D space to cells ([specialized databases](../../databases/specialized/index.md)).

=== "Geohash"

    Interleave the bits of longitude and latitude and encode in base32: nearby points share a **prefix** (`6gyf4…`). Prefix = cell, so "nearby" becomes "same prefix", which any sorted key-value store can answer (Redis GEO uses a 52-bit geohash as the sorted-set score). Fixed grid, simple, but cells are rectangles whose size depends on latitude, and two points across a cell border can have totally different prefixes.

=== "Quadtree"

    Recursively split a square into four children until each leaf has at most *k* drivers. **Adapts to density**: downtown gets small cells, the countryside one big cell. Usually an in-memory structure rebuilt or updated per city; moving drivers make updates frequent.

=== "H3 (hexagons)"

    Uber's open-source hierarchical index divides the globe into **hexagons** at 16 resolutions. Every neighbor of a hexagon is at the same distance from its center (squares have edge and corner neighbors), which makes "k rings around me" searches, smoothing and surge maps cleaner. Cells are IDs (64-bit integers) — easy to use as keys in any store.

| | Geohash | Quadtree | H3 |
|---|---|---|---|
| Cell shape | Rectangles, fixed grid | Squares, adaptive | Hexagons, fixed hierarchy |
| Adapts to density | No (pick a precision) | **Yes** | No (pick a resolution) |
| Neighbor search | 8 neighbors + self (edges and corners differ in distance) | Tree traversal | `k`-ring, uniform distances |
| Storage | String/integer key in any KV store | In-memory tree | 64-bit ID in any KV store |
| Typical use | Redis GEO, Elasticsearch geo, simple services | In-memory spatial services | Surge maps, analytics, dispatch at scale |

How big is a geohash cell? It depends on the precision (characters) and the latitude — computed here for São Paulo:

```python exec="1" source="tabbed-right"
import math

lat = -23.55                       # São Paulo
print("| precision | cell width (km) | cell height (km) |\n|---:|---:|---:|")
for p in range(4, 9):
    bits = 5 * p                   # base32: 5 bits per character
    lon_bits, lat_bits = (bits + 1) // 2, bits // 2
    width = 360 / 2 ** lon_bits * 111.32 * math.cos(math.radians(lat))
    height = 180 / 2 ** lat_bits * 110.57
    print(f"| {p} | {width:.3f} | {height:.3f} |")
```

Precision 6 (~1.1 × 0.6 km) is a good bucket for "drivers within a couple of km". **Border problem:** a rider at the edge of a cell may be 50 m from a driver in the next cell — always search the cell **plus its 8 neighbors** (or an H3 `k`-ring), then filter by real distance. If too few drivers are found, **expand the ring** (precision 5, or `k + 1`) until enough candidates appear or a maximum radius is reached.

### 6.3 Matching without double assignment

The dangerous moment: two riders' matchers pick the same nearest driver at the same time. The rule **one driver, one ride** needs an atomic guard ([consensus and locks](../../distributed/consensus/index.md)):

1. Candidates come from the geo index (fast, slightly stale — fine).
2. Before offering, **lock the driver**: `SET lock:driver:42 <rideId> NX PX 15000` — only one matcher wins; the lock expires if the driver ignores the offer or the matcher crashes.
3. The driver accepts → the ride service assigns with a **conditional update** (`UPDATE ride SET driver_id = 42, status = 'ACCEPTED' WHERE ride_id = $1 AND status = 'MATCHING'`), and the partial unique index guarantees the driver has no other active ride — the durable last line of defense if the lock ever misbehaves.
4. The driver declines or the offer times out → release the lock and offer the next candidate.

**Greedy vs. batched matching.** Greedy (each request takes its nearest available driver) is simple and fast. Batched matching collects requests for 1–2 seconds and solves an assignment problem over all of them (minimizing total pickup time), which is globally better in dense areas — a classic trade-off of latency for efficiency.

### 6.4 The trip as a state machine

``` mermaid-sim
stateDiagram-v2
    [*] --> MATCHING: rider requests
    MATCHING --> ACCEPTED: driver accepts offer
    MATCHING --> CANCELLED: no driver / rider cancels
    ACCEPTED --> ARRIVING: driver en route
    ARRIVING --> IN_PROGRESS: rider picked up
    ARRIVING --> CANCELLED: rider no-show (fee)
    IN_PROGRESS --> COMPLETED: drop-off
    COMPLETED --> [*]: payment captured
    CANCELLED --> [*]
```

- Every transition is a **conditional update** on the current state (idempotent under retries) and emits an event (stream) for notifications, ETA updates, receipts and analytics.
- **Payment**: authorize an estimate when the ride is accepted, capture the final fare on `COMPLETED` through the payment provider with an idempotency key (see the [payment system case](../payment-system/index.md)).
- **Phones go offline mid-trip** (tunnels): the trip continues on the server; the driver app buffers GPS points and uploads them later so the fare can be computed from the real route.

**Surge pricing** fits the same pipeline: a stream job counts open requests (demand) and available drivers (supply) per H3 cell per minute and publishes a multiplier per cell, smoothed in space and time so prices do not flicker.

---

## 7. Bottlenecks, failure modes and trade-offs

| Where | What goes wrong | Mitigation | Trade-off |
|---|---|---|---|
| Location writes | 250 k/s overload a database | Latest value in memory, history to the stream; coalesce and batch; adaptive interval | Map positions a few seconds old |
| Hot cell (stadium exit, airport) | Thousands of requests and a dense cluster in one cell | Finer cells / quadtree split there; batched matching; queue riders with honest ETA; surge to attract supply | Some riders wait or pay more |
| Double assignment | Two matchers offer the same driver | Per-driver lock with TTL + conditional update + partial unique index | Extra round trip per offer |
| Matcher crash after offer | Driver locked to a ride nobody tracks | Lock TTL; ride stuck in `MATCHING` is re-matched by a sweeper | A few seconds lost |
| Stale positions | Offering drivers who went offline | TTL on driver state; drop candidates older than N s | Fewer candidates |
| City shard down | Rides in that city fail | Replicas per city; failover; other cities unaffected (isolation) | Cross-region replication cost |
| Real-time fan-out | 140 k position pushes/s to riders | Persistent connections, push only to active trips, coarser rate when far away | Map less smooth |
| ETA service slow | Matching blocked | Timeout + fall back to straight-line distance × factor | Worse ranking for a moment |

The trade-offs to **say out loud**: **freshness vs. write cost** (positions every 4 s, not every second), **eventual consistency for positions, strong consistency for assignment** (the geo index may be stale; the driver lock and the ride row may not), and **greedy vs. batched matching** (latency vs. global efficiency).

---

## 8. Try it in the playground

The `ride-sharing` scenario models write-heavy location updates flowing through a stream into a geo index, and a matching path that reads it.

!!! tip "Try it"

    1. Run with the **load** profile and watch the write throughput on the stream and the geo index versus the much smaller ride-request path.
    2. Increase the number of drivers (load) until the geo index saturates; then add partitions/replicas (sharding by city) and compare.
    3. Switch to **spike** to imitate the end of a stadium show: which component turns into the bottleneck — the matcher or the store holding rides?
    4. Turn chaos on to fail one node of the geo index: do matches stop everywhere or only for the affected partition?

<div class="sdp" data-scenario="ride-sharing" data-mode="full" data-height="640" data-profile="load"></div>

[Open the full playground](../../../../playground/index.md){ .md-button }

---

## 9. Follow-up questions an interviewer asks

??? question "A BoxOffice stadium show ends: 60 000 people leave at once. What happens to your system?"

    One cell (or a few) gets a burst of thousands of requests while drivers are scarce and arriving from outside. Mitigations: anticipate it — the event schedule is known, so surge and driver incentives can start before the show ends; split the hot cell into finer cells for matching; use **batched matching** to assign efficiently; create **pickup zones** a few blocks away to avoid gridlock; and be honest with riders (queue position and ETA instead of repeated failed matches). The infrastructure side is a hot partition: make sure the city shard has headroom, because the spike is predictable.

??? question "Why not just use PostgreSQL with PostGIS?"

    For one city with a few thousand drivers, PostGIS with a GiST index is an excellent answer — simple and correct. The problem at scale is the **update rate**: hundreds of thousands of row updates per second, each rewriting index entries and producing WAL, for data that is obsolete in 4 seconds. An in-memory geo index for the latest positions plus SQL for rides gives each store the workload it is good at.

??? question "A driver crosses from one city shard into another."

    Shards should follow **operational regions** with a margin, so crossings are rare. When it happens, the location service writes the driver to the new shard and removes them from the old one (the TTL removes leftovers anyway); an active trip stays owned by the shard where it started until it ends. For queries near a border, search both shards.

??? question "How do you compute ETA?"

    Straight-line distance is only a filter. ETA comes from a routing engine over the road graph with live traffic (speeds learned from the location stream of all drivers), usually with precomputed shortcuts (contraction hierarchies) to answer in milliseconds. Matching asks for ETAs of the top 10–20 candidates, not all of them.

??? question "How long do you keep location history and why?"

    Trip routes are kept as long as receipts, disputes and regulations require (fare calculation, safety investigations). Points of drivers who are idle can be sampled or dropped after short-term analytics. Store them compressed in object storage, partitioned by city and day, and treat them as personal data (access control, retention policy).

??? question "How would you add shared rides (pooling)?"

    Matching becomes harder: the candidate is a driver **already on a trip** whose route can absorb a detour within limits for both riders. The geo index must include drivers on pooled trips with remaining seats, and the matcher evaluates insertion cost on the route. The state machine gains per-rider legs. It is a good place to show you know when a problem changes class (from nearest-neighbor to a constrained optimization).

---

## 10. Self-assessment rubric

| Level | What the answer contains |
|---|---|
| **Junior** | Drivers table with lat/lon updated on every report; "find drivers where distance < 2 km"; ride table. Misses the write rate and the double-assignment race. |
| **Mid** | Latest positions in an in-memory geo index (Redis GEO/geohash), history in a stream; nearby search with neighbor cells; ride state machine; a lock or conditional update to avoid double assignment; partitioning by city. |
| **Senior** | Quantifies writes and memory; compares geohash, quadtree and H3 with the border problem and ring expansion; offer locks with TTL plus a durable unique constraint; greedy vs. batched matching; adaptive update frequency; hot-cell handling with surge and pickup zones; failure modes (matcher crash, stale drivers, city shard down); payment integration with idempotency. |

**Related:** [Partitioning](../../databases/partitioning/index.md), [Specialized databases](../../databases/specialized/index.md), [Chat case](../chat/index.md) (persistent connections), [Payment system case](../payment-system/index.md), [Hands-on 6](../../../hands-on/6/index.md) (transactions and locking).

---

## How it connects { #how-it-connects }

Which classes does this case test? Each branch is a class whose ideas the design relies on (blue), with the palette components where they show up (green):

``` mermaid
flowchart LR
    CASE(["Ride sharing"]) --> EST["Estimation<br/>location writes, latest position fits in memory"]:::tech
    CASE --> DB["Databases<br/>geohash, quadtree, H3, partition by city"]:::tech
    CASE --> MSG["Messaging<br/>location stream by city"]:::tech
    CASE --> DIS["Distributed<br/>one driver, one ride: atomic guard"]:::tech
    CASE --> CMP["Compute<br/>trip state machine, payment"]:::tech
    CASE --> EDG["Edge<br/>persistent connections"]:::tech
    DB -.-> k1["cache (geo index) · sql"]:::comp
    MSG -.-> k2["stream · objstore"]:::comp
    CMP -.-> k3["payment · notifications"]:::comp
    EDG -.-> k4["mobile · apigw"]:::comp
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

**Classes it tests:** [Databases — specialized](../../databases/specialized/index.md) · [Databases — partitioning](../../databases/partitioning/index.md) · [Messaging — Kafka](../../messaging/kafka/index.md) · [Distributed — consensus](../../distributed/consensus/index.md) · [Compute — integrations](../../compute/integrations/index.md) · [Caching — Redis](../../caching/redis/index.md) (geo commands) · [Hands-on 6](../../../hands-on/6/index.md). **Palette components:** [`mobile`](../../../reference/components/client/index.md#mobile) · [`apigw`](../../../reference/components/edge/index.md#apigw) · [`stream`](../../../reference/components/messaging/index.md#stream) · [`cache`](../../../reference/components/storage/index.md#cache) · [`sql`](../../../reference/components/storage/index.md#sql) · [`objstore`](../../../reference/components/storage/index.md#objstore) · [`payment`](../../../reference/components/external/index.md#payment) · [`notifications`](../../../reference/components/compute/index.md#notifications). **Scenarios:** `ride-sharing`.

---

## References

- XU, A.; LAM, S. *System Design Interview — An Insider's Guide*, vol. 2, ch. 1 "Proximity Service" and ch. 2 "Nearby Friends"[^1].
- Uber's hexagonal hierarchical spatial index[^2].
- Redis geospatial commands (`GEOADD`, `GEOSEARCH`)[^3].
- FINKEL, R.; BENTLEY, J. *Quad Trees: A Data Structure for Retrieval on Composite Keys*[^4].

[^1]: XU, A.; LAM, S. *System Design Interview — An Insider's Guide*, vol. 2. Byte Code LLC, 2022.
[^2]: BRODSKY, I. [H3: Uber's Hexagonal Hierarchical Spatial Index](https://www.uber.com/blog/h3/){target="_blank"}. Uber Engineering Blog, 2018. Documentation: [h3geo.org](https://h3geo.org/){target="_blank"}.
[^3]: [Redis geospatial indexes](https://redis.io/docs/latest/develop/data-types/geospatial/){target="_blank"}. Redis documentation.
[^4]: FINKEL, R.; BENTLEY, J. Quad Trees: A Data Structure for Retrieval on Composite Keys. *Acta Informatica*, 4(1), 1974.
