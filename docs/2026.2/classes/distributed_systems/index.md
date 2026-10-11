
Imagine the store you will build in this course running as a single Spring Boot application with one PostgreSQL database on one machine. It is simple to reason about — until traffic grows beyond what that machine can handle, or the machine dies and the whole store goes down with it. The moment you split the work across several machines (a gateway, an account service, an order service, a database, a cache, a message broker), you have built a **distributed system**, and a new class of problems appears.

Distributed systems represent a computing paradigm where multiple independent computers collaborate to achieve a common goal, appearing as a single coherent system to the end-user[^3]. Unlike centralised systems where all processing occurs on one machine, distributed systems span networks and leverage interconnected nodes (a **node** is any independent computer or process taking part in the system) to handle data storage, computation, and communication.

This architecture underpins modern cloud platforms (AWS, Google Cloud, Azure), large-scale applications (social networks, e-commerce), and scientific simulations. The foundational challenge is that nodes operate independently, communicate only by passing messages, and have no shared clock — making coordination a non-trivial engineering problem.

!!! abstract "Learning objectives"

    By the end of this class you should be able to:

    - **Explain** what makes a system distributed and why partial failure, unreliable networks and the absence of a global clock make it hard.
    - **Identify** the 8 fallacies of distributed computing in a concrete design, such as a call between two microservices.
    - **Explain** how logical clocks (Lamport) order events without a shared physical clock.
    - **Choose** between consistency and availability for a given data domain using CAP and PACELC.
    - **Describe** how Raft elects a leader and replicates a log with majority quorums, and size a cluster for a given number of failures.
    - **Compare** strong consistency (quorums, consensus) with eventual consistency (LWW, vector clocks, CRDTs).

## Roadmap

1. **This overview** — what a distributed system is, why we build them, what they cost, and the three root problems (partial failure, unreliable network, no global clock).
2. [CAP Theorem](cap/index.md) — the consistency-versus-availability choice during a network partition, and its PACELC extension.
3. [Consensus & Algorithms](consensus/index.md) — how nodes agree on a value despite failures: FLP, failure models, Paxos, Raft, quorums and CRDTs.
4. [Quiz](quiz.md) — check your understanding.

## Slides

<div class="slides-embed">
  <iframe src="slides/distributed-systems.html" title="Slides: distributed systems" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/distributed-systems.html){:target="_blank"}

---

## Our store is a distributed system

A single click on **"Place order"** in the store already crosses the network several times. Follow the request:

``` mermaid-sim
flowchart LR
    user([Browser]) -->|POST /orders| gw[Gateway]
    gw -->|validate token| auth[Auth service]
    gw -->|forward| order[Order service]
    order -->|check stock| product[Product service]
    product -->|cached price| redis[(Redis)]
    order -->|INSERT order| pg[(PostgreSQL)]
    order -->|OrderCreated| kafka[[Kafka]]
```

Each arrow is a message over the network, and each box is a process that can fail on its own. If the product service is slow, the order service waits; if Kafka is down, the order may be stored but the event never published. Nothing in this picture shares memory or a clock — the services cooperate only by exchanging messages. That is exactly the definition of a distributed system, and it is why the rest of this class matters for the [project](../../exercises/project/index.md).

---

## Classification

Distributed systems can be classified along several axes:

| Dimension | Option A | Option B |
|---|---|---|
| **Hardware/software uniformity** | Homogeneous — all nodes run the same stack | Heterogeneous — diverse hardware and OS |
| **Coupling** | Tightly coupled — high interdependence, shared memory | Loosely coupled — communicate via messages, independent lifecycle |
| **Topology** | Client-server — hierarchical, servers hold resources | Peer-to-peer — egalitarian, all nodes share resources |

Web applications follow the client-server model (browsers request from servers). File-sharing systems like BitTorrent follow peer-to-peer. Most microservice architectures occupy the loosely-coupled middle ground: our store is **heterogeneous** (Java services, a Python notification service, PostgreSQL, Redis, Kafka), **loosely coupled** (services talk over HTTP and Kafka) and **client-server** (the browser calls the gateway, the gateway calls the services).

---

## Advantages

| Benefit | How |
|---|---|
| **Horizontal scalability** | Add nodes instead of upgrading a single machine. Cassandra scales to petabytes by adding nodes seamlessly. |
| **Fault tolerance** | Replication across nodes keeps the system running despite individual failures. Google Spanner uses synchronous cross-datacenter replication. |
| **Resource sharing** | Idle capacity from many machines is pooled. Folding@home aggregates CPU cycles for scientific workloads. |
| **Parallelism** | Tasks are divided and processed concurrently. MapReduce (Hadoop) exemplifies this for big-data analytics. |
| **Latency reduction** | Nodes placed near users reduce round-trip time. CDNs like Akamai serve content from the nearest edge location. |

