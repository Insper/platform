When a dependency degrades, the naive default — keep sending requests and wait for the answer — reliably produces the cascade of the [overview](../index.md#cascading-failures): the caller's threads block, its queue fills, and the failure climbs to users who had nothing to do with the broken dependency. **Resilience patterns** are design decisions that interrupt this propagation. They do not prevent failures; they **limit how far a failure travels**[^1].

Throughout this page we follow one call of BoxOffice: **`order` calls `payment`**, the adapter in front of the external payment provider, to charge a fan's card during the purchase saga (see [Messaging — patterns](../../messaging/patterns/index.md#sagas)). It is the most dangerous call in the system: it is on the revenue path, it crosses the internet to a third party, and the third party's bad day becomes ours.

| Pattern | Question it answers | Protects against |
|---|---|---|
| [Timeout](#timeout) | How long am I willing to wait? | Hanging calls holding resources |
| [Retry with backoff and jitter](#retry-with-backoff-and-jitter) | Is it worth trying again — when? | Transient failures |
| [Circuit breaker](#circuit-breaker) | Should I even try? | Hammering a dependency known to be down |
| [Fallback](#fallback-and-graceful-degradation) | What do I answer instead? | Losing a whole page for one feature |
| [Bulkhead](#bulkhead) | How much of my capacity may one dependency take? | Exhaustion spreading between features |
| [Load shedding](#load-shedding) | Which work do I refuse when overloaded? | Collapse under overload |
| [Rate limiting](#rate-limiting) | How much does each client get? | Abusive clients, bots, spikes |
| [Health checks](#health-checks) | Should traffic reach this instance? | Routing to broken instances |

---

## Timeout { #timeout }

A **timeout** is a deadline on an outbound call: if the answer has not arrived in time, the caller abandons it and handles the error. Without a timeout, a hanging dependency holds a thread (and a connection, and memory) indefinitely; with one, the damage a single slow call can do is bounded.

``` mermaid-sim
sequenceDiagram
    participant O as order
    participant P as payment adapter
    participant X as payment provider
    O->>+P: POST /charges (deadline 2 s)
    P->>+X: charge card
    Note over X: provider is slow today
    Note over O: 2 s elapsed: give up, free the thread
    O-->>O: handle the error (retry? fallback?)
    X-->>-P: (answer arrives at 4 s)
    P-->>-O: (too late: discarded)
```

How to choose the value:

- **From the dependency's latency distribution.** Set it a little above the p99.9 of normal operation: anything slower is already abnormal. For the provider, with p99.9 ≈ 1.2 s, a 2 s timeout.
- **Two timeouts per HTTP call**: the **connect timeout** (opening the TCP/TLS connection — short, a few hundred milliseconds) and the **read timeout** (waiting for the response).
- **Per dependency.** A cache lookup, a database query and a third-party API have latencies that differ by orders of magnitude. One global timeout is always wrong for most of them.
- **Inside the caller's budget.** If the fan's request has 6 s at the gateway, everything below must fit in it, including retries.

### Deadline propagation

Timeouts must shrink as a request goes deeper. A deadline set at the edge and **propagated** with the request (gRPC does this natively with deadlines; over HTTP, a header such as the remaining budget) lets each service know how much time is left, and stop working on a request whose caller has already given up.

| Layer | Budget | Spent on |
|---|---|---|
| Gateway | 6 s | everything below + its own work |
| `order` (purchase handler) | 5 s | seat-hold check (≤ 300 ms) + payment (≤ 4.5 s) |
| `order` → `payment` | 2 s per attempt × 2 attempts + backoff ≈ 4.3 s | the provider call |
| `payment` → provider | 1.8 s | leaves margin for the adapter's own work |

!!! warning "Timeouts are only the first step"
    A timeout converts a hang into a fast error. You still need to decide what to do with the error: retry it (if transient and safe), stop calling for a while (circuit breaker), or answer something else (fallback). And a timeout on a *non-idempotent* call leaves an unknown outcome — the charge may have succeeded — which is why `payment` calls carry an idempotency key (see [Integrations](../../compute/integrations/index.md)).

---

## Retry with backoff and jitter { #retry-with-backoff-and-jitter }

A **retry** repeats a failed call, betting that the failure was **transient**: a dropped connection, a pod restarting, a leader election. Retries turn many small blips into invisible ones. Done carelessly, they are also the fastest way to turn a small problem into an outage.

### What to retry

| Failure | Retry? | Why |
|---|---|---|
| Connection refused / reset, connect timeout | Yes | Typical transient failure; the request probably never ran |
| Read timeout | Only if the operation is idempotent (or has an idempotency key) | The request may have run |
| `503 Service Unavailable`, `429 Too Many Requests` | Yes, with backoff; respect `Retry-After` | The server is asking you to come back later |
| `500 Internal Server Error` | At most once | Often a bug that fails again |
| `400`, `401`, `403`, `404`, `409`, `422`; "card declined" | **Never** | The request itself is wrong or the answer is final |

### Exponential backoff and jitter

Retrying immediately hits a struggling dependency again before it had any chance to recover. **Exponential backoff** waits longer after each failure:

$$
\text{wait}_n = \min\left(\text{base} \cdot 2^{n},\ \text{cap}\right)
$$

With base 200 ms: 200 ms, 400 ms, 800 ms, … up to the cap. But if many clients failed at the same moment (the provider blipped for everyone), they all retry at the same moments too — synchronized waves. **Jitter** randomizes the waits; Marc Brooker's analysis at AWS recommends **full jitter**[^2]:

$$
\text{wait}_n = \text{random}\left(0,\ \min\left(\text{base} \cdot 2^{n},\ \text{cap}\right)\right)
$$

### Retries amplify load

The simulation below has two experiments with illustrative numbers. On the left, steady purchase traffic (1,000 requests/s) meets a payment provider that degrades for 5 seconds; an overloaded server wastes part of its capacity on requests that time out anyway. On the right, 1,000 clients fail at the same instant (say, a connection reset during a failover) and retry against a server that can take 150 requests per 100 ms.

```python exec="1" html="1"
import matplotlib.pyplot as plt
from io import StringIO

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "xtick.color": "#888",
                     "ytick.color": "#888", "axes.edgecolor": "#888", "svg.fonttype": "none"})
DT = 0.1                                     # 100 ms ticks; all numbers are illustrative

# --- Experiment 1: steady traffic, the provider degrades for 5 s -----------------------
NEW, CAP = 100, 120                          # 1,000 new req/s; capacity 1,200 req/s

def goodput(load, cap):                      # overload wastes work on requests that time out
    return min(load, cap / (1 + 0.5 * max(0.0, load / cap - 1)))

def steady(policy, ticks=600, retries=3):
    pending = [[0.0] * (retries + 1) for _ in range(ticks + 100)]
    ok = []
    for k in range(ticks):
        pending[k][0] += NEW
        cap = 50 if 100 <= k < 150 else CAP          # 10 s-15 s: degraded
        load = sum(pending[k])
        served = goodput(load, cap)
        fail = 1 - served / load
        budget = 0.1 * NEW                            # retry budget: retries <= 10% of requests
        for a in range(retries):
            failed = pending[k][a] * fail
            if policy == "none":
                break
            if policy == "budget":
                failed, budget = min(failed, budget), budget - min(failed, budget)
            delay = int(2 ** a / DT)                  # backoff 1 s, 2 s, 4 s with full jitter
            for d in range(1, delay + 1):
                pending[k + d][a + 1] += failed / delay
        ok.append(served / DT)
    return ok

# --- Experiment 2: 1,000 clients fail at the same instant (e.g. a failover) -----------
def herd(jitter, ticks=160, clients=1000, cap=150, retries=5):
    pending = [[0.0] * retries for _ in range(ticks + 400)]

    def schedule(k, attempt, n):                 # retry #attempt waits 0.5 s, 1 s, 2 s, 4 s, 8 s
        delay = int(0.5 * 2 ** attempt / DT)
        if jitter:                               # full jitter: uniform in (0, delay]
            for d in range(1, delay + 1):
                pending[k + d][attempt] += n / delay
        else:
            pending[k + delay][attempt] += n

    schedule(0, 0, clients)                      # at t = 0 every client's call fails
    arrivals = []
    for k in range(ticks):
        load = sum(pending[k])
        fail = 1 - min(load, cap) / load if load else 0
        for a in range(retries - 1):
            schedule(k, a + 1, pending[k][a] * fail)
        arrivals.append(load)
    return arrivals

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4))
t1 = [k * DT for k in range(600)]
for policy, label, color in [("none", "no retries", "#888888"),
                             ("retries", "3 retries, backoff + jitter", "#e53935"),
                             ("budget", "same + retry budget (10%)", "#1976d2")]:
    ax1.plot(t1, steady(policy), color=color, lw=1.6, label=label)
ax1.axvspan(10, 15, color="#888", alpha=0.15)
ax1.set_title("Successful requests/s (shaded: provider slow)")
ax1.set_xlabel("seconds")
ax1.set_ylim(0, 1200)
ax1.legend(fontsize=8, loc="lower right")

t2 = [k * DT for k in range(160)]
ax2.bar(t2, herd(False), width=DT, color="#fb8c00", alpha=0.8, label="exponential backoff, no jitter")
ax2.plot(t2, herd(True), color="#1976d2", lw=1.8, label="backoff + full jitter")
ax2.axhline(150, color="#888", ls="--", lw=1)
ax2.text(11.5, 165, "capacity", fontsize=8)
ax2.set_title("Retries per 100 ms after 1,000 clients fail together")
ax2.set_xlabel("seconds")
ax2.legend(fontsize=8)
for ax in (ax1, ax2):
    ax.grid(True, alpha=0.3)
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

- **Left — retries can keep a system down.** Without retries (grey), successes drop during the degradation and come back the moment it ends. With 3 retries per request (red), each failure becomes up to 4 calls; the extra load keeps the provider overloaded *after* the trigger is gone, and the system settles in a degraded state — a **metastable failure** (see the [overview](../index.md#other-amplifiers)). Backoff and jitter do not fix this: they spread retries in time but do not reduce their number. A **retry budget** (blue) — retries may add at most 10% to the normal traffic — caps the amplification and the system recovers immediately.
- **Right — jitter prevents synchronized waves.** Without jitter (orange), all clients that failed together retry together: 1,000 calls in one 100 ms slot, only 150 succeed, the other 850 retry together again… after 15 seconds 250 clients still have not succeeded. With full jitter (blue), the same retries are spread below the capacity line and everyone succeeds in about 1.5 s.

Three rules follow:

1. **Retry at one layer only.** If the gateway, `order` and the `payment` adapter each retry 3 times, one fan click can become $3 \times 3 \times 3 = 27$ calls to the provider. Retry close to the failing dependency and let upper layers fail fast.
2. **Cap attempts and total time**: few attempts (1–2 retries), all inside the caller's deadline.
3. **Use a retry budget** (Envoy, gRPC retry throttling, Finagle): retries are allowed only while they are a small fraction of requests. When the dependency is really down, retries stop by themselves.

!!! info "Try it in the playground"

    The `retry-storm` scenario has clients retrying failed calls with no backoff against a service that suffers a short outage. Press **Run** and watch the request rate to the service jump to several times the client rate during the outage, and the service stay overloaded after it should have recovered. Then switch the retry policy to **exponential backoff with jitter** and add a **retry budget**, and compare the recovery time.

<div class="sdp" data-scenario="retry-storm" data-mode="compact" data-height="520"></div>

!!! danger "Never retry a non-idempotent call without an idempotency key"
    Retrying `POST /charges` after a read timeout can charge the fan twice: the first attempt may have succeeded. The `order` service sends an `Idempotency-Key` (the order id) with every charge; the adapter and the provider return the stored result for a key they have already seen. See [Messaging — delivery semantics](../../messaging/semantics/index.md) and [Integrations](../../compute/integrations/index.md).

---

## Circuit breaker { #circuit-breaker }

A **circuit breaker** watches the outcomes of calls to a dependency. When the failure rate crosses a threshold, it **opens** and rejects calls immediately, without touching the network, for a while; then it lets a few probe calls through to test recovery[^3].

``` mermaid-sim
stateDiagram-v2
    [*] --> Closed
    Closed --> Open : failure or slow-call rate ≥ 50% (last 20 calls)
    Open --> HalfOpen : after 30 s
    HalfOpen --> Closed : 3 probe calls succeed
    HalfOpen --> Open : a probe fails
```

**Closed** (normal)
: Calls pass through; the breaker records successes, failures and slow calls in a sliding window.

**Open** (failing fast)
: Calls fail immediately (`CallNotPermittedException` in Resilience4j). The caller's threads are free, and the dependency gets breathing room instead of a retry storm.

**Half-open** (testing)
: After the wait duration, a few calls are allowed. If they succeed, the breaker closes; if not, it opens again.

| Parameter | BoxOffice value for `payment` | Effect |
|---|---|---|
| Sliding window | last 20 calls (count-based) | How much history decides |
| Minimum calls | 10 | Avoids opening on 1 failure out of 2 |
| Failure-rate threshold | 50% | Sensitivity |
| Slow-call threshold | 1.5 s, slow-call rate 50% | A *slow* provider also opens the breaker — essential against gray failures |
| Wait in open state | 30 s | Time the dependency gets to recover |
| Calls in half-open | 3 | How carefully recovery is tested |

Which errors count matters: a **declined card** is a correct answer from a healthy provider, not a failure. Configure it as ignored, or a wave of declined cards on a stolen-card attack would open the breaker for every honest fan.

---

## Fallback and graceful degradation { #fallback-and-graceful-degradation }

Failing fast is better than hanging, but an error is still an error. A **fallback** is what the caller does *instead*. The goal is **graceful degradation**: lose a feature, not the page.

| Dependency down | BoxOffice fallback |
|---|---|
| Recommendations ("fans also bought") | Hide the widget, or show a static "popular this week" list from the cache |
| Search | Serve the last cached results; show "results may be a few minutes old" |
| Seat-map rendering service | Show the best-available selector ("2 seats, sector B") instead of the interactive map |
| `notification` | Nothing to do synchronously: the event is already in Kafka and will be delivered later |
| `payment` | **No fake success.** Keep the seats held, tell the fan "payment temporarily unavailable — your seats are held for 10 minutes, try again", and let the saga retry or release |

!!! warning "A fallback must be safe and simple"
    A fallback that calls another remote service can fail too and needs its own protection. Some operations — charging a card, confirming a seat — must never be faked: failing clearly *is* the graceful behaviour. And test your fallbacks; a fallback first exercised during an outage usually fails.

---

## Bulkhead { #bulkhead }

A **bulkhead** — named after the watertight compartments of a ship — gives each dependency its **own limited pool** of threads, connections or concurrent calls, so one slow dependency cannot consume the capacity of the others.

``` mermaid-sim
flowchart LR
    req["order: 200 request threads"] --> bp["payment bulkhead<br/>max 50 concurrent"]
    req --> bi["inventory bulkhead<br/>max 40 concurrent"]
    req --> bc["catalog bulkhead<br/>max 20 concurrent"]
    bp --> pay["payment<br/>(slow: 4 s)"]
    bi --> inv["inventory<br/>(healthy)"]
    bc --> cat["catalog<br/>(healthy)"]
```

Sizing comes from Little's Law again. At 100 purchases/s and 200 ms per charge, about 20 calls are in flight. A bulkhead of **50** leaves room for latency to grow 2.5× before calls are rejected; when the provider goes to 4 s, at most 50 threads wait on it (instead of 400), and the other 150 keep serving holds, order pages and everything else. Rejected calls fail in microseconds and go to the fallback.

Resilience4j offers a **semaphore bulkhead** (limits concurrent calls on the caller's threads; cheap, the default) and a **thread-pool bulkhead** (runs calls on a dedicated pool). The idea is general: separate connection pools per workload in a database, separate Kafka consumer groups, separate deployments for critical and non-critical traffic, separate queues for confirmations and marketing e-mails.

---

## Load shedding { #load-shedding }

When demand exceeds capacity, *some* requests will fail. **Load shedding** decides **which** and makes them fail **early and cheaply**, so the rest succeed. Without it, the server accepts everything, every request gets slow, most time out after consuming resources, and goodput collapses — everyone fails[^4].

- **Shed at the door.** Reject with `503` + `Retry-After` before doing any work: a rejection costs microseconds, a timed-out request costs its full processing.
- **Shed by priority.** During the stadium on-sale, BoxOffice classifies traffic: purchase and seat-hold requests are critical; catalog browsing is important; recommendations, autocomplete and "related events" are sheddable. Under overload, the sheddable go first.
- **Shed stale work.** A request that already waited longer than its caller's deadline is useless; drop it from the queue instead of processing it (bounded queues with deadlines, LIFO under overload).
- **Adapt the limit.** Instead of a fixed concurrency limit, adaptive limiters (inspired by TCP congestion control, e.g. Netflix's concurrency-limits library) lower the number of concurrent requests when latency rises and raise it when latency is healthy.

!!! example "BoxOffice: the waiting room is load shedding"

    The [flash-sale waiting room](../../messaging/queues-pubsub/index.md#the-flash-sale-waiting-room) is load shedding done kindly: instead of rejecting fans, it admits them at the rate the system can serve and tells the others their position. Behind it, the gateway still sheds sheddable routes when `order` latency rises, as a second line of defence.

---

## Rate limiting { #rate-limiting }

**Rate limiting** caps how many requests a **client** (an IP, a user, an API key, a partner) may send in a time window. Load shedding protects the server from *total* overload; rate limiting protects it from *individual* clients — bots refreshing the seat map hundreds of times per second, a partner's buggy integration, a scraper.

The common algorithm is the **token bucket**: tokens refill at a steady rate (the sustained limit), the bucket's size allows short bursts, and each request takes a token; an empty bucket means `429 Too Many Requests`. Limits per user or API key live in the API gateway, backed by a shared store such as Redis, where the authenticated identity is known. Algorithms (token bucket, leaky bucket, sliding window) and their implementation are covered in [Edge — API gateway](../../edge/api-gateway/index.md); the `rate-limiter` playground scenario shows a gateway protecting a backend.

---

## Health checks { #health-checks }

Health checks let orchestrators and load balancers stop sending traffic to broken instances — automatic failover at the smallest scale.

**Liveness**
: *Is the process alive and not stuck?* If it fails, Kubernetes **restarts** the container.

**Readiness**
: *Can this instance serve traffic now?* If it fails, the instance is **removed from the load balancer** without being restarted (warming up, overloaded, lost its own database connection).

**Startup**
: *Has the application finished starting?* Liveness and readiness are not checked until it succeeds, so a slow-starting JVM is not killed during boot.

```yaml
# order Deployment, container spec (Spring Boot Actuator endpoints)
startupProbe:
  httpGet: { path: /actuator/health/liveness, port: 8080 }
  periodSeconds: 5
  failureThreshold: 30        # up to 150 s to start
livenessProbe:
  httpGet: { path: /actuator/health/liveness, port: 8080 }
  periodSeconds: 10
  failureThreshold: 3
readinessProbe:
  httpGet: { path: /actuator/health/readiness, port: 8080 }
  periodSeconds: 5
  failureThreshold: 2
```

!!! danger "Never put dependencies in the liveness check"
    If `order`'s liveness checks the payment provider and the provider blips, Kubernetes **restarts every `order` replica at once** — turning a third-party hiccup into a full BoxOffice outage while the JVMs boot. Liveness answers only "is this process stuck?". Be careful with readiness too: if every replica depends on the same database, they all become unready together and the service vanishes instead of returning clear errors.

---

## Putting it together

The patterns are layered. For the `order` → `payment` call, BoxOffice uses all of them, configured with Resilience4j[^5]:

=== "application.yaml"

    ```yaml
    resilience4j:
      bulkhead:
        instances:
          payment:
            max-concurrent-calls: 50          # Little's Law: 20 in flight normally
            max-wait-duration: 10ms           # do not queue: reject and fall back
      circuitbreaker:
        instances:
          payment:
            sliding-window-type: COUNT_BASED
            sliding-window-size: 20
            minimum-number-of-calls: 10
            failure-rate-threshold: 50
            slow-call-duration-threshold: 1500ms
            slow-call-rate-threshold: 50      # a slow provider also opens the breaker
            wait-duration-in-open-state: 30s
            permitted-number-of-calls-in-half-open-state: 3
            ignore-exceptions:
              - boxoffice.payment.CardDeclinedException   # a correct answer, not a failure
      retry:
        instances:
          payment:
            max-attempts: 2                   # 1 call + 1 retry, at this layer only
            wait-duration: 200ms
            enable-exponential-backoff: true
            exponential-backoff-multiplier: 2
            enable-randomized-wait: true      # jitter
            randomized-wait-factor: 0.5
            retry-exceptions:
              - org.springframework.web.client.ResourceAccessException   # I/O errors, timeouts
              - org.springframework.web.client.HttpServerErrorException$ServiceUnavailable
            ignore-exceptions:
              - boxoffice.payment.CardDeclinedException
    ```

=== "PaymentClient.java"

    ```java
    @Service
    @RequiredArgsConstructor
    public class PaymentClient {

        private final RestClient payment;

        @Bulkhead(name = "payment")
        @CircuitBreaker(name = "payment", fallbackMethod = "unavailable")
        @Retry(name = "payment")
        public PaymentResult charge(ChargeRequest req) {
            return payment.post().uri("/charges")
                .header("Idempotency-Key", req.orderId())   // a retry never charges twice
                .body(req)
                .retrieve()
                .body(PaymentResult.class);
        }

        // Called when the call fails, the breaker is open or the bulkhead is full.
        private PaymentResult unavailable(ChargeRequest req, Throwable t) {
            return PaymentResult.temporarilyUnavailable(req.orderId());  // seats stay held
        }
    }
    ```

=== "Timeouts (RestClient)"

    ```java
    @Bean
    RestClient paymentRestClient(RestClient.Builder builder) {
        HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofMillis(300))          // connect timeout
            .build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(http);
        factory.setReadTimeout(Duration.ofSeconds(2));       // read timeout per attempt
        return builder.baseUrl("http://payment:8080").requestFactory(factory).build();
    }
    ```

How the layers interact — check these before shipping:

- **Order of the decorators.** Resilience4j's Spring Boot default is `Retry ( CircuitBreaker ( RateLimiter ( TimeLimiter ( Bulkhead ( call ) ) ) ) )`: the retry is outermost, so every attempt is counted by the breaker and an open breaker makes the retry fail immediately. Make sure retries never bypass the breaker.
- **Time budget.** 2 attempts × 2 s + one backoff of ~200–300 ms ≈ 4.3 s, inside `order`'s 5 s budget and the gateway's 6 s.
- **Metrics.** Resilience4j exports breaker state, bulkhead saturation and retry counts through Micrometer; graph them next to the SLO dashboard ([Hands-on 8](../../../hands-on/8/index.md)), because a breaker that opens is an incident in progress.
- **Proof.** None of this is trustworthy until you have injected the failure and watched it work — [chaos engineering](../chaos/index.md) and [Hands-on 9](../../../hands-on/9/index.md).

!!! info "Try it in the playground"

    Open the `cascading-failure` scenario in full mode. Run it once as it is (no protection) and note the error rate of the healthy routes. Then add, one at a time, a **timeout**, a **circuit breaker** and a **bulkhead** on the 3rd-party call, running after each change. Which one protects the healthy routes the most? What does each cost the requests that need the 3rd party?

<div class="sdp" data-scenario="cascading-failure" data-mode="full" data-height="620"></div>

| Layer | Handles | BoxOffice setting |
|---|---|---|
| Rate limiting (gateway) | Abusive clients, bots | per-account token bucket |
| Load shedding (gateway) | Overload | shed recommendations/autocomplete first |
| Bulkhead | One slow dependency eating all threads | 50 concurrent payment calls |
| Circuit breaker | A dependency known to be failing or slow | 50% failures or slow calls over 20 calls, open 30 s |
| Timeout | Unbounded waiting | 300 ms connect, 2 s read |
| Retry + backoff + jitter | Transient errors | 1 retry, 200 ms ± 50%, idempotency key |
| Fallback | What the fan sees | "payment temporarily unavailable, seats held" |

!!! tip "In the interview"
    When a design has a call to a third party or a critical dependency, volunteer the protection stack in one breath: "timeout at roughly the p99.9, one retry with jittered backoff and an idempotency key, a circuit breaker that also counts slow calls, a bulkhead sized with Little's Law, and a fallback that tells the user the truth". Then justify one number (the bulkhead or the timeout) with arithmetic. If asked about overload, distinguish **rate limiting** (per client) from **load shedding** (whole system, by priority), and mention retry amplification across layers.

!!! warning "Common pitfalls"

    - **Default timeouts** of minutes (or none) in HTTP and database clients.
    - **Retries at every layer** — 3 × 3 × 3 = 27 calls per click to a struggling service.
    - **Retrying non-idempotent calls** without an idempotency key: double charges.
    - **Counting business errors as failures**: declined cards opening the breaker for everyone.
    - **Breakers that only count errors, not slowness**: a provider at 4 s per call never trips them.
    - **Dependencies in liveness probes**: a third-party blip restarts the whole fleet.
    - **Untested fallbacks** that fail the first time they are needed.

## How it connects { #how-it-connects }

``` mermaid
flowchart LR
    SLOW["slow dependency<br/>(payment provider)"] --> TO["timeout ≈ p99.9<br/>+ deadline propagation"]
    TO --> RT["retry: backoff, jitter,<br/>retry budget, one layer"]
    RT --> IK["idempotency key<br/>→ Compute — integrations"]
    TO --> CB["circuit breaker<br/>(also counts slow calls)"]
    CB --> FB["fallback: seats held,<br/>tell the truth"]
    SLOW --> BH["bulkhead sized by<br/>Little's Law → Estimation"]
    OVER["overload"] --> LS["load shedding<br/>→ waiting room (Messaging)"]
    OVER --> RL["rate limiting<br/>→ Edge — API gateway"]
    HC["liveness, readiness, startup<br/>→ Cloud-native — Kubernetes"] --> LB["out of the load balancer<br/>→ Edge — load balancing"]
    CB --> CH["prove it under fault<br/>→ Chaos engineering"]
```

**Palette components:** [`thirdparty`](../../../reference/components/external/index.md#thirdparty) · [`payment`](../../../reference/components/external/index.md#payment) (the call every pattern on this page protects) · [`app`](../../../reference/components/compute/index.md#app) (the `order` replicas whose threads the bulkhead guards) · [`apigw`](../../../reference/components/edge/index.md#apigw) (rate limiting and load shedding at the door) · [`queue`](../../../reference/components/messaging/index.md#queue) (the waiting room) · [`healthcheck`](../../../reference/components/observability/index.md#healthcheck) (liveness, readiness, startup) · [`lb`](../../../reference/components/edge/index.md#lb) (drops unready instances). **Scenarios:** `cascading-failure`, `retry-storm`, `rate-limiter`, `payment-system`, `flash-sale`. **Continues in:** [Compute — integrations](../../compute/integrations/index.md#idempotency-keys), [Messaging — delivery semantics](../../messaging/semantics/index.md), [Messaging — the waiting room](../../messaging/queues-pubsub/index.md#the-flash-sale-waiting-room), [Edge — API gateway](../../edge/api-gateway/index.md#rate-limiting), [Edge — load balancing](../../edge/load-balancing/index.md#health-checks), [Cloud-native — Kubernetes](../../cloud-native/kubernetes/index.md), [Hands-on 9 — payment and Toxiproxy](../../../hands-on/9/payment/index.md).

---

[^1]: NYGARD, M. *Release It! Design and Deploy Production-Ready Software*, 2nd ed. Pragmatic Bookshelf, 2018. Chapter "Stability Patterns".
[^2]: BROOKER, M. [Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/){target="_blank"}. AWS Architecture Blog, 2015; BROOKER, M. [Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/){target="_blank"}. Amazon Builders' Library.
[^3]: FOWLER, M. [CircuitBreaker](https://martinfowler.com/bliki/CircuitBreaker.html){target="_blank"}. martinfowler.com, 2014.
[^4]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/books/){target="_blank"}. O'Reilly, 2016. Chapter 21, "Handling Overload"; YANACEK, D. [Using load shedding to avoid overload](https://aws.amazon.com/builders-library/using-load-shedding-to-avoid-overload/){target="_blank"}. Amazon Builders' Library.
[^5]: [Resilience4j Documentation](https://resilience4j.readme.io/docs){target="_blank"}.
