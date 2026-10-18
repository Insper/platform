Click **"Answer"** to reveal the correct answer and explanation.

---

## The edge and its security

**Q1.** In the BoxOffice request path *fan → DNS → CDN → WAF → load balancer → API gateway → ingress → `inventory`*, which component should reject a request whose JWT has expired?

- A. The CDN, because it is closest to the fan
- B. The load balancer, because it already terminates TLS
- C. The API gateway, which centralises authentication for every service
- D. The ingress, because it knows which Kubernetes Service owns the route

??? success "Answer"
    **C — The API gateway.**

    Validating identity (JWT signature, expiry, audience) is the classic cross-cutting job of the API gateway: it is done once, consistently, before any service runs. The CDN and the load balancer do not know about users (although an edge function *can* pre-validate tokens), and the ingress only routes by host and path. The services should still check authorisation for their own resources (zero trust), but rejecting an expired token belongs at the gateway.

---

**Q2.** At 10:00 a botnet of 50 000 residential IP addresses sends valid-looking `GET /api/search?q=…` requests, each of them expensive for the backend. Which defence is **least** effective on its own?

- A. A rate limit of 100 requests per minute per IP address
- B. Caching search results at the CDN for a few seconds
- C. A JavaScript challenge for clients with a suspicious fingerprint
- D. A virtual waiting room that admits users at a controlled rate

??? success "Answer"
    **A — A per-IP rate limit.**

    Each bot can send up to 100 requests per minute and never trip the limit: 50 000 × 100 = 5 million requests per minute (about 83 000 per second), all accepted. This is an **application-layer (L7) DDoS** distributed across many sources: per-IP limits barely notice it. Caching makes repeated expensive requests cheap, challenges filter automated clients, and a waiting room caps the rate that reaches the core regardless of how many sources there are.

---

**Q3.** Why is **anycast** effective against volumetric DDoS attacks?

- A. It encrypts traffic, so attackers cannot read the responses
- B. The same IP address is announced from many locations, so traffic from a global botnet is split across all of them instead of concentrating on one
- C. It blocks UDP traffic, which is used by most attacks
- D. It changes the site's IP address every few seconds

??? success "Answer"
    **B — The flood is divided among many locations.**

    With anycast, routing delivers each packet to the nearest location announcing the address. A botnet spread around the world therefore hits hundreds of edge locations, each receiving a fraction of the attack — a fraction that a large CDN can absorb. This is why volumetric DDoS protection is usually bought from providers with large anycast networks.

---

## DNS & CDN

**Q4.** BoxOffice uses DNS failover between two regions. Health checks run every 10 s, the primary is declared unhealthy after 3 consecutive failures, and the record's TTL is 60 s. In the best case, roughly how long after the primary region fails do clients that respect the TTL start using the secondary?

- A. About 10 seconds
- B. About 30 seconds
- C. About 90 seconds
- D. About 10 minutes

??? success "Answer"
    **C — About 90 seconds.**

    Detection takes about 3 × 10 s = 30 s; after that, resolvers may still hold the old answer for up to one TTL (60 s). Total ≈ 30 + 60 = 90 s in the best case. In practice it is longer: some resolvers and clients keep answers longer than the TTL, and open connections keep using the old region until they break. DNS failover is suitable for regional disasters, not for fast instance-level failover.

---

**Q5.** The edge receives 200 000 requests per second for static content. The CDN hit ratio improves from **95%** to **99%**. What happens to the load on the origin?

- A. It drops by about 4%, from 10 000 to 9 600 requests per second
- B. It drops by about 80%, from 10 000 to 2 000 requests per second
- C. It does not change; the hit ratio only affects latency
- D. It drops by half, from 10 000 to 5 000 requests per second

??? success "Answer"
    **B — From 10 000 to 2 000 req/s.**

    The origin sees the **miss** rate: 5% of 200 000 = 10 000 req/s before, 1% of 200 000 = 2 000 req/s after — five times fewer. Small changes in hit ratio near 100% are large changes in miss rate, which is the number that sizes the origin.

---

