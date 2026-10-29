# Glossary

The vocabulary of system design, A to Z: distributed systems, data, caching, messaging, reliability, observability, networking, security, cloud-native platforms and AI systems. Each entry is a one- or two-sentence definition with, when there is one, a link to the class page or the [component catalog](../components/index.md) entry where the idea is taught in depth.

!!! tip "How to use"
    Use your browser's search (Ctrl/Cmd + F) or the site search to jump to a term. When you read an unfamiliar word in a class, a paper or an interview question, look it up here, then follow the link. Try defining the terms out loud in one sentence before reading the definition: that is exactly what an interviewer will ask you to do. The [numbers page](../numbers/index.md) has the values behind the formulas mentioned here.

**204 terms.**


## A

- **ACID** — Atomicity, Consistency, Isolation, Durability: the guarantees of a database transaction — all or nothing, invariants kept, concurrent transactions isolated, committed data survives crashes. → [Databases › Transactions](../../classes/databases/transactions/index.md)
- **Active-active / active-passive** — Two redundancy styles: in active-active every site serves traffic at the same time; in active-passive a standby takes over only when the primary fails. → [Reliability › Disaster recovery](../../classes/reliability/disaster-recovery/index.md)
- **Admission control** — Limiting how much work enters a system so that what is admitted completes well; a virtual waiting room is admission control for people. → [Case study: ticketing](../../classes/case-studies/ticketing/index.md)
- **Agent (AI)** — An LLM running in a loop that decides which tools to call, observes the results and continues until the task is done. → [AI systems › Agents](../../classes/ai-systems/agents/index.md)
- **Alerting** — Rules over signals that notify a human when users are affected; good alerts are about symptoms and are actionable. → [Catalog › Alerting](../components/observability/index.md#alerting)
- **Amdahl's Law** — The speedup from parallelism is limited by the serial fraction of the work: speedup = 1 / ((1 − p) + p/n). → [Estimation](../../classes/estimation/index.md)
- **ANN (approximate nearest neighbor)** — Search that finds vectors close to a query vector quickly by accepting that it may miss a few true nearest neighbors; HNSW is a common index. → [Catalog › Vector DB](../components/storage/index.md#vectordb)
- **Anycast** — Announcing the same IP address from many locations so the network routes each user to the nearest one; used by DNS providers and CDNs. → [Edge › DNS & CDN](../../classes/edge/dns-cdn/index.md)
- **API gateway** — The single entry point of an API: routing, authentication, rate limiting, request shaping and observability. → [Catalog › API Gateway](../components/edge/index.md#apigw)
- **At-least-once / at-most-once delivery** — Messaging guarantees: at-least-once never loses a message but may deliver duplicates; at-most-once never duplicates but may lose messages. → [Messaging › Delivery semantics](../../classes/messaging/semantics/index.md)
- **Autoscaling** — Adding or removing capacity automatically based on a metric (CPU, queue depth, requests per second) or a schedule. → [Compute › Serverless & autoscaling](../../classes/compute/serverless-autoscaling/index.md)
- **Availability** — The fraction of time (or of requests) in which a system works correctly, often expressed in nines: 99.9% allows about 8.8 hours of downtime a year. → [Estimation › Availability math](../../classes/estimation/availability-math/index.md)
- **Availability zone (AZ)** — One or more isolated data centers within a cloud region, with independent power and networking; spreading replicas over AZs survives a data-center failure. → [Catalog › Subnet](../components/network/index.md#subnet)

## B

- **Backoff (exponential)** — Waiting longer between successive retries (1 s, 2 s, 4 s…) so that a struggling dependency can recover. → [Reliability › Patterns](../../classes/reliability/patterns/index.md)
- **Back-of-the-envelope estimate** — A quick calculation of load, storage, bandwidth or cost with rounded numbers, to get the order of magnitude that drives the design. → [Estimation › Numbers](../../classes/estimation/numbers/index.md)
- **Backpressure** — A signal from a slow consumer that makes producers slow down or reject work instead of letting queues grow without limit. → [Messaging › Delivery semantics](../../classes/messaging/semantics/index.md)
- **Bandwidth** — The maximum data rate of a link (e.g. 1 Gbps = 125 MB/s); throughput is what you actually achieve. → [Estimation › Numbers](../../classes/estimation/numbers/index.md)
- **BFF (backend for frontend)** — A gateway or thin service tailored to one client type (web, mobile) that aggregates and shapes backend calls for it. → [Edge › API gateway](../../classes/edge/api-gateway/index.md)
- **Bloom filter** — A compact probabilistic set that answers "definitely not present" or "probably present"; used to skip disk reads and to deduplicate. → [Databases › Data models](../../classes/databases/models/index.md)
- **Blue/green deployment** — Running the new version in a full second environment and switching all traffic to it at once, with instant rollback by switching back. → [Cloud-native › Delivery](../../classes/cloud-native/delivery/index.md)
- **B-tree** — The balanced tree index used by most relational databases: updates pages in place and gives fast point and range reads. → [Databases › Data models](../../classes/databases/models/index.md)
- **Bulkhead** — Isolating resources (thread pools, connections, instances) per dependency or tenant so one failure cannot consume everything. → [Reliability › Patterns](../../classes/reliability/patterns/index.md)
- **Burn rate** — How fast an SLO's error budget is being consumed relative to the sustainable rate; a burn rate of 14.4 spends 2% of a 28-day budget in one hour. → [Observability › Alerting](../../classes/observability/alerting/index.md)

## C

- **Cache** — A fast store (usually in memory) holding copies of data that is expensive to fetch or compute. → [Catalog › Cache](../components/storage/index.md#cache)
- **Cache-aside** — The application reads the cache first and, on a miss, reads the database and fills the cache; on writes it updates the database and deletes the key. → [Caching › Patterns](../../classes/caching/patterns/index.md)
- **Cache stampede** — Many concurrent misses for the same hot key hitting the backend at once, typically when the key expires; also called thundering herd. → [Caching › Failure modes](../../classes/caching/failure-modes/index.md)
- **Canary release** — Sending a small share of traffic to a new version and comparing its metrics with the old one before rolling out further. → [Cloud-native › Delivery](../../classes/cloud-native/delivery/index.md)
- **Capacity planning** — Estimating the resources needed to meet expected load with headroom, and when to add more, from measurements and growth forecasts. → [Performance › Capacity planning](../../classes/performance/capacity-planning/index.md)
- **CAP theorem** — During a network partition, a replicated system must choose between consistency (refuse or delay) and availability (answer, possibly stale). → [Distributed systems › CAP & PACELC](../../classes/distributed/cap-pacelc/index.md)
- **Cardinality (metrics)** — The number of distinct time series produced by a metric's label combinations; high-cardinality labels such as user ids explode cost. → [Catalog › Metrics](../components/observability/index.md#metrics)
- **CDC (change data capture)** — Streaming the changes committed to a database (from its log) to other systems such as Kafka, a cache or a data warehouse. → [Messaging › Patterns](../../classes/messaging/patterns/index.md)
- **CDN (content delivery network)** — A global network of edge caches that serves content from locations close to users. → [Catalog › CDN](../components/edge/index.md#cdn)
- **Chaos engineering** — Running controlled experiments that inject failures (latency, crashes, zone outages) to find weaknesses before real incidents do. → [Reliability › Chaos engineering](../../classes/reliability/chaos/index.md)
- **Circuit breaker** — A wrapper around calls to a dependency that stops calling it (fails fast) after too many errors, and probes it again after a pause. → [Reliability › Patterns](../../classes/reliability/patterns/index.md)
- **Cold start** — The extra latency of the first request to a new instance (function, container, JVM) while it initializes. → [Catalog › Serverless](../components/compute/index.md#serverless)
- **Consensus** — Getting a group of nodes to agree on a value or an ordered log despite failures, as long as a majority is up (Raft, Paxos). → [Distributed systems › Consensus](../../classes/distributed/consensus/index.md)
- **Consistent hashing** — Placing nodes and keys on a hash ring so that adding or removing a node moves only about 1/N of the keys. → [Edge › Load balancing](../../classes/edge/load-balancing/index.md)
- **Consumer group** — A set of consumers sharing a Kafka topic: each partition is read by exactly one member, so parallelism is at most the partition count. → [Catalog › Kafka](../components/messaging/index.md#kafka)
- **Container** — A process packaged with its dependencies in an image and isolated by the operating system (namespaces, cgroups). → [Cloud-native › Containers](../../classes/cloud-native/containers/index.md)
- **Coordinated omission** — A load-testing error where a slow system makes the client send fewer requests, hiding the latency real users would see. → [Performance › Load testing](../../classes/performance/load-testing/index.md)
- **CQRS** — Command Query Responsibility Segregation: separate models (and often stores) for writes and for reads, kept in sync by events. → [Messaging › Patterns](../../classes/messaging/patterns/index.md)
- **Cron** — A schedule expression (and the classic Unix tool) for running jobs at fixed times or intervals. → [Catalog › Scheduler](../components/compute/index.md#scheduler)

## D

- **Data warehouse** — A columnar database for analytics over large history (OLAP), fed from operational systems by ETL/ELT or CDC. → [Catalog › Data Warehouse](../components/storage/index.md#dwh)
- **Dead-letter queue (DLQ)** — A queue where messages that keep failing are parked after N attempts so they do not block the rest. → [Catalog › Message Queue](../components/messaging/index.md#queue)
- **Denormalization** — Storing redundant copies of data to make reads cheaper, at the cost of more complex writes and possible inconsistency. → [Databases › Data models](../../classes/databases/models/index.md)
- **Disaster recovery (DR)** — The plan and mechanisms to restore service after a large failure (region loss, data corruption), measured by RPO and RTO. → [Reliability › Disaster recovery](../../classes/reliability/disaster-recovery/index.md)
- **Distributed lock** — A lock shared by several processes or machines, usually with a lease (expiry) and a fencing token to stay safe when holders pause. → [Compute › Async work](../../classes/compute/async-work/index.md)
- **DNS (Domain Name System)** — The internet's directory that translates names into IP addresses, with cached answers controlled by TTLs. → [Catalog › DNS](../components/edge/index.md#dns)
- **Durability** — The guarantee that committed data is not lost, typically by writing to disk and replicating to other machines or zones. → [Intro › Requirements](../../classes/intro/requirements/index.md)

## E

- **Edge computing** — Running code at CDN locations close to users, for redirects, authentication checks, personalization or A/B tests. → [Edge › DNS & CDN](../../classes/edge/dns-cdn/index.md)
- **Embedding** — A vector of numbers representing the meaning of a text, image or item, so that similar things have nearby vectors. → [Catalog › Vector DB](../components/storage/index.md#vectordb)
- **Error budget** — The amount of unreliability an SLO allows (100% − SLO), spent on releases and experiments; when it runs out, reliability work comes first. → [Observability › SLOs](../../classes/observability/slo/index.md)
- **ETL / ELT** — Extract-Transform-Load (transform before loading) or Extract-Load-Transform (load raw data, transform inside the warehouse). → [Databases › Specialized stores](../../classes/databases/specialized/index.md)
- **Event-driven architecture** — Services communicate by publishing and reacting to events instead of calling each other directly, which decouples them in time. → [Messaging](../../classes/messaging/index.md)
- **Event sourcing** — Storing the sequence of events that changed an entity as the source of truth, and deriving the current state by replaying them. → [Messaging › Patterns](../../classes/messaging/patterns/index.md)
- **Eventual consistency** — If writes stop, all replicas eventually converge to the same value; until then, reads may return stale data. → [Distributed systems › Consistency](../../classes/distributed/consistency/index.md)
- **Exactly-once** — Each message affects the result exactly once; in practice achieved as at-least-once delivery plus idempotent processing or transactions. → [Messaging › Delivery semantics](../../classes/messaging/semantics/index.md)

## F

- **Failover** — Switching traffic or the leader role to a standby when the primary fails, automatically or manually. → [Reliability › Disaster recovery](../../classes/reliability/disaster-recovery/index.md)
- **Fallback** — An alternative answer when a dependency fails: cached data, a default, a degraded feature or a "try again later". → [Reliability › Patterns](../../classes/reliability/patterns/index.md)
- **Fan-out (on write / on read)** — Delivering one item to many recipients: precompute each follower's feed when posting (on write) or assemble it when reading (on read). → [Case study: news feed](../../classes/case-studies/news-feed/index.md)
- **Feature flag** — A runtime switch that turns code paths on or off for some users without a deploy; decouples release from deployment. → [Cloud-native › Delivery](../../classes/cloud-native/delivery/index.md)
- **FinOps** — The practice of making cloud cost visible and owned by engineering teams, and optimizing it alongside performance and reliability. → [Cloud-native › FinOps](../../classes/cloud-native/finops/index.md)
- **Flame graph** — A visualization of sampled stack traces where width shows time spent; the fastest way to see where CPU goes. → [Performance › Bottlenecks](../../classes/performance/bottlenecks/index.md)
- **Functional requirement** — What the system must do (buy a ticket, search events), as opposed to how well it must do it. → [Intro › Requirements](../../classes/intro/requirements/index.md)

## G

- **Geohash** — An encoding of latitude and longitude into a string whose shared prefixes mean nearby areas; used to index locations. → [Case study: ride sharing](../../classes/case-studies/ride-sharing/index.md)
- **GitOps** — Declaring the desired state of infrastructure and applications in Git and letting an agent (e.g. Argo CD) reconcile the cluster to it. → [Cloud-native › Delivery](../../classes/cloud-native/delivery/index.md)
- **Golden signals** — Google SRE's four signals for a service: latency, traffic, errors and saturation. → [Observability › Signals](../../classes/observability/signals/index.md)
- **Gossip protocol** — Nodes periodically exchange state with random peers so information (membership, failures) spreads through the cluster without a coordinator. → [Distributed systems](../../classes/distributed/index.md)
- **GraphQL** — An API query language where the client asks for exactly the fields it needs from a typed schema, in one request. → [Compute › API styles](../../classes/compute/api-styles/index.md)
- **gRPC** — A high-performance RPC framework over HTTP/2 with Protocol Buffers schemas and streaming; common between services. → [Compute › API styles](../../classes/compute/api-styles/index.md)
- **Guardrails (LLM)** — Checks around a model on inputs, outputs and tool calls: prompt injection, personal data, policy, schema validation. → [Catalog › Safety Mesh](../components/ai/index.md#safety)

## H

- **Head-of-line blocking** — When one slow item at the front of a queue or connection delays everything behind it; HTTP/2 fixed it per request, HTTP/3 per packet. → [Edge › Protocols](../../classes/edge/protocols/index.md)
- **Health check** — A probe (liveness, readiness, startup) that tells load balancers and orchestrators whether an instance can serve or should be restarted. → [Catalog › Health Check](../components/observability/index.md#healthcheck)
- **Hit ratio** — The fraction of cache lookups served from the cache; the backend sees requests × (1 − hit ratio). → [Caching › Patterns](../../classes/caching/patterns/index.md)
- **HNSW** — Hierarchical Navigable Small World: a graph-based index for approximate nearest-neighbor search over vectors. → [Catalog › Vector DB](../components/storage/index.md#vectordb)
- **Horizontal scaling** — Adding more machines behind a load balancer (scale out), which requires stateless services and shared state elsewhere. → [Intro › Scaling journey](../../classes/intro/scaling-journey/index.md)
- **Hot key / hot partition** — A key or partition receiving a disproportionate share of traffic (a celebrity, a flash-sale event), saturating one node while others idle. → [Databases › Partitioning](../../classes/databases/partitioning/index.md)
- **HPA (Horizontal Pod Autoscaler)** — The Kubernetes controller that changes a Deployment's replica count to keep a metric (e.g. CPU at 60%) near its target. → [Cloud-native › Kubernetes](../../classes/cloud-native/kubernetes/index.md)
- **HTTP/2 and HTTP/3 (QUIC)** — HTTP/2 multiplexes many requests over one TCP connection; HTTP/3 runs over QUIC (UDP) to avoid TCP head-of-line blocking and speed up handshakes. → [Edge › Protocols](../../classes/edge/protocols/index.md)

## I

- **IaC (infrastructure as code)** — Defining infrastructure in versioned files (Terraform, OpenTofu) applied by tools, instead of manual clicks. → [Cloud-native › Delivery](../../classes/cloud-native/delivery/index.md)
- **Idempotency** — Doing an operation twice has the same effect as doing it once; it makes retries safe. → [Distributed systems](../../classes/distributed/index.md)
- **Idempotency key** — A unique id sent by the client with a request; the server stores the first result and returns it for repeats instead of acting again. → [Compute › Integrations](../../classes/compute/integrations/index.md)
- **Index** — An auxiliary data structure that speeds up reads on some columns at the cost of slower writes and more storage. → [Databases › Data models](../../classes/databases/models/index.md)
- **Ingress** — The Kubernetes resource (and controller) that routes external HTTP traffic to services; the Gateway API is its successor. → [Catalog › Ingress](../components/edge/index.md#ingress)
- **Inverted index** — A map from each term to the documents containing it; the core of full-text search engines. → [Catalog › Search](../components/compute/index.md#search)
- **Isolation level** — How much concurrent transactions can see of each other: read committed, repeatable read / snapshot, serializable. → [Databases › Transactions](../../classes/databases/transactions/index.md)

## J

- **Jitter** — Randomness added to retry delays or timers so that many clients do not act in sync and overload a service together. → [Reliability › Patterns](../../classes/reliability/patterns/index.md)
- **JWT (JSON Web Token)** — A signed token carrying claims (user, scopes, expiry) that services can verify locally without calling the issuer. → [Network & security › Identity](../../classes/edge/identity/index.md)

## K

- **Kafka** — A distributed, partitioned, replicated event log where consumers read at their own offsets and can replay history. → [Catalog › Kafka](../components/messaging/index.md#kafka)
- **Key-value store** — A database that maps keys to opaque values with very fast get/put by key and little else (Redis, DynamoDB). → [Catalog › NoSQL DB](../components/storage/index.md#nosql)
- **Knee (of the latency curve)** — The utilization (often around 70–80%) beyond which queueing makes latency grow sharply. → [Estimation › Queueing](../../classes/estimation/queueing/index.md)
- **Kubernetes** — A container orchestrator that schedules pods on nodes, keeps the desired number running, and provides services, probes and autoscaling. → [Cloud-native › Kubernetes](../../classes/cloud-native/kubernetes/index.md)

## L

- **L4 / L7 load balancing** — L4 balances TCP/UDP connections by address and port; L7 understands HTTP and routes by path, header or cookie. → [Catalog › Load Balancer](../components/edge/index.md#lb)
- **Latency** — The time to serve one request, best described by percentiles (p50, p99) rather than the average. → [Estimation › Numbers](../../classes/estimation/numbers/index.md)
- **Leader election** — Choosing one node among many to coordinate (accept writes, run a job), with a new election when it fails. → [Distributed systems › Consensus](../../classes/distributed/consensus/index.md)
- **Leader-follower replication** — One leader accepts writes and streams them to followers that serve reads and can take over on failure. → [Databases › Replication](../../classes/databases/replication/index.md)
- **Leaky bucket** — A rate-limiting algorithm that queues requests and lets them out at a constant rate, smoothing bursts. → [Edge › API gateway](../../classes/edge/api-gateway/index.md)
- **Linearizability** — The strongest single-object consistency: every operation appears to take effect atomically at one instant, as if there were one copy. → [Distributed systems › Consistency](../../classes/distributed/consistency/index.md)
- **Little's Law** — L = λ × W: the average number of items in a system equals the arrival rate times the average time each spends in it. → [Estimation › Queueing](../../classes/estimation/queueing/index.md)
- **LLM gateway** — A proxy in front of model providers for routing, fallbacks, quotas, caching and token/cost metrics. → [Catalog › LLM Gateway](../components/ai/index.md#llmgw)
- **Load balancer** — A component that spreads requests across healthy replicas using an algorithm such as round robin or least connections. → [Catalog › Load Balancer](../components/edge/index.md#lb)
- **Load shedding** — Deliberately rejecting some requests (with 429/503) when overloaded so the rest are served within their deadlines. → [Reliability › Patterns](../../classes/reliability/patterns/index.md)
- **Load test** — Generating realistic traffic against a system to measure throughput and latency; types include smoke, load, stress, spike, soak and breakpoint. → [Performance › Load testing](../../classes/performance/load-testing/index.md)
- **Logical clock** — A counter-based clock (Lamport, vector) that orders events by causality instead of wall time. → [Distributed systems › Time & clocks](../../classes/distributed/time-clocks/index.md)
- **Logs** — Timestamped records of discrete events, ideally structured (JSON) and correlated by trace id. → [Catalog › Logs](../components/observability/index.md#logs)
- **LRU / LFU** — Cache eviction policies: evict the least recently used item, or the least frequently used one. → [Caching › Redis](../../classes/caching/redis/index.md)
- **LSM-tree** — Log-Structured Merge tree: writes go to memory and are flushed to sorted files that are later compacted; very fast writes. → [Databases › Data models](../../classes/databases/models/index.md)

## M

- **MCP (Model Context Protocol)** — An open protocol through which applications expose tools, resources and prompts to LLM clients in a standard way. → [Catalog › Tool Registry](../components/ai/index.md#toolreg)
- **Message queue** — A buffer where producers put messages and competing consumers take them, each message processed by one consumer. → [Catalog › Message Queue](../components/messaging/index.md#queue)
- **Metrics** — Numeric time series aggregated over time (counters, gauges, histograms); cheap to store, the basis of dashboards and alerts. → [Catalog › Metrics](../components/observability/index.md#metrics)
- **Microservices** — An architecture of small services owned by teams and deployed independently, communicating over the network. → [Compute › Services](../../classes/compute/services/index.md)
- **Modular monolith** — One deployable application split internally into well-separated modules with clear boundaries; often the best starting point. → [Compute › Services](../../classes/compute/services/index.md)
- **mTLS (mutual TLS)** — TLS in which both client and server present certificates, so each side authenticates the other; standard inside service meshes. → [Catalog › Service Mesh](../components/network/index.md#mesh)
- **MTTR / MTBF** — Mean time to repair (recover) and mean time between failures; availability ≈ MTBF / (MTBF + MTTR). → [Reliability](../../classes/reliability/index.md)
- **Multi-leader replication** — Several nodes accept writes and replicate to each other, which requires resolving conflicting writes. → [Databases › Replication](../../classes/databases/replication/index.md)
- **Multi-region** — Running a system in more than one geographic region for lower latency to distant users and survival of a region outage. → [Reliability › Disaster recovery](../../classes/reliability/disaster-recovery/index.md)

## N

- **N+1 query** — Code that runs one query for a list and then one more per item, turning one page into hundreds of database round trips. → [Performance › Bottlenecks](../../classes/performance/bottlenecks/index.md)
- **NAT gateway** — Lets machines in private subnets open outbound connections to the internet without being reachable from it. → [Catalog › NAT Gateway](../components/network/index.md#nat)
- **Network partition** — A failure where parts of a system cannot communicate with each other although each part is still running. → [Distributed systems › CAP & PACELC](../../classes/distributed/cap-pacelc/index.md)
- **NewSQL** — Distributed databases that keep SQL and transactions while scaling horizontally (Spanner, CockroachDB, YugabyteDB). → [Databases › Data models](../../classes/databases/models/index.md)
- **Non-functional requirement** — How well the system must work: latency, availability, consistency, durability, scale, cost, security, operability. → [Intro › Requirements](../../classes/intro/requirements/index.md)
- **NoSQL** — Non-relational databases (key-value, document, wide-column, graph) that trade some relational features for scale or flexibility. → [Catalog › NoSQL DB](../components/storage/index.md#nosql)

## O

- **OAuth 2 / OIDC** — OAuth 2 delegates authorization with access tokens; OpenID Connect adds authentication (who the user is) on top of it. → [Network & security › Identity](../../classes/edge/identity/index.md)
- **Object storage** — Storage of immutable blobs by key over HTTP (S3 and similar), cheap and extremely durable; the origin for media. → [Catalog › Object Store](../components/storage/index.md#objstore)
- **Observability** — The ability to understand a system's internal state from the signals it emits: metrics, logs, traces and profiles. → [Observability](../../classes/observability/index.md)
- **OLTP / OLAP** — Online transaction processing (many small reads and writes on current data) vs online analytical processing (large scans and aggregates over history). → [Databases › Specialized stores](../../classes/databases/specialized/index.md)
- **OpenTelemetry** — The vendor-neutral standard (APIs, SDKs, Collector, OTLP protocol) for producing and exporting metrics, logs and traces. → [Observability › OpenTelemetry](../../classes/observability/opentelemetry/index.md)
- **Open vs closed workload model** — Open: requests arrive at a rate regardless of responses (real users); closed: a fixed number of users wait for each response before the next. → [Performance › Load testing](../../classes/performance/load-testing/index.md)
- **Optimistic locking** — Detecting conflicting updates at write time with a version column (UPDATE … WHERE version = ?) instead of locking in advance. → [Databases › Transactions](../../classes/databases/transactions/index.md)
- **Orchestrator (agent)** — The component that runs an AI agent's loop: calls the model, executes the tools it chooses, and repeats until done. → [Catalog › Orchestrator](../components/ai/index.md#orchestrator)
- **Outbox (transactional)** — Writing an event into an outbox table in the same transaction as the business change, then relaying it to the broker; avoids dual writes. → [Messaging › Patterns](../../classes/messaging/patterns/index.md)

## P

- **p50 / p99 (percentiles)** — The latency below which 50% or 99% of requests complete; p99 describes the tail that users feel. → [Estimation › Percentiles](../../classes/estimation/percentiles/index.md)
- **PACELC** — Extends CAP: if there is a Partition choose Availability or Consistency; Else choose Latency or Consistency. → [Distributed systems › CAP & PACELC](../../classes/distributed/cap-pacelc/index.md)
- **Partitioning (sharding)** — Splitting data across nodes by a key (hash or range) so that each node holds and serves only part of it. → [Databases › Partitioning](../../classes/databases/partitioning/index.md)
- **Partition (Kafka)** — An ordered, append-only shard of a topic; ordering holds only within a partition, and it is the unit of consumer parallelism. → [Catalog › Kafka](../components/messaging/index.md#kafka)
- **Pessimistic locking** — Locking rows before changing them (SELECT … FOR UPDATE) so concurrent transactions wait; safe under contention, but holds locks. → [Databases › Transactions](../../classes/databases/transactions/index.md)
- **Pod** — The smallest deployable unit in Kubernetes: one or more containers sharing a network address and volumes. → [Cloud-native › Kubernetes](../../classes/cloud-native/kubernetes/index.md)
- **Prompt injection** — Untrusted text (a web page, an email, a review) carrying instructions that an LLM follows against its intended behavior. → [Catalog › Safety Mesh](../components/ai/index.md#safety)
- **Pub/Sub** — Publish/subscribe: each message published to a topic is delivered to every subscriber. → [Catalog › Pub/Sub](../components/messaging/index.md#pubsub)

## Q

- **QPS (queries per second)** — Requests or queries per second, the basic unit of load; average QPS ≈ requests per day ÷ 10^5. → [Estimation › Numbers](../../classes/estimation/numbers/index.md)
- **Queueing theory** — The mathematics of waiting lines; explains why latency explodes as utilization approaches 100%. → [Estimation › Queueing](../../classes/estimation/queueing/index.md)
- **Quorum** — The minimum number of replicas that must take part in a read or write; with R + W > N, reads overlap the latest write. → [Distributed systems › Consensus](../../classes/distributed/consensus/index.md)

## R

- **Raft** — A consensus algorithm designed to be understandable: a leader replicates a log to followers and commits entries once a majority has them. → [Distributed systems › Consensus](../../classes/distributed/consensus/index.md)
- **RAG (retrieval-augmented generation)** — Retrieving relevant chunks of your data (usually by vector search) and putting them in the prompt so the model answers from them. → [Catalog › Memory Fabric](../components/ai/index.md#memory)
- **Rate limiting** — Capping how many requests a client may make per time window, answering 429 Too Many Requests beyond it. → [Case study: rate limiter](../../classes/case-studies/rate-limiter/index.md)
- **Read replica** — A follower copy of a database used to serve reads; adds read capacity but may lag behind the leader. → [Databases › Replication](../../classes/databases/replication/index.md)
- **Read-your-writes** — A consistency guarantee that a user always sees their own latest writes, even if other users may see stale data. → [Distributed systems › Consistency](../../classes/distributed/consistency/index.md)
- **Redis** — An in-memory data-structure server (strings, hashes, lists, sorted sets, streams) used as cache, rate limiter, queue and more. → [Caching › Redis](../../classes/caching/redis/index.md)
- **RED method** — Monitoring every service by Rate, Errors and Duration. → [Observability › Signals](../../classes/observability/signals/index.md)
- **Region** — A geographic area of a cloud provider containing several availability zones (e.g. São Paulo, Virginia). → [Reliability › Disaster recovery](../../classes/reliability/disaster-recovery/index.md)
- **Replication lag** — The delay between a write on the leader and its appearance on a follower; causes stale reads. → [Databases › Replication](../../classes/databases/replication/index.md)
- **Resharding** — Moving data between partitions when nodes are added or keys are redistributed, ideally online and gradually. → [Databases › Partitioning](../../classes/databases/partitioning/index.md)
- **REST** — An API style built on HTTP resources, verbs and status codes; simple, cacheable and the default for public APIs. → [Compute › API styles](../../classes/compute/api-styles/index.md)
- **Retry** — Repeating a failed request in the hope that the failure was transient; safe only for idempotent operations, with backoff and a limit. → [Reliability › Patterns](../../classes/reliability/patterns/index.md)
- **Retry storm** — Retries from many clients multiplying the load on a struggling service and turning a blip into an outage. → [Reliability › Patterns](../../classes/reliability/patterns/index.md)
- **Reverse proxy** — A server in front of backends that receives client requests and forwards them, often terminating TLS and caching (Nginx, Envoy). → [Catalog › Load Balancer](../components/edge/index.md#lb)
- **RPO / RTO** — Recovery point objective (how much data you may lose) and recovery time objective (how long until service is back). → [Reliability › Disaster recovery](../../classes/reliability/disaster-recovery/index.md)

## S

- **Saga** — A distributed transaction split into local steps, each with a compensating action that undoes it if a later step fails. → [Messaging › Patterns](../../classes/messaging/patterns/index.md)
- **SBOM (software bill of materials)** — An inventory of every component and version inside a software artifact, used to track vulnerabilities and licenses. → [Network & security › Zero trust](../../classes/network-security/zero-trust/index.md)
- **Scheduler** — A component that triggers jobs at given times or intervals, ensuring each run happens once even with several replicas. → [Catalog › Scheduler](../components/compute/index.md#scheduler)
- **Secrets management** — Storing credentials and keys in a dedicated, audited system (vault) and injecting them at runtime, never in code or images. → [Network & security › Zero trust](../../classes/network-security/zero-trust/index.md)
- **Semantic cache** — A cache for LLM answers keyed by the meaning of the question (embedding similarity) rather than its exact text. → [Catalog › LLM Gateway](../components/ai/index.md#llmgw)
- **Serverless (FaaS)** — Running functions on demand without managing servers, billed per invocation and duration, scaling to zero. → [Catalog › Serverless](../components/compute/index.md#serverless)
- **Service discovery** — How a service finds the current addresses of another (DNS, a registry, Kubernetes Services). → [Cloud-native › Kubernetes](../../classes/cloud-native/kubernetes/index.md)
- **Service mesh** — A layer of proxies beside every service providing mTLS, retries, timeouts, traffic splitting and telemetry without code changes. → [Catalog › Service Mesh](../components/network/index.md#mesh)
- **Single point of failure (SPOF)** — A component whose failure stops the whole system; removed by redundancy. → [Estimation › Availability math](../../classes/estimation/availability-math/index.md)
- **SLI / SLO / SLA** — Indicator (what you measure), objective (the target, e.g. 99.9% over 28 days) and agreement (a contract with penalties). → [Observability › SLOs](../../classes/observability/slo/index.md)
- **Snapshot isolation** — Each transaction reads from a consistent snapshot of the database; prevents most anomalies but allows write skew. → [Databases › Transactions](../../classes/databases/transactions/index.md)
- **Soak / spike / stress test** — Load tests that hold load for hours (soak), jump suddenly (spike) or increase until the system breaks (stress). → [Performance › Load testing](../../classes/performance/load-testing/index.md)
- **SSE (Server-Sent Events)** — A one-way stream of events from server to client over a long-lived HTTP response; used for live updates and LLM tokens. → [Edge › Protocols](../../classes/edge/protocols/index.md)
- **Stateless service** — A service that keeps no client state between requests, so any replica can serve any request. → [Catalog › App Server](../components/compute/index.md#app)
- **Sticky session** — Routing all requests of a client to the same backend; simplifies in-memory sessions but hurts balance and failover. → [Catalog › Load Balancer](../components/edge/index.md#lb)
- **Strong consistency** — Reads always reflect the latest committed write (linearizability or serializability), at a cost in latency or availability. → [Distributed systems › Consistency](../../classes/distributed/consistency/index.md)
- **Subnet** — A range of addresses inside a VPC in one availability zone; public or private depending on its route table. → [Catalog › Subnet](../components/network/index.md#subnet)

## T

- **Tail latency** — The slowest requests (p99, p999); amplified when a request fans out to many services. → [Estimation › Percentiles](../../classes/estimation/percentiles/index.md)
- **Throughput** — The amount of work completed per unit of time (requests per second, MB per second). → [Estimation › Numbers](../../classes/estimation/numbers/index.md)
- **Thundering herd** — Many clients or threads waking up and hitting the same resource at once (after an expiry, a restart, a lock release). → [Caching › Failure modes](../../classes/caching/failure-modes/index.md)
- **Timeout** — A deadline on a call after which the caller gives up; the first defense against slow dependencies. → [Reliability › Patterns](../../classes/reliability/patterns/index.md)
- **Token bucket** — A rate-limiting algorithm: tokens refill at a steady rate up to a burst capacity, and each request spends one. → [Edge › API gateway](../../classes/edge/api-gateway/index.md)
- **Token (LLM)** — The unit of text a language model reads and writes (roughly ¾ of an English word); models are priced and limited in tokens. → [AI systems › LLM gateway](../../classes/ai-systems/llm-gateway/index.md)
- **Tool calling** — An LLM returning a structured request to call a function (with JSON arguments) that the application executes. → [Catalog › Tool Registry](../components/ai/index.md#toolreg)
- **Tracing (distributed)** — Following one request across services as a tree of timed spans sharing a trace id. → [Catalog › Tracing](../components/observability/index.md#tracing)
- **TTFT (time to first token)** — The delay before an LLM starts streaming its answer; dominates perceived latency in chat interfaces. → [AI systems › LLM gateway](../../classes/ai-systems/llm-gateway/index.md)
- **TTL (time to live)** — How long a cached item or DNS answer stays valid before it must be fetched again. → [Caching › Invalidation](../../classes/caching/invalidation/index.md)
- **Two-phase commit (2PC)** — A protocol that commits a transaction across several participants atomically via a coordinator; blocks if the coordinator fails. → [Messaging › Patterns](../../classes/messaging/patterns/index.md)

## U

- **Universal Scalability Law** — Extends Amdahl with a coherence cost: beyond some point, adding nodes reduces throughput. → [Estimation](../../classes/estimation/index.md)
- **USE method** — Checking every resource for Utilization, Saturation and Errors to find bottlenecks. → [Observability › Signals](../../classes/observability/signals/index.md)
- **Utilization** — The fraction of time a resource is busy (ρ = arrival rate ÷ capacity); latency grows sharply as it approaches 1. → [Estimation › Queueing](../../classes/estimation/queueing/index.md)

## V

- **Vector clock** — A vector of counters, one per node, that detects whether two events are causally ordered or concurrent. → [Distributed systems › Time & clocks](../../classes/distributed/time-clocks/index.md)
- **Vector database** — A store optimized for similarity search over embeddings, with ANN indexes and metadata filters. → [Catalog › Vector DB](../components/storage/index.md#vectordb)
- **Vertical scaling** — Moving to a bigger machine (scale up): simple, but with a ceiling and a single point of failure. → [Intro › Scaling journey](../../classes/intro/scaling-journey/index.md)
- **Virtual nodes** — Many positions per physical node on a consistent-hashing ring, to spread load evenly and rebalance smoothly. → [Edge › Load balancing](../../classes/edge/load-balancing/index.md)
- **VPC (virtual private cloud)** — An isolated private network in a cloud region, where you define subnets, routes and firewall rules. → [Catalog › VPC](../components/network/index.md#vpc)
- **VPN** — An encrypted tunnel joining two networks (or a laptop and a network) over the internet. → [Catalog › VPN](../components/network/index.md#vpn)

## W

- **WAF (web application firewall)** — A filter for HTTP traffic that blocks attacks (injection, bad bots, abusive patterns) before they reach the application. → [Catalog › WAF](../components/edge/index.md#waf)
- **Waiting room (virtual queue)** — A queue in front of a high-demand flow that admits users at the rate the system can sustain, turning a spike into a steady flow. → [Case study: ticketing](../../classes/case-studies/ticketing/index.md)
- **Webhook** — An HTTP callback: a provider calls your endpoint when something happens (payment confirmed); must be verified and processed idempotently. → [Compute › Integrations](../../classes/compute/integrations/index.md)
- **WebSocket** — A full-duplex, long-lived connection between browser and server, used for chat, live updates and games. → [Edge › Protocols](../../classes/edge/protocols/index.md)
- **Worker** — A process that takes jobs from a queue and executes them in the background, scaled by backlog. → [Catalog › Worker](../components/compute/index.md#worker)
- **Write-ahead log (WAL)** — A log where a database records every change before applying it, used for crash recovery and replication. → [Databases › Replication](../../classes/databases/replication/index.md)
- **Write skew** — An anomaly where two transactions read overlapping data and make disjoint writes that together break an invariant; prevented by serializable isolation. → [Databases › Transactions](../../classes/databases/transactions/index.md)
- **Write-through / write-behind** — Cache write policies: write to cache and database together (through), or to the cache first and flush later (behind). → [Caching › Patterns](../../classes/caching/patterns/index.md)

## Z

- **Zero trust** — A security model in which no network location is trusted: every request is authenticated, authorized and encrypted. → [Network & security › Zero trust](../../classes/network-security/zero-trust/index.md)
- **Zipf distribution** — A popularity distribution where a few items get most of the traffic; why caches work and why hot keys happen. → [Caching › Failure modes](../../classes/caching/failure-modes/index.md)
