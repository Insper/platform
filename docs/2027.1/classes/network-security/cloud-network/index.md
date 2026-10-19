
On a developer laptop, BoxOffice lives in one Docker network: every container can reach every other container, and only Nginx publishes a port. In the cloud, the equivalent decision is far bigger and much harder to change later. Which machines get a public address? Can the database reach the Internet — and can the Internet reach the database? How does the `payment` service call the provider, which only accepts requests from **allow-listed IP addresses**? How does an engineer debug a pod without opening SSH to the world? This page builds the BoxOffice network in a cloud provider, one component at a time.

The examples use AWS names, the most common in job descriptions; the tabs at the end map them to Google Cloud and Azure. The ideas are the same everywhere[^1].

---

## The VPC: your own private network in the cloud

A **VPC** (Virtual Private Cloud) is a logically isolated network inside a cloud region. You choose its address range, divide it into subnets, and decide every route in and out. Nothing enters or leaves a VPC unless you add a component and a route that allows it.

| Concept | One-line definition |
|---|---|
| **Region** | a geographic area with several data centers (e.g. `sa-east-1`, São Paulo) |
| **Availability Zone (AZ)** | one or more isolated data centers inside a region, with independent power and network |
| **VPC** | your private network, spanning all the AZs of one region |
| **Subnet** | a slice of the VPC address range that lives in **one** AZ |
| **Route table** | rules attached to subnets: "traffic to this destination goes to that target" |

### CIDR planning

Addresses are written in **CIDR** notation (Classless Inter-Domain Routing): `10.20.0.0/16` means "the first 16 bits are fixed", leaving 32 − 16 = 16 bits for hosts, i.e. 2¹⁶ = 65 536 addresses. Each extra bit in the prefix halves the block.

The VPC should use a **private range** (RFC 1918: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)[^2]. Two rules save a lot of pain later:

1. **Do not overlap** with other networks you may ever connect to — the office, another VPC, a partner. Two networks with overlapping ranges cannot be routed to each other (peering is refused).
2. **Leave room**: a VPC range is hard to change. Plan for more AZs and more subnet tiers than you need today.

AWS reserves **5 addresses in every subnet** (network address, VPC router, DNS, one reserved for future use, broadcast)[^1]. The table below is computed, not typed:

```python exec="true"
rows = []
for prefix in (16, 19, 20, 22, 24, 26, 28):
    total = 2 ** (32 - prefix)
    rows.append(f"| /{prefix} | {total:,} | {total - 5:,} |".replace(",", " "))
print("| /p | 2³²⁻ᵖ | 2³²⁻ᵖ − 5 (AWS) |")
print("|---|---|---|")
print("\n".join(rows))
```

!!! example "BoxOffice — the CIDR plan"

    VPC `10.20.0.0/16` in `sa-east-1`, three AZs, three tiers per AZ:

    | Tier | AZ a | AZ b | AZ c | Why this size |
    |---|---|---|---|---|
    | Public (load balancer, NAT) | `10.20.0.0/24` | `10.20.1.0/24` | `10.20.2.0/24` | few resources live here |
    | Private app (Kubernetes nodes and pods) | `10.20.32.0/19` | `10.20.64.0/19` | `10.20.96.0/19` | pods take one IP each in AWS VPC CNI: 8 187 usable per AZ |
    | Isolated data (PostgreSQL, Redis, Kafka) | `10.20.8.0/22` | `10.20.12.0/22` | `10.20.16.0/22` | databases are few but need room for replicas and failover |

    About half of the `/16` is still free for a fourth AZ or a new tier. Kubernetes pods are the reason the app subnets are big: with the AWS VPC CNI every pod gets a real VPC address.

??? question "Think first: how many pods fit in one private app subnet?"

    A `/19` has 2¹³ = 8 192 addresses, minus 5 reserved = **8 187**. Nodes also take addresses, and the CNI keeps some warm IPs per node, so the real number of pods is lower — but in the thousands per AZ. A `/24` (251 usable) would have run out at the first autoscaling event of a flash sale.

