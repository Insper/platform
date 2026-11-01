The cluster is a standalone project: it does not need the microservices of the previous hands-on. Create a new folder with these files:

``` tree
pgcluster/
    compose.yaml
    scripts/
        node-entrypoint.sh
        init-primary.sh
        rejoin-as-replica.sh
```

`rejoin-as-replica.sh` is used only in [Failover](../failover/index.md); create it now so the folder is complete.

## The files

!!! info "Source"

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

!!! warning "Line endings on Windows"

    The scripts run inside Linux containers. If your editor saves them with Windows line endings (CRLF), bash fails with `$'\r': command not found`. Save them as **LF** (VS Code: bottom-right corner, `CRLF` → `LF`).

## How it works

**`compose.yaml`**

- `x-pg-env` and `x-pg-node` are YAML anchors: the three nodes share the image, the environment, the entrypoint and the health check (`<<: *pg-node`). Only the name, the port and `PRIMARY_HOST` change.
- `cluster_name` names each node. You will read it back with `SELECT current_setting('cluster_name')` to know which server answered, and a replica uses it as its name on the primary (`application_name` in `pg_stat_replication`) — synchronous replication refers to replicas by that name.
- The health check uses `-h 127.0.0.1` on purpose: while the image creates the database, a temporary server listens only on a Unix socket. Checking over TCP marks the node healthy only when the real server is up.
- Each node has its **own volume**: a replica is a full copy, not a shared disk.
- The replicas have **no `depends_on`**: `node-entrypoint.sh` already waits for the primary. With `depends_on`, `docker compose start pg-replica1` would also restart a primary you stopped on purpose — which would ruin the failover experiments.
- `client` is in the `tools` profile: `docker compose up` does not start it. `docker compose run --rm client ...` runs `psql` inside the cluster network, so you do not need PostgreSQL installed on your machine.

**`node-entrypoint.sh`** decides the role of a node when its data directory is empty:

``` mermaid-sim
flowchart TD
    start(["container starts"]) --> data{"data directory\nalready initialised?"}
    data -->|yes| run["start PostgreSQL\n(primary or standby, as it was)"]
    data -->|no| role{"PRIMARY_HOST set?"}
    role -->|no| init["initdb + init-primary.sh\n→ new primary"]
    role -->|yes| wait["wait for the primary"] --> clone["pg_basebackup -X stream -R\n→ copy of the primary"]
    clone --> standby["start as hot standby\n(read-only, streaming WAL)"]
    init --> run
```

`pg_basebackup` copies the whole data directory of the primary over a replication connection. `-X stream` also copies the WAL written during the copy, and `-R` writes `standby.signal` and `primary_conninfo` (where to stream from) into the new data directory: when PostgreSQL starts and finds `standby.signal`, it starts as a **standby**.

**`init-primary.sh`** runs once, when the primary creates its database. It creates the `replicator` role (allowed only to stream WAL), sets `wal_keep_size` and `wal_log_hints` with `ALTER SYSTEM`, and adds a `pg_hba.conf` rule for replication connections. All of this is stored in the data directory, so `pg_basebackup` copies it to every replica — any of them can be promoted later and already has the same configuration.

## Start the cluster

From the `pgcluster/` folder:

``` { .bash .copy .select }
docker compose up -d --wait
```

`--wait` returns only when every node is healthy. Then:

``` { .bash .copy .select }
docker compose ps
```

You should see three nodes, all `healthy`:

```
NAME                      SERVICE       STATUS                    PORTS
pgcluster-pg-primary-1    pg-primary    Up 20 seconds (healthy)   0.0.0.0:5432->5432/tcp
pgcluster-pg-replica1-1   pg-replica1   Up 20 seconds (healthy)   0.0.0.0:5433->5432/tcp
pgcluster-pg-replica2-1   pg-replica2   Up 20 seconds (healthy)   0.0.0.0:5434->5432/tcp
```

Look at how a replica was born:

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

## Check the replication

On the primary, `pg_stat_replication` has one row per connected replica:

``` { .bash .copy .select }
docker compose exec pg-primary psql -U store -c "SELECT application_name, client_addr, state, sync_state FROM pg_stat_replication;"
```

```
 application_name | client_addr | state     | sync_state
------------------+-------------+-----------+------------
 pg-replica1      | 172.18.0.3  | streaming | async
 pg-replica2      | 172.18.0.4  | streaming | async
```

On a replica, `pg_is_in_recovery()` is `true` (a standby is permanently "recovering": replaying WAL) and `pg_stat_wal_receiver` shows where it streams from:

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

!!! tip "Connecting from your machine"

    Each node is published on its own port: `5432` (primary), `5433` and `5434` (replicas), user `store`, password `devpass`, database `store`. You can open the three side by side in DBeaver, pgAdmin or the database view of your IDE.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `$'\r': command not found` in the logs | the scripts have CRLF line endings: save them as LF and run `docker compose down -v && docker compose up -d --wait` |
| a replica restarts in a loop with `no pg_hba.conf entry for replication connection` | the primary was created before `init-primary.sh` existed: `docker compose down -v` and start again |
| `port is already allocated` on 5432 | the `db` of a previous hands-on is running: stop it (`docker compose down` in that folder) or change the published ports |
| a replica keeps `waiting for pg-primary...` | the primary is not up: `docker compose logs pg-primary` |

!!! info "Starting over"

    The volumes keep the cluster state, including any failover you did. To return to the initial state (one primary, two replicas), remove them:

    ``` { .bash .copy .select }
    docker compose down -v
    docker compose up -d --wait
    ```
