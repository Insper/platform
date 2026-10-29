Durante a venda, para cada fã que reserva um assento, dezenas olham o mapa de assentos. Essas leituras não precisam do primário: uma **réplica de leitura** — uma cópia do banco mantida atualizada pelo streaming do write-ahead log (WAL) do primário — pode atendê-las. Dois custos vêm junto: a cópia fica **um pouco atrasada** (atraso de replicação), e agora você roteia consultas para dois lugares. Este passo também adiciona o **PgBouncer**, porque cada réplica de cada serviço abrindo o seu próprio pool de conexões é como o PostgreSQL fica sem conexões.

## 1. Replicação por streaming { #1-streaming-replication }

``` diagram-sim
sequenceDiagram
    autonumber
    participant I as inventory
    participant P as db (primário)
    participant R as db-replica (hot standby)
    Note over R: primeira inicialização: o pg_basebackup copia o primário
    I->>P: BEGIN; UPDATE seats ...; COMMIT
    P->>P: grava o registro no WAL, flush
    P-->>I: COMMIT ok (replicação assíncrona: não espera R)
    P->>R: streaming do WAL
    R->>R: reaplica (depois de recovery_min_apply_delay)
    I->>R: SELECT da disponibilidade (tx readOnly)
    R-->>I: resultado, possivelmente alguns ms defasado
```

O primário precisa de um usuário com permissão para replicar. Este script roda **uma vez**, quando o volume do primário é criado:

``` { .bash title="infra/postgres/10-replication.sh" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/infra/postgres/10-replication.sh"
```

A réplica clona o primário na sua primeira inicialização e depois o acompanha:

``` { .bash title="infra/postgres/replica-entrypoint.sh" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/infra/postgres/replica-entrypoint.sh"
```

!!! warning "Recrie o volume do banco"

    O `10-replication.sh` só roda num diretório de dados **vazio**. O seu volume `db-data` existe desde o lab 1, então recrie-o (o Flyway popula tudo de novo na inicialização): `docker compose down -v` antes do primeiro `up` deste lab. Lembre-se de `chmod +x infra/postgres/*.sh`.

## 2. PgBouncer

Cada conexão do PostgreSQL é um **processo** do sistema operacional com a sua própria memória; algumas centenas vão bem, milhares não. Conte os clientes: 3 réplicas do catalog × 10 + auth × 10 + inventory × 20 × 2 pools… e no lab 10 o Kubernetes vai escalar réplicas automaticamente. O **PgBouncer** aceita muitas conexões de cliente baratas e as multiplexa sobre um pool pequeno de conexões reais.

``` { .ini title="infra/pgbouncer/pgbouncer.ini" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/infra/pgbouncer/pgbouncer.ini"
```

``` { .text title="infra/pgbouncer/userlist.txt" .copy }
--8<-- "docs/2027.1/hands-on/6/code/infra/pgbouncer/userlist.txt"
```

| Modo de pool | Uma conexão de servidor é emprestada por… | Quebra |
|---|---|---|
| `session` | toda a conexão do cliente | nada, mas economiza pouco |
| **`transaction`** | uma transação | estado de sessão: `SET`, advisory locks de sessão, `LISTEN`, tabelas temporárias |
| `statement` | um comando | transações com vários comandos |

O pooling por transação é o que torna o PgBouncer eficaz — e é por isso que **o Flyway não passa por ele**: as migrações usam locks de nível de sessão. Por isso o `inventory` tem dois hosts: `DB_HOST=pgbouncer` para a aplicação e `DB_MIGRATION_HOST=db` para o Flyway.

## 3. Compose { #3-compose }

``` { .yaml title="docker-compose.yaml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/docker-compose.yaml"
```

``` { .bash .copy }
chmod +x infra/postgres/*.sh
docker compose down -v
docker compose up --build -d
docker compose exec db psql -U boxoffice -c "SELECT client_addr, state, sent_lsn, replay_lsn FROM pg_stat_replication"
docker compose exec db-replica psql -U boxoffice -c "SELECT pg_is_in_recovery(), now() - pg_last_xact_replay_timestamp() AS lag"
```

A coluna `lag` é o tempo desde que a réplica reaplicou a última transação: enquanto o primário está ocioso, ela continua crescendo, mesmo com a réplica totalmente em dia. Compare `sent_lsn` e `replay_lsn` no primário para ver a distância real.

<!-- termynal -->
``` shell
> docker compose exec db psql -U boxoffice -c "SELECT client_addr, state FROM pg_stat_replication"
 client_addr |   state
-------------+-----------
 172.22.0.4  | streaming
> docker compose exec db-replica psql -U boxoffice -c "INSERT INTO inventory.holds VALUES (gen_random_uuid(), 1, 'x', 'ACTIVE', now(), now())"
ERROR:  cannot execute INSERT in a read-only transaction
```

## 4. Roteando leituras para a réplica { #4-routing-reads-to-the-replica }

``` { .java title="services/inventory/src/main/java/boxoffice/inventory/DataSourceConfig.java" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/services/inventory/src/main/java/boxoffice/inventory/DataSourceConfig.java"
```