In the store, horizontal scalability is what [Hands-on 7](../../hands-on/7/index.md) does with Nginx in front of several replicas of a service, and latency reduction is what the Redis cache of [Hands-on 8](../../hands-on/8/index.md) provides.

---

## Disadvantages

| Challenge | Root cause |
|---|---|
| **Complexity** | Coordination, synchronisation, and distributed state are hard to reason about and implement correctly. |
| **Network overhead** | Messages can be delayed, lost, or duplicated. Every failure mode must be handled explicitly. |
| **Consistency vs availability** | During a network partition, a replicated data store cannot be both consistent and available — see the [CAP Theorem](cap/index.md). |
| **Expanded attack surface** | More nodes mean more entry points. Byzantine faults (malicious nodes) require dedicated protocols. |
| **Operational cost** | Debugging, monitoring, and deploying distributed systems requires specialised tooling (Prometheus, Kubernetes, distributed tracing). |

### The 8 Fallacies of Distributed Computing

L. Peter Deutsch and colleagues at Sun Microsystems[^2] listed the assumptions developers commonly make when building distributed systems — all of them wrong (the list had seven items in 1994; James Gosling added the eighth, *the network is homogeneous*, in 1997):

| Fallacy | Reality | In the store |
|---|---|---|
| The network is reliable | Packets are dropped, links fail, cables are cut | The call from order to product fails halfway |
| Latency is zero | Network round-trips add milliseconds; cross-region adds hundreds | Five sequential calls of 40 ms each make a 200 ms checkout |
| Bandwidth is infinite | Transferring large payloads saturates links | Returning the whole catalogue in one response |
| The network is secure | Traffic must be encrypted and authenticated at every hop | Services trust any caller inside the cluster |
| Topology doesn't change | Nodes go up and down; IPs change; services are rescheduled | A Kubernetes pod is rescheduled with a new IP |
| There is one administrator | Multiple teams, multiple cloud accounts, multiple policies | Another team changes a firewall rule |
| Transport cost is zero | Serialisation, compression, and egress fees are real | JSON parsing and cross-zone traffic on the cloud bill |
| The network is homogeneous | Different systems speak different protocols and encodings | Java services, a Python service, Kafka's binary protocol |

!!! warning "Design for failure, not against it"
    These fallacies share a common root: treating the network as a reliable local function call. The correct posture is to assume failure will happen and design every interaction to degrade gracefully.

---

## The three root problems

Almost every difficulty in this course traces back to three facts.

### 1. Partial failure

On a single machine, a program either works or crashes as a whole. In a distributed system, **part** of the system can fail while the rest keeps running: the product service is down but the gateway and the order service are fine. Each component must decide what to do when one of its dependencies stops answering.

### 2. An unreliable network: slow or dead?

When the order service sends a request and gets no reply, it **cannot know** what happened. Consider the possibilities:

``` mermaid-sim
sequenceDiagram
    participant O as Order service
    participant P as Product service
    O->>P: reserve 1 unit of product 42
    Note over O,P: request lost? P crashed? reply lost? P just slow?
    O-->>O: timeout after 2 s
    O->>P: retry: reserve 1 unit of product 42
    P-->>O: OK (but was the first one applied too?)
```

From the caller's point of view, a lost request, a crashed server, a lost reply and a very slow server all look the same: **silence**. The only practical tool is a **timeout** — after a deadline, assume failure. But a timeout does not tell you whether the operation was executed, so a retry may apply it **twice**. That is why operations that may be retried must be **idempotent** (applying them twice has the same effect as applying them once — for example, by sending a unique request id that the server deduplicates). Timeouts, retries with backoff and circuit breakers are covered in [Resilience Patterns](../reliability/patterns/index.md).

### 3. No global clock

Each machine has its own quartz clock, and clocks **drift**: two servers synchronised with NTP (Network Time Protocol) can still disagree by milliseconds, and much more after a misconfiguration or a VM pause. So you cannot reliably order two events on different machines by comparing their wall-clock timestamps — an order created "at 10:00:00.120" on one node may actually have happened *after* a cancellation stamped "10:00:00.150" on another.

---

## Time and ordering: logical clocks

Leslie Lamport[^1] observed that, for most purposes, we do not need the *real* time of events — we need their **order**, and specifically the *happened-before* relation (→):

