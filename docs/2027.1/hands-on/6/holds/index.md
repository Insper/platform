A **hold** says "these seats are mine for 10 minutes, while I pay". The invariant: **a seat belongs to at most one live hold**. Everything in this step is about keeping that invariant true when hundreds of fans click the same seats in the same second.

## 1. Why "check, then update" is not enough

The obvious code reads the seats, checks they are `AVAILABLE`, then updates them. Under concurrency, two transactions can interleave:

``` diagram-sim
sequenceDiagram
    autonumber
    participant A as Fan A (tx 1)
    participant DB as PostgreSQL
    participant B as Fan B (tx 2)
    A->>DB: SELECT status FROM seats WHERE id IN (7,8)
    DB-->>A: AVAILABLE, AVAILABLE
    B->>DB: SELECT status FROM seats WHERE id IN (7,8)
    DB-->>B: AVAILABLE, AVAILABLE
    A->>DB: UPDATE seats SET status='HELD', hold_id=A ...
    B->>DB: UPDATE seats SET status='HELD', hold_id=B ... (waits for A's row locks)
    A->>DB: COMMIT
    DB-->>B: update proceeds — overwrites A's hold
    B->>DB: COMMIT
    Note over A,B: both fans got a 201 for seats 7 and 8: DOUBLE BOOKING
```

PostgreSQL's default isolation, **READ COMMITTED**, does not prevent this *lost update*: each statement sees committed data, but nothing ties B's decision (made on the `SELECT`) to the data when B writes. Three fixes:

| Strategy | How | On conflict | Good when |
|---|---|---|---|
| **Pessimistic** | `SELECT … FOR UPDATE` locks the rows until commit; the second transaction **waits**, then sees `HELD` | 409 after waiting | contention is **high** (the flash sale: everybody wants the same 100 seats) |
| **Optimistic** | read without locks; `UPDATE … WHERE version = :v`; 0 rows changed → someone was faster | 409 immediately, the transaction rolls back | contention is **low**; no waiting, no lock queues |
| **Conditional update** | `UPDATE … WHERE id IN (…) AND status = 'AVAILABLE'` and check the row count | 409 immediately | a single statement can express the check (a variant of optimistic) |
| Serializable isolation | `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE` | the database aborts one transaction (`40001`), the app retries | complex invariants over many rows |

## 2. The `inventory` service

Create `services/inventory` (port **8083**, schema `inventory`, same `Dockerfile` pattern with `EXPOSE 8083`). It uses **JdbcClient** with plain SQL instead of JPA: every lock and every `WHERE` is visible in the code, which is the point of this lab.

??? example "`services/inventory/Dockerfile` and `.dockerignore` (same as `catalog`, only `EXPOSE 8083` changes)"

    ``` { .dockerfile title="services/inventory/Dockerfile" .copy linenums="1" }
    --8<-- "docs/2027.1/hands-on/6/code/services/inventory/Dockerfile"
    ```

    ``` { .text title="services/inventory/.dockerignore" .copy }
    --8<-- "docs/2027.1/hands-on/6/code/services/inventory/.dockerignore"
    ```

``` { .xml title="services/inventory/pom.xml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/services/inventory/pom.xml"
```

``` { .yaml title="services/inventory/src/main/resources/application.yaml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/resources/application.yaml"
```

=== "V1__create_inventory.sql"

    ``` { .sql title="services/inventory/src/main/resources/db/migration/V1__create_inventory.sql" .copy linenums="1" }
    --8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/resources/db/migration/V1__create_inventory.sql"
    ```

=== "V2__seed_seats.sql"

    ``` { .sql title="services/inventory/src/main/resources/db/migration/V2__seed_seats.sql" .copy linenums="1" }
    --8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/resources/db/migration/V2__seed_seats.sql"
    ```

`hold_seats` records which seats each hold *asked for*. The `seats.hold_id` column can be overwritten by a buggy strategy, but `hold_seats` keeps the evidence: the audit query counts seats that appear in more than one live hold.

The records and the application class:

=== "InventoryApplication"

    ``` { .java title="services/inventory/src/main/java/boxoffice/inventory/InventoryApplication.java" .copy }
    --8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/java/boxoffice/inventory/InventoryApplication.java"
    ```

=== "HoldIn"

    ``` { .java title="services/inventory/src/main/java/boxoffice/inventory/HoldIn.java" .copy }
    --8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/java/boxoffice/inventory/HoldIn.java"
    ```

