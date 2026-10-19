# Planning

Two meetings a week, about twenty weeks. As a rule, the **first meeting** of the week is a theory class (read the class pages before or after it; each has slides, a quiz and playground scenarios) and the **second meeting** is a hands-on lab on BoxOffice. Deliverables are due on the **last class day of the week, at 23:59**, unless announced otherwise.

!!! info "Dates"

    The weeks are relative. The calendar dates, quiz days and exam days will be added here when Insper's academic calendar for 2027.1 is published.

| Week | Meeting 1 | Meeting 2 | Due |
|:-:|-|-|-|
| 1 | [1. What is System Design](classes/intro/index.md) | [Lab 0 — Environment](hands-on/0/index.md) | |
| 2 | [2. Estimation & Performance Math](classes/estimation/index.md) | [Lab 1 — First service](hands-on/1/index.md) | |
| 3 | [3. Distributed Systems](classes/distributed/index.md) | [Lab 2 — Measure first (k6)](hands-on/2/index.md) | [Ex. 1 Estimation](exercises/estimation/index.md) · team registration |
| 4 | [4. Traffic & Edge](classes/edge/index.md) | [Lab 3 — Edge (Nginx, scale-out)](hands-on/3/index.md) | |
| 5 | [5. Compute & Services](classes/compute/index.md) | [Lab 4 — Gateway & identity](hands-on/4/index.md) | [M1 Design doc](exercises/project/design-doc/index.md) |
| 6 | [6. Databases & Data Systems](classes/databases/index.md) | [7. Caching](classes/caching/index.md) | [Ex. 2 Load-test report](exercises/load-test-report/index.md) |
| 7 | [Lab 5 — Caching (Redis)](hands-on/5/index.md) | [Lab 6 — Data at scale](hands-on/6/index.md) | [M2 Core path](exercises/project/milestones/index.md#m2-core-path-running) · **Quiz 1** |
| 8 | [8. Messaging & Event-Driven](classes/messaging/index.md) | [Lab 7 — Async (Kafka, outbox)](hands-on/7/index.md) | [Ex. 3 Cache & database](exercises/cache-db/index.md) |
| 9 | [10. Observability](classes/observability/index.md) | [Lab 8 — Observability (OTel)](hands-on/8/index.md) | [M3 Scale & cache](exercises/project/milestones/index.md#m3-scale-cache) |
| 10 | **Midterm exams** | | |
| 11 | [9. Reliability & Resilience](classes/reliability/index.md) | [Lab 9 — Resilience & chaos](hands-on/9/index.md) | [Ex. 4 Event-driven](exercises/event-driven/index.md) |
| 12 | [11. Network & Security](classes/network-security/index.md) | [12. Cloud-Native Platforms](classes/cloud-native/index.md) | [M4 Async & resilience](exercises/project/milestones/index.md#m4-async-resilience) · **Quiz 2** |
| 13 | [Lab 10 — Kubernetes (HPA)](hands-on/10/index.md) | [Lab 11 — Delivery (CI/CD, GitOps)](hands-on/11/index.md) | |
| 14 | [13. AI Systems & Agents](classes/ai-systems/index.md) | [Lab 12 — AI assistant](hands-on/12/index.md) | [Ex. 5 Kubernetes autoscaling](exercises/kubernetes-autoscaling/index.md) · [M5 K8s + CI/CD](exercises/project/milestones/index.md#m5-kubernetes-cicd) |
| 15 | [14. AI-Assisted Delivery](classes/ai-delivery/index.md) | [Lab 13 — AI in CI/CD](hands-on/13/index.md) | [Ex. 6 Playground design](exercises/playground-design/index.md) |
| 16 | [15. Performance Engineering](classes/performance/index.md) | [16. Case Studies](classes/case-studies/index.md) — mock interviews, round 1 | [M6 Load-test campaign](exercises/project/load-test-campaign/index.md) · **Quiz 3** |
| 17 | [Chaos game day](exercises/project/game-day/index.md) | [Mock interviews](support/interview/mock/index.md), round 2 · design-doc defences | [M7 Game day](exercises/project/game-day/index.md) · [Ex. 7 Design doc](exercises/design-doc/index.md) |
| 18 | Design reviews (case studies) | Project work | [M8 Cost report](exercises/project/cost-report/index.md) |
| 19 | [Final presentations](exercises/project/presentation/index.md) | Final presentations | M9 Presentation |
| 20 | **Final exams** | | |

``` mermaid
flowchart LR
    F["Foundations<br/>weeks 1–3"] --> B["Building blocks<br/>weeks 4–9"]
    B --> O["Operating at scale<br/>weeks 11–13"]
    O --> A["AI<br/>weeks 14–15"]
    A --> P["Prove it<br/>weeks 16–19"]
```

## How a week works

1. **Before the class**: skim the class overview and try the first playground scenario of the page.
2. **In class**: theory with the slides, a "think first" question, a live playground run.
3. **After class**: read the subpages, do the quiz of the class, and the matching activity of the [workbook](support/workbook/index.md).
4. **Lab day**: build the BoxOffice piece and **measure it**; push the code to your repository.
5. **Every week**: one project step (see the [milestones](exercises/project/milestones/index.md)).
