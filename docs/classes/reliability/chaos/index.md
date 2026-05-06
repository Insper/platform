
**Chaos Engineering** is the discipline of experimenting on a system in order to build confidence in its ability to withstand turbulent conditions in production[^1]. Rather than waiting for failures to happen organically, practitioners inject controlled failures deliberately — and use the results to find and fix weaknesses before real incidents do.

> "The way to make systems more reliable is to make them fail all the time." — Jesse Robbins, co-founder of Chef and early Chaos Engineering practitioner at Amazon[^2]

---

## Origin: Netflix and the Simian Army

In April 2011, an Amazon Web Services failure in the `us-east-1` region caused a multi-hour outage for a large portion of the internet. Netflix, which had recently migrated to AWS, suffered significant degradation — despite having invested heavily in fault-tolerant design.

The incident revealed a critical gap: Netflix had *designed* for failure but had never *tested* whether the designs actually worked under real conditions. The engineering team's response was **Chaos Monkey**: a service that randomly terminates EC2 instances in production during business hours, forcing engineers to build systems that could survive arbitrary instance loss.

Chaos Monkey became the first member of the **Simian Army** — a collection of tools that introduced different failure scenarios:

| Tool | Failure injected |
|---|---|
| **Chaos Monkey** | Terminates random EC2 instances |
| **Latency Monkey** | Introduces artificial delays in REST calls |
| **Conformity Monkey** | Shuts down instances that violate best practices |
| **Doctor Monkey** | Monitors health checks, isolates unhealthy instances |
| **Janitor Monkey** | Cleans up unused cloud resources |
| **Security Monkey** | Finds and reports security policy violations |
| **Chaos Gorilla** | Simulates failure of an entire AWS Availability Zone |

The insight was transformational: **failure is not a special case to be avoided; it is the environment that production systems live in, and the only way to know your system survives it is to test it there.**

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

``` mermaid
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

``` mermaid
flowchart TD
    S1["Stage 1\nUnit / integration tests\n(no users affected)"]
    S2["Stage 2\nStagin / canary environment\n(internal users only)"]
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

---

[^1]: [Principles of Chaos Engineering](https://principlesofchaos.org){target="_blank"}. principlesofchaos.org.
[^2]: BASIRI, A. et al. [Chaos Engineering](https://dl.acm.org/doi/10.1145/2842766.2899390){target="_blank"}. ACM Queue, 2016.
[^3]: ROSENTHAL, C.; JONES, N. *Chaos Engineering: System Resiliency in Practice*. O'Reilly, 2020.
[^4]: CASEY, J. [Resilience Engineering: Learning to Embrace Failure](https://www.infoq.com/presentations/resilience-failure-netflix/){target="_blank"}. Netflix Tech Blog, 2012.
