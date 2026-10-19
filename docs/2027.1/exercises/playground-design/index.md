Knowing what a cache, a queue or a circuit breaker *is* is not the same as knowing **which ones a system needs, where, and how many**. In this exercise you get three designs that fail under load in the [System Design Playground](../../../playground/index.md) — a BoxOffice flash sale, a cascade caused by a slow dependency and an AI assistant that is too slow and too expensive — and you must make each one **meet its goals within its budget**, explain why your design works with the formulas of the course, and show that it still works when the dice are rolled again.

!!! abstract "Learning objectives"

    After this exercise you will be able to:

    - **Diagnose** a failing design from its metrics and test report (which goal fails, which node is the bottleneck, why).
    - **Compose** palette components and tune their parameters to meet latency, error, availability and cost goals.
    - **Justify** replica counts, timeouts and cache sizes with utilization, Little's Law, hit-ratio and cost arithmetic.
    - **Evaluate** robustness: tell a design that passes by luck from one that passes under random failures.
    - **Compare** alternatives and defend a trade-off between cost and reliability.

## Context

The playground simulates a design under a load profile (the same vocabulary as k6: `smoke`, `load`, `stress`, `spike`, `soak`, `breakpoint`, `chaos`). What you need for this exercise (the full manual is on the [playground page](../../../playground/index.md), the lessons of each scenario in the [scenario guide](../../../playground/scenarios/index.md)):

- **Scenario** — a starting design plus a brief, a load profile and **goals** (e.g. p99 below a threshold, error rate, availability, consumer lag) including a **cost goal** (US$/month, prices labelled *illustrative*). The brief and the goals appear in the inspector when nothing is selected.
- **Seed** — every random number (arrivals, latencies, failures) comes from one seeded generator. **Same seed + same design + same profile ⇒ identical run.** The seed is in the toolbar; the 🎲 button draws a new one.
- **Chaos level** — `off`, `low`, `medium`, `high`: how often random events happen (replica crashes, latency degradation of a dependency, traffic spikes, hot keys, cache flushes, zone outages, 3rd-party outages, bad deploys…).
- **Report** — when a run ends, the *Report* tab shows the profile, seed, duration, p50/p95/p99/p999, error rate, availability, cost, the **bottleneck** (the first node to saturate, with an explanation), the events that happened, and **pass/fail for each goal**.
- **Export / import JSON** — the toolbar saves the current design as a JSON file and loads it back. There is also a *share link* (the design encoded in the URL after `#sdp=`).

Design in the **full playground** (palette + inspector). The embeds on this page are *compact*: they show the scenario and run it, but you cannot add components there.

## Task

### Part A — Three challenges

For each scenario below, start from the scenario as loaded (do **not** change its profile, target load, read ratio or goals) and change the **design** until **every goal passes** at the scenario's default seed with chaos as defined by the scenario.

#### Challenge 1 — `flash-sale`

The BoxOffice on-sale at 10:00: a spike of fans hits the catalog and the seat inventory, and payments go to an external provider.

**Try it:** press ▶ and watch which node turns red first and when. Look at the report: which goal fails, and what does the bottleneck explanation say? Then ask: how many requests per second can the inventory database really accept, and who decides how many fans get there?

<div class="sdp" data-scenario="flash-sale" data-mode="compact" data-height="520"></div>

Things to reason about (not a recipe): what can be served without touching the inventory at all (static content, the catalog, seat availability that may be a few seconds old); what admission rate the inventory sustains (utilization below ~0.7); what happens to fans who are not admitted yet (a waiting room is a queue, and a queue has a backlog); where the payment provider's latency ends up.

#### Challenge 2 — `cascading-failure`

A 3rd-party dependency becomes slow; with no timeouts, threads pile up and a healthy service fails.

**Try it:** run it and look at the utilization of the app servers *and* their threads. CPU is low, yet requests fail — why? Apply Little's Law: what is `L = λ × W` when `W` grows from 150 ms to 3 s?

