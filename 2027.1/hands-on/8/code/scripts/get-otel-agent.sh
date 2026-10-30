#!/bin/sh
# Downloads the OpenTelemetry Java agent into infra/otel/ (mounted read-only into every Java service).
# Usage, from the repository root: sh scripts/get-otel-agent.sh
set -e
VERSION=2.32.0
mkdir -p infra/otel
curl -fsSL -o infra/otel/opentelemetry-javaagent.jar \
  "https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v${VERSION}/opentelemetry-javaagent.jar"
ls -l infra/otel/opentelemetry-javaagent.jar