=== "HoldOut"

    ``` { .java title="services/inventory/src/main/java/boxoffice/inventory/HoldOut.java" .copy }
    --8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/java/boxoffice/inventory/HoldOut.java"
    ```

=== "SeatOut"

    ``` { .java title="services/inventory/src/main/java/boxoffice/inventory/SeatOut.java" .copy }
    --8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/java/boxoffice/inventory/SeatOut.java"
    ```

=== "SectionAvailability"

    ``` { .java title="services/inventory/src/main/java/boxoffice/inventory/SectionAvailability.java" .copy }
    --8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/java/boxoffice/inventory/SectionAvailability.java"
    ```

## 3. Three strategies in one service

``` { .java title="services/inventory/src/main/java/boxoffice/inventory/HoldService.java" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/java/boxoffice/inventory/HoldService.java"
```

Read it strategy by strategy:

- **naive**: `read(…, "")` then an unconditional `UPDATE`. The comment marks the race window.
- **pessimistic**: `read(…, "ORDER BY id FOR UPDATE")`. The second transaction blocks on the row locks; when the first commits, PostgreSQL re-reads the locked rows, the second sees `HELD`, and `requireAvailable` throws `409`. **Locking in a fixed order** (`ORDER BY id`) matters: fan A holding seats 7→8 and fan B holding 8→7 in opposite order would deadlock.
- **optimistic**: no locks; the `UPDATE` only succeeds if `version` is still the one we read. If another transaction changed the seat in between, 0 rows change, we throw, and `@Transactional` rolls back everything (including seats already updated in the loop).
- Every hold also checks that **all** seats belong to the event (`400` otherwise) and limits a hold to **6 seats**.
- `find`, `confirm` and `release` filter by `user_id`: a fan cannot see or cancel somebody else's hold (that would be an *IDOR*, insecure direct object reference — OWASP API #1).
- `expireHolds` runs every 5 s on every replica; `FOR UPDATE SKIP LOCKED` lets several replicas share the work without blocking each other or processing a hold twice — the same trick used by job queues built on PostgreSQL.

The read-only queries live in a separate class, because they go to the replica (step 2):

``` { .java title="services/inventory/src/main/java/boxoffice/inventory/SeatQueries.java" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/java/boxoffice/inventory/SeatQueries.java"
```

``` { .java title="services/inventory/src/main/java/boxoffice/inventory/InventoryController.java" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/java/boxoffice/inventory/InventoryController.java"
```

## 4. Wire it into the gateway

Add the route and open the read endpoints (holds stay protected by the default rule):

``` { .yaml title="services/gateway/src/main/resources/application.yaml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/services/gateway/src/main/resources/application.yaml"
```

``` { .java title="services/gateway/src/main/java/boxoffice/gateway/SecurityConfig.java" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/services/gateway/src/main/java/boxoffice/gateway/SecurityConfig.java"
```

