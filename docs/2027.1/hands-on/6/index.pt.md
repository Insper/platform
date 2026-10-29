!!! abstract "Neste lab"

    - Construa o **`inventory`**, o coração fortemente consistente do BoxOffice: assentos e **reservas** (*holds*), em que um assento nunca pode pertencer a dois fãs.
    - Compare três estratégias de concorrência numa venda relâmpago — **check-then-act ingênuo**, **lock pessimista** (`SELECT … FOR UPDATE`) e **lock otimista** (coluna de versão) — e *prove* quais vendem o mesmo assento duas vezes[^2].
    - Adicione uma **réplica de leitura** com replicação por streaming, roteie para ela as transações somente leitura e observe o **atraso de replicação** quebrando o read-your-writes.
    - Ponha o **PgBouncer** entre os serviços e o PostgreSQL, e use **`EXPLAIN ANALYZE`** + índices para corrigir a listagem lenta do catálogo.
    - **Meça** cada mudança: conflitos, vendas duplicadas, p99, atraso, conexões, tempo de consulta.

A venda relâmpago é o momento para o qual o BoxOffice existe: às 10:00, 60.000 assentos e dois milhões de fãs. O catálogo pôde ir para o cache porque alguns segundos de defasagem não fazem mal. **Os assentos são o oposto**: vender o mesmo assento duas vezes é o único bug que uma empresa de ingressos não pode se permitir. Este lab trata da camada de dados sob pressão[^1] — primeiro a corretude (transações e locks), depois a escala (réplicas, pooling, índices) — e dos trade-offs entre elas.

Este lab constrói o capítulo 6 da [história da disciplina](../../index.md#story), o banco de dados do qual todo serviço stateless agora depende. Ele implementa as decisões da aula 6: [um assento, uma reserva](../../classes/databases/transactions/index.md#double-booking) com locks ou uma verificação de versão, uma [réplica de leitura e o seu atraso](../../classes/databases/replication/index.md#lag), [pool de conexões](../../classes/databases/replication/index.md) com o PgBouncer e [índices lidos com `EXPLAIN`](../../classes/databases/models/index.md).

## Antes de começar { #before-you-start }

| | |
|---|---|
| **Tempo** | 4–5 horas (três partes: faça uma por encontro, se precisar) |
| **Você precisa de** | as ferramentas do lab 0; Docker com **8 GB** (onze contêineres, seis JVMs); portas 80, 8080, 8083, 5432, **5433**, **6432** e 6379 livres |
| **Diretório** | todo comando roda na raiz do seu repositório `boxoffice/` (Windows: dentro do WSL 2) |

``` { .bash .copy }
docker compose version        # Docker Compose v2.x (or newer)
java -version                 # 21 or newer
mvn -v                        # Apache Maven 3.9+
k6 version                    # k6 v1.0+
uv --version                  # uv (runs the Python helper scripts)
```

**Estado inicial** — o fim do lab 5:

``` { .tree title="boxoffice/ at the start of lab 6" }
boxoffice/
    docker-compose.yaml        # db, redis, catalog-1..3, auth, gateway, edge
    infra/nginx/nginx.conf
    load/ ...  scripts/ ...  results/ ...
    services/auth/  services/catalog/ (with the cache)  services/gateway/
```

!!! tip "Recupere o atraso"

    Pulou ou quebrou o lab 5? Baixe [boxoffice-after-lab-5.zip](../5/boxoffice-after-lab-5.zip), descompacte e `cd boxoffice`. Este lab **adiciona** `services/inventory`, `infra/postgres/*`, `infra/pgbouncer/*`, a migração do catalog `V3__index_events.sql`, quatro arquivos do k6 e `scripts/reset-inventory.sh`, e **substitui** o `docker-compose.yaml` e o `application.yaml` e o `SecurityConfig.java` do gateway; todos aparecem completos nas próximas páginas e estão em [`code/`](code/docker-compose.yaml). Ele também precisa de um **volume de banco novo** (`docker compose down -v`, explicado no passo 2).

## Slides

<div class="slides-embed">
  <iframe src="slides/data-at-scale.html" title="Slides: hands-on 6 — dados em escala" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/data-at-scale.html){:target="_blank"}

