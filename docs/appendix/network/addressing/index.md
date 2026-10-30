
Every packet carries a source and a destination **IP address**, and almost every networking problem in this course comes down to one question: *can this address be reached from where the packet starts?* A container talks to `db` at `172.18.0.3`, a pod gets a `10.x` address from the cluster, a cloud database lives in a private subnet, and your laptop shares one public address with everyone at home. This page explains how addresses are written (IPv4, IPv6, CIDR), which ranges are public and which are private, how NAT lets a private network reach the internet, and how Docker builds on all of it.

---

## IP addresses { #ip }

Every device on a network is identified by an **IP address** — a number that tells routers where to deliver packets. IP addresses have two parts: a **network prefix** (identifies the network) and a **host identifier** (identifies the specific device within that network).

### IPv4 { #ipv4 }

IPv4 uses **32-bit** addresses written in dotted-decimal notation — four octets separated by dots[^1]:

```
192  . 168  .   1  .  42
 ↑       ↑      ↑      ↑
8 bits  8 bits 8 bits  8 bits   →  total 32 bits
```

IPv4 provides 2³² ≈ **4.3 billion** unique addresses. This seemed enormous in 1981 — it was not. The growth of the internet, smartphones, IoT devices, and cloud servers exhausted the pool: IANA handed its last free blocks to the five Regional Internet Registries in February 2011, and the registries ran out in the following years (APNIC in 2011, ARIN in 2015, RIPE NCC in 2019)[^2]. New IPv4 addresses are now bought, leased or shared through NAT.

### CIDR blocks { #cidr }

**CIDR notation** (Classless Inter-Domain Routing) appends a prefix length to an address to describe a whole range: `192.168.1.0/24` means the first 24 bits identify the network, leaving 8 bits for hosts — 2⁸ = 256 addresses (`192.168.1.0` through `192.168.1.255`). In general a `/p` block has 2³²⁻ᵖ addresses: each bit added to the prefix halves the block.

Two addresses of a classic network are not given to hosts: the first (the network itself) and the last (broadcast). Clouds keep a few more — an AWS subnet reserves 5. That is why a `/24` gives 254 usable hosts on a home network but 251 in an AWS subnet.

Explore a block: type an address, drag the prefix, split the block into subnets, and test whether an address falls inside.

<div class="netsim" data-tool="cidr" data-cidr="192.168.1.0/24"></div>

!!! tip "Try it"
    The explorer starts with `192.168.1.0/24`, a typical home network: 24 network bits and 8 host bits give 256 addresses, of which 254 are usable (`192.168.1.1 – 192.168.1.254`); the **kind of address** line says it is private, inside `192.168.0.0/16`. Drag the prefix to `/16`: the block becomes `192.168.0.0/16`, with 65,536 addresses. Back at `/24`, choose **Split into 4 subnets**: you get four `/26` blocks of 64 addresses (`192.168.1.0/26`, `192.168.1.64/26`, `192.168.1.128/26`, `192.168.1.192/26`); test `192.168.1.130` and the explorer places it in `192.168.1.128/26`. Finally type `172.17.0.0/16`, Docker's default bridge network: private, inside `172.16.0.0/12`.

### IPv6 { #ipv6 }

IPv6 uses **128-bit** addresses written in eight groups of four hexadecimal digits:

```
2001:0db8:85a3:0000:0000:8a2e:0370:7334
```

Leading zeros in a group can be dropped, and one run of all-zero groups can be compressed to `::` — `2001:db8:85a3::8a2e:370:7334`.

IPv6 provides 2¹²⁸ ≈ **3.4 × 10³⁸** addresses — enough for every grain of sand on Earth to have its own address. Yet IPv4 is still everywhere, because the transition requires updating every network device, operating system, and application, and most networks run both protocols side by side (*dual stack*).

