Before the first line of code, your team agrees on **what** it is building, **how big** it must be, **how you will know it works** and **which decisions** you are taking. That agreement is the design doc of milestone **M1**. It is not written once and forgotten: it is the map the whole project follows, it is updated at every milestone, and its final version (M8) is what you defend in the presentation.

!!! abstract "Goals"

    With M1 your team will have:

    - **Chosen** a system option and turned it into requirements, a design target and a test target.
    - **Defined** SLOs with their SLIs and **how each one will be measured** (k6, OpenTelemetry).
    - **Estimated** the load and **sized** each service with Little's Law and a per-instance capacity.
    - **Drawn** the architecture with palette components and **assigned** data ownership per service.
    - **Recorded** the first ADRs, a risk register, a test plan sketch and the ownership table.

## What to deliver

**Due: week 5, tag `m1`, weight 10%.** A *Design doc* section in the team's documentation site containing the [exercise's design doc template](../../design-doc/index.md#templates) — every section filled — **plus** the project additions below. ADRs use the [ADR template](../../design-doc/index.md#templates), numbered `ADR-001`, `ADR-002`, …

The project additions:

| Addition | What it must contain |
|-|-|
| Option and targets | The [system option](../index.md#system-options), its design target and test target (copy the table and adapt it if agreed with the instructor) |
| SLO table | Each SLO with its SLI, the measurement point (k6 client side, gateway, service), the tool (k6 threshold, OTel metric, SQL check) and the time window |
| Estimates sheet | As in the [estimation exercise](../../estimation/index.md), for the design target **and** the test target |
| Architecture | High-level diagram with **palette ids**, the two main flows walked through, sync vs async edges marked |
| Data ownership | One table: service → data it owns → store → who may read it (and how: API, events) |
| API contracts | Link to each service's OpenAPI file (even if the endpoints are not implemented yet) and the event schemas |
| Capacity model | Per service: expected req/s at the test target, assumed capacity per instance, replicas = ⌈λ ÷ (capacity × 0.7)⌉, concurrency L = λ × W |
| Risk register | The top risks (technical and team), likelihood, impact, mitigation, owner |
| Test plan sketch | Which k6 scenarios will prove which SLOs; which chaos experiments are planned for the game day |
| Ownership table | Member → services → cross-cutting area |
| Changelog | Empty at M1; at every milestone, one line per design change with a link to the ADR |

## Acceptance criteria

- [ ] **(mandatory)** All sections of the design doc template are filled (or marked "not applicable — because …").
- [ ] **(mandatory)** At least **three ADRs**; suggested topics: the broker (Kafka vs a queue), the consistency of the critical write (e.g. seat hold with `SELECT … FOR UPDATE` vs optimistic locking), the cache strategy.
- [ ] **(mandatory)** SLO table with SLIs, measurement point, tool and window — every SLO of the test target is **measurable** with the tools of the course.
- [ ] Estimates for the design target and the test target, with formulas.
- [ ] Architecture diagram with palette ids, covering all [mandatory components](../index.md#mandatory-components) (even if some arrive in later milestones — mark them).
- [ ] Data ownership: no table is written by two services.
- [ ] Capacity model gives a replica count for every service at the test target.
- [ ] Risk register with at least five risks, each with a mitigation and an owner.
- [ ] Ownership table: every member owns a service and a cross-cutting area.
- [ ] *AI usage* section.

## Step by step

1. **Pick the option together** (week 3) and read its case study and playground scenario.
2. **Write the requirements and targets first.** Agree on what is out of scope — it protects your schedule.
3. **Turn every SLO into a measurement.** "p99 of `POST /holds` < 500 ms" becomes "k6 threshold `http_req_duration{name:POST /holds}` `p(99)<500` at 100 holds/s for 10 min". If you cannot say how you will measure it, it is not an SLO yet.
4. **Estimate and size.** Use the formulas of the estimation exercise; take per-instance capacities from your ex2 measurements when you have them, and mark assumptions.
5. **Draw the architecture and walk the flows.** Then check it against the mandatory components table.
6. **Split ownership** of data and services; write the API contracts and event schemas.
7. **Write the ADRs** for the decisions that are expensive to change later.
8. **Prototype in the playground** (optional but recommended) and attach the exported JSON.
9. **Review as a team**, then ask another team to read it for 10 minutes and note their questions — answer them in the doc.

!!! tip "Try it — prototype before you build"

    Start from the `blank` scenario in the [full playground](../../../../playground/index.md), build your architecture with the same palette ids as your diagram, set the test-target load and see which node saturates first. Export the JSON and commit it as `docs/design/playground.json`. The compact view below only runs a design; build yours in the full playground.

<div class="sdp" data-scenario="blank" data-mode="compact" data-height="520"></div>

### A worked SLO row (BoxOffice)

| SLO | SLI | Measured at | Tool | Window |
|-|-|-|-|-|
| Seat hold p99 < 500 ms at 100 holds/s | Latency of `POST /holds` | Client (k6) | k6 threshold `http_req_duration{name:POST /holds}` | 10 min steady state |
| No double booking | Seats with more than one confirmed order | Database | SQL check after every test | Whole test |
| Ticket e-mail p95 < 30 s | Time from order confirmed to e-mail recorded | Services | OTel span duration / SQL timestamps | Whole test |
| Error rate < 0.1% (excluding 429) | Non-2xx except 429 ÷ all requests | Gateway | OTel metric `http.server.request.duration` by status | 10 min steady state |

## Templates

The project additions, to append to the design doc template of the exercise:

=== "English"

    ~~~markdown
    ## Project additions

    ### Option and targets
    Option: ... · Design target: ... · Test target: ... (agreed on <date>)

    ### SLOs
    | SLO | SLI | Measured at | Tool | Window |
    |-|-|-|-|-|

    ### Capacity model (test target)
    | Service | λ (req/s) | W (s) | L = λW | Capacity/instance | Replicas |
    |-|-|-|-|-|-|

    ### Data ownership
    | Service | Owns | Store | Read by others via |
    |-|-|-|-|

    ### API contracts and events
    - <service>: link to openapi.yaml
    - Events: <name> v1 — fields ...

    ### Risk register
    | # | Risk | Likelihood | Impact | Mitigation | Owner |
    |-|-|-|-|-|-|

    ### Test plan sketch
    | SLO | k6 scenario | Chaos experiment |
    |-|-|-|

    ### Ownership
    | Member | Services | Cross-cutting area |
    |-|-|-|

    ### Changelog
    | Milestone | Change | ADR |
    |-|-|-|
    ~~~

=== "Português"

    ~~~markdown
    ## Complementos do projeto

    ### Opção e escalas
    Opção: ... · Escala de projeto: ... · Escala de teste: ... (combinada em <data>)

    ### SLOs
    | SLO | SLI | Medido em | Ferramenta | Janela |
    |-|-|-|-|-|

    ### Modelo de capacidade (escala de teste)
    | Serviço | λ (req/s) | W (s) | L = λW | Capacidade/instância | Réplicas |
    |-|-|-|-|-|-|

    ### Propriedade dos dados
    | Serviço | É dono de | Armazenamento | Outros leem via |
    |-|-|-|-|

    ### Contratos de API e eventos
    - <serviço>: link para o openapi.yaml
    - Eventos: <nome> v1 — campos ...

    ### Registro de riscos
    | # | Risco | Probabilidade | Impacto | Mitigação | Responsável |
    |-|-|-|-|-|-|

    ### Esboço do plano de testes
    | SLO | Cenário k6 | Experimento de caos |
    |-|-|-|

    ### Responsabilidades
    | Membro | Serviços | Área transversal |
    |-|-|-|

    ### Changelog
    | Marco | Mudança | ADR |
    |-|-|-|
    ~~~

## Rubric

Levels as defined in [How the exercises are graded](../../index.md#how-the-exercises-are-graded).

| Criterion | I | D | C | B | A |
|-|-|-|-|-|-|
| Completeness **(mandatory)** | Not delivered | Template sections or additions missing | Everything present | — | — |
| Requirements, targets and SLOs **(mandatory)** | Missing | SLOs not measurable | Measurable SLOs with SLI, point, tool and window | SLOs prioritised and tied to the user experience | Error budget and what the team does when it burns |
| Estimates and capacity | Missing | Inconsistent | Both scales estimated; replicas per service | Capacities from own measurements (ex2) | Sensitivity: the estimate that would change the design |
| Architecture and data | Missing | Diagram without flows or ownership | Palette ids, two flows, ownership table, contracts | Every component justified; sync/async boundaries argued | Evolution path milestone by milestone |
| ADRs **(mandatory)** | None | Fewer than three | Three with options and consequences | Honest negatives and confirmation criteria | ADRs reused and updated through the project (changelog) |
| Risks and test plan | Missing | Generic | Five risks with owners; SLO ↔ test mapping | Risks include team/schedule risks with real mitigations | Early spike/prototype retires the top technical risk |

## FAQ

??? question "Do we need to implement everything in the diagram?"

    You must implement the [mandatory components](../index.md#mandatory-components). The diagram may show more (e.g. a CDN or a second region) if it is clearly marked as "design target only" and costed in M8.

??? question "Can we change the design after M1?"

    Yes — and you will. Record each change in the changelog with an ADR (new, or superseding an old one). A design doc that never changes after week 5 usually means the team stopped reading it.

??? question "We do not know the capacity of one instance yet."

    Assume it from the [numbers cheat sheet](../../../reference/numbers/index.md) or from the labs, mark it as an assumption, and replace it with your measurement at M3. Showing how the replica count changed is a good sign.

??? question "How detailed must the API be?"

    Enough for another team to call your service: paths, methods, main fields, status codes, idempotency keys. An OpenAPI file generated from stubs is fine at M1.

??? question "What is a good risk?"

    Specific and actionable: "nobody on the team has run Kafka on Kubernetes — mitigation: spike in week 6, fallback to a managed queue, owner: Ana". "The project might be late" is not a risk entry.
