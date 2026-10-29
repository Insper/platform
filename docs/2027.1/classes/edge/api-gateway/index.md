BoxOffice has nine services. Without a gateway, the mobile app would need to know nine addresses, every service would validate JWTs on its own (with nine slightly different bugs), every service would implement its own rate limit, and a fan's script hammering `POST /api/holds` 500 times per second would go straight to `inventory`. The **API gateway** is the single front door that solves all of this in one place — and it is also the place where many architectures quietly grow a bottleneck or a second monolith.

An **API gateway** is an L7 reverse proxy specialised for APIs: it is the single entry point for clients, routes each request to the right service, and applies **cross-cutting policies** — authentication, rate limits, quotas, transformations, observability — before the request reaches any business code[^1]. It is the `apigw` component of the palette.

---

## What a gateway does { #responsibilities }

``` diagram-sim
flowchart LR
    app([Mobile app]) --> gw
    web([Web app]) --> gw
    partner([Partner API client]) --> gw
    subgraph gw [API gateway]
        direction TB
        a["Authenticate: JWT / API key"] --> r["Rate limit and quota"]
        r --> t["Route + transform"]
        t --> o["Log, metrics, trace"]
    end
    gw --> catalog[catalog]
    gw --> inventory[inventory]
    gw --> order[order]
    gw --> assistant[assistant]
```

| Responsibility | What it means | BoxOffice example |
|---|---|---|
| **Routing** | map host/path/method to a service and version | `/api/holds/**` → `inventory`, `/api/v2/orders/**` → `order` v2 |
| **Authentication (authN) offload** | validate the JWT signature and expiry, or the API key, once | reject expired tokens before they reach any service; pass `X-User-Id` downstream |
| **Coarse authorisation (authZ)** | route-level rules: scopes, roles | `/api/admin/**` requires the `admin` role; fine-grained rules ("can this user cancel *this* order?") stay in the service |
| **Rate limiting and quotas** | requests per second per user/IP/key; monthly quotas per plan | 10 req/s per fan, bursts of 20; partner plans of 1 M calls/month |
| **Request/response transformation** | rename headers, strip internal fields, convert protocols (REST ↔ gRPC) | expose `inventory`'s gRPC API as REST to the web app |
| **Aggregation** | one client call fans out to several services and merges the answers | `GET /api/events/42/page` returns event + venue + availability |
| **Caching** | cache GET responses for a short time | event details for 30 s |
| **Observability** | access logs, RED metrics per route, start the distributed trace | p99 per route, `traceparent` header injected |
| **Resilience** | timeouts, retries, circuit breakers per route | 2 s timeout to `inventory`; no retries on `POST` |
| **API products** | API keys, developer portal, plans, usage billing | ticket resale partners |

The key word is **cross-cutting**: concerns that are the same for every service. Anything that depends on the business — prices, seat allocation, refund rules — belongs in a service, not in gateway configuration.

!!! example "In the BoxOffice code: the gateway's routes, timeouts and retry (lab 4)"

    [Hands-on 4 — Gateway](../../../hands-on/4/gateway/index.md) puts a Spring Cloud Gateway behind the lab 3 edge. Its configuration is almost the whole table above in a few lines: **routing** by path (`/auth/**`, `/catalog/**`); `lb://catalog`, which balances over the three replicas and skips any whose health check is not `UP` (checked every 5 s); a 1 s connect and 5 s response **timeout** toward every service; and a `Retry` filter limited to `GET`, so a retry can never repeat a purchase. Authentication — validating the JWT that `auth` signs — is in `SecurityConfig.java`, on the same page.

    ``` { .yaml title="services/gateway/src/main/resources/application.yaml (routes and resilience)" }
    --8<-- "docs/2027.1/hands-on/4/code/services/gateway/src/main/resources/application.yaml:7:30,40:43"
    ```

---

## Gateway, load balancer, ingress or service mesh? { #comparison }

These four components overlap, and products blur the lines (Envoy is the engine of many of them). What distinguishes them is **which traffic** they handle and **what they know**:

| | Load balancer (`lb`) | Ingress / Gateway API (`ingress`) | API gateway (`apigw`) | Service mesh (`mesh`) |
|---|---|---|---|---|
| Traffic | north-south (into the system) | north-south into a Kubernetes cluster | north-south, API traffic | **east-west** (service to service) |
| Main job | spread load over healthy replicas | route HTTP by host/path to Services | API policies: auth, limits, keys, transformations | mTLS, retries, timeouts, telemetry between services |
| Knows about | backends, health | Services, hosts, paths | consumers, API keys, plans, routes | every service identity |
| Typical products | ALB/NLB, Nginx, HAProxy | Envoy Gateway, Traefik, cloud controllers | Kong, Apigee, AWS API Gateway, Azure APIM, Spring Cloud Gateway | Istio, Linkerd, Cilium |

A typical BoxOffice request crosses a **load balancer** (managed, at the region entrance), the **API gateway** (policies), and, between services, the **mesh**. On Kubernetes the gateway is often deployed *as* the Gateway API implementation, merging the ingress and gateway roles. The mesh is studied in [Network & Security](../../network-security/service-mesh/index.md).

---

## Backend for Frontend (BFF) { #bff }

The mobile app and the web app need different things: the app shows a compact event card and works on slow networks; the web page shows the full seat map and venue details. A single, generic API either over-fetches for mobile or forces the web app to make many calls.

The **Backend for Frontend** pattern gives each client type its **own** thin gateway layer, owned by the team that builds that frontend[^2]:

``` diagram
flowchart LR
    m([Mobile app]) --> bm[Mobile BFF]
    w([Web app]) --> bw[Web BFF]
    p([Partners]) --> pg[Public API gateway]
    bm --> catalog[catalog]
    bm --> inventory[inventory]
    bw --> catalog
    bw --> inventory
    bw --> order[order]
    pg --> catalog
```

Each BFF aggregates and shapes the responses its client needs (one call for the "event screen" on mobile, with smaller images and fewer fields) and evolves at the speed of that frontend. GraphQL servers are often used as BFFs, because the client describes the exact shape it needs (see [API styles](../../compute/api-styles/index.md)).

| | One general-purpose gateway | BFF per client |
|---|---|---|
| Responses | generic; clients over-fetch or make many calls | tailored per screen |
| Ownership | platform team; a shared bottleneck for changes | frontend team owns its BFF |
| Duplication | none | some shared logic duplicated across BFFs |
| Number of components | one | one per client type |

Use a BFF when clients differ significantly and are owned by different teams; keep cross-cutting policies (auth, rate limits) in the shared gateway in front of the BFFs.

---

## Rate limiting { #rate-limiting }

**Rate limiting** caps how many requests a client may make in a period of time. It protects the backend from overload and abuse, keeps one noisy client from hurting the others (fairness), and enforces commercial plans. It answers with **`429 Too Many Requests`** — "you, specifically, are sending too much" — unlike `503 Service Unavailable`, which means "the server is overloaded for everyone".

Every rate limiter has to decide three things:

1. **Who** is being limited — the **key**: the user id (from the JWT), the API key, the client IP, or a combination such as user + route.
2. **How much** — the **policy**: 10 requests per second with bursts of 20; 1 000 per hour; 4 holds per event per user.
3. **How** to count — the **algorithm**, below.

### Token bucket { #token-bucket }

The most widely used algorithm[^3]. Each key has a bucket that holds at most **capacity** tokens (the burst size) and is refilled at a constant **rate** (the sustained limit). Each request takes a token; if the bucket is empty, the request is rejected.

``` diagram-sim
flowchart LR
    req([Request from fan 7]) --> chk{"Token in<br/>fan 7's bucket?"}
    refill(["Refill: +10 tokens/s<br/>up to capacity 20"]) -.-> chk
    chk -->|"yes: take 1 token"| fwd[Forward to inventory]
    chk -->|"no: bucket empty"| rej["429 Too Many Requests<br/>Retry-After: 1"]
```

The implementation does not need a timer: store the token count and the time of the last update, and on each request add `elapsed × rate` tokens (capped at capacity) before checking. Two numbers per key, O(1) work per request.

The simulation below shows one fan's bucket (capacity 20, refill 10/s) under an illustrative traffic pattern: normal browsing at 4 req/s, a 2-second burst at 40 req/s (the fan mashes "refresh" at 10:00), and then 8 seconds at 14 req/s.

