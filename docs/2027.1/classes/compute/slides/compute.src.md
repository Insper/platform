---
marp: true
lang: en
title: Compute and services
description: System Architecture · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">System Architecture · Insper</div>

# Compute and services

**Where the code runs, how it is split, how it scales — and how to depend on providers you do not control**

<!--
Outline: (1) stateless app servers and replica sizing; (2) monolith, modular monolith, microservices,
DDD and Conway; (3) API styles and contracts; (4) workers and schedulers; (5) serverless and
autoscaling; (6) external integrations: idempotency, webhooks, reconciliation, outages.
-->

---

## 09:59, on-sale day

<div class="q">

**2 million** fans, **60 thousand** seats, sale opens at **10:00**. At 03:00 the same platform serves a few hundred requests per second.
What must the compute tier do in the next ten minutes?

</div>

- Serve the catalog to millions of page views — **scale out**.
- Hold and sell seats without double booking — **state in the right place**.
- Charge cards through an **external provider** that may time out.
- Issue 60 k tickets and e-mails — **background work**.
- Release expired holds, open the sale on time — **schedulers**.
- Grow from hundreds to tens of thousands of req/s — **autoscaling**.

---

## The compute palette

| Component | Runs | BoxOffice example |
|---|---|---|
| **App Server** | request handlers behind a load balancer | `catalog`, `inventory`, `order` |
| **Worker** | jobs pulled from a queue | ticket PDFs, e-mail sending |
| **Serverless** | short functions started per event | webhook receiver, image resize |
| **Auth Service** | login, tokens | `auth` issues JWTs |
| **Search** | full-text queries over an index | "coldplay são paulo" |
| **Scheduler** | time-triggered work | release holds every 30 s |
| **Notifications** | fan-out to e-mail / push / SMS | "your tickets are here" |
| **Analytics** | event ingestion and aggregation | sales per minute |

---

## Stateless app servers

Any replica can serve any request: **state lives outside the process**.

| State that sticks to a server | New home |
|---|---|
| HTTP session in memory | JWT on the client, or Redis |
| Uploaded files on local disk | object store (S3, GCS, MinIO) |
| In-process cache | Redis — or short TTLs per replica |
| `@Scheduled` job inside the app | CronJob, lock or leader |
| Counters, rate limits in memory | Redis `INCR`, API gateway |

<div class="warn">

**Seat holds in a `HashMap`**: the next click hits another replica, a restart forgets every hold, two replicas sell the same seat.

</div>

---

## How many replicas?

> N = ⌈ peak RPS / (RPS per replica × target utilization) ⌉ + spare

- `catalog`: 10 vCPUs × (1 / 20 ms) = **500 req/s** per replica; peak **4,000 req/s**.
- At 100%: 8 replicas — zero headroom.
- At a **65%** target: 4,000 / 325 ≈ 12.3 → **13**, + 1 spare = **14**.

| Replicas | 9 | 10 | 12 | 14 |
|---|---|---|---|---|
| Utilization | 89% | 80% | 67% | 57% |
| Mean latency (M/M/10) | 31 ms | 24 ms | 21 ms | 20.4 ms |

<p class="small">Latency explodes near 100% busy (the knee) — and p99 degrades earlier than the mean.</p>

<!--
Ask: why not 100 replicas? Cost, and 100 × 20 connections = 2,000 connections to PostgreSQL:
the bottleneck moves to the database. Show the scale-out scenario in the playground.
-->

---

## Replicas are disposable

- **Start fast**; readiness passes only after pools and caches are warm.
- **Graceful shutdown** on `SIGTERM`: stop accepting, finish in-flight, exit.
- Scale **out** the stateless tier; scale **up** (then replicate, partition) the stateful one.

| Shape | Scales in | Pay for | Typical use |
|---|---|---|---|
| VM | minutes | provisioned hours | legacy, databases |
| Containers on Kubernetes | seconds (pod) to minutes (node) | nodes | the default for services |
| Serverless containers | seconds, to zero | per use | APIs with idle periods |
| Functions (FaaS) | sub-second, to zero | invocations + GB-s | event glue, webhooks |

---

## Monolith → modular monolith → microservices

