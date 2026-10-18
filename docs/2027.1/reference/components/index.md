# Component catalog

Every box you can drop on the canvas of the [System Design Playground](../../../playground/index.md) has an entry in this catalog: **what it is**, **when to use it and when not to**, **key numbers**, **failure modes**, **how it behaves in the playground**, **real products** on AWS, GCP, Azure and in open source, and a one-liner you can say **in the interview**. The simulator's "learn more" links land on these entries.

The palette has 44 components in 9 categories. They follow a request from left to right: a **client** reaches the **edge**, the edge forwards to **compute**, compute reads and writes **storage** and publishes to **messaging**, everything is watched by **observability**, laid out inside a **network**, and some requests go to **AI** components or to **external** providers.

``` mermaid
flowchart LR
    CL[Client] --> ED[Traffic & Edge]
    ED --> CO[Compute]
    CO --> ST[Storage]
    CO --> MS[Messaging]
    MS --> CO
    CO --> AI[AI & Agents]
    CO --> EX[External]
    OB[Observability] -.watches.-> ED
    OB -.watches.-> CO
    OB -.watches.-> ST
    NW[Network: VPC, subnets, NAT, VPN, mesh] -.contains.-> CO
```

## Categories

| Category | What it answers | Components | Main classes |
|---|---|---|---|
| [Client](client/index.md) | Who sends the traffic, and how? | 2 | [Intro](../../classes/intro/index.md), [Edge › Protocols](../../classes/edge/protocols/index.md) |
| [Traffic & Edge](edge/index.md) | How does a request find us and get in safely? | 6 | [Edge](../../classes/edge/index.md) |
| [Compute](compute/index.md) | Where does the code run, and how does it scale? | 8 | [Compute](../../classes/compute/index.md) |
| [Storage](storage/index.md) | Where does the data live, and how fast can we read it? | 6 | [Databases](../../classes/databases/index.md), [Caching](../../classes/caching/index.md) |
| [Messaging](messaging/index.md) | How do services talk without waiting for each other? | 4 | [Messaging](../../classes/messaging/index.md) |
| [Observability](observability/index.md) | How do we know what is happening? | 5 | [Observability](../../classes/observability/index.md) |
| [Network](network/index.md) | Who can talk to whom? | 5 | [Network & security](../../classes/network-security/index.md) |
| [AI & Agents](ai/index.md) | How do we put an LLM in production safely? | 5 | [AI systems](../../classes/ai-systems/index.md) |
| [External](external/index.md) | How do we depend on services we don't run? | 3 | [Compute › Integrations](../../classes/compute/integrations/index.md) |

## All components

