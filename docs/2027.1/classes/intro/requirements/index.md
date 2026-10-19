
Two BoxOffice engineers receive the same request from the product team: *"We need a ticketing platform that is fast, scalable and reliable."* The first one starts drawing boxes. The second one asks: *How many events per month? How many fans at the peak of an on-sale? What does "fast" mean — for browsing or for paying? Can we ever sell the same seat twice? What happens if the payment provider is down?* Three months later the first engineer has a beautiful architecture for the wrong problem. The second has a less impressive diagram that survives 10:00 on Friday.

Requirements are the input of every design. A design can only be judged against them: "is this a good architecture?" is unanswerable; "does this architecture keep checkout p99 under 1 s with 60,000 seats and 2 million fans, without double booking, for less than R$ 40k per month?" is a question you can test.

---

## Two kinds of requirements

| | Functional requirements | Non-functional requirements |
|---|---|---|
| **Describe** | *what* the system does — features, behaviours | *how well* it does it — qualities and constraints |
| **Typical form** | "A fan can hold up to 6 seats for 10 minutes" | "Seat holds succeed in under 300 ms (p99) at 5,000 holds/s" |
| **Answered by** | use cases, APIs, data model | architecture: components, replication, caching, queues |
| **If missing** | the system does the wrong thing | the system does the right thing — for 10 users, on a good day |
| **Also called** | features, behavioural requirements | quality attributes, "-ilities", NFRs |

Functional requirements decide **which APIs and data** exist. Non-functional requirements decide **which architecture** delivers them. In system design, the non-functional side drives almost every decision: the same "sell a ticket" feature can be a single PostgreSQL table for a theatre with 200 seats, or a waiting room, a sharded inventory and an event stream for a stadium.

---

## Functional requirements

Start from **actors** (who uses the system) and their **goals**. For BoxOffice:

| Actor | Goals |
|---|---|
| **Fan** | browse and search events; see the seat map; hold seats; pay; receive the ticket; transfer or cancel |
| **Organizer** | create an event; configure venue sections and prices; schedule the on-sale; follow sales live |
| **Venue staff** | validate tickets at the gate (QR code), even with a poor network |
| **Support** | answer fans' questions (helped by the AI assistant); issue refunds |
| **External systems** | the payment provider confirms or declines charges; e-mail/push providers deliver messages |

Then turn the goals into a short, prioritized list. In practice — and in an interview — you cannot design everything, so you pick the **core path** and say explicitly what is out of scope:

!!! example "BoxOffice — functional requirements (first release)"

    **In scope (core path)**

    1. Fans **browse and search** events by city, date, artist and category.
    2. Fans see the **seat map** with live availability for an event.
    3. Fans **hold** up to 6 seats; a hold expires after 10 minutes if not paid.
    4. Fans **pay** through an external payment provider; a paid hold becomes an **order** with **tickets**.
    5. Fans **receive** tickets by e-mail and in the app.
    6. Organizers **create events** and **schedule on-sales**.

    **Out of scope (for now)**: resale marketplace, dynamic pricing, loyalty programme, gate validation offline mode, the AI assistant (added in class 13).

A good way to check that a functional requirement is complete is to sketch its API. If you cannot write the request and the response, the requirement is still vague:

```http
GET  /events?city=sao-paulo&from=2027-03-01&q=rock      → 200 [ {eventId, name, venue, date, minPrice} ]
GET  /events/{eventId}/seats                            → 200 { sections: [...], available: [...] }
POST /events/{eventId}/holds   { seatIds: [...] }       → 201 { holdId, expiresAt }   | 409 seat taken
POST /orders                   { holdId, paymentToken } → 201 { orderId, status }     | 402 declined
GET  /orders/{orderId}                                  → 200 { status, tickets: [...] }
```

You will detail APIs and data models in [class 5](../../compute/index.md) and [class 6](../../databases/index.md); at this stage the goal is only to make the scope concrete.

---

## Non-functional requirements: the quality attributes

Non-functional requirements describe **qualities** of the system. Software architecture literature calls them **quality attributes**[^1] (ISO/IEC 25010 standardizes a long list of them[^2]). For system design, eight carry most of the weight:

| Quality attribute | Question it answers | How to measure | BoxOffice target (assumption) | Palette components that help |
|---|---|---|---|---|
| **Scalability** | Can it handle more load by adding resources? | max sustainable throughput at the latency target | 2 M fans arriving in 1 min at an on-sale; 1,500 catalog req/s on a normal day | Load Balancer, App Server replicas, Cache, CDN, Queue, NoSQL partitions |
| **Availability** | Is it up when users need it? | % of successful requests over a window | 99.95% for checkout per rolling 28 days | replicas, Health Check, multi-AZ, DNS failover |
| **Latency** | How long does a user wait? | percentiles (p50, p99) of response time | catalog p99 < 200 ms; hold p99 < 300 ms; checkout p99 < 1.5 s | Cache, CDN, async work, indexes |
| **Consistency** | Do all readers see the same, latest data? | anomalies allowed (stale reads, double writes) | a seat is sold **at most once**; catalog may be 60 s stale | SQL transactions, single leader, consensus |
| **Durability** | Is confirmed data ever lost? | data-loss events; RPO | zero confirmed orders lost; RPO = 0 for orders | replication, backups, Object Store |
| **Cost** | How much does it cost to run? | money per month; cost per unit of business | < R$ 0.10 of infrastructure per ticket sold | right-sizing, autoscaling, Serverless, CDN offload |
| **Security** | Is it protected against misuse and attack? | threats mitigated; audit findings | no card data stored (PCI scope minimized); bots blocked | WAF, Auth Service, API Gateway, VPC, Safety Mesh |
| **Operability** | Can the team run, change and fix it? | MTTR, deploy frequency, alert quality | deploy daily without downtime; MTTR < 30 min | Metrics, Logs, Tracing, Alerting, CI/CD |

The rest of this section gives each attribute a precise meaning — "scalable" and "available" are used loosely in everyday speech, and loose words make bad requirements.

### Scalability

**Scalability** is the ability to handle **more load** by adding resources, keeping performance acceptable. It is not a yes/no property: "is it scalable?" is meaningless until you say **which load parameter** grows and **by how much**[^3]. For BoxOffice the load parameters differ per part of the system:

- *catalog*: page views per second (read-heavy, highly cacheable);
- *inventory*: seat holds per second **on a single event** (write-heavy, all on the same hot rows);
- *notification*: e-mails per minute after an on-sale (bursty, can be delayed).

Each one scales with a different technique: caching and CDN for the first, partitioning and a waiting room for the second, a queue and workers for the third. Two directions exist, and you will use both:

- **Vertical scaling** (*scale up*): a bigger machine. Simple, no code change, but limited by the largest machine you can buy and still a single point of failure.
- **Horizontal scaling** (*scale out*): more machines. Practically unlimited for stateless components, but requires a load balancer, stateless servers, and — for data — partitioning and replication.

### Availability

**Availability** is the fraction of time (or of requests) in which the system serves users correctly. It is quoted in "nines" and **always over a window**: 99.9% per rolling 28 days allows about 40 minutes of downtime; 99.99% allows about 4 minutes. Each extra nine costs much more than the previous one — [class 2](../../estimation/availability-math/index.md) gives you the math, and [class 9](../../reliability/index.md) the engineering.

Availability is not uniform either: BoxOffice can live with the recommendation widget down for an hour, but not with checkout down during an on-sale.

### Latency (and throughput)

**Latency** (response time) is how long a request takes, as seen by the client. **Throughput** is how many requests per second the system completes. They are linked — near saturation, latency explodes ([class 2](../../estimation/queueing/index.md)) — so a latency target is only meaningful **at a given throughput**.

Always state latency as a **percentile**, not an average: "p99 < 300 ms" means 99% of requests finish in under 300 ms. Averages hide the slow requests that users remember ([percentiles and tail latency](../../estimation/percentiles/index.md)). Classic usability research gives useful anchors for *user-facing* targets: about **0.1 s** feels instantaneous, about **1 s** keeps the user's flow of thought, and beyond about **10 s** users lose attention[^4].

### Consistency

**Consistency** (in the system-design sense) is about **what readers see after a write**. With **strong consistency**, once a write is acknowledged every subsequent read sees it — the system behaves as if there were a single copy of the data. With **eventual consistency**, replicas may disagree for a while, but converge if writes stop.