| | Monolith | Modular monolith | Microservices |
|---|---|---|---|
| Deployable units | 1 | 1 | many |
| Boundaries enforced by | discipline | the build (modules, ArchUnit) | the network |
| Calls between parts | in-process | in-process | network: can fail, ms |
| Transactions | ACID across all | ACID, tables owned per module | sagas, eventual consistency |
| Scaling | whole app | whole app | per service |
| Team autonomy | low | medium | high |
| Operational cost | lowest | low | high |

<div class="ok">

**Monolith first**: moving a boundary inside one codebase is a refactoring; between services, a migration.

</div>

---

## When splitting pays off

| Force | BoxOffice example |
|---|---|
| Different scaling profile | `catalog` read-heavy vs `inventory` write-hot |
| Team autonomy | search ships twice a day; payments monthly |
| Failure isolation | `assistant` down must not stop ticket sales |
| Compliance scope | only `payment` touches the provider (PCI) |
| Different technology | `assistant` in Python, core in Java |

<div class="warn">

**Distributed monolith**: services deployed together, shared tables, long synchronous chains, a shared domain library.

</div>

---

## Boundaries with DDD

- **Subdomains**: core (inventory, waiting room) → build; supporting (catalog, notifications); generic (auth, payments, e-mail) → **buy**.
- **Bounded context**: where one model — and one meaning of each word — applies.

<div class="cols">
<div>

**"Event" in three contexts**

- Catalog: artist, date, venue, images
- Inventory: seat map, sections, holds
- Order: event id, seat, **price paid**

</div>
<div>

**Aggregate rules**

- reference other aggregates **by id**
- one transaction changes **one** aggregate
- the root enforces the invariants

</div>
</div>

---

## Context maps and Conway's law

- **Open Host Service**: `catalog` publishes REST + OpenAPI for any consumer.
- **Customer / Supplier**: `inventory` plans its hold API with `order`.
- **Anti-Corruption Layer**: `payment` translates the provider's model at the border.

> "Organizations produce designs that copy their communication structure." — Conway, 1968

- If boundaries and teams disagree, **the teams win**.
- **Inverse Conway maneuver**: shape stream-aligned teams per capability, plus a platform team.
- **Database per service**: others use the API or the events — never the tables.

---

## Inside one service: ports and adapters

```java
// core: a port in business terms
public interface PaymentGateway {
    ChargeResult charge(PaymentId id, Money amount,
                        PaymentMethodToken method, IdempotencyKey key);
}
// adapter: the only class that knows the provider's API
class ProviderPaymentGateway implements PaymentGateway { /* translate THEIR states */ }
```

- **SOLID**, especially **D**ependency inversion: business code depends on abstractions it owns.
- Payoff: millisecond tests with a fake, a second provider is a new adapter.
- Do **not** over-architect a CRUD service: layered is fine there.

---

## One resource, four styles

<div class="cols">
<div>

**REST + OpenAPI**
`GET /v1/events/evt_42?include=availability`
cacheable, universal

**GraphQL**
`event(id: "evt_42") { title availability { section seatsLeft } }`
client picks the fields

</div>
<div>

**gRPC + protobuf**
`rpc GetAvailability (Req) returns (Availability)`
typed, binary, streaming, deadlines

**Async + AsyncAPI**
topic `inventory.availability.v1`
`AvailabilityChanged {eventId, section, seatsLeft}`

</div>
</div>

<p class="small">Same resource, different contracts: OpenAPI document, <code>.proto</code>, GraphQL schema, AsyncAPI.</p>

---

## Choosing a style

| | REST | gRPC | GraphQL | Async |
|---|---|---|---|---|
| Payload | JSON | protobuf | JSON | JSON / Avro / protobuf |
| Browser-native | yes | no (gRPC-Web) | yes | push via WS/SSE |
| HTTP caching | excellent | none | hard | n/a |
| Coupling in time | yes | yes | yes | **none** |
| Best for | public, partners, cacheable reads | internal high-QPS, streaming | BFF composing services | side effects, fan-out |

- BoxOffice: **REST** at the edge, **GraphQL BFF** for apps, **gRPC** order → inventory, **events** after confirmation, **webhooks** in from the provider.
- gRPC catch: long HTTP/2 connections defeat **L4** load balancing. GraphQL catch: **N+1** → DataLoader.

---

## Designing and evolving a contract

