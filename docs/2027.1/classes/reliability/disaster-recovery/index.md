Two bad nights, two very different disasters.

On the first, the cloud region where BoxOffice runs has a major outage: networking inside the region is degraded for hours. Every replica of every service is in that region — three availability zones, all affected. Redundancy *inside* the region does not help.

On the second, everything is up. At 22:00 an engineer runs a cleanup script against what they believe is the staging database. It is production: `DELETE FROM orders WHERE created_at < now()` — every order is gone. The PostgreSQL standby in another zone faithfully replicates the delete within milliseconds. Redundancy does not help here either; it *spread* the damage.

**Disaster recovery** (DR) is the set of strategies, tools and procedures to restore service and data after events like these — events larger than what the resilience patterns of the [previous page](../patterns/index.md) absorb. It starts with two numbers.

---

## RPO and RTO { #rpo-rto }

**RPO — Recovery Point Objective**
: The maximum amount of **data**, measured in time, you accept to lose. RPO = 5 minutes means that after recovery, at most the last 5 minutes of writes may be missing.

**RTO — Recovery Time Objective**
: The maximum **time** from the disaster until service is restored. RTO = 1 hour means fans can buy tickets again at most one hour after the failure.

``` diagram
flowchart LR
    lb["last good<br/>recovery point"] -->|"RPO: data lost"| d(("disaster<br/>22:00"))
    d -->|"RTO: service down"| r["service<br/>restored"]
```

They are business decisions expressed in minutes, and they map to money: every minute of RTO during an on-sale is lost sales; every minute of RPO is orders (and payments!) that must be reconstructed by hand or refunded. Lower numbers cost more, roughly exponentially.

!!! example "BoxOffice: RPO and RTO per service"

    | Service / data | Why | RPO | RTO |
    |---|---|---|---|
    | `order` + `payment` ledger | Money; fans were charged | ≈ 0 for confirmed payments (reconcile with the provider) | 15 min |
    | `inventory` (seats, holds) | No double booking after recovery | ≈ seconds; holds can be lost, sold seats cannot | 15 min |
    | `catalog` (events, venues) | Changes are rare and can be redone | 1 h | 1 h (and served stale from the CDN meanwhile) |
    | `search` index | Rebuilt from the catalog | n/a (derived data) | 4 h |
    | Analytics / warehouse | Not customer-facing | 24 h | 2 days |

    Different data deserves different targets. Giving everything the strictest target is the most expensive possible plan.

