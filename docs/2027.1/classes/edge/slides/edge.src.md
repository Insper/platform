---
marp: true
lang: en
title: Traffic & Edge
description: System Architecture · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">System Architecture · Insper</div>

# Traffic & Edge

**DNS, CDN, WAF, load balancers, API gateways and the protocols between them**

<!--
Outline: (1) the request's journey and edge security; (2) DNS and CDN; (3) load balancing and
consistent hashing; (4) API gateway and rate limiting; (5) protocols: HTTP/1.1, 2, 3, TLS, SSE,
WebSockets, gRPC.
-->

---

## 10:00 — the sale opens

<div class="q">

**2 million fans**, **60 thousand seats**, everyone presses "refresh" at 10:00:00.
How many of those requests should reach the `inventory` service?

</div>

* As **few as possible** — and only from real fans, in a fair order.
* Everything between the phone and the first service is **the edge**.
* Each hop makes a **decision** and should **remove work** from the next one.

<!--
Let the class guess. The answer drives the whole class: cache what can be cached, filter what
must be filtered, limit what remains, and only then balance it over healthy replicas.
-->

---

## The request's journey

| Palette id | Decides | Layer |
|---|---|---|
| `dns` | **where** the client goes: IP, region, edge location | DNS |
| `cdn` | whether the request needs to go **any further** | L7 |
| `waf` | whether the request is **allowed** (attacks, bots) | L7 |
| `lb` | **which replica** serves it (healthy ones only) | L4 / L7 |
| `apigw` | whether the **caller** is authenticated and within quota | L7 |
| `ingress` | which **Service** in the cluster receives it | L7 |

<p class="small">Most are <b>reverse proxies</b>: TLS termination, caching, compression, security and logs in one place. Real products merge boxes (Cloudflare = DNS + CDN + WAF + DDoS).</p>

---

## Edge security: WAF, bots, DDoS

| Threat | Defence |
|---|---|
| SQL injection, XSS, path traversal | **WAF** managed rules (OWASP CRS), count mode first |
| Scalper bots, credential stuffing | rate limits, fingerprints, challenges, business rules |
| "First second" advantage at the sale | **virtual waiting room**: admit N users/min |
| Volumetric flood (L3/L4) | **anycast** capacity + scrubbing — you buy it |
| Expensive valid-looking requests (L7) | caching, rate limits, challenges — you design for it |

<div class="ok">

The edge is the **cheapest place** to drop bad traffic: it has not cost the core anything yet.

</div>

---

## DNS: a cached, delegated database

- **Hierarchy**: root → `com.` → `boxoffice.com.` (authoritative) — delegated, read right to left.
- The phone asks a **recursive resolver**, which walks the hierarchy and **caches** by **TTL**.
- Authoritative servers see ≈ **one query per resolver per TTL**, not one per fan.
- Records: `A`/`AAAA` (IP), `CNAME` (alias), `ALIAS` (apex), `NS`, `MX`, `TXT`, `CAA`.
- **TTL** trades propagation speed for lookup load — **lower it before a migration**.

<!--
Ask: 2 million fans look up boxoffice.com at 10:00 — how many queries reach BoxOffice's DNS?
Thousands of resolvers × once per TTL.
-->

---

## Routing with DNS, and anycast

| Policy | The answer depends on |
|---|---|
| GeoDNS | the client's country (data residency) |
| Latency-based | the region with the lowest latency |
| Weighted | a percentage (DNS canary) |
| Failover | a health check |

<div class="warn">

DNS failover ≈ **detection + TTL**: 3 × 10 s + 60 s ≈ 90 s at best — and some clients ignore TTLs.

</div>

**Anycast**: the same IP announced from many locations → nearest edge, fast failover, DDoS absorption.

---

## CDN: content close to the fan

- **PoPs** (points of presence) cache content near users: latency, **offload**, protection.
- **Pull** (fetch on first miss) for almost everything; **push** for big known files (video).
- **Cache key** = host + path + query by default: drop `utm_*`, never ignore a personalising cookie.
- **Origin shield**: one regional tier between PoPs and origin → one miss per object, not per PoP.
- **Edge compute**: waiting-room token check, redirects, A/B — not database-bound logic.

