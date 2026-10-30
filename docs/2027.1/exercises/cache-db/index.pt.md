Durante uma venda da BoxOffice, quase toda requisição é uma **leitura** das mesmas poucas coisas: a página do evento, o local, a tabela de preços. Mandar cada uma delas para o banco primário é como pedir ao atendente da bilheteria que reimprima o cartaz para cada fã da fila. Neste exercício você coloca um **cache Redis** e uma **réplica de leitura PostgreSQL** na frente do seu serviço, mede o que eles trazem e encara o preço: **dados desatualizados**, **atraso de replicação** e o **cache stampede**.

!!! abstract "Objetivos de aprendizagem"

    Ao final deste exercício você será capaz de:

    - **Implementar** cache-aside com TTL, jitter e invalidação na escrita, e uma separação leitura/escrita entre um primário e uma réplica.
    - **Prever** a taxa de acerto e a carga no banco a partir da distribuição das chaves, e **verificar** a previsão com medições.
    - **Comparar** antes/depois com a mesma carga: p99, joelho, carga no banco.
    - **Demonstrar** uma leitura desatualizada causada pelo atraso de replicação (e pelo cache) e **mitigá-la**.
    - **Reproduzir** um cache stampede e **corrigi-lo** com coalescência de requisições.

## Contexto { #context }

A [Aula 6](../../classes/databases/index.md) tratou de replicação e de suas anomalias de consistência[^1]; a [Aula 7](../../classes/caching/index.md), de padrões de cache, invalidação e modos de falha. O [Lab 5](../../hands-on/5/index.md) construiu o cache-aside no `catalog` e o [Lab 6](../../hands-on/6/index.md), uma réplica de leitura. Aqui você combina os dois, no **seu** serviço, como um experimento com números. Parta do serviço e do script k6 do [relatório de teste de carga](../load-test-report/index.md) — aquele relatório é o seu **"antes"**.

O caminho de leitura que você vai construir:

``` diagram-sim
sequenceDiagram
    participant C as Cliente
    participant A as catalog
    participant R as Redis
    participant P as Réplica PostgreSQL
    C->>A: GET /events/42
    A->>R: GET event:42
    R-->>A: (miss)
    A->>P: SELECT ... WHERE id = 42
    P-->>A: linha
    A->>R: SET event:42 (TTL 60 s + jitter)
    A-->>C: 200 OK
    C->>A: GET /events/42
    A->>R: GET event:42
    R-->>A: (hit)
    A-->>C: 200 OK
```

### A matemática que você vai conferir { #the-math-you-will-check }

Com uma taxa de requisições λ e uma taxa de acerto *h*, o banco recebe apenas os misses:

$$
\lambda_{db} = (1 - h)\,\lambda
\qquad
\bar{t} \approx h\,t_{cache} + (1 - h)\,(t_{cache} + t_{db})
$$

A taxa de acerto depende da **popularidade das chaves**. Com uma distribuição de Zipf (expoente 1) sobre 1.000 eventos, os 200 eventos mais populares recebem cerca de `H₂₀₀ / H₁₀₀₀ ≈ 5,88 / 7,49 ≈ 78%` das leituras (Hₙ é o número harmônico, ≈ ln n + 0,577). Com TTL de 60 s, cada chave lida dá miss mais ou menos uma vez por TTL, então no máximo ~1.000 / 60 ≈ 17 misses/s — a 1.000 req/s, isso é uma taxa de acerto em torno de 98% depois que o cache aquece. **Escreva a sua própria previsão antes de medir.**

## Tarefa { #task }

A partir do seu serviço do relatório de teste de carga (o `catalog` da BoxOffice, recomendado):

1. Acrescente **cache-aside** com Redis no principal endpoint de leitura (`GET /events/{id}`): TTL com jitter, **remoção na escrita** depois do commit da transação, contadores de hit/miss.
2. Acrescente uma **réplica PostgreSQL por streaming** e direcione **as transações somente leitura para a réplica** e as escritas para o primário.
3. Execute **a mesma carga k6** (com chaves em distribuição de Zipf e uma pequena parcela de escritas) **antes** (ambiente do ex2) e **depois**, e compare.
4. **Demonstre uma leitura desatualizada** (atraso da réplica e cache) e implemente ou argumente uma **mitigação**.
5. **Reproduza um cache stampede** em uma chave quente e **corrija-o**.

## Requisitos { #requirements }

