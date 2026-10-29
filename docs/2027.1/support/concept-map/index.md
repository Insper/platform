---
hide:
  - navigation
  - toc
---

# Concept Map: System Design

Each class of System Architecture teaches a handful of ideas; the project, the exams and a system-design interview ask you to use them together. This map shows how they connect: 158 concepts from the 16 classes and 266 connections between them, each explained in one sentence.

**How it is organized.** Each concept sits in the **row** of the theme of the class where it first appears, in course order: Foundations (C1–C2), Distributed systems (C3), Edge & compute (C4–C5), Storage (C6–C7), Messaging (C8), Operations (C9–C12), AI (C13–C14), Performance & cases (C15–C16). Its **column** is the stage of a design it belongs to, the same order in which you build and defend a design, at work or in an interview:

| Column | What it holds | Colour |
|---|---|---|
| Requirements & numbers | what must hold and how much: requirements, estimates, Little's Law, percentiles, nines, SLOs, capacity, cost | blue |
| Building blocks | the components of the palette and how each one works: DNS, CDN, load balancer, gateway, queue, Kafka, cache, Kubernetes, LLM gateway… | purple |
| Data & consistency | state and correctness: replication, consistency models, quorums, transactions, idempotency, ordering, invalidation, outbox, sagas | teal |
| Operate at scale | keeping it up and safe in production: failure modes, resilience patterns, observability, alerting, delivery, security, load tests, chaos | orange |

Reading a row from left to right tells the story of a class: the numbers that motivate it, the components it adds, the correctness questions they raise and how they fail in production. Reading a column from top to bottom shows one skill growing through the course. The code in the corner of each concept is the class page where it first appears (C9.2 = class 9, second page of its roadmap). The colours are the same as in the [study cards](../flashcards/index.md); blue, purple and orange also mean *estimate*, *design* and *deep dive* in the [workbook](../workbook/index.md) and the [cheat sheet](../cheat-sheet/index.md).

Four ways to use it:

- **Tap a concept.** Its neighbours light up and the panel shows what it is, the classes where it is taught (linked to the section) and, one sentence each, where it leads and where it comes from. Tap a neighbour to follow the thread.
- **Follow a trail.** Each trail walks through one of the course's questions, step by step, such as "why does p99 explode while the CPU is idle?", "a flash sale without double booking" or "why your load test lies". Use ‹ › in the panel or the arrow keys.
- **Pick a class.** The buttons are grouped by theme; they light up the concepts the class introduces and the ones it revisits from earlier classes. Each button covers the class's subpages.
- **Search.** The search box finds a concept by name or by its definition (Enter opens the first match).

On a phone, the concepts are grouped by theme, the classes sit under one tab per theme and the panel slides up from the bottom of the screen; close it with ×.

<div class="dgm" data-dgm="mapa-arq" data-title="The concepts of System Architecture and how they connect"></div>

To practise the concepts one by one, use the [study cards](../flashcards/index.md); to see the method, the formulas and the numbers on paper, the [cheat sheet](../cheat-sheet/index.md); to practise with exercises, the [workbook](../workbook/index.md); to rehearse them out loud, the [interview preparation](../interview/index.md).