| Id | Component | Category | In one line |
|---|---|---|---|
| `client` | [Client](client/index.md#client) | Client | A browser or program that sends requests; generates the load |
| `mobile` | [Mobile](client/index.md#mobile) | Client | A mobile app: flaky networks, offline use, slow updates |
| `dns` | [DNS](edge/index.md#dns) | Traffic & Edge | Names to IP addresses; geo, weighted and failover routing |
| `cdn` | [CDN](edge/index.md#cdn) | Traffic & Edge | Caches content near users; offloads the origin |
| `lb` | [Load Balancer](edge/index.md#lb) | Traffic & Edge | Spreads requests over healthy replicas (L4/L7) |
| `waf` | [WAF](edge/index.md#waf) | Traffic & Edge | Filters malicious HTTP traffic and bots |
| `apigw` | [API Gateway](edge/index.md#apigw) | Traffic & Edge | Front door of the API: auth, rate limiting, routing |
| `ingress` | [Ingress](edge/index.md#ingress) | Traffic & Edge | Routes external HTTP traffic into a Kubernetes cluster |
| `app` | [App Server](compute/index.md#app) | Compute | Stateless service replicas that run the business logic |
| `worker` | [Worker](compute/index.md#worker) | Compute | Background processes that drain queues |
| `serverless` | [Serverless](compute/index.md#serverless) | Compute | Functions that scale per request, with cold starts and limits |
| `auth` | [Auth Service](compute/index.md#auth) | Compute | Authenticates users and issues tokens (OIDC/JWT) |
| `search` | [Search](compute/index.md#search) | Compute | Full-text and faceted search over an inverted index |
| `scheduler` | [Scheduler](compute/index.md#scheduler) | Compute | Runs jobs on a schedule (cron) exactly when they should |
| `notifications` | [Notifications](compute/index.md#notifications) | Compute | Sends email, push and SMS through providers, asynchronously |
| `analytics` | [Analytics](compute/index.md#analytics) | Compute | Collects and aggregates events for reports and dashboards |
| `sql` | [SQL Database](storage/index.md#sql) | Storage | Relational data with transactions; the source of truth |
| `nosql` | [NoSQL DB](storage/index.md#nosql) | Storage | Key-value, document or wide-column stores that partition horizontally |
| `cache` | [Cache](storage/index.md#cache) | Storage | In-memory copies of hot data (Redis); cuts latency and DB load |
| `objstore` | [Object Store](storage/index.md#objstore) | Storage | Cheap, durable storage for files and media (S3-like) |
| `dwh` | [Data Warehouse](storage/index.md#dwh) | Storage | Columnar store for analytical queries over history |
| `vectordb` | [Vector DB](storage/index.md#vectordb) | Storage | Nearest-neighbor search over embeddings (RAG) |
| `queue` | [Message Queue](messaging/index.md#queue) | Messaging | Each message to one consumer; absorbs spikes |
| `pubsub` | [Pub/Sub](messaging/index.md#pubsub) | Messaging | Each message to every subscriber; fan-out |
| `stream` | [Event Stream](messaging/index.md#stream) | Messaging | Ordered, retained, partitioned log of events |
| `kafka` | [Kafka](messaging/index.md#kafka) | Messaging | The reference event-streaming platform: topics, partitions, consumer groups |
| `metrics` | [Metrics](observability/index.md#metrics) | Observability | Numeric time series: RED, USE, SLIs |
| `logs` | [Logs](observability/index.md#logs) | Observability | Structured records of events, linked by trace id |
| `tracing` | [Tracing](observability/index.md#tracing) | Observability | One request across services, as a waterfall of spans |
| `alerting` | [Alerting](observability/index.md#alerting) | Observability | Pages humans on SLO burn, not on CPU |
| `healthcheck` | [Health Check](observability/index.md#healthcheck) | Observability | Liveness and readiness probes for LBs and orchestrators |
| `vpc` | [VPC](network/index.md#vpc) | Network | Your private, isolated network in a region |
| `subnet` | [Subnet](network/index.md#subnet) | Network | Public or private slice of a VPC in one zone |
| `nat` | [NAT Gateway](network/index.md#nat) | Network | Outbound internet for private services |
| `vpn` | [VPN](network/index.md#vpn) | Network | Encrypted tunnel between networks |
| `mesh` | [Service Mesh](network/index.md#mesh) | Network | mTLS, retries, timeouts and telemetry between services |
| `llmgw` | [LLM Gateway](ai/index.md#llmgw) | AI & Agents | One front door to model providers: routing, fallbacks, budgets, caching |
| `orchestrator` | [Orchestrator](ai/index.md#orchestrator) | AI & Agents | Runs the agent loop of model and tool calls |
| `toolreg` | [Tool Registry](ai/index.md#toolreg) | AI & Agents | Catalog of tools the model may call (MCP), with permissions |
| `memory` | [Memory Fabric](ai/index.md#memory) | AI & Agents | Retrieval (RAG) and conversation memory |
| `safety` | [Safety Mesh](ai/index.md#safety) | AI & Agents | Guardrails on inputs, outputs and tool calls |
| `thirdparty` | [3rd Party API](external/index.md#thirdparty) | External | Someone else's API: slow, rate-limited, sometimes down |
| `payment` | [Payment](external/index.md#payment) | External | Payment provider: idempotency, webhooks, reconciliation |
| `email` | [Email](external/index.md#email) | External | Email delivery provider, always behind a queue |

## How to read an entry

!!! tip "Use the catalog three ways"
    - **While designing in the playground**: click a node, then "learn more" to see its parameters and failure modes.
    - **Before an interview**: read only the *In the interview* box of each component, out loud; then the [quick reference](../../support/interview/quick-reference/index.md).
    - **While studying a class**: each entry links back to the class pages and to the scenarios where the component matters.

Numbers in the catalog are either well-known published values (with the source named) or clearly marked **≈ illustrative** — orders of magnitude to reason with, not benchmarks. Prices are approximate list prices from 2026: always check the providers' calculators. For the full set of numbers, see the [numbers cheat sheet](../numbers/index.md); for definitions, the [glossary](../glossary/index.md).
