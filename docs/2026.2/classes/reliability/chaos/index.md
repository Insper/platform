
You added timeouts, a circuit breaker and a fallback to the call from the order service to the product service. Do they work? The unit tests pass, but nobody has ever seen the breaker open in production — and the first time it matters will be during a real outage, at night, with real customers. The only way to *know* is to cause the failure yourself, on purpose, while you are watching.

**Chaos Engineering** is the discipline of experimenting on a system in order to build confidence in its ability to withstand turbulent conditions in production[^1]. Rather than waiting for failures to happen organically, practitioners inject controlled failures deliberately — and use the results to find and fix weaknesses before real incidents do.

> "The best way to avoid failure is to fail constantly." — John Ciancutti, Netflix, 2010[^5]

The idea is older than the name. At Amazon in the early 2000s, Jesse Robbins (later co-founder of Opscode, the company behind Chef) ran **GameDay** exercises that deliberately caused major failures in production systems to expose hidden weaknesses in software and in the teams operating it[^4].

---

## Origin: Netflix and the Simian Army

In 2008 a database corruption stopped Netflix from shipping DVDs for three days. The company decided to move away from its own data centre to AWS, accepting that in the cloud individual instances can disappear at any time. During that migration (around 2010) the engineers built **Chaos Monkey**: a service that randomly terminates instances in production during business hours, forcing every team to build services that survive arbitrary instance loss[^5]. Running it during working hours is deliberate — the engineers are at their desks to see and fix what breaks.

The practice was tested for real in April 2011, when a large AWS failure in the `us-east-1` region took down many well-known sites for hours; Netflix kept streaming, with some degradation, largely because its services were already built to lose instances. That year Netflix described a whole **Simian Army**[^6] — a collection of tools that introduced different failure scenarios:

| Tool | Failure injected |
|---|---|
| **Chaos Monkey** | Terminates random EC2 instances |
| **Latency Monkey** | Introduces artificial delays in REST calls |
| **Conformity Monkey** | Shuts down instances that violate best practices |
| **Doctor Monkey** | Monitors health checks, isolates unhealthy instances |
| **Janitor Monkey** | Cleans up unused cloud resources |
| **Security Monkey** | Finds and reports security policy violations |
| **Chaos Gorilla** | Simulates failure of an entire AWS Availability Zone |

The insight was transformational: **failure is not a special case to be avoided; it is the environment that production systems live in, and the only way to know your system survives it is to test it there.** In 2016 Netflix engineers formalised the practice and gave it its name in an IEEE Software article[^2]; the principles below come from that work.

---

## Principles of Chaos Engineering

