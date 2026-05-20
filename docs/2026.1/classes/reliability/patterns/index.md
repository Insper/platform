
When a downstream service degrades or fails, the naive default — keep sending requests and wait for a response — reliably produces cascading failures. The calling service's threads block, its queue fills, and the failure propagates upstream to clients who had nothing to do with the broken dependency.

Resilience patterns are design decisions that interrupt this propagation. They do not prevent failures; they **limit how far a failure travels** through the system[^1].

``` mermaid
flowchart LR
    client --> gateway
    gateway -->|"Timeout\nCircuit Breaker\nBulkhead"| downstream:::slow
    gateway -->|"fast failure\nor fallback"| client:::ok

    classDef slow fill:#f90,color:#000
    classDef ok fill:#6c6,color:#fff
```

The patterns below are complementary — production systems use them in combination, not in isolation.

---

## Timeout

A **timeout** is a deadline applied to an outbound call. If the downstream service does not respond within the deadline, the call is abandoned and an error is returned to the caller immediately.

Without a timeout, a single hanging dependency can hold threads indefinitely. With a timeout, the maximum damage any single slow call can do is bounded.

``` mermaid
sequenceDiagram
    participant C as Client
    participant G as Gateway
    participant P as Payment Service

    C->>+G: POST /checkout
    G->>+P: POST /charge
    Note over P: processing...
    Note over G: deadline exceeded (500 ms)
    G-->>-C: 503 Service Unavailable
    P-->>-G: (response arrives late — discarded)
```

### Choosing timeout values

- **Percentile-based**: set the timeout at the P99.9 latency of the downstream service under normal conditions. Anything slower than that is already abnormal.
- **Budget-aware**: if the upstream call has its own timeout of 1 s, all downstream calls within that request must complete well under 1 s combined.
- **Distinct per dependency**: a database query, a third-party API, and an internal microservice have very different latency profiles. A single global timeout value is almost always wrong.

!!! warning "Timeouts without retries are incomplete"
    A timeout that is never retried just converts a hang into a fast error. Combine timeouts with a retry policy (below) to handle transient failures transparently.

---

## Retry with Exponential Backoff

A **retry** re-attempts a failed request after a waiting period. Retries are appropriate for **transient failures** — brief network blips, momentary service restarts, or transient resource exhaustion — where the same request is likely to succeed on a subsequent attempt.

``` mermaid
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

| Attempt | Formula | Wait (c = 1 s) |
|---|---|---|
| 1 | $1 \cdot 2^0$ | 1 s |
| 2 | $1 \cdot 2^1$ | 2 s |
| 3 | $1 \cdot 2^2$ | 4 s |
| 4 | $1 \cdot 2^3$ | 8 s |
| 5 | capped at max | 16 s (if max = 16 s) |

### Jitter

Even with exponential backoff, clients that all failed at the same moment will retry at the same moments — a synchronised wave of retries. Adding a random **jitter** breaks this synchronisation:

$$
\text{wait}_n = \min\left(c \cdot 2^n,\ \text{max\_wait}\right) + \text{random}(0,\ \text{jitter\_cap})
$$

AWS recommends *full jitter* (randomising the entire wait, not just a fraction)[^2] as the most effective strategy for large client populations.

!!! danger "Do not retry non-idempotent operations"
    Retrying a `POST /orders` that creates a new order may create duplicates. Only retry operations that are **idempotent** (`GET`, `PUT`, `DELETE`) or that are explicitly designed for retry safety (idempotency keys, deduplication tokens).

---

## Circuit Breaker

The circuit breaker[^3] is named by analogy with the electrical component: when the current load exceeds safe limits, the breaker trips and interrupts the circuit. In software, when a downstream service failure rate exceeds a threshold, the circuit breaker *opens* and immediately rejects calls to that service — without attempting the network call at all.

This prevents the calling service from wasting threads and connections on a dependency that is known to be unavailable.

``` mermaid
stateDiagram-v2
    [*] --> Closed

    Closed --> Open : failure rate exceeds threshold\n(e.g. > 50% errors in last 10 calls)
    Open --> HalfOpen : wait timeout expires\n(e.g. 30 seconds)
    HalfOpen --> Closed : probe request succeeds
    HalfOpen --> Open : probe request fails
