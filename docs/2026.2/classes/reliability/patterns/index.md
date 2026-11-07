
When a downstream service degrades or fails, the naive default — keep sending requests and wait for a response — reliably produces cascading failures. The calling service's threads block, its queue fills, and the failure propagates upstream to clients who had nothing to do with the broken dependency.

Resilience patterns are design decisions that interrupt this propagation. They do not prevent failures; they **limit how far a failure travels** through the system[^1].

``` mermaid-sim
flowchart LR
    client --> gateway
    gateway -->|"timeout<br/>circuit breaker<br/>bulkhead"| downstream["downstream<br/>(slow)"]
    gateway -->|"fast failure<br/>or fallback"| client
```

The patterns below are complementary — production systems use them in combination, not in isolation. Throughout the page we use one running example from the store: the **order service** calls the **product service** (through an OpenFeign client, as in [Hands-on 1](../../../hands-on/1/index.md)) to check prices before saving an order.

| Pattern | Question it answers | Protects against |
|---|---|---|
| [Timeout](#timeout) | How long am I willing to wait? | Hanging calls |
| [Retry](#retry-with-exponential-backoff) | Is it worth trying again? | Transient failures |
| [Circuit breaker](#circuit-breaker) | Should I even try? | A dependency that is known to be down |
| [Fallback](#fallback-and-graceful-degradation) | What do I answer instead? | Total loss of a feature |
| [Bulkhead](#bulkhead) | How much of my capacity can one dependency take? | Resource exhaustion spreading |
| [Rate limiting](#rate-limiting) | How much traffic do I accept? | Spikes and abusive clients |
| [Health checks](#health-checks) | Should traffic reach this instance? | Routing to broken instances |

---

## Timeout

A **timeout** is a deadline applied to an outbound call. If the downstream service does not respond within the deadline, the call is abandoned and an error is returned to the caller immediately.

Without a timeout, a single hanging dependency can hold threads indefinitely. With a timeout, the maximum damage any single slow call can do is bounded.

``` mermaid-sim
sequenceDiagram
    participant C as Client
    participant G as Gateway
    participant P as Payment Service

    C->>+G: POST /checkout
    G->>+P: POST /charge
    Note over P: processing...
    Note over G: deadline exceeded (500 ms)
    G-->>-C: 504 Gateway Timeout
    P-->>-G: (response arrives late — discarded)
```

### Choosing timeout values

- **Percentile-based**: set the timeout at the P99.9 latency of the downstream service under normal conditions. Anything slower than that is already abnormal.
- **Budget-aware**: if the upstream call has its own timeout of 1 s, all downstream calls within that request — retries and their waits included — must complete well under 1 s combined.
- **Distinct per dependency**: a database query, a third-party API, and an internal microservice have very different latency profiles. A single global timeout value is almost always wrong.

There are usually two timeouts on an HTTP call: the **connect timeout** (how long to wait to open the TCP connection) and the **read timeout** (how long to wait for the response once connected). Configure both.

!!! example "Timeouts on the store's Feign client"

    ```yaml
    # order-service application.yaml (Spring Cloud OpenFeign)
    spring:
      cloud:
        openfeign:
          client:
            config:
              product:              # the @FeignClient name
                connect-timeout: 500    # ms
                read-timeout: 1000      # ms
    ```

    If the product service takes more than one second, the order service gets an exception instead of a blocked thread, and can decide what to do next.

### The timeout budget across hops

Timeouts nest: each hop must finish inside the deadline of the hop that called it. Suppose the gateway waits at most **3 s** for the order service, and the order service calls product with the settings of this page: read timeout 1 s, 3 attempts, waits of 0.5 s and 1 s. In the worst case the order service needs 1 + 0.5 + 1 + 1 + 1 = **4.5 s** — longer than anyone waits for it.

``` mermaid-sim
sequenceDiagram
    participant C as Client
    participant G as Gateway (waits 3 s)
    participant O as Order service
    participant P as Product service (slow)
    C->>G: POST /orders
    G->>O: POST /orders
    O->>P: attempt 1
    Note over O: read timeout at 1 s, then wait 0.5 s
    O->>P: attempt 2
    Note over O: read timeout at 2.5 s, then wait 1 s
    Note over G: 3 s gone: gives up
    G-->>C: 504 Gateway Timeout
    O->>P: attempt 3 (nobody waits for it)
    Note over O: fails at 4.5 s: wasted work and load
```

Fit the inner budget inside the outer one: 2 attempts (1 + 0.5 + 1 = 2.5 s), a shorter read timeout, or a deadline passed along with the request so each hop knows how much time is left (gRPC does this with deadlines).

!!! warning "Timeouts are only the first step"
    A timeout on its own just converts a hang into a fast error. Combine it with a retry policy (below) for transient failures, and with a circuit breaker and a fallback for longer outages.

---

## Retry with Exponential Backoff

A **retry** re-attempts a failed request after a waiting period. Retries are appropriate for **transient failures** — brief network blips, momentary service restarts, or transient resource exhaustion — where the same request is likely to succeed on a subsequent attempt.

``` mermaid-sim
sequenceDiagram
    participant C as Client
    participant S as Service

    C->>+S: Request (attempt 1)
    S-->>-C: 503 Service Unavailable
    Note over C: wait 1 s
    C->>+S: Request (attempt 2)
    S-->>-C: 503 Service Unavailable
    Note over C: wait 2 s
    C->>+S: Request (attempt 3)
    S-->>-C: 200 OK ✓
```

### Exponential backoff

Retrying immediately on failure is dangerous: if many clients all retry simultaneously after a service restart, the resulting spike can overwhelm the recovering service — a *thundering herd*. Exponential backoff spaces retries out:

$$
\text{wait}_n = \min\left(c \cdot 2^n,\ \text{max\_wait}\right)
$$

where $n$ counts the retries from 0 (the wait before the first retry is $c$):

| Before retry | Formula | Wait (c = 1 s, max_wait = 16 s) | Time since the first failure |
|---|---|---|---|
| 1st ($n$ = 0) | $1 \cdot 2^0$ | 1 s | 1 s |
| 2nd ($n$ = 1) | $1 \cdot 2^1$ | 2 s | 3 s |
| 3rd ($n$ = 2) | $1 \cdot 2^2$ | 4 s | 7 s |
| 4th ($n$ = 3) | $1 \cdot 2^3$ | 8 s | 15 s |
| 5th ($n$ = 4) | $1 \cdot 2^4$ | 16 s (reaches `max_wait`) | 31 s |
| 6th and later | capped | 16 s | +16 s each |

### Jitter

Even with exponential backoff, clients that all failed at the same moment will retry at the same moments — a synchronised wave of retries. Adding a random **jitter** breaks this synchronisation:

$$
\text{wait}_n = \min\left(c \cdot 2^n,\ \text{max\_wait}\right) + \text{random}(0,\ \text{jitter\_cap})
$$

Marc Brooker's analysis at AWS[^2] compared several variants and recommends **full jitter**, which randomises the *entire* wait instead of adding a small random amount:

$$
\text{wait}_n = \text{random}\left(0,\ \min\left(c \cdot 2^n,\ \text{max\_wait}\right)\right)
$$

With 1,000 clients failing at the same instant, full jitter spreads their retries uniformly over the interval instead of sending 1,000 requests at exactly t = 1 s, 3 s and 7 s. (Brooker found full jitter and "decorrelated" jitter both far better than none; full jitter is the simplest.)

``` mermaid-sim
sequenceDiagram
    participant C as 1,000 clients
    participant S as Product service (just restarted)
    Note over C,S: backoff without jitter
    C->>S: t = 0 s: 1,000 requests fail together
    C->>S: t = 1 s: 1,000 retries in the same millisecond
    S-->>C: overloaded again: 503 for most
    C->>S: t = 3 s: the same wave, again
    Note over C,S: backoff with full jitter
    C->>S: retries spread over 0 to 1 s: about 1 per millisecond
    S-->>C: a steady load it can absorb: 200 OK
```

### What to retry — and what not to

| Response | Retry? | Why |
|---|---|---|
| Connection refused, connection reset, timeout | Yes | Typical transient failure |
| `503 Service Unavailable`, `429 Too Many Requests` | Yes, with backoff (respect `Retry-After` if present) | The server is asking you to come back later |
| `500 Internal Server Error` | Maybe, once | Often a bug that will fail again |
| `400`, `401`, `403`, `404`, `422` | No | The request itself is wrong; retrying cannot fix it |

!!! warning "Retry amplification"
    Retries multiply load exactly when the system is weakest. If the gateway, the order service and the product client each make up to 3 attempts, one user click can become 3 × 3 × 3 = **27** calls to a struggling product service. Retry at **one** layer only (usually the one closest to the failing dependency), cap the number of attempts, and stop retrying when the circuit breaker is open.

``` mermaid-sim
flowchart LR
    U["1 click"] --> G["gateway<br/>3 attempts"]
    G -->|"3 calls"| O["order service<br/>3 attempts each"]
    O -->|"9 calls"| F["Feign client<br/>3 attempts each"]
    F -->|"27 calls"| P["product service<br/>(already struggling)"]
```

!!! danger "Do not retry non-idempotent operations"
    Retrying a `POST /orders` that creates a new order may create duplicates. Only retry operations that are **idempotent** (`GET`, `PUT`, `DELETE`) or that are explicitly designed for retry safety (idempotency keys, deduplication tokens).

An operation is **idempotent** when doing it twice has the same effect as doing it once. The common way to make a `POST` safe to retry is an **idempotency key**: the client generates a unique ID (e.g. a UUID) per logical operation and sends it in a header; the server stores the keys it has already processed and, on a repeated key, returns the stored result instead of creating a second order.

``` mermaid-sim
sequenceDiagram
    participant C as Client
    participant O as Order service
    participant DB as Postgres
    C->>O: POST /orders (Idempotency-Key: k-42)
    O->>DB: key k-42 seen? no → insert order + key
    O--xC: 201 Created (response lost)
    C->>O: retry POST /orders (Idempotency-Key: k-42)
    O->>DB: key k-42 seen? yes
    O-->>C: 201 Created (same order, no duplicate)
```

---

## Circuit Breaker

The circuit breaker[^3] is named by analogy with the electrical component: when the current load exceeds safe limits, the breaker trips and interrupts the circuit. In software, when the failure rate of the calls to a downstream service reaches a threshold, the circuit breaker *opens* and immediately rejects calls to that service — without attempting the network call at all.

This prevents the calling service from wasting threads and connections on a dependency that is known to be unavailable.

``` mermaid-sim
stateDiagram-v2
    [*] --> Closed
    Closed --> Open : 50% or more of the last 10 calls failed or were slow
    Open --> HalfOpen : 30 s in Open, then the next call
    HalfOpen --> Closed : the 3 probe calls stay below the thresholds
    HalfOpen --> Open : the probes fail or are slow again
```

**Closed** (normal operation)
: Requests pass through. The breaker records the outcome of the last calls (a sliding window). Once enough calls are recorded, if the share that failed — or that were slower than a threshold — reaches the configured rate, the breaker trips to Open.

**Open** (failing fast)
: All requests are rejected immediately with an error (`CallNotPermittedException` in Resilience4j) — no network call is made. This protects the caller's resources and gives the downstream service time to recover. After the configured wait duration, the breaker moves to Half-Open.

**Half-Open** (testing recovery)
: A limited number of probe calls are allowed through; any other call is still rejected. When the probes are done, the breaker computes their failure and slow-call rates: below the thresholds, the dependency has recovered and the breaker closes; otherwise it returns to Open for another wait.

The sequence below plays one cycle with the configuration of the example further down:

``` mermaid-sim
sequenceDiagram
    participant O as Order service
    participant B as Breaker (product)
    participant P as Product service
    Note over B: Closed
    O->>B: findProduct
    B->>P: GET /products/42
    P--xB: no answer: read timeout after 1 s
    Note over B: 5 of the last 10 calls failed: Open
    O->>B: findProduct
    B-->>O: CallNotPermittedException in under 1 ms
    Note over B: 30 s later, the next call: Half-Open
    O->>B: findProduct (probe 1 of 3)
    B->>P: GET /products/42
    P-->>B: 200 OK in 50 ms
    Note over B: 3 probes fast and OK: Closed
```

### Configuration knobs

| Parameter (Resilience4j property) | Default | Typical value | Effect |
|---|---|---|---|
| **Failure threshold** (`failure-rate-threshold`) | 50% | 50% | Share of failed calls in the window that opens the breaker |
| **Window** (`sliding-window-size`, `minimum-number-of-calls`) | 100 calls, 100 | 10–20 calls | How many recent calls are judged; no decision before the minimum |
| **Slow calls** (`slow-call-duration-threshold`, `slow-call-rate-threshold`) | 60 s, 100% | below the timeout, 50% | Slow calls open the breaker too, before they time out |
| **Wait in Open** (`wait-duration-in-open-state`) | 60 s | 10–60 s | How long the dependency gets to recover |
| **Half-Open probes** (`permitted-number-of-calls-in-half-open-state`) | 10 | 3–5 | How cautiously to test recovery |

The defaults are conservative: with a window of 100 calls, the breaker of a service that receives 1 call per second needs well over a minute to decide. Slow calls are judged by their own rate — with the default 100%, they open the breaker only when *every* call in the window is slow.

**Spring Boot**: the [Resilience4j](https://resilience4j.readme.io/docs/circuitbreaker){target="_blank"} library[^4] implements all of these patterns with `@CircuitBreaker`, `@Retry`, `@Bulkhead`, `@RateLimiter` and `@TimeLimiter` annotations. With Spring Boot 4 (the version of the hands-on), the dependencies are `io.github.resilience4j:resilience4j-spring-boot4` and `spring-boot-starter-aspectj`; with Spring Boot 3 they were `resilience4j-spring-boot3` and `spring-boot-starter-aop`.

!!! example "Circuit breaker and retry around the product call"

    === "OrderService.java"

        ```java
        // Resilience4j's default order: Retry ( CircuitBreaker ( call ) ).
        // The fallback sits on the OUTERMOST layer, so it runs once: after
        // the retries are exhausted, or at once when the breaker is open.
        @Retry(name = "product", fallbackMethod = "priceFallback")
        @CircuitBreaker(name = "product")
        public ProductOut findProduct(String id) {
            return productController.findById(id).getBody();   // Feign call
        }

        // Same signature + the exception.
        private ProductOut priceFallback(String id, Throwable t) {
            throw new ResponseStatusException(
                HttpStatus.SERVICE_UNAVAILABLE, "catalogue unavailable, try again later");
        }
        ```

    === "application.yaml"

        ```yaml
        resilience4j:
          circuitbreaker:
            instances:
              product:
                sliding-window-size: 10                  # the last 10 calls
                minimum-number-of-calls: 10              # judge only after 10 calls
                failure-rate-threshold: 50               # >= 50% failed → Open
                slow-call-duration-threshold: 500ms      # slower than this = slow (below the 1 s timeout)
                slow-call-rate-threshold: 50             # >= 50% slow → Open
                wait-duration-in-open-state: 30s         # Open → Half-Open
                permitted-number-of-calls-in-half-open-state: 3
          retry:
            instances:
              product:
                max-attempts: 3                          # 1 call + 2 retries
                wait-duration: 500ms
                enable-exponential-backoff: true
                exponential-backoff-multiplier: 2        # 500 ms, then 1 s
                enable-randomized-wait: true
                randomized-wait-factor: 0.5              # each wait ± 50% (jitter)
                retry-exceptions:
                  - feign.RetryableException             # timeouts and connection errors
                  - feign.FeignException$ServiceUnavailable   # 503
                ignore-exceptions:
                  - io.github.resilience4j.circuitbreaker.CallNotPermittedException  # breaker open: fail fast
        ```

    The breaker's state is exported as a metric (`resilience4j_circuitbreaker_state`) through Actuator, so you can graph it in Grafana ([Hands-on 6](../../../hands-on/6/index.md)).

Three details of this configuration matter. The slow-call threshold (500 ms) is **below** the read timeout (1 s): a call slower than the timeout never completes, so a threshold above it would never see a slow call. The retry lists the exceptions worth retrying and **ignores** `CallNotPermittedException`: when the breaker is open there is nothing to wait for. And the fallback is on `@Retry`, the outer annotation: placed on `@CircuitBreaker`, it would run *inside* the retry and turn every failure into the fallback's exception before the retry sees it — so the retry would either retry the fallback (if it retried everything) or never retry at all.

### Play it: a slow product service

The simulator puts the order service of the [overview](../index.md#cascading-failures) — 200 threads, 60 orders per second — in front of a product service that degrades for one minute, and lets you switch on the timeout, the retry and the breaker of the configuration above.

<div class="csim" data-sim="slow-dependency" data-fault="slow" data-latency="3000"></div>

!!! tip "Try it"
    With no pattern, the 3-second calls keep about **176** threads busy (Little's law: 60 × 3 s = 180) and the pool hits its 200 threads in **8** of the 60 seconds: only **98.4%** of `GET /orders` succeed, although they never call product. Switch on the **timeout**: about **60** threads (60 × 1 s) and `GET /orders` back to **100%** — but every order now fails after 1 s. Add the **retry**: each order holds its thread for up to 4.5 s, the pool is full during **51** seconds, only **71.2%** of `GET /orders` succeed and product receives **128** calls per second instead of 60 — worse than no pattern at all. Add the **breaker**: it opens **1.1 s** after the fault begins, orders fail in under a millisecond, about **2** threads stay busy, the probes at 41 s fail and the breaker closes at t = **72.2 s**, 2.2 s after product recovers. Then pick **product down**: with timeout and retry but no breaker, product receives **3.0** calls per order while it refuses them all.

---

## Fallback and graceful degradation

Failing fast is better than hanging, but an error is still an error. A **fallback** is what the caller does *instead* when a call fails or the breaker is open. The goal is **graceful degradation**: lose a feature, not the whole page.

| Dependency down | Possible fallback in the store |
|---|---|
| Recommendation service | Show the "best sellers" list cached in Redis ([Hands-on 8](../../../hands-on/8/index.md)) |
| Product service, for reads | Serve the last cached product data, marked as possibly stale |
| Notification service | Publish the e-mail request to Kafka and send it later ([Event-Driven Architecture](../../event_driven/index.md)) |
| Payment service | No safe fallback: answer `503` quickly with a clear message — never pretend the payment succeeded |

!!! warning "A fallback must be safe and simple"
    A fallback that calls another remote service can fail too (and needs its own protection). And some operations — charging a card, reserving stock — must **not** be faked: failing clearly is the correct degraded behaviour.

---

## Bulkhead

The bulkhead pattern — named after watertight compartments in a ship hull — **isolates resources by dependency**. Rather than sharing a single thread pool across all downstream calls, each dependency gets its own pool.

``` mermaid-sim
flowchart TD
    gateway --> poolA["Bulkhead A<br/>(max 10 concurrent calls)"]
    gateway --> poolB["Bulkhead B<br/>(max 10 concurrent calls)"]
    poolA --> payment["Payment Service<br/>(degraded ⚠️)"]
    poolB --> inventory["Inventory Service<br/>(healthy ✅)"]
```

If Payment Service degrades and fills all 10 slots of Bulkhead A, Bulkhead B is completely unaffected. Inventory Service continues to handle requests at full speed. Without bulkheads, a single slow dependency saturates the shared pool and degrades all other calls equally. Step by step, with the order service's 200 threads:

``` mermaid-sim
sequenceDiagram
    participant O as Order service (200 threads)
    participant A as Bulkhead payment (10)
    participant P as Payment (slow)
    participant I as Inventory
    O->>A: charge (calls 1 to 10)
    A->>P: 10 calls waiting 3 s each
    O->>A: charge (call 11)
    A-->>O: BulkheadFullException at once, fallback 503
    O->>I: reserve stock (its own bulkhead has room)
    I-->>O: 200 OK in 30 ms
    Note over O,I: payment holds at most 10 threads, the other 190 keep working
```

The cost of bulkheads is **capacity that cannot be shared**: with ten pools of 10, a burst on one dependency is refused at 10 concurrent calls even while the other 90 slots sit idle, whereas one pool of 100 would have absorbed it. Sizing each bulkhead is the work (Little's law again: calls per second × normal latency, plus a margin). The trade-off is almost always worth it for critical-path dependencies.

Resilience4j offers two kinds of bulkhead: a **semaphore** bulkhead (`max-concurrent-calls`, default 25, limits how many threads may be inside the call at once — cheap, the default; `max-wait-duration: 0` rejects at once when full) and a **thread-pool** bulkhead (the call runs in a dedicated pool). The same idea applies outside the JVM: separate database connection pools per workload, or separate Kubernetes deployments for critical and non-critical traffic.

---

## Rate Limiting

Rate limiting caps the number of requests a client (or the system) can make within a time window, protecting services from traffic spikes and abusive clients.

### Token bucket algorithm

The **token bucket** is the most common rate limiting algorithm. It models a bucket that fills at a constant rate with tokens; each request consumes one token; requests that arrive when the bucket is empty are rejected or queued.

``` mermaid-sim
flowchart LR
    refill["Token source<br/>(refill rate: 100 req/s)"] -->|adds tokens| bucket["Token Bucket<br/>(capacity: 200)"]
    request["Incoming<br/>Request"] -->|consumes 1 token| bucket
    bucket -->|tokens available| allowed["✅ Allowed"]
    bucket -->|bucket empty| rejected["❌ 429 Too Many Requests"]
```

| Property | Effect |
|---|---|
| **Refill rate** | Steady-state maximum throughput |
| **Bucket capacity (burst)** | How much instantaneous traffic above the rate is tolerated |

A bucket capacity larger than the refill rate allows short bursts while still enforcing a long-term average. Spring Cloud Gateway's `RequestRateLimiter` filter (backed by Redis) and AWS API Gateway use a token bucket. Nginx `limit_req` uses the closely related **leaky bucket**: requests drain at a fixed rate and the `burst` parameter sets how many may wait in the queue.

!!! example "Rate limiting at the store's edge (Nginx)"

    ```nginx
    # 10 requests/s per client IP; up to 20 extra requests of a burst are
    # served at once (nodelay) and their slots free up at 10/s; beyond that, 429
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

    server {
        location / {
            limit_req zone=api burst=20 nodelay;
            limit_req_status 429;
            proxy_pass http://gateway;
        }
    }
    ```

    This fits in front of the gateway replicas of [Hands-on 7](../../../hands-on/7/index.md). Rate limits per **user** or per **API key** (rather than per IP) are usually applied in the gateway, where the authenticated identity is known.

---

## Health Checks

Health check endpoints allow orchestrators (Kubernetes, Docker Compose, load balancers) to detect failed instances and stop routing traffic to them before clients notice.

Two distinct types serve different purposes:

**Liveness**
: *Is the process alive?* Returns `200 OK` if the application is running and not deadlocked. If a liveness check fails, the orchestrator **restarts** the container.

**Readiness**
: *Is the service ready to serve traffic?* Returns `200 OK` only if the instance has finished starting and can do useful work (e.g. its own database is reachable). If a readiness check fails, the orchestrator **removes the instance from the load balancer pool** without restarting it.

**Startup** (Kubernetes)
: *Has the application finished starting?* Liveness and readiness checks are not run until it succeeds, so a slow-starting JVM is not killed during boot.

The sequence plays a 10-second database blip on a pod whose readiness includes the database and whose liveness does not:

``` mermaid-sim
sequenceDiagram
    participant K as Kubernetes
    participant P as order pod
    participant D as Postgres
    Note over D: blip: unreachable for 10 s
    K->>P: GET /actuator/health/readiness
    P-->>K: 503 DOWN (db)
    Note over K: removes the pod from the Service, no restart
    K->>P: GET /actuator/health/liveness
    P-->>K: 200 UP (the process is fine)
    Note over D: reachable again
    K->>P: GET /actuator/health/readiness
    P-->>K: 200 UP
    Note over K: the pod receives traffic again
```

Spring Boot Actuator exposes both at `/actuator/health/liveness` and `/actuator/health/readiness`. In Spring Boot 4 (the hands-on's version) these probe groups are enabled by default, in any environment; in Spring Boot 2.3 to 3.x they were automatic only on Kubernetes, and elsewhere (e.g. Docker Compose) you set `management.endpoint.health.probes.enabled=true`. By default they reflect only the application's internal state; add a dependency to readiness explicitly, e.g. `management.endpoint.health.group.readiness.include=readinessState,db`.

!!! example "Probes for the order service on Kubernetes"

    ```yaml
    # inside the container spec of the Deployment
    startupProbe:
      httpGet: { path: /actuator/health/liveness, port: 8080 }
      failureThreshold: 30        # up to 30 × 5 s = 150 s to start
      periodSeconds: 5
    livenessProbe:
      httpGet: { path: /actuator/health/liveness, port: 8080 }
      periodSeconds: 10
    readinessProbe:
      httpGet: { path: /actuator/health/readiness, port: 8080 }
      periodSeconds: 5
    ```

    See [Hands-on 5](../../../hands-on/5/index.md) for the Deployments these probes belong to.

!!! danger "Never put external dependencies in the liveness check"
    If liveness checks the database and the database blips, Kubernetes **restarts every replica at the same time** — turning a 10-second database hiccup into a full outage while all JVMs boot again. Liveness should answer only "is this process stuck?". Be careful even with readiness: if every replica depends on the same database, they all become unready together and the service disappears instead of returning clear errors.

---

## Defence in depth

These patterns are layered, not chosen in isolation. A production-grade call chain combines all of them:

``` mermaid-sim
flowchart LR
    client --> rl["Rate limiter<br/>at the edge (Nginx, gateway)"]
    rl --> retry
    subgraph order["order service, around each call to product"]
        retry["Retry + backoff<br/>(outermost)"] --> cb["Circuit breaker<br/>(counts every attempt)"]
        cb --> bh["Bulkhead<br/>(caps the threads on product)"]
        bh --> to["Timeout<br/>(bounds each attempt)"]
    end
    to --> downstream["product service"]
```

Each layer handles a different failure scenario:

| Layer, outermost first | What it handles | Why in this position |
|---|---|---|
| Rate limiter (inbound) | Traffic spikes, abusive clients | Refuses excess work before it costs anything |
| Retry + backoff | Transient errors | Outside the breaker: an open breaker stops the retries at once |
| Circuit breaker | Known-failing dependencies | Sees every attempt, timeouts included, as a call to judge |
| Bulkhead | Slow dependencies bleeding into other calls | Caps the threads that the attempts can hold |
| Timeout | Unbounded waiting | Innermost: bounds each attempt, not the sum |

!!! info "The order is a design decision"
    This is the order of Resilience4j's Spring Boot integration, whose default aspect order is `Retry ( CircuitBreaker ( RateLimiter ( TimeLimiter ( Bulkhead ( call ) ) ) ) )` (the Feign read timeout plays the time limiter's role here, inside the call). Microsoft's standard resilience handler for .NET's `HttpClient` stacks the same way: rate limiter → total timeout → retry → circuit breaker → attempt timeout[^5]. Whatever the library, check that retries do not bypass the breaker and that attempts × timeout + waits fit in the caller's own deadline ([the timeout budget](#the-timeout-budget-across-hops)).

---

## Connections

- [Hands-on 1](../../../hands-on/1/index.md) — the Feign clients that need timeouts and breakers.
- [Hands-on 7](../../../hands-on/7/index.md) — Nginx in front of the gateway, where edge rate limiting lives.
- [Hands-on 10](../../../hands-on/10/index.md) — retries and dead letter queues for asynchronous consumers.
- [SLI / SLO / SLA](../sli-slo-sla/index.md) — the budget these patterns protect.

## Key takeaways

- Every remote call needs a **timeout** (connect + read), chosen per dependency and inside the caller's budget — attempts × timeout + waits included.
- **Retry** only transient failures and idempotent operations, with **exponential backoff and full jitter**, at one layer only; use **idempotency keys** to make `POST` safe.
- A **circuit breaker** (Closed → Open → Half-Open) fails fast on a dependency known to be down or slow — set its slow-call threshold below the timeout; pair it with a safe **fallback** on the outermost layer.
- A timeout plus a retry **without** a breaker can be worse than nothing: each call holds its thread for every attempt and wait, and the dependency receives several times the load.
- **Bulkheads** keep one slow dependency from consuming all threads or connections; **rate limiting** (token / leaky bucket) protects the service from excess traffic.
- **Liveness** restarts, **readiness** removes from the load balancer; never check external dependencies in liveness.
- The patterns are layered; their order and combined timeouts must be designed, then verified with [chaos experiments](../chaos/index.md).

---

[^1]: NYGARD, M. *Release It! Design and Deploy Production-Ready Software*, 2nd ed. Pragmatic Programmers, 2018.
[^2]: BROOKER, M. [Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/){target="_blank"}. AWS Architecture Blog, 2015.
[^3]: FOWLER, M. [CircuitBreaker](https://martinfowler.com/bliki/CircuitBreaker.html){target="_blank"}. martinfowler.com, 2014.
[^4]: [Resilience4j Documentation](https://resilience4j.readme.io/docs){target="_blank"}.
[^5]: MICROSOFT. [Build resilient HTTP apps: key development patterns](https://learn.microsoft.com/en-us/dotnet/core/resilience/http-resilience){target="_blank"}. Microsoft Learn (standard resilience handler defaults).
