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
store-nginx-1       running    0.0.0.0:80->80/tcp
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
curl -s http://localhost/accounts/42 | jq
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
curl -s http://localhost/accounts/42 | jq
```

Check the service logs — the database should **not** be queried this time:

``` { .bash .copy .select }
docker compose logs account --tail 20
```

If the cache is working, you will see a log line for the first request but **none** for the second.

## Measure the latency difference

Use `curl`'s built-in timing output to compare response times:

``` { .bash .copy .select }
curl -o /dev/null -s -w "Cache miss: %{time_total}s\n" http://localhost/accounts/42
```

``` { .bash .copy .select }
curl -o /dev/null -s -w "Cache hit:  %{time_total}s\n" http://localhost/accounts/42
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
keyspace_misses:1
```

A healthy cache hit rate is above 90% for read-heavy workloads. If the miss rate is high, consider increasing the TTL or pre-warming the cache on startup.

---

Done! Redis now acts as a shared, persistent cache layer across all microservice replicas. Database load is reduced proportionally to the cache hit rate, and all gateway replicas share the same cache state regardless of which instance handles each request.
