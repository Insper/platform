BoxOffice now has timeouts, a retry with jitter, a circuit breaker, a bulkhead, a fallback, a warm standby region and a backup policy. Do they work? The unit tests pass. But nobody has ever seen the payment breaker open with real traffic, nobody has ever promoted the standby database, and nobody knows how long the regional failover really takes. The first time any of it matters will be during a real stadium on-sale, with two million fans watching. The only way to *know* is to cause the failures yourself, on purpose, while you are watching and ready.

**Chaos engineering** is the discipline of experimenting on a system in order to build confidence in its ability to withstand turbulent conditions in production[^1]. Instead of waiting for failures to happen, you inject them deliberately, in a controlled way, and use what you learn to fix weaknesses before real incidents find them.

> "The best way to avoid failure is to fail constantly." — John Ciancutti, Netflix, 2010[^4]

---

## Where it came from

The idea is older than the name. At Amazon in the early 2000s, Jesse Robbins ran **GameDay** exercises that deliberately caused major failures in production to expose hidden weaknesses — in the software and in the teams operating it[^3].

Netflix gave the practice its name and its tools. After moving from its own data centre to AWS around 2010 — where any instance can disappear at any time — it built **Chaos Monkey**, a service that terminates random production instances **during business hours**, so that every team had to build services that survive instance loss, and engineers were at their desks to see what broke[^4]. A whole **Simian Army** followed: Latency Monkey injected delays into calls, Chaos Gorilla simulated the loss of a whole availability zone. In 2016 Netflix engineers formalized the discipline in an IEEE Software article[^2], from which the principles below come.

The insight: **failure is not a special case to avoid; it is the environment production systems live in**, and the only way to know a system survives it is to test it there.

---

## Principles

