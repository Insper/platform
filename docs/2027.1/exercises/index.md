Lectures and labs show you how things work; the exercises make you **do it on your own and prove it with numbers**. Each individual exercise trains one skill a system designer uses every week: estimating, composing components, measuring, caching, going asynchronous, autoscaling and writing a design down so that someone else can review it. The [team project](project/index.md) then puts everything together in one system that you build, load test, break on purpose and defend.

!!! abstract "What the exercises are for"

    By the end of the exercises you will be able to:

    - **Estimate** load, storage and bandwidth of a system before building it, and use those numbers to pick components.
    - **Compose** palette components into a design that meets latency, availability and cost goals — and explain why it works.
    - **Measure** a real service with k6, read percentiles and find its bottleneck.
    - **Change** an architecture (cache, replica, queue, autoscaler) and **prove** the effect with a before/after experiment.
    - **Communicate** a design as a design document with ADRs and defend it orally.

## Overview

| # | Exercise | What it trains | Related class / lab | Due | Weight | Delivery |
|:-:|-|-|-|:-:|:-:|-|
| 1 | [Estimation](estimation/index.md) | Back-of-the-envelope numbers for 5 systems | [Class 2](../classes/estimation/index.md) · [Lab 2](../hands-on/2/index.md) | Week 3 | 10% | Page with the estimation sheet |
| 2 | [Load-test report](load-test-report/index.md) | k6 campaign, percentiles, the knee, bottleneck analysis | [Class 2](../classes/estimation/index.md) · [Labs 2–3](../hands-on/2/index.md) | Week 6 | 15% | Page + k6 scripts + raw results |
| 3 | [Cache & database](cache-db/index.md) | Cache-aside + read replica, before/after | [Classes 6–7](../classes/caching/index.md) · [Labs 5–6](../hands-on/5/index.md) | Week 8 | 15% | Page + code + measurements |
| 4 | [Event-driven](event-driven/index.md) | Transactional outbox + idempotent consumer + DLQ | [Class 8](../classes/messaging/index.md) · [Lab 7](../hands-on/7/index.md) | Week 10 | 15% | Page + code + failure demo |
| 5 | [Kubernetes autoscaling](kubernetes-autoscaling/index.md) | Probes, requests/limits, HPA under k6 load | [Class 12](../classes/cloud-native/index.md) · [Lab 10](../hands-on/10/index.md) | Week 14 | 10% | Page + manifests + video |
| 6 | [Playground design](playground-design/index.md) | Composing components to meet SLO + cost goals, under randomness | [Playground](../../playground/index.md) · Classes 4–13 | Week 15 | 15% | Exported JSON + rationale + run reports |
| 7 | [Design doc](design-doc/index.md) | Written design + ADRs for an interview problem, oral defence | [Class 16](../classes/case-studies/index.md) · [Interview](../support/interview/index.md) | Week 17 | 20% | Design doc page + ADRs + oral defence |
| | [Team project](project/index.md) | Build, measure, break and defend a whole system | All | Weeks 3–20 | — | Repository + docs + presentation |

!!! info "Weeks are relative"

    "Week *n*" is the *n*-th week of the semester. The calendar dates, the quiz days and the exam days are on the [planning page](../planning.md). Unless the instructor announces otherwise, an exercise is due on the **last class day of its week, at 23:59**. The weights are the share of each exercise inside the *exercises* component of the grade; how that component enters the final grade is on the [course page](../index.md).

## How the exercises are graded

