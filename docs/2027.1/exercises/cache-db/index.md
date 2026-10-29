During a BoxOffice on-sale, almost every request is a **read** of the same few things: the event page, the venue, the price list. Sending each of them to the primary database is like asking the box-office clerk to re-print the poster for every fan in line. In this exercise you put a **Redis cache** and a **PostgreSQL read replica** in front of your service, measure what they buy you, and face the price: **stale data**, **replication lag** and the **cache stampede**.

!!! abstract "Learning objectives"

    After this exercise you will be able to:

    - **Implement** cache-aside with TTL, jitter and invalidation on write, and a read/write split between a primary and a replica.
    - **Predict** hit ratio and database load from the key distribution, and **verify** the prediction with measurements.
    - **Compare** before/after with the same workload: p99, knee, database load.
    - **Demonstrate** a stale read caused by replication lag (and by the cache) and **mitigate** it.
    - **Reproduce** a cache stampede and **fix** it with request coalescing.

## Context

[Class 6](../../classes/databases/index.md) covered replication and its consistency anomalies[^1]; [Class 7](../../classes/caching/index.md) covered cache patterns, invalidation and failure modes. [Lab 5](../../hands-on/5/index.md) built cache-aside on `catalog` and [Lab 6](../../hands-on/6/index.md) a read replica. Here you combine both, on **your** service, as an experiment with numbers. Start from the service and the k6 script of the [load-test report](../load-test-report/index.md) — that report is your **"before"**.

The read path you will build:

``` diagram-sim
sequenceDiagram
    participant C as Client
    participant A as catalog
    participant R as Redis
    participant P as PostgreSQL replica
    C->>A: GET /events/42
    A->>R: GET event:42
    R-->>A: (miss)
    A->>P: SELECT ... WHERE id = 42
    P-->>A: row
    A->>R: SET event:42 (TTL 60 s + jitter)
    A-->>C: 200 OK
    C->>A: GET /events/42
    A->>R: GET event:42
    R-->>A: (hit)
    A-->>C: 200 OK
```

### The math you will check

With a request rate λ and a hit ratio *h*, the database receives only the misses:

$$
\lambda_{db} = (1 - h)\,\lambda
\qquad
\bar{t} \approx h\,t_{cache} + (1 - h)\,(t_{cache} + t_{db})
$$

The hit ratio depends on the **key popularity**. With a Zipf distribution (exponent 1) over 1,000 events, the 200 most popular events receive about `H₂₀₀ / H₁₀₀₀ ≈ 5.88 / 7.49 ≈ 78%` of the reads (Hₙ is the harmonic number, ≈ ln n + 0.577). With a 60 s TTL, each key that is read misses about once per TTL, so at most ~1,000 / 60 ≈ 17 misses/s — at 1,000 req/s that is a hit ratio around 98% once the cache is warm. **Write your own prediction before measuring.**

## Task

Starting from your service of the load-test report (the BoxOffice `catalog`, recommended):

1. Add **cache-aside** with Redis on the main read endpoint (`GET /events/{id}`): TTL with jitter, **delete on write** after the transaction commits, hit/miss counters.
2. Add a **PostgreSQL streaming replica** and route **read-only transactions to the replica** and writes to the primary.
3. Run the **same k6 workload** (with Zipf-distributed keys and a small share of writes) **before** (ex2 setup) and **after**, and compare.
4. **Demonstrate a stale read** (replica lag and cache) and implement or argue a **mitigation**.
5. **Reproduce a cache stampede** on a hot key and **fix** it.

## Requirements

