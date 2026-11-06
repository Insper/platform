Rode todos os comandos a partir da pasta `pgcluster/`, com o cluster no ar (`docker compose up -d --wait`). Cada experimento mostra uma propriedade do cluster; leia a saída antes de seguir em frente.

<div class="csim" data-sim="pg-cluster" data-script="replication"></div>

!!! tip "Experimente"

    Sem Docker à mão ou quer ver o estado entre dois comandos? O simulador roda esta página. O simulador começa onde o lab começa: `orders` com keyboard e mouse, as duas réplicas recebendo o WAL; play ou → roda os comandos da página e os botões funcionam a qualquer momento. Em **Replicação 1–4**, com o replay pausado, pg-replica1 mostra 2 linhas e pg-replica2 3, 184 bytes atrás. Em **Replicação 5 (sync)**, com `FIRST 1 ("pg-replica1")` e essa réplica parada, o `INSERT` de headset trava; com `ANY 1`, webcam retorna na hora. Em **Escrita perdida**, after-failover recebe o id 34 e o `pg_rewind` descarta lost-write. No modo **livre**, tente o que o lab não faz: inicie o primário antigo sem `pg_rewind` e veja aparecerem dois primários.

## 1. Escrever no primário, ler nas réplicas

Crie uma tabela e insira duas linhas **no primário**:

``` { .bash .copy .select }
docker compose exec pg-primary psql -U store -c "CREATE TABLE orders (id serial PRIMARY KEY, item text NOT NULL, created_at timestamptz DEFAULT now());" -c "INSERT INTO orders (item) VALUES ('keyboard'), ('mouse');"
```

Leia-as **em uma réplica**:

``` { .bash .copy .select }
docker compose exec pg-replica1 psql -U store -c "SELECT * FROM orders;"
```

```
 id |   item   |          created_at
----+----------+-------------------------------
  1 | keyboard | 2026-10-31 18:46:45.59094+00
  2 | mouse    | 2026-10-31 18:46:45.59094+00
```

Ninguém criou a tabela na réplica: o `CREATE TABLE` e o `INSERT` chegaram até ela pelo WAL. Experimente também a `pg-replica2`.

## 2. Réplicas são somente leitura

``` { .bash .copy .select }
docker compose exec pg-replica1 psql -U store -c "INSERT INTO orders (item) VALUES ('monitor');"
```

```
ERROR:  cannot execute INSERT in a read-only transaction
```

Uma réplica física é uma cópia exata das páginas do primário: uma escrita local a faria divergir. Toda escrita precisa ir para o **primário** — é por isso que a replicação escala as leituras, mas não as escritas.

## 3. Atraso de replicação (lag) e leituras desatualizadas

A replicação é assíncrona: uma réplica está sempre um pouco atrás. Normalmente são milissegundos, rápido demais para ver; então torne o lag visível **pausando a reexecução** na `pg-replica1` (ela continua recebendo o WAL, mas para de aplicá-lo):

``` { .bash .copy .select }
docker compose exec pg-replica1 psql -U store -c "SELECT pg_wal_replay_pause();"
```

Insira uma linha no primário:

``` { .bash .copy .select }
docker compose exec pg-primary psql -U store -c "INSERT INTO orders (item) VALUES ('monitor');"
```

Conte as linhas em cada réplica:

``` { .bash .copy .select }
docker compose exec pg-replica1 psql -U store -c "SELECT count(*) FROM orders;"
docker compose exec pg-replica2 psql -U store -c "SELECT count(*) FROM orders;"
```

A `pg-replica1` responde **2**, a `pg-replica2` responde **3**. O primário vê o quanto cada réplica está atrasada, em bytes de WAL:

``` { .bash .copy .select }
docker compose exec pg-primary psql -U store -c "SELECT application_name, pg_wal_lsn_diff(sent_lsn, replay_lsn) AS bytes_behind FROM pg_stat_replication;"
```

```
 application_name | bytes_behind
------------------+--------------
 pg-replica1      |          184
 pg-replica2      |            0
```

Retome a reexecução — a linha aparece:

``` { .bash .copy .select }
docker compose exec pg-replica1 psql -U store -c "SELECT pg_wal_replay_resume();" -c "SELECT count(*) FROM orders;"
```

