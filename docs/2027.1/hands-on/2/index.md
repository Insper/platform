!!! abstract "In this lab"

    - Write **load**, **stress** and **sweep** tests for `catalog` with k6, using an **open workload model**.
    - Find the **knee**: the arrival rate where latency stops being flat and explodes.
    - Check **Little's Law** with numbers taken from *inside* the service (busy threads, database connections) and identify the **bottleneck**.
    - Change one thing (the connection pool) and **measure again**: did the bottleneck move?

"Measure first" is the most useful habit in system design. Before adding a cache, a replica or ten more servers, you need to know **how much load the current system takes, where it breaks and why**. Guessing is how teams spend a month on a cache for a service whose real limit was a connection pool of 10. In this lab you treat `catalog` as a black box with a load generator in front (k6) and a few gauges inside (Actuator), and you produce the most important chart of the course: **latency against throughput**.

## Before you start { #before-you-start }

| | |
|---|---|
| **Time** | 2–3 hours (each sweep takes ~10 minutes of waiting: start it and read the next section) |
| **You need** | the tools of lab 0 (k6, uv, jq); Docker with at least **4 GB**; close heavy applications while measuring |
| **Directory** | every command runs from the root of your `boxoffice/` repository (Windows: inside WSL 2) |

``` { .bash .copy }
docker compose version        # Docker Compose v2.x (or newer)
java -version                 # 21 or newer
mvn -v                        # Apache Maven 3.9+
k6 version                    # k6 v1.0+
uv --version                  # uv (runs the Python helper scripts)
```

**Start state** — the end of lab 1, with the stack running (`docker compose up -d`, `catalog` healthy):

``` { .tree title="boxoffice/ at the start of lab 2" }
boxoffice/
    docker-compose.yaml        # db + catalog (port 8082)
    load/hello.js  load/smoke.js
    results/lab0.md  results/lab1.md
    scripts/check-env.sh
    services/catalog/          # the service of lab 1
```

!!! tip "Catch up"

    Skipped or broke lab 1? Download [boxoffice-after-lab-1.zip](../1/boxoffice-after-lab-1.zip), unzip it, `cd boxoffice` and run `docker compose up --build -d`. This lab only **adds** files (k6 scripts and helpers); all of them are shown in full below and are in [`code/`](code/load/load.js).

## Slides

<div class="slides-embed">
  <iframe src="slides/measure.html" title="Slides: hands-on 2 — measure first" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/measure.html){:target="_blank"}

