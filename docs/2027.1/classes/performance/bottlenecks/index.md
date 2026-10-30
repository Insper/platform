The breakpoint test is done: `POST /holds` keeps its p99 under 300 ms up to about 1 100 requests per second, and the on-sale needs 4 500. Now what? Adding pods blindly may change nothing — or make things worse. This page is about the step between *measuring* and *fixing*: reading the results correctly, locating the limiting resource, seeing which code or query consumes it, and changing one thing at a time until the bottleneck sits where you want it.

---

## Reading the results

### The stepped curve

A breakpoint test that holds each rate for a couple of minutes produces one point per step: offered load, achieved throughput, p99 and errors. The table and the plot below are typical (synthetic data with noise):

```python exec="1" html="1"
# Results of a stepped breakpoint test on POST /holds (synthetic but typical data):
# each step holds the offered rate for 2 minutes; we record the achieved rate and p99.
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

rng = np.random.default_rng(7)
SLO_MS, CAPACITY = 300, 1250              # p99 objective; true saturation rate (req/s)
offered = np.arange(100, 1701, 100)

def p99_at(rate):                          # queueing-like growth near capacity
    rho = min(rate / CAPACITY, 0.995)
    return 60 + 25 * rho / (1 - rho)

served = np.array([min(r, CAPACITY - 40 * max(0, r - CAPACITY) / 100) for r in offered])
achieved = served * (1 + rng.normal(0, 0.01, len(offered)))
p99 = np.array([p99_at(r) for r in offered]) * (1 + rng.normal(0, 0.05, len(offered)))
p99 = np.minimum(p99, 5000)                # the client times out at 5 s
errors = (offered - served) / offered * 100   # requests that timed out or were rejected

ok = offered[p99 < SLO_MS]
knee = ok.max()
sat = offered[np.argmax(achieved)]

print("<table><thead><tr><th>Offered (req/s)</th><th>Achieved (req/s)</th><th>p99 (ms)</th>"
      "<th>Errors</th><th>Verdict</th></tr></thead><tbody>")
for o, a, p, e in zip(offered, achieved, p99, errors):
    if o % 200 and o not in (knee, sat):
        continue
    verdict = "within SLO" if p < SLO_MS else ("SLO broken" if a >= o * 0.97 else "saturated")
    mark = " ← knee" if o == knee else (" ← max throughput" if o == sat else "")
    print(f"<tr><td>{o}</td><td>{a:.0f}</td><td>{p:.0f}</td><td>{e:.1f} %</td><td>{verdict}{mark}</td></tr>")
print("</tbody></table>")

fig, ax1 = plt.subplots(figsize=(10, 4.2))
ax1.plot(offered, offered, color="gray", linestyle=":", linewidth=1, label="offered = achieved (ideal)")
ax1.plot(offered, achieved, "o-", color="#4C9BE8", linewidth=2, label="achieved throughput")
ax1.set_xlabel("offered load (req/s)", color="gray")
ax1.set_ylabel("throughput (req/s)", color="#4C9BE8")
ax2 = ax1.twinx()
ax2.plot(offered, p99, "s-", color="#F28E2B", linewidth=2, label="p99 latency")
ax2.axhline(SLO_MS, color="#F28E2B", linestyle="--", linewidth=1)
ax2.text(110, SLO_MS * 1.15, f"SLO p99 < {SLO_MS} ms", color="#F28E2B", fontsize=8)
ax2.set_yscale("log")
ax2.set_ylabel("p99 (ms, log)", color="#F28E2B")
ax1.axvline(knee, color="#59A14F", linestyle="--", linewidth=1)
ax1.text(knee - 330, 1450, f"knee ≈ {knee} req/s", color="#59A14F", fontsize=9)
for ax in (ax1, ax2):
    ax.tick_params(colors="gray")
    ax.spines["top"].set_visible(False)
ax1.set_title("Stepped breakpoint test of POST /holds", fontweight="bold", color="gray")
h1, l1 = ax1.get_legend_handles_labels()
h2, l2 = ax2.get_legend_handles_labels()
ax1.legend(h1 + h2, l1 + l2, frameon=False, labelcolor="gray", loc="upper left", fontsize=8)
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

Three regions are visible, and each has a name you should use in reports:

- **Up to the knee (≈ 1 100 req/s)**: achieved = offered, p99 within the SLO. This is the **usable capacity** of this deployment.
- **Between the knee and the maximum**: achieved still ≈ offered, but the p99 breaks the SLO — the system is *working*, just *too slowly*; queues are building.
- **Past the maximum (≈ 1 250 req/s)**: achieved throughput *falls* while offered keeps growing, requests time out, errors appear. The system is **saturated** and, here, retrograde: overload makes it less efficient (timeouts, retries, lock convoys).

The capacity you report is the knee: "one `inventory` deployment of 4 pods sustains **1 100 holds/s within the SLO**; it saturates at ~1 250 and degrades beyond".

### Symptoms and what they usually mean

| What you see | Likely cause | Confirm with |
|---|---|---|
| Latency rises with load **and** CPU is near 100 % | CPU-bound code path | CPU flame graph |
| Latency rises with load, **CPU stays low** | Waiting: a pool, a lock, I/O or a slow dependency | USE on pools and locks; wall-clock profile; traces |
| Throughput plateaus while offered load grows | A saturated resource (the bottleneck) | USE: find the one at 100 % or with a queue |
| Throughput **decreases** past a point | Contention / thrashing / retries (retrograde, USL) | Lock waits, GC time, retry counters |
| **Bimodal** latency histogram (two humps) | Two code paths: cache hit vs miss, fast vs slow shard, retries | Split by tag (cache status, shard) |
| Periodic spikes at fixed intervals | GC cycles, cron jobs, database checkpoints, log rotation, token refresh | Correlate timestamps with GC logs, cron schedules, DB logs |
| Latency grows slowly at **constant** load | Leak or unbounded growth (memory, connections, table bloat) | Soak test trends; heap after GC |
| Errors only in the first minutes | Cold start: JIT, empty pools and caches, autoscaling lag | Compare with a warmed-up run |
| Client p99 ≫ server-side p99 | Queueing *before* the service (load balancer, accept queue, CPU throttling) — or coordinated omission in server metrics | Compare gateway and service histograms; throttling counters |

---

## A catalogue of common bottlenecks

| Bottleneck | Typical sign | Typical fix |
|---|---|---|
| **Missing or wrong index** | One query dominates `pg_stat_statements`; `Seq Scan` with many rows removed | Index matching the filter and sort; partial index |
| **N+1 queries** | A trace with one parent span and dozens of identical DB spans | Join or batch fetch (`IN (...)`), entity graph, DTO projection |
| **Connection-pool exhaustion** | Hikari `pending` > 0; latency ≈ pool wait | Shorter transactions first; then size the pool; PgBouncer |
| **Lock contention / hot rows** | DB CPU low, sessions waiting on `Lock: tuple` or `transactionid` | Shorter transactions, `SKIP LOCKED`, finer-grained rows, queue the writes |
| **Thread-pool exhaustion** | All request threads busy, CPU low | Find what they wait on (usually one of the above or a dependency); timeouts; virtual threads for I/O-bound code |
| **Slow dependency** | Wide `HttpClient`/socket-read frames in wall-clock profiles; long client spans | Timeouts, circuit breaker, bulkhead, caching, async |
| **GC pressure** | GC time > 5–10 %, allocation-heavy flame graph | Reduce allocations (big JSON, logging), right-size the heap, a low-pause collector |
| **CPU throttling** | p99 spikes with moderate average CPU; `nr_throttled` growing | Raise/remove the CPU limit, fewer threads, more pods |
| **Serialization** | `ObjectMapper`/JSON frames wide in CPU profiles | Smaller payloads, pagination, avoid serializing twice |
| **Synchronous logging** | Logger frames in the hot path; disk I/O on the node | Async appenders, lower log level, sampling |
| **Cache problems** | Low hit ratio; stampede after expiry; one hot key | See [Caching — failure modes](../../caching/failure-modes/index.md) |
| **Network limits** | Connection resets, ephemeral-port or conntrack exhaustion at high RPS | Keep-alive and connection reuse, HTTP/2, tune limits |

---

## Profiling: from "which resource" to "which code"

Metrics tell you that `inventory` spends its time waiting or burning CPU; a **profiler** tells you *which code* does it. Modern profilers are **sampling** profilers: many times per second they record the stack trace of each thread, and the code that appears in many samples is where the time goes. The overhead is low enough (typically a few percent) to profile under load, even in production.

Two kinds of profile answer different questions:

- **On-CPU** profiles sample only threads that are *running*. They find CPU-heavy code — serialization, regexes, hashing, TLS.
- **Off-CPU / wall-clock** profiles sample threads whatever they are doing, *including waiting* for locks, sockets and pools. When CPU is low but latency is high — the common case — **only a wall-clock profile shows where the time goes.**

### Reading a flame graph

A **flame graph** draws the sampled stacks as nested boxes[^1]:

- each box is a function (a stack frame); the box below it is its caller;
- the **width** is the share of samples in which the function was on the stack — wider means more time;
- the **x-axis is not time**: frames are sorted alphabetically to merge identical stacks;
- look for **wide boxes near the top** (where time is actually spent) and for unexpectedly wide subtrees.

```python exec="1" html="1"
# A (simplified) wall-clock flame graph of inventory's POST /holds, drawn from
# sample counts. Width = share of samples; y = stack depth; x order is alphabetical, NOT time.
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
from io import StringIO

