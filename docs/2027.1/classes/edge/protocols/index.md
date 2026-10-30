The BoxOffice seat map has a problem. During the sale, seats change colour every second as other fans hold them. The first version of the web app asked `GET /api/events/42/seats` every 2 seconds: 2 million fans × 0.5 requests per second = **1 million requests per second**, most of them answering "nothing changed". Meanwhile, fans on a train in São Paulo complain that the app "freezes" every time the phone switches between cell towers. Both problems are **protocol** problems — the choice of how bytes travel between the phone and the edge — and both have good modern answers.

This page reviews the protocols that run on the edge: the three generations of HTTP, the TLS handshake that protects them, the options for **real-time** updates (polling, long polling, Server-Sent Events, WebSockets), and gRPC for service-to-service calls. The goal is not to memorise headers, but to know **what each protocol costs in round trips and connections**, and what it is good for.

---

## Round trips are the currency { #round-trips }

Bandwidth keeps growing; the speed of light does not. A **round-trip time** (RTT) is the time a packet takes to go to the server and back: around 1–10 ms inside a city, around 30–60 ms across a continent, around 100–200 ms between continents. Every protocol exchange that waits for an answer costs at least one RTT, and on a new connection there are several of them **before the first byte of data**: one to open TCP, one or two for TLS[^7].

That is why the history of web protocols is mostly a history of **removing round trips** and **using connections better**.

---

## HTTP/1.1 { #http1 }

HTTP/1.1 (1997, current specification RFC 9112) is a text protocol: the client writes `GET /api/events/42 HTTP/1.1`, headers, a blank line; the server answers with a status line, headers and a body[^1].

- **Persistent connections (keep-alive)**: one TCP connection can carry many requests one after the other, avoiding a new handshake for each.
- **One request at a time per connection**: a second request must wait until the first response has arrived completely. If the first response is slow, everything behind it waits — **head-of-line (HOL) blocking**. (Pipelining, which was meant to fix this, was never usable in practice.)
- Browsers work around it by opening **about 6 parallel connections per host**, and developers used to work around *that* with tricks like domain sharding, sprites and bundling.
- Headers are plain text and repeated on every request: cookies and user agents can add hundreds of bytes per request.

HTTP/1.1 is still everywhere — between a load balancer and its backends, in simple clients, in `curl` — and it is perfectly fine for low-concurrency, request-response traffic.

## HTTP/2 { #http2 }

HTTP/2 (2015, RFC 9113) keeps the same semantics — methods, status codes, headers — but changes how they travel[^2]:

- **Binary framing**: messages are split into frames, each tagged with a **stream** id.
- **Multiplexing**: many requests and responses travel **at the same time** over **one** TCP connection, their frames interleaved. A slow response no longer blocks the others at the HTTP level.
- **Header compression (HPACK)**: repeated headers are sent as small references to a table shared by both ends.
- **Stream priorities** and flow control per stream.

One connection per origin is enough, so the domain-sharding tricks become counterproductive. But one problem remains, one layer down: TCP delivers bytes **in order**. If a single packet is lost, TCP holds back *all* the bytes after it — of *every* stream — until the retransmission arrives. On a lossy mobile network, HTTP/2's single connection can be slower than HTTP/1.1's six. This is **TCP head-of-line blocking**, and it is the reason for HTTP/3.

## HTTP/3 and QUIC { #http3 }

HTTP/3 (2022, RFC 9114) runs over **QUIC** (RFC 9000), a transport protocol built on top of **UDP**[^3]. QUIC moves into user space what TCP did in the kernel, and redesigns it:

- **Independent streams in the transport**: a lost packet only delays the stream it belongs to; the others keep flowing. No TCP head-of-line blocking.
- **TLS 1.3 built in**: the transport and cryptographic handshakes are combined, so a new connection needs **1 RTT** before sending data — and a resumed one can send data in the very first packet (**0-RTT**).
- **Connection migration**: a QUIC connection is identified by a **connection ID**, not by the (IP, port) pair. When the phone moves from Wi-Fi to 4G, its IP changes but the connection survives — no new handshake, no "freeze".
- Always encrypted, including most of the transport headers, which also makes it harder for middleboxes to interfere.

