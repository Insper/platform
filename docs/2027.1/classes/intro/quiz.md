Click **"Answer"** to reveal the correct answer and explanation.

---

## System design and requirements

**Q1.** Which question is a **system design** question rather than a software (code-level) design question?

- A. Should `OrderService` depend on an interface or on a concrete payment client class?
- B. Which sorting algorithm should rank events by date?
- C. Should seat holds and the event catalog live in the same database, given that one is strongly consistent and write-hot and the other is read-heavy and cacheable?
- D. Should a method throw a checked or an unchecked exception?

??? success "Answer"
    **C — It is about running components, data placement and load.**

    System design decides components, interfaces between running processes, and where data lives, so that the system meets its requirements under load and partial failure. A and D are code-level design; B is an algorithm question.

---

**Q2.** Which of the following is a **non-functional** requirement?

- A. A fan can hold up to 6 seats for 10 minutes.
- B. Organizers can schedule an on-sale date.
- C. Seat holds complete in under 300 ms at the 99th percentile while handling 5,000 holds per second.
- D. Fans receive their tickets by e-mail.

??? success "Answer"
    **C — It describes *how well*, with a number, a percentile and a load level.**

    A, B and D describe *what* the system does (functional). C is a measurable latency target at a stated throughput — a quality attribute.

---

**Q3.** Why is "the system must be scalable" a poor requirement?

- A. Scalability cannot be achieved with relational databases.
- B. It does not say which load parameter grows, by how much, or what performance must be kept while it grows.
- C. Scalability is a functional requirement, not a non-functional one.
- D. Modern clouds scale automatically, so the requirement is redundant.

??? success "Answer"
    **B — Scalability is meaningless without a load parameter and a target.**

    A useful version names the load ("2 M fans in the first minute of an on-sale", "1,500 catalog reads/s") and the performance to keep ("hold p99 < 300 ms"). Clouds provide resources, not an architecture that can use them.

---

**Q4.** BoxOffice needs **strong consistency** for which data?

- A. The event description shown in search results.
- B. The "1,234 people are looking at this event" counter.
- C. The state of each seat (free, held, sold).
- D. The list of recommended events on the home page.

??? success "Answer"
    **C — Two fans must never buy the same seat.**

    Strong consistency costs latency and availability, so it is paid only where the business requires it. Descriptions and recommendations can be seconds or minutes stale; the viewer counter is only a hint.

---

**Q5.** A database is unreachable for 20 minutes because of a network problem, but no confirmed data is lost. Which statement is correct?

- A. Durability was violated, availability was not.
- B. Availability was violated, durability was not.
- C. Both availability and durability were violated.
- D. Neither was violated, because the data is still there.

??? success "Answer"
    **B — Unavailable, but durable.**

    Availability is about serving requests when needed; durability is about never losing confirmed data. A system can be down without losing anything (this case), or up while keeping nothing durable (a cache).

---

**Q6.** Which statement best describes the trade-off introduced by caching the event catalog?

- A. It improves consistency at the cost of latency.
- B. It improves latency and reduces database load at the cost of freshness (readers may see stale data).
- C. It improves durability at the cost of availability.
- D. It has no trade-off if the TTL is short.

??? success "Answer"
    **B — Speed and offload are bought with freshness.**

    A cached page can be stale until its TTL expires or the key is invalidated. A shorter TTL reduces staleness but also the hit ratio — it moves along the trade-off, it does not remove it.

---

## The scaling journey

**Q7.** BoxOffice runs three app server replicas behind a load balancer. After a login, fans are randomly "logged out" on the next page. What is the most likely cause?

- A. The load balancer's health checks are too frequent.
- B. Session state is kept in the memory of the app server that handled the login.
- C. The database has no read replicas.
- D. The CDN is caching the login page.

??? success "Answer"
    **B — The app servers are not stateless.**

    The next request lands on another replica that does not know the session. Keep session state in a signed token (JWT) or a shared store (Redis). Stateless app servers are the precondition for horizontal scaling and rolling deploys.

---

**Q8.** The catalog database is at 80% CPU, and 95% of its queries are reads of data that changes a few times per day. Adding which component gives the biggest reduction in database load per real (R$) spent?

- A. More app server replicas.
- B. A cache with cache-aside, reaching a 95% hit ratio.
- C. A message queue between the app and the database.
- D. Sharding the catalog database.

??? success "Answer"
    **B — A 95% hit ratio sends only 5% of reads to the database (a 20× reduction).**

    More app replicas (A) would only add load on the database. A queue (C) does not help synchronous reads. Sharding (D) adds a lot of complexity for a problem that is read volume, not data size or write volume.

