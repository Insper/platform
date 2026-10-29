---
marp: true
lang: en
title: What is System Design
description: System Architecture · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">System Architecture · Insper</div>

# What is System Design

**Design, build, measure and defend systems that survive real load**

<!--
Outline: (1) what system design is; (2) BoxOffice, the running example; (3) the component palette
and the playground; (4) requirements and quality attributes; (5) the scaling journey;
(6) the interview framework.
-->

---

## Friday, 10:00

<div class="q">

BoxOffice opens the sale of a stadium show: **60,000 seats, 2 million fans** at the same second.
At 10:00:20 the site answers nothing; at 10:03 it is back — and **312 seats were sold twice**.
Which line of code had the bug?

</div>

* None: every function did exactly what it was written to do.
* What failed was the **system**: how many machines, where the data lives, what waits for what.
* This course is about that layer — and about proving, with numbers, that 10:00 will be a non-event.

<!--
Let the class guess first. Collect answers like "the database", "the server", "the code". The point:
the failure is in decisions above the code.
-->

---

## System design

Defining the **components**, their **interfaces** and the **data** that flows through them, so the system meets what it must do **and how well**.

| Level | Typical question | Unit of design |
|---|---|---|
| **Algorithm** | how do I compute this efficiently? | function, data structure |
| **Software design** | how do I organize code so it is easy to change? | classes, modules |
| **System design** | how do running processes on many machines cooperate under load and failure? | services, databases, queues, caches, networks |

<p class="small">From <b>one process</b> to <b>many processes on many machines</b>, over an unreliable network.</p>

---

## Three new realities

- **Load** — 10 users and 10 million users need *different* architectures, not more of the same.
- **Partial failure** — a disk fills, a node reboots, a provider slows down; the rest must keep its promises.
- **Trade-offs** — a cache buys latency with freshness; a replica buys availability with consistency; a queue buys resilience with immediacy.

<div class="ok">

There is no right architecture — only **justified** ones. The skill is to turn "what is the best database?" into "which database fits *these* numbers and constraints?" — then choose, and say what you gave up.

</div>

---

## BoxOffice, the running example

| Property | Where it shows up |
|---|---|
| Extreme **spikes** | the 10:00 on-sale: 2 M fans, 60 k seats |
| **Read-heavy** traffic | events, venues, seat maps |
| **Strong consistency** | a seat is sold exactly once |
| **External dependencies** | payment provider, e-mail, push |
| **Abuse** and **async work** | bots (WAF, rate limits); tickets by e-mail, waiting room |
| **AI** | a support assistant (RAG + tools) |

<p class="small">Services: <code>gateway</code>, <code>auth</code>, <code>catalog</code>, <code>inventory</code>, <code>order</code>, <code>payment</code>, <code>notification</code>, <code>search</code>, <code>assistant</code> — built in the labs, in the course repository.</p>

---

<!-- _class: tight -->

## The component palette

| Category | Components | Class |
|---|---|---|
| **Client** | Client, Mobile | 1 |
| **Traffic & edge** | DNS, CDN, Load Balancer, WAF, API Gateway, Ingress | 4 |
| **Compute** | App Server, Worker, Serverless, Auth, Search, Scheduler, Notifications, Analytics | 5 |
| **Containers** | Microservice, Container, Kubernetes Cluster, Service Registry | 11 |
| **Storage** | SQL, NoSQL, Cache, Object Store, Data Warehouse, Vector DB | 6, 7 |
| **Messaging** | Message Queue, Pub/Sub, Event Stream, Kafka | 8 |
| **Observability** | Metrics, Logs, Tracing, Alerting, Health Check | 9 |
| **Network** | VPC, Subnet, NAT Gateway, VPN, Service Mesh | 12 |
| **AI & agents** | LLM Gateway, Orchestrator, Tool Registry, Memory Fabric, Safety Mesh | 13 |
| **External** | 3rd Party API, Payment, Email | 5 |

<p class="small">Each component has an entry in the <b>component catalog</b>: what it is, when (not) to use it, numbers, failure modes, real products.</p>

---

## How the course is organized

<div class="cols">
<div>

### Theory (16 classes)

