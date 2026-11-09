#!/usr/bin/env bash
# Lab 2: print, once per second, how many requests are INSIDE the service right now.
#   bash scripts/watch-metrics.sh http://localhost:8082
URL=${1:-http://localhost:8082}
metric() {   # metric <name>: current value of an actuator metric
  curl -s "$URL/actuator/metrics/$1" | jq -r '.measurements[0].value // "?"'
}
printf '%-8s %13s %10s %11s\n' time busy_threads db_active db_pending
while true; do
  printf '%-8s %13s %10s %11s\n' "$(date +%T)" \
    "$(metric tomcat.threads.busy)" \
    "$(metric hikaricp.connections.active)" \
    "$(metric hikaricp.connections.pending)"
  sleep 1
done
