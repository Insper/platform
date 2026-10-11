
When a downstream service degrades or fails, the naive default — keep sending requests and wait for a response — reliably produces cascading failures. The calling service's threads block, its queue fills, and the failure propagates upstream to clients who had nothing to do with the broken dependency.

Resilience patterns are design decisions that interrupt this propagation. They do not prevent failures; they **limit how far a failure travels** through the system[^1].

``` mermaid-sim
flowchart LR
    client --> gateway
    gateway -->|"Timeout\nCircuit Breaker\nBulkhead"| downstream:::slow
    gateway -->|"fast failure\nor fallback"| client:::ok

    classDef slow fill:#f90,color:#000
    classDef ok fill:#6c6,color:#fff
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
    G-->>-C: 503 Service Unavailable
    P-->>-G: (response arrives late — discarded)
```

### Choosing timeout values

- **Percentile-based**: set the timeout at the P99.9 latency of the downstream service under normal conditions. Anything slower than that is already abnormal.
- **Budget-aware**: if the upstream call has its own timeout of 1 s, all downstream calls within that request must complete well under 1 s combined.
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

| Attempt | Formula | Wait (c = 1 s) |
|---|---|---|
| 1 | $1 \cdot 2^0$ | 1 s |
| 2 | $1 \cdot 2^1$ | 2 s |
| 3 | $1 \cdot 2^2$ | 4 s |
| 4 | $1 \cdot 2^3$ | 8 s |
| 5 | $1 \cdot 2^4$, capped | 16 s (= `max_wait` of 16 s) |
| 6+ | capped at max | 16 s |

### Jitter

Even with exponential backoff, clients that all failed at the same moment will retry at the same moments — a synchronised wave of retries. Adding a random **jitter** breaks this synchronisation:

$$
\text{wait}_n = \min\left(c \cdot 2^n,\ \text{max\_wait}\right) + \text{random}(0,\ \text{jitter\_cap})
$$

Marc Brooker's analysis at AWS[^2] compared several variants and recommends **full jitter**, which randomises the *entire* wait instead of adding a small random amount:

$$
\text{wait}_n = \text{random}\left(0,\ \min\left(c \cdot 2^n,\ \text{max\_wait}\right)\right)
$$

With 1,000 clients failing at the same instant, full jitter spreads their retries uniformly over the interval instead of sending 1,000 requests at exactly t = 1 s, 2 s, 4 s.

### What to retry — and what not to

| Response | Retry? | Why |
|---|---|---|
| Connection refused, connection reset, timeout | Yes | Typical transient failure |
| `503 Service Unavailable`, `429 Too Many Requests` | Yes, with backoff (respect `Retry-After` if present) | The server is asking you to come back later |
| `500 Internal Server Error` | Maybe, once | Often a bug that will fail again |
| `400`, `401`, `403`, `404`, `422` | No | The request itself is wrong; retrying cannot fix it |

!!! warning "Retry amplification"
    Retries multiply load exactly when the system is weakest. If the gateway, the order service and the product client each retry 3 times, one user click can become 3 × 3 × 3 = **27** calls to a struggling product service. Retry at **one** layer only (usually the one closest to the failing dependency), cap the number of attempts, and stop retrying when the circuit breaker is open.

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

The circuit breaker[^3] is named by analogy with the electrical component: when the current load exceeds safe limits, the breaker trips and interrupts the circuit. In software, when a downstream service failure rate exceeds a threshold, the circuit breaker *opens* and immediately rejects calls to that service — without attempting the network call at all.

This prevents the calling service from wasting threads and connections on a dependency that is known to be unavailable.

