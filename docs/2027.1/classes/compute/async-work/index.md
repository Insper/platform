When the payment for an order succeeds, BoxOffice has a lot to do: mark the order confirmed, turn the hold into sold seats, **render a ticket PDF** with a QR code (about 800 ms of CPU), **e-mail** it through the provider (300 ms, sometimes 5 s), send a **push notification**, update the **sales dashboard**, and re-index availability for **search**. If the checkout request does all of that before answering, the fan waits seconds, every slow provider slows checkout, and an e-mail outage *fails ticket sales*.

None of that work changes the answer the fan is waiting for — "your order is confirmed". It can happen a moment later, somewhere else. This page is about that "somewhere else": **workers** that process jobs from a queue, and **schedulers** that start work at a given time — and about making both correct when jobs are retried and replicas run in parallel.

---

## What belongs in the request path?

Ask one question about every step: **does the user's answer depend on it?**

| Step after "pay" | Answer depends on it? | Where it runs |
|---|---|---|
| Verify payment succeeded, confirm hold → order `CONFIRMED` | yes — it *is* the answer | in the request (or the payment webhook handler) |
| Render ticket PDF | no | worker |
| Send e-mail with the ticket | no | worker (notification) |
| Push notification | no | worker (notification) |
| Update sales dashboard | no | analytics consumer |
| Update search availability | no | search consumer |

Everything below the first row becomes a **job** (a unit of work described by a small message) placed on a **queue** and executed by **workers** (processes that pull jobs and run them).

``` diagram-sim
sequenceDiagram
    participant F as Fan
    participant O as order
    participant Q as Queue / Kafka
    participant W as ticket worker
    participant N as notification worker
    participant E as E-mail provider
    F->>O: POST /orders/ord_9/confirm
    O->>O: order CONFIRMED (one DB transaction)
    O->>Q: OrderConfirmed {orderId: ord_9}
    O-->>F: 200 Your order is confirmed
    Q->>W: render tickets for ord_9
    W->>W: PDF + QR → object store
    W->>Q: TicketsIssued {orderId: ord_9}
    Q->>N: TicketsIssued
    N->>E: send e-mail with link
    E-->>N: 202 queued
```

What you gain:

- **Latency**: checkout answers in tens of milliseconds instead of seconds.
- **Availability**: the e-mail provider can be down for 20 minutes; jobs wait in the queue and checkout keeps selling.
- **Load leveling**: the queue absorbs the on-sale spike; workers drain it at their own, steady pace.
- **Independent scaling**: ticket rendering is CPU-heavy, e-mail is I/O-bound — each worker pool scales on its own.

What you pay: the result is **eventually** there, not immediately; you need to show status ("your tickets are being issued"), handle failures without a user to show an error to, and make every job safe to run more than once.

!!! info "Publishing reliably"
    "Commit the order, *then* publish the event" has a gap: if the process dies between the two, the order exists and no ticket is ever issued. The **transactional outbox** closes it — write the event to an `outbox` table in the *same* transaction as the order, and let a relay publish it. Class 8 ([messaging](../../messaging/index.md)) covers it; [hands-on 7](../../../hands-on/7/index.md) builds it.

!!! example "In the BoxOffice code: the e-mail leaves the request (lab 7)"

    [Hands-on 7 — Outbox](../../../hands-on/7/outbox/index.md) keeps both versions of `POST /orders` behind one switch, `NOTIFY_MODE`, so you can measure the difference. In `sync` the fan waits while `order` calls `notification`; in `outbox` the order and its `OrderPlaced` event are two inserts in one transaction, and the e-mail happens later. In a test run on a busy laptop at 50 orders/s, p50 went from **4.12 s** (`sync`) to **47 ms** (`outbox`); with `notification` stopped for 20 s, about a third of the `sync` orders failed and none of the `outbox` ones did ([measurements](../../../hands-on/7/measure/index.md)). Note also `ON CONFLICT (hold_id) DO NOTHING`: a retried order for the same hold creates nothing new and emits no second event.

    ``` { .java title="services/order/src/main/java/boxoffice/order/OrderService.java (place an order)" }
    --8<-- "docs/2027.1/hands-on/7/code/services/order/src/main/java/boxoffice/order/OrderService.java:35:62"
    ```

---

## How many workers?

Workers are sized like any server, with **Little's law**: the number of jobs in progress equals the arrival rate times the time each job takes.

