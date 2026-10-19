Most architecture decisions in real companies are not made in front of a whiteboard: they are made in a **design document** that colleagues read, question and approve — and in the **ADRs** (Architecture Decision Records) that remind everyone, a year later, *why* things are the way they are. In an interview the same thinking happens out loud in 45 minutes. In this exercise you do both: you write a complete design doc with ADRs for a classic system-design problem, and then you **defend it orally**, including a change of requirements you did not see coming.

!!! abstract "Learning objectives"

    After this exercise you will be able to:

    - **Scope** a vague problem into functional and non-functional requirements with numbers.
    - **Design** a system end to end — estimates, API, data model, high-level architecture with palette components, deep dives.
    - **Evaluate** alternatives and record decisions as ADRs with their consequences.
    - **Identify** bottlenecks, failure modes, security and operability concerns, and cost.
    - **Defend** a design orally and **adapt** it to a new requirement on the spot.

## Context

The structure of a good design doc follows the [interview framework](../../classes/intro/interview-framework/index.md) of Class 1 — clarify → estimate → API & data model → high-level design → deep dives → bottlenecks & trade-offs → wrap-up — and the [interview guide](../../support/interview/framework/index.md). The [case studies](../../classes/case-studies/index.md) of Class 16 show complete worked examples; the [component catalog](../../reference/components/index.md) gives the vocabulary (use the palette ids in your diagrams). A design doc is not a list of technologies: every component must be **justified by a requirement or a number**, and every important choice must name the **alternative you rejected**[^1].

## Task

