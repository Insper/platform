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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">System Architecture · Insper</div>

# Traffic & Edge

**The Domain Name System (DNS), content delivery networks (CDN), web application firewalls (WAF), load balancers, API gateways and the protocols between them**

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

<div class="flow">
<div class="box muted" style="flex: .6">fan's phone</div><div class="arrow">→</div>
<div class="box accent"><code>dns</code><small>where to go: IP, region, edge</small></div><div class="arrow">→</div>
<div class="box green"><code>cdn</code><small>go any further? a hit ends here</small></div><div class="arrow">→</div>
<div class="box red"><code>waf</code><small>allowed? attacks, bots</small></div>
</div>
<div class="flow">
<div class="arrow">→</div>
<div class="box accent"><code>lb</code><small>which healthy replica · L4 or L7</small></div><div class="arrow">→</div>
<div class="box orange"><code>apigw</code><small>caller authenticated, within quota?</small></div><div class="arrow">→</div>
<div class="box accent"><code>ingress</code><small>which Service in the cluster</small></div><div class="arrow">→</div>
<div class="box" style="flex: .7"><code>inventory</code></div>
</div>

- Each hop makes a **decision** as early and as cheaply as possible, and **removes work** from the next one.
- Most are **reverse proxies**: Transport Layer Security (TLS) termination, caching, compression, security and logs in one place.
- Real products merge boxes: Cloudflare = DNS + CDN + WAF + distributed denial of service (DDoS) protection.

---

## Where TLS terminates

| Option | How | ✅ | ❌ |
|---|---|---|---|
| **At the edge** | CDN / load balancer decrypts; plain HTTP inside | simple; caching and WAF can read requests | readable inside the network |
| **Re-encrypt** (bridging) | decrypt, inspect, new TLS to the backend | inspection *and* encryption in transit | two handshakes, certificates on backends |
| **Pass-through** | an L4 balancer forwards encrypted bytes | end-to-end encryption | no L7 routing, caching or WAF |

<div class="q">

Can a CDN cache a page if TLS goes all the way to the service?

</div>

* No: to cache it must read it, so it must hold the certificate. Zero trust: terminate at the edge, encrypt again inside (mutual TLS, mTLS, from the mesh).

---

## A latency budget for the edge

| Step (São Paulo fan, São Paulo region) | Cold | Warm |
|---|---|---|
| DNS lookup | 30 ms | 0 (cached) |
| TCP + TLS 1.3 handshake, 2 round trips (RTT) × 10 ms | 20 ms | 0 (reused) |
| CDN → WAF → LB → gateway (JWT check, rate limit) | 10 ms | 10 ms |
| Ingress → `inventory` → PostgreSQL | 40 ms | 40 ms |
| 60 KB of JSON over mobile | 30 ms | 30 ms |
| **Total** (target: 200 ms at the 99th percentile, p99) | **≈ 130 ms** | **≈ 80 ms** |

<p class="small">Illustrative numbers. Connection setup is expensive and avoidable; distance dominates (Virginia: 120 ms per round trip); the cheapest request never reaches the origin.</p>

---

## Edge security: WAF, bots, DDoS

| Threat | Defence |
|---|---|
| SQL injection, cross-site scripting (XSS), path traversal | **WAF** managed rules (OWASP Core Rule Set), count mode first |
| Scalper bots, credential stuffing | rate limits, fingerprints, challenges, business rules |
| "First second" advantage at the sale | **virtual waiting room**: admit N users/min |
| Volumetric flood (L3/L4) | **anycast** capacity + scrubbing — you buy it |
| Expensive valid-looking requests (L7) | caching, rate limits, challenges — you design for it |

<div class="ok">

The edge is the **cheapest place** to drop bad traffic: it has not cost the core anything yet.

</div>

---

## 10:00, layer by layer

