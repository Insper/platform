
An IP address gets a packet to the right machine; the **transport layer** gets it to the right program on that machine, and decides what happens when a packet is lost. In this course every service listens on a port (`8080` for a Spring Boot app, `5432` for PostgreSQL), every `ports:` line in a `compose.yaml` maps one port to another, and most calls between services ride on TCP — while DNS, and HTTP/3, ride on UDP. This page covers ports, the difference between TCP and UDP, the handshake that opens a TCP connection, and what TCP's reliability costs when the network loses packets.

---

## Ports { #ports }

An IP address identifies a **host**; a **port** identifies a specific **process** on that host. Together, `IP:port` (called a *socket address*) identifies a communication endpoint on the network.

Ports are 16-bit numbers (0–65535) divided into three ranges[^1]:

| Range | Name | Use |
|---|---|---|
| 0–1023 | System (well-known) ports | Standard services; on Linux, binding one needs root (or the `CAP_NET_BIND_SERVICE` capability) |
| 1024–49151 | User (registered) ports | Registered with IANA for common applications |
| 49152–65535 | Dynamic (ephemeral) ports | Assigned to clients for outbound connections |

### Well-known ports { #well-known }

| Port | Protocol | Service |
|---|---|---|
| 22 | TCP | SSH (secure shell) |
| 25 | TCP | SMTP (email sending) |
| 53 | UDP/TCP | DNS |
| 80 | TCP | HTTP |
| 443 | TCP (UDP for HTTP/3) | HTTPS |
| 3000 | TCP | Grafana / Node.js development servers |
| 3306 | TCP | MySQL |
| 5432 | TCP | PostgreSQL |
| 6379 | TCP | Redis |
| 8080 | TCP | HTTP (development servers, alternative HTTP) |
| 9090 | TCP | Prometheus |

### Ephemeral ports and connections { #ephemeral }

A server listens on a fixed port; the client's side gets a temporary one. When a browser connects to `https://example.com`, it connects to port `443` of the server's address, and the operating system picks an **ephemeral port** (e.g., `52413`) for the client side, so the full connection is `client_ip:52413 ↔ server_ip:443`. Operating systems pick from their own range: IANA suggests 49152–65535, while Linux uses 32768–60999 by default[^2].

A connection is identified by four numbers — source IP, source port, destination IP, destination port — so one server port can hold thousands of connections at once, one per client socket. You can list the ports your machine is listening on:

```bash
ss -tlnp                         # Linux: TCP sockets in LISTEN state, with the process
lsof -iTCP -sTCP:LISTEN -n -P    # macOS (and Linux)
```