1. You receive **one problem** from the [list below](#problems) by draw (at most two students per problem).
2. Write a **design doc** following the [template](#templates), for the scale stated in the problem.
3. Record **at least three ADRs** for the decisions that matter most.
4. Optionally, prototype the design in the [playground](../../../playground/index.md) (start from `blank`) and attach the exported JSON.
5. **Defend** the design in a 15-minute [oral defence](#oral-defence).

## Requirements

- [ ] **(mandatory)** Design doc with every section of the template (a section may say "not applicable — because …").
- [ ] **(mandatory)** At least **three ADRs**, each with context, options considered, decision and consequences (positive and negative).
- [ ] **(mandatory)** Oral defence done (failing it, or not showing up, grades the exercise **I**).
- [ ] Requirements: 3–6 functional, non-functional **with numbers** (latency percentiles, availability, durability, scale), explicit out-of-scope list.
- [ ] Estimates: QPS (average and peak, reads/writes), storage, bandwidth, cache, number of servers — formulas shown (as in the [estimation exercise](../estimation/index.md)).
- [ ] API (endpoints or messages, with request/response) and data model (entities, keys, chosen store **and why**, partition key if any).
- [ ] High-level diagram using **palette component ids** (`lb`, `apigw`, `app`, `cache`, `sql`, `kafka`, …) and a walk-through of the two most important request flows.
- [ ] At least **two deep dives** on the hardest parts of the problem.
- [ ] Bottlenecks at 10× scale, failure modes with detection and mitigation, security, observability (SLIs/SLOs/alerts) and an order-of-magnitude cost.
- [ ] *AI usage* section (see the [policy](../index.md#use-of-ai-tools)).

## Deliverables

On your documentation site (tag `ex7`): a page `design-doc` with the design doc and one page (or section) per ADR, numbered `ADR-001`, `ADR-002`, …; diagrams as Mermaid or images with their source; optional playground JSON in `playground/design-doc.json`. Bring the page open to the oral defence.

## Step by step

1. **Clarify (≈ 10% of the effort).** Write down the questions you would ask an interviewer and answer them yourself as assumptions: who are the users, what are the core use cases, what scale, what matters more — latency, consistency, cost?
2. **Estimate.** Turn the scale into QPS, storage, bandwidth and memory. Mark which numbers **force** a design decision (e.g. "10 TB/day of writes → not a single SQL primary").
3. **API and data model.** Define the contract before the boxes. Choose the store per entity from the access pattern, not from habit.
4. **High-level design.** Draw the simplest design that meets the functional requirements, then walk the main requests through it.
5. **Deep dives.** Pick the two or three parts where the problem is actually hard (ordering, hot keys, fan-out, exactly-once, consistency, real-time, cost of LLM calls…) and go deep: alternatives, numbers, failure behaviour.
6. **Bottlenecks and failures.** What breaks first at 10×? What happens when each dependency is slow or down? How do you detect it?
7. **Write the ADRs** for the decisions you would want a newcomer to understand in a year.
8. **Wrap-up.** Summarise the design in five lines, list the open questions and the risks you accept.
9. **Rehearse the defence.** Explain the design in 5 minutes to a classmate and let them change one requirement.

!!! tip "In the interview"

    The same document, compressed into 45 minutes, is a system-design interview. Practising the written version first makes the spoken version faster: you already know your numbers, your trade-offs and your weak spots.

## Problems

| # | Problem | Scope | Key challenge |
|:-:|-|-|-|
| 1 | Web crawler | Crawl 1 B pages per month, politely, and store them for indexing | URL frontier, politeness per host, de-duplication |
| 2 | Collaborative document editor | Real-time co-editing of text documents, up to 50 editors per document | Conflict resolution (OT or CRDT), presence, history |
| 3 | Distributed job scheduler | Run millions of cron-like and one-off jobs per day with at-least-once guarantees | Leader election, exactly one execution per schedule, retries |
| 4 | Metrics and monitoring platform | Ingest metrics from 100 k hosts, query dashboards, fire alerts | Write-heavy time series, downsampling, cardinality |
| 5 | Game leaderboard | Global and friends leaderboards for a game with 50 M daily players | Top-K at write speed, sorted sets, sharding a ranking |
| 6 | Hotel booking | Search availability and book rooms across 1 M hotels | Inventory consistency, overbooking, search vs booking paths |
| 7 | Food delivery | Restaurants, orders, courier assignment and tracking in one country | Three-sided marketplace, geo matching, order state machine |
| 8 | File sync (Dropbox-like) | Sync files across devices for 50 M users | Chunking, de-duplication, metadata consistency, conflicts |
| 9 | Ad click aggregator | Count ad clicks in near real time for billing and dashboards | Stream processing, exactly-once counting, late events |
| 10 | Webhook delivery platform | Deliver events from a SaaS to millions of customer endpoints | Retries with backoff, ordering, slow or hostile receivers |
| 11 | Proximity service | "Restaurants near me" for 200 M users | Geospatial index (geohash, quadtree), read-heavy, updates |
| 12 | Online code judge | Students submit code that is compiled, run and graded | Sandboxing, queueing bursts before deadlines, fairness |
| 13 | LLM document Q&A for a university | Students ask questions about course documents; answers cite sources | RAG pipeline, cost per question, guardrails, freshness |

The instructor runs the draw in class (or publishes it on Blackboard). Two students with the same problem write **independent** documents — they will be compared.

## Oral defence

The defence takes **15 minutes**, with your design doc on the screen:

1. **5 minutes — walk-through.** Requirements and numbers, the diagram, the two main flows, the decision you are most proud of.
2. **10 minutes — questions.** Including **one curveball**: a change of requirement you must handle live, for example:
    - traffic grows **10×** (or one key/user becomes 1,000× hotter);
    - the system must run in a **second region** with a regional outage tolerated;
    - a **new feature** (e.g. search, notifications, an AI assistant) must be added;
    - the budget is cut by **half**;
    - a component you chose is **not allowed** (e.g. no Kafka, no NoSQL).

Example questions:

- "Which number in your estimates drives the biggest decision? What if it is wrong by 10×?"
- "Walk me through what happens when `<dependency>` takes 5 seconds to answer."
- "Why this store and not `<alternative>`? What would make you change your mind?"
- "Where can data be lost or duplicated? How do you know it did not happen?"
- "What do you alert on? Who is woken up, and what do they look at first?"
- "Which ADR would you revisit first, and why?"

Understanding is what is graded: you may say "I did not consider that" and then reason about it. Reading the document aloud is not a defence.

## Templates

=== "English"

    ~~~markdown
    # Design doc — <system>

    **Author:** <name> · **Status:** draft | in review | final · **Date:** <yyyy-mm-dd> · **Reviewers:** <names>

    ## 1. Context and goals
    What problem, for whom, why now. Goals and non-goals.

    ## 2. Requirements
    ### Functional
    1. ...
    ### Non-functional
    | Attribute | Target |
    |-|-|
    | Latency | p99 < ... ms for ... |
    | Availability | ...% per month |
    | Durability | ... |
    | Scale | ... DAU, ... req/s peak |
    | Consistency | ... |
    ### Out of scope
    - ...

    ## 3. Estimates
    | Quantity | Formula | Result |
    |-|-|-|
    Numbers that force decisions: ...

    ## 4. API
    | Method | Path / message | Request | Response | Notes (idempotency, auth) |
    |-|-|-|-|-|

    ## 5. Data model
    | Entity | Key | Main fields | Store | Why this store | Partition key |
    |-|-|-|-|-|-|

    ## 6. High-level design
    ```mermaid
    flowchart LR
        client --> lb --> app --> cache
        app --> sql
    ```
    Walk-through of flow 1: ...
    Walk-through of flow 2: ...

    ## 7. Deep dives
    ### 7.1 <hard part>
    Options, numbers, decision (see ADR-00x), failure behaviour.
    ### 7.2 <hard part>

    ## 8. Scalability and bottlenecks
    What breaks first at 10×, and the plan.

    ## 9. Reliability and failure modes
    | Failure | Impact | Detection | Mitigation |
    |-|-|-|-|

    ## 10. Security and privacy
    Authentication, authorization, secrets, sensitive data, abuse.

    ## 11. Observability
    | SLI | SLO | How measured | Alert |
    |-|-|-|-|

    ## 12. Cost
    Order of magnitude per month and the main cost drivers.

    ## 13. Alternatives considered
    | Alternative | Why not |
    |-|-|

    ## 14. Risks and open questions

    ## 15. Decisions
    - ADR-001 — ...
    - ADR-002 — ...
    - ADR-003 — ...

    ## 16. AI usage

    ## 17. References
    ~~~

=== "Português"

    ~~~markdown
    # Design doc — <sistema>

    **Autor(a):** <nome> · **Status:** rascunho | em revisão | final · **Data:** <aaaa-mm-dd> · **Revisores:** <nomes>

    ## 1. Contexto e objetivos
    Qual problema, para quem, por que agora. Objetivos e não objetivos.

    ## 2. Requisitos
    ### Funcionais
    1. ...
    ### Não funcionais
    | Atributo | Meta |
    |-|-|
    | Latência | p99 < ... ms para ... |
    | Disponibilidade | ...% por mês |
    | Durabilidade | ... |
    | Escala | ... DAU, ... req/s no pico |
    | Consistência | ... |
    ### Fora do escopo
    - ...

    ## 3. Estimativas
    | Grandeza | Fórmula | Resultado |
    |-|-|-|
    Números que obrigam decisões: ...

    ## 4. API
    | Método | Caminho / mensagem | Requisição | Resposta | Observações (idempotência, autenticação) |
    |-|-|-|-|-|

    ## 5. Modelo de dados
    | Entidade | Chave | Campos principais | Armazenamento | Por que este armazenamento | Chave de partição |
    |-|-|-|-|-|-|

    ## 6. Design de alto nível
    ```mermaid
    flowchart LR
        client --> lb --> app --> cache
        app --> sql
    ```
    Percurso do fluxo 1: ...
    Percurso do fluxo 2: ...

    ## 7. Aprofundamentos
    ### 7.1 <parte difícil>
    Opções, números, decisão (veja ADR-00x), comportamento sob falhas.
    ### 7.2 <parte difícil>

    ## 8. Escalabilidade e gargalos
    O que quebra primeiro com 10×, e o plano.

    ## 9. Confiabilidade e modos de falha
    | Falha | Impacto | Detecção | Mitigação |
    |-|-|-|-|

    ## 10. Segurança e privacidade
    Autenticação, autorização, segredos, dados sensíveis, abuso.

    ## 11. Observabilidade
    | SLI | SLO | Como é medido | Alerta |
    |-|-|-|-|

    ## 12. Custo
    Ordem de grandeza por mês e os principais fatores de custo.

    ## 13. Alternativas consideradas
    | Alternativa | Por que não |
    |-|-|

    ## 14. Riscos e questões em aberto

    ## 15. Decisões
    - ADR-001 — ...
    - ADR-002 — ...
    - ADR-003 — ...

    ## 16. Uso de IA

    ## 17. Referências
    ~~~

### ADR template

Each ADR is short (one page) and **immutable once accepted**: if the decision changes, write a new ADR that *supersedes* the old one[^2].

=== "English"

    ~~~markdown
    # ADR-00x — <decision in a few words>

    **Status:** proposed | accepted | superseded by ADR-00y · **Date:** <yyyy-mm-dd> · **Deciders:** <names>

    ## Context
    The situation and the forces at play (requirements, numbers, constraints).

    ## Decision drivers
    - <driver 1, e.g. p99 < 200 ms on reads>
    - <driver 2, e.g. team knows PostgreSQL>

    ## Considered options
    1. <option A>
    2. <option B>
    3. <option C>

    ## Decision
    We choose <option>, because <reasons tied to the drivers>.

    ## Consequences
    - Positive: ...
    - Negative: ... (and how we live with them)

    ## Confirmation
    How we will know the decision works (a test, a metric, a review date).

    ## Links
    Design doc section, related ADRs, references.
    ~~~

=== "Português"

    ~~~markdown
    # ADR-00x — <decisão em poucas palavras>

    **Status:** proposta | aceita | substituída pela ADR-00y · **Data:** <aaaa-mm-dd> · **Decisores:** <nomes>

    ## Contexto
    A situação e as forças em jogo (requisitos, números, restrições).

    ## Fatores de decisão
    - <fator 1, por exemplo p99 < 200 ms nas leituras>
    - <fator 2, por exemplo o time conhece PostgreSQL>

    ## Opções consideradas
    1. <opção A>
    2. <opção B>
    3. <opção C>

    ## Decisão
    Escolhemos <opção>, porque <motivos ligados aos fatores>.

    ## Consequências
    - Positivas: ...
    - Negativas: ... (e como convivemos com elas)

    ## Confirmação
    Como saberemos que a decisão funciona (um teste, uma métrica, uma data de revisão).

    ## Links
    Seção do design doc, ADRs relacionadas, referências.
    ~~~

## Rubric

Levels as defined in [How the exercises are graded](../index.md#how-the-exercises-are-graded). The written document and the oral defence are graded together; the defence weighs as much as all written criteria combined.

| Criterion | I | D | C | B | A |
|-|-|-|-|-|-|
| Requirements and scope | Missing | Vague, no numbers | Functional + non-functional with numbers + out of scope | Prioritised; the hard requirements identified | Ambiguities found and resolved with explicit assumptions |
| Estimates | Missing | Wrong orders of magnitude | Complete with formulas | Numbers drive decisions explicitly | Sensitivity: which estimate changes the design if wrong |
| API and data model | Missing | Incomplete | Complete, store chosen per entity | Access patterns justify stores and keys | Idempotency, pagination, versioning handled |
| High-level design | Missing | Boxes without flows | Diagram with palette ids + two flows | Every component justified by a requirement | Simplest design that works, evolution path shown |
| Deep dives and trade-offs | — | Shallow | Two deep dives with options | Numbers and failure behaviour in each | Insight beyond the classic solution |
| Reliability, security, operations, cost | — | One area missing | All covered | Failure table with detection + SLOs with alerts | Cost and reliability traded off explicitly |
| ADRs **(mandatory)** | None | Fewer than three, or no alternatives | Three ADRs with options and consequences | Negative consequences honest, confirmation defined | ADRs a newcomer could act on |
| Writing | Unreadable | Disorganised | Clear and complete | Concise, diagrams carry the argument | Reviewer-ready: could be approved in a real company |
| Oral defence **(mandatory)** | Not done or cannot explain own design | Explains with difficulty, curveball not handled | Explains clearly, curveball partially handled | Handles the curveball with numbers and trade-offs | Reasons beyond the document, recognises and fixes a weakness live |

## FAQ

??? question "How long should the design doc be?"

    Long enough to cover every section, short enough to be read in 20–30 minutes: typically 6–12 pages with diagrams. Tables and diagrams beat paragraphs.

??? question "Can I base my design on a public article or a book chapter?"

    Yes — cite it. But the doc must show **your** reasoning for **your** numbers, and two students with the same problem are compared. Copied structure with different words is easy to spot in the defence.

??? question "Do I need to implement anything?"

    No. A playground prototype is optional and welcome. What matters is a design you can justify and defend.

??? question "Which technologies should I name?"

    Name categories first (palette ids: `kafka`, `nosql`, `cache`) and specific products only when the choice matters (e.g. PostgreSQL vs Cassandra for a write-heavy log). Every named product must have a reason.

??? question "What if I cannot answer the curveball?"

    Think out loud: restate the change, estimate its effect, find what breaks first, propose a fix and name its cost. A structured partial answer is graded much better than silence or a guess.

??? question "Can I use AI to write the doc?"

    You may use AI to review, question or improve your text — and declare it. The defence checks that the decisions are yours: if the document says it and you cannot explain it, the grade is I.

[^1]: Alex Xu, *System Design Interview — An Insider's Guide*, vol. 1, ch. 3 "A framework for system design interviews", 2020.
[^2]: Michael Nygard, "Documenting Architecture Decisions", 2011, [cognitect.com](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions){target="_blank"}; MADR template, [adr.github.io/madr](https://adr.github.io/madr/){target="_blank"}.
