
Friday, 10:00. **BoxOffice**, a small ticketing start-up, opens the sale for the year's biggest stadium show: **60,000 seats, 2 million fans** refreshing the page at the same second. At 10:00:04 the site answers in 9 seconds. At 10:00:20 it answers nothing. At 10:03 it comes back — and 312 seats have been sold **twice**. The code had no bug that a unit test could catch: every function did exactly what it was written to do. What failed was the **system**: how many machines, which database, where the data lives, what waits for what, and what happens when 2 million people arrive at once.

This course is about that layer — the decisions that sit *above* the code and decide whether the code survives contact with reality. By the end of the semester you will be able to design BoxOffice so that 10:00 on Friday is a non-event, **measure** that it works, and **defend** every decision with numbers, in a design review or in a system-design interview.

!!! abstract "Learning objectives"

    By the end of this class you should be able to:

    - **Explain** what system design is, how it differs from software (code-level) design, and why it is a trade-off discipline rather than a search for the "right" architecture.
    - **Distinguish** functional from non-functional requirements and **write** measurable quality-attribute targets (scalability, availability, latency, consistency, durability, cost, security, operability) for a system.
    - **Trace** the evolution of a system from one server to millions of users, **identifying** the symptom that triggers each new component.
    - **Apply** a time-boxed framework (clarify → estimate → API & data model → high-level design → deep dives → bottlenecks & trade-offs → wrap-up) to an open-ended design problem in 45 minutes.
    - **Use** the System Design Playground to build an architecture from the component palette, load it, and read its metrics.

## Roadmap

1. **This overview** — what system design is, the component palette that organizes the course, and how to use the playground.
2. [Requirements](requirements/index.md) — functional vs non-functional requirements; the quality attributes and how to make them measurable.
3. [The Scaling Journey](scaling-journey/index.md) — BoxOffice from 1 user to 10 million: monolith first, then one component per symptom.
4. [The Interview Framework](interview-framework/index.md) — a 7-step, 45-minute method for open-ended design problems.
5. [Quiz](quiz.md) — check your understanding.

## Slides

<div class="slides-embed">
  <iframe src="slides/intro.html" title="Slides: what is system design" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/intro.html){:target="_blank"}

---

## What is system design?

**System design** is the process of defining the **components** of a system, the **interfaces** between them, and the **data** that flows through and is stored by them, so that the system satisfies its requirements — both *what* it must do and *how well* it must do it[^1]. It answers questions like:

- How many servers do we need, and what happens when one dies?
- Where does each piece of data live, who is allowed to change it, and how fast must every reader see the change?
- Which work must happen *now*, while the user waits, and which can happen *later*?
- What will this cost per month, and what breaks first if traffic doubles?

It is useful to place system design next to the design work you already know:

| Level | Typical question | Unit of design | Example from BoxOffice |
|---|---|---|---|
| **Algorithm** | How do I compute this efficiently? | function, data structure | find the best available block of 4 adjacent seats |
| **Software design** | How do I organize this code so it is easy to change? | classes, modules, packages | `OrderService` depends on a `PaymentGateway` interface |
| **System design** | How do these *running processes and machines* cooperate under load and failure? | services, databases, queues, caches, networks | inventory in PostgreSQL with row locks; catalog served from a cache and a CDN |

The jump from software design to system design is a jump from **one process** to **many processes on many machines, connected by an unreliable network**. That jump brings three new realities:

1. **Load** — the system must keep working when many users arrive at once. Ten users and ten million users need different architectures, not just more of the same.
2. **Partial failure** — some parts fail while others keep running. A disk fills, a node reboots, a third-party API slows down. The system must keep its promises anyway.
3. **Trade-offs** — almost every decision buys one quality with another. A cache buys latency with freshness; a replica buys availability with consistency; a queue buys resilience with immediacy.

!!! tip "There is no right architecture — only justified ones"

    The question "what is the best database?" has no answer. "Which database fits a seat inventory that must never double-sell, at 5,000 writes per second at peak, with a two-person team and a R$ 20k monthly budget?" has a few good answers and many bad ones. System design is the skill of turning the first kind of question into the second, then choosing — and saying out loud what you gave up.