!!! info "Theory connection"

    - In the [story of the course](../../index.md#story), this lab closes chapter 2 and opens chapter 3: it replaces the *assumed* service time of the class's [capacity check](../../classes/estimation/index.md) with a *measured* knee, and shows that one instance leaves its latency target at a few hundred requests per second — far from the on-sale's demand, so BoxOffice needs [more machines](../../classes/distributed/index.md).
    - Class 2, [Estimation](../../classes/estimation/index.md): [queueing and Little's Law](../../classes/estimation/queueing/index.md), [percentiles and tail latency](../../classes/estimation/percentiles/index.md).
    - Class 15, [Performance engineering](../../classes/performance/index.md): [load-test types](../../classes/performance/load-testing/index.md), [finding bottlenecks](../../classes/performance/bottlenecks/index.md).

## Before you measure: a hypothesis

The playground runs the same experiment in seconds. Form a hypothesis first, then check it against the real service.

**Try it:** the `monolith` scenario below starts with the *breakpoint* profile — the load grows until something gives. Watch which component turns red first and how p99 behaves just before. Then write down your guess for `catalog`: *"it will break at about ___ req/s because ___ saturates first"*.

<div class="sdp" data-scenario="monolith" data-mode="compact" data-profile="breakpoint" data-height="480"></div>

## 1. Closed or open workload?

In lab 0 each virtual user (VU) sent a request, waited for the answer, and sent the next one. That is a **closed** model: when the server slows down, the load generator slows down with it, and the test politely stops pushing. Real fans do not wait for each other: at 10:00 they arrive at whatever rate they arrive. That is an **open** model.

| | Closed model (`vus`, `constant-vus`) | Open model (`constant-arrival-rate`, `ramping-arrival-rate`) |
|---|---|---|
| You set | number of concurrent users | **arrival rate** (requests per second) |
| When the server slows down | k6 sends fewer requests | k6 keeps the rate and starts more VUs |
| Good for | "N users working in a back office" | public websites, APIs, flash sales |
| Hides overload? | **yes** — throughput drops quietly (*coordinated omission*) | no — latency and queue grow visibly |
| Signal of saturation | latency up, throughput flat | latency explodes, **`dropped_iterations`** > 0 |

!!! warning "Coordinated omission"

    A closed-model tester that waits for slow responses *omits* the requests it would have sent meanwhile — exactly the ones that would have suffered the worst latency. The result looks better than reality. Prefer arrival-rate executors when the question is "can we take X requests per second?"[^1].

## 2. The scripts

The **load test** keeps a constant arrival rate (`RATE`) for a fixed time, with a realistic mix: 80% event details and 20% city listings.

``` { .javascript title="load/load.js" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/2/code/load/load.js"
```

The **stress test** climbs a staircase of rates past the knee, holds the peak and then drops back to a low rate. The question is not only "where does it break?", but "**does it recover by itself** when the load goes away?".

``` { .javascript title="load/stress.js" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/2/code/load/stress.js"
```

| Test | Executor | Question |
|---|---|---|
| smoke (`load/smoke.js`, lab 1) | 1 VU | does it work, and how fast without load? |
| load (`load/load.js`) | `constant-arrival-rate` | at X req/s, what are p50/p95/p99 and the error rate? |
| sweep (`scripts/sweep.sh`) | many `load.js` runs | where is the knee? |
| stress (`load/stress.js`) | `ramping-arrival-rate` | what happens past the knee, and does it recover? |

## 3. Watch from the inside

k6 sees the service from the outside. To find *why* latency grows you need gauges from the inside. Spring Boot Actuator already publishes them:

| Metric | Meaning | Limit |
|---|---|---|
| `tomcat.threads.busy` | requests being processed right now | `server.tomcat.threads.max` = 200 |
| `hikaricp.connections.active` | database connections in use | pool size (`DB_POOL_SIZE`, default **10**) |
| `hikaricp.connections.pending` | requests **waiting** for a connection | — (should be 0) |

``` { .bash title="scripts/watch-metrics.sh" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/2/code/scripts/watch-metrics.sh"
```

Keep three terminals open during every test: k6, `bash scripts/watch-metrics.sh`, and `docker stats` (CPU of `catalog` and `db`).

You should see one line per second (at overload, one every few seconds: the request that reads the metrics waits for a free Tomcat thread too). At rest `busy_threads` is 1 (the request that reads the metric); under load it follows Little's Law, and at overload the pool fills up (lines from a run for this lab, at 50, 400 and 600 req/s):

``` { .text }
time      busy_threads  db_active  db_pending
03:43:21           1.0        0.0         0.0
03:45:19          12.0       10.0         3.0
03:46:15         200.0        9.0       190.0
```

## 4. Find the knee

Run `load.js` at increasing rates, one minute each, and save each summary. The sweep script does the bookkeeping (and a warm-up first: a cold JVM would spoil the first point):

``` { .bash title="scripts/sweep.sh" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/2/code/scripts/sweep.sh"
```

``` { .python title="scripts/summarize.py" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/2/code/scripts/summarize.py"
```

``` { .bash .copy }
docker compose up -d                       # catalog + db from lab 1
bash scripts/sweep.sh 50 100 200 300 400 500 600
uv run scripts/summarize.py results/lab2/rate-*.json
```

`sweep.sh` prints one line per step (`>>> warm-up: 30 s at RATE=50 (not recorded)`, then `>>> RATE=50 req/s for 1m`, …) and takes about 10 minutes for seven rates. Steps past the knee also print `level=error msg="thresholds on metrics ... have been crossed"`: the latency thresholds of `load.js` failed, which is expected there — the summary is saved anyway. `summarize.py` then prints a Markdown table like the one below — paste it into `results/lab2.md`.

An example run on a laptop (catalog limited to 1 CPU, pool of 10 connections):

| offered (req/s) | throughput (req/s) | p50 (ms) | p95 (ms) | p99 (ms) | p99 detail | p99 list | errors | dropped | max VUs |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 | 50 | 1.3 | 29.2 | 41.3 | 6.5 | 89.7 | 0.0% | 0 | 50 |
| 100 | 100 | 0.6 | 23.6 | 32.9 | 3.9 | 41.4 | 0.0% | 0 | 100 |
| 200 | 200 | 0.5 | 21.9 | 33.5 | 5.5 | 59.3 | 0.0% | 0 | 200 |
| 300 | 300 | 0.6 | 24.9 | 38.6 | 8.5 | 59.0 | 0.0% | 0 | 300 |
| 400 | 400 | 1.5 | 49.6 | 223.7 | 199.1 | 294.4 | 0.0% | 0 | 400 |
| 500 | 490 | 15.0 | 982.5 | 2056.2 | 1984.9 | 2238.8 | 0.0% | 410 | 556 |

Past 500 req/s the numbers jump around from run to run — a sign that the service is overloaded and queues decide the outcome, not the code.

```python exec="1" html="1"
--8<-- "docs/2027.1/hands-on/2/knee.py"
```

How to read it:

- **Below the knee**, throughput equals the offered rate and p99 is roughly flat: requests rarely wait for each other.
- **At the knee**, a resource reaches ~100% busy. Small increases in load produce **large** increases in latency — the queueing curve from class 2 (`W ≈ S / (1 − ρ)`).
- **Past the knee**, throughput stops following the offered rate, `dropped_iterations` appears (k6 ran out of VUs to keep the rate), and p99 is measured in **seconds**. Users have already left.

!!! tip "Capacity is the knee, not the maximum"

    The useful capacity of this instance is the highest rate **with p99 inside the target** (say 300 ms), not the highest throughput the summary ever printed. Plan with a safety margin below the knee: the next spike will not ask permission.

## 5. Little's Law check

Little's Law holds for any stable system[^2]: **L = λ × W** — the average number of requests inside (`L`) equals the arrival rate (`λ`) times the average time each one spends inside (`W`). Apply it to two boundaries:

1. **The whole service**: `L` should match `tomcat.threads.busy`. At 300 req/s with an average latency of 10 ms, `L = 300 × 0.010 = 3` busy threads.
2. **The database pool**: each request holds a connection for its database time. The pool is a server with **10 slots**, so it saturates when `λ × (database time per request) = 10`.

That second line predicts the knee. Measure the database time per request with one user (lab 1): if the mix averages ~8 ms of database time per request *without load*, the pool would allow `10 / 0.008 ≈ 1,250 req/s`. The knee you measured is much lower — because under load the queries get slower (the database and the single catalog CPU are busy too), so each request holds its connection longer. Look at `watch-metrics.sh` around the knee: `db_active` sits at **10** and `db_pending` starts to grow. The pool is full; requests queue for it.

??? question "Think first: busy threads reach 200 and `db_pending` 190 at 600 req/s. What does that mean?"

    Tomcat has 200 threads, all busy; 10 hold a database connection and **190 are waiting for one**. The service is not short of threads or CPU in the web layer — it is short of database connections (or of database speed). Adding Tomcat threads would only add waiters. This is the "find the narrowest pipe" exercise of the course: the bottleneck is the resource whose queue grows.

## 6. Move the bottleneck

Change one variable, measure again. The pool size is configurable without rebuilding (`DB_POOL_SIZE`, wired in lab 1):

``` { .bash .copy }
DB_POOL_SIZE=30 docker compose up -d catalog        # recreate catalog with a bigger pool
OUT=results/lab2-pool30 bash scripts/sweep.sh 50 100 200 300 400 500 600
uv run scripts/summarize.py results/lab2-pool30/rate-*.json
```

Compare the two tables. Typically the knee moves **up**, but not forever: with 30 connections, the next resource saturates — the single CPU of `catalog`, or PostgreSQL itself (watch `docker stats`). A bigger pool also has a cost: every connection is a process in PostgreSQL, and in lab 6 three services × three replicas × 30 connections would exceed `max_connections`. Optimizing one resource always moves the bottleneck somewhere else; the job is to know where it went.

## 7. Stress: past the knee and back

``` { .bash .copy }
docker compose up -d catalog       # back to the default pool (10): PEAK=600 is past its knee
K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=results/lab2-stress.html \
  k6 run -e PEAK=600 load/stress.js
```

Open [http://localhost:5665](http://localhost:5665){target="_blank"} while it runs: the k6 web dashboard plots request rate, latency percentiles and VUs over time; the HTML report is saved at the end. Look for three moments:

1. **The knee** on the way up: p95 leaves the floor.
2. **The peak**: VUs climb towards `maxVUs` — k6 needs more concurrent users to keep the rate because each request takes longer (Little's Law again, from the client side).
3. **The recovery**: after the drop to 25% of the peak, how many seconds until p95 is back to normal? A service that recovers by itself is *stable*; one that stays slow (queues that never drain, a garbage collector that never catches up) needs load shedding — a topic for labs 3 and 9.

## Measure it { #measure-it }

Record everything in `results/lab2.md`:

``` { .markdown title="results/lab2.md" .copy }
# Lab 2 — catalog under load

Setup: catalog 1 CPU / 768 MB, Hikari pool = 10, PostgreSQL 17, k6 open model (80% detail, 20% list)

## Sweep (pool = 10)
<paste the table printed by summarize.py>

## Sweep (pool = 30)
<paste the table>

## Knee and capacity
- Knee (pool 10): ____ req/s — capacity with p99 < 300 ms: ____ req/s
- Knee (pool 30): ____ req/s — capacity with p99 < 300 ms: ____ req/s
- Bottleneck at the knee (evidence from watch-metrics / docker stats): ____

## Little's Law
| Offered (req/s) | avg latency (s) | λ × W | busy threads (measured) | db_active (measured) |
|---:|---:|---:|---:|---:|
|  100 |  |  |  |  |
|  300 |  |  |  |  |

## Stress test
- Peak reached: ____ req/s; p95 at the peak: ____ ms; dropped iterations: ____
- Recovery time after the drop: ____ s

## Hypothesis check
- My playground hypothesis was: ____ . It was right / wrong because ____ .
```

!!! note "If your numbers differ"

    Your knee will not be at 300–400 req/s: it depends on your CPU, on Docker's resources and on what else runs. What matters is the **shape** (flat, then a sharp rise), the **evidence** for the bottleneck (`db_active` pinned at the pool size, `db_pending` growing) and the **change** when you resize the pool. If the knee is very low (< 100 req/s), check `docker stats` while the sweep runs: a container stuck at its CPU limit, or swap use, explains it. If k6 prints `Insufficient VUs`, the service is past its knee — that is a result, not an error.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| every request fails with `connection refused` | the stack is not running, or `BASE_URL` points elsewhere | `docker compose ps`; in lab 2 the target is `http://localhost:8082` (the default) |
| `level=warning msg="Insufficient VUs, reached 2000 active VUs and cannot initialize more"` | the arrival rate needs more concurrent requests than `maxVUs` | expected past the knee; the run is still valid — note `dropped_iterations` |
| `summarize.py` prints only the header | no JSON matched the glob (wrong `OUT` folder) | `ls results/lab2/`; pass the same folder you gave to `sweep.sh` |
| `watch-metrics.sh` prints `?` | `jq` missing, or `catalog` not reachable on 8082 | install `jq`; `curl localhost:8082/actuator/metrics` must list `tomcat.threads.busy` |
| `uv: command not found` | uv not installed | lab 0, step 1 — or run `python3 scripts/summarize.py …` (it only uses the standard library) |
| the first point of a sweep is worse than the next ones | cold JVM | `sweep.sh` already warms up; repeat the run if your machine was busy |
| numbers vary a lot between two identical runs | background load (browser, IDE, other containers) | close what you can, stop unrelated containers (`docker ps`), run twice and keep the second |

!!! success "Best practices in this lab"

    - **Load-test with an open workload model** — `load/load.js` uses `constant-arrival-rate`, so a slow service cannot quietly lower the load it receives ([Percentiles — measuring honestly](../../classes/estimation/percentiles/index.md)).
    - **Warm up, then sweep, with a pause between steps** — `scripts/sweep.sh` discards a 30 s warm-up and sleeps 10 s between rates, so a cold JVM or a leftover queue does not spoil a point ([Queueing — the knee](../../classes/estimation/queueing/index.md)).
    - **Watch the inside while you load the outside** — `scripts/watch-metrics.sh` prints busy threads and pending connections, the evidence that names the bottleneck ([Little's Law](../../classes/estimation/queueing/index.md)).
    - **Change one variable and measure again** — only `DB_POOL_SIZE` changes between the two sweeps ([Estimation — the method](../../classes/estimation/index.md)).
    - **State capacity as the highest rate within the latency target** — not the highest throughput ever printed; `results/lab2.md` records the knee and the capacity ([Percentiles](../../classes/estimation/percentiles/index.md)).

## Clean up

``` { .bash .copy }
docker compose up -d catalog     # if you changed DB_POOL_SIZE, recreate catalog with the default (10)
docker compose down              # when you are done for the day (data is kept)
```

Keep `results/lab2*` (the JSON summaries and your `results/lab2.md`): lab 3 compares against them. The HTML report is ignored by Git on purpose (it is large).

## Deliverable

- [ ] `load/load.js`, `load/stress.js`, `scripts/sweep.sh`, `scripts/summarize.py` and `scripts/watch-metrics.sh` in your repository.
- [ ] Two sweeps (pool 10 and pool 30) with tables in `results/lab2.md`, the knee and the capacity of each.
- [ ] The Little's Law table with at least two rates, compared with the measured gauges.
- [ ] The stress test HTML report (`results/lab2-stress.html`, not committed) and its three moments described.
- [ ] One paragraph: **what is the bottleneck of `catalog`, and what is your evidence?**
- [ ] Repository tagged `lab2`; [quiz](quiz.md) answered.

## End state

``` { .tree title="added in lab 2" }
boxoffice/
    load/load.js                 # open-model load test (RATE, DURATION, LIST_SHARE)
    load/stress.js               # staircase past the knee and back
    scripts/sweep.sh             # one load.js run per rate
    scripts/summarize.py         # k6 summaries -> Markdown table (uv run)
    scripts/watch-metrics.sh     # Tomcat threads and Hikari pool, once per second
    results/lab2/  results/lab2-pool30/  results/lab2.md
```

No service changed: the stack is still `db` + `catalog`.

Next: [Lab 3 — Edge](../3/index.md), where one replica becomes three.

[^1]: Grafana k6 documentation, [Open and closed models](https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/open-vs-closed/){target="_blank"} and [Arrival-rate executors](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/){target="_blank"}.
[^2]: John D. C. Little, "A Proof for the Queuing Formula: L = λW", *Operations Research* 9(3), 1961.
