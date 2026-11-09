#!/bin/bash
# Runs once, when the primary's data directory is created (docker-entrypoint-initdb.d).
# Creates the user the replica connects with and allows replication connections.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
    CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD '${REPLICATION_PASSWORD:-replicator}';
    -- pg_rewind (step 4) needs it; ALTER SYSTEM keeps it in the data directory, where pg_rewind looks
    ALTER SYSTEM SET wal_log_hints = on;
SQL
echo "host replication replicator all scram-sha-256" >> "$PGDATA/pg_hba.conf"
