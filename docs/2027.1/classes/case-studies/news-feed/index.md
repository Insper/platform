
> *"Design the home feed of a social network like Instagram or X: users follow other users and, when they open the app, see the latest posts of the people they follow."*

The news feed is the classic **read-heavy, fan-out** problem. One write (a post) must become visible in the feeds of everybody who follows the author — two people for most users, fifty million for a pop star. The interview turns on one decision — **do the work when the post is written, or when the feed is read?** — and on what happens at the extremes of that decision: celebrities, inactive users, deleted posts and ranking.

BoxOffice has the same shape: fans **follow** artists and venues, and the "Following" tab shows tour announcements, new dates and presale codes. When a stadium-level artist with millions of followers announces a tour, BoxOffice faces exactly the celebrity problem of this page — at the worst moment, because everyone will open the app at once.

| | |
|---|---|
| **Difficulty** | :material-star::material-star::material-star: hard |
| **Key concepts** | fan-out on write (push) vs. on read (pull) vs. hybrid, the celebrity problem, timeline cache of IDs, hydration, ranking pipeline, cursor pagination, media via CDN |
| **Palette components** | [`lb`](../../../reference/components/edge/index.md#lb), [`app`](../../../reference/components/compute/index.md#app), [`cache`](../../../reference/components/storage/index.md#cache), [`nosql`](../../../reference/components/storage/index.md#nosql), [`kafka`](../../../reference/components/messaging/index.md#kafka), [`worker`](../../../reference/components/compute/index.md#worker), [`objstore`](../../../reference/components/storage/index.md#objstore), [`cdn`](../../../reference/components/edge/index.md#cdn) |
| **Playground scenario** | `news-feed` |

!!! abstract "What this case trains"

    - **Estimate** the write amplification of fan-out and the memory of a timeline cache.
    - **Compare** fan-out on write, fan-out on read and the hybrid model, and **justify** a threshold for celebrities.
    - **Design** the read path: timeline IDs from a cache, hydration with batched lookups, merge and ranking within a latency budget.
    - **Explain** why feeds paginate with cursors, not offsets.
    - **Handle** edge cases: inactive users, deletions, privacy changes, new users with an empty feed.

---

## 1. Clarify the requirements

([interview framework](../../intro/interview-framework/index.md))

### Functional requirements

1. A user **publishes** a post (text, optional images/video).
2. A user **follows** / unfollows other users (asymmetric: following is not friendship).
3. A user opens the **home feed**: posts of the people they follow, newest first (or ranked), paginated with infinite scroll.
4. Posts show author, counts (likes, comments) and media.

### Non-functional requirements

| Quality | Target |
|---|---|
| **Latency** | Feed p99 < 300 ms (it is the first screen of the app) |
| **Freshness** | A new post appears in followers' feeds within a few seconds (eventual consistency is fine) |
| **Scale** | 100 M daily active users; heavy-tailed follower counts (up to tens of millions) |
| **Availability** | 99.95%; a degraded feed (slightly stale, fewer items) beats an error page |
| **Durability** | A published post is never lost; feeds themselves can be rebuilt |

### Out of scope (say it explicitly)

Comments and likes as features (we only show counts), search, notifications, ads ranking, direct messages. Each is its own design problem.

??? question "Questions to ask the interviewer"

    | Question | Why it matters |
    |---|---|
    | Chronological or ranked feed? | Ranking adds a candidate → score → re-rank pipeline and changes what you cache. |
    | Max followers? Max followees? | The tail of the distribution decides push vs. pull. |
    | How fresh must the feed be? | Seconds allow asynchronous fan-out; "immediately" pushes toward pull. |
    | Mostly text or media-heavy? | Media goes to object storage + CDN; the feed carries URLs. |
    | How many users are daily active vs. registered? | Fan-out to inactive users is wasted work and memory. |
    | Can posts be edited, deleted, made private? | Pushed copies must be filtered or invalidated on read. |

---

## 2. Back-of-the-envelope estimates

```python exec="1" source="tabbed-right"
# News feed: assumptions (illustrative)
dau            = 100_000_000
posts_per_dau  = 0.2          # most users read, few post
reads_per_dau  = 10           # feed opens / refreshes per day
peak_factor    = 3
avg_followers  = 200          # average fan-out per post (the tail is much larger)
timeline_len   = 800          # post IDs kept per cached feed
id_b           = 8            # one post ID (64-bit)
cache_overhead = 2            # data-structure overhead in the cache
post_b         = 1_000        # text + metadata
media_share    = 0.1          # posts with an image
image_b        = 500_000

posts_day      = dau * posts_per_dau
write_qps      = posts_day / 86_400
read_qps       = dau * reads_per_dau / 86_400
peak_read_qps  = read_qps * peak_factor
fanout_qps     = write_qps * avg_followers          # timeline inserts per second (push)
timeline_gb    = dau * timeline_len * id_b * cache_overhead / 1e9
posts_tb_year  = posts_day * post_b * 365 / 1e12
media_tb_day   = posts_day * media_share * image_b / 1e12

rows = [
    ("posts_day", posts_day, "posts"), ("write_qps", write_qps, "posts/s"),
    ("read_qps", read_qps, "req/s"), ("peak_read_qps", peak_read_qps, "req/s"),
    ("fanout_qps", fanout_qps, "inserts/s"), ("timeline_gb", timeline_gb, "GB"),
    ("posts_tb_year", posts_tb_year, "TB"), ("media_tb_day", media_tb_day, "TB/day"),
]
print("| quantity | value | unit |\n|---|---:|---|")
for name, value, unit in rows:
    v = f"{value:,.0f}" if abs(value) >= 100 else f"{value:,.2f}"
    print(f"| `{name}` | {v} | {unit} |")
```

What the numbers tell us:

- Reads (**~12 k/s, ~35 k/s at peak**) outnumber posts (**~230/s**) by 50:1. ⇒ make reads cheap, even at the cost of more work on writes.
- But push fan-out turns 230 posts/s into **~46 k timeline inserts/s** on average — and the average hides the tail: one post by an account with 50 M followers is **50 M inserts** by itself. ⇒ the write path must be **asynchronous** (queue + workers), and celebrities need special handling.
- Cached timelines of 800 IDs for every daily user take **~1.3 TB of RAM** — a large but ordinary cache cluster (tens of nodes). Keeping only **IDs**, not posts, is what makes this affordable; caching for **active** users only cuts it further.
- Posts are **~7 TB/year** (a partitioned store), media **~1 TB/day** (object storage + CDN — never in the database).

---

## 3. API

```http
POST /v1/posts                               → 201 {postId, createdAt}
     {"text": "Tour announced! Presale Friday 10:00", "mediaIds": ["m_81f…"]}
POST /v1/media                               → 201 {mediaId, uploadUrl}   (pre-signed PUT to object store)

GET  /v1/feed?limit=20&cursor=eyJ0cyI6…      → 200 {items: [Post…], nextCursor}
GET  /v1/users/{id}/posts?cursor=…           → 200 {items: [Post…], nextCursor}   (profile timeline)

PUT    /v1/users/{id}/followers/me           → 204   (follow)
DELETE /v1/users/{id}/followers/me           → 204   (unfollow)
```

- **Cursor**, not page number: `cursor` encodes `(score or timestamp, postId)` of the last item seen. New posts arriving at the top do not shift the pages (no duplicates, no gaps) and the query is an index seek, not `OFFSET 4000`.
- Media is uploaded **directly** to object storage with a pre-signed URL; the post only references `mediaId`.

---

## 4. Data model

```sql
-- Posts: partitioned by author, newest first (wide-column, e.g. Cassandra)
CREATE TABLE posts_by_author (
    author_id  BIGINT,
    post_id    BIGINT,          -- Snowflake-style: time-ordered, unique
    text       TEXT,
    media      LIST<TEXT>,
    visibility TEXT,
    PRIMARY KEY ((author_id), post_id)
) WITH CLUSTERING ORDER BY (post_id DESC);

-- Social graph, stored in both directions
CREATE TABLE followers (user_id BIGINT, follower_id BIGINT, PRIMARY KEY ((user_id), follower_id));
CREATE TABLE following (user_id BIGINT, followee_id BIGINT, PRIMARY KEY ((user_id), followee_id));
```

```text
# Timeline cache (Redis sorted set, score = post timestamp), trimmed to 800 entries
feed:{user_id}   →  { (1767261600123, 918273645), (1767261598001, 918273511), ... }

# Post cache for hydration (hash per post) and counters
post:{post_id}   →  { author_id, text, media, created_at }
likes:{post_id}  →  1532
```

| Data | Store | Why |
|---|---|---|
| Posts | Wide-column NoSQL (`nosql`), partition = author | Write-heavy, append-only, read "latest N of author" — one partition scan |
| Social graph | NoSQL tables in both directions (or a graph service, e.g. TAO-style) | "Followers of X" for fan-out, "followees of Y" for pull |
| Home timelines | Cache (`cache`): sorted set of IDs per user | Rebuildable, read on every feed open, ~1.3 TB |
| Post objects | Cache (`cache`) in front of the posts store | Hydration does multi-gets of 20–50 posts per feed page |
| Media | Object store (`objstore`) + CDN (`cdn`) | Large immutable blobs, served at the edge |
| Fan-out jobs | Kafka (`kafka`) topic `post-created` | Decouples posting from fan-out; absorbs bursts |

---

## 5. High-level design

``` diagram-sim
flowchart LR
    u([App]) --> lb["Load balancer"]
    lb --> ps["Post service"]
    ps --> pdb[("Posts store<br/>by author")]
    ps --> k[["Kafka<br/>post-created"]]
    k --> fw["Fan-out workers"]
    fw --> g[("Social graph<br/>followers")]
    fw --> tl[("Timeline cache<br/>feed:{user} → IDs")]
    lb --> fs["Feed service"]
    fs --> tl
    fs --> pc[("Post cache")]
    pc --> pdb
    fs --> rk["Ranking"]
    u -. images .-> cdn["CDN"] --> obj[("Object store")]
```

**Write path:** the post service stores the post and publishes `post-created`; it returns `201` immediately. Fan-out workers read the author's followers in pages and push the post ID into each **active** follower's timeline (`ZADD` + `ZREMRANGEBYRANK` to trim).

**Read path:**

``` diagram-sim
sequenceDiagram
    autonumber
    participant A as App
    participant F as Feed service
    participant T as Timeline cache
    participant C as Celebrity posts
    participant P as Post cache
    participant R as Ranking
    A->>F: GET /v1/feed?limit=20
    F->>T: ZREVRANGE feed:42 0 199
    T-->>F: 200 post IDs (pushed)
    F->>C: latest posts of followed celebrities (pull)
    C-->>F: 30 post IDs
    F->>F: merge, drop deleted / blocked
    F->>P: multi-get 230 posts (batched)
    P-->>F: post objects
    F->>R: score candidates
    R-->>F: top 20
    F-->>A: 20 posts + nextCursor
```

---

## 6. Deep dives

### 6.1 Fan-out on write, on read, or both

=== "Fan-out on write (push)"

    When a post is created, insert its ID into every follower's precomputed timeline. Reading the feed is a single cache read — **fast and predictable**. Costs: write amplification proportional to followers, wasted work for followers who never log in, and a delay of minutes for an account with tens of millions of followers.

=== "Fan-out on read (pull)"

    Store posts only by author. When a user opens the feed, fetch the latest posts of each of their followees and merge them. Writes are trivial and always fresh. Costs: every feed open does **hundreds of queries** (one per followee, or a scatter-gather over partitions) — slow and expensive at 35 k reads/s.

=== "Hybrid (what large networks do)"

    Push for ordinary authors; **pull for celebrities** (authors above a follower threshold). At read time, merge the pushed timeline with the latest posts of the few celebrities the user follows — usually a handful of cheap, highly cached queries (a celebrity's recent posts are read by millions, so they are always in cache).

| | Push | Pull | Hybrid |
|---|---|---|---|
| Read latency | Lowest (one cache read) | Highest (N queries + merge) | Low (cache read + few celebrity reads) |
| Write cost | Followers × posts | One insert | Followers × posts, capped at threshold |
| Freshness | Seconds to minutes (queue) | Immediate | Seconds |
| Celebrity post | Millions of inserts | Free | Free (pulled) |
| Inactive users | Wasted inserts | Free | Skip them; rebuild on login |

How much work does a threshold save? With a heavy-tailed distribution of followers, a tiny share of authors produces most of the fan-out:

```python exec="1" source="tabbed-right"
# Who pays for push fan-out? Synthetic heavy-tailed follower counts (illustrative)
import random

random.seed(42)
authors = 200_000
followers = [min(50_000_000, int(60 / (1 - random.random()) ** 1.25)) for _ in range(authors)]
total = sum(followers)                  # timeline inserts if every author posts once
followers.sort()

print(f"median followers: {followers[authors // 2]:,}  ·  max: {followers[-1]:,}\n")
print("| threshold | celebrities | celebrities_pct | writes_avoided_pct |\n|---:|---:|---:|---:|")
for threshold in (10_000, 100_000, 1_000_000):
    celeb = [f for f in followers if f >= threshold]
    print(f"| {threshold:,} | {len(celeb):,} | {len(celeb) / authors:.2%} | {sum(celeb) / total:.1%} |")
```

Pulling the posts of a fraction of a percent of the authors removes most of the fan-out writes. The threshold is a tuning knob: lower it and reads get a bit more expensive (more celebrities to merge per user), raise it and celebrity posts take longer to fan out.

### 6.2 The timeline cache and hydration

- **Store IDs, not posts.** A post can be edited, deleted or have its counters change; copying it into 200 timelines would make every change a fan-out. A timeline is a list of `(score, post_id)`; the content is **hydrated** at read time with one batched multi-get from the post cache.
- **Trim** each timeline to a few hundred entries (`ZREMRANGEBYRANK`). Nobody scrolls back 5 000 posts through the home feed; older history comes from the pull path.
- **Active users only.** Fan-out workers skip users who have not opened the app in, say, 30 days. When such a user returns, the feed service **rebuilds** the timeline with a pull (slow once, then cached) — a classic cache-miss path ([caching patterns](../../caching/patterns/index.md)).
- **Filter on read.** Deleted posts, blocked authors and posts that became private are removed during hydration (the post cache says `deleted`), so the timeline itself never needs to be cleaned synchronously.
- **Partition** the timeline cache by `user_id` (consistent hashing); a user's feed lives on one shard, so the read is a single round trip.

### 6.3 Ranking

A chronological feed is "sort by time". A ranked feed is a small pipeline that must fit in the latency budget:

``` diagram-sim
flowchart LR
    cand["Candidates<br/>~500 IDs<br/>(pushed + pulled)"] --> feat["Features<br/>author affinity, age,<br/>engagement, media type"]
    feat --> score["Scoring model<br/>(lightweight)"]
    score --> rerank["Re-rank<br/>diversity, dedupe,<br/>business rules"]
    rerank --> page["Top 20"]
```

- **Candidate generation** is the timeline (push + pull); features come from precomputed stores (affinity between user and author computed offline), never from expensive live queries.
- Precompute when possible: rank the first page **when the user is likely to open the app** (or right after fan-out) and cache it for a few minutes.
- Keep a **fallback**: if the ranking service is slow, return the chronological order. A feed that is less clever but on time is better than a spinner ([reliability patterns](../../reliability/patterns/index.md)).

### 6.4 Pagination and freshness

- **Cursor pagination**: the cursor is `(score, post_id)` of the last item; the next page is `ZREVRANGEBYSCORE feed:42 (score -inf LIMIT 0 20`. New posts arriving at the top do not shift the next page, unlike `OFFSET`.
- **New posts while scrolling** are shown with a "new posts" pill that reloads from the top (a separate request with `since=`), not inserted under the user's finger.
- **Read-your-writes:** after posting, the author must see the post in their own feed immediately even if fan-out takes seconds — insert it into the author's own timeline synchronously, or merge the author's latest posts on read ([consistency models](../../distributed/consistency/index.md)).

---

## 7. Bottlenecks, failure modes and trade-offs

| Where | What goes wrong | Mitigation | Trade-off |
|---|---|---|---|
| Celebrity post | Millions of inserts; followers see it minutes late | Hybrid: pull above a threshold | Reads merge a few extra sources |
| Fan-out workers | Queue lag after a burst of posts; feeds stale | Scale consumers on lag; partition `post-created` by author; prioritize active users | More workers, cost |
| Timeline cache shard loss | Users on that shard get empty feeds | Replicas; rebuild on miss via pull; degrade to "latest from followees" | Slow first load after failover |
| Hydration fan-out | Feed needs 200+ post lookups | Batched multi-get; post cache; hydrate only the top candidates | Ranking sees fewer features |
| Ranking service slow | Feed p99 above budget | Timeout + fallback to chronological; precomputed first page | Less relevant feed |
| Hot post | Viral post read by millions; its cache key is hot | Replicate hot keys; local in-process cache for seconds | Counters slightly stale |
| Deletes / privacy | Removed post still in timelines | Filter on read via post state; lazy cleanup | Small extra work per read |
| Media traffic | Bandwidth dominates the bill | CDN, responsive image sizes, lazy loading | CDN cost, cache invalidation of edits |

The trade-offs to **say out loud**: **write amplification vs. read latency** (push pays at write time so reads are cheap), **freshness vs. cost** (asynchronous fan-out means seconds of delay), and **relevance vs. latency** (ranking must fall back to chronological when it is slow).

---

## 8. Try it in the playground

The `news-feed` scenario contains the post service, a fan-out path through a queue and workers, a timeline cache and the feed service.

!!! tip "Try it"

    1. Run with the **load** profile; note the feed p99, the cache hit ratio and the fan-out backlog (queue depth / consumer lag).
    2. Increase the write share (or switch to **spike**) to simulate a celebrity post: does the backlog grow? How long until it drains — that is the freshness your users see.
    3. Add workers and watch the backlog drain faster; then remove the timeline cache and see the read path collapse onto the database (that is fan-out on read).
    4. Turn chaos on to slow the workers: reads should keep working with stale timelines — the system degrades instead of failing.

<div class="sdp" data-scenario="news-feed" data-mode="full" data-height="640" data-profile="load"></div>

[Open the full playground](../../../../playground/index.md){ .md-button }

---

## 9. Follow-up questions an interviewer asks

??? question "A user follows 5 000 accounts, 300 of them celebrities. Does the hybrid still work?"

    Merging 300 celebrity timelines on every read would be slow. Options: cap the number of pulled sources per read (take the most recent/most relevant 50 celebrities by affinity), precompute a per-user "celebrity digest" every few minutes, or lower the push threshold for users with many celebrity followees. Edge cases like this are why real systems decide push vs. pull **per (author, follower) pair**, not only per author.

??? question "A user returns after six months. What does the first feed open do?"

    Their timeline is not in the cache (fan-out skipped inactive users). The feed service builds it with **fan-out on read**: fetch recent posts of followees (in parallel, with a time bound), merge, rank, return the first page, and write the timeline to the cache so later opens are fast. The first open is slower (say 500 ms instead of 100 ms) — show a skeleton screen.

??? question "How do you delete a post that was pushed into ten million timelines?"

    You do not touch the timelines synchronously. Mark the post as deleted in the posts store and the post cache; hydration drops it, so it disappears from every feed on the next read. A background job may remove the ID from timelines later, but it is optional: timelines are trimmed and the entry ages out anyway.

??? question "How would you show like counts that update in real time?"

    Counters are a separate, write-heavy concern. Keep them in a counter service with **sharded counters** (or Redis `INCR` per post, aggregated periodically to the database), accept a few seconds of staleness, and push updates only for posts currently visible on screen (via WebSocket/SSE), if at all. Never store the count inside the timeline.

??? question "What changes for a brand-new user with no follows?"

    The **cold start** feed comes from recommendations: popular posts in their region, accounts similar to the ones they picked at sign-up, trending content. Architecturally, it is a different candidate source plugged into the same ranking pipeline.

??? question "How do you go multi-region?"

    Users are served by their home region. Posts are replicated asynchronously across regions; fan-out runs in each region for the followers who live there (a post created in São Paulo is fanned out in Frankfurt to European followers). Timelines are per-region caches and can be rebuilt; a few seconds of cross-region delay is acceptable for a feed.

??? question "Why not store timelines in the database instead of a cache?"

    You can (some systems keep a durable materialized timeline in a wide-column store), but timelines are **derived data**: they can always be recomputed from posts and the graph. Keeping them in memory makes the hot path fast; making them durable buys faster recovery after a cache loss at the cost of write load on the database. Either is defensible if you say why.

---

## 10. Self-assessment rubric

| Level | What the answer contains |
|---|---|
| **Junior** | Posts and follows tables; the feed as a query `SELECT … WHERE author IN (followees) ORDER BY time LIMIT 20`; a cache in front. Does not notice the cost at scale. |
| **Mid** | Fan-out on write with a queue and workers; timeline cache of IDs; recognizes the celebrity problem and proposes the hybrid; cursor pagination; media on CDN. |
| **Senior** | Quantifies write amplification and memory; chooses a threshold with reasoning; designs hydration, filtering on read, active-user fan-out and rebuild on miss; ranking pipeline with latency budget and fallback; read-your-writes for the author; failure modes (worker lag, cache loss) and multi-region fan-out. |

**Related:** [Messaging](../../messaging/kafka/index.md), [Caching patterns](../../caching/patterns/index.md), [Partitioning](../../databases/partitioning/index.md), [Hands-on 7](../../../hands-on/7/index.md) (asynchronous processing with Kafka), [Hands-on 5](../../../hands-on/5/index.md) (caching).

!!! success "Best practices"

    - **Store post ids in timelines, not post bodies** — a timeline of 800 ids is a few kilobytes; bodies come from their own cache and are edited in one place.
    - **Cap the length of each cached timeline** — a few hundred entries cover almost every session and keep the memory per user bounded.
    - **Switch to fan-out on read above a follower threshold** — one celebrity post must not become millions of writes; mix the two at read time.
    - **Make fan-out workers idempotent and resumable** — a worker that crashes halfway must not insert the same post twice in a timeline.
    - **Version the ranking model and log what was shown** — "why did I see this?" needs the model version and the candidates, not only the result.

---

## How it connects { #how-it-connects }

Which classes does this case test? Each branch is a class whose ideas the design relies on (blue), with the palette components where they show up (green):

``` diagram
flowchart LR
    CASE(["News feed"]) --> EST["Estimation<br/>fan-out write amplification"]:::tech
    CASE --> MSG["Messaging<br/>post events, fan-out workers"]:::tech
    CASE --> CAC["Caching<br/>timeline cache, hydration"]:::tech
    CASE --> DB["Databases<br/>partition posts and timelines"]:::tech
    CASE --> DIS["Distributed<br/>read-your-writes for the author"]:::tech
    CASE --> REL["Reliability<br/>fallback to chronological order"]:::tech
    MSG -.-> k1["kafka · worker"]:::comp
    CAC -.-> k2["cache"]:::comp
    DB -.-> k3["nosql · objstore · cdn"]:::comp
    REL -.-> k4["app · lb"]:::comp
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

**Classes it tests:** [Messaging — Kafka](../../messaging/kafka/index.md) · [Caching — patterns](../../caching/patterns/index.md) · [Databases — partitioning](../../databases/partitioning/index.md) · [Distributed — consistency](../../distributed/consistency/index.md) · [Reliability — patterns](../../reliability/patterns/index.md) · [Hands-on 5](../../../hands-on/5/index.md) and [Hands-on 7](../../../hands-on/7/index.md). **Palette components:** [`lb`](../../../reference/components/edge/index.md#lb) · [`app`](../../../reference/components/compute/index.md#app) · [`cache`](../../../reference/components/storage/index.md#cache) · [`nosql`](../../../reference/components/storage/index.md#nosql) · [`kafka`](../../../reference/components/messaging/index.md#kafka) · [`worker`](../../../reference/components/compute/index.md#worker) · [`objstore`](../../../reference/components/storage/index.md#objstore) · [`cdn`](../../../reference/components/edge/index.md#cdn). **Scenarios:** `news-feed`.

---

## References

- XU, A. *System Design Interview — An Insider's Guide*, vol. 1, ch. 11 "Design a News Feed System"[^1].
- KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2nd ed. — the home-timeline example (fan-out on write vs. read) in the chapter on describing load[^2].
- KRIKORIAN, R. *Timelines at Scale* — how Twitter combined push and pull[^3].
- BRONSON, N. et al. *TAO: Facebook's Distributed Data Store for the Social Graph*[^4].

[^1]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1. Byte Code LLC, 2020.
[^2]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2nd ed. O'Reilly.
[^3]: KRIKORIAN, R. [Timelines at Scale](https://www.infoq.com/presentations/Twitter-Timeline-Scalability/){target="_blank"}. QCon San Francisco, 2012 (InfoQ).
[^4]: BRONSON, N. et al. [TAO: Facebook's Distributed Data Store for the Social Graph](https://www.usenix.org/conference/atc13/technical-sessions/presentation/bronson){target="_blank"}. USENIX ATC, 2013.