``` mermaid-sim
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

**Spring Boot**: the [Resilience4j](https://resilience4j.readme.io/docs/circuitbreaker){target="_blank"} library[^4] implements all of these patterns with `@CircuitBreaker`, `@Retry`, `@Bulkhead`, `@RateLimiter` and `@TimeLimiter` annotations (dependency `io.github.resilience4j:resilience4j-spring-boot3` plus `spring-boot-starter-aop`).

!!! example "Circuit breaker and retry around the product call"

    === "OrderService.java"

        ```java
        @CircuitBreaker(name = "product", fallbackMethod = "priceFallback")
        @Retry(name = "product")
        public ProductOut findProduct(String id) {
            return productController.findById(id).getBody();   // Feign call
        }

        // Same signature + the exception. Called when the call fails
        // or when the breaker is open (CallNotPermittedException).
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
                sliding-window-size: 10                  # last 10 calls
                failure-rate-threshold: 50               # % → Open
                slow-call-duration-threshold: 2s         # slow = failure
                wait-duration-in-open-state: 30s         # Open → Half-Open
                permitted-number-of-calls-in-half-open-state: 3
          retry:
            instances:
              product:
                max-attempts: 3                          # 1 call + 2 retries
                wait-duration: 500ms
                enable-exponential-backoff: true         # 500 ms, 1 s, ...
                exponential-backoff-multiplier: 2
        ```

    The breaker's state is exported as a metric (`resilience4j_circuitbreaker_state`) through Actuator, so you can graph it in Grafana ([Hands-on 6](../../../hands-on/6/index.md)).

The simulation below shows the circuit breaker cycling through all three states as the failure rate changes:

```python exec="1" html="1"
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np

rng = np.random.default_rng(42)
steps = 60
state = "Closed"
failure_window = []
window_size = 10
threshold = 0.5
wait_steps = 10
half_open_at = None
probe_allowed = False

states, rates = [], []

for t in range(steps):
    # inject failures: high in t=15..29, recover at t=40
    if 15 <= t < 30:
        success = rng.random() > 0.75  # 75% failure
    elif t >= 40:
        success = rng.random() > 0.05  # 5% failure (recovered)
    else:
        success = rng.random() > 0.1   # 10% failure (normal)

    if state == "Closed":
        failure_window.append(0 if success else 1)
        if len(failure_window) > window_size:
            failure_window.pop(0)
        rate = sum(failure_window) / len(failure_window) if failure_window else 0
        if rate > threshold and len(failure_window) >= window_size:
            state = "Open"
            half_open_at = t + wait_steps
    elif state == "Open":
        rate = 1.0
        if t >= half_open_at:
            state = "Half-Open"
            probe_allowed = True
    elif state == "Half-Open":
        rate = sum(failure_window) / len(failure_window) if failure_window else 0
        if probe_allowed:
            probe_allowed = False
            if success:
                state = "Closed"
                failure_window = []
            else:
                state = "Open"
                half_open_at = t + wait_steps

    states.append(state)
    rates.append(rate)

color_map = {"Closed": "steelblue", "Open": "tomato", "Half-Open": "goldenrod"}
colors = [color_map[s] for s in states]

fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(11, 4), sharex=True)

ax1.bar(range(steps), [1 - r for r in rates], color=colors, alpha=0.85)
ax1.set_ylabel("Success rate")
ax1.set_ylim(0, 1.1)
ax1.set_title("Circuit Breaker Simulation", fontweight="bold")

for i, (s, c) in enumerate(zip(states, colors)):
    ax2.barh(0, 1, left=i, color=c, alpha=0.9, height=0.6)
ax2.set_xlim(0, steps)
ax2.set_yticks([])
ax2.set_xlabel("Time step")
ax2.set_ylabel("State")

legend = [mpatches.Patch(color=v, label=k) for k, v in color_map.items()]
ax2.legend(handles=legend, loc="upper right", fontsize=8)

plt.tight_layout()
from io import StringIO
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

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
    gateway --> poolA["Thread Pool A\n(max 10 threads)"]
    gateway --> poolB["Thread Pool B\n(max 10 threads)"]
    poolA --> payment["Payment Service\n(degraded ⚠️)"]:::slow
    poolB --> inventory["Inventory Service\n(healthy ✓)"]:::ok

    classDef slow fill:#f90,color:#000
    classDef ok fill:#6c6,color:#fff
