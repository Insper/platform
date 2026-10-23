#!/usr/bin/env bash
# Lab 6: put every seat back on sale and forget all holds (run before each flash-sale test).
set -euo pipefail
docker compose exec -T db psql -q -U "${DB_USER:-boxoffice}" -d "${DB_NAME:-boxoffice}" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DELETE FROM inventory.hold_seats;
DELETE FROM inventory.holds;
UPDATE inventory.seats SET status = 'AVAILABLE', hold_id = NULL, version = 0
WHERE status <> 'AVAILABLE' OR hold_id IS NOT NULL;
COMMIT;
SQL
echo "inventory reset: all seats AVAILABLE"
