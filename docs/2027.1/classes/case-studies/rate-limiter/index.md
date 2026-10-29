
> *"Design a rate limiter for a public API. It must work across many API gateway replicas, add almost no latency, and let us set different limits per user, per IP and per partner."*

Every public API needs one, and every large system has several: at the edge against floods, at the gateway per client, inside services to protect a fragile dependency. The problem is small enough to design end to end in 45 minutes and deep enough to separate levels: a junior candidate names "token bucket"; a senior one explains **why** a sliding-window counter is accurate enough, how to make the check **atomic** across 20 gateway replicas, what happens when the counter store is **down**, and why rate limiting alone does not stop an overload.

In BoxOffice, the rate limiter is the second line of defense of the flash sale: the [WAF](../../../reference/components/edge/index.md#waf) stops obvious floods, the waiting room meters admissions, and the gateway enforces "5 hold attempts per minute per account" and the quotas of reseller partners.

| | |
|---|---|
| **Difficulty** | :material-star::material-star: medium |
| **Key concepts** | token bucket, leaky bucket, fixed window, sliding window (log and counter), GCRA, atomic counters in Redis with Lua, 429 + `Retry-After`, fail-open vs. fail-closed, local vs. global limits |
| **Palette components** | [`apigw`](../../../reference/components/edge/index.md#apigw), [`lb`](../../../reference/components/edge/index.md#lb), [`waf`](../../../reference/components/edge/index.md#waf), [`app`](../../../reference/components/compute/index.md#app), [`cache`](../../../reference/components/storage/index.md#cache), [`metrics`](../../../reference/components/observability/index.md#metrics) |
| **Playground scenario** | `rate-limiter` |

!!! abstract "What this case trains"

    - **Compare** the five classic rate-limiting algorithms on accuracy, memory and burst behavior.
    - **Implement** an atomic, distributed check with Redis and a Lua script, and **explain** the race it avoids.
    - **Decide** where limits live (edge, gateway, service, client) and how they are configured per user, IP and plan.
    - **Design** the failure behavior (fail-open vs. fail-closed) and the client contract (429, `Retry-After`, backoff with jitter).
    - **Distinguish** rate limiting from load shedding and concurrency limiting.

---

## 1. Clarify the requirements

The word "rate limiter" hides several different products. Ask before drawing ([interview framework](../../intro/interview-framework/index.md)).

### Functional requirements

1. Limit the number of requests a **client** can make in a time window; the client can be a user ID, an API key, an IP address, or a combination.
2. Several **rules** per request, e.g. `10 req/s per user` **and** `1 000 req/min per API key` **and** `100 req/s per IP` on `/login`.
3. Rejected requests get **HTTP 429 Too Many Requests** with a hint of when to retry.
4. Rules are **configurable** without redeploying (per endpoint, per plan: free, partner, internal).
5. Expose metrics: allowed vs. rejected per rule and client.

### Non-functional requirements

| Quality | Target |
|---|---|
| **Latency** | Adds < 1 ms at p99 to each request (it is on every request) |
| **Throughput** | 50 k req/s at peak (BoxOffice on-sale day), across ~20 gateway replicas |
| **Accuracy** | A client can exceed its limit by a small margin (say ≤ 10%) during races or bursts; never by 2× |
| **Availability** | A failure of the limiter must not take the API down |
| **Memory** | State for ~1 M active clients must fit comfortably in RAM |

### Out of scope (say it explicitly)

DDoS protection at the network layer (that is the WAF/CDN's job), billing based on usage, abuse detection with machine learning. Mention that they exist in the layers around the limiter.

??? question "Questions to ask the interviewer"

    | Question | Why it matters |
    |---|---|
    | Client-side, server-side, or gateway? | A client-side limiter is courtesy, not protection: the server side is mandatory. |
    | What identifies the client: user, API key, IP? | IPs are shared (NAT, mobile carriers) and spoofable through proxies; user/key is fairer. |
    | Hard limit or soft (allow a burst)? | Token bucket allows bursts; leaky bucket smooths them. |
    | How many gateway replicas, how many regions? | A per-replica limit is wrong by a factor N; a global limit needs shared state. |
    | What should happen if the limiter's storage is down? | Fail-open (availability) vs. fail-closed (protection). |
    | Is the limit about **rate** or about **concurrency** or **cost**? | "10 requests/s" vs. "5 in flight" vs. "100 k LLM tokens/min" are different mechanisms. |

---

## 2. Back-of-the-envelope estimates

```python exec="1" source="tabbed-right"
# Rate limiter: assumptions (illustrative)
peak_rps       = 50_000      # API requests per second at peak
gateways       = 20          # gateway replicas
active_clients = 1_000_000   # distinct keys active in a window
rules_per_req  = 2           # e.g. per-user + per-IP
bucket_b       = 100         # one counter in Redis: key + 2 numbers + overhead, bytes
user_limit_min = 600         # per-user limit: 600 requests per minute
log_entry_b    = 50          # one timestamp in a sorted set, with overhead
redis_ops_node = 100_000     # simple ops/s one Redis node sustains (order of magnitude)
rtt_ms         = 0.5         # gateway → Redis round trip in the same zone

counter_ops    = peak_rps * rules_per_req           # one atomic op per rule (or 1 script)
script_calls   = peak_rps                            # all rules in one Lua call
counters_mb    = active_clients * rules_per_req * bucket_b / 1e6
log_gb         = active_clients * user_limit_min * log_entry_b / 1e9
redis_nodes    = script_calls * 3 / redis_ops_node   # a script costs ~3 simple ops
local_error    = gateways                             # per-replica limits: worst-case factor
added_ms       = rtt_ms

rows = [
    ("counter_ops", counter_ops, "ops/s"), ("script_calls", script_calls, "calls/s"),
    ("counters_mb", counters_mb, "MB"), ("log_gb", log_gb, "GB"),
    ("redis_nodes", redis_nodes, "nodes"), ("local_error", local_error, "x limit"),
    ("added_ms", added_ms, "ms"),
]
print("| quantity | value | unit |\n|---|---:|---|")
for name, value, unit in rows:
    v = f"{value:,.0f}" if abs(value) >= 100 else f"{value:,.2f}"
    print(f"| `{name}` | {v} | {unit} |")
```

What the numbers tell us:

- Counters for a million clients take **~200 MB** — one Redis node holds them easily. A **sliding-window log** (one timestamp per request) would need **~30 GB** for the same clients: that is why the log is rarely used at scale.
- **50 k script calls/s** at ~3 operations each is ~1.5 Redis nodes of work ⇒ a small **Redis Cluster** (3 primaries + replicas), sharded by client key, with headroom.
- One round trip in the same zone adds **~0.5 ms** — within budget, as long as the gateway talks to Redis over persistent, pipelined connections and **all rules go in a single script call**.
- Enforcing `limit` independently on each of 20 replicas lets a client get up to **20× the limit** when the load balancer spreads its requests. ⇒ either a **shared** counter, or a local limit of `limit / N` with sticky routing, or a hybrid (see 6.3).

---

## 3. API

The limiter is usually not a public API but a **filter** inside the gateway; still, define its contract — internal and external.

```http
# Internal (gateway → limiter library or sidecar)
check(rules=[("user:42", 10, 1s), ("ip:203.0.113.7", 100, 1s)], cost=1)
    → {allowed: true|false, remaining: 7, resetMs: 380, retryAfterMs: 0}

# External: what the API client sees
HTTP/1.1 429 Too Many Requests
Retry-After: 2
RateLimit-Policy: "per-user";q=10;w=1
RateLimit: "per-user";r=0;t=2
Content-Type: application/problem+json

{"type": "https://bx.example/problems/rate-limited", "title": "Too many requests",
 "detail": "Limit of 10 requests per second per user exceeded", "retryAfterSeconds": 2}
```

- **`429`** (RFC 6585) plus **`Retry-After`** (seconds or a date) is the contract. Well-behaved clients retry **after** that time, with exponential backoff and jitter.
- The `RateLimit` / `RateLimit-Policy` header fields are being standardized by the IETF HTTPAPI working group; many APIs still use the older `X-RateLimit-Limit/Remaining/Reset`. Either way: tell clients their budget **before** they hit the wall.
- Rules are data, not code, e.g. stored in a config service and cached by every gateway:

```yaml
rules:
  - match: { path: "/v1/events/*/holds", method: POST }
    key: user
    limit: { requests: 5, per: 60s }          # 5 hold attempts per minute per account
  - match: { path: "/v1/*" }
    key: api_key
    limit: { requests: 1000, per: 60s, burst: 200 }
    plans: { partner: 10000, internal: unlimited }
  - match: { path: "/v1/auth/login" }
    key: ip
    limit: { requests: 10, per: 60s }
    on_store_failure: closed                   # security-sensitive: fail closed
```

---

## 4. Data model

The state is tiny and short-lived: per (rule, client) a counter or a token count with a timestamp, expiring automatically.

```text
# Token bucket (Redis hash)              key TTL = time to refill completely × 2
rl:tb:user:42          → { tokens: 7.4, ts: 1767261600123 }

# Fixed window counter (Redis string)    key TTL = window
rl:fw:user:42:29454360 → 9            (window id = floor(now / 60 s))

# Sliding window counter: two fixed windows, current and previous
rl:sw:user:42:29454360 → 4
rl:sw:user:42:29454359 → 9

# Sliding window log (Redis sorted set)  score = timestamp
rl:log:user:42         → { 1767261600123, 1767261600201, ... }
```

| Data | Store | Why |
|---|---|---|
| Counters / buckets | In-memory KV with TTL and atomic scripts: Redis (`cache`) | Sub-millisecond, atomic, expires by itself; losing it costs only a few extra requests |
| Rules | Config service or SQL, cached in every gateway (refresh every few seconds) | Read on every request: must be local |
| Allowed / rejected events | Metrics (`metrics`), sampled logs | Dashboards, alerting on unusual rejection rates, tuning limits |

---

## 5. High-level design

``` diagram-sim
flowchart LR
    c([Clients]) --> waf["WAF / CDN<br/>coarse per-IP limits"]
    waf --> lb["Load balancer"]
    lb --> gw1["API gateway #1<br/>rate-limit filter"]
    lb --> gw2["API gateway #N<br/>rate-limit filter"]
    gw1 --> r[("Redis Cluster<br/>counters, Lua")]
    gw2 --> r
    cfg["Rules config<br/>service"] -. pushed / cached .-> gw1
    cfg -. pushed / cached .-> gw2
    gw1 --> svc["Backend services"]
    gw2 --> svc
    gw1 -. allowed / 429 .-> m["Metrics"]
```

One request through the filter:

``` diagram-sim
sequenceDiagram
    autonumber
    participant C as Client
    participant G as API gateway
    participant R as Redis
    participant S as Service
    C->>G: POST /v1/events/42/holds (user 42)
    G->>G: match rules (local cache)
    G->>R: EVALSHA token_bucket {user:42, ip:…} now cost=1
    R-->>G: allowed=1, remaining=4
    G->>S: forward request
    S-->>G: 201 Created
    G-->>C: 201 + RateLimit: r=4
    C->>G: 6th attempt within the minute
    G->>R: EVALSHA token_bucket …
    R-->>G: allowed=0, retry after 9 s
    G-->>C: 429 Too Many Requests, Retry-After: 9
```

---

## 6. Deep dives

### 6.1 The algorithms

| Algorithm | How it works | Bursts | Memory per client | Accuracy | Typical use |
|---|---|---|---|---|---|
| **Token bucket** | Bucket of capacity `b` refilled at `r` tokens/s; each request takes a token | Allows bursts up to `b` | 2 numbers | Exact | API limits (AWS, Stripe-style) |
| **Leaky bucket** | Requests enter a FIFO drained at a constant rate | Smooths them out (queues or drops) | A queue or 2 numbers | Exact | Shaping traffic to a fragile backend |
| **Fixed window** | Counter per window `floor(now / w)` | Up to **2×** at window boundaries | 1 number | Weak at edges | Coarse quotas (per day) |
| **Sliding window log** | Store every timestamp; count those in the last `w` | None | One entry per request | Exact | Low-volume, high-value limits |
| **Sliding window counter** | Current count + previous count × overlap fraction | Small | 2 numbers | Approximate (assumes uniform previous window) | Large-scale API limits (Cloudflare-style) |
| **GCRA** | Tracks a "theoretical arrival time"; equivalent to a token bucket | Configurable | 1 timestamp | Exact | Same as token bucket, less state |

The boundary problem of fixed windows is easiest to see with a trace. Limit: 10 requests per second; a client sends 10 requests at t = 0.99 s and 10 more at t = 1.01 s:

```python exec="1" source="tabbed-right"
# How many of 20 requests (10 at t=0.99 s, 10 at t=1.01 s) does each algorithm allow?
limit, window = 10, 1.0
trace = [0.99] * 10 + [1.01] * 10

def fixed_window(ts):
    counts, ok = {}, 0
    for t in ts:
        w = int(t // window)
        if counts.get(w, 0) < limit:
            counts[w] = counts.get(w, 0) + 1
            ok += 1
    return ok

def sliding_log(ts):
    log, ok = [], 0
    for t in ts:
        log = [x for x in log if x > t - window]
        if len(log) < limit:
            log.append(t)
            ok += 1
    return ok

def sliding_counter(ts):
    counts, ok = {}, 0
    for t in ts:
        w = int(t // window)
        overlap = 1 - (t % window) / window
        estimate = counts.get(w - 1, 0) * overlap + counts.get(w, 0)
        if estimate < limit:
            counts[w] = counts.get(w, 0) + 1
            ok += 1
    return ok

def token_bucket(ts, capacity=limit, rate=limit / window):
    tokens, last, ok = capacity, 0.0, 0
    for t in ts:
        tokens = min(capacity, tokens + (t - last) * rate)
        last = t
        if tokens >= 1:
            tokens -= 1
            ok += 1
    return ok

print("| algorithm | allowed of 20 |\n|---|---:|")
for f in (fixed_window, sliding_log, sliding_counter, token_bucket):
    print(f"| `{f.__name__}` | {f(trace)} |")
```

The fixed window lets **20 requests through in 20 ms** — twice the limit — because they fall in two different windows. The log and the token bucket allow exactly 10. The sliding window counter allows 11: it assumes the previous window's requests were spread evenly, while here they all came at its very end — a small, bounded error in exchange for two numbers of state. This is why production limiters use a **token bucket** or a **sliding window counter**.

<div class="csim" data-sim="rate-limiter" data-limit="20" data-burst="40" data-pattern="boundary" data-algo="fixed"></div>

!!! tip "Try it"
    The defaults are the limits of lab 3's Nginx: **20 requests/s** per API key and a **burst of 40**. The traffic starts with a burst straddling the 1 s boundary (20 requests just before it, 20 just after) and repeats it at 3 s.

    1. Play with the **fixed window**: 40 requests reach the backend in about 0.2 s, **2× the limit**, and it happens again at 3 s.
    2. Switch to the **sliding log**: the backend never sees more than 20 in any second; the second half of each burst gets `429`.
    3. Switch to the **token bucket**: it starts full, so it lets the whole burst through — 46 requests in the busiest second. Drag the capacity down to 20 and the busiest second drops to 29: the capacity *is* the burst you allow.
    4. Pick **bursts** and the **leaky bucket**: the backend receives a steady 20 per second, but a queued request waits up to 1.95 s — smoothing costs latency.


### 6.2 Making it atomic across replicas

The naive implementation has a race:

```text
gateway A: GET rl:user:42      → 9          gateway B: GET rl:user:42 → 9
gateway A: 9 < 10 → allow, SET 10           gateway B: 9 < 10 → allow, SET 10
                       → 11 requests allowed, counter says 10
```

Read-check-write must be **one atomic operation** on the store. In Redis, use `INCR` (atomic) for counters, or a **Lua script**, which runs atomically on the shard that owns the key:

```lua
-- token_bucket.lua   KEYS[1] = bucket key   ARGV: capacity, refill per second, cost
local capacity = tonumber(ARGV[1])
local rate     = tonumber(ARGV[2])
local cost     = tonumber(ARGV[3])
local t        = redis.call('TIME')                       -- server clock: no skew between gateways
local now      = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

local b      = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(b[1]) or capacity
local ts     = tonumber(b[2]) or now
tokens = math.min(capacity, tokens + (now - ts) / 1000 * rate)

local allowed = 0
if tokens >= cost then
  tokens  = tokens - cost
  allowed = 1
end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / rate * 1000) * 2)
local retry_ms = 0
if allowed == 0 then retry_ms = math.ceil((cost - tokens) / rate * 1000) end
return { allowed, tostring(tokens), retry_ms }               -- floats → string (Redis truncates numbers)
```

Details that show seniority:

- **One call per request** for all rules (pass several keys) — but in Redis Cluster all keys of one script must hash to the same slot: use a **hash tag**, e.g. `rl:{user:42}:tb` and `rl:{user:42}:fw`; rules keyed by different entities (user and IP) need separate calls, pipelined.
- **Use the server's clock** (`TIME`) instead of each gateway's: 20 gateways with clocks 50 ms apart would refill the bucket inconsistently.
- **TTL on every key**: idle clients disappear by themselves; memory stays proportional to *active* clients.
- Load the script once (`SCRIPT LOAD`) and call it with `EVALSHA` to avoid sending the source on every request.

### 6.3 Where to enforce, and local vs. global

``` diagram-sim
flowchart LR
    cl["Client SDK<br/>courtesy limit"] --> edge["Edge / WAF<br/>per IP, coarse"]
    edge --> gw["API gateway<br/>per user / key / plan"]
    gw --> mesh["Service mesh<br/>per caller service"]
    mesh --> svc["Service<br/>concurrency limit<br/>to its DB / provider"]
```

| Placement | Protects | Strength | Weakness |
|---|---|---|---|
| Client SDK | Our service from well-behaved clients | Cheap, smooths traffic | Not enforceable |
| Edge / WAF | Everything behind it from floods | Absorbs attacks far from origin | Knows only IP, not user |
| API gateway | Services from any single client | Knows identity and plan | Needs shared state across replicas |
| Inside the service | A fragile dependency (DB, payment provider) | Knows the real cost | Late: the request already used resources |

**Global vs. local.** A shared Redis gives an exact global limit at the cost of a network hop. Alternatives when that hop is too expensive (multi-region, very high rates):

- **Local buckets with `limit / N`**: no network, but wrong when traffic is unevenly spread; acceptable with consistent-hash routing of each client to one gateway.
- **Local + periodic sync**: each gateway counts locally and pushes deltas to the shared store every 100 ms, reading back the global total — approximate (overshoots by at most one sync interval of traffic), very fast. This is roughly how large CDNs do it.
- **Per-region limits**: limit per region and accept that a client using two regions gets up to 2× — usually fine.

!!! example "In the BoxOffice code: a local limiter at the edge (lab 3)"

    [Hands-on 3](../../../hands-on/3/index.md) puts the simplest version of this design at the edge: Nginx gives each API key 20 req/s with a burst of 40 and answers `429` above that, without touching the replicas. It is a **local** limiter — the counters live in one Nginx — which is exact while there is one edge; with N edges each would allow 20 req/s, the `limit / N` problem above. In the lab's test, the polite client (10 req/s) gets only `200`s and the greedy one (50 req/s) about 20 `200`s per second and `429` for the rest. Nginx implements a leaky bucket: `rate` is the drain, `burst` the size of the bucket.

    ``` { .nginx title="infra/nginx/nginx.conf (the limit)" }
    --8<-- "docs/2027.1/hands-on/3/code/infra/nginx/nginx.conf:28:32,43:44"
    ```

### 6.4 When the limiter itself fails

- **Fail-open** (allow when Redis is unreachable) keeps the API available — the right default for ordinary limits, because the limiter exists to protect the backend, and a short period without limits is rarely worse than a full outage. Pair it with a **local fallback bucket** so the protection degrades instead of disappearing.
- **Fail-closed** (reject) for limits that guard security: login attempts, password reset, OTP verification — otherwise an attacker who can overload Redis also disables brute-force protection.
- Put a **tight timeout** (a few ms) on the Redis call and a circuit breaker around it: a slow limiter is worse than none, because it adds latency to every request ([reliability patterns](../../reliability/patterns/index.md)).

!!! warning "Rate limiting is not overload protection"

    A per-client limit of 10 req/s does nothing when **a million legitimate clients** each send 1 req/s — the 10:00 on-sale. Protecting the backend from total load needs **load shedding** (reject when the service's own queue or latency is too high), **concurrency limits** (at most N in-flight calls to the payment provider), and, for BoxOffice, the waiting room. Say this in the interview: it shows you know what the rate limiter does **not** do.

---

## 7. Bottlenecks, failure modes and trade-offs

| Where | What goes wrong | Mitigation | Trade-off |
|---|---|---|---|
| Redis round trip | Adds latency to every request | Same-zone Redis, pipelining, one script per request, local cache of "blocked until" | Small staleness on blocks |
| Redis down or slow | Every request blocked or slowed | Timeout + breaker; fail-open with local fallback bucket; fail-closed for security rules | Brief over-admission |
| Hot client key | One huge partner saturates one Redis shard | Local pre-aggregation for that key; split key into sub-buckets | Approximate limit for that client |
| Fixed-window boundaries | 2× bursts at window edges | Token bucket or sliding window counter | Slightly more state |
| Shared IPs (NAT, mobile carriers) | Many users blocked together | Prefer user/key limits; generous IP limits only on unauthenticated routes | Attackers can rotate accounts |
| Retry storms | Rejected clients retry immediately, multiplying load | `Retry-After`, client backoff + jitter, SDKs that respect it | Clients wait longer |
| Rule changes | Bad rule blocks everybody | Rules as versioned config, dry-run ("shadow") mode, gradual rollout | Slower to react |
| Multi-region | Global limit needs cross-region coordination | Per-region limits or async sync | Up to N× the limit across N regions |

The trade-offs to **say out loud**: **accuracy vs. latency** (exact global counters cost a network hop; approximate local ones are free), **availability vs. protection** (fail-open vs. fail-closed, chosen per rule), and **fairness vs. simplicity** (per-IP limits are easy but punish users behind a shared NAT).

---

## 8. Try it in the playground

The `rate-limiter` scenario places an API gateway with rate limiting in front of a backend that has a fixed capacity.

!!! tip "Try it"

    1. Run with the **spike** profile and the limiter **disabled** (or bypassed): watch the backend's utilization reach 100% and p99 and errors explode for everybody.
    2. Enable the limiter and run again: rejections (429) appear at the gateway, while the backend stays below saturation and the p99 of *accepted* requests stays flat.
    3. Raise the limit step by step and find the value where the backend starts to saturate — that is the capacity your limit must stay under.
    4. Turn chaos on to fail the counter store (cache): does the gateway fail open or closed in the simulator, and what does that do to the backend?

<div class="sdp" data-scenario="rate-limiter" data-mode="full" data-height="640" data-profile="spike"></div>

[Open the full playground](../../../../playground/index.md){ .md-button }

---

## 9. Follow-up questions an interviewer asks

??? question "Token bucket or sliding window — which one would you pick and why?"

    For an API limit, **token bucket**: two numbers per client, exact, and it allows short bursts (a page load firing 8 requests at once), which is what users actually do. Configure capacity (burst) and refill rate separately. Pick the **sliding window counter** when the product says "N requests per minute" and you want the semantics of a window with almost no burst, at the cost of a small approximation. Avoid fixed windows except for coarse daily quotas.

??? question "How do you rate limit by cost instead of by request count?"

    Make the token cost a parameter: a cheap `GET` costs 1, an export costs 50, an LLM call costs its **number of tokens**. The token bucket handles it unchanged (`cost` argument in the script). For LLM calls the cost is only known after the response, so reserve an estimate up front and settle the difference afterwards (debit or credit the bucket).

??? question "The limit must hold across two regions. What do you do?"

    Options in increasing cost: (1) split the limit per region (`limit / 2` each, or proportional to traffic) — no coordination, slightly unfair; (2) count locally and replicate counts asynchronously between regions every few hundred ms — approximate global limit; (3) a single global store — exact but adds a cross-region round trip (tens of ms) to every request, which usually violates the latency requirement. Most systems choose (1) or (2) and state the error bound.

??? question "A client complains it got 429s while it was under the limit. How can that happen?"

    Common causes: the client's clock or its own counting differ from ours (window alignment); requests went to two regions with separate limits; a shared key (IP behind NAT, an API key used by several services); retries counted as requests; or the limit uses a token bucket and the client sent a burst bigger than the capacity. The `RateLimit` headers on every response let the client see its real budget — the best way to avoid this conversation.

??? question "How do you test the rate limiter?"

    Unit tests of the algorithm with a fake clock (boundaries, bursts, refill); concurrency tests with many goroutines/threads against a real Redis to prove atomicity (count allowed requests: must be ≤ limit); a load test (k6) with a known arrival rate per client and a check that rejections start at the configured limit; and a chaos test that kills Redis to verify fail-open/closed behavior ([performance engineering](../../performance/index.md)).

??? question "What is the difference between rate limiting, throttling and backpressure?"

    **Rate limiting** rejects requests above a configured rate for a client. **Throttling** slows them down instead (delays, queues, leaky bucket). **Backpressure** is a signal from a saturated consumer to its producer to slow down (TCP windows, reactive streams, a full queue blocking the producer). Rate limiting is policy about clients; backpressure is a property of the system's capacity. A robust API uses both.

??? question "Why not just let the backend autoscale instead of rejecting requests?"

    Autoscaling takes minutes and costs money; an abusive client can grow as fast as you scale. Some resources do not scale at all (a database primary, a partner's API limit). Rate limiting is about **fairness between clients** and **protecting fixed resources**; autoscaling is about **capacity for legitimate demand**. You want both.

---

## 10. Self-assessment rubric

| Level | What the answer contains |
|---|---|
| **Junior** | A counter per user with a fixed window in Redis or in memory; returns 429. May keep the counter in each server's memory without noticing the N× problem. |
| **Mid** | Compares token bucket, fixed window and sliding window; uses a shared Redis with atomic operations; per-rule configuration; 429 with `Retry-After`; mentions fail-open. |
| **Senior** | Explains the race and fixes it with a Lua script (hash tags in Cluster, server clock, TTLs); chooses placement per layer; discusses local vs. global limits and multi-region error bounds; fail-open vs. fail-closed per rule; cost-based limits; distinguishes rate limiting from load shedding and concurrency limiting; client contract with backoff and jitter; observability of rejections. |

**Related:** [API gateway](../../edge/api-gateway/index.md), [Hands-on 3](../../../hands-on/3/index.md) (Nginx rate limiting), [Hands-on 4](../../../hands-on/4/index.md) (gateway and identity), [Redis](../../caching/redis/index.md), [Reliability patterns](../../reliability/patterns/index.md).

!!! success "Best practices"

    - **Answer `429` with `Retry-After`** — well-behaved clients slow down by themselves, and the retry storm never starts.
    - **Make check-and-count one atomic operation** — a Lua script in Redis; two round trips let two replicas both let the same request through.
    - **Decide fail-open or fail-closed per route, and alert on limiter errors** — browsing fails open, login fails closed; either way someone must know the limiter is down.
    - **Roll out a new limit in dry-run first** — log what would have been blocked for a day before enforcing it; a wrong limit is an outage you caused.
    - **Key by identity where you have it, by IP only at the edge** — lab 3 keys on the API key, and its `nginx.conf` notes that requests without a key should also be limited per IP in production ([lab 3](../../../hands-on/3/index.md)).

---

## How it connects { #how-it-connects }

Which classes does this case test? Each branch is a class whose ideas the design relies on (blue), with the palette components where they show up (green):

``` diagram
flowchart LR
    CASE(["Rate limiter"]) --> EDG["Edge<br/>where limits live: WAF, gateway"]:::tech
    CASE --> CAC["Caching<br/>Redis counters, Lua atomicity"]:::tech
    CASE --> REL["Reliability<br/>fail-open vs fail-closed, load shedding"]:::tech
    CASE --> CLI["client contract<br/>429, Retry-After, jitter"]:::tech
    CASE --> PERF["Performance<br/>k6 at a known arrival rate"]:::tech
    EDG -.-> k1["waf · cdn · lb · apigw"]:::comp
    CAC -.-> k2["cache"]:::comp
    REL -.-> k3["metrics"]:::comp
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

**Classes it tests:** [Edge — API gateway](../../edge/api-gateway/index.md) · [Caching — Redis](../../caching/redis/index.md) · [Reliability — patterns](../../reliability/patterns/index.md) (load shedding, backoff with jitter) · [Performance](../../performance/index.md) · [Hands-on 3](../../../hands-on/3/index.md) and [Hands-on 4](../../../hands-on/4/index.md). **Palette components:** [`waf`](../../../reference/components/edge/index.md#waf) · [`cdn`](../../../reference/components/edge/index.md#cdn) · [`lb`](../../../reference/components/edge/index.md#lb) · [`apigw`](../../../reference/components/edge/index.md#apigw) · [`cache`](../../../reference/components/storage/index.md#cache) · [`metrics`](../../../reference/components/observability/index.md#metrics). **Scenarios:** `rate-limiter`.

---

## References

- XU, A. *System Design Interview — An Insider's Guide*, vol. 1, ch. 4 "Design a Rate Limiter"[^1].
- Stripe's four kinds of limiters (request rate, concurrency, fleet load shedder, worker utilization)[^2].
- Cloudflare's sliding-window counter at the edge[^3].
- HTTP status 429[^4] and handling overload at Google[^5].

[^1]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1. Byte Code LLC, 2020.
[^2]: TARJAN, P. [Scaling your API with rate limiters](https://stripe.com/blog/rate-limiters){target="_blank"}. Stripe Blog, 2017.
[^3]: DESGATS, J. [How we built rate limiting capable of scaling to millions of domains](https://blog.cloudflare.com/counting-things-a-lot-of-different-things/){target="_blank"}. Cloudflare Blog, 2017.
[^4]: NOTTINGHAM, M.; FIELDING, R. [RFC 6585 — Additional HTTP Status Codes](https://www.rfc-editor.org/rfc/rfc6585){target="_blank"}. IETF, 2012.
[^5]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/books/){target="_blank"}, ch. 21 "Handling Overload". O'Reilly, 2016.
