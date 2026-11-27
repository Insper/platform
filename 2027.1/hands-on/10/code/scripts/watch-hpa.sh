#!/bin/sh
# Logs time, desired/current replicas, CPU and ready pods every 5 s. Usage: sh scripts/watch-hpa.sh > results/lab10-hpa.csv
echo "time,cpu,desired,current,ready"
while true; do
  HPA=$(kubectl -n boxoffice get hpa catalog -o jsonpath='{.status.currentMetrics[0].resource.current.averageUtilization},{.status.desiredReplicas},{.status.currentReplicas}')
  READY=$(kubectl -n boxoffice get deploy catalog -o jsonpath='{.status.readyReplicas}')
  echo "$(date +%T),$HPA,$READY"
  sleep 5
done
