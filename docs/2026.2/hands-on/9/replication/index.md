Run every command from the `pgcluster/` folder, with the cluster up (`docker compose up -d --wait`). Each experiment shows one property of the cluster; read the output before moving on.

## 1. Write on the primary, read on the replicas

Create a table and insert two rows **on the primary**:

``` { .bash .copy .select }
docker compose exec pg-primary psql -U store -c "CREATE TABLE orders (id serial PRIMARY KEY, item text NOT NULL, created_at timestamptz DEFAULT now());" -c "INSERT INTO orders (item) VALUES ('keyboard'), ('mouse');"
```

Read them **on a replica**:

``` { .bash .copy .select }
docker compose exec pg-replica1 psql -U store -c "SELECT * FROM orders;"
```

```
 id |   item   |          created_at
----+----------+-------------------------------
  1 | keyboard | 2026-10-31 18:46:45.59094+00
  2 | mouse    | 2026-10-31 18:46:45.59094+00
```

Nobody created the table on the replica: the `CREATE TABLE` and the `INSERT` reached it through the WAL. Try `pg-replica2` too.

## 2. Replicas are read-only

``` { .bash .copy .select }
docker compose exec pg-replica1 psql -U store -c "INSERT INTO orders (item) VALUES ('monitor');"
```

```
ERROR:  cannot execute INSERT in a read-only transaction
```

A physical replica is an exact copy of the primary's pages: a local write would make it diverge. Every write must go to the **primary** — the reason replication scales reads, but not writes.

## 3. Replication lag and stale reads

Replication is asynchronous: a replica is always a little behind. Normally it is milliseconds, too fast to see, so make it visible by **pausing the replay** on `pg-replica1` (it keeps receiving WAL, but stops applying it):

``` { .bash .copy .select }
docker compose exec pg-replica1 psql -U store -c "SELECT pg_wal_replay_pause();"
```

Insert a row on the primary:

``` { .bash .copy .select }
docker compose exec pg-primary psql -U store -c "INSERT INTO orders (item) VALUES ('monitor');"
```

Count the rows on each replica:

``` { .bash .copy .select }
docker compose exec pg-replica1 psql -U store -c "SELECT count(*) FROM orders;"
docker compose exec pg-replica2 psql -U store -c "SELECT count(*) FROM orders;"
```

`pg-replica1` answers **2**, `pg-replica2` answers **3**. The primary sees how far behind each replica is, in bytes of WAL:

``` { .bash .copy .select }
docker compose exec pg-primary psql -U store -c "SELECT application_name, pg_wal_lsn_diff(sent_lsn, replay_lsn) AS bytes_behind FROM pg_stat_replication;"
```

```
 application_name | bytes_behind
------------------+--------------
 pg-replica1      |          184
 pg-replica2      |            0
```

Resume the replay — the row appears:

``` { .bash .copy .select }
docker compose exec pg-replica1 psql -U store -c "SELECT pg_wal_replay_resume();" -c "SELECT count(*) FROM orders;"
```

!!! danger "Read-your-writes"

    This is what a user sees when the application writes on the primary and then reads from a lagging replica: "I created the order, but it is not in my list". Replication lag grows under heavy load, long queries on the replica or a slow network. Common fixes: read from the primary right after a write (for that user, for a few seconds), or use synchronous replication with `remote_apply` (experiment 5) for the queries that cannot be stale.

## 4. Routing by role in the connection string

Who decides whether a query goes to the primary or to a replica? Here, the **client driver**. libpq (the C library behind `psql`, Python's `psycopg`, Node's `pg`...) accepts several hosts and a required role:

``` { .bash .copy .select }
docker compose run --rm client "host=pg-primary,pg-replica1,pg-replica2 target_session_attrs=read-write" -c "SELECT current_setting('cluster_name');"
```

```
 current_setting
-----------------
 pg-primary
```

The driver tries the hosts in order and keeps the first one that accepts writes. For reads, ask for a standby and spread the connections at random:

``` { .bash .copy .select }
for i in 1 2 3 4 5 6; do
  docker compose run --rm client "host=pg-primary,pg-replica1,pg-replica2 target_session_attrs=standby load_balance_hosts=random" -Atc "SELECT current_setting('cluster_name');"
done
```

You should see `pg-replica1` and `pg-replica2` mixed, never `pg-primary`.

