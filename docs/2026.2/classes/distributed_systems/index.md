
Distributed systems represent a computing paradigm where multiple independent computers collaborate to achieve a common goal, appearing as a single coherent system to the end-user. Unlike centralised systems where all processing occurs on one machine, distributed systems span networks and leverage interconnected nodes to handle data storage, computation, and communication.

This architecture underpins modern cloud platforms (AWS, Google Cloud, Azure), large-scale applications (social networks, e-commerce), and scientific simulations. The foundational challenge is that nodes operate independently, communicate only by passing messages, and have no shared clock — making coordination a non-trivial engineering problem.

---

## Classification

Distributed systems can be classified along several axes:

| Dimension | Option A | Option B |
|---|---|---|
| **Hardware/software uniformity** | Homogeneous — all nodes run the same stack | Heterogeneous — diverse hardware and OS |
| **Coupling** | Tightly coupled — high interdependence, shared memory | Loosely coupled — communicate via messages, independent lifecycle |
| **Topology** | Client-server — hierarchical, servers hold resources | Peer-to-peer — egalitarian, all nodes share resources |

Web applications follow the client-server model (browsers request from servers). File-sharing systems like BitTorrent follow peer-to-peer. Most microservice architectures occupy the loosely-coupled middle ground.

---

## Advantages

| Benefit | How |
|---|---|
| **Horizontal scalability** | Add nodes instead of upgrading a single machine. Cassandra scales to petabytes by adding nodes seamlessly. |
| **Fault tolerance** | Replication across nodes keeps the system running despite individual failures. Google Spanner uses synchronous cross-datacenter replication. |
| **Resource sharing** | Idle capacity from many machines is pooled. Folding@home aggregates CPU cycles for scientific workloads. |
| **Parallelism** | Tasks are divided and processed concurrently. MapReduce (Hadoop) exemplifies this for big-data analytics. |
| **Latency reduction** | Nodes placed near users reduce round-trip time. CDNs like Akamai serve content from the nearest edge location. |

---

## Disadvantages

| Challenge | Root cause |
|---|---|
| **Complexity** | Coordination, synchronisation, and distributed state are hard to reason about and implement correctly. |
| **Network overhead** | Messages can be delayed, lost, or duplicated. Every failure mode must be handled explicitly. |
| **Consistency vs availability** | Keeping data consistent across nodes while staying available under failure is provably impossible — see the CAP Theorem. |
| **Expanded attack surface** | More nodes mean more entry points. Byzantine faults (malicious nodes) require dedicated protocols. |
| **Operational cost** | Debugging, monitoring, and deploying distributed systems requires specialised tooling (Prometheus, Kubernetes, distributed tracing). |

### The 8 Fallacies of Distributed Computing

Peter Deutsch[^2] identified eight assumptions developers commonly make when building distributed systems — all of them wrong:

| Fallacy | Reality |
|---|---|
| The network is reliable | Packets are dropped, links fail, cables are cut |
| Latency is zero | Network round-trips add milliseconds; cross-region adds hundreds |
| Bandwidth is infinite | Transferring large payloads saturates links |
| The network is secure | Traffic must be encrypted and authenticated at every hop |
| Topology doesn't change | Nodes go up and down; IPs change; services are rescheduled |
| There is one administrator | Multiple teams, multiple cloud accounts, multiple policies |
| Transport cost is zero | Serialisation, compression, and egress fees are real |
| The network is homogeneous | Different systems speak different protocols and encodings |

!!! warning "Design for failure, not against it"
    These fallacies share a common root: treating the network as a reliable local function call. The correct posture is to assume failure will happen and design every interaction to degrade gracefully.

---

## Topics covered

<div class="grid cards" markdown>

-   :material-scale-balance:{ .lg .middle } **CAP Theorem**

    ---

    The central trade-off in distributed data stores: Consistency, Availability, and Partition Tolerance cannot all be guaranteed simultaneously. Understand CP, AP, and CA system classes — and the PACELC extension.

    [:octicons-arrow-right-24: CAP Theorem](cap/index.md)

-   :material-handshake:{ .lg .middle } **Consensus & Algorithms**

    ---

    How distributed nodes reach agreement despite failures. Covers Paxos, Raft, quorum systems, failure models (crash-stop, Byzantine), the FLP impossibility result, and eventual consistency.

    [:octicons-arrow-right-24: Consensus & Algorithms](consensus/index.md)

</div>

---

[^1]: LAMPORT, L. [Time, Clocks, and the Ordering of Events in a Distributed System](https://lamport.azurewebsites.net/pubs/time-clocks.pdf){target="_blank"}. CACM, 1978.
[^2]: DEUTSCH, P. [Fallacies of Distributed Computing](https://en.wikipedia.org/wiki/Fallacies_of_distributed_computing){target="_blank"}, 1994.