The costs: UDP is sometimes blocked or throttled by corporate networks (browsers fall back to HTTP/2 automatically), QUIC uses more CPU than kernel TCP, and load balancers must route by connection ID to keep migrating connections on the same server. Browsers, CDNs and the big platforms adopted it quickly; inside the data centre, HTTP/1.1 and HTTP/2 remain the norm.

| | HTTP/1.1 | HTTP/2 | HTTP/3 |
|---|---|---|---|
| Transport | TCP | TCP | QUIC over UDP |
| Format | text | binary frames | binary frames |
| Concurrency on one connection | one request at a time | multiplexed streams | multiplexed, independent streams |
| Head-of-line blocking | HTTP and TCP level | TCP level only | none across streams |
| Header compression | none | HPACK | QPACK |
| Handshake before data (new connection) | TCP + TLS: 2–3 RTT | TCP + TLS: 2–3 RTT | 1 RTT (0-RTT on resumption) |
| Survives IP change | no | no | yes (connection migration) |
| Typical place | backends, simple clients | browsers, gRPC, internal | browsers and mobile ↔ CDN/edge |

---

## TLS 1.3: the handshake { #tls }

Every connection on the edge is encrypted with **TLS**. Before any HTTP data, client and server must agree on keys and the client must verify the server's **certificate** (that it really is `boxoffice.com`). TLS 1.2 needed **two** round trips for that; **TLS 1.3** (2018, RFC 8446) needs **one**, by having the client guess the key-exchange parameters and send its key share immediately[^4].

``` diagram-sim
sequenceDiagram
    participant C as Fan's phone
    participant S as CDN edge (boxoffice.com)
    C->>S: TCP SYN
    S-->>C: SYN-ACK
    C->>S: ACK + TLS ClientHello (key share, supported ciphers, SNI = boxoffice.com)
    S-->>C: ServerHello (key share) + certificate + Finished (encrypted)
    Note over C: verify certificate, derive keys
    C->>S: Finished + GET /api/events/42 (encrypted)
    S-->>C: 200 OK (encrypted)
```

With QUIC, the TCP exchange disappears: the first QUIC packet already carries the `ClientHello`, so the request goes out after **one** round trip. With **0-RTT resumption**, a client that talked to the server recently reuses a pre-shared key and sends the request in the first flight — with a caveat: 0-RTT data can be **replayed** by an attacker, so servers only accept idempotent requests (`GET`) in 0-RTT.

The chart counts the round trips before the first response byte on a **new** connection (server processing time ignored), at three distances:

```python exec="1" html="1"
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO
plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "xtick.color": "#888",
                     "ytick.color": "#888", "axes.edgecolor": "#888", "font.size": 10})

# round trips before the first response byte arrives (handshakes + the request itself)
stacks = {
    "TCP + TLS 1.2": 1 + 2 + 1,
    "TCP + TLS 1.3": 1 + 1 + 1,
    "QUIC (HTTP/3)": 1 + 1,
    "QUIC 0-RTT\n(resumed)": 0 + 1,
}
rtts = {"same city\n(RTT 10 ms)": 10, "same continent\n(RTT 50 ms)": 50,
        "intercontinental\n(RTT 150 ms)": 150}
colors = ["#e5484d", "#f59e0b", "#2f6fed", "#1e9e5a"]

fig, ax = plt.subplots(figsize=(9, 4))
x = np.arange(len(rtts))
w = 0.2
for i, ((name, n), c) in enumerate(zip(stacks.items(), colors)):
    vals = [n * r for r in rtts.values()]
    bars = ax.bar(x + (i - 1.5) * w, vals, width=w, color=c, label=f"{name} ({n} RTT)")
    for bx, v in zip(bars, vals):
        ax.text(bx.get_x() + bx.get_width() / 2, v + 6, f"{v}", ha="center", fontsize=8)
ax.set_xticks(x, list(rtts))
ax.set_ylabel("ms until the first response byte")
ax.set_ylim(0, 680)
ax.set_title("Connection setup cost: new connection, server time ignored")
ax.legend(frameon=False, fontsize=8)

plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True, bbox_inches="tight")
print(buf.getvalue())
plt.close()
```