- **Foundations**: intro, estimation, distributed systems
- **The palette**: edge, compute, databases, caching, messaging
- **Production**: observability, reliability, cloud-native, network & security
- **Together**: AI systems, AI-assisted delivery, performance, case studies

</div>
<div>

### Practice

- **Labs** every week: the real BoxOffice (Spring Boot, PostgreSQL, Redis, Kafka, Kubernetes…), **measured** with k6
- **Exercises**: estimation, playground designs, load-test reports
- **Team project**: design doc → load test to an SLO → chaos game day
- **Interview** prep all along

</div>
</div>

---

## The System Design Playground

A simulator where every palette component is a block you drop, connect and **load**.

1. **Build** — pick components, connect them.
2. **Configure** — capacities, replicas, hit ratios, timeouts.
3. **Load** — `smoke`, `load`, `stress`, `spike`, `soak`, `breakpoint`, `chaos`.
4. **Read** — throughput, p50/p99, error rate, utilization, cost.
5. **Change one thing and run again.**

<div class="warn">

It is a **model**, not real code — but it reproduces what matters for design: queues near saturation, cascading failures, cost per replica.

</div>

---

## What you will see first

<div class="q">

Scenario `monolith`: one app server, one SQL database. Increase the load. What breaks first — and what happens to latency **before** errors appear?

</div>

* Latency stays flat… then **explodes** near saturation: the **knee**.
* Errors come **late**; latency is the early warning.
* Scenario `scale-out`: more app replicas help — until the **single database** saturates.
* The next move is a *different* component (cache, replicas, queue), not more of the same.

---

## Requirements: what vs how well

| | Functional | Non-functional |
|---|---|---|
| **Describe** | *what* the system does | *how well* it does it |
| **Example** | "a fan holds up to 6 seats for 10 min" | "holds p99 < 300 ms at 5,000 holds/s" |
| **Answered by** | APIs, data model | architecture |
| **If missing** | wrong system | right system — for 10 users on a good day |

<p class="small">Non-functional requirements drive almost every architectural decision: the same "sell a ticket" feature is one table for a theatre and a waiting room + event stream for a stadium.</p>

---

<!-- _class: tight -->

## Eight quality attributes

| Attribute | Question | BoxOffice target (assumption) |
|---|---|---|
| **Scalability** | more load by adding resources? | 2 M fans in 1 min of on-sale |
| **Availability** | up when needed? | checkout 99.95% per rolling 28 days |
| **Latency** | how long users wait? | catalog p99 < 200 ms |
| **Consistency** | readers see the latest write? | seats: never sold twice |
| **Durability** | confirmed data never lost? | RPO = 0 for paid orders |
| **Cost** | how much to run? | < R$ 0.10 per ticket sold |
| **Security** | protected from misuse? | no card data stored; bots blocked |
| **Operability** | can the team run and fix it? | MTTR < 30 min; daily deploys |

---

## Make it measurable

**Quality attribute scenario**: source → stimulus → environment → artifact → response → **response measure**.

> 2 M fans arrive within 60 s of 10:00 and request holds; the waiting room and `inventory` give everyone a place in line and never hold a seat twice — admission p99 < 500 ms, hold p99 < 300 ms, **0 double bookings**.

<div class="warn">

"Fast", "scalable", "never goes down" are not requirements. Add a number, a percentile, a load level and a window.

</div>

---

## Attributes pull against each other

| Improving… | …usually costs |
|---|---|
| Consistency | latency and availability |
| Latency (cache) | freshness |
| Availability (redundancy) | cost and complexity |
| Durability (sync replication) | write latency |
| Scalability (partitioning) | simplicity, cross-partition queries |
| Cost (fewer resources) | headroom for spikes |

<div class="ok">

Different parts, different qualities: catalog **cache-everything**, inventory **transaction-everything**, notifications **retry-until-delivered**.

</div>

---

<!-- _class: tight -->

## The scaling journey (1/2)

| Stage | Symptom | Add | New problem |
|---|---|---|---|
| 0 | — | one box: app + DB | everything fails together |
| 1 | app and DB fight for resources | separate **SQL Database** | network hop |
| 2 | a deploy or crash = downtime | **Load Balancer** + stateless replicas + **Health Check** | session state must leave the server |
| 3 | DB CPU high, 95% reads | **read replicas** | replication lag |
| 4 | catalog p99 grows with traffic | **Cache** (cache-aside) | invalidation, stampede |
| 5 | 1 MB of images per page view | **CDN** + **Object Store** | invalidation at the edge |