``` mermaid-sim
sequenceDiagram
    participant U as Usuário
    participant App as Serviço
    participant P as pg-primary
    participant R as pg-replica1 (atrasada)
    U->>App: cria um pedido
    App->>P: INSERT
    P-->>App: COMMIT ok
    U->>App: lista meus pedidos
    App->>R: SELECT
    R-->>App: linhas sem o pedido novo
    App-->>U: cadê meu pedido?
    P->>R: o WAL chega (tarde demais)
```

!!! danger "Read-your-writes"

    É isso que um usuário vê quando a aplicação escreve no primário e depois lê de uma réplica atrasada: "eu criei o pedido, mas ele não está na minha lista". O lag de replicação cresce com carga pesada, consultas longas na réplica ou uma rede lenta. Correções comuns: ler do primário logo depois de uma escrita (para aquele usuário, por alguns segundos) ou usar replicação síncrona com `remote_apply` (experimento 5) nas consultas que não podem ver dados desatualizados.

## 4. Roteamento por papel na connection string

Quem decide se uma consulta vai para o primário ou para uma réplica? Aqui, o **driver do cliente**. A libpq (a biblioteca C por trás do `psql`, do `psycopg` do Python, do `pg` do Node...) aceita vários hosts e um papel exigido:

``` { .bash .copy .select }
docker compose run --rm client "host=pg-primary,pg-replica1,pg-replica2 target_session_attrs=read-write" -c "SELECT current_setting('cluster_name');"
```

```
 current_setting
-----------------
 pg-primary
```

``` mermaid-sim
flowchart LR
    d["driver\ntarget_session_attrs=read-write"]
    h1["pg-primary\naceita escritas?"]
    h2["pg-replica1\naceita escritas?"]
    h3["pg-replica2\naceita escritas?"]
    ok["fica com esta conexão"]
    no["erro: nenhum servidor\ncom o papel pedido"]
    d --> h1
    h1 -->|sim| ok
    h1 -->|"não ou fora do ar"| h2
    h2 -->|sim| ok
    h2 -->|"não ou fora do ar"| h3
    h3 -->|sim| ok
    h3 -->|"não ou fora do ar"| no
```

O driver tenta os hosts em ordem e fica com o primeiro que aceita escritas. Para leituras, peça um standby e distribua as conexões aleatoriamente:

``` { .bash .copy .select }
for i in 1 2 3 4 5 6; do
  docker compose run --rm client "host=pg-primary,pg-replica1,pg-replica2 target_session_attrs=standby load_balance_hosts=random" -Atc "SELECT current_setting('cluster_name');"
done
```

Você deve ver `pg-replica1` e `pg-replica2` misturados, nunca `pg-primary`.

| `target_session_attrs` | Escolhe |
|---|---|
| `read-write` / `primary` | o primário |
| `standby` | uma réplica (falha se não houver nenhuma) |
| `prefer-standby` | uma réplica; o primário se nenhuma réplica estiver no ar |
| `any` (padrão) | o primeiro host que responder |

O driver **JDBC** do PostgreSQL, usado pelo Spring Boot, tem o mesmo recurso, com outros nomes:

``` { .text .copy .select }
jdbc:postgresql://pg-primary:5432,pg-replica1:5432,pg-replica2:5432/store?targetServerType=primary
jdbc:postgresql://pg-primary:5432,pg-replica1:5432,pg-replica2:5432/store?targetServerType=preferSecondary&loadBalanceHosts=true
```

Em [Failover](../failover/index.md), você vai ver o benefício real: depois de uma promoção, a mesma connection string encontra o **novo** primário sem nenhuma alteração.

## 5. Replicação síncrona { #5-synchronous-replication }

Torne a `pg-replica1` síncrona: um commit no primário só retorna depois que a `pg-replica1` tem o WAL em disco.

``` { .bash .copy .select }
docker compose exec pg-primary psql -U store -c "ALTER SYSTEM SET synchronous_standby_names = 'FIRST 1 (\"pg-replica1\")';" -c "SELECT pg_reload_conf();"
docker compose exec pg-primary psql -U store -c "SELECT application_name, sync_state FROM pg_stat_replication;"
```

```
 application_name | sync_state
------------------+------------
 pg-replica1      | sync
 pg-replica2      | async
```

Agora pare a réplica síncrona e tente escrever:

``` { .bash .copy .select }
docker compose stop pg-replica1
docker compose exec pg-primary psql -U store -c "INSERT INTO orders (item) VALUES ('headset');"
```