```

If Payment Service degrades and fills all 10 threads in Pool A, Pool B is completely unaffected. Inventory Service continues to handle requests at full speed. Without bulkheads, a single slow dependency saturates the shared pool and degrades all other calls equally.

The cost of bulkheads is resource overhead: ten separate pools of 10 threads each use more memory than one pool of 100 threads. The trade-off is almost always worth it for critical-path dependencies.

Resilience4j offers two kinds of bulkhead: a **semaphore** bulkhead (`max-concurrent-calls`, limits how many threads may be inside the call at once — cheap, the default) and a **thread-pool** bulkhead (the call runs in a dedicated pool). The same idea applies outside the JVM: separate database connection pools per workload, or separate Kubernetes deployments for critical and non-critical traffic.

---

## Rate Limiting

Rate limiting caps the number of requests a client (or the system) can make within a time window, protecting services from traffic spikes and abusive clients.

### Token bucket algorithm

The **token bucket** is the most common rate limiting algorithm. It models a bucket that fills at a constant rate with tokens; each request consumes one token; requests that arrive when the bucket is empty are rejected or queued.

``` mermaid-sim
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

A bucket capacity larger than the refill rate allows short bursts while still enforcing a long-term average. Spring Cloud Gateway's `RequestRateLimiter` filter (backed by Redis) and AWS API Gateway use a token bucket. Nginx `limit_req` uses the closely related **leaky bucket**: requests drain at a fixed rate and the `burst` parameter sets how many may wait in the queue.

!!! example "Rate limiting at the store's edge (Nginx)"

    ```nginx
    # 10 requests/s per client IP, bursts of up to 20 queued requests
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

``` mermaid-sim
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

Spring Boot Actuator exposes both at `/actuator/health/liveness` and `/actuator/health/readiness`. They are enabled automatically when the application detects it runs on Kubernetes; elsewhere (e.g. Docker Compose) set `management.endpoint.health.probes.enabled=true`. By default they reflect only the application's internal state; add a dependency to readiness explicitly, e.g. `management.endpoint.health.group.readiness.include=readinessState,db`.

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

!!! info "The order is a design decision"
    The diagram shows one common conceptual layering. Libraries make their own choice: in Resilience4j's Spring Boot integration the default aspect order is `Retry ( CircuitBreaker ( RateLimiter ( TimeLimiter ( Bulkhead ( call ) ) ) ) )` — the retry is the **outermost** layer, so every attempt is counted by the circuit breaker and an open breaker makes the remaining attempts fail immediately. Whatever the order, check that retries do not bypass the breaker and that the sum of timeouts × attempts fits in the caller's own deadline.

---

## Connections

- [Hands-on 1](../../../hands-on/1/index.md) — the Feign clients that need timeouts and breakers.
- [Hands-on 7](../../../hands-on/7/index.md) — Nginx in front of the gateway, where edge rate limiting lives.
- [Hands-on 9](../../../hands-on/9/index.md) — retries and dead letter queues for asynchronous consumers.
- [SLI / SLO / SLA](../sli-slo-sla/index.md) — the budget these patterns protect.

## Key takeaways

- Every remote call needs a **timeout** (connect + read), chosen per dependency and inside the caller's budget.
- **Retry** only transient failures and idempotent operations, with **exponential backoff and full jitter**, at one layer only; use **idempotency keys** to make `POST` safe.
- A **circuit breaker** (Closed → Open → Half-Open) fails fast on a dependency known to be down; pair it with a safe **fallback**.
- **Bulkheads** keep one slow dependency from consuming all threads or connections; **rate limiting** (token / leaky bucket) protects the service from excess traffic.
- **Liveness** restarts, **readiness** removes from the load balancer; never check external dependencies in liveness.
- The patterns are layered; their order and combined timeouts must be designed, then verified with [chaos experiments](../chaos/index.md).

---

[^1]: NYGARD, M. *Release It! Design and Deploy Production-Ready Software*, 2nd ed. Pragmatic Programmers, 2018.
[^2]: BROOKER, M. [Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/){target="_blank"}. AWS Architecture Blog, 2015.
[^3]: FOWLER, M. [CircuitBreaker](https://martinfowler.com/bliki/CircuitBreaker.html){target="_blank"}. martinfowler.com, 2014.
[^4]: [Resilience4j Documentation](https://resilience4j.readme.io/docs){target="_blank"}.
