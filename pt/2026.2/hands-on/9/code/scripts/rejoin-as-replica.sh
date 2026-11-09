#!/bin/bash
# Turns a stopped old primary into a replica of the new primary.
# Usage (from the folder of compose.yaml, with the node stopped):
#   docker compose run --rm --no-deps --entrypoint bash pg-primary \
#     /scripts/rejoin-as-replica.sh pg-replica1
set -euo pipefail

NEW_PRIMARY=${1:?usage: rejoin-as-replica.sh <new-primary-host>}
PGDATA=${PGDATA:-/var/lib/postgresql/data}

# pg_rewind copies back only the blocks that changed since the timelines split,
# discarding the writes the old primary made that never reached the new one.
gosu postgres pg_rewind --target-pgdata="$PGDATA" --progress \
  --source-server="host=$NEW_PRIMARY user=$POSTGRES_USER password=$POSTGRES_PASSWORD dbname=$POSTGRES_DB"

# Same as pg_basebackup -R: start as a standby, streaming from the new primary.
gosu postgres touch "$PGDATA/standby.signal"
echo "primary_conninfo = 'host=$NEW_PRIMARY user=$REPLICATION_USER password=$REPLICATION_PASSWORD'" \
  | gosu postgres tee -a "$PGDATA/postgresql.auto.conf" > /dev/null
echo "rejoin: $(hostname) will follow $NEW_PRIMARY on its next start"
