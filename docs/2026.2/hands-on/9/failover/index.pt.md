Comece de um cluster limpo, para que a saída bata com a mostrada abaixo:

``` { .bash .copy .select }
docker compose down -v
docker compose up -d --wait
docker compose exec pg-primary psql -U store -c "CREATE TABLE orders (id serial PRIMARY KEY, item text NOT NULL, created_at timestamptz DEFAULT now());" -c "INSERT INTO orders (item) VALUES ('keyboard'), ('mouse');"
```

## 1. Failover planejado

### O primário cai

``` { .bash .copy .select }
docker compose stop pg-primary
```

Um cliente que precisa escrever não encontra nenhum primário:

``` { .bash .copy .select }
docker compose run --rm client "host=pg-primary,pg-replica1,pg-replica2 target_session_attrs=read-write connect_timeout=2" -c "SELECT 1;"
```

```
psql: error: could not translate host name "pg-primary" to address: Name or service not known
connection to server at "pg-replica1" (172.18.0.3), port 5432 failed: session is read-only
connection to server at "pg-replica2" (172.18.0.4), port 5432 failed: session is read-only
```

(A primeira linha também pode dizer `Connection refused`.) As réplicas continuam no ar e continuam respondendo leituras — os dados não se perderam, mas as escritas estão **indisponíveis**. As réplicas continuam tentando se reconectar:

``` { .bash .copy .select }
docker compose logs --tail 3 pg-replica2
```

```
FATAL:  could not connect to the primary server: connection to server at "pg-primary" (172.18.0.2), port 5432 failed: Connection refused
LOG:  waiting for WAL to become available at 0/4038AB8
```

### Promover uma réplica

``` { .bash .copy .select }
docker compose exec pg-replica1 psql -U store -c "SELECT pg_promote();"
```

A `pg-replica1` sai da recuperação, inicia uma nova **timeline** (2) e passa a aceitar escritas:

``` { .bash .copy .select }
docker compose logs --tail 4 pg-replica1
docker compose exec pg-replica1 psql -U store -c "SELECT pg_is_in_recovery();" -c "INSERT INTO orders (item) VALUES ('after-failover');"
```

```
LOG:  selected new timeline ID: 2
LOG:  database system is ready to accept connections
...
 pg_is_in_recovery
-------------------
 f

INSERT 0 1
```

A timeline marca a bifurcação na história: o WAL na timeline 2 pertence ao novo primário e qualquer servidor ainda na timeline 1 é uma cópia do passado.

### Os clientes encontram o novo primário

Rode **o mesmo comando** que falhou há um minuto:

``` { .bash .copy .select }
docker compose run --rm client "host=pg-primary,pg-replica1,pg-replica2 target_session_attrs=read-write connect_timeout=2" -Atc "SELECT current_setting('cluster_name');"
```

```
pg-replica1
```

Nenhuma configuração mudou no cliente: o driver tentou a lista de novo e ficou com o host que aceita escritas. (Um serviço já conectado ao primário antigo perde as suas conexões e precisa se reconectar — pools de conexões como o HikariCP fazem isso automaticamente.)

### Reapontar a outra réplica

A `pg-replica2` ainda faz streaming a partir do `pg-primary`, que não existe mais. Diga a ela onde está o novo primário; o `primary_conninfo` passa a valer com um reload, sem reinício:

``` { .bash .copy .select }
docker compose exec pg-replica2 psql -U store -c "ALTER SYSTEM SET primary_conninfo = 'host=pg-replica1 user=replicator password=replpass';" -c "SELECT pg_reload_conf();"
```

``` { .bash .copy .select }
docker compose logs --tail 3 pg-replica2
docker compose exec pg-replica2 psql -U store -c "SELECT count(*) FROM orders;" -c "SELECT status, sender_host, received_tli FROM pg_stat_wal_receiver;"
```

```
LOG:  new target timeline is 2
LOG:  restarted WAL streaming at 0/5000000 on timeline 2
...
 count
-------
     3

  status   | sender_host | received_tli
-----------+-------------+--------------
 streaming | pg-replica1 |            2
```

A `pg-replica2` acompanhou a troca de timeline e já tem a linha `after-failover`.

### Trazer o primário antigo de volta, como réplica

O primário antigo **não** pode subir de novo como primário: haveria dois primários (split brain). O `rejoin-as-replica.sh` roda o `pg_rewind` contra o novo primário — ele descarta tudo o que o primário antigo escreveu depois da bifurcação — e adiciona `standby.signal` e `primary_conninfo`, como o `pg_basebackup -R` fez para as réplicas. Rode-o em um container avulso que monta o volume do primário antigo:

!!! warning "O nó precisa estar parado"

    Verifique com `docker compose ps` que o `pg-primary` **não** está rodando antes de executar o script: dois servidores no mesmo diretório de dados o corrompem.

``` { .bash .copy .select }
docker compose run --rm --no-deps --entrypoint bash pg-primary /scripts/rejoin-as-replica.sh pg-replica1
```

```
pg_rewind: connected to server
pg_rewind: servers diverged at WAL location 0/4038AA0 on timeline 1
pg_rewind: no rewind required
rejoin: pg-primary will follow pg-replica1 on its next start
```

"No rewind required": as timelines se separaram logo depois do último registro do WAL do primário antigo (o seu checkpoint de desligamento, enviado às réplicas durante uma parada limpa), então ele não escreveu nada que falte ao novo primário — não há nada a descartar. Suba-o:

``` { .bash .copy .select }
docker compose start pg-primary
docker compose exec pg-replica1 psql -U store -c "SELECT application_name, state FROM pg_stat_replication;"
```

```
 application_name |   state
------------------+-----------
 pg-replica2      | streaming
 pg-primary       | streaming
```

O cluster está inteiro de novo, com os papéis trocados. Os nomes `pg-primary` e `pg-replica1` não descrevem mais os papéis — é por isso que clusters reais dão nomes neutros aos nós (`pg-1`, `pg-2`, `pg-3`) e sempre perguntam a um nó qual é o seu papel (`pg_is_in_recovery()`).

``` mermaid-sim
stateDiagram-v2
    direction LR
    state "pg-primary: primário" as P1
    state "pg-primary: fora do ar" as P2
    state "pg-primary: réplica da pg-replica1" as P3
    P1 --> P2: docker compose stop
    P2 --> P3: pg_rewind + standby.signal
    state "pg-replica1: réplica" as R1
    state "pg-replica1: primário (timeline 2)" as R2
    R1 --> R2: pg_promote()
```

## 2. Failover não planejado: uma escrita perdida

Uma parada planejada não perde nada. Um **crash** com replicação assíncrona pode perder. Para tornar isso reproduzível, mantenha as réplicas longe da última escrita: pare-as, escreva no primário e *mate* o primário.

``` { .bash .copy .select }
docker compose down -v
docker compose up -d --wait
docker compose exec pg-primary psql -U store -c "CREATE TABLE orders (id serial PRIMARY KEY, item text NOT NULL, created_at timestamptz DEFAULT now());" -c "INSERT INTO orders (item) VALUES ('keyboard'), ('mouse');"
```

``` { .bash .copy .select }
docker compose stop pg-replica1 pg-replica2
docker compose exec pg-primary psql -U store -c "INSERT INTO orders (item) VALUES ('lost-write');"
docker compose kill pg-primary
docker compose start pg-replica1 pg-replica2
```

O `INSERT` respondeu `INSERT 0 1`: para o cliente, o pedido **existe**. Agora faça o failover como antes:

``` { .bash .copy .select }
docker compose exec pg-replica1 psql -U store -c "SELECT pg_promote();" -c "INSERT INTO orders (item) VALUES ('after-failover');" -c "SELECT * FROM orders ORDER BY id;"
docker compose exec pg-replica2 psql -U store -c "ALTER SYSTEM SET primary_conninfo = 'host=pg-replica1 user=replicator password=replpass';" -c "SELECT pg_reload_conf();"
```

```
 id |      item      |          created_at
----+----------------+-------------------------------
  1 | keyboard       | 2026-10-31 18:51:44.203097+00
  2 | mouse          | 2026-10-31 18:51:44.203097+00
 34 | after-failover | 2026-10-31 18:51:50.223978+00
```

O `lost-write` **sumiu**: ele existia apenas no WAL do primário morto. Este é o **RPO** (*recovery point objective*) da replicação assíncrona — os commits do último instante antes de um crash. (O salto de 2 para 34 não é um bug: uma sequence registra os seus valores em lotes de 32 e um failover pula o resto do lote. Nunca espere ids `serial` sem lacunas.)

Agora reintegre o primário antigo. O diretório de dados dele ainda tem o `lost-write`, na timeline 1, depois da bifurcação — desta vez o `pg_rewind` tem trabalho a fazer:

``` { .bash .copy .select }
docker compose run --rm --no-deps --entrypoint bash pg-primary /scripts/rejoin-as-replica.sh pg-replica1
```

```
pg_rewind: executing "/usr/lib/postgresql/17/bin/postgres" for target server to complete crash recovery
...
pg_rewind: servers diverged at WAL location 0/5038A28 on timeline 1
pg_rewind: rewinding from last common checkpoint at 0/3000130 on timeline 1
...
pg_rewind: Done!
rejoin: pg-primary will follow pg-replica1 on its next start
```

``` { .bash .copy .select }
docker compose start pg-primary
docker compose exec pg-primary psql -U store -c "SELECT pg_is_in_recovery();" -c "SELECT item FROM orders ORDER BY id;"
```

O `pg-primary` agora é uma réplica e concorda com o novo primário: o `lost-write` foi descartado de vez.

!!! question "A replicação síncrona teria salvado o `lost-write`?"

    Sim, mas não de graça. Com `synchronous_standby_names = 'ANY 1 (...)'`, o `INSERT` não teria respondido enquanto as duas réplicas estavam fora do ar — ele teria **bloqueado** (experimento 5 de [Replicação](../replication/index.md#5-synchronous-replication)). O cliente nunca teria sido informado de que o pedido existia. O RPO = 0 é pago com a disponibilidade das escritas: CAP de novo.

## 3. Por que não automatizar com um script?

Tudo o que você fez à mão cabe em um script. A parte difícil é o primeiro passo — decidir que o primário está morto:

- Um primário que não responde ao health check pode estar **lento**, ou **isolado** do monitor, mas não dos clientes. Promover uma réplica nesse caso cria **dois primários** aceitando escritas diferentes: um *split brain*, muito pior do que alguns segundos de downtime.
- O próprio monitor pode falhar, ou dois monitores podem discordar.

É por isso que o failover automático é construído sobre [consenso](../../../classes/distributed_systems/consensus/index.md): no [Patroni](https://patroni.readthedocs.io){target="_blank"}, cada nó roda um agente e só o agente que detém a **leader key** no etcd (Raft) pode rodar como primário. A chave tem um TTL: um primário isolado não consegue renová-la e **rebaixa a si mesmo** antes que uma réplica seja promovida. Os serviços gerenciados (Amazon RDS Multi-AZ, Aurora, Google Cloud SQL) rodam a mesma lógica por você.

## 4. Conectando a plataforma

Os serviços dos hands-on anteriores leem a URL JDBC de `spring.datasource.url`, que a variável de ambiente `SPRING_DATASOURCE_URL` sobrescreve. Para apontar o serviço `account` para o cluster (com os serviços do cluster no mesmo `compose.yaml`), liste os nós e peça o primário:

``` { .yaml .copy .select title="compose.yaml" hl_lines="3" }
  account:
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://pg-primary:5432,pg-replica1:5432,pg-replica2:5432/store?targetServerType=primary
      SPRING_DATASOURCE_USERNAME: store
      SPRING_DATASOURCE_PASSWORD: devpass
```

Depois de um failover, o HikariCP descarta as conexões quebradas e o driver encontra o novo primário. Enviar as **leituras** para as réplicas exige um segundo `DataSource` com `targetServerType=preferSecondary` e um roteador que o escolha para os métodos `@Transactional(readOnly = true)` (o `AbstractRoutingDataSource` do Spring) — um bom exercício, desde que você se lembre das leituras desatualizadas do experimento 3.

## Limpeza

``` { .bash .copy .select }
docker compose down -v
```

O `-v` remove os três volumes; sem ele, o cluster, com os papéis em que terminou, volta no próximo `up`.

## Checklist

- [ ] As duas réplicas aparecem como `streaming` em `pg_stat_replication`.
- [ ] Uma linha inserida no primário é lida nas duas réplicas; um `INSERT` em uma réplica falha.
- [ ] Com a reexecução pausada, uma réplica retorna dados desatualizados e o `bytes_behind` mostra isso.
- [ ] `target_session_attrs=read-write` encontra o primário, antes e depois de um failover.
- [ ] Com `FIRST 1 ("pg-replica1")` e essa réplica parada, um commit bloqueia; com `ANY 1`, não.
- [ ] Depois de um failover por crash, você consegue explicar por que o `lost-write` sumiu e o que o teria evitado.
- [ ] O primário antigo volta ao cluster como réplica com o `pg_rewind`.