<div class="sdp" data-scenario="cascading-failure" data-mode="compact" data-height="520"></div>

Things to reason about: a timeout value derived from the dependency's normal p99 (not a guess); what a circuit breaker buys you and what it costs; whether a fallback (degraded response) is acceptable for this call; whether retries help or make it worse (see [`retry-storm`](../../../playground/scenarios/index.md)).

#### Challenge 3 — `ai-assistant`

The BoxOffice support assistant: an orchestrator calls an LLM through a gateway, retrieves context from a memory (RAG) and calls tools. It is slow and expensive.

**Try it:** run it and open the cost tile. Where does the money go? How many sequential LLM calls does one user request make, and what does that do to latency?

<div class="sdp" data-scenario="ai-assistant" data-mode="compact" data-height="520"></div>

Things to reason about: the number of agent steps (each step is a sequential LLM call); a semantic cache at the LLM gateway (what hit ratio is realistic for support questions?); routing simple questions to a cheaper model; where the safety mesh sits in the path; tokens × price = cost per request.

### Part B — Randomized robustness

A design that passes with one seed may pass by luck. Run your **final** design of each challenge with **5 seeds** and chaos level **`medium`**, keeping everything else as in Part A:

- The seeds are published by the instructor on Blackboard. If they are not published, use the last five digits of your enrollment number `S` and the seeds `S, S+1, S+2, S+3, S+4`.
- A challenge is **robust** when all goals pass in **at least 4 of the 5 seeds**.
- For every failing seed, read the event log and explain what happened (which random event, which goal, why your design did not absorb it).

The embed below shows the same scenario with a fixed seed and medium chaos — the settings you will use in the full playground:

<div class="sdp" data-scenario="flash-sale" data-mode="compact" data-height="520" data-seed="12345" data-chaos="medium"></div>

### The physics stays fixed

You change the **architecture**, not the laws of nature. Unless you justify it in the rationale (and the justification is accepted), do **not** edit:

- capacity per replica, service-time (`latencyMs`) and variability (`sigma`) of any component type;
- prices, and the latency, quota (`rateLimit`) or outage behaviour of external components (`payment`, `thirdparty`, `email`) and of the LLM;
- the scenario's goals, profile, target RPS and read ratio.

Cache and CDN hit ratios above **0.95**, and semantic-cache hit ratios above **0.4**, need a justification based on the workload (key popularity, repetition of questions).

!!! warning "The *Show a possible solution* button"

    Each scenario has a reference solution. You may load it and study it. A submission **identical (or nearly identical) to the reference solution is capped at C**. To reach B or A your design must be your own, and either **cheaper** than the reference at the same goals or **more robust** (passes more seeds at `medium`, or passes at `high`), and you must explain why.

## Requirements