!!! info "Conexão com a teoria"

    - Aula 6, [Bancos de dados](../../classes/databases/index.md): [transações e isolamento](../../classes/databases/transactions/index.md) (anomalias, `SELECT … FOR UPDATE` para reservas de assentos), [replicação](../../classes/databases/replication/index.md) (líder–seguidor, atraso), índices e B-trees.
    - Aula 3, [Modelos de consistência](../../classes/distributed/consistency/index.md): read-your-writes.
    - Estudo de caso: [Venda de ingressos](../../classes/case-studies/ticketing/index.md) (a venda relâmpago do BoxOffice).
    - Catálogo de componentes: [Banco SQL](../../reference/components/storage/index.md#sql).

## Antes de medir: o playground { #before-you-measure-the-playground }

**Experimente:** o cenário `db-replicas` tem um primário e réplicas de leitura, com leituras e escritas separadas. Rode-o e depois aumente a fração de escritas: o que acontece com o primário enquanto as réplicas ficam ociosas? Aumente o atraso de replicação e observe o indicador de "leituras desatualizadas". Anote com que tipo de tráfego as réplicas ajudam — e com qual elas não ajudam em nada.

<div class="sdp" data-scenario="db-replicas" data-mode="compact" data-height="500"></div>

Depois olhe a venda inteira em `flash-sale`: a sala de espera, o inventário em SQL, o pagamento. O lab 7 constrói a sala de espera; hoje você constrói a caixa do inventário.

<div class="sdp" data-scenario="flash-sale" data-mode="compact" data-height="500"></div>

## O que você vai construir { #what-you-will-build }

``` diagram-sim
flowchart LR
    k6([fãs do k6]) --> edge[edge] --> gw[gateway]
    gw -->|"/catalog/**"| cat["catalog ×3"]
    gw -->|"/inventory/**"| inv["inventory :8083"]
    inv -->|"escritas, reservas<br/>(tx de leitura e escrita)"| pgb["pgbouncer :6432"]
    pgb --> db[("db (primário)")]
    inv -->|"mapas de assentos, disponibilidade<br/>(tx readOnly)"| rep[("db-replica")]
    db -->|"streaming do WAL"| rep
    cat --> db
    cat --> redis[(redis)]
```

| Método | Caminho | Auth | Banco | Resposta |
|---|---|---|---|---|
| `GET` | `/inventory/events/{eventId}/availability` | aberto | réplica | assentos por setor: disponíveis, reservados, vendidos |
| `GET` | `/inventory/events/{eventId}/seats?section=S01` | aberto | réplica | o mapa de assentos de um setor |
| `POST` | `/inventory/holds` `{eventId, seatIds}` | token | primário | `201` reserva (10 min), `409` se algum assento estiver ocupado |
| `GET` | `/inventory/holds/{id}` | token (dono) | primário | a reserva |
| `POST` | `/inventory/holds/{id}/confirm` | token (dono) | primário | os assentos viram `SOLD` (chamado pelo `order` no lab 7) |
| `DELETE` | `/inventory/holds/{id}` | token (dono) | primário | libera os assentos |
| `GET` | `/inventory/audit/double-bookings` | token | primário | `{"doubleBookedSeats": 0}` — o invariante |

O evento **1** tem **60.000 assentos** (30 setores × 40 fileiras × 50 assentos); os eventos 2–100 têm 500 assentos cada.

## Passos { #steps }

<div class="grid cards" markdown>

-   :material-seat:{ .lg .middle } **[1. Reservas e locks](holds/index.md)**

    ---

    O serviço `inventory`, três estratégias de lock, o teste da venda relâmpago e a auditoria de vendas duplicadas.

-   :material-database-sync:{ .lg .middle } **[2. Réplica e pool de conexões](replicas/index.md)**

    ---

    Replicação por streaming, roteamento de transações `readOnly`, atraso de replicação e read-your-writes, PgBouncer.

-   :material-magnify-scan:{ .lg .middle } **[3. Índices e EXPLAIN](indexes/index.md)**

    ---

    Leia um plano de consulta, acrescente os índices certos à listagem do catálogo, meça antes e depois.

</div>

## Meça { #measure-it }

Cada passo tem o seu próprio experimento; reúna os resultados em `results/lab6.md`:

``` { .markdown title="results/lab6.md" .copy }
# Lab 6 — data at scale

## 1. Flash sale: 200 fans, 100 seats, 30 s (load/flash-sale.js)
| INVENTORY_LOCKING | holds 201 | holds 409 | p50 hold (ms) | p99 hold (ms) | double-booked seats (audit) |
|---|---:|---:|---:|---:|---:|
| naive       | | | | | |
| pessimistic | | | | | |
| optimistic  | | | | | |

## 2. Reads: availability + seat maps at 200 req/s (load/availability.js)
| Reads served by | p50 (ms) | p99 (ms) | CPU db (%) | CPU db-replica (%) |
|---|---:|---:|---:|---:|
| primary (DB_REPLICA_HOST=db) | | | | |
| replica | | | | |

## 3. Read-your-writes (load/read-your-writes.js)
| REPLICA_DELAY | stale_reads (%) |
|---|---:|
| 0  | |
| 1s | |

## 4. Connections
| Setup | connections in pg_stat_activity during the flash sale |
|---|---:|
| inventory → db directly (INVENTORY_DB_HOST=db, PORT=5432) | |
| inventory → pgbouncer | |
PgBouncer SHOW POOLS: cl_active ____ , sv_active ____ , cl_waiting ____

## 5. Catalog listing before/after the indexes (EXPLAIN ANALYZE + sweep)
| | Execution time (ms) | Plan (main node) | Capacity with p99 < 300 ms (req/s) |
|---|---:|---|---:|
| before (V2) | | | |
| after (V3)  | | | |

## Conclusions
- Which locking strategy would you ship for the flash sale, and why?
- Which reads may go to the replica, and which must not?
- Cache (lab 5) or index (lab 6) for the listing — or both? Justify with your numbers.
```

!!! note "Se os seus números forem diferentes"

    Os resultados de corretude precisam bater em qualquer máquina: o `naive` termina com vendas duplicadas (quantas varia de execução para execução — 9 e 11 em execuções deste lab; se der 0, rode de novo ou aumente `VUS`), `pessimistic` e `optimistic` sempre terminam com 0. Latências, porcentagens de leituras desatualizadas e contagens de conexões dependem da sua máquina; compare-as apenas entre as suas próprias execuções.

## Solução de problemas { #troubleshooting }

| Sintoma | Causa | Correção |
|---|---|---|
| `db-replica` reinicia com `permission denied` no `replica-entrypoint.sh` | o script não é executável | `chmod +x infra/postgres/*.sh` e `docker compose up -d db-replica` |
| `db-replica` registra `no pg_hba.conf entry for replication connection` | o volume do primário é anterior a este lab, então o `10-replication.sh` nunca rodou | `docker compose down -v` e `docker compose up --build -d` (o Flyway popula tudo de novo) |
| `db-replica` sai: `max_connections ... must be at least the primary's value` | `DB_MAX_CONNECTIONS` no primário está acima de 100 | mantenha ≤ 100, ou aumente também na réplica |
| o inventory registra `password authentication failed` via PgBouncer | `userlist.txt` não bate com `DB_PASSWORD` | mantenha os dois como `boxoffice` (ou atualize os dois) |
| `prepared statement "S_1" already exists` | um PgBouncer sem `max_prepared_statements` (imagem mais antiga ou ini editado) | use `edoburu/pgbouncer:v1.26.0-p0` e o ini desta página |
| `503`/`404` em `/inventory/**` pelo edge | o gateway não foi reconstruído com a nova rota | `docker compose up --build -d gateway`; depois, `curl -s localhost:8080/actuator/gateway/routes \| jq -r '.[].route_id'` precisa listar `inventory` |
| reservas devolvem `401` | sem token (as reservas são protegidas) | faça login e passe `-H "Authorization: Bearer $TOKEN"` |
| contêineres mortos (`exit 137`), inicialização muito lenta | memória insuficiente para onze contêineres | dê 8 GB ao Docker, feche outros programas, ou pare `catalog-2`/`catalog-3` durante os experimentos do inventory |

!!! success "Boas práticas neste lab"

    - **Decida no banco, não na aplicação** — `SELECT … FOR UPDATE` com `ORDER BY id`, ou um compare-and-set de versão, no `HoldService.java`; veja [Transações — o bug da venda duplicada](../../classes/databases/transactions/index.md#double-booking).
    - **Mande para a réplica as leituras que podem estar desatualizadas, e todo o resto para o primário** — `@Transactional(readOnly = true)` roteado pelo `DataSourceConfig.java`; veja [Replicação — o atraso e as suas anomalias](../../classes/databases/replication/index.md#lag).
    - **Faça pool de conexões na frente do PostgreSQL, e migre contornando o pooler** — `pgbouncer.ini` em modo transação, `DB_MIGRATION_HOST` para o Flyway no `application.yaml` do `inventory`; veja [Replicação](../../classes/databases/replication/index.md) (pool de conexões).
    - **Acrescente um índice para uma consulta medida, conferido com `EXPLAIN ANALYZE`** — `V3__index_events.sql`; veja [Modelos de dados e engines de armazenamento](../../classes/databases/models/index.md) (lendo o `EXPLAIN`).
    - **Audite o invariante depois de todo teste** — `SeatQueries.doubleBookedSeats` atrás de `/inventory/audit/double-bookings`; veja [Transações — reservas de assentos](../../classes/databases/transactions/index.md#seat-holds).

## Limpeza { #clean-up }

``` { .bash .copy }
REPLICA_DELAY=0 docker compose up -d db-replica             # if you left the artificial lag on
INVENTORY_LOCKING=pessimistic docker compose up -d inventory
bash scripts/reset-inventory.sh                             # all seats back on sale
docker compose down                                         # keep the volumes for lab 7
```

Guarde tudo: o lab 7 acrescenta o `order` e o Kafka a esta stack e confirma as reservas pelo `inventory`.

## Entrega { #deliverable }

- [ ] `services/inventory` rodando atrás do gateway; o gateway roteia `/inventory/**` (GETs em `/inventory/events/**` abertos, reservas protegidas).
- [ ] A tabela da venda relâmpago com as três estratégias, incluindo o resultado da **auditoria** de cada uma: pelo menos uma execução do `naive` com vendas duplicadas > 0, e `pessimistic`/`optimistic` com 0.
- [ ] `db-replica` em streaming (o `pg_stat_replication` a mostra), leituras roteadas para ela e o experimento de read-your-writes com e sem `REPLICA_DELAY`.
- [ ] PgBouncer na frente do primário, com as contagens de conexões.
- [ ] `EXPLAIN ANALYZE` da listagem do catálogo antes e depois do `V3__index_events.sql`, e o sweep depois.
- [ ] `results/lab6.md` completo com as três conclusões.
- [ ] Repositório com a tag `lab6`; [quiz](quiz.md) respondido.

## Estado final { #end-state }

``` { .tree title="changed in lab 6" }
boxoffice/
    docker-compose.yaml        # replaced: + db-replica (5433), + pgbouncer (6432), + inventory (8083)
    infra/postgres/10-replication.sh  infra/postgres/replica-entrypoint.sh     # new
    infra/pgbouncer/pgbouncer.ini  infra/pgbouncer/userlist.txt               # new
    load/lib.js  load/flash-sale.js  load/availability.js  load/read-your-writes.js   # new
    scripts/reset-inventory.sh                                                # new
    services/inventory/        # new: seats, holds, three locking strategies, replica routing
    services/catalog/src/main/resources/db/migration/V3__index_events.sql    # new
    services/gateway/src/main/resources/application.yaml                     # replaced: + /inventory/** route
    services/gateway/src/main/java/boxoffice/gateway/SecurityConfig.java     # replaced: GET /inventory/events/** open
    results/lab6.md
```

Próximo: [Lab 7 — Assíncrono](../7/index.md), em que o `order` confirma as reservas por meio de eventos.

[^1]: Martin Kleppmann e Chris Riccomini, *Designing Data-Intensive Applications*, 2ª ed., O'Reilly — capítulos sobre transações e replicação.
[^2]: Documentação do PostgreSQL, [Explicit Locking](https://www.postgresql.org/docs/17/explicit-locking.html){target="_blank"}, [Log-Shipping Standby Servers](https://www.postgresql.org/docs/17/warm-standby.html){target="_blank"} e [Using EXPLAIN](https://www.postgresql.org/docs/17/using-explain.html){target="_blank"}.