??? question "Think first: the standby replicated the DELETE. Which number did redundancy help with?"

    Neither. A synchronous standby gives an excellent RPO and RTO for **infrastructure** failures (the primary's machine dies: promote the standby, lose nothing). For **logical** failures — a bad script, a buggy deploy writing garbage, ransomware encrypting rows — the standby is an exact copy of the damage. Recovering needs a copy of the data **as it was before** the mistake: a backup, with point-in-time recovery. Replication and backups solve different problems; you need both.

---

## Backups { #backups }

A **backup** is a copy of data, kept independently from the original, from which you can restore. The kinds:

| Type | What it copies | Restore needs | Trade-off |
|---|---|---|---|
| **Full** | Everything | Just it | Slow and big; taken rarely (e.g. weekly) |
| **Incremental** | Changes since the last backup of any kind | Last full + every incremental since | Small and fast to take; slower to restore |
| **Differential** | Changes since the last full | Last full + last differential | In between |
| **Snapshot** | Point-in-time image of a disk or volume (copy-on-write) | The snapshot | Fast; crash-consistent unless the database is told |
| **Continuous archiving (PITR)** | A base backup + every write-ahead log (WAL) segment | Base backup + WALs replayed up to the chosen instant | Restores to **any moment**, e.g. 21:59:30 |

**Point-in-time recovery** (PITR) is what saves the second night. PostgreSQL continuously archives its WAL[^3] to object storage (with tools such as pgBackRest or WAL-G, or automatically in managed databases like Amazon RDS and Cloud SQL). To undo the 22:00 delete, restore the latest base backup and replay the WAL up to just before it:

```bash
# restore the order database to 21:59:30, just before the accidental DELETE at 22:00
pgbackrest --stanza=order --type=time "--target=2027-03-14 21:59:30-03" \
  --target-action=promote restore
```

RPO is then the WAL archiving delay (seconds to a minute), and RTO is the **restore time**, which you must estimate — and measure:

$$
t_{\text{restore}} \approx \frac{\text{base backup size}}{\text{restore throughput}} + \frac{\text{WAL to replay}}{\text{replay throughput}}
$$

!!! example "BoxOffice: how long does the restore take?"

    The `order` database has 2 TB. Restoring from object storage at 200 MB/s takes $2\,000\,000 / 200 = 10\,000$ s ≈ **2.8 hours**, before replaying a day of WAL. That breaks the 15-minute RTO. Options: restore into a database that is already provisioned and close to the target (smaller daily base backups, faster storage), keep a **delayed replica** (a standby that applies WAL with a 1-hour delay, so a mistake can be caught before it reaches it), or split the data so the critical part (open orders, the payment ledger) is small. The number decides the design.

### Rules for backups that actually work

- **3-2-1**: at least **3** copies of the data, on **2** different kinds of storage, **1** of them off-site (another region or account). Modern practice adds one **immutable** copy (object lock / WORM — write once, read many) that even an attacker with admin credentials cannot delete, against ransomware.
- **Separate the blast radius.** Backups in the same account, with the same credentials, as production can be deleted by the same mistake or the same attacker.
- **Encrypt** backups and manage the keys separately; a backup is a full copy of your customers' data (LGPD/GDPR apply).
- **Test restores regularly.** A backup that has never been restored is a hope. Automate a periodic restore into a scratch environment and check the data (row counts, checksums, a smoke test of the application).
- **Monitor** backup jobs and WAL archiving lag; alert when they fail or fall behind.

!!! warning "The GitLab lesson"
    In January 2017, GitLab.com lost about six hours of production database data after an engineer deleted the data directory on the wrong server during an incident. Of the several backup and replication mechanisms in place, none could be used as intended — some had been silently failing for a long time. The company published a candid postmortem[^4] that is worth reading: backups you do not test are not backups.

---

## Multi-AZ and multi-region { #multi-region }

| | Multi-AZ (one region) | Multi-region |
|---|---|---|
| **Protects against** | Loss of a data centre / zone | Loss of a whole region; some regional dependencies |
| **Distance and latency** | Kilometres, ~1 ms | Hundreds to thousands of km, tens of ms or more |
| **Replication** | Synchronous is affordable (RPO ≈ 0) | Usually **asynchronous** (RPO = replication lag) |
| **Failover** | Automatic, seconds to minutes (managed databases do it) | A bigger decision: DNS, data, capacity; minutes to hours |
| **Cost** | Moderate | High: a second copy of (part of) everything, plus data transfer |
| **Complexity** | Low | High: data consistency, deploys to two regions, testing |

Synchronous replication across regions puts a cross-region round trip in every write: $\approx 30$–$100$ ms per commit is often unacceptable for the seat-hold path. So multi-region DR usually means **asynchronous** replication, and an RPO equal to the replication lag at the moment of the disaster. That is why "RPO = 0 across regions" is either very expensive (synchronous replication, or a globally consistent database such as Spanner or CockroachDB paying the latency) or a misunderstanding.

Multi-region is also a **legal** question: personal data may be subject to residency rules (LGPD in Brazil, GDPR in the EU), which constrain which regions can hold the copy.

!!! info "Try it in the playground: RPO and RTO of one failover"

    The `db-failover` scenario is the flash-sale checkout — 1,500 req/s, half of them writes — on a primary with one follower replicated **asynchronously**. At t = 90 s the primary dies and the promotion takes 30 s. Press **Run** and read two numbers: about **1,600 lost writes** (orders acknowledged by the primary but still inside the replication lag: the RPO) and an availability of about **90.6%** (30 s in which every write fails: the RTO). Then select the cluster and change one knob at a time:

    - **Replication: sync** — lost writes drop to **0**, availability stays at 90.6%: a better RPO, the same RTO, and every write now pays a round trip to the follower.
    - **Failover time: 5 s** (back to async) — availability rises to about **98.1%**, but the ~1,600 orders are still lost.

    The possible solution does both — quorum replication with 2 followers, a 5 s failover — and splits the keys over 2 shards, so a dead primary takes only half of the writes with it: 0 lost, about 99.2% available. RPO and RTO are separate knobs, and each one has its own price.

<div class="sdp" data-scenario="db-failover" data-mode="compact" data-height="520"></div>

---

## The four DR strategies { #dr-strategies }

The AWS disaster-recovery whitepaper describes a spectrum of four strategies, from cheap and slow to expensive and instant[^1]. The same ideas apply on any cloud[^2].

| Strategy | What runs in the recovery region before the disaster | Typical RPO | Typical RTO | Cost |
|---|---|---|---|---|
| **Backup and restore** | Nothing but backups (and infrastructure as code) | Hours | Hours to a day | $ |
| **Pilot light** | Data replicated continuously; core infrastructure provisioned but **off** or at minimum (no app servers) | Minutes | Tens of minutes to hours | $$ |
| **Warm standby** | A complete, **scaled-down** copy running and serving nothing (or test traffic) | Seconds to minutes | Minutes | $$$ |
| **Multi-site active-active** | Full copies in two or more regions, **all serving** production traffic | ≈ 0 to seconds | ≈ 0 (traffic shifts) | $$$$ |

=== "Backup and restore"

    ``` mermaid
    flowchart LR
        subgraph A ["Region A (primary)"]
            appA["services"] --> dbA[("databases")]
        end
        subgraph B ["Region B (recovery)"]
            bk[("backups + WAL<br/>(object storage)")]
            iac["infrastructure as code<br/>(nothing running)"]
        end
        dbA -->|"backups, WAL archive"| bk
    ```

    After a disaster, create the infrastructure from code, restore the databases, deploy the services, switch DNS. Cheapest; RTO dominated by restore time and by how well-rehearsed the procedure is.

=== "Pilot light"

    ``` mermaid
    flowchart LR
        subgraph A ["Region A (primary)"]
            appA["services"] --> dbA[("databases")]
        end
        subgraph B ["Region B (recovery)"]
            dbB[("database replicas<br/>(running)")]
            appB["services<br/>(off: 0 replicas)"]
        end
        dbA -->|"async replication"| dbB
    ```

    The "pilot light" is the data, always on and current. On a disaster, promote the replicas, start the services (scale from 0), switch DNS.

=== "Warm standby"

    ``` mermaid
    flowchart LR
        subgraph A ["Region A (primary, 100%)"]
            appA["services × 12"] --> dbA[("databases")]
        end
        subgraph B ["Region B (standby, ~10%)"]
            appB["services × 2<br/>(running, idle)"] --> dbB[("replicas")]
        end
        dbA -->|"async replication"| dbB
    ```

    Everything already runs in region B at small scale and is continuously tested. On a disaster, promote, **scale up**, switch traffic. Scaling up must not depend on region A (images, secrets, quotas available in B).

=== "Multi-site active-active"

    ``` mermaid
    flowchart LR
        dns["GeoDNS / global LB"] --> A
        dns --> B
        subgraph A ["Region A (serving)"]
            appA["services"] --> dbA[("data")]
        end
        subgraph B ["Region B (serving)"]
            appB["services"] --> dbB[("data")]
        end
        dbA <-->|"replication both ways"| dbB
    ```

    Both regions serve users all the time; losing one means sending its traffic to the other (which must have the capacity). The hard part is the data: two regions accepting writes to the same records need conflict resolution or a globally consistent database.

### Active-active and the seat inventory

Active-active is easy for **read-mostly** data: the catalog can be read in any region from local replicas and the CDN. It is hard for data with **strong invariants**: if São Paulo and Virginia both accept holds for seat B-12 and replicate asynchronously, two fans can buy the same seat — exactly what BoxOffice must never do (see [Consistency](../../distributed/consistency/index.md)). The options:

- **Home region per entity**: each event (show) is owned by one region; all holds and sales for it go there; the other region is its warm standby. Fans in other regions pay a little latency for that show. Ownership moves only during a failover.
- **A globally consistent database** (Spanner, CockroachDB, YugabyteDB): consensus across regions on every write, at the cost of cross-region latency on the seat-hold path.
- **Multi-leader with conflict resolution** (last-writer-wins, CRDTs): fine for a shopping cart or a "favorites" list, **unacceptable** for seats.

---

## Failover between regions

A regional failover is a sequence of steps, each with a duration that adds to the RTO:

``` diagram-sim
sequenceDiagram
    participant M as external monitors
    participant OC as on-call
    participant DNS as DNS (health-checked)
    participant A as region A
    participant B as region B (warm standby)
    Note over A: region degraded at 22:00
    M->>OC: purchase probes failing from 3 locations (2 min)
    OC->>OC: confirm it is regional, declare disaster (5 min)
    OC->>A: fence: stop writes in A (if reachable)
    OC->>B: promote database replicas (1 min)
    OC->>B: scale services from 2 to 12 replicas (5 min)
    OC->>DNS: point boxoffice.example to region B
    Note over DNS: clients follow after the TTL (60 s)
    DNS-->>B: traffic arrives, RTO ≈ 14 min
```

$$
\text{RTO} \approx t_{\text{detect}} + t_{\text{decide}} + t_{\text{promote}} + t_{\text{scale}} + t_{\text{DNS TTL}}
$$

Points that decide whether it works:

- **Detection from outside.** Probes that run inside the failing region may fail with it. Use external synthetic checks of the purchase journey.
- **Automatic or human decision?** Automatic failover is fast but risky: a network blip that triggers a regional failover (and then a failback) can cause more damage than it prevents ("flapping"). Many teams automate *within* a region and keep a human decision, with a rehearsed runbook, *across* regions.
- **Fencing.** Before the standby accepts writes, make sure the old primary cannot (revoke its credentials, stop it, or use a lease). Two primaries accepting holds is **split brain**: double-sold seats.
- **DNS TTL.** Clients and resolvers cache DNS answers for the TTL; a 1-hour TTL means a 1-hour tail of traffic going to the dead region. Health-checked DNS records (e.g. Amazon Route 53 failover records) with short TTLs on the entry point (see [DNS and CDN](../../edge/dns-cdn/index.md)).
- **Static stability.** The recovery region must not depend on the failed one: container images, secrets, configuration and capacity quotas must already be in region B.
- **Failback.** Coming back is another migration: resynchronize data from B to A, then switch at a quiet time. Plan and rehearse it too.

!!! info "Try it in the playground"

    The `multi-region` scenario has DNS failover between two regions. Run it with the **load** profile, then trigger a **region outage** on the primary. Watch the error rate until the DNS health check fails over, and note how long it takes. Change the DNS TTL and the health-check interval and measure the new recovery time; then reduce the standby region's capacity and see what happens to latency right after the failover.

<div class="sdp" data-scenario="multi-region" data-mode="compact" data-chaos="off" data-height="540"></div>

---

## The BoxOffice DR plan

| Tier | Services | Strategy | RPO | RTO |
|---|---|---|---|---|
| **Tier 0** — revenue | `order`, `payment`, `inventory` | Multi-AZ synchronous standby in the region + **warm standby** in a second region (async replication), PITR backups with 35-day retention, immutable copy in another account | Seconds (in region: 0) | 15 min |
| **Tier 1** — browsing | `catalog`, `gateway`, `auth`, waiting room | Active-active reads (CDN + replicas in both regions); catalog writes only in the primary | 1 h for catalog edits | 5 min (mostly DNS) |
| **Tier 2** — derived | `search`, `notification` | **Pilot light**: rebuild the index from the catalog; replay unsent notifications from Kafka | Derived / replayable | 4 h |
| **Tier 3** — internal | analytics, warehouse | **Backup and restore** | 24 h | 2 days |

Why a **warm standby** for tier 0, and not something cheaper or something stronger: the 15-minute RTO rules out backup and restore (restoring the 2 TB `order` database alone takes about 2.8 hours) and makes pilot light risky (promoting and scaling from zero takes tens of minutes); active-active would let two regions sell seat B-12 at once. The price is a second region running at about a tenth of the scale all year, plus the drills that prove it can take over.

And the practices that keep the plan honest:

- **A runbook** per scenario (region loss, database corruption, compromised account) with the exact commands, owners and the decision criteria.
- **DR drills** twice a year: actually fail over to region B for an hour in a quiet period, and restore a production backup into a scratch environment every month. The [chaos engineering](../chaos/index.md) page covers how to run them as game days.
- **Review RPO/RTO with the business** yearly: the stadium contract may demand more, or the analytics tier may accept less.

!!! tip "In the interview"
    When asked "what if the region goes down?" or "what if someone deletes the table?", start with **RPO and RTO per data class** — then pick the cheapest strategy that meets them. Distinguish clearly: **replication** protects against infrastructure loss, **backups with PITR** against logical corruption. For a system with strong invariants (seats, balances), say why active-active is hard (conflicting writes) and propose a home region per entity with a warm standby. Quote the RTO as a sum of steps, including the DNS TTL.

!!! success "Best practices"

    - **Agree RPO and RTO per data class with the business, and write them in the runbook** — a single strict target for everything is the most expensive plan; the payment ledger and the analytics warehouse differ by a day.
    - **Time every restore test and compare it with the RTO** — the arithmetic decides the design: 2 TB at 200 MB/s is 2.8 hours against a 15-minute RTO.
    - **Alert on the WAL archiving lag** — it *is* the real RPO of point-in-time recovery; a lag of an hour means an hour of orders to rebuild by hand.
    - **Keep the entry point's DNS TTL at 60 s or less, with health-checked records** — every second of TTL is a tail of fans still sent to the dead region.
    - **Deploy the standby region from the same infrastructure code on every release** — images, secrets and configuration already in region B; a standby updated by hand drifts until the day it is needed.

!!! warning "Common pitfalls"

    - **"We have replicas, so we have backups."** Replicas copy the mistake.
    - **Never testing a restore** — or measuring its time only during the disaster.
    - **Backups in the same account and region** as production, deletable by the same credentials.
    - **A recovery region that depends on the failed region** (images, secrets, the CI system, the DNS provider's control plane in that region).
    - **Ignoring capacity**: a warm standby that cannot scale up because the region has no spare quota on a busy day.
    - **No fencing**: the old primary comes back and accepts writes — split brain, double-sold seats.

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    BIZ["RPO and RTO<br/>per data class"] --> STRAT["backup and restore · pilot light ·<br/>warm standby · active-active"]
    INFRA["infrastructure loss<br/>(zone, region)"] --> REPL["replication, multi-AZ<br/>→ Databases — replication"]
    LOGIC["logical corruption<br/>(the bad DELETE)"] --> PITR["PITR backups, 3-2-1,<br/>immutable copy"]
    REPL --> STRAT
    PITR --> STRAT
    STRAT --> AA["active-active vs the seat invariant<br/>→ Distributed — consistency"]
    STRAT --> FO["regional failover:<br/>detect, fence, promote, scale"]
    FO --> FENCE["fencing, no split brain<br/>→ Distributed — consensus"]
    FO --> DNS["health-checked DNS, short TTL<br/>→ Edge — DNS"]
    FO --> DRILL["DR drills, restore tests<br/>→ Chaos engineering"]
```

**Palette components:** [`sql`](../../../reference/components/storage/index.md#sql) (standby, replicas, PITR) · [`objstore`](../../../reference/components/storage/index.md#objstore) (base backups and the WAL archive) · [`dns`](../../../reference/components/edge/index.md#dns) (failover records and TTL) · [`cdn`](../../../reference/components/edge/index.md#cdn) (serves the catalog stale while the origin recovers) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (replays unsent notifications) · [`app`](../../../reference/components/compute/index.md#app) (scaled from 2 to 12 replicas in the standby region). **Scenarios:** `db-failover`, `multi-region`, `db-replicas`. **Continues in:** [Databases — replication](../../databases/replication/index.md), [Distributed — consistency](../../distributed/consistency/index.md), [Distributed — consensus](../../distributed/consensus/index.md), [Edge — DNS & CDN](../../edge/dns-cdn/index.md#dns-routing), [Cloud-native — delivery](../../cloud-native/delivery/index.md) (infrastructure as code), [Project — game day](../../../exercises/project/game-day/index.md).

---

[^1]: AMAZON WEB SERVICES. [Disaster Recovery of Workloads on AWS: Recovery in the Cloud](https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-workloads-on-aws.html){target="_blank"}. AWS Whitepaper, 2021.
[^2]: GOOGLE CLOUD. [Disaster recovery planning guide](https://cloud.google.com/architecture/dr-scenarios-planning-guide){target="_blank"}. Cloud Architecture Center.
[^3]: [PostgreSQL Documentation — Continuous Archiving and Point-in-Time Recovery (PITR)](https://www.postgresql.org/docs/current/continuous-archiving.html){target="_blank"}.
[^4]: GITLAB. [Postmortem of database outage of January 31](https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/){target="_blank"}. GitLab Blog, 2017.