```

**Closed** (normal operation)
: Requests pass through. The breaker counts successes and failures. If the failure rate crosses the configured threshold, the breaker trips to Open.

**Open** (failing fast)
: All requests are rejected immediately with an error — no network call is made. This protects the caller's resources and gives the downstream service time to recover. After a configured wait timeout, the breaker moves to Half-Open.

**Half-Open** (testing recovery)
: A limited number of probe requests are allowed through. If they succeed, the downstream service has recovered and the breaker closes. If they fail, the breaker returns to Open.

### Configuration knobs

| Parameter | Typical value | Effect |
|---|---|---|
| **Failure threshold** | 50% of last 10–20 calls | Sensitivity to failures |
| **Wait timeout** | 30–60 seconds | How long the service gets to recover |
| **Half-Open probe count** | 3–5 requests | How cautiously to test recovery |
| **Slow call threshold** | 2× normal P99 | Treat slow calls as failures |

**Spring Boot**: the [Resilience4j](https://resilience4j.readme.io/docs/circuitbreaker){target="_blank"} library implements all of these patterns with `@CircuitBreaker`, `@Retry`, and `@Bulkhead` annotations.

---

## Bulkhead

The bulkhead pattern — named after watertight compartments in a ship hull — **isolates resources by dependency**. Rather than sharing a single thread pool across all downstream calls, each dependency gets its own pool.

``` mermaid
flowchart TD
    gateway --> poolA["Thread Pool A\n(max 10 threads)"]
    gateway --> poolB["Thread Pool B\n(max 10 threads)"]
    poolA --> payment["Payment Service\n(degraded ⚠️)"]:::slow
    poolB --> inventory["Inventory Service\n(healthy ✓)"]:::ok

    classDef slow fill:#f90,color:#000
    classDef ok fill:#6c6,color:#fff
```

If Payment Service degrades and fills all 10 threads in Pool A, Pool B is completely unaffected. Inventory Service continues to handle requests at full speed. Without bulkheads, a single slow dependency saturates the shared pool and degrades all other calls equally.

The cost of bulkheads is resource overhead: ten separate pools of 10 threads each use more memory than one pool of 100 threads. The trade-off is almost always worth it for critical-path dependencies.

---

## Rate Limiting

Rate limiting caps the number of requests a client (or the system) can make within a time window, protecting services from traffic spikes and abusive clients.

### Token bucket algorithm

The **token bucket** is the most common rate limiting algorithm. It models a bucket that fills at a constant rate with tokens; each request consumes one token; requests that arrive when the bucket is empty are rejected or queued.

``` mermaid
flowchart LR
    refill["Token source\n(refill rate: 100 req/s)"] -->|adds tokens| bucket["Token Bucket\n(capacity: 200)"]
    request["Incoming\nRequest"] -->|consumes 1 token| bucket
    bucket -->|tokens available| allowed["✓ Allowed"]
    bucket -->|bucket empty| rejected["✗ 429 Too Many Requests"]
```

| Property | Effect |
|---|---|
| **Refill rate** | Steady-state maximum throughput |
| **Bucket capacity (burst)** | How much instantaneous traffic above the rate is tolerated |

A bucket capacity larger than the refill rate allows short bursts while still enforcing a long-term average. This is how most real implementations (Nginx `limit_req`, AWS API Gateway, Spring's `RequestRateLimiter`) work.

---

## Health Checks

Health check endpoints allow orchestrators (Kubernetes, Docker Compose, load balancers) to detect failed instances and stop routing traffic to them before clients notice.

Two distinct types serve different purposes:

**Liveness**
: *Is the process alive?* Returns `200 OK` if the application is running and not deadlocked. If a liveness check fails, the orchestrator **restarts** the container.

**Readiness**
: *Is the service ready to serve traffic?* Returns `200 OK` only if all dependencies (database, cache, downstream services) are reachable and warmed up. If a readiness check fails, the orchestrator **removes the instance from the load balancer pool** without restarting it.

``` mermaid
flowchart LR
    lb["Load Balancer"] -->|"GET /actuator/health/readiness"| svc["Service Instance"]
    svc -->|200 OK| lb
    lb -->|routes traffic| svc

    svc2["Service Instance\n(db connection lost)"]
    lb -->|"GET /actuator/health/readiness"| svc2
    svc2 -->|503 DOWN| lb
    lb -->|removed from pool| svc2:::failed

    classDef failed fill:#f66,color:#fff
```

Spring Boot Actuator exposes both at `/actuator/health/liveness` and `/actuator/health/readiness` out of the box.

---

## Defence in depth

These patterns are layered, not chosen in isolation. A production-grade call chain combines all of them:

``` mermaid
flowchart LR
    client --> rl["Rate Limiter\n(protect service)"]
    rl --> cb["Circuit Breaker\n(fast-fail open deps)"]
    cb --> bh["Bulkhead\n(isolate thread pool)"]
    bh --> to["Timeout\n(bound wait time)"]
    to --> retry["Retry + Backoff\n(handle transients)"]
    retry --> downstream[Downstream Service]
```

Each layer handles a different failure scenario:

| Layer | What it handles |
|---|---|
| Rate limiter | Traffic spikes, abusive clients |
| Circuit breaker | Known-failing dependencies |
| Bulkhead | Slow dependencies bleeding into other calls |
| Timeout | Unbounded waiting |
| Retry + backoff | Transient errors |

---

[^1]: NYGARD, M. *Release It! Design and Deploy Production-Ready Software*, 2nd ed. Pragmatic Programmers, 2018.
[^2]: BROOKER, M. [Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/){target="_blank"}. AWS Architecture Blog, 2015.
[^3]: FOWLER, M. [CircuitBreaker](https://martinfowler.com/bliki/CircuitBreaker.html){target="_blank"}. martinfowler.com, 2014.
[^4]: [Resilience4j Documentation](https://resilience4j.readme.io/docs){target="_blank"}.