---

## `Cache-Control`: the origin decides

```http
# fingerprinted bundle
Cache-Control: public, max-age=31536000, immutable
# event page: survive origin hiccups
Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=60, stale-if-error=3600
# seat map during the sale: micro-cache
Cache-Control: public, max-age=0, s-maxage=1
# order and payment pages
Cache-Control: private, no-store
```

<div class="ok">

Prefer **versioned URLs** (`app.b71e02.js`) to **purges**: purges are slow and never reach browsers.

</div>

---

## Hit ratio: talk about the miss rate

<div class="q">

200 000 req/s at the edge. Hit ratio goes from **90%** to **99%**. Origin load?

</div>

* 90% → **20 000** req/s at the origin.
* 99% → **2 000** req/s — ten times fewer servers.
* **Micro-caching** (1 s) of the seat map: 400 k req/s polling → ≈ **1 req/s per PoP**.

<p class="small">Every extra nine of hit ratio divides the origin load by ten.</p>

---

## Load balancing: L4 vs L7

| | L4 | L7 |
|---|---|---|
| Unit | connection | request |
| Sees | IPs, ports | method, path, headers, cookies |
| TLS | passes through | terminates |
| Routing by path | no | yes |
| Cost | very low | higher per request |

<p class="small">Common layout: L4 (or anycast) in front of a fleet of L7 proxies (Envoy, Nginx). Precondition for all of it: <b>stateless replicas</b>.</p>

---

<!-- _class: tight -->

## Balancing algorithms

| Algorithm | Picks | Use when |
|---|---|---|
| Round robin / weighted | next in cycle | uniform requests; canaries by weight |
| Least connections | fewest in flight | uneven request costs |
| **Power of two choices** | best of 2 random | many LB instances, no herding |
| Least response time (EWMA) | lowest recent latency | routing around degraded servers |
| IP hash | `hash(ip) mod N` | rarely — NATs, reshuffles |
| **Consistent hashing** | first node clockwise on a ring | the key must land where its data is |

<div class="ok">

Adding a node: `hash mod N` moves ≈ **N/(N+1)** of the keys; the ring moves ≈ **1/(N+1)**. **Virtual nodes** (100–200 per server) balance the ring.

</div>

---

## Health checks, draining, stickiness

- **Active** checks: LB probes `/health/readiness`; **passive**: eject replicas that return 5xx.
- Readiness checks the **instance**, not shared dependencies (a DB blip would eject everyone).
- **Draining**: stop new requests, finish in-flight ones, then remove — invisible deploys.
- **Sticky sessions** make replicas stateful: lost sessions, uneven load. Prefer a shared store.
- The LB must not be a SPOF: managed multi-zone LB, active-passive pair with VIP, or anycast.

---

## Kubernetes: Service, Ingress, Gateway API

| Object | Does |
|---|---|
| `Service` | stable IP/DNS, L4 over **ready** pods |
| `Ingress` | basic L7 host/path routing; extras via non-portable annotations |
| `GatewayClass` | which implementation (Envoy, Istio, Cilium, cloud) |
| `Gateway` | listeners, ports, TLS — owned by the platform team |
| `HTTPRoute` | matches, **weights**, timeouts — owned by app teams |

<p class="small">Gateway API is the successor of Ingress: role-oriented and portable, with canary weights and gRPC routes in the standard.</p>

---

## The API gateway

- Single entry point: **routing**, **authN offload** (JWT), coarse authZ, **rate limits**, quotas.
- Also: transformations, aggregation, short caching, logs/metrics/traces, API keys and plans.
- **BFF** (Backend for Frontend): one thin layer per client type (mobile, web, partners).
- Gateway ≠ LB ≠ ingress ≠ **service mesh** (east-west traffic, mTLS).

<div class="warn">

Keep it **dumb**: business rules in the gateway become a hidden second monolith — and it sits on the path of every request.

</div>

---

## Token bucket

<div class="cols">
<div>

- Bucket of **capacity** C (burst), refilled at **rate** r (sustained).
- Each request takes a token; empty → **429**.
- Two numbers per key; refill computed lazily: `tokens += elapsed × r`.

