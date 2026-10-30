#!/bin/sh
# Prints the total lag of a consumer group every 2 s. Usage: sh scripts/kafka-lag.sh [group]
GROUP=${1:-notification}
while true; do
  LAG=$(docker compose exec -T kafka /opt/kafka/bin/kafka-consumer-groups.sh \
          --bootstrap-server kafka:9092 --describe --group "$GROUP" 2>/dev/null \
        | awk '$6 ~ /^[0-9]+$/ { s += $6 } END { print s + 0 }')
  echo "$(date +%T) lag=$LAG"
  sleep 2
done
