
Every call in a microservice system crosses a network: the browser reaches the gateway, the gateway calls a service, the service queries its database. In this course those hops happen inside Docker networks, Kubernetes clusters and cloud VPCs, and when one fails ("connection refused", "timeout", "could not resolve host"), the cause sits in one of the layers described here. This page gives the big picture: what the internet is, how data is wrapped in layers, and how a packet crosses the public internet. The three pages after it zoom into addresses, ports and names.

---

## What the internet is { #internet }

The **internet** is a global network of networks — a web of interconnected computers, routers, and data centres that communicate using a common set of standardised protocols. No single organisation owns the internet; it is a collaboration between Internet Service Providers (ISPs), governments, universities, and companies, all agreeing to follow the same rules so their networks can interoperate.

Data travels across the internet as **packets** — small chunks of variable size, at most 1,500 bytes on a typical Ethernet or Wi-Fi network. A file or web page is split into many packets, each routed independently across the network and reassembled at the destination. This *packet-switched* model is resilient: if one route is congested or broken, packets find an alternative path.

---

## The TCP/IP stack { #tcp-ip-stack }

The internet is built on a layered architecture. Each layer solves a specific problem and relies on the layer below it. The **TCP/IP model** has four layers[^1]:

| Layer | Protocols | Responsibility |
|---|---|---|
| **Application** | HTTP, HTTPS, DNS, SMTP, SSH | Defines how applications exchange data |
| **Transport** | TCP, UDP | Delivers data between processes on two hosts (ports) |
| **Internet** | IP (IPv4, IPv6), ICMP | Routes packets from source to destination across networks |
| **Link** | Ethernet, Wi-Fi, ARP | Moves frames between devices on the same local network |

Each layer wraps the data of the layer above in its own header — **encapsulation** — and the receiver unwraps it in the opposite order. Play the diagram to follow one request down the client's stack, across the wire, and up the server's:

``` diagram-sim
flowchart TB
    subgraph client ["Client"]
        ca["Application<br/>HTTP GET /"]
        ct["Transport<br/>TCP segment: + ports"]
        ci["Internet<br/>IP packet: + IP addresses"]
        cl["Link<br/>Ethernet frame: + MAC addresses"]
    end
    subgraph server ["Server"]
        sl["Link<br/>frame checked, header removed"]
        si["Internet<br/>packet for my IP? yes"]
        st["Transport<br/>segment for port 443"]
        sa["Application<br/>HTTP request handled"]
    end
    ca -->|"wrap"| ct
    ct -->|"wrap"| ci
    ci -->|"wrap"| cl
    cl -->|"physical medium<br/>(cable / Wi-Fi / fibre)"| sl
    sl -->|"unwrap"| si
    si -->|"unwrap"| st
    st -->|"unwrap"| sa
```

When you open `https://example.com`, the browser hands an HTTP request to the Application layer, TCP wraps it in a segment with source and destination **ports**, IP wraps that in a packet with source and destination **IP addresses**, and Ethernet frames it for the local network. Each router along the way strips and re-adds the Link layer frame, using the IP layer to decide the next hop.

The layers map onto the rest of this section: [IP addresses](addressing/index.md) belong to the Internet layer, [ports, TCP and UDP](transport/index.md) to the Transport layer, and [DNS](dns/index.md) is an application that almost every other application needs before it can send its first packet.

---

## Crossing the public internet { #public-internet }

A **public IP address** is a globally unique address assigned by a Regional Internet Registry (RIR) and routable on the internet. Any server you want to reach from the public internet must have a public IP — or be reachable through one via NAT ([Addressing & NAT](addressing/index.md#nat)).

Packets cross the internet by hopping between routers. Each router knows only the *next hop* toward the destination — a partial map stored in a **routing table**. The **BGP (Border Gateway Protocol)** is the inter-domain routing protocol that lets ISPs exchange these maps and collectively know how to reach every public address block on the internet[^2].

``` diagram-sim
flowchart LR
    client["Client<br/>203.0.113.5"]
    r1["ISP router<br/>Brazil"]
    r2["Backbone<br/>router"]
    r3["ISP router<br/>USA"]
    server["Server<br/>198.51.100.20"]
    client -->|"hop 1"| r1
    r1 -->|"hop 2"| r2
    r2 -->|"hop 3"| r3
    r3 -->|"hop 4"| server
```

Every hop adds a little processing and queueing time, but over long distances the floor is set by physics. Light in optical fibre travels at about 200,000 km/s[^3], roughly two-thirds of its speed in vacuum. São Paulo and northern Virginia (home of many cloud regions) are about 7,700 km apart in a straight line, so a round trip between them takes at least about 77 ms before any router does anything — and real cables are longer than a straight line. No protocol and no faster server removes that delay; only moving the server closer to the user does (a nearby region, a CDN).

You can watch the hops yourself: `traceroute` (`tracert` on Windows) sends packets that expire one hop further each time and prints one line per router, with three round-trip times each.

```bash
traceroute example.com
```

The addresses in the diagram belong to blocks reserved for documentation (RFC 5737), like the other examples in this section; a real trace shows real addresses.

---

## Where to go next { #next }

<div class="grid cards" markdown>

-   __[Addressing & NAT](addressing/index.md)__

    ---

    IPv4 and IPv6, CIDR blocks, public and private ranges, how NAT lets a whole network share one address, and how Docker uses private networks.

-   __[Ports, TCP & UDP](transport/index.md)__

    ---

    How a port picks a process on a host, the three-way handshake, and what TCP's reliability costs compared with UDP.

-   __[DNS](dns/index.md)__

    ---

    How a name becomes an address, the record types, `dig`, and why the TTL trades freshness for load.

-   __[Quiz](quiz.md)__

    ---

    Check what you learned across the section.

</div>

---

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - The internet is a network of networks that agree on common protocols; data travels as small packets, each routed on its own.
    - TCP/IP has four layers (application, transport, internet, link); each wraps the data of the layer above in its own header.
    - Routers forward a packet one hop at a time using routing tables; BGP is how networks tell each other which address blocks they can reach.
    - Distance sets a floor on latency: light in fibre needs at least about 77 ms for a São Paulo – Virginia round trip.

---

[^1]: [RFC 1122 — Requirements for Internet Hosts: Communication Layers](https://datatracker.ietf.org/doc/html/rfc1122){target="_blank"}
[^2]: [RFC 4271 — BGP-4](https://datatracker.ietf.org/doc/html/rfc4271){target="_blank"}
[^3]: [Optical fiber — Wikipedia](https://en.wikipedia.org/wiki/Optical_fiber){target="_blank"}