---

## Public, private and isolated subnets { #subnets }

A subnet is not "public" because of a checkbox. It is public **because of its route table**: it has a route `0.0.0.0/0 → Internet Gateway`. Everything else follows from routes.

| Subnet type | Default route (`0.0.0.0/0`) | Reachable from the Internet? | Can reach the Internet? | BoxOffice uses it for |
|---|---|---|---|---|
| **Public** | Internet Gateway | yes, if the resource has a public IP and the security group allows | yes | Application Load Balancer, NAT gateways |
| **Private** | NAT gateway | no | yes, outbound only, through NAT | Kubernetes nodes: `gateway`, `order`, `payment`, … |
| **Isolated** | none | no | no | PostgreSQL, Redis, Kafka |

Every route table also has an implicit **local route** (`10.20.0.0/16 → local`): all subnets of the VPC can reach each other at the routing level. **Isolation between tiers is therefore the job of security groups and NACLs**, not of routes.

### Internet Gateway and NAT gateway

- **Internet Gateway (IGW)** — attached to the VPC; lets resources *with public IPs* send and receive Internet traffic. It is horizontally scaled and highly available by design.
- **NAT gateway** — lives in a public subnet with a fixed public address (an *Elastic IP*). Private resources send outbound traffic to it; it rewrites the source address to its own and keeps a translation table, so the replies find their way back. **Connections can only be started from inside.**

``` mermaid-sim
sequenceDiagram
    autonumber
    actor U as Fan (mobile)
    participant IGW as Internet Gateway
    participant ALB as Load balancer (public subnet)
    participant PAY as payment pod 10.20.40.17 (private subnet)
    participant NAT as NAT gateway 15.228.x.x (public subnet)
    participant PSP as Payment provider
    U->>IGW: HTTPS checkout.boxoffice.com
    IGW->>ALB: to the ALB's public address
    ALB->>PAY: 10.20.40.17:8080 (via gateway → order)
    PAY->>NAT: src 10.20.40.17 → dst PSP:443 (route 0.0.0.0/0 → NAT)
    NAT->>PSP: src 15.228.x.x (Elastic IP, allow-listed)
    PSP-->>NAT: 200 charge authorized
    NAT-->>PAY: translated back to 10.20.40.17
    PAY-->>U: order confirmed (through ALB)
```

The provider sees **one stable source address** — the NAT gateway's Elastic IP — which BoxOffice registers in the provider's allow-list. Pods can be rescheduled to any node; the egress address never changes.

!!! warning "NAT gateways are per AZ"
    A NAT gateway lives in **one** AZ. If all private subnets route through the NAT in AZ a and AZ a fails, the pods in AZ b and c lose Internet access — `payment` cannot reach the provider, and checkout stops. The resilient design is **one NAT gateway per AZ**, each private subnet routing to the NAT in its own AZ. That costs three times the hourly price and requires registering three Elastic IPs with the provider. It is a classic availability × cost trade-off.

### Cost: the surprise line on the bill

NAT gateways charge per hour **and per GB processed**. Traffic that does not need to go to the Internet — pulling images from the registry, writing to object storage, reading secrets — still goes through NAT if nothing else is configured. The fix is a **VPC endpoint**:

- **Gateway endpoints** (S3, DynamoDB on AWS) — a route-table entry; free.
- **Interface endpoints** (PrivateLink) — a private IP inside your subnet that reaches a cloud service (Secrets Manager, ECR, KMS…) or a partner's service without crossing the Internet; billed per hour and per GB, usually cheaper than NAT for heavy traffic.

!!! example "BoxOffice — estimating NAT traffic (illustrative numbers)"

    Assume each Kubernetes node pulls ~2 GB of images per day during deploys, 30 nodes, plus 50 GB/day of logs shipped to object storage. That is ~110 GB/day ≈ 3.3 TB/month through NAT for traffic that never needed the Internet. An S3 gateway endpoint and an ECR interface endpoint remove it from NAT. Always check the current prices of your provider; the *structure* (per-hour + per-GB) is what matters in the design.

