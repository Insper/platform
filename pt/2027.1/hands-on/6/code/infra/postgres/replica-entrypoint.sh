#!/bin/bash
# Starts a streaming replica of "db". The first time, it clones the primary with
# pg_basebackup; -R writes standby.signal + primary_conninfo, so PostgreSQL starts
# as a read-only hot standby that keeps applying the primary's WAL.
set -e
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "cloning the primary..."
  until pg_basebackup -h db -U replicator -D "$PGDATA" -R -X stream -c fast -P; do
    echo "primary not ready yet, retrying in 2 s"; sleep 2
  done
  chmod 0700 "$PGDATA"
fi
# REPLICA_DELAY (e.g. 2s) makes the replica apply changes late: replication lag on demand;
# cluster_name is the name the primary sees (synchronous_standby_names, step 4)
exec postgres -c hot_standby=on -c recovery_min_apply_delay="${REPLICA_DELAY:-0}" -c cluster_name=db-replica
