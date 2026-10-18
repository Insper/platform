#!/usr/bin/env bash
# Lab 2: run load.js once per arrival rate and save one k6 summary per run.
#   bash scripts/sweep.sh 25 50 100 150 200 300 400
# Then:  uv run scripts/summarize.py results/lab2/rate-*.json
set -euo pipefail
OUT=${OUT:-results/lab2}
DURATION=${DURATION:-1m}
mkdir -p "$OUT"
echo ">>> warm-up: 30 s at RATE=$1 (not recorded)"
k6 run -q -e RATE="$1" -e DURATION=30s load/load.js > /dev/null || true
for rate in "$@"; do
  echo ">>> RATE=$rate req/s for $DURATION"
  # || true: a run that crosses a threshold still produces a summary; keep sweeping
  k6 run -q -e RATE="$rate" -e DURATION="$DURATION" \
     --summary-export "$OUT/rate-$rate.json" load/load.js > /dev/null || true
  sleep 10   # let queues drain before the next step
done
