
The **internet** is a global network of networks — a web of interconnected computers, routers, and data centres that communicate using a common set of standardised protocols. No single organisation owns the internet; it is a collaboration between Internet Service Providers (ISPs), governments, universities, and companies, all agreeing to follow the same rules so their networks can interoperate.

Data travels across the internet as **packets** — small, fixed-size chunks. A file or web page is split into many packets, each routed independently across the network and reassembled at the destination. This *packet-switched* model is resilient: if one route is congested or broken, packets find an alternative path.

---

## TCP/IP Protocol Stack

The internet is built on a layered architecture. Each layer solves a specific problem and relies on the layer below it. The **TCP/IP model** has four layers:

| Layer | Protocols | Responsibility |
|---|---|---|
| **Application** | HTTP, HTTPS, DNS, SMTP, SSH | Defines how applications exchange data |
| **Transport** | TCP, UDP | Delivers data between processes on two hosts (ports) |
| **Internet** | IP (IPv4, IPv6), ICMP | Routes packets from source to destination across networks |
| **Link** | Ethernet, Wi-Fi, ARP | Moves frames between devices on the same local network |

``` mermaid
flowchart TB
    subgraph client [Client]
        direction TB
        ca[Application\nHTTP GET /]
        ct[Transport\nTCP segment]
        ci[Internet\nIP packet]
        cl[Link\nEthernet frame]
        ca --> ct --> ci --> cl
    end
    subgraph server [Server]
        direction BT
        sa[Application\nHTTP 200 OK]
        st[Transport\nTCP segment]
        si[Internet\nIP packet]
        sl[Link\nEthernet frame]
        sl --> si --> st --> sa
    end
    cl -->|"physical medium\n(cable / Wi-Fi / fibre)"| sl
```

When you open `https://example.com`, the browser hands an HTTP request to the Application layer, TCP wraps it in a segment with source and destination **ports**, IP wraps that in a packet with source and destination **IP addresses**, and Ethernet frames it for the local network. Each router along the way strips and re-adds the Link layer frame, using the IP layer to decide the next hop.

---

## IP Addresses

Every device on a network is identified by an **IP address** — a number that tells routers where to deliver packets. IP addresses have two parts: a **network prefix** (identifies the network) and a **host identifier** (identifies the specific device within that network).

### IPv4

IPv4 uses **32-bit** addresses written in dotted-decimal notation — four octets separated by dots:

```
192  . 168  .   1  .  42
 ↑       ↑      ↑      ↑
8 bits  8 bits 8 bits  8 bits   →  total 32 bits
```

**CIDR notation** (Classless Inter-Domain Routing) appends a prefix length to express a range: `192.168.1.0/24` means the first 24 bits identify the network, leaving 8 bits for hosts — 256 addresses (`192.168.1.0` through `192.168.1.255`).

IPv4 provides 2³² ≈ **4.3 billion** unique addresses. This seemed enormous in 1981 — it was not. The explosive growth of the internet, smartphones, IoT devices, and cloud servers exhausted the global IPv4 pool. Regional registries issued their last unallocated blocks between 2011 and 2019[^7].

### IPv6

IPv6 uses **128-bit** addresses written in eight groups of four hexadecimal digits:

```
2001:0db8:85a3:0000:0000:8a2e:0370:7334
```

Consecutive groups of zeros can be compressed: `2001:db8:85a3::8a2e:370:7334`.

IPv6 provides 2¹²⁸ ≈ **3.4 × 10³⁸** addresses — enough for every grain of sand on Earth to have its own address. Despite this, IPv4 remains dominant because the transition requires updating every network device, operating system, and application.

| | IPv4 | IPv6 |
|---|---|---|
| **Address size** | 32 bits | 128 bits |
| **Notation** | Dotted decimal (`192.168.1.1`) | Hexadecimal groups (`2001:db8::1`) |
| **Address space** | ~4.3 billion | ~3.4 × 10³⁸ |
| **NAT required?** | Yes — address exhaustion forces it | No — every device can have a global unicast address |
| **Adoption** | ~70% of traffic | ~40% and growing |

---