The key insight is that **not all data needs the same consistency**:

| BoxOffice data | Required consistency | Why |
|---|---|---|
| Seat state (free / held / sold) | **strong** | two fans must never buy the same seat |
| Order and payment status | strong (per order) | a fan must see "paid" after paying |
| Event description, prices shown in listings | eventual (seconds to a minute) | a slightly stale description harms no one; the hold re-checks the price |
| "1,234 people are looking at this event" | approximate | it is a hint, not a promise |

Strong consistency costs latency and availability (you will see why with CAP and PACELC in [class 3](../../distributed/index.md)), so you pay for it **only where the business needs it**.

### Durability

**Durability** means that data, once confirmed, is not lost — even if disks, machines or a whole data centre fail. It is achieved with replication (several copies, ideally in different failure domains), write-ahead logs, backups and tested restores. Its requirement is usually expressed as an **RPO** (*Recovery Point Objective* — how much recent data you may lose in a disaster): for BoxOffice orders, RPO = 0; for analytics events, a few minutes is acceptable.

Do not confuse durability with availability: a database can be **down** (unavailable) without **losing** anything (durable), and vice-versa a cache can be up while keeping nothing durable.

### Cost

Every component has a price: machines, managed services, storage, network egress, third-party fees, and the people to operate it. Cost is a first-class requirement — an architecture that meets every other target at ten times the budget is a failed architecture. Good cost requirements are tied to the business: **cost per ticket sold**, cost per active user, or a monthly ceiling. Note also that BoxOffice traffic is **spiky**: paying all month for the capacity of a 10-minute on-sale is wasteful, which is why autoscaling, queues and serverless matter ([class 12](../../cloud-native/index.md) covers FinOps).

### Security

**Security** protects **confidentiality** (only the right people read data), **integrity** (only the right people change it) and **availability** (attackers cannot take it down) — the CIA triad. For BoxOffice it translates into concrete requirements: fans authenticate before buying; an organizer only sees their own events; bots cannot buy 500 tickets in one second; card numbers **never** touch BoxOffice servers (the payment provider tokenizes them, which keeps BoxOffice out of most of the PCI DSS scope[^5]); personal data follows Brazil's data-protection law, the LGPD (*Lei Geral de Proteção de Dados*)[^6].

### Operability

**Operability** groups the qualities that make a system **runnable by real people**: observability (can we tell what is wrong?), deployability (can we ship a change safely, many times a day?), maintainability (can a new engineer understand and change it?), and recoverability (how fast do we restore service — the MTTR, *Mean Time To Recovery*). It is the attribute most often forgotten in diagrams and most often blamed in post-mortems.

---

## Making non-functional requirements measurable

"The system must be fast" cannot be tested, so it cannot be designed for. A practical template from software architecture is the **quality attribute scenario**[^1], which forces six parts into one sentence:

``` mermaid-sim
flowchart LR
    source["Source<br/>who/what"] --> stimulus["Stimulus<br/>what happens"]
    stimulus --> artifact["Artifact<br/>which part, in which<br/>environment"]
    artifact --> response["Response<br/>what the system does"]
    response --> measure["Response measure<br/>the number"]
```

| Part | BoxOffice scenario: the on-sale |
|---|---|
| **Source** | 2 M fans, from web and mobile |
| **Stimulus** | arrive within 60 s of 10:00 and request seat holds |
| **Environment** | normal operation, flash sale in progress |
| **Artifact** | waiting room + `inventory` service + seats database |
| **Response** | every fan gets a place in line; admitted fans can hold seats; no seat is held twice |
| **Response measure** | admission page p99 < 500 ms; hold p99 < 300 ms; 0 double bookings; error rate < 0.1% |

Written as requirements, a measurable set for BoxOffice looks like this:

!!! example "BoxOffice — non-functional requirements (first release, assumptions)"

    - **Load**: normal day 1,500 req/s at peak hour; on-sale: 2 M fans in the first minute, 60 k seats.
    - **Latency**: catalog p99 < 200 ms; seat map p99 < 300 ms; hold p99 < 300 ms; checkout p99 < 1.5 s (the payment provider takes most of it).
    - **Availability**: checkout and holds 99.95% per rolling 28 days; catalog 99.9%; recommendations best-effort.
    - **Consistency**: seats strongly consistent (no double booking, ever); catalog up to 60 s stale.
    - **Durability**: zero loss of paid orders (RPO = 0); analytics RPO 15 min.
    - **Security**: no card data stored; bot purchases blocked at the edge; LGPD compliant.
    - **Cost**: < R$ 0.10 of infrastructure per ticket sold; idle cost < R$ 15k/month.
    - **Operability**: zero-downtime deploys; on-call alerted within 5 min of an SLO burn; MTTR < 30 min.

Each line is testable — with a load test, a chaos experiment or a monthly bill — and each line will drive a design decision in the coming classes.

??? question "Think first: rewrite these requirements so they are measurable"

    1. "Search must be fast."
    2. "The system must never go down."
    3. "Tickets must be delivered quickly."

    **Possible answers**

    1. "Search returns the first page of results in p99 < 250 ms at 800 queries/s; results may lag the catalog by up to 5 minutes." (Note the consistency part: a search index is usually updated asynchronously.)
    2. "Holds and checkout are available 99.95% of requests per rolling 28 days; during a region outage, service is restored in another region within 15 minutes (RTO) without losing paid orders (RPO = 0)." *Never* is not a requirement; it is an infinite budget.
    3. "95% of tickets reach the fan's inbox within 2 minutes of payment, 99.9% within 30 minutes; a delayed e-mail never blocks checkout." This tells the designer the e-mail can go through a queue.

---

## Trade-offs between quality attributes

Quality attributes pull against each other. Recognizing the tension *before* choosing a component is the essence of system design:

| Improving… | …usually costs | BoxOffice example |
|---|---|---|
| Consistency | latency and availability | a seat hold waits for the primary database; if the primary is unreachable, holds fail rather than risk a double sale |
| Latency (caching) | freshness (consistency) | the cached event page shows a price up to 60 s old |
| Availability (redundancy) | cost and complexity | a second region doubles infrastructure and needs failover tests |
| Durability (synchronous replication) | write latency | each paid order waits for two replicas to confirm |
| Security (more checks) | latency and usability | WAF inspection and bot challenges add milliseconds and friction |
| Scalability (partitioning) | simplicity, cross-partition queries | sharding orders by fan makes "all orders of an event" a scatter-gather query |
| Cost (fewer resources) | headroom for spikes | running at 80% utilization saves money and kills p99 during the on-sale |

This is why the same company runs different architectures for different parts of the same product. BoxOffice's catalog is an **AP-leaning, cache-everything** system; its inventory is a **CP-leaning, transaction-everything** system; its notifications are an **asynchronous, retry-until-delivered** system.

---

## Constraints and assumptions

Requirements come with **constraints** — decisions already made for you — and **assumptions** — things you take as true to move on:

- **Team and skills**: a team of six that knows Java and PostgreSQL should not adopt five new databases.
- **Time**: "on-sale in 8 weeks" rules out rewriting everything as microservices.
- **Budget**: a monthly ceiling, or a cost-per-ticket target.
- **Regulation**: LGPD for personal data; PCI DSS for payments; tax rules for invoices.
- **Existing systems**: the payment provider's API and its rate limits; the organizer's ERP.
- **Assumptions**: "fans per on-sale follow last year's distribution", "the provider answers in 300–800 ms". Write them down — when an assumption is wrong, you know which part of the design to revisit.

!!! tip "In the interview"

    Spend the first **3–5 minutes** on requirements, and write them on the board in two columns:

    - **Functional**: 3–5 core features, each one sentence ("hold seats", "pay", "get ticket"). Say what you leave out: "I'll skip resale and dynamic pricing unless you want them."
    - **Non-functional**: scale (users, requests/s, data size), latency targets, availability, consistency needs, and anything special (spikes, abuse, regulation).

    Good clarifying questions for almost any problem: *Who are the users and how many? What is the read/write ratio? What must be strongly consistent? What is the latency the user tolerates? Is the load steady or spiky? What is out of scope?* If the interviewer says "you decide", state an assumption and move on: "I'll assume 10 M daily users and a read/write ratio of 100:1."

