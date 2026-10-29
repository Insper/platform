# Reading list

The books, papers, blogs and courses behind this course. You don't need to read them all: each item has one line on **why** it is worth your time and the **class** it supports, so you can pick what fits the topic you are studying. Start with the first five.

## Start here: the first five

1. **Designing Data-Intensive Applications** (Kleppmann & Riccomini) — chapters on replication, partitioning, transactions and consistency. The foundation for classes 3, 6 and 8.
2. **System Design Interview, vol. 1** (Alex Xu) — read one chapter per week alongside the [case studies](../../classes/case-studies/index.md) to see the interview format end to end.
3. **"The Tail at Scale"** (Dean & Barroso, 2013) — six pages that explain why p99 matters more than the average. Read it with [Class 2 · Percentiles](../../classes/estimation/percentiles/index.md).
4. **Site Reliability Engineering**, chapters on SLOs, monitoring and handling overload (free online) — the "running it in production" half of system design.
5. **The Amazon Builders' Library** articles on timeouts, retries, backoff and jitter — short, practical, and exactly what [Class 10](../../classes/reliability/patterns/index.md) and [Hands-on 9](../../hands-on/9/index.md) put into code.

## Books

| Book | Authors | Why read it | Supports |
|---|---|---|---|
| [Designing Data-Intensive Applications](https://dataintensive.net/), 2nd ed. | Martin Kleppmann, Chris Riccomini | The clearest explanation of replication, partitioning, transactions, consistency and streams, from first principles | [3](../../classes/distributed/index.md), [6](../../classes/databases/index.md), [8](../../classes/messaging/index.md) |
| [System Design Interview](https://bytebytego.com/), vol. 1 and vol. 2 | Alex Xu (vol. 2 with Sahn Lam) | Classic interview problems worked step by step, with estimates and diagrams | [1](../../classes/intro/index.md), [15](../../classes/case-studies/index.md) |
| [Site Reliability Engineering](https://sre.google/books/) and The Site Reliability Workbook | Google (Beyer, Jones, Petoff, Murphy, eds.) | SLOs, error budgets, alerting, overload and incident response as practiced at Google; free online | [9](../../classes/reliability/index.md), [10](../../classes/observability/index.md) |
| Release It!, 2nd ed. | Michael T. Nygard | Stability patterns (timeouts, circuit breakers, bulkheads) and anti-patterns, told through real outages | [9](../../classes/reliability/index.md) |
| Building Microservices, 2nd ed. | Sam Newman | When to split a monolith, service boundaries, communication styles, and the costs of microservices | [5](../../classes/compute/index.md) |
| Fundamentals of Software Architecture | Mark Richards, Neal Ford | Architecture characteristics ("-ilities"), styles and how to reason about trade-offs | [1](../../classes/intro/index.md), [5](../../classes/compute/index.md) |
| Software Architecture: The Hard Parts | Neal Ford, Mark Richards, Pramod Sadalage, Zhamak Dehghani | Decomposing services and data, distributed transactions and sagas, framed as trade-off analysis | [5](../../classes/compute/index.md), [8](../../classes/messaging/index.md) |
| [Understanding Distributed Systems](https://understandingdistributed.systems/) | Roberto Vitillo | A short, approachable tour of communication, coordination, scalability and resiliency | [3](../../classes/distributed/index.md), [4](../../classes/edge/index.md) |
| Database Internals | Alex Petrov | How storage engines (B-trees, LSM-trees) and distributed databases work inside | [6](../../classes/databases/index.md) |
| [Systems Performance](https://www.brendangregg.com/), 2nd ed. | Brendan Gregg | Performance methodology (USE method), observability tools and profiling on Linux | [14](../../classes/performance/index.md) |
| Observability Engineering | Charity Majors, Liz Fong-Jones, George Miranda | Why high-cardinality events and traces beat dashboards of averages; SLO-based alerting | [10](../../classes/observability/index.md) |
| Kubernetes: Up and Running | Brendan Burns, Joe Beda, Kelsey Hightower, Lachlan Evenson | The core Kubernetes objects explained by people who built it | [12](../../classes/cloud-native/index.md) |
| AI Engineering | Chip Huyen | Building applications on foundation models: evaluation, RAG, agents, latency and cost | [13](../../classes/ai-systems/index.md) |
| [Cracking the Coding Interview](https://www.crackingthecodinginterview.com/), 6th ed. | Gayle Laakmann McDowell | The interview process in general; its chapter on scalability inspired the "how to answer" principles | [Support › Interview](../../support/interview/index.md) |

## Classic papers

Papers are shorter than books and often clearer: they were written to convince skeptical experts. Read the abstract, the introduction and the figures first.

| Paper | Authors, venue, year | Why read it | Supports |
|---|---|---|---|
| Time, Clocks, and the Ordering of Events in a Distributed System | Leslie Lamport, Communications of the ACM, 1978 | Introduces happened-before and logical clocks: why "what happened first" is hard | [3 · Time & clocks](../../classes/distributed/time-clocks/index.md) |
| Paxos Made Simple | Leslie Lamport, ACM SIGACT News, 2001 | The consensus algorithm behind decades of systems, in a few pages | [3 · Consensus](../../classes/distributed/consensus/index.md) |
| Brewer's Conjecture and the Feasibility of Consistent, Available, Partition-Tolerant Web Services | Seth Gilbert, Nancy Lynch, ACM SIGACT News, 2002 | The formal proof of the CAP theorem that Eric Brewer conjectured in his PODC 2000 keynote | [3 · CAP & PACELC](../../classes/distributed/cap-pacelc/index.md) |
| The Google File System | Ghemawat, Gobioff, Leung, SOSP 2003 | Designing storage for commodity machines that fail all the time | [6](../../classes/databases/index.md) |
| MapReduce: Simplified Data Processing on Large Clusters | Jeffrey Dean, Sanjay Ghemawat, OSDI 2004 | The programming model that made batch processing at scale accessible | [6 · Specialized](../../classes/databases/specialized/index.md) |
| Bigtable: A Distributed Storage System for Structured Data | Chang et al., OSDI 2006 | The wide-column model behind HBase and Cassandra's data model | [6 · Models](../../classes/databases/models/index.md) |
| The Chubby Lock Service for Loosely-Coupled Distributed Systems | Mike Burrows, OSDI 2006 | Coarse-grained locks and leader election as a service | [5 · Async work](../../classes/compute/async-work/index.md) |
| Dynamo: Amazon's Highly Available Key-value Store | DeCandia et al., SOSP 2007 ([allthingsdistributed.com](https://www.allthingsdistributed.com/)) | Consistent hashing, quorums, hinted handoff and vector clocks in one production system | [3](../../classes/distributed/index.md), [6 · Partitioning](../../classes/databases/partitioning/index.md) |
| ZooKeeper: Wait-free Coordination for Internet-scale Systems | Hunt, Konar, Junqueira, Reed, USENIX ATC 2010 | A coordination service that many systems (including older Kafka) relied on | [3 · Consensus](../../classes/distributed/consensus/index.md) |
| Kafka: a Distributed Messaging System for Log Processing | Jay Kreps, Neha Narkhede, Jun Rao, NetDB 2011 | The original design of the log-based broker used throughout the course | [8 · Kafka](../../classes/messaging/kafka/index.md) |
| Spanner: Google's Globally-Distributed Database | Corbett et al., OSDI 2012 | Externally consistent transactions across the planet, using TrueTime | [6 · Replication](../../classes/databases/replication/index.md), [3](../../classes/distributed/index.md) |
| Consistency Tradeoffs in Modern Distributed Database System Design | Daniel Abadi, IEEE Computer, 2012 | Introduces PACELC: the latency vs consistency trade-off that exists even without partitions | [3 · CAP & PACELC](../../classes/distributed/cap-pacelc/index.md) |
| The Tail at Scale | Jeffrey Dean, Luiz André Barroso, Communications of the ACM, 2013 | Why tail latency dominates fan-out systems, and techniques such as hedged requests | [2 · Percentiles](../../classes/estimation/percentiles/index.md) |
| Scaling Memcache at Facebook | Nishtala et al., NSDI 2013 | Caching at enormous scale: leases against stampedes, regional pools, invalidation | [7](../../classes/caching/index.md) |
| TAO: Facebook's Distributed Data Store for the Social Graph | Bronson et al., USENIX ATC 2013 | A read-optimized graph cache in front of MySQL serving billions of reads per second | [7](../../classes/caching/index.md), [15](../../classes/case-studies/index.md) |
| In Search of an Understandable Consensus Algorithm (Raft) | Diego Ongaro, John Ousterhout, USENIX ATC 2014 ([raft.github.io](https://raft.github.io/)) | Consensus designed to be understood: leader election and log replication | [3 · Consensus](../../classes/distributed/consensus/index.md) |
| Large-scale Cluster Management at Google with Borg | Verma et al., EuroSys 2015 | The ancestor of Kubernetes: scheduling, bin packing, and lessons learned | [12 · Kubernetes](../../classes/cloud-native/kubernetes/index.md) |
| [Attention Is All You Need](https://arxiv.org/abs/1706.03762) | Vaswani et al., NeurIPS 2017 | The transformer architecture behind today's LLMs; read for context, not for the math | [13](../../classes/ai-systems/index.md) |
| [Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks](https://arxiv.org/abs/2005.11401) | Lewis et al., NeurIPS 2020 | The paper that named RAG: combining a retriever with a generator | [13 · RAG & memory](../../classes/ai-systems/rag-memory/index.md) |
| [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629) | Yao et al., ICLR 2023 | The reason-act-observe loop that most agent frameworks implement | [13 · Agents](../../classes/ai-systems/agents/index.md) |

## Engineering blogs

Real systems, real outages, real trade-offs. Search them for the topic of the week.

| Blog | Why read it | Supports |
|---|---|---|
| [The Amazon Builders' Library](https://aws.amazon.com/builders-library/) | How Amazon builds and operates services: timeouts and retries, load shedding, caching, deployments | [9](../../classes/reliability/index.md), [12](../../classes/cloud-native/index.md) |
| [AWS Architecture Blog](https://aws.amazon.com/blogs/architecture/) | Reference architectures and patterns on AWS | [12](../../classes/cloud-native/index.md) |
| [Google Cloud Architecture Center](https://cloud.google.com/architecture) | Reference architectures, including for AI and data systems | [12](../../classes/cloud-native/index.md), [13](../../classes/ai-systems/index.md) |
| [Netflix Tech Blog](https://netflixtechblog.com/) | Chaos engineering, resilience, video delivery and large-scale microservices | [9](../../classes/reliability/index.md), [15](../../classes/case-studies/index.md) |
| [Meta Engineering](https://engineering.fb.com/) | Caching, data infrastructure and reliability at the scale of billions of users | [6](../../classes/databases/index.md), [7](../../classes/caching/index.md) |
| [Uber Engineering](https://www.uber.com/blog/engineering/) | Geospatial indexing, real-time dispatch and large microservice architectures | [15](../../classes/case-studies/index.md) |
| [Discord Engineering](https://discord.com/blog) | Storing trillions of messages, real-time fan-out, database migrations told in detail | [6](../../classes/databases/index.md), [15](../../classes/case-studies/index.md) |
| [The Cloudflare Blog](https://blog.cloudflare.com/) | DNS, CDN, DDoS mitigation and honest post-mortems of global outages | [4](../../classes/edge/index.md), [10](../../classes/observability/index.md) |
| [Stripe Engineering](https://stripe.com/blog/engineering) | Idempotency, API design and reliability for payments | [5 · Integrations](../../classes/compute/integrations/index.md) |
| [Shopify Engineering](https://shopify.engineering/) | Surviving flash sales (Black Friday) on a modular monolith | [5](../../classes/compute/index.md), [14](../../classes/performance/index.md) |
| [Slack Engineering](https://slack.engineering/) | Real-time messaging infrastructure and incident write-ups | [8](../../classes/messaging/index.md), [10](../../classes/observability/index.md) |
| [Marc Brooker's blog](https://brooker.co.za/blog/) | Short, rigorous essays on retries, queues, tail latency and distributed systems | [2](../../classes/estimation/index.md), [9](../../classes/reliability/index.md) |
| [Martin Fowler](https://martinfowler.com/) | Patterns of distributed systems and enterprise architecture, microservices trade-offs | [5](../../classes/compute/index.md), [8](../../classes/messaging/index.md) |
| [Brendan Gregg](https://www.brendangregg.com/) | Performance methodology, flame graphs and Linux observability | [14](../../classes/performance/index.md) |
| [Jepsen](https://jepsen.io/) | Independent analyses of what distributed databases really guarantee under failure | [3 · Consistency](../../classes/distributed/consistency/index.md) |
| [High Scalability](https://highscalability.com/) | Long-running collection of architecture case studies | [15](../../classes/case-studies/index.md) |
| [ByteByteGo](https://blog.bytebytego.com/) | Visual, interview-oriented explanations of system design topics | [Support › Interview](../../support/interview/index.md) |

## Courses and free resources

| Resource | Why use it | Supports |
|---|---|---|
| [MIT 6.5840 Distributed Systems](https://pdos.csail.mit.edu/6.824/) | Lectures, paper readings and labs (Raft, a sharded key-value store) from one of the best distributed-systems courses | [3](../../classes/distributed/index.md) |
| [The System Design Primer](https://github.com/donnemartin/system-design-primer) | Free, organized study guide with topics, flashcards and worked problems | [Support › Interview](../../support/interview/index.md) |
| [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/) | Six pillars and concrete review questions to ask of any design | [1](../../classes/intro/index.md), [12](../../classes/cloud-native/index.md) |
| [Azure Architecture Center](https://learn.microsoft.com/azure/architecture/) | Cloud design patterns catalog (retry, circuit breaker, CQRS, saga…) with clear diagrams | [8](../../classes/messaging/index.md), [9](../../classes/reliability/index.md) |
| [Google SRE resources](https://sre.google/) | The SRE books plus articles on SLOs and incident response | [9](../../classes/reliability/index.md), [10](../../classes/observability/index.md) |
| [CNCF Landscape](https://landscape.cncf.io/) | Map of the cloud-native ecosystem: where each tool fits | [12](../../classes/cloud-native/index.md) |
| [OpenTelemetry documentation](https://opentelemetry.io/docs/) | Concepts and language guides for metrics, logs and traces | [10 · OpenTelemetry](../../classes/observability/opentelemetry/index.md) |
| [Kubernetes documentation](https://kubernetes.io/docs/) | The concepts section is an excellent free textbook | [12 · Kubernetes](../../classes/cloud-native/kubernetes/index.md) |
| [Latency numbers every programmer should know](https://gist.github.com/jboner/2841832) | The classic table behind every estimate | [2 · Numbers](../../classes/estimation/numbers/index.md), [Reference › Numbers](../numbers/index.md) |

!!! tip "How to read a paper in 30 minutes"
    Read the title, the abstract and the conclusion; look at every figure and table; then read the introduction and the design section. Skip the evaluation details on a first pass. Write three lines: the problem, the key idea, and the trade-off the authors accepted. That third line is the one you will use in an interview.