O comando **trava**: o primário espera uma confirmação que não vai chegar. Pressione **Ctrl+C**:

```
WARNING:  canceling wait for synchronous replication due to user request
DETAIL:  The transaction has already committed locally, but might not have been replicated to the standby.
INSERT 0 1
```

Leia o `DETAIL` com atenção: a linha **está** confirmada no primário; o que foi cancelado é apenas a espera. A replicação síncrona não torna o commit atômico entre servidores — ela adia a resposta até a cópia existir. (O `statement_timeout` não ajuda aqui: ele não cobre a espera no commit.) Em outro terminal, enquanto um comando está travado, você pode vê-lo esperando:

``` { .bash .copy .select }
docker compose exec pg-primary psql -U store -c "SELECT pid, wait_event, query FROM pg_stat_activity WHERE wait_event = 'SyncRep';"
```

Esperar por uma réplica específica a torna um ponto único de falha para as escritas. Um **quórum** é mais robusto: esperar por **qualquer uma** das duas réplicas.

``` { .bash .copy .select }
docker compose exec pg-primary psql -U store -c "ALTER SYSTEM SET synchronous_standby_names = 'ANY 1 (\"pg-replica1\", \"pg-replica2\")';" -c "SELECT pg_reload_conf();"
docker compose exec pg-primary psql -U store -c "INSERT INTO orders (item) VALUES ('webcam');"
```

O insert retorna na hora: a `pg-replica2` o confirmou. Traga a `pg-replica1` de volta e veja os estados:

``` { .bash .copy .select }
docker compose start pg-replica1
docker compose exec pg-primary psql -U store -c "SELECT application_name, sync_state FROM pg_stat_replication;"
```

```
 application_name | sync_state
------------------+------------
 pg-replica2      | quorum
 pg-replica1      | quorum
```

Quanto o primário espera é definido por `synchronous_commit`:

| `synchronous_commit` | O commit retorna quando a réplica síncrona... | Garante |
|---|---|---|
| `remote_write` | recebeu o WAL (em memória) | sobrevive a um crash do primário |
| `on` (padrão) | gravou o WAL em disco | sobrevive a um crash dos dois |
| `remote_apply` | **reexecutou** o WAL | uma leitura naquela réplica vê o commit (sem leitura desatualizada) |

``` mermaid-sim
sequenceDiagram
    participant App as Serviço
    participant P as pg-primary
    participant R as Réplica síncrona
    App->>P: COMMIT
    P->>R: registro de WAL
    R-->>P: recebido em memória: remote_write retorna aqui
    R->>R: grava o WAL em disco
    R-->>P: em disco: on (o padrão) retorna aqui
    R->>R: reexecuta o WAL
    R-->>P: reexecutado: remote_apply retorna aqui
    P-->>App: COMMIT ok
```

Volte à replicação assíncrona antes da próxima página:

``` { .bash .copy .select }
docker compose exec pg-primary psql -U store -c "ALTER SYSTEM RESET synchronous_standby_names;" -c "SELECT pg_reload_conf();"
```

## 6. Sob carga (opcional)

O `pgbench`, que vem com o PostgreSQL, gera uma carga no estilo bancário. Crie as tabelas dele (≈ 160 MB) e rode 8 clientes por 30 segundos no primário:

``` { .bash .copy .select }
docker compose run --rm --entrypoint pgbench client -h pg-primary -i -s 10
docker compose run --rm --entrypoint pgbench client -h pg-primary -c 8 -T 30 -P 5
```

Enquanto ele roda, acompanhe o lag em outro terminal (repita o comando algumas vezes):

``` { .bash .copy .select }
docker compose exec pg-primary psql -U store -c "SELECT application_name, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)) AS behind, replay_lag FROM pg_stat_replication;"
```

Depois, rode um benchmark **somente leitura** (`-S`) apenas contra as duas réplicas, cada conexão para uma delas, escolhida ao acaso — as leituras escalam com o número de réplicas. O `-n` pula o `VACUUM` que o pgbench roda primeiro e que uma réplica recusa:

``` { .bash .copy .select }
docker compose run --rm --entrypoint pgbench client -S -n -c 8 -T 15 "host=pg-replica1,pg-replica2 load_balance_hosts=random"
```

Repita o exercício com a replicação síncrona ligada (`ANY 1`) e compare o `tps` do benchmark de escrita: essa diferença é o preço do RPO = 0.