<div class="flow">
<div class="box accent">DNS<small>CDN's anycast addresses · time to live (TTL) 60 s</small></div>
<div class="box green">CDN<small>assets for a year · event page for minutes · seat map micro-cached 1 s</small></div>
<div class="box red">WAF<small>OWASP rules · <code>POST /api/holds</code> only with a waiting-room token</small></div>
</div>
<div class="flow">
<div class="box red">bots<small>JavaScript challenge on suspicious fingerprints and data-centre networks</small></div>
<div class="box orange">waiting room<small>admits N users/min, sized from <code>inventory</code> and <code>payment</code></small></div>
<div class="box orange">API gateway<small>JWT check · token bucket 10 req/s, bursts of 20 · 6 seats per hold</small></div>
</div>

<div class="ok">

The core sees thousands of requests per second instead of millions — in the order the waiting room decided, not the fastest bot.

</div>

---

## DNS: a cached, delegated database

<div class="flow">
<div class="box muted">phone<small>stub resolver</small></div><div class="arrow">→</div>
<div class="box accent">recursive resolver<small>carrier, 1.1.1.1 · caches by TTL</small></div><div class="arrow">miss →</div>
<div class="box">root<small>ask <code>.com</code></small></div><div class="arrow">→</div>
<div class="box"><code>.com</code><small>ask <code>boxoffice.com</code></small></div><div class="arrow">→</div>
<div class="box green">authoritative<small>203.0.113.10, TTL 60</small></div>
</div>

- Delegated, read right to left; the phone asks a **recursive resolver**, which walks the hierarchy and **caches**.
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

DNS failover ≈ **detection + TTL**: 3 failed checks × 30 s + 60 s ≈ **2.5 min** at best — and some clients ignore TTLs.

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

<p class="small">Expired? The cache revalidates with <code>If-None-Match</code> and gets <code>304 Not Modified</code>, no body; with <code>stale-while-revalidate</code> the fan gets the stale copy at once while the PoP revalidates.</p>

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
| Least response time (EWMA, moving average) | lowest recent latency | routing around degraded servers |
| IP hash | `hash(ip) mod N` | rarely — NATs, reshuffles |
| **Consistent hashing** | first node clockwise on a ring | the key must land where its data is |

<div class="ok">

Adding a node: `hash mod N` moves ≈ **N/(N+1)** of the keys; the ring moves ≈ **1/(N+1)**. **Virtual nodes** (100–200 per server) balance the ring.

</div>

---

## Health checks, draining, stickiness

<div class="flow">
<div class="box muted">starting</div><div class="arrow">readiness passes →</div>
<div class="box green">in the pool</div><div class="arrow">2 probes fail · 5 × 5xx →<br>← 3 probes pass</div>
<div class="box red">out of the pool</div>
<div class="box orange">draining<small>deploy or scale-in: no new requests, in-flight ones finish (≤ 30 s)</small></div>
</div>

- **Active** checks probe `/health/readiness`; **passive** ones (outlier detection) eject replicas that fail real requests.
- Readiness checks the **instance**, not shared dependencies (a DB blip would eject everyone).
- **Sticky sessions** make replicas stateful: lost sessions, uneven load. Prefer a shared store.
- The LB must not be a single point of failure (SPOF): managed multi-zone LB, active-passive pair with a virtual IP, or anycast.

---

## Service discovery: which replicas exist now?

<div class="cols">
<div>

**Server-side**
- the caller asks a **name**; a load balancer or `kube-proxy` picks the replica
- registry: Kubernetes endpoints, cloud target groups
- one extra hop, no library in the caller

</div>
<div>

**Client-side**
- the caller asks the **registry** (Consul, Eureka) and picks a replica itself
- no extra hop, but a library per language — or a mesh sidecar
- gRPC clients with xDS, service meshes

</div>
</div>

<p class="small">Discovery and health checks answer the same question: <i>which replicas can serve now?</i> A replica joins when its readiness probe passes.</p>

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

- Single entry point: **routing**, **authN offload** (JSON Web Token, JWT), coarse authZ, **rate limits**, quotas.
- Also: transformations, aggregation, short caching, logs/metrics/traces, API keys and plans.
- **Backend for Frontend (BFF)**: one thin layer per client type (mobile, web, partners).
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

