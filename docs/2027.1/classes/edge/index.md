It is 09:59:58 on a Tuesday. BoxOffice has announced that tickets for a stadium show go on sale at 10:00: **60 thousand seats, about 2 million fans** with the page open, many of them pressing "refresh" every second. At 10:00:00 every phone sends a request at once. Most of those requests should never reach the `inventory` service that holds the seats — and the ones that do must arrive at a healthy replica, in a fair order, from real fans and not from scalper bots.

Everything that happens between the fan's phone and the first BoxOffice service is the **edge**: name resolution, content delivery, traffic filtering, load balancing, and the API gateway. This class is about that path. It decides how fast the first byte arrives, how much load the core services see, and whether a flash sale is a success or a 10-minute outage on the evening news.

In this course, **the edge** means the set of components that receive, filter, route and distribute traffic *before* it reaches the application services. In the course simulator they form the **TRAFFIC & EDGE** category of the palette: `dns`, `cdn`, `waf`, `lb`, `apigw` and `ingress`[^1].

!!! quote "The story so far"

    Chapter 4 of the [story of the course](../../index.md#story). BoxOffice has numbers ([class 2](../estimation/index.md)) and knows that the network between its machines lies ([class 3](../distributed/index.md)). Now 2 million phones send a request in the same second — about 100,000 requests/s at the edge — while one `catalog` replica keeps its latency target only up to a few hundred. **This class** answers: which requests can end before reaching any service, and how does the rest reach a healthy replica — from an identified caller, fairly and at a rate the core can take?

!!! abstract "Learning objectives"

    By the end of this class you should be able to:

    - **Trace** a request from a client to a service through DNS, CDN, WAF, load balancer, API gateway and ingress, and **explain** what each hop decides.
    - **Configure** DNS records and TTLs, and CDN caching (`Cache-Control`, cache keys, invalidation) for a read-heavy page, and **compute** the origin load for a given hit ratio.
    - **Compare** L4 and L7 load balancing and **choose** a balancing algorithm (round robin, least connections, power of two choices, consistent hashing) for a workload.
    - **Design** a rate-limiting policy with token bucket or sliding window, and **place** it at the right layer.
    - **Contrast** HTTP/1.1, HTTP/2, HTTP/3 (QUIC), WebSockets, SSE and gRPC, and **select** one for a given interaction.
    - **Defend** an edge architecture against bots and DDoS attacks with WAF rules, rate limits, challenges and a waiting room.

## Roadmap

1. **This overview** — the request's journey through the edge, reverse proxies, TLS termination, a latency budget, and edge security (WAF, bots, DDoS).
2. [DNS & CDN](dns-cdn/index.md) — name resolution, TTLs, GeoDNS and anycast; content delivery networks, cache keys, invalidation and edge compute.
3. [Load Balancing](load-balancing/index.md) — L4 vs L7, algorithms, consistent hashing, service discovery, health checks, and Kubernetes Ingress / Gateway API.
4. [API Gateway & Rate Limiting](api-gateway/index.md) — what a gateway centralises, the BFF pattern, and the rate-limiting algorithms.
5. [Identity: OAuth 2.1, OIDC & JWT](identity/index.md) — who the caller is: tokens issued by `auth` and validated once, at the gateway.
6. [Protocols](protocols/index.md) — HTTP/1.1, HTTP/2, HTTP/3 and QUIC, TLS 1.3, WebSockets, SSE and gRPC.
7. [Quiz](quiz.md) — check your understanding.

## Slides

<div class="slides-embed">
  <iframe src="slides/edge.html" title="Slides: traffic and edge" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/edge.html){:target="_blank"}

---

## The request's journey { #the-request-journey }

A fan opens `https://boxoffice.com/events/stadium-show` and taps **"Choose seats"**. Before any Java code runs, the request crosses several components, each one with a precise job. Press play and follow it:

``` diagram-sim
sequenceDiagram
    participant F as Fan's phone
    participant D as DNS
    participant C as CDN edge
    participant W as WAF
    participant L as Load balancer
    participant G as API gateway
    participant I as Ingress
    participant S as inventory service
    F->>D: boxoffice.com? (A/AAAA)
    D-->>F: 203.0.113.10 (nearest edge, TTL 60 s)
    F->>C: GET /events/stadium-show (TLS)
    C-->>F: HTML, JS, images from the edge cache
    F->>C: GET /api/events/42/seats
    C->>W: cache miss: forward to origin
    W->>L: request passed the rules (not a bot)
    L->>G: pick a healthy gateway replica
    G->>I: token valid, under the rate limit
    I->>S: route /api/events/** to inventory
    S-->>F: seat map (JSON)
```