- if *a* and *b* happen in the same process and *a* comes first, then *a* → *b*;
- if *a* is the sending of a message and *b* its receipt, then *a* → *b*;
- if *a* → *b* and *b* → *c*, then *a* → *c*.

Two events where neither happened-before the other are **concurrent**: neither could have influenced the other.

A **Lamport clock** is a counter kept by each process, updated with three rules:

1. Before each local event, increment the counter.
2. When sending a message, attach the current counter value.
3. When receiving a message with value *t*, set the counter to `max(local, t) + 1`.

``` mermaid-sim
sequenceDiagram
    participant A as Order service
    participant B as Kafka consumer
    participant C as Notification
    Note over A: create order (L=1)
    A->>B: OrderCreated (L=2)
    Note over B: receive: max(0,2)+1 = 3
    Note over C: local event (L=1)
    B->>C: SendEmail (L=4)
    Note over C: receive: max(1,4)+1 = 5
```

The guarantee is: **if *a* → *b* then L(*a*) < L(*b*)**. The converse is *not* true — a smaller Lamport timestamp does not prove that one event caused the other. **Vector clocks** fix this by keeping one counter *per process*; comparing two vectors tells you whether one event happened before the other or whether they are concurrent. They are used to detect conflicting writes in replicated databases (see [Eventual consistency](consensus/index.md#eventual-consistency-and-crdts)).

!!! example "Where you will meet ordering in the course"
    Kafka does not use wall-clock time to order messages: it assigns each message a monotonically increasing **offset** inside a partition, so all consumers see the same order for that partition ([Hands-on 9](../../hands-on/9/index.md)). Raft uses a logical counter called a **term** to tell old leaders from new ones ([Consensus](consensus/index.md#raft)).

!!! warning "Do not order events by `System.currentTimeMillis()` across machines"
    Comparing timestamps produced by different servers is a classic source of bugs, for example in "last write wins" conflict resolution: a node with a fast clock silently wins every conflict. Use a single authority for ordering (a database sequence, a Kafka partition offset) or logical clocks.

---

## Topics covered

<div class="grid cards" markdown>

-   :material-scale-balance:{ .lg .middle } **CAP Theorem**

    ---

    The central trade-off in distributed data stores: Consistency, Availability, and Partition Tolerance cannot all be guaranteed simultaneously. Understand CP, AP, and CA system classes — and the PACELC extension.

    [:octicons-arrow-right-24: CAP Theorem](cap/index.md)

-   :material-handshake:{ .lg .middle } **Consensus & Algorithms**

    ---

    How distributed nodes reach agreement despite failures. Covers Paxos, Raft, quorum systems, failure models (crash-stop, Byzantine), the FLP impossibility result, and eventual consistency.

    [:octicons-arrow-right-24: Consensus & Algorithms](consensus/index.md)

</div>

---

## Connections

- [Microservices](../microservices/index.md) — splitting the store into services is what turns it into a distributed system.
- [Event-Driven Architecture](../event_driven/index.md) and [Hands-on 9](../../hands-on/9/index.md) — asynchronous messaging with Kafka, ordered by partition offsets.
- [Reliability](../reliability/index.md) — timeouts, retries, circuit breakers: designing for partial failure.
- [Hands-on 7](../../hands-on/7/index.md) and [Hands-on 8](../../hands-on/8/index.md) — horizontal scaling behind a load balancer, and a Redis cache.
- [Hands-on 10](../../hands-on/10/index.md) — distributed tracing, to see one request crossing many services.

## Key takeaways

- A distributed system is a set of independent nodes that cooperate **only by exchanging messages** and have **no shared clock**; our store is one as soon as it has more than one service.
- We distribute for scalability, fault tolerance and latency — and pay in complexity, network failures and operational cost.
- The 8 fallacies are all false: design every remote call **for failure**.
- A caller cannot tell a slow node from a dead one: use **timeouts**, and make retried operations **idempotent**.
- Physical clocks drift; order events with a single authority or with **logical clocks** (Lamport, vector clocks).

---

[^1]: LAMPORT, L. [Time, Clocks, and the Ordering of Events in a Distributed System](https://lamport.azurewebsites.net/pubs/time-clocks.pdf){target="_blank"}. CACM, 1978.
[^2]: DEUTSCH, P. [Fallacies of Distributed Computing](https://en.wikipedia.org/wiki/Fallacies_of_distributed_computing){target="_blank"}, 1994.
[^3]: VAN STEEN, M.; TANENBAUM, A. S. [Distributed Systems](https://www.distributed-systems.net/){target="_blank"}, 4th ed., 2023.
