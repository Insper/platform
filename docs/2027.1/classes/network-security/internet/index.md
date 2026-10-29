At 10:00 a fan in São Paulo taps **Buy** on a phone connected to the home Wi-Fi. A few milliseconds later a pod with the address `10.20.40.17` charges the card through a payment provider that accepts requests from exactly one address in the world. Between the two there are a dozen routers, at least three address translations and four route tables — and none of them knows anything about BoxOffice. This page explains that path from the beginning: what an IP address is, why some addresses are **public** and others **private**, how a block of addresses is cut into **subnets**, and how **NAT** lets millions of private devices share a few public addresses. The [next page](../cloud-network/index.md) builds the BoxOffice network in the cloud on top of these ideas, and the rest of the class secures it.

!!! info "Two simulators on this page"

    The **address explorer** shows the 32 bits of any IPv4 address, splits blocks into subnets and tells public from private. The **packet walk** sends one packet through the BoxOffice network, hop by hop, showing every route-table lookup, every address rewrite and every firewall decision — and lets you break the network to see what fails.

---

## Layers: who decides what { #layers }

A request is not one thing on the wire. It is an HTTP message inside a TCP segment, inside an IP packet, inside a Wi-Fi or Ethernet frame. Each layer has its own address and answers a different question:

| Layer | Unit | Address | Question it answers | BoxOffice example |
|---|---|---|---|---|
| Application | HTTP request | URL, host name | *what* is asked | `POST /orders` to `boxoffice.com` |
| Transport | TCP segment / QUIC datagram | **port** | *which program* on the machine | `443` (the load balancer), `8080` (`order`), `5432` (PostgreSQL) |
| Network | **IP packet** | **IP address** | *which machine*, across many networks | `203.0.113.10`, `10.20.40.17` |
| Link | Ethernet / Wi-Fi frame | MAC address | *which device* on this cable or radio | the phone → the home router |

``` diagram
flowchart LR
    subgraph F["Wi-Fi frame (MAC → MAC): rewritten at every hop"]
        subgraph P["IP packet: src 192.168.0.12 → dst 203.0.113.10"]
            subgraph T["TCP segment: port 51514 → 443"]
                H["HTTP: POST /orders (inside TLS)"]
            end
        end
    end
```

Two facts follow from the picture and explain most of this page:

- **Routers look only at the IP header.** They never read the URL; the destination IP decides the path. The frame around the packet is thrown away and rebuilt at every hop.
- **Ports belong to the transport layer**, but NAT devices and firewalls read them too: that is how one public address is shared, and how a security group allows `5432` and refuses `22`.

---

## How a packet crosses the Internet { #routing }

The Internet is a network of networks: tens of thousands of **autonomous systems** (AS) — carriers, universities, cloud providers, large companies — each with its own routers and its own blocks of addresses. Each AS **announces** its blocks to its neighbours with **BGP** (Border Gateway Protocol)[^1]: "send me the packets for `203.0.113.0/24`". The announcements propagate until every core router has a route to about a million IPv4 prefixes.

No router knows the whole path. Each one does the same thing for every packet:

1. Read the destination IP.
2. Find the **most specific route** that contains it in its table (**longest prefix match**: a route to `/24` beats a route to `/16`, which beats the default route `0.0.0.0/0`).
3. Send the packet to the **next hop** of that route, and decrement the packet's **TTL** (a hop counter that kills packets caught in loops).

Press play to follow one packet from the fan's phone to BoxOffice (the addresses are documentation examples[^2]):

``` diagram-sim
sequenceDiagram
    autonumber
    participant P as Phone 192.168.0.12
    participant R as Home router (NAT)
    participant C as Carrier (AS of the ISP)
    participant X as Transit / exchange point
    participant E as Cloud provider edge
    participant G as Internet gateway (VPC)
    participant L as Load balancer 10.20.0.10
    P->>R: dst 203.0.113.10 is not in 192.168.0.0/24 → default gateway
    R->>C: NAT: src becomes 198.51.100.7 (the home's public IP)
    C->>X: longest match for 203.0.113.10: route learned with BGP
    X->>E: next hop: the network that announced 203.0.113.0/24
    E->>G: inside the provider: the VPC that owns 203.0.113.10
    G->>L: 1:1 NAT: dst 203.0.113.10 becomes 10.20.0.10
    L-->>P: the reply takes the same translations backwards
```