# frame -> (samples spent in this frame itself, {children})
TREE = ("HoldController.hold", 0, [
    ("HoldService.hold", 0, [
        ("Logger.info", 3, []),
        ("ObjectMapper.writeValue", 5, []),
        ("TransactionTemplate.execute", 0, [
            ("HikariPool.getConnection", 22, []),
            ("HoldRepository.save", 6, []),
            ("PricingClient.quote", 0, [("HttpClient.send", 0, [("SocketInputStream.read", 26, [])])]),
            ("SeatRepository.lockSeats", 0, [("PgStatement.execute", 0, [("SocketInputStream.read", 30, [])])]),
        ]),
    ]),
])

def total(node):
    return node[1] + sum(total(c) for c in node[2])

COLORS = ["#F28E2B", "#E15759", "#EDC948", "#FF9D9A", "#F1A340", "#D37295"]
fig, ax = plt.subplots(figsize=(11, 3.8))
ALL = total(TREE)

def draw(node, x, depth):
    w = total(node) / ALL
    ax.add_patch(Rectangle((x, depth), w, 0.92, facecolor=COLORS[(depth + len(node[0])) % len(COLORS)],
                           edgecolor="white", linewidth=1))
    label = node[0] if w > 0.11 else (node[0][:9] + "…" if w > 0.07 else "")
    ax.text(x + 0.004, depth + 0.46, f"{label} {w:.0%}" if w > 0.11 else label,
            va="center", fontsize=7.5, color="black", clip_on=True)
    cx = x
    for child in sorted(node[2], key=lambda c: c[0]):          # alphabetical, like flame graphs
        draw(child, cx, depth + 1)
        cx += total(child) / ALL