## DNS — Domain Name System

Humans remember names; computers route packets using IP addresses. **DNS** is the distributed database that translates domain names into IP addresses[^8].

``` mermaid
sequenceDiagram
    participant B as Browser
    participant R as Recursive Resolver\n(ISP / 8.8.8.8)
    participant Rt as Root Nameserver
    participant T as TLD Nameserver\n(.com)
    participant A as Authoritative NS\n(example.com)

    B->>R: What is the IP of example.com?
    R->>Rt: Who handles .com?
    Rt-->>R: TLD NS address
    R->>T: Who handles example.com?
    T-->>R: Authoritative NS address
    R->>A: What is the IP of example.com?
    A-->>R: 93.184.216.34  (TTL: 3600s)
    R-->>B: 93.184.216.34  (cached for TTL)
```

The resolver caches the answer for the TTL (Time to Live) duration, so most lookups resolve in milliseconds from cache.

### Common DNS record types

| Record | Purpose | Example |
|---|---|---|
| **A** | Maps a name to an IPv4 address | `example.com → 93.184.216.34` |
| **AAAA** | Maps a name to an IPv6 address | `example.com → 2606:2800:220:1::93` |
| **CNAME** | Alias pointing to another name | `www.example.com → example.com` |
| **MX** | Mail server for a domain | `example.com → mail.example.com` |
| **TXT** | Arbitrary text (SPF, DKIM, ownership verification) | `"v=spf1 include:_spf.google.com ~all"` |

---

## Ports

An IP address identifies a **host**; a **port** identifies a specific **process** on that host. Together, `IP:port` (called a *socket address*) uniquely identifies a communication endpoint on the network.

Ports are 16-bit numbers (0–65535) divided into three ranges:

| Range | Name | Use |
|---|---|---|
| 0–1023 | Well-known ports | Reserved for standard services; require root to bind |
| 1024–49151 | Registered ports | Registered with IANA for common applications |
| 49152–65535 | Ephemeral ports | Dynamically assigned to clients for outbound connections |

### Well-known ports

| Port | Protocol | Service |
|---|---|---|
| 22 | TCP | SSH (secure shell) |
| 25 | TCP | SMTP (email sending) |
| 53 | TCP/UDP | DNS |
| 80 | TCP | HTTP |
| 443 | TCP | HTTPS |
| 3306 | TCP | MySQL |
| 5432 | TCP | PostgreSQL |
| 6379 | TCP | Redis |
| 8080 | TCP | HTTP (development servers, alternative HTTP) |
| 9090 | TCP | Prometheus |
| 3000 | TCP | Grafana / Node.js development |

When a browser connects to `https://example.com`, it connects to `93.184.216.34:443`. The operating system assigns an ephemeral port (e.g., `52413`) on the client side, so the full connection is `client_ip:52413 ↔ 93.184.216.34:443`.

---

## Transport Protocols

The Transport layer offers two fundamentally different delivery models:

=== "TCP — Transmission Control Protocol"

    TCP establishes a **connection** before exchanging data and guarantees that:

    - Every byte is delivered exactly once, in order
    - Lost packets are automatically retransmitted
    - The sender slows down if the receiver is overwhelmed (flow control)

    Connection setup uses a **three-way handshake**:

    ``` mermaid
    sequenceDiagram
        participant C as Client
        participant S as Server
        C->>S: SYN (sequence number = x)
        S-->>C: SYN-ACK (sequence = y, ack = x+1)
        C->>S: ACK (ack = y+1)
        Note over C,S: Connection established — data transfer begins
    ```

    **Use when:** correctness matters more than speed — HTTP, HTTPS, database connections, SSH.

=== "UDP — User Datagram Protocol"

    UDP sends **datagrams** with no connection setup, no delivery guarantee, and no ordering.

    - No handshake — lower latency
    - No retransmission — if a packet is lost, it is gone
    - Application must handle ordering and reliability if needed

    **Use when:** speed matters more than completeness — DNS queries, video streaming, online gaming, VoIP.