$$
\text{workers needed} = \text{job arrival rate} \times \text{time per job}
$$

When arrivals exceed capacity, the excess accumulates as **backlog**, and the backlog drains only at the *difference* between capacity and arrivals:

$$
\text{backlog growth} = \lambda_{\text{in}} - \mu_{\text{workers}}, \qquad
\text{drain time} = \frac{\text{backlog}}{\mu_{\text{workers}} - \lambda_{\text{in}}}
$$

!!! example "Worked example — ticket rendering at on-sale"

    Assume (illustrative) 60,000 seats sell in about 10 minutes → **100 orders/s**; off-peak, 10 orders/s. Rendering one order's tickets takes **0.8 s** of a worker.

    - To keep up at peak: 100 × 0.8 = **80 workers** busy all the time.
    - With only 40 workers (capacity 50/s), the backlog grows by 50 jobs/s: after 10 minutes, **30,000 jobs** are waiting. The last fan waits about 30,000 / 50 = 600 s = **10 minutes** for the tickets, and after the peak the backlog drains at 50 − 10 = 40 jobs/s, taking another **12.5 minutes**.
    - Is that acceptable? Only the SLO can say. If the promise is "tickets in your inbox within 5 minutes", 40 workers are not enough.

```python exec="1" html="1"
from io import StringIO

import matplotlib.pyplot as plt

SECONDS = 50 * 60
JOB_TIME = 0.8                      # seconds of work per job


def arrivals(t):
    return 100.0 if 10 * 60 <= t < 20 * 60 else 10.0


fig, ax = plt.subplots(figsize=(8, 3.6))
for workers, color in [(40, "#d62728"), (60, "#ff7f0e"), (100, "#2ca02c")]:
    capacity = workers / JOB_TIME
    backlog, xs, ys = 0.0, [], []
    for t in range(SECONDS):
        backlog = max(0.0, backlog + arrivals(t) - capacity)
        xs.append(t / 60)
        ys.append(backlog / 1000)
    ax.plot(xs, ys, color=color, label=f"{workers} workers ({capacity:.0f} jobs/s)")
ax.axvspan(10, 20, color="gray", alpha=0.12)
ax.text(15, ax.get_ylim()[1] * 0.92, "on-sale peak\n100 jobs/s", ha="center", va="top", fontsize=8)
ax.set_xlabel("minutes")
ax.set_ylabel("backlog (thousand jobs)")
ax.set_title("Queue backlog during the on-sale spike")
ax.legend(fontsize=8, loc="upper right")
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

Two lessons from the plot. First, a queue **converts a capacity problem into a delay**: nothing failed with 40 workers, fans just waited. Second, the **downstream sets the real limit**: if the e-mail provider accepts at most, say, 100 messages per second on your plan, 500 notification workers do not send faster — they only collect `429 Too Many Requests`. Size the worker pool for the slowest dependency and let the queue hold the rest.

Scale workers on **queue depth or consumer lag**, not CPU: a worker waiting on a slow provider uses no CPU but is not free. [Serverless & autoscaling](../serverless-autoscaling/index.md#scaling-workers-on-queue-depth) shows how (KEDA).

### Try it in the playground

Open the `async-queue` scenario: producers write to a queue drained by a pool of workers.

1. Run the **spike** profile and watch **backlog** and **consumer lag** climb during the burst, then fall.
2. Double the worker replicas: the peak backlog drops and drains sooner — check it against the formula above.
3. Lower the downstream's rate limit: more workers stop helping, and errors appear instead.

<div class="sdp" data-scenario="async-queue" data-mode="compact" data-height="520" data-profile="spike"></div>

---

## Designing jobs that survive the real world

A queue is not magic: workers crash in the middle of jobs, brokers redeliver, providers time out. Most brokers give **at-least-once** delivery: a job is removed (acknowledged) only after the worker says it finished, so a crash before the ack means the job is delivered *again*. Every rule below follows from that.

| Rule | Why | BoxOffice example |
|---|---|---|
| **Make jobs idempotent** | the same job *will* run twice | before rendering, check whether `ord_9` already has tickets; e-mail with a dedupe key `ord_9:tickets` |
| **Ack after the work, not before** | acking first turns a crash into a lost job | commit the Kafka offset after the PDF is stored |
| **Put ids in the message, not data** | messages stay small; the worker reads the current state | `{"orderId": "ord_9"}`, not the whole order |
| **Retry with backoff, then park** | transient errors heal; permanent ones must not block the queue | 4 attempts at 1 s, 2 s, 4 s, then the **dead-letter queue** (DLQ) |
| **Set a timeout per job** | a stuck job holds a worker forever | PDF rendering aborts after 10 s |
| **Separate queues by priority** | a bulk job must not delay urgent ones | `tickets` (urgent) and `marketing-emails` (bulk) on different queues and pools |
| **Record job status** | users and support need to see progress | `ticket_status = PENDING / ISSUED / FAILED` on the order |
| **Respect downstream limits** | more parallelism than the provider allows = errors | a rate limiter in the notification worker |

A **poison message** is one that fails every time (a malformed payload, a bug). Without a retry limit it is retried forever and, on ordered partitions, blocks every message behind it. The DLQ parks it for a human (or a fixed version of the code) and lets the queue move on. Monitor the DLQ size: a growing DLQ is an incident.

With Spring for Apache Kafka, retries with backoff and a dead-letter topic are a few annotations[^3]:

```java title="ticket-worker: TicketJobListener.java"
@Component
class TicketJobListener {