The Compose file with `inventory`, the replica and PgBouncer is in [step 2](../replicas/index.md#3-compose); bring everything up after that step, or now with the full file.

## 5. Check it by hand

With the full stack of [step 2](../replicas/index.md#3-compose) running, log in and walk through a hold. All commands from the repository root:

``` { .bash .copy }
curl -s -X POST localhost/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"Ana","email":"ana@example.com","password":"secret-123"}'; echo
export TOKEN=$(curl -s -X POST localhost/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"ana@example.com","password":"secret-123"}' | jq -r .accessToken)
export ADMIN=$(curl -s -X POST localhost/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@boxoffice.dev","password":"boxoffice-admin"}' | jq -r .accessToken)

curl -s localhost/inventory/events/1/availability | jq -c '.[0]'
HOLD=$(curl -s -X POST localhost/inventory/holds -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"eventId":1,"seatIds":[1,2]}')
echo "$HOLD"
export HOLD_ID=$(echo "$HOLD" | jq -r .id)

# the same seat for somebody else, no token, somebody else's hold
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost/inventory/holds -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' -d '{"eventId":1,"seatIds":[2,3]}'
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost/inventory/holds \
  -H 'Content-Type: application/json' -d '{"eventId":1,"seatIds":[5]}'
curl -s -o /dev/null -w "%{http_code}\n" localhost/inventory/holds/$HOLD_ID -H "Authorization: Bearer $ADMIN"

# pay (lab 7 will do this through order) and look again
curl -s -X POST localhost/inventory/holds/$HOLD_ID/confirm -H "Authorization: Bearer $TOKEN" | jq -c '{status, seatIds}'
curl -s localhost/inventory/events/1/availability | jq -c '.[0]'
curl -s localhost/inventory/audit/double-bookings -H "Authorization: Bearer $TOKEN"
```

You should see (from a run for this lab; ids and times differ):

``` { .text }
{"id":"0b9d8a6e-…","name":"Ana","email":"ana@example.com","role":"USER"}
{"section":"S01","available":2000,"held":0,"sold":0}
{"id":"c869f791-701d-41dd-b82f-d5a6ba48093e","eventId":1,"status":"ACTIVE","expiresAt":"2026-10-18T17:51:50.567788219Z","seatIds":[1,2]}
409
401
404
{"status":"CONFIRMED","seatIds":[1,2]}
{"section":"S01","available":1998,"held":0,"sold":2}
{"doubleBookedSeats":0}
```

`409`: seat 2 is already held. `401`: holds need a token. `404`: a hold of another user does not exist for you. Run `bash scripts/reset-inventory.sh` afterwards to put the seats back on sale.

## 6. The flash-sale test

``` { .javascript title="load/lib.js" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/load/lib.js"
```

``` { .javascript title="load/flash-sale.js" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/load/flash-sale.js"
```

``` { .bash title="scripts/reset-inventory.sh" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/scripts/reset-inventory.sh"
```

Run it once per strategy, resetting the seats each time:

``` { .bash .copy }
mkdir -p results
for mode in naive pessimistic optimistic; do
  INVENTORY_LOCKING=$mode docker compose up -d inventory
  sleep 25                                   # wait until inventory is healthy again
  bash scripts/reset-inventory.sh
  k6 run load/flash-sale.js 2>&1 | tee results/lab6-flash-$mode.txt | grep -E "AUDIT|holds_.*:|\{ name:hold"
done
```

<!-- termynal -->
``` shell
> INVENTORY_LOCKING=naive ... k6 run load/flash-sale.js
time="…" level=info msg="AUDIT double-booked seats: 9" source=console
    holds_conflict.................: 11582  263.28/s
    holds_created..................: 162    3.68/s
      { name:hold }................: avg=312.03ms med=208.6ms  p(95)=808.96ms p(99)=1.88s
> INVENTORY_LOCKING=pessimistic ... k6 run load/flash-sale.js
time="…" level=info msg="AUDIT double-booked seats: 0" source=console
    holds_conflict.................: 16184  402.17/s
    holds_created..................: 141    3.50/s
      { name:hold }................: avg=171.94ms med=78.37ms  p(95)=665.17ms p(99)=1.77s
> INVENTORY_LOCKING=optimistic ... k6 run load/flash-sale.js
time="…" level=info msg="AUDIT double-booked seats: 0" source=console
    holds_conflict.................: 20028  512.57/s
    holds_created..................: 141    3.61/s
      { name:hold }................: avg=93.62ms  med=31.02ms  p(95)=354.94ms p(99)=1.03s
```

These numbers come from one run on a busy laptop — yours will differ — but the shape is what matters: **naive created more holds than the seats allow and the audit found 9 double-booked seats**; pessimistic and optimistic always end with `0`. With only 100 seats, most attempts are `409` (the seats are gone), which the script counts as an expected answer, not an error. Compare also the latency of the `hold` requests: pessimistic transactions queue on row locks, optimistic ones fail fast — here optimistic had the lowest p99, because a conflicting fan learns "taken" without waiting for anybody's lock.

??? question "Think first: if pessimistic locking is correct, why would anyone use optimistic locking?"

    Locks cost waiting. When contention is low (fans spread over 60,000 seats, most holds touch different rows), optimistic locking never waits and almost never conflicts, so it is cheaper. When contention is high (everybody wants the first rows), optimistic locking turns into a storm of conflicts and retries, while pessimistic locking serializes the requests neatly. Measure your contention before choosing — and remember that the real flash-sale design also *reduces* contention before the database: a waiting room (lab 7) admits fans at a rate the inventory can absorb.

!!! tip "In the interview"

    For "design Ticketmaster", say explicitly: *"seat inventory is the one place that needs strong consistency; I will use a relational database with row-level locking (or conditional updates) for holds, with a TTL on each hold, and everything else — catalog, search, seat maps — can be eventually consistent and cached."* Then mention the hot-row problem: thousands of fans on the same 100 seats serialize on their locks, so queue them *before* the database.

Next: [2. Replica and pooling](../replicas/index.md).