---

## Security groups and NACLs { #security-groups }

Routes decide *where* packets can go; firewalls decide *whether* they are allowed. AWS has two, at different levels:

| | **Security group (SG)** | **Network ACL (NACL)** |
|---|---|---|
| Attached to | a network interface (instance, pod, load balancer, database) | a subnet |
| State | **stateful** — a reply to an allowed request is allowed automatically | **stateless** — inbound and outbound must both be allowed, including ephemeral ports |
| Rules | allow only | allow and deny, evaluated in number order |
| Sources | CIDR **or another security group** | CIDR only |
| Typical use | the main, fine-grained control | coarse guard rails: block a range, separate tiers |

Treat them as layers of the same defense in depth[^4]. The most useful feature is **SG references**: "allow port 5432 from *the security group of the app nodes*" instead of "from `10.20.32.0/19`". The rule follows the workloads as they scale, move or change IP.

``` mermaid
flowchart LR
    subgraph sgalb ["sg-alb"]
        ALB["ALB :443"]
    end
    subgraph sgapp ["sg-app"]
        N["EKS nodes :8080"]
    end
    subgraph sgdb ["sg-db"]
        DB[("RDS :5432")]
    end
    I(["Internet 0.0.0.0/0"]) -->|"443"| ALB
    ALB -->|"8080 from sg-alb"| N
    N -->|"5432 from sg-app"| DB
```

!!! warning "Security groups are not identity"
    An SG rule says "anything on the app nodes may reach the database". With Kubernetes, *every* pod on those nodes — including the compromised `search` pod — matches. Finer control needs per-pod security groups, Kubernetes NetworkPolicy or a [service mesh](../service-mesh/index.md) authorization policy, and per-service database credentials ([Zero Trust](../zero-trust/index.md)).

---

## The BoxOffice VPC

Putting it together (two of the three AZs drawn):

``` mermaid
flowchart TB
    NET(["Internet"]) --- IGW["Internet Gateway"]
    subgraph vpc ["VPC 10.20.0.0/16 — sa-east-1"]
        IGW
        subgraph aza ["AZ a"]
            subgraph puba ["public 10.20.0.0/24"]
                ALBa["ALB node"]
                NATa["NAT gw + EIP"]
            end
            subgraph appa ["private app 10.20.32.0/19"]
                Ka["EKS nodes<br/>gateway · order · payment · …"]
            end
            subgraph dataa ["isolated data 10.20.8.0/22"]
                RDSa[("PostgreSQL primary")]
                Ra[("Redis")]
            end
        end
        subgraph azb ["AZ b"]
            subgraph pubb ["public 10.20.1.0/24"]
                ALBb["ALB node"]
                NATb["NAT gw + EIP"]
            end
            subgraph appb ["private app 10.20.64.0/19"]
                Kb["EKS nodes"]
            end
            subgraph datab ["isolated data 10.20.12.0/22"]
                RDSb[("PostgreSQL standby")]
                Rb[("Redis replica")]
            end
        end
        EP["VPC endpoints<br/>S3 · ECR · Secrets Manager"]
    end
    IGW --> ALBa & ALBb
    ALBa --> Ka
    ALBb --> Kb
    Ka --> RDSa & Ra
    Kb --> RDSa
    Ka -->|"0.0.0.0/0"| NATa
    Kb -->|"0.0.0.0/0"| NATb
    NATa & NATb --> IGW
    Ka & Kb -.-> EP
    RDSa -.->|"sync replication"| RDSb
```

### As code

Networks are declared with **infrastructure as code** (IaC) so they can be reviewed, versioned and recreated. A trimmed Terraform/OpenTofu sketch of one AZ (the real module loops over the AZs):

