The project is delivered in **nine milestones**. Each one adds a layer to the same system, in the order the classes teach it, so that you never build something you have not yet seen in class — and never leave everything to the last two weeks. Every milestone has **acceptance criteria you can check yourself** before the deadline, and a short **check-in** in class.

``` diagram
flowchart LR
    m1["M1<br/>design doc<br/>estimates · SLOs"] --> m2["M2<br/>core path<br/>apigw · auth · 3 services · sql"]
    m2 --> m3["M3<br/>scale<br/>cache · replica/pool"]
    m3 --> m4["M4<br/>async & resilience<br/>kafka · outbox · DLQ<br/>timeouts · breaker · OTel"]
    m4 --> m5["M5<br/>platform<br/>K8s · HPA · CI/CD · gate"]
    m5 --> m6["M6<br/>load-test campaign"]
    m6 --> m7["M7<br/>chaos game day"]
    m7 --> m8["M8<br/>cost report"]
    m8 --> m9["M9<br/>presentation"]
```

Each milestone is graded on the tag `m<n>` pushed by the deadline (week shown in each section; dates on the [planning page](../../../planning.md)) and on the check-in. M1 and M6–M9 have their own pages with details and rubrics; M2–M5 share the [rubric at the end of this page](#rubric-for-m2m5).

## M1 — Design doc & estimates { #m1-design-doc-estimates }

**Week 5 · 10% · tag `m1`.** Agree on what you are building, how big it is and how you will prove it works.

- [ ] Design doc with every section, project additions, SLO table and capacity model.
- [ ] At least three ADRs, risk register, ownership table.
- [ ] Test target agreed with the instructor.

Details, template and rubric: [design doc](../design-doc/index.md). Related: [estimation](../../estimation/index.md) and [design doc](../../design-doc/index.md) exercises.

**Check-in questions:** Which SLO is the hardest to meet, and why? Which number in your estimates drives the biggest decision? Who owns what?

## M2 — Core path running { #m2-core-path-running }

**Week 7 · 10% · tag `m2`.** The main use case works end to end, locally, with one command.

**Acceptance criteria**

- [ ] `docker compose up` from a clean clone brings every container to **healthy** in **under 3 minutes** (health checks in `compose.yaml`).
- [ ] The **main use case** works end to end through the entry point (e.g. BoxOffice: list events → hold seats → confirm order), shown by a script or a k6 smoke test.
- [ ] **Gateway** (`apigw`) routes to at least **three services of your own**, each with its **own schema/database** and migrations (Flyway or equivalent).
- [ ] **Authentication**: login issues a JWT (or OIDC token); at least one route is protected and returns **401** without a token; at least one route is open.
- [ ] **Rate limiting** on at least one route at the gateway, shown by a burst that receives **429**.
- [ ] **k6 smoke test** (≥ 30 s, low rate) on the main use case passes with **0 errors**, committed with its summary.
- [ ] OpenAPI available for every service.

**Evidence in the docs:** architecture diagram as built, how to run, smoke-test summary, a short screen recording or terminal log of the main use case.

**Related:** [Lab 1](../../../hands-on/1/index.md) (first service), [Lab 2](../../../hands-on/2/index.md) (k6), [Lab 3](../../../hands-on/3/index.md) (edge), [Lab 4](../../../hands-on/4/index.md) (gateway & identity).

**Check-in questions:** What happens if the auth service is down — which routes still work? Where is the rate limit enforced and with which algorithm? Show me one service's data: could another service write to it?

## M3 — Scale & cache { #m3-scale-cache }

**Week 9 · 10% · tag `m3`.** Make the hot read path cheap and prove it with numbers.

**Acceptance criteria**

- [ ] A **cache** (`cache`, Redis) on the hottest read path, with TTL and **invalidation on write**; hit/miss metrics exposed.
- [ ] A **read replica** with read/write routing **or** a connection pooler (PgBouncer) — chosen and justified by a measurement.
- [ ] At least **two replicas** of the hottest service behind a load balancer (Nginx or the gateway), with health checks.
- [ ] **Before/after k6 test** with the same script, data and resources: hit ratio **≥ 80%** in steady state (or a justified lower value for your workload), p99 and knee before vs after.
- [ ] The critical write (e.g. seat hold) is **consistent under concurrency**: a k6 test with concurrent attempts on the same item shows **no double booking/assignment** (verification query committed).
- [ ] Capacity model of the design doc updated with measured per-instance capacity.

**Evidence in the docs:** before/after table, hit ratio, knee chart, consistency check output, design-doc changelog entry.

**Related:** [Lab 5](../../../hands-on/5/index.md) (caching), [Lab 6](../../../hands-on/6/index.md) (data at scale), [cache & database](../../cache-db/index.md) and [load-test report](../../load-test-report/index.md) exercises.

**Check-in questions:** What would happen to the database if Redis were flushed right now? Show me the query that proves there is no double booking. What is your new bottleneck?

## M4 — Async & resilience { #m4-async-resilience }

**Week 12 · 10% · tag `m4`.** Move slow work off the request path, survive slow dependencies, and see what is happening.

**Acceptance criteria**

- [ ] A **broker** (`kafka`, `queue` or `pubsub`) carries at least one business event between two services.
- [ ] **Transactional outbox** on the producer **or** **idempotent consumer** (ideally both) — verified by a reconciliation query after a run where the consumer is killed: **0 lost, 0 duplicated** side effects.
- [ ] Retries with backoff and a **DLQ/DLT**; a poison message ends there and processing continues.
- [ ] On the call to the slow/external dependency (`payment`, `thirdparty`, `email` or `llmgw`): **timeout + retry with exponential backoff and jitter + circuit breaker** (Resilience4j or equivalent), with a fallback or a clear error.
- [ ] Demonstration with **Toxiproxy** (or equivalent): with 2 s of injected latency on the dependency, the entry point's p99 stays bounded and threads are not exhausted (numbers before/after).
- [ ] **Observability**: OpenTelemetry traces across at least three services (one trace screenshot crossing the broker), a **RED dashboard** (rate, errors, duration) per service, and one **SLO burn-rate alert** that fires in a test.

**Evidence in the docs:** event flow diagram, envelope schema, reconciliation output, Toxiproxy experiment table, dashboard and trace screenshots, alert definition.

**Related:** [Lab 7](../../../hands-on/7/index.md) (async), [Lab 8](../../../hands-on/8/index.md) (observability), [Lab 9](../../../hands-on/9/index.md) (resilience & chaos), [event-driven](../../event-driven/index.md) exercise; AI option: [Lab 12](../../../hands-on/12/index.md).

**Check-in questions:** Kill the consumer now — what happens to the events, and how do you know none is lost? Why this timeout value? Open the dashboard: which service is the slowest and why?

## M5 — Kubernetes + CI/CD { #m5-kubernetes-cicd }

**Week 14 · 10% · tag `m5`.** Run on a platform and deliver every change automatically and safely.

**Acceptance criteria**

- [ ] Every service runs on **Kubernetes** (kind/minikube or a cloud cluster) from manifests in the repository (plain YAML, Kustomize or Helm), with **requests/limits**, **startup/readiness/liveness probes**, graceful shutdown and an **Ingress** (or Gateway API).
- [ ] An **HPA** on at least one service **scales up under a k6 load** and back down (replicas-over-time chart).
- [ ] **Zero failed requests** during a rolling update under steady load.
- [ ] **CI** (GitHub Actions) on every pull request: build, unit tests, container image, **image scan** (e.g. Trivy) failing on critical vulnerabilities, **SBOM** generated and stored as an artifact.
- [ ] **Performance gate**: a k6 smoke/short-load test with SLO thresholds runs in CI and **blocks the merge** when a threshold fails (show one red run).
- [ ] **CD**: merging to `main` deploys to the cluster (GitOps with Argo CD, or a deploy job), with a documented rollback.
- [ ] Secrets are not in the repository (Kubernetes Secrets from CI secrets, or Sealed Secrets/External Secrets).

**Optional A-level extra:** add an AI step to the pipeline from [Lab 13 — AI in CI/CD](../../../hands-on/13/index.md) (e.g. an AI pull-request reviewer or AI-explained canary analysis), with a short evaluation of what it caught and what it got wrong.

**Evidence in the docs:** cluster diagram, manifests links, HPA chart, rolling-update k6 summary, links to a green and a red CI run, SBOM artifact, deployment and rollback procedure.

**Related:** [Lab 10](../../../hands-on/10/index.md) (Kubernetes), [Lab 11](../../../hands-on/11/index.md) (delivery), [Kubernetes autoscaling](../../kubernetes-autoscaling/index.md) exercise.

**Check-in questions:** Push a change that breaks a threshold — what happens? How do you roll back, and how long does it take? What limits your `maxReplicas`?

## M6 — Load-test campaign { #m6-load-test-campaign }

**Week 16 · 15% · tag `m6`.** Prove, with a rigorous k6 campaign, that the system meets the test-target SLOs — and find where it stops meeting them.

- [ ] Campaign plan, scripts, raw results and report.
- [ ] Test-target SLOs met for ≥ 10 minutes in 3 repetitions; knee and bottleneck identified; ≥ 2 improvement iterations.

Details, template and rubric: [load-test campaign](../load-test-campaign/index.md). Related: [Class 15](../../../classes/performance/index.md), [Lab 2](../../../hands-on/2/index.md).

**Check-in questions:** At what load does the first SLO break, and which resource causes it? Which iteration helped most? How do you know the load generator was not the bottleneck?

## M7 — Chaos game day { #m7-chaos-game-day }

**Week 17 · 10% · tag `m7`.** Break the system on purpose, under load, in front of the class — and learn from it.

- [ ] At least three planned experiments plus one surprise fault injected by the instructor.
- [ ] Report with observations, SLO impact, time to detect/mitigate and action items.

Details, templates and rubric: [game day](../game-day/index.md). Related: [Class 10](../../../classes/reliability/index.md), [Lab 9](../../../hands-on/9/index.md).

**Check-in questions:** Which experiment surprised you? How did you detect the surprise fault — alert, dashboard or a user? Which action item matters most?

## M8 — Cost report { #m8-cost-report }

**Week 18 · 10% · tag `m8`.** Put a price on the design target and on what you actually ran, and connect cost to your measurements.

- [ ] Monthly cost of the design target with a bill of materials, unit economics and sensitivity analysis.
- [ ] Final update of the design doc (changelog complete).

Details, template and rubric: [cost report](../cost-report/index.md). Related: [Class 11](../../../classes/cloud-native/index.md).

**Check-in questions:** What is the cost of one ticket sold (or message, ride, view, conversation)? What dominates the bill? What would you change to halve it?

## M9 — Final presentation { #m9-final-presentation }

**Weeks 19–20 · 10% · tag `final`.** Show the system working, the evidence that it meets its goals, and what you learned.

- [ ] 15-minute presentation + live demo + 10 minutes of questions; every member presents.
- [ ] 3-minute video and final documentation.

Details, template and rubric: [presentation](../presentation/index.md).

## Rubric for M2–M5 { #rubric-for-m2m5 }

Levels as defined in [How the exercises are graded](../../index.md#how-the-exercises-are-graded).

| Criterion | I | D | C | B | A |
|-|-|-|-|-|-|
| Acceptance criteria **(mandatory)** | Tag missing or system does not run | At least one criterion not met | All criteria met | All met with margin (e.g. better numbers than required) | All met plus a relevant extra (e.g. the M5 AI step, CDC relay, multi-instance tests) |
| Evidence and measurements | None | Claims without evidence | Every criterion has evidence in the docs | Numbers interpreted, before/after explained | Evidence reproducible by the reader with one command |
| Code and configuration quality | Broken | Fragile, hard-coded secrets or values | Clean, configuration externalised, migrations | Tests for the critical paths, consistent conventions | Code a new member could extend in a day |
| Documentation | Missing | Outdated or incomplete | Milestone section complete, design doc changelog updated | Clear diagrams and ADRs for the changes | Lessons learned and known limitations stated honestly |
| Check-in | Absent | Cannot demo or answer | Demo works, questions answered by the owners | Any member answers any question | Team anticipates the follow-up questions |

## Check-ins

Each milestone has a **10-minute check-in** in class during its week:

1. **Demo from a clean clone of the tag** (2–3 minutes): `git clone`, checkout the tag, one command, the use case working. No "it worked on my machine".
2. **Evidence walk-through** (2–3 minutes): the docs section of the milestone.
3. **Questions** (4–5 minutes): the instructor picks **any member** for each question (examples are listed in each milestone). Owners may complement, but every member must be able to answer the basics.

A missed check-in without justification caps the milestone at D. Problems discovered during a check-in can be fixed until the deadline of the same week.