!!! warning "Common pitfalls"

    - **Unmeasurable adjectives**: "fast", "scalable", "highly available" without numbers and windows.
    - **One target for everything**: requiring strong consistency or five nines for the whole system, when only one path needs it.
    - **Forgetting the peak**: designing for the daily average when the business lives on spikes.
    - **Ignoring cost and operability** until the first bill or the first 3 a.m. incident.
    - **Gold-plating the scope**: designing ten features superficially instead of the core path well.

---

## How it connects { #how-it-connects }

``` mermaid
flowchart LR
    FR["functional requirements<br/>actors, core path"] --> API["API & data model<br/>→ Compute, Databases"]
    NFR["quality attributes"] --> QAS["quality attribute scenario<br/>a measurable target"]
    QAS --> EST["load numbers<br/>→ Estimation"]
    NFR --> SC["scalability<br/>lb, cache, queue"]
    NFR --> LAT["latency percentiles<br/>→ Estimation"]
    NFR --> AV["availability nines<br/>→ Reliability"]
    NFR --> CO["consistency per data item<br/>→ Distributed systems"]
    NFR --> SEC["security<br/>→ Network & Security"]
    NFR --> OPS["operability<br/>→ Observability"]
    CO --> TO["trade-offs: CP inventory,<br/>AP catalog"]
    LAT --> TO
```

**Palette components:** [`client`](../../../reference/components/client/index.md#client) · [`mobile`](../../../reference/components/client/index.md#mobile) (the actors' entry points) · [`sql`](../../../reference/components/storage/index.md#sql) (strong consistency for seats, durability of orders) · [`cache`](../../../reference/components/storage/index.md#cache) · [`cdn`](../../../reference/components/edge/index.md#cdn) (latency bought with freshness) · [`lb`](../../../reference/components/edge/index.md#lb) (scalability and availability through replicas) · [`waf`](../../../reference/components/edge/index.md#waf) · [`auth`](../../../reference/components/compute/index.md#auth) (security) · [`payment`](../../../reference/components/external/index.md#payment) (an external constraint: no card data stored) · [`metrics`](../../../reference/components/observability/index.md#metrics) (operability). **Scenarios:** `monolith`, `flash-sale`. **Continues in:** [Estimation — numbers](../../estimation/numbers/index.md), [Estimation — percentiles](../../estimation/percentiles/index.md), [Estimation — availability math](../../estimation/availability-math/index.md), [Distributed — CAP and PACELC](../../distributed/cap-pacelc/index.md), [Reliability — SLOs](../../reliability/slo/index.md), [Exercise: design doc](../../../exercises/design-doc/index.md).

## Key takeaways

- **Functional** requirements define *what* (APIs, data); **non-functional** requirements define *how well* — and drive the architecture.
- Eight quality attributes carry most design decisions: **scalability, availability, latency, consistency, durability, cost, security, operability**.
- Make each requirement **measurable**: a number, a percentile, a window, a load level — the quality attribute scenario helps.
- Different parts of the system need **different** qualities: strong consistency for seats, freshness traded for speed in the catalog.
- Every improvement costs something; name the **trade-off** before choosing the component.

---

[^1]: BASS, L.; CLEMENTS, P.; KAZMAN, R. *Software Architecture in Practice*, 4th ed. Addison-Wesley, 2021. Part II (quality attributes and quality attribute scenarios).
[^2]: ISO/IEC 25010:2023. *Systems and software engineering — Systems and software Quality Requirements and Evaluation (SQuaRE) — Product quality model*.
[^3]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2nd ed. O'Reilly. Chapter 2 (defining nonfunctional requirements: describing load and performance).
[^4]: NIELSEN, J. *Usability Engineering*. Morgan Kaufmann, 1993. Chapter 5 (response time limits: 0.1 s, 1 s, 10 s).
[^5]: PCI SECURITY STANDARDS COUNCIL. *Payment Card Industry Data Security Standard (PCI DSS)*, v4.0, 2022.
[^6]: BRASIL. Lei nº 13.709, de 14 de agosto de 2018 — Lei Geral de Proteção de Dados Pessoais (LGPD).