**Q6.** BoxOffice deploys a new JavaScript bundle. Which strategy guarantees that no fan runs a mix of the old HTML and the new JavaScript, without depending on CDN purges?

- A. Keep the name `app.js` and set `Cache-Control: no-store` on it
- B. Keep the name `app.js`, deploy, and purge it from every PoP
- C. Give the bundle a content-based name (`app.b71e02.js`) cached with `max-age=31536000, immutable`, and reference it from an HTML page with a short TTL
- D. Set `max-age=60` on `app.js` and wait one minute after each deploy

??? success "Answer"
    **C — Fingerprinted (versioned) URLs.**

    A new version gets a new URL, so caches can never serve an old file under the new name; old and new versions coexist while the short-lived HTML switches from one to the other. Purges are slow, may fail and never reach browser caches; `no-store` throws away the benefit of the CDN; a 60 s TTL still leaves a window of mixed versions.

---

**Q7.** During the sale, the seat-availability endpoint receives 400 000 requests per second from fans polling. The response may be up to one second old. With `Cache-Control: s-maxage=1` and **40 CDN PoPs** serving those fans (no origin shield), what is the maximum request rate this endpoint sends to the origin?

- A. About 40 requests per second
- B. About 4 000 requests per second
- C. About 400 000 requests per second
- D. Zero, because the CDN never contacts the origin for cached content

??? success "Answer"
    **A — About 40 req/s.**

    Each PoP fetches the object at most once per second when it expires (one PoP × 1 req/s × 40 PoPs). This is **micro-caching**: a short TTL on a hot dynamic endpoint turns hundreds of thousands of requests per second into a handful at the origin, at the cost of up to one second of staleness. An origin shield would reduce it further to about one request per second. The hold itself must still go to the origin and be checked against the database.

---

## Load balancing

**Q8.** Which statement about **L4** and **L7** load balancers is correct?

- A. An L4 load balancer can route `/api/holds` to `inventory` and `/api/orders` to `order`
- B. An L7 load balancer chooses a backend per HTTP request and can route by path, host or header; an L4 load balancer chooses per connection and only sees IPs and ports
- C. L4 load balancers always terminate TLS
- D. L7 load balancers are always faster than L4 ones because they understand the protocol

??? success "Answer"
    **B.**

    L4 works with connections (TCP/UDP): fast and protocol-agnostic, but blind to paths and headers, and usually passing TLS through. L7 terminates the connection, reads each request and can route, retry, rewrite and balance per request — at a higher CPU cost per request.

---

**Q9.** A cache tier uses `server = hash(key) mod N` with N = 4 servers. A fifth server is added. Approximately what fraction of keys now map to a different server, and what would it be with consistent hashing?

- A. 20% with `mod N`; 80% with consistent hashing
- B. About 80% with `mod N`; about 20% with consistent hashing
- C. 25% in both cases
- D. 100% with `mod N`; 0% with consistent hashing

??? success "Answer"
    **B — About 80% vs about 20%.**

    With `mod N`, a key keeps its server only if `hash mod 4 = hash mod 5`, which happens for about 1 key in 5, so ~80% move — almost every cache entry misses at once. With consistent hashing, the new server takes over only the keys between itself and its predecessors on the ring: about **1/(N+1) = 1/5 = 20%**, exactly the share it must own anyway.

---

**Q10.** Why do consistent-hashing implementations place each server on the ring **many times** (virtual nodes)?

- A. To encrypt the keys
- B. To make the arcs between points average out, so each server owns close to its fair share of keys, and to spread a removed server's keys over all remaining servers
- C. To allow the same key to be stored on several servers for durability
- D. To make lookups O(1) instead of O(log N)

??? success "Answer"
    **B — Balance.**

    With one point per server, random positions create arcs of very different lengths: one server can own half of the keys and another almost none. With 100–200 points per server, the ownership of each server is the sum of many small arcs and approaches 1/N. When a server leaves, its many small arcs are inherited by many different servers. Replication (C) is a separate design choice built on top of the ring.

---

**Q11.** The `order` service calls `inventory` over gRPC through an L4 load balancer. After scaling `inventory` from 3 to 6 pods, the new pods receive almost no traffic. What is the most likely cause?