```hcl
resource "aws_vpc" "boxoffice" {
  cidr_block           = "10.20.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "boxoffice-prod" }
}

resource "aws_subnet" "public_a" {
  vpc_id            = aws_vpc.boxoffice.id
  cidr_block        = "10.20.0.0/24"
  availability_zone = "sa-east-1a"
}

resource "aws_subnet" "app_a" {
  vpc_id            = aws_vpc.boxoffice.id
  cidr_block        = "10.20.32.0/19"
  availability_zone = "sa-east-1a"
}

resource "aws_subnet" "data_a" {
  vpc_id            = aws_vpc.boxoffice.id
  cidr_block        = "10.20.8.0/22"
  availability_zone = "sa-east-1a"
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.boxoffice.id
}

resource "aws_eip" "nat_a" {
  domain = "vpc"
}

resource "aws_nat_gateway" "a" {
  subnet_id     = aws_subnet.public_a.id # NAT lives in the PUBLIC subnet
  allocation_id = aws_eip.nat_a.id       # fixed egress IP for the PSP allow-list
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.boxoffice.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }
}

resource "aws_route_table" "app_a" {
  vpc_id = aws_vpc.boxoffice.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.a.id # egress only, same AZ
  }
}

# data subnets get a route table with no 0.0.0.0/0 route at all

resource "aws_route_table_association" "public_a" {
  subnet_id      = aws_subnet.public_a.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "app_a" {
  subnet_id      = aws_subnet.app_a.id
  route_table_id = aws_route_table.app_a.id
}

resource "aws_security_group" "app" {
  name   = "sg-app"
  vpc_id = aws_vpc.boxoffice.id
}

resource "aws_security_group" "db" {
  name   = "sg-db"
  vpc_id = aws_vpc.boxoffice.id

  ingress {
    description     = "PostgreSQL only from the app nodes"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id] # reference, not a CIDR
  }
}
```

Read it as a diagram: the only `0.0.0.0/0 → igw` route is in the public table; the app table sends the Internet to NAT; the data subnets have no default route; the database accepts 5432 only from members of `sg-app`.

**Try it.** Open the `payment-system` scenario. The `payment` service calls an external provider. Increase the load and inject chaos on the provider: note that every call crosses the network boundary (in the real deployment, through the NAT gateway). Ask yourself which failures belong to the network (NAT in one AZ, egress IP not allow-listed) and which to the provider. Rebuild the design in the [full playground](../../../../playground/index.md) with `vpc`, `subnet` and `nat` components to make the boundaries visible.

<div class="sdp" data-scenario="payment-system" data-mode="compact" data-height="520"></div>

---

## Private connectivity: reaching other networks { #private-connectivity }

BoxOffice soon needs to talk to networks it does not own: the office, the data team's VPC, a partner, a second region.

| Option | What it connects | Traffic goes over | Strengths | Limits |
|---|---|---|---|---|
| **VPC peering** | two VPCs, one-to-one | the provider's backbone | simple, no bandwidth bottleneck, cheap | not transitive; CIDRs must not overlap; becomes a mesh of N² links |
| **Transit gateway** (hub) | many VPCs and VPNs, hub-and-spoke | the provider's backbone | central routing, scales to hundreds of VPCs | per-attachment and per-GB cost; a central component to operate |
| **PrivateLink / interface endpoint** | one *service* exposed into consumer VPCs | the provider's backbone | consumer sees only one IP, no routing between networks, overlapping CIDRs OK | one service at a time, one direction |
| **Site-to-site VPN** (IPsec) | an on-prem network or another cloud | the public Internet, encrypted | quick to set up, cheap | bandwidth limited per tunnel, Internet latency/jitter |
| **Client VPN / WireGuard** | individual engineers' laptops | the Internet, encrypted | access for people | a VPN puts the laptop "inside" — classic perimeter trust |
| **Dedicated link** (Direct Connect / Interconnect / ExpressRoute) | a data center to the cloud | a private physical circuit | stable latency, high bandwidth | weeks to provision, expensive; usually paired with a VPN as backup |