The [Principles of Chaos Engineering](https://principlesofchaos.org){target="_blank"}[^1] define the discipline across five core ideas:

**1. Build a hypothesis around steady state behaviour**
: Define what "normal" looks like before injecting failures — in terms of measurable outputs (request rate, error rate, latency). The hypothesis is: *"This system will continue to exhibit the steady state even when condition X is introduced."*

**2. Vary real-world events**
: Simulate events that actually happen: server crashes, network partition, disk full, clock skew, dependency timeout, traffic spike. Synthetic or artificial failures that never occur in practice produce misleading confidence.

**3. Run experiments in production**
: Staging environments do not faithfully reproduce production load, data distribution, or dependency behaviour. Weaknesses only visible under production conditions are invisible in staging. Start with small blast radius and expand as confidence grows.

**4. Automate experiments to run continuously**
: A one-time experiment produces a one-time result. Systems change constantly; new deployments can reintroduce weaknesses. Continuous chaos experiments run automatically (often on a schedule) so regressions are caught immediately.

**5. Minimise blast radius**
: Control the scope of each experiment carefully. Affect the minimum number of users necessary to validate the hypothesis. Expand scope only after smaller experiments produce no observable impact.

---

## The experiment lifecycle

Each experiment follows the scientific method[^3]: state what you expect, change one variable, measure, and compare.

``` mermaid-sim
flowchart LR
    H["1. Hypothesise\nDefine steady state\nand expected behaviour"]
    D["2. Design\nChoose failure type\nand blast radius"]
    I["3. Inject\nIntroduce the\ncontrolled failure"]
    O["4. Observe\nMeasure SLIs\nand system behaviour"]
    A["5. Analyse\nCompare actual vs\nhypothesised behaviour"]
    R["6. Improve\nFix weaknesses;\nupdate runbooks"]

    H --> D --> I --> O --> A --> R
    R -->|"run again\nwith wider scope"| H
```

A chaos experiment that **confirms the hypothesis** (the system behaves as expected) builds confidence in that failure mode. An experiment that **falsifies the hypothesis** is a finding: the system does not handle this failure correctly, and the team now knows before a real incident teaches them.

!!! example "An experiment on the store"

    | Step | Content |
    |---|---|
    | **Steady state** | `POST /orders`: availability ≥ 99.9% and P95 latency < 500 ms (from the Grafana dashboard of [Hands-on 6](../../../hands-on/6/index.md)). |
    | **Hypothesis** | "If the product service answers in 3 s instead of 50 ms, the order service's circuit breaker opens within 30 s, orders fail fast with a clear `503`, and `GET /orders` keeps its normal latency." |
    | **Injection** | Put Toxiproxy between order and product and add a 3 s `latency` toxic — first in the Docker Compose environment, later on one replica. |
    | **Blast radius** | One environment, 10 minutes, abort if the availability of `GET /orders` drops below 99%. |
    | **Observe** | `resilience4j_circuitbreaker_state`, error rate and P95 per route, the order service's busy threads, traces in Jaeger. |
    | **Possible findings** | The Feign read timeout was never configured, so the breaker only counts calls after 60 s; or the retry multiplies calls and the breaker opens too late. |

    Either outcome is useful: a confirmed hypothesis is evidence that the patterns work; a falsified one is a bug found on your terms.

---

## Fault injection types

| Category | Examples | Tools |
|---|---|---|
| **Process / instance** | Kill container, OOM-kill process, terminate VM | Chaos Monkey, LitmusChaos |
| **Network** | Add latency, drop packets, corrupt packets, partition network segment | Toxiproxy, Gremlin, Chaos Mesh |
| **Resource** | Saturate CPU, fill disk, exhaust memory, fill file descriptor table | Stress-ng, Gremlin |
| **Dependency** | Return HTTP 500, inject timeouts, return malformed responses | Wiremock, Toxiproxy |
| **State** | Corrupt database records, roll back a deployment, expire TLS certificates | Manual, Gremlin |
| **Infrastructure** | Terminate an Availability Zone, lose a region, simulate CDN failure | Chaos Gorilla, AWS Fault Injection Simulator |

---

## Blast radius control

The blast radius of a chaos experiment is the set of users and systems affected by the injected failure. Controlling it is what separates engineering practice from recklessness.

``` mermaid-sim
flowchart TD
    S1["Stage 1\nUnit / integration tests\n(no users affected)"]
    S2["Stage 2\nStaging / canary environment\n(internal users only)"]
    S3["Stage 3\n1% of production traffic\n(small user cohort)"]
    S4["Stage 4\nFull production\n(all traffic, all regions)"]

    S1 -->|confidence increases| S2
    S2 -->|no findings| S3
    S3 -->|SLIs hold| S4
```

Practical controls:

- **Feature flags**: enable chaos injection only for a percentage of requests.
- **Time windows**: run experiments only during business hours when the team is available to abort.
- **Automated abort conditions**: if an SLI drops below a threshold, halt the experiment automatically.
- **Dark reads / shadow traffic**: run experiments against a copy of production data, not the primary path.

---

## GameDay

A **GameDay** is a planned, team-wide chaos exercise where engineers deliberately introduce failures and observe whether the system and the team respond correctly. Unlike automated continuous chaos experiments, GameDays are collaborative events focused on process as much as technology.

A typical GameDay:

1. **Brief**: the scenario is described to the team (e.g., *"The primary database fails at 10:00 AM"*). Alternatively, the scenario is kept secret (a *surprise GameDay*) to test realistic incident response.
2. **Execute**: the failure is injected. Engineers monitor dashboards, run incident response procedures, and communicate as they would in a real incident.
3. **Observe**: the team tracks how long detection takes, how long recovery takes, and which runbooks were effective.
4. **Debrief**: a blameless post-mortem identifies what went well, what failed, and what improvements to make to the system and the runbooks.

!!! tip "Blameless culture is a prerequisite"
    GameDays only work if engineers feel safe surfacing problems. If findings lead to blame or punishment, the team will avoid honest reporting — and the weaknesses remain hidden. The output of a GameDay is a list of improvements, not a list of culprits.

---

## Tools

| Tool | Maintained by | Strengths |
|---|---|---|
| [Chaos Monkey](https://github.com/Netflix/chaosmonkey){target="_blank"} | Netflix | Instance termination; the original |
| [Gremlin](https://www.gremlin.com){target="_blank"} | Gremlin Inc. | SaaS; broad failure library; UI-driven |
| [LitmusChaos](https://litmuschaos.io){target="_blank"} | CNCF | Kubernetes-native; GitOps-friendly |
| [Chaos Mesh](https://chaos-mesh.org){target="_blank"} | CNCF | Kubernetes-native; broad failure library |
| [Toxiproxy](https://github.com/Shopify/toxiproxy){target="_blank"} | Shopify | TCP proxy; adds latency/drops packets; ideal for integration tests |
| [AWS FIS](https://aws.amazon.com/fis/){target="_blank"} | Amazon | Native AWS integration; IAM-controlled; safe abort conditions |

---

## Prerequisites: observability first

Chaos engineering without observability is dangerous and unproductive. Before running any experiment, the team must be able to:

1. **Measure steady state**: SLI dashboards must exist and show baseline values.
2. **Detect deviations**: alerts must fire within seconds of an SLI dropping.
3. **Attribute causality**: distributed tracing must allow the team to identify which component introduced the latency or errors.
4. **Abort safely**: an automated kill switch must be able to halt the experiment immediately if it exceeds the defined blast radius.

> **Start with observability. Then add resilience patterns. Then run chaos experiments to validate the patterns actually work.**

!!! warning "Common pitfalls"

    - **Chaos without a hypothesis** is just breaking things: if you did not say in advance what should happen, you cannot learn from what did happen.
    - **Starting in production**: the principle says production is the goal, not the first step. Begin in a test environment and widen the blast radius only when smaller experiments pass.
    - **No abort switch**: every experiment needs a way to stop it in seconds.
    - **Fixing nothing**: an experiment whose findings never become tickets only consumed error budget.

---

## Connections

- [SLI / SLO / SLA](../sli-slo-sla/index.md) — the steady state is expressed as SLIs, and experiments spend error budget.
- [Resilience Patterns](../patterns/index.md) — what chaos experiments verify.
- [Observability](../../observability/index.md) and [Hands-on 10](../../../hands-on/10/index.md) — you need metrics and traces to observe an experiment.
- [Hands-on 5](../../../hands-on/5/index.md) — deleting a pod by hand (`kubectl delete pod`) is the simplest chaos experiment you can run on Kubernetes.

## Key takeaways

- Chaos engineering is **experimentation**: a steady-state hypothesis, a controlled injection, measurement and analysis.
- It grew from Netflix's Chaos Monkey (2010) and the Simian Army, and from Amazon's GameDays.
- Inject **real-world** failures (instance loss, latency, dependency errors) and keep the **blast radius** small, widening it step by step.
- A falsified hypothesis is a **finding**, not a failure.
- Prerequisites: observability, resilience patterns, an automated abort — and a blameless culture.

---

[^1]: [Principles of Chaos Engineering](https://principlesofchaos.org){target="_blank"}. principlesofchaos.org.
[^2]: BASIRI, A. et al. [Chaos Engineering](https://ieeexplore.ieee.org/document/7436642){target="_blank"}. *IEEE Software*, v. 33, n. 3, p. 35–41, 2016.
[^3]: ROSENTHAL, C.; JONES, N. *Chaos Engineering: System Resiliency in Practice*. O'Reilly, 2020.
[^4]: ROBBINS, J. et al. [Resilience Engineering: Learning to Embrace Failure](https://queue.acm.org/detail.cfm?id=2371297){target="_blank"}. *ACM Queue*, v. 10, n. 9, 2012.
[^5]: CIANCUTTI, J. [5 Lessons We've Learned Using AWS](https://techblog.netflix.com/2010/12/5-lessons-weve-learned-using-aws.html){target="_blank"}. Netflix Tech Blog, Dec. 2010.
[^6]: IZRAILEVSKY, Y.; TSEITLIN, A. [The Netflix Simian Army](https://techblog.netflix.com/2011/07/netflix-simian-army.html){target="_blank"}. Netflix Tech Blog, Jul. 2011.
