Fifteen minutes to show a semester of work. The final presentation is not a tour of every class you used — it is a **design review**: here is the problem, here is the architecture and why, here it is running under load, here is the evidence that it meets its SLOs, here is what broke on game day, here is what it costs, and here is what we would do next. Then the reviewers ask questions — to **each** member.

!!! abstract "Goals"

    With this milestone your team will:

    - **Tell** the story of the system in a structured, time-boxed talk aimed at engineers.
    - **Demonstrate** the core path live, under load, with dashboards — and have a fallback.
    - **Defend** decisions and numbers: ADRs, load-test results, game-day findings, cost.
    - **Show** individual mastery in the Q&A: every member explains and changes any part of the system.
    - **Publish** the final documentation and a 3-minute video.

Presentations happen in **weeks 19–20** (schedule published by the instructor); weight **10%** of the project. The [documentation quality](../index.md#documentation-quality-rubric) of the whole site is graded at the same time.

## What to deliver

- **Slides** (PDF or a link in the docs), following the [outline](#templates).
- A **live demo** during the presentation, plus a **fallback recording** of the same demo.
- A **3-minute video** of the project (link in the docs).
- The **final documentation** on GitHub Pages and the final tag `final`.

## Acceptance criteria

- [ ] **(mandatory)** **Every member presents** a part of the talk and answers individual questions.
- [ ] **(mandatory)** Talk within **15 minutes** (hard stop), followed by **10 minutes** of Q&A.
- [ ] The architecture diagram uses **palette ids** and matches the deployed system (the final design doc).
- [ ] A **live demo** of the core path **under load** with the dashboards visible (or the fallback recording, if the live demo fails — say so).
- [ ] Load-test results **against the target SLOs** (M6), game-day findings (M7) and cost per business unit (M8) presented with numbers.
- [ ] At least **two ADRs** presented as decisions with alternatives and consequences.
- [ ] **3-minute video** published and linked; it stands alone for someone who did not attend.
- [ ] Final docs checklist complete and tag `final` pushed before the presentation day.
- [ ] *AI usage* section in the final docs (see the [policy](../../index.md#use-of-ai-tools)).

## Step by step

### 1. Structure the 15 minutes

| Min | Section | What the audience must leave with |
|:-:|-|-|
| 0–1 | Problem and requirements | The system option, the users, the design and test targets, the SLOs |
| 1–4 | Architecture | One diagram with palette ids; the request path of the core use case; data ownership |
| 4–6 | Key decisions | Two or three ADRs: the decision, the alternatives, the trade-off |
| 6–10 | Live demo under load | The core path working while k6 runs; RED dashboard; one trace |
| 10–12 | Evidence | Load-test campaign vs SLOs (knee, bottleneck, iterations); game-day findings |
| 12–14 | Cost | Monthly cost at the design target, cost per unit, the biggest lever |
| 14–15 | Lessons and next steps | What you would change, what the system would need at 10× |

Split the sections so that **every member** presents something substantial (not only the title slide). Rehearse with a timer; the stop at 15:00 is real.

### 2. Prepare the demo — and its fallback

Live demos fail for boring reasons: Wi-Fi, a cluster that did not start, an expired token. Prepare like an operator:

- [ ] Environment started **30 minutes before**, data seeded, caches warmed, dashboards open in a browser tab, terminal font enlarged.
- [ ] A **demo script**: the exact commands and clicks, in order, with what the audience should notice at each step.
- [ ] A load generator at a **known rate** (e.g. 50–70% of the test target) started at the beginning of the demo.
- [ ] A **fallback recording** of the same demo (screen capture with voice), ready to play if anything breaks.
- [ ] One person drives, another narrates.

```bash title="demo/start.sh"
#!/usr/bin/env bash
# Prepare the live demo: seed, warm up, start the background load.
set -euo pipefail
./load/seed.sh
k6 run -e TEST_TYPE=smoke -e BASE_URL="${BASE_URL:-http://localhost:8080}" load/boxoffice.js > /dev/null
nohup k6 run -e TEST_TYPE=load -e BASE_URL="${BASE_URL:-http://localhost:8080}" \
  -e BROWSE_RATE="${BROWSE_RATE:-600}" -e HOLD_RATE="${HOLD_RATE:-60}" \
  load/boxoffice.js > demo/k6-live.log 2>&1 &
echo "background load started (pid $!) — open the RED dashboard now"
```

### 3. Record the 3-minute video

The video is for someone who never saw the course: a recruiter, a future teammate. Suggested cut: problem and SLOs (20 s), architecture (40 s), the system under load with dashboards (60 s), one result from the campaign and one from the game day (40 s), cost and lessons (20 s). Keep it under **3 minutes**; subtitles or clear audio; show the team.

### 4. Prepare for the Q&A

Questions go to **individuals**, and any member may be asked about any part of the system. Expect questions such as:

- "Walk me through what happens, component by component, when a fan holds a seat. Where can it fail?"
- "Your p99 at the target was 180 ms. What dominates it? How do you know?"
- "If traffic grows 10×, what breaks first? What would you change, and what would it cost?"
- "Why Kafka and not a simple queue here? What would make you change your mind?"
- "Show me the alert that fired on game day. What is its burn-rate window, and why?"
- "This part was written with AI help. Explain it, and change this parameter: what happens?"

### 5. Finish the documentation

- [ ] Home page: team, ownership table, system option, one-paragraph summary, architecture diagram, links to every milestone.
- [ ] Final design doc and ADRs (with the changelog since M1).
- [ ] Load-test campaign report, game-day report, cost report.
- [ ] How to run: Compose and Kubernetes, seed data, run a load test — tested from a clean clone.
- [ ] Links: repository, CI runs, slides, video, demo recording.
- [ ] AI usage per deliverable.
- [ ] Tag `final` pushed; the site built from it.

## Templates

=== "English"

    ~~~markdown
    # <System name> — final presentation (15 min)

    1. Title — team members, system option (who presents what)
    2. Problem — users, core use cases, design target vs test target
    3. SLOs — table: SLI, target, measured (M6)
    4. Architecture — diagram with palette ids; core request path
    5. Data — who owns what; consistency of the critical write
    6. Decision 1 (ADR) — context, options, decision, consequences
    7. Decision 2 (ADR) — ...
    8. Live demo — what to watch: <dashboard panels>, <trace>
    9. Load-test campaign — knee chart, bottleneck, 2 iterations (before/after)
    10. Game day — experiments, confirmed/refuted, surprise fault TTD/TTM
    11. Cost — monthly cost at the design target, cost per <unit>, top lever
    12. Lessons — what we would change; what 10× would need
    13. Thank you — links: docs, repository, video
    ~~~

=== "Português"

    ~~~markdown
    # <Nome do sistema> — apresentação final (15 min)

    1. Título — membros do time, opção de sistema (quem apresenta o quê)
    2. Problema — usuários, casos de uso principais, meta de design vs meta de teste
    3. SLOs — tabela: SLI, meta, medido (M6)
    4. Arquitetura — diagrama com ids da paleta; caminho da requisição principal
    5. Dados — quem é dono do quê; consistência da escrita crítica
    6. Decisão 1 (ADR) — contexto, opções, decisão, consequências
    7. Decisão 2 (ADR) — ...
    8. Demo ao vivo — o que observar: <painéis do dashboard>, <trace>
    9. Campanha de testes de carga — gráfico do joelho, gargalo, 2 iterações (antes/depois)
    10. Game day — experimentos, confirmados/refutados, falha surpresa TTD/TTM
    11. Custo — custo mensal na meta de design, custo por <unidade>, principal alavanca
    12. Lições — o que mudaríamos; o que 10× exigiria
    13. Obrigado — links: documentação, repositório, vídeo
    ~~~

## Rubric

Levels as defined in [How the exercises are graded](../../index.md#how-the-exercises-are-graded). The individual Q&A can adjust a member's grade (see the [team rules](../index.md#team-rules)).

| Criterion | I | D | C | B | A |
|-|-|-|-|-|-|
| Participation and time **(mandatory)** | A member absent without justification | A member does not present, or > 17 min | Every member presents; within 15 min | Balanced parts; smooth hand-offs | Talk adapted to questions on the fly |
| Story and architecture | — | List of technologies | Problem → SLOs → architecture → decisions | Diagram with palette ids matches the deployed system; trade-offs explicit | A reviewer could redraw the system after the talk |
| Live demo | Nothing shown | Fallback recording only, without explanation | Core path works under load with dashboards | Demo tied to SLIs ("watch p99 here") | Failure shown live and the system recovering |
| Evidence | — | Claims without numbers | M6, M7 and M8 numbers presented | Numbers interpreted (knee, bottleneck, cost per unit) | Clear "what we would do at 10×" with cost |
| Q&A (individual) | Cannot explain own work | Vague answers | Correct answers on own area | Correct answers on any area | Reasons about changes on the spot with numbers |
| Video and final docs | Missing | Video > 3 min or docs incomplete | Video ≤ 3 min; docs checklist complete | Video stands alone; docs reproducible from a clean clone | Portfolio quality |

## FAQ

??? question "Can we present only a recording instead of a live demo?"

    The live demo is expected; the recording is the **fallback**. If the live demo fails, switch to the recording without losing time and say what failed — handling it calmly is itself a good signal.

??? question "Do we need slides for every milestone?"

    No. The talk is a story, not a report: pick the decisions, numbers and findings that best show how the system meets (or misses) its SLOs. Details live in the docs.

??? question "Who answers the questions?"

    The person asked. Others may complement after the answer. Questions are distributed among all members and may cover any part of the system.

??? question "Is the video the same as the demo recording?"

    No. The demo recording is a backup of the live demo; the video is a 3-minute overview of the whole project for people who did not attend.

??? question "Can AI make our slides?"

    It can help with layout and wording — declare it. The content, the numbers and the answers in the Q&A must be yours.
