O cluster é um projeto independente: ele não precisa dos microsserviços dos hands-on anteriores. Crie uma pasta nova com estes arquivos:

``` tree
pgcluster/
    compose.yaml
    scripts/
        node-entrypoint.sh
        init-primary.sh
        rejoin-as-replica.sh
```

O `rejoin-as-replica.sh` só é usado em [Failover](../failover/index.md); crie-o agora para que a pasta fique completa.

## Os arquivos

!!! info "Código-fonte"

    === "compose.yaml"

        ``` { .yaml .copy .select linenums="1" title="compose.yaml" }
        --8<-- "docs/2026.2/hands-on/9/code/compose.yaml"
        ```

    === "node-entrypoint.sh"

        ``` { .bash .copy .select linenums="1" title="scripts/node-entrypoint.sh" }
        --8<-- "docs/2026.2/hands-on/9/code/scripts/node-entrypoint.sh"
        ```

    === "init-primary.sh"

        ``` { .bash .copy .select linenums="1" title="scripts/init-primary.sh" }
        --8<-- "docs/2026.2/hands-on/9/code/scripts/init-primary.sh"
        ```

    === "rejoin-as-replica.sh"

        ``` { .bash .copy .select linenums="1" title="scripts/rejoin-as-replica.sh" }
        --8<-- "docs/2026.2/hands-on/9/code/scripts/rejoin-as-replica.sh"
        ```

!!! warning "Fim de linha no Windows"

    Os scripts rodam dentro de containers Linux. Se o seu editor os salvar com fim de linha do Windows (CRLF), o bash falha com `$'\r': command not found`. Salve-os como **LF** (no VS Code: canto inferior direito, `CRLF` → `LF`).

## Como funciona

**`compose.yaml`**

- `x-pg-env` e `x-pg-node` são âncoras YAML: os três nós compartilham a imagem, o ambiente, o entrypoint e o health check (`<<: *pg-node`). Só mudam o nome, a porta e o `PRIMARY_HOST`.
- `cluster_name` dá nome a cada nó. Você vai lê-lo de volta com `SELECT current_setting('cluster_name')` para saber qual servidor respondeu e uma réplica o usa como o seu nome no primário (`application_name` em `pg_stat_replication`) — a replicação síncrona se refere às réplicas por esse nome.
- O health check usa `-h 127.0.0.1` de propósito: enquanto a imagem cria o banco de dados, um servidor temporário escuta apenas em um socket Unix. Verificar por TCP marca o nó como healthy só quando o servidor de verdade está no ar.
- Cada nó tem o seu **próprio volume**: uma réplica é uma cópia completa, não um disco compartilhado.
- As réplicas **não têm `depends_on`**: o `node-entrypoint.sh` já espera pelo primário. Com `depends_on`, `docker compose start pg-replica1` também reiniciaria um primário que você parou de propósito — o que estragaria os experimentos de failover.
- O `client` está no profile `tools`: `docker compose up` não o sobe. `docker compose run --rm client ...` roda o `psql` dentro da rede do cluster, então você não precisa ter o PostgreSQL instalado na sua máquina.

**`node-entrypoint.sh`** decide o papel de um nó quando o seu diretório de dados está vazio:

``` mermaid-sim
flowchart TD
    start(["o container sobe"]) --> data{"diretório de dados\njá inicializado?"}
    data -->|sim| run["inicia o PostgreSQL\n(primário ou standby, como era)"]
    data -->|não| role{"PRIMARY_HOST definido?"}
    role -->|não| init["initdb + init-primary.sh\n→ novo primário"]
    role -->|sim| wait["espera pelo primário"] --> clone["pg_basebackup -X stream -R\n→ cópia do primário"]
    clone --> standby["sobe como hot standby\n(somente leitura, recebendo o WAL)"]
    init --> run
```

O `pg_basebackup` copia o diretório de dados inteiro do primário por uma conexão de replicação. `-X stream` também copia o WAL gravado durante a cópia e `-R` grava `standby.signal` e `primary_conninfo` (de onde fazer o streaming) no novo diretório de dados: quando o PostgreSQL sobe e encontra `standby.signal`, ele sobe como **standby**.