Run `traceroute` (Linux, macOS) or `tracert` (Windows) to any site and each output line is one router of this list, with its round-trip time. A typical path has 10 to 20 hops; the time is dominated by **distance** (light in fibre covers about 200 km per millisecond), not by the number of routers — which is why the [edge](../../edge/index.md#latency-budget) puts CDNs close to the fans.

!!! info "The core of the Internet has no default route"

    Your home router has a default route (`0.0.0.0/0 → carrier`). The big routers of the core do not: they hold only the prefixes someone announced. A packet to an address that nobody announces — a **private** address like `10.20.40.17` — finds no route and is dropped at the first core router. That, not a firewall, is why the Internet cannot reach a pod by its private IP.

---

## IP addresses and CIDR { #cidr }

An IPv4 address is a **32-bit number**, written as four decimal octets: `10.20.40.17` is `00001010.00010100.00101000.00010001`. Every address has two parts:

- the **network part** (the first *n* bits) says *which network* the host is on — it is what routers match;
- the **host part** (the other 32 − *n* bits) says *which host* inside that network.

**CIDR** notation (Classless Inter-Domain Routing)[^3] writes the split after a slash: `10.20.0.0/16` is "the 2³²⁻¹⁶ = 65 536 addresses that start with the same 16 bits as `10.20.0.0`". Each extra bit in the prefix **halves** the block: a `/17` is half a `/16`, a `/24` has 256 addresses, a `/32` is a single host. The same split is sometimes written as a **mask**: `/16` is `255.255.0.0`. In a classic network the first address of a block names the network and the last one is the broadcast, so a `/24` has 254 usable hosts; AWS reserves 5 addresses in every subnet.

<div class="netsim" data-tool="cidr" data-cidr="10.20.40.17/19"></div>

**Try it:**

1. The explorer starts with `10.20.40.17/19`. The host bits are not zero, so the explorer tells you the **block** that contains this address: `10.20.32.0/19`, the private app subnet of BoxOffice in AZ a. Drag the prefix slider from `/19` to `/24` and watch the block shrink by half at every step.
2. Type `10.20.0.0/16`, choose **Split into 4 subnets** and test the address `10.20.40.17`: in which of the four `/18` blocks does it fall?
3. Click the examples: `192.168.0.12` (your home), `100.64.7.9` (your mobile carrier's NAT), `169.254.169.254` (the cloud metadata service), `8.8.8.8` (public). The **kind of address** line says which ones the Internet can route.

??? question "Think first: a subnet of `10.20.32.0/19` — is `10.20.64.5` inside it?"

    No. `/19` blocks have 2¹³ = 8 192 addresses, so they start every 32 values of the third octet: `10.20.0.0`, `10.20.32.0`, `10.20.64.0`… `10.20.32.0/19` goes from `10.20.32.0` to `10.20.63.255`; `10.20.64.5` is in the next block (`10.20.64.0/19`, the app subnet of AZ b). A host in AZ a sends packets for it to its gateway, not directly. Check it in the explorer.

---

## Public and private addresses { #public-private }

Thirty-two bits give 2³² ≈ **4.3 billion** addresses — fewer than the phones alive today, without counting servers, cars and light bulbs. The registries handed out the last free IPv4 blocks between 2011 and 2019. The Internet survived with two ideas:

- Some blocks are **private** (RFC 1918)[^4]: any network may use them internally, as many times as it wants, and **no one routes them on the Internet**.
- **NAT** (next section) lets many private hosts share one **public** address, unique in the world and announced with BGP.

| Block | Size | Kind | Routed on the Internet? | Where you meet it |
|---|---|---|---|---|
| `10.0.0.0/8` | 16.8 M | private | no | the BoxOffice VPC `10.20.0.0/16`; kind pods `10.244.0.0/16` |
| `172.16.0.0/12` | 1 M | private | no | Docker's networks (`172.18.0.0/16` in [lab 3](../../../hands-on/3/index.md)) |
| `192.168.0.0/16` | 65 536 | private | no | home routers (`192.168.0.0/24`) |
| `100.64.0.0/10` | 4.2 M | shared (CGNAT)[^5] | no | your phone on 4G/5G, behind the carrier's NAT |
| `127.0.0.0/8` | 16.8 M | loopback | no | `localhost` — the machine itself |
| `169.254.0.0/16` | 65 536 | link-local | no | `169.254.169.254`: the cloud metadata service (credentials!) |
| `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24` | 256 each | documentation[^2] | no (reserved) | the "public" addresses in the examples of this course |
| everything else (unicast) | ≈ 3.7 billion | **public** | **yes** | the load balancer and the NAT gateway of BoxOffice |

The sizes are computed from the prefixes:

```python exec="true"
blocks = [("10.0.0.0/8", 8), ("172.16.0.0/12", 12), ("192.168.0.0/16", 16), ("100.64.0.0/10", 10)]
total = 2 ** 32
print("| Block | Addresses | Share of IPv4 |")
print("|---|---|---|")
for name, prefix in blocks:
    size = 2 ** (32 - prefix)
    print(f"| `{name}` | {size:,} | {size / total:.3%} |".replace(",", " "))
private = sum(2 ** (32 - p) for _, p in blocks[:3])
print(f"| **all RFC 1918** | **{private:,}** | **{private / total:.2%}** |".replace(",", " "))
```

A **public** address is what makes a host reachable *from* the Internet: someone announces its block, so packets to it find a route. A **private** address is reachable only inside its own network and through whatever translates or routes into it. In BoxOffice, only two things have public addresses — the **load balancer** (to receive fans) and the **NAT gateway** (to call the payment provider from a fixed address). Every service, pod and database has only a private one.

!!! warning "Private is about reachability, not trust"

    A private address only says "the Internet has no route to me". Anything inside the network — a compromised pod, a misconfigured peering, an engineer's VPN — can still reach it. That is why the [security groups](../cloud-network/index.md#security-groups) still restrict every port, and why [Zero Trust](../zero-trust/index.md) authenticates every call instead of trusting the network.

---

## NAT: many private hosts behind one public address { #nat }

**NAT** (Network Address Translation) rewrites addresses in the IP header as packets cross a device. The most common form, **source NAT** (also called PAT or masquerading), is what your home router, your mobile carrier and the cloud's NAT gateway do: they replace the private source of every outgoing packet with their own public address and a free port, and write the pair down in a **translation table**.

``` diagram-sim
sequenceDiagram
    autonumber
    participant P as Phone 192.168.0.12
    participant N as Home router (NAT) public 198.51.100.7
    participant S as Server 203.0.113.10
    participant A as Someone on the Internet
    P->>N: src 192.168.0.12:51514 → dst 203.0.113.10:443
    Note over N: table: 192.168.0.12:51514 ⇄ 198.51.100.7:40001
    N->>S: src 198.51.100.7:40001 → dst 203.0.113.10:443
    S-->>N: reply to 198.51.100.7:40001
    Note over N: found in the table → back to 192.168.0.12:51514
    N-->>P: reply delivered
    A->>N: a new connection to 198.51.100.7:22
    Note over N: no entry for port 22 → dropped
```

| Inside (private) | Outside (public) | Remote end |
|---|---|---|
| `192.168.0.12:51514` | `198.51.100.7:40001` | `203.0.113.10:443` |
| `192.168.0.15:49822` | `198.51.100.7:40002` | `203.0.113.10:443` |

Four consequences show up again and again in system design:

1. **Connections start only from inside.** An outside host can reply, but it cannot open a new connection: there is no table entry to tell the NAT where to send it. This is why pods in a private subnet can call the payment provider while nobody on the Internet can call them.
2. **The server sees the NAT, not the client.** Thousands of fans behind one carrier-grade NAT arrive at BoxOffice with the **same IP**. A rate limit per IP would block a whole neighbourhood at 10:00 — the reason [the edge limits per API key or user](../../edge/api-gateway/index.md) and treats per-IP limits as a coarse defence.
3. **A NAT gives a stable egress address.** The pods move between nodes and their IPs change, but everything they send to the Internet leaves with the NAT's fixed public IP — the one BoxOffice registers in the payment provider's allow-list ([cloud networking](../cloud-network/index.md#subnets)).
4. **Destination NAT publishes a private service.** The reverse rewrite — "packets to my public `:443` go to this private host" — is what a load balancer, a cloud internet gateway (1:1 NAT for public IPs) and Docker's `ports: "80:80"` do.

A NAT also has a **capacity**: each connection to the same destination needs its own public port, and a public address has at most 65 535 of them. An AWS NAT gateway supports up to 55 000 simultaneous connections to each unique destination[^6] — a real limit when hundreds of pods call the same payment API during an on-sale.

---

## Subnets and the gateway { #subnets }

A host does not route packets the way the Internet core does. Its network configuration has only three numbers — **its address**, **its prefix** and **its default gateway** (plus a DNS server) — and it makes one decision for every packet:

``` diagram-sim
flowchart TD
    A["packet to dst"] --> B{"is dst inside<br/>my subnet (address/prefix)?"}
    B -->|"yes"| C["find dst's MAC (ARP)<br/>and send it directly"]
    B -->|"no"| D["send it to the default gateway<br/>(the router of the subnet)"]
    D --> E["the router looks up its route table:<br/>longest prefix match → next hop"]
    E --> F["…until a router delivers it<br/>inside dst's subnet"]
```

A **subnet** is therefore a block of addresses whose hosts talk to each other directly; anything else goes through a router. Designs cut the address space into subnets for three reasons:

- **Placement**: in the cloud a subnet lives in one availability zone, so a subnet per zone lets you spread replicas and lose a zone without losing a service.
- **Routing policy**: each subnet has a route table, and the route table is what makes it **public** (a route to an internet gateway), **private** (a route to a NAT) or **isolated** (no route out).
- **Blast radius and rules**: firewalls and flow logs are attached per subnet; a mistake in one tier does not open the others.

A **route table** is a list of `destination block → target`. Every table in a VPC has the `local` route for the VPC's own block; the rest decides the tier:

| Route table | `10.20.0.0/16` | `0.0.0.0/0` | The subnet is… |
|---|---|---|---|
| `rt-public` | local | internet gateway | **public**: resources with a public IP talk to the Internet both ways |
| `rt-private` | local | NAT gateway | **private**: outbound only, through the NAT |
| `rt-data` | local | — | **isolated**: no way in or out |

When a packet to `10.20.8.10` leaves a private subnet, both routes "contain" it (`0.0.0.0/0` contains everything), and the **longest prefix wins**: `/16` beats `/0`, so it stays inside the VPC.

---

## The packet walk: the BoxOffice VPC { #packet-walk }

Now put the pieces together. The simulator below is a small version of the BoxOffice network (one availability zone): a **public** subnet with the load balancer and the NAT gateway, a **private** subnet with the `order` and `payment` pods, and an **isolated** subnet with PostgreSQL. Each step shows where the packet is, its source and destination (the fields that just changed are highlighted), the route table or security group consulted, and the row that matched.

<div class="netsim" data-tool="packet" data-scenario="fan-site"></div>

**Try it:**

1. **A fan opens the site.** Count the address rewrites: the home router changes the *source* (private → public), the internet gateway changes the *destination* (public → the load balancer's private address). Then the load balancer opens a **second** connection, inside the VPC, to `order`.
2. **payment calls the provider.** The pod's private address `10.20.40.17` is rewritten twice on the way out (NAT, then internet gateway); the provider sees only `203.0.113.20` and finds it in its allow-list. Follow the reply back through the NAT table.
3. **A fan tries a pod directly.** The packet never reaches BoxOffice: no Internet router has a route to a private address.
4. **Break the network.** Untick *route 0.0.0.0/0 → NAT* and rerun scenario 2; untick *sg-data accepts 5432* and run *order queries PostgreSQL*; untick *the load balancer has a public IP* and run scenario 1. Each switch is a real misconfiguration that has taken sites down.
5. **Scanners.** Try port 5432 on the NAT's IP and on the load balancer's IP: one is dropped by the NAT (no translation), the other by a security group.

??? question "What should you have seen? (open after trying)"

    - The pods never know any public address: translations happen at the edges (home router, internet gateway, NAT gateway), and the reply is translated back by the same devices.
    - The **route table** decides whether a packet *can* leave a subnet; the **security group** decides whether the destination *accepts* it; the **NAT table** decides whether an inbound packet is a reply or a stranger.
    - A dropped packet produces **no error message**: the sender waits for its timeout. "Connection timed out" usually means a route or a firewall; "connection refused" means the host was reached and nothing listens on the port.

!!! example "In the BoxOffice code: a private network on your laptop (lab 3)"

    [Hands-on 3](../../../hands-on/3/index.md) already has the shape of the cloud network. Docker Compose creates a **private bridge network** for the project (in the lab's logs, `172.18.0.0/16`, an RFC 1918 block). The three `catalog` replicas have **no `ports:`** — like pods in a private subnet, they are reachable only from inside that network, by name, through Docker's DNS. Only `edge` publishes `80:80`: a **destination NAT** from your machine's port 80 to the Nginx container, the laptop's version of a load balancer with a public IP.

    ``` { .yaml title="docker-compose.yaml (the private replicas and the published edge)" }
    --8<-- "docs/2027.1/hands-on/3/code/docker-compose.yaml:47:67"
    ```

    Nginx resolves the replicas' names with Docker's internal DNS server (`127.0.0.11`) and balances over their private addresses. In the lab's access log every request arrives **from `172.18.0.1`** — the bridge's gateway, not your browser: the server sees the NAT, exactly as the payment provider sees BoxOffice's NAT gateway.

    ``` { .nginx title="infra/nginx/nginx.conf (names → private addresses)" }
    --8<-- "docs/2027.1/hands-on/3/code/infra/nginx/nginx.conf:17:24"
    ```

!!! example "In the BoxOffice code: pods, nodes and one published port (lab 10)"

    In [Hands-on 10](../../../hands-on/10/index.md) the kind cluster has three nodes, each a container with a private address; every pod gets its own private address from the pod network (kind's default `10.244.0.0/16`), and Services get virtual addresses from another private block. The only way in from your machine is `extraPortMappings`: host port 80 → the Ingress controller's NodePort `30080` — once more a destination NAT, playing the role of the internet gateway in front of the load balancer.

    ``` { .yaml title="k8s/kind.yaml" }
    --8<-- "docs/2027.1/hands-on/10/code/k8s/kind.yaml"
    ```

---

## IPv6 in one paragraph { #ipv6 }

IPv6 addresses have **128 bits** (2¹²⁸ ≈ 3.4 × 10³⁸), written in hexadecimal groups such as `2001:db8:20::17`. There are enough for every device to have a **globally routable** address, so IPv6 networks normally use **no NAT** — which means that with IPv6 a pod *could* be reachable from the Internet, and only the route tables and firewalls (security groups) decide whether it is. Clouds and carriers run **dual-stack** (IPv4 and IPv6 side by side), and public IPv4 has become a priced resource: since February 2024 AWS charges for every public IPv4 address, in use or not[^7]. The design ideas of this page — subnets, route tables, longest prefix match, firewalls — are the same in IPv6.

---

!!! tip "In the interview"

    You will rarely be asked to compute a subnet mask, but you will be asked "how does the Internet reach your service, and how does your service call the outside?". Answer in one breath: "fans resolve the name to the **public** IP of the load balancer; everything behind it has **private** addresses in private subnets; outbound calls to the payment provider leave through a **NAT gateway per AZ** with a fixed IP the provider allow-lists; the database subnet has **no route** to the Internet." Then, if there is time, mention that per-IP rate limits are unfair behind carrier NAT.

!!! success "Best practices"

    - **Give public addresses only to what must be reached from the Internet** — in BoxOffice, the load balancer and the NAT gateway; services, pods and databases get private addresses only (the [packet walk](#packet-walk) shows why nothing else is reachable).
    - **Pick private blocks that will never overlap** — one plan for every VPC, office and cluster (VPC `10.20.0.0/16`, pods and Services from blocks reserved in the same plan), so peering and VPNs stay possible later.
    - **Make the route table state the tier**: public subnets route `0.0.0.0/0` to the internet gateway, private subnets to a NAT in the same zone, data subnets nowhere — and review any change to a default route like a code change.
    - **Size subnets for the peak with headroom**, not for today: count nodes, pod IPs and the 5 reserved addresses (a `/24` has 251 usable in AWS; it runs out at the first big scale-out).
    - **Never rely on the client IP alone** — behind carrier-grade NAT thousands of fans share one address; limit per API key or user, and use per-IP limits only as a coarse shield against floods.
    - **Watch NAT capacity on hot destinations** — reuse connections (keep-alive, connection pools) to the payment provider instead of opening one per request, and alert on port-allocation errors.

!!! warning "Common pitfalls"

    - **"It has a private IP, so it is safe"** — a private address limits who can route to it, not who is allowed in; compromised neighbours, peerings and VPNs are inside.
    - **Allow-listing a pod's or node's IP at a partner** — those addresses change at every reschedule; allow-list the NAT's fixed public IP.
    - **Confusing "timeout" with "refused"** — a timeout points to a route, a security group or a NAT; a refusal means the host was reached and nothing listens on that port.
    - **Overlapping `10.0.0.0/16` everywhere** — the default in many templates, and the reason two teams cannot connect their networks.
    - **Exposing `169.254.169.254` to untrusted requests** — a server-side request forgery that reaches the metadata service can steal the machine's cloud credentials (require the token-based metadata API).

---

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    L["layers: frame, packet,<br/>segment, request"] --> IP["IP address:<br/>network + host bits (CIDR)"]
    IP --> PP["public vs private<br/>(RFC 1918, CGNAT)"]
    PP --> NAT["NAT: shared public address,<br/>stable egress IP"]
    NAT --> RL["per-IP limits are unfair<br/>→ Edge: rate limiting"]
    IP --> SUB["subnets + default gateway"]
    SUB --> RT["route tables:<br/>longest prefix match"]
    RT --> VPC["public / private / isolated<br/>→ Cloud networking"]
    BGP["BGP: networks announce prefixes"] --> RT
    PP --> ZT["private ≠ trusted<br/>→ Zero Trust"]
    VPC --> SG["security groups<br/>→ Cloud networking"]
```

**Palette components:** [`vpc`](../../../reference/components/network/index.md#vpc) · [`subnet`](../../../reference/components/network/index.md#subnet) · [`nat`](../../../reference/components/network/index.md#nat) · [`lb`](../../../reference/components/edge/index.md#lb) (the only public address that receives traffic) · [`dns`](../../../reference/components/edge/index.md#dns) (the name that leads to it). **Continues in:** [Cloud networking](../cloud-network/index.md) (the BoxOffice VPC, security groups, endpoints), [Edge — the request's journey](../../edge/index.md#the-request-journey) and [rate limiting](../../edge/api-gateway/index.md), [Zero Trust](../zero-trust/index.md), [Hands-on 3](../../../hands-on/3/index.md) and [Hands-on 10](../../../hands-on/10/index.md).

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - A request travels as an IP packet; **routers read only the destination IP** and forward it by **longest prefix match**, hop by hop; networks announce their blocks with **BGP**.
    - An IPv4 address has a **network part and a host part**; `/n` fixes the first *n* bits, the block has 2³²⁻ⁿ addresses, and each extra bit halves it.
    - **Private** blocks (RFC 1918) are reused everywhere and never routed on the Internet; **public** addresses are unique and announced. Private means unreachable from outside, not trusted.
    - **NAT** lets private hosts share a public address: connections start only from inside, servers see the NAT's IP, and the NAT gives a stable egress address for allow-lists.
    - A host sends directly inside its **subnet** and to the **default gateway** otherwise; a subnet's **route table** makes it public, private or isolated.

---

[^1]: REKHTER, Y.; LI, T.; HARES, S. [RFC 4271 — A Border Gateway Protocol 4 (BGP-4)](https://datatracker.ietf.org/doc/html/rfc4271){target="_blank"}. IETF, 2006. For the whole picture: KUROSE, J.; ROSS, K. *Computer Networking: A Top-Down Approach*, 8th ed. Pearson, 2021, chapters 4 and 5.
[^2]: ARKKO, J.; COTTON, M.; VEGODA, L. [RFC 5737 — IPv4 Address Blocks Reserved for Documentation](https://datatracker.ietf.org/doc/html/rfc5737){target="_blank"}. IETF, 2010. The "public" addresses of this course come from these blocks, so they never belong to a real host.
[^3]: FULLER, V.; LI, T. [RFC 4632 — Classless Inter-domain Routing (CIDR)](https://datatracker.ietf.org/doc/html/rfc4632){target="_blank"}. IETF, 2006.
[^4]: REKHTER, Y. et al. [RFC 1918 — Address Allocation for Private Internets](https://datatracker.ietf.org/doc/html/rfc1918){target="_blank"}. IETF, 1996.
[^5]: WEIL, J. et al. [RFC 6598 — IANA-Reserved IPv4 Prefix for Shared Address Space](https://datatracker.ietf.org/doc/html/rfc6598){target="_blank"}. IETF, 2012.
[^6]: AMAZON WEB SERVICES. [NAT gateways — Amazon VPC User Guide](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html){target="_blank"}.
[^7]: AMAZON WEB SERVICES. [New — AWS Public IPv4 Address Charge](https://aws.amazon.com/blogs/aws/new-aws-public-ipv4-address-charge-public-ip-insights/){target="_blank"}. AWS News Blog, 2023.