| | TCP | UDP |
|---|---|---|
| **Connection** | Required (3-way handshake) | None |
| **Delivery guarantee** | Yes — retransmits lost packets | No |
| **Ordering** | Yes — bytes arrive in sequence | No |
| **Speed** | Slower (overhead of reliability) | Faster |
| **Use cases** | HTTP, HTTPS, SSH, databases | DNS, video, VoIP, gaming |

---

## Public Networks

A **public IP address** is a globally unique address assigned by a Regional Internet Registry (RIR) and routable on the internet. Any server you want to reach from the public internet must have a public IP — or be reachable through one via NAT.

Packets cross the internet by hopping between routers. Each router knows only the *next hop* toward the destination — a partial map stored in a **routing table**. The **BGP (Border Gateway Protocol)** is the inter-domain routing protocol that lets ISPs exchange these maps and collectively know how to reach every public address block on the internet[^9].

``` mermaid
flowchart LR
    client["Client\n203.0.113.5"]
    r1["ISP Router\nBrazil"]
    r2["Backbone\nRouter"]
    r3["ISP Router\nUSA"]
    server["Server\n93.184.216.34\nexample.com"]

    client -->|"hop 1"| r1
    r1 -->|"hop 2"| r2
    r2 -->|"hop 3"| r3
    r3 -->|"hop 4"| server
```

Each hop takes 1–30 ms depending on physical distance and congestion. A transatlantic round-trip typically adds 80–120 ms of latency just from the speed of light in fibre.

---

## Private Networks

A **private network** is a network that is not directly reachable from the public internet. Devices within it communicate freely with each other, but external hosts cannot initiate connections to private addresses.

### RFC 1918 private ranges

Three IPv4 address ranges are permanently reserved for private use[^2]. No public internet routing is ever established for them:

| Range (CIDR) | Addresses | Typical use |
|---|---|---|
| `10.0.0.0/8` | ~16.7 million | Large corporate networks, cloud VPCs (AWS, GCP) |
| `172.16.0.0/12` | ~1 million | Medium-sized networks, Docker default bridge (`172.17.0.0/16`) |
| `192.168.0.0/16` | 65,536 | Home routers, small office networks |

### NAT — Network Address Translation

NAT allows an entire private network to share a single public IP address. The NAT device (router or firewall) maintains a **translation table** mapping each outbound connection to an ephemeral public port.

``` mermaid
sequenceDiagram
    participant D as Device\n192.168.1.10:52413
    participant N as NAT Router\nPublic: 203.0.113.1
    participant S as Server\n93.184.216.34:443

    D->>N: src=192.168.1.10:52413\ndst=93.184.216.34:443
    Note over N: Record mapping:\n192.168.1.10:52413 ↔ 203.0.113.1:61000
    N->>S: src=203.0.113.1:61000\ndst=93.184.216.34:443
    S-->>N: src=93.184.216.34:443\ndst=203.0.113.1:61000
    Note over N: Look up table:\n61000 → 192.168.1.10:52413
    N-->>D: src=93.184.216.34:443\ndst=192.168.1.10:52413
```

The server never sees the device's private address — it only sees the router's public IP. The router tracks which internal device owns each outbound connection by mapping the ephemeral port.

### Private networks in Docker

Docker uses the private network model to isolate containers. Each Compose project gets its own virtual network — a software-defined subnet, typically in the `172.x.x.x` range.

``` mermaid
flowchart LR
    subgraph host [Docker Host — 203.0.113.1 public]
        subgraph net ["Docker Network 172.20.0.0/16"]
            nginx["nginx\n172.20.0.2:80"]
            gateway["gateway\n172.20.0.3:8080"]
            db["postgres\n172.20.0.4:5432"]
            nginx --> gateway
            gateway --> db
        end
    end
    internet[Internet] -->|"port 80\npublished"| nginx
    internet -.-x|"no direct access"| gateway
    internet -.-x|"no direct access"| db
```

Only `nginx` has a `ports:` mapping in `compose.yaml` and is reachable from outside the host. `gateway` and `db` are inside the private Docker network — they communicate with each other by service name but are invisible to the internet.

---

## Special Addresses

### Loopback