### Getting engineers in: bastion vs session manager

The old answer is a **bastion host**: a small VM in a public subnet with SSH open, from which engineers jump into the private network. It is an attack surface (port 22 on the Internet) and a key-management problem. The modern answer is an **agent-based session service** (AWS Systems Manager Session Manager, GCP IAP TCP forwarding, Azure Bastion): the engineer authenticates with the company identity provider and MFA, the session is opened by an agent from the inside, **no inbound port is open**, and every command is logged. For Kubernetes, `kubectl` through the cluster's authenticated API plays the same role. This is Zero Trust applied to people ([Zero Trust](../zero-trust/index.md)).

### DNS inside the VPC

Services find each other by name. The VPC provides a resolver (in AWS, at the VPC base address + 2); **private hosted zones** give internal names like `db.boxoffice.internal` that resolve only inside the VPC. Inside Kubernetes, CoreDNS resolves `payment.boxoffice.svc.cluster.local`. Interface endpoints rely on private DNS so that `secretsmanager.sa-east-1.amazonaws.com` resolves to the private endpoint IP instead of the public one.

---

## The same ideas in other clouds

The vocabulary changes between providers, the building blocks do not[^3]. The biggest real difference: a Google Cloud VPC is **global**, while AWS and Azure networks are regional.

=== "AWS"

    VPC (regional) · Subnet (per AZ) · Route table · Internet Gateway · NAT Gateway · Security Group + Network ACL · Gateway/Interface Endpoint (PrivateLink) · VPC Peering · Transit Gateway · Site-to-Site VPN · Direct Connect · Systems Manager Session Manager.

=== "Google Cloud"

    VPC network (**global**; subnets are regional, not per zone) · Routes · Cloud NAT (a managed service, no per-zone instance to place) · VPC firewall rules and hierarchical firewall policies (stateful, can target **service accounts** or network tags) · Private Service Connect · VPC Network Peering · Network Connectivity Center · Cloud VPN · Cloud Interconnect · Identity-Aware Proxy (IAP).

=== "Azure"

    Virtual Network (VNet, regional) · Subnet · Route table (User-Defined Routes) · NAT Gateway · Network Security Group (NSG) + Application Security Groups · Private Endpoint / Private Link · VNet Peering · Virtual WAN / hub-spoke · VPN Gateway · ExpressRoute · Azure Bastion.

=== "Kubernetes / on-prem"

    A cluster network (CNI: Calico, Cilium) with pod and service CIDRs · NetworkPolicy as the firewall · an egress gateway (Cilium, Istio) for a stable source IP · WireGuard or IPsec tunnels between sites · MetalLB for load balancer IPs on bare metal.

---

## Trade-offs at a glance

| Decision | Option A | Option B | Choose B when… |
|---|---|---|---|
| NAT topology | one NAT for the VPC (cheap) | one NAT per AZ (resilient) | outbound calls are on the critical path (payment!) |
| Egress to cloud services | through NAT | VPC endpoints | traffic is heavy or must not cross the Internet |
| Pod addressing | overlay network (few VPC IPs) | VPC-native pod IPs | you need SGs/flow logs per pod and have address space |
| Connecting VPCs | peering | transit gateway | more than a handful of VPCs, or VPNs too |
| Admin access | bastion + SSH | session manager / IAP | almost always |
| Firewall granularity | SG per tier | per-pod SG / NetworkPolicy / mesh policy | multi-tenant clusters, sensitive services |

!!! tip "In the interview"
    When you draw the high-level design, put a **box around it labeled VPC** and split it into **public** (load balancer, NAT) and **private** (services, data) subnets across **at least two AZs**. Say one sentence about egress: "outbound calls to the payment provider go through a NAT gateway per AZ with a fixed IP the provider allow-lists." If the interviewer asks about cost, mention **VPC endpoints** to keep object-storage and registry traffic off the NAT. That is enough to signal you have run real systems.