- [ ] **(mandatory)** For each of the three challenges, the exported JSON imports into the playground and, with the default seed, **all goals pass** (including the cost goal).
- [ ] **(mandatory)** The physics rules above are respected (or each exception is justified).
- [ ] **(mandatory)** Part B: each challenge passes in **≥ 4 of 5 seeds** with chaos `medium`; a table shows seed × goal results.
- [ ] For each challenge, the **initial** report (failing) and the **final** report (passing), both showing the seed.
- [ ] A rationale per challenge with: diagnosis, numbered changes with their measured effect (iteration log), the arithmetic that justifies replica counts / timeouts / cache (utilization, Little's Law, hit ratio, cost), and at least one alternative you tried or rejected.
- [ ] For every failing seed in Part B, an explanation from the event log.
- [ ] A comparison with the reference solution (cost, robustness, structure).
- [ ] *AI usage* section (see the [policy](../index.md#use-of-ai-tools)).

## Deliverables

In your repository (tag `ex6`):

```text
playground/
├── flash-sale.json
├── cascading-failure.json
├── ai-assistant.json
└── reports/
    ├── flash-sale-initial.png
    ├── flash-sale-final-seed<seed>.png
    ├── flash-sale-medium-seed<seed>.png   # one per seed of Part B
    └── ...                                # same for the other two scenarios
```

Reports can be screenshots (`.png`) or the report text copied into a `.txt` file — what matters is that the **seed, profile, chaos level and goal results are visible**. On your documentation site, a page `playground-design` with one section per challenge and the Part B table. Share links (`#sdp=…`) are a welcome extra next to each design.

## Step by step

1. **Read the brief and the goals.** Write them down in your page: goal, threshold, and the budget.
2. **Run the scenario as it is** and save the initial report. Note the first goal that fails and the reported bottleneck.
3. **Make a hypothesis with numbers.** Example: "the inventory DB receives 4,000 writes/s and its capacity is 2,500 writes/s, so ρ = 1.6: it cannot work at any latency." Or: "W went from 0.15 s to 3 s, so each replica needs 20× more threads."
4. **Change one thing at a time** and run again with the **same seed**. Keep an iteration log: change → effect on the failing goal → effect on cost. Because the run is deterministic, a difference between two runs is caused by your change.
5. **Stop when every goal passes**, then **try to remove cost**: fewer replicas, smaller components, autoscaling instead of fixed capacity. Each removal must keep all goals passing.
6. **Export the JSON**, import it back in a fresh page and run again to check that you get the same report.
7. **Part B:** set chaos to `medium`, run the 5 seeds, fill the table, read the event log of every failure. If fewer than 4 pass, improve the design (redundancy, autoscaling, timeouts, fallbacks) and **rerun Part A** — the final design must pass both parts.
8. **Compare with the reference solution** and write the rationale.

!!! example "Worked arithmetic — sizing a node"

    Suppose the report shows that the `sql` node receives 1,800 req/s and one replica handles 1,000 req/s. With a target utilization of 0.7, `replicas = ⌈1,800 ÷ (1,000 × 0.7)⌉ = 3`. If a cache in front of it has a hit ratio `h = 0.9`, the database receives `(1 − 0.9) × 1,800 = 180 req/s` and one replica is enough (`ρ = 0.18`) — whether the cache is worth it is then a question of cost and of the consistency you can accept.

## Templates

=== "English"

    ~~~markdown
    ## Challenge: <scenario id>

    **Goals (from the brief):** p99 < ... ms · error rate < ...% · ... · cost < US$ .../month

    ### 1. Diagnosis (initial run, seed <seed>)
    - Failing goals: ...
    - Reported bottleneck: <node> — <explanation>
    - My reading of the numbers: λ = ... req/s, μ = ... req/s, ρ = ...; L = λ × W = ...

    ### 2. Iteration log
    | # | Change | Failing goal before → after | Cost before → after | Why it worked (or not) |
    |-|-|-|-|-|
    | 1 | | | | |
    | 2 | | | | |

    ### 3. Final design
    - Diagram: (screenshot or `export Mermaid`)
    - Final report (seed <seed>): all goals pass — p99 ..., errors ..., availability ..., cost ...
    - Sizing arithmetic: ...

    ### 4. Alternatives
    | Alternative | Result | Why rejected |
    |-|-|-|

    ### 5. Robustness (chaos = medium)
    | Seed | Goal 1 | Goal 2 | Goal 3 | Cost | Pass? | Events that hurt |
    |-|-|-|-|-|-|-|
    | | | | | | | |
    Passed in .../5 seeds. Explanation of each failure: ...

    ### 6. Compared with the reference solution
    Cost: ... vs ... · Robustness: ... vs ... · Main structural difference: ...
    ~~~

=== "Português"

    ~~~markdown
    ## Desafio: <id do cenário>

    **Metas (do enunciado):** p99 < ... ms · taxa de erro < ...% · ... · custo < US$ .../mês

    ### 1. Diagnóstico (execução inicial, seed <seed>)
    - Metas que falham: ...
    - Gargalo apontado: <nó> — <explicação>
    - Minha leitura dos números: λ = ... req/s, μ = ... req/s, ρ = ...; L = λ × W = ...

    ### 2. Registro de iterações
    | # | Mudança | Meta que falhava antes → depois | Custo antes → depois | Por que funcionou (ou não) |
    |-|-|-|-|-|
    | 1 | | | | |
    | 2 | | | | |

    ### 3. Design final
    - Diagrama: (captura de tela ou `export Mermaid`)
    - Relatório final (seed <seed>): todas as metas passam — p99 ..., erros ..., disponibilidade ..., custo ...
    - Contas de dimensionamento: ...

    ### 4. Alternativas
    | Alternativa | Resultado | Por que foi descartada |
    |-|-|-|

    ### 5. Robustez (chaos = medium)
    | Seed | Meta 1 | Meta 2 | Meta 3 | Custo | Passou? | Eventos que atrapalharam |
    |-|-|-|-|-|-|-|
    | | | | | | | |
    Passou em .../5 seeds. Explicação de cada falha: ...

    ### 6. Comparação com a solução de referência
    Custo: ... vs ... · Robustez: ... vs ... · Principal diferença estrutural: ...
    ~~~

## Rubric

Levels as defined in [How the exercises are graded](../index.md#how-the-exercises-are-graded). The instructor re-imports your JSON files and reruns them with the seeds you report.

| Criterion | I | D | C | B | A |
|-|-|-|-|-|-|
| Goals at the default seed **(mandatory)** | Not delivered, or JSON does not import | A goal fails in at least one challenge | All goals pass in the three challenges | — | — |
| Physics rules **(mandatory)** | Goals met by editing the physics | Unjustified edits | Respected | — | Justified, well-argued exception |
| Robustness (Part B) **(mandatory)** | Not done | < 4/5 seeds in some challenge | ≥ 4/5 seeds in every challenge | Every failure explained from the event log | 5/5 everywhere, or passes ≥ 4/5 at `high` |
| Cost efficiency | — | Over budget | Within budget | Clearly below budget, removals justified | Cheaper than the reference solution at the same goals |
| Rationale with numbers | — | Narrative only | Diagnosis + iteration log | Utilization / Little's Law / hit-ratio / cost arithmetic justifies the sizing | Predicts a result before running it and checks the prediction |
| Originality and alternatives | Copied | Identical to the reference (cap C) | One alternative discussed | Own design, alternatives compared | Insight that the reference solution misses |

## FAQ

??? question "Can I change the load profile, the target RPS or the goals?"

    No. They define the problem. You change only the design: components, connections and their parameters (within the physics rules).

??? question "My design passes with seed 42 but fails with seed 43. Is the simulator broken?"

    Probably not. Different seeds mean different arrivals, latencies and random events. Look at the event log of the failing run: a replica crash with only one replica left, a hot key, a slow dependency without a timeout… That is exactly what Part B is about.

??? question "If I run the same seed twice, do I get the same report?"

    Yes — same seed, same design, same profile and same chaos level give an identical run. That is what makes your iteration log meaningful and lets the instructor reproduce your results. If you see a difference, check that the design really is the same (import your JSON again).

??? question "Can I just raise the hit ratio of the cache to 0.99?"

    Not without a reason. The hit ratio depends on the workload (how skewed the key popularity is, how often data changes). Above 0.95 for caches and CDNs, or above 0.4 for a semantic cache, you must justify it — otherwise it is editing the physics.

??? question "Where is my design stored? I closed the tab."

    The playground autosaves the current design per scenario in your browser, but browser storage can be cleared. **Export JSON often** and commit the files.

??? question "I think the simulator has a bug."

    Send the instructor the JSON, the seed, the profile and the chaos level, and describe what you expected and what you saw. If it is a bug, the exercise will be adjusted for everybody.

??? question "Can I use AI to find a design?"

    You may discuss ideas with an AI and must declare it. But the oral check will ask you to change a parameter and predict the effect before running — only your own understanding of utilization, Little's Law and costs gets you through it.