`127.0.0.0/8` — packets sent to this range never leave the host. `127.0.0.1` (`localhost`) is the conventional address for testing local servers. The operating system short-circuits loopback traffic in kernel, never touching network hardware.

### Link-local (APIPA)

`169.254.0.0/16` — automatically assigned when a device cannot reach a DHCP server. These addresses only work for direct communication between two devices on the same physical link. Seeing `169.254.x.x` on a machine almost always means DHCP has failed.

---

## Reserved IPv4 Addresses [^4]

### General Reserved IPv4 Addresses

| Address block (CIDR) | Address range | Addresses | Scope | Description |
|---|---|---|---|---|
| `0.0.0.0/8` | 0.0.0.0 – 0.255.255.255 | 16,777,216 | Software | Current (local, "this") network |
| `10.0.0.0/8` | 10.0.0.0 – 10.255.255.255 | 16,777,216 | Private | RFC 1918 private range |
| `100.64.0.0/10` | 100.64.0.0 – 100.127.255.255 | 4,194,304 | Shared | Carrier-grade NAT (ISP internal) |
| `127.0.0.0/8` | 127.0.0.0 – 127.255.255.255 | 16,777,216 | Host | Loopback — stays on local host |
| `169.254.0.0/16` | 169.254.0.0 – 169.254.255.255 | 65,536 | Subnet | Link-local / APIPA (DHCP failure) |
| `172.16.0.0/12` | 172.16.0.0 – 172.31.255.255 | 1,048,576 | Private | RFC 1918 private range |
| `192.168.0.0/16` | 192.168.0.0 – 192.168.255.255 | 65,536 | Private | RFC 1918 private range |
| `198.18.0.0/15` | 198.18.0.0 – 198.19.255.255 | 131,072 | Private | Benchmark testing |
| `198.51.100.0/24` | 198.51.100.0 – 198.51.100.255 | 256 | Documentation | TEST-NET-2 |
| `203.0.113.0/24` | 203.0.113.0 – 203.0.113.255 | 256 | Documentation | TEST-NET-3 |
| `224.0.0.0/4` | 224.0.0.0 – 239.255.255.255 | 268,435,456 | Internet | Multicast |
| `255.255.255.255/32` | 255.255.255.255 | 1 | Subnet | Limited broadcast |

### Private IPv4 Ranges (RFC 1918) [^2]

| Address block (CIDR) | Address range | Addresses | Typical use |
|---|---|---|---|
| `10.0.0.0/8` | 10.0.0.0 – 10.255.255.255 | 16,777,216 | Large corporate / cloud VPCs |
| `172.16.0.0/12` | 172.16.0.0 – 172.31.255.255 | 1,048,576 | Medium networks / Docker |
| `192.168.0.0/16` | 192.168.0.0 – 192.168.255.255 | 65,536 | Home / small office |

---

[^1]: [List of reserved IP addresses — Wikipedia](https://en.wikipedia.org/wiki/List_of_reserved_IP_addresses){target="_blank"}
[^2]: [RFC 1918 — Address Allocation for Private Internets](https://datatracker.ietf.org/doc/html/rfc1918){target="_blank"}
[^3]: [Private Network — Wikipedia](https://en.wikipedia.org/wiki/Private_network){target="_blank"}
[^4]: [Reserved IP Addresses — Wikipedia](https://en.wikipedia.org/wiki/Reserved_IP_addresses){target="_blank"}
[^5]: [RFC 791 — Internet Protocol](https://datatracker.ietf.org/doc/html/rfc791){target="_blank"}
[^6]: [IPv6 Adoption — Google](https://www.google.com/intl/en/ipv6/){target="_blank"}
[^7]: [IANA IPv4 Address Space Registry](https://www.iana.org/assignments/ipv4-address-space/ipv4-address-space.xhtml){target="_blank"}
[^8]: [RFC 1034 — Domain Names: Concepts and Facilities](https://datatracker.ietf.org/doc/html/rfc1034){target="_blank"}
[^9]: [RFC 4271 — BGP-4](https://datatracker.ietf.org/doc/html/rfc4271){target="_blank"}