O `LazyConnectionDataSourceProxy` entrega uma conexão provisória quando uma transação começa e busca a real no primeiro comando — a essa altura o Spring já sabe se a transação é `readOnly` e escolhe o pool. A regra vira uma anotação:

| Método | Anotação | Vai para | Por quê |
|---|---|---|---|
| `SeatQueries.availability`, `seats` | `@Transactional(readOnly = true)` | **réplica** | navegação; alguns ms de defasagem não fazem mal |
| `HoldService.hold`, `confirm`, `release` | `@Transactional` | primário | escritas |
| `HoldService.find` | `@Transactional` | primário | **read-your-writes**: o fã acabou de criar esta reserva |
| `SeatQueries.doubleBookedSeats` | `@Transactional` | primário | uma auditoria não pode estar defasada |

Os dois pools publicam métricas (`hikaricp.connections.active{pool=primary|replica}`): confira-as enquanto um teste roda, `curl -s 'localhost:8083/actuator/metrics/hikaricp.connections.active?tag=pool:replica' | jq`.

## 5. Experimentos { #5-experiments }

**Alívio pela réplica.** Rode a carga de leitura contra a réplica, depois aponte o pool "replica" para o primário e rode de novo — sem mudar código:

``` { .javascript title="load/availability.js" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/load/availability.js"
```

``` { .bash .copy }
k6 run -e RATE=200 load/availability.js                     # reads on db-replica
DB_REPLICA_HOST=db docker compose up -d inventory && sleep 25
k6 run -e RATE=200 load/availability.js                     # reads on the primary
docker compose up -d inventory                              # back to the replica
```

Deixe o `docker stats` aberto: a CPU passa do `db` para o `db-replica`. A latência do mapa de assentos quase não muda — uma réplica não deixa uma consulta mais rápida, ela **acrescenta capacidade** e impede que as leituras disputem recursos com as escritas da venda.

**Read-your-writes.** Um fã reserva um assento e recarrega na hora o mapa de assentos, atendido pela réplica:

``` { .javascript title="load/read-your-writes.js" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/6/code/load/read-your-writes.js"
```

``` { .bash .copy }
bash scripts/reset-inventory.sh && k6 run load/read-your-writes.js    # lag ~ milliseconds
REPLICA_DELAY=1s docker compose up -d db-replica && sleep 10
bash scripts/reset-inventory.sh && k6 run load/read-your-writes.js    # lag of 1 second
REPLICA_DELAY=0 docker compose up -d db-replica
```

Mesmo sem atraso artificial, `stale_reads` não é zero: numa execução de teste deste lab, ficou em **cerca de 6%** — a réplica na mesma máquina está só milissegundos atrás, mas a próxima requisição do fã também chega em milissegundos. Com `REPLICA_DELAY=1s`, ficou em **98%**: quase nenhum fã **viu a própria reserva** no mapa de assentos, embora o `GET /inventory/holds/{id}` (primário) a mostre. Em produção, o atraso cresce com o volume de escritas, a distância de rede e consultas longas na réplica — exatamente durante uma venda relâmpago.

Saídas: ler as suas próprias escritas recentes do primário (o que o `find` faz), rotear um usuário para o primário por alguns segundos depois de ele escrever (leituras "sticky"), ou esperar até a réplica ter reaplicado o LSN (log sequence number) da escrita.

**PgBouncer.** Conte as conexões durante a venda relâmpago, com e sem o pooler:

``` { .bash .copy }
# during load/flash-sale.js:
docker compose exec db psql -U boxoffice -c "SELECT usename, application_name, count(*) FROM pg_stat_activity GROUP BY 1, 2"
docker compose exec -e PGPASSWORD=boxoffice db psql -h pgbouncer -p 6432 -U boxoffice pgbouncer -c "SHOW POOLS"

# without PgBouncer:
INVENTORY_DB_HOST=db INVENTORY_DB_PORT=5432 docker compose up -d inventory
```

Numa execução de teste deste lab, o `pg_stat_activity` mostrou cerca de 60 conexões da aplicação: 30 das três réplicas do catalog, 10 do `auth` e 20 do PgBouncer — que atendeu todas as conexões de cliente do `inventory`. O `SHOW POOLS` mostrou `cl_active` 20 contra `sv_active` + `sv_idle` + `sv_used` ≤ 20.

Force a barra: reinicie com `DB_MAX_CONNECTIONS=80 INVENTORY_POOL_SIZE=40 docker compose up -d`. Pelo PgBouncer tudo funciona (o PostgreSQL continua vendo no máximo 20 conexões vindas dele). Direto contra o `db` (`INVENTORY_DB_HOST=db INVENTORY_DB_PORT=5432`), 30 + 10 + 40 conexões mais os slots reservados ao superusuário passam de 80, e o `inventory` falha com `FATAL: sorry, too many clients already`. Um pooler transforma "clientes demais" em **fila** (`cl_waiting`).

!!! tip "Na entrevista"

    "Adicionar réplicas de leitura" só é resposta para carga **com muita leitura** que tolera **defasagem**. Diga quais leituras vão para as réplicas, como você trata o read-your-writes e o que acontece com as escritas — as réplicas não fazem nada por elas; isso exige particionamento (aula 6) ou menos trabalho por escrita.

Próximo: [3. Índices e EXPLAIN](../indexes/index.md).