| `target_session_attrs` | Picks |
|---|---|
| `read-write` / `primary` | the primary |
| `standby` | a replica (fails if there is none) |
| `prefer-standby` | a replica; the primary if no replica is up |
| `any` (default) | the first host that answers |

The PostgreSQL **JDBC** driver used by Spring Boot has the same feature, with other names:

``` { .text .copy .select }
jdbc:postgresql://pg-primary:5432,pg-replica1:5432,pg-replica2:5432/store?targetServerType=primary
jdbc:postgresql://pg-primary:5432,pg-replica1:5432,pg-replica2:5432/store?targetServerType=preferSecondary&loadBalanceHosts=true
```

In [Failover](../failover/index.md) you will see the real benefit: after a promotion, the same connection string finds the **new** primary without any change.

## 5. Synchronous replication

Make `pg-replica1` synchronous: a commit on the primary returns only after `pg-replica1` has the WAL on disk.

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

Now stop the synchronous replica and try to write:

``` { .bash .copy .select }
docker compose stop pg-replica1
docker compose exec pg-primary psql -U store -c "INSERT INTO orders (item) VALUES ('headset');"
```

The command **hangs**: the primary waits for a confirmation that will not come. Press **Ctrl+C**:

```
WARNING:  canceling wait for synchronous replication due to user request
DETAIL:  The transaction has already committed locally, but might not have been replicated to the standby.
INSERT 0 1
```

Read the `DETAIL` carefully: the row **is** committed on the primary; what was cancelled is only the wait. Synchronous replication does not make the commit atomic across servers — it delays the answer until the copy exists. (`statement_timeout` does not help here: it does not cover the wait at commit.) In another terminal, while a command hangs, you can see it waiting:

``` { .bash .copy .select }
docker compose exec pg-primary psql -U store -c "SELECT pid, wait_event, query FROM pg_stat_activity WHERE wait_event = 'SyncRep';"
```

Waiting for one specific replica makes it a single point of failure for writes. A **quorum** is more robust: wait for **any one** of the two replicas.

``` { .bash .copy .select }
docker compose exec pg-primary psql -U store -c "ALTER SYSTEM SET synchronous_standby_names = 'ANY 1 (\"pg-replica1\", \"pg-replica2\")';" -c "SELECT pg_reload_conf();"
docker compose exec pg-primary psql -U store -c "INSERT INTO orders (item) VALUES ('webcam');"
```

The insert returns at once: `pg-replica2` confirmed it. Bring `pg-replica1` back and look at the states:

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

How much the primary waits for is set by `synchronous_commit`:

| `synchronous_commit` | Commit returns when the synchronous replica has... | Guarantees |
|---|---|---|
| `remote_write` | received the WAL (in memory) | survives a primary crash |
| `on` (default) | written the WAL to disk | survives a crash of both |
| `remote_apply` | **replayed** the WAL | a read on that replica sees the commit (no stale read) |

Return to asynchronous replication before the next page:

``` { .bash .copy .select }
docker compose exec pg-primary psql -U store -c "ALTER SYSTEM RESET synchronous_standby_names;" -c "SELECT pg_reload_conf();"
```

## 6. Under load (optional)

`pgbench`, which comes with PostgreSQL, generates a banking-style workload. Create its tables (≈ 160 MB) and run 8 clients for 30 seconds on the primary:

``` { .bash .copy .select }
docker compose run --rm --entrypoint pgbench client -h pg-primary -i -s 10
docker compose run --rm --entrypoint pgbench client -h pg-primary -c 8 -T 30 -P 5
```

While it runs, watch the lag in another terminal (repeat the command a few times):

``` { .bash .copy .select }
docker compose exec pg-primary psql -U store -c "SELECT application_name, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)) AS behind, replay_lag FROM pg_stat_replication;"
```

Then run a **read-only** benchmark (`-S`) against the two replicas only, each connection to a random one — reads scale with the number of replicas. `-n` skips the `VACUUM` that pgbench runs first, which a replica refuses:

``` { .bash .copy .select }
docker compose run --rm --entrypoint pgbench client -S -n -c 8 -T 15 "host=pg-replica1,pg-replica2 load_balance_hosts=random"
```

Repeat the exercise with synchronous replication on (`ANY 1`) and compare the `tps` of the write benchmark: that difference is the price of RPO = 0.