!!! warning "Common pitfalls"
    - **SSH or RDP open to `0.0.0.0/0`** — scanned within minutes; use a session manager instead.
    - **Database in a public subnet** "just to connect from my laptop" — one weak password away from a breach.
    - **A single NAT gateway** for every AZ — an AZ outage silently becomes a checkout outage.
    - **Overlapping CIDRs** (`10.0.0.0/16` everywhere) — discovered the day you need to peer with the data team or a partner.
    - **Subnets too small** for VPC-native pod IPs — the cluster stops scheduling pods during the flash sale.
    - **Ignoring NAT data-processing charges** — registry pulls and log shipping through NAT can cost more than the servers.

---

## How it connects { #how-it-connects }

``` mermaid
flowchart LR
    VPC["VPC + CIDR plan"] --> SUB["public / private / isolated<br/>subnets, one per AZ"]
    SUB --> RT["route tables:<br/>IGW, NAT or none"]
    RT --> NAT["NAT gateway per AZ<br/>stable egress IP"]
    NAT --> PSP["provider allow-list<br/>→ Compute integrations"]
    SUB --> SG["security groups + NACLs"]
    SG --> NOID["not an identity: NetworkPolicy,<br/>mesh policy → Service mesh"]
    SUB --> AZ["AZ and region outages<br/>→ Reliability"]
    VPC --> CON["peering, transit, PrivateLink,<br/>VPN, session manager"]
    CON --> ZT["access for people<br/>→ Zero Trust"]
    VPC --> IAC["Terraform / OpenTofu<br/>→ Cloud-native"]
```

**Palette components:** [`vpc`](../../../reference/components/network/index.md#vpc) · [`subnet`](../../../reference/components/network/index.md#subnet) · [`nat`](../../../reference/components/network/index.md#nat) · [`vpn`](../../../reference/components/network/index.md#vpn) · [`lb`](../../../reference/components/edge/index.md#lb) (the ALB in the public subnets) · [`payment`](../../../reference/components/external/index.md#payment) (reached through the NAT). **Scenarios:** `payment-system`, `multi-region`, `scale-out`. **Continues in:** [Service mesh](../service-mesh/index.md), [Zero Trust](../zero-trust/index.md), [Compute — integrations](../../compute/integrations/index.md), [Reliability — disaster recovery](../../reliability/disaster-recovery/index.md#multi-region), [Cloud-native — delivery](../../cloud-native/delivery/index.md) (infrastructure as code).

## Key takeaways

- A **VPC** is your private network in a region; **subnets** live in one AZ; a subnet is public only because its route table points `0.0.0.0/0` to an **Internet Gateway**.
- Private subnets reach the Internet **outbound only** through a **NAT gateway**, which also gives a stable egress IP for allow-lists; use one per AZ for critical paths.
- **Security groups** are stateful and can reference each other; **NACLs** are stateless subnet-level guard rails. Neither is a workload identity.
- Plan **CIDRs** with room and without overlaps; AWS reserves 5 addresses per subnet; pods may need many IPs.
- Use **VPC endpoints** for cloud services, **peering/transit/PrivateLink** between networks, **VPN or dedicated links** to on-prem, and **session managers** instead of bastions.

---

[^1]: AMAZON WEB SERVICES. [Amazon VPC User Guide](https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html){target="_blank"} — subnets, route tables, NAT gateways, security groups, network ACLs.
[^2]: REKHTER, Y. et al. [RFC 1918 — Address Allocation for Private Internets](https://datatracker.ietf.org/doc/html/rfc1918){target="_blank"}. IETF, 1996.
[^3]: GOOGLE CLOUD. [VPC network overview](https://cloud.google.com/vpc/docs/vpc){target="_blank"}; MICROSOFT. [Azure Virtual Network overview](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-overview){target="_blank"}.
[^4]: AMAZON WEB SERVICES. [AWS Well-Architected Framework — Security Pillar: Infrastructure protection](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/infrastructure-protection.html){target="_blank"}.