- REST: correct methods and codes (`201`, `202`, `409`, `422`, `429`), **Problem Details** errors, **cursor** pagination, `ETag` + `Cache-Control`.
- Unsafe writes (`POST /holds`, `POST /orders`) require an **`Idempotency-Key`**.

| Compatible | Breaking |
|---|---|
| add endpoint / optional field / response field | remove or rename a field |
| new enum value in input | change type or meaning (reais → cents) |
| protobuf: new tag | protobuf: reuse a tag (`reserved`!) |

**Expand and contract**: v2 next to v1 → migrate → `Sunset` header → remove v1. Catch breaks with **contract tests** (Pact).

---

## Async work: off the request path

Does the user's answer depend on this step? **No → job on a queue → worker.**

- Confirm order: in the request. Ticket PDF, e-mail, push, dashboard, search: **workers**.
- Gains: latency, availability (e-mail down ≠ sales down), load leveling, independent scaling.

<div class="q">

100 orders/s, 0.8 s per ticket job, 40 workers. Backlog after 10 min of peak?

</div>

* Capacity 40 / 0.8 = 50 jobs/s → grows 50/s → **30,000 jobs**, last fan waits ~10 min.
* Keeping up needs 100 × 0.8 = **80 workers** — if the e-mail provider's rate limit allows.

---

## Jobs that survive the real world

Delivery is **at least once** — so:

- **Idempotent jobs** (check before acting, dedupe keys); **ack after** the work.
- **Ids in messages**, not data; a **timeout** per job.
- **Retry with backoff**, then the **DLQ** (poison messages); alert on DLQ growth.
- **Separate queues** by priority: tickets ≠ marketing e-mails.
- **Respect downstream limits**: more workers than the provider allows = `429`s.
- Scale workers on **queue depth / lag**, not CPU.

<p class="small"><code>@Async</code> is not a queue: work disappears on deploy. Spring Kafka: <code>@RetryableTopic</code> + <code>@DltHandler</code>.</p>

---

## Schedulers

<div class="warn">

`@Scheduled` on 10 replicas = the job runs **10 times**.

</div>

| Fix | How |
|---|---|
| Kubernetes **CronJob** | own pod; `concurrencyPolicy: Forbid` |
| **Distributed lock** (ShedLock) | all try, the lock holder runs |
| **Leader election** | `Lease`, etcd, ZooKeeper |
| **Managed scheduler** | EventBridge Scheduler, Cloud Scheduler |

- Locks **expire** (GC pause!) → **fencing tokens**, or idempotent conditional writes.
- Keep the scheduler **off the critical path**: lazy hold expiry + sweeper; `onSaleAt` checked in data.

---

## Serverless

- Platform runs your function **per event**, scales to zero, bills per invocation + **GB-seconds**.
- **Cold start**: create sandbox + start runtime + init (JVM: seconds) → provisioned concurrency, SnapStart, native image.
- **Concurrency = rate × duration**: 1,500 req/s × 0.2 s = **300** environments.
- Limits: account quota (Lambda default 1,000 per Region), 15-min max, no long connections.

<div class="warn">

Serverless scales; **your database does not**: 300 environments = 300 connections → RDS Proxy / PgBouncer, reserved concurrency.

</div>

<p class="small">Cheapest for spiky, mostly idle work (~US$ 1 per million short invocations, illustrative); steady busy services favor containers.</p>

---

## Autoscaling

> desiredReplicas = ⌈ currentReplicas × currentMetric / target ⌉ — every 15 s (HPA)

- 6 replicas at 90% CPU, target 60% → **9**. Scale-down waits 5 min (stabilization).
- Levels: **HPA/KEDA** (replicas), **VPA** (size), **Cluster Autoscaler / Karpenter** (nodes).
- Metric: CPU (CPU-bound), RPS or concurrency (I/O-bound), **consumer lag** (workers, KEDA).
- Policies: target tracking, step, **scheduled**, predictive, queue-based.

<div class="warn">

`maxReplicas` from the **database budget**: 500 connections / pool of 20 = 25 replicas max.

</div>

---

## Autoscaling lag

| Step | Typical (illustrative) |
|---|---|
| metrics collected | 15–60 s |
| HPA loop | ≤ 15 s |
| new node, if needed | 30–120 s |
| image pull | 5–60 s |
| JVM start + warm-up | 10–60 s |
| **total** | **~1–4 min** |