draw(TREE, 0, 0)
ax.set_xlim(0, 1)
ax.set_ylim(0, 6)
ax.set_yticks([])
ax.set_xticks([0, 0.25, 0.5, 0.75, 1.0])
ax.set_xticklabels(["0 %", "25 %", "50 %", "75 %", "100 % of samples"], color="gray")
ax.set_title("Wall-clock flame graph of POST /holds (simplified)", fontweight="bold", color="gray")
for side in ("top", "right", "left"):
    ax.spines[side].set_visible(False)
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

Reading this wall-clock profile of `POST /holds` top-down: almost all the time is inside `TransactionTemplate.execute` — and inside it, a third of the samples wait on a socket read inside `SeatRepository.lockSeats` (the database is making us wait for **row locks**), more than a quarter wait on a socket read inside `PricingClient.quote` (an HTTP call **inside the transaction**, holding the connection and the locks), and almost a quarter wait in `HikariPool.getConnection` (**pool exhaustion**, caused by the two previous items). JSON and logging, the usual suspects, are thin slivers. A CPU flame graph of the same service would have shown mostly JSON and logging, and pointed at the wrong fix.

### async-profiler for the JVM

**async-profiler** is a low-overhead sampling profiler for Java that avoids the *safepoint bias* of older JVM profilers and produces flame graphs directly[^2]. It attaches to a running JVM:

