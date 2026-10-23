#!/bin/bash
# Starts a streaming replica of "db". The first time, it clones the primary with
# pg_basebackup; -R writes standby.signal + primary_conninfo, so PostgreSQL starts
# as a read-only hot standby that keeps applying the primary's WAL.
set -e
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "cloning the primary..."
  until pg_basebackup -h db -U replicator -D "$PGDATA" -R -X stream -P; do
    echo "primary not ready yet, retrying in 2 s"; sleep 2
  done
  chmod 0700 "$PGDATA"
fi
# REPLICA_DELAY (e.g. 2s) makes the replica apply changes late: replication lag on demand
exec postgres -c hot_standby=on -c recovery_min_apply_delay="${REPLICA_DELAY:-0}"
