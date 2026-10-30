It is 10:00:00 and the stadium show goes on sale. Two million fans press **"Hold seat"** in the BoxOffice app at roughly the same second, and 60,000 seats have to be shared among them — each seat sold **exactly once**. One fan, on a train, presses the button, the spinner turns for five seconds, and the app shows *"Something went wrong, try again"*. She presses again. Did the first request hold a seat? Is she about to hold two? Will she be charged twice?

On a single machine that question would not exist: the function either returned or threw. BoxOffice, however, runs on dozens of machines — gateways, several replicas of the `inventory` service, a replicated PostgreSQL, Redis, a Kafka cluster — and the only thing connecting them is a network that can lose, delay and duplicate messages. That makes BoxOffice a **distributed system**, and this class is about what that changes.

A distributed system is a set of independent computers (**nodes**) that cooperate **only by exchanging messages** over a network, with **no shared memory and no shared clock**, and that appear to their users as a single coherent system[^1]. Leslie Lamport's half-joking definition is the most useful one for an engineer: *"a distributed system is one in which the failure of a computer you didn't even know existed can render your own computer unusable"*[^2].

!!! quote "The story so far"

    Chapter 3 of the [story of the course](../../index.md#story). [Class 2](../estimation/index.md) found a 30× gap between the on-sale demand (~33,000 holds/s) and what one database sustains (~1,100): BoxOffice needs several machines — app replicas, a standby database, a waiting room. **This class** answers: what changes when the only link between those machines is a network that loses, delays and duplicates messages — and how do we keep a retried click from holding or charging twice?

!!! abstract "Learning objectives"

    By the end of this class you should be able to:

    - **Justify** when to distribute a system (scale, fault tolerance, latency, isolation) and **list** what it costs.
    - **Classify** failures with the standard failure models (crash, omission, timing, Byzantine, gray) and **recognise** the 8 fallacies of distributed computing in a design.
    - **Explain** why a caller cannot tell a slow node from a dead one, and **design** retried operations to be **idempotent** (idempotency keys, conditional writes).
    - **Compare** replication models and consistency models (linearizable → causal → read-your-writes → eventual) and **choose** one per data domain.
    - **Apply** CAP and PACELC to justify a trade-off between consistency, availability and latency.
    - **Size** a consensus cluster (Raft, quorums `R + W > N`) and **explain** leader election, split brain and fencing.
    - **Choose** between two-phase commit and a saga (with compensations, reservations and an outbox) for an operation that spans several services.
    - **Order** events across machines without trusting wall clocks (Lamport, vector and hybrid clocks, TrueTime).

## Roadmap

1. **This overview** — why distribute, what it costs, failure models, the unreliable network (8 fallacies), timeouts, delivery semantics and **idempotency**.
2. [Replication & Consistency](consistency/index.md) — single-leader, multi-leader and leaderless replication; the consistency spectrum from linearizable to eventual; session guarantees such as read-your-writes.
3. [CAP & PACELC](cap-pacelc/index.md) — the consistency-versus-availability choice during a partition, the latency-versus-consistency choice the rest of the time, and multi-region designs.
4. [Consensus & Quorums](consensus/index.md) — majorities, Raft (election and log replication), `R + W > N`, leases and fencing tokens, and the tools that do it for you.
5. [Distributed Transactions](transactions/index.md) — atomicity across services: two-phase commit and why it blocks, sagas with compensations, try–confirm–cancel reservations, and the transactional outbox.
6. [Time & Clocks](time-clocks/index.md) — NTP and clock drift, Lamport and vector clocks, hybrid logical clocks, TrueTime, and how to order events in practice.
7. [Quiz](quiz.md) — check your understanding.

## Slides

<div class="slides-embed">
  <iframe src="slides/distributed.html" title="Slides: distributed systems" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/distributed.html){:target="_blank"}

---

## Why distribute? { #why-distribute }