```bash
# distroless images have no shell: attach an ephemeral debug container that shares
# the pod's process namespace, built from an image that contains async-profiler
kubectl debug -it inventory-7f9c-x2k8p --image=<your-debug-image-with-async-profiler> --target=inventory

asprof -d 30 -e cpu   -f /tmp/cpu.html   1    # on-CPU samples, 30 s, JVM is PID 1
asprof -d 30 -e wall  -t -f /tmp/wall.html 1  # wall-clock, split by thread: includes waiting
asprof -d 30 -e lock  -f /tmp/lock.html  1    # contended Java monitors and locks
asprof -d 30 -e alloc -f /tmp/alloc.html 1    # allocation hot spots (GC pressure)
```

Run the profiler **while the load test is at the plateau** — a profile of an idle service shows only idle code. If `perf_events` are not permitted in the container, `-e itimer` (or `ctimer`) is a CPU-sampling fallback. The JDK's built-in **Java Flight Recorder** is the alternative with no extra tool (`jcmd 1 JFR.start duration=60s filename=/tmp/inventory.jfr settings=profile`); open the recording in JDK Mission Control or convert it to a flame graph with async-profiler's converter.

### py-spy for Python

The `assistant` service is Python (FastAPI). **py-spy** is a sampling profiler that reads the interpreter's memory from outside the process — no code changes, no restart[^3]:

```bash
py-spy top    --pid 1                                   # live "top" of Python functions
py-spy record --pid 1 --duration 30 -o cpu.svg          # flame graph (SVG) of running code
py-spy record --pid 1 --duration 30 --idle -o wall.svg  # include idle/waiting threads
py-spy dump   --pid 1                                   # current stack of every thread, once
```

In a container py-spy needs the `SYS_PTRACE` capability (add it to the debug container, not to the application). For `asyncio` code, remember that waiting coroutines are not threads: a wall-clock view of the event loop shows *where the loop is blocked* — the classic bug being a synchronous call (a blocking HTTP client, CPU-heavy parsing) inside an `async def` handler.

### Continuous profiling

Profiling only during incidents means you have no "before" to compare with. **Continuous profiling** samples every instance all the time at low frequency and stores the profiles like metrics (Grafana Pyroscope, cloud profilers; OpenTelemetry is adding profiles as a fourth signal). It enables **differential flame graphs** — this version vs the previous one — which make performance regressions in a canary obvious.

---

## Database bottlenecks

The database is the most common bottleneck of a system like BoxOffice, because it is the one component that is hard to scale horizontally and that every write must reach.

### Which queries?

Start from the aggregate, not from a guess. The `pg_stat_statements` extension records statistics for every normalized query:

```sql
SELECT left(query, 70)                         AS query,
       calls,
       round(total_exec_time)                  AS total_ms,
       round(mean_exec_time::numeric, 2)       AS mean_ms,
       round(100 * total_exec_time / sum(total_exec_time) OVER (), 1) AS pct
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;
```

Sort by **total** time, not mean: a 2 ms query called 3 000 times per second costs more than a 2 s report run once an hour.