**`init-primary.sh`** roda uma única vez, quando o primário cria o seu banco de dados. Ele cria o role `replicator` (que só pode fazer streaming do WAL), define `wal_keep_size` e `wal_log_hints` com `ALTER SYSTEM` e adiciona uma regra no `pg_hba.conf` para as conexões de replicação. Tudo isso fica guardado no diretório de dados, então o `pg_basebackup` o copia para cada réplica — qualquer uma delas pode ser promovida mais tarde e já tem a mesma configuração.

## Subir o cluster

A partir da pasta `pgcluster/`:

``` { .bash .copy .select }
docker compose up -d --wait
```

O `--wait` só retorna quando todos os nós estão healthy. Depois:

``` { .bash .copy .select }
docker compose ps
```

Você deve ver três nós, todos `healthy`:

```
NAME                      SERVICE       STATUS                    PORTS
pgcluster-pg-primary-1    pg-primary    Up 20 seconds (healthy)   0.0.0.0:5432->5432/tcp
pgcluster-pg-replica1-1   pg-replica1   Up 20 seconds (healthy)   0.0.0.0:5433->5432/tcp
pgcluster-pg-replica2-1   pg-replica2   Up 20 seconds (healthy)   0.0.0.0:5434->5432/tcp
```

Veja como uma réplica nasceu:

``` { .bash .copy .select }
docker compose logs pg-replica1
```

```
node: empty data directory, cloning pg-primary
...
LOG:  entering standby mode
LOG:  consistent recovery state reached at 0/30001D0
LOG:  database system is ready to accept read-only connections
LOG:  started streaming WAL from primary at 0/4000000 on timeline 1
```

## Verificar a replicação

No primário, `pg_stat_replication` tem uma linha por réplica conectada:

``` { .bash .copy .select }
docker compose exec pg-primary psql -U store -c "SELECT application_name, client_addr, state, sync_state FROM pg_stat_replication;"
```

```
 application_name | client_addr | state     | sync_state
------------------+-------------+-----------+------------
 pg-replica1      | 172.18.0.3  | streaming | async
 pg-replica2      | 172.18.0.4  | streaming | async
```

Em uma réplica, `pg_is_in_recovery()` é `true` (um standby está permanentemente "em recuperação": reexecutando o WAL) e `pg_stat_wal_receiver` mostra de onde ela recebe o stream:

``` { .bash .copy .select }
docker compose exec pg-replica1 psql -U store -c "SELECT pg_is_in_recovery();" -c "SELECT status, sender_host FROM pg_stat_wal_receiver;"
```

```
 pg_is_in_recovery
-------------------
 t

  status   | sender_host
-----------+-------------
 streaming | pg-primary
```

!!! tip "Conectando a partir da sua máquina"

    Cada nó é publicado na sua própria porta: `5432` (primário), `5433` e `5434` (réplicas), usuário `store`, senha `devpass`, banco `store`. Você pode abrir os três lado a lado no DBeaver, no pgAdmin ou na visão de banco de dados da sua IDE.

## Solução de problemas

| Sintoma | Causa e correção |
|---|---|
| `$'\r': command not found` nos logs | os scripts têm fim de linha CRLF: salve-os como LF e rode `docker compose down -v && docker compose up -d --wait` |
| uma réplica reinicia em loop com `no pg_hba.conf entry for replication connection` | o primário foi criado antes de o `init-primary.sh` existir: `docker compose down -v` e suba de novo |
| `port is already allocated` na 5432 | o `db` de um hands-on anterior está rodando: pare-o (`docker compose down` naquela pasta) ou mude as portas publicadas |
| uma réplica fica em `waiting for pg-primary...` | o primário não está no ar: `docker compose logs pg-primary` |

!!! info "Recomeçando do zero"

    Os volumes guardam o estado do cluster, incluindo qualquer failover que você tenha feito. Para voltar ao estado inicial (um primário, duas réplicas), remova-os:

    ``` { .bash .copy .select }
    docker compose down -v
    docker compose up -d --wait
    ```
