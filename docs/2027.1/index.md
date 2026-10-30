# System Architecture — 2027.1

Most systems you will build or maintain in your career have to be **fast, available, consistent enough, secure and affordable — at the same time, under load, while parts of them fail**. This edition of the course is about how to design such systems, how to **prove** with numbers that a design works, and how to **explain** it — to a team in a design review, and to an interviewer in a system-design interview.

!!! abstract "What changes in 2027.1"

    The course is reorganized around the **building blocks of modern architectures** — the same palette of components you will find in the [System Design Playground](../playground/index.md): client, traffic & edge, compute, storage, messaging, observability, network, AI & agents and external services.

    - Every class teaches a group of components, with the trade-offs, the numbers and the failure modes that matter in practice and in interviews.
    - Every class page embeds the **playground**, preloaded with a scenario, so you can *see* the concept under load: change a parameter, run a load test with randomness (crashes, spikes, hot keys, region outages), read the report.
    - The hands-on labs build one system along the semester — **BoxOffice**, a ticketing platform with a flash sale at 10:00 — and every lab ends with a **"Measure it"** step.
    - The [Support](support/interview/index.md) section has the interview material, a workbook, a cheat sheet, a concept map and study cards.

## The running example: BoxOffice

A stadium show goes on sale at 10:00. Two million fans, sixty thousand seats. The catalog is read-heavy, the seat inventory must never sell the same seat twice, payments go through an external provider that sometimes slows down, confirmations go out by e-mail, bots try to buy everything, and an AI assistant answers "find me two seats under R$ 300 for Saturday and hold them". Almost every topic of the course appears in this one system.

``` diagram
flowchart LR
    U["fans<br/>(web, mobile)"] --> DNS["DNS"] --> CDN["CDN"] --> WAF["WAF"] --> GW["API gateway"]
    GW --> AUTH["auth"]
    GW --> CAT["catalog"] --> CACHE[("cache")]
    CACHE --> SQL[("SQL")]
    GW --> Q["waiting room<br/>(queue)"] --> INV["inventory<br/>(seat holds)"] --> SQL
    INV --> ORD["order"] --> PAY["payment"] --> EXT["payment provider"]
    ORD --> K["event stream"] --> NOTIF["notification"] --> MAIL["e-mail"]
    K --> AN["analytics / DWH"]
    GW --> AI["assistant<br/>(LLM gateway, tools, RAG)"]
```

## The story of the course { #story }

The classes are not a list of topics: they are the chapters of one story. BoxOffice starts as **one service and one database**, and every chapter begins with the problem the previous one left, stated with a number. A component enters the design only when a number asks for it, and each one brings a new problem. Press play to follow the chain:

``` diagram-sim
flowchart TD
    C1["1. What must BoxOffice do, and how well?"] -->|"2 M fans, 60 k seats, p99 < 300 ms:<br/>is one database enough?"| C2["2. Estimate before you build"]
    C2 -->|"33,000 holds/s against ~1,100:<br/>we need more than one machine"| C3["3. More machines, a network that lies"]
    C3 -->|"replicas exist: who receives<br/>the 2 M requests at 10:00?"| C4["4. Traffic, edge & identity"]
    C4 -->|"the edge spreads load over replicas:<br/>what must a replica be?"| C5["5. Compute & services"]
    C5 -->|"stateless services push all<br/>state into the database"| C6["6. Databases"]
    C6 -->|"the event pages are read 100× more<br/>than they change"| C7["7. Caching"]
    C7 -->|"checkout still waits<br/>for the e-mail provider"| C8["8. Messaging"]
    C8 -->|"asynchrony hides failures:<br/>where did that order go?"| C9["9. Observability"]
    C9 -->|"now we see it: the provider answers<br/>in 4 s and drags checkout down"| C10["10. Reliability"]
    C10 -->|"a laptop with Compose cannot heal,<br/>scale or deploy safely"| C11["11. Cloud-native platforms"]
    C11 -->|"many services on one platform:<br/>who may talk to whom? what do we ship?"| C12["12. Network & security"]
    C12 -->|"fans ask in plain language:<br/>'two seats under R$ 300, Saturday'"| C13["13. AI systems"]
    C13 -->|"more changes, faster:<br/>who reviews, tests, releases?"| C14["14. AI-assisted delivery"]
    C14 -->|"does the whole design hold<br/>the next on-sale? prove it"| C15["15. Performance engineering"]
    C15 -->|"the same blocks, other systems"| C16["16. Case studies"]
```

