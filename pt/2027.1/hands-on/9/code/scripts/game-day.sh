#!/bin/sh
# Game master helper. Usage: sh scripts/game-day.sh <experiment 1..6 | reset>
API=localhost:8474
toxic() { # proxy, json
  curl -s -X POST "$API/proxies/$1/toxics" -d "$2" > /dev/null
}
echo "$(date +%T) experiment $1"
case "$1" in
  1) toxic payment '{"name":"gd","type":"latency","stream":"downstream","attributes":{"latency":2000,"jitter":300}}' ;;
  2) toxic psp '{"name":"gd","type":"timeout","stream":"downstream","attributes":{"timeout":0}}' ;;
  3) toxic payment '{"name":"gd","type":"reset_peer","toxicity":0.4,"attributes":{"timeout":0}}' ;;
  4) curl -s -X POST "$API/proxies/payment" -d '{"enabled":false}' > /dev/null ;;
  5) docker compose pause db ;;
  6) toxic payment '{"name":"gd","type":"bandwidth","stream":"downstream","attributes":{"rate":1}}' ;;
  reset) curl -s -X POST "$API/reset" > /dev/null; docker compose unpause db 2> /dev/null || true ;;
  *) echo "unknown experiment"; exit 1 ;;
esac