<div class="ok">

A flash sale goes 1× → 20× in seconds. For **known** peaks: **scale on a schedule** at 09:45 and pre-warm. For unknown ones: headroom, **waiting room**, rate limiting, load shedding.

</div>

---

## External integrations: what you do not control

- Latency with a heavy tail, **their** availability, **rate limits**, their API calendar, per-call cost.
- Outcomes **decided later**: `processing`, 3-D Secure, webhook.

**Payment states**: CREATED → PENDING → SUCCEEDED / FAILED · timeout → **UNKNOWN** → query / webhook

<div class="warn">

A timeout is **not** a failure: releasing the seats of a fan who *was* charged is a real bug. Nor is it a success.

</div>

- One **adapter** per provider, with timeout, circuit breaker and bulkhead.

---

## Idempotency keys

- **Inbound**: the app sends `Idempotency-Key` per logical action (the *Pay* press), reused on every retry.
- **Outbound**: BoxOffice sends a key derived from its own id (`ord_9`) to the provider.

| Case | Behavior |
|---|---|
| same key, same request, done | replay the stored response |
| same key, in progress | `409` |
| same key, different request | `422` |
| failed before commit | delete the key, allow retry |

<p class="small">Implementation: table with primary key <code>(client_id, key)</code>, <code>INSERT … ON CONFLICT DO NOTHING</code>, response stored in the same transaction, purge after 24 h.</p>

---

## Webhooks

| Delivery property | Receiver must… |
|---|---|
| anyone can call your URL | **verify the HMAC** over the raw body |
| captured requests can be replayed | check the **timestamp** |
| at-least-once, retried for days | **deduplicate** by event id |
| no ordering | apply **monotonic** transitions |
| slow handler → provider retries | **ack fast**, process in a worker |
| deliveries can be lost | **reconcile** |

<p class="small">Standard Webhooks: <code>webhook-id</code>, <code>webhook-timestamp</code>, <code>webhook-signature</code> over <code>id.timestamp.body</code>; compare with <code>hmac.compare_digest</code>.</p>

---

## Reconciliation and provider outages

- **Reconcile** at two speeds: a sweeper for `UNKNOWN`/`PENDING` payments (minutes) and a daily match against the provider's report.
- Mismatch "provider succeeded, ours pending" → confirm, or **refund** if the hold expired.

| Provider down | BoxOffice does |
|---|---|
| Payment | breaker opens, fail fast, **extend holds**, sweeper resolves in-flight |
| E-mail | queue, throttle to the limit, fail over to a second provider |
| Venue maps | degrade: static image |

---

<!-- _class: tight -->

## The compute concept map

| Component | Question it answers | Key concepts |
|---|---|---|
| `app` | where does request logic run, how does it scale? | stateless, 50–70% target, REST / gRPC / GraphQL |
| `worker` `queue` | what runs outside the request? | workers = rate × time, at least once, DLQ |
| `scheduler` | what runs at a time — once? | CronJob, locks, leader election, fencing |
| `serverless` | what scales per request, to zero? | cold start, concurrency = rate × duration |
| `auth` `search` `notifications` `analytics` | which capabilities are shared? | bounded contexts, event-fed, often bought |
| `payment` `email` `thirdparty` | how to depend on what we don't control? | idempotency keys, webhooks, reconciliation |
| *(the whole tier)* | how many replicas, and when? | HPA, KEDA, autoscaling lag, scheduled scaling |

<p class="small">Compute scales easily <b>because</b> it is stateless — state lives in the stores of the next two classes.</p>

---

## Takeaways

1. Stateless app servers scale **out**; size them at **50–70%** utilization + spare.
2. Start **modular**; split on a real force; boundaries = **bounded contexts**, shaped by **teams**.
3. REST at the edge, gRPC inside, GraphQL for BFFs, events for side effects — evolve **compatibly**.
4. Off the request path: **idempotent jobs**, retries, **DLQ**; schedulers that run **once**.
5. Serverless: **cold starts, concurrency = rate × duration**; autoscaling **lags** — pre-scale known peaks.
6. Integrations: **idempotency keys**, **verified webhooks**, **UNKNOWN** state, **reconciliation**, an outage plan per provider.