Read the diagram as a series of **decisions**, made as early (and as cheaply) as possible:

1. **DNS** decides *where* the client goes: which IP address, which region, which edge location.
2. The **CDN** (Content Delivery Network) decides whether the request needs to go further at all: if the response is cached at the edge, the journey ends here, a few milliseconds from the fan.
3. The **WAF** (Web Application Firewall) decides whether the request is *allowed*: malformed, malicious or abusive traffic is dropped here.
4. The **load balancer** decides *which replica* serves the request, and only sends it to healthy ones.
5. The **API gateway** decides whether the *caller* is allowed and within its quota: authentication, rate limits, routing to the right service.
6. The **ingress** (inside Kubernetes) decides which *Service* in the cluster receives the request, by host and path.

Each hop removes work from the next one. In a well-designed flash sale, the vast majority of requests end at the CDN (static assets, the event page, even a seat map cached for one second), many bots end at the WAF, and only a controlled, fair stream reaches `inventory`.

| Palette id | Component | Job | Layer | Typical products |
|---|---|---|---|---|
| `dns` | DNS | name → IP; geographic and health-based routing | application protocol over UDP/TCP 53 | Route 53, Cloud DNS, Azure DNS, Cloudflare DNS |
| `cdn` | CDN | cache content near users; absorb load and attacks | L7 (HTTP) | CloudFront, Cloud CDN, Azure Front Door, Cloudflare, Akamai, Fastly |
| `waf` | WAF | filter malicious or abusive HTTP requests | L7 | AWS WAF, Cloud Armor, Azure WAF, Cloudflare WAF, ModSecurity / Coraza |
| `lb` | Load Balancer | spread connections or requests over healthy replicas | L4 (TCP/UDP) or L7 (HTTP) | ALB/NLB, Cloud Load Balancing, Azure Load Balancer, Nginx, HAProxy, Envoy |
| `apigw` | API Gateway | single entry point for APIs: auth, rate limits, routing | L7 | API Gateway, Apigee, Azure API Management, Kong, Spring Cloud Gateway |
| `ingress` | Ingress | HTTP routing into a Kubernetes cluster | L7 | Gateway API implementations (Envoy Gateway, Istio, Cilium), Traefik, cloud ingress controllers |

!!! info "Layers, briefly"
    "L4" and "L7" refer to the OSI model: **layer 4** is the transport layer (TCP, UDP — connections, ports), **layer 7** is the application layer (HTTP — methods, paths, headers, cookies). A component that works at L4 sees *connections*; one that works at L7 sees *requests*. The difference matters for load balancing and is detailed in [Load Balancing](load-balancing/index.md).

Real deployments merge some of these boxes. Cloudflare or CloudFront combine DNS, CDN, WAF and DDoS protection in one product; an AWS Application Load Balancer can terminate TLS and route by path, doing part of the gateway's job; in Kubernetes the ingress controller often *is* the L7 load balancer. In an interview, draw the **responsibilities** as separate boxes first; then say which ones a single product covers.

---

## Reverse proxies { #reverse-proxies }

Almost every box on the edge is a **reverse proxy**: a server that receives requests on behalf of other servers, forwards them, and returns the answer as if it were its own. The client only knows the proxy's address; the backends stay hidden in a private network.

``` diagram-sim
flowchart LR
    c1([Fan 1]) --> rp["Reverse proxy<br/>boxoffice.com:443"]
    c2([Fan 2]) --> rp
    c3([Bot]) -.->|blocked| rp
    rp --> a1[gateway replica 1]
    rp --> a2[gateway replica 2]
    rp --> a3[gateway replica 3]
```

Because every request passes through it, a reverse proxy is the natural place to put **cross-cutting** concerns once instead of in every service:

| Concern | What the proxy does |
|---|---|
| TLS termination | decrypts HTTPS once, so services do not each manage certificates |
| Load balancing | spreads requests over replicas, skips unhealthy ones |
| Caching | serves repeated responses without touching the backend |
| Compression | gzip / Brotli responses for slow mobile networks |
| Security | hides internal topology, filters requests, enforces limits |
| Observability | one place to log every request and measure latency and errors |

The opposite, a **forward proxy**, sits in front of *clients* (a corporate proxy, for example). On the edge we only care about reverse proxies.

### Where TLS terminates { #tls-termination }