<p class="small">Rule: add a component only when a <b>measured symptom</b> calls for it — and know the new problem it brings.</p>

---

<!-- _class: tight -->

## The scaling journey (2/2)

| Stage | Symptom | Add | New problem |
|---|---|---|---|
| 6 | checkout waits for e-mail; the on-sale spike | **Queue** + **Workers**; waiting room | duplicates, backlog |
| 7 | teams and deploys collide | **services**, **API Gateway**, **Event Stream** | network failures, distributed data |
| 8 | one DB too big / too hot | **partitioning**, **Search**, **Data Warehouse** | hot partitions |
| 9 | bots, DDoS, region outage | **WAF**, rate limiting, **multi-region** + DNS | cross-region data |

<div class="warn">

**Monolith first**: distribution has a large fixed cost. Start with a modular monolith; extract services when a symptom justifies it.

</div>

---

## The interview framework (45 min)

| # | Step | Time |
|---|---|---|
| 1 | **Clarify** requirements — and name what is hard | 0–5 |
| 2 | **Estimate** — numbers that change decisions | 5–10 |
| 3 | **API & data model** | 10–15 |
| 4 | **High-level design** — every requirement, end to end | 15–25 |
| 5 | **Deep dives** — 1–3 hardest parts, with alternatives | 25–37 |
| 6 | **Bottlenecks & trade-offs** | 37–42 |
| 7 | **Wrap-up** | 42–45 |

<p class="small">Interviewers score problem navigation, solution design, technical depth, trade-off reasoning and communication.</p>

---

## Deep dive: never sell a seat twice

- Options: pessimistic lock (`SELECT … FOR UPDATE`), **conditional update**, distributed lock.
- Choice: one atomic statement in the single source of truth.

```sql
UPDATE seat
   SET status = 'HELD', hold_id = :holdId, version = version + 1
 WHERE event_id = :eventId
   AND seat_id IN (:seatIds)
   AND status = 'FREE';
```

<p class="small">Rows updated = seats requested → hold created; otherwise roll back and answer <code>409</code>. Expired holds released by a scheduled job.</p>

---

## How to communicate

- **Think out loud** — silence is the worst signal.
- **Broad first, then deep** — a complete simple design beats half a perfect one.
- **State assumptions** — "I'll assume 2 M daily fans; tell me if that's off."
- **Welcome pushback** — interviewer questions are hints.
- **Drive** — announce transitions; watch the clock.
- **Quantify trade-offs** — "+1 ms per request, 10× less database load".

<div class="ok">

Say the seven steps at the start: the interviewer sees a plan, and you get a checklist for when nerves hit.

</div>

---

<!-- _class: tight -->

## The intro concept map

| Component | Question it answers | Key concepts |
|---|---|---|
| `client` `mobile` | *who* uses it, for what? | actors, functional requirements |
| `lb` `app` `healthcheck` | how does a crash stop being an outage? | stateless replicas, scale out |
| `sql` | where does the truth live? | replicas, lag, strong consistency for seats |
| `cache` `cdn` `objstore` | how to stop sending the same bytes? | hit ratio, TTL, versioned files |
| `queue` `worker` | what can happen *later*? the spike? | async work, waiting room, idempotency |
| `apigw` `stream` `nosql` `search` `dwh` | many teams, too much data? | services, partitioning, specialized stores |
| `waf` `dns` | bots, attacks, a region outage? | rate limiting, multi-region failover |

<p class="small">Each component buys a <b>quality attribute</b> and brings a new problem — add it only when a measured symptom calls for it.</p>

---

## Takeaways

1. System design decides **components, interfaces and data** for load and partial failure.
2. It is a **trade-off** discipline: name what each component buys and costs.
3. The course follows the **component palette**; the **playground** lets you build, load and break designs.
4. Requirements: **functional** (what) and **non-functional** (how well) — measurable, per part of the system.
5. Architectures **evolve** one measured symptom at a time; **monolith first**.
6. Interview: **clarify → estimate → API & data → high-level → deep dives → bottlenecks → wrap-up**.