The [Principles of Chaos Engineering](https://principlesofchaos.org){target="_blank"}[^1] define the discipline with five ideas:

**1. Build a hypothesis around steady-state behaviour**
: Describe "normal" with measurable outputs users care about — the SLIs ([SLOs](../../observability/slo/index.md)): purchase success rate, seat-hold p99, e-mail freshness. The hypothesis: *"the steady state continues even when X happens."*

**2. Vary real-world events**
: Inject failures that actually happen: instance and zone loss, latency, packet loss, a dependency returning errors, a full disk, clock skew, a traffic spike, an expired certificate.

**3. Run experiments in production**
: Staging rarely has production's traffic shape, data volume or dependency behaviour. Production is the goal — reached gradually, not the first step.

**4. Automate experiments to run continuously**
: Systems change every day; a weakness fixed today can return with next week's deploy. Repeat experiments automatically.

**5. Minimize blast radius**
: Affect as few users as possible, have an abort switch, and widen the scope only after smaller experiments pass.

---

## The experiment lifecycle { #the-experiment-lifecycle }

Each experiment follows the scientific method: predict, change one variable, measure, compare[^5].

``` diagram-sim
flowchart LR
    H["1. Hypothesis<br/>steady state + expected behaviour"] --> D["2. Design<br/>fault, scope, abort conditions"]
    D --> I["3. Inject<br/>the controlled fault"]
    I --> O["4. Observe<br/>SLIs, traces, breaker state"]
    O --> A["5. Analyse<br/>expected vs actual"]
    A --> F["6. Improve<br/>fix, update runbooks"]
    F -->|"repeat with a wider scope"| H
```

An experiment that **confirms** the hypothesis is evidence that a defence works. One that **falsifies** it is a *finding*: a weakness discovered on your schedule, with the team ready, instead of at 10:00 on a sale day.

!!! example "Experiment: the payment provider slows down"

    | Step | Content |
    |---|---|
    | **Steady state** | Purchase success ≥ 99.9% and seat-hold p99 < 500 ms; catalog p99 < 300 ms (the RED dashboard of [Hands-on 8](../../../hands-on/8/index.md)). |
    | **Hypothesis** | "If the payment provider answers in 3 s instead of 200 ms, the `payment` circuit breaker opens within 30 s, purchases fail fast with 'payment temporarily unavailable, seats held', the bulkhead caps payment calls at 50, and catalog and seat holds keep their latency." |
    | **Injection** | Toxiproxy between `payment` and the provider stub: a `latency` toxic of 3 s ± 0.5 s, under a k6 load of 100 purchases/s. |
    | **Scope and abort** | Compose environment first; later one canary pod. Abort if catalog p99 > 1 s or the purchase error budget burns faster than 10×. |
    | **Observe** | `resilience4j_circuitbreaker_state`, bulkhead available permits, error rate and p99 per route, `order` busy threads, traces of slow purchases. |
    | **Possible findings** | The read timeout was never set, so slow calls are not counted until 60 s; the retry at the gateway multiplies calls; the fallback message is a raw 500; the bulkhead is shared with `inventory` calls. |

!!! example "In the BoxOffice code: the steady state as k6 thresholds (lab 9)"

    [Hands-on 9 — Measure it](../../../hands-on/9/measure/index.md) writes the hypothesis as code. Two open-model scenarios run at the same time: `pay` (20/s, calls `payment`) and `browse` (20/s, `GET /orders/{id}`, never calls `payment`). The thresholds on `browse` — p95 under 200 ms, under 1% errors — are the hypothesis "the failure does not reach what does not use the provider"; a run that breaks them is a finding. With `payment` 3 s slow, the lab measured a `browse` p95 of 13.17 s unprotected and 805 ms with every pattern on (only the first seconds, before the breaker opened, were slow).

    ``` { .javascript title="load/pay-under-chaos.js (two scenarios and the thresholds)" }
    --8<-- "docs/2027.1/hands-on/9/code/load/pay-under-chaos.js:13:40"
    ```

---

## Fault injection

| Category | Examples | Tools |
|---|---|---|
| **Instance / process** | Kill a pod, OOM-kill a process, terminate a VM | `kubectl delete pod`, Chaos Mesh `PodChaos`, LitmusChaos, AWS FIS |
| **Network** | Latency, packet loss, bandwidth limit, partition, DNS failure | Toxiproxy, Chaos Mesh `NetworkChaos`, `tc netem` |
| **Dependency** | Errors or slow answers from a service or third party | Toxiproxy, WireMock, a feature flag in the client |
| **Resource** | CPU or memory pressure, disk full, file-descriptor exhaustion | `stress-ng`, Chaos Mesh `StressChaos` |
| **State and time** | Clock skew, expired certificate, corrupted cache entry, failover of the database | Chaos Mesh `TimeChaos`, managed DB "reboot with failover" |
| **Infrastructure** | Lose an availability zone or a region | AWS FIS, Azure Chaos Studio, routing changes, the DR drill |

### Toxiproxy: chaos on your laptop { #toxiproxy }

[Toxiproxy](https://github.com/Shopify/toxiproxy){target="_blank"} is a TCP proxy with an API to add "toxics" — latency, timeouts, bandwidth limits, connection resets — to a connection. Put it between `payment` and the provider stub in Docker Compose, and point `payment` at the proxy:

```yaml
# docker-compose.yaml (excerpt)
services:
  toxiproxy:
    image: ghcr.io/shopify/toxiproxy:2.9.0
    ports:
      - "8474:8474"           # Toxiproxy API
  payment:
    environment:
      PROVIDER_URL: http://toxiproxy:8666   # instead of http://provider-stub:8080
```

```bash
# create the proxy: toxiproxy:8666 -> provider-stub:8080
toxiproxy-cli create -l 0.0.0.0:8666 -u provider-stub:8080 provider

# experiment 1: 3 s of latency (+/- 500 ms) on every response
toxiproxy-cli toxic add -t latency -a latency=3000 -a jitter=500 provider

# experiment 2: connections hang forever (a "black hole")
toxiproxy-cli toxic add -t timeout -a timeout=0 provider

# end of the experiment
toxiproxy-cli toxic remove -n latency_downstream provider
toxiproxy-cli toxic remove -n timeout_downstream provider
```

!!! example "In the BoxOffice code: Toxiproxy and the game master's script (lab 9)"

    [Hands-on 9 — Payment, provider and Toxiproxy](../../../hands-on/9/payment/index.md) loads the proxies from a file at startup instead of creating them with the CLI: one in front of `payment` (`order` calls `toxiproxy:18085`) and one in front of `psp`, the fake provider (`payment` calls `toxiproxy:18095`). Two proxies give two places to break, so an operator must find *which* hop is slow — our adapter or the provider. Toxics go in through the HTTP API on port 8474; the [game day](../../../hands-on/9/game-day/index.md) wraps six of them in a script for the game master, and `reset` (remove every toxic, re-enable every proxy) is the abort button.

    ``` { .json title="infra/toxiproxy/toxiproxy.json" }
    --8<-- "docs/2027.1/hands-on/9/code/infra/toxiproxy/toxiproxy.json"
    ```

    ``` { .shell title="scripts/game-day.sh (the game master's injections)" }
    --8<-- "docs/2027.1/hands-on/9/code/scripts/game-day.sh:4:17"
    ```

Run k6 before, during and after each toxic and compare the numbers — that is the "Measure it" step of [Hands-on 9](../../../hands-on/9/index.md).

### Chaos Mesh: chaos on Kubernetes

On Kubernetes, experiments are declared as resources, versioned in Git and bounded in time:

```yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: NetworkChaos
metadata:
  name: payment-latency
  namespace: boxoffice
spec:
  action: delay
  mode: one                  # affect a single pod: small blast radius
  selector:
    namespaces: [boxoffice]
    labelSelectors:
      app: payment
  delay:
    latency: "3s"
    jitter: "500ms"
  duration: "10m"            # the experiment ends by itself
```

---

## Controlling the blast radius

The blast radius of an experiment is the set of users and systems it can affect. Controlling it is what separates engineering from recklessness.

``` diagram-sim
flowchart LR
    S1["1. Local / Compose<br/>no users"] -->|"hypothesis holds"| S2["2. Staging under k6 load<br/>internal users"]
    S2 -->|"no findings"| S3["3. One canary pod in production<br/>a few % of traffic"]
    S3 -->|"SLIs hold"| S4["4. Wider production<br/>a zone, then a region"]
```

- **Abort conditions tied to SLOs**: stop automatically if the error-budget burn rate passes a threshold or a key SLI drops (AWS FIS and Chaos Mesh support stop conditions; at minimum, a human with a button).
- **Time-boxed**: every experiment has a duration and cleans up after itself.
- **Business hours, never during an on-sale**: the team must be present; the error budget policy decides whether you can afford it.
- **Announce it**: the on-call and the support team know an experiment is running.

---

## Game days

A **game day** is a planned, team-wide exercise in which failures are injected and the *people* respond as in a real incident. Automated experiments test the software; game days also test the runbooks, the dashboards, the alerts and the communication.

!!! example "BoxOffice flash-sale game day"

    **Goal**: rehearse a stadium on-sale in staging at production scale (k6 replaying the 10:00 spike) and verify that the purchase path meets its SLOs under five failures injected one at a time.

    | Time | Injection | Expected behaviour | Measure |
    |---|---|---|---|
    | 10:00 | Spike starts (no fault) | Waiting room admits at the configured rate; SQL < 70% | Baseline SLIs |
    | 10:10 | Payment provider latency 3 s | Breaker opens < 30 s; seats held; catalog unaffected | Time to detect (alert), purchase error rate |
    | 10:25 | One `order` pod killed per minute | Readiness removes it; N+1 capacity absorbs it | Errors during restarts |
    | 10:40 | Kafka broker stopped | Producers retry; outbox backlog grows and drains; no lost e-mails | Outbox age, consumer lag, e-mail freshness SLI |
    | 10:55 | Database failover to the standby | ~30 s of errors on writes, then recovery | Actual RTO vs expected |
    | 11:10 | Redis cache flushed | Stampede protection holds; SQL load spike stays below limit | SQL CPU, catalog p99 |

    **Roles**: a *game master* (injects, keeps time, calls the abort), the *on-call* responders (they are not told the schedule), *observers* per service, and a *scribe* (timeline). **Afterwards**: a blameless debrief (what we expected, what happened, what surprised us), with action items owned and dated.

!!! info "Try it in the playground"

    Load the `flash-sale` scenario with the **chaos** profile (300 s, chaos at least *medium*): the simulator injects random failures — crashes, latency degradations, provider outages — while the on-sale traffic runs. Press **Run**: the design as drawn fails when the sale opens (t = 60 s) whatever chaos does, because it has no waiting room — a chaos experiment needs a steady state that passes first. So open it in the full playground (↗), press **Show a possible solution** (the settings, seed 42 included, come along) and run it: the waiting room absorbs the sale, and the **Events** tab lists each injected failure. Which ones does the design survive, and which single component still turns a goal red — and how would you make it redundant in production? Finally switch the profile to `load` to confirm the steady state passes without chaos.

<div class="sdp" data-scenario="flash-sale" data-mode="compact" data-profile="chaos" data-chaos="medium" data-seed="42" data-height="560"></div>

!!! tip "Blameless culture is a prerequisite"
    Chaos experiments and game days only work if people can surface problems safely. If a finding leads to blame, teams stop reporting honestly and weaknesses stay hidden. The output of a game day is a list of improvements, not a list of culprits (see [Incident response](../../observability/incident-response/index.md)).

---

## Continuous verification

Once an experiment passes, keep it passing:

- **In CI**: integration tests with Toxiproxy (Testcontainers has a Toxiproxy module) assert that the client gives up after its timeout and that the breaker opens — cheap, every build.
- **Scheduled in staging**: Chaos Mesh or LitmusChaos workflows run the standard experiments nightly against the latest deploy.
- **In production, small**: a recurring pod-kill on a canary, a monthly backup restore, a twice-yearly regional failover drill ([Disaster recovery](../disaster-recovery/index.md)).

---

## Observability first

Chaos without observability is just breaking things. Before injecting anything you must be able to:

1. **See the steady state** — SLI dashboards with baselines.
2. **Detect the deviation** — alerts that fire within minutes (burn-rate alerts).
3. **Explain it** — traces that show which call got slow, metrics of breakers and pools.
4. **Stop it** — an abort switch that works in seconds.

> Observability first, then resilience patterns, then chaos experiments to prove the patterns work.

It is also the order of the labs: [lab 8](../../../hands-on/8/index.md) instruments BoxOffice before [lab 9](../../../hands-on/9/index.md) breaks it on purpose, and the game-day operators work from the lab 8 dashboard and alerts.

| Tool | Maintained by | Strengths |
|---|---|---|
| [Toxiproxy](https://github.com/Shopify/toxiproxy){target="_blank"} | Shopify (open source) | Simple TCP proxy; ideal for local and CI tests |
| [Chaos Mesh](https://chaos-mesh.org){target="_blank"} | CNCF | Kubernetes-native; network, pod, stress, time, I/O faults; workflows |
| [LitmusChaos](https://litmuschaos.io){target="_blank"} | CNCF | Kubernetes-native; experiment hub; GitOps-friendly |
| [AWS Fault Injection Service](https://aws.amazon.com/fis/){target="_blank"} | Amazon | Managed; AWS-level faults (AZ power, API errors); stop conditions |
| [Azure Chaos Studio](https://azure.microsoft.com/products/chaos-studio){target="_blank"} | Microsoft | Managed chaos for Azure resources |
| [Gremlin](https://www.gremlin.com){target="_blank"} | Gremlin Inc. | Commercial platform; broad fault library; reliability scoring |
| [Chaos Monkey](https://github.com/Netflix/chaosmonkey){target="_blank"} | Netflix | Random instance termination; the original |

!!! tip "In the interview"
    After proposing resilience mechanisms, add how you would **verify** them: "I'd run a chaos experiment with a steady-state hypothesis on the purchase SLO — inject 3 s of latency on the payment provider for one canary pod, expect the breaker to open within 30 s and catalog latency to stay flat, with an automatic abort if the burn rate exceeds 10×". It shows you know that untested failover and untested fallbacks are the most common reason resilient-looking designs fail.

!!! success "Best practices"

    - **Write the steady state as thresholds a tool checks** — pass or fail is then a fact, not an opinion. In BoxOffice: the `browse` thresholds of `pay-under-chaos.js` ([box above](#the-experiment-lifecycle)).
    - **Test the abort command before the first injection** — the abort must work when the system does not. In BoxOffice: `curl -s -X POST localhost:8474/reset` removes every toxic ([Hands-on 9 — Game day](../../../hands-on/9/game-day/index.md)).
    - **Keep experiments as versioned code with a built-in end** — a script or a manifest with a `duration` can be reviewed, repeated and cannot be forgotten running. In BoxOffice: `scripts/game-day.sh`.
    - **Inject faults below the client library, at the network** — a TCP proxy exercises the real timeouts and connection pools; a mock in the code tests only the mock. In BoxOffice: one Toxiproxy proxy per hop ([box above](#toxiproxy)).
    - **Time detection and mitigation in every game day, and compare across rounds** — the trend of those two numbers is the evidence that the team, not only the code, got better. In BoxOffice: the results table of [Hands-on 9](../../../hands-on/9/measure/index.md).
    - **Turn each finding into a regression experiment in CI** — a weakness fixed today returns with next week's deploy; Testcontainers' Toxiproxy module makes the check cheap.

!!! warning "Common pitfalls"

    - **Chaos without a hypothesis**: if you did not say what should happen, you cannot learn from what did.
    - **Starting in production** with a large blast radius — production is the destination, not the starting point.
    - **No abort switch**, or an abort that depends on the system being tested.
    - **Running during an on-sale** or with an exhausted error budget.
    - **Findings that never become tickets**: the experiment consumed budget and taught nothing.
    - **Testing only crashes**: latency and partial failures are the ones that cascade.

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    SS["steady state = SLIs<br/>→ SLOs"] --> HYP["hypothesis"]
    HYP --> INJ["inject: Toxiproxy,<br/>Chaos Mesh, AWS FIS"]
    LOAD["k6 load during the run<br/>→ Performance"] --> INJ
    INJ --> PAT["defences under test:<br/>breaker, bulkhead, fallback"]
    INJ --> DR["failover, restore<br/>→ Disaster recovery"]
    OBS["metrics, traces, burn-rate alerts<br/>→ Observability"] --> OA["observe and abort"]
    PAT --> OA
    DR --> OA
    OA --> BR["widen the blast radius:<br/>local → canary → zone"]
    OA --> GD["game day + blameless debrief<br/>→ Incident response"]
    GD --> HYP
```

**Palette components:** [`thirdparty`](../../../reference/components/external/index.md#thirdparty) (the provider stub behind Toxiproxy) · [`app`](../../../reference/components/compute/index.md#app) (`order` pods killed during the game day) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (a broker stopped) · [`sql`](../../../reference/components/storage/index.md#sql) (failover to the standby) · [`cache`](../../../reference/components/storage/index.md#cache) (Redis flushed: stampede protection) · [`metrics`](../../../reference/components/observability/index.md#metrics) · [`tracing`](../../../reference/components/observability/index.md#tracing) · [`alerting`](../../../reference/components/observability/index.md#alerting) (you cannot run chaos without them). **Scenarios:** `flash-sale` (chaos profile), `cascading-failure`. **Continues in:** [Observability — incident response](../../observability/incident-response/index.md), [Performance — load testing](../../performance/load-testing/index.md), [Cloud-native — Kubernetes](../../cloud-native/kubernetes/index.md), [Hands-on 9 — payment and Toxiproxy](../../../hands-on/9/payment/index.md), [Project — game day](../../../exercises/project/game-day/index.md).

---

[^1]: [Principles of Chaos Engineering](https://principlesofchaos.org){target="_blank"}. principlesofchaos.org.
[^2]: BASIRI, A. et al. [Chaos Engineering](https://ieeexplore.ieee.org/document/7436642){target="_blank"}. *IEEE Software*, v. 33, n. 3, p. 35–41, 2016.
[^3]: ROBBINS, J. et al. [Resilience Engineering: Learning to Embrace Failure](https://queue.acm.org/detail.cfm?id=2371297){target="_blank"}. *ACM Queue*, v. 10, n. 9, 2012.
[^4]: CIANCUTTI, J. [5 Lessons We've Learned Using AWS](https://techblog.netflix.com/2010/12/5-lessons-weve-learned-using-aws.html){target="_blank"}. Netflix Tech Blog, Dec. 2010.
[^5]: ROSENTHAL, C.; JONES, N. *Chaos Engineering: System Resiliency in Practice*. O'Reilly, 2020.