### Why is it slow? `EXPLAIN ANALYZE`

`EXPLAIN` shows the plan the optimizer chose; `EXPLAIN (ANALYZE, BUFFERS)` *executes* the query and reports real times, real row counts and pages read[^4]. The seat-map query of the on-sale:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, section, row_label, seat_number, price_cents
FROM seats
WHERE event_id = 4242 AND status = 'AVAILABLE'
ORDER BY section, row_label, seat_number
LIMIT 8;
```

```text title="Before: no suitable index (illustrative output, simplified)"
Limit  (cost=187432.10..187432.12 rows=8 width=40) (actual time=412.551..412.555 rows=8 loops=1)
  Buffers: shared hit=2112 read=59861
  ->  Sort  (cost=187432.10..187507.10 rows=30000 width=40) (actual time=412.549..412.551 rows=8 loops=1)
        Sort Key: section, row_label, seat_number
        Sort Method: top-N heapsort  Memory: 26kB
        ->  Seq Scan on seats  (cost=0.00..186832.00 rows=30000 width=40) (actual time=0.031..405.127 rows=31480 loops=1)
              Filter: ((event_id = 4242) AND (status = 'AVAILABLE'::text))
              Rows Removed by Filter: 5968520
Planning Time: 0.142 ms
Execution Time: 412.601 ms
```

How to read it, bottom-up (the innermost node runs first):

- **`Seq Scan` with `Rows Removed by Filter: 5968520`** — PostgreSQL read all 6 million seats of all events to keep 31 480. That is the problem.
- **`Buffers: … read=59861`** — about 60 000 pages (8 KB each, ≈ 470 MB) came from disk or the OS cache rather than PostgreSQL's buffer cache. Under load, this is I/O saturation.
- **`Sort … top-N heapsort`** — sorting 31 480 rows to keep 8; cheap here, but avoidable.
- Compare **estimated** `rows=30000` with **actual** `rows=31480`: close, so statistics are fine. A large mismatch (100× off) would point at stale statistics (`ANALYZE`) or correlated columns.

A partial index that matches both the filter and the sort order lets PostgreSQL read the first 8 available seats directly, in order:

```sql
CREATE INDEX CONCURRENTLY seats_available_idx
    ON seats (event_id, section, row_label, seat_number)
    WHERE status = 'AVAILABLE';
```

```text title="After: index scan (illustrative output, simplified)"
Limit  (cost=0.43..9.87 rows=8 width=40) (actual time=0.041..0.058 rows=8 loops=1)
  Buffers: shared hit=5
  ->  Index Scan using seats_available_idx on seats  (cost=0.43..35392.11 rows=30000 width=40) (actual time=0.040..0.055 rows=8 loops=1)
        Index Cond: (event_id = 4242)
Planning Time: 0.210 ms
Execution Time: 0.079 ms
```

From 412 ms to 0.08 ms and from ~62 000 pages to 5. `CONCURRENTLY` builds the index without blocking writes — essential on a live table. (Indexes are not free: each one slows down writes and uses memory; index what the workload model says is hot.)

!!! example "In the BoxOffice code: an index instead of a cache (lab 6)"

    [Hands-on 6 — Indexes](../../../hands-on/6/indexes/index.md) does this on the slow endpoint since lab 1, the catalog listing "upcoming events in a city, soonest first". `EXPLAIN ANALYZE` showed a `Parallel Seq Scan` and a sort of 200,000 rows to return 20. An index in `starts_at` order lets PostgreSQL walk the events already sorted and stop after one page (189 index entries read): in the lab's run the page query went from ~37 ms to 0.62 ms, and the count from ~14 ms to ~4 ms through an *Index Only Scan*. The migration is a new file — `V1` and `V2` are never edited — and the lab measures it with the cache turned off, so the index is judged on its own.

    ``` { .sql title="services/catalog/src/main/resources/db/migration/V3__index_events.sql" }
    --8<-- "docs/2027.1/hands-on/6/code/services/catalog/src/main/resources/db/migration/V3__index_events.sql"
    ```

### Lock contention and hot rows

When everyone wants the same seats, transactions queue for **row locks**. Find who waits for whom:

```sql
SELECT pid,
       pg_blocking_pids(pid)        AS blocked_by,
       wait_event_type, wait_event,
       now() - query_start          AS waiting_for,
       left(query, 60)              AS query