```python exec="1" html="1"
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO
plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "xtick.color": "#888",
                     "ytick.color": "#888", "axes.edgecolor": "#888", "font.size": 10})

capacity, refill = 20, 10          # bucket: 20 tokens, 10 tokens/s (one user's limit)
dt, T = 0.1, 30                     # simulate 30 s in steps of 100 ms
t = np.arange(0, T, dt)

def rate(s):                        # requests/s sent by the client (illustrative)
    if 5 <= s < 7:   return 40      # a 2 s burst (the fan mashes "refresh")
    if 15 <= s < 23: return 14      # sustained load above the limit
    return 4                        # normal browsing

tokens, level, ok, ko = capacity, [], np.zeros(T), np.zeros(T)
for s in t:
    tokens = min(capacity, tokens + refill * dt)    # refill
    arrivals = round(rate(s) * dt * 10) / 10        # fractional requests per step
    accepted = min(arrivals, tokens)
    tokens -= accepted
    ok[int(s)] += accepted
    ko[int(s)] += arrivals - accepted
    level.append(tokens)

fig, (a, b) = plt.subplots(2, 1, figsize=(9, 5.5), sharex=True)
a.plot(t, level, color="#2f6fed", linewidth=2)
a.axhline(capacity, color="#888", linestyle="--", linewidth=1)
a.set_ylabel("tokens in bucket")
a.set_title("Token bucket: capacity 20, refill 10/s")
sec = np.arange(T)
b.bar(sec + 0.5, ok, width=0.9, color="#1e9e5a", label="accepted")
b.bar(sec + 0.5, ko, width=0.9, bottom=ok, color="#e5484d", label="rejected (429)")
b.axhline(refill, color="#888", linestyle="--", linewidth=1)
b.set_ylabel("requests per second")
b.set_xlabel("time (s)")
b.legend(frameon=False, loc="upper right")

plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True, bbox_inches="tight")
print(buf.getvalue())
plt.close()
```

Read the two panels together:

- During the **burst**, the first second accepts about 29 requests — the 20 saved tokens plus the refill — and then the limiter settles at the refill rate of 10/s; the excess is rejected.
- During the **sustained** phase at 14 req/s, the bucket drains slowly (it loses 4 tokens per second) and accepts everything for about five seconds; after that, it accepts exactly 10/s.
- When traffic calms down (4 req/s, so a net refill of 6 tokens/s), the bucket is full again in about three seconds and the next burst will be absorbed again.

This is the behaviour you usually want: **short bursts are tolerated, sustained excess is not**. The two parameters map directly to product language — "10 requests per second, bursts of up to 20".

??? question "Think first: a bucket has capacity 50 and refills at 5 tokens/s. A client that was idle for a long time sends 100 requests at once. How many are accepted immediately? And how long until it can send another 50 at once?"
    **50** are accepted (the full bucket); the other 50 are rejected. The bucket is empty, so it needs **10 s** (50 tokens ÷ 5 tokens/s) to be full again. Over a long period, the client can never average more than 5 req/s, whatever its pattern.

### Leaky bucket { #leaky-bucket }

Requests enter a **queue** of fixed size and leave it at a constant rate, like water leaking from a bucket with a hole. If the queue is full, new requests are dropped. The output is perfectly smooth — the backend sees exactly the leak rate — at the cost of **added latency** for queued requests and no bursts reaching the backend. Nginx's `limit_req` is a leaky bucket; with `burst=… nodelay` it behaves much like a token bucket.

### Fixed window counter { #fixed-window }

Count requests per key in fixed windows — "minute 10:00", "minute 10:01" — with a counter that resets at each boundary: `INCR ratelimit:fan7:202610171000` with a 60 s expiry. Simple and cheap, but it has a **boundary problem**: with a limit of 100 per minute, a client can send 100 at 10:00:59 and another 100 at 10:01:00 — **200 requests in two seconds**, twice the intended rate, all accepted.

### Sliding window log { #sliding-log }

Store the **timestamp of every request** (for example in a Redis sorted set); on each request, drop timestamps older than the window and count the rest. Exact — there is no boundary problem — but memory grows with the limit: a limit of 1 000 per hour stores up to 1 000 timestamps per key.

