#!/bin/bash
# Turns the old primary, stopped after a failover, into a replica of the new primary.
# Usage (repository root, with db stopped):
#   docker compose run --rm --no-deps -v ./infra/postgres:/scripts:ro --entrypoint bash db \
#     /scripts/rejoin-as-replica.sh db-replica
set -euo pipefail

NEW_PRIMARY=${1:?usage: rejoin-as-replica.sh <new-primary-host>}
PGDATA=${PGDATA:-/var/lib/postgresql/data}
[ "$(id -u)" = 0 ] && exec gosu postgres bash "$0" "$@"     # the data files belong to postgres

# pg_rewind copies back only the blocks that changed since the timelines split,
# discarding the writes the old primary made that never reached the new one.
pg_rewind --target-pgdata="$PGDATA" --progress \
  --source-server="host=$NEW_PRIMARY user=$POSTGRES_USER password=$POSTGRES_PASSWORD dbname=$POSTGRES_DB"

# Same as pg_basebackup -R: start as a standby, streaming from the new primary.
touch "$PGDATA/standby.signal"
echo "primary_conninfo = 'host=$NEW_PRIMARY user=replicator password=${REPLICATION_PASSWORD:-replicator}'" \
  >> "$PGDATA/postgresql.auto.conf"
echo "rejoin: db will follow $NEW_PRIMARY on its next start"