TLS (Transport Layer Security) encrypts the traffic between two endpoints. On the edge, there are three common choices of where the encrypted connection *ends*:

| Option | How it works | Pros | Cons |
|---|---|---|---|
| **Terminate at the edge** | CDN / LB decrypts; plain HTTP inside the private network | simple; the proxy can read headers and cache | traffic inside the network is readable by anyone who gets in |
| **Re-encrypt** (TLS bridging) | edge decrypts, inspects, opens a new TLS connection to the backend | inspection *and* encryption in transit | two handshakes, certificates on the backends |
| **Pass-through** | L4 LB forwards encrypted bytes; the service terminates TLS | end-to-end encryption | no L7 routing, caching or WAF at the LB |

Modern architectures follow a **zero-trust** posture: terminate public TLS at the edge, and encrypt again inside the cluster — often automatically, with mutual TLS (mTLS) from a service mesh (see [Network & Security](../network-security/index.md)).

??? question "Think first: can a CDN cache a page if TLS goes all the way to the service?"
    No. To cache a response, the CDN must read it, and to read it, it must hold the certificate and decrypt the traffic. With TLS pass-through, the CDN only sees encrypted bytes and can neither cache nor filter them. That is why CDNs and WAFs terminate TLS: you trust your edge provider with your certificate (or a certificate issued for it) in exchange for caching and filtering.

---

## A latency budget for the edge { #latency-budget }

Every hop adds time. Suppose BoxOffice wants the seat map API to answer in **under 200 ms at p99** for fans in Brazil. Where does the time go? The figures below are **illustrative assumptions** for a São Paulo user and a São Paulo region; the method matters more than the numbers.

| Step | Cold (first visit) | Warm (connection reused) |
|---|---|---|
| DNS lookup (resolver cache miss / hit) | 30 ms | 0 ms (cached) |
| TCP + TLS 1.3 handshake to the edge (2 RTT × 10 ms) | 20 ms | 0 ms (connection reused) |
| CDN edge → WAF → LB (same metro) | 5 ms | 5 ms |
| API gateway: JWT check + rate-limit lookup in Redis | 5 ms | 5 ms |
| Ingress → `inventory` → PostgreSQL | 40 ms | 40 ms |
| Response transfer (60 KB of JSON over mobile) | 30 ms | 30 ms |
| **Total** | **≈ 130 ms** | **≈ 80 ms** |

Three lessons come out of this kind of table:

- **Connection setup is expensive and avoidable.** DNS caching, keep-alive and TLS session resumption remove about a third of the cold cost. HTTP/3 removes even more ([Protocols](protocols/index.md)).
- **Distance dominates.** If the origin were in Virginia instead of São Paulo, each round trip would cost about 120 ms instead of 10 ms, and a cold request would pay several of them. This is why CDNs and edge locations exist.
- **The cheapest request is the one that never reaches the origin.** A cache hit at the edge answers in the time of one RTT to the nearest point of presence.

---

## Edge security: WAF, bots and DDoS { #edge-security }

On sale day, BoxOffice does not only receive fans. It receives **scalper bots** that try to grab the best seats in the first second, **credential-stuffing** scripts that test leaked passwords against `/login`, and possibly a **DDoS** (Distributed Denial of Service) attack from someone who wants the sale to fail. The edge is the first and cheapest place to stop all of them, because it sees all the traffic before it costs anything to the core.

### Web Application Firewall (WAF) { #waf }

A **WAF** inspects HTTP requests (L7) and blocks the ones that match rules. Rules come in three families:

- **Managed rule sets** that detect common attacks — SQL injection, cross-site scripting (XSS), path traversal, known vulnerable endpoints. The reference is the **OWASP Core Rule Set** (CRS), used by ModSecurity and Coraza and mirrored by the cloud WAFs[^2].
- **Reputation rules**: block or challenge IP addresses from known botnets, anonymising proxies, or data-centre ranges that real fans do not use.
- **Custom rules** for your application: "at most 5 `POST /login` per IP per minute", "only allow `PUT /holds` with a valid waiting-room token", "block requests without a `User-Agent`".

WAF rules start in **count** (log-only) mode, are tuned against real traffic to remove false positives, and only then switched to **block**. A WAF that blocks real fans during the sale is worse than no WAF.

### Bot mitigation { #bots }

Bots are not all bad (search engine crawlers, uptime monitors), and the bad ones increasingly look like humans. Mitigation combines several signals, cheapest first:

| Technique | How it works | Stops | Cost / risk |
|---|---|---|---|
| Rate limiting per IP / per account | cap requests per time window ([API Gateway](api-gateway/index.md)) | naive scripts | botnets spread over thousands of IPs |
| IP reputation and ASN rules | block known-bad IPs and hosting providers | cheap bot farms | residential proxies slip through |
| Fingerprinting | TLS fingerprint (e.g. JA3/JA4), header order, JavaScript-collected device signals | headless browsers, scripted clients | privacy concerns; arms race |
| Challenges | invisible JavaScript proof-of-work or CAPTCHA when the score is suspicious | most automated traffic | friction for real users |
| Behavioural analysis | mouse/touch patterns, navigation speed, purchase velocity | advanced bots | needs data and models |
| **Virtual waiting room** | admit users to the sale at a controlled rate, in random or arrival order | the "first second" advantage of bots | users wait; must be fair and transparent |
| Business rules | max 6 tickets per account, verified phone, identity checks | scalping at scale | product decision, not only technical |

The **waiting room** deserves a special mention for BoxOffice: when 2 million fans arrive for 60 thousand seats, letting all of them into the seat map at once guarantees an outage *and* rewards whoever is fastest — usually a bot. A waiting room at the edge hands each visitor a signed token with a position, and admits, say, 1 000 users per second to the purchase flow — the rate `inventory` sustains in the [estimation class](../estimation/index.md). The core sees a steady, sized load; the rest of the fans see a progress bar served from the CDN. You will model it with a queue in the [messaging class](../messaging/index.md) and the [ticketing case study](../case-studies/ticketing/index.md).

### DDoS { #ddos }

A **denial-of-service** attack tries to exhaust a resource — bandwidth, connections, CPU — so that legitimate users cannot be served. "Distributed" means it comes from many sources at once (a botnet), so blocking a single IP does not help[^3].

| Attack type | Layer | Example | Defence |
|---|---|---|---|
| **Volumetric** | L3/L4 | UDP floods, DNS/NTP amplification reaching hundreds of Gbit/s | absorb with capacity: **anycast** spreads the flood over hundreds of edge locations; upstream **scrubbing** centres filter it |
| **Protocol** | L4 | SYN floods that fill connection tables | SYN cookies, stateless L4 filtering at the edge |
| **Application** | L7 | many valid-looking `GET /search?q=…` requests that are expensive for the backend | WAF rules, rate limits, challenges, caching, autoscaling with limits |