### Sliding window counter { #sliding-counter }

A cheap approximation that fixes the boundary problem: keep the counters of the **current** and **previous** fixed windows and weight the previous one by how much of it still overlaps the sliding window:

$$
\text{estimate} = \text{current} + \text{previous} \times \left(1 - \frac{\text{elapsed in current window}}{\text{window size}}\right)
$$

Example: limit 100/min. The previous minute had 80 requests; 15 s into the current minute there have been 30. Estimate = 30 + 80 × (1 − 15/60) = 30 + 60 = **90** → the request is allowed. It assumes the previous window's requests were evenly spread, which is close enough in practice; Cloudflare reported that this approximation misjudged a tiny fraction of requests on real traffic[^4].

### Comparing the algorithms { #algorithm-comparison }

| Algorithm | Memory per key | Bursts | Accuracy | Typical use |
|---|---|---|---|---|
| **Token bucket** | 2 numbers | allowed, up to capacity | good | API gateways (AWS API Gateway, Spring Cloud Gateway, Envoy) |
| **Leaky bucket** | a queue | smoothed out | good | protecting a backend that needs a constant rate; Nginx `limit_req` |
| **Fixed window** | 1 counter | up to 2× at boundaries | weak at boundaries | simple quotas (per day / per month) |
| **Sliding window log** | 1 timestamp per request | none beyond the limit | exact | low limits where exactness matters (login attempts) |
| **Sliding window counter** | 2 counters | approximately limited | very good | high-volume APIs (Cloudflare) |

---

## Distributed rate limiting { #distributed }

BoxOffice runs **six gateway replicas**. If each keeps its counters in memory, a fan whose requests are spread across them gets **six times** the limit. A rate limit that must hold across replicas needs a **shared counter store**, almost always **Redis**: fast (sub-millisecond in the same zone), with atomic operations and expiry.

The read-modify-write of a token bucket must be **atomic** — two gateway replicas reading "1 token left" at the same time would both accept. A Lua script runs atomically inside Redis:

```lua title="token_bucket.lua"
-- KEYS[1] = bucket key (e.g. "rl:user:7:holds")
-- ARGV[1] = capacity, ARGV[2] = refill rate (tokens/s), ARGV[3] = cost of this request
local capacity = tonumber(ARGV[1])
local rate     = tonumber(ARGV[2])
local cost     = tonumber(ARGV[3])

local t   = redis.call("TIME")                        -- Redis clock: no skew between gateways
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

local b      = redis.call("HMGET", KEYS[1], "tokens", "ts")
local tokens = tonumber(b[1]) or capacity
local ts     = tonumber(b[2]) or now

tokens = math.min(capacity, tokens + (now - ts) / 1000 * rate)   -- refill since last call
local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end

redis.call("HSET", KEYS[1], "tokens", tokens, "ts", now)
redis.call("PEXPIRE", KEYS[1], math.ceil(capacity / rate * 1000) * 2)  -- idle keys disappear
return { allowed, tostring(tokens) }
```

Design points worth saying out loud:

- **One round trip** per request (a few hundred microseconds to a millisecond) — acceptable at the gateway, but it is on the critical path of *every* request.
- **Time comes from Redis** (`TIME`), not from each gateway: gateway clocks drift (see [Time & clocks](../../distributed/time-clocks/index.md)).
- **Fail open or fail closed?** If Redis is unreachable, should the gateway accept everything (protecting availability) or reject everything (protecting the backend)? Most APIs **fail open** with a local, per-replica fallback limit.
- **Hot keys and scale**: a Redis Cluster shards keys by hash; a single very hot key (a global limit) lands on one shard. Per-user keys spread naturally.
- **Approximate alternatives**: each replica enforces `limit / replicas` locally, or syncs counters asynchronously every 100 ms. Less exact, no extra round trip.

### Where to rate limit { #where }

| Layer | Key | Protects against | Example |
|---|---|---|---|
| **Edge / CDN / WAF** | IP, fingerprint, ASN | floods, scrapers, credential stuffing — before any cost | 100 req/10 s per IP on `/login` |
| **API gateway** | user id, API key, route | abusive users, plan quotas, fairness | 10 req/s per fan, bursts of 20 |
| **Service** | business entity | business abuse the gateway cannot see | max 6 seats per hold, 1 active hold per event per user |
| **Outbound (client side)** | the provider's quota | exceeding a 3rd-party limit (payment, e-mail) | 100 req/s to the payment provider |

