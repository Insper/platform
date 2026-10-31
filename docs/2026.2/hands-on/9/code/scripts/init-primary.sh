#!/bin/bash
# Runs once, when the primary creates its database (docker-entrypoint-initdb.d).
# Everything here lives in the data directory, so pg_basebackup copies it to every replica.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
-- A role that may only stream WAL: replicas connect with it, never the application.
CREATE ROLE $REPLICATION_USER WITH REPLICATION LOGIN PASSWORD '$REPLICATION_PASSWORD';
-- WAL kept on disk for a replica that falls behind (or is stopped for a while).
ALTER SYSTEM SET wal_keep_size = '256MB';
-- Lets pg_rewind turn an old primary into a replica after a failover.
ALTER SYSTEM SET wal_log_hints = on;
SQL

# "all" in pg_hba.conf does not match replication connections: they need their own rule.
echo "host replication $REPLICATION_USER all scram-sha-256" >> "$PGDATA/pg_hba.conf"