Nobody distributes a system for fun: a single process with a single database is easier to write, test, debug and reason about. We pay the price of distribution only when one machine can no longer deliver a **non-functional requirement**:

| Reason | What one machine cannot do | In BoxOffice |
|---|---|---|
| **Scalability** | Serve more requests, store more data or run more computation than its CPU, memory, disk or network card allow | 2 M fans in the first minute of an on-sale; one server cannot even accept that many TLS connections |
| **Fault tolerance / availability** | Survive its own failure — a disk, a power supply, a kernel panic, a deploy gone wrong | If the only `inventory` machine dies at 10:00:05, the sale stops |
| **Latency** | Be close to every user; light in fibre needs ~100 ms to cross half the planet (~20,000 km) one way | Fans in Lisbon and in São Paulo both expect a fast seat map |
| **Isolation and organisation** | Let teams deploy independently, or contain a failure to one part of the product | A bug in `search` should not stop `payment` |
| **Data residency** | Keep personal data in a jurisdiction (e.g. LGPD in Brazil, GDPR in Europe) | European fans' data stays in an EU region |

Vertical scaling — a bigger machine — is the first answer and often the right one for a while. It stops working for three reasons: there is a largest machine you can buy; the price grows faster than the capacity at the top end; and, however big it is, it is still **one** machine — a single point of failure (SPOF).

??? question "Think first: if one machine is simpler, why not run BoxOffice on the largest server money can buy?"

    It would probably handle the **average** day. But (1) the 10:00 on-sale peak is orders of magnitude above the average, and the machine would be idle (and paid for) the rest of the time; (2) any failure — hardware, operating system, a bad deploy — takes the **whole** company offline, which violates any reasonable availability target; (3) fans far away from that machine pay the round-trip time on every request. You still use vertical scaling for components that are hard to split (a primary database), but you add replicas and spread stateless work across many machines.

### At scale, failure is the norm

The second argument hides a paradox: distributing for fault tolerance means using **more** machines, and more machines means **more failures**. If each machine fails on a given day with a small probability $p$, independently, the probability that **at least one** of $N$ machines fails that day is $1 - (1-p)^N$:

```python exec="1" html="1"
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "xtick.color": "#888",
                     "ytick.color": "#888", "axes.edgecolor": "#888", "font.size": 10})

nodes = np.logspace(0, 4, 200)          # 1 to 10,000 machines
fig, ax = plt.subplots(figsize=(8, 3.6))
for p, color in [(0.0001, "#1e9e5a"), (0.001, "#2f6fed"), (0.01, "#e5484d")]:
    ax.plot(nodes, 1 - (1 - p) ** nodes, color=color, lw=2,
            label=f"each machine fails with p = {p:g} per day")
ax.set_xscale("log")
ax.set_xlabel("number of machines")
ax.set_ylabel("P(at least one failure today)")
ax.set_ylim(0, 1.02)
ax.grid(alpha=0.25)
ax.legend(frameon=False, loc="upper left")
for n in (3, 30, 300, 3000):
    ax.axvline(n, color="#888", lw=0.6, ls=":")
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True, bbox_inches="tight")
print(buf.getvalue())
plt.close()
```

With an (illustrative) 0.1% chance of failure per machine per day, three machines see a failure on about 0.3% of days, but a fleet of 3,000 machines sees **at least one failure on about 95% of days**. Google's early reports describe exactly this experience: at fleet scale, hardware failures are a daily routine, not an exception[^3]. The conclusion shapes the rest of the course: **a distributed system must treat failure as a normal event and keep working through it** — it cannot hope to avoid it.

### What distribution costs