Use several layers: coarse and cheap at the edge, identity-aware at the gateway, business rules in the services. Rate limiting is also one of the resilience patterns of [class 10](../../reliability/patterns/index.md) — there, the point of view is protecting a service from overload (load shedding).

### Telling the client { #headers }

A good limiter tells well-behaved clients how to behave:

```http title="429 response"
HTTP/1.1 429 Too Many Requests
Retry-After: 2
RateLimit-Policy: "per-user";q=20;w=1
RateLimit: "per-user";r=0;t=2
Content-Type: application/problem+json

{"type": "https://boxoffice.example/problems/rate-limited", "title": "Too many requests", "status": 429}
```

`Retry-After` (seconds, or a date) is standard HTTP. Many APIs also send `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`; the IETF is standardising `RateLimit` and `RateLimit-Policy` fields for the same purpose[^5]. Clients should respect `Retry-After` and back off with jitter — otherwise every rejected client retries at the same instant.

### Configuration examples { #config }

=== "Spring Cloud Gateway"

    Spring Cloud Gateway ships a Redis-backed token bucket (`RequestRateLimiter`). The gateway of [hands-on 4](../../../hands-on/4/gateway/index.md) does not turn it on — BoxOffice limits at the Nginx edge (box below) — but this is how you would add it:

    ```yaml title="application.yaml"
    spring:
      cloud:
        gateway:
          server:
            webflux:      # the property prefix since Spring Cloud 2025 (as in hands-on 4)
              routes:
                - id: inventory-holds
                  uri: http://inventory:8080
                  predicates:
                    - Path=/api/holds/**
                  filters:
                    - name: RequestRateLimiter
                      args:
                        redis-rate-limiter.replenishRate: 10   # tokens per second
                        redis-rate-limiter.burstCapacity: 20   # bucket capacity
                        redis-rate-limiter.requestedTokens: 1  # cost of one request
                        key-resolver: "#{@userKeyResolver}"
    ```

    ```java title="RateLimitConfig.java"
    @Configuration
    public class RateLimitConfig {

        @Bean
        KeyResolver userKeyResolver() {   // the key: the authenticated user, or the IP
            return exchange -> exchange.getPrincipal()
                .map(Principal::getName)
                .switchIfEmpty(Mono.fromSupplier(() ->
                    exchange.getRequest().getRemoteAddress().getAddress().getHostAddress()));
        }
    }
    ```

=== "Nginx"

    Nginx limits per key with a leaky bucket. Keyed by client IP, it looks like this; [hands-on 3](../../../hands-on/3/index.md) keys it by API key instead (box below):

    ```nginx title="nginx.conf"
    # 10 MB of shared memory holds about 160 000 IP states
    limit_req_zone $binary_remote_addr zone=per_ip:10m rate=10r/s;

    server {
        location /api/ {
            limit_req zone=per_ip burst=20 nodelay;   # absorb bursts of 20, no queueing delay
            limit_req_status 429;
            proxy_pass http://gateway;
        }
    }
    ```

=== "Managed"

    - **AWS API Gateway**: usage plans with throttling (rate + burst, a token bucket) and quotas per API key; AWS WAF rate-based rules per IP.
    - **GCP**: Apigee quotas and spike arrest; Cloud Armor rate-limiting rules.
    - **Azure API Management**: `rate-limit-by-key` and `quota-by-key` policies.
    - **Cloudflare**: rate-limiting rules at the edge (sliding window).

!!! example "In the BoxOffice code: a rate limit at the edge (lab 3)"

    The Nginx edge of [Hands-on 3](../../../hands-on/3/index.md) gives each **API key** 20 req/s with a burst of 40 and answers `429` above that, without touching the replicas. The lab's k6 script sends a greedy client (50 req/s) and a polite one (10 req/s) for 30 s: in its run, the greedy client got 640 `200`s and 843 `429`s — about the 20/s it is entitled to — and the polite one 299 `200`s and **no** `429`. Note the comment in the configuration: a request without the header has an empty key and is not limited, and the key is chosen by the client. Production keys an authenticated identity (lab 4's JWT) and adds a generous per-IP limit for anonymous traffic.

    ``` { .nginx title="infra/nginx/nginx.conf (the limit)" }
    --8<-- "docs/2027.1/hands-on/3/code/infra/nginx/nginx.conf:28:32,43:44"
    ```