- [ ] **(obrigatório)** Cache-aside no endpoint de leitura com TTL **e** invalidação na escrita (depois do commit); um contador de hits e um de misses expostos como métricas.
- [ ] **(obrigatório)** Uma réplica por streaming com separação leitura/escrita; evidência de que **≥ 90% das transações de leitura** vão para a réplica (`pg_stat_database` nos dois nós).
- [ ] **(obrigatório)** Antes/depois com **o mesmo** script k6, os mesmos dados e os mesmos recursos; resultados brutos versionados.
- [ ] A sua **previsão** de taxa de acerto e de carga no banco, depois a medição: taxa de acerto **≥ 80%** em regime, e leituras no banco dentro de **±20%** de `(1 − h) λ` (ou uma explicação da diferença).
- [ ] p99 na taxa de load do ex2 e o **novo joelho** (teste de stress), comparados com o antes.
- [ ] Atraso de replicação medido **ocioso** e **sob carga de escrita**.
- [ ] Uma **leitura desatualizada** demonstrada passo a passo (pausando o replay na réplica) e uma mitigação implementada ou argumentada com precisão (read-your-writes).
- [ ] Um **stampede** reproduzido (≈ N leituras no banco para N misses simultâneos da mesma chave) e corrigido (≤ 1 leitura no banco por instância).
- [ ] Uma breve discussão: o que **não** deve ir para o cache na BoxOffice (por exemplo, a disponibilidade de assentos no checkout) e por quê.
- [ ] Seção *Uso de IA* (veja a [política](../index.md#use-of-ai-tools)).

## Entregáveis { #deliverables }

No seu repositório (tag `ex3`): as mudanças no código, o `compose.yaml` com o Redis e a réplica, os scripts k6, os resultados brutos (`load/results/`) e uma página `cache-db` no site da sua documentação seguindo o [template](#templates).

## Passo a passo { #step-by-step }

### 1. Acrescente o Redis e uma réplica ao Compose { #1-add-redis-and-a-replica-to-compose }

A réplica é criada com `pg_basebackup` a partir do primário na primeira vez que sobe; `-R` grava as configurações que a tornam um standby por streaming.

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

Confira se a réplica está recebendo o streaming:

```bash
docker compose exec db psql -U catalog -c "select client_addr, state, replay_lag from pg_stat_replication;"
docker compose exec db-replica psql -U catalog -d catalog -c "select pg_is_in_recovery();"
```

### 2. Cache-aside no serviço { #2-cache-aside-in-the-service }

Escreva o padrão à mão (em vez de `@Cacheable`) para controlar TTL, invalidação e métricas[^2].

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

Invalide **depois** do commit da escrita — remover antes do commit permite que uma leitura concorrente coloque o valor antigo de volta:

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

### 3. Direcione as leituras para a réplica { #3-route-reads-to-the-replica }

Um `DataSource` de roteamento escolhe a réplica para transações somente leitura. O `LazyConnectionDataSourceProxy` adia a obtenção da conexão até que a marcação de somente leitura da transação seja conhecida.

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

Anote os métodos do leitor com `@Transactional(readOnly = true)` e os do escritor com `@Transactional`. Confira a separação contando as transações confirmadas em cada nó antes e depois de um teste:

```bash
for svc in db db-replica; do
  docker compose exec "$svc" psql -U catalog -d catalog -tAc \
    "select '$svc', xact_commit from pg_stat_database where datname = 'catalog';"
done
```

### 4. A mesma carga, com chaves populares { #4-the-same-workload-with-popular-keys }

O tráfego real é concentrado: poucos eventos recebem a maior parte das visualizações. Troque os ids uniformes do script do ex2 por ids com distribuição de Zipf e acrescente uma pequena parcela de escritas (para que aconteçam invalidações).

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

Adapte o `PUT` à sua API (e à sua autenticação). Execute o **antes** (cache desligado, sem réplica — por exemplo, um profile do Spring) e o **depois** com a mesma taxa, os mesmos dados iniciais e os mesmos recursos.

### 5. Meça a taxa de acerto, a carga no banco e o atraso { #5-measure-hit-ratio-database-load-and-lag }

Leia cada contador no início e no fim da parte estável do teste e use a **diferença**:

```bash
docker compose exec redis redis-cli INFO stats | grep -E 'keyspace_(hits|misses)'
curl -s localhost:8080/actuator/metrics/catalog.cache | jq '.measurements'
docker compose exec db psql -U catalog -c "select application_name, state, write_lag, replay_lag from pg_stat_replication;"
docker compose exec db-replica psql -U catalog -d catalog -c "select now() - pg_last_xact_replay_timestamp() as replica_delay;"
```

`replica_delay` cresce quando o primário está ocioso (não há transações novas para aplicar), então leia-o **sob carga de escrita**; o `replay_lag` no primário é o número mais confiável.

### 6. Provoque uma leitura desatualizada { #6-make-a-stale-read-happen }

O atraso de replicação costuma ser de milissegundos — rápido demais para ver. Pause o replay na réplica para torná-lo visível e determinístico:

```bash
docker compose exec db-replica psql -U postgres -c "select pg_wal_replay_pause();"
curl -s -X PUT localhost:8080/events/1 -H 'Content-Type: application/json' -d '{"description":"new"}'
curl -s localhost:8080/events/1      # which description do you get, and why?
docker compose exec db-replica psql -U postgres -c "select pg_wal_replay_resume();"
```

Explique o que você observa, incluindo a **corrida cache + réplica**: a escrita remove `event:1`; a leitura seguinte dá miss, lê a linha *antiga* da réplica atrasada e coloca o valor antigo de volta no cache — onde ele fica por um TTL inteiro. Depois mitigue, por exemplo: ler do primário por alguns segundos depois de uma escrita do mesmo cliente (*read-your-writes*), recarregar o cache a partir do primário depois de uma escrita (write-through) ou manter o TTL curto para dados que mudam. Justifique a escolha para a BoxOffice.

### 7. Reproduza e corrija um stampede { #7-reproduce-and-fix-a-stampede }

Quando uma chave quente expira, todas as requisições simultâneas dão miss de uma vez e vão ao banco — o *thundering herd*. Reproduza com 200 requisições simultâneas para o mesmo id logo depois de remover a chave:

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

Conte os misses (leituras no banco) para as 200 requisições. Depois corrija com **coalescência de requisições**: misses simultâneos da mesma chave em uma instância esperam por uma única carga.

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

Em `findById`, troque o ramo do miss (contador, leitura, `SET`) por `return loadOnce(id);`. Com *k* instâncias você tem no máximo *k* leituras no banco por expiração. Um lock no Redis (`SET lock:event:1 <token> NX PX 3000`) ou a renovação antecipada probabilística são alternativas — compare-as na sua discussão.

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

## Rubrica { #rubric }

Níveis conforme definidos em [Como os exercícios são avaliados](../index.md#how-the-exercises-are-graded).

| Critério | I | D | C | B | A |
|-|-|-|-|-|-|
| Cache-aside **(obrigatório)** | Ausente | Sem TTL ou sem invalidação na escrita | TTL + remoção depois do commit + métricas de hit/miss | Jitter no TTL; falha do cache não quebra as leituras (volta ao BD) | Dimensionamento de memória e política de remoção justificados com números |
| Réplica e roteamento **(obrigatório)** | Ausente | A réplica existe mas as leituras não são roteadas | ≥ 90% das leituras na réplica, mostrado com contadores | Caminhos de escrita e de read-your-writes identificados | Falha de roteamento tratada (réplica fora → primário) e testada |
| Experimento **(obrigatório)** | Sem antes/depois | Scripts, dados ou recursos diferentes | Mesma carga antes/depois, dados brutos versionados | Previsão enunciada antes e comparada com a medição | Sensibilidade: taxa de acerto vs expoente de Zipf ou TTL, em gráfico |
| Resultados | — | Parciais | Taxa de acerto, carga no BD, p99 e joelho informados | Diferenças entre previsão e medição explicadas | Deslocamento do joelho explicado pelo novo gargalo, com evidência |
| Consistência | — | Não tratada | Leitura desatualizada demonstrada | Corrida cache + réplica explicada e mitigada | Mitigação testada sob carga, custo discutido |
| Stampede | — | Não feito | Reproduzido e corrigido, com números | Alternativas comparadas (lock, renovação antecipada) | Comportamento com várias instâncias medido |

## FAQ

??? question "Por que não usar simplesmente `@Cacheable`?"

    Você pode, no seu projeto. Aqui, escrever o cache-aside à mão deixa toda decisão visível: qual é a chave, quando expira, quando é removida e o que é contado. O `@Cacheable` esconde justamente as partes de que este exercício trata.

??? question "Devo remover ou atualizar o cache numa escrita?"

    Remover é o padrão do cache-aside: a próxima leitura o recarrega da fonte da verdade. Atualizar (write-through) evita um miss, mas pode competir com escritas concorrentes e guardar um valor mais antigo. Em qualquer caso, faça **depois** do commit.

??? question "Minha taxa de acerto é 99,9% — é suspeito?"

    Talvez: confira se a carga não está lendo sempre a mesma chave, se os contadores são diferenças na janela estável (e não desde a inicialização) e se as escritas acontecem. Uma taxa muito alta é plausível para um conjunto de chaves pequeno e concentrado com TTL longo — mostre as contas.

??? question "Onde entra a disponibilidade de assentos?"

    Não neste cache. Reservas de assento precisam de consistência forte (nada de venda duplicada) e pertencem ao serviço `inventory` e às suas transações ([Lab 6](../../hands-on/6/index.md)). Uma *exibição* da disponibilidade pode ficar em cache por um ou dois segundos — no checkout, quem decide é o banco.

??? question "A configuração da réplica falha com erro de autenticação."

    O script de inicialização só roda quando o diretório de dados do primário é criado. Se você subiu o primário antes de acrescentar o script, apague o volume dele (`docker compose down -v`) e suba de novo.

??? question "Preciso de duas instâncias do serviço para o stampede?"

    Não. Uma instância basta para reproduzir e corrigir. Testar com Nginx e várias instâncias (Lab 3) é uma extensão nível A: você deve ver no máximo uma leitura no banco por instância.

[^1]: Martin Kleppmann e Chris Riccomini, *Designing Data-Intensive Applications*, 2ª ed., O'Reilly — capítulos sobre replicação (atraso de replicação, read-your-writes).
[^2]: Documentação do Redis, "Client-side caching" e "Eviction", [redis.io/docs](https://redis.io/docs/latest/){target="_blank"}.