</div>
<div>

<div class="q">

C = 20, r = 10/s. An idle fan sends 50 requests at once.

</div>

* **20** accepted, 30 rejected.
* Afterwards: at most **10/s**.

</div>
</div>

---

<!-- _class: tight -->

## Rate-limiting algorithms

| Algorithm | Memory per key | Bursts | Note |
|---|---|---|---|
| **Token bucket** | 2 numbers | up to capacity | default in gateways |
| **Leaky bucket** | a queue | smoothed | constant output rate; Nginx `limit_req` |
| **Fixed window** | 1 counter | **2× at boundaries** | 100 at 10:00:59 + 100 at 10:01:00 |
| **Sliding window log** | 1 timestamp per request | none | exact, memory-heavy |
| **Sliding window counter** | 2 counters | ≈ limited | `cur + prev × (1 − elapsed/window)` |

<p class="small">Six gateway replicas with local counters = 6× the limit → shared <b>Redis</b> counters updated atomically (Lua). Decide: fail open or closed? Answer <code>429</code> + <code>Retry-After</code>; limit in layers: edge (IP), gateway (user), service (business rules).</p>

---

## HTTP/1.1 → HTTP/2 → HTTP/3

| | HTTP/1.1 | HTTP/2 | HTTP/3 |
|---|---|---|---|
| Transport | TCP | TCP | QUIC (UDP) |
| Per connection | 1 request at a time | multiplexed streams | independent streams |
| Head-of-line blocking | HTTP + TCP | TCP | none across streams |
| Handshake to first byte (new) | TLS 1.2: 4 RTT | TLS 1.3: 3 RTT | 2 RTT · 0-RTT: 1 |
| Survives Wi-Fi → 4G | no | no | **yes** (connection ID) |

<p class="small">At 150 ms RTT: 600 ms vs 300 ms before the first byte. Best handshake: the one you do not repeat (keep-alive, pooling, edge near the user).</p>

---

## Real-time and service-to-service

| Option | Direction | Good for |
|---|---|---|
| Polling (+ CDN micro-cache) | client pulls | updates every few seconds; cheapest |
| Long polling | client pulls, server holds | legacy clients |
| **SSE** | server → client, plain HTTP, auto-resume | seat map, waiting room, LLM streaming |
| **WebSockets** | both ways, stateful | chat, games, collaboration |
| **gRPC** | unary + streaming over HTTP/2, deadlines | `order` → `inventory` |

<div class="warn">

Long-lived connections are balanced **at connect time**: new replicas stay idle; deploys cause **reconnection storms** → L7/client-side balancing, max connection age, jitter.

</div>

---

## The edge concept map

| Component | Question it answers | Key concepts |
|---|---|---|
| `dns` | *where* does the client go? | TTL, GeoDNS, anycast, failover |
| `cdn` | does it need to go further? | cache key, `Cache-Control`, hit ratio |
| `waf` | is the request *allowed*? | rules, bots, waiting room, DDoS |
| `lb` | *which replica*? | L4/L7, P2C, consistent hashing, health |
| `apigw` | is the *caller* allowed, within quota? | JWT, token bucket, BFF |
| `ingress` | which *Service* in the cluster? | Gateway API, service discovery |

<p class="small">Each hop should <b>remove work</b> from the next one. Protocols (HTTP/2, HTTP/3, SSE, WebSockets, gRPC) cross all of them.</p>

---

## Takeaways

1. The edge — `dns`, `cdn`, `waf`, `lb`, `apigw`, `ingress` — exists to **remove work** from the core.
2. DNS is cached by TTL; DNS failover ≈ detection + TTL; **anycast** for latency and DDoS.
3. Size the origin with the CDN **miss rate**; versioned URLs; **micro-cache** hot dynamic data.
4. L4 balances connections, L7 requests; **P2C** for uneven load, **consistent hashing** for affinity.
5. The gateway centralises **cross-cutting** policies only; **token bucket** = burst + rate, in Redis.
6. Count **round trips**: TLS 1.3 and QUIC cut handshakes; **SSE** for one-way push, WebSockets for two-way.