- [ ] **(mandatory)** Cache-aside on the read endpoint with TTL **and** invalidation on write (after commit); a hit and a miss counter exposed as metrics.
- [ ] **(mandatory)** A streaming replica with a read/write split; evidence that **≥ 90% of read transactions** go to the replica (`pg_stat_database` on both nodes).
- [ ] **(mandatory)** Before/after with the **same** k6 script, data and resources; raw results committed.
- [ ] Your **prediction** of hit ratio and database load, then the measurement: hit ratio **≥ 80%** in steady state, and database reads within **±20%** of `(1 − h) λ` (or an explanation of the gap).
- [ ] p99 at the load rate of ex2, and the **new knee** (stress test), compared with before.
- [ ] Replication lag measured **idle** and **under write load**.
- [ ] A **stale read** demonstrated step by step (pause replay on the replica) and one mitigation implemented or precisely argued (read-your-writes).
- [ ] A **stampede** reproduced (≈ N database reads for N concurrent misses of the same key) and fixed (≤ 1 database read per instance).
- [ ] A short discussion: what should **not** be cached in BoxOffice (e.g. seat availability at checkout) and why.
- [ ] *AI usage* section (see the [policy](../index.md#use-of-ai-tools)).

## Deliverables

In your repository (tag `ex3`): code changes, `compose.yaml` with Redis and the replica, k6 scripts, raw results (`load/results/`), and a `cache-db` page on your documentation site following the [template](#templates).

## Step by step

### 1. Add Redis and a replica to Compose

The replica is created with `pg_basebackup` from the primary the first time it starts; `-R` writes the settings that make it a streaming standby.

```yaml title="compose.yaml (excerpt)"
services:
  redis:
    image: redis:7
    command: ["redis-server", "--maxmemory", "256mb", "--maxmemory-policy", "allkeys-lru"]
    cpus: "1"
    mem_limit: 512m

  db:
    image: postgres:16
    environment:
      POSTGRES_DB: catalog
      POSTGRES_USER: catalog
      POSTGRES_PASSWORD: catalog
    command: ["postgres", "-c", "wal_level=replica", "-c", "max_wal_senders=5", "-c", "hot_standby=on"]
    volumes:
      - ./db/init-replication.sh:/docker-entrypoint-initdb.d/10-replication.sh:ro
    cpus: "2"
    mem_limit: 1g

  db-replica:
    image: postgres:16
    user: postgres
    environment:
      PGPASSWORD: replicator
    command:
      - bash
      - -c
      - |
        if [ ! -s /var/lib/postgresql/data/PG_VERSION ]; then
          until pg_basebackup -h db -U replicator -D /var/lib/postgresql/data -R -X stream; do sleep 2; done
          chmod 0700 /var/lib/postgresql/data
        fi
        exec postgres -c hot_standby=on
    depends_on:
      - db
    cpus: "2"
    mem_limit: 1g
```

```bash title="db/init-replication.sh"
#!/usr/bin/env bash
# Runs once, when the primary is initialized: a replication user and its pg_hba rule.
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'replicator';"
echo "host replication replicator all scram-sha-256" >> "$PGDATA/pg_hba.conf"
```

Check that the replica is streaming:

```bash
docker compose exec db psql -U catalog -c "select client_addr, state, replay_lag from pg_stat_replication;"
docker compose exec db-replica psql -U catalog -d catalog -c "select pg_is_in_recovery();"
```

### 2. Cache-aside in the service

Write the pattern by hand (instead of `@Cacheable`) so that you control TTL, invalidation and metrics[^2].

```java title="src/main/java/boxoffice/catalog/EventQueryService.java"
package boxoffice.catalog;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Duration;
import java.util.Optional;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

@Service
public class EventQueryService {

    private static final Duration BASE_TTL = Duration.ofSeconds(60);

    private final StringRedisTemplate redis;
    private final EventReader reader;   // @Transactional(readOnly = true) -> replica
    private final ObjectMapper json;
    private final Counter hits;
    private final Counter misses;

    public EventQueryService(StringRedisTemplate redis, EventReader reader,
                             ObjectMapper json, MeterRegistry meters) {
        this.redis = redis;
        this.reader = reader;
        this.json = json;
        this.hits = meters.counter("catalog.cache", "result", "hit");
        this.misses = meters.counter("catalog.cache", "result", "miss");
    }

    public Optional<EventDto> findById(long id) {
        String cached = redis.opsForValue().get(key(id));
        if (cached != null) {
            hits.increment();
            return Optional.of(fromJson(cached));
        }
        misses.increment();
        Optional<EventDto> value = reader.findById(id);
        value.ifPresent(e -> redis.opsForValue().set(key(id), toJson(e), ttlWithJitter()));
        return value;
    }

    public void evict(long id) {
        redis.delete(key(id));
    }

    static String key(long id) {
        return "event:" + id;
    }

    // Jitter spreads expirations so that popular keys do not all expire at the same instant.
    private static Duration ttlWithJitter() {
        return BASE_TTL.plusMillis(ThreadLocalRandom.current().nextLong(0, 15_000));
    }

    private EventDto fromJson(String s) {
        try {
            return json.readValue(s, EventDto.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    private String toJson(EventDto e) {
        try {
            return json.writeValueAsString(e);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException(ex);
        }
    }
}
```

Invalidate **after** the write commits — deleting before the commit lets a concurrent read put the old value back:

```java title="src/main/java/boxoffice/catalog/EventCommandService.java"
package boxoffice.catalog;

import org.springframework.stereotype.Service;

@Service
public class EventCommandService {

    private final EventWriter writer;          // @Transactional -> primary
    private final EventQueryService queries;

    public EventCommandService(EventWriter writer, EventQueryService queries) {
        this.writer = writer;
        this.queries = queries;
    }

    public EventDto update(long id, EventUpdate command) {
        EventDto saved = writer.update(id, command); // the transaction commits when this returns
        queries.evict(id);                          // then the cache entry is deleted
        return saved;
    }
}
```

### 3. Route reads to the replica

A routing `DataSource` chooses the replica for read-only transactions. `LazyConnectionDataSourceProxy` delays getting a connection until the transaction's read-only flag is known.

```java title="src/main/java/boxoffice/catalog/config/DataSourceConfig.java"
package boxoffice.catalog.config;

import java.util.Map;
import javax.sql.DataSource;
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.datasource.LazyConnectionDataSourceProxy;
import org.springframework.jdbc.datasource.lookup.AbstractRoutingDataSource;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Configuration
public class DataSourceConfig {

    static class ReadWriteRoutingDataSource extends AbstractRoutingDataSource {
        @Override
        protected Object determineCurrentLookupKey() {
            return TransactionSynchronizationManager.isCurrentTransactionReadOnly() ? "replica" : "primary";
        }
    }

    @Bean
    @ConfigurationProperties("app.datasource.primary")
    DataSourceProperties primaryProperties() {
        return new DataSourceProperties();
    }

    @Bean
    @ConfigurationProperties("app.datasource.replica")
    DataSourceProperties replicaProperties() {
        return new DataSourceProperties();
    }

    @Bean
    @Primary
    DataSource dataSource() {
        DataSource primary = primaryProperties().initializeDataSourceBuilder().build();
        DataSource replica = replicaProperties().initializeDataSourceBuilder().build();
        ReadWriteRoutingDataSource routing = new ReadWriteRoutingDataSource();
        routing.setTargetDataSources(Map.of("primary", primary, "replica", replica));
        routing.setDefaultTargetDataSource(primary);
        routing.afterPropertiesSet();
        return new LazyConnectionDataSourceProxy(routing);
    }
}
```

```yaml title="src/main/resources/application.yaml (excerpt)"
app:
  datasource:
    primary:
      url: jdbc:postgresql://db:5432/catalog
      username: catalog
      password: catalog
    replica:
      url: jdbc:postgresql://db-replica:5432/catalog
      username: catalog
      password: catalog
spring:
  data:
    redis:
      host: redis
      port: 6379
```

Annotate the reader's methods with `@Transactional(readOnly = true)` and the writer's with `@Transactional`. Check the split by counting committed transactions on each node before and after a test:

```bash
for svc in db db-replica; do
  docker compose exec "$svc" psql -U catalog -d catalog -tAc \
    "select '$svc', xact_commit from pg_stat_database where datname = 'catalog';"
done
```

### 4. The same workload, with popular keys

Real traffic is skewed: a few events get most of the views. Replace the uniform ids of the ex2 script with Zipf-distributed ids and add a small share of writes (so that invalidations happen).

```javascript title="load/catalog-zipf.js"
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:8080';
const RATE = Number(__ENV.RATE || 200);
const N = Number(__ENV.EVENTS || 1000);
const S = Number(__ENV.ZIPF_S || 1.0);
const WRITE_RATIO = Number(__ENV.WRITE_RATIO || 0.02);

// Cumulative distribution of a Zipf(S) popularity over ids 1..N.
const cdf = (() => {
  const acc = [];
  let sum = 0;
  for (let k = 1; k <= N; k++) {
    sum += 1 / Math.pow(k, S);
    acc.push(sum);
  }
  return acc.map((x) => x / sum);
})();

function zipfId() {
  const u = Math.random();
  let lo = 0;
  let hi = N - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid] < u) lo = mid + 1; else hi = mid;
  }
  return lo + 1;
}

export const options = {
  scenarios: {
    load: {
      executor: 'ramping-arrival-rate', startRate: 0, timeUnit: '1s',
      preAllocatedVUs: 50, maxVUs: 500,
      stages: [
        { target: RATE, duration: '2m' },
        { target: RATE, duration: '10m' },
        { target: 0, duration: '30s' },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<200', 'p(99)<500'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const id = zipfId();
  if (Math.random() < WRITE_RATIO) {
    const body = JSON.stringify({ description: `updated at ${Date.now()}` });
    const res = http.put(`${BASE}/events/${id}`, body, {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'PUT /events/{id}' },
    });
    check(res, { 'write ok': (r) => r.status === 200 });
  } else {
    const res = http.get(`${BASE}/events/${id}`, { tags: { name: 'GET /events/{id}' } });
    check(res, { 'read ok': (r) => r.status === 200 });
  }
}
```

Adapt the `PUT` to your API (and its authentication). Run the **before** (cache off, no replica — e.g. a Spring profile) and the **after** with the same rate, seed data and resources.

### 5. Measure hit ratio, database load and lag

Take each counter at the start and at the end of the steady part of the test and use the **difference**:

```bash
docker compose exec redis redis-cli INFO stats | grep -E 'keyspace_(hits|misses)'
curl -s localhost:8080/actuator/metrics/catalog.cache | jq '.measurements'
docker compose exec db psql -U catalog -c "select application_name, state, write_lag, replay_lag from pg_stat_replication;"
docker compose exec db-replica psql -U catalog -d catalog -c "select now() - pg_last_xact_replay_timestamp() as replica_delay;"
```

`replica_delay` grows when the primary is idle (no new transactions to replay), so read it **under write load**; `replay_lag` on the primary is the better number.

### 6. Make a stale read happen

Replication lag is usually milliseconds — too fast to see. Pause replay on the replica to make it visible and deterministic:

```bash
docker compose exec db-replica psql -U postgres -c "select pg_wal_replay_pause();"
curl -s -X PUT localhost:8080/events/1 -H 'Content-Type: application/json' -d '{"description":"new"}'
curl -s localhost:8080/events/1      # which description do you get, and why?
docker compose exec db-replica psql -U postgres -c "select pg_wal_replay_resume();"
```

Explain what you observe, including the **cache + replica race**: the write deletes `event:1`; the next read misses, reads the *old* row from the lagging replica, and puts the old value back in the cache — where it stays for a whole TTL. Then mitigate, for example: read from the primary for a few seconds after a write by the same client (*read-your-writes*), refill the cache from the primary after a write (write-through), or keep the TTL short for data that changes. Justify the choice for BoxOffice.

### 7. Reproduce and fix a stampede

When a hot key expires, every concurrent request misses at once and goes to the database — the *thundering herd*. Reproduce it with 200 simultaneous requests to the same id right after deleting the key:

```javascript title="load/stampede.js"
import http from 'k6/http';

const BASE = __ENV.BASE_URL || 'http://localhost:8080';

export const options = {
  scenarios: { herd: { executor: 'per-vu-iterations', vus: 200, iterations: 1 } },
};

export default function () {
  http.get(`${BASE}/events/1`);
}
```

```bash
docker compose exec redis redis-cli DEL event:1
k6 run load/stampede.js
curl -s 'localhost:8080/actuator/metrics/catalog.cache?tag=result:miss' | jq '.measurements'
```

Count the misses (database reads) for the 200 requests. Then fix it with **request coalescing**: concurrent misses of the same key in one instance wait for a single load.

```java title="EventQueryService.java (coalescing excerpt)"
private final ConcurrentHashMap<Long, CompletableFuture<Optional<EventDto>>> inFlight = new ConcurrentHashMap<>();

private Optional<EventDto> loadOnce(long id) {
    CompletableFuture<Optional<EventDto>> mine = new CompletableFuture<>();
    CompletableFuture<Optional<EventDto>> existing = inFlight.putIfAbsent(id, mine);
    if (existing != null) {
        return existing.join();                  // another thread is loading this key: wait for it
    }
    try {
        misses.increment();                      // only the loader counts as a database read
        Optional<EventDto> value = reader.findById(id);
        value.ifPresent(e -> redis.opsForValue().set(key(id), toJson(e), ttlWithJitter()));
        mine.complete(value);
        return value;
    } catch (RuntimeException ex) {
        mine.completeExceptionally(ex);
        throw ex;
    } finally {
        inFlight.remove(id);
    }
}
```

In `findById`, replace the miss branch (counter, read, `SET`) by `return loadOnce(id);`. With *k* instances you get at most *k* database reads per expiry. A Redis lock (`SET lock:event:1 <token> NX PX 3000`) or probabilistic early refresh are alternatives — compare them in your discussion.

## Templates

=== "English"

    ~~~markdown
    # Cache & database — <service>

    ## 1. Setup
    - Before: ... (from ex2) · After: Redis (...), primary + replica (...)
    - Workload: Zipf s = ..., N = ... ids, write ratio ...%, rate ... req/s, 10 min steady
    - Resources and environment: ...

    ## 2. Prediction
    - Expected hit ratio: ... because ...
    - Expected database reads: (1 − h) × λ = ...

    ## 3. Before / after
    | Metric | Before | After | Change |
    |-|-|-|-|
    | Hit ratio (steady state) | — | | |
    | Database reads/s (primary + replica) | | | |
    | Reads on the replica (%) | — | | |
    | p50 / p99 at ... req/s | | | |
    | Knee (stress) | | | |
    | Primary CPU | | | |

    ## 4. Replication lag
    | Condition | replay_lag |
    |-|-|
    | idle | |
    | under ... writes/s | |

    ## 5. Stale read
    Steps, what was returned, why (including the cache + replica race), mitigation and its cost.

    ## 6. Stampede
    | | Database reads for 200 concurrent misses |
    |-|-|
    | Before the fix | |
    | After the fix | |

    ## 7. Discussion
    What not to cache in BoxOffice and why; memory needed; staleness you accept per endpoint.

    ## 8. AI usage
    ~~~

=== "Português"

    ~~~markdown
    # Cache e banco de dados — <serviço>

    ## 1. Ambiente
    - Antes: ... (do ex2) · Depois: Redis (...), primário + réplica (...)
    - Carga: Zipf s = ..., N = ... ids, proporção de escritas ...%, taxa ... req/s, 10 min estáveis
    - Recursos e ambiente: ...

    ## 2. Previsão
    - Taxa de acerto esperada: ... porque ...
    - Leituras esperadas no banco: (1 − h) × λ = ...

    ## 3. Antes / depois
    | Métrica | Antes | Depois | Variação |
    |-|-|-|-|
    | Taxa de acerto (regime) | — | | |
    | Leituras/s no banco (primário + réplica) | | | |
    | Leituras na réplica (%) | — | | |
    | p50 / p99 a ... req/s | | | |
    | Joelho (stress) | | | |
    | CPU do primário | | | |

    ## 4. Atraso de replicação
    | Condição | replay_lag |
    |-|-|
    | ocioso | |
    | com ... escritas/s | |

    ## 5. Leitura desatualizada
    Passos, o que foi retornado, por quê (incluindo a corrida cache + réplica), mitigação e seu custo.

    ## 6. Stampede
    | | Leituras no banco para 200 misses simultâneos |
    |-|-|
    | Antes da correção | |
    | Depois da correção | |

    ## 7. Discussão
    O que não colocar em cache na BoxOffice e por quê; memória necessária; desatualização aceita por endpoint.

    ## 8. Uso de IA
    ~~~

## Rubric

Levels as defined in [How the exercises are graded](../index.md#how-the-exercises-are-graded).

| Criterion | I | D | C | B | A |
|-|-|-|-|-|-|
| Cache-aside **(mandatory)** | Absent | No TTL or no invalidation on write | TTL + delete after commit + hit/miss metrics | TTL jitter; cache failure does not break reads (fallback to DB) | Memory sizing and eviction policy justified with numbers |
| Replica and routing **(mandatory)** | Absent | Replica exists but reads not routed | ≥ 90% of reads on the replica, shown with counters | Writes and read-your-writes paths identified | Routing failure handled (replica down → primary) and tested |
| Experiment **(mandatory)** | No before/after | Different scripts, data or resources | Same workload before/after, raw data committed | Prediction stated first and compared with the measurement | Sensitivity: hit ratio vs Zipf exponent or TTL, plotted |
| Results | — | Partial | Hit ratio, DB load, p99 and knee reported | Gaps between prediction and measurement explained | Knee moves explained by the new bottleneck, with evidence |
| Consistency | — | Not addressed | Stale read demonstrated | Cache + replica race explained and mitigated | Mitigation tested under load, cost discussed |
| Stampede | — | Not done | Reproduced and fixed with numbers | Alternatives compared (lock, early refresh) | Multi-instance behaviour measured |

## FAQ

??? question "Why not just use `@Cacheable`?"

    You may in your project. Here, writing cache-aside by hand makes every decision visible: what the key is, when it expires, when it is deleted and what is counted. `@Cacheable` hides exactly the parts this exercise is about.

??? question "Should I delete or update the cache on a write?"

    Deleting is the default for cache-aside: the next read refills it from the source of truth. Updating (write-through) avoids a miss but can race with concurrent writes and store an older value. Either way, do it **after** the commit.

??? question "My hit ratio is 99.9% — is that suspicious?"

    Maybe: check that the workload is not reading the same key, that the counters are differences over the steady window (not since start-up) and that writes happen. A very high ratio is plausible for a small, skewed key set and a long TTL — show the arithmetic.

??? question "Where does seat availability fit?"

    Not in this cache. Seat holds need strong consistency (no double booking) and belong to the `inventory` service and its transactions ([Lab 6](../../hands-on/6/index.md)). A *display* of availability can be cached for a second or two — at checkout, the database decides.

??? question "The replica setup fails with an authentication error."

    The init script runs only when the primary's data directory is created. If you started the primary before adding the script, remove its volume (`docker compose down -v`) and start again.

??? question "Do I need two instances of the service for the stampede?"

    No. One instance is enough to reproduce and fix it. Testing with Nginx and several instances (Lab 3) is an A-level extension: you should see at most one database read per instance.

[^1]: Martin Kleppmann and Chris Riccomini, *Designing Data-Intensive Applications*, 2nd ed., O'Reilly — chapters on replication (replication lag, read-your-writes).
[^2]: Redis documentation, "Client-side caching" and "Eviction", [redis.io/docs](https://redis.io/docs/latest/){target="_blank"}.