Each row of the table is one chapter: the **problem** that opens it, the **class** that answers it, the **lab** where you build the answer in BoxOffice (and the file to read first), and the **playground scenario** where you can see it fail and recover. The [planning](planning.md) puts the chapters on the calendar.

| | The problem (BoxOffice) | Class | Built in | Code to read | See it |
|:-:|---|---|---|---|---|
| 1 | Nobody has written down what "works" means: how many fans, how fast, how available. | [What is System Design](classes/intro/index.md) | [Lab 0](hands-on/0/index.md) | `scripts/check-env.sh` | `monolith`, `flash-sale` |
| 2 | Can one PostgreSQL take the 10:00 on-sale? Demand is **~33,000 holds/s**; one database does **~1,100** at a sane utilization. | [Estimation](classes/estimation/index.md) | [Lab 1](hands-on/1/index.md), [Lab 2](hands-on/2/index.md) | [`load/stress.js`, `scripts/sweep.sh`](hands-on/2/index.md) | `monolith` (breakpoint) |
| 3 | A 30× gap means many machines, and between machines the network loses, delays and duplicates messages: a retried "buy" can charge twice. | [Distributed Systems](classes/distributed/index.md) | [Lab 2](hands-on/2/index.md) (the knee, measured) | — | `db-replicas`, `multi-region` |
| 4 | Two million phones press *refresh* at 10:00:00. Most of those requests must never reach a service, the rest must reach a healthy replica, and every caller must prove who it is. | [Traffic & Edge](classes/edge/index.md) | [Lab 3](hands-on/3/index.md), [Lab 4](hands-on/4/index.md) | [`infra/nginx/nginx.conf`](hands-on/3/index.md), [`TokenService.java`](hands-on/4/auth/index.md) | `scale-out`, `cdn-static`, `rate-limiter` |
| 5 | Behind the edge, replicas come and go: a replica that keeps the session or the hold in memory loses it. What must a service be to scale out? | [Compute & Services](classes/compute/index.md) | [Lab 4](hands-on/4/index.md) | [`SecurityConfig.java`](hands-on/4/gateway/index.md) (gateway) | `microservices`, `serverless-burst` |
| 6 | Stateless services push every decision into the database, and 2 fans click the same seat in the same millisecond. | [Databases](classes/databases/index.md) | [Lab 6](hands-on/6/index.md) | [`HoldService.java`](hands-on/6/holds/index.md) | `db-replicas`, `sharding`, `db-failover` |
| 7 | The event pages are read ~100× more than they change; the database spends its capacity answering the same question. | [Caching](classes/caching/index.md) | [Lab 5](hands-on/5/index.md) | [`EventCache.java`](hands-on/5/cache-aside/index.md) | `read-heavy-cache` |
| 8 | Checkout waits for the e-mail and the provider; when the e-mail server is down, nobody can buy. 30× more fans than capacity need a fair line. | [Messaging](classes/messaging/index.md) | [Lab 7](hands-on/7/index.md) | [`Outbox.java`](hands-on/7/outbox/index.md), [`WaitingRoom.java`](hands-on/7/waiting-room/index.md) | `async-queue`, `event-fanout` |
| 9 | Asynchrony hides failures: an order vanishes between Kafka and the e-mail, and the dashboards stay green while fans cannot pay. What exactly do we promise (the SLO), and how do we know we keep it? | [Observability](classes/observability/index.md) | [Lab 8](hands-on/8/index.md) | [`slo-catalog.yaml`](hands-on/8/slo/index.md) | `observability-stack` |
| 10 | Now we can see it: at 10:02 the payment provider answers in 4 s instead of 200 ms. Nothing is down, yet every `order` thread waits on it and checkout dies with it. | [Reliability](classes/reliability/index.md) | [Lab 9](hands-on/9/index.md) | [`PaymentClient.java`](hands-on/9/patterns/index.md) | `cascading-failure`, `retry-storm`, `db-failover` |
| 11 | Compose on one machine does not restart a dead replica on another node, scale at 09:45 or roll a bad release back. | [Cloud-Native](classes/cloud-native/index.md) | [Lab 10](hands-on/10/index.md), [Lab 11](hands-on/11/index.md) | [`catalog-hpa.yaml`](hands-on/10/autoscaling/index.md), [`catalog-rollout.yaml`](hands-on/11/canary/index.md) | `k8s-node-failure`, `serverless-burst` |
| 12 | Many services now share one platform: bots buy the best seats, a token leaks, every service trusts every other one, and nobody checks what the pipeline ships. | [Network & Security](classes/network-security/index.md) | [Lab 11](hands-on/11/supply-chain/index.md) (supply chain) | [`.github/dependabot.yml`](hands-on/11/supply-chain/index.md) | `payment-system`, `flash-sale` |
| 13 | Fans ask "two seats under R$ 300 on Saturday?": the answer comes from a slow, expensive, non-deterministic dependency that reads the catalog and the seat map through tools, and must never invent a seat or obey text hidden in a page. | [AI Systems](classes/ai-systems/index.md) | [Lab 12](hands-on/12/index.md) | [`agent.py`, `tools.py`](hands-on/12/tools/index.md) | `ai-assistant` |
| 14 | With AI writing code, changes arrive faster than people can review, test and release them. | [AI-Assisted Delivery](classes/ai-delivery/index.md) | [Lab 13](hands-on/13/index.md) | [`review.py`](hands-on/13/review/index.md) | `ai-assistant` |
| 15 | Every chapter added a box. Does the whole design hold the next on-sale, and what does it cost? | [Performance Engineering](classes/performance/index.md) | [Lab 11](hands-on/11/performance-gate/index.md), [Project](exercises/project/index.md) | [`load/budget.js`](hands-on/11/performance-gate/index.md) | `flash-sale` |
| 16 | A different system tomorrow (a feed, a chat, a ride app): the same blocks, other numbers. | [Case Studies](classes/case-studies/index.md) | [Exercises](exercises/index.md) | — | one per case |