In Docker, `ports: - "8081:8080"` means "host port 8081 forwards to container port 8080": the service inside still listens on its own port, and the host publishes it under another one ([Addressing & NAT](../addressing/index.md#docker)).

---

## TCP and UDP { #tcp-udp }

The Transport layer offers two fundamentally different delivery models:

=== "TCP — Transmission Control Protocol"

    TCP establishes a **connection** before exchanging data and guarantees that[^3]:

    - Every byte is delivered exactly once, in order
    - Lost packets are automatically retransmitted
    - The sender slows down if the receiver or the network is overwhelmed (flow and congestion control)

    **Use when:** correctness matters more than speed — HTTP/1.1 and HTTP/2, database connections, SSH, message brokers.

=== "UDP — User Datagram Protocol"

    UDP sends **datagrams** with no connection setup, no delivery guarantee, and no ordering[^4].

    - No handshake — lower latency
    - No retransmission — if a packet is lost, it is gone
    - Application must handle ordering and reliability if needed

    **Use when:** a late packet is worthless or the application brings its own reliability — DNS queries, video calls, online gaming, VoIP, and QUIC (the transport under HTTP/3).

| | TCP | UDP |
|---|---|---|
| **Connection** | Required (3-way handshake) | None |
| **Delivery guarantee** | Yes — retransmits lost packets | No |
| **Ordering** | Yes — bytes arrive in sequence | No |
| **Latency** | Higher: one round trip to connect, and waits for lost data | Lower |
| **Use cases** | HTTP/1.1, HTTP/2, SSH, databases | DNS, video, VoIP, gaming, QUIC / HTTP/3 |

---

## The three-way handshake { #handshake }

Before any data flows, a TCP client and server agree on initial sequence numbers — the counters each side uses to number its bytes, so the other can acknowledge them and spot what is missing:

``` diagram-sim
sequenceDiagram
    participant C as Client<br/>ephemeral port 52413
    participant S as Server<br/>port 443
    C->>S: SYN (seq = x)
    S-->>C: SYN-ACK (seq = y, ack = x+1)
    C->>S: ACK (ack = y+1) + first data (request)
    Note over C,S: connection established after one round trip
    S-->>C: data (response), ack = bytes received so far
    C->>S: ACK
```

The handshake costs **one round trip** before the first byte of the request leaves the client. HTTPS adds a TLS handshake on top — one more round trip with TLS 1.3[^5]. On a 77 ms São Paulo – Virginia path that is about 150 ms before the request is even sent, which is why clients and services reuse connections (HTTP keep-alive, connection pools) instead of opening a new one per request.

A port that nobody listens on answers the SYN with a reset (RST): that is the "connection refused" error. A SYN that gets no answer at all (a firewall dropped it, the host is down) is retried until the client gives up: a "timeout".

---

## What reliability costs { #reliability-cost }

TCP's guarantee has a price, and it is paid in time. The sender keeps every segment until the receiver acknowledges it. If no acknowledgement arrives before the **retransmission timer** (RTO) runs out, it sends the segment again, and doubles the timer for the next attempt[^6]. Meanwhile the receiver may already hold the segments that came after the lost one — but TCP promises bytes *in order*, so it cannot hand them to the application yet. One lost segment holds back everything behind it: **head-of-line blocking**.

UDP pays nothing of the kind: what arrives is delivered at once, and what is lost stays lost. Compare both over the same link, with the same losses:

<div class="csim" data-sim="tcp" data-loss="10" data-seed="4"></div>

!!! tip "Try it"
    The run starts at 10% loss, and segments 4 and 7 are lost. Press play. UDP is done at 230 ms with 18/20 segments — two gaps that never get filled. TCP delivers all 20, in order, at 380 ms: 2 retransmissions, and 15 segments that had already arrived waited in the buffer behind segment 4. Set the loss to 0%: UDP finishes at 230 ms and TCP at 310 ms — the 80 ms difference is the handshake's round trip. At 20%, a retransmission is lost as well and the timer doubles: 3 retransmissions, done at 780 ms. At 30%, UDP keeps only 16/20, while TCP needs 7 retransmissions and 1,540 ms.

The simulator keeps only the timer. Real TCP also retransmits early when duplicate acknowledgements show a gap (*fast retransmit*), and slows its sending rate when it sees loss (*congestion control*) — so on a lossy network throughput drops, not just latency. Head-of-line blocking is also why HTTP/3 moved to **QUIC**, which runs over UDP and retransmits per stream: a lost packet of one response no longer stalls the others sharing the connection[^7].

---

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - A port picks the process on a host; `IP:port` is a socket address, and a connection is identified by both ends' addresses and ports.
    - Servers listen on fixed ports; clients get an ephemeral port from the operating system (32768–60999 on Linux).
    - TCP opens a connection with a three-way handshake (one round trip) and then delivers every byte, once, in order.
    - Reliability costs time: a lost segment waits for the retransmission timer, and the segments behind it wait too (head-of-line blocking).
    - UDP delivers what arrives, with no setup and no waiting; DNS, real-time media and QUIC (HTTP/3) build on it.

---

[^1]: [IANA Service Name and Transport Protocol Port Number Registry](https://www.iana.org/assignments/service-names-port-numbers/service-names-port-numbers.xhtml){target="_blank"}; [RFC 6335](https://datatracker.ietf.org/doc/html/rfc6335){target="_blank"}
[^2]: [IP sysctl, `ip_local_port_range` — Linux kernel documentation](https://docs.kernel.org/networking/ip-sysctl.html){target="_blank"}
[^3]: [RFC 9293 — Transmission Control Protocol (TCP)](https://datatracker.ietf.org/doc/html/rfc9293){target="_blank"}
[^4]: [RFC 768 — User Datagram Protocol](https://datatracker.ietf.org/doc/html/rfc768){target="_blank"}
[^5]: [RFC 8446 — TLS 1.3](https://datatracker.ietf.org/doc/html/rfc8446){target="_blank"}
[^6]: [RFC 6298 — Computing TCP's Retransmission Timer](https://datatracker.ietf.org/doc/html/rfc6298){target="_blank"}
[^7]: [RFC 9000 — QUIC](https://datatracker.ietf.org/doc/html/rfc9000){target="_blank"}; [RFC 9114 — HTTP/3](https://datatracker.ietf.org/doc/html/rfc9114){target="_blank"}
