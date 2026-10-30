# Network

The **network** components decide *who can talk to whom*. In the cloud you do not plug cables; you draw a private network (VPC), cut it into subnets, decide which subnets can be reached from the internet, give private machines a controlled way out (NAT gateway), connect other networks (VPN) and, inside a cluster, put a programmable layer between services (service mesh). Good network design is mostly about **isolation**: the database of BoxOffice should be unreachable from the internet no matter what bug the application has.

In the playground, `vpc` and `subnet` are **group frames** (rectangles you draw around nodes, with a region or availability-zone label used by outage events), `nat` and `vpn` are nodes in the request path, and `mesh` is a side node that services attach to.

| Component | One-liner | Playground id |
|---|---|---|
| [VPC](#vpc) | Your private, isolated network in a cloud region | `vpc` |
| [Subnet](#subnet) | A slice of the VPC in one availability zone, public or private | `subnet` |
| [NAT Gateway](#nat) | Lets private machines call the internet without being reachable from it | `nat` |
| [VPN](#vpn) | An encrypted tunnel between networks (office, data center, another cloud) | `vpn` |
| [Service Mesh](#mesh) | Proxies next to every service: mTLS, retries, timeouts, traffic split, telemetry | `mesh` |

``` diagram
flowchart LR
    U[Internet users] --> IGW[Internet gateway]
    subgraph VPC["VPC 10.0.0.0/16 (one region)"]
      subgraph PUB["Public subnets (AZ a, AZ b)"]
        LB[Load Balancer]
        NAT[NAT Gateway]
      end
      subgraph PRIV["Private subnets (AZ a, AZ b)"]
        APP[App Servers]
        DB[(SQL Database)]
      end
    end
    IGW --> LB --> APP --> DB
    APP -->|outbound only| NAT --> PSP[Payment provider]
    VPC <-->|VPN tunnel| DC[Office / data center]
```

---

## VPC { #vpc }

**What it is.** A Virtual Private Cloud is a logically isolated network that you own inside a cloud region. You choose its private address range (for example `10.0.0.0/16`, 65,536 addresses), and nothing gets in or out unless you add gateways and routes. Everything else (subnets, route tables, security groups, gateways) lives inside a VPC. Think of it as the building; subnets are the floors and security groups are the locks on each door.

**When to use.**

- Always, for anything that runs on cloud virtual machines, containers or managed databases: a production system lives in at least one VPC.
- **Separate VPCs** (or accounts/projects) per environment (production, staging) so a mistake in staging cannot touch production data.
- One VPC per region for multi-region designs, connected by peering or a transit gateway when services must talk across regions.

**When not to (or watch out).**

- Do not create many small VPCs per service "for isolation" without need: connecting them (peering, transit) adds cost and complexity. Use security groups and subnets for isolation inside one VPC.
- Plan the address range: overlapping ranges cannot be peered or connected by VPN later. Pick non-overlapping `/16` blocks per environment and region from day one.
- Fully serverless designs (managed functions, managed APIs) may not need a VPC at all, until they must reach a private database.

**Key numbers.**

| Metric | Typical value | Note |
|---|---|---|
| Address range | `/16` (65,536 IPs) is a common choice | Private ranges from RFC 1918: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` |
| Scope | one region, spanning all its availability zones | Subnets are per zone |
| Round trip inside an AZ | ≈ 0.1–0.5 ms | Same-datacenter order of magnitude |
| Round trip between AZs of a region | ≈ 1–2 ms | ≈ illustrative; check your provider |
| Cost of the VPC itself | free | You pay for gateways, cross-AZ traffic and egress |

**Failure modes.**

- **Overlapping CIDR blocks** — two VPCs (or the office network) with the same range cannot be connected → an address plan from the start.
- **Everything in one AZ** — the VPC spans the region, but if all subnets are in one zone, an AZ outage takes the system down → subnets in at least two AZs.
- **Accidental exposure** — an internet gateway route on a database subnet, or a security group open to `0.0.0.0/0` → private subnets for data, least-privilege security groups, policy checks in infrastructure as code.
- **IP exhaustion** — a small range fills up as Kubernetes pods take IPs → size generously or use secondary ranges.

**In the playground.** `vpc` is a **group frame**: draw it around the nodes of one region; it carries a name and a region label. A *region outage* event takes down every node inside the frame tagged with that region, which is how the `multi-region` scenario shows why one VPC is never a disaster-recovery plan. The frame itself costs nothing and adds no latency. Scenarios: [`multi-region`](../../../../playground/scenarios/index.md#multi-region), [`observability-stack`](../../../../playground/scenarios/index.md#observability-stack).

**Real products.**

=== "AWS"

    - **Amazon VPC** — regional private network with subnets per AZ, route tables, security groups and network ACLs.
    - **AWS Transit Gateway** — hub that connects many VPCs and on-premises networks.

=== "GCP"

    - **VPC network** — global VPC whose subnets are regional; firewall rules and routes at the network level.
    - **Shared VPC** — one host project's network used by many service projects.

=== "Azure"

    - **Azure Virtual Network (VNet)** — regional private network with subnets and network security groups.
    - **Virtual network peering** — connects VNets across regions.

=== "Open source"

    - No direct equivalent: a VPC is a cloud abstraction. On your own hardware the same ideas are VLANs and routing; in OpenStack, **Neutron** networks; locally, **Docker networks** and **kind/minikube** cluster networks play the role of isolated networks.

!!! tip "In the interview"
    "Everything runs in a VPC with subnets in at least two availability zones: only the load balancer is public; services and databases sit in private subnets, and security groups allow only the calls the design needs."

**Learn more:** [Network & security › Cloud network](../../../classes/network-security/cloud-network/index.md) · [Reliability › Disaster recovery](../../../classes/reliability/disaster-recovery/index.md) · [Cloud-native › Kubernetes](../../../classes/cloud-native/kubernetes/index.md)

---

## Subnet { #subnet }

**What it is.** A subnet is a range of addresses inside the VPC that lives in **one availability zone**. What makes a subnet *public* or *private* is its **route table**: a public subnet has a route to the internet gateway (so resources with public IPs are reachable), a private subnet does not (its outbound internet traffic, if any, goes through a NAT gateway). Security groups (stateful, per resource) and network ACLs (stateless, per subnet) add the firewall rules.

**When to use.**

- The classic three-tier layout per AZ: **public** subnets for load balancers and NAT gateways, **private** subnets for application servers, **isolated/data** subnets for databases and caches with no internet route at all.
- Duplicate each tier in at least two AZs, so the load balancer and the database can fail over between zones.
- Separate subnets when different rules apply (for example a subnet for Kubernetes nodes, another for managed databases).

**When not to (or watch out).**

- Do not put application servers in public subnets "to make it easier": every server with a public IP is an attack surface.
- Subnets do not replace security groups: inside a VPC, subnets route to each other by default; the security group is what blocks `app → db` from the wrong service.
- Cross-AZ traffic is usually billed per GB: chatty services spread over zones cost more than you expect.

**Key numbers.**

| Metric | Typical value | Note |
|---|---|---|
| Typical size | `/24` (256 addresses) to `/20` (4,096) | Clouds reserve a few addresses per subnet (AWS reserves 5) |
| AZs per design | 2–3 | Most regions offer 3 or more |
| Cross-AZ data transfer | ≈ USD 0.01 per GB in each direction | ≈ approximate (2026), AWS-style pricing |
| Security group rule evaluation | stateful: replies are allowed automatically | NACLs are stateless: both directions need rules |

**Failure modes.**

- **AZ outage** — every subnet in that zone disappears → redundant subnets and replicas in another AZ, load balancer spanning zones.
- **Wrong route table** — a "private" subnet with a route to the internet gateway, or a private subnet without a NAT route that can no longer reach the payment provider → infrastructure as code with review; test outbound calls after changes.
- **IP exhaustion** — pods or functions consume all addresses and new instances cannot start → larger ranges, separate pod ranges.
- **NACL blocking replies** — stateless rules forget the ephemeral reply ports → prefer security groups for most rules.

**In the playground.** `subnet` is a **group frame** like `vpc`, drawn inside it, with an availability-zone label (`a`, `b`, …). An *AZ outage* event takes down every node inside the frames of that zone. Put two replicas of `app` and a database replica in two different subnet frames and watch the load balancer keep serving when one zone fails. Scenarios: [`scale-out`](../../../../playground/scenarios/index.md#scale-out), [`multi-region`](../../../../playground/scenarios/index.md#multi-region), [`db-replicas`](../../../../playground/scenarios/index.md#db-replicas).

**Real products.**

=== "AWS"

    - **VPC subnets** — per-AZ subnets with route tables, **security groups** and **network ACLs**.

=== "GCP"

    - **Subnets** — regional (they span the zones of a region); **VPC firewall rules** and network tags control access.

=== "Azure"

    - **VNet subnets** — with **network security groups (NSGs)** and route tables; delegated subnets for managed services.

=== "Open source"

    - On Kubernetes, **NetworkPolicy** (enforced by CNIs such as **Calico** or **Cilium**) plays the role of security groups between pods.
    - On Linux hosts, **iptables / nftables** implement the same filtering ideas.

!!! tip "In the interview"
    "Three tiers per zone, two zones: public subnets hold only the load balancer and the NAT gateway, private subnets hold the services, and the database subnets have no internet route at all — so a bug in the app can't expose the database directly."

**Learn more:** [Network & security › Cloud network](../../../classes/network-security/cloud-network/index.md) · [Network & security › Zero trust](../../../classes/network-security/zero-trust/index.md) · [Estimation › Availability math](../../../classes/estimation/availability-math/index.md)

---

## NAT Gateway { #nat }

**What it is.** Network Address Translation lets machines with private addresses open connections **to** the internet while staying unreachable **from** it. The NAT gateway sits in a public subnet; private subnets route their internet-bound traffic to it; it rewrites the source address to its own public IP and keeps track of each connection so replies find their way back. BoxOffice's `payment` service in a private subnet calls the payment provider through the NAT gateway.

**When to use.**

- Private services that must call external APIs (payment providers, email services, package registries, LLM providers) or pull container images and updates.
- When an external partner needs to **allow-list** your traffic: all calls leave from the NAT gateway's fixed public IP(s).

**When not to (or watch out).**

- Traffic to the cloud provider's own services (object storage, queues) should not go through NAT: use **private endpoints / VPC endpoints**, which are cheaper and never leave the provider's network.
- NAT gateways are billed per hour **and per GB processed**: a chatty service downloading large files through NAT can cost more than the servers.
- One NAT gateway per AZ: a single NAT in one zone is a single point of failure and adds cross-AZ charges.
- Not for inbound traffic: if something must be reachable from the internet, it goes behind a load balancer.

**Key numbers.**

| Metric | Typical value | Note |
|---|---|---|
| Price | ≈ USD 0.045 per hour + ≈ USD 0.045 per GB processed | ≈ approximate AWS list price (2026); other clouds are similar in shape |
| Bandwidth | scales to tens of Gbps per gateway (AWS documents up to 100 Gbps) | Check provider limits |
| Concurrent connections to one destination | tens of thousands per public IP (port range) | Port exhaustion is a real limit; add IPs |
| Added latency | ≈ sub-millisecond | Negligible compared with the external call |

**Failure modes.**

- **Port exhaustion** — many connections to the same destination IP and port use up the source ports → connection pooling and keep-alive, more NAT IPs.
- **Zonal failure** — one NAT gateway for all zones fails or its zone goes down → one NAT per AZ, each zone's private subnets route to their own.
- **Cost surprise** — logs, images or backups flowing through NAT → VPC endpoints for provider services, look at the per-GB line of the bill.
- **Missing route** — after a network change, private services silently lose outbound access (timeouts to the provider) → synthetic checks of outbound dependencies.

**In the playground.** `nat` is a **call** node placed between private services and external nodes (`payment`, `email`, `thirdparty`). It has a capacity (default 100,000 req/s) and a **per-GB cost** (`payloadKB`, default 20 KB per request, at ≈ 0.045 USD/GB) that shows up in the cost panel; when its capacity is exceeded, calls to the outside queue and time out. Scenarios: [`payment-system`](../../../../playground/scenarios/index.md#payment-system), [`notification-system`](../../../../playground/scenarios/index.md#notification-system).

**Real products.**

=== "AWS"

    - **NAT Gateway** — managed, per-AZ NAT with elastic IPs.
    - **VPC endpoints (Gateway / Interface, PrivateLink)** — reach S3, DynamoDB, SQS and others without NAT.

=== "GCP"

    - **Cloud NAT** — managed, software-defined NAT for VMs and GKE nodes without external IPs.
    - **Private Google Access / Private Service Connect** — reach Google APIs privately.

=== "Azure"

    - **Azure NAT Gateway** — managed outbound connectivity for subnets.
    - **Private Endpoint / Private Link** — private access to Azure services.

=== "Open source"

    - **Linux iptables / nftables masquerading** on a VM (a "NAT instance") — cheap, but you own its availability.
    - Kubernetes egress gateways (for example **Istio egress gateway**) centralize and control outbound traffic.

!!! tip "In the interview"
    "Services stay in private subnets; outbound calls to the payment provider go through a NAT gateway per zone with fixed IPs the provider can allow-list, and traffic to the cloud's own services uses private endpoints so it doesn't pay NAT per-GB fees."

**Learn more:** [Network & security › Cloud network](../../../classes/network-security/cloud-network/index.md) · [Compute › Integrations](../../../classes/compute/integrations/index.md) · [Cloud-native › FinOps](../../../classes/cloud-native/finops/index.md)

---

## VPN { #vpn }

**What it is.** A Virtual Private Network is an encrypted tunnel that joins two networks over the internet as if they were one. **Site-to-site** VPNs (usually IPsec) connect a VPC to an office, a data center or another cloud; **client** VPNs let a person's laptop join the private network. For higher bandwidth and steadier latency, companies use **dedicated interconnects** (a private fiber link to the cloud) instead of, or in addition to, VPNs.

**When to use.**

- Hybrid systems: BoxOffice's legacy box-office system in a stadium data center must reach the `inventory` service in the cloud privately.
- Connecting two clouds or two companies' networks for a specific integration.
- Administrative access to private resources (although modern practice prefers identity-aware proxies and bastion-less access; see zero trust).

**When not to (or watch out).**

- Not a security model by itself: "inside the VPN = trusted" is exactly what zero trust rejects. Authenticate and authorize every call anyway.
- Throughput of a single IPsec tunnel is limited (on the order of 1 Gbps per tunnel on major clouds); heavy data transfer needs several tunnels or a dedicated interconnect.
- Latency is that of the internet path plus encryption: do not put a VPN hop in a latency-critical synchronous path if you can avoid it.

**Key numbers.**

| Metric | Typical value | Note |
|---|---|---|
| Throughput per IPsec tunnel | ≈ up to 1.25 Gbps (AWS Site-to-Site VPN) | ≈ approximate; aggregate several tunnels for more |
| Added latency | ≈ 5–20 ms over the internet path | Depends on distance; the playground uses a median of 10 ms (≈ 5–20 ms) |
| Dedicated interconnect | 1–100 Gbps ports | Private, steadier latency, higher fixed cost |
| Availability | two tunnels per connection (redundant endpoints) | Configure both; one is maintained at a time |

**Failure modes.**

- **Tunnel down** — key renegotiation fails or the customer-side device reboots → two tunnels (and ideally two devices), dynamic routing (BGP) for automatic failover, alerting on tunnel status.
- **Bandwidth saturation** — a backup job saturates the tunnel and the interactive traffic suffers → quality of service, separate tunnels, or an interconnect.
- **MTU problems** — encryption overhead makes large packets fragment or drop, causing mysterious hangs → lower MTU / MSS clamping.
- **Over-trust** — a compromised laptop on the VPN reaches everything → least privilege, segmentation, zero-trust access.

**In the playground.** `vpn` is a **call** node that adds latency (median 10 ms, lognormal: roughly 5–20 ms) and can fail as a unit; use it to connect a frame representing an on-premises system to cloud services and see how a synchronous call over a VPN shows up in the p99. Scenarios: [`multi-region`](../../../../playground/scenarios/index.md#multi-region), [`cascading-failure`](../../../../playground/scenarios/index.md#cascading-failure) (add a VPN hop to the slow path and compare).

**Real products.**

=== "AWS"

    - **AWS Site-to-Site VPN** — IPsec tunnels to a virtual private gateway or transit gateway.
    - **AWS Client VPN** — managed OpenVPN-based remote access.
    - **AWS Direct Connect** — dedicated private connection.

=== "GCP"

    - **Cloud VPN (HA VPN)** — IPsec with a 99.99% SLA in the high-availability configuration.
    - **Cloud Interconnect** — dedicated or partner interconnect.

=== "Azure"

    - **Azure VPN Gateway** — site-to-site and point-to-site VPN.
    - **Azure ExpressRoute** — private dedicated connectivity.

=== "Open source"

    - **WireGuard** — modern, small and fast VPN protocol built into Linux.
    - **OpenVPN** — mature TLS-based VPN.
    - **strongSwan** — IPsec implementation for site-to-site tunnels.

!!! tip "In the interview"
    "To reach the legacy system in the stadium I'd use a redundant site-to-site VPN (or an interconnect if the volume is high), keep that call off the synchronous purchase path, and still authenticate every request: being on the VPN doesn't make a caller trusted."

**Learn more:** [Network & security › Cloud network](../../../classes/network-security/cloud-network/index.md) · [Network & security › Zero trust](../../../classes/network-security/zero-trust/index.md)

---

## Service Mesh { #mesh }

**What it is.** A service mesh puts a proxy next to every service (a **sidecar** in each pod, or a per-node proxy in **ambient** mode) and routes all service-to-service traffic through those proxies. A **control plane** configures them. Without changing application code you get mutual TLS (mTLS: both sides prove their identity and the traffic is encrypted), retries, timeouts, circuit breaking, traffic splitting for canaries, and uniform metrics and traces for every call.

**When to use.**

- Many services (tens or more) owned by different teams, where implementing mTLS, retries and telemetry consistently in every codebase is impractical.
- Zero-trust requirements inside the cluster: every call authenticated by workload identity, with policies such as "only `order` may call `payment`".
- Progressive delivery: send 5% of `catalog` traffic to the new version and shift gradually.

**When not to (or watch out).**

- A handful of services: a library (Resilience4j, an OpenTelemetry SDK) and the platform's mTLS are simpler. A mesh is a platform to operate, with its own upgrades and failure modes.
- Every hop through a proxy adds latency (sidecars add two proxies per call) and memory per pod; with deep call chains this adds up.
- Retries in the mesh **and** in the application multiply each other (3 × 3 = 9 attempts): decide where retries live.

**Key numbers.**

| Metric | Typical value | Note |
|---|---|---|
| Added latency per hop | ≈ 1 ms or less at p50, more at the tail | ≈ illustrative; depends on mode, features and load; the playground adds ~1 ms per hop |
| Sidecar memory | tens of MB per pod | Ambient / per-node modes reduce it |
| mTLS certificate lifetime | hours to a day, rotated automatically | Short-lived identities limit the damage of a leak |
| Traffic split granularity | 1% steps (or finer) | Used for canaries |

**Failure modes.**

- **Control plane outage** — proxies keep their last configuration, but new pods may not get certificates or routes → run the control plane highly available, monitor certificate expiry.
- **Retry amplification** — retries at several layers turn a blip into a storm → retry budgets, retries in one layer only.
- **Misconfigured policy** — a deny-by-default rule blocks a legitimate call after a deploy → policy tests in CI, staged rollout of policies.
- **Proxy resource starvation** — sidecars without enough CPU become the bottleneck → set requests and limits for proxies, watch their metrics.

**In the playground.** `mesh` is a **side** node, not a box in the request path: the services attached to it pay about 1 ms of sidecar overhead per outgoing hop and get the mesh defaults on every edge that sets none — timeout `meshTimeoutMs` (1,000 ms), `meshRetries` (2) with exponential backoff and jitter, and a circuit breaker. A mesh attached to `metrics` makes every attached service observed. (mTLS is assumed, not simulated.) Try the `cascading-failure` scenario with and without a mesh, then compare with setting `timeoutMs` and `circuitBreaker` by hand on the edges. Scenarios: [`cascading-failure`](../../../../playground/scenarios/index.md#cascading-failure), [`retry-storm`](../../../../playground/scenarios/index.md#retry-storm), [`observability-stack`](../../../../playground/scenarios/index.md#observability-stack).

**Real products.**

=== "AWS"

    - **Amazon VPC Lattice** — managed service-to-service networking with auth policies across VPCs and accounts.
    - **Istio on Amazon EKS** — the common self-managed choice (AWS App Mesh has been discontinued).

=== "GCP"

    - **Cloud Service Mesh** — managed, Istio-based mesh for GKE and VMs.

=== "Azure"

    - **Istio-based service mesh add-on for AKS** — managed Istio in Azure Kubernetes Service.

=== "Open source"

    - **Istio** — the most widely used mesh; sidecar and ambient modes, built on Envoy.
    - **Linkerd** — lightweight mesh with its own Rust proxy, focused on simplicity.
    - **Cilium Service Mesh** — eBPF-based networking with mesh features.
    - **Envoy** — the proxy underneath many meshes and gateways.

!!! tip "In the interview"
    "With dozens of services I'd use a mesh to get mTLS, timeouts, retries and telemetry on every call without touching code — but it costs latency per hop and a platform to run, so with five services I'd use libraries instead, and I'd keep retries in one layer only."

**Learn more:** [Network & security › Service mesh](../../../classes/network-security/service-mesh/index.md) · [Network & security › Zero trust](../../../classes/network-security/zero-trust/index.md) · [Reliability › Patterns](../../../classes/reliability/patterns/index.md) · [Hands-on 9](../../../hands-on/9/index.md)