<p class="small">Nginx's <code>limit_req</code> in lab 3: 20 req/s per API key, <code>burst=40 nodelay</code> — a greedy client got 640 answers in 30 s, the burst plus 20/s.</p>

---

## Distributed rate limiting

<div class="flow">
<div class="box">gateway-1<small>reads "1 token"</small></div><div class="arrow">→</div>
<div class="box red">both accept<small>read-modify-write without atomicity: 2 requests on 1 token</small></div><div class="arrow">←</div>
<div class="box">gateway-2<small>reads "1 token"</small></div>
</div>
<div class="flow">
<div class="box">gateway-1, gateway-2</div><div class="arrow">EVAL →</div>
<div class="box green">Lua script in Redis<small>runs alone: refill, take, answer · clock from Redis</small></div><div class="arrow">→</div>
<div class="box orange">one 200, one 429</div>
</div>

- Six replicas with local counters = **6×** the limit → shared counters in **Redis**, one round trip per request.
- Redis down: **fail open** (with a local limit) or **fail closed**? Decide before the sale.
- Answer `429` + `Retry-After`; limit in layers: edge (IP), gateway (user), service (business rules).

---

## Sessions vs tokens

| | Server-side session | JWT access token |
|---|---|---|
| Client holds | random id | signed claims |
| Validation | lookup (Redis) | signature, locally |
| Revocation | immediate | only at `exp` |
| Scaling | shared store | stateless |

<div class="q">

Tokens live 15 min, validated locally. Refresh revoked at 14:05, last token issued 13:58. Until when can a thief call?

</div>

* **14:13** — the exposure window is one token lifetime. Shorter tokens, introspection or DPoP shrink it.

---

## OAuth 2.1 in one slide

- **Delegated authorization**: the client gets a limited, short-lived token; it **never sees the password**.
- Roles: resource owner · client (public / confidential) · authorization server · resource server.
- **PKCE (Proof Key for Code Exchange) for every** authorization-code client; **Implicit and the password grant (ROPC) removed**.
- **Exact** redirect-URI matching; no tokens in URLs; refresh tokens **rotated** or sender-constrained.
- Grants: **Auth Code + PKCE** (users) · **Client Credentials** (jobs) · **Device** (TVs) · **Token Exchange** (delegation).

---

## The mobile app: Authorization Code + PKCE

1. App creates `code_verifier`; sends `code_challenge = S256(verifier)` + `state` + `nonce`.
2. **System browser** opens `/authorize`; user logs in at `auth` (multi-factor authentication, MFA, or passkey).
3. Redirect brings back a one-time **code**; app checks `state`.
4. App posts `code` + `code_verifier` to `/token`; server compares hashes.
5. Gets **access** (15 min) + **refresh** (rotating) + **ID** token.
6. Gateway verifies the JWT **locally** (JSON Web Key Set, JWKS): signature, `iss`, `aud`, `exp`, scope.

<div class="ok">

A stolen code is useless without the verifier. The password never touches BoxOffice code.

</div>

---

## OpenID Connect (OIDC) and validating a JWT

<div class="cols">
<div>

**OIDC adds**
- `openid` scope
- **ID token** for the *client*
- UserInfo endpoint
- discovery: `/.well-known/openid-configuration`
- web: a **BFF** keeps tokens, browser gets an `HttpOnly` cookie

</div>
<div>

**Validate (RFC 8725)**
- allow-listed `alg`, key by `kid`
- `iss` = our provider
- `aud` = **this** API
- `exp` / `nbf`, small skew
- `typ` = `at+jwt`, scopes

</div>
</div>

---

## Authorization models

| Model | Decides by | BoxOffice |
|---|---|---|
| **RBAC** (role-based) | roles | `organizer` creates events |
| **ABAC** (attribute-based) | attributes + context | refund only > 48 h before the show |
| **ReBAC** (relationship-based) | relationships | Bruno sees the ticket Ana shared |