!!! tip "How to read a class with the story in mind"

    Every class opens with **"The story so far"** (where BoxOffice is and which number forces this class) and ends with **"What breaks next"** (the limit of what you just learned, which opens the next chapter). Every subpage has a **"How it connects"** map, a **"Best practices"** box (the habits a reviewer expects, next to the pitfalls to avoid) and, when a lab implements the idea, an **"In the BoxOffice code"** box with the real file; every lab lists the best practices its code applies. When you can say, for each component, *which number put it there* and *what it costs*, you can defend the design — in a review or in an interview.

## Map of the course

| Part | Classes | Labs (BoxOffice) |
|---|---|---|
| **Foundations** | [1. What is System Design](classes/intro/index.md) · [2. Estimation & Performance Math](classes/estimation/index.md) · [3. Distributed Systems](classes/distributed/index.md) | [0. Environment](hands-on/0/index.md) · [1. First service](hands-on/1/index.md) · [2. Measure first](hands-on/2/index.md) |
| **Building blocks** | [4. Traffic & Edge](classes/edge/index.md) · [5. Compute & Services](classes/compute/index.md) · [6. Databases](classes/databases/index.md) · [7. Caching](classes/caching/index.md) · [8. Messaging](classes/messaging/index.md) | [3. Edge](hands-on/3/index.md) · [4. Gateway & identity](hands-on/4/index.md) · [5. Caching](hands-on/5/index.md) · [6. Data at scale](hands-on/6/index.md) · [7. Async](hands-on/7/index.md) |
| **Operating at scale** | [9. Observability](classes/observability/index.md) · [10. Reliability](classes/reliability/index.md) · [11. Cloud-Native](classes/cloud-native/index.md) · [12. Network & Security](classes/network-security/index.md) | [8. Observability](hands-on/8/index.md) · [9. Resilience & chaos](hands-on/9/index.md) · [10. Kubernetes](hands-on/10/index.md) · [11. Delivery](hands-on/11/index.md) |
| **AI** | [13. AI Systems & Agents](classes/ai-systems/index.md) · [14. AI-Assisted Delivery](classes/ai-delivery/index.md) | [12. AI assistant](hands-on/12/index.md) · [13. AI in CI/CD](hands-on/13/index.md) |
| **Prove it** | [15. Performance Engineering](classes/performance/index.md) · [16. Case Studies](classes/case-studies/index.md) | [Exercises](exercises/index.md) · [Project](exercises/project/index.md) |