---

**Q9.** After adding read replicas, a fan pays, is redirected to "My orders" and does not see the new order. What is happening, and what is a standard fix?

- A. The order was lost; enable synchronous replication everywhere.
- B. Replication lag: the read hit a replica that has not applied the write yet; read the fan's own recent data from the primary (read-your-writes).
- C. The CDN cached the page; disable the CDN.
- D. The load balancer sent the request to an unhealthy server; reduce the health-check interval.

??? success "Answer"
    **B — Replication lag; use read-your-writes.**

    Replicas apply the primary's changes asynchronously, milliseconds to seconds later. Routing a user's reads of their own recent writes (or the whole critical flow) to the primary fixes the symptom without giving up replicas for everything else.

---

**Q10.** Why does BoxOffice put a **waiting room** (a queue) in front of the inventory for big on-sales?

- A. To store tickets durably.
- B. To convert a spike of millions of concurrent requests on hot rows into a steady admission rate that the inventory can sustain.
- C. To make seat holds eventually consistent.
- D. To cache the seat map.

??? success "Answer"
    **B — It shapes the spike into a flat, sustainable load.**

    60 k seats cannot accept 2 M concurrent holds: the rows are hot and the database has a finite capacity. The waiting room admits fans at that capacity and keeps the inventory strongly consistent.

---

**Q11.** A team of four engineers is starting a new product with an uncertain domain and a few hundred users. Which architecture is the most sensible starting point?

- A. Twelve microservices on Kubernetes with Kafka between them.
- B. A modular monolith with one database, extracting services later when a measured symptom justifies it.
- C. One serverless function per database table.
- D. A multi-region active-active deployment.

??? success "Answer"
    **B — Monolith first.**

    Distribution has a large fixed cost (network failures, distributed data, many deployables, platform work). With an uncertain domain the service boundaries are not known yet; a modular monolith keeps them cheap to change.

---

## The interview framework

**Q12.** In a 45-minute system-design interview, what is the main purpose of the estimation step?

- A. To show that you can multiply large numbers quickly.
- B. To compute exact server counts for the final design.
- C. To get orders of magnitude that change design decisions — for example, whether to cache, shard or queue.
- D. To fill time while thinking about the design.

??? success "Answer"
    **C — An estimate that leads to no decision is just arithmetic.**

    "40 GB/year of orders fits one database for years — no sharding" or "100 k req/s at the on-sale — the inventory needs a waiting room" are the kind of conclusions an estimate exists for.

---

**Q13.** Twenty minutes into the interview, the candidate has a detailed SQL schema but no diagram of the overall system. Which principle was violated?

- A. Think out loud.
- B. Go broad first, then deep — a complete simple design before any deep dive.
- C. State assumptions explicitly.
- D. Estimate before designing.

??? success "Answer"
    **B — Breadth first.**

    The interviewer cannot evaluate depth on a design they have not seen. Draw a high-level design that covers every functional requirement (step 4) before the deep dives (step 5), and watch the clock at each transition.

---

**Q14.** During the deep dive on double booking, which answer shows the strongest **trade-off reasoning**?

- A. "I'll use Redis locks, because Redis is fast."
- B. "I'll use a database, because databases are consistent."
- C. "Options: pessimistic locks, a conditional `UPDATE … WHERE status = 'FREE'`, or a distributed lock. The conditional update is atomic in the single source of truth and holds no long locks; a Redis lock adds a second system that must agree with the database. I'll use the conditional update."
- D. "Double booking is rare, so I'll fix it later with refunds."

??? success "Answer"
    **C — Alternatives, comparison, choice, and what is given up.**

    A and B name a technology without comparing it to anything. D ignores a requirement the candidate wrote on the board ("no double booking, ever").

---

**Q15.** The interviewer asks: *"What happens if the payment provider becomes very slow?"* What is the best reaction?

- A. Explain that the provider has an SLA, so it will not happen.
- B. Treat it as a hint about failure handling: add timeouts and a circuit breaker on the payment call, keep the hold alive while payment is pending, and explain the cost (seats locked longer).
- C. Replace the provider with an in-house payment system.
- D. Ask the interviewer to move on to another topic.

??? success "Answer"
    **B — Questions from the interviewer are hints about what they want to evaluate.**

    A slow dependency without timeouts exhausts the caller's threads and cascades (class 9). Naming the mitigation *and its cost* shows both depth and trade-off reasoning.