FROM pg_stat_activity
WHERE cardinality(pg_blocking_pids(pid)) > 0;
```

Three changes reduce contention, in order of effort:

1. **Keep transactions short.** Never call another service (pricing, payment) while holding a transaction: compute the price before `BEGIN`, call the payment provider after `COMMIT` (with an outbox or a saga — see [Messaging — patterns](../../messaging/patterns/index.md)).
2. **Do not fight for the same row.** When the fan asks for "2 seats in section A", any two free seats will do. `SKIP LOCKED` lets concurrent transactions take *different* free rows instead of queuing on the first one:

    ```sql
    BEGIN;
    SELECT id FROM seats
    WHERE event_id = 4242 AND section = 'A' AND status = 'AVAILABLE'
    ORDER BY row_label, seat_number
    LIMIT 2
    FOR UPDATE SKIP LOCKED;
    UPDATE seats
       SET status = 'HELD', held_by = $1, hold_expires_at = now() + interval '10 minutes'
     WHERE id = ANY($2);
    COMMIT;
    ```

3. **Control admission.** If 50 000 fans try to hold seats in the same second, no locking strategy makes PostgreSQL happy. A waiting room admits fans at the rate the inventory can absorb — turning contention into an orderly queue ([Messaging — queues](../../messaging/queues-pubsub/index.md)).

### Sizing the connection pool

A connection pool can be a bottleneck in both directions: too small and requests wait for a connection; too large and the database spends its time switching between hundreds of sessions, fighting over locks and memory. Size it with Little's Law — **connections needed = throughput × time each request holds a connection**:

| Design of `POST /holds` | Connection held for | At 1 500 holds/s | Per pod (10 pods) |
|---|---|---|---|
| Pricing call **inside** the transaction | 6 ms SQL + 40 ms HTTP = 46 ms | 1 500 × 0.046 ≈ **69** connections busy | ~7, more for bursts |
| Pricing call **before** the transaction | 6 ms | 1 500 × 0.006 ≈ **9** connections busy | ~1, keep a small pool |

The first fix is not a bigger pool — it is holding the connection for less time. Then size for the **database's** capacity: PostgreSQL works best with a number of *active* connections in the order of a few times its CPU cores (HikariCP's often-quoted starting point is `connections ≈ cores × 2 + effective spindles`)[^5]. Twenty pods × a pool of 20 = 400 connections is far beyond that; put **PgBouncer** in transaction-pooling mode between the pods and the database so that hundreds of client connections share a few dozen server connections. And fail fast:

```yaml title="inventory/src/main/resources/application.yaml"
spring:
  datasource:
    hikari:
      maximum-pool-size: 10
      minimum-idle: 10            # a fixed-size pool: no ramp-up during the spike
      connection-timeout: 2000    # wait at most 2 s for a connection (the default is 30 s)