| Cost | Why | Where it comes back in the course |
|---|---|---|
| **Partial failure** | Some nodes work while others do not; every call can fail on its own | [Failure models](#failure-models), [Reliability](../reliability/index.md) |
| **Unreliable network** | Messages are lost, delayed, duplicated, reordered | [The network is unreliable](#network), [Idempotency](#idempotency) |
| **No global clock** | Each node has its own clock, and they disagree | [Time & Clocks](time-clocks/index.md) |
| **Consistency** | Copies of the same data can diverge | [Replication & Consistency](consistency/index.md), [CAP](cap-pacelc/index.md) |
| **Coordination** | Agreeing on anything (a leader, a lock, an order, a commit) needs messages and majorities | [Consensus](consensus/index.md), [Distributed Transactions](transactions/index.md) |
| **Operations** | More processes to deploy, observe and debug | [Observability](../observability/index.md), [Cloud-native](../cloud-native/index.md) |

---

## BoxOffice is a distributed system

Follow one click on **"Hold seat A-12"** through BoxOffice. Every arrow is a message over the network; every box is a process that can fail, pause or slow down on its own:

``` diagram-sim
flowchart LR
    fan([Fan's phone]) -->|"POST /holds"| gw[gateway]
    gw -->|"validate token"| auth[auth]
    gw -->|"forward"| inv[inventory]
    inv -->|"UPDATE seat ... (transaction)"| pg[("PostgreSQL primary")]
    pg -->|"replicate WAL"| rep[("PostgreSQL replica")]
    inv -->|"cache seat map"| redis[("Redis")]
    inv -->|"SeatHeld event"| kafka[["Kafka (3 brokers)"]]
    kafka -->|"consume"| notif[notification]
```

Nothing in that picture shares memory or a clock. If Redis is slow, `inventory` waits; if the replica lags, a read from it is stale; if Kafka is unreachable, the hold may be committed in PostgreSQL but the `SeatHeld` event never published. Each of these is a **partial failure**, and the rest of this page is about naming them precisely.

---

## Failure models { #failure-models }

A **failure model** states what a faulty component may do. It matters because every algorithm is only correct *under* some model: a protocol that tolerates crashes can be fooled by a node that lies.

| Model | What the faulty node (or link) does | Example in BoxOffice | Typical defence |
|---|---|---|---|
| **Crash-stop** | Halts and never comes back | A VM is terminated | Replicas + failover |
| **Crash-recovery** | Halts, later restarts with what it had on disk | An `inventory` pod is OOM-killed and restarted | Durable logs; idempotent replays |
| **Omission** | Silently drops some messages it should send or receive | A full socket buffer drops the `SeatHeld` event | Acknowledgements, retries, timeouts |
| **Timing (performance)** | Responds, but too late | A 3-second garbage-collection pause in `payment` | Timeouts, hedging, circuit breakers |
| **Byzantine** | Behaves arbitrarily: corrupts, lies, equivocates | A bit flip corrupts a message; a compromised client forges tickets | Checksums, signatures, validation; BFT protocols (3f + 1 nodes) |
| **Gray failure** | Looks healthy to the health check but fails for users | `/health` returns 200 while every real query times out | Health checks that exercise the real path; client-side signals |

Two more ideas complete the vocabulary:

- **Partial failure**: on one machine, a program usually works or crashes as a whole. In a distributed system, part of it fails while the rest keeps running, and *nobody has a complete view* of which part. Gray failures, studied by Microsoft in Azure, are the worst case — the system's own monitoring disagrees with its users[^4].
- **Timing assumptions**: in a *synchronous* model, messages and processing have known upper bounds; in an *asynchronous* model, there are no bounds at all. Real networks are **partially synchronous**: they behave well most of the time, with occasional unbounded delays (a congested switch, a GC pause, a VM migration). Practical algorithms (Raft, for example) are designed to be **safe** under asynchrony and to make **progress** only when the network behaves.

!!! info "The most common failure is not a crash"
    Crashes are easy: the process is gone, connections are refused, the orchestrator restarts it. The failures that hurt in production are **slow** responses, **partial** failures and **gray** failures — the node is there, answering some requests, holding your threads.

---

## The network is unreliable { #network }

### The 8 fallacies of distributed computing

In the 1990s, L. Peter Deutsch and colleagues at Sun Microsystems listed the assumptions that newcomers to distributed systems make — all of them false[^5]:

| Fallacy | Reality | In BoxOffice |
|---|---|---|
| 1. The network is reliable | Packets are dropped, links fail, switches reboot | The `inventory → PostgreSQL` connection resets mid-transaction |
| 2. Latency is zero | Same data centre ≈ 0.5 ms round trip; across continents ≈ 150 ms[^6] | Six sequential service calls of 30 ms each make a 180 ms checkout |
| 3. Bandwidth is infinite | Links saturate, especially at peaks | Returning the full 60,000-seat map as JSON to 2 M fans |
| 4. The network is secure | Traffic can be read, modified or forged | Services trust any caller inside the cluster |
| 5. Topology doesn't change | Nodes come and go; IPs change | A Kubernetes pod is rescheduled with a new IP during the on-sale |
| 6. There is one administrator | Many teams, accounts, providers and policies | The payment provider changes a TLS setting on their side |
| 7. Transport cost is zero | Serialisation costs CPU; cloud egress costs money | Cross-zone traffic on the monthly bill |
| 8. The network is homogeneous | Different protocols, versions, encodings | Java services, a Python `assistant`, Kafka's binary protocol |

Every one of them shows up in later classes: fallacy 1 in [Reliability](../reliability/index.md), 2 in [Estimation](../estimation/index.md), 3 in [Traffic & Edge](../edge/index.md), 4 in [Network & Security](../network-security/index.md), 5 in [Cloud-native](../cloud-native/index.md).

### Slow or dead? { #slow-or-dead }

When `inventory` sends a request to `payment` and no reply arrives, it **cannot know** which of these happened:

``` diagram-sim
sequenceDiagram
    participant I as inventory
    participant P as payment
    I->>P: authorise R$ 450 (request 1)
    Note over I,P: (a) request lost  (b) payment crashed<br/>(c) reply lost  (d) payment just slow
    I-->>I: no reply after 2 s: timeout
    I->>P: authorise R$ 450 (retry)
    P-->>I: OK
    Note over I,P: in cases (c) and (d) the fan was charged twice
```

From the caller's side, a lost request, a crashed server, a lost reply and a very slow server all look the same: **silence**. The only practical tool is a **timeout** — after a deadline, *assume* failure. But a timeout does not tell you whether the operation ran, so two things follow:

1. **Choosing the timeout is a trade-off.** Too long and the caller's threads pile up waiting (the cascading failure of [Reliability](../reliability/index.md)); too short and you declare healthy-but-slow nodes dead, retry, and add load exactly when the system is struggling. A common starting point is slightly above the downstream's p99.9 latency, within the caller's own latency budget. Systems such as Cassandra and Akka go further and use *adaptive* failure detectors (the φ accrual detector) that learn the normal distribution of heartbeat delays[^7].
2. **Retries must be safe.** If the retry can apply the operation a second time, it must be harmless to do so — the operation must be **idempotent**.

---

## Delivery semantics and idempotency { #idempotency }

### At most once, at least once, exactly once

Whenever a message crosses an unreliable network, the sender chooses a **delivery semantics**:

| Semantics | How | Risk | Use for |
|---|---|---|---|
| **At most once** | Send once, never retry | Messages lost | Metrics samples, "fan is typing…" signals |
| **At least once** | Retry until acknowledged | Duplicates | Almost everything: orders, events, e-mails |
| **Exactly once** | Not achievable by the network alone | — | Obtained as **at least once + idempotent processing** ("effectively once") |

"Exactly-once delivery" over an unreliable network is impossible in general — the sender can never be sure the receiver did not process a message whose acknowledgement was lost. What systems such as Kafka call *exactly-once* is exactly-once **processing**: duplicates may arrive, but their **effect** is applied once, through deduplication or transactions[^8]. The [Messaging](../messaging/index.md) class covers this in depth.

### Idempotent operations

An operation is **idempotent** if applying it several times has the same effect as applying it once: $f(f(x)) = f(x)$.

| Operation | Idempotent? | Why |
|---|---|---|
| `GET /events/42` | Yes | Reads change nothing |
| `PUT /holds/A-12 {fan: 42}` | Yes | Sets the state to a value; repeating sets the same value |
| `DELETE /holds/A-12` | Yes | The hold is gone after the first call; the second may return `404`, but the **state** is the same |
| `POST /orders` | **No** | Each call creates a new order |
| `UPDATE seats SET sold = sold + 1` | **No** | Each call increments again |
| `UPDATE seats SET status = 'HELD', fan = 42 WHERE id = 'A-12' AND status = 'FREE'` | Yes | A **conditional write**: the second call matches no row |

Two techniques make non-idempotent operations safe to retry:

1. **Rewrite it as a state transition with a condition** (*compare-and-set*): "set the seat to HELD **if** it is FREE", "set version 8 **if** the current version is 7". A duplicate fails the condition and changes nothing.
2. **Idempotency keys**: the client generates a unique key per *intended* operation and sends it with every attempt; the server stores the key with the result and, on a duplicate, returns the stored result instead of executing again. Stripe's public API popularised the `Idempotency-Key` header[^9], and there is an IETF draft standardising it.

``` diagram-sim
sequenceDiagram
    participant F as Fan's app
    participant O as order
    participant DB as PostgreSQL
    F->>O: POST /orders, Idempotency-Key: 7f3a…
    O->>DB: INSERT key 7f3a… (unique) + order 981
    DB-->>O: committed
    O--xF: 201 Created (reply lost on the train)
    F->>O: retry: POST /orders, Idempotency-Key: 7f3a…
    O->>DB: INSERT key 7f3a…
    DB-->>O: unique violation: key exists
    O->>DB: SELECT stored response for 7f3a…
    O-->>F: 201 Created, order 981 (same order, no duplicate)
```

The key and the business change must be stored **in the same transaction**; otherwise a crash between the two writes reopens the window for duplicates:

```sql title="idempotency.sql"
CREATE TABLE idempotency_keys (
    key           UUID PRIMARY KEY,
    request_hash  TEXT        NOT NULL,   -- reject the same key with a different body
    response      JSONB,                  -- what we answered the first time
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

BEGIN;
INSERT INTO idempotency_keys (key, request_hash)
VALUES ('7f3a…', 'sha256:…')
ON CONFLICT (key) DO NOTHING;            -- 0 rows inserted → duplicate: return stored response
INSERT INTO orders (id, fan_id, total) VALUES (981, 42, 450.00);
UPDATE idempotency_keys SET response = '{"orderId": 981}' WHERE key = '7f3a…';
COMMIT;
```

!!! example "BoxOffice: holding a seat safely"
    The app generates a UUID when the fan taps **Hold seat** and reuses it for every retry of that tap. `inventory` executes `UPDATE seats SET status = 'HELD', fan_id = :fan, hold_key = :key WHERE id = :seat AND (status = 'FREE' OR hold_key = :key)`. The first attempt holds the seat; a retry with the same key matches the row again and changes nothing; a **different** fan's request matches no row and gets `409 Conflict`. The `payment` adapter forwards the same key to the external provider, so a retried charge is not charged twice ([Integrations](../compute/integrations/index.md)).

!!! example "In the BoxOffice code: a conditional write and an idempotency key (labs 6 and 9)"

    Both techniques are in the labs. [Hands-on 6 — Holds](../../hands-on/6/holds/index.md) takes a seat with a **conditional write**: the `UPDATE` matches only if the seat is still `AVAILABLE` and still at the `version` that was read, so a second transaction changes 0 rows and gets `409`. In a test run of that lab, the naive check-then-act version double-booked **9 seats**; this one, **0**. Note what the lab does *not* do: a retried hold generates a new hold id, so the fan gets `409` for her own seat instead of her first hold back — the `hold_key` of the box above is the step that makes the hold itself idempotent.

    ``` { .java title="services/inventory/src/main/java/boxoffice/inventory/HoldService.java (compare-and-set)" }
    --8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/java/boxoffice/inventory/HoldService.java:97:113"
    ```

    [Hands-on 9 — Payment](../../hands-on/9/payment/index.md) uses an **idempotency key**: `order` sends `Idempotency-Key: order-<id>` on every attempt, `payment` returns the stored result when it has seen the key, and forwards the same key to the provider. The provider call cannot sit inside a database transaction (it may take seconds), so the key is checked before and stored after it, under a `UNIQUE` constraint; the window between the two is covered because the provider deduplicates by the same key.

    ``` { .java title="services/payment/src/main/java/boxoffice/payment/PaymentService.java (the key)" }
    --8<-- "docs/2027.1/hands-on/9/code/services/payment/src/main/java/boxoffice/payment/PaymentService.java:22:38"
    ```

??? question "Think first: the fan's retry arrives at a different `order` replica than the first attempt. Does the idempotency key still work?"

    Only if the deduplication state is **shared** — stored in the database (as above) or in a shared store such as Redis, not in the memory of one replica. A per-replica in-memory set of "seen keys" breaks as soon as the load balancer sends the retry elsewhere, which is the normal case. Keys also need a retention period (Stripe keeps them for 24 hours) long enough to cover every retry the client can make.

---

## Putting it together: the concept map { #concept-map }

The three root problems — **partial failure**, an **unreliable network**, and **no global clock** — explain almost every design decision in the rest of the course. The map below connects each problem to the techniques of this class (blue), to the subpage that teaches it, and to the **palette components** where you will meet it in the playground (green):

``` diagram
flowchart LR
    PF["Partial failure"]:::problem --> REP["Replication<br/>(keep copies)"]
    NET["Unreliable network"]:::problem --> IDEM["Timeouts, retries,<br/>idempotency"]
    CLK["No global clock"]:::problem --> ORD["Ordering:<br/>logical / hybrid clocks"]
    REP --> CM["Consistency models<br/>linearizable … eventual"]
    CM --> CAP["CAP / PACELC<br/>C vs A, L vs C"]
    CAP --> CONS["Consensus, quorums,<br/>fencing"]
    IDEM --> TX["Sagas, outbox,<br/>2PC"]
    CONS --> TX
    ORD --> CONS
    REP -.-> sql["sql · nosql"]:::comp
    CM -.-> cache["cache · cdn"]:::comp
    CONS -.-> kafka["kafka · scheduler"]:::comp
    IDEM -.-> pay["payment · queue"]:::comp
    TX -.-> stream["stream · kafka"]:::comp
    CAP -.-> dns["dns (multi-region)"]:::comp
    classDef problem fill:#e5484d22,stroke:#e5484d
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
    class REP,IDEM,ORD,CM,CAP,CONS,TX tech
```

| Technique | Taught in | Palette components where it shows up | Other classes that build on it |
|---|---|---|---|
| Timeouts, retries, idempotency keys | [this overview](#idempotency) | [`payment`](../../reference/components/external/index.md#payment), [`thirdparty`](../../reference/components/external/index.md#thirdparty), [`queue`](../../reference/components/messaging/index.md#queue) | [Reliability](../reliability/index.md), [Compute — integrations](../compute/integrations/index.md) |
| Replication, consistency models | [Replication & Consistency](consistency/index.md) | [`sql`](../../reference/components/storage/index.md#sql), [`nosql`](../../reference/components/storage/index.md#nosql), [`cache`](../../reference/components/storage/index.md#cache), [`cdn`](../../reference/components/edge/index.md#cdn) | [Databases — replication](../databases/replication/index.md), [Caching](../caching/index.md) |
| CAP, PACELC, multi-region | [CAP & PACELC](cap-pacelc/index.md) | [`dns`](../../reference/components/edge/index.md#dns), [`sql`](../../reference/components/storage/index.md#sql), [`nosql`](../../reference/components/storage/index.md#nosql) | [Reliability](../reliability/index.md), [Traffic & Edge](../edge/index.md) |
| Consensus, quorums, leases, fencing | [Consensus & Quorums](consensus/index.md) | [`kafka`](../../reference/components/messaging/index.md#kafka), [`scheduler`](../../reference/components/compute/index.md#scheduler), [`sql`](../../reference/components/storage/index.md#sql) (failover) | [Cloud-native — Kubernetes](../cloud-native/kubernetes/index.md) (etcd), [Databases — partitioning](../databases/partitioning/index.md) |
| 2PC, sagas, outbox, reservations | [Distributed Transactions](transactions/index.md) | [`stream`](../../reference/components/messaging/index.md#stream), [`kafka`](../../reference/components/messaging/index.md#kafka), [`payment`](../../reference/components/external/index.md#payment) | [Messaging — patterns](../messaging/patterns/index.md), [Case study: payment system](../case-studies/payment-system/index.md) |
| Clocks, ordering, unique ids | [Time & Clocks](time-clocks/index.md) | [`kafka`](../../reference/components/messaging/index.md#kafka), [`sql`](../../reference/components/storage/index.md#sql), [`scheduler`](../../reference/components/compute/index.md#scheduler) | [Messaging — Kafka](../messaging/kafka/index.md), [Case study: URL shortener](../case-studies/url-shortener/index.md) |

!!! tip "In the interview"
    You will rarely be asked "what is a distributed system?". You will be asked "the client times out — what happens?" or "how do you avoid charging twice?". Strong answers: (1) name the ambiguity (*"a timeout doesn't tell me whether the charge happened"*); (2) make the operation **idempotent** with an idempotency key stored atomically with the result; (3) retry with backoff and jitter only at one layer; (4) state the delivery semantics explicitly (*"at-least-once delivery, effectively-once processing"*). Saying "exactly-once delivery" without qualification is a red flag for interviewers.

!!! success "Best practices"

    - **Set a timeout on every remote call, shorter than the caller's own deadline** — so the caller can still answer, or try elsewhere, before its own client gives up. In BoxOffice: `order` waits at most 1 s for `payment` (lab 9); the edge waits at most 5 s for a replica (lab 3).
    - **Send an idempotency key with every write that may be retried, and store it under a `UNIQUE` constraint** — the database, not the memory of one replica, decides what is a duplicate. In BoxOffice: `payments.idempotency_key` ([Hands-on 9 — Payment](../../hands-on/9/payment/index.md)).
    - **Retry at one layer only, with exponential backoff, jitter and a cap** — retries at three layers turn one slow call into 27, exactly when the callee is struggling.
    - **Give every request an id at the edge and log it at every hop** — the only way to follow one click across machines that share no memory. In BoxOffice: `X-Request-Id` set by Nginx in [lab 3](../../hands-on/3/index.md).
    - **Test every consumer by delivering each message twice** — at-least-once delivery will do it in production; the test makes sure the effect is applied once.

!!! warning "Pitfalls"
    - **Treating a remote call like a local function call** — no timeout, no retry policy, no thought about partial failure.
    - **Retrying non-idempotent operations** (`POST`, increments) without a key: duplicates, double charges, double-sold seats.
    - **Deduplicating in memory** on one replica: the retry goes to another replica.
    - **Health checks that lie**: `/health` returns `200` because the process is alive, while every request fails (gray failure).
    - **Assuming failures are independent**: replicas in the same rack, zone or with the same bad configuration fail together.

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - Distribute for **scale, fault tolerance, latency, isolation or data residency** — and only then: you pay with partial failures, an unreliable network and no global clock.
    - At scale, **failure is the normal case**: $1-(1-p)^N$ approaches 1 quickly.
    - Know the **failure models**; the dangerous ones in practice are **slow**, **partial** and **gray** failures, not clean crashes.
    - A caller cannot distinguish **slow from dead**: use timeouts, and accept that a timed-out operation may have happened.
    - Exactly-once **delivery** is impossible; build **at-least-once delivery + idempotent processing** with conditional writes or idempotency keys stored atomically.

## What breaks next { #what-breaks-next }

BoxOffice now has the vocabulary to survive the network between its machines — timeouts, idempotent retries, one consistency model per data domain, consensus to choose the primary. It has not yet decided **who receives the traffic**. At 10:00:00 two million phones send a request in the same second: about **100,000 requests/s** at the edge ([the estimate](../estimation/numbers/index.md)), while one `catalog` instance measured in lab 2 keeps its p99 target only up to a few hundred requests per second. Most of those requests must end before any service, the rest must reach a healthy replica, and bots must not get there first: [class 4 — Traffic & Edge](../edge/index.md).

## Related

- **Playground:** [System Design Playground](../../../playground/index.md) — every component in this course can fail; turn on chaos (`data-chaos`) in any scenario.
- **Hands-on:** [Hands-on 7 — Async](../../hands-on/7/index.md) (idempotent consumer, outbox), [Hands-on 9 — Resilience & chaos](../../hands-on/9/index.md) (timeouts, retries, fault injection with Toxiproxy).
- **Exercises:** [Event-driven](../../exercises/event-driven/index.md) (idempotent consumer), [Design doc](../../exercises/design-doc/index.md).
- **Case studies:** [Ticketing (BoxOffice flash sale)](../case-studies/ticketing/index.md), [Payment system](../case-studies/payment-system/index.md), [Distributed cache](../case-studies/distributed-cache/index.md).
- **Classes:** [Estimation](../estimation/index.md) (latency numbers), [Databases — replication](../databases/replication/index.md), [Messaging — semantics](../messaging/semantics/index.md), [Reliability](../reliability/index.md).
- **Interview prep:** [Interview](../../support/interview/index.md).

---

[^1]: VAN STEEN, M.; TANENBAUM, A. S. [Distributed Systems](https://www.distributed-systems.net/){target="_blank"}, 4th ed., 2023.
[^2]: LAMPORT, L. [Email message, 28 May 1987](https://lamport.azurewebsites.net/pubs/distributed-system.txt){target="_blank"}.
[^3]: DEAN, J. [Designs, Lessons and Advice from Building Large Distributed Systems](https://www.cs.cornell.edu/projects/ladis2009/talks/dean-keynote-ladis2009.pdf){target="_blank"}. LADIS keynote, 2009.
[^4]: HUANG, P. et al. [Gray Failure: The Achilles' Heel of Cloud-Scale Systems](https://www.microsoft.com/en-us/research/publication/gray-failure-achilles-heel-cloud-scale-systems/){target="_blank"}. HotOS, 2017.
[^5]: [Fallacies of distributed computing](https://en.wikipedia.org/wiki/Fallacies_of_distributed_computing){target="_blank"} — Wikipedia (Deutsch, 1994; Gosling added the eighth in 1997).
[^6]: [Latency Numbers Every Programmer Should Know](https://gist.github.com/jboner/2841832){target="_blank"} — after Jeff Dean and Peter Norvig.
[^7]: HAYASHIBARA, N. et al. [The φ Accrual Failure Detector](https://doi.org/10.1109/RELDIS.2004.1353004){target="_blank"}. IEEE SRDS, 2004.
[^8]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2nd ed. O'Reilly. Chapters on replication, transactions and stream processing.
[^9]: STRIPE. [Idempotent requests](https://docs.stripe.com/api/idempotent_requests){target="_blank"}. Stripe API reference.