The week-by-week plan is on the [planning page](planning.md).

## Meetings

| :octicons-location-24: | :fontawesome-regular-calendar: | :fontawesome-regular-clock: |
|-|:-:|:-:|
| Class | *TBD* | *TBD* |
| Class | *TBD* | *TBD* |
| Office hours | *TBD* | *TBD* |

## Instructors

<div class="grid cards" markdown>

-   :material-account-tie:{ .lg .middle } **Instructor**

    ---

    **Humberto Sandmann**

    [:material-web:](https://hsandmann.github.io/){:target="_blank"}
    [:simple-github:](https://github.com/hsandmann){:target="_blank"}
    [:material-linkedin:](https://www.linkedin.com/in/hsandmann/){:target="_blank"}

-   :material-school:{ .lg .middle } **Student Assistant**

    ---

    *TBD*

</div>

## Grade

$$
\text{Final Grade} = \left\{\begin{array}{lll}
    \text{Individual} \geq 5 \bigwedge \text{Team} \geq 5 &
    \implies &
    \displaystyle \frac{ \text{Individual} + \text{Team} } {2}
    \\
    \\
    \text{Otherwise} &
    \implies &
    \min\left(\text{Individual}, \text{Team}\right)
    \end{array}\right.
$$

```python exec="1" html="1"
--8<-- "docs/2027.1/grade.py"
```

1. **Exercises** (individual): seven exercises — estimation, load-test report, cache & database, event-driven, Kubernetes autoscaling, playground design and design doc — each graded with a concept (A–I) and a rubric. Weights and rules are on the [exercises page](exercises/index.md).

1. **Quizzes**: three quizzes; the lowest is dropped and the grade is the average of the two best:

    $$
    \text{Quizzes} = \frac{\text{Q}_1 + \text{Q}_2 + \text{Q}_3 - \min(\text{Q}_1, \text{Q}_2, \text{Q}_3)}{2}
    $$

1. **Exams**: a midterm and a final exam, individual, covering the classes and the labs. Part of each exam is a short system-design question in the format of the [interview framework](classes/intro/interview-framework/index.md).

1. **Team project**: teams of **2 or 3 students** build, measure, break on purpose and defend one system, in nine milestones (design doc, core path, scale & cache, async & resilience, Kubernetes + CI/CD, load-test campaign, chaos game day, cost report, presentation). The team grade is the same for all members. Details on the [project page](exercises/project/index.md).

    !!! warning "Team registration"

        :fontawesome-regular-calendar: Deadline: end of **week 3** (date on the [planning page](planning.md)).

        :material-account-group: Teams from 2 up to 3 members, one GitHub repository per team, documentation on GitHub Pages.

!!! danger "ORAL EXAMINATION"

    **ALL GRADES** in this course are subject to an oral examination for validation. If the outcome of the oral examination is negative, that specific grade will be **ZEROED**.

!!! info "Use of AI tools"

    AI tools are allowed and are part of the course (classes 13 and 14 and lab 13 are about building with them). You are responsible for every line and every number you deliver; measurements must come from runs you did. The rules are on the [exercises page](exercises/index.md#use-of-ai-tools).

## Repositories

Course repository (code of the labs and starters): [repo-classes/pma271](https://github.com/repo-classes/pma271){:target="_blank"} *(to be published)*.