```

!!! example "In the BoxOffice code: a pool that moves the knee, and a pooler (labs 2 and 6)"

    In [Hands-on 2](../../../hands-on/2/index.md) the pool of `catalog` (10 connections, `DB_POOL_SIZE`) is the first resource to saturate, and raising it to 30 moves the knee up — until the single CPU of `catalog` or PostgreSQL saturates next. [Hands-on 6 — Replicas and PgBouncer](../../../hands-on/6/replicas/index.md) then counts what bigger pools cost: every replica of every service opens its own. In transaction pooling, PgBouncer lends one of 20 real connections for one transaction at a time: in the lab's run PostgreSQL saw about 60 application connections, 20 of them from PgBouncer serving all of `inventory`. Without it, `INVENTORY_POOL_SIZE=40` against `max_connections=80` fails with `too many clients already`; with it, the same demand becomes **queueing** (`cl_waiting`). The price: session features (Flyway's locks) must bypass the pooler.

    ``` { .ini title="infra/pgbouncer/pgbouncer.ini" }
    --8<-- "docs/2027.1/hands-on/6/code/infra/pgbouncer/pgbouncer.ini"
    ```

---

## One change at a time: an optimization log

Keep a log of every run: what changed, the new knee, and what saturated next. A bottleneck removed reveals the next one; the goal is not "no bottleneck" (there is always one) but the bottleneck **in the right place** with enough capacity. The log below is illustrative of a typical campaign on `POST /holds`:

| Run | Change (one per run) | Knee (holds/s within SLO) | What saturated next |
|---|---|---|---|
| 1 | Baseline: 4 pods, pool 10 | 400 | PostgreSQL I/O (seat-map `Seq Scan`) |
| 2 | Partial index on available seats | 700 | Hikari pool: 10/10 active, 150 pending |
| 3 | Pricing call moved out of the transaction | 1 100 | Row-lock waits on hot sections |
| 4 | `FOR UPDATE SKIP LOCKED` for seat selection | 1 800 | `inventory` CPU 85 % (JSON, TLS) |
| 5 | 4 → 10 pods (HPA min), PgBouncer | 3 400 | PostgreSQL primary CPU 80 % |
| 6 | Waiting room admitting 3 000 holds/s | 3 000 admitted, p99 140 ms | — by design: admission is the limit |

After run 6 the bottleneck is deliberate: the waiting room's admission rate, set below the database's knee. Scaling further would require partitioning inventory by event or venue ([Databases — partitioning](../../databases/partitioning/index.md)) — a much bigger change, now justified by numbers.

Try it: the `monolith` scenario (one app server and one PostgreSQL, the **breakpoint** profile) produces the first two lines of such a log in a few minutes. Run it as it is and open the Report: the bottleneck is `app`, already 86 % busy at about 430 req/s, and the system breaks at about **590 req/s**. Change one thing — select `app` and raise its replicas to 6 — and run again: the breaking point jumps to about **2,520 req/s**, and the bottleneck moves to `db`, 87 % busy at about 2,180 req/s. Now change the *wrong* thing: 12 replicas instead of 6. The breaking point stays at about 2,520 req/s while the monthly cost goes from about 1,170 to 1,890 USD — adding capacity to a component that is not the bottleneck buys nothing.

<div class="sdp" data-scenario="monolith" data-mode="full" data-profile="breakpoint" data-height="620"></div>

!!! tip "In the interview"

    In the "bottlenecks and trade-offs" step, walk the request path and name the **first resource to saturate** with a number: "At 4 500 holds/s the primary database is the bottleneck — every hold is a locking write. I would keep transactions short, use `SKIP LOCKED` so fans do not queue on the same row, size pools with Little's Law behind PgBouncer, and put a waiting room in front so admission never exceeds what the database can take." Mentioning **wall-clock vs CPU profiling** and **`EXPLAIN ANALYZE`** shows you have actually found bottlenecks, not just drawn boxes.

!!! success "Best practices"

    - **Turn on `pg_stat_statements` and slow-query logging in every environment from day one** — for example `log_min_duration_statement = 200ms`; the question "which query?" is asked during an incident, about data that must already exist.
    - **Ship every index as a new versioned migration, and build it `CONCURRENTLY` on large live tables** — the schema change is reviewed, repeatable in every environment and does not block writes. In BoxOffice: `V3__index_events.sql` of [lab 6](../../../hands-on/6/indexes/index.md).
    - **Put a pooler in front of PostgreSQL once several services and replicas connect, and fail fast on connection waits** — transaction pooling keeps the server connections near what Little's Law needs; a 2 s `connection-timeout` instead of 30 s turns a queue into a clear error. In BoxOffice: `infra/pgbouncer/pgbouncer.ini` of [lab 6](../../../hands-on/6/replicas/index.md).
    - **Keep the optimization log in the repository** — one row per run: the change, the new knee, what saturated next; it is the evidence behind every capacity number. In BoxOffice: the pool 10 vs pool 30 sweeps of [lab 2](../../../hands-on/2/index.md).
    - **Run continuous profiling in production at a low sampling rate** — a few percent of overhead buys the flame graph of the incident before anyone asks for it.

!!! warning "Pitfalls"

    - **Profiling an idle system**: profile at the load-test plateau.
    - **CPU flame graphs for a waiting problem**: use wall-clock (off-CPU) profiles when CPU is low.
    - **Optimizing by mean query time**: sort by total time; frequent cheap queries dominate.
    - **`EXPLAIN` without `ANALYZE`** on a slow query: estimates are not measurements.
    - **Growing the pool to fix pool waits**: first shorten what holds the connection; bigger pools move the queue into the database.
    - **Changing three things at once**: you will not know which one helped — or which one hurt.

---

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    CURVE["stepped curve<br/>and symptoms"] --> RES["which resource?<br/>USE → Methodology"]
    RES --> PROF["which code? flame graphs,<br/>async-profiler, py-spy"]
    RES --> DBQ["which query? pg_stat_statements,<br/>EXPLAIN ANALYZE"]
    DBQ --> IDX["indexes, N+1<br/>→ Databases models"]
    DBQ --> LOCK["hot rows, SKIP LOCKED<br/>→ Databases transactions"]
    DBQ --> POOL["pool sizing by Little's Law,<br/>PgBouncer"]
    RES --> CACHE["low hit ratio, stampede<br/>→ Caching failure modes"]
    RES --> DEP["slow dependency<br/>→ Reliability patterns"]
    PROF --> LOG["one change at a time:<br/>the optimization log"]
```