    private final TicketService tickets;

    TicketJobListener(TicketService tickets) { this.tickets = tickets; }

    @RetryableTopic(
        attempts = "4",                                    // 1 try + 3 retries
        backOff = @BackOff(delay = 1000, multiplier = 2.0), // 1 s, 2 s, 4 s (Spring Kafka 4)
        dltTopicSuffix = ".dlt")
    @KafkaListener(topics = "order.confirmed.v1", groupId = "ticket-worker")
    void onOrderConfirmed(OrderConfirmed event) {
        if (tickets.alreadyIssued(event.orderId())) {
            return;                                        // idempotent: duplicate delivery
        }
        tickets.renderAndStore(event.orderId());           // PDF + QR → object store
    }

    @DltHandler
    void onDeadLetter(OrderConfirmed event) {
        tickets.markFailed(event.orderId());               // visible to support; alert on rate
    }
}
```

### Where jobs live

| Option | Durable? | Good for | Watch out |
|---|---|---|---|
| In-process (`@Async`, a thread pool) | **no** — lost on crash or deploy | fire-and-forget work you can afford to lose | not a queue; no retries, no visibility |
| Redis-based queues (Sidekiq, Celery, BullMQ) | mostly (depends on persistence settings) | simple job queues with retries and schedules | Redis memory and persistence configuration |
| Broker queues (SQS, RabbitMQ, Cloud Tasks) | yes | one job → one worker, per-message ack, delays, DLQ | ordering is weak or per group |
| Event log (Kafka, Pub/Sub, Kinesis) | yes, replayable | many consumers of the same facts, high throughput, ordering per key | parallelism capped by partitions; offset-based acks |
| Workflow engines (Temporal, AWS Step Functions) | yes, with state | multi-step processes that last minutes to days, with compensations | a new platform to learn and operate |

**Durable execution** engines deserve a mention: when a process has many steps and waits — "event cancelled → refund 60,000 orders → e-mail each fan → wait 7 days → close the accounting" — writing it as a workflow, whose progress the engine persists after every step, is simpler and safer than chaining queues by hand[^4].

---

## Schedulers { #schedulers }

Some work is triggered by **time**, not by a request or an event:

- every 30 s, **release expired holds** so their seats can be sold again;
- at 10:00:00, **open the sale** for an event;
- 24 h before each show, **send a reminder** to every ticket holder;
- every night, **reconcile** payments with the provider's report ([integrations](../integrations/index.md#reconciliation)).

### The duplicate-cron problem { #the-duplicate-cron-problem }

The obvious implementation is a `@Scheduled` method in the service. It works on one replica. With 10 replicas, **the job runs 10 times**: 10 reminder e-mails per fan, 10 concurrent sweeps fighting over the same rows. The same happens with a cron entry copied to every VM. There are four standard fixes:

=== "Kubernetes CronJob"

    Run the job as its own short-lived pod, created by the cluster on a schedule, so the service replicas never run it.

    ```yaml title="release-holds-cronjob.yaml"
    apiVersion: batch/v1
    kind: CronJob
    metadata:
      name: release-expired-holds
    spec:
      schedule: "* * * * *"              # every minute (cron's finest granularity)
      concurrencyPolicy: Forbid          # never two runs at the same time
      startingDeadlineSeconds: 30        # skip a run that could not start in time
      successfulJobsHistoryLimit: 3
      jobTemplate:
        spec:
          backoffLimit: 2
          activeDeadlineSeconds: 50      # kill a run that hangs
          template:
            spec:
              restartPolicy: Never
              containers:
                - name: sweeper
                  image: ghcr.io/boxoffice/inventory:1.8.2
                  args: ["--job=release-expired-holds"]
    ```

    Simple and visible (`kubectl get jobs`). Granularity is one minute and a pod start costs seconds, so it suits jobs that run every minute or less often.

=== "Distributed lock (ShedLock)"

    Every replica *tries* to run the job, but only the one that acquires a lock in a shared store (PostgreSQL, Redis) actually does.

    ```java title="inventory: HoldSweeper.java"
    @Component
    class HoldSweeper {

        private static final Logger log = LoggerFactory.getLogger(HoldSweeper.class);
        private final HoldRepository holds;

        HoldSweeper(HoldRepository holds) { this.holds = holds; }

        @Scheduled(fixedRate = 30_000)
        @SchedulerLock(name = "releaseExpiredHolds",
                       lockAtMostFor = "PT25S",   // lock expires even if this replica dies
                       lockAtLeastFor = "PT5S")   // absorb small clock differences
        void releaseExpiredHolds() {
            int released = holds.releaseExpired(Instant.now(), 5_000);   // batch of 5,000
            log.info("released {} expired holds", released);
        }
    }
    ```

    ShedLock stores the lock as a row (`name`, `lock_until`, `locked_by`) and acquires it with a conditional `UPDATE`, so it needs no extra infrastructure beyond the service's own database[^2].

=== "Leader election"

    The replicas elect **one leader** that runs all scheduled work; if it dies, another takes over after the lease expires. Kubernetes offers `Lease` objects for this (the same mechanism its own controllers use), and Spring Integration, etcd and ZooKeeper provide election recipes.

    Fits services with *many* periodic tasks, or tasks that must keep running state (a leader that holds a connection to a provider's stream).

=== "Managed scheduler"

    The cloud calls you on a schedule: AWS EventBridge Scheduler, Google Cloud Scheduler, Azure Logic Apps / Functions timers. It invokes an HTTP endpoint, a queue or a function — at most once per schedule *as far as the scheduler is concerned*, still at least once from your endpoint's point of view if it retries.

    Zero infrastructure; supports one-off schedules ("at 2027-03-14T10:00:00-03:00"), which cron cannot express.

### Locks expire: fencing tokens

A distributed lock with an expiry has a subtle hole, described by Martin Kleppmann[^1]: a replica takes the lock, then **pauses** (a long garbage collection, a VM migration) beyond the lock's expiry. Another replica takes the lock and starts the job. The first one wakes up, still believing it holds the lock, and both write.

``` diagram-sim
sequenceDiagram
    participant A as Replica A
    participant L as Lock store
    participant B as Replica B
    participant DB as Database
    A->>L: acquire (token 33), expires in 25 s
    Note over A: GC pause: 40 s
    B->>L: lock expired → acquire (token 34)
    B->>DB: release holds (token 34)
    A->>DB: release holds (token 33) — still thinks it owns the lock
    DB-->>A: rejected: token 33 < 34 already seen