The key idea is **asymmetry**: you cannot out-provision an attacker with your own servers, but a large CDN/DDoS provider has more edge capacity than any single attack. With **anycast**, the same IP address is announced from every edge location, so traffic from each bot goes to the nearest location and the flood is divided among all of them ([DNS & CDN](dns-cdn/index.md#anycast)). Volumetric attacks are therefore a problem you **buy** a solution for (AWS Shield, Cloud Armor, Azure DDoS Protection, Cloudflare)[^4]; L7 attacks are a problem you also have to **design** for — expensive endpoints must be cacheable, rate-limited or protected by a challenge.

!!! example "BoxOffice: 10:00, the sale opens"
    The edge configuration for the stadium sale, layer by layer:

    - **DNS**: `boxoffice.com` points to the CDN's anycast addresses; TTL 60 s so that the team can redirect traffic quickly if a region fails.
    - **CDN**: the event page, JavaScript and images are cached with long TTLs and fingerprinted file names; the seat-availability JSON is **micro-cached for 1 second** — 2 million fans polling every 5 s become, at most, one origin request per second per edge location.
    - **WAF**: OWASP managed rules on; a custom rule allows `POST /api/holds` only with a valid waiting-room token; `POST /login` limited per IP and per account.
    - **Bots**: JavaScript challenge on suspicious fingerprints; data-centre ASNs challenged before entering the queue.
    - **Waiting room**: admits a fixed number of users per minute, sized from the capacity of `inventory` and `payment` measured in the load tests.
    - **API gateway**: JWT validation and a token bucket of 10 requests/s per user with bursts of 20, and a limit of 6 seats per hold.

    The result: the core services see thousands of requests per second instead of millions, and they see them in the order the waiting room decided — not in the order the fastest bot decided.

**Try it.** Load the flash-sale scenario and press **Run**. The design as drawn has no CDN, gateway or waiting room — only `users → lb → app → inventory-db`, with buyers also calling the `payment provider` (500 req/s quota). When the sale opens (t = 60 s) the traffic jumps 20×: `app` saturates and errors and p99 explode; raise its replicas and the bottleneck only moves to `inventory-db` and the payment provider. Then open it in the full playground (↗) and follow the hints — a CDN in front, a cache for the catalog reads, and an API gateway that sends buyers to a waiting-room queue drained by `order` workers — or press **Show a possible solution**. Compare p99 latency, error rate and served req/s, and read the consumer lag: it is how long a buyer waits in the line.

<div class="sdp" data-scenario="flash-sale" data-mode="compact" data-height="520"></div>

[:material-open-in-new: Open the full playground](../../../playground/index.md)

## The edge concept map { #concept-map }

Each edge component answers one question and hands the request to the next. The map links each **palette component** (green) to the **concepts** it relies on (blue) and to the subpage or class that teaches them:

``` diagram
flowchart LR
    client["client · mobile"]:::comp --> dns["dns"]:::comp
    dns --> cdn["cdn"]:::comp
    cdn --> waf["waf"]:::comp
    waf --> lb["lb"]:::comp
    lb --> apigw["apigw"]:::comp
    apigw --> ingress["ingress"]:::comp
    ingress --> app["app services"]:::comp
    dns -.- c1["TTL, GeoDNS, anycast,<br/>DNS failover"]:::tech
    cdn -.- c2["cache keys, Cache-Control,<br/>hit ratio, micro-caching"]:::tech
    waf -.- c3["OWASP rules, bots,<br/>waiting room, DDoS"]:::tech
    lb -.- c4["L4/L7, algorithms,<br/>consistent hashing, health checks"]:::tech
    apigw -.- c5["auth offload, rate limiting,<br/>BFF"]:::tech
    ingress -.- c6["Ingress, Gateway API,<br/>service discovery"]:::tech
    c1 -.- d1["eventual consistency<br/>(class 3)"]
    c2 -.- d2["caching patterns<br/>(class 7)"]
    c4 -.- d3["stateless services,<br/>autoscaling (class 5)"]
    c5 -.- d4["identity, JWT<br/>(Identity, this class)"]
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

| Palette component | Question it answers | Concepts | Taught in | Scenarios |
|---|---|---|---|---|
| [`dns`](../../reference/components/edge/index.md#dns) | *Where* does the client go? | TTL, GeoDNS, latency routing, anycast, failover | [DNS & CDN](dns-cdn/index.md#dns) | `multi-region`, `cdn-static` |
| [`cdn`](../../reference/components/edge/index.md#cdn) | Does the request need to go further? | pull/push, cache key, `Cache-Control`, invalidation, edge compute | [DNS & CDN](dns-cdn/index.md#cdn) | `cdn-static`, `video-streaming` |
| [`waf`](../../reference/components/edge/index.md#waf) | Is the request *allowed*? | managed rules, bot scoring, challenges, waiting room, DDoS | [this overview](#edge-security) | `flash-sale` |
| [`lb`](../../reference/components/edge/index.md#lb) | *Which replica* serves it? | L4/L7, algorithms, consistent hashing, health checks, draining | [Load Balancing](load-balancing/index.md) | `scale-out` |
| [`apigw`](../../reference/components/edge/index.md#apigw) | Is the *caller* allowed, within quota? | JWT validation, rate limiting, routing, BFF, aggregation | [API Gateway](api-gateway/index.md) | `rate-limiter` |
| [`ingress`](../../reference/components/edge/index.md#ingress) | Which *Service* in the cluster? | Ingress, Gateway API, service discovery | [Load Balancing — Kubernetes](load-balancing/index.md#kubernetes) | `scale-out` |
| *(all of them)* | *How* do bytes travel? | HTTP/1.1, 2, 3/QUIC, TLS 1.3, WebSockets, SSE, gRPC | [Protocols](protocols/index.md) | `chat`, `video-streaming` |

!!! tip "In the interview"
    When you draw the high-level design, put the edge in **one line**: "client → DNS → CDN → load balancer → API gateway → services". Then spend words only where the problem needs them: a read-heavy system (news feed, catalogue) deserves a sentence on **CDN caching and hit ratio**; a public API deserves **rate limiting**; a flash sale or ticketing problem deserves **WAF, bots and a waiting room**. Always say *what each hop removes* from the core — that is the signal interviewers look for.

!!! success "Best practices"

    - **Expose one public door and nothing else** — replicas without published ports, internal endpoints unreachable from the internet. In BoxOffice: no `ports:` on the `catalog` replicas and `location / { return 404; }` in [lab 3](../../hands-on/3/index.md).
    - **Stamp a request id at the first hop and return it to the client** — support can then find one fan's request in every log. In BoxOffice: `X-Request-Id $request_id` in lab 3's `nginx.conf`.
    - **Keep the edge configuration in the repository and validate it before every reload** — `nginx -t` in CI; a typo at the edge is a total outage.
    - **Load-test through the edge, not around it** — the edge adds a hop and has limits of its own. In BoxOffice: lab 3 runs every sweep with `BASE_URL=http://localhost` ([Hands-on 3](../../hands-on/3/index.md#measure-it)).
    - **Prepare sale day as a runbook** — pre-scale the edge (ask the provider to pre-warm managed load balancers), run new WAF rules in count mode the week before, and know who switches the waiting room on.

!!! warning "Pitfalls"
    - **Treating the edge as a single box.** "We put a load balancer in front" does not answer "how do you survive 2 million users at 10:00?" Say what is cached, what is filtered and what is limited.
    - **Forgetting that every edge component can fail.** A load balancer, a gateway or a WAF in a single instance is a single point of failure. Managed edge services are replicated for you; self-hosted ones must run in pairs or clusters.
    - **Blocking real users.** Aggressive WAF and bot rules turned on without a "count mode" period produce false positives exactly when traffic is most valuable.
    - **Doing business logic at the edge.** Edge functions and gateways are for cross-cutting concerns. Pricing rules or seat allocation in a gateway plugin become an untestable, unversioned second application.

---

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - The **edge** is everything between the client and the first service: `dns`, `cdn`, `waf`, `lb`, `apigw`, `ingress`. Each hop makes a decision and should remove work from the next one.
    - Most edge components are **reverse proxies**, the natural place for TLS termination, load balancing, caching, security and observability.
    - Latency on the edge is dominated by **round trips and distance**; caching, connection reuse and modern protocols attack exactly that.
    - **WAF** rules filter malicious requests, **bot mitigation** combines rates, fingerprints, challenges and a **waiting room**, and **DDoS** defence relies on anycast capacity for volumetric attacks and on design (caching, limits) for L7 attacks.
    - In an interview, draw the edge quickly, then go deep only where the problem demands it — and say what each component **removes** from the core.

## What breaks next { #what-breaks-next }

The edge decides which replica serves each request, and the gateway checks the caller's token once for every service — but both assume something they cannot enforce: that **any** replica can serve **any** request. A replica that keeps the fan's session or a seat hold in its own memory loses it when it dies, or when the next request lands on another replica. Lab 3 shows the other limit: three `catalog` replicas behind Nginx multiply the cheap requests, but not the mixed workload, where PostgreSQL is the bottleneck (in a test run, `db` at ~670% CPU and each replica at ~20%). What a replica must be (stateless), how services are cut, and the gateway that lab 4 builds with `auth` behind this edge are [class 5 — Compute & Services](../compute/index.md).

## Related

- [Hands-on 3 — Edge](../../hands-on/3/index.md): Nginx reverse proxy and load balancer over 3 replicas, health checks and rate limiting, measured with k6.
- [Hands-on 4 — Gateway & identity](../../hands-on/4/index.md): Spring Cloud Gateway with JWT validation.
- [Exercise — Playground design](../../exercises/playground-design/index.md): solve playground challenges with SLO and cost goals.
- Case studies: [Rate limiter](../case-studies/rate-limiter/index.md) and [Ticketing (BoxOffice flash sale)](../case-studies/ticketing/index.md).
- [System Design Playground](../../../playground/index.md) and the [component catalog — Traffic & Edge](../../reference/components/edge/index.md).
- [Interview preparation](../../support/interview/index.md).
- Previous class: [Distributed Systems](../distributed/index.md). Next class: [Compute & Services](../compute/index.md). The edge comes back in [Caching](../caching/index.md), [Reliability](../reliability/index.md) and [Network & Security](../network-security/index.md).

---

[^1]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1, ch. 1 "Scale from zero to millions of users". Byte Code LLC, 2020.
[^2]: OWASP. [OWASP Core Rule Set](https://coreruleset.org/){target="_blank"}.
[^3]: CLOUDFLARE. [What is a DDoS attack?](https://www.cloudflare.com/learning/ddos/what-is-a-ddos-attack/){target="_blank"} — Cloudflare Learning Center.
[^4]: AWS. [AWS Best Practices for DDoS Resiliency](https://docs.aws.amazon.com/whitepapers/latest/aws-best-practices-ddos-resiliency/welcome.html){target="_blank"}. AWS Whitepaper.