**Palette components:** [`app`](../../../reference/components/compute/index.md#app) (CPU, GC, thread pools, serialization) · [`sql`](../../../reference/components/storage/index.md#sql) (indexes, locks, connection pools) · [`cache`](../../../reference/components/storage/index.md#cache) (hit ratio, hot keys, stampedes) · [`queue`](../../../reference/components/messaging/index.md#queue) (taking contended writes off the request path) · [`thirdparty`](../../../reference/components/external/index.md#thirdparty) (slow dependencies) · [`tracing`](../../../reference/components/observability/index.md#tracing) (N+1 queries show up as dozens of identical spans) and [`metrics`](../../../reference/components/observability/index.md#metrics) (pool and throttling counters). **Scenarios:** `monolith` (breakpoint profile: find the first resource to saturate), `read-heavy-cache`, `flash-sale` (hot seat rows). **Continues in:** [Databases — transactions](../../databases/transactions/index.md), [Databases — partitioning](../../databases/partitioning/index.md), [Caching — failure modes](../../caching/failure-modes/index.md), [Messaging — queues and pub/sub](../../messaging/queues-pubsub/index.md), [Reliability — patterns](../../reliability/patterns/index.md), [Capacity planning](../capacity-planning/index.md).

---

[^1]: GREGG, B. [The Flame Graph](https://queue.acm.org/detail.cfm?id=2927301){target="_blank"}. *ACM Queue*, v. 14, n. 2, 2016.
[^2]: PANGIN, A. et al. [async-profiler](https://github.com/async-profiler/async-profiler){target="_blank"}.
[^3]: FREDERICKSON, B. [py-spy: Sampling profiler for Python programs](https://github.com/benfred/py-spy){target="_blank"}.
[^4]: PostgreSQL documentation. [Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html){target="_blank"}; [pg_stat_statements](https://www.postgresql.org/docs/current/pgstatstatements.html){target="_blank"}.
[^5]: HikariCP wiki. [About Pool Sizing](https://github.com/brettwooldridge/HikariCP/wiki/About-Pool-Sizing){target="_blank"}.
