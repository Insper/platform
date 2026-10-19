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

``` mermaid
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

## Map of the course

| Part | Classes | Labs (BoxOffice) |
|---|---|---|
| **Foundations** | [1. What is System Design](classes/intro/index.md) · [2. Estimation & Performance Math](classes/estimation/index.md) · [3. Distributed Systems](classes/distributed/index.md) | [0. Environment](hands-on/0/index.md) · [1. First service](hands-on/1/index.md) · [2. Measure first](hands-on/2/index.md) |
| **Building blocks** | [4. Traffic & Edge](classes/edge/index.md) · [5. Compute & Services](classes/compute/index.md) · [6. Databases](classes/databases/index.md) · [7. Caching](classes/caching/index.md) · [8. Messaging](classes/messaging/index.md) | [3. Edge](hands-on/3/index.md) · [4. Gateway & identity](hands-on/4/index.md) · [5. Caching](hands-on/5/index.md) · [6. Data at scale](hands-on/6/index.md) · [7. Async](hands-on/7/index.md) |
| **Operating at scale** | [9. Reliability](classes/reliability/index.md) · [10. Observability](classes/observability/index.md) · [11. Network & Security](classes/network-security/index.md) · [12. Cloud-Native](classes/cloud-native/index.md) | [8. Observability](hands-on/8/index.md) · [9. Resilience & chaos](hands-on/9/index.md) · [10. Kubernetes](hands-on/10/index.md) · [11. Delivery](hands-on/11/index.md) |
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