- A. The new pods failed their readiness probes
- B. gRPC uses long-lived HTTP/2 connections, and an L4 load balancer chooses a backend only when a connection is opened; the existing connections stay on the old pods
- C. gRPC does not support more than three servers
- D. The L4 load balancer uses consistent hashing on the request path

??? success "Answer"
    **B — Connection-level balancing of long-lived connections.**

    `order` multiplexes all its calls over a few HTTP/2 connections opened before the scale-out. Fixes: per-request L7 balancing (Envoy, a service mesh), client-side load balancing in the gRPC client, or a maximum connection age so clients reconnect and spread over the new pods.

---

## API gateway and rate limiting

**Q12.** A token bucket has **capacity 20** and a **refill rate of 10 tokens/s**. A fan who has been idle for a minute sends 50 requests in the same instant. How many are accepted immediately, and what is the maximum sustained rate afterwards?

- A. 50 accepted; then 20 per second
- B. 20 accepted; then 10 per second
- C. 10 accepted; then 10 per second
- D. 30 accepted; then 20 per second

??? success "Answer"
    **B — 20 now, 10 per second afterwards.**

    After a long idle period the bucket is full (capacity 20, never more). The instant burst consumes the 20 tokens; the other 30 requests are rejected with `429`. From then on, tokens arrive at 10 per second, so that is the maximum sustained rate: capacity sets the **burst**, refill sets the **average**.

---

**Q13.** A **fixed window** limiter allows 100 requests per minute per user. What is the largest number of requests a user can get accepted in any 2-second interval?

- A. 100
- B. About 3, because 100 per minute is under 2 per second
- C. 200, by sending 100 at the end of one window and 100 at the start of the next
- D. Unlimited, because the counter resets every minute

??? success "Answer"
    **C — 200.**

    This is the **boundary problem** of fixed windows: 100 requests at 10:00:59 fill the 10:00 window, and 100 more at 10:01:00 fill the 10:01 window — 200 accepted in about one second, twice the intended rate. The sliding window log (exact) or the sliding window counter (weighted approximation) fix it.

---

**Q14.** BoxOffice runs **6 gateway replicas** behind a load balancer, and each replica keeps its rate-limit counters in local memory with a limit of 10 req/s per user. Requests are spread evenly across replicas. What limit does a user actually get, and what is the usual fix?

- A. 10 req/s; no fix needed
- B. Up to about 60 req/s; store the counters in a shared store such as Redis and update them atomically (e.g. with a Lua script)
- C. About 1.7 req/s; increase the limit to 60
- D. 10 req/s, but only if sticky sessions are enabled

??? success "Answer"
    **B — Up to 6× the limit; use a shared, atomic counter.**

    Each replica sees one sixth of the user's requests and applies the full limit to them, so the effective limit is ~60 req/s. A shared store (Redis) with an atomic read-modify-write (a Lua script, or `INCR` with expiry for windows) gives one consistent count. Alternatives accept approximation: each replica enforces `limit / replicas`, or replicas sync counters asynchronously. Sticky sessions would help only partially and harm load balancing.

---

## Protocols

**Q15.** The seat map must show, to millions of browsers, each seat that becomes held or sold within about one second. Clients never send data back on this channel. Which choice is the simplest that meets the requirement?

- A. WebSockets, because they are the fastest real-time protocol
- B. Server-Sent Events: one long-lived HTTP response streaming events, with automatic reconnection and resume via `Last-Event-ID`
- C. gRPC bidirectional streaming from the browser
- D. Long polling with a 60-second timeout and no caching

??? success "Answer"
    **B — Server-Sent Events.**

    The traffic is **one-way** (server → client), so SSE fits exactly: it is plain HTTP (works through CDNs, proxies and HTTP/2 multiplexing), and `EventSource` reconnects and resumes on its own. WebSockets would work but add a stateful bidirectional channel, upgrade handling and custom reconnection for no benefit. gRPC is not natively available in browsers. Polling with CDN micro-caching is also a valid, even cheaper design if a couple of seconds of delay are acceptable.