Two conclusions. First, the protocol matters **most when the server is far away** — 600 ms versus 150 ms intercontinental — which is also why CDNs terminate connections close to the user: with an edge in the same city, even TLS 1.2 costs only 40 ms. Second, the best handshake is the one you **do not repeat**: keep-alive and connection pooling (between the gateway and the services, too) make the setup cost disappear for every request after the first.

??? question "Think first: the mobile app makes 30 small API calls when the event screen opens. The API is in Virginia (RTT 150 ms from São Paulo) and the app opens a new HTTP/1.1 connection with TLS 1.2 for each call, 6 at a time. Roughly how long does it take?"
    Each call on a fresh connection costs 4 RTT ≈ 600 ms; 30 calls in batches of 6 means 5 batches ≈ **3 seconds**, before any server time. Fixes, in order of impact: reuse connections (keep-alive) and **multiplex** them with HTTP/2 or HTTP/3 (all 30 calls over one connection: 1 handshake + roughly 1 RTT ≈ 300–450 ms); terminate TLS at an **edge close to the fan**; and **aggregate** the 30 calls into one screen-level call in a BFF ([API gateway](../api-gateway/index.md#bff)).

---

## Real-time: getting updates to the client { #real-time }

HTTP is request-response: the client asks, the server answers. For the seat map, the waiting-room position or a chat, the *server* knows when something changed. There are four ways to get that information to the client.

### Short polling { #polling }

The client asks every *N* seconds: "anything new?". Trivial to implement and to cache, but wasteful (most answers are "no") and slow to react (up to *N* seconds of delay). Polling *with micro-caching at the CDN* ([DNS & CDN](../dns-cdn/index.md#micro-caching)) is a perfectly good design for the seat map when a few seconds of delay are acceptable.

### Long polling { #long-polling }

The client asks, and the server **holds the request open** until there is news (or a timeout of, say, 30 s), then answers; the client immediately asks again. Near real-time over plain HTTP, but every message costs a full request, and servers must hold many open requests.

### Server-Sent Events (SSE) { #sse }

The client opens one ordinary HTTP request with `Accept: text/event-stream`; the server keeps the response open and **streams events** as lines of text, for as long as it wants:

```text title="GET /api/events/42/seats/stream"
event: seat
id: 1842
data: {"seat": "B-12", "status": "held"}

event: seat
id: 1843
data: {"seat": "B-13", "status": "sold"}
```

SSE is **one-way** (server → client), text-only, and runs over normal HTTP — so it passes through proxies, CDNs and load balancers, works over HTTP/2 multiplexing, and the browser's `EventSource` API **reconnects automatically**, sending the last received `id` in a `Last-Event-ID` header so the server can resume. It is the simplest good answer for "push updates to many clients": live scores, notifications, the waiting-room position, and the token-by-token stream of an LLM response.

!!! example "In the BoxOffice code: the assistant streams with SSE (lab 12)"

    The assistant of [Hands-on 12 — Tools](../../../hands-on/12/tools/index.md) answers token by token over SSE: the endpoint returns a `text/event-stream` response with `Cache-Control: no-cache` (no proxy may buffer or cache a live stream), and each event is two text lines and a blank one, written by a two-line helper in `agent.py`. No library, no protocol upgrade — an ordinary HTTP response that any HTTP proxy can pass along, as long as it does not buffer it. The waiting room of lab 7 chose the even simpler option: the fan **polls** `GET /orders/waiting-room/{show}/tickets/{id}`.

    ``` { .python title="services/assistant/app/main.py (the stream)" }
    --8<-- "docs/2027.1/hands-on/12/code/services/assistant/app/main.py:72:80"
    ```

### WebSockets { #websockets }

A **WebSocket** (RFC 6455) starts as an HTTP/1.1 request that asks to **upgrade** the connection; after the `101 Switching Protocols` answer, the TCP connection becomes a **full-duplex** channel of messages in both directions, with very low per-message overhead[^5]:

``` diagram-sim
sequenceDiagram
    participant C as Browser
    participant L as Load balancer (L7)
    participant W as ws service
    C->>L: GET /ws (Upgrade: websocket, Sec-WebSocket-Key)
    L->>W: forward the upgrade request
    W-->>C: 101 Switching Protocols (Sec-WebSocket-Accept)
    Note over C,W: same TCP connection, now a two-way message channel
    C->>W: {"type": "join", "room": "event-42"}
    W-->>C: {"type": "seat", "seat": "B-12", "status": "held"}
    C->>W: {"type": "ping"}
    W-->>C: {"type": "pong"}
```

WebSockets are the tool for **interactive, bidirectional** traffic: chat, multiplayer games, collaborative editing. They come with operational costs: connections are **stateful and long-lived** (a server restart disconnects thousands of users, who all reconnect at once), load balancers must support the upgrade and long idle timeouts, and you need a **pub/sub** backbone so that a message published on one server reaches clients connected to the others (the [chat case study](../../case-studies/chat/index.md)).

| | Short polling | Long polling | SSE | WebSockets |
|---|---|---|---|---|
| Direction | client pulls | client pulls (server holds) | server → client | both ways |
| Latency of updates | up to the interval | low | low | lowest |
| Cost per update | a full request (often empty) | a full request | a few bytes | a few bytes |
| Through proxies/CDN | easy, cacheable | easy | easy (plain HTTP) | needs upgrade support |
| Reconnection and resume | n/a | manual | built in (`Last-Event-ID`) | manual |
| Binary data | yes | yes | no (text) | yes |
| Good for | dashboards, low-frequency status | legacy clients | feeds, notifications, progress, LLM streaming | chat, games, collaboration |

!!! info "WebTransport"
    **WebTransport** is a newer browser API over HTTP/3 that offers multiple streams and unreliable datagrams — useful for games and media. It is still maturing; for most designs in 2026, SSE and WebSockets are the safe choices.

---

## gRPC: calls between services { #grpc }

Between BoxOffice's own services, the priorities are different: no browsers, both sides under our control, many calls per user action, and a need for strict contracts. **gRPC** is an RPC (Remote Procedure Call) framework from Google that runs over **HTTP/2** and encodes messages with **Protocol Buffers** (protobuf), a compact binary format generated from a schema[^6]:

```protobuf title="inventory.proto"
syntax = "proto3";
package boxoffice.inventory.v1;

service Inventory {
  rpc HoldSeats (HoldRequest) returns (Hold);                   // unary
  rpc WatchSeats (WatchRequest) returns (stream SeatEvent);     // server streaming
}

message HoldRequest {
  string event_id = 1;
  repeated string seat_ids = 2;
  string user_id = 3;
  string idempotency_key = 4;
}

message Hold {
  string hold_id = 1;
  int64 expires_at_epoch_ms = 2;
}

message WatchRequest { string event_id = 1; }
message SeatEvent { string seat_id = 1; string status = 2; }
```

From this file, the protobuf compiler generates client and server code in Java, Python, Go and others. gRPC offers four call types — **unary**, **server streaming**, **client streaming** and **bidirectional streaming** — and has **deadlines** built in: the caller says "I need an answer within 300 ms", and the deadline propagates through the chain of calls, so downstream services stop working on requests nobody is waiting for anymore.

| | REST + JSON | gRPC + protobuf | GraphQL |
|---|---|---|---|
| Contract | OpenAPI (optional) | `.proto` (mandatory, code-generated) | schema (mandatory) |
| Payload | text JSON, human-readable | binary, compact, fast to parse | JSON |
| Transport | HTTP/1.1, 2 or 3 | HTTP/2 | usually HTTP POST |
| Streaming | via SSE / WebSockets | native, both directions | subscriptions (WebSockets) |
| Browser support | native | needs gRPC-Web or a proxy | native |
| Caching by CDN/HTTP | natural for GET | no | hard (POST) |
| Sweet spot | public APIs, web and mobile | internal service-to-service, low latency | clients that need flexible aggregation (BFF) |

The full comparison of API styles, with versioning and design advice, is in [Compute — API styles](../../compute/api-styles/index.md).

---

## Long-lived connections and load balancing { #long-lived }

HTTP/2, gRPC, SSE and WebSockets all keep connections open for a long time. That has a consequence that surprises many teams: **load is balanced when a connection is opened, not when a request is sent** — unless an L7 proxy balances each request or stream.

- After a scale-out, the new replicas get **no traffic**: the existing clients are still attached to the old ones.
- After a deploy or a crash, **all** clients of a server reconnect at the same moment — a **reconnection storm**.
- An L4 load balancer sees one gRPC connection and sends all of the caller's requests to one replica ([Load Balancing](../load-balancing/index.md#l4-l7)).

Remedies: L7 balancing per request (Envoy, service mesh) or client-side balancing for gRPC; a **maximum connection age** so clients rotate periodically; **jittered** reconnection backoff on the client; and draining that closes connections gradually during deploys.

---

## Trade-offs at a glance { #trade-offs }

| Need | Prefer | Why |
|---|---|---|
| Browsers and mobile apps → edge | HTTP/2 and HTTP/3 (let the CDN negotiate) | multiplexing, fewer round trips, connection migration |
| Edge → backends inside the region | HTTP/1.1 or HTTP/2 with keep-alive pools | simple; RTTs are tiny; connection reuse removes the setup cost |
| Server → many clients, one-way updates | SSE | plain HTTP, auto-reconnect, works through the edge |
| Interactive, bidirectional, low latency | WebSockets | full duplex, small messages |
| Updates every few seconds are fine | polling + CDN micro-caching | stateless, cacheable, cheapest to operate |
| Service-to-service, high volume, strict contract | gRPC | binary, code-generated, streaming, deadlines |
| Public API for third parties | REST + JSON (OpenAPI) | universal, cacheable, easy to debug |

!!! example "BoxOffice: one protocol per interaction"
    - **Fan ↔ CDN**: HTTP/3 with fallback to HTTP/2; TLS 1.3 terminated at the edge. Connection migration keeps the app working on the train.
    - **Seat map**: before 10:00, polling every 10 s with micro-caching; during the sale, an **SSE** stream per event (`/api/events/42/seats/stream`) fed by a pub/sub topic of seat changes. One `held` event replaces 2 million "nothing changed" answers.
    - **Waiting room**: an SSE stream with the fan's position, served by a dedicated service; reconnection with `Last-Event-ID` and jitter.
    - **Order → inventory**: **gRPC** `HoldSeats` with a 300 ms deadline and an idempotency key; client-side load balancing over the `inventory` pods.
    - **Assistant**: the LLM answer is streamed token by token with **SSE**; a WebSocket would only be needed for a voice or two-way collaborative mode.
    - **Partners**: REST + JSON with OpenAPI, versioned paths, rate-limited per API key at the gateway.

!!! tip "In the interview"
    - When a problem has **real-time** requirements (chat, live scores, ride tracking, notifications), state the options and choose explicitly: "SSE for one-way updates; WebSockets because the chat is bidirectional; polling would cost N requests per second for nothing." Then mention the consequence: **stateful connections need a pub/sub layer** between servers and a plan for reconnection storms.
    - For internal calls, "REST between services" is fine; say "gRPC" when latency, volume or streaming matter, and mention **deadlines**.
    - If latency for distant users comes up, count **round trips**: "TLS 1.3 and HTTP/3 cut the handshake to 1 RTT, and an edge close to the user makes that RTT small."

!!! success "Best practices"

    - **Terminate HTTP/2 or HTTP/3 at the edge and keep HTTP/1.1 keep-alive towards the backends** — clients get multiplexing, backends get reused connections. In BoxOffice: `proxy_http_version 1.1` and `keepalive` in lab 3's `nginx.conf`.
    - **Disable buffering and caching on streamed responses** — `Cache-Control: no-cache` and, behind Nginx, `X-Accel-Buffering: no`, or the fan sees the whole answer at once. In BoxOffice: the assistant's SSE endpoint ([lab 12](../../../hands-on/12/tools/index.md), box above).
    - **Give every SSE event an `id` and resume from `Last-Event-ID`** — a reconnection then continues where it stopped instead of replaying or losing events.
    - **Set a deadline on every gRPC call and propagate it** — the callee stops working on a request its caller has already abandoned.
    - **Automate certificate renewal and alert well before expiry** — an expired certificate is a total outage that no amount of replicas prevents.

!!! warning "Pitfalls"
    - **WebSockets by default**: choosing WebSockets for one-way updates buys stateful servers, custom reconnection and proxy configuration that SSE gives for free.
    - **Idle timeouts**: load balancers close idle connections (often after 60 s); SSE and WebSocket streams need heartbeats (comments or pings) to stay open.
    - **Reconnection storms** after a deploy: thousands of clients reconnecting at once. Add jitter and drain gradually.
    - **Balancing gRPC at L4**: one replica gets all the traffic.
    - **0-RTT for non-idempotent requests**: replayable. Only `GET`s in early data.
    - **Assuming UDP works everywhere**: always keep an HTTP/2 fallback for HTTP/3.

---

## How it connects { #how-it-connects }

``` diagram
flowchart LR
    RTT["round trips"] --> TLS["TLS 1.3, 0-RTT"]
    RTT --> QUIC["HTTP/3 over QUIC"]
    RTT --> LAT["latency budget<br/>→ Estimation"]
    H2["HTTP/2 streams"] --> GRPC["gRPC between services<br/>→ Compute: API styles"]
    RT["real-time push"] --> SSE["SSE: seat map, queue position"]
    RT --> WS["WebSockets: chat, games"]
    WS --> PS["pub/sub fan-out<br/>→ Messaging"]
    WS --> LL["long-lived connections<br/>→ load balancing"]
    TLS --> MTLS["mTLS inside the cluster<br/>→ service mesh"]
```

**Palette components:** [`client`](../../../reference/components/client/index.md#client) and [`mobile`](../../../reference/components/client/index.md#mobile) (choose the protocol) · [`cdn`](../../../reference/components/edge/index.md#cdn) and [`lb`](../../../reference/components/edge/index.md#lb) (terminate TLS, speak HTTP/2 and HTTP/3) · [`pubsub`](../../../reference/components/messaging/index.md#pubsub) (fan-out behind WebSockets) · [`mesh`](../../../reference/components/network/index.md#mesh) (mTLS between services). **Scenarios:** `chat`, `video-streaming`, `ai-assistant` (streamed tokens). **Continues in:** [Compute — API styles](../../compute/api-styles/index.md), [Case study: chat](../../case-studies/chat/index.md), [Network & Security — service mesh](../../network-security/service-mesh/index.md).

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - Latency on new connections is counted in **round trips**: TCP + TLS 1.2 costs 4 RTT to the first byte, TLS 1.3 costs 3, QUIC 2, and QUIC 0-RTT 1. Reuse connections and terminate them close to the user.
    - **HTTP/1.1**: one request at a time per connection. **HTTP/2**: multiplexed streams over one TCP connection, but TCP head-of-line blocking. **HTTP/3/QUIC**: independent streams over UDP, built-in TLS 1.3, connection migration.
    - For real-time updates: **polling** (simple, cacheable), **long polling**, **SSE** (one-way, plain HTTP, auto-reconnect), **WebSockets** (bidirectional, stateful).
    - **gRPC** (HTTP/2 + protobuf) suits internal service-to-service calls: contracts, streaming, deadlines.
    - Long-lived connections are balanced **at connect time**: watch for imbalance after scale-out and reconnection storms after deploys.

---

[^1]: FIELDING, R.; NOTTINGHAM, M.; RESCHKE, J. [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110){target="_blank"} and [RFC 9112 — HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9112){target="_blank"}. IETF, 2022.
[^2]: THOMSON, M.; BENFIELD, C. [RFC 9113 — HTTP/2](https://www.rfc-editor.org/rfc/rfc9113){target="_blank"}. IETF, 2022.
[^3]: IYENGAR, J.; THOMSON, M. [RFC 9000 — QUIC](https://www.rfc-editor.org/rfc/rfc9000){target="_blank"}, 2021; BISHOP, M. [RFC 9114 — HTTP/3](https://www.rfc-editor.org/rfc/rfc9114){target="_blank"}. IETF, 2022.
[^4]: RESCORLA, E. [RFC 8446 — The Transport Layer Security (TLS) Protocol Version 1.3](https://www.rfc-editor.org/rfc/rfc8446){target="_blank"}. IETF, 2018.
[^5]: FETTE, I.; MELNIKOV, A. [RFC 6455 — The WebSocket Protocol](https://www.rfc-editor.org/rfc/rfc6455){target="_blank"}. IETF, 2011. See also WHATWG [HTML Living Standard — Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html){target="_blank"}.
[^6]: [gRPC — Core concepts, architecture and lifecycle](https://grpc.io/docs/what-is-grpc/core-concepts/){target="_blank"}. grpc.io.
[^7]: GRIGORIK, I. [High Performance Browser Networking](https://hpbn.co/){target="_blank"}. O'Reilly, 2013.