- Scopes limit the **client**; ownership limits the **user** → Broken Object Level Authorization (BOLA) check in `order`.
- Refresh tokens rotate: a reused one revokes the whole family — the thief and the app both log in again.
- Policy as code: **Open Policy Agent (OPA) / Rego**, **Cedar**, OpenFGA.

---

## HTTP/1.1 → HTTP/2 → HTTP/3

| | HTTP/1.1 | HTTP/2 | HTTP/3 |
|---|---|---|---|
| Transport | TCP | TCP | QUIC (UDP) |
| Per connection | 1 request at a time | multiplexed streams | independent streams |
| Head-of-line blocking | HTTP + TCP | TCP | none across streams |
| Handshake to first byte (new) | TLS 1.2: 4 RTT · 1.3: 3 | TLS 1.2: 4 RTT · 1.3: 3 | 2 RTT · 0-RTT: 1 |
| Survives Wi-Fi → 4G | ❌ no | ❌ no | ✅ **yes** (connection ID) |

<p class="small">At 150 ms RTT: 600 ms vs 300 ms before the first byte. Best handshake: the one you do not repeat (keep-alive, pooling, edge near the user).</p>

---

## The simulator: 30 calls, four stacks

<div class="flow">
<div class="box red">HTTP/1.1, new connection per call<small>TLS 1.2, 6 at a time · <b>3.00 s</b></small></div>
<div class="box orange">HTTP/1.1, 6 kept-alive connections<small>TLS 1.3 · <b>1.05 s</b></small></div>
<div class="box accent">HTTP/2, one connection<small><b>459 ms</b></small></div>
<div class="box green">HTTP/3 over QUIC<small><b>309 ms</b></small></div>
</div>
<p class="small">The event screen's 30 API calls, round trip 150 ms, no loss: the whole gap is round trips.</p>

- At **2% loss**, both end one round trip later (603 ms and 453 ms) — but over HTTP/2, **29 of 30** calls wait behind another call's lost packet: half are back at 603 ms, against 307 ms over HTTP/3.
- That is TCP's **head-of-line (HOL) blocking**, and the reason for QUIC. At 10 ms (an edge in the fan's city) the worst stack takes 201 ms.

<!--
The simulator is on the Protocols page, right after the "Think first" on the 30 calls.
-->

---

## Real-time and service-to-service

| Option | Direction | Good for |
|---|---|---|
| Polling (+ CDN micro-cache) | client pulls | updates every few seconds; cheapest |
| Long polling | client pulls, server holds | legacy clients |
| **Server-Sent Events (SSE)** | server → client, plain HTTP, auto-resume | seat map, waiting room, streaming a model's answer |
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

## What breaks next

<div class="warn">

The edge sends any request to **any** replica, and the gateway checks the token once for all services — both assume that any replica can serve any request.

</div>

- A replica that keeps a session or a seat hold in memory loses it when it dies, or when the next request lands elsewhere.
- Lab 3: three `catalog` replicas multiply the cheap requests, not the mixed workload — PostgreSQL is the bottleneck (`db` at ~670% CPU, each replica at ~20%).
- What a replica must be (**stateless**), how services are cut, and the gateway of lab 4: class 5, Compute & Services.

---

## Takeaways

1. The edge — `dns`, `cdn`, `waf`, `lb`, `apigw`, `ingress` — exists to **remove work** from the core.
2. DNS is cached by TTL; DNS failover ≈ detection + TTL; **anycast** for latency and DDoS.
3. Size the origin with the CDN **miss rate**; versioned URLs; **micro-cache** hot dynamic data.
4. L4 balances connections, L7 requests; **P2C** for uneven load, **consistent hashing** for affinity.
5. The gateway centralises **cross-cutting** policies only; **token bucket** = burst + rate, in Redis.
6. Count **round trips**: TLS 1.3 and QUIC cut handshakes; **SSE** for one-way push, WebSockets for two-way.
