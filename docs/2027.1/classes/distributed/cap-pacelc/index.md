BoxOffice expands to Europe. To give fans in Lisbon the same fast experience as fans in São Paulo, the team runs the `inventory` database in **two regions**, each with a full copy of the seats, replicating to each other. One afternoon, during the on-sale of a festival, the transatlantic link between the regions degrades and then drops. Both regions are alive; both keep receiving *"Hold seat A-12"* requests. Each region now has two options for each request: **answer with what it knows** (and risk selling seat A-12 on both sides of the ocean) or **refuse** until the link comes back (and lose the sale). There is no third option. That dilemma is what the CAP theorem formalises.

The **CAP theorem**, conjectured by Eric Brewer in 2000 and proven by Seth Gilbert and Nancy Lynch in 2002[^1], states that a replicated data store **cannot simultaneously guarantee** all three of the following properties:

--8<-- "docs/2027.1/classes/distributed/cap-pacelc/cap-venn.svg"

---

## The three properties

**Consistency (C)**
: Every read returns the most recent write, or an error. In CAP, "consistency" means **linearizability**: the replicas behave as if there were a single copy (see [Linearizability](../consistency/index.md#linearizability)).

**Availability (A)**
: Every request received by a **non-failing** node gets a **non-error** response — even if it does not contain the most recent write. Note the strictness: *every* non-failing node, not "most of the time".

**Partition tolerance (P)**
: The system keeps operating when the network **partitions** — splits the nodes into groups that are alive but cannot exchange messages (or exchange them with unbounded delay).

!!! warning "P is not optional"
    Partitions are not a design choice; they happen — a switch fails, a cable is cut, a cloud region's link degrades, a long GC pause makes a node look unreachable. Any system whose data lives on more than one machine must decide what to do *when* they happen. So the real choice is **C or A, during a partition**. Brewer himself, twelve years later, stressed that partitions are rare and that the interesting design work is in **detecting** them, operating in a limited mode while they last, and **recovering** afterwards[^4].

!!! warning "The C in CAP is not the C in ACID"
    In ACID transactions, *consistency* means "the transaction preserves the invariants" (constraints, foreign keys, `CHECK`). In CAP it means linearizability. A single PostgreSQL server is ACID-consistent and CAP does not even apply to it — CAP is about **replicas**.

---

## A partition, step by step { #partition }

The same request, handled by a system that chooses consistency (CP) and by one that chooses availability (AP):

<div class="csim" data-sim="cap" data-mode="CP" data-rtt="180"></div>

!!! tip "Try it"
    Turn **random traffic** off to see one request at a time. In **CP · PC/EC**, hold a seat on either side: São Paulo (the event's home region, where the leader lives) answers only after Lisbon has stored the hold — **184 ms**, the 180 ms ocean round trip plus 4 ms of local work, on every write. Now **partition the link**: Lisbon answers `503` to reads and writes (it cannot know whether its copy is current), São Paulo keeps selling; heal it and Lisbon just catches up — *confirmed holds lost* stays 0. Restart in **AP · PA/EL**: every hold is confirmed in **4 ms**, but a read in Lisbon less than 90 ms after a São Paulo hold is stale. Partition, hold twice in São Paulo and then once in Lisbon, and heal: last-write-wins keeps Lisbon's later value on both sides and **2 confirmed holds are lost** — two fans were told "held" for seats that can be sold again.

Neither answer is "wrong" in the abstract: the CP system refuses rather than risk a double sale; the AP system serves every fan and must **reconcile** later. Which one is acceptable depends on the **data and the business** — not on the database brand.

??? question "Think first: is there a way to keep selling seats on both sides of the ocean *and* never sell a seat twice?"

    Yes — by **not replicating the decision**. Give each event a **home region** (the region of the venue) and send every hold for that event to its home region's primary. Inside one region, the data is consistent; across regions, there is no shared decision to disagree on. During a transatlantic partition, a Lisbon fan buying a São Paulo show cannot reach the home region and is refused (CP for that event), but every event whose home is reachable keeps selling. You have not escaped CAP — you have **shrunk the blast radius** of the C/A choice to the requests that really cross the partition. See [Multi-region designs](#multi-region).

---

## CP and AP systems

### CP — consistent and partition-tolerant

During a partition, the nodes that cannot confirm the latest state (typically the **minority** side) refuse requests. After the partition heals, they catch up before serving again.

``` diagram-sim
flowchart LR
    CA(["Fan A"]) -->|"1 · hold A-12"| A[("Node A (majority)<br/>A-12 = HELD")]
    A -.-x|"2 · replicate ✗ partition"| B[("Node B (minority)<br/>A-12 = FREE")]
    CB(["Fan B"]) -->|"3 · is A-12 free?"| B
    B -->|"4 · error: no quorum"| CB
```

- **Examples:** etcd, ZooKeeper, Consul, Spanner, CockroachDB; PostgreSQL with synchronous replication; MongoDB with majority reads and writes.
- **Use when:** a wrong answer is worse than no answer — inventory, money, identity, leadership, locks.

### AP — available and partition-tolerant

During a partition, every node keeps answering with the data it has. Replicas diverge and **converge** after the partition heals (eventual consistency), resolving conflicts with LWW, version vectors or CRDTs ([Eventual consistency](../consistency/index.md#eventual)).

``` diagram-sim
flowchart LR
    CA(["Fan A"]) -->|"1 · like event 42"| A[("Node A<br/>likes = 101")]
    A -.-x|"2 · replicate ✗ partition"| B[("Node B<br/>likes = 100")]
    CB(["Fan B"]) -->|"3 · read likes"| B
    B -->|"4 · 100 (stale)"| CB
    A ==>|"5 · partition heals: merge"| B
```

- **Examples:** Cassandra and DynamoDB at default settings, CouchDB, Riak, DNS, CDNs, most caches.
- **Use when:** a slightly stale answer is better than no answer — catalogue, recommendations, counters, carts, feeds.

### "CA"

A system that is consistent and available **as long as there are no partitions** — in practice, a single node, or a cluster that simply has not decided what to do in a partition. It is not a real third option for a distributed system.

| | CP | AP |
|---|---|---|
| **During a partition** | Minority side refuses (errors, timeouts) | Every node answers, maybe stale |
| **After the partition** | Minority catches up, nothing to reconcile | Replicas converge; conflicts must be resolved |
| **Guarantee** | Linearizable | Eventual (or causal at best) |
| **User-visible failure** | "Try again later" | Wrong or outdated data, later corrected |
| **Examples** | etcd, ZooKeeper, Spanner, CockroachDB, PostgreSQL sync replication | Cassandra, DynamoDB (defaults), DNS, CDN, caches |
| **BoxOffice data** | Seats, holds, orders, payments, auth sessions | Catalogue, images, counters, recommendations |

!!! warning "CP and AP describe a configuration, not a product"
    Most databases let you tune the trade-off — even per request. Cassandra with `QUORUM` reads and writes behaves much more like a CP system; PostgreSQL serving reads from an *asynchronous* replica returns stale data during a partition. Many real systems are, strictly, neither CP nor AP: they may be unavailable *and* return stale data in some failure modes[^2]. Ask *"how is it configured, and what do my requests see during a partition?"* rather than *"is this database CP or AP?"*.

---

## PACELC: the trade-off you pay every day { #pacelc }

CAP only talks about **partitions**, which are rare. Daniel Abadi's **PACELC** (2010–2012)[^3] adds the trade-off that exists **all the time**:

> If there is a **P**artition, choose between **A**vailability and **C**onsistency; **E**lse (normal operation), choose between **L**atency and **C**onsistency.

``` diagram-sim
flowchart LR
    Q{"Is there a<br/>partition?"} -->|"yes · P"| PAC{"Availability<br/>or Consistency?"}
    PAC -->|A| PA["PA: answer, maybe stale"]
    PAC -->|C| PC["PC: refuse or wait"]
    Q -->|"no · E (else)"| ELC{"Latency<br/>or Consistency?"}
    ELC -->|L| EL["EL: answer before<br/>the replicas confirm"]
    ELC -->|C| EC["EC: wait for<br/>the replicas"]
```

The *else* branch exists because of replication itself: to be consistent, a write must wait for other replicas to acknowledge (one or more network round trips, maybe to another continent); to be fast, it must answer before they do and accept that a replica may lag.

### How much latency does consistency cost?

The answer is "a round trip to wherever the other replicas are". Round-trip times (RTT) below are typical orders of magnitude, used here as **illustrative assumptions**:

| Where the confirming replicas are | Typical RTT | Cost of an EC write (one extra round trip) |
|---|---|---|
| Same machine / same rack | < 0.5 ms | Negligible |
| Another availability zone, same region | ~1–2 ms | Small: the standard for production databases |
| Another region, same continent | ~10–40 ms | Noticeable on every write |
| Another continent (e.g. São Paulo ↔ Europe) | ~150–200 ms | Dominates the request; a 5-write checkout costs a second |

The [simulator above](#partition) shows the last row with no partition at all: in PC/EC mode each write takes 184 ms, in PA/EL mode 4 ms — and the fast mode pays with stale reads.

This table is why most systems choose **EC inside a region** (synchronous or quorum replication across zones costs a millisecond or two) and **EL across regions** (asynchronous replication, or partitioning data by home region).

| System (typical configuration) | During partition | Else | PACELC |
|---|---|---|---|
| Cassandra, ScyllaDB (`ONE`) | A | L | PA/EL |
| DynamoDB (eventually consistent reads) | A | L | PA/EL |
| MongoDB (majority read/write concern) | C | C | PC/EC |
| PostgreSQL + synchronous standby | C | C | PC/EC |
| Spanner, CockroachDB | C | C | PC/EC |
| PostgreSQL + async read replicas, reads on replicas | (failover may lose writes) | L | —/EL |

---

## Multi-region designs { #multi-region }

Regions fail — rarely, but entirely — and BoxOffice wants to survive that. The C/A/L trade-offs become concrete in five common topologies:

| Topology | Writes | During a region loss | Consistency | Cost and complexity |
|---|---|---|---|---|
| **Single region, multi-AZ** | One primary, sync standby in another zone | Region down = BoxOffice down | Strong | Lowest; the default starting point |
| **Active–passive (warm standby)** | Primary region only; async replica in region 2 | Fail over (DNS) to region 2; lose the last seconds of writes (RPO > 0) | Strong in normal operation | Moderate; failover must be rehearsed |
| **Active–active, partitioned by home** | Each record has a home region; writes go there | Records homed in the dead region are unavailable; others unaffected | Strong per record | Higher; routing by home region |
| **Active–active, everything everywhere** | Any region writes any record | All regions keep writing | Eventual; conflicts to resolve | Highest; only for conflict-tolerant data |
| **Globally consistent database** | Consensus across regions (Spanner, CockroachDB) | Survives a region if a majority of replicas remain | Strong everywhere | Write latency ≥ cross-region RTT; premium cost |

**Try it.** In the `multi-region` scenario, run the `load` profile, then fail the primary region. Watch how long DNS takes to shift traffic (the TTL), how many requests fail during the switch, and what happens to writes that had not yet replicated. Then lower the DNS TTL and repeat.

<div class="sdp" data-scenario="multi-region" data-mode="compact" data-height="520"></div>

[:material-open-in-new: Open the full playground](../../../../playground/index.md)

!!! example "BoxOffice: the chosen design"
    - **Seats, holds, orders, payments** — *active–active partitioned by home region*: each event's inventory lives in the region of its venue, in a PostgreSQL primary with a **synchronous standby in another zone** (PC/EC inside the region). A Lisbon fan buying a São Paulo show pays one transatlantic round trip on the hold — acceptable for a once-in-a-while action.
    - **Catalogue, images, search index** — replicated asynchronously to every region and cached at the CDN (PA/EL). A new event appears in Europe a few seconds later; nobody notices.
    - **Accounts / auth** — read-mostly; replicated everywhere, with writes (password change, logout everywhere) going to a home region.
    - **Disaster recovery** — each region's database ships backups and an async replica to another region (active–passive per region); the RPO/RTO targets are discussed in [Reliability — disaster recovery](../../reliability/disaster-recovery/index.md).

!!! tip "In the interview"
    Never say "I'll pick CP" (or AP) **for the whole system**. Say it per data, and say what the user sees: *"Seat inventory is CP: during a partition, the minority side returns 503 and the app says 'try again'; double booking is unacceptable. The catalogue is AP: it may be seconds stale."* Then bring up **PACELC** — the interviewer usually cares more about everyday latency than about partitions: *"inside a region I replicate synchronously across zones (~1–2 ms); across regions I partition by home region instead of paying 150 ms per write."* Mentioning that CAP's C is linearizability (not ACID's C) is a cheap, strong signal.

!!! success "Best practices"

    - **Write, per operation, what happens during a partition** — "holds are refused (CP); the catalogue is served stale (AP)" — and make the client handle both answers.
    - **Give each key one home region** — writes for one event go to one leader and other regions forward them; no cross-region conflict can exist for a key that has one writer.
    - **Measure what consistency costs on your writes** — the p99 of a write with and without synchronous replication, in your topology; PACELC is a number, not a slogan. Try it in the `db-failover` scenario of [Consensus](../consensus/index.md).
    - **Make "unavailable" a fast, explicit answer** — a CP operation that cannot reach a majority should fail in milliseconds with a retryable error, not hang until a timeout.
    - **Label stale answers in the API** — a header or field with the data's age lets clients decide whether an AP answer is good enough.

!!! warning "Pitfalls"
    - **"We chose CA."** If data lives on more than one machine, partitions will happen; "CA" only means nobody decided what happens then.
    - **Treating CAP as a permanent label.** The C/A choice only applies *during* a partition; the daily trade-off is latency (PACELC).
    - **Forgetting caches and replicas.** A cache in front of a CP store makes those reads AP; an async read replica makes them EL.
    - **Cross-region synchronous replication by default.** It makes *every* write pay an intercontinental round trip — and a degraded link makes the whole system slow.
    - **Unrehearsed failover.** Active–passive only works if failover (and failback) is tested; otherwise the passive region is a theory.

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    REP["Replication<br/>(Replication & Consistency)"] --> Q{"partition?"}
    Q -->|yes| CA{"C or A"}
    Q -->|no| LC{"L or C"}
    CA -->|C| MAJ["majority side only<br/>→ Consensus & Quorums"]
    CA -->|A| MERGE["diverge, then merge<br/>LWW · CRDTs → Time & Clocks"]
    LC -->|C| SYNC["sync replication<br/>across zones"]
    LC -->|L| ASYNC["async replication,<br/>caches, CDN"]
    MAJ --> MR["multi-region design<br/>home region per event"]
    ASYNC --> MR
    MR --> DR["failover & DR<br/>→ Reliability"]
```

**Palette components where the C/A/L choice is made:** [`sql`](../../../reference/components/storage/index.md#sql) (sync standby or async replicas) · [`nosql`](../../../reference/components/storage/index.md#nosql) (tunable quorums) · [`cache`](../../../reference/components/storage/index.md#cache) and [`cdn`](../../../reference/components/edge/index.md#cdn) (always EL) · [`dns`](../../../reference/components/edge/index.md#dns) (failover between regions, scenario `multi-region`). **Continues in:** [Consensus & Quorums](../consensus/index.md), [Reliability — disaster recovery](../../reliability/disaster-recovery/index.md), [Traffic & Edge — DNS](../../edge/dns-cdn/index.md).

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - **CAP**: during a network **partition**, a replicated store must choose between **consistency** (refuse) and **availability** (answer, maybe stale). P is not optional.
    - CAP's C is **linearizability**, not ACID's C; "CA" is not an option for distributed data.
    - **PACELC**: *else* (no partition) the choice is **latency vs consistency** — and you pay it on every request.
    - Choose **per data domain**: seats, money and identity CP/EC; catalogue and counters AP/EL.
    - In multi-region designs, **partitioning data by home region** keeps strong consistency local and limits the blast radius of a partition.

---

[^1]: GILBERT, S.; LYNCH, N. [Brewer's Conjecture and the Feasibility of Consistent, Available, Partition-Tolerant Web Services](https://dl.acm.org/doi/10.1145/564585.564601){target="_blank"}. ACM SIGACT News, 2002.
[^2]: KLEPPMANN, M. [Please stop calling databases CP or AP](https://martin.kleppmann.com/2015/05/11/please-stop-calling-databases-cp-or-ap.html){target="_blank"}, 2015.
[^3]: ABADI, D. [Consistency Tradeoffs in Modern Distributed Database System Design](https://cs.yale.edu/homes/abadi/papers/pacelc.pdf){target="_blank"}. IEEE Computer, 2012.
[^4]: BREWER, E. [CAP Twelve Years Later: How the "Rules" Have Changed](https://www.infoq.com/articles/cap-twelve-years-later-how-the-rules-have-changed/){target="_blank"}. IEEE Computer / InfoQ, 2012.