```

The fix is a **fencing token**: the lock store hands out an increasing number with each acquisition, and the protected resource rejects writes carrying an older token. When the resource cannot check tokens, the job itself must be **idempotent** — which you need anyway. A lock is an optimization that avoids duplicated effort; correctness must come from idempotency or from the database (a conditional `UPDATE ... WHERE status = 'ACTIVE' AND expires_at < now()` releases each hold at most once, no matter how many sweepers run).

### Delayed work: three ways to expire a hold

Releasing a hold 10 minutes after it was created is a **delayed job**. Three designs, often combined:

| Design | How | Pros | Cons |
|---|---|---|---|
| **Sweeper** | a scheduled job releases `WHERE expires_at < now()` in batches | simple, catches everything | seats return up to one period late; batch load on the DB |
| **Delayed message** | on hold, enqueue "release H-7" with a 10-min delay (SQS delay, Redis sorted set by due time, RabbitMQ delayed exchange) | precise timing, no scanning | one message per hold; must still be idempotent (hold may be confirmed) |
| **Lazy expiry** | treat a hold as free when `expires_at < now()` at read time | **correct immediately**, no job needed for correctness | expired rows remain until cleaned |

BoxOffice's rule: **correctness never waits for the scheduler**. A hold whose `expires_at` has passed cannot be confirmed, whether the sweeper has run or not (lazy expiry), and a **sweeper** returns its seats to sale. If the scheduler is down for 5 minutes, no seat is sold twice; the seats of expired holds only come back later. (A fully lazy design goes further: new holds may take the seats of an expired hold at once, without waiting for the sweeper.)

!!! example "In the BoxOffice code: lazy check and sweeper in `inventory` (lab 6)"

    In [Hands-on 6 — Holds](../../../hands-on/6/holds/index.md), `confirm` is a conditional `UPDATE` that includes `expires_at > now()`, so an expired hold answers `409` even if no job has touched it. `expireHolds` is the sweeper: every 5 s it expires at most 500 holds and frees their seats in one statement. It runs on every `inventory` replica, with no lock and no leader: `FOR UPDATE SKIP LOCKED` makes each replica skip the rows another one is already processing, which solves the [duplicate-cron problem](#the-duplicate-cron-problem) inside the database. The price is the one in the table: a seat comes back up to 5 s after its hold expired.

    ``` { .java title="services/inventory/src/main/java/boxoffice/inventory/HoldService.java (confirm, sweeper)" }
    --8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/java/boxoffice/inventory/HoldService.java:149:163,189:208"
    ```

!!! example "Opening the sale at 10:00"
    Do not make "the sale opens" depend on a cron firing exactly at 10:00:00 — schedulers are late by seconds, and a missed run would mean no sale. Store `onSaleAt = 10:00:00` with the event; `inventory` simply rejects holds before that instant (a check against the clock, with clocks synchronized by NTP — [distributed](../../distributed/index.md)). The scheduler only does the *preparation*: at 09:45 it scales the fleet up and warms the caches ([serverless & autoscaling](../serverless-autoscaling/index.md#scheduled-and-predictive-scaling)).

The `notification-system` scenario combines a scheduler, a queue and the e-mail/push providers. Try raising the scheduler's job count to simulate the 24-hour reminder burst, and watch where the backlog builds up.

<div class="sdp" data-scenario="notification-system" data-mode="compact" data-height="520"></div>

[:material-open-in-new: Open the full simulator](../../../../playground/index.md)

---

## Trade-offs at a glance

| | Do it in the request | Do it in a worker |
|---|---|---|
| Latency for the user | sum of every step | only the essential steps |
| Failure of a non-essential step | fails the request | retried later; user unaffected |
| Consistency | immediate | eventual — show status |
| Load spikes | hit every dependency at once | absorbed by the queue |
| Debugging | one stack trace | follow a job through queues (tracing) |
| Operational parts | none | broker, workers, DLQ, monitoring of lag |

!!! tip "In the interview"

    Whenever a design has a slow, failure-prone or bursty step that does not change the user's answer, say: *"I'd move it off the request path: the API writes the order and an event in one transaction (outbox), and a worker pool consumes it — idempotent, with retries, exponential backoff and a DLQ. I'd scale the workers on consumer lag."* For scheduled work, mention that cron on every replica runs N times, and pick **CronJob, a lock or leader election** — plus idempotency because locks expire. Then give a number: "100 jobs/s × 0.8 s = 80 workers at peak".

!!! success "Best practices"

    - **Alert on the age of the oldest job, not only on the queue size** — 10 jobs that are 3 hours old are an incident; 10,000 jobs that drain in 30 s are not.
    - **Derive the worker count and write the arithmetic next to the setting** — workers = jobs/s × time per job ÷ target utilization: 100 e-mails/s × 50 ms = 5 busy threads, so 6 or 7. In BoxOffice: `NOTIFY_CONCURRENCY` 1 vs 6 in [lab 7](../../../hands-on/7/measure/index.md).
    - **Use the database as a small job queue before adding a broker** — `FOR UPDATE SKIP LOCKED` lets several workers share a table safely, inside the transactions you already have. In BoxOffice: the hold sweeper of [lab 6](../../../hands-on/6/holds/index.md) (box above).
    - **Record every scheduled run** — start, end, items processed and outcome, as a log line and a metric; a sweeper that freed 0 seats for an hour during a sale is a signal. In BoxOffice: `expireHolds` logs how many seats it freed.
    - **Keep schedules in UTC and store the next due time** — local time zones skip or repeat runs at daylight-saving changes, and a stored due time lets you detect a missed run.

!!! warning "Common pitfalls"

    - **`@Async` treated as a queue**: work disappears on every deploy or crash.
    - **Non-idempotent jobs**: at-least-once delivery turns a retry into a second e-mail or a second charge.
    - **No retry limit and no DLQ**: one poison message blocks a partition forever.
    - **Scaling workers on CPU**: I/O-bound workers look idle while the backlog grows.
    - **More workers than the provider allows**: only produces `429`s.
    - **`@Scheduled` on every replica**: the job runs N times.
    - **Trusting a lock for correctness**: locks expire; use fencing tokens or idempotent, conditional writes.
    - **The scheduler on the critical path**: if "the sale opens" or "the hold expires" requires a job to fire on time, a late job becomes an outage.

---

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    RP["request path: only what<br/>the answer depends on"] --> Q["jobs on a queue<br/>→ Messaging"]
    Q --> W["workers<br/>rate × time per job"]
    W --> JOB["idempotent jobs, ack after work,<br/>retries with backoff"]
    JOB --> DLQ["DLQ for poison messages"]
    W --> SCALE["scale on queue lag<br/>→ Autoscaling"]
    CRON["scheduled work<br/>on N replicas"] --> LOCK["CronJob, distributed lock,<br/>leader election"]
    LOCK --> FENCE["locks expire: fencing tokens<br/>→ Distributed consensus"]
    CRON --> LAZY["lazy expiry + sweeper<br/>seat holds → Databases"]
```

