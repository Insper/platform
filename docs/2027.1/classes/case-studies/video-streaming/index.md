
> *"Design a video platform like YouTube: creators upload videos, the platform processes them, and millions of viewers watch them smoothly on any device and any network."*

Video is the case where **bandwidth, not requests, is the bottleneck**. A redirect is 500 bytes; one minute of HD video is tens of megabytes. Almost every design decision follows from that: viewers never touch your servers (a **CDN** delivers the bytes), uploads never pass through your servers (they go **straight to object storage**), and the heavy CPU work (**transcoding**) is a batch pipeline of workers that can take minutes. The interesting parts are the pipeline, **adaptive bitrate streaming** and the **economics** of egress.

BoxOffice uses video on every event page — artist trailers, venue tours, replays of livestreamed shows. Its volume is small next to YouTube, but the architecture is the same, and the day an artist announces a tour with a video, the CDN is what keeps the event page alive.

| | |
|---|---|
| **Difficulty** | :material-star::material-star::material-star: hard |
| **Key concepts** | pre-signed and resumable multipart uploads, transcoding as a DAG of queue-driven workers, renditions and the bitrate ladder, adaptive bitrate streaming (HLS/DASH), per-title encoding, CDN with origin shield, egress cost, long-tail popularity, asynchronous view counting |
| **Palette components** | [`client`](../../../reference/components/client/index.md#client), [`cdn`](../../../reference/components/edge/index.md#cdn), [`apigw`](../../../reference/components/edge/index.md#apigw), [`app`](../../../reference/components/compute/index.md#app), [`objstore`](../../../reference/components/storage/index.md#objstore), [`queue`](../../../reference/components/messaging/index.md#queue), [`worker`](../../../reference/components/compute/index.md#worker), [`sql`](../../../reference/components/storage/index.md#sql), [`nosql`](../../../reference/components/storage/index.md#nosql), [`analytics`](../../../reference/components/compute/index.md#analytics) |
| **Playground scenario** | `video-streaming` |

!!! abstract "What this case trains"

    - **Estimate** egress bandwidth, storage and transcoding capacity, and **explain** why bandwidth dominates cost.
    - **Design** an upload path that bypasses the application servers and survives flaky networks.
    - **Build** a transcoding pipeline as a DAG of idempotent, queue-driven tasks.
    - **Explain** adaptive bitrate streaming: renditions, segments, manifests and how the player switches.
    - **Design** delivery with a CDN, an origin shield and a strategy for the popularity long tail.

---

## 1. Clarify the requirements

([interview framework](../../intro/interview-framework/index.md))

### Functional requirements

1. Creators **upload** videos (up to a few GB) from web and mobile, and see processing progress.
2. The platform **transcodes** each upload into several resolutions and formats, with thumbnails.
3. Viewers **watch** with smooth playback that adapts to their connection; they can seek.
4. Basic **metadata**: title, description, owner; **view counts**.

### Non-functional requirements

| Quality | Target |
|---|---|
| **Playback** | Start in < 2 s; rebuffering rare (it is the metric viewers feel) |
| **Scale** | 50 M daily viewers, 30 min/day each; 500 k uploads/day |
| **Processing time** | A 10-minute video playable within minutes of upload (low resolutions first) |
| **Availability** | 99.99% for playback; uploads may be retried |
| **Durability** | Originals never lost (11 nines-class object storage) |
| **Cost** | Bandwidth is the largest bill: design for cache hit ratio and efficient encoding |

### Out of scope (say it explicitly)

Recommendations, comments, monetization/ads, live streaming (a follow-up), copyright detection (mention it as an asynchronous step), DRM details.

??? question "Questions to ask the interviewer"

    | Question | Why it matters |
    |---|---|
    | Video on demand only, or live too? | Live has seconds of budget: no time for a full transcoding pipeline. |
    | Max upload size and duration? | Multipart/resumable uploads, chunked transcoding. |
    | Which devices? | Formats (HLS for Apple, DASH elsewhere, CMAF for both), codecs (H.264 everywhere, AV1/HEVC where supported). |
    | Global audience? | CDN footprint, multi-CDN, regional storage. |
    | Is it OK if high resolutions appear later than low ones? | Lets you publish fast and finish the ladder in the background. |
    | How accurate must view counts be? | Exact and real-time is expensive; approximate and delayed is cheap. |

---

## 2. Back-of-the-envelope estimates

```python exec="1" source="tabbed-right"
# Video streaming: assumptions (illustrative; prices are placeholders, not quotes)
dau          = 50_000_000
watch_min    = 30            # minutes watched per viewer per day
bitrate_mbps = 3.0           # average delivered bitrate
peak_factor  = 3
uploads_day  = 500_000
video_min    = 10            # average upload duration
source_mbps  = 10            # bitrate of the uploaded original
ladder_mbps  = 10.6          # sum of all rendition bitrates (240p..1080p)
renditions   = 6
cdn_hit      = 0.95          # share of bytes served from CDN caches
usd_per_gb   = 0.01          # illustrative blended CDN price

egress_pb_day  = dau * watch_min * 60 * bitrate_mbps / 8 / 1e9
concurrent     = dau * watch_min / 1_440                   # Little's Law: viewers watching now
peak_streams   = concurrent * peak_factor
peak_tbps      = peak_streams * bitrate_mbps / 1e6
origin_tb_day  = egress_pb_day * 1e3 * (1 - cdn_hit)
raw_tb_day     = uploads_day * video_min * 60 * source_mbps / 8 / 1e6
encoded_tb_day = uploads_day * video_min * 60 * ladder_mbps / 8 / 1e6
encode_workers = uploads_day * video_min * renditions / 1_440   # 1 rendition-minute per worker-minute
cdn_usd_day    = egress_pb_day * 1e6 * usd_per_gb

rows = [
    ("egress_pb_day", egress_pb_day, "PB/day"), ("concurrent", concurrent, "streams"),
    ("peak_streams", peak_streams, "streams"), ("peak_tbps", peak_tbps, "Tbit/s"),
    ("origin_tb_day", origin_tb_day, "TB/day"), ("raw_tb_day", raw_tb_day, "TB/day"),
    ("encoded_tb_day", encoded_tb_day, "TB/day"), ("encode_workers", encode_workers, "workers"),
    ("cdn_usd_day", cdn_usd_day, "USD/day"),
]
print("| quantity | value | unit |\n|---|---:|---|")
for name, value, unit in rows:
    v = f"{value:,.0f}" if abs(value) >= 100 else f"{value:,.2f}"
    print(f"| `{name}` | {v} | {unit} |")
```

What the numbers tell us:

- Viewers pull **~34 PB per day**, **~9 Tbit/s at peak**. No data center serves that from a few servers. ⇒ the **CDN** delivers the bytes, close to viewers; our origin must only see the misses.
- Even with a 95% CDN hit ratio, the origin (object storage) serves **~1.7 PB/day** ⇒ an **origin shield** (a mid-tier cache) between the CDN edges and storage, so that a miss in 300 edge locations becomes one fetch.
- Uploads add **~375 TB/day of originals** and **~400 TB/day of encoded renditions** ⇒ object storage with lifecycle rules (move old, rarely watched renditions to colder tiers; keep originals in archive storage to re-encode later).
- Transcoding needs on the order of **~20 k encoding workers** busy all day (under this illustrative speed). ⇒ elastic, queue-driven workers, ideal for cheap preemptible/spot capacity.
- With an illustrative price of 1 cent per GB, delivery costs **hundreds of thousands of dollars per day**: every percent of bitrate saved by better encoding or every percent of cache hit ratio is real money. ⇒ the "boring" optimizations (codec choice, per-title encoding) are architecture.

---

## 3. API

```http
POST /v1/videos                                   → 201 {videoId, uploadId, partSize, partUrls[]}
     {"title": "Rock in Rio 2027 — official trailer", "sizeBytes": 734003200, "contentType": "video/mp4"}
PUT  <pre-signed partUrl #n>   (bytes of part n, straight to object storage) → 200 ETag
POST /v1/videos/{videoId}/complete  {"parts": [{"n": 1, "etag": "…"}, …]}   → 202 {status: PROCESSING}
GET  /v1/videos/{videoId}                          → 200 {status: PROCESSING|READY|FAILED,
                                                          progress, manifestUrl, thumbnails[]}

GET  https://cdn.example/vod/{videoId}/master.m3u8         (manifest, from the CDN)
GET  https://cdn.example/vod/{videoId}/720p/seg_00042.m4s  (segment, from the CDN)

POST /v1/events/playback   [{"videoId": "…", "type": "start|heartbeat|rebuffer|end", "ts": …}]  → 202
```

- The application **never proxies video bytes**: it signs URLs. The object store and the CDN do the heavy lifting.
- **Multipart upload**: the file is split into parts (e.g. 8–64 MB) uploaded in parallel and retried independently; `complete` assembles them. A dropped connection costs one part, not the whole file.
- Playback **beacons** are batched and asynchronous: they feed view counts and quality metrics (startup time, rebuffering).

---

## 4. Data model

```sql
CREATE TABLE video (
    video_id     UUID PRIMARY KEY,
    owner_id     BIGINT      NOT NULL,
    title        TEXT        NOT NULL,
    status       TEXT        NOT NULL,   -- UPLOADING | PROCESSING | READY | FAILED | BLOCKED
    duration_s   INT,
    source_key   TEXT,                   -- raw/{video_id}/source.mp4
    manifest_key TEXT,                   -- vod/{video_id}/master.m3u8
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transcode_task (
    video_id   UUID,
    task       TEXT,                     -- 'split', 'encode:720p:chunk-007', 'package', 'thumbs'
    status     TEXT NOT NULL,            -- PENDING | RUNNING | DONE | FAILED
    attempts   INT  NOT NULL DEFAULT 0,
    output_key TEXT,
    PRIMARY KEY (video_id, task)
);
```

```text
# Object storage layout
raw/{video_id}/source.mp4                    original, kept (archive tier after 30 days)
vod/{video_id}/master.m3u8                   master manifest (lists renditions)
vod/{video_id}/{rendition}/index.m3u8        media playlist per rendition
vod/{video_id}/{rendition}/seg_00001.m4s     ~4 s segments (CMAF fragments)
thumbs/{video_id}/{n}.jpg
```

| Data | Store | Why |
|---|---|---|
| Originals, segments, thumbnails | Object store (`objstore`) | Huge, immutable blobs; cheap, durable, served via CDN |
| Video metadata, task state | SQL (`sql`) | Small, relational, status transitions |
| View counts, playback metrics | Stream → NoSQL counters (`nosql`) and analytics (`analytics`) | Very high write rate, approximate is fine |
| Transcoding work | Queue (`queue`) | Spreads tasks over elastic workers; retries |
| Delivery | CDN (`cdn`) with origin shield | Bytes close to viewers; protects the origin |

---

## 5. High-level design

``` diagram-sim
flowchart LR
    cr([Creator]) --> api["Video API"]
    api --> meta[("Metadata<br/>SQL")]
    cr -. "parts via<br/>pre-signed URLs" .-> raw[("Object store<br/>raw/")]
    raw -. upload completed .-> q[["Transcode queue"]]
    q --> w["Transcoding workers<br/>split · encode · package"]
    w --> vod[("Object store<br/>vod/")]
    w --> meta
    v([Viewer]) --> cdn["CDN edge"]
    cdn --> shield["Origin shield"]
    shield --> vod
    v -. playback beacons .-> an["Analytics<br/>views, QoE"]
```

Upload to first playback:

``` diagram-sim
sequenceDiagram
    autonumber
    participant C as Creator app
    participant A as Video API
    participant S as Object store
    participant Q as Queue
    participant W as Workers
    participant V as Viewer
    participant E as CDN
    C->>A: POST /videos (size, type)
    A-->>C: videoId + pre-signed part URLs
    C->>S: PUT parts in parallel (retry failed parts)
    C->>A: POST /complete
    A->>Q: enqueue split(videoId)
    Q->>W: split into chunks, enqueue encode tasks
    W->>S: write 240p/360p first → status READY
    W->>S: write 720p/1080p later, update manifest
    V->>E: GET master.m3u8, then segments
    E->>S: miss → fetch once via shield
    E-->>V: segments (cached for everybody)
```

---

## 6. Deep dives

### 6.1 Uploads that bypass the application

- **Pre-signed URLs**: the API authorizes the upload and returns URLs that let the client `PUT` directly into the object store for a few minutes. App servers handle kilobytes of JSON, never gigabytes of video ([object storage](../../databases/specialized/index.md)).
- **Multipart and resumable**: parts upload in parallel and are retried individually; the client stores `uploadId` so it can resume after the app is closed. Incomplete uploads are cleaned up by a lifecycle rule.
- **Integrity and safety**: a checksum per part; after `complete`, an asynchronous step validates the container, scans for malware and runs content checks before publishing.
- **Upload close to the user**: object stores offer accelerated/edge ingestion; for a global audience, upload to the nearest region and replicate.

### 6.2 Transcoding as a DAG of tasks

Encoding a 2-hour video on one machine takes too long. Split it, encode the pieces in parallel, put them back together:

``` diagram-sim
flowchart LR
    src["source.mp4"] --> split["Split into<br/>~10 s chunks<br/>(at keyframes)"]
    split --> e1["encode 240p…1080p<br/>chunk 1"]
    split --> e2["encode 240p…1080p<br/>chunk 2"]
    split --> e3["encode 240p…1080p<br/>chunk N"]
    src --> th["Thumbnails"]
    src --> au["Audio tracks"]
    e1 --> pkg["Package<br/>HLS / DASH (CMAF)"]
    e2 --> pkg
    e3 --> pkg
    au --> pkg
    pkg --> pub["Publish<br/>manifest + status"]
    th --> pub
```

- **Queue-driven**: each node of the DAG is a task message; a small orchestrator (or a workflow engine) enqueues a task when its inputs are ready ([async work](../../compute/async-work/index.md)).
- **Idempotent tasks**: a task writes to a deterministic key (`vod/{id}/720p/chunk-007`) — running it twice produces the same object, so retries and duplicate deliveries are harmless.
- **Prioritize**: encode low resolutions first and publish as soon as they exist; higher rungs and expensive codecs (AV1) follow. Popular creators or BoxOffice's official trailers can go to a high-priority queue.
- **Elastic and cheap**: encoding is CPU/GPU-bound and restartable — run it on autoscaled preemptible instances; a preempted task is simply retried.

### 6.3 Adaptive bitrate streaming

Each video is encoded into a **ladder** of renditions, each cut into short segments (2–6 s). The player downloads a **manifest** that lists the renditions, measures its throughput and buffer, and picks the rendition of the **next** segment — switching up or down without stopping ([HLS](https://www.rfc-editor.org/rfc/rfc8216){target="_blank"}, MPEG-DASH).

| Rendition | Resolution | Bitrate (H.264, illustrative) | Typical network |
|---|---|---|---|
| 240p | 426×240 | 0.4 Mbit/s | Weak mobile |
| 360p | 640×360 | 0.8 Mbit/s | 3G / congested |
| 480p | 854×480 | 1.4 Mbit/s | Average mobile |
| 720p | 1280×720 | 3.0 Mbit/s | Good mobile / Wi-Fi |
| 1080p | 1920×1080 | 5.0 Mbit/s | Wi-Fi / broadband |
| 2160p (4K) | 3840×2160 | ~15 Mbit/s (less with HEVC/AV1) | Fast broadband, TVs |

```text
#EXTM3U
#EXT-X-VERSION:7
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"
360p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
1080p/index.m3u8
```

- **Start low, climb fast**: the first segment comes from a low rung so playback starts in under 2 s; the player climbs as its buffer fills.
- **Per-title encoding**: a cartoon needs far fewer bits than a concert with confetti and strobes for the same visual quality. Analyzing each video and choosing its own ladder (Netflix's "per-title encode optimization") saves a large share of bandwidth for simple content.
- **Codecs**: H.264 plays everywhere; HEVC and AV1 deliver the same quality with notably fewer bits but cost much more CPU to encode and are not supported on every device. Encode the expensive codecs only for videos that get enough views to pay for it.

### 6.4 Delivery: CDN, shield and the long tail

- **CDN edges** cache manifests and segments near viewers. Segments are **immutable** (new content = new key), so they can be cached for a long time without invalidation ([DNS and CDN](../../edge/dns-cdn/index.md)).
- **Origin shield**: one regional cache layer in front of the object store; all edges miss to the shield, which misses to the origin at most once per object — essential for a video that goes viral minutes after upload.
- **Popularity is a long tail**: a small fraction of videos gets most views. Push (**pre-position**) the head to edges ahead of demand — e.g. BoxOffice's trailer before a tour announcement — and let the long tail be pulled on demand, accepting a slower first start.
- **Multi-CDN** and ISP-embedded caches (as Netflix does with Open Connect) are the next steps at very large scale, for cost and resilience.
- **View counts** come from playback beacons through a stream into aggregated counters, deduplicated per session and filtered for bots; exact real-time counts are not needed.

!!! tip "In the interview"

    Say early: *"The bytes never go through my servers: uploads go to object storage with pre-signed URLs, and playback comes from the CDN. My servers handle metadata, orchestration and signatures."* It shows you found the real bottleneck.

---

## 7. Bottlenecks, failure modes and trade-offs

| Where | What goes wrong | Mitigation | Trade-off |
|---|---|---|---|
| Egress bandwidth | Cost and capacity explode | CDN, high hit ratio, efficient codecs, per-title encoding | Encoding CPU cost; device support |
| Viral new video | Cold CDN: all edges miss together | Origin shield, request collapsing, pre-positioning | Shield is one more tier |
| Upload over bad networks | Large uploads fail at 95% | Multipart + resumable uploads | Client complexity |
| Transcoding backlog | Upload spike; videos stuck in PROCESSING | Autoscale on queue depth, priorities, publish low rungs first | Cost of extra workers; HD appears later |
| Worker failure / preemption | Task lost mid-encode | Idempotent tasks with deterministic outputs; retries with attempt limit; DLQ | Wasted partial work |
| Poison input | Corrupt file crashes encoders repeatedly | Validation step; DLQ after N attempts; mark FAILED and tell the creator | Some uploads rejected |
| Rebuffering | Player picks too-high rendition | ABR with buffer-based logic; short segments; more low rungs | More segments/requests |
| Storage growth | Hundreds of TB/day | Lifecycle tiers; drop rarely watched high rungs and re-encode on demand from the original | Slower first view for old videos |

The trade-offs to **say out loud**: **encoding cost vs. delivery cost** (spend CPU once to save bandwidth on every view — worth it only for videos that get watched), **time to publish vs. completeness** (low resolutions first), and **push vs. pull to the edge** (pre-position the head, pull the tail).

---

## 8. Try it in the playground

The `video-streaming` scenario has the object store, a CDN in front of it, and a queue of transcoding workers fed by uploads.

!!! tip "Try it"

    1. Run with the **load** profile and look at the CDN hit ratio and the egress from the object store (origin).
    2. Lower the CDN hit ratio (or remove the CDN): how much more traffic does the origin take? That is why the shield and pre-positioning exist.
    3. Switch to **spike** to simulate an upload wave: watch the transcoding queue grow; add workers and find how many keep the backlog flat.
    4. Turn chaos on to kill workers mid-task: does the queue redeliver, and do retries finish the videos?

<div class="sdp" data-scenario="video-streaming" data-mode="full" data-height="640" data-profile="load"></div>

[Open the full playground](../../../../playground/index.md){ .md-button }

---

## 9. Follow-up questions an interviewer asks

??? question "What changes for live streaming (e.g. a BoxOffice livestreamed concert)?"

    The budget drops from minutes to seconds. The encoder ingests a live feed (RTMP/SRT/WebRTC) and produces the ladder **in real time** — no chunk-parallel DAG; segments are published as they are produced, and playlists are updated continuously. Low-latency HLS / chunked CMAF deliver partial segments to reach a few seconds of glass-to-glass latency. The CDN still carries the bytes, and the audience spike at the show's start is predictable, so pre-warm capacity. A replay is just the recorded segments turned into VOD.

??? question "A creator's video goes viral ten minutes after upload. What happens?"

    Only low resolutions may exist yet; the higher rungs are being encoded — bump the video to the high-priority queue. On delivery, every CDN edge misses at once: the origin shield and **request collapsing** (one fetch for many concurrent misses of the same segment) protect the object store. Manifests have short TTLs so new renditions appear; segments are immutable and cached long.

??? question "How do you reduce the delivery bill?"

    In order of impact: raise the cache hit ratio (shield, pre-positioning, longer TTLs for immutable segments); spend fewer bits per view (per-title encoding, HEVC/AV1 for popular videos, capping resolution on small screens); negotiate or mix CDNs; and at very large scale, place caches inside ISPs. Measure **cost per hour watched** as the metric.

??? question "How do you count views accurately?"

    Define a view (e.g. ≥ 30 s watched), send batched beacons, deduplicate per session/device in the stream, filter bots and replays, aggregate into counters asynchronously. Show an approximate, slightly delayed count publicly; keep the exact, audited count for payments to creators.

??? question "Do you keep the original upload? Why?"

    Yes, in cheap archive storage. Codecs improve (H.264 → HEVC → AV1) and ladders change; re-encoding from the original gives better quality than transcoding an already compressed rendition. It also allows dropping rarely watched renditions and recreating them on demand.

??? question "How do you protect premium content?"

    Signed URLs or tokens with short expiry on manifests (the CDN validates them at the edge), and DRM (Widevine, FairPlay, PlayReady) encrypting segments with keys delivered by a license server only to authorized players. It adds a license-server dependency to playback start, so it must be highly available.

---

## 10. Self-assessment rubric

| Level | What the answer contains |
|---|---|
| **Junior** | Upload through the app server into storage; serve the file through the app or a CDN; a videos table. One format, no adaptation. |
| **Mid** | Pre-signed uploads to object storage; queue + transcoding workers producing several resolutions; HLS/DASH with a CDN; metadata in SQL; asynchronous view counts. |
| **Senior** | Quantifies egress and cost; multipart/resumable uploads; chunked DAG pipeline with idempotent tasks, priorities and low-rungs-first publishing; ABR mechanics and per-title encoding; codec trade-offs; origin shield, request collapsing, pre-positioning of the head vs. pulling the tail; storage lifecycle; live-streaming differences. |

**Related:** [DNS and CDN](../../edge/dns-cdn/index.md), [Specialized storage (object stores)](../../databases/specialized/index.md), [Async work](../../compute/async-work/index.md), [FinOps](../../cloud-native/finops/index.md), [Hands-on 7](../../../hands-on/7/index.md) (queues and workers).

!!! success "Best practices"

    - **Upload straight to object storage with pre-signed URLs** — application servers never proxy gigabytes, and an upload survives a deploy.
    - **Make each transcoding job idempotent per (video, rendition)** — a retried job overwrites the same output instead of producing a second copy.
    - **Give segments immutable, versioned names and long cache headers** — the CDN can then keep them forever, and the hit ratio stays near the top.
    - **Track egress cost per GB and the CDN hit ratio** — egress dominates the bill; a 1-point drop in hit ratio can be a large share of the origin's traffic.
    - **Encode the long tail in fewer renditions** — most videos are rarely watched; transcode them on demand or in fewer qualities.

---

## How it connects { #how-it-connects }

Which classes does this case test? Each branch is a class whose ideas the design relies on (blue), with the palette components where they show up (green):

``` diagram
flowchart LR
    CASE(["Video streaming"]) --> EST["Estimation<br/>egress bandwidth dominates"]:::tech
    CASE --> DB["Databases<br/>object store, pre-signed uploads"]:::tech
    CASE --> CMP["Compute<br/>transcoding DAG, idempotent workers"]:::tech
    CASE --> MSG["Messaging<br/>transcode queue"]:::tech
    CASE --> EDG["Edge<br/>CDN, origin shield, ABR segments"]:::tech
    CASE --> FIN["Cloud-native<br/>FinOps: cost of egress"]:::tech
    DB -.-> k1["objstore · sql"]:::comp
    CMP -.-> k2["worker"]:::comp
    MSG -.-> k3["queue"]:::comp
    EDG -.-> k4["cdn · analytics"]:::comp
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

**Classes it tests:** [Edge — DNS & CDN](../../edge/dns-cdn/index.md) · [Databases — specialized](../../databases/specialized/index.md) (object storage) · [Compute — async work](../../compute/async-work/index.md) · [Messaging — queues & pub/sub](../../messaging/queues-pubsub/index.md) · [Cloud-native — FinOps](../../cloud-native/finops/index.md) · [Hands-on 7](../../../hands-on/7/index.md). **Palette components:** [`cdn`](../../../reference/components/edge/index.md#cdn) · [`objstore`](../../../reference/components/storage/index.md#objstore) · [`queue`](../../../reference/components/messaging/index.md#queue) · [`worker`](../../../reference/components/compute/index.md#worker) · [`sql`](../../../reference/components/storage/index.md#sql) · [`analytics`](../../../reference/components/compute/index.md#analytics). **Scenarios:** `video-streaming`, `cdn-static`.

---

## References

- XU, A. *System Design Interview — An Insider's Guide*, vol. 1, ch. 14 "Design YouTube"[^1].
- HTTP Live Streaming (HLS) specification[^2] and MPEG-DASH[^3].
- Netflix's per-title encoding[^4].

[^1]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1. Byte Code LLC, 2020.
[^2]: PANTOS, R.; MAY, W. [RFC 8216 — HTTP Live Streaming](https://www.rfc-editor.org/rfc/rfc8216){target="_blank"}. IETF, 2017.
[^3]: ISO/IEC 23009-1. *Information technology — Dynamic adaptive streaming over HTTP (DASH) — Part 1: Media presentation description and segment formats*.
[^4]: AARON, A. et al. [Per-Title Encode Optimization](https://netflixtechblog.com/per-title-encode-optimization-7e99442b62a2){target="_blank"}. Netflix TechBlog, 2015.
