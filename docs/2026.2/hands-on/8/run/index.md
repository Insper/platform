<div class="csim" data-sim="account-cache" data-script="run"></div>

!!! tip "Try it"

    No Docker at hand? The simulator runs the lab's stack: lb, three gateways, account-1 and account-2, Redis and PostgreSQL, with the lab's key (`accounts::42`), TTL and annotations; play or → runs a page, and the buttons work at any time. In **Run**, the second request is a hit even though account-2 answers, the measurement gives 0.058 s and 0.004 s, `TTL` answers 287 and `INFO stats` ends at `keyspace_hits:8` and `keyspace_misses:2` (80%). In **local × shared**, without `type: redis` the two replicas miss twice and a `PUT` through account-1 leaves account-2 serving "Ada Lovelace"; with Redis, one miss serves both. In **TTL and stale data**, an `UPDATE` in psql stays invisible until the 300 s TTL runs out, and a 404 is never cached.

Rebuild and start the full stack with Redis:

``` { .bash .copy .select }
docker compose up -d --build
```

Verify that the `redis` container is running alongside all other services:

``` { .bash .copy .select }
docker compose ps -a
```

Expected output includes:

```
NAME                STATUS     PORTS
store-redis-1       running    0.0.0.0:6379->6379/tcp
store-lb-1          running    0.0.0.0:8080->80/tcp
store-gateway-1     running
store-gateway-2     running
store-gateway-3     running
store-account-1     running
store-account-2     running
store-auth-1        running
store-db-1          running    0.0.0.0:5432->5432/tcp
```

## Verify cache behaviour

### First request — cache miss

Send a request to retrieve an account:

``` { .bash .copy .select }
curl -s http://localhost:8080/accounts/42 | jq
```

The first call hits the database. Open a Redis CLI session and inspect the key that was written:

``` { .bash .copy .select }
docker compose exec redis redis-cli
```

``` { .bash .copy .select }
KEYS accounts::*
```

Expected:

```
1) "accounts::42"
```

Read the cached value:

``` { .bash .copy .select }
GET "accounts::42"
```

Expected — a JSON string:

```json
{"id":"42","name":"Ada Lovelace","email":"ada@example.com"}
```

### Second request — cache hit

Send the same request again:

``` { .bash .copy .select }
curl -s http://localhost:8080/accounts/42 | jq
```

Check the service logs — the database should **not** be queried this time:

``` { .bash .copy .select }
docker compose logs account --tail 20
```

If the cache is working, you will see a log line for the first request but **none** for the second.

The two requests side by side. Nginx and Docker spread them over the replicas, so the second may land on the other `account` replica: it still hits, because both read the same Redis.

``` mermaid-sim
sequenceDiagram
    participant C as curl
    participant G as lb and gateway
    participant A as account
    participant R as redis
    participant DB as db
    C->>G: GET /accounts/42 (first)
    G->>A: GET /accounts/42
    A->>R: GET accounts::42
    R-->>A: (nil)
    A->>DB: SELECT ... WHERE id = '42'
    A->>R: SET accounts::42 ... PX 300000
    A-->>C: 200, about 0.058 s
    C->>G: GET /accounts/42 (second)
    G->>A: GET /accounts/42
    A->>R: GET accounts::42
    R-->>A: the JSON
    A-->>C: 200, about 0.004 s, no SELECT
```

## Measure the latency difference

Use `curl`'s built-in timing output to compare response times. The key is still cached from the requests above, so delete it first — otherwise the "miss" below is a hit too:

``` { .bash .copy .select }
docker compose exec redis redis-cli DEL "accounts::42"
```

``` { .bash .copy .select }
curl -o /dev/null -s -w "Cache miss: %{time_total}s\n" http://localhost:8080/accounts/42
```

``` { .bash .copy .select }
curl -o /dev/null -s -w "Cache hit:  %{time_total}s\n" http://localhost:8080/accounts/42
```

A typical result:

```
Cache miss: 0.058s
Cache hit:  0.004s
```

The cache hit is 10–15× faster because Redis responds in < 1 ms and the response travels only through the gateway — no database round-trip.

## Inspect TTL expiry

Check how much time remains before a cached key expires:

``` { .bash .copy .select }
TTL "accounts::42"
```

Once the TTL reaches 0, Redis removes the key automatically. The next request will be a cache miss and the database will be queried again — keeping the cache eventually consistent with the database.

``` mermaid-sim
stateDiagram-v2
    state "absent" as absent
    state "cached" as cached
    [*] --> absent
    absent --> cached: GET miss, then SET with TTL 300 s
    cached --> cached: GET hit (TTL keeps counting down)
    cached --> cached: PUT, @CachePut writes the new value
    cached --> absent: TTL reaches 0
    cached --> absent: DELETE, @CacheEvict
    absent --> absent: GET of a missing id, 404 not cached
```

## Monitor cache hit rate

Observe cache activity in real time using Redis's built-in `MONITOR` command (use with caution in production — it logs every command):

``` { .bash .copy .select }
docker compose exec redis redis-cli MONITOR
```

Send several requests and watch the `GET` (hit or nil) and `SET` (miss + store) commands stream by.

For aggregate stats, use `INFO stats`:

``` { .bash .copy .select }
docker compose exec redis redis-cli INFO stats | grep -E "keyspace_(hits|misses)"
```

```
keyspace_hits:8
keyspace_misses:2
```

These are the numbers after the steps of this page, with four requests during `MONITOR`: two misses (the first request and the one after `DEL`) and eight hits — `redis-cli`'s own `GET` and `TTL` count as reads too. Your numbers depend on how many requests you sent.

A healthy cache hit rate is above 90% for read-heavy workloads. If the miss rate is high, consider increasing the TTL or pre-warming the cache on startup.

---

Done! Redis now acts as a shared, persistent cache layer across all microservice replicas. Database load is reduced proportionally to the cache hit rate, and all gateway replicas share the same cache state regardless of which instance handles each request. The database behind the cache, though, is still a single container: [hands-on 9](../../9/index.md) turns it into a cluster with replicas and failover.