**Palette components:** [`queue`](../../../reference/components/messaging/index.md#queue) (jobs and delayed messages) · [`worker`](../../../reference/components/compute/index.md#worker) (consumers sized by Little's law) · [`scheduler`](../../../reference/components/compute/index.md#scheduler) (cron and delayed work, once per cluster) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (commit the offset after the work) · [`sql`](../../../reference/components/storage/index.md#sql) (ShedLock row, holds that expire lazily) · [`objstore`](../../../reference/components/storage/index.md#objstore) (ticket PDFs) · [`notifications`](../../../reference/components/compute/index.md#notifications) · [`email`](../../../reference/components/external/index.md#email) (the ticket e-mail, off the request path). **Scenarios:** `async-queue`, `notification-system`. **Continues in:** [Serverless & Autoscaling — scaling on queue depth](../serverless-autoscaling/index.md#scaling-workers-on-queue-depth), [Messaging — queues and pub/sub](../../messaging/queues-pubsub/index.md), [Messaging — delivery semantics](../../messaging/semantics/index.md), [Distributed — consensus](../../distributed/consensus/index.md) (fencing), [Hands-on 7](../../../hands-on/7/index.md).

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - Keep only what the user's answer depends on in the request; move the rest to **jobs on a queue** processed by **workers**.
    - Size workers with Little's law (`rate × time per job`); a queue turns overload into **delay**, and the slowest downstream sets the real limit.
    - Delivery is **at least once**: idempotent jobs, ack after work, retries with backoff, a **DLQ** for poison messages, priorities by queue.
    - Scheduled work on N replicas runs N times: use a **CronJob**, a **distributed lock** (ShedLock) or **leader election** — and stay idempotent, because locks expire (**fencing tokens**).
    - Design time-based rules so that correctness does not depend on a job firing on time (**lazy expiry** + sweeper).

---

[^1]: KLEPPMANN, M. [How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html){target="_blank"}. 2016. See also KLEPPMANN, M. *Designing Data-Intensive Applications*, chapter 8 (fencing tokens).
[^2]: [Kubernetes — CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/){target="_blank"}; [ShedLock](https://github.com/lukas-krecan/ShedLock){target="_blank"}.
[^3]: [Spring for Apache Kafka — Non-blocking retries](https://docs.spring.io/spring-kafka/reference/retrytopic.html){target="_blank"}.
[^4]: [Temporal documentation — Durable execution](https://docs.temporal.io/){target="_blank"}.