### Why it matters to you

- **At work**, almost every feature eventually raises a system question: *Will this query be fast with 50 million rows? Should this e-mail be sent synchronously? What happens if the payment provider is down?* Engineers who can answer with numbers make better decisions and are trusted with bigger ones.
- **In interviews**, system design is a standard round for software engineering roles at most technology companies. It is open-ended on purpose: the interviewer watches *how you think* — how you clarify, estimate, structure, and handle trade-offs[^2].
- **In this course**, it is the thread that ties together everything from DNS to AI agents: each topic is a component you add to a design for a reason you can measure.

---

## BoxOffice, the running example

Every class, lab, quiz and slide deck uses the same fictional system, so that each new concept lands on a problem you already know. **BoxOffice** sells tickets for concerts, games and festivals. It was chosen because it has, on purpose, *every* hard property a real system can have — and they are intuitive:

| Property | Where it shows up in BoxOffice | Course topic |
|---|---|---|
| Extreme **spikes** | the flash sale at 10:00: 2 M fans, 60 k seats | estimation, edge, messaging, performance |
| **Read-heavy** traffic | browsing events, venues, seat maps | caching, CDN, replicas |
| **Strong consistency** | a seat can be sold exactly once | databases, distributed systems |
| **External dependencies** | payment provider, e-mail, push notifications | compute & integrations, reliability |
| **Search** | "rock shows in São Paulo next weekend" | databases (search engines) |
| **Abuse** | bots buying tickets to resell | edge (WAF, rate limiting), security |
| **Asynchronous work** | tickets by e-mail, waiting room, analytics | messaging |
| **AI** | a support assistant that answers "can I change my seat?" | AI systems |

Its services — which you will build, measure and break in the labs — are `gateway`, `auth`, `catalog` (events and venues), `inventory` (seats and holds), `order`, `payment` (adapter to an external provider), `notification`, `search` and `assistant` (AI). The code lives in the course repository, `https://github.com/repo-classes/pma271`.

This is where BoxOffice is heading by the end of the semester. Press play to follow a purchase through it:

``` mermaid-sim
flowchart LR
    fan([Fan]) --> cdn["CDN"]
    fan --> waf["WAF"]
    waf --> gw["API Gateway"]
    gw --> auth["auth"]
    gw --> catalog["catalog"]
    catalog --> cache[("Cache")]
    cache --> catdb[("SQL")]
    gw --> wr["Waiting room<br/>(queue)"]
    wr --> inventory["inventory"]
    inventory --> invdb[("SQL<br/>seats & holds")]
    inventory --> order["order"]
    order --> payment["payment"]
    payment --> psp["Payment provider<br/>(external)"]
    order --> kafka["Event stream"]
    kafka --> notification["notification"]
    notification --> email["Email / push"]
```

You do **not** need to understand every box today. The point of the course is that, by week 15, you will be able to explain why each box is there, what number would make you remove it, and what you would add next.

---

## The component palette

Real architectures are assembled from a surprisingly small set of building blocks. The course is organized around a **component palette** — the same palette the course simulator uses. Each theory class teaches one group of components: what each one does, when to use it, when *not* to, the numbers that describe it, and how it fails.

| Category | Components | Main class |
|---|---|---|
| **Client** | Client, Mobile | [1. Intro](index.md) |
| **Traffic & edge** | DNS, CDN, Load Balancer, WAF, API Gateway, Ingress | [4. Traffic & Edge](../edge/index.md) |
| **Compute** | App Server, Worker, Serverless, Auth Service, Search, Scheduler, Notifications, Analytics | [5. Compute & Services](../compute/index.md) |
| **Containers** | Microservice, Container, Kubernetes Cluster, Service Registry | [12. Cloud-Native](../cloud-native/index.md), [5. Compute & Services](../compute/services/index.md) |
| **Storage** | SQL Database, DB Cluster, NoSQL DB, Cache, Object Store, Data Warehouse, Vector DB | [6. Databases](../databases/index.md), [7. Caching](../caching/index.md) |
| **Messaging** | Message Queue, Pub/Sub, Event Stream, Kafka | [8. Messaging](../messaging/index.md) |
| **Observability** | Metrics, Logs, Tracing, Alerting, Health Check | [10. Observability](../observability/index.md) |
| **Network** | VPC, Subnet, NAT Gateway, VPN, Service Mesh | [11. Network & Security](../network-security/index.md) |
| **AI & agents** | LLM Gateway, Orchestrator, Tool Registry, Memory Fabric, Safety Mesh | [13. AI Systems](../ai-systems/index.md) |
| **External** | 3rd Party API, Payment, Email | [5. Compute & Services](../compute/index.md) |

