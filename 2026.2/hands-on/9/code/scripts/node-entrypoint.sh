#!/bin/bash
# Entrypoint of every node of the cluster.
#   PRIMARY_HOST unset -> primary: the official entrypoint creates the database
#                         and runs /docker-entrypoint-initdb.d (none here: see below).
#   PRIMARY_HOST set   -> replica: on the first start, clones the primary with
#                         pg_basebackup and starts as a hot standby.
set -euo pipefail

PGDATA=${PGDATA:-/var/lib/postgresql/data}

if [ -s "$PGDATA/PG_VERSION" ]; then
  echo "node: data directory already initialised, starting PostgreSQL"

elif [ -z "${PRIMARY_HOST:-}" ]; then
  echo "node: empty data directory, initialising a new primary"
  # Runs once, right after initdb: the replication role and its pg_hba rule.
  cp /scripts/init-primary.sh /docker-entrypoint-initdb.d/10-init-primary.sh

else
  echo "node: empty data directory, cloning $PRIMARY_HOST"
  until pg_isready -h "$PRIMARY_HOST" -U "$POSTGRES_USER" -q; do
    echo "node: waiting for $PRIMARY_HOST..."
    sleep 1
  done
  mkdir -p "$PGDATA"
  chown postgres:postgres "$PGDATA"
  chmod 700 "$PGDATA"
  # -X stream: also copy the WAL written during the backup
  # -R: write standby.signal + primary_conninfo, so the node starts as a standby
  PGPASSWORD="$REPLICATION_PASSWORD" gosu postgres \
    pg_basebackup -h "$PRIMARY_HOST" -U "$REPLICATION_USER" \
                  -D "$PGDATA" -X stream -R --progress
fi

exec docker-entrypoint.sh "$@"