| | IPv4 | IPv6 |
|---|---|---|
| **Address size** | 32 bits | 128 bits |
| **Notation** | Dotted decimal (`192.168.1.1`) | Hexadecimal groups (`2001:db8::1`) |
| **Address space** | ~4.3 billion | ~3.4 × 10³⁸ |
| **NAT required?** | Yes — address exhaustion forces it | No — every device can have a global unicast address |
| **Adoption** | Universal | About half of Google's users reach it over IPv6 (around 45–50%, depending on the day)[^3] |

---

## Public and private addresses { #private }

A **public address** is unique in the whole internet and routed by it (see [the overview](../index.md#public-internet)). A **private network** is a network that is not directly reachable from the public internet[^4]. Devices within it communicate freely with each other, but external hosts cannot initiate connections to private addresses.

### RFC 1918 private ranges { #rfc1918 }

Three IPv4 address ranges are permanently reserved for private use[^5]. Any network may reuse them, and the public internet never routes them:

| Range (CIDR) | Addresses | Typical use |
|---|---|---|
| `10.0.0.0/8` | 16,777,216 | Large corporate networks, cloud VPCs (AWS, GCP), Kubernetes pod networks |
| `172.16.0.0/12` | 1,048,576 | Medium-sized networks, Docker (default bridge `172.17.0.0/16`) |
| `192.168.0.0/16` | 65,536 | Home routers, small office networks |

Because everyone reuses the same ranges, a private address means nothing outside its own network: `192.168.1.10` is a different machine in every home. To reach the internet, a private network needs NAT.

---

## NAT — Network Address Translation { #nat }

NAT allows an entire private network to share a single public IP address. The NAT device (a home router, a firewall, a cloud NAT gateway) rewrites the private source of each outgoing packet with its own public address and a free port, and writes the pair down in a **translation table**. When the reply comes back to that public port, the table tells it which private host to deliver to.

``` diagram-sim
sequenceDiagram
    participant D as Device<br/>192.168.1.10
    participant N as NAT router<br/>public 203.0.113.7
    participant S as Server<br/>198.51.100.20:443
    participant X as Stranger<br/>192.0.2.66
    D->>N: src 192.168.1.10:52241 → dst 198.51.100.20:443
    Note over N: new row: 192.168.1.10:52241 ⇄ 203.0.113.7:40001
    N->>S: src 203.0.113.7:40001 → dst 198.51.100.20:443
    S-->>N: src 198.51.100.20:443 → dst 203.0.113.7:40001
    Note over N: row for :40001 found → back to 192.168.1.10:52241
    N-->>D: src 198.51.100.20:443 → dst 192.168.1.10:52241
    X->>N: new connection to 203.0.113.7:22
    Note over N: no row for :22 → dropped
```

The server never sees the device's private address — only the router's public IP. Several consequences follow:

- **Connections start only from inside.** A reply finds its row in the table; a packet that nobody inside asked for has no row, so the router cannot know which private host should get it and drops it. Many home routers also check the source: a row only accepts packets from the remote end it was created for.
- **Port forwarding publishes a service.** To accept connections from outside, you add a static rule — "packets to public port 8080 go to `192.168.1.20:8080`". This reverse rewrite is *destination NAT*; Docker's `ports:` does exactly this on the host.
- **Rows expire.** A NAT cannot keep a row forever, so it deletes rows that stay idle. The standards set minimums: at least 2 minutes for UDP (5 recommended)[^6] and at least 2 hours 4 minutes for an established TCP connection[^7]. Long-lived idle connections (a database pool, a WebSocket) send keep-alives so the row survives.
- **Many clients, one address.** The server sees everyone behind a NAT as the same IP. Mobile carriers even run *carrier-grade NAT* from the shared range `100.64.0.0/10`[^8], so thousands of phones may share one public address — which is why rate limits per IP are a blunt tool.

Try it: open connections, let the server reply, and watch a stranger fail to get in.

<div class="csim" data-sim="nat" data-timeout="60"></div>

!!! tip "Try it"
    Press **laptop → HTTPS**: the router writes the row `192.168.1.10:52241` ⇄ `203.0.113.7:40001`. Press **server replies**: the reply to port 40001 is translated back to the laptop. Press **phone → HTTPS**: a second row, `192.168.1.11:54584` ⇄ `203.0.113.7:40002` — same public address, told apart only by the port. Now press **stranger → :8080**: no row, dropped. **Stranger → newest row's port** fails too: the row for 40002 only accepts `198.51.100.20:443`. Turn on the port forward and try the stranger on 8080 again: it now reaches `192.168.1.20:8080`. Finally press play: each step is 5 s, and with the 60 s idle timeout the rows disappear after 12 steps; a server reply after that is dropped.

---

## Private networks in Docker { #docker }

Docker uses the private network model to isolate containers. Each Compose project gets its own virtual network (`<project>_default`) — a software-defined subnet, typically in the `172.x.x.x` range. Containers on it reach each other by service name, through Docker's embedded DNS server[^9] ([DNS](../dns/index.md#docker-kubernetes)).

``` diagram
flowchart LR
    subgraph host ["Docker host — public 203.0.113.1"]
        subgraph net ["Docker network 172.20.0.0/16"]
            nginx["nginx<br/>172.20.0.2:80"]
            gateway["gateway<br/>172.20.0.3:8080"]
            db["postgres<br/>172.20.0.4:5432"]
            nginx --> gateway
            gateway --> db
        end
    end
    internet["Internet"] -->|"port 80<br/>published"| nginx
    internet -.-x|"no direct access"| gateway
    internet -.-x|"no direct access"| db
```

```yaml
services:
  nginx:
    image: nginx:1.27
    ports:
      - "80:80"          # host port 80 → container port 80 (published)
  gateway:
    build: ./gateway     # no ports: reachable only inside the network
  db:
    image: postgres:17   # no ports: reachable only inside the network
```

Only `nginx` has a `ports:` mapping in `compose.yaml` and is reachable from outside the host. `gateway` and `db` are inside the private Docker network — they communicate with each other by service name but are invisible to the internet. The two directions are both NAT on the host: a published port is destination NAT (host `:80` → `172.20.0.2:80`), and a container calling the internet leaves through source NAT (masquerading), with the host's address as source. On Linux, Docker sets both up with iptables rules[^10].

---

## Special and reserved addresses { #special }

### Loopback { #loopback }

`127.0.0.0/8` — packets sent to this range never leave the host. `127.0.0.1` (`localhost`) is the conventional address for testing local servers. The operating system short-circuits loopback traffic in the kernel, never touching network hardware. Inside a container, `localhost` is the container itself, not your machine: a service in Compose must call `db:5432`, not `localhost:5432`.

### Link-local (APIPA) { #link-local }

`169.254.0.0/16` — automatically assigned when a device cannot reach a DHCP server. These addresses only work for direct communication between two devices on the same physical link. Seeing `169.254.x.x` on a machine almost always means DHCP has failed. Clouds also use one of them on purpose: `169.254.169.254` is the instance metadata service, reachable only from inside the virtual machine.

### Reserved IPv4 addresses { #reserved }

The blocks below have special meanings and are never assigned as ordinary public addresses[^11]:

| Address block (CIDR) | Address range | Addresses | Scope | Description |
|---|---|---|---|---|
| `0.0.0.0/8` | 0.0.0.0 – 0.255.255.255 | 16,777,216 | Software | Current (local, "this") network |
| `10.0.0.0/8` | 10.0.0.0 – 10.255.255.255 | 16,777,216 | Private | RFC 1918 private range |
| `100.64.0.0/10` | 100.64.0.0 – 100.127.255.255 | 4,194,304 | Shared | Carrier-grade NAT (ISP internal) |
| `127.0.0.0/8` | 127.0.0.0 – 127.255.255.255 | 16,777,216 | Host | Loopback — stays on local host |
| `169.254.0.0/16` | 169.254.0.0 – 169.254.255.255 | 65,536 | Subnet | Link-local / APIPA (DHCP failure), cloud metadata |
| `172.16.0.0/12` | 172.16.0.0 – 172.31.255.255 | 1,048,576 | Private | RFC 1918 private range |
| `192.0.2.0/24` | 192.0.2.0 – 192.0.2.255 | 256 | Documentation | TEST-NET-1 |
| `192.168.0.0/16` | 192.168.0.0 – 192.168.255.255 | 65,536 | Private | RFC 1918 private range |
| `198.18.0.0/15` | 198.18.0.0 – 198.19.255.255 | 131,072 | Private | Benchmark testing |
| `198.51.100.0/24` | 198.51.100.0 – 198.51.100.255 | 256 | Documentation | TEST-NET-2 |
| `203.0.113.0/24` | 203.0.113.0 – 203.0.113.255 | 256 | Documentation | TEST-NET-3 |
| `224.0.0.0/4` | 224.0.0.0 – 239.255.255.255 | 268,435,456 | Internet | Multicast |
| `240.0.0.0/4` | 240.0.0.0 – 255.255.255.254 | 268,435,455 | Internet | Reserved for future use (former class E) |
| `255.255.255.255/32` | 255.255.255.255 | 1 | Subnet | Limited broadcast |

The three documentation blocks are the ones to use in examples, slides and tests — like every address on this page that is not private.

---

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - An IPv4 address has 32 bits; a CIDR block `/p` fixes the first p bits and holds 2³²⁻ᵖ addresses — each extra prefix bit halves it.
    - IPv4 ran out; IPv6 has 128-bit addresses and about half of Google's users now reach it over IPv6, but most networks run both.
    - `10.0.0.0/8`, `172.16.0.0/12` and `192.168.0.0/16` are private (RFC 1918): reusable anywhere, never routed on the internet.
    - NAT rewrites private ip:port to public ip:port and remembers the pair; replies are translated back, unsolicited packets are dropped, and idle rows expire.
    - Publishing a service from a private network takes a port-forward (destination NAT) — Docker's `ports:` — while everything else stays unreachable from outside.

---

[^1]: [RFC 791 — Internet Protocol](https://datatracker.ietf.org/doc/html/rfc791){target="_blank"}
[^2]: [IPv4 address exhaustion — Wikipedia](https://en.wikipedia.org/wiki/IPv4_address_exhaustion){target="_blank"}; [IANA IPv4 Address Space Registry](https://www.iana.org/assignments/ipv4-address-space/ipv4-address-space.xhtml){target="_blank"}
[^3]: [IPv6 Adoption — Google](https://www.google.com/intl/en/ipv6/statistics.html){target="_blank"} (live statistics; it first passed 50% on 28 March 2026, per [Internet Society Pulse](https://pulse.internetsociety.org/blog/18-years-later-ipv6-reaches-majority){target="_blank"})
[^4]: [Private Network — Wikipedia](https://en.wikipedia.org/wiki/Private_network){target="_blank"}
[^5]: [RFC 1918 — Address Allocation for Private Internets](https://datatracker.ietf.org/doc/html/rfc1918){target="_blank"}
[^6]: [RFC 4787 — NAT Behavioral Requirements for Unicast UDP](https://datatracker.ietf.org/doc/html/rfc4787){target="_blank"}, REQ-5
[^7]: [RFC 5382 — NAT Behavioral Requirements for TCP](https://datatracker.ietf.org/doc/html/rfc5382){target="_blank"}, REQ-5
[^8]: [RFC 6598 — IANA-Reserved IPv4 Prefix for Shared Address Space](https://datatracker.ietf.org/doc/html/rfc6598){target="_blank"}
[^9]: [Networking overview — Docker Docs](https://docs.docker.com/engine/network/){target="_blank"}
[^10]: [Docker with iptables — Docker Docs](https://docs.docker.com/engine/network/firewall-iptables/){target="_blank"}
[^11]: [List of reserved IP addresses — Wikipedia](https://en.wikipedia.org/wiki/List_of_reserved_IP_addresses){target="_blank"}