The other classes are **cross-cutting**: they do not add boxes, they give you the tools to reason about all of them.

``` mermaid
flowchart TB
    subgraph F["Foundations"]
        direction LR
        c1["1. Intro &<br/>interview framework"] --> c2["2. Estimation &<br/>performance math"] --> c3["3. Distributed<br/>systems"]
    end
    subgraph P["The palette, one group per class"]
        direction LR
        c4["4. Edge"] --> c5["5. Compute"] --> c6["6. Databases"] --> c7["7. Caching"] --> c8["8. Messaging"]
    end
    subgraph O["Running it in production"]
        direction LR
        c9["9. Reliability"] --> c10["10. Observability"] --> c11["11. Network &<br/>security"] --> c12["12. Cloud-native"]
    end
    subgraph X["Putting it together"]
        direction LR
        c13["13. AI systems"] --> c14["14. AI-assisted<br/>delivery"] --> c15["15. Performance &<br/>load testing"] --> c16["16. Case studies"]
    end
    F --> P --> O --> X
```

Each component has an entry in the [component catalog](../../reference/components/index.md) — for example [Load Balancer](../../reference/components/edge/index.md#lb), [Cache](../../reference/components/storage/index.md#cache) or [Message Queue](../../reference/components/messaging/index.md#queue) — with a one-line interview definition, key numbers, failure modes and the real products (AWS, GCP, Azure, open source) that implement it. Use it as a dictionary while you read.

!!! info "How the semester runs"

    Every week has a **theory** meeting (a class like this one) and a **practice** meeting (a hands-on lab). The theory introduces a palette group and the reasoning behind it; the lab builds the same idea into the real BoxOffice code (Java 21 + Spring Boot, PostgreSQL, Redis, Kafka, Nginx, Kubernetes…) and **measures** it with k6. Individual exercises make you practice estimation, playground designs and load-test reports; the team project takes one system from a design document to a load-tested, observable deployment with a chaos game day.

---

## The System Design Playground

Reading about a cache is not the same as watching the p99 latency fall when its hit ratio climbs. The course comes with a simulator, the **[System Design Playground](../../../playground/index.md)**, where every component of the palette is a block you can drop on a canvas, connect, and put under load. It is a *model* — it does not run real code — but it reproduces the behaviour that matters for design: queues that grow when a component is saturated, latency that explodes near full utilization, failures that cascade when there are no timeouts, cost that grows with every replica.

The workflow is always the same:

1. **Build** — pick components from the palette and connect them (client → load balancer → app → database…).
2. **Configure** — set capacities, replicas, cache hit ratios, timeouts.
3. **Load** — choose a load profile: `smoke` (a trickle, to check it works), `load` (expected traffic), `stress` (beyond it), `spike` (a sudden jump, like 10:00 on Friday), `soak` (hours at a steady rate), `breakpoint` (ramp until something breaks), `chaos` (inject failures).
4. **Read** — watch throughput, latency percentiles (p50, p99), error rate, per-component utilization and monthly cost.
5. **Change one thing and run again.** That is the scientific method applied to architecture, and it is exactly what you will do with real systems in the labs.

Throughout the course, pages embed the playground preloaded with a scenario. Here is the first one: BoxOffice as a single application server and a single SQL database.

**Try it:** start with the `load` profile and note the p99 latency and the utilization of the app and the database. Then switch to `spike`. Which component saturates first? What happens to latency *before* errors appear? Write down the request rate at which things went wrong — you will compute it by hand in [class 2](../estimation/index.md).

<div class="sdp" data-scenario="monolith" data-mode="full" data-height="560"></div>

??? question "What did you see? (open after trying)"

    As the load approaches the capacity of the most-loaded component, latency grows slowly at first and then **explodes** — long before the error rate rises. Requests queue up in front of the saturated component; each new request waits for all the ones ahead of it. This "knee" in the latency curve is one of the most important shapes in the course: [class 2](../estimation/queueing/index.md) explains it with queueing theory, and every capacity decision you make afterwards (how many replicas? how big a connection pool?) is about staying to the left of it.

The second scenario puts a load balancer in front of several replicas of the application.

**Try it:** run the `stress` profile with 1 replica, then 2, then 4. Does throughput double each time? Watch the database: at some point adding app replicas stops helping. Why? Then kill one replica (or use the `chaos` profile) and watch what the health checks do.

<div class="sdp" data-scenario="scale-out" data-mode="compact" data-height="520"></div>

!!! example "BoxOffice — what the two scenarios teach"

    Horizontal scaling (more app servers) only helps **while the app servers are the bottleneck**. Once the single database saturates, extra replicas just queue at the database instead of at the app. The next move is not "more of the same" but a *different component*: a cache for the catalog reads, read replicas, or a queue in front of the seat inventory. Choosing which one, and proving it with numbers, is what [The Scaling Journey](scaling-journey/index.md) and the rest of the course are about.

---

## The intro concept map { #concept-map }

This class touches the whole palette lightly: every **quality attribute** (blue) is bought with some **palette components** (green), and the scaling journey adds them one measured symptom at a time. Use the map as an index to the rest of the course:

``` mermaid
flowchart LR
    client["client · mobile"]:::comp --> req["requirements:<br/>functional + quality attributes"]:::tech
    req --> scal["scalability"]:::tech
    req --> lat["latency"]:::tech
    req --> avail["availability"]:::tech
    req --> cons["consistency,<br/>durability"]:::tech
    req --> sec["security"]:::tech
    req --> ops["operability"]:::tech
    scal --> c1["lb · app replicas ·<br/>queue · worker · nosql"]:::comp
    lat --> c2["cache · cdn"]:::comp
    avail --> c3["healthcheck · dns failover"]:::comp
    cons --> c4["sql · objstore"]:::comp
    sec --> c5["waf · apigw · auth"]:::comp
    ops --> c6["metrics · logs · tracing"]:::comp
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

| Palette component | Question it answers | Concepts | Taught in | Scenarios |
|---|---|---|---|---|
| [`client`](../../reference/components/client/index.md#client) · [`mobile`](../../reference/components/client/index.md#mobile) | *Who* uses the system, and for what? | actors, functional requirements, core path, API sketch | [Requirements](requirements/index.md) | `monolith` |
| [`app`](../../reference/components/compute/index.md#app) | What runs the logic, and how do we get more of it? | one box first, stateless replicas, scale up vs out, monolith first | [The Scaling Journey](scaling-journey/index.md) (stages 0, 2, 7) | `monolith`, `scale-out` |
| [`lb`](../../reference/components/edge/index.md#lb) · [`healthcheck`](../../reference/components/observability/index.md#healthcheck) | How does a crash or a deploy stop being an outage? | single point of failure, health checks, rolling deploys | [The Scaling Journey](scaling-journey/index.md) (stage 2) | `scale-out` |
| [`sql`](../../reference/components/storage/index.md#sql) | Where does the truth live, and how fresh must readers see it? | separate database, read replicas, replication lag, strong consistency for seats | [The Scaling Journey](scaling-journey/index.md) (stages 1, 3), [Requirements](requirements/index.md) | `db-replicas` |
| [`cache`](../../reference/components/storage/index.md#cache) · [`cdn`](../../reference/components/edge/index.md#cdn) · [`objstore`](../../reference/components/storage/index.md#objstore) | How do we stop computing and sending the same bytes again? | hit ratio, TTL, invalidation, versioned file names | [The Scaling Journey](scaling-journey/index.md) (stages 4, 5) | `read-heavy-cache`, `cdn-static` |
| [`queue`](../../reference/components/messaging/index.md#queue) · [`worker`](../../reference/components/compute/index.md#worker) | What can happen *later*, and how do we survive a spike? | asynchronous work, waiting room, at-least-once, idempotent consumers | [The Scaling Journey](scaling-journey/index.md) (stage 6) | `async-queue`, `flash-sale` |
| [`apigw`](../../reference/components/edge/index.md#apigw) · [`stream`](../../reference/components/messaging/index.md#stream) | How do many teams and services share one product? | services along business boundaries, single entry point, events | [The Scaling Journey](scaling-journey/index.md) (stage 7) | `event-fanout` |
| [`nosql`](../../reference/components/storage/index.md#nosql) · [`search`](../../reference/components/compute/index.md#search) · [`dwh`](../../reference/components/storage/index.md#dwh) | What if one database is too big, too hot or wrong for the job? | partitioning, hot partitions, inverted index, analytics off the transactional database | [The Scaling Journey](scaling-journey/index.md) (stage 8) | `sharding` |
| [`waf`](../../reference/components/edge/index.md#waf) · [`dns`](../../reference/components/edge/index.md#dns) | How do we survive bots, attacks and a region outage? | bot mitigation, rate limiting, multi-region, DNS failover | [The Scaling Journey](scaling-journey/index.md) (stage 9) | `multi-region`, `flash-sale` |
| *(all of them)* | Which components, in which order, and what do they cost? | quality attributes, trade-offs, the 7-step framework | [Requirements](requirements/index.md), [The Interview Framework](interview-framework/index.md) | `flash-sale` |

---

## How to study system design

- **Draw.** Every concept in this course has a picture. If you cannot draw it, you do not understand it yet.
- **Estimate before you design.** A design for 100 requests per second and one for 100,000 are different designs. [Class 2](../estimation/index.md) gives you the numbers and formulas.
- **Name the trade-off.** For every component you add, say what it buys and what it costs: "the cache cuts catalog p99 from 80 ms to 5 ms, at the price of showing a price up to 60 s stale".
- **Break things on purpose.** In the playground and in the labs, find the breaking point, then fix it. You learn more from one saturation than from ten diagrams.
- **Practise out loud.** System design is a conversation. Use the [interview framework](interview-framework/index.md) with a classmate every week, starting now.

!!! warning "Common pitfalls when starting"

    - **Jumping to technology names** ("Kafka! Kubernetes! microservices!") before understanding the problem and its numbers.
    - **Designing for Google scale** when the problem has 1,000 users. Over-engineering is as wrong as under-engineering — and more expensive.
    - **Treating the diagram as the answer.** The boxes are the easy part; the reasoning about load, failure and trade-offs is the design.
    - **Ignoring cost and operability.** An architecture the team cannot afford or cannot operate at 3 a.m. is not a good architecture.

---

## Related

- Hands-on: [0. Environment](../../hands-on/0/index.md) (tools and the course repository) and [1. First service](../../hands-on/1/index.md) (the `catalog` API).
- Exercise: [Playground design](../../exercises/playground-design/index.md) — solve playground challenges against SLO and cost goals.
- Case study: [Ticketing — the BoxOffice flash sale](../case-studies/ticketing/index.md), the full design of the system introduced here.
- Interview: [Interview framework](../../support/interview/framework/index.md) and [practice problems](../../support/interview/problems/index.md).

## Key takeaways

- System design decides **components, interfaces and data** so that a system meets functional *and* non-functional requirements under **load** and **partial failure**.
- It is a **trade-off discipline**: every component buys one quality with another; good designs say which.
- The course is organized around a **component palette** of ten categories; each theory class teaches one group, and the [catalog](../../reference/components/index.md) is your dictionary.
- **BoxOffice** — a ticketing platform with a 10:00 flash sale — is the example everywhere.
- The **playground** lets you build, load and break architectures in minutes; the labs do the same with real code and real measurements.

---

[^1]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2nd ed. O'Reilly. Chapter 1 (trade-offs in data systems architecture).
[^2]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1. Byte Code LLC, 2020. Chapter 3 (a framework for system design interviews).