**Try it.** Load the rate-limiter scenario and run the **spike** profile without limits: the backend saturates and p99 explodes for *everyone*. Turn on the gateway rate limit and tune its rate and burst: watch the 429s absorb the excess while p99 for accepted requests stays flat. What happens if the limit is set higher than the backend's capacity?

<div class="sdp" data-scenario="rate-limiter" data-mode="compact" data-height="520" data-profile="spike"></div>

[:material-open-in-new: Open the full playground](../../../../playground/index.md)

The full design of a distributed rate limiter, as an interview problem, is in the [rate limiter case study](../../case-studies/rate-limiter/index.md).

---

## Trade-offs at a glance { #trade-offs }

| Decision | Option A | Option B | Choose A when… |
|---|---|---|---|
| Entry point | one API gateway | BFF per client | clients have similar needs, or one team owns all clients |
| Algorithm | token bucket | sliding window counter | bursts are acceptable and you want simple, clear parameters |
| Counter store | shared (Redis) | local per replica | the limit must be accurate across replicas |
| Redis down | fail open | fail closed | availability matters more than strict protection |
| Gateway product | managed (AWS API GW, Apigee, APIM) | self-hosted (Kong, Spring Cloud Gateway, Envoy) | you want plans, keys and portals without operating them |
| Logic in gateway | only cross-cutting policies | business rules | always A |

!!! example "BoxOffice: the gateway on sale day"
    - **Routing**: `/api/events/**` → `catalog`, `/api/holds/**` → `inventory`, `/api/orders/**` → `order`, `/api/assistant/**` → `assistant`.
    - **Authentication**: the gateway validates the JWT issued by `auth` (signature with the cached public keys, expiry, audience) and forwards `X-User-Id`; `catalog` GETs are public.
    - **Rate limits** (several layers):
        - edge/WAF: 100 requests per 10 s per IP on `/login`; waiting-room token required on `/api/holds`;
        - gateway: token bucket per user, 10 req/s with bursts of 20 on `/api/**`, and 1 req/s with bursts of 3 on `POST /api/holds`;
        - `inventory`: at most 6 seats per hold and one active hold per user per event (a business rule, enforced with the database).
    - **Store**: Redis (with a replica) for the buckets; if it fails, gateways **fail open** with a local limit of 1/6 of the global one.
    - **Answers**: `429` with `Retry-After`; the app backs off with jitter and shows "too many attempts, try again in a few seconds".
    - **Assistant**: a separate, lower limit and a token-cost-based quota, because an LLM call is far more expensive than a catalog read (see [AI systems](../../ai-systems/index.md)).

!!! tip "In the interview"
    - Put the API gateway in the high-level design and list what it centralises: **routing, authentication, rate limiting, observability**. Then move on — unless the question is a rate limiter.
    - If asked to design a rate limiter: clarify **key, limit and scope** (per user? per IP? global?), pick **token bucket** (bursts) or **sliding window counter** (accuracy), store counters in **Redis with an atomic Lua script**, and discuss **fail open vs closed**, **multi-region** (local limits per region or async sync) and the **429 + Retry-After** response.
    - Know the **fixed window boundary problem** (2× burst) — it is a classic follow-up question.
    - Mention **BFF** when the question has very different clients (mobile, web, TV, partners).

!!! success "Best practices"

    - **Answer `429` with `Retry-After` (and the `RateLimit` headers)** — well-behaved clients back off exactly as long as needed instead of guessing.
    - **Run a new limit in count (log-only) mode before enforcing it** — measure who would have been limited, then switch it on.
    - **Give each route its own timeout and retry policy, with retries only on idempotent methods** — In BoxOffice: the gateway's 1 s connect / 5 s response timeouts and a `Retry` filter limited to `GET` in [lab 4](../../../hands-on/4/gateway/index.md) (box above).
    - **Validate JWTs locally with cached public keys** — a JWKS fetched and cached by the gateway costs no call to `auth` per request. In BoxOffice: `jwk-set-uri` in lab 4's `application.yaml`.
    - **Measure the gateway's own overhead and capacity** — p50 through the gateway versus direct, and its breaking point, so it is sized like any other tier.

