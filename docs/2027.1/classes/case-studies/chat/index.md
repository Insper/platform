
> *"Design a chat application like WhatsApp or Slack: one-to-one and group conversations, delivery and read receipts, online presence, and it must work on phones with flaky networks."*

Chat is the classic **stateful, real-time** problem. Everything else in this course prefers stateless servers behind a load balancer; chat needs millions of **long-lived connections**, so the servers holding them are stateful and the system must know *which* server each user is connected to. On top of that come the questions that separate levels: how do you **order** messages without a global clock, how do you deliver **exactly once to the screen** over a network that retries, and what happens to a message sent to someone whose phone is in a tunnel?

BoxOffice has chat too: each event has a fan group where ticket holders talk before and during the show, and fans chat with support agents about their orders. During a festival, tens of thousands of fans in the same event group is the "huge channel" follow-up of this page.

| | |
|---|---|
| **Difficulty** | :material-star::material-star::material-star: hard |
| **Key concepts** | WebSockets and stateful connection gateways, session registry, pub/sub routing, per-conversation sequence numbers, client message IDs and deduplication, delivery/read receipts, store-and-forward and multi-device sync, presence with heartbeats, wide-column storage partitioned by conversation |
| **Palette components** | [`lb`](../../../reference/components/edge/index.md#lb), [`app`](../../../reference/components/compute/index.md#app), [`pubsub`](../../../reference/components/messaging/index.md#pubsub), [`nosql`](../../../reference/components/storage/index.md#nosql), [`cache`](../../../reference/components/storage/index.md#cache), [`notifications`](../../../reference/components/compute/index.md#notifications), [`objstore`](../../../reference/components/storage/index.md#objstore) |
| **Playground scenario** | `chat` |

!!! abstract "What this case trains"

    - **Choose** a real-time transport (WebSocket, SSE, long polling) and **design** a fleet of stateful connection gateways.
    - **Route** a message to the gateway that holds the recipient's connection, with a session registry and pub/sub.
    - **Guarantee** per-conversation ordering and exactly-once display on top of at-least-once delivery.
    - **Design** offline delivery and multi-device sync with per-device cursors, and presence that does not melt the system.
    - **Model** message storage for write-heavy, time-ordered access.

---

## 1. Clarify the requirements

([interview framework](../../intro/interview-framework/index.md))

### Functional requirements

1. **1:1 and group** conversations (groups up to, say, 500 members).
2. Send and receive **text** messages in real time; media (images, voice) as attachments.
3. **Delivery and read receipts** (✓ sent, ✓✓ delivered, read).
4. **Online presence** and "last seen".
5. **Offline delivery**: messages to an offline user arrive when they reconnect, plus a **push notification**.
6. **Multiple devices** per user (phone + desktop), all in sync; history persists.

### Non-functional requirements

| Quality | Target |
|---|---|
| **Latency** | Message delivered to an online recipient in p99 < 500 ms end to end |
| **Ordering** | Messages within a conversation appear in the same order for every member |
| **Delivery** | No message lost once the server acknowledged it; no duplicate shown on screen |
| **Scale** | 50 M daily users, ~15 M concurrent connections at peak |
| **Availability** | 99.99% for sending; a gateway crash reconnects its users in seconds |
| **Durability** | History kept for years |

### Out of scope (say it explicitly)

End-to-end encryption protocol details (mention it changes search and moderation), voice/video calls, message search, bots. Huge broadcast channels are a follow-up.

??? question "Questions to ask the interviewer"

    | Question | Why it matters |
    |---|---|
    | Max group size? | Small groups → fan-out per member; huge channels → fan-out per gateway, no per-user receipts. |
    | Multiple devices per user? | Delivery and read state become per device; sync cursors per device. |
    | How long is history kept? Server-side at all? | WhatsApp-style (deleted from server after delivery) vs. Slack-style (searchable forever). |
    | End-to-end encrypted? | Server cannot read content: no server-side search, moderation, or previews in push. |
    | Is presence required for groups? | Presence fan-out is often the most expensive feature. |
    | Global users? | Regions, where a conversation "lives", cross-region latency. |

---

## 2. Back-of-the-envelope estimates

```python exec="1" source="tabbed-right"
# Chat: assumptions (illustrative)
dau             = 50_000_000
msgs_per_user   = 40            # messages sent per user per day
peak_factor     = 3
online_share    = 0.3           # share of DAU connected at peak
conns_per_gw    = 50_000        # WebSocket connections one gateway node holds comfortably
group_share     = 0.3           # share of messages sent to groups
avg_group       = 20            # members per group
msg_b           = 300           # message + metadata, bytes
replication     = 3
heartbeat_s     = 30            # app-level heartbeat interval

msgs_day        = dau * msgs_per_user
msg_qps         = msgs_day / 86_400
peak_msg_qps    = msg_qps * peak_factor
deliveries_qps  = peak_msg_qps * ((1 - group_share) * 1 + group_share * avg_group)
connections     = dau * online_share
gateways        = connections / conns_per_gw
heartbeats_qps  = connections / heartbeat_s
storage_tb_day  = msgs_day * msg_b * replication / 1e12
storage_pb_year = storage_tb_day * 365 / 1e3

rows = [
    ("msgs_day", msgs_day, "msgs"), ("msg_qps", msg_qps, "msgs/s"),
    ("peak_msg_qps", peak_msg_qps, "msgs/s"), ("deliveries_qps", deliveries_qps, "deliveries/s"),
    ("connections", connections, "sockets"), ("gateways", gateways, "nodes"),
    ("heartbeats_qps", heartbeats_qps, "pings/s"), ("storage_tb_day", storage_tb_day, "TB/day"),
    ("storage_pb_year", storage_pb_year, "PB/year"),
]
print("| quantity | value | unit |\n|---|---:|---|")
for name, value, unit in rows:
    v = f"{value:,.0f}" if abs(value) >= 100 else f"{value:,.2f}"
    print(f"| `{name}` | {v} | {unit} |")
```

What the numbers tell us:

- **~23 k messages/s on average, ~70 k at peak**, and group fan-out turns them into **~460 k deliveries/s**. ⇒ delivery is a routing problem across many machines, not a database problem.
- **15 M concurrent connections** need **~300 gateway nodes**. ⇒ gateways are a large, **stateful** fleet: deploys, crashes and scaling all disconnect users, so reconnection must be cheap and well behaved.
- If every client sent an app-level heartbeat to a central presence service, that would be **500 k writes/s** just to say "I'm still here". ⇒ presence must be derived from the **connection itself** at the gateway, and only **changes** published.
- History grows by **~1.8 TB/day replicated, ~0.66 PB/year**. ⇒ a horizontally scalable, write-optimized store (wide-column / LSM), partitioned by conversation.

---

## 3. API

Real-time traffic goes over one **WebSocket** per device; history and setup use plain REST.

```text
# WebSocket frames (JSON or protobuf), client ⇄ gateway
→ send     {"type":"send", "clientMsgId":"c-7f3a", "conversationId":"g-42", "body":"See you at gate B!"}
← ack      {"type":"ack",  "clientMsgId":"c-7f3a", "msgId":"m-918273", "seq":1043, "ts":1767261600123}
← message  {"type":"msg",  "conversationId":"g-42", "seq":1043, "msgId":"m-918273", "from":"u-7", "body":"…"}
→ receipt  {"type":"receipt", "conversationId":"g-42", "upToSeq":1043, "kind":"delivered|read"}
← presence {"type":"presence", "userId":"u-7", "status":"online|offline", "lastSeen":1767261590000}
→ sync     {"type":"sync", "cursors":{"g-42":1040, "d-7-9":88}}     # after reconnect
```

```http
GET  /v1/conversations?updatedSince=…                   → 200 [conversation summaries, last seq]
GET  /v1/conversations/{id}/messages?beforeSeq=1040&limit=50 → 200 [messages]   (scroll back)
POST /v1/conversations  {"members": ["u-7","u-9"], "name": "Rock in Rio crew"} → 201
POST /v1/media                                           → 201 {mediaId, uploadUrl}
```

- **`clientMsgId`** is generated by the sender's device; a retried `send` with the same ID is acknowledged again but stored once.
- **`seq`** is assigned by the server, per conversation, strictly increasing — the order every member will display.
- **Receipts** are cumulative (`upToSeq`): one frame acknowledges many messages.

---

## 4. Data model

```sql
-- Messages: partitioned by conversation and time bucket, ordered by seq (wide-column)
CREATE TABLE messages (
    conversation_id TEXT,
    bucket          INT,            -- e.g. days since epoch, or seq / 10 000: bounds partition size
    seq             BIGINT,
    msg_id          TEXT,
    client_msg_id   TEXT,
    sender_id       TEXT,
    body            BLOB,
    created_at      TIMESTAMP,
    PRIMARY KEY ((conversation_id, bucket), seq)
) WITH CLUSTERING ORDER BY (seq DESC);

CREATE TABLE conversation_members (
    conversation_id TEXT, user_id TEXT, joined_at TIMESTAMP, last_read_seq BIGINT,
    PRIMARY KEY ((conversation_id), user_id)
);

CREATE TABLE user_conversations (          -- the "inbox": which conversations, newest first
    user_id TEXT, conversation_id TEXT, last_seq BIGINT, updated_at TIMESTAMP,
    PRIMARY KEY ((user_id), conversation_id)
);
```

```text
# Session registry (Redis): where is each device connected?
session:u-9        → { "phone": "gw-117", "desktop": "gw-031" }    TTL refreshed by the gateway
# Presence (Redis): last seen, only written on state changes
presence:u-9       → { status: "online", lastSeen: 1767261590000 }
# Per-conversation sequence counter (if not owned by a single partition leader)
seq:g-42           → 1043
```

| Data | Store | Why |
|---|---|---|
| Messages | Wide-column NoSQL (`nosql`), partition `(conversation, bucket)` | Write-heavy, time-ordered reads of one conversation; buckets keep partitions bounded |
| Members, inbox | NoSQL tables (or SQL for small scale) | Read on every send (members) and on app open (inbox) |
| Session registry, presence | In-memory KV with TTL (`cache`) | Changes constantly; losing it only causes a re-registration |
| Routing between gateways | Pub/sub (`pubsub`): a channel per gateway | Deliver a message to the node holding the recipient's socket |
| Media | Object store (`objstore`) + CDN | Large blobs; the message carries a reference |
| Offline alerts | Notifications (`notifications`) → APNs / FCM | Wake up devices without a live connection |

---

## 5. High-level design

``` diagram-sim
flowchart LR
    a([Alice phone]) --> lb["L4 load balancer<br/>long-lived TCP"]
    b([Bob desktop]) --> lb
    lb --> gw1["Gateway gw-031<br/>WebSockets"]
    lb --> gw2["Gateway gw-117<br/>WebSockets"]
    gw1 --> cs["Chat service<br/>sequencer, fan-out"]
    gw2 --> cs
    cs --> db[("Messages<br/>wide-column")]
    cs --> reg[("Session registry<br/>+ presence")]
    cs --> ps[["Pub/sub<br/>channel per gateway"]]
    ps --> gw1
    ps --> gw2
    cs --> push["Notifications<br/>APNs / FCM"]
    a -. media .-> obj[("Object store + CDN")]
```

Alice sends a message to Bob, who is online on another gateway:

``` diagram-sim
sequenceDiagram
    autonumber
    participant A as Alice (gw-031)
    participant C as Chat service
    participant D as Messages DB
    participant R as Session registry
    participant P as Pub/sub
    participant B as Bob (gw-117)
    A->>C: send {clientMsgId c-7f3a, conv d-7-9}
    C->>C: seq = next(d-7-9) → 88
    C->>D: insert (d-7-9, 88) if clientMsgId new
    C-->>A: ack {msgId, seq 88}  ✓ sent
    C->>R: where is Bob? → gw-117
    C->>P: publish to channel gw-117
    P->>B: deliver {seq 88}
    B-->>C: receipt delivered upToSeq 88
    C-->>A: ✓✓ delivered
```

If Bob has no session, the chat service stores the message (it is already in the DB) and asks the notification service to send a push; Bob's app fetches the messages with a `sync` when it reconnects.

---

## 6. Deep dives

### 6.1 Holding millions of connections

=== "WebSocket"

    One full-duplex TCP connection per device, upgraded from HTTP ([RFC 6455](https://www.rfc-editor.org/rfc/rfc6455){target="_blank"}). Lowest latency and overhead per message; needs stateful servers and L4 (or WebSocket-aware L7) load balancing. The default for chat ([protocols](../../edge/protocols/index.md)).

=== "Server-Sent Events + HTTP POST"

    Server → client over a long-lived HTTP response (SSE), client → server with normal requests. Simpler through proxies, one direction only; fine for notifications, awkward for chat.

=== "Long polling"

    The client asks "anything new?" and the server holds the request until there is. Works everywhere, but every message costs a new request and headers. A fallback for hostile networks.

Operating the gateway fleet:

- **Gateways only hold sockets.** They authenticate the connection, register `user/device → gateway` in the session registry, forward frames to the chat service and deliver what arrives on their pub/sub channel. No business logic — so they are simple to scale and restart.
- **Heartbeats at the connection level.** WebSocket ping/pong every ~30 s detects dead connections (mobile networks drop silently); the gateway refreshes the session TTL in bulk, not one write per ping.
- **Deploys and crashes disconnect users.** Drain gradually (stop accepting, ask clients to reconnect over minutes), and make clients reconnect with **exponential backoff and jitter** — otherwise 50 000 phones reconnecting in the same second form a **reconnect storm** that knocks over the next gateway ([reliability patterns](../../reliability/patterns/index.md)).
- **Mobile apps in the background** cannot keep a socket open; that is what push notifications are for.

### 6.2 Ordering and exactly-once display

Timestamps from devices cannot order messages: clocks drift and two phones can disagree by seconds ([time and clocks](../../distributed/time-clocks/index.md)). Global ordering is unnecessary and expensive. What users need is **one order per conversation**, the same for every member.

- **One sequencer per conversation.** Route all writes of a conversation to the same owner — a partition of the chat service chosen by `hash(conversation_id)`, or a Kafka partition keyed by conversation — which assigns `seq = last + 1`. The owner is the single writer, so no locks are needed.
- **At-least-once + idempotency = exactly-once effect.** The device retries `send` until it gets an `ack` (the network may have lost either the request or the ack). The server deduplicates on `(conversation_id, client_msg_id)` and returns the same `seq` again ([delivery semantics](../../messaging/semantics/index.md)).
- **The device displays by `seq`** and deduplicates by `msgId`; a gap (`seq 90` arrives before `89`) triggers a short wait or a `sync` for the missing range.

``` diagram-sim
sequenceDiagram
    autonumber
    participant A as Alice phone
    participant C as Chat service
    A->>C: send c-7f3a "Gate B"
    C->>C: store, seq 88
    C--xA: ack lost (tunnel)
    A->>C: retry send c-7f3a "Gate B"
    C->>C: c-7f3a already stored → seq 88
    C-->>A: ack seq 88 (same)
    Note over A,C: stored once, shown once
```

### 6.3 Offline delivery and multi-device sync

- **Store first, deliver second.** A message is durable once acknowledged, whether or not the recipient is online; delivery is an attempt to push it to live sockets.
- **Per-device cursor.** Each device remembers the last `seq` it has per conversation. On reconnect it sends `sync {conversation: lastSeq}` and receives everything after — the inbox table tells it which conversations changed (`last_seq > cursor`).
- **Push notifications** wake the device (APNs for iOS, FCM for Android). They carry a short preview or just "new message" (always the latter with end-to-end encryption); the content is fetched through `sync`.
- **Read state** is per user (synced across devices): reading on the desktop clears the badge on the phone through a receipt event.

### 6.4 Presence without melting the system

Presence looks cheap and is not: every status change of a user is interesting to all their contacts.

- Derive presence from the **connection**: online when the first device connects, offline when the last one disconnects plus a grace period (say 30 s, to hide network blips).
- Publish **changes only**, and only to users who are **online and looking** (the contact list or the open conversation subscribes; a closed app does not).
- For groups above a few dozen members, **do not fan out presence** — show "last seen" on demand.
- Store `lastSeen` with a TTL in the cache; it is fine to lose it.

!!! tip "In the interview"

    Draw the gateway and the session registry early and say the key sentence: *"Gateways are stateful, so I keep them dumb: they hold sockets and route frames; ordering, storage and fan-out live in a stateless chat service partitioned by conversation."*

---

## 7. Bottlenecks, failure modes and trade-offs

| Where | What goes wrong | Mitigation | Trade-off |
|---|---|---|---|
| Gateway crash / deploy | 50 k users disconnected at once; reconnect storm | Jittered backoff in clients; gradual drain; spare capacity | Users see "connecting…" for seconds |
| Session registry stale | Message routed to a gateway the user left | TTL + re-registration on connect; on delivery failure, fall back to push + sync | Rare extra pushes |
| Hot conversation | One huge group saturates its sequencer partition | Split by bucket; for broadcast channels, relax per-user receipts | Weaker guarantees for huge groups |
| Group fan-out | 500 deliveries per message | Fan out per **gateway** (one publish per node that has members), not per user | More logic in gateways |
| Lost acks / retries | Duplicate messages | `clientMsgId` dedupe on server, `msgId` dedupe on device | Dedupe state per conversation |
| Out-of-order arrival | Messages displayed in wrong order | Display by server `seq`; gap detection triggers sync | Tiny delay on gaps |
| Presence storm | Millions of status updates | Changes only, subscribers only, no presence in large groups | Less "live" presence |
| Push provider limits | APNs/FCM throttling or outage | Collapse notifications per conversation; retry with backoff | Delayed alerts for offline users |

The trade-offs to **say out loud**: **per-conversation order, not global order** (cheap and sufficient), **at-least-once + dedupe instead of "exactly-once delivery"** (the only honest guarantee over a network), and **stateful gateways kept dumb** (state in the connection, logic elsewhere).

---

## 8. Try it in the playground

The `chat` scenario has gateways holding WebSocket connections, a pub/sub layer between them and storage for messages.

!!! tip "Try it"

    1. Run with the **load** profile and look at the pub/sub throughput, the gateway utilization and the delivery p99.
    2. Increase the load until a gateway saturates; add gateway replicas and observe that the bottleneck moves to the pub/sub or the database.
    3. Turn chaos on to kill a gateway: watch the reconnect spike hit the remaining nodes. What would jittered backoff change?
    4. Remove the pub/sub and connect gateways straight to the database (polling): compare latency and database load.

<div class="sdp" data-scenario="chat" data-mode="full" data-height="640" data-profile="load"></div>

[Open the full playground](../../../../playground/index.md){ .md-button }

---

## 9. Follow-up questions an interviewer asks

??? question "How would you support an event channel with 100 000 fans online during a festival?"

    It becomes **broadcast**, not group chat. Each gateway subscribes once to the channel's pub/sub topic and delivers locally to its connected members, so a message costs one publish per gateway (hundreds), not one per user (100 000). Drop per-user delivery/read receipts and presence, add **slow mode** (rate limit per member) and moderation, and let clients that join late fetch only the last N messages. Persist messages as usual; they are few compared to readers.

??? question "Why not order messages by timestamp?"

    Device clocks are wrong by seconds or minutes, and server clocks on different machines disagree by milliseconds — enough to reorder a fast back-and-forth. A server-assigned **sequence number per conversation**, issued by a single owner of that conversation, gives a total order that all members agree on. Timestamps are kept for display only.

??? question "What changes with end-to-end encryption?"

    The server routes and stores **ciphertext** only. Each device has its own keys, so a message to a group is encrypted per recipient device (or with a group key protocol), which increases fan-out. The server can no longer search, moderate content or show previews in push notifications; multi-device sync requires key distribution between a user's devices. The architecture (gateways, sequencing, store-and-forward) stays the same.

??? question "A gateway dies. Can messages be lost?"

    Not acknowledged ones. The sender only shows ✓ after the chat service stored the message, so a message in flight to a dead gateway is still in the DB. The recipient reconnects (to another gateway), sends `sync` with its cursors and gets every message after its last `seq`. The only loss is latency.

??? question "How do you implement 'delete for everyone' and edits?"

    As **new events** in the conversation: `edit {targetSeq, newBody}` and `delete {targetSeq}` get their own `seq`, are delivered like messages, and clients apply them to the earlier message. The original row is updated or tombstoned in storage. Ordering by `seq` makes edits arrive after the message they modify.

??? question "How do you store years of history efficiently?"

    Partition by `(conversation, time bucket)` so no partition grows without bound, keep recent buckets on fast storage and compact old ones; a wide-column store with an LSM engine fits the write-heavy, append-only pattern (Discord moved its message store from Cassandra to ScyllaDB for this access pattern). Media goes to object storage with lifecycle rules.

??? question "How would you go multi-region?"

    Users connect to the nearest region's gateways. Each conversation has a **home region** that owns its sequencer and primary storage; messages from users in other regions are forwarded there (adding cross-region latency only for them) and replicated back asynchronously for reads. Moving the home region to where most members are is an optimization.

---

## 10. Self-assessment rubric

| Level | What the answer contains |
|---|---|
| **Junior** | A REST API to send and poll messages; a messages table; maybe WebSockets without explaining routing between servers. |
| **Mid** | WebSocket gateways, a session registry and pub/sub to route between them; messages stored per conversation; offline users get push and sync on reconnect; receipts. |
| **Senior** | Per-conversation sequencing by a single owner; at-least-once + `clientMsgId` dedupe for exactly-once display; per-device cursors; presence derived from connections and published as changes to subscribers only; reconnect storms and gateway drains; storage partitioning with buckets; group vs. broadcast fan-out; E2E encryption trade-offs; multi-region home regions. |

**Related:** [Protocols (WebSockets, SSE)](../../edge/protocols/index.md), [Messaging semantics](../../messaging/semantics/index.md), [Partitioning](../../databases/partitioning/index.md), [Notification system case](../notification-system/index.md), [Hands-on 7](../../../hands-on/7/index.md).

!!! success "Best practices"

    - **Order messages per conversation, with a sequence assigned by the server** — a global order is neither needed nor affordable; per-conversation order is what users see.
    - **Deduplicate by a client message id** — a client that retries after a reconnect must not post the same message twice.
    - **Drain gateways gradually on deploy** — ask clients to reconnect over a window of minutes; closing every socket at once is a reconnect storm.
    - **Expire presence with heartbeats and a TTL** — a dropped connection never sends "goodbye"; without a TTL, users stay online forever.
    - **Scale gateways on open connections, not on CPU** — connections are the resource that runs out first in an idle chat.

---

## How it connects { #how-it-connects }

Which classes does this case test? Each branch is a class whose ideas the design relies on (blue), with the palette components where they show up (green):

``` diagram
flowchart LR
    CASE(["Chat"]) --> EDG["Edge<br/>WebSockets, L4 LB, stateful gateways"]:::tech
    CASE --> MSG["Messaging<br/>pub/sub per gateway, at-least-once"]:::tech
    CASE --> DIS["Distributed<br/>per-conversation sequence, no device clocks"]:::tech
    CASE --> DB["Databases<br/>wide-column, partition by conversation"]:::tech
    CASE --> REL["Reliability<br/>reconnect storms: backoff + jitter"]:::tech
    CASE --> CMP["Compute<br/>push for offline devices"]:::tech
    EDG -.-> k1["lb · app"]:::comp
    MSG -.-> k2["pubsub"]:::comp
    DB -.-> k3["nosql · cache<br/>(session registry)"]:::comp
    CMP -.-> k4["notifications"]:::comp
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

**Classes it tests:** [Edge — protocols](../../edge/protocols/index.md) · [Edge — load balancing](../../edge/load-balancing/index.md) · [Messaging — semantics](../../messaging/semantics/index.md) · [Distributed — time & clocks](../../distributed/time-clocks/index.md) · [Databases — partitioning](../../databases/partitioning/index.md) · [Reliability — patterns](../../reliability/patterns/index.md) · [Hands-on 7](../../../hands-on/7/index.md). **Palette components:** [`lb`](../../../reference/components/edge/index.md#lb) · [`app`](../../../reference/components/compute/index.md#app) · [`pubsub`](../../../reference/components/messaging/index.md#pubsub) · [`nosql`](../../../reference/components/storage/index.md#nosql) · [`cache`](../../../reference/components/storage/index.md#cache) · [`notifications`](../../../reference/components/compute/index.md#notifications) · [`objstore`](../../../reference/components/storage/index.md#objstore) · [`cdn`](../../../reference/components/edge/index.md#cdn). **Scenarios:** `chat`.

---

## References

- XU, A. *System Design Interview — An Insider's Guide*, vol. 1, ch. 12 "Design a Chat System"[^1].
- The WebSocket protocol[^2].
- How Discord stores messages at scale[^3].
- LAMPORT, L. *Time, Clocks, and the Ordering of Events in a Distributed System*[^4].

[^1]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1. Byte Code LLC, 2020.
[^2]: FETTE, I.; MELNIKOV, A. [RFC 6455 — The WebSocket Protocol](https://www.rfc-editor.org/rfc/rfc6455){target="_blank"}. IETF, 2011.
[^3]: INGRAM, B. [How Discord Stores Trillions of Messages](https://discord.com/blog/how-discord-stores-trillions-of-messages){target="_blank"}. Discord Blog, 2023.
[^4]: LAMPORT, L. Time, Clocks, and the Ordering of Events in a Distributed System. *Communications of the ACM*, 21(7), 1978.