Every exercise and every project deliverable receives a **concept grade**, as in the previous editions (Insper's *Notas da Engenharia*):

| Concept | Grade |
|:-:|:-:|
| A (+) | 9 (10) |
| B (+) | 7 (8) |
| C (+) | 5 (6) |
| D | 4 |
| I | 0 |

Each exercise page has a **rubric**: one row per criterion and one column per level. The levels always mean the same thing:

| Level | Meaning |
|:-:|-|
| **I** | Not delivered, not reproducible, copied, results that were not produced by you — or the oral check failed. |
| **D** | Delivered, but at least one *mandatory* requirement is missing or wrong. |
| **C** | Every mandatory requirement is met; the analysis is shallow (numbers shown, little explanation). |
| **B** | C, plus a sound analysis: the numbers support the conclusions, trade-offs are named, the page is clear. |
| **A** | B, plus depth: an extra experiment or comparison, a non-obvious insight, polished and fully reproducible. |

The final concept of a deliverable is the level that best describes **most** criteria; a criterion marked **(mandatory)** caps the grade at D when it is not met. The **+** is given when the work clearly goes beyond the level's description.

!!! tip "Acceptance criteria first"

    Every exercise lists its **requirements** as a checklist. Before submitting, tick every box in your own copy. A checklist with an unticked mandatory item is the most common reason for a D.

## General rules

### Repository and documentation

- [ ] **One GitHub repository per student** for the individual exercises (public, or private with the instructor and the teaching assistant added as collaborators). Suggested name: `sysdesign-<your-github-user>`.
- [ ] **Documentation published on GitHub Pages**, built with MkDocs Material or Zensical — you may start from the [documentation template](https://hsandmann.github.io/documentation.template/){target="_blank"}. One page per exercise, linked from the home page, with your name and GitHub user on the home page.
- [ ] **Everything needed to reproduce your results is in the repository**: code, `compose.yaml`/manifests, k6 scripts, raw results (k6 summary JSON, CSV), screenshots and a short "how to run" section. Do not commit secrets: use `.env.example` and GitHub secrets.
- [ ] **The delivery is a tag**: create the tag `ex<n>` (e.g. `ex3`) on the commit you want graded and submit the Pages link and the tag on Blackboard. Commits after the tag are ignored for that exercise.
- [ ] Code for the labs and exercises starts from the **course repository** ([repo-classes/pma271](https://github.com/repo-classes/pma271){target="_blank"}); say in your page which parts you changed.

### Use of AI tools

AI tools (chat assistants, code assistants, agents) **are allowed** — they are part of how software is built in 2026, and learning to use them well is part of the course. The rules:

1. **You are responsible for every line and every number.** If you submit it, you must be able to explain it, run it and change it on the spot.
2. **Declare the use.** Each exercise page ends with an *AI usage* section: which tools, for what (e.g. "generated the k6 script skeleton", "reviewed my ADR"), and what you checked or changed yourself.
3. **Measurements cannot be generated.** Numbers, charts and screenshots must come from runs you did. Invented or "adjusted" results are graded **I**, and are treated as an academic integrity issue.
4. **Text written by a model still has to be right.** Wrong statements written confidently cost more than an honest "we did not test this".

!!! danger "Oral check"

    **Any** exercise or project grade may be validated in a short oral check (5–10 minutes): explain a decision, re-run an experiment, change a parameter and predict the result, or walk through a piece of code. If the check shows that you cannot explain your own delivery, that grade becomes **I**. The [design doc](design-doc/index.md) always has an oral defence.

### Late policy

!!! warning "Late policy — to be defined by the instructor"

    *Placeholder.* The rules for late deliveries (grace period, penalty per day, maximum delay, missed oral checks) will be announced by the instructor at the beginning of the semester and published here.

### Collaboration

Discussing ideas with classmates is encouraged; **sharing code, results or text of individual exercises is not**. If a classmate helped you, say so in the page (as you do for AI). Team work happens in the [project](project/index.md), where the rules for teams are described.

## Suggested page structure

Every exercise page in your documentation should be easy to grade. Use this skeleton (each exercise adds its own template on top of it):

=== "English"

    ~~~markdown
    # Exercise <n> — <title>

    **Student:** <name> (<github-user>) · **Tag:** ex<n> · **Date:** <yyyy-mm-dd>

    ## Summary
    Three to five lines: what you did, the main result (with a number), the main lesson.

    ## Requirements checklist
    - [x] requirement 1 — where to find the evidence (link/section)
    - [x] requirement 2 — ...

    ## Setup
    Machine (CPU, RAM, OS), versions (Docker, JDK, k6...), how to reproduce (commands).

    ## Work
    The exercise-specific sections (see the exercise template).

    ## Results and discussion
    Tables/charts from your runs. What the numbers mean. What surprised you.

    ## AI usage
    Tools used, for what, and what you verified or changed yourself.

    ## References
    ~~~

=== "Português"

    ~~~markdown
    # Exercício <n> — <título>

    **Aluno(a):** <nome> (<usuário-github>) · **Tag:** ex<n> · **Data:** <aaaa-mm-dd>

    ## Resumo
    Três a cinco linhas: o que você fez, o resultado principal (com um número), a principal lição.

    ## Checklist de requisitos
    - [x] requisito 1 — onde está a evidência (link/seção)
    - [x] requisito 2 — ...

    ## Ambiente
    Máquina (CPU, RAM, SO), versões (Docker, JDK, k6...), como reproduzir (comandos).

    ## Desenvolvimento
    As seções específicas do exercício (veja o template do exercício).

    ## Resultados e discussão
    Tabelas/gráficos das suas execuções. O que os números significam. O que te surpreendeu.

    ## Uso de IA
    Ferramentas usadas, para quê, e o que você verificou ou alterou por conta própria.

    ## Referências
    ~~~

You may write your documentation in English or Portuguese.