!!! warning "Pitfalls"
    - **Gateway as a single point of failure or bottleneck**: it is on the path of every request. Run several replicas across zones, size it in load tests, and keep its per-request work small.
    - **Business logic in the gateway**: scripts and plugins that compute prices or allocate seats create a second, hidden monolith that nobody tests. Keep the gateway dumb and the services smart.
    - **Trusting the gateway alone**: services must still verify identity and authorisation (zero trust); an attacker inside the network bypasses the gateway.
    - **Per-replica counters** that silently multiply the limit by the number of replicas.
    - **Rate-limiting by IP only**: thousands of fans behind one mobile carrier's NAT share an IP; botnets have thousands of IPs. Prefer user/API-key keys, with IP limits only at the edge and generous.
    - **Retrying `429` immediately**: clients without backoff turn a limit into a retry storm.

---

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    GW["API gateway"] --> AUTH["JWT validation<br/>→ Network & Security"]
    GW --> RL["rate limiting"]
    RL --> TB["token bucket in Redis<br/>→ Caching (Redis)"]
    RL --> SHED["load shedding, 429<br/>→ Reliability"]
    RL --> RETRY["client retries with backoff<br/>→ retry storms"]
    GW --> BFF["BFF per client"]
    BFF --> STYLES["REST, GraphQL, gRPC<br/>→ Compute: API styles"]
    GW --> OBS["access logs, RED metrics<br/>→ Observability"]
    GW --> WR["waiting room<br/>→ Messaging (queue)"]
```

**Palette components:** [`apigw`](../../../reference/components/edge/index.md#apigw) · [`auth`](../../../reference/components/compute/index.md#auth) (issues the tokens the gateway validates) · [`cache`](../../../reference/components/storage/index.md#cache) (shared rate-limit counters) · [`queue`](../../../reference/components/messaging/index.md#queue) (the waiting room) · [`waf`](../../../reference/components/edge/index.md#waf) (coarse limits per IP, before the gateway). **Scenarios:** `rate-limiter`, `retry-storm`, `flash-sale`. **Continues in:** [Case study: rate limiter](../../case-studies/rate-limiter/index.md), [Reliability — patterns](../../reliability/patterns/index.md), [Network & Security — identity](../identity/index.md), [Hands-on 4](../../../hands-on/4/index.md).

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - An API gateway is the **single entry point** for APIs: routing, authentication offload, rate limits, transformations, aggregation and observability — **cross-cutting concerns only**.
    - The **BFF** pattern gives each client type its own tailored layer.
    - **Token bucket** (capacity = burst, refill = sustained rate) is the default rate-limiting algorithm; **leaky bucket** smooths output; **fixed window** allows 2× bursts at boundaries; **sliding window log** is exact but memory-heavy; **sliding window counter** is a cheap, accurate approximation.
    - Across replicas, keep counters in **Redis** and update them **atomically** (Lua); decide whether to **fail open or closed**.
    - Limit in **layers** (edge, gateway, service), answer **429 with Retry-After**, and make clients back off with jitter.

---

[^1]: RICHARDSON, C. [Pattern: API Gateway / Backends for Frontends](https://microservices.io/patterns/apigateway.html){target="_blank"}. microservices.io.
[^2]: NEWMAN, S. [Backends For Frontends](https://samnewman.io/patterns/architectural/bff/){target="_blank"}, 2015. See also NEWMAN, S. *Building Microservices*, 2nd ed. O'Reilly, 2021.
[^3]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1, ch. 4 "Design a rate limiter". Byte Code LLC, 2020.
[^4]: CLOUDFLARE. [How we built rate limiting capable of scaling to millions of domains](https://blog.cloudflare.com/counting-things-a-lot-of-different-things/){target="_blank"}. Cloudflare Blog, 2017.
[^5]: IETF HTTPAPI WG. [RateLimit header fields for HTTP](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/){target="_blank"}. Internet-Draft.
